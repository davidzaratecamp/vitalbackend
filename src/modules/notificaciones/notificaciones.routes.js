import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import * as svc from './notificaciones.service.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await svc.listar(req.user.id));
  })
);

router.get(
  '/no-leidas',
  asyncHandler(async (req, res) => {
    res.json({ count: await svc.contarNoLeidas(req.user.id) });
  })
);

router.patch(
  '/:id/leida',
  asyncHandler(async (req, res) => {
    await svc.marcarLeida(req.user.id, req.params.id);
    res.json({ ok: true });
  })
);

router.post(
  '/marcar-todas',
  asyncHandler(async (req, res) => {
    await svc.marcarTodasLeidas(req.user.id);
    res.json({ ok: true });
  })
);

export default router;
