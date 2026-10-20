import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDistricts, useQueryState } from '../../lib/hooks';
import { addDays, fmtNum, humanize, todayISO } from '../../lib/format';
import { Card, ErrorBox, KV, PageHeader, Spinner } from '../../components/ui';
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
      <PageHeader title="Hostel Utilization Reports" subtitle="Reporting period applies to the booking request date; occupancy uses actual stays in the window." actions={can('hostel.export') && <ExportMenu url={(f) => `/api/hostel/dashboard/reports/export${qs({ ...q, format: f })}`} />} />
      <div className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 shadow-sm">
        <MiniDate label="From" value={q.from} onChange={(v) => setQ({ from: v })} />
        <MiniDate label="To" value={q.to} onChange={(v) => setQ({ to: v })} />
        <MiniSelect label="Hostel" value={q.hostelId} onChange={(v) => setQ({ hostelId: v })} options={hostels.map((h) => ({ value: h.id, label: h.name }))} />
        <MiniSelect label="District" value={q.districtId} onChange={(v) => setQ({ districtId: v })} options={districts.map((h) => ({ value: h.id, label: h.name }))} />
        <MiniSelect label="Status" value={q.status} onChange={(v) => setQ({ status: v })} options={['PENDING_REVIEW', 'UNDER_REVIEW', 'PENDING_FINAL', 'RETURNED', 'APPROVED', 'DECLINED', 'CANCELLED'].map((s) => ({ value: s, label: humanize(s) }))} />
      </div>
      <ErrorBox error={error} />
      {loading && !d ? <Spinner /> : d && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Bookings by hostel" rows={d.byHostel} columns={two('Hostel')}><HBars data={d.byHostel} valueLabel="Bookings" /></ChartCard>
          <ChartCard title="Bookings by district" rows={d.byDistrict} columns={two('District')}><HBars data={d.byDistrict} valueLabel="Bookings" /></ChartCard>
          <ChartCard title="Monthly booking trend" rows={d.monthly} columns={[{ key: 'month', label: 'Month' }, { key: 'value', label: 'Bookings', numeric: true }]}><Columns data={d.monthly} valueLabel="Bookings" /></ChartCard>
          <ChartCard title="Booking status summary" rows={d.statusSummary} columns={two('Status')}><HBars data={d.statusSummary} valueLabel="Bookings" /></ChartCard>
          <ChartCard title="Guests accommodated by hostel" rows={d.guestsByHostel} columns={[{ key: 'name', label: 'Hostel' }, { key: 'value', label: 'Guests', numeric: true }]}><HBars data={d.guestsByHostel} valueLabel="Guests" color={SERIES[0]} /></ChartCard>
          <ChartCard title="Rooms utilized by hostel" rows={d.roomsByHostel} columns={[{ key: 'name', label: 'Hostel' }, { key: 'value', label: 'Rooms', numeric: true }]}><HBars data={d.roomsByHostel} valueLabel="Rooms" color={SERIES[0]} /></ChartCard>
          <ChartCard title="Hostel occupancy rate" subtitle="Occupied ÷ in-service room-nights in the window" rows={d.occupancy} columns={[{ key: 'name', label: 'Hostel' }, { key: 'occupiedRoomNights', label: 'Occupied', numeric: true }, { key: 'roomNights', label: 'Available', numeric: true }, { key: 'rate', label: 'Occupancy %', numeric: true }]}><HBars data={d.occupancy} valueKey="rate" valueLabel="Occupancy %" /></ChartCard>
          <ChartCard title="Approved versus declined" rows={d.approvedVsDeclined} columns={two('Decision')}><HBars data={d.approvedVsDeclined} valueLabel="Bookings" /></ChartCard>
          <ChartCard title="Organization-wise bookings" rows={d.byOrganization} columns={two('Organization')} height={300}><HBars data={d.byOrganization} valueLabel="Bookings" /></ChartCard>
          <ChartCard title="Referral-wise bookings" rows={d.byReferral} columns={two('Referred by')} height={300}><HBars data={d.byReferral} valueLabel="Bookings" /></ChartCard>
          <Card title="Requested versus approved dates">
            <KV cols={2} items={[['Approved bookings', fmtNum(d.requestedVsApproved.approvedTotal)], ['Approved with different dates', fmtNum(d.requestedVsApproved.changed)], ['Requested nights', fmtNum(d.requestedVsApproved.requestedNights)], ['Approved nights', fmtNum(d.requestedVsApproved.approvedNights)]]} />
          </Card>
          <Card title="Check-in and check-out summary">
            <KV cols={2} items={[['Check-ins', d.checkInOut.checkIns], ['Check-outs', d.checkInOut.checkOuts], ['Currently in-house', d.checkInOut.inHouse], ['No-shows', d.checkInOut.noShows], ['Early departures', d.checkInOut.earlyDepartures], ['Extensions', d.checkInOut.extensions], ['Cancelled', d.checkInOut.cancelled]]} />
          </Card>
        </div>
      )}
    </>
  );
}
