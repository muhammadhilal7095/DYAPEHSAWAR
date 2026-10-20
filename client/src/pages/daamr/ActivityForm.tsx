import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight, Check, FileText, ImagePlus, Save, Send, Trash2, Upload, X } from 'lucide-react';
import { api, fileUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDistricts, useLookups } from '../../lib/hooks';
import { addDays, fmtDate, fmtDateTime, fmtMoney, fmtSize, humanize, toISODate, todayISO } from '../../lib/format';
import { MobileActions } from '../../components/FormKit';
import { Badge, Button, Card, ErrorBox, Grid, Input, Notice, PageHeader, Select, Spinner, Textarea, cx, useConfirm, useFormErrors, useToast } from '../../components/ui';

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

const blank = () => ({
  subject: '', category: '', priority: 'NORMAL', departmentId: '', description: '', objectives: '', targetAudience: '', expectedParticipants: '' as any,
  startDate: addDays(todayISO(), 7), startTime: '', endDate: addDays(todayISO(), 7), endTime: '',
  province: 'Khyber Pakhtunkhwa', districtId: '', tehsil: '', area: '', venue: '', venueAddress: '',
  proposedBudget: '' as any, requesteeEmail: '',
  activityType: 'EVENT', trainingDays: '' as any, deliveryFormat: '', methodology: '',
  proposedTrainers: [] as { name: string; designation: string; expertise: string; userId: string }[],
});
type Form = ReturnType<typeof blank>;

const STEPS = [
  { key: 'details', title: 'Activity details', hint: 'What, why and for whom', fields: ['activityType', 'subject', 'category', 'priority', 'departmentId', 'description', 'objectives', 'targetAudience', 'expectedParticipants', 'trainingDays', 'deliveryFormat', 'methodology', 'proposedTrainers'] },
  { key: 'schedule', title: 'Schedule & location', hint: 'When and where', fields: ['startDate', 'startTime', 'endDate', 'endTime', 'province', 'districtId', 'tehsil', 'area', 'venue', 'venueAddress'] },
  { key: 'media', title: 'Images & documents', hint: 'Cover, venue gallery, attachments', fields: [] as string[] },
  { key: 'budget', title: 'Budget & contact', hint: 'Estimate and notifications', fields: ['proposedBudget', 'requesteeEmail'] },
  { key: 'review', title: 'Review & submit', hint: 'Check and send for review', fields: [] as string[] },
];
const REQUIRED: Record<string, string> = {
  subject: 'Activity title', description: 'Description', objectives: 'Objectives', startDate: 'Start date', endDate: 'End date', districtId: 'District / HQ',
  area: 'Location', venue: 'Venue name', venueAddress: 'Venue address', requesteeEmail: 'Notification email',
};

interface Staged { file: File; url: string; caption: string }
const PHOTO_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const DOC_EXT = ['pdf', 'docx', 'xlsx', 'jpg', 'jpeg', 'png', 'webp'];

export default function ActivityForm() {
  const { id: routeId } = useParams();
  const [sp, setSp] = useSearchParams();
  const { me, settings } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const districts = useDistricts();
  const categories = useLookups('ACTIVITY_CATEGORY');
  const departments = useCached<any[]>('/api/admin/departments') ?? [];
  const [id, setId] = useState<string | undefined>(routeId);
  const { data, loading, reload } = useApi(id ? `/api/daamr/requests/${id}` : null);
  const [f, setF] = useState<Form>(blank());
  const [step, setStep] = useState(Math.min(Number(sp.get('step') ?? 0) || 0, STEPS.length - 1));
  const [busy, setBusy] = useState<string | null>(null);
  const [cover, setCover] = useState<Staged | null>(null);
  const [venuePics, setVenuePics] = useState<Staged[]>([]);
  const [docs, setDocs] = useState<Staged[]>([]);
  const { errors, formError, capture, clear } = useFormErrors();
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const maxMb = settings?.maxUploadMb ?? 10;

  useEffect(() => {
    if (!id && me) set({ requesteeEmail: me.email, districtId: me.districtId ?? '' });
  }, [id, me]);
  useEffect(() => {
    const r = data?.request;
    if (!r) return;
    setF({
      subject: r.subject, category: r.category ?? '', priority: r.priority, departmentId: r.departmentId ?? '', description: r.description, objectives: r.objectives ?? '',
      targetAudience: r.targetAudience ?? '', expectedParticipants: r.expectedParticipants ?? '', startDate: toISODate(r.startDate), startTime: r.startTime ?? '',
      endDate: toISODate(r.endDate), endTime: r.endTime ?? '', province: r.province, districtId: r.districtId, tehsil: r.tehsil ?? '', area: r.area, venue: r.venue,
      venueAddress: r.venueAddress ?? '', proposedBudget: r.proposedBudget ?? '', requesteeEmail: r.requesteeEmail,
      activityType: r.activityType ?? 'EVENT', trainingDays: r.trainingDays ?? '', deliveryFormat: r.deliveryFormat ?? '', methodology: r.methodology ?? '',
      proposedTrainers: (r.proposedTrainers ?? []).map((t: any) => ({ name: t.name ?? '', designation: t.designation ?? '', expertise: t.expertise ?? '', userId: t.userId ?? '' })),
    });
  }, [data]);
  useEffect(() => {
    setSp((p) => { p.set('step', String(step)); return p; }, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);
  // release preview URLs when leaving the page
  const staged = useRef<Staged[]>([]);
  staged.current = [...(cover ? [cover] : []), ...venuePics, ...docs];
  useEffect(() => () => staged.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  const existing = data?.request?.files ?? [];
  const existingCover = data?.cover ?? null;
  const existingVenue = existing.filter((x: any) => x.category === 'PRE_ACTIVITY');
  const existingDocs = existing.filter((x: any) => x.category === 'SUPPORTING');
  const returned = data?.request?.status === 'RETURNED';
  const lastReturn = data?.timeline?.history?.filter((h: any) => h.action === 'RETURNED').at(-1);

  const missing = useMemo(() => [
    ...Object.entries(REQUIRED).filter(([k]) => !String((f as any)[k] ?? '').trim()).map(([k, label]) => ({ k, label })),
    ...(f.activityType === 'COURSE' && !f.trainingDays ? [{ k: 'trainingDays', label: 'Training days' }] : []),
    ...(f.activityType === 'COURSE' && !f.proposedTrainers.some((t) => t.name.trim()) ? [{ k: 'proposedTrainers', label: 'At least one trainer' }] : []),
  ], [f]);
  const staffDirectory = useCached<any[]>('/api/admin/directory') ?? [];
  const stepHasError = (i: number) => STEPS[i].fields.some((k) => errors[k]);
  const stepMissing = (i: number) => missing.some((m) => STEPS[i].fields.includes(m.k));

  if (id && loading && !data) return <Spinner />;
  if (id && data && !data.can.edit) return <Notice tone="warning">This activity can no longer be edited.</Notice>;

  const accept = (arr: File[], exts: string[]) => {
    const bad = arr.filter((x) => !exts.includes(x.name.toLowerCase().split('.').pop() ?? '') || x.size > maxMb * 1024 * 1024);
    if (bad.length) toast('error', `${bad.map((b) => b.name).join(', ')}: not an allowed type or larger than ${maxMb} MB.`);
    return arr.filter((x) => !bad.includes(x)).map((file) => ({ file, url: URL.createObjectURL(file), caption: '' }));
  };

  const uploadStaged = async (activityId: string) => {
    const up = async (category: string, items: Staged[]) => {
      for (const it of items) {
        const fd = new FormData();
        fd.append('files', it.file);
        fd.append('category', category);
        if (it.caption) fd.append('caption', it.caption);
        await api.upload(`/api/files/activity-request/${activityId}`, fd);
      }
    };
    if (cover) {
      await up('COVER', [cover]);
      if (existingCover) await api.del(`/api/files/${existingCover.id}`).catch(() => {});
    }
    await up('PRE_ACTIVITY', venuePics);
    await up('SUPPORTING', docs);
    [...(cover ? [cover] : []), ...venuePics, ...docs].forEach((s) => URL.revokeObjectURL(s.url));
    setCover(null);
    setVenuePics([]);
    setDocs([]);
  };

  const save = async (submit: boolean) => {
    clear();
    setBusy(submit ? 'submit' : 'draft');
    try {
      const course = f.activityType === 'COURSE';
      const body = {
        ...f, expectedParticipants: f.expectedParticipants === '' ? null : Number(f.expectedParticipants), proposedBudget: f.proposedBudget === '' || f.proposedBudget === null ? 0 : Number(f.proposedBudget), submit: false,
        trainingDays: course && f.trainingDays !== '' ? Number(f.trainingDays) : null, deliveryFormat: course ? f.deliveryFormat || null : null, methodology: course ? f.methodology : null,
        proposedTrainers: course ? f.proposedTrainers.filter((t) => t.name.trim()).map((t) => ({ ...t, userId: t.userId || null })) : null,
      };
      const r = id ? await api.put(`/api/daamr/requests/${id}`, body) : await api.post('/api/daamr/requests', body);
      if (!id) {
        setId(r.id);
        nav(`/daamr/requests/${r.id}/edit?step=${step}`, { replace: true });
      }
      await uploadStaged(r.id);
      if (submit) {
        const s = await api.post(`/api/daamr/requests/${r.id}/submit`, {});
        toast('success', `${s.daamrId} submitted for review.`);
        nav(`/daamr/requests/${r.id}`);
        return;
      }
      toast('success', `Draft ${r.daamrId} saved.`);
      reload();
    } catch (e: any) {
      capture(e);
      const fields = Object.keys(e?.fields ?? {});
      const bad = STEPS.findIndex((s) => s.fields.some((k) => fields.includes(k)));
      if (bad >= 0) setStep(bad);
    } finally {
      setBusy(null);
    }
  };

  const removeExisting = async (fileId: string, name: string) => {
    if (!(await confirm({ title: 'Remove file?', message: `“${name}” will be removed from this activity.`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    try {
      await api.del(`/api/files/${fileId}`);
      reload();
    } catch (e: any) {
      toast('error', e.message);
    }
  };

  const nextStep = () => {
    const miss = missing.filter((m) => STEPS[step].fields.includes(m.k));
    if (miss.length) toast('info', `Still needed before submission: ${miss.map((m) => m.label).join(', ')}. You can continue and complete them later.`);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const district = districts.find((d) => d.id === f.districtId)?.name;
  const dept = departments.find((d) => d.id === f.departmentId)?.name;
  const cat = categories.find((c) => c.value === f.category)?.label;

  return (
    <>
      <PageHeader
        title={id ? `Edit activity ${data?.request?.daamrId ?? ''}` : 'Create Activity'}
        subtitle="Complete each step. You can save a draft at any time; the activity enters the review workflow only when you submit it."
        back={id ? `/daamr/requests/${id}` : '/daamr/requests'}
      />
      {returned && lastReturn && (
        <div className="mb-4">
          <Notice tone="warning">
            <strong>Changes requested</strong> by {lastReturn.actorName} ({lastReturn.levelName}) on {fmtDateTime(lastReturn.createdAt)}: “{lastReturn.remarks}”. Update the activity and resubmit — earlier versions and all review decisions are preserved.
          </Notice>
        </div>
      )}

      {/* Stepper */}
      <ol className="no-print mb-5 grid grid-cols-1 gap-2 sm:grid-cols-5" aria-label="Form steps">
        {STEPS.map((s, i) => {
          const done = i < step && !stepMissing(i) && !stepHasError(i);
          const active = i === step;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={active ? 'step' : undefined}
                className={cx('flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                  active ? 'border-brand bg-brand-50 ring-1 ring-brand' : stepHasError(i) ? 'border-red-300 bg-red-50' : 'border-line bg-white hover:border-gray-300')}
              >
                <span className={cx('grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold',
                  active ? 'bg-brand text-white' : done ? 'bg-emerald-600 text-white' : stepHasError(i) ? 'bg-red-600 text-white' : 'bg-gray-100 text-ink-2')}>
                  {done ? <Check className="size-4" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{s.title}</span>
                  <span className="block truncate text-xs text-ink-3">{s.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          <ErrorBox error={formError ? { message: formError } : null} />

          {step === 0 && (
            <Card title="Activity details" subtitle="Describe the activity clearly — reviewers decide on the basis of this information.">
              <div className="mb-4">
                <p className="mb-1.5 text-sm font-medium text-ink-2">Activity type</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Activity type">
                  {[['EVENT', 'Event / activity', 'A one-off or short activity reported with a single execution report.'], ['COURSE', 'Course / training programme', 'Approval sets up a course with a daily session schedule, daily reports and a final course report.']].map(([v, t, d]) => (
                    <button key={v} type="button" role="radio" aria-checked={f.activityType === v} disabled={!!data?.request && data.request.status !== 'DRAFT'} onClick={() => set({ activityType: v })}
                      className={cx('rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-70', f.activityType === v ? 'border-brand bg-brand-50 ring-1 ring-brand' : 'border-line hover:border-gray-300')}>
                      <span className="block text-sm font-semibold text-ink">{t}</span>
                      <span className="block text-xs text-ink-3">{d}</span>
                    </button>
                  ))}
                </div>
              </div>
              <Grid cols={2}>
                <Input label="Activity ID / reference number" value={data?.request?.daamrId ?? 'Generated automatically when first saved'} disabled />
                <Select label="Priority level" value={f.priority} onChange={(e) => set({ priority: e.target.value })} error={errors.priority} options={PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />
                <Input label="Activity title" required wrapClass="sm:col-span-2" value={f.subject} onChange={(e) => set({ subject: e.target.value })} error={errors.subject} maxLength={250} placeholder="e.g. District youth athletics meet" />
                <Select label="Activity category" value={f.category} onChange={(e) => set({ category: e.target.value })} error={errors.category} placeholder="Select…" options={categories.map((c) => ({ value: c.value, label: c.label }))} />
                <Select label="Responsible department / organisation" value={f.departmentId} onChange={(e) => set({ departmentId: e.target.value })} error={errors.departmentId} placeholder="Select…" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
                <Textarea label="Activity description" required wrapClass="sm:col-span-2" rows={5} value={f.description} onChange={(e) => set({ description: e.target.value })} error={errors.description} maxLength={10000} />
                <Textarea label="Activity objectives" required wrapClass="sm:col-span-2" rows={4} value={f.objectives} onChange={(e) => set({ objectives: e.target.value })} error={errors.objectives} maxLength={5000} placeholder="One objective per line" />
                <Input label="Target audience" value={f.targetAudience} onChange={(e) => set({ targetAudience: e.target.value })} error={errors.targetAudience} maxLength={500} placeholder="e.g. College students aged 17–25" />
                <Input label="Expected number of youth participants" type="number" min={0} step={1} inputMode="numeric" value={f.expectedParticipants} onChange={(e) => set({ expectedParticipants: e.target.value.replace(/[^\d]/g, '') })} error={errors.expectedParticipants} />
              </Grid>
            </Card>
          )}
          {step === 0 && f.activityType === 'COURSE' && (
            <Card title="Course details" subtitle="On final approval the system creates the course with one daily session per training day, skipping configured non-training days and holidays.">
              <Grid cols={2}>
                <Input label="Number of training days" required type="number" min={1} max={365} value={f.trainingDays} onChange={(e) => set({ trainingDays: e.target.value.replace(/[^\d]/g, '') })} error={errors.trainingDays} hint="One daily session is scheduled per training day" />
                <Select label="Delivery format" value={f.deliveryFormat} onChange={(e) => set({ deliveryFormat: e.target.value })} error={errors.deliveryFormat} placeholder="Select…" options={[{ value: 'IN_PERSON', label: 'In person' }, { value: 'ONLINE', label: 'Online' }, { value: 'BLENDED', label: 'Blended' }]} />
                <Textarea label="Training methodology" wrapClass="sm:col-span-2" rows={3} value={f.methodology} onChange={(e) => set({ methodology: e.target.value })} error={errors.methodology} placeholder="e.g. Lectures, guided labs, group projects and a capstone presentation" />
              </Grid>
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-ink-2">Proposed trainers <span className="text-red-600">*</span></p>
                  <Button size="sm" variant="secondary" onClick={() => set({ proposedTrainers: [...f.proposedTrainers, { name: '', designation: '', expertise: '', userId: '' }] })}>Add trainer</Button>
                </div>
                {errors.proposedTrainers && <p className="mb-2 text-xs text-red-600">{errors.proposedTrainers}</p>}
                {f.proposedTrainers.length === 0 && <p className="text-sm text-ink-3">No trainers added yet.</p>}
                <div className="space-y-2">
                  {f.proposedTrainers.map((t, i) => {
                    const upd = (p: Partial<typeof t>) => set({ proposedTrainers: f.proposedTrainers.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                    return (
                      <div key={i} className="grid grid-cols-1 items-end gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1.2fr_1fr_1.3fr_1.2fr_auto]">
                        <Input label="Name" required value={t.name} onChange={(e) => upd({ name: e.target.value })} error={errors[`proposedTrainers.${i}.name`]} />
                        <Input label="Designation" value={t.designation} onChange={(e) => upd({ designation: e.target.value })} />
                        <Input label="Expertise" value={t.expertise} onChange={(e) => upd({ expertise: e.target.value })} />
                        <Select label="User account (optional)" value={t.userId} onChange={(e) => { const u = staffDirectory.find((x) => x.id === e.target.value); upd({ userId: e.target.value, ...(u && !t.name ? { name: u.name, designation: u.designation ?? '' } : {}) }); }} placeholder="External trainer" options={staffDirectory.map((u) => ({ value: u.id, label: u.name }))} hint="Lets the trainer write daily reports" />
                        <Button variant="ghost" size="sm" aria-label="Remove trainer" onClick={() => set({ proposedTrainers: f.proposedTrainers.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          )}

          {step === 1 && (
            <>
              <Card title="Schedule">
                <Grid cols={2}>
                  <Input label="Start date" type="date" required value={f.startDate} onChange={(e) => set({ startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate })} error={errors.startDate} />
                  <Input label="Start time" type="time" value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} error={errors.startTime} />
                  <Input label="End date" type="date" required min={f.startDate} value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} error={errors.endDate} />
                  <Input label="End time" type="time" value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} error={errors.endTime} />
                </Grid>
              </Card>
              <Card title="Location and venue">
                <Grid cols={2}>
                  <Input label="Province" value={f.province} onChange={(e) => set({ province: e.target.value })} error={errors.province} />
                  <Select label="District / HQ" required value={f.districtId} disabled={returned} onChange={(e) => set({ districtId: e.target.value })} error={errors.districtId} placeholder="Select…" options={districts.map((d) => ({ value: d.id, label: d.name }))} hint={returned ? 'Locked after submission' : 'Decides which district reviewers receive the activity'} />
                  <Input label="Tehsil" value={f.tehsil} onChange={(e) => set({ tehsil: e.target.value })} error={errors.tehsil} />
                  <Input label="Location / area" required value={f.area} onChange={(e) => set({ area: e.target.value })} error={errors.area} />
                  <Input label="Venue name" required value={f.venue} onChange={(e) => set({ venue: e.target.value })} error={errors.venue} />
                  <Input label="Complete venue address" required value={f.venueAddress} onChange={(e) => set({ venueAddress: e.target.value })} error={errors.venueAddress} />
                </Grid>
              </Card>
            </>
          )}

          {step === 2 && (
            <>
              <Card title="Activity cover image" subtitle="Shown at the top of the activity page and in reports.">
                <div className="grid gap-4 sm:grid-cols-[240px_1fr] sm:items-start">
                  <div className="aspect-[4/3] overflow-hidden rounded-xl border border-line bg-gray-50">
                    {cover ? <img src={cover.url} alt="New cover preview" className="size-full object-cover" />
                      : existingCover ? <img src={fileUrl(existingCover.id)} alt="Current cover" className="size-full object-cover" />
                      : <div className="grid size-full place-items-center text-xs text-ink-3">No cover image</div>}
                  </div>
                  <div className="space-y-2 text-sm">
                    <PickButton label={cover || existingCover ? 'Choose a different image' : 'Choose cover image'} accept="image/jpeg,image/png,image/webp" onPick={(l) => { const [x] = accept(l, PHOTO_EXT); if (x) { if (cover) URL.revokeObjectURL(cover.url); setCover(x); } }} icon={<ImagePlus className="size-4" />} />
                    {cover && <p className="text-ink-2">New image selected: <strong>{cover.file.name}</strong> ({fmtSize(cover.file.size)}) — uploaded when you save. <button className="text-red-700 underline" onClick={() => { URL.revokeObjectURL(cover.url); setCover(null); }}>Discard</button></p>}
                    <p className="text-xs text-ink-3">JPG, PNG or WebP · max {maxMb} MB. Landscape images look best.</p>
                  </div>
                </div>
              </Card>

              <Card title="Venue images / gallery" subtitle="Pictures of the venue before the activity. Previews are shown before saving." actions={<PickButton label="Add images" multiple accept="image/jpeg,image/png,image/webp" onPick={(l) => { const add = accept(l, PHOTO_EXT); setVenuePics((x) => [...x, ...add].slice(0, 20)); }} icon={<ImagePlus className="size-4" />} />}>
                {existingVenue.length === 0 && venuePics.length === 0 ? (
                  <p className="text-sm text-ink-3">No venue images yet.</p>
                ) : (
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                    {existingVenue.map((p: any) => (
                      <li key={p.id} className="overflow-hidden rounded-xl border border-line bg-white">
                        <img src={fileUrl(p.id)} alt={p.caption ?? p.originalName} className="aspect-[4/3] w-full object-cover" />
                        <div className="flex items-center justify-between gap-2 p-2 text-xs">
                          <span className="truncate text-ink-2">{p.caption ?? p.originalName}</span>
                          <button onClick={() => removeExisting(p.id, p.originalName)} aria-label={`Remove ${p.originalName}`} className="rounded p-1 text-ink-3 hover:bg-red-50 hover:text-red-700"><Trash2 className="size-3.5" /></button>
                        </div>
                      </li>
                    ))}
                    {venuePics.map((p, i) => (
                      <li key={p.url} className="overflow-hidden rounded-xl border-2 border-dashed border-brand/50 bg-white">
                        <div className="relative">
                          <img src={p.url} alt={`Preview of ${p.file.name}`} className="aspect-[4/3] w-full object-cover" />
                          <span className="absolute left-1.5 top-1.5"><Badge tone="blue" label="Not yet saved" /></span>
                          <button onClick={() => { URL.revokeObjectURL(p.url); setVenuePics((x) => x.filter((_, j) => j !== i)); }} aria-label={`Discard ${p.file.name}`} className="absolute right-1.5 top-1.5 rounded-full bg-white/90 p-1 shadow hover:bg-white"><X className="size-3.5" /></button>
                        </div>
                        <input className="w-full border-t border-line px-2 py-1.5 text-xs focus:outline-none" placeholder="Caption (optional)" value={p.caption} maxLength={300} onChange={(e) => setVenuePics((x) => x.map((y, j) => (j === i ? { ...y, caption: e.target.value } : y)))} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Supporting documents and attachments" subtitle="Concept note, approvals, letters, budgets…" actions={<PickButton label="Add documents" multiple accept="application/pdf,.pdf,.docx,.xlsx,image/jpeg,image/png,image/webp" onPick={(l) => { const add = accept(l, DOC_EXT); setDocs((x) => [...x, ...add].slice(0, 20)); }} icon={<Upload className="size-4" />} />}>
                {existingDocs.length === 0 && docs.length === 0 ? <p className="text-sm text-ink-3">No documents attached.</p> : (
                  <ul className="divide-y divide-line rounded-xl border border-line">
                    {existingDocs.map((d: any) => (
                      <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <FileText className="size-4 shrink-0 text-ink-3" />
                        <a href={fileUrl(d.id, true)} className="min-w-0 flex-1 truncate text-brand hover:underline">{d.originalName}</a>
                        <span className="text-xs text-ink-3">{fmtSize(d.size)}</span>
                        <button onClick={() => removeExisting(d.id, d.originalName)} aria-label={`Remove ${d.originalName}`} className="rounded p-1 text-ink-3 hover:bg-red-50 hover:text-red-700"><Trash2 className="size-4" /></button>
                      </li>
                    ))}
                    {docs.map((d, i) => (
                      <li key={d.url} className="flex items-center gap-3 bg-blue-50/40 px-3 py-2 text-sm">
                        <FileText className="size-4 shrink-0 text-ink-3" />
                        <span className="min-w-0 flex-1 truncate">{d.file.name}</span>
                        <Badge tone="blue" label="Not yet saved" />
                        <span className="text-xs text-ink-3">{fmtSize(d.file.size)}</span>
                        <button onClick={() => { URL.revokeObjectURL(d.url); setDocs((x) => x.filter((_, j) => j !== i)); }} aria-label={`Discard ${d.file.name}`} className="rounded p-1 text-ink-3 hover:bg-gray-100"><X className="size-4" /></button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-ink-3">PDF, DOCX, XLSX or images · max {maxMb} MB each. Files are checked by content on the server and stored privately.</p>
              </Card>
            </>
          )}

          {step === 3 && (
            <Card title="Budget and notifications">
              <Grid cols={2}>
                <Input label="Estimated budget (PKR, optional)" type="number" min={0} step="0.01" inputMode="decimal" value={f.proposedBudget ?? ''} onChange={(e) => set({ proposedBudget: e.target.value })} error={errors.proposedBudget} />
                <Input label="Notification email" type="email" required value={f.requesteeEmail} onChange={(e) => set({ requesteeEmail: e.target.value })} error={errors.requesteeEmail} hint="Receives status updates for this activity" />
                <Input label="Activity created by" value={data?.request?.requester?.name ?? me?.name ?? ''} disabled />
                <Input label="Creation date" value={data?.request ? fmtDateTime(data.request.createdAt) : 'Recorded when first saved'} disabled />
                <Input label="Initial status" value={data?.request ? humanize(data.request.lifecycle) : 'Draft'} disabled hint="Becomes “Under Review” when submitted" />
              </Grid>
            </Card>
          )}

          {step === 4 && (
            <>
              {missing.length > 0 ? (
                <Notice tone="warning">
                  Complete these required fields before submitting: {missing.map((m, i) => (
                    <span key={m.k}>{i > 0 && ', '}<button className="font-medium underline" onClick={() => setStep(STEPS.findIndex((s) => s.fields.includes(m.k)))}>{m.label}</button></span>
                  ))}.
                </Notice>
              ) : (
                <Notice tone="success">All required information is complete. Submitting sends the activity to the first reviewer in the configured workflow and notifies them.</Notice>
              )}
              <Card title="Summary">
                <SummaryRow label="Activity type" value={f.activityType === 'COURSE' ? `Course — ${f.trainingDays || '?'} training day(s), ${f.proposedTrainers.filter((t) => t.name.trim()).map((t) => t.name).join(', ') || 'no trainers yet'}` : 'Event / activity'} step={0} go={setStep} />
                <SummaryRow label="Title" value={f.subject} step={0} go={setStep} />
                <SummaryRow label="Category · Priority" value={`${cat ?? '—'} · ${humanize(f.priority)}`} step={0} go={setStep} />
                <SummaryRow label="Department" value={dept} step={0} go={setStep} />
                <SummaryRow label="Description" value={f.description} step={0} go={setStep} long />
                <SummaryRow label="Objectives" value={f.objectives} step={0} go={setStep} long />
                <SummaryRow label="Target audience" value={[f.targetAudience, f.expectedParticipants ? `${f.expectedParticipants} expected participants` : ''].filter(Boolean).join(' · ')} step={0} go={setStep} />
                <SummaryRow label="Dates" value={`${fmtDate(f.startDate)}${f.startTime ? ` ${f.startTime}` : ''} – ${fmtDate(f.endDate)}${f.endTime ? ` ${f.endTime}` : ''}`} step={1} go={setStep} />
                <SummaryRow label="Venue" value={[f.venue, f.venueAddress, f.area, f.tehsil, district, f.province].filter(Boolean).join(', ')} step={1} go={setStep} />
                <SummaryRow label="Images & documents" value={`${existingCover || cover ? 'Cover image' : 'No cover image'} · ${existingVenue.length + venuePics.length} venue image(s) · ${existingDocs.length + docs.length} document(s)`} step={2} go={setStep} />
                <SummaryRow label="Estimated budget" value={f.proposedBudget !== '' && f.proposedBudget !== null ? fmtMoney(Number(f.proposedBudget)) : 'Not specified'} step={3} go={setStep} />
                <SummaryRow label="Notification email" value={f.requesteeEmail} step={3} go={setStep} />
              </Card>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" disabled={step === 0} onClick={() => setStep((s) => s - 1)} icon={<ArrowLeft className="size-4" />}>Back</Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={nextStep}>Next: {STEPS[step + 1].title} <ArrowRight className="ml-1 size-4" /></Button>
            ) : (
              <Button loading={busy === 'submit'} disabled={missing.length > 0} onClick={() => save(true)} icon={<Send className="size-4" />}>{returned ? 'Resubmit for review' : 'Submit for review'}</Button>
            )}
          </div>
        </div>

        <MobileActions>
          <Button variant="secondary" loading={busy === 'draft'} onClick={() => save(false)} icon={<Save className="size-4" />}>Save draft</Button>
          {step < STEPS.length - 1
            ? <Button onClick={nextStep}>Next <ArrowRight className="ml-1 size-4" /></Button>
            : <Button loading={busy === 'submit'} disabled={missing.length > 0} onClick={() => save(true)} icon={<Send className="size-4" />}>Submit</Button>}
        </MobileActions>
        <aside className="hidden space-y-4 lg:block">
          <Card title="Save your work" className="lg:sticky lg:top-20">
            <div className="space-y-2">
              <Button variant="secondary" className="w-full" loading={busy === 'draft'} onClick={() => save(false)} icon={<Save className="size-4" />}>Save draft</Button>
              {(cover || venuePics.length > 0 || docs.length > 0) && <p className="text-xs text-blue-800">{(cover ? 1 : 0) + venuePics.length + docs.length} selected file(s) will be uploaded when you save.</p>}
              <p className="text-xs text-ink-3">Step {step + 1} of {STEPS.length}. Required fields are marked <span className="text-red-600">*</span>. {missing.length ? `${missing.length} required field(s) still empty.` : 'All required fields are filled.'}</p>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}

function PickButton({ label, accept, multiple, onPick, icon }: { label: string; accept: string; multiple?: boolean; onPick: (files: File[]) => void; icon: ReactNode }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button type="button" variant="secondary" size="sm" icon={icon} onClick={() => ref.current?.click()}>{label}</Button>
      <input ref={ref} type="file" className="hidden" accept={accept} multiple={multiple} onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; onPick(files); }} />
    </>
  );
}

function SummaryRow({ label, value, step, go, long }: { label: string; value?: string | null; step: number; go: (n: number) => void; long?: boolean }) {
  return (
    <div className="flex gap-3 border-b border-line py-2.5 text-sm last:border-0">
      <span className="w-40 shrink-0 text-ink-3">{label}</span>
      <span className={cx('min-w-0 flex-1 text-ink', long && 'whitespace-pre-line')}>{value || <span className="text-ink-3">—</span>}</span>
      <button className="shrink-0 text-xs font-medium text-brand hover:underline" onClick={() => go(step)}>Edit</button>
    </div>
  );
}
