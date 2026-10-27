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
router.get(
  '/',
  requireRole('agente', 'backoffice', 'admin', 'supervisor'),
  asyncHandler(async (req, res) => {
    const estados = req.query.estados ? String(req.query.estados).split(',') : [];
    res.json(
      await svc.listarRenovaciones(req.user, {
        estados,
        q: req.query.q,
        anio: req.query.anio ? Number(req.query.anio) : undefined,
        agenteId: req.query.agenteId,
        desde: fechaFiltroValida(req.query.desde),
        hasta: fechaFiltroValida(req.query.hasta),
      })
    );
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

export default router;
