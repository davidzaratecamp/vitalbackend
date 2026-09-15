import { METODO_PAGO } from '../../modules/clientes/clientes.constants.js';

/**
 * Datos de pago del Paso 6. A propósito NO existen columnas para el número de
 * tarjeta completo ni el CVV — en el original ambos se guardaban en texto
 * plano (`informacion_pago.cvv`, `numero_tarjeta_completo`), señalado como la
 * falla de mayor severidad del sistema. Solo se guardan los últimos 4
 * dígitos (tecleados directo, nunca derivados de un PAN completo que nunca
 * llega al backend) y el vencimiento. Cobro real con tokenización de un
 * procesador de pagos queda fuera de este alcance.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('informacion_pago', (t) => {
    t.increments('id').primary();
    t.integer('cliente_id').unsigned().notNullable().unique().references('id').inTable('clientes').onDelete('CASCADE');
    t.enu('metodo', METODO_PAGO).notNullable().defaultTo('tarjeta');
    t.string('ultimos_4_digitos', 4).nullable();
    t.string('nombre_titular_tarjeta', 120).nullable();
    t.integer('fecha_expiracion_mes').unsigned().nullable();
    t.integer('fecha_expiracion_ano').unsigned().nullable();
    t.timestamps(true, true);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('informacion_pago');
}
