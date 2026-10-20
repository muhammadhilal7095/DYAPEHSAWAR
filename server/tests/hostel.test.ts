import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, PDF, PNG, iso, idOf, districtId, startSmtp, settleEmails, prisma, type Client } from './helpers.js';

let smtp: Awaited<ReturnType<typeof startSmtp>>;
let requester: Client, hq: Client, approver: Client, mgrBatakundi: Client, mgrChapra: Client, requesterSwat: Client, admin: Client;
let mardan: string, batakundi: string, khanaspur: string;

beforeAll(async () => {
  smtp = await startSmtp();
  [requester, hq, approver, mgrBatakundi, mgrChapra, requesterSwat, admin] = await Promise.all([
    login('requester.mardan@dya.gov.pk'), login('hq.officer@dya.gov.pk'), login('hostel.approver@dya.gov.pk'), login('manager.batakundi@dya.gov.pk'),
    login('manager.chapra@dya.gov.pk'), login('requester.swat@dya.gov.pk'), login('admin@dya.gov.pk'),
  ]);
  mardan = await districtId('Mardan');
  batakundi = (await prisma.hostel.findUniqueOrThrow({ where: { name: 'Batakundi Youth Hostel' } })).id;
  khanaspur = (await prisma.hostel.findUniqueOrThrow({ where: { name: 'Khanaspur Youth Hostel' } })).id;
});
afterAll(async () => smtp.close());

const booking = (over: any = {}) => ({
  hostelId: batakundi,
  districtId: mardan,
  guestName: 'Muhammad Usman',
  cnic: '17301-1234567-1',
  mobile: '0300-1234567',
  organization: 'Government College Mardan',
  referredBy: 'Imran Yousafzai',
  referrerDesignation: 'District Youth Officer',
  purpose: 'Youth exchange study tour',
  numGuests: 6,
  numRooms: 3,
  requestedCheckIn: iso(0),
  requestedCheckOut: iso(3),
  ...over,
});

describe('Youth hostel booking lifecycle', () => {
  let id: string;
  let bookingId: string;

  it('validates guest and hostel information', async () => {
    const r = await requester.post('/api/hostel/bookings', { ...booking({ requestedCheckOut: iso(0), mobile: '12345', cnic: 'x' }), submit: true });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.details.fields)).toEqual(expect.arrayContaining(['requestedCheckOut', 'mobile', 'cnic']));
    const past = await requester.post('/api/hostel/bookings', { ...booking({ requestedCheckIn: iso(-3), requestedCheckOut: iso(-1) }), submit: true });
    expect(past.status).toBe(400);
  });

  it('submits a booking and receives a unique Booking ID; reviewer is assigned', async () => {
    const r = await requester.post('/api/hostel/bookings', { ...booking(), submit: true });
    expect(r.status).toBe(201);
    expect(r.body.booking.bookingId).toMatch(/^YHB-\d{4}-\d{5}$/);
    expect(r.body.booking.status).toBe('PENDING_REVIEW');
    expect(r.body.booking.cnicEnc).toBeUndefined();
    id = r.body.booking.id;
    bookingId = r.body.booking.bookingId;
    const stored = await prisma.hostelBooking.findUniqueOrThrow({ where: { id } });
    expect(stored.cnicEnc).not.toContain('1234567'); // encrypted at rest
    const up = await requester.upload(`/api/files/hostel-booking/${id}`, { category: 'SUPPORTING' }, [{ name: 'letter.pdf', buf: PDF }]);
    expect(up.status).toBe(403); // submitted bookings are locked for the requester
  });

  it('protects guest identity: masked for unauthorised viewers, unrelated users blocked', async () => {
    const asHq = await hq.get(`/api/hostel/bookings/${id}`);
    expect(asHq.body.booking.cnic).toBe('17301-1234567-1');
    expect((await requesterSwat.get(`/api/hostel/bookings/${id}`)).status).toBe(403);
    expect((await mgrChapra.get(`/api/hostel/bookings/${id}`)).status).toBe(403);
    const list = await hq.get('/api/hostel/bookings?q=' + bookingId);
    expect(list.body.rows[0].cnic).toBe('17301-1234567-1');
    const audit = await prisma.auditLog.count({ where: { action: 'GUEST_IDENTITY_VIEWED', entityRef: bookingId } });
    expect(audit).toBeGreaterThan(0);
  });

  it('first reviewer approves different dates (remarks required) and forwards to final approval', async () => {
    const noRemarks = await hq.post(`/api/hostel/bookings/${id}/decision`, { action: 'APPROVE', extra: { approvedCheckIn: iso(0), approvedCheckOut: iso(2) } });
    expect(noRemarks.status).toBe(400);
    const r = await hq.post(`/api/hostel/bookings/${id}/decision`, { action: 'APPROVE', remarks: 'Two nights available only.', extra: { approvedCheckIn: iso(0), approvedCheckOut: iso(2) } });
    expect(r.status).toBe(200);
    const d = await requester.get(`/api/hostel/bookings/${id}`);
    expect(d.body.booking.status).toBe('PENDING_FINAL');
    expect(d.body.booking.requestedCheckOut.slice(0, 10)).toBe(iso(3));
    expect(d.body.booking.approvedCheckOut.slice(0, 10)).toBe(iso(2));
    expect(d.body.timeline.instance.currentAssignee.id).toBe(await idOf('hostel.approver@dya.gov.pk'));
    await settleEmails();
    expect(await prisma.emailLog.count({ where: { entityRef: bookingId, event: 'APPROVED_DATES_CHANGED', status: 'SENT' } })).toBe(1);
  });

  it('final approval reserves rooms and notifies requester and hostel manager', async () => {
    const r = await approver.post(`/api/hostel/bookings/${id}/decision`, { action: 'APPROVE', remarks: 'Approved.' });
    expect(r.status).toBe(200);
    const d = await requester.get(`/api/hostel/bookings/${id}`);
    expect(d.body.booking.status).toBe('APPROVED');
    expect(d.body.booking.stayStatus).toBe('AWAITING_ARRIVAL');
    expect(d.body.booking.approvedBy.id).toBe(await idOf('hostel.approver@dya.gov.pk'));
    expect(d.body.booking.hqRemarks).toBe('Approved.');
    const res = d.body.booking.reservations.filter((x: any) => x.status === 'ACTIVE');
    expect(res).toHaveLength(3);
    expect(res.reduce((a: number, x: any) => a + x.room.capacity, 0)).toBeGreaterThanOrEqual(6);
    await settleEmails();
    const toMgr = await prisma.emailLog.findFirst({ where: { entityRef: bookingId, toEmail: 'manager.batakundi@dya.gov.pk' } });
    expect(toMgr?.status).toBe('SENT');
  });

  it('prevents overbooking: conflicting confirmed bookings cannot take the same capacity', async () => {
    // Batakundi: 4 double + 2 shared(4) + 1 dorm(12) = 7 rooms. 3 are now reserved → 4 remain.
    const big = await requester.post('/api/hostel/bookings', { ...booking({ guestName: 'Group A', numRooms: 4, numGuests: 10 }), submit: true });
    const big2 = await requester.post('/api/hostel/bookings', { ...booking({ guestName: 'Group B', numRooms: 2, numGuests: 2, requestedCheckIn: iso(1), requestedCheckOut: iso(2) }), submit: true });
    expect(big.body.warnings).toEqual([]);
    for (const b of [big, big2]) expect((await hq.post(`/api/hostel/bookings/${b.body.booking.id}/decision`, { action: 'APPROVE' })).status).toBe(200);
    expect((await approver.post(`/api/hostel/bookings/${big.body.booking.id}/decision`, { action: 'APPROVE' })).status).toBe(200);
    const clash = await approver.post(`/api/hostel/bookings/${big2.body.booking.id}/decision`, { action: 'APPROVE' });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/Insufficient availability/);
    const still = await approver.get(`/api/hostel/bookings/${big2.body.booking.id}`);
    expect(still.body.booking.status).toBe('PENDING_FINAL'); // rolled back atomically
    const av = await requester.get(`/api/hostel/hostels/${batakundi}/availability?from=${iso(1)}&to=${iso(2)}`);
    expect(av.body.availableRooms).toBe(0);
    expect(av.body.pendingRooms).toBe(2);
    // declined → stops
    expect((await approver.post(`/api/hostel/bookings/${big2.body.booking.id}/decision`, { action: 'REJECT', remarks: 'Fully booked.' })).status).toBe(200);
    expect((await requester.get(`/api/hostel/bookings/${big2.body.booking.id}`)).body.booking.status).toBe('DECLINED');
  });

  it('hostel manager records check-in and check-out; other managers cannot', async () => {
    expect((await mgrChapra.post(`/api/hostel/bookings/${id}/check-in`, { arrivalAt: new Date().toISOString(), actualGuests: 6, actualRooms: 3, idVerified: true })).status).toBe(403);
    const noId = await mgrBatakundi.post(`/api/hostel/bookings/${id}/check-in`, { arrivalAt: new Date().toISOString(), actualGuests: 6, actualRooms: 3, idVerified: false });
    expect(noId.status).toBe(422);
    const tooMany = await mgrBatakundi.post(`/api/hostel/bookings/${id}/check-in`, { arrivalAt: new Date().toISOString(), actualGuests: 6, actualRooms: 5, idVerified: true });
    expect(tooMany.status).toBe(400);
    expect((await mgrBatakundi.post(`/api/hostel/bookings/${id}/check-in`, { arrivalAt: new Date().toISOString(), actualGuests: 5, actualRooms: 3, idVerified: true, remarks: 'One guest did not travel.' })).status).toBe(200);
    expect((await requester.get(`/api/hostel/bookings/${id}`)).body.booking.stayStatus).toBe('CHECKED_IN');
    const board = await mgrBatakundi.get('/api/hostel/bookings/operations/board');
    expect(board.body.inHouse.some((b: any) => b.id === id)).toBe(true);
    const rec = await mgrBatakundi.upload(`/api/files/hostel-booking/${id}`, { category: 'ACCOMMODATION_RECORD' }, [{ name: 'register.png', buf: PNG }]);
    expect(rec.status).toBe(201);
    const out = await mgrBatakundi.post(`/api/hostel/bookings/${id}/check-out`, { departureAt: new Date(Date.now() + 3600_000).toISOString(), finalGuests: 5, finalRooms: 3 });
    expect(out.status).toBe(200);
    const d = await requester.get(`/api/hostel/bookings/${id}`);
    expect(d.body.booking.stayStatus).toBe('COMPLETED');
    expect(d.body.booking.stay.earlyDeparture).toBe(true);
    expect(d.body.booking.reservations.every((r: any) => r.status === 'RELEASED')).toBe(true);
  });

  it('dashboard summary and utilization table use real data with filters', async () => {
    const all = await admin.get(`/api/hostel/dashboard?from=${iso(-1)}&to=${iso(1)}`);
    expect(all.status).toBe(200);
    expect(all.body.summary.totalRequests).toBe(3);
    expect(all.body.summary.approved).toBe(2);
    expect(all.body.summary.declined).toBe(1);
    expect(all.body.summary.completed).toBe(1);
    expect(all.body.summary.guestsFacilitated).toBe(5);
    expect(all.body.summary.roomsBooked).toBe(7);
    const row = all.body.utilization.find((u: any) => u.hostel === 'Batakundi Youth Hostel');
    expect(row).toMatchObject({ completed: 1, guests: 5, rooms: 3 });
    expect(all.body.totals).toMatchObject({ completed: 1, guests: 5, rooms: 3 });
    const filtered = await admin.get(`/api/hostel/dashboard?from=${iso(-1)}&to=${iso(1)}&filter=hostel:${khanaspur}`);
    expect(filtered.body.summary.totalRequests).toBe(0);
    expect(filtered.body.utilization).toHaveLength(1);
    const old = await admin.get(`/api/hostel/dashboard?from=2020-01-01&to=2020-12-31`);
    expect(old.body.summary.totalRequests).toBe(0);
  });

  it('exports filtered PDF/Excel/CSV reports; register export requires permission', async () => {
    const pdf = await admin.get(`/api/hostel/dashboard/export?format=pdf&from=${iso(-1)}&to=${iso(1)}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray?.(0, 5).toString() ?? '').toBe('%PDF-');
    for (const fmt of ['xlsx', 'csv']) expect((await hq.get(`/api/hostel/bookings/export?format=${fmt}`)).status).toBe(200);
    expect((await requester.get(`/api/hostel/bookings/export?format=csv`)).status).toBe(403);
    const reports = await admin.get(`/api/hostel/dashboard/reports?from=${iso(-1)}&to=${iso(1)}`);
    expect(reports.body.checkInOut.checkOuts).toBe(1);
    expect(reports.body.requestedVsApproved.changed).toBe(1);
  });

  it('cancellation releases reserved capacity', async () => {
    const r = await requester.post('/api/hostel/bookings', { ...booking({ hostelId: khanaspur, numRooms: 1, numGuests: 2, requestedCheckIn: iso(20), requestedCheckOut: iso(22) }), submit: true });
    await hq.post(`/api/hostel/bookings/${r.body.booking.id}/decision`, { action: 'APPROVE' });
    await approver.post(`/api/hostel/bookings/${r.body.booking.id}/decision`, { action: 'APPROVE' });
    expect(await prisma.roomReservation.count({ where: { bookingId: r.body.booking.id, status: 'ACTIVE' } })).toBe(1);
    expect((await requester.post(`/api/hostel/bookings/${r.body.booking.id}/cancel`, { reason: 'Trip postponed.' })).status).toBe(200);
    expect(await prisma.roomReservation.count({ where: { bookingId: r.body.booking.id, status: 'ACTIVE' } })).toBe(0);
    expect((await requester.get(`/api/hostel/bookings/${r.body.booking.id}`)).body.booking.status).toBe('CANCELLED');
  });
});
