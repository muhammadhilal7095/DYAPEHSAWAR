import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  Activity, ArrowRight, BedDouble, BellRing, CalendarCheck, CheckCircle2, CalendarDays, ClipboardCheck, ClipboardList, CornerUpLeft, FilePlus2, GraduationCap, Hotel, Inbox, Landmark,
  ListChecks, Map, PlayCircle, Send, Stamp, TrendingUp,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { qs } from '../lib/api';
import { fmtDate, fmtDateTime, fmtNum } from '../lib/format';
import { Badge, Card, Stat, cx } from '../components/ui';

export default function Home() {
  const { me, can } = useAuth();
  const { data: s } = useApi('/api/tasks/summary');
  const { data: tasks } = useApi('/api/tasks');
  const daamr = can('daamr.request.create', 'daamr.report.create', 'daamr.assign');
  const courses = can('course.access', 'course.view_all', 'course.view_district', 'course.manage');
  const { data: mine } = useApi(daamr ? '/api/daamr/assignments?status=open&pageSize=5' : null);
  const { data: cd } = useApi(courses ? '/api/courses/dashboard?mine=1' : null);
  const { data: notes } = useApi('/api/admin/notifications?pageSize=5');
  const activityStats = can('daamr.dashboard', 'daamr.request.create', 'daamr.report.create', 'daamr.assign');
  const { data: ad } = useApi(activityStats ? '/api/daamr/dashboard/activities' : null);

  const actions = [
    can('daamr.request.create') && { to: '/daamr/requests/new', label: 'Create activity', hint: 'Event or course proposal', icon: <FilePlus2 className="size-5" /> },
    (s?.assignedTotal ?? 0) > 0 && { to: '/tasks', label: 'Review pending items', hint: `${s.assignedTotal} waiting for you`, icon: <Stamp className="size-5" />, tone: 'amber' },
    cd?.today?.length > 0 && { to: `/courses/${cd.today[0].courseId}/sessions/${cd.today[0].id}`, label: "Today's daily report", hint: `${cd.today[0].course.title} · Day ${cd.today[0].dayNumber}`, icon: <CalendarDays className="size-5" />, tone: 'blue' },
    daamr && { to: '/daamr/assignments', label: 'My assignments', hint: mine ? `${mine.total} open task(s)` : 'Tasks assigned to you', icon: <ListChecks className="size-5" /> },
    courses && { to: '/courses', label: 'Courses & daily reports', hint: 'Schedules, sessions, final reports', icon: <GraduationCap className="size-5" /> },
    can('hostel.booking.create') && { to: '/hostels/bookings/new', label: 'Book a youth hostel', hint: 'New booking request', icon: <BedDouble className="size-5" /> },
    can('hostel.operations') && { to: '/hostels/operations', label: 'Check-in / check-out', hint: 'Arrivals and departures', icon: <CalendarCheck className="size-5" /> },
    can('jm.report.create') && { to: '/jm/reports/new', label: 'Monitoring report', hint: 'Jawan Markaz site inspection', icon: <ClipboardCheck className="size-5" /> },
    can('jm.asset.manage') && { to: '/jm/assets', label: 'Asset register', hint: 'Jawan Markaz assets', icon: <Map className="size-5" /> },
  ].filter(Boolean).slice(0, 8) as { to: string; label: string; hint: string; icon: ReactNode; tone?: string }[];

  const modules = [
    can('daamr.dashboard', 'daamr.request.create', 'daamr.report.create', 'daamr.assign') && {
      to: '/daamr', title: 'Activity Management', icon: <Activity className="size-5" />, n: (s?.assigned?.DAAMR_REQUEST ?? 0) + (s?.assigned?.DAAMR_REPORT ?? 0) + (s?.assigned?.COURSE_SESSION ?? 0) + (s?.assigned?.COURSE_COMPLETION ?? 0),
      links: [['Activities', '/daamr/requests'], ['Courses', '/courses'], ['Execution reports', '/daamr/reports']],
    },
    can('hostel.dashboard', 'hostel.booking.create', 'hostel.operations') && {
      to: '/hostels', title: 'Youth Hostels', icon: <Hotel className="size-5" />, n: s?.assigned?.HOSTEL_BOOKING ?? 0,
      links: [['Booking register', '/hostels/bookings'], ...(can('hostel.dashboard') ? [['Utilization', '/hostels/reports']] : [])],
    },
    can('jm.dashboard', 'jm.report.create') && {
      to: '/jm', title: 'Jawan Markaz', icon: <Landmark className="size-5" />, n: s?.assigned?.JM_REPORT ?? 0,
      links: [['Monitoring reports', '/jm/reports'], ['Assets', '/jm/assets'], ['Issues & risks', '/jm/registers']],
    },
  ].filter(Boolean) as { to: string; title: string; icon: ReactNode; n: number; links: string[][] }[];

  const work = tasks ? [...tasks.returned.map((t: any) => ({ ...t, kind: 'Returned to you' })), ...tasks.assigned.map((t: any) => ({ ...t, kind: 'For your review' }))] : null;

  return (
    <>
      <div className="relative mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-800 to-[#062a1a] px-5 py-6 text-white shadow-md sm:px-7">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex shrink-0 gap-2">
              <img src="/logos/kp-govt.jpg" alt="Government of Khyber Pakhtunkhwa" className="size-12 rounded-xl object-cover ring-2 ring-white/25 sm:size-14" />
              <img src="/logos/dya.jpg" alt="Directorate of Youth Affairs" className="size-12 rounded-xl bg-white object-contain p-0.5 ring-2 ring-white/25 sm:size-14" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-200/80">Directorate of Youth Affairs · Khyber Pakhtunkhwa</p>
              <h1 className="mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">Executive Dashboard</h1>
              <p className="mt-0.5 text-sm text-white/75">Welcome, {me?.name}{me?.designation ? ` — ${me.designation}` : ''}{me?.district?.name ? `, ${me.district.name}` : ''}</p>
            </div>
          </div>
          <div className="rounded-lg bg-white/10 px-3 py-2 text-right ring-1 ring-white/15">
            <p className="text-[11px] uppercase tracking-wide text-white/60">{new Date().toLocaleDateString('en-GB', { weekday: 'long' })}</p>
            <p className="text-sm font-semibold">{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <HeroStat to="/tasks" icon={<Inbox className="size-4" />} label="Awaiting my review" value={s?.assignedTotal} />
          <HeroStat to="/tasks" icon={<CornerUpLeft className="size-4" />} label="Returned to me" value={s?.returned} />
          <HeroStat icon={<Send className="size-4" />} label="My items in review" value={s?.submittedOpen} />
          <HeroStat to="/notifications" icon={<BellRing className="size-4" />} label="Unread notifications" value={s?.unread} />
        </div>
      </div>

      {activityStats && <ActivityOverview d={ad} allDistricts={can('daamr.request.view_all')} />}

      {actions.length > 0 && (
        <section aria-labelledby="qa" className="mb-6">
          <h2 id="qa" className="mb-3 border-b border-line pb-2 text-base font-semibold text-ink">Quick Actions</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {actions.map((a) => (
              <Link key={a.to} to={a.to} className={cx('group flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md', a.tone === 'amber' ? 'border-amber-200' : a.tone === 'blue' ? 'border-blue-200' : 'border-line')}>
                <span className={cx('grid size-11 shrink-0 place-items-center rounded-xl', a.tone === 'amber' ? 'bg-amber-50 text-amber-700' : a.tone === 'blue' ? 'bg-blue-50 text-blue-700' : 'bg-brand-50 text-brand')}>{a.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{a.label}</span>
                  <span className="block truncate text-xs text-ink-3">{a.hint}</span>
                </span>
                <ArrowRight className="size-4 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-brand" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <Card title="Waiting for you" className="xl:col-span-2" actions={<Link to="/tasks" className="text-sm font-medium text-brand hover:underline">All tasks</Link>} bodyClass="p-0">
          {!work ? <p className="p-4 text-sm text-ink-3">Loading…</p> : !work.length ? (
            <div className="flex items-center gap-3 p-5 text-sm text-ink-2"><span className="grid size-9 place-items-center rounded-full bg-emerald-50 text-emerald-700">✓</span>You're all caught up — nothing is waiting for your review or correction.</div>
          ) : (
            <ul className="divide-y divide-line">
              {work.slice(0, 7).map((t: any) => (
                <li key={t.id}>
                  <Link to={t.link} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-gray-50">
                    <Badge tone={t.kind === 'Returned to you' ? 'orange' : 'amber'} label={t.kind} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{t.title}</span>
                    <span className="text-xs text-ink-3">{t.moduleLabel} · {fmtDateTime(t.assignedAt ?? t.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          {courses && (
            <Card title="Today's training sessions" bodyClass="p-0" actions={<Link to="/courses" className="text-sm font-medium text-brand hover:underline">Courses</Link>}>
              {!cd ? <p className="p-4 text-sm text-ink-3">Loading…</p> : cd.today.length ? (
                <ul className="divide-y divide-line">
                  {cd.today.slice(0, 5).map((x: any) => (
                    <li key={x.id}>
                      <Link to={`/courses/${x.courseId}/sessions/${x.id}`} className="block px-4 py-2.5 hover:bg-gray-50">
                        <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{x.course.title}</span><Badge status={x.status} /></span>
                        <span className="text-xs text-ink-3">Day {x.dayNumber} · {x.course.venue}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="p-4 text-sm text-ink-3">No sessions scheduled today.</p>}
            </Card>
          )}
          {daamr && (
            <Card title="My activity tasks" bodyClass="p-0" actions={<Link to="/daamr/assignments" className="text-sm font-medium text-brand hover:underline">All</Link>}>
              {!mine ? <p className="p-4 text-sm text-ink-3">Loading…</p> : mine.rows.length ? (
                <ul className="divide-y divide-line">
                  {mine.rows.map((a: any) => (
                    <li key={a.id}>
                      <Link to={`/daamr/requests/${a.activity.id}?tab=assignments`} className="block px-4 py-2.5 hover:bg-gray-50">
                        <span className="block truncate text-sm font-medium">{a.activity.subject}</span>
                        <span className={cx('text-xs', a.overdue ? 'font-medium text-red-700' : 'text-ink-3')}>{a.deadline ? `Due ${fmtDate(a.deadline)}${a.overdue ? ' · overdue' : ''}` : 'No deadline'} · {a.isLead ? 'Responsible officer' : 'Supporting'}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="p-4 text-sm text-ink-3">No open tasks assigned to you.</p>}
            </Card>
          )}
          <Card title="Recent notifications" bodyClass="p-0" actions={<Link to="/notifications" className="text-sm font-medium text-brand hover:underline">All</Link>}>
            {notes?.rows?.length ? (
              <ul className="divide-y divide-line">
                {notes.rows.slice(0, 5).map((n: any) => (
                  <li key={n.id}>
                    <Link to={n.link ?? '/notifications'} className="flex gap-2 px-4 py-2.5 hover:bg-gray-50">
                      {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                      <span className="min-w-0"><span className="line-clamp-2 text-sm">{n.title}</span><span className="text-xs text-ink-3">{fmtDateTime(n.createdAt)}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="p-4 text-sm text-ink-3">No notifications.</p>}
          </Card>
        </div>
      </div>

      {modules.length > 0 && (
        <section className="mt-6" aria-labelledby="mods">
          <h2 id="mods" className="mb-3 border-b border-line pb-2 text-base font-semibold text-ink">Modules</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {modules.map((m) => (
              <div key={m.to} className="rounded-xl border border-line bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <Link to={m.to} className="flex items-center gap-2.5 font-semibold text-ink hover:text-brand"><span className="rounded-lg bg-brand-50 p-2 text-brand">{m.icon}</span>{m.title}</Link>
                  {m.n > 0 && <Badge tone="amber" label={`${m.n} for you`} />}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Link to={m.to} className="rounded-full bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-700">Dashboard</Link>
                  {m.links.map(([l, to]) => <Link key={to} to={to} className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:border-brand-200 hover:text-brand">{l}</Link>)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const activityList = (extra: Record<string, string>) => `/daamr/requests${qs({ scope: 'all', dateField: 'start', ...extra })}`;

function ActivityOverview({ d, allDistricts }: { d: any; allDistricts: boolean }) {
  const rows: any[] = d?.charts?.districtStatus ?? [];
  const c = d?.cards;
  const rate = c?.total ? Math.round((c.completed / c.total) * 100) : 0;
  const sum = (k: string) => rows.reduce((n, r) => n + r[k], 0);
  const kpis = [
    { label: 'Total activities', value: c && fmtNum(c.total), note: 'Submitted · drafts excluded', icon: <ClipboardList className="size-5" />, to: activityList({}), accent: 'border-t-brand', chip: 'bg-brand-50 text-brand' },
    { label: 'Running activities', value: c && fmtNum(c.inProgress), note: 'Approved and under execution', icon: <PlayCircle className="size-5" />, to: activityList({ lifecycle: 'IN_PROGRESS' }), accent: 'border-t-blue-600', chip: 'bg-blue-50 text-blue-700' },
    { label: 'Completed activities', value: c && fmtNum(c.completed), note: 'Execution report verified', icon: <CheckCircle2 className="size-5" />, to: activityList({ lifecycle: 'COMPLETED' }), accent: 'border-t-emerald-600', chip: 'bg-emerald-50 text-emerald-700' },
    { label: 'Completion rate', value: c && `${rate}%`, note: 'Completed as a share of total', icon: <TrendingUp className="size-5" />, to: '/daamr', accent: 'border-t-amber-500', chip: 'bg-amber-50 text-amber-700', bar: rate },
  ];
  return (
    <section aria-labelledby="act-overview" className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-line pb-2">
        <div>
          <h2 id="act-overview" className="text-base font-semibold text-ink">Activity Overview</h2>
          <p className="text-xs text-ink-3">{allDistricts ? 'All districts and Directorate HQ' : 'Districts within your access'} · live figures, each activity counted once</p>
        </div>
        <Link to="/daamr" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
          Full activity dashboard <ArrowRight className="size-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpis.map((k) => (
          <Link key={k.label} to={k.to} className={cx('group flex flex-col rounded-xl border border-t-4 border-line bg-white p-4 shadow-sm transition hover:shadow-md', k.accent)}>
            <span className="flex items-start justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{k.label}</span>
              <span className={cx('rounded-lg p-1.5', k.chip)}>{k.icon}</span>
            </span>
            <span className="tabular mt-2 text-3xl font-bold tracking-tight text-ink">{k.value ?? '—'}</span>
            {k.bar != null && (
              <span className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100"><span className="block h-full rounded-full bg-amber-500" style={{ width: `${k.bar}%` }} /></span>
            )}
            <span className="mt-auto flex items-end justify-between gap-2 pt-2 text-xs leading-snug text-ink-3">
              <span>{k.note}</span>
              <ArrowRight className="size-3.5 shrink-0 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
            </span>
          </Link>
        ))}
      </div>

      {rows.length > 0 && (
        <Card title="District-wise Activity Status" subtitle="Sorted by total activities · click a district to open its list" className="mt-4" bodyClass="p-0">
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 text-left text-[11px] uppercase tracking-wider text-ink-3 shadow-[inset_0_-1px_0_var(--line)]">
                <tr>
                  <th className="w-10 px-3 py-2.5 text-center font-semibold sm:px-4">#</th>
                  <th className="px-3 py-2.5 font-semibold sm:px-4"><span className="sm:hidden">District</span><span className="hidden sm:inline">District / HQ</span></th>
                  <th className="px-3 py-2.5 text-right font-semibold sm:px-4">Total</th>
                  <th className="px-3 py-2.5 text-right font-semibold sm:px-4"><span className="sm:hidden">Run.</span><span className="hidden sm:inline">Running</span></th>
                  <th className="px-3 py-2.5 text-right font-semibold sm:px-4"><span className="sm:hidden">Done</span><span className="hidden sm:inline">Completed</span></th>
                  <th className="hidden w-48 px-4 py-2.5 font-semibold sm:table-cell">Completion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r, i) => (
                  <tr key={r.id} className="odd:bg-white even:bg-gray-50/50 hover:bg-brand-50/60">
                    <td className="tabular px-3 py-2.5 text-center text-xs text-ink-3 sm:px-4">{i + 1}</td>
                    <td className="px-3 py-2.5 font-medium sm:px-4"><Link to={activityList({ districtId: r.id })} className="hover:text-brand hover:underline">{r.name}</Link></td>
                    <td className="tabular px-3 py-2.5 text-right font-semibold sm:px-4">{fmtNum(r.total)}</td>
                    <td className="px-3 py-2.5 text-right sm:px-4"><Count n={r.inProgress} tone="bg-blue-50 text-blue-700" /></td>
                    <td className="px-3 py-2.5 text-right sm:px-4"><Count n={r.completed} tone="bg-emerald-50 text-emerald-700" /></td>
                    <td className="hidden px-4 py-2.5 sm:table-cell"><Progress pct={r.total ? Math.round((r.completed / r.total) * 100) : 0} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-brand-50 text-sm font-semibold text-ink shadow-[inset_0_1px_0_var(--line)]">
                <tr>
                  <td className="px-3 py-2.5 sm:px-4" />
                  <td className="px-3 py-2.5 sm:px-4">{allDistricts ? 'Provincial total' : 'Total'}</td>
                  <td className="tabular px-3 py-2.5 text-right sm:px-4">{fmtNum(sum('total'))}</td>
                  <td className="tabular px-3 py-2.5 text-right text-blue-700 sm:px-4">{fmtNum(sum('inProgress'))}</td>
                  <td className="tabular px-3 py-2.5 text-right text-emerald-700 sm:px-4">{fmtNum(sum('completed'))}</td>
                  <td className="hidden px-4 py-2.5 sm:table-cell"><Progress pct={rate} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </section>
  );
}

function Count({ n, tone }: { n: number; tone: string }) {
  return n ? <span className={cx('tabular inline-block min-w-7 rounded-md px-1.5 py-0.5 text-center text-xs font-semibold', tone)}>{fmtNum(n)}</span> : <span className="tabular text-ink-3">0</span>;
}

function Progress({ pct }: { pct: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></span>
      <span className="tabular w-9 text-right text-xs text-ink-2">{pct}%</span>
    </span>
  );
}

function HeroStat({ to, icon, label, value }: { to?: string; icon: ReactNode; label: string; value?: number }) {
  const body = (
    <div className="rounded-xl bg-white/10 px-4 py-3 transition hover:bg-white/15">
      <p className="flex items-center gap-1.5 text-xs text-white/75">{icon}{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{value ?? '—'}</p>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

