import { useState } from 'react';
import { Link } from 'react-router';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDebounced, useQueryState } from '../../lib/hooks';
import { fmtDate, humanize, todayISO, toISODate } from '../../lib/format';
import { Badge, Button, Card, Checkbox, ErrorBox, Modal, PageHeader, Pagination, Select, Tabs, Textarea, useFormErrors, useToast } from '../../components/ui';
import { DataTable, FilterBar, MiniSelect, SearchInput } from '../../components/DataTable';
import { AttachmentList, Uploader } from '../../components/Files';

const ST: Record<string, string[]> = {
  issues: ['OPEN', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  actions: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED'],
  risks: ['OPEN', 'MONITORING', 'MITIGATED', 'CLOSED'],
};

export default function Registers() {
  const { me, can } = useAuth();
  const assets = useCached<any>('/api/jm/assets')?.rows ?? [];
  const [q, setQ] = useQueryState({ tab: 'issues', q: '', assetId: '', status: '', severity: '', level: '', overdue: '', page: '1' });
  const search = useDebounced(q.q);
  const { data, loading, reload } = useApi(q.tab === 'inspections' ? null : `/api/jm/registers/${q.tab}${qs({ q: search, assetId: q.assetId, status: q.status, severity: q.severity, level: q.level, overdue: q.overdue, page: q.page })}`);
  const [edit, setEdit] = useState<any | null>(null);
  const canUpdate = (row: any) => can('jm.register.update') || (q.tab === 'actions' && row.report.reportingOfficerId === me?.id);
  const today = todayISO();
  return (
    <>
      <PageHeader title="Issues, Corrective Actions & Risks" subtitle="Registers across all monitoring reports you can access. Actions are tracked until completed and verified." />
      <Tabs value={q.tab} onChange={(v) => setQ({ tab: v, status: '', severity: '', level: '', overdue: '' })} tabs={[{ value: 'issues', label: 'Issues' }, { value: 'actions', label: 'Corrective actions' }, { value: 'risks', label: 'Risk register' }, { value: 'inspections', label: 'Inspection schedule' }]} />
      {q.tab === 'inspections' ? <InspectionSchedule /> : (
      <Card bodyClass="p-0">
        <FilterBar onReset={() => setQ({ q: '', assetId: '', status: '', severity: '', level: '', overdue: '' })}>
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v })} placeholder="ID or description…" />
          <MiniSelect label="Asset" value={q.assetId} onChange={(v) => setQ({ assetId: v })} options={assets.map((a: any) => ({ value: a.id, label: a.name }))} />
          <MiniSelect label="Status" value={q.status} onChange={(v) => setQ({ status: v })} options={(ST[q.tab] ?? []).map((s) => ({ value: s, label: humanize(s) }))} />
          {q.tab === 'issues' && <MiniSelect label="Severity" value={q.severity} onChange={(v) => setQ({ severity: v })} options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => ({ value: s, label: humanize(s) }))} />}
          {q.tab === 'risks' && <MiniSelect label="Level" value={q.level} onChange={(v) => setQ({ level: v })} options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => ({ value: s, label: humanize(s) }))} />}
          {q.tab === 'actions' && <div className="pb-2"><Checkbox checked={q.overdue === 'true'} onChange={(v) => setQ({ overdue: v ? 'true' : '' })} label="Overdue only" /></div>}
        </FilterBar>
        <DataTable
          loading={loading}
          rows={data?.rows}
          columns={
            q.tab === 'issues' ? [
              { key: 'issueCode', header: 'Issue ID', primary: true, render: (r: any) => <span className="font-mono text-xs">{r.issueCode}</span> },
              { key: 'asset', header: 'Asset', render: (r: any) => <Link className="hover:underline" to={`/jm/assets/${r.asset.id}`}>{r.asset.name}</Link> },
              { key: 'description', header: 'Description', render: (r: any) => <span className="line-clamp-2">{r.description}</span> },
              { key: 'severity', header: 'Severity', render: (r: any) => <Badge status={r.severity} /> },
              { key: 'dateIdentified', header: 'Identified', render: (r: any) => fmtDate(r.dateIdentified) },
              { key: 'targetDate', header: 'Target', render: (r: any) => <span className={r.targetDate && toISODate(r.targetDate) < today && !['RESOLVED', 'CLOSED'].includes(r.status) ? 'text-red-700' : ''}>{fmtDate(r.targetDate)}</span> },
              { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> },
              { key: 'report', header: 'Report', render: (r: any) => <Link className="font-mono text-xs text-brand hover:underline" to={`/jm/reports/${r.report.id}`}>{r.report.reportNo}</Link> },
              { key: 'act', header: '', render: (r: any) => canUpdate(r) && <Button size="sm" variant="secondary" onClick={() => setEdit(r)}>Update</Button> },
            ] : q.tab === 'actions' ? [
              { key: 'description', header: 'Action', primary: true, render: (r: any) => <span className="line-clamp-2 font-medium">{r.description}</span> },
              { key: 'asset', header: 'Asset', render: (r: any) => r.asset.name },
              { key: 'type', header: 'Type', render: (r: any) => humanize(r.actionType) },
              { key: 'issue', header: 'Issue', render: (r: any) => r.issue?.issueCode ?? '—' },
              { key: 'responsible', header: 'Responsible', render: (r: any) => r.responsible ?? '—' },
              { key: 'targetDate', header: 'Target', render: (r: any) => <span className={r.targetDate && toISODate(r.targetDate) < today && ['OPEN', 'IN_PROGRESS'].includes(r.status) ? 'font-medium text-red-700' : ''}>{fmtDate(r.targetDate)}</span> },
              { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> },
              { key: 'evidence', header: 'Evidence', render: (r: any) => (r.files.length ? `${r.files.length} file(s)` : '—') },
              { key: 'verified', header: 'Verified by', render: (r: any) => (r.verifiedBy ? `${r.verifiedBy.name}` : '—') },
              { key: 'act', header: '', render: (r: any) => canUpdate(r) && <Button size="sm" variant="secondary" onClick={() => setEdit(r)}>Update</Button> },
            ] : [
              { key: 'riskCode', header: 'Risk ID', primary: true, render: (r: any) => <span className="font-mono text-xs">{r.riskCode}</span> },
              { key: 'asset', header: 'Asset', render: (r: any) => r.asset.name },
              { key: 'description', header: 'Risk', render: (r: any) => <span className="line-clamp-2">{r.description}</span> },
              { key: 'score', header: 'Score', render: (r: any) => <span className="tabular">{r.score}</span> },
              { key: 'level', header: 'Level', render: (r: any) => <Badge status={r.level} /> },
              { key: 'mitigation', header: 'Mitigation', render: (r: any) => r.mitigations.map((m: any) => <span key={m.id} className="block text-xs">{m.measures} <span className="text-ink-3">({humanize(m.status)})</span></span>) },
              { key: 'reviewDate', header: 'Review', render: (r: any) => fmtDate(r.reviewDate) },
              { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> },
              { key: 'act', header: '', render: (r: any) => canUpdate(r) && <Button size="sm" variant="secondary" onClick={() => setEdit(r)}>Update</Button> },
            ]
          }
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ page: String(p) })} />}
      </Card>
      )}
      {edit && <UpdateModal tab={q.tab} row={edit} onClose={() => setEdit(null)} onDone={reload} canVerify={can('jm.register.update')} />}
    </>
  );
}

function UpdateModal({ tab, row, onClose, onDone, canVerify }: any) {
  const [status, setStatus] = useState(row.status);
  const [remarks, setRemarks] = useState(tab === 'issues' ? row.resolutionRemarks ?? '' : row.completionRemarks ?? '');
  const [reviewDate, setReviewDate] = useState(toISODate(row.reviewDate));
  const [busy, setBusy] = useState(false);
  const fe = useFormErrors();
  const toast = useToast();
  const options = ST[tab].filter((s) => tab !== 'actions' || s !== 'VERIFIED' || canVerify);
  const save = async () => {
    setBusy(true);
    fe.clear();
    try {
      const body = tab === 'issues' ? { status, resolutionRemarks: remarks } : tab === 'actions' ? { status, completionRemarks: remarks } : { status, reviewDate };
      await api.patch(`/api/jm/registers/${tab}/${row.id}`, body);
      toast('success', 'Updated.');
      onDone();
      onClose();
    } catch (e) { fe.capture(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Update ${row.issueCode ?? row.riskCode ?? 'action'}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
        <p className="text-sm text-ink-2">{row.description}</p>
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={options.map((s) => ({ value: s, label: humanize(s) }))} />
        {tab !== 'risks' ? (
          <Textarea label={tab === 'issues' ? 'Resolution remarks' : 'Completion remarks'} value={remarks} onChange={(e) => setRemarks(e.target.value)} error={fe.errors.resolutionRemarks ?? fe.errors.completionRemarks} />
        ) : (
          <label className="block text-sm"><span className="mb-1 block font-medium text-ink-2">Next review date</span><input type="date" className="rounded-lg border border-line px-3 py-2" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} /></label>
        )}
        {tab === 'actions' && (
          <div className="border-t border-line pt-3">
            <p className="mb-2 text-sm font-medium">Evidence of completion</p>
            <Uploader target="jm-action" entityId={row.id} kind="doc" compact categories={[{ value: 'EVIDENCE', label: 'Evidence' }]} onUploaded={onDone} />
            <div className="mt-2"><AttachmentList files={row.files ?? []} /></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function InspectionSchedule() {
  const [state, setState] = useState('');
  const { data, loading } = useApi<any[]>(`/api/jm/monitoring/inspections${qs({ state })}`);
  const tone: Record<string, any> = { OVERDUE: 'red', DUE_SOON: 'amber', SCHEDULED: 'blue', NOT_SET: 'gray' };
  return (
    <Card bodyClass="p-0">
      <FilterBar>
        <MiniSelect label="Status" value={state} onChange={setState} options={['OVERDUE', 'DUE_SOON', 'SCHEDULED', 'NOT_SET'].map((s) => ({ value: s, label: humanize(s) }))} />
        <p className="pb-2 text-xs text-ink-3">Next inspection dates come from each asset's latest verified report. An inspection is complete once a later report records an inspection on or after that date.</p>
      </FilterBar>
      <DataTable
        loading={loading}
        rows={data?.map((r) => ({ ...r, id: r.assetId })) ?? undefined}
        columns={[
          { key: 'name', header: 'Jawan Markaz', primary: true, render: (r: any) => <Link className="font-medium hover:underline" to={`/jm/assets/${r.assetId}`}>{r.name}</Link> },
          { key: 'district', header: 'District' },
          { key: 'last', header: 'Last inspection', render: (r: any) => fmtDate(r.lastInspection) },
          { key: 'next', header: 'Next inspection due', render: (r: any) => fmtDate(r.nextInspectionDate) },
          { key: 'state', header: 'Status', render: (r: any) => <Badge tone={tone[r.state]} label={r.state === 'OVERDUE' ? `Overdue ${r.daysOverdue} day(s)` : humanize(r.state)} /> },
          { key: 'officer', header: 'Reporting officer', render: (r: any) => r.officer?.name ?? '—' },
          { key: 'basedOn', header: 'Based on', render: (r: any) => (r.basedOn ? <Link className="font-mono text-xs text-brand hover:underline" to={`/jm/reports/${r.basedOn.id}`}>{r.basedOn.reportNo}</Link> : '—') },
        ]}
      />
    </Card>
  );
}
