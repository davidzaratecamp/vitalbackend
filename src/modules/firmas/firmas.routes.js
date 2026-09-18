import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import { forbidden } from '../../utils/httpError.js';
import { getClienteOr404, assertOwnerIfAgente } from '../clientes/clientes.service.js';
import * as svc from './firmas.service.js';

const router = Router();
router.use(requireAuth);

// Mismo acceso que el resto del expediente del cliente: el agente solo el
// suyo, backoffice/admin cualquiera.
async function assertAccess(req) {
  const cliente = await getClienteOr404(req.params.clienteId);
  assertOwnerIfAgente(cliente, req.user);
  return cliente;
}

router.get(
  '/cliente/:clienteId',
  asyncHandler(async (req, res) => {
    await assertAccess(req);
    res.json(await svc.listarFirmas(req.params.clienteId));
  })
);

router.post(
  '/cliente/:clienteId/enviar',
  asyncHandler(async (req, res) => {
    // El supervisor es solo-lectura — ve el estado de la carta, no la envía.
    if (req.user.role === 'supervisor') throw forbidden('Los supervisores no pueden enviar la carta de firma');
    await assertAccess(req);
    res.status(201).json(await svc.enviarFirma(req.params.clienteId, req.user.id));
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
