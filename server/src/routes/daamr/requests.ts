import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, icontains } from '../../db.js';
import { requireAuth, requirePerm, can, type AuthUser } from '../../lib/auth.js';
import { audit, diff } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound, pageParams, parse, zDate, zMoney, zOptStr, zStr, dateRangeFilter } from '../../lib/http.js';
import { nextId, ID_PREFIX } from '../../lib/ids.js';
import { transact } from '../../lib/notify.js';
import { fileSelect } from '../../lib/files.js';
import { sendExport, fmtDate, fmtDateTime, fmtMoney, humanize, type Section } from '../../lib/export.js';
import { getSettings } from '../../lib/settings.js';
import { assignFirstLevel, buildTimeline, resubmit, startWorkflow } from '../../workflow/engine.js';
import { mountWorkflowRoutes, workflowFlags, latestEmailStatus } from '../workflowRoutes.js';
import {
  canViewRequest, requestScope, requestSnapshot, EXECUTION_STATUS, LIFECYCLE, PRIORITIES, ACTIVE_ASSIGNMENT, DEMOGRAPHIC_FIELDS,
  overdueWhere, unassignedWhere, canSeeExpenses, todayUtc, isAssignedStaff,
} from './common.js';

export const daamrRequestsRouter = Router();

const zTime = z
  .union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)'), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
const zOptCount = z
  .union([z.coerce.number({ invalid_type_error: 'Enter a number' }).int('Must be a whole number').min(0, 'Cannot be negative').max(1_000_000), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined || v === null ? null : Number(v)));

const baseBody = {
  requesteeEmail: z.string().trim().toLowerCase().email('Enter a valid email'),
  districtId: zStr(40),
  departmentId: zOptStr(40),
  category: zOptStr(80),
  startDate: zDate,
  endDate: zDate,
  startTime: zTime,
  endTime: zTime,
  province: z.string().trim().max(80).default('Khyber Pakhtunkhwa').transform((v) => v || 'Khyber Pakhtunkhwa'),
  tehsil: zOptStr(120),
  targetAudience: zOptStr(500),
  expectedParticipants: zOptCount,
  priority: z.enum(PRIORITIES).default('NORMAL'),
  activityType: z.enum(['EVENT', 'COURSE']).default('EVENT'),
  trainingDays: z
    .union([z.coerce.number().int('Must be a whole number').min(1, 'At least 1 day').max(365, 'At most 365 days'), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v === undefined || v === null ? null : Number(v))),
  deliveryFormat: z.union([z.enum(['IN_PERSON', 'ONLINE', 'BLENDED']), z.literal(''), z.null()]).optional().transform((v) => v || null),
  methodology: zOptStr(5000),
  proposedTrainers: z
    .array(z.object({ name: zStr(150), designation: zOptStr(150), expertise: zOptStr(300), userId: zOptStr(40) }))
    .max(30)
    .optional()
    .nullable()
    .transform((v) => (v?.length ? v : null)),
  submit: z.boolean().optional(),
};
const courseOk = (b: any) => b.activityType !== 'COURSE' || !!b.proposedTrainers?.length;
const courseDaysOk = (b: any) => b.activityType !== 'COURSE' || !!b.trainingDays;
const datesOk = (b: { startDate: Date; endDate: Date }) => b.endDate >= b.startDate;
const timesOk = (b: { startDate: Date; endDate: Date; startTime: string | null; endTime: string | null }) =>
  !(b.startTime && b.endTime && b.startDate.getTime() === b.endDate.getTime() && b.endTime <= b.startTime);
const submitBody = z
  .object({
    ...baseBody,
    subject: zStr(250),
    area: zStr(250),
    description: zStr(10000),
    objectives: zStr(5000),
    venue: zStr(300),
    venueAddress: zStr(500),
    proposedBudget: zMoney,
  })
  .refine(datesOk, { path: ['endDate'], message: 'End date cannot be before start date' })
  .refine(timesOk, { path: ['endTime'], message: 'End time must be after the start time' })
  .refine(courseDaysOk, { path: ['trainingDays'], message: 'Enter the number of training days' })
  .refine(courseOk, { path: ['proposedTrainers'], message: 'Add at least one trainer for the course' });
const draftBody = z
  .object({
    ...baseBody,
    subject: zStr(250),
    area: z.string().trim().max(250).default(''),
    description: z.string().trim().max(10000).default(''),
    objectives: zOptStr(5000),
    venue: z.string().trim().max(300).default(''),
    venueAddress: zOptStr(500),
    proposedBudget: zMoney.default(0),
  })
  .refine(datesOk, { path: ['endDate'], message: 'End date cannot be before start date' })
  .refine(timesOk, { path: ['endTime'], message: 'End time must be after the start time' });

// ───────────── Listing, search & filters ─────────────

export function activityListWhere(user: AuthUser, q: any) {
  const and: any[] = [requestScope(user)];
  if (q.scope === 'mine') and.push({ requesterId: user.id });
  if (q.scope === 'assigned') and.push({ OR: [{ workflow: { currentAssigneeId: user.id, status: 'IN_PROGRESS' } }, { report: { workflow: { currentAssigneeId: user.id, status: 'IN_PROGRESS' } } }] });
  if (q.scope === 'staff') and.push({ assignments: { some: { assigneeId: user.id, status: { not: 'CANCELLED' } } } });
  if (q.q) {
    const s = String(q.q).trim();
    const lc = LIFECYCLE.filter((l) => humanize(l).toLowerCase().includes(s.toLowerCase()));
    and.push({
      OR: [
        { daamrId: icontains(s) }, { subject: icontains(s) }, { area: icontains(s) }, { requesteeEmail: icontains(s) }, { venue: icontains(s) },
        { venueAddress: icontains(s) }, { tehsil: icontains(s) }, { district: { name: icontains(s) } }, { department: { name: icontains(s) } },
        { requester: { name: icontains(s) } }, { assignments: { some: { status: { not: 'CANCELLED' }, assignee: { name: icontains(s) } } } },
        ...(lc.length ? [{ lifecycle: { in: lc } }] : []),
      ],
    });
  }
  if (q.districtId) and.push({ districtId: String(q.districtId) });
  if (q.departmentId) and.push({ departmentId: String(q.departmentId) });
  if (q.status) and.push({ status: { in: String(q.status).split(',') } });
  if (q.lifecycle) and.push({ lifecycle: { in: String(q.lifecycle).split(',') } });
  if (q.priority) and.push({ priority: String(q.priority) });
  if (q.executionStatus) and.push({ executionStatus: String(q.executionStatus) });
  if (q.officerId) and.push({ OR: [{ workflow: { currentAssigneeId: String(q.officerId), status: 'IN_PROGRESS' } }, { report: { workflow: { currentAssigneeId: String(q.officerId), status: 'IN_PROGRESS' } } }] });
  if (q.assigneeId) and.push({ assignments: { some: { assigneeId: String(q.assigneeId), status: { not: 'CANCELLED' } } } });
  if (q.level) and.push({ workflow: { currentLevelOrder: Number(q.level), status: 'IN_PROGRESS' } });
  if (q.category) and.push({ category: String(q.category) });
  if (q.overdue === '1' || q.overdue === 'true') and.push(overdueWhere());
  if (q.unassigned === '1' || q.unassigned === 'true') and.push(unassignedWhere());
  const range = dateRangeFilter(q.from, q.to);
  if (range) and.push(q.dateField === 'submitted' ? { submittedAt: range } : q.dateField === 'created' ? { createdAt: range } : { startDate: range });
  return { AND: and };
}

const listInclude = {
  district: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  requester: { select: { id: true, name: true } },
  assignments: {
    where: { status: { not: 'CANCELLED' } },
    select: { id: true, isLead: true, status: true, deadline: true, assignee: { select: { id: true, name: true, designation: true } } },
    orderBy: [{ isLead: 'desc' as const }, { createdAt: 'asc' as const }],
  },
  workflow: {
    select: {
      id: true, status: true, currentLevelOrder: true, currentAssignedAt: true,
      currentAssignee: { select: { id: true, name: true, designation: true } },
      definition: { select: { levels: { select: { order: true, name: true }, orderBy: { order: 'asc' as const } } } },
    },
  },
  report: {
    select: {
      id: true, reportNo: true, reportStatus: true,
      workflow: {
        select: {
          status: true, currentLevelOrder: true,
          currentAssignee: { select: { id: true, name: true, designation: true } },
          definition: { select: { levels: { select: { order: true, name: true }, orderBy: { order: 'asc' as const } } } },
        },
      },
    },
  },
};

function stageOf(wf: any) {
  if (!wf || wf.status !== 'IN_PROGRESS') return null;
  const levels = wf.definition?.levels ?? [];
  const lvl = levels.find((l: any) => l.order === wf.currentLevelOrder);
  return { label: lvl ? `${lvl.order}/${levels.length} · ${lvl.name}` : null, officer: wf.currentAssignee ?? null };
}

export function shapeActivity(r: any) {
  const now = new Date();
  const plan = stageOf(r.workflow);
  const rep = stageOf(r.report?.workflow);
  const active = (r.assignments ?? []).filter((a: any) => ACTIVE_ASSIGNMENT.includes(a.status));
  const deadlines = active.map((a: any) => a.deadline).filter(Boolean).sort((a: Date, b: Date) => a.getTime() - b.getTime());
  const open = !['COMPLETED', 'REJECTED', 'CANCELLED', 'DRAFT'].includes(r.lifecycle);
  const lead = r.assignments?.[0]?.assignee ?? null;
  return {
    ...r,
    workflow: undefined,
    report: r.report ? { id: r.report.id, reportNo: r.report.reportNo, reportStatus: r.report.reportStatus } : null,
    leadOfficer: lead,
    staff: (r.assignments ?? []).map((a: any) => a.assignee),
    staffCount: r.assignments?.length ?? 0,
    nextDeadline: deadlines[0] ?? null,
    overdue: open && (r.endDate < todayUtc() || deadlines.some((d: Date) => d < now)),
    currentAssignee: (rep ?? plan)?.officer ?? null,
    currentLevel: rep ? `Report ${rep.label}` : plan?.label ?? null,
    pendingAssignment: (r.workflow?.status === 'IN_PROGRESS' && !r.workflow?.currentAssignee) || (r.report?.workflow?.status === 'IN_PROGRESS' && !r.report.workflow.currentAssignee),
    instanceId: r.workflow?.id ?? null,
  };
}

const SORTS: Record<string, any> = {
  submittedAt: { submittedAt: 'desc' }, '-submittedAt': { submittedAt: 'asc' },
  startDate: { startDate: 'desc' }, '-startDate': { startDate: 'asc' },
  updatedAt: { updatedAt: 'desc' }, daamrId: { daamrId: 'asc' }, createdAt: { createdAt: 'desc' },
};

daamrRequestsRouter.get('/', requireAuth, async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const where = activityListWhere(req.user!, req.query);
  const [rows, total] = await Promise.all([
    prisma.activityRequest.findMany({ where, include: listInclude, orderBy: SORTS[String(req.query.sort)] ?? { updatedAt: 'desc' }, skip, take }),
    prisma.activityRequest.count({ where }),
  ]);
  const expenses = can(req.user, 'daamr.expense.view');
  res.json({ rows: rows.map(shapeActivity).map((r) => (expenses || r.requesterId === req.user!.id ? r : { ...r, proposedBudget: null })), total, page, pageSize });
});

// ───────────── Exports: summary PDF, multi-sheet Excel workbook, CSV ─────────────

function filterLabel(q: any, lookups: { districts: Map<string, string>; users: Map<string, string>; departments: Map<string, string> }) {
  const parts: [string, string][] = [['Activity period', `${q.from || 'Beginning'} to ${q.to || 'Today'}${q.dateField === 'submitted' ? ' (by submission date)' : q.dateField === 'created' ? ' (by creation date)' : ' (by start date)'}`]];
  if (q.districtId) parts.push(['District / HQ', lookups.districts.get(String(q.districtId)) ?? '—']);
  if (q.departmentId) parts.push(['Department', lookups.departments.get(String(q.departmentId)) ?? '—']);
  if (q.category) parts.push(['Category', humanize(String(q.category))]);
  if (q.assigneeId) parts.push(['Assigned officer', lookups.users.get(String(q.assigneeId)) ?? '—']);
  if (q.lifecycle) parts.push(['Status', String(q.lifecycle).split(',').map(humanize).join(', ')]);
  if (q.status) parts.push(['Approval status', String(q.status).split(',').map(humanize).join(', ')]);
  if (q.level) parts.push(['Approval stage', `Level ${q.level}`]);
  if (q.priority) parts.push(['Priority', humanize(String(q.priority))]);
  if (q.overdue) parts.push(['Only', 'Overdue activities']);
  if (q.unassigned) parts.push(['Only', 'Activities awaiting staff assignment']);
  if (q.q) parts.push(['Search', String(q.q)]);
  return parts;
}

daamrRequestsRouter.get('/export', requirePerm('daamr.export'), async (req, res) => {
  const s = await getSettings();
  const format = String(req.query.format ?? 'xlsx');
  const expenses = can(req.user, 'daamr.expense.view');
  const where = activityListWhere(req.user!, req.query);
  const raw = await prisma.activityRequest.findMany({
    where,
    include: {
      ...listInclude,
      assignments: { include: { assignee: { select: { id: true, name: true, designation: true } }, assignedBy: { select: { name: true } } }, orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }] },
      report: { include: { participants: true, budget: true, workflow: { select: { status: true, currentLevelOrder: true, currentAssignee: { select: { id: true, name: true, designation: true } }, definition: { select: { levels: { select: { order: true, name: true }, orderBy: { order: 'asc' } } } } } } } },
    },
    orderBy: { startDate: 'desc' },
    take: 10000,
  });
  const rows = raw.map((r) => ({ raw: r, s: shapeActivity({ ...r, assignments: r.assignments.filter((a) => a.status !== 'CANCELLED') }) }));
  const [districts, users, departments] = await Promise.all([prisma.district.findMany({ select: { id: true, name: true } }), prisma.user.findMany({ select: { id: true, name: true } }), prisma.department.findMany({ select: { id: true, name: true } })]);
  const meta = filterLabel(req.query, { districts: new Map(districts.map((d) => [d.id, d.name])), users: new Map(users.map((u) => [u.id, u.name])), departments: new Map(departments.map((d) => [d.id, d.name])) });
  meta.push(['Records', String(rows.length)]);
  await audit(prisma, req, { action: 'EXPORT', module: 'DAAMR', entityType: 'ActivityRequest', after: { format, filters: req.query, count: rows.length } });

  const summaryCols = [
    { key: 'daamrId', label: 'Activity ID', width: 1.3 }, { key: 'subject', label: 'Activity Title', width: 2.2 }, { key: 'cat', label: 'Category', width: 1 },
    { key: 'district', label: 'District / HQ', width: 1.1 }, { key: 'start', label: 'Start', width: 0.9, format: 'date' as const }, { key: 'end', label: 'End', width: 0.9, format: 'date' as const },
    { key: 'lead', label: 'Responsible Officer', width: 1.3 }, { key: 'stage', label: 'Current Stage', width: 1.5 }, { key: 'reviewer', label: 'With', width: 1.2 },
    { key: 'lifecycleLabel', label: 'Status', width: 1 }, { key: 'priorityLabel', label: 'Priority', width: 0.7 }, { key: 'overdueLabel', label: 'Overdue', width: 0.6 },
  ];
  const summaryRows = rows.map(({ s: r }) => ({
    daamrId: r.daamrId, subject: r.subject, cat: humanize(r.category), district: r.district.name, start: r.startDate, end: r.endDate,
    lead: r.leadOfficer?.name ?? 'Not assigned', stage: r.currentLevel ?? '', reviewer: r.currentAssignee?.name ?? (r.pendingAssignment ? 'Pending assignment' : ''),
    lifecycleLabel: humanize(r.lifecycle), priorityLabel: humanize(r.priority), overdueLabel: r.overdue ? 'Yes' : '',
  }));

  if (format === 'pdf') {
    const counts = LIFECYCLE.map((l) => [humanize(l), rows.filter((x) => x.s.lifecycle === l).length] as [string, number]).filter(([, n]) => n > 0);
    return sendExport(res, 'pdf', {
      title: 'Activities Summary Report',
      filename: `activities-summary-${new Date().toISOString().slice(0, 10)}`,
      landscape: true,
      meta,
      sections: [
        { type: 'kv', title: 'Summary', items: [['Total activities', rows.length], ...counts, ['Overdue', rows.filter((x) => x.s.overdue).length], ['Awaiting staff assignment', rows.filter((x) => !x.s.staffCount && !['COMPLETED', 'REJECTED', 'CANCELLED'].includes(x.s.lifecycle)).length]] },
        { type: 'table', title: 'Activities', columns: summaryCols, rows: summaryRows },
      ],
    }, req.user!.name);
  }
  if (format === 'csv') {
    return sendExport(res, 'csv', { title: 'Activities Summary', filename: `activities-${new Date().toISOString().slice(0, 10)}`, sections: [{ type: 'table', columns: summaryCols, rows: summaryRows }] }, req.user!.name);
  }

  // Excel workbook: one sheet per record type, one row per record
  const instIds = rows.flatMap(({ raw }) => [raw.workflowInstanceId, raw.report?.workflowInstanceId]).filter(Boolean) as string[];
  const history = instIds.length
    ? await prisma.approvalHistory.findMany({ where: { instanceId: { in: instIds } }, orderBy: { createdAt: 'asc' }, include: { instance: { select: { module: true, entityRef: true } } } })
    : [];
  const subjectByRef = new Map(rows.map(({ raw }) => [raw.daamrId, raw.subject]));
  const sections: Section[] = [
    { type: 'table', title: 'Activities Summary', columns: summaryCols, rows: summaryRows },
    {
      type: 'table', title: 'Activity Details',
      columns: [
        { key: 'daamrId', label: 'Activity ID', width: 1.3 }, { key: 'subject', label: 'Title', width: 2 }, { key: 'cat', label: 'Category' }, { key: 'description', label: 'Description', width: 3 },
        { key: 'objectives', label: 'Objectives', width: 3 }, { key: 'targetAudience', label: 'Target Audience', width: 1.5 }, { key: 'expectedParticipants', label: 'Expected Participants', format: 'number' },
        { key: 'start', label: 'Start Date', format: 'date' }, { key: 'startTime', label: 'Start Time', width: 0.6 }, { key: 'end', label: 'End Date', format: 'date' }, { key: 'endTime', label: 'End Time', width: 0.6 },
        { key: 'province', label: 'Province', width: 1.2 }, { key: 'district', label: 'District / HQ' }, { key: 'tehsil', label: 'Tehsil' }, { key: 'area', label: 'Location', width: 1.3 },
        { key: 'venue', label: 'Venue Name', width: 1.5 }, { key: 'venueAddress', label: 'Venue Address', width: 2 }, ...(expenses ? [{ key: 'budget', label: 'Estimated Budget (PKR)', format: 'money' as const }] : []),
        { key: 'department', label: 'Responsible Department', width: 1.5 }, { key: 'createdBy', label: 'Created By', width: 1.2 }, { key: 'created', label: 'Created On', format: 'datetime' },
        { key: 'submitted', label: 'Submitted On', format: 'datetime' }, { key: 'approved', label: 'Approved On', format: 'datetime' }, { key: 'completed', label: 'Completed On', format: 'datetime' },
        { key: 'priorityLabel', label: 'Priority' }, { key: 'approvalLabel', label: 'Approval Status' }, { key: 'lifecycleLabel', label: 'Overall Status' },
      ],
      rows: rows.map(({ raw: r, s }) => ({
        ...r, cat: humanize(r.category), start: r.startDate, end: r.endDate, district: r.district.name, budget: r.proposedBudget, department: r.department?.name ?? '',
        createdBy: r.requester.name, created: r.createdAt, submitted: r.submittedAt, approved: r.approvedAt, completed: r.completedAt,
        priorityLabel: humanize(r.priority), approvalLabel: humanize(r.status), lifecycleLabel: humanize(s.lifecycle),
      })),
    },
    {
      type: 'table', title: 'Staff Assignments',
      columns: [
        { key: 'daamrId', label: 'Activity ID', width: 1.3 }, { key: 'subject', label: 'Activity', width: 2 }, { key: 'staff', label: 'Assigned Staff', width: 1.4 }, { key: 'designation', label: 'Designation', width: 1.3 },
        { key: 'role', label: 'Role' }, { key: 'responsibilities', label: 'Responsibilities', width: 3 }, { key: 'instructions', label: 'Instructions', width: 2.5 }, { key: 'reviewRequirements', label: 'Review Requirements', width: 2 },
        { key: 'priorityLabel', label: 'Priority' }, { key: 'deadline', label: 'Deadline', format: 'date' }, { key: 'statusLabel', label: 'Status' }, { key: 'assignedBy', label: 'Assigned By', width: 1.2 },
        { key: 'assignedOn', label: 'Assigned On', format: 'datetime' }, { key: 'completedOn', label: 'Completed On', format: 'datetime' }, { key: 'statusRemarks', label: 'Remarks', width: 2 },
      ],
      rows: rows.flatMap(({ raw: r }) => r.assignments.map((a) => ({
        daamrId: r.daamrId, subject: r.subject, staff: a.assignee.name, designation: a.assignee.designation ?? '', role: a.isLead ? 'Lead (responsible officer)' : 'Supporting',
        responsibilities: a.responsibilities, instructions: a.instructions ?? '', reviewRequirements: a.reviewRequirements ?? '', priorityLabel: humanize(a.priority), deadline: a.deadline,
        statusLabel: humanize(a.status), assignedBy: a.assignedBy.name, assignedOn: a.createdAt, completedOn: a.completedAt, statusRemarks: a.statusRemarks ?? '',
      }))),
    },
    {
      type: 'table', title: 'Review History',
      columns: [
        { key: 'ref', label: 'Activity ID', width: 1.3 }, { key: 'subject', label: 'Activity', width: 2 }, { key: 'stage', label: 'Review Stage', width: 1.4 }, { key: 'cycle', label: 'Cycle', format: 'number', width: 0.5 },
        { key: 'level', label: 'Level', width: 1.4 }, { key: 'action', label: 'Decision / Event', width: 1.2 }, { key: 'by', label: 'Reviewer', width: 1.3 }, { key: 'role', label: 'Designation', width: 1.3 },
        { key: 'at', label: 'Date & Time', format: 'datetime' }, { key: 'remarks', label: 'Comments', width: 3 }, { key: 'evidence', label: 'Evidence', width: 1.8 },
      ],
      rows: history.map((h) => ({
        ref: h.instance.entityRef, subject: subjectByRef.get(h.instance.entityRef) ?? '', stage: h.instance.module === 'DAAMR_REPORT' ? 'Execution report verification' : 'Activity plan review', cycle: h.cycle,
        level: h.levelName ?? '', action: humanize(h.action), by: `${h.actorName}${h.targetUserName ? ` → ${h.targetUserName}` : ''}`, role: h.actorDesignation ?? '', at: h.createdAt, remarks: h.remarks ?? '',
        evidence: ((h.data as any)?.evidence ?? []).map((e: any) => e.name).join(', '),
      })),
    },
    {
      type: 'table', title: 'Execution Reports',
      columns: [
        { key: 'daamrId', label: 'Activity ID', width: 1.3 }, { key: 'reportNo', label: 'Report No.', width: 1.1 }, { key: 'date', label: 'Actual Date', format: 'date' }, { key: 'venue', label: 'Actual Venue', width: 1.5 },
        { key: 'description', label: 'Activities Conducted', width: 3 }, { key: 'responsibleOfficer', label: 'Responsible Officer', width: 1.3 },
        ...(expenses ? [{ key: 'alloc', label: 'Allocated (PKR)', format: 'money' as const }, { key: 'util', label: 'Utilized (PKR)', format: 'money' as const }, { key: 'expenseDetails', label: 'Expense Details', width: 2.5 }] : []),
        { key: 'remarks', label: 'Staff Remarks', width: 2 }, { key: 'statusLabel', label: 'Report Status' }, { key: 'submitted', label: 'Submitted On', format: 'datetime' }, { key: 'verified', label: 'Verified On', format: 'datetime' },
      ],
      rows: rows.filter(({ raw }) => raw.report).map(({ raw: r }) => {
        const p = r.report!;
        return {
          daamrId: r.daamrId, reportNo: p.reportNo, date: p.activityDate, venue: p.venue, description: p.description, responsibleOfficer: p.responsibleOfficer, alloc: p.budget?.allocated ?? null,
          util: p.budget?.utilized ?? null, expenseDetails: p.expenseDetails ?? '', remarks: p.remarks ?? '', statusLabel: humanize(p.reportStatus), submitted: p.submittedAt, verified: p.verifiedAt,
        };
      }),
    },
    {
      type: 'table', title: 'Participants and Outcomes',
      columns: [
        { key: 'daamrId', label: 'Activity ID', width: 1.3 }, { key: 'subject', label: 'Activity', width: 2 }, { key: 'district', label: 'District / HQ' }, { key: 'expected', label: 'Expected', format: 'number' },
        ...DEMOGRAPHIC_FIELDS.map((f) => ({ key: f, label: humanize(f), format: 'number' as const, width: 0.7 })), { key: 'total', label: 'Total Participants', format: 'number' },
        { key: 'achievements', label: 'Achievements & Outcomes', width: 3 }, { key: 'challenges', label: 'Challenges Faced', width: 2.5 }, { key: 'recommendations', label: 'Recommendations', width: 2.5 },
      ],
      rows: rows.filter(({ raw }) => raw.report).map(({ raw: r }) => ({
        daamrId: r.daamrId, subject: r.subject, district: r.district.name, expected: r.expectedParticipants, ...(r.report!.participants ?? {}),
        achievements: r.report!.achievements ?? '', challenges: r.report!.challenges ?? '', recommendations: r.report!.recommendations ?? '',
      })),
    },
  ];
  await sendExport(res, 'xlsx', { title: 'Activities', filename: `activities-${new Date().toISOString().slice(0, 10)}`, meta, sections }, req.user!.name);
});

// ───────────── Create / edit / submit ─────────────

async function loadForEdit(req: any) {
  const r = await prisma.activityRequest.findUnique({ where: { id: String(req.params.id) } });
  if (!r) throw notFound();
  if (r.requesterId !== req.user.id) throw forbidden('Only the activity creator can edit this activity.');
  if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('This activity can no longer be edited.');
  return r;
}

async function validateRefs(b: { districtId: string; departmentId: string | null; category: string | null }) {
  const d = await prisma.district.findFirst({ where: { id: b.districtId, isActive: true } });
  if (!d) throw badRequest('Select a valid district / HQ.', { fields: { districtId: 'Invalid district' } });
  if (b.departmentId && !(await prisma.department.count({ where: { id: b.departmentId, isActive: true } }))) throw badRequest('Invalid department.', { fields: { departmentId: 'Invalid department' } });
  if (b.category && !(await prisma.lookupOption.count({ where: { group: 'ACTIVITY_CATEGORY', value: b.category, isActive: true } }))) throw badRequest('Invalid category.', { fields: { category: 'Invalid category' } });
}

daamrRequestsRouter.post('/', requirePerm('daamr.request.create'), async (req, res) => {
  const submit = !!req.body?.submit;
  const b = parse(submit ? submitBody : draftBody, req.body);
  await validateRefs(b);
  const created = await transact(async (tx) => {
    const daamrId = await nextId(tx, ID_PREFIX.daamrRequest);
    const { submit: _s, ...data } = b;
    let r = await tx.activityRequest.create({ data: { ...data, proposedTrainers: data.proposedTrainers ?? Prisma.DbNull, daamrId, requesterId: req.user!.id, updatedById: req.user!.id, status: 'DRAFT', lifecycle: 'DRAFT' } });
    await audit(tx, req, { action: 'REQUEST_CREATED', module: 'DAAMR', entityType: 'ActivityRequest', entityId: r.id, entityRef: daamrId, after: data });
    if (submit) r = await doSubmit(tx, req, r.id);
    return r;
  });
  res.status(201).json(created);
});

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function doSubmit(tx: any, req: any, id: string) {
  const r = await tx.activityRequest.findUniqueOrThrow({ where: { id } });
  parse(submitBody, { ...r, startDate: isoDay(r.startDate), endDate: isoDay(r.endDate), departmentId: r.departmentId ?? '', category: r.category ?? '', proposedTrainers: r.proposedTrainers ?? null });
  if (r.status === 'DRAFT') {
    const inst = await startWorkflow(tx, { module: 'DAAMR_REQUEST', entityType: 'ActivityRequest', entityId: r.id, entityRef: r.daamrId, districtId: r.districtId, actor: req.user, snapshot: requestSnapshot(r) });
    await tx.activityRequest.update({ where: { id: r.id }, data: { workflowInstanceId: inst.id, submittedAt: new Date(), status: 'PENDING_REVIEW', lifecycle: 'UNDER_REVIEW' } });
    await assignFirstLevel(tx, inst.id, req.user);
    await audit(tx, req, { action: 'REQUEST_SUBMITTED', module: 'DAAMR', entityType: 'ActivityRequest', entityId: r.id, entityRef: r.daamrId });
  } else if (r.status === 'RETURNED') {
    await tx.activityRequest.update({ where: { id: r.id }, data: { version: r.version + 1 } });
    await resubmit(tx, r.workflowInstanceId!, req.user, { entityType: 'ActivityRequest', entityId: r.id, snapshot: requestSnapshot(r), remarks: req.body?.resubmitRemarks ?? null });
    await audit(tx, req, { action: 'REQUEST_RESUBMITTED', module: 'DAAMR', entityType: 'ActivityRequest', entityId: r.id, entityRef: r.daamrId, after: { version: r.version + 1 } });
  } else throw conflict('This activity has already been submitted.');
  return tx.activityRequest.findUniqueOrThrow({ where: { id } });
}

daamrRequestsRouter.put('/:id', requirePerm('daamr.request.create'), async (req, res) => {
  const before = await loadForEdit(req);
  const submit = !!req.body?.submit;
  const b = parse(submit ? submitBody : draftBody, req.body);
  await validateRefs(b);
  if (before.status === 'RETURNED' && b.districtId !== before.districtId) throw badRequest('District / HQ cannot be changed after submission.', { fields: { districtId: 'Locked after submission' } });
  const r = await transact(async (tx) => {
    const { submit: _s, ...data } = b;
    await tx.activityRequest.update({ where: { id: before.id }, data: { ...data, proposedTrainers: data.proposedTrainers ?? Prisma.DbNull, updatedById: req.user!.id } });
    const d = diff(requestSnapshot(before), requestSnapshot({ ...before, ...data }));
    if (d.changed) await audit(tx, req, { action: 'REQUEST_EDITED', module: 'DAAMR', entityType: 'ActivityRequest', entityId: before.id, entityRef: before.daamrId, before: d.before, after: d.after });
    return submit ? doSubmit(tx, req, before.id) : tx.activityRequest.findUniqueOrThrow({ where: { id: before.id } });
  });
  res.json(r);
});

daamrRequestsRouter.post('/:id/submit', requirePerm('daamr.request.create'), async (req, res) => {
  const before = await loadForEdit(req);
  const r = await transact((tx) => doSubmit(tx, req, before.id));
  res.json(r);
});

daamrRequestsRouter.delete('/:id', requirePerm('daamr.request.create'), async (req, res) => {
  const r = await loadForEdit(req);
  if (r.status !== 'DRAFT') throw conflict('Only drafts can be deleted.');
  await prisma.$transaction(async (tx) => {
    const asg = await tx.activityAssignment.findMany({ where: { activityId: r.id }, select: { id: true } });
    await tx.file.updateMany({ where: { OR: [{ activityRequestId: r.id }, { activityAssignmentId: { in: asg.map((a) => a.id) } }] }, data: { deletedAt: new Date(), activityRequestId: null, activityAssignmentId: null } });
    await tx.activityRequest.delete({ where: { id: r.id } });
    await audit(tx, req, { action: 'REQUEST_DRAFT_DELETED', module: 'DAAMR', entityType: 'ActivityRequest', entityId: r.id, entityRef: r.daamrId, before: requestSnapshot(r) });
  });
  res.json({ ok: true });
});

// ───────────── Detail ─────────────

async function guardView(user: AuthUser, id: string) {
  if (!(await canViewRequest(user, id))) {
    if (!(await prisma.activityRequest.count({ where: { id } }))) throw notFound();
    throw forbidden('You do not have access to this activity.');
  }
}

const assignmentInclude = {
  assignee: { select: { id: true, name: true, email: true, designation: true, district: { select: { name: true } } } },
  assignedBy: { select: { id: true, name: true, designation: true } },
  files: { where: { deletedAt: null }, select: fileSelect, orderBy: { createdAt: 'asc' as const } },
};

/** Things that still need to happen for the activity, in plain language. */
function outstandingActions(r: any, planTl: any, reportTl: any) {
  const out: { text: string; tone: 'info' | 'warning' | 'danger' }[] = [];
  const now = new Date();
  const active = r.assignments.filter((a: any) => ACTIVE_ASSIGNMENT.includes(a.status));
  if (r.lifecycle === 'DRAFT') out.push({ text: `${r.requester.name} to complete the activity details and submit it for review.`, tone: 'info' });
  if (!r.assignments.some((a: any) => a.status !== 'CANCELLED') && !['COMPLETED', 'REJECTED', 'CANCELLED'].includes(r.lifecycle)) out.push({ text: 'Assign a responsible staff member to this activity.', tone: 'warning' });
  if (r.lifecycle === 'CHANGES_REQUESTED') {
    const last = [...(reportTl?.history ?? planTl?.history ?? [])].reverse().find((h: any) => h.action === 'RETURNED');
    const who = r.report?.reportStatus === 'RETURNED' ? 'The execution report author' : r.requester.name;
    out.push({ text: `${who} to address the requested changes${last ? ` from ${last.actorName}` : ''} and resubmit.`, tone: 'warning' });
  }
  for (const [tl, label] of [[planTl, 'activity review'], [reportTl, 'execution report verification']] as const) {
    if (tl?.instance.status === 'IN_PROGRESS') {
      out.push(tl.instance.currentAssignee
        ? { text: `Awaiting ${label} by ${tl.instance.currentAssignee.name} (${tl.instance.currentLevelName}).`, tone: 'info' }
        : { text: `${tl.instance.currentLevelName} has no available officer — an administrator must assign one.`, tone: 'danger' });
    }
  }
  if (['APPROVED', 'IN_PROGRESS'].includes(r.lifecycle)) {
    if (!r.report) out.push({ text: 'Assigned staff to conduct the activity and submit the execution report.', tone: 'info' });
    else if (r.report.reportStatus === 'DRAFT') out.push({ text: `Finish and submit the draft execution report ${r.report.reportNo}.`, tone: 'info' });
  }
  for (const a of active) {
    if (a.deadline && a.deadline < now) out.push({ text: `Task overdue: ${a.assignee.name} — deadline ${fmtDate(a.deadline)}.`, tone: 'danger' });
  }
  if (!['COMPLETED', 'REJECTED', 'CANCELLED', 'DRAFT'].includes(r.lifecycle) && r.endDate < todayUtc()) out.push({ text: `The planned end date (${fmtDate(r.endDate)}) has passed and the activity is not completed.`, tone: 'danger' });
  return out;
}

daamrRequestsRouter.get('/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  await guardView(req.user!, id);
  const r = await prisma.activityRequest.findUniqueOrThrow({
    where: { id },
    include: {
      district: true,
      department: true,
      requester: { select: { id: true, name: true, email: true, designation: true } },
      files: { where: { deletedAt: null }, select: fileSelect, orderBy: { createdAt: 'asc' } },
      assignments: { include: assignmentInclude, orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }] },
      report: { include: { participants: true, budget: true, mediaLinks: true, files: { where: { deletedAt: null }, select: fileSelect, orderBy: { createdAt: 'asc' } }, createdBy: { select: { id: true, name: true } } } },
      course: { select: { id: true, courseNo: true, status: true, startDate: true, endDate: true, durationDays: true } },
    },
  });
  const user = req.user!;
  const isCourse = r.activityType === 'COURSE';
  const owner = r.requesterId === user.id;
  const staffIds = r.assignments.filter((a) => a.status !== 'CANCELLED').map((a) => a.assigneeId);
  const isStaff = staffIds.includes(user.id);
  const expenses = canSeeExpenses(user, [r.requesterId, ...staffIds]);
  const flags = await workflowFlags(user, r.workflowInstanceId);
  const timeline = r.workflowInstanceId ? await buildTimeline(prisma, r.workflowInstanceId) : null;
  const reportTimeline = r.report?.workflowInstanceId ? await buildTimeline(prisma, r.report.workflowInstanceId) : null;
  const reportFlags = r.report ? await workflowFlags(user, r.report.workflowInstanceId) : null;
  const versions = await prisma.entityVersion.count({ where: { entityType: 'ActivityRequest', entityId: r.id } });
  const cover = [...r.files].reverse().find((f) => f.category === 'COVER') ?? null;
  const override = can(user, 'workflow.override');
  const open = !['COMPLETED', 'REJECTED', 'CANCELLED'].includes(r.lifecycle);
  const report = r.report
    ? { ...r.report, budget: expenses ? r.report.budget : null, expenseDetails: expenses ? r.report.expenseDetails : null }
    : null;
  res.json({
    request: { ...r, report, proposedBudget: expenses ? r.proposedBudget : null },
    cover,
    leadOfficer: r.assignments.find((a) => a.status !== 'CANCELLED')?.assignee ?? null,
    nextReviewer: reportTimeline?.instance.status === 'IN_PROGRESS' ? { ...reportTimeline.instance.currentAssignee, level: reportTimeline.instance.currentLevelName, stage: 'Execution report verification' }
      : timeline?.instance.status === 'IN_PROGRESS' ? { ...timeline.instance.currentAssignee, level: timeline.instance.currentLevelName, stage: 'Activity review' } : null,
    outstanding: outstandingActions(r, timeline, reportTimeline),
    timeline,
    reportTimeline,
    reportFlags,
    versions,
    emailStatus: await latestEmailStatus(r.daamrId),
    can: {
      ...flags,
      edit: owner && ['DRAFT', 'RETURNED'].includes(r.status),
      delete: owner && r.status === 'DRAFT',
      assign: open && (can(user, 'daamr.assign') || override) && (owner || can(user, 'daamr.request.view_all') || can(user, 'daamr.request.view_district') || override),
      execute: !isCourse && (owner || isStaff || override) && r.status === 'APPROVED' && open,
      createReport: !isCourse && (owner || isStaff || override) && r.status === 'APPROVED' && !r.report,
      setupCourse: isCourse && r.status === 'APPROVED' && !r.course && can(user, 'course.manage'),
      uploadCover: (owner && ['DRAFT', 'RETURNED', 'APPROVED'].includes(r.status)) || override,
      uploadPre: (owner && ['DRAFT', 'RETURNED', 'APPROVED'].includes(r.status)) || override,
      uploadPost: (owner || override) && r.status === 'APPROVED',
      uploadDocs: (owner && ['DRAFT', 'RETURNED'].includes(r.status)) || override,
      evidence: flags.canDecide,
      viewExpenses: expenses,
      export: can(user, 'daamr.export') || owner || isStaff,
    },
  });
});

/** Chronological record of everything that happened to the activity (creation, assignments, reviews, uploads, execution). */
daamrRequestsRouter.get('/:id/activity-log', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  await guardView(req.user!, id);
  const r = await prisma.activityRequest.findUniqueOrThrow({ where: { id }, include: { report: { select: { id: true, workflowInstanceId: true } }, assignments: { select: { id: true } } } });
  const ids = [r.id, r.report?.id, ...r.assignments.map((a) => a.id)].filter(Boolean) as string[];
  const inst = [r.workflowInstanceId, r.report?.workflowInstanceId].filter(Boolean) as string[];
  const [logs, hist] = await Promise.all([
    prisma.auditLog.findMany({ where: { entityId: { in: ids }, NOT: { action: { startsWith: 'WORKFLOW_' } } }, orderBy: { createdAt: 'asc' }, select: { id: true, action: true, actorName: true, createdAt: true, entityType: true, after: true } }),
    inst.length ? prisma.approvalHistory.findMany({ where: { instanceId: { in: inst } }, orderBy: { createdAt: 'asc' }, include: { instance: { select: { module: true } } } }) : Promise.resolve([]),
  ]);
  const LABEL: Record<string, string> = {
    REQUEST_CREATED: 'Activity created', REQUEST_EDITED: 'Activity details edited', REQUEST_SUBMITTED: 'Submitted for review', REQUEST_RESUBMITTED: 'Resubmitted after changes',
    EXECUTION_STATUS_CHANGED: 'Execution status updated', ASSIGNMENT_CREATED: 'Staff assigned', ASSIGNMENT_UPDATED: 'Assignment updated', ASSIGNMENT_STATUS_CHANGED: 'Task status updated',
    ASSIGNMENT_CANCELLED: 'Assignment cancelled', FILE_UPLOADED: 'Files uploaded', FILE_REMOVED: 'File removed', FILE_UPDATED: 'File details updated', ACTIVITY_REPORT_CREATED: 'Execution report started',
    ACTIVITY_REPORT_EDITED: 'Execution report edited', ACTIVITY_REPORT_EDITED_COUNTS_BUDGET: 'Execution report figures edited', ACTIVITY_REPORT_SUBMITTED: 'Execution report submitted',
    ACTIVITY_REPORT_RESUBMITTED: 'Execution report resubmitted', REPORT_DOWNLOADED: 'PDF report downloaded',
  };
  const events = [
    ...logs.map((l) => {
      const a = l.after as any;
      const detail = l.action === 'EXECUTION_STATUS_CHANGED' ? humanize(a?.executionStatus)
        : l.action.startsWith('ASSIGNMENT') ? [a?.assignee, a?.status && humanize(a.status), a?.reason].filter(Boolean).join(' · ')
        : l.action === 'FILE_UPLOADED' && Array.isArray(a) ? `${humanize(a[0]?.category)}: ${a.map((f: any) => f.name).join(', ')}`
        : null;
      return { id: l.id, at: l.createdAt, kind: 'event', label: LABEL[l.action] ?? humanize(l.action), actor: l.actorName, detail };
    }),
    ...hist.map((h) => ({
      id: h.id, at: h.createdAt, kind: 'review', stage: h.instance.module === 'DAAMR_REPORT' ? 'Execution report verification' : 'Activity review',
      label: humanize(h.action), action: h.action, level: h.levelName, actor: h.actorName, target: h.targetUserName, detail: h.remarks, evidence: (h.data as any)?.evidence ?? [],
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  res.json(events);
});

daamrRequestsRouter.post('/:id/execution', requireAuth, async (req, res) => {
  const { executionStatus, remarks } = parse(z.object({ executionStatus: z.enum(EXECUTION_STATUS), remarks: zOptStr(1000) }), req.body);
  const r = await prisma.activityRequest.findUnique({ where: { id: String(req.params.id) }, include: { requester: true } });
  if (!r) throw notFound();
  if (r.requesterId !== req.user!.id && !(await isAssignedStaff(req.user!.id, r.id)) && !can(req.user, 'workflow.override')) throw forbidden('Only the responsible officer or assigned staff can update execution status.');
  if (r.status !== 'APPROVED') throw conflict('Execution can only be recorded after final approval.');
  if (r.activityType === 'COURSE') throw conflict('Course execution is tracked through its daily sessions in Course Management.');
  if (['COMPLETED', 'REPORT_REVIEW'].includes(r.lifecycle)) throw conflict('Execution status is locked while the execution report is under verification or after completion.');
  await transact(async (tx) => {
    const lifecycle = r.lifecycle === 'APPROVED' && ['IN_PROGRESS', 'COMPLETED'].includes(executionStatus) ? 'IN_PROGRESS' : r.lifecycle;
    await tx.activityRequest.update({ where: { id: r.id }, data: { executionStatus, lifecycle, updatedById: req.user!.id } });
    await audit(tx, req, { action: 'EXECUTION_STATUS_CHANGED', module: 'DAAMR', entityType: 'ActivityRequest', entityId: r.id, entityRef: r.daamrId, before: { executionStatus: r.executionStatus }, after: { executionStatus, remarks } });
  });
  res.json({ ok: true });
});

// ───────────── Single-activity detailed PDF / Excel ─────────────

export const PDF_SECTIONS = ['overview', 'venue', 'images', 'assignments', 'reviews', 'execution', 'participants', 'documents', 'approval'] as const;

daamrRequestsRouter.get('/:id/pdf', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  await guardView(req.user!, id);
  const s = await getSettings();
  const r = await prisma.activityRequest.findUniqueOrThrow({
    where: { id },
    include: {
      district: true, department: true, requester: true, files: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      assignments: { include: { assignee: true, assignedBy: true }, orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }] },
      report: { include: { participants: true, budget: true, mediaLinks: true, files: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } }, createdBy: true } },
    },
  });
  const isStaff = r.assignments.some((a) => a.assigneeId === req.user!.id && a.status !== 'CANCELLED');
  if (!can(req.user, 'daamr.export') && r.requesterId !== req.user!.id && !isStaff && !can(req.user, 'daamr.request.view_all')) throw forbidden('You are not permitted to export this activity.');
  const expenses = canSeeExpenses(req.user!, [r.requesterId, ...r.assignments.map((a) => a.assigneeId)]);
  const wanted = new Set(String(req.query.sections ?? PDF_SECTIONS.join(',')).split(',').filter((x) => (PDF_SECTIONS as readonly string[]).includes(x)));
  const allPhotos = [...r.files, ...(r.report?.files ?? [])].filter((f) => f.kind === 'PHOTO' && !['REVIEW_EVIDENCE', 'ATTENDANCE'].includes(f.category));
  const imgParam = String(req.query.images ?? 'all');
  const photos = imgParam === 'none' ? [] : imgParam === 'all' ? allPhotos.slice(0, 24) : allPhotos.filter((f) => imgParam.split(',').includes(f.id)).slice(0, 40);
  const tl = r.workflowInstanceId ? await buildTimeline(prisma, r.workflowInstanceId) : null;
  const rtl = r.report?.workflowInstanceId ? await buildTimeline(prisma, r.report.workflowInstanceId) : null;
  const lead = r.assignments.find((a) => a.status !== 'CANCELLED');
  await audit(prisma, req, { action: 'REPORT_DOWNLOADED', module: 'DAAMR', entityType: 'ActivityRequest', entityId: r.id, entityRef: r.daamrId, after: { sections: [...wanted], images: photos.length } });

  const sections: Section[] = [];
  if (wanted.has('overview')) {
    sections.push({ type: 'kv', title: 'Activity Information', items: [
      ['Activity reference', r.daamrId], ['Activity title', r.subject], ['Category', humanize(r.category)], ['Priority', humanize(r.priority)],
      ['Overall status', humanize(r.lifecycle)], ['Approval status', humanize(r.status)], ['Responsible department', r.department?.name], ['Responsible officer', lead ? `${lead.assignee.name}${lead.assignee.designation ? `, ${lead.assignee.designation}` : ''}` : 'Not assigned'],
      ['Target audience', r.targetAudience], ['Expected participants', r.expectedParticipants], ['Dates', `${fmtDate(r.startDate)}${r.startTime ? ` ${r.startTime}` : ''} – ${fmtDate(r.endDate)}${r.endTime ? ` ${r.endTime}` : ''}`],
      ...(expenses ? [['Estimated budget', fmtMoney(r.proposedBudget)] as [string, string]] : []),
      ['Created by', `${r.requester.name} on ${fmtDateTime(r.createdAt, s.timezone)}`], ['Submitted', fmtDateTime(r.submittedAt, s.timezone)],
    ] });
    sections.push({ type: 'text', title: 'Description', text: r.description });
    if (r.objectives) sections.push({ type: 'text', title: 'Objectives', text: r.objectives });
  }
  if (wanted.has('venue')) {
    sections.push({ type: 'kv', title: 'Venue Details', items: [['Venue', r.venue], ['Address', r.venueAddress], ['Location', r.area], ['Tehsil', r.tehsil], ['District / HQ', r.district.name], ['Province', r.province]] });
  }
  if (wanted.has('images')) {
    sections.push({ type: 'images', title: 'Venue Images and Activity Photographs', items: photos.map((f) => ({ fileId: f.id, caption: `${humanize(f.category === 'PRE_ACTIVITY' ? 'VENUE_/_BEFORE' : f.category === 'POST_ACTIVITY' ? 'AFTER' : f.category)}${f.caption ? ` — ${f.caption}` : ''}` })) });
  }
  if (wanted.has('assignments')) {
    sections.push({ type: 'table', title: 'Assigned Staff', columns: [
      { key: 'staff', label: 'Staff member', width: 1.6 }, { key: 'role', label: 'Role', width: 0.8 }, { key: 'responsibilities', label: 'Responsibilities', width: 2.6 },
      { key: 'deadline', label: 'Deadline', width: 0.9 }, { key: 'priority', label: 'Priority', width: 0.7 }, { key: 'status', label: 'Status', width: 0.9 },
    ], rows: r.assignments.map((a) => ({
      staff: `${a.assignee.name}${a.assignee.designation ? `, ${a.assignee.designation}` : ''}`, role: a.isLead ? 'Lead' : 'Support', responsibilities: a.responsibilities,
      deadline: fmtDate(a.deadline), priority: humanize(a.priority), status: humanize(a.status),
    })) });
  }
  if (wanted.has('reviews')) {
    for (const [t, title] of [[tl, 'Activity Review and Approval History'], [rtl, 'Execution Report Verification History']] as const) {
      if (!t) continue;
      sections.push({ type: 'table', title, columns: [
        { key: 'at', label: 'Date & time', width: 1.2 }, { key: 'level', label: 'Stage', width: 1.3 }, { key: 'action', label: 'Decision', width: 1 },
        { key: 'by', label: 'Reviewer', width: 1.5 }, { key: 'remarks', label: 'Comments', width: 2.6 }, { key: 'evidence', label: 'Evidence', width: 1.2 },
      ], rows: t.history.map((h) => ({
        at: fmtDateTime(h.createdAt, s.timezone), level: h.levelName ?? '', action: humanize(h.action), by: `${h.actorName}${h.actorDesignation ? ` (${h.actorDesignation})` : ''}${h.targetUserName ? ` → ${h.targetUserName}` : ''}`,
        remarks: h.remarks ?? '', evidence: ((h.data as any)?.evidence ?? []).map((e: any) => e.name).join(', '),
      })) });
    }
  }
  const p = r.report;
  if (wanted.has('execution')) {
    if (p) {
      sections.push({ type: 'kv', title: `Execution Report ${p.reportNo}`, items: [
        ['Report status', humanize(p.reportStatus)], ['Actual date', fmtDate(p.activityDate)], ['Actual venue', p.venue], ['Responsible officer', p.responsibleOfficer],
        ['Prepared by', p.createdBy.name], ['Submitted', fmtDateTime(p.submittedAt, s.timezone)],
        ...(expenses && p.budget ? [['Budget allocated', fmtMoney(p.budget.allocated)], ['Budget utilized', fmtMoney(p.budget.utilized)], ['Remaining', fmtMoney(p.budget.remaining)]] as [string, string][] : []),
        ...p.mediaLinks.map((m) => [humanize(m.platform), m.url] as [string, string]),
      ] });
      sections.push({ type: 'text', title: 'Activities Conducted', text: p.description });
      if (expenses && p.expenseDetails) sections.push({ type: 'text', title: 'Expense Details', text: p.expenseDetails });
      if (p.remarks) sections.push({ type: 'text', title: 'Staff Remarks', text: p.remarks });
    } else sections.push({ type: 'text', title: 'Execution Report', text: 'No execution report has been filed yet.' });
  }
  if (wanted.has('participants') && p) {
    const pp = p.participants;
    sections.push({ type: 'kv', title: 'Participants and Outcomes', items: [
      ['Expected participants', r.expectedParticipants], ['Total participants', pp?.total], ...DEMOGRAPHIC_FIELDS.map((f) => [humanize(f), (pp as any)?.[f]] as [string, number]),
    ] });
    if (p.achievements) sections.push({ type: 'text', title: 'Achievements and Outcomes', text: p.achievements });
    if (p.challenges) sections.push({ type: 'text', title: 'Challenges Faced', text: p.challenges });
    if (p.recommendations) sections.push({ type: 'text', title: 'Recommendations', text: p.recommendations });
  }
  if (wanted.has('documents')) {
    const docs = [...r.files, ...(p?.files ?? [])].filter((f) => f.kind === 'DOCUMENT' || ['REVIEW_EVIDENCE', 'ATTENDANCE'].includes(f.category));
    sections.push({ type: 'list', title: 'Supporting Documents', items: docs.map((f) => `${humanize(f.category)} — ${f.originalName}${f.caption ? ` (${f.caption})` : ''}, uploaded ${fmtDate(f.createdAt)}`) });
  }
  if (wanted.has('approval')) {
    const fin = (t: any) => t?.history.filter((h: any) => h.action === 'FINAL_APPROVED').at(-1);
    const a1 = fin(tl), a2 = fin(rtl);
    sections.push({ type: 'kv', title: 'Final Approval Details', items: [
      ['Activity approved by', a1 ? `${a1.actorName}${a1.actorDesignation ? `, ${a1.actorDesignation}` : ''} — ${a1.levelName}` : 'Not yet approved'], ['Activity approved on', a1 ? fmtDateTime(a1.createdAt, s.timezone) : ''],
      ['Execution report verified by', a2 ? `${a2.actorName}${a2.actorDesignation ? `, ${a2.actorDesignation}` : ''} — ${a2.levelName}` : 'Not yet verified'], ['Verified on', a2 ? fmtDateTime(a2.createdAt, s.timezone) : ''],
      ['Activity status', humanize(r.lifecycle)], ['Completed on', fmtDateTime(r.completedAt, s.timezone)],
    ] });
  }
  await sendExport(res, 'pdf', { title: `Activity Report — ${r.subject}`, filename: r.daamrId, meta: [['Activity reference', r.daamrId], ['District / HQ', r.district.name]], sections }, req.user!.name);
});

mountWorkflowRoutes(daamrRequestsRouter, {
  module: 'DAAMR_REQUEST',
  entityType: 'ActivityRequest',
  evidenceFk: 'activityRequestId',
  async locate(id) {
    const r = await prisma.activityRequest.findUnique({ where: { id }, select: { workflowInstanceId: true, daamrId: true } });
    return r ? { instanceId: r.workflowInstanceId, ref: r.daamrId } : null;
  },
  canView: canViewRequest,
});

