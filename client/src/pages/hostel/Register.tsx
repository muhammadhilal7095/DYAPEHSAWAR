import { useNavigate } from 'react-router';
import { MapPin, Plus, Printer } from 'lucide-react';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDebounced, useDistricts, useQueryState } from '../../lib/hooks';
import { fmtDate, humanize } from '../../lib/format';
import { Badge, Button, Card, LinkButton, PageHeader, Pagination, Tabs } from '../../components/ui';
import { DataTable, ExportMenu, FilterBar, MiniDate, MiniSelect, SearchInput } from '../../components/DataTable';

export function BookingStatus({ b }: { b: { status: string; stayStatus: string } }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge status={b.status} />
      {b.status === 'APPROVED' && b.stayStatus !== 'NONE' && <Badge status={b.stayStatus} />}
    </div>
  );
}

export default function Register() {
  const { can } = useAuth();
  const nav = useNavigate();
  const districts = useDistricts();
  const hostels = useCached<any[]>('/api/hostel/hostels?all=true') ?? [];
  const canAll = can('hostel.booking.view_all', 'hostel.booking.view_district');
  const [q, setQ] = useQueryState({ scope: canAll ? 'all' : can('hostel.operations') ? 'managed' : 'mine', q: '', districtId: '', hostelId: '', organization: '', status: '', stayStatus: '', from: '', to: '', dateField: 'submitted', sort: 'updatedAt', page: '1' });
  const search = useDebounced(q.q);
  const org = useDebounced(q.organization);
  const params = { ...q, q: search, organization: org };
  const { data, loading } = useApi(`/api/hostel/bookings${qs(params)}`);
  const tabs = [
    ...(canAll ? [{ value: 'all', label: 'All bookings' }] : []),
    { value: 'assigned', label: 'My assigned approvals' },
    ...(can('hostel.booking.create') ? [{ value: 'mine', label: 'My submitted requests' }] : []),
    ...(can('hostel.operations') ? [{ value: 'managed', label: 'My hostels' }] : []),
  ];
  return (
    <>
      <PageHeader
        title="Booking Register"
        subtitle="Booking requests, approvals and stay status for every youth hostel."
        actions={<>
          <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>
          {can('hostel.export') && <ExportMenu compact label="Export" url={(f) => `/api/hostel/bookings/export${qs({ ...params, format: f, page: '', sort: '' })}`} />}
          {can('hostel.booking.create') && <LinkButton to="/hostels/bookings/new" icon={<Plus className="size-4" />}>New booking</LinkButton>}
        </>}
      />
      <Tabs value={q.scope} onChange={(v) => setQ({ scope: v })} tabs={tabs} />
      <Card bodyClass="p-0">
        <FilterBar
          onReset={() => setQ({ q: '', districtId: '', hostelId: '', organization: '', status: '', stayStatus: '', from: '', to: '' })}
          moreActive={[q.districtId, q.organization, q.from, q.to].filter(Boolean).length}
          more={
            <>
              <MiniSelect label="District / HQ" value={q.districtId} onChange={(v) => setQ({ districtId: v })} options={districts.map((d) => ({ value: d.id, label: d.name }))} />
              <label className="flex w-[calc(50%-0.375rem)] flex-col gap-1 text-xs font-medium text-ink-3 sm:w-auto">Organization<input className="w-full rounded-lg border border-line bg-white px-2.5 py-2 text-sm text-ink shadow-sm focus:border-brand focus:outline-none sm:w-44" value={q.organization} onChange={(e) => setQ({ organization: e.target.value })} /></label>
              <MiniSelect label="Date filter" value={q.dateField} all={null} onChange={(v) => setQ({ dateField: v })} options={[{ value: 'submitted', label: 'Request date' }, { value: 'checkin', label: 'Requested check-in' }, { value: 'approved', label: 'Approved check-in' }]} />
              <MiniDate label="From" value={q.from} onChange={(v) => setQ({ from: v })} />
              <MiniDate label="To" value={q.to} onChange={(v) => setQ({ to: v })} />
            </>
          }
        >
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v })} placeholder="Booking ID or guest name…" />
          <MiniSelect label="Hostel" value={q.hostelId} onChange={(v) => setQ({ hostelId: v })} options={hostels.map((h) => ({ value: h.id, label: h.name }))} />
          <MiniSelect label="Booking status" value={q.status} onChange={(v) => setQ({ status: v })} options={['DRAFT', 'PENDING_REVIEW', 'UNDER_REVIEW', 'PENDING_FINAL', 'RETURNED', 'APPROVED', 'DECLINED', 'CANCELLED'].map((s) => ({ value: s, label: s === 'PENDING_FINAL' ? 'Pending final approval' : humanize(s) }))} />
          <MiniSelect label="Stay status" value={q.stayStatus} onChange={(v) => setQ({ stayStatus: v })} options={['AWAITING_ARRIVAL', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED'].map((s) => ({ value: s, label: humanize(s) }))} />
        </FilterBar>
        {data && (
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs text-ink-3">
            <span><span className="tabular font-semibold text-ink">{data.total}</span> {data.total === 1 ? 'booking' : 'bookings'}</span>
            <span className="hidden sm:inline">Exports include every field · click a row to open the booking</span>
          </div>
        )}
        <DataTable
          loading={loading}
          rows={data?.rows}
          sort={q.sort}
          onSort={(s) => setQ({ sort: s })}
          onRowClick={(r: any) => nav(`/hostels/bookings/${r.id}`)}
          columns={[
            {
              key: 'guestName', header: 'Booking', sortKey: 'guestName', primary: true, render: (r: any) => (
                <div className="min-w-[190px] max-w-xs">
                  <span className="font-mono text-[11px] font-medium text-brand">{r.bookingId}</span>
                  <span className="mt-0.5 block font-medium leading-snug text-ink">{r.guestName}</span>
                  {r.organization && <span className="mt-0.5 line-clamp-1 text-xs text-ink-3">{r.organization}</span>}
                  <span className="mt-0.5 block text-[11px] text-ink-3 @[63rem]:hidden">Requested {fmtDate(r.submittedAt)}</span>
                </div>
              ),
            },
            { key: 'hostel', header: 'Youth hostel', render: (r: any) => <div className="min-w-[130px]"><span className="block">{r.hostel.name}</span><span className="inline-flex items-center gap-1 text-xs text-ink-3"><MapPin className="size-3" aria-hidden />{r.district.name}</span></div> },
            {
              key: 'dates', header: 'Stay', sortKey: 'checkIn', render: (r: any) => (
                <div className="whitespace-nowrap text-sm">
                  <span className="block">{fmtDate(r.requestedCheckIn)}</span>
                  <span className="block text-xs text-ink-3">to {fmtDate(r.requestedCheckOut)}</span>
                  {r.approvedCheckIn && (fmtDate(r.approvedCheckIn) !== fmtDate(r.requestedCheckIn) || fmtDate(r.approvedCheckOut) !== fmtDate(r.requestedCheckOut)) && (
                    <span className="mt-0.5 block text-[11px] font-medium text-emerald-700">Approved {fmtDate(r.approvedCheckIn)} – {fmtDate(r.approvedCheckOut)}</span>
                  )}
                </div>
              ),
            },
            { key: 'guests', header: 'Guests', render: (r: any) => <span className="tabular whitespace-nowrap"><span className="font-semibold">{r.numGuests}</span> <span className="text-xs text-ink-3">guests · {r.numRooms} rooms</span></span> },
            { key: 'status', header: 'Status', render: (r: any) => <div className="min-w-[120px]"><BookingStatus b={r} />{(r.currentAssignee ?? r.approvedBy) && <span className="mt-1 block text-[11px] text-ink-3">{r.currentAssignee ? `With ${r.currentAssignee.name}` : `By ${r.approvedBy.name}`}</span>}</div> },
            { key: 'submittedAt', header: 'Requested', sortKey: 'submittedAt', className: 'hidden @[63rem]:table-cell', hideOnCard: true, render: (r: any) => <div className="max-w-[170px] text-xs"><span className="block text-sm text-ink">{fmtDate(r.submittedAt)}</span><span className="block truncate text-ink-3">{r.requesterEmail}</span></div> },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ page: String(p) })} />}
      </Card>
    </>
  );
}
