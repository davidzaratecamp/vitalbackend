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

function construirPayload(cliente, agente) {
  const nombreCompleto = `${cliente.nombres} ${cliente.apellidos}`;
  const plan = cliente.plan_salud;

  const vital = {
    clientName: nombreCompleto,
    agentName: agente.name,
    agentEmail: agente.email,
    householdContactName: nombreCompleto,
    householdContactPhone: cliente.phone_1,
    householdContactEmail: cliente.correo_electronico,
  };
  if (agente.phone) vital.agentPhone = agente.phone;
  if (plan?.npn_productor_npn) vital.agentNPN = plan.npn_productor_npn;
  if (plan) {
    if (plan.taxes != null) vital.taxes = String(plan.taxes);
    if (plan.aseguradora_nombre) vital.company = plan.aseguradora_nombre;
    if (plan.tipo_red) vital.plan = plan.tipo_red;
    if (plan.valor_prima != null) vital.monthlyPay = String(plan.valor_prima);
    if (plan.deducible != null) vital.deductible = String(plan.deducible);
    // gd/pd/sd: texto libre tal como lo copió el agente (ver migración
    // 20260917140000... eh, 20260917130100_cobertura_plan_salud.js) — se
    // manda tal cual, aunque el contrato de la API los llame "numérico".
    if (plan.gd) vital.gd = plan.gd;
    if (plan.pd) vital.pd = plan.pd;
    if (plan.sd) vital.sd = plan.sd;
  }

  return {
    clientName: nombreCompleto,
    clientEmail: cliente.correo_electronico,
    sendChannel: 'email', // whatsapp/both: bloqueado hasta que Meta apruebe (ver PDF).
    agentName: agente.name,
    agentCedula: agente.cedula,
    ventaId: String(cliente.id),
    documentData: { vital },
  };
}

function mapearErrorFirmaCloud(err) {
  if (!(err instanceof FirmaCloudError)) throw err;
  if (err.status === 503) {
    const codigo = err.body?.error;
    if (codigo === 'WHATSAPP_UNAVAILABLE') {
      return badRequest('WhatsApp todavía no está disponible para Vital — usa el canal de correo.');
    }
    return badRequest('FirmaCloud no pudo enviar el correo en este momento — se puede reintentar.');
  }
  if (err.status === 401) {
    return badRequest('La API key de FirmaCloud no es válida — revisa la configuración del servidor.');
  }
  if (err.status === 400) {
    return badRequest(err.body?.error || 'FirmaCloud rechazó los datos enviados.');
  }
  return badRequest('No se pudo conectar con FirmaCloud — inténtalo de nuevo en un momento.');
}

/** Envía la Carta CMS Vital por correo. Guarda un registro nuevo por cada
 * intento (permite reenviar si expiró o hubo un error). */
export async function enviarFirma(clienteId, userId) {
  const cliente = await getClienteDetalle(clienteId);
  if (!cliente.correo_electronico) {
    throw badRequest('El cliente no tiene correo electrónico registrado — hace falta para enviar la carta.');
  }

  const agente = await db('usuarios_sistema').where({ id: cliente.agente_id }).first();
  if (!agente) throw notFound('Agente no encontrado');
  if (!agente.cedula) {
    throw badRequest('Falta la cédula del agente — complétala en Usuarios del sistema antes de enviar la carta.', [
      'Cédula del agente',
    ]);
  }

  const payload = construirPayload(cliente, agente);

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
    canal: 'email',
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
