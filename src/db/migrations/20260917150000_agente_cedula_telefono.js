/**
 * `cedula` y `phone` del agente — los pide la carta de firma (FirmaCloud):
 * `agentCedula` es obligatorio en cada envío, `agentPhone` es opcional.
 * Se editan desde Usuarios del sistema (solo admin), igual que el resto del
 * perfil. `cedula` queda nullable: si un agente todavía no la tiene cargada,
 * el envío de la carta falla con un mensaje claro pidiendo completarla —no
 * se inventa un valor.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('usuarios_sistema', (t) => {
    t.string('cedula', 40).nullable();
    t.string('phone', 20).nullable();
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('usuarios_sistema', (t) => {
    t.dropColumn('cedula');
    t.dropColumn('phone');
  });
}
