import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Building2, CalendarDays, FilePlus2, HardHat, MapPin, Pencil, Search, TrendingUp, UserRound, Wallet } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { clearCache, useApi, useLookupLabel } from '../../lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, humanize } from '../../lib/format';
import { Badge, Button, Card, DetailHeader, ErrorBox, FactGrid, KV, LinkButton, Spinner, Tabs } from '../../components/ui';
import { Gallery, LazyMap, Uploader } from '../../components/Files';
import { ChartCard, ProgressLine } from '../../components/Charts';
import { AssetModal, ProgressBar } from './Assets';

export default function AssetDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const status = useLookupLabel('JM_PROJECT_STATUS');
  const quality = useLookupLabel('JM_QUALITY');
  const { data, loading, error, reload } = useApi(`/api/jm/assets/${id}`);
  const [tab, setTab] = useState('reports');
  const [edit, setEdit] = useState(false);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const a = data.asset;
  const lv = data.latestVerified;
  const timeline = [...data.reports].filter((r: any) => r.submittedAt).sort((x: any, y: any) => (x.submittedAt < y.submittedAt ? 1 : -1));
  return (
    <>
      <DetailHeader
        back="/jm/assets"
        backLabel="Asset register"
        reference={<>{a.assetCode}<span className="font-sans text-white/55"> · {a.district.name}</span></>}
        title={a.name}
        badges={<Badge status={a.currentStatus} label={status(a.currentStatus)} />}
        actions={<>{data.canManage && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>Edit asset</Button>}{can('jm.report.create') && <LinkButton variant="secondary" to={`/jm/reports/new?assetId=${a.id}`} icon={<FilePlus2 className="size-4" />}>New monitoring report</LinkButton>}</>}
      >
        <FactGrid items={[
          { icon: <MapPin className="size-4" />, label: 'Location', value: a.location },
          { icon: <TrendingUp className="size-4" />, label: 'Overall progress', value: <div className="w-36 max-w-full"><ProgressBar value={a.overallProgress} /></div> },
          { icon: <CalendarDays className="size-4" />, label: 'Completion', value: <>{fmtDate(a.revisedCompletionDate ?? a.plannedCompletionDate)}{a.revisedCompletionDate && <span className="block text-xs font-normal text-amber-700">Revised from {fmtDate(a.plannedCompletionDate)}</span>}</> },
          { icon: <Search className="size-4" />, label: 'Last inspection', value: a.lastInspectionDate ? fmtDate(a.lastInspectionDate) : null },
          { icon: <Wallet className="size-4" />, label: 'Approved cost', value: a.approvedCost != null ? fmtMoney(a.approvedCost) : null },
          { icon: <HardHat className="size-4" />, label: 'Contractor', value: a.contractor },
          { icon: <Building2 className="size-4" />, label: 'Supervising department', value: a.supervisingDepartment },
          { icon: <UserRound className="size-4" />, label: 'Supervising officer', value: a.supervisingOfficer },
        ]} />
      </DetailHeader>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Asset information" className="lg:col-span-2">
          <KV cols={3} items={[
            ['Location', a.location], ['GPS', a.latitude != null ? `${a.latitude}, ${a.longitude}` : '—'], ['Overall progress', <ProgressBar value={a.overallProgress} />],
            ['Project start', fmtDate(a.projectStartDate)], ['Planned completion', fmtDate(a.plannedCompletionDate)], ['Revised completion', fmtDate(a.revisedCompletionDate)],
            ['Approved cost', fmtMoney(a.approvedCost)], ['Contractor', a.contractor], ['Supervising department', a.supervisingDepartment],
            ['Supervising officer', a.supervisingOfficer], ['Last inspection', fmtDate(a.lastInspectionDate)], ['Last reporting date', fmtDate(a.lastReportingDate)],
            ['Latest verified schedule', lv ? <Badge status={lv.scheduleClass} /> : '—'], ['Latest verified quality', lv ? quality(lv.qualityRating) : '—'], ['Next scheduled inspection', fmtDate(data.nextInspectionDate)],
          ]} />
          {a.remarks && <p className="mt-3 border-t border-line pt-3 text-sm text-ink-2">{a.remarks}</p>}
        </Card>
        <Card title="Site location" bodyClass="p-0">
          <div className="h-64 overflow-hidden rounded-b-xl">{a.latitude != null ? <LazyMap points={[{ lat: a.latitude, lng: a.longitude, label: a.name }]} /> : <p className="p-4 text-sm text-ink-3">No GPS coordinates recorded.</p>}</div>
        </Card>
        <div className="lg:col-span-2">
          <ChartCard title="Progress across reporting periods" subtitle="Verified reports only" rows={data.progressSeries} columns={[{ key: 'date', label: 'Report date' }, { key: 'reportNo', label: 'Report' }, { key: 'progress', label: 'Actual %', numeric: true }, { key: 'planned', label: 'Planned %', numeric: true }]} empty="No verified reports yet">
            <ProgressLine data={data.progressSeries} />
          </ChartCard>
        </div>
        <Card title="Inspection & reporting timeline">
          <ol className="space-y-3 border-l border-line pl-4">
            {timeline.slice(0, 8).map((r: any) => (
              <li key={r.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-brand" />
                <Link to={`/jm/reports/${r.id}`} className="text-sm font-medium hover:text-brand hover:underline">{fmtDate(r.inspectionDate)} — {humanize(r.inspectionType)}</Link>
                <p className="text-xs text-ink-3">{r.reportNo} · {r.reportingOfficer.name} · {r.currentProgress}% · <Badge status={r.status} /></p>
              </li>
            ))}
            {!timeline.length && <li className="text-sm text-ink-3">No reports yet.</li>}
          </ol>
        </Card>
      </div>
      {lv && (lv.keyFindings || lv.recommendedMeasures || lv.priorityActions) && (
        <Card title={`Latest assessment & recommendations (${lv.reportNo})`} className="mt-4">
          <KV cols={3} items={[['Overall assessment', lv.overallAssessment], ['Key findings', lv.keyFindings], ['Recommended corrective measures', lv.recommendedMeasures], ['Priority actions', lv.priorityActions], ['Follow-up inspection', lv.followUpRequired ? `Yes — ${fmtDate(lv.nextInspectionDate)}` : 'No'], ['Verified by', lv.finalReviewer ? `${lv.finalReviewer.name}, ${fmtDateTime(lv.finalDecisionAt)}` : '—']]} />
        </Card>
      )}
      <div className="mt-6">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'reports', label: 'Reporting history', count: data.reports.length },
          { value: 'issues', label: 'Issues', count: data.issues.length },
          { value: 'actions', label: 'Corrective actions', count: data.actions.length },
          { value: 'risks', label: 'Risk register', count: data.risks.length },
          { value: 'photos', label: 'Geo-tagged photographs', count: data.photos.length },
          { value: 'approvals', label: 'Approval history' },
        ]} />
        <Card bodyClass={tab === 'photos' ? 'p-4' : 'p-0'}>
          {tab === 'reports' && <SimpleTable rows={data.reports} cols={[
            ['Report', (r) => <Link className="font-mono text-xs text-brand hover:underline" to={`/jm/reports/${r.id}`}>{r.reportNo}</Link>], ['Period', (r) => `${fmtDate(r.periodFrom)} – ${fmtDate(r.periodTo)}`], ['Inspection', (r) => fmtDate(r.inspectionDate)],
            ['Progress', (r) => `${r.currentProgress}%${r.plannedProgress != null ? ` / plan ${r.plannedProgress}%` : ''}`], ['Schedule', (r) => <Badge status={r.scheduleClass} />], ['Quality', (r) => quality(r.qualityRating)], ['Compliance', (r) => humanize(r.complianceRating)], ['Review', (r) => <Badge status={r.status} />],
          ]} />}
          {tab === 'issues' && <SimpleTable rows={data.issues} cols={[['Issue', (r) => <span className="font-mono text-xs">{r.issueCode}</span>], ['Description', (r) => r.description], ['Category', (r) => humanize(r.category)], ['Severity', (r) => <Badge status={r.severity} />], ['Target', (r) => fmtDate(r.targetDate)], ['Status', (r) => <Badge status={r.status} />], ['Report', (r) => r.report.reportNo]]} />}
          {tab === 'actions' && <SimpleTable rows={data.actions} cols={[['Action', (r) => r.description], ['Type', (r) => humanize(r.actionType)], ['Issue', (r) => r.issue?.issueCode ?? '—'], ['Responsible', (r) => r.responsible ?? '—'], ['Target', (r) => fmtDate(r.targetDate)], ['Status', (r) => <Badge status={r.status} />]]} />}
          {tab === 'risks' && <SimpleTable rows={data.risks} cols={[['Risk', (r) => <span className="font-mono text-xs">{r.riskCode}</span>], ['Description', (r) => r.description], ['Score', (r) => `${humanize(r.probability)} × ${humanize(r.impact)} = ${r.score}`], ['Level', (r) => <Badge status={r.level} />], ['Mitigation', (r) => r.mitigations.map((m: any) => m.measures).join('; ') || '—'], ['Status', (r) => <Badge status={r.status} />]]} />}
          {tab === 'photos' && (
            <div className="space-y-4">
              {data.canManage && <Uploader target="jm-asset" entityId={a.id} categories={['BEFORE_WORK', 'WORK_IN_PROGRESS', 'COMPLETED_WORK', 'OTHER'].map((c) => ({ value: c, label: humanize(c) }))} withGeo onUploaded={reload} compact />}
              <Gallery photos={data.photos} onChanged={reload} canRemove={() => data.canManage} meta={(f: any) => f.jmReport && <Link to={`/jm/reports/${f.jmReport.id}`} className="font-mono text-brand hover:underline">{f.jmReport.reportNo}</Link>} />
            </div>
          )}
          {tab === 'approvals' && <SimpleTable rows={data.approvalHistory} cols={[['Date', (r) => fmtDateTime(r.createdAt)], ['Report', (r) => r.ref], ['Action', (r) => humanize(r.action)], ['Level', (r) => r.levelName ?? '—'], ['By', (r) => r.actorName], ['Remarks', (r) => r.remarks ?? '—']]} />}
        </Card>
      </div>
      {edit && <AssetModal asset={a} onClose={() => setEdit(false)} onDone={() => { clearCache('/api/jm'); reload(); }} />}
    </>
  );
}

export function SimpleTable({ rows, cols }: { rows: any[]; cols: [string, (r: any) => any][] }) {
  if (!rows.length) return <p className="p-6 text-center text-sm text-ink-3">No records.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-ink-3"><tr>{cols.map(([h]) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{rows.map((r, i) => <tr key={r.id ?? i} className="align-top">{cols.map(([h, f]) => <td key={h} className="px-3 py-2">{f(r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
