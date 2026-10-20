import { Router } from 'express';
import { backupDir, listBackups, runBackup } from '../lib/backup.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma, icontains } from '../db.js';
import { requireAuth, requirePerm } from '../lib/auth.js';
import { audit, diff } from '../lib/audit.js';
import { badRequest, conflict, notFound, pageParams, parse, zOptStr, zStr, dateRangeFilter } from '../lib/http.js';
import { ALL_PERMISSIONS, PERMISSIONS } from '../lib/permissions.js';
import { passwordSchema } from './auth.js';
import { DEFAULT_SETTINGS, getSettings, invalidateSettings, publicSettings } from '../lib/settings.js';
import { sendExport, fmtDateTime } from '../lib/export.js';
import { flushEmails, smtpConfigured } from '../lib/mailer.js';
import { getSmtp, invalidateSmtp, SMTP_KEY } from '../lib/smtpSettings.js';
import { encrypt } from '../lib/crypto.js';
import { config } from '../config.js';
import { MODULE_LABEL } from '../workflow/engine.js';

export const adminRouter = Router();

// ───────────── Users ─────────────
const userSelect = {
  id: true, name: true, email: true, designation: true, phone: true, isActive: true, lastLoginAt: true, createdAt: true,
  lockedUntil: true, mustChangePassword: true,
  district: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  roles: { select: { role: { select: { id: true, key: true, name: true } } } },
} as const;

adminRouter.get('/users', requirePerm('admin.users'), async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const q = String(req.query.q ?? '').trim();
  const where: any = {
    ...(q ? { OR: [{ name: icontains(q) }, { email: icontains(q) }, { designation: icontains(q) }] } : {}),
    ...(req.query.roleId ? { roles: { some: { roleId: String(req.query.roleId) } } } : {}),
    ...(req.query.districtId ? { districtId: String(req.query.districtId) } : {}),
    ...(req.query.active === 'true' ? { isActive: true } : req.query.active === 'false' ? { isActive: false } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, select: userSelect, orderBy: { name: 'asc' }, skip, take }),
    prisma.user.count({ where }),
  ]);
  res.json({ rows: rows.map((u) => ({ ...u, roles: u.roles.map((r) => r.role) })), total, page, pageSize });
});

/** Minimal directory for pickers (any signed-in user). */
adminRouter.get('/directory', requireAuth, async (req, res) => {
  const users = await prisma.user.findMany({
    where: { isActive: true, ...(req.query.roleKey ? { roles: { some: { role: { key: String(req.query.roleKey) } } } } : {}) },
    select: { id: true, name: true, designation: true, email: true, district: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  res.json(users);
});

const userBody = z.object({
  name: zStr(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  designation: zOptStr(120),
  phone: zOptStr(30),
  districtId: zOptStr(40),
  departmentId: zOptStr(40),
  roleIds: z.array(z.string()).min(1, 'Assign at least one role'),
  isActive: z.boolean().default(true),
  password: z.union([passwordSchema, z.literal('')]).optional(),
});

adminRouter.post('/users', requirePerm('admin.users'), async (req, res) => {
  const b = parse(userBody, req.body);
  const temp = b.password || `Tmp-${crypto.randomBytes(6).toString('base64url')}9a`;
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        name: b.name, email: b.email, designation: b.designation, phone: b.phone, districtId: b.districtId, departmentId: b.departmentId,
        isActive: b.isActive, passwordHash: await bcrypt.hash(temp, 12), mustChangePassword: true,
        roles: { create: b.roleIds.map((roleId) => ({ roleId })) },
      },
      select: userSelect,
    });
    await audit(tx, req, { action: 'USER_CREATED', entityType: 'User', entityId: u.id, entityRef: u.email, after: { ...b, password: undefined } });
    return u;
  });
  res.status(201).json({ user, temporaryPassword: b.password ? undefined : temp });
});

adminRouter.put('/users/:id', requirePerm('admin.users'), async (req, res) => {
  const b = parse(userBody, req.body);
  const before = await prisma.user.findUnique({ where: { id: String(req.params.id) }, include: { roles: true } });
  if (!before) throw notFound();
  if (before.id === req.user!.id && !b.isActive) throw badRequest('You cannot deactivate your own account.');
  const user = await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: before.id } });
    const u = await tx.user.update({
      where: { id: before.id },
      data: {
        name: b.name, email: b.email, designation: b.designation, phone: b.phone, districtId: b.districtId, departmentId: b.departmentId, isActive: b.isActive,
        ...(b.password ? { passwordHash: await bcrypt.hash(b.password, 12), mustChangePassword: true } : {}),
        roles: { create: b.roleIds.map((roleId) => ({ roleId })) },
      },
      select: userSelect,
    });
    if (!b.isActive) await tx.session.deleteMany({ where: { userId: u.id } });
    const d = diff(
      { name: before.name, email: before.email, designation: before.designation, districtId: before.districtId, departmentId: before.departmentId, isActive: before.isActive, roleIds: before.roles.map((r) => r.roleId).sort() },
      { name: b.name, email: b.email, designation: b.designation, districtId: b.districtId, departmentId: b.departmentId, isActive: b.isActive, roleIds: [...b.roleIds].sort() },
    );
    await audit(tx, req, { action: b.password ? 'USER_UPDATED_PASSWORD_RESET' : 'USER_UPDATED', entityType: 'User', entityId: u.id, entityRef: u.email, before: d.before, after: d.after });
    return u;
  });
  res.json({ user });
});

adminRouter.post('/users/:id/unlock', requirePerm('admin.users'), async (req, res) => {
  const u = await prisma.user.update({ where: { id: String(req.params.id) }, data: { lockedUntil: null, failedLogins: 0 } });
  await audit(prisma, req, { action: 'USER_UNLOCKED', entityType: 'User', entityId: u.id, entityRef: u.email });
  res.json({ ok: true });
});

// ───────────── Roles ─────────────
adminRouter.get('/permissions', requirePerm('admin.users'), (_req, res) => {
  res.json(Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label })));
});
adminRouter.get('/roles', requireAuth, async (_req, res) => {
  const roles = await prisma.role.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { users: true } } } });
  res.json(roles);
});
const roleBody = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]+$/, 'Lowercase letters, digits and underscores only').max(60),
  name: zStr(80),
  description: zOptStr(300),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])),
});
adminRouter.post('/roles', requirePerm('admin.users'), async (req, res) => {
  const b = parse(roleBody, req.body);
  const role = await prisma.role.create({ data: b });
  await audit(prisma, req, { action: 'ROLE_CREATED', entityType: 'Role', entityId: role.id, entityRef: role.key, after: b });
  res.status(201).json(role);
});
adminRouter.put('/roles/:id', requirePerm('admin.users'), async (req, res) => {
  const b = parse(roleBody, req.body);
  const before = await prisma.role.findUnique({ where: { id: String(req.params.id) } });
  if (!before) throw notFound();
  if (before.key === 'administrator' && !b.permissions.includes('admin.users')) throw badRequest('The Administrator role must keep "Manage users".');
  const role = await prisma.role.update({ where: { id: before.id }, data: { ...b, key: before.isSystem ? before.key : b.key } });
  await audit(prisma, req, { action: 'ROLE_UPDATED', entityType: 'Role', entityId: role.id, entityRef: role.key, before: { permissions: before.permissions, name: before.name }, after: { permissions: b.permissions, name: b.name } });
  res.json(role);
});
adminRouter.delete('/roles/:id', requirePerm('admin.users'), async (req, res) => {
  const role = await prisma.role.findUnique({ where: { id: String(req.params.id) }, include: { _count: { select: { users: true, levels: true } } } });
  if (!role) throw notFound();
  if (role.isSystem) throw badRequest('System roles cannot be deleted.');
  if (role._count.users || role._count.levels) throw conflict('Role is in use by users or workflow levels.');
  await prisma.role.delete({ where: { id: role.id } });
  await audit(prisma, req, { action: 'ROLE_DELETED', entityType: 'Role', entityId: role.id, entityRef: role.key, before: role });
  res.json({ ok: true });
});

// ───────────── Districts / Departments ─────────────
adminRouter.get('/districts', requireAuth, async (req, res) => {
  const rows = await prisma.district.findMany({
    where: req.query.all === 'true' ? {} : { isActive: true },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { users: true, departments: true } } },
  });
  res.json(rows);
});
const districtBody = z.object({ name: zStr(120), code: zOptStr(20), type: z.enum(['DISTRICT', 'HQ', 'REGION']), region: zOptStr(80), isActive: z.boolean().default(true) });
adminRouter.post('/districts', requirePerm('admin.org'), async (req, res) => {
  const b = parse(districtBody, req.body);
  const d = await prisma.district.create({ data: b });
  await audit(prisma, req, { action: 'DISTRICT_CREATED', entityType: 'District', entityId: d.id, entityRef: d.name, after: b });
  res.status(201).json(d);
});
adminRouter.put('/districts/:id', requirePerm('admin.org'), async (req, res) => {
  const b = parse(districtBody, req.body);
  const before = await prisma.district.findUniqueOrThrow({ where: { id: String(req.params.id) } });
  const d = await prisma.district.update({ where: { id: before.id }, data: b });
  const df = diff(before, b);
  await audit(prisma, req, { action: 'DISTRICT_UPDATED', entityType: 'District', entityId: d.id, entityRef: d.name, before: df.before, after: df.after });
  res.json(d);
});
adminRouter.get('/departments', requireAuth, async (req, res) => {
  res.json(
    await prisma.department.findMany({
      where: { ...(req.query.all === 'true' ? {} : { isActive: true }), ...(req.query.districtId ? { OR: [{ districtId: String(req.query.districtId) }, { districtId: null }] } : {}) },
      include: { district: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    }),
  );
});
const deptBody = z.object({ name: zStr(120), districtId: zOptStr(40), isActive: z.boolean().default(true) });
adminRouter.post('/departments', requirePerm('admin.org'), async (req, res) => {
  const b = parse(deptBody, req.body);
  const d = await prisma.department.create({ data: b });
  await audit(prisma, req, { action: 'DEPARTMENT_CREATED', entityType: 'Department', entityId: d.id, entityRef: d.name, after: b });
  res.status(201).json(d);
});
adminRouter.put('/departments/:id', requirePerm('admin.org'), async (req, res) => {
  const b = parse(deptBody, req.body);
  const before = await prisma.department.findUniqueOrThrow({ where: { id: String(req.params.id) } });
  const d = await prisma.department.update({ where: { id: before.id }, data: b });
  const df = diff(before, b);
  await audit(prisma, req, { action: 'DEPARTMENT_UPDATED', entityType: 'Department', entityId: d.id, entityRef: d.name, before: df.before, after: df.after });
  res.json(d);
});

// ───────────── Workflow definitions ─────────────
const levelBody = z.object({
  id: z.string().optional(),
  name: zStr(120),
  designation: zOptStr(120),
  approverType: z.enum(['USER', 'ROLE', 'RESPONSIBLE_OFFICER']),
  approverUserId: zOptStr(40),
  approverRoleId: zOptStr(40),
  districtScope: z.enum(['ANY', 'SAME_DISTRICT']).default('ANY'),
  allowReject: z.boolean().default(true),
  allowReturn: z.boolean().default(true),
  allowReassign: z.boolean().default(false),
  canAmendDates: z.boolean().default(false),
}).superRefine((l, ctx) => {
  if (l.approverType === 'USER' && !l.approverUserId) ctx.addIssue({ code: 'custom', path: ['approverUserId'], message: 'Select the approving officer' });
  if (l.approverType === 'ROLE' && !l.approverRoleId) ctx.addIssue({ code: 'custom', path: ['approverRoleId'], message: 'Select the approving role' });
});
const wfBody = z.object({
  module: z.enum(['DAAMR_REQUEST', 'DAAMR_REPORT', 'HOSTEL_BOOKING', 'JM_REPORT', 'COURSE_SESSION', 'COURSE_COMPLETION']),
  name: zStr(120),
  description: zOptStr(500),
  districtId: zOptStr(40),
  isActive: z.boolean().default(true),
  resubmitPolicy: z.enum(['RESTART', 'RETURNING_LEVEL']),
  levels: z.array(levelBody).min(1, 'Add at least one approval level').max(12),
}).superRefine((w, ctx) => {
  if (!['DAAMR_REQUEST', 'DAAMR_REPORT', 'COURSE_SESSION', 'COURSE_COMPLETION'].includes(w.module)) {
    w.levels.forEach((l, i) => {
      if (l.approverType === 'RESPONSIBLE_OFFICER') ctx.addIssue({ code: 'custom', path: ['levels', i, 'approverType'], message: 'The responsible officer is only available for activity workflows' });
    });
  }
});

const wfInclude = {
  district: { select: { id: true, name: true } },
  levels: { orderBy: { order: 'asc' as const }, include: { approverUser: { select: { id: true, name: true, designation: true } }, approverRole: { select: { id: true, name: true } } } },
  _count: { select: { instances: { where: { status: { in: ['IN_PROGRESS', 'RETURNED'] } } } } },
};

adminRouter.get('/workflows', requirePerm('admin.workflows'), async (_req, res) => {
  res.json({ modules: MODULE_LABEL, definitions: await prisma.workflowDefinition.findMany({ include: wfInclude, orderBy: [{ module: 'asc' }, { name: 'asc' }] }) });
});
adminRouter.get('/workflows/:id', requirePerm('admin.workflows'), async (req, res) => {
  const d = await prisma.workflowDefinition.findUnique({ where: { id: String(req.params.id) }, include: wfInclude });
  if (!d) throw notFound();
  res.json(d);
});

function levelData(l: z.infer<typeof levelBody>, order: number) {
  return {
    order,
    name: l.name,
    designation: l.designation,
    approverType: l.approverType,
    approverUserId: l.approverType === 'USER' ? l.approverUserId : null,
    approverRoleId: l.approverType === 'ROLE' ? l.approverRoleId : null,
    districtScope: l.districtScope,
    allowReject: l.allowReject,
    allowReturn: l.allowReturn,
    allowReassign: l.allowReassign,
    canAmendDates: l.canAmendDates,
  };
}

adminRouter.post('/workflows', requirePerm('admin.workflows'), async (req, res) => {
  const b = parse(wfBody, req.body);
  const def = await prisma.$transaction(async (tx) => {
    if (b.isActive) await tx.workflowDefinition.updateMany({ where: { module: b.module, districtId: b.districtId, isActive: true }, data: { isActive: false } });
    const d = await tx.workflowDefinition.create({
      data: { module: b.module, name: b.name, description: b.description, districtId: b.districtId, isActive: b.isActive, resubmitPolicy: b.resubmitPolicy, levels: { create: b.levels.map((l, i) => levelData(l, i + 1)) } },
      include: wfInclude,
    });
    await audit(tx, req, { action: 'WORKFLOW_CREATED', module: b.module, entityType: 'WorkflowDefinition', entityId: d.id, entityRef: d.name, after: b });
    return d;
  });
  res.status(201).json(def);
});

adminRouter.put('/workflows/:id', requirePerm('admin.workflows'), async (req, res) => {
  const b = parse(wfBody, req.body);
  const before = await prisma.workflowDefinition.findUnique({ where: { id: String(req.params.id) }, include: { levels: { orderBy: { order: 'asc' } } } });
  if (!before) throw notFound();
  if (before.module !== b.module) throw badRequest('The module of an existing workflow cannot be changed.');
  const def = await prisma.$transaction(async (tx) => {
    if (b.isActive) await tx.workflowDefinition.updateMany({ where: { module: b.module, districtId: b.districtId, isActive: true, id: { not: before.id } }, data: { isActive: false } });
    // keep level ids stable where possible; temporarily move orders out of the way to satisfy the unique (definitionId, order)
    await tx.workflowLevel.updateMany({ where: { definitionId: before.id }, data: { order: { increment: 1000 } } });
    const keepIds = new Set(b.levels.map((l) => l.id).filter(Boolean) as string[]);
    for (const old of before.levels) if (!keepIds.has(old.id)) await tx.workflowLevel.delete({ where: { id: old.id } });
    for (const [i, l] of b.levels.entries()) {
      if (l.id && before.levels.some((o) => o.id === l.id)) await tx.workflowLevel.update({ where: { id: l.id }, data: levelData(l, i + 1) });
      else await tx.workflowLevel.create({ data: { ...levelData(l, i + 1), definitionId: before.id } });
    }
    const d = await tx.workflowDefinition.update({
      where: { id: before.id },
      data: { name: b.name, description: b.description, districtId: b.districtId, isActive: b.isActive, resubmitPolicy: b.resubmitPolicy },
      include: wfInclude,
    });
    await audit(tx, req, {
      action: 'WORKFLOW_SEQUENCE_CHANGED',
      module: b.module,
      entityType: 'WorkflowDefinition',
      entityId: d.id,
      entityRef: d.name,
      before: { name: before.name, isActive: before.isActive, resubmitPolicy: before.resubmitPolicy, levels: before.levels.map((l) => ({ order: l.order, name: l.name, approverType: l.approverType, approverUserId: l.approverUserId, approverRoleId: l.approverRoleId })) },
      after: { name: b.name, isActive: b.isActive, resubmitPolicy: b.resubmitPolicy, levels: b.levels.map((l, i) => ({ order: i + 1, name: l.name, approverType: l.approverType, approverUserId: l.approverUserId, approverRoleId: l.approverRoleId })) },
    });
    return d;
  });
  res.json(def);
});

// ───────────── Settings & lookups ─────────────
adminRouter.get('/settings', requirePerm('admin.settings'), async (_req, res) => {
  res.json({ settings: await getSettings(), defaults: DEFAULT_SETTINGS, smtpConfigured: await smtpConfigured() });
});
adminRouter.put('/settings', requirePerm('admin.settings'), async (req, res) => {
  const b = parse(
    z.object({
      orgName: zStr(150).optional(),
      orgSubtitle: z.string().max(200).optional(),
      logoFileId: z.string().nullable().optional(),
      themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0f5132').optional(),
      timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown timezone').optional(),
      sessionIdleMinutes: z.coerce.number().int().min(5).max(480).optional(),
      sessionMaxHours: z.coerce.number().int().min(1).max(72).optional(),
      maxUploadMb: z.coerce.number().int().min(1).max(50).optional(),
      participantTotalFields: z.array(z.enum(['male', 'female', 'minority', 'madaris', 'transgender', 'disabled', 'juvenile'])).min(1).optional(),
      hostelDashboardFilterMode: z.enum(['HOSTEL', 'FACILITY_TYPE']).optional(),
      hostelExtensionRequiresOverride: z.boolean().optional(),
      jmSlightDelayMaxDays: z.coerce.number().int().min(1).max(3650).optional(),
      jmSlightGapMaxPct: z.coerce.number().min(1).max(100).optional(),
      jmSatisfactoryQualityValues: z.array(z.string()).min(1).optional(),
      jmRiskBands: z.object({ low: z.coerce.number().int(), medium: z.coerce.number().int(), high: z.coerce.number().int() }).refine((b) => b.low < b.medium && b.medium < b.high, 'Bands must increase').optional(),
      jmCertificationStatement: zStr(1000).optional(),
      jmRemindersEnabled: z.boolean().optional(),
      courseNonTrainingWeekdays: z.array(z.number().int().min(0).max(6)).max(6).optional(),
      courseHolidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')).max(400).optional(),
      courseReportDueDays: z.coerce.number().int().min(0).max(30).optional(),
      courseRequirePhotos: z.boolean().optional(),
      courseCompletionGraceDays: z.coerce.number().int().min(0).max(365).optional(),
      activityDeadlineReminderDays: z.coerce.number().int().min(0).max(30).optional(),
      activityRemindersEnabled: z.boolean().optional(),
      backupEnabled: z.boolean().optional(),
      backupKeep: z.coerce.number().int().min(1).max(365).optional(),
    }),
    req.body,
  );
  const before = await getSettings();
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(b)) {
      if (value === undefined) continue;
      await tx.systemSetting.upsert({ where: { key }, create: { key, value: value as any, updatedById: req.user!.id }, update: { value: value as any, updatedById: req.user!.id } });
    }
    const d = diff(before as any, b);
    if (d.changed) await audit(tx, req, { action: 'SETTINGS_UPDATED', entityType: 'SystemSetting', before: d.before, after: d.after });
  });
  invalidateSettings();
  res.json({ settings: await getSettings() });
});

// ───────────── Database backups ─────────────
adminRouter.get('/backups', requirePerm('admin.settings'), async (_req, res) => {
  res.json({ dir: backupDir, backups: listBackups() });
});
adminRouter.post('/backups/run', requirePerm('admin.settings'), async (req, res) => {
  try {
    const b = await runBackup();
    await audit(prisma, req, { action: 'DATABASE_BACKUP_CREATED', entityType: 'Backup', entityRef: b.name, after: { size: b.size } });
    res.json(b);
  } catch (e: any) {
    await audit(prisma, req, { action: 'DATABASE_BACKUP_FAILED', entityType: 'Backup', after: { error: String(e.message).slice(0, 500) } });
    throw badRequest(`Backup failed: ${e.message}`);
  }
});

// ───────────── Email (SMTP) settings — password write-only, encrypted at rest ─────────────
adminRouter.get('/smtp', requirePerm('admin.settings'), async (_req, res) => {
  const row = await prisma.systemSetting.findUnique({ where: { key: SMTP_KEY } });
  const v = (row?.value ?? {}) as any;
  const active = await getSmtp();
  res.json({
    saved: { host: v.host ?? '', port: v.port ?? 587, secure: !!v.secure, ignoreTls: !!v.ignoreTls, user: v.user ?? '', from: v.from ?? '', passwordSet: !!v.passEnc },
    activeSource: active.source,
    envConfigured: !!config.smtp.host,
    updatedAt: row?.updatedAt ?? null,
  });
});

const smtpBody = z.object({
  host: z.string().trim().min(1, 'Enter the SMTP server').max(255).regex(/^[A-Za-z0-9.-]+$/, 'Enter a host name such as smtp.office365.com'),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean().default(false),
  ignoreTls: z.boolean().default(false),
  user: z.string().trim().max(255).default(''),
  password: z.string().max(500).optional(), // omitted/empty = keep the stored password
  clearPassword: z.boolean().optional(),
  from: z.string().trim().min(3, 'Enter the sender, e.g. Directorate of Youth Affairs <no-reply@kp.gov.pk>').max(255)
    .refine((f) => /^[^<>]*<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$|^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(f), 'Use "Name <address@domain>" or an email address'),
});

adminRouter.put('/smtp', requirePerm('admin.settings'), async (req, res) => {
  const b = parse(smtpBody, req.body);
  const before = await prisma.systemSetting.findUnique({ where: { key: SMTP_KEY } });
  const prev = (before?.value ?? {}) as any;
  const passEnc = b.clearPassword ? '' : b.password ? encrypt(b.password) : prev.passEnc ?? '';
  const value = { host: b.host, port: b.port, secure: b.secure, ignoreTls: b.ignoreTls, user: b.user, from: b.from, passEnc };
  await prisma.$transaction(async (tx) => {
    await tx.systemSetting.upsert({ where: { key: SMTP_KEY }, create: { key: SMTP_KEY, value, updatedById: req.user!.id }, update: { value, updatedById: req.user!.id } });
    const strip = (x: any) => (x ? { host: x.host, port: x.port, secure: x.secure, ignoreTls: x.ignoreTls, user: x.user, from: x.from, password: x.passEnc ? '(set)' : '(none)' } : null);
    await audit(tx, req, { action: 'SMTP_SETTINGS_UPDATED', entityType: 'SystemSetting', entityRef: 'smtp', before: strip(before?.value), after: { ...strip(value), passwordChanged: !!b.password || !!b.clearPassword } });
  });
  invalidateSmtp();
  res.json({ ok: true });
});

adminRouter.delete('/smtp', requirePerm('admin.settings'), async (req, res) => {
  await prisma.systemSetting.deleteMany({ where: { key: SMTP_KEY } });
  await audit(prisma, req, { action: 'SMTP_SETTINGS_CLEARED', entityType: 'SystemSetting', entityRef: 'smtp' });
  invalidateSmtp();
  res.json({ ok: true });
});

/** Sends a real test message through the active configuration and reports the server's answer. */
adminRouter.post('/smtp/test', requirePerm('admin.settings'), async (req, res) => {
  const { to } = parse(z.object({ to: z.string().trim().toLowerCase().email('Enter a valid email address') }), req.body);
  const s = await getSettings();
  const log = await prisma.emailLog.create({
    data: {
      toEmail: to, event: 'SMTP_TEST', subject: `Test email from ${s.orgName}`,
      body: `This is a test message sent by ${req.user!.name} from System Settings to confirm that email delivery is working.\n\n— ${s.orgName}`,
    },
  });
  await audit(prisma, req, { action: 'SMTP_TEST_SENT', entityType: 'EmailLog', entityId: log.id, entityRef: to });
  await flushEmails();
  const r = await prisma.emailLog.findUniqueOrThrow({ where: { id: log.id } });
  res.json({ status: r.status, error: r.error, messageId: r.messageId, source: (await getSmtp()).source });
});

adminRouter.get('/lookups', requireAuth, async (req, res) => {
  const where: any = {};
  if (req.query.group) where.group = { in: String(req.query.group).split(',') };
  if (req.query.all !== 'true') where.isActive = true;
  res.json(await prisma.lookupOption.findMany({ where, orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }] }));
});
const lookupBody = z.object({
  group: z.string().regex(/^[A-Z_]+$/),
  value: z.string().trim().regex(/^[A-Z0-9_]+$/, 'Use UPPER_CASE letters, digits and underscores'),
  label: zStr(120),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
  meta: z.record(z.any()).nullable().optional(),
});
adminRouter.post('/lookups', requirePerm('admin.settings'), async (req, res) => {
  const b = parse(lookupBody, req.body);
  const o = await prisma.lookupOption.create({ data: { ...b, meta: b.meta ?? undefined } });
  await audit(prisma, req, { action: 'LOOKUP_CREATED', entityType: 'LookupOption', entityId: o.id, entityRef: `${o.group}:${o.value}`, after: b });
  res.status(201).json(o);
});
adminRouter.put('/lookups/:id', requirePerm('admin.settings'), async (req, res) => {
  const b = parse(lookupBody, req.body);
  const before = await prisma.lookupOption.findUniqueOrThrow({ where: { id: String(req.params.id) } });
  // the stored value is referenced by records; only label/order/active/meta are editable
  const o = await prisma.lookupOption.update({ where: { id: before.id }, data: { label: b.label, sortOrder: b.sortOrder, isActive: b.isActive, meta: b.meta ?? undefined } });
  const d = diff(before, { label: b.label, sortOrder: b.sortOrder, isActive: b.isActive, meta: b.meta ?? null });
  await audit(prisma, req, { action: 'LOOKUP_UPDATED', entityType: 'LookupOption', entityId: o.id, entityRef: `${o.group}:${o.value}`, before: d.before, after: d.after });
  res.json(o);
});

// ───────────── Notifications ─────────────
adminRouter.get('/notifications', requireAuth, async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const where: any = { userId: req.user!.id, ...(req.query.unread === 'true' ? { readAt: null } : {}) };
  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
  ]);
  res.json({ rows, total, unread, page, pageSize });
});
adminRouter.get('/notifications/unread-count', requireAuth, async (req, res) => {
  res.json({ unread: await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }) });
});
adminRouter.post('/notifications/:id/read', requireAuth, async (req, res) => {
  await prisma.notification.updateMany({ where: { id: String(req.params.id), userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});
adminRouter.post('/notifications/read-all', requireAuth, async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

// ───────────── Email logs ─────────────
function emailWhere(q: any) {
  const where: any = {};
  if (q.status) where.status = String(q.status);
  if (q.module) where.module = String(q.module);
  if (q.q) where.OR = [{ toEmail: icontains(String(q.q)) }, { subject: icontains(String(q.q)) }, { entityRef: icontains(String(q.q)) }];
  const range = dateRangeFilter(q.from, q.to);
  if (range) where.createdAt = range;
  return where;
}
adminRouter.get('/emails', requirePerm('email.view'), async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const where = emailWhere(req.query);
  const [rows, total, stats] = await Promise.all([
    prisma.emailLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.emailLog.count({ where }),
    prisma.emailLog.groupBy({ by: ['status'], _count: true }),
  ]);
  res.json({ rows, total, page, pageSize, stats: Object.fromEntries(stats.map((s) => [s.status, s._count])), smtpConfigured: await smtpConfigured() });
});
adminRouter.post('/emails/:id/retry', requirePerm('email.retry'), async (req, res) => {
  const row = await prisma.emailLog.findUnique({ where: { id: String(req.params.id) } });
  if (!row) throw notFound();
  if (row.status !== 'FAILED') throw conflict('Only failed emails can be retried.');
  await prisma.emailLog.update({ where: { id: row.id }, data: { status: 'PENDING', error: null } });
  await audit(prisma, req, { action: 'EMAIL_RETRY', entityType: 'EmailLog', entityId: row.id, entityRef: row.entityRef ?? row.toEmail });
  await flushEmails();
  res.json(await prisma.emailLog.findUnique({ where: { id: row.id } }));
});
adminRouter.post('/emails/retry-failed', requirePerm('email.retry'), async (req, res) => {
  const r = await prisma.emailLog.updateMany({ where: { status: 'FAILED' }, data: { status: 'PENDING', error: null } });
  await audit(prisma, req, { action: 'EMAIL_RETRY_ALL', entityType: 'EmailLog', after: { count: r.count } });
  await flushEmails();
  res.json({ retried: r.count });
});

// ───────────── Audit logs (read-only) ─────────────
function auditWhere(q: any) {
  const where: any = {};
  if (q.module) where.module = String(q.module);
  if (q.entityType) where.entityType = String(q.entityType);
  if (q.action) where.action = icontains(String(q.action));
  if (q.actorId) where.actorId = String(q.actorId);
  if (q.q) where.OR = [{ entityRef: icontains(String(q.q)) }, { actorName: icontains(String(q.q)) }, { action: icontains(String(q.q)) }];
  const range = dateRangeFilter(q.from, q.to);
  if (range) where.createdAt = range;
  return where;
}
adminRouter.get('/audit', requirePerm('audit.view'), async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const where = auditWhere(req.query);
  const [rows, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }), prisma.auditLog.count({ where })]);
  res.json({ rows, total, page, pageSize });
});
adminRouter.get('/audit/export', requirePerm('audit.view'), async (req, res) => {
  const s = await getSettings();
  const rows = await prisma.auditLog.findMany({ where: auditWhere(req.query), orderBy: { createdAt: 'desc' }, take: 20000 });
  await audit(prisma, req, { action: 'AUDIT_EXPORTED', entityType: 'AuditLog', after: { filters: req.query, count: rows.length } });
  await sendExport(res, String(req.query.format ?? 'csv'), {
    title: 'Audit Log',
    filename: `audit-log-${new Date().toISOString().slice(0, 10)}`,
    landscape: true,
    meta: [['Period', `${req.query.from || 'Beginning'} to ${req.query.to || 'Today'}`]],
    sections: [{
      type: 'table',
      columns: [
        { key: 'at', label: 'Date & time', width: 1.3 }, { key: 'actorName', label: 'User', width: 1.2 }, { key: 'action', label: 'Action', width: 1.4 },
        { key: 'entityType', label: 'Entity', width: 1 }, { key: 'entityRef', label: 'Reference', width: 1.2 }, { key: 'changes', label: 'Changes', width: 3.5 },
      ],
      rows: rows.map((r) => ({ ...r, at: fmtDateTime(r.createdAt, s.timezone), changes: r.after ? JSON.stringify(r.after).slice(0, 400) : '' })),
    }],
  }, req.user!.name);
});

// ───────────── Public (unauthenticated) branding ─────────────
export const publicRouter = Router();
publicRouter.get('/settings', async (_req, res) => {
  const s = publicSettings(await getSettings());
  res.json({ orgName: s.orgName, orgSubtitle: s.orgSubtitle, themeColor: s.themeColor, logoFileId: s.logoFileId });
});
publicRouter.get('/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});

