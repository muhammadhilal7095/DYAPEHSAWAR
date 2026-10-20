import { useState } from 'react';
import { Pencil, Plus, Unlock } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useApi, useCached, useDebounced, useDistricts, useQueryState } from '../../lib/hooks';
import { fmtDateTime } from '../../lib/format';
import { Badge, Button, Card, Checkbox, ErrorBox, Grid, Input, Modal, Notice, PageHeader, Pagination, Select, Tabs, Textarea, useFormErrors, useToast } from '../../components/ui';
import { DataTable, FilterBar, MiniSelect, SearchInput } from '../../components/DataTable';
import { PASSWORD_HINT } from '../auth/ResetPassword';

export default function Users() {
  const [q, setQ] = useQueryState({ tab: 'users', q: '', roleId: '', districtId: '', active: '', page: '1' });
  const search = useDebounced(q.q);
  const districts = useDistricts();
  const roles = useApi<any[]>('/api/admin/roles');
  const { data, loading, reload } = useApi(q.tab === 'users' ? `/api/admin/users${qs({ ...q, q: search, tab: '' })}` : null);
  const [edit, setEdit] = useState<any | null>(null);
  const [role, setRole] = useState<any | null>(null);
  const toast = useToast();
  return (
    <>
      <PageHeader title="Users & Roles" subtitle="User accounts, district assignment and role-based permissions (enforced by the server)."
        actions={q.tab === 'users' ? <Button icon={<Plus className="size-4" />} onClick={() => setEdit({ isActive: true, roleIds: [] })}>Add user</Button> : <Button icon={<Plus className="size-4" />} onClick={() => setRole({ permissions: [] })}>Add role</Button>} />
      <Tabs value={q.tab} onChange={(v) => setQ({ tab: v })} tabs={[{ value: 'users', label: 'Users' }, { value: 'roles', label: 'Roles & permissions' }]} />
      {q.tab === 'users' ? (
        <Card bodyClass="p-0">
          <FilterBar onReset={() => setQ({ q: '', roleId: '', districtId: '', active: '' })}>
            <SearchInput value={q.q} onChange={(v) => setQ({ q: v })} placeholder="Name, email, designation…" />
            <MiniSelect label="Role" value={q.roleId} onChange={(v) => setQ({ roleId: v })} options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))} />
            <MiniSelect label="District / HQ" value={q.districtId} onChange={(v) => setQ({ districtId: v })} options={districts.map((d) => ({ value: d.id, label: d.name }))} />
            <MiniSelect label="Status" value={q.active} onChange={(v) => setQ({ active: v })} options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Deactivated' }]} />
          </FilterBar>
          <DataTable loading={loading} rows={data?.rows} columns={[
            { key: 'name', header: 'Name', primary: true, render: (u: any) => <span><span className="font-medium">{u.name}</span><span className="block text-xs text-ink-3">{u.email}</span></span> },
            { key: 'designation', header: 'Designation', render: (u: any) => u.designation ?? '—' },
            { key: 'district', header: 'District / HQ', render: (u: any) => u.district?.name ?? '—' },
            { key: 'roles', header: 'Roles', render: (u: any) => <div className="flex flex-wrap gap-1">{u.roles.map((r: any) => <span key={r.id} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{r.name}</span>)}</div> },
            { key: 'status', header: 'Status', render: (u: any) => <div className="flex flex-col items-start gap-1"><Badge status={u.isActive ? 'ACTIVE' : 'CANCELLED'} label={u.isActive ? 'Active' : 'Deactivated'} />{u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge tone="red" label="Locked" />}</div> },
            { key: 'lastLoginAt', header: 'Last sign-in', render: (u: any) => <span className="text-xs">{fmtDateTime(u.lastLoginAt)}</span> },
            { key: 'a', header: '', render: (u: any) => <div className="flex gap-1">
              <Button size="sm" variant="ghost" aria-label="Edit user" icon={<Pencil className="size-4" />} onClick={() => setEdit({ ...u, districtId: u.district?.id ?? '', departmentId: u.department?.id ?? '', roleIds: u.roles.map((r: any) => r.id) })} />
              {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Button size="sm" variant="ghost" aria-label="Unlock" icon={<Unlock className="size-4" />} onClick={async () => { await api.post(`/api/admin/users/${u.id}/unlock`); toast('success', 'Unlocked'); reload(); }} />}
            </div> },
          ]} />
          {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ page: String(p) })} />}
        </Card>
      ) : (
        <Card bodyClass="p-0">
          <DataTable rows={roles.data ?? undefined} loading={roles.loading} columns={[
            { key: 'name', header: 'Role', primary: true, render: (r: any) => <span><span className="font-medium">{r.name}</span><span className="block font-mono text-xs text-ink-3">{r.key}</span></span> },
            { key: 'description', header: 'Description' },
            { key: 'perms', header: 'Permissions', render: (r: any) => `${(r.permissions as string[]).length}` },
            { key: 'users', header: 'Users', render: (r: any) => r._count.users },
            { key: 'sys', header: '', render: (r: any) => r.isSystem && <Badge tone="gray" label="System" /> },
            { key: 'a', header: '', render: (r: any) => <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setRole(r)}>Edit</Button> },
          ]} />
        </Card>
      )}
      {edit && <UserModal user={edit} roles={roles.data ?? []} onClose={() => setEdit(null)} onDone={reload} />}
      {role && <RoleModal role={role} onClose={() => setRole(null)} onDone={roles.reload} />}
    </>
  );
}

function UserModal({ user, roles, onClose, onDone }: any) {
  const districts = useDistricts();
  const departments = useCached<any[]>('/api/admin/departments') ?? [];
  const [f, setF] = useState({ name: user.name ?? '', email: user.email ?? '', designation: user.designation ?? '', phone: user.phone ?? '', districtId: user.districtId ?? '', departmentId: user.departmentId ?? '', roleIds: user.roleIds as string[], isActive: user.isActive, password: '' });
  const [temp, setTemp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fe = useFormErrors();
  const save = async () => {
    setBusy(true);
    fe.clear();
    try {
      if (user.id) { await api.put(`/api/admin/users/${user.id}`, f); onDone(); onClose(); }
      else { const r = await api.post('/api/admin/users', f); onDone(); if (r.temporaryPassword) setTemp(r.temporaryPassword); else onClose(); }
    } catch (e) { fe.capture(e); } finally { setBusy(false); }
  };
  if (temp) return (
    <Modal open onClose={onClose} title="User created" size="sm" footer={<Button onClick={onClose}>Done</Button>}>
      <Notice tone="success">Share this temporary password securely. The user must change it at first sign-in.</Notice>
      <p className="mt-3 rounded-lg bg-gray-100 p-3 text-center font-mono text-lg">{temp}</p>
    </Modal>
  );
  return (
    <Modal open onClose={onClose} title={user.id ? `Edit ${user.name}` : 'Add user'} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
      <Grid cols={2} className="mt-2">
        <Input label="Full name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={fe.errors.name} />
        <Input label="Email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={fe.errors.email} />
        <Input label="Designation" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} />
        <Input label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <Select label="District / HQ" value={f.districtId} onChange={(e) => setF({ ...f, districtId: e.target.value })} placeholder="—" options={districts.map((d) => ({ value: d.id, label: d.name }))} hint="Used for district-scoped approval levels and visibility" />
        <Select label="Department" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })} placeholder="—" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
        <Input label={user.id ? 'Reset password (optional)' : 'Initial password (optional)'} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} error={fe.errors.password} hint={user.id ? 'Leave blank to keep the current password' : `Leave blank to generate a temporary password. ${PASSWORD_HINT}`} />
        <Select label="Account status" value={f.isActive ? '1' : '0'} onChange={(e) => setF({ ...f, isActive: e.target.value === '1' })} options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Deactivated (signs out immediately)' }]} />
      </Grid>
      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium text-ink-2">Roles {fe.errors.roleIds && <span className="text-xs text-red-600">— {fe.errors.roleIds}</span>}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {roles.map((r: any) => <Checkbox key={r.id} checked={f.roleIds.includes(r.id)} onChange={(v) => setF({ ...f, roleIds: v ? [...f.roleIds, r.id] : f.roleIds.filter((x) => x !== r.id) })} label={r.name} hint={r.description} />)}
        </div>
      </fieldset>
    </Modal>
  );
}

function RoleModal({ role, onClose, onDone }: any) {
  const perms = useApi<any[]>('/api/admin/permissions').data ?? [];
  const [f, setF] = useState({ key: role.key ?? '', name: role.name ?? '', description: role.description ?? '', permissions: (role.permissions as string[]) ?? [] });
  const fe = useFormErrors();
  const [busy, setBusy] = useState(false);
  const groups = perms.reduce((m: Record<string, any[]>, p) => { const g = p.key.split('.')[0]; (m[g] ??= []).push(p); return m; }, {});
  const GROUP: Record<string, string> = { admin: 'Administration', audit: 'Audit', email: 'Email', workflow: 'Workflow', daamr: 'DAAMR', hostel: 'Youth Hostels', jm: 'Jawan Markaz' };
  const save = async () => {
    setBusy(true);
    try {
      if (role.id) await api.put(`/api/admin/roles/${role.id}`, f);
      else await api.post('/api/admin/roles', f);
      onDone();
      onClose();
    } catch (e) { fe.capture(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={role.id ? `Edit role: ${role.name}` : 'Add role'} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
      <Grid cols={2} className="mt-2">
        <Input label="Key" value={f.key} disabled={role.isSystem} onChange={(e) => setF({ ...f, key: e.target.value })} error={fe.errors.key} hint="lowercase_with_underscores" />
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={fe.errors.name} />
        <Textarea label="Description" wrapClass="sm:col-span-2" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Grid>
      <div className="mt-4 space-y-4">
        {Object.entries(groups).map(([g, list]) => (
          <fieldset key={g} className="rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold">{GROUP[g] ?? g}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(list as any[]).map((p) => <Checkbox key={p.key} checked={f.permissions.includes(p.key)} onChange={(v) => setF({ ...f, permissions: v ? [...f.permissions, p.key] : f.permissions.filter((x) => x !== p.key) })} label={p.label} hint={p.key} />)}
            </div>
          </fieldset>
        ))}
      </div>
    </Modal>
  );
}
