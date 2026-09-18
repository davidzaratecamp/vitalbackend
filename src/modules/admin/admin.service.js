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

  const tendencia = await base()
    .select(db.raw('DATE(c.created_at) as dia'))
    .count({ n: '*' })
    .groupBy(db.raw('DATE(c.created_at)'))
    .orderBy('dia', 'asc')
    .limit(90);

  const total = Object.values(porEstado).reduce((s, n) => s + n, 0);
  const tasaAprobacion = total ? porEstado.aprobado / total : null;

  return {
    total,
    tasa_aprobacion: tasaAprobacion,
    por_estado: porEstado,
    por_agente: porAgente.map((r) => ({
      agente_id: r.agente_id,
      agente_nombre: r.agente_nombre || '—',
      total: Number(r.total),
      aprobados: Number(r.aprobados || 0),
    })),
    tendencia: tendencia.map((r) => ({ dia: r.dia, calls: Number(r.n) })),
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
