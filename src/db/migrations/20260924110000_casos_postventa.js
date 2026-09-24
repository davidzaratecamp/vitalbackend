/**
 * Módulo de postventa (2026-09-24) — llamadas de Customer Service sobre
 * clientes YA APROBADOS. `casos_postventa.id` es el "número de caso" que
 * pide el usuario, distinto del ID del cliente pero enlazado a él
 * (`cliente_id`). Un mismo cliente puede tener varios casos a lo largo del
 * tiempo (uno por llamada) — por eso es una tabla aparte, no una columna en
 * `clientes`.
 *
 * `tipo_caso`: los 13 valores de "Listado Casos Postventa Vital 2026.xlsx"
 * (compartido por el usuario) — 7 de Customer Service, 6 de BackOffice (ver
 * casosPostventa.constants.js para el texto completo/responsable de cada
 * uno). `tipo_gestion` es una clasificación aparte que elige quien gestiona
 * el caso (Reclamación/Cancelación/Gestión habitual → naranja/rojo/verde en
 * el frontend), no se pide al crear el caso.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('casos_postventa', (t) => {
    t.increments('id').primary();
    t.integer('cliente_id').unsigned().notNullable().references('id').inTable('clientes').onDelete('CASCADE');
    t.enu('tipo_caso', [
      'validacion_cobertura',
      'tarjetas_fisicas',
      'gestion_pagos',
      'creacion_cuenta',
      'asignacion_citas',
      'asignacion_doctor',
      'aclaracion_factura',
      'cambio_vida',
      'solicitud_cancelacion',
      'solicitud_apelacion',
      'cambio_agente_aor',
      'cliente_no_aparece_broker',
      'autorizacion_poliza',
    ]).notNullable();
    t.enu('tipo_gestion', ['reclamacion', 'cancelacion', 'gestion_habitual']).nullable();
    t.enu('estado', ['nuevo', 'seguimiento', 'cerrado', 'escalado_backoffice']).notNullable().defaultTo('nuevo');
    t.string('telefono_contacto', 20).notNullable();
    t.text('observacion_inicial').nullable();
    t.integer('creado_por').unsigned().notNullable().references('id').inTable('usuarios_sistema');
    t.integer('gestionado_por').unsigned().nullable().references('id').inTable('usuarios_sistema');
    t.timestamp('cerrado_at').nullable();
    t.timestamps(true, true);

    t.index(['cliente_id']);
    t.index(['estado']);
  });

  await knex.schema.createTable('historial_casos_postventa', (t) => {
    t.increments('id').primary();
    t.integer('caso_postventa_id').unsigned().notNullable().references('id').inTable('casos_postventa').onDelete('CASCADE');
    t.string('estado_anterior', 40).nullable();
    t.string('estado_nuevo', 40).notNullable();
    t.integer('cambiado_por').unsigned().notNullable().references('id').inTable('usuarios_sistema');
    t.string('motivo', 500).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['caso_postventa_id']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('historial_casos_postventa');
  await knex.schema.dropTableIfExists('casos_postventa');
}
