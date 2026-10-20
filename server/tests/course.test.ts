import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { login, PNG, PDF, iso, idOf, districtId, startSmtp, prisma, type Client } from './helpers.js';
import { createCourseFromActivity, generateSchedule, runCourseAutomation } from '../src/routes/courses/common.js';
import { serializable } from '../src/db.js';

let smtp: Awaited<ReturnType<typeof startSmtp>>;
let creator: Client, coordinator: Client, trainer: Client, doMardan: Client, headMardan: Client, directorate: Client, director: Client, admin: Client, auditor: Client, outsider: Client, deptadmin: Client;
let mardan: string, coordinatorId: string, trainerUserId: string;

beforeAll(async () => {
  smtp = await startSmtp();
  [creator, coordinator, trainer, doMardan, headMardan, directorate, director, admin, auditor, outsider, deptadmin] = await Promise.all([
    login('requester.mardan@dya.gov.pk'), login('staff.mardan@dya.gov.pk'), login('trainer.mardan@dya.gov.pk'), login('do.mardan@dya.gov.pk'), login('head.mardan@dya.gov.pk'),
    login('directorate@dya.gov.pk'), login('director@dya.gov.pk'), login('admin@dya.gov.pk'), login('auditor@dya.gov.pk'), login('requester.swat@dya.gov.pk'), login('deptadmin@dya.gov.pk'),
  ]);
  mardan = await districtId('Mardan');
  coordinatorId = await idOf('staff.mardan@dya.gov.pk');
  trainerUserId = await idOf('trainer.mardan@dya.gov.pk');
});
afterAll(async () => smtp.close());

const proposal = (over: any = {}) => ({
  requesteeEmail: 'requester.mardan@dya.gov.pk', districtId: mardan, category: 'SKILL_DEVELOPMENT', activityType: 'COURSE',
  subject: 'Web Development Bootcamp', area: 'Mardan city', description: 'A 14-day hands-on web development course for young people.',
  objectives: 'Build and publish a responsive website.', targetAudience: 'Graduates aged 18–25', expectedParticipants: 25,
  startDate: iso(-20), endDate: iso(-4), startTime: '09:00', endTime: '13:00', venue: 'IT Lab, GPGC Mardan', venueAddress: 'Nowshera Road, Mardan',
  trainingDays: 14, deliveryFormat: 'IN_PERSON', methodology: 'Lectures, guided labs and a capstone project.',
  proposedTrainers: [{ name: 'Naveed Akhtar', designation: 'IT Trainer', expertise: 'HTML, CSS, JavaScript' }, { name: 'Sara Khan', designation: 'UX Designer', expertise: 'Design' }],
  proposedBudget: 300000,
  ...over,
});

async function approveProposal(body: any) {
  const r = await creator.post('/api/daamr/requests', body);
  expect(r.status).toBe(201);
  const id = r.body.id;
  expect((await creator.post(`/api/daamr/requests/${id}/assignments`, { assigneeIds: [coordinatorId], leadId: coordinatorId, responsibilities: 'Coordinate the course and daily reports.' })).status).toBe(201);
  expect((await creator.post(`/api/daamr/requests/${id}/submit`)).status).toBe(200);
  for (const c of [doMardan, headMardan, directorate, director]) expect((await c.post(`/api/daamr/requests/${id}/decision`, { action: 'APPROVE', remarks: 'OK' })).status).toBe(200);
  return id;
}

describe('Course execution: 14-day course from approval to final report', () => {
  let activityId: string, courseId: string, courseNo: string;
  let sessions: any[];
  let participants: any[];

  it('validates course proposals', async () => {
    const r = await creator.post('/api/daamr/requests', { ...proposal({ proposedTrainers: [], trainingDays: '' }), submit: true });
    expect(r.status).toBe(422);
    expect(r.body.details.fields.trainingDays).toBeTruthy();
    expect(r.body.details.fields.proposedTrainers).toBeTruthy();
  });

  it('final approval creates exactly one course with a 14-session schedule (skipping non-training days)', async () => {
    const trainers = proposal().proposedTrainers;
    trainers[0] = { ...trainers[0], userId: trainerUserId } as any;
    activityId = await approveProposal(proposal({ proposedTrainers: trainers }));
    const courses = await prisma.course.findMany({ where: { activityId } });
    expect(courses).toHaveLength(1);
    courseId = courses[0].id;
    courseNo = courses[0].courseNo;
    expect(courseNo).toMatch(/^CRS-\d{4}-\d{5}$/);
    // processing the approval again never duplicates the course
    const again = await serializable((tx) => createCourseFromActivity(tx, activityId, { id: null, name: 'test' }));
    expect(again.created).toBe(false);
    expect((await admin.post(`/api/courses/setup/${activityId}`)).status).toBe(200);
    expect(await prisma.course.count({ where: { activityId } })).toBe(1);

    const d = await coordinator.get(`/api/courses/${courseId}`);
    expect(d.status).toBe(200);
    const c = d.body.course;
    expect(c.status).toBe('IN_PROGRESS'); // start date already passed
    expect(c.coordinator.id).toBe(coordinatorId);
    expect(c.trainers.map((t: any) => t.name)).toEqual(['Naveed Akhtar', 'Sara Khan']);
    sessions = c.sessions;
    expect(sessions).toHaveLength(14);
    expect(sessions.map((x: any) => x.dayNumber)).toEqual([...Array(14)].map((_, i) => i + 1));
    expect(sessions.every((x: any) => new Date(x.sessionDate).getUTCDay() !== 0)).toBe(true); // Sundays skipped
    const expected = generateSchedule(new Date(`${iso(-20)}T00:00:00Z`), 14, { courseNonTrainingWeekdays: [0], courseHolidays: [] }).map((x) => x.toISOString());
    expect(sessions.map((x: any) => new Date(x.sessionDate).toISOString())).toEqual(expected);
    expect(c.activity.daamrId).toBeTruthy();
    expect((await prisma.activityRequest.findUniqueOrThrow({ where: { id: activityId } })).lifecycle).toBe('IN_PROGRESS');
    expect(await prisma.notification.count({ where: { userId: coordinatorId, title: { contains: 'Course set up' } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'COURSE_CREATED', entityId: courseId } })).toBe(1);
  });

  it('enforces access: outsiders are refused, auditors read-only', async () => {
    expect((await outsider.get(`/api/courses/${courseId}`)).status).toBe(403);
    expect((await auditor.get(`/api/courses/${courseId}`)).status).toBe(200);
    expect((await auditor.put(`/api/courses/sessions/${sessions[0].id}`, { topic: 'x' })).status).toBe(403);
    expect((await outsider.get(`/api/courses/sessions/${sessions[0].id}`)).status).toBe(403);
  });

  it('the schedule can only be edited before the course starts; administrators resolve exceptions with reasons', async () => {
    const edit = await coordinator.put(`/api/courses/${courseId}/schedule`, { reason: 'Hall unavailable', sessions: [{ id: sessions[0].id, sessionDate: iso(1) }] });
    expect(edit.status).toBe(409);
    expect((await coordinator.post(`/api/courses/sessions/${sessions[13].id}/resolve`, { action: 'MISSED', reason: 'Trainer unavailable' })).status).toBe(403);
    expect((await deptadmin.post(`/api/courses/sessions/${sessions[13].id}/resolve`, { action: 'MISSED', reason: '' })).status).toBe(422);
    const r = await deptadmin.post(`/api/courses/sessions/${sessions[13].id}/resolve`, { action: 'MISSED', reason: 'Public holiday announced at short notice by the provincial government.' });
    expect(r.status).toBe(200);
    expect(await prisma.courseScheduleChange.count({ where: { sessionId: sessions[13].id, changeType: 'MISSED' } })).toBe(1);
  });

  it('flags missing daily reports after the deadline (idempotent background job)', async () => {
    const first = await runCourseAutomation();
    expect(first.missingReports).toBeGreaterThanOrEqual(12);
    expect((await runCourseAutomation()).missingReports).toBe(0);
    expect(await prisma.notification.count({ where: { userId: coordinatorId, title: { contains: 'Daily report overdue' } } })).toBe(first.missingReports);
  });

  it('records day 1 independently: trainers, content, participant-wise attendance, photos and materials', async () => {
    const p = await coordinator.post(`/api/courses/${courseId}/participants`, { participants: ['Ali', 'Bushra', 'Daud', 'Erum', 'Faisal'].map((name) => ({ name, institution: 'GPGC Mardan' })) });
    expect(p.status).toBe(201);
    participants = p.body;
    expect(participants.map((x: any) => x.registrationNo)).toEqual(['P-001', 'P-002', 'P-003', 'P-004', 'P-005']);
    const s1 = sessions[0].id;
    const det = await trainer.get(`/api/courses/sessions/${s1}`);
    expect(det.status).toBe(200);
    expect(det.body.can.edit).toBe(true);
    const courseTrainer = det.body.session.course.trainers.find((t: any) => t.name === 'Naveed Akhtar');
    const attendance = participants.map((x: any, i: number) => ({ participantId: x.id, status: i === 4 ? 'ABSENT' : 'PRESENT' }));
    const contradict = await trainer.put(`/api/courses/sessions/${s1}`, { attendanceMode: 'PARTICIPANT', attendance, presentCount: 5 });
    expect(contradict.status).toBe(400);
    expect(contradict.body.error).toMatch(/contradict/);
    // submitting an incomplete report is refused with the missing items
    const early = await trainer.post(`/api/courses/sessions/${s1}/submit`);
    expect(early.status).toBe(422);
    expect(Object.keys(early.body.details.fields)).toEqual(expect.arrayContaining(['conducted', 'topic', 'trainers', 'presentCount', 'photos']));
    const save = await trainer.put(`/api/courses/sessions/${s1}`, {
      conducted: true, topic: 'Introduction to HTML', learningObjectives: 'Understand document structure', topicsCovered: 'Elements, attributes, semantic tags',
      activities: 'Build a personal profile page', tools: 'VS Code, Chrome', achievements: 'All present participants published a page', challenges: 'Slow internet', nextPlan: 'CSS basics',
      trainers: [{ trainerId: courseTrainer.id }, { name: 'Dr. Amjad (guest)', designation: 'Professor', isGuest: true }],
      attendanceMode: 'PARTICIPANT', attendance, attendanceRemarks: 'Faisal informed in advance',
    });
    expect(save.status).toBe(200);
    const after = await prisma.courseSession.findUniqueOrThrow({ where: { id: s1 }, include: { trainers: true } });
    expect(after).toMatchObject({ status: 'IN_PROGRESS', registeredCount: 5, presentCount: 4, absentCount: 1, conducted: true });
    expect(after.trainers.map((t) => t.name)).toEqual(['Naveed Akhtar', 'Dr. Amjad (guest)']);
    expect((await trainer.upload(`/api/files/course-session/${s1}`, { category: 'TRAINER_LECTURE', caption: 'Opening lecture' }, [{ name: 'lecture.png', buf: PNG }])).status).toBe(201);
    expect((await trainer.upload(`/api/files/course-session/${s1}`, { category: 'STUDENTS_ATTENDING' }, [{ name: 'class.png', buf: PNG }])).status).toBe(201);
    expect((await trainer.upload(`/api/files/course-session/${s1}`, { category: 'MATERIAL' }, [{ name: 'day1-slides.pdf', buf: PDF }])).status).toBe(201);
    expect((await trainer.upload(`/api/files/course-session/${s1}`, { category: 'ATTENDANCE_SHEET' }, [{ name: 'attendance-day1.pdf', buf: PDF }])).status).toBe(201);
    expect((await outsider.upload(`/api/files/course-session/${s1}`, { category: 'TRAINER_LECTURE' }, [{ name: 'x.png', buf: PNG }])).status).toBe(403);
  });

  it('daily report: submit → changes requested → corrected → verified; history preserved', async () => {
    const s1 = sessions[0].id;
    expect((await trainer.post(`/api/courses/sessions/${s1}/submit`)).status).toBe(200);
    let x = await prisma.courseSession.findUniqueOrThrow({ where: { id: s1 } });
    expect(x.status).toBe('SUBMITTED');
    expect((await trainer.put(`/api/courses/sessions/${s1}`, { topic: 'edit while under review' })).status).toBe(409);
    const det = await doMardan.get(`/api/courses/sessions/${s1}`);
    expect(det.body.can.canDecide).toBe(true);
    expect((await doMardan.post(`/api/courses/sessions/${s1}/decision`, { action: 'RETURN' })).status).toBe(400);
    expect((await doMardan.post(`/api/courses/sessions/${s1}/decision`, { action: 'RETURN', remarks: 'Add the names of the practical exercises.' })).status).toBe(200);
    x = await prisma.courseSession.findUniqueOrThrow({ where: { id: s1 } });
    expect(x.status).toBe('CHANGES_REQUESTED');
    expect((await trainer.put(`/api/courses/sessions/${s1}`, { activities: 'Exercise 1: profile page; Exercise 2: semantic layout' })).status).toBe(200);
    expect((await trainer.post(`/api/courses/sessions/${s1}/submit`)).status).toBe(200);
    expect((await doMardan.post(`/api/courses/sessions/${s1}/decision`, { action: 'APPROVE', remarks: 'Verified against the attendance sheet.' })).status).toBe(200);
    x = await prisma.courseSession.findUniqueOrThrow({ where: { id: s1 } });
    expect(x).toMatchObject({ status: 'VERIFIED', version: 2 });
    expect(x.verifiedById).toBe(await idOf('do.mardan@dya.gov.pk'));
    const tl = (await coordinator.get(`/api/courses/sessions/${s1}`)).body.timeline;
    expect(tl.history.map((h: any) => h.action)).toEqual(expect.arrayContaining(['SUBMITTED', 'RETURNED', 'RESUBMITTED', 'FINAL_APPROVED']));
    expect(await prisma.entityVersion.count({ where: { entityType: 'CourseSession', entityId: s1 } })).toBe(2);
  });

  it('the course cannot be finalised while daily reports are missing; progress reflects real records', async () => {
    const blocked = await coordinator.post(`/api/courses/${courseId}/completion/submit`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/not yet verified for day\(s\) 2, 3/);
    const d = await coordinator.get(`/api/courses/${courseId}`);
    expect(d.body.progress).toMatchObject({ totalSessions: 14, verified: 1, missed: 1, completionPercent: 14, conducted: 1 });
    expect(d.body.can.submitCompletion).toBe(false);
  });

  it('days 2–13 are reported and verified', async () => {
    for (const s of sessions.slice(1, 13)) {
      const r = await coordinator.put(`/api/courses/sessions/${s.id}`, {
        conducted: true, topic: `Topic for day ${s.dayNumber}`, topicsCovered: `Content for day ${s.dayNumber}`, achievements: `Outcome ${s.dayNumber}`,
        trainers: [{ name: 'Sara Khan (recorded as guest)', isGuest: true }], attendanceMode: 'SUMMARY', presentCount: 4, absentCount: 1,
      });
      expect(r.status).toBe(200);
      expect((await coordinator.upload(`/api/files/course-session/${s.id}`, { category: 'PRACTICAL', caption: `Lab day ${s.dayNumber}` }, [{ name: `lab${s.dayNumber}.png`, buf: PNG }])).status).toBe(201);
      expect((await coordinator.post(`/api/courses/sessions/${s.id}/submit`)).status).toBe(200);
      expect((await doMardan.post(`/api/courses/sessions/${s.id}/decision`, { action: 'APPROVE', remarks: 'OK' })).status).toBe(200);
    }
    const bad = await coordinator.put(`/api/courses/sessions/${sessions[12].id}`, { presentCount: 4, absentCount: 3 });
    expect(bad.status).toBe(409); // verified reports are locked
    const p = (await coordinator.get(`/api/courses/${courseId}`)).body.progress;
    expect(p).toMatchObject({ verified: 13, missed: 1, completionPercent: 100, pendingReports: 0 });
  });

  it('completion report → reviewer → final approval; the final PDF and its versions', async () => {
    const lecture = await prisma.file.findFirstOrThrow({ where: { courseSessionId: sessions[0].id, category: 'TRAINER_LECTURE' } });
    expect((await coordinator.patch(`/api/courses/sessions/files/${lecture.id}/feature`, { featured: true })).status).toBe(200);
    const missing = await coordinator.post(`/api/courses/${courseId}/completion/submit`);
    expect(missing.status).toBe(422);
    expect(await coordinator.put(`/api/courses/${courseId}/completion`, {
      summary: '13 of 14 sessions delivered; one session missed due to a public holiday.', skillsDeveloped: 'HTML, CSS, JavaScript basics', projectsCompleted: '20 personal websites',
      learningOutcomes: 'Participants can build and publish responsive pages.', achievements: 'Three participants offered internships', challenges: 'Internet connectivity', recommendations: 'Provide offline resources',
      coordinatorRemarks: 'Course completed as planned apart from the missed day.',
    }).then((r) => r.status)).toBe(200);
    expect((await coordinator.post(`/api/courses/${courseId}/completion/submit`)).status).toBe(200);
    let c = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(c.status).toBe('AWAITING_VERIFICATION');
    expect((await coordinator.post(`/api/courses/${courseId}/report`)).status).toBe(409); // not before final approval
    const preview = await headMardan.get(`/api/courses/${courseId}/report/preview`);
    expect(preview.headers['content-type']).toBe('application/pdf');
    expect((await headMardan.post(`/api/courses/completion/${courseId}/decision`, { action: 'APPROVE', remarks: 'Records complete.' })).status).toBe(200);
    expect((await director.post(`/api/courses/completion/${courseId}/decision`, { action: 'APPROVE', remarks: 'Course completion approved.' })).status).toBe(200);
    c = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(c.status).toBe('COMPLETED');
    expect((await prisma.activityRequest.findUniqueOrThrow({ where: { id: activityId } })).lifecycle).toBe('COMPLETED');

    expect((await trainer.post(`/api/courses/${courseId}/report`)).status).toBe(403);
    const v1 = await coordinator.post(`/api/courses/${courseId}/report`);
    expect(v1.status).toBe(201);
    expect(v1.body.version).toBe(1);
    const pdf = await coordinator.get(`/api/files/${v1.body.fileId}?download=1`).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (d: Buffer) => b.push(d)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect(pdf.status).toBe(200);
    const pages = (pdf.body.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(12);
    expect((await coordinator.post(`/api/courses/${courseId}/report`, {})).status).toBe(422); // regeneration needs a reason
    const v2 = await coordinator.post(`/api/courses/${courseId}/report`, { reason: 'Organisation logo updated.' });
    expect(v2.body.version).toBe(2);
    const d = await auditor.get(`/api/courses/${courseId}`);
    expect(d.body.course.reportVersions.map((v: any) => v.version)).toEqual([2, 1]);
    expect((await outsider.get(`/api/files/${v1.body.fileId}`)).status).toBe(403);
  });

  it('exports the seven-sheet Excel workbook with the correct records', async () => {
    expect((await outsider.get(`/api/courses/export?courseId=${courseId}`)).status).toBe(403);
    const x = await auditor.get(`/api/courses/export?courseId=${courseId}`).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (d: Buffer) => b.push(d)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect(x.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Course Summary', 'Daily Schedule', 'Daily Session Reports', 'Trainer Details', 'Attendance Summary', 'Review and Approval History', 'Supporting Documents Register']);
    expect(wb.getWorksheet('Daily Schedule')!.rowCount).toBe(15);
    expect(wb.getWorksheet('Daily Session Reports')!.getRow(2).getCell(5).value).toBe('Introduction to HTML');
    expect(wb.getWorksheet('Attendance Summary')!.rowCount).toBe(14); // 13 reported days + header
    expect(wb.getWorksheet('Daily Schedule')!.getRow(2).getCell(3).value).toBeInstanceOf(Date);
  });

  it('dashboard counts reflect the course', async () => {
    const d = await admin.get(`/api/courses/dashboard?districtId=${mardan}`);
    expect(d.body.cards.completed).toBeGreaterThanOrEqual(1);
    const list = await admin.get(`/api/courses?status=COMPLETED&trainer=Naveed`);
    expect(list.body.rows.find((r: any) => r.id === courseId)).toMatchObject({ completionPercent: 100, totalSessions: 14 });
  });
});

describe('Upcoming course: schedule editing and automatic start', () => {
  it('edits the schedule before the start (original kept, reason logged) and starts on the start date', async () => {
    const activityId = await approveProposal(proposal({ subject: 'Graphic design short course', startDate: iso(10), endDate: iso(12), trainingDays: 3 }));
    const c = await prisma.course.findUniqueOrThrow({ where: { activityId }, include: { sessions: { orderBy: { dayNumber: 'asc' } } } });
    expect(c.status).toBe('AWAITING_START');
    expect(c.sessions).toHaveLength(3);
    const noReason = await coordinator.put(`/api/courses/${c.id}/schedule`, { sessions: [{ id: c.sessions[2].id, sessionDate: iso(20) }] });
    expect(noReason.status).toBe(422);
    const ok = await coordinator.put(`/api/courses/${c.id}/schedule`, { reason: 'Venue booked for an exam on the original date', sessions: [{ id: c.sessions[2].id, sessionDate: iso(20) }] });
    expect(ok.status).toBe(200);
    const s3 = await prisma.courseSession.findUniqueOrThrow({ where: { id: c.sessions[2].id } });
    expect(s3.sessionDate.toISOString().slice(0, 10)).toBe(iso(20));
    expect(s3.originalDate.getTime()).toBe(c.sessions[2].sessionDate.getTime());
    expect((await prisma.course.findUniqueOrThrow({ where: { id: c.id } })).endDate.toISOString().slice(0, 10)).toBe(iso(20));
    expect(await prisma.courseScheduleChange.count({ where: { sessionId: s3.id, changeType: 'RESCHEDULED' } })).toBe(1);
    // the change log is append-only
    await expect(prisma.courseScheduleChange.updateMany({ where: { sessionId: s3.id }, data: { reason: 'tampered' } })).rejects.toThrow();
    // reports cannot be submitted for a future session
    expect((await coordinator.put(`/api/courses/sessions/${c.sessions[0].id}`, { conducted: true })).status).toBe(400);

    const r = await runCourseAutomation(new Date(`${iso(10)}T08:00:00Z`));
    expect(r.started).toBeGreaterThanOrEqual(1);
    expect((await prisma.course.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('IN_PROGRESS');
    expect((await coordinator.put(`/api/courses/${c.id}/schedule`, { reason: 'Too late now', sessions: [{ id: c.sessions[1].id, sessionDate: iso(25) }] })).status).toBe(409);
  });
});

describe('Deleting and cancelling courses', () => {
  it('deletes a course without submitted reports (proposal can be set up again) and cancels one with history', async () => {
    const activityId = await approveProposal(proposal({ subject: 'Course created in error', startDate: iso(30), endDate: iso(31), trainingDays: 2 }));
    const c = await prisma.course.findUniqueOrThrow({ where: { activityId } });
    expect((await coordinator.post(`/api/courses/${c.id}/delete`, { reason: 'Duplicate entry' })).status).toBe(403);
    expect((await deptadmin.post(`/api/courses/${c.id}/delete`, {})).status).toBe(422);
    expect((await deptadmin.post(`/api/courses/${c.id}/delete`, { reason: 'Created twice by mistake' })).status).toBe(200);
    expect(await prisma.course.count({ where: { activityId } })).toBe(0);
    expect(await prisma.courseSession.count({ where: { courseId: c.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'COURSE_DELETED', entityId: c.id } })).toBe(1);
    expect((await prisma.activityRequest.findUniqueOrThrow({ where: { id: activityId } })).lifecycle).toBe('APPROVED');
    expect((await deptadmin.post(`/api/courses/setup/${activityId}`)).status).toBe(201);

    // a course with a submitted daily report keeps its history: delete is refused, cancel is allowed
    const done = await prisma.course.findFirstOrThrow({ where: { title: 'Web Development Bootcamp' } });
    expect((await deptadmin.post(`/api/courses/${done.id}/delete`, { reason: 'Not allowed' })).status).toBe(409);
    expect((await deptadmin.post(`/api/courses/${done.id}/cancel`, { reason: 'Not allowed' })).status).toBe(409); // completed
    const again = await prisma.course.findUniqueOrThrow({ where: { activityId } });
    const s1 = await prisma.courseSession.findFirstOrThrow({ where: { courseId: again.id, dayNumber: 1 } });
    await prisma.courseSession.update({ where: { id: s1.id }, data: { sessionDate: new Date(`${iso(-1)}T00:00:00Z`) } });
    await prisma.course.update({ where: { id: again.id }, data: { status: 'IN_PROGRESS' } });
    await coordinator.put(`/api/courses/sessions/${s1.id}`, { conducted: true, topic: 'Intro', topicsCovered: 'Basics', trainers: [{ name: 'Guest', isGuest: true }], attendanceMode: 'SUMMARY', presentCount: 20, absentCount: 5 });
    await coordinator.upload(`/api/files/course-session/${s1.id}`, { category: 'PRACTICAL' }, [{ name: 'p.png', buf: PNG }]);
    expect((await coordinator.post(`/api/courses/sessions/${s1.id}/submit`)).status).toBe(200);
    expect((await deptadmin.post(`/api/courses/${again.id}/delete`, { reason: 'Mistake' })).status).toBe(409);
    expect((await deptadmin.post(`/api/courses/${again.id}/cancel`, { reason: 'Funding withdrawn for this financial year' })).status).toBe(200);
    const x = await prisma.course.findUniqueOrThrow({ where: { id: again.id } });
    expect(x.status).toBe('CANCELLED');
    expect((await prisma.courseSession.findUniqueOrThrow({ where: { id: s1.id }, include: { workflow: true } })).workflow!.status).toBe('CANCELLED');
  });
});
