import {
  ESTATUS_MIGRATORIO_DB,
  ESTATUS_MIGRATORIO_HISTORICOS,
} from '../../modules/clientes/clientes.constants.js';

/**
 * Catálogo de estatus migratorio (2026-10-22, pedido del usuario):
 * sale 'PAROLE HUMANITARIO' del formulario y entran
 * 'I-797 (PROCESO PERMISO DE TRABAJO)' e 'I-797 (PROCESO RESIDENCIA)'.
 *
 * `estatus_migratorio` es un ENUM real de MySQL en dos tablas (`clientes` y
 * `dependientes` — el cónyuge es una fila de `dependientes`), así que un
 * valor nuevo en el array de JS no alcanza: sin este ALTER los inserts
 * fallan con "Data truncated for column 'estatus_migratorio'" (mismo caso
 * que 20261001100000_dos_tipos_caso_postventa.js).
 *
 * 'PAROLE HUMANITARIO' se queda en el ENUM a propósito aunque ya no se pueda
 * elegir: hay 1 cliente real en producción guardado con ese valor y
 * estrechar el ENUM lo truncaría a ''. Ver ESTATUS_MIGRATORIO_HISTORICOS.
 * @param {import('knex').Knex} knex
 */
const enumSql = (valores) => valores.map((v) => `'${v}'`).join(', ');

const TABLAS = ['clientes', 'dependientes'];

export async function up(knex) {
  for (const tabla of TABLAS) {
    await knex.raw(
      `ALTER TABLE ${tabla} MODIFY estatus_migratorio ENUM(${enumSql(ESTATUS_MIGRATORIO_DB)}) NOT NULL`
    );
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Catálogo tal como estaba antes de esta migración: sin los dos I-797 y
  // con 'PAROLE HUMANITARIO' en su posición original.
  const anterior = [
    'RESIDENTE',
    'CIUDADANO',
    'PERMISO DE TRABAJO',
    'PASAPORTE',
    'VISA DE TRABAJO',
    'ASILO/REFUGIADO',
    'ASILO/POLITICO',
    ...ESTATUS_MIGRATORIO_HISTORICOS,
    'TPS',
    'GREEN CARD',
    'I-220A',
  ];
  for (const tabla of TABLAS) {
    await knex.raw(
      `ALTER TABLE ${tabla} MODIFY estatus_migratorio ENUM(${enumSql(anterior)}) NOT NULL`
    );
  }
}
