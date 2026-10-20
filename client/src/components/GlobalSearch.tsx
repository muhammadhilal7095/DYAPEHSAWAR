import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { humanize } from '../lib/format';

export const ACTIVITY_PERMS = ['daamr.request.create', 'daamr.request.view_all', 'daamr.request.view_district', 'daamr.dashboard', 'daamr.report.create', 'daamr.assign'];

/** Global activity search: ID, title, venue, district, assigned officer, department or status. */
export function GlobalSearch() {
  const { can } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRows(null);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      api.get(`/api/daamr/requests?pageSize=6&q=${encodeURIComponent(term)}`).then((r) => setRows(r.rows)).catch(() => setRows([])).finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (!can(...ACTIVITY_PERMS)) return <span className="hidden truncate text-sm text-ink-3 sm:inline">Integrated Activity, Hostel &amp; Asset Management Portal</span>;

  const seeAll = () => {
    if (!q.trim()) return;
    nav(`/daamr/requests?scope=${can('daamr.request.view_all', 'daamr.request.view_district') ? 'all' : 'mine'}&q=${encodeURIComponent(q.trim())}`);
    setOpen(false);
  };

  return (
    <div className="relative max-w-xl" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        type="search"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter') seeAll(); if (e.key === 'Escape') setOpen(false); }}
        placeholder="Search activities — ID, title, venue, district, officer, status…"
        aria-label="Search activities"
        className="w-full rounded-lg border border-line bg-gray-50 py-2 pl-9 pr-3 text-sm focus:border-brand focus:bg-white focus:outline-none"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-xl border border-line bg-white shadow-lg">
          {busy && !rows ? (
            <p className="px-4 py-3 text-sm text-ink-3">Searching…</p>
          ) : rows && rows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-3">No activities found.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {rows?.map((r) => (
                <li key={r.id}>
                  <button className="flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left hover:bg-gray-50" onClick={() => nav(`/daamr/requests/${r.id}`)}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{r.subject}</span>
                      <span className="block truncate text-xs text-ink-3">{r.daamrId} · {r.district.name}{r.leadOfficer ? ` · ${r.leadOfficer.name}` : ''}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-ink-2">{humanize(r.lifecycle)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="block w-full border-t border-line bg-gray-50 px-4 py-2 text-left text-xs font-medium text-brand hover:bg-gray-100" onClick={seeAll}>See all results for “{q.trim()}” →</button>
        </div>
      )}
    </div>
  );
}
