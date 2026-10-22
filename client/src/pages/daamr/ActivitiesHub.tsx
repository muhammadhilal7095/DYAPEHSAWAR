import { ClipboardList, Gauge, GraduationCap, Images, ListChecks } from 'lucide-react';
import { TabHub, type HubTab } from '../../components/TabHub';
import { ACTIVITY_PERMS } from '../../components/GlobalSearch';

/** Activity Management working pages, reachable as one "Activities" area with tabs. */
export const ACTIVITY_TABS: HubTab[] = [
  { to: '/daamr', label: 'Dashboard', icon: Gauge, perms: ['daamr.dashboard', 'daamr.request.create', 'daamr.report.create', 'daamr.assign'] },
  { to: '/daamr/requests', label: 'All Activities', icon: ClipboardList, perms: ACTIVITY_PERMS },
  { to: '/daamr/assignments', label: 'My Assignments', icon: ListChecks, perms: ['daamr.report.create', 'daamr.assign', 'daamr.request.create'] },
  { to: '/courses', label: 'Courses & Daily Reports', icon: GraduationCap, perms: ['course.access', 'course.view_all', 'course.view_district', 'course.manage'] },
  { to: '/daamr/gallery', label: 'Picture Gallery', icon: Images, perms: ['daamr.request.create', 'daamr.dashboard'] },
];

export default function ActivitiesHub() {
  return <TabHub title="Activity Management" tabs={ACTIVITY_TABS} />;
}
