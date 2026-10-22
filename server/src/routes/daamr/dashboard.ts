import { Router } from 'express';
import { prisma } from '../../db.js';
import { requirePerm, can, type AuthUser } from '../../lib/auth.js';
import { dateRangeFilter } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { sendExport, fmtMoney, humanize } from '../../lib/export.js';
import { reportScope, requestScope, DEMOGRAPHIC_FIELDS, LIFECYCLE, overdueWhere, unassignedWhere } from './common.js';
import { activityListWhere } from './requests.js';

export const daamrDashboardRouter = Router();

/**
 * Metric definitions (all respect the viewer's record visibility):
 * - Requests are filtered by submission date; drafts are never counted.
 * - Activity reports / participants / budgets are filtered by activity date; drafts excluded.
 * - "Activities" for charts = distinct DAAMR IDs across submitted requests and reports
 *   (a request and its final report count once). Report values override request values.
 */
export async function daamrDashboardData(user: AuthUser, q: any) {
  const range = dateRangeFilter(q.from, q.to);
  const district = q.districtId ? { districtId: String(q.districtId) } : {};
  const reqWhere = { AND: [requestScope(user), district, { status: { not: 'DRAFT' } }, range ? { submittedAt: range } : {}] };
  const repWhere = { AND: [reportScope(user), district, { reportStatus: { not: 'DRAFT' } }, range ? { activityDate: range } : {}] };

  const [requests, reports, districts, categories] = await Promise.all([
    prisma.activityRequest.findMany({
      where: reqWhere,
      select: { id: true, daamrId: true, status: true, executionStatus: true, districtId: true, category: true, startDate: true, proposedBudget: true, workflowInstanceId: true, report: { select: { reportStatus: true } } },
    }),
    prisma.activityReport.findMany({ where: repWhere, select: { daamrId: true, reportStatus: true, districtId: true, category: true, activityDate: true, participants: true, budget: true } }),
    prisma.district.findMany({ select: { id: true, name: true } }),
    prisma.lookupOption.findMany({ where: { group: 'ACTIVITY_CATEGORY' }, select: { value: true, label: true } }),
  ]);
  const dName = new Map(districts.map((d) => [d.id, d.name]));
  const cName = new Map(categories.map((c) => [c.value, c.label]));
  const countBy = (arr: any[], key: (x: any) => string) => arr.reduce((m: Record<string, number>, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {});
  const byStatus = countBy(requests, (r) => r.status);
  const byExec = countBy(requests.filter((r) => r.status === 'APPROVED'), (r) => r.executionStatus);

  const activities = new Map<string, { districtId: string; category: string | null; date: Date }>();
  for (const r of requests) activities.set(r.daamrId, { districtId: r.districtId, category: r.category, date: r.startDate });
  for (const r of reports) activities.set(r.daamrId, { districtId: r.districtId, category: r.category, date: r.activityDate });
  const acts = [...activities.values()];

  const demographics = Object.fromEntries(DEMOGRAPHIC_FIELDS.map((f) => [f, 0])) as Record<string, number>;
  let totalParticipants = 0, allocated = 0, utilized = 0;
  const budgetByDistrict: Record<string, { allocated: number; utilized: number }> = {};
  for (const r of reports) {
    if (r.participants) {
      for (const f of DEMOGRAPHIC_FIELDS) demographics[f] += (r.participants as any)[f] ?? 0;
      totalParticipants += r.participants.total;
    }
    if (r.budget) {
      allocated += r.budget.allocated;
      utilized += r.budget.utilized;
      const k = dName.get(r.districtId) ?? '—';
      budgetByDistrict[k] ??= { allocated: 0, utilized: 0 };
      budgetByDistrict[k].allocated += r.budget.allocated;
      budgetByDistrict[k].utilized += r.budget.utilized;
    }
  }

  const monthly: Record<string, number> = {};
  for (const a of acts) {
    const k = a.date.toISOString().slice(0, 7);
    monthly[k] = (monthly[k] ?? 0) + 1;
  }

  // Approval processing time per level (completed assignments of the visible requests)
  const instIds = requests.map((r) => r.workflowInstanceId).filter(Boolean) as string[];
  const asg = instIds.length
    ? await prisma.officerAssignment.findMany({ where: { instanceId: { in: instIds }, status: 'COMPLETED', completedAt: { not: null } }, select: { levelOrder: true, levelName: true, assignedAt: true, completedAt: true } })
    : [];
  const proc: Record<string, { level: string; order: number; total: number; n: number }> = {};
  for (const a of asg) {
    const k = `${a.levelOrder}`;
    proc[k] ??= { level: a.levelName, order: a.levelOrder, total: 0, n: 0 };
    proc[k].total += (a.completedAt!.getTime() - a.assignedAt.getTime()) / 3600_000;
    proc[k].n++;
  }

  const finalReportsPending = requests.filter((r) => r.status === 'APPROVED' && r.executionStatus === 'COMPLETED' && (!r.report || ['DRAFT', 'RETURNED'].includes(r.report.reportStatus))).length;

  return {
    filters: { from: q.from ?? null, to: q.to ?? null, districtId: q.districtId ?? null, districtName: q.districtId ? dName.get(String(q.districtId)) ?? null : null },
    cards: {
      totalRequests: requests.length,
      pending: byStatus.PENDING_REVIEW ?? 0,
      underReview: byStatus.UNDER_REVIEW ?? 0,
      approved: byStatus.APPROVED ?? 0,
      rejected: byStatus.REJECTED ?? 0,
      returned: byStatus.RETURNED ?? 0,
      scheduled: byExec.SCHEDULED ?? 0,
      inProgress: byExec.IN_PROGRESS ?? 0,
      completed: byExec.COMPLETED ?? 0,
      finalReportsPending,
      verifiedReports: reports.filter((r) => r.reportStatus === 'VERIFIED').length,
      totalParticipants,
      budgetAllocated: can(user, 'daamr.expense.view') ? Math.round(allocated * 100) / 100 : null,
      budgetUtilized: can(user, 'daamr.expense.view') ? Math.round(utilized * 100) / 100 : null,
    },
    charts: {
      byDistrict: Object.entries(countBy(acts, (a) => dName.get(a.districtId) ?? '—')).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      byCategory: Object.entries(countBy(acts, (a) => (a.category ? cName.get(a.category) ?? humanize(a.category) : 'Uncategorised'))).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      monthly: Object.entries(monthly).sort().map(([month, value]) => ({ month, value })),
      approvalStatus: Object.entries(byStatus).map(([status, value]) => ({ status, name: humanize(status), value })),
      demographics: DEMOGRAPHIC_FIELDS.map((f) => ({ name: humanize(f), key: f, value: demographics[f] })),
      budgetByDistrict: !can(user, 'daamr.expense.view') ? [] : Object.entries(budgetByDistrict).map(([name, v]) => ({ name, allocated: Math.round(v.allocated), utilized: Math.round(v.utilized) })),
      processingTimes: Object.values(proc).sort((a, b) => a.order - b.order).map((p) => ({ name: `${p.order}. ${p.level}`, avgHours: Math.round((p.total / p.n) * 10) / 10, decisions: p.n })),
    },
  };
}

daamrDashboardRouter.get('/', requirePerm('daamr.dashboard', 'daamr.request.create', 'daamr.report.create'), async (req, res) => {
  res.json(await daamrDashboardData(req.user!, req.query));
});

daamrDashboardRouter.get('/export', requirePerm('daamr.export'), async (req, res) => {
  const d = await daamrDashboardData(req.user!, req.query);
  const c = d.cards;
  await audit(prisma, req, { action: 'EXPORT', module: 'DAAMR', entityType: 'Dashboard', after: { format: req.query.format, filters: req.query } });
  await sendExport(res, String(req.query.format ?? 'pdf'), {
    title: 'DAAMR Activity Dashboard',
    filename: `daamr-dashboard-${new Date().toISOString().slice(0, 10)}`,
    meta: [['Reporting period', `${d.filters.from || 'Beginning'} to ${d.filters.to || 'Today'}`], ['District / HQ', d.filters.districtName ?? 'All']],
    sections: [
      { type: 'kv', title: 'Summary', items: [
        ['Total requests', c.totalRequests], ['Pending review', c.pending], ['Under review', c.underReview], ['Approved', c.approved], ['Rejected', c.rejected],
        ['Returned for revision', c.returned], ['Activities scheduled', c.scheduled], ['Activities in progress', c.inProgress], ['Activities completed', c.completed],
        ['Final reports pending', c.finalReportsPending], ['Verified activity reports', c.verifiedReports], ['Total participants', c.totalParticipants],
        ['Total budget allocated', fmtMoney(c.budgetAllocated)], ['Total budget utilized', fmtMoney(c.budgetUtilized)],
      ] },
      { type: 'table', title: 'Activities by district', columns: [{ key: 'name', label: 'District / HQ', width: 3 }, { key: 'value', label: 'Activities', align: 'right' }], rows: d.charts.byDistrict, footer: { name: 'Total', value: d.charts.byDistrict.reduce((a, r) => a + r.value, 0) } },
      { type: 'table', title: 'Activities by category', columns: [{ key: 'name', label: 'Category', width: 3 }, { key: 'value', label: 'Activities', align: 'right' }], rows: d.charts.byCategory },
      { type: 'table', title: 'Monthly activity counts', columns: [{ key: 'month', label: 'Month', width: 3 }, { key: 'value', label: 'Activities', align: 'right' }], rows: d.charts.monthly },
      { type: 'table', title: 'Participant demographics', columns: [{ key: 'name', label: 'Category', width: 3 }, { key: 'value', label: 'Participants', align: 'right' }], rows: d.charts.demographics },
      { type: 'table', title: 'Budget by district', columns: [{ key: 'name', label: 'District / HQ', width: 2 }, { key: 'allocated', label: 'Allocated (PKR)', align: 'right' }, { key: 'utilized', label: 'Utilized (PKR)', align: 'right' }], rows: d.charts.budgetByDistrict },
      { type: 'table', title: 'Approval processing time', columns: [{ key: 'name', label: 'Approval level', width: 2.5 }, { key: 'avgHours', label: 'Average hours', align: 'right' }, { key: 'decisions', label: 'Decisions', align: 'right' }], rows: d.charts.processingTimes },
    ],
  }, req.user!.name);
});

// ───────────── Activity management dashboard ─────────────

/**
 * Counting rules: every figure counts activities (one row per Activity ID) visible to the viewer,
 * filtered by activity start date and the selected filters. Drafts are only counted in "Draft".
 *  – Pending assignments: open activities with no active staff assignment.
 *  – In progress: approved activities whose execution has started (execution report not yet submitted).
 *  – Pending reviews: awaiting a decision in the activity review or the execution-report verification.
 *  – Approved: approved for execution, not yet started.
 *  – Overdue: open activities past their end date, or with a staff task past its deadline.
 */
export async function activityDashboardData(user: AuthUser, q: any) {
  const base = activityListWhere(user, { from: q.from, to: q.to, districtId: q.districtId, category: q.category, assigneeId: q.assigneeId, departmentId: q.departmentId, lifecycle: q.lifecycle, dateField: 'start' });
  const w = (extra: any) => ({ AND: [base, extra] });
  const count = (extra: any) => prisma.activityRequest.count({ where: w(extra) });
  const [total, draft, pendingAssignments, inProgress, pendingReviews, changesRequested, approved, completed, overdue, rows, districts, departments, categories] = await Promise.all([
    count({ lifecycle: { not: 'DRAFT' } }),
    count({ lifecycle: 'DRAFT' }),
    count(unassignedWhere()),
    count({ lifecycle: 'IN_PROGRESS' }),
    count({ lifecycle: { in: ['UNDER_REVIEW', 'REPORT_REVIEW'] } }),
    count({ lifecycle: 'CHANGES_REQUESTED' }),
    count({ lifecycle: 'APPROVED' }),
    count({ lifecycle: 'COMPLETED' }),
    count(overdueWhere()),
    prisma.activityRequest.findMany({ where: w({ lifecycle: { not: 'DRAFT' } }), select: { startDate: true, districtId: true, departmentId: true, category: true, lifecycle: true } }),
    prisma.district.findMany({ select: { id: true, name: true } }),
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.lookupOption.findMany({ where: { group: 'ACTIVITY_CATEGORY' }, select: { value: true, label: true } }),
  ]);
  const dName = new Map(districts.map((d) => [d.id, d.name]));
  const depName = new Map(departments.map((d) => [d.id, d.name]));
  const cName = new Map(categories.map((c) => [c.value, c.label]));
  const tally = (key: (r: (typeof rows)[number]) => string) => {
    const m: Record<string, number> = {};
    for (const r of rows) m[key(r)] = (m[key(r)] ?? 0) + 1;
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };
  const monthly: Record<string, number> = {};
  for (const r of rows) monthly[r.startDate.toISOString().slice(0, 7)] = (monthly[r.startDate.toISOString().slice(0, 7)] ?? 0) + 1;
  const byStatusMap = Object.fromEntries(tally((r) => r.lifecycle).map((x) => [x.name, x.value]));
  const perDistrict: Record<string, { name: string; total: number; inProgress: number; completed: number }> = {};
  for (const r of rows) {
    const d = (perDistrict[r.districtId] ??= { name: dName.get(r.districtId) ?? '—', total: 0, inProgress: 0, completed: 0 });
    d.total++;
    if (r.lifecycle === 'IN_PROGRESS') d.inProgress++;
    if (r.lifecycle === 'COMPLETED') d.completed++;
  }

  const now = new Date();
  const [myOpenTasks, myOverdueTasks, awaitingMyReview] = await Promise.all([
    prisma.activityAssignment.count({ where: { assigneeId: user.id, status: { in: ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS'] } } }),
    prisma.activityAssignment.count({ where: { assigneeId: user.id, status: { in: ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS'] }, deadline: { lt: now } } }),
    prisma.workflowInstance.count({ where: { currentAssigneeId: user.id, status: 'IN_PROGRESS', module: { in: ['DAAMR_REQUEST', 'DAAMR_REPORT'] } } }),
  ]);
  return {
    filters: q,
    cards: { total, draft, pendingAssignments, inProgress, pendingReviews, changesRequested, approved, completed, overdue },
    mine: { openTasks: myOpenTasks, overdueTasks: myOverdueTasks, awaitingReview: awaitingMyReview },
    charts: {
      monthly: Object.entries(monthly).sort().map(([month, value]) => ({ month, value })),
      byDistrict: tally((r) => dName.get(r.districtId) ?? '—'),
      districtStatus: Object.entries(perDistrict).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
      byCategory: tally((r) => (r.category ? cName.get(r.category) ?? humanize(r.category) : 'Uncategorised')),
      byDepartment: tally((r) => (r.departmentId ? depName.get(r.departmentId) ?? '—' : 'Not specified')),
      byStatus: LIFECYCLE.filter((l) => l !== 'DRAFT' && byStatusMap[l]).map((l) => ({ key: l, name: humanize(l), value: byStatusMap[l] })),
    },
  };
}

daamrDashboardRouter.get('/activities', requirePerm('daamr.dashboard', 'daamr.request.create', 'daamr.report.create', 'daamr.assign'), async (req, res) => {
  res.json(await activityDashboardData(req.user!, req.query));
});

daamrDashboardRouter.get('/activities/export', requirePerm('daamr.export'), async (req, res) => {
  const d = await activityDashboardData(req.user!, req.query);
  const c = d.cards;
  await audit(prisma, req, { action: 'EXPORT', module: 'DAAMR', entityType: 'ActivityDashboard', after: { format: req.query.format, filters: req.query } });
  const two = (title: string, label: string, rows: { name: string; value: number }[]) => ({ type: 'table' as const, title, columns: [{ key: 'name', label, width: 3 }, { key: 'value', label: 'Activities', align: 'right' as const }], rows });
  await sendExport(res, String(req.query.format ?? 'pdf'), {
    title: 'Activity Management Dashboard',
    filename: `activity-dashboard-${new Date().toISOString().slice(0, 10)}`,
    meta: [['Activity period', `${req.query.from || 'Beginning'} to ${req.query.to || 'Today'} (by start date)`]],
    sections: [
      { type: 'kv', title: 'Summary', items: [
        ['Total activities (submitted)', c.total], ['Draft activities', c.draft], ['Pending assignments', c.pendingAssignments], ['Activities in progress', c.inProgress],
        ['Pending reviews', c.pendingReviews], ['Changes requested', c.changesRequested], ['Approved activities', c.approved], ['Completed activities', c.completed], ['Overdue activities', c.overdue],
      ] },
      { type: 'table', title: 'Activities by month', columns: [{ key: 'month', label: 'Month', width: 3 }, { key: 'value', label: 'Activities', align: 'right' }], rows: d.charts.monthly },
      two('Activities by status', 'Status', d.charts.byStatus), two('Activities by district', 'District / HQ', d.charts.byDistrict),
      two('Activities by category', 'Category', d.charts.byCategory), two('Activities by department', 'Department', d.charts.byDepartment),
    ],
  }, req.user!.name);
});
