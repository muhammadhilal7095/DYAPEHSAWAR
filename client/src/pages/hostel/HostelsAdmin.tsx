import { useState } from 'react';
import { Pencil, Plus, Rows3, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { clearCache, useApi, useDistricts, useLookups } from '../../lib/hooks';
import { humanize } from '../../lib/format';
import { Badge, Button, Card, ErrorBox, Grid, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, useConfirm, useFormErrors, useToast } from '../../components/ui';
import { DataTable } from '../../components/DataTable';

export default function HostelsAdmin() {
  const [tab, setTab] = useState('hostels');
  const { data: hostels, loading, reload } = useApi<any[]>('/api/hostel/hostels?all=true');
  const types = useApi<any[]>('/api/hostel/facility-types?all=true');
  const [edit, setEdit] = useState<any | null>(null);
  const [roomsOf, setRoomsOf] = useState<string | null>(null);
  const [ft, setFt] = useState<any | null>(null);
  const refresh = () => { clearCache('/api/hostel'); reload(); types.reload(); };
  return (
    <>
      <PageHeader title="Hostels & Rooms" subtitle="Register hostels, define rooms and capacities, and manage facility types." actions={tab === 'hostels' ? <Button icon={<Plus className="size-4" />} onClick={() => setEdit({})}>Add hostel</Button> : <Button icon={<Plus className="size-4" />} onClick={() => setFt({ isActive: true })}>Add facility type</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'hostels', label: 'Youth hostels' }, { value: 'types', label: 'Facility types' }]} />
      {tab === 'hostels' ? (
        <Card bodyClass="p-0">
          <DataTable
            loading={loading}
            rows={hostels ?? undefined}
            columns={[
              { key: 'name', header: 'Hostel', primary: true, render: (h: any) => <span className="font-medium">{h.name}</span> },
              { key: 'district', header: 'District', render: (h: any) => h.district.name },
              { key: 'facilityType', header: 'Facility type', render: (h: any) => h.facilityType?.name ?? '—' },
              { key: 'manager', header: 'Manager', render: (h: any) => h.manager?.name ?? <span className="text-amber-700">Not assigned</span> },
              { key: 'rooms', header: 'Rooms (in service)', render: (h: any) => `${h.totalRooms} (${h.roomsInService})` },
              { key: 'cap', header: 'Beds', render: (h: any) => h.totalCapacity },
              { key: 'types', header: 'Room types', render: (h: any) => Object.entries(h.roomTypes).map(([t, n]) => `${n}× ${humanize(t)}`).join(', ') || '—' },
              { key: 'status', header: 'Status', render: (h: any) => <Badge status={h.status} /> },
              { key: 'act', header: '', render: (h: any) => <div className="flex gap-1"><Button size="sm" variant="secondary" icon={<Rows3 className="size-4" />} onClick={() => setRoomsOf(h.id)}>Rooms</Button><Button size="sm" variant="ghost" aria-label="Edit hostel" icon={<Pencil className="size-4" />} onClick={() => setEdit(h)} /></div> },
            ]}
          />
        </Card>
      ) : (
        <Card bodyClass="p-0">
          <DataTable rows={types.data ?? undefined} loading={types.loading} columns={[
            { key: 'name', header: 'Facility type', primary: true },
            { key: 'description', header: 'Description' },
            { key: 'n', header: 'Hostels', render: (t: any) => t._count.hostels },
            { key: 'isActive', header: 'Status', render: (t: any) => <Badge status={t.isActive ? 'ACTIVE' : 'CANCELLED'} label={t.isActive ? 'Active' : 'Inactive'} /> },
            { key: 'a', header: '', render: (t: any) => <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setFt(t)}>Edit</Button> },
          ]} />
        </Card>
      )}
      {edit && <HostelModal hostel={edit} types={types.data ?? []} onClose={() => setEdit(null)} onDone={refresh} />}
      {roomsOf && <RoomsModal hostelId={roomsOf} onClose={() => { setRoomsOf(null); refresh(); }} />}
      {ft && <FacilityTypeModal value={ft} onClose={() => setFt(null)} onDone={refresh} />}
    </>
  );
}

function HostelModal({ hostel, types, onClose, onDone }: any) {
  const districts = useDistricts();
  const managers = useApi<any[]>('/api/admin/directory?roleKey=hostel_manager').data ?? [];
  const [f, setF] = useState({ name: hostel.name ?? '', districtId: hostel.districtId ?? '', address: hostel.address ?? '', facilityTypeId: hostel.facilityTypeId ?? '', managerId: hostel.managerId ?? '', contactPhone: hostel.contactPhone ?? '', contactEmail: hostel.contactEmail ?? '', status: hostel.status ?? 'OPERATIONAL', description: hostel.description ?? '' });
  const [busy, setBusy] = useState(false);
  const { errors, formError, capture } = useFormErrors();
  const toast = useToast();
  const save = async () => {
    setBusy(true);
    try {
      if (hostel.id) await api.put(`/api/hostel/hostels/${hostel.id}`, f);
      else await api.post('/api/hostel/hostels', f);
      toast('success', 'Hostel saved.');
      onDone();
      onClose();
    } catch (e) { capture(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={hostel.id ? `Edit ${hostel.name}` : 'Add youth hostel'} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <ErrorBox error={formError ? { message: formError } : null} />
      <Grid cols={2} className="mt-2">
        <Input label="Hostel name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errors.name} />
        <Select label="District" required value={f.districtId} onChange={(e) => setF({ ...f, districtId: e.target.value })} error={errors.districtId} placeholder="Select…" options={districts.map((d) => ({ value: d.id, label: d.name }))} />
        <Input label="Address" required wrapClass="sm:col-span-2" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} error={errors.address} />
        <Select label="Facility type" value={f.facilityTypeId} onChange={(e) => setF({ ...f, facilityTypeId: e.target.value })} placeholder="—" options={types.map((t: any) => ({ value: t.id, label: t.name }))} />
        <Select label="Hostel manager" value={f.managerId} onChange={(e) => setF({ ...f, managerId: e.target.value })} placeholder="—" options={managers.map((m) => ({ value: m.id, label: `${m.name}${m.district ? ` (${m.district.name})` : ''}` }))} hint="Users with the Hostel Manager role" />
        <Input label="Contact phone" value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} />
        <Input label="Contact email" type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} error={errors.contactEmail} />
        <Select label="Operational status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={['OPERATIONAL', 'UNDER_MAINTENANCE', 'CLOSED'].map((s) => ({ value: s, label: humanize(s) }))} />
        <Textarea label="Description / facilities" wrapClass="sm:col-span-2" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Grid>
    </Modal>
  );
}

function RoomsModal({ hostelId, onClose }: { hostelId: string; onClose: () => void }) {
  const { data: h, reload } = useApi(`/api/hostel/hostels/${hostelId}`);
  const roomTypes = useLookups('ROOM_TYPE');
  const [room, setRoom] = useState<any | null>(null);
  const [bulk, setBulk] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const fe = useFormErrors();
  const toast = useToast();
  const confirm = useConfirm();
  const saveRoom = async () => {
    setBusy(true);
    fe.clear();
    try {
      const body = { roomNumber: room.roomNumber, roomType: room.roomType, capacity: Number(room.capacity), status: room.status, notes: room.notes };
      if (room.id) {
        const res = await fetch(`/api/hostel/rooms/${room.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(body) });
        const j = await res.json();
        if (!res.ok) throw Object.assign(new Error(j.error), { fields: j.details?.fields ?? {} });
        const w = res.headers.get('X-Warning');
        if (w) toast('info', w);
      } else await api.post(`/api/hostel/hostels/${hostelId}/rooms`, body);
      setRoom(null);
      reload();
    } catch (e) { fe.capture(e); } finally { setBusy(false); }
  };
  const saveBulk = async () => {
    setBusy(true);
    fe.clear();
    try {
      const r = await api.post(`/api/hostel/hostels/${hostelId}/rooms`, { ...bulk, bulk: true });
      toast('success', `${r.created} rooms added.`);
      setBulk(null);
      reload();
    } catch (e) { fe.capture(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Rooms — ${h?.name ?? ''}`} size="xl">
      {!h ? <Spinner /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-ink-2">{h.totalRooms} rooms · {h.totalCapacity} beds · {h.roomsInService} in service</p>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setBulk({ prefix: '', start: 1, count: 5, roomType: roomTypes[0]?.value ?? '', capacity: 2, status: 'AVAILABLE' })}>Bulk add</Button>
              <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setRoom({ roomNumber: '', roomType: roomTypes[0]?.value ?? '', capacity: 2, status: 'AVAILABLE', notes: '' })}>Add room</Button>
            </div>
          </div>
          {(room || bulk) && (
            <div className="rounded-lg border border-line bg-gray-50 p-3">
              <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
              {room && (
                <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_100px_1fr_auto]">
                  <Input label="Room number" value={room.roomNumber} onChange={(e) => setRoom({ ...room, roomNumber: e.target.value })} error={fe.errors.roomNumber} />
                  <Select label="Room type" value={room.roomType} onChange={(e) => setRoom({ ...room, roomType: e.target.value })} options={roomTypes.map((t) => ({ value: t.value, label: t.label }))} />
                  <Input label="Capacity" type="number" min={1} value={room.capacity} onChange={(e) => setRoom({ ...room, capacity: e.target.value })} error={fe.errors.capacity} />
                  <Select label="Status" value={room.status} onChange={(e) => setRoom({ ...room, status: e.target.value })} options={['AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE'].map((s) => ({ value: s, label: humanize(s) }))} />
                  <div className="flex gap-1"><Button loading={busy} onClick={saveRoom}>Save</Button><Button variant="ghost" onClick={() => setRoom(null)}>Cancel</Button></div>
                </div>
              )}
              {bulk && (
                <div className="grid items-end gap-3 sm:grid-cols-[80px_80px_80px_1fr_80px_auto]">
                  <Input label="Prefix" value={bulk.prefix} onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })} />
                  <Input label="Start no." type="number" value={bulk.start} onChange={(e) => setBulk({ ...bulk, start: e.target.value })} />
                  <Input label="Count" type="number" value={bulk.count} onChange={(e) => setBulk({ ...bulk, count: e.target.value })} />
                  <Select label="Room type" value={bulk.roomType} onChange={(e) => setBulk({ ...bulk, roomType: e.target.value })} options={roomTypes.map((t) => ({ value: t.value, label: t.label }))} />
                  <Input label="Capacity" type="number" value={bulk.capacity} onChange={(e) => setBulk({ ...bulk, capacity: e.target.value })} />
                  <div className="flex gap-1"><Button loading={busy} onClick={saveBulk}>Add</Button><Button variant="ghost" onClick={() => setBulk(null)}>Cancel</Button></div>
                </div>
              )}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-ink-3"><tr><th className="px-3 py-2">Room</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Capacity</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" /></tr></thead>
              <tbody className="divide-y divide-line">
                {h.rooms.map((r: any) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-medium">{r.roomNumber}</td>
                    <td className="px-3 py-2">{roomTypes.find((t) => t.value === r.roomType)?.label ?? r.roomType}</td>
                    <td className="px-3 py-2">{r.capacity}</td>
                    <td className="px-3 py-2"><Badge status={r.status} /></td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" aria-label="Edit room" icon={<Pencil className="size-4" />} onClick={() => setRoom(r)} />
                      <Button size="sm" variant="ghost" aria-label="Delete room" icon={<Trash2 className="size-4 text-red-600" />} onClick={async () => {
                        if (!(await confirm({ title: `Delete room ${r.roomNumber}?`, message: 'Rooms with reservation history cannot be deleted — mark them Unavailable instead.', confirmLabel: 'Delete', tone: 'danger' }))) return;
                        try { await api.del(`/api/hostel/rooms/${r.id}`); reload(); } catch (e: any) { toast('error', e.message); }
                      }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function FacilityTypeModal({ value, onClose, onDone }: any) {
  const [f, setF] = useState({ name: value.name ?? '', description: value.description ?? '', isActive: value.isActive ?? true });
  const fe = useFormErrors();
  const save = async () => {
    try {
      if (value.id) await api.put(`/api/hostel/facility-types/${value.id}`, f);
      else await api.post('/api/hostel/facility-types', f);
      onDone();
      onClose();
    } catch (e) { fe.capture(e); }
  };
  return (
    <Modal open onClose={onClose} title={value.id ? 'Edit facility type' : 'Add facility type'} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={fe.errors.name} />
        <Textarea label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <Select label="Status" value={f.isActive ? '1' : '0'} onChange={(e) => setF({ ...f, isActive: e.target.value === '1' })} options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]} />
      </div>
    </Modal>
  );
}
