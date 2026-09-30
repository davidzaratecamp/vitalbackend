import ExcelJS from 'exceljs';
import { db } from '../../db/knex.js';
import { ESTADO_CLIENTE } from '../clientes/clientes.constants.js';
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

function encabezado(sheet) {
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
}

export async function streamReporteExcel(filters, res) {
  const titulares = await obtenerTitularesParaExcel(filters);
  const ids = titulares.map((c) => c.id);
  const nombrePorId = Object.fromEntries(titulares.map((c) => [c.id, `${c.nombres} ${c.apellidos}`]));

  const [conyuges, dependientes, ingresos, planes, pagos, evidencias, firmasRows] = ids.length
    ? await Promise.all([
        db('dependientes').where({ parentesco: 'Conyuge' }).whereIn('cliente_id', ids).orderBy('cliente_id'),
        db('dependientes').whereNot('parentesco', 'Conyuge').whereIn('cliente_id', ids).orderBy('cliente_id'),
        db('ingresos as i')
          .leftJoin('dependientes as d', 'd.id', 'i.dependiente_id')
          .select('i.*', 'd.nombres as dependiente_nombres', 'd.apellidos as dependiente_apellidos')
          .whereIn('i.cliente_id', ids)
          .orderBy('i.cliente_id'),
        db('planes_salud as p')
          .leftJoin('aseguradoras as a', 'a.id', 'p.aseguradora_id')
          .leftJoin('npn_productores as np', 'np.id', 'p.npn_productor_id')
          .select('p.*', 'a.nombre as aseguradora_nombre', 'np.nombre as npn_productor_nombre', 'np.npn as npn_productor_npn')
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

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vital';
  wb.created = new Date();

  const shTitular = wb.addWorksheet('Titulares');
  shTitular.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Estado', key: 'estado', width: 22 },
    { header: 'Agente', key: 'agente_nombre', width: 22 },
    { header: 'Empresa', key: 'empresa_nombre', width: 16 },
    { header: 'Nombres', key: 'nombres', width: 18 },
    { header: 'Apellidos', key: 'apellidos', width: 18 },
    { header: 'Sexo', key: 'sexo', width: 10 },
    { header: 'Fecha nacimiento', key: 'fecha_nacimiento', width: 14 },
    { header: 'SSN', key: 'social', width: 12 },
    { header: 'Estatus migratorio', key: 'estatus_migratorio', width: 18 },
    { header: 'Solicita cobertura', key: 'solicita_cobertura', width: 14 },
    { header: 'Dirección', key: 'direccion', width: 28 },
    { header: 'Tipo vivienda', key: 'tipo_vivienda', width: 14 },
    { header: 'Estado (US)', key: 'estado_us', width: 10 },
    { header: 'Condado', key: 'condado', width: 16 },
    { header: 'Ciudad', key: 'ciudad', width: 16 },
    { header: 'Código postal', key: 'codigo_postal', width: 12 },
    { header: 'Correo', key: 'correo_electronico', width: 26 },
    { header: 'Teléfono 1', key: 'phone_1', width: 14 },
    { header: 'Teléfono 2', key: 'phone_2', width: 14 },
    { header: 'WhatsApp', key: 'whatsapp', width: 14 },
    { header: 'Horario de contacto', key: 'horario_contactabilidad', width: 18 },
    { header: 'Contacto emergencia', key: 'contacto_emergencia_nombre', width: 20 },
    { header: 'Tel. emergencia', key: 'contacto_emergencia_telefono', width: 16 },
    { header: 'Correo emergencia', key: 'contacto_emergencia_email', width: 24 },
    { header: 'Origen de venta', key: 'origen_venta', width: 14 },
    { header: 'Pregunta de seguridad', key: 'pregunta_seguridad', width: 24 },
    { header: 'Aseguradora', key: 'aseguradora_nombre', width: 18 },
    { header: 'Plan', key: 'nombre_plan', width: 22 },
    { header: 'Tipo metal', key: 'tipo_metal', width: 12 },
    { header: 'Prima mensual', key: 'valor_prima', width: 14 },
    { header: 'Método de pago', key: 'metodo', width: 14 },
    { header: 'Tarjeta (últimos 4)', key: 'ultimos_4_digitos', width: 16 },
    { header: 'Cuenta (últimos 4)', key: 'ultimos_4_cuenta', width: 16 },
    { header: 'Estado de firma', key: 'firma_estado', width: 14 },
    { header: 'Firmado el', key: 'firmado_at', width: 18 },
    { header: 'Creado', key: 'created_at', width: 18 },
    { header: 'Enviado a BackOffice', key: 'submitted_at', width: 18 },
  ];
  encabezado(shTitular);
  for (const c of titulares) {
    const plan = planPorCliente[c.id];
    const pago = pagoPorCliente[c.id];
    const firma = firmaPorCliente[c.id];
    shTitular.addRow({
      ...c,
      solicita_cobertura: siNo(c.solicita_cobertura),
      aseguradora_nombre: plan?.aseguradora_nombre ?? '',
      nombre_plan: plan?.nombre_plan ?? '',
      tipo_metal: plan?.tipo_metal ?? '',
      valor_prima: plan?.valor_prima ?? '',
      metodo: pago?.metodo ?? '',
      ultimos_4_digitos: pago?.ultimos_4_digitos ?? '',
      ultimos_4_cuenta: pago?.ultimos_4_cuenta ?? '',
      firma_estado: firma?.estado ?? '',
      firmado_at: firma?.firmado_at ?? '',
    });
  }

  const shConyuge = wb.addWorksheet('Cónyuges');
  shConyuge.columns = [
    { header: 'Cliente ID', key: 'cliente_id', width: 10 },
    { header: 'Titular', key: 'titular', width: 22 },
    { header: 'Nombres', key: 'nombres', width: 18 },
    { header: 'Apellidos', key: 'apellidos', width: 18 },
    { header: 'Sexo', key: 'sexo', width: 10 },
    { header: 'Fecha nacimiento', key: 'fecha_nacimiento', width: 14 },
    { header: 'SSN', key: 'social', width: 12 },
    { header: 'Estatus migratorio', key: 'estatus_migratorio', width: 18 },
    { header: 'Solicita cobertura', key: 'solicita_cobertura', width: 14 },
    { header: 'Medicare/Medicaid', key: 'medicare_medicaid', width: 16 },
  ];
  encabezado(shConyuge);
  for (const cy of conyuges) {
    shConyuge.addRow({ ...cy, titular: nombrePorId[cy.cliente_id] ?? '', solicita_cobertura: siNo(cy.solicita_cobertura), medicare_medicaid: siNo(cy.medicare_medicaid) });
  }

  const shDep = wb.addWorksheet('Dependientes');
  shDep.columns = [
    { header: 'Cliente ID', key: 'cliente_id', width: 10 },
    { header: 'Titular', key: 'titular', width: 22 },
    { header: 'Parentesco', key: 'parentesco', width: 12 },
    { header: 'Nombres', key: 'nombres', width: 18 },
    { header: 'Apellidos', key: 'apellidos', width: 18 },
    { header: 'Sexo', key: 'sexo', width: 10 },
    { header: 'Fecha nacimiento', key: 'fecha_nacimiento', width: 14 },
    { header: 'SSN', key: 'social', width: 12 },
    { header: 'Estatus migratorio', key: 'estatus_migratorio', width: 18 },
    { header: 'Solicita cobertura', key: 'solicita_cobertura', width: 14 },
    { header: 'Medicare/Medicaid', key: 'medicare_medicaid', width: 16 },
  ];
  encabezado(shDep);
  for (const d of dependientes) {
    shDep.addRow({ ...d, titular: nombrePorId[d.cliente_id] ?? '', solicita_cobertura: siNo(d.solicita_cobertura), medicare_medicaid: siNo(d.medicare_medicaid) });
  }

  const shIng = wb.addWorksheet('Ingresos');
  shIng.columns = [
    { header: 'Cliente ID', key: 'cliente_id', width: 10 },
    { header: 'Titular', key: 'titular', width: 22 },
    { header: 'Persona', key: 'persona', width: 22 },
    { header: 'Declaración', key: 'tipo_declaracion', width: 12 },
    { header: 'Ingresos anuales', key: 'ingresos_anuales', width: 16 },
    { header: 'Ingresos semanales', key: 'ingresos_semanales', width: 16 },
  ];
  encabezado(shIng);
  for (const i of ingresos) {
    const persona = i.dependiente_id ? `${i.dependiente_nombres ?? ''} ${i.dependiente_apellidos ?? ''}`.trim() : 'Titular';
    shIng.addRow({ ...i, titular: nombrePorId[i.cliente_id] ?? '', persona });
  }

  const shPlan = wb.addWorksheet('Plan de salud');
  shPlan.columns = [
    { header: 'Cliente ID', key: 'cliente_id', width: 10 },
    { header: 'Titular', key: 'titular', width: 22 },
    { header: 'Aseguradora', key: 'aseguradora_nombre', width: 18 },
    { header: 'Plan', key: 'nombre_plan', width: 24 },
    { header: 'Tipo metal', key: 'tipo_metal', width: 12 },
    { header: 'Tipo red', key: 'tipo_red', width: 10 },
    { header: 'Deducible', key: 'deducible', width: 12 },
    { header: 'Gasto máx. bolsillo', key: 'gasto_max_bolsillo', width: 16 },
    { header: 'Prima mensual', key: 'valor_prima', width: 14 },
    { header: 'NPN', key: 'npn', width: 14 },
    { header: 'Estado de la prima', key: 'estado_prima', width: 16 },
    { header: 'PD', key: 'pd', width: 24 },
    { header: 'SD', key: 'sd', width: 24 },
    { header: 'GD', key: 'gd', width: 24 },
    { header: 'Productor (NPN)', key: 'npn_productor_nombre', width: 20 },
    { header: 'Número NPN', key: 'npn_productor_npn', width: 14 },
  ];
  encabezado(shPlan);
  for (const p of planes) shPlan.addRow({ ...p, titular: nombrePorId[p.cliente_id] ?? '' });

  const shPago = wb.addWorksheet('Pago');
  shPago.columns = [
    { header: 'Cliente ID', key: 'cliente_id', width: 10 },
    { header: 'Titular', key: 'titular', width: 22 },
    { header: 'Método', key: 'metodo', width: 16 },
    { header: 'Tarjeta (últimos 4)', key: 'ultimos_4_digitos', width: 16 },
    { header: 'Marca', key: 'marca_tarjeta', width: 12 },
    { header: 'Nombre en la tarjeta', key: 'nombre_titular_tarjeta', width: 20 },
    { header: 'Vence (mes)', key: 'fecha_expiracion_mes', width: 12 },
    { header: 'Vence (año)', key: 'fecha_expiracion_ano', width: 12 },
    { header: 'Banco', key: 'nombre_banco', width: 18 },
    { header: 'Número de ruta', key: 'numero_ruta', width: 14 },
    { header: 'Cuenta (últimos 4)', key: 'ultimos_4_cuenta', width: 16 },
  ];
  encabezado(shPago);
  for (const p of pagos) shPago.addRow({ ...p, titular: nombrePorId[p.cliente_id] ?? '' });

  const shEvi = wb.addWorksheet('Evidencias');
  shEvi.columns = [
    { header: 'Cliente ID', key: 'cliente_id', width: 10 },
    { header: 'Titular', key: 'titular', width: 22 },
    { header: 'Categoría', key: 'categoria', width: 18 },
    { header: 'Archivo', key: 'nombre_archivo', width: 30 },
    { header: 'Tipo', key: 'tipo_archivo', width: 14 },
    { header: 'Subido', key: 'created_at', width: 18 },
  ];
  encabezado(shEvi);
  for (const e of evidencias) shEvi.addRow({ ...e, titular: nombrePorId[e.cliente_id] ?? '' });

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
