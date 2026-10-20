import { Router } from 'express';
import { prisma } from '../../db.js';
import { requirePerm, type AuthUser } from '../../lib/auth.js';
import { dateRangeFilter } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { sendExport, humanize, fmtDate } from '../../lib/export.js';
import { bookingScope, PENDING_STATUSES, nights, todayUtc } from './common.js';

export const hostelDashboardRouter = Router();

/** filter = "all" | "hostel:<id>" | "facility:<id>" */
async function hostelFilter(filter: string | undefined) {
  if (filter?.startsWith('hostel:')) {
    const h = await prisma.hostel.findUnique({ where: { id: filter.slice(7) }, select: { name: true } });
    return { where: { hostelId: filter.slice(7) }, hostelWhere: { id: filter.slice(7) }, label: h?.name ?? 'Unknown hostel' };
  }
  if (filter?.startsWith('facility:')) {
    const f = await prisma.facilityType.findUnique({ where: { id: filter.slice(9) }, select: { name: true } });
    return { where: { hostel: { facilityTypeId: filter.slice(9) } }, hostelWhere: { facilityTypeId: filter.slice(9) }, label: f?.name ?? 'Unknown facility type' };
  }
  return { where: {}, hostelWhere: {}, label: 'All' };
}

/**
 * Metric definitions (period = From–To, inclusive):
 *  Total Requests  – bookings submitted in the period (drafts excluded).
 *  Approved        – bookings whose FINAL approval was given in the period.
 *  Declined        – bookings declined in the period.
 *  Pending         – bookings submitted in the period that are still awaiting a decision (incl. returned for correction).
 *  Completed       – stays checked out in the period.
 *  Guests Facilitated – actual guests of stays that checked in within the period (final count when checked out).
 *  Rooms Booked    – rooms reserved for bookings finally approved in the period (one booking counted once).
 *  Utilization table – per hostel: completed stays (checked out in period), their guests and rooms actually used.
 */
export async function hostelDashboardData(user: AuthUser, q: any) {
  const range = dateRangeFilter(q.from, q.to);
  const f = await hostelFilter(q.filter);
  const scope = bookingScope(user);
  const base = (extra: any) => ({ AND: [scope, f.where, extra] });

  const [totalRequests, approved, declined, pending, returned, completedStays, checkIns, approvedBookings, currentlyIn, hostels] = await Promise.all([
    prisma.hostelBooking.count({ where: base({ status: { not: 'DRAFT' }, ...(range ? { submittedAt: range } : {}) }) }),
    prisma.hostelBooking.count({ where: base({ approvedAt: range ?? { not: null } }) }),
    prisma.hostelBooking.count({ where: base({ status: 'DECLINED', ...(range ? { declinedAt: range } : {}) }) }),
    prisma.hostelBooking.count({ where: base({ status: { in: PENDING_STATUSES }, ...(range ? { submittedAt: range } : {}) }) }),
    prisma.hostelBooking.count({ where: base({ status: 'RETURNED', ...(range ? { submittedAt: range } : {}) }) }),
    prisma.hostelBooking.findMany({ where: base({ stayStatus: 'COMPLETED', stay: { checkOutAt: range ?? { not: null } } }), select: { hostelId: true, numRooms: true, stay: true } }),
    prisma.stayRecord.findMany({ where: { ...(range ? { checkInAt: range } : {}), booking: base({}) }, select: { actualGuests: true, finalGuests: true, checkOutAt: true } }),
    prisma.hostelBooking.findMany({ where: base({ approvedAt: range ?? { not: null } }), select: { id: true, _count: { select: { reservations: true } } } }),
    prisma.hostelBooking.count({ where: base({ stayStatus: 'CHECKED_IN' }) }),
    prisma.hostel.findMany({ where: f.hostelWhere, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  const guestsFacilitated = checkIns.reduce((a, s) => a + (s.checkOutAt && s.finalGuests != null ? s.finalGuests : s.actualGuests), 0);
  const roomsBooked = approvedBookings.reduce((a, b) => a + b._count.reservations, 0);

  const util = new Map(hostels.map((h) => [h.id, { hostel: h.name, hostelId: h.id, completed: 0, guests: 0, rooms: 0 }]));
  for (const b of completedStays) {
    const row = util.get(b.hostelId);
    if (!row || !b.stay) continue;
    row.completed++;
    row.guests += b.stay.finalGuests ?? b.stay.actualGuests;
    row.rooms += b.stay.finalRooms ?? b.stay.actualRooms;
  }
  const utilization = [...util.values()];
  const totals = utilization.reduce((a, r) => ({ completed: a.completed + r.completed, guests: a.guests + r.guests, rooms: a.rooms + r.rooms }), { completed: 0, guests: 0, rooms: 0 });

  return {
    filters: { from: q.from ?? null, to: q.to ?? null, filter: q.filter ?? 'all', label: f.label },
    summary: {
      totalRequests,
      approved,
      declined,
      pending,
      returned,
      completed: completedStays.length,
      guestsFacilitated,
      roomsBooked,
      currentlyCheckedIn: currentlyIn,
    },
    utilization,
    totals,
  };
}

hostelDashboardRouter.get('/', requirePerm('hostel.dashboard', 'hostel.booking.create', 'hostel.operations'), async (req, res) => {
  res.json(await hostelDashboardData(req.user!, req.query));
});

hostelDashboardRouter.get('/export', requirePerm('hostel.export'), async (req, res) => {
  const d = await hostelDashboardData(req.user!, req.query);
  const s = d.summary;
  await audit(prisma, req, { action: 'EXPORT', module: 'HOSTEL', entityType: 'Dashboard', after: { format: req.query.format, filters: req.query } });
  await sendExport(res, String(req.query.format ?? 'pdf'), {
    title: 'Youth Hostel Booking & Utilization Report',
    filename: `hostel-utilization-${d.filters.from ?? 'all'}-${d.filters.to ?? 'today'}`,
    meta: [['Reporting period', `${d.filters.from ? fmtDate(d.filters.from) : 'Beginning'} to ${d.filters.to ? fmtDate(d.filters.to) : 'Today'}`], ['Hostel / facility type', d.filters.label]],
    sections: [
      { type: 'kv', title: 'Summary Report', items: [
        ['Total Requests', s.totalRequests], ['Approved', s.approved], ['Declined', s.declined], ['Pending', s.pending], ['Completed', s.completed],
        ['Total Guests Facilitated', s.guestsFacilitated], ['Total Rooms Booked', s.roomsBooked], ['Currently checked in (as of now)', s.currentlyCheckedIn],
      ] },
      {
        type: 'table',
        title: 'Youth Hostel Utilization Summary',
        columns: [{ key: 'hostel', label: 'Youth Hostel', width: 3 }, { key: 'completed', label: 'Completed Bookings', align: 'right', width: 1.3 }, { key: 'guests', label: 'Guests', align: 'right' }, { key: 'rooms', label: 'Rooms', align: 'right' }],
        rows: d.utilization,
        footer: { hostel: 'Total', ...d.totals },
      },
      { type: 'text', title: 'Definitions', text: 'Total Requests: submitted in the period. Approved/Declined: final decision in the period. Pending: submitted in the period and awaiting decision. Completed: stays checked out in the period. Guests Facilitated: actual guests of stays checked in during the period. Rooms Booked: rooms reserved for bookings approved in the period. Utilization: completed stays, actual guests and rooms used, per hostel.' },
    ],
  }, req.user!.name);
});

// ───────────── Reports & analytics ─────────────

export async function hostelReportData(user: AuthUser, q: any) {
  const range = dateRangeFilter(q.from, q.to);
  const and: any[] = [bookingScope(user), { status: { not: 'DRAFT' } }];
  if (range) and.push({ submittedAt: range });
  if (q.hostelId) and.push({ hostelId: String(q.hostelId) });
  if (q.districtId) and.push({ districtId: String(q.districtId) });
  if (q.status) and.push({ status: String(q.status) });
  const rows = await prisma.hostelBooking.findMany({
    where: { AND: and },
    select: {
      id: true, status: true, stayStatus: true, organization: true, referredBy: true, numGuests: true, numRooms: true, submittedAt: true,
      requestedCheckIn: true, requestedCheckOut: true, approvedCheckIn: true, approvedCheckOut: true,
      hostel: { select: { id: true, name: true } }, district: { select: { name: true } }, stay: true,
    },
  });
  const group = (key: (r: any) => string, val: (r: any) => number = () => 1) => {
    const m: Record<string, number> = {};
    for (const r of rows) { const k = key(r) || '—'; m[k] = (m[k] ?? 0) + val(r); }
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };
  const stays = rows.filter((r) => r.stay);

  // occupancy rate per hostel over the reporting window: occupied room-nights / in-service room-nights
  const from = q.from ? new Date(`${q.from}T00:00:00Z`) : new Date(Date.now() - 30 * 86_400_000);
  const to = q.to ? new Date(`${q.to}T00:00:00Z`) : todayUtc();
  const windowNights = Math.max(1, nights(from, to) + 1);
  const hostels = await prisma.hostel.findMany({ where: q.hostelId ? { id: String(q.hostelId) } : {}, include: { rooms: { where: { status: 'AVAILABLE' } } } });
  const occStays = await prisma.stayRecord.findMany({ where: { checkInAt: { lt: new Date(to.getTime() + 86_400_000) }, OR: [{ checkOutAt: null }, { checkOutAt: { gte: from } }], booking: { AND: [bookingScope(user)] } }, include: { booking: { select: { hostelId: true } } } });
  const occupancy = hostels.map((h) => {
    const capacity = h.rooms.length * windowNights;
    let used = 0;
    for (const s of occStays.filter((x) => x.booking.hostelId === h.id)) {
      const a = new Date(Math.max(s.checkInAt.getTime(), from.getTime()));
      const b = new Date(Math.min((s.checkOutAt ?? new Date()).getTime(), to.getTime() + 86_400_000));
      used += Math.max(0, Math.ceil((b.getTime() - a.getTime()) / 86_400_000)) * (s.finalRooms ?? s.actualRooms);
    }
    return { name: h.name, roomNights: capacity, occupiedRoomNights: used, rate: capacity ? Math.round((used / capacity) * 1000) / 10 : 0 };
  });

  const changedDates = rows.filter((r) => r.approvedCheckIn && (r.approvedCheckIn.getTime() !== r.requestedCheckIn.getTime() || r.approvedCheckOut!.getTime() !== r.requestedCheckOut.getTime()));
  const monthly: Record<string, number> = {};
  for (const r of rows) if (r.submittedAt) { const k = r.submittedAt.toISOString().slice(0, 7); monthly[k] = (monthly[k] ?? 0) + 1; }

  return {
    period: { from: q.from ?? null, to: q.to ?? null },
    byDistrict: group((r) => r.district.name),
    byHostel: group((r) => r.hostel.name),
    statusSummary: group((r) => humanize(r.status)),
    stayStatusSummary: group((r) => humanize(r.stayStatus)),
    monthly: Object.entries(monthly).sort().map(([month, value]) => ({ month, value })),
    guestsByHostel: (() => { const m: Record<string, number> = {}; for (const r of stays) m[r.hostel.name] = (m[r.hostel.name] ?? 0) + (r.stay!.finalGuests ?? r.stay!.actualGuests); return Object.entries(m).map(([name, value]) => ({ name, value })); })(),
    roomsByHostel: (() => { const m: Record<string, number> = {}; for (const r of stays) m[r.hostel.name] = (m[r.hostel.name] ?? 0) + (r.stay!.finalRooms ?? r.stay!.actualRooms); return Object.entries(m).map(([name, value]) => ({ name, value })); })(),
    occupancy,
    requestedVsApproved: { approvedTotal: rows.filter((r) => r.approvedCheckIn).length, changed: changedDates.length, requestedNights: rows.filter((r) => r.approvedCheckIn).reduce((a, r) => a + nights(r.requestedCheckIn, r.requestedCheckOut), 0), approvedNights: rows.filter((r) => r.approvedCheckIn).reduce((a, r) => a + nights(r.approvedCheckIn!, r.approvedCheckOut!), 0) },
    approvedVsDeclined: [{ name: 'Approved', value: rows.filter((r) => r.status === 'APPROVED').length }, { name: 'Declined', value: rows.filter((r) => r.status === 'DECLINED').length }],
    byOrganization: group((r) => r.organization).slice(0, 25),
    byReferral: group((r) => r.referredBy ?? 'Not referred').slice(0, 25),
    checkInOut: {
      checkIns: stays.length,
      checkOuts: stays.filter((r) => r.stay!.checkOutAt).length,
      inHouse: rows.filter((r) => r.stayStatus === 'CHECKED_IN').length,
      noShows: rows.filter((r) => r.stayStatus === 'NO_SHOW').length,
      earlyDepartures: stays.filter((r) => r.stay!.earlyDeparture).length,
      extensions: stays.filter((r) => r.stay!.extendedTo).length,
      cancelled: rows.filter((r) => r.status === 'CANCELLED').length,
    },
  };
}

hostelDashboardRouter.get('/reports', requirePerm('hostel.dashboard'), async (req, res) => {
  res.json(await hostelReportData(req.user!, req.query));
});

hostelDashboardRouter.get('/reports/export', requirePerm('hostel.export'), async (req, res) => {
  const d = await hostelReportData(req.user!, req.query);
  const two = (title: string, rows: any[], label = 'Bookings') => ({ type: 'table' as const, title, columns: [{ key: 'name', label: 'Name', width: 3 }, { key: 'value', label, align: 'right' as const }], rows });
  await audit(prisma, req, { action: 'EXPORT', module: 'HOSTEL', entityType: 'Reports', after: { format: req.query.format, filters: req.query } });
  await sendExport(res, String(req.query.format ?? 'pdf'), {
    title: 'Youth Hostel Analytics',
    filename: `hostel-analytics-${new Date().toISOString().slice(0, 10)}`,
    meta: [['Reporting period (request date)', `${d.period.from || 'Beginning'} to ${d.period.to || 'Today'}`]],
    sections: [
      two('Bookings by district', d.byDistrict), two('Bookings by hostel', d.byHostel), two('Booking status summary', d.statusSummary), two('Accommodation status summary', d.stayStatusSummary),
      { type: 'table', title: 'Monthly booking trend', columns: [{ key: 'month', label: 'Month', width: 3 }, { key: 'value', label: 'Bookings', align: 'right' }], rows: d.monthly },
      two('Guests accommodated by hostel', d.guestsByHostel, 'Guests'), two('Rooms utilized by hostel', d.roomsByHostel, 'Rooms'),
      { type: 'table', title: 'Hostel occupancy rate', columns: [{ key: 'name', label: 'Hostel', width: 2 }, { key: 'roomNights', label: 'Room-nights in service', align: 'right' }, { key: 'occupiedRoomNights', label: 'Occupied room-nights', align: 'right' }, { key: 'rate', label: 'Occupancy %', align: 'right' }], rows: d.occupancy },
      { type: 'kv', title: 'Requested versus approved dates', items: [['Approved bookings', d.requestedVsApproved.approvedTotal], ['Approved with different dates', d.requestedVsApproved.changed], ['Requested nights', d.requestedVsApproved.requestedNights], ['Approved nights', d.requestedVsApproved.approvedNights]] },
      two('Approved versus declined', d.approvedVsDeclined), two('Organization-wise bookings', d.byOrganization), two('Referral-wise bookings', d.byReferral),
      { type: 'kv', title: 'Check-in and check-out summary', items: Object.entries(d.checkInOut).map(([k, v]) => [humanize(k.replace(/([A-Z])/g, '_$1')), v]) },
    ],
  }, req.user!.name);
});
