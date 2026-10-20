import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  AlertTriangle, CalendarDays, Check, CheckCircle2, CircleDot, ClipboardCheck, Clock, CornerUpLeft, Crown, Download, FilePlus2, FileSpreadsheet, Info, MapPin,
  Pencil, Printer, Trash2, UserPlus, UserRound, Users, XCircle,
} from 'lucide-react';
import { api, download, fileUrl, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useLookupLabel } from '../../lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, humanize, toISODate, todayISO } from '../../lib/format';
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Grid, Input, KV, LinkButton, Modal, Notice, Select, Spinner, Tabs, Textarea, cx, useConfirm, useFormErrors, useToast } from '../../components/ui';
import { EmailStatus, EvidenceLinks, ReviewPanel, Timeline } from '../../components/Workflow';
import { AttachmentList, Gallery, Uploader } from '../../components/Files';
import { SearchInput } from '../../components/DataTable';
import { PRIORITIES } from './ActivityForm';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'venue', label: 'Venue & Images' },
  { value: 'assignments', label: 'Assignments' },
  { value: 'reviews', label: 'Reviews & Approvals' },
  { value: 'execution', label: 'Execution Report' },
  { value: 'documents', label: 'Documents' },
  { value: 'timeline', label: 'Activity Timeline' },
  { value: 'export', label: 'Export & Reports' },
];
const HASH_TAB: Record<string, string> = { review: 'reviews', timeline: 'reviews', attachments: 'documents' };

export default function ActivityDetail() {
  const { id } = useParams();
  const { me } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { hash } = useLocation();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? HASH_TAB[hash.slice(1)] ?? 'overview';
  const setTab = (t: string) => setSp((p) => { p.set('tab', t); return p; }, { replace: true });
  const { data, loading, error, reload } = useApi(`/api/daamr/requests/${id}`);
  const log = useApi(tab === 'timeline' ? `/api/daamr/requests/${id}/activity-log` : null);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const { request: r, can, timeline, reportTimeline, reportFlags } = data;
  const report = r.report;
  const activeStaff = r.assignments.filter((a: any) => a.status !== 'CANCELLED');
  const docs = [
    ...r.files.filter((f: any) => f.kind === 'DOCUMENT' || ['REVIEW_EVIDENCE', 'ATTENDANCE'].includes(f.category)).map((f: any) => ({ ...f, source: f.category === 'REVIEW_EVIDENCE' ? 'Review evidence (activity review)' : 'Activity' })),
    ...(report?.files ?? []).filter((f: any) => f.kind === 'DOCUMENT' || ['REVIEW_EVIDENCE', 'ATTENDANCE'].includes(f.category)).map((f: any) => ({ ...f, source: f.category === 'REVIEW_EVIDENCE' ? 'Review evidence (report verification)' : f.category === 'ATTENDANCE' ? 'Attendance sheet' : `Execution report ${report.reportNo}` })),
    ...r.assignments.flatMap((a: any) => a.files.map((f: any) => ({ ...f, source: `Assignment — ${a.assignee.name}` }))),
  ];
  const overdue = !['COMPLETED', 'REJECTED', 'CANCELLED', 'DRAFT'].includes(r.lifecycle) && (toISODate(r.endDate) < todayISO() || activeStaff.some((a: any) => ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(a.status) && a.deadline && new Date(a.deadline) < new Date()));
  const nextDeadline = activeStaff.filter((a: any) => ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(a.status) && a.deadline).map((a: any) => a.deadline).sort()[0];

  const del = async () => {
    if (!(await confirm({ title: 'Delete draft activity?', message: 'This draft and its attachments will be permanently deleted.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    await api.del(`/api/daamr/requests/${id}`);
    toast('success', 'Draft deleted.');
    nav('/daamr/requests');
  };

  return (
    <>
      {/* Header */}
      <div className="mb-4 overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr]">
          <div className="relative aspect-[16/9] bg-gradient-to-br from-brand-50 to-gray-100 md:aspect-auto md:min-h-[200px]">
            {data.cover ? <img src={fileUrl(data.cover.id)} alt="Activity cover" className="absolute inset-0 size-full object-cover" /> : (
              <div className="absolute inset-0 grid place-items-center text-brand/40"><CalendarDays className="size-14" /></div>
            )}
          </div>
          <div className="min-w-0 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to="/daamr/requests" className="no-print text-xs font-medium text-ink-3 hover:text-ink">← Activities</Link>
                <h1 className="mt-1 text-xl font-semibold text-ink sm:text-2xl">{r.subject}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-ink-2">{r.daamrId}</span>
                  <Badge status={r.lifecycle} />
                  <Badge status={r.priority} label={`${humanize(r.priority)} priority`} />
                  {overdue && <Badge tone="red" label="Overdue" />}
                  {r.activityType === 'COURSE' && <Badge tone="violet" label={`Course · ${r.trainingDays ?? '?'} training days`} />}
                  {r.category && <span className="text-xs text-ink-3">· {humanize(r.category)}</span>}
                </div>
              </div>
              <div className="no-print flex flex-wrap gap-2">
                {can.edit && <LinkButton to={`/daamr/requests/${id}/edit`} variant="secondary" icon={<Pencil className="size-4" />}>{r.status === 'RETURNED' ? 'Update & resubmit' : 'Edit'}</LinkButton>}
                {can.delete && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={del}>Delete</Button>}
                <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>
                {can.export && <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => setTab('export')}>Export</Button>}
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <Fact icon={<MapPin className="size-4" />} label="Venue" value={`${r.venue}, ${r.district.name}`} />
              <Fact icon={<CalendarDays className="size-4" />} label="Dates" value={`${fmtDate(r.startDate)}${r.startTime ? ` ${r.startTime}` : ''} – ${fmtDate(r.endDate)}${r.endTime ? ` ${r.endTime}` : ''}`} />
              <Fact icon={<UserRound className="size-4" />} label="Responsible officer" value={data.leadOfficer ? `${data.leadOfficer.name}${data.leadOfficer.designation ? ` — ${data.leadOfficer.designation}` : ''}` : <span className="text-amber-700">Not assigned</span>} />
              <Fact icon={<ClipboardCheck className="size-4" />} label="Next reviewer" value={data.nextReviewer ? (data.nextReviewer.name ? `${data.nextReviewer.name} — ${data.nextReviewer.level}` : <span className="text-amber-700">{data.nextReviewer.level} (pending assignment)</span>) : '—'} />
              <Fact icon={<Clock className="size-4" />} label="Next task deadline" value={nextDeadline ? <span className={cx(new Date(nextDeadline) < new Date() && 'font-medium text-red-700')}>{fmtDate(nextDeadline)}</span> : '—'} />
              <Fact icon={<Users className="size-4" />} label="Assigned staff" value={activeStaff.length ? `${activeStaff.length} member(s)` : '—'} />
              <Fact icon={<Info className="size-4" />} label="Created by" value={`${r.requester.name}, ${fmtDate(r.createdAt)}`} />
              <Fact icon={<Info className="size-4" />} label="Department" value={r.department?.name ?? '—'} />
            </dl>
          </div>
        </div>
        <LifecycleTracker r={r} timeline={timeline} reportTimeline={reportTimeline} hasStaff={activeStaff.length > 0} />
      </div>

      {r.activityType === 'COURSE' && r.status === 'APPROVED' && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4">
          <div className="text-sm">
            <p className="font-semibold text-violet-900">Course execution</p>
            {r.course ? (
              <p className="text-violet-900/80">{r.course.courseNo} · {humanize(r.course.status)} · {r.course.durationDays} training days, {fmtDate(r.course.startDate)} – {fmtDate(r.course.endDate)}</p>
            ) : (
              <p className="text-violet-900/80">The course record has not been created. An administrator can set it up now.</p>
            )}
          </div>
          {r.course ? <LinkButton to={`/courses/${r.course.id}`}>Open course</LinkButton> : can.setupCourse && <Button onClick={async () => { try { const x = await api.post(`/api/courses/setup/${r.id}`); nav(`/courses/${x.id}`); } catch (e: any) { toast('error', e.message); } }}>Set up course</Button>}
        </div>
      )}

      {data.outstanding.length > 0 && (
        <Card title="Outstanding actions" className="mb-4" bodyClass="py-3">
          <ul className="space-y-1.5 text-sm">
            {data.outstanding.map((o: any, i: number) => (
              <li key={i} className="flex items-start gap-2">
                {o.tone === 'danger' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" /> : o.tone === 'warning' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <CircleDot className="mt-0.5 size-4 shrink-0 text-blue-600" />}
                <span>{o.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(can.canDecide || can.canReassign || can.canReopen) && (
        <div className="mb-4">
          <ReviewPanel base={`/api/daamr/requests/${id}`} can={can} onDone={reload} evidenceTarget={can.canDecide ? { target: 'activity-request', entityId: r.id } : undefined} returnLabel="Request changes" title={`Activity review — ${can.level?.name ?? ''}`} />
        </div>
      )}
      {report && reportFlags && (reportFlags.canDecide || reportFlags.canReassign || reportFlags.canReopen) && (
        <div className="mb-4">
          <ReviewPanel base={`/api/daamr/reports/${report.id}`} can={reportFlags} onDone={reload} evidenceTarget={reportFlags.canDecide ? { target: 'activity-report', entityId: report.id } : undefined} returnLabel="Request changes" title={`Execution report verification — ${reportFlags.level?.name ?? ''}`} finalApproveLabel="Final approval — mark activity completed" />
        </div>
      )}

      <Tabs value={tab} onChange={setTab} tabs={TABS.map((t) => ({ ...t, count: t.value === 'assignments' ? activeStaff.length : t.value === 'documents' ? docs.length : undefined }))} />

      {tab === 'overview' && <OverviewTab data={data} reload={reload} />}
      {tab === 'venue' && <VenueTab data={data} reload={reload} me={me} />}
      {tab === 'assignments' && <AssignmentsTab data={data} reload={reload} me={me} />}
      {tab === 'reviews' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {timeline ? <Timeline tl={timeline} title="Activity review & approval" /> : <Card title="Activity review & approval"><p className="text-sm text-ink-3">The review workflow starts when the activity is submitted.</p></Card>}
          {reportTimeline ? <Timeline tl={reportTimeline} title="Execution report verification" /> : <Card title="Execution report verification"><p className="text-sm text-ink-3">Starts when the execution report is submitted.</p></Card>}
        </div>
      )}
      {tab === 'execution' && <ExecutionTab data={data} reload={reload} />}
      {tab === 'documents' && (
        <Card title="All documents" subtitle="Supporting documents, assignment files, attendance sheets and reviewer evidence. Every file is stored privately and opened only after an access check.">
          {docs.length ? (
            <div className="space-y-4">
              {[...new Set(docs.map((d) => d.source))].map((src) => (
                <div key={src}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{src}</p>
                  <AttachmentList files={docs.filter((d) => d.source === src)} onChanged={reload} canRemove={(f) => f.uploadedBy.id === me?.id && (can.edit || f.category === 'REVIEW_EVIDENCE')} />
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-ink-3">No documents attached.</p>}
          {can.uploadDocs && <div className="mt-4 border-t border-line pt-4"><Uploader target="activity-request" entityId={r.id} kind="doc" compact categories={[{ value: 'SUPPORTING', label: 'Supporting document' }]} onUploaded={reload} /></div>}
        </Card>
      )}
      {tab === 'timeline' && <ActivityLog log={log} />}
      {tab === 'export' && <ExportTab data={data} />}
    </>
  );
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2">
      <span className="mt-0.5 text-ink-3">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-ink-3">{label}</dt>
        <dd className="line-clamp-2 break-words font-medium text-ink">{value}</dd>
      </div>
    </div>
  );
}

// ───────────── Visual workflow tracker ─────────────

type StepState = 'done' | 'current' | 'pending' | 'changes' | 'rejected' | 'attention';
function LifecycleTracker({ r, timeline, reportTimeline, hasStaff }: { r: any; timeline: any; reportTimeline: any; hasStaff: boolean }) {
  const rep = r.report;
  const plan = r.status;
  const repSubmitted = rep && rep.reportStatus !== 'DRAFT';
  const steps: { label: string; detail?: string; state: StepState }[] = [
    { label: 'Created', detail: fmtDate(r.createdAt), state: 'done' },
    { label: 'Staff assigned', detail: hasStaff ? undefined : 'Awaiting assignment', state: hasStaff ? 'done' : ['REJECTED', 'CANCELLED', 'COMPLETED'].includes(r.lifecycle) ? 'pending' : 'attention' },
    {
      label: 'Activity review',
      detail: plan === 'DRAFT' ? 'Not submitted' : timeline?.instance.status === 'IN_PROGRESS' ? `Level ${timeline.instance.currentLevelOrder} of ${timeline.instance.totalLevels}` : plan === 'RETURNED' ? 'Changes requested' : plan === 'REJECTED' ? 'Rejected' : plan === 'APPROVED' ? 'All levels approved' : undefined,
      state: plan === 'DRAFT' ? 'pending' : plan === 'RETURNED' ? 'changes' : plan === 'REJECTED' ? 'rejected' : plan === 'APPROVED' ? 'done' : 'current',
    },
    { label: 'Approved for execution', detail: r.approvedAt ? fmtDate(r.approvedAt) : undefined, state: plan === 'APPROVED' ? 'done' : 'pending' },
    {
      label: 'Execution', detail: repSubmitted ? 'Report submitted' : plan === 'APPROVED' ? humanize(r.executionStatus) : undefined,
      state: repSubmitted ? 'done' : plan === 'APPROVED' ? 'current' : 'pending',
    },
    {
      label: 'Report verification',
      detail: !rep || rep.reportStatus === 'DRAFT' ? undefined : reportTimeline?.instance.status === 'IN_PROGRESS' ? `Level ${reportTimeline.instance.currentLevelOrder} of ${reportTimeline.instance.totalLevels}` : humanize(rep.reportStatus),
      state: !repSubmitted ? 'pending' : rep.reportStatus === 'VERIFIED' ? 'done' : rep.reportStatus === 'RETURNED' ? 'changes' : rep.reportStatus === 'REJECTED' ? 'rejected' : 'current',
    },
    { label: 'Completed', detail: r.completedAt ? fmtDate(r.completedAt) : undefined, state: r.lifecycle === 'COMPLETED' ? 'done' : 'pending' },
  ];
  const style: Record<StepState, { dot: string; icon: ReactNode; text: string }> = {
    done: { dot: 'bg-emerald-600 text-white', icon: <Check className="size-3.5" />, text: 'Completed' },
    current: { dot: 'bg-blue-600 text-white ring-4 ring-blue-100', icon: <Clock className="size-3.5" />, text: 'In progress' },
    pending: { dot: 'bg-gray-200 text-gray-500', icon: <span className="size-1.5 rounded-full bg-current" />, text: 'Pending' },
    changes: { dot: 'bg-orange-500 text-white ring-4 ring-orange-100', icon: <CornerUpLeft className="size-3.5" />, text: 'Awaiting changes' },
    rejected: { dot: 'bg-red-600 text-white', icon: <XCircle className="size-3.5" />, text: 'Rejected' },
    attention: { dot: 'bg-amber-500 text-white ring-4 ring-amber-100', icon: <AlertTriangle className="size-3.5" />, text: 'Needs action' },
  };
  return (
    <div className="border-t border-line bg-gray-50/60 px-5 py-4">
      <ol className="flex gap-0 overflow-x-auto pb-1" aria-label="Activity workflow progress">
        {steps.map((s, i) => (
          <li key={s.label} className="relative flex min-w-[118px] flex-1 flex-col items-center text-center">
            {i > 0 && <span className={cx('absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2', steps[i - 1].state === 'done' ? 'bg-emerald-500' : 'bg-gray-200')} aria-hidden />}
            <span className={cx('relative z-10 grid size-7 place-items-center rounded-full', style[s.state].dot)} title={style[s.state].text}>{style[s.state].icon}</span>
            <span className="mt-1.5 text-xs font-medium text-ink">{s.label}</span>
            <span className="text-[11px] text-ink-3">{s.detail ?? style[s.state].text}</span>
            <span className="sr-only">: {style[s.state].text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ───────────── Overview ─────────────

function OverviewTab({ data, reload }: { data: any; reload: () => void }) {
  const r = data.request;
  const can = data.can;
  const cat = useLookupLabel('ACTIVITY_CATEGORY');
  const toast = useToast();
  const [exec, setExec] = useState(r.executionStatus);
  const [busy, setBusy] = useState(false);
  useEffect(() => setExec(r.executionStatus), [r.executionStatus]);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card title="Activity information">
          <KV cols={2} items={[
            ['Activity ID', <span className="font-mono">{r.daamrId}</span>], ['Category', cat(r.category)], ['Priority', <Badge status={r.priority} />], ['Overall status', <Badge status={r.lifecycle} />],
            ['Approval status', <Badge status={r.status} />], ['Responsible department', r.department?.name], ['Target audience', r.targetAudience], ['Expected participants', fmtNum(r.expectedParticipants)],
            ['Start', `${fmtDate(r.startDate)}${r.startTime ? `, ${r.startTime}` : ''}`], ['End', `${fmtDate(r.endDate)}${r.endTime ? `, ${r.endTime}` : ''}`],
            ['Estimated budget', can.viewExpenses ? fmtMoney(r.proposedBudget) : <span className="text-ink-3">Restricted</span>], ['Notification email', r.requesteeEmail],
            ['Created by', `${r.requester.name}${r.requester.designation ? ` — ${r.requester.designation}` : ''}`], ['Created on', fmtDateTime(r.createdAt)],
            ['Submitted', fmtDateTime(r.submittedAt)], ['Version', `${r.version}${data.versions > 1 ? ` (${data.versions} submissions preserved)` : ''}`],
            ['Email notifications', <EmailStatus s={data.emailStatus} />], ['Last updated', fmtDateTime(r.updatedAt)],
          ]} />
        </Card>
        <Card title="Description"><p className="whitespace-pre-line text-sm">{r.description || '—'}</p></Card>
        <Card title="Objectives"><p className="whitespace-pre-line text-sm">{r.objectives || '—'}</p></Card>
      </div>
      <div className="space-y-4">
        {r.status === 'APPROVED' && (
          <Card title="Execution status" subtitle="Kept separate from approval and report verification.">
            <div className="space-y-3">
              <Select label="Execution status" value={exec} disabled={!can.execute} onChange={(e) => setExec(e.target.value)} options={['NOT_STARTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED'].map((s) => ({ value: s, label: humanize(s) }))} />
              {can.execute && <Button loading={busy} disabled={exec === r.executionStatus} onClick={async () => {
                setBusy(true);
                try { await api.post(`/api/daamr/requests/${r.id}/execution`, { executionStatus: exec }); toast('success', 'Execution status updated.'); reload(); } catch (e: any) { toast('error', e.message); } finally { setBusy(false); }
              }}>Update</Button>}
              <p className="text-xs text-ink-3">The activity is marked <strong>Completed</strong> only after the execution report passes every verification level.</p>
            </div>
          </Card>
        )}
        <Card title="Location">
          <KV cols={1} items={[['Venue', r.venue], ['Address', r.venueAddress], ['Location / area', r.area], ['Tehsil', r.tehsil], ['District / HQ', r.district.name], ['Province', r.province]]} />
        </Card>
      </div>
    </div>
  );
}

// ───────────── Venue & images ─────────────

function VenueTab({ data, reload, me }: { data: any; reload: () => void; me: any }) {
  const r = data.request;
  const can = data.can;
  const photos = r.files.filter((f: any) => f.kind === 'PHOTO');
  const rep = r.report?.files?.filter((f: any) => f.kind === 'PHOTO') ?? [];
  const sections: [string, string, any[], ReactNode?][] = [
    ['Cover image', 'COVER', photos.filter((p: any) => p.category === 'COVER')],
    ['Venue images (before the activity)', 'PRE_ACTIVITY', [...photos.filter((p: any) => p.category === 'PRE_ACTIVITY'), ...rep.filter((p: any) => p.category === 'PRE_ACTIVITY')],
      can.uploadPre && !['DRAFT', 'RETURNED'].includes(r.status) ? <Uploader target="activity-request" entityId={r.id} categories={[{ value: 'PRE_ACTIVITY', label: 'Venue image' }]} withGeo onUploaded={reload} compact /> : null],
    ['Event photographs', 'EVENT', rep.filter((p: any) => p.category === 'EVENT')],
    ['After the activity', 'POST_ACTIVITY', [...photos.filter((p: any) => p.category === 'POST_ACTIVITY'), ...rep.filter((p: any) => p.category === 'POST_ACTIVITY')],
      can.uploadPost ? <Uploader target="activity-request" entityId={r.id} categories={[{ value: 'POST_ACTIVITY', label: 'Post-activity evidence' }]} withGeo onUploaded={reload} compact /> : null],
  ];
  return (
    <div className="space-y-4">
      <Card title="Venue details">
        <KV cols={3} items={[['Venue name', r.venue], ['Complete address', r.venueAddress], ['Location / area', r.area], ['Tehsil', r.tehsil], ['District / HQ', r.district.name], ['Province', r.province]]} />
      </Card>
      {sections.map(([title, key, list, uploader]) => (
        <Card key={key} title={`${title} (${list.length})`}>
          {uploader && <div className="mb-3">{uploader}</div>}
          <Gallery photos={list} onChanged={reload} canRemove={(p) => p.uploadedBy.id === me?.id && can.edit} emptyText={key === 'EVENT' ? 'Event photographs are added with the execution report.' : 'No images.'} />
        </Card>
      ))}
    </div>
  );
}

// ───────────── Assignments ─────────────

function AssignmentsTab({ data, reload, me }: { data: any; reload: () => void; me: any }) {
  const r = data.request;
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [cancelling, setCancelling] = useState<any>(null);
  const [statusFor, setStatusFor] = useState<{ a: any; status: string } | null>(null);
  const toast = useToast();
  const list = [...r.assignments].sort((a: any, b: any) => Number(a.status === 'CANCELLED') - Number(b.status === 'CANCELLED'));
  const patch = async (a: any, body: any, msg: string) => {
    try { await api.patch(`/api/daamr/assignments/${a.id}`, body); toast('success', msg); reload(); } catch (e: any) { toast('error', e.message); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-2">Staff carrying out this activity, their responsibilities and deadlines. Assigned staff are notified and see the activity on their dashboard.</p>
        {data.can.assign && <Button icon={<UserPlus className="size-4" />} onClick={() => setOpen(true)}>Assign staff</Button>}
      </div>
      {list.length === 0 && <Empty title="No staff assigned yet" icon={<Users className="size-8" />}>{data.can.assign ? 'Assign a responsible officer and supporting staff.' : 'An authorised officer will assign staff.'}</Empty>}
      {list.map((a: any) => {
        const mine = a.assigneeId === me?.id;
        const open = ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(a.status);
        const late = open && a.deadline && new Date(a.deadline) < new Date();
        return (
          <Card key={a.id} className={cx(a.status === 'CANCELLED' && 'opacity-60')}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand">{a.assignee.name.split(' ').map((p: string) => p[0]).slice(0, 2).join('')}</span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                    {a.assignee.name}
                    {a.isLead && <Badge tone="violet" label="Responsible officer" />}
                    <Badge status={a.status} />
                    <Badge status={a.priority} label={`${humanize(a.priority)} priority`} />
                    {late && <Badge tone="red" label="Overdue" />}
                  </p>
                  <p className="text-xs text-ink-3">{[a.assignee.designation, a.assignee.district?.name].filter(Boolean).join(' · ')}</p>
                </div>
              </div>
              <div className="no-print flex flex-wrap gap-1.5">
                {mine && a.status === 'ASSIGNED' && <Button size="sm" variant="secondary" onClick={() => patch(a, { status: 'ACKNOWLEDGED' }, 'Assignment acknowledged.')}>Acknowledge</Button>}
                {mine && ['ASSIGNED', 'ACKNOWLEDGED'].includes(a.status) && <Button size="sm" variant="secondary" onClick={() => patch(a, { status: 'IN_PROGRESS' }, 'Marked in progress.')}>Start work</Button>}
                {mine && open && <Button size="sm" variant="success" onClick={() => setStatusFor({ a, status: 'COMPLETED' })}>Mark complete</Button>}
                {data.can.assign && open && !a.isLead && <Button size="sm" variant="ghost" icon={<Crown className="size-4" />} onClick={() => patch(a, { isLead: true }, `${a.assignee.name} is now the responsible officer.`)}>Make lead</Button>}
                {data.can.assign && open && <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit(a)}>Edit</Button>}
                {data.can.assign && open && <Button size="sm" variant="ghost" icon={<XCircle className="size-4" />} onClick={() => setCancelling(a)}>Cancel</Button>}
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2 lg:col-span-4"><dt className="text-xs text-ink-3">Responsibilities</dt><dd className="whitespace-pre-line">{a.responsibilities}</dd></div>
              {a.instructions && <div className="sm:col-span-2"><dt className="text-xs text-ink-3">Instructions</dt><dd className="whitespace-pre-line">{a.instructions}</dd></div>}
              {a.reviewRequirements && <div className="sm:col-span-2"><dt className="text-xs text-ink-3">Review requirements</dt><dd className="whitespace-pre-line">{a.reviewRequirements}</dd></div>}
              <div><dt className="text-xs text-ink-3">Deadline</dt><dd className={cx(late && 'font-semibold text-red-700')}>{a.deadline ? fmtDate(a.deadline) : 'Not set'}</dd></div>
              <div><dt className="text-xs text-ink-3">Assigned by</dt><dd>{a.assignedBy.name}, {fmtDateTime(a.createdAt)}</dd></div>
              {a.acknowledgedAt && <div><dt className="text-xs text-ink-3">Acknowledged</dt><dd>{fmtDateTime(a.acknowledgedAt)}</dd></div>}
              {a.completedAt && <div><dt className="text-xs text-ink-3">{a.status === 'CANCELLED' ? 'Cancelled' : 'Completed'}</dt><dd>{fmtDateTime(a.completedAt)}</dd></div>}
              {a.statusRemarks && <div className="sm:col-span-2"><dt className="text-xs text-ink-3">Remarks</dt><dd className="italic">“{a.statusRemarks}”</dd></div>}
            </dl>
            {(a.files.length > 0 || ((mine || data.can.assign) && a.status !== 'CANCELLED')) && (
              <div className="mt-4 space-y-2 border-t border-line pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Supporting files</p>
                <AttachmentList files={a.files} onChanged={reload} canRemove={(f) => f.uploadedBy.id === me?.id} />
                {(mine || data.can.assign) && a.status !== 'CANCELLED' && <Uploader target="activity-assignment" entityId={a.id} kind="doc" compact categories={[{ value: 'SUPPORTING', label: 'Supporting file' }]} onUploaded={reload} />}
              </div>
            )}
          </Card>
        );
      })}
      <AssignModal open={open} onClose={() => setOpen(false)} activity={r} onDone={reload} />
      {edit && <EditAssignmentModal a={edit} onClose={() => setEdit(null)} onDone={reload} />}
      <ReasonBox open={!!cancelling} title={`Cancel ${cancelling?.assignee.name ?? ''}'s assignment`} label="Reason for cancellation" confirmLabel="Cancel assignment" tone="danger"
        onClose={() => setCancelling(null)} onSubmit={async (text) => { await api.patch(`/api/daamr/assignments/${cancelling.id}`, { status: 'CANCELLED', statusRemarks: text }); toast('success', 'Assignment cancelled.'); reload(); }} />
      <ReasonBox open={!!statusFor} optional title="Mark your task complete" label="Completion remarks" confirmLabel="Mark complete" tone="success"
        onClose={() => setStatusFor(null)} onSubmit={async (text) => { await api.patch(`/api/daamr/assignments/${statusFor!.a.id}`, { status: statusFor!.status, statusRemarks: text || null }); toast('success', 'Task marked complete.'); reload(); }} />
    </div>
  );
}

function ReasonBox({ open, title, label, confirmLabel, tone, optional, onClose, onSubmit }: { open: boolean; title: string; label: string; confirmLabel: string; tone: 'danger' | 'success'; optional?: boolean; onClose: () => void; onSubmit: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { errors, formError, capture, clear } = useFormErrors();
  useEffect(() => { if (open) { setText(''); clear(); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button variant={tone} loading={busy} onClick={async () => {
      clear(); setBusy(true);
      try { await onSubmit(text.trim()); onClose(); } catch (e) { capture(e); } finally { setBusy(false); }
    }}>{confirmLabel}</Button></>}>
      <ErrorBox error={formError ? { message: formError } : null} />
      <Textarea label={label} required={!optional} value={text} onChange={(e) => setText(e.target.value)} error={errors.statusRemarks} rows={3} />
    </Modal>
  );
}

function AssignModal({ open, onClose, activity, onDone }: { open: boolean; onClose: () => void; activity: any; onDone: () => void }) {
  const staff = useApi<any[]>(open ? `/api/daamr/staff${qs({ districtId: activity.districtId })}` : null);
  const already = new Set(activity.assignments.filter((a: any) => ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(a.status)).map((a: any) => a.assigneeId));
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [f, setF] = useState({ leadId: '', responsibilities: '', instructions: '', deadline: '', priority: activity.priority ?? 'NORMAL', reviewRequirements: '' });
  const [busy, setBusy] = useState(false);
  const { errors, formError, capture, clear } = useFormErrors();
  const toast = useToast();
  useEffect(() => {
    if (open) { setSel([]); setSearch(''); clear(); setF({ leadId: '', responsibilities: '', instructions: '', deadline: toISODate(activity.startDate) >= todayISO() ? toISODate(activity.startDate) : '', priority: activity.priority ?? 'NORMAL', reviewRequirements: '' }); }
  }, [open]);
  const rows = useMemo(() => (staff.data ?? []).filter((u) => !search || `${u.name} ${u.designation ?? ''} ${u.district ?? ''}`.toLowerCase().includes(search.toLowerCase())), [staff.data, search]);
  const hasLead = activity.assignments.some((a: any) => a.isLead && a.status !== 'CANCELLED');
  const submit = async () => {
    clear();
    setBusy(true);
    try {
      await api.post(`/api/daamr/requests/${activity.id}/assignments`, { ...f, assigneeIds: sel, leadId: f.leadId || null, deadline: f.deadline || null });
      toast('success', `${sel.length} staff member(s) assigned and notified.`);
      onClose();
      onDone();
    } catch (e) { capture(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} size="xl" title={`Assign staff — ${activity.daamrId}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!sel.length} onClick={submit} icon={<UserPlus className="size-4" />}>Assign {sel.length || ''} staff</Button></>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium">Select staff members <span className="text-red-600">*</span></p>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, designation or district…" />
          {errors.assigneeIds && <p className="text-xs text-red-600">{errors.assigneeIds}</p>}
          <div className="max-h-80 overflow-y-auto rounded-xl border border-line">
            {staff.loading && <Spinner />}
            <ul className="divide-y divide-line">
              {rows.map((u) => {
                const taken = already.has(u.id);
                const on = sel.includes(u.id);
                return (
                  <li key={u.id}>
                    <label className={cx('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm', taken ? 'cursor-not-allowed opacity-50' : on ? 'bg-brand-50' : 'hover:bg-gray-50')}>
                      <input type="checkbox" className="size-4 accent-[var(--brand)]" disabled={taken} checked={on} onChange={() => setSel((x) => (on ? x.filter((y) => y !== u.id) : [...x, u.id]))} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{u.name}{u.sameDistrict && <span className="ml-1.5 rounded bg-emerald-50 px-1 text-[10px] font-medium text-emerald-700">same district</span>}</span>
                        <span className="block truncate text-xs text-ink-3">{[u.designation, u.district].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="shrink-0 text-xs text-ink-3">{taken ? 'Already assigned' : `${u.openTasks} open task(s)`}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          <ErrorBox error={formError ? { message: formError } : null} />
          <Select label="Responsible (lead) officer" value={f.leadId} onChange={(e) => setF({ ...f, leadId: e.target.value })} error={errors.leadId} placeholder={hasLead ? 'Keep current lead' : 'First selected staff member'} options={sel.map((sid) => ({ value: sid, label: (staff.data ?? []).find((u) => u.id === sid)?.name ?? sid }))} hint="The lead may be the first reviewer when the workflow uses a “responsible officer” level." />
          <Textarea label="Responsibilities" required rows={3} value={f.responsibilities} onChange={(e) => setF({ ...f, responsibilities: e.target.value })} error={errors.responsibilities} />
          <Textarea label="Instructions" rows={2} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} error={errors.instructions} />
          <Grid cols={2}>
            <Input label="Task deadline" type="date" min={todayISO()} value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} error={errors.deadline} />
            <Select label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />
          </Grid>
          <Textarea label="Review requirements" rows={2} value={f.reviewRequirements} onChange={(e) => setF({ ...f, reviewRequirements: e.target.value })} error={errors.reviewRequirements} placeholder="What reviewers expect, e.g. attach the participant list" />
          <p className="text-xs text-ink-3">Supporting files can be attached to each assignment after it is created.</p>
        </div>
      </div>
    </Modal>
  );
}

function EditAssignmentModal({ a, onClose, onDone }: { a: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ responsibilities: a.responsibilities, instructions: a.instructions ?? '', deadline: a.deadline ? toISODate(a.deadline) : '', priority: a.priority, reviewRequirements: a.reviewRequirements ?? '' });
  const [busy, setBusy] = useState(false);
  const { errors, formError, capture, clear } = useFormErrors();
  const toast = useToast();
  return (
    <Modal open onClose={onClose} title={`Edit assignment — ${a.assignee.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => {
      clear(); setBusy(true);
      try { await api.patch(`/api/daamr/assignments/${a.id}`, { ...f, deadline: f.deadline || null }); toast('success', 'Assignment updated; the staff member was notified.'); onClose(); onDone(); } catch (e) { capture(e); } finally { setBusy(false); }
    }}>Save changes</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={formError ? { message: formError } : null} />
        <Textarea label="Responsibilities" required rows={3} value={f.responsibilities} onChange={(e) => setF({ ...f, responsibilities: e.target.value })} error={errors.responsibilities} />
        <Textarea label="Instructions" rows={2} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />
        <Grid cols={2}>
          <Input label="Deadline" type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} error={errors.deadline} />
          <Select label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />
        </Grid>
        <Textarea label="Review requirements" rows={2} value={f.reviewRequirements} onChange={(e) => setF({ ...f, reviewRequirements: e.target.value })} />
      </div>
    </Modal>
  );
}

// ───────────── Execution report ─────────────

function ExecutionTab({ data }: { data: any; reload: () => void }) {
  const r = data.request;
  const rep = r.report;
  const can = data.can;
  if (r.activityType === 'COURSE') {
    return (
      <Card title="Course execution">
        <p className="text-sm text-ink-2">Courses are reported through daily session reports and a final course completion report instead of a single execution report.</p>
        {r.course && <div className="mt-3"><LinkButton to={`/courses/${r.course.id}`}>Open course {r.course.courseNo}</LinkButton></div>}
      </Card>
    );
  }
  if (!rep) {
    return (
      <Card title="Execution report">
        {r.status !== 'APPROVED' ? (
          <p className="text-sm text-ink-3">The execution report can be submitted once the activity has been approved for execution.</p>
        ) : can.createReport ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-2">After conducting the activity, submit the execution report with participants, outcomes, photographs and the attendance sheet. You can save a draft first.</p>
            <LinkButton to={`/daamr/reports/new?requestId=${r.id}`} icon={<FilePlus2 className="size-4" />}>Start execution report</LinkButton>
          </div>
        ) : (
          <p className="text-sm text-ink-3">Awaiting the execution report from the assigned staff.</p>
        )}
      </Card>
    );
  }
  const p = rep.participants;
  return (
    <div className="space-y-4">
      <Card title={`Execution report ${rep.reportNo}`} actions={<LinkButton size="sm" variant="secondary" to={`/daamr/reports/${rep.id}`}>Open full report</LinkButton>}>
        <KV cols={3} items={[
          ['Report status', <Badge status={rep.reportStatus} />], ['Actual date', fmtDate(rep.activityDate)], ['Actual venue', rep.venue], ['Responsible officer', rep.responsibleOfficer],
          ['Prepared by', rep.createdBy.name], ['Submitted', fmtDateTime(rep.submittedAt)], ['Verified', fmtDateTime(rep.verifiedAt)],
          ['Total participants', fmtNum(p?.total)], ['Expected participants', fmtNum(r.expectedParticipants)],
          ...(rep.budget ? [['Budget allocated', fmtMoney(rep.budget.allocated)], ['Budget utilized', fmtMoney(rep.budget.utilized)]] as [string, string][] : []),
        ]} />
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Activities conducted"><p className="whitespace-pre-line text-sm">{rep.description || '—'}</p></Card>
        <Card title="Achievements and outcomes"><p className="whitespace-pre-line text-sm">{rep.achievements || '—'}</p></Card>
        <Card title="Challenges faced"><p className="whitespace-pre-line text-sm">{rep.challenges || '—'}</p></Card>
        <Card title="Recommendations"><p className="whitespace-pre-line text-sm">{rep.recommendations || '—'}</p></Card>
        {rep.expenseDetails && <Card title="Expense details"><p className="whitespace-pre-line text-sm">{rep.expenseDetails}</p></Card>}
        <Card title="Staff remarks"><p className="whitespace-pre-line text-sm">{rep.remarks || '—'}</p></Card>
      </div>
      {p && (
        <Card title="Participants">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {['male', 'female', 'transgender', 'minority', 'madaris', 'disabled', 'juvenile', 'total'].map((k) => (
              <div key={k} className={cx('rounded-lg border border-line p-3', k === 'total' && 'bg-brand-50')}><p className="text-xs text-ink-3">{humanize(k)}</p><p className="tabular text-lg font-semibold">{fmtNum(p[k])}</p></div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ───────────── Activity timeline ─────────────

function ActivityLog({ log }: { log: { data: any; loading: boolean; error: any } }) {
  if (log.loading && !log.data) return <Spinner />;
  if (log.error) return <ErrorBox error={log.error} />;
  const items = log.data ?? [];
  return (
    <Card title="Activity timeline" subtitle="Every recorded step, in chronological order. Review decisions cannot be edited or deleted.">
      <ol className="relative ml-2 border-l border-line">
        {items.map((e: any) => {
          const tone = e.kind === 'review' ? (/APPROVED/.test(e.action) ? 'bg-emerald-600' : e.action === 'RETURNED' ? 'bg-orange-500' : e.action === 'REJECTED' ? 'bg-red-600' : 'bg-blue-600') : 'bg-gray-400';
          return (
            <li key={e.id} className="mb-4 ml-5">
              <span className={cx('absolute -left-[5px] mt-1.5 size-2.5 rounded-full ring-4 ring-white', tone)} aria-hidden />
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className="text-sm font-medium text-ink">{e.label}{e.level ? ` — ${e.level}` : ''}</p>
                {e.stage && <span className="rounded bg-gray-100 px-1.5 text-[11px] text-ink-2">{e.stage}</span>}
              </div>
              <p className="text-xs text-ink-3">{fmtDateTime(e.at)} · {e.actor}{e.target ? ` → ${e.target}` : ''}</p>
              {e.detail && <p className="mt-0.5 text-sm text-ink-2">{e.kind === 'review' ? `“${e.detail}”` : e.detail}</p>}
              {e.evidence?.length > 0 && <EvidenceLinks items={e.evidence} />}
            </li>
          );
        })}
      </ol>
      {!items.length && <p className="text-sm text-ink-3">No events recorded.</p>}
    </Card>
  );
}

// ───────────── Export ─────────────

const SECTIONS: [string, string][] = [
  ['overview', 'Activity information, description and objectives'], ['venue', 'Venue details'], ['images', 'Venue images and activity photographs'],
  ['assignments', 'Assigned staff'], ['reviews', 'Review and approval history'], ['execution', 'Execution report'], ['participants', 'Participants and outcomes'],
  ['documents', 'Supporting documents list'], ['approval', 'Final approval details'],
];

function ExportTab({ data }: { data: any }) {
  const { can: canPerm } = useAuth();
  const r = data.request;
  const toast = useToast();
  const photos = [...r.files, ...(r.report?.files ?? [])].filter((f: any) => f.kind === 'PHOTO' && !['REVIEW_EVIDENCE', 'ATTENDANCE'].includes(f.category));
  const [secs, setSecs] = useState<string[]>(SECTIONS.map(([k]) => k));
  const [imgs, setImgs] = useState<string[]>(photos.slice(0, 24).map((p: any) => p.id));
  const [busy, setBusy] = useState(false);
  const pdfUrl = `/api/daamr/requests/${r.id}/pdf${qs({ sections: secs.join(','), images: !secs.includes('images') || !imgs.length ? 'none' : imgs.join(',') })}`;
  const run = async (url: string) => {
    setBusy(true);
    try { await download(url); } catch (e: any) { toast('error', e.message); } finally { setBusy(false); }
  };
  if (!data.can.export) return <Notice tone="warning">You are not permitted to export this activity.</Notice>;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        <Card title="Sections to include" actions={<div className="flex gap-2 text-xs"><button className="text-brand hover:underline" onClick={() => setSecs(SECTIONS.map(([k]) => k))}>All</button><button className="text-brand hover:underline" onClick={() => setSecs([])}>None</button></div>}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SECTIONS.map(([k, label]) => <Checkbox key={k} label={label} checked={secs.includes(k)} onChange={(v) => setSecs((x) => (v ? [...x, k] : x.filter((y) => y !== k)))} />)}
          </div>
        </Card>
        {secs.includes('images') && (
          <Card title={`Images to include (${imgs.length} of ${photos.length})`} subtitle="JPEG and PNG images are embedded; WebP images are listed by name." actions={<div className="flex gap-2 text-xs"><button className="text-brand hover:underline" onClick={() => setImgs(photos.slice(0, 40).map((p: any) => p.id))}>All</button><button className="text-brand hover:underline" onClick={() => setImgs([])}>None</button></div>}>
            {photos.length ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
                {photos.map((p: any) => {
                  const on = imgs.includes(p.id);
                  return (
                    <li key={p.id}>
                      <button type="button" aria-pressed={on} onClick={() => setImgs((x) => (on ? x.filter((y) => y !== p.id) : [...x, p.id]))} className={cx('relative block w-full overflow-hidden rounded-lg border-2', on ? 'border-brand' : 'border-transparent opacity-50')}>
                        <img src={fileUrl(p.id)} alt={p.caption ?? p.originalName} className="aspect-square w-full object-cover" />
                        {on && <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-brand text-white"><Check className="size-3" /></span>}
                        <span className="block truncate bg-white px-1 py-0.5 text-[10px] text-ink-2">{humanize(p.category)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-ink-3">No images uploaded.</p>}
          </Card>
        )}
      </div>
      <Card title="Download" className="h-fit lg:sticky lg:top-20">
        <div className="space-y-2">
          <Button className="w-full" loading={busy} disabled={!secs.length} onClick={() => run(pdfUrl)} icon={<Download className="size-4" />}>Detailed activity report (PDF)</Button>
          {canPerm('daamr.export') && <Button variant="secondary" className="w-full" disabled={busy} onClick={() => run(`/api/daamr/requests/export${qs({ format: 'xlsx', q: r.daamrId })}`)} icon={<FileSpreadsheet className="size-4" />}>Activity workbook (Excel)</Button>}
          <p className="pt-1 text-xs text-ink-3">The PDF carries the directorate name and logo, page numbers and the generation date. Exports contain only information you are authorised to see, and every download is recorded in the audit log.</p>
        </div>
      </Card>
    </div>
  );
}

