import ExcelJS from 'exceljs';
import { db } from '../../db/knex.js';
import { notFound, forbidden, badRequest } from '../../utils/httpError.js';
import {
  TIPO_CASO_POSTVENTA,
  TIPO_CASO_POSTVENTA_LABEL,
  TIPO_GESTION_POSTVENTA_LABEL,
  ESTADO_CASO_POSTVENTA_LABEL,
  REASIGNACION_PREFIJO,
} from './casosPostventa.constants.js';
import { ESTADOS_POSTVENTA } from '../clientes/clientes.constants.js';

const RESPONSABLE_POR_TIPO = Object.fromEntries(TIPO_CASO_POSTVENTA.map((t) => [t.valor, t.responsable]));

async function logHistorialCaso(casoPostventaId, estadoAnterior, estadoNuevo, userId, motivo = null) {
  await db('historial_casos_postventa').insert({
    caso_postventa_id: casoPostventaId,
    estado_anterior: estadoAnterior,
    estado_nuevo: estadoNuevo,
    cambiado_por: userId,
    motivo,
  });
}

/**
 * Busca entre clientes en algún estado de ESTADOS_POSTVENTA (aprobado,
 * pendiente_backoffice, pendiente_llamada_tripartita) por cualquiera de
 * los 3 teléfonos del titular (phone_1, phone_2, whatsapp) —
 * cónyuge/dependientes no tienen teléfono propio en el modelo de datos,
 * así que quien llame (titular, cónyuge, un beneficiario) siempre matchea
 * contra estos 3 campos del mismo cliente. Mismo patrón que
 * buscarPorTelefono en clientes.service.js. Hasta 2026-09-29 era solo
 * 'aprobado' — se sumó 'pendiente_backoffice' (llamadas de postventa sobre
 * ventas que aún no terminan de aprobarse) y el 2026-10-15
 * 'pendiente_llamada_tripartita' (agentes creándole casos a BackOffice
 * mientras la venta espera esa llamada), ambos a pedido del usuario.
 *
 * `empresaId`: postventa quedó integrada dentro de agente (2026-09-24,
 * "el customer es el mismo agente") — un agente solo puede validar/tomar
 * clientes de SU MISMA empresa, aunque no los haya vendido él. Se manda
 * `undefined` para admin (sin restricción).
 */
export async function validarTelefono(telefono, empresaId) {
  if (!telefono) return [];
  const q = db('clientes as c')
    .leftJoin('usuarios_sistema as ag', 'ag.id', 'c.agente_id')
    .select('c.id', 'c.nombres', 'c.apellidos', 'c.estado', 'c.phone_1', 'c.phone_2', 'c.whatsapp', 'ag.name as agente_nombre')
    .whereIn('c.estado', ESTADOS_POSTVENTA)
    .andWhere((b) => b.where('c.phone_1', telefono).orWhere('c.phone_2', telefono).orWhere('c.whatsapp', telefono))
    .limit(5);
  if (empresaId) q.whereIn('c.agente_id', db('usuarios_sistema').select('id').where({ empresa_id: empresaId }));
  return q;
}

export async function crearCaso(clienteId, user, data) {
  const cliente = await db('clientes').where({ id: clienteId }).first('id', 'estado', 'agente_id');
  if (!cliente) throw notFound('Cliente no encontrado');
  if (!ESTADOS_POSTVENTA.includes(cliente.estado)) {
    throw badRequest('Solo se pueden crear casos de postventa para clientes aprobados, pendientes de BackOffice o pendientes de llamada tripartita');
  }
  if (user.role === 'agente' && cliente.agente_id !== user.id) {
    if (!user.empresa_id) throw forbidden('Tu cuenta no tiene una empresa asignada — pídele a un admin que la configure');
    const dueño = await db('usuarios_sistema').where({ id: cliente.agente_id }).first('empresa_id');
    if (!dueño || dueño.empresa_id !== user.empresa_id) throw forbidden('Este cliente pertenece a otra empresa');
  }

  // Si el tipo de caso es "de BackOffice" (ver responsable en el catálogo),
  // nace directo escalado — a pedido del usuario (2026-09-25): "si el caso
  // es para el backoffice, cambias el botón a 'enviar al backoffice'". Un
  // solo movimiento en el historial (null → escalado_backoffice), no
  // nuevo→escalado_backoffice, así no queda un paso intermedio que nadie
  // gestionó de verdad.
  const estadoInicial = RESPONSABLE_POR_TIPO[data.tipo_caso] === 'backoffice' ? 'escalado_backoffice' : 'nuevo';

  const [id] = await db('casos_postventa').insert({
    cliente_id: clienteId,
    tipo_caso: data.tipo_caso,
    telefono_contacto: data.telefono_contacto,
    observacion_inicial: data.observacion_inicial || null,
    creado_por: user.id,
    gestionado_por: user.id,
    estado: estadoInicial,
  });
  await logHistorialCaso(id, null, estadoInicial, user.id);
  return getCasoDetalle(id);
}

/** Empresa del agente dueño del cliente detrás de un caso — reutilizado por
 * assertCasoAccesible para agente/backoffice. */
async function empresaDelCaso(caso) {
  const cliente = await db('clientes').where({ id: caso.cliente_id }).first('agente_id');
  if (!cliente) return null;
  const dueño = await db('usuarios_sistema').where({ id: cliente.agente_id }).first('empresa_id');
  return dueño?.empresa_id ?? null;
}

/** admin: sin restricción. agente/backoffice/supervisor: solo casos de
 * clientes de su misma empresa — defensa en profundidad además del filtro
 * que ya aplica listarCasos, para que golpear /casos-postventa/:id directo
 * con un ID de otra empresa tampoco funcione. Exportado: lo reusa
 * soportesCasoPostventa (adjuntos del caso) para el mismo chequeo.
 *
 * Exclusividad de BackOffice (2026-09-29, pedido del usuario): un caso en
 * 'seguimiento_backoffice' quedó asignado a quien lo tomó (gestionado_por)
 * — ningún OTRO backoffice de la empresa puede verlo ni gestionarlo desde
 * acá, ni siquiera para mirarlo. Esto NO aplica a agente/admin/supervisor
 * (ellos sí ven quién lo tomó, solo entre compañeros de BackOffice hay
 * candado).
 */
export async function assertCasoAccesible(caso, user) {
  if (user.role === 'admin') return;
  if (!user.empresa_id) throw forbidden('Tu cuenta no tiene una empresa asignada — pídele a un admin que la configure');
  const empresaCaso = await empresaDelCaso(caso);
  if (empresaCaso !== user.empresa_id) throw forbidden('Este caso pertenece a otra empresa');
  if (user.role === 'backoffice' && caso.estado === 'seguimiento_backoffice' && caso.gestionado_por !== user.id) {
    throw forbidden('Este caso ya lo tomó otro compañero de BackOffice.');
  }
}

export async function getCasoDetalle(casoId, user) {
  const caso = await db('casos_postventa as cp')
    .leftJoin('usuarios_sistema as creador', 'creador.id', 'cp.creado_por')
    .leftJoin('usuarios_sistema as gestor', 'gestor.id', 'cp.gestionado_por')
    .leftJoin('clientes as c', 'c.id', 'cp.cliente_id')
    .select(
      'cp.*',
      'creador.name as creado_por_nombre',
      'gestor.name as gestionado_por_nombre',
      'c.nombres as cliente_nombres',
      'c.apellidos as cliente_apellidos',
      'c.estado as cliente_estado'
    )
    .where('cp.id', casoId)
    .first();
  if (!caso) throw notFound('Caso no encontrado');
  // `user` es opcional — llamadas internas (crearCaso/actualizarCaso) ya
  // validaron acceso antes de llegar acá y solo quieren la fila fresca.
  if (user) await assertCasoAccesible(caso, user);
  return caso;
}

export async function getHistorialCaso(casoId, user) {
  // 'estado' y 'gestionado_por' son obligatorios acá — assertCasoAccesible
  // los necesita para la exclusividad de BackOffice. Sin ellos quedaban
  // `undefined` y la condición nunca se cumplía, dejando ver el historial
  // de un caso ajeno sin que la exclusividad lo bloqueara (mismo bug raíz
  // que el de soportesCasoPostventa.routes.js, 2026-10-06).
  const caso = await db('casos_postventa').where({ id: casoId }).first('id', 'cliente_id', 'estado', 'gestionado_por');
  if (!caso) throw notFound('Caso no encontrado');
  await assertCasoAccesible(caso, user);
  return db('historial_casos_postventa as h')
    .leftJoin('usuarios_sistema as u', 'u.id', 'h.cambiado_por')
    .select('h.*', 'u.name as cambiado_por_nombre')
    .where({ caso_postventa_id: casoId })
    .orderBy('h.created_at', 'desc');
}

/**
 * "Por gestionar" (nuevo/seguimiento) y "gestionados" (cerrado/escalado)
 * para el agente — acotado a clientes de SU MISMA empresa (2026-09-24: el
 * rol Customer se integró dentro de agente, así que ya no es un equipo
 * centralizado sin empresa — sigue la misma separación Vital/Vital Asiste
 * que el resto del sistema). Para BackOffice (pestaña "Postventa"), igual
 * pero además siempre fuerza estado = 'escalado_backoffice', ignorando
 * cualquier filtro de estado que se mande. admin: sin restricción de
 * estado ni de empresa.
 */
export async function listarCasos(user, filters = {}) {
  const q = db('casos_postventa as cp')
    .join('clientes as c', 'c.id', 'cp.cliente_id')
    .leftJoin('usuarios_sistema as ag', 'ag.id', 'c.agente_id')
    .leftJoin('usuarios_sistema as gest', 'gest.id', 'cp.gestionado_por')
    .select(
      'cp.id',
      'cp.cliente_id',
      'cp.tipo_caso',
      'cp.tipo_gestion',
      'cp.estado',
      'cp.telefono_contacto',
      'cp.created_at',
      'cp.updated_at',
      'cp.cerrado_at',
      'c.nombres',
      'c.apellidos',
      'c.correo_electronico',
      'c.phone_1',
      'gest.name as gestionado_por_nombre',
      // Para que admin pueda distinguir de un vistazo si lo llevó agente o
      // BackOffice (2026-09-24, pedido del usuario: "vista de postventa
      // gestionado por back, por agente").
      'gest.role as gestionado_por_rol'
    )
    .orderBy('cp.updated_at', 'desc')
    .limit(200);

  if (user.role === 'backoffice' || user.role === 'agente' || user.role === 'supervisor') {
    if (!user.empresa_id) throw forbidden('Tu cuenta no tiene una empresa asignada — pídele a un admin que la configure');
    q.whereIn('c.agente_id', db('usuarios_sistema').select('id').where({ empresa_id: user.empresa_id }));
  }
  if (user.role === 'backoffice') {
    // "Postventa" (sin gestionar) = escalado_backoffice (cualquiera de la
    // empresa la ve) + seguimiento_backoffice PERO SOLO LOS PROPIOS
    // (2026-09-29, exclusividad pedida por el usuario: una vez que un
    // backoffice le da "Seguimiento" a un caso, los demás compañeros ya no
    // lo ven ni lo gestionan). "Gestionados" = cerrado, pero SOLO los que
    // cerró BackOffice (gest.role) — si no, se mezclarían con casos que un
    // agente cerró directo sin escalar, que a BackOffice no le corresponden
    // (2026-09-25, pedido del usuario).
    const permitidos = ['escalado_backoffice', 'seguimiento_backoffice', 'cerrado'];
    const pedidos = filters.estados?.filter((e) => permitidos.includes(e));
    // Sin filtro explícito, el default es lo pendiente: sin tomar + lo que
    // yo mismo ya tomé — "cerrado" solo entra si se pide a propósito (la
    // pestaña "Gestionados"), nunca por default.
    const queridos = pedidos?.length ? pedidos : ['escalado_backoffice', 'seguimiento_backoffice'];
    q.andWhere((b) => {
      let primero = true;
      const orWhere = (clausula) => {
        if (primero) {
          b.where(clausula);
          primero = false;
        } else {
          b.orWhere(clausula);
        }
      };
      if (queridos.includes('escalado_backoffice')) orWhere((b2) => b2.where('cp.estado', 'escalado_backoffice'));
      if (queridos.includes('seguimiento_backoffice')) {
        orWhere((b2) => b2.where('cp.estado', 'seguimiento_backoffice').andWhere('cp.gestionado_por', user.id));
      }
      if (queridos.includes('cerrado')) {
        orWhere((b2) => b2.where('cp.estado', 'cerrado').andWhere('gest.role', 'backoffice'));
      }
    });
  } else if (filters.estados?.length) {
    q.whereIn('cp.estado', filters.estados);
  }

  if (filters.tipo_caso) q.where('cp.tipo_caso', filters.tipo_caso);
  if (filters.tipo_gestion) q.where('cp.tipo_gestion', filters.tipo_gestion);
  // Sobre created_at (cuándo se abrió la llamada), no updated_at — es lo que
  // un agente de postventa espera filtrar ("los casos que entraron esta
  // semana"), igual que "Enviado"/dateField en ClientesEstadoTable.
  if (filters.desde) q.where('cp.created_at', '>=', `${filters.desde} 00:00:00`);
  if (filters.hasta) q.where('cp.created_at', '<=', `${filters.hasta} 23:59:59`);

  if (filters.q) {
    const like = `%${filters.q}%`;
    const comoId = Number.isInteger(Number(filters.q)) ? Number(filters.q) : null;
    q.andWhere((b) => {
      b.where('c.nombres', 'like', like).orWhere('c.apellidos', 'like', like).orWhere('cp.telefono_contacto', 'like', like);
      if (comoId !== null) b.orWhere('cp.id', comoId);
    });
  }
  return q;
}

// nuevo/seguimiento: lo trabaja el agente. seguimiento_backoffice: lo
// trabaja BackOffice, y SOLO quien lo tomó (2026-09-29) — 'escalado_backoffice'
// (sin tomar todavía) a propósito NO cuenta como "activo" para editar el
// formulario del cliente: hay que darle "Seguimiento" primero. cerrado es
// un estado final — no se reabre un caso, se crea uno nuevo (número de
// caso distinto) si vuelve a llamar.
const ESTADOS_POR_ROL = {
  agente: ['nuevo', 'seguimiento'],
  backoffice: ['seguimiento_backoffice'],
};

/**
 * Exige que exista un caso de postventa ACTIVO (en el estado que le
 * corresponde a este rol) para este cliente — es lo que habilita
 * assertCanEdit en clientes.routes.js y el chequeo de evidencias.routes.js.
 * Sin esto, un agente/backoffice no podría editar NINGÚN cliente aprobado
 * ajeno, ni siquiera pasando por "Validar" — así no se puede editar un
 * aprobado sin haber abierto un caso primero.
 *
 * `userId`: para BackOffice, además de existir el caso tiene que ser SUYO
 * (gestionado_por) — exclusividad (2026-09-29, pedido del usuario): un
 * compañero de BackOffice que no tomó el caso no puede editar el cliente
 * por esta vía tampoco, aunque conozca el ID.
 */
export async function assertCasoActivo(clienteId, role, userId) {
  const estadosPermitidos = ESTADOS_POR_ROL[role];
  if (!estadosPermitidos) throw forbidden('No tienes permiso para editar este registro');
  const caso = await db('casos_postventa')
    .where({ cliente_id: clienteId })
    .whereIn('estado', estadosPermitidos)
    .orderBy('updated_at', 'desc')
    .first();
  if (!caso) throw forbidden('No hay un caso de postventa activo para este cliente en tu cola');
  if (role === 'backoffice' && caso.gestionado_por !== userId) {
    throw forbidden('Este caso ya lo tomó otro compañero de BackOffice.');
  }
  return caso;
}

/**
 * Igual que assertCasoActivo, pero para UN caso puntual (por id) en vez de
 * "algún" caso activo del cliente — lo usa soportesCasoPostventa.routes.js
 * para subir/borrar adjuntos: un cliente puede tener varios casos a lo
 * largo del tiempo, así que "el cliente tiene un caso activo" no alcanza
 * para saber si ESTE caso puntual sigue siendo el activo. Mismo chequeo de
 * exclusividad que assertCasoActivo para BackOffice.
 */
export async function assertCasoIdActivo(casoId, role, userId) {
  const estadosPermitidos = ESTADOS_POR_ROL[role];
  if (!estadosPermitidos) throw forbidden('No tienes permiso para gestionar este caso');
  const caso = await db('casos_postventa').where({ id: casoId }).first('id', 'cliente_id', 'estado', 'gestionado_por');
  if (!caso) throw notFound('Caso no encontrado');
  if (!estadosPermitidos.includes(caso.estado)) throw forbidden('Este caso no está activo en tu cola');
  if (role === 'backoffice' && caso.gestionado_por !== userId) {
    throw forbidden('Este caso ya lo tomó otro compañero de BackOffice.');
  }
  return caso;
}

// BackOffice ya no puede cerrar directo desde 'escalado_backoffice' — tiene
// que tomarlo primero ("Seguimiento", 2026-09-29) y desde ahí sí cerrar.
const TRANSICIONES_VALIDAS = {
  agente: { nuevo: ['seguimiento', 'cerrado', 'escalado_backoffice'], seguimiento: ['seguimiento', 'cerrado', 'escalado_backoffice'] },
  backoffice: { escalado_backoffice: ['seguimiento_backoffice'], seguimiento_backoffice: ['seguimiento_backoffice', 'cerrado'] },
};

export async function actualizarCaso(casoId, user, data) {
  const caso = await db('casos_postventa').where({ id: casoId }).first();
  if (!caso) throw notFound('Caso no encontrado');
  await assertCasoAccesible(caso, user);

  const permitidos = TRANSICIONES_VALIDAS[user.role]?.[caso.estado];
  if (!permitidos) throw forbidden('No tienes permiso para gestionar este caso');

  const nuevoEstado = data.estado ?? caso.estado;
  if (!permitidos.includes(nuevoEstado)) {
    throw badRequest(`No se puede pasar de "${caso.estado}" a "${nuevoEstado}" desde tu rol`);
  }

  const patch = { gestionado_por: user.id, updated_at: db.fn.now() };
  if (data.tipo_gestion !== undefined) patch.tipo_gestion = data.tipo_gestion || null;
  if (nuevoEstado !== caso.estado) {
    patch.estado = nuevoEstado;
    if (nuevoEstado === 'cerrado') patch.cerrado_at = db.fn.now();
    await logHistorialCaso(casoId, caso.estado, nuevoEstado, user.id, data.motivo || null);
  }

  await db('casos_postventa').where({ id: casoId }).update(patch);
  return getCasoDetalle(casoId);
}

/**
 * Reasigna un caso ya tomado (seguimiento_backoffice) a OTRO backoffice —
 * para cuando quien lo tenía deja de estar disponible (renuncia, cambio de
 * equipo, vacaciones largas, etc.) y sus casos quedarían bloqueados para
 * todo el mundo si no (exclusividad de BackOffice, ver assertCasoAccesible).
 * No hay pantalla para esto todavía (es una operación rara, administrativa)
 * — se usa desde un script directo, como el resto de altas/cambios de
 * usuario en este proyecto (ver reset_pass_temp.mjs y similares). El
 * historial queda con el prefijo REASIGNACION_PREFIJO para que el frontend
 * lo muestre como un aviso permanente en la pantalla del caso — 2026-10-02,
 * pedido explícito del usuario (ver comentario en casosPostventa.constants.js).
 *
 * `cambiadoPorUserId`: quién HIZO la reasignación (normalmente un admin vía
 * script) — nunca el nuevo dueño, aunque sea el que más adelante va a
 * gestionar el caso, para no dar a entender que se lo asignó él mismo.
 */
export async function reasignarCasoBackoffice(casoId, nuevoUserId, { motivo, cambiadoPorUserId }) {
  const caso = await db('casos_postventa').where({ id: casoId }).first();
  if (!caso) throw notFound('Caso no encontrado');
  if (caso.estado !== 'seguimiento_backoffice') {
    throw badRequest('Solo se pueden reasignar casos que estén en seguimiento_backoffice (ya tomados por alguien)');
  }
  await db('casos_postventa').where({ id: casoId }).update({ gestionado_por: nuevoUserId, updated_at: db.fn.now() });
  await logHistorialCaso(casoId, caso.estado, caso.estado, cambiadoPorUserId, `${REASIGNACION_PREFIJO} ${motivo}`);
  return getCasoDetalle(casoId);
}

/* ───────────────────── Export de Postventa (Excel) ─────────────────────
 * (2026-10-19, pedido del usuario: "habilitarme un Export en el apartado
 * de Postventa"). Reusa listarCasos() a propósito — así el export respeta
 * EXACTAMENTE la misma visibilidad por rol que la pantalla: un agente solo
 * su empresa, BackOffice su cola + lo que él mismo tomó (exclusividad),
 * admin todo, supervisor su empresa. No hay forma de exportar algo que no
 * se podría ver en la tabla.
 */
const COLORES_EXCEL_POSTVENTA = {
  cabecera: 'FF4338CA', // indigo-700
  cabeceraClara: 'FFE0E7FF', // indigo-100
  neutro: 'FF1E293B',
  separador: 'FF94A3B8',
  cebra: 'FFF8FAFC',
};

// Mismo lenguaje de color que ESTADO_CASO_POSTVENTA_COLOR del frontend.
const ESTADO_CASO_FILL = {
  nuevo: 'FFE0E7FF',
  seguimiento: 'FFFEF3C7',
  escalado_backoffice: 'FFF3E8FF',
  seguimiento_backoffice: 'FFE0F2FE',
  cerrado: 'FFDCFCE7',
};
const ESTADO_CASO_FONT = {
  nuevo: 'FF4338CA',
  seguimiento: 'FFB45309',
  escalado_backoffice: 'FF7E22CE',
  seguimiento_backoffice: 'FF0369A1',
  cerrado: 'FF15803D',
};

/** Historial de un caso como texto enriquecido: cada estado nuevo con su
 * color, en orden cronológico, con quién lo movió y el motivo si lo hubo —
 * mismo criterio que el historial del reporte de ventas. */
function historialCasoRichText(hist) {
  if (!hist.length) return 'Sin movimientos registrados';
  const runs = [];
  hist.forEach((h, i) => {
    if (i > 0) runs.push({ font: { color: { argb: COLORES_EXCEL_POSTVENTA.separador } }, text: '   |   ' });
    if (h.estado_anterior) {
      runs.push({
        font: { color: { argb: COLORES_EXCEL_POSTVENTA.neutro } },
        text: `${ESTADO_CASO_POSTVENTA_LABEL[h.estado_anterior] ?? h.estado_anterior} → `,
      });
    }
    runs.push({
      font: { bold: true, color: { argb: ESTADO_CASO_FONT[h.estado_nuevo] ?? COLORES_EXCEL_POSTVENTA.neutro } },
      text: ESTADO_CASO_POSTVENTA_LABEL[h.estado_nuevo] ?? h.estado_nuevo,
    });
    runs.push({
      font: { color: { argb: COLORES_EXCEL_POSTVENTA.neutro } },
      text: ` (${h.created_at}, ${h.cambiado_por_nombre ?? '—'}${h.motivo ? `: ${h.motivo}` : ''})`,
    });
  });
  return { richText: runs };
}

export async function streamCasosPostventaExcel(user, filters, res) {
  const casos = await listarCasos(user, filters);
  const ids = casos.map((c) => c.id);

  const historialRows = ids.length
    ? await db('historial_casos_postventa as h')
        .leftJoin('usuarios_sistema as u', 'u.id', 'h.cambiado_por')
        .select('h.caso_postventa_id', 'h.estado_anterior', 'h.estado_nuevo', 'h.motivo', 'h.created_at', 'u.name as cambiado_por_nombre')
        .whereIn('h.caso_postventa_id', ids)
        .orderBy('h.created_at', 'asc')
    : [];
  const historialPorCaso = {};
  for (const h of historialRows) (historialPorCaso[h.caso_postventa_id] ??= []).push(h);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vital';
  wb.created = new Date();
  const sh = wb.addWorksheet('Postventa', { pageSetup: { orientation: 'landscape' } });

  const COLS = [
    { header: 'ID', key: 'id', width: 9 },
    { header: 'Nombre cliente', key: 'cliente', width: 30 },
    { header: 'Tipo de caso', key: 'tipo_caso', width: 34 },
    { header: 'Estado', key: 'estado', width: 24 },
    { header: 'Gestión', key: 'tipo_gestion', width: 18 },
    { header: 'Gestionado por', key: 'gestionado_por', width: 26 },
    { header: 'Última actualización', key: 'updated_at', width: 19 },
    { header: 'Historial del caso', key: 'historial', width: 90 },
  ];
  sh.columns = COLS.map((c) => ({ key: c.key, width: c.width }));

  COLS.forEach((c, i) => {
    const cell = sh.getCell(1, i + 1);
    cell.value = c.header;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES_EXCEL_POSTVENTA.cabecera } };
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: COLORES_EXCEL_POSTVENTA.cabeceraClara } } };
  });
  sh.getRow(1).height = 26;
  // Congela el encabezado + ID/cliente, para no perder de vista de quién es
  // cada fila al desplazarse hacia el historial (que es muy ancho).
  sh.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
  sh.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };

  let rowIndex = 2;
  for (const c of casos) {
    const row = sh.addRow({
      id: c.id,
      cliente: `${c.nombres ?? ''} ${c.apellidos ?? ''}`.trim(),
      tipo_caso: TIPO_CASO_POSTVENTA_LABEL[c.tipo_caso] ?? c.tipo_caso,
      estado: ESTADO_CASO_POSTVENTA_LABEL[c.estado] ?? c.estado,
      tipo_gestion: c.tipo_gestion ? (TIPO_GESTION_POSTVENTA_LABEL[c.tipo_gestion] ?? c.tipo_gestion) : '',
      gestionado_por: c.gestionado_por_nombre ?? '',
      updated_at: c.updated_at,
      historial: historialCasoRichText(historialPorCaso[c.id] ?? []),
    });

    const esPar = rowIndex % 2 === 0;
    for (let col = 1; col <= COLS.length; col += 1) {
      const cell = row.getCell(col);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: esPar ? COLORES_EXCEL_POSTVENTA.cebra : 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', wrapText: col === COLS.length };
    }
    // Estado con su propio color, pisando el cebrado.
    const estadoCell = row.getCell('estado');
    estadoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ESTADO_CASO_FILL[c.estado] ?? 'FFF1F5F9' } };
    estadoCell.font = { bold: true, color: { argb: ESTADO_CASO_FONT[c.estado] ?? 'FF475569' } };
    estadoCell.alignment = { horizontal: 'center', vertical: 'middle' };

    rowIndex += 1;
  }

  // Cierre con el total de casos exportados.
  if (casos.length) {
    sh.mergeCells(rowIndex, 1, rowIndex, 2);
    const totalCell = sh.getCell(rowIndex, 1);
    totalCell.value = `TOTAL: ${casos.length} caso${casos.length === 1 ? '' : 's'}`;
    totalCell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    totalCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    for (let col = 1; col <= COLS.length; col += 1) {
      sh.getCell(rowIndex, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    }
    sh.getRow(rowIndex).height = 24;
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="postventa_vital_${Date.now()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}
