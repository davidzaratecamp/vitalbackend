import { TIPO_METAL, TIPO_RED, ESTADO_PRIMA } from '../../modules/clientes/clientes.constants.js';

/**
 * Fuente ÚNICA del plan de salud, con historial de versiones. El original
 * tenía DOS lugares para lo mismo: `planes_salud` (lo cotiza el Agente en el
 * Paso 5) y columnas sueltas de póliza en `usuarios` (las llena BackOffice) —
 * desincronizados, con nombres de columna distintos para el mismo dato
 * (`gasto_max_bolsillo` vs `gasto_maximo_bolsillo`) y el consolidado del
 * Admin solo leía la segunda. Aquí cada confirmación inserta una fila nueva
 * (`version_origen`) y solo una queda `is_current=true` por cliente.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('planes_salud', (t) => {
    t.increments('id').primary();
    t.integer('cliente_id').unsigned().notNullable().references('id').inTable('clientes').onDelete('CASCADE');
    t.integer('aseguradora_id').unsigned().notNullable().references('id').inTable('aseguradoras');
    t.string('nombre_plan', 160).notNullable();
    t.enu('tipo_metal', TIPO_METAL).notNullable();
    t.enu('tipo_red', TIPO_RED).notNullable();
    t.decimal('deducible', 10, 2).nullable();
    t.decimal('gasto_max_bolsillo', 10, 2).nullable();
    t.decimal('valor_prima', 10, 2).notNullable();
    t.string('npn', 40).nullable();
    t.enu('estado_prima', ESTADO_PRIMA).nullable();
    t.enu('version_origen', ['cotizado_agente', 'confirmado_backoffice']).notNullable();
    t.boolean('is_current').notNullable().defaultTo(true);
    t.integer('creado_por').unsigned().notNullable().references('id').inTable('usuarios_sistema');
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['cliente_id', 'is_current']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('planes_salud');
}
