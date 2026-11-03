import { db } from '../../db/knex.js';

// Mismo largo que la columna `notificaciones.mensaje` (VARCHAR(300)).
const MAX_MENSAJE = 300;
const CORTE = '… (ver el motivo completo en el registro)';

/**
 * Los mensajes que llevan un motivo escrito por una persona (un rechazo de
 * BackOffice, por ejemplo) pueden pasar de 300 caracteres. Antes el INSERT
 * reventaba con "Data too long for column 'mensaje'": el rechazo ya había
 * quedado guardado, pero BackOffice veía un error y al agente no le llegaba
 * el aviso (visto en producción, 2026-10-23). La campana solo necesita el
 * resumen — el motivo completo sigue en el historial del registro.
 */
export function recortarMensaje(mensaje) {
  const texto = String(mensaje ?? '');
  if (texto.length <= MAX_MENSAJE) return texto;
  return texto.slice(0, MAX_MENSAJE - CORTE.length).trimEnd() + CORTE;
}

/** Crea una notificación para un usuario puntual. */
export async function notificar(usuarioId, { tipo, mensaje, clienteId = null }) {
  await db('notificaciones').insert({ usuario_id: usuarioId, cliente_id: clienteId, tipo, mensaje: recortarMensaje(mensaje) });
}

/** Crea la misma notificación para todos los usuarios activos de un rol (p. ej. avisar a todo BackOffice). */
export async function notificarRol(role, { tipo, mensaje, clienteId = null }) {
  const usuarios = await db('usuarios_sistema').select('id').where({ role, is_active: true });
  if (!usuarios.length) return;
  await db('notificaciones').insert(
    usuarios.map((u) => ({ usuario_id: u.id, cliente_id: clienteId, tipo, mensaje: recortarMensaje(mensaje) }))
  );
}

export async function listar(usuarioId, limit = 30) {
  return db('notificaciones').where({ usuario_id: usuarioId }).orderBy('created_at', 'desc').limit(limit);
}

export async function contarNoLeidas(usuarioId) {
  const [{ n }] = await db('notificaciones').where({ usuario_id: usuarioId, leida: false }).count({ n: '*' });
  return Number(n);
}

export async function marcarLeida(usuarioId, id) {
  await db('notificaciones').where({ id, usuario_id: usuarioId }).update({ leida: true });
}

export async function marcarTodasLeidas(usuarioId) {
  await db('notificaciones').where({ usuario_id: usuarioId, leida: false }).update({ leida: true });
}
