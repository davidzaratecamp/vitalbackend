/**
 * Catálogo de productores con NPN — un puñado de personas licenciadas
 * (no cada agente tiene el suyo; los agentes venden bajo el NPN de uno de
 * estos productores) que se elige por desplegable en el Paso 5, para la
 * carta de firma (FirmaCloud). El número de NPN llega después — por ahora
 * queda nullable, se llena desde Catálogos cuando lo tengan.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('npn_productores', (t) => {
    t.increments('id').primary();
    t.string('nombre', 120).notNullable().unique();
    t.string('npn', 40).nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('npn_productores');
}
