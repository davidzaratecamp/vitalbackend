import { badRequest } from '../utils/httpError.js';
import { FIELD_LABELS } from '../utils/fieldLabels.js';

/** Busca `body.a.b.c` a partir de un path `['a','b','c']`, sin lanzar si algo intermedio no existe. */
function getIn(obj, path) {
  return path.reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/**
 * Convierte un issue de Zod en un mensaje explícito en español, nombrando
 * el campo (p. ej. "Hace falta llenar «Nombre del plan»." en vez del
 * genérico "Demasiado pequeño: se esperaba que texto tuviera >=2 caracteres").
 * Cuando el schema ya trae un mensaje propio (p. ej. los `.regex(re, 'msg')`
 * de `clientes.routes.js`), ese mensaje se respeta tal cual.
 *
 * Zod v4 no expone el valor recibido en `issue.input` dentro de un objeto
 * (solo en la raíz), así que para distinguir "campo vacío" de "campo con
 * tipo incorrecto" lo buscamos nosotros mismos en el body original.
 */
function friendlyMessage(issue, rawInput) {
  const key = issue.path.join('.');
  const label = FIELD_LABELS[key] || key;
  const received = getIn(rawInput, issue.path);

  switch (issue.code) {
    case 'invalid_type':
      if (received === undefined || received === null || received === '') {
        return label ? `Hace falta llenar «${label}».` : 'Hace falta llenar este campo.';
      }
      return label ? `«${label}» tiene un valor inválido.` : issue.message;

    case 'too_small': {
      if (issue.origin === 'string' && issue.minimum <= 1) {
        return label ? `Hace falta llenar «${label}».` : 'Hace falta llenar este campo.';
      }
      if (!label) return issue.message;
      if (issue.origin === 'string') return `«${label}» debe tener al menos ${issue.minimum} caracteres.`;
      if (issue.origin === 'number') return `«${label}» debe ser mayor o igual a ${issue.minimum}.`;
      return `${label}: ${issue.message}`;
    }

    case 'too_big': {
      if (!label) return issue.message;
      if (issue.origin === 'string') return `«${label}» no puede superar ${issue.maximum} caracteres.`;
      if (issue.origin === 'number') return `«${label}» debe ser menor o igual a ${issue.maximum}.`;
      return `${label}: ${issue.message}`;
    }

    case 'invalid_value':
      return label ? `«${label}»: selecciona una opción válida.` : issue.message;

    case 'invalid_format':
      if (issue.format === 'email') {
        return label ? `«${label}» debe ser un correo electrónico válido.` : issue.message;
      }
      // Formatos con mensaje propio (soloDigitos, fecha, etc.) — se respeta tal cual.
      return label ? `«${label}»: ${issue.message}` : issue.message;

    default:
      return label ? `«${label}»: ${issue.message}` : issue.message;
  }
}

/**
 * Middleware de validación con Zod. Reemplaza req[part] con los datos parseados.
 * @param {import('zod').ZodTypeAny} schema
 * @param {'body'|'query'|'params'} part
 */
export const validate = (schema, part = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[part]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: friendlyMessage(i, req[part]),
    }));
    return next(badRequest('Datos inválidos', details));
  }
  req[part] = result.data;
  next();
};
