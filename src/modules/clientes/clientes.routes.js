import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { forbidden } from '../../utils/httpError.js';
import * as svc from './clientes.service.js';
import {
  SEXO,
  ESTATUS_MIGRATORIO,
  ORIGEN_VENTA,
  PARENTESCO,
  TIPO_DECLARACION,
  TIPO_METAL,
  TIPO_RED,
  ESTADO_PRIMA,
  METODO_PAGO,
} from './clientes.constants.js';

const router = Router();
router.use(requireAuth);

const soloDigitos = (n) => z.string().regex(new RegExp(`^\\d{${n}}$`), `Debe tener ${n} dígitos`);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)');

/* ───────────────────────── guardas de acceso ───────────────────────── */

async function loadCliente(req, _res, next) {
  const cliente = await svc.getClienteOr404(req.params.id);
  svc.assertOwnerIfAgente(cliente, req.user);
  req.cliente = cliente;
  next();
}

function assertCanEdit(req) {
  if (req.user.role !== 'agente') throw forbidden('Solo el agente edita el registro');
  svc.assertEditable(req.cliente);
}

/* ───────────────────────── Paso 1 — Titular ───────────────────────── */

const titularSchema = z.object({
  solicita_cobertura: z.coerce.boolean().optional().default(false),
  nombres: z.string().min(2).max(120),
  apellidos: z.string().min(2).max(120),
  sexo: z.enum(SEXO),
  fecha_nacimiento: fecha,
  social: soloDigitos(9),
  estatus_migratorio: z.enum(ESTATUS_MIGRATORIO),
  direccion: z.string().min(3).max(200),
  tipo_vivienda: z.string().max(60).optional().nullable(),
  estado_us: z.string().min(2).max(60),
  condado: z.string().min(2).max(80),
  ciudad: z.string().min(2).max(80),
  codigo_postal: soloDigitos(5),
  correo_electronico: z.string().email().max(190),
  phone_1: z.string().min(7).max(20),
  phone_2: z.string().max(20).optional().nullable(),
  whatsapp: z.string().max(20).optional().nullable(),
  contacto_emergencia_nombre: z.string().max(120).optional().nullable(),
  contacto_emergencia_telefono: z.string().max(20).optional().nullable(),
  contacto_emergencia_email: z.string().email().max(190).optional().nullable().or(z.literal('')),
  origen_venta: z.enum(ORIGEN_VENTA),
  pregunta_seguridad: z.string().min(2).max(160),
  respuesta_seguridad: z.string().min(2).max(160),
});

router.post(
  '/',
  requireRole('agente'),
  validate(titularSchema),
  asyncHandler(async (req, res) => {
    const cliente = await svc.crearCliente(req.user.id, req.body);
    res.status(201).json(cliente);
  })
);

router.patch(
  '/:id',
  loadCliente,
  validate(titularSchema.partial()),
  asyncHandler(async (req, res) => {
    assertCanEdit(req);
    res.json(await svc.actualizarTitular(req.params.id, req.body));
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await svc.listarClientes(req.user, { estado: req.query.estado, q: req.query.q }));
  })
);

// Antes de /:id — si no, Express la confunde con un id de cliente.
router.get(
  '/verificar-duplicado',
  asyncHandler(async (req, res) => {
    res.json(await svc.buscarDuplicados({ social: req.query.social, correo: req.query.correo, excluirId: req.query.excluirId }));
  })
);

// Compuerta antes de "Nuevo registro" — ver buscarPorTelefono.
router.get(
  '/verificar-telefono',
  asyncHandler(async (req, res) => {
    res.json(await svc.buscarPorTelefono(req.query.telefono));
  })
);

router.get(
  '/:id',
  loadCliente,
  asyncHandler(async (req, res) => {
    res.json(await svc.getClienteDetalle(req.params.id));
  })
);

/* ───────────────────────── Paso 2 — Cónyuge ───────────────────────── */

const conyugeSchema = z.object({
  no_tiene: z.coerce.boolean().optional().default(false),
  solicita_cobertura: z.coerce.boolean().optional().default(false),
  medicare_medicaid: z.coerce.boolean().optional().default(false),
  nombres: z.string().min(2).max(120).optional(),
  apellidos: z.string().min(2).max(120).optional(),
  sexo: z.enum(SEXO).optional(),
  fecha_nacimiento: fecha.optional(),
  social: soloDigitos(9).optional().nullable(),
  estatus_migratorio: z.enum(ESTATUS_MIGRATORIO).optional(),
});

router.put(
  '/:id/conyuge',
  loadCliente,
  validate(conyugeSchema),
  asyncHandler(async (req, res) => {
    assertCanEdit(req);
    res.json(await svc.setConyuge(req.params.id, req.body));
  })
);

router.get(
  '/:id/conyuge',
  loadCliente,
  asyncHandler(async (req, res) => {
    res.json((await svc.getConyuge(req.params.id)) || null);
  })
);

/* ───────────────────────── Paso 3 — Dependientes ───────────────────────── */

const dependienteSchema = z.object({
  parentesco: z.enum(PARENTESCO.filter((p) => p !== 'Conyuge')).default('Hijo'),
  solicita_cobertura: z.coerce.boolean().optional().default(false),
  medicare_medicaid: z.coerce.boolean().optional().default(false),
  nombres: z.string().min(2).max(120),
  apellidos: z.string().min(2).max(120),
  sexo: z.enum(SEXO),
  fecha_nacimiento: fecha,
  social: soloDigitos(9).optional().nullable(),
  estatus_migratorio: z.enum(ESTATUS_MIGRATORIO),
});

router.get(
  '/:id/dependientes',
  loadCliente,
  asyncHandler(async (req, res) => {
    res.json(await svc.listarDependientes(req.params.id));
  })
);

router.post(
  '/:id/dependientes',
  loadCliente,
  validate(dependienteSchema),
  asyncHandler(async (req, res) => {
    assertCanEdit(req);
    res.status(201).json(await svc.agregarDependiente(req.params.id, req.body));
  })
);

router.patch(
  '/:id/dependientes/:depId',
  loadCliente,
  validate(dependienteSchema.partial()),
  asyncHandler(async (req, res) => {
    assertCanEdit(req);
    res.json(await svc.actualizarDependiente(req.params.id, req.params.depId, req.body));
  })
);

router.delete(
  '/:id/dependientes/:depId',
  loadCliente,
  asyncHandler(async (req, res) => {
    assertCanEdit(req);
    await svc.eliminarDependiente(req.params.id, req.params.depId);
    res.json({ ok: true });
  })
);

/* ───────────────────────── Paso 4 — Ingresos ───────────────────────── */

const ingresoSchema = z.object({
  tiene_ingresos: z.coerce.boolean().optional().default(true),
  tipo_declaracion: z.enum(TIPO_DECLARACION).optional().default('W2'),
  ingresos_semanales: z.coerce.number().min(0).optional().default(0),
});

router.get(
  '/:id/ingresos',
  loadCliente,
  asyncHandler(async (req, res) => {
    const rows = await svc.listarIngresos(req.params.id);
    res.json({ rows, total_familia: await svc.totalIngresosFamilia(req.params.id) });
  })
);

router.put(
  '/:id/ingresos',
  loadCliente,
  validate(ingresoSchema),
  asyncHandler(async (req, res) => {
    assertCanEdit(req);
    res.json(await svc.setIngresoTitular(req.params.id, req.body));
  })
);

router.put(
  '/:id/dependientes/:depId/ingresos',
  loadCliente,
  validate(ingresoSchema),
  asyncHandler(async (req, res) => {
    assertCanEdit(req);
    res.json(await svc.setIngresoDependiente(req.params.id, req.params.depId, req.body));
  })
);

/* ───────────────────────── Paso 5 — Plan de salud ───────────────────────── */

const planSaludSchema = z.object({
  aseguradora_id: z.coerce.number().int().positive(),
  nombre_plan: z.string().min(2).max(160),
  tipo_metal: z.enum(TIPO_METAL),
  tipo_red: z.enum(TIPO_RED),
  deducible: z.coerce.number().min(0).optional().nullable(),
  gasto_max_bolsillo: z.coerce.number().min(0).optional().nullable(),
  valor_prima: z.coerce.number().positive(),
  npn: z.string().max(40).optional().nullable(),
  estado_prima: z.enum(ESTADO_PRIMA).optional().nullable(),
  // Para la carta de firma (FirmaCloud) — se manda tal cual, sin el signo $.
  taxes: z.coerce.number().min(0).optional().nullable(),
  // pd/sd/gd: lo que el agente ve en la pantalla "Usted paga" de la otra
  // plataforma (ej. "Sin cargo por visita desde el día 1", "50% coaseguro
  // después del deducible") — texto libre, no un número limpio, aunque la
  // API de FirmaCloud los pida como "numérico".
  pd: z.string().max(120).optional().nullable(),
  sd: z.string().max(120).optional().nullable(),
  gd: z.string().max(120).optional().nullable(),
  // A qué productor (catálogo `npn_productores`) pertenece el NPN de esta
  // venta — independiente del campo `npn` de texto libre de BackOffice.
  npn_productor_id: z.coerce.number().int().positive().optional().nullable(),
});

router.get(
  '/:id/plan-salud',
  loadCliente,
  asyncHandler(async (req, res) => {
    if (req.query.historial === '1') {
      return res.json(await svc.getPlanSaludHistorial(req.params.id));
    }
    res.json((await svc.getPlanSaludActual(req.params.id)) || null);
  })
);

router.put(
  '/:id/plan-salud',
  loadCliente,
  validate(planSaludSchema),
  asyncHandler(async (req, res) => {
    // Paso 5 del Agente (cotización). La confirmación de BackOffice usa su
    // propio endpoint (PUT /api/backoffice/clientes/:id) — ver ese módulo.
    assertCanEdit(req);
    res.json(await svc.setPlanSalud(req.params.id, req.body, req.user.id, 'cotizado_agente'));
  })
);

/* ───────────────────────── Paso 6 — Pago ───────────────────────── */

const pagoSchema = z.object({
  metodo: z.enum(METODO_PAGO).optional().default('tarjeta'),
  // Número completo de la tarjeta — solo de ida (no se guarda en texto
  // plano ni se vuelve a exponer). Opcional: si se omite (ej. el agente
  // solo corrige el vencimiento), el número ya guardado no se toca. Los
  // últimos 4 dígitos y la marca se derivan de este, no se aceptan sueltos.
  numero_tarjeta: z.string().regex(/^\d{13,19}$/, 'Debe tener entre 13 y 19 dígitos').optional().nullable(),
  nombre_titular_tarjeta: z.string().max(120).optional().nullable(),
  fecha_expiracion_mes: z.coerce.number().int().min(1).max(12).optional().nullable(),
  fecha_expiracion_ano: z.coerce.number().int().min(new Date().getFullYear()).max(2099).optional().nullable(),
  // Nota de texto libre — el agente la escribe pero no la vuelve a ver
  // (queda enmascarada mientras escribe y después). Solo BackOffice/Admin
  // pueden revelarla (ver GET /:id/pago/data-point).
  data_point: z.string().max(300).optional().nullable(),
});

router.get(
  '/:id/pago',
  loadCliente,
  asyncHandler(async (req, res) => {
    res.json((await svc.getPago(req.params.id)) || null);
  })
);

router.put(
  '/:id/pago',
  loadCliente,
  validate(pagoSchema),
  asyncHandler(async (req, res) => {
    assertCanEdit(req);
    res.json(await svc.setPago(req.params.id, req.body));
  })
);

// Número completo descifrado — solo BackOffice/Admin, y queda auditado en
// `accesos_tarjeta` (quién lo vio y cuándo). El agente nunca lo vuelve a ver
// una vez guardado; solo la tarjeta enmascarada.
router.get(
  '/:id/pago/numero-completo',
  loadCliente,
  requireRole('backoffice', 'admin'),
  asyncHandler(async (req, res) => {
    res.json((await svc.getNumeroTarjetaCompleto(req.params.id, req.user.id)) || null);
  })
);

// "Data Point" — solo BackOffice/Admin. El agente nunca lo vuelve a ver,
// ni siquiera él mismo (a diferencia de la tarjeta, no queda auditado:
// no es un dato de pago regulado, solo se pidió ocultarlo del agente).
router.get(
  '/:id/pago/data-point',
  loadCliente,
  requireRole('backoffice', 'admin'),
  asyncHandler(async (req, res) => {
    res.json(await svc.getDataPointCompleto(req.params.id));
  })
);

/* ───────────────────────── Finalizar ───────────────────────── */

router.post(
  '/:id/finalizar',
  loadCliente,
  requireRole('agente'),
  asyncHandler(async (req, res) => {
    svc.assertOwnerIfAgente(req.cliente, req.user);
    res.json(await svc.finalizar(req.params.id, req.user.id));
  })
);

/* ───────────────────────── Observaciones (bitácora) ───────────────────────── */

const observacionSchema = z.object({ comentario: z.string().min(2).max(2000) });

router.post(
  '/:id/observaciones',
  loadCliente,
  validate(observacionSchema),
  asyncHandler(async (req, res) => {
    // El supervisor es solo-lectura — ni siquiera deja una nota.
    if (req.user.role === 'supervisor') throw forbidden('Los supervisores no pueden agregar observaciones');
    res.status(201).json(await svc.agregarObservacion(req.params.id, req.user.id, req.body.comentario));
  })
);

export default router;
