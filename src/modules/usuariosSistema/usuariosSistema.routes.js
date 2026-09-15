import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '../../db/knex.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { notFound, badRequest } from '../../utils/httpError.js';

const router = Router();
router.use(requireAuth);

const COLS = ['id', 'name', 'email', 'role', 'avatar_color', 'is_active', 'created_at'];
const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'];
const randomColor = () => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

// Cualquier usuario autenticado puede listar personal (p. ej. para mostrar nombres),
// pero crear/editar/desactivar es solo admin.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = db('usuarios_sistema').select(COLS).orderBy('name');
    if (req.query.role) q.where('role', req.query.role);
    if (req.query.active === 'true') q.where('is_active', true);
    res.json(await q);
  })
);

router.get(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const user = await db('usuarios_sistema').select(COLS).where({ id: req.params.id }).first();
    if (!user) throw notFound('Usuario no encontrado');
    res.json(user);
  })
);

const createSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(190),
  password: z.string().min(8),
  role: z.enum(['agente', 'backoffice', 'admin']),
});

router.post(
  '/',
  requireRole('admin'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password, role } = req.body;
    const exists = await db('usuarios_sistema').where({ email }).first('id');
    if (exists) throw badRequest('Ya existe un usuario con ese correo');
    const password_hash = await bcrypt.hash(password, 10);
    const [id] = await db('usuarios_sistema').insert({
      name,
      email,
      password_hash,
      role,
      avatar_color: randomColor(),
    });
    res.status(201).json(await db('usuarios_sistema').select(COLS).where({ id }).first());
  })
);

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  email: z.string().email().max(190).optional(),
  role: z.enum(['agente', 'backoffice', 'admin']).optional(),
  is_active: z.coerce.boolean().optional(),
  password: z.string().min(8).optional(),
});

router.patch(
  '/:id',
  requireRole('admin'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const user = await db('usuarios_sistema').where({ id: req.params.id }).first();
    if (!user) throw notFound('Usuario no encontrado');

    const patch = { updated_at: db.fn.now() };
    const { name, email, role, is_active, password } = req.body;
    if (name !== undefined) patch.name = name;
    if (email !== undefined) patch.email = email;
    if (role !== undefined) patch.role = role;
    if (is_active !== undefined) patch.is_active = is_active;
    if (password) patch.password_hash = await bcrypt.hash(password, 10);

    await db('usuarios_sistema').where({ id: user.id }).update(patch);
    res.json(await db('usuarios_sistema').select(COLS).where({ id: user.id }).first());
  })
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const user = await db('usuarios_sistema').where({ id: req.params.id }).first();
    if (!user) throw notFound('Usuario no encontrado');
    if (user.id === req.user.id) throw badRequest('No puedes desactivar tu propia cuenta');
    await db('usuarios_sistema').where({ id: user.id }).update({ is_active: false, updated_at: db.fn.now() });
    res.json({ ok: true });
  })
);

export default router;
