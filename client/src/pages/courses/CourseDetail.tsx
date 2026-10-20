import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Ban, AlertTriangle, CalendarDays, Trash2, CheckCircle2, CircleDashed, Download, Eye, FileSpreadsheet, FileText, MapPin, Pencil, Plus, Save, Send, UserRound, Users } from 'lucide-react';
import { api, download, fileUrl, qs } from '../../lib/api';
import { useCached, useApi } from '../../lib/hooks';
import { fmtDate, fmtDateTime, fmtNum, fmtSize, humanize, toISODate, todayISO } from '../../lib/format';
import { Badge, Button, Card, Checkbox, ErrorBox, Grid, Input, KV, LinkButton, Modal, Notice, Select, Spinner, Stat, Tabs, Textarea, cx, useFormErrors, useToast } from '../../components/ui';
import { ReviewPanel, Timeline } from '../../components/Workflow';
import { Gallery, Uploader, AttachmentList } from '../../components/Files';
import { ChartCard, Columns } from '../../components/Charts';
import { ProgressBar } from './CourseList';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'schedule', label: 'Schedule & Sessions' },
  { value: 'participants', label: 'Participants' },
  { value: 'gallery', label: 'Daily Gallery' },
  { value: 'progress', label: 'Progress' },
  { value: 'completion', label: 'Completion' },
  { value: 'report', label: 'Final Report' },
];

export default function CourseDetail() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'overview';
  const setTab = (t: string) => setSp((p) => { p.set('tab', t); return p; }, { replace: true });
  const { data, loading, error, reload } = useApi(`/api/courses/${id}`);
  const toast = useToast();
  const nav = useNavigate();
  const [remove, setRemove] = useState<'delete' | 'cancel' | null>(null);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const c = data.course;
  const p = data.progress;
  const can = data.can;
  const overdueReports = c.sessions.filter((x: any) => x.reportOverdue).length;
  const today = c.sessions.find((x: any) => toISODate(x.sessionDate) === todayISO() && !['CANCELLED'].includes(x.status));
  return (
    <>
      <div className="mb-4 rounded-2xl border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to="/courses" className="no-print text-xs font-medium text-ink-3 hover:text-ink">← Course Management</Link>
            <h1 className="mt-1 text-xl font-semibold text-ink sm:text-2xl">{c.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-ink-2">{c.courseNo}</span>
              <Badge status={c.status} />
              {overdueReports > 0 && <Badge tone="red" label={`${overdueReports} daily report(s) overdue`} />}
              <span className="text-ink-3">· Proposal <Link to={`/daamr/requests/${c.activity.id}`} className="text-brand hover:underline">{c.activity.daamrId}</Link></span>
            </div>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            {today && <LinkButton to={`/courses/${c.id}/sessions/${today.id}`} icon={<CalendarDays className="size-4" />}>Today: Day {today.dayNumber}</LinkButton>}
            {can.deleteCourse && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setRemove('delete')}>Delete</Button>}
            {can.cancelCourse && !can.deleteCourse && <Button variant="ghost" icon={<Ban className="size-4" />} onClick={() => setRemove('cancel')}>Cancel course</Button>}
            {can.export && <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={() => download(`/api/courses/export?courseId=${c.id}`).catch((e) => toast('error', e.message))}>Excel workbook</Button>}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <Fact icon={<MapPin className="size-4" />} label="Venue" value={`${c.venue}, ${c.district.name}`} />
          <Fact icon={<CalendarDays className="size-4" />} label="Dates" value={`${fmtDate(c.startDate)} – ${fmtDate(c.endDate)} · ${c.durationDays} training days`} />
          <Fact icon={<UserRound className="size-4" />} label="Coordinator" value={c.coordinator.name} />
          <Fact icon={<Users className="size-4" />} label="Trainers" value={c.trainers.filter((t: any) => t.isActive).map((t: any) => t.name).join(', ') || '—'} />
        </dl>
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="mb-1 text-xs font-medium text-ink-3">Completion — {p.verifiedOfRequired} required daily reports verified{p.missed + p.cancelled ? ` · ${p.missed + p.cancelled} session(s) formally resolved` : ''}</p>
            <ProgressBar value={p.completionPercent} />
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-ink-2">
            <span><strong className="tabular text-ink">{p.conducted}</strong> conducted</span>
            <span><strong className="tabular text-ink">{p.submitted}</strong> submitted</span>
            <span><strong className="tabular text-ink">{p.verified}</strong> verified</span>
            <span><strong className="tabular text-ink">{p.pendingReports}</strong> pending</span>
          </div>
        </div>
      </div>

      {(data.completionFlags.canDecide || data.completionFlags.canReassign) && (
        <div className="mb-4">
          <ReviewPanel base={`/api/courses/completion/${c.id}`} can={data.completionFlags} onDone={reload} evidenceTarget={data.completionFlags.canDecide ? { target: 'course', entityId: c.id } : undefined} title={`Course completion review — ${data.completionFlags.level?.name ?? ''}`} returnLabel="Request changes" finalApproveLabel="Approve course completion" />
        </div>
      )}

      <Tabs value={tab} onChange={setTab} tabs={TABS.map((t) => ({ ...t, count: t.value === 'schedule' ? c.sessions.length : t.value === 'participants' ? c.participants.filter((x: any) => x.isActive).length : undefined }))} />
      {tab === 'overview' && <Overview data={data} reload={reload} />}
      {tab === 'schedule' && <Schedule data={data} reload={reload} />}
      {tab === 'participants' && <Participants data={data} reload={reload} />}
      {tab === 'gallery' && <DailyGallery data={data} reload={reload} />}
      {tab === 'progress' && <Progress data={data} />}
      {tab === 'completion' && <Completion data={data} reload={reload} />}
      {tab === 'report' && <FinalReport data={data} reload={reload} />}
      {remove && <CourseRemoveModal course={c} mode={remove} onClose={() => setRemove(null)} onDone={() => (remove === 'delete' ? nav('/courses') : reload())} />}
    </>
  );
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2">
      <span className="mt-0.5 text-ink-3">{icon}</span>
      <div className="min-w-0"><dt className="text-xs text-ink-3">{label}</dt><dd className="line-clamp-2 font-medium text-ink">{value}</dd></div>
    </div>
  );
}

// ───────────── Overview ─────────────

function Overview({ data, reload }: { data: any; reload: () => void }) {
  const c = data.course;
  const can = data.can;
  const toast = useToast();
  const people = useCached<any[]>('/api/admin/directory') ?? [];
  const [addTrainer, setAddTrainer] = useState(false);
  const [staffId, setStaffId] = useState('');
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card title="Course information">
          <KV cols={2} items={[
            ['Course ID', <span className="font-mono">{c.courseNo}</span>], ['Approved proposal', <Link className="text-brand hover:underline" to={`/daamr/requests/${c.activity.id}`}>{c.activity.daamrId}</Link>],
            ['Proposal approved', fmtDateTime(c.activity.approvedAt)], ['Category', humanize(c.category)], ['Delivery format', humanize(c.deliveryFormat)], ['Daily timing', [c.dailyStartTime, c.dailyEndTime].filter(Boolean).join(' – ') || '—'],
            ['Venue', `${c.venue}${c.venueAddress ? `, ${c.venueAddress}` : ''}`], ['District / HQ', c.district.name], ['Target audience', c.targetAudience],
            ['Registered participants', fmtNum(c.participants.filter((x: any) => x.isActive).length || c.registeredCount)], ['Course started', fmtDateTime(c.startedAt)], ['Completed', fmtDateTime(c.completedAt)],
          ]} />
        </Card>
        <Card title="Learning objectives"><p className="whitespace-pre-line text-sm">{c.objectives || '—'}</p></Card>
        <Card title="Training methodology"><p className="whitespace-pre-line text-sm">{c.methodology || '—'}</p></Card>
      </div>
      <div className="space-y-4">
        <Card title="Trainers" actions={can.manageTeam && <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setAddTrainer(true)}>Add</Button>} bodyClass="p-0">
          <ul className="divide-y divide-line">
            {c.trainers.map((t: any) => (
              <li key={t.id} className={cx('flex items-start justify-between gap-2 px-4 py-2.5 text-sm', !t.isActive && 'opacity-50')}>
                <div className="min-w-0">
                  <p className="font-medium">{t.name}{t.isGuest && <span className="ml-1.5 rounded bg-gray-100 px-1 text-[11px] text-ink-2">guest</span>}{t.user && <span className="ml-1.5 rounded bg-emerald-50 px-1 text-[11px] text-emerald-700">has account</span>}</p>
                  <p className="text-xs text-ink-3">{[t.designation, t.expertise].filter(Boolean).join(' · ')}</p>
                </div>
                {can.manageTeam && <button className="shrink-0 text-xs text-ink-3 hover:text-ink" onClick={async () => { await api.patch(`/api/courses/trainers/${t.id}`, { isActive: !t.isActive }); reload(); }}>{t.isActive ? 'Deactivate' : 'Reactivate'}</button>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Course team">
          <p className="text-sm"><span className="text-ink-3">Coordinator:</span> <strong>{c.coordinator.name}</strong>{c.coordinator.designation && <span className="text-ink-3"> — {c.coordinator.designation}</span>}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {c.staff.map((s: any) => (
              <li key={s.userId} className="flex justify-between gap-2"><span>{s.user.name}<span className="text-xs text-ink-3"> · staff</span></span>{can.manageTeam && <button className="text-xs text-ink-3 hover:text-red-700" onClick={async () => { await api.post(`/api/courses/${c.id}/staff`, { userId: s.userId, remove: true }); reload(); }}>Remove</button>}</li>
            ))}
          </ul>
          {can.manageTeam && (
            <div className="mt-3 flex gap-2">
              <Select value={staffId} onChange={(e) => setStaffId(e.target.value)} placeholder="Add staff member…" options={people.filter((u) => u.id !== c.coordinator.id && !c.staff.some((s: any) => s.userId === u.id)).map((u) => ({ value: u.id, label: u.name }))} wrapClass="flex-1" />
              <Button variant="secondary" disabled={!staffId} onClick={async () => { try { await api.post(`/api/courses/${c.id}/staff`, { userId: staffId }); setStaffId(''); reload(); } catch (e: any) { toast('error', e.message); } }}>Add</Button>
            </div>
          )}
        </Card>
      </div>
      <TrainerModal open={addTrainer} onClose={() => setAddTrainer(false)} courseId={c.id} onDone={reload} />
    </div>
  );
}

function TrainerModal({ open, onClose, courseId, onDone }: { open: boolean; onClose: () => void; courseId: string; onDone: () => void }) {
  const [f, setF] = useState({ name: '', designation: '', expertise: '', isGuest: false });
  const fe = useFormErrors();
  useEffect(() => { if (open) { setF({ name: '', designation: '', expertise: '', isGuest: false }); fe.clear(); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Add trainer" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => { try { await api.post(`/api/courses/${courseId}/trainers`, f); onClose(); onDone(); } catch (e) { fe.capture(e); } }}>Add trainer</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
        <Input label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={fe.errors.name} />
        <Input label="Designation" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} />
        <Input label="Expertise" value={f.expertise} onChange={(e) => setF({ ...f, expertise: e.target.value })} />
        <Checkbox label="Guest trainer" checked={f.isGuest} onChange={(v) => setF({ ...f, isGuest: v })} />
      </div>
    </Modal>
  );
}

// ───────────── Schedule ─────────────

function Schedule({ data, reload }: { data: any; reload: () => void }) {
  const c = data.course;
  const can = data.can;
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [dates, setDates] = useState<Record<string, { sessionDate: string; startTime: string; endTime: string }>>({});
  const [reason, setReason] = useState('');
  const [resolve, setResolve] = useState<any>(null);
  const [makeup, setMakeup] = useState(false);
  const fe = useFormErrors();
  const startEdit = () => {
    setDates(Object.fromEntries(c.sessions.map((x: any) => [x.id, { sessionDate: toISODate(x.sessionDate), startTime: x.startTime ?? '', endTime: x.endTime ?? '' }])));
    setReason('');
    fe.clear();
    setEditing(true);
  };
  const saveSchedule = async () => {
    fe.clear();
    const changed = c.sessions.filter((x: any) => { const d = dates[x.id]; return d.sessionDate !== toISODate(x.sessionDate) || d.startTime !== (x.startTime ?? '') || d.endTime !== (x.endTime ?? ''); });
    if (!changed.length) { setEditing(false); return; }
    try {
      await api.put(`/api/courses/${c.id}/schedule`, { reason, sessions: changed.map((x: any) => ({ id: x.id, ...dates[x.id] })) });
      toast('success', `${changed.length} session(s) updated. Original dates are preserved.`);
      setEditing(false);
      reload();
    } catch (e) { fe.capture(e); }
  };
  return (
    <div className="space-y-4">
      <Card
        title="Daily sessions"
        subtitle={`Generated from the approved duration, skipping non-training days${data.settings.holidays.length ? ' and configured holidays' : ''}. Each day has its own report.`}
        actions={<div className="flex gap-2">
          {can.editSchedule && !editing && <Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={startEdit}>Edit schedule</Button>}
          {can.addMakeup && <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setMakeup(true)}>Add make-up session</Button>}
        </div>}
        bodyClass="p-0"
      >
        {editing && (
          <div className="space-y-3 border-b border-line bg-amber-50/50 p-4">
            <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
            <Textarea label="Reason for the schedule change" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={fe.errors.reason} hint="Recorded permanently with each changed session; the original dates are kept." />
            <div className="flex gap-2"><Button icon={<Save className="size-4" />} onClick={saveSchedule}>Save schedule</Button><Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button></div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-ink-3">
              <tr>{['Day', 'Date', 'Time', 'Topic', 'Trainers', 'Attendance', 'Photos', 'Report status', ''].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {c.sessions.map((x: any) => (
                <tr key={x.id} className={cx('align-top', x.reportOverdue && 'bg-red-50/40')}>
                  <td className="px-3 py-2 font-semibold">{x.dayNumber}{x.isMakeup && <span className="block text-[10px] font-normal text-violet-700">make-up</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {editing && !['VERIFIED', 'MISSED', 'CANCELLED'].includes(x.status) ? <input type="date" className="rounded border border-line px-1.5 py-1 text-sm" min={todayISO()} value={dates[x.id]?.sessionDate} onChange={(e) => setDates({ ...dates, [x.id]: { ...dates[x.id], sessionDate: e.target.value } })} /> : fmtDate(x.sessionDate)}
                    {toISODate(x.originalDate) !== toISODate(x.sessionDate) && <span className="block text-[11px] text-ink-3">originally {fmtDate(x.originalDate)}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    {editing ? (
                      <span className="flex gap-1"><input type="time" className="rounded border border-line px-1 py-0.5" value={dates[x.id]?.startTime} onChange={(e) => setDates({ ...dates, [x.id]: { ...dates[x.id], startTime: e.target.value } })} /><input type="time" className="rounded border border-line px-1 py-0.5" value={dates[x.id]?.endTime} onChange={(e) => setDates({ ...dates, [x.id]: { ...dates[x.id], endTime: e.target.value } })} /></span>
                    ) : [x.startTime, x.endTime].filter(Boolean).join(' – ') || '—'}
                  </td>
                  <td className="max-w-[220px] px-3 py-2"><span className="line-clamp-2">{x.topic ?? (x.resolutionReason ? <span className="italic text-ink-3">{x.resolutionReason}</span> : '—')}</span></td>
                  <td className="max-w-[180px] px-3 py-2 text-xs">{x.trainers.map((t: any) => t.name).join(', ') || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{x.presentCount != null ? `${x.presentCount} / ${x.registeredCount ?? '—'}` : '—'}</td>
                  <td className="px-3 py-2 text-xs">{x.photos || '—'}</td>
                  <td className="px-3 py-2">
                    <Badge status={x.status} />
                    {x.reportOverdue && <span className="mt-1 block text-[11px] font-medium text-red-700">Report overdue</span>}
                    {x.reviewer && <span className="mt-1 block text-[11px] text-ink-3">With {x.reviewer.name}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Link to={`/courses/${c.id}/sessions/${x.id}`} className="text-xs font-medium text-brand hover:underline">Open</Link>
                    {can.resolveSessions && !['VERIFIED', 'MISSED', 'CANCELLED'].includes(x.status) && <button className="ml-3 text-xs text-ink-3 hover:text-ink" onClick={() => setResolve(x)}>Resolve…</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Schedule change history" subtitle="Every change to the approved schedule, with the reason. These records cannot be edited.">
        {c.scheduleChanges.length ? (
          <ul className="space-y-2 text-sm">
            {c.scheduleChanges.map((ch: any) => (
              <li key={ch.id} className="flex flex-wrap gap-x-2 border-b border-line pb-2 last:border-0">
                <Badge status={ch.changeType} label={humanize(ch.changeType)} tone={ch.changeType === 'MISSED' ? 'red' : ch.changeType === 'CANCELLED' ? 'gray' : 'blue'} />
                <span>{ch.session ? `Day ${ch.session.dayNumber}` : ''}{ch.fromDate ? ` · ${fmtDate(ch.fromDate)}` : ''}{ch.toDate ? ` → ${fmtDate(ch.toDate)}` : ''}</span>
                <span className="text-ink-3">· {ch.by.name}, {fmtDateTime(ch.createdAt)}</span>
                <span className="w-full italic text-ink-2">“{ch.reason}”</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-3">The schedule is as approved.</p>}
      </Card>
      {resolve && <ResolveModal session={resolve} onClose={() => setResolve(null)} onDone={reload} />}
      {makeup && <MakeupModal courseId={c.id} onClose={() => setMakeup(false)} onDone={reload} />}
    </div>
  );
}

export function ResolveModal({ session, onClose, onDone }: { session: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ action: 'MISSED', reason: '', newDate: '' });
  const fe = useFormErrors();
  const toast = useToast();
  return (
    <Modal open onClose={onClose} title={`Day ${session.dayNumber} — record an exception`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button variant={f.action === 'RESCHEDULED' ? 'primary' : 'danger'} onClick={async () => {
      try { await api.post(`/api/courses/sessions/${session.id}/resolve`, { ...f, newDate: f.newDate || undefined }); toast('success', 'Recorded.'); onClose(); onDone(); } catch (e) { fe.capture(e); }
    }}>Record</Button></>}>
      <div className="space-y-3">
        <Notice tone="warning">Administrator action. The reason is recorded permanently in the schedule history and the audit log, and appears in the final course report.</Notice>
        <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
        <Select label="Action" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} options={[{ value: 'MISSED', label: 'Session missed' }, { value: 'CANCELLED', label: 'Session cancelled' }, { value: 'RESCHEDULED', label: 'Reschedule to another date' }]} />
        {f.action === 'RESCHEDULED' && <Input label="New date" type="date" min={todayISO()} value={f.newDate} onChange={(e) => setF({ ...f, newDate: e.target.value })} error={fe.errors.newDate} />}
        <Textarea label="Reason" required rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} error={fe.errors.reason} />
      </div>
    </Modal>
  );
}

function MakeupModal({ courseId, onClose, onDone }: { courseId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ sessionDate: todayISO(), startTime: '', endTime: '', reason: '' });
  const fe = useFormErrors();
  return (
    <Modal open onClose={onClose} title="Add a make-up session" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => { try { await api.post(`/api/courses/${courseId}/sessions`, f); onClose(); onDone(); } catch (e) { fe.capture(e); } }}>Add session</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
        <Grid cols={3}>
          <Input label="Date" type="date" value={f.sessionDate} onChange={(e) => setF({ ...f, sessionDate: e.target.value })} error={fe.errors.sessionDate} />
          <Input label="Start" type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} />
          <Input label="End" type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} />
        </Grid>
        <Textarea label="Reason / approval reference" required rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} error={fe.errors.reason} />
      </div>
    </Modal>
  );
}

// ───────────── Participants ─────────────

function Participants({ data, reload }: { data: any; reload: () => void }) {
  const c = data.course;
  const can = data.can.manageParticipants;
  const [text, setText] = useState('');
  const fe = useFormErrors();
  const toast = useToast();
  const add = async () => {
    fe.clear();
    const participants = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, institution, gender, contact] = l.split(',').map((x) => x.trim());
      return { name, institution: institution || null, gender: gender || null, contact: contact || null };
    });
    if (!participants.length) return;
    try { await api.post(`/api/courses/${c.id}/participants`, { participants }); toast('success', `${participants.length} participant(s) registered.`); setText(''); reload(); } catch (e) { fe.capture(e); }
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
      <Card title={`Registered participants (${c.participants.filter((x: any) => x.isActive).length})`} subtitle="Registering participants enables participant-wise attendance in daily reports; totals are then calculated automatically." bodyClass="p-0">
        {c.participants.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-ink-3"><tr>{['Reg. no.', 'Name', 'Institution', 'Gender', 'Contact', ''].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {c.participants.map((x: any) => (
                  <tr key={x.id} className={cx(!x.isActive && 'opacity-50')}>
                    <td className="px-3 py-2 font-mono text-xs">{x.registrationNo}</td><td className="px-3 py-2">{x.name}</td><td className="px-3 py-2">{x.institution ?? '—'}</td><td className="px-3 py-2">{x.gender ?? '—'}</td><td className="px-3 py-2">{x.contact ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{can && <button className="text-xs text-ink-3 hover:text-ink" onClick={async () => { await api.patch(`/api/courses/participants/${x.id}`, { isActive: !x.isActive }); reload(); }}>{x.isActive ? 'Withdraw' : 'Reinstate'}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="p-4 text-sm text-ink-3">No participants registered individually. Daily reports use summary counts against {fmtNum(c.registeredCount)} registered participants.</p>}
      </Card>
      {can && (
        <Card title="Register participants">
          <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
          <Textarea label="One participant per line" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Name, Institution, Gender, Contact\nAli Khan, GPGC Mardan, Male, 0300-0000000'} hint="Only the name is required. Registration numbers are assigned automatically." />
          <Button className="mt-3" onClick={add} icon={<Plus className="size-4" />}>Register</Button>
        </Card>
      )}
    </div>
  );
}

// ───────────── Daily gallery ─────────────

function DailyGallery({ data }: { data: any; reload: () => void }) {
  const c = data.course;
  const conducted = c.sessions.filter((x: any) => x.photos > 0);
  if (!conducted.length) return <Card title="Daily gallery"><p className="text-sm text-ink-3">Photographs uploaded with the daily reports appear here, organised by day.</p></Card>;
  return (
    <div className="space-y-4">
      <Notice>Photographs marked <strong>“In final report”</strong> are reproduced in Section 4 of the final course report. For a day with no selection, its first two photographs are used. Select photographs on each day's session page.</Notice>
      {conducted.map((x: any) => <DayPhotos key={x.id} courseId={c.id} session={x} />)}
    </div>
  );
}

function DayPhotos({ courseId, session }: { courseId: string; session: any }) {
  const { data } = useApi(`/api/courses/sessions/${session.id}`);
  const photos = (data?.session.files ?? []).filter((f: any) => f.kind === 'PHOTO' && f.category !== 'REVIEW_EVIDENCE');
  return (
    <Card title={`Day ${session.dayNumber} — ${fmtDate(session.sessionDate)}${session.topic ? ` · ${session.topic}` : ''}`} actions={<Link to={`/courses/${courseId}/sessions/${session.id}`} className="text-xs font-medium text-brand hover:underline">Open session</Link>}>
      {!data ? <Spinner /> : <Gallery photos={photos} meta={(f: any) => f.featured && <span className="inline-block rounded bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700">In final report</span>} />}
    </Card>
  );
}

// ───────────── Progress ─────────────

function Progress({ data }: { data: any }) {
  const p = data.progress;
  const c = data.course;
  const rows = c.sessions.filter((x: any) => x.presentCount != null).map((x: any) => ({ day: `Day ${x.dayNumber}`, value: x.presentCount }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total scheduled sessions" value={p.totalSessions} tone="gray" />
        <Stat label="Sessions conducted" value={p.conducted} tone="blue" hint={`${p.deliveryPercent}% of the schedule delivered or resolved`} />
        <Stat label="Daily reports submitted" value={p.submitted} tone="blue" />
        <Stat label="Daily reports verified" value={p.verified} tone="green" />
        <Stat label="Pending daily reports" value={p.pendingReports} tone={p.overdueReports ? 'red' : 'amber'} hint={p.overdueReports ? `${p.overdueReports} overdue` : undefined} />
        <Stat label="Total participants" value={fmtNum(c.participants.filter((x: any) => x.isActive).length || c.registeredCount)} />
        <Stat label="Attendance" value={p.attendanceRate != null ? `${p.attendanceRate}%` : '—'} hint={`${fmtNum(p.totalPresent)} participant-days present (reported days)`} />
        <Stat label="Course completion" value={`${p.completionPercent}%`} tone={p.completionPercent >= 100 ? 'green' : 'brand'} hint="Verified or formally resolved sessions" />
      </div>
      <ChartCard title="Participants present by day" subtitle="From submitted and verified daily reports" rows={rows} columns={[{ key: 'day', label: 'Day' }, { key: 'value', label: 'Present', numeric: true }]}>
        <Columns data={rows} xKey="day" valueLabel="Present" />
      </ChartCard>
    </div>
  );
}

// ───────────── Completion ─────────────

const COMPLETION_FIELDS: [string, string, boolean][] = [
  ['summary', 'Completion summary', true], ['learningOutcomes', 'Learning outcomes', true], ['skillsDeveloped', 'Skills developed', false], ['projectsCompleted', 'Projects completed', false],
  ['achievements', 'Achievements and notable activities', false], ['challenges', 'Challenges encountered', false], ['recommendations', 'Recommendations for future training', false], ['coordinatorRemarks', "Coordinator's final remarks", true],
];

function Completion({ data, reload }: { data: any; reload: () => void }) {
  const c = data.course;
  const can = data.can;
  const cp = c.completion;
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const fe = useFormErrors();
  const toast = useToast();
  useEffect(() => setF(Object.fromEntries(COMPLETION_FIELDS.map(([k]) => [k, cp?.[k] ?? '']))), [cp?.updatedAt]);
  const checks: [string, boolean][] = [
    ['All sessions conducted or formally resolved', !data.blockers.some((b: string) => b.startsWith('Daily reports not yet verified'))],
    ['All daily reports submitted and verified', data.progress.verified + data.progress.missed + data.progress.cancelled === data.progress.totalSessions],
    ['Attendance and evidence recorded for every verified day', !data.blockers.some((b: string) => /attendance|photographic/.test(b))],
    ["Coordinator's completion report submitted", !!cp && ['SUBMITTED', 'APPROVED'].includes(cp.status)],
    ['Final approval of course completion', cp?.status === 'APPROVED'],
  ];
  const save = async (submit: boolean) => {
    fe.clear();
    setBusy(submit ? 'submit' : 'save');
    try {
      await api.put(`/api/courses/${c.id}/completion`, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null])));
      if (submit) await api.post(`/api/courses/${c.id}/completion/submit`);
      toast('success', submit ? 'Completion report submitted for final review.' : 'Saved.');
      reload();
    } catch (e) { fe.capture(e); } finally { setBusy(null); }
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0 space-y-4">
        <Card title="Course completion report" subtitle={cp ? `Status: ${humanize(cp.status)}` : 'Not started'}>
          <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
          {cp?.status === 'CHANGES_REQUESTED' && <div className="mb-3"><Notice tone="warning">Changes were requested — see the review history, update the report and submit it again.</Notice></div>}
          <div className="space-y-3">
            {COMPLETION_FIELDS.map(([k, label, req]) => (
              can.editCompletion
                ? <Textarea key={k} label={label} required={req} rows={k === 'summary' ? 4 : 3} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} error={fe.errors[k]} />
                : <div key={k}><p className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</p><p className="whitespace-pre-line text-sm">{cp?.[k] || <span className="italic text-ink-3">Not reported.</span>}</p></div>
            ))}
          </div>
          {can.editCompletion && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" loading={busy === 'save'} onClick={() => save(false)} icon={<Save className="size-4" />}>Save draft</Button>
              <Button loading={busy === 'submit'} disabled={!can.submitCompletion} onClick={() => save(true)} icon={<Send className="size-4" />}>Submit for final approval</Button>
            </div>
          )}
          <p className="mt-2 text-xs text-ink-3">Use only verified information from the daily reports. The final report reproduces these sections as written.</p>
        </Card>
        {data.completionTimeline && <Timeline tl={data.completionTimeline} title="Completion review history" />}
      </div>
      <Card title="Completion requirements" className="h-fit">
        <ul className="space-y-2.5 text-sm">
          {checks.map(([label, ok]) => (
            <li key={label} className="flex items-start gap-2">{ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-ink-3" />}<span className={ok ? 'text-ink' : 'text-ink-2'}>{label}</span></li>
          ))}
        </ul>
        {data.blockers.length > 0 && (
          <div className="mt-4 space-y-1.5 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" />Outstanding before completion</p>
            {data.blockers.map((b: string, i: number) => <p key={i}>{b}</p>)}
          </div>
        )}
      </Card>
    </div>
  );
}

// ───────────── Final report ─────────────

function FinalReport({ data, reload }: { data: any; reload: () => void }) {
  const c = data.course;
  const can = data.can;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const fe = useFormErrors();
  const toast = useToast();
  const generate = async () => {
    fe.clear();
    setBusy(true);
    try { const v = await api.post(`/api/courses/${c.id}/report`, { reason: reason || undefined }); toast('success', `Final report version ${v.version} generated.`); setReason(''); reload(); } catch (e) { fe.capture(e); } finally { setBusy(false); }
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      <Card title="Report versions" subtitle="Every generated report is stored. Earlier versions remain available after corrections." bodyClass="p-0">
        {c.reportVersions.length ? (
          <ul className="divide-y divide-line">
            {c.reportVersions.map((v: any) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 size-5 text-ink-3" />
                  <div>
                    <p className="font-medium">Version {v.version}{v === c.reportVersions[0] && <span className="ml-2 rounded bg-emerald-50 px-1.5 text-[11px] text-emerald-700">latest</span>}</p>
                    <p className="text-xs text-ink-3">{fmtDateTime(v.createdAt)} · {v.generatedBy.name} · {fmtSize(v.file.size)}</p>
                    {v.reason && <p className="text-xs italic text-ink-2">“{v.reason}”</p>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <a className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:bg-gray-50" href={fileUrl(v.file.id)} target="_blank" rel="noreferrer"><Eye className="size-4" />View</a>
                  <a className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:bg-gray-50" href={fileUrl(v.file.id, true)}><Download className="size-4" />Download</a>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="p-4 text-sm text-ink-3">No final report has been generated yet.</p>}
      </Card>
      <Card title="Generate the final course report" className="h-fit">
        {c.status !== 'COMPLETED' && <Notice tone="warning">The final report is generated after the course completion has been approved. {can.previewReport && 'A watermarked draft can be previewed now.'}</Notice>}
        <div className="mt-3 space-y-2">
          <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
          {can.previewReport && <a href={`/api/courses/${c.id}/report/preview`} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium hover:bg-gray-50"><Eye className="size-4" />Preview report{c.status !== 'COMPLETED' ? ' (draft)' : ''}</a>}
          {can.generateReport && (
            <>
              {c.reportVersions.length > 0 && <Textarea label="Reason for regenerating" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={fe.errors.reason} hint="e.g. approved corrections or an updated logo" />}
              <Button className="w-full" loading={busy} onClick={generate} icon={<FileText className="size-4" />}>{c.reportVersions.length ? 'Generate new version' : 'Generate Final Course Report'}</Button>
            </>
          )}
          <p className="text-xs text-ink-3">The report contains a cover page, contents, executive summary, course details, all daily reports, photographs, attendance, outcomes, approvals and annexures, built from saved and verified records.</p>
        </div>
      </Card>
    </div>
  );
}


/** Delete (no submitted reports) or cancel (keeps history) a course — administrators only, reason required. */
export function CourseRemoveModal({ course, mode, onClose, onDone }: { course: { id: string; courseNo: string; title: string }; mode: 'delete' | 'cancel'; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const fe = useFormErrors();
  const toast = useToast();
  const del = mode === 'delete';
  return (
    <Modal open onClose={onClose} title={`${del ? 'Delete' : 'Cancel'} course ${course.courseNo}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Keep course</Button><Button variant="danger" loading={busy} onClick={async () => {
      fe.clear(); setBusy(true);
      try { await api.post(`/api/courses/${course.id}/${del ? 'delete' : 'cancel'}`, { reason }); toast('success', del ? 'Course deleted.' : 'Course cancelled.'); onClose(); onDone(); } catch (e) { fe.capture(e); } finally { setBusy(false); }
    }}>{del ? 'Delete permanently' : 'Cancel course'}</Button></>}>
      <div className="space-y-3">
        <p className="text-sm font-medium text-ink">{course.title}</p>
        <Notice tone="warning">
          {del
            ? 'The course, its schedule, participants and uploaded files will be removed. The approved proposal stays and the course can be set up again from it. The deletion is recorded in the audit log.'
            : 'The course stops: open sessions are cancelled and reports under review are withdrawn. All records and review history are kept.'}
        </Notice>
        <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
        <Textarea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={fe.errors.reason} />
      </div>
    </Modal>
  );
}
