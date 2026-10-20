import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const forbidden = (msg = 'You do not have permission to perform this action.') => new HttpError(403, msg);
export const notFound = (msg = 'Record not found.') => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw new HttpError(422, 'Please correct the highlighted fields.', { fields });
  }
  return r.data;
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(422).json({ error: 'Validation failed', details: err.flatten() });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is larger than the permitted upload size.' });
  }
  if (err?.code === 'P2002') {
    return res.status(409).json({ error: 'A record with the same unique value already exists.' });
  }
  if (err?.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found.' });
  }
  if (err?.code === 'P2034') {
    return res.status(409).json({ error: 'The record was changed by another user at the same time. Please retry.' });
  }
  console.error(err);
  res.status(500).json({ error: 'An unexpected error occurred.' });
}

// ── common zod helpers ──
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
/** 'YYYY-MM-DD' → Date at UTC midnight. */
export const zDate = z
  .string()
  .regex(dateRe, 'Enter a valid date')
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !isNaN(d.getTime()), 'Enter a valid date');
export const zOptDate = z
  .union([zDate, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
export const zStr = (max = 500) => z.string().trim().min(1, 'This field is required').max(max);
export const zOptStr = (max = 5000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
export const zNonNegInt = z.coerce.number({ invalid_type_error: 'Enter a number' }).int('Must be a whole number').min(0, 'Cannot be negative');
export const zMoney = z.coerce.number({ invalid_type_error: 'Enter an amount' }).min(0, 'Cannot be negative').transform((n) => Math.round(n * 100) / 100);
export const zPercent = z.coerce.number().min(0, 'Minimum 0').max(100, 'Maximum 100');
export const zOptPercent = z
  .union([zPercent, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined || v === null ? null : Number(v)));
export const zOptInt = z
  .union([z.coerce.number().int(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined || v === null ? null : Number(v)));
export const zUrl = z
  .string()
  .trim()
  .url('Enter a valid URL (https://…)')
  .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) links are allowed');

export function pageParams(q: any) {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function dateRangeFilter(from?: any, to?: any) {
  const f: any = {};
  if (from && dateRe.test(String(from))) f.gte = new Date(`${from}T00:00:00.000Z`);
  if (to && dateRe.test(String(to))) f.lte = new Date(`${to}T23:59:59.999Z`);
  return Object.keys(f).length ? f : undefined;
}

export const toISODate = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
