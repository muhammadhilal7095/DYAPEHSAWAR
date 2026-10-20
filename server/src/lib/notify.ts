import { config } from '../config.js';
import { serializable, type Tx } from '../db.js';
import { scheduleFlush } from './mailer.js';
import { getSettings } from './settings.js';

export interface Recipient {
  id: string;
  email: string;
  name: string;
}

export interface NotifyInput {
  recipients: (Recipient | null | undefined)[];
  /** extra email-only addresses (e.g. requestee email that is not a user account) */
  extraEmails?: string[];
  event: string;
  module: string;
  entityRef: string;
  instanceId?: string | null;
  title: string;
  /** label/value pairs included in the email body */
  details: [string, string | null | undefined][];
  remarks?: string | null;
  link: string; // client path, e.g. /daamr/requests/abc
}

/** Creates in-app notifications and PENDING email log rows inside the caller's transaction. */
export async function notify(tx: Tx, input: NotifyInput) {
  const s = await getSettings();
  const url = `${config.appUrl}${input.link}`;
  const seen = new Set<string>();
  const lines = input.details.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${v}`);
  const body = (name: string) =>
    [
      `Dear ${name},`,
      '',
      input.title,
      '',
      ...lines,
      ...(input.remarks ? ['', `Remarks: ${input.remarks}`] : []),
      '',
      `Open the record (sign-in required): ${url}`,
      '',
      `— ${s.orgName}`,
      'This is an automated message. Please do not reply.',
    ].join('\n');

  for (const r of input.recipients) {
    if (!r) continue;
    await tx.notification.create({
      data: {
        userId: r.id,
        module: input.module,
        title: `${input.entityRef}: ${input.title}`,
        body: [...lines.slice(0, 3), input.remarks ? `Remarks: ${input.remarks}` : ''].filter(Boolean).join(' · '),
        link: input.link,
      },
    });
    const key = r.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    await tx.emailLog.create({
      data: {
        toEmail: r.email,
        subject: `[${input.entityRef}] ${input.title}`,
        body: body(r.name),
        event: input.event,
        module: input.module,
        entityRef: input.entityRef,
        instanceId: input.instanceId ?? null,
      },
    });
  }
  for (const e of input.extraEmails ?? []) {
    if (!e || seen.has(e.toLowerCase())) continue;
    seen.add(e.toLowerCase());
    await tx.emailLog.create({
      data: {
        toEmail: e,
        subject: `[${input.entityRef}] ${input.title}`,
        body: body('Sir/Madam'),
        event: input.event,
        module: input.module,
        entityRef: input.entityRef,
        instanceId: input.instanceId ?? null,
      },
    });
  }
}

/** Serializable transaction followed by dispatch of any emails it queued. */
export async function transact<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await serializable(fn);
  scheduleFlush();
  return result;
}
