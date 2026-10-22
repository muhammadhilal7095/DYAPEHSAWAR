import { Link } from 'react-router';
import { AlarmClock, ChevronRight, CheckCircle2, ClipboardList, CornerUpLeft, FilePen, Hourglass, ListChecks, PlayCircle, Plus, Stamp, UserX, BadgeCheck } from 'lucide-react';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDistricts, useLookups, useQueryState } from '../../lib/hooks';
import { fmtNum, humanize } from '../../lib/format';
import { ErrorBox, LinkButton, PageHeader, Spinner, cx } from '../../components/ui';
import { ExportMenu, MiniDate, MiniSelect } from '../../components/DataTable';
import { ChartCard, Columns, HBars } from '../../components/Charts';

const STATUS_OPTIONS = ['UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'IN_PROGRESS', 'REPORT_REVIEW', 'COMPLETED', 'REJECTED'];

export default function ActivityDashboard() {
  const { can, me } = useAuth();
  const districts = useDistricts();
  const categories = useLookups('ACTIVITY_CATEGORY');
  const staff = useCached<any[]>('/api/admin/directory') ?? [];
  const [q, setQ] = useQueryState({ from: '', to: '', districtId: '', category: '', assigneeId: '', lifecycle: '' });
  const { data: d, loading, error } = useApi(`/api/daamr/dashboard/activities${qs(q)}`);
  const list = (extra: Record<string, string>) => `/daamr/requests${qs({ scope: 'all', dateField: 'start', from: q.from, to: q.to, districtId: q.districtId, category: q.category, assigneeId: q.assigneeId, lifecycle: q.lifecycle, ...extra })}`;
  const active = Object.values(q).some(Boolean);

  return (
    <>
      <PageHeader
        title="Activity Management Dashboard"
        subtitle={`Live figures from saved records${can('daamr.request.view_all') ? '' : ', limited to the activities you are permitted to see'}. Activities are counted once each, by start date.`}
        actions={
          <>
            {can('daamr.export') && <ExportMenu compact label="Export" url={(f) => `/api/daamr/dashboard/activities/export${qs({ ...q, format: f })}`} formats={['pdf', 'xlsx']} />}
            {can('daamr.request.create') && <LinkButton to="/daamr/requests/new" icon={<Plus className="size-4" />}>Create activity</LinkButton>}
          </>
        }
      />

      <div className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 shadow-sm">
        <MiniDate label="From (start date)" value={q.from} onChange={(v) => setQ({ from: v })} />
        <MiniDate label="To" value={q.to} onChange={(v) => setQ({ to: v })} />
        <MiniSelect label="District / HQ" value={q.districtId} onChange={(v) => setQ({ districtId: v })} options={districts.map((x) => ({ value: x.id, label: x.name }))} />
        <MiniSelect label="Activity type" value={q.category} onChange={(v) => setQ({ category: v })} options={categories.map((c) => ({ value: c.value, label: c.label }))} />
        <MiniSelect label="Assigned staff" value={q.assigneeId} onChange={(v) => setQ({ assigneeId: v })} options={staff.map((u) => ({ value: u.id, label: u.name }))} />
        <MiniSelect label="Approval status" value={q.lifecycle} onChange={(v) => setQ({ lifecycle: v })} options={STATUS_OPTIONS.map((s) => ({ value: s, label: humanize(s) }))} />
        {active && <button className="pb-2 text-sm text-ink-3 hover:text-ink" onClick={() => setQ({ from: '', to: '', districtId: '', category: '', assigneeId: '', lifecycle: '' })}>Clear filters</button>}
      </div>

      <ErrorBox error={error} />
      {loading && !d ? <Spinner /> : d && (() => { const monthly = d.charts.monthly.map((m: any) => ({ ...m, label: monthLabel(m.month) })); return (
        <>
          {(d.mine.openTasks > 0 || d.mine.awaitingReview > 0) && (
            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MineTile to="/daamr/assignments" icon={<ListChecks className="size-5" />} title="My assigned tasks" value={d.mine.openTasks} note={d.mine.overdueTasks ? `${d.mine.overdueTasks} overdue` : 'None overdue'} alert={d.mine.overdueTasks > 0} />
              <MineTile to="/daamr/requests?scope=assigned" icon={<Stamp className="size-5" />} title="Awaiting my review" value={d.mine.awaitingReview} note={`Activities and execution reports assigned to ${me?.name ?? 'you'}`} alert={false} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Headline label="Total activities" value={d.cards.total} note="Submitted · drafts excluded" to={list({})} icon={<ClipboardList className="size-5" />} accent="border-t-brand" chip="bg-brand-50 text-brand" />
            <Headline label="In progress" value={d.cards.inProgress} note="Approved and under execution" to={list({ lifecycle: 'IN_PROGRESS' })} icon={<PlayCircle className="size-5" />} accent="border-t-blue-600" chip="bg-blue-50 text-blue-700" />
            <Headline label="Completed" value={d.cards.completed} note={d.cards.total ? `${Math.round((d.cards.completed / d.cards.total) * 100)}% of total · report verified` : 'Report verified'} to={list({ lifecycle: 'COMPLETED' })} icon={<CheckCircle2 className="size-5" />} accent="border-t-emerald-600" chip="bg-emerald-50 text-emerald-700" />
            <Headline label="Overdue" value={d.cards.overdue} note="Past end date or task deadline" to={list({ overdue: '1', lifecycle: '' })} icon={<AlarmClock className="size-5" />} accent={d.cards.overdue ? 'border-t-red-600' : 'border-t-gray-300'} chip={d.cards.overdue ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'} />
          </div>

          <section aria-labelledby="pipeline" className="mt-4 overflow-hidden rounded-xl border border-line bg-white shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
              <h2 id="pipeline" className="text-sm font-semibold text-ink">Approval pipeline</h2>
              <p className="text-xs text-ink-3">Activities waiting at each stage · click a stage to open the list</p>
            </div>
            <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { label: 'Draft', value: d.cards.draft, note: 'Not yet submitted', to: list({ lifecycle: 'DRAFT' }), icon: <FilePen className="size-4" />, tone: 'text-gray-600' },
                { label: 'Awaiting staff', value: d.cards.pendingAssignments, note: 'No staff assigned', to: list({ unassigned: '1', lifecycle: '' }), icon: <UserX className="size-4" />, tone: 'text-amber-700' },
                { label: 'Pending review', value: d.cards.pendingReviews, note: 'Activity or report review', to: list({ lifecycle: 'UNDER_REVIEW,REPORT_REVIEW' }), icon: <Hourglass className="size-4" />, tone: 'text-amber-700' },
                { label: 'Changes requested', value: d.cards.changesRequested, note: 'Returned to requester', to: list({ lifecycle: 'CHANGES_REQUESTED' }), icon: <CornerUpLeft className="size-4" />, tone: 'text-orange-700' },
                { label: 'Approved', value: d.cards.approved, note: 'Execution not started', to: list({ lifecycle: 'APPROVED' }), icon: <BadgeCheck className="size-4" />, tone: 'text-emerald-700' },
              ].map((x, i, all) => (
                <li key={x.label} className={cx('relative border-line max-lg:border-b sm:border-r', i === all.length - 1 && 'max-sm:col-span-2 lg:border-r-0')}>
                  <Link to={x.to} className="group block h-full px-4 py-3.5 transition hover:bg-gray-50">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                      <span className={x.tone}>{x.icon}</span>{x.label}
                    </span>
                    <span className="tabular mt-1 block text-2xl font-bold tracking-tight text-ink">{fmtNum(x.value)}</span>
                    <span className="block text-xs text-ink-3">{x.note}</span>
                  </Link>
                  {i < all.length - 1 && <ChevronRight className="absolute -right-2.5 top-1/2 z-10 hidden size-5 -translate-y-1/2 rounded-full bg-white text-ink-3 ring-1 ring-line lg:block" aria-hidden />}
                </li>
              ))}
            </ol>
          </section>

          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Activities by month" subtitle="By start month" rows={monthly} columns={[{ key: 'label', label: 'Month' }, { key: 'value', label: 'Activities', numeric: true }]}><Columns data={monthly} xKey="label" valueLabel="Activities" /></ChartCard>
            <ChartCard title="Activities by status" rows={d.charts.byStatus} columns={[{ key: 'name', label: 'Status' }, { key: 'value', label: 'Activities', numeric: true }]}><HBars data={d.charts.byStatus} valueLabel="Activities" /></ChartCard>
            <ChartCard title="Activities by district" rows={d.charts.byDistrict} columns={[{ key: 'name', label: 'District / HQ' }, { key: 'value', label: 'Activities', numeric: true }]} height={Math.max(260, d.charts.byDistrict.length * 28)}><HBars data={d.charts.byDistrict} valueLabel="Activities" /></ChartCard>
            <ChartCard title="Activities by category" rows={d.charts.byCategory} columns={[{ key: 'name', label: 'Category' }, { key: 'value', label: 'Activities', numeric: true }]}><HBars data={d.charts.byCategory} valueLabel="Activities" /></ChartCard>
            <ChartCard title="Activities by department" rows={d.charts.byDepartment} columns={[{ key: 'name', label: 'Department' }, { key: 'value', label: 'Activities', numeric: true }]}><HBars data={d.charts.byDepartment} valueLabel="Activities" /></ChartCard>
            <div className="flex flex-col justify-center gap-2 rounded-xl border border-dashed border-line p-5 text-sm text-ink-3">
              <p><strong className="text-ink-2">How figures are counted.</strong> Each activity counts once, filtered by its start date. Drafts appear only under “Draft activities”.</p>
              <p>Pending reviews include activities awaiting a review decision and execution reports awaiting verification. An activity becomes Completed only after its execution report passes final verification.</p>
              <p>Participation and budget summaries remain available under <Link to="/daamr/summary" className="text-brand hover:underline">Participation &amp; Budget Summary</Link>.</p>
            </div>
          </div>
        </>
      ); })()}
    </>
  );
}

function MineTile({ to, icon, title, value, note, alert }: { to: string; icon: React.ReactNode; title: string; value: number; note: string; alert: boolean }) {
  return (
    <Link to={to} className={cx('flex items-center gap-4 rounded-xl border p-4 shadow-sm transition hover:shadow-md', alert ? 'border-red-200 bg-red-50/60' : 'border-brand-200 bg-brand-50/60')}>
      <span className={cx('grid size-11 place-items-center rounded-xl', alert ? 'bg-red-100 text-red-700' : 'bg-brand-100 text-brand')}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-medium uppercase tracking-wide text-ink-3">{title}</span>
        <span className="tabular block text-2xl font-semibold text-ink">{value}</span>
        <span className={cx('block text-xs', alert ? 'font-medium text-red-700' : 'text-ink-3')}>{note}</span>
      </span>
    </Link>
  );
}

const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function Headline({ label, value, note, to, icon, accent, chip }: { label: string; value: number; note: string; to: string; icon: React.ReactNode; accent: string; chip: string }) {
  return (
    <Link to={to} className={cx('group flex flex-col rounded-xl border border-t-4 border-line bg-white p-4 shadow-sm transition hover:shadow-md', accent)}>
      <span className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{label}</span>
        <span className={cx('rounded-lg p-1.5', chip)}>{icon}</span>
      </span>
      <span className="tabular mt-1 text-3xl font-bold tracking-tight text-ink">{fmtNum(value)}</span>
      <span className="mt-auto pt-1 text-xs text-ink-3">{note}</span>
    </Link>
  );
}
