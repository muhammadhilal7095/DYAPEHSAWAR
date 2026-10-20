import { useNavigate } from 'react-router';
import { Plus, Printer } from 'lucide-react';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDebounced, useDistricts, useQueryState } from '../../lib/hooks';
import { fmtDate, fmtDateTime, humanize } from '../../lib/format';
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
        subtitle="Youth hostel booking requests, approvals and accommodation status."
        actions={<>
          <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>
          {can('hostel.export') && <ExportMenu url={(f) => `/api/hostel/bookings/export${qs({ ...params, format: f, page: '', sort: '' })}`} />}
          {can('hostel.booking.create') && <LinkButton to="/hostels/bookings/new" icon={<Plus className="size-4" />}>New booking</LinkButton>}
        </>}
      />
      <Tabs value={q.scope} onChange={(v) => setQ({ scope: v })} tabs={tabs} />
      <Card bodyClass="p-0">
        <FilterBar onReset={() => setQ({ q: '', districtId: '', hostelId: '', organization: '', status: '', stayStatus: '', from: '', to: '' })}>
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v })} placeholder="Booking ID or guest name…" />
          <MiniSelect label="District / HQ" value={q.districtId} onChange={(v) => setQ({ districtId: v })} options={districts.map((d) => ({ value: d.id, label: d.name }))} />
          <MiniSelect label="Hostel" value={q.hostelId} onChange={(v) => setQ({ hostelId: v })} options={hostels.map((h) => ({ value: h.id, label: h.name }))} />
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">Organization<input className="rounded-lg border border-line px-2.5 py-2 text-sm" value={q.organization} onChange={(e) => setQ({ organization: e.target.value })} /></label>
          <MiniSelect label="Booking status" value={q.status} onChange={(v) => setQ({ status: v })} options={['DRAFT', 'PENDING_REVIEW', 'UNDER_REVIEW', 'PENDING_FINAL', 'RETURNED', 'APPROVED', 'DECLINED', 'CANCELLED'].map((s) => ({ value: s, label: s === 'PENDING_FINAL' ? 'Pending final approval' : humanize(s) }))} />
          <MiniSelect label="Stay status" value={q.stayStatus} onChange={(v) => setQ({ stayStatus: v })} options={['AWAITING_ARRIVAL', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED'].map((s) => ({ value: s, label: humanize(s) }))} />
          <MiniSelect label="Date filter" value={q.dateField} all={null} onChange={(v) => setQ({ dateField: v })} options={[{ value: 'submitted', label: 'Request date' }, { value: 'checkin', label: 'Requested check-in' }, { value: 'approved', label: 'Approved check-in' }]} />
          <MiniDate label="From" value={q.from} onChange={(v) => setQ({ from: v })} />
          <MiniDate label="To" value={q.to} onChange={(v) => setQ({ to: v })} />
        </FilterBar>
        <DataTable
          loading={loading}
          rows={data?.rows}
          sort={q.sort}
          onSort={(s) => setQ({ sort: s })}
          onRowClick={(r: any) => nav(`/hostels/bookings/${r.id}`)}
          columns={[
            { key: 'bookingId', header: 'Booking ID', sortKey: 'bookingId', primary: true, render: (r: any) => <span className="font-mono text-xs font-medium text-brand">{r.bookingId}</span> },
            { key: 'submittedAt', header: 'Request date', sortKey: 'submittedAt', render: (r: any) => fmtDate(r.submittedAt) },
            { key: 'requesterEmail', header: 'Requested by', hideOnCard: true, className: 'max-w-[160px] truncate' },
            { key: 'district', header: 'District/HQ', render: (r: any) => r.district.name, hideOnCard: true },
            { key: 'hostel', header: 'Youth hostel', render: (r: any) => r.hostel.name },
            { key: 'guestName', header: 'Guest name', sortKey: 'guestName', render: (r: any) => <span className="font-medium">{r.guestName}</span> },
            { key: 'cnic', header: 'CNIC/Passport', render: (r: any) => <span className="font-mono text-xs" title={r.identityMasked ? 'Masked — restricted information' : undefined}>{r.cnic}</span>, hideOnCard: true },
            { key: 'mobile', header: 'Mobile', hideOnCard: true },
            { key: 'organization', header: 'Organization' },
            { key: 'referredBy', header: 'Referred by', hideOnCard: true, render: (r: any) => r.referredBy ? `${r.referredBy}${r.referrerDesignation ? ` (${r.referrerDesignation})` : ''}` : '—' },
            { key: 'purpose', header: 'Purpose', hideOnCard: true, render: (r: any) => <span className="line-clamp-2 max-w-[200px]">{r.purpose}</span> },
            { key: 'dates', header: 'Check-in / out', sortKey: 'checkIn', render: (r: any) => <span className="whitespace-nowrap text-xs">{fmtDate(r.requestedCheckIn)} → {fmtDate(r.requestedCheckOut)}</span> },
            { key: 'guests', header: 'Guests / rooms', render: (r: any) => <span className="tabular">{r.numGuests} / {r.numRooms}</span> },
            { key: 'docs', header: 'Docs', hideOnCard: true, render: (r: any) => (r.files.length ? `${r.files.length} file(s)` : '—') },
            { key: 'approved', header: 'Approved dates', render: (r: any) => r.approvedCheckIn ? <span className="whitespace-nowrap text-xs">{fmtDate(r.approvedCheckIn)} → {fmtDate(r.approvedCheckOut)}</span> : '—' },
            { key: 'status', header: 'Booking status', render: (r: any) => <BookingStatus b={r} /> },
            { key: 'officer', header: 'With / approved by', render: (r: any) => r.currentAssignee?.name ?? r.approvedBy?.name ?? '—' },
            { key: 'approvedAt', header: 'Approval date', hideOnCard: true, render: (r: any) => (r.approvedAt ? fmtDateTime(r.approvedAt) : '—') },
            { key: 'hqRemarks', header: 'HQ remarks', hideOnCard: true, render: (r: any) => <span className="line-clamp-2 max-w-[200px] text-xs">{r.hqRemarks ?? '—'}</span> },
            { key: 'emailStatus', header: 'Email', hideOnCard: true, render: (r: any) => (r.emailStatus === 'NONE' ? '—' : <Badge status={r.emailStatus} />) },
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ page: String(p) })} />}
      </Card>
    </>
  );
}
