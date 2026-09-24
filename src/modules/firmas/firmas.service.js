import { db } from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/httpError.js';
import { getClienteDetalle } from '../clientes/clientes.service.js';
import * as firmaCloud from '../../utils/firmaCloudClient.js';
import { FirmaCloudError } from '../../utils/firmaCloudClient.js';

/** Últimos envíos primero — para saber cuál es "el actual" y ver el historial
 * si hubo reintentos (expiró, se reenvió, etc). */
export async function listarFirmas(clienteId) {
  return db('firmas_documentos')
    .leftJoin('usuarios_sistema as u', 'u.id', 'firmas_documentos.enviado_por')
    .select('firmas_documentos.*', 'u.name as enviado_por_nombre')
    .where({ cliente_id: clienteId })
    .orderBy('firmas_documentos.created_at', 'desc');
}

/**
 * FirmaCloud manda el SMS solo a números de EE. UU. — necesita el formato
 * E.164 (+1XXXXXXXXXX). `phone_1` se guarda como el agente lo tecleó (solo
 * dígitos, sin +1), así que se normaliza acá. Si no tiene pinta de número
 * de EE. UU. de 10 dígitos, se corta antes de llamar a FirmaCloud — un
 * número mal formado ahí da un error mucho menos claro.
 */
function formatearTelefonoUS(telefono) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (digitos.length === 10) return `+1${digitos}`;
  if (digitos.length === 11 && digitos.startsWith('1')) return `+${digitos}`;
  return null;
}

/** SMS usa `phone_1` (Teléfono principal) — WhatsApp usa `whatsapp` si el
 * cliente lo cargó distinto, o cae a `phone_1` si lo dejó vacío (muchas
 * veces es el mismo número, y eso está bien). Nunca se deben confundir
 * cuando SÍ son distintos. */
function telefonoParaCanal(cliente, canal) {
  if (canal === 'whatsapp') return formatearTelefonoUS(cliente.whatsapp || cliente.phone_1);
  return formatearTelefonoUS(cliente.phone_1);
}

/**
 * PD y GD: FirmaCloud le antepone el signo "$" automáticamente en el PDF,
 * sin importar lo que se le mande (contrato documentado) — si el agente ya
 * escribió el "$" a mano, la carta queda con "$$70" duplicado. Se le quita
 * acá el que el agente haya puesto, para que quede el único que pone
 * FirmaCloud.
 */
function sinSignoPesos(valor) {
  return valor.replace(/^\s*\$\s*/, '').trim();
}

/**
 * SD es la ÚNICA excepción del contrato: FirmaCloud NO le agrega nada, va
 * tal cual se mande. Si el agente escribió el valor sin el "$" (el mismo
 * hábito que con PD/GD, donde sí se agrega solo), la carta queda sin
 * signo — encontrado en un caso real (2026-09-24). Se agrega acá si hace
 * falta, salvo que ya lo tenga o sea un porcentaje (ese no lleva $).
 */
function conSignoPesosSiHaceFalta(valor) {
  const limpio = valor.trim();
  if (!limpio || limpio.startsWith('$') || limpio.includes('%')) return limpio;
  return `$${limpio}`;
}

function construirPayload(cliente, agente, canal) {
  const nombreCompleto = `${cliente.nombres} ${cliente.apellidos}`;
  const plan = cliente.plan_salud;
  // La carta debe mostrar como "agente" al PRODUCTOR dueño del NPN (Luis
  // Vitier, Talia Bordon, etc — elegido en el Paso 5), no la cuenta del
  // call-center que hizo la venta: el NPN es de esa persona, la carta
  // tiene que calzar con quién es. Si todavía no se eligió productor, se
  // cae al nombre real del agente (mejor eso que dejarlo vacío).
  const nombreParaLaCarta = plan?.npn_productor_nombre || agente.name;

  // agentPhone/agentEmail: a pedido del usuario, no se incluyen en la carta.
  const vital = {
    clientName: nombreCompleto,
    agentName: nombreParaLaCarta,
    householdContactName: nombreCompleto,
    householdContactPhone: cliente.phone_1,
    householdContactEmail: cliente.correo_electronico,
  };
  if (plan?.npn_productor_npn) vital.agentNPN = plan.npn_productor_npn;
  if (plan) {
    if (plan.taxes != null) vital.taxes = String(plan.taxes);
    if (plan.aseguradora_nombre) vital.company = plan.aseguradora_nombre;
    if (plan.tipo_red) vital.plan = plan.tipo_red;
    if (plan.valor_prima != null) vital.monthlyPay = String(plan.valor_prima);
    if (plan.deducible != null) vital.deductible = String(plan.deducible);
    // gd/pd/sd: texto libre tal como lo copió el agente (ver migración
    // 20260917140000... eh, 20260917130100_cobertura_plan_salud.js), pero
    // normalizado para el "$" según el contrato real de FirmaCloud (ver
    // sinSignoPesos/conSignoPesosSiHaceFalta arriba) — así la carta queda
    // bien sin importar si el agente lo escribió con o sin el signo.
    if (plan.gd) vital.gd = sinSignoPesos(plan.gd);
    if (plan.pd) vital.pd = sinSignoPesos(plan.pd);
    if (plan.sd) vital.sd = conSignoPesosSiHaceFalta(plan.sd);
  }

  const payload = {
    clientName: nombreCompleto,
    sendChannel: canal, // 'email' | 'sms' | 'whatsapp' — whatsapp habilitado desde 2026-09-22 (número +1 307-357-2609 aprobado en Meta, ver PDF). 'both' no se usa acá, el agente elige un solo canal.
    agentName: nombreParaLaCarta,
    agentCedula: agente.cedula,
    ventaId: String(cliente.id),
    documentData: { vital },
  };
  if (canal === 'sms' || canal === 'whatsapp') {
    payload.clientPhone = telefonoParaCanal(cliente, canal);
  } else {
    payload.clientEmail = cliente.correo_electronico;
  }
  return payload;
}

function mapearErrorFirmaCloud(err) {
  if (!(err instanceof FirmaCloudError)) throw err;
  if (err.status === 503) {
    // FirmaCloud manda el código en `errorCode`, no en `error` (ese trae el
    // mensaje legible) — se revisan los dos por si acaso.
    const codigo = err.body?.errorCode || err.body?.error;
    if (codigo === 'WHATSAPP_UNAVAILABLE') {
      return badRequest('WhatsApp todavía no está disponible para Vital — usa el canal de correo o SMS.');
    }
    if (codigo === 'SMS_UNAVAILABLE') {
      return badRequest('SMS no está disponible en este momento — usa el canal de correo o inténtalo de nuevo más tarde.');
    }
    return badRequest('FirmaCloud no pudo enviar el documento por este canal en este momento — se puede reintentar.');
  }
  if (err.status === 401) {
    return badRequest('La API key de FirmaCloud no es válida — revisa la configuración del servidor.');
  }
  if (err.status === 400) {
    return badRequest(err.body?.error || 'FirmaCloud rechazó los datos enviados.');
  }
  return badRequest('No se pudo conectar con FirmaCloud — inténtalo de nuevo en un momento.');
}

/** Envía la Carta CMS Vital por correo, SMS o WhatsApp (el agente elige).
 * Guarda un registro nuevo por cada intento (permite reenviar si expiró o
 * hubo un error, incluso por otro canal). */
export async function enviarFirma(clienteId, userId, canal = 'email') {
  if (!['email', 'sms', 'whatsapp'].includes(canal)) throw badRequest('Canal de envío inválido');

  const cliente = await getClienteDetalle(clienteId);

  if (canal === 'email') {
    if (!cliente.correo_electronico) {
      throw badRequest('El cliente no tiene correo electrónico registrado — hace falta para enviar la carta.');
    }
  } else if (!telefonoParaCanal(cliente, canal)) {
    throw badRequest(
      canal === 'sms'
        ? 'El teléfono principal del cliente no es un número de EE. UU. válido para enviar por SMS (10 dígitos).'
        : 'Ni el WhatsApp ni el teléfono principal del cliente son un número de EE. UU. válido para enviar por WhatsApp (10 dígitos).'
    );
  }

  const agente = await db('usuarios_sistema').where({ id: cliente.agente_id }).first();
  if (!agente) throw notFound('Agente no encontrado');
  if (!agente.cedula) {
    throw badRequest('Falta la cédula del agente — complétala en Usuarios del sistema antes de enviar la carta.', [
      'Cédula del agente',
    ]);
  }

  const payload = construirPayload(cliente, agente, canal);

  let respuesta;
  try {
    respuesta = await firmaCloud.enviarDocumento(payload);
  } catch (err) {
    throw mapearErrorFirmaCloud(err);
  }

  const [id] = await db('firmas_documentos').insert({
    cliente_id: clienteId,
    firmacloud_id: respuesta.id,
    estado: respuesta.status || 'pending',
    canal,
    enviado_por: userId,
    enviado_at: db.fn.now(),
  });
  return db('firmas_documentos').where({ id }).first();
}

/** Refresca el estado del envío más reciente contra FirmaCloud (polling —
 * el webhook no puede llegarle a Vital, ver PDF sección 4). */
export async function consultarEstado(clienteId) {
  const [ultima] = await listarFirmas(clienteId);
  if (!ultima) return null;
  if (!ultima.firmacloud_id) return ultima; // nunca llegó a crearse en FirmaCloud

  let remoto;
  try {
    remoto = await firmaCloud.consultarEstadoRemoto(ultima.firmacloud_id);
  } catch (err) {
    throw mapearErrorFirmaCloud(err);
  }

  const patch = { estado: remoto.status, updated_at: db.fn.now() };
  if (remoto.viewed_at) patch.visto_at = new Date(remoto.viewed_at);
  if (remoto.signed_at) patch.firmado_at = new Date(remoto.signed_at);
  if (remoto.status === 'expired' && !ultima.expirado_at) patch.expirado_at = db.fn.now();
  if (remoto.signer_name) patch.firmante_nombre = remoto.signer_name;
  if (remoto.signer_ip) patch.firmante_ip = remoto.signer_ip;
  if (remoto.signer_device) patch.firmante_dispositivo = remoto.signer_device;

  await db('firmas_documentos').where({ id: ultima.id }).update(patch);
  return db('firmas_documentos').where({ id: ultima.id }).first();
}

/** El PDF firmado — solo cuando el último envío está en `signed`. */
export async function descargarFirmado(clienteId) {
  const [ultima] = await listarFirmas(clienteId);
  if (!ultima?.firmacloud_id) throw notFound('No hay una carta enviada para este cliente');
  if (ultima.estado !== 'signed') throw badRequest('El cliente todavía no ha firmado la carta');

  try {
    return await firmaCloud.descargarDocumentoRemoto(ultima.firmacloud_id);
  } catch (err) {
    throw mapearErrorFirmaCloud(err);
  }
}
