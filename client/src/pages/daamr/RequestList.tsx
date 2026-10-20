import type React from 'react';
import { Link, useNavigate } from 'react-router';
import { Download, Eye, GitCommitVertical, Paperclip, Pencil, Plus, Stamp, Users } from 'lucide-react';
import { download, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDebounced, useDistricts, useLookups, useQueryState } from '../../lib/hooks';
import { fmtDate, fmtDateTime, humanize } from '../../lib/format';
import { Badge, Card, LinkButton, PageHeader, Pagination, Tabs } from '../../components/ui';
import { DataTable, ExportMenu, FilterBar, MiniDate, MiniSelect, SearchInput } from '../../components/DataTable';
import { PRIORITIES } from './ActivityForm';

export const REQUEST_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'UNDER_REVIEW', 'RETURNED', 'REJECTED', 'APPROVED'];
export const LIFECYCLE = ['DRAFT', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'IN_PROGRESS', 'REPORT_REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED'];

const EMPTY = { q: '', districtId: '', departmentId: '', category: '', lifecycle: '', status: '', level: '', officerId: '', assigneeId: '', priority: '', overdue: '', unassigned: '', from: '', to: '' };

export default function RequestList() {
  const { can, me } = useAuth();
  const nav = useNavigate();
  const districts = useDistricts();
  const categories = useLookups('ACTIVITY_CATEGORY');
  const departments = useCached<any[]>('/api/admin/departments') ?? [];
  const officers = useCached<any[]>('/api/admin/directory') ?? [];
  const wide = can('daamr.request.view_all', 'daamr.request.view_district');
  const [q, setQ] = useQueryState({ scope: wide ? 'all' : 'mine', ...EMPTY, dateField: 'start', sort: 'updatedAt', page: '1' });
  const search = useDebounced(q.q);
  const params = { ...q, q: search };
  const { data, loading } = useApi(`/api/daamr/requests${qs(params)}`);

  return (
    <>
      <PageHeader
        title="Activities"
        subtitle="Search and track every activity: current stage, responsible officer, reviewer and deadlines. Filters are kept when you open an activity and come back."
        actions={
          <>
            {can('daamr.export') && (
              <ExportMenu label="Export" formats={['pdf', 'xlsx', 'csv']} url={(f) => `/api/daamr/requests/export${qs({ ...params, format: f, page: '', sort: '' })}`} />
            )}
            {can('daamr.request.create') && <LinkButton to="/daamr/requests/new" icon={<Plus className="size-4" />}>Create activity</LinkButton>}
          </>
        }
      />
      <Tabs
        value={q.scope}
        onChange={(v) => setQ({ scope: v, page: '1' })}
        tabs={[
          ...(wide ? [{ value: 'all', label: 'All activities' }] : []),
          { value: 'assigned', label: 'Awaiting my review' },
          { value: 'staff', label: 'Assigned to me' },
          { value: 'mine', label: 'Created by me' },
        ]}
      />
      <Card bodyClass="p-0">
        <FilterBar onReset={() => setQ({ ...EMPTY, page: '1' })}>
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v, page: '1' })} placeholder="Activity ID, title, venue, district, officer, department or status…" />
          <MiniSelect label="Status" value={q.lifecycle} onChange={(v) => setQ({ lifecycle: v, page: '1' })} options={LIFECYCLE.map((s) => ({ value: s, label: humanize(s) }))} />
          <MiniSelect label="District / HQ" value={q.districtId} onChange={(v) => setQ({ districtId: v, page: '1' })} options={districts.map((d) => ({ value: d.id, label: d.name }))} />
          <MiniSelect label="Category" value={q.category} onChange={(v) => setQ({ category: v, page: '1' })} options={categories.map((c) => ({ value: c.value, label: c.label }))} />
          <MiniSelect label="Department" value={q.departmentId} onChange={(v) => setQ({ departmentId: v, page: '1' })} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
          <MiniSelect label="Assigned officer" value={q.assigneeId} onChange={(v) => setQ({ assigneeId: v, page: '1' })} options={officers.map((o) => ({ value: o.id, label: o.name }))} />
          <MiniSelect label="With reviewer" value={q.officerId} onChange={(v) => setQ({ officerId: v, page: '1' })} options={officers.map((o) => ({ value: o.id, label: o.name }))} />
          <MiniSelect label="Approval stage" value={q.level} onChange={(v) => setQ({ level: v, page: '1' })} options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `Level ${n}` }))} />
          <MiniSelect label="Priority" value={q.priority} onChange={(v) => setQ({ priority: v, page: '1' })} options={PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />
          <MiniSelect label="Show only" value={q.overdue ? 'overdue' : q.unassigned ? 'unassigned' : ''} onChange={(v) => setQ({ overdue: v === 'overdue' ? '1' : '', unassigned: v === 'unassigned' ? '1' : '', page: '1' })} options={[{ value: 'overdue', label: 'Overdue' }, { value: 'unassigned', label: 'Awaiting staff assignment' }]} />
          <MiniSelect label="Date field" value={q.dateField} onChange={(v) => setQ({ dateField: v })} all={null} options={[{ value: 'start', label: 'Start date' }, { value: 'submitted', label: 'Submitted' }, { value: 'created', label: 'Created' }]} />
          <MiniDate label="From" value={q.from} onChange={(v) => setQ({ from: v, page: '1' })} />
          <MiniDate label="To" value={q.to} onChange={(v) => setQ({ to: v, page: '1' })} />
        </FilterBar>
        <DataTable
          loading={loading}
          rows={data?.rows}
          sort={q.sort}
          onSort={(s) => setQ({ sort: s })}
          onRowClick={(r: any) => nav(`/daamr/requests/${r.id}`)}
          empty="No activities match these filters."
          columns={[
            { key: 'daamrId', header: 'Activity ID', sortKey: 'daamrId', primary: true, render: (r: any) => <span className="whitespace-nowrap font-mono text-xs font-medium text-brand">{r.daamrId}</span> },
            {
              key: 'subject', header: 'Activity', render: (r: any) => (
                <div className="min-w-[200px]">
                  <span className="line-clamp-2 font-medium text-ink">{r.subject}</span>
                  <span className="text-xs text-ink-3">{[humanize(r.category), r.venue].filter((x) => x && x !== '—').join(' · ')}</span>
                </div>
              ),
            },
            { key: 'district', header: 'District / HQ', render: (r: any) => r.district.name },
            { key: 'startDate', header: 'Dates', sortKey: 'startDate', render: (r: any) => <span className="whitespace-nowrap">{fmtDate(r.startDate)}{r.endDate !== r.startDate && <span className="text-ink-3"> – {fmtDate(r.endDate)}</span>}</span> },
            {
              key: 'lead', header: 'Responsible officer', render: (r: any) => r.leadOfficer
                ? <span className="inline-flex items-center gap-1">{r.leadOfficer.name}{r.staffCount > 1 && <span className="inline-flex items-center gap-0.5 text-xs text-ink-3"><Users className="size-3" />+{r.staffCount - 1}</span>}</span>
                : ['COMPLETED', 'REJECTED', 'CANCELLED'].includes(r.lifecycle) ? '—' : <span className="text-amber-700">Not assigned</span>,
            },
            {
              key: 'stage', header: 'Current stage', render: (r: any) => r.currentLevel
                ? <div className="text-xs"><span className="block text-ink-2">{r.currentLevel}</span><span className="text-ink-3">{r.currentAssignee ? `With ${r.currentAssignee.name}` : <span className="text-amber-700">Pending assignment</span>}</span></div>
                : <span className="text-ink-3">—</span>,
            },
            {
              key: 'lifecycle', header: 'Status', render: (r: any) => (
                <div className="flex flex-col items-start gap-1">
                  <Badge status={r.lifecycle} />
                  {r.overdue && <Badge tone="red" label="Overdue" />}
                </div>
              ),
            },
            { key: 'priority', header: 'Priority', render: (r: any) => <Badge status={r.priority} />, hideOnCard: true },
            { key: 'nextDeadline', header: 'Next deadline', render: (r: any) => (r.nextDeadline ? <span className={new Date(r.nextDeadline) < new Date() ? 'font-medium text-red-700' : ''}>{fmtDate(r.nextDeadline)}</span> : '—'), hideOnCard: true },
            { key: 'updatedAt', header: 'Last updated', sortKey: 'updatedAt', render: (r: any) => <span className="whitespace-nowrap text-xs text-ink-3">{fmtDateTime(r.updatedAt)}</span>, hideOnCard: true },
            {
              key: 'actions', header: 'Actions', render: (r: any) => (
                <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <IconLink to={`/daamr/requests/${r.id}`} label="View details" icon={<Eye className="size-4" />} />
                  {r.requester.id === me?.id && ['DRAFT', 'RETURNED'].includes(r.status) && <IconLink to={`/daamr/requests/${r.id}/edit`} label="Edit" icon={<Pencil className="size-4" />} />}
                  {r.currentAssignee?.id === me?.id && <IconLink to={`/daamr/requests/${r.id}`} label="Review" icon={<Stamp className="size-4 text-amber-700" />} />}
                  {r.instanceId && <IconLink to={`/daamr/requests/${r.id}?tab=reviews`} label="Reviews & approvals" icon={<GitCommitVertical className="size-4" />} />}
                  <IconLink to={`/daamr/requests/${r.id}?tab=documents`} label="Documents" icon={<Paperclip className="size-4" />} />
                  <button className="rounded p-1.5 text-ink-3 hover:bg-gray-100 hover:text-ink" title="Download activity report (PDF)" aria-label="Download activity report (PDF)" onClick={() => download(`/api/daamr/requests/${r.id}/pdf`)}><Download className="size-4" /></button>
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

function IconLink({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return <Link to={to} title={label} aria-label={label} className="rounded p-1.5 text-ink-3 hover:bg-gray-100 hover:text-ink">{icon}</Link>;
}
