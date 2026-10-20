import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { requireAuth, requirePerm, can, type AuthUser } from '../../lib/auth.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound, pageParams, parse, zOptDate, zOptStr, zStr } from '../../lib/http.js';
import { notify, transact } from '../../lib/notify.js';
import { fileSelect } from '../../lib/files.js';
import { fmtDate, humanize } from '../../lib/export.js';
import { getSettings } from '../../lib/settings.js';
import { fillPendingAssignment } from '../../workflow/engine.js';
import { ACTIVE_ASSIGNMENT, PRIORITIES, canViewRequest, todayUtc } from './common.js';

/** Staff assignment of activities: /api/daamr/requests/:id/assignments, /api/daamr/assignments, /api/daamr/staff */
export const daamrAssignmentsRouter = Router();

const CLOSED_LIFECYCLE = ['COMPLETED', 'REJECTED', 'CANCELLED'];

/** Who may assign staff to (and manage assignments of) an activity. */
async function mayAssign(user: AuthUser, activity: { id: string; requesterId: string }) {
  if (can(user, 'workflow.override')) return true;
  if (!can(user, 'daamr.assign')) return false;
  return activity.requesterId === user.id || (await canViewRequest(user, activity.id));
}

const assignBody = z.object({
  assigneeIds: z.array(z.string().min(1)).min(1, 'Select at least one staff member').max(20),
  leadId: zOptStr(40),
  responsibilities: zStr(4000),
  instructions: zOptStr(4000),
  deadline: zOptDate,
  priority: z.enum(PRIORITIES).default('NORMAL'),
  reviewRequirements: zOptStr(2000),
});

const assignmentInclude = {
  assignee: { select: { id: true, name: true, email: true, designation: true, district: { select: { name: true } } } },
  assignedBy: { select: { id: true, name: true, designation: true } },
  files: { where: { deletedAt: null }, select: fileSelect, orderBy: { createdAt: 'asc' as const } },
};

/** Candidate staff for assignment: active users, those in the activity's district first. */
daamrAssignmentsRouter.get('/staff', requireAuth, async (req, res) => {
  if (!can(req.user, 'daamr.assign') && !can(req.user, 'workflow.override')) throw forbidden();
  const districtId = req.query.districtId ? String(req.query.districtId) : null;
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true, name: true, designation: true, districtId: true, district: { select: { name: true } }, roles: { select: { role: { select: { name: true } } } },
      _count: { select: { staffAssignments: { where: { status: { in: ACTIVE_ASSIGNMENT } } } } },
    },
    orderBy: { name: 'asc' },
  });
  res.json(
    users
      .map((u) => ({ id: u.id, name: u.name, designation: u.designation, district: u.district?.name ?? null, sameDistrict: !!districtId && u.districtId === districtId, roles: u.roles.map((r) => r.role.name), openTasks: u._count.staffAssignments }))
      .sort((a, b) => Number(b.sameDistrict) - Number(a.sameDistrict) || a.name.localeCompare(b.name)),
  );
});

daamrAssignmentsRouter.post('/requests/:id/assignments', requireAuth, async (req, res) => {
  const b = parse(assignBody, req.body);
  const activity = await prisma.activityRequest.findUnique({ where: { id: String(req.params.id) } });
  if (!activity) throw notFound();
  if (!(await mayAssign(req.user!, activity))) throw forbidden('You are not authorised to assign staff to this activity.');
  if (CLOSED_LIFECYCLE.includes(activity.lifecycle)) throw conflict(`Staff cannot be assigned to an activity that is ${humanize(activity.lifecycle).toLowerCase()}.`);
  if (b.deadline && b.deadline < todayUtc()) throw badRequest('The deadline cannot be in the past.', { fields: { deadline: 'Deadline cannot be in the past' } });
  const ids = [...new Set(b.assigneeIds)];
  if (b.leadId && !ids.includes(b.leadId)) throw badRequest('The lead officer must be one of the selected staff.', { fields: { leadId: 'Select a lead from the chosen staff' } });
  const users = await prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, name: true, email: true } });
  if (users.length !== ids.length) throw badRequest('One or more selected staff members are not active users.', { fields: { assigneeIds: 'Invalid staff selection' } });
  const existing = await prisma.activityAssignment.findMany({ where: { activityId: activity.id, assigneeId: { in: ids }, status: { in: ACTIVE_ASSIGNMENT } }, include: { assignee: { select: { name: true } } } });
  if (existing.length) throw conflict(`Already assigned: ${existing.map((e) => e.assignee.name).join(', ')}. Update the existing assignment instead.`);

  const created = await transact(async (tx) => {
    const hasLead = await tx.activityAssignment.count({ where: { activityId: activity.id, isLead: true, status: { not: 'CANCELLED' } } });
    // the first staff member assigned becomes the lead unless a lead is chosen explicitly
    const leadId = b.leadId ?? (hasLead ? null : ids[0]);
    if (leadId) await tx.activityAssignment.updateMany({ where: { activityId: activity.id, isLead: true }, data: { isLead: false } });
    const rows: { id: string }[] = [];
    for (const u of users) {
      const a = await tx.activityAssignment.create({
        data: {
          activityId: activity.id, assigneeId: u.id, assignedById: req.user!.id, isLead: u.id === leadId, responsibilities: b.responsibilities,
          instructions: b.instructions, deadline: b.deadline, priority: b.priority, reviewRequirements: b.reviewRequirements,
        },
      });
      rows.push(a);
      await audit(tx, req, {
        action: 'ASSIGNMENT_CREATED', module: 'DAAMR', entityType: 'ActivityAssignment', entityId: a.id, entityRef: activity.daamrId,
        after: { assignee: u.name, lead: a.isLead, responsibilities: b.responsibilities, deadline: b.deadline, priority: b.priority },
      });
      await notify(tx, {
        recipients: [u],
        event: 'ACTIVITY_ASSIGNED',
        module: 'DAAMR',
        entityRef: activity.daamrId,
        title: `New activity assignment${a.isLead ? ' — you are the responsible officer' : ''}`,
        details: [['Activity', activity.subject], ['Responsibilities', b.responsibilities], ['Deadline', b.deadline ? fmtDate(b.deadline) : 'Not set'], ['Priority', humanize(b.priority)], ['Assigned by', req.user!.name]],
        remarks: b.instructions,
        link: `/daamr/requests/${activity.id}?tab=assignments`,
      });
    }
    // an activity review level waiting for the responsible officer can now be assigned
    if (activity.workflowInstanceId) await fillPendingAssignment(tx, activity.workflowInstanceId, req.user!);
    return rows;
  });
  res.status(201).json(created);
});

const updateBody = z.object({
  // assigner / coordinator fields
  responsibilities: zStr(4000).optional(),
  instructions: zOptStr(4000),
  deadline: zOptDate,
  priority: z.enum(PRIORITIES).optional(),
  reviewRequirements: zOptStr(2000),
  isLead: z.boolean().optional(),
  // status change (assignee: ACKNOWLEDGED / IN_PROGRESS / COMPLETED; coordinator: CANCELLED)
  status: z.enum(['ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  statusRemarks: zOptStr(2000),
});

daamrAssignmentsRouter.patch('/assignments/:aid', requireAuth, async (req, res) => {
  const b = parse(updateBody, req.body);
  const a = await prisma.activityAssignment.findUnique({ where: { id: String(req.params.aid) }, include: { activity: true, assignee: true, assignedBy: true } });
  if (!a) throw notFound();
  const user = req.user!;
  const isAssignee = a.assigneeId === user.id;
  const coordinator = await mayAssign(user, a.activity);
  if (!isAssignee && !coordinator) throw forbidden();
  if (a.status === 'CANCELLED' || a.status === 'COMPLETED') {
    if (!(coordinator && b.status === undefined && Object.keys(req.body ?? {}).every((k) => k === 'statusRemarks'))) throw conflict(`This assignment is ${humanize(a.status).toLowerCase()} and can no longer be changed.`);
  }
  const editingTerms = ['responsibilities', 'instructions', 'deadline', 'priority', 'reviewRequirements', 'isLead'].some((k) => k in (req.body ?? {}));
  if (editingTerms && !coordinator) throw forbidden('Only the assigning officer or a coordinator can change the terms of an assignment.');
  if (b.status === 'CANCELLED' && !coordinator) throw forbidden('Only the assigning officer or a coordinator can cancel an assignment.');
  if (b.status && b.status !== 'CANCELLED' && !isAssignee && !can(user, 'workflow.override')) throw forbidden('Only the assigned staff member can update their task status.');
  if (b.status === 'CANCELLED' && (!b.statusRemarks || b.statusRemarks.length < 3)) throw badRequest('A reason is required to cancel an assignment.', { fields: { statusRemarks: 'Reason is required' } });
  if (b.deadline && b.deadline < todayUtc() && (!a.deadline || b.deadline.getTime() !== a.deadline.getTime())) throw badRequest('The deadline cannot be in the past.', { fields: { deadline: 'Deadline cannot be in the past' } });

  const out = await transact(async (tx) => {
    const data: any = {};
    if (editingTerms) {
      for (const k of ['responsibilities', 'instructions', 'priority', 'reviewRequirements'] as const) if (k in req.body) data[k] = (b as any)[k];
      if ('deadline' in req.body) {
        data.deadline = b.deadline;
        if (String(b.deadline) !== String(a.deadline)) { data.reminderSentAt = null; data.overdueNotifiedAt = null; }
      }
      if (b.isLead === true) {
        await tx.activityAssignment.updateMany({ where: { activityId: a.activityId, isLead: true }, data: { isLead: false } });
        data.isLead = true;
      } else if (b.isLead === false) data.isLead = false;
    }
    if (b.status) {
      data.status = b.status;
      data.statusRemarks = b.statusRemarks ?? null;
      if (b.status === 'ACKNOWLEDGED' && !a.acknowledgedAt) data.acknowledgedAt = new Date();
      if (b.status === 'COMPLETED' || b.status === 'CANCELLED') data.completedAt = new Date();
      if (b.status === 'CANCELLED') data.isLead = false;
    } else if ('statusRemarks' in (req.body ?? {})) data.statusRemarks = b.statusRemarks;
    const upd = await tx.activityAssignment.update({ where: { id: a.id }, data });
    await audit(tx, req, {
      action: b.status === 'CANCELLED' ? 'ASSIGNMENT_CANCELLED' : b.status ? 'ASSIGNMENT_STATUS_CHANGED' : 'ASSIGNMENT_UPDATED',
      module: 'DAAMR', entityType: 'ActivityAssignment', entityId: a.id, entityRef: a.activity.daamrId,
      before: { status: a.status, deadline: a.deadline, priority: a.priority, isLead: a.isLead },
      after: { assignee: a.assignee.name, ...data, reason: b.statusRemarks },
    });
    if (b.status && b.status !== 'CANCELLED' && isAssignee && a.assignedById !== user.id) {
      await notify(tx, {
        recipients: [a.assignedBy],
        event: 'ASSIGNMENT_STATUS',
        module: 'DAAMR',
        entityRef: a.activity.daamrId,
        title: `${a.assignee.name} marked their task ${humanize(b.status).toLowerCase()}`,
        details: [['Activity', a.activity.subject], ['Responsibilities', a.responsibilities]],
        remarks: b.statusRemarks,
        link: `/daamr/requests/${a.activityId}?tab=assignments`,
      });
    }
    if (b.status === 'CANCELLED' || (editingTerms && a.assigneeId !== user.id)) {
      await notify(tx, {
        recipients: [a.assignee],
        event: b.status === 'CANCELLED' ? 'ASSIGNMENT_CANCELLED' : 'ASSIGNMENT_UPDATED',
        module: 'DAAMR',
        entityRef: a.activity.daamrId,
        title: b.status === 'CANCELLED' ? 'Your activity assignment was cancelled' : 'Your activity assignment was updated',
        details: [['Activity', a.activity.subject], ['Deadline', upd.deadline ? fmtDate(upd.deadline) : 'Not set'], ['Priority', humanize(upd.priority)]],
        remarks: b.statusRemarks,
        link: `/daamr/requests/${a.activityId}?tab=assignments`,
      });
    }
    if (data.isLead && a.activity.workflowInstanceId) await fillPendingAssignment(tx, a.activity.workflowInstanceId, user);
    return upd;
  });
  res.json(out);
});

/** Personal / coordinator task list. scope=mine (default) | given (assigned by me) | all (coordinators) */
daamrAssignmentsRouter.get('/assignments', requireAuth, async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const q = req.query;
  const and: any[] = [];
  if (q.scope === 'given') and.push({ assignedById: req.user!.id });
  else if (q.scope === 'all') {
    if (!can(req.user, 'daamr.assign') && !can(req.user, 'workflow.override')) throw forbidden();
    if (!can(req.user, 'daamr.request.view_all') && !can(req.user, 'workflow.override')) and.push({ OR: [{ assignedById: req.user!.id }, { activity: { districtId: req.user!.districtId ?? '__none__' } }] });
  } else and.push({ assigneeId: req.user!.id });
  if (q.status === 'open') and.push({ status: { in: ACTIVE_ASSIGNMENT } });
  else if (q.status) and.push({ status: String(q.status) });
  if (q.overdue === '1') and.push({ status: { in: ACTIVE_ASSIGNMENT }, deadline: { lt: new Date() } });
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.activityAssignment.findMany({
      where,
      include: { ...assignmentInclude, activity: { select: { id: true, daamrId: true, subject: true, startDate: true, endDate: true, lifecycle: true, priority: true, district: { select: { name: true } } } } },
      orderBy: [{ deadline: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.activityAssignment.count({ where }),
  ]);
  const now = new Date();
  res.json({ rows: rows.map((r) => ({ ...r, overdue: ACTIVE_ASSIGNMENT.includes(r.status) && !!r.deadline && r.deadline < now })), total, page, pageSize });
});

// ───────────── Deadline reminders (run by the background sweep) ─────────────

export async function sendAssignmentReminders() {
  const s = await getSettings();
  if (!s.activityRemindersEnabled) return { upcoming: 0, overdue: 0 };
  const now = new Date();
  const soon = new Date(now.getTime() + s.activityDeadlineReminderDays * 86_400_000);
  const base = { status: { in: ACTIVE_ASSIGNMENT }, activity: { lifecycle: { notIn: CLOSED_LIFECYCLE } } };
  const include = { assignee: true, assignedBy: true, activity: { select: { id: true, daamrId: true, subject: true } } };
  const [upcoming, overdue] = await Promise.all([
    prisma.activityAssignment.findMany({ where: { ...base, deadline: { gte: now, lte: soon }, reminderSentAt: null }, include }),
    prisma.activityAssignment.findMany({ where: { ...base, deadline: { lt: now }, overdueNotifiedAt: null }, include }),
  ]);
  if (!upcoming.length && !overdue.length) return { upcoming: 0, overdue: 0 };
  await transact(async (tx) => {
    for (const a of upcoming) {
      const claimed = await tx.activityAssignment.updateMany({ where: { id: a.id, reminderSentAt: null }, data: { reminderSentAt: now } });
      if (!claimed.count) continue;
      await notify(tx, {
        recipients: [a.assignee], event: 'DEADLINE_UPCOMING', module: 'DAAMR', entityRef: a.activity.daamrId,
        title: `Upcoming deadline: ${fmtDate(a.deadline)}`,
        details: [['Activity', a.activity.subject], ['Responsibilities', a.responsibilities], ['Status', humanize(a.status)]],
        link: `/daamr/requests/${a.activity.id}?tab=assignments`,
      });
    }
    for (const a of overdue) {
      const claimed = await tx.activityAssignment.updateMany({ where: { id: a.id, overdueNotifiedAt: null }, data: { overdueNotifiedAt: now } });
      if (!claimed.count) continue;
      await notify(tx, {
        recipients: [a.assignee, a.assignedBy.id !== a.assigneeId ? a.assignedBy : null], event: 'TASK_OVERDUE', module: 'DAAMR', entityRef: a.activity.daamrId,
        title: `Task overdue (deadline ${fmtDate(a.deadline)}) — ${a.assignee.name}`,
        details: [['Activity', a.activity.subject], ['Responsibilities', a.responsibilities], ['Status', humanize(a.status)]],
        link: `/daamr/requests/${a.activity.id}?tab=assignments`,
      });
    }
  });
  return { upcoming: upcoming.length, overdue: overdue.length };
}

daamrAssignmentsRouter.post('/assignments/reminders/run', requirePerm('admin.settings'), async (req, res) => {
  const r = await sendAssignmentReminders();
  await audit(prisma, req, { action: 'ACTIVITY_REMINDERS_SENT', module: 'DAAMR', entityType: 'ActivityAssignment', after: r });
  res.json(r);
});
