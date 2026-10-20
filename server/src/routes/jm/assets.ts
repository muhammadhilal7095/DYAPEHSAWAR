import { Router } from 'express';
import { z } from 'zod';
import { prisma, icontains } from '../../db.js';
import { requireAuth, requirePerm, can } from '../../lib/auth.js';
import { audit, diff } from '../../lib/audit.js';
import { badRequest, forbidden, notFound, pageParams, parse, zOptDate, zOptStr, zStr, dateRangeFilter } from '../../lib/http.js';
import { nextId, ID_PREFIX } from '../../lib/ids.js';
import { fileSelect } from '../../lib/files.js';
import { sendExport, fmtDate, humanize } from '../../lib/export.js';
import { canViewAssets, jmScope, canViewJmReport } from './common.js';

export const jmAssetsRouter = Router();

const assetBody = z.object({
  name: zStr(200),
  districtId: zStr(40),
  location: zStr(400),
  latitude: z.union([z.coerce.number().min(-90).max(90), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v == null ? null : Number(v))),
  longitude: z.union([z.coerce.number().min(-180).max(180), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v == null ? null : Number(v))),
  projectStartDate: zOptDate,
  plannedCompletionDate: zOptDate,
  revisedCompletionDate: zOptDate,
  approvedCost: z.union([z.coerce.number().min(0), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v == null ? null : Number(v))),
  contractor: zOptStr(200),
  supervisingDepartment: zOptStr(200),
  supervisingOfficer: zOptStr(200),
  currentStatus: zStr(60),
  overallProgress: z.coerce.number().min(0).max(100).default(0),
  remarks: zOptStr(5000),
  isActive: z.boolean().default(true),
}).refine((a) => (a.latitude == null) === (a.longitude == null), { path: ['longitude'], message: 'Enter both latitude and longitude' });

function guard(req: any) {
  if (!canViewAssets(req.user)) throw forbidden();
}

jmAssetsRouter.get('/', requireAuth, async (req, res) => {
  guard(req);
  const q = req.query;
  const where: any = { AND: [] as any[] };
  if (q.active !== 'all') where.AND.push({ isActive: true });
  if (q.districtId) where.AND.push({ districtId: String(q.districtId) });
  if (q.status) where.AND.push({ currentStatus: String(q.status) });
  if (q.q) where.AND.push({ OR: [{ name: icontains(String(q.q)) }, { assetCode: icontains(String(q.q)) }, { location: icontains(String(q.q)) }] });
  const { skip, take, page, pageSize } = pageParams({ ...q, pageSize: q.pageSize ?? 200 });
  const [rows, total] = await Promise.all([
    prisma.jmAsset.findMany({
      where, skip, take, orderBy: { name: 'asc' },
      include: { district: { select: { id: true, name: true } }, _count: { select: { reports: { where: { status: { not: 'DRAFT' } } }, issues: { where: { status: { notIn: ['RESOLVED', 'CLOSED'] } } } } } },
    }),
    prisma.jmAsset.count({ where }),
  ]);
  res.json({ rows, total, page, pageSize });
});

jmAssetsRouter.get('/export', requirePerm('jm.export'), async (req, res) => {
  const rows = await prisma.jmAsset.findMany({ include: { district: true }, orderBy: { name: 'asc' } });
  await audit(prisma, req, { action: 'EXPORT', module: 'JM', entityType: 'JmAsset', after: { format: req.query.format, count: rows.length } });
  await sendExport(res, String(req.query.format ?? 'xlsx'), {
    title: 'Jawan Markaz Asset Register', filename: 'jm-asset-register', landscape: true,
    sections: [{ type: 'table', columns: [
      { key: 'assetCode', label: 'Asset ID' }, { key: 'name', label: 'Jawan Markaz', width: 1.6 }, { key: 'district', label: 'District / HQ' }, { key: 'location', label: 'Location', width: 1.5 },
      { key: 'gps', label: 'GPS', width: 1.2 }, { key: 'start', label: 'Start' }, { key: 'planned', label: 'Planned completion' }, { key: 'revised', label: 'Revised completion' },
      { key: 'contractor', label: 'Contractor' }, { key: 'status', label: 'Status' }, { key: 'overallProgress', label: 'Progress %', align: 'right' }, { key: 'lastInsp', label: 'Last inspection' }, { key: 'lastRep', label: 'Last report' },
    ], rows: rows.map((a) => ({ ...a, district: a.district.name, gps: a.latitude != null ? `${a.latitude}, ${a.longitude}` : '', start: fmtDate(a.projectStartDate), planned: fmtDate(a.plannedCompletionDate), revised: fmtDate(a.revisedCompletionDate), status: humanize(a.currentStatus), lastInsp: fmtDate(a.lastInspectionDate), lastRep: fmtDate(a.lastReportingDate) })) }],
  }, req.user!.name);
});

jmAssetsRouter.get('/:id', requireAuth, async (req, res) => {
  guard(req);
  const a = await prisma.jmAsset.findUnique({ where: { id: String(req.params.id) }, include: { district: true } });
  if (!a) throw notFound();
  const visible = { AND: [{ assetId: a.id }, jmScope(req.user!), { status: { not: 'DRAFT' } }] };
  const reports = await prisma.jmReport.findMany({
    where: visible,
    orderBy: { submittedAt: 'asc' },
    select: {
      id: true, reportNo: true, status: true, submittedAt: true, periodFrom: true, periodTo: true, inspectionDate: true, inspectionType: true, currentProgress: true, plannedProgress: true,
      actualCompletion: true, scheduleClass: true, qualityRating: true, complianceRating: true, projectStatus: true, overallAssessment: true, keyFindings: true, recommendedMeasures: true,
      priorityActions: true, nextInspectionDate: true, followUpRequired: true, reportingOfficer: { select: { name: true } }, finalReviewer: { select: { name: true } }, finalDecisionAt: true,
    },
  });
  const visibleIds = reports.map((r) => r.id);
  const [issues, actions, risks, files, history] = await Promise.all([
    prisma.jmIssue.findMany({ where: { reportId: { in: visibleIds } }, orderBy: { dateIdentified: 'desc' }, include: { report: { select: { reportNo: true } } } }),
    prisma.jmAction.findMany({ where: { reportId: { in: visibleIds } }, orderBy: { targetDate: 'asc' }, include: { report: { select: { reportNo: true } }, issue: { select: { issueCode: true } } } }),
    prisma.jmRisk.findMany({ where: { reportId: { in: visibleIds } }, orderBy: { score: 'desc' }, include: { mitigations: true, report: { select: { reportNo: true } } } }),
    prisma.file.findMany({ where: { deletedAt: null, kind: 'PHOTO', OR: [{ jmAssetId: a.id, jmReportId: null }, { jmReportId: { in: visibleIds } }] }, select: { ...fileSelect, jmReport: { select: { id: true, reportNo: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.approvalHistory.findMany({ where: { instance: { jmReport: { id: { in: visibleIds } } } }, orderBy: { createdAt: 'desc' }, take: 100, include: { instance: { select: { entityRef: true } } } }),
  ]);
  const verified = reports.filter((r) => r.status === 'VERIFIED');
  const latest = verified[verified.length - 1] ?? null;
  res.json({
    asset: a,
    reports: [...reports].reverse(),
    progressSeries: verified.map((r) => ({ date: (r.submittedAt ?? r.periodTo).toISOString().slice(0, 10), reportNo: r.reportNo, progress: r.actualCompletion ?? r.currentProgress, planned: r.plannedProgress })),
    latestVerified: latest,
    nextInspectionDate: latest?.nextInspectionDate ?? null,
    issues,
    actions,
    risks,
    photos: files,
    approvalHistory: history.map((h) => ({ ...h, ref: h.instance.entityRef, instance: undefined })),
    canManage: can(req.user, 'jm.asset.manage'),
  });
});

jmAssetsRouter.post('/', requirePerm('jm.asset.manage'), async (req, res) => {
  const b = parse(assetBody, req.body);
  if (!(await prisma.district.count({ where: { id: b.districtId } }))) throw badRequest('Invalid district.', { fields: { districtId: 'Invalid district' } });
  const a = await prisma.$transaction(async (tx) => {
    const assetCode = await nextId(tx, ID_PREFIX.jmAsset, { yearly: false, pad: 4 });
    const a = await tx.jmAsset.create({ data: { ...b, assetCode } });
    await audit(tx, req, { action: 'ASSET_CREATED', module: 'JM', entityType: 'JmAsset', entityId: a.id, entityRef: assetCode, after: b });
    return a;
  });
  res.status(201).json(a);
});

jmAssetsRouter.put('/:id', requirePerm('jm.asset.manage'), async (req, res) => {
  const b = parse(assetBody, req.body);
  const before = await prisma.jmAsset.findUnique({ where: { id: String(req.params.id) } });
  if (!before) throw notFound();
  const a = await prisma.jmAsset.update({ where: { id: before.id }, data: b });
  const d = diff(before, b);
  if (d.changed) await audit(prisma, req, { action: 'ASSET_UPDATED', module: 'JM', entityType: 'JmAsset', entityId: a.id, entityRef: a.assetCode, before: d.before, after: d.after });
  res.json(a);
});

// ───────────── Registers: issues, actions, risks ─────────────
export const jmRegistersRouter = Router();

function regWhere(req: any, extra: any[] = []) {
  const q = req.query;
  const and: any[] = [{ report: { AND: [jmScope(req.user), { status: { not: 'DRAFT' } }] } }, ...extra];
  if (q.assetId) and.push({ assetId: String(q.assetId) });
  if (q.districtId) and.push({ asset: { districtId: String(q.districtId) } });
  if (q.status) and.push({ status: { in: String(q.status).split(',') } });
  return and;
}

jmRegistersRouter.get('/issues', requireAuth, async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const and = regWhere(req, req.query.severity ? [{ severity: String(req.query.severity) }] : []);
  if (req.query.q) and.push({ OR: [{ issueCode: icontains(String(req.query.q)) }, { description: icontains(String(req.query.q)) }] });
  const range = dateRangeFilter(req.query.from, req.query.to);
  if (range) and.push({ dateIdentified: range });
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.jmIssue.findMany({ where, skip, take, orderBy: [{ dateIdentified: 'desc' }], include: { asset: { select: { id: true, name: true, assetCode: true } }, report: { select: { id: true, reportNo: true, status: true } }, _count: { select: { actions: true } } } }),
    prisma.jmIssue.count({ where }),
  ]);
  res.json({ rows, total, page, pageSize });
});

jmRegistersRouter.get('/actions', requireAuth, async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const and = regWhere(req, req.query.actionType ? [{ actionType: String(req.query.actionType) }] : []);
  if (req.query.overdue === 'true') and.push({ status: { in: ['OPEN', 'IN_PROGRESS'] }, targetDate: { lt: new Date() } });
  if (req.query.q) and.push({ description: icontains(String(req.query.q)) });
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.jmAction.findMany({ where, skip, take, orderBy: [{ targetDate: 'asc' }], include: { asset: { select: { id: true, name: true, assetCode: true } }, report: { select: { id: true, reportNo: true, reportingOfficerId: true } }, issue: { select: { issueCode: true } }, verifiedBy: { select: { name: true } }, files: { where: { deletedAt: null }, select: fileSelect } } }),
    prisma.jmAction.count({ where }),
  ]);
  res.json({ rows, total, page, pageSize });
});

jmRegistersRouter.get('/risks', requireAuth, async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const and = regWhere(req, req.query.level ? [{ level: String(req.query.level) }] : []);
  if (req.query.q) and.push({ OR: [{ riskCode: icontains(String(req.query.q)) }, { description: icontains(String(req.query.q)) }] });
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.jmRisk.findMany({ where, skip, take, orderBy: [{ score: 'desc' }], include: { asset: { select: { id: true, name: true, assetCode: true } }, report: { select: { id: true, reportNo: true } }, mitigations: true } }),
    prisma.jmRisk.count({ where }),
  ]);
  res.json({ rows, total, page, pageSize });
});

async function guardRegister(req: any, reportId: string, allowOwner = false) {
  if (!(await canViewJmReport(req.user, reportId))) throw forbidden();
  if (can(req.user, 'jm.register.update')) return;
  if (allowOwner && (await prisma.jmReport.count({ where: { id: reportId, reportingOfficerId: req.user.id } }))) return;
  throw forbidden('You are not permitted to update register entries.');
}

jmRegistersRouter.patch('/issues/:id', requireAuth, async (req, res) => {
  const b = parse(z.object({ status: z.enum(['OPEN', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']), resolutionRemarks: zOptStr(2000) }), req.body);
  const before = await prisma.jmIssue.findUnique({ where: { id: String(req.params.id) } });
  if (!before) throw notFound();
  await guardRegister(req, before.reportId);
  if (['RESOLVED', 'CLOSED'].includes(b.status) && !b.resolutionRemarks) throw badRequest('Resolution remarks are required.', { fields: { resolutionRemarks: 'Required' } });
  const r = await prisma.jmIssue.update({ where: { id: before.id }, data: b });
  await audit(prisma, req, { action: 'JM_ISSUE_UPDATED', module: 'JM', entityType: 'JmIssue', entityId: r.id, entityRef: r.issueCode, before: { status: before.status, resolutionRemarks: before.resolutionRemarks }, after: b });
  res.json(r);
});

jmRegistersRouter.patch('/actions/:id', requireAuth, async (req, res) => {
  const b = parse(z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED']), completionRemarks: zOptStr(2000) }), req.body);
  const before = await prisma.jmAction.findUnique({ where: { id: String(req.params.id) } });
  if (!before) throw notFound();
  await guardRegister(req, before.reportId, b.status !== 'VERIFIED');
  if (b.status === 'VERIFIED' && !can(req.user, 'jm.register.update')) throw forbidden('Only authorised officers can verify actions.');
  if (b.status === 'VERIFIED' && before.status !== 'COMPLETED') throw badRequest('Only completed actions can be verified.');
  if (['COMPLETED', 'VERIFIED'].includes(b.status) && !(b.completionRemarks || before.completionRemarks)) throw badRequest('Completion remarks are required.', { fields: { completionRemarks: 'Required' } });
  const r = await prisma.jmAction.update({
    where: { id: before.id },
    data: { status: b.status, completionRemarks: b.completionRemarks ?? before.completionRemarks, ...(b.status === 'VERIFIED' ? { verifiedById: req.user!.id, verifiedAt: new Date() } : { verifiedById: null, verifiedAt: null }) },
  });
  await audit(prisma, req, { action: b.status === 'VERIFIED' ? 'JM_ACTION_VERIFIED' : 'JM_ACTION_UPDATED', module: 'JM', entityType: 'JmAction', entityId: r.id, before: { status: before.status }, after: b });
  res.json(r);
});

jmRegistersRouter.patch('/risks/:id', requireAuth, async (req, res) => {
  const b = parse(z.object({ status: z.enum(['OPEN', 'MONITORING', 'MITIGATED', 'CLOSED']), reviewDate: zOptDate }), req.body);
  const before = await prisma.jmRisk.findUnique({ where: { id: String(req.params.id) } });
  if (!before) throw notFound();
  await guardRegister(req, before.reportId);
  const r = await prisma.jmRisk.update({ where: { id: before.id }, data: { status: b.status, ...(b.reviewDate ? { reviewDate: b.reviewDate } : {}) } });
  await audit(prisma, req, { action: 'JM_RISK_UPDATED', module: 'JM', entityType: 'JmRisk', entityId: r.id, entityRef: r.riskCode, before: { status: before.status, reviewDate: before.reviewDate }, after: b });
  res.json(r);
});

jmRegistersRouter.patch('/mitigations/:id', requireAuth, async (req, res) => {
  const b = parse(z.object({ status: z.enum(['PLANNED', 'IN_PROGRESS', 'IMPLEMENTED', 'NOT_EFFECTIVE']), effectiveness: zOptStr(1000) }), req.body);
  const before = await prisma.jmMitigation.findUnique({ where: { id: String(req.params.id) }, include: { risk: true } });
  if (!before) throw notFound();
  await guardRegister(req, before.risk.reportId);
  const r = await prisma.jmMitigation.update({ where: { id: before.id }, data: b });
  await audit(prisma, req, { action: 'JM_MITIGATION_UPDATED', module: 'JM', entityType: 'JmMitigation', entityId: r.id, entityRef: before.risk.riskCode, before: { status: before.status, effectiveness: before.effectiveness }, after: b });
  res.json(r);
});
