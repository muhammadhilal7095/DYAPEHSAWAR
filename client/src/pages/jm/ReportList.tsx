import { useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDebounced, useDistricts, useLookups, useQueryState } from '../../lib/hooks';
import { fmtDate, fmtDateTime, humanize } from '../../lib/format';
import { Badge, Card, LinkButton, PageHeader, Pagination, Tabs } from '../../components/ui';
import { DataTable, ExportMenu, FilterBar, MiniDate, MiniSelect, SearchInput } from '../../components/DataTable';

export default function JmReportList() {
  const { can } = useAuth();
  const nav = useNavigate();
  const districts = useDistricts();
  const assets = useCached<any>('/api/jm/assets')?.rows ?? [];
  const quality = useLookups('JM_QUALITY');
  const canAll = can('jm.report.view_all', 'jm.report.view_district');
  const [q, setQ] = useQueryState({ scope: canAll ? 'all' : 'mine', q: '', districtId: '', assetId: '', status: '', scheduleClass: '', qualityRating: '', from: '', to: '', dateField: 'reporting', page: '1' });
  const search = useDebounced(q.q);
  const params = { ...q, q: search };
  const { data, loading } = useApi(`/api/jm/reports${qs(params)}`);
  return (
    <>
      <PageHeader
        title="Monitoring Reports"
        subtitle="Jawan Markaz inspection and progress reports with review status."
        actions={<>{can('jm.export') && <ExportMenu url={(f) => `/api/jm/reports/export${qs({ ...params, format: f, page: '' })}`} />}{can('jm.report.create') && <LinkButton to="/jm/reports/new" icon={<Plus className="size-4" />}>New report</LinkButton>}</>}
      />
      <Tabs value={q.scope} onChange={(v) => setQ({ scope: v })} tabs={[...(canAll ? [{ value: 'all', label: 'All reports' }] : []), { value: 'assigned', label: 'Assigned to me' }, ...(can('jm.report.create') ? [{ value: 'mine', label: 'My reports' }] : [])]} />
      <Card bodyClass="p-0">
        <FilterBar onReset={() => setQ({ q: '', districtId: '', assetId: '', status: '', scheduleClass: '', qualityRating: '', from: '', to: '' })}>
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v })} placeholder="DAAMR ID or asset…" />
          <MiniSelect label="District" value={q.districtId} onChange={(v) => setQ({ districtId: v })} options={districts.map((d) => ({ value: d.id, label: d.name }))} />
          <MiniSelect label="Asset" value={q.assetId} onChange={(v) => setQ({ assetId: v })} options={assets.map((a: any) => ({ value: a.id, label: a.name }))} />
          <MiniSelect label="Review status" value={q.status} onChange={(v) => setQ({ status: v })} options={['DRAFT', 'PENDING_REVIEW', 'UNDER_REVIEW', 'RETURNED', 'REJECTED', 'VERIFIED'].map((s) => ({ value: s, label: humanize(s) }))} />
          <MiniSelect label="Schedule" value={q.scheduleClass} onChange={(v) => setQ({ scheduleClass: v })} options={['ON_SCHEDULE', 'SLIGHTLY_DELAYED', 'SIGNIFICANTLY_DELAYED', 'NOT_APPLICABLE'].map((s) => ({ value: s, label: humanize(s) }))} />
          <MiniSelect label="Quality" value={q.qualityRating} onChange={(v) => setQ({ qualityRating: v })} options={quality.map((x) => ({ value: x.value, label: x.label }))} />
          <MiniSelect label="Date" value={q.dateField} all={null} onChange={(v) => setQ({ dateField: v })} options={[{ value: 'reporting', label: 'Reporting date' }, { value: 'inspection', label: 'Inspection date' }]} />
          <MiniDate label="From" value={q.from} onChange={(v) => setQ({ from: v })} />
          <MiniDate label="To" value={q.to} onChange={(v) => setQ({ to: v })} />
        </FilterBar>
        <DataTable
          loading={loading}
          rows={data?.rows}
          onRowClick={(r: any) => nav(`/jm/reports/${r.id}`)}
          columns={[
            { key: 'reportNo', header: 'DAAMR ID', primary: true, render: (r: any) => <span className="font-mono text-xs font-medium text-brand">{r.reportNo}</span> },
            { key: 'asset', header: 'Jawan Markaz', render: (r: any) => <span className="font-medium">{r.asset.name}</span> },
            { key: 'district', header: 'District', render: (r: any) => r.district.name },
            { key: 'period', header: 'Period', render: (r: any) => <span className="whitespace-nowrap text-xs">{fmtDate(r.periodFrom)} – {fmtDate(r.periodTo)}</span> },
            { key: 'inspection', header: 'Inspection', render: (r: any) => fmtDate(r.inspectionDate) },
            { key: 'progress', header: 'Progress', render: (r: any) => <span className="tabular">{r.currentProgress}%{r.progressDiscrepancy && <span className="ml-1 text-amber-700" title="Progress discrepancy flagged">⚑</span>}</span> },
            { key: 'schedule', header: 'Schedule', render: (r: any) => <Badge status={r.scheduleClass} /> },
            { key: 'quality', header: 'Quality', render: (r: any) => <Badge status={r.qualityRating} label={quality.find((x) => x.value === r.qualityRating)?.label} /> },
            { key: 'officer', header: 'Officer', render: (r: any) => r.reportingOfficer.name, hideOnCard: true },
            { key: 'with', header: 'With', render: (r: any) => (r.currentAssignee ? `${r.currentAssignee.name}` : '—') },
            { key: 'status', header: 'Review status', render: (r: any) => <Badge status={r.status} /> },
            { key: 'updated', header: 'Updated', hideOnCard: true, render: (r: any) => <span className="text-xs text-ink-3">{fmtDateTime(r.updatedAt)}</span> },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ page: String(p) })} />}
      </Card>
    </>
  );
}
