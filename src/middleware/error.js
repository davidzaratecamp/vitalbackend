import { isDev } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';
import { FIELD_LABELS } from '../utils/fieldLabels.js';

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

  // Duplicado de MySQL (UNIQUE) — red de seguridad genérica para cualquier
  // choque que no pase por un pre-check específico (como
  // assertSocialCorreoDisponibles en clientes.service.js, que da un
  // mensaje mucho más útil con el cliente exacto que ya tiene el dato).
  // Acá solo se puede recuperar el nombre del campo y el valor rechazado
  // — MySQL manda "Duplicate entry 'valor' for key 'tabla.tabla_campo_unique'",
  // y knex nombra sus índices .unique() siguiendo ese patrón, así que se
  // puede extraer el campo sin mantener un mapa aparte.
  if (err?.code === 'ER_DUP_ENTRY') {
    const m = /Duplicate entry '(.*)' for key '(?:([a-zA-Z0-9_]+)\.)?([a-zA-Z0-9_]+)'/.exec(err.sqlMessage || '');
    if (m) {
      const [, valor, tabla, indexName] = m;
      let campo = tabla && indexName.startsWith(`${tabla}_`) ? indexName.slice(tabla.length + 1) : indexName;
      campo = campo.replace(/_unique$/, '');
      const etiqueta = FIELD_LABELS[campo] || campo;
      return res.status(409).json({ error: `Ya existe un registro con ese ${etiqueta.toLowerCase()}: "${valor}"` });
    }
    return res.status(409).json({ error: 'Ya existe un registro con ese valor único' });
  }

  console.error('[error]', err);
  res.status(500).json({ error: 'Error interno del servidor', ...(isDev ? { detail: err.message } : {}) });
}
