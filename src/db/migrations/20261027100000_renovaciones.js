import { ESTADO_CLIENTE } from '../../modules/clientes/clientes.constants.js';

/**
 * Apartado "Renovaciones" (2026-10-27, pedido del usuario). Cada 1 de
 * noviembre toda póliza vigente vuelve a manos del agente para renovarla,
 * CON EL MISMO ID: no se crea un registro nuevo, la venta cambia de estado.
 *
 * Esta migración trae tres cosas:
 *
 * 1. Los 5 estados nuevos en el ENUM `clientes.estado`. Van al final del
 *    ENUM a propósito (agregar al final no reescribe la tabla). ALTER con
 *    SQL crudo, mismo motivo que 20260925100000: knex no agrega valores a
 *    un ENUM de MySQL de forma confiable.
 *
 * 2. Dos columnas de temporada en `clientes`:
 *    - `renovacion_anio`: el año de la temporada (el del 1 de noviembre) en
 *      que esta póliza entró a renovación por última vez. Es lo que hace
 *      que el proceso diario sea idempotente — puede correr mil veces el
 *      mismo día sin volver a mover nada — y lo que permite que una póliza
 *      ya 'renovado' vuelva a entrar en la temporada del año siguiente.
 *    - `renovacion_iniciada_at`: cuándo entró. Se usa para dos reglas:
 *      la carta CMS tiene que ser POSTERIOR a esa fecha (una renovación
 *      exige firma nueva, no sirve la de la venta original) y las
 *      evidencias anteriores a esa fecha no se pueden borrar.
 *
 * 3. `historial_cambios_cliente`: qué campo se tocó, con qué valor entró y
 *    con cuál quedó. `historial_estados_cliente` solo guarda transiciones
 *    de estado; acá hacía falta el detalle porque en una renovación el
 *    agente corrige datos sobre un formulario ya lleno y tiene que quedar
 *    la huella de qué cambió. Sirve igual para ventas y postventa (ver
 *    `contexto`).
 * @param {import('knex').Knex} knex
 */
const enumSql = (valores) => valores.map((v) => `'${v}'`).join(',');

export async function up(knex) {
  await knex.raw(
    `ALTER TABLE clientes MODIFY estado ENUM(${enumSql(ESTADO_CLIENTE)}) NOT NULL DEFAULT 'borrador'`
  );

  await knex.schema.alterTable('clientes', (t) => {
    t.integer('renovacion_anio')
      .unsigned()
      .nullable()
      .comment('Año de la temporada (1 de noviembre) en que entró a renovación por última vez');
    t.timestamp('renovacion_iniciada_at')
      .nullable()
      .comment('Cuándo entró a la temporada de renovación actual');
    t.index(['renovacion_anio']);
  });

  // El plan que se cotiza/confirma durante una renovación es una versión
  // más de `planes_salud` (misma mecánica de is_current), pero con su
  // propio origen para poder distinguirla en el historial del plan.
  await knex.raw(
    "ALTER TABLE planes_salud MODIFY version_origen ENUM('cotizado_agente','confirmado_backoffice','renovacion_agente','confirmado_backoffice_renovacion') NOT NULL"
  );

  await knex.schema.createTable('historial_cambios_cliente', (t) => {
    t.increments('id').primary();
    t.integer('cliente_id').unsigned().notNullable().references('id').inTable('clientes').onDelete('CASCADE');
    // Qué parte del formulario: titular, conyuge, dependiente, ingresos,
    // plan_salud, pago. Texto y no ENUM — si mañana aparece otro paso, no
    // hace falta un ALTER.
    t.string('seccion', 40).notNullable();
    // Id de la fila concreta cuando la sección tiene varias (qué
    // dependiente, qué ingreso). Null para las secciones de una sola fila.
    t.integer('referencia_id').unsigned().nullable();
    t.string('campo', 60).notNullable();
    // Los valores van como texto plano para poder mostrarlos tal cual.
    // NUNCA entran acá el número de tarjeta, el Data Point ni la respuesta
    // de seguridad — de esos solo se registra QUE cambiaron, con los
    // valores en null (ver CAMPOS_SIN_VALOR en historialCambios.js).
    t.text('valor_anterior').nullable();
    t.text('valor_nuevo').nullable();
    // En qué momento de la vida del registro se hizo el cambio:
    // 'venta' | 'renovacion' | 'postventa'. Se deduce del estado del
    // cliente al momento de guardar.
    t.string('contexto', 20).notNullable().defaultTo('venta');
    t.integer('cambiado_por').unsigned().notNullable().references('id').inTable('usuarios_sistema');
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['cliente_id']);
    t.index(['cliente_id', 'contexto']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('historial_cambios_cliente');

  await knex('planes_salud')
    .whereIn('version_origen', ['renovacion_agente', 'confirmado_backoffice_renovacion'])
    .update({ version_origen: 'confirmado_backoffice' });
  await knex.raw(
    "ALTER TABLE planes_salud MODIFY version_origen ENUM('cotizado_agente','confirmado_backoffice') NOT NULL"
  );

  await knex.schema.alterTable('clientes', (t) => {
    t.dropIndex(['renovacion_anio']);
    t.dropColumn('renovacion_anio');
    t.dropColumn('renovacion_iniciada_at');
  });

  // Cualquier póliza que esté en un estado de renovación vuelve a
  // 'aprobado' antes de quitar los valores del ENUM — así el down nunca
  // falla ni deja filas con un estado que dejó de existir.
  await knex('clientes')
    .whereIn('estado', [
      'pendiente_renovacion',
      'pendiente_backoffice_renovacion',
      'pendiente_autorizacion_renovacion',
      'rechazado_backoffice_renovacion',
      'renovado',
    ])
    .update({ estado: 'aprobado' });
  await knex.raw(
    "ALTER TABLE clientes MODIFY estado ENUM('borrador','pendiente_backoffice','pendiente_llamada_tripartita','aprobado','rechazado_backoffice') NOT NULL DEFAULT 'borrador'"
  );
}
