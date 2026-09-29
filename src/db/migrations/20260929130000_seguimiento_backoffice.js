/**
 * "Seguimiento" para BackOffice (2026-09-29, pedido del usuario) — hasta
 * hoy, un caso escalado a BackOffice solo tenía dos estados posibles:
 * 'escalado_backoffice' (sin tomar) o 'cerrado', y CUALQUIER backoffice de
 * la empresa podía verlo/gestionarlo en cualquier momento — no había forma
 * de saber si alguien ya lo estaba trabajando ni de evitar que dos
 * personas lo tomaran a la vez.
 *
 * Se agrega el estado 'seguimiento_backoffice': cuando un backoffice le da
 * "Seguimiento" a un caso escalado, pasa a este estado y queda asignado
 * EXCLUSIVAMENTE a esa persona (gestionado_por) — ningún otro backoffice
 * de la empresa puede verlo ni gestionarlo desde ahí (ver assertCasoAccesible
 * / assertCasoActivo en casosPostventa.service.js). Agente/admin/supervisor
 * sí lo siguen viendo (con quién lo tomó) — la exclusividad es solo entre
 * compañeros de BackOffice.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw(
    "ALTER TABLE casos_postventa MODIFY estado ENUM('nuevo','seguimiento','cerrado','escalado_backoffice','seguimiento_backoffice') NOT NULL DEFAULT 'nuevo'"
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Antes de angostar el ENUM, cualquier caso que haya quedado en
  // 'seguimiento_backoffice' se recorta a 'escalado_backoffice' (vuelve a
  // la cola compartida) para no perder el rollback por un dato que ya no cabe.
  await knex('casos_postventa').where({ estado: 'seguimiento_backoffice' }).update({ estado: 'escalado_backoffice' });
  await knex.raw(
    "ALTER TABLE casos_postventa MODIFY estado ENUM('nuevo','seguimiento','cerrado','escalado_backoffice') NOT NULL DEFAULT 'nuevo'"
  );
}
