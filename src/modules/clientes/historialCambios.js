import { db } from '../../db/knex.js';
import { ESTADOS_RENOVACION } from './clientes.constants.js';

/**
 * Historial de CAMBIOS de datos (tabla `historial_cambios_cliente`), que es
 * distinto del historial de ESTADOS (`historial_estados_cliente`, ver
 * logEstado): acá queda qué campo se tocó, con qué valor estaba y con cuál
 * quedó.
 *
 * Nació con las renovaciones (2026-10-27, pedido del usuario: "lo que hace
 * el agente es cambiar información si se requiere, pero debe quedar el
 * historial de que se cambió"), pero se engancha en TODOS los guardados del
 * formulario, así que también cubre una corrección en una venta o un ajuste
 * de postventa — `contexto` dice en cuál de los tres momentos pasó.
 */

/**
 * Campos que SÍ se registran como cambiados, pero sin guardar ningún valor:
 * son los datos que no pueden quedar en texto plano en ninguna tabla.
 * `numero_tarjeta`/`numero_cuenta` ni siquiera llegan acá (el servicio los
 * cifra antes), pero están listados por si algún día cambia ese camino —
 * la regla vale igual. El CVV no aparece porque no se guarda en ningún
 * lado, de ninguna forma.
 */
const CAMPOS_SIN_VALOR = new Set([
  'numero_tarjeta',
  'numero_tarjeta_cifrado',
  'numero_cuenta',
  'numero_cuenta_cifrado',
  'data_point',
  'respuesta_seguridad',
  'respuesta_seguridad_cifrada',
  'respuesta_seguridad_hash',
]);

/**
 * Columnas de mantenimiento: cambian en cada guardado y no le dicen nada a
 * nadie.
 */
const CAMPOS_IGNORADOS = new Set(['id', 'cliente_id', 'created_at', 'updated_at']);

/**
 * Normaliza a texto para poder comparar y guardar. MySQL devuelve los
 * booleanos como 0/1 y las fechas como Date, así que sin esto "false" vs 0
 * y dos fechas iguales se verían como cambios que no existen.
 */
function aTexto(valor) {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'boolean') return valor ? '1' : '0';
  if (typeof valor === 'number') return String(valor);
  const s = String(valor);
  // '1990-05-10T00:00:00.000Z' y '1990-05-10' son la misma fecha.
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(s);
  return m ? m[1] : s;
}

/**
 * En qué momento de la vida del registro se está guardando. Es una
 * aproximación a partir del estado (no hay un "modo" explícito en la
 * sesión): si la póliza está en temporada de renovación, el cambio es de
 * renovación; si ya está aprobada, solo se puede estar editando desde un
 * caso de postventa; el resto es la venta armándose.
 */
export function contextoDeEstado(estado) {
  if (ESTADOS_RENOVACION.includes(estado)) return 'renovacion';
  if (estado === 'aprobado') return 'postventa';
  return 'venta';
}

/**
 * Compara `antes` contra `despues` y deja una fila por campo que cambió.
 * Solo mira las claves presentes en `despues` — un PATCH parcial no puede
 * "borrar" lo que no mandó.
 *
 * No lanza nunca: el historial es un registro lateral y no debe tumbar un
 * guardado que ya se hizo. Si algo falla, queda en el log del servidor.
 */
export async function registrarCambios({ clienteId, seccion, referenciaId = null, antes, despues, userId, estado }) {
  try {
    if (!antes || !despues || !userId) return;
    const contexto = contextoDeEstado(estado);
    const filas = [];

    for (const campo of Object.keys(despues)) {
      if (CAMPOS_IGNORADOS.has(campo)) continue;
      const anterior = aTexto(antes[campo]);
      const nuevo = aTexto(despues[campo]);
      if (anterior === nuevo) continue;
      const oculto = CAMPOS_SIN_VALOR.has(campo);
      filas.push({
        cliente_id: clienteId,
        seccion,
        referencia_id: referenciaId,
        campo,
        valor_anterior: oculto ? null : anterior,
        valor_nuevo: oculto ? null : nuevo,
        contexto,
        cambiado_por: userId,
      });
    }

    if (filas.length) await db('historial_cambios_cliente').insert(filas);
  } catch (err) {
    console.error('[historial_cambios] no se pudo registrar el cambio:', err.message);
  }
}

/**
 * Deja constancia de que una fila ENTERA se agregó o se eliminó (un
 * dependiente nuevo, un cónyuge que se quita). Se guarda como un solo
 * renglón con el campo '__alta__'/'__baja__' y una descripción legible,
 * en vez de una fila por cada columna.
 */
export async function registrarAltaBaja({ clienteId, seccion, referenciaId = null, tipo, descripcion, userId, estado }) {
  try {
    if (!userId) return;
    await db('historial_cambios_cliente').insert({
      cliente_id: clienteId,
      seccion,
      referencia_id: referenciaId,
      campo: tipo === 'alta' ? '__alta__' : '__baja__',
      valor_anterior: tipo === 'alta' ? null : descripcion,
      valor_nuevo: tipo === 'alta' ? descripcion : null,
      contexto: contextoDeEstado(estado),
      cambiado_por: userId,
    });
  } catch (err) {
    console.error('[historial_cambios] no se pudo registrar el alta/baja:', err.message);
  }
}

/** Historial de cambios de un cliente, del más reciente al más viejo. */
export async function listarCambios(clienteId, { contexto } = {}) {
  const q = db('historial_cambios_cliente as h')
    .leftJoin('usuarios_sistema as u', 'u.id', 'h.cambiado_por')
    .where('h.cliente_id', clienteId)
    .select(
      'h.id',
      'h.seccion',
      'h.referencia_id',
      'h.campo',
      'h.valor_anterior',
      'h.valor_nuevo',
      'h.contexto',
      'h.created_at',
      'u.name as cambiado_por_nombre',
      'u.role as cambiado_por_rol'
    )
    .orderBy('h.created_at', 'desc')
    .orderBy('h.id', 'desc')
    .limit(500);
  if (contexto) q.andWhere('h.contexto', contexto);
  return q;
}
