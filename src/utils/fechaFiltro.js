// Valida un filtro de fecha "Desde"/"Hasta" (YYYY-MM-DD) antes de que
// llegue a un `WHERE ... >= '${valor}'` armado a mano en un service
// (admin.service.js, backoffice.service.js, casosPostventa.service.js) —
// sin esto, un valor mal formado (ej. "92026-09-23", visto en producción
// 2026-09-24: el año duplicado por un input type="date" nativo que no
// clampeó bien) rompe la consulta con un ER_WRONG_VALUE de MySQL (error
// 500) en vez de simplemente ignorarse. Devuelve el valor tal cual si es
// válido, o `undefined` (equivale a "sin filtro") si no lo es — nunca
// tira, porque un filtro de fecha roto no debería voltear la pantalla.
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function fechaFiltroValida(valor) {
  return typeof valor === 'string' && FECHA_RE.test(valor) ? valor : undefined;
}
