import { CheckCircle2, ClipboardList, Clock, CornerUpLeft, FileCheck2, FileWarning, Hourglass, PlayCircle, Users, Wallet, XCircle, CalendarClock, BadgeCheck, Banknote } from 'lucide-react';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useDistricts, useQueryState } from '../../lib/hooks';
import { fmtMoney, fmtNum } from '../../lib/format';
import { ErrorBox, PageHeader, Spinner, Stat } from '../../components/ui';
import { ExportMenu, MiniDate, MiniSelect } from '../../components/DataTable';
import { ChartCard, Columns, HBars, PairedBars, SERIES } from '../../components/Charts';

export function DaamrFilters({ q, setQ }: { q: any; setQ: (p: any) => void }) {
  const districts = useDistricts();
  return (
    <div className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 shadow-sm">
      <MiniDate label="From date" value={q.from} onChange={(v) => setQ({ from: v })} />
      <MiniDate label="To date" value={q.to} onChange={(v) => setQ({ to: v })} />
      <MiniSelect label="District / HQ" value={q.districtId} onChange={(v) => setQ({ districtId: v })} options={districts.map((d) => ({ value: d.id, label: d.name }))} />
      {(q.from || q.to || q.districtId) && <button className="pb-2 text-sm text-ink-3 hover:text-ink" onClick={() => setQ({ from: '', to: '', districtId: '' })}>Clear</button>}
    </div>
  );
}

export default function DaamrDashboard() {
  const { can } = useAuth();
  const [q, setQ] = useQueryState({ from: '', to: '', districtId: '' });
  const { data: d, loading, error } = useApi(`/api/daamr/dashboard${qs(q)}`);
  const link = (status: string) => `/daamr/requests${qs({ scope: 'all', status, from: q.from, to: q.to, districtId: q.districtId })}`;
  return (
    <>
      <PageHeader title="Participation & Budget Summary" subtitle="Live figures from saved records, limited to the records you are permitted to see." actions={can('daamr.export') && <ExportMenu url={(f) => `/api/daamr/dashboard/export${qs({ ...q, format: f })}`} />} />
      <DaamrFilters q={q} setQ={setQ} />
      <ErrorBox error={error} />
      {loading && !d ? <Spinner /> : d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
            <Stat label="Total requests" value={fmtNum(d.cards.totalRequests)} to={link('')} icon={<ClipboardList className="size-5" />} />
            <Stat label="Pending review" value={fmtNum(d.cards.pending)} to={link('PENDING_REVIEW')} icon={<Clock className="size-5" />} tone="amber" />
            <Stat label="Under review" value={fmtNum(d.cards.underReview)} to={link('UNDER_REVIEW')} icon={<Hourglass className="size-5" />} tone="blue" />
            <Stat label="Approved" value={fmtNum(d.cards.approved)} to={link('APPROVED')} icon={<CheckCircle2 className="size-5" />} tone="green" />
            <Stat label="Rejected" value={fmtNum(d.cards.rejected)} to={link('REJECTED')} icon={<XCircle className="size-5" />} tone="red" />
            <Stat label="Returned for revision" value={fmtNum(d.cards.returned)} to={link('RETURNED')} icon={<CornerUpLeft className="size-5" />} tone="amber" />
            <Stat label="Activities scheduled" value={fmtNum(d.cards.scheduled)} icon={<CalendarClock className="size-5" />} tone="blue" hint={`${d.cards.inProgress} in progress`} />
            <Stat label="Activities completed" value={fmtNum(d.cards.completed)} icon={<PlayCircle className="size-5" />} tone="green" />
            <Stat label="Final reports pending" value={fmtNum(d.cards.finalReportsPending)} icon={<FileWarning className="size-5" />} tone="amber" />
            <Stat label="Verified activity reports" value={fmtNum(d.cards.verifiedReports)} to="/daamr/reports?reportStatus=VERIFIED" icon={<FileCheck2 className="size-5" />} tone="green" />
            <Stat label="Total participants" value={fmtNum(d.cards.totalParticipants)} icon={<Users className="size-5" />} />
            <Stat label="Budget allocated" value={fmtMoney(d.cards.budgetAllocated)} icon={<Wallet className="size-5" />} tone="gray" />
            <Stat label="Budget utilized" value={fmtMoney(d.cards.budgetUtilized)} icon={<Banknote className="size-5" />} tone={d.cards.budgetUtilized > d.cards.budgetAllocated ? 'red' : 'gray'} hint={d.cards.budgetAllocated ? `${Math.round((d.cards.budgetUtilized / d.cards.budgetAllocated) * 100)}% of allocation` : undefined} />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Activities by district" rows={d.charts.byDistrict} columns={[{ key: 'name', label: 'District' }, { key: 'value', label: 'Activities', numeric: true }]} height={300}><HBars data={d.charts.byDistrict} valueLabel="Activities" /></ChartCard>
            <ChartCard title="Activities by category" rows={d.charts.byCategory} columns={[{ key: 'name', label: 'Category' }, { key: 'value', label: 'Activities', numeric: true }]} height={300}><HBars data={d.charts.byCategory} valueLabel="Activities" /></ChartCard>
            <ChartCard title="Monthly activity count" subtitle="By activity / start month" rows={d.charts.monthly} columns={[{ key: 'month', label: 'Month' }, { key: 'value', label: 'Activities', numeric: true }]}><Columns data={d.charts.monthly} valueLabel="Activities" /></ChartCard>
            <ChartCard title="Request approval status" rows={d.charts.approvalStatus} columns={[{ key: 'name', label: 'Status' }, { key: 'value', label: 'Requests', numeric: true }]}><HBars data={d.charts.approvalStatus} valueLabel="Requests" /></ChartCard>
            <ChartCard title="Participant demographics" subtitle="Overlapping categories are shown separately" rows={d.charts.demographics} columns={[{ key: 'name', label: 'Category' }, { key: 'value', label: 'Participants', numeric: true }]}><HBars data={d.charts.demographics} valueLabel="Participants" color={SERIES[0]} /></ChartCard>
            <ChartCard title="Allocated versus utilized budget" subtitle="PKR, by district" rows={d.charts.budgetByDistrict} columns={[{ key: 'name', label: 'District' }, { key: 'allocated', label: 'Allocated', numeric: true }, { key: 'utilized', label: 'Utilized', numeric: true }]}><PairedBars data={d.charts.budgetByDistrict} series={[{ key: 'allocated', label: 'Allocated' }, { key: 'utilized', label: 'Utilized' }]} /></ChartCard>
            <ChartCard title="Approval processing time" subtitle="Average hours from assignment to decision, per level" rows={d.charts.processingTimes} columns={[{ key: 'name', label: 'Level' }, { key: 'avgHours', label: 'Avg hours', numeric: true }, { key: 'decisions', label: 'Decisions', numeric: true }]}><HBars data={d.charts.processingTimes} valueKey="avgHours" valueLabel="Average hours" /></ChartCard>
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-line p-5 text-sm text-ink-3"><BadgeCheck className="size-5 shrink-0" />Requests are counted by submission date; participants and budgets by activity date. Drafts are excluded. A request and its final report count as one activity.</div>
          </div>
        </>
      )}
    </>
  );
}
