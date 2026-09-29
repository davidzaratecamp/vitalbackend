/**
 * (2026-09-29, pedido del usuario) — admin ahora puede eliminar un cliente
 * en CUALQUIER estado (borrador, pendiente_backoffice,
 * pendiente_llamada_tripartita, aprobado, rechazado_backoffice), no solo
 * borrador (ver ESTADOS_ELIMINABLES_POR_ROL en clientes.service.js — admin
 * queda sin restricción de estado, agente/supervisor no cambian). Dos
 * ajustes a la papelera:
 *
 * 1. `estado_previo` estaba limitado por ENUM a los dos únicos estados que
 *    hasta hoy se podían borrar (borrador/rechazado_backoffice) — se
 *    amplía a los 5 estados reales de `clientes` para que la foto de un
 *    borrado de admin no reviente el insert.
 * 2. Se pidió que quede "la huella de quien eliminó el ID, cuando, donde, a
 *    que hora, y una observación opcional" — quién/cuándo ya existían
 *    (eliminado_por*, created_at); se suman `ip_origen` (la IP de origen de
 *    la petición — nginx ya manda X-Forwarded-For/X-Real-IP en producción,
 *    ver app.js `trust proxy`) y `observacion` (texto libre opcional que
 *    puede dejar quien elimina).
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('clientes_eliminados', (t) => {
    t.string('ip_origen', 64).nullable().after('eliminado_por_rol');
    t.text('observacion').nullable().after('ip_origen');
  });
  await knex.raw(
    "ALTER TABLE clientes_eliminados MODIFY estado_previo ENUM('borrador','pendiente_backoffice','pendiente_llamada_tripartita','aprobado','rechazado_backoffice') NOT NULL"
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Antes de angostar el ENUM de vuelta, cualquier fila con un estado_previo
  // que ya no entra (pendiente_backoffice/pendiente_llamada_tripartita/
  // aprobado) se recorta a 'rechazado_backoffice' para no perder el rollback
  // por un dato que ya no cabe.
  await knex('clientes_eliminados')
    .whereNotIn('estado_previo', ['borrador', 'rechazado_backoffice'])
    .update({ estado_previo: 'rechazado_backoffice' });
  await knex.raw("ALTER TABLE clientes_eliminados MODIFY estado_previo ENUM('borrador','rechazado_backoffice') NOT NULL");
  await knex.schema.alterTable('clientes_eliminados', (t) => {
    t.dropColumn('observacion');
    t.dropColumn('ip_origen');
  });
}
