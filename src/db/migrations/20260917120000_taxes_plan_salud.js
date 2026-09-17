/**
 * `taxes` — valor monetario que pide la API de FirmaCloud para la Carta
 * CMS Vital.pdf (documentData.vital.taxes). Va junto a los demás campos
 * financieros del plan (deducible, prima) porque así vienen agrupados en
 * ese payload — se guarda como número plano, sin el símbolo $.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('planes_salud', (t) => {
    t.decimal('taxes', 10, 2).nullable();
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('planes_salud', (t) => {
    t.dropColumn('taxes');
  });
}
