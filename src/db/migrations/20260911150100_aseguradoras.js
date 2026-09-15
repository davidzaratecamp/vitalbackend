/**
 * Catálogo real de aseguradoras. Reemplaza las dos listas de texto libre
 * inconsistentes del CRM original (13 opciones en el formulario del Agente,
 * 10 distintas en el de BackOffice, con "blue cross" / "Bluecross" como
 * valores distintos por un problema de mayúsculas) por una sola tabla que
 * ambos formularios consultan.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('aseguradoras', (t) => {
    t.increments('id').primary();
    t.string('nombre', 80).notNullable().unique();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('aseguradoras');
}
