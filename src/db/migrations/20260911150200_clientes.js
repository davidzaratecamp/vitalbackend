import {
  ESTADO_CLIENTE,
  SEXO,
  ESTATUS_MIGRATORIO,
  ORIGEN_VENTA,
} from '../../modules/clientes/clientes.constants.js';

/**
 * El titular del registro (se llamaba "usuarios" en el CRM original — acá
 * "clientes" para no confundirlo con las cuentas de login). `estado` es un
 * ENUM real de 4 valores (antes era un VARCHAR libre con ~10 valores por
 * convención, incluido uno con espacio: 'Pendiente por digitar').
 * `origen_venta` corrige el typo del original ("Leard" → "lead").
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('clientes', (t) => {
    t.increments('id').primary();
    t.integer('agente_id').unsigned().notNullable().references('id').inTable('usuarios_sistema');
    t.enu('estado', ESTADO_CLIENTE).notNullable().defaultTo('borrador');

    t.boolean('solicita_cobertura').notNullable().defaultTo(false);
    t.string('nombres', 120).notNullable();
    t.string('apellidos', 120).notNullable();
    t.enu('sexo', SEXO).notNullable();
    t.date('fecha_nacimiento').notNullable();
    t.string('social', 9).notNullable().unique().comment('SSN, solo dígitos');
    t.enu('estatus_migratorio', ESTATUS_MIGRATORIO).notNullable();

    t.string('direccion', 200).notNullable();
    t.string('tipo_vivienda', 60).nullable();
    t.string('estado_us', 60).notNullable().comment('estado de EE. UU., no el estado del registro');
    t.string('condado', 80).notNullable();
    t.string('ciudad', 80).notNullable();
    t.string('codigo_postal', 5).notNullable();

    t.string('correo_electronico', 190).notNullable().unique();
    t.string('phone_1', 20).notNullable();
    t.string('phone_2', 20).nullable();
    t.string('whatsapp', 20).nullable();
    t.string('contacto_emergencia_nombre', 120).nullable();
    t.string('contacto_emergencia_telefono', 20).nullable();
    t.string('contacto_emergencia_email', 190).nullable();

    t.enu('origen_venta', ORIGEN_VENTA).notNullable();
    t.string('pregunta_seguridad', 160).nullable();
    t.string('respuesta_seguridad_hash', 255).nullable();

    t.timestamp('submitted_at').nullable().comment('cuando el agente presiona Finalizar');
    t.timestamps(true, true);

    t.index(['agente_id']);
    t.index(['estado']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('clientes');
}
