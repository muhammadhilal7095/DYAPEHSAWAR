import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { AlertTriangle, BedDouble, LogIn, LogOut, Search } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { fmtDate, fmtDateTime, todayISO, toISODate } from '../../lib/format';
import { Badge, Button, Card, Empty, Input, PageHeader, Spinner, StatStrip, useToast } from '../../components/ui';
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
  const day = (d: string) => new Date(d);
  const DateBlock = ({ d, tone }: { d: string; tone: string }) => (
    <span className={`grid size-12 shrink-0 place-items-center rounded-lg text-center leading-none ring-1 ${tone}`}>
      <span><span className="block text-[10px] font-semibold uppercase">{day(d).toLocaleDateString('en-GB', { month: 'short' })}</span><span className="tabular text-lg font-bold">{day(d).getDate()}</span></span>
    </span>
  );
  const row = (b: any, kind: 'arrival' | 'inhouse') => {
    const arriveToday = toISODate(b.approvedCheckIn) === today;
    const lateArrival = toISODate(b.approvedCheckIn) < today;
    const dueOut = toISODate(b.approvedCheckOut) <= today;
    return (
      <li key={b.id}>
        <Link to={`/hostels/bookings/${b.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-brand-50/60">
          {kind === 'arrival'
            ? <DateBlock d={b.approvedCheckIn} tone={lateArrival ? 'bg-red-50 text-red-700 ring-red-200' : arriveToday ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-gray-50 text-ink-2 ring-line'} />
            : <DateBlock d={b.approvedCheckOut} tone={dueOut ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-brand-50 text-brand ring-brand-100'} />}
          <span className="min-w-0 flex-1">
            <span className="font-mono text-[11px] font-medium text-brand">{b.bookingId}</span>
            <span className="block truncate text-sm font-medium text-ink">{b.guestName}{b.organization && <span className="font-normal text-ink-3"> · {b.organization}</span>}</span>
            <span className="block truncate text-xs text-ink-3">{b.hostel.name} · {b.numGuests} guest{b.numGuests === 1 ? '' : 's'} · room{b.reservations.length === 1 ? '' : 's'} {b.reservations.map((r: any) => r.room.roomNumber).join(', ') || '—'}</span>
          </span>
          <span className="hidden shrink-0 text-right text-xs sm:block">
            {kind === 'arrival'
              ? (arriveToday ? <Badge tone="violet" label="Arriving today" /> : lateArrival ? <Badge tone="red" label="Overdue arrival" /> : <span className="text-ink-3">Arrives {fmtDate(b.approvedCheckIn)}</span>)
              : <>{dueOut ? <Badge tone="amber" label="Due to depart" /> : <span className="text-ink-3">Departs {fmtDate(b.approvedCheckOut)}</span>}<span className="mt-0.5 block text-ink-3">In since {fmtDateTime(b.stay?.checkInAt)}</span></>}
          </span>
        </Link>
      </li>
    );
  };
  const counts = data && {
    today: data.arrivals.filter((b: any) => toISODate(b.approvedCheckIn) === today).length,
    late: data.arrivals.filter((b: any) => toISODate(b.approvedCheckIn) < today).length,
    dueOut: data.inHouse.filter((b: any) => toISODate(b.approvedCheckOut) <= today).length,
  };
  return (
    <>
      <PageHeader title="Check-In / Check-Out" subtitle="Front desk: arrivals for the next 7 days and guests currently in-house at your hostels." />
      <div className="no-print mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 shadow-sm">
        <form onSubmit={find} className="flex w-full items-end gap-2 sm:w-auto">
          <div className="flex-1 sm:w-64"><Input label="Find booking by ID" placeholder="YHB-2026-00001" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          <Button type="submit" icon={<Search className="size-4" />}>Find</Button>
        </form>
        {data?.hostels?.length > 1 && <MiniSelect label="Hostel" value={hostelId} onChange={setHostelId} options={data.hostels.map((h: any) => ({ value: h.id, label: h.name }))} />}
      </div>
      {loading && !data ? <Spinner /> : data && (
        <>
          {!data.hostels.length && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">You are not assigned as manager of any hostel.</p>}
          <div className="mb-4">
            <StatStrip items={[
              { label: 'Arriving today', value: counts.today, icon: <LogIn className="size-4" />, tone: 'violet' },
              { label: 'Overdue arrivals', value: counts.late, icon: <AlertTriangle className="size-4" />, tone: counts.late ? 'red' : 'gray' },
              { label: 'In-house guests', value: data.inHouse.length, note: `${data.inHouse.reduce((n: number, b: any) => n + (b.numGuests ?? 0), 0)} people`, icon: <BedDouble className="size-4" />, tone: 'brand' },
              { label: 'Due to depart', value: counts.dueOut, icon: <LogOut className="size-4" />, tone: counts.dueOut ? 'amber' : 'gray' },
            ]} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Expected arrivals" subtitle="Next 7 days" actions={<Badge tone="violet" label={String(data.arrivals.length)} />} bodyClass="p-0">
              {data.arrivals.length ? <ul className="divide-y divide-line">{data.arrivals.map((b: any) => row(b, 'arrival'))}</ul> : <Empty title="No arrivals expected" />}
            </Card>
            <Card title="In-house guests" subtitle="Checked in now" actions={<Badge tone="green" label={String(data.inHouse.length)} />} bodyClass="p-0">
              {data.inHouse.length ? <ul className="divide-y divide-line">{data.inHouse.map((b: any) => row(b, 'inhouse'))}</ul> : <Empty title="No guests checked in" />}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
