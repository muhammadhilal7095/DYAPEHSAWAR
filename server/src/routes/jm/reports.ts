import { Router } from 'express';
import { z } from 'zod';
import { prisma, icontains, type Tx } from '../../db.js';
import { requireAuth, requirePerm, can } from '../../lib/auth.js';
import { audit, diff } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound, pageParams, parse, zDate, zOptDate, zOptInt, zOptPercent, zOptStr, zPercent, zStr, dateRangeFilter } from '../../lib/http.js';
import { nextId, ID_PREFIX } from '../../lib/ids.js';
import { transact } from '../../lib/notify.js';
import { fileSelect } from '../../lib/files.js';
import { getSettings } from '../../lib/settings.js';
import { sendExport, fmtDate, fmtDateTime, humanize } from '../../lib/export.js';
import { assignFirstLevel, buildTimeline, resubmit, startWorkflow } from '../../workflow/engine.js';
import { mountWorkflowRoutes, workflowFlags, latestEmailStatus } from '../workflowRoutes.js';
import { canViewJmReport, classifySchedule, jmScope, progressDiscrepancies, riskScore } from './common.js';

export const jmReportsRouter = Router();

const SEVERITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const ISSUE_STATUS = ['OPEN', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
const ACTION_STATUS = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED'] as const;
const RISK_STATUS = ['OPEN', 'MONITORING', 'MITIGATED', 'CLOSED'] as const;
const MITIGATION_STATUS = ['PLANNED', 'IN_PROGRESS', 'IMPLEMENTED', 'NOT_EFFECTIVE'] as const;

const body = z
  .object({
    assetId: zStr(40),
    periodFrom: zDate,
    periodTo: zDate,
    inspectionDate: zDate,
    inspectionType: zStr(60),
    // B
    projectStatus: zStr(60),
    currentProgress: zPercent,
    previousProgress: zOptPercent,
    plannedProgress: zOptPercent,
    actualCompletion: zOptPercent,
    expectedCompletionDate: zOptDate,
    revisedCompletionDate: zOptDate,
    delayDays: zOptInt,
    // C / D
    completedSummary: zOptStr(10000),
    plannedSummary: zOptStr(10000),
    expectedNextProgress: zOptPercent,
    completed: z.array(z.object({ description: zStr(2000), completionDate: zOptDate, quantity: zOptStr(200), wasPlanned: z.boolean().default(false) })).max(100).default([]),
    planned: z.array(z.object({ description: zStr(2000), expectedDate: zOptDate, milestone: zOptStr(300), responsible: zOptStr(200), resources: zOptStr(1000) })).max(100).default([]),
    // E
    qualityRating: zStr(40),
    qualityRemarks: zOptStr(5000),
    defectsIdentified: zOptStr(5000),
    workmanshipObservations: zOptStr(5000),
    materialObservations: zOptStr(5000),
    qualityCorrectiveActions: zOptStr(5000),
    qualityCorrectiveDeadline: zOptDate,
    // F
    complianceRating: zStr(40),
    applicableStandards: zOptStr(5000),
    complianceObservations: zOptStr(5000),
    deviations: zOptStr(5000),
    complianceCorrective: zOptStr(5000),
    complianceVerification: zOptStr(5000),
    complianceChecklist: z.array(z.object({ criterion: zStr(300), result: z.enum(['COMPLIANT', 'PARTIAL', 'NON_COMPLIANT', 'NOT_APPLICABLE', 'PENDING']), note: zOptStr(1000) })).max(100).default([]),
    // G
    generalRemarks: zOptStr(5000),
    officerRemarks: zOptStr(5000),
    additionalObs: zOptStr(5000),
    // H
    issues: z.array(z.object({
      id: z.string().optional(), key: z.string().max(60).optional(), description: zStr(2000), category: zStr(60), dateIdentified: zDate, severity: z.enum(SEVERITY),
      responsible: zOptStr(200), recommendedAction: zOptStr(2000), targetDate: zOptDate, status: z.enum(ISSUE_STATUS).default('OPEN'), resolutionRemarks: zOptStr(2000), impactNote: zOptStr(2000),
    })).max(100).default([]),
    // I
    impactDescription: zOptStr(5000),
    scheduleImpact: zOptStr(2000),
    qualityImpact: zOptStr(2000),
    costImpact: zOptStr(2000),
    operationalImpact: zOptStr(2000),
    impactDelayDays: zOptInt,
    impactSeverity: z.union([z.enum(SEVERITY), z.literal(''), z.null()]).optional().transform((v) => v || null),
    // J
    actions: z.array(z.object({
      id: z.string().optional(), issueKey: zOptStr(60), description: zStr(2000), actionType: z.enum(['TAKEN', 'REQUIRED']), responsible: zOptStr(200),
      dateAssigned: zOptDate, targetDate: zOptDate, status: z.enum(ACTION_STATUS).default('OPEN'), completionRemarks: zOptStr(2000),
    })).max(100).default([]),
    // K / L
    risks: z.array(z.object({
      id: z.string().optional(), description: zStr(2000), category: zStr(60), probability: zStr(40), impact: zStr(40), consequences: zOptStr(2000),
      responsible: zOptStr(200), reviewDate: zOptDate, status: z.enum(RISK_STATUS).default('OPEN'),
      mitigations: z.array(z.object({ measures: zStr(2000), preventiveActions: zOptStr(2000), responsible: zOptStr(200), resources: zOptStr(1000), targetDate: zOptDate, status: z.enum(MITIGATION_STATUS).default('PLANNED'), effectiveness: zOptStr(1000) })).max(20).default([]),
    })).max(100).default([]),
    // N
    overallAssessment: zOptStr(5000),
    keyFindings: zOptStr(5000),
    recommendedMeasures: zOptStr(5000),
    priorityActions: zOptStr(5000),
    recommendedDepartment: zOptStr(200),
    recommendedCompletionDate: zOptDate,
    followUpRequired: z.boolean().default(false),
    nextInspectionDate: zOptDate,
    // O
    certConfirmed: z.boolean().optional(),
    submit: z.boolean().optional(),
  })
  .superRefine((b, ctx) => {
    if (b.periodTo < b.periodFrom) ctx.addIssue({ code: 'custom', path: ['periodTo'], message: 'Reporting period end cannot be before its start' });
    if (b.followUpRequired && !b.nextInspectionDate) ctx.addIssue({ code: 'custom', path: ['nextInspectionDate'], message: 'Set the next inspection date' });
    if (b.submit && !b.certConfirmed) ctx.addIssue({ code: 'custom', path: ['certConfirmed'], message: 'You must certify the report before submitting' });
  });
type Body = z.infer<typeof body>;

const SCALARS = [
  'periodFrom', 'periodTo', 'inspectionDate', 'inspectionType', 'projectStatus', 'currentProgress', 'previousProgress', 'plannedProgress', 'actualCompletion',
  'expectedCompletionDate', 'revisedCompletionDate', 'delayDays', 'completedSummary', 'plannedSummary', 'expectedNextProgress', 'qualityRating', 'qualityRemarks',
  'defectsIdentified', 'workmanshipObservations', 'materialObservations', 'qualityCorrectiveActions', 'qualityCorrectiveDeadline', 'complianceRating', 'applicableStandards',
  'complianceObservations', 'deviations', 'complianceCorrective', 'complianceVerification', 'generalRemarks', 'officerRemarks', 'additionalObs', 'impactDescription',
  'scheduleImpact', 'qualityImpact', 'costImpact', 'operationalImpact', 'impactDelayDays', 'impactSeverity', 'overallAssessment', 'keyFindings', 'recommendedMeasures',
  'priorityActions', 'recommendedDepartment', 'recommendedCompletionDate', 'followUpRequired', 'nextInspectionDate',
] as const;

async function validateLookups(b: Body) {
  const need: [string, string, string][] = [
    ['JM_INSPECTION_TYPE', b.inspectionType, 'inspectionType'],
    ['JM_PROJECT_STATUS', b.projectStatus, 'projectStatus'],
    ['JM_QUALITY', b.qualityRating, 'qualityRating'],
    ['JM_COMPLIANCE', b.complianceRating, 'complianceRating'],
    ...b.issues.map((i, n) => ['JM_ISSUE_CATEGORY', i.category, `issues.${n}.category`] as [string, string, string]),
    ...b.risks.flatMap((r, n) => [['JM_RISK_CATEGORY', r.category, `risks.${n}.category`], ['JM_RISK_PROBABILITY', r.probability, `risks.${n}.probability`], ['JM_RISK_IMPACT', r.impact, `risks.${n}.impact`]] as [string, string, string][]),
  ];
  const opts = await prisma.lookupOption.findMany({ where: { group: { in: [...new Set(need.map((n) => n[0]))] } }, select: { group: true, value: true } });
  const ok = new Set(opts.map((o) => `${o.group}:${o.value}`));
  const fields: Record<string, string> = {};
  for (const [g, v, path] of need) if (!ok.has(`${g}:${v}`)) fields[path] = 'Select a valid option';
  if (Object.keys(fields).length) throw badRequest('Please correct the highlighted fields.', { fields });
}

async function writeReport(tx: Tx, reportId: string, assetId: string, b: Body) {
  await tx.jmCompletedActivity.deleteMany({ where: { reportId } });
  if (b.completed.length) await tx.jmCompletedActivity.createMany({ data: b.completed.map((c) => ({ ...c, reportId })) });
  await tx.jmPlannedActivity.deleteMany({ where: { reportId } });
  if (b.planned.length) await tx.jmPlannedActivity.createMany({ data: b.planned.map((p) => ({ ...p, reportId })) });

  // issues: keep ids/codes of existing rows
  const existingIssues = await tx.jmIssue.findMany({ where: { reportId } });
  const keepIssue = new Set(b.issues.map((i) => i.id).filter(Boolean));
  const issueKeyToId = new Map<string, string>();
  for (const i of b.issues) {
    const { id, key, ...data } = i;
    let rowId: string;
    if (id && existingIssues.some((e) => e.id === id)) {
      await tx.jmIssue.update({ where: { id }, data });
      rowId = id;
    } else {
      const created = await tx.jmIssue.create({ data: { ...data, reportId, assetId, issueCode: await nextId(tx, ID_PREFIX.jmIssue) } });
      rowId = created.id;
    }
    if (key) issueKeyToId.set(key, rowId);
    issueKeyToId.set(rowId, rowId);
  }

  const existingActions = await tx.jmAction.findMany({ where: { reportId } });
  const keepAction = new Set(b.actions.map((a) => a.id).filter(Boolean));
  for (const a of existingActions) if (!keepAction.has(a.id)) await tx.jmAction.delete({ where: { id: a.id } });
  for (const e of existingIssues) if (!keepIssue.has(e.id)) await tx.jmIssue.delete({ where: { id: e.id } });
  for (const a of b.actions) {
    const { id, issueKey, ...data } = a;
    const issueId = issueKey ? issueKeyToId.get(issueKey) ?? null : null;
    if (id && existingActions.some((e) => e.id === id)) await tx.jmAction.update({ where: { id }, data: { ...data, issueId } });
    else await tx.jmAction.create({ data: { ...data, issueId, reportId, assetId } });
  }

  const existingRisks = await tx.jmRisk.findMany({ where: { reportId } });
  const keepRisk = new Set(b.risks.map((r) => r.id).filter(Boolean));
  for (const r of existingRisks) if (!keepRisk.has(r.id)) await tx.jmRisk.delete({ where: { id: r.id } });
  for (const r of b.risks) {
    const { id, mitigations, ...data } = r;
    const sc = await riskScore(tx, r.probability, r.impact);
    let riskId: string;
    if (id && existingRisks.some((e) => e.id === id)) {
      await tx.jmRisk.update({ where: { id }, data: { ...data, score: sc.score, level: sc.level } });
      riskId = id;
    } else {
      riskId = (await tx.jmRisk.create({ data: { ...data, score: sc.score, level: sc.level, reportId, assetId, riskCode: await nextId(tx, ID_PREFIX.jmRisk) } })).id;
    }
    await tx.jmMitigation.deleteMany({ where: { riskId } });
    if (mitigations.length) await tx.jmMitigation.createMany({ data: mitigations.map((m) => ({ ...m, riskId })) });
  }
}

function scalarData(b: Body) {
  const out: any = {};
  for (const k of SCALARS) out[k] = (b as any)[k];
  out.complianceChecklist = b.complianceChecklist;
  return out;
}

const fullInclude = {
  asset: { include: { district: true } },
  district: true,
  reportingOfficer: { select: { id: true, name: true, email: true, designation: true } },
  finalReviewer: { select: { id: true, name: true, designation: true } },
  completed: true,
  planned: true,
  issues: { orderBy: { issueCode: 'asc' as const } },
  actions: { include: { issue: { select: { id: true, issueCode: true } }, verifiedBy: { select: { name: true } }, files: { where: { deletedAt: null }, select: fileSelect } } },
  risks: { include: { mitigations: true }, orderBy: { riskCode: 'asc' as const } },
  files: { where: { deletedAt: null }, select: fileSelect, orderBy: { createdAt: 'asc' as const } },
};

function snapshotOf(r: any) {
  const s: any = {};
  for (const k of SCALARS) s[k] = r[k];
  s.assetId = r.assetId;
  s.scheduleClass = r.scheduleClass;
  s.completed = r.completed?.map((c: any) => ({ description: c.description, completionDate: c.completionDate, quantity: c.quantity }));
  s.planned = r.planned?.map((c: any) => ({ description: c.description, expectedDate: c.expectedDate }));
  s.issues = r.issues?.map((i: any) => ({ code: i.issueCode, description: i.description, severity: i.severity, status: i.status }));
  s.actions = r.actions?.map((a: any) => ({ description: a.description, type: a.actionType, status: a.status }));
  s.risks = r.risks?.map((x: any) => ({ code: x.riskCode, description: x.description, level: x.level, score: x.score }));
  return s;
}

async function submitJm(tx: Tx, req: any, id: string) {
  const s = await getSettings();
  const r = await tx.jmReport.findUniqueOrThrow({ where: { id }, include: fullInclude });
  // certification is always by the signed-in reporting officer — never on behalf of someone else
  if (r.reportingOfficerId !== req.user.id) throw forbidden('Only the reporting officer can certify and submit this report.');
  const cert = { certName: req.user.name, certDesignation: req.user.designation, certStatement: s.jmCertificationStatement, certifiedAt: new Date() };
  if (r.status === 'DRAFT') {
    const inst = await startWorkflow(tx, { module: 'JM_REPORT', entityType: 'JmReport', entityId: r.id, entityRef: r.reportNo, districtId: r.districtId, actor: req.user, snapshot: snapshotOf(r) });
    await tx.jmReport.update({ where: { id }, data: { ...cert, workflowInstanceId: inst.id, submittedAt: new Date(), status: 'PENDING_REVIEW' } });
    await assignFirstLevel(tx, inst.id, req.user);
    await audit(tx, req, { action: 'JM_REPORT_SUBMITTED', module: 'JM', entityType: 'JmReport', entityId: id, entityRef: r.reportNo, after: { certifiedBy: cert.certName } });
  } else if (r.status === 'RETURNED') {
    await tx.jmReport.update({ where: { id }, data: { ...cert, version: r.version + 1 } });
    await resubmit(tx, r.workflowInstanceId!, req.user, { entityType: 'JmReport', entityId: id, snapshot: snapshotOf(r) });
    await audit(tx, req, { action: 'JM_REPORT_RESUBMITTED', module: 'JM', entityType: 'JmReport', entityId: id, entityRef: r.reportNo });
  } else throw conflict('This report has already been submitted.');
}

/** Baseline for a new report: latest verified figures and the previously planned activities. */
jmReportsRouter.get('/baseline/:assetId', requireAuth, async (req, res) => {
  const asset = await prisma.jmAsset.findUnique({ where: { id: String(req.params.assetId) }, include: { district: true } });
  if (!asset) throw notFound();
  const last = await prisma.jmReport.findFirst({ where: { assetId: asset.id, status: 'VERIFIED' }, orderBy: { submittedAt: 'desc' }, include: { planned: true } });
  res.json({
    asset,
    previousProgress: last ? last.actualCompletion ?? last.currentProgress : asset.overallProgress,
    lastVerified: last ? { id: last.id, reportNo: last.reportNo, periodTo: last.periodTo, progress: last.currentProgress, scheduleClass: last.scheduleClass, qualityRating: last.qualityRating, expectedNextProgress: last.expectedNextProgress } : null,
    previouslyPlanned: last?.planned ?? [],
  });
});

jmReportsRouter.post('/', requirePerm('jm.report.create'), async (req, res) => {
  const b = parse(body, req.body);
  await validateLookups(b);
  const asset = await prisma.jmAsset.findUnique({ where: { id: b.assetId } });
  if (!asset || !asset.isActive) throw badRequest('Select a registered, active Jawan Markaz asset.', { fields: { assetId: 'Invalid asset' } });
  const s = await getSettings();
  const created = await transact(async (tx) => {
    const reportNo = await nextId(tx, ID_PREFIX.jmReport);
    const sc = classifySchedule({ ...b, delayDays: b.delayDays }, s);
    const progressDuringPeriod = b.previousProgress != null ? Math.round((b.currentProgress - b.previousProgress) * 10) / 10 : null;
    const data = { ...scalarData(b), progressDuringPeriod };
    const r = await tx.jmReport.create({
      data: {
        ...data, reportNo, assetId: asset.id, districtId: asset.districtId, reportingOfficerId: req.user!.id, reportingOfficerEmail: req.user!.email,
        scheduleClass: sc, progressDiscrepancy: progressDiscrepancies(data, sc).length > 0,
      },
    });
    await writeReport(tx, r.id, asset.id, b);
    await audit(tx, req, { action: 'JM_REPORT_CREATED', module: 'JM', entityType: 'JmReport', entityId: r.id, entityRef: reportNo, after: { assetId: asset.id, ...data } });
    if (b.submit) await submitJm(tx, req, r.id);
    return tx.jmReport.findUniqueOrThrow({ where: { id: r.id } });
  });
  res.status(201).json(created);
});

jmReportsRouter.put('/:id', requirePerm('jm.report.create'), async (req, res) => {
  const b = parse(body, req.body);
  const before = await prisma.jmReport.findUnique({ where: { id: String(req.params.id) }, include: fullInclude });
  if (!before) throw notFound();
  if (before.reportingOfficerId !== req.user!.id) throw forbidden('Only the reporting officer can edit this report.');
  if (!['DRAFT', 'RETURNED'].includes(before.status)) throw conflict('This report can no longer be edited.');
  if (b.assetId !== before.assetId && before.status !== 'DRAFT') throw badRequest('The asset cannot be changed after submission.', { fields: { assetId: 'Locked after submission' } });
  await validateLookups(b);
  const asset = await prisma.jmAsset.findUniqueOrThrow({ where: { id: b.assetId } });
  const s = await getSettings();
  const r = await transact(async (tx) => {
    const sc = classifySchedule(b, s);
    const progressDuringPeriod = b.previousProgress != null ? Math.round((b.currentProgress - b.previousProgress) * 10) / 10 : null;
    const data = { ...scalarData(b), progressDuringPeriod };
    await tx.jmReport.update({ where: { id: before.id }, data: { ...data, assetId: asset.id, districtId: asset.districtId, scheduleClass: sc, progressDiscrepancy: progressDiscrepancies(data, sc).length > 0 } });
    await writeReport(tx, before.id, asset.id, b);
    const after = await tx.jmReport.findUniqueOrThrow({ where: { id: before.id }, include: fullInclude });
    const d = diff(snapshotOf(before), snapshotOf(after));
    if (d.changed) await audit(tx, req, { action: 'JM_REPORT_EDITED', module: 'JM', entityType: 'JmReport', entityId: before.id, entityRef: before.reportNo, before: d.before, after: d.after });
    if (b.submit) await submitJm(tx, req, before.id);
    return tx.jmReport.findUniqueOrThrow({ where: { id: before.id } });
  });
  res.json(r);
});

jmReportsRouter.delete('/:id', requirePerm('jm.report.create'), async (req, res) => {
  const r = await prisma.jmReport.findUnique({ where: { id: String(req.params.id) } });
  if (!r) throw notFound();
  if (r.reportingOfficerId !== req.user!.id || r.status !== 'DRAFT') throw forbidden('Only your own drafts can be deleted.');
  await prisma.$transaction(async (tx) => {
    await tx.file.updateMany({ where: { jmReportId: r.id }, data: { deletedAt: new Date(), jmReportId: null } });
    await tx.jmReport.delete({ where: { id: r.id } });
    await audit(tx, req, { action: 'JM_REPORT_DRAFT_DELETED', module: 'JM', entityType: 'JmReport', entityId: r.id, entityRef: r.reportNo });
  });
  res.json({ ok: true });
});

function listWhere(req: any) {
  const q = req.query;
  const and: any[] = [jmScope(req.user)];
  if (q.scope === 'mine') and.push({ reportingOfficerId: req.user.id });
  if (q.scope === 'assigned') and.push({ workflow: { currentAssigneeId: req.user.id, status: 'IN_PROGRESS' } });
  if (q.q) {
    const s = String(q.q).trim();
    and.push({ OR: [{ reportNo: icontains(s) }, { asset: { name: icontains(s) } }, { asset: { assetCode: icontains(s) } }] });
  }
  if (q.districtId) and.push({ districtId: String(q.districtId) });
  if (q.assetId) and.push({ assetId: String(q.assetId) });
  if (q.status) and.push({ status: { in: String(q.status).split(',') } });
  if (q.scheduleClass) and.push({ scheduleClass: String(q.scheduleClass) });
  if (q.qualityRating) and.push({ qualityRating: String(q.qualityRating) });
  const range = dateRangeFilter(q.from, q.to);
  if (range) and.push(q.dateField === 'inspection' ? { inspectionDate: range } : { submittedAt: range });
  return { AND: and };
}

const listInclude = {
  asset: { select: { id: true, assetCode: true, name: true } },
  district: { select: { id: true, name: true } },
  reportingOfficer: { select: { id: true, name: true } },
  workflow: { select: { status: true, currentLevelOrder: true, currentAssignee: { select: { id: true, name: true } }, definition: { select: { levels: { select: { order: true, name: true } } } } } },
  _count: { select: { issues: true, risks: true, files: true } },
};
function shape(r: any) {
  const lvl = r.workflow?.definition.levels.find((l: any) => l.order === r.workflow?.currentLevelOrder);
  return { ...r, workflow: undefined, currentAssignee: r.workflow?.status === 'IN_PROGRESS' ? r.workflow.currentAssignee : null, currentLevel: r.workflow?.status === 'IN_PROGRESS' ? lvl?.name ?? null : null };
}

jmReportsRouter.get('/', requireAuth, async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const where = listWhere(req);
  const [rows, total] = await Promise.all([
    prisma.jmReport.findMany({ where, include: listInclude, orderBy: { updatedAt: 'desc' }, skip, take }),
    prisma.jmReport.count({ where }),
  ]);
  res.json({ rows: rows.map(shape), total, page, pageSize });
});

jmReportsRouter.get('/export', requirePerm('jm.export'), async (req, res) => {
  const s = await getSettings();
  const rows = (await prisma.jmReport.findMany({ where: listWhere(req), include: listInclude, orderBy: { submittedAt: 'desc' }, take: 10000 })).map(shape);
  await audit(prisma, req, { action: 'EXPORT', module: 'JM', entityType: 'JmReport', after: { format: req.query.format, filters: req.query, count: rows.length } });
  await sendExport(res, String(req.query.format ?? 'xlsx'), {
    title: 'Jawan Markaz Monitoring Reports',
    filename: `jm-reports-${new Date().toISOString().slice(0, 10)}`,
    landscape: true,
    meta: [['Period', `${req.query.from || 'Beginning'} to ${req.query.to || 'Today'}`], ['Records', String(rows.length)]],
    sections: [{
      type: 'table',
      columns: [
        { key: 'reportNo', label: 'DAAMR ID', width: 1.3 }, { key: 'reported', label: 'Reporting Date', width: 0.9 }, { key: 'assetName', label: 'Jawan Markaz', width: 1.5 },
        { key: 'district', label: 'District / HQ', width: 1 }, { key: 'period', label: 'Reporting Period', width: 1.4 }, { key: 'inspection', label: 'Inspection', width: 0.9 },
        { key: 'statusP', label: 'Project Status', width: 1.1 }, { key: 'currentProgress', label: 'Prog. %', width: 0.7, align: 'right' }, { key: 'plannedProgress', label: 'Plan %', width: 0.7, align: 'right' },
        { key: 'sched', label: 'Schedule', width: 1 }, { key: 'quality', label: 'Quality', width: 0.9 }, { key: 'compliance', label: 'Compliance', width: 1 },
        { key: 'officer', label: 'Reporting Officer', width: 1.1 }, { key: 'state', label: 'Review Status', width: 0.9 }, { key: 'assignee', label: 'With', width: 1 }, { key: 'updated', label: 'Last Updated', width: 1 },
      ],
      rows: rows.map((r: any) => ({
        ...r, reported: fmtDate(r.submittedAt), assetName: `${r.asset.assetCode} ${r.asset.name}`, district: r.district.name, period: `${fmtDate(r.periodFrom)} – ${fmtDate(r.periodTo)}`,
        inspection: fmtDate(r.inspectionDate), statusP: humanize(r.projectStatus), sched: humanize(r.scheduleClass), quality: humanize(r.qualityRating), compliance: humanize(r.complianceRating),
        officer: r.reportingOfficer.name, state: humanize(r.status), assignee: r.currentAssignee?.name ?? '', updated: fmtDateTime(r.updatedAt, s.timezone),
      })),
    }],
  }, req.user!.name);
});

jmReportsRouter.get('/:id', requireAuth, async (req, res) => {
  if (!(await canViewJmReport(req.user!, String(req.params.id)))) {
    if (!(await prisma.jmReport.count({ where: { id: String(req.params.id) } }))) throw notFound();
    throw forbidden('You do not have access to this report.');
  }
  const r = await prisma.jmReport.findUniqueOrThrow({ where: { id: String(req.params.id) }, include: fullInclude });
  const previous = await prisma.jmReport.findFirst({
    where: { assetId: r.assetId, status: 'VERIFIED', id: { not: r.id }, submittedAt: { lt: r.submittedAt ?? new Date() } },
    orderBy: { submittedAt: 'desc' },
    select: { id: true, reportNo: true, periodFrom: true, periodTo: true, currentProgress: true, scheduleClass: true, qualityRating: true, complianceRating: true, expectedNextProgress: true, planned: true },
  });
  const owner = r.reportingOfficerId === req.user!.id;
  res.json({
    report: r,
    discrepancies: progressDiscrepancies(r, r.scheduleClass),
    previous,
    timeline: r.workflowInstanceId ? await buildTimeline(prisma, r.workflowInstanceId) : null,
    emailStatus: await latestEmailStatus(r.reportNo),
    can: {
      ...(await workflowFlags(req.user!, r.workflowInstanceId)),
      edit: owner && ['DRAFT', 'RETURNED'].includes(r.status),
      delete: owner && r.status === 'DRAFT',
      upload: (owner && ['DRAFT', 'RETURNED'].includes(r.status)) || can(req.user, 'workflow.override'),
      updateRegister: can(req.user, 'jm.register.update'),
    },
  });
});

jmReportsRouter.get('/:id/pdf', requireAuth, async (req, res) => {
  if (!(await canViewJmReport(req.user!, String(req.params.id)))) throw forbidden();
  const s = await getSettings();
  const r = await prisma.jmReport.findUniqueOrThrow({ where: { id: String(req.params.id) }, include: fullInclude });
  const tl = r.workflowInstanceId ? await buildTimeline(prisma, r.workflowInstanceId) : null;
  await audit(prisma, req, { action: 'REPORT_DOWNLOADED', module: 'JM', entityType: 'JmReport', entityId: r.id, entityRef: r.reportNo });
  const t = (k: string, v: any) => [k, v ?? ''] as [string, any];
  const sections: any[] = [
    { type: 'kv', title: 'A. Report identification', items: [t('DAAMR ID', r.reportNo), t('Reporting date', fmtDateTime(r.submittedAt, s.timezone)), t('Reporting officer', `${r.reportingOfficer.name} (${r.reportingOfficerEmail})`), t('District / HQ', r.district.name), t('Asset visited', `${r.asset.assetCode} — ${r.asset.name}`), t('Reporting period', `${fmtDate(r.periodFrom)} – ${fmtDate(r.periodTo)}`), t('Inspection date', fmtDate(r.inspectionDate)), t('Inspection type', humanize(r.inspectionType)), t('Review status', humanize(r.status))] },
    { type: 'kv', title: 'B. Current status of project', items: [t('Project status', humanize(r.projectStatus)), t('Schedule classification', humanize(r.scheduleClass)), t('Current progress', `${r.currentProgress}%`), t('Previous progress', r.previousProgress != null ? `${r.previousProgress}%` : ''), t('Progress during period', r.progressDuringPeriod != null ? `${r.progressDuringPeriod}%` : ''), t('Planned progress', r.plannedProgress != null ? `${r.plannedProgress}%` : ''), t('Actual completion', r.actualCompletion != null ? `${r.actualCompletion}%` : ''), t('Expected completion', fmtDate(r.expectedCompletionDate)), t('Revised completion', fmtDate(r.revisedCompletionDate)), t('Delay (days)', r.delayDays)] },
    { type: 'table', title: 'C. Major activities completed', columns: [{ key: 'description', label: 'Activity', width: 3 }, { key: 'date', label: 'Completed' }, { key: 'quantity', label: 'Quantity / milestone' }, { key: 'planned', label: 'Was planned' }], rows: r.completed.map((c) => ({ ...c, date: fmtDate(c.completionDate), planned: c.wasPlanned ? 'Yes' : 'No' })) },
    { type: 'table', title: 'D. Activities planned', columns: [{ key: 'description', label: 'Activity', width: 3 }, { key: 'date', label: 'Expected' }, { key: 'milestone', label: 'Milestone' }, { key: 'responsible', label: 'Responsible' }], rows: r.planned.map((p) => ({ ...p, date: fmtDate(p.expectedDate) })) },
    { type: 'kv', title: 'E. Quality of work', items: [t('Rating', humanize(r.qualityRating)), t('Remarks', r.qualityRemarks), t('Defects identified', r.defectsIdentified), t('Workmanship', r.workmanshipObservations), t('Material quality', r.materialObservations), t('Corrective actions', r.qualityCorrectiveActions), t('Deadline', fmtDate(r.qualityCorrectiveDeadline))] },
    { type: 'kv', title: 'F. Compliance assessment', items: [t('Rating', humanize(r.complianceRating)), t('Applicable standards', r.applicableStandards), t('Observations', r.complianceObservations), t('Deviations', r.deviations), t('Corrective actions', r.complianceCorrective), t('Verification remarks', r.complianceVerification), ...((r.complianceChecklist as any[]) ?? []).map((c) => t(c.criterion, `${humanize(c.result)}${c.note ? ` — ${c.note}` : ''}`))] },
    { type: 'kv', title: 'G. Remarks', items: [t('General', r.generalRemarks), t('Reporting officer', r.officerRemarks), t('Supervising officer', r.supervisorRemarks), t('Additional observations', r.additionalObs)] },
    { type: 'table', title: 'H. Issues identified', columns: [{ key: 'issueCode', label: 'Issue ID' }, { key: 'description', label: 'Description', width: 2.5 }, { key: 'cat', label: 'Category' }, { key: 'severity', label: 'Severity' }, { key: 'responsible', label: 'Responsible' }, { key: 'target', label: 'Target' }, { key: 'st', label: 'Status' }], rows: r.issues.map((i) => ({ ...i, cat: humanize(i.category), target: fmtDate(i.targetDate), st: humanize(i.status) })) },
    { type: 'kv', title: 'I. Impact on project', items: [t('Description', r.impactDescription), t('Schedule impact', r.scheduleImpact), t('Quality impact', r.qualityImpact), t('Cost impact', r.costImpact), t('Operational impact', r.operationalImpact), t('Estimated delay (days)', r.impactDelayDays), t('Overall severity', humanize(r.impactSeverity))] },
    { type: 'table', title: 'J. Action taken / required', columns: [{ key: 'description', label: 'Action', width: 2.5 }, { key: 'type', label: 'Type' }, { key: 'responsible', label: 'Responsible' }, { key: 'target', label: 'Target' }, { key: 'st', label: 'Status' }], rows: r.actions.map((a) => ({ ...a, type: humanize(a.actionType), target: fmtDate(a.targetDate), st: humanize(a.status) })) },
    { type: 'table', title: 'K/L. Risks and mitigation', columns: [{ key: 'riskCode', label: 'Risk ID' }, { key: 'description', label: 'Risk', width: 2 }, { key: 'pi', label: 'P × I' }, { key: 'lvl', label: 'Level' }, { key: 'mit', label: 'Mitigation', width: 2.5 }, { key: 'st', label: 'Status' }], rows: r.risks.map((x) => ({ ...x, pi: `${humanize(x.probability)} × ${humanize(x.impact)} = ${x.score}`, lvl: humanize(x.level), mit: x.mitigations.map((m) => `${m.measures} (${humanize(m.status)})`).join('; '), st: humanize(x.status) })) },
    { type: 'list', title: 'M. Geo-tagged photographs', items: r.files.filter((f) => f.kind === 'PHOTO').map((f) => `${humanize(f.category)} — ${f.caption ?? f.originalName}${f.latitude != null ? ` @ ${f.latitude.toFixed(5)}, ${f.longitude!.toFixed(5)} (${f.locationSource === 'EXIF' ? 'embedded EXIF GPS' : f.locationSource === 'DEVICE' ? 'device location at upload' : 'manually entered'})` : ' (no location)'}`) },
    { type: 'kv', title: 'N. Assessment / recommendations', items: [t('Overall assessment', r.overallAssessment), t('Key findings', r.keyFindings), t('Recommended corrective measures', r.recommendedMeasures), t('Priority actions', r.priorityActions), t('Responsible department', r.recommendedDepartment), t('Recommended completion', fmtDate(r.recommendedCompletionDate)), t('Follow-up inspection required', r.followUpRequired ? 'Yes' : 'No'), t('Next inspection', fmtDate(r.nextInspectionDate))] },
    { type: 'kv', title: 'O. Certification', items: [t('Reporting officer', r.certName), t('Designation', r.certDesignation), t('Statement', r.certStatement), t('Certified at', fmtDateTime(r.certifiedAt, s.timezone)), t('Reviewer certification', r.finalReviewer ? `${r.finalReviewer.name}${r.finalReviewer.designation ? `, ${r.finalReviewer.designation}` : ''} — ${fmtDateTime(r.finalDecisionAt, s.timezone)}` : 'Pending'), t('Final approval status', humanize(r.status))] },
  ];
  if (tl) sections.push({ type: 'table', title: 'Review history', columns: [{ key: 'at', label: 'Date & time' }, { key: 'action', label: 'Action' }, { key: 'level', label: 'Level' }, { key: 'by', label: 'By' }, { key: 'remarks', label: 'Remarks', width: 2.5 }], rows: tl.history.map((h) => ({ at: fmtDateTime(h.createdAt, s.timezone), action: humanize(h.action), level: h.levelName ?? '', by: h.actorName, remarks: h.remarks ?? '' })) });
  await sendExport(res, 'pdf', { title: `Jawan Markaz Monitoring and Progress Report — ${r.reportNo}`, filename: r.reportNo, sections }, req.user!.name);
});

mountWorkflowRoutes(jmReportsRouter, {
  module: 'JM_REPORT',
  entityType: 'JmReport',
  async locate(id) {
    const r = await prisma.jmReport.findUnique({ where: { id }, select: { workflowInstanceId: true, reportNo: true } });
    return r ? { instanceId: r.workflowInstanceId, ref: r.reportNo } : null;
  },
  canView: canViewJmReport,
});
