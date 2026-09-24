import { db } from '../../db/knex.js';
import { notFound, forbidden, badRequest } from '../../utils/httpError.js';

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
 * Busca entre clientes YA APROBADOS por cualquiera de los 3 teléfonos del
 * titular (phone_1, phone_2, whatsapp) — cónyuge/dependientes no tienen
 * teléfono propio en el modelo de datos, así que quien llame (titular,
 * cónyuge, un beneficiario) siempre matchea contra estos 3 campos del
 * mismo cliente. Mismo patrón que buscarPorTelefono en
 * clientes.service.js, pero acotado a 'aprobado' — postventa no aplica a
 * nada que siga en trámite.
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
    .where('c.estado', 'aprobado')
    .andWhere((b) => b.where('c.phone_1', telefono).orWhere('c.phone_2', telefono).orWhere('c.whatsapp', telefono))
    .limit(5);
  if (empresaId) q.whereIn('c.agente_id', db('usuarios_sistema').select('id').where({ empresa_id: empresaId }));
  return q;
}

export async function crearCaso(clienteId, user, data) {
  const cliente = await db('clientes').where({ id: clienteId }).first('id', 'estado', 'agente_id');
  if (!cliente) throw notFound('Cliente no encontrado');
  if (cliente.estado !== 'aprobado') {
    throw badRequest('Solo se pueden crear casos de postventa para clientes aprobados');
  }
  if (user.role === 'agente' && cliente.agente_id !== user.id) {
    if (!user.empresa_id) throw forbidden('Tu cuenta no tiene una empresa asignada — pídele a un admin que la configure');
    const dueño = await db('usuarios_sistema').where({ id: cliente.agente_id }).first('empresa_id');
    if (!dueño || dueño.empresa_id !== user.empresa_id) throw forbidden('Este cliente pertenece a otra empresa');
  }

  const [id] = await db('casos_postventa').insert({
    cliente_id: clienteId,
    tipo_caso: data.tipo_caso,
    telefono_contacto: data.telefono_contacto,
    observacion_inicial: data.observacion_inicial || null,
    creado_por: user.id,
    gestionado_por: user.id,
    estado: 'nuevo',
  });
  await logHistorialCaso(id, null, 'nuevo', user.id);
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

/** admin: sin restricción. agente/backoffice: solo casos de clientes de su
 * misma empresa — defensa en profundidad además del filtro que ya aplica
 * listarCasos, para que golpear /casos-postventa/:id directo con un ID de
 * otra empresa tampoco funcione. */
async function assertCasoAccesible(caso, user) {
  if (user.role === 'admin') return;
  if (!user.empresa_id) throw forbidden('Tu cuenta no tiene una empresa asignada — pídele a un admin que la configure');
  const empresaCaso = await empresaDelCaso(caso);
  if (empresaCaso !== user.empresa_id) throw forbidden('Este caso pertenece a otra empresa');
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
  const caso = await db('casos_postventa').where({ id: casoId }).first('id', 'cliente_id');
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

  if (user.role === 'backoffice' || user.role === 'agente') {
    if (!user.empresa_id) throw forbidden('Tu cuenta no tiene una empresa asignada — pídele a un admin que la configure');
    q.whereIn('c.agente_id', db('usuarios_sistema').select('id').where({ empresa_id: user.empresa_id }));
  }
  if (user.role === 'backoffice') {
    q.where('cp.estado', 'escalado_backoffice');
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

// nuevo/seguimiento: lo trabaja el agente. escalado_backoffice: lo trabaja
// BackOffice. cerrado es un estado final — no se reabre un caso, se crea
// uno nuevo (número de caso distinto) si vuelve a llamar.
const ESTADOS_POR_ROL = {
  agente: ['nuevo', 'seguimiento'],
  backoffice: ['escalado_backoffice'],
};

/**
 * Exige que exista un caso de postventa ACTIVO (en el estado que le
 * corresponde a este rol) para este cliente — es lo que habilita
 * assertCanEdit en clientes.routes.js y el chequeo de evidencias.routes.js.
 * Sin esto, un agente/backoffice no podría editar NINGÚN cliente aprobado
 * ajeno, ni siquiera pasando por "Validar" — así no se puede editar un
 * aprobado sin haber abierto un caso primero.
 */
export async function assertCasoActivo(clienteId, role) {
  const estadosPermitidos = ESTADOS_POR_ROL[role];
  if (!estadosPermitidos) throw forbidden('No tienes permiso para editar este registro');
  const caso = await db('casos_postventa')
    .where({ cliente_id: clienteId })
    .whereIn('estado', estadosPermitidos)
    .orderBy('updated_at', 'desc')
    .first();
  if (!caso) throw forbidden('No hay un caso de postventa activo para este cliente en tu cola');
  return caso;
}

const TRANSICIONES_VALIDAS = {
  agente: { nuevo: ['seguimiento', 'cerrado', 'escalado_backoffice'], seguimiento: ['seguimiento', 'cerrado', 'escalado_backoffice'] },
  backoffice: { escalado_backoffice: ['escalado_backoffice', 'cerrado'] },
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
