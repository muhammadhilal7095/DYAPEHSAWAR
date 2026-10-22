import { BarChart3, FolderKanban, Wallet } from 'lucide-react';
import { TabHub, type HubTab } from '../../components/TabHub';

/** Report pages of Activity Management, reachable as one "Reports" area with tabs. */
export const REPORT_TABS: HubTab[] = [
  { to: '/daamr/reports', label: 'Execution Reports', icon: FolderKanban, perms: ['daamr.report.create', 'daamr.report.view_all', 'daamr.report.view_district', 'daamr.dashboard'] },
  { to: '/daamr/analytics', label: 'Reports & Analytics', icon: BarChart3, perms: ['daamr.dashboard'] },
  { to: '/daamr/summary', label: 'Participation & Budget', icon: Wallet, perms: ['daamr.dashboard', 'daamr.request.create'] },
];

export default function ReportsHub() {
  return <TabHub title="Activity Reports" tabs={REPORT_TABS} />;
}
