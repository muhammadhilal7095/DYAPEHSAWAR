/** All permission keys. Roles are admin-editable collections of these. */
export const PERMISSIONS = {
  // administration
  'admin.users': 'Manage users and roles',
  'admin.org': 'Manage districts, headquarters and departments',
  'admin.workflows': 'Configure approval workflows',
  'admin.settings': 'Manage system settings and dropdown options',
  'audit.view': 'View audit logs',
  'email.view': 'View email delivery logs',
  'email.retry': 'Retry failed email notifications',
  'workflow.override': 'Act on / reassign any workflow item (administrative override)',
  'workflow.reopen': 'Reopen rejected or declined items',
  'workflow.self_approve': 'Decide on own submissions (only where the department explicitly authorises it)',

  // DAAMR
  'daamr.request.create': 'Submit DAAMR activity requests',
  'daamr.request.view_all': 'View all DAAMR activity requests',
  'daamr.request.view_district': 'View DAAMR requests of own district',
  'daamr.report.create': 'Create activity reports',
  'daamr.report.view_all': 'View all activity reports',
  'daamr.report.view_district': 'View activity reports of own district',
  'daamr.dashboard': 'View DAAMR dashboard and analytics',
  'daamr.export': 'Export DAAMR data',
  'daamr.assign': 'Assign activities to staff members and manage assignments',
  'daamr.expense.view': 'View activity budgets and expense details',

  // Course execution
  'course.access': 'Open Course Management (courses they coordinate, teach or work on)',
  'course.view_all': 'View all courses and daily session reports',
  'course.view_district': 'View courses of own district',
  'course.manage': 'Manage course schedules, trainers and participants; record missed / cancelled sessions; regenerate final reports',
  'course.export': 'Export course reports and workbooks',

  // Hostels
  'hostel.booking.create': 'Submit hostel booking requests',
  'hostel.booking.view_all': 'View all hostel bookings',
  'hostel.booking.view_district': 'View hostel bookings of own district',
  'hostel.manage': 'Manage hostels, rooms and facility types',
  'hostel.operations': 'Record check-in / check-out (own hostels, or all with view_all)',
  'hostel.view_identity': 'View guest CNIC / passport numbers',
  'hostel.dashboard': 'View hostel dashboard and utilization reports',
  'hostel.export': 'Export hostel registers and reports',

  // Jawan Markaz
  'jm.asset.manage': 'Register and edit Jawan Markaz assets',
  'jm.report.create': 'Submit Jawan Markaz monitoring reports',
  'jm.report.view_all': 'View all Jawan Markaz reports',
  'jm.report.view_district': 'View Jawan Markaz reports of own district',
  'jm.register.update': 'Update issue, action and risk status',
  'jm.dashboard': 'View Jawan Markaz dashboard and analytics',
  'jm.export': 'Export Jawan Markaz data',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
