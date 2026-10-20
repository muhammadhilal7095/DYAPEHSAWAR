import { useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, LineChart } from 'recharts';
import { BarChart3, Table2 } from 'lucide-react';
import { Card, Empty } from './ui';

/** Validated categorical order (see dataviz reference palette) — assign by series, never cycle. */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

const tooltipStyle = { borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,.08)' };
const fmt = (v: any) => (typeof v === 'number' ? v.toLocaleString('en-US') : v);

/** Chart card with a table-view toggle (accessibility & exact values). */
export function ChartCard({ title, subtitle, rows, columns, children, empty, height = 260 }: { title: string; subtitle?: string; rows: any[]; columns: { key: string; label: string; numeric?: boolean }[]; children: ReactNode; empty?: string; height?: number }) {
  const [table, setTable] = useState(false);
  return (
    <Card
      title={title}
      subtitle={subtitle}
      actions={
        rows.length > 0 && (
          <button onClick={() => setTable((t) => !t)} className="no-print inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-3 hover:bg-gray-100" aria-pressed={table}>
            {table ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />} {table ? 'Chart' : 'Table'}
          </button>
        )
      }
    >
      {!rows.length ? (
        <Empty title={empty ?? 'No data for the selected filters'} />
      ) : table ? (
        <div className="max-h-[300px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs text-ink-3">
              <tr>{columns.map((c) => <th key={c.key} className={`py-1.5 pr-3 font-medium ${c.numeric ? 'text-right' : ''}`}>{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => (
                <tr key={i}>{columns.map((c) => <td key={c.key} className={`py-1.5 pr-3 ${c.numeric ? 'tabular text-right' : ''}`}>{fmt(r[c.key])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </Card>
  );
}

/** Horizontal bars — magnitude by category, single series, direct value labels. */
export function HBars({ data, valueKey = 'value', labelKey = 'name', color = SERIES[0], valueLabel = 'Count' }: { data: any[]; valueKey?: string; labelKey?: string; color?: string; valueLabel?: string }) {
  const rows = data.slice(0, 12);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 36, top: 4, bottom: 4 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey={labelKey} width={120} tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11 }} />
        <Tooltip cursor={{ fill: 'rgba(0,0,0,.04)' }} contentStyle={tooltipStyle} formatter={(v: any) => [fmt(v), valueLabel]} />
        <Bar dataKey={valueKey} fill={color} radius={[0, 4, 4, 0]} maxBarSize={18}>
          <LabelList dataKey={valueKey} position="right" formatter={fmt as any} style={{ fill: '#374151', fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical columns over time (single series). */
export function Columns({ data, xKey = 'month', valueKey = 'value', color = SERIES[0], valueLabel = 'Count' }: { data: any[]; xKey?: string; valueKey?: string; color?: string; valueLabel?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: -16, right: 8, top: 16, bottom: 4 }} barCategoryGap="25%">
        <CartesianGrid vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: 'rgba(0,0,0,.04)' }} contentStyle={tooltipStyle} formatter={(v: any) => [fmt(v), valueLabel]} />
        <Bar dataKey={valueKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={36}>
          {data.length <= 12 && <LabelList dataKey={valueKey} position="top" style={{ fill: '#374151', fontSize: 11 }} />}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Two measures of the same unit side by side (e.g. allocated vs utilized budget). */
export function PairedBars({ data, series, xKey = 'name' }: { data: any[]; series: { key: string; label: string }[]; xKey?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 4 }} barGap={2}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11 }} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : v)} />
        <Tooltip cursor={{ fill: 'rgba(0,0,0,.04)' }} contentStyle={tooltipStyle} formatter={(v: any) => fmt(v)} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={28} stroke="#fff" strokeWidth={1} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Progress over time with an optional planned reference line. */
export function ProgressLine({ data }: { data: { date: string; progress: number; planned?: number | null }[] }) {
  const hasPlan = data.some((d) => d.planned != null);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: -12, right: 16, top: 12, bottom: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} unit="%" />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => `${v}%`} />
        {hasPlan && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />}
        <Line type="monotone" dataKey="progress" name="Actual progress" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
        {hasPlan && <Line type="monotone" dataKey="planned" name="Planned" stroke={SERIES[1]} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />}
      </LineChart>
    </ResponsiveContainer>
  );
}
