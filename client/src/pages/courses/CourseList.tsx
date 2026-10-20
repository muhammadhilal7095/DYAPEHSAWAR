import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Trash2, Ban, AlarmClock, CalendarClock, CheckCircle2, ClipboardCheck, FileClock, GraduationCap, PlayCircle, Stamp } from 'lucide-react';
import { qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useCached, useDistricts, useLookups, useQueryState } from '../../lib/hooks';
import { fmtDate, fmtNum, humanize } from '../../lib/format';
import { Badge, Card, PageHeader, Pagination, Stat, cx } from '../../components/ui';
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
  return (
    <>
      <PageHeader
        title="Course Management"
        subtitle="Courses are created automatically when a course proposal receives final approval. Progress is calculated from the daily session reports and their verification."
        actions={can('course.export') && <ExportMenu label="Export workbook" formats={['xlsx']} url={() => `/api/courses/export${qs(filters)}`} />}
      />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
            <button className="text-left" onClick={card({})}><Stat label="Total approved courses" value={fmtNum(d.cards.total)} icon={<GraduationCap className="size-5" />} /></button>
            <button className="text-left" onClick={card({ status: 'AWAITING_START' })}><Stat label="Upcoming" value={fmtNum(d.cards.upcoming)} icon={<CalendarClock className="size-5" />} tone="blue" /></button>
            <button className="text-left" onClick={card({ status: 'IN_PROGRESS' })}><Stat label="In progress" value={fmtNum(d.cards.inProgress)} icon={<PlayCircle className="size-5" />} tone="blue" /></button>
            <button className="text-left" onClick={card({ reportsPending: '1' })}><Stat label="Daily reports pending" value={fmtNum(d.cards.dailyReportsPending)} hint={`${d.cards.coursesWithPendingReports} course(s)`} icon={<FileClock className="size-5" />} tone="amber" /></button>
            <button className="text-left" onClick={card({ status: 'AWAITING_VERIFICATION' })}><Stat label="Awaiting verification" value={fmtNum(d.cards.awaitingVerification)} icon={<ClipboardCheck className="size-5" />} tone="amber" /></button>
            <button className="text-left" onClick={card({ status: 'COMPLETED' })}><Stat label="Completed" value={fmtNum(d.cards.completed)} icon={<CheckCircle2 className="size-5" />} tone="green" /></button>
            <button className="text-left" onClick={card({ overdue: '1' })}><Stat label="Overdue" value={fmtNum(d.cards.overdue)} hint="Late reports or past end date" icon={<AlarmClock className="size-5" />} tone={d.cards.overdue ? 'red' : 'gray'} /></button>
          </div>
          {(d.today.length > 0 || d.awaitingMyReview > 0) && (
            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
              <Card title={`Today's sessions (${d.today.length})`} bodyClass="p-0">
                {d.today.length ? (
                  <ul className="divide-y divide-line">
                    {d.today.map((x: any) => (
                      <li key={x.id}>
                        <Link to={`/courses/${x.courseId}/sessions/${x.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-gray-50">
                          <span><span className="font-medium text-ink">{x.course.title}</span> <span className="text-ink-3">· Day {x.dayNumber}{x.topic ? ` · ${x.topic}` : ''} · {x.course.venue}</span></span>
                          <Badge status={x.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <p className="px-4 py-3 text-sm text-ink-3">No sessions today.</p>}
              </Card>
              <Link to="/tasks" className="flex items-center gap-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm hover:shadow-md">
                <span className="grid size-11 place-items-center rounded-xl bg-amber-100 text-amber-700"><Stamp className="size-5" /></span>
                <span><span className="block text-xs font-medium uppercase tracking-wide text-ink-3">Awaiting my review</span><span className="tabular block text-2xl font-semibold">{d.awaitingMyReview}</span><span className="text-xs text-ink-3">Daily reports and completion reports</span></span>
              </Link>
            </div>
          )}
        </>
      )}

      <Card bodyClass="p-0" className="mt-5">
        <FilterBar onReset={() => setQ({ ...EMPTY, page: '1' })}>
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v, page: '1' })} placeholder="Course ID, title, venue, coordinator or trainer…" />
          <MiniSelect label="District / HQ" value={q.districtId} onChange={(v) => setQ({ districtId: v, page: '1' })} options={districts.map((x) => ({ value: x.id, label: x.name }))} />
          <MiniSelect label="Category" value={q.category} onChange={(v) => setQ({ category: v, page: '1' })} options={categories.map((c) => ({ value: c.value, label: c.label }))} />
          <MiniSelect label="Coordinator" value={q.coordinatorId} onChange={(v) => setQ({ coordinatorId: v, page: '1' })} options={people.map((u) => ({ value: u.id, label: u.name }))} />
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">Trainer<input className="rounded-lg border border-line px-2.5 py-2 text-sm text-ink" value={q.trainer} onChange={(e) => setQ({ trainer: e.target.value, page: '1' })} placeholder="Name" /></label>
          <MiniSelect label="Status" value={q.status} onChange={(v) => setQ({ status: v, page: '1' })} options={COURSE_STATUSES.map((s) => ({ value: s, label: s === 'AWAITING_START' ? 'Upcoming' : humanize(s) }))} />
          <MiniSelect label="Show" value={q.reportsPending ? 'pending' : q.overdue ? 'overdue' : q.mine ? 'mine' : ''} onChange={(v) => setQ({ reportsPending: v === 'pending' ? '1' : '', overdue: v === 'overdue' ? '1' : '', mine: v === 'mine' ? '1' : '', page: '1' })} options={[{ value: 'mine', label: 'My courses' }, { value: 'pending', label: 'Daily reports pending' }, { value: 'overdue', label: 'Overdue' }]} all="All courses" />
          <MiniDate label="From" value={q.from} onChange={(v) => setQ({ from: v, page: '1' })} />
          <MiniDate label="To" value={q.to} onChange={(v) => setQ({ to: v, page: '1' })} />
        </FilterBar>
        <DataTable
          loading={loading}
          rows={data?.rows}
          onRowClick={(r: any) => nav(`/courses/${r.id}`)}
          empty="No courses match these filters. Courses appear here when a course proposal receives final approval."
          columns={[
            { key: 'title', header: 'Course', primary: true, render: (r: any) => <div className="min-w-[200px]"><span className="font-medium text-ink">{r.title}</span><span className="block font-mono text-xs text-ink-3">{r.courseNo}</span></div> },
            { key: 'venue', header: 'Venue', render: (r: any) => <span className="block max-w-[180px] text-sm"><span className="line-clamp-2">{r.venue}</span><span className="block text-xs text-ink-3">{r.district.name}</span></span> },
            { key: 'duration', header: 'Duration', render: (r: any) => <span className="whitespace-nowrap">{r.durationDays} days</span> },
            { key: 'dates', header: 'Dates', render: (r: any) => <span className="whitespace-nowrap">{fmtDate(r.startDate)} – {fmtDate(r.endDate)}</span> },
            { key: 'coordinator', header: 'Coordinator', render: (r: any) => r.coordinator.name },
            { key: 'trainers', header: 'Trainers', render: (r: any) => <span className="line-clamp-2 text-xs">{r.trainers.map((t: any) => t.name).join(', ') || '—'}</span>, hideOnCard: true },
            { key: 'progress', header: 'Completion', render: (r: any) => <div className="w-36"><ProgressBar value={r.completionPercent} /><span className="text-[11px] text-ink-3">{r.verifiedSessions}/{r.totalSessions} verified{r.pendingReports ? ` · ${r.pendingReports} pending` : ''}</span></div> },
            { key: 'status', header: 'Status', render: (r: any) => <div className="flex min-w-[110px] flex-col items-start gap-1"><Badge status={r.status} />{r.overdue && <Badge tone="red" label="Overdue" />}</div> },
            ...(can('course.manage') ? [{ key: 'actions', header: '', render: (r: any) => (r.status === 'COMPLETED' || r.status === 'CANCELLED' ? null : (
              <button onClick={(e) => { e.stopPropagation(); setRemove({ course: r, mode: r.deletable ? 'delete' : 'cancel' }); }} title={r.deletable ? 'Delete course' : 'Cancel course (reports already submitted)'} aria-label={r.deletable ? 'Delete course' : 'Cancel course'} className="rounded p-1.5 text-ink-3 hover:bg-red-50 hover:text-red-700">
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
