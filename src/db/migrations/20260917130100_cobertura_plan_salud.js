/**
 * Campos de cobertura que pide la carta de firma (FirmaCloud):
 * - pd (Atención Primaria), sd (Atención de Especialista), gd (Medicamento
 *   Genérico) — el agente los copia de otra pantalla (el resumen "Usted
 *   paga" del plan), y no siempre son un número limpio (ej. "Sin cargo por
 *   visita desde el día 1", "50% coaseguro después del deducible") — por
 *   eso quedan como texto libre, aunque la API los pida "numérico": el dato
 *   real del agente no siempre lo es.
 * - npn_productor_id — a qué productor (de `npn_productores`) pertenece
 *   este NPN, elegido por el agente en el Paso 5. Independiente del `npn`
 *   de texto libre que ya llena BackOffice al aprobar — ese no se toca.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('planes_salud', (t) => {
    t.string('pd', 120).nullable();
    t.string('sd', 120).nullable();
    t.string('gd', 120).nullable();
    t.integer('npn_productor_id').unsigned().nullable().references('id').inTable('npn_productores');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('planes_salud', (t) => {
    t.dropColumn('pd');
    t.dropColumn('sd');
    t.dropColumn('gd');
    t.dropColumn('npn_productor_id');
  });
}
