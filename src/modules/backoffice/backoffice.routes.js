import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { getClienteOr404, assertAccesoCliente, agregarObservacion } from '../clientes/clientes.service.js';
import { ESTADO_PRIMA } from '../clientes/clientes.constants.js';
import * as svc from './backoffice.service.js';

const router = Router();
router.use(requireAuth, requireRole('backoffice'));

router.get(
  '/clientes',
  asyncHandler(async (req, res) => {
    res.json(
      await svc.listarCola(
        {
          estado: req.query.estado,
          q: req.query.q,
          agenteId: req.query.agenteId,
          desde: req.query.desde,
          hasta: req.query.hasta,
        },
        req.user.empresa_id
      )
    );
  })
);

const completarSchema = z.object({
  aseguradora_id: z.coerce.number().int().positive(),
  nombre_plan: z.string().min(2).max(160),
  deducible: z.coerce.number().min(0),
  gasto_max_bolsillo: z.coerce.number().min(0),
  npn: z.string().min(1).max(40),
  estado_prima: z.enum(ESTADO_PRIMA),
});

router.put(
  '/clientes/:id/completar',
  validate(completarSchema),
  asyncHandler(async (req, res) => {
    res.json(await svc.completar(req.params.id, req.user.id, req.body, req.user.empresa_id));
  })
);

const rechazarSchema = z.object({ motivo: z.string().min(4).max(500) });

router.put(
  '/clientes/:id/rechazar',
  validate(rechazarSchema),
  asyncHandler(async (req, res) => {
    res.json(await svc.rechazar(req.params.id, req.user.id, req.body.motivo, req.user.empresa_id));
  })
);

const observacionSchema = z.object({ comentario: z.string().min(2).max(2000) });

router.post(
  '/clientes/:id/observacion',
  validate(observacionSchema),
  asyncHandler(async (req, res) => {
    const cliente = await getClienteOr404(req.params.id);
    await assertAccesoCliente(cliente, req.user);
    res.status(201).json(await agregarObservacion(req.params.id, req.user.id, req.body.comentario));
  })
);

router.get(
  '/clientes/:id/historial',
  asyncHandler(async (req, res) => {
    const cliente = await getClienteOr404(req.params.id);
    await assertAccesoCliente(cliente, req.user);
    const rows = await db('historial_estados_cliente as h')
      .leftJoin('usuarios_sistema as u', 'u.id', 'h.cambiado_por')
      .select('h.*', 'u.name as cambiado_por_nombre')
      .where({ cliente_id: req.params.id })
      .orderBy('h.created_at', 'desc');
    res.json(rows);
  })
);

export default router;
