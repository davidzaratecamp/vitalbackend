import { isDev } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Ruta no encontrada' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    const body = { error: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }

  // Duplicado de MySQL (UNIQUE) — mensaje legible en vez del error crudo.
  if (err?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Ya existe un registro con ese valor único' });
  }

  console.error('[error]', err);
  res.status(500).json({ error: 'Error interno del servidor', ...(isDev ? { detail: err.message } : {}) });
}
