import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Download, FileSpreadsheet, FileText, Search } from 'lucide-react';
import { download } from '../lib/api';
import { Button, Empty, Spinner, cx, useToast } from './ui';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  className?: string;
  sortKey?: string; // server sort key
  hideOnCard?: boolean;
  primary?: boolean; // shown as card title on mobile
}

export function DataTable<T extends { id: string }>({
  columns, rows, loading, empty, onRowClick, sort, onSort, rowClassName,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  sort?: string;
  onSort?: (s: string) => void;
  rowClassName?: (row: T) => string;
}) {
  if (loading && !rows) return <Spinner />;
  if (!rows?.length) return <Empty title="No records found">{empty}</Empty>;
  const cell = (c: Column<T>, r: T) => (c.render ? c.render(r) : ((r as any)[c.key] ?? '—'));
  const primary = columns.find((c) => c.primary) ?? columns[0];
  return (
    <div className={cx(loading && 'opacity-60 transition-opacity')}>
      {/* desktop / tablet */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-ink-3">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cx('whitespace-nowrap px-3 py-2.5 font-medium', c.className)}>
                  {c.sortKey && onSort ? (
                    <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => onSort(sort === c.sortKey ? `-${c.sortKey}` : c.sortKey!)}>
                      {c.header}
                      {sort === c.sortKey ? <ArrowDown className="size-3" /> : sort === `-${c.sortKey}` ? <ArrowUp className="size-3" /> : null}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cx('align-top transition', onRowClick && 'cursor-pointer hover:bg-brand-50/60', rowClassName?.(r))}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cx('px-3 py-2.5', c.className)}>
                    {cell(c, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* mobile cards */}
      <ul className="divide-y divide-line md:hidden">
        {rows.map((r) => (
          <li key={r.id} className={cx('p-4', onRowClick && 'cursor-pointer active:bg-gray-50')} onClick={onRowClick ? () => onRowClick(r) : undefined}>
            <div className="mb-2 font-medium text-ink">{cell(primary, r)}</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {columns.filter((c) => c !== primary && !c.hideOnCard).map((c) => (
                <div key={c.key} className="min-w-0">
                  <dt className="text-ink-3">{c.header}</dt>
                  <dd className="break-words text-ink">{cell(c, r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExportMenu({ url, formats = ['pdf', 'xlsx', 'csv'], label = 'Export' }: { url: (format: string) => string; formats?: string[]; label?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const run = async (f: string) => {
    setBusy(f);
    try {
      await download(url(f));
    } catch (e: any) {
      toast('error', e.message);
    } finally {
      setBusy(null);
    }
  };
  const icon = (f: string) => (f === 'pdf' ? <FileText className="size-4" /> : f === 'xlsx' ? <FileSpreadsheet className="size-4" /> : <Download className="size-4" />);
  return (
    <div className="no-print flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {formats.map((f) => (
        <Button key={f} variant={f === 'pdf' ? 'primary' : 'secondary'} size="sm" loading={busy === f} icon={icon(f)} onClick={() => run(f)}>
          {f === 'pdf' ? 'Export PDF' : f === 'xlsx' ? 'Excel' : 'CSV'}
        </Button>
      ))}
    </div>
  );
}

/** One-row filter bar container. */
export function FilterBar({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div className="no-print flex flex-wrap items-end gap-3 border-b border-line bg-gray-50/60 px-4 py-3">
      {children}
      {onReset && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset
        </Button>
      )}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        type="search"
        aria-label={placeholder}
        className="w-full rounded-lg border border-line bg-white py-2 pl-8 pr-3 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function MiniSelect({ label, value, onChange, options, all = 'All' }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; all?: string | null }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">
      {label}
      <select className="rounded-lg border border-line bg-white px-2.5 py-2 text-sm text-ink shadow-sm focus:border-brand focus:outline-none" value={value} onChange={(e) => onChange(e.target.value)}>
        {all !== null && <option value="">{all}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MiniDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">
      {label}
      <input type="date" className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink shadow-sm focus:border-brand focus:outline-none" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
