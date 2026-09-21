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

const COLS = ['id', 'name', 'email', 'role', 'avatar_color', 'is_active', 'cedula', 'phone', 'empresa_id', 'created_at'];
const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'];
const randomColor = () => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
// Vital absorbió a la extinta Asiste Health Care ("Vital Asiste") pero
// ambos lados quedan separados — solo admin no necesita empresa (ve las
// dos sin restricción). Ver migración 20260919120000_empresas.
const ROLES_CON_EMPRESA = ['agente', 'backoffice', 'supervisor'];

function usuariosQuery() {
  return db('usuarios_sistema as u')
    .leftJoin('empresas as e', 'e.id', 'u.empresa_id')
    .select(COLS.map((c) => `u.${c}`), 'e.nombre as empresa_nombre');
}

// Cualquier usuario autenticado puede listar personal (p. ej. para mostrar nombres),
// pero crear/editar/desactivar es solo admin.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = usuariosQuery().orderBy('u.name');
    if (req.query.role) q.where('u.role', req.query.role);
    if (req.query.active === 'true') q.where('u.is_active', true);
    res.json(await q);
  })
);

router.get(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const user = await usuariosQuery().where({ 'u.id': req.params.id }).first();
    if (!user) throw notFound('Usuario no encontrado');
    res.json(user);
  })
);

// Identificador de acceso — antes exigía formato de correo, pero muchos
// usuarios reales entran con su cédula, no un correo (siguen llamándose
// "email"/columna `email` internamente, no vale la pena una migración solo
// por el nombre). Solo se exige que no tenga espacios ni quede vacío.
const identificadorAcceso = z.string().trim().min(3).max(190).regex(/^\S+$/, 'No puede tener espacios');

const createSchema = z.object({
  name: z.string().min(2).max(120),
  email: identificadorAcceso,
  password: z.string().min(8),
  role: z.enum(['agente', 'backoffice', 'admin', 'supervisor']),
  // Los pide la carta de firma (FirmaCloud): agentCedula es obligatorio al
  // enviar, agentPhone es opcional — por eso ninguno es obligatorio acá,
  // para no bloquear la creación de la cuenta si todavía no se tienen.
  cedula: z.string().max(40).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  empresa_id: z.coerce.number().int().positive().optional().nullable(),
});

router.post(
  '/',
  requireRole('admin'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password, role, empresa_id } = req.body;
    if (ROLES_CON_EMPRESA.includes(role) && !empresa_id) {
      throw badRequest('Este rol necesita una empresa asignada (Vital / Vital Asiste)', ['Empresa']);
    }
    const exists = await db('usuarios_sistema').where({ email }).first('id');
    if (exists) throw badRequest('Ya existe un usuario con ese usuario/correo');
    const password_hash = await bcrypt.hash(password, 10);
    const [id] = await db('usuarios_sistema').insert({
      name,
      email,
      password_hash,
      role,
      cedula: req.body.cedula ?? null,
      phone: req.body.phone ?? null,
      empresa_id: empresa_id ?? null,
      avatar_color: randomColor(),
    });
    res.status(201).json(await usuariosQuery().where({ 'u.id': id }).first());
  })
);

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  email: identificadorAcceso.optional(),
  role: z.enum(['agente', 'backoffice', 'admin', 'supervisor']).optional(),
  is_active: z.coerce.boolean().optional(),
  password: z.string().min(8).optional(),
  cedula: z.string().max(40).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  empresa_id: z.coerce.number().int().positive().optional().nullable(),
});

router.patch(
  '/:id',
  requireRole('admin'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const user = await db('usuarios_sistema').where({ id: req.params.id }).first();
    if (!user) throw notFound('Usuario no encontrado');

    const patch = { updated_at: db.fn.now() };
    const { name, email, role, is_active, password, cedula, phone, empresa_id } = req.body;
    if (name !== undefined) patch.name = name;
    if (email !== undefined) patch.email = email;
    if (role !== undefined) patch.role = role;
    if (is_active !== undefined) patch.is_active = is_active;
    if (password) patch.password_hash = await bcrypt.hash(password, 10);
    if (cedula !== undefined) patch.cedula = cedula;
    if (phone !== undefined) patch.phone = phone;
    if (empresa_id !== undefined) patch.empresa_id = empresa_id;

    const rolFinal = role ?? user.role;
    const empresaFinal = empresa_id !== undefined ? empresa_id : user.empresa_id;
    if (ROLES_CON_EMPRESA.includes(rolFinal) && !empresaFinal) {
      throw badRequest('Este rol necesita una empresa asignada (Vital / Vital Asiste)', ['Empresa']);
    }

    await db('usuarios_sistema').where({ id: user.id }).update(patch);
    res.json(await usuariosQuery().where({ 'u.id': user.id }).first());
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
