import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  Activity, BarChart3, Bell, BedDouble, Building2, CalendarCheck, ClipboardCheck, ClipboardList, FileClock, FilePlus2, Gauge, GitBranch, Images, Inbox,
  KeyRound, LayoutDashboard, LogOut, Mail, Map, Menu, Settings, ShieldAlert, Users, X, Landmark, Hotel, FolderKanban, ListChecks, Wallet, GraduationCap, ChevronDown, Plus, Search, Compass,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api, fileUrl } from '../lib/api';
import { cx } from './ui';
import { ACTIVITY_PERMS, GlobalSearch } from './GlobalSearch';

interface NavItem { to: string; label: string; icon: ReactNode; perms?: string[]; end?: boolean }
interface NavGroup { title: string; icon: ReactNode; items: NavItem[] }

const I = (C: any) => <C className="size-4 shrink-0" aria-hidden />;

const NAV: NavGroup[] = [
  {
    title: 'Overview',
    icon: I(LayoutDashboard),
    items: [
      { to: '/', label: 'Home', icon: I(LayoutDashboard), end: true },
      { to: '/tasks', label: 'My Tasks', icon: I(Inbox) },
      { to: '/notifications', label: 'Notifications', icon: I(Bell) },
    ],
  },
  {
    title: 'Activity Management',
    icon: I(Activity),
    items: [
      { to: '/daamr', label: 'Dashboard', icon: I(Gauge), end: true, perms: ['daamr.dashboard', 'daamr.request.create', 'daamr.report.create', 'daamr.assign'] },
      { to: '/daamr/requests/new', label: 'Create Activity', icon: I(FilePlus2), perms: ['daamr.request.create'] },
      { to: '/daamr/requests', label: 'Activities', icon: I(ClipboardList), end: true, perms: ACTIVITY_PERMS },
      { to: '/courses', label: 'Courses & Daily Reports', icon: I(GraduationCap), perms: ['course.access', 'course.view_all', 'course.view_district', 'course.manage'] },
      { to: '/daamr/assignments', label: 'My Assignments', icon: I(ListChecks), perms: ['daamr.report.create', 'daamr.assign', 'daamr.request.create'] },
      { to: '/daamr/reports', label: 'Execution Reports', icon: I(FolderKanban), perms: ['daamr.report.create', 'daamr.report.view_all', 'daamr.report.view_district', 'daamr.dashboard'] },
      { to: '/daamr/gallery', label: 'Picture Gallery', icon: I(Images), perms: ['daamr.request.create', 'daamr.dashboard'] },
      { to: '/daamr/summary', label: 'Participation & Budget', icon: I(Wallet), perms: ['daamr.dashboard'] },
      { to: '/daamr/analytics', label: 'Reports & Analytics', icon: I(BarChart3), perms: ['daamr.dashboard'] },
    ],
  },
  {
    title: 'Youth Hostels',
    icon: I(Hotel),
    items: [
      { to: '/hostels', label: 'Dashboard', icon: I(Gauge), end: true, perms: ['hostel.dashboard', 'hostel.booking.create', 'hostel.operations'] },
      { to: '/hostels/bookings/new', label: 'New Booking', icon: I(FilePlus2), perms: ['hostel.booking.create'] },
      { to: '/hostels/bookings', label: 'Booking Register', icon: I(ClipboardList), end: true, perms: ['hostel.booking.create', 'hostel.booking.view_all', 'hostel.booking.view_district', 'hostel.operations', 'hostel.dashboard'] },
      { to: '/hostels/operations', label: 'Check-In / Check-Out', icon: I(CalendarCheck), perms: ['hostel.operations'] },
      { to: '/hostels/manage', label: 'Hostels & Rooms', icon: I(BedDouble), perms: ['hostel.manage'] },
      { to: '/hostels/reports', label: 'Utilization Reports', icon: I(BarChart3), perms: ['hostel.dashboard'] },
    ],
  },
  {
    title: 'Jawan Markaz',
    icon: I(Landmark),
    items: [
      { to: '/jm', label: 'Monitoring Dashboard', icon: I(Gauge), end: true, perms: ['jm.dashboard', 'jm.report.create'] },
      { to: '/jm/assets', label: 'Asset Register', icon: I(Map), perms: ['jm.dashboard', 'jm.report.create', 'jm.asset.manage', 'jm.report.view_all'] },
      { to: '/jm/reports/new', label: 'New Monitoring Report', icon: I(FilePlus2), perms: ['jm.report.create'] },
      { to: '/jm/reports', label: 'Monitoring Reports', icon: I(ClipboardCheck), end: true, perms: ['jm.report.create', 'jm.report.view_all', 'jm.report.view_district', 'jm.dashboard'] },
      { to: '/jm/gallery', label: 'Site Photographs', icon: I(Images), perms: ['jm.dashboard', 'jm.report.create', 'jm.asset.manage'] },
      { to: '/jm/registers', label: 'Issues, Actions & Risks', icon: I(ShieldAlert), perms: ['jm.dashboard', 'jm.report.create'] },
      { to: '/jm/analytics', label: 'Reports & Analytics', icon: I(BarChart3), perms: ['jm.dashboard'] },
    ],
  },
  {
    title: 'Administration',
    icon: I(Settings),
    items: [
      { to: '/admin/users', label: 'Users & Roles', icon: I(Users), perms: ['admin.users'] },
      { to: '/admin/org', label: 'Districts & Departments', icon: I(Building2), perms: ['admin.org'] },
      { to: '/admin/workflows', label: 'Approval Workflows', icon: I(GitBranch), perms: ['admin.workflows'] },
      { to: '/admin/settings', label: 'System Settings', icon: I(Settings), perms: ['admin.settings'] },
      { to: '/admin/emails', label: 'Email Logs', icon: I(Mail), perms: ['email.view'] },
      { to: '/admin/audit', label: 'Audit Logs', icon: I(FileClock), perms: ['audit.view'] },
    ],
  },
];

function Brand({ compact }: { compact?: boolean }) {
  const { settings } = useAuth();
  return (
    <div className="flex items-center gap-3">
      {settings?.logoFileId ? (
        <img src={fileUrl(settings.logoFileId)} alt="" className="size-9 rounded-lg bg-white object-contain p-0.5" />
      ) : (
        <div className="grid size-9 place-items-center rounded-lg bg-white/15 text-sm font-bold text-white">DYA</div>
      )}
      {!compact && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold text-white">{settings?.orgName ?? 'Directorate of Youth Affairs'}</p>
          <p className="truncate text-[11px] text-white/70">{settings?.orgSubtitle}</p>
        </div>
      )}
    </div>
  );
}

/** Group that contains the current page (longest matching link wins). */
function activeGroupOf(groups: NavGroup[], path: string) {
  let best: { g: string; len: number } | null = null;
  for (const g of groups) for (const i of g.items) {
    const hit = i.end ? path === i.to : path === i.to || path.startsWith(i.to.endsWith('/') ? i.to : `${i.to}/`);
    if (hit && (!best || i.to.length > best.len)) best = { g: g.title, len: i.to.length };
  }
  return best?.g ?? null;
}

const NAV_STATE_KEY = 'dya.nav.open';

function Sidebar({ onNavigate, counts }: { onNavigate?: () => void; counts: Record<string, number> }) {
  const { can } = useAuth();
  const loc = useLocation();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perms || can(...i.perms)) })).filter((g) => g.items.length);
  const active = activeGroupOf(groups, loc.pathname);
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(NAV_STATE_KEY) ?? '{}'); } catch { return {}; }
  });
  // the section of the page being viewed is always expanded
  useEffect(() => { if (active && open[active] === false) setOpen((o) => ({ ...o, [active]: true })); }, [active]);
  const toggle = (t: string, now: boolean) => {
    const next = { ...open, [t]: !now };
    setOpen(next);
    try { localStorage.setItem(NAV_STATE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  return (
    <nav className="flex h-full flex-col overflow-y-auto bg-brand-800 px-3 pb-6 pt-4 text-white" aria-label="Main navigation">
      <div className="mb-5 px-2">
        <Brand />
      </div>
      {groups.map((g) => {
        const fixed = g.title === 'Overview';
        const isOpen = fixed || (open[g.title] ?? g.title === active);
        const pending = g.items.reduce((a, i) => a + (counts[i.to] ?? 0), 0);
        return (
          <div key={g.title} className="mb-2">
            {fixed ? (
              <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">{g.title}</p>
            ) : (
              <button type="button" onClick={() => toggle(g.title, isOpen)} aria-expanded={isOpen}
                className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider transition hover:bg-white/10', g.title === active ? 'text-white' : 'text-white/60')}>
                <span className="opacity-80">{g.icon}</span>
                <span className="flex-1 truncate">{g.title}</span>
                {!isOpen && pending > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">{pending}</span>}
                <ChevronDown className={cx('size-3.5 transition', isOpen ? '' : '-rotate-90')} aria-hidden />
              </button>
            )}
            {isOpen && (
              <ul className={cx('space-y-0.5', !fixed && 'mb-2 mt-0.5')}>
                {g.items.map((i) => (
                  <li key={i.to}>
                    <NavLink
                      to={i.to}
                      end={i.end}
                      onClick={onNavigate}
                      className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition', isActive ? 'bg-white font-medium text-brand-800 shadow-sm' : 'text-white/85 hover:bg-white/10 hover:text-white')}
                    >
                      {i.icon}
                      <span className="flex-1 truncate">{i.label}</span>
                      {(counts[i.to] ?? 0) > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">{counts[i.to] > 99 ? '99+' : counts[i.to]}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="mt-auto px-2 pt-4 text-[11px] text-white/45">Tip: press <kbd className="rounded bg-white/10 px-1">Ctrl</kbd> + <kbd className="rounded bg-white/10 px-1">K</kbd> to jump to any page.</p>
    </nav>
  );
}

/** Things the user can create, by permission. */
function useCreateItems() {
  const { can } = useAuth();
  return [
    can('daamr.request.create') && { to: '/daamr/requests/new', label: 'Create activity / course proposal', icon: <FilePlus2 className="size-4" /> },
    can('hostel.booking.create') && { to: '/hostels/bookings/new', label: 'New hostel booking', icon: <BedDouble className="size-4" /> },
    can('jm.report.create') && { to: '/jm/reports/new', label: 'New Jawan Markaz monitoring report', icon: <ClipboardCheck className="size-4" /> },
    can('jm.asset.manage') && { to: '/jm/assets?new=1', label: 'Register Jawan Markaz asset', icon: <Map className="size-4" /> },
  ].filter(Boolean) as { to: string; label: string; icon: ReactNode }[];
}

function CreateMenu() {
  const items = useCreateItems();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  if (!items.length) return null;
  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
        <Plus className="size-4" /><span className="hidden sm:inline">Create</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-1 w-72 rounded-xl border border-line bg-white p-1.5 shadow-lg">
          {items.map((i) => (
            <button key={i.to} role="menuitem" onClick={() => nav(i.to)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-gray-50">
              <span className="text-brand">{i.icon}</span>{i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ctrl/Cmd + K: jump to any page the user can open, or search activities. */
function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const create = useCreateItems();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  useEffect(() => { if (open) { setQ(''); setSel(0); } }, [open]);
  if (!open) return null;
  const pages = NAV.flatMap((g) => g.items.filter((i) => !i.perms || can(...i.perms)).map((i) => ({ to: i.to, label: i.label, group: g.title, icon: i.icon })));
  const all = [...create.map((c) => ({ ...c, group: 'Create' })), ...pages];
  const term = q.trim().toLowerCase();
  const hits = (term ? all.filter((x) => `${x.label} ${x.group}`.toLowerCase().includes(term)) : all).slice(0, 12);
  const options = [...hits, ...(term && can(...ACTIVITY_PERMS) ? [{ to: `/daamr/requests?scope=${can('daamr.request.view_all', 'daamr.request.view_district') ? 'all' : 'mine'}&q=${encodeURIComponent(q.trim())}`, label: `Search activities for “${q.trim()}”`, group: 'Search', icon: <Search className="size-4" /> }] : [])];
  const go = (i: number) => { const o = options[i]; if (o) { nav(o.to); onClose(); } };
  return (
    <div className="fixed inset-0 z-[2500] flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Go to page">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="size-4 text-ink-3" />
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="Go to a page or create something…" className="w-full py-3.5 text-sm outline-none"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(x + 1, options.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(x - 1, 0)); }
              if (e.key === 'Enter') go(sel);
              if (e.key === 'Escape') onClose();
            }} />
          <kbd className="rounded border border-line px-1.5 text-[11px] text-ink-3">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {options.map((o, i) => (
            <li key={o.to + o.label}>
              <button onMouseEnter={() => setSel(i)} onClick={() => go(i)} className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm', i === sel ? 'bg-brand-50 text-brand-800' : 'text-ink')}>
                <span className="text-ink-3">{o.icon}</span>
                <span className="flex-1">{o.label}</span>
                <span className="text-[11px] text-ink-3">{o.group}</span>
              </button>
            </li>
          ))}
          {!options.length && <li className="px-3 py-6 text-center text-sm text-ink-3">No matching pages.</li>}
        </ul>
      </div>
    </div>
  );
}

export function AppLayout() {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [unread, setUnread] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [palette, setPalette] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    let live = true;
    const tick = () => api.get('/api/tasks/summary').then((r) => { if (!live) return; setUnread(r.unread); setCounts({ '/tasks': r.assignedTotal + r.returned, '/notifications': r.unread }); }).catch(() => {});
    tick();
    const t = setInterval(tick, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [loc.pathname]);
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); } };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[3000] focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">
        <Sidebar counts={counts} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">
            <button className="absolute right-2 top-3 z-10 rounded p-1 text-white/80 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} counts={counts} />
          </div>
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6">
        <button className="rounded-lg p-1.5 text-ink-2 hover:bg-gray-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <GlobalSearch />
        </div>
        <button onClick={() => setPalette(true)} className="hidden items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-xs text-ink-3 hover:bg-gray-50 md:inline-flex" title="Go to any page (Ctrl + K)">
          <Compass className="size-4" />Go to<kbd className="rounded border border-line px-1 text-[10px]">Ctrl K</kbd>
        </button>
        <CreateMenu />
        <button onClick={() => nav('/notifications')} className="relative rounded-lg p-2 text-ink-2 hover:bg-gray-100" aria-label={`Notifications (${unread} unread)`}>
          <Bell className="size-5" />
          {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-100" aria-expanded={menu} aria-haspopup="menu">
            <span className="grid size-8 place-items-center rounded-full bg-brand text-xs font-semibold text-white">{me?.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
            <span className="hidden text-left leading-tight sm:block">
              <span className="block text-sm font-medium text-ink">{me?.name}</span>
              <span className="block text-[11px] text-ink-3">{me?.designation ?? me?.roles[0]?.name}</span>
            </span>
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 mt-1 w-64 rounded-xl border border-line bg-white p-1.5 shadow-lg">
              <div className="px-3 py-2 text-xs text-ink-3">
                <p className="truncate font-medium text-ink">{me?.email}</p>
                <p className="mt-0.5">{me?.district?.name}</p>
                <p className="mt-1 flex flex-wrap gap-1">{me?.roles.map((r) => <span key={r.id} className="rounded bg-gray-100 px-1.5 py-0.5">{r.name}</span>)}</p>
              </div>
              <button role="menuitem" onClick={() => nav('/profile')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-gray-50">
                <KeyRound className="size-4" /> Change password
              </button>
              <button role="menuitem" onClick={async () => { await logout(); nav('/login'); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50">
                <LogOut className="size-4" /> Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <main id="main" className="mx-auto min-w-0 max-w-[1400px] px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}

