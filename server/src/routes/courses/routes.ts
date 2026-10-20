import { Router } from 'express';
import { z } from 'zod';
import { prisma, icontains, type Tx } from '../../db.js';
import { requireAuth, requirePerm, can, type AuthUser } from '../../lib/auth.js';
import { audit, diff } from '../../lib/audit.js';
import { HttpError, badRequest, conflict, forbidden, notFound, pageParams, parse, zDate, zOptStr, zStr, dateRangeFilter } from '../../lib/http.js';
import { notify, transact } from '../../lib/notify.js';
import { fileSelect } from '../../lib/files.js';
import { getSettings } from '../../lib/settings.js';
import { fmtDate, humanize, sendExport } from '../../lib/export.js';
import { assignFirstLevel, buildTimeline, cancel as cancelWorkflow, resubmit, startWorkflow } from '../../workflow/engine.js';
import { mountWorkflowRoutes, workflowFlags } from '../workflowRoutes.js';
import {
  COURSE_STATUS, REPORT_OWED, RESOLVED, SESSION_DOC_CATEGORIES, SESSION_PHOTO_CATEGORIES, canViewCourse, completionBlockers, courseProgress, courseRoles,
  courseScope, createCourseFromActivity, dayOnly, todayUtc,
} from './common.js';
import { courseWorkbook, generateCourseReport } from './report.js';

export const coursesRouter = Router();
export const sessionsRouter = Router();
export const completionRouter = Router();

const DAY = 86_400_000;
const zTime = z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));
const reason = z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(2000);

async function guardCourse(user: AuthUser, id: string) {
  if (!(await canViewCourse(user, id))) {
    if (!(await prisma.course.count({ where: { id } }))) throw notFound('Course not found.');
    throw forbidden('You do not have access to this course.');
  }
  return (await courseRoles(user, id))!;
}
async function loadSession(user: AuthUser, sid: string) {
  const x = await prisma.courseSession.findUnique({ where: { id: sid }, include: { course: true } });
  if (!x) throw notFound('Session not found.');
  const roles = await guardCourse(user, x.courseId);
  return { x, roles };
}

// ───────────── Listing & dashboard ─────────────

function listWhere(user: AuthUser, q: any) {
  const and: any[] = [courseScope(user)];
  if (q.q) {
    const s = String(q.q).trim();
    and.push({ OR: [{ courseNo: icontains(s) }, { title: icontains(s) }, { venue: icontains(s) }, { district: { name: icontains(s) } }, { coordinator: { name: icontains(s) } }, { trainers: { some: { name: icontains(s) } } }] });
  }
  if (q.districtId) and.push({ districtId: String(q.districtId) });
  if (q.category) and.push({ category: String(q.category) });
  if (q.coordinatorId) and.push({ coordinatorId: String(q.coordinatorId) });
  if (q.trainer) and.push({ trainers: { some: { name: icontains(String(q.trainer)) } } });
  if (q.status) and.push({ status: { in: String(q.status).split(',') } });
  if (q.mine === '1') and.push({ OR: [{ coordinatorId: user.id }, { staff: { some: { userId: user.id } } }, { trainers: { some: { userId: user.id } } }] });
  const range = dateRangeFilter(q.from, q.to);
  // courses overlapping the period
  if (range?.gte) and.push({ endDate: { gte: range.gte } });
  if (range?.lte) and.push({ startDate: { lte: range.lte } });
  return { AND: and };
}

async function decorate(rows: any[]) {
  const s = await getSettings();
  const today = todayUtc();
  const due = new Date(today.getTime() - s.courseReportDueDays * DAY);
  const graceEnd = new Date(today.getTime() - s.courseCompletionGraceDays * DAY);
  return rows.map((c) => {
    const ss = c.sessions as { status: string; sessionDate: Date; conducted: boolean }[];
    const total = ss.length;
    const resolved = ss.filter((x) => ['MISSED', 'CANCELLED'].includes(x.status)).length;
    const verified = ss.filter((x) => x.status === 'VERIFIED').length;
    const pending = ss.filter((x) => REPORT_OWED.includes(x.status) && x.sessionDate <= today).length;
    const lateReports = ss.filter((x) => REPORT_OWED.includes(x.status) && x.sessionDate < due).length;
    const open = !['COMPLETED', 'CANCELLED'].includes(c.status);
    return {
      ...c,
      sessions: undefined,
      totalSessions: total,
      verifiedSessions: verified,
      pendingReports: pending,
      completionPercent: total ? Math.round(((verified + resolved) / total) * 100) : 0,
      overdue: open && (lateReports > 0 || (c.endDate < graceEnd && c.status !== 'AWAITING_VERIFICATION')),
      lateReports,
      deletable: c.status !== 'COMPLETED' && !ss.some((x: any) => x.workflowInstanceId) && !c.completion?.workflowInstanceId,
      completion: undefined,
    };
  });
}

const listSelect = {
  id: true, courseNo: true, title: true, category: true, venue: true, durationDays: true, startDate: true, endDate: true, status: true, completedAt: true, activityId: true,
  district: { select: { id: true, name: true } },
  coordinator: { select: { id: true, name: true, designation: true } },
  trainers: { where: { isActive: true }, select: { id: true, name: true, isGuest: true } },
  sessions: { select: { status: true, sessionDate: true, conducted: true, workflowInstanceId: true } },
  completion: { select: { workflowInstanceId: true } },
};

coursesRouter.get('/', requireAuth, async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const where = listWhere(req.user!, req.query);
  let rows = await decorate(await prisma.course.findMany({ where, select: listSelect, orderBy: [{ startDate: 'desc' }] }));
  if (req.query.reportsPending === '1') rows = rows.filter((r) => r.pendingReports > 0);
  if (req.query.overdue === '1') rows = rows.filter((r) => r.overdue);
  res.json({ rows: rows.slice(skip, skip + take), total: rows.length, page, pageSize });
});

coursesRouter.get('/dashboard', requireAuth, async (req, res) => {
  const rows = await decorate(await prisma.course.findMany({ where: listWhere(req.user!, req.query), select: listSelect }));
  const by = (st: string) => rows.filter((r) => r.status === st).length;
  const [sessionsToday, awaitingMyReview] = await Promise.all([
    prisma.courseSession.findMany({
      where: { sessionDate: todayUtc(), course: { AND: [courseScope(req.user!), { status: 'IN_PROGRESS' }] }, status: { notIn: ['CANCELLED'] } },
      select: { id: true, dayNumber: true, status: true, topic: true, courseId: true, course: { select: { title: true, courseNo: true, venue: true } } },
    }),
    prisma.workflowInstance.count({ where: { currentAssigneeId: req.user!.id, status: 'IN_PROGRESS', module: { in: ['COURSE_SESSION', 'COURSE_COMPLETION'] } } }),
  ]);
  res.json({
    cards: {
      total: rows.filter((r) => r.status !== 'CANCELLED').length,
      upcoming: by('AWAITING_START'),
      inProgress: by('IN_PROGRESS'),
      dailyReportsPending: rows.reduce((a, r) => a + r.pendingReports, 0),
      coursesWithPendingReports: rows.filter((r) => r.pendingReports > 0).length,
      awaitingVerification: by('AWAITING_VERIFICATION'),
      completed: by('COMPLETED'),
      overdue: rows.filter((r) => r.overdue).length,
    },
    today: sessionsToday,
    awaitingMyReview,
  });
});

coursesRouter.get('/export', requireAuth, async (req, res) => {
  const where = listWhere(req.user!, req.query);
  if (req.query.courseId) {
    const roles = await guardCourse(req.user!, String(req.query.courseId));
    if (!can(req.user, 'course.export') && !roles.author && !roles.manage) throw forbidden('You are not permitted to export this course.');
    where.AND.push({ id: String(req.query.courseId) });
  } else if (!can(req.user, 'course.export')) throw forbidden('You are not permitted to export courses.');
  const ids = (await prisma.course.findMany({ where, select: { id: true }, take: 500 })).map((c) => c.id);
  await audit(prisma, req, { action: 'EXPORT', module: 'COURSE', entityType: 'Course', after: { format: 'xlsx', filters: req.query, count: ids.length } });
  await sendExport(res, 'xlsx', await courseWorkbook(ids), req.user!.name);
});

/** Retry / manual set-up for an approved course proposal (idempotent). */
coursesRouter.post('/setup/:activityId', requirePerm('course.manage'), async (req, res) => {
  const a = await prisma.activityRequest.findUnique({ where: { id: String(req.params.activityId) } });
  if (!a) throw notFound();
  if (a.activityType !== 'COURSE' || a.status !== 'APPROVED') throw conflict('Only approved course proposals can be set up as courses.');
  const r = await transact((tx) => createCourseFromActivity(tx, a.id, { id: req.user!.id, name: req.user!.name }));
  res.status(r.created ? 201 : 200).json({ id: r.course.id, courseNo: r.course.courseNo, created: r.created });
});

// ───────────── Course detail ─────────────

coursesRouter.get('/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const roles = await guardCourse(req.user!, id);
  const s = await getSettings();
  const c = await prisma.course.findUniqueOrThrow({
    where: { id },
    include: {
      district: true,
      activity: { select: { id: true, daamrId: true, subject: true, approvedAt: true, requester: { select: { name: true } } } },
      coordinator: { select: { id: true, name: true, designation: true, email: true } },
      staff: { include: { user: { select: { id: true, name: true, designation: true } } } },
      trainers: { orderBy: { createdAt: 'asc' }, include: { user: { select: { id: true, name: true } } } },
      participants: { orderBy: { registrationNo: 'asc' } },
      sessions: {
        orderBy: { dayNumber: 'asc' },
        include: {
          trainers: { select: { name: true, isGuest: true } },
          workflow: { select: { status: true, currentAssignee: { select: { id: true, name: true } } } },
          _count: { select: { files: { where: { deletedAt: null, kind: 'PHOTO', category: { not: 'REVIEW_EVIDENCE' } } } } },
        },
      },
      scheduleChanges: { orderBy: { createdAt: 'asc' }, include: { by: { select: { name: true } }, session: { select: { dayNumber: true } } } },
      completion: true,
      reportVersions: { orderBy: { version: 'desc' }, include: { generatedBy: { select: { name: true } }, file: { select: { id: true, size: true, originalName: true } } } },
      files: { where: { deletedAt: null, category: { not: 'COURSE_REPORT' } }, select: fileSelect, orderBy: { createdAt: 'asc' } },
    },
  });
  const today = todayUtc();
  const due = new Date(today.getTime() - s.courseReportDueDays * DAY);
  const completionTimeline = c.completion?.workflowInstanceId ? await buildTimeline(prisma, c.completion.workflowInstanceId) : null;
  const completionFlags = await workflowFlags(req.user!, c.completion?.workflowInstanceId ?? null);
  const blockers = await completionBlockers(id);
  const open = !['COMPLETED', 'CANCELLED'].includes(c.status);
  res.json({
    course: {
      ...c,
      sessions: c.sessions.map((x) => ({
        ...x, workflow: undefined, reviewer: x.workflow?.status === 'IN_PROGRESS' ? x.workflow.currentAssignee : null,
        photos: x._count.files, _count: undefined, reportOverdue: REPORT_OWED.includes(x.status) && x.sessionDate < due, reportDue: REPORT_OWED.includes(x.status) && x.sessionDate <= today,
      })),
    },
    progress: await courseProgress(id),
    blockers,
    completionTimeline,
    completionFlags,
    settings: { nonTrainingWeekdays: s.courseNonTrainingWeekdays, holidays: s.courseHolidays, reportDueDays: s.courseReportDueDays, requirePhotos: s.courseRequirePhotos },
    can: {
      ...roles,
      editSchedule: c.status === 'AWAITING_START' && roles.coordinate,
      resolveSessions: open && roles.manage,
      addMakeup: open && c.status !== 'AWAITING_VERIFICATION' && roles.manage,
      manageTeam: open && roles.coordinate,
      manageParticipants: open && c.status !== 'AWAITING_VERIFICATION' && (roles.coordinate || roles.isStaff),
      editCompletion: roles.coordinate && c.status === 'IN_PROGRESS' && (!c.completion || ['DRAFT', 'CHANGES_REQUESTED'].includes(c.completion.status)),
      submitCompletion: roles.coordinate && c.status === 'IN_PROGRESS' && blockers.length === 0,
      generateReport: c.status === 'COMPLETED' && (roles.coordinate || can(req.user, 'course.export')),
      deleteCourse: roles.manage && c.status !== 'COMPLETED' && !c.sessions.some((x) => x.workflowInstanceId) && !c.completion?.workflowInstanceId,
      cancelCourse: roles.manage && !['COMPLETED', 'CANCELLED'].includes(c.status),
      previewReport: ['AWAITING_VERIFICATION', 'COMPLETED'].includes(c.status) || roles.author || roles.manage,
      selectPhotos: open && (roles.coordinate || roles.isStaff),
      export: can(req.user, 'course.export') || roles.author || roles.manage,
    },
  });
});

const courseEdit = z.object({ registeredCount: z.coerce.number().int().min(0).max(100000).optional(), coordinatorId: z.string().optional() });
coursesRouter.put('/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const roles = await guardCourse(req.user!, id);
  if (!roles.coordinate) throw forbidden();
  const b = parse(courseEdit, req.body);
  const c = await prisma.course.findUniqueOrThrow({ where: { id } });
  if (['COMPLETED', 'CANCELLED'].includes(c.status)) throw conflict('This course is closed.');
  if (b.coordinatorId && b.coordinatorId !== c.coordinatorId) {
    if (!roles.manage) throw forbidden('Only course administrators can change the coordinator.');
    if (!(await prisma.user.count({ where: { id: b.coordinatorId, isActive: true } }))) throw badRequest('Select an active user as coordinator.');
  }
  await transact(async (tx) => {
    await tx.course.update({ where: { id }, data: b });
    const d = diff(c as any, b);
    if (d.changed) await audit(tx, req, { action: 'COURSE_UPDATED', module: 'COURSE', entityType: 'Course', entityId: id, entityRef: c.courseNo, before: d.before, after: d.after });
  });
  res.json({ ok: true });
});

// ───────────── Team: trainers & staff ─────────────

const trainerBody = z.object({ name: zStr(150), designation: zOptStr(150), expertise: zOptStr(300), userId: zOptStr(40), isGuest: z.boolean().default(false) });
coursesRouter.post('/:id/trainers', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const roles = await guardCourse(req.user!, id);
  if (!roles.coordinate) throw forbidden();
  const b = parse(trainerBody, req.body);
  const c = await prisma.course.findUniqueOrThrow({ where: { id } });
  if (['COMPLETED', 'CANCELLED'].includes(c.status)) throw conflict('This course is closed.');
  const t = await transact(async (tx) => {
    const t = await tx.courseTrainer.create({ data: { ...b, courseId: id } });
    await audit(tx, req, { action: 'COURSE_TRAINER_ADDED', module: 'COURSE', entityType: 'Course', entityId: id, entityRef: c.courseNo, after: b });
    return t;
  });
  res.status(201).json(t);
});
coursesRouter.patch('/trainers/:tid', requireAuth, async (req, res) => {
  const t = await prisma.courseTrainer.findUnique({ where: { id: String(req.params.tid) }, include: { course: true } });
  if (!t) throw notFound();
  const roles = await guardCourse(req.user!, t.courseId);
  if (!roles.coordinate) throw forbidden();
  const b = parse(trainerBody.partial().extend({ isActive: z.boolean().optional() }), req.body);
  await transact(async (tx) => {
    await tx.courseTrainer.update({ where: { id: t.id }, data: b });
    await audit(tx, req, { action: 'COURSE_TRAINER_UPDATED', module: 'COURSE', entityType: 'Course', entityId: t.courseId, entityRef: t.course.courseNo, before: { name: t.name, isActive: t.isActive }, after: b });
  });
  res.json({ ok: true });
});
coursesRouter.post('/:id/staff', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const roles = await guardCourse(req.user!, id);
  if (!roles.coordinate) throw forbidden();
  const { userId, remove } = parse(z.object({ userId: zStr(40), remove: z.boolean().optional() }), req.body);
  const c = await prisma.course.findUniqueOrThrow({ where: { id } });
  await transact(async (tx) => {
    if (remove) await tx.courseStaff.deleteMany({ where: { courseId: id, userId } });
    else {
      const u = await tx.user.findUnique({ where: { id: userId } });
      if (!u?.isActive) throw badRequest('Select an active user.');
      await tx.courseStaff.upsert({ where: { courseId_userId: { courseId: id, userId } }, create: { courseId: id, userId }, update: {} });
      await notify(tx, { recipients: [u], event: 'COURSE_STAFF_ADDED', module: 'COURSE', entityRef: c.courseNo, title: `You were added to the course team: ${c.title}`, details: [['Dates', `${fmtDate(c.startDate)} – ${fmtDate(c.endDate)}`]], link: `/courses/${id}` });
    }
    await audit(tx, req, { action: remove ? 'COURSE_STAFF_REMOVED' : 'COURSE_STAFF_ADDED', module: 'COURSE', entityType: 'Course', entityId: id, entityRef: c.courseNo, after: { userId } });
  });
  res.json({ ok: true });
});

// ───────────── Participants ─────────────

const participantBody = z.object({ name: zStr(150), gender: zOptStr(20), institution: zOptStr(200), contact: zOptStr(60), registrationNo: zOptStr(40) });
coursesRouter.post('/:id/participants', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const roles = await guardCourse(req.user!, id);
  if (!roles.coordinate && !roles.isStaff) throw forbidden();
  const { participants } = parse(z.object({ participants: z.array(participantBody).min(1).max(500) }), req.body);
  const c = await prisma.course.findUniqueOrThrow({ where: { id } });
  if (['COMPLETED', 'CANCELLED', 'AWAITING_VERIFICATION'].includes(c.status)) throw conflict('Participants can no longer be changed.');
  const created = await transact(async (tx) => {
    let n = await tx.courseParticipant.count({ where: { courseId: id } });
    const out: { name: string }[] = [];
    for (const p of participants) {
      const registrationNo = p.registrationNo ?? `P-${String(++n).padStart(3, '0')}`;
      if (await tx.courseParticipant.count({ where: { courseId: id, registrationNo } })) throw badRequest(`Registration number ${registrationNo} is already used in this course.`);
      out.push(await tx.courseParticipant.create({ data: { ...p, registrationNo, courseId: id } }));
    }
    await audit(tx, req, { action: 'COURSE_PARTICIPANTS_ADDED', module: 'COURSE', entityType: 'Course', entityId: id, entityRef: c.courseNo, after: { count: out.length, names: out.map((x) => x.name) } });
    return out;
  });
  res.status(201).json(created);
});
coursesRouter.patch('/participants/:pid', requireAuth, async (req, res) => {
  const p = await prisma.courseParticipant.findUnique({ where: { id: String(req.params.pid) }, include: { course: true } });
  if (!p) throw notFound();
  const roles = await guardCourse(req.user!, p.courseId);
  if (!roles.coordinate && !roles.isStaff) throw forbidden();
  if (['COMPLETED', 'CANCELLED', 'AWAITING_VERIFICATION'].includes(p.course.status)) throw conflict('Participants can no longer be changed.');
  const b = parse(participantBody.omit({ registrationNo: true }).partial().extend({ isActive: z.boolean().optional() }), req.body);
  await transact(async (tx) => {
    await tx.courseParticipant.update({ where: { id: p.id }, data: b });
    await audit(tx, req, { action: 'COURSE_PARTICIPANT_UPDATED', module: 'COURSE', entityType: 'Course', entityId: p.courseId, entityRef: p.course.courseNo, before: { name: p.name, isActive: p.isActive }, after: b });
  });
  res.json({ ok: true });
});

// ───────────── Schedule ─────────────

async function refreshCourseDates(tx: Tx, courseId: string) {
  const ss = await tx.courseSession.findMany({ where: { courseId, status: { not: 'CANCELLED' } }, select: { sessionDate: true }, orderBy: { sessionDate: 'asc' } });
  if (ss.length) await tx.course.update({ where: { id: courseId }, data: { startDate: ss[0].sessionDate, endDate: ss[ss.length - 1].sessionDate } });
}

/** Edit the schedule before the course begins. Original dates are kept on each session and every change is logged with the reason. */
coursesRouter.put('/:id/schedule', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const roles = await guardCourse(req.user!, id);
  if (!roles.coordinate) throw forbidden('Only the coordinator or a course administrator can edit the schedule.');
  const b = parse(z.object({ reason, sessions: z.array(z.object({ id: zStr(40), sessionDate: zDate, startTime: zTime, endTime: zTime })).min(1) }), req.body);
  const c = await prisma.course.findUniqueOrThrow({ where: { id }, include: { sessions: { orderBy: { dayNumber: 'asc' } } } });
  if (c.status !== 'AWAITING_START') throw conflict('The schedule can only be edited before the course begins. After it starts, an administrator can reschedule, cancel or mark individual sessions as missed.');
  const s = await getSettings();
  const byId = new Map(c.sessions.map((x) => [x.id, x]));
  const next = c.sessions.map((x) => ({ ...x }));
  for (const u of b.sessions) {
    const x = next.find((y) => y.id === u.id);
    if (!x) throw badRequest('A session does not belong to this course.');
    x.sessionDate = u.sessionDate;
    if ('startTime' in (req.body.sessions.find((y: any) => y.id === u.id) ?? {})) x.startTime = u.startTime;
    if ('endTime' in (req.body.sessions.find((y: any) => y.id === u.id) ?? {})) x.endTime = u.endTime;
  }
  const today = todayUtc();
  for (let i = 0; i < next.length; i++) {
    const d = next[i].sessionDate;
    if (d < today) throw badRequest(`Day ${next[i].dayNumber}: the date cannot be in the past.`, { fields: { [`sessions.${i}.sessionDate`]: 'Date in the past' } });
    if (i > 0 && d <= next[i - 1].sessionDate) throw badRequest(`Day ${next[i].dayNumber} must be after day ${next[i - 1].dayNumber}.`);
    if (s.courseHolidays.includes(d.toISOString().slice(0, 10))) throw badRequest(`Day ${next[i].dayNumber} falls on a configured holiday.`);
  }
  await transact(async (tx) => {
    for (const x of next) {
      const before = byId.get(x.id)!;
      const moved = before.sessionDate.getTime() !== x.sessionDate.getTime();
      const retimed = before.startTime !== x.startTime || before.endTime !== x.endTime;
      if (!moved && !retimed) continue;
      await tx.courseSession.update({ where: { id: x.id }, data: { sessionDate: x.sessionDate, startTime: x.startTime, endTime: x.endTime } });
      await tx.courseScheduleChange.create({ data: { courseId: id, sessionId: x.id, changeType: moved ? 'RESCHEDULED' : 'TIME_CHANGED', fromDate: before.sessionDate, toDate: x.sessionDate, reason: b.reason, byId: req.user!.id } });
    }
    await refreshCourseDates(tx, id);
    await audit(tx, req, { action: 'COURSE_SCHEDULE_EDITED', module: 'COURSE', entityType: 'Course', entityId: id, entityRef: c.courseNo, after: { reason: b.reason, sessions: b.sessions.length } });
  });
  res.json({ ok: true });
});

/** Administrator actions for exceptional cases: missed, cancelled or rescheduled sessions (mandatory reason). */
sessionsRouter.post('/:sid/resolve', requireAuth, async (req, res) => {
  const { x, roles } = await loadSession(req.user!, String(req.params.sid));
  if (!roles.manage) throw forbidden('Only authorised course administrators can record missed, cancelled or rescheduled sessions.');
  const b = parse(z.object({ action: z.enum(['MISSED', 'CANCELLED', 'RESCHEDULED']), reason, newDate: zDate.optional(), startTime: zTime, endTime: zTime }), req.body);
  if (['COMPLETED', 'CANCELLED', 'AWAITING_VERIFICATION'].includes(x.course.status)) throw conflict('The course is closed or awaiting final verification.');
  if (x.status === 'VERIFIED') throw conflict('A verified session cannot be changed.');
  if (['MISSED', 'CANCELLED'].includes(x.status)) throw conflict(`This session is already recorded as ${x.status.toLowerCase()}.`);
  if (b.action === 'RESCHEDULED') {
    if (!b.newDate) throw badRequest('Choose the new date.', { fields: { newDate: 'Required' } });
    if (b.newDate < todayUtc()) throw badRequest('The new date cannot be in the past.', { fields: { newDate: 'Date in the past' } });
    if (x.status === 'SUBMITTED') throw conflict('The report for this session is under review and the session cannot be rescheduled.');
  }
  await transact(async (tx) => {
    if (x.status === 'SUBMITTED' && x.workflowInstanceId) await cancelWorkflow(tx, x.workflowInstanceId, req.user!, `Session recorded as ${b.action.toLowerCase()}: ${b.reason}`);
    if (b.action === 'RESCHEDULED') {
      await tx.courseSession.update({ where: { id: x.id }, data: { sessionDate: b.newDate!, startTime: b.startTime ?? x.startTime, endTime: b.endTime ?? x.endTime, conducted: false, dayNotifiedAt: null, reportDueNotifiedAt: null } });
    } else {
      await tx.courseSession.update({ where: { id: x.id }, data: { status: b.action, resolutionReason: b.reason } });
    }
    await tx.courseScheduleChange.create({ data: { courseId: x.courseId, sessionId: x.id, changeType: b.action, fromDate: x.sessionDate, toDate: b.newDate ?? null, reason: b.reason, byId: req.user!.id } });
    await refreshCourseDates(tx, x.courseId);
    await audit(tx, req, { action: `SESSION_${b.action}`, module: 'COURSE', entityType: 'CourseSession', entityId: x.id, entityRef: `${x.course.courseNo} Day ${x.dayNumber}`, before: { status: x.status, date: x.sessionDate }, after: b });
    const coord = await tx.user.findUniqueOrThrow({ where: { id: x.course.coordinatorId } });
    await notify(tx, { recipients: [coord], event: `SESSION_${b.action}`, module: 'COURSE', entityRef: `${x.course.courseNo} Day ${x.dayNumber}`, title: `Day ${x.dayNumber} recorded as ${humanize(b.action).toLowerCase()}`, details: [['Course', x.course.title], ['Original date', fmtDate(x.sessionDate)], ['New date', b.newDate ? fmtDate(b.newDate) : null]], remarks: b.reason, link: `/courses/${x.courseId}?tab=schedule` });
  });
  res.json({ ok: true });
});

/** Add a make-up session (approved schedule change). */
coursesRouter.post('/:id/sessions', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const roles = await guardCourse(req.user!, id);
  if (!roles.manage) throw forbidden('Only authorised course administrators can add sessions.');
  const b = parse(z.object({ sessionDate: zDate, startTime: zTime, endTime: zTime, reason }), req.body);
  const c = await prisma.course.findUniqueOrThrow({ where: { id } });
  if (['COMPLETED', 'CANCELLED', 'AWAITING_VERIFICATION'].includes(c.status)) throw conflict('The course is closed or awaiting final verification.');
  const x = await transact(async (tx) => {
    const last = await tx.courseSession.aggregate({ where: { courseId: id }, _max: { dayNumber: true } });
    const x = await tx.courseSession.create({ data: { courseId: id, dayNumber: (last._max.dayNumber ?? 0) + 1, sessionDate: b.sessionDate, originalDate: b.sessionDate, startTime: b.startTime ?? c.dailyStartTime, endTime: b.endTime ?? c.dailyEndTime, venue: c.venue, isMakeup: true } });
    await tx.courseScheduleChange.create({ data: { courseId: id, sessionId: x.id, changeType: 'MAKEUP_ADDED', toDate: b.sessionDate, reason: b.reason, byId: req.user!.id } });
    await refreshCourseDates(tx, id);
    await audit(tx, req, { action: 'SESSION_MAKEUP_ADDED', module: 'COURSE', entityType: 'CourseSession', entityId: x.id, entityRef: `${c.courseNo} Day ${x.dayNumber}`, after: b });
    return x;
  });
  res.status(201).json(x);
});

// ───────────── Daily session report ─────────────

sessionsRouter.get('/:sid', requireAuth, async (req, res) => {
  const { roles } = await loadSession(req.user!, String(req.params.sid));
  const x = await prisma.courseSession.findUniqueOrThrow({
    where: { id: String(req.params.sid) },
    include: {
      course: { include: { trainers: { where: { isActive: true }, orderBy: { createdAt: 'asc' } }, participants: { where: { isActive: true }, orderBy: { registrationNo: 'asc' } }, coordinator: { select: { id: true, name: true } } } },
      trainers: true,
      attendance: true,
      files: { where: { deletedAt: null }, select: fileSelect, orderBy: { createdAt: 'asc' } },
      changes: { orderBy: { createdAt: 'asc' }, include: { by: { select: { name: true } } } },
      updatedBy: { select: { name: true } },
    },
  });
  const s = await getSettings();
  const flags = await workflowFlags(req.user!, x.workflowInstanceId);
  const editable = ['SCHEDULED', 'IN_PROGRESS', 'CHANGES_REQUESTED'].includes(x.status) && !['COMPLETED', 'CANCELLED', 'AWAITING_VERIFICATION'].includes(x.course.status);
  const isDay = x.sessionDate <= todayUtc();
  const prevNext = await prisma.courseSession.findMany({ where: { courseId: x.courseId, dayNumber: { in: [x.dayNumber - 1, x.dayNumber + 1] } }, select: { id: true, dayNumber: true } });
  res.json({
    session: x,
    timeline: x.workflowInstanceId ? await buildTimeline(prisma, x.workflowInstanceId) : null,
    nav: { prev: prevNext.find((p) => p.dayNumber === x.dayNumber - 1) ?? null, next: prevNext.find((p) => p.dayNumber === x.dayNumber + 1) ?? null },
    requirePhotos: s.courseRequirePhotos,
    photoCategories: SESSION_PHOTO_CATEGORIES,
    docCategories: SESSION_DOC_CATEGORIES,
    can: {
      ...flags,
      edit: editable && (roles.author || roles.manage),
      markConducted: editable && isDay && (roles.author || roles.manage),
      submit: editable && isDay && (roles.author || roles.manage) && (x.status !== 'CHANGES_REQUESTED' || !x.workflowInstanceId || (await prisma.workflowInstance.count({ where: { id: x.workflowInstanceId, submittedById: req.user!.id } })) > 0 || can(req.user, 'workflow.override')),
      resolve: roles.manage && !['VERIFIED', 'MISSED', 'CANCELLED'].includes(x.status) && !['COMPLETED', 'CANCELLED', 'AWAITING_VERIFICATION'].includes(x.course.status),
      selectPhotos: (roles.coordinate || roles.isStaff) && x.course.status !== 'COMPLETED',
      isFuture: !isDay,
    },
  });
});

const sessionBody = z.object({
  topic: zOptStr(300),
  learningObjectives: zOptStr(5000),
  topicsCovered: zOptStr(10000),
  activities: zOptStr(8000),
  tools: zOptStr(3000),
  achievements: zOptStr(8000),
  challenges: zOptStr(5000),
  nextPlan: zOptStr(5000),
  startTime: zTime,
  endTime: zTime,
  conducted: z.boolean().optional(),
  trainers: z.array(z.object({ trainerId: zOptStr(40), name: zOptStr(150), designation: zOptStr(150), isGuest: z.boolean().default(false) })).max(20).optional(),
  attendanceMode: z.enum(['SUMMARY', 'PARTICIPANT']).optional(),
  attendance: z.array(z.object({ participantId: zStr(40), status: z.enum(['PRESENT', 'ABSENT', 'LEAVE']), remarks: zOptStr(300) })).max(1000).optional(),
  registeredCount: z.union([z.coerce.number().int().min(0).max(100000), z.null()]).optional(),
  presentCount: z.union([z.coerce.number().int().min(0).max(100000), z.null()]).optional(),
  absentCount: z.union([z.coerce.number().int().min(0).max(100000), z.null()]).optional(),
  attendanceRemarks: zOptStr(3000),
});

const CONTENT_KEYS = ['topic', 'learningObjectives', 'topicsCovered', 'activities', 'tools', 'achievements', 'challenges', 'nextPlan', 'attendanceRemarks'] as const;

sessionsRouter.put('/:sid', requireAuth, async (req, res) => {
  const { x, roles } = await loadSession(req.user!, String(req.params.sid));
  if (!roles.author && !roles.manage) throw forbidden('Only the course coordinator, course staff or the course trainers can write daily reports.');
  if (!['SCHEDULED', 'IN_PROGRESS', 'CHANGES_REQUESTED'].includes(x.status)) throw conflict(`This report is ${humanize(x.status).toLowerCase()} and cannot be edited.`);
  if (['COMPLETED', 'CANCELLED', 'AWAITING_VERIFICATION'].includes(x.course.status)) throw conflict('The course is closed or awaiting final verification.');
  const b = parse(sessionBody, req.body);
  const has = (k: string) => k in (req.body ?? {});
  if (b.conducted && x.sessionDate > todayUtc()) throw badRequest('A class cannot be marked as conducted before its session date.', { fields: { conducted: 'Session date is in the future' } });

  const data: any = { updatedById: req.user!.id };
  for (const k of CONTENT_KEYS) if (has(k)) data[k] = (b as any)[k];
  if (has('startTime')) data.startTime = b.startTime;
  if (has('endTime')) data.endTime = b.endTime;
  if (has('conducted')) data.conducted = !!b.conducted;
  if (x.status === 'SCHEDULED') data.status = 'IN_PROGRESS';

  // Attendance: totals are computed from participant-level records when those are used, so they can never contradict.
  const mode = b.attendanceMode ?? x.attendanceMode;
  let records: { participantId: string; status: string; remarks: string | null }[] | null = null;
  if (has('attendanceMode') || has('attendance') || has('presentCount') || has('absentCount') || has('registeredCount')) {
    data.attendanceMode = mode;
    if (mode === 'PARTICIPANT') {
      const active = await prisma.courseParticipant.findMany({ where: { courseId: x.courseId, isActive: true }, select: { id: true } });
      if (!active.length) throw badRequest('Register participants for the course before recording participant-wise attendance.');
      const ids = new Set(active.map((p) => p.id));
      records = (b.attendance ?? []).map((a) => ({ participantId: a.participantId, status: a.status, remarks: a.remarks }));
      if (records.some((r) => !ids.has(r.participantId))) throw badRequest('Attendance includes a participant who is not registered for this course.');
      if (new Set(records.map((r) => r.participantId)).size !== records.length) throw badRequest('A participant appears more than once in the attendance.');
      const present = records.filter((r) => r.status === 'PRESENT').length;
      const absent = records.length - present;
      if ((b.presentCount != null && b.presentCount !== present) || (b.absentCount != null && b.absentCount !== absent)) {
        throw badRequest(`The totals contradict the participant-wise attendance (${present} present, ${absent} absent or on leave).`, { fields: { presentCount: 'Must match participant-wise attendance' } });
      }
      Object.assign(data, { registeredCount: active.length, presentCount: records.length ? present : null, absentCount: records.length ? absent : null });
    } else {
      const activeCount = await prisma.courseParticipant.count({ where: { courseId: x.courseId, isActive: true } });
      const reg = activeCount || (b.registeredCount ?? x.registeredCount ?? x.course.registeredCount);
      const present = has('presentCount') ? b.presentCount : x.presentCount;
      const absent = has('absentCount') ? b.absentCount : x.absentCount;
      if (present != null && absent != null && present + absent !== reg) {
        throw badRequest(`Present (${present}) plus absent (${absent}) must equal the registered participants (${reg}).`, { fields: { absentCount: 'Present + absent must equal registered' } });
      }
      if (present != null && present > reg) throw badRequest('Present participants cannot exceed registered participants.', { fields: { presentCount: 'More than registered' } });
      Object.assign(data, { registeredCount: reg, presentCount: present ?? null, absentCount: absent ?? (present != null ? reg - present : null) });
    }
  }

  let trainerRows: { trainerId: string | null; name: string; designation: string | null; isGuest: boolean }[] | null = null;
  if (b.trainers) {
    const course = await prisma.courseTrainer.findMany({ where: { courseId: x.courseId } });
    trainerRows = b.trainers.map((t) => {
      if (t.trainerId) {
        const ct = course.find((c) => c.id === t.trainerId);
        if (!ct) throw badRequest('A selected trainer is not approved for this course.');
        return { trainerId: ct.id, name: ct.name, designation: ct.designation, isGuest: ct.isGuest };
      }
      if (!t.name) throw badRequest('Enter the name of each guest trainer.', { fields: { trainers: 'Guest trainer name required' } });
      return { trainerId: null, name: t.name, designation: t.designation, isGuest: true };
    });
  }

  const before = { ...x, course: undefined };
  await transact(async (tx) => {
    await tx.courseSession.update({ where: { id: x.id }, data });
    if (records) {
      await tx.sessionAttendance.deleteMany({ where: { sessionId: x.id } });
      if (records.length) await tx.sessionAttendance.createMany({ data: records.map((r) => ({ ...r, sessionId: x.id })) });
    }
    if (trainerRows) {
      await tx.courseSessionTrainer.deleteMany({ where: { sessionId: x.id } });
      if (trainerRows.length) await tx.courseSessionTrainer.createMany({ data: trainerRows.map((t) => ({ ...t, sessionId: x.id })) });
    }
    const d = diff(before as any, data);
    delete d.after.updatedById;
    await audit(tx, req, {
      action: has('conducted') && b.conducted && !x.conducted ? 'SESSION_CONDUCTED' : 'SESSION_REPORT_SAVED', module: 'COURSE', entityType: 'CourseSession', entityId: x.id, entityRef: `${x.course.courseNo} Day ${x.dayNumber}`,
      before: d.before, after: { ...d.after, ...(records ? { attendanceRecords: records.length } : {}), ...(trainerRows ? { trainers: trainerRows.map((t) => t.name) } : {}) },
    });
  });
  res.json({ ok: true });
});

function snapshot(x: any) {
  return {
    dayNumber: x.dayNumber, sessionDate: x.sessionDate, topic: x.topic, learningObjectives: x.learningObjectives, topicsCovered: x.topicsCovered, activities: x.activities, tools: x.tools,
    achievements: x.achievements, challenges: x.challenges, nextPlan: x.nextPlan, presentCount: x.presentCount, absentCount: x.absentCount, registeredCount: x.registeredCount,
    attendanceRemarks: x.attendanceRemarks, trainers: x.trainers?.map((t: any) => t.name), attendance: x.attendance?.map((a: any) => [a.participantId, a.status]),
    files: x.files?.map((f: any) => f.originalName),
  };
}

sessionsRouter.post('/:sid/submit', requireAuth, async (req, res) => {
  const { x: base, roles } = await loadSession(req.user!, String(req.params.sid));
  if (!roles.author && !roles.manage) throw forbidden();
  const s = await getSettings();
  const x = await prisma.courseSession.findUniqueOrThrow({ where: { id: base.id }, include: { course: true, trainers: true, attendance: true, files: { where: { deletedAt: null } } } });
  if (!['SCHEDULED', 'IN_PROGRESS', 'CHANGES_REQUESTED'].includes(x.status)) throw conflict('This report has already been submitted.');
  if (x.course.status !== 'IN_PROGRESS') throw conflict('Daily reports can only be submitted while the course is in progress.');
  if (x.sessionDate > todayUtc()) throw conflict('The report can be submitted on or after the session date.');
  const missing: Record<string, string> = {};
  if (!x.conducted) missing.conducted = 'Mark the class as conducted';
  if (!x.topic) missing.topic = "Enter today's topic";
  if (!x.topicsCovered) missing.topicsCovered = 'Describe the topics covered';
  if (!x.trainers.length) missing.trainers = 'Record at least one trainer';
  if (x.presentCount == null) missing.presentCount = 'Record attendance';
  if (x.attendanceMode === 'PARTICIPANT') {
    const active = await prisma.courseParticipant.count({ where: { courseId: x.courseId, isActive: true } });
    if (x.attendance.length !== active) missing.attendance = `Record attendance for all ${active} registered participants`;
  }
  if (s.courseRequirePhotos && !x.files.some((f) => f.kind === 'PHOTO' && f.category !== 'REVIEW_EVIDENCE')) missing.photos = 'Upload at least one photograph of the session';
  if (Object.keys(missing).length) throw new HttpError(422, `Complete the daily report before submitting: ${Object.values(missing).join('; ')}.`, { fields: missing });
  await transact(async (tx) => {
    if (!x.workflowInstanceId) {
      const inst = await startWorkflow(tx, { module: 'COURSE_SESSION', entityType: 'CourseSession', entityId: x.id, entityRef: `${x.course.courseNo} Day ${x.dayNumber}`, districtId: x.course.districtId, actor: req.user!, snapshot: snapshot(x) });
      await tx.courseSession.update({ where: { id: x.id }, data: { workflowInstanceId: inst.id, submittedAt: new Date(), status: 'SUBMITTED' } });
      await assignFirstLevel(tx, inst.id, req.user!);
    } else {
      await tx.courseSession.update({ where: { id: x.id }, data: { version: x.version + 1, submittedAt: new Date() } });
      await resubmit(tx, x.workflowInstanceId, req.user!, { entityType: 'CourseSession', entityId: x.id, snapshot: snapshot(x), remarks: req.body?.remarks ?? null });
    }
    await audit(tx, req, { action: x.workflowInstanceId ? 'SESSION_REPORT_RESUBMITTED' : 'SESSION_REPORT_SUBMITTED', module: 'COURSE', entityType: 'CourseSession', entityId: x.id, entityRef: `${x.course.courseNo} Day ${x.dayNumber}` });
  });
  res.json({ ok: true });
});

/** Select photographs for the final report. */
sessionsRouter.patch('/files/:fid/feature', requireAuth, async (req, res) => {
  const f = await prisma.file.findUnique({ where: { id: String(req.params.fid) }, include: { courseSession: true } });
  const courseId = f?.courseSession?.courseId ?? f?.courseId;
  if (!f || f.deletedAt || !courseId || f.kind !== 'PHOTO') throw notFound();
  const roles = await guardCourse(req.user!, courseId);
  if (!roles.coordinate && !roles.isStaff) throw forbidden();
  const { featured } = parse(z.object({ featured: z.boolean() }), req.body);
  await prisma.file.update({ where: { id: f.id }, data: { featured } });
  await audit(prisma, req, { action: featured ? 'PHOTO_SELECTED_FOR_REPORT' : 'PHOTO_UNSELECTED_FOR_REPORT', module: 'COURSE', entityType: 'File', entityId: f.id, entityRef: f.originalName });
  res.json({ ok: true });
});

// ───────────── Delete / cancel ─────────────

/** Permanently deletes a course that has no submitted reports (e.g. created in error). The proposal can be set up again. */
coursesRouter.post('/:id/delete', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const roles = await guardCourse(req.user!, id);
  if (!roles.manage) throw forbidden('Only course administrators can delete courses.');
  const { reason: why } = parse(z.object({ reason }), req.body ?? {});
  const c = await prisma.course.findUniqueOrThrow({ where: { id }, include: { sessions: { select: { id: true, workflowInstanceId: true } }, completion: true, reportVersions: true } });
  if (c.status === 'COMPLETED' || c.reportVersions.length) throw conflict('A completed course cannot be deleted.');
  if (c.sessions.some((x) => x.workflowInstanceId) || c.completion?.workflowInstanceId) {
    throw conflict('Daily or completion reports have already been submitted for this course, and their review history must be kept. Cancel the course instead.');
  }
  await transact(async (tx) => {
    const sessionIds = c.sessions.map((x) => x.id);
    await tx.file.updateMany({ where: { OR: [{ courseId: id }, { courseSessionId: { in: sessionIds } }] }, data: { deletedAt: new Date(), courseId: null, courseSessionId: null } });
    await tx.course.delete({ where: { id } });
    await tx.activityRequest.update({ where: { id: c.activityId }, data: { lifecycle: 'APPROVED', executionStatus: 'NOT_STARTED' } });
    await audit(tx, req, { action: 'COURSE_DELETED', module: 'COURSE', entityType: 'Course', entityId: id, entityRef: c.courseNo, before: { title: c.title, sessions: c.sessions.length, status: c.status }, after: { reason: why } });
  });
  res.json({ ok: true, activityId: c.activityId });
});

/** Cancels a course; all records and review history are kept. */
coursesRouter.post('/:id/cancel', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const roles = await guardCourse(req.user!, id);
  if (!roles.manage) throw forbidden('Only course administrators can cancel courses.');
  const { reason: why } = parse(z.object({ reason }), req.body ?? {});
  const c = await prisma.course.findUniqueOrThrow({ where: { id }, include: { sessions: { include: { workflow: true } }, completion: { include: { workflow: true } }, coordinator: true } });
  if (['COMPLETED', 'CANCELLED'].includes(c.status)) throw conflict(`This course is already ${c.status.toLowerCase()}.`);
  await transact(async (tx) => {
    for (const x of c.sessions) if (x.workflow && ['IN_PROGRESS', 'RETURNED'].includes(x.workflow.status)) await cancelWorkflow(tx, x.workflow.id, req.user!, `Course cancelled: ${why}`);
    if (c.completion?.workflow && ['IN_PROGRESS', 'RETURNED'].includes(c.completion.workflow.status)) await cancelWorkflow(tx, c.completion.workflow.id, req.user!, `Course cancelled: ${why}`);
    await tx.courseSession.updateMany({ where: { courseId: id, status: { notIn: ['VERIFIED', 'MISSED'] } }, data: { status: 'CANCELLED', resolutionReason: `Course cancelled: ${why}` } });
    await tx.course.update({ where: { id }, data: { status: 'CANCELLED' } });
    await tx.activityRequest.update({ where: { id: c.activityId }, data: { lifecycle: 'CANCELLED' } });
    await tx.courseScheduleChange.create({ data: { courseId: id, changeType: 'CANCELLED', reason: `Course cancelled: ${why}`, byId: req.user!.id } });
    await audit(tx, req, { action: 'COURSE_CANCELLED', module: 'COURSE', entityType: 'Course', entityId: id, entityRef: c.courseNo, before: { status: c.status }, after: { reason: why } });
    await notify(tx, { recipients: [c.coordinator], event: 'COURSE_CANCELLED', module: 'COURSE', entityRef: c.courseNo, title: `Course cancelled: ${c.title}`, details: [['Cancelled by', req.user!.name]], remarks: why, link: `/courses/${id}` });
  });
  res.json({ ok: true });
});

mountWorkflowRoutes(sessionsRouter, {
  module: 'COURSE_SESSION',
  entityType: 'CourseSession',
  evidenceFk: 'courseSessionId',
  async locate(id) {
    const x = await prisma.courseSession.findUnique({ where: { id }, include: { course: { select: { courseNo: true } } } });
    return x ? { instanceId: x.workflowInstanceId, ref: `${x.course.courseNo} Day ${x.dayNumber}` } : null;
  },
  async canView(user, id) {
    const x = await prisma.courseSession.findUnique({ where: { id }, select: { courseId: true } });
    return !!x && canViewCourse(user, x.courseId);
  },
});

// ───────────── Completion report ─────────────

const completionBody = z.object({
  summary: zOptStr(10000), skillsDeveloped: zOptStr(8000), projectsCompleted: zOptStr(8000), learningOutcomes: zOptStr(8000),
  achievements: zOptStr(8000), challenges: zOptStr(8000), recommendations: zOptStr(8000), coordinatorRemarks: zOptStr(5000),
});

coursesRouter.put('/:id/completion', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const roles = await guardCourse(req.user!, id);
  if (!roles.coordinate) throw forbidden('Only the course coordinator can write the completion report.');
  const c = await prisma.course.findUniqueOrThrow({ where: { id }, include: { completion: true } });
  if (c.status !== 'IN_PROGRESS' || (c.completion && !['DRAFT', 'CHANGES_REQUESTED'].includes(c.completion.status))) throw conflict('The completion report cannot be edited now.');
  const b = parse(completionBody, req.body);
  await transact(async (tx) => {
    await tx.courseCompletion.upsert({ where: { courseId: id }, create: { ...b, courseId: id }, update: b });
    await audit(tx, req, { action: 'COURSE_COMPLETION_SAVED', module: 'COURSE', entityType: 'Course', entityId: id, entityRef: c.courseNo });
  });
  res.json({ ok: true });
});

coursesRouter.post('/:id/completion/submit', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const roles = await guardCourse(req.user!, id);
  if (!roles.coordinate) throw forbidden('Only the course coordinator can submit the completion report.');
  const c = await prisma.course.findUniqueOrThrow({ where: { id }, include: { completion: true } });
  if (c.status !== 'IN_PROGRESS') throw conflict(c.status === 'AWAITING_START' ? 'The course has not started.' : 'The completion report has already been submitted.');
  const blockers = await completionBlockers(id);
  if (blockers.length) throw conflict(`The course cannot be finalised yet: ${blockers.join(' ')}`);
  const cp = c.completion;
  const fields: Record<string, string> = {};
  if (!cp?.summary) fields.summary = 'Write the completion summary';
  if (!cp?.learningOutcomes) fields.learningOutcomes = 'Describe the learning outcomes';
  if (!cp?.coordinatorRemarks) fields.coordinatorRemarks = "Add the coordinator's final remarks";
  if (Object.keys(fields).length) throw new HttpError(422, 'Complete the required sections of the completion report.', { fields });
  await transact(async (tx) => {
    const snap = { ...cp, progress: await courseProgress(id) };
    if (!cp!.workflowInstanceId) {
      const inst = await startWorkflow(tx, { module: 'COURSE_COMPLETION', entityType: 'CourseCompletion', entityId: cp!.id, entityRef: c.courseNo, districtId: c.districtId, actor: req.user!, snapshot: snap });
      await tx.courseCompletion.update({ where: { id: cp!.id }, data: { workflowInstanceId: inst.id, submittedAt: new Date() } });
      await assignFirstLevel(tx, inst.id, req.user!);
    } else {
      await tx.courseCompletion.update({ where: { id: cp!.id }, data: { submittedAt: new Date() } });
      await resubmit(tx, cp!.workflowInstanceId, req.user!, { entityType: 'CourseCompletion', entityId: cp!.id, snapshot: snap });
    }
    await audit(tx, req, { action: 'COURSE_COMPLETION_SUBMITTED', module: 'COURSE', entityType: 'Course', entityId: id, entityRef: c.courseNo });
  });
  res.json({ ok: true });
});

mountWorkflowRoutes(completionRouter, {
  module: 'COURSE_COMPLETION',
  entityType: 'Course',
  evidenceFk: 'courseId',
  async locate(id) {
    const c = await prisma.course.findUnique({ where: { id }, include: { completion: { select: { workflowInstanceId: true } } } });
    return c ? { instanceId: c.completion?.workflowInstanceId ?? null, ref: c.courseNo } : null;
  },
  canView: canViewCourse,
});

// ───────────── Final course report (PDF) ─────────────

coursesRouter.get('/:id/report/preview', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const roles = await guardCourse(req.user!, id);
  const c = await prisma.course.findUniqueOrThrow({ where: { id }, include: { reportVersions: { orderBy: { version: 'desc' }, take: 1 } } });
  if (!['AWAITING_VERIFICATION', 'COMPLETED'].includes(c.status) && !roles.author && !roles.manage) throw forbidden('The report preview is available once the completion report has been submitted.');
  const draft = c.status !== 'COMPLETED';
  const pdf = await generateCourseReport(id, { version: draft ? null : (c.reportVersions[0]?.version ?? 0) + 1, draft, user: req.user! });
  await audit(prisma, req, { action: 'COURSE_REPORT_PREVIEWED', module: 'COURSE', entityType: 'Course', entityId: id, entityRef: c.courseNo, after: { draft } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${c.courseNo}-preview.pdf"`);
  res.send(pdf);
});

coursesRouter.post('/:id/report', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const roles = await guardCourse(req.user!, id);
  if (!roles.coordinate && !can(req.user, 'course.export')) throw forbidden('You are not permitted to generate the final course report.');
  const c = await prisma.course.findUniqueOrThrow({ where: { id }, include: { reportVersions: { orderBy: { version: 'desc' }, take: 1 } } });
  if (c.status !== 'COMPLETED') throw conflict('The final course report can be generated after the course completion has been approved.');
  const version = (c.reportVersions[0]?.version ?? 0) + 1;
  const { reason: why } = parse(z.object({ reason: version > 1 ? reason : zOptStr(2000) }), req.body);
  const pdf = await generateCourseReport(id, { version, draft: false, user: req.user! });
  const { storeBuffer } = await import('../../lib/files.js');
  const st = await storeBuffer(pdf, `${c.courseNo}-final-report-v${version}.pdf`, 'application/pdf', '.pdf');
  const v = await transact(async (tx) => {
    const f = await tx.file.create({ data: { ...st, kind: 'DOCUMENT', category: 'COURSE_REPORT', uploadedById: req.user!.id, courseId: id } });
    const v = await tx.courseReportVersion.create({ data: { courseId: id, version, fileId: f.id, reason: why ?? null, generatedById: req.user!.id } });
    await audit(tx, req, { action: 'COURSE_REPORT_GENERATED', module: 'COURSE', entityType: 'Course', entityId: id, entityRef: c.courseNo, after: { version, reason: why, size: st.size, sha256: st.sha256 } });
    return { ...v, file: { id: f.id, size: f.size, originalName: f.originalName } };
  });
  res.status(201).json(v);
});

export { COURSE_STATUS, RESOLVED, dayOnly };
