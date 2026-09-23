/**
 * La respuesta de seguridad pasa de guardarse HASHEADA (bcrypt,
 * irreversible — como una contraseña, nunca se podía mostrar) a guardarse
 * CIFRADA (AES-256-GCM, reversible — mismo mecanismo que el número de
 * tarjeta en cardCrypto.js) para que admin/supervisor/backoffice puedan
 * verla (2026-09-23, a pedido del usuario).
 *
 * `respuesta_seguridad_hash` queda intacta como dato histórico — un hash
 * bcrypt NO se puede convertir a cifrado reversible (es de un solo
 * sentido por diseño), así que las respuestas guardadas ANTES de este
 * cambio quedan sin poder mostrarse hasta que el agente las vuelva a
 * guardar.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('clientes', (t) => {
    t.string('respuesta_seguridad_cifrada', 500).nullable().after('respuesta_seguridad_hash');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('clientes', (t) => {
    t.dropColumn('respuesta_seguridad_cifrada');
  });
}
