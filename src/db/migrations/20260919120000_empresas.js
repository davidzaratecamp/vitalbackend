/**
 * "Empresas" — Vital absorbió a la extinta Asiste Health Care (sus
 * coordinadores y agentes), pero ambos grupos deben seguir SEPARADOS entre
 * sí: los agentes/backoffice/supervisores de un lado no interactúan con los
 * del otro. Todo dentro de Vital ahora (ya no queda nada con el nombre
 * "Asiste Health Care" — de ahí "Vital Asiste" en vez del nombre de la
 * empresa cerrada).
 *
 * Admin (Julian) es la única excepción: ve todo, de las dos empresas, sin
 * restricción — por eso `empresa_id` en usuarios_sistema es NULLABLE (un
 * admin no necesita una).
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('empresas', (t) => {
    t.increments('id').primary();
    t.string('nombre', 80).notNullable().unique();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('usuarios_sistema', (t) => {
    t.integer('empresa_id').unsigned().nullable().references('id').inTable('empresas');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('usuarios_sistema', (t) => {
    t.dropColumn('empresa_id');
  });
  await knex.schema.dropTableIfExists('empresas');
}
