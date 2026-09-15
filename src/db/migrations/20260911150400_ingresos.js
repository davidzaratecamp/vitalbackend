import { TIPO_DECLARACION } from '../../modules/clientes/clientes.constants.js';

/**
 * Ingreso de una persona del grupo familiar. En el original, `entidad_id` era
 * polimórfico (apuntaba a `usuarios.id` o `dependientes.id` según
 * `tipo_entidad`, sin FK real, así que borrar un dependiente no arrastraba su
 * ingreso). Aquí `dependiente_id` es una FK de verdad, nullable:
 * NULL = el ingreso es del titular (`cliente_id`); con valor = de ese
 * dependiente. `ingresos_anuales` es una columna GENERADA por MySQL
 * (`semanales * 52`), no un cálculo que cada capa tenga que repetir.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('ingresos', (t) => {
    t.increments('id').primary();
    t.integer('cliente_id').unsigned().notNullable().references('id').inTable('clientes').onDelete('CASCADE');
    t.integer('dependiente_id').unsigned().nullable().references('id').inTable('dependientes').onDelete('CASCADE');
    t.enu('tipo_declaracion', TIPO_DECLARACION).notNullable().defaultTo('W2');
    t.decimal('ingresos_semanales', 10, 2).notNullable();
    t.specificType('ingresos_anuales', 'DECIMAL(12,2) GENERATED ALWAYS AS (ingresos_semanales * 52) STORED');
    t.timestamps(true, true);

    t.unique(['dependiente_id']);
    t.index(['cliente_id']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('ingresos');
}
