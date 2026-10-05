import https from 'node:https';
import { spawn } from 'node:child_process';
import pg from 'pg';
import ffmpegPath from 'ffmpeg-static';
import { db } from '../../db/knex.js';
import { env } from '../../config/env.js';
import { HttpError, notFound } from '../../utils/httpError.js';

/**
 * Grabaciones de Aware (asiste2.awareccm.com) dentro de cada caso — a pedido
 * del usuario (2026-10-05): supervisor/backoffice/admin escuchan la llamada
 * sin salir de Vital.
 *
 * Vital no guarda ningún identificador de la llamada, así que se cruza por
 * cédula del agente + teléfono del cliente (últimos 10 dígitos — Aware los
 * guarda como "1XXXXXXXXXX" o "+1XXXXXXXXXX", Vital como 10 dígitos). Solo
 * se muestran las llamadas del agente dueño del caso (decisión del usuario),
 * no las de otros agentes al mismo teléfono.
 */

let pool = null;
function getPool() {
  if (!env.aware.password) {
    throw new HttpError(503, 'Las grabaciones no están configuradas en este servidor (falta AWARE_DB_PASSWORD)');
  }
  if (!pool) {
    pool = new pg.Pool({
      host: env.aware.host,
      port: env.aware.port,
      database: env.aware.database,
      user: env.aware.user,
      password: env.aware.password,
      max: 3,
      statement_timeout: 20000,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', (err) => console.error('[grabaciones] error en conexión a Aware', err.message));
  }
  return pool;
}

const normPhone = (p) => String(p || '').replace(/\D/g, '').slice(-10);

/**
 * Contexto de búsqueda: qué agente y qué teléfonos. Para un cliente, su
 * agente dueño y sus teléfonos; para un caso de postventa, el agente que lo
 * abrió y además el teléfono de contacto de ese caso.
 */
export async function contextoCliente(cliente) {
  const agente = await db('usuarios_sistema').where({ id: cliente.agente_id }).first('cedula', 'name');
  return {
    cedula: agente?.cedula || null,
    agenteNombre: agente?.name || null,
    telefonos: [cliente.phone_1, cliente.phone_2, cliente.whatsapp],
  };
}

export async function contextoCasoPostventa(caso) {
  const cliente = await db('clientes').where({ id: caso.cliente_id }).first('phone_1', 'phone_2', 'whatsapp');
  if (!cliente) throw notFound('Cliente no encontrado');
  const agente = await db('usuarios_sistema').where({ id: caso.creado_por }).first('cedula', 'name');
  return {
    cedula: agente?.cedula || null,
    agenteNombre: agente?.name || null,
    telefonos: [caso.telefono_contacto, cliente.phone_1, cliente.phone_2, cliente.whatsapp],
  };
}

/**
 * Llamadas contestadas y con grabación del agente a esos teléfonos.
 * `registroId` restringe a una sola llamada (para validar el audio).
 */
export async function listarLlamadas(ctx, registroId = null) {
  const telefonos = [...new Set(ctx.telefonos.map(normPhone).filter((p) => p.length === 10))];
  if (!ctx.cedula || !telefonos.length) {
    return { llamadas: [], motivo: !ctx.cedula ? 'El agente del caso no tiene cédula registrada' : 'El cliente no tiene teléfonos válidos' };
  }

  const params = [ctx.cedula, telefonos];
  let filtroId = '';
  if (registroId != null) {
    params.push(Number(registroId));
    filtroId = `AND registro_llamada_id = $${params.length}`;
  }

  const { rows } = await getPool().query(
    `SELECT registro_llamada_id, proyecto_id,
            registro_llamada_fecha::text AS fecha, registro_llamada_hora::text AS hora,
            registro_llamada_fono AS telefono, time_speaking AS duracion, audiofile,
            json_data->>'proyecto_name' AS campana
     FROM registro_llamada
     WHERE agente_id = $1
       AND right(regexp_replace(registro_llamada_fono, '\\D', '', 'g'), 10) = ANY($2::text[])
       AND time_speaking > 0
       AND audiofile IS NOT NULL
       ${filtroId}
     ORDER BY registro_llamada_fecha DESC, registro_llamada_hora DESC
     LIMIT 100`,
    params
  );

  return {
    // `audiofile` no sale al navegador — el audio siempre pasa por el backend.
    llamadas: rows.map(({ audiofile, ...r }) => ({ ...r, agente: ctx.agenteNombre })),
    audiofiles: Object.fromEntries(rows.map((r) => [r.registro_llamada_id, r.audiofile])),
    motivo: null,
  };
}

function descargar(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 60000 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new HttpError(502, `Aware no entregó la grabación (HTTP ${res.statusCode})`));
        }
        resolve(res);
      })
      .on('timeout', function onTimeout() { this.destroy(new HttpError(504, 'Aware tardó demasiado en entregar la grabación')); })
      .on('error', (err) => reject(err instanceof HttpError ? err : new HttpError(502, 'No se pudo descargar la grabación de Aware')));
  });
}

/**
 * Envía el audio de una llamada ya validada (pertenece al caso) como MP3.
 * Aware graba en WAV GSM 6.10, que los navegadores no reproducen; se
 * convierte al vuelo con el ffmpeg empaquetado (el servidor no tiene ffmpeg
 * del sistema), sin archivos temporales.
 */
export async function enviarAudio(ctx, registroId, res) {
  const { audiofiles } = await listarLlamadas(ctx, registroId);
  const audiofile = audiofiles?.[Number(registroId)];
  if (!audiofile) throw notFound('Esa grabación no pertenece a este caso');

  const origen = await descargar(`${env.aware.audioBaseUrl}/${audiofile}.WAV`);

  // Se convierte completo antes de responder: así un fallo de ffmpeg se
  // reporta como error normal y el navegador recibe Content-Length (puede
  // adelantar/retroceder en el reproductor).
  const mp3 = await new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-b:a', '32k', '-f', 'mp3', 'pipe:1']);
    const chunks = [];
    let stderr = '';
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.stderr.on('data', (c) => { stderr += c; });
    ff.on('error', () => reject(new HttpError(500, 'No se pudo convertir la grabación')));
    ff.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else {
        console.error('[grabaciones] ffmpeg falló', stderr.slice(0, 300));
        reject(new HttpError(500, 'No se pudo convertir la grabación'));
      }
    });
    origen.on('error', () => ff.stdin.destroy());
    ff.stdin.on('error', () => {});
    origen.pipe(ff.stdin);
  });

  res.set({
    'Content-Type': 'audio/mpeg',
    'Content-Length': mp3.length,
    'Content-Disposition': `inline; filename="llamada-${Number(registroId)}.mp3"`,
  });
  res.send(mp3);
}
