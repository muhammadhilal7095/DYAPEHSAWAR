import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDebounced, useDistricts, useQueryState } from '../../lib/hooks';
import { addDays, fmtDate, humanize, todayISO, fmtMonth } from '../../lib/format';
import { Badge, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { ExportMenu, MiniDate, MiniSelect, SearchInput } from '../../components/DataTable';
import { ChartCard, Columns, HBars } from '../../components/Charts';
import { SimpleTable } from './AssetDetail';

export default function JmAnalytics() {
  const { can } = useAuth();
  const districts = useDistricts();
  const assets = useCached<any>('/api/jm/assets')?.rows ?? [];
  const [q, setQ] = useQueryState({ from: addDays(todayISO(), -365), to: todayISO(), districtId: '', assetId: '', status: '', search: '' });
  const [search, setSearch] = useState(q.search);
  const debounced = useDebounced(search);
  useEffect(() => { if (debounced !== q.search) setQ({ search: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: d, loading, error } = useApi(`/api/jm/dashboard/analytics${qs(q)}`);
  const two = [{ key: 'name', label: 'Category' }, { key: 'value', label: 'Count', numeric: true }];
  return (
    <>
      <PageHeader title="Jawan Markaz Reports & Analytics" subtitle="Status distributions use each asset's latest verified report in the period." actions={can('jm.export') && <ExportMenu compact url={(f) => `/api/jm/dashboard/analytics/export${qs({ ...q, format: f })}`} />} />
      <div className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 shadow-sm">
        <MiniDate label="From" value={q.from} onChange={(v) => setQ({ from: v })} />
        <MiniDate label="To" value={q.to} onChange={(v) => setQ({ to: v })} />
        <MiniSelect label="District" value={q.districtId} onChange={(v) => setQ({ districtId: v })} options={districts.map((x) => ({ value: x.id, label: x.name }))} />
        <MiniSelect label="Asset" value={q.assetId} onChange={(v) => setQ({ assetId: v })} options={assets.map((a: any) => ({ value: a.id, label: a.name }))} />
        <MiniSelect label="Review status" value={q.status} onChange={(v) => setQ({ status: v })} options={['PENDING_REVIEW', 'UNDER_REVIEW', 'RETURNED', 'REJECTED', 'VERIFIED'].map((x) => ({ value: x, label: humanize(x) }))} />
        <div className="min-w-48 flex-1"><SearchInput value={search} onChange={setSearch} placeholder="Search report ID, asset or district…" /></div>
      </div>
      <ErrorBox error={error} />
      {loading && !d ? <Spinner /> : d && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="District-wise project progress" subtitle="Latest verified report per asset" bodyClass="p-0" className="lg:col-span-2">
            <SimpleTable rows={d.districtProgress} cols={[['District / HQ', (r) => r.district], ['Assets', (r) => r.assets], ['Avg progress', (r) => `${r.avg}%`], ['On schedule', (r) => r.onSchedule], ['Delayed', (r) => r.delayed]]} />
          </Card>
          <Card title="Planned vs actual progress" subtitle="Latest verified report per asset — furthest behind plan first" bodyClass="p-0" className="lg:col-span-2">
            <SimpleTable rows={d.progressComparison} cols={[['Asset', (r) => <Link className="text-brand hover:underline" to={`/jm/assets/${r.assetId}`}>{r.asset}</Link>], ['District', (r) => r.district], ['Planned', (r) => (r.planned != null ? `${r.planned}%` : '—')], ['Actual', (r) => `${r.actual}%`], ['Gap', (r) => (r.gap != null ? <span className={r.gap < 0 ? 'text-red-700' : ''}>{r.gap > 0 ? '+' : ''}{r.gap} pts</span> : '—')], ['Delay', (r) => (r.delayDays ? `${r.delayDays} days` : '—')], ['Schedule', (r) => <Badge status={r.scheduleClass} />], ['Report', (r) => <Link className="font-mono text-xs text-brand hover:underline" to={`/jm/reports/${r.reportId}`}>{r.reportNo}</Link>]]} />
          </Card>
          <Card title={`Reports awaiting review (${d.pendingReview.length})`} subtitle="Oldest at their current level first" bodyClass="p-0" className="lg:col-span-2">
            <SimpleTable rows={d.pendingReview} cols={[['Report', (r) => <Link className="font-mono text-xs text-brand hover:underline" to={`/jm/reports/${r.reportId}`}>{r.reportNo}</Link>], ['Asset', (r) => r.asset], ['District', (r) => r.district], ['Level', (r) => r.level ?? '—'], ['Assigned to', (r) => r.assignee ?? <span className="text-amber-700">Awaiting assignment</span>], ['Days at level', (r) => r.daysWaiting ?? '—'], ['Days since submission', (r) => r.daysSinceSubmission ?? '—']]} />
          </Card>
          <Card title="Review turnaround" subtitle="Days from submission to final verification" bodyClass="p-0" className="lg:col-span-2">
            <SimpleTable rows={d.turnaround} cols={[['District / HQ', (r) => r.district], ['Verified reports', (r) => r.verified], ['Average days', (r) => r.avgDays], ['Longest', (r) => `${r.maxDays} days`]]} />
          </Card>
          <ChartCard title="Schedule performance" rows={d.scheduleDistribution} columns={two}><HBars data={d.scheduleDistribution} valueLabel="Assets" /></ChartCard>
          <ChartCard title="Quality of work" rows={d.qualityDistribution} columns={two}><HBars data={d.qualityDistribution} valueLabel="Assets" /></ChartCard>
          <ChartCard title="Compliance" rows={d.complianceDistribution} columns={two}><HBars data={d.complianceDistribution} valueLabel="Assets" /></ChartCard>
          <ChartCard title="Reports per month" rows={d.monthly.map((m: any) => ({ ...m, month: fmtMonth(m.month) }))} columns={[{ key: 'month', label: 'Month' }, { key: 'value', label: 'Reports', numeric: true }]}><Columns data={d.monthly.map((m: any) => ({ ...m, month: fmtMonth(m.month) }))} valueLabel="Reports" /></ChartCard>
          <ChartCard title="Issues by severity" rows={d.issuesBySeverity} columns={two}><HBars data={d.issuesBySeverity} valueLabel="Issues" /></ChartCard>
          <ChartCard title="Issues by category" rows={d.issuesByCategory} columns={two}><HBars data={d.issuesByCategory} valueLabel="Issues" /></ChartCard>
          <ChartCard title="Risks by level" rows={d.risksByLevel} columns={two}><HBars data={d.risksByLevel} valueLabel="Risks" /></ChartCard>
          <ChartCard title="Risks by status" rows={d.risksByStatus} columns={two}><HBars data={d.risksByStatus} valueLabel="Risks" /></ChartCard>
          <ChartCard title="Corrective actions by status" rows={d.actionsByStatus} columns={two}><HBars data={d.actionsByStatus} valueLabel="Actions" /></ChartCard>
          <ChartCard title="Issues by status" rows={d.issuesByStatus} columns={two}><HBars data={d.issuesByStatus} valueLabel="Issues" /></ChartCard>
          <ChartCard title="Inspection types" rows={d.inspectionTypes} columns={two}><HBars data={d.inspectionTypes} valueLabel="Reports" /></ChartCard>
          <ChartCard title="Review status of reports" rows={d.reviewStatus} columns={two}><HBars data={d.reviewStatus} valueLabel="Reports" /></ChartCard>
          <Card title="Asset-wise inspection history" bodyClass="p-0" className="lg:col-span-2">
            <SimpleTable rows={d.assetInspections} cols={[['Asset', (r) => r.asset], ['Reports', (r) => r.reports], ['Verified', (r) => r.verified], ['Last inspection', (r) => fmtDate(r.lastInspection)], ['Latest verified progress', (r) => (r.latestProgress != null ? `${r.latestProgress}%` : '—')]]} />
          </Card>
          <Card title="Inspection schedule" subtitle="Next follow-up inspection set in each asset's latest verified report" bodyClass="p-0" className="lg:col-span-2">
            <SimpleTable rows={d.inspectionSchedule} cols={[['Asset', (r) => r.asset], ['District', (r) => r.district], ['Next inspection due', (r) => fmtDate(r.due)], ['Status', (r) => <Badge status={r.state === 'OVERDUE' ? 'FAILED' : r.state === 'DUE_SOON' ? 'PENDING' : 'SCHEDULED'} label={humanize(r.state)} />], ['Days overdue', (r) => r.daysOverdue || '—']]} />
          </Card>
          <Card title={`Overdue corrective actions (${d.overdueActions.length})`} bodyClass="p-0" className="lg:col-span-2">
            <SimpleTable rows={d.overdueActions} cols={[['Asset', (r) => r.asset], ['Action', (r) => r.description], ['Responsible', (r) => r.responsible ?? '—'], ['Target', (r) => <span className="text-red-700">{fmtDate(r.target)}</span>], ['Status', (r) => humanize(r.status)]]} />
          </Card>
        </div>
      )}
    </>
  );
}
