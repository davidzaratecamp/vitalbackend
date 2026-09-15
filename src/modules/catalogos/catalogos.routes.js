import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { notFound } from '../../utils/httpError.js';

const router = Router();
router.use(requireAuth);

// Cualquier usuario autenticado puede leer el catálogo (lo usa el Paso 5 del Agente).
router.get(
  '/aseguradoras',
  asyncHandler(async (req, res) => {
    const q = db('aseguradoras').orderBy('nombre');
    if (req.query.active !== 'false') q.where('is_active', true);
    res.json(await q);
  })
);

const aseguradoraSchema = z.object({ nombre: z.string().min(2).max(80) });

router.post(
  '/aseguradoras',
  requireRole('admin'),
  validate(aseguradoraSchema),
  asyncHandler(async (req, res) => {
    const [id] = await db('aseguradoras').insert({ nombre: req.body.nombre });
    res.status(201).json(await db('aseguradoras').where({ id }).first());
  })
);

router.patch(
  '/aseguradoras/:id',
  requireRole('admin'),
  validate(z.object({ nombre: z.string().min(2).max(80).optional(), is_active: z.coerce.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const row = await db('aseguradoras').where({ id: req.params.id }).first();
    if (!row) throw notFound('Aseguradora no encontrada');
    await db('aseguradoras').where({ id: row.id }).update(req.body);
    res.json(await db('aseguradoras').where({ id: row.id }).first());
  })
);

export default router;
