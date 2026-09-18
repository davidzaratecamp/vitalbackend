import bcrypt from 'bcryptjs';
import { db } from '../../db/knex.js';
import { notFound, forbidden, conflict, badRequest } from '../../utils/httpError.js';
import { notificarRol } from '../notificaciones/notificaciones.service.js';
import { encryptCard, decryptCard, detectarMarca } from '../../utils/cardCrypto.js';

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

/**
 * Antes de crear/actualizar el titular: si el SSN o el correo ya
 * pertenecen a OTRO cliente, corta acá con un mensaje que dice exactamente
 * a quién — en vez de dejar que MySQL rechace el INSERT/UPDATE con un
 * "Ya existe un registro con ese valor único" genérico (no dice el campo
 * ni a quién pertenece, y el agente queda sin poder saber qué corregir).
 */
async function assertSocialCorreoDisponibles({ social, correo_electronico }, excluirId) {
  const conflictos = [];
  for (const [campo, valor, etiqueta] of [
    ['social', social, 'Social Security Number'],
    ['correo_electronico', correo_electronico, 'Correo electrónico'],
  ]) {
    if (!valor) continue;
    const q = db('clientes').where({ [campo]: valor }).first('id', 'nombres', 'apellidos');
    if (excluirId) q.andWhere('id', '!=', excluirId);
    const row = await q;
    if (row) conflictos.push(`${etiqueta}: ya lo tiene ${row.nombres} ${row.apellidos} (ID ${row.id})`);
  }
  if (conflictos.length) throw conflict('Ya existe otro cliente con ese dato — verifica que no sea un error de tipeo', conflictos);
}

export async function crearCliente(agenteId, data) {
  await assertSocialCorreoDisponibles(data);
  const payload = await hashRespuesta({ ...data, agente_id: agenteId, estado: 'borrador' });
  const [id] = await db('clientes').insert(payload);
  await logEstado(id, null, 'borrador', agenteId);
  return getClienteOr404(id);
}

export async function actualizarTitular(id, data) {
  await assertSocialCorreoDisponibles(data, id);
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
    .select('p.*', 'a.nombre as aseguradora_nombre', 'np.nombre as npn_productor_nombre', 'np.npn as npn_productor_npn')
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

const PAGO_COLUMNS_PUBLICAS = [
  'id',
  'cliente_id',
  'metodo',
  'ultimos_4_digitos',
  'marca_tarjeta',
  'nombre_titular_tarjeta',
  'fecha_expiracion_mes',
  'fecha_expiracion_ano',
  'created_at',
  'updated_at',
];
// Solo para leer de la BD — nunca se manda tal cual al cliente HTTP, ver
// pagoParaMostrar().
const PAGO_COLUMNS_INTERNAS = [...PAGO_COLUMNS_PUBLICAS, 'data_point'];

/** Quita `data_point` de la respuesta (ni el agente ni nadie fuera de
 * getDataPointCompleto lo ve) y en su lugar deja un booleano — para que la
 * UI sepa si ya hay algo guardado sin revelar el contenido. */
function pagoParaMostrar(row) {
  if (!row) return row;
  const { data_point, ...resto } = row;
  return { ...resto, tiene_data_point: !!data_point };
}

/**
 * `numero_tarjeta` (si viene) se cifra acá — nunca se guarda en texto plano
 * ni se deja pasar tal cual a la fila. `ultimos_4_digitos` y `marca_tarjeta`
 * se derivan del número completo, no se aceptan sueltos. Si no viene
 * `numero_tarjeta` (ej. el agente solo corrige el nombre o el vencimiento),
 * el número ya guardado no se toca. `data_point` es texto libre (NO se
 * cifra: no es un dato de pago regulado, solo se pidió que el agente no
 * pueda volver a leerlo — ver pagoParaMostrar/getDataPointCompleto).
 */
export async function setPago(clienteId, { numero_tarjeta, ...data }) {
  const payload = { ...data };
  if (numero_tarjeta) {
    payload.numero_tarjeta_cifrado = encryptCard(numero_tarjeta);
    payload.marca_tarjeta = detectarMarca(numero_tarjeta);
    payload.ultimos_4_digitos = numero_tarjeta.slice(-4);
  }

  const existing = await db('informacion_pago').where({ cliente_id: clienteId }).first();
  if (existing) {
    await db('informacion_pago').where({ id: existing.id }).update({ ...payload, updated_at: db.fn.now() });
    return pagoParaMostrar(await db('informacion_pago').where({ id: existing.id }).select(PAGO_COLUMNS_INTERNAS).first());
  }
  const [id] = await db('informacion_pago').insert({ ...payload, cliente_id: clienteId });
  return pagoParaMostrar(await db('informacion_pago').where({ id }).select(PAGO_COLUMNS_INTERNAS).first());
}

/** Nunca incluye `numero_tarjeta_cifrado` ni `data_point` — ver
 * getNumeroTarjetaCompleto / getDataPointCompleto. */
export async function getPago(clienteId) {
  return pagoParaMostrar(await db('informacion_pago').where({ cliente_id: clienteId }).select(PAGO_COLUMNS_INTERNAS).first());
}

/**
 * Descifra el número completo — solo para backoffice/admin (ver la ruta) y
 * deja un registro de auditoría en `accesos_tarjeta` en cada llamada.
 */
export async function getNumeroTarjetaCompleto(clienteId, userId) {
  const row = await db('informacion_pago').where({ cliente_id: clienteId }).first();
  if (!row?.numero_tarjeta_cifrado) return null;
  await db('accesos_tarjeta').insert({ cliente_id: clienteId, usuario_id: userId });
  return { numero_tarjeta: decryptCard(row.numero_tarjeta_cifrado), marca_tarjeta: row.marca_tarjeta };
}

/** El agente nunca lo ve — solo backoffice/admin (ver la ruta). */
export async function getDataPointCompleto(clienteId) {
  const row = await db('informacion_pago').where({ cliente_id: clienteId }).first('data_point');
  return { data_point: row?.data_point ?? null };
}

/* ───────────────────────── Finalizar / reenviar ───────────────────────── */

export async function finalizar(clienteId, userId) {
  const cliente = await getClienteOr404(clienteId);
  assertEditable(cliente);

  const [ingresoTitular, plan, pago, evidenciasCount, ultimaFirma] = await Promise.all([
    db('ingresos').where({ cliente_id: clienteId }).whereNull('dependiente_id').first(),
    db('planes_salud').where({ cliente_id: clienteId, is_current: true }).first(),
    db('informacion_pago').where({ cliente_id: clienteId }).first(),
    db('evidencias').where({ cliente_id: clienteId }).count({ n: '*' }).first(),
    // No se importa firmas.service.js acá para evitar un import circular
    // (ese módulo ya importa getClienteDetalle de este) — se consulta la
    // tabla directo.
    db('firmas_documentos').where({ cliente_id: clienteId }).orderBy('created_at', 'desc').first(),
  ]);

  const faltantes = [];
  if (!ingresoTitular) faltantes.push('Ingresos del titular (paso 4)');
  if (!plan) faltantes.push('Plan de salud (paso 5)');
  if (!pago) faltantes.push('Información de pago (paso 6)');
  if (!Number(evidenciasCount?.n || 0)) faltantes.push('Al menos 1 evidencia (paso 7)');
  if (ultimaFirma?.estado !== 'signed') faltantes.push('Carta de firma (CMS) firmada por el cliente');
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
 * Compuerta antes de "Nuevo registro": el agente valida el teléfono ANTES
 * de que se le muestre el formulario (antes también pedía código postal —
 * ya no, a pedido del usuario). A diferencia de `buscarDuplicados` (SSN/
 * correo, solo un aviso), esto se usa para decidir si se deja crear un
 * cliente nuevo o no.
 */
export async function buscarPorTelefono(telefono) {
  if (!telefono) return [];
  return db('clientes as c')
    .leftJoin('usuarios_sistema as ag', 'ag.id', 'c.agente_id')
    .select('c.id', 'c.nombres', 'c.apellidos', 'c.estado', 'c.agente_id', 'ag.name as agente_nombre')
    .where({ 'c.phone_1': telefono })
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
