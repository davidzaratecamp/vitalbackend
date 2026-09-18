/**
 * Rol "supervisor" — coordinadores que acompañan a los agentes. Ven TODOS
 * los casos de TODOS los agentes (a propósito, sin relación coordinador↔
 * agente: el usuario pidió explícitamente evitar esa restricción, para no
 * tener que actualizarla cada vez que cambia personal), pueden abrir el
 * expediente completo de un cliente y ver su estado — pero no pueden
 * editar nada. Reutiliza las mismas pantallas de solo-lectura que ya
 * existían para admin (Panel general, Reporte consolidado, vista 360 de
 * cliente) — ver admin.routes.js.
 *
 * ALTER con SQL crudo porque MySQL no soporta agregar un valor a un ENUM
 * con `alterTable` + `enu()` de knex de forma confiable — hay que
 * redefinir la columna completa.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw("ALTER TABLE usuarios_sistema MODIFY role ENUM('agente','backoffice','admin','supervisor') NOT NULL");
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Si ya hay usuarios con role='supervisor', esto falla a propósito — no
  // hay un rol razonable al que reasignarlos automáticamente.
  await knex.raw("ALTER TABLE usuarios_sistema MODIFY role ENUM('agente','backoffice','admin') NOT NULL");
}
