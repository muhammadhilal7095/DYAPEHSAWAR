import { useState } from 'react';
import { RotateCw } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useDebounced, useQueryState } from '../../lib/hooks';
import { fmtDateTime, humanize } from '../../lib/format';
import { Badge, Button, Card, Modal, Notice, PageHeader, Pagination, Stat, useToast } from '../../components/ui';
import { DataTable, FilterBar, MiniDate, MiniSelect, SearchInput } from '../../components/DataTable';

export default function EmailLogs() {
  const { can } = useAuth();
  const [q, setQ] = useQueryState({ q: '', status: '', module: '', from: '', to: '', page: '1' });
  const search = useDebounced(q.q);
  const { data, loading, reload } = useApi(`/api/admin/emails${qs({ ...q, q: search })}`);
  const [view, setView] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const retry = async (id?: string) => {
    setBusy(id ?? 'all');
    try {
      if (id) { const r = await api.post(`/api/admin/emails/${id}/retry`); toast(r.status === 'SENT' ? 'success' : 'error', `Delivery ${r.status === 'SENT' ? 'succeeded' : `failed: ${r.error}`}`); }
      else { const r = await api.post('/api/admin/emails/retry-failed'); toast('info', `${r.retried} email(s) retried.`); }
      reload();
    } catch (e: any) { toast('error', e.message); } finally { setBusy(null); }
  };
  return (
    <>
      <PageHeader title="Email Logs" subtitle="Every notification attempt. An email is marked Sent only after the mail server accepts the recipient." actions={can('email.retry') && <Button variant="secondary" icon={<RotateCw className="size-4" />} loading={busy === 'all'} onClick={() => retry()}>Retry all failed</Button>} />
      {data && !data.smtpConfigured && <div className="mb-4"><Notice tone="warning">SMTP is not configured on the server. New emails will fail until SMTP_HOST and related variables are set.</Notice></div>}
      {data && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Stat label="Sent" value={data.stats.SENT ?? 0} tone="green" />
          <Stat label="Failed" value={data.stats.FAILED ?? 0} tone="red" />
          <Stat label="Pending" value={data.stats.PENDING ?? 0} tone="amber" />
        </div>
      )}
      <Card bodyClass="p-0">
        <FilterBar onReset={() => setQ({ q: '', status: '', module: '', from: '', to: '' })}>
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v })} placeholder="Recipient, subject, reference…" />
          <MiniSelect label="Status" value={q.status} onChange={(v) => setQ({ status: v })} options={['SENT', 'FAILED', 'PENDING'].map((s) => ({ value: s, label: humanize(s) }))} />
          <MiniSelect label="Module" value={q.module} onChange={(v) => setQ({ module: v })} options={['DAAMR_REQUEST', 'DAAMR_REPORT', 'HOSTEL_BOOKING', 'JM_REPORT'].map((s) => ({ value: s, label: humanize(s) }))} />
          <MiniDate label="From" value={q.from} onChange={(v) => setQ({ from: v })} />
          <MiniDate label="To" value={q.to} onChange={(v) => setQ({ to: v })} />
        </FilterBar>
        <DataTable loading={loading} rows={data?.rows} onRowClick={setView} columns={[
          { key: 'createdAt', header: 'Queued', render: (r: any) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</span> },
          { key: 'toEmail', header: 'Recipient', primary: true },
          { key: 'subject', header: 'Subject', render: (r: any) => <span className="line-clamp-1">{r.subject}</span> },
          { key: 'event', header: 'Event', render: (r: any) => humanize(r.event) },
          { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> },
          { key: 'attempts', header: 'Attempts' },
          { key: 'sentAt', header: 'Sent / error', render: (r: any) => (r.status === 'SENT' ? <span className="text-xs">{fmtDateTime(r.sentAt)}</span> : <span className="line-clamp-1 text-xs text-red-700">{r.error}</span>) },
          { key: 'a', header: '', render: (r: any) => r.status === 'FAILED' && can('email.retry') && <Button size="sm" variant="secondary" loading={busy === r.id} onClick={(e) => { e.stopPropagation(); retry(r.id); }}>Retry</Button> },
        ]} />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ page: String(p) })} />}
      </Card>
      <Modal open={!!view} onClose={() => setView(null)} title={view?.subject} size="lg">
        {view && (
          <div className="space-y-2 text-sm">
            <p><span className="text-ink-3">To:</span> {view.toEmail} · <Badge status={view.status} /> {view.messageId && <span className="font-mono text-xs text-ink-3">{view.messageId}</span>}</p>
            {view.error && <Notice tone="danger">{view.error}</Notice>}
            <pre className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 font-sans">{view.body}</pre>
          </div>
        )}
      </Modal>
    </>
  );
}
