import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDistricts, useQueryState } from '../../lib/hooks';
import { addDays, fmtMonth, fmtNum, humanize, todayISO } from '../../lib/format';
import { BedDouble, CalendarClock, CheckCircle2, LogIn, LogOut, Moon, UserX } from 'lucide-react';
import { ErrorBox, PageHeader, Spinner, StatStrip } from '../../components/ui';
import { ExportMenu, MiniDate, MiniSelect } from '../../components/DataTable';
import { ChartCard, Columns, HBars, SERIES } from '../../components/Charts';

export default function HostelReports() {
  const { can } = useAuth();
  const districts = useDistricts();
  const hostels = useCached<any[]>('/api/hostel/hostels?all=true') ?? [];
  const [q, setQ] = useQueryState({ from: addDays(todayISO(), -90), to: todayISO(), hostelId: '', districtId: '', status: '' });
  const { data: d, loading, error } = useApi(`/api/hostel/dashboard/reports${qs(q)}`);
  const two = (name: string) => [{ key: 'name', label: name }, { key: 'value', label: 'Count', numeric: true }];
  return (
    <>
      <PageHeader title="Hostel Utilization Reports" subtitle="Period applies to the booking request date; occupancy uses actual stays in the window." actions={can('hostel.export') && <ExportMenu compact label="Export" url={(f) => `/api/hostel/dashboard/reports/export${qs({ ...q, format: f })}`} />} />
      <div className="no-print mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 shadow-sm">
        <MiniDate label="From" value={q.from} onChange={(v) => setQ({ from: v })} />
        <MiniDate label="To" value={q.to} onChange={(v) => setQ({ to: v })} />
        <MiniSelect label="Hostel" value={q.hostelId} onChange={(v) => setQ({ hostelId: v })} options={hostels.map((h) => ({ value: h.id, label: h.name }))} />
        <MiniSelect label="District" value={q.districtId} onChange={(v) => setQ({ districtId: v })} options={districts.map((h) => ({ value: h.id, label: h.name }))} />
        <MiniSelect label="Status" value={q.status} onChange={(v) => setQ({ status: v })} options={['PENDING_REVIEW', 'UNDER_REVIEW', 'PENDING_FINAL', 'RETURNED', 'APPROVED', 'DECLINED', 'CANCELLED'].map((s) => ({ value: s, label: humanize(s) }))} />
      </div>
      <ErrorBox error={error} />
      {loading && !d ? <Spinner /> : d && (() => { const monthly = d.monthly.map((m: any) => ({ ...m, label: fmtMonth(m.month) })); return (
        <>
        <div className="mb-4 grid grid-cols-1 gap-4 2xl:grid-cols-2">
          <StatStrip title="Check-in & check-out" items={[
            { label: 'Check-ins', value: fmtNum(d.checkInOut.checkIns), icon: <LogIn className="size-4" />, tone: 'blue' },
            { label: 'Check-outs', value: fmtNum(d.checkInOut.checkOuts), icon: <LogOut className="size-4" />, tone: 'green' },
            { label: 'In-house', value: fmtNum(d.checkInOut.inHouse), icon: <BedDouble className="size-4" />, tone: 'brand' },
            { label: 'No-shows', value: fmtNum(d.checkInOut.noShows), note: `${fmtNum(d.checkInOut.cancelled)} cancelled`, icon: <UserX className="size-4" />, tone: 'red' },
          ]} />
          <StatStrip title="Requested vs approved" items={[
            { label: 'Approved', value: fmtNum(d.requestedVsApproved.approvedTotal), icon: <CheckCircle2 className="size-4" />, tone: 'green' },
            { label: 'Dates changed', value: fmtNum(d.requestedVsApproved.changed), icon: <CalendarClock className="size-4" />, tone: 'amber' },
            { label: 'Nights requested', value: fmtNum(d.requestedVsApproved.requestedNights), icon: <Moon className="size-4" />, tone: 'gray' },
            { label: 'Nights approved', value: fmtNum(d.requestedVsApproved.approvedNights), note: `${fmtNum(d.checkInOut.earlyDepartures)} early departures · ${fmtNum(d.checkInOut.extensions)} extensions`, icon: <Moon className="size-4" />, tone: 'brand' },
          ]} />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Bookings by hostel" rows={d.byHostel} columns={two('Hostel')}><HBars data={d.byHostel} valueLabel="Bookings" /></ChartCard>
          <ChartCard title="Bookings by district" rows={d.byDistrict} columns={two('District')}><HBars data={d.byDistrict} valueLabel="Bookings" /></ChartCard>
          <ChartCard title="Monthly booking trend" rows={monthly} columns={[{ key: 'label', label: 'Month' }, { key: 'value', label: 'Bookings', numeric: true }]}><Columns data={monthly} xKey="label" valueLabel="Bookings" /></ChartCard>
          <ChartCard title="Booking status summary" rows={d.statusSummary} columns={two('Status')}><HBars data={d.statusSummary} valueLabel="Bookings" /></ChartCard>
          <ChartCard title="Guests accommodated by hostel" rows={d.guestsByHostel} columns={[{ key: 'name', label: 'Hostel' }, { key: 'value', label: 'Guests', numeric: true }]}><HBars data={d.guestsByHostel} valueLabel="Guests" color={SERIES[0]} /></ChartCard>
          <ChartCard title="Rooms utilized by hostel" rows={d.roomsByHostel} columns={[{ key: 'name', label: 'Hostel' }, { key: 'value', label: 'Rooms', numeric: true }]}><HBars data={d.roomsByHostel} valueLabel="Rooms" color={SERIES[0]} /></ChartCard>
          <ChartCard title="Hostel occupancy rate" subtitle="Occupied ÷ in-service room-nights in the window" rows={d.occupancy} columns={[{ key: 'name', label: 'Hostel' }, { key: 'occupiedRoomNights', label: 'Occupied', numeric: true }, { key: 'roomNights', label: 'Available', numeric: true }, { key: 'rate', label: 'Occupancy %', numeric: true }]}><HBars data={d.occupancy} valueKey="rate" valueLabel="Occupancy %" /></ChartCard>
          <ChartCard title="Approved versus declined" rows={d.approvedVsDeclined} columns={two('Decision')}><HBars data={d.approvedVsDeclined} valueLabel="Bookings" /></ChartCard>
          <ChartCard title="Organization-wise bookings" rows={d.byOrganization} columns={two('Organization')} height={300}><HBars data={d.byOrganization} valueLabel="Bookings" /></ChartCard>
          <ChartCard title="Referral-wise bookings" rows={d.byReferral} columns={two('Referred by')} height={300}><HBars data={d.byReferral} valueLabel="Bookings" /></ChartCard>
        </div>
        </>
      ); })()}
    </>
  );
}
