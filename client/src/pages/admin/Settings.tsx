import { useEffect, useState } from 'react';
import { Plus, Upload } from 'lucide-react';
import { api, fileUrl } from '../../lib/api';
import { applyTheme, useAuth } from '../../lib/auth';
import { clearCache, useApi } from '../../lib/hooks';
import { fmtDateTime, fmtSize, humanize } from '../../lib/format';
import { Badge, Button, Card, Checkbox, ErrorBox, Grid, Input, Modal, Notice, PageHeader, Select, Spinner, Tabs, Textarea, useFormErrors, useToast } from '../../components/ui';

const DEMO = ['male', 'female', 'minority', 'madaris', 'transgender', 'disabled', 'juvenile'];
const GROUPS: Record<string, string> = {
  ACTIVITY_CATEGORY: 'DAAMR activity categories', ROOM_TYPE: 'Hostel room types', JM_INSPECTION_TYPE: 'JM inspection types', JM_PROJECT_STATUS: 'JM project status options',
  JM_QUALITY: 'JM quality ratings', JM_COMPLIANCE: 'JM compliance ratings', JM_COMPLIANCE_CRITERIA: 'JM compliance criteria (checklist)', JM_ISSUE_CATEGORY: 'JM issue categories',
  JM_RISK_CATEGORY: 'JM risk categories', JM_RISK_PROBABILITY: 'JM risk probability scale (score)', JM_RISK_IMPACT: 'JM risk impact scale (score)',
};

export default function Settings() {
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('tab') ?? 'general');
  return (
    <>
      <PageHeader title="System Settings" subtitle="Branding, security, counting rules, thresholds and dropdown values. All changes are audited." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'general', label: 'General & rules' }, { value: 'email', label: 'Email (SMTP)' }, { value: 'lookups', label: 'Dropdown values' }]} />
      {tab === 'general' ? <General /> : tab === 'email' ? <EmailSettings /> : <Lookups />}
    </>
  );
}

function General() {
  const { refresh } = useAuth();
  const { data, loading, reload } = useApi('/api/admin/settings');
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const fe = useFormErrors();
  const toast = useToast();
  useEffect(() => { if (data) setF(data.settings); }, [data]);
  if (loading || !f) return <Spinner />;
  const set = (p: any) => setF({ ...f, ...p });
  const save = async () => {
    setBusy(true);
    fe.clear();
    try {
      await api.put('/api/admin/settings', f);
      applyTheme(f.themeColor);
      await refresh();
      toast('success', 'Settings saved.');
      reload();
    } catch (e) { fe.capture(e); } finally { setBusy(false); }
  };
  const uploadLogo = async (file: File) => {
    const fd = new FormData();
    fd.append('files', file);
    fd.append('category', 'LOGO');
    try {
      const [row] = await api.upload('/api/files/logo/org', fd);
      set({ logoFileId: row.id });
      toast('info', 'Logo uploaded — click Save to apply.');
    } catch (e: any) { toast('error', e.message); }
  };
  return (
    <div className="space-y-4">
      <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
      {!data.smtpConfigured && <Notice tone="warning">Email is not configured. Notifications are logged as <strong>Failed</strong> until you set up the mail server in the <a className="font-medium underline" href="/admin/settings?tab=email">Email (SMTP)</a> tab; they can then be retried from Email Logs.</Notice>}
      <Card title="Organisation & theme">
        <Grid cols={3}>
          <Input label="Organisation name" value={f.orgName} onChange={(e) => set({ orgName: e.target.value })} error={fe.errors.orgName} />
          <Input label="Subtitle" value={f.orgSubtitle} onChange={(e) => set({ orgSubtitle: e.target.value })} />
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-2">Theme colour</label>
            <div className="flex items-center gap-2"><input type="color" aria-label="Theme colour" value={f.themeColor} onChange={(e) => set({ themeColor: e.target.value })} className="h-9 w-14 rounded border border-line" /><Input value={f.themeColor} onChange={(e) => set({ themeColor: e.target.value })} error={fe.errors.themeColor} /></div>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink-2">Logo (PNG/JPEG — shown in the portal and on PDF reports)</label>
            <div className="flex items-center gap-3">
              {f.logoFileId ? <img src={fileUrl(f.logoFileId)} alt="Logo" className="size-14 rounded border border-line object-contain" /> : <span className="text-sm text-ink-3">No logo</span>}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:bg-gray-50"><Upload className="size-4" />Upload<input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} /></label>
              {f.logoFileId && <Button variant="ghost" size="sm" onClick={() => set({ logoFileId: null })}>Remove</Button>}
            </div>
          </div>
          <Input label="Timezone (IANA)" value={f.timezone} onChange={(e) => set({ timezone: e.target.value })} error={fe.errors.timezone} hint="e.g. Asia/Karachi" />
        </Grid>
      </Card>
      <Card title="Security & uploads">
        <Grid cols={3}>
          <Input label="Idle session timeout (minutes)" type="number" value={f.sessionIdleMinutes} onChange={(e) => set({ sessionIdleMinutes: Number(e.target.value) })} error={fe.errors.sessionIdleMinutes} />
          <Input label="Maximum session length (hours)" type="number" value={f.sessionMaxHours} onChange={(e) => set({ sessionMaxHours: Number(e.target.value) })} error={fe.errors.sessionMaxHours} />
          <Input label="Maximum upload size (MB)" type="number" value={f.maxUploadMb} onChange={(e) => set({ maxUploadMb: Number(e.target.value) })} error={fe.errors.maxUploadMb} />
        </Grid>
      </Card>
      <Card title="DAAMR participant counting rule" subtitle="Select the demographic fields that are summed into Total Participants. Leave overlapping sub-categories unticked to avoid double-counting.">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {DEMO.map((d) => <Checkbox key={d} checked={f.participantTotalFields.includes(d)} onChange={(v) => set({ participantTotalFields: v ? [...f.participantTotalFields, d] : f.participantTotalFields.filter((x: string) => x !== d) })} label={humanize(d)} />)}
        </div>
        {fe.errors.participantTotalFields && <p className="mt-1 text-xs text-red-600">{fe.errors.participantTotalFields}</p>}
      </Card>
      <Card title="Youth hostels">
        <Grid cols={2}>
          <Select label="Dashboard filter default" value={f.hostelDashboardFilterMode} onChange={(e) => set({ hostelDashboardFilterMode: e.target.value })} options={[{ value: 'HOSTEL', label: 'By hostel' }, { value: 'FACILITY_TYPE', label: 'By facility type' }]} />
          <div className="pt-6"><Checkbox checked={f.hostelExtensionRequiresOverride} onChange={(v) => set({ hostelExtensionRequiresOverride: v })} label="Stay extensions require administrator authorisation" hint="When off, hostel managers can extend stays if the same rooms are free." /></div>
        </Grid>
      </Card>
      <Card title="Courses and daily reports">
        <Grid cols={3}>
          <div className="sm:col-span-3">
            <p className="mb-1 text-sm font-medium text-ink-2">Non-training days (skipped when schedules are generated)</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                <Checkbox key={d} label={d} checked={(f.courseNonTrainingWeekdays ?? []).includes(i)} onChange={(v) => set({ courseNonTrainingWeekdays: v ? [...(f.courseNonTrainingWeekdays ?? []), i].sort() : (f.courseNonTrainingWeekdays ?? []).filter((x: number) => x !== i) })} />
              ))}
            </div>
          </div>
          <Textarea label="Holidays (one date per line, YYYY-MM-DD)" wrapClass="sm:col-span-3" rows={3} value={(f.courseHolidays ?? []).join('\n')} onChange={(e) => set({ courseHolidays: e.target.value.split(/\s+/).map((x) => x.trim()).filter(Boolean) })} error={fe.errors.courseHolidays ?? Object.entries(fe.errors).find(([k]) => k.startsWith('courseHolidays.'))?.[1]} hint="Applied to schedules generated after the change; existing schedules are not moved." />
          <Input label="Daily report due after (days)" type="number" min={0} max={30} value={f.courseReportDueDays} onChange={(e) => set({ courseReportDueDays: Number(e.target.value) })} hint="Missing reports are flagged and the coordinator notified" />
          <Input label="Course overdue after last session (days)" type="number" min={0} value={f.courseCompletionGraceDays} onChange={(e) => set({ courseCompletionGraceDays: Number(e.target.value) })} />
          <div className="flex items-end pb-2"><Checkbox label="Require at least one photograph per daily report" checked={!!f.courseRequirePhotos} onChange={(v) => set({ courseRequirePhotos: v })} /></div>
        </Grid>
      </Card>
      <Card title="Activity management">
        <Grid cols={3}>
          <Input label="Remind staff before a task deadline (days)" type="number" min={0} max={30} value={f.activityDeadlineReminderDays} onChange={(e) => set({ activityDeadlineReminderDays: Number(e.target.value) })} error={fe.errors.activityDeadlineReminderDays} hint="0 = remind only when overdue" />
          <div className="sm:col-span-2 flex flex-wrap items-center gap-4 rounded-lg bg-gray-50 p-3">
            <Checkbox checked={!!f.activityRemindersEnabled} onChange={(v) => set({ activityRemindersEnabled: v })} label="Send upcoming-deadline and overdue-task reminders" hint="In-app notifications (and email when configured), sent once per task. The core workflow does not depend on email." />
            <RunActivityReminders />
          </div>
        </Grid>
      </Card>
      <Card title="Jawan Markaz rules">
        <Grid cols={3}>
          <Input label="Slightly delayed: up to (days)" type="number" value={f.jmSlightDelayMaxDays} onChange={(e) => set({ jmSlightDelayMaxDays: Number(e.target.value) })} hint="More days late = significantly delayed" />
          <Input label="Slightly delayed: up to (points behind plan)" type="number" value={f.jmSlightGapMaxPct} onChange={(e) => set({ jmSlightGapMaxPct: Number(e.target.value) })} hint="Used when delay days are not reported" />
          <div>
            <p className="mb-1 text-sm font-medium text-ink-2">Counted as “Satisfactory Quality”</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">{['EXCELLENT', 'GOOD', 'SATISFACTORY', 'NEEDS_IMPROVEMENT'].map((v) => <Checkbox key={v} checked={f.jmSatisfactoryQualityValues.includes(v)} onChange={(c) => set({ jmSatisfactoryQualityValues: c ? [...f.jmSatisfactoryQualityValues, v] : f.jmSatisfactoryQualityValues.filter((x: string) => x !== v) })} label={humanize(v)} />)}</div>
          </div>
          <Input label="Risk band: Low up to score" type="number" value={f.jmRiskBands.low} onChange={(e) => set({ jmRiskBands: { ...f.jmRiskBands, low: Number(e.target.value) } })} error={fe.errors.jmRiskBands} />
          <Input label="Risk band: Medium up to score" type="number" value={f.jmRiskBands.medium} onChange={(e) => set({ jmRiskBands: { ...f.jmRiskBands, medium: Number(e.target.value) } })} />
          <Input label="Risk band: High up to score (above = Critical)" type="number" value={f.jmRiskBands.high} onChange={(e) => set({ jmRiskBands: { ...f.jmRiskBands, high: Number(e.target.value) } })} />
          <div className="sm:col-span-3 flex flex-wrap items-center gap-4 rounded-lg bg-gray-50 p-3">
            <Checkbox checked={!!f.jmRemindersEnabled} onChange={(v) => set({ jmRemindersEnabled: v })} label="Send daily reminders for overdue corrective actions and inspections" hint="Sent once a day after 08:00 to the reporting officer, with a digest to officers who can update registers." />
            <RunReminders />
          </div>
          <Textarea label="Certification statement" wrapClass="sm:col-span-3" value={f.jmCertificationStatement} onChange={(e) => set({ jmCertificationStatement: e.target.value })} error={fe.errors.jmCertificationStatement} />
        </Grid>
      </Card>
      <Backups enabled={!!f.backupEnabled} keep={f.backupKeep} set={set} errors={fe.errors} />
      <div className="flex justify-end"><Button loading={busy} onClick={save}>Save settings</Button></div>
    </div>
  );
}

function RunActivityReminders() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={async () => {
      setBusy(true);
      try { const r = await api.post('/api/daamr/assignments/reminders/run'); toast('success', `${r.upcoming} upcoming-deadline and ${r.overdue} overdue reminder(s) sent.`); }
      catch (e: any) { toast('error', e.message); } finally { setBusy(false); }
    }}>Send reminders now</Button>
  );
}

function Backups({ enabled, keep, set, errors }: { enabled: boolean; keep: number; set: (p: any) => void; errors: Record<string, string> }) {
  const { data, reload } = useApi('/api/admin/backups');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Card title="Database backups" subtitle="A consistent copy of the database is made automatically once a day while backups are enabled. Uploaded files are stored separately and must be included in the server's own file backup.">
      <Grid cols={3}>
        <div className="flex items-center"><Checkbox checked={enabled} onChange={(v) => set({ backupEnabled: v })} label="Automatic daily backup" /></div>
        <Input label="Backups to keep" type="number" min={1} max={365} value={keep} onChange={(e) => set({ backupKeep: Number(e.target.value) })} error={errors.backupKeep} hint="Older backups are deleted automatically" />
        <div className="flex items-end">
          <Button variant="secondary" loading={busy} onClick={async () => {
            setBusy(true);
            try { const b = await api.post('/api/admin/backups/run'); toast('success', `Backup ${b.name} created.`); reload(); } catch (e: any) { toast('error', e.message); } finally { setBusy(false); }
          }}>Back up now</Button>
        </div>
      </Grid>
      <div className="mt-4 text-sm">
        <p className="text-xs text-ink-3">Location on the server: <code className="rounded bg-gray-100 px-1">{data?.dir ?? '…'}</code></p>
        {data?.backups?.length ? (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
            {data.backups.slice(0, 7).map((b: any) => (
              <li key={b.name} className="flex flex-wrap justify-between gap-2 px-3 py-1.5 text-xs"><span className="font-mono">{b.name}</span><span className="text-ink-3">{fmtDateTime(b.createdAt)} · {fmtSize(b.size)}</span></li>
            ))}
          </ul>
        ) : <p className="mt-2 text-xs text-ink-3">No backups yet.</p>}
      </div>
    </Card>
  );
}

function Lookups() {
  const { data, loading, reload } = useApi<any[]>('/api/admin/lookups?all=true');
  const [edit, setEdit] = useState<any | null>(null);
  if (loading && !data) return <Spinner />;
  const done = () => { clearCache('/api/admin/lookups'); reload(); };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {Object.entries(GROUPS).map(([g, label]) => {
        const rows = (data ?? []).filter((o) => o.group === g);
        const scored = g.startsWith('JM_RISK_P') || g === 'JM_RISK_IMPACT';
        return (
          <Card key={g} title={label} actions={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setEdit({ group: g, isActive: true, sortOrder: rows.length, scored })}>Add</Button>} bodyClass="p-0">
            <ul className="divide-y divide-line">
              {rows.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0 flex-1">{o.label} <span className="font-mono text-xs text-ink-3">{o.value}</span></span>
                  {scored && <span className="text-xs text-ink-3">score {o.meta?.score}</span>}
                  {!o.isActive && <Badge tone="gray" label="Inactive" />}
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ ...o, scored })}>Edit</Button>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      {edit && <LookupModal value={edit} onClose={() => setEdit(null)} onDone={done} />}
    </div>
  );
}

function LookupModal({ value, onClose, onDone }: any) {
  const [f, setF] = useState({ value: value.value ?? '', label: value.label ?? '', sortOrder: value.sortOrder ?? 0, isActive: value.isActive ?? true, score: value.meta?.score ?? '' });
  const fe = useFormErrors();
  const save = async () => {
    const body = { group: value.group, value: f.value, label: f.label, sortOrder: Number(f.sortOrder), isActive: f.isActive, meta: value.scored ? { score: Number(f.score) } : value.meta ?? null };
    try {
      if (value.id) await api.put(`/api/admin/lookups/${value.id}`, body);
      else await api.post('/api/admin/lookups', body);
      onDone();
      onClose();
    } catch (e) { fe.capture(e); }
  };
  return (
    <Modal open onClose={onClose} title={`${value.id ? 'Edit' : 'Add'} option — ${GROUPS[value.group]}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
        <Input label="Code" value={f.value} disabled={!!value.id} onChange={(e) => setF({ ...f, value: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} error={fe.errors.value} hint="Stored on records; cannot be changed later" />
        <Input label="Label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} error={fe.errors.label} />
        <Input label="Sort order" type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value as any })} />
        {value.scored && <Input label="Score" type="number" value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} />}
        <Checkbox checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active (shown in forms)" />
      </div>
    </Modal>
  );
}

function RunReminders() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={async () => {
      setBusy(true);
      try { const r = await api.post('/api/jm/monitoring/reminders/run'); toast('success', `${r.overdueActions} overdue action(s), ${r.overdueInspections} overdue inspection(s); ${r.messages} reminder(s) queued.`); }
      catch (e: any) { toast('error', e.message); } finally { setBusy(false); }
    }}>Send reminders now</Button>
  );
}

const PRESETS = [
  { label: 'Microsoft 365 / Outlook', host: 'smtp.office365.com', port: 587, secure: false },
  { label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 587, secure: false },
  { label: 'Generic SSL (port 465)', host: '', port: 465, secure: true },
];

function EmailSettings() {
  const { data, loading, reload } = useApi('/api/admin/smtp');
  const [f, setF] = useState<any>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [testTo, setTestTo] = useState('');
  const [result, setResult] = useState<any>(null);
  const fe = useFormErrors();
  const toast = useToast();
  const { me } = useAuth();
  useEffect(() => { if (data) setF({ ...data.saved, port: data.saved.port ?? 587 }); }, [data]);
  useEffect(() => { if (me && !testTo) setTestTo(me.email); }, [me]);
  if (loading || !f) return <Spinner />;
  const set = (p: any) => setF({ ...f, ...p });
  const save = async () => {
    setBusy('save'); fe.clear();
    try {
      await api.put('/api/admin/smtp', { host: f.host, port: Number(f.port), secure: f.secure, ignoreTls: f.ignoreTls, user: f.user, from: f.from, password: password || undefined });
      setPassword(''); toast('success', 'Email settings saved.'); reload();
    } catch (e) { fe.capture(e); } finally { setBusy(null); }
  };
  const test = async () => {
    setBusy('test'); setResult(null);
    try { setResult(await api.post('/api/admin/smtp/test', { to: testTo })); } catch (e: any) { toast('error', e.message); } finally { setBusy(null); }
  };
  const clear = async () => {
    setBusy('clear');
    try { await api.del('/api/admin/smtp'); toast('success', data.envConfigured ? 'Saved settings removed — using the server .env configuration.' : 'Saved settings removed.'); reload(); } finally { setBusy(null); }
  };
  const source = data.activeSource === 'SETTINGS' ? 'the settings on this page' : data.activeSource === 'ENV' ? 'the server .env file (SMTP_* variables)' : null;
  return (
    <div className="space-y-4">
      {source ? <Notice tone="success">Emails are currently sent using {source}.</Notice> : <Notice tone="warning">No mail server is configured, so notification emails are recorded as <strong>Failed</strong>. Fill in the details below and send a test email.</Notice>}
      <ErrorBox error={fe.formError ? { message: fe.formError } : null} />
      <Card title="Mail server (SMTP)" subtitle="Settings saved here take priority over the server .env file. The password is stored encrypted and is never shown again.">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-3">Quick fill:</span>
          {PRESETS.map((p) => <Button key={p.label} size="sm" variant="secondary" onClick={() => set({ host: p.host || f.host, port: p.port, secure: p.secure })}>{p.label}</Button>)}
        </div>
        <Grid cols={3}>
          <Input label="SMTP server" required placeholder="smtp.office365.com" value={f.host} onChange={(e) => set({ host: e.target.value.trim() })} error={fe.errors.host} />
          <Input label="Port" required type="number" value={f.port} onChange={(e) => set({ port: e.target.value })} error={fe.errors.port} hint="587 (STARTTLS) or 465 (SSL)" />
          <Select label="Encryption" value={f.secure ? 'ssl' : f.ignoreTls ? 'none' : 'starttls'} onChange={(e) => set({ secure: e.target.value === 'ssl', ignoreTls: e.target.value === 'none' })}
            options={[{ value: 'starttls', label: 'STARTTLS (usually port 587)' }, { value: 'ssl', label: 'SSL/TLS (usually port 465)' }, { value: 'none', label: 'None (internal relay only)' }]} />
          <Input label="Username" autoComplete="off" value={f.user} onChange={(e) => set({ user: e.target.value })} error={fe.errors.user} hint="Usually the full mailbox address; leave empty for relays without login" />
          <Input label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fe.errors.password}
            placeholder={f.passwordSet ? '•••••••• (saved — leave blank to keep)' : ''} hint={f.passwordSet ? 'A password is saved. Type a new one only to replace it.' : 'For Gmail/Microsoft 365 use an app password if multi-factor sign-in is enabled.'} />
          <Input label="Sender (From)" required placeholder="Directorate of Youth Affairs <no-reply@kp.gov.pk>" value={f.from} onChange={(e) => set({ from: e.target.value })} error={fe.errors.from} />
        </Grid>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {data.activeSource === 'SETTINGS' && <Button variant="ghost" loading={busy === 'clear'} onClick={clear}>Remove saved settings</Button>}
          <Button loading={busy === 'save'} onClick={save}>Save email settings</Button>
        </div>
      </Card>
      <Card title="Send a test email" subtitle="Sends a real message using the saved configuration and shows the mail server's answer.">
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Send to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} wrapClass="min-w-64 flex-1 sm:flex-none" />
          <Button variant="secondary" loading={busy === 'test'} disabled={!source} onClick={test}>Send test email</Button>
        </div>
        {result && (
          <div className="mt-3">
            {result.status === 'SENT'
              ? <Notice tone="success">Accepted by the mail server for delivery to {testTo}. Check that inbox (and its spam folder).{result.messageId && <span className="block font-mono text-xs">Message ID: {result.messageId}</span>}</Notice>
              : <Notice tone="danger"><strong>Not sent.</strong> {result.error}</Notice>}
          </div>
        )}
      </Card>
    </div>
  );
}
