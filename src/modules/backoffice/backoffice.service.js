import { db } from '../../db/knex.js';
import { badRequest, conflict, forbidden } from '../../utils/httpError.js';
import { getClienteOr404, logEstado, setPlanSalud, getPlanSaludActual } from '../clientes/clientes.service.js';
import { notificar } from '../notificaciones/notificaciones.service.js';

const PENDIENTE = 'pendiente_backoffice';
const PENDIENTE_TRIPARTITA = 'pendiente_llamada_tripartita';

/**
 * Qué hace cada acción de BackOffice según de DÓNDE venga el caso.
 *
 * Es la misma mesa de trabajo para ventas y para renovaciones (2026-10-27,
 * pedido del usuario: "en los rechazos debe seguir exactamente el mismo
 * flujo que ya usa en los rechazos de ventas") — no hay endpoints ni
 * pantallas duplicadas, solo cambia el estado destino:
 *
 *   venta      pendiente_backoffice → aprobado / rechazado_backoffice
 *                                   → pendiente_llamada_tripartita
 *   renovación pendiente_backoffice_renovacion → renovado /
 *                                   rechazado_backoffice_renovacion
 *                                   → pendiente_autorizacion_renovacion
 *
 * `intermedio` es la parada opcional de "ya lo gestioné pero me falta algo"
 * (la llamada tripartita en ventas, la autorización en renovaciones);
 * desde esa parada ya no hay otra, por eso queda en null.
 */
const DESTINOS = {
  [PENDIENTE]: {
    aprobado: 'aprobado',
    rechazado: 'rechazado_backoffice',
    intermedio: PENDIENTE_TRIPARTITA,
    versionPlan: 'confirmado_backoffice',
  },
  [PENDIENTE_TRIPARTITA]: {
    aprobado: 'aprobado',
    rechazado: 'rechazado_backoffice',
    intermedio: null,
    versionPlan: 'confirmado_backoffice',
  },
  pendiente_backoffice_renovacion: {
    aprobado: 'renovado',
    rechazado: 'rechazado_backoffice_renovacion',
    intermedio: 'pendiente_autorizacion_renovacion',
    versionPlan: 'confirmado_backoffice_renovacion',
  },
  pendiente_autorizacion_renovacion: {
    aprobado: 'renovado',
    rechazado: 'rechazado_backoffice_renovacion',
    intermedio: null,
    versionPlan: 'confirmado_backoffice_renovacion',
  },
};

/**
 * Resuelve a dónde va este caso, o corta si BackOffice no lo tiene en sus
 * manos. El mensaje distingue los dos mundos para que no desoriente.
 */
function destinoDe(cliente) {
  const destino = DESTINOS[cliente.estado];
  if (!destino) {
    throw conflict(
      cliente.estado?.endsWith('_renovacion') || cliente.estado === 'pendiente_renovacion'
        ? 'Esta renovación no está pendiente de BackOffice'
        : 'Este cliente no está pendiente de BackOffice'
    );
  }
  return destino;
}

/** true si el caso viene del flujo de renovaciones y no del de ventas. */
const esRenovacion = (estado) => estado in DESTINOS && DESTINOS[estado].aprobado === 'renovado';

/**
 * Un backoffice solo ve/gestiona clientes de agentes de SU MISMA empresa
 * (Vital absorbió a la extinta Asiste Health Care — "Vital Asiste" — pero
 * ambos lados quedan separados entre sí; ver migración 20260919120000). Se
 * usa tanto para la cola (listarCola) como para completar/rechazar, así un
 * backoffice no puede gestionar por API directa un cliente que no vería en
 * su propia cola.
 */
async function assertMismaEmpresa(cliente, empresaId) {
  if (!empresaId) throw forbidden('Tu cuenta no tiene una empresa asignada — pídele a un admin que la configure');
  const agente = await db('usuarios_sistema').where({ id: cliente.agente_id }).first('empresa_id');
  if (!agente || agente.empresa_id !== empresaId) throw forbidden('Este cliente pertenece a otra empresa');
}

export async function listarCola(filters = {}, empresaId) {
  const estado = filters.estado || PENDIENTE;
  // Mismo campo que ya se muestra en cada vista: cuándo entró a la cola
  // (pendiente) o cuándo se resolvió (completados/rechazados) — el rango de
  // fechas filtra por ese.
  const campoFecha = estado === PENDIENTE ? 'c.submitted_at' : 'c.updated_at';
  const q = db('clientes as c')
    .leftJoin('usuarios_sistema as ag', 'ag.id', 'c.agente_id')
    .select(
      'c.id',
      'c.nombres',
      'c.apellidos',
      'c.correo_electronico',
      'c.phone_1',
      'c.estado',
      'c.submitted_at',
      'c.updated_at',
      'ag.name as agente_nombre'
    )
    .where('c.estado', estado)
    // La cola de pendientes es FIFO (el más antiguo primero); las vistas de
    // completados/rechazados son un historial, así que muestran lo más
    // reciente primero.
    .orderBy(campoFecha, estado === PENDIENTE ? 'asc' : 'desc')
    .limit(200);

  if (empresaId) q.andWhere('ag.empresa_id', empresaId);
  if (filters.agenteId) q.andWhere('c.agente_id', filters.agenteId);
  if (filters.desde) q.andWhere(campoFecha, '>=', filters.desde);
  if (filters.hasta) q.andWhere(campoFecha, '<=', `${filters.hasta} 23:59:59`);
  if (filters.q) {
    const like = `%${filters.q}%`;
    // El ID también cuenta como búsqueda — a pedido del usuario
    // (2026-09-24), exacto (no "like") para no confundir el 1 con el 11.
    const comoId = Number.isInteger(Number(filters.q)) ? Number(filters.q) : null;
    q.andWhere((b) => {
      b.where('c.nombres', 'like', like)
        .orWhere('c.apellidos', 'like', like)
        .orWhere('c.correo_electronico', 'like', like)
        .orWhere('c.social', 'like', like)
        .orWhere('c.phone_1', 'like', like);
      if (comoId !== null) b.orWhere('c.id', comoId);
    });
  }
  return q;
}

/**
 * Cierra la venta: confirma los 6 campos de póliza (aseguradora, plan, deducible,
 * gasto máximo, NPN, estado de la prima) sobre la MISMA tabla `planes_salud` que
 * cotizó el agente (nueva versión `confirmado_backoffice`) — a diferencia del
 * original, que los guardaba sueltos en `usuarios` y permitía "Completar" sin que
 * ninguno estuviera lleno. Acá se valida el server-side antes de aprobar.
 */
export async function completar(clienteId, userId, data, empresaId) {
  const cliente = await getClienteOr404(clienteId);
  await assertMismaEmpresa(cliente, empresaId);
  const destino = destinoDe(cliente);

  const planActual = await getPlanSaludActual(clienteId);
  if (!planActual) throw badRequest('El cliente no tiene un plan de salud cotizado por el agente');

  const faltantes = [];
  if (!data.aseguradora_id) faltantes.push('Aseguradora');
  if (!data.estado_prima) faltantes.push('Estado de la prima');
  if (!data.nombre_plan) faltantes.push('Nombre del plan');
  if (data.deducible === undefined || data.deducible === null) faltantes.push('Deducible');
  if (data.gasto_max_bolsillo === undefined || data.gasto_max_bolsillo === null) {
    faltantes.push('Gasto máximo de bolsillo');
  }
  if (!data.npn) faltantes.push('NPN');
  if (faltantes.length) {
    throw badRequest(
      destino.aprobado === 'renovado'
        ? 'Completa los datos de póliza antes de cerrar la renovación'
        : 'Completa los datos de póliza antes de cerrar la venta',
      faltantes
    );
  }

  await setPlanSalud(
    clienteId,
    {
      aseguradora_id: data.aseguradora_id,
      nombre_plan: data.nombre_plan,
      tipo_metal: planActual.tipo_metal,
      tipo_red: planActual.tipo_red,
      deducible: data.deducible,
      gasto_max_bolsillo: data.gasto_max_bolsillo,
      valor_prima: planActual.valor_prima,
      pd: planActual.pd,
      sd: planActual.sd,
      gd: planActual.gd,
      npn_productor_id: planActual.npn_productor_id,
      npn: data.npn,
      estado_prima: data.estado_prima,
    },
    userId,
    destino.versionPlan
  );

  await db('clientes').where({ id: clienteId }).update({ estado: destino.aprobado, updated_at: db.fn.now() });
  await logEstado(clienteId, cliente.estado, destino.aprobado, userId);
  // Al renovar se le avisa al agente: a diferencia de una venta aprobada
  // (que el agente acaba de subir y está mirando), una renovación pasó por
  // su bandeja días antes y el cierre le llega de sorpresa.
  if (destino.aprobado === 'renovado') {
    await notificar(cliente.agente_id, {
      tipo: 'renovacion_aprobada',
      clienteId,
      mensaje: `BackOffice renovó la póliza de ${cliente.nombres} ${cliente.apellidos}.`,
    });
  }
  return getClienteOr404(clienteId);
}

export async function rechazar(clienteId, userId, motivo, empresaId) {
  const cliente = await getClienteOr404(clienteId);
  await assertMismaEmpresa(cliente, empresaId);
  const destino = destinoDe(cliente);
  await db('clientes').where({ id: clienteId }).update({ estado: destino.rechazado, updated_at: db.fn.now() });
  await logEstado(clienteId, cliente.estado, destino.rechazado, userId, motivo);
  await notificar(cliente.agente_id, {
    tipo: 'rechazo',
    clienteId,
    mensaje: `BackOffice rechazó ${esRenovacion(cliente.estado) ? 'la renovación de' : 'a'} ${cliente.nombres} ${cliente.apellidos}: ${motivo}`,
  });
  return getClienteOr404(clienteId);
}

/**
 * Pasa un caso de "Pendiente BackOffice" a "Pendiente llamada tripartita" —
 * BackOffice ya lo revisó pero necesita coordinar una llamada de 3 (cliente
 * + agente + BackOffice) antes de poder aprobar o rechazar. `motivo` es
 * opcional (queda en el historial, visible en el detalle del caso).
 */
export async function marcarPendienteTripartita(clienteId, userId, motivo, empresaId) {
  const cliente = await getClienteOr404(clienteId);
  await assertMismaEmpresa(cliente, empresaId);
  const destino = destinoDe(cliente);
  // Desde la parada intermedia ya no hay otra — ahí solo queda aprobar o
  // rechazar (ver DESTINOS).
  if (!destino.intermedio) {
    throw conflict(
      esRenovacion(cliente.estado)
        ? 'Esta renovación ya está pendiente de autorización'
        : 'Este cliente ya está pendiente de llamada tripartita'
    );
  }
  await db('clientes').where({ id: clienteId }).update({ estado: destino.intermedio, updated_at: db.fn.now() });
  await logEstado(clienteId, cliente.estado, destino.intermedio, userId, motivo || null);
  return getClienteOr404(clienteId);
}
