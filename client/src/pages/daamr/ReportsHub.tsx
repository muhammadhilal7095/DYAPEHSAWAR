import { NavLink, Outlet } from 'react-router';
import { BarChart3, FolderKanban, Wallet } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { cx } from '../../components/ui';

/** Report pages of Activity Management, reachable as one "Reports" area with tabs. */
export const REPORT_TABS = [
  { to: '/daamr/reports', label: 'Execution Reports', icon: FolderKanban, perms: ['daamr.report.create', 'daamr.report.view_all', 'daamr.report.view_district', 'daamr.dashboard'] },
  { to: '/daamr/analytics', label: 'Reports & Analytics', icon: BarChart3, perms: ['daamr.dashboard'] },
  { to: '/daamr/summary', label: 'Participation & Budget', icon: Wallet, perms: ['daamr.dashboard', 'daamr.request.create'] },
];

export default function ReportsHub() {
  const { can } = useAuth();
  const tabs = REPORT_TABS.filter((t) => can(...t.perms));
  return (
    <>
      {tabs.length > 1 && (
        <div className="no-print mb-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Activity Reports</p>
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-white p-1 shadow-sm" role="tablist">
            {tabs.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end
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
