import type { Request } from 'express';
import { prisma, type Db } from '../db.js';

export interface AuditInput {
  action: string;
  module?: string;
  entityType: string;
  entityId?: string | null;
  entityRef?: string | null;
  before?: unknown;
  after?: unknown;
}

function clean(v: unknown) {
  if (v === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(v, (k, val) => (['passwordHash', 'cnicEnc', 'tokenHash'].includes(k) ? undefined : val)),
  );
}

/** Returns only the keys whose values changed between before and after. */
export function diff(before: Record<string, any>, after: Record<string, any>) {
  const b: Record<string, any> = {};
  const a: Record<string, any> = {};
  for (const k of Object.keys(after)) {
    const bv = before?.[k] instanceof Date ? before[k].toISOString() : before?.[k];
    const av = after[k] instanceof Date ? after[k].toISOString() : after[k];
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      b[k] = bv;
      a[k] = av;
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}

export async function audit(db: Db, req: Request | null, input: AuditInput, actorOverride?: { id: string | null; name: string }) {
  const actor = actorOverride ?? (req?.user ? { id: req.user.id, name: req.user.name } : { id: null, name: 'System' });
  await db.auditLog.create({
    data: {
      actorId: actor.id,
      actorName: actor.name,
      action: input.action,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      entityRef: input.entityRef ?? null,
      before: clean(input.before) as any,
      after: clean(input.after) as any,
      ip: req?.ip ?? null,
      userAgent: req ? String(req.headers['user-agent'] ?? '').slice(0, 300) : null,
    },
  });
}

export const auditNow = (req: Request | null, input: AuditInput) => audit(prisma, req, input);
