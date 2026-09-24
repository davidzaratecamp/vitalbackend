// Catálogo de "Listado Casos Postventa Vital 2026.xlsx" (compartido por el
// usuario, 2026-09-24) — 13 tipos de caso, cada uno con su responsable
// "de origen" (informativo: quién probablemente lo resuelva) — la
// escalación real a BackOffice sigue siendo una acción manual del agente,
// no algo automático por tipo. (El rol "Customer" del Excel se integró
// dentro de "agente" el mismo día — "el customer es el mismo agente" — así
// que `responsable: 'agente'` es el mismo grupo que antes decía 'customer'.)

export const TIPO_CASO_POSTVENTA = [
  {
    valor: 'validacion_cobertura',
    nombre: 'Validación de Cobertura (doctores y medicamentos)',
    responsable: 'agente',
    descripcion: 'Cliente solicita ayuda para validar si tiene cobertura con doctores específicos y/o medicamentos.',
  },
  {
    valor: 'tarjetas_fisicas',
    nombre: 'Solicitud de Tarjetas Físicas',
    responsable: 'agente',
    descripcion: 'Cliente solicita ayuda para que le envíen sus tarjetas físicas a casa.',
  },
  {
    valor: 'gestion_pagos',
    nombre: 'Gestión de Pagos',
    responsable: 'agente',
    descripcion: 'Cliente presenta novedades con su método de pago (error método de pago / actualización método de pago).',
  },
  {
    valor: 'creacion_cuenta',
    nombre: 'Creación Cuenta Cliente',
    responsable: 'agente',
    descripcion: 'Cliente solicita ayuda para la creación de su cuenta cliente desde la página o APP.',
  },
  {
    valor: 'asignacion_citas',
    nombre: 'Asignación de Citas',
    responsable: 'agente',
    descripcion: 'Cliente solicita ayuda para la asignación de una cita médica.',
  },
  {
    valor: 'asignacion_doctor',
    nombre: 'Asignación de Doctor Primario / Especialista',
    responsable: 'agente',
    descripcion: 'Cliente solicita ayuda para la asignación de un doctor primario o especialista.',
  },
  {
    valor: 'aclaracion_factura',
    nombre: 'Aclaración Factura',
    responsable: 'agente',
    descripcion: 'Cliente solicita ayuda para la aclaración de la factura.',
  },
  {
    valor: 'cambio_vida',
    nombre: 'Cambio de Vida',
    responsable: 'backoffice',
    descripcion: 'Cliente ha actualizado su información en la póliza (dirección de residencia / email / teléfono / income / enrolados en póliza).',
  },
  {
    valor: 'solicitud_cancelacion',
    nombre: 'Solicitud de Cancelación',
    responsable: 'backoffice',
    descripcion: 'Cliente solicita cancelación de la póliza (Medicaid / Medicare / Seguro por trabajo / No lo quiere - no lo usa / no da motivo).',
  },
  {
    valor: 'solicitud_apelacion',
    nombre: 'Solicitud de Apelación',
    responsable: 'backoffice',
    descripcion: 'Cliente reclama porque no se están cumpliendo las características que cubre la póliza de salud.',
  },
  {
    valor: 'cambio_agente_aor',
    nombre: 'Solicitud Cambio de Agente (AOR)',
    responsable: 'backoffice',
    descripcion: 'Cliente nos autoriza para realizar un cambio de agente externo a un agente propio.',
  },
  {
    valor: 'cliente_no_aparece_broker',
    nombre: 'Gestión Cliente no Aparece en Brocker',
    responsable: 'backoffice',
    descripcion: 'Cliente no aparece en el portal de Brocker.',
  },
  {
    valor: 'autorizacion_poliza',
    nombre: 'Gestión de Autorización Póliza',
    responsable: 'backoffice',
    descripcion: 'Se llama al cliente para solicitar código donde nos autoriza a procesarle su póliza de salud.',
  },
];

export const TIPO_CASO_POSTVENTA_VALORES = TIPO_CASO_POSTVENTA.map((t) => t.valor);

export const TIPO_CASO_POSTVENTA_LABEL = Object.fromEntries(TIPO_CASO_POSTVENTA.map((t) => [t.valor, t.nombre]));

// Reclamación → naranja, Cancelación → rojo, Gestión habitual → verde
// (colores pedidos explícitamente por el usuario).
export const TIPO_GESTION_POSTVENTA = ['reclamacion', 'cancelacion', 'gestion_habitual'];

export const TIPO_GESTION_POSTVENTA_LABEL = {
  reclamacion: 'Reclamación',
  cancelacion: 'Cancelación',
  gestion_habitual: 'Gestión habitual',
};

export const ESTADO_CASO_POSTVENTA = ['nuevo', 'seguimiento', 'cerrado', 'escalado_backoffice'];

export const ESTADO_CASO_POSTVENTA_LABEL = {
  nuevo: 'Nuevo',
  seguimiento: 'Seguimiento',
  cerrado: 'Cerrado',
  escalado_backoffice: 'Escalado a BackOffice',
};
