import { Link } from 'react-router';
import { BedDouble, CalendarCheck, CheckCircle2, ClipboardList, Hourglass, LogOut, Plus, Users, XCircle } from 'lucide-react';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useQueryState } from '../../lib/hooks';
import { addDays, fmtNum, todayISO } from '../../lib/format';
import { Card, ErrorBox, KpiTile, LinkButton, PageHeader, Spinner, StatStrip } from '../../components/ui';
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
    <label className="flex w-full flex-col gap-1 text-xs font-medium text-ink-3 sm:w-auto">
      Hostel / facility type
      <select className="w-full rounded-lg sm:min-w-56 border border-line bg-white px-2.5 py-2 text-sm text-ink shadow-sm focus:border-brand focus:outline-none" value={value} onChange={(e) => onChange(e.target.value)}>
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

  const maxGuests = d ? Math.max(1, ...d.utilization.map((u: any) => u.guests)) : 1;
  return (
    <>
      <PageHeader
        title="Youth Hostel Dashboard"
        subtitle="Bookings, stays and utilization for the selected period — calculated live."
        actions={<>
          {can('hostel.export') && <ExportMenu compact label="Export" url={(f) => `/api/hostel/dashboard/export${qs({ ...q, format: f })}`} />}
          {can('hostel.booking.create') && <LinkButton to="/hostels/bookings/new" icon={<Plus className="size-4" />}>New booking</LinkButton>}
        </>}
      />
      <div className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 shadow-sm">
        <MiniDate label="From date" value={q.from} onChange={(v) => setQ({ from: v })} />
        <MiniDate label="To date" value={q.to} onChange={(v) => setQ({ to: v })} />
        <HostelFilterSelect value={q.filter} onChange={(v) => setQ({ filter: v })} />
        {d && <p className="ml-auto self-center text-xs text-ink-3 max-sm:w-full">Showing <span className="font-medium text-ink-2">{d.filters.label}</span></p>}
      </div>
      <ErrorBox error={error} />
      {loading && !d ? <Spinner /> : d && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiTile label="Booking requests" value={fmtNum(s.totalRequests)} note="Submitted in the period" to={reg({})} icon={<ClipboardList className="size-5" />} title={DEFS.totalRequests} />
            <KpiTile label="Approved" value={fmtNum(s.approved)} note="Final approval in the period" to={reg({ status: 'APPROVED', dateField: '' })} icon={<CheckCircle2 className="size-5" />} tone="green" title={DEFS.approved} />
            <KpiTile label="Pending decision" value={fmtNum(s.pending)} note="Awaiting review or approval" to={reg({ status: 'PENDING_REVIEW,UNDER_REVIEW,PENDING_FINAL' })} icon={<Hourglass className="size-5" />} tone="amber" title={DEFS.pending} />
            <KpiTile label="Completed stays" value={fmtNum(s.completed)} note="Checked out in the period" to={reg({ stayStatus: 'COMPLETED', from: '', to: '' })} icon={<LogOut className="size-5" />} tone="blue" title={DEFS.completed} />
          </div>
          <div className="mt-4">
            <StatStrip
              title="Occupancy & guests"
              subtitle="Hover a figure for its definition"
              items={[
                { label: 'Guests facilitated', value: fmtNum(s.guestsFacilitated), note: 'Actual guests checked in', icon: <Users className="size-4" />, tone: 'blue', title: DEFS.guestsFacilitated },
                { label: 'Rooms booked', value: fmtNum(s.roomsBooked), note: 'For approved bookings', icon: <BedDouble className="size-4" />, tone: 'brand', title: DEFS.roomsBooked },
                { label: 'In-house now', value: fmtNum(s.currentlyCheckedIn), note: 'Currently checked in', icon: <CalendarCheck className="size-4" />, tone: 'green', to: can('hostel.operations') ? '/hostels/operations' : undefined },
                { label: 'Declined', value: fmtNum(s.declined), note: 'Declined in the period', icon: <XCircle className="size-4" />, tone: 'red', to: reg({ status: 'DECLINED' }), title: DEFS.declined },
              ]}
            />
          </div>

          <Card title="Utilization by Youth Hostel" subtitle="Completed stays checked out in the period. Approved reservations that have not been completed are not counted." className="mt-4" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-gray-50/80 text-left text-[11px] uppercase tracking-wider text-ink-3">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Youth hostel</th>
                    <th className="px-4 py-3 text-right font-semibold">Stays</th>
                    <th className="px-4 py-3 text-right font-semibold">Guests</th>
                    <th className="px-4 py-3 text-right font-semibold">Rooms</th>
                    <th className="hidden w-56 px-4 py-3 font-semibold sm:table-cell">Share of guests</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.utilization.map((u: any) => (
                    <tr key={u.hostelId} className="hover:bg-brand-50/60">
                      <td className="px-4 py-3 font-medium"><Link className="hover:text-brand hover:underline" to={reg({ hostelId: u.hostelId, stayStatus: 'COMPLETED', from: '', to: '' })}>{u.hostel}</Link></td>
                      <td className="tabular px-4 py-3 text-right">{fmtNum(u.completed)}</td>
                      <td className="tabular px-4 py-3 text-right font-semibold">{fmtNum(u.guests)}</td>
                      <td className="tabular px-4 py-3 text-right">{fmtNum(u.rooms)}</td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <span className="flex items-center gap-2">
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100"><span className="block h-full rounded-full bg-brand" style={{ width: `${(u.guests / maxGuests) * 100}%` }} /></span>
                          <span className="tabular w-10 text-right text-xs text-ink-2">{d.totals.guests ? Math.round((u.guests / d.totals.guests) * 100) : 0}%</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!d.utilization.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-3">No hostels match the filter.</td></tr>}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line bg-brand-50 font-semibold"><td className="px-4 py-3">Total</td><td className="tabular px-4 py-3 text-right">{fmtNum(d.totals.completed)}</td><td className="tabular px-4 py-3 text-right">{fmtNum(d.totals.guests)}</td><td className="tabular px-4 py-3 text-right">{fmtNum(d.totals.rooms)}</td><td className="hidden sm:table-cell" /></tr>
                </tfoot>
              </table>
            </div>
            <div className="border-t border-line px-4 py-3 text-xs text-ink-3">
              Approved is not the same as completed: {fmtNum(s.approved)} booking(s) approved in the period, {fmtNum(s.completed)} stay(s) completed, {fmtNum(s.currentlyCheckedIn)} currently in-house.
            </div>
          </Card>
        </>
      )}
    </>
  );
}
