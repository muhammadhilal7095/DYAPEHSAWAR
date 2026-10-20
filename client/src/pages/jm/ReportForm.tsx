import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Plus, Save, Send, Trash2, CopyPlus } from 'lucide-react';
import { api } from '../../lib/api';
import { SectionNav } from '../../components/FormKit';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useLookups } from '../../lib/hooks';
import { addDays, fmtDate, humanize, toISODate, todayISO } from '../../lib/format';
import { Button, Card, Checkbox, ErrorBox, Grid, Input, Notice, PageHeader, Select, Spinner, Textarea, useFormErrors, useToast, cx } from '../../components/ui';
import { AttachmentList, Gallery, Uploader } from '../../components/Files';

const SEV = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((v) => ({ value: v, label: humanize(v) }));
const ISSUE_ST = ['OPEN', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((v) => ({ value: v, label: humanize(v) }));
const ACT_ST = ['OPEN', 'IN_PROGRESS', 'COMPLETED'].map((v) => ({ value: v, label: humanize(v) }));
const RISK_ST = ['OPEN', 'MONITORING', 'MITIGATED', 'CLOSED'].map((v) => ({ value: v, label: humanize(v) }));
const MIT_ST = ['PLANNED', 'IN_PROGRESS', 'IMPLEMENTED', 'NOT_EFFECTIVE'].map((v) => ({ value: v, label: humanize(v) }));
const CHECK = ['COMPLIANT', 'PARTIAL', 'NON_COMPLIANT', 'NOT_APPLICABLE', 'PENDING'].map((v) => ({ value: v, label: humanize(v) }));
const PHOTO_CATS = ['BEFORE_WORK', 'WORK_IN_PROGRESS', 'COMPLETED_WORK', 'DEFECT_EVIDENCE', 'OTHER'].map((v) => ({ value: v, label: humanize(v) }));

const SECTIONS: [string, string][] = [
  ['a', 'A. Report identification'], ['b', 'B. Current status'], ['c', 'C. Activities completed'], ['d', 'D. Activities planned'], ['e', 'E. Quality of work'],
  ['f', 'F. Compliance'], ['g', 'G. Remarks'], ['h', 'H. Issues'], ['i', 'I. Impact'], ['j', 'J. Actions'], ['k', 'K/L. Risks & mitigation'],
  ['m', 'M. Geo-tagged photos'], ['n', 'N. Assessment'], ['o', 'O. Certification'],
];

const uid = () => Math.random().toString(36).slice(2, 10);
const blank = (): any => ({
  assetId: '', periodFrom: addDays(todayISO(), -30), periodTo: todayISO(), inspectionDate: todayISO(), inspectionType: 'ROUTINE',
  projectStatus: 'IN_PROGRESS', currentProgress: '', previousProgress: '', plannedProgress: '', actualCompletion: '', expectedCompletionDate: '', revisedCompletionDate: '', delayDays: '',
  completedSummary: '', plannedSummary: '', expectedNextProgress: '', completed: [], planned: [],
  qualityRating: 'NOT_ASSESSED', qualityRemarks: '', defectsIdentified: '', workmanshipObservations: '', materialObservations: '', qualityCorrectiveActions: '', qualityCorrectiveDeadline: '',
  complianceRating: 'PENDING_VERIFICATION', applicableStandards: '', complianceObservations: '', deviations: '', complianceCorrective: '', complianceVerification: '', complianceChecklist: [],
  generalRemarks: '', officerRemarks: '', additionalObs: '', issues: [], impactDescription: '', scheduleImpact: '', qualityImpact: '', costImpact: '', operationalImpact: '', impactDelayDays: '', impactSeverity: '',
  actions: [], risks: [], overallAssessment: '', keyFindings: '', recommendedMeasures: '', priorityActions: '', recommendedDepartment: '', recommendedCompletionDate: '', followUpRequired: false, nextInspectionDate: '', certConfirmed: false,
});
const d = (v: any) => (v ? toISODate(v) : '');
const n = (v: any) => (v === null || v === undefined ? '' : String(v));

function fromReport(r: any) {
  const f: any = blank();
  for (const k of Object.keys(f)) if (k in r && !Array.isArray(f[k])) f[k] = typeof f[k] === 'boolean' ? !!r[k] : r[k] ?? '';
  for (const k of ['periodFrom', 'periodTo', 'inspectionDate', 'expectedCompletionDate', 'revisedCompletionDate', 'qualityCorrectiveDeadline', 'recommendedCompletionDate', 'nextInspectionDate']) f[k] = d(r[k]);
  for (const k of ['currentProgress', 'previousProgress', 'plannedProgress', 'actualCompletion', 'delayDays', 'expectedNextProgress', 'impactDelayDays']) f[k] = n(r[k]);
  f.completed = r.completed.map((c: any) => ({ ...c, completionDate: d(c.completionDate), quantity: c.quantity ?? '' }));
  f.planned = r.planned.map((p: any) => ({ ...p, expectedDate: d(p.expectedDate), milestone: p.milestone ?? '', responsible: p.responsible ?? '', resources: p.resources ?? '' }));
  f.complianceChecklist = (r.complianceChecklist ?? []).map((c: any) => ({ ...c, note: c.note ?? '' }));
  f.issues = r.issues.map((i: any) => ({ id: i.id, key: i.id, issueCode: i.issueCode, description: i.description, category: i.category, dateIdentified: d(i.dateIdentified), severity: i.severity, responsible: i.responsible ?? '', recommendedAction: i.recommendedAction ?? '', targetDate: d(i.targetDate), status: i.status, resolutionRemarks: i.resolutionRemarks ?? '', impactNote: i.impactNote ?? '' }));
  f.actions = r.actions.map((a: any) => ({ id: a.id, issueKey: a.issueId ?? '', description: a.description, actionType: a.actionType, responsible: a.responsible ?? '', dateAssigned: d(a.dateAssigned), targetDate: d(a.targetDate), status: a.status === 'VERIFIED' ? 'COMPLETED' : a.status, completionRemarks: a.completionRemarks ?? '' }));
  f.risks = r.risks.map((x: any) => ({ id: x.id, riskCode: x.riskCode, description: x.description, category: x.category, probability: x.probability, impact: x.impact, consequences: x.consequences ?? '', responsible: x.responsible ?? '', reviewDate: d(x.reviewDate), status: x.status, level: x.level, score: x.score, mitigations: x.mitigations.map((m: any) => ({ ...m, preventiveActions: m.preventiveActions ?? '', responsible: m.responsible ?? '', resources: m.resources ?? '', targetDate: d(m.targetDate), effectiveness: m.effectiveness ?? '' })) }));
  f.certConfirmed = false;
  return f;
}

function RowBox({ title, onRemove, children }: { title: ReactNode; onRemove: () => void; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-gray-50/50 p-3">
      <div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium">{title}</p><Button variant="ghost" size="sm" aria-label="Remove" icon={<Trash2 className="size-4 text-red-600" />} onClick={onRemove} /></div>
      {children}
    </div>
  );
}

export default function JmReportForm() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { me, settings } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const assets = useCached<any>('/api/jm/assets')?.rows ?? [];
  const L = {
    insp: useLookups('JM_INSPECTION_TYPE'), status: useLookups('JM_PROJECT_STATUS'), quality: useLookups('JM_QUALITY'), compliance: useLookups('JM_COMPLIANCE'),
    criteria: useLookups('JM_COMPLIANCE_CRITERIA'), issueCat: useLookups('JM_ISSUE_CATEGORY'), riskCat: useLookups('JM_RISK_CATEGORY'), prob: useLookups('JM_RISK_PROBABILITY'), impact: useLookups('JM_RISK_IMPACT'),
  };
  const opt = (l: any[]) => l.map((x) => ({ value: x.value, label: x.label }));
  const existing = useApi(id ? `/api/jm/reports/${id}` : null);
  const [f, setF] = useState<any>(blank());
  const [busy, setBusy] = useState<string | null>(null);
  const { errors, formError, capture, clear } = useFormErrors();
  const set = (p: any) => setF((x: any) => ({ ...x, ...p }));
  const assetId = f.assetId;
  const baseline = useApi(assetId && !id ? `/api/jm/reports/baseline/${assetId}` : null);

  useEffect(() => { if (!id && sp.get('assetId')) set({ assetId: sp.get('assetId') }); }, [id, sp]);
  useEffect(() => { if (existing.data?.report) setF(fromReport(existing.data.report)); }, [existing.data]);
  useEffect(() => {
    if (baseline.data && !id) set({ previousProgress: n(baseline.data.previousProgress) });
  }, [baseline.data, id]);
  useEffect(() => {
    if (!id && L.criteria.length && !f.complianceChecklist.length) set({ complianceChecklist: L.criteria.map((c) => ({ criterion: c.label, result: 'PENDING', note: '' })) });
  }, [L.criteria.length, id]);

  const during = f.currentProgress !== '' && f.previousProgress !== '' ? Math.round((Number(f.currentProgress) - Number(f.previousProgress)) * 10) / 10 : null;
  const gap = f.plannedProgress !== '' && f.currentProgress !== '' ? Math.round((Number(f.plannedProgress) - Number(f.actualCompletion || f.currentProgress)) * 10) / 10 : null;
  const score = (r: any) => {
    const p = L.prob.find((x) => x.value === r.probability)?.meta?.score ?? 0;
    const i = L.impact.find((x) => x.value === r.impact)?.meta?.score ?? 0;
    return p * i;
  };
  const previouslyPlanned = id ? existing.data?.previous?.planned ?? [] : baseline.data?.previouslyPlanned ?? [];
  const selectedAsset = assets.find((a: any) => a.id === assetId) ?? existing.data?.report?.asset;
  const report = existing.data?.report;
  const editable = !id || existing.data?.can?.edit;
  const lastReturn = existing.data?.timeline?.history?.filter((h: any) => h.action === 'RETURNED').at(-1);

  const arr = (key: string) => ({
    add: (row: any) => set({ [key]: [...f[key], row] }),
    upd: (i: number, p: any) => set({ [key]: f[key].map((x: any, j: number) => (j === i ? { ...x, ...p } : x)) }),
    del: (i: number) => set({ [key]: f[key].filter((_: any, j: number) => j !== i) }),
  });
  const C = arr('completed'), P = arr('planned'), I = arr('issues'), A = arr('actions'), R = arr('risks'), K = arr('complianceChecklist');
  const issueOptions = useMemo(() => f.issues.map((i: any, idx: number) => ({ value: i.key, label: `${i.issueCode ?? `New issue ${idx + 1}`}: ${i.description.slice(0, 40) || '…'}` })), [f.issues]);

  if (id && existing.loading && !existing.data) return <Spinner />;
  if (id && existing.data && !editable) return <Notice tone="warning">This report can no longer be edited.</Notice>;

  const save = async (submit: boolean) => {
    clear();
    setBusy(submit ? 'submit' : 'draft');
    try {
      const body = { ...f, submit, issues: f.issues.map(({ issueCode: _c, ...i }: any) => i), risks: f.risks.map(({ riskCode: _c, level: _l, score: _s, ...r }: any) => r) };
      const r = id ? await api.put(`/api/jm/reports/${id}`, body) : await api.post('/api/jm/reports', body);
      toast('success', submit ? `${r.reportNo} submitted for review.` : `Draft ${r.reportNo} saved.`);
      nav(submit ? `/jm/reports/${r.id}` : `/jm/reports/${r.id}/edit`, { replace: true });
      if (id && !submit) existing.reload();
    } catch (e: any) {
      capture(e);
      const first = Object.keys(e.fields ?? {})[0];
      if (first) toast('error', `Check field: ${first.replace(/\./g, ' › ')}`);
    } finally {
      setBusy(null);
    }
  };

  const e = (k: string) => errors[k];
  return (
    <>
      <PageHeader title={id ? `Edit ${report?.reportNo}` : 'Jawan Markaz Monitoring and Progress Report'} subtitle="Complete all applicable sections. Reports are reviewed through the configured approval workflow." back={id ? `/jm/reports/${id}` : '/jm/reports'} />
      {report?.status === 'RETURNED' && lastReturn && <div className="mb-4"><Notice tone="warning"><strong>Returned for correction</strong> by {lastReturn.actorName} ({lastReturn.levelName}): “{lastReturn.remarks}”</Notice></div>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
        <div className="hidden lg:block">
          <div className="sticky top-20"><SectionNav title="Report sections" sections={SECTIONS.map(([k, label]) => ({ id: `sec-${k}`, label }))} /></div>
        </div>
        <div className="min-w-0 space-y-4">
          <ErrorBox error={formError ? { message: formError } : null} />

          <section className="scroll-mt-20" id="sec-a"><Card title="A. Report identification">
            <Grid cols={3}>
              <Input label="DAAMR ID" value={report?.reportNo ?? 'Generated automatically'} disabled />
              <Input label="Reporting officer" value={me?.name ?? ''} disabled />
              <Input label="Reporting officer email" value={me?.email ?? ''} disabled />
              <Select label="Asset visited" required wrapClass="sm:col-span-2" value={f.assetId} disabled={!!report && report.status !== 'DRAFT'} onChange={(ev) => set({ assetId: ev.target.value })} error={e('assetId')} placeholder="Select Jawan Markaz…" options={assets.map((a: any) => ({ value: a.id, label: `${a.assetCode} — ${a.name}` }))} />
              <Input label="District / HQ" value={selectedAsset?.district?.name ?? ''} disabled hint="Filled from the asset" />
              <Input label="Reporting period from" type="date" required value={f.periodFrom} onChange={(ev) => set({ periodFrom: ev.target.value })} error={e('periodFrom')} />
              <Input label="Reporting period to" type="date" required min={f.periodFrom} value={f.periodTo} onChange={(ev) => set({ periodTo: ev.target.value })} error={e('periodTo')} />
              <Input label="Inspection date" type="date" required value={f.inspectionDate} onChange={(ev) => set({ inspectionDate: ev.target.value })} error={e('inspectionDate')} />
              <Select label="Inspection type" required value={f.inspectionType} onChange={(ev) => set({ inspectionType: ev.target.value })} error={e('inspectionType')} options={opt(L.insp)} />
              <Input label="Reporting date" value={report?.submittedAt ? fmtDate(report.submittedAt) : 'Recorded on submission'} disabled />
            </Grid>
            {selectedAsset && <p className="mt-3 text-xs text-ink-3">{selectedAsset.location} · planned completion {fmtDate(selectedAsset.plannedCompletionDate)}{selectedAsset.contractor ? ` · contractor ${selectedAsset.contractor}` : ''}</p>}
          </Card></section>

          <section className="scroll-mt-20" id="sec-b"><Card title="B. Current status of project">
            <Grid cols={3}>
              <Select label="Current status" required value={f.projectStatus} onChange={(ev) => set({ projectStatus: ev.target.value })} error={e('projectStatus')} options={opt(L.status)} />
              <Input label="Current progress %" type="number" min={0} max={100} required value={f.currentProgress} onChange={(ev) => set({ currentProgress: ev.target.value })} error={e('currentProgress')} />
              <Input label="Previous progress %" type="number" min={0} max={100} value={f.previousProgress} onChange={(ev) => set({ previousProgress: ev.target.value })} error={e('previousProgress')} hint={baseline.data?.lastVerified ? `From verified ${baseline.data.lastVerified.reportNo}` : 'From latest verified record'} />
              <Input label="Progress during period %" value={during === null ? '—' : `${during > 0 ? '+' : ''}${during}`} disabled hint="Calculated" />
              <Input label="Planned progress %" type="number" min={0} max={100} value={f.plannedProgress} onChange={(ev) => set({ plannedProgress: ev.target.value })} error={e('plannedProgress')} />
              <Input label="Actual completion %" type="number" min={0} max={100} value={f.actualCompletion} onChange={(ev) => set({ actualCompletion: ev.target.value })} error={e('actualCompletion')} />
              <Input label="Expected completion date" type="date" value={f.expectedCompletionDate} onChange={(ev) => set({ expectedCompletionDate: ev.target.value })} />
              <Input label="Revised completion date" type="date" value={f.revisedCompletionDate} onChange={(ev) => set({ revisedCompletionDate: ev.target.value })} />
              <Input label="Delay in days" type="number" value={f.delayDays} onChange={(ev) => set({ delayDays: ev.target.value })} error={e('delayDays')} hint="Used first for schedule classification" />
            </Grid>
            {(gap !== null && gap > 0) || (during !== null && during < 0) ? (
              <div className="mt-3"><Notice tone="warning">{gap !== null && gap > 0 && <>Actual progress is {gap} points behind plan. </>}{during !== null && during < 0 && <>Current progress is lower than the previous verified progress.</>} The discrepancy will be flagged to reviewers.</Notice></div>
            ) : null}
          </Card></section>

          <section className="scroll-mt-20" id="sec-c"><Card title="C. Major activities completed" actions={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => C.add({ description: '', completionDate: '', quantity: '', wasPlanned: false })}>Add activity</Button>}>
            <Textarea label="Summary of work completed during the period" rows={3} value={f.completedSummary} onChange={(ev) => set({ completedSummary: ev.target.value })} />
            {previouslyPlanned.length > 0 && (
              <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
                <p className="mb-1 font-medium text-blue-900">Activities planned in the previous verified report</p>
                <ul className="space-y-1">
                  {previouslyPlanned.map((p: any) => {
                    const done = f.completed.some((c: any) => c.description === p.description);
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-2">
                        <span className={cx('flex-1', done && 'line-through opacity-60')}>{p.description}{p.expectedDate && <span className="text-xs text-blue-800"> · due {fmtDate(p.expectedDate)}</span>}</span>
                        {!done && <Button size="sm" variant="ghost" icon={<CopyPlus className="size-4" />} onClick={() => C.add({ description: p.description, completionDate: f.inspectionDate, quantity: p.milestone ?? '', wasPlanned: true })}>Mark completed</Button>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <div className="mt-3 space-y-2">
              {f.completed.map((c: any, i: number) => (
                <RowBox key={i} title={`Completed activity ${i + 1}`} onRemove={() => C.del(i)}>
                  <Grid cols={3}>
                    <Input label="Description" required wrapClass="sm:col-span-3" value={c.description} onChange={(ev) => C.upd(i, { description: ev.target.value })} error={e(`completed.${i}.description`)} />
                    <Input label="Completion date" type="date" value={c.completionDate} onChange={(ev) => C.upd(i, { completionDate: ev.target.value })} />
                    <Input label="Quantity / milestone achieved" value={c.quantity} onChange={(ev) => C.upd(i, { quantity: ev.target.value })} />
                    <div className="flex items-end pb-2"><Checkbox checked={c.wasPlanned} onChange={(v) => C.upd(i, { wasPlanned: v })} label="Was previously planned" /></div>
                  </Grid>
                </RowBox>
              ))}
            </div>
          </Card></section>

          <section className="scroll-mt-20" id="sec-d"><Card title="D. Activities planned" actions={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => P.add({ description: '', expectedDate: '', milestone: '', responsible: '', resources: '' })}>Add planned activity</Button>}>
            <Grid cols={2}>
              <Textarea label="Planned activities summary" rows={2} value={f.plannedSummary} onChange={(ev) => set({ plannedSummary: ev.target.value })} />
              <Input label="Expected progress during next period %" type="number" min={0} max={100} value={f.expectedNextProgress} onChange={(ev) => set({ expectedNextProgress: ev.target.value })} error={e('expectedNextProgress')} />
            </Grid>
            <div className="mt-3 space-y-2">
              {f.planned.map((p: any, i: number) => (
                <RowBox key={i} title={`Planned activity ${i + 1}`} onRemove={() => P.del(i)}>
                  <Grid cols={3}>
                    <Input label="Activity" required wrapClass="sm:col-span-3" value={p.description} onChange={(ev) => P.upd(i, { description: ev.target.value })} error={e(`planned.${i}.description`)} />
                    <Input label="Expected completion" type="date" value={p.expectedDate} onChange={(ev) => P.upd(i, { expectedDate: ev.target.value })} />
                    <Input label="Upcoming milestone" value={p.milestone} onChange={(ev) => P.upd(i, { milestone: ev.target.value })} />
                    <Input label="Responsible person / contractor" value={p.responsible} onChange={(ev) => P.upd(i, { responsible: ev.target.value })} />
                    <Input label="Required resources" wrapClass="sm:col-span-3" value={p.resources} onChange={(ev) => P.upd(i, { resources: ev.target.value })} />
                  </Grid>
                </RowBox>
              ))}
            </div>
          </Card></section>

          <section className="scroll-mt-20" id="sec-e"><Card title="E. Quality of work">
            <Grid cols={2}>
              <Select label="Quality assessment" required value={f.qualityRating} onChange={(ev) => set({ qualityRating: ev.target.value })} error={e('qualityRating')} options={opt(L.quality)} />
              <Input label="Corrective action deadline" type="date" value={f.qualityCorrectiveDeadline} onChange={(ev) => set({ qualityCorrectiveDeadline: ev.target.value })} />
              <Textarea label="Quality inspection remarks" value={f.qualityRemarks} onChange={(ev) => set({ qualityRemarks: ev.target.value })} />
              <Textarea label="Defects identified" value={f.defectsIdentified} onChange={(ev) => set({ defectsIdentified: ev.target.value })} />
              <Textarea label="Workmanship observations" value={f.workmanshipObservations} onChange={(ev) => set({ workmanshipObservations: ev.target.value })} />
              <Textarea label="Material quality observations" value={f.materialObservations} onChange={(ev) => set({ materialObservations: ev.target.value })} />
              <Textarea label="Corrective actions required" wrapClass="sm:col-span-2" value={f.qualityCorrectiveActions} onChange={(ev) => set({ qualityCorrectiveActions: ev.target.value })} />
            </Grid>
          </Card></section>

          <section className="scroll-mt-20" id="sec-f"><Card title="F. Compliance assessment" actions={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => K.add({ criterion: '', result: 'PENDING', note: '' })}>Add criterion</Button>}>
            <Grid cols={2}>
              <Select label="Compliance assessment" required value={f.complianceRating} onChange={(ev) => set({ complianceRating: ev.target.value })} error={e('complianceRating')} options={opt(L.compliance)} />
              <Textarea label="Applicable standards / requirements" rows={2} value={f.applicableStandards} onChange={(ev) => set({ applicableStandards: ev.target.value })} />
            </Grid>
            {f.complianceChecklist.length > 0 && (
              <div className="mt-3 overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs text-ink-3"><tr><th className="px-3 py-2">Criterion</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Note</th><th /></tr></thead>
                  <tbody className="divide-y divide-line">
                    {f.complianceChecklist.map((c: any, i: number) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5"><input aria-label="Criterion" className="w-full rounded border border-line px-2 py-1" value={c.criterion} onChange={(ev) => K.upd(i, { criterion: ev.target.value })} /></td>
                        <td className="px-3 py-1.5"><select aria-label="Result" className="rounded border border-line px-2 py-1" value={c.result} onChange={(ev) => K.upd(i, { result: ev.target.value })}>{CHECK.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></td>
                        <td className="px-3 py-1.5"><input aria-label="Note" className="w-full rounded border border-line px-2 py-1" value={c.note} onChange={(ev) => K.upd(i, { note: ev.target.value })} /></td>
                        <td className="px-2"><button aria-label="Remove criterion" onClick={() => K.del(i)} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="size-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Grid cols={2} className="mt-3">
              <Textarea label="Compliance observations" value={f.complianceObservations} onChange={(ev) => set({ complianceObservations: ev.target.value })} />
              <Textarea label="Deviations identified" value={f.deviations} onChange={(ev) => set({ deviations: ev.target.value })} />
              <Textarea label="Corrective actions" value={f.complianceCorrective} onChange={(ev) => set({ complianceCorrective: ev.target.value })} />
              <Textarea label="Compliance verification remarks" value={f.complianceVerification} onChange={(ev) => set({ complianceVerification: ev.target.value })} />
            </Grid>
          </Card></section>

          <section className="scroll-mt-20" id="sec-g"><Card title="G. Remarks">
            <Grid cols={3}>
              <Textarea label="General remarks" value={f.generalRemarks} onChange={(ev) => set({ generalRemarks: ev.target.value })} />
              <Textarea label="Reporting officer remarks" value={f.officerRemarks} onChange={(ev) => set({ officerRemarks: ev.target.value })} />
              <Textarea label="Additional observations" value={f.additionalObs} onChange={(ev) => set({ additionalObs: ev.target.value })} />
            </Grid>
            <p className="mt-2 text-xs text-ink-3">Supervising officer remarks are recorded by reviewers during approval.</p>
          </Card></section>

          <section className="scroll-mt-20" id="sec-h"><Card title="H. Issues identified" actions={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => I.add({ key: uid(), description: '', category: L.issueCat[0]?.value ?? '', dateIdentified: f.inspectionDate, severity: 'MEDIUM', responsible: '', recommendedAction: '', targetDate: '', status: 'OPEN', resolutionRemarks: '', impactNote: '' })}>Add issue</Button>}>
            {!f.issues.length && <p className="text-sm text-ink-3">No issues recorded.</p>}
            <div className="space-y-2">
              {f.issues.map((x: any, i: number) => (
                <RowBox key={x.key} title={x.issueCode ?? `New issue ${i + 1}`} onRemove={() => I.del(i)}>
                  <Grid cols={3}>
                    <Textarea label="Issue description" required wrapClass="sm:col-span-3" rows={2} value={x.description} onChange={(ev) => I.upd(i, { description: ev.target.value })} error={e(`issues.${i}.description`)} />
                    <Select label="Category" value={x.category} onChange={(ev) => I.upd(i, { category: ev.target.value })} error={e(`issues.${i}.category`)} options={opt(L.issueCat)} />
                    <Input label="Date identified" type="date" value={x.dateIdentified} onChange={(ev) => I.upd(i, { dateIdentified: ev.target.value })} error={e(`issues.${i}.dateIdentified`)} />
                    <Select label="Severity" value={x.severity} onChange={(ev) => I.upd(i, { severity: ev.target.value })} options={SEV} />
                    <Input label="Responsible department / person" value={x.responsible} onChange={(ev) => I.upd(i, { responsible: ev.target.value })} />
                    <Input label="Target resolution date" type="date" value={x.targetDate} onChange={(ev) => I.upd(i, { targetDate: ev.target.value })} />
                    <Select label="Issue status" value={x.status} onChange={(ev) => I.upd(i, { status: ev.target.value })} options={ISSUE_ST} />
                    <Input label="Recommended action" wrapClass="sm:col-span-2" value={x.recommendedAction} onChange={(ev) => I.upd(i, { recommendedAction: ev.target.value })} />
                    <Input label="Effect on project" value={x.impactNote} onChange={(ev) => I.upd(i, { impactNote: ev.target.value })} />
                    <Input label="Resolution remarks" wrapClass="sm:col-span-3" value={x.resolutionRemarks} onChange={(ev) => I.upd(i, { resolutionRemarks: ev.target.value })} />
                  </Grid>
                </RowBox>
              ))}
            </div>
          </Card></section>

          <section className="scroll-mt-20" id="sec-i"><Card title="I. Impact on project">
            <Grid cols={3}>
              <Textarea label="Description of impact" wrapClass="sm:col-span-3" value={f.impactDescription} onChange={(ev) => set({ impactDescription: ev.target.value })} />
              <Textarea label="Schedule impact" rows={2} value={f.scheduleImpact} onChange={(ev) => set({ scheduleImpact: ev.target.value })} />
              <Textarea label="Quality impact" rows={2} value={f.qualityImpact} onChange={(ev) => set({ qualityImpact: ev.target.value })} />
              <Textarea label="Cost impact (if applicable)" rows={2} value={f.costImpact} onChange={(ev) => set({ costImpact: ev.target.value })} />
              <Textarea label="Operational impact" rows={2} value={f.operationalImpact} onChange={(ev) => set({ operationalImpact: ev.target.value })} />
              <Input label="Estimated delay (days)" type="number" value={f.impactDelayDays} onChange={(ev) => set({ impactDelayDays: ev.target.value })} />
              <Select label="Overall impact severity" value={f.impactSeverity} onChange={(ev) => set({ impactSeverity: ev.target.value })} placeholder="—" options={SEV} />
            </Grid>
          </Card></section>

          <section className="scroll-mt-20" id="sec-j"><Card title="J. Action taken / required" actions={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => A.add({ issueKey: '', description: '', actionType: 'REQUIRED', responsible: '', dateAssigned: f.inspectionDate, targetDate: '', status: 'OPEN', completionRemarks: '' })}>Add action</Button>}>
            {!f.actions.length && <p className="text-sm text-ink-3">No actions recorded.</p>}
            <div className="space-y-2">
              {f.actions.map((x: any, i: number) => (
                <RowBox key={i} title={`Action ${i + 1}`} onRemove={() => A.del(i)}>
                  <Grid cols={3}>
                    <Textarea label="Action description" required wrapClass="sm:col-span-3" rows={2} value={x.description} onChange={(ev) => A.upd(i, { description: ev.target.value })} error={e(`actions.${i}.description`)} />
                    <Select label="Action type" value={x.actionType} onChange={(ev) => A.upd(i, { actionType: ev.target.value })} options={[{ value: 'TAKEN', label: 'Taken' }, { value: 'REQUIRED', label: 'Required' }]} />
                    <Select label="Related issue" value={x.issueKey} onChange={(ev) => A.upd(i, { issueKey: ev.target.value })} placeholder="—" options={issueOptions} />
                    <Input label="Responsible officer / department" value={x.responsible} onChange={(ev) => A.upd(i, { responsible: ev.target.value })} />
                    <Input label="Date assigned" type="date" value={x.dateAssigned} onChange={(ev) => A.upd(i, { dateAssigned: ev.target.value })} />
                    <Input label="Target completion" type="date" value={x.targetDate} onChange={(ev) => A.upd(i, { targetDate: ev.target.value })} />
                    <Select label="Current status" value={x.status} onChange={(ev) => A.upd(i, { status: ev.target.value })} options={ACT_ST} />
                    <Input label="Completion remarks" wrapClass="sm:col-span-3" value={x.completionRemarks} onChange={(ev) => A.upd(i, { completionRemarks: ev.target.value })} />
                  </Grid>
                </RowBox>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-3">Evidence of completion can be uploaded in the Issues, Actions & Risks register after submission; actions are tracked until verified.</p>
          </Card></section>

          <section className="scroll-mt-20" id="sec-k"><Card title="K. Potential risks & L. Mitigation measures" actions={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => R.add({ description: '', category: L.riskCat[0]?.value ?? '', probability: 'POSSIBLE', impact: 'MODERATE', consequences: '', responsible: '', reviewDate: '', status: 'OPEN', mitigations: [] })}>Add risk</Button>}>
            {!f.risks.length && <p className="text-sm text-ink-3">No risks recorded.</p>}
            <div className="space-y-2">
              {f.risks.map((x: any, i: number) => (
                <RowBox key={i} title={<span>{x.riskCode ?? `New risk ${i + 1}`} <span className="ml-2 rounded bg-white px-1.5 py-0.5 text-xs font-normal ring-1 ring-line">Score {score(x)}{x.level ? ` · ${humanize(x.level)}` : ''}</span></span>} onRemove={() => R.del(i)}>
                  <Grid cols={3}>
                    <Textarea label="Risk description" required wrapClass="sm:col-span-3" rows={2} value={x.description} onChange={(ev) => R.upd(i, { description: ev.target.value })} error={e(`risks.${i}.description`)} />
                    <Select label="Risk category" value={x.category} onChange={(ev) => R.upd(i, { category: ev.target.value })} options={opt(L.riskCat)} />
                    <Select label="Probability" value={x.probability} onChange={(ev) => R.upd(i, { probability: ev.target.value })} options={L.prob.map((p) => ({ value: p.value, label: `${p.label} (${p.meta?.score})` }))} />
                    <Select label="Impact severity" value={x.impact} onChange={(ev) => R.upd(i, { impact: ev.target.value })} options={L.impact.map((p) => ({ value: p.value, label: `${p.label} (${p.meta?.score})` }))} />
                    <Input label="Potential consequences" wrapClass="sm:col-span-2" value={x.consequences} onChange={(ev) => R.upd(i, { consequences: ev.target.value })} />
                    <Input label="Responsible person" value={x.responsible} onChange={(ev) => R.upd(i, { responsible: ev.target.value })} />
                    <Input label="Review date" type="date" value={x.reviewDate} onChange={(ev) => R.upd(i, { reviewDate: ev.target.value })} />
                    <Select label="Risk status" value={x.status} onChange={(ev) => R.upd(i, { status: ev.target.value })} options={RISK_ST} />
                  </Grid>
                  <div className="mt-3 space-y-2 border-t border-line pt-3">
                    <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Mitigation measures</p><Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => R.upd(i, { mitigations: [...x.mitigations, { measures: '', preventiveActions: '', responsible: '', resources: '', targetDate: '', status: 'PLANNED', effectiveness: '' }] })}>Add mitigation</Button></div>
                    {x.mitigations.map((m: any, j: number) => {
                      const um = (p: any) => R.upd(i, { mitigations: x.mitigations.map((mm: any, k: number) => (k === j ? { ...mm, ...p } : mm)) });
                      return (
                        <div key={j} className="grid grid-cols-1 gap-2 rounded-md bg-white p-2 ring-1 ring-line sm:grid-cols-3">
                          <Input label="Proposed measures" required wrapClass="sm:col-span-2" value={m.measures} onChange={(ev) => um({ measures: ev.target.value })} error={e(`risks.${i}.mitigations.${j}.measures`)} />
                          <Select label="Status" value={m.status} onChange={(ev) => um({ status: ev.target.value })} options={MIT_ST} />
                          <Input label="Preventive actions" value={m.preventiveActions} onChange={(ev) => um({ preventiveActions: ev.target.value })} />
                          <Input label="Responsible" value={m.responsible} onChange={(ev) => um({ responsible: ev.target.value })} />
                          <Input label="Target date" type="date" value={m.targetDate} onChange={(ev) => um({ targetDate: ev.target.value })} />
                          <Input label="Required resources" value={m.resources} onChange={(ev) => um({ resources: ev.target.value })} />
                          <Input label="Effectiveness assessment" value={m.effectiveness} onChange={(ev) => um({ effectiveness: ev.target.value })} />
                          <div className="flex items-end"><Button size="sm" variant="ghost" icon={<Trash2 className="size-4 text-red-600" />} onClick={() => R.upd(i, { mitigations: x.mitigations.filter((_: any, k: number) => k !== j) })}>Remove</Button></div>
                        </div>
                      );
                    })}
                  </div>
                </RowBox>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-3">Risk score = probability × impact (configured scales). The risk level is assigned on save using the administrator's risk bands.</p>
          </Card></section>

          <section className="scroll-mt-20" id="sec-m"><Card title="M. Geo-tagged site photographs" subtitle="Photos with embedded GPS keep their EXIF location; otherwise you may attach your device location (with permission) or enter coordinates manually. Locations are labelled by source and are not independently verified.">
            {id ? (
              <div className="space-y-4">
                <Uploader target="jm-report" entityId={id} categories={PHOTO_CATS} withGeo onUploaded={existing.reload} />
                <Gallery photos={(report?.files ?? []).filter((x: any) => x.kind === 'PHOTO')} onChanged={existing.reload} canRemove={(p) => p.uploadedBy.id === me?.id} />
                <div className="border-t border-line pt-4">
                  <p className="mb-2 text-sm font-medium">Supporting documents & quality evidence</p>
                  <Uploader target="jm-report" entityId={id} kind="doc" compact categories={[{ value: 'SUPPORTING', label: 'Supporting document' }, { value: 'QUALITY_EVIDENCE', label: 'Quality / test evidence' }, { value: 'COMPLETED_ACTIVITY', label: 'Completed activity evidence' }]} onUploaded={existing.reload} />
                  <div className="mt-3"><AttachmentList files={(report?.files ?? []).filter((x: any) => x.kind === 'DOCUMENT')} onChanged={existing.reload} canRemove={(p) => p.uploadedBy.id === me?.id} /></div>
                </div>
              </div>
            ) : <Notice>Save the report as a draft to upload site photographs and documents.</Notice>}
          </Card></section>

          <section className="scroll-mt-20" id="sec-n"><Card title="N. Assessment / recommendations">
            <Grid cols={2}>
              <Textarea label="Overall assessment" value={f.overallAssessment} onChange={(ev) => set({ overallAssessment: ev.target.value })} />
              <Textarea label="Key findings" value={f.keyFindings} onChange={(ev) => set({ keyFindings: ev.target.value })} />
              <Textarea label="Recommended corrective measures" value={f.recommendedMeasures} onChange={(ev) => set({ recommendedMeasures: ev.target.value })} />
              <Textarea label="Priority actions" value={f.priorityActions} onChange={(ev) => set({ priorityActions: ev.target.value })} />
              <Input label="Responsible department" value={f.recommendedDepartment} onChange={(ev) => set({ recommendedDepartment: ev.target.value })} />
              <Input label="Recommended completion date" type="date" value={f.recommendedCompletionDate} onChange={(ev) => set({ recommendedCompletionDate: ev.target.value })} />
              <div className="flex items-end pb-2"><Checkbox checked={f.followUpRequired} onChange={(v) => set({ followUpRequired: v })} label="Follow-up inspection required" /></div>
              <Input label="Next inspection date" type="date" value={f.nextInspectionDate} onChange={(ev) => set({ nextInspectionDate: ev.target.value })} error={e('nextInspectionDate')} />
            </Grid>
          </Card></section>

          <section className="scroll-mt-20" id="sec-o"><Card title="O. Certification">
            <div className="space-y-3">
              <Grid cols={2}>
                <Input label="Reporting officer name" value={me?.name ?? ''} disabled />
                <Input label="Designation" value={me?.designation ?? ''} disabled />
              </Grid>
              <blockquote className="rounded-lg border-l-4 border-brand bg-brand-50 p-3 text-sm text-ink-2">{settings?.jmCertificationStatement}</blockquote>
              <Checkbox checked={f.certConfirmed} onChange={(v) => set({ certConfirmed: v })} label={<>I, <strong>{me?.name}</strong>, certify this report. <span className="text-ink-3">(Recorded with your account and the submission time; certification on behalf of another person is not possible.)</span></>} />
              {e('certConfirmed') && <p className="text-xs text-red-600" role="alert">{e('certConfirmed')}</p>}
            </div>
          </Card></section>

          <div className="no-print sticky bottom-0 z-10 -mx-4 flex flex-wrap justify-end gap-2 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
            <Button variant="secondary" loading={busy === 'draft'} onClick={() => save(false)} icon={<Save className="size-4" />}>Save draft</Button>
            <Button loading={busy === 'submit'} onClick={() => save(true)} icon={<Send className="size-4" />}>{report?.status === 'RETURNED' ? 'Certify & resubmit' : 'Certify & submit'}</Button>
          </div>
        </div>
      </div>
    </>
  );
}
