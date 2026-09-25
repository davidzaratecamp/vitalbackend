/**
 * "Papelera" (2026-09-26, pedido del usuario) — desde que se dejó eliminar
 * borradores/rechazados (2026-09-24), esos registros desaparecían del
 * todo, sin dejar rastro de qué se borró ni quién lo hizo. `eliminarCliente`
 * sigue siendo un borrado real (no soft-delete: no vale la pena tocar cada
 * consulta de `clientes` en todo el sistema para filtrar uno nuevo) — antes
 * de borrar, deja una foto de los datos básicos acá, para que admin pueda
 * verlos con filtros. No es "restaurar" el registro completo (dependientes,
 * evidencias, etc. sí se pierden), es un registro de auditoría de qué
 * cliente existió y quién lo eliminó.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('clientes_eliminados', (t) => {
    t.increments('id').primary();
    // El id que tenía en `clientes` — no es FK (la fila original ya no
    // existe para cuando se lee la papelera).
    t.integer('cliente_id_original').unsigned().notNullable();
    t.string('nombres', 120).notNullable();
    t.string('apellidos', 120).notNullable();
    t.string('social', 20).nullable();
    t.string('correo_electronico', 190).nullable();
    t.string('phone_1', 20).nullable();
    t.enu('estado_previo', ['borrador', 'rechazado_backoffice']).notNullable();
    t.integer('agente_id').unsigned().notNullable().references('id').inTable('usuarios_sistema');
    t.string('agente_nombre', 120).notNullable();
    t.integer('empresa_id').unsigned().nullable().references('id').inTable('empresas');
    t.integer('eliminado_por').unsigned().notNullable().references('id').inTable('usuarios_sistema');
    t.string('eliminado_por_nombre', 120).notNullable();
    t.enu('eliminado_por_rol', ['agente', 'supervisor', 'admin']).notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['empresa_id']);
    t.index(['agente_id']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('clientes_eliminados');
}
