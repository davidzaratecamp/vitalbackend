// NPN reales suministrados por el usuario (2026-09-19):
//   Luis Vitier      18771778
//   Talia Bordon     19852013
//   Samuel Payne     19834860
//   Jessica Trujillo 20650361
const PRODUCTORES = [
  { nombre: 'Luis Vitier', npn: '18771778' },
  { nombre: 'Talia Bordon', npn: '19852013' },
  { nombre: 'Samuel Payne', npn: '19834860' },
  { nombre: 'Jessica Trujillo', npn: '20650361' },
];

/** @param {import('knex').Knex} knex */
export async function seed(knex) {
  for (const p of PRODUCTORES) {
    // merge solo `npn` — si is_active se cambió a mano desde Catálogos, no
    // se pisa al volver a correr el seed.
    await knex('npn_productores').insert(p).onConflict('nombre').merge(['npn']);
  }
}
