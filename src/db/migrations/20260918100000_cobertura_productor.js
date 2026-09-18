/**
 * Qué aseguradoras puede vender cada productor (NPN) en cada estado — trae
 * un dato que `cobertura_zip` no tiene: dos productores en el MISMO estado
 * pueden ofrecer listas de aseguradoras distintas (cada uno está licenciado
 * con compañías distintas). "BaseEstadosy CoberturasVitaldato 2026.xlsx"
 * que compartió el usuario — no reemplaza `cobertura_zip`, la complementa:
 * esa sigue resolviendo estado→aseguradoras por rango de ZIP; esta filtra
 * ese resultado según el productor elegido en el Paso 5.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('cobertura_productor', (t) => {
    t.increments('id').primary();
    t.integer('npn_productor_id').unsigned().notNullable().references('id').inTable('npn_productores').onDelete('CASCADE');
    t.string('estado', 60).notNullable();
    t.integer('aseguradora_id').unsigned().notNullable().references('id').inTable('aseguradoras').onDelete('CASCADE');

    t.index(['npn_productor_id', 'estado']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('cobertura_productor');
}
