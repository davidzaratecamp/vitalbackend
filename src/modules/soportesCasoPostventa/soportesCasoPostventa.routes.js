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
import { assertCasoAccesible, assertCasoIdActivo } from '../casosPostventa/casosPostventa.service.js';

const router = Router();
router.use(requireAuth);

// Subcarpeta propia dentro de uploads — separada de evidencias/ y
// soportes-poliza/ aunque comparta el mismo disco privado y los mismos
// límites de tamaño/tipo.
const BASE_DIR = path.join(env.uploads.dir, 'soportes-caso-postventa');
fs.mkdirSync(BASE_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(BASE_DIR, String(req.params.casoId));
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
  // Sin límite de negocio (a pedido del usuario, 2026-09-25: "documentos
  // ilimitados") — mismo techo técnico que evidencias, nunca pensado para
  // alcanzarse en un caso real.
  limits: { fileSize: env.uploads.maxSizeBytes, files: env.uploads.maxFilesEvidencias },
  fileFilter: (_req, file, cb) => {
    if (!env.uploads.allowedMime.includes(file.mimetype)) {
      return cb(badRequest(`Tipo de archivo no permitido: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

async function cargarCaso(casoId) {
  const caso = await db('casos_postventa').where({ id: casoId }).first('id', 'cliente_id', 'estado');
  if (!caso) throw notFound('Caso no encontrado');
  return caso;
}

router.get(
  '/caso/:casoId',
  asyncHandler(async (req, res) => {
    const caso = await cargarCaso(req.params.casoId);
    await assertCasoAccesible(caso, req.user);
    res.json(await db('soportes_caso_postventa').where({ caso_postventa_id: req.params.casoId }).orderBy('id'));
  })
);

router.post(
  '/caso/:casoId',
  asyncHandler(async (req, res, next) => {
    const caso = await cargarCaso(req.params.casoId);
    await assertCasoAccesible(caso, req.user);
    // Igual que editar el caso: agente/backoffice solo mientras lo tienen
    // activo en su cola; admin es de solo lectura acá también.
    if (req.user.role !== 'agente' && req.user.role !== 'backoffice') {
      throw forbidden('No tienes permiso para adjuntar documentos a este caso');
    }
    await assertCasoIdActivo(req.params.casoId, req.user.role);
    next();
  }),
  upload.array('archivos', env.uploads.maxFilesEvidencias),
  asyncHandler(async (req, res) => {
    const files = req.files || [];
    if (!files.length) throw badRequest('No se recibió ningún archivo');

    const rows = files.map((f) => ({
      caso_postventa_id: req.params.casoId,
      nombre_archivo: f.originalname,
      ruta_archivo: path.relative(env.uploads.dir, f.path),
      tipo_archivo: f.mimetype,
      tamano_bytes: f.size,
      subido_por: req.user.id,
    }));
    await db('soportes_caso_postventa').insert(rows);
    res.status(201).json(await db('soportes_caso_postventa').where({ caso_postventa_id: req.params.casoId }).orderBy('id'));
  })
);

router.get(
  '/:id/archivo',
  asyncHandler(async (req, res) => {
    const row = await db('soportes_caso_postventa').where({ id: req.params.id }).first();
    if (!row) throw notFound('Documento no encontrado');
    const caso = await cargarCaso(row.caso_postventa_id);
    await assertCasoAccesible(caso, req.user);

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
    const row = await db('soportes_caso_postventa').where({ id: req.params.id }).first();
    if (!row) throw notFound('Documento no encontrado');
    const caso = await cargarCaso(row.caso_postventa_id);
    await assertCasoAccesible(caso, req.user);
    if (req.user.role !== 'agente' && req.user.role !== 'backoffice') {
      throw forbidden('No tienes permiso para eliminar documentos de este caso');
    }
    await assertCasoIdActivo(row.caso_postventa_id, req.user.role);

    await db('soportes_caso_postventa').where({ id: row.id }).del();
    const fullPath = path.join(env.uploads.dir, row.ruta_archivo);
    fs.unlink(fullPath, () => {});
    res.json({ ok: true });
  })
);

export default router;
