import ExcelJS from 'exceljs';
import { db } from '../../db/knex.js';
import { ESTADO_CLIENTE, ESTADO_CLIENTE_LABEL, CATEGORIA_EVIDENCIA_LABEL } from '../clientes/clientes.constants.js';
import { PAGO_COLUMNS_PUBLICAS } from '../clientes/clientes.service.js';

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

/* ───────────────────────── Export completo (Excel) ─────────────────────────
 * (2026-09-30, pedido del usuario: "el export del CRM me traiga toda la
 * información de los formularios de ventas" — el CSV de arriba (CSV_COLS)
 * se queda tal cual, esto es un archivo NUEVO y separado, un .xlsx de
 * verdad (con ExcelJS, no un CSV con extensión cambiada) con una hoja por
 * paso del formulario de 7 pasos — Titular, Cónyuge, Dependientes,
 * Ingresos, Plan de salud, Pago, Evidencias — igual que se ve en el
 * formulario, pero en tablas que el admin puede filtrar/cruzar en Excel.
 * Respeta los mismos filtros que el reporte (empresa, agente, estado,
 * fechas, búsqueda) — solo se traen los hijos (cónyuge/dependientes/etc.)
 * de los clientes que ya pasaron ese filtro. Nunca incluye
 * `numero_tarjeta_cifrado`, `data_point` ni `respuesta_seguridad` — ver
 * PAGO_COLUMNS_PUBLICAS (clientes.service.js) para el pago.
 */
const TITULAR_EXCEL_COLS = [
  'c.id',
  'c.estado',
  'c.solicita_cobertura',
  'c.nombres',
  'c.apellidos',
  'c.sexo',
  'c.fecha_nacimiento',
  'c.social',
  'c.estatus_migratorio',
  'c.direccion',
  'c.tipo_vivienda',
  'c.estado_us',
  'c.condado',
  'c.ciudad',
  'c.codigo_postal',
  'c.correo_electronico',
  'c.phone_1',
  'c.phone_2',
  'c.whatsapp',
  'c.horario_contactabilidad',
  'c.contacto_emergencia_nombre',
  'c.contacto_emergencia_telefono',
  'c.contacto_emergencia_email',
  'c.origen_venta',
  'c.pregunta_seguridad',
  'c.created_at',
  'c.submitted_at',
];

/** Mismo tope de 20 000 filas que streamReporteCsv (40 páginas de 500) —
 * junta TODOS los titulares que pasan el filtro, sin paginar hacia afuera
 * (el archivo completo se genera de una). */
async function obtenerTitularesParaExcel(filters) {
  const base = () =>
    applyFilters(
      db('clientes as c').leftJoin('usuarios_sistema as ag', 'ag.id', 'c.agente_id').leftJoin('empresas as emp', 'emp.id', 'ag.empresa_id'),
      filters
    );
  const out = [];
  const pageSize = 500;
  for (let page = 1; page <= 40; page++) {
    const rows = await base()
      .select(...TITULAR_EXCEL_COLS, 'ag.name as agente_nombre', 'emp.nombre as empresa_nombre')
      .orderBy('c.created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

function siNo(v) {
  return v ? 'Sí' : 'No';
}

/**
 * Secciones del reporte de una sola hoja (2026-10-05, pedido del usuario:
 * "actualmente tenemos 7 hojas... me lo están pidiendo en solo una, algo
 * muy bien organizado, con los colores respectivos para no confundirse").
 * Cada sección es un color — banda sólida en la fila 1 (nombre de la
 * sección, celdas combinadas) + tono claro del mismo color en la fila 2
 * (nombre de cada columna). `key` tiene que existir como columna real del
 * sheet (`construirColumnas`) y como propiedad del objeto que arma cada
 * fila en el loop principal más abajo.
 */
const SECCIONES_EXCEL = [
  {
    nombre: 'IDENTIFICACIÓN',
    color: 'FF334155', // slate-700
    claro: 'FFE2E8F0', // slate-200
    cols: [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Estado', key: 'estado', width: 24 },
      { header: 'Agente', key: 'agente_nombre', width: 22 },
      { header: 'Empresa', key: 'empresa_nombre', width: 13 },
      { header: 'Creado', key: 'created_at', width: 17 },
      { header: 'Enviado a BackOffice', key: 'submitted_at', width: 17 },
    ],
  },
  {
    nombre: 'TITULAR',
    color: 'FF1D4ED8', // blue-700
    claro: 'FFDBEAFE', // blue-100
    cols: [
      { header: 'Nombres', key: 'nombres', width: 16 },
      { header: 'Apellidos', key: 'apellidos', width: 16 },
      { header: 'Sexo', key: 'sexo', width: 9 },
      { header: 'Fecha nac.', key: 'fecha_nacimiento', width: 12 },
      { header: 'SSN', key: 'social', width: 11 },
      { header: 'Estatus migratorio', key: 'estatus_migratorio', width: 17 },
      { header: 'Dirección', key: 'direccion', width: 26 },
      { header: 'Tipo vivienda', key: 'tipo_vivienda', width: 13 },
      { header: 'Estado (US)', key: 'estado_us', width: 10 },
      { header: 'Condado', key: 'condado', width: 14 },
      { header: 'Ciudad', key: 'ciudad', width: 14 },
      { header: 'C.P.', key: 'codigo_postal', width: 8 },
      { header: 'Correo', key: 'correo_electronico', width: 25 },
      { header: 'Teléfono 1', key: 'phone_1', width: 13 },
      { header: 'Teléfono 2', key: 'phone_2', width: 13 },
      { header: 'WhatsApp', key: 'whatsapp', width: 13 },
      { header: 'Horario contacto', key: 'horario_contactabilidad', width: 15 },
      { header: 'Contacto emergencia', key: 'contacto_emergencia_nombre', width: 18 },
      { header: 'Tel. emergencia', key: 'contacto_emergencia_telefono', width: 14 },
      { header: 'Correo emergencia', key: 'contacto_emergencia_email', width: 22 },
      { header: 'Origen venta', key: 'origen_venta', width: 11 },
      { header: 'Pregunta seguridad', key: 'pregunta_seguridad', width: 19 },
      { header: 'Solicita cobertura', key: 'solicita_cobertura', width: 13 },
    ],
  },
  {
    nombre: 'CÓNYUGE',
    color: 'FFBE185D', // pink-700
    claro: 'FFFCE7F3', // pink-100
    cols: [
      { header: 'Tiene cónyuge', key: 'conyuge_tiene', width: 11 },
      { header: 'Nombre', key: 'conyuge_nombre', width: 20 },
      { header: 'SSN', key: 'conyuge_ssn', width: 11 },
      { header: 'Fecha nac.', key: 'conyuge_fecha_nacimiento', width: 12 },
      { header: 'Estatus migratorio', key: 'conyuge_estatus_migratorio', width: 17 },
      { header: 'Solicita cobertura', key: 'conyuge_solicita_cobertura', width: 13 },
      { header: 'Medicare/Medicaid', key: 'conyuge_medicare', width: 15 },
    ],
  },
  {
    nombre: 'DEPENDIENTES',
    color: 'FFB45309', // amber-700
    claro: 'FFFEF3C7', // amber-100
    cols: [
      { header: 'Cantidad', key: 'dependientes_cantidad', width: 9 },
      { header: 'Detalle (nombre, parentesco, nac., SSN, estatus)', key: 'dependientes_detalle', width: 55 },
    ],
  },
  {
    nombre: 'INGRESOS',
    color: 'FF15803D', // green-700
    claro: 'FFDCFCE7', // green-100
    cols: [
      { header: 'Declaración', key: 'ingresos_declaracion', width: 11 },
      { header: 'Anuales (titular)', key: 'ingresos_anuales_titular', width: 15 },
      { header: 'Semanales (titular)', key: 'ingresos_semanales_titular', width: 16 },
      { header: 'Total familia', key: 'ingresos_total_familia', width: 13 },
    ],
  },
  {
    nombre: 'PLAN DE SALUD',
    color: 'FF0F766E', // teal-700
    claro: 'FFCCFBF1', // teal-100
    cols: [
      { header: 'Aseguradora', key: 'plan_aseguradora', width: 16 },
      { header: 'Plan', key: 'plan_nombre', width: 22 },
      { header: 'Tipo metal', key: 'plan_tipo_metal', width: 10 },
      { header: 'Tipo red', key: 'plan_tipo_red', width: 9 },
      { header: 'Deducible', key: 'plan_deducible', width: 11 },
      { header: 'Gasto máx. bolsillo', key: 'plan_gasto_max', width: 16 },
      { header: 'Prima mensual', key: 'plan_prima', width: 12 },
      { header: 'NPN', key: 'plan_npn', width: 12 },
      { header: 'Estado prima', key: 'plan_estado_prima', width: 14 },
      { header: 'Productor (NPN)', key: 'plan_productor', width: 18 },
    ],
  },
  {
    nombre: 'PAGO',
    color: 'FF6D28D9', // violet-700
    claro: 'FFEDE9FE', // violet-100
    cols: [
      { header: 'Método', key: 'pago_metodo', width: 15 },
      { header: 'Tarjeta (últ. 4)', key: 'pago_tarjeta_4', width: 12 },
      { header: 'Marca', key: 'pago_marca', width: 10 },
      { header: 'Nombre en tarjeta', key: 'pago_nombre_tarjeta', width: 18 },
      { header: 'Vence', key: 'pago_vence', width: 9 },
      { header: 'Banco', key: 'pago_banco', width: 16 },
      { header: 'N° de ruta', key: 'pago_ruta', width: 12 },
      { header: 'Cuenta (últ. 4)', key: 'pago_cuenta_4', width: 12 },
    ],
  },
  {
    nombre: 'FIRMA',
    color: 'FF047857', // emerald-700
    claro: 'FFD1FAE5', // emerald-100
    cols: [
      { header: 'Estado', key: 'firma_estado', width: 12 },
      { header: 'Canal', key: 'firma_canal', width: 10 },
      { header: 'Enviado el', key: 'firma_enviado', width: 16 },
      { header: 'Firmado el', key: 'firma_firmado', width: 16 },
    ],
  },
  {
    nombre: 'EVIDENCIAS',
    color: 'FFBE123C', // rose-700
    claro: 'FFFFE4E6', // rose-100
    cols: [
      { header: 'Cantidad', key: 'evidencias_cantidad', width: 9 },
      { header: 'Detalle (categoría: archivo)', key: 'evidencias_detalle', width: 45 },
    ],
  },
];

// Pastel por estado de la venta, mismo lenguaje de color que ya usa el
// resto de Vital (ESTADO_CLIENTE_COLOR en el frontend) — para que la
// columna "Estado" se lea de un vistazo sin tener que leer el texto.
const ESTADO_FILL_EXCEL = {
  aprobado: 'FFDCFCE7',
  rechazado_backoffice: 'FFFEE2E2',
  pendiente_backoffice: 'FFFEF3C7',
  pendiente_llamada_tripartita: 'FFE0F2FE',
  borrador: 'FFF1F5F9',
};
const ESTADO_FONT_EXCEL = {
  aprobado: 'FF15803D',
  rechazado_backoffice: 'FFB91C1C',
  pendiente_backoffice: 'FFB45309',
  pendiente_llamada_tripartita: 'FF0369A1',
  borrador: 'FF475569',
};

function agruparPorCliente(rows) {
  const out = {};
  for (const r of rows) (out[r.cliente_id] ??= []).push(r);
  return out;
}

function resumenDependientes(deps) {
  if (!deps.length) return '';
  return deps
    .map((d) => `${d.nombres} ${d.apellidos} (${d.parentesco}, nac. ${d.fecha_nacimiento}${d.social ? `, SSN ${d.social}` : ''}, ${d.estatus_migratorio})`)
    .join(' | ');
}

function resumenEvidencias(evs) {
  if (!evs.length) return '';
  return evs.map((e) => `${CATEGORIA_EVIDENCIA_LABEL[e.categoria] ?? 'Otro'}: ${e.nombre_archivo}`).join(' | ');
}

/** Arma el array plano de columnas para `sheet.columns` y, de paso, le
 * anota a cada sección en qué número de columna empieza/termina — lo
 * necesita el pintado de bandas de color de más abajo. */
function construirColumnasExcel(secciones) {
  const columnas = [];
  let col = 1;
  for (const sec of secciones) {
    sec.inicio = col;
    for (const c of sec.cols) {
      columnas.push({ key: c.key, width: c.width });
      col += 1;
    }
    sec.fin = col - 1;
  }
  return columnas;
}

export async function streamReporteExcel(filters, res) {
  const titulares = await obtenerTitularesParaExcel(filters);
  const ids = titulares.map((c) => c.id);

  const [conyuges, dependientes, ingresos, planes, pagos, evidencias, firmasRows] = ids.length
    ? await Promise.all([
        db('dependientes').where({ parentesco: 'Conyuge' }).whereIn('cliente_id', ids).orderBy('cliente_id'),
        db('dependientes').whereNot('parentesco', 'Conyuge').whereIn('cliente_id', ids).orderBy('cliente_id'),
        db('ingresos').whereIn('cliente_id', ids).orderBy('cliente_id'),
        db('planes_salud as p')
          .leftJoin('aseguradoras as a', 'a.id', 'p.aseguradora_id')
          .leftJoin('npn_productores as np', 'np.id', 'p.npn_productor_id')
          .select('p.*', 'a.nombre as aseguradora_nombre', 'np.nombre as npn_productor_nombre')
          .where('p.is_current', true)
          .whereIn('p.cliente_id', ids)
          .orderBy('p.cliente_id'),
        db('informacion_pago').select(PAGO_COLUMNS_PUBLICAS).whereIn('cliente_id', ids).orderBy('cliente_id'),
        db('evidencias').whereIn('cliente_id', ids).orderBy(['cliente_id', 'id']),
        db('firmas_documentos').select('cliente_id', 'estado', 'canal', 'enviado_at', 'firmado_at').whereIn('cliente_id', ids).orderBy('created_at', 'desc'),
      ])
    : [[], [], [], [], [], [], []];

  // Última firma por cliente — firmasRows viene ordenado desc, nos quedamos
  // con la primera aparición de cada cliente_id.
  const firmaPorCliente = {};
  for (const f of firmasRows) if (!firmaPorCliente[f.cliente_id]) firmaPorCliente[f.cliente_id] = f;
  const planPorCliente = Object.fromEntries(planes.map((p) => [p.cliente_id, p]));
  const pagoPorCliente = Object.fromEntries(pagos.map((p) => [p.cliente_id, p]));
  const conyugePorCliente = Object.fromEntries(conyuges.map((c) => [c.cliente_id, c]));
  const depsPorCliente = agruparPorCliente(dependientes);
  const ingresosPorCliente = agruparPorCliente(ingresos);
  const evidenciasPorCliente = agruparPorCliente(evidencias);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vital';
  wb.created = new Date();

  const sh = wb.addWorksheet('Reporte de ventas', {
    pageSetup: { orientation: 'landscape' },
    properties: { defaultRowHeight: 18 },
  });
  sh.columns = construirColumnasExcel(SECCIONES_EXCEL);

  // Fila 1: nombre de cada sección, combinado sobre sus columnas, en el
  // color sólido de la sección. Fila 2: encabezado real de cada columna,
  // en el tono claro del mismo color — así cualquiera distingue de un
  // vistazo "esto es Cónyuge", "esto es Pago", etc. sin tener que leer
  // cada encabezado uno por uno.
  for (const sec of SECCIONES_EXCEL) {
    if (sec.fin > sec.inicio) sh.mergeCells(1, sec.inicio, 1, sec.fin);
    for (let c = sec.inicio; c <= sec.fin; c += 1) {
      const cell = sh.getCell(1, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sec.color } };
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFFFFFFF' } },
        left: { style: 'thin', color: { argb: 'FFFFFFFF' } },
        right: { style: 'thin', color: { argb: 'FFFFFFFF' } },
      };
    }
    sh.getCell(1, sec.inicio).value = sec.nombre;

    sec.cols.forEach((c, i) => {
      const colNum = sec.inicio + i;
      const cell = sh.getCell(2, colNum);
      cell.value = c.header;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sec.claro } };
      cell.font = { bold: true, size: 10, color: { argb: 'FF1E293B' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'medium', color: { argb: sec.color } } };
    });
  }
  sh.getRow(1).height = 22;
  sh.getRow(2).height = 36;
  // Congela toda la sección IDENTIFICACIÓN (6 columnas) + las 2 filas de
  // encabezado — al desplazarse hacia la derecha por Titular/Cónyuge/etc.
  // siempre se sigue viendo a quién pertenece cada fila.
  sh.views = [{ state: 'frozen', xSplit: SECCIONES_EXCEL[0].fin, ySplit: 2 }];
  sh.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: SECCIONES_EXCEL.at(-1).fin } };

  let rowIndex = 3;
  for (const c of titulares) {
    const plan = planPorCliente[c.id];
    const pago = pagoPorCliente[c.id];
    const firma = firmaPorCliente[c.id];
    const conyuge = conyugePorCliente[c.id];
    const deps = depsPorCliente[c.id] ?? [];
    const evs = evidenciasPorCliente[c.id] ?? [];
    const ingresosCliente = ingresosPorCliente[c.id] ?? [];
    const ingresoTitular = ingresosCliente.find((i) => !i.dependiente_id);
    const totalFamilia = ingresosCliente.reduce((s, i) => s + Number(i.ingresos_anuales || 0), 0);

    const row = sh.addRow({
      id: c.id,
      estado: ESTADO_CLIENTE_LABEL[c.estado] ?? c.estado,
      agente_nombre: c.agente_nombre,
      empresa_nombre: c.empresa_nombre,
      created_at: c.created_at,
      submitted_at: c.submitted_at,

      nombres: c.nombres,
      apellidos: c.apellidos,
      sexo: c.sexo,
      fecha_nacimiento: c.fecha_nacimiento,
      social: c.social,
      estatus_migratorio: c.estatus_migratorio,
      direccion: c.direccion,
      tipo_vivienda: c.tipo_vivienda,
      estado_us: c.estado_us,
      condado: c.condado,
      ciudad: c.ciudad,
      codigo_postal: c.codigo_postal,
      correo_electronico: c.correo_electronico,
      phone_1: c.phone_1,
      phone_2: c.phone_2,
      whatsapp: c.whatsapp,
      horario_contactabilidad: c.horario_contactabilidad,
      contacto_emergencia_nombre: c.contacto_emergencia_nombre,
      contacto_emergencia_telefono: c.contacto_emergencia_telefono,
      contacto_emergencia_email: c.contacto_emergencia_email,
      origen_venta: c.origen_venta,
      pregunta_seguridad: c.pregunta_seguridad,
      solicita_cobertura: siNo(c.solicita_cobertura),

      conyuge_tiene: siNo(!!conyuge),
      conyuge_nombre: conyuge ? `${conyuge.nombres} ${conyuge.apellidos}` : '',
      conyuge_ssn: conyuge?.social ?? '',
      conyuge_fecha_nacimiento: conyuge?.fecha_nacimiento ?? '',
      conyuge_estatus_migratorio: conyuge?.estatus_migratorio ?? '',
      conyuge_solicita_cobertura: conyuge ? siNo(conyuge.solicita_cobertura) : '',
      conyuge_medicare: conyuge ? siNo(conyuge.medicare_medicaid) : '',

      dependientes_cantidad: deps.length,
      dependientes_detalle: resumenDependientes(deps),

      ingresos_declaracion: ingresoTitular?.tipo_declaracion ?? '',
      ingresos_anuales_titular: ingresoTitular?.ingresos_anuales ?? '',
      ingresos_semanales_titular: ingresoTitular?.ingresos_semanales ?? '',
      ingresos_total_familia: totalFamilia || '',

      plan_aseguradora: plan?.aseguradora_nombre ?? '',
      plan_nombre: plan?.nombre_plan ?? '',
      plan_tipo_metal: plan?.tipo_metal ?? '',
      plan_tipo_red: plan?.tipo_red ?? '',
      plan_deducible: plan?.deducible ?? '',
      plan_gasto_max: plan?.gasto_max_bolsillo ?? '',
      plan_prima: plan?.valor_prima ?? '',
      plan_npn: plan?.npn ?? '',
      plan_estado_prima: plan?.estado_prima ?? '',
      plan_productor: plan?.npn_productor_nombre ?? '',

      pago_metodo: pago?.metodo ?? '',
      pago_tarjeta_4: pago?.ultimos_4_digitos ?? '',
      pago_marca: pago?.marca_tarjeta ?? '',
      pago_nombre_tarjeta: pago?.nombre_titular_tarjeta ?? '',
      pago_vence: pago?.fecha_expiracion_mes ? `${pago.fecha_expiracion_mes}/${pago.fecha_expiracion_ano}` : '',
      pago_banco: pago?.nombre_banco ?? '',
      pago_ruta: pago?.numero_ruta ?? '',
      pago_cuenta_4: pago?.ultimos_4_cuenta ?? '',

      firma_estado: firma?.estado ?? '',
      firma_canal: firma?.canal ?? '',
      firma_enviado: firma?.enviado_at ?? '',
      firma_firmado: firma?.firmado_at ?? '',

      evidencias_cantidad: evs.length,
      evidencias_detalle: resumenEvidencias(evs),
    });

    // Cebrado suave + un borde de color al inicio de cada sección, para
    // que la agrupación por color se note también bajando por los datos,
    // no solo en el encabezado.
    const esPar = rowIndex % 2 === 0;
    for (const sec of SECCIONES_EXCEL) {
      for (let c2 = sec.inicio; c2 <= sec.fin; c2 += 1) {
        const cell = row.getCell(c2);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: esPar ? 'FFF8FAFC' : 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', wrapText: c2 === sec.fin && (sec.nombre === 'DEPENDIENTES' || sec.nombre === 'EVIDENCIAS') };
        if (c2 === sec.inicio) cell.border = { left: { style: 'medium', color: { argb: sec.color } } };
      }
    }
    // La columna Estado lleva su propio color, pisando el cebrado — es la
    // que más importa distinguir de un vistazo.
    const estadoCell = row.getCell('estado');
    estadoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ESTADO_FILL_EXCEL[c.estado] ?? 'FFF1F5F9' } };
    estadoCell.font = { bold: true, color: { argb: ESTADO_FONT_EXCEL[c.estado] ?? 'FF475569' } };
    estadoCell.alignment = { horizontal: 'center', vertical: 'middle' };

    rowIndex += 1;
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="reporte_vital_${Date.now()}.xlsx"`);
  await wb.xlsx.write(res);
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
