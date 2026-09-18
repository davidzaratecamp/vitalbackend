/**
 * Datos de "BaseEstadosy CoberturasVitaldato 2026.xlsx" (compartido por el
 * usuario) — igual que 002_cobertura_zip.js, quedan acá como datos planos,
 * no como dependencia del Excel. Nombres de aseguradora ya normalizados
 * para calzar con el catálogo (ANTHEM/WELLPOINT → Anthem + Wellpoint,
 * FL BLUE → Florida Blue, COMUNITY → Community, etc — el Excel trae
 * variaciones de escritura entre productores).
 */
const COBERTURA_POR_PRODUCTOR = {
  'Luis Vitier': {
    Alabama: ['Ambetter', 'UHC'],
    Arizona: ['Oscar', 'Ambetter', 'UHC', 'Antidote'],
    California: ['Anthem', 'Wellpoint', 'Highmark', 'Kaiser', 'BCBS'],
    'North Carolina': ['Oscar', 'Ambetter', 'UHC', 'CareSource', 'BCBS'],
    'South Carolina': ['Ambetter', 'UHC'],
    Colorado: ['Anthem', 'Wellpoint', 'UHC', 'Kaiser'],
    Florida: ['Oscar', 'Anthem', 'Wellpoint', 'Ambetter', 'UHC', 'Florida Blue', 'AmeriHealth', 'Health First'],
    Georgia: ['Oscar', 'Anthem', 'Wellpoint', 'Ambetter', 'UHC', 'CareSource', 'Kaiser', 'Alliant'],
    Illinois: ['Oscar', 'Ambetter', 'BCBS', 'UHC'],
    Indiana: ['Anthem', 'Wellpoint', 'Ambetter', 'CareSource'],
    Kansas: ['Oscar', 'Ambetter', 'UHC'],
    Michigan: ['Oscar', 'Ambetter', 'CareSource', 'BCBS'],
    Missouri: ['Oscar', 'Anthem', 'Wellpoint', 'Ambetter', 'UHC', 'Medica'],
    Mississippi: ['UHC'],
    Nebraska: ['Oscar', 'Ambetter', 'UHC'],
    'New Jersey': ['Oscar', 'Anthem', 'Wellpoint', 'Ambetter', 'UHC', 'Horizon'],
    Ohio: ['Oscar', 'Anthem', 'Wellpoint', 'Ambetter', 'UHC', 'CareSource', 'Antidote'],
    Oklahoma: ['Oscar', 'Ambetter', 'BCBS', 'UHC', 'Medica', 'Mending Health'],
    Pennsylvania: ['Oscar', 'Anthem', 'Wellpoint', 'Ambetter', 'Highmark', 'Capital BlueCross'],
    Tennessee: ['Oscar', 'Ambetter', 'BCBS', 'UHC'],
    Texas: ['Oscar', 'Anthem', 'Wellpoint', 'Ambetter', 'BCBS', 'UHC', 'Harbor Health', 'Imperial Health', 'Community Health Choice'],
    Virginia: ['Oscar', 'Anthem', 'Wellpoint', 'UHC', 'Sentara', 'Kaiser'],
  },
  'Jessica Trujillo': {
    Texas: ['Molina', 'Ambetter', 'Cigna', 'Oscar'],
    Georgia: ['Ambetter', 'Cigna', 'Oscar'],
    'North Carolina': ['Ambetter', 'Oscar'],
    'South Carolina': ['Molina', 'Ambetter'],
    Florida: ['Molina', 'Ambetter', 'Cigna', 'Oscar'],
    Ohio: ['Molina', 'Ambetter', 'Oscar'],
    Tennessee: ['Ambetter', 'Cigna', 'Oscar'],
    Virginia: ['Oscar'],
    Michigan: ['Molina', 'Ambetter', 'Oscar'],
    Arizona: ['Ambetter', 'Cigna', 'Oscar'],
    Oklahoma: ['Ambetter', 'Oscar'],
    Missouri: ['Ambetter', 'Oscar'],
    Mississippi: ['Molina', 'Ambetter'],
  },
  'Talia Bordon': {
    Texas: ['Molina', 'Ambetter', 'UHC', 'Cigna', 'Oscar'],
    Georgia: ['Ambetter', 'UHC', 'Cigna', 'Oscar', 'CareSource'],
    'North Carolina': ['Ambetter', 'UHC', 'Cigna', 'Oscar'],
    'South Carolina': ['Molina', 'Ambetter', 'Cigna'],
    Florida: ['Molina', 'Ambetter', 'UHC', 'Cigna', 'Oscar'],
  },
  'Samuel Payne': {
    Texas: ['Molina', 'Ambetter', 'UHC', 'Oscar'],
    Georgia: ['Ambetter', 'UHC', 'Oscar', 'CareSource'],
    'North Carolina': ['Ambetter', 'UHC', 'Oscar'],
    'South Carolina': ['Molina', 'Ambetter'],
    Florida: ['Molina', 'Ambetter', 'UHC', 'Oscar'],
  },
};

/** @param {import('knex').Knex} knex */
export async function seed(knex) {
  const productores = await knex('npn_productores').select('id', 'nombre');
  const productorIdPorNombre = new Map(productores.map((p) => [p.nombre, p.id]));

  const aseguradoras = await knex('aseguradoras').select('id', 'nombre');
  const aseguradoraIdPorNombre = new Map(aseguradoras.map((a) => [a.nombre, a.id]));

  // Tabla de referencia completa — se reemplaza entera cada vez que se
  // corre el seed, igual que cobertura_zip.
  await knex('cobertura_productor').del();

  const filas = [];
  for (const [nombreProductor, porEstado] of Object.entries(COBERTURA_POR_PRODUCTOR)) {
    const npn_productor_id = productorIdPorNombre.get(nombreProductor);
    if (!npn_productor_id) {
      console.warn(`⚠ Productor "${nombreProductor}" no se encontró en npn_productores — se omite.`);
      continue;
    }
    for (const [estado, nombresAseguradoras] of Object.entries(porEstado)) {
      for (const nombreAseguradora of nombresAseguradoras) {
        const aseguradora_id = aseguradoraIdPorNombre.get(nombreAseguradora);
        if (!aseguradora_id) {
          console.warn(`⚠ Aseguradora "${nombreAseguradora}" (${nombreProductor}, ${estado}) no se encontró en el catálogo — se omite.`);
          continue;
        }
        filas.push({ npn_productor_id, estado, aseguradora_id });
      }
    }
  }

  if (filas.length) await knex('cobertura_productor').insert(filas);
  console.log(`Cobertura por productor: ${filas.length} filas insertadas (${Object.keys(COBERTURA_POR_PRODUCTOR).length} productores).`);
}
