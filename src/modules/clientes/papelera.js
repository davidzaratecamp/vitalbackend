import { db } from '../../db/knex.js';
import { badRequest, conflict, notFound } from '../../utils/httpError.js';
import { notificar } from '../notificaciones/notificaciones.service.js';

/**
 * Papelera restaurable (2026-11-03, pedido del usuario: "el admin lo ve y no
 * puede volver a enviarlo a venta"). `eliminarCliente` sigue siendo un
 * borrado real — no vale la pena tocar cada consulta de `clientes` para un
 * soft-delete — pero antes de borrar guarda acá una copia completa de todas
 * las filas del cliente, y los archivos se quedan en disco. Con eso admin
 * lo puede devolver a venta con el MISMO ID y todo lleno.
 *
 * Las filas que se eliminaron antes de este cambio no tienen copia
 * (`snapshot` null): solo nombre y contacto. Esas se devuelven como un
 * registro NUEVO que el agente vuelve a llenar (ver `asignarParaRehacer`).
 */

/**
 * Tablas que cuelgan de un cliente, EN ORDEN DE INSERCIÓN (cada una después
 * de aquellas a las que apunta: ingresos → dependientes, historial y
 * soportes de postventa → casos_postventa). `notificaciones` queda afuera a
 * propósito: son avisos viejos de la campana, no datos del caso.
 *
 * Si una migración nueva agrega una tabla con FK a `clientes`, hay que
 * sumarla acá — si no, se pierde al eliminar.
 */
const TABLAS_CLIENTE = [
  'clientes',
  'accesos_tarjeta',
  'dependientes',
  'ingresos',
  'planes_salud',
  'informacion_pago',
  'evidencias',
  'historial_estados_cliente',
  'observaciones',
  'firmas_documentos',
  'soportes_poliza',
  'casos_postventa',
  'historial_casos_postventa',
  'soportes_caso_postventa',
  'historial_cambios_cliente',
];
const TABLAS_POR_CASO = ['historial_casos_postventa', 'soportes_caso_postventa'];

const VERSION_SNAPSHOT = 1;

/** Todas las filas del cliente, tabla por tabla, listas para guardar como JSON. */
export async function armarSnapshot(clienteId, trx = db) {
  const tablas = {};
  for (const tabla of TABLAS_CLIENTE) {
    if (tabla === 'clientes') {
      tablas[tabla] = await trx('clientes').where({ id: clienteId });
    } else if (TABLAS_POR_CASO.includes(tabla)) {
      const casoIds = tablas.casos_postventa.map((c) => c.id);
      tablas[tabla] = casoIds.length ? await trx(tabla).whereIn('caso_postventa_id', casoIds) : [];
    } else {
      tablas[tabla] = await trx(tabla).where({ cliente_id: clienteId });
    }
  }
  return { version: VERSION_SNAPSHOT, tablas };
}

/**
 * Reinserta las filas tal cual, con sus IDs originales. Cada fila se recorta
 * a las columnas que la tabla tiene HOY: si una migración posterior a la
 * eliminación quitó una columna, el INSERT no revienta por eso.
 */
async function reinsertarSnapshot(trx, snapshot) {
  for (const tabla of TABLAS_CLIENTE) {
    const filas = snapshot.tablas[tabla] ?? [];
    if (!filas.length) continue;
    const columnas = new Set(Object.keys(await trx(tabla).columnInfo()));
    const limpias = filas.map((f) => Object.fromEntries(Object.entries(f).filter(([k]) => columnas.has(k))));
    try {
      await trx(tabla).insert(limpias);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw conflict(`No se pudo restaurar: un registro de "${tabla}" choca con uno que ya existe (${err.sqlMessage})`);
      }
      throw err;
    }
  }
}

async function getEliminadoOr404(id) {
  const row = await db('clientes_eliminados').where({ id }).first();
  if (!row) throw notFound('Ese registro no está en la papelera');
  return row;
}

/**
 * Mismo criterio que `reasignarAgente`: agente activo y de la misma empresa
 * que el dueño original — la separación Vital/Vital Asiste aplica igual.
 */
async function getAgenteDestino(agenteId, empresaOriginal) {
  const agente = await db('usuarios_sistema')
    .where({ id: agenteId, role: 'agente' })
    .first('id', 'name', 'empresa_id', 'is_active');
  if (!agente) throw badRequest('El agente elegido no existe o no tiene rol de agente');
  if (!agente.is_active) throw badRequest('Ese agente está desactivado');
  if (empresaOriginal && agente.empresa_id !== empresaOriginal) {
    throw badRequest('El agente tiene que ser de la misma empresa que el dueño original de este registro');
  }
  return agente;
}

/** SSN y correo son únicos — si alguien volvió a registrar al cliente mientras estaba en la papelera, se avisa a quién. */
async function assertSinDuplicado({ social, correo_electronico }) {
  const conflictos = [];
  for (const [campo, valor, etiqueta] of [
    ['social', social, 'Social Security Number'],
    ['correo_electronico', correo_electronico, 'Correo electrónico'],
  ]) {
    if (!valor) continue;
    const row = await db('clientes').where({ [campo]: valor }).first('id', 'nombres', 'apellidos');
    if (row) conflictos.push(`${etiqueta}: ya lo tiene ${row.nombres} ${row.apellidos} (ID ${row.id})`);
  }
  if (conflictos.length) {
    throw conflict('Este cliente ya se volvió a registrar después de eliminarse — revisa ese ID antes de restaurar', conflictos);
  }
}

/**
 * Admin devuelve un registro de la papelera a venta y elige a qué agente.
 *
 * - Con copia completa: vuelve con el MISMO ID, todos los pasos llenos y los
 *   mismos archivos, como 'borrador' del agente elegido — de ahí sigue el
 *   flujo normal de venta (finalizar → BackOffice).
 * - Sin copia (eliminados antes del 2026-11-03): no hay con qué armar el
 *   registro, así que queda asignado al agente, que lo ve en "Nuevo
 *   registro" con nombre, SSN, correo y teléfono ya puestos.
 */
export async function restaurarDesdePapelera(eliminadoId, { agenteId, observacion, admin }) {
  const row = await getEliminadoOr404(eliminadoId);
  if (row.restaurado_at) {
    throw conflict(`Este registro ya se devolvió a venta el ${row.restaurado_at} (agente: ${row.restaurado_agente_nombre})`);
  }
  const agente = await getAgenteDestino(agenteId, row.empresa_id);
  await assertSinDuplicado(row);

  const marca = {
    restaurado_at: db.fn.now(),
    restaurado_por: admin.id,
    restaurado_por_nombre: admin.name,
    restaurado_agente_id: agente.id,
    restaurado_agente_nombre: agente.name,
    restaurado_observacion: observacion,
  };

  if (!row.snapshot) {
    await db('clientes_eliminados').where({ id: row.id }).update(marca);
    await notificar(agente.id, {
      tipo: 'papelera_rehacer',
      clienteId: null,
      mensaje: `Un admin te asignó a ${row.nombres} ${row.apellidos} (ID eliminado ${row.cliente_id_original}) para volver a registrarlo — lo encuentras en "Nuevo registro".`,
    });
    return { modo: 'rehacer', cliente_id: null };
  }

  const snapshot = JSON.parse(row.snapshot);
  const clienteId = row.cliente_id_original;
  if (await db('clientes').where({ id: clienteId }).first('id')) {
    throw conflict(`El ID ${clienteId} ya está ocupado por otro registro — no se puede restaurar con el mismo ID`);
  }

  const texto = `[Papelera] Restaurado por ${admin.name} y devuelto a venta con ${agente.name}${observacion ? ` — ${observacion}` : ''}.`;
  await db.transaction(async (trx) => {
    await reinsertarSnapshot(trx, snapshot);
    // Vuelve a empezar como venta: borrador del agente elegido. La temporada
    // de renovación se limpia — si se aprueba, entra a la que le toque por
    // su fecha de aprobación nueva, como cualquier venta.
    await trx('clientes').where({ id: clienteId }).update({
      estado: 'borrador',
      agente_id: agente.id,
      submitted_at: null,
      renovacion_anio: null,
      renovacion_iniciada_at: null,
      updated_at: trx.fn.now(),
    });
    await trx('historial_estados_cliente').insert({
      cliente_id: clienteId,
      estado_anterior: row.estado_previo,
      estado_nuevo: 'borrador',
      cambiado_por: admin.id,
      motivo: texto,
    });
    await trx('clientes_eliminados')
      .where({ id: row.id })
      .update({ ...marca, restaurado_at: trx.fn.now(), restaurado_cliente_id: clienteId });
  });

  await notificar(agente.id, {
    tipo: 'papelera_restaurado',
    clienteId,
    mensaje: `Un admin te devolvió a ${row.nombres} ${row.apellidos} (ID ${clienteId}) desde la papelera — quedó en borrador con todo lo que tenía.`,
  });
  return { modo: 'restaurado', cliente_id: clienteId };
}

/** Los registros sin copia que admin le asignó a este agente y todavía no rehízo. */
export function pendientesDeRehacer(agenteId) {
  return db('clientes_eliminados')
    .where({ restaurado_agente_id: agenteId })
    .whereNotNull('restaurado_at')
    .whereNull('restaurado_cliente_id')
    .orderBy('restaurado_at', 'desc')
    .select(
      'id',
      'cliente_id_original',
      'nombres',
      'apellidos',
      'social',
      'correo_electronico',
      'phone_1',
      'restaurado_por_nombre',
      'restaurado_observacion',
      'restaurado_at'
    );
}

/**
 * Valida que el agente pueda rehacer ESE registro de la papelera — se llama
 * antes de crear el cliente nuevo, para no crearlo y después fallar.
 */
export async function assertPuedeRehacer(eliminadoId, agenteId) {
  const row = await getEliminadoOr404(eliminadoId);
  if (row.restaurado_agente_id !== agenteId || !row.restaurado_at) {
    throw badRequest('Ese registro de la papelera no está asignado a ti');
  }
  if (row.restaurado_cliente_id) {
    throw conflict(`Ese registro ya se volvió a crear (ID ${row.restaurado_cliente_id})`);
  }
  return row;
}

/** Deja enlazado el registro nuevo con la fila de la papelera de la que salió. */
export async function marcarRehecho(eliminadoId, clienteId) {
  await db('clientes_eliminados').where({ id: eliminadoId }).update({ restaurado_cliente_id: clienteId });
}
