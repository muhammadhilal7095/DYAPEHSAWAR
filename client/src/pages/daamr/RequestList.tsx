import type React from 'react';
import { Link, useNavigate } from 'react-router';
import { Download, GitCommitVertical, MapPin, Paperclip, Pencil, Plus, Stamp, Users } from 'lucide-react';
import { download, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDebounced, useDistricts, useLookups, useQueryState } from '../../lib/hooks';
import { fmtDate, humanize } from '../../lib/format';
import { Badge, Card, LinkButton, PageHeader, Pagination, Tabs, cx } from '../../components/ui';
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
        subtitle="Track every activity — current stage, responsible officer, reviewer and deadlines."
        actions={
          <>
            {can('daamr.export') && (
              <ExportMenu compact label="Export" formats={['pdf', 'xlsx', 'csv']} url={(f) => `/api/daamr/requests/export${qs({ ...params, format: f, page: '', sort: '' })}`} />
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
        <FilterBar
          onReset={() => setQ({ ...EMPTY, page: '1' })}
          moreActive={[q.departmentId, q.assigneeId, q.officerId, q.level, q.priority, q.overdue || q.unassigned, q.from, q.to].filter(Boolean).length}
          more={
            <>
              <MiniSelect label="Department" value={q.departmentId} onChange={(v) => setQ({ departmentId: v, page: '1' })} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
              <MiniSelect label="Assigned officer" value={q.assigneeId} onChange={(v) => setQ({ assigneeId: v, page: '1' })} options={officers.map((o) => ({ value: o.id, label: o.name }))} />
              <MiniSelect label="With reviewer" value={q.officerId} onChange={(v) => setQ({ officerId: v, page: '1' })} options={officers.map((o) => ({ value: o.id, label: o.name }))} />
              <MiniSelect label="Approval stage" value={q.level} onChange={(v) => setQ({ level: v, page: '1' })} options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `Level ${n}` }))} />
              <MiniSelect label="Priority" value={q.priority} onChange={(v) => setQ({ priority: v, page: '1' })} options={PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />
              <MiniSelect label="Show only" value={q.overdue ? 'overdue' : q.unassigned ? 'unassigned' : ''} onChange={(v) => setQ({ overdue: v === 'overdue' ? '1' : '', unassigned: v === 'unassigned' ? '1' : '', page: '1' })} options={[{ value: 'overdue', label: 'Overdue' }, { value: 'unassigned', label: 'Awaiting staff assignment' }]} />
              <MiniSelect label="Date field" value={q.dateField} onChange={(v) => setQ({ dateField: v })} all={null} options={[{ value: 'start', label: 'Start date' }, { value: 'submitted', label: 'Submitted' }, { value: 'created', label: 'Created' }]} />
              <MiniDate label="From" value={q.from} onChange={(v) => setQ({ from: v, page: '1' })} />
              <MiniDate label="To" value={q.to} onChange={(v) => setQ({ to: v, page: '1' })} />
            </>
          }
        >
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v, page: '1' })} placeholder="Search by ID, title, venue, officer…" />
          <MiniSelect label="Status" value={q.lifecycle} onChange={(v) => setQ({ lifecycle: v, page: '1' })} options={LIFECYCLE.map((s) => ({ value: s, label: humanize(s) }))} />
          <MiniSelect label="District / HQ" value={q.districtId} onChange={(v) => setQ({ districtId: v, page: '1' })} options={districts.map((d) => ({ value: d.id, label: d.name }))} />
          <MiniSelect label="Category" value={q.category} onChange={(v) => setQ({ category: v, page: '1' })} options={categories.map((c) => ({ value: c.value, label: c.label }))} />
        </FilterBar>
        {data && (
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs text-ink-3">
            <span><span className="tabular font-semibold text-ink">{data.total}</span> {data.total === 1 ? 'activity' : 'activities'}</span>
            <span className="hidden sm:inline">Click a row to open the activity</span>
          </div>
        )}
        <DataTable
          loading={loading}
          rows={data?.rows}
          sort={q.sort}
          onSort={(s) => setQ({ sort: s })}
          onRowClick={(r: any) => nav(`/daamr/requests/${r.id}`)}
          empty="No activities match these filters."
          columns={[
            {
              key: 'subject', header: 'Activity', sortKey: 'daamrId', primary: true, render: (r: any) => (
                <div className="min-w-[220px] max-w-sm">
                  <span className="font-mono text-[11px] font-medium text-brand">{r.daamrId}</span>
                  <span className="mt-0.5 line-clamp-2 font-medium leading-snug text-ink">{r.subject}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-3">
                    <span className="inline-flex items-center gap-1 font-medium text-ink-2"><MapPin className="size-3" aria-hidden />{r.district.name}</span>
                    {r.category && <span>· {humanize(r.category)}</span>}
                  </span>
                  {r.venue && <span className="mt-0.5 line-clamp-1 text-xs text-ink-3">{r.venue}</span>}
                </div>
              ),
            },
            {
              key: 'startDate', header: 'Schedule', sortKey: 'startDate', render: (r: any) => (
                <div className="whitespace-nowrap">
                  <span className="block">{fmtDate(r.startDate)}</span>
                  {r.endDate !== r.startDate && <span className="block text-xs text-ink-3">to {fmtDate(r.endDate)}</span>}
                  {r.nextDeadline && <span className={cx('mt-0.5 block text-xs', new Date(r.nextDeadline) < new Date() ? 'font-medium text-red-700' : 'text-ink-3')}>Task due {fmtDate(r.nextDeadline)}</span>}
                </div>
              ),
            },
            {
              key: 'lead', header: 'Responsible officer', render: (r: any) => r.leadOfficer
                ? <span className="inline-flex items-center gap-1.5"><Avatar name={r.leadOfficer.name} />{r.leadOfficer.name}{r.staffCount > 1 && <span className="inline-flex items-center gap-0.5 text-xs text-ink-3"><Users className="size-3" />+{r.staffCount - 1}</span>}</span>
                : ['COMPLETED', 'REJECTED', 'CANCELLED'].includes(r.lifecycle) ? <span className="text-ink-3">—</span> : <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">Unassigned</span>,
            },
            {
              key: 'stage', header: 'Current stage', className: 'hidden @[63rem]:table-cell', hideOnCard: true, render: (r: any) => r.currentLevel
                ? <div className="max-w-[180px] text-xs"><span className="block font-medium text-ink-2">{r.currentLevel}</span><span className="text-ink-3">{r.currentAssignee ? `With ${r.currentAssignee.name}` : <span className="text-amber-700">Pending assignment</span>}</span></div>
                : <span className="text-ink-3">—</span>,
            },
            {
              key: 'lifecycle', header: 'Status', render: (r: any) => (
                <div className="flex flex-col items-start gap-1">
                  <Badge status={r.lifecycle} />
                  {r.overdue && <Badge tone="red" label="Overdue" />}
                  {r.priority && r.priority !== 'NORMAL' && <Badge status={r.priority} />}
                  {r.currentLevel && (
                    <span className="max-w-[170px] text-[11px] leading-snug text-ink-3 @[63rem]:hidden">
                      {r.currentLevel}{r.currentAssignee ? ` · ${r.currentAssignee.name}` : ''}
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', hideOnCard: true, render: (r: any) => (
                <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                  {r.currentAssignee?.id === me?.id && <IconLink to={`/daamr/requests/${r.id}`} label="Review" icon={<Stamp className="size-4 text-amber-700" />} />}
                  {r.requester.id === me?.id && ['DRAFT', 'RETURNED'].includes(r.status) && <IconLink to={`/daamr/requests/${r.id}/edit`} label="Edit" icon={<Pencil className="size-4" />} />}
                  {r.instanceId && <IconLink to={`/daamr/requests/${r.id}?tab=reviews`} label="Reviews & approvals" icon={<GitCommitVertical className="size-4" />} />}
                  <IconLink to={`/daamr/requests/${r.id}?tab=documents`} label="Documents" icon={<Paperclip className="size-4" />} />
                  <button className="rounded-md p-1.5 text-ink-3 hover:bg-gray-100 hover:text-ink" title="Download activity report (PDF)" aria-label="Download activity report (PDF)" onClick={() => download(`/api/daamr/requests/${r.id}/pdf`)}><Download className="size-4" /></button>
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
  return <Link to={to} title={label} aria-label={label} className="rounded-md p-1.5 text-ink-3 hover:bg-gray-100 hover:text-ink">{icon}</Link>;
}

function Avatar({ name }: { name: string }) {
  return <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand ring-1 ring-brand-100">{name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>;
}
