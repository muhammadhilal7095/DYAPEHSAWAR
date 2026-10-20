import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { createSession, destroySession, requireAuth, sha256 } from '../lib/auth.js';
import { HttpError, badRequest, parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { scheduleFlush } from '../lib/mailer.js';
import { getSettings, publicSettings } from '../lib/settings.js';

export const authRouter = Router();
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

const limiter = rateLimit({ windowMs: 15 * 60_000, limit: config.isTest ? 1000 : 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait and try again.' } });

export const passwordSchema = z
  .string()
  .min(10, 'At least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number');

export function meResponse(u: NonNullable<Express.Request['user']>) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    designation: u.designation,
    districtId: u.districtId,
    departmentId: u.departmentId,
    roles: u.roles,
    permissions: [...u.permissions].sort(),
  };
}

authRouter.post('/login', limiter, async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') }), req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const generic = new HttpError(401, 'Invalid email or password.');
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH); // equalise timing with the real check
    throw generic;
  }
  if (!user.isActive) throw new HttpError(403, 'This account has been deactivated. Contact the administrator.');
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new HttpError(423, 'Account temporarily locked after repeated failed sign-in attempts. Try again in 15 minutes.');
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: failed >= 5 ? 0 : failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60_000) : null },
    });
    await audit(prisma, req, { action: failed >= 5 ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', entityType: 'User', entityId: user.id, entityRef: user.email }, { id: user.id, name: user.name });
    throw generic;
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await createSession(user.id, req, res);
  await audit(prisma, req, { action: 'LOGIN', entityType: 'User', entityId: user.id, entityRef: user.email }, { id: user.id, name: user.name });
  res.json({ ok: true, mustChangePassword: user.mustChangePassword });
});

authRouter.post('/logout', async (req, res) => {
  if (req.user) await audit(prisma, req, { action: 'LOGOUT', entityType: 'User', entityId: req.user.id, entityRef: req.user.email });
  await destroySession(req, res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { mustChangePassword: true, district: { select: { id: true, name: true } } } });
  res.json({ user: { ...meResponse(req.user!), mustChangePassword: u.mustChangePassword, district: u.district }, settings: publicSettings(await getSettings()) });
});

authRouter.post('/forgot-password', limiter, async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email') }), req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.isActive) {
    const token = crypto.randomBytes(32).toString('base64url');
    const s = await getSettings();
    await prisma.$transaction(async (tx) => {
      await tx.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60_000) } });
      await tx.emailLog.create({
        data: {
          toEmail: user.email,
          subject: 'Password reset request',
          event: 'PASSWORD_RESET',
          body: [
            `Dear ${user.name},`,
            '',
            'A password reset was requested for your account. Use the link below within 60 minutes to set a new password:',
            '',
            `${config.appUrl}/reset-password?token=${token}`,
            '',
            'If you did not request this, you can ignore this email.',
            '',
            `— ${s.orgName}`,
          ].join('\n'),
        },
      });
      await audit(tx, req, { action: 'PASSWORD_RESET_REQUESTED', entityType: 'User', entityId: user.id, entityRef: user.email }, { id: user.id, name: user.name });
    });
    scheduleFlush();
  }
  // Same response whether or not the account exists (prevents account enumeration)
  res.json({ ok: true, message: 'If an active account exists for that email, a reset link has been sent.' });
});

authRouter.post('/reset-password', limiter, async (req, res) => {
  const { token, password } = parse(z.object({ token: z.string().min(10), password: passwordSchema }), req.body);
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw badRequest('This reset link is invalid or has expired. Please request a new one.');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash: await bcrypt.hash(password, 12), failedLogins: 0, lockedUntil: null, mustChangePassword: false } });
    await tx.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId: row.userId } });
    await audit(tx, req, { action: 'PASSWORD_RESET', entityType: 'User', entityId: row.userId, entityRef: row.user.email }, { id: row.userId, name: row.user.name });
  });
  res.json({ ok: true });
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string().min(1, 'Required'), newPassword: passwordSchema }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect.', { fields: { currentPassword: 'Incorrect password' } });
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false } });
    await tx.session.deleteMany({ where: { userId: user.id, id: { not: req.user!.sessionId } } });
    await audit(tx, req, { action: 'PASSWORD_CHANGED', entityType: 'User', entityId: user.id, entityRef: user.email });
  });
  res.json({ ok: true });
});
