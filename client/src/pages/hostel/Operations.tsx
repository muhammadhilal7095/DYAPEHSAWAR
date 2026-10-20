import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { fmtDate, fmtDateTime, todayISO, toISODate } from '../../lib/format';
import { Badge, Button, Card, Empty, Input, PageHeader, Spinner, useToast } from '../../components/ui';
import { MiniSelect } from '../../components/DataTable';

export default function Operations() {
  const [hostelId, setHostelId] = useState('');
  const { data, loading } = useApi(`/api/hostel/bookings/operations/board${qs({ hostelId })}`);
  const [ref, setRef] = useState('');
  const nav = useNavigate();
  const toast = useToast();
  const find = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.get(`/api/hostel/bookings${qs({ q: ref.trim(), scope: '' })}`);
      const hit = r.rows.find((x: any) => x.bookingId.toLowerCase() === ref.trim().toLowerCase()) ?? r.rows[0];
      if (hit) nav(`/hostels/bookings/${hit.id}`);
      else toast('error', 'No booking found with that ID in your hostels.');
    } catch (err: any) {
      toast('error', err.message);
    }
  };
  const today = todayISO();
  const row = (b: any, kind: 'arrival' | 'inhouse') => (
    <li key={b.id}>
      <Link to={`/hostels/bookings/${b.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-gray-50">
        <span className="font-mono text-xs text-brand">{b.bookingId}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{b.guestName} <span className="font-normal text-ink-3">· {b.organization}</span></span>
          <span className="block text-xs text-ink-3">{b.hostel.name} · {b.numGuests} guest(s) · rooms {b.reservations.map((r: any) => r.room.roomNumber).join(', ') || '—'}</span>
        </span>
        <span className="text-right text-xs">
          {kind === 'arrival' ? (
            <>{toISODate(b.approvedCheckIn) === today ? <Badge tone="violet" label="Arriving today" /> : toISODate(b.approvedCheckIn) < today ? <Badge tone="red" label="Overdue arrival" /> : <span className="text-ink-3">Arrives {fmtDate(b.approvedCheckIn)}</span>}</>
          ) : (
            <>{toISODate(b.approvedCheckOut) <= today ? <Badge tone="amber" label="Due to depart" /> : <span className="text-ink-3">Departs {fmtDate(b.approvedCheckOut)}</span>}<span className="block text-ink-3">In since {fmtDateTime(b.stay?.checkInAt)}</span></>
          )}
        </span>
      </Link>
    </li>
  );
  return (
    <>
      <PageHeader title="Check-In / Check-Out" subtitle="Arrivals for the next 7 days and guests currently in-house at your hostels." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <form onSubmit={find} className="flex items-end gap-2">
          <Input label="Find booking by ID" placeholder="YHB-2026-00001" value={ref} onChange={(e) => setRef(e.target.value)} />
          <Button type="submit" variant="secondary" icon={<Search className="size-4" />}>Find</Button>
        </form>
        {data?.hostels?.length > 1 && <MiniSelect label="Hostel" value={hostelId} onChange={setHostelId} options={data.hostels.map((h: any) => ({ value: h.id, label: h.name }))} />}
      </div>
      {loading && !data ? <Spinner /> : data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title={`Expected arrivals (${data.arrivals.length})`} bodyClass="p-0">
            {data.arrivals.length ? <ul className="divide-y divide-line">{data.arrivals.map((b: any) => row(b, 'arrival'))}</ul> : <Empty title="No arrivals expected" />}
          </Card>
          <Card title={`In-house guests (${data.inHouse.length})`} bodyClass="p-0">
            {data.inHouse.length ? <ul className="divide-y divide-line">{data.inHouse.map((b: any) => row(b, 'inhouse'))}</ul> : <Empty title="No guests checked in" />}
          </Card>
          {!data.hostels.length && <p className="text-sm text-ink-3">You are not assigned as manager of any hostel.</p>}
        </div>
      )}
    </>
  );
}
