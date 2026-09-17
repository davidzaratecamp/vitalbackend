/**
 * Cifrado del número completo de tarjeta (informacion_pago.numero_tarjeta_cifrado).
 *
 * AES-256-GCM con IV aleatorio por registro. La llave sale de
 * CARD_ENCRYPTION_KEY (.env, nunca en el repo) — ver env.js.
 *
 * Importante: esta es una capa de cifrado de aplicación, no un cumplimiento
 * PCI-DSS completo (para eso hace falta gestión de llaves con HSM/KMS,
 * segmentación de red y auditorías). Se documentó ese riesgo al usuario
 * antes de construir esto; quedó como decisión suya.
 */
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const key = Buffer.from(env.cardEncryptionKey, 'base64');
  if (key.length !== 32) {
    throw new Error('CARD_ENCRYPTION_KEY debe decodificar a 32 bytes (AES-256) en base64');
  }
  return key;
}

/** @param {string} plainDigits - solo dígitos, sin espacios ni guiones. */
export function encryptCard(plainDigits) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainDigits, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv:authTag:ciphertext, todo en base64, unido con ":" para poder separarlo.
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** @param {string} stored - lo que devuelve encryptCard(). */
export function decryptCard(stored) {
  const [ivB64, authTagB64, ciphertextB64] = String(stored).split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Formato de tarjeta cifrada inválido');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/** Detecta la marca por el prefijo (BIN) — no valida que la tarjeta exista. */
export function detectarMarca(numero) {
  if (/^4/.test(numero)) return 'Visa';
  if (/^(5[1-5]|2(2[2-9]\d|[3-6]\d{2}|7[01]\d|720))/.test(numero)) return 'Mastercard';
  return 'Otra';
}
