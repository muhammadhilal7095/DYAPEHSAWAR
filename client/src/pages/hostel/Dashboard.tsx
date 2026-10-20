import { Link } from 'react-router';
import { CalendarCheck, ClipboardList, Info, Plus } from 'lucide-react';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useQueryState } from '../../lib/hooks';
import { addDays, fmtNum, todayISO } from '../../lib/format';
import { Card, ErrorBox, LinkButton, PageHeader, Spinner } from '../../components/ui';
import { ExportMenu, MiniDate } from '../../components/DataTable';

const DEFS: Record<string, string> = {
  totalRequests: 'Bookings submitted within the selected request-date range (drafts excluded).',
  approved: 'Bookings that received FINAL approval within the period.',
  declined: 'Bookings declined within the period.',
  pending: 'Bookings submitted in the period still awaiting a decision.',
  completed: 'Stays checked out (completed) within the period.',
  guestsFacilitated: 'Actual guests of stays checked in during the period (final count once checked out).',
  roomsBooked: 'Rooms reserved for bookings approved in the period — each booking counted once.',
};

export function HostelFilterSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const hostels = useCached<any[]>('/api/hostel/hostels?all=true') ?? [];
  const types = useCached<any[]>('/api/hostel/facility-types') ?? [];
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">
      Select Hostel / Facility Type
      <select className="min-w-56 rounded-lg border border-line bg-white px-2.5 py-2 text-sm text-ink shadow-sm focus:border-brand focus:outline-none" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="all">All</option>
        <optgroup label="Facility types">{types.map((t) => <option key={t.id} value={`facility:${t.id}`}>{t.name}</option>)}</optgroup>
        <optgroup label="Hostels">{hostels.map((h) => <option key={h.id} value={`hostel:${h.id}`}>{h.name}</option>)}</optgroup>
      </select>
    </label>
  );
}

export default function HostelDashboard() {
  const { can } = useAuth();
  const [q, setQ] = useQueryState({ from: addDays(todayISO(), -30), to: todayISO(), filter: 'all' });
  const { data: d, loading, error } = useApi(`/api/hostel/dashboard${qs(q)}`);
  const s = d?.summary;
  const reg = (extra: any) => `/hostels/bookings${qs({ scope: 'all', from: q.from, to: q.to, hostelId: q.filter.startsWith('hostel:') ? q.filter.slice(7) : '', ...extra })}`;
  const metrics: [string, string, number | undefined, string?][] = s ? [
    ['totalRequests', 'Total Requests', s.totalRequests, reg({})],
    ['approved', 'Approved', s.approved, reg({ status: 'APPROVED', dateField: '' })],
    ['declined', 'Declined', s.declined, reg({ status: 'DECLINED' })],
    ['pending', 'Pending', s.pending, reg({ status: 'PENDING_REVIEW,UNDER_REVIEW,PENDING_FINAL' })],
    ['completed', 'Completed', s.completed, reg({ stayStatus: 'COMPLETED', from: '', to: '' })],
    ['guestsFacilitated', 'Total Guests Facilitated', s.guestsFacilitated],
    ['roomsBooked', 'Total Rooms Booked', s.roomsBooked],
  ] : [];

  return (
    <>
      <PageHeader title="Youth Hostel Booking & Utilization" subtitle="Dashboard figures are calculated live from the database for the selected period and filter." actions={<>
        <LinkButton variant="secondary" to="/hostels/bookings" icon={<ClipboardList className="size-4" />}>Booking register</LinkButton>
        {can('hostel.operations') && <LinkButton variant="secondary" to="/hostels/operations" icon={<CalendarCheck className="size-4" />}>Check-in / out</LinkButton>}
        {can('hostel.booking.create') && <LinkButton to="/hostels/bookings/new" icon={<Plus className="size-4" />}>New booking</LinkButton>}
      </>} />
      {/* Filter strip — mirrors the spreadsheet header */}
      <div className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 shadow-sm">
        <MiniDate label="From Date" value={q.from} onChange={(v) => setQ({ from: v })} />
        <MiniDate label="To Date" value={q.to} onChange={(v) => setQ({ to: v })} />
        <HostelFilterSelect value={q.filter} onChange={(v) => setQ({ filter: v })} />
        <div className="ml-auto">{can('hostel.export') && <ExportMenu url={(f) => `/api/hostel/dashboard/export${qs({ ...q, format: f })}`} />}</div>
      </div>
      <ErrorBox error={error} />
      {loading && !d ? <Spinner /> : d && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
          <Card title="Summary Report" subtitle={`${q.from || '…'} to ${q.to || '…'} · ${d.filters.label}`} bodyClass="p-0">
            <table className="w-full text-sm">
              <thead className="bg-brand text-left text-xs uppercase tracking-wide text-white"><tr><th className="px-4 py-2 font-medium">Metric</th><th className="px-4 py-2 text-right font-medium">Value</th></tr></thead>
              <tbody className="divide-y divide-line">
                {metrics.map(([k, label, v, to]) => (
                  <tr key={k} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">{label}<span title={DEFS[k]} aria-label={DEFS[k]} className="cursor-help text-ink-3"><Info className="size-3.5" /></span></span>
                    </td>
                    <td className="tabular px-4 py-2.5 text-right text-base font-semibold">{to ? <Link to={to} className="text-brand hover:underline">{fmtNum(v)}</Link> : fmtNum(v)}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 text-ink-2"><td className="px-4 py-2.5">Currently checked in <span className="text-xs text-ink-3">(as of now)</span></td><td className="tabular px-4 py-2.5 text-right font-semibold">{fmtNum(s.currentlyCheckedIn)}</td></tr>
              </tbody>
            </table>
          </Card>
          <Card title="Youth Hostel Utilization Summary" subtitle="Completed stays (checked out in the period), actual guests and rooms used — approved-but-not-completed reservations are not counted." bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-brand text-left text-xs uppercase tracking-wide text-white">
                  <tr><th className="px-4 py-2 font-medium">Youth Hostel</th><th className="px-4 py-2 text-right font-medium">Completed Bookings</th><th className="px-4 py-2 text-right font-medium">Guests</th><th className="px-4 py-2 text-right font-medium">Rooms</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.utilization.map((u: any) => (
                    <tr key={u.hostelId} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5"><Link className="hover:text-brand hover:underline" to={reg({ hostelId: u.hostelId, stayStatus: 'COMPLETED', from: '', to: '' })}>{u.hostel}</Link></td>
                      <td className="tabular px-4 py-2.5 text-right">{fmtNum(u.completed)}</td>
                      <td className="tabular px-4 py-2.5 text-right">{fmtNum(u.guests)}</td>
                      <td className="tabular px-4 py-2.5 text-right">{fmtNum(u.rooms)}</td>
                    </tr>
                  ))}
                  {!d.utilization.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-3">No hostels match the filter.</td></tr>}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-brand-200 bg-brand-50 font-semibold"><td className="px-4 py-2.5">Total</td><td className="tabular px-4 py-2.5 text-right">{fmtNum(d.totals.completed)}</td><td className="tabular px-4 py-2.5 text-right">{fmtNum(d.totals.guests)}</td><td className="tabular px-4 py-2.5 text-right">{fmtNum(d.totals.rooms)}</td></tr>
                </tfoot>
              </table>
            </div>
            <div className="border-t border-line px-4 py-3 text-xs text-ink-3">
              Approved ≠ completed: {fmtNum(s.approved)} booking(s) approved in the period, {fmtNum(s.completed)} stay(s) completed, {fmtNum(s.currentlyCheckedIn)} currently in-house.
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
