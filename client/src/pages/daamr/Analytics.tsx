import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useQueryState } from '../../lib/hooks';
import { fmtMoney, fmtNum, fmtMonth } from '../../lib/format';
import { Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { ExportMenu } from '../../components/DataTable';
import { DaamrFilters } from './Dashboard';

function T({ title, cols, rows, footer }: { title: string; cols: { key: string; label: string; num?: boolean; fmt?: (v: any) => string }[]; rows: any[]; footer?: any }) {
  return (
    <Card title={title} bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-ink-3"><tr>{cols.map((c) => <th key={c.key} className={`px-4 py-2 font-medium ${c.num ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {rows.length ? rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className={`px-4 py-2 ${c.num ? 'tabular text-right' : ''}`}>{c.fmt ? c.fmt(r[c.key]) : r[c.key]}</td>)}</tr>) : <tr><td colSpan={cols.length} className="px-4 py-6 text-center text-ink-3">No data</td></tr>}
            {footer && <tr className="bg-gray-50 font-semibold">{cols.map((c) => <td key={c.key} className={`px-4 py-2 ${c.num ? 'tabular text-right' : ''}`}>{c.fmt && footer[c.key] !== undefined ? c.fmt(footer[c.key]) : footer[c.key]}</td>)}</tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function DaamrAnalytics() {
  const { can } = useAuth();
  const [q, setQ] = useQueryState({ from: '', to: '', districtId: '' });
  const { data: d, loading, error } = useApi(`/api/daamr/dashboard${qs(q)}`);
  const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  return (
    <>
      <PageHeader title="DAAMR Reports & Analytics" subtitle="Tabular breakdowns for reporting. Use Export for PDF, Excel or CSV." actions={can('daamr.export') && <ExportMenu compact url={(f) => `/api/daamr/dashboard/export${qs({ ...q, format: f })}`} />} />
      <DaamrFilters q={q} setQ={setQ} />
      <ErrorBox error={error} />
      {loading && !d ? <Spinner /> : d && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <T title="Activities by district" cols={[{ key: 'name', label: 'District / HQ' }, { key: 'value', label: 'Activities', num: true, fmt: fmtNum }]} rows={d.charts.byDistrict} footer={{ name: 'Total', value: sum(d.charts.byDistrict, 'value') }} />
          <T title="Activities by category" cols={[{ key: 'name', label: 'Category' }, { key: 'value', label: 'Activities', num: true, fmt: fmtNum }]} rows={d.charts.byCategory} footer={{ name: 'Total', value: sum(d.charts.byCategory, 'value') }} />
          <T title="Budget by district" cols={[{ key: 'name', label: 'District / HQ' }, { key: 'allocated', label: 'Allocated', num: true, fmt: fmtMoney }, { key: 'utilized', label: 'Utilized', num: true, fmt: fmtMoney }]} rows={d.charts.budgetByDistrict} footer={{ name: 'Total', allocated: sum(d.charts.budgetByDistrict, 'allocated'), utilized: sum(d.charts.budgetByDistrict, 'utilized') }} />
          <T title="Participant demographics" cols={[{ key: 'name', label: 'Category' }, { key: 'value', label: 'Participants', num: true, fmt: fmtNum }]} rows={d.charts.demographics} footer={{ name: `Total participants (counting rule)`, value: d.cards.totalParticipants }} />
          <T title="Monthly activity count" cols={[{ key: 'month', label: 'Month' }, { key: 'value', label: 'Activities', num: true, fmt: fmtNum }]} rows={d.charts.monthly.map((m: any) => ({ ...m, month: fmtMonth(m.month) }))} />
          <T title="Request approval status" cols={[{ key: 'name', label: 'Status' }, { key: 'value', label: 'Requests', num: true, fmt: fmtNum }]} rows={d.charts.approvalStatus} footer={{ name: 'Total', value: d.cards.totalRequests }} />
          <T title="Approval processing time" cols={[{ key: 'name', label: 'Approval level' }, { key: 'avgHours', label: 'Avg hours', num: true }, { key: 'decisions', label: 'Decisions', num: true }]} rows={d.charts.processingTimes} />
        </div>
      )}
    </>
  );
}
