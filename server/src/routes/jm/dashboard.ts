import { Router } from 'express';
import { prisma, icontains } from '../../db.js';
import { requirePerm, type AuthUser } from '../../lib/auth.js';
import { dateRangeFilter } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { getSettings } from '../../lib/settings.js';
import { sendExport, fmtDate, humanize } from '../../lib/export.js';
import { jmScope } from './common.js';
import { inspectionSchedule } from './monitoring.js';

export const jmDashboardRouter = Router();

/** filter = "all" | "district:<id>" | "asset:<id>" */
async function parseFilter(filter?: string) {
  if (filter?.startsWith('district:')) {
    const d = await prisma.district.findUnique({ where: { id: filter.slice(9) } });
    return { where: { districtId: filter.slice(9) }, assetWhere: { districtId: filter.slice(9) }, label: `District: ${d?.name ?? '—'}` };
  }
  if (filter?.startsWith('asset:')) {
    const a = await prisma.jmAsset.findUnique({ where: { id: filter.slice(6) } });
    return { where: { assetId: filter.slice(6) }, assetWhere: { id: filter.slice(6) }, label: `Asset: ${a?.name ?? '—'}` };
  }
  return { where: {}, assetWhere: {}, label: 'All districts and assets' };
}

/**
 * Counting rules:
 *  – Total JMs Reports: distinct submitted reports whose reporting (submission) date is in the period.
 *  – Status categories (On schedule / Slightly / Significantly delayed / Satisfactory quality) count DISTINCT ASSETS,
 *    using each asset's latest VERIFIED report in the period. Reports still under review are shown separately as provisional.
 */
export async function jmDashboardData(user: AuthUser, q: any) {
  const s = await getSettings();
  const range = dateRangeFilter(q.from, q.to);
  const f = await parseFilter(q.filter);
  const scope = jmScope(user);
  const where = (extra: any) => ({ AND: [scope, f.where, { status: { not: 'DRAFT' } }, range ? { submittedAt: range } : {}, extra] });

  const [reports, assets, openIssues, criticalRisks, pendingActions] = await Promise.all([
    prisma.jmReport.findMany({
      where: where({}),
      select: { id: true, reportNo: true, assetId: true, status: true, submittedAt: true, scheduleClass: true, qualityRating: true, projectStatus: true, currentProgress: true, asset: { select: { id: true, name: true, assetCode: true, district: { select: { name: true } } } } },
      orderBy: { submittedAt: 'asc' },
    }),
    prisma.jmAsset.findMany({ where: { ...f.assetWhere, isActive: true }, select: { id: true, name: true, currentStatus: true } }),
    prisma.jmIssue.count({ where: { report: where({}), status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
    prisma.jmRisk.count({ where: { report: where({}), level: 'CRITICAL', status: { notIn: ['MITIGATED', 'CLOSED'] } } }),
    prisma.jmAction.count({ where: { report: where({}), actionType: 'REQUIRED', status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
  ]);

  const schedule = await inspectionSchedule(f.assetWhere);
  const latestVerified = new Map<string, (typeof reports)[number]>();
  const latestPending = new Map<string, (typeof reports)[number]>();
  for (const r of reports) {
    if (r.status === 'VERIFIED') latestVerified.set(r.assetId, r);
    else if (['PENDING_REVIEW', 'UNDER_REVIEW', 'RETURNED'].includes(r.status)) latestPending.set(r.assetId, r);
  }
  const list = (pred: (r: any) => boolean, src: Map<string, any>) =>
    [...src.values()].filter(pred).map((r) => ({ assetId: r.assetId, name: r.asset.name, assetCode: r.asset.assetCode, district: r.asset.district.name, reportId: r.id, reportNo: r.reportNo, progress: r.currentProgress }))
      .sort((a, b) => a.name.localeCompare(b.name));
  const satisfactory = new Set(s.jmSatisfactoryQualityValues);
  const cat = (src: Map<string, any>) => ({
    onSchedule: list((r) => r.scheduleClass === 'ON_SCHEDULE', src),
    slightlyDelayed: list((r) => r.scheduleClass === 'SLIGHTLY_DELAYED', src),
    significantlyDelayed: list((r) => r.scheduleClass === 'SIGNIFICANTLY_DELAYED', src),
    satisfactoryQuality: list((r) => satisfactory.has(r.qualityRating), src),
  });
  const verified = cat(latestVerified);
  // provisional: assets with a report awaiting approval that is newer than their latest verified one
  for (const [k, p] of latestPending) {
    const v = latestVerified.get(k);
    if (v && v.submittedAt! > p.submittedAt!) latestPending.delete(k);
  }
  const provisional = cat(latestPending);
  const statusCount = (st: string[]) => reports.filter((r) => st.includes(r.status)).length;

  return {
    filters: { from: q.from ?? null, to: q.to ?? null, filter: q.filter ?? 'all', label: f.label },
    rules: { satisfactoryQualityValues: s.jmSatisfactoryQualityValues, slightDelayMaxDays: s.jmSlightDelayMaxDays, slightGapMaxPct: s.jmSlightGapMaxPct },
    summary: {
      totalReports: reports.length,
      onSchedule: verified.onSchedule.length,
      slightlyDelayed: verified.slightlyDelayed.length,
      significantlyDelayed: verified.significantlyDelayed.length,
      satisfactoryQuality: verified.satisfactoryQuality.length,
      pendingReview: statusCount(['PENDING_REVIEW', 'UNDER_REVIEW']),
      approved: statusCount(['VERIFIED']),
      returned: statusCount(['RETURNED']),
      rejected: statusCount(['REJECTED']),
      projectsInProgress: assets.filter((a) => !['COMPLETED', 'NOT_STARTED'].includes(a.currentStatus)).length,
      projectsCompleted: assets.filter((a) => a.currentStatus === 'COMPLETED').length,
      openIssues,
      criticalRisks,
      pendingActions,
      overdueInspections: schedule.filter((x) => x.state === 'OVERDUE').length,
      inspectionsDueSoon: schedule.filter((x) => x.state === 'DUE_SOON').length,
      assetsReported: latestVerified.size,
      totalAssets: assets.length,
    },
    lists: verified,
    provisional,
  };
}

jmDashboardRouter.get('/', requirePerm('jm.dashboard', 'jm.report.create'), async (req, res) => {
  res.json(await jmDashboardData(req.user!, req.query));
});

jmDashboardRouter.get('/export', requirePerm('jm.export'), async (req, res) => {
  const d = await jmDashboardData(req.user!, req.query);
  const s = d.summary;
  await audit(prisma, req, { action: 'EXPORT', module: 'JM', entityType: 'Dashboard', after: { format: req.query.format, filters: req.query } });
  const names = (l: any[]) => l.map((a) => `${a.name} (${a.district}) — ${a.progress}%`);
  await sendExport(res, String(req.query.format ?? 'pdf'), {
    title: 'Jawan Markaz Monitoring Summary',
    filename: `jm-dashboard-${d.filters.from ?? 'all'}-${d.filters.to ?? 'today'}`,
    meta: [['Reporting period', `${d.filters.from ? fmtDate(d.filters.from) : 'Beginning'} to ${d.filters.to ? fmtDate(d.filters.to) : 'Today'}`], ['District / asset', d.filters.label]],
    sections: [
      { type: 'kv', title: 'Summary Report', items: [
        ['Total JMs Reports', s.totalReports], ['On Schedule (assets)', s.onSchedule], ['Slightly Delayed (assets)', s.slightlyDelayed], ['Significantly Delayed (assets)', s.significantlyDelayed],
        ['Satisfactory Quality (assets)', s.satisfactoryQuality], ['Reports pending review', s.pendingReview], ['Reports approved / verified', s.approved], ['Returned for correction', s.returned],
        ['Projects in progress', s.projectsInProgress], ['Projects completed', s.projectsCompleted], ['Open issues', s.openIssues], ['Critical risks', s.criticalRisks], ['Pending corrective actions', s.pendingActions], ['Overdue inspections', s.overdueInspections],
      ] },
      { type: 'list', title: `On Schedule (${d.lists.onSchedule.length})`, items: names(d.lists.onSchedule) },
      { type: 'list', title: `Slightly Delayed (${d.lists.slightlyDelayed.length})`, items: names(d.lists.slightlyDelayed) },
      { type: 'list', title: `Significantly Delayed (${d.lists.significantlyDelayed.length})`, items: names(d.lists.significantlyDelayed) },
      { type: 'list', title: `Satisfactory Quality (${d.lists.satisfactoryQuality.length})`, items: names(d.lists.satisfactoryQuality) },
      { type: 'text', title: 'Counting rules', text: `Asset categories use each asset's latest verified report in the period (distinct assets). Delay thresholds: up to ${d.rules.slightDelayMaxDays} days or ${d.rules.slightGapMaxPct} percentage points behind plan = slightly delayed; beyond = significantly delayed. Satisfactory quality includes: ${d.rules.satisfactoryQualityValues.map(humanize).join(', ')}. Reports awaiting review are excluded (provisional).` },
    ],
  }, req.user!.name);
});

// ───────────── Analytics ─────────────
export async function jmAnalyticsData(user: AuthUser, q: any) {
  const range = dateRangeFilter(q.from, q.to);
  const and: any[] = [jmScope(user), { status: { not: 'DRAFT' } }];
  if (range) and.push({ submittedAt: range });
  if (q.districtId) and.push({ districtId: String(q.districtId) });
  if (q.assetId) and.push({ assetId: String(q.assetId) });
  if (q.status) and.push({ status: String(q.status) });
  const search = String(q.search ?? '').trim();
  if (search) and.push({ OR: [{ reportNo: icontains(search) }, { asset: { name: icontains(search) } }, { asset: { assetCode: icontains(search) } }, { district: { name: icontains(search) } }] });
  const reports = await prisma.jmReport.findMany({
    where: { AND: and },
    select: {
      id: true, reportNo: true, assetId: true, status: true, submittedAt: true, inspectionDate: true, inspectionType: true, currentProgress: true, plannedProgress: true, delayDays: true, progressDiscrepancy: true,
      scheduleClass: true, qualityRating: true, complianceRating: true, finalDecisionAt: true,
      asset: { select: { name: true, assetCode: true } }, district: { select: { name: true } },
      workflow: { select: { currentAssignedAt: true, currentLevelOrder: true, currentAssignee: { select: { name: true } }, assignments: { where: { status: 'ACTIVE' }, select: { levelName: true }, take: 1 } } },
    },
    orderBy: { submittedAt: 'asc' },
  });
  const [issues, risks, actions] = await Promise.all([
    prisma.jmIssue.findMany({ where: { report: { AND: and } }, select: { severity: true, status: true, category: true } }),
    prisma.jmRisk.findMany({ where: { report: { AND: and } }, select: { level: true, status: true, category: true } }),
    prisma.jmAction.findMany({ where: { report: { AND: and } }, select: { status: true, targetDate: true, actionType: true, description: true, responsible: true, asset: { select: { name: true } } } }),
  ]);
  const count = (arr: any[], key: (x: any) => string) => Object.entries(arr.reduce((m: any, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {})).map(([name, value]) => ({ name: humanize(name), value: value as number }));
  const latestByAsset = new Map<string, any>();
  for (const r of reports) if (r.status === 'VERIFIED') latestByAsset.set(r.assetId, r);
  const districtProgress: Record<string, { district: string; assets: number; avg: number; onSchedule: number; delayed: number }> = {};
  for (const r of latestByAsset.values()) {
    const k = r.district.name;
    districtProgress[k] ??= { district: k, assets: 0, avg: 0, onSchedule: 0, delayed: 0 };
    const d = districtProgress[k];
    d.avg = (d.avg * d.assets + r.currentProgress) / (d.assets + 1);
    d.assets++;
    if (r.scheduleClass === 'ON_SCHEDULE') d.onSchedule++;
    if (['SLIGHTLY_DELAYED', 'SIGNIFICANTLY_DELAYED'].includes(r.scheduleClass)) d.delayed++;
  }
  const inspections: Record<string, { asset: string; reports: number; verified: number; lastInspection: string | null; latestProgress: number | null }> = {};
  for (const r of reports) {
    const k = r.assetId;
    inspections[k] ??= { asset: `${r.asset.assetCode} ${r.asset.name}`, reports: 0, verified: 0, lastInspection: null, latestProgress: null };
    inspections[k].reports++;
    if (r.status === 'VERIFIED') { inspections[k].verified++; inspections[k].latestProgress = r.currentProgress; }
    const d = r.inspectionDate.toISOString().slice(0, 10);
    if (!inspections[k].lastInspection || d > inspections[k].lastInspection!) inspections[k].lastInspection = d;
  }
  const now = new Date();
  const DAY = 86_400_000;
  const days = (a: Date, b: Date) => Math.max(0, Math.round(((b.getTime() - a.getTime()) / DAY) * 10) / 10);

  // planned vs actual — latest verified report per asset, most behind plan first
  const progressComparison = [...latestByAsset.values()].map((r) => ({
    assetId: r.assetId, asset: `${r.asset.assetCode} ${r.asset.name}`, district: r.district.name, reportId: r.id, reportNo: r.reportNo,
    planned: r.plannedProgress, actual: r.currentProgress, gap: r.plannedProgress != null ? Math.round((r.currentProgress - r.plannedProgress) * 10) / 10 : null,
    delayDays: r.delayDays, scheduleClass: r.scheduleClass, discrepancy: r.progressDiscrepancy,
  })).sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0) || (b.delayDays ?? 0) - (a.delayDays ?? 0));

  // reports awaiting review, oldest assignment first
  const pendingReview = reports.filter((r) => ['PENDING_REVIEW', 'UNDER_REVIEW'].includes(r.status)).map((r) => ({
    reportId: r.id, reportNo: r.reportNo, asset: r.asset.name, district: r.district.name, status: r.status,
    level: r.workflow?.assignments[0]?.levelName ?? null, assignee: r.workflow?.currentAssignee?.name ?? null,
    submittedAt: r.submittedAt, daysWaiting: r.workflow?.currentAssignedAt ? days(r.workflow.currentAssignedAt, now) : null,
    daysSinceSubmission: r.submittedAt ? days(r.submittedAt, now) : null,
  })).sort((a, b) => (b.daysWaiting ?? 0) - (a.daysWaiting ?? 0));

  // review turnaround — submission to final verification, verified reports only
  const tat: Record<string, { district: string; verified: number; total: number; max: number }> = {};
  for (const r of reports) {
    if (r.status !== 'VERIFIED' || !r.submittedAt || !r.finalDecisionAt) continue;
    const d = days(r.submittedAt, r.finalDecisionAt);
    const t = (tat[r.district.name] ??= { district: r.district.name, verified: 0, total: 0, max: 0 });
    t.verified++; t.total += d; t.max = Math.max(t.max, d);
  }
  const turnaround = Object.values(tat).map((t) => ({ district: t.district, verified: t.verified, avgDays: Math.round((t.total / t.verified) * 10) / 10, maxDays: t.max })).sort((a, b) => a.district.localeCompare(b.district));

  const schedule = await inspectionSchedule({ ...(q.districtId ? { districtId: String(q.districtId) } : {}), ...(q.assetId ? { id: String(q.assetId) } : {}) });
  return {
    period: { from: q.from ?? null, to: q.to ?? null },
    districtProgress: Object.values(districtProgress).map((d) => ({ ...d, avg: Math.round(d.avg * 10) / 10 })),
    assetInspections: Object.values(inspections),
    scheduleDistribution: count([...latestByAsset.values()], (r) => r.scheduleClass),
    qualityDistribution: count([...latestByAsset.values()], (r) => r.qualityRating),
    complianceDistribution: count([...latestByAsset.values()], (r) => r.complianceRating),
    reviewStatus: count(reports, (r) => r.status),
    issuesBySeverity: count(issues, (i) => i.severity),
    issuesByStatus: count(issues, (i) => i.status),
    issuesByCategory: count(issues, (i) => i.category),
    risksByLevel: count(risks, (r) => r.level),
    risksByStatus: count(risks, (r) => r.status),
    actionsByStatus: count(actions, (a) => a.status),
    inspectionTypes: count(reports, (r) => r.inspectionType),
    progressComparison,
    pendingReview,
    turnaround,
    overdueActions: actions.filter((a) => ['OPEN', 'IN_PROGRESS'].includes(a.status) && a.targetDate && a.targetDate < now).map((a) => ({ asset: a.asset.name, description: a.description, responsible: a.responsible, target: a.targetDate!.toISOString().slice(0, 10), status: a.status })),
    inspectionSchedule: schedule.filter((x) => x.state !== 'NOT_SET').map((x) => ({ asset: x.name, district: x.district, due: x.nextInspectionDate?.toISOString().slice(0, 10) ?? '', state: x.state, daysOverdue: x.daysOverdue })),
    monthly: Object.entries(reports.reduce((m: any, r) => { const k = (r.submittedAt ?? r.inspectionDate).toISOString().slice(0, 7); m[k] = (m[k] ?? 0) + 1; return m; }, {})).sort().map(([month, value]) => ({ month, value })),
  };
}

jmDashboardRouter.get('/analytics', requirePerm('jm.dashboard'), async (req, res) => {
  res.json(await jmAnalyticsData(req.user!, req.query));
});

jmDashboardRouter.get('/analytics/export', requirePerm('jm.export'), async (req, res) => {
  const d = await jmAnalyticsData(req.user!, req.query);
  await audit(prisma, req, { action: 'EXPORT', module: 'JM', entityType: 'Analytics', after: { format: req.query.format, filters: req.query } });
  const two = (title: string, rows: any[]) => ({ type: 'table' as const, title, columns: [{ key: 'name', label: 'Category', width: 3 }, { key: 'value', label: 'Count', align: 'right' as const }], rows });
  await sendExport(res, String(req.query.format ?? 'pdf'), {
    title: 'Jawan Markaz Analytics', filename: `jm-analytics-${new Date().toISOString().slice(0, 10)}`, landscape: true,
    meta: [['Reporting period', `${d.period.from || 'Beginning'} to ${d.period.to || 'Today'}`], ...(req.query.search ? [['Search', String(req.query.search)] as [string, string]] : [])],
    sections: [
      { type: 'table', title: 'Planned vs actual progress (latest verified)', columns: [{ key: 'asset', label: 'Asset', width: 2.5 }, { key: 'district', label: 'District' }, { key: 'planned', label: 'Planned %', align: 'right' }, { key: 'actual', label: 'Actual %', align: 'right' }, { key: 'gap', label: 'Gap (pts)', align: 'right' }, { key: 'delayDays', label: 'Delay (days)', align: 'right' }, { key: 'schedule', label: 'Schedule' }], rows: d.progressComparison.map((r) => ({ ...r, schedule: humanize(r.scheduleClass) })) },
      { type: 'table', title: 'Reports awaiting review', columns: [{ key: 'reportNo', label: 'Report' }, { key: 'asset', label: 'Asset', width: 2 }, { key: 'level', label: 'Level' }, { key: 'assignee', label: 'Assigned to' }, { key: 'daysWaiting', label: 'Days at level', align: 'right' }, { key: 'daysSinceSubmission', label: 'Days since submission', align: 'right' }], rows: d.pendingReview },
      { type: 'table', title: 'Review turnaround (submission to verification)', columns: [{ key: 'district', label: 'District / HQ', width: 2 }, { key: 'verified', label: 'Verified reports', align: 'right' }, { key: 'avgDays', label: 'Average days', align: 'right' }, { key: 'maxDays', label: 'Longest (days)', align: 'right' }], rows: d.turnaround },
      { type: 'table', title: 'District-wise project progress (latest verified)', columns: [{ key: 'district', label: 'District / HQ', width: 2 }, { key: 'assets', label: 'Assets', align: 'right' }, { key: 'avg', label: 'Avg progress %', align: 'right' }, { key: 'onSchedule', label: 'On schedule', align: 'right' }, { key: 'delayed', label: 'Delayed', align: 'right' }], rows: d.districtProgress },
      { type: 'table', title: 'Asset-wise inspection history', columns: [{ key: 'asset', label: 'Asset', width: 2.5 }, { key: 'reports', label: 'Reports', align: 'right' }, { key: 'verified', label: 'Verified', align: 'right' }, { key: 'lastInspection', label: 'Last inspection' }, { key: 'latestProgress', label: 'Latest progress %', align: 'right' }], rows: d.assetInspections },
      two('Schedule performance', d.scheduleDistribution), two('Quality of work', d.qualityDistribution), two('Compliance', d.complianceDistribution), two('Review status', d.reviewStatus),
      two('Issues by severity', d.issuesBySeverity), two('Issues by status', d.issuesByStatus), two('Risks by level', d.risksByLevel), two('Risks by status', d.risksByStatus), two('Corrective actions by status', d.actionsByStatus), two('Inspection types', d.inspectionTypes),
      { type: 'table', title: 'Inspection schedule', columns: [{ key: 'asset', label: 'Asset', width: 2 }, { key: 'district', label: 'District' }, { key: 'due', label: 'Next inspection due' }, { key: 'state', label: 'Status' }, { key: 'daysOverdue', label: 'Days overdue', align: 'right' }], rows: d.inspectionSchedule },
      { type: 'table', title: 'Overdue corrective actions', columns: [{ key: 'asset', label: 'Asset', width: 1.5 }, { key: 'description', label: 'Action', width: 3 }, { key: 'responsible', label: 'Responsible' }, { key: 'target', label: 'Target' }, { key: 'status', label: 'Status' }], rows: d.overdueActions },
    ],
  }, req.user!.name);
});
