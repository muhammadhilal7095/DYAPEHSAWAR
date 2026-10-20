import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { MODULE_LABEL } from '../workflow/engine.js';

export const tasksRouter = Router();

const instanceSelect = {
  id: true, module: true, entityRef: true, status: true, currentLevelOrder: true, currentAssignedAt: true, startedAt: true, updatedAt: true,
  submittedBy: { select: { name: true } },
  definition: { select: { levels: { select: { order: true, name: true } } } },
  activityRequest: { select: { id: true, subject: true } },
  activityReport: { select: { id: true, activityName: true } },
  hostelBooking: { select: { id: true, guestName: true, hostel: { select: { name: true } } } },
  jmReport: { select: { id: true, asset: { select: { name: true } } } },
  courseSession: { select: { id: true, dayNumber: true, courseId: true, course: { select: { title: true } } } },
  courseCompletion: { select: { courseId: true, course: { select: { title: true } } } },
} as const;

function link(i: any) {
  if (i.activityRequest) return { link: `/daamr/requests/${i.activityRequest.id}`, title: i.activityRequest.subject };
  if (i.activityReport) return { link: `/daamr/reports/${i.activityReport.id}`, title: `Final report: ${i.activityReport.activityName}` };
  if (i.hostelBooking) return { link: `/hostels/bookings/${i.hostelBooking.id}`, title: `${i.hostelBooking.hostel.name} — ${i.hostelBooking.guestName}` };
  if (i.jmReport) return { link: `/jm/reports/${i.jmReport.id}`, title: `${i.jmReport.asset.name} monitoring report` };
  if (i.courseSession) return { link: `/courses/${i.courseSession.courseId}/sessions/${i.courseSession.id}`, title: `${i.courseSession.course.title} — Day ${i.courseSession.dayNumber} report` };
  if (i.courseCompletion) return { link: `/courses/${i.courseCompletion.courseId}?tab=completion`, title: `${i.courseCompletion.course.title} — completion report` };
  return { link: '/', title: i.entityRef };
}

function shape(i: any) {
  const lvl = i.definition.levels.find((l: any) => l.order === i.currentLevelOrder);
  return {
    id: i.id,
    module: i.module,
    moduleLabel: MODULE_LABEL[i.module as keyof typeof MODULE_LABEL],
    ref: i.entityRef,
    status: i.status,
    level: lvl ? `${lvl.order}/${i.definition.levels.length} · ${lvl.name}` : null,
    assignedAt: i.currentAssignedAt,
    submittedBy: i.submittedBy.name,
    updatedAt: i.updatedAt,
    ...link(i),
  };
}

/** Everything awaiting the current user: reviews assigned to them and their own items returned for revision. */
tasksRouter.get('/', requireAuth, async (req, res) => {
  const [assigned, returned] = await Promise.all([
    prisma.workflowInstance.findMany({ where: { currentAssigneeId: req.user!.id, status: 'IN_PROGRESS' }, select: instanceSelect, orderBy: { currentAssignedAt: 'asc' } }),
    prisma.workflowInstance.findMany({ where: { submittedById: req.user!.id, status: 'RETURNED' }, select: instanceSelect, orderBy: { updatedAt: 'desc' } }),
  ]);
  res.json({ assigned: assigned.map(shape), returned: returned.map(shape) });
});

tasksRouter.get('/summary', requireAuth, async (req, res) => {
  const uid = req.user!.id;
  const [assigned, returned, submittedOpen, unread] = await Promise.all([
    prisma.workflowInstance.groupBy({ by: ['module'], where: { currentAssigneeId: uid, status: 'IN_PROGRESS' }, _count: true }),
    prisma.workflowInstance.count({ where: { submittedById: uid, status: 'RETURNED' } }),
    prisma.workflowInstance.count({ where: { submittedById: uid, status: 'IN_PROGRESS' } }),
    prisma.notification.count({ where: { userId: uid, readAt: null } }),
  ]);
  res.json({ assigned: Object.fromEntries(assigned.map((a) => [a.module, a._count])), assignedTotal: assigned.reduce((a, b) => a + b._count, 0), returned, submittedOpen, unread });
});
