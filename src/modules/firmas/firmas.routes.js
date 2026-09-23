import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { forbidden } from '../../utils/httpError.js';
import { getClienteOr404, assertAccesoCliente } from '../clientes/clientes.service.js';
import * as svc from './firmas.service.js';

const router = Router();
router.use(requireAuth);

// Mismo acceso que el resto del expediente del cliente: el agente solo el
// suyo, backoffice/supervisor solo de su empresa, admin cualquiera.
async function assertAccess(req) {
  const cliente = await getClienteOr404(req.params.clienteId);
  await assertAccesoCliente(cliente, req.user);
  return cliente;
}

router.get(
  '/cliente/:clienteId',
  asyncHandler(async (req, res) => {
    await assertAccess(req);
    res.json(await svc.listarFirmas(req.params.clienteId));
  })
);

const enviarSchema = z.object({ canal: z.enum(['email', 'sms']).optional().default('email') });

router.post(
  '/cliente/:clienteId/enviar',
  validate(enviarSchema),
  asyncHandler(async (req, res) => {
    // Solo el agente (dueño del caso) envía la carta (2026-09-23: se le
    // quitó a admin también) — supervisor es solo-lectura total, y
    // backoffice/admin solo revisan/aprueban, no les corresponde
    // reenviarle nada al cliente.
    if (req.user.role !== 'agente') {
      throw forbidden('Solo el agente puede enviar la carta de firma');
    }
    await assertAccess(req);
    res.status(201).json(await svc.enviarFirma(req.params.clienteId, req.user.id, req.body.canal));
  })
);

router.get(
  '/cliente/:clienteId/estado',
  asyncHandler(async (req, res) => {
    await assertAccess(req);
    res.json(await svc.consultarEstado(req.params.clienteId));
  })
);

router.get(
  '/cliente/:clienteId/descargar',
  asyncHandler(async (req, res) => {
    await assertAccess(req);
    const upstream = await svc.descargarFirmado(req.params.clienteId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="carta-firmada-${req.params.clienteId}.pdf"`);
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  })
);

export default router;
