/**
 * Dos tipos de caso nuevos en el catálogo de postventa (2026-10-01, pedido
 * del usuario): "Notificación y paquete de bienvenida" (responsable:
 * agente) y "Gestión 1er pago" (responsable: backoffice) — ver
 * TIPO_CASO_POSTVENTA en casosPostventa.constants.js. `tipo_caso` en
 * `casos_postventa` es un ENUM real a nivel de MySQL (no solo validación de
 * Zod), así que agregar un valor al catálogo en JS sin esto revienta el
 * insert con "Data truncated for column 'tipo_caso'".
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE casos_postventa MODIFY tipo_caso ENUM(
      'validacion_cobertura',
      'tarjetas_fisicas',
      'gestion_pagos',
      'creacion_cuenta',
      'asignacion_citas',
      'asignacion_doctor',
      'aclaracion_factura',
      'notificacion_bienvenida',
      'cambio_vida',
      'solicitud_cancelacion',
      'solicitud_apelacion',
      'cambio_agente_aor',
      'cliente_no_aparece_broker',
      'autorizacion_poliza',
      'gestion_primer_pago'
    ) NOT NULL
  `);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Antes de angostar el ENUM, cualquier caso con uno de los 2 tipos nuevos
  // se recorta al tipo más parecido de los 13 originales, para no perder el
  // rollback por un dato que ya no cabe.
  await knex('casos_postventa').where({ tipo_caso: 'notificacion_bienvenida' }).update({ tipo_caso: 'creacion_cuenta' });
  await knex('casos_postventa').where({ tipo_caso: 'gestion_primer_pago' }).update({ tipo_caso: 'gestion_pagos' });
  await knex.raw(`
    ALTER TABLE casos_postventa MODIFY tipo_caso ENUM(
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
      'autorizacion_poliza'
    ) NOT NULL
  `);
}
