import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { getClienteOr404, getClienteDetalle, assertAccesoCliente } from '../clientes/clientes.service.js';
import { fechaFiltroValida } from '../../utils/fechaFiltro.js';
import { validate } from '../../middleware/validate.js';
import { restaurarDesdePapelera } from '../clientes/papelera.js';
import * as svc from './admin.service.js';

const router = Router();
// Todas las rutas de este módulo son de solo lectura — salvo restaurar
// desde la papelera, que es solo admin (ver abajo) — por eso el
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
  const query = req.query || {};
  const empresaId = req.user.role === 'supervisor' ? req.user.empresa_id : query.empresaId;
  return {
    estado: query.estado,
    from: fechaFiltroValida(query.from),
    to: fechaFiltroValida(query.to),
    agenteId: query.agenteId,
    empresaId,
    q: query.q,
  };
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

// Export completo en Excel (.xlsx real, varias hojas — Titulares, Cónyuges,
// Dependientes, Ingresos, Plan de salud, Pago, Evidencias) — 2026-09-30,
// pedido del usuario: "toda la información de los formularios de ventas".
router.get(
  '/reporte.xlsx',
  asyncHandler(async (req, res) => {
    await svc.streamReporteExcel(parseFilters(req), res);
  })
);

// "Papelera" — solo admin, no supervisor (2026-09-26, pedido del usuario:
// "el admin debe tener una pestaña"). requireRole('admin') acá pisa el
// requireRole('admin', 'supervisor') general de arriba, para este único
// endpoint.
router.get(
  '/papelera',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const query = req.query || {};
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    res.json(
      await svc.papelera(
        {
          q: query.q,
          agenteId: query.agenteId,
          empresaId: query.empresaId,
          desde: fechaFiltroValida(query.desde),
          hasta: fechaFiltroValida(query.hasta),
        },
        { page, pageSize }
      )
    );
  })
);

/**
 * Devolver a venta un registro de la papelera (2026-11-03, pedido del
 * usuario), eligiendo a qué agente va. Solo admin. Ver
 * restaurarDesdePapelera en clientes/papelera.js: con copia completa vuelve
 * con el mismo ID; sin copia queda asignado para que el agente lo rehaga.
 */
const restaurarSchema = z.object({
  agente_id: z.coerce.number().int().positive(),
  observacion: z.string().trim().max(500).optional(),
});

router.post(
  '/papelera/:id/restaurar',
  requireRole('admin'),
  validate(restaurarSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await restaurarDesdePapelera(req.params.id, {
        agenteId: req.body.agente_id,
        observacion: req.body.observacion || null,
        admin: req.user,
      })
    );
  })
);

export default router;
