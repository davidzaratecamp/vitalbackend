/**
 * Qué aseguradoras se le pueden ofrecer a un cliente según su código
 * postal — "Base Estados y Coberturas Vital 2026.xlsx" que compartió el
 * usuario. Un rango de ZIP puede tener varias aseguradoras (una fila por
 * combinación), y dos rangos de estados distintos pueden solaparse en los
 * bordes (así viene la fuente real de datos — el código postal de EE. UU.
 * no está perfectamente dividido por estado) — por eso no hay una llave
 * única por rango, se resuelve trayendo TODAS las filas donde el ZIP cae
 * en el rango.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('cobertura_zip', (t) => {
    t.increments('id').primary();
    t.string('estado', 60).notNullable();
    t.integer('zip_desde').unsigned().notNullable();
    t.integer('zip_hasta').unsigned().notNullable();
    t.integer('aseguradora_id').unsigned().notNullable().references('id').inTable('aseguradoras').onDelete('CASCADE');

    t.index(['zip_desde', 'zip_hasta']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('cobertura_zip');
}
