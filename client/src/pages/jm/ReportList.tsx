import { useNavigate } from 'react-router';
import { MapPin, Plus } from 'lucide-react';
import { ProgressBar } from '../courses/CourseList';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDebounced, useDistricts, useLookups, useQueryState } from '../../lib/hooks';
import { fmtDate, humanize } from '../../lib/format';
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
        subtitle="Inspection and progress reports for every Jawan Markaz, with review status."
        actions={<>{can('jm.export') && <ExportMenu compact label="Export" url={(f) => `/api/jm/reports/export${qs({ ...params, format: f, page: '' })}`} />}{can('jm.report.create') && <LinkButton to="/jm/reports/new" icon={<Plus className="size-4" />}>New report</LinkButton>}</>}
      />
      <Tabs value={q.scope} onChange={(v) => setQ({ scope: v })} tabs={[...(canAll ? [{ value: 'all', label: 'All reports' }] : []), { value: 'assigned', label: 'Assigned to me' }, ...(can('jm.report.create') ? [{ value: 'mine', label: 'My reports' }] : [])]} />
      <Card bodyClass="p-0">
        <FilterBar
          onReset={() => setQ({ q: '', districtId: '', assetId: '', status: '', scheduleClass: '', qualityRating: '', from: '', to: '' })}
          moreActive={[q.districtId, q.qualityRating, q.from, q.to].filter(Boolean).length}
          more={
            <>
              <MiniSelect label="District" value={q.districtId} onChange={(v) => setQ({ districtId: v })} options={districts.map((d) => ({ value: d.id, label: d.name }))} />
              <MiniSelect label="Quality" value={q.qualityRating} onChange={(v) => setQ({ qualityRating: v })} options={quality.map((x) => ({ value: x.value, label: x.label }))} />
              <MiniSelect label="Date" value={q.dateField} all={null} onChange={(v) => setQ({ dateField: v })} options={[{ value: 'reporting', label: 'Reporting date' }, { value: 'inspection', label: 'Inspection date' }]} />
              <MiniDate label="From" value={q.from} onChange={(v) => setQ({ from: v })} />
              <MiniDate label="To" value={q.to} onChange={(v) => setQ({ to: v })} />
            </>
          }
        >
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v })} placeholder="Report ID or asset…" />
          <MiniSelect label="Asset" value={q.assetId} onChange={(v) => setQ({ assetId: v })} options={assets.map((a: any) => ({ value: a.id, label: a.name }))} />
          <MiniSelect label="Review status" value={q.status} onChange={(v) => setQ({ status: v })} options={['DRAFT', 'PENDING_REVIEW', 'UNDER_REVIEW', 'RETURNED', 'REJECTED', 'VERIFIED'].map((s) => ({ value: s, label: humanize(s) }))} />
          <MiniSelect label="Schedule" value={q.scheduleClass} onChange={(v) => setQ({ scheduleClass: v })} options={['ON_SCHEDULE', 'SLIGHTLY_DELAYED', 'SIGNIFICANTLY_DELAYED', 'NOT_APPLICABLE'].map((s) => ({ value: s, label: humanize(s) }))} />
        </FilterBar>
        {data && (
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs text-ink-3">
            <span><span className="tabular font-semibold text-ink">{data.total}</span> {data.total === 1 ? 'report' : 'reports'}</span>
            <span className="hidden sm:inline">Click a row to open the report</span>
          </div>
        )}
        <DataTable
          loading={loading}
          rows={data?.rows}
          onRowClick={(r: any) => nav(`/jm/reports/${r.id}`)}
          columns={[
            {
              key: 'asset', header: 'Report', primary: true, render: (r: any) => (
                <div className="min-w-[200px] max-w-xs">
                  <span className="font-mono text-[11px] font-medium text-brand">{r.reportNo}</span>
                  <span className="mt-0.5 block font-medium leading-snug text-ink">{r.asset.name}</span>
                  <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-3"><MapPin className="size-3" aria-hidden />{r.district.name}</span>
                </div>
              ),
            },
            {
              key: 'period', header: 'Period', render: (r: any) => (
                <div className="whitespace-nowrap">
                  <span className="block">{fmtDate(r.periodFrom)}</span>
                  <span className="block text-xs text-ink-3">to {fmtDate(r.periodTo)}</span>
                  {r.inspectionDate && <span className="mt-0.5 block text-[11px] text-ink-3">Inspected {fmtDate(r.inspectionDate)}</span>}
                </div>
              ),
            },
            {
              key: 'progress', header: 'Progress', render: (r: any) => (
                <div className="w-32">
                  <ProgressBar value={r.currentProgress} />
                  {r.progressDiscrepancy && <span className="mt-1 block text-[11px] font-medium text-amber-700">⚑ Discrepancy flagged</span>}
                </div>
              ),
            },
            {
              key: 'schedule', header: 'Assessment', render: (r: any) => (
                <div className="flex min-w-[130px] flex-col items-start gap-1">
                  <Badge status={r.scheduleClass} />
                  {r.qualityRating && <span className="text-[11px] text-ink-3">Quality: <span className="font-medium text-ink-2">{quality.find((x) => x.value === r.qualityRating)?.label ?? humanize(r.qualityRating)}</span></span>}
                </div>
              ),
            },
            {
              key: 'status', header: 'Review', render: (r: any) => (
                <div className="min-w-[140px]">
                  <Badge status={r.status} />
                  <span className="mt-1 block text-[11px] text-ink-3">{r.currentAssignee ? `With ${r.currentAssignee.name}` : `By ${r.reportingOfficer.name}`}</span>
                </div>
              ),
            },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ page: String(p) })} />}
      </Card>
    </>
  );
}
