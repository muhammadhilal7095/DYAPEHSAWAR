import { BedDouble, CalendarCheck, ClipboardList, Gauge } from 'lucide-react';
import { TabHub, type HubTab } from '../../components/TabHub';

/** Youth Hostel working pages, reachable as one "Bookings" area with tabs. */
export const HOSTEL_TABS: HubTab[] = [
  { to: '/hostels', label: 'Dashboard', icon: Gauge, perms: ['hostel.dashboard', 'hostel.booking.create', 'hostel.operations'] },
  { to: '/hostels/bookings', label: 'Booking Register', icon: ClipboardList, perms: ['hostel.booking.create', 'hostel.booking.view_all', 'hostel.booking.view_district', 'hostel.operations', 'hostel.dashboard'] },
  { to: '/hostels/operations', label: 'Check-In / Check-Out', icon: CalendarCheck, perms: ['hostel.operations'] },
  { to: '/hostels/manage', label: 'Hostels & Rooms', icon: BedDouble, perms: ['hostel.manage'] },
];

export default function HostelHub() {
  return <TabHub title="Youth Hostels" tabs={HOSTEL_TABS} />;
}
