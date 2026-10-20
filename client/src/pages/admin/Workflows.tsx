import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useApi, useDistricts } from '../../lib/hooks';
import { fmtDateTime } from '../../lib/format';
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Grid, Input, Modal, Notice, PageHeader, Select, Spinner, Textarea, useFormErrors, useToast } from '../../components/ui';

export default function Workflows() {
  const { data, loading, reload } = useApi('/api/admin/workflows');
  const [edit, setEdit] = useState<any | null>(null);
  if (loading && !data) return <Spinner />;
  const modules = data?.modules ?? {};
  return (
    <>
      <PageHeader title="Approval Workflow Configuration" subtitle="Define the sequential approval levels, approving officers or roles, and rules for each module. A district-specific workflow overrides the default for that district." actions={<Button icon={<Plus className="size-4" />} onClick={() => setEdit({ module: 'DAAMR_REQUEST', isActive: true, resubmitPolicy: 'RESTART', levels: [] })}>New workflow</Button>} />
      <div className="space-y-6">
        {Object.entries(modules).map(([mod, label]) => {
          const defs = data.definitions.filter((d: any) => d.module === mod);
          return (
            <section key={mod}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-3">{label as string}</h2>
              {!defs.length ? <Card><Empty title="No workflow configured">Submissions for this module will be blocked until a workflow is created.</Empty></Card> : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {defs.map((d: any) => (
                    <Card key={d.id} title={<span className="flex items-center gap-2">{d.name}{d.isActive ? <Badge tone="green" label="Active" /> : <Badge tone="gray" label="Inactive" />}</span>} subtitle={`${d.district ? `District: ${d.district.name}` : 'Default (all districts)'} · resubmission ${d.resubmitPolicy === 'RESTART' ? 'restarts at level 1' : 'resumes at the returning level'} · updated ${fmtDateTime(d.updatedAt)}`} actions={<Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEdit(d)}>Edit</Button>}>
                      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
                        <li className="rounded-md bg-gray-100 px-2 py-1 text-xs">Submitter</li>
                        {d.levels.map((l: any) => (
                          <li key={l.id} className="flex items-center gap-1.5">
                            <ChevronRight className="size-4 text-ink-3" />
                            <span className="rounded-md border border-line bg-white px-2 py-1">
                              <span className="font-medium">{l.order}. {l.name}</span>
                              <span className="block text-xs text-ink-3">{l.approverType === 'USER' ? l.approverUser?.name : l.approverType === 'RESPONSIBLE_OFFICER' ? 'Responsible (lead) staff member' : `Role: ${l.approverRole?.name}`}{l.districtScope === 'SAME_DISTRICT' ? ' · same district' : ''}</span>
                            </span>
                          </li>
                        ))}
                        <li className="flex items-center gap-1.5"><ChevronRight className="size-4 text-ink-3" /><span className="rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700">Approved</span></li>
                      </ol>
                      {d._count.instances > 0 && <p className="mt-3 text-xs text-amber-800">{d._count.instances} item(s) currently in this workflow.</p>}
                    </Card>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {edit && <WorkflowEditor def={edit} modules={modules} onClose={() => setEdit(null)} onDone={reload} />}
    </>
  );
}

function WorkflowEditor({ def, modules, onClose, onDone }: any) {
  const districts = useDistricts();
  const roles = useApi<any[]>('/api/admin/roles').data ?? [];
  const users = useApi<any[]>('/api/admin/directory').data ?? [];
  const [f, setF] = useState<any>({
    module: def.module, name: def.name ?? '', description: def.description ?? '', districtId: def.districtId ?? '', isActive: def.isActive, resubmitPolicy: def.resubmitPolicy,
    levels: (def.levels ?? []).map((l: any) => ({ id: l.id, name: l.name, designation: l.designation ?? '', approverType: l.approverType, approverUserId: l.approverUserId ?? '', approverRoleId: l.approverRoleId ?? '', districtScope: l.districtScope, allowReject: l.allowReject, allowReturn: l.allowReturn, allowReassign: l.allowReassign, canAmendDates: l.canAmendDates })),
  });
  const [busy, setBusy] = useState(false);
  const fe = useFormErrors();
  const toast = useToast();
  const upd = (i: number, p: any) => setF({ ...f, levels: f.levels.map((l: any, j: number) => (j === i ? { ...l, ...p } : l)) });
  const move = (i: number, d: number) => { const ls = [...f.levels]; const [x] = ls.splice(i, 1); ls.splice(i + d, 0, x); setF({ ...f, levels: ls }); };
  const save = async () => {
    setBusy(true);
    fe.clear();
    try {
      if (def.id) await api.put(`/api/admin/workflows/${def.id}`, f);
      else await api.post('/api/admin/workflows', f);
      toast('success', 'Workflow saved. The change is recorded in the audit log.');
      onDone();
      onClose();
    } catch (e) { fe.capture(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={def.id ? `Edit workflow: ${def.name}` : 'New workflow'} size="xl" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save workflow</Button></>}>
      <div className="space-y-4">
        <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
        {def._count?.instances > 0 && <Notice tone="warning">{def._count.instances} item(s) are in progress. Items continue from their current level number; reordering or removing levels affects them.</Notice>}
        <Grid cols={3}>
          <Select label="Module" value={f.module} disabled={!!def.id} onChange={(e) => setF({ ...f, module: e.target.value })} options={Object.entries(modules).map(([v, l]) => ({ value: v, label: l as string }))} />
          <Input label="Workflow name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={fe.errors.name} />
          <Select label="Applies to" value={f.districtId} onChange={(e) => setF({ ...f, districtId: e.target.value })} placeholder="All districts (default)" options={districts.map((d) => ({ value: d.id, label: d.name }))} />
          <Select label="On resubmission" value={f.resubmitPolicy} onChange={(e) => setF({ ...f, resubmitPolicy: e.target.value })} options={[{ value: 'RESTART', label: 'Restart from level 1' }, { value: 'RETURNING_LEVEL', label: 'Resume at the level that returned it' }]} />
          <Select label="Status" value={f.isActive ? '1' : '0'} onChange={(e) => setF({ ...f, isActive: e.target.value === '1' })} options={[{ value: '1', label: 'Active (replaces other active workflow for the same scope)' }, { value: '0', label: 'Inactive' }]} />
          <Textarea label="Description" rows={1} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Grid>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Approval levels (in sequence) {fe.errors.levels && <span className="text-xs text-red-600">— {fe.errors.levels}</span>}</h3>
            <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setF({ ...f, levels: [...f.levels, { name: '', designation: '', approverType: 'ROLE', approverUserId: '', approverRoleId: '', districtScope: 'ANY', allowReject: true, allowReturn: true, allowReassign: false, canAmendDates: false }] })}>Add level</Button>
          </div>
          <div className="space-y-2">
            {f.levels.map((l: any, i: number) => (
              <div key={l.id ?? i} className="rounded-lg border border-line bg-gray-50/60 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="grid size-6 place-items-center rounded-full bg-brand text-xs font-semibold text-white">{i + 1}</span>
                  <span className="text-sm font-medium">{i === f.levels.length - 1 ? 'Final approving level' : 'Intermediate level'}</span>
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} icon={<ArrowUp className="size-4" />} onClick={() => move(i, -1)} />
                    <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === f.levels.length - 1} icon={<ArrowDown className="size-4" />} onClick={() => move(i, 1)} />
                    <Button size="sm" variant="ghost" aria-label="Remove level" icon={<Trash2 className="size-4 text-red-600" />} onClick={() => setF({ ...f, levels: f.levels.filter((_: any, j: number) => j !== i) })} />
                  </div>
                </div>
                <Grid cols={3}>
                  <Input label="Level name" required value={l.name} onChange={(e) => upd(i, { name: e.target.value })} error={fe.errors[`levels.${i}.name`]} placeholder="e.g. District Officer" />
                  <Input label="Designation (display)" value={l.designation} onChange={(e) => upd(i, { designation: e.target.value })} />
                  <Select label="Assign to" value={l.approverType} onChange={(e) => upd(i, { approverType: e.target.value })} options={[{ value: 'ROLE', label: 'Any user with a role' }, { value: 'USER', label: 'A specific officer' }, ...(['DAAMR_REQUEST', 'DAAMR_REPORT'].includes(f.module) ? [{ value: 'RESPONSIBLE_OFFICER', label: "The activity's responsible (lead) staff member" }] : [])]} error={fe.errors[`levels.${i}.approverType`]} />
                  {l.approverType === 'RESPONSIBLE_OFFICER' ? (
                    <p className="self-end pb-2 text-xs text-ink-3 sm:col-span-1">Assigned to the lead staff member of the activity. If none is assigned yet, the item waits as “pending assignment” until one is.</p>
                  ) : l.approverType === 'USER' ? (
                    <Select label="Officer" value={l.approverUserId} onChange={(e) => upd(i, { approverUserId: e.target.value })} error={fe.errors[`levels.${i}.approverUserId`]} placeholder="Select officer…" options={users.map((u) => ({ value: u.id, label: `${u.name}${u.designation ? ` — ${u.designation}` : ''}` }))} />
                  ) : (
                    <>
                      <Select label="Role" value={l.approverRoleId} onChange={(e) => upd(i, { approverRoleId: e.target.value })} error={fe.errors[`levels.${i}.approverRoleId`]} placeholder="Select role…" options={roles.map((r) => ({ value: r.id, label: r.name }))} />
                      <Select label="Officer selection" value={l.districtScope} onChange={(e) => upd(i, { districtScope: e.target.value })} options={[{ value: 'SAME_DISTRICT', label: "Same district as the submission" }, { value: 'ANY', label: 'Any district (HQ)' }]} hint="Least-loaded eligible officer is assigned" />
                    </>
                  )}
                </Grid>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                  <Checkbox checked={l.allowReturn} onChange={(v) => upd(i, { allowReturn: v })} label="Can return for revision" />
                  <Checkbox checked={l.allowReject} onChange={(v) => upd(i, { allowReject: v })} label="Can reject" />
                  <Checkbox checked={l.allowReassign} onChange={(v) => upd(i, { allowReassign: v })} label="Officer can reassign" />
                  {f.module === 'HOSTEL_BOOKING' && <Checkbox checked={l.canAmendDates} onChange={(v) => upd(i, { canAmendDates: v })} label="Can approve different dates" />}
                </div>
              </div>
            ))}
            {!f.levels.length && <p className="text-sm text-ink-3">Add at least one approval level.</p>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
