import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { forbidden } from '../../utils/httpError.js';
import * as svc from './casosPostventa.service.js';
import { TIPO_CASO_POSTVENTA_VALORES, TIPO_GESTION_POSTVENTA, ESTADO_CASO_POSTVENTA } from './casosPostventa.constants.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/validar-telefono',
  requireRole('agente', 'admin'),
  asyncHandler(async (req, res) => {
    // admin sin restricción; agente solo entre clientes de su empresa (ver
    // validarTelefono en el servicio).
    const empresaId = req.user.role === 'agente' ? req.user.empresa_id : undefined;
    res.json(await svc.validarTelefono(req.query.telefono, empresaId));
  })
);

const crearCasoSchema = z.object({
  cliente_id: z.coerce.number().int().positive(),
  tipo_caso: z.enum(TIPO_CASO_POSTVENTA_VALORES),
  telefono_contacto: z.string().min(7).max(20),
  observacion_inicial: z.string().max(2000).optional().nullable(),
});

router.post(
  '/',
  requireRole('agente', 'admin'),
  validate(crearCasoSchema),
  asyncHandler(async (req, res) => {
    const { cliente_id, ...data } = req.body;
    res.status(201).json(await svc.crearCaso(cliente_id, req.user, data));
  })
);

router.get(
  '/',
  requireRole('agente', 'backoffice', 'admin'),
  asyncHandler(async (req, res) => {
    const estados = req.query.estados ? String(req.query.estados).split(',') : [];
    res.json(
      await svc.listarCasos(req.user, {
        estados,
        q: req.query.q,
        tipo_caso: req.query.tipo_caso,
        tipo_gestion: req.query.tipo_gestion,
        desde: req.query.desde,
        hasta: req.query.hasta,
      })
    );
  })
);

router.get(
  '/:id',
  requireRole('agente', 'backoffice', 'admin'),
  asyncHandler(async (req, res) => {
    res.json(await svc.getCasoDetalle(req.params.id, req.user));
  })
);

router.get(
  '/:id/historial',
  requireRole('agente', 'backoffice', 'admin'),
  asyncHandler(async (req, res) => {
    res.json(await svc.getHistorialCaso(req.params.id, req.user));
  })
);

const actualizarCasoSchema = z.object({
  estado: z.enum(ESTADO_CASO_POSTVENTA).optional(),
  tipo_gestion: z.enum(TIPO_GESTION_POSTVENTA).optional().nullable(),
  motivo: z.string().max(500).optional().nullable(),
});

router.patch(
  '/:id',
  validate(actualizarCasoSchema),
  asyncHandler(async (req, res) => {
    // admin es de solo lectura acá — supervisa, no gestiona casos.
    if (req.user.role !== 'agente' && req.user.role !== 'backoffice') {
      throw forbidden('No tienes permiso para gestionar casos de postventa');
    }
    res.json(await svc.actualizarCaso(req.params.id, req.user, req.body));
  })
);

export default router;
