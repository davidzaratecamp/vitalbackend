// Catálogos fijos compartidos por migraciones, validación (zod) y frontend.
// Un solo lugar para no repetir la falla del original (mismo catálogo escrito
// distinto en cada formulario).

export const ESTATUS_MIGRATORIO = [
  'RESIDENTE',
  'CIUDADANO',
  'PERMISO DE TRABAJO',
  'PASAPORTE',
  'VISA DE TRABAJO',
  'ASILO/REFUGIADO',
  'ASILO/POLITICO',
  'PAROLE HUMANITARIO',
  'TPS',
  'GREEN CARD',
  'I-220A',
];

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
// social es la única opcional.
export const CATEGORIA_EVIDENCIA = ['poliza', 'estatus_migratorio', 'licencia', 'social'];
export const CATEGORIA_EVIDENCIA_LABEL = {
  poliza: 'Póliza',
  estatus_migratorio: 'Estatus migratorio',
  licencia: 'Licencia',
  social: 'Social',
};
export const CATEGORIA_EVIDENCIA_OBLIGATORIA = ['poliza', 'estatus_migratorio', 'licencia'];

export const ESTADO_CLIENTE = ['borrador', 'pendiente_backoffice', 'aprobado', 'rechazado_backoffice'];
export const ESTADO_CLIENTE_LABEL = {
  borrador: 'Borrador',
  pendiente_backoffice: 'Pendiente BackOffice',
  aprobado: 'Aprobado',
  rechazado_backoffice: 'Rechazado por BackOffice',
};
