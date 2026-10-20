import { useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useDebounced, useDistricts, useLookups, useQueryState } from '../../lib/hooks';
import { fmtDate, fmtMoney, fmtNum, humanize } from '../../lib/format';
import { Badge, Card, LinkButton, PageHeader, Pagination, Tabs } from '../../components/ui';
import { DataTable, ExportMenu, FilterBar, MiniDate, MiniSelect, SearchInput } from '../../components/DataTable';

export default function ReportList() {
  const { can } = useAuth();
  const nav = useNavigate();
  const districts = useDistricts();
  const categories = useLookups('ACTIVITY_CATEGORY');
  const [q, setQ] = useQueryState({ scope: can('daamr.report.view_all', 'daamr.report.view_district') ? 'all' : 'mine', q: '', districtId: '', category: '', activityStatus: '', reportStatus: '', officer: '', from: '', to: '', page: '1' });
  const search = useDebounced(q.q);
  const officer = useDebounced(q.officer);
  const params = { ...q, q: search, officer };
  const { data, loading } = useApi(`/api/daamr/reports${qs(params)}`);
  return (
    <>
      <PageHeader
        title="Activity Reports"
        subtitle="Completed-activity documentation: participants, budget utilisation, media coverage and evidence."
        actions={<>{can('daamr.export') && <ExportMenu url={(f) => `/api/daamr/reports/export${qs({ ...params, format: f, page: '' })}`} />}{can('daamr.report.create') && <LinkButton to="/daamr/reports/new" icon={<Plus className="size-4" />}>New activity report</LinkButton>}</>}
      />
      <Tabs value={q.scope} onChange={(v) => setQ({ scope: v })} tabs={[...(can('daamr.report.view_all', 'daamr.report.view_district') ? [{ value: 'all', label: 'All reports' }] : []), { value: 'assigned', label: 'Awaiting my verification' }, { value: 'mine', label: 'My reports' }]} />
      <Card bodyClass="p-0">
        <FilterBar onReset={() => setQ({ q: '', districtId: '', category: '', activityStatus: '', reportStatus: '', officer: '', from: '', to: '' })}>
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v })} placeholder="DAAMR ID, report no., activity…" />
          <MiniSelect label="District" value={q.districtId} onChange={(v) => setQ({ districtId: v })} options={districts.map((d) => ({ value: d.id, label: d.name }))} />
          <MiniSelect label="Category" value={q.category} onChange={(v) => setQ({ category: v })} options={categories.map((c) => ({ value: c.value, label: c.label }))} />
          <MiniSelect label="Activity status" value={q.activityStatus} onChange={(v) => setQ({ activityStatus: v })} options={['PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'POSTPONED', 'CANCELLED'].map((s) => ({ value: s, label: humanize(s) }))} />
          <MiniSelect label="Report status" value={q.reportStatus} onChange={(v) => setQ({ reportStatus: v })} options={['DRAFT', 'UNDER_VERIFICATION', 'RETURNED', 'VERIFIED'].map((s) => ({ value: s, label: humanize(s) }))} />
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">Officer<input className="rounded-lg border border-line px-2.5 py-2 text-sm" value={q.officer} onChange={(e) => setQ({ officer: e.target.value })} placeholder="Name" /></label>
          <MiniDate label="Activity from" value={q.from} onChange={(v) => setQ({ from: v })} />
          <MiniDate label="Activity to" value={q.to} onChange={(v) => setQ({ to: v })} />
        </FilterBar>
        <DataTable
          loading={loading}
          rows={data?.rows}
          onRowClick={(r: any) => nav(`/daamr/reports/${r.id}`)}
          columns={[
            { key: 'daamrId', header: 'DAAMR ID', primary: true, render: (r: any) => <span className="font-mono text-xs font-medium text-brand">{r.daamrId}</span> },
            { key: 'activityDate', header: 'Activity date', render: (r: any) => fmtDate(r.activityDate) },
            { key: 'district', header: 'District', render: (r: any) => r.district.name },
            { key: 'activityName', header: 'Activity', render: (r: any) => <span className="font-medium">{r.activityName}</span> },
            { key: 'category', header: 'Category', render: (r: any) => categories.find((c) => c.value === r.category)?.label ?? humanize(r.category) },
            { key: 'responsibleOfficer', header: 'Officer' },
            { key: 'participants', header: 'Participants', className: 'text-right', render: (r: any) => <span className="tabular">{fmtNum(r.participants?.total)}</span> },
            { key: 'budget', header: 'Utilized', className: 'text-right', render: (r: any) => <span className={`tabular ${r.budget && r.budget.remaining < 0 ? 'text-red-700' : ''}`}>{fmtMoney(r.budget?.utilized)}</span> },
            { key: 'activityStatus', header: 'Activity', render: (r: any) => <Badge status={r.activityStatus} /> },
            { key: 'reportStatus', header: 'Report status', render: (r: any) => <Badge status={r.reportStatus} /> },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ page: String(p) })} />}
      </Card>
    </>
  );
}
