import { db } from '../../db/knex.js';
import { badRequest, conflict, forbidden } from '../../utils/httpError.js';
import { getClienteOr404, logEstado, setPlanSalud, getPlanSaludActual } from '../clientes/clientes.service.js';
import { notificar } from '../notificaciones/notificaciones.service.js';

const PENDIENTE = 'pendiente_backoffice';
const PENDIENTE_TRIPARTITA = 'pendiente_llamada_tripartita';
// Completar/rechazar se puede hacer tanto desde la cola normal como desde
// "pendiente llamada tripartita" — ese estado es solo una parada intermedia
// para no confundir "ya lo gestioné, esperando la llamada" con "nadie lo ha
// tocado todavía", no le quita a BackOffice la posibilidad de cerrarlo.
const ESTADOS_GESTIONABLES = [PENDIENTE, PENDIENTE_TRIPARTITA];

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
  if (!ESTADOS_GESTIONABLES.includes(cliente.estado)) throw conflict('Este cliente no está pendiente de BackOffice');

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
  if (faltantes.length) throw badRequest('Completa los datos de póliza antes de cerrar la venta', faltantes);

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
    'confirmado_backoffice'
  );

  await db('clientes').where({ id: clienteId }).update({ estado: 'aprobado', updated_at: db.fn.now() });
  await logEstado(clienteId, cliente.estado, 'aprobado', userId);
  return getClienteOr404(clienteId);
}

export async function rechazar(clienteId, userId, motivo, empresaId) {
  const cliente = await getClienteOr404(clienteId);
  await assertMismaEmpresa(cliente, empresaId);
  if (!ESTADOS_GESTIONABLES.includes(cliente.estado)) throw conflict('Este cliente no está pendiente de BackOffice');
  await db('clientes').where({ id: clienteId }).update({ estado: 'rechazado_backoffice', updated_at: db.fn.now() });
  await logEstado(clienteId, cliente.estado, 'rechazado_backoffice', userId, motivo);
  await notificar(cliente.agente_id, {
    tipo: 'rechazo',
    clienteId,
    mensaje: `BackOffice rechazó a ${cliente.nombres} ${cliente.apellidos}: ${motivo}`,
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
  if (cliente.estado !== PENDIENTE) throw conflict('Este cliente no está pendiente de BackOffice');
  await db('clientes').where({ id: clienteId }).update({ estado: PENDIENTE_TRIPARTITA, updated_at: db.fn.now() });
  await logEstado(clienteId, cliente.estado, PENDIENTE_TRIPARTITA, userId, motivo || null);
  return getClienteOr404(clienteId);
}
