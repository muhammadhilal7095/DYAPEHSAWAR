import { Router } from 'express';
import { prisma, icontains } from '../../db.js';
import { requireAuth, requirePerm } from '../../lib/auth.js';
import { dateRangeFilter, forbidden, pageParams } from '../../lib/http.js';
import { fileSelect } from '../../lib/files.js';
import { fmtDate } from '../../lib/export.js';
import { notify, transact } from '../../lib/notify.js';
import { getSettings } from '../../lib/settings.js';
import { canViewAssets, jmScope } from './common.js';

export const jmMonitoringRouter = Router();
const DAY = 86_400_000;
const todayUtc = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

export type InspectionState = 'OVERDUE' | 'DUE_SOON' | 'SCHEDULED' | 'NOT_SET';

/**
 * Inspection schedule per active asset, based on the "next inspection date" of its latest verified report.
 * An inspection counts as done when any later report (submitted, any review state) has an inspection date on/after it.
 */
export async function inspectionSchedule(where: any = {}) {
  const assets = await prisma.jmAsset.findMany({
    where: { isActive: true, ...where },
    select: {
      id: true, assetCode: true, name: true, district: { select: { id: true, name: true } },
      reports: {
        where: { status: { not: 'DRAFT' } },
        select: { id: true, reportNo: true, status: true, inspectionDate: true, nextInspectionDate: true, submittedAt: true, reportingOfficer: { select: { id: true, name: true, email: true } } },
        orderBy: { submittedAt: 'desc' },
      },
    },
    orderBy: { name: 'asc' },
  });
  const today = todayUtc();
  return assets.map((a) => {
    const lastVerified = a.reports.find((r) => r.status === 'VERIFIED');
    const lastInspection = a.reports.reduce<Date | null>((m, r) => (!m || r.inspectionDate > m ? r.inspectionDate : m), null);
    const due = lastVerified?.nextInspectionDate ?? null;
    const done = !!(due && lastInspection && lastInspection >= due);
    let state: InspectionState = 'NOT_SET';
    if (due && !done) state = due < today ? 'OVERDUE' : due.getTime() - today.getTime() <= 7 * DAY ? 'DUE_SOON' : 'SCHEDULED';
    return {
      assetId: a.id, assetCode: a.assetCode, name: a.name, district: a.district.name, districtId: a.district.id,
      lastInspection, nextInspectionDate: done ? null : due, state, daysOverdue: state === 'OVERDUE' ? Math.round((today.getTime() - due!.getTime()) / DAY) : 0,
      basedOn: lastVerified ? { id: lastVerified.id, reportNo: lastVerified.reportNo } : null,
      officer: lastVerified?.reportingOfficer ?? null,
    };
  });
}

jmMonitoringRouter.get('/inspections', requireAuth, async (req, res) => {
  if (!canViewAssets(req.user!)) throw forbidden();
  const where: any = {};
  if (req.query.districtId) where.districtId = String(req.query.districtId);
  const rows = await inspectionSchedule(where);
  const order: Record<string, number> = { OVERDUE: 0, DUE_SOON: 1, SCHEDULED: 2, NOT_SET: 3 };
  res.json(rows.filter((r) => !req.query.state || r.state === req.query.state).sort((a, b) => order[a.state] - order[b.state] || b.daysOverdue - a.daysOverdue));
});

/** Geo-tagged photo gallery across all JM reports and assets the user may see. */
jmMonitoringRouter.get('/gallery', requireAuth, async (req, res) => {
  if (!canViewAssets(req.user!)) throw forbidden();
  const q = req.query;
  const { skip, take, page, pageSize } = pageParams({ ...q, pageSize: q.pageSize ?? 48 });
  const and: any[] = [
    { deletedAt: null, kind: 'PHOTO' },
    { OR: [{ jmReport: { AND: [jmScope(req.user!), { status: { not: 'DRAFT' } }] } }, { jmReportId: null, jmAssetId: { not: null } }] },
  ];
  if (q.assetId) and.push({ jmAssetId: String(q.assetId) });
  if (q.districtId) and.push({ jmAsset: { districtId: String(q.districtId) } });
  if (q.category) and.push({ category: String(q.category) });
  if (q.located === 'true') and.push({ latitude: { not: null } });
  if (q.q) and.push({ OR: [{ caption: icontains(String(q.q)) }, { jmReport: { reportNo: icontains(String(q.q)) } }, { jmAsset: { name: icontains(String(q.q)) } }] });
  const range = dateRangeFilter(q.from, q.to);
  if (range) and.push({ createdAt: range });
  const where = { AND: and };
  const sel = { ...fileSelect, jmReport: { select: { id: true, reportNo: true } }, jmAsset: { select: { id: true, name: true, district: { select: { name: true } } } } };
  const [rows, total, points] = await Promise.all([
    prisma.file.findMany({ where, select: sel, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.file.count({ where }),
    prisma.file.findMany({ where: { AND: [...and, { latitude: { not: null } }] }, select: { id: true, latitude: true, longitude: true, caption: true, originalName: true, locationSource: true, jmAsset: { select: { id: true, name: true } } }, take: 500 }),
  ]);
  res.json({ rows, total, page, pageSize, points });
});

// ───────────── Reminders: overdue corrective actions and inspections ─────────────

export async function sendJmReminders(trigger: 'SCHEDULE' | 'MANUAL', actor?: { id: string; name: string }) {
  const today = todayUtc();
  const actions = await prisma.jmAction.findMany({
    where: { actionType: 'REQUIRED', status: { in: ['OPEN', 'IN_PROGRESS'] }, targetDate: { lt: today }, report: { status: { notIn: ['DRAFT', 'REJECTED'] } } },
    include: { asset: true, report: { include: { reportingOfficer: true } } },
    orderBy: { targetDate: 'asc' },
  });
  const inspections = (await inspectionSchedule()).filter((i) => i.state === 'OVERDUE');
  const supervisors = (await prisma.user.findMany({ where: { isActive: true }, include: { roles: { include: { role: true } } } }))
    .filter((u) => u.roles.some((r) => ((r.role.permissions as string[]) ?? []).includes('jm.register.update')));

  let messages = 0;
  await transact(async (tx) => {
    // each reporting officer gets the overdue items from their own reports
    const byOfficer = new Map<string, { user: any; lines: string[] }>();
    for (const a of actions) {
      const o = a.report.reportingOfficer;
      if (!byOfficer.has(o.id)) byOfficer.set(o.id, { user: o, lines: [] });
      byOfficer.get(o.id)!.lines.push(`${a.asset.name}: ${a.description} (due ${fmtDate(a.targetDate)}, ${a.report.reportNo})`);
    }
    for (const i of inspections) {
      if (!i.officer) continue;
      if (!byOfficer.has(i.officer.id)) byOfficer.set(i.officer.id, { user: i.officer, lines: [] });
      byOfficer.get(i.officer.id)!.lines.push(`${i.name}: follow-up inspection overdue by ${i.daysOverdue} day(s) (due ${fmtDate(i.nextInspectionDate)})`);
    }
    for (const { user, lines } of byOfficer.values()) {
      await notify(tx, {
        recipients: [{ id: user.id, email: user.email, name: user.name }], event: 'JM_OVERDUE_REMINDER', module: 'JM_REPORT', entityRef: 'JM-REMINDER',
        title: `${lines.length} overdue Jawan Markaz item(s) need your attention`, details: lines.slice(0, 30).map((l, n) => [`${n + 1}`, l]), link: '/jm/registers?tab=actions&overdue=true',
      });
      messages++;
    }
    if ((actions.length || inspections.length) && supervisors.length) {
      await notify(tx, {
        recipients: supervisors.map((u) => ({ id: u.id, email: u.email, name: u.name })), event: 'JM_OVERDUE_DIGEST', module: 'JM_REPORT', entityRef: 'JM-REMINDER',
        title: `Jawan Markaz overdue digest: ${actions.length} corrective action(s), ${inspections.length} inspection(s)`,
        details: [...inspections.slice(0, 15).map((i) => [`Inspection`, `${i.name} — ${i.daysOverdue} day(s) overdue`] as [string, string]), ...actions.slice(0, 15).map((a) => [`Action`, `${a.asset.name} — ${a.description} (due ${fmtDate(a.targetDate)})`] as [string, string])],
        link: '/jm',
      });
      messages += supervisors.length;
    }
    await tx.systemSetting.upsert({ where: { key: 'jmRemindersLastRun' }, create: { key: 'jmRemindersLastRun', value: today.toISOString().slice(0, 10) }, update: { value: today.toISOString().slice(0, 10) } });
    await tx.auditLog.create({
      data: { actorId: actor?.id ?? null, actorName: actor?.name ?? 'System', action: 'JM_REMINDERS_SENT', module: 'JM', entityType: 'JmReminder', after: { trigger, overdueActions: actions.length, overdueInspections: inspections.length, messages } },
    });
  });
  return { overdueActions: actions.length, overdueInspections: inspections.length, messages };
}

/** Called by the background sweep: runs at most once per calendar day (server timezone setting), after 08:00. */
export async function maybeSendDailyJmReminders() {
  const s = await getSettings();
  if (!s.jmRemindersEnabled) return;
  const local = new Date(new Date().toLocaleString('en-US', { timeZone: s.timezone }));
  if (local.getHours() < 8) return;
  const last = await prisma.systemSetting.findUnique({ where: { key: 'jmRemindersLastRun' } });
  if (last?.value === new Date().toISOString().slice(0, 10)) return;
  await sendJmReminders('SCHEDULE');
}

jmMonitoringRouter.post('/reminders/run', requirePerm('jm.register.update', 'admin.settings'), async (req, res) => {
  const r = await sendJmReminders('MANUAL', { id: req.user!.id, name: req.user!.name });
  res.json(r);
});
