const EMPRESAS = ['Vital', 'Vital Asiste'];

/** @param {import('knex').Knex} knex */
export async function seed(knex) {
  for (const nombre of EMPRESAS) {
    await knex('empresas').insert({ nombre }).onConflict('nombre').ignore();
  }
}
