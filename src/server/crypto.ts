import crypto from 'node:crypto';
import { config } from './config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.encryptionKey).digest();
}

export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(cipherPayload: string): string {
  const parts = cipherPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload');
  }
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');
  const key = deriveKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export function maskSecret(value: string): string {
  if (!value || value.length <= 6) return '••••••••';
  return `${value.slice(0, 3)}••••••••••••${value.slice(-3)}`;
}

export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashToken(token: string): string {
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(token)
    .digest('hex');
}
