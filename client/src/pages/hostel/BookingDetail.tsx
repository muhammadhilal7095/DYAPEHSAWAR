import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { BedDouble, CalendarPlus, LogIn, LogOut, Pencil, Printer, Trash2, UserX, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useLookupLabel } from '../../lib/hooks';
import { addDays, fmtDate, fmtDateTime, humanize, nightsBetween, nowLocalInput, toISODate } from '../../lib/format';
import { Badge, Button, Card, Checkbox, ErrorBox, Grid, Input, KV, LinkButton, Modal, Notice, PageHeader, Spinner, Textarea, useConfirm, useFormErrors, useToast } from '../../components/ui';
import { CurrentOfficer, EmailStatus, ReasonModal, ReviewPanel, Timeline } from '../../components/Workflow';
import { AttachmentList, Uploader } from '../../components/Files';
import { BookingStatus } from './Register';

export default function BookingDetail() {
  const { id } = useParams();
  const { me } = useAuth();
  const nav = useNavigate();
  const confirm = useConfirm();
  const roomType = useLookupLabel('ROOM_TYPE');
  const { data, loading, error, reload } = useApi(`/api/hostel/bookings/${id}`);
  const [modal, setModal] = useState<null | 'checkin' | 'checkout' | 'extend' | 'cancel' | 'noshow'>(null);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const b = data.booking;
  const can = data.can;
  const av = data.availability;
  const activeRes = b.reservations.filter((r: any) => r.status === 'ACTIVE');
  const datesChanged = b.approvedCheckIn && (toISODate(b.approvedCheckIn) !== toISODate(b.requestedCheckIn) || toISODate(b.approvedCheckOut) !== toISODate(b.requestedCheckOut));
  const stayState = b.stayStatus === 'COMPLETED' ? 'COMPLETED' : b.stayStatus === 'CHECKED_IN' ? 'IN_PROGRESS' : b.stayStatus === 'NO_SHOW' ? 'REJECTED' : b.stayStatus === 'CANCELLED' ? 'CANCELLED' : 'NOT_STARTED';

  return (
    <>
      <PageHeader
        back="/hostels/bookings"
        title={`${b.guestName} — ${b.hostel.name}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{b.bookingId}</span><BookingStatus b={b} /></span>}
        actions={<>
          {can.edit && <LinkButton to={`/hostels/bookings/${id}/edit`} variant="secondary" icon={<Pencil className="size-4" />}>{b.status === 'RETURNED' ? 'Correct & resubmit' : 'Edit draft'}</LinkButton>}
          {can.delete && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={async () => { if (await confirm({ title: 'Delete draft?', message: 'This draft will be permanently deleted.', confirmLabel: 'Delete', tone: 'danger' })) { await api.del(`/api/hostel/bookings/${id}`); nav('/hostels/bookings'); } }}>Delete</Button>}
          {can.cancel && <Button variant="secondary" icon={<XCircle className="size-4" />} onClick={() => setModal('cancel')}>Cancel booking</Button>}
          <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>
        </>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {(can.checkIn || can.checkOut || can.noShow || can.extend) && (
            <Card title="Accommodation operations" className="border-violet-200 ring-1 ring-violet-100">
              <div className="flex flex-wrap gap-2">
                {can.checkIn && <Button icon={<LogIn className="size-4" />} onClick={() => setModal('checkin')}>Record check-in</Button>}
                {can.checkOut && <Button icon={<LogOut className="size-4" />} onClick={() => setModal('checkout')}>Record check-out</Button>}
                {can.extend && <Button variant="secondary" icon={<CalendarPlus className="size-4" />} onClick={() => setModal('extend')}>Extend stay</Button>}
                {can.noShow && <Button variant="secondary" icon={<UserX className="size-4" />} onClick={() => setModal('noshow')}>Mark no-show</Button>}
              </div>
            </Card>
          )}
          {av && (
            <Notice tone={av.availableRooms >= b.numRooms && av.availableCapacity >= b.numGuests ? 'success' : 'warning'}>
              Availability for {b.approvedCheckIn ? 'approved' : 'requested'} dates: <strong>{av.availableRooms}</strong> free room(s), <strong>{av.availableCapacity}</strong> bed(s){b.roomType ? ` of type ${roomType(b.roomType)}` : ''}. Requested: {b.numRooms} room(s) for {b.numGuests} guest(s).
              {av.pendingRooms > 0 && ` Other pending requests: ${av.pendingRooms} room(s).`}
            </Notice>
          )}
          <ReviewPanel
            base={`/api/hostel/bookings/${id}`}
            can={can}
            onDone={reload}
            approveLabel="Approve & forward"
            finalApproveLabel="Final approval & reserve rooms"
            rejectLabel="Decline"
            renderExtra={(extra, set, errors) =>
              can.level?.canAmendDates || can.level?.isFinal ? (
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="mb-2 text-sm font-medium">Approved accommodation dates</p>
                  <Grid cols={3}>
                    <Input label="Approved check-in" type="date" value={extra.approvedCheckIn ?? toISODate(b.approvedCheckIn ?? b.requestedCheckIn)} onChange={(e) => set({ approvedCheckIn: e.target.value })} error={errors.approvedCheckIn} />
                    <Input label="Approved check-out" type="date" value={extra.approvedCheckOut ?? toISODate(b.approvedCheckOut ?? b.requestedCheckOut)} onChange={(e) => set({ approvedCheckOut: e.target.value })} error={errors.approvedCheckOut} />
                    <Input label="Nights" disabled value={String(nightsBetween(extra.approvedCheckIn ?? toISODate(b.approvedCheckIn ?? b.requestedCheckIn), extra.approvedCheckOut ?? toISODate(b.approvedCheckOut ?? b.requestedCheckOut)))} />
                  </Grid>
                  <p className="mt-2 text-xs text-ink-3">Requested: {fmtDate(b.requestedCheckIn)} → {fmtDate(b.requestedCheckOut)}. Different dates require remarks; the requester is notified.</p>
                </div>
              ) : null
            }
          />
          <Card title="Booking details">
            <KV cols={3} items={[
              ['Booking ID', <span className="font-mono">{b.bookingId}</span>], ['Request date', fmtDateTime(b.submittedAt)], ['Requested by', b.requesterEmail],
              ['District / HQ', b.district.name], ['Youth hostel', b.hostel.name], ['Hostel address', b.hostel.address],
              ['Hostel manager', b.hostel.manager ? `${b.hostel.manager.name}${b.hostel.manager.phone ? ` · ${b.hostel.manager.phone}` : ''}` : '—'], ['Facility type', b.hostel.facilityType?.name], ['Room type', b.roomType ? roomType(b.roomType) : 'Any'],
              ['Email status', <EmailStatus s={data.emailStatus} />], ['Version', b.version], ['Last updated', fmtDateTime(b.updatedAt)],
            ]} />
          </Card>
          <Card title="Guest information">
            <KV cols={3} items={[
              ['Guest name', b.guestName], ['CNIC / passport', <span className="font-mono">{b.cnic}{b.identityMasked && <span className="ml-1 text-xs text-ink-3">(restricted)</span>}</span>], ['Mobile', b.mobile],
              ['Organization', b.organization], ['Referred by', b.referredBy], ['Referrer designation', b.referrerDesignation],
              ['Number of guests', b.numGuests], ['Number of rooms', b.numRooms], ['Purpose of visit', b.purpose],
            ]} />
            {b.guests.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Additional guests</p>
                <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">{b.guests.map((g: any) => <li key={g.id}>{g.name} {g.cnic && <span className="font-mono text-xs text-ink-3">· {g.cnic}</span>} {g.gender && <span className="text-xs text-ink-3">· {g.gender}</span>}</li>)}</ul>
              </div>
            )}
          </Card>
          <Card title="Dates & approval">
            <KV cols={3} items={[
              ['Requested check-in', fmtDate(b.requestedCheckIn)], ['Requested check-out', fmtDate(b.requestedCheckOut)], ['Requested nights', b.requestedNights],
              ['Approved check-in', fmtDate(b.approvedCheckIn)], ['Approved check-out', fmtDate(b.approvedCheckOut)], ['Approved nights', b.approvedNights ?? '—'],
              ['Approved by', b.approvedBy ? `${b.approvedBy.name}${b.approvedBy.designation ? `, ${b.approvedBy.designation}` : ''}` : '—'], ['Approval date', fmtDateTime(b.approvedAt)], ['HQ remarks', b.hqRemarks],
              ['Requester remarks', b.requesterRemarks], ...(b.cancelReason ? [['Cancellation reason', b.cancelReason]] as any : []),
            ]} />
            {datesChanged && <div className="mt-3"><Notice tone="info">The approved dates differ from the requested dates. Both are preserved for reporting.</Notice></div>}
          </Card>
          {(activeRes.length > 0 || b.reservations.length > 0) && (
            <Card title="Room allocation" subtitle="Rooms reserved on final approval">
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {b.reservations.map((r: any) => (
                  <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                    <BedDouble className="size-4 text-ink-3" />
                    <span className="font-medium">{r.room.roomNumber}</span>
                    <span className="text-xs text-ink-3">{roomType(r.room.roomType)} · {r.room.capacity} bed(s)</span>
                    <span className="ml-auto"><Badge status={r.status} label={r.status === 'ACTIVE' ? 'Reserved' : 'Released'} tone={r.status === 'ACTIVE' ? 'green' : 'gray'} /></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {b.stay && (
            <Card title="Check-in / check-out record">
              <KV cols={3} items={[
                ['Arrival', fmtDateTime(b.stay.checkInAt)], ['Checked in by', b.stay.checkInBy.name], ['Identity verified', b.stay.idVerified ? 'Yes' : 'No'],
                ['Actual guests', b.stay.actualGuests], ['Rooms occupied', b.stay.actualRooms], ['Check-in remarks', b.stay.checkInRemarks],
                ['Departure', fmtDateTime(b.stay.checkOutAt)], ['Checked out by', b.stay.checkOutBy?.name], ['Final guests / rooms', b.stay.checkOutAt ? `${b.stay.finalGuests} / ${b.stay.finalRooms}` : '—'],
                ['Early departure', b.stay.checkOutAt ? (b.stay.earlyDeparture ? 'Yes' : 'No') : '—'], ['Extended to', fmtDate(b.stay.extendedTo)], ['Check-out remarks', b.stay.checkOutRemarks],
              ]} />
            </Card>
          )}
          <Card title="Supporting documents & accommodation records">
            {can.uploadRecords && <div className="mb-3"><Uploader target="hostel-booking" entityId={b.id} kind="pdfimage" compact categories={[{ value: 'ACCOMMODATION_RECORD', label: 'Accommodation record' }]} onUploaded={reload} /></div>}
            {can.upload && !can.edit && <div className="mb-3"><Uploader target="hostel-booking" entityId={b.id} kind="pdfimage" compact categories={[{ value: 'SUPPORTING', label: 'Supporting document' }]} onUploaded={reload} /></div>}
            <AttachmentList files={b.files} onChanged={reload} canRemove={(f) => f.uploadedBy.id === me?.id && (can.edit || can.uploadRecords)} />
          </Card>
        </div>
        <div className="space-y-4">
          <CurrentOfficer tl={data.timeline} />
          {data.timeline ? (
            <Timeline tl={data.timeline} title="Approval timeline" extra={[{ label: 'Accommodation', state: stayState, detail: b.status === 'APPROVED' ? humanize(b.stayStatus) : undefined }]} />
          ) : <Card title="Approval timeline"><p className="text-sm text-ink-3">Starts when the booking is submitted.</p></Card>}
        </div>
      </div>

      <CheckInModal open={modal === 'checkin'} onClose={() => setModal(null)} id={b.id} b={b} onDone={reload} />
      <CheckOutModal open={modal === 'checkout'} onClose={() => setModal(null)} id={b.id} b={b} onDone={reload} />
      <ExtendModal open={modal === 'extend'} onClose={() => setModal(null)} id={b.id} b={b} onDone={reload} />
      <ReasonModal open={modal === 'cancel'} onClose={() => setModal(null)} title="Cancel booking" url={`/api/hostel/bookings/${id}/cancel`} field="reason" onDone={reload} confirmLabel="Cancel booking" tone="danger" description="Reserved rooms are released and the requester and hostel manager are notified." />
      <ReasonModal open={modal === 'noshow'} onClose={() => setModal(null)} title="Mark as no-show" url={`/api/hostel/bookings/${id}/no-show`} onDone={reload} confirmLabel="Mark no-show" tone="warning" description="Reserved rooms will be released for other bookings." />
    </>
  );
}

function useOp(url: string, onDone: () => void, onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const fe = useFormErrors();
  const toast = useToast();
  const run = async (body: any, msg: string) => {
    fe.clear();
    setBusy(true);
    try {
      await api.post(url, body);
      toast('success', msg);
      onClose();
      onDone();
    } catch (e) {
      fe.capture(e);
    } finally {
      setBusy(false);
    }
  };
  return { busy, run, ...fe };
}

function CheckInModal({ open, onClose, id, b, onDone }: any) {
  const [f, setF] = useState({ arrivalAt: nowLocalInput(), actualGuests: String(b.numGuests), actualRooms: String(b.reservations.filter((r: any) => r.status === 'ACTIVE').length), idVerified: false, remarks: '' });
  const op = useOp(`/api/hostel/bookings/${id}/check-in`, onDone, onClose);
  return (
    <Modal open={open} onClose={onClose} title={`Check-in — ${b.bookingId}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={op.busy} onClick={() => op.run({ ...f, arrivalAt: new Date(f.arrivalAt).toISOString() }, 'Guest checked in.')}>Confirm check-in</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={op.formError ? { message: op.formError } : null} />
        <Notice>Lead guest: <strong>{b.guestName}</strong> · {b.cnic} · approved {fmtDate(b.approvedCheckIn)} → {fmtDate(b.approvedCheckOut)}</Notice>
        <Grid cols={3}>
          <Input label="Arrival date & time" type="datetime-local" value={f.arrivalAt} onChange={(e) => setF({ ...f, arrivalAt: e.target.value })} error={op.errors.arrivalAt} />
          <Input label="Actual guests" type="number" min={1} value={f.actualGuests} onChange={(e) => setF({ ...f, actualGuests: e.target.value })} error={op.errors.actualGuests} />
          <Input label="Rooms occupied" type="number" min={1} value={f.actualRooms} onChange={(e) => setF({ ...f, actualRooms: e.target.value })} error={op.errors.actualRooms} />
        </Grid>
        <Checkbox checked={f.idVerified} onChange={(v) => setF({ ...f, idVerified: v })} label="I have verified the guest's identity document against the booking" />
        {op.errors.idVerified && <p className="text-xs text-red-600">{op.errors.idVerified}</p>}
        <Textarea label="Remarks" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
      </div>
    </Modal>
  );
}

function CheckOutModal({ open, onClose, id, b, onDone }: any) {
  const [f, setF] = useState({ departureAt: nowLocalInput(), finalGuests: String(b.stay?.actualGuests ?? b.numGuests), finalRooms: String(b.stay?.actualRooms ?? b.numRooms), remarks: '' });
  const op = useOp(`/api/hostel/bookings/${id}/check-out`, onDone, onClose);
  const early = b.approvedCheckOut && f.departureAt.slice(0, 10) < toISODate(b.approvedCheckOut);
  return (
    <Modal open={open} onClose={onClose} title={`Check-out — ${b.bookingId}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={op.busy} onClick={() => op.run({ ...f, departureAt: new Date(f.departureAt).toISOString() }, 'Guest checked out; booking completed.')}>Confirm check-out</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={op.formError ? { message: op.formError } : null} />
        <Grid cols={3}>
          <Input label="Departure date & time" type="datetime-local" value={f.departureAt} onChange={(e) => setF({ ...f, departureAt: e.target.value })} error={op.errors.departureAt} />
          <Input label="Final guest count" type="number" min={0} value={f.finalGuests} onChange={(e) => setF({ ...f, finalGuests: e.target.value })} />
          <Input label="Rooms used" type="number" min={0} value={f.finalRooms} onChange={(e) => setF({ ...f, finalRooms: e.target.value })} />
        </Grid>
        {early && <Notice tone="warning">Early departure — rooms will be released from the departure date.</Notice>}
        <Textarea label="Operational remarks" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
      </div>
    </Modal>
  );
}

function ExtendModal({ open, onClose, id, b, onDone }: any) {
  const [f, setF] = useState({ newCheckOut: b.approvedCheckOut ? addDays(toISODate(b.approvedCheckOut), 1) : '', remarks: '' });
  const op = useOp(`/api/hostel/bookings/${id}/extend`, onDone, onClose);
  return (
    <Modal open={open} onClose={onClose} title="Extend stay" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={op.busy} onClick={() => op.run(f, 'Stay extended.')}>Extend</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={op.formError ? { message: op.formError } : null} />
        <p className="text-sm text-ink-2">Current approved check-out: {fmtDate(b.approvedCheckOut)}. The same rooms must be free for the extra nights.</p>
        <Input label="New check-out date" type="date" value={f.newCheckOut} onChange={(e) => setF({ ...f, newCheckOut: e.target.value })} error={op.errors.newCheckOut} />
        <Textarea label="Reason" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} error={op.errors.remarks} />
      </div>
    </Modal>
  );
}
