/**
 * Nueva categoría de evidencia "carta_cms_anterior" (2026-09-25, pedido del
 * usuario) — para cuando el cliente pide actualizar su póliza: se guarda la
 * carta CMS vieja como respaldo antes de hacer firmar la nueva. Opcional,
 * igual que "social" (no entra en CATEGORIA_EVIDENCIA_OBLIGATORIA).
 *
 * ALTER con SQL crudo — mismo motivo que el resto de ENUMs de este
 * proyecto: MySQL no soporta agregar un valor con alterTable+enu() de knex
 * de forma confiable.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw(
    "ALTER TABLE evidencias MODIFY categoria ENUM('poliza','estatus_migratorio','licencia','social','carta_cms_anterior') NULL"
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex('evidencias').where({ categoria: 'carta_cms_anterior' }).update({ categoria: null });
  await knex.raw("ALTER TABLE evidencias MODIFY categoria ENUM('poliza','estatus_migratorio','licencia','social') NULL");
}
