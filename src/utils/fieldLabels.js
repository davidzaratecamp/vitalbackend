/**
 * Nombres en español de los campos validados por Zod, usados por el
 * middleware de validación para armar mensajes de error explícitos
 * ("Hace falta llenar «Nombre del plan»" en vez del código técnico del
 * campo). Las llaves son el nombre del campo tal como llega en el body.
 */
export const FIELD_LABELS = {
  // Paso 1 — Titular
  nombres: 'Nombres',
  apellidos: 'Apellidos',
  sexo: 'Sexo',
  fecha_nacimiento: 'Fecha de nacimiento',
  social: 'Social Security Number',
  estatus_migratorio: 'Estatus migratorio',
  direccion: 'Dirección',
  tipo_vivienda: 'Tipo de vivienda',
  estado_us: 'Estado (EE. UU.)',
  condado: 'Condado',
  ciudad: 'Ciudad',
  codigo_postal: 'Código postal',
  correo_electronico: 'Correo electrónico',
  phone_1: 'Teléfono principal',
  phone_2: 'Teléfono secundario',
  whatsapp: 'WhatsApp',
  contacto_emergencia_nombre: 'Nombre del contacto de emergencia',
  contacto_emergencia_telefono: 'Teléfono del contacto de emergencia',
  contacto_emergencia_email: 'Correo del contacto de emergencia',
  origen_venta: 'Origen de la venta',
  pregunta_seguridad: 'Pregunta de seguridad',
  respuesta_seguridad: 'Respuesta de seguridad',

  // Paso 3 — Dependientes
  parentesco: 'Parentesco',

  // Paso 4 — Ingresos
  tipo_declaracion: 'Tipo de declaración',
  ingresos_semanales: 'Ingresos semanales',

  // Paso 5 — Plan de salud
  aseguradora_id: 'Aseguradora',
  nombre_plan: 'Nombre del plan',
  tipo_metal: 'Tipo (metal)',
  tipo_red: 'Red',
  deducible: 'Deducible',
  gasto_max_bolsillo: 'Gasto máximo de bolsillo',
  valor_prima: 'Valor de la prima',
  npn: 'NPN',
  estado_prima: 'Estado de la prima',
  taxes: 'Taxes',

  // Paso 6 — Pago
  metodo: 'Método de pago',
  ultimos_4_digitos: 'Últimos 4 dígitos de la tarjeta',
  nombre_titular_tarjeta: 'Nombre del titular de la tarjeta',
  fecha_expiracion_mes: 'Mes de vencimiento',
  fecha_expiracion_ano: 'Año de vencimiento',

  // Observaciones / BackOffice
  comentario: 'Comentario',
  motivo: 'Motivo del rechazo',

  // Catálogo de aseguradoras / usuarios del sistema / auth
  nombre: 'Nombre',
  email: 'Correo electrónico',
  password: 'Contraseña',
  role: 'Rol',
  is_active: 'Estado activo',
  name: 'Nombre',
  current_password: 'Contraseña actual',
  new_password: 'Nueva contraseña',
};
