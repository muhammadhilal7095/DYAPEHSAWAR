import { prisma, type Db, type Tx } from '../../db.js';
import { can, type AuthUser } from '../../lib/auth.js';
import { registerFileTarget } from '../../lib/fileTargets.js';
import { conflict, badRequest } from '../../lib/http.js';
import { decrypt } from '../../lib/crypto.js';
import { fmtDate } from '../../lib/export.js';
import { notify } from '../../lib/notify.js';
import { audit } from '../../lib/audit.js';
import { registerAdapter } from '../../workflow/engine.js';

export const PENDING_STATUSES = ['PENDING_REVIEW', 'UNDER_REVIEW', 'PENDING_FINAL'];
export const BOOKING_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'UNDER_REVIEW', 'PENDING_FINAL', 'RETURNED', 'APPROVED', 'DECLINED', 'CANCELLED'];
export const STAY_STATUSES = ['NONE', 'AWAITING_ARRIVAL', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED'];
const DAY = 86_400_000;

export const nights = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / DAY));
export const todayUtc = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

export function bookingScope(user: AuthUser): any {
  if (can(user, 'hostel.booking.view_all')) return {};
  const or: any[] = [
    { requesterId: user.id },
    { workflow: { assignments: { some: { assigneeId: user.id } } } },
    { workflow: { history: { some: { actorId: user.id } } } },
  ];
  if (can(user, 'hostel.booking.view_district') && user.districtId) or.push({ districtId: user.districtId, status: { not: 'DRAFT' } });
  if (can(user, 'hostel.operations')) or.push({ hostel: { managerId: user.id }, status: { not: 'DRAFT' } });
  return { OR: or };
}

export async function canViewBooking(user: AuthUser, id: string) {
  return (await prisma.hostelBooking.count({ where: { AND: [{ id }, bookingScope(user)] } })) > 0;
}

export function canSeeIdentity(user: AuthUser, b: { requesterId: string }) {
  return can(user, 'hostel.view_identity') || b.requesterId === user.id;
}

export function identityOf(user: AuthUser, b: { requesterId: string; cnicEnc: string; cnicMasked: string }) {
  return canSeeIdentity(user, b) ? decrypt(b.cnicEnc) : b.cnicMasked;
}

/** Can the user record check-in / check-out for bookings of this hostel? */
export function canOperate(user: AuthUser, hostel: { managerId: string | null }) {
  return can(user, 'hostel.operations') && (hostel.managerId === user.id || can(user, 'hostel.booking.view_all'));
}

// ───────────── Availability ─────────────

export interface Availability {
  totalRooms: number;
  totalCapacity: number;
  outOfService: number;
  reservedRooms: number;
  availableRooms: number;
  availableCapacity: number;
  byType: Record<string, { rooms: number; capacity: number }>;
  pendingRooms: number;
  pendingGuests: number;
  freeRooms: { id: string; roomNumber: string; roomType: string; capacity: number }[];
}

/** Rooms free for the whole stay [from, to) — to is the check-out date (exclusive). */
export async function availability(db: Db, hostelId: string, from: Date, to: Date, opts: { roomType?: string | null; excludeBookingId?: string } = {}): Promise<Availability> {
  const rooms = await db.room.findMany({ where: { hostelId, ...(opts.roomType ? { roomType: opts.roomType } : {}) }, orderBy: { roomNumber: 'asc' } });
  const busy = await db.roomReservation.findMany({
    where: {
      roomId: { in: rooms.map((r) => r.id) },
      status: 'ACTIVE',
      startDate: { lt: to },
      endDate: { gt: from },
      ...(opts.excludeBookingId ? { bookingId: { not: opts.excludeBookingId } } : {}),
    },
    select: { roomId: true },
  });
  const busyIds = new Set(busy.map((b) => b.roomId));
  const inService = rooms.filter((r) => r.status === 'AVAILABLE');
  const free = inService.filter((r) => !busyIds.has(r.id));
  const byType: Availability['byType'] = {};
  for (const r of free) {
    byType[r.roomType] ??= { rooms: 0, capacity: 0 };
    byType[r.roomType].rooms++;
    byType[r.roomType].capacity += r.capacity;
  }
  const pending = await db.hostelBooking.findMany({
    where: {
      hostelId,
      status: { in: PENDING_STATUSES },
      requestedCheckIn: { lt: to },
      requestedCheckOut: { gt: from },
      ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
    },
    select: { numRooms: true, numGuests: true },
  });
  return {
    totalRooms: rooms.length,
    totalCapacity: rooms.reduce((a, r) => a + r.capacity, 0),
    outOfService: rooms.length - inService.length,
    reservedRooms: inService.filter((r) => busyIds.has(r.id)).length,
    availableRooms: free.length,
    availableCapacity: free.reduce((a, r) => a + r.capacity, 0),
    byType,
    pendingRooms: pending.reduce((a, p) => a + p.numRooms, 0),
    pendingGuests: pending.reduce((a, p) => a + p.numGuests, 0),
    freeRooms: free.map((r) => ({ id: r.id, roomNumber: r.roomNumber, roomType: r.roomType, capacity: r.capacity })),
  };
}

/** Picks `numRooms` free rooms whose combined capacity fits `guests`, preferring the least wasted capacity. */
export function pickRooms(free: Availability['freeRooms'], numRooms: number, guests: number) {
  if (free.length < numRooms) return null;
  const sorted = [...free].sort((a, b) => b.capacity - a.capacity);
  const chosen = sorted.slice(0, numRooms);
  if (chosen.reduce((a, r) => a + r.capacity, 0) < guests) return null;
  // try swapping each chosen room for a smaller unused one while capacity still suffices
  const unused = sorted.slice(numRooms).sort((a, b) => a.capacity - b.capacity);
  for (let i = 0; i < chosen.length; i++) {
    const cap = chosen.reduce((a, r) => a + r.capacity, 0);
    const j = unused.findIndex((u) => u.capacity < chosen[i].capacity && cap - chosen[i].capacity + u.capacity >= guests);
    if (j >= 0) {
      const [u] = unused.splice(j, 1);
      unused.push(chosen[i]);
      chosen[i] = u;
    }
  }
  return chosen;
}

export async function allocateRooms(tx: Tx, booking: { id: string; hostelId: string; roomType: string | null; numRooms: number; numGuests: number }, from: Date, to: Date) {
  const av = await availability(tx, booking.hostelId, from, to, { roomType: booking.roomType, excludeBookingId: booking.id });
  const rooms = pickRooms(av.freeRooms, booking.numRooms, booking.numGuests);
  if (!rooms) {
    throw conflict(
      `Insufficient availability for ${fmtDate(from)} – ${fmtDate(to)}: ${booking.numRooms} room(s) for ${booking.numGuests} guest(s) requested, ` +
        `${av.availableRooms} room(s) with ${av.availableCapacity} bed(s) free${booking.roomType ? ` of the requested room type` : ''}.`,
    );
  }
  await tx.roomReservation.updateMany({ where: { bookingId: booking.id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
  await tx.roomReservation.createMany({ data: rooms.map((r) => ({ bookingId: booking.id, roomId: r.id, startDate: from, endDate: to })) });
  return rooms;
}

// ───────────── Workflow adapter ─────────────

async function bookingFor(tx: Tx, instanceId: string) {
  return tx.hostelBooking.findUniqueOrThrow({ where: { workflowInstanceId: instanceId }, include: { hostel: { include: { manager: true } }, requester: true, district: true } });
}

registerAdapter({
  module: 'HOSTEL_BOOKING',
  async summary(tx, inst) {
    const b = await bookingFor(tx, inst.id);
    const ci = b.approvedCheckIn ?? b.requestedCheckIn;
    const co = b.approvedCheckOut ?? b.requestedCheckOut;
    return {
      entityId: b.id,
      ref: b.bookingId,
      subject: `${b.hostel.name} — ${b.guestName} (${b.organization})`,
      link: `/hostels/bookings/${b.id}`,
      requester: { id: b.requester.id, email: b.requester.email, name: b.requester.name },
      details: [
        ['Hostel', b.hostel.name],
        [b.approvedCheckIn ? 'Approved dates' : 'Requested dates', `${fmtDate(ci)} – ${fmtDate(co)} (${nights(ci, co)} night(s))`],
        ['Guests / rooms', `${b.numGuests} guest(s), ${b.numRooms} room(s)`],
      ],
    };
  },
  async setPhase(tx, inst, phase) {
    const data: any = {};
    if (phase.kind === 'ASSIGNED') data.status = phase.isFirst ? 'PENDING_REVIEW' : phase.isFinal ? 'PENDING_FINAL' : 'UNDER_REVIEW';
    else if (phase.kind === 'RETURNED') data.status = 'RETURNED';
    else if (phase.kind === 'REJECTED') { data.status = 'DECLINED'; data.declinedAt = new Date(); }
    else if (phase.kind === 'APPROVED') { data.status = 'APPROVED'; data.stayStatus = 'AWAITING_ARRIVAL'; }
    else if (phase.kind === 'CANCELLED') {
      data.status = 'CANCELLED'; data.stayStatus = 'CANCELLED'; data.cancelledAt = new Date();
      const b = await tx.hostelBooking.findUniqueOrThrow({ where: { workflowInstanceId: inst.id } });
      await tx.roomReservation.updateMany({ where: { bookingId: b.id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
    }
    await tx.hostelBooking.update({ where: { workflowInstanceId: inst.id }, data });
  },
  async beforeDecision(tx, ctx) {
    const b = await bookingFor(tx, ctx.instance.id);
    const data: any = {};
    if (ctx.isFinal || ctx.action !== 'APPROVE') data.hqRemarks = ctx.remarks ?? b.hqRemarks;
    if (ctx.action === 'APPROVE') {
      const inStr = ctx.extra?.approvedCheckIn as string | undefined;
      const outStr = ctx.extra?.approvedCheckOut as string | undefined;
      if (inStr || outStr) {
        if (!ctx.level.canAmendDates && !ctx.isFinal) throw badRequest('Approved dates can only be set at levels permitted to amend dates.');
        const ci = new Date(`${inStr ?? (b.approvedCheckIn ?? b.requestedCheckIn).toISOString().slice(0, 10)}T00:00:00.000Z`);
        const co = new Date(`${outStr ?? (b.approvedCheckOut ?? b.requestedCheckOut).toISOString().slice(0, 10)}T00:00:00.000Z`);
        if (isNaN(ci.getTime()) || isNaN(co.getTime())) throw badRequest('Invalid approved dates.');
        if (co <= ci) throw badRequest('Approved check-out must be after approved check-in.', { fields: { approvedCheckOut: 'Must be after check-in' } });
        const prevIn = b.approvedCheckIn ?? b.requestedCheckIn;
        const prevOut = b.approvedCheckOut ?? b.requestedCheckOut;
        const changed = ci.getTime() !== prevIn.getTime() || co.getTime() !== prevOut.getTime();
        if (changed && !ctx.remarks) throw badRequest('Remarks are required when approving different dates.', { fields: { remarks: 'Explain the date change' } });
        data.approvedCheckIn = ci;
        data.approvedCheckOut = co;
        if (changed) {
          await audit(tx, null, {
            action: 'APPROVED_DATES_CHANGED', module: 'HOSTEL', entityType: 'HostelBooking', entityId: b.id, entityRef: b.bookingId,
            before: { checkIn: prevIn, checkOut: prevOut }, after: { checkIn: ci, checkOut: co, remarks: ctx.remarks },
          }, { id: ctx.actor.id, name: ctx.actor.name });
          await notify(tx, {
            recipients: [{ id: b.requester.id, email: b.requester.email, name: b.requester.name }],
            event: 'APPROVED_DATES_CHANGED', module: 'HOSTEL_BOOKING', entityRef: b.bookingId, instanceId: ctx.instance.id,
            title: 'Approved accommodation dates differ from your request',
            details: [['Hostel', b.hostel.name], ['Requested', `${fmtDate(b.requestedCheckIn)} – ${fmtDate(b.requestedCheckOut)}`], ['Approved', `${fmtDate(ci)} – ${fmtDate(co)}`], ['Changed by', ctx.actor.name]],
            remarks: ctx.remarks, link: `/hostels/bookings/${b.id}`,
          });
        }
      }
      if (ctx.isFinal) {
        if (b.hostel.status !== 'OPERATIONAL') throw conflict(`${b.hostel.name} is not operational. The booking cannot be approved.`);
        data.approvedCheckIn = data.approvedCheckIn ?? b.approvedCheckIn ?? b.requestedCheckIn;
        data.approvedCheckOut = data.approvedCheckOut ?? b.approvedCheckOut ?? b.requestedCheckOut;
      }
    }
    if (Object.keys(data).length) await tx.hostelBooking.update({ where: { id: b.id }, data });
  },
  async onFinalApproved(tx, ctx) {
    const b = await bookingFor(tx, ctx.instance.id);
    const rooms = await allocateRooms(tx, b, b.approvedCheckIn!, b.approvedCheckOut!);
    await tx.hostelBooking.update({ where: { id: b.id }, data: { approvedById: ctx.actor.id, approvedAt: new Date() } });
    await audit(tx, null, {
      action: 'ROOMS_ALLOCATED', module: 'HOSTEL', entityType: 'HostelBooking', entityId: b.id, entityRef: b.bookingId,
      after: { rooms: rooms.map((r) => r.roomNumber), from: b.approvedCheckIn, to: b.approvedCheckOut },
    }, { id: ctx.actor.id, name: ctx.actor.name });
    if (b.hostel.manager) {
      await notify(tx, {
        recipients: [{ id: b.hostel.manager.id, email: b.hostel.manager.email, name: b.hostel.manager.name }],
        event: 'BOOKING_APPROVED_MANAGER', module: 'HOSTEL_BOOKING', entityRef: b.bookingId, instanceId: ctx.instance.id,
        title: `Approved booking for ${b.hostel.name}`,
        details: [['Guest', b.guestName], ['Organization', b.organization], ['Dates', `${fmtDate(b.approvedCheckIn)} – ${fmtDate(b.approvedCheckOut)}`], ['Guests / rooms', `${b.numGuests} / ${b.numRooms}`], ['Rooms reserved', rooms.map((r) => r.roomNumber).join(', ')]],
        link: `/hostels/bookings/${b.id}`,
      });
    }
  },
  async decisionDetails(tx, ctx) {
    const b = await tx.hostelBooking.findUniqueOrThrow({ where: { workflowInstanceId: ctx.instance.id }, include: { reservations: { where: { status: 'ACTIVE' }, include: { room: true } } } });
    const out: [string, string][] = [];
    if (b.approvedCheckIn) out.push(['Approved dates', `${fmtDate(b.approvedCheckIn)} – ${fmtDate(b.approvedCheckOut)}`]);
    if (b.reservations.length) out.push(['Rooms', b.reservations.map((r) => r.room.roomNumber).join(', ')]);
    return out;
  },
});

// ───────────── File target ─────────────
registerFileTarget({
  key: 'hostel-booking',
  fk: 'bookingId',
  module: 'HOSTEL',
  entityType: 'HostelBooking',
  categories: { SUPPORTING: 'pdfimage', ACCOMMODATION_RECORD: 'pdfimage' },
  canView: canViewBooking,
  async canUpload(user, id, category) {
    const b = await prisma.hostelBooking.findUnique({ where: { id }, include: { hostel: true } });
    if (!b) return null;
    if (category === 'ACCOMMODATION_RECORD') return canOperate(user, b.hostel) && b.status === 'APPROVED' ? { ref: b.bookingId } : null;
    if ((b.requesterId === user.id && ['DRAFT', 'RETURNED'].includes(b.status)) || can(user, 'workflow.override')) return { ref: b.bookingId };
    return null;
  },
  async canDelete(user, id, file) {
    const b = await prisma.hostelBooking.findUnique({ where: { id } });
    if (!b) return false;
    if (can(user, 'workflow.override')) return true;
    return file.uploadedById === user.id && ['DRAFT', 'RETURNED'].includes(b.status);
  },
});
