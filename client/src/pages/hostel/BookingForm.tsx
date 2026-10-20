import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Plus, Save, Send, Trash2 } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDistricts, useLookups } from '../../lib/hooks';
import { addDays, nightsBetween, toISODate, todayISO } from '../../lib/format';
import { Button, Card, ErrorBox, Grid, Input, KV, Notice, PageHeader, Select, Spinner, Textarea, useFormErrors, useToast } from '../../components/ui';
import { AttachmentList, Uploader } from '../../components/Files';
import { MobileActions, SectionNav } from '../../components/FormKit';

const blank = () => ({
  hostelId: '', districtId: '', roomType: '', guestName: '', cnic: '', mobile: '', organization: '', referredBy: '', referrerDesignation: '', purpose: '',
  numGuests: '1', numRooms: '1', requestedCheckIn: addDays(todayISO(), 1), requestedCheckOut: addDays(todayISO(), 2), requesterRemarks: '',
  guests: [] as { name: string; cnic: string; gender: string }[],
});

export default function BookingForm() {
  const { id } = useParams();
  const { me } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const districts = useDistricts();
  const roomTypes = useLookups('ROOM_TYPE');
  const hostels = useCached<any[]>('/api/hostel/hostels') ?? [];
  const existing = useApi(id ? `/api/hostel/bookings/${id}` : null);
  const [f, setF] = useState(blank());
  const [busy, setBusy] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const { errors, formError, capture, clear } = useFormErrors();
  const [guestsDirty, setGuestsDirty] = useState(false);
  const set = (p: Partial<ReturnType<typeof blank>>) => { if (p.guests) setGuestsDirty(true); setF((x) => ({ ...x, ...p })); };

  useEffect(() => { if (!id && me) set({ districtId: me.districtId ?? '' }); }, [id, me]);
  useEffect(() => {
    const b = existing.data?.booking;
    if (!b) return;
    setF({
      hostelId: b.hostelId, districtId: b.districtId, roomType: b.roomType ?? '', guestName: b.guestName, cnic: '', mobile: b.mobile, organization: b.organization, referredBy: b.referredBy ?? '',
      referrerDesignation: b.referrerDesignation ?? '', purpose: b.purpose, numGuests: String(b.numGuests), numRooms: String(b.numRooms), requestedCheckIn: toISODate(b.requestedCheckIn),
      requestedCheckOut: toISODate(b.requestedCheckOut), requesterRemarks: b.requesterRemarks ?? '', guests: b.guests.map((g: any) => ({ name: g.name, cnic: '', gender: g.gender ?? '' })),
    });
    setGuestsDirty(false);
  }, [existing.data]);

  const hostel = hostels.find((h) => h.id === f.hostelId);
  const validDates = f.requestedCheckIn && f.requestedCheckOut && f.requestedCheckOut > f.requestedCheckIn;
  const av = useApi(f.hostelId && validDates ? `/api/hostel/hostels/${f.hostelId}/availability${qs({ from: f.requestedCheckIn, to: f.requestedCheckOut, roomType: f.roomType, excludeBookingId: id })}` : null);
  const nights = nightsBetween(f.requestedCheckIn, f.requestedCheckOut);

  if (id && existing.loading && !existing.data) return <Spinner />;
  if (id && existing.data && !existing.data.can.edit) return <Notice tone="warning">This booking can no longer be edited.</Notice>;
  const returned = existing.data?.booking?.status === 'RETURNED';
  const lastReturn = existing.data?.timeline?.history?.filter((h: any) => h.action === 'RETURNED').at(-1);

  const save = async (submit: boolean) => {
    clear();
    setBusy(submit ? 'submit' : 'draft');
    try {
      const body = { ...f, numGuests: Number(f.numGuests), numRooms: Number(f.numRooms), guests: !id || guestsDirty ? f.guests.filter((g) => g.name.trim()) : undefined, submit };
      const r = id ? await api.put(`/api/hostel/bookings/${id}`, body) : await api.post('/api/hostel/bookings', body);
      setWarnings(r.warnings ?? []);
      toast('success', submit ? `Booking ${r.booking.bookingId} submitted.` : `Draft ${r.booking.bookingId} saved.`);
      if (r.warnings?.length) toast('info', r.warnings[0]);
      nav(submit ? `/hostels/bookings/${r.booking.id}` : `/hostels/bookings/${r.booking.id}/edit`, { replace: true });
      if (id && !submit) existing.reload();
    } catch (e) {
      capture(e);
    } finally {
      setBusy(null);
    }
  };

  const a = av.data;
  const short = a && (a.availableRooms < Number(f.numRooms) || a.availableCapacity < Number(f.numGuests));
  return (
    <>
      <PageHeader title={id ? `Edit booking ${existing.data?.booking?.bookingId ?? ''}` : 'Youth Hostel Booking Registration'} back={id ? `/hostels/bookings/${id}` : '/hostels/bookings'} />
      {returned && lastReturn && <div className="mb-4"><Notice tone="warning"><strong>Returned for correction</strong> by {lastReturn.actorName}: “{lastReturn.remarks}”</Notice></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <ErrorBox error={formError ? { message: formError } : null} />
          {warnings.map((w, i) => <Notice key={i} tone="warning">{w}</Notice>)}
          <Card id="bk-id" title="Booking identification">
            <Grid cols={3}>
              <Input label="Booking ID" value={existing.data?.booking?.bookingId ?? 'Generated automatically'} disabled />
              <Input label="Requested by" value={me?.email ?? ''} disabled />
              <Select label="District / HQ" required disabled={returned} value={f.districtId} onChange={(e) => set({ districtId: e.target.value })} error={errors.districtId} placeholder="Select…" options={districts.map((d) => ({ value: d.id, label: d.name }))} />
            </Grid>
          </Card>
          <Card id="bk-hostel" title="Hostel information">
            <Grid cols={2}>
              <Select label="Youth hostel" required value={f.hostelId} onChange={(e) => set({ hostelId: e.target.value })} error={errors.hostelId} placeholder="Select hostel…" options={hostels.map((h) => ({ value: h.id, label: `${h.name}${h.status !== 'OPERATIONAL' ? ` (${h.status.replace(/_/g, ' ').toLowerCase()})` : ''}` }))} />
              <Select label="Room type preference" value={f.roomType} onChange={(e) => set({ roomType: e.target.value })} error={errors.roomType} placeholder="Any room type" options={roomTypes.map((r) => ({ value: r.value, label: r.label }))} />
            </Grid>
            {hostel && (
              <div className="mt-4 rounded-lg bg-gray-50 p-3">
                <KV cols={3} items={[['Address', hostel.address], ['Hostel manager', hostel.manager ? `${hostel.manager.name}${hostel.manager.phone ? ` · ${hostel.manager.phone}` : ''}` : '—'], ['Facility type', hostel.facilityType?.name], ['Rooms in service', `${hostel.roomsInService} of ${hostel.totalRooms}`], ['Total beds', hostel.totalCapacity], ['District', hostel.district.name]]} />
              </div>
            )}
          </Card>
          <Card id="bk-dates" title="Booking dates">
            <Grid cols={3}>
              <Input label="Requested check-in" type="date" required min={todayISO()} value={f.requestedCheckIn} onChange={(e) => set({ requestedCheckIn: e.target.value, requestedCheckOut: f.requestedCheckOut <= e.target.value ? addDays(e.target.value, 1) : f.requestedCheckOut })} error={errors.requestedCheckIn} />
              <Input label="Requested check-out" type="date" required min={addDays(f.requestedCheckIn, 1)} value={f.requestedCheckOut} onChange={(e) => set({ requestedCheckOut: e.target.value })} error={errors.requestedCheckOut} />
              <Input label="Nights" value={validDates ? String(nights) : '—'} disabled />
            </Grid>
            {f.hostelId && validDates && (
              <div className="mt-3">
                {av.loading && !a ? <p className="text-sm text-ink-3">Checking availability…</p> : a && (
                  <Notice tone={short ? 'warning' : 'success'}>
                    <strong>{a.availableRooms}</strong> room(s) with <strong>{a.availableCapacity}</strong> bed(s) free for these dates{f.roomType ? ' (selected room type)' : ''}.
                    {a.outOfService > 0 && ` ${a.outOfService} room(s) out of service.`}
                    {a.pendingRooms > 0 && ` ${a.pendingRooms} room(s) are provisionally requested by other pending bookings.`}
                    {short && ' Your request exceeds current availability — it may be approved with different dates or declined.'}
                  </Notice>
                )}
              </div>
            )}
          </Card>
          <Card id="bk-guest" title="Guest information">
            <Grid cols={2}>
              <Input label="Guest name (lead guest)" required value={f.guestName} onChange={(e) => set({ guestName: e.target.value })} error={errors.guestName} />
              <Input label="CNIC / passport" required={!id} value={f.cnic} onChange={(e) => set({ cnic: e.target.value })} error={errors.cnic} placeholder={id ? `Unchanged (${existing.data?.booking?.cnic ?? ''})` : '12345-1234567-1'} hint="Stored encrypted; visible only to authorised officers." autoComplete="off" />
              <Input label="Mobile" required type="tel" value={f.mobile} onChange={(e) => set({ mobile: e.target.value })} error={errors.mobile} placeholder="03001234567" />
              <Input label="Organization" required value={f.organization} onChange={(e) => set({ organization: e.target.value })} error={errors.organization} />
              <Input label="Referred by" value={f.referredBy} onChange={(e) => set({ referredBy: e.target.value })} />
              <Input label="Referrer designation" value={f.referrerDesignation} onChange={(e) => set({ referrerDesignation: e.target.value })} />
              <Input label="Number of guests" required type="number" min={1} value={f.numGuests} onChange={(e) => set({ numGuests: e.target.value })} error={errors.numGuests} />
              <Input label="Number of rooms" required type="number" min={1} value={f.numRooms} onChange={(e) => set({ numRooms: e.target.value })} error={errors.numRooms} hint="Rooms and guests are counted separately — several guests can share a room." />
              <Textarea label="Purpose of visit" required wrapClass="sm:col-span-2" value={f.purpose} onChange={(e) => set({ purpose: e.target.value })} error={errors.purpose} />
            </Grid>
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium">Additional guests (optional){id && f.guests.length > 0 && <span className="ml-1 text-xs font-normal text-ink-3">— editing re-saves the list; re-enter ID numbers</span>}</p><Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={() => set({ guests: [...f.guests, { name: '', cnic: '', gender: '' }] })}>Add guest</Button></div>
              {f.guests.map((g, i) => (
                <div key={i} className="mb-2 grid items-end gap-2 sm:grid-cols-[1fr_1fr_140px_auto]">
                  <Input label={`Guest ${i + 2} name`} value={g.name} onChange={(e) => set({ guests: f.guests.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} error={errors[`guests.${i}.name`]} />
                  <Input label="CNIC / passport" value={g.cnic} onChange={(e) => set({ guests: f.guests.map((x, j) => (j === i ? { ...x, cnic: e.target.value } : x)) })} error={errors[`guests.${i}.cnic`]} />
                  <Select label="Gender" value={g.gender} onChange={(e) => set({ guests: f.guests.map((x, j) => (j === i ? { ...x, gender: e.target.value } : x)) })} placeholder="—" options={['Male', 'Female', 'Other'].map((v) => ({ value: v, label: v }))} />
                  <Button variant="ghost" aria-label="Remove guest" icon={<Trash2 className="size-4" />} onClick={() => set({ guests: f.guests.filter((_, j) => j !== i) })} />
                </div>
              ))}
            </div>
          </Card>
          <Card id="bk-docs" title="Remarks & supporting documents">
            <Textarea label="Requester remarks" value={f.requesterRemarks} onChange={(e) => set({ requesterRemarks: e.target.value })} />
            <div className="mt-4">
              {id ? (
                <>
                  <Uploader target="hostel-booking" entityId={id} kind="pdfimage" compact categories={[{ value: 'SUPPORTING', label: 'Supporting document' }]} onUploaded={existing.reload} />
                  <div className="mt-3"><AttachmentList files={existing.data?.booking?.files ?? []} onChanged={existing.reload} canRemove={(x) => x.uploadedBy.id === me?.id} /></div>
                </>
              ) : <Notice>Save as draft to attach supporting documents (PDF, JPG, JPEG, PNG).</Notice>}
            </div>
          </Card>
        </div>
        <div>
          <div className="space-y-4 lg:sticky lg:top-20">
            <Card title="Actions" className="hidden lg:block">
              <div className="space-y-2">
                <Button variant="secondary" className="w-full" loading={busy === 'draft'} onClick={() => save(false)} icon={<Save className="size-4" />}>Save draft</Button>
                <Button className="w-full" loading={busy === 'submit'} onClick={() => save(true)} icon={<Send className="size-4" />}>{returned ? 'Resubmit booking' : 'Submit booking'}</Button>
                <p className="pt-2 text-xs text-ink-3">A Booking ID is issued on save. On submission the booking is assigned to the reviewing officer and you receive a confirmation email.</p>
              </div>
            </Card>
            <div className="hidden lg:block">
              <SectionNav sections={[
                { id: 'bk-id', label: 'Booking identification', error: !!errors.districtId },
                { id: 'bk-hostel', label: 'Hostel information', error: !!errors.hostelId },
                { id: 'bk-dates', label: 'Booking dates', error: !!(errors.checkIn || errors.checkOut) },
                { id: 'bk-guest', label: 'Guest information', error: Object.keys(errors).some((k) => /guest|cnic|mobile|organization|purpose|num/i.test(k)) },
                { id: 'bk-docs', label: 'Remarks & documents' },
              ]} />
            </div>
          </div>
          <MobileActions>
            <Button variant="secondary" loading={busy === 'draft'} onClick={() => save(false)} icon={<Save className="size-4" />}>Save draft</Button>
            <Button loading={busy === 'submit'} onClick={() => save(true)} icon={<Send className="size-4" />}>{returned ? 'Resubmit' : 'Submit'}</Button>
          </MobileActions>
        </div>
      </div>
    </>
  );
}
