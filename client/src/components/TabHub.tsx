import { useEffect, useRef, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../lib/auth';
import { cx } from './ui';

export interface HubTab { to: string; label: string; icon: ComponentType<{ className?: string }>; perms: string[]; end?: boolean }

/** Layout route: a tab strip linking related pages (filtered by permission), then the current page. */
export function TabHub({ title, tabs }: { title: string; tabs: HubTab[] }) {
  const { can } = useAuth();
  const visible = tabs.filter((t) => can(...t.perms));
  const strip = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  // keep the selected tab visible when the strip scrolls sideways (phones)
  useEffect(() => { strip.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [pathname]);
  return (
    <>
      {visible.length > 1 && (
        <div className="no-print mb-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</p>
          <div ref={strip} className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-white p-1 shadow-sm [scrollbar-width:thin]" role="tablist">
            {visible.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end ?? true}
                role="tab"
                className={({ isActive }) =>
                  cx('flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition', isActive ? 'bg-brand text-white shadow-sm' : 'text-ink-2 hover:bg-gray-50 hover:text-ink')
                }
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
      <Outlet />
    </>
  );
}
