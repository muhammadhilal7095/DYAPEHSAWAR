import { Link } from 'react-router';
import { AlarmClock, AlertTriangle, Award, BadgeCheck, Building2, CalendarClock, CheckCircle2, CircleAlert, ClipboardCheck, Clock, CornerUpLeft, Hourglass, Landmark, Plus, ShieldAlert, Wrench } from 'lucide-react';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDistricts, useQueryState } from '../../lib/hooks';
import { addDays, fmtNum, humanize, todayISO } from '../../lib/format';
import { ErrorBox, KpiTile, LinkButton, PageHeader, Spinner, StatStrip } from '../../components/ui';
import { ExportMenu, MiniDate } from '../../components/DataTable';

export function DistrictAssetSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const districts = useDistricts();
  const assets = useCached<any>('/api/jm/assets')?.rows ?? [];
  return (
    <label className="flex w-full flex-col gap-1 text-xs font-medium text-ink-3 sm:w-auto">
      District / asset
      <select className="w-full rounded-lg sm:min-w-60 border border-line bg-white px-2.5 py-2 text-sm text-ink shadow-sm focus:border-brand focus:outline-none" value={value} onChange={(e) => onChange(e.target.value)}>
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
  const pct = (n: number) => (s?.totalReports ? `${Math.round((n / Math.max(1, s.assetsReported)) * 100)}% of assets reported` : 'Latest verified report');

  return (
    <>
      <PageHeader
        title="Jawan Markaz Monitoring Dashboard"
        subtitle="Asset status counts distinct assets, using each asset's latest verified report in the period."
        actions={<>
          {can('jm.export') && <ExportMenu compact label="Export" url={(f) => `/api/jm/dashboard/export${qs({ ...q, format: f })}`} />}
          {can('jm.report.create') && <LinkButton to="/jm/reports/new" icon={<Plus className="size-4" />}>New report</LinkButton>}
        </>}
      />
      <div className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 shadow-sm">
        <MiniDate label="From date" value={q.from} onChange={(v) => setQ({ from: v })} />
        <MiniDate label="To date" value={q.to} onChange={(v) => setQ({ to: v })} />
        <DistrictAssetSelect value={q.filter} onChange={(v) => setQ({ filter: v })} />
        {d && <p className="ml-auto self-center text-xs text-ink-3 max-sm:w-full">Showing <span className="font-medium text-ink-2">{d.filters.label}</span></p>}
      </div>
      <ErrorBox error={error} />
      {loading && !d ? <Spinner /> : d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiTile label="Monitoring reports" value={fmtNum(s.totalReports)} note="Distinct submitted reports" to={reports({})} icon={<ClipboardCheck className="size-5" />} />
            <KpiTile label="On schedule" value={fmtNum(s.onSchedule)} note={pct(s.onSchedule)} icon={<CheckCircle2 className="size-5" />} tone="green" />
            <KpiTile label="Slightly delayed" value={fmtNum(s.slightlyDelayed)} note={pct(s.slightlyDelayed)} icon={<Clock className="size-5" />} tone="amber" />
            <KpiTile label="Significantly delayed" value={fmtNum(s.significantlyDelayed)} note={pct(s.significantlyDelayed)} icon={<AlertTriangle className="size-5" />} tone={s.significantlyDelayed ? 'red' : 'gray'} />
          </div>
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
            <StatStrip title="Reports & quality" items={[
              { label: 'Satisfactory quality', value: fmtNum(s.satisfactoryQuality), note: d.rules.satisfactoryQualityValues.map(humanize).join(' / '), icon: <Award className="size-4" />, tone: 'blue' },
              { label: 'Pending review', value: fmtNum(s.pendingReview), icon: <Hourglass className="size-4" />, tone: 'amber', to: reports({ status: 'PENDING_REVIEW,UNDER_REVIEW' }) },
              { label: 'Verified', value: fmtNum(s.approved), icon: <BadgeCheck className="size-4" />, tone: 'green', to: reports({ status: 'VERIFIED' }) },
              { label: 'Returned', value: fmtNum(s.returned), note: 'For correction', icon: <CornerUpLeft className="size-4" />, tone: 'red', to: reports({ status: 'RETURNED' }) },
            ]} />
            <StatStrip title="Coverage & inspections" items={[
              { label: 'Assets reported', value: <>{fmtNum(s.assetsReported)}<span className="text-sm font-medium text-ink-3"> / {fmtNum(s.totalAssets)}</span></>, note: 'With a verified report', icon: <Landmark className="size-4" />, tone: 'brand', to: '/jm/assets' },
              { label: 'Overdue inspections', value: fmtNum(s.overdueInspections), icon: <AlarmClock className="size-4" />, tone: s.overdueInspections ? 'red' : 'gray', to: '/jm/registers?tab=inspections' },
              { label: 'Due in 7 days', value: fmtNum(s.inspectionsDueSoon), note: 'Upcoming inspections', icon: <CalendarClock className="size-4" />, tone: 'amber', to: '/jm/registers?tab=inspections' },
              { label: 'Projects completed', value: fmtNum(s.projectsCompleted), note: `${fmtNum(s.projectsInProgress)} in progress`, icon: <Building2 className="size-4" />, tone: 'green', to: '/jm/assets?status=COMPLETED' },
            ]} />
          </div>
          <StatStrip title="Issues, actions & risks" subtitle="Open items from the monitoring registers" items={[
            { label: 'Open issues', value: fmtNum(s.openIssues), icon: <CircleAlert className="size-4" />, tone: 'amber', to: '/jm/registers?tab=issues&status=OPEN,UNDER_REVIEW,ACTION_REQUIRED,IN_PROGRESS' },
            { label: 'Critical risks', value: fmtNum(s.criticalRisks), icon: <ShieldAlert className="size-4" />, tone: s.criticalRisks ? 'red' : 'gray', to: '/jm/registers?tab=risks&level=CRITICAL' },
            { label: 'Pending corrective actions', value: fmtNum(s.pendingActions), icon: <Wrench className="size-4" />, tone: 'blue', to: '/jm/registers?tab=actions&status=OPEN,IN_PROGRESS' },
          ]} />

          <h2 className="border-b border-line pb-2 pt-2 text-base font-semibold text-ink">Assets by progress status</h2>
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
