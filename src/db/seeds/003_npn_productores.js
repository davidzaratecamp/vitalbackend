const PRODUCTORES = ['Luis Vitier', 'Talia Bordon', 'Samuel Payne', 'Jessica Trujillo'];

/** @param {import('knex').Knex} knex */
export async function seed(knex) {
  for (const nombre of PRODUCTORES) {
    await knex('npn_productores').insert({ nombre }).onConflict('nombre').ignore();
  }
}
