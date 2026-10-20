import { useState } from 'react';
import { useNavigate } from 'react-router';
import { CheckCheck } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtDateTime } from '../lib/format';
import { Button, Card, Empty, PageHeader, Pagination, Spinner, Tabs, cx } from '../components/ui';

export default function Notifications() {
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const { data, loading, reload } = useApi(`/api/admin/notifications${qs({ unread: tab === 'unread' ? 'true' : '', page })}`);
  const nav = useNavigate();
  const open = async (n: any) => {
    if (!n.readAt) await api.post(`/api/admin/notifications/${n.id}/read`).catch(() => {});
    if (n.link) nav(n.link);
    else reload();
  };
  return (
    <>
      <PageHeader
        title="Notifications"
        actions={<Button variant="secondary" icon={<CheckCheck className="size-4" />} onClick={async () => { await api.post('/api/admin/notifications/read-all'); reload(); }}>Mark all as read</Button>}
      />
      <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} tabs={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread', count: data?.unread }]} />
      <Card bodyClass="p-0">
        {loading && !data ? <Spinner /> : !data?.rows.length ? <Empty title="No notifications" /> : (
          <ul className="divide-y divide-line">
            {data.rows.map((n: any) => (
              <li key={n.id}>
                <button onClick={() => open(n)} className={cx('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-gray-50', !n.readAt && 'bg-brand-50/50')}>
                  <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand')} aria-label={n.readAt ? undefined : 'Unread'} />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block text-sm', !n.readAt && 'font-semibold')}>{n.title}</span>
                    <span className="block text-xs text-ink-3">{n.body}</span>
                  </span>
                  <span className="whitespace-nowrap text-xs text-ink-3">{fmtDateTime(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
