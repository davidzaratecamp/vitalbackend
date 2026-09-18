/**
 * "Data Point" — nota de texto libre en el Paso 6 (Información de pago).
 * El agente la escribe pero no puede volver a verla (ni mientras escribe:
 * queda enmascarada, ni después) — solo BackOffice/Admin pueden revelarla,
 * igual que el número completo de tarjeta. A diferencia de la tarjeta, este
 * campo NO es un dato de pago regulado (no es PCI), así que se guarda en
 * texto plano, sin cifrar y sin tabla de auditoría de accesos — la única
 * protección que se pidió es que el agente no pueda leerlo.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('informacion_pago', (t) => {
    t.text('data_point').nullable();
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('informacion_pago', (t) => {
    t.dropColumn('data_point');
  });
}
