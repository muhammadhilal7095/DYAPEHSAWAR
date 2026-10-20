import nodemailer, { type Transporter } from 'nodemailer';
import { getSmtp } from './smtpSettings.js';
import { prisma } from '../db.js';

let transporter: Transporter | null = null;
let transporterKey = '';

export async function smtpConfigured() {
  return (await getSmtp()).source !== 'NONE';
}

async function getTransporter(): Promise<{ t: Transporter; from: string } | null> {
  const c = await getSmtp();
  if (c.source === 'NONE') return null;
  const key = JSON.stringify(c);
  if (!transporter || key !== transporterKey) {
    transporter = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      ignoreTLS: c.ignoreTls,
      auth: c.user ? { user: c.user, pass: c.pass } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    transporterKey = key;
  }
  return { t: transporter, from: c.from };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function toHtml(text: string) {
  const linked = escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${linked.replace(/\n/g, '<br>')}</div>`;
}

/**
 * Attempts delivery of one email log row. The row is only marked SENT when the SMTP server
 * accepted the recipient; otherwise it is marked FAILED with the reason.
 */
async function deliver(id: string) {
  const row = await prisma.emailLog.findUnique({ where: { id } });
  if (!row || row.status !== 'PENDING') return;
  // claim the row so concurrent workers never double-send
  const claimed = await prisma.emailLog.updateMany({
    where: { id, status: 'PENDING', attempts: row.attempts },
    data: { attempts: row.attempts + 1, lastAttemptAt: new Date() },
  });
  if (claimed.count !== 1) return;

  const tr = await getTransporter();
  if (!tr) {
    await prisma.emailLog.update({ where: { id }, data: { status: 'FAILED', error: 'SMTP is not configured on the server.' } });
    return;
  }
  try {
    const info = await tr.t.sendMail({
      from: tr.from,
      to: row.toEmail,
      subject: row.subject,
      text: row.body,
      html: toHtml(row.body),
    });
    const accepted = (info.accepted ?? []).map((a: any) => (typeof a === 'string' ? a : a.address).toLowerCase());
    if (accepted.includes(row.toEmail.toLowerCase())) {
      await prisma.emailLog.update({
        where: { id },
        data: { status: 'SENT', sentAt: new Date(), messageId: info.messageId ?? null, error: null },
      });
    } else {
      await prisma.emailLog.update({
        where: { id },
        data: { status: 'FAILED', error: `Recipient not accepted by mail server. ${JSON.stringify(info.rejected ?? [])}`.slice(0, 1000) },
      });
    }
  } catch (e: any) {
    await prisma.emailLog.update({ where: { id }, data: { status: 'FAILED', error: String(e?.message ?? e).slice(0, 1000) } });
  }
}

let flushing: Promise<void> | null = null;

/** Sends every PENDING email. Safe to call concurrently. */
export async function flushEmails() {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      for (;;) {
        const batch = await prisma.emailLog.findMany({ where: { status: 'PENDING' }, take: 20, orderBy: { createdAt: 'asc' } });
        if (!batch.length) break;
        for (const r of batch) await deliver(r.id);
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

let timer: NodeJS.Timeout | null = null;
export function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushEmails().catch((e) => console.error('email flush failed', e));
  }, 25);
}

export { toHtml };
