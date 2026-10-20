import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { HttpError, forbidden } from './http.js';
import type { Permission } from './permissions.js';
import { getSettings } from './settings.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  designation: string | null;
  districtId: string | null;
  departmentId: string | null;
  roles: { id: string; key: string; name: string }[];
  permissions: Set<string>;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const SESSION_COOKIE = 'dya_sid';
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function createSession(userId: string, req: Request, res: Response) {
  const s = await getSettings();
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + s.sessionMaxHours * 3600_000);
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    },
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    expires: expiresAt,
    path: '/',
  });
}

export async function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function loadUser(userId: string, sessionId = ''): Promise<AuthUser | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!u || !u.isActive) return null;
  const perms = new Set<string>();
  for (const ur of u.roles) for (const p of (ur.role.permissions as string[]) ?? []) perms.add(p);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    designation: u.designation,
    districtId: u.districtId,
    departmentId: u.departmentId,
    roles: u.roles.map((r) => ({ id: r.role.id, key: r.role.key, name: r.role.name })),
    permissions: perms,
    sessionId,
  };
}

/** Attaches req.user when a valid, non-idle session cookie is present. Sliding idle expiration. */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
  if (!session) return next();
  const s = await getSettings();
  const now = Date.now();
  const idleMs = s.sessionIdleMinutes * 60_000;
  if (session.expiresAt.getTime() < now || now - session.lastSeenAt.getTime() > idleMs) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.setHeader('X-Session-Expired', '1');
    return next();
  }
  const user = await loadUser(session.userId, session.id);
  if (!user) return next();
  req.user = user;
  // throttle lastSeen writes to once a minute
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Your session has expired. Please sign in again.'));
  next();
}

export const can = (user: AuthUser | undefined, perm: Permission | string) => !!user?.permissions.has(perm);
export const canAny = (user: AuthUser | undefined, ...perms: (Permission | string)[]) => perms.some((p) => can(user, p));

/** Route guard — user must hold at least one of the listed permissions. */
export function requirePerm(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Your session has expired. Please sign in again.'));
    if (!canAny(req.user, ...perms)) return next(forbidden());
    next();
  };
}

/** CSRF mitigation: state-changing requests must carry a custom header (not settable cross-site without CORS). */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') return next(new HttpError(403, 'Invalid request origin.'));
  next();
}
