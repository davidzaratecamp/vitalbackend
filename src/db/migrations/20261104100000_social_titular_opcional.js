/**
 * El SSN del titular deja de ser obligatorio (2026-11-04, pedido del
 * usuario). Sigue siendo único: MySQL deja tener varios NULL en un índice
 * UNIQUE, así que los clientes sin SSN no chocan entre sí — por eso el
 * vacío se guarda como NULL y nunca como ''.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('clientes', (t) => {
    t.string('social', 9).nullable().comment('SSN, solo dígitos — opcional').alter();
  });
}

/**
 * Vuelve a NOT NULL. Falla si ya hay clientes sin SSN: hay que llenarlos
 * antes de revertir.
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.alterTable('clientes', (t) => {
    t.string('social', 9).notNullable().comment('SSN, solo dígitos').alter();
  });
}
