/**
 * Rastreo de las cartas de firma enviadas por FirmaCloud (Carta CMS Vital).
 * Una fila por envío (permite reenviar si expiró o el cliente no llegó a
 * firmar — se guarda el historial, no se sobreescribe). El estado se
 * refresca por polling (GET /api/signatures/:id) porque el webhook de
 * FirmaCloud no puede llegarle a Vital — está en una IP privada.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('firmas_documentos', (t) => {
    t.increments('id').primary();
    t.integer('cliente_id').unsigned().notNullable().references('id').inTable('clientes').onDelete('CASCADE');
    // Nulo hasta que FirmaCloud confirme el envío (201).
    t.string('firmacloud_id', 64).nullable();
    t.enu('estado', ['pending', 'viewed', 'signed', 'expired', 'failed']).notNullable().defaultTo('pending');
    t.string('canal', 20).notNullable().defaultTo('email');
    t.integer('enviado_por').unsigned().notNullable().references('id').inTable('usuarios_sistema');
    t.timestamp('enviado_at').nullable();
    t.timestamp('visto_at').nullable();
    t.timestamp('firmado_at').nullable();
    t.timestamp('expirado_at').nullable();
    // Se llenan al consultar el estado, una vez firmado.
    t.string('firmante_nombre', 160).nullable();
    t.string('firmante_ip', 60).nullable();
    t.string('firmante_dispositivo', 60).nullable();
    t.timestamps(true, true);

    t.index(['cliente_id', 'created_at']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('firmas_documentos');
}
