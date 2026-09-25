/**
 * Permiso individual para ver los datos sensibles de pago (2026-09-25) —
 * el usuario ya tiene a la persona concreta (una backoffice de Vital
 * Asiste, Camila) que va a poder ver TANTO el número completo de tarjeta
 * COMO el Data Point. A diferencia de un rol nuevo, sigue siendo
 * "backoffice" para todo lo demás — esto es un permiso extra encima del
 * rol, no un reemplazo.
 *
 * Aclaración del usuario (2026-09-25, mismo día): para Vital Asiste, NINGÚN
 * backoffice puede ver datos de tarjeta salvo Camila — a diferencia de
 * antes, donde el número completo (no el Data Point) estaba abierto a todo
 * backoffice/admin sin distinción. Vital (la otra empresa) todavía no
 * tiene instrucción — por ahora sigue con el comportamiento de siempre
 * para su número completo (abierto a su backoffice), ver
 * clientes.routes.js para el detalle exacto de la regla por empresa.
 *
 * `accesos_tarjeta` (log de auditoría de "quién vio un dato sensible de
 * pago y cuándo") gana `tipo` para poder registrar también las revelaciones
 * de Data Point en la misma tabla — las filas existentes son todas de
 * número de tarjeta (única razón de ser de la tabla hasta hoy).
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('usuarios_sistema', (t) => {
    t.boolean('puede_ver_datos_pago').notNullable().defaultTo(false);
  });
  await knex.raw("ALTER TABLE accesos_tarjeta ADD COLUMN tipo ENUM('numero_tarjeta','data_point') NOT NULL DEFAULT 'numero_tarjeta'");
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw('ALTER TABLE accesos_tarjeta DROP COLUMN tipo');
  await knex.schema.alterTable('usuarios_sistema', (t) => {
    t.dropColumn('puede_ver_datos_pago');
  });
}
