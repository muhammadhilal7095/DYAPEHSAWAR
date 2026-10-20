import { Link, useNavigate, useParams } from 'react-router';
import { AlertTriangle, Download, Pencil, Printer, Trash2 } from 'lucide-react';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useHashScroll, useApi, useLookupLabel } from '../../lib/hooks';
import { fmtDate, fmtDateTime, humanize } from '../../lib/format';
import { Badge, Button, Card, ErrorBox, KV, LinkButton, Notice, PageHeader, Spinner, useConfirm, useToast } from '../../components/ui';
import { CurrentOfficer, EmailStatus, ReviewPanel, Timeline } from '../../components/Workflow';
import { AttachmentList, Gallery, LazyMap } from '../../components/Files';
import { SimpleTable } from './AssetDetail';

export default function JmReportDetail() {
  const { id } = useParams();
  const { me } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const L = { status: useLookupLabel('JM_PROJECT_STATUS'), quality: useLookupLabel('JM_QUALITY'), compliance: useLookupLabel('JM_COMPLIANCE'), insp: useLookupLabel('JM_INSPECTION_TYPE'), cat: useLookupLabel('JM_ISSUE_CATEGORY'), rcat: useLookupLabel('JM_RISK_CATEGORY') };
  const { data, loading, error, reload } = useApi(`/api/jm/reports/${id}`);
  useHashScroll(!!data);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const r = data.report;
  const prev = data.previous;
  const photos = r.files.filter((f: any) => f.kind === 'PHOTO');
  const geo = photos.filter((p: any) => p.latitude != null);
  const t = (s?: string | null) => (s ? <span className="whitespace-pre-line">{s}</span> : null);
  return (
    <>
      <PageHeader
        back="/jm/reports"
        title={`${r.asset.name} — monitoring report`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{r.reportNo}</span><Badge status={r.status} /><Badge status={r.scheduleClass} /></span>}
        actions={<>
          {data.can.edit && <LinkButton to={`/jm/reports/${id}/edit`} variant="secondary" icon={<Pencil className="size-4" />}>{r.status === 'RETURNED' ? 'Correct & resubmit' : 'Edit draft'}</LinkButton>}
          {data.can.delete && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={async () => { if (await confirm({ title: 'Delete draft?', message: 'This draft report will be deleted.', confirmLabel: 'Delete', tone: 'danger' })) { await api.del(`/api/jm/reports/${id}`); nav('/jm/reports'); } }}>Delete</Button>}
          <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => download(`/api/jm/reports/${id}/pdf`).catch((e) => toast('error', e.message))}>PDF</Button>
        </>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {data.discrepancies.length > 0 && (
            <Notice tone="warning"><strong className="flex items-center gap-1"><AlertTriangle className="size-4" />Progress discrepancies flagged</strong><ul className="mt-1 list-disc pl-5">{data.discrepancies.map((x: string) => <li key={x}>{x}</li>)}</ul></Notice>
          )}
          <div id="review"><ReviewPanel base={`/api/jm/reports/${id}`} can={data.can} onDone={reload} approveLabel="Verify & forward" finalApproveLabel="Final verification" /></div>

          <Card title="A. Report identification">
            <KV cols={3} items={[
              ['DAAMR ID', <span className="font-mono">{r.reportNo}</span>], ['Reporting date', fmtDateTime(r.submittedAt)], ['Reporting officer', `${r.reportingOfficer.name}`],
              ['Officer email', r.reportingOfficerEmail], ['District / HQ', r.district.name], ['Asset visited', <Link className="text-brand hover:underline" to={`/jm/assets/${r.assetId}`}>{r.asset.assetCode} {r.asset.name}</Link>],
              ['Reporting period', `${fmtDate(r.periodFrom)} – ${fmtDate(r.periodTo)}`], ['Inspection date', fmtDate(r.inspectionDate)], ['Inspection type', L.insp(r.inspectionType)],
              ['Email status', <EmailStatus s={data.emailStatus} />],
            ]} />
          </Card>

          <Card title="B. Current status of project" subtitle={prev ? `Compared with verified ${prev.reportNo} (${fmtDate(prev.periodTo)})` : 'No previous verified report for comparison'}>
            <KV cols={3} items={[
              ['Current status', L.status(r.projectStatus)], ['Schedule classification', <Badge status={r.scheduleClass} />], ['Delay', r.delayDays != null ? `${r.delayDays} days` : '—'],
              ['Current progress', `${r.currentProgress}%`], ['Previous progress', r.previousProgress != null ? `${r.previousProgress}%` : '—'], ['Progress during period', r.progressDuringPeriod != null ? `${r.progressDuringPeriod > 0 ? '+' : ''}${r.progressDuringPeriod}%` : '—'],
              ['Planned progress', r.plannedProgress != null ? `${r.plannedProgress}%` : '—'], ['Actual completion', r.actualCompletion != null ? `${r.actualCompletion}%` : '—'], ['Expected completion', fmtDate(r.expectedCompletionDate)],
              ['Revised completion', fmtDate(r.revisedCompletionDate)],
              ...(prev ? [['Previous schedule / quality', <span>{humanize(prev.scheduleClass)} · {L.quality(prev.qualityRating)}</span>], ['Previously expected next progress', prev.expectedNextProgress != null ? `+${prev.expectedNextProgress}%` : '—']] as any : []),
            ]} />
          </Card>

          <Card title="C. Major activities completed" bodyClass="p-0">
            {r.completedSummary && <p className="whitespace-pre-line px-4 pt-3 text-sm">{r.completedSummary}</p>}
            <SimpleTable rows={r.completed} cols={[['Activity', (c) => c.description], ['Completed', (c) => fmtDate(c.completionDate)], ['Quantity / milestone', (c) => c.quantity ?? '—'], ['Planned earlier', (c) => (c.wasPlanned ? 'Yes' : 'No')]]} />
            {prev?.planned?.length > 0 && (
              <div className="border-t border-line px-4 py-3 text-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Previously planned vs completed</p>
                <ul className="space-y-0.5">{prev.planned.map((p: any) => { const done = r.completed.some((c: any) => c.description === p.description); return <li key={p.id} className={done ? 'text-emerald-700' : 'text-amber-800'}>{done ? '✓' : '○'} {p.description}{!done && ' — not reported as completed'}</li>; })}</ul>
              </div>
            )}
          </Card>
          <Card title="D. Activities planned" bodyClass="p-0">
            {(r.plannedSummary || r.expectedNextProgress != null) && <p className="whitespace-pre-line px-4 pt-3 text-sm">{r.plannedSummary}{r.expectedNextProgress != null && <span className="block text-ink-3">Expected progress next period: {r.expectedNextProgress}%</span>}</p>}
            <SimpleTable rows={r.planned} cols={[['Activity', (c) => c.description], ['Expected', (c) => fmtDate(c.expectedDate)], ['Milestone', (c) => c.milestone ?? '—'], ['Responsible', (c) => c.responsible ?? '—'], ['Resources', (c) => c.resources ?? '—']]} />
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card title="E. Quality of work">
              <KV cols={1} items={[['Assessment', <Badge status={r.qualityRating} label={L.quality(r.qualityRating)} />], ['Remarks', t(r.qualityRemarks)], ['Defects identified', t(r.defectsIdentified)], ['Workmanship', t(r.workmanshipObservations)], ['Material quality', t(r.materialObservations)], ['Corrective actions', t(r.qualityCorrectiveActions)], ['Deadline', fmtDate(r.qualityCorrectiveDeadline)]]} />
            </Card>
            <Card title="F. Compliance assessment">
              <KV cols={1} items={[['Assessment', <Badge status={r.complianceRating} label={L.compliance(r.complianceRating)} />], ['Applicable standards', t(r.applicableStandards)], ['Observations', t(r.complianceObservations)], ['Deviations', t(r.deviations)], ['Corrective actions', t(r.complianceCorrective)], ['Verification remarks', t(r.complianceVerification)]]} />
              {(r.complianceChecklist ?? []).length > 0 && <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">{r.complianceChecklist.map((c: any, i: number) => <li key={i} className="flex flex-wrap items-center gap-2"><Badge status={c.result === 'COMPLIANT' ? 'FULLY_COMPLIANT' : c.result === 'PARTIAL' ? 'PARTIALLY_COMPLIANT' : c.result} label={humanize(c.result)} />{c.criterion}{c.note && <span className="text-xs text-ink-3">— {c.note}</span>}</li>)}</ul>}
            </Card>
          </div>
          <Card title="G. Remarks"><KV cols={2} items={[['General remarks', t(r.generalRemarks)], ['Reporting officer remarks', t(r.officerRemarks)], ['Supervising officer remarks', t(r.supervisorRemarks)], ['Additional observations', t(r.additionalObs)]]} /></Card>
          <Card title={`H. Issues identified (${r.issues.length})`} bodyClass="p-0">
            <SimpleTable rows={r.issues} cols={[['ID', (x) => <span className="font-mono text-xs">{x.issueCode}</span>], ['Description', (x) => x.description], ['Category', (x) => L.cat(x.category)], ['Identified', (x) => fmtDate(x.dateIdentified)], ['Severity', (x) => <Badge status={x.severity} />], ['Responsible', (x) => x.responsible ?? '—'], ['Target', (x) => fmtDate(x.targetDate)], ['Status', (x) => <Badge status={x.status} />]]} />
          </Card>
          <Card title="I. Impact on project"><KV cols={3} items={[['Description', t(r.impactDescription)], ['Schedule impact', t(r.scheduleImpact)], ['Quality impact', t(r.qualityImpact)], ['Cost impact', t(r.costImpact)], ['Operational impact', t(r.operationalImpact)], ['Estimated delay', r.impactDelayDays != null ? `${r.impactDelayDays} days` : '—'], ['Overall severity', r.impactSeverity ? <Badge status={r.impactSeverity} /> : '—']]} /></Card>
          <Card title={`J. Action taken / required (${r.actions.length})`} bodyClass="p-0">
            <SimpleTable rows={r.actions} cols={[['Action', (x) => x.description], ['Type', (x) => humanize(x.actionType)], ['Issue', (x) => x.issue?.issueCode ?? '—'], ['Responsible', (x) => x.responsible ?? '—'], ['Target', (x) => fmtDate(x.targetDate)], ['Status', (x) => <Badge status={x.status} />], ['Verified', (x) => (x.verifiedBy ? `${x.verifiedBy.name}, ${fmtDate(x.verifiedAt)}` : '—')]]} />
          </Card>
          <Card title={`K/L. Risks & mitigation (${r.risks.length})`} bodyClass="p-0">
            <SimpleTable rows={r.risks} cols={[['ID', (x) => <span className="font-mono text-xs">{x.riskCode}</span>], ['Risk', (x) => <>{x.description}{x.consequences && <span className="block text-xs text-ink-3">{x.consequences}</span>}</>], ['Category', (x) => L.rcat(x.category)], ['P × I', (x) => `${humanize(x.probability)} × ${humanize(x.impact)} = ${x.score}`], ['Level', (x) => <Badge status={x.level} />], ['Mitigation', (x) => x.mitigations.map((m: any) => <span key={m.id} className="block text-xs">{m.measures} <span className="text-ink-3">({humanize(m.status)})</span></span>)], ['Status', (x) => <Badge status={x.status} />]]} />
          </Card>
          <Card title={`M. Geo-tagged photographs (${photos.length})`}>
            {geo.length > 0 && <div className="mb-4 h-60 overflow-hidden rounded-lg border border-line"><LazyMap points={geo.map((p: any) => ({ lat: p.latitude, lng: p.longitude, label: p.caption ?? p.originalName }))} /></div>}
            <Gallery photos={photos} onChanged={reload} canRemove={(p) => data.can.edit && p.uploadedBy.id === me?.id} />
            <div className="mt-4"><AttachmentList files={r.files.filter((f: any) => f.kind === 'DOCUMENT')} /></div>
          </Card>
          <Card title="N. Assessment / recommendations"><KV cols={2} items={[['Overall assessment', t(r.overallAssessment)], ['Key findings', t(r.keyFindings)], ['Recommended corrective measures', t(r.recommendedMeasures)], ['Priority actions', t(r.priorityActions)], ['Responsible department', r.recommendedDepartment], ['Recommended completion', fmtDate(r.recommendedCompletionDate)], ['Follow-up inspection required', r.followUpRequired ? 'Yes' : 'No'], ['Next inspection date', fmtDate(r.nextInspectionDate)]]} /></Card>
          <Card title="O. Certification">
            <KV cols={2} items={[['Reporting officer', r.certName], ['Designation', r.certDesignation], ['Certified at', fmtDateTime(r.certifiedAt)], ['Final approval status', <Badge status={r.status} />], ['Reviewer certification', r.finalReviewer ? `${r.finalReviewer.name}${r.finalReviewer.designation ? `, ${r.finalReviewer.designation}` : ''} — ${fmtDateTime(r.finalDecisionAt)}` : 'Pending'], ['Final reviewer note', r.finalReviewerNote]]} />
            {r.certStatement && <blockquote className="mt-3 rounded-lg border-l-4 border-brand bg-brand-50 p-3 text-sm italic text-ink-2">{r.certStatement}</blockquote>}
          </Card>
        </div>
        <div className="space-y-4">
          <CurrentOfficer tl={data.timeline} />
          {data.timeline ? <div id="timeline"><Timeline tl={data.timeline} title="Review & approval timeline" /></div> : <Card title="Review timeline"><p className="text-sm text-ink-3">Starts on submission.</p></Card>}
        </div>
      </div>
    </>
  );
}
