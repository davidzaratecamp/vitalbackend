/**
 * "Soporte de póliza" — archivo (PDF o imagen) que BackOffice puede adjuntar
 * a un caso que gestiona, opcional. Es una tabla aparte de `evidencias`
 * (que es del Paso 7 del agente) porque el dueño y el permiso son
 * distintos: acá solo backoffice/admin suben y eliminan; cualquiera con
 * acceso al cliente puede verlo/descargarlo.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('soportes_poliza', (t) => {
    t.increments('id').primary();
    t.integer('cliente_id').unsigned().notNullable().references('id').inTable('clientes').onDelete('CASCADE');
    t.string('nombre_archivo', 255).notNullable();
    t.string('ruta_archivo', 500).notNullable().comment('ruta relativa bajo backend/uploads, privada');
    t.string('tipo_archivo', 100).notNullable();
    t.integer('tamano_bytes').unsigned().notNullable();
    t.integer('subido_por').unsigned().notNullable().references('id').inTable('usuarios_sistema');
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['cliente_id']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('soportes_poliza');
}
