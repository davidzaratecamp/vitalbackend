/**
 * Cuentas de acceso al sistema (agente / backoffice / admin). Separada de
 * `clientes` a propósito: en el CRM original "usuarios" nombraba tanto las
 * cuentas de login como los clientes del call center, lo cual confundía el
 * modelo — aquí quedan como dos conceptos distintos desde el nombre.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('usuarios_sistema', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable();
    t.string('email', 190).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.enu('role', ['agente', 'backoffice', 'admin']).notNullable();
    t.string('avatar_color', 20).notNullable().defaultTo('#6366f1');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('usuarios_sistema');
}
