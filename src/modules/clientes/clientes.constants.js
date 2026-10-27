// Catálogos fijos compartidos por migraciones, validación (zod) y frontend.
// Un solo lugar para no repetir la falla del original (mismo catálogo escrito
// distinto en cada formulario).

// id de la fila 'Vital Asiste' en `empresas` (ver migración
// 20260919120000_empresas.js — Vital=1, Vital Asiste=2, fijo desde que se
// creó la tabla). Se usa en clientes.routes.js para la regla de "ningún
// backoffice de Vital Asiste ve datos de tarjeta salvo quien tenga permiso
// individual" (2026-09-25, pedido del usuario) — Vital todavía no tiene
// instrucción, sigue con su comportamiento de siempre.
export const EMPRESA_VITAL_ASISTE_ID = 2;

// Estados de `clientes` desde los que se puede abrir/gestionar un caso de
// postventa (validarTelefono, crearCaso en casosPostventa.service.js;
// assertAccesoCliente/assertCanEdit en clientes; assertCanEditEvidencia en
// evidencias). Hasta 2026-09-29 era solo 'aprobado' — el usuario pidió
// sumar 'pendiente_backoffice' (un cliente que llama mientras su venta
// sigue en trámite en BackOffice, no solo después de aprobada). El
// 2026-10-15 se sumó también 'pendiente_llamada_tripartita' (agentes
// creándole casos a BackOffice mientras la venta espera esa llamada). A
// propósito NO incluye 'rechazado_backoffice' — no fue pedido, se puede
// sumar después si hace falta.
// El 2026-10-27 se sumaron 'pendiente_renovacion' y 'renovado': una póliza
// en temporada de renovación sigue vigente y el cliente llama por lo que
// sea. Los dos estados de renovación que están EN TRÁMITE con BackOffice
// quedan afuera, igual que sus equivalentes de venta.
export const ESTADOS_POSTVENTA = [
  'aprobado',
  'pendiente_backoffice',
  'pendiente_llamada_tripartita',
  'pendiente_renovacion',
  'renovado',
];

// Estados en los que un cliente está "en trámite" con BackOffice — mientras
// está acá, ni siquiera el agente DUEÑO puede tocar el formulario (evita
// que edite datos mientras BackOffice/la llamada tripartita lo está
// revisando en simultáneo). Todo lo demás (borrador, rechazado_backoffice,
// y desde 2026-09-29 también aprobado) queda totalmente editable para el
// dueño — antes 'aprobado' quedaba bloqueado también para el dueño (exigía
// abrir un caso de postventa), reportado como bug por el usuario: "me
// dijeron que cuando estaba aprobado no era editable por parte del
// agente" — confirmado y corregido en assertCanEdit/assertCanEditEvidencia.
export const ESTADOS_EN_TRAMITE = [
  'pendiente_backoffice',
  'pendiente_llamada_tripartita',
  // Mismos candados del lado de renovaciones (2026-10-27).
  'pendiente_backoffice_renovacion',
  'pendiente_autorizacion_renovacion',
];

// Mismo prefijo/idea que REASIGNACION_PREFIJO en casosPostventa.constants.js
// (2026-09-29, exclusividad de BackOffice) — pero este es para reasignar la
// VENTA completa (clientes.agente_id) a otro agente, ej. cuando el agente
// dueño cambia de rol y deja ventas sin terminar (2026-10-05, pedido del
// usuario). Son dos constantes separadas a propósito (dos módulos, dos
// tablas de historial distintas) — si cambia el texto, cambiarlo en los dos
// lados (y en el espejo del frontend, clienteConstants.ts).
export const REASIGNACION_AGENTE_PREFIJO = '[Reasignación]';

/* ───────────────────────── Renovaciones ───────────────────────── */

/**
 * Cada 1 de noviembre abre la temporada de renovaciones (2026-10-27, pedido
 * del usuario): toda póliza vigente pasa de 'aprobado'/'renovado' a
 * 'pendiente_renovacion' y el agente la vuelve a trabajar con los mismos
 * formularios de la venta. El ID es SIEMPRE el mismo — una renovación no
 * crea un registro nuevo, la venta original cambia de estado.
 *
 * La fecha es fija y es la única que dispara el paso: una venta aprobada el
 * 31 de octubre entra al día siguiente (así funciona ACA — esa póliza cubre
 * hasta el 31 de diciembre y hay que renovarla para el año que viene), y
 * una aprobada el 2 de noviembre espera hasta el 1 de noviembre siguiente.
 * Confirmado explícitamente por el usuario el 2026-10-27.
 */
export const RENOVACION_MES = 11; // noviembre (1-12)
export const RENOVACION_DIA = 1;

/** Estados desde los que una póliza vigente entra a la temporada. */
export const ESTADOS_VIGENTES_PARA_RENOVAR = ['aprobado', 'renovado'];

/** Todo lo que vive en el apartado "Renovaciones" (los 5 estados). */
export const ESTADOS_RENOVACION = [
  'pendiente_renovacion',
  'pendiente_backoffice_renovacion',
  'pendiente_autorizacion_renovacion',
  'rechazado_backoffice_renovacion',
  'renovado',
];

/**
 * Donde el agente tiene la pelota: gestiona la renovación y la envía a
 * BackOffice. Espejo exacto de 'borrador'/'rechazado_backoffice' en el
 * flujo de venta — por eso el rechazo reusa el mismo camino de corrección.
 */
export const ESTADOS_RENOVACION_AGENTE = ['pendiente_renovacion', 'rechazado_backoffice_renovacion'];

/** Donde BackOffice tiene la pelota (espejo de ESTADOS_GESTIONABLES de ventas). */
export const ESTADOS_RENOVACION_BACKOFFICE = [
  'pendiente_backoffice_renovacion',
  'pendiente_autorizacion_renovacion',
];

/**
 * Marca en el historial de estados cuando la temporada mueve una póliza
 * sola (nadie la "cambió" a mano) — mismo patrón que
 * REASIGNACION_AGENTE_PREFIJO. El frontend lo usa para explicar por qué un
 * caso apareció en Renovaciones sin que nadie lo tocara.
 */
export const APERTURA_RENOVACION_PREFIJO = '[Renovación]';

// Lo que el agente puede ELEGIR hoy en el formulario — y lo único que
// acepta Zod. Espejo en frontend/src/lib/clienteConstants.ts.
export const ESTATUS_MIGRATORIO = [
  'RESIDENTE',
  'CIUDADANO',
  'PERMISO DE TRABAJO',
  'PASAPORTE',
  'VISA DE TRABAJO',
  'ASILO/REFUGIADO',
  'ASILO/POLITICO',
  'TPS',
  'GREEN CARD',
  'I-220A',
  'I-797 (PROCESO PERMISO DE TRABAJO)',
  'I-797 (PROCESO RESIDENCIA)',
];

// Valores que salieron del catálogo pero siguen vivos en la base porque hay
// registros viejos guardados con ellos ('PAROLE HUMANITARIO' se retiró el
// 2026-10-22 a pedido del usuario, y el cliente 175 de producción lo tiene).
// El ENUM de la columna es la UNIÓN de los dos arrays (ver la migración
// 20261022100000_estatus_migratorio_i797.js): así nadie lo puede volver a
// elegir y ningún dato histórico se pierde ni se trunca en el ALTER. Cuando
// esos registros se corrijan, sacarlo de acá y estrechar el ENUM.
export const ESTATUS_MIGRATORIO_HISTORICOS = ['PAROLE HUMANITARIO'];

export const ESTATUS_MIGRATORIO_DB = [...ESTATUS_MIGRATORIO, ...ESTATUS_MIGRATORIO_HISTORICOS];

export const SEXO = ['Masculino', 'Femenino'];

export const ORIGEN_VENTA = ['lead', 'referido', 'base'];
export const ORIGEN_VENTA_LABEL = { lead: 'Lead', referido: 'Referido', base: 'Base' };

export const PARENTESCO = ['Conyuge', 'Hijo', 'Hijastro', 'Padre', 'Madre', 'Otro'];

export const TIPO_DECLARACION = ['W2', '1099'];

export const TIPO_METAL = ['Bronce', 'Plata', 'Oro', 'Platino'];
export const TIPO_RED = ['HMO', 'PPO', 'EPO'];

export const ESTADO_PRIMA = [
  'Pendiente de tarjeta',
  'Debito OK',
  'Debito automatico',
  'Debito rechazado',
  'Sin cargo de prima',
];

export const METODO_PAGO = ['tarjeta', 'debito_automatico', 'otro'];
export const MARCA_TARJETA = ['Visa', 'Mastercard', 'Otra'];

// Categorías del Paso 7 (evidencias) — cada una es su propio "casillero" en
// vez de una lista plana de archivos sin etiquetar, así el agente sabe
// exactamente qué falta subir. poliza/estatus_migratorio/licencia son
// obligatorias para poder finalizar (ver finalizar() en clientes.service.js);
// social y carta_cms_anterior son opcionales. carta_cms_anterior se agregó
// 2026-09-25 para postventa: cuando el cliente pide actualizar su póliza,
// queda la carta CMS vieja guardada para poder hacer firmar la nueva
// después (mismo Paso 7, ahora también reusado por GestionCasoPage.tsx).
export const CATEGORIA_EVIDENCIA = ['poliza', 'estatus_migratorio', 'licencia', 'social', 'carta_cms_anterior'];
export const CATEGORIA_EVIDENCIA_LABEL = {
  poliza: 'Póliza',
  estatus_migratorio: 'Estatus migratorio',
  licencia: 'Licencia',
  social: 'Social',
  carta_cms_anterior: 'Carta CMS anterior',
};
export const CATEGORIA_EVIDENCIA_OBLIGATORIA = ['poliza', 'estatus_migratorio', 'licencia'];

export const ESTADO_CLIENTE = [
  'borrador',
  'pendiente_backoffice',
  'pendiente_llamada_tripartita',
  'aprobado',
  'rechazado_backoffice',
  // Renovaciones (2026-10-27, pedido del usuario) — ver el bloque de
  // Renovaciones más abajo. Van al final del ENUM a propósito: agregar un
  // valor al final de un ENUM de MySQL no reescribe la tabla.
  'pendiente_renovacion',
  'pendiente_backoffice_renovacion',
  'pendiente_autorizacion_renovacion',
  'rechazado_backoffice_renovacion',
  'renovado',
];
export const ESTADO_CLIENTE_LABEL = {
  borrador: 'Borrador',
  pendiente_backoffice: 'Pendiente BackOffice',
  pendiente_llamada_tripartita: 'Pendiente llamada tripartita',
  aprobado: 'Aprobado',
  rechazado_backoffice: 'Rechazado por BackOffice',
  pendiente_renovacion: 'Pendiente renovación',
  pendiente_backoffice_renovacion: 'Pendiente BackOffice renovación',
  pendiente_autorizacion_renovacion: 'Pendiente autorización renovación',
  rechazado_backoffice_renovacion: 'Rechazo BackOffice renovación',
  renovado: 'Renovado',
};
