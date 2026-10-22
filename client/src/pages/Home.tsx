import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  Activity, ArrowRight, BedDouble, BellRing, CalendarCheck, CheckCircle2, CalendarDays, ClipboardCheck, ClipboardList, CornerUpLeft, FilePlus2, GraduationCap, Hotel, Inbox, Landmark,
  ListChecks, Map, PlayCircle, Send, Stamp,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { qs } from '../lib/api';
import { fmtDate, fmtDateTime, fmtNum } from '../lib/format';
import { Badge, Card, Stat, cx } from '../components/ui';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

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
      <div className="mb-6 overflow-hidden rounded-2xl bg-brand-800 px-6 py-6 text-white shadow-sm">
        <p className="text-sm text-white/70">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <h1 className="mt-1 text-2xl font-semibold">{greeting()}, {me?.name}</h1>
        <p className="mt-0.5 text-sm text-white/75">{[me?.designation, me?.district?.name].filter(Boolean).join(' · ')}</p>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <HeroStat to="/tasks" icon={<Inbox className="size-4" />} label="Awaiting my review" value={s?.assignedTotal} />
          <HeroStat to="/tasks" icon={<CornerUpLeft className="size-4" />} label="Returned to me" value={s?.returned} />
          <HeroStat icon={<Send className="size-4" />} label="My items in review" value={s?.submittedOpen} />
          <HeroStat to="/notifications" icon={<BellRing className="size-4" />} label="Unread notifications" value={s?.unread} />
        </div>
      </div>

      {activityStats && <ActivityOverview d={ad} allDistricts={can('daamr.request.view_all')} />}

      {actions.length > 0 && (
        <section aria-labelledby="qa" className="mb-6">
          <h2 id="qa" className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-3">Quick actions</h2>
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
          <h2 id="mods" className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-3">Modules</h2>
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
  const tiles = [
    { label: 'Total activities', value: d?.cards.total, hint: 'Submitted, all stages (drafts excluded)', icon: <ClipboardList className="size-6" />, to: activityList({}), tone: 'bg-brand-50 text-brand ring-brand-100' },
    { label: 'Running activities', value: d?.cards.inProgress, hint: 'Approved and currently being executed', icon: <PlayCircle className="size-6" />, to: activityList({ lifecycle: 'IN_PROGRESS' }), tone: 'bg-blue-50 text-blue-700 ring-blue-100' },
    { label: 'Completed activities', value: d?.cards.completed, hint: 'Execution report verified', icon: <CheckCircle2 className="size-6" />, to: activityList({ lifecycle: 'COMPLETED' }), tone: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  ];
  return (
    <section aria-labelledby="act-overview" className="mb-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="act-overview" className="text-sm font-semibold uppercase tracking-wide text-ink-3">
          Activities — {allDistricts ? 'all districts' : 'districts you can see'}
        </h2>
        <Link to="/daamr" className="text-sm font-medium text-brand hover:underline">Activity dashboard</Link>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className="group flex items-center gap-4 rounded-xl border border-line bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <span className={cx('grid size-12 shrink-0 place-items-center rounded-xl ring-1', t.tone)}>{t.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm text-ink-2">{t.label}</span>
              <span className="tabular block text-3xl font-semibold text-ink">{t.value == null ? '—' : fmtNum(t.value)}</span>
              <span className="block truncate text-xs text-ink-3">{t.hint}</span>
            </span>
          </Link>
        ))}
      </div>
      {rows.length > 0 && (
        <Card title="By district" className="mt-3" bodyClass="p-0">
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-3 py-2 sm:px-4 font-medium"><span className="sm:hidden">District</span><span className="hidden sm:inline">District / HQ</span></th>
                  <th className="px-3 py-2 sm:px-4 text-right font-medium">Total</th>
                  <th className="px-3 py-2 sm:px-4 text-right font-medium"><span className="sm:hidden">Run.</span><span className="hidden sm:inline">Running</span></th>
                  <th className="px-3 py-2 sm:px-4 text-right font-medium"><span className="sm:hidden">Done</span><span className="hidden sm:inline">Completed</span></th>
                  <th className="hidden px-3 py-2 sm:px-4 font-medium sm:table-cell">Completion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const pct = r.total ? Math.round((r.completed / r.total) * 100) : 0;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 sm:px-4 font-medium"><Link to={activityList({ districtId: r.id })} className="hover:text-brand hover:underline">{r.name}</Link></td>
                      <td className="tabular px-3 py-2 sm:px-4 text-right">{fmtNum(r.total)}</td>
                      <td className="tabular px-3 py-2 sm:px-4 text-right text-blue-700">{fmtNum(r.inProgress)}</td>
                      <td className="tabular px-3 py-2 sm:px-4 text-right text-emerald-700">{fmtNum(r.completed)}</td>
                      <td className="hidden px-3 py-2 sm:px-4 sm:table-cell">
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></span>
                          <span className="tabular text-xs text-ink-3">{pct}%</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
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

