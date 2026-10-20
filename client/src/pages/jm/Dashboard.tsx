import { Link } from 'react-router';
import { ClipboardCheck, Plus, ShieldAlert } from 'lucide-react';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDistricts, useQueryState } from '../../lib/hooks';
import { addDays, fmtNum, humanize, todayISO } from '../../lib/format';
import { Card, ErrorBox, LinkButton, PageHeader, Spinner } from '../../components/ui';
import { ExportMenu, MiniDate } from '../../components/DataTable';

export function DistrictAssetSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const districts = useDistricts();
  const assets = useCached<any>('/api/jm/assets')?.rows ?? [];
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">
      Select District / Asset
      <select className="min-w-60 rounded-lg border border-line bg-white px-2.5 py-2 text-sm text-ink shadow-sm focus:border-brand focus:outline-none" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="all">All</option>
        <optgroup label="Districts / HQ">{districts.filter((d) => assets.some((a: any) => a.districtId === d.id)).map((d) => <option key={d.id} value={`district:${d.id}`}>{d.name}</option>)}</optgroup>
        <optgroup label="Jawan Markaz assets">{assets.map((a: any) => <option key={a.id} value={`asset:${a.id}`}>{a.name}</option>)}</optgroup>
      </select>
    </label>
  );
}

const CATS = [
  { key: 'onSchedule', label: 'On Schedule', tone: 'border-t-emerald-500', cls: 'ON_SCHEDULE' },
  { key: 'slightlyDelayed', label: 'Slightly Delayed', tone: 'border-t-amber-400', cls: 'SLIGHTLY_DELAYED' },
  { key: 'significantlyDelayed', label: 'Significantly Delayed', tone: 'border-t-red-500', cls: 'SIGNIFICANTLY_DELAYED' },
  { key: 'satisfactoryQuality', label: 'Satisfactory Quality', tone: 'border-t-blue-500', cls: '' },
] as const;

export default function JmDashboard() {
  const { can } = useAuth();
  const [q, setQ] = useQueryState({ from: addDays(todayISO(), -90), to: todayISO(), filter: 'all' });
  const { data: d, loading, error } = useApi(`/api/jm/dashboard${qs(q)}`);
  const s = d?.summary;
  const reports = (extra: any) => `/jm/reports${qs({ scope: 'all', from: q.from, to: q.to, ...(q.filter.startsWith('asset:') ? { assetId: q.filter.slice(6) } : q.filter.startsWith('district:') ? { districtId: q.filter.slice(9) } : {}), ...extra })}`;
  const rows: [string, number | undefined, string?, string?][] = s ? [
    ['Total JMs Reports', s.totalReports, reports({}), 'Distinct submitted reports in the period'],
    ['On Schedule', s.onSchedule, undefined, 'Distinct assets — latest verified report'],
    ['Slightly Delayed', s.slightlyDelayed, undefined, 'Distinct assets — latest verified report'],
    ['Significantly Delayed', s.significantlyDelayed, undefined, 'Distinct assets — latest verified report'],
    ['Satisfactory Quality', s.satisfactoryQuality, undefined, `Quality rated ${d.rules.satisfactoryQualityValues.map(humanize).join(' / ')}`],
  ] : [];
  const extra: [string, number | undefined, string?][] = s ? [
    ['Reports pending review', s.pendingReview, reports({ status: 'PENDING_REVIEW,UNDER_REVIEW' })],
    ['Reports approved / verified', s.approved, reports({ status: 'VERIFIED' })],
    ['Returned for correction', s.returned, reports({ status: 'RETURNED' })],
    ['Projects in progress', s.projectsInProgress, '/jm/assets'],
    ['Projects completed', s.projectsCompleted, '/jm/assets?status=COMPLETED'],
    ['Open issues', s.openIssues, '/jm/registers?tab=issues&status=OPEN,UNDER_REVIEW,ACTION_REQUIRED,IN_PROGRESS'],
    ['Critical risks', s.criticalRisks, '/jm/registers?tab=risks&level=CRITICAL'],
    ['Pending corrective actions', s.pendingActions, '/jm/registers?tab=actions&status=OPEN,IN_PROGRESS'],
    ['Overdue inspections', s.overdueInspections, '/jm/registers?tab=inspections'],
    ['Inspections due within 7 days', s.inspectionsDueSoon, '/jm/registers?tab=inspections'],
  ] : [];

  return (
    <>
      <PageHeader title="Jawan Markaz Monitoring Dashboard" subtitle="Asset status categories count distinct assets using each asset's latest verified report in the period." actions={<>
        <LinkButton variant="secondary" to="/jm/reports" icon={<ClipboardCheck className="size-4" />}>Monitoring reports</LinkButton>
        <LinkButton variant="secondary" to="/jm/registers" icon={<ShieldAlert className="size-4" />}>Issues & risks</LinkButton>
        {can('jm.report.create') && <LinkButton to="/jm/reports/new" icon={<Plus className="size-4" />}>New report</LinkButton>}
      </>} />
      <div className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 shadow-sm">
        <MiniDate label="From Date" value={q.from} onChange={(v) => setQ({ from: v })} />
        <MiniDate label="To Date" value={q.to} onChange={(v) => setQ({ to: v })} />
        <DistrictAssetSelect value={q.filter} onChange={(v) => setQ({ filter: v })} />
        <div className="ml-auto">{can('jm.export') && <ExportMenu url={(f) => `/api/jm/dashboard/export${qs({ ...q, format: f })}`} />}</div>
      </div>
      <ErrorBox error={error} />
      {loading && !d ? <Spinner /> : d && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
            <Card title="Summary Report" subtitle={d.filters.label} bodyClass="p-0">
              <table className="w-full text-sm">
                <thead className="bg-brand text-left text-xs uppercase tracking-wide text-white"><tr><th className="px-4 py-2 font-medium">Metric</th><th className="px-4 py-2 text-right font-medium">Count</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {rows.map(([label, v, to, hint]) => (
                    <tr key={label} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">{label}<span className="block text-xs text-ink-3">{hint}</span></td>
                      <td className="tabular px-4 py-2.5 text-right text-lg font-semibold">{to ? <Link to={to} className="text-brand hover:underline">{fmtNum(v)}</Link> : fmtNum(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Additional indicators" bodyClass="p-0">
              <ul className="grid divide-line sm:grid-cols-2 [&>li]:border-b [&>li]:border-line sm:[&>li:nth-child(odd)]:border-r">
                {extra.map(([label, v, to]) => (
                  <li key={label}>
                    <Link to={to ?? '#'} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50">
                      <span className="text-sm text-ink-2">{label}</span>
                      <span className="tabular text-lg font-semibold">{fmtNum(v)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {CATS.map((c) => {
              const list = d.lists[c.key] as any[];
              const prov = (d.provisional[c.key] as any[]).filter((p) => !list.some((x) => x.assetId === p.assetId));
              return (
                <section key={c.key} className={`rounded-xl border border-line border-t-4 ${c.tone} bg-white shadow-sm print-card`}>
                  <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
                    <h2 className="text-sm font-semibold">{c.label}</h2>
                    <span className="tabular rounded-full bg-gray-100 px-2 text-sm font-semibold">{list.length}</span>
                  </header>
                  <ul className="divide-y divide-line">
                    {list.map((a) => (
                      <li key={a.assetId} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                        <Link to={`/jm/assets/${a.assetId}`} className="min-w-0 truncate font-medium hover:text-brand hover:underline">{a.name}</Link>
                        <Link to={`/jm/reports/${a.reportId}`} className="tabular shrink-0 text-xs text-ink-3 hover:underline">{a.progress}%</Link>
                      </li>
                    ))}
                    {!list.length && <li className="px-4 py-3 text-sm text-ink-3">No verified assets</li>}
                  </ul>
                  {prov.length > 0 && (
                    <div className="border-t border-dashed border-line bg-gray-50/60 px-4 py-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Provisional — awaiting approval</p>
                      <ul className="mt-1 space-y-0.5">{prov.map((a) => <li key={a.assetId} className="text-xs italic text-ink-2"><Link to={`/jm/reports/${a.reportId}`} className="hover:underline">{a.name}</Link></li>)}</ul>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          <p className="text-xs text-ink-3">
            Delay thresholds (configurable): up to {d.rules.slightDelayMaxDays} days late, or up to {d.rules.slightGapMaxPct} percentage points behind plan = slightly delayed; beyond = significantly delayed.
            {' '}{s.assetsReported} of {s.totalAssets} active assets have a verified report in this period.
          </p>
        </div>
      )}
    </>
  );
}
