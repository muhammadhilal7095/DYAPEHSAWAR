import { config } from '../config.js';
import { prisma } from '../db.js';
import { decrypt } from './crypto.js';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  ignoreTls: boolean;
  user: string;
  pass: string;
  from: string;
  source: 'SETTINGS' | 'ENV' | 'NONE';
}

/** Stored under SystemSetting key "smtp" (password AES-encrypted). Never part of the general/public settings. */
export const SMTP_KEY = 'smtp';

let cache: { at: number; value: SmtpConfig } | null = null;
export const invalidateSmtp = () => (cache = null);

/** Active SMTP configuration: values saved in System Settings take precedence over SMTP_* environment variables. */
export async function getSmtp(): Promise<SmtpConfig> {
  if (cache && Date.now() - cache.at < 5000) return cache.value;
  const row = await prisma.systemSetting.findUnique({ where: { key: SMTP_KEY } });
  const v = (row?.value ?? {}) as any;
  let value: SmtpConfig;
  if (v.host) {
    value = {
      host: v.host, port: Number(v.port) || 587, secure: !!v.secure, ignoreTls: !!v.ignoreTls, user: v.user ?? '',
      pass: v.passEnc ? decrypt(v.passEnc) : '', from: v.from || config.smtp.from, source: 'SETTINGS',
    };
  } else if (config.smtp.host) {
    value = { ...config.smtp, source: 'ENV' };
  } else {
    value = { host: '', port: 587, secure: false, ignoreTls: false, user: '', pass: '', from: config.smtp.from, source: 'NONE' };
  }
  cache = { at: Date.now(), value };
  return value;
}
