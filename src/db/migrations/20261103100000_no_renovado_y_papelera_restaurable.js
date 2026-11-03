import { ESTADO_CLIENTE } from '../../modules/clientes/clientes.constants.js';

/**
 * Dos pedidos del usuario del 2026-11-03:
 *
 * 1. "No se pudo renovar" — estado nuevo 'no_renovado' al final del ENUM de
 *    `clientes.estado` (agregar al final no reescribe la tabla; SQL crudo,
 *    mismo motivo que 20260925100000). La observación obligatoria vive en
 *    `historial_estados_cliente.motivo`, igual que el motivo de un rechazo.
 *
 * 2. Papelera restaurable — hasta hoy `eliminarCliente` borraba todo y la
 *    papelera solo guardaba nombre/contacto, así que no había nada que
 *    devolver a venta. Desde ahora guarda en `snapshot` una copia completa
 *    (JSON) de todas las filas del cliente y deja los archivos en disco,
 *    para poder restaurarlo con el MISMO ID. Las filas viejas quedan con
 *    `snapshot` en null: esas solo se pueden devolver como un registro
 *    nuevo que el agente vuelve a llenar.
 *
 *    `estado_previo` se amplía a todos los estados reales: admin puede
 *    borrar en cualquier estado y desde 2026-10-27 existen los de
 *    renovación, que no entraban en el ENUM de 5 valores.
 * @param {import('knex').Knex} knex
 */
const enumSql = (valores) => valores.map((v) => `'${v}'`).join(',');

export async function up(knex) {
  await knex.raw(
    `ALTER TABLE clientes MODIFY estado ENUM(${enumSql(ESTADO_CLIENTE)}) NOT NULL DEFAULT 'borrador'`
  );
  await knex.raw(
    `ALTER TABLE clientes_eliminados MODIFY estado_previo ENUM(${enumSql(ESTADO_CLIENTE)}) NOT NULL`
  );

  await knex.schema.alterTable('clientes_eliminados', (t) => {
    // LONGTEXT y no JSON: se guarda y se lee entero, nunca se consulta por
    // dentro, y así no depende de la versión de MySQL.
    t.specificType('snapshot', 'LONGTEXT').nullable().after('observacion');
    // Quién lo devolvió a venta, a qué agente y con qué ID quedó. Para una
    // fila con snapshot el ID es el mismo de siempre; para una vieja es el
    // del registro nuevo, y queda en null hasta que el agente lo cree.
    t.timestamp('restaurado_at').nullable();
    t.integer('restaurado_por').unsigned().nullable().references('id').inTable('usuarios_sistema');
    t.string('restaurado_por_nombre', 120).nullable();
    t.integer('restaurado_agente_id').unsigned().nullable().references('id').inTable('usuarios_sistema');
    t.string('restaurado_agente_nombre', 120).nullable();
    t.integer('restaurado_cliente_id').unsigned().nullable();
    t.text('restaurado_observacion').nullable();

    t.index(['restaurado_agente_id']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('clientes_eliminados', (t) => {
    t.dropForeign(['restaurado_por']);
    t.dropForeign(['restaurado_agente_id']);
    t.dropIndex(['restaurado_agente_id']);
    t.dropColumn('snapshot');
    t.dropColumn('restaurado_at');
    t.dropColumn('restaurado_por');
    t.dropColumn('restaurado_por_nombre');
    t.dropColumn('restaurado_agente_id');
    t.dropColumn('restaurado_agente_nombre');
    t.dropColumn('restaurado_cliente_id');
    t.dropColumn('restaurado_observacion');
  });

  // Mismo criterio que el down de 20261027100000: nada queda con un estado
  // que deja de existir.
  await knex('clientes').where({ estado: 'no_renovado' }).update({ estado: 'pendiente_renovacion' });
  const anteriores = ESTADO_CLIENTE.filter((e) => e !== 'no_renovado');
  await knex.raw(
    `ALTER TABLE clientes MODIFY estado ENUM(${enumSql(anteriores)}) NOT NULL DEFAULT 'borrador'`
  );
  await knex('clientes_eliminados').where({ estado_previo: 'no_renovado' }).update({ estado_previo: 'pendiente_renovacion' });
  await knex.raw(
    `ALTER TABLE clientes_eliminados MODIFY estado_previo ENUM(${enumSql(anteriores)}) NOT NULL`
  );
}
