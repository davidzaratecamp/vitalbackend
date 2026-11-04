import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { forbidden } from '../../utils/httpError.js';
import { fechaFiltroValida } from '../../utils/fechaFiltro.js';
import { getClienteOr404, assertAccesoCliente } from '../clientes/clientes.service.js';
import { listarCambios } from '../clientes/historialCambios.js';
import * as svc from './renovaciones.service.js';

const router = Router();
router.use(requireAuth);

/**
 * Apartado "Renovaciones" (2026-10-27, pedido del usuario). Una renovación
 * NO es un registro nuevo: es la misma venta, con el mismo ID, que el 1 de
 * noviembre vuelve a manos del agente. Por eso acá solo viven el listado,
 * la apertura de temporada y el envío a BackOffice — los formularios, las
 * evidencias y la gestión de BackOffice son exactamente los mismos
 * endpoints de siempre (`/api/clientes`, `/api/evidencias`,
 * `/api/backoffice`), que ya entienden los estados de renovación.
 */
function filtrosListado(req) {
  return {
    estados: req.query.estados ? String(req.query.estados).split(',') : [],
    q: req.query.q,
    anio: req.query.anio ? Number(req.query.anio) : undefined,
    agenteId: req.query.agenteId,
    desde: fechaFiltroValida(req.query.desde),
    hasta: fechaFiltroValida(req.query.hasta),
  };
}

router.get(
  '/',
  requireRole('agente', 'backoffice', 'admin', 'supervisor'),
  asyncHandler(async (req, res) => {
    res.json(await svc.listarRenovaciones(req.user, filtrosListado(req)));
  })
);

// Excel de la vista actual (2026-11-04). Mismos roles que pueden exportar
// en Postventa — el agente no, igual que allá.
router.get(
  '/export.xlsx',
  requireRole('backoffice', 'admin', 'supervisor'),
  asyncHandler(async (req, res) => {
    await svc.streamRenovacionesExcel(req.user, filtrosListado(req), res);
  })
);

// Antes de cualquier '/:id' — si no, Express toma "temporada" como un id.
router.get(
  '/temporada',
  requireRole('agente', 'backoffice', 'admin', 'supervisor'),
  asyncHandler(async (_req, res) => {
    res.json(await svc.resumenTemporada());
  })
);

/**
 * Abrir la temporada a mano. El proceso automático ya lo hace solo cada 6
 * horas (ver arrancarTemporadaAutomatica); este botón es la red de
 * seguridad: si el servidor estuvo caído el 1 de noviembre, o si hay que
 * verificar el resultado sin esperar al próximo chequeo. Es idempotente,
 * apretarlo dos veces no mueve nada dos veces.
 *
 * `anio` solo se acepta para adelantar una temporada que YA debería estar
 * abierta o una anterior — nunca una futura, que movería pólizas antes de
 * tiempo.
 */
const abrirTemporadaSchema = z
  .object({ anio: z.coerce.number().int().min(2020).max(2100).optional() })
  .optional();

router.post(
  '/abrir-temporada',
  requireRole('admin'),
  validate(abrirTemporadaSchema),
  asyncHandler(async (req, res) => {
    const anio = req.body?.anio;
    if (anio && anio > svc.temporadaDe()) {
      throw forbidden('Todavía no se puede abrir esa temporada — el 1 de noviembre de ese año no ha llegado');
    }
    res.json(await svc.abrirTemporada({ userId: req.user.id, anio }));
  })
);

/**
 * Historial de CAMBIOS de datos de un cliente (qué campo se tocó, con qué
 * valor estaba y con cuál quedó). Vive acá porque nació con las
 * renovaciones, pero devuelve todo el historial del registro; con
 * `?contexto=renovacion` se filtra a lo que se cambió renovando.
 */
router.get(
  '/:id/cambios',
  asyncHandler(async (req, res) => {
    const cliente = await getClienteOr404(req.params.id);
    await assertAccesoCliente(cliente, req.user);
    res.json(await listarCambios(cliente.id, { contexto: req.query.contexto }));
  })
);

/** El agente manda la renovación a BackOffice (equivalente de "Finalizar"). */
router.post(
  '/:id/finalizar',
  requireRole('agente'),
  asyncHandler(async (req, res) => {
    const cliente = await getClienteOr404(req.params.id);
    await assertAccesoCliente(cliente, req.user);
    if (cliente.agente_id !== req.user.id) {
      throw forbidden('Solo el agente dueño de la póliza puede enviar su renovación');
    }
    res.json(await svc.finalizarRenovacion(cliente.id, req.user.id));
  })
);

/**
 * "No se pudo renovar" (2026-11-03, pedido del usuario) — solo el agente
 * dueño, con observación obligatoria.
 */
const noRenovadoSchema = z.object({
  observacion: z.string().trim().min(5, 'Escribe por qué no se pudo renovar (mínimo 5 caracteres)').max(1000),
});

router.post(
  '/:id/no-renovado',
  requireRole('agente'),
  validate(noRenovadoSchema),
  asyncHandler(async (req, res) => {
    const cliente = await getClienteOr404(req.params.id);
    await assertAccesoCliente(cliente, req.user);
    if (cliente.agente_id !== req.user.id) {
      throw forbidden('Solo el agente dueño de la póliza puede marcarla como no renovada');
    }
    res.json(await svc.marcarNoRenovado(cliente.id, req.user.id, req.body.observacion));
  })
);

/** Admin deshace un "No se pudo renovar" marcado por error. */
const reabrirSchema = z.object({ motivo: z.string().trim().max(500).optional() }).optional();

router.post(
  '/:id/reabrir',
  requireRole('admin'),
  validate(reabrirSchema),
  asyncHandler(async (req, res) => {
    const cliente = await getClienteOr404(req.params.id);
    res.json(await svc.reabrirRenovacion(cliente.id, req.user.id, req.body?.motivo || null));
  })
);

export default router;
