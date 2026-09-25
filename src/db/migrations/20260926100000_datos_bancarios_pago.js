/**
 * Campos bancarios opcionales en informacion_pago (2026-09-26, pedido del
 * usuario) — Nombre del banco, Número de ruta y Número de cuenta, para
 * cuando el método de pago es débito automático desde una cuenta bancaria
 * en vez de tarjeta. Ninguno es obligatorio.
 *
 * `numero_cuenta` se cifra igual que el número de tarjeta (mismo mecanismo
 * AES-256-GCM, cardCrypto.js) — es tan sensible como el número de tarjeta,
 * así que sigue exactamente el mismo candado: enmascarado a los últimos 4
 * dígitos normalmente, completo solo a través de la misma revelación
 * gateada que ya existe (assertPuedeVerNumeroTarjeta en
 * clientes.service.js — mismo permiso individual que el número de tarjeta
 * y el Data Point). `numero_ruta` (routing/ABA number) y `nombre_banco` NO
 * se cifran — el routing number identifica al banco, no a la cuenta, y es
 * información pública por banco (mismo nivel que `nombre_titular_tarjeta`,
 * que tampoco se cifra).
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('informacion_pago', (t) => {
    t.string('nombre_banco', 120).nullable();
    t.string('numero_ruta', 20).nullable();
    t.text('numero_cuenta_cifrado').nullable();
    t.string('ultimos_4_cuenta', 4).nullable();
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('informacion_pago', (t) => {
    t.dropColumn('nombre_banco');
    t.dropColumn('numero_ruta');
    t.dropColumn('numero_cuenta_cifrado');
    t.dropColumn('ultimos_4_cuenta');
  });
}
