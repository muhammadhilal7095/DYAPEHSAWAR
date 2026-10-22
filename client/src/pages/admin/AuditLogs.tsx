import { useState } from 'react';
import { qs } from '../../lib/api';
import { useApi, useDebounced, useQueryState } from '../../lib/hooks';
import { fmtDateTime, humanize } from '../../lib/format';
import { Card, Modal, PageHeader, Pagination } from '../../components/ui';
import { DataTable, ExportMenu, FilterBar, MiniDate, MiniSelect, SearchInput } from '../../components/DataTable';

export default function AuditLogs() {
  const [q, setQ] = useQueryState({ q: '', module: '', entityType: '', from: '', to: '', page: '1' });
  const search = useDebounced(q.q);
  const params = { ...q, q: search };
  const { data, loading } = useApi(`/api/admin/audit${qs(params)}`);
  const [view, setView] = useState<any | null>(null);
  return (
    <>
      <PageHeader title="Audit Logs" subtitle="Permanent, read-only record of every important action (database-enforced: entries cannot be edited or deleted)." actions={<ExportMenu compact url={(f) => `/api/admin/audit/export${qs({ ...params, format: f, page: '' })}`} />} />
      <Card bodyClass="p-0">
        <FilterBar onReset={() => setQ({ q: '', module: '', entityType: '', from: '', to: '' })}>
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v })} placeholder="Reference, user, action…" />
          <MiniSelect label="Module" value={q.module} onChange={(v) => setQ({ module: v })} options={['DAAMR', 'DAAMR_REQUEST', 'DAAMR_REPORT', 'HOSTEL', 'HOSTEL_BOOKING', 'JM', 'JM_REPORT'].map((s) => ({ value: s, label: humanize(s) }))} />
          <MiniSelect label="Entity" value={q.entityType} onChange={(v) => setQ({ entityType: v })} options={['ActivityRequest', 'ActivityReport', 'HostelBooking', 'Hostel', 'Room', 'JmReport', 'JmAsset', 'JmIssue', 'JmAction', 'JmRisk', 'User', 'Role', 'WorkflowDefinition', 'SystemSetting', 'LookupOption', 'EmailLog'].map((s) => ({ value: s, label: s }))} />
          <MiniDate label="From" value={q.from} onChange={(v) => setQ({ from: v })} />
          <MiniDate label="To" value={q.to} onChange={(v) => setQ({ to: v })} />
        </FilterBar>
        <DataTable loading={loading} rows={data?.rows} onRowClick={setView} columns={[
          { key: 'createdAt', header: 'Date & time', render: (r: any) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</span> },
          { key: 'actorName', header: 'User' },
          { key: 'action', header: 'Action', primary: true, render: (r: any) => <span className="font-mono text-xs">{r.action}</span> },
          { key: 'entityType', header: 'Entity' },
          { key: 'entityRef', header: 'Reference', render: (r: any) => <span className="font-mono text-xs">{r.entityRef ?? '—'}</span> },
          { key: 'changes', header: 'Changes', render: (r: any) => <span className="line-clamp-1 max-w-[320px] text-xs text-ink-3">{r.after ? JSON.stringify(r.after) : '—'}</span> },
          { key: 'ip', header: 'IP', hideOnCard: true, render: (r: any) => <span className="text-xs">{r.ip ?? '—'}</span> },
        ]} />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ page: String(p) })} />}
      </Card>
      <Modal open={!!view} onClose={() => setView(null)} title={view?.action} size="lg">
        {view && (
          <div className="space-y-3 text-sm">
            <p>{view.actorName} · {fmtDateTime(view.createdAt)} · {view.entityType} {view.entityRef} · IP {view.ip ?? '—'}</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div><p className="mb-1 text-xs font-semibold uppercase text-ink-3">Before</p><pre className="max-h-80 overflow-auto rounded-lg bg-gray-50 p-2 text-xs">{view.before ? JSON.stringify(view.before, null, 2) : '—'}</pre></div>
              <div><p className="mb-1 text-xs font-semibold uppercase text-ink-3">After</p><pre className="max-h-80 overflow-auto rounded-lg bg-gray-50 p-2 text-xs">{view.after ? JSON.stringify(view.after, null, 2) : '—'}</pre></div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
