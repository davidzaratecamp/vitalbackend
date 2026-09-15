/**
 * Historial de transiciones de `clientes.estado` (poblado automático por el
 * servicio en cada cambio) y notas internas de bitácora que no cambian
 * estado.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('historial_estados_cliente', (t) => {
    t.increments('id').primary();
    t.integer('cliente_id').unsigned().notNullable().references('id').inTable('clientes').onDelete('CASCADE');
    t.string('estado_anterior', 40).nullable();
    t.string('estado_nuevo', 40).notNullable();
    t.integer('cambiado_por').unsigned().notNullable().references('id').inTable('usuarios_sistema');
    t.string('motivo', 500).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['cliente_id']);
  });

  await knex.schema.createTable('observaciones', (t) => {
    t.increments('id').primary();
    t.integer('cliente_id').unsigned().notNullable().references('id').inTable('clientes').onDelete('CASCADE');
    t.integer('autor_id').unsigned().notNullable().references('id').inTable('usuarios_sistema');
    t.text('comentario').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['cliente_id']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('observaciones');
  await knex.schema.dropTableIfExists('historial_estados_cliente');
}
