/**
 * Horario de contactabilidad del cliente — texto libre (ej. "Lunes a
 * viernes, 8am-5pm" o "Solo después de las 6pm") para que el agente lo
 * escriba en el Paso 1. Opcional.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('clientes', (t) => {
    t.string('horario_contactabilidad', 120).nullable().after('whatsapp');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('clientes', (t) => {
    t.dropColumn('horario_contactabilidad');
  });
}
