import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, can, type AuthUser } from '../lib/auth.js';
import { badRequest, forbidden, notFound, parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { transact } from '../lib/notify.js';
import { buildTimeline, decide, reassign, reopen, type WorkflowModule } from '../workflow/engine.js';

export interface WorkflowEntityHooks {
  module: WorkflowModule;
  entityType: string;
  /** Returns { instanceId, ref } for the entity id, or null if not found. */
  locate(id: string): Promise<{ instanceId: string | null; ref: string } | null>;
  canView(user: AuthUser, id: string): Promise<boolean>;
  /** Optional schema for module-specific decision data (e.g. approved dates). */
  extraSchema?: z.ZodTypeAny;
  /** File foreign key used to attach reviewer evidence (files uploaded with category REVIEW_EVIDENCE). */
  evidenceFk?: 'activityRequestId' | 'activityReportId' | 'courseSessionId' | 'courseId';
}

const decisionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'RETURN']),
  remarks: z.string().trim().max(4000).optional().nullable(),
  extra: z.record(z.any()).optional(),
  evidenceFileIds: z.array(z.string().max(40)).max(20).optional(),
});

/** Mounts /:id/decision, /:id/reassign, /:id/reopen, /:id/timeline and /:id/assignees on a module router. */
export function mountWorkflowRoutes(router: Router, hooks: WorkflowEntityHooks) {
  async function resolve(req: Request) {
    const loc = await hooks.locate(String(req.params.id));
    if (!loc) throw notFound();
    if (!(await hooks.canView(req.user!, String(req.params.id)))) throw forbidden('You do not have access to this record.');
    if (!loc.instanceId) throw notFound('This record has not been submitted yet.');
    return loc as { instanceId: string; ref: string };
  }

  router.get('/:id/timeline', requireAuth, async (req, res) => {
    const loc = await resolve(req);
    res.json(await buildTimeline(prisma, loc.instanceId));
  });

  router.post('/:id/decision', requireAuth, async (req, res) => {
    const loc = await resolve(req);
    const body = parse(decisionSchema, req.body);
    const extra = hooks.extraSchema && body.action === 'APPROVE' ? parse(hooks.extraSchema, body.extra ?? {}) : body.extra ?? {};
    const inst = await transact(async (tx) => {
      const before = await tx.workflowInstance.findUniqueOrThrow({ where: { id: loc.instanceId } });
      let evidence: { id: string; name: string }[] = [];
      if (body.evidenceFileIds?.length) {
        if (!hooks.evidenceFk) throw badRequest('Evidence attachments are not supported for this record.');
        const files = await tx.file.findMany({
          where: { id: { in: body.evidenceFileIds }, [hooks.evidenceFk]: String(req.params.id), uploadedById: req.user!.id, category: 'REVIEW_EVIDENCE', deletedAt: null },
          select: { id: true, originalName: true },
        });
        if (files.length !== new Set(body.evidenceFileIds).size) throw badRequest('One or more evidence files are invalid. Upload them again.');
        const used = await tx.approvalHistory.findMany({ where: { instanceId: loc.instanceId }, select: { data: true } });
        const usedIds = new Set(used.flatMap((h: any) => (h.data?.evidence ?? []).map((e: any) => e.id)));
        if (files.some((f) => usedIds.has(f.id))) throw badRequest('Evidence already attached to an earlier decision cannot be reused.');
        evidence = files.map((f) => ({ id: f.id, name: f.originalName }));
      }
      const r = await decide(tx, loc.instanceId, req.user!, { action: body.action, remarks: body.remarks, extra, expectedModule: hooks.module, evidence });
      await audit(tx, req, {
        action: `WORKFLOW_${body.action}`,
        module: hooks.module,
        entityType: hooks.entityType,
        entityId: String(req.params.id),
        entityRef: loc.ref,
        before: { status: before.status, level: before.currentLevelOrder, assignee: before.currentAssigneeId },
        after: { status: r.status, level: r.currentLevelOrder, assignee: r.currentAssigneeId, remarks: body.remarks, extra, evidence: evidence.map((e) => e.name) },
      });
      return r;
    });
    res.json({ ok: true, status: inst.status });
  });

  router.post('/:id/reassign', requireAuth, async (req, res) => {
    const loc = await resolve(req);
    const body = parse(z.object({ userId: z.string().min(1, 'Select an officer'), remarks: z.string().trim().min(3, 'Reason is required').max(2000) }), req.body);
    await transact(async (tx) => {
      const before = await tx.workflowInstance.findUniqueOrThrow({ where: { id: loc.instanceId } });
      const r = await reassign(tx, loc.instanceId, req.user!, body);
      await audit(tx, req, {
        action: 'WORKFLOW_REASSIGN',
        module: hooks.module,
        entityType: hooks.entityType,
        entityId: String(req.params.id),
        entityRef: loc.ref,
        before: { assignee: before.currentAssigneeId },
        after: { assignee: r.currentAssigneeId, remarks: body.remarks },
      });
    });
    res.json({ ok: true });
  });

  router.post('/:id/reopen', requireAuth, async (req, res) => {
    const loc = await resolve(req);
    const body = parse(z.object({ remarks: z.string().trim().min(3, 'Reason is required').max(2000) }), req.body);
    await transact(async (tx) => {
      await reopen(tx, loc.instanceId, req.user!, body.remarks);
      await audit(tx, req, { action: 'WORKFLOW_REOPEN', module: hooks.module, entityType: hooks.entityType, entityId: String(req.params.id), entityRef: loc.ref, after: { remarks: body.remarks } });
    });
    res.json({ ok: true });
  });

  /** Officers who can receive a reassignment (role-matching users of the current level first). */
  router.get('/:id/assignees', requireAuth, async (req, res) => {
    const loc = await resolve(req);
    const inst = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: loc.instanceId }, include: { definition: { include: { levels: true } } } });
    const level = inst.definition.levels.find((l) => l.order === inst.currentLevelOrder);
    const isOverride = can(req.user, 'workflow.override');
    if (!isOverride && !(inst.currentAssigneeId === req.user!.id && level?.allowReassign)) throw forbidden();
    const users = await prisma.user.findMany({
      where: { isActive: true, id: { notIn: [inst.submittedById, inst.currentAssigneeId ?? ''] } },
      select: { id: true, name: true, designation: true, district: { select: { name: true } }, roles: { select: { roleId: true } } },
      orderBy: { name: 'asc' },
    });
    const list = users.map((u) => ({
      id: u.id,
      name: u.name,
      designation: u.designation,
      district: u.district?.name ?? null,
      matchesLevel: level?.approverRoleId ? u.roles.some((r) => r.roleId === level.approverRoleId) : level?.approverUserId === u.id,
    }));
    // non-override reviewers may only hand over to officers eligible for the same level
    res.json(isOverride ? list.sort((a, b) => Number(b.matchesLevel) - Number(a.matchesLevel)) : list.filter((u) => u.matchesLevel));
  });

  router.get('/:id/versions', requireAuth, async (req, res) => {
    const loc = await hooks.locate(String(req.params.id));
    if (!loc) throw notFound();
    if (!(await hooks.canView(req.user!, String(req.params.id)))) throw forbidden();
    const versions = await prisma.entityVersion.findMany({ where: { entityType: hooks.entityType, entityId: String(req.params.id) }, orderBy: { version: 'asc' } });
    res.json(versions);
  });
}

/** Flags describing what the current user may do with a workflow item (for the UI). */
export async function workflowFlags(user: AuthUser, instanceId: string | null) {
  if (!instanceId) return { canDecide: false, canReassign: false, canReopen: false, isAssignee: false, level: null as any };
  const inst = await prisma.workflowInstance.findUnique({ where: { id: instanceId }, include: { definition: { include: { levels: { orderBy: { order: 'asc' } } } } } });
  if (!inst) return { canDecide: false, canReassign: false, canReopen: false, isAssignee: false, level: null as any };
  const level = inst.definition.levels.find((l) => l.order === inst.currentLevelOrder) ?? null;
  const isAssignee = inst.status === 'IN_PROGRESS' && inst.currentAssigneeId === user.id;
  const ownOk = inst.submittedById !== user.id || can(user, 'workflow.self_approve');
  const override = can(user, 'workflow.override') && inst.status === 'IN_PROGRESS' && ownOk;
  return {
    isAssignee,
    canDecide: (isAssignee && ownOk) || override,
    canReassign: (isAssignee && !!level?.allowReassign) || (can(user, 'workflow.override') && inst.status === 'IN_PROGRESS'),
    canReopen: inst.status === 'REJECTED' && can(user, 'workflow.reopen'),
    level: level
      ? {
          order: level.order,
          name: level.name,
          allowReject: level.allowReject,
          allowReturn: level.allowReturn,
          canAmendDates: level.canAmendDates,
          isFinal: level.order === inst.definition.levels[inst.definition.levels.length - 1].order,
        }
      : null,
  };
}

/** Latest email delivery status for an entity reference. */
export async function latestEmailStatus(ref: string) {
  const rows = await prisma.emailLog.findMany({ where: { entityRef: ref }, orderBy: { createdAt: 'desc' }, take: 50, select: { status: true, createdAt: true } });
  if (!rows.length) return { status: 'NONE', counts: { SENT: 0, FAILED: 0, PENDING: 0 } };
  const counts = { SENT: 0, FAILED: 0, PENDING: 0 } as Record<string, number>;
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return { status: rows[0].status, counts };
}

export { Router };
