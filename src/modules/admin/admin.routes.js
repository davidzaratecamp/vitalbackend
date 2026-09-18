import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { getClienteOr404, getClienteDetalle, assertAccesoCliente } from '../clientes/clientes.service.js';
import * as svc from './admin.service.js';

const router = Router();
// Todas las rutas de este módulo son de solo lectura — por eso el
// supervisor entra con el mismo requireRole que admin, sin duplicar
// pantallas ni endpoints (ver migración 20260919100000_rol_supervisor).
router.use(requireAuth, requireRole('admin', 'supervisor'));

/**
 * Admin ve las dos empresas (Vital / Vital Asiste) y puede filtrar por
 * cualquiera de ellas si quiere; supervisor queda SIEMPRE forzado a la
 * suya propia — nunca puede pedir ver la otra empresa, ni mandando el
 * parámetro a mano.
 */
function parseFilters(req) {
  const q = req.query || {};
  const empresaId = req.user.role === 'supervisor' ? req.user.empresa_id : q.empresaId;
  return { estado: q.estado, from: q.from, to: q.to, agenteId: q.agenteId, empresaId };
}

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    res.json(await svc.getDashboard(parseFilters(req)));
  })
);

// No la usa el frontend hoy (usa GET /clientes/:id, que ya tiene su propio
// chequeo) — se le agrega el mismo chequeo igual, por si alguna vez se usa
// por API directa.
router.get(
  '/clientes/:id',
  asyncHandler(async (req, res) => {
    const cliente = await getClienteOr404(req.params.id);
    await assertAccesoCliente(cliente, req.user);
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
