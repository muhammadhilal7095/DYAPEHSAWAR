import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Download, FileSpreadsheet, FileText, Search, SlidersHorizontal } from 'lucide-react';
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
      <div className="@container relative hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-gray-50/80 text-[11px] uppercase tracking-wider text-ink-3">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cx('whitespace-nowrap px-4 py-3 font-semibold', c.className)}>
                  {c.sortKey && onSort ? (
                    <button className="group inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink" onClick={() => onSort(sort === c.sortKey ? `-${c.sortKey}` : c.sortKey!)}>
                      {c.header}
                      {sort === c.sortKey ? <ArrowDown className="size-3 text-brand" /> : sort === `-${c.sortKey}` ? <ArrowUp className="size-3 text-brand" /> : <ArrowUpDown className="size-3 opacity-30 group-hover:opacity-70" />}
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
                  <td key={c.key} className={cx('px-4 py-3', c.className)}>
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
            <div className="mb-3 font-medium text-ink">{cell(primary, r)}</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg bg-gray-50/80 p-3 text-xs">
              {columns.filter((c) => c !== primary && !c.hideOnCard).map((c) => (
                <div key={c.key} className="min-w-0">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{c.header}</dt>
                  <dd className="mt-0.5 break-words text-ink">{cell(c, r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExportMenu({ url, formats = ['pdf', 'xlsx', 'csv'], label = 'Export', compact }: { url: (format: string) => string; formats?: string[]; label?: string; compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
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
  const name = (f: string) => (f === 'pdf' ? 'PDF document' : f === 'xlsx' ? 'Excel workbook' : 'CSV file');
  if (compact) {
    return (
      <div className="no-print relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
        <Button variant="secondary" loading={!!busy} icon={<Download className="size-4" />} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
          {label}<ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </Button>
        {open && (
          <div role="menu" className="absolute right-0 z-30 mt-1 w-48 rounded-xl border border-line bg-white p-1 shadow-lg">
            {formats.map((f) => (
              <button key={f} role="menuitem" onClick={() => { setOpen(false); run(f); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-gray-50">
                <span className="text-ink-3">{icon(f)}</span>{name(f)}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
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

/** Filter bar: main filters always shown; `more` filters behind a toggle that shows how many are active. */
export function FilterBar({ children, onReset, more, moreActive = 0 }: { children: ReactNode; onReset?: () => void; more?: ReactNode; moreActive?: number }) {
  const [open, setOpen] = useState(moreActive > 0);
  return (
    <div className="no-print border-b border-line bg-gray-50/60 px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        {children}
        <div className="ml-auto flex items-center gap-1.5 max-sm:w-full max-sm:justify-end">
          {more && (
            <Button variant="secondary" size="sm" icon={<SlidersHorizontal className="size-3.5" />} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? 'Fewer filters' : 'More filters'}
              {moreActive > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] font-semibold text-white">{moreActive}</span>}
            </Button>
          )}
          {onReset && (
            <Button variant="ghost" size="sm" onClick={onReset}>
              Reset
            </Button>
          )}
        </div>
      </div>
      {more && open && <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-dashed border-line pt-3">{more}</div>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-full min-w-[200px] flex-1 sm:w-auto sm:max-w-sm">
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
    <label className="flex w-[calc(50%-0.375rem)] flex-col gap-1 text-xs font-medium text-ink-3 sm:w-auto">
      {label}
      <select className="w-full rounded-lg border border-line bg-white px-2.5 py-2 text-sm text-ink shadow-sm focus:border-brand focus:outline-none sm:min-w-[9rem]" value={value} onChange={(e) => onChange(e.target.value)}>
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
    <label className="flex w-[calc(50%-0.375rem)] flex-col gap-1 text-xs font-medium text-ink-3 sm:w-auto">
      {label}
      <input type="date" className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink shadow-sm focus:border-brand focus:outline-none" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
