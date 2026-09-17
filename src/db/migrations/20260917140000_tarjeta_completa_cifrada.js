/**
 * Número completo de tarjeta, cifrado (ver src/utils/cardCrypto.js) — decisión
 * explícita del usuario tras advertirle que esto implica alcance PCI-DSS real
 * (no lo resuelve solo cifrar la columna). `ultimos_4_digitos` y
 * `marca_tarjeta` ahora se derivan del número completo al guardarlo, no se
 * escriben sueltos.
 *
 * `accesos_tarjeta`: auditoría mínima de quién descifra el número completo y
 * cuándo (ver GET /:id/pago/numero-completo, solo backoffice/admin).
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('informacion_pago', (t) => {
    t.text('numero_tarjeta_cifrado').nullable();
    t.string('marca_tarjeta', 20).nullable();
  });

  await knex.schema.createTable('accesos_tarjeta', (t) => {
    t.increments('id').primary();
    t.integer('cliente_id').unsigned().notNullable().references('id').inTable('clientes');
    t.integer('usuario_id').unsigned().notNullable().references('id').inTable('usuarios_sistema');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('accesos_tarjeta');
  await knex.schema.alterTable('informacion_pago', (t) => {
    t.dropColumn('numero_tarjeta_cifrado');
    t.dropColumn('marca_tarjeta');
  });
}
