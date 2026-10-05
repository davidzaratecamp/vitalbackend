import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { getClienteOr404, assertAccesoCliente } from '../clientes/clientes.service.js';
import { getCasoDetalle } from '../casosPostventa/casosPostventa.service.js';
import { contextoCliente, contextoCasoPostventa, listarLlamadas, enviarAudio } from './grabaciones.service.js';

/**
 * Grabaciones de Aware dentro de cada caso. Solo supervisor, backoffice y
 * admin (el agente no las escucha — decisión del usuario, 2026-10-05); la
 * separación por empresa la aplica assertAccesoCliente / getCasoDetalle.
 */
const router = Router();
router.use(requireAuth, requireRole('supervisor', 'backoffice', 'admin'));

async function ctxCliente(req) {
  const cliente = await getClienteOr404(req.params.clienteId);
  await assertAccesoCliente(cliente, req.user);
  return contextoCliente(cliente);
}

async function ctxCaso(req) {
  const caso = await getCasoDetalle(req.params.casoId, req.user);
  return contextoCasoPostventa(caso);
}

const listar = (getCtx) => asyncHandler(async (req, res) => {
  const { llamadas, motivo } = await listarLlamadas(await getCtx(req));
  res.json({ llamadas, motivo });
});

const audio = (getCtx) => asyncHandler(async (req, res) => {
  await enviarAudio(await getCtx(req), req.params.registroId, res);
});

router.get('/cliente/:clienteId', listar(ctxCliente));
router.get('/cliente/:clienteId/audio/:registroId', audio(ctxCliente));
router.get('/caso-postventa/:casoId', listar(ctxCaso));
router.get('/caso-postventa/:casoId/audio/:registroId', audio(ctxCaso));

export default router;
