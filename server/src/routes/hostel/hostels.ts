import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { requireAuth, requirePerm } from '../../lib/auth.js';
import { audit, diff } from '../../lib/audit.js';
import { badRequest, conflict, notFound, parse, zDate, zOptStr, zStr } from '../../lib/http.js';
import { availability, nights } from './common.js';

export const hostelsRouter = Router();

// ───────────── Facility types ─────────────
hostelsRouter.get('/facility-types', requireAuth, async (req, res) => {
  res.json(await prisma.facilityType.findMany({ where: req.query.all === 'true' ? {} : { isActive: true }, orderBy: { name: 'asc' }, include: { _count: { select: { hostels: true } } } }));
});
const ftBody = z.object({ name: zStr(100), description: zOptStr(300), isActive: z.boolean().default(true) });
hostelsRouter.post('/facility-types', requirePerm('hostel.manage'), async (req, res) => {
  const b = parse(ftBody, req.body);
  const f = await prisma.facilityType.create({ data: b });
  await audit(prisma, req, { action: 'FACILITY_TYPE_CREATED', module: 'HOSTEL', entityType: 'FacilityType', entityId: f.id, entityRef: f.name, after: b });
  res.status(201).json(f);
});
hostelsRouter.put('/facility-types/:id', requirePerm('hostel.manage'), async (req, res) => {
  const b = parse(ftBody, req.body);
  const before = await prisma.facilityType.findUniqueOrThrow({ where: { id: String(req.params.id) } });
  const f = await prisma.facilityType.update({ where: { id: before.id }, data: b });
  const d = diff(before, b);
  await audit(prisma, req, { action: 'FACILITY_TYPE_UPDATED', module: 'HOSTEL', entityType: 'FacilityType', entityId: f.id, entityRef: f.name, before: d.before, after: d.after });
  res.json(f);
});

// ───────────── Hostels ─────────────
const hostelInclude = {
  district: { select: { id: true, name: true } },
  facilityType: { select: { id: true, name: true } },
  manager: { select: { id: true, name: true, email: true, phone: true } },
  rooms: { orderBy: { roomNumber: 'asc' as const } },
};

function summarise(h: any) {
  const rooms = h.rooms ?? [];
  const types: Record<string, number> = {};
  for (const r of rooms) types[r.roomType] = (types[r.roomType] ?? 0) + 1;
  return {
    ...h,
    totalRooms: rooms.length,
    totalCapacity: rooms.reduce((a: number, r: any) => a + r.capacity, 0),
    roomsInService: rooms.filter((r: any) => r.status === 'AVAILABLE').length,
    roomTypes: types,
  };
}

hostelsRouter.get('/hostels', requireAuth, async (req, res) => {
  const where: any = {};
  if (req.query.all !== 'true') where.status = { not: 'CLOSED' };
  if (req.query.districtId) where.districtId = String(req.query.districtId);
  if (req.query.facilityTypeId) where.facilityTypeId = String(req.query.facilityTypeId);
  if (req.query.managed === 'true') where.managerId = req.user!.id;
  const rows = await prisma.hostel.findMany({ where, include: hostelInclude, orderBy: { name: 'asc' } });
  res.json(rows.map(summarise));
});

hostelsRouter.get('/hostels/:id', requireAuth, async (req, res) => {
  const h = await prisma.hostel.findUnique({ where: { id: String(req.params.id) }, include: hostelInclude });
  if (!h) throw notFound();
  res.json(summarise(h));
});

const hostelBody = z.object({
  name: zStr(150),
  districtId: zStr(40),
  address: zStr(400),
  facilityTypeId: zOptStr(40),
  managerId: zOptStr(40),
  contactPhone: zOptStr(40),
  contactEmail: z.union([z.string().trim().email('Enter a valid email'), z.literal('')]).optional().nullable().transform((v) => v || null),
  status: z.enum(['OPERATIONAL', 'UNDER_MAINTENANCE', 'CLOSED']),
  description: zOptStr(2000),
});

hostelsRouter.post('/hostels', requirePerm('hostel.manage'), async (req, res) => {
  const b = parse(hostelBody, req.body);
  const h = await prisma.hostel.create({ data: b, include: hostelInclude });
  await audit(prisma, req, { action: 'HOSTEL_CREATED', module: 'HOSTEL', entityType: 'Hostel', entityId: h.id, entityRef: h.name, after: b });
  res.status(201).json(summarise(h));
});

hostelsRouter.put('/hostels/:id', requirePerm('hostel.manage'), async (req, res) => {
  const b = parse(hostelBody, req.body);
  const before = await prisma.hostel.findUnique({ where: { id: String(req.params.id) } });
  if (!before) throw notFound();
  const h = await prisma.hostel.update({ where: { id: before.id }, data: b, include: hostelInclude });
  const d = diff(before, b);
  if (d.changed) await audit(prisma, req, { action: 'HOSTEL_UPDATED', module: 'HOSTEL', entityType: 'Hostel', entityId: h.id, entityRef: h.name, before: d.before, after: d.after });
  res.json(summarise(h));
});

// ───────────── Rooms ─────────────
const roomBody = z.object({
  roomNumber: zStr(30),
  roomType: zStr(40),
  capacity: z.coerce.number().int().min(1, 'At least 1').max(100),
  status: z.enum(['AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE']),
  notes: zOptStr(500),
});

async function checkRoomType(t: string) {
  if (!(await prisma.lookupOption.count({ where: { group: 'ROOM_TYPE', value: t, isActive: true } }))) throw badRequest('Invalid room type.', { fields: { roomType: 'Invalid room type' } });
}

hostelsRouter.post('/hostels/:id/rooms', requirePerm('hostel.manage'), async (req, res) => {
  const hostel = await prisma.hostel.findUnique({ where: { id: String(req.params.id) } });
  if (!hostel) throw notFound();
  // single room, or bulk: { prefix, from, count, roomType, capacity, status }
  if (req.body?.bulk) {
    const b = parse(z.object({ prefix: z.string().trim().max(10).default(''), start: z.coerce.number().int().min(1), count: z.coerce.number().int().min(1).max(200), roomType: zStr(40), capacity: z.coerce.number().int().min(1).max(100), status: z.enum(['AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE']).default('AVAILABLE') }), req.body);
    await checkRoomType(b.roomType);
    const numbers = Array.from({ length: b.count }, (_, i) => `${b.prefix}${b.start + i}`);
    const existing = await prisma.room.findMany({ where: { hostelId: hostel.id, roomNumber: { in: numbers } } });
    if (existing.length) throw conflict(`Room number(s) already exist: ${existing.map((r) => r.roomNumber).join(', ')}`);
    await prisma.$transaction(async (tx) => {
      await tx.room.createMany({ data: numbers.map((n) => ({ hostelId: hostel.id, roomNumber: n, roomType: b.roomType, capacity: b.capacity, status: b.status })) });
      await audit(tx, req, { action: 'ROOMS_BULK_CREATED', module: 'HOSTEL', entityType: 'Hostel', entityId: hostel.id, entityRef: hostel.name, after: { ...b, rooms: numbers } });
    });
    return res.status(201).json({ created: numbers.length });
  }
  const b = parse(roomBody, req.body);
  await checkRoomType(b.roomType);
  const r = await prisma.room.create({ data: { ...b, hostelId: hostel.id } });
  await audit(prisma, req, { action: 'ROOM_CREATED', module: 'HOSTEL', entityType: 'Room', entityId: r.id, entityRef: `${hostel.name} / ${r.roomNumber}`, after: b });
  res.status(201).json(r);
});

hostelsRouter.put('/rooms/:roomId', requirePerm('hostel.manage'), async (req, res) => {
  const b = parse(roomBody, req.body);
  await checkRoomType(b.roomType);
  const before = await prisma.room.findUnique({ where: { id: String(req.params.roomId) }, include: { hostel: true } });
  if (!before) throw notFound();
  if (b.capacity < before.capacity || b.status !== 'AVAILABLE') {
    const future = await prisma.roomReservation.count({ where: { roomId: before.id, status: 'ACTIVE', endDate: { gt: new Date() } } });
    if (future && b.status !== 'AVAILABLE') {
      // allowed, but the response tells the admin that confirmed bookings are affected
      res.setHeader('X-Warning', `${future} confirmed reservation(s) use this room. Reassign them if the room is unavailable.`);
    }
  }
  const r = await prisma.room.update({ where: { id: before.id }, data: b });
  const d = diff(before, b);
  if (d.changed) await audit(prisma, req, { action: 'ROOM_UPDATED', module: 'HOSTEL', entityType: 'Room', entityId: r.id, entityRef: `${before.hostel.name} / ${r.roomNumber}`, before: d.before, after: d.after });
  res.json(r);
});

hostelsRouter.delete('/rooms/:roomId', requirePerm('hostel.manage'), async (req, res) => {
  const r = await prisma.room.findUnique({ where: { id: String(req.params.roomId) }, include: { hostel: true, _count: { select: { reservations: true } } } });
  if (!r) throw notFound();
  if (r._count.reservations) throw conflict('This room has reservation history and cannot be deleted. Mark it Unavailable instead.');
  await prisma.room.delete({ where: { id: r.id } });
  await audit(prisma, req, { action: 'ROOM_DELETED', module: 'HOSTEL', entityType: 'Room', entityId: r.id, entityRef: `${r.hostel.name} / ${r.roomNumber}`, before: r });
  res.json({ ok: true });
});

// ───────────── Availability ─────────────
hostelsRouter.get('/hostels/:id/availability', requireAuth, async (req, res) => {
  const q = parse(z.object({ from: zDate, to: zDate, roomType: zOptStr(40), excludeBookingId: zOptStr(40) }), req.query);
  if (q.to <= q.from) throw badRequest('Check-out must be after check-in.');
  const h = await prisma.hostel.findUnique({ where: { id: String(req.params.id) } });
  if (!h) throw notFound();
  const av = await availability(prisma, h.id, q.from, q.to, { roomType: q.roomType, excludeBookingId: q.excludeBookingId ?? undefined });
  res.json({ ...av, hostelStatus: h.status, nights: nights(q.from, q.to) });
});

/** Occupancy calendar: reservations per room within a window (for the hostel management page). */
hostelsRouter.get('/hostels/:id/occupancy', requirePerm('hostel.manage', 'hostel.operations', 'hostel.booking.view_all'), async (req, res) => {
  const q = parse(z.object({ from: zDate, to: zDate }), req.query);
  const rows = await prisma.roomReservation.findMany({
    where: { room: { hostelId: String(req.params.id) }, status: 'ACTIVE', startDate: { lt: q.to }, endDate: { gt: q.from } },
    include: { room: { select: { roomNumber: true } }, booking: { select: { id: true, bookingId: true, guestName: true, stayStatus: true, numGuests: true } } },
    orderBy: { startDate: 'asc' },
  });
  res.json(rows);
});
