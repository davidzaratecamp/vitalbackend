/**
 * Rol "customer" — Customer Service de postventa (2026-09-24). Atiende
 * llamadas sobre clientes YA APROBADOS (cambios de método de pago, dudas de
 * cobertura, cancelaciones, etc — ver módulo casosPostventa). No se separa
 * por empresa (equipo centralizado, ve Vital y Vital Asiste por igual) —
 * por eso no entra en ROLES_CON_EMPRESA de usuariosSistema.routes.js.
 *
 * ALTER con SQL crudo — mismo motivo que 20260919100000_rol_supervisor.js:
 * MySQL no soporta agregar un valor a un ENUM con alterTable+enu() de knex
 * de forma confiable.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw("ALTER TABLE usuarios_sistema MODIFY role ENUM('agente','backoffice','admin','supervisor','customer') NOT NULL");
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Si ya hay usuarios con role='customer', esto falla a propósito — no hay
  // un rol razonable al que reasignarlos automáticamente.
  await knex.raw("ALTER TABLE usuarios_sistema MODIFY role ENUM('agente','backoffice','admin','supervisor') NOT NULL");
}
