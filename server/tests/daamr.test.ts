import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, PNG, PDF, iso, idOf, districtId, startSmtp, settleEmails, prisma, client, type Client } from './helpers.js';

let smtp: Awaited<ReturnType<typeof startSmtp>>;
let requester: Client, doMardan: Client, headMardan: Client, directorate: Client, director: Client, doSwat: Client, requesterSwat: Client, admin: Client;
let mardan: string;

beforeAll(async () => {
  smtp = await startSmtp();
  [requester, doMardan, headMardan, directorate, director, doSwat, requesterSwat, admin] = await Promise.all([
    login('requester.mardan@dya.gov.pk'), login('do.mardan@dya.gov.pk'), login('head.mardan@dya.gov.pk'), login('directorate@dya.gov.pk'),
    login('director@dya.gov.pk'), login('do.swat@dya.gov.pk'), login('requester.swat@dya.gov.pk'), login('admin@dya.gov.pk'),
  ]);
  mardan = await districtId('Mardan');
});
afterAll(async () => smtp.close());

const requestBody = (over: any = {}) => ({
  requesteeEmail: 'requester.mardan@dya.gov.pk',
  districtId: mardan,
  category: 'SPORTS',
  subject: 'Inter-college cricket tournament',
  area: 'Mardan city',
  description: 'A five-day cricket tournament for 12 colleges.',
  startDate: iso(10),
  endDate: iso(14),
  venue: 'Mardan Sports Complex',
  venueAddress: 'Mardan Sports Complex, Mall Road, Mardan',
  objectives: 'Promote inter-college sports and teamwork.',
  proposedBudget: 250000,
  ...over,
});

describe('DAAMR request → multi-level approval → execution → final report', () => {
  let reqId: string;
  let daamrId: string;

  it('saves a draft, then rejects invalid submissions with field errors', async () => {
    const bad = await requester.post('/api/daamr/requests', { ...requestBody({ endDate: iso(5) }), submit: true });
    expect(bad.status).toBe(422);
    expect(bad.body.details.fields.endDate).toMatch(/before/);

    const draft = await requester.post('/api/daamr/requests', requestBody({ venue: '' }));
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe('DRAFT');
    expect(draft.body.daamrId).toMatch(/^DAAMR-\d{4}-\d{5}$/);
    reqId = draft.body.id;
    daamrId = draft.body.daamrId;

    const missingVenue = await requester.post(`/api/daamr/requests/${reqId}/submit`);
    expect(missingVenue.status).toBe(422);
  });

  it('uploads venue pictures and documents to the draft (file type validated by content)', async () => {
    const pics = await requester.upload(`/api/files/activity-request/${reqId}`, { category: 'PRE_ACTIVITY', caption: 'Main ground' }, [{ name: 'ground.png', buf: PNG }]);
    expect(pics.status).toBe(201);
    expect(pics.body[0].kind).toBe('PHOTO');
    const fake = await requester.upload(`/api/files/activity-request/${reqId}`, { category: 'PRE_ACTIVITY' }, [{ name: 'evil.jpg', buf: Buffer.from('<script>alert(1)</script>') }]);
    expect(fake.status).toBe(400);
    const pdfAsPhoto = await requester.upload(`/api/files/activity-request/${reqId}`, { category: 'PRE_ACTIVITY' }, [{ name: 'doc.pdf', buf: PDF }]);
    expect(pdfAsPhoto.status).toBe(400);
    const doc = await requester.upload(`/api/files/activity-request/${reqId}`, { category: 'SUPPORTING' }, [{ name: 'plan.pdf', buf: PDF }]);
    expect(doc.status).toBe(201);
  });

  it('submits a valid request: unique DAAMR ID, first officer assigned and notified', async () => {
    const r = await requester.put(`/api/daamr/requests/${reqId}`, { ...requestBody(), submit: true });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('PENDING_REVIEW');
    expect(r.body.daamrId).toBe(daamrId);

    const detail = await requester.get(`/api/daamr/requests/${reqId}`);
    expect(detail.body.timeline.instance.currentAssignee.id).toBe(await idOf('do.mardan@dya.gov.pk'));
    expect(detail.body.timeline.stages.map((s: any) => s.state)).toEqual(['COMPLETED', 'PENDING_REVIEW', 'AWAITING_PREVIOUS', 'AWAITING_PREVIOUS', 'AWAITING_PREVIOUS']);

    await settleEmails();
    const mails = await prisma.emailLog.findMany({ where: { entityRef: daamrId } });
    const toOfficer = mails.find((m) => m.toEmail === 'do.mardan@dya.gov.pk' && m.event === 'ASSIGNED');
    expect(toOfficer?.status).toBe('SENT');
    expect(toOfficer?.messageId).toBeTruthy();
    expect(mails.some((m) => m.toEmail === 'requester.mardan@dya.gov.pk' && m.event === 'SUBMITTED')).toBe(true);
    expect(smtp.received.some((m) => m.to.includes('do.mardan@dya.gov.pk'))).toBe(true);
    const notes = await doMardan.get('/api/admin/notifications');
    expect(notes.body.rows.some((n: any) => n.title.includes(daamrId))).toBe(true);
  });

  it('assigned officer can view the request and its pictures; unrelated users cannot', async () => {
    const d = await doMardan.get(`/api/daamr/requests/${reqId}`);
    expect(d.status).toBe(200);
    expect(d.body.can.canDecide).toBe(true);
    const photo = d.body.request.files.find((f: any) => f.category === 'PRE_ACTIVITY');
    expect((await doMardan.get(`/api/files/${photo.id}`)).status).toBe(200);
    expect((await requesterSwat.get(`/api/daamr/requests/${reqId}`)).status).toBe(403);
    expect((await requesterSwat.get(`/api/files/${photo.id}`)).status).toBe(403);
    expect((await client().get(`/api/files/${photo.id}`)).status).toBe(401);
  });

  it('blocks decisions by officers who are not assigned, and by the requester', async () => {
    expect((await doSwat.post(`/api/daamr/requests/${reqId}/decision`, { action: 'APPROVE' })).status).toBe(403);
    expect((await director.post(`/api/daamr/requests/${reqId}/decision`, { action: 'APPROVE' })).status).toBe(403);
    expect((await requester.post(`/api/daamr/requests/${reqId}/decision`, { action: 'APPROVE' })).status).toBe(403);
    expect((await doMardan.post(`/api/daamr/requests/${reqId}/decision`, { action: 'RETURN' })).status).toBe(400); // remarks required
  });

  it('approval automatically assigns the next officer and records the timeline', async () => {
    const a = await doMardan.post(`/api/daamr/requests/${reqId}/decision`, { action: 'APPROVE', remarks: 'Recommended.' });
    expect(a.status).toBe(200);
    const d = await requester.get(`/api/daamr/requests/${reqId}`);
    expect(d.body.request.status).toBe('UNDER_REVIEW');
    expect(d.body.timeline.instance.currentAssignee.id).toBe(await idOf('head.mardan@dya.gov.pk'));
    expect(d.body.timeline.stages[1]).toMatchObject({ state: 'APPROVED', remarks: 'Recommended.' });
    expect(d.body.timeline.stages[2].state).toBe('PENDING_REVIEW');
    // double-approval by the previous officer is refused
    expect((await doMardan.post(`/api/daamr/requests/${reqId}/decision`, { action: 'APPROVE' })).status).toBe(403);
  });

  it('return for revision → requester edits and resubmits without losing history', async () => {
    const ret = await headMardan.post(`/api/daamr/requests/${reqId}/decision`, { action: 'RETURN', remarks: 'Please reduce the budget.' });
    expect(ret.status).toBe(200);
    let d = await requester.get(`/api/daamr/requests/${reqId}`);
    expect(d.body.request.status).toBe('RETURNED');
    expect(d.body.can.edit).toBe(true);
    const re = await requester.put(`/api/daamr/requests/${reqId}`, { ...requestBody({ proposedBudget: 180000 }), submit: true });
    expect(re.status).toBe(200);
    d = await requester.get(`/api/daamr/requests/${reqId}`);
    expect(d.body.request.status).toBe('PENDING_REVIEW'); // RESTART policy → back to first level
    expect(d.body.request.proposedBudget).toBe(180000);
    expect(d.body.versions).toBe(2);
    const actions = d.body.timeline.history.map((h: any) => h.action);
    expect(actions).toEqual(expect.arrayContaining(['SUBMITTED', 'APPROVED', 'RETURNED', 'RESUBMITTED']));
    const versions = await requester.get(`/api/daamr/requests/${reqId}/versions`);
    expect(versions.body[0].snapshot.proposedBudget).toBe(250000); // original preserved
  });

  it('final authority can approve only after all preceding stages', async () => {
    expect((await director.post(`/api/daamr/requests/${reqId}/decision`, { action: 'APPROVE' })).status).toBe(403);
    expect((await doMardan.post(`/api/daamr/requests/${reqId}/decision`, { action: 'APPROVE' })).status).toBe(200);
    expect((await headMardan.post(`/api/daamr/requests/${reqId}/decision`, { action: 'APPROVE' })).status).toBe(200);
    expect((await director.post(`/api/daamr/requests/${reqId}/decision`, { action: 'APPROVE' })).status).toBe(403);
    expect((await directorate.post(`/api/daamr/requests/${reqId}/decision`, { action: 'APPROVE', remarks: 'Within policy.' })).status).toBe(200);
    let d = await requester.get(`/api/daamr/requests/${reqId}`);
    expect(d.body.request.status).toBe('UNDER_REVIEW');
    expect(d.body.timeline.stages[4]).toMatchObject({ state: 'PENDING_REVIEW', label: 'Final Approving Authority' });
    expect((await director.post(`/api/daamr/requests/${reqId}/decision`, { action: 'APPROVE', remarks: 'Approved.' })).status).toBe(200);
    d = await requester.get(`/api/daamr/requests/${reqId}`);
    expect(d.body.request.status).toBe('APPROVED');
    expect(d.body.request.approvedAt).toBeTruthy();
    expect(d.body.timeline.stages.every((s: any) => ['COMPLETED', 'APPROVED'].includes(s.state))).toBe(true);
    expect(d.body.can.execute).toBe(true);
  });

  it('approved request progresses to execution with post-activity photos and a final report', async () => {
    expect((await requester.post(`/api/daamr/requests/${reqId}/execution`, { executionStatus: 'COMPLETED' })).status).toBe(200);
    const post = await requester.upload(`/api/files/activity-request/${reqId}`, { category: 'POST_ACTIVITY', caption: 'Prize distribution' }, [{ name: 'prize.png', buf: PNG }]);
    expect(post.status).toBe(201);

    const report = await requester.post('/api/daamr/reports', {
      requestId: reqId, activityDate: iso(12), districtId: mardan, activityName: 'Inter-college cricket tournament', category: 'SPORTS', venue: 'Mardan Sports Complex',
      description: 'Held successfully.', responsibleOfficer: 'Ayesha Khan', activityStatus: 'COMPLETED',
      participants: { male: 120, female: 60, minority: 5, madaris: 10, transgender: 2, disabled: 3, juvenile: 40 },
      budget: { allocated: 180000, utilized: 195000, fundSource: 'ADP' },
      mediaLinks: [{ platform: 'FACEBOOK', url: 'https://facebook.com/dya/posts/1' }, { platform: 'NEWSPAPER', url: 'https://dawn.com/news/1' }],
      submit: true,
    });
    expect(report.status).toBe(201);
    expect(report.body.daamrId).toBe(daamrId);
    expect(report.body.reportStatus).toBe('UNDER_VERIFICATION');

    const bad = await requester.post('/api/daamr/reports', { requestId: reqId, activityDate: iso(12), districtId: mardan, activityName: 'x', category: 'SPORTS', venue: 'x', description: 'x', responsibleOfficer: 'x', activityStatus: 'COMPLETED', participants: { male: -1 }, budget: {}, mediaLinks: [{ platform: 'X', url: 'javascript:alert(1)' }] });
    expect(bad.status).toBe(422);

    const d = await directorate.get(`/api/daamr/reports/${report.body.id}`);
    expect(d.body.report.participants.total).toBe(182); // male + female + transgender (configured rule)
    expect(d.body.report.budget.remaining).toBe(-15000);
    expect(d.body.report.mediaLinks).toHaveLength(2);
    expect(d.body.can.canDecide).toBe(true);
    expect((await directorate.post(`/api/daamr/reports/${report.body.id}/decision`, { action: 'APPROVE', remarks: 'Verified against evidence.' })).status).toBe(200);
    const v = await requester.get(`/api/daamr/reports/${report.body.id}`);
    expect(v.body.report.reportStatus).toBe('VERIFIED');
    const reqDetail = await requester.get(`/api/daamr/requests/${reqId}`);
    expect(reqDetail.body.request.status).toBe('APPROVED'); // approval status kept separate from report verification
    expect(reqDetail.body.request.executionStatus).toBe('COMPLETED');
  });

  it('rejection stops the chain and cannot be reopened by ordinary users', async () => {
    const r = await requester.post('/api/daamr/requests', { ...requestBody({ subject: 'Duplicate event' }), submit: true });
    const rej = await doMardan.post(`/api/daamr/requests/${r.body.id}/decision`, { action: 'REJECT', remarks: 'Duplicate of an approved activity.' });
    expect(rej.status).toBe(200);
    const d = await requester.get(`/api/daamr/requests/${r.body.id}`);
    expect(d.body.request.status).toBe('REJECTED');
    expect(d.body.timeline.stages.slice(2).every((s: any) => s.state === 'NOT_REACHED')).toBe(true);
    expect((await headMardan.post(`/api/daamr/requests/${r.body.id}/decision`, { action: 'APPROVE' })).status).toBe(409);
    expect((await requester.put(`/api/daamr/requests/${r.body.id}`, requestBody())).status).toBe(409);
    expect((await requester.post(`/api/daamr/requests/${r.body.id}/reopen`, { remarks: 'please' })).status).toBe(403);
    expect((await director.post(`/api/daamr/requests/${r.body.id}/reopen`, { remarks: 'Reconsider after clarification.' })).status).toBe(200);
  });

  it('reassignment by an authorised reviewer, with history', async () => {
    const r = await requester.post('/api/daamr/requests', { ...requestBody({ subject: 'Youth parliament' }), submit: true });
    const assignees = await doMardan.get(`/api/daamr/requests/${r.body.id}/assignees`);
    expect(assignees.status).toBe(200);
    const target = await idOf('reviewer.bannu@dya.gov.pk');
    expect(assignees.body.some((u: any) => u.id === target)).toBe(true);
    expect((await doMardan.post(`/api/daamr/requests/${r.body.id}/reassign`, { userId: target, remarks: 'On leave this week.' })).status).toBe(200);
    const d = await admin.get(`/api/daamr/requests/${r.body.id}`);
    expect(d.body.timeline.instance.currentAssignee.id).toBe(target);
    expect(d.body.timeline.history.some((h: any) => h.action === 'REASSIGNED')).toBe(true);
    expect((await doMardan.post(`/api/daamr/requests/${r.body.id}/decision`, { action: 'APPROVE' })).status).toBe(403);
  });

  it('email status reflects real delivery (bounced recipient → FAILED, never SENT)', async () => {
    const r = await requester.post('/api/daamr/requests', { ...requestBody({ subject: 'Bounce test', requesteeEmail: 'bounce@example.com' }), submit: true });
    expect(r.status).toBe(201);
    await settleEmails();
    const log = await prisma.emailLog.findFirst({ where: { entityRef: r.body.daamrId, toEmail: 'bounce@example.com' } });
    expect(log?.status).toBe('FAILED');
    expect(log?.error).toBeTruthy();
    const retry = await admin.post(`/api/admin/emails/${log!.id}/retry`);
    expect(retry.body.status).toBe('FAILED');
    expect((await requester.post(`/api/admin/emails/${log!.id}/retry`)).status).toBe(403);
  });

  it('dashboard, exports and audit log reflect saved records with permissions', async () => {
    const dash = await admin.get('/api/daamr/dashboard');
    expect(dash.body.cards.totalRequests).toBeGreaterThanOrEqual(4);
    expect(dash.body.cards.verifiedReports).toBeGreaterThanOrEqual(1);
    expect(dash.body.cards.totalParticipants).toBeGreaterThanOrEqual(182);
    const swatDash = await requesterSwat.get('/api/daamr/dashboard');
    const ownSwat = await prisma.activityRequest.count({ where: { requester: { email: 'requester.swat@dya.gov.pk' }, status: { not: 'DRAFT' } } });
    expect(swatDash.body.cards.totalRequests).toBe(ownSwat); // sees only own records, not Mardan's
    expect(swatDash.body.cards.totalRequests).toBeLessThan(dash.body.cards.totalRequests);

    for (const fmt of ['csv', 'xlsx', 'pdf']) {
      const e = await admin.get(`/api/daamr/requests/export?format=${fmt}`);
      expect(e.status).toBe(200);
      expect(e.headers['content-disposition']).toContain(`.${fmt}`);
    }
    expect((await requester.get('/api/daamr/requests/export?format=csv')).status).toBe(403);
    const pdf = await requester.get(`/api/daamr/requests/${reqId}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');

    const audit = await admin.get(`/api/admin/audit?q=${daamrId}&pageSize=200`);
    const acts = audit.body.rows.map((r: any) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['REQUEST_CREATED', 'REQUEST_SUBMITTED', 'REQUEST_RESUBMITTED', 'WORKFLOW_APPROVE', 'WORKFLOW_RETURN', 'FILE_UPLOADED', 'EXECUTION_STATUS_CHANGED', 'ACTIVITY_REPORT_SUBMITTED']));
    expect((await requester.get('/api/admin/audit')).status).toBe(403);
  });

  it('audit and approval history are immutable at the database level', async () => {
    const row = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: 'TAMPERED' } })).rejects.toThrow(/immutable/);
    const h = await prisma.approvalHistory.findFirstOrThrow();
    await expect(prisma.approvalHistory.delete({ where: { id: h.id } })).rejects.toThrow(/immutable/);
  });
});
