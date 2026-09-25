/**
 * Documentos adjuntos a un caso de postventa (2026-09-25, pedido del
 * usuario) — "tanto el agente como el backoffice deben poder adjuntar
 * documentos (ilimitados) en gestión de postventa". A diferencia de
 * `evidencias` (Paso 7 de la venta, categorías fijas, solo el agente) y de
 * `soportes_poliza` (solo BackOffice/Admin), acá suben archivos libres
 * tanto agente como BackOffice — sin categoría, sin límite de negocio —
 * mientras tengan el caso activo (mismo candado que editar el caso, ver
 * assertCasoActivo en casosPostventa.service.js). Tabla aparte de
 * `evidencias` porque cuelga de `caso_postventa_id`, no de `cliente_id` —
 * un mismo cliente puede tener varios casos de postventa a lo largo del
 * tiempo, cada uno con sus propios documentos.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('soportes_caso_postventa', (t) => {
    t.increments('id').primary();
    t.integer('caso_postventa_id').unsigned().notNullable().references('id').inTable('casos_postventa').onDelete('CASCADE');
    t.string('nombre_archivo', 255).notNullable();
    t.string('ruta_archivo', 500).notNullable();
    t.string('tipo_archivo', 100).notNullable();
    t.integer('tamano_bytes').unsigned().notNullable();
    t.integer('subido_por').unsigned().notNullable().references('id').inTable('usuarios_sistema');
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['caso_postventa_id']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('soportes_caso_postventa');
}
