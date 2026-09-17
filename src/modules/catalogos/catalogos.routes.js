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

// Aseguradoras habilitadas para un código postal — "Base Estados y
// Coberturas Vital 2026". Antes de /:id no hace falta acá porque el path
// es literal, no /:id.
router.get(
  '/aseguradoras-por-zip',
  asyncHandler(async (req, res) => {
    const zip = Number(req.query.codigoPostal);
    if (!Number.isInteger(zip)) return res.json([]);
    const rows = await db('cobertura_zip as c')
      .join('aseguradoras as a', 'a.id', 'c.aseguradora_id')
      .where('c.zip_desde', '<=', zip)
      .andWhere('c.zip_hasta', '>=', zip)
      .andWhere('a.is_active', true)
      .distinct('a.id', 'a.nombre')
      .orderBy('a.nombre');
    res.json(rows);
  })
);

// Igual que /aseguradoras, para el catálogo de productores con NPN (ver
// migración 20260917130000_npn_productores).
router.get(
  '/npn-productores',
  asyncHandler(async (req, res) => {
    const q = db('npn_productores').orderBy('nombre');
    if (req.query.active !== 'false') q.where('is_active', true);
    res.json(await q);
  })
);

const npnProductorSchema = z.object({
  nombre: z.string().min(2).max(120),
  npn: z.string().max(40).optional().nullable(),
});

router.post(
  '/npn-productores',
  requireRole('admin'),
  validate(npnProductorSchema),
  asyncHandler(async (req, res) => {
    const [id] = await db('npn_productores').insert({ nombre: req.body.nombre, npn: req.body.npn ?? null });
    res.status(201).json(await db('npn_productores').where({ id }).first());
  })
);

router.patch(
  '/npn-productores/:id',
  requireRole('admin'),
  validate(
    z.object({
      nombre: z.string().min(2).max(120).optional(),
      npn: z.string().max(40).optional().nullable(),
      is_active: z.coerce.boolean().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const row = await db('npn_productores').where({ id: req.params.id }).first();
    if (!row) throw notFound('Productor no encontrado');
    await db('npn_productores').where({ id: row.id }).update(req.body);
    res.json(await db('npn_productores').where({ id: row.id }).first());
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
