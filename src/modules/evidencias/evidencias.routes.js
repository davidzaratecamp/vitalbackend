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
import { getClienteOr404, assertAccesoCliente, assertEditable } from '../clientes/clientes.service.js';
import { assertCasoActivo } from '../casosPostventa/casosPostventa.service.js';
import { CATEGORIA_EVIDENCIA } from '../clientes/clientes.constants.js';

const router = Router();
router.use(requireAuth);

fs.mkdirSync(env.uploads.dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(env.uploads.dir, String(req.params.clienteId));
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
  // maxFilesEvidencias, no maxFiles — acá no hay límite de negocio (ver
  // env.js), esto es solo un techo técnico generoso.
  limits: { fileSize: env.uploads.maxSizeBytes, files: env.uploads.maxFilesEvidencias },
  fileFilter: (_req, file, cb) => {
    if (!env.uploads.allowedMime.includes(file.mimetype)) {
      return cb(badRequest(`Tipo de archivo no permitido: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

async function assertAccess(req, clienteId) {
  const cliente = await getClienteOr404(clienteId);
  await assertAccesoCliente(cliente, req.user);
  return cliente;
}

// Mismo criterio que assertCanEdit en clientes.routes.js: el agente sube/
// borra evidencia de su propio borrador/rechazado; sobre un cliente ya
// APROBADO (suyo o de otro agente de su empresa — postventa) y BackOffice,
// solo si tienen un caso de postventa activo para ese cliente.
async function assertCanEditEvidencia(req, cliente) {
  if (req.user.role === 'agente') {
    if (cliente.agente_id === req.user.id && cliente.estado !== 'aprobado') {
      assertEditable(cliente);
      return;
    }
    await assertCasoActivo(cliente.id, 'agente');
    return;
  }
  if (req.user.role === 'backoffice') {
    await assertCasoActivo(cliente.id, 'backoffice');
    return;
  }
  throw forbidden('No tienes permiso para gestionar evidencias de este registro');
}

router.get(
  '/cliente/:clienteId',
  asyncHandler(async (req, res) => {
    await assertAccess(req, req.params.clienteId);
    res.json(await db('evidencias').where({ cliente_id: req.params.clienteId }).orderBy('id'));
  })
);

router.post(
  '/cliente/:clienteId',
  asyncHandler(async (req, res, next) => {
    const cliente = await assertAccess(req, req.params.clienteId);
    await assertCanEditEvidencia(req, cliente);
    next();
  }),
  upload.array('archivos', env.uploads.maxFilesEvidencias),
  asyncHandler(async (req, res) => {
    const files = req.files || [];
    if (!files.length) throw badRequest('No se recibió ningún archivo');

    // Cada subida va a una sola categoría (Póliza/Estatus migratorio/
    // Licencia/Social) — el frontend manda un uploader por casillero, así
    // que "categoria" siempre viene en el body, nunca por archivo.
    const categoria = req.body.categoria;
    if (!CATEGORIA_EVIDENCIA.includes(categoria)) {
      for (const f of files) fs.unlink(f.path, () => {});
      throw badRequest('Selecciona una categoría válida para el archivo', ['categoria']);
    }

    // Sin tope de cantidad por cliente (2026-09-23, a pedido del usuario)
    // — con el titular + varios enrolados hacen falta varios archivos por
    // categoría obligatoria, el límite de 5 de antes bloqueaba casos
    // legítimos.
    const rows = files.map((f) => ({
      cliente_id: req.params.clienteId,
      nombre_archivo: f.originalname,
      ruta_archivo: path.relative(env.uploads.dir, f.path),
      tipo_archivo: f.mimetype,
      categoria,
      tamano_bytes: f.size,
      descripcion: req.body.descripcion || null,
      subido_por: req.user.id,
    }));
    await db('evidencias').insert(rows);
    res.status(201).json(await db('evidencias').where({ cliente_id: req.params.clienteId }).orderBy('id'));
  })
);

router.get(
  '/:id/archivo',
  asyncHandler(async (req, res) => {
    const row = await db('evidencias').where({ id: req.params.id }).first();
    if (!row) throw notFound('Evidencia no encontrada');
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
    const row = await db('evidencias').where({ id: req.params.id }).first();
    if (!row) throw notFound('Evidencia no encontrada');
    const cliente = await assertAccess(req, row.cliente_id);
    await assertCanEditEvidencia(req, cliente);

    await db('evidencias').where({ id: row.id }).del();
    const fullPath = path.join(env.uploads.dir, row.ruta_archivo);
    fs.unlink(fullPath, () => {});
    res.json({ ok: true });
  })
);

export default router;
