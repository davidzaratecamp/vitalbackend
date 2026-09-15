/**
 * Notificaciones internas (bandeja tipo campana) — "BackOffice rechazó tu
 * cliente X" para el agente dueño, "Nuevo registro pendiente" para todo
 * BackOffice cuando un agente finaliza. No reemplaza correo/SMS (no hay
 * proveedor configurado todavía); es el canal inmediato dentro de la app.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('notificaciones', (t) => {
    t.increments('id').primary();
    t.integer('usuario_id').unsigned().notNullable().references('id').inTable('usuarios_sistema').onDelete('CASCADE');
    t.integer('cliente_id').unsigned().nullable().references('id').inTable('clientes').onDelete('CASCADE');
    t.string('tipo', 40).notNullable(); // 'rechazo' | 'nuevo_pendiente'
    t.string('mensaje', 300).notNullable();
    t.boolean('leida').notNullable().defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['usuario_id', 'leida']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('notificaciones');
}
