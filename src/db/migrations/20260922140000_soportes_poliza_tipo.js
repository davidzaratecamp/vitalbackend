/**
 * `soportes_poliza` pasa a servir dos propósitos, distinguidos por `tipo`:
 * 'poliza' (lo que ya había) y 'rechazo' (imagen de soporte que BackOffice
 * adjunta al rechazar una venta, 2026-09-22) — mismo dueño/permiso
 * (backoffice/admin suben, cualquiera con acceso al cliente ve), así que
 * no hace falta una tabla nueva, solo distinguir el tipo. Las filas ya
 * existentes quedan como 'poliza' (comportamiento idéntico al que tenían).
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('soportes_poliza', (t) => {
    t.enu('tipo', ['poliza', 'rechazo']).notNullable().defaultTo('poliza').after('cliente_id');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('soportes_poliza', (t) => {
    t.dropColumn('tipo');
  });
}
