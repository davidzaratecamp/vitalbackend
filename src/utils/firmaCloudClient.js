/**
 * Cliente HTTP hacia la API de FirmaCloud (ver Integracion_API_Modulo_Vital.pdf
 * en la raíz del proyecto). Usa fetch nativo — Node 18+ ya lo trae.
 */
import { env } from '../config/env.js';

export class FirmaCloudError extends Error {
  /** @param {number} status @param {any} body */
  constructor(status, body) {
    super(body?.error || `FirmaCloud respondió ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${env.firmaCloud.baseUrl}${path}`, {
    ...options,
    headers: {
      'X-Api-Key': env.firmaCloud.apiKey,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      // respuesta sin JSON (ej. timeout de un proxy intermedio) — se maneja igual abajo.
    }
    throw new FirmaCloudError(res.status, body);
  }
  return res;
}

/** POST /signatures/send-with-data — envía la Carta CMS Vital. */
export async function enviarDocumento(payload) {
  const res = await request('/signatures/send-with-data', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.json();
}

/** GET /signatures/:id — estado actual del documento. */
export async function consultarEstadoRemoto(firmacloudId) {
  const res = await request(`/signatures/${firmacloudId}`);
  return res.json();
}

/** GET /signatures/:id/download — el PDF firmado (solo si status === 'signed'). */
export async function descargarDocumentoRemoto(firmacloudId) {
  return request(`/signatures/${firmacloudId}/download`);
}
