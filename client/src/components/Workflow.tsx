import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Circle, Clock, CornerUpLeft, RotateCcw, UserCheck, UserRoundCog, XCircle, Hourglass, MinusCircle, Paperclip, X } from 'lucide-react';
import { api, fileUrl } from '../lib/api';
import { fmtDateTime, fmtSize, humanize } from '../lib/format';
import { Badge, Button, Card, Modal, Select, Textarea, cx, useConfirm, useFormErrors, useToast, ErrorBox } from './ui';

export interface TimelineData {
  instance: {
    id: string; status: string; cycle: number; currentLevelOrder: number | null; currentLevelName: string | null; totalLevels: number;
    currentAssignee: { id: string; name: string; designation: string | null; email: string } | null; currentAssignedAt: string | null; workflowName: string;
  };
  stages: { key: string; label: string; levelOrder?: number; designation?: string | null; state: string; officer?: { name: string; designation: string | null } | null; assignedAt?: string | null; completedAt?: string | null; decision?: string | null; remarks?: string | null; isCurrent?: boolean; evidence?: { id: string; name: string }[] }[];
  history: { id: string; cycle: number; action: string; levelName: string | null; actorName: string; actorDesignation: string | null; targetUserName: string | null; remarks: string | null; createdAt: string; data?: any }[];
}

const STATE: Record<string, { label: string; icon: ReactNode; dot: string }> = {
  COMPLETED: { label: 'Completed', icon: <CheckCircle2 className="size-5" />, dot: 'text-emerald-600' },
  APPROVED: { label: 'Approved', icon: <CheckCircle2 className="size-5" />, dot: 'text-emerald-600' },
  PENDING_REVIEW: { label: 'Pending Review', icon: <Clock className="size-5" />, dot: 'text-amber-600' },
  PENDING_ASSIGNMENT: { label: 'Pending Assignment', icon: <Hourglass className="size-5" />, dot: 'text-amber-600' },
  AWAITING_PREVIOUS: { label: 'Awaiting Previous Approval', icon: <Circle className="size-5" />, dot: 'text-gray-300' },
  RETURNED: { label: 'Returned for Revision', icon: <CornerUpLeft className="size-5" />, dot: 'text-orange-600' },
  REJECTED: { label: 'Rejected', icon: <XCircle className="size-5" />, dot: 'text-red-600' },
  NOT_REACHED: { label: 'Not reached', icon: <MinusCircle className="size-5" />, dot: 'text-gray-300' },
  CANCELLED: { label: 'Cancelled', icon: <MinusCircle className="size-5" />, dot: 'text-gray-400' },
  NOT_STARTED: { label: 'Not Started', icon: <Circle className="size-5" />, dot: 'text-gray-300' },
  IN_PROGRESS: { label: 'In Progress', icon: <Clock className="size-5" />, dot: 'text-blue-600' },
  NOT_SUBMITTED: { label: 'Not Submitted', icon: <Circle className="size-5" />, dot: 'text-gray-300' },
};

export interface ExtraStage { label: string; state: string; detail?: ReactNode }

/** Current responsible officer, shown prominently. */
export function CurrentOfficer({ tl }: { tl: TimelineData | null }) {
  if (!tl) return null;
  const i = tl.instance;
  if (i.status !== 'IN_PROGRESS') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-white p-4 shadow-sm">
        <UserCheck className="size-8 text-ink-3" />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Workflow status</p>
          <p className="text-sm font-semibold">{i.status === 'APPROVED' ? 'All approvals completed' : i.status === 'RETURNED' ? 'With the requester for revision' : humanize(i.status)}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700">
        <UserRoundCog className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-amber-800">Currently with · Level {i.currentLevelOrder} of {i.totalLevels}</p>
        {i.currentAssignee ? (
          <p className="text-sm font-semibold text-ink">
            {i.currentAssignee.name}
            {i.currentAssignee.designation && <span className="font-normal text-ink-2"> — {i.currentAssignee.designation}</span>}
          </p>
        ) : (
          <p className="text-sm font-semibold text-amber-900">Pending assignment by administrator</p>
        )}
        <p className="text-xs text-ink-3">
          {i.currentLevelName} · since {fmtDateTime(i.currentAssignedAt)}
        </p>
      </div>
    </div>
  );
}

export function Timeline({ tl, extra = [], title = 'Request tracking & approval timeline' }: { tl: TimelineData | null; extra?: ExtraStage[]; title?: string }) {
  const [showAll, setShowAll] = useState(false);
  if (!tl) return null;
  return (
    <Card title={title} subtitle={tl.instance.workflowName} actions={<Button variant="ghost" size="sm" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Hide' : 'Show'} full history ({tl.history.length})</Button>}>
      <ol className="relative">
        {[...tl.stages.map((s) => ({ ...s, extra: false as const })), ...extra.map((e, i) => ({ key: `x${i}`, label: e.label, state: e.state, detail: e.detail, extra: true as const }))].map((s: any, idx, arr) => {
          const st = STATE[s.state] ?? STATE.NOT_STARTED;
          return (
            <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0">
              {idx < arr.length - 1 && <span className="absolute left-[9px] top-6 h-[calc(100%-1.25rem)] w-px bg-line" aria-hidden />}
              <span className={cx('relative z-10 bg-white', st.dot)}>{st.icon}</span>
              <div className={cx('min-w-0 flex-1 rounded-lg', s.isCurrent && '-m-2 bg-amber-50/70 p-2 ring-1 ring-amber-200')}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink">
                    {s.levelOrder ? `${s.levelOrder}. ` : ''}
                    {s.label}
                  </p>
                  <span className="text-xs font-medium text-ink-2">— {st.label}</span>
                </div>
                {s.designation && !s.officer && <p className="text-xs text-ink-3">{s.designation}</p>}
                {s.officer && (
                  <p className="text-xs text-ink-2">
                    {s.officer.name}
                    {s.officer.designation && ` · ${s.officer.designation}`}
                  </p>
                )}
                {(s.assignedAt || s.completedAt) && (
                  <p className="text-xs text-ink-3">
                    {s.assignedAt && <>Assigned {fmtDateTime(s.assignedAt)}</>}
                    {s.assignedAt && s.completedAt && ' · '}
                    {s.completedAt && <>{s.key === 'submitted' ? 'Submitted' : 'Decided'} {fmtDateTime(s.completedAt)}</>}
                  </p>
                )}
                {s.remarks && <p className="mt-1 rounded-md bg-gray-50 px-2 py-1 text-xs italic text-ink-2">“{s.remarks}”</p>}
                {s.evidence?.length > 0 && <EvidenceLinks items={s.evidence} />}
                {s.detail && <div className="mt-1 text-xs text-ink-2">{s.detail}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      {showAll && (
        <div className="mt-4 overflow-x-auto border-t border-line pt-3">
          <table className="w-full text-left text-xs">
            <thead className="text-ink-3">
              <tr>
                <th className="py-1 pr-3 font-medium">Date &amp; time</th>
                <th className="py-1 pr-3 font-medium">Cycle</th>
                <th className="py-1 pr-3 font-medium">Action</th>
                <th className="py-1 pr-3 font-medium">Level</th>
                <th className="py-1 pr-3 font-medium">By</th>
                <th className="py-1 font-medium">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tl.history.map((h) => (
                <tr key={h.id} className="align-top">
                  <td className="whitespace-nowrap py-1.5 pr-3">{fmtDateTime(h.createdAt)}</td>
                  <td className="py-1.5 pr-3">{h.cycle}</td>
                  <td className="py-1.5 pr-3"><Badge status={h.action} label={humanize(h.action)} tone={/APPROVED/.test(h.action) ? 'green' : h.action === 'REJECTED' ? 'red' : h.action === 'RETURNED' ? 'orange' : 'gray'} /></td>
                  <td className="py-1.5 pr-3">{h.levelName ?? '—'}</td>
                  <td className="py-1.5 pr-3">
                    {h.actorName}
                    {h.actorDesignation && <span className="text-ink-3"> ({h.actorDesignation})</span>}
                    {h.targetUserName && <> → {h.targetUserName}</>}
                    {h.data?.overrideOf && <span className="ml-1 rounded bg-violet-50 px-1 text-violet-700">admin override</span>}
                  </td>
                  <td className="py-1.5">{h.remarks ?? '—'}{h.data?.evidence?.length > 0 && <EvidenceLinks items={h.data.evidence} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Links to evidence files attached to a review decision. */
export function EvidenceLinks({ items }: { items: { id: string; name: string }[] }) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <Paperclip className="size-3.5 text-ink-3" aria-hidden />
      <span className="sr-only">Evidence:</span>
      {items.map((e) => (
        <a key={e.id} href={fileUrl(e.id, true)} className="text-brand underline-offset-2 hover:underline">{e.name}</a>
      ))}
    </p>
  );
}

/** Approve / Return / Reject / Reassign / Reopen for the item at `base` (e.g. /api/daamr/requests/:id). */
export function ReviewPanel({
  base, can, onDone, renderExtra, approveLabel = 'Approve & Forward', finalApproveLabel = 'Final Approval', rejectLabel = 'Reject', evidenceTarget, returnLabel = 'Return for revision', title,
}: {
  base: string;
  /** When set, reviewers can attach supporting evidence (uploaded as REVIEW_EVIDENCE to this file target). */
  evidenceTarget?: { target: string; entityId: string };
  returnLabel?: string;
  title?: string;
  can: { canDecide: boolean; canReassign: boolean; canReopen: boolean; isAssignee: boolean; level: { order: number; name: string; allowReject: boolean; allowReturn: boolean; isFinal: boolean; canAmendDates?: boolean } | null };
  onDone: () => void;
  renderExtra?: (extra: Record<string, any>, set: (patch: Record<string, any>) => void, errors: Record<string, string>) => ReactNode;
  approveLabel?: string;
  finalApproveLabel?: string;
  rejectLabel?: string;
}) {
  const [remarks, setRemarks] = useState('');
  const [extra, setExtraState] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const { errors, formError, capture, clear } = useFormErrors();
  const toast = useToast();
  const confirm = useConfirm();
  const setExtra = (p: Record<string, any>) => setExtraState((e) => ({ ...e, ...p }));
  const [evidence, setEvidence] = useState<File[]>([]);
  const evInput = useRef<HTMLInputElement>(null);

  if (!can.canDecide && !can.canReassign && !can.canReopen) return null;

  const decide = async (action: 'APPROVE' | 'RETURN' | 'REJECT') => {
    clear();
    if (action !== 'APPROVE' && remarks.trim().length < 3) {
      capture({ message: 'Remarks are required when rejecting or returning.', fields: { remarks: 'Remarks are required' } });
      return;
    }
    const label = action === 'APPROVE' ? (can.level?.isFinal ? finalApproveLabel : approveLabel) : action === 'RETURN' ? returnLabel : rejectLabel;
    const ok = await confirm({
      title: `${label}?`,
      message: action === 'REJECT' ? 'Rejection stops the approval chain. Only an authorised officer can reopen it.' : action === 'RETURN' ? 'The requester will be able to edit and resubmit.' : can.level?.isFinal ? 'This is the final approval.' : 'The item will be forwarded automatically to the next officer in the workflow.',
      confirmLabel: label,
      tone: action === 'REJECT' ? 'danger' : action === 'RETURN' ? 'warning' : 'success',
    });
    if (!ok) return;
    setBusy(action);
    let uploaded: { id: string }[] = [];
    try {
      if (evidence.length && evidenceTarget) {
        const fd = new FormData();
        evidence.forEach((f) => fd.append('files', f));
        fd.append('category', 'REVIEW_EVIDENCE');
        uploaded = await api.upload(`/api/files/${evidenceTarget.target}/${evidenceTarget.entityId}`, fd);
      }
      await api.post(`${base}/decision`, { action, remarks: remarks.trim() || null, extra, evidenceFileIds: uploaded.map((u) => u.id) });
      setEvidence([]);
      toast('success', action === 'APPROVE' ? (can.level?.isFinal ? 'Final approval recorded.' : 'Approved and forwarded to the next officer.') : action === 'RETURN' ? 'Returned to the requester.' : 'Rejected.');
      setRemarks('');
      onDone();
    } catch (e: any) {
      // withdraw evidence uploaded for a decision that was not recorded
      for (const u of uploaded) await api.del(`/api/files/${u.id}`).catch(() => {});
      capture(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title={can.canDecide ? title ?? `Your review — ${can.level?.name ?? ''}` : 'Workflow actions'} className="border-brand-200 ring-1 ring-brand-100" subtitle={can.canDecide && !can.isAssignee ? 'Administrative override: you are acting on behalf of the assigned officer.' : undefined}>
      <div className="space-y-3">
        <ErrorBox error={formError ? { message: formError } : null} />
        {can.canDecide && (
          <>
            {renderExtra?.(extra, setExtra, errors)}
            <Textarea label="Comments and observations" hint="Mandatory when requesting changes or rejecting. Recorded permanently in the review history with your name, role and the date and time." value={remarks} onChange={(e) => setRemarks(e.target.value)} error={errors.remarks} rows={3} maxLength={4000} />
            {evidenceTarget && (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" icon={<Paperclip className="size-4" />} onClick={() => evInput.current?.click()}>Attach supporting evidence</Button>
                  <span className="text-xs text-ink-3">Optional · PDF, DOCX, XLSX or images</span>
                  <input ref={evInput} type="file" multiple className="hidden" accept="application/pdf,.pdf,.docx,.xlsx,image/jpeg,image/png,image/webp" onChange={(e) => { if (e.target.files) setEvidence((x) => [...x, ...Array.from(e.target.files!)].slice(0, 10)); e.target.value = ''; }} />
                </div>
                {evidence.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {evidence.map((f, i) => (
                      <li key={i} className="flex items-center gap-1.5 rounded-lg bg-gray-50 py-1 pl-2 pr-1 text-xs">
                        <Paperclip className="size-3.5 text-ink-3" />
                        <span className="max-w-[180px] truncate">{f.name}</span>
                        <span className="text-ink-3">{fmtSize(f.size)}</span>
                        <button type="button" aria-label={`Remove ${f.name}`} className="rounded p-0.5 hover:bg-gray-200" onClick={() => setEvidence((x) => x.filter((_, j) => j !== i))}><X className="size-3.5" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="success" loading={busy === 'APPROVE'} onClick={() => decide('APPROVE')} icon={<CheckCircle2 className="size-4" />}>
                {can.level?.isFinal ? finalApproveLabel : approveLabel}
              </Button>
              {can.level?.allowReturn && (
                <Button variant="warning" loading={busy === 'RETURN'} onClick={() => decide('RETURN')} icon={<CornerUpLeft className="size-4" />}>
                  {returnLabel}
                </Button>
              )}
              {can.level?.allowReject && (
                <Button variant="danger" loading={busy === 'REJECT'} onClick={() => decide('REJECT')} icon={<XCircle className="size-4" />}>
                  {rejectLabel}
                </Button>
              )}
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-2 border-t border-line pt-3 empty:hidden empty:border-0 empty:pt-0">
          {can.canReassign && (
            <Button variant="secondary" size="sm" onClick={() => setReassignOpen(true)} icon={<UserRoundCog className="size-4" />}>
              Reassign
            </Button>
          )}
          {can.canReopen && (
            <Button variant="secondary" size="sm" onClick={() => setReopenOpen(true)} icon={<RotateCcw className="size-4" />}>
              Reopen
            </Button>
          )}
        </div>
      </div>
      <ReassignModal open={reassignOpen} onClose={() => setReassignOpen(false)} base={base} onDone={onDone} />
      <ReasonModal open={reopenOpen} onClose={() => setReopenOpen(false)} title="Reopen rejected item" url={`${base}/reopen`} onDone={onDone} confirmLabel="Reopen" />
    </Card>
  );
}

function ReassignModal({ open, onClose, base, onDone }: { open: boolean; onClose: () => void; base: string; onDone: () => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const [userId, setUserId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const { errors, formError, capture, clear } = useFormErrors();
  const toast = useToast();
  useEffect(() => {
    if (open) api.get(`${base}/assignees`).then(setUsers).catch(capture);
  }, [open, base]);
  const submit = async () => {
    clear();
    setBusy(true);
    try {
      await api.post(`${base}/reassign`, { userId, remarks });
      toast('success', 'Reassigned.');
      onClose();
      onDone();
    } catch (e: any) {
      capture(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Reassign to another officer" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Reassign</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={formError ? { message: formError } : null} />
        <Select
          label="Officer"
          required
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          error={errors.userId}
          placeholder="Select officer…"
          options={users.map((u) => ({ value: u.id, label: `${u.name}${u.designation ? ` — ${u.designation}` : ''}${u.district ? ` (${u.district})` : ''}${u.matchesLevel ? ' ✓ eligible for this level' : ''}` }))}
        />
        <Textarea label="Reason" required value={remarks} onChange={(e) => setRemarks(e.target.value)} error={errors.remarks} />
      </div>
    </Modal>
  );
}

export function ReasonModal({ open, onClose, title, url, onDone, confirmLabel, field = 'remarks', tone = 'primary', description }: { open: boolean; onClose: () => void; title: string; url: string; onDone: () => void; confirmLabel: string; field?: string; tone?: 'primary' | 'danger' | 'warning'; description?: ReactNode }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { errors, formError, capture, clear } = useFormErrors();
  const toast = useToast();
  const submit = async () => {
    clear();
    setBusy(true);
    try {
      await api.post(url, { [field]: text });
      toast('success', 'Done.');
      setText('');
      onClose();
      onDone();
    } catch (e: any) {
      capture(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={tone} loading={busy} onClick={submit}>{confirmLabel}</Button></>}>
      <div className="space-y-3">
        {description && <div className="text-sm text-ink-2">{description}</div>}
        <ErrorBox error={formError ? { message: formError } : null} />
        <Textarea label="Reason / remarks" required value={text} onChange={(e) => setText(e.target.value)} error={errors[field]} />
      </div>
    </Modal>
  );
}

export function EmailStatus({ s }: { s: { status: string; counts: Record<string, number> } | null }) {
  if (!s || s.status === 'NONE') return <span className="text-ink-3">No emails</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge status={s.status} label={`Latest: ${humanize(s.status)}`} />
      <span className="text-xs text-ink-3">
        {s.counts.SENT ?? 0} sent · {s.counts.FAILED ?? 0} failed · {s.counts.PENDING ?? 0} pending
      </span>
    </span>
  );
}
