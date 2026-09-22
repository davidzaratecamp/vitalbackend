import { CATEGORIA_EVIDENCIA } from '../../modules/clientes/clientes.constants.js';

/**
 * Le pone nombre a cada evidencia (Póliza / Estatus migratorio / Licencia /
 * Social) en vez de ser una lista plana de archivos sin etiquetar — así el
 * agente sabe qué debe subir en cada casillero. Nullable: las evidencias ya
 * subidas antes de este cambio quedan sin categoría (no hay forma de saber
 * retroactivamente cuál era cuál); `finalizar()` ahora exige las 3
 * obligatorias por categoría, así que un cliente rechazado que necesite
 * reenviarse tendrá que volver a subirlas ya categorizadas.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('evidencias', (t) => {
    t.enu('categoria', CATEGORIA_EVIDENCIA).nullable().after('tipo_archivo');
    t.index(['cliente_id', 'categoria']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('evidencias', (t) => {
    t.dropIndex(['cliente_id', 'categoria']);
    t.dropColumn('categoria');
  });
}
