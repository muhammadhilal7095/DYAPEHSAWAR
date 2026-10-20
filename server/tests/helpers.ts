import request from 'supertest';
import { SMTPServer } from 'smtp-server';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { flushEmails } from '../src/lib/mailer.js';

export const app = createApp();
export const PASSWORD = 'Password@123';

export type Client = ReturnType<typeof client>;

/** A logged-in API client with its own cookie jar. */
export function client() {
  const agent = request.agent(app);
  const h = (r: request.Test) => r.set('X-Requested-With', 'XMLHttpRequest');
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: any) => h(agent.post(url)).send(body ?? {}),
    put: (url: string, body?: any) => h(agent.put(url)).send(body ?? {}),
    patch: (url: string, body?: any) => h(agent.patch(url)).send(body ?? {}),
    del: (url: string) => h(agent.delete(url)),
    upload: (url: string, fields: Record<string, string>, files: { name: string; buf: Buffer }[]) => {
      let r = h(agent.post(url));
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      for (const f of files) r = r.attach('files', f.buf, f.name);
      return r;
    },
  };
}

export async function login(email: string) {
  const c = client();
  const r = await c.post('/api/auth/login', { email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return c;
}

/** 1×1 PNG */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

export const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export async function idOf(email: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
}
export async function districtId(name: string) {
  return (await prisma.district.findUniqueOrThrow({ where: { name } })).id;
}

/** Local SMTP sink: accepts everything except recipients containing "bounce". */
export function startSmtp(port = 2526) {
  const received: { to: string[]; subject: string }[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onRcptTo(address, _session, cb) {
      if (address.address.includes('bounce')) return cb(new Error('550 Mailbox unavailable'));
      cb();
    },
    onData(stream, session, cb) {
      let data = '';
      stream.on('data', (c) => (data += c));
      stream.on('end', () => {
        received.push({ to: session.envelope.rcptTo.map((r) => r.address), subject: /Subject: (.*)/.exec(data)?.[1] ?? '' });
        cb();
      });
    },
  });
  return new Promise<{ received: typeof received; close: () => Promise<void> }>((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ received, close: () => new Promise((r) => server.close(() => r())) }));
  });
}

export async function settleEmails() {
  await new Promise((r) => setTimeout(r, 60));
  await flushEmails();
}

export { prisma };
