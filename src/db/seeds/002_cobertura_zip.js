/**
 * Datos de "Base Estados y Coberturas Vital 2026.xlsx" (compartido por el
 * usuario) — quedan acá como datos planos, no como dependencia del propio
 * Excel, para que correr `npm run seed` no necesite ese archivo a mano.
 *
 * Cada fila del Excel traía las aseguradoras de un estado en un solo texto
 * separado por guiones (p. ej. "OSCAR - AMBETTER - UHC"); ya vienen
 * separadas acá en un arreglo.
 */
const COBERTURA = [
  { estado: 'Alabama', desde: 35004, hasta: 36925, aseguradoras: ['Ambetter', 'UHC'] },
  { estado: 'Arizona', desde: 85001, hasta: 86556, aseguradoras: ['Oscar', 'Ambetter', 'UHC', 'Antidote'] },
  { estado: 'California', desde: 90001, hasta: 96162, aseguradoras: ['Anthem', 'Wellpoint', 'Highmark', 'Kaiser', 'BCBS'] },
  { estado: 'Carolina del Norte', desde: 27006, hasta: 28909, aseguradoras: ['Oscar', 'Ambetter', 'UHC', 'CareSource', 'BCBS'] },
  { estado: 'Carolina del Sur', desde: 29001, hasta: 29945, aseguradoras: ['Ambetter', 'UHC'] },
  { estado: 'Colorado', desde: 80001, hasta: 81658, aseguradoras: ['Anthem', 'Wellpoint', 'UHC', 'Kaiser'] },
  { estado: 'Florida', desde: 32003, hasta: 34997, aseguradoras: ['Oscar', 'Anthem', 'Wellpoint', 'Ambetter', 'UHC', 'Florida Blue', 'AmeriHealth', 'Health First'] },
  { estado: 'Georgia', desde: 30002, hasta: 39901, aseguradoras: ['Oscar', 'Anthem', 'Wellpoint', 'Ambetter', 'UHC', 'CareSource', 'Kaiser', 'Alliant'] },
  { estado: 'Illinois', desde: 60001, hasta: 62999, aseguradoras: ['Oscar', 'Ambetter', 'BCBS', 'UHC'] },
  { estado: 'Indiana', desde: 46001, hasta: 47997, aseguradoras: ['Anthem', 'Wellpoint', 'Ambetter', 'CareSource'] },
  { estado: 'Kansas', desde: 66002, hasta: 67954, aseguradoras: ['Oscar', 'Ambetter', 'UHC'] },
  { estado: 'Michigan', desde: 48001, hasta: 49971, aseguradoras: ['Oscar', 'Ambetter', 'CareSource', 'BCBS'] },
  { estado: 'Missouri', desde: 63001, hasta: 65899, aseguradoras: ['Oscar', 'Anthem', 'Wellpoint', 'Ambetter', 'UHC', 'Medica'] },
  { estado: 'Mississippi', desde: 38601, hasta: 39776, aseguradoras: ['UHC'] },
  { estado: 'Nebraska', desde: 68001, hasta: 69367, aseguradoras: ['Oscar', 'Ambetter', 'UHC'] },
  { estado: 'New Jersey', desde: 7001, hasta: 8989, aseguradoras: ['Oscar', 'Anthem', 'Wellpoint', 'Ambetter', 'UHC', 'Horizon'] },
  { estado: 'Ohio', desde: 43001, hasta: 45999, aseguradoras: ['Oscar', 'Anthem', 'Wellpoint', 'Ambetter', 'UHC', 'CareSource', 'Antidote'] },
  { estado: 'Oklahoma', desde: 73001, hasta: 74966, aseguradoras: ['Oscar', 'Ambetter', 'BCBS', 'UHC', 'Medica', 'Mending Health'] },
  { estado: 'Pennsylvania', desde: 15001, hasta: 19640, aseguradoras: ['Oscar', 'Anthem', 'Wellpoint', 'Ambetter', 'Highmark', 'Capital BlueCross'] },
  { estado: 'Tennessee', desde: 37010, hasta: 38589, aseguradoras: ['Oscar', 'Ambetter', 'BCBS', 'UHC'] },
  { estado: 'Texas', desde: 73301, hasta: 88595, aseguradoras: ['Oscar', 'Anthem', 'Wellpoint', 'Ambetter', 'BCBS', 'UHC', 'Harbor Health', 'Imperial Health', 'Community Health Choice'] },
  { estado: 'Virginia', desde: 20101, hasta: 24658, aseguradoras: ['Oscar', 'Anthem', 'Wellpoint', 'UHC', 'Sentara', 'Kaiser'] },
];

// Aseguradoras nuevas que trae este Excel y no estaban en el catálogo
// original — las 12 de siempre (Aetna, Ambetter, Anthem, Blue Cross, Blue
// Shield, Cigna, Molina, Oscar, United, Wellpoint, Horizon, Kaiser) quedan
// intactas, sin tocar.
const NUEVAS_ASEGURADORAS = [
  'UHC',
  'BCBS',
  'Antidote',
  'Highmark',
  'Florida Blue',
  'AmeriHealth',
  'Health First',
  'CareSource',
  'Alliant',
  'Medica',
  'Capital BlueCross',
  'Sentara',
  'Harbor Health',
  'Imperial Health',
  'Community Health Choice',
  'Mending Health',
];

/** @param {import('knex').Knex} knex */
export async function seed(knex) {
  for (const nombre of NUEVAS_ASEGURADORAS) {
    await knex('aseguradoras').insert({ nombre }).onConflict('nombre').ignore();
  }

  const aseguradoras = await knex('aseguradoras').select('id', 'nombre');
  const idPorNombre = new Map(aseguradoras.map((a) => [a.nombre, a.id]));

  // Tabla de referencia completa — se reemplaza entera cada vez que se
  // corre el seed, no se va acumulando.
  await knex('cobertura_zip').del();

  const filas = [];
  for (const fila of COBERTURA) {
    for (const nombreAseguradora of fila.aseguradoras) {
      const aseguradora_id = idPorNombre.get(nombreAseguradora);
      if (!aseguradora_id) {
        console.warn(`⚠ Aseguradora "${nombreAseguradora}" (${fila.estado}) no se encontró en el catálogo — se omite.`);
        continue;
      }
      filas.push({ estado: fila.estado, zip_desde: fila.desde, zip_hasta: fila.hasta, aseguradora_id });
    }
  }
  await knex('cobertura_zip').insert(filas);
  console.log(`Cobertura por ZIP: ${filas.length} filas insertadas (${COBERTURA.length} estados).`);
}
