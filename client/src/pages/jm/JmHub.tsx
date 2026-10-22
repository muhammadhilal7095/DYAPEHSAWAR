import { ClipboardCheck, Gauge, Images, Map, ShieldAlert } from 'lucide-react';
import { TabHub, type HubTab } from '../../components/TabHub';

/** Jawan Markaz working pages, reachable as one "Monitoring" area with tabs. */
export const JM_TABS: HubTab[] = [
  { to: '/jm', label: 'Dashboard', icon: Gauge, perms: ['jm.dashboard', 'jm.report.create'] },
  { to: '/jm/reports', label: 'Monitoring Reports', icon: ClipboardCheck, perms: ['jm.report.create', 'jm.report.view_all', 'jm.report.view_district', 'jm.dashboard'] },
  { to: '/jm/assets', label: 'Asset Register', icon: Map, perms: ['jm.dashboard', 'jm.report.create', 'jm.asset.manage', 'jm.report.view_all'] },
  { to: '/jm/gallery', label: 'Site Photographs', icon: Images, perms: ['jm.dashboard', 'jm.report.create', 'jm.asset.manage'] },
  { to: '/jm/registers', label: 'Issues, Actions & Risks', icon: ShieldAlert, perms: ['jm.dashboard', 'jm.report.create'] },
];

export default function JmHub() {
  return <TabHub title="Jawan Markaz Monitoring" tabs={JM_TABS} />;
}
