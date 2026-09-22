import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { db } from '../../db/knex.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import { badRequest, notFound, forbidden } from '../../utils/httpError.js';
import { getClienteOr404, assertAccesoCliente } from '../clientes/clientes.service.js';

const router = Router();
router.use(requireAuth);

// Subcarpeta propia dentro de uploads — separada de evidencias/ aunque
// comparta el mismo disco privado y los mismos límites de tamaño/tipo.
const BASE_DIR = path.join(env.uploads.dir, 'soportes-poliza');
fs.mkdirSync(BASE_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(BASE_DIR, String(req.params.clienteId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.uploads.maxSizeBytes, files: env.uploads.maxFiles },
  fileFilter: (_req, file, cb) => {
    if (!env.uploads.allowedMime.includes(file.mimetype)) {
      return cb(badRequest(`Tipo de archivo no permitido: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

function puedeGestionar(role) {
  return role === 'backoffice' || role === 'admin';
}

async function assertAccess(req, clienteId) {
  const cliente = await getClienteOr404(clienteId);
  await assertAccesoCliente(cliente, req.user);
  return cliente;
}

router.get(
  '/cliente/:clienteId',
  asyncHandler(async (req, res) => {
    await assertAccess(req, req.params.clienteId);
    res.json(await db('soportes_poliza').where({ cliente_id: req.params.clienteId }).orderBy('id'));
  })
);

router.post(
  '/cliente/:clienteId',
  asyncHandler(async (req, res, next) => {
    await assertAccess(req, req.params.clienteId);
    if (!puedeGestionar(req.user.role)) throw forbidden('Solo BackOffice o Admin adjuntan soporte de póliza');
    next();
  }),
  upload.array('archivos', env.uploads.maxFiles),
  asyncHandler(async (req, res) => {
    const files = req.files || [];
    if (!files.length) throw badRequest('No se recibió ningún archivo');

    const [{ n: existentes }] = await db('soportes_poliza').where({ cliente_id: req.params.clienteId }).count({ n: '*' });
    if (Number(existentes) + files.length > env.uploads.maxFiles) {
      for (const f of files) fs.unlink(f.path, () => {});
      throw badRequest(`Máximo ${env.uploads.maxFiles} archivos por cliente (ya tiene ${existentes})`);
    }

    const rows = files.map((f) => ({
      cliente_id: req.params.clienteId,
      nombre_archivo: f.originalname,
      ruta_archivo: path.relative(env.uploads.dir, f.path),
      tipo_archivo: f.mimetype,
      tamano_bytes: f.size,
      subido_por: req.user.id,
    }));
    await db('soportes_poliza').insert(rows);
    res.status(201).json(await db('soportes_poliza').where({ cliente_id: req.params.clienteId }).orderBy('id'));
  })
);

router.get(
  '/:id/archivo',
  asyncHandler(async (req, res) => {
    const row = await db('soportes_poliza').where({ id: req.params.id }).first();
    if (!row) throw notFound('Soporte no encontrado');
    await assertAccess(req, row.cliente_id);

    const fullPath = path.join(env.uploads.dir, row.ruta_archivo);
    if (!fullPath.startsWith(env.uploads.dir) || !fs.existsSync(fullPath)) {
      throw notFound('Archivo no encontrado en disco');
    }
    res.setHeader('Content-Type', row.tipo_archivo);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.nombre_archivo)}"`);
    fs.createReadStream(fullPath).pipe(res);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db('soportes_poliza').where({ id: req.params.id }).first();
    if (!row) throw notFound('Soporte no encontrado');
    await assertAccess(req, row.cliente_id);
    if (!puedeGestionar(req.user.role)) throw forbidden('Solo BackOffice o Admin eliminan soporte de póliza');

    await db('soportes_poliza').where({ id: row.id }).del();
    const fullPath = path.join(env.uploads.dir, row.ruta_archivo);
    fs.unlink(fullPath, () => {});
    res.json({ ok: true });
  })
);

export default router;
