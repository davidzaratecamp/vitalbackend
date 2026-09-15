import { Router } from 'express';
import { db } from '../../db/knex.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { ESTADO_CLIENTE } from '../clientes/clientes.constants.js';

const router = Router();
router.use(requireAuth, requireRole('agente'));

// Resumen para el panel del propio agente — igual idea que el dashboard de
// admin, pero acotado a lo que este agente ha registrado.
router.get(
  '/resumen',
  asyncHandler(async (req, res) => {
    const agenteId = req.user.id;

    const rows = await db('clientes').select('estado').count({ n: '*' }).where({ agente_id: agenteId }).groupBy('estado');
    const por_estado = Object.fromEntries(ESTADO_CLIENTE.map((e) => [e, 0]));
    for (const r of rows) por_estado[r.estado] = Number(r.n);
    const total = Object.values(por_estado).reduce((a, b) => a + b, 0);

    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const [{ n: aprobadosMes }] = await db('clientes')
      .where({ agente_id: agenteId, estado: 'aprobado' })
      .andWhere('updated_at', '>=', inicioMes)
      .count({ n: '*' });

    res.json({ por_estado, total, aprobados_mes: Number(aprobadosMes) });
  })
);

// Bandeja de "Ventas Rechazadas por BackOffice" — solo las del propio agente,
// con el motivo más reciente ya resuelto (no hay que ir a buscarlo aparte).
router.get(
  '/rechazados',
  asyncHandler(async (req, res) => {
    const clientes = await db('clientes')
      .where({ agente_id: req.user.id, estado: 'rechazado_backoffice' })
      .orderBy('updated_at', 'desc');

    if (!clientes.length) return res.json([]);

    const ids = clientes.map((c) => c.id);
    const motivos = await db('historial_estados_cliente')
      .whereIn('cliente_id', ids)
      .andWhere('estado_nuevo', 'rechazado_backoffice')
      .orderBy('created_at', 'desc');

    const motivoPorCliente = new Map();
    for (const m of motivos) {
      if (!motivoPorCliente.has(m.cliente_id)) motivoPorCliente.set(m.cliente_id, m);
    }

    res.json(
      clientes.map((c) => ({
        ...c,
        rechazo_motivo: motivoPorCliente.get(c.id)?.motivo || null,
        rechazo_fecha: motivoPorCliente.get(c.id)?.created_at || null,
      }))
    );
  })
);

export default router;
