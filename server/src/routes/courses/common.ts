/**
 * Course execution: automatic set-up from an approved COURSE proposal, schedule generation,
 * access rules, progress / completion rules, workflow adapters and file targets.
 *
 * Course status:   AWAITING_START ─(start date)→ IN_PROGRESS ─(completion report submitted)→ AWAITING_VERIFICATION
 *                  ─(final approval)→ COMPLETED          (changes requested → IN_PROGRESS)
 * Session status:  SCHEDULED → IN_PROGRESS (draft) → SUBMITTED → VERIFIED | CHANGES_REQUESTED → SUBMITTED …
 *                  MISSED / CANCELLED are set only by authorised administrators, with a reason.
 */
import { prisma, type Tx, type Db } from '../../db.js';
import { can, type AuthUser } from '../../lib/auth.js';
import { audit } from '../../lib/audit.js';
import { notify } from '../../lib/notify.js';
import { nextId, ID_PREFIX } from '../../lib/ids.js';
import { getSettings, type Settings } from '../../lib/settings.js';
import { registerFileTarget } from '../../lib/fileTargets.js';
import { fmtDate } from '../../lib/export.js';
import { registerAdapter } from '../../workflow/engine.js';

export const COURSE_STATUS = ['AWAITING_START', 'IN_PROGRESS', 'AWAITING_VERIFICATION', 'COMPLETED', 'CANCELLED'] as const;
export const SESSION_STATUS = ['SCHEDULED', 'IN_PROGRESS', 'SUBMITTED', 'CHANGES_REQUESTED', 'VERIFIED', 'MISSED', 'CANCELLED'] as const;
/** Sessions that no longer need a report. */
export const RESOLVED = ['VERIFIED', 'MISSED', 'CANCELLED'];
/** Sessions whose report is still owed by the course team. */
export const REPORT_OWED = ['SCHEDULED', 'IN_PROGRESS', 'CHANGES_REQUESTED'];
export const SESSION_PHOTO_CATEGORIES: Record<string, string> = {
  TRAINER_LECTURE: 'Trainer delivering the lecture',
  STUDENTS_ATTENDING: 'Students attending the class',
  PRACTICAL: 'Practical training activity',
  GROUP_ACTIVITY: 'Group activity',
  VENUE_CLASSROOM: 'Venue and classroom',
  PROJECT_PRESENTATION: 'Project work and presentations',
  GUEST_CERTIFICATE: 'Guest visit / certificates',
};
export const SESSION_DOC_CATEGORIES: Record<string, string> = { MATERIAL: 'Training material / presentation', ATTENDANCE_SHEET: 'Attendance sheet', SUPPORTING: 'Supporting document' };

const DAY = 86_400_000;
export const dayOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const todayUtc = () => dayOnly(new Date());
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Training dates: the next `days` dates from `start` that are not non-training weekdays or holidays. */
export function generateSchedule(start: Date, days: number, s: Pick<Settings, 'courseNonTrainingWeekdays' | 'courseHolidays'>) {
  const off = new Set(s.courseNonTrainingWeekdays);
  const holidays = new Set(s.courseHolidays);
  const out: Date[] = [];
  let d = dayOnly(start);
  for (let guard = 0; out.length < days && guard < days * 7 + 60; guard++, d = new Date(d.getTime() + DAY)) {
    if (off.has(d.getUTCDay()) || holidays.has(iso(d))) continue;
    out.push(d);
  }
  return out;
}

/** Training days available in a date range (used when a proposal does not state the number of days). */
export function trainingDaysBetween(start: Date, end: Date, s: Pick<Settings, 'courseNonTrainingWeekdays' | 'courseHolidays'>) {
  let n = 0;
  for (let d = dayOnly(start); d <= dayOnly(end); d = new Date(d.getTime() + DAY)) {
    if (!s.courseNonTrainingWeekdays.includes(d.getUTCDay()) && !s.courseHolidays.includes(iso(d))) n++;
  }
  return Math.max(1, n);
}

// ───────────── Automatic set-up after final approval ─────────────

/**
 * Creates the Course execution record, trainers, team and daily sessions for an approved COURSE proposal.
 * Idempotent: if the course already exists (approval processed twice) it is returned unchanged.
 */
export async function createCourseFromActivity(tx: Tx, activityId: string, actor: { id: string | null; name: string }) {
  const existing = await tx.course.findUnique({ where: { activityId } });
  if (existing) return { course: existing, created: false };
  const a = await tx.activityRequest.findUniqueOrThrow({
    where: { id: activityId },
    include: { requester: true, assignments: { where: { status: { not: 'CANCELLED' } }, include: { assignee: true }, orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }] } },
  });
  if (a.activityType !== 'COURSE') throw new Error('Only course proposals create course records.');
  if (a.status !== 'APPROVED') throw new Error('The course proposal is not approved.');
  const s = await getSettings(tx);
  const days = a.trainingDays ?? trainingDaysBetween(a.startDate, a.endDate, s);
  const dates = generateSchedule(a.startDate, days, s);
  const coordinator = a.assignments[0]?.assignee ?? a.requester;
  const started = dates[0] <= todayUtc();
  const courseNo = await nextId(tx, ID_PREFIX.course);
  const course = await tx.course.create({
    data: {
      courseNo, activityId: a.id, title: a.subject, category: a.category, districtId: a.districtId, departmentId: a.departmentId,
      venue: a.venue, venueAddress: a.venueAddress, objectives: a.objectives, targetAudience: a.targetAudience, deliveryFormat: a.deliveryFormat,
      methodology: a.methodology, durationDays: days, startDate: dates[0], endDate: dates[dates.length - 1], dailyStartTime: a.startTime,
      dailyEndTime: a.endTime, registeredCount: a.expectedParticipants ?? 0, coordinatorId: coordinator.id,
      status: started ? 'IN_PROGRESS' : 'AWAITING_START', startedAt: started ? new Date() : null,
    },
  });
  await tx.courseSession.createMany({
    data: dates.map((d, i) => ({ courseId: course.id, dayNumber: i + 1, sessionDate: d, originalDate: d, startTime: a.startTime, endTime: a.endTime, venue: a.venue })),
  });
  const team = new Map<string, { id: string; name: string; email: string }>();
  for (const x of a.assignments) if (x.assigneeId !== coordinator.id) team.set(x.assigneeId, x.assignee);
  if (a.requesterId !== coordinator.id) team.set(a.requesterId, a.requester);
  if (team.size) await tx.courseStaff.createMany({ data: [...team.keys()].map((userId) => ({ courseId: course.id, userId })) });
  const trainers = (Array.isArray(a.proposedTrainers) ? a.proposedTrainers : []) as any[];
  for (const t of trainers) {
    if (!t?.name) continue;
    const userId = t.userId && (await tx.user.count({ where: { id: String(t.userId), isActive: true } })) ? String(t.userId) : null;
    await tx.courseTrainer.create({ data: { courseId: course.id, userId, name: String(t.name).slice(0, 150), designation: t.designation ? String(t.designation).slice(0, 150) : null, expertise: t.expertise ? String(t.expertise).slice(0, 300) : null } });
  }
  await tx.activityRequest.update({ where: { id: a.id }, data: { lifecycle: started ? 'IN_PROGRESS' : 'APPROVED', executionStatus: started ? 'IN_PROGRESS' : 'SCHEDULED' } });
  await audit(tx, null, { action: 'COURSE_CREATED', module: 'COURSE', entityType: 'Course', entityId: course.id, entityRef: courseNo, after: { activity: a.daamrId, sessions: dates.length, start: dates[0], end: dates[dates.length - 1], coordinator: coordinator.name } }, actor);
  const trainerUsers = await tx.user.findMany({ where: { id: { in: trainers.map((t) => t?.userId).filter(Boolean).map(String) } } });
  await notify(tx, {
    recipients: [coordinator, ...team.values(), ...trainerUsers],
    event: 'COURSE_CREATED', module: 'COURSE', entityRef: courseNo,
    title: `Course set up: ${a.subject}`,
    details: [['Course ID', courseNo], ['Training days', String(dates.length)], ['Dates', `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}`], ['Venue', a.venue], ['Coordinator', coordinator.name], ['Status', started ? 'In progress' : 'Approved — awaiting course start']],
    link: `/courses/${course.id}`,
  });
  return { course, created: true };
}

// ───────────── Access ─────────────

export function courseScope(user: AuthUser): any {
  if (can(user, 'course.view_all')) return {};
  const or: any[] = [
    { coordinatorId: user.id },
    { staff: { some: { userId: user.id } } },
    { trainers: { some: { userId: user.id, isActive: true } } },
    { activity: { requesterId: user.id } },
    { sessions: { some: { workflow: { assignments: { some: { assigneeId: user.id } } } } } },
    { completion: { workflow: { assignments: { some: { assigneeId: user.id } } } } },
  ];
  if (can(user, 'course.view_district') && user.districtId) or.push({ districtId: user.districtId });
  return { OR: or };
}

export async function canViewCourse(user: AuthUser, courseId: string) {
  return (await prisma.course.count({ where: { AND: [{ id: courseId }, courseScope(user)] } })) > 0;
}

/** What the user may do on a course. */
export async function courseRoles(user: AuthUser, courseId: string) {
  const c = await prisma.course.findUnique({ where: { id: courseId }, select: { coordinatorId: true, staff: { select: { userId: true } }, trainers: { where: { isActive: true }, select: { userId: true } } } });
  if (!c) return null;
  const isCoordinator = c.coordinatorId === user.id;
  const isStaff = c.staff.some((s) => s.userId === user.id);
  const isTrainer = c.trainers.some((t) => t.userId === user.id);
  const manage = can(user, 'course.manage');
  return { isCoordinator, isStaff, isTrainer, manage, author: isCoordinator || isStaff || isTrainer, coordinate: isCoordinator || manage };
}

// ───────────── Progress & completion rules ─────────────

export async function courseProgress(courseId: string) {
  const sessions = await prisma.courseSession.findMany({
    where: { courseId },
    select: { id: true, status: true, conducted: true, submittedAt: true, sessionDate: true, presentCount: true, absentCount: true, registeredCount: true, _count: { select: { files: { where: { deletedAt: null, kind: 'PHOTO' } } } } },
  });
  const s = await getSettings();
  const today = todayUtc();
  const due = new Date(today.getTime() - s.courseReportDueDays * DAY);
  const total = sessions.length;
  const by = (st: string[]) => sessions.filter((x) => st.includes(x.status)).length;
  const verified = by(['VERIFIED']);
  const resolved = by(['MISSED', 'CANCELLED']);
  const conducted = sessions.filter((x) => x.conducted && !['MISSED', 'CANCELLED'].includes(x.status)).length;
  const submitted = sessions.filter((x) => x.submittedAt && !['MISSED', 'CANCELLED'].includes(x.status)).length;
  const awaitingReview = by(['SUBMITTED']);
  const pendingReports = sessions.filter((x) => REPORT_OWED.includes(x.status) && x.sessionDate <= today).length;
  const overdueReports = sessions.filter((x) => REPORT_OWED.includes(x.status) && x.sessionDate < due).length;
  const reported = sessions.filter((x) => x.presentCount != null && ['SUBMITTED', 'VERIFIED'].includes(x.status));
  const present = reported.reduce((a, x) => a + (x.presentCount ?? 0), 0);
  const possible = reported.reduce((a, x) => a + (x.presentCount ?? 0) + (x.absentCount ?? 0), 0);
  const required = total - resolved;
  return {
    totalSessions: total, conducted, submitted, verified, awaitingReview, pendingReports, overdueReports, missed: by(['MISSED']), cancelled: by(['CANCELLED']),
    deliveryPercent: total ? Math.round(((conducted + resolved) / total) * 100) : 0,
    completionPercent: total ? Math.round(((verified + resolved) / total) * 100) : 0,
    verifiedOfRequired: `${verified} of ${required}`,
    attendanceRate: possible ? Math.round((present / possible) * 1000) / 10 : null,
    totalPresent: present,
  };
}

/** Requirements 1–4 of course completion (5 = completion report, 6 = final approval are handled by the workflow). */
export async function completionBlockers(courseId: string, db: Db = prisma) {
  const s = await getSettings(db);
  const sessions = await db.courseSession.findMany({
    where: { courseId },
    orderBy: { dayNumber: 'asc' },
    select: { dayNumber: true, status: true, presentCount: true, files: { where: { deletedAt: null }, select: { kind: true, category: true } } },
  });
  const out: string[] = [];
  const unresolved = sessions.filter((x) => !RESOLVED.includes(x.status));
  if (unresolved.length) out.push(`Daily reports not yet verified for day(s) ${unresolved.map((x) => x.dayNumber).join(', ')} (verify them, or have an administrator record the session as missed or cancelled).`);
  for (const x of sessions.filter((y) => y.status === 'VERIFIED')) {
    if (x.presentCount == null) out.push(`Day ${x.dayNumber}: attendance has not been recorded.`);
    if (s.courseRequirePhotos && !x.files.some((f) => f.kind === 'PHOTO' && f.category !== 'REVIEW_EVIDENCE')) out.push(`Day ${x.dayNumber}: no photographic evidence.`);
  }
  if (!sessions.length) out.push('The course has no scheduled sessions.');
  return out;
}

// ───────────── Workflow adapters ─────────────

registerAdapter({
  module: 'COURSE_SESSION',
  async summary(tx, inst) {
    const x = await tx.courseSession.findUniqueOrThrow({ where: { workflowInstanceId: inst.id }, include: { course: true } });
    const submitter = await tx.user.findUniqueOrThrow({ where: { id: inst.submittedById } });
    return {
      entityId: x.id,
      ref: `${x.course.courseNo} Day ${x.dayNumber}`,
      subject: `${x.course.title} — Day ${x.dayNumber} report (${fmtDate(x.sessionDate)})`,
      link: `/courses/${x.courseId}/sessions/${x.id}`,
      requester: { id: submitter.id, email: submitter.email, name: submitter.name },
      details: [['Course', `${x.course.courseNo} ${x.course.title}`], ['Session date', fmtDate(x.sessionDate)], ['Topic', x.topic]],
    };
  },
  async setPhase(tx, inst, phase) {
    const data: any = {};
    if (phase.kind === 'ASSIGNED') data.status = 'SUBMITTED';
    else if (phase.kind === 'RETURNED' || phase.kind === 'REJECTED') data.status = 'CHANGES_REQUESTED';
    else if (phase.kind === 'APPROVED') { data.status = 'VERIFIED'; data.verifiedAt = new Date(); }
    if (Object.keys(data).length) await tx.courseSession.update({ where: { workflowInstanceId: inst.id }, data });
  },
  async onFinalApproved(tx, ctx) {
    await tx.courseSession.update({ where: { workflowInstanceId: ctx.instance.id }, data: { verifiedById: ctx.actor.id } });
  },
  async responsibleOfficer(tx, inst) {
    const x = await tx.courseSession.findUnique({ where: { workflowInstanceId: inst.id }, select: { course: { select: { coordinatorId: true } } } });
    return x?.course.coordinatorId ?? null;
  },
});

registerAdapter({
  module: 'COURSE_COMPLETION',
  async summary(tx, inst) {
    const x = await tx.courseCompletion.findUniqueOrThrow({ where: { workflowInstanceId: inst.id }, include: { course: { include: { coordinator: true } } } });
    const c = x.course;
    return {
      entityId: c.id,
      ref: c.courseNo,
      subject: `Course completion: ${c.title}`,
      link: `/courses/${c.id}?tab=completion`,
      requester: { id: c.coordinator.id, email: c.coordinator.email, name: c.coordinator.name },
      details: [['Course', `${c.courseNo} ${c.title}`], ['Dates', `${fmtDate(c.startDate)} – ${fmtDate(c.endDate)}`], ['Training days', String(c.durationDays)]],
    };
  },
  async beforeDecision(tx, ctx) {
    if (ctx.action !== 'APPROVE' || !ctx.isFinal) return;
    const x = await tx.courseCompletion.findUniqueOrThrow({ where: { workflowInstanceId: ctx.instance.id } });
    const blockers = await completionBlockers(x.courseId, tx);
    if (blockers.length) {
      const { conflict } = await import('../../lib/http.js');
      throw conflict(`Completion cannot be approved yet: ${blockers.join(' ')}`);
    }
  },
  async setPhase(tx, inst, phase) {
    const x = await tx.courseCompletion.findUniqueOrThrow({ where: { workflowInstanceId: inst.id } });
    if (phase.kind === 'ASSIGNED') {
      await tx.courseCompletion.update({ where: { id: x.id }, data: { status: 'SUBMITTED' } });
      await tx.course.update({ where: { id: x.courseId }, data: { status: 'AWAITING_VERIFICATION' } });
    } else if (phase.kind === 'RETURNED' || phase.kind === 'REJECTED') {
      await tx.courseCompletion.update({ where: { id: x.id }, data: { status: 'CHANGES_REQUESTED' } });
      await tx.course.update({ where: { id: x.courseId }, data: { status: 'IN_PROGRESS' } });
    } else if (phase.kind === 'APPROVED') {
      await tx.courseCompletion.update({ where: { id: x.id }, data: { status: 'APPROVED', approvedAt: new Date() } });
      const c = await tx.course.update({ where: { id: x.courseId }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await tx.activityRequest.update({ where: { id: c.activityId }, data: { lifecycle: 'COMPLETED', executionStatus: 'COMPLETED', completedAt: new Date() } });
    }
  },
  async onFinalApproved(tx, ctx) {
    await tx.courseCompletion.update({ where: { workflowInstanceId: ctx.instance.id }, data: { approvedById: ctx.actor.id } });
  },
  async responsibleOfficer(tx, inst) {
    const x = await tx.courseCompletion.findUnique({ where: { workflowInstanceId: inst.id }, select: { course: { select: { coordinatorId: true } } } });
    return x?.course.coordinatorId ?? null;
  },
});

// ───────────── File targets ─────────────

async function sessionEditable(user: AuthUser, sessionId: string) {
  const x = await prisma.courseSession.findUnique({ where: { id: sessionId }, include: { course: { select: { courseNo: true, status: true } }, workflow: true } });
  if (!x) return null;
  return { x, roles: await courseRoles(user, x.courseId) };
}

registerFileTarget({
  key: 'course-session',
  fk: 'courseSessionId',
  module: 'COURSE',
  entityType: 'CourseSession',
  categories: { ...Object.fromEntries(Object.keys(SESSION_PHOTO_CATEGORIES).map((k) => [k, 'photo' as const])), MATERIAL: 'doc', ATTENDANCE_SHEET: 'pdfimage', SUPPORTING: 'doc', REVIEW_EVIDENCE: 'doc' },
  async canView(user, id) {
    const x = await prisma.courseSession.findUnique({ where: { id }, select: { courseId: true } });
    return !!x && canViewCourse(user, x.courseId);
  },
  async canUpload(user, id, category) {
    const r = await sessionEditable(user, id);
    if (!r?.roles) return null;
    const ref = { ref: `${r.x.course.courseNo} Day ${r.x.dayNumber}` };
    if (category === 'REVIEW_EVIDENCE') return r.x.workflow?.status === 'IN_PROGRESS' && (r.x.workflow.currentAssigneeId === user.id || can(user, 'workflow.override')) ? ref : null;
    if (!['SCHEDULED', 'IN_PROGRESS', 'CHANGES_REQUESTED'].includes(r.x.status) || ['COMPLETED', 'CANCELLED'].includes(r.x.course.status)) return null;
    return r.roles.author || r.roles.manage ? ref : null;
  },
  async canDelete(user, id, file) {
    const r = await sessionEditable(user, id);
    if (!r?.roles) return false;
    if (file.category === 'REVIEW_EVIDENCE') return file.uploadedById === user.id && r.x.workflow?.status === 'IN_PROGRESS' && r.x.workflow.currentAssigneeId === user.id;
    // photo captions / selection stay editable by the course team until the course is completed
    return ['SCHEDULED', 'IN_PROGRESS', 'CHANGES_REQUESTED'].includes(r.x.status) && (r.roles.author || r.roles.manage) && (file.uploadedById === user.id || r.roles.coordinate);
  },
});

registerFileTarget({
  key: 'course',
  fk: 'courseId',
  module: 'COURSE',
  entityType: 'Course',
  categories: { SUPPORTING: 'doc', ANNEX_PHOTO: 'photo', REVIEW_EVIDENCE: 'doc' },
  canView: canViewCourse,
  async canUpload(user, id, category) {
    const c = await prisma.course.findUnique({ where: { id }, include: { completion: { include: { workflow: true } } } });
    if (!c) return null;
    if (category === 'REVIEW_EVIDENCE') {
      const wf = c.completion?.workflow;
      return wf?.status === 'IN_PROGRESS' && (wf.currentAssigneeId === user.id || can(user, 'workflow.override')) ? { ref: c.courseNo } : null;
    }
    const roles = await courseRoles(user, id);
    return roles?.author || roles?.manage ? (['COMPLETED', 'CANCELLED', 'AWAITING_VERIFICATION'].includes(c.status) ? null : { ref: c.courseNo }) : null;
  },
  async canDelete(user, id, file) {
    const c = await prisma.course.findUnique({ where: { id } });
    if (!c || ['COMPLETED', 'AWAITING_VERIFICATION'].includes(c.status) || file.category === 'COURSE_REPORT') return false;
    const roles = await courseRoles(user, id);
    return !!roles && (file.uploadedById === user.id || roles.coordinate);
  },
});

// ───────────── Background automation (idempotent; run by the server sweep) ─────────────

export async function runCourseAutomation(now = new Date()) {
  const s = await getSettings();
  const today = dayOnly(now);
  const result = { started: 0, dayNotices: 0, missingReports: 0 };

  // 1. Courses whose start date has arrived move to In Progress
  const starting = await prisma.course.findMany({ where: { status: 'AWAITING_START', startDate: { lte: today } }, include: { coordinator: true, staff: { include: { user: true } } } });
  for (const c of starting) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.course.updateMany({ where: { id: c.id, status: 'AWAITING_START' }, data: { status: 'IN_PROGRESS', startedAt: now } });
      if (!claimed.count) return;
      await tx.activityRequest.updateMany({ where: { id: c.activityId, lifecycle: 'APPROVED' }, data: { lifecycle: 'IN_PROGRESS', executionStatus: 'IN_PROGRESS' } });
      await audit(tx, null, { action: 'COURSE_STARTED', module: 'COURSE', entityType: 'Course', entityId: c.id, entityRef: c.courseNo });
      await notify(tx, { recipients: [c.coordinator, ...c.staff.map((x) => x.user)], event: 'COURSE_STARTED', module: 'COURSE', entityRef: c.courseNo, title: `Course started: ${c.title}`, details: [['Dates', `${fmtDate(c.startDate)} – ${fmtDate(c.endDate)}`], ['Venue', c.venue]], link: `/courses/${c.id}` });
      result.started++;
    });
  }

  // 2. Today's sessions: remind the coordinator and trainers that the daily report is due
  const todays = await prisma.courseSession.findMany({
    where: { sessionDate: today, dayNotifiedAt: null, status: { in: ['SCHEDULED', 'IN_PROGRESS'] }, course: { status: 'IN_PROGRESS' } },
    include: { course: { include: { coordinator: true, trainers: { where: { isActive: true }, include: { user: true } } } } },
  });
  for (const x of todays) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.courseSession.updateMany({ where: { id: x.id, dayNotifiedAt: null }, data: { dayNotifiedAt: now } });
      if (!claimed.count) return;
      await notify(tx, {
        recipients: [x.course.coordinator, ...x.course.trainers.map((t) => t.user)], event: 'SESSION_TODAY', module: 'COURSE', entityRef: `${x.course.courseNo} Day ${x.dayNumber}`,
        title: `Day ${x.dayNumber} of ${x.course.title} is today — submit the daily report after class`,
        details: [['Venue', x.venue], ['Time', [x.startTime, x.endTime].filter(Boolean).join(' – ')]], link: `/courses/${x.courseId}/sessions/${x.id}`,
      });
      result.dayNotices++;
    });
  }

  // 3. Missing daily reports are flagged after the configured deadline
  const due = new Date(today.getTime() - s.courseReportDueDays * DAY);
  const missing = await prisma.courseSession.findMany({
    where: { sessionDate: { lt: due }, reportDueNotifiedAt: null, status: { in: REPORT_OWED }, course: { status: { in: ['IN_PROGRESS'] } } },
    include: { course: { include: { coordinator: true } } },
  });
  for (const x of missing) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.courseSession.updateMany({ where: { id: x.id, reportDueNotifiedAt: null }, data: { reportDueNotifiedAt: now } });
      if (!claimed.count) return;
      await audit(tx, null, { action: 'DAILY_REPORT_OVERDUE', module: 'COURSE', entityType: 'CourseSession', entityId: x.id, entityRef: `${x.course.courseNo} Day ${x.dayNumber}` });
      await notify(tx, {
        recipients: [x.course.coordinator], event: 'DAILY_REPORT_OVERDUE', module: 'COURSE', entityRef: `${x.course.courseNo} Day ${x.dayNumber}`,
        title: `Daily report overdue: Day ${x.dayNumber} (${fmtDate(x.sessionDate)})`, details: [['Course', x.course.title], ['Status', x.status.replace(/_/g, ' ').toLowerCase()]],
        link: `/courses/${x.courseId}/sessions/${x.id}`,
      });
      result.missingReports++;
    });
  }
  return result;
}
