import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { clearCache, useApi, useDebounced, useDistricts, useLookups, useQueryState } from '../../lib/hooks';
import { fmtDate, toISODate } from '../../lib/format';
import { Badge, Button, Card, ErrorBox, Grid, Input, Modal, PageHeader, Select, Tabs, Textarea, useFormErrors, useToast } from '../../components/ui';
import { DataTable, ExportMenu, FilterBar, MiniSelect, SearchInput } from '../../components/DataTable';
import { LazyMap } from '../../components/Files';

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-[#2a78d6]" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="tabular text-xs">{value}%</span>
    </div>
  );
}

export default function Assets() {
  const { can } = useAuth();
  const nav = useNavigate();
  const districts = useDistricts();
  const statuses = useLookups('JM_PROJECT_STATUS');
  const [q, setQ] = useQueryState({ q: '', districtId: '', status: '', view: 'list' });
  const search = useDebounced(q.q);
  const { data, loading, reload } = useApi(`/api/jm/assets${qs({ q: search, districtId: q.districtId, status: q.status })}`);
  const [edit, setEdit] = useState<any | null>(() => (new URLSearchParams(location.search).get('new') === '1' ? {} : null));
  const rows = data?.rows ?? [];
  return (
    <>
      <PageHeader
        title="Jawan Markaz Asset Register"
        subtitle="Master records for every Jawan Markaz — progress and status are updated from verified monitoring reports."
        actions={<>{can('jm.export') && <ExportMenu url={(f) => `/api/jm/assets/export?format=${f}`} formats={['xlsx', 'csv', 'pdf']} />}{can('jm.asset.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setEdit({})}>Register asset</Button>}</>}
      />
      <Tabs value={q.view} onChange={(v) => setQ({ view: v })} tabs={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />
      <Card bodyClass="p-0">
        <FilterBar onReset={() => setQ({ q: '', districtId: '', status: '' })}>
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v })} placeholder="Asset ID, name, location…" />
          <MiniSelect label="District / HQ" value={q.districtId} onChange={(v) => setQ({ districtId: v })} options={districts.map((d) => ({ value: d.id, label: d.name }))} />
          <MiniSelect label="Project status" value={q.status} onChange={(v) => setQ({ status: v })} options={statuses.map((s) => ({ value: s.value, label: s.label }))} />
        </FilterBar>
        {q.view === 'map' ? (
          <div className="h-[520px]"><LazyMap points={rows.filter((a: any) => a.latitude != null).map((a: any) => ({ lat: a.latitude, lng: a.longitude, label: `${a.name} — ${a.overallProgress}%`, href: `/jm/assets/${a.id}` }))} /></div>
        ) : (
          <DataTable
            loading={loading}
            rows={rows}
            onRowClick={(a: any) => nav(`/jm/assets/${a.id}`)}
            columns={[
              { key: 'assetCode', header: 'Asset ID', render: (a: any) => <span className="font-mono text-xs">{a.assetCode}</span> },
              { key: 'name', header: 'Jawan Markaz', primary: true, render: (a: any) => <span className="font-medium">{a.name}</span> },
              { key: 'district', header: 'District / HQ', render: (a: any) => a.district.name },
              { key: 'status', header: 'Status', render: (a: any) => <Badge status={a.currentStatus} label={statuses.find((s) => s.value === a.currentStatus)?.label} /> },
              { key: 'progress', header: 'Progress', render: (a: any) => <ProgressBar value={a.overallProgress} /> },
              { key: 'planned', header: 'Planned completion', render: (a: any) => fmtDate(a.revisedCompletionDate ?? a.plannedCompletionDate) },
              { key: 'lastInspectionDate', header: 'Last inspection', render: (a: any) => fmtDate(a.lastInspectionDate) },
              { key: 'reports', header: 'Reports', render: (a: any) => a._count.reports },
              { key: 'issues', header: 'Open issues', render: (a: any) => (a._count.issues ? <Badge tone="amber" label={String(a._count.issues)} /> : '0') },
            ]}
          />
        )}
      </Card>
      {edit && <AssetModal asset={edit} onClose={() => setEdit(null)} onDone={() => { clearCache('/api/jm'); reload(); }} />}
    </>
  );
}

export function AssetModal({ asset, onClose, onDone }: { asset: any; onClose: () => void; onDone: () => void }) {
  const districts = useDistricts();
  const statuses = useLookups('JM_PROJECT_STATUS');
  const [f, setF] = useState<any>({
    name: asset.name ?? '', districtId: asset.districtId ?? '', location: asset.location ?? '', latitude: asset.latitude ?? '', longitude: asset.longitude ?? '',
    projectStartDate: toISODate(asset.projectStartDate), plannedCompletionDate: toISODate(asset.plannedCompletionDate), revisedCompletionDate: toISODate(asset.revisedCompletionDate),
    approvedCost: asset.approvedCost ?? '', contractor: asset.contractor ?? '', supervisingDepartment: asset.supervisingDepartment ?? '', supervisingOfficer: asset.supervisingOfficer ?? '',
    currentStatus: asset.currentStatus ?? 'NOT_STARTED', overallProgress: asset.overallProgress ?? 0, remarks: asset.remarks ?? '', isActive: asset.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);
  const fe = useFormErrors();
  const toast = useToast();
  const set = (p: any) => setF({ ...f, ...p });
  const save = async () => {
    setBusy(true);
    fe.clear();
    try {
      if (asset.id) await api.put(`/api/jm/assets/${asset.id}`, f);
      else await api.post('/api/jm/assets', f);
      toast('success', 'Asset saved.');
      onDone();
      onClose();
    } catch (e) { fe.capture(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={asset.id ? `Edit ${asset.assetCode}` : 'Register Jawan Markaz asset'} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
      <Grid cols={2} className="mt-2">
        <Input label="Asset ID" value={asset.assetCode ?? 'Generated automatically'} disabled />
        <Input label="Jawan Markaz / asset name" required value={f.name} onChange={(e) => set({ name: e.target.value })} error={fe.errors.name} />
        <Select label="District / HQ" required value={f.districtId} onChange={(e) => set({ districtId: e.target.value })} error={fe.errors.districtId} placeholder="Select…" options={districts.map((d) => ({ value: d.id, label: d.name }))} />
        <Input label="Asset location" required value={f.location} onChange={(e) => set({ location: e.target.value })} error={fe.errors.location} />
        <Input label="GPS latitude" inputMode="decimal" value={f.latitude} onChange={(e) => set({ latitude: e.target.value })} error={fe.errors.latitude} />
        <Input label="GPS longitude" inputMode="decimal" value={f.longitude} onChange={(e) => set({ longitude: e.target.value })} error={fe.errors.longitude} />
        <Input label="Project start date" type="date" value={f.projectStartDate} onChange={(e) => set({ projectStartDate: e.target.value })} />
        <Input label="Planned completion date" type="date" value={f.plannedCompletionDate} onChange={(e) => set({ plannedCompletionDate: e.target.value })} />
        <Input label="Revised completion date" type="date" value={f.revisedCompletionDate} onChange={(e) => set({ revisedCompletionDate: e.target.value })} />
        <Input label="Approved project cost (PKR)" type="number" min={0} value={f.approvedCost} onChange={(e) => set({ approvedCost: e.target.value })} />
        <Input label="Project contractor" value={f.contractor} onChange={(e) => set({ contractor: e.target.value })} />
        <Input label="Supervising department" value={f.supervisingDepartment} onChange={(e) => set({ supervisingDepartment: e.target.value })} />
        <Input label="Supervising officer" value={f.supervisingOfficer} onChange={(e) => set({ supervisingOfficer: e.target.value })} />
        <Select label="Current project status" value={f.currentStatus} onChange={(e) => set({ currentStatus: e.target.value })} options={statuses.map((s) => ({ value: s.value, label: s.label }))} />
        <Input label="Overall progress %" type="number" min={0} max={100} value={f.overallProgress} onChange={(e) => set({ overallProgress: e.target.value })} hint="Normally updated automatically from verified reports" />
        <Select label="Record status" value={f.isActive ? '1' : '0'} onChange={(e) => set({ isActive: e.target.value === '1' })} options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]} />
        <Textarea label="General remarks" wrapClass="sm:col-span-2" value={f.remarks} onChange={(e) => set({ remarks: e.target.value })} />
      </Grid>
    </Modal>
  );
}
