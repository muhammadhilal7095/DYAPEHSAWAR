import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { login, PNG, PDF, iso, idOf, districtId, startSmtp, settleEmails, prisma, type Client } from './helpers.js';
import { sendAssignmentReminders } from '../src/routes/daamr/assignments.js';

let smtp: Awaited<ReturnType<typeof startSmtp>>;
let creator: Client, staff: Client, staff2: Client, supervisor: Client, director: Client, directorate: Client, admin: Client, auditor: Client, outsider: Client;
let nowshera: string, staffId: string, staff2Id: string, workflowId: string;

beforeAll(async () => {
  smtp = await startSmtp();
  [creator, staff, staff2, supervisor, director, directorate, admin, auditor, outsider] = await Promise.all([
    login('requester.mardan@dya.gov.pk'), login('staff.mardan@dya.gov.pk'), login('staff2.mardan@dya.gov.pk'), login('supervisor.mardan@dya.gov.pk'),
    login('director@dya.gov.pk'), login('directorate@dya.gov.pk'), login('admin@dya.gov.pk'), login('auditor@dya.gov.pk'), login('requester.swat@dya.gov.pk'),
  ]);
  nowshera = await districtId('Nowshera');
  [staffId, staff2Id] = [await idOf('staff.mardan@dya.gov.pk'), await idOf('staff2.mardan@dya.gov.pk')];
  // Department-specific review hierarchy: Staff Review → Supervisor Review → Director (final)
  const wf = await admin.post('/api/admin/workflows', {
    module: 'DAAMR_REQUEST', name: 'Nowshera activity review', districtId: nowshera, isActive: true, resubmitPolicy: 'RESTART',
    levels: [
      { name: 'Staff Review', approverType: 'RESPONSIBLE_OFFICER' },
      { name: 'Supervisor Review', approverType: 'USER', approverUserId: await idOf('supervisor.mardan@dya.gov.pk') },
      { name: 'Director Final Approval', approverType: 'USER', approverUserId: await idOf('director@dya.gov.pk') },
    ],
  });
  expect(wf.status).toBe(201);
  workflowId = wf.body.id;
});
afterAll(async () => {
  await prisma.workflowDefinition.update({ where: { id: workflowId }, data: { isActive: false } });
  await smtp.close();
});

const activity = (over: any = {}) => ({
  requesteeEmail: 'requester.mardan@dya.gov.pk',
  districtId: nowshera,
  category: 'SPORTS',
  subject: 'District youth athletics meet',
  area: 'Nowshera Cantt',
  tehsil: 'Nowshera',
  description: 'One-day athletics meet for school and college students.',
  objectives: 'Identify athletic talent and promote healthy lifestyles.',
  targetAudience: 'Students aged 14–22',
  expectedParticipants: 300,
  startDate: iso(20),
  endDate: iso(20),
  startTime: '08:30',
  endTime: '15:00',
  venue: 'Nowshera Sports Complex',
  venueAddress: 'GT Road, Nowshera Cantt, District Nowshera',
  proposedBudget: 180000,
  priority: 'HIGH',
  ...over,
});

describe('Activity management: create → assign → multi-level review → execution → completion', () => {
  let id: string;
  let daamrId: string;
  let reportId: string;

  it('validates the new activity fields and saves a draft', async () => {
    const missing = await creator.post('/api/daamr/requests', { ...activity({ objectives: '', venueAddress: '' }), submit: true });
    expect(missing.status).toBe(422);
    expect(missing.body.details.fields.objectives).toBeTruthy();
    expect(missing.body.details.fields.venueAddress).toBeTruthy();
    const badTime = await creator.post('/api/daamr/requests', activity({ endTime: '07:00' }));
    expect(badTime.status).toBe(422);
    expect(badTime.body.details.fields.endTime).toMatch(/after/);
    const r = await creator.post('/api/daamr/requests', activity());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ lifecycle: 'DRAFT', priority: 'HIGH', startTime: '08:30', province: 'Khyber Pakhtunkhwa', expectedParticipants: 300 });
    id = r.body.id;
    daamrId = r.body.daamrId;
    const cover = await creator.upload(`/api/files/activity-request/${id}`, { category: 'COVER' }, [{ name: 'cover.png', buf: PNG }]);
    expect(cover.status).toBe(201);
    const venue = await creator.upload(`/api/files/activity-request/${id}`, { category: 'PRE_ACTIVITY', caption: 'Main track' }, [{ name: 'track.png', buf: PNG }, { name: 'stand.png', buf: PNG }]);
    expect(venue.body).toHaveLength(2);
    const d = await creator.get(`/api/daamr/requests/${id}`);
    expect(d.body.cover.originalName).toBe('cover.png');
    expect(d.body.outstanding.map((o: any) => o.text).join(' ')).toMatch(/Assign a responsible staff member/);
  });

  it('assigns the activity to staff; only authorised users can assign; staff see it in their dashboard', async () => {
    expect((await staff.post(`/api/daamr/requests/${id}/assignments`, { assigneeIds: [staffId], responsibilities: 'x' })).status).toBe(403);
    expect((await auditor.post(`/api/daamr/requests/${id}/assignments`, { assigneeIds: [staffId], responsibilities: 'x' })).status).toBe(403);
    const past = await creator.post(`/api/daamr/requests/${id}/assignments`, { assigneeIds: [staffId], responsibilities: 'Track events', deadline: iso(-1) });
    expect(past.status).toBe(400);
    const a = await creator.post(`/api/daamr/requests/${id}/assignments`, {
      assigneeIds: [staffId, staff2Id], leadId: staffId, responsibilities: 'Organise track events, registration and the execution report.',
      instructions: 'Coordinate with school principals.', deadline: iso(19), priority: 'HIGH', reviewRequirements: 'Attach the participant list.',
    });
    expect(a.status).toBe(201);
    expect(a.body.filter((x: any) => x.isLead).map((x: any) => x.assigneeId)).toEqual([staffId]);
    const dup = await creator.post(`/api/daamr/requests/${id}/assignments`, { assigneeIds: [staffId], responsibilities: 'again' });
    expect(dup.status).toBe(409);

    const note = await prisma.notification.findFirst({ where: { userId: staffId, title: { contains: daamrId } }, orderBy: { createdAt: 'desc' } });
    expect(note?.title).toMatch(/responsible officer/);
    const mine = await staff.get('/api/daamr/assignments?status=open');
    const task = mine.body.rows.find((r: any) => r.activity.id === id);
    expect(task).toMatchObject({ isLead: true, priority: 'HIGH' });
    expect((await staff.get(`/api/daamr/requests/${id}`)).status).toBe(200);
    expect((await outsider.get(`/api/daamr/requests/${id}`)).status).toBe(403);
    expect((await staff.get('/api/daamr/requests?scope=staff')).body.rows.map((r: any) => r.id)).toContain(id);

    expect((await staff.patch(`/api/daamr/assignments/${task.id}`, { deadline: iso(30) })).status).toBe(403);
    const ack = await staff.patch(`/api/daamr/assignments/${task.id}`, { status: 'ACKNOWLEDGED', statusRemarks: 'Noted.' });
    expect(ack.status).toBe(200);
    expect(ack.body.acknowledgedAt).toBeTruthy();
    const support = await creator.get(`/api/daamr/requests/${id}`);
    const s2 = support.body.request.assignments.find((x: any) => x.assigneeId === staff2Id);
    expect((await creator.patch(`/api/daamr/assignments/${s2.id}`, { status: 'CANCELLED' })).status).toBe(400);
  });

  it('routes the first review level to the responsible officer; evidence is attached to the decision', async () => {
    const sub = await creator.post(`/api/daamr/requests/${id}/submit`);
    expect(sub.status).toBe(200);
    expect(sub.body.lifecycle).toBe('UNDER_REVIEW');
    let d = await staff.get(`/api/daamr/requests/${id}`);
    expect(d.body.timeline.instance.currentAssignee.id).toBe(staffId);
    expect(d.body.nextReviewer.level).toBe('Staff Review');
    expect(d.body.can.canDecide).toBe(true);

    expect((await staff2.upload(`/api/files/activity-request/${id}`, { category: 'REVIEW_EVIDENCE' }, [{ name: 'x.pdf', buf: PDF }])).status).toBe(403);
    const ev = await staff.upload(`/api/files/activity-request/${id}`, { category: 'REVIEW_EVIDENCE', caption: 'Site visit note' }, [{ name: 'site-visit.pdf', buf: PDF }]);
    expect(ev.status).toBe(201);
    const dec = await staff.post(`/api/daamr/requests/${id}/decision`, { action: 'APPROVE', remarks: 'Venue inspected; ready.', evidenceFileIds: [ev.body[0].id] });
    expect(dec.status).toBe(200);
    d = await creator.get(`/api/daamr/requests/${id}`);
    const stage = d.body.timeline.stages.find((s: any) => s.label === 'Staff Review');
    expect(stage.evidence).toEqual([{ id: ev.body[0].id, name: 'site-visit.pdf' }]);
    expect(d.body.timeline.instance.currentAssignee.id).toBe(await idOf('supervisor.mardan@dya.gov.pk'));
    // evidence attached to a recorded decision cannot be withdrawn or reused
    expect((await staff.del(`/api/files/${ev.body[0].id}`)).status).toBe(403);
  });

  it('changes requested → creator updates and resubmits → all levels approve; history is preserved', async () => {
    expect((await supervisor.post(`/api/daamr/requests/${id}/decision`, { action: 'RETURN' })).status).toBe(400);
    expect((await supervisor.post(`/api/daamr/requests/${id}/decision`, { action: 'RETURN', remarks: 'Add first-aid arrangements to the plan.' })).status).toBe(200);
    let d = await creator.get(`/api/daamr/requests/${id}`);
    expect(d.body.request.lifecycle).toBe('CHANGES_REQUESTED');
    expect(d.body.outstanding.some((o: any) => /address the requested changes/.test(o.text))).toBe(true);
    const upd = await creator.put(`/api/daamr/requests/${id}`, { ...activity({ objectives: 'Identify athletic talent; first-aid team from Rescue 1122 on site.' }), submit: true });
    expect(upd.status).toBe(200);
    expect(upd.body.lifecycle).toBe('UNDER_REVIEW');
    expect((await staff.post(`/api/daamr/requests/${id}/decision`, { action: 'APPROVE', remarks: 'OK' })).status).toBe(200);
    expect((await supervisor.post(`/api/daamr/requests/${id}/decision`, { action: 'APPROVE', remarks: 'Endorsed' })).status).toBe(200);
    expect((await director.post(`/api/daamr/requests/${id}/decision`, { action: 'APPROVE', remarks: 'Approved' })).status).toBe(200);
    d = await creator.get(`/api/daamr/requests/${id}`);
    expect(d.body.request.lifecycle).toBe('APPROVED');
    const actions = d.body.timeline.history.map((h: any) => h.action);
    expect(actions).toEqual(expect.arrayContaining(['SUBMITTED', 'APPROVED', 'RETURNED', 'RESUBMITTED', 'FINAL_APPROVED']));
    expect(d.body.versions).toBe(2);
  });

  it('assigned staff submit the execution report; the activity completes only after its verification', async () => {
    const body = {
      requestId: id, activityDate: iso(20), districtId: nowshera, activityName: 'District youth athletics meet', category: 'SPORTS', venue: 'Nowshera Sports Complex',
      description: '12 track and field events held.', responsibleOfficer: 'Usman Ghani', activityStatus: 'COMPLETED', remarks: 'Smooth conduct.',
      achievements: '30 athletes shortlisted for provincial trials.', challenges: 'Heat in the afternoon.', recommendations: 'Start earlier in the day.', expenseDetails: 'Prizes 60,000; refreshments 50,000.',
      participants: { male: 180, female: 110, transgender: 0 }, budget: { allocated: 180000, utilized: 150000 }, mediaLinks: [],
    };
    expect((await outsider.post('/api/daamr/reports', body)).status).toBe(403);
    const r = await staff.post('/api/daamr/reports', body);
    expect(r.status).toBe(201);
    reportId = r.body.id;
    expect((await prisma.activityRequest.findUniqueOrThrow({ where: { id } })).lifecycle).toBe('IN_PROGRESS');
    for (const [cat, name, buf] of [['PRE_ACTIVITY', 'before.png', PNG], ['POST_ACTIVITY', 'after.png', PNG], ['EVENT', 'race.png', PNG], ['ATTENDANCE', 'attendance.pdf', PDF]] as const) {
      expect((await staff.upload(`/api/files/activity-report/${reportId}`, { category: cat }, [{ name, buf }])).status).toBe(201);
    }
    expect((await staff.put(`/api/daamr/reports/${reportId}`, { ...body, submit: true })).status).toBe(200);
    expect((await prisma.activityRequest.findUniqueOrThrow({ where: { id } })).lifecycle).toBe('REPORT_REVIEW');
    expect((await directorate.post(`/api/daamr/reports/${reportId}/decision`, { action: 'APPROVE', remarks: 'Verified against attendance sheet.' })).status).toBe(200);
    const a = await prisma.activityRequest.findUniqueOrThrow({ where: { id } });
    expect(a.lifecycle).toBe('COMPLETED');
    expect(a.completedAt).toBeTruthy();
    const done = await prisma.notification.findFirst({ where: { userId: staffId, title: { contains: 'Activity completed' } } });
    expect(done).toBeTruthy();
  });

  it('activity log, global search, dashboard and filters reflect real data', async () => {
    const log = await creator.get(`/api/daamr/requests/${id}/activity-log`);
    const labels = log.body.map((e: any) => e.label);
    expect(labels).toEqual(expect.arrayContaining(['Activity created', 'Staff assigned', 'Submitted for review', 'Returned', 'Final Approved', 'Execution report submitted']));
    expect(log.body.find((e: any) => e.evidence?.length)?.evidence[0].name).toBe('site-visit.pdf');

    const byStaffName = await admin.get(`/api/daamr/requests?q=${encodeURIComponent('Usman Ghani')}`);
    expect(byStaffName.body.rows.map((r: any) => r.id)).toContain(id);
    const byDistrict = await admin.get('/api/daamr/requests?q=Nowshera&lifecycle=COMPLETED');
    expect(byDistrict.body.rows[0].leadOfficer.name).toBe('Usman Ghani');

    const dash = await admin.get(`/api/daamr/dashboard/activities?assigneeId=${staffId}&districtId=${nowshera}`);
    expect(dash.status).toBe(200);
    expect(dash.body.cards).toMatchObject({ total: 1, completed: 1, overdue: 0, pendingReviews: 0 });
    expect(dash.body.charts.byStatus).toEqual([{ key: 'COMPLETED', name: 'Completed', value: 1 }]);
    expect((await outsider.get(`/api/daamr/dashboard/activities?districtId=${nowshera}`)).body.cards.total).toBe(0);
  });

  it('exports a detailed single-activity PDF, a summary PDF and a multi-sheet Excel workbook', async () => {
    const pdf = await creator.get(`/api/daamr/requests/${id}/pdf?sections=overview,images,reviews,execution&images=all`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const small = await creator.get(`/api/daamr/requests/${id}/pdf?sections=overview&images=none`);
    expect(pdf.body.length).toBeGreaterThan(small.body.length);
    const summary = await auditor.get(`/api/daamr/requests/export?format=pdf&districtId=${nowshera}`);
    expect(summary.headers['content-type']).toBe('application/pdf');
    const x = await auditor.get(`/api/daamr/requests/export?format=xlsx&districtId=${nowshera}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Activities Summary', 'Activity Details', 'Staff Assignments', 'Review History', 'Execution Reports', 'Participants and Outcomes']);
    expect(wb.getWorksheet('Staff Assignments')!.rowCount).toBe(3); // header + 2 staff
    expect(wb.getWorksheet('Activity Details')!.getRow(2).getCell(8).value).toBeInstanceOf(Date);
    // users without export rights for an activity they are not involved in
    expect((await outsider.get(`/api/daamr/requests/${id}/pdf`)).status).toBe(403);
    expect((await staff.get('/api/daamr/requests/export?format=xlsx')).status).toBe(403);
  });

  it('read-only auditor can view everything but cannot act', async () => {
    expect((await auditor.get(`/api/daamr/requests/${id}`)).status).toBe(200);
    const d = (await auditor.get(`/api/daamr/requests/${id}`)).body;
    expect(d.can).toMatchObject({ edit: false, assign: false, canDecide: false, createReport: false });
    expect(d.request.proposedBudget).toBe(180000);
    expect((await auditor.post(`/api/daamr/reports/${reportId}/decision`, { action: 'APPROVE' })).status).toBe(409);
  });
});

describe('Deadlines and reminders', () => {
  it('sends upcoming-deadline and overdue reminders once, and counts overdue activities', async () => {
    const r = await creator.post('/api/daamr/requests', activity({ subject: 'Deadline drill', startDate: iso(3), endDate: iso(3) }));
    const a = await creator.post(`/api/daamr/requests/${r.body.id}/assignments`, { assigneeIds: [staff2Id], responsibilities: 'Book the venue', deadline: iso(1) });
    expect(a.status).toBe(201);
    const first = await sendAssignmentReminders();
    expect(first.upcoming).toBeGreaterThanOrEqual(1);
    expect((await sendAssignmentReminders()).upcoming).toBe(0);
    expect(await prisma.notification.count({ where: { userId: staff2Id, title: { contains: 'Upcoming deadline' } } })).toBeGreaterThanOrEqual(1);

    await prisma.activityAssignment.update({ where: { id: a.body[0].id }, data: { deadline: new Date(Date.now() - 3600_000) } });
    await creator.post(`/api/daamr/requests/${r.body.id}/submit`);
    const second = await sendAssignmentReminders();
    expect(second.overdue).toBeGreaterThanOrEqual(1);
    const overdueNote = await prisma.notification.findFirst({ where: { userId: await idOf('requester.mardan@dya.gov.pk'), title: { contains: 'Task overdue' } } });
    expect(overdueNote).toBeTruthy();
    const dash = await admin.get(`/api/daamr/dashboard/activities?districtId=${nowshera}`);
    expect(dash.body.cards.overdue).toBeGreaterThanOrEqual(1);
    const list = await admin.get(`/api/daamr/requests?districtId=${nowshera}&overdue=1`);
    expect(list.body.rows.map((x: any) => x.id)).toContain(r.body.id);
    await settleEmails();
  });
});
