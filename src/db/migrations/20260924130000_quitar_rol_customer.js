/**
 * Se quita el rol "customer" (2026-09-24, mismo día que se agregó) — el
 * usuario aclaró que "el customer es el mismo agente": la persona que hace
 * postventa es la misma que vende, no un rol/cuenta aparte. Todo lo que
 * hacía Customer (validar cliente aprobado por teléfono, casos de
 * postventa) se integró dentro del rol "agente" — ver casosPostventa.
 * routes.js/.service.js y clientes.service.js#assertAccesoCliente.
 *
 * Antes de alterar el ENUM: cualquier usuario que ya haya quedado con
 * role='customer' pasa a 'agente' (defensivo — en producción nunca se llegó
 * a crear ninguno, pero en local sí para pruebas).
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex('usuarios_sistema').where({ role: 'customer' }).update({ role: 'agente' });
  await knex.raw("ALTER TABLE usuarios_sistema MODIFY role ENUM('agente','backoffice','admin','supervisor') NOT NULL");
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw("ALTER TABLE usuarios_sistema MODIFY role ENUM('agente','backoffice','admin','supervisor','customer') NOT NULL");
}
