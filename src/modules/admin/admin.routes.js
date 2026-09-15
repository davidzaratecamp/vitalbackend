import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { getClienteDetalle } from '../clientes/clientes.service.js';
import * as svc from './admin.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

function parseFilters(req) {
  const q = req.query || {};
  return { estado: q.estado, from: q.from, to: q.to, agenteId: q.agenteId };
}

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    res.json(await svc.getDashboard(parseFilters(req)));
  })
);

router.get(
  '/clientes/:id',
  asyncHandler(async (req, res) => {
    res.json(await getClienteDetalle(req.params.id));
  })
);

router.get(
  '/reporte',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    res.json(await svc.reporte(parseFilters(req), { page, pageSize }));
  })
);

router.get(
  '/reporte.csv',
  asyncHandler(async (req, res) => {
    await svc.streamReporteCsv(parseFilters(req), res);
  })
);

export default router;
