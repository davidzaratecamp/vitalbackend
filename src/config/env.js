import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

// Carga backend/.env sin importar desde qué directorio se ejecute el proceso.
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(backendRoot, '.env') });

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4100),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5180')
    .split(',')
    .map((s) => s.trim()),

  db: {
    host: required('DB_HOST', '127.0.0.1'),
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER', 'root'),
    password: process.env.DB_PASSWORD || '',
    database: required('DB_NAME', 'vital_db'),
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  // Cifra el número completo de tarjeta antes de guardarlo (ver
  // src/utils/cardCrypto.js) — nunca en texto plano, nunca en el repo.
  cardEncryptionKey: required('CARD_ENCRYPTION_KEY'),

  seedAdmin: {
    name: process.env.SEED_ADMIN_NAME || 'Administrador Vital',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@vital.local',
    // Sin default real — si no se define en .env, obliga a elegir una
    // propia en vez de heredar una clave de ejemplo (repo público).
    password: process.env.SEED_ADMIN_PASSWORD || 'CAMBIA-ESTA-CLAVE',
  },

  uploads: {
    // Carpeta privada — nunca se monta como estático público.
    dir: path.join(backendRoot, 'uploads'),
    maxFiles: 5,
    maxSizeBytes: 5 * 1024 * 1024, // 5MB
    allowedMime: ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'],
  },
};

export const isDev = env.nodeEnv !== 'production';
