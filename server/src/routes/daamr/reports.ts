import { Router } from 'express';
import { z } from 'zod';
import { prisma, icontains, type Tx } from '../../db.js';
import { requireAuth, requirePerm, can, canAny } from '../../lib/auth.js';
import { audit, diff } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound, pageParams, parse, zDate, zMoney, zNonNegInt, zOptStr, zStr, zUrl, dateRangeFilter } from '../../lib/http.js';
import { nextId, ID_PREFIX } from '../../lib/ids.js';
import { transact } from '../../lib/notify.js';
import { fileSelect } from '../../lib/files.js';
import { getSettings } from '../../lib/settings.js';
import { sendExport, fmtDate, fmtDateTime, fmtMoney, humanize } from '../../lib/export.js';
import { assignFirstLevel, buildTimeline, resubmit, startWorkflow } from '../../workflow/engine.js';
import { mountWorkflowRoutes, workflowFlags } from '../workflowRoutes.js';
import { canViewReport, canViewRequest, reportScope, requestScope, DEMOGRAPHIC_FIELDS, canSeeExpenses, isAssignedStaff } from './common.js';

export const daamrReportsRouter = Router();

const ACTIVITY_STATUS = ['PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'POSTPONED', 'CANCELLED'] as const;
const PLATFORMS = ['FACEBOOK', 'NEWSPAPER', 'X', 'TIKTOK', 'INSTAGRAM', 'OTHER'] as const;

const body = z.object({
  requestId: zOptStr(40),
  activityDate: zDate,
  districtId: zStr(40),
  departmentId: zOptStr(40),
  activityName: zStr(250),
  category: zStr(80),
  venue: zStr(300),
  description: zStr(10000),
  responsibleOfficer: zStr(150),
  activityStatus: z.enum(ACTIVITY_STATUS),
  remarks: zOptStr(5000),
  achievements: zOptStr(8000),
  challenges: zOptStr(8000),
  recommendations: zOptStr(8000),
  expenseDetails: zOptStr(8000),
  participants: z.object({
    male: zNonNegInt.default(0), female: zNonNegInt.default(0), minority: zNonNegInt.default(0), madaris: zNonNegInt.default(0),
    transgender: zNonNegInt.default(0), disabled: zNonNegInt.default(0), juvenile: zNonNegInt.default(0),
  }),
  budget: z.object({ allocated: zMoney.default(0), utilized: zMoney.default(0), fundSource: zOptStr(200), remarks: zOptStr(2000) }),
  mediaLinks: z.array(z.object({ platform: z.enum(PLATFORMS), url: zUrl })).max(30).default([]),
  submit: z.boolean().optional(),
});
type Body = z.infer<typeof body>;

export async function participantTotal(p: Record<string, number>) {
  const s = await getSettings();
  const fields = s.participantTotalFields.filter((f) => (DEMOGRAPHIC_FIELDS as readonly string[]).includes(f));
  return { total: fields.reduce((a, f) => a + (Number(p[f]) || 0), 0), fields };
}

function snapshot(r: any) {
  return {
    activityDate: r.activityDate, districtId: r.districtId, departmentId: r.departmentId, activityName: r.activityName, category: r.category, venue: r.venue,
    description: r.description, responsibleOfficer: r.responsibleOfficer, activityStatus: r.activityStatus, remarks: r.remarks,
    achievements: r.achievements, challenges: r.challenges, recommendations: r.recommendations, expenseDetails: r.expenseDetails,
    participants: r.participants ? Object.fromEntries([...DEMOGRAPHIC_FIELDS, 'total'].map((f) => [f, r.participants[f]])) : null,
    budget: r.budget ? { allocated: r.budget.allocated, utilized: r.budget.utilized, remaining: r.budget.remaining, fundSource: r.budget.fundSource, remarks: r.budget.remarks } : null,
    mediaLinks: (r.mediaLinks ?? []).map((m: any) => ({ platform: m.platform, url: m.url })),
  };
}

const detailInclude = {
  participants: true,
  budget: true,
  mediaLinks: true,
  district: true,
  department: true,
  createdBy: { select: { id: true, name: true, email: true } },
  files: { where: { deletedAt: null }, select: fileSelect, orderBy: { createdAt: 'asc' as const } },
};

async function writeChildren(tx: Tx, reportId: string, b: Body) {
  const { total, fields } = await participantTotal(b.participants);
  await tx.activityParticipant.upsert({
    where: { reportId },
    create: { reportId, ...b.participants, total, countingRule: fields },
    update: { ...b.participants, total, countingRule: fields },
  });
  const remaining = Math.round((b.budget.allocated - b.budget.utilized) * 100) / 100;
  await tx.activityBudget.upsert({ where: { reportId }, create: { reportId, ...b.budget, remaining }, update: { ...b.budget, remaining } });
  await tx.mediaLink.deleteMany({ where: { reportId } });
  if (b.mediaLinks.length) await tx.mediaLink.createMany({ data: b.mediaLinks.map((m) => ({ ...m, reportId })) });
}

async function validateRefs(b: Body) {
  if (!(await prisma.district.count({ where: { id: b.districtId, isActive: true } }))) throw badRequest('Select a valid district.', { fields: { districtId: 'Invalid district' } });
  if (!(await prisma.lookupOption.count({ where: { group: 'ACTIVITY_CATEGORY', value: b.category } }))) throw badRequest('Invalid category.', { fields: { category: 'Invalid category' } });
}

async function submitReport(tx: Tx, req: any, id: string) {
  const r = await tx.activityReport.findUniqueOrThrow({ where: { id }, include: detailInclude });
  if (r.reportStatus === 'DRAFT') {
    const inst = await startWorkflow(tx, { module: 'DAAMR_REPORT', entityType: 'ActivityReport', entityId: r.id, entityRef: r.daamrId, districtId: r.districtId, actor: req.user, snapshot: snapshot(r) });
    await tx.activityReport.update({ where: { id }, data: { workflowInstanceId: inst.id, submittedAt: new Date(), reportStatus: 'UNDER_VERIFICATION' } });
    await assignFirstLevel(tx, inst.id, req.user);
    await audit(tx, req, { action: 'ACTIVITY_REPORT_SUBMITTED', module: 'DAAMR', entityType: 'ActivityReport', entityId: id, entityRef: r.daamrId });
  } else if (r.reportStatus === 'RETURNED') {
    await resubmit(tx, r.workflowInstanceId!, req.user, { entityType: 'ActivityReport', entityId: id, snapshot: snapshot(r) });
    await audit(tx, req, { action: 'ACTIVITY_REPORT_RESUBMITTED', module: 'DAAMR', entityType: 'ActivityReport', entityId: id, entityRef: r.daamrId });
  } else throw conflict('This report has already been submitted.');
}

daamrReportsRouter.post('/', requireAuth, async (req, res) => {
  const b = parse(body, req.body);
  await validateRefs(b);
  let daamrId: string | null = null;
  if (b.requestId) {
    const rq = await prisma.activityRequest.findUnique({ where: { id: b.requestId }, include: { report: true } });
    if (!rq) throw badRequest('Linked request not found.');
    if (rq.requesterId !== req.user!.id && !(await isAssignedStaff(req.user!.id, rq.id)) && !can(req.user, 'workflow.override')) throw forbidden('Only the activity creator or its assigned staff can file the execution report.');
    if (rq.status !== 'APPROVED') throw conflict('The activity request must be finally approved before its report is filed.');
    if (rq.activityType === 'COURSE') throw conflict('Courses are reported through daily session reports and the course completion report.');
    if (rq.report) throw conflict(`A report (${rq.report.reportNo}) already exists for ${rq.daamrId}.`);
    if (b.districtId !== rq.districtId) throw badRequest('District must match the approved request.');
    daamrId = rq.daamrId;
  } else if (!canAny(req.user, 'daamr.report.create')) throw forbidden();

  const created = await transact(async (tx) => {
    const reportNo = await nextId(tx, ID_PREFIX.activityReport);
    const id = daamrId ?? (await nextId(tx, ID_PREFIX.daamrRequest));
    const r = await tx.activityReport.create({
      data: {
        reportNo, daamrId: id, requestId: b.requestId, activityDate: b.activityDate, districtId: b.districtId, departmentId: b.departmentId, activityName: b.activityName,
        category: b.category, venue: b.venue, description: b.description, responsibleOfficer: b.responsibleOfficer, activityStatus: b.activityStatus, remarks: b.remarks,
        achievements: b.achievements, challenges: b.challenges, recommendations: b.recommendations, expenseDetails: b.expenseDetails,
        createdById: req.user!.id, updatedById: req.user!.id,
      },
    });
    // filing the execution report moves an approved activity into execution
    if (b.requestId) await tx.activityRequest.updateMany({ where: { id: b.requestId, lifecycle: 'APPROVED' }, data: { lifecycle: 'IN_PROGRESS', executionStatus: 'IN_PROGRESS' } });
    await writeChildren(tx, r.id, b);
    await audit(tx, req, { action: 'ACTIVITY_REPORT_CREATED', module: 'DAAMR', entityType: 'ActivityReport', entityId: r.id, entityRef: id, after: { ...b, submit: undefined } });
    if (b.submit) await submitReport(tx, req, r.id);
    return tx.activityReport.findUniqueOrThrow({ where: { id: r.id } });
  });
  res.status(201).json(created);
});

daamrReportsRouter.put('/:id', requireAuth, async (req, res) => {
  const b = parse(body, req.body);
  const before = await prisma.activityReport.findUnique({ where: { id: String(req.params.id) }, include: detailInclude });
  if (!before) throw notFound();
  if (before.createdById !== req.user!.id && !can(req.user, 'workflow.override')) throw forbidden();
  if (!['DRAFT', 'RETURNED'].includes(before.reportStatus)) throw conflict('This report can no longer be edited.');
  await validateRefs(b);
  if (before.requestId && b.districtId !== before.districtId) throw badRequest('District must match the approved request.');
  const r = await transact(async (tx) => {
    await tx.activityReport.update({
      where: { id: before.id },
      data: {
        activityDate: b.activityDate, districtId: b.districtId, departmentId: b.departmentId, activityName: b.activityName, category: b.category, venue: b.venue,
        description: b.description, responsibleOfficer: b.responsibleOfficer, activityStatus: b.activityStatus, remarks: b.remarks, updatedById: req.user!.id,
        achievements: b.achievements, challenges: b.challenges, recommendations: b.recommendations, expenseDetails: b.expenseDetails,
      },
    });
    await writeChildren(tx, before.id, b);
    const after = await tx.activityReport.findUniqueOrThrow({ where: { id: before.id }, include: detailInclude });
    const d = diff(snapshot(before), snapshot(after));
    if (d.changed) {
      const action = d.after.budget || d.after.participants ? 'ACTIVITY_REPORT_EDITED_COUNTS_BUDGET' : 'ACTIVITY_REPORT_EDITED';
      await audit(tx, req, { action, module: 'DAAMR', entityType: 'ActivityReport', entityId: before.id, entityRef: before.daamrId, before: d.before, after: d.after });
    }
    if (b.submit) await submitReport(tx, req, before.id);
    return tx.activityReport.findUniqueOrThrow({ where: { id: before.id } });
  });
  res.json(r);
});

function listWhere(req: any) {
  const q = req.query;
  const and: any[] = [reportScope(req.user)];
  if (q.scope === 'mine') and.push({ createdById: req.user.id });
  if (q.scope === 'assigned') and.push({ workflow: { currentAssigneeId: req.user.id, status: 'IN_PROGRESS' } });
  if (q.q) {
    const s = String(q.q).trim();
    and.push({ OR: [{ daamrId: icontains(s) }, { reportNo: icontains(s) }, { activityName: icontains(s) }, { responsibleOfficer: icontains(s) }, { venue: icontains(s) }] });
  }
  if (q.districtId) and.push({ districtId: String(q.districtId) });
  if (q.category) and.push({ category: String(q.category) });
  if (q.activityStatus) and.push({ activityStatus: String(q.activityStatus) });
  if (q.reportStatus) and.push({ reportStatus: { in: String(q.reportStatus).split(',') } });
  if (q.officer) and.push({ responsibleOfficer: icontains(String(q.officer)) });
  const range = dateRangeFilter(q.from, q.to);
  if (range) and.push({ activityDate: range });
  return { AND: and };
}

const listInclude = {
  district: { select: { id: true, name: true } },
  participants: { select: { total: true } },
  budget: { select: { allocated: true, utilized: true, remaining: true } },
  workflow: { select: { status: true, currentAssignee: { select: { id: true, name: true } } } },
};

daamrReportsRouter.get('/', requireAuth, async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const where = listWhere(req);
  const [rows, total] = await Promise.all([
    prisma.activityReport.findMany({ where, include: listInclude, orderBy: { activityDate: 'desc' }, skip, take }),
    prisma.activityReport.count({ where }),
  ]);
  const expenses = can(req.user, 'daamr.expense.view');
  res.json({ rows: rows.map((r) => (expenses || r.createdById === req.user!.id ? r : { ...r, budget: null })), total, page, pageSize });
});

daamrReportsRouter.get('/export', requirePerm('daamr.export'), async (req, res) => {
  const s = await getSettings();
  const rows = await prisma.activityReport.findMany({ where: listWhere(req), include: { ...listInclude, participants: true, budget: true, mediaLinks: true, createdBy: { select: { name: true } } }, orderBy: { activityDate: 'desc' }, take: 10000 });
  await audit(prisma, req, { action: 'EXPORT', module: 'DAAMR', entityType: 'ActivityReport', after: { format: req.query.format, filters: req.query, count: rows.length } });
  const expenses = can(req.user, 'daamr.expense.view');
  await sendExport(res, String(req.query.format ?? 'xlsx'), {
    title: 'DAAMR Activity Reports',
    filename: `activity-reports-${new Date().toISOString().slice(0, 10)}`,
    landscape: true,
    meta: [['Activity period', `${req.query.from || 'Beginning'} to ${req.query.to || 'Today'}`], ['Records', String(rows.length)]],
    sections: [{
      type: 'table',
      columns: [
        { key: 'daamrId', label: 'DAAMR ID', width: 1.3 }, { key: 'date', label: 'Activity Date', width: 0.9 }, { key: 'district', label: 'District', width: 1 },
        { key: 'activityName', label: 'Activity', width: 1.8 }, { key: 'cat', label: 'Category', width: 1 }, { key: 'venue', label: 'Venue', width: 1.2 },
        { key: 'responsibleOfficer', label: 'Responsible Officer', width: 1.2 }, { key: 'male', label: 'Male', width: 0.5, align: 'right' }, { key: 'female', label: 'Female', width: 0.5, align: 'right' },
        { key: 'transgender', label: 'TG', width: 0.4, align: 'right' }, { key: 'minority', label: 'Minority', width: 0.55, align: 'right' }, { key: 'madaris', label: 'Madaris', width: 0.55, align: 'right' },
        { key: 'disabled', label: 'Disabled', width: 0.55, align: 'right' }, { key: 'juvenile', label: 'Juvenile', width: 0.55, align: 'right' }, { key: 'total', label: 'Total', width: 0.55, align: 'right' },
        ...(expenses ? [{ key: 'alloc', label: 'Allocated', width: 0.9, align: 'right' as const }, { key: 'util', label: 'Utilized', width: 0.9, align: 'right' as const }] : []), { key: 'status', label: 'Report Status', width: 0.9 },
        { key: 'links', label: 'Media Links', width: 1.5 }, { key: 'updated', label: 'Last Updated', width: 1 },
      ],
      rows: rows.map((r) => ({
        ...r, ...(r.participants ?? {}), date: fmtDate(r.activityDate), district: r.district.name, cat: humanize(r.category), alloc: fmtMoney(r.budget?.allocated), util: fmtMoney(r.budget?.utilized),
        status: humanize(r.reportStatus), links: r.mediaLinks.map((m) => `${humanize(m.platform)}: ${m.url}`).join('\n'), updated: fmtDateTime(r.updatedAt, s.timezone),
      })),
    }],
  }, req.user!.name);
});

daamrReportsRouter.get('/:id', requireAuth, async (req, res) => {
  if (!(await canViewReport(req.user!, String(req.params.id)))) {
    if (!(await prisma.activityReport.count({ where: { id: String(req.params.id) } }))) throw notFound();
    throw forbidden('You do not have access to this report.');
  }
  const r = await prisma.activityReport.findUniqueOrThrow({
    where: { id: String(req.params.id) },
    include: { ...detailInclude, request: { include: { files: { where: { deletedAt: null }, select: fileSelect } } } },
  });
  const requestVisible = r.requestId ? await canViewRequest(req.user!, r.requestId) : false;
  const owner = r.createdById === req.user!.id;
  const expenses = canSeeExpenses(req.user!, [r.createdById, r.request?.requesterId]) || (!!r.requestId && (await isAssignedStaff(req.user!.id, r.requestId)));
  res.json({
    report: { ...r, budget: expenses ? r.budget : null, expenseDetails: expenses ? r.expenseDetails : null, request: r.request && requestVisible ? r.request : r.request ? { id: r.request.id, daamrId: r.request.daamrId, hidden: true } : null },
    verificationTimeline: r.workflowInstanceId ? await buildTimeline(prisma, r.workflowInstanceId) : null,
    requestTimeline: r.request?.workflowInstanceId && requestVisible ? await buildTimeline(prisma, r.request.workflowInstanceId) : null,
    can: {
      ...(await workflowFlags(req.user!, r.workflowInstanceId)),
      edit: (owner || can(req.user, 'workflow.override')) && ['DRAFT', 'RETURNED'].includes(r.reportStatus),
      upload: (owner && ['DRAFT', 'RETURNED'].includes(r.reportStatus)) || can(req.user, 'workflow.override'),
      viewExpenses: expenses,
    },
  });
});

mountWorkflowRoutes(daamrReportsRouter, {
  module: 'DAAMR_REPORT',
  entityType: 'ActivityReport',
  evidenceFk: 'activityReportId',
  async locate(id) {
    const r = await prisma.activityReport.findUnique({ where: { id }, select: { workflowInstanceId: true, daamrId: true } });
    return r ? { instanceId: r.workflowInstanceId, ref: r.daamrId } : null;
  },
  canView: canViewReport,
});

// ───────────── Gallery ─────────────
export const daamrGalleryRouter = Router();
daamrGalleryRouter.get('/', requireAuth, async (req, res) => {
  const { skip, take, page, pageSize } = pageParams({ ...req.query, pageSize: req.query.pageSize ?? 48 });
  const q = req.query;
  const and: any[] = [
    { deletedAt: null, kind: 'PHOTO' },
    { OR: [{ activityRequest: requestScope(req.user!) }, { activityReport: reportScope(req.user!) }] },
  ];
  if (q.category) and.push({ category: String(q.category) });
  if (q.districtId) and.push({ OR: [{ activityRequest: { districtId: String(q.districtId) } }, { activityReport: { districtId: String(q.districtId) } }] });
  if (q.q) {
    const s = String(q.q);
    and.push({ OR: [{ caption: icontains(s) }, { activityRequest: { daamrId: icontains(s) } }, { activityReport: { daamrId: icontains(s) } }, { activityRequest: { subject: icontains(s) } }, { activityReport: { activityName: icontains(s) } }] });
  }
  const range = dateRangeFilter(q.from, q.to);
  if (range) and.push({ createdAt: range });
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.file.findMany({
      where,
      select: { ...fileSelect, activityRequest: { select: { id: true, daamrId: true, subject: true, district: { select: { name: true } } } }, activityReport: { select: { id: true, daamrId: true, activityName: true, district: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.file.count({ where }),
  ]);
  res.json({ rows, total, page, pageSize });
});
