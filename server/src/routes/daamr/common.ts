import { prisma } from '../../db.js';
import { can, type AuthUser } from '../../lib/auth.js';
import { registerFileTarget } from '../../lib/fileTargets.js';
import { fmtDate, fmtMoney } from '../../lib/export.js';
import { isInvolved, registerAdapter } from '../../workflow/engine.js';
import { notify } from '../../lib/notify.js';
import { createCourseFromActivity } from '../courses/common.js';

// ───────────── Visibility scopes (enforced on every list, detail, file and export) ─────────────

export function requestScope(user: AuthUser): any {
  if (can(user, 'daamr.request.view_all')) return {};
  const or: any[] = [
    { requesterId: user.id },
    { assignments: { some: { assigneeId: user.id, status: { not: 'CANCELLED' } } } },
    { workflow: { assignments: { some: { assigneeId: user.id } } } },
    { workflow: { history: { some: { actorId: user.id } } } },
    { report: { workflow: { assignments: { some: { assigneeId: user.id } } } } },
    { report: { workflow: { history: { some: { actorId: user.id } } } } },
  ];
  if (can(user, 'daamr.request.view_district') && user.districtId) or.push({ districtId: user.districtId, status: { not: 'DRAFT' } });
  return { OR: or };
}

export function reportScope(user: AuthUser): any {
  if (can(user, 'daamr.report.view_all')) return {};
  const or: any[] = [
    { createdById: user.id },
    { request: { requesterId: user.id } },
    { request: { assignments: { some: { assigneeId: user.id, status: { not: 'CANCELLED' } } } } },
    { workflow: { assignments: { some: { assigneeId: user.id } } } },
    { workflow: { history: { some: { actorId: user.id } } } },
  ];
  if (can(user, 'daamr.report.view_district') && user.districtId) or.push({ districtId: user.districtId, reportStatus: { not: 'DRAFT' } });
  return { OR: or };
}

export async function canViewRequest(user: AuthUser, id: string) {
  return (await prisma.activityRequest.count({ where: { AND: [{ id }, requestScope(user)] } })) > 0;
}
export async function canViewReport(user: AuthUser, id: string) {
  return (await prisma.activityReport.count({ where: { AND: [{ id }, reportScope(user)] } })) > 0;
}

export const REQUEST_STATUS = ['DRAFT', 'PENDING_REVIEW', 'UNDER_REVIEW', 'RETURNED', 'REJECTED', 'APPROVED'] as const;
export const EXECUTION_STATUS = ['NOT_STARTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] as const;
export const REPORT_STATUS = ['DRAFT', 'UNDER_VERIFICATION', 'RETURNED', 'REJECTED', 'VERIFIED'] as const;
export const DEMOGRAPHIC_FIELDS = ['male', 'female', 'minority', 'madaris', 'transgender', 'disabled', 'juvenile'] as const;
export const LIFECYCLE = ['DRAFT', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'APPROVED', 'IN_PROGRESS', 'REPORT_REVIEW', 'COMPLETED', 'CANCELLED'] as const;
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
/** Lifecycle stages in which the activity is still open (counts toward overdue / pending assignment). */
export const OPEN_LIFECYCLE = ['DRAFT', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'IN_PROGRESS', 'REPORT_REVIEW'];
export const ACTIVE_ASSIGNMENT = ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS'];

/** Start of today (UTC date) — activity dates are stored as UTC midnight. */
export function todayUtc() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Prisma condition for overdue activities: still open and either past the end date or with an overdue open task. */
export function overdueWhere(): any {
  const now = new Date();
  return {
    lifecycle: { in: OPEN_LIFECYCLE.filter((l) => l !== 'DRAFT') },
    OR: [{ endDate: { lt: todayUtc() } }, { assignments: { some: { status: { in: ACTIVE_ASSIGNMENT }, deadline: { lt: now } } } }],
  };
}

/** Prisma condition for activities still awaiting staff assignment. */
export function unassignedWhere(): any {
  return { lifecycle: { in: OPEN_LIFECYCLE }, assignments: { none: { status: { not: 'CANCELLED' } } } };
}

/** Users who may see budgets and expense details of an activity. */
export function canSeeExpenses(user: AuthUser, ownerIds: (string | null | undefined)[] = []) {
  return can(user, 'daamr.expense.view') || ownerIds.includes(user.id);
}

export function requestSnapshot(r: any) {
  return {
    daamrId: r.daamrId, requesteeEmail: r.requesteeEmail, districtId: r.districtId, departmentId: r.departmentId, category: r.category,
    subject: r.subject, area: r.area, description: r.description, startDate: r.startDate, endDate: r.endDate, venue: r.venue, proposedBudget: r.proposedBudget,
    objectives: r.objectives, targetAudience: r.targetAudience, expectedParticipants: r.expectedParticipants, startTime: r.startTime, endTime: r.endTime,
    province: r.province, tehsil: r.tehsil, venueAddress: r.venueAddress, priority: r.priority,
    activityType: r.activityType, trainingDays: r.trainingDays, deliveryFormat: r.deliveryFormat, methodology: r.methodology, proposedTrainers: r.proposedTrainers,
  };
}

// ───────────── Workflow adapters ─────────────

registerAdapter({
  module: 'DAAMR_REQUEST',
  async summary(tx, inst) {
    const r = await tx.activityRequest.findUniqueOrThrow({ where: { workflowInstanceId: inst.id }, include: { requester: true, district: true } });
    return {
      entityId: r.id,
      ref: r.daamrId,
      subject: r.subject,
      link: `/daamr/requests/${r.id}`,
      requester: { id: r.requester.id, email: r.requester.email, name: r.requester.name },
      extraEmails: r.requesteeEmail.toLowerCase() !== r.requester.email.toLowerCase() ? [r.requesteeEmail] : [],
      details: [['District / HQ', r.district.name], ['Activity dates', `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}`], ['Venue', r.venue], ['Proposed budget', fmtMoney(r.proposedBudget)]],
    };
  },
  async setPhase(tx, inst, phase) {
    const data: any = {};
    if (phase.kind === 'ASSIGNED') { data.status = phase.isFirst ? 'PENDING_REVIEW' : 'UNDER_REVIEW'; data.lifecycle = 'UNDER_REVIEW'; }
    else if (phase.kind === 'RETURNED') { data.status = 'RETURNED'; data.lifecycle = 'CHANGES_REQUESTED'; }
    else if (phase.kind === 'REJECTED') { data.status = 'REJECTED'; data.lifecycle = 'REJECTED'; }
    else if (phase.kind === 'APPROVED') { data.status = 'APPROVED'; data.approvedAt = new Date(); data.lifecycle = 'APPROVED'; }
    else if (phase.kind === 'CANCELLED') { data.status = 'REJECTED'; data.lifecycle = 'CANCELLED'; }
    const r = await tx.activityRequest.update({ where: { workflowInstanceId: inst.id }, data });
    // final approval of a course proposal sets up course execution automatically (idempotent)
    if (phase.kind === 'APPROVED' && r.activityType === 'COURSE') await createCourseFromActivity(tx, r.id, { id: null, name: 'System (automatic course set-up)' });
  },
  async responsibleOfficer(tx, inst) {
    const r = await tx.activityRequest.findUnique({ where: { workflowInstanceId: inst.id }, select: { id: true } });
    return r ? leadOfficerId(tx, r.id) : null;
  },
});

/** The lead (responsible) staff member of an activity, or the earliest active assignee. */
export async function leadOfficerId(tx: any, activityId: string): Promise<string | null> {
  const a = await tx.activityAssignment.findFirst({
    where: { activityId, status: { not: 'CANCELLED' } },
    orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }],
    select: { assigneeId: true },
  });
  return a?.assigneeId ?? null;
}

registerAdapter({
  module: 'DAAMR_REPORT',
  async summary(tx, inst) {
    const r = await tx.activityReport.findUniqueOrThrow({ where: { workflowInstanceId: inst.id }, include: { createdBy: true, district: true } });
    return {
      entityId: r.id,
      ref: r.daamrId,
      subject: `Final activity report ${r.reportNo}: ${r.activityName}`,
      link: `/daamr/reports/${r.id}`,
      requester: { id: r.createdBy.id, email: r.createdBy.email, name: r.createdBy.name },
      details: [['Report No.', r.reportNo], ['District / HQ', r.district.name], ['Activity date', fmtDate(r.activityDate)]],
    };
  },
  async setPhase(tx, inst, phase) {
    const data: any = {};
    let lifecycle: string | null = null;
    if (phase.kind === 'ASSIGNED') { data.reportStatus = 'UNDER_VERIFICATION'; lifecycle = 'REPORT_REVIEW'; }
    else if (phase.kind === 'RETURNED') { data.reportStatus = 'RETURNED'; lifecycle = 'CHANGES_REQUESTED'; }
    else if (phase.kind === 'REJECTED' || phase.kind === 'CANCELLED') { data.reportStatus = 'REJECTED'; lifecycle = 'REJECTED'; }
    else if (phase.kind === 'APPROVED') { data.reportStatus = 'VERIFIED'; data.verifiedAt = new Date(); lifecycle = 'COMPLETED'; }
    const rep = await tx.activityReport.update({ where: { workflowInstanceId: inst.id }, data });
    // the linked activity is only Completed once its execution report has passed every verification level
    if (rep.requestId && lifecycle) {
      await tx.activityRequest.update({
        where: { id: rep.requestId },
        data: { lifecycle, ...(lifecycle === 'COMPLETED' ? { completedAt: new Date(), executionStatus: 'COMPLETED' } : {}) },
      });
    }
  },
  async responsibleOfficer(tx, inst) {
    const r = await tx.activityReport.findUnique({ where: { workflowInstanceId: inst.id }, select: { requestId: true } });
    return r?.requestId ? leadOfficerId(tx, r.requestId) : null;
  },
  async onFinalApproved(tx, ctx) {
    const rep = await tx.activityReport.findUnique({ where: { workflowInstanceId: ctx.instance.id }, include: { request: { include: { assignments: { where: { status: { not: 'CANCELLED' } }, include: { assignee: true } }, requester: true } } } });
    if (!rep?.request) return;
    const a = rep.request;
    await notify(tx, {
      recipients: [a.requester, ...a.assignments.map((x) => x.assignee)].filter((u) => u.id !== ctx.actor.id).map((u) => ({ id: u.id, email: u.email, name: u.name })),
      event: 'ACTIVITY_COMPLETED',
      module: 'DAAMR',
      entityRef: a.daamrId,
      title: 'Activity completed — execution report verified',
      details: [['Activity', a.subject], ['Execution report', rep.reportNo], ['Final approval by', `${ctx.actor.name} — ${ctx.level.name}`]],
      link: `/daamr/requests/${a.id}`,
    });
  },
});

// ───────────── File targets ─────────────

registerFileTarget({
  key: 'activity-request',
  fk: 'activityRequestId',
  module: 'DAAMR',
  entityType: 'ActivityRequest',
  categories: { COVER: 'photo', PRE_ACTIVITY: 'photo', POST_ACTIVITY: 'photo', SUPPORTING: 'doc', REVIEW_EVIDENCE: 'doc' },
  canView: canViewRequest,
  async canUpload(user, id, category) {
    const r = await prisma.activityRequest.findUnique({ where: { id }, include: { workflow: true } });
    if (!r) return null;
    const owner = r.requesterId === user.id;
    if (category === 'REVIEW_EVIDENCE') return reviewerMayAttach(user, r.workflow) ? { ref: r.daamrId } : null;
    if (category === 'COVER') return (owner && ['DRAFT', 'RETURNED', 'APPROVED'].includes(r.status)) || can(user, 'workflow.override') ? { ref: r.daamrId } : null;
    if (category === 'POST_ACTIVITY') return (owner || can(user, 'workflow.override')) && r.status === 'APPROVED' ? { ref: r.daamrId } : null;
    // venue pictures & documents: while editable by the requester, or by the officer currently reviewing it
    if (owner && ['DRAFT', 'RETURNED'].includes(r.status)) return { ref: r.daamrId };
    if (owner && r.status === 'APPROVED' && category === 'PRE_ACTIVITY') return { ref: r.daamrId };
    if (can(user, 'workflow.override')) return { ref: r.daamrId };
    return null;
  },
  async canDelete(user, id, file) {
    const r = await prisma.activityRequest.findUnique({ where: { id } });
    if (!r) return false;
    if (can(user, 'workflow.override')) return true;
    if (file.category === 'REVIEW_EVIDENCE') return file.uploadedById === user.id && (await evidenceUnused(id, file.id, 'activityRequestId'));
    return file.uploadedById === user.id && r.requesterId === user.id && (['DRAFT', 'RETURNED'].includes(r.status) || (r.status === 'APPROVED' && file.category !== 'SUPPORTING'));
  },
});

/** Reviewer evidence may be attached by the officer currently holding the item (or an administrator). */
function reviewerMayAttach(user: AuthUser, wf: { status: string; currentAssigneeId: string | null } | null) {
  if (!wf || wf.status !== 'IN_PROGRESS') return false;
  return wf.currentAssigneeId === user.id || can(user, 'workflow.override');
}

/** Evidence can be withdrawn only until it has been attached to a recorded decision. */
async function evidenceUnused(entityId: string, fileId: string, fk: 'activityRequestId' | 'activityReportId') {
  const e = fk === 'activityRequestId'
    ? await prisma.activityRequest.findUnique({ where: { id: entityId }, select: { workflowInstanceId: true } })
    : await prisma.activityReport.findUnique({ where: { id: entityId }, select: { workflowInstanceId: true } });
  if (!e?.workflowInstanceId) return true;
  const hist = await prisma.approvalHistory.findMany({ where: { instanceId: e.workflowInstanceId }, select: { data: true } });
  return !hist.some((h: any) => (h.data?.evidence ?? []).some((x: any) => x.id === fileId));
}

/** Staff assigned to an activity (any active assignment). */
export async function isAssignedStaff(userId: string, activityId: string) {
  return (await prisma.activityAssignment.count({ where: { activityId, assigneeId: userId, status: { not: 'CANCELLED' } } })) > 0;
}

registerFileTarget({
  key: 'activity-assignment',
  fk: 'activityAssignmentId',
  module: 'DAAMR',
  entityType: 'ActivityAssignment',
  categories: { SUPPORTING: 'doc' },
  async canView(user, id) {
    const a = await prisma.activityAssignment.findUnique({ where: { id }, select: { activityId: true } });
    return !!a && canViewRequest(user, a.activityId);
  },
  async canUpload(user, id) {
    const a = await prisma.activityAssignment.findUnique({ where: { id }, include: { activity: { select: { daamrId: true } } } });
    if (!a || a.status === 'CANCELLED') return null;
    if (a.assignedById === user.id || a.assigneeId === user.id || can(user, 'daamr.assign') || can(user, 'workflow.override')) return { ref: a.activity.daamrId };
    return null;
  },
  async canDelete(user, _id, file) {
    return file.uploadedById === user.id || can(user, 'workflow.override');
  },
});

registerFileTarget({
  key: 'activity-report',
  fk: 'activityReportId',
  module: 'DAAMR',
  entityType: 'ActivityReport',
  categories: { PRE_ACTIVITY: 'photo', POST_ACTIVITY: 'photo', EVENT: 'photo', ATTENDANCE: 'pdfimage', SUPPORTING: 'doc', REVIEW_EVIDENCE: 'doc' },
  canView: canViewReport,
  async canUpload(user, id, category) {
    const r = await prisma.activityReport.findUnique({ where: { id }, include: { workflow: true } });
    if (!r) return null;
    if (category === 'REVIEW_EVIDENCE') return reviewerMayAttach(user, r.workflow) ? { ref: r.daamrId } : null;
    if ((r.createdById === user.id && ['DRAFT', 'RETURNED'].includes(r.reportStatus)) || can(user, 'workflow.override')) return { ref: r.daamrId };
    return null;
  },
  async canDelete(user, id, file) {
    const r = await prisma.activityReport.findUnique({ where: { id } });
    if (!r) return false;
    if (file.category === 'REVIEW_EVIDENCE') return file.uploadedById === user.id && (await evidenceUnused(id, file.id, 'activityReportId'));
    if (can(user, 'workflow.override')) return true;
    return file.uploadedById === user.id && ['DRAFT', 'RETURNED'].includes(r.reportStatus);
  },
});

export { isInvolved };
