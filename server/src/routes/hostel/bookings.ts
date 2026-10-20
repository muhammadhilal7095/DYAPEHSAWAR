import { Router } from 'express';
import { z } from 'zod';
import { prisma, icontains, type Tx } from '../../db.js';
import { requireAuth, requirePerm, can } from '../../lib/auth.js';
import { audit, diff } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound, pageParams, parse, zDate, zOptStr, zStr, dateRangeFilter } from '../../lib/http.js';
import { nextId, ID_PREFIX } from '../../lib/ids.js';
import { notify, transact } from '../../lib/notify.js';
import { encrypt, maskIdentity } from '../../lib/crypto.js';
import { fileSelect } from '../../lib/files.js';
import { getSettings } from '../../lib/settings.js';
import { sendExport, fmtDate, fmtDateTime, humanize } from '../../lib/export.js';
import { assignFirstLevel, buildTimeline, cancel, resubmit, startWorkflow } from '../../workflow/engine.js';
import { mountWorkflowRoutes, workflowFlags, latestEmailStatus } from '../workflowRoutes.js';
import { availability, bookingScope, canOperate, canSeeIdentity, canViewBooking, identityOf, nights, todayUtc, PENDING_STATUSES } from './common.js';

export const bookingsRouter = Router();

const mobileRe = /^(\+92|0092|0)3\d{9}$|^\+\d{8,15}$/;
const idRe = /^(\d{5}-?\d{7}-?\d|[A-Za-z0-9]{6,15})$/;
const zMobile = z.string().trim().transform((s) => s.replace(/[\s-]/g, '')).refine((s) => mobileRe.test(s), 'Enter a valid mobile number, e.g. 03001234567');
const zIdentity = z.string().trim().refine((s) => idRe.test(s), 'Enter a 13-digit CNIC (12345-1234567-1) or a passport number');

const bookingBody = z
  .object({
    hostelId: zStr(40),
    districtId: zStr(40),
    roomType: zOptStr(40),
    guestName: zStr(150),
    cnic: z.union([zIdentity, z.literal('')]).optional(),
    mobile: zMobile,
    organization: zStr(200),
    referredBy: zOptStr(150),
    referrerDesignation: zOptStr(150),
    purpose: zStr(2000),
    numGuests: z.coerce.number().int().min(1, 'At least 1 guest').max(500),
    numRooms: z.coerce.number().int().min(1, 'At least 1 room').max(200),
    requestedCheckIn: zDate,
    requestedCheckOut: zDate,
    requesterRemarks: zOptStr(2000),
    guests: z.array(z.object({ name: zStr(150), cnic: z.union([zIdentity, z.literal('')]).optional(), gender: zOptStr(20) })).max(200).default([]),
    submit: z.boolean().optional(),
  })
  .refine((b) => b.requestedCheckOut > b.requestedCheckIn, { path: ['requestedCheckOut'], message: 'Check-out must be later than check-in' });
type BookingBody = z.infer<typeof bookingBody>;

function snapshot(b: any) {
  return {
    hostelId: b.hostelId, districtId: b.districtId, roomType: b.roomType, guestName: b.guestName, cnicMasked: b.cnicMasked, mobile: b.mobile, organization: b.organization,
    referredBy: b.referredBy, referrerDesignation: b.referrerDesignation, purpose: b.purpose, numGuests: b.numGuests, numRooms: b.numRooms,
    requestedCheckIn: b.requestedCheckIn, requestedCheckOut: b.requestedCheckOut, requesterRemarks: b.requesterRemarks,
  };
}

async function validate(b: BookingBody, submitting: boolean) {
  const hostel = await prisma.hostel.findUnique({ where: { id: b.hostelId }, include: { rooms: true } });
  if (!hostel) throw badRequest('Select a valid youth hostel.', { fields: { hostelId: 'Invalid hostel' } });
  if (!(await prisma.district.count({ where: { id: b.districtId, isActive: true } }))) throw badRequest('Select a valid district.', { fields: { districtId: 'Invalid district' } });
  if (b.roomType && !(await prisma.lookupOption.count({ where: { group: 'ROOM_TYPE', value: b.roomType } }))) throw badRequest('Invalid room type.', { fields: { roomType: 'Invalid room type' } });
  const warnings: string[] = [];
  if (submitting) {
    if (hostel.status !== 'OPERATIONAL') throw badRequest(`${hostel.name} is currently not accepting bookings (${humanize(hostel.status)}).`, { fields: { hostelId: 'Not operational' } });
    if (b.requestedCheckIn < todayUtc()) throw badRequest('Check-in date cannot be in the past.', { fields: { requestedCheckIn: 'Date is in the past' } });
    const inService = hostel.rooms.filter((r) => r.status === 'AVAILABLE');
    if (b.numRooms > inService.length) throw badRequest(`${hostel.name} has only ${inService.length} room(s) in service.`, { fields: { numRooms: `Maximum ${inService.length}` } });
    const av = await availability(prisma, hostel.id, b.requestedCheckIn, b.requestedCheckOut, { roomType: b.roomType });
    if (av.availableRooms < b.numRooms || av.availableCapacity < b.numGuests) {
      warnings.push(`Currently ${av.availableRooms} room(s) / ${av.availableCapacity} bed(s) are free for these dates. The request may be approved with different dates or declined.`);
    }
    if (av.pendingRooms > 0) warnings.push(`${av.pendingRooms} room(s) are provisionally requested by other pending bookings for overlapping dates.`);
  }
  return { hostel, warnings };
}

async function submitBooking(tx: Tx, req: any, id: string) {
  const b = await tx.hostelBooking.findUniqueOrThrow({ where: { id } });
  if (!b.cnicEnc) throw badRequest('CNIC / passport is required.', { fields: { cnic: 'Required' } });
  if (b.status === 'DRAFT') {
    const inst = await startWorkflow(tx, { module: 'HOSTEL_BOOKING', entityType: 'HostelBooking', entityId: b.id, entityRef: b.bookingId, districtId: b.districtId, actor: req.user, snapshot: snapshot(b) });
    await tx.hostelBooking.update({ where: { id }, data: { workflowInstanceId: inst.id, submittedAt: new Date(), status: 'PENDING_REVIEW' } });
    await assignFirstLevel(tx, inst.id, req.user);
    await audit(tx, req, { action: 'BOOKING_SUBMITTED', module: 'HOSTEL', entityType: 'HostelBooking', entityId: id, entityRef: b.bookingId });
  } else if (b.status === 'RETURNED') {
    await tx.hostelBooking.update({ where: { id }, data: { version: b.version + 1, approvedCheckIn: null, approvedCheckOut: null } });
    await resubmit(tx, b.workflowInstanceId!, req.user, { entityType: 'HostelBooking', entityId: id, snapshot: snapshot(b) });
    await audit(tx, req, { action: 'BOOKING_RESUBMITTED', module: 'HOSTEL', entityType: 'HostelBooking', entityId: id, entityRef: b.bookingId });
  } else throw conflict('This booking has already been submitted.');
}

async function writeGuests(tx: Tx, bookingId: string, guests: BookingBody['guests']) {
  await tx.bookingGuest.deleteMany({ where: { bookingId } });
  if (guests.length) {
    await tx.bookingGuest.createMany({
      data: guests.map((g) => ({ bookingId, name: g.name, gender: g.gender, cnicEnc: g.cnic ? encrypt(g.cnic) : null, cnicMasked: g.cnic ? maskIdentity(g.cnic) : null })),
    });
  }
}

bookingsRouter.post('/', requirePerm('hostel.booking.create'), async (req, res) => {
  const submitting = !!req.body?.submit;
  const b = parse(bookingBody, req.body);
  if (!b.cnic) throw badRequest('CNIC / passport is required.', { fields: { cnic: 'Required' } });
  const { warnings } = await validate(b, submitting);
  const created = await transact(async (tx) => {
    const bookingId = await nextId(tx, ID_PREFIX.hostelBooking);
    const r = await tx.hostelBooking.create({
      data: {
        bookingId, requesterId: req.user!.id, requesterEmail: req.user!.email, districtId: b.districtId, hostelId: b.hostelId, roomType: b.roomType,
        guestName: b.guestName, cnicEnc: encrypt(b.cnic!), cnicMasked: maskIdentity(b.cnic!), mobile: b.mobile, organization: b.organization,
        referredBy: b.referredBy, referrerDesignation: b.referrerDesignation, purpose: b.purpose, numGuests: b.numGuests, numRooms: b.numRooms,
        requestedCheckIn: b.requestedCheckIn, requestedCheckOut: b.requestedCheckOut, requesterRemarks: b.requesterRemarks,
      },
    });
    await writeGuests(tx, r.id, b.guests);
    await audit(tx, req, { action: 'BOOKING_CREATED', module: 'HOSTEL', entityType: 'HostelBooking', entityId: r.id, entityRef: bookingId, after: snapshot(r) });
    if (submitting) await submitBooking(tx, req, r.id);
    return tx.hostelBooking.findUniqueOrThrow({ where: { id: r.id } });
  });
  res.status(201).json({ booking: { ...created, cnicEnc: undefined }, warnings });
});

bookingsRouter.put('/:id', requirePerm('hostel.booking.create'), async (req, res) => {
  const before = await prisma.hostelBooking.findUnique({ where: { id: String(req.params.id) } });
  if (!before) throw notFound();
  if (before.requesterId !== req.user!.id) throw forbidden('Only the requester can edit this booking.');
  if (!['DRAFT', 'RETURNED'].includes(before.status)) throw conflict('This booking can no longer be edited.');
  const submitting = !!req.body?.submit;
  const b = parse(bookingBody, req.body);
  const { warnings } = await validate(b, submitting);
  const r = await transact(async (tx) => {
    const data: any = {
      districtId: before.status === 'RETURNED' ? before.districtId : b.districtId, hostelId: b.hostelId, roomType: b.roomType, guestName: b.guestName, mobile: b.mobile,
      organization: b.organization, referredBy: b.referredBy, referrerDesignation: b.referrerDesignation, purpose: b.purpose, numGuests: b.numGuests, numRooms: b.numRooms,
      requestedCheckIn: b.requestedCheckIn, requestedCheckOut: b.requestedCheckOut, requesterRemarks: b.requesterRemarks,
    };
    if (b.cnic) { data.cnicEnc = encrypt(b.cnic); data.cnicMasked = maskIdentity(b.cnic); }
    const after = await tx.hostelBooking.update({ where: { id: before.id }, data });
    if (req.body?.guests) await writeGuests(tx, before.id, b.guests);
    const d = diff(snapshot(before), snapshot(after));
    if (d.changed) await audit(tx, req, { action: 'BOOKING_EDITED', module: 'HOSTEL', entityType: 'HostelBooking', entityId: before.id, entityRef: before.bookingId, before: d.before, after: d.after });
    if (submitting) await submitBooking(tx, req, before.id);
    return tx.hostelBooking.findUniqueOrThrow({ where: { id: before.id } });
  });
  res.json({ booking: { ...r, cnicEnc: undefined }, warnings });
});

bookingsRouter.delete('/:id', requirePerm('hostel.booking.create'), async (req, res) => {
  const b = await prisma.hostelBooking.findUnique({ where: { id: String(req.params.id) } });
  if (!b) throw notFound();
  if (b.requesterId !== req.user!.id || b.status !== 'DRAFT') throw forbidden('Only your own drafts can be deleted.');
  await prisma.$transaction(async (tx) => {
    await tx.file.updateMany({ where: { bookingId: b.id }, data: { deletedAt: new Date(), bookingId: null } });
    await tx.hostelBooking.delete({ where: { id: b.id } });
    await audit(tx, req, { action: 'BOOKING_DRAFT_DELETED', module: 'HOSTEL', entityType: 'HostelBooking', entityId: b.id, entityRef: b.bookingId, before: snapshot(b) });
  });
  res.json({ ok: true });
});

// ───────────── Register ─────────────
function listWhere(req: any) {
  const q = req.query;
  const and: any[] = [bookingScope(req.user)];
  if (q.scope === 'mine') and.push({ requesterId: req.user.id });
  if (q.scope === 'assigned') and.push({ workflow: { currentAssigneeId: req.user.id, status: 'IN_PROGRESS' } });
  if (q.scope === 'managed') and.push({ hostel: { managerId: req.user.id }, status: { not: 'DRAFT' } });
  if (q.q) {
    const s = String(q.q).trim();
    and.push({ OR: [{ bookingId: icontains(s) }, { guestName: icontains(s) }, { organization: icontains(s) }] });
  }
  if (q.districtId) and.push({ districtId: String(q.districtId) });
  if (q.hostelId) and.push({ hostelId: String(q.hostelId) });
  if (q.organization) and.push({ organization: icontains(String(q.organization)) });
  if (q.status) and.push({ status: { in: String(q.status).split(',') } });
  if (q.stayStatus) and.push({ stayStatus: { in: String(q.stayStatus).split(',') } });
  const range = dateRangeFilter(q.from, q.to);
  if (range) {
    const field = q.dateField === 'approved' ? 'approvedCheckIn' : q.dateField === 'checkin' ? 'requestedCheckIn' : 'submittedAt';
    and.push({ [field]: range });
  }
  return { AND: and };
}

const listInclude = {
  hostel: { select: { id: true, name: true } },
  district: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  files: { where: { deletedAt: null, category: 'SUPPORTING' }, select: { id: true, originalName: true } },
  workflow: { select: { status: true, currentLevelOrder: true, currentAssignee: { select: { id: true, name: true } } } },
};

const SORTS: Record<string, any> = {
  submittedAt: { submittedAt: 'desc' }, '-submittedAt': { submittedAt: 'asc' }, checkIn: { requestedCheckIn: 'asc' }, '-checkIn': { requestedCheckIn: 'desc' },
  bookingId: { bookingId: 'asc' }, guestName: { guestName: 'asc' }, updatedAt: { updatedAt: 'desc' },
};

async function emailStatuses(refs: string[]) {
  if (!refs.length) return new Map<string, string>();
  const rows = await prisma.emailLog.findMany({ where: { entityRef: { in: refs } }, orderBy: { createdAt: 'asc' }, select: { entityRef: true, status: true } });
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.entityRef!, r.status);
  return m;
}

function shapeRow(user: any, r: any, email: Map<string, string>) {
  return {
    ...r,
    cnicEnc: undefined,
    cnic: identityOf(user, r),
    identityMasked: !canSeeIdentity(user, r),
    currentAssignee: r.workflow?.status === 'IN_PROGRESS' ? r.workflow.currentAssignee : null,
    workflow: undefined,
    emailStatus: email.get(r.bookingId) ?? 'NONE',
    nights: nights(r.approvedCheckIn ?? r.requestedCheckIn, r.approvedCheckOut ?? r.requestedCheckOut),
  };
}

bookingsRouter.get('/', requireAuth, async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const where = listWhere(req);
  const [rows, total] = await Promise.all([
    prisma.hostelBooking.findMany({ where, include: listInclude, orderBy: SORTS[String(req.query.sort)] ?? { updatedAt: 'desc' }, skip, take }),
    prisma.hostelBooking.count({ where }),
  ]);
  const email = await emailStatuses(rows.map((r) => r.bookingId));
  res.json({ rows: rows.map((r) => shapeRow(req.user, r, email)), total, page, pageSize });
});

bookingsRouter.get('/export', requirePerm('hostel.export'), async (req, res) => {
  const s = await getSettings();
  const rows = await prisma.hostelBooking.findMany({ where: listWhere(req), include: listInclude, orderBy: { submittedAt: 'desc' }, take: 10000 });
  const email = await emailStatuses(rows.map((r) => r.bookingId));
  const shaped = rows.map((r) => shapeRow(req.user, r, email));
  await audit(prisma, req, { action: 'EXPORT', module: 'HOSTEL', entityType: 'HostelBooking', after: { format: req.query.format, filters: req.query, count: rows.length, identityVisible: can(req.user, 'hostel.view_identity') } });
  await sendExport(res, String(req.query.format ?? 'xlsx'), {
    title: 'Youth Hostel Booking Register',
    filename: `booking-register-${new Date().toISOString().slice(0, 10)}`,
    landscape: true,
    meta: [['Period', `${req.query.from || 'Beginning'} to ${req.query.to || 'Today'} (${req.query.dateField === 'approved' ? 'approved check-in' : req.query.dateField === 'checkin' ? 'requested check-in' : 'request date'})`], ['Records', String(rows.length)]],
    sections: [{
      type: 'table',
      columns: [
        { key: 'bookingId', label: 'Booking ID', width: 1.1 }, { key: 'reqDate', label: 'Request Date', width: 0.9 }, { key: 'requesterEmail', label: 'Requested By', width: 1.4 },
        { key: 'district', label: 'District/HQ', width: 0.9 }, { key: 'hostelName', label: 'Youth Hostel', width: 1.2 }, { key: 'guestName', label: 'Guest Name', width: 1.1 },
        { key: 'cnic', label: 'CNIC/Passport', width: 1.1 }, { key: 'mobile', label: 'Mobile', width: 0.9 }, { key: 'organization', label: 'Organization', width: 1.1 },
        { key: 'referredBy', label: 'Referred By', width: 0.9 }, { key: 'referrerDesignation', label: 'Referrer Designation', width: 0.9 }, { key: 'purpose', label: 'Purpose', width: 1.4 },
        { key: 'ci', label: 'Check-in', width: 0.8 }, { key: 'co', label: 'Check-out', width: 0.8 }, { key: 'numGuests', label: 'Guests', width: 0.5, align: 'right' },
        { key: 'numRooms', label: 'Rooms', width: 0.5, align: 'right' }, { key: 'docs', label: 'Supporting Document', width: 1 }, { key: 'requesterRemarks', label: 'Remarks', width: 1 },
        { key: 'aci', label: 'Approved Check-In', width: 0.8 }, { key: 'aco', label: 'Approved Check-Out', width: 0.8 }, { key: 'statusLabel', label: 'Booking Status', width: 0.9 },
        { key: 'approver', label: 'Approved By', width: 0.9 }, { key: 'approvalDate', label: 'Approval Date', width: 0.9 }, { key: 'hqRemarks', label: 'HQ Remarks', width: 1.1 }, { key: 'emailStatus', label: 'Email Status', width: 0.6 },
      ],
      rows: shaped.map((r: any) => ({
        ...r, reqDate: fmtDate(r.submittedAt), district: r.district.name, hostelName: r.hostel.name, ci: fmtDate(r.requestedCheckIn), co: fmtDate(r.requestedCheckOut),
        docs: r.files.map((f: any) => f.originalName).join(', '), aci: fmtDate(r.approvedCheckIn), aco: fmtDate(r.approvedCheckOut),
        statusLabel: r.status === 'APPROVED' && !['NONE', 'AWAITING_ARRIVAL'].includes(r.stayStatus) ? humanize(r.stayStatus) : humanize(r.status),
        approver: r.approvedBy?.name ?? '', approvalDate: fmtDateTime(r.approvedAt, s.timezone), emailStatus: humanize(r.emailStatus),
      })),
    }],
  }, req.user!.name);
});

bookingsRouter.get('/:id', requireAuth, async (req, res) => {
  if (!(await canViewBooking(req.user!, String(req.params.id)))) {
    if (!(await prisma.hostelBooking.count({ where: { id: String(req.params.id) } }))) throw notFound();
    throw forbidden('You do not have access to this booking.');
  }
  const b = await prisma.hostelBooking.findUniqueOrThrow({
    where: { id: String(req.params.id) },
    include: {
      hostel: { include: { manager: { select: { id: true, name: true, email: true, phone: true } }, facilityType: true, district: true } },
      district: true,
      requester: { select: { id: true, name: true, email: true, designation: true } },
      approvedBy: { select: { id: true, name: true, designation: true } },
      guests: true,
      reservations: { include: { room: true }, orderBy: { createdAt: 'asc' } },
      stay: { include: { checkInBy: { select: { name: true } }, checkOutBy: { select: { name: true } } } },
      files: { where: { deletedAt: null }, select: fileSelect, orderBy: { createdAt: 'asc' } },
    },
  });
  const seeId = canSeeIdentity(req.user!, b);
  if (seeId && b.requesterId !== req.user!.id) {
    await audit(prisma, req, { action: 'GUEST_IDENTITY_VIEWED', module: 'HOSTEL', entityType: 'HostelBooking', entityId: b.id, entityRef: b.bookingId });
  }
  const owner = b.requesterId === req.user!.id;
  const operate = canOperate(req.user!, b.hostel);
  const ci = b.approvedCheckIn ?? b.requestedCheckIn;
  const co = b.approvedCheckOut ?? b.requestedCheckOut;
  const av = PENDING_STATUSES.includes(b.status) ? await availability(prisma, b.hostelId, ci, co, { roomType: b.roomType, excludeBookingId: b.id }) : null;
  const s = await getSettings();
  res.json({
    booking: {
      ...b,
      cnicEnc: undefined,
      cnic: identityOf(req.user!, b),
      identityMasked: !seeId,
      guests: b.guests.map((g) => ({ ...g, cnicEnc: undefined, cnic: seeId ? (g.cnicEnc ? (identityOf(req.user!, { requesterId: b.requesterId, cnicEnc: g.cnicEnc, cnicMasked: g.cnicMasked ?? '' })) : null) : g.cnicMasked })),
      requestedNights: nights(b.requestedCheckIn, b.requestedCheckOut),
      approvedNights: b.approvedCheckIn && b.approvedCheckOut ? nights(b.approvedCheckIn, b.approvedCheckOut) : null,
    },
    availability: av,
    timeline: b.workflowInstanceId ? await buildTimeline(prisma, b.workflowInstanceId) : null,
    emailStatus: await latestEmailStatus(b.bookingId),
    can: {
      ...(await workflowFlags(req.user!, b.workflowInstanceId)),
      edit: owner && ['DRAFT', 'RETURNED'].includes(b.status),
      delete: owner && b.status === 'DRAFT',
      cancel: (owner || can(req.user, 'workflow.override') || operate) && ['PENDING_REVIEW', 'UNDER_REVIEW', 'PENDING_FINAL', 'RETURNED', 'APPROVED'].includes(b.status) && ['NONE', 'AWAITING_ARRIVAL'].includes(b.stayStatus),
      checkIn: operate && b.status === 'APPROVED' && b.stayStatus === 'AWAITING_ARRIVAL',
      checkOut: operate && b.stayStatus === 'CHECKED_IN',
      noShow: operate && b.status === 'APPROVED' && b.stayStatus === 'AWAITING_ARRIVAL',
      extend: operate && ['AWAITING_ARRIVAL', 'CHECKED_IN'].includes(b.stayStatus) && (!s.hostelExtensionRequiresOverride || can(req.user, 'workflow.override')),
      uploadRecords: operate && b.status === 'APPROVED',
      upload: (owner && ['DRAFT', 'RETURNED'].includes(b.status)) || can(req.user, 'workflow.override'),
    },
  });
});

bookingsRouter.post('/:id/cancel', requireAuth, async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Reason is required').max(1000) }), req.body);
  const b = await prisma.hostelBooking.findUnique({ where: { id: String(req.params.id) }, include: { hostel: { include: { manager: true } }, requester: true } });
  if (!b) throw notFound();
  if (b.requesterId !== req.user!.id && !can(req.user, 'workflow.override') && !canOperate(req.user!, b.hostel)) throw forbidden();
  if (!['NONE', 'AWAITING_ARRIVAL'].includes(b.stayStatus) || !b.workflowInstanceId) throw conflict('This booking cannot be cancelled at this stage.');
  await transact(async (tx) => {
    await cancel(tx, b.workflowInstanceId!, req.user!, reason);
    await tx.hostelBooking.update({ where: { id: b.id }, data: { cancelReason: reason } });
    await audit(tx, req, { action: 'BOOKING_CANCELLED', module: 'HOSTEL', entityType: 'HostelBooking', entityId: b.id, entityRef: b.bookingId, before: { status: b.status, stayStatus: b.stayStatus }, after: { status: 'CANCELLED', reason } });
    await notify(tx, {
      recipients: [b.requester, b.hostel.manager].map((u) => (u ? { id: u.id, email: u.email, name: u.name } : null)),
      event: 'BOOKING_CANCELLED', module: 'HOSTEL_BOOKING', entityRef: b.bookingId, instanceId: b.workflowInstanceId,
      title: 'Booking cancelled', details: [['Hostel', b.hostel.name], ['Guest', b.guestName], ['Cancelled by', req.user!.name]], remarks: reason, link: `/hostels/bookings/${b.id}`,
    });
  });
  res.json({ ok: true });
});

mountWorkflowRoutes(bookingsRouter, {
  module: 'HOSTEL_BOOKING',
  entityType: 'HostelBooking',
  async locate(id) {
    const r = await prisma.hostelBooking.findUnique({ where: { id }, select: { workflowInstanceId: true, bookingId: true } });
    return r ? { instanceId: r.workflowInstanceId, ref: r.bookingId } : null;
  },
  canView: canViewBooking,
  extraSchema: z.object({
    approvedCheckIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    approvedCheckOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
});

// ───────────── Operations: check-in / check-out / no-show / extension ─────────────

async function loadOperable(req: any) {
  const b = await prisma.hostelBooking.findUnique({
    where: { id: String(req.params.id) },
    include: { hostel: { include: { manager: true } }, requester: true, reservations: { where: { status: 'ACTIVE' }, include: { room: true } }, stay: true },
  });
  if (!b) throw notFound();
  if (!canOperate(req.user, b.hostel)) throw forbidden('Only the hostel manager (or an authorised administrator) can record accommodation operations.');
  return b;
}

const zDateTime = z.string().refine((s) => !isNaN(new Date(s).getTime()), 'Enter a valid date and time').transform((s) => new Date(s));

bookingsRouter.post('/:id/check-in', requireAuth, async (req, res) => {
  const b = await loadOperable(req);
  const body = parse(z.object({
    arrivalAt: zDateTime,
    actualGuests: z.coerce.number().int().min(1),
    actualRooms: z.coerce.number().int().min(1),
    idVerified: z.literal(true, { errorMap: () => ({ message: 'Guest identity must be verified before check-in' }) }),
    remarks: zOptStr(1000),
  }), req.body);
  if (b.status !== 'APPROVED' || b.stayStatus !== 'AWAITING_ARRIVAL') throw conflict('Only approved bookings awaiting arrival can be checked in.');
  const arrivalDay = new Date(body.arrivalAt.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  if (arrivalDay < b.approvedCheckIn!) throw badRequest(`Rooms are reserved from ${fmtDate(b.approvedCheckIn)}. Early arrival requires the approved dates to be amended first.`, { fields: { arrivalAt: 'Before approved check-in' } });
  if (arrivalDay >= b.approvedCheckOut!) throw badRequest('Arrival is on or after the approved check-out date. Extend the booking first.');
  const reservedCap = b.reservations.reduce((a, r) => a + r.room.capacity, 0);
  if (body.actualRooms > b.reservations.length) throw badRequest(`Only ${b.reservations.length} room(s) are reserved for this booking.`, { fields: { actualRooms: `Maximum ${b.reservations.length}` } });
  if (body.actualGuests > reservedCap) throw badRequest(`Reserved rooms accommodate at most ${reservedCap} guest(s).`, { fields: { actualGuests: `Maximum ${reservedCap}` } });
  await transact(async (tx) => {
    await tx.stayRecord.create({ data: { bookingId: b.id, checkInAt: body.arrivalAt, checkInById: req.user!.id, actualGuests: body.actualGuests, actualRooms: body.actualRooms, idVerified: true, checkInRemarks: body.remarks } });
    await tx.hostelBooking.update({ where: { id: b.id }, data: { stayStatus: 'CHECKED_IN' } });
    await audit(tx, req, { action: 'GUEST_CHECKED_IN', module: 'HOSTEL', entityType: 'HostelBooking', entityId: b.id, entityRef: b.bookingId, after: body });
    await notify(tx, {
      recipients: [{ id: b.requester.id, email: b.requester.email, name: b.requester.name }],
      event: 'CHECKED_IN', module: 'HOSTEL_BOOKING', entityRef: b.bookingId, instanceId: b.workflowInstanceId,
      title: 'Guest checked in', details: [['Hostel', b.hostel.name], ['Guest', b.guestName], ['Arrival', fmtDateTime(body.arrivalAt)], ['Guests / rooms', `${body.actualGuests} / ${body.actualRooms}`]],
      remarks: body.remarks, link: `/hostels/bookings/${b.id}`,
    });
  });
  res.json({ ok: true });
});

bookingsRouter.post('/:id/check-out', requireAuth, async (req, res) => {
  const b = await loadOperable(req);
  const body = parse(z.object({
    departureAt: zDateTime,
    finalGuests: z.coerce.number().int().min(0),
    finalRooms: z.coerce.number().int().min(0),
    remarks: zOptStr(1000),
  }), req.body);
  if (b.stayStatus !== 'CHECKED_IN' || !b.stay) throw conflict('Only checked-in guests can be checked out.');
  if (body.departureAt < b.stay.checkInAt) throw badRequest('Departure cannot be before arrival.', { fields: { departureAt: 'Before arrival' } });
  const depDay = new Date(body.departureAt.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const early = depDay < b.approvedCheckOut!;
  await transact(async (tx) => {
    await tx.stayRecord.update({ where: { bookingId: b.id }, data: { checkOutAt: body.departureAt, checkOutById: req.user!.id, finalGuests: body.finalGuests, finalRooms: body.finalRooms, checkOutRemarks: body.remarks, earlyDeparture: early } });
    // free the rooms from the departure date onward
    for (const r of b.reservations) {
      await tx.roomReservation.update({ where: { id: r.id }, data: { status: 'RELEASED', releasedAt: new Date(), endDate: depDay > r.startDate && depDay < r.endDate ? depDay : r.endDate } });
    }
    await tx.hostelBooking.update({ where: { id: b.id }, data: { stayStatus: 'COMPLETED' } });
    await audit(tx, req, { action: early ? 'GUEST_CHECKED_OUT_EARLY' : 'GUEST_CHECKED_OUT', module: 'HOSTEL', entityType: 'HostelBooking', entityId: b.id, entityRef: b.bookingId, after: { ...body, earlyDeparture: early } });
    const recipients = [{ id: b.requester.id, email: b.requester.email, name: b.requester.name }];
    await notify(tx, {
      recipients, event: 'CHECKED_OUT', module: 'HOSTEL_BOOKING', entityRef: b.bookingId, instanceId: b.workflowInstanceId,
      title: early ? 'Guest checked out (early departure)' : 'Guest checked out', details: [['Hostel', b.hostel.name], ['Guest', b.guestName], ['Departure', fmtDateTime(body.departureAt)]],
      remarks: body.remarks, link: `/hostels/bookings/${b.id}`,
    });
    await notify(tx, {
      recipients, event: 'BOOKING_COMPLETED', module: 'HOSTEL_BOOKING', entityRef: b.bookingId, instanceId: b.workflowInstanceId,
      title: 'Booking completed', details: [['Hostel', b.hostel.name], ['Stay', `${fmtDateTime(b.stay!.checkInAt)} – ${fmtDateTime(body.departureAt)}`], ['Guests accommodated', String(body.finalGuests)]],
      link: `/hostels/bookings/${b.id}`,
    });
  });
  res.json({ ok: true });
});

bookingsRouter.post('/:id/no-show', requireAuth, async (req, res) => {
  const b = await loadOperable(req);
  const { remarks } = parse(z.object({ remarks: z.string().trim().min(3, 'Remarks are required').max(1000) }), req.body);
  if (b.status !== 'APPROVED' || b.stayStatus !== 'AWAITING_ARRIVAL') throw conflict('Only approved bookings awaiting arrival can be marked as no-show.');
  if (todayUtc() < b.approvedCheckIn!) throw conflict('A no-show can only be recorded on or after the approved check-in date.');
  await transact(async (tx) => {
    await tx.roomReservation.updateMany({ where: { bookingId: b.id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
    await tx.hostelBooking.update({ where: { id: b.id }, data: { stayStatus: 'NO_SHOW' } });
    await audit(tx, req, { action: 'BOOKING_NO_SHOW', module: 'HOSTEL', entityType: 'HostelBooking', entityId: b.id, entityRef: b.bookingId, after: { remarks } });
    await notify(tx, {
      recipients: [{ id: b.requester.id, email: b.requester.email, name: b.requester.name }],
      event: 'NO_SHOW', module: 'HOSTEL_BOOKING', entityRef: b.bookingId, instanceId: b.workflowInstanceId,
      title: 'Recorded as no-show; reserved rooms released', details: [['Hostel', b.hostel.name], ['Guest', b.guestName]], remarks, link: `/hostels/bookings/${b.id}`,
    });
  });
  res.json({ ok: true });
});

bookingsRouter.post('/:id/extend', requireAuth, async (req, res) => {
  const b = await loadOperable(req);
  const s = await getSettings();
  if (s.hostelExtensionRequiresOverride && !can(req.user, 'workflow.override')) throw forbidden('Stay extensions must be authorised by an administrator under the current policy.');
  const body = parse(z.object({ newCheckOut: zDate, remarks: z.string().trim().min(3, 'Remarks are required').max(1000) }), req.body);
  if (!['AWAITING_ARRIVAL', 'CHECKED_IN'].includes(b.stayStatus)) throw conflict('Only upcoming or active stays can be extended.');
  if (body.newCheckOut <= b.approvedCheckOut!) throw badRequest('The new check-out must be later than the current approved check-out.', { fields: { newCheckOut: 'Must be later' } });
  await transact(async (tx) => {
    // same rooms must be free for the extra nights
    const clash = await tx.roomReservation.findMany({
      where: { roomId: { in: b.reservations.map((r) => r.roomId) }, status: 'ACTIVE', bookingId: { not: b.id }, startDate: { lt: body.newCheckOut }, endDate: { gt: b.approvedCheckOut! } },
      include: { room: true },
    });
    if (clash.length) throw conflict(`Cannot extend: room(s) ${[...new Set(clash.map((c) => c.room.roomNumber))].join(', ')} are reserved by another booking for the extra nights.`);
    const unavailable = b.reservations.filter((r) => r.room.status !== 'AVAILABLE');
    if (unavailable.length) throw conflict(`Room(s) ${unavailable.map((r) => r.room.roomNumber).join(', ')} are out of service.`);
    for (const r of b.reservations) await tx.roomReservation.update({ where: { id: r.id }, data: { endDate: body.newCheckOut } });
    await tx.hostelBooking.update({ where: { id: b.id }, data: { approvedCheckOut: body.newCheckOut } });
    if (b.stay) await tx.stayRecord.update({ where: { bookingId: b.id }, data: { extendedTo: body.newCheckOut } });
    await audit(tx, req, { action: 'STAY_EXTENDED', module: 'HOSTEL', entityType: 'HostelBooking', entityId: b.id, entityRef: b.bookingId, before: { approvedCheckOut: b.approvedCheckOut }, after: { approvedCheckOut: body.newCheckOut, remarks: body.remarks } });
    await notify(tx, {
      recipients: [b.requester, b.hostel.manager].map((u) => (u ? { id: u.id, email: u.email, name: u.name } : null)),
      event: 'APPROVED_DATES_CHANGED', module: 'HOSTEL_BOOKING', entityRef: b.bookingId, instanceId: b.workflowInstanceId,
      title: 'Approved check-out date extended', details: [['Hostel', b.hostel.name], ['Previous check-out', fmtDate(b.approvedCheckOut)], ['New check-out', fmtDate(body.newCheckOut)]],
      remarks: body.remarks, link: `/hostels/bookings/${b.id}`,
    });
  });
  res.json({ ok: true });
});

/** Operations board: arrivals, in-house guests and departures for the user's hostels. */
bookingsRouter.get('/operations/board', requirePerm('hostel.operations'), async (req, res) => {
  const hostelWhere = can(req.user, 'hostel.booking.view_all') ? (req.query.hostelId ? { id: String(req.query.hostelId) } : {}) : { managerId: req.user!.id, ...(req.query.hostelId ? { id: String(req.query.hostelId) } : {}) };
  const hostels = await prisma.hostel.findMany({ where: hostelWhere, select: { id: true, name: true } });
  const ids = hostels.map((h) => h.id);
  const today = todayUtc();
  const in7 = new Date(today.getTime() + 7 * 86_400_000);
  const sel = { id: true, bookingId: true, guestName: true, organization: true, numGuests: true, numRooms: true, approvedCheckIn: true, approvedCheckOut: true, stayStatus: true, hostel: { select: { name: true } }, stay: true, reservations: { where: { status: 'ACTIVE' }, select: { room: { select: { roomNumber: true } } } } };
  const [arrivals, inHouse] = await Promise.all([
    prisma.hostelBooking.findMany({ where: { hostelId: { in: ids }, status: 'APPROVED', stayStatus: 'AWAITING_ARRIVAL', approvedCheckIn: { lte: in7 } }, select: sel, orderBy: { approvedCheckIn: 'asc' } }),
    prisma.hostelBooking.findMany({ where: { hostelId: { in: ids }, stayStatus: 'CHECKED_IN' }, select: sel, orderBy: { approvedCheckOut: 'asc' } }),
  ]);
  res.json({ hostels, today, arrivals, inHouse });
});
