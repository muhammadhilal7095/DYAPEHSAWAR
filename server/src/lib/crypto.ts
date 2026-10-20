import crypto from 'node:crypto';
import { config } from '../config.js';

const key = crypto.createHash('sha256').update(config.encryptionKey).digest();

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decrypt(payload: string): string {
  try {
    const buf = Buffer.from(payload, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return '[unreadable]';
  }
}

/** 12345-1234567-1 → 12345-*******-1 ; passport AB1234567 → AB*****67 */
export function maskIdentity(v: string): string {
  const s = v.trim();
  const cnic = s.match(/^(\d{5})-?(\d{7})-?(\d)$/);
  if (cnic) return `${cnic[1]}-*******-${cnic[3]}`;
  if (s.length <= 4) return '*'.repeat(s.length);
  return s.slice(0, 2) + '*'.repeat(Math.max(3, s.length - 4)) + s.slice(-2);
}
