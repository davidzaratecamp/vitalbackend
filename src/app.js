import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { z } from 'zod';
import { es } from 'zod/locales';
import { env, isDev } from './config/env.js';

// Mensajes de Zod en español por defecto (red de seguridad para cualquier
// validación que no pase por `friendlyMessage()` en middleware/validate.js).
z.config(es());
import { errorHandler, notFoundHandler } from './middleware/error.js';

import authRoutes from './modules/auth/auth.routes.js';
import usuariosSistemaRoutes from './modules/usuariosSistema/usuariosSistema.routes.js';
import clientesRoutes from './modules/clientes/clientes.routes.js';
import backofficeRoutes from './modules/backoffice/backoffice.routes.js';
import agenteRoutes from './modules/agente/agente.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import catalogosRoutes from './modules/catalogos/catalogos.routes.js';
import evidenciasRoutes from './modules/evidencias/evidencias.routes.js';
import soportesPolizaRoutes from './modules/soportesPoliza/soportesPoliza.routes.js';
import notificacionesRoutes from './modules/notificaciones/notificaciones.routes.js';
import firmasRoutes from './modules/firmas/firmas.routes.js';
import casosPostventaRoutes from './modules/casosPostventa/casosPostventa.routes.js';
import soportesCasoPostventaRoutes from './modules/soportesCasoPostventa/soportesCasoPostventa.routes.js';
import grabacionesRoutes from './modules/grabaciones/grabaciones.routes.js';

export function createApp() {
  const app = express();

  // En producción, nginx corre en el mismo host (127.0.0.1) y manda
  // X-Forwarded-For/X-Real-IP — 'loopback' hace que Express confíe SOLO en
  // ese salto para resolver `req.ip` (no en cualquier proxy, que sería
  // spoofeable por cualquiera). Sin esto, `req.ip` siempre daba 127.0.0.1
  // (la IP de nginx) en vez de la IP real del cliente — usado desde
  // 2026-09-29 para dejar la IP de origen en la papelera de admin
  // (clientes_eliminados.ip_origen) y de paso corrige el warning de
  // express-rate-limit (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR) en el login.
  app.set('trust proxy', 'loopback');

  app.use(helmet());
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  if (isDev) app.use(morgan('dev'));

  // Ninguna respuesta de la API debe quedar cacheada por el navegador (ni
  // por ningún proxy intermedio) — son datos sensibles y siempre deben
  // salir frescos de la base. Sin esto, helmet() no manda ningún
  // Cache-Control, y algunos navegadores pueden reutilizar una respuesta
  // vieja bajo ciertas condiciones aunque no exista un caché "explícito".
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'vital-api' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/usuarios-sistema', usuariosSistemaRoutes);
  app.use('/api/clientes', clientesRoutes);
  app.use('/api/backoffice', backofficeRoutes);
  app.use('/api/agente', agenteRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/catalogos', catalogosRoutes);
  app.use('/api/evidencias', evidenciasRoutes);
  app.use('/api/soportes-poliza', soportesPolizaRoutes);
  app.use('/api/notificaciones', notificacionesRoutes);
  app.use('/api/firmas', firmasRoutes);
  app.use('/api/casos-postventa', casosPostventaRoutes);
  app.use('/api/soportes-caso-postventa', soportesCasoPostventaRoutes);
  app.use('/api/grabaciones', grabacionesRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
