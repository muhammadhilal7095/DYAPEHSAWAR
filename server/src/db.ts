import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/** Runs fn in a serializable transaction (prevents double-booking / double-approval races). */
export function serializable<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 30_000,
  });
}

/** Case-insensitive "contains" filter that works on SQLite (LIKE is case-insensitive) and PostgreSQL. */
const isPg = (process.env.DATABASE_URL ?? '').startsWith('postgres');
export function icontains(q: string) {
  return isPg ? { contains: q, mode: 'insensitive' as const } : { contains: q };
}
