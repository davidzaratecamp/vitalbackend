/**
 * Archivos adjuntos del Paso 7. El backend valida (ver
 * middleware de subida en modules/evidencias) el máximo de 5 archivos de 5MB
 * que el original solo mencionaba en el texto de ayuda sin aplicarlo.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('evidencias', (t) => {
    t.increments('id').primary();
    t.integer('cliente_id').unsigned().notNullable().references('id').inTable('clientes').onDelete('CASCADE');
    t.string('nombre_archivo', 255).notNullable();
    t.string('ruta_archivo', 500).notNullable().comment('ruta relativa bajo backend/uploads, privada');
    t.string('tipo_archivo', 100).notNullable();
    t.integer('tamano_bytes').unsigned().notNullable();
    t.string('descripcion', 500).nullable();
    t.integer('subido_por').unsigned().notNullable().references('id').inTable('usuarios_sistema');
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['cliente_id']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('evidencias');
}
