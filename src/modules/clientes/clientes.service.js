import bcrypt from 'bcryptjs';
import { db } from '../../db/knex.js';
import { notFound, forbidden, conflict, badRequest } from '../../utils/httpError.js';
import { notificarRol } from '../notificaciones/notificaciones.service.js';

const EDITABLE_STATES = ['borrador', 'rechazado_backoffice'];

export function assertOwnerIfAgente(cliente, user) {
  if (user.role === 'agente' && cliente.agente_id !== user.id) {
    throw forbidden('Este cliente no te pertenece');
  }
}

export async function getClienteOr404(id) {
  const c = await db('clientes').where({ id }).first();
  if (!c) throw notFound('Cliente no encontrado');
  return c;
}

export function assertEditable(cliente) {
  if (!EDITABLE_STATES.includes(cliente.estado)) {
    throw conflict('Este registro ya no se puede editar en su estado actual');
  }
}

export async function logEstado(clienteId, estadoAnterior, estadoNuevo, userId, motivo = null) {
  await db('historial_estados_cliente').insert({
    cliente_id: clienteId,
    estado_anterior: estadoAnterior,
    estado_nuevo: estadoNuevo,
    cambiado_por: userId,
    motivo,
  });
}

/* ───────────────────────── Paso 1 — Titular ───────────────────────── */

async function hashRespuesta(payload) {
  if (payload.respuesta_seguridad) {
    payload.respuesta_seguridad_hash = await bcrypt.hash(payload.respuesta_seguridad, 10);
  }
  delete payload.respuesta_seguridad;
  return payload;
}

export async function crearCliente(agenteId, data) {
  const payload = await hashRespuesta({ ...data, agente_id: agenteId, estado: 'borrador' });
  const [id] = await db('clientes').insert(payload);
  await logEstado(id, null, 'borrador', agenteId);
  return getClienteOr404(id);
}

export async function actualizarTitular(id, data) {
  const payload = await hashRespuesta({ ...data, updated_at: db.fn.now() });
  await db('clientes').where({ id }).update(payload);
  return getClienteOr404(id);
}

/* ───────────────────────── Paso 2 — Cónyuge ───────────────────────── */

export async function setConyuge(clienteId, data) {
  const existing = await db('dependientes').where({ cliente_id: clienteId, parentesco: 'Conyuge' }).first();
  if (data.no_tiene) {
    if (existing) await db('dependientes').where({ id: existing.id }).del();
    return null;
  }
  const payload = { ...data, cliente_id: clienteId, parentesco: 'Conyuge' };
  delete payload.no_tiene;
  if (existing) {
    await db('dependientes').where({ id: existing.id }).update({ ...payload, updated_at: db.fn.now() });
    return db('dependientes').where({ id: existing.id }).first();
  }
  const [id] = await db('dependientes').insert(payload);
  return db('dependientes').where({ id }).first();
}

export async function getConyuge(clienteId) {
  return db('dependientes').where({ cliente_id: clienteId, parentesco: 'Conyuge' }).first();
}

/* ───────────────────────── Paso 3 — Dependientes ───────────────────────── */

export async function agregarDependiente(clienteId, data) {
  const [id] = await db('dependientes').insert({ ...data, cliente_id: clienteId });
  return db('dependientes').where({ id }).first();
}

export async function actualizarDependiente(clienteId, depId, data) {
  const dep = await db('dependientes').where({ id: depId, cliente_id: clienteId }).first();
  if (!dep) throw notFound('Dependiente no encontrado');
  await db('dependientes').where({ id: depId }).update({ ...data, updated_at: db.fn.now() });
  return db('dependientes').where({ id: depId }).first();
}

export async function eliminarDependiente(clienteId, depId) {
  const n = await db('dependientes').where({ id: depId, cliente_id: clienteId }).del();
  if (!n) throw notFound('Dependiente no encontrado');
}

export async function listarDependientes(clienteId) {
  return db('dependientes').where({ cliente_id: clienteId }).whereNot('parentesco', 'Conyuge').orderBy('id');
}

/* ───────────────────────── Paso 4 — Ingresos ───────────────────────── */

export async function setIngresoTitular(clienteId, data) {
  const existing = await db('ingresos').where({ cliente_id: clienteId }).whereNull('dependiente_id').first();
  if (data.tiene_ingresos === false) {
    if (existing) await db('ingresos').where({ id: existing.id }).del();
    return null;
  }
  const payload = {
    cliente_id: clienteId,
    dependiente_id: null,
    tipo_declaracion: data.tipo_declaracion,
    ingresos_semanales: data.ingresos_semanales,
  };
  if (existing) {
    await db('ingresos').where({ id: existing.id }).update({ ...payload, updated_at: db.fn.now() });
    return db('ingresos').where({ id: existing.id }).first();
  }
  const [id] = await db('ingresos').insert(payload);
  return db('ingresos').where({ id }).first();
}

export async function setIngresoDependiente(clienteId, depId, data) {
  const dep = await db('dependientes').where({ id: depId, cliente_id: clienteId }).first();
  if (!dep) throw notFound('Dependiente no encontrado');
  const existing = await db('ingresos').where({ dependiente_id: depId }).first();
  if (data.tiene_ingresos === false) {
    if (existing) await db('ingresos').where({ id: existing.id }).del();
    return null;
  }
  const payload = {
    cliente_id: clienteId,
    dependiente_id: depId,
    tipo_declaracion: data.tipo_declaracion,
    ingresos_semanales: data.ingresos_semanales,
  };
  if (existing) {
    await db('ingresos').where({ id: existing.id }).update({ ...payload, updated_at: db.fn.now() });
    return db('ingresos').where({ id: existing.id }).first();
  }
  const [id] = await db('ingresos').insert(payload);
  return db('ingresos').where({ id }).first();
}

export async function listarIngresos(clienteId) {
  return db('ingresos').where({ cliente_id: clienteId }).orderBy('id');
}

export async function totalIngresosFamilia(clienteId) {
  const rows = await db('ingresos').where({ cliente_id: clienteId }).sum({ total: 'ingresos_anuales' }).first();
  return Number(rows?.total || 0);
}

/* ───────────────────────── Paso 5 — Plan de salud ───────────────────────── */

export async function setPlanSalud(clienteId, data, userId, versionOrigen = 'cotizado_agente') {
  await db('planes_salud').where({ cliente_id: clienteId, is_current: true }).update({ is_current: false });
  const [id] = await db('planes_salud').insert({
    ...data,
    cliente_id: clienteId,
    version_origen: versionOrigen,
    is_current: true,
    creado_por: userId,
  });
  return db('planes_salud').where({ id }).first();
}

export async function getPlanSaludActual(clienteId) {
  return db('planes_salud as p')
    .leftJoin('aseguradoras as a', 'a.id', 'p.aseguradora_id')
    .leftJoin('npn_productores as np', 'np.id', 'p.npn_productor_id')
    .select('p.*', 'a.nombre as aseguradora_nombre', 'np.nombre as npn_productor_nombre')
    .where({ 'p.cliente_id': clienteId, 'p.is_current': true })
    .first();
}

export async function getPlanSaludHistorial(clienteId) {
  return db('planes_salud as p')
    .leftJoin('aseguradoras as a', 'a.id', 'p.aseguradora_id')
    .leftJoin('npn_productores as np', 'np.id', 'p.npn_productor_id')
    .select('p.*', 'a.nombre as aseguradora_nombre', 'np.nombre as npn_productor_nombre')
    .where({ 'p.cliente_id': clienteId })
    .orderBy('p.created_at', 'desc');
}

/* ───────────────────────── Paso 6 — Pago ───────────────────────── */

export async function setPago(clienteId, data) {
  const existing = await db('informacion_pago').where({ cliente_id: clienteId }).first();
  if (existing) {
    await db('informacion_pago').where({ id: existing.id }).update({ ...data, updated_at: db.fn.now() });
    return db('informacion_pago').where({ id: existing.id }).first();
  }
  const [id] = await db('informacion_pago').insert({ ...data, cliente_id: clienteId });
  return db('informacion_pago').where({ id }).first();
}

export async function getPago(clienteId) {
  return db('informacion_pago').where({ cliente_id: clienteId }).first();
}

/* ───────────────────────── Finalizar / reenviar ───────────────────────── */

export async function finalizar(clienteId, userId) {
  const cliente = await getClienteOr404(clienteId);
  assertEditable(cliente);

  const [ingresoTitular, plan, pago, evidenciasCount] = await Promise.all([
    db('ingresos').where({ cliente_id: clienteId }).whereNull('dependiente_id').first(),
    db('planes_salud').where({ cliente_id: clienteId, is_current: true }).first(),
    db('informacion_pago').where({ cliente_id: clienteId }).first(),
    db('evidencias').where({ cliente_id: clienteId }).count({ n: '*' }).first(),
  ]);

  const faltantes = [];
  if (!ingresoTitular) faltantes.push('Ingresos del titular (paso 4)');
  if (!plan) faltantes.push('Plan de salud (paso 5)');
  if (!pago) faltantes.push('Información de pago (paso 6)');
  if (!Number(evidenciasCount?.n || 0)) faltantes.push('Al menos 1 evidencia (paso 7)');
  if (faltantes.length) throw badRequest('Faltan pasos por completar antes de finalizar', faltantes);

  const nuevoEstado = 'pendiente_backoffice';
  await db('clientes')
    .where({ id: clienteId })
    .update({ estado: nuevoEstado, submitted_at: db.fn.now(), updated_at: db.fn.now() });
  await logEstado(clienteId, cliente.estado, nuevoEstado, userId);

  const reenvio = cliente.estado === 'rechazado_backoffice';
  await notificarRol('backoffice', {
    tipo: 'nuevo_pendiente',
    clienteId,
    mensaje: `${reenvio ? 'Reenviado' : 'Nuevo'}: ${cliente.nombres} ${cliente.apellidos} entró a la cola de pendientes.`,
  });

  return getClienteOr404(clienteId);
}

/* ───────────────────────── Detección de duplicados ───────────────────────── */

/**
 * Clientes ya existentes con el mismo SSN o correo — para avisarle al
 * agente ANTES de vender dos veces al mismo cliente. Es solo un aviso (no
 * bloquea): dos agentes pueden llegar al mismo lead, o un cliente puede
 * reaplicar de verdad, y eso lo decide el agente, no el sistema.
 */
export async function buscarDuplicados({ social, correo, excluirId }) {
  if (!social && !correo) return [];
  const q = db('clientes as c')
    .leftJoin('usuarios_sistema as ag', 'ag.id', 'c.agente_id')
    .select('c.id', 'c.nombres', 'c.apellidos', 'c.estado', 'c.social', 'c.correo_electronico', 'ag.name as agente_nombre')
    .where((b) => {
      if (social) b.orWhere('c.social', social);
      if (correo) b.orWhere('c.correo_electronico', correo);
    })
    .limit(5);
  if (excluirId) q.andWhere('c.id', '!=', excluirId);
  const rows = await q;
  return rows.map((r) => ({
    ...r,
    coincide_por: [social && r.social === social ? 'SSN' : null, correo && r.correo_electronico === correo ? 'correo' : null].filter(Boolean),
  }));
}

/**
 * Compuerta antes de "Nuevo registro": el agente valida teléfono + código
 * postal ANTES de que se le muestre el formulario. A diferencia de
 * `buscarDuplicados` (SSN/correo, solo un aviso), esto se usa para decidir si
 * se deja crear un cliente nuevo o no — por eso exige que AMBOS coincidan:
 * el código postal solo, lo comparten cientos de personas, no identifica a
 * nadie por sí solo.
 */
export async function buscarPorTelefonoYCP(telefono, codigoPostal) {
  if (!telefono || !codigoPostal) return [];
  return db('clientes as c')
    .leftJoin('usuarios_sistema as ag', 'ag.id', 'c.agente_id')
    .select('c.id', 'c.nombres', 'c.apellidos', 'c.estado', 'c.agente_id', 'ag.name as agente_nombre')
    .where({ 'c.phone_1': telefono, 'c.codigo_postal': codigoPostal })
    .limit(5);
}

/* ───────────────────────── Listado / detalle ───────────────────────── */

export async function listarClientes(user, filters = {}) {
  const q = db('clientes as c')
    .leftJoin('usuarios_sistema as ag', 'ag.id', 'c.agente_id')
    .select(
      'c.id',
      'c.nombres',
      'c.apellidos',
      'c.correo_electronico',
      'c.phone_1',
      'c.estado',
      'c.created_at',
      'c.submitted_at',
      'ag.name as agente_nombre'
    )
    .orderBy('c.created_at', 'desc')
    .limit(200);

  if (user.role === 'agente') q.where('c.agente_id', user.id);
  if (filters.estado) q.where('c.estado', filters.estado);
  if (filters.agenteId) q.where('c.agente_id', filters.agenteId);
  if (filters.q) {
    const like = `%${filters.q}%`;
    q.where((b) =>
      b
        .where('c.nombres', 'like', like)
        .orWhere('c.apellidos', 'like', like)
        .orWhere('c.correo_electronico', 'like', like)
        .orWhere('c.social', 'like', like)
    );
  }
  return q;
}

export async function getClienteDetalle(clienteId) {
  const cliente = await getClienteOr404(clienteId);
  const [agente, dependientes, ingresos, plan, pago, evidencias, historial, observacionesRows] = await Promise.all([
    db('usuarios_sistema').select('id', 'name', 'email').where({ id: cliente.agente_id }).first(),
    db('dependientes').where({ cliente_id: clienteId }).orderBy('id'),
    db('ingresos').where({ cliente_id: clienteId }),
    getPlanSaludActual(clienteId),
    getPago(clienteId),
    db('evidencias').where({ cliente_id: clienteId }).orderBy('id'),
    db('historial_estados_cliente as h')
      .leftJoin('usuarios_sistema as u', 'u.id', 'h.cambiado_por')
      .select('h.*', 'u.name as cambiado_por_nombre')
      .where({ cliente_id: clienteId })
      .orderBy('h.created_at', 'desc'),
    db('observaciones as o')
      .leftJoin('usuarios_sistema as u', 'u.id', 'o.autor_id')
      .select('o.*', 'u.name as autor_nombre')
      .where({ cliente_id: clienteId })
      .orderBy('o.created_at', 'desc'),
  ]);

  const ingresosTotalesFamilia = ingresos.reduce((s, r) => s + Number(r.ingresos_anuales || 0), 0);

  return {
    ...cliente,
    agente,
    dependientes,
    ingresos,
    ingresos_totales_familia: ingresosTotalesFamilia,
    plan_salud: plan || null,
    pago: pago || null,
    evidencias,
    historial,
    observaciones: observacionesRows,
  };
}

export async function agregarObservacion(clienteId, autorId, comentario) {
  await getClienteOr404(clienteId);
  const [id] = await db('observaciones').insert({ cliente_id: clienteId, autor_id: autorId, comentario });
  return db('observaciones').where({ id }).first();
}
