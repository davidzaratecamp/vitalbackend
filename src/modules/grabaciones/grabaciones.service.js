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
 * Llamadas grabadas del agente a esos teléfonos, desde el CDR de la central
 * (cdr_custom), no solo desde registro_llamada: Aware deja en
 * registro_llamada un único registro por contacto de la base (el último
 * intento) y los intentos anteriores — contestados y grabados, a veces de más
 * de una hora — solo existen en el CDR (2026-10-06, ~40% de las llamadas).
 *
 * Se incluye todo lo que está en registro_llamada más los intentos no
 * registrados que fueron contestados. El agente de cada llamada: el de
 * registro_llamada, el del CDR, o el de la extensión (la llamada registrada
 * más cercana en el tiempo desde esa extensión ese día). `uniqueid`
 * restringe a una sola llamada (para validar el audio).
 */
export async function listarLlamadas(ctx, uniqueid = null) {
  const telefonos = [...new Set(ctx.telefonos.map(normPhone).filter((p) => p.length === 10))];
  if (!ctx.cedula || !telefonos.length) {
    return { llamadas: [], motivo: !ctx.cedula ? 'El agente del caso no tiene cédula registrada' : 'El cliente no tiene teléfonos válidos' };
  }

  const params = [telefonos];
  let filtroId = '';
  if (uniqueid != null) {
    params.push(String(uniqueid));
    filtroId = `AND cu.uniqueid = $${params.length}`;
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `WITH base AS (
       SELECT DISTINCT ON (cu.uniqueid)
              cu.uniqueid, cu.registro_llamada_id, cu.call_start, cu.billsec, cu.audiofile, cu.telefono,
              NULLIF(cu.agente_id, '') AS cdr_agente, NULLIF(cu.proyecto_id, 0) AS cdr_proyecto,
              split_part(CASE WHEN cu.context = 'aware-cola-inbound' THEN cu.dstchannel ELSE cu.channel END, '-', 1) AS ext
       FROM cdr_custom cu
       WHERE right(regexp_replace(cu.telefono, '\\D', '', 'g'), 10) = ANY($1::text[])
         AND (cu.disposition = 'ANSWERED' OR cu.registro_llamada_id IS NOT NULL)
         AND cu.billsec > 0 AND COALESCE(cu.audiofile, '') <> ''
         AND cu.context IN ('racodialer-asistido', 'aware-cola-inbound')
         ${filtroId}
       ORDER BY cu.uniqueid, (cu.registro_llamada_id IS NOT NULL) DESC, cu.id DESC
     )
     SELECT b.uniqueid, b.billsec AS duracion, b.audiofile, b.telefono, b.cdr_agente, b.ext,
            b.call_start::text AS inicio, (b.registro_llamada_id IS NOT NULL) AS registrada,
            COALESCE(b.cdr_proyecto, (SELECT MAX(ca.proyecto_id) FROM cdr_aware ca WHERE ca.uniqueid = b.uniqueid AND ca.proyecto_id > 0)) AS proyecto_id,
            rl.agente_id AS rl_agente
     FROM base b
     LEFT JOIN registro_llamada rl ON rl.registro_llamada_id = b.registro_llamada_id
     ORDER BY b.call_start DESC
     LIMIT 200`,
    params
  );

  // Agente por extensión para las llamadas que no lo traen.
  const sinAgente = rows.filter((r) => !r.rl_agente && !r.cdr_agente);
  const anclas = new Map();
  if (sinAgente.length) {
    const fechas = [...new Set(sinAgente.map((r) => r.inicio.slice(0, 10)))];
    const { rows: a } = await pool.query(
      `SELECT split_part(CASE WHEN context = 'aware-cola-inbound' THEN dstchannel ELSE channel END, '-', 1) AS ext,
              agente_id, call_start::text AS inicio
       FROM cdr_custom WHERE agente_id <> '' AND call_start::date = ANY($1::date[])`,
      [fechas]
    );
    for (const x of a) {
      if (!anclas.has(x.ext)) anclas.set(x.ext, []);
      anclas.get(x.ext).push(x);
    }
  }
  const ms = (inicio) => new Date(inicio.replace(' ', 'T')).getTime();
  const agentePorExtension = (r) => {
    let mejor = null;
    for (const a of anclas.get(r.ext) || []) {
      if (a.inicio.slice(0, 10) !== r.inicio.slice(0, 10)) continue;
      if (!mejor || Math.abs(ms(a.inicio) - ms(r.inicio)) < Math.abs(ms(mejor.inicio) - ms(r.inicio))) mejor = a;
    }
    return mejor?.agente_id || null;
  };

  const propias = rows.filter((r) => (r.rl_agente || r.cdr_agente || agentePorExtension(r)) === ctx.cedula);
  const campanas = await nombresCampana(pool);

  return {
    // `audiofile` no sale al navegador — el audio siempre pasa por el backend.
    llamadas: propias.map((r) => ({
      uniqueid: r.uniqueid,
      proyecto_id: r.proyecto_id,
      campana: campanas.get(Number(r.proyecto_id)) || null,
      fecha: r.inicio.slice(0, 10),
      hora: r.inicio.slice(11, 19),
      telefono: r.telefono,
      duracion: r.duracion,
      registrada: r.registrada,
      agente: ctx.agenteNombre,
    })),
    audiofiles: Object.fromEntries(propias.map((r) => [r.uniqueid, r.audiofile])),
    motivo: null,
  };
}

// Nombre de cada campaña (json_data.proyecto_name de registro_llamada) — no
// cambia en el día, se cachea por proceso.
let campanasCache = null;
async function nombresCampana(pool) {
  if (campanasCache && Date.now() - campanasCache.at < 60 * 60 * 1000) return campanasCache.map;
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (proyecto_id) proyecto_id, json_data->>'proyecto_name' AS nombre
     FROM registro_llamada WHERE json_data->>'proyecto_name' IS NOT NULL ORDER BY proyecto_id, registro_llamada_id DESC`
  );
  campanasCache = { at: Date.now(), map: new Map(rows.map((r) => [Number(r.proyecto_id), r.nombre])) };
  return campanasCache.map;
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
export async function enviarAudio(ctx, uniqueid, res) {
  const { audiofiles } = await listarLlamadas(ctx, uniqueid);
  const audiofile = audiofiles?.[String(uniqueid)];
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
    'Content-Disposition': `inline; filename="llamada-${String(uniqueid).replace(/[^0-9.]/g, '')}.mp3"`,
  });
  res.send(mp3);
}
