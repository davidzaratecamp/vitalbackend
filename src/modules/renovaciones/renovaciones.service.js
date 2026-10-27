import { db } from '../../db/knex.js';
import { badRequest, conflict, forbidden } from '../../utils/httpError.js';
import { getClienteOr404, logEstado } from '../clientes/clientes.service.js';
import { notificar, notificarRol } from '../notificaciones/notificaciones.service.js';
import {
  RENOVACION_MES,
  RENOVACION_DIA,
  ESTADOS_VIGENTES_PARA_RENOVAR,
  ESTADOS_RENOVACION,
  ESTADOS_RENOVACION_AGENTE,
  APERTURA_RENOVACION_PREFIJO,
  CATEGORIA_EVIDENCIA_OBLIGATORIA,
  CATEGORIA_EVIDENCIA_LABEL,
} from '../clientes/clientes.constants.js';

/* ───────────────────────── La temporada ───────────────────────── */

/**
 * Año de la temporada abierta en una fecha dada: la del 1 de noviembre más
 * reciente que ya pasó. El 2026-10-27 devuelve 2025 (la temporada de 2026
 * todavía no abrió, así que no hay nada que mover); el 2026-11-01 devuelve
 * 2026.
 */
export function temporadaDe(fecha = new Date()) {
  const abrioEsteAno =
    fecha.getMonth() + 1 > RENOVACION_MES ||
    (fecha.getMonth() + 1 === RENOVACION_MES && fecha.getDate() >= RENOVACION_DIA);
  return abrioEsteAno ? fecha.getFullYear() : fecha.getFullYear() - 1;
}

/** El 1 de noviembre de ese año, a las 00:00 — el corte de la temporada. */
export function corteDeTemporada(anio) {
  return new Date(anio, RENOVACION_MES - 1, RENOVACION_DIA, 0, 0, 0);
}

const comoFechaSql = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 00:00:00`;

/**
 * Las pólizas que le toca entrar a la temporada `anio` y todavía no
 * entraron. Tres condiciones:
 *
 * 1. Están vigentes: 'aprobado' (venta cerrada) o 'renovado' (ya pasaron
 *    por una temporada anterior y siguen activas).
 * 2. No entraron ya a ESTA temporada — `renovacion_anio` las marca, y es lo
 *    que hace que el proceso pueda correr mil veces sin mover nada dos
 *    veces.
 * 3. Llegaron a ese estado ANTES del 1 de noviembre de la temporada. Una
 *    venta aprobada el 31 de octubre entra al día siguiente (así funciona
 *    ACA: esa póliza vence el 31 de diciembre); una aprobada el 2 de
 *    noviembre espera a la temporada siguiente. Confirmado por el usuario
 *    el 2026-10-27.
 *
 * El "cuándo llegó a ese estado" sale de `historial_estados_cliente`. Si
 * por lo que sea no hubiera ninguna fila (no debería pasar: logEstado
 * corre en cada transición), se cae a `created_at` del cliente en vez de
 * dejarlo fuera para siempre.
 */
export function queryPendientesDeTemporada(anio) {
  const corte = comoFechaSql(corteDeTemporada(anio));
  return db('clientes as c')
    .whereIn('c.estado', ESTADOS_VIGENTES_PARA_RENOVAR)
    .andWhere((b) => b.whereNull('c.renovacion_anio').orWhere('c.renovacion_anio', '<', anio))
    .andWhereRaw(
      `COALESCE((
         SELECT MAX(h.created_at) FROM historial_estados_cliente h
         WHERE h.cliente_id = c.id AND h.estado_nuevo = c.estado
       ), c.created_at) < ?`,
      [corte]
    );
}

/**
 * Abre la temporada: pasa a 'pendiente_renovacion' todas las pólizas que
 * corresponde. Es idempotente — si ya corrió hoy, no encuentra nada.
 *
 * Corre sola todos los días (ver `arrancarTemporadaAutomatica`) y también
 * la puede disparar un admin desde la pantalla, por si el servidor estuvo
 * caído el 1 de noviembre o hay que probarla.
 *
 * @param {object} opts
 * @param {number|null} opts.userId  quién la disparó; null si fue el proceso automático
 * @param {number} [opts.anio]       forzar una temporada concreta (solo para pruebas)
 */
export async function abrirTemporada({ userId = null, anio } = {}) {
  const temporada = anio ?? temporadaDe();
  const pendientes = await queryPendientesDeTemporada(temporada).select(
    'c.id',
    'c.estado',
    'c.nombres',
    'c.apellidos',
    'c.agente_id'
  );

  if (!pendientes.length) return { temporada, movidas: 0, ids: [] };

  const ids = pendientes.map((c) => c.id);
  await db('clientes').whereIn('id', ids).update({
    estado: 'pendiente_renovacion',
    renovacion_anio: temporada,
    renovacion_iniciada_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  // El historial necesita un autor y `cambiado_por` no acepta null, así
  // que cuando corre sola se firma con el agente dueño de la póliza y el
  // motivo deja claro que no lo hizo una persona.
  const motivo = `${APERTURA_RENOVACION_PREFIJO} Apertura de la temporada ${temporada} — la póliza pasó a renovación${userId ? '' : ' automáticamente'}.`;
  await db('historial_estados_cliente').insert(
    pendientes.map((c) => ({
      cliente_id: c.id,
      estado_anterior: c.estado,
      estado_nuevo: 'pendiente_renovacion',
      cambiado_por: userId ?? c.agente_id,
      motivo,
    }))
  );

  for (const c of pendientes) {
    await notificar(c.agente_id, {
      tipo: 'renovacion_abierta',
      clienteId: c.id,
      mensaje: `Renovación ${temporada}: ${c.nombres} ${c.apellidos} pasó a "Pendiente renovación".`,
    });
  }

  console.log(`[renovaciones] temporada ${temporada}: ${ids.length} pólizas pasaron a pendiente_renovacion`);
  return { temporada, movidas: ids.length, ids };
}

/**
 * Cuántas pólizas moverían si se abriera la temporada ahora mismo — para
 * que el admin vea el número antes de apretar el botón, y para la tarjeta
 * de estado del apartado.
 */
export async function resumenTemporada() {
  const temporada = temporadaDe();
  const [{ n: porEntrar }] = await queryPendientesDeTemporada(temporada).count('* as n');
  const porEstado = await db('clientes')
    .whereIn('estado', ESTADOS_RENOVACION)
    .select('estado')
    .count('* as n')
    .groupBy('estado');
  return {
    temporada,
    abre: `${temporada}-${String(RENOVACION_MES).padStart(2, '0')}-${String(RENOVACION_DIA).padStart(2, '0')}`,
    por_entrar: Number(porEntrar),
    por_estado: Object.fromEntries(porEstado.map((r) => [r.estado, Number(r.n)])),
  };
}

/* ───────────────────────── El listado ───────────────────────── */

/**
 * Listado del apartado Renovaciones, con la misma visibilidad por rol que
 * el resto del sistema: el agente ve las suyas, backoffice y supervisor las
 * de su empresa, admin todas.
 */
export async function listarRenovaciones(user, filters = {}) {
  const estados = filters.estados?.length
    ? filters.estados.filter((e) => ESTADOS_RENOVACION.includes(e))
    : ESTADOS_RENOVACION;

  const q = db('clientes as c')
    .leftJoin('usuarios_sistema as ag', 'ag.id', 'c.agente_id')
    .leftJoin('empresas as e', 'e.id', 'ag.empresa_id')
    .select(
      'c.id',
      'c.nombres',
      'c.apellidos',
      'c.correo_electronico',
      'c.phone_1',
      'c.estado',
      'c.renovacion_anio',
      'c.renovacion_iniciada_at',
      'c.submitted_at',
      'c.updated_at',
      'ag.name as agente_nombre',
      'e.nombre as empresa_nombre'
    )
    .whereIn('c.estado', estados)
    .orderBy('c.updated_at', 'desc')
    .limit(300);

  if (user.role === 'agente') {
    q.andWhere('c.agente_id', user.id);
  } else if (user.role === 'backoffice' || user.role === 'supervisor') {
    if (!user.empresa_id) throw forbidden('Tu cuenta no tiene una empresa asignada — pídele a un admin que la configure');
    q.andWhere('ag.empresa_id', user.empresa_id);
  }

  if (filters.anio) q.andWhere('c.renovacion_anio', filters.anio);
  if (filters.agenteId) q.andWhere('c.agente_id', filters.agenteId);
  if (filters.desde) q.andWhere('c.updated_at', '>=', filters.desde);
  if (filters.hasta) q.andWhere('c.updated_at', '<=', `${filters.hasta} 23:59:59`);
  if (filters.q) {
    const like = `%${filters.q}%`;
    // El ID cuenta como búsqueda exacta, igual que en la cola de BackOffice
    // — una renovación conserva el ID de la venta y es como la buscan.
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

/* ───────────────────────── Enviar a BackOffice ───────────────────────── */

/**
 * El agente terminó de gestionar la renovación y la manda a BackOffice —
 * el equivalente de "Finalizar" en una venta, pero desde
 * 'pendiente_renovacion' o 'rechazado_backoffice_renovacion' (el rechazo
 * reusa el mismo camino de corrección que una venta rechazada).
 *
 * Pide lo mismo que una venta MÁS una carta CMS firmada NUEVA: la firma
 * tiene que ser posterior a la apertura de la temporada, la de la venta
 * original no cuenta (decisión del usuario, 2026-10-27).
 */
export async function finalizarRenovacion(clienteId, userId) {
  const cliente = await getClienteOr404(clienteId);
  if (!ESTADOS_RENOVACION_AGENTE.includes(cliente.estado)) {
    throw conflict('Esta póliza no está en una renovación que puedas enviar a BackOffice');
  }

  const [ingresoTitular, plan, pago, categoriasSubidas, firmaNueva] = await Promise.all([
    db('ingresos').where({ cliente_id: clienteId }).whereNull('dependiente_id').first(),
    db('planes_salud').where({ cliente_id: clienteId, is_current: true }).first(),
    db('informacion_pago').where({ cliente_id: clienteId }).first(),
    db('evidencias').where({ cliente_id: clienteId }).whereNotNull('categoria').distinct('categoria'),
    // Firma POSTERIOR a la apertura de la temporada — no se importa
    // firmas.service.js para no crear un import circular, igual que en
    // finalizar().
    db('firmas_documentos')
      .where({ cliente_id: clienteId, estado: 'signed' })
      .andWhere('created_at', '>=', cliente.renovacion_iniciada_at ?? new Date(0))
      .orderBy('created_at', 'desc')
      .first(),
  ]);

  const faltantes = [];
  if (!ingresoTitular) faltantes.push('Ingresos del titular (paso 4)');
  if (!plan) faltantes.push('Plan de salud (paso 5)');
  const primaEsCero = plan && Number(plan.valor_prima) === 0;
  if (!pago && !primaEsCero) faltantes.push('Información de pago (paso 6)');
  const categoriasPresentes = new Set(categoriasSubidas.map((r) => r.categoria));
  for (const cat of CATEGORIA_EVIDENCIA_OBLIGATORIA) {
    if (!categoriasPresentes.has(cat)) faltantes.push(`Evidencia: ${CATEGORIA_EVIDENCIA_LABEL[cat]} (paso 7)`);
  }
  if (!firmaNueva) faltantes.push('Carta CMS nueva, firmada por el cliente en esta renovación');
  if (faltantes.length) throw badRequest('Faltan pasos por completar antes de enviar la renovación', faltantes);

  const nuevoEstado = 'pendiente_backoffice_renovacion';
  await db('clientes')
    .where({ id: clienteId })
    .update({ estado: nuevoEstado, submitted_at: db.fn.now(), updated_at: db.fn.now() });
  await logEstado(clienteId, cliente.estado, nuevoEstado, userId);

  const reenvio = cliente.estado === 'rechazado_backoffice_renovacion';
  await notificarRol('backoffice', {
    tipo: 'nuevo_pendiente',
    clienteId,
    mensaje: `Renovación ${reenvio ? 'reenviada' : 'nueva'}: ${cliente.nombres} ${cliente.apellidos} entró a la cola.`,
  });

  return getClienteOr404(clienteId);
}

/* ───────────────────────── Proceso automático ───────────────────────── */

const SEIS_HORAS_MS = 6 * 60 * 60 * 1000;

/**
 * Deja corriendo el chequeo de temporada: una vez al arrancar y después
 * cada 6 horas. No hace falta cron del sistema ni una dependencia nueva, y
 * como `abrirTemporada` es idempotente, repetir el chequeo no cuesta nada.
 *
 * Correrlo seguido (y no solo a medianoche del 1 de noviembre) es a
 * propósito: si el servidor está caído justo ese día, en cuanto vuelva
 * mueve las pólizas igual.
 */
export function arrancarTemporadaAutomatica() {
  const tick = async () => {
    try {
      await abrirTemporada({ userId: null });
    } catch (err) {
      console.error('[renovaciones] falló la apertura automática:', err.message);
    }
  };
  tick();
  const timer = setInterval(tick, SEIS_HORAS_MS);
  // Que este intervalo no sea motivo para mantener el proceso vivo.
  timer.unref?.();
  return timer;
}
