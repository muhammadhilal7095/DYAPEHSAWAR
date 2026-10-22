/**
 * Base configuration seed — idempotent. Creates roles, districts, departments, dropdown options,
 * hostels/rooms, Jawan Markaz assets, approval workflows and one test account per role.
 *
 *   npm run db:seed            (this file)
 *   npm run db:seed:demo       (optional sample requests/bookings/reports driven through the real workflow)
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ALL_PERMISSIONS, type Permission } from '../src/lib/permissions.js';

const prisma = new PrismaClient();
export const TEST_PASSWORD = 'Password@123';

const ROLES: { key: string; name: string; description: string; permissions: Permission[] }[] = [
  { key: 'administrator', name: 'Administrator', description: 'Full system access', permissions: ALL_PERMISSIONS },
  // DAAMR
  { key: 'daamr_requester', name: 'Activity Creator / Activity Officer', description: 'Creates activities, assigns staff and files execution reports', permissions: ['daamr.request.create', 'daamr.report.create', 'daamr.dashboard', 'daamr.assign', 'daamr.expense.view', 'course.access'] },
  { key: 'daamr_district_officer', name: 'District-Level Reviewer (District Officer)', description: 'First-level review of district activities', permissions: ['daamr.request.view_district', 'daamr.report.view_district', 'daamr.dashboard', 'daamr.expense.view', 'course.view_district'] },
  { key: 'daamr_district_head', name: 'District Head (DAAMR reviewer)', description: 'Second-level district approval', permissions: ['daamr.request.view_district', 'daamr.report.view_district', 'daamr.dashboard', 'daamr.export', 'daamr.assign', 'daamr.expense.view', 'course.view_district', 'course.export'] },
  { key: 'daamr_directorate_officer', name: 'Department-Level Reviewer (Directorate Officer)', description: 'Directorate review and execution report verification', permissions: ['daamr.request.view_all', 'daamr.report.view_all', 'daamr.dashboard', 'daamr.export', 'daamr.expense.view', 'course.view_all', 'course.export'] },
  { key: 'daamr_final_authority', name: 'Director / Final Approver', description: 'Final approval of activities and course completion', permissions: ['daamr.request.view_all', 'daamr.report.view_all', 'daamr.dashboard', 'daamr.export', 'daamr.expense.view', 'workflow.reopen', 'course.view_all', 'course.export'] },
  { key: 'department_admin', name: 'Department Administrator', description: 'Manages activities, staff assignments and departmental reporting', permissions: ['daamr.request.view_all', 'daamr.report.view_all', 'daamr.dashboard', 'daamr.export', 'daamr.assign', 'daamr.expense.view', 'admin.org', 'audit.view', 'course.view_all', 'course.manage', 'course.export'] },
  { key: 'activity_staff', name: 'Assigned Officer / Staff Member', description: 'Carries out assigned activities and submits execution reports', permissions: ['daamr.report.create', 'course.access'] },
  { key: 'activity_supervisor', name: 'Supervisor', description: 'Supervises district activities and staff assignments', permissions: ['daamr.request.view_district', 'daamr.report.view_district', 'daamr.dashboard', 'daamr.assign', 'daamr.expense.view'] },
  { key: 'read_only_auditor', name: 'Read-Only Auditor', description: 'Views all activities, exports and audit logs; cannot change anything', permissions: ['daamr.request.view_all', 'daamr.report.view_all', 'daamr.dashboard', 'daamr.export', 'daamr.expense.view', 'audit.view', 'course.view_all', 'course.export'] },
  { key: 'course_trainer', name: 'Course Trainer', description: 'Records daily training session reports for the courses they teach', permissions: ['course.access'] },
  // Hostels
  { key: 'hostel_requester', name: 'District / HQ Officer (Hostel requester)', description: 'Submits hostel booking requests', permissions: ['hostel.booking.create', 'hostel.dashboard'] },
  { key: 'hostel_manager', name: 'Hostel Manager', description: 'Check-in / check-out for assigned hostels', permissions: ['hostel.operations', 'hostel.view_identity', 'hostel.dashboard'] },
  { key: 'hostel_reviewer', name: 'Approving Officer (HQ)', description: 'Reviews hostel booking requests', permissions: ['hostel.booking.view_all', 'hostel.view_identity', 'hostel.dashboard', 'hostel.export'] },
  { key: 'hostel_final_approver', name: 'Final Approving Authority (Hostels)', description: 'Final approval and room allocation', permissions: ['hostel.booking.view_all', 'hostel.view_identity', 'hostel.dashboard', 'hostel.export', 'workflow.reopen'] },
  // Jawan Markaz
  { key: 'jm_reporting_officer', name: 'District / HQ Reporting Officer (JM)', description: 'Submits Jawan Markaz inspection & progress reports', permissions: ['jm.report.create', 'jm.dashboard'] },
  { key: 'jm_district_reviewer', name: 'District / HQ Reviewer (JM)', description: 'First-level review of district JM reports', permissions: ['jm.report.view_district', 'jm.dashboard'] },
  { key: 'jm_monitoring_officer', name: 'Monitoring / Inspection Officer (JM)', description: 'Verifies progress, quality and compliance', permissions: ['jm.report.view_all', 'jm.dashboard', 'jm.export', 'jm.register.update'] },
  { key: 'jm_supervising_authority', name: 'Supervising / Approving Authority (JM)', description: 'Final verification of JM reports', permissions: ['jm.report.view_all', 'jm.dashboard', 'jm.export', 'jm.register.update', 'jm.asset.manage', 'workflow.reopen'] },
];

const DISTRICTS = [
  'Abbottabad', 'Bajaur', 'Bannu', 'Battagram', 'Buner', 'Charsadda', 'Chitral Lower', 'Chitral Upper', 'Dera Ismail Khan', 'Hangu', 'Haripur', 'Karak', 'Khyber', 'Kohat',
  'Kolai Palas', 'Kurram', 'Lakki Marwat', 'Lower Dir', 'Lower Kohistan', 'Malakand', 'Mansehra', 'Mardan', 'Mohmand', 'North Waziristan', 'Nowshera', 'Orakzai', 'Peshawar',
  'Shangla', 'South Waziristan', 'Swabi', 'Swat', 'Tank', 'Torghar', 'Upper Dir', 'Upper Kohistan',
];

const LOOKUPS: Record<string, [string, string, any?][]> = {
  ACTIVITY_CATEGORY: [
    ['SPORTS', 'Sports & Games'], ['YOUTH_LEADERSHIP', 'Youth Leadership'], ['SKILL_DEVELOPMENT', 'Skill Development'], ['AWARENESS', 'Awareness Campaign'],
    ['CULTURAL', 'Cultural Event'], ['SEMINAR', 'Seminar / Workshop'], ['COMMUNITY_SERVICE', 'Community Service'], ['HEALTH', 'Health & Wellness'], ['OTHER', 'Other'],
  ],
  ROOM_TYPE: [['SINGLE', 'Single'], ['DOUBLE', 'Double'], ['SHARED', 'Shared'], ['DORMITORY', 'Dormitory'], ['FAMILY', 'Family suite']],
  JM_INSPECTION_TYPE: [['ROUTINE', 'Routine inspection'], ['SURPRISE', 'Surprise visit'], ['MILESTONE', 'Milestone verification'], ['FOLLOW_UP', 'Follow-up inspection'], ['FINAL', 'Final / completion inspection']],
  JM_PROJECT_STATUS: [
    ['NOT_STARTED', 'Not Started'], ['PLANNING', 'Planning Stage'], ['IN_PROGRESS', 'In Progress'], ['ON_SCHEDULE', 'On Schedule'], ['SLIGHTLY_DELAYED', 'Slightly Delayed'],
    ['SIGNIFICANTLY_DELAYED', 'Significantly Delayed'], ['SUSPENDED', 'Temporarily Suspended'], ['COMPLETED', 'Completed'], ['FINAL_INSPECTION', 'Under Final Inspection'],
  ],
  JM_QUALITY: [['EXCELLENT', 'Excellent'], ['GOOD', 'Good'], ['SATISFACTORY', 'Satisfactory'], ['NEEDS_IMPROVEMENT', 'Needs Improvement'], ['UNSATISFACTORY', 'Unsatisfactory'], ['NOT_ASSESSED', 'Not Assessed']],
  JM_COMPLIANCE: [['FULLY_COMPLIANT', 'Fully Compliant'], ['PARTIALLY_COMPLIANT', 'Partially Compliant'], ['NON_COMPLIANT', 'Non-Compliant'], ['PENDING_VERIFICATION', 'Pending Verification'], ['NOT_APPLICABLE', 'Not Applicable']],
  JM_COMPLIANCE_CRITERIA: [
    ['APPROVED_DRAWINGS', 'Work conforms to approved drawings & specifications'], ['MATERIAL_TESTING', 'Material test reports available'], ['SAFETY', 'Site safety measures in place'],
    ['ENVIRONMENT', 'Environmental safeguards observed'], ['LABOUR', 'Labour laws and wages compliance'], ['SITE_RECORDS', 'Site order book & measurement book maintained'],
  ],
  JM_ISSUE_CATEGORY: [['DESIGN', 'Design'], ['MATERIAL', 'Material'], ['WORKMANSHIP', 'Workmanship'], ['CONTRACTOR', 'Contractor performance'], ['FUNDING', 'Funding / payments'], ['LAND_LEGAL', 'Land / legal'], ['SAFETY', 'Safety'], ['UTILITIES', 'Utilities'], ['OTHER', 'Other']],
  JM_RISK_CATEGORY: [['FINANCIAL', 'Financial'], ['SCHEDULE', 'Schedule'], ['TECHNICAL', 'Technical'], ['SAFETY', 'Health & safety'], ['ENVIRONMENTAL', 'Environmental'], ['SECURITY', 'Security'], ['LEGAL', 'Legal / regulatory'], ['OTHER', 'Other']],
  JM_RISK_PROBABILITY: [['RARE', 'Rare', { score: 1 }], ['UNLIKELY', 'Unlikely', { score: 2 }], ['POSSIBLE', 'Possible', { score: 3 }], ['LIKELY', 'Likely', { score: 4 }], ['ALMOST_CERTAIN', 'Almost certain', { score: 5 }]],
  JM_RISK_IMPACT: [['INSIGNIFICANT', 'Insignificant', { score: 1 }], ['MINOR', 'Minor', { score: 2 }], ['MODERATE', 'Moderate', { score: 3 }], ['MAJOR', 'Major', { score: 4 }], ['SEVERE', 'Severe', { score: 5 }]],
};

const USERS: { email: string; name: string; designation: string; district: string; roles: string[] }[] = [
  { email: 'admin@dya.gov.pk', name: 'System Administrator', designation: 'IT Administrator', district: 'Directorate HQ Peshawar', roles: ['administrator'] },
  // DAAMR (Mardan district chain + directorate)
  { email: 'requester.mardan@dya.gov.pk', name: 'Ayesha Khan', designation: 'Youth Activity Officer', district: 'Mardan', roles: ['daamr_requester', 'hostel_requester', 'jm_reporting_officer'] },
  { email: 'do.mardan@dya.gov.pk', name: 'Imran Yousafzai', designation: 'District Youth Officer', district: 'Mardan', roles: ['daamr_district_officer', 'jm_district_reviewer'] },
  { email: 'head.mardan@dya.gov.pk', name: 'Sadia Afridi', designation: 'Deputy Director (District)', district: 'Mardan', roles: ['daamr_district_head'] },
  { email: 'requester.swat@dya.gov.pk', name: 'Bilal Ahmad', designation: 'Youth Activity Officer', district: 'Swat', roles: ['daamr_requester', 'jm_reporting_officer'] },
  { email: 'do.swat@dya.gov.pk', name: 'Farhan Ali', designation: 'District Youth Officer', district: 'Swat', roles: ['daamr_district_officer', 'jm_district_reviewer'] },
  { email: 'head.swat@dya.gov.pk', name: 'Nadia Gul', designation: 'Deputy Director (District)', district: 'Swat', roles: ['daamr_district_head'] },
  { email: 'directorate@dya.gov.pk', name: 'Zubair Shah', designation: 'Assistant Director (Programmes)', district: 'Directorate HQ Peshawar', roles: ['daamr_directorate_officer'] },
  { email: 'director@dya.gov.pk', name: 'Dr. Hina Qureshi', designation: 'Director Youth Affairs', district: 'Directorate HQ Peshawar', roles: ['daamr_final_authority'] },
  // Activity management: staff, supervisor, department administrator, auditor
  { email: 'staff.mardan@dya.gov.pk', name: 'Usman Ghani', designation: 'Youth Development Assistant', district: 'Mardan', roles: ['activity_staff'] },
  { email: 'staff2.mardan@dya.gov.pk', name: 'Mehwish Saleem', designation: 'Sports Coordinator', district: 'Mardan', roles: ['activity_staff'] },
  { email: 'supervisor.mardan@dya.gov.pk', name: 'Fazal Rabbi', designation: 'Supervisor (Youth Programmes)', district: 'Mardan', roles: ['activity_supervisor'] },
  { email: 'deptadmin@dya.gov.pk', name: 'Rukhsana Begum', designation: 'Deputy Director (Coordination)', district: 'Directorate HQ Peshawar', roles: ['department_admin'] },
  { email: 'trainer.mardan@dya.gov.pk', name: 'Naveed Akhtar', designation: 'IT Trainer', district: 'Mardan', roles: ['course_trainer'] },
  { email: 'auditor@dya.gov.pk', name: 'Javed Akhtar', designation: 'Internal Auditor', district: 'Directorate HQ Peshawar', roles: ['read_only_auditor'] },
  // Hostels
  { email: 'hq.officer@dya.gov.pk', name: 'Kamran Khattak', designation: 'Assistant Director (Hostels)', district: 'Directorate HQ Peshawar', roles: ['hostel_reviewer'] },
  { email: 'hostel.approver@dya.gov.pk', name: 'Shazia Bibi', designation: 'Deputy Director (Admin)', district: 'Directorate HQ Peshawar', roles: ['hostel_final_approver'] },
  { email: 'manager.batakundi@dya.gov.pk', name: 'Gul Zaman', designation: 'Hostel Manager', district: 'Mansehra', roles: ['hostel_manager'] },
  { email: 'manager.chapra@dya.gov.pk', name: 'Rahim Ullah', designation: 'Hostel Manager', district: 'Swat', roles: ['hostel_manager'] },
  { email: 'manager.khanaspur@dya.gov.pk', name: 'Tariq Mehmood', designation: 'Hostel Manager', district: 'Abbottabad', roles: ['hostel_manager'] },
  // JM
  { email: 'monitoring@dya.gov.pk', name: 'Asad Iqbal', designation: 'Monitoring & Evaluation Officer', district: 'Directorate HQ Peshawar', roles: ['jm_monitoring_officer'] },
  { email: 'supervisor@dya.gov.pk', name: 'Engr. Waqas Jadoon', designation: 'Director (Development)', district: 'Directorate HQ Peshawar', roles: ['jm_supervising_authority'] },
  { email: 'requester.bannu@dya.gov.pk', name: 'Hamid Wazir', designation: 'District Youth Officer', district: 'Bannu', roles: ['jm_reporting_officer', 'daamr_requester'] },
  { email: 'reviewer.bannu@dya.gov.pk', name: 'Saeed Marwat', designation: 'Deputy Director (District)', district: 'Bannu', roles: ['jm_district_reviewer', 'daamr_district_officer'] },
];

async function main() {
  // --if-empty: used on every production start; seeds only a brand-new database.
  if (process.argv.includes('--if-empty') && (await prisma.user.count())) return;
  // Roles
  const roleId: Record<string, string> = {};
  for (const r of ROLES) {
    const row = await prisma.role.upsert({
      where: { key: r.key },
      create: { ...r, isSystem: true },
      update: { name: r.name, description: r.description, permissions: r.permissions },
    });
    roleId[r.key] = row.id;
  }

  // Districts + HQ
  await prisma.district.upsert({ where: { name: 'Directorate HQ Peshawar' }, create: { name: 'Directorate HQ Peshawar', code: 'HQ', type: 'HQ' }, update: {} });
  for (const name of DISTRICTS) await prisma.district.upsert({ where: { name }, create: { name, type: 'DISTRICT' }, update: {} });
  const districts = Object.fromEntries((await prisma.district.findMany()).map((d) => [d.name, d.id]));

  // Departments
  for (const name of ['Directorate of Youth Affairs', 'Youth Hostels Wing', 'Jawan Markaz Projects Cell', 'Sports & Youth Affairs Department']) {
    const exists = await prisma.department.findFirst({ where: { name, districtId: null } });
    if (!exists) await prisma.department.create({ data: { name } });
  }

  // Lookups
  for (const [group, opts] of Object.entries(LOOKUPS)) {
    let i = 0;
    for (const [value, label, meta] of opts) {
      await prisma.lookupOption.upsert({ where: { group_value: { group, value } }, create: { group, value, label, sortOrder: i++, meta }, update: { label, meta } });
    }
  }

  // Users
  const hash = await bcrypt.hash(TEST_PASSWORD, 12);
  const userId: Record<string, string> = {};
  for (const u of USERS) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, name: u.name, designation: u.designation, districtId: districts[u.district], passwordHash: hash, roles: { create: u.roles.map((k) => ({ roleId: roleId[k] })) } },
      update: {},
    });
    userId[u.email] = row.id;
  }

  // Facility types & hostels
  const ft: Record<string, string> = {};
  for (const name of ['Youth Hostel', 'Camping Site', 'Guest House']) ft[name] = (await prisma.facilityType.upsert({ where: { name }, create: { name }, update: {} })).id;
  const HOSTELS = [
    { name: 'Batakundi Youth Hostel', district: 'Mansehra', address: 'Batakundi, Kaghan Valley, District Mansehra', manager: 'manager.batakundi@dya.gov.pk', rooms: [['B-', 1, 4, 'DOUBLE', 2], ['B-', 5, 2, 'SHARED', 4], ['D-', 1, 1, 'DORMITORY', 12]] },
    { name: 'Chapra Youth Hostel', district: 'Swat', address: 'Chapra, District Swat', manager: 'manager.chapra@dya.gov.pk', rooms: [['C-', 1, 3, 'SINGLE', 1], ['C-', 4, 4, 'DOUBLE', 2], ['F-', 1, 1, 'FAMILY', 5]] },
    { name: 'Khanaspur Youth Hostel', district: 'Abbottabad', address: 'Khanaspur, Galyat, District Abbottabad', manager: 'manager.khanaspur@dya.gov.pk', rooms: [['K-', 1, 6, 'DOUBLE', 2], ['D-', 1, 2, 'DORMITORY', 10]] },
  ] as const;
  for (const h of HOSTELS) {
    const hostel = await prisma.hostel.upsert({
      where: { name: h.name },
      create: { name: h.name, districtId: districts[h.district], address: h.address, facilityTypeId: ft['Youth Hostel'], managerId: userId[h.manager], contactPhone: '091-9210000' },
      update: {},
    });
    if ((await prisma.room.count({ where: { hostelId: hostel.id } })) === 0) {
      for (const [prefix, start, count, type, cap] of h.rooms) {
        await prisma.room.createMany({ data: Array.from({ length: count }, (_, i) => ({ hostelId: hostel.id, roomNumber: `${prefix}${start + i}`, roomType: type, capacity: cap })) });
      }
    }
  }

  // Jawan Markaz assets
  const ASSETS = [
    { name: 'Jawan Markaz Bannu', district: 'Bannu', location: 'Township, Bannu City', lat: 32.9889, lng: 70.6056, start: '2025-03-01', end: '2026-12-31', cost: 185_000_000, contractor: 'M/s Frontier Builders' },
    { name: 'Jawan Markaz Buner', district: 'Buner', location: 'Daggar, District Buner', lat: 34.5122, lng: 72.4844, start: '2025-01-15', end: '2026-09-30', cost: 160_000_000, contractor: 'M/s Malakand Constructions' },
    { name: 'Jawan Markaz Charsadda', district: 'Charsadda', location: 'Charsadda–Mardan Road, Charsadda', lat: 34.1453, lng: 71.7308, start: '2024-11-01', end: '2026-06-30', cost: 175_000_000, contractor: 'M/s Hashtnagar Engineering' },
    { name: 'Jawan Markaz Chitral Upper', district: 'Chitral Upper', location: 'Booni, Upper Chitral', lat: 36.2711, lng: 72.2603, start: '2025-05-01', end: '2027-04-30', cost: 210_000_000, contractor: 'M/s Hindukush Builders' },
    { name: 'Jawan Markaz Mardan', district: 'Mardan', location: 'Sheikh Maltoon Town, Mardan', lat: 34.2009, lng: 72.0518, start: '2024-09-01', end: '2026-03-31', cost: 190_000_000, contractor: 'M/s Yousafzai Associates' },
  ];
  for (const [i, a] of ASSETS.entries()) {
    const exists = await prisma.jmAsset.findUnique({ where: { name: a.name } });
    if (exists) continue;
    await prisma.counter.upsert({ where: { key: 'JMA' }, create: { key: 'JMA', value: 1 }, update: { value: { increment: 1 } } });
    const c = await prisma.counter.findUniqueOrThrow({ where: { key: 'JMA' } });
    await prisma.jmAsset.create({
      data: {
        assetCode: `JMA-${String(c.value).padStart(4, '0')}`, name: a.name, districtId: districts[a.district], location: a.location, latitude: a.lat, longitude: a.lng,
        projectStartDate: new Date(`${a.start}T00:00:00Z`), plannedCompletionDate: new Date(`${a.end}T00:00:00Z`), approvedCost: a.cost, contractor: a.contractor,
        supervisingDepartment: 'C&W Department / Directorate of Youth Affairs', supervisingOfficer: 'Engr. Waqas Jadoon', currentStatus: 'IN_PROGRESS', overallProgress: [35, 50, 60, 20, 70][i],
      },
    });
  }

  // Workflows (only created if none exist for the module, so admin edits are never overwritten)
  const wf = async (module: string, name: string, levels: any[], resubmitPolicy = 'RESTART') => {
    if (await prisma.workflowDefinition.count({ where: { module } })) return;
    await prisma.workflowDefinition.create({
      data: { module, name, resubmitPolicy, description: 'Default workflow (seeded). Edit under Administration → Approval Workflows.', levels: { create: levels.map((l, i) => ({ order: i + 1, ...l })) } },
    });
  };
  await wf('DAAMR_REQUEST', 'DAAMR activity request approval', [
    { name: 'District Officer', designation: 'District Youth Officer', approverType: 'ROLE', approverRoleId: roleId.daamr_district_officer, districtScope: 'SAME_DISTRICT', allowReassign: true },
    { name: 'District Head', designation: 'Deputy Director (District)', approverType: 'ROLE', approverRoleId: roleId.daamr_district_head, districtScope: 'SAME_DISTRICT', allowReassign: true },
    { name: 'Directorate Officer', designation: 'Assistant Director (Programmes)', approverType: 'ROLE', approverRoleId: roleId.daamr_directorate_officer },
    { name: 'Final Approving Authority', designation: 'Director Youth Affairs', approverType: 'USER', approverUserId: userId['director@dya.gov.pk'] },
  ]);
  await wf('DAAMR_REPORT', 'Final activity report verification', [
    { name: 'Report Verification', designation: 'Assistant Director (Programmes)', approverType: 'ROLE', approverRoleId: roleId.daamr_directorate_officer, allowReject: false },
  ], 'RETURNING_LEVEL');
  await wf('COURSE_SESSION', 'Daily training report verification', [
    { name: 'Daily Report Verification', designation: 'District Youth Officer', approverType: 'ROLE', approverRoleId: roleId.daamr_district_officer, districtScope: 'SAME_DISTRICT', allowReject: false, allowReassign: true },
  ], 'RETURNING_LEVEL');
  await wf('COURSE_COMPLETION', 'Course completion approval', [
    { name: 'District Review', designation: 'Deputy Director (District)', approverType: 'ROLE', approverRoleId: roleId.daamr_district_head, districtScope: 'SAME_DISTRICT', allowReject: false },
    { name: 'Final Approval of Completion', designation: 'Director Youth Affairs', approverType: 'USER', approverUserId: userId['director@dya.gov.pk'], allowReject: false },
  ], 'RESTART');
  await wf('HOSTEL_BOOKING', 'Youth hostel booking approval', [
    { name: 'HQ Review', designation: 'Assistant Director (Hostels)', approverType: 'ROLE', approverRoleId: roleId.hostel_reviewer, canAmendDates: true, allowReassign: true },
    { name: 'Final Approval', designation: 'Deputy Director (Admin)', approverType: 'ROLE', approverRoleId: roleId.hostel_final_approver, canAmendDates: true },
  ]);
  await wf('JM_REPORT', 'Jawan Markaz report review', [
    { name: 'District / HQ Reviewer', designation: 'District reviewer', approverType: 'ROLE', approverRoleId: roleId.jm_district_reviewer, districtScope: 'SAME_DISTRICT' },
    { name: 'Monitoring Officer', designation: 'Monitoring & Evaluation Officer', approverType: 'ROLE', approverRoleId: roleId.jm_monitoring_officer },
    { name: 'Supervising Authority (Final Verification)', designation: 'Director (Development)', approverType: 'ROLE', approverRoleId: roleId.jm_supervising_authority },
  ], 'RETURNING_LEVEL');

  console.log(`Seed complete. ${USERS.length} test accounts — password for all: ${TEST_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
