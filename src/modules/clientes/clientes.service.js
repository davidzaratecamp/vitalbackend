import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../db/knex.js';
import { env } from '../../config/env.js';
import { notFound, forbidden, conflict, badRequest } from '../../utils/httpError.js';
import { notificarRol } from '../notificaciones/notificaciones.service.js';
import { encryptCard, decryptCard, detectarMarca } from '../../utils/cardCrypto.js';
import { CATEGORIA_EVIDENCIA_OBLIGATORIA, CATEGORIA_EVIDENCIA_LABEL, EMPRESA_VITAL_ASISTE_ID } from './clientes.constants.js';

const EDITABLE_STATES = ['borrador', 'rechazado_backoffice'];

/**
 * Acceso general a un cliente, según rol:
 * - agente: el suyo (cualquier estado, igual que antes) — o, desde
 *   2026-09-24 ("el customer es el mismo agente", integración del rol
 *   Customer dentro de agente), cualquier cliente ya APROBADO de un agente
 *   de SU MISMA empresa aunque no lo haya vendido él — es el acceso que
 *   necesita para gestionar postventa. No aplica a boradores/pendientes/
 *   rechazados ajenos, solo a aprobados.
 * - backoffice / supervisor: solo clientes de agentes de SU MISMA empresa
 *   (Vital absorbió a la extinta Asiste Health Care — "Vital Asiste" — pero
 *   ambos lados quedan separados entre sí; ver migración 20260919120000).
 * - admin: sin restricción, ve las dos empresas.
 */
export async function assertAccesoCliente(cliente, user) {
  if (user.role === 'agente') {
    if (cliente.agente_id === user.id) return;
    if (cliente.estado === 'aprobado' && user.empresa_id) {
      const dueño = await db('usuarios_sistema').where({ id: cliente.agente_id }).first('empresa_id');
      if (dueño && dueño.empresa_id === user.empresa_id) return;
    }
    throw forbidden('Este cliente no te pertenece');
  }
  if (user.role === 'backoffice' || user.role === 'supervisor') {
    if (!user.empresa_id) throw forbidden('Tu cuenta no tiene una empresa asignada — pídele a un admin que la configure');
    const agente = await db('usuarios_sistema').where({ id: cliente.agente_id }).first('empresa_id');
    if (!agente || agente.empresa_id !== user.empresa_id) throw forbidden('Este cliente pertenece a otra empresa');
  }
  // admin: sin restricción.
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

// Agente: borrador (suyo) + rechazado_backoffice (2026-09-24, a pedido del
// usuario: "el agente pueda eliminar también los casos que el backoffice le
// rechaza" — solo esos dos estados, nunca pendiente_backoffice ni
// aprobado). Supervisor/admin: solo borrador, sin cambios.
const ESTADOS_ELIMINABLES_POR_ROL = {
  agente: ['borrador', 'rechazado_backoffice'],
  supervisor: ['borrador'],
  admin: ['borrador'],
};

/**
 * Borra un registro por completo — a pedido del usuario (2026-09-24): hay
 * muchos borradores que el agente nunca termina de gestionar y quedan ahí
 * para siempre, y casos rechazados que tampoco corrige. Nunca uno que siga
 * pendiente en BackOffice o ya aprobado (esos quedan protegidos por el
 * estado, ni siquiera se intenta). Las tablas hijas cascada solas
 * (dependientes, ingresos, planes_salud, informacion_pago, evidencias,
 * historial, observaciones, firmas_documentos, soportes_poliza) — la única
 * que NO tiene CASCADE a propósito es accesos_tarjeta (es un log de
 * auditoría), así que se borra aparte primero para no chocar con la FK.
 * Los archivos físicos (evidencias/soportes) se borran del disco después de
 * que la fila de la base ya se fue.
 */
export async function eliminarCliente(clienteId, userRole) {
  const cliente = await getClienteOr404(clienteId);
  const estadosPermitidos = ESTADOS_ELIMINABLES_POR_ROL[userRole] ?? ['borrador'];
  if (!estadosPermitidos.includes(cliente.estado)) {
    throw conflict(
      userRole === 'agente'
        ? 'Solo se pueden eliminar registros en borrador o rechazados por BackOffice.'
        : 'Solo se pueden eliminar registros en borrador — este ya se envió o fue gestionado.'
    );
  }

  const archivos = [
    ...(await db('evidencias').where({ cliente_id: clienteId }).select('ruta_archivo')),
    ...(await db('soportes_poliza').where({ cliente_id: clienteId }).select('ruta_archivo')),
  ];

  await db('accesos_tarjeta').where({ cliente_id: clienteId }).del();
  await db('clientes').where({ id: clienteId }).del();

  for (const { ruta_archivo } of archivos) {
    fs.unlink(path.join(env.uploads.dir, ruta_archivo), () => {});
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

// Cifrado reversible (no hash) — a pedido del usuario (2026-09-23) la
// respuesta debe poder mostrarse a admin/supervisor/backoffice.
// encryptCard/decryptCard son AES-256-GCM genérico, no específico de
// tarjetas — se reutiliza la misma llave/mecanismo en vez de duplicarlo.
function cifrarRespuesta(payload) {
  if (payload.respuesta_seguridad) {
    payload.respuesta_seguridad_cifrada = encryptCard(payload.respuesta_seguridad);
  }
  delete payload.respuesta_seguridad;
  return payload;
}

/** Descifra la respuesta para mostrarla — `null` si nunca se guardó, o si
 * es una respuesta vieja que solo tiene el hash irreversible de antes. */
function descifrarRespuesta(cifrada) {
  if (!cifrada) return null;
  try {
    return decryptCard(cifrada);
  } catch {
    return null;
  }
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
  const payload = cifrarRespuesta({ ...data, agente_id: agenteId, estado: 'borrador' });
  const [id] = await db('clientes').insert(payload);
  await logEstado(id, null, 'borrador', agenteId);
  return getClienteOr404(id);
}

export async function actualizarTitular(id, data) {
  await assertSocialCorreoDisponibles(data, id);
  const payload = cifrarRespuesta({ ...data, updated_at: db.fn.now() });
  await db('clientes').where({ id }).update(payload);
  return getClienteOr404(id);
}

/**
 * MySQL devuelve las columnas booleanas (tinyint) como el NÚMERO 0/1, no
 * como true/false — mysql2 no las convierte solo. Eso rompió la pantalla
 * (2026-09-24): `{d.medicare_medicaid && '· Medicare/Medicaid'}` en React,
 * cuando el valor es el número `0`, no se omite como pasaría con `false`
 * — React SÍ pinta un `0` literal en la página (a diferencia de false/
 * null/undefined, que si se ignoran). Con el campo justo después del SSN
 * sin separador, se veía como un dígito de más pegado al número. Se
 * normaliza acá, en el único lugar que arma cada fila de `dependientes`,
 * para que ningún componente (presente o futuro) pueda pisar el mismo
 * rastrillo.
 */
function normalizarDependiente(row) {
  if (!row) return row;
  return { ...row, solicita_cobertura: !!row.solicita_cobertura, medicare_medicaid: !!row.medicare_medicaid };
}
function normalizarDependientes(rows) {
  return rows.map(normalizarDependiente);
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
    return normalizarDependiente(await db('dependientes').where({ id: existing.id }).first());
  }
  const [id] = await db('dependientes').insert(payload);
  return normalizarDependiente(await db('dependientes').where({ id }).first());
}

export async function getConyuge(clienteId) {
  return normalizarDependiente(await db('dependientes').where({ cliente_id: clienteId, parentesco: 'Conyuge' }).first());
}

/* ───────────────────────── Paso 3 — Dependientes ───────────────────────── */

export async function agregarDependiente(clienteId, data) {
  const [id] = await db('dependientes').insert({ ...data, cliente_id: clienteId });
  return normalizarDependiente(await db('dependientes').where({ id }).first());
}

export async function actualizarDependiente(clienteId, depId, data) {
  const dep = await db('dependientes').where({ id: depId, cliente_id: clienteId }).first();
  if (!dep) throw notFound('Dependiente no encontrado');
  await db('dependientes').where({ id: depId }).update({ ...data, updated_at: db.fn.now() });
  return normalizarDependiente(await db('dependientes').where({ id: depId }).first());
}

export async function eliminarDependiente(clienteId, depId) {
  const n = await db('dependientes').where({ id: depId, cliente_id: clienteId }).del();
  if (!n) throw notFound('Dependiente no encontrado');
}

export async function listarDependientes(clienteId) {
  const rows = await db('dependientes').where({ cliente_id: clienteId }).whereNot('parentesco', 'Conyuge').orderBy('id');
  return normalizarDependientes(rows);
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
    ingresos_anuales: data.ingresos_anuales,
    ingresos_semanales: data.ingresos_semanales ?? null,
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
    ingresos_anuales: data.ingresos_anuales,
    ingresos_semanales: data.ingresos_semanales ?? null,
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
 * Número completo de tarjeta: admin siempre puede. BackOffice de Vital
 * Asiste necesita el permiso individual `puede_ver_datos_pago` — ahí
 * NINGÚN backoffice lo ve salvo quien lo tenga (2026-09-25, pedido
 * explícito del usuario: "ningún backoffice puede ver ningún dato de la
 * tarjeta, solo lo podrá hacer Camila"). BackOffice de cualquier otra
 * empresa (Vital, por ahora) sigue con el comportamiento de siempre —
 * abierto sin restricción — todavía no hay instrucción para restringirlo
 * también ahí ("después te doy el instructivo para Vital").
 */
export async function assertPuedeVerNumeroTarjeta(cliente, user) {
  if (user.role === 'admin') return;
  const agente = await db('usuarios_sistema').where({ id: cliente.agente_id }).first('empresa_id');
  if (agente?.empresa_id === EMPRESA_VITAL_ASISTE_ID && !user.puede_ver_datos_pago) {
    throw forbidden('No tienes permiso para ver el número completo de la tarjeta');
  }
}

/**
 * Data Point: nunca estuvo abierto a nadie (ni admin en un principio, luego
 * ni siquiera backoffice) — a diferencia del número completo, acá NO hay
 * empresa con comportamiento "de siempre" que preservar. Admin, o quien
 * tenga `puede_ver_datos_pago`, sin importar la empresa — hoy solo Camila.
 */
export function assertPuedeVerDataPoint(user) {
  if (user.role === 'admin') return;
  if (!user.puede_ver_datos_pago) throw forbidden('No tienes permiso para ver el Data Point');
}

/**
 * Descifra el número completo — el acceso ya lo validó la ruta
 * (assertPuedeVerNumeroTarjeta) — y deja un registro de auditoría en
 * `accesos_tarjeta` en cada llamada.
 */
export async function getNumeroTarjetaCompleto(clienteId, userId) {
  const row = await db('informacion_pago').where({ cliente_id: clienteId }).first();
  if (!row?.numero_tarjeta_cifrado) return null;
  await db('accesos_tarjeta').insert({ cliente_id: clienteId, usuario_id: userId, tipo: 'numero_tarjeta' });
  // "Todos los datos de la tarjeta" (2026-09-25, aclarado por el usuario) —
  // nombre del titular y vencimiento van junto con el número, no sueltos:
  // son los únicos campos de `informacion_pago` que no están cifrados ni
  // son el Data Point, así que completan el cuadro sin tocar el CVV (que
  // nunca se guarda, en ningún lado — regla dura, ver memoria del proyecto).
  return {
    numero_tarjeta: decryptCard(row.numero_tarjeta_cifrado),
    marca_tarjeta: row.marca_tarjeta,
    nombre_titular_tarjeta: row.nombre_titular_tarjeta,
    fecha_expiracion_mes: row.fecha_expiracion_mes,
    fecha_expiracion_ano: row.fecha_expiracion_ano,
  };
}

/** Mismo candado que el número completo pero de un solo tramo
 * (assertPuedeVerDataPoint, ya validado en la ruta) — queda auditado en
 * `accesos_tarjeta` en cada llamada. */
export async function getDataPointCompleto(clienteId, userId) {
  const row = await db('informacion_pago').where({ cliente_id: clienteId }).first('data_point');
  await db('accesos_tarjeta').insert({ cliente_id: clienteId, usuario_id: userId, tipo: 'data_point' });
  return { data_point: row?.data_point ?? null };
}

/* ───────────────────────── Finalizar / reenviar ───────────────────────── */

export async function finalizar(clienteId, userId) {
  const cliente = await getClienteOr404(clienteId);
  assertEditable(cliente);

  const [ingresoTitular, plan, pago, categoriasSubidas, ultimaFirma] = await Promise.all([
    db('ingresos').where({ cliente_id: clienteId }).whereNull('dependiente_id').first(),
    db('planes_salud').where({ cliente_id: clienteId, is_current: true }).first(),
    db('informacion_pago').where({ cliente_id: clienteId }).first(),
    db('evidencias').where({ cliente_id: clienteId }).whereNotNull('categoria').distinct('categoria'),
    // No se importa firmas.service.js acá para evitar un import circular
    // (ese módulo ya importa getClienteDetalle de este) — se consulta la
    // tabla directo.
    db('firmas_documentos').where({ cliente_id: clienteId }).orderBy('created_at', 'desc').first(),
  ]);

  const faltantes = [];
  if (!ingresoTitular) faltantes.push('Ingresos del titular (paso 4)');
  if (!plan) faltantes.push('Plan de salud (paso 5)');
  // Con prima $0 (plan totalmente subsidiado) no hay cobro que gestionar,
  // así que el Paso 6 deja de ser obligatorio (2026-09-22). Si no hay plan
  // todavía, no se puede confirmar que la prima sea $0 — se exige el pago
  // igual que siempre en ese caso.
  const primaEsCero = plan && Number(plan.valor_prima) === 0;
  if (!pago && !primaEsCero) faltantes.push('Información de pago (paso 6)');
  const categoriasPresentes = new Set(categoriasSubidas.map((r) => r.categoria));
  for (const cat of CATEGORIA_EVIDENCIA_OBLIGATORIA) {
    if (!categoriasPresentes.has(cat)) faltantes.push(`Evidencia: ${CATEGORIA_EVIDENCIA_LABEL[cat]} (paso 7)`);
  }
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
  if (user.role === 'backoffice' || user.role === 'supervisor') {
    q.whereIn('c.agente_id', db('usuarios_sistema').select('id').where({ empresa_id: user.empresa_id }));
  }
  if (filters.estado) q.where('c.estado', filters.estado);
  if (filters.agenteId) q.where('c.agente_id', filters.agenteId);
  if (filters.q) {
    const like = `%${filters.q}%`;
    // El ID también cuenta como búsqueda — a pedido del usuario
    // (2026-09-24), exacto (no "like") para no confundir el 1 con el 11.
    const comoId = Number.isInteger(Number(filters.q)) ? Number(filters.q) : null;
    q.where((b) => {
      b.where('c.nombres', 'like', like)
        .orWhere('c.apellidos', 'like', like)
        .orWhere('c.correo_electronico', 'like', like)
        .orWhere('c.social', 'like', like);
      if (comoId !== null) b.orWhere('c.id', comoId);
    });
  }
  return q;
}

export async function getClienteDetalle(clienteId) {
  const cliente = await getClienteOr404(clienteId);
  const [agente, dependientes, ingresos, plan, pago, evidencias, historial, observacionesRows] = await Promise.all([
    db('usuarios_sistema').select('id', 'name', 'email').where({ id: cliente.agente_id }).first(),
    db('dependientes').where({ cliente_id: clienteId }).orderBy('id').then(normalizarDependientes),
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

  // Visible para admin/supervisor/backoffice (2026-09-23) — se descifra
  // acá, nunca se manda el cifrado crudo. `respuesta_seguridad_hash` (el
  // formato viejo, irreversible) tampoco se expone — no sirve para nada
  // del lado del cliente HTTP.
  const { respuesta_seguridad_cifrada, respuesta_seguridad_hash, ...clienteSinCifrados } = cliente;
  const respuesta_seguridad = descifrarRespuesta(respuesta_seguridad_cifrada);

  return {
    ...clienteSinCifrados,
    solicita_cobertura: !!clienteSinCifrados.solicita_cobertura,
    respuesta_seguridad,
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
