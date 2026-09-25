import { db } from '../../db/knex.js';
import { ESTADO_CLIENTE } from '../clientes/clientes.constants.js';

function applyFilters(q, filters = {}) {
  if (filters.estado) q.where('c.estado', filters.estado);
  if (filters.from) q.where('c.created_at', '>=', filters.from);
  if (filters.to) q.where('c.created_at', '<=', `${filters.to} 23:59:59`);
  if (filters.agenteId) q.where('c.agente_id', filters.agenteId);
  // Admin puede filtrar por empresa libremente (Vital / Vital Asiste); para
  // supervisor esto viene forzado desde admin.routes.js a la suya propia —
  // acá no hay diferencia entre ambos casos, solo se aplica el valor.
  if (filters.empresaId) {
    q.whereIn('c.agente_id', db('usuarios_sistema').select('id').where({ empresa_id: filters.empresaId }));
  }
  // Búsqueda libre (nombre/apellido/correo/SSN) + por ID exacto — a pedido
  // del usuario (2026-09-24), el reporte no tenía ningún buscador de texto.
  if (filters.q) {
    const like = `%${filters.q}%`;
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

/** Mismos filtros que applyFilters, pero para casos_postventa (join propio
 * a clientes -> agente -> empresa, ver casosPostventa.service.js). Fecha
 * sobre cp.created_at (cuándo se abrió el caso), no sobre el cliente. */
function applyFiltersPostventa(q, filters = {}) {
  if (filters.from) q.where('cp.created_at', '>=', filters.from);
  if (filters.to) q.where('cp.created_at', '<=', `${filters.to} 23:59:59`);
  if (filters.agenteId) q.where('c.agente_id', filters.agenteId);
  if (filters.empresaId) {
    q.whereIn('c.agente_id', db('usuarios_sistema').select('id').where({ empresa_id: filters.empresaId }));
  }
  return q;
}

export async function getDashboard(filters = {}) {
  const base = () => applyFilters(db('clientes as c'), filters);

  const porEstadoRows = await base().select('c.estado').count({ n: '*' }).groupBy('c.estado');
  const porEstado = Object.fromEntries(ESTADO_CLIENTE.map((e) => [e, 0]));
  for (const r of porEstadoRows) porEstado[r.estado] = Number(r.n);

  const porAgente = await base()
    .leftJoin('usuarios_sistema as ag', 'ag.id', 'c.agente_id')
    .select('ag.id as agente_id', 'ag.name as agente_nombre')
    .count({ total: 'c.id' })
    .sum({ aprobados: db.raw("CASE WHEN c.estado = 'aprobado' THEN 1 ELSE 0 END") })
    .groupBy('ag.id', 'ag.name')
    .orderBy('total', 'desc')
    .limit(20);

  // Registros por día + aprobados por día (fecha real de la transición a
  // 'aprobado', vía historial — no c.updated_at, que se sigue moviendo con
  // cualquier edición de postventa después de aprobar).
  const [tendenciaRegistros, tendenciaAprobados] = await Promise.all([
    base()
      .select(db.raw('DATE(c.created_at) as dia'))
      .count({ n: '*' })
      .groupBy(db.raw('DATE(c.created_at)'))
      .orderBy('dia', 'asc')
      .limit(90),
    applyFilters(db('historial_estados_cliente as h').join('clientes as c', 'c.id', 'h.cliente_id'), filters)
      .where('h.estado_nuevo', 'aprobado')
      .select(db.raw('DATE(h.created_at) as dia'))
      .count({ n: '*' })
      .groupBy(db.raw('DATE(h.created_at)'))
      .orderBy('dia', 'asc')
      .limit(90),
  ]);
  const aprobadosPorDia = new Map(tendenciaAprobados.map((r) => [String(r.dia), Number(r.n)]));
  const tendencia = tendenciaRegistros.map((r) => ({
    dia: String(r.dia),
    registros: Number(r.n),
    aprobados: aprobadosPorDia.get(String(r.dia)) ?? 0,
  }));

  const porOrigenRows = await base().select('c.origen_venta').count({ n: '*' }).groupBy('c.origen_venta');

  // Por empresa — admin ve las dos, supervisor ve la suya sola (ya forzada
  // desde parseFilters en admin.routes.js).
  const porEmpresaRows = await applyFilters(
    db('clientes as c').join('usuarios_sistema as ag', 'ag.id', 'c.agente_id').leftJoin('empresas as e', 'e.id', 'ag.empresa_id'),
    filters
  )
    .select('e.id as empresa_id', 'e.nombre as empresa_nombre')
    .count({ total: 'c.id' })
    .sum({ aprobados: db.raw("CASE WHEN c.estado = 'aprobado' THEN 1 ELSE 0 END") })
    .groupBy('e.id', 'e.nombre');

  // Aseguradoras más cotizadas (solo la versión vigente de cada plan).
  const aseguradorasRows = await applyFilters(
    db('planes_salud as p').join('clientes as c', 'c.id', 'p.cliente_id').join('aseguradoras as a', 'a.id', 'p.aseguradora_id'),
    filters
  )
    .where('p.is_current', true)
    .select('a.nombre as aseguradora')
    .count({ n: 'p.id' })
    .groupBy('a.nombre')
    .orderBy('n', 'desc')
    .limit(8);

  // Estado de la carta CMS (FirmaCloud) — cada envío cuenta (no solo el
  // último), filtrado por fecha de creación del cliente, igual que el
  // resto del panel.
  const firmasRows = await applyFilters(db('firmas_documentos as f').join('clientes as c', 'c.id', 'f.cliente_id'), filters)
    .select('f.estado')
    .count({ n: '*' })
    .groupBy('f.estado');

  // Postventa — join propio, ver applyFiltersPostventa.
  const [postventaPorTipoRows, postventaPorEstadoRows] = await Promise.all([
    applyFiltersPostventa(db('casos_postventa as cp').join('clientes as c', 'c.id', 'cp.cliente_id'), filters)
      .select('cp.tipo_caso')
      .count({ n: '*' })
      .groupBy('cp.tipo_caso')
      .orderBy('n', 'desc'),
    applyFiltersPostventa(db('casos_postventa as cp').join('clientes as c', 'c.id', 'cp.cliente_id'), filters)
      .select('cp.estado')
      .count({ n: '*' })
      .groupBy('cp.estado'),
  ]);

  // Tiempo promedio hasta aprobar (días), desde que se envió a BackOffice
  // hasta la transición real a 'aprobado' en el historial.
  const [{ dias: diasPromedioAprobacion }] = await applyFilters(
    db('historial_estados_cliente as h').join('clientes as c', 'c.id', 'h.cliente_id'),
    filters
  )
    .where('h.estado_nuevo', 'aprobado')
    .whereNotNull('c.submitted_at')
    .select(db.raw('AVG(TIMESTAMPDIFF(HOUR, c.submitted_at, h.created_at)) / 24 as dias'));

  const total = Object.values(porEstado).reduce((s, n) => s + n, 0);
  const tasaAprobacion = total ? porEstado.aprobado / total : null;

  return {
    total,
    tasa_aprobacion: tasaAprobacion,
    dias_promedio_aprobacion: diasPromedioAprobacion != null ? Number(diasPromedioAprobacion) : null,
    por_estado: porEstado,
    por_agente: porAgente.map((r) => ({
      agente_id: r.agente_id,
      agente_nombre: r.agente_nombre || '—',
      total: Number(r.total),
      aprobados: Number(r.aprobados || 0),
    })),
    tendencia,
    por_origen: porOrigenRows.map((r) => ({ origen_venta: r.origen_venta, total: Number(r.n) })),
    por_empresa: porEmpresaRows.map((r) => ({
      empresa_id: r.empresa_id,
      empresa_nombre: r.empresa_nombre || 'Sin empresa',
      total: Number(r.total),
      aprobados: Number(r.aprobados || 0),
    })),
    aseguradoras: aseguradorasRows.map((r) => ({ aseguradora: r.aseguradora, total: Number(r.n) })),
    firmas: firmasRows.map((r) => ({ estado: r.estado, total: Number(r.n) })),
    postventa: {
      por_tipo: postventaPorTipoRows.map((r) => ({ tipo_caso: r.tipo_caso, total: Number(r.n) })),
      por_estado: postventaPorEstadoRows.map((r) => ({ estado: r.estado, total: Number(r.n) })),
    },
  };
}

const REPORTE_COLS = [
  'c.id',
  'c.nombres',
  'c.apellidos',
  'c.social',
  'c.correo_electronico',
  'c.phone_1',
  'c.estado',
  'c.estado_us',
  'c.ciudad',
  'c.origen_venta',
  'c.created_at',
  'c.submitted_at',
];

export async function reporte(filters = {}, { page = 1, pageSize = 50 } = {}) {
  const base = () =>
    applyFilters(db('clientes as c').leftJoin('usuarios_sistema as ag', 'ag.id', 'c.agente_id'), filters);

  const [{ n: total }] = await base().count({ n: 'c.id' });
  const rows = await base()
    .select(...REPORTE_COLS, 'ag.name as agente_nombre')
    .orderBy('c.created_at', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    page,
    page_size: pageSize,
    total: Number(total),
    total_pages: Math.ceil(Number(total) / pageSize) || 1,
    rows,
  };
}

const CSV_COLS = [
  ['id', (x) => x.id],
  ['nombres', (x) => x.nombres],
  ['apellidos', (x) => x.apellidos],
  ['social', (x) => x.social],
  ['correo_electronico', (x) => x.correo_electronico],
  ['telefono', (x) => x.phone_1],
  ['estado', (x) => x.estado],
  ['estado_us', (x) => x.estado_us],
  ['ciudad', (x) => x.ciudad],
  ['origen_venta', (x) => x.origen_venta],
  ['agente', (x) => x.agente_nombre],
  ['creado', (x) => x.created_at],
  ['enviado_backoffice', (x) => x.submitted_at],
];

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function streamReporteCsv(filters, res) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="reporte_vital_${Date.now()}.csv"`);
  res.write('﻿');
  res.write(CSV_COLS.map((c) => c[0]).join(';') + '\r\n');

  const pageSize = 500;
  let page = 1;
  // tope de 20 000 filas, igual que el resto de exports del stack.
  for (let i = 0; i < 40; i++) {
    const { rows } = await reporte(filters, { page, pageSize });
    if (!rows.length) break;
    for (const row of rows) {
      res.write(CSV_COLS.map((c) => csvCell(c[1](row))).join(';') + '\r\n');
    }
    if (rows.length < pageSize) break;
    page += 1;
  }
  res.end();
}

/**
 * "Papelera" — clientes_eliminados, la foto que deja eliminarCliente() en
 * clientes.service.js antes de borrar (2026-09-26, pedido del usuario).
 * Ya viene desnormalizada (agente_nombre/empresa_id guardados tal cual al
 * momento de eliminar), así que no hace falta ningún join.
 */
function applyFiltersPapelera(q, filters = {}) {
  if (filters.agenteId) q.where('agente_id', filters.agenteId);
  if (filters.empresaId) q.where('empresa_id', filters.empresaId);
  if (filters.desde) q.where('created_at', '>=', `${filters.desde} 00:00:00`);
  if (filters.hasta) q.where('created_at', '<=', `${filters.hasta} 23:59:59`);
  if (filters.q) {
    const like = `%${filters.q}%`;
    const comoId = Number.isInteger(Number(filters.q)) ? Number(filters.q) : null;
    q.where((b) => {
      b.where('nombres', 'like', like)
        .orWhere('apellidos', 'like', like)
        .orWhere('correo_electronico', 'like', like)
        .orWhere('social', 'like', like)
        .orWhere('agente_nombre', 'like', like);
      if (comoId !== null) b.orWhere('cliente_id_original', comoId);
    });
  }
  return q;
}

export async function papelera(filters = {}, { page = 1, pageSize = 50 } = {}) {
  const base = () => applyFiltersPapelera(db('clientes_eliminados'), filters);

  const [{ n: total }] = await base().count({ n: 'id' });
  const rows = await base()
    .orderBy('created_at', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    page,
    page_size: pageSize,
    total: Number(total),
    total_pages: Math.ceil(Number(total) / pageSize) || 1,
    rows,
  };
}
