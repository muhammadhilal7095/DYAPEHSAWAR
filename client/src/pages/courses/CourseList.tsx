import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Trash2, Ban, AlarmClock, ArrowRight, CalendarClock, CheckCircle2, ClipboardCheck, FileClock, GraduationCap, MapPin, PlayCircle, Stamp } from 'lucide-react';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDistricts, useLookups, useQueryState } from '../../lib/hooks';
import { fmtDate, fmtNum, humanize } from '../../lib/format';
import { Badge, Card, PageHeader, Pagination, cx } from '../../components/ui';
import { CourseRemoveModal } from './CourseDetail';
import { DataTable, ExportMenu, FilterBar, MiniDate, MiniSelect, SearchInput } from '../../components/DataTable';

export const COURSE_STATUSES = ['AWAITING_START', 'IN_PROGRESS', 'AWAITING_VERIFICATION', 'COMPLETED', 'CANCELLED'];

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <div className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label="Completion">
        <div className={cx('h-full rounded-full', value >= 100 ? 'bg-emerald-600' : 'bg-brand')} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="tabular w-9 text-right text-xs font-medium text-ink-2">{value}%</span>
    </div>
  );
}

const EMPTY = { q: '', districtId: '', category: '', coordinatorId: '', trainer: '', status: '', from: '', to: '', reportsPending: '', overdue: '', mine: '' };

export default function CourseList() {
  const { can } = useAuth();
  const nav = useNavigate();
  const districts = useDistricts();
  const categories = useLookups('ACTIVITY_CATEGORY');
  const people = useCached<any[]>('/api/admin/directory') ?? [];
  const [q, setQ] = useQueryState({ ...EMPTY, page: '1' });
  const filters = { ...q, page: '' };
  const dash = useApi(`/api/courses/dashboard${qs({ districtId: q.districtId, category: q.category, coordinatorId: q.coordinatorId, trainer: q.trainer, from: q.from, to: q.to })}`);
  const { data, loading, reload } = useApi(`/api/courses${qs(q)}`);
  const [remove, setRemove] = useState<{ course: any; mode: 'delete' | 'cancel' } | null>(null);
  const d = dash.data;
  const card = (p: Partial<typeof EMPTY>) => () => setQ({ status: '', reportsPending: '', overdue: '', ...p, page: '1' });
  const activeCard = q.reportsPending ? 'pending' : q.overdue ? 'overdue' : q.status || 'all';
  const strip = d && [
    { key: 'all', label: 'Total courses', value: d.cards.total, icon: GraduationCap, tone: 'text-brand', onClick: card({}) },
    { key: 'AWAITING_START', label: 'Upcoming', value: d.cards.upcoming, icon: CalendarClock, tone: 'text-sky-700', onClick: card({ status: 'AWAITING_START' }) },
    { key: 'IN_PROGRESS', label: 'In progress', value: d.cards.inProgress, icon: PlayCircle, tone: 'text-blue-700', onClick: card({ status: 'IN_PROGRESS' }) },
    { key: 'pending', label: 'Reports pending', value: d.cards.dailyReportsPending, note: `${d.cards.coursesWithPendingReports} course(s)`, icon: FileClock, tone: 'text-amber-700', onClick: card({ reportsPending: '1' }) },
    { key: 'AWAITING_VERIFICATION', label: 'Awaiting verification', value: d.cards.awaitingVerification, icon: ClipboardCheck, tone: 'text-amber-700', onClick: card({ status: 'AWAITING_VERIFICATION' }) },
    { key: 'COMPLETED', label: 'Completed', value: d.cards.completed, icon: CheckCircle2, tone: 'text-emerald-700', onClick: card({ status: 'COMPLETED' }) },
    { key: 'overdue', label: 'Overdue', value: d.cards.overdue, note: 'Late reports / past end', icon: AlarmClock, tone: d.cards.overdue ? 'text-red-700' : 'text-ink-3', onClick: card({ overdue: '1' }) },
  ];
  return (
    <>
      <PageHeader
        title="Course Management"
        subtitle="Approved course proposals become courses automatically; progress follows the verified daily session reports."
        actions={can('course.export') && <ExportMenu compact label="Export" formats={['xlsx']} url={() => `/api/courses/export${qs(filters)}`} />}
      />
      {strip && (
        <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-white shadow-sm sm:grid-cols-4 xl:grid-cols-7">
          {strip.map(({ key, label, value, note, icon: Icon, tone, onClick }, i) => (
            <button
              key={key}
              onClick={onClick}
              aria-pressed={activeCard === key}
              className={cx(
                'relative border-b border-r border-line p-4 text-left transition hover:bg-gray-50 xl:border-b-0',
                i === strip.length - 1 && 'max-sm:col-span-2',
                activeCard === key && 'bg-brand-50/70 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-brand',
              )}
            >
              <span className="flex min-h-[2rem] items-start gap-1.5 text-[11px] font-semibold uppercase leading-tight tracking-wider text-ink-3">
                <Icon className={cx('mt-px size-3.5 shrink-0', tone)} aria-hidden />
                <span>{label}</span>
              </span>
              <span className="tabular mt-1 block text-2xl font-bold tracking-tight text-ink">{fmtNum(value)}</span>
              <span className="block h-4 truncate text-[11px] text-ink-3">{note}</span>
            </button>
          ))}
        </div>
      )}
      {d && (d.today.length > 0 || d.awaitingMyReview > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
          <Card title="Today's training sessions" subtitle={fmtDate(new Date().toISOString())} actions={<Badge tone="blue" label={`${d.today.length} session${d.today.length === 1 ? '' : 's'}`} />} bodyClass="p-0">
            {d.today.length ? (
              <ul className="divide-y divide-line">
                {d.today.map((x: any) => (
                  <li key={x.id}>
                    <Link to={`/courses/${x.courseId}/sessions/${x.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-center leading-none text-brand ring-1 ring-brand-100">
                        <span><span className="block text-[9px] font-semibold uppercase">Day</span><span className="tabular text-sm font-bold">{x.dayNumber}</span></span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{x.course.title}</span>
                        <span className="block truncate text-xs text-ink-3">{[x.topic, x.course.venue].filter(Boolean).join(' · ')}</span>
                      </span>
                      <Badge status={x.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 py-3 text-sm text-ink-3">No sessions today.</p>}
          </Card>
          <Link to="/tasks" className="group flex items-center gap-4 rounded-xl border border-line border-l-4 border-l-amber-500 bg-white p-4 shadow-sm transition hover:shadow-md">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-200"><Stamp className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-3">Awaiting my review</span>
              <span className="tabular block text-2xl font-bold text-ink">{d.awaitingMyReview}</span>
              <span className="block text-xs text-ink-3">Daily and completion reports</span>
            </span>
            <ArrowRight className="size-4 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-brand" />
          </Link>
        </div>
      )}

      <Card bodyClass="p-0" className="mt-5">
        <FilterBar
          onReset={() => setQ({ ...EMPTY, page: '1' })}
          moreActive={[q.category, q.coordinatorId, q.trainer, q.from, q.to].filter(Boolean).length}
          more={
            <>
              <MiniSelect label="Category" value={q.category} onChange={(v) => setQ({ category: v, page: '1' })} options={categories.map((c) => ({ value: c.value, label: c.label }))} />
              <MiniSelect label="Coordinator" value={q.coordinatorId} onChange={(v) => setQ({ coordinatorId: v, page: '1' })} options={people.map((u) => ({ value: u.id, label: u.name }))} />
              <label className="flex w-[calc(50%-0.375rem)] flex-col gap-1 text-xs font-medium text-ink-3 sm:w-auto">
                Trainer
                <input className="w-full rounded-lg border border-line bg-white px-2.5 py-2 text-sm text-ink shadow-sm focus:border-brand focus:outline-none sm:w-40" value={q.trainer} onChange={(e) => setQ({ trainer: e.target.value, page: '1' })} placeholder="Name" />
              </label>
              <MiniDate label="From" value={q.from} onChange={(v) => setQ({ from: v, page: '1' })} />
              <MiniDate label="To" value={q.to} onChange={(v) => setQ({ to: v, page: '1' })} />
            </>
          }
        >
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v, page: '1' })} placeholder="Search by ID, title, venue, coordinator…" />
          <MiniSelect label="District / HQ" value={q.districtId} onChange={(v) => setQ({ districtId: v, page: '1' })} options={districts.map((x) => ({ value: x.id, label: x.name }))} />
          <MiniSelect label="Status" value={q.status} onChange={(v) => setQ({ status: v, page: '1' })} options={COURSE_STATUSES.map((s) => ({ value: s, label: s === 'AWAITING_START' ? 'Upcoming' : humanize(s) }))} />
          <MiniSelect label="Show" value={q.reportsPending ? 'pending' : q.overdue ? 'overdue' : q.mine ? 'mine' : ''} onChange={(v) => setQ({ reportsPending: v === 'pending' ? '1' : '', overdue: v === 'overdue' ? '1' : '', mine: v === 'mine' ? '1' : '', page: '1' })} options={[{ value: 'mine', label: 'My courses' }, { value: 'pending', label: 'Daily reports pending' }, { value: 'overdue', label: 'Overdue' }]} all="All courses" />
        </FilterBar>
        {data && (
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs text-ink-3">
            <span><span className="tabular font-semibold text-ink">{data.total}</span> {data.total === 1 ? 'course' : 'courses'}</span>
            <span className="hidden sm:inline">Click a row to open the course</span>
          </div>
        )}
        <DataTable
          loading={loading}
          rows={data?.rows}
          onRowClick={(r: any) => nav(`/courses/${r.id}`)}
          empty="No courses match these filters. Courses appear here when a course proposal receives final approval."
          columns={[
            {
              key: 'title', header: 'Course', primary: true, render: (r: any) => (
                <div className="min-w-[220px] max-w-sm">
                  <span className="font-mono text-[11px] font-medium text-brand">{r.courseNo}</span>
                  <span className="mt-0.5 line-clamp-2 font-medium leading-snug text-ink">{r.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-3">
                    <span className="inline-flex items-center gap-1 font-medium text-ink-2"><MapPin className="size-3" aria-hidden />{r.district.name}</span>
                    {r.category && <span>· {humanize(r.category)}</span>}
                  </span>
                  {r.venue && <span className="mt-0.5 line-clamp-1 text-xs text-ink-3">{r.venue}</span>}
                  <span className="mt-1 block text-xs text-ink-3 @[63rem]:hidden">Coordinator: <span className="text-ink-2">{r.coordinator.name}</span></span>
                </div>
              ),
            },
            {
              key: 'dates', header: 'Schedule', render: (r: any) => (
                <div className="whitespace-nowrap">
                  <span className="block">{fmtDate(r.startDate)}</span>
                  <span className="block text-xs text-ink-3">to {fmtDate(r.endDate)}</span>
                  <span className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">{r.durationDays} training day{r.durationDays === 1 ? '' : 's'}</span>
                </div>
              ),
            },
            {
              key: 'team', header: 'Team', className: 'hidden @[63rem]:table-cell', hideOnCard: true, render: (r: any) => (
                <div className="min-w-[150px] max-w-[200px]">
                  <span className="inline-flex items-center gap-1.5 text-sm"><Avatar name={r.coordinator.name} />{r.coordinator.name}</span>
                  <span className="mt-1 block text-[11px] text-ink-3">Coordinator</span>
                  {r.trainers.length > 0 && <span className="mt-1 line-clamp-2 text-xs text-ink-2"><span className="text-ink-3">Trainers: </span>{r.trainers.map((t: any) => t.name).join(', ')}</span>}
                </div>
              ),
            },
            {
              key: 'progress', header: 'Progress', render: (r: any) => (
                <div className="w-36">
                  <ProgressBar value={r.completionPercent} />
                  <span className="mt-1 block text-[11px] text-ink-3">{r.verifiedSessions}/{r.totalSessions} days verified</span>
                  {r.pendingReports > 0 && <span className="block text-[11px] font-medium text-amber-700">{r.pendingReports} report{r.pendingReports === 1 ? '' : 's'} pending</span>}
                </div>
              ),
            },
            { key: 'status', header: 'Status', render: (r: any) => <div className="flex min-w-[120px] flex-col items-start gap-1"><Badge status={r.status} />{r.overdue && <Badge tone="red" label="Overdue" />}</div> },
            ...(can('course.manage') ? [{ key: 'actions', header: <span className="sr-only">Actions</span>, hideOnCard: true, className: 'text-right', render: (r: any) => (r.status === 'COMPLETED' || r.status === 'CANCELLED' ? null : (
              <button onClick={(e) => { e.stopPropagation(); setRemove({ course: r, mode: r.deletable ? 'delete' : 'cancel' }); }} title={r.deletable ? 'Delete course' : 'Cancel course (reports already submitted)'} aria-label={r.deletable ? 'Delete course' : 'Cancel course'} className="rounded-md p-1.5 text-ink-3 hover:bg-red-50 hover:text-red-700">
                {r.deletable ? <Trash2 className="size-4" /> : <Ban className="size-4" />}
              </button>
            )) }] : []),
          ]}
        />
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ page: String(p) })} />}
      </Card>
      {remove && <CourseRemoveModal course={remove.course} mode={remove.mode} onClose={() => setRemove(null)} onDone={() => { reload(); dash.reload(); }} />}
    </>
  );
}

function Avatar({ name }: { name: string }) {
  return <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand ring-1 ring-brand-100">{name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>;
}
