import { prisma, type Db } from '../../db.js';
import { can, type AuthUser } from '../../lib/auth.js';
import { registerFileTarget } from '../../lib/fileTargets.js';
import { getSettings, type Settings } from '../../lib/settings.js';
import { fmtDate } from '../../lib/export.js';
import { audit } from '../../lib/audit.js';
import { registerAdapter } from '../../workflow/engine.js';

export const SCHEDULE_CLASSES = ['ON_SCHEDULE', 'SLIGHTLY_DELAYED', 'SIGNIFICANTLY_DELAYED', 'NOT_APPLICABLE'] as const;

export function jmScope(user: AuthUser): any {
  if (can(user, 'jm.report.view_all')) return {};
  const or: any[] = [
    { reportingOfficerId: user.id },
    { workflow: { assignments: { some: { assigneeId: user.id } } } },
    { workflow: { history: { some: { actorId: user.id } } } },
  ];
  if (can(user, 'jm.report.view_district') && user.districtId) or.push({ districtId: user.districtId, status: { not: 'DRAFT' } });
  return { OR: or };
}

export async function canViewJmReport(user: AuthUser, id: string) {
  return (await prisma.jmReport.count({ where: { AND: [{ id }, jmScope(user)] } })) > 0;
}

/** Assets are master data visible to everyone working in the JM module. */
export function canViewAssets(user: AuthUser) {
  return ['jm.asset.manage', 'jm.report.create', 'jm.report.view_all', 'jm.report.view_district', 'jm.dashboard'].some((p) => can(user, p)) || can(user, 'workflow.override');
}

/**
 * Classifies schedule performance with configurable thresholds:
 *  – when delay in days is known: 0 → On schedule, 1..N → Slightly, >N → Significantly delayed
 *  – otherwise uses the planned − actual progress gap in percentage points with the same idea
 *  – Not applicable when there is no baseline (e.g. not started / no plan)
 */
export function classifySchedule(
  r: { projectStatus: string; delayDays: number | null; plannedProgress: number | null; currentProgress: number; actualCompletion: number | null },
  s: Pick<Settings, 'jmSlightDelayMaxDays' | 'jmSlightGapMaxPct'>,
) {
  if (r.delayDays !== null && r.delayDays !== undefined) {
    if (r.delayDays <= 0) return 'ON_SCHEDULE';
    return r.delayDays <= s.jmSlightDelayMaxDays ? 'SLIGHTLY_DELAYED' : 'SIGNIFICANTLY_DELAYED';
  }
  if (r.plannedProgress !== null && r.plannedProgress !== undefined) {
    const actual = r.actualCompletion ?? r.currentProgress;
    const gap = r.plannedProgress - actual;
    if (gap <= 0) return 'ON_SCHEDULE';
    return gap <= s.jmSlightGapMaxPct ? 'SLIGHTLY_DELAYED' : 'SIGNIFICANTLY_DELAYED';
  }
  if (r.projectStatus === 'COMPLETED') return 'ON_SCHEDULE';
  return 'NOT_APPLICABLE';
}

/** Reasons a report's progress figures look inconsistent (shown to reviewers). */
export function progressDiscrepancies(r: any, cls: string) {
  const out: string[] = [];
  if (r.previousProgress != null && r.currentProgress < r.previousProgress) out.push(`Current progress (${r.currentProgress}%) is lower than the previous verified progress (${r.previousProgress}%).`);
  if (r.previousProgress != null && r.progressDuringPeriod != null && Math.abs(r.currentProgress - r.previousProgress - r.progressDuringPeriod) > 0.5) {
    out.push(`Progress during period (${r.progressDuringPeriod}%) does not equal current − previous (${(r.currentProgress - r.previousProgress).toFixed(1)}%).`);
  }
  if (r.plannedProgress != null && r.plannedProgress - (r.actualCompletion ?? r.currentProgress) > 0) out.push(`Actual progress is ${(r.plannedProgress - (r.actualCompletion ?? r.currentProgress)).toFixed(1)} points behind plan (${r.plannedProgress}%).`);
  const map: Record<string, string> = { ON_SCHEDULE: 'ON_SCHEDULE', SLIGHTLY_DELAYED: 'SLIGHTLY_DELAYED', SIGNIFICANTLY_DELAYED: 'SIGNIFICANTLY_DELAYED' };
  if (map[r.projectStatus] && cls !== 'NOT_APPLICABLE' && map[r.projectStatus] !== cls) out.push(`Officer selected "${r.projectStatus.replace(/_/g, ' ').toLowerCase()}" but the configured rules classify it as "${cls.replace(/_/g, ' ').toLowerCase()}".`);
  if (r.projectStatus === 'COMPLETED' && r.currentProgress < 100) out.push('Status is Completed but progress is below 100%.');
  return out;
}

export async function riskScore(db: Db, probability: string, impact: string) {
  const s = await getSettings();
  const opts = await db.lookupOption.findMany({ where: { OR: [{ group: 'JM_RISK_PROBABILITY', value: probability }, { group: 'JM_RISK_IMPACT', value: impact }] } });
  const p = Number((opts.find((o) => o.group === 'JM_RISK_PROBABILITY')?.meta as any)?.score ?? 0);
  const i = Number((opts.find((o) => o.group === 'JM_RISK_IMPACT')?.meta as any)?.score ?? 0);
  const score = p * i;
  const b = s.jmRiskBands;
  const level = score <= b.low ? 'LOW' : score <= b.medium ? 'MEDIUM' : score <= b.high ? 'HIGH' : 'CRITICAL';
  return { score, level, valid: p > 0 && i > 0 };
}

// ───────────── Workflow adapter ─────────────
registerAdapter({
  module: 'JM_REPORT',
  async summary(tx, inst) {
    const r = await tx.jmReport.findUniqueOrThrow({ where: { workflowInstanceId: inst.id }, include: { asset: true, reportingOfficer: true, district: true } });
    return {
      entityId: r.id,
      ref: r.reportNo,
      subject: `${r.asset.name} — monitoring report ${fmtDate(r.periodFrom)} to ${fmtDate(r.periodTo)}`,
      link: `/jm/reports/${r.id}`,
      requester: { id: r.reportingOfficer.id, email: r.reportingOfficer.email, name: r.reportingOfficer.name },
      details: [['Asset', `${r.asset.assetCode} ${r.asset.name}`], ['District / HQ', r.district.name], ['Inspection date', fmtDate(r.inspectionDate)], ['Progress', `${r.currentProgress}%`], ['Schedule', r.scheduleClass.replace(/_/g, ' ')]],
    };
  },
  async setPhase(tx, inst, phase) {
    const data: any = {};
    if (phase.kind === 'ASSIGNED') data.status = phase.isFirst ? 'PENDING_REVIEW' : 'UNDER_REVIEW';
    else if (phase.kind === 'RETURNED') data.status = 'RETURNED';
    else if (phase.kind === 'REJECTED' || phase.kind === 'CANCELLED') data.status = 'REJECTED';
    else if (phase.kind === 'APPROVED') data.status = 'VERIFIED';
    await tx.jmReport.update({ where: { workflowInstanceId: inst.id }, data });
  },
  async beforeDecision(tx, ctx) {
    if (ctx.remarks && ctx.action === 'APPROVE') {
      const r = await tx.jmReport.findUniqueOrThrow({ where: { workflowInstanceId: ctx.instance.id } });
      const line = `${ctx.level.name} (${ctx.actor.name}): ${ctx.remarks}`;
      await tx.jmReport.update({ where: { id: r.id }, data: { supervisorRemarks: r.supervisorRemarks ? `${r.supervisorRemarks}\n${line}` : line } });
    }
  },
  async onFinalApproved(tx, ctx) {
    const r = await tx.jmReport.findUniqueOrThrow({ where: { workflowInstanceId: ctx.instance.id }, include: { asset: true } });
    await tx.jmReport.update({ where: { id: r.id }, data: { finalReviewerId: ctx.actor.id, finalDecisionAt: new Date(), finalReviewerNote: ctx.remarks } });
    // update the asset master only when this is the newest verified report for it
    const reportDate = r.submittedAt ?? r.createdAt;
    if (!r.asset.lastReportingDate || reportDate >= r.asset.lastReportingDate) {
      const before = { currentStatus: r.asset.currentStatus, overallProgress: r.asset.overallProgress, lastInspectionDate: r.asset.lastInspectionDate, lastReportingDate: r.asset.lastReportingDate, revisedCompletionDate: r.asset.revisedCompletionDate };
      const after = {
        currentStatus: r.projectStatus,
        overallProgress: r.actualCompletion ?? r.currentProgress,
        lastInspectionDate: r.inspectionDate,
        lastReportingDate: reportDate,
        ...(r.revisedCompletionDate ? { revisedCompletionDate: r.revisedCompletionDate } : {}),
      };
      await tx.jmAsset.update({ where: { id: r.assetId }, data: after });
      await audit(tx, null, { action: 'ASSET_UPDATED_FROM_VERIFIED_REPORT', module: 'JM', entityType: 'JmAsset', entityId: r.assetId, entityRef: r.asset.assetCode, before, after: { ...after, report: r.reportNo } }, { id: ctx.actor.id, name: ctx.actor.name });
    }
  },
});

// ───────────── File targets (report first: its photos also carry the asset id) ─────────────
registerFileTarget({
  key: 'jm-report',
  fk: 'jmReportId',
  module: 'JM',
  entityType: 'JmReport',
  categories: { BEFORE_WORK: 'photo', WORK_IN_PROGRESS: 'photo', COMPLETED_WORK: 'photo', DEFECT_EVIDENCE: 'photo', OTHER: 'photo', SUPPORTING: 'doc', QUALITY_EVIDENCE: 'doc', COMPLETED_ACTIVITY: 'doc' },
  canView: canViewJmReport,
  async canUpload(user, id) {
    const r = await prisma.jmReport.findUnique({ where: { id } });
    if (!r) return null;
    if ((r.reportingOfficerId === user.id && ['DRAFT', 'RETURNED'].includes(r.status)) || can(user, 'workflow.override')) return { ref: r.reportNo, extra: { jmAssetId: r.assetId } };
    return null;
  },
  async canDelete(user, id, file) {
    const r = await prisma.jmReport.findUnique({ where: { id } });
    if (!r) return false;
    if (can(user, 'workflow.override')) return true;
    return file.uploadedById === user.id && ['DRAFT', 'RETURNED'].includes(r.status);
  },
});

registerFileTarget({
  key: 'jm-action',
  fk: 'jmActionId',
  module: 'JM',
  entityType: 'JmAction',
  categories: { EVIDENCE: 'doc' },
  async canView(user, id) {
    const a = await prisma.jmAction.findUnique({ where: { id }, select: { reportId: true } });
    return !!a && (await canViewJmReport(user, a.reportId));
  },
  async canUpload(user, id) {
    const a = await prisma.jmAction.findUnique({ where: { id }, include: { report: true } });
    if (!a) return null;
    if (can(user, 'jm.register.update') || a.report.reportingOfficerId === user.id) return { ref: a.report.reportNo };
    return null;
  },
  async canDelete(user, _id, file) {
    return can(user, 'workflow.override') || file.uploadedById === user.id;
  },
});

registerFileTarget({
  key: 'jm-asset',
  fk: 'jmAssetId',
  module: 'JM',
  entityType: 'JmAsset',
  categories: { BEFORE_WORK: 'photo', WORK_IN_PROGRESS: 'photo', COMPLETED_WORK: 'photo', OTHER: 'photo', SUPPORTING: 'doc' },
  async canView(user) {
    return canViewAssets(user);
  },
  async canUpload(user, id) {
    if (!can(user, 'jm.asset.manage')) return null;
    const a = await prisma.jmAsset.findUnique({ where: { id } });
    return a ? { ref: a.assetCode } : null;
  },
  async canDelete(user) {
    return can(user, 'jm.asset.manage');
  },
});
