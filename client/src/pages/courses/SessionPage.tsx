import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock, MapPin, Plus, Save, Send, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { fmtDate, fmtDateTime, humanize } from '../../lib/format';
import { Badge, Button, Card, Checkbox, ErrorBox, Grid, Input, Notice, Select, Spinner, Textarea, cx, useConfirm, useFormErrors, useToast } from '../../components/ui';
import { ReviewPanel, Timeline } from '../../components/Workflow';
import { AttachmentList, Gallery, Uploader } from '../../components/Files';
import { ResolveModal } from './CourseDetail';
import { MobileActions } from '../../components/FormKit';

type TrainerRow = { trainerId: string; name: string; designation: string; isGuest: boolean };
const CONTENT: [string, string, number][] = [
  ['learningObjectives', 'Learning objectives', 3], ['topicsCovered', 'Detailed topics covered', 5], ['activities', 'Teaching activities and practical exercises', 4],
  ['tools', 'Tools, software or equipment used', 2], ['achievements', 'Achievements and learning outcomes', 4], ['challenges', 'Challenges or issues', 3], ['nextPlan', 'Plan for the next session', 3],
];

export default function SessionPage() {
  const { courseId, sid } = useParams();
  const { data, loading, error, reload } = useApi(`/api/courses/sessions/${sid}`);
  const toast = useToast();
  const confirm = useConfirm();
  const fe = useFormErrors();
  const [f, setF] = useState<Record<string, any>>({});
  const [trainers, setTrainers] = useState<TrainerRow[]>([]);
  const [att, setAtt] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [resolve, setResolve] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const x = data?.session;
    if (!x) return;
    setF({
      topic: x.topic ?? '', learningObjectives: x.learningObjectives ?? '', topicsCovered: x.topicsCovered ?? '', activities: x.activities ?? '', tools: x.tools ?? '', achievements: x.achievements ?? '',
      challenges: x.challenges ?? '', nextPlan: x.nextPlan ?? '', startTime: x.startTime ?? '', endTime: x.endTime ?? '', conducted: x.conducted, attendanceRemarks: x.attendanceRemarks ?? '',
      attendanceMode: x.course.participants.length ? (x.attendanceMode === 'SUMMARY' && x.presentCount != null ? 'SUMMARY' : 'PARTICIPANT') : 'SUMMARY',
      presentCount: x.presentCount ?? '', absentCount: x.absentCount ?? '',
    });
    setTrainers(x.trainers.map((t: any) => ({ trainerId: t.trainerId ?? '', name: t.name, designation: t.designation ?? '', isGuest: t.isGuest })));
    setAtt(Object.fromEntries(x.attendance.map((a: any) => [a.participantId, a.status])));
    setDirty(false);
    // reset the form only when the saved report changes — not when photos or documents are added (unsaved edits are kept)
  }, [data?.session.id, data?.session.updatedAt, data?.session.status]);

  const participants = data?.session.course.participants ?? [];
  const counts = useMemo(() => {
    const vals = participants.map((p: any) => att[p.id]).filter(Boolean);
    return { present: vals.filter((v: string) => v === 'PRESENT').length, absent: vals.filter((v: string) => v !== 'PRESENT').length, recorded: vals.length };
  }, [att, participants]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const x = data.session;
  const can = data.can;
  const edit = can.edit;
  const set = (p: Record<string, any>) => { setF((v) => ({ ...v, ...p })); setDirty(true); };
  const registered = participants.length || x.registeredCount || x.course.registeredCount;
  const photos = x.files.filter((file: any) => file.kind === 'PHOTO' && file.category !== 'REVIEW_EVIDENCE');
  const docs = x.files.filter((file: any) => file.kind === 'DOCUMENT' || ['REVIEW_EVIDENCE', 'ATTENDANCE_SHEET'].includes(file.category));

  const body = () => ({
    topic: f.topic || null, learningObjectives: f.learningObjectives || null, topicsCovered: f.topicsCovered || null, activities: f.activities || null, tools: f.tools || null,
    achievements: f.achievements || null, challenges: f.challenges || null, nextPlan: f.nextPlan || null, startTime: f.startTime || null, endTime: f.endTime || null,
    conducted: !!f.conducted, attendanceRemarks: f.attendanceRemarks || null,
    trainers: trainers.filter((t) => t.trainerId || t.name.trim()).map((t) => (t.trainerId ? { trainerId: t.trainerId } : { name: t.name, designation: t.designation || null, isGuest: true })),
    attendanceMode: f.attendanceMode,
    ...(f.attendanceMode === 'PARTICIPANT'
      ? { attendance: Object.entries(att).map(([participantId, status]) => ({ participantId, status })) }
      : { presentCount: f.presentCount === '' ? null : Number(f.presentCount), absentCount: f.absentCount === '' ? null : Number(f.absentCount) }),
  });
  const save = async (submit: boolean) => {
    fe.clear();
    if (submit && !(await confirm({ title: 'Submit the daily report?', message: 'The report will be sent for review and locked until the reviewer verifies it or requests changes.', confirmLabel: 'Submit for review', tone: 'success' }))) return;
    setBusy(submit ? 'submit' : 'save');
    try {
      if (edit) await api.put(`/api/courses/sessions/${x.id}`, body());
      if (submit) await api.post(`/api/courses/sessions/${x.id}/submit`);
      toast('success', submit ? `Day ${x.dayNumber} report submitted for review.` : 'Draft saved.');
      reload();
    } catch (e) { fe.capture(e); window.scrollTo({ top: 0, behavior: 'smooth' }); } finally { setBusy(null); }
  };
  const feature = async (fileId: string, featured: boolean) => {
    try { await api.patch(`/api/courses/sessions/files/${fileId}/feature`, { featured }); reload(); } catch (e: any) { toast('error', e.message); }
  };
  const lastReturn = data.timeline?.history?.filter((h: any) => h.action === 'RETURNED').at(-1);

  return (
    <>
      <div className="mb-4 rounded-2xl border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={`/courses/${courseId}?tab=schedule`} className="no-print text-xs font-medium text-ink-3 hover:text-ink">← {x.course.courseNo} · {x.course.title}</Link>
            <h1 className="mt-1 text-xl font-semibold text-ink sm:text-2xl">Day {x.dayNumber} — Daily Training Session{x.isMakeup && <span className="ml-2 align-middle text-sm font-normal text-violet-700">(make-up)</span>}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-2">
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4 text-ink-3" />{fmtDate(x.sessionDate)}{fmtDate(x.originalDate) !== fmtDate(x.sessionDate) && <span className="text-xs text-ink-3">(originally {fmtDate(x.originalDate)})</span>}</span>
              <span className="inline-flex items-center gap-1.5"><Clock className="size-4 text-ink-3" />{[x.startTime, x.endTime].filter(Boolean).join(' – ') || '—'}</span>
              <span className="inline-flex items-center gap-1.5"><MapPin className="size-4 text-ink-3" />{x.venue}</span>
              <Badge status={x.status} />
              {x.conducted && !['MISSED', 'CANCELLED'].includes(x.status) && <Badge tone="green" label="Class conducted" />}
            </div>
          </div>
          <div className="no-print flex flex-wrap items-center gap-2">
            {data.nav.prev && <Link to={`/courses/${courseId}/sessions/${data.nav.prev.id}`} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-gray-50"><ArrowLeft className="size-4" />Day {data.nav.prev.dayNumber}</Link>}
            {data.nav.next && <Link to={`/courses/${courseId}/sessions/${data.nav.next.id}`} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-gray-50">Day {data.nav.next.dayNumber}<ArrowRight className="size-4" /></Link>}
            {can.resolve && <Button variant="secondary" size="sm" onClick={() => setResolve(true)}>Record exception…</Button>}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {can.isFuture && <Notice>This session is scheduled for {fmtDate(x.sessionDate)}. You can prepare the report now; the class can be marked as conducted and the report submitted on or after that date.</Notice>}
        {['MISSED', 'CANCELLED'].includes(x.status) && <Notice tone="warning">Recorded as <strong>{humanize(x.status).toLowerCase()}</strong>: “{x.resolutionReason}”</Notice>}
        {x.status === 'CHANGES_REQUESTED' && lastReturn && <Notice tone="warning"><strong>Changes requested</strong> by {lastReturn.actorName} on {fmtDateTime(lastReturn.createdAt)}: “{lastReturn.remarks}”. Correct the report and submit it again.</Notice>}
        {x.status === 'SUBMITTED' && <Notice>Submitted for review{data.timeline?.instance.currentAssignee ? ` — with ${data.timeline.instance.currentAssignee.name}` : ''}. The report is locked until it is verified or returned.</Notice>}
        {x.status === 'VERIFIED' && <Notice tone="success">Verified{x.verifiedAt ? ` on ${fmtDateTime(x.verifiedAt)}` : ''}. This report is final and counts toward course progress.</Notice>}
        <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
      </div>

      {(can.canDecide || can.canReassign) && (
        <div className="mt-4"><ReviewPanel base={`/api/courses/sessions/${x.id}`} can={can} onDone={reload} evidenceTarget={can.canDecide ? { target: 'course-session', entityId: x.id } : undefined} title={`Daily report review — Day ${x.dayNumber}`} approveLabel="Verify & forward" finalApproveLabel="Verify daily report" returnLabel="Request corrections" /></div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Card title="Session information">
            <Grid cols={3}>
              <Input label="Course" value={`${x.course.courseNo} — ${x.course.title}`} disabled wrapClass="sm:col-span-3" />
              <Input label="Start time" type="time" value={f.startTime ?? ''} disabled={!edit} onChange={(e) => set({ startTime: e.target.value })} error={fe.errors.startTime} />
              <Input label="End time" type="time" value={f.endTime ?? ''} disabled={!edit} onChange={(e) => set({ endTime: e.target.value })} error={fe.errors.endTime} />
              <div className="flex items-end pb-2">
                <Checkbox label="Class conducted" checked={!!f.conducted} disabled={!can.markConducted} onChange={(v) => set({ conducted: v })} hint={can.isFuture ? 'Available on the session date' : undefined} />
              </div>
            </Grid>
            {fe.errors.conducted && <p className="mt-1 text-xs text-red-600">{fe.errors.conducted}</p>}
          </Card>

          <Card title="Trainers" subtitle="Approved course trainers or guest trainers for this session." actions={edit && <div className="flex gap-2"><Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => { setTrainers([...trainers, { trainerId: x.course.trainers[0]?.id ?? '', name: '', designation: '', isGuest: false }]); setDirty(true); }}>Course trainer</Button><Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => { setTrainers([...trainers, { trainerId: '', name: '', designation: '', isGuest: true }]); setDirty(true); }}>Guest</Button></div>}>
            {fe.errors.trainers && <p className="mb-2 text-xs text-red-600">{fe.errors.trainers}</p>}
            {trainers.length === 0 && <p className="text-sm text-ink-3">No trainers recorded.</p>}
            <div className="space-y-2">
              {trainers.map((t, i) => {
                const upd = (p: Partial<TrainerRow>) => { setTrainers(trainers.map((y, j) => (j === i ? { ...y, ...p } : y))); setDirty(true); };
                const ct = x.course.trainers.find((y: any) => y.id === t.trainerId);
                return (
                  <div key={i} className="grid grid-cols-1 items-end gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_auto]">
                    {t.isGuest ? (
                      <>
                        <Input label="Guest trainer name" value={t.name} disabled={!edit} onChange={(e) => upd({ name: e.target.value })} />
                        <Input label="Designation / expertise" value={t.designation} disabled={!edit} onChange={(e) => upd({ designation: e.target.value })} />
                      </>
                    ) : (
                      <>
                        <Select label="Assigned trainer" value={t.trainerId} disabled={!edit} onChange={(e) => upd({ trainerId: e.target.value })} options={x.course.trainers.map((y: any) => ({ value: y.id, label: y.name }))} />
                        <Input label="Designation / expertise" value={ct ? [ct.designation, ct.expertise].filter(Boolean).join(' · ') : t.designation} disabled />
                      </>
                    )}
                    {edit && <Button variant="ghost" size="sm" aria-label="Remove trainer" onClick={() => { setTrainers(trainers.filter((_, j) => j !== i)); setDirty(true); }}><Trash2 className="size-4" /></Button>}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Teaching and learning content">
            <div className="space-y-3">
              <Input label="Today's topic" required value={f.topic ?? ''} disabled={!edit} onChange={(e) => set({ topic: e.target.value })} error={fe.errors.topic} maxLength={300} />
              {CONTENT.map(([k, label, rows]) => (
                <Textarea key={k} label={label} required={k === 'topicsCovered'} rows={rows} value={f[k] ?? ''} disabled={!edit} onChange={(e) => set({ [k]: e.target.value })} error={fe.errors[k]} />
              ))}
            </div>
          </Card>

          <Card title="Attendance and participants" subtitle={`${registered} registered participant(s)`}>
            {fe.errors.presentCount && <p className="mb-2 text-xs text-red-600">{fe.errors.presentCount}</p>}
            {fe.errors.attendance && <p className="mb-2 text-xs text-red-600">{fe.errors.attendance}</p>}
            {participants.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Attendance method">
                {[['PARTICIPANT', 'Participant-wise'], ['SUMMARY', 'Totals only']].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={f.attendanceMode === v} disabled={!edit} onClick={() => set({ attendanceMode: v })} className={cx('rounded-lg border px-3 py-1.5 text-sm', f.attendanceMode === v ? 'border-brand bg-brand-50 font-medium text-brand' : 'border-line')}>{l}</button>
                ))}
              </div>
            )}
            {f.attendanceMode === 'PARTICIPANT' && participants.length > 0 ? (
              <>
                <div className="mb-3 flex flex-wrap gap-4 text-sm">
                  <span>Present: <strong className="tabular">{counts.present}</strong></span>
                  <span>Absent / leave: <strong className="tabular">{counts.absent}</strong></span>
                  <span className={cx(counts.recorded < participants.length && 'text-amber-700')}>Recorded: <strong className="tabular">{counts.recorded}</strong> of {participants.length}</span>
                  {edit && <button className="text-xs font-medium text-brand hover:underline" onClick={() => { setAtt(Object.fromEntries(participants.map((p: any) => [p.id, 'PRESENT']))); setDirty(true); }}>Mark all present</button>}
                </div>
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {participants.map((p: any) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span><span className="font-mono text-xs text-ink-3">{p.registrationNo}</span> {p.name}{p.institution && <span className="text-xs text-ink-3"> · {p.institution}</span>}</span>
                      <span className="flex gap-1">
                        {['PRESENT', 'ABSENT', 'LEAVE'].map((st) => (
                          <button key={st} type="button" disabled={!edit} aria-pressed={att[p.id] === st} onClick={() => { setAtt({ ...att, [p.id]: st }); setDirty(true); }}
                            className={cx('rounded-md border px-2 py-1 text-xs', att[p.id] === st ? (st === 'PRESENT' ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : st === 'ABSENT' ? 'border-red-500 bg-red-50 text-red-700' : 'border-amber-500 bg-amber-50 text-amber-800') : 'border-line text-ink-3 hover:bg-gray-50')}>
                            {humanize(st)}
                          </button>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-3">Totals are calculated from these records and cannot be entered separately.</p>
              </>
            ) : (
              <Grid cols={3}>
                <Input label="Registered" value={registered} disabled />
                <Input label="Present" type="number" min={0} max={registered} value={f.presentCount ?? ''} disabled={!edit} onChange={(e) => { const v = e.target.value.replace(/[^\d]/g, ''); set({ presentCount: v, absentCount: v === '' ? '' : String(Math.max(0, registered - Number(v))) }); }} error={fe.errors.presentCount} />
                <Input label="Absent" type="number" min={0} value={f.absentCount ?? ''} disabled={!edit} onChange={(e) => set({ absentCount: e.target.value.replace(/[^\d]/g, '') })} error={fe.errors.absentCount} hint="Present + absent must equal registered" />
              </Grid>
            )}
            <Textarea label="Attendance remarks" wrapClass="mt-3" rows={2} value={f.attendanceRemarks ?? ''} disabled={!edit} onChange={(e) => set({ attendanceRemarks: e.target.value })} />
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-2 text-sm font-medium">Attendance sheet</p>
              <AttachmentList files={x.files.filter((file: any) => file.category === 'ATTENDANCE_SHEET')} onChanged={reload} canRemove={() => edit} />
              {edit && <div className="mt-2"><Uploader target="course-session" entityId={x.id} kind="pdfimage" compact categories={[{ value: 'ATTENDANCE_SHEET', label: 'Attendance sheet' }]} onUploaded={reload} /></div>}
            </div>
          </Card>

          <Card title={`Daily photographs and evidence (${photos.length})`} subtitle={data.requirePhotos ? 'At least one photograph is required before the report can be submitted.' : undefined}>
            {fe.errors.photos && <p className="mb-2 text-xs text-red-600">{fe.errors.photos}</p>}
            {edit && <div className="mb-4"><Uploader target="course-session" entityId={x.id} categories={Object.entries(data.photoCategories).map(([value, label]) => ({ value, label: label as string }))} withGeo withDescription onUploaded={reload} /></div>}
            <Gallery photos={photos} onChanged={reload} canRemove={() => edit} emptyText="No photographs yet."
              meta={(file: any) => (
                <div className="pt-1">
                  {(file as any).description && <p className="line-clamp-2 text-ink-2">{(file as any).description}</p>}
                  {can.selectPhotos ? (
                    <label className="mt-1 inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-ink-2"><input type="checkbox" className="size-3.5 accent-[var(--brand)]" checked={!!file.featured} onChange={(e) => feature(file.id, e.target.checked)} />In final report</label>
                  ) : file.featured && <span className="text-[11px] font-medium text-emerald-700">In final report</span>}
                </div>
              )} />
          </Card>

          <Card title="Training materials and documents">
            <AttachmentList files={docs.filter((file: any) => file.category !== 'ATTENDANCE_SHEET')} onChanged={reload} canRemove={(file) => edit || file.category === 'REVIEW_EVIDENCE'} />
            {edit && <div className="mt-3"><Uploader target="course-session" entityId={x.id} kind="doc" compact categories={[{ value: 'MATERIAL', label: 'Training material / presentation' }, { value: 'SUPPORTING', label: 'Supporting document' }]} onUploaded={reload} /></div>}
          </Card>
        </div>

        <aside className="space-y-4">
          {edit && (
            <Card title="Daily report" className="hidden lg:block xl:sticky xl:top-20">
              <div className="space-y-2">
                <Button variant="secondary" className="w-full" loading={busy === 'save'} onClick={() => save(false)} icon={<Save className="size-4" />}>Save draft</Button>
                <Button className="w-full" loading={busy === 'submit'} disabled={!can.submit} onClick={() => save(true)} icon={<Send className="size-4" />}>{x.status === 'CHANGES_REQUESTED' ? 'Resubmit corrected report' : 'Submit for review'}</Button>
                {dirty && <p className="text-xs text-amber-700">You have unsaved changes.</p>}
                <ol className="mt-2 space-y-1.5 text-xs text-ink-2">
                  {[['Class conducted', !!f.conducted], ["Today's topic and content", !!f.topic && !!f.topicsCovered], ['Trainer(s) recorded', trainers.length > 0], ['Attendance recorded', f.attendanceMode === 'PARTICIPANT' ? counts.recorded === participants.length && participants.length > 0 : f.presentCount !== ''], ['Photograph uploaded', !data.requirePhotos || photos.length > 0]].map(([l, ok]) => (
                    <li key={l as string} className="flex items-center gap-1.5">{ok ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <span className="size-3.5 rounded-full border border-gray-300" />}{l}</li>
                  ))}
                </ol>
              </div>
            </Card>
          )}
          {data.timeline ? <Timeline tl={data.timeline} title="Submission and review history" /> : <Card title="Submission and review history"><p className="text-sm text-ink-3">Starts when the daily report is submitted.</p></Card>}
          {x.changes.length > 0 && (
            <Card title="Schedule changes">
              <ul className="space-y-2 text-xs">{x.changes.map((ch: any) => <li key={ch.id}><strong>{humanize(ch.changeType)}</strong> · {ch.by.name}, {fmtDateTime(ch.createdAt)}<br /><span className="italic text-ink-2">“{ch.reason}”</span></li>)}</ul>
            </Card>
          )}
          <p className="px-1 text-xs text-ink-3">Last saved {fmtDateTime(x.updatedAt)}{x.updatedBy ? ` by ${x.updatedBy.name}` : ''} · version {x.version}</p>
        </aside>
      </div>
      {edit && (
        <MobileActions>
          <Button variant="secondary" loading={busy === 'save'} onClick={() => save(false)} icon={<Save className="size-4" />}>Save draft</Button>
          <Button loading={busy === 'submit'} disabled={!can.submit} onClick={() => save(true)} icon={<Send className="size-4" />}>Submit</Button>
        </MobileActions>
      )}
      {resolve && <ResolveModal session={x} onClose={() => setResolve(false)} onDone={reload} />}
    </>
  );
}
