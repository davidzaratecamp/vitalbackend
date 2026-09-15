import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';

const ASEGURADORAS = [
  'Aetna',
  'Ambetter',
  'Anthem',
  'Blue Cross',
  'Blue Shield',
  'Cigna',
  'Molina',
  'Oscar',
  'United',
  'Wellpoint',
  'Horizon',
  'Kaiser',
];

/** @param {import('knex').Knex} knex */
export async function seed(knex) {
  // Catálogo de aseguradoras (idempotente).
  for (const nombre of ASEGURADORAS) {
    await knex('aseguradoras').insert({ nombre }).onConflict('nombre').ignore();
  }

  const users = [
    {
      name: env.seedAdmin.name,
      email: env.seedAdmin.email,
      password: env.seedAdmin.password,
      role: 'admin',
      avatar_color: '#6366f1',
    },
    {
      // Mismas 3 cuentas semilla, misma clave (viene de SEED_ADMIN_PASSWORD
      // en .env) — nunca escrita directo acá, este archivo va a un repo
      // público.
      name: 'Agente de prueba',
      email: 'agente@vital.local',
      password: env.seedAdmin.password,
      role: 'agente',
      avatar_color: '#0ea5e9',
    },
    {
      name: 'BackOffice de prueba',
      email: 'backoffice@vital.local',
      password: env.seedAdmin.password,
      role: 'backoffice',
      avatar_color: '#10b981',
    },
  ];

  for (const u of users) {
    const exists = await knex('usuarios_sistema').where({ email: u.email }).first('id');
    if (exists) continue;
    const password_hash = await bcrypt.hash(u.password, 10);
    await knex('usuarios_sistema').insert({
      name: u.name,
      email: u.email,
      password_hash,
      role: u.role,
      avatar_color: u.avatar_color,
      is_active: true,
    });
    console.log(`Usuario creado: ${u.email} (${u.role}) — contraseña: ${u.password}`);
  }
}
