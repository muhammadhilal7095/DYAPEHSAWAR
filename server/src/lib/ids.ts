import type { Tx } from '../db.js';

/**
 * Generates sequential, human-readable unique identifiers inside the caller's transaction,
 * e.g. DAAMR-2026-00042. The counter row is incremented atomically so IDs are never reused.
 */
export async function nextId(tx: Tx, prefix: string, opts: { yearly?: boolean; pad?: number } = {}) {
  const { yearly = true, pad = 5 } = opts;
  const year = new Date().getUTCFullYear();
  const key = yearly ? `${prefix}-${year}` : prefix;
  const row = await tx.counter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${key}-${String(row.value).padStart(pad, '0')}`;
}

export const ID_PREFIX = {
  daamrRequest: 'DAAMR',
  activityReport: 'ARPT',
  hostelBooking: 'YHB',
  jmReport: 'DAAMR-JM',
  jmAsset: 'JMA',
  jmIssue: 'JMI',
  jmRisk: 'JMR',
  course: 'CRS',
};
