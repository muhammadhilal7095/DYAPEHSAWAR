import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../lib/hooks';
import { fmtDate, fmtDateTime } from '../lib/format';
import { Badge, Card, PageHeader, Tabs } from '../components/ui';
import { DataTable } from '../components/DataTable';

export default function Tasks() {
  const { data, loading } = useApi('/api/tasks');
  const staff = useApi('/api/daamr/assignments?status=open&pageSize=100');
  const [tab, setTab] = useState('assigned');
  const nav = useNavigate();
  const rows = data?.[tab] ?? [];
  return (
    <>
      <PageHeader title="My Tasks" subtitle="Items assigned to you for review, and your submissions returned for revision." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'assigned', label: 'My assigned reviews', count: data?.assigned.length }, { value: 'returned', label: 'Returned to me', count: data?.returned.length }, { value: 'activities', label: 'My activity assignments', count: staff.data?.total }]} />
      {tab === 'activities' ? (
        <Card bodyClass="p-0">
          <DataTable
            loading={staff.loading}
            rows={staff.data?.rows}
            onRowClick={(r: any) => nav(`/daamr/requests/${r.activity.id}?tab=assignments`)}
            rowClassName={(r: any) => (r.overdue ? 'bg-red-50/50' : '')}
            columns={[
              { key: 'ref', header: 'Activity ID', render: (r: any) => <span className="font-mono text-xs">{r.activity.daamrId}</span>, primary: true },
              { key: 'title', header: 'Activity', render: (r: any) => <span className="font-medium">{r.activity.subject}</span> },
              { key: 'role', header: 'Role', render: (r: any) => (r.isLead ? 'Responsible officer' : 'Supporting') },
              { key: 'deadline', header: 'Deadline', render: (r: any) => (r.deadline ? <span className={r.overdue ? 'font-semibold text-red-700' : ''}>{fmtDate(r.deadline)}</span> : '—') },
              { key: 'status', header: 'Task status', render: (r: any) => <Badge status={r.status} /> },
            ]}
            empty="You have no open activity assignments."
          />
        </Card>
      ) : (
      <Card bodyClass="p-0">
        <DataTable
          loading={loading}
          rows={rows}
          onRowClick={(r: any) => nav(r.link)}
          columns={[
            { key: 'ref', header: 'Reference', render: (r: any) => <span className="font-mono text-xs">{r.ref}</span>, primary: true },
            { key: 'moduleLabel', header: 'Type' },
            { key: 'title', header: 'Subject', render: (r: any) => <span className="font-medium">{r.title}</span> },
            { key: 'submittedBy', header: 'Submitted by' },
            { key: 'level', header: 'Approval level', render: (r: any) => r.level ?? '—' },
            { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status === 'IN_PROGRESS' ? 'PENDING_REVIEW' : r.status} /> },
            { key: 'assignedAt', header: tab === 'assigned' ? 'Assigned' : 'Updated', render: (r: any) => fmtDateTime(r.assignedAt ?? r.updatedAt) },
          ]}
          empty={tab === 'assigned' ? 'Nothing is waiting for your review.' : 'None of your submissions are returned.'}
        />
      </Card>
      )}
    </>
  );
}
