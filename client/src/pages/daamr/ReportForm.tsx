import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Save, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDistricts, useLookups } from '../../lib/hooks';
import { fmtMoney, humanize, toISODate, todayISO } from '../../lib/format';
import { Button, Card, ErrorBox, Grid, Input, Notice, PageHeader, Select, Spinner, Textarea, useFormErrors, useToast } from '../../components/ui';
import { AttachmentList, Gallery, Uploader } from '../../components/Files';
import { MobileActions, SectionNav } from '../../components/FormKit';

export const DEMOGRAPHICS = ['male', 'female', 'minority', 'madaris', 'transgender', 'disabled', 'juvenile'] as const;
export const PLATFORMS = [
  { value: 'FACEBOOK', label: 'Facebook' }, { value: 'NEWSPAPER', label: 'Newspaper' }, { value: 'X', label: 'X (Twitter)' },
  { value: 'TIKTOK', label: 'TikTok' }, { value: 'INSTAGRAM', label: 'Instagram' }, { value: 'OTHER', label: 'Any other link' },
];
const ACTIVITY_STATUS = ['PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'POSTPONED', 'CANCELLED'];

const blank = () => ({
  requestId: '', activityDate: todayISO(), districtId: '', departmentId: '', activityName: '', category: '', venue: '', description: '', responsibleOfficer: '', activityStatus: 'COMPLETED', remarks: '',
  achievements: '', challenges: '', recommendations: '', expenseDetails: '',
  participants: Object.fromEntries(DEMOGRAPHICS.map((d) => [d, ''])) as Record<string, any>,
  budget: { allocated: '' as any, utilized: '' as any, fundSource: '', remarks: '' },
  links: Object.fromEntries(PLATFORMS.map((p) => [p.value, ''])) as Record<string, string>,
});

export default function ReportForm() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const requestId = sp.get('requestId');
  const { me, settings } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const districts = useDistricts();
  const categories = useLookups('ACTIVITY_CATEGORY');
  const departments = useCached<any[]>('/api/admin/departments') ?? [];
  const existing = useApi(id ? `/api/daamr/reports/${id}` : null);
  const linked = useApi(!id && requestId ? `/api/daamr/requests/${requestId}` : null);
  const [f, setF] = useState(blank());
  const [busy, setBusy] = useState<string | null>(null);
  const { errors, formError, capture, clear } = useFormErrors();
  const set = (p: Partial<ReturnType<typeof blank>>) => setF((x) => ({ ...x, ...p }));

  useEffect(() => {
    if (!id && me && !requestId) set({ districtId: me.districtId ?? '', responsibleOfficer: me.name });
  }, [id, me, requestId]);
  useEffect(() => {
    const rq = linked.data?.request;
    if (rq) set({ requestId: rq.id, districtId: rq.districtId, departmentId: rq.departmentId ?? '', activityName: rq.subject, category: rq.category ?? '', venue: rq.venueAddress ? `${rq.venue}, ${rq.venueAddress}` : rq.venue, description: '', activityDate: toISODate(rq.startDate), responsibleOfficer: linked.data.leadOfficer?.name ?? me?.name ?? rq.requester.name, budget: { allocated: rq.proposedBudget ?? '', utilized: '', fundSource: '', remarks: '' } });
  }, [linked.data]);
  useEffect(() => {
    const r = existing.data?.report;
    if (!r) return;
    setF({
      requestId: r.requestId ?? '', activityDate: toISODate(r.activityDate), districtId: r.districtId, departmentId: r.departmentId ?? '', activityName: r.activityName, category: r.category, venue: r.venue,
      description: r.description, responsibleOfficer: r.responsibleOfficer, activityStatus: r.activityStatus, remarks: r.remarks ?? '',
      achievements: r.achievements ?? '', challenges: r.challenges ?? '', recommendations: r.recommendations ?? '', expenseDetails: r.expenseDetails ?? '',
      participants: Object.fromEntries(DEMOGRAPHICS.map((d) => [d, r.participants?.[d] ?? 0])),
      budget: { allocated: r.budget?.allocated ?? 0, utilized: r.budget?.utilized ?? 0, fundSource: r.budget?.fundSource ?? '', remarks: r.budget?.remarks ?? '' },
      links: Object.fromEntries(PLATFORMS.map((p) => [p.value, r.mediaLinks.find((m: any) => m.platform === p.value)?.url ?? ''])),
    });
  }, [existing.data]);

  const totalFields = settings?.participantTotalFields ?? ['male', 'female', 'transgender'];
  const total = useMemo(() => totalFields.reduce((a, k) => a + (Number(f.participants[k]) || 0), 0), [f.participants, totalFields]);
  const remaining = (Number(f.budget.allocated) || 0) - (Number(f.budget.utilized) || 0);
  const linkedReq = existing.data?.report?.request ?? linked.data?.request;

  if ((id && existing.loading && !existing.data) || (requestId && linked.loading && !linked.data)) return <Spinner />;
  if (id && existing.data && !existing.data.can.edit) return <Notice tone="warning">This report can no longer be edited.</Notice>;

  const save = async (submit: boolean) => {
    clear();
    setBusy(submit ? 'submit' : 'draft');
    try {
      const body = {
        ...f,
        requestId: f.requestId || null,
        participants: Object.fromEntries(DEMOGRAPHICS.map((d) => [d, f.participants[d] === '' ? 0 : Number(f.participants[d])])),
        budget: { ...f.budget, allocated: Number(f.budget.allocated) || 0, utilized: Number(f.budget.utilized) || 0 },
        mediaLinks: PLATFORMS.filter((p) => f.links[p.value]?.trim()).map((p) => ({ platform: p.value, url: f.links[p.value].trim() })),
        submit,
      };
      const r = id ? await api.put(`/api/daamr/reports/${id}`, body) : await api.post('/api/daamr/reports', body);
      toast('success', submit ? 'Report submitted for verification.' : 'Report saved.');
      nav(submit ? `/daamr/reports/${r.id}` : `/daamr/reports/${r.id}/edit`, { replace: true });
      if (id && !submit) existing.reload();
    } catch (e) {
      capture(e);
    } finally {
      setBusy(null);
    }
  };

  const files = existing.data?.report?.files ?? [];
  const lastReturn = existing.data?.verificationTimeline?.history?.filter((h: any) => h.action === 'RETURNED').at(-1);
  return (
    <>
      <PageHeader title={id ? `Edit execution report ${existing.data?.report?.reportNo ?? ''}` : linkedReq ? 'Activity Execution Report' : 'Activity Reporting Form'} subtitle={linkedReq ? `Execution report for ${linkedReq.daamrId}. The activity is marked Completed only after this report passes verification.` : 'Standalone activity report (a new DAAMR ID is issued).'} back={id ? `/daamr/reports/${id}` : '/daamr/reports'} />
      {existing.data?.report?.reportStatus === 'RETURNED' && lastReturn && <div className="mb-4"><Notice tone="warning"><strong>Returned for correction</strong> by {lastReturn.actorName}: “{lastReturn.remarks}”</Notice></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <ErrorBox error={formError ? { message: formError } : null} />
          <Card id="er-info" title="Activity information">
            <Grid cols={2}>
              <Input label="DAAMR ID" value={existing.data?.report?.daamrId ?? linkedReq?.daamrId ?? 'Generated automatically'} disabled />
              <Input label="Actual activity date" type="date" required value={f.activityDate} onChange={(e) => set({ activityDate: e.target.value })} error={errors.activityDate} />
              <Select label="District / HQ" required disabled={!!f.requestId} value={f.districtId} onChange={(e) => set({ districtId: e.target.value })} error={errors.districtId} placeholder="Select…" options={districts.map((d) => ({ value: d.id, label: d.name }))} />
              <Select label="Department / Headquarters" value={f.departmentId} onChange={(e) => set({ departmentId: e.target.value })} placeholder="—" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
              <Input label="Activity name" required wrapClass="sm:col-span-2" value={f.activityName} onChange={(e) => set({ activityName: e.target.value })} error={errors.activityName} />
              <Select label="Activity category" required value={f.category} onChange={(e) => set({ category: e.target.value })} error={errors.category} placeholder="Select…" options={categories.map((c) => ({ value: c.value, label: c.label }))} />
              <Select label="Activity status" required value={f.activityStatus} onChange={(e) => set({ activityStatus: e.target.value })} options={ACTIVITY_STATUS.map((s) => ({ value: s, label: humanize(s) }))} />
              <Input label="Actual venue" required value={f.venue} onChange={(e) => set({ venue: e.target.value })} error={errors.venue} />
              <Input label="Responsible officer" required value={f.responsibleOfficer} onChange={(e) => set({ responsibleOfficer: e.target.value })} error={errors.responsibleOfficer} />
              <Textarea label="Activities conducted" required wrapClass="sm:col-span-2" rows={4} placeholder="What was done, in what sequence, and by whom" value={f.description} onChange={(e) => set({ description: e.target.value })} error={errors.description} />
            </Grid>
          </Card>

          <Card id="er-outcomes" title="Achievements, challenges and recommendations">
            <Grid cols={1}>
              <Textarea label="Achievements and outcomes" rows={3} value={f.achievements} onChange={(e) => set({ achievements: e.target.value })} error={errors.achievements} placeholder="Results achieved against the activity objectives" />
              <Textarea label="Challenges faced" rows={3} value={f.challenges} onChange={(e) => set({ challenges: e.target.value })} error={errors.challenges} />
              <Textarea label="Recommendations" rows={3} value={f.recommendations} onChange={(e) => set({ recommendations: e.target.value })} error={errors.recommendations} />
            </Grid>
          </Card>

          <Card id="er-participants" title="Participant demographics" subtitle={`Total is calculated automatically as ${totalFields.map(humanize).join(' + ')} (configurable by the administrator to avoid double-counting overlapping categories).`}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {DEMOGRAPHICS.map((d) => (
                <Input key={d} label={humanize(d)} type="number" min={0} step={1} inputMode="numeric" value={f.participants[d]} error={errors[`participants.${d}`]}
                  onChange={(e) => set({ participants: { ...f.participants, [d]: e.target.value.replace(/[^\d]/g, '') } })} hint={totalFields.includes(d) ? 'Counted in total' : 'Sub-category'} />
              ))}
              <div className="rounded-lg bg-brand-50 p-3">
                <p className="text-xs font-medium uppercase text-brand">Total participants</p>
                <p className="tabular text-2xl font-semibold text-brand-800">{total.toLocaleString()}</p>
              </div>
            </div>
          </Card>

          <Card id="er-budget" title="Budget and funding">
            <Grid cols={3}>
              <Input label="Budget allocated (PKR)" type="number" min={0} step="0.01" value={f.budget.allocated} onChange={(e) => set({ budget: { ...f.budget, allocated: e.target.value } })} error={errors['budget.allocated']} />
              <Input label="Budget utilized (PKR)" type="number" min={0} step="0.01" value={f.budget.utilized} onChange={(e) => set({ budget: { ...f.budget, utilized: e.target.value } })} error={errors['budget.utilized']} />
              <Input label="Remaining budget" value={fmtMoney(remaining)} disabled />
              <Input label="Fund source" value={f.budget.fundSource} onChange={(e) => set({ budget: { ...f.budget, fundSource: e.target.value } })} />
              <Textarea label="Budget remarks" wrapClass="sm:col-span-2" rows={2} value={f.budget.remarks} onChange={(e) => set({ budget: { ...f.budget, remarks: e.target.value } })} />
              <Textarea label="Expense details" wrapClass="sm:col-span-3" rows={3} value={f.expenseDetails} onChange={(e) => set({ expenseDetails: e.target.value })} error={errors.expenseDetails} placeholder="Item-wise expenditure, e.g. Refreshments — PKR 50,000; Prizes — PKR 60,000" hint="Visible only to users authorised to view expenses." />
            </Grid>
            {remaining < 0 && <div className="mt-3"><Notice tone="warning">Utilized budget exceeds the allocated budget by {fmtMoney(-remaining)}. Please explain in the budget remarks.</Notice></div>}
          </Card>

          <Card id="er-media" title="Media coverage and publicity links">
            <Grid cols={2}>
              {PLATFORMS.map((p) => (
                <Input key={p.value} label={p.label} type="url" placeholder="https://…" value={f.links[p.value]} onChange={(e) => set({ links: { ...f.links, [p.value]: e.target.value } })}
                  error={(() => { const i = PLATFORMS.filter((x) => f.links[x.value]?.trim()).findIndex((x) => x.value === p.value); return i >= 0 ? errors[`mediaLinks.${i}.url`] : undefined; })()} />
              ))}
            </Grid>
          </Card>

          <Card id="er-remarks" title="Staff remarks">
            <Textarea label="Remarks" rows={3} value={f.remarks} onChange={(e) => set({ remarks: e.target.value })} />
          </Card>

          <Card id="er-photos" title="Photographs, attendance sheet and supporting documents">
            {id ? (
              <div className="space-y-5">
                <Uploader target="activity-report" entityId={id} categories={[{ value: 'EVENT', label: 'Event photograph' }, { value: 'PRE_ACTIVITY', label: 'Before (venue before the activity)' }, { value: 'POST_ACTIVITY', label: 'After (venue after the activity)' }]} withGeo onUploaded={existing.reload} />
                {[['PRE_ACTIVITY', 'Before'], ['EVENT', 'Event photographs'], ['POST_ACTIVITY', 'After']].map(([c, label]) => {
                  const list = files.filter((x: any) => x.kind === 'PHOTO' && x.category === c);
                  return list.length ? <div key={c}><p className="mb-2 text-sm font-medium">{label}</p><Gallery photos={list} onChanged={existing.reload} canRemove={(p) => p.uploadedBy.id === me?.id} /></div> : null;
                })}
                <div className="border-t border-line pt-4">
                  <p className="mb-2 text-sm font-medium">Attendance sheet</p>
                  <Uploader target="activity-report" entityId={id} kind="pdfimage" compact categories={[{ value: 'ATTENDANCE', label: 'Attendance sheet' }]} onUploaded={existing.reload} />
                  <div className="mt-3"><AttachmentList files={files.filter((x: any) => x.category === 'ATTENDANCE')} onChanged={existing.reload} canRemove={(p) => p.uploadedBy.id === me?.id} /></div>
                </div>
                <div className="border-t border-line pt-4">
                  <p className="mb-2 text-sm font-medium">Supporting documents</p>
                  <Uploader target="activity-report" entityId={id} kind="doc" compact categories={[{ value: 'SUPPORTING', label: 'Supporting document' }]} onUploaded={existing.reload} />
                  <div className="mt-3"><AttachmentList files={files.filter((x: any) => x.kind === 'DOCUMENT' && !['ATTENDANCE', 'REVIEW_EVIDENCE'].includes(x.category))} onChanged={existing.reload} canRemove={(p) => p.uploadedBy.id === me?.id} /></div>
                </div>
              </div>
            ) : (
              <Notice>Save the report as a draft to attach before/after and event photographs, the attendance sheet and supporting documents.</Notice>
            )}
          </Card>
        </div>
        <div>
          <div className="hidden lg:sticky lg:top-20 lg:block lg:space-y-4">
          <Card title="Actions">
            <div className="space-y-2">
              <Button variant="secondary" className="w-full" loading={busy === 'draft'} onClick={() => save(false)} icon={<Save className="size-4" />}>Save</Button>
              <Button className="w-full" loading={busy === 'submit'} onClick={() => save(true)} icon={<Send className="size-4" />}>Submit final report for review</Button>
              <p className="pt-2 text-xs text-ink-3">Submitted reports are verified by the designated reviewer, who may mark them Verified or return them for correction.</p>
            </div>
          </Card>
          <SectionNav sections={[
            { id: 'er-info', label: 'Activity information', error: Object.keys(errors).some((k) => ['activityDate', 'districtId', 'activityName', 'category', 'venue', 'responsibleOfficer', 'description'].includes(k)) },
            { id: 'er-outcomes', label: 'Outcomes' },
            { id: 'er-participants', label: 'Participants', error: Object.keys(errors).some((k) => k.startsWith('participants')) },
            { id: 'er-budget', label: 'Budget and expenses', error: Object.keys(errors).some((k) => k.startsWith('budget')) },
            { id: 'er-media', label: 'Media links', error: Object.keys(errors).some((k) => k.startsWith('mediaLinks')) },
            { id: 'er-remarks', label: 'Staff remarks' },
            { id: 'er-photos', label: 'Photos & documents' },
          ]} />
          </div>
          <MobileActions>
            <Button variant="secondary" loading={busy === 'draft'} onClick={() => save(false)} icon={<Save className="size-4" />}>Save</Button>
            <Button loading={busy === 'submit'} onClick={() => save(true)} icon={<Send className="size-4" />}>Submit</Button>
          </MobileActions>
        </div>
      </div>
    </>
  );
}
