import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { clearCache, useApi } from '../../lib/hooks';
import { humanize } from '../../lib/format';
import { Badge, Button, Card, ErrorBox, Input, Modal, PageHeader, Select, Tabs, useFormErrors } from '../../components/ui';
import { DataTable } from '../../components/DataTable';

export default function Org() {
  const [tab, setTab] = useState('districts');
  const districts = useApi<any[]>('/api/admin/districts?all=true');
  const departments = useApi<any[]>('/api/admin/departments?all=true');
  const [edit, setEdit] = useState<any | null>(null);
  const done = () => { clearCache('/api/admin/d'); districts.reload(); departments.reload(); };
  return (
    <>
      <PageHeader title="Districts, Headquarters & Departments" subtitle="Organisational units used for request routing, district-scoped approvals and reporting." actions={<Button icon={<Plus className="size-4" />} onClick={() => setEdit(tab === 'districts' ? { type: 'DISTRICT', isActive: true } : { isActive: true, _dept: true })}>Add {tab === 'districts' ? 'district / HQ' : 'department'}</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'districts', label: 'Districts & HQ', count: districts.data?.length }, { value: 'departments', label: 'Departments', count: departments.data?.length }]} />
      <Card bodyClass="p-0">
        {tab === 'districts' ? (
          <DataTable loading={districts.loading} rows={districts.data ?? undefined} columns={[
            { key: 'name', header: 'Name', primary: true, render: (d: any) => <span className="font-medium">{d.name}</span> },
            { key: 'code', header: 'Code', render: (d: any) => d.code ?? '—' },
            { key: 'type', header: 'Type', render: (d: any) => humanize(d.type) },
            { key: 'region', header: 'Region', render: (d: any) => d.region ?? '—' },
            { key: 'users', header: 'Users', render: (d: any) => d._count.users },
            { key: 'isActive', header: 'Status', render: (d: any) => <Badge status={d.isActive ? 'ACTIVE' : 'CANCELLED'} label={d.isActive ? 'Active' : 'Inactive'} /> },
            { key: 'a', header: '', render: (d: any) => <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit(d)}>Edit</Button> },
          ]} />
        ) : (
          <DataTable loading={departments.loading} rows={departments.data ?? undefined} columns={[
            { key: 'name', header: 'Department', primary: true },
            { key: 'district', header: 'District / HQ', render: (d: any) => d.district?.name ?? 'All (organisation-wide)' },
            { key: 'isActive', header: 'Status', render: (d: any) => <Badge status={d.isActive ? 'ACTIVE' : 'CANCELLED'} label={d.isActive ? 'Active' : 'Inactive'} /> },
            { key: 'a', header: '', render: (d: any) => <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit({ ...d, _dept: true })}>Edit</Button> },
          ]} />
        )}
      </Card>
      {edit && <OrgModal value={edit} districts={districts.data ?? []} onClose={() => setEdit(null)} onDone={done} />}
    </>
  );
}

function OrgModal({ value, districts, onClose, onDone }: any) {
  const dept = !!value._dept;
  const [f, setF] = useState<any>(dept ? { name: value.name ?? '', districtId: value.districtId ?? '', isActive: value.isActive } : { name: value.name ?? '', code: value.code ?? '', type: value.type ?? 'DISTRICT', region: value.region ?? '', isActive: value.isActive });
  const fe = useFormErrors();
  const save = async () => {
    try {
      const base = dept ? '/api/admin/departments' : '/api/admin/districts';
      if (value.id) await api.put(`${base}/${value.id}`, f);
      else await api.post(base, f);
      onDone();
      onClose();
    } catch (e) { fe.capture(e); }
  };
  return (
    <Modal open onClose={onClose} title={`${value.id ? 'Edit' : 'Add'} ${dept ? 'department' : 'district / HQ'}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
        <Input label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={fe.errors.name} />
        {dept ? (
          <Select label="District / HQ" value={f.districtId} onChange={(e) => setF({ ...f, districtId: e.target.value })} placeholder="All (organisation-wide)" options={districts.map((d: any) => ({ value: d.id, label: d.name }))} />
        ) : (
          <>
            <Input label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} error={fe.errors.code} />
            <Select label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={[{ value: 'DISTRICT', label: 'District' }, { value: 'HQ', label: 'Headquarters' }, { value: 'REGION', label: 'Region' }]} />
            <Input label="Region / division" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} />
          </>
        )}
        <Select label="Status" value={f.isActive ? '1' : '0'} onChange={(e) => setF({ ...f, isActive: e.target.value === '1' })} options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]} />
      </div>
    </Modal>
  );
}
