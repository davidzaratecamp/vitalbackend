/**
 * Todo lo que el agente escribe a mano en el formulario de venta queda en
 * MAYÚSCULAS, se escriba como se escriba (2026-10-22, pedido del usuario).
 *
 * Se aplica en el schema de Zod (`validate` reemplaza `req.body` con los
 * datos parseados) y no solo en el navegador, para que valga igual si el
 * dato entra por la API, por un script o por otro formulario que apunte al
 * mismo endpoint. El frontend además lo muestra en mayúsculas mientras se
 * escribe — ver `frontend/src/lib/mayusculas.ts`.
 *
 * Lo que queda AFUERA a propósito:
 * - Correos (`correo_electronico`): se usan como contacto y para el envío
 *   de la carta de firma; en mayúsculas se leen mal y no aporta nada.
 * - `estado_us` y `ciudad`: no se escriben, se eligen de un catálogo fijo
 *   (`frontend/src/data/locationsData.ts`, 'Alabama', 'Miami'...). Si se
 *   guardaran en mayúsculas el valor dejaría de coincidir con la opción del
 *   desplegable y el campo se vería vacío al reabrir el registro.
 * - Teléfonos, SSN, código postal, rutas y cuentas: ya son solo dígitos.
 * - Los ENUM del catálogo (`sexo`, `tipo_metal`, `origen_venta`...): sus
 *   valores tienen su propio case ('Masculino', 'Bronce', 'lead') y
 *   cambiarlo rompería la validación.
 * - Observaciones, motivos de rechazo y notas de postventa: son texto
 *   narrativo, no campos del formulario — en mayúsculas se vuelven
 *   ilegibles.
 */
export const aMayusculas = (valor) => (typeof valor === 'string' ? valor.toUpperCase() : valor);

/**
 * Envuelve un schema de Zod para que su salida quede en mayúsculas. Se
 * aplica DESPUÉS de validar (`.min()`/`.max()` ven el texto original) y
 * deja pasar `null`/`undefined` tal cual, así sirve igual sobre un
 * `.optional().nullable()`.
 * @template T
 * @param {T} schema
 */
export const mayus = (schema) => schema.transform(aMayusculas);
