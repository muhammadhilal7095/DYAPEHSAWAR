/**
 * Configurable sequential approval engine shared by all modules.
 *
 *  submit ─► level 1 ─approve─► level 2 ─approve─► … ─approve(final)─► APPROVED
 *              │  ▲                 │
 *              │  └── resubmit ◄── return ──► RETURNED (requester edits)
 *              └─ reject ─► REJECTED (stops; reopen requires workflow.reopen)
 *
 * Every transition runs inside the caller's (serializable) transaction so the decision,
 * the closing of the current assignment and the assignment of the next officer commit together.
 */
import type { WorkflowLevel, WorkflowInstance } from '@prisma/client';
import type { Tx, Db } from '../db.js';
import { conflict, forbidden, badRequest, notFound } from '../lib/http.js';
import { can, type AuthUser } from '../lib/auth.js';
import { notify, type Recipient } from '../lib/notify.js';

export type WorkflowModule = 'DAAMR_REQUEST' | 'DAAMR_REPORT' | 'HOSTEL_BOOKING' | 'JM_REPORT' | 'COURSE_SESSION' | 'COURSE_COMPLETION';
export const MODULE_LABEL: Record<WorkflowModule, string> = {
  DAAMR_REQUEST: 'DAAMR activity request',
  DAAMR_REPORT: 'Activity report verification',
  HOSTEL_BOOKING: 'Youth hostel booking',
  JM_REPORT: 'Jawan Markaz monitoring report',
  COURSE_SESSION: 'Daily training session report',
  COURSE_COMPLETION: 'Course completion report',
};

export type Decision = 'APPROVE' | 'REJECT' | 'RETURN';

export interface EntitySummary {
  entityId: string;
  ref: string;
  subject: string;
  link: string;
  requester: Recipient;
  extraEmails?: string[];
  details: [string, string | null | undefined][];
}

export type Phase =
  | { kind: 'ASSIGNED'; levelOrder: number; isFirst: boolean; isFinal: boolean }
  | { kind: 'RETURNED' }
  | { kind: 'REJECTED' }
  | { kind: 'APPROVED' }
  | { kind: 'CANCELLED' };

export interface DecisionContext {
  instance: WorkflowInstance;
  level: WorkflowLevel;
  isFinal: boolean;
  action: Decision;
  remarks: string | null;
  extra: Record<string, any>;
  actor: AuthUser;
}

export interface ModuleAdapter {
  module: WorkflowModule;
  summary(tx: Tx, instance: WorkflowInstance): Promise<EntitySummary>;
  setPhase(tx: Tx, instance: WorkflowInstance, phase: Phase): Promise<void>;
  /** Validate / apply module-specific decision data (e.g. approved dates). Throw to block. */
  beforeDecision?(tx: Tx, ctx: DecisionContext): Promise<void>;
  /** Called once after final approval inside the same transaction. */
  onFinalApproved?(tx: Tx, ctx: DecisionContext): Promise<void>;
  /** Extra lines appended to notification emails for a decision (e.g. changed dates). */
  decisionDetails?(tx: Tx, ctx: DecisionContext): Promise<[string, string | null | undefined][]>;
  /** Officer for RESPONSIBLE_OFFICER levels (e.g. the lead staff member assigned to an activity). */
  responsibleOfficer?(tx: Tx, instance: WorkflowInstance): Promise<string | null>;
}

const adapters = new Map<WorkflowModule, ModuleAdapter>();
export function registerAdapter(a: ModuleAdapter) {
  adapters.set(a.module, a);
}
function adapterFor(module: string): ModuleAdapter {
  const a = adapters.get(module as WorkflowModule);
  if (!a) throw new Error(`No workflow adapter registered for ${module}`);
  return a;
}

// ───────────────────────── helpers ─────────────────────────

const userSel = { id: true, name: true, email: true, designation: true, isActive: true } as const;

export async function findDefinition(db: Db, module: WorkflowModule, districtId: string | null) {
  const defs = await db.workflowDefinition.findMany({
    where: { module, isActive: true, OR: [{ districtId }, { districtId: null }] },
    include: { levels: { orderBy: { order: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
  });
  const def = defs.find((d) => d.districtId && d.districtId === districtId) ?? defs.find((d) => !d.districtId);
  if (!def || def.levels.length === 0) {
    throw badRequest(`No active approval workflow is configured for "${MODULE_LABEL[module]}". Ask an administrator to configure one.`);
  }
  return def;
}

async function levelsOf(db: Db, definitionId: string) {
  return db.workflowLevel.findMany({ where: { definitionId }, orderBy: { order: 'asc' } });
}

/** Picks the officer for a level. ROLE levels choose the least-loaded eligible user. The submitter is never their own approver. */
export async function resolveAssignee(db: Db, level: WorkflowLevel, districtId: string | null, submitterId: string, inst?: WorkflowInstance) {
  if (level.approverType === 'RESPONSIBLE_OFFICER') {
    const id = inst ? await adapterFor(inst.module).responsibleOfficer?.(db as Tx, inst) : null;
    if (!id || id === submitterId) return null;
    const u = await db.user.findUnique({ where: { id }, select: userSel });
    return u?.isActive ? u : null;
  }
  if (level.approverType === 'USER') {
    if (!level.approverUserId || level.approverUserId === submitterId) return null;
    const u = await db.user.findUnique({ where: { id: level.approverUserId }, select: userSel });
    return u?.isActive ? u : null;
  }
  if (!level.approverRoleId) return null;
  const candidates = await db.user.findMany({
    where: {
      isActive: true,
      id: { not: submitterId },
      roles: { some: { roleId: level.approverRoleId } },
      ...(level.districtScope === 'SAME_DISTRICT' ? { districtId: districtId ?? '__none__' } : {}),
    },
    select: { ...userSel, _count: { select: { currentInstances: { where: { status: 'IN_PROGRESS' } } } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => a._count.currentInstances - b._count.currentInstances);
  const { _count, ...u } = candidates[0];
  return u;
}

async function adminRecipients(db: Db): Promise<Recipient[]> {
  const users = await db.user.findMany({ where: { isActive: true }, include: { roles: { include: { role: true } } } });
  return users
    .filter((u) => u.roles.some((r) => ((r.role.permissions as string[]) ?? []).includes('workflow.override')))
    .map((u) => ({ id: u.id, email: u.email, name: u.name }));
}

async function history(tx: Tx, inst: WorkflowInstance, data: {
  action: string;
  actor?: AuthUser | null;
  level?: WorkflowLevel | null;
  levelOrder?: number | null;
  levelName?: string | null;
  target?: { id: string; name: string } | null;
  remarks?: string | null;
  data?: any;
}) {
  await tx.approvalHistory.create({
    data: {
      instanceId: inst.id,
      cycle: inst.cycle,
      levelOrder: data.level?.order ?? data.levelOrder ?? null,
      levelName: data.level?.name ?? data.levelName ?? null,
      action: data.action,
      actorId: data.actor?.id ?? null,
      actorName: data.actor?.name ?? 'System',
      actorDesignation: data.actor?.designation ?? null,
      targetUserId: data.target?.id ?? null,
      targetUserName: data.target?.name ?? null,
      remarks: data.remarks ?? null,
      data: data.data ?? undefined,
    },
  });
}

async function snapshotVersion(tx: Tx, inst: WorkflowInstance, entityType: string, entityId: string, snapshot: unknown, reason: string, actorId: string) {
  const last = await tx.entityVersion.findFirst({ where: { entityType, entityId }, orderBy: { version: 'desc' } });
  await tx.entityVersion.create({
    data: {
      instanceId: inst.id,
      entityType,
      entityId,
      version: (last?.version ?? 0) + 1,
      reason,
      snapshot: JSON.parse(JSON.stringify(snapshot)),
      createdById: actorId,
    },
  });
}

/** Assigns the instance to the officer for `level` (or a forced assignee) and notifies them. */
async function assignLevel(
  tx: Tx,
  inst: WorkflowInstance,
  level: WorkflowLevel,
  allLevels: WorkflowLevel[],
  actor: AuthUser | null,
  opts: { forcedAssignee?: { id: string; name: string; email: string } | null; reason?: string | null; silentRequester?: boolean } = {},
) {
  const adapter = adapterFor(inst.module);
  const assignee = opts.forcedAssignee ?? (await resolveAssignee(tx, level, inst.districtId, inst.submittedById, inst));
  const now = new Date();
  await tx.officerAssignment.create({
    data: {
      instanceId: inst.id,
      levelId: level.id,
      levelOrder: level.order,
      levelName: level.name,
      assigneeId: assignee?.id ?? null,
      assignedById: actor?.id ?? null,
      assignedAt: now,
      reason: opts.reason ?? null,
    },
  });
  const updated = await tx.workflowInstance.update({
    where: { id: inst.id },
    data: {
      status: 'IN_PROGRESS',
      currentLevelOrder: level.order,
      currentAssigneeId: assignee?.id ?? null,
      currentAssignedAt: now,
      completedAt: null,
    },
  });
  const isFinal = level.order === allLevels[allLevels.length - 1].order;
  await adapter.setPhase(tx, updated, { kind: 'ASSIGNED', levelOrder: level.order, isFirst: level.order === allLevels[0].order, isFinal });
  const summary = await adapter.summary(tx, updated);

  if (assignee) {
    await history(tx, updated, { action: 'ASSIGNED', actor, level, target: assignee });
    await notify(tx, {
      recipients: [assignee],
      event: 'ASSIGNED',
      module: inst.module,
      entityRef: summary.ref,
      instanceId: inst.id,
      title: `${MODULE_LABEL[inst.module as WorkflowModule]} assigned to you for review (${level.name})`,
      details: [['Reference', summary.ref], ['Subject', summary.subject], ['Approval level', `${level.order}. ${level.name}`], ...summary.details],
      remarks: opts.reason,
      link: summary.link,
    });
  } else {
    await history(tx, updated, { action: 'PENDING_ASSIGNMENT', actor, level, remarks: 'No eligible officer is configured for this level. Awaiting administrator assignment.' });
    await notify(tx, {
      recipients: await adminRecipients(tx),
      event: 'PENDING_ASSIGNMENT',
      module: inst.module,
      entityRef: summary.ref,
      instanceId: inst.id,
      title: `No officer available for "${level.name}" — manual assignment required`,
      details: [['Reference', summary.ref], ['Subject', summary.subject]],
      link: summary.link,
    });
  }
  return { instance: updated, assignee, summary };
}

// ───────────────────────── public API ─────────────────────────

export async function startWorkflow(
  tx: Tx,
  args: {
    module: WorkflowModule;
    entityType: string;
    entityId: string;
    entityRef: string;
    districtId: string | null;
    actor: AuthUser;
    snapshot: unknown;
  },
) {
  const def = await findDefinition(tx, args.module, args.districtId);
  const inst = await tx.workflowInstance.create({
    data: {
      module: args.module,
      entityRef: args.entityRef,
      definitionId: def.id,
      submittedById: args.actor.id,
      districtId: args.districtId,
    },
  });
  await snapshotVersion(tx, inst, args.entityType, args.entityId, args.snapshot, 'Original submission', args.actor.id);
  await history(tx, inst, { action: 'SUBMITTED', actor: args.actor });
  return inst;
}

/** Second half of start: must be called after the entity row links workflowInstanceId. */
export async function assignFirstLevel(tx: Tx, instanceId: string, actor: AuthUser) {
  const inst = await tx.workflowInstance.findUniqueOrThrow({ where: { id: instanceId } });
  const levels = await levelsOf(tx, inst.definitionId);
  const r = await assignLevel(tx, inst, levels[0], levels, actor);
  await notify(tx, {
    recipients: [r.summary.requester],
    extraEmails: r.summary.extraEmails,
    event: 'SUBMITTED',
    module: inst.module,
    entityRef: r.summary.ref,
    instanceId: inst.id,
    title: `Your ${MODULE_LABEL[inst.module as WorkflowModule].toLowerCase()} has been submitted`,
    details: [
      ['Reference', r.summary.ref],
      ['Subject', r.summary.subject],
      ['Status', 'Pending Review'],
      ['Assigned officer', r.assignee ? r.assignee.name : 'Pending assignment'],
      ...r.summary.details,
    ],
    link: r.summary.link,
  });
  return r.instance;
}

export function canActOn(inst: WorkflowInstance, user: AuthUser) {
  return inst.status === 'IN_PROGRESS' && (inst.currentAssigneeId === user.id || can(user, 'workflow.override'));
}

export async function decide(
  tx: Tx,
  instanceId: string,
  actor: AuthUser,
  input: { action: Decision; remarks?: string | null; extra?: Record<string, any>; expectedModule?: WorkflowModule; evidence?: { id: string; name: string }[] },
) {
  const inst = await tx.workflowInstance.findUnique({ where: { id: instanceId } });
  if (!inst) throw notFound();
  if (input.expectedModule && inst.module !== input.expectedModule) throw notFound();
  if (inst.status !== 'IN_PROGRESS') throw conflict('This item is not awaiting a decision.');
  if (inst.currentAssigneeId !== actor.id && !can(actor, 'workflow.override')) {
    throw forbidden('This item is assigned to another officer. You cannot decide on it.');
  }
  if (inst.currentAssigneeId === null && !can(actor, 'workflow.override')) throw forbidden();
  if (inst.submittedById === actor.id && !can(actor, 'workflow.self_approve')) throw forbidden('You cannot approve or decide on your own submission.');

  const levels = await levelsOf(tx, inst.definitionId);
  const level = levels.find((l) => l.order === inst.currentLevelOrder);
  if (!level) throw conflict('The configured approval level no longer exists. Ask an administrator to reassign this item.');
  const idx = levels.indexOf(level);
  const isFinal = idx === levels.length - 1;
  const remarks = input.remarks?.trim() || null;

  if (input.action === 'REJECT' && !level.allowReject) throw forbidden('Rejection is not permitted at this approval level.');
  if (input.action === 'RETURN' && !level.allowReturn) throw forbidden('Return for revision is not permitted at this approval level.');
  if ((input.action === 'REJECT' || input.action === 'RETURN') && (!remarks || remarks.length < 3)) {
    throw badRequest('Remarks are required when rejecting or returning.', { fields: { remarks: 'Remarks are required' } });
  }

  // Claim the item atomically so two officers / double clicks cannot decide twice.
  const claimed = await tx.workflowInstance.updateMany({
    where: { id: inst.id, status: 'IN_PROGRESS', currentLevelOrder: inst.currentLevelOrder, currentAssigneeId: inst.currentAssigneeId },
    data: { updatedAt: new Date() },
  });
  if (claimed.count !== 1) throw conflict('This item was already processed by someone else.');

  const adapter = adapterFor(inst.module);
  const ctx: DecisionContext = { instance: inst, level, isFinal, action: input.action, remarks, extra: input.extra ?? {}, actor };
  await adapter.beforeDecision?.(tx, ctx);

  await tx.officerAssignment.updateMany({
    where: { instanceId: inst.id, status: 'ACTIVE' },
    data: { status: 'COMPLETED', completedAt: new Date(), outcome: input.action === 'APPROVE' ? 'APPROVED' : input.action === 'REJECT' ? 'REJECTED' : 'RETURNED' },
  });

  const extraDetails = (await adapter.decisionDetails?.(tx, ctx)) ?? [];
  const histData: Record<string, any> = {};
  if (inst.currentAssigneeId && inst.currentAssigneeId !== actor.id) histData.overrideOf = inst.currentAssigneeId;
  if (inst.submittedById === actor.id) histData.selfDecision = true;
  if (input.evidence?.length) histData.evidence = input.evidence;
  const onBehalf = Object.keys(histData).length ? histData : undefined;

  if (input.action === 'APPROVE') {
    await history(tx, inst, { action: isFinal ? 'FINAL_APPROVED' : 'APPROVED', actor, level, remarks, data: onBehalf });
    if (!isFinal) {
      const next = levels[idx + 1];
      const r = await assignLevel(tx, inst, next, levels, actor);
      await notify(tx, {
        recipients: [r.summary.requester],
        event: 'FORWARDED',
        module: inst.module,
        entityRef: r.summary.ref,
        instanceId: inst.id,
        title: `Approved at "${level.name}" and forwarded to the next stage`,
        details: [
          ['Reference', r.summary.ref],
          ['Subject', r.summary.subject],
          ['Approved by', `${actor.name}${actor.designation ? ` (${actor.designation})` : ''}`],
          ['Now with', r.assignee ? `${r.assignee.name} — ${next.name}` : `${next.name} (pending assignment)`],
          ...extraDetails,
        ],
        remarks,
        link: r.summary.link,
      });
      return r.instance;
    }
    const done = await tx.workflowInstance.update({
      where: { id: inst.id },
      data: { status: 'APPROVED', completedAt: new Date(), currentAssigneeId: null },
    });
    await adapter.onFinalApproved?.(tx, { ...ctx, instance: done });
    await adapter.setPhase(tx, done, { kind: 'APPROVED' });
    const summary = await adapter.summary(tx, done);
    const prior = await tx.approvalHistory.findMany({ where: { instanceId: inst.id, actorId: { not: null } }, select: { actor: { select: { id: true, name: true, email: true } } } });
    await notify(tx, {
      recipients: [summary.requester, ...prior.map((p) => p.actor!).filter((a) => a && a.id !== actor.id)],
      extraEmails: summary.extraEmails,
      event: 'FINAL_APPROVED',
      module: inst.module,
      entityRef: summary.ref,
      instanceId: inst.id,
      title: `Final approval completed`,
      details: [['Reference', summary.ref], ['Subject', summary.subject], ['Approved by', `${actor.name} — ${level.name}`], ...summary.details, ...extraDetails],
      remarks,
      link: summary.link,
    });
    return done;
  }

  if (input.action === 'RETURN') {
    const upd = await tx.workflowInstance.update({
      where: { id: inst.id },
      data: { status: 'RETURNED', returnedAtLevel: level.order, currentAssigneeId: null },
    });
    await history(tx, upd, { action: 'RETURNED', actor, level, remarks, data: onBehalf });
    await adapter.setPhase(tx, upd, { kind: 'RETURNED' });
    const summary = await adapter.summary(tx, upd);
    await notify(tx, {
      recipients: [summary.requester],
      extraEmails: summary.extraEmails,
      event: 'RETURNED',
      module: inst.module,
      entityRef: summary.ref,
      instanceId: inst.id,
      title: `Returned to you for revision`,
      details: [['Reference', summary.ref], ['Subject', summary.subject], ['Returned by', `${actor.name} — ${level.name}`], ['Status', 'Returned for Revision']],
      remarks,
      link: summary.link,
    });
    return upd;
  }

  // REJECT
  const upd = await tx.workflowInstance.update({
    where: { id: inst.id },
    data: { status: 'REJECTED', completedAt: new Date(), currentAssigneeId: null },
  });
  await history(tx, upd, { action: 'REJECTED', actor, level, remarks, data: onBehalf });
  await adapter.setPhase(tx, upd, { kind: 'REJECTED' });
  const summary = await adapter.summary(tx, upd);
  const prior = await tx.approvalHistory.findMany({ where: { instanceId: inst.id, actorId: { not: null } }, select: { actor: { select: { id: true, name: true, email: true } } } });
  await notify(tx, {
    recipients: [summary.requester, ...prior.map((p) => p.actor!).filter((a) => a && a.id !== actor.id)],
    extraEmails: summary.extraEmails,
    event: 'REJECTED',
    module: inst.module,
    entityRef: summary.ref,
    instanceId: inst.id,
    title: inst.module === 'HOSTEL_BOOKING' ? 'Booking declined' : 'Rejected',
    details: [['Reference', summary.ref], ['Subject', summary.subject], ['Decided by', `${actor.name} — ${level.name}`]],
    remarks,
    link: summary.link,
  });
  return upd;
}

export async function resubmit(tx: Tx, instanceId: string, actor: AuthUser, args: { entityType: string; entityId: string; snapshot: unknown; remarks?: string | null }) {
  const inst = await tx.workflowInstance.findUnique({ where: { id: instanceId }, include: { definition: true } });
  if (!inst) throw notFound();
  if (inst.status !== 'RETURNED') throw conflict('Only items returned for revision can be resubmitted.');
  if (inst.submittedById !== actor.id && !can(actor, 'workflow.override')) throw forbidden();
  const upd = await tx.workflowInstance.update({ where: { id: inst.id }, data: { cycle: inst.cycle + 1 } });
  await snapshotVersion(tx, upd, args.entityType, args.entityId, args.snapshot, `Resubmission (cycle ${upd.cycle})`, actor.id);
  await history(tx, upd, { action: 'RESUBMITTED', actor, remarks: args.remarks ?? null });
  const levels = await levelsOf(tx, inst.definitionId);
  const target =
    inst.definition.resubmitPolicy === 'RETURNING_LEVEL'
      ? levels.find((l) => l.order === inst.returnedAtLevel) ?? levels[0]
      : levels[0];
  const r = await assignLevel(tx, upd, target, levels, actor);
  await notify(tx, {
    recipients: [r.summary.requester],
    event: 'RESUBMITTED',
    module: inst.module,
    entityRef: r.summary.ref,
    instanceId: inst.id,
    title: 'Resubmitted after revision',
    details: [['Reference', r.summary.ref], ['Now with', r.assignee ? `${r.assignee.name} — ${target.name}` : `${target.name} (pending assignment)`]],
    link: r.summary.link,
  });
  return r.instance;
}

export async function reassign(tx: Tx, instanceId: string, actor: AuthUser, args: { userId: string; remarks: string }) {
  const inst = await tx.workflowInstance.findUnique({ where: { id: instanceId } });
  if (!inst) throw notFound();
  if (inst.status !== 'IN_PROGRESS') throw conflict('Only items under review can be reassigned.');
  const levels = await levelsOf(tx, inst.definitionId);
  const level = levels.find((l) => l.order === inst.currentLevelOrder);
  if (!level) throw conflict('Approval level not found.');
  const isOverride = can(actor, 'workflow.override');
  if (!isOverride && !(inst.currentAssigneeId === actor.id && level.allowReassign)) {
    throw forbidden('You are not permitted to reassign this item.');
  }
  if (!args.remarks?.trim()) throw badRequest('A reason is required for reassignment.', { fields: { remarks: 'Reason is required' } });
  const target = await tx.user.findUnique({ where: { id: args.userId }, select: userSel });
  if (!target?.isActive) throw badRequest('Selected officer is not active.');
  if (target.id === inst.submittedById) throw badRequest('An item cannot be assigned to its own submitter.');
  if (target.id === inst.currentAssigneeId) throw badRequest('The item is already assigned to this officer.');

  await tx.officerAssignment.updateMany({ where: { instanceId: inst.id, status: 'ACTIVE' }, data: { status: 'REASSIGNED', completedAt: new Date() } });
  await history(tx, inst, { action: 'REASSIGNED', actor, level, target, remarks: args.remarks });
  const r = await assignLevel(tx, inst, level, levels, actor, { forcedAssignee: target, reason: args.remarks });
  await notify(tx, {
    recipients: [r.summary.requester],
    event: 'REASSIGNED',
    module: inst.module,
    entityRef: r.summary.ref,
    instanceId: inst.id,
    title: `Reassigned to ${target.name}`,
    details: [['Reference', r.summary.ref], ['Approval level', level.name], ['Now with', target.name]],
    remarks: args.remarks,
    link: r.summary.link,
  });
  return r.instance;
}

/**
 * Re-runs officer resolution for an item waiting at a level with no officer (PENDING_ASSIGNMENT),
 * e.g. after the activity's responsible officer has been assigned. No-op when an officer is already set.
 */
export async function fillPendingAssignment(tx: Tx, instanceId: string, actor: AuthUser) {
  const inst = await tx.workflowInstance.findUnique({ where: { id: instanceId } });
  if (!inst || inst.status !== 'IN_PROGRESS' || inst.currentAssigneeId) return null;
  const levels = await levelsOf(tx, inst.definitionId);
  const level = levels.find((l) => l.order === inst.currentLevelOrder);
  if (!level) return null;
  const officer = await resolveAssignee(tx, level, inst.districtId, inst.submittedById, inst);
  if (!officer) return null;
  await tx.officerAssignment.updateMany({ where: { instanceId: inst.id, status: 'ACTIVE' }, data: { status: 'REASSIGNED', completedAt: new Date() } });
  const r = await assignLevel(tx, inst, level, levels, actor, { forcedAssignee: officer, reason: 'Officer became available for this level' });
  return r.instance;
}

export async function reopen(tx: Tx, instanceId: string, actor: AuthUser, remarks: string) {
  if (!can(actor, 'workflow.reopen')) throw forbidden('Only authorised officers can reopen rejected items.');
  const inst = await tx.workflowInstance.findUnique({ where: { id: instanceId } });
  if (!inst) throw notFound();
  if (inst.status !== 'REJECTED') throw conflict('Only rejected items can be reopened.');
  if (!remarks?.trim()) throw badRequest('A reason is required to reopen.', { fields: { remarks: 'Reason is required' } });
  const upd = await tx.workflowInstance.update({ where: { id: inst.id }, data: { cycle: inst.cycle + 1, completedAt: null } });
  await history(tx, upd, { action: 'REOPENED', actor, remarks });
  const levels = await levelsOf(tx, inst.definitionId);
  const r = await assignLevel(tx, upd, levels[0], levels, actor);
  return r.instance;
}

export async function cancel(tx: Tx, instanceId: string, actor: AuthUser, remarks: string) {
  const inst = await tx.workflowInstance.findUnique({ where: { id: instanceId } });
  if (!inst) throw notFound();
  if (!['IN_PROGRESS', 'RETURNED', 'APPROVED'].includes(inst.status)) throw conflict('This item cannot be cancelled.');
  await tx.officerAssignment.updateMany({ where: { instanceId: inst.id, status: 'ACTIVE' }, data: { status: 'CANCELLED', completedAt: new Date() } });
  const upd = await tx.workflowInstance.update({ where: { id: inst.id }, data: { status: 'CANCELLED', completedAt: new Date(), currentAssigneeId: null } });
  await history(tx, upd, { action: 'CANCELLED', actor, remarks });
  await adapterFor(inst.module).setPhase(tx, upd, { kind: 'CANCELLED' });
  return upd;
}

// ───────────────────────── timeline ─────────────────────────

export interface TimelineStage {
  key: string;
  label: string;
  levelOrder?: number;
  designation?: string | null;
  state:
    | 'COMPLETED'
    | 'APPROVED'
    | 'PENDING_REVIEW'
    | 'PENDING_ASSIGNMENT'
    | 'AWAITING_PREVIOUS'
    | 'RETURNED'
    | 'REJECTED'
    | 'NOT_REACHED'
    | 'CANCELLED';
  officer?: { id: string; name: string; designation: string | null } | null;
  assignedAt?: Date | null;
  completedAt?: Date | null;
  decision?: string | null;
  remarks?: string | null;
  isCurrent?: boolean;
  evidence?: { id: string; name: string }[];
}

export async function buildTimeline(db: Db, instanceId: string) {
  const inst = await db.workflowInstance.findUnique({
    where: { id: instanceId },
    include: {
      currentAssignee: { select: { id: true, name: true, designation: true, email: true } },
      history: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { id: true, name: true, designation: true } } } },
      assignments: { orderBy: { assignedAt: 'asc' }, include: { assignee: { select: { id: true, name: true, designation: true } } } },
      definition: { include: { levels: { orderBy: { order: 'asc' } } } },
    },
  });
  if (!inst) throw notFound();
  const levels = inst.definition.levels;
  const cycleHist = inst.history.filter((h) => h.cycle === inst.cycle);
  const cycleStart = [...cycleHist].reverse().find((h) => ['SUBMITTED', 'RESUBMITTED', 'REOPENED'].includes(h.action))?.createdAt ?? inst.startedAt;
  const firstSubmit = inst.history.find((h) => h.action === 'SUBMITTED');

  const stages: TimelineStage[] = [
    {
      key: 'submitted',
      label: inst.cycle > 1 ? `Submitted (resubmission ${inst.cycle - 1})` : 'Request submitted',
      state: 'COMPLETED',
      officer: firstSubmit?.actor ? { id: firstSubmit.actor.id, name: firstSubmit.actor.name, designation: firstSubmit.actor.designation } : null,
      completedAt: cycleStart,
    },
  ];

  for (const lvl of levels) {
    const decisionRow = [...cycleHist].reverse().find((h) => h.levelOrder === lvl.order && ['APPROVED', 'FINAL_APPROVED', 'RETURNED', 'REJECTED'].includes(h.action));
    const asg = [...inst.assignments].reverse().find((a) => a.levelOrder === lvl.order && a.assignedAt >= cycleStart);
    const base = { key: `level-${lvl.order}`, label: lvl.name, levelOrder: lvl.order, designation: lvl.designation };
    if (decisionRow) {
      stages.push({
        ...base,
        state: decisionRow.action === 'RETURNED' ? 'RETURNED' : decisionRow.action === 'REJECTED' ? 'REJECTED' : 'APPROVED',
        officer: decisionRow.actor ? { id: decisionRow.actor.id, name: decisionRow.actor.name, designation: decisionRow.actorDesignation } : null,
        assignedAt: asg?.assignedAt ?? null,
        completedAt: decisionRow.createdAt,
        decision: decisionRow.action,
        remarks: decisionRow.remarks,
        evidence: (decisionRow.data as any)?.evidence ?? [],
      });
      continue;
    }
    if (inst.status === 'IN_PROGRESS' && inst.currentLevelOrder === lvl.order) {
      stages.push({
        ...base,
        state: inst.currentAssignee ? 'PENDING_REVIEW' : 'PENDING_ASSIGNMENT',
        officer: inst.currentAssignee ? { id: inst.currentAssignee.id, name: inst.currentAssignee.name, designation: inst.currentAssignee.designation } : null,
        assignedAt: inst.currentAssignedAt,
        isCurrent: true,
      });
      continue;
    }
    const halted = ['RETURNED', 'REJECTED', 'CANCELLED'].includes(inst.status);
    stages.push({ ...base, state: inst.status === 'CANCELLED' ? 'CANCELLED' : halted ? 'NOT_REACHED' : 'AWAITING_PREVIOUS' });
  }

  return {
    instance: {
      id: inst.id,
      module: inst.module,
      status: inst.status,
      cycle: inst.cycle,
      currentLevelOrder: inst.currentLevelOrder,
      currentLevelName: levels.find((l) => l.order === inst.currentLevelOrder)?.name ?? null,
      totalLevels: levels.length,
      currentAssignee: inst.currentAssignee,
      currentAssignedAt: inst.currentAssignedAt,
      submittedById: inst.submittedById,
      startedAt: inst.startedAt,
      completedAt: inst.completedAt,
      workflowName: inst.definition.name,
      currentLevel: levels.find((l) => l.order === inst.currentLevelOrder) ?? null,
    },
    stages,
    history: inst.history.map((h) => ({
      id: h.id,
      cycle: h.cycle,
      action: h.action,
      levelOrder: h.levelOrder,
      levelName: h.levelName,
      actorName: h.actorName,
      actorDesignation: h.actorDesignation,
      targetUserName: h.targetUserName,
      remarks: h.remarks,
      data: h.data,
      createdAt: h.createdAt,
    })),
  };
}

/** True when the user is or was an assignee / actor on the instance (grants read access to reviewers). */
export async function isInvolved(db: Db, instanceId: string | null | undefined, userId: string) {
  if (!instanceId) return false;
  const n = await db.officerAssignment.count({ where: { instanceId, assigneeId: userId } });
  if (n > 0) return true;
  return (await db.approvalHistory.count({ where: { instanceId, actorId: userId } })) > 0;
}
