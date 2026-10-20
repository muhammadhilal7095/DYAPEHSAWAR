import { Link } from 'react-router';
import { AlarmClock, CheckCircle2, ClipboardList, CornerUpLeft, FilePen, Hourglass, ListChecks, PlayCircle, Plus, Stamp, UserX, BadgeCheck } from 'lucide-react';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDistricts, useLookups, useQueryState } from '../../lib/hooks';
import { fmtNum, humanize } from '../../lib/format';
import { ErrorBox, LinkButton, PageHeader, Spinner, Stat, cx } from '../../components/ui';
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
            {can('daamr.export') && <ExportMenu url={(f) => `/api/daamr/dashboard/activities/export${qs({ ...q, format: f })}`} formats={['pdf', 'xlsx']} />}
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
      {loading && !d ? <Spinner /> : d && (
        <>
          {(d.mine.openTasks > 0 || d.mine.awaitingReview > 0) && (
            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MineTile to="/daamr/assignments" icon={<ListChecks className="size-5" />} title="My assigned tasks" value={d.mine.openTasks} note={d.mine.overdueTasks ? `${d.mine.overdueTasks} overdue` : 'None overdue'} alert={d.mine.overdueTasks > 0} />
              <MineTile to="/daamr/requests?scope=assigned" icon={<Stamp className="size-5" />} title="Awaiting my review" value={d.mine.awaitingReview} note={`Activities and execution reports assigned to ${me?.name ?? 'you'}`} alert={false} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat label="Total activities" value={fmtNum(d.cards.total)} to={list({})} icon={<ClipboardList className="size-5" />} hint="Submitted (excludes drafts)" />
            <Stat label="Draft activities" value={fmtNum(d.cards.draft)} to={list({ lifecycle: 'DRAFT' })} icon={<FilePen className="size-5" />} tone="gray" />
            <Stat label="Pending assignments" value={fmtNum(d.cards.pendingAssignments)} to={list({ unassigned: '1', lifecycle: '' })} icon={<UserX className="size-5" />} tone="amber" hint="No staff assigned" />
            <Stat label="Activities in progress" value={fmtNum(d.cards.inProgress)} to={list({ lifecycle: 'IN_PROGRESS' })} icon={<PlayCircle className="size-5" />} tone="blue" />
            <Stat label="Pending reviews" value={fmtNum(d.cards.pendingReviews)} to={list({ lifecycle: 'UNDER_REVIEW,REPORT_REVIEW' })} icon={<Hourglass className="size-5" />} tone="amber" hint="Activity or report review" />
            <Stat label="Changes requested" value={fmtNum(d.cards.changesRequested)} to={list({ lifecycle: 'CHANGES_REQUESTED' })} icon={<CornerUpLeft className="size-5" />} tone="amber" />
            <Stat label="Approved activities" value={fmtNum(d.cards.approved)} to={list({ lifecycle: 'APPROVED' })} icon={<BadgeCheck className="size-5" />} tone="green" hint="Approved, execution not started" />
            <Stat label="Completed activities" value={fmtNum(d.cards.completed)} to={list({ lifecycle: 'COMPLETED' })} icon={<CheckCircle2 className="size-5" />} tone="green" />
            <Stat label="Overdue activities" value={fmtNum(d.cards.overdue)} to={list({ overdue: '1', lifecycle: '' })} icon={<AlarmClock className="size-5" />} tone={d.cards.overdue ? 'red' : 'gray'} hint="Past end date or task deadline" />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Activities by month" subtitle="By start month" rows={d.charts.monthly} columns={[{ key: 'month', label: 'Month' }, { key: 'value', label: 'Activities', numeric: true }]}><Columns data={d.charts.monthly} valueLabel="Activities" /></ChartCard>
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
      )}
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
