// Genera clientes de demostración realistas, de punta a punta, usando la API
// real (no inserta directo en la DB) — así queda validado exactamente igual
// que si lo llenara un agente. Pensado para tener datos con qué hacer una
// demo: mezcla de estados (borrador, pendiente, aprobado, rechazado) y de
// varios agentes distintos.
//
// Uso: node scripts/seed-demo.js   (con el backend real corriendo en :4100)
// Requiere que SEED_ADMIN_PASSWORD (.env) ya sea la clave del admin real, y
// usa esa misma clave para las cuentas demo que crea. Nunca la escribas acá
// directo — este archivo se sube a un repo público.

const BASE = process.env.VITAL_API_BASE || 'http://localhost:4100/api';
const ADMIN_PASS = process.env.SEED_DEMO_PASSWORD;
if (!ADMIN_PASS) {
  console.error('✗ Falta SEED_DEMO_PASSWORD. Corre así: SEED_DEMO_PASSWORD="tu-clave" node scripts/seed-demo.js');
  process.exit(1);
}

/* ─────────────────────── utilidades ─────────────────────── */

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randDate(minAge, maxAge) {
  const hoy = new Date();
  const age = randInt(minAge, maxAge);
  const y = hoy.getFullYear() - age;
  const m = String(randInt(1, 12)).padStart(2, '0');
  const d = String(randInt(1, 28)).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function ssn() {
  return String(randInt(100000000, 999999999));
}
function phone() {
  return `1${randInt(200, 999)}${randInt(200, 999)}${randInt(1000, 9999)}`;
}
function slug(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
}

async function api(path, { method = 'GET', token, body, isForm } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isForm && body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function login(email, password) {
  const { token } = await api('/auth/login', { method: 'POST', body: { email, password } });
  return token;
}

// PNG 1x1 válido — evidencia de prueba liviana.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

/* ─────────────────────── datos de catálogo ─────────────────────── */

const NOMBRES_M = ['Carlos', 'Jose', 'Luis', 'Miguel', 'Juan', 'Jorge', 'Roberto', 'Pedro', 'Rafael', 'Fernando', 'Ricardo', 'Angel', 'Manuel', 'Oscar', 'David'];
const NOMBRES_F = ['Maria', 'Ana', 'Rosa', 'Carmen', 'Laura', 'Patricia', 'Sandra', 'Gloria', 'Yolanda', 'Diana', 'Claudia', 'Veronica', 'Daviana', 'Karla', 'Mireya'];
const APELLIDOS = ['Garcia', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Perez', 'Sanchez', 'Ramirez', 'Torres', 'Flores', 'Rivera', 'Gomez', 'Diaz', 'Reyes', 'Morales', 'Cruz', 'Ortiz', 'Guerrero', 'Zarate'];

const CIUDADES = [
  { ciudad: 'Miami', condado: 'Miami-Dade', estado_us: 'FL', cp: '33101' },
  { ciudad: 'Orlando', condado: 'Orange', estado_us: 'FL', cp: '32801' },
  { ciudad: 'Houston', condado: 'Harris', estado_us: 'TX', cp: '77002' },
  { ciudad: 'Dallas', condado: 'Dallas', estado_us: 'TX', cp: '75201' },
  { ciudad: 'Los Angeles', condado: 'Los Angeles', estado_us: 'CA', cp: '90001' },
  { ciudad: 'Phoenix', condado: 'Maricopa', estado_us: 'AZ', cp: '85001' },
  { ciudad: 'Atlanta', condado: 'Fulton', estado_us: 'GA', cp: '30301' },
  { ciudad: 'Chicago', condado: 'Cook', estado_us: 'IL', cp: '60601' },
];

const ESTATUS_MIGRATORIO = ['RESIDENTE', 'CIUDADANO', 'PERMISO DE TRABAJO', 'PASAPORTE', 'VISA DE TRABAJO', 'ASILO/REFUGIADO', 'TPS', 'GREEN CARD'];
const ORIGEN_VENTA = ['lead', 'referido', 'base'];
const PARENTESCO_DEP = ['Hijo', 'Hijastro', 'Padre', 'Madre', 'Otro'];
const TIPO_DECLARACION = ['W2', '1099'];
const TIPO_METAL = ['Bronce', 'Plata', 'Oro', 'Platino'];
const TIPO_RED = ['HMO', 'PPO', 'EPO'];
const ESTADO_PRIMA = ['Pendiente de tarjeta', 'Debito OK', 'Debito automatico', 'Debito rechazado', 'Sin cargo de prima'];
const NOMBRES_PLAN = ['Essential Care', 'Silver Complete', 'Gold Plus', 'Bronze Basic', 'Total Health', 'Family Shield', 'Vital Care', 'Premier Select'];

function persona() {
  const sexo = rand(['Masculino', 'Femenino']);
  const nombres = sexo === 'Masculino' ? rand(NOMBRES_M) : rand(NOMBRES_F);
  const apellidos = `${rand(APELLIDOS)} ${rand(APELLIDOS)}`;
  return { nombres, apellidos, sexo };
}

/* ─────────────────────── construcción de un cliente ─────────────────────── */

async function crearClienteCompleto(token, aseguradoras, i) {
  const p = persona();
  const ciudad = rand(CIUDADES);
  const email = `${slug(p.nombres)}.${slug(p.apellidos)}${i}@demo.vital.local`;

  const cliente = await api('/clientes', {
    method: 'POST',
    token,
    body: {
      nombres: p.nombres,
      apellidos: p.apellidos,
      sexo: p.sexo,
      fecha_nacimiento: randDate(24, 64),
      social: ssn(),
      estatus_migratorio: rand(ESTATUS_MIGRATORIO),
      direccion: `${randInt(100, 9999)} SW ${randInt(1, 200)}th St`,
      estado_us: ciudad.estado_us,
      condado: ciudad.condado,
      ciudad: ciudad.ciudad,
      codigo_postal: ciudad.cp,
      correo_electronico: email,
      phone_1: phone(),
      origen_venta: rand(ORIGEN_VENTA),
      pregunta_seguridad: '¿Color favorito?',
      respuesta_seguridad: rand(['azul', 'rojo', 'verde', 'negro']),
    },
  });
  const id = cliente.id;

  // Cónyuge (~40% de los casos)
  if (Math.random() < 0.4) {
    const c = persona();
    await api(`/clientes/${id}/conyuge`, {
      method: 'PUT',
      token,
      body: {
        nombres: c.nombres,
        apellidos: p.apellidos,
        sexo: c.sexo,
        fecha_nacimiento: randDate(24, 62),
        social: ssn(),
        estatus_migratorio: rand(ESTATUS_MIGRATORIO),
      },
    });
  } else {
    await api(`/clientes/${id}/conyuge`, { method: 'PUT', token, body: { no_tiene: true } });
  }

  // Dependientes (0 a 3)
  const nDep = randInt(0, 3);
  const dependientes = [];
  for (let d = 0; d < nDep; d++) {
    const dep = persona();
    const r = await api(`/clientes/${id}/dependientes`, {
      method: 'POST',
      token,
      body: {
        parentesco: rand(PARENTESCO_DEP),
        nombres: dep.nombres,
        apellidos: p.apellidos,
        sexo: dep.sexo,
        fecha_nacimiento: randDate(1, 22),
        social: ssn(),
        estatus_migratorio: rand(ESTATUS_MIGRATORIO),
      },
    });
    dependientes.push(r);
  }

  // Ingresos del titular
  await api(`/clientes/${id}/ingresos`, {
    method: 'PUT',
    token,
    body: { tiene_ingresos: true, tipo_declaracion: rand(TIPO_DECLARACION), ingresos_semanales: randInt(300, 1200) },
  });
  // Ingresos de dependientes mayores de edad (simple: a todos les ponemos 0/opcional)
  for (const dep of dependientes) {
    if (Math.random() < 0.3) {
      await api(`/clientes/${id}/dependientes/${dep.id}/ingresos`, {
        method: 'PUT',
        token,
        body: { tiene_ingresos: true, tipo_declaracion: rand(TIPO_DECLARACION), ingresos_semanales: randInt(100, 400) },
      });
    }
  }

  // Plan de salud
  const valorPrima = randInt(80, 650);
  await api(`/clientes/${id}/plan-salud`, {
    method: 'PUT',
    token,
    body: {
      aseguradora_id: rand(aseguradoras).id,
      nombre_plan: `${rand(NOMBRES_PLAN)} ${randInt(100, 999)}`,
      tipo_metal: rand(TIPO_METAL),
      tipo_red: rand(TIPO_RED),
      deducible: randInt(0, 5000),
      gasto_max_bolsillo: randInt(1000, 9000),
      valor_prima: valorPrima,
    },
  });

  // Pago
  await api(`/clientes/${id}/pago`, {
    method: 'PUT',
    token,
    body: {
      metodo: 'tarjeta',
      ultimos_4_digitos: String(randInt(1000, 9999)),
      nombre_titular_tarjeta: `${p.nombres} ${p.apellidos}`,
      fecha_expiracion_mes: randInt(1, 12),
      fecha_expiracion_ano: randInt(new Date().getFullYear() + 1, 2031),
    },
  });

  // Evidencia (imagen de prueba)
  const form = new FormData();
  form.append('archivos', new Blob([PNG_1PX], { type: 'image/png' }), 'consumo-demo.png');
  form.append('descripcion', 'Comprobante de residencia (demo)');
  await api(`/evidencias/cliente/${id}`, { method: 'POST', token, body: form, isForm: true });

  return { id, nombre: `${p.nombres} ${p.apellidos}` };
}

/* ─────────────────────── orquestación ─────────────────────── */

async function main() {
  console.log('→ Iniciando sesión...');
  const adminToken = await login('admin@vital.local', ADMIN_PASS);

  // Agentes demo adicionales (además del que ya existe del seed inicial)
  const agentesDemo = [
    { name: 'Carlos Fuentes', email: 'cfuentes@vital.local' },
    { name: 'Daviana Mora', email: 'dmora@vital.local' },
  ];
  const backofficeDemo = { name: 'Luis Peña', email: 'lpena@vital.local' };

  const usuarios = await api('/usuarios-sistema', { token: adminToken });
  for (const a of agentesDemo) {
    if (!usuarios.some((u) => u.email === a.email)) {
      await api('/usuarios-sistema', {
        method: 'POST',
        token: adminToken,
        body: { name: a.name, email: a.email, password: ADMIN_PASS, role: 'agente' },
      });
      console.log(`  + agente creado: ${a.email}`);
    }
  }
  if (!usuarios.some((u) => u.email === backofficeDemo.email)) {
    await api('/usuarios-sistema', {
      method: 'POST',
      token: adminToken,
      body: { name: backofficeDemo.name, email: backofficeDemo.email, password: ADMIN_PASS, role: 'backoffice' },
    });
    console.log(`  + backoffice creado: ${backofficeDemo.email}`);
  }

  const aseguradoras = await api('/catalogos/aseguradoras', { token: adminToken });

  const agentesLogin = [
    { email: 'agente@vital.local', password: ADMIN_PASS },
    ...agentesDemo.map((a) => ({ email: a.email, password: ADMIN_PASS })),
  ];
  const backofficeLogin = [
    { email: 'backoffice@vital.local', password: ADMIN_PASS },
    { email: backofficeDemo.email, password: ADMIN_PASS },
  ];

  // Un solo login por cuenta — el rate-limit de /auth/login es de 20
  // intentos / 15min, y con decenas de clientes de demo no alcanza si se
  // vuelve a loguear en cada uno.
  const agenteTokens = [];
  for (const cred of agentesLogin) agenteTokens.push({ ...cred, token: await login(cred.email, cred.password) });
  const backofficeTokens = [];
  for (const cred of backofficeLogin) backofficeTokens.push({ ...cred, token: await login(cred.email, cred.password) });

  const TOTAL = 24;
  const creados = [];

  console.log(`→ Creando ${TOTAL} clientes de demo (Titular → Cónyuge → Dependientes → Ingresos → Plan → Pago → Evidencia)...`);
  for (let i = 0; i < TOTAL; i++) {
    const agente = rand(agenteTokens);
    const c = await crearClienteCompleto(agente.token, aseguradoras, i);
    creados.push({ ...c, agenteToken: agente.token });
    process.stdout.write(`  ${i + 1}/${TOTAL} · ${c.nombre} (${agente.email})\n`);
  }

  // Repartimos estados: 20% se quedan en borrador (no finalizados).
  // El resto se finaliza; de esos, 55% aprobado, 25% rechazado, 20% se queda pendiente.
  console.log('→ Repartiendo estados...');
  let nBorrador = 0, nPendiente = 0, nAprobado = 0, nRechazado = 0;

  for (const c of creados) {
    if (Math.random() < 0.2) {
      nBorrador++;
      continue; // se queda en borrador
    }
    await api(`/clientes/${c.id}/finalizar`, { method: 'POST', token: c.agenteToken });

    const r = Math.random();
    if (r < 0.2) {
      nPendiente++;
      continue; // se queda pendiente_backoffice
    }

    const boToken = rand(backofficeTokens).token;

    if (r < 0.45) {
      // rechazado
      await api(`/backoffice/clientes/${c.id}/rechazar`, {
        method: 'PUT',
        token: boToken,
        body: { motivo: rand(['El teléfono no es válido.', 'Falta corregir el estatus migratorio.', 'La dirección no coincide con el condado.', 'El ingreso reportado parece incorrecto, verificar con el cliente.']) },
      });
      nRechazado++;
    } else {
      // aprobado
      await api(`/backoffice/clientes/${c.id}/completar`, {
        method: 'PUT',
        token: boToken,
        body: {
          aseguradora_id: rand(aseguradoras).id,
          nombre_plan: `${rand(NOMBRES_PLAN)} ${randInt(100, 999)}`,
          deducible: randInt(0, 5000),
          gasto_max_bolsillo: randInt(1000, 9000),
          npn: String(randInt(1000000, 9999999)),
          estado_prima: rand(ESTADO_PRIMA),
        },
      });
      nAprobado++;
    }
  }

  console.log('\n✓ Listo.');
  console.log(`  Total: ${creados.length}`);
  console.log(`  Borrador: ${nBorrador} · Pendiente BackOffice: ${nPendiente} · Aprobado: ${nAprobado} · Rechazado: ${nRechazado}`);
  console.log('\n  Agentes demo: cfuentes@vital.local, dmora@vital.local (misma clave que pasaste en SEED_DEMO_PASSWORD)');
  console.log('  BackOffice demo: lpena@vital.local (misma clave)');
}

main().catch((err) => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});
