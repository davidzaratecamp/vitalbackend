/**
 * `ingresos_anuales` era una columna GENERADA (`semanales * 52`) — a pedido
 * del usuario (2026-09-22) el agente ya no calcula el anual a partir del
 * semanal: lo digita directo. Se convierte `ingresos_anuales` en una
 * columna real (MySQL preserva el valor ya calculado de cada fila
 * existente al quitarle la cláusula GENERATED, así que no se pierde ni
 * cambia ningún dato histórico) y se vuelve `ingresos_semanales` opcional,
 * por si algún flujo lo sigue mandando.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.raw(
    'ALTER TABLE ingresos MODIFY COLUMN ingresos_anuales DECIMAL(12,2) NOT NULL'
  );
  await knex.schema.raw(
    'ALTER TABLE ingresos MODIFY COLUMN ingresos_semanales DECIMAL(10,2) NULL'
  );
}

/**
 * Revierte a semanal obligatorio + anual generado — solo funciona si en
 * ese momento no hay filas con ingresos_semanales NULL (las que se hayan
 * cargado solo con el anual nuevo quedarían sin cómo derivar el semanal).
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.raw(
    'ALTER TABLE ingresos MODIFY COLUMN ingresos_semanales DECIMAL(10,2) NOT NULL'
  );
  await knex.schema.raw(
    'ALTER TABLE ingresos MODIFY COLUMN ingresos_anuales DECIMAL(12,2) GENERATED ALWAYS AS (ingresos_semanales * 52) STORED'
  );
}
