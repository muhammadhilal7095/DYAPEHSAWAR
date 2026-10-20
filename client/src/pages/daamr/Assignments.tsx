import { useNavigate } from 'react-router';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useQueryState } from '../../lib/hooks';
import { fmtDate, fmtDateTime, humanize } from '../../lib/format';
import { Badge, Card, PageHeader, Pagination, Tabs } from '../../components/ui';
import { DataTable, FilterBar, MiniSelect } from '../../components/DataTable';

/** Staff task list: the activities assigned to me (or that I assigned / coordinate). */
export default function Assignments() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useQueryState({ scope: 'mine', status: 'open', overdue: '', page: '1' });
  const { data, loading } = useApi(`/api/daamr/assignments${qs(q)}`);
  return (
    <>
      <PageHeader title="My Assignments" subtitle="Activities assigned to you, with responsibilities and deadlines. Open an activity to acknowledge, update progress or submit the execution report." />
      <Tabs
        value={q.scope}
        onChange={(v) => setQ({ scope: v, page: '1' })}
        tabs={[
          { value: 'mine', label: 'Assigned to me' },
          ...(can('daamr.assign') ? [{ value: 'given', label: 'Assigned by me' }] : []),
          ...(can('daamr.assign') || can('workflow.override') ? [{ value: 'all', label: 'All assignments' }] : []),
        ]}
      />
      <Card bodyClass="p-0">
        <FilterBar onReset={() => setQ({ status: 'open', overdue: '' })}>
          <MiniSelect label="Status" value={q.status} onChange={(v) => setQ({ status: v, page: '1' })} options={[{ value: 'open', label: 'Open tasks' }, ...['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => ({ value: s, label: humanize(s) }))]} all="Any status" />
          <MiniSelect label="Deadline" value={q.overdue} onChange={(v) => setQ({ overdue: v, page: '1' })} options={[{ value: '1', label: 'Overdue only' }]} all="Any" />
        </FilterBar>
        <DataTable
          loading={loading}
          rows={data?.rows}
          onRowClick={(r: any) => nav(`/daamr/requests/${r.activity.id}?tab=assignments`)}
          empty={q.status === 'open' ? 'You have no open tasks.' : 'No assignments match these filters.'}
          rowClassName={(r: any) => (r.overdue ? 'bg-red-50/50' : '')}
          columns={[
            { key: 'activity', header: 'Activity', primary: true, render: (r: any) => <div className="min-w-[200px]"><span className="font-medium text-ink">{r.activity.subject}</span><span className="block font-mono text-xs text-ink-3">{r.activity.daamrId}</span></div> },
            ...(q.scope !== 'mine' ? [{ key: 'assignee', header: 'Staff member', render: (r: any) => r.assignee.name }] : []),
            { key: 'role', header: 'Role', render: (r: any) => (r.isLead ? <Badge tone="violet" label="Responsible officer" /> : 'Supporting') },
            { key: 'responsibilities', header: 'Responsibilities', render: (r: any) => <span className="line-clamp-2 max-w-sm text-sm">{r.responsibilities}</span>, hideOnCard: true },
            { key: 'deadline', header: 'Deadline', render: (r: any) => (r.deadline ? <span className={r.overdue ? 'font-semibold text-red-700' : ''}>{fmtDate(r.deadline)}{r.overdue && ' · overdue'}</span> : '—') },
            { key: 'priority', header: 'Priority', render: (r: any) => <Badge status={r.priority} /> },
            { key: 'status', header: 'Task status', render: (r: any) => <Badge status={r.status} /> },
            { key: 'lifecycle', header: 'Activity status', render: (r: any) => <Badge status={r.activity.lifecycle} /> },
            { key: 'dates', header: 'Activity dates', render: (r: any) => `${fmtDate(r.activity.startDate)} – ${fmtDate(r.activity.endDate)}`, hideOnCard: true },
            { key: 'assignedBy', header: 'Assigned by', render: (r: any) => <span className="text-xs">{r.assignedBy.name}<span className="block text-ink-3">{fmtDateTime(r.createdAt)}</span></span>, hideOnCard: true },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ page: String(p) })} />}
      </Card>
    </>
  );
}
