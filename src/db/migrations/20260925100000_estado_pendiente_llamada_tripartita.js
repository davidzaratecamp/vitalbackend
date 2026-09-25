/**
 * Nuevo estado "pendiente_llamada_tripartita" (2026-09-25, pedido del
 * usuario) — BackOffice ya gestionó el caso pero necesita una llamada
 * tripartita (cliente + agente + BackOffice) antes de poder aprobar o
 * rechazar. Antes esos casos se quedaban mostrando "Pendiente BackOffice"
 * para siempre, como si nadie los hubiera tocado todavía.
 *
 * ALTER con SQL crudo — mismo motivo que 20260919100000_rol_supervisor.js:
 * MySQL no soporta agregar un valor a un ENUM con alterTable+enu() de knex
 * de forma confiable.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw(
    "ALTER TABLE clientes MODIFY estado ENUM('borrador','pendiente_backoffice','pendiente_llamada_tripartita','aprobado','rechazado_backoffice') NOT NULL DEFAULT 'borrador'"
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Si ya hay clientes en 'pendiente_llamada_tripartita', se regresan a
  // 'pendiente_backoffice' antes de quitar el valor del ENUM — así el down
  // nunca falla ni deja filas en un estado que dejó de existir.
  await knex('clientes').where({ estado: 'pendiente_llamada_tripartita' }).update({ estado: 'pendiente_backoffice' });
  await knex.raw(
    "ALTER TABLE clientes MODIFY estado ENUM('borrador','pendiente_backoffice','aprobado','rechazado_backoffice') NOT NULL DEFAULT 'borrador'"
  );
}
