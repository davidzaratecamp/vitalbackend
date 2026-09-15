import { PARENTESCO, SEXO, ESTATUS_MIGRATORIO } from '../../modules/clientes/clientes.constants.js';

/**
 * Cónyuge y beneficiarios del titular (Pasos 2 y 3 del Agente comparten esta
 * tabla, igual que en el original — `parentesco='Conyuge'` distingue al
 * cónyuge del resto).
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('dependientes', (t) => {
    t.increments('id').primary();
    t.integer('cliente_id').unsigned().notNullable().references('id').inTable('clientes').onDelete('CASCADE');
    t.enu('parentesco', PARENTESCO).notNullable();
    t.boolean('solicita_cobertura').notNullable().defaultTo(false);
    t.boolean('medicare_medicaid').notNullable().defaultTo(false);
    t.string('nombres', 120).notNullable();
    t.string('apellidos', 120).notNullable();
    t.enu('sexo', SEXO).notNullable();
    t.date('fecha_nacimiento').notNullable();
    t.string('social', 9).nullable();
    t.enu('estatus_migratorio', ESTATUS_MIGRATORIO).notNullable();
    t.timestamps(true, true);

    t.index(['cliente_id']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('dependientes');
}
