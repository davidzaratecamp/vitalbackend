import { db } from '../../db/knex.js';

/** Crea una notificación para un usuario puntual. */
export async function notificar(usuarioId, { tipo, mensaje, clienteId = null }) {
  await db('notificaciones').insert({ usuario_id: usuarioId, cliente_id: clienteId, tipo, mensaje });
}

/** Crea la misma notificación para todos los usuarios activos de un rol (p. ej. avisar a todo BackOffice). */
export async function notificarRol(role, { tipo, mensaje, clienteId = null }) {
  const usuarios = await db('usuarios_sistema').select('id').where({ role, is_active: true });
  if (!usuarios.length) return;
  await db('notificaciones').insert(
    usuarios.map((u) => ({ usuario_id: u.id, cliente_id: clienteId, tipo, mensaje }))
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
