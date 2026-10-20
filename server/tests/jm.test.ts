import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, PNG, iso, idOf, startSmtp, settleEmails, prisma, client, type Client } from './helpers.js';

let smtp: Awaited<ReturnType<typeof startSmtp>>;
let officer: Client, districtReviewer: Client, monitoring: Client, supervisor: Client, admin: Client, hostelOnly: Client;
let assetId: string;

beforeAll(async () => {
  smtp = await startSmtp();
  [officer, districtReviewer, monitoring, supervisor, admin, hostelOnly] = await Promise.all([
    login('requester.mardan@dya.gov.pk'), login('do.mardan@dya.gov.pk'), login('monitoring@dya.gov.pk'), login('supervisor@dya.gov.pk'), login('admin@dya.gov.pk'), login('hq.officer@dya.gov.pk'),
  ]);
  assetId = (await prisma.jmAsset.findUniqueOrThrow({ where: { name: 'Jawan Markaz Mardan' } })).id;
});
afterAll(async () => smtp.close());

const report = (over: any = {}) => ({
  assetId,
  periodFrom: iso(-30),
  periodTo: iso(0),
  inspectionDate: iso(-1),
  inspectionType: 'ROUTINE',
  projectStatus: 'IN_PROGRESS',
  currentProgress: 74,
  previousProgress: 70,
  plannedProgress: 80,
  delayDays: 20,
  completedSummary: 'Roof slab of main hall completed.',
  completed: [{ description: 'Roof slab casting – main hall', completionDate: iso(-10), quantity: '420 m²', wasPlanned: true }],
  planned: [{ description: 'Brick masonry – first floor', expectedDate: iso(30), responsible: 'Contractor' }],
  qualityRating: 'SATISFACTORY',
  qualityRemarks: 'Concrete cube tests within limits.',
  complianceRating: 'PARTIALLY_COMPLIANT',
  complianceChecklist: [{ criterion: 'Site safety measures in place', result: 'PARTIAL', note: 'Helmets not used by all labour' }],
  issues: [{ key: 'i1', description: 'Shortage of skilled masons', category: 'CONTRACTOR', dateIdentified: iso(-5), severity: 'HIGH', status: 'OPEN', targetDate: iso(15) }],
  actions: [{ issueKey: 'i1', description: 'Contractor to deploy two additional mason teams', actionType: 'REQUIRED', responsible: 'M/s Yousafzai Associates', targetDate: iso(-2), status: 'OPEN' }],
  risks: [{ description: 'Monsoon may halt external works', category: 'SCHEDULE', probability: 'LIKELY', impact: 'MAJOR', status: 'OPEN', mitigations: [{ measures: 'Complete roof waterproofing before July', status: 'PLANNED' }] }],
  overallAssessment: 'Progress slightly behind plan, quality satisfactory.',
  followUpRequired: true,
  nextInspectionDate: iso(30),
  ...over,
});

describe('Jawan Markaz monitoring report review workflow', () => {
  let id: string;
  let reportNo: string;

  it('validates the reporting period and requires personal certification before submission', async () => {
    const bad = await officer.post('/api/jm/reports', report({ periodTo: iso(-60) }));
    expect(bad.status).toBe(422);
    expect(bad.body.details.fields.periodTo).toBeTruthy();
    const uncert = await officer.post('/api/jm/reports', { ...report(), submit: true });
    expect(uncert.status).toBe(422);
    expect(uncert.body.details.fields.certConfirmed).toBeTruthy();
    const badLookup = await officer.post('/api/jm/reports', report({ qualityRating: 'AMAZING' }));
    expect(badLookup.status).toBe(400);
  });

  it('saves a draft with computed classification, progress change and risk score', async () => {
    const r = await officer.post('/api/jm/reports', report());
    expect(r.status).toBe(201);
    expect(r.body.reportNo).toMatch(/^DAAMR-JM-\d{4}-\d{5}$/);
    expect(r.body.scheduleClass).toBe('SLIGHTLY_DELAYED'); // 20 days ≤ 30 day threshold
    expect(r.body.progressDuringPeriod).toBe(4);
    expect(r.body.progressDiscrepancy).toBe(true); // behind plan
    id = r.body.id;
    reportNo = r.body.reportNo;
    const d = await officer.get(`/api/jm/reports/${id}`);
    expect(d.body.report.risks[0]).toMatchObject({ score: 16, level: 'CRITICAL' }); // likely(4) × major(4) = 16 > 15
    expect(d.body.report.actions[0].issue.issueCode).toBe(d.body.report.issues[0].issueCode);
    expect(d.body.discrepancies.length).toBeGreaterThan(0);
  });

  it('uploads geo-tagged photographs with clearly labelled location source', async () => {
    const up = await officer.upload(`/api/files/jm-report/${id}`, { category: 'WORK_IN_PROGRESS', caption: 'Main hall', latitude: '34.2011', longitude: '72.0520', locationSource: 'DEVICE' }, [{ name: 'site.png', buf: PNG }]);
    expect(up.status).toBe(201);
    expect(up.body[0]).toMatchObject({ locationSource: 'DEVICE', latitude: 34.2011 });
    const manual = await officer.upload(`/api/files/jm-report/${id}`, { category: 'DEFECT_EVIDENCE', latitude: '34.2', longitude: '72.05' }, [{ name: 'crack.png', buf: PNG }]);
    expect(manual.body[0].locationSource).toBe('MANUAL');
    const badLat = await officer.upload(`/api/files/jm-report/${id}`, { category: 'OTHER', latitude: '120', longitude: '72' }, [{ name: 'x.png', buf: PNG }]);
    expect(badLat.status).toBe(422);
    const f = await prisma.file.findFirstOrThrow({ where: { id: up.body[0].id } });
    expect(f.jmAssetId).toBe(assetId);
  });

  it('submits with certification by the signed-in officer and routes to the district reviewer', async () => {
    const r = await officer.put(`/api/jm/reports/${id}`, { ...report(), certConfirmed: true, submit: true });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('PENDING_REVIEW');
    expect(r.body.certName).toBe('Ayesha Khan');
    expect(r.body.certifiedAt).toBeTruthy();
    const d = await districtReviewer.get(`/api/jm/reports/${id}`);
    expect(d.body.can.canDecide).toBe(true);
    expect((await monitoring.post(`/api/jm/reports/${id}/decision`, { action: 'APPROVE' })).status).toBe(403);
  });

  it('return → correct → resubmit resumes at the returning level (configured policy)', async () => {
    expect((await districtReviewer.post(`/api/jm/reports/${id}/decision`, { action: 'APPROVE', remarks: 'Checked on site.' })).status).toBe(200);
    expect((await monitoring.post(`/api/jm/reports/${id}/decision`, { action: 'RETURN', remarks: 'Attach material test results.' })).status).toBe(200);
    expect((await officer.get(`/api/jm/reports/${id}`)).body.report.status).toBe('RETURNED');
    const existing = (await officer.get(`/api/jm/reports/${id}`)).body.report;
    const body = report({ issues: existing.issues.map((i: any) => ({ ...i, key: i.id, dateIdentified: i.dateIdentified.slice(0, 10), targetDate: i.targetDate?.slice(0, 10) ?? '' })), actions: existing.actions.map((a: any) => ({ id: a.id, issueKey: a.issueId, description: a.description, actionType: a.actionType, status: a.status, targetDate: a.targetDate?.slice(0, 10) ?? '' })), qualityRemarks: 'Cube tests attached.' });
    const re = await officer.put(`/api/jm/reports/${id}`, { ...body, certConfirmed: true, submit: true });
    expect(re.status).toBe(200);
    const d = await officer.get(`/api/jm/reports/${id}`);
    expect(d.body.report.issues[0].issueCode).toBe(existing.issues[0].issueCode); // identifiers preserved
    expect(d.body.timeline.instance.currentAssignee.id).toBe(await idOf('monitoring@dya.gov.pk'));
    expect(d.body.report.status).toBe('UNDER_REVIEW');
  });

  it('final verification updates the asset and the dashboard (distinct assets)', async () => {
    expect((await monitoring.post(`/api/jm/reports/${id}/decision`, { action: 'APPROVE', remarks: 'Verified.' })).status).toBe(200);
    expect((await supervisor.post(`/api/jm/reports/${id}/decision`, { action: 'APPROVE', remarks: 'Approved; expedite masonry.' })).status).toBe(200);
    const d = await officer.get(`/api/jm/reports/${id}`);
    expect(d.body.report.status).toBe('VERIFIED');
    expect(d.body.report.finalReviewer.id).toBe(await idOf('supervisor@dya.gov.pk'));
    expect(d.body.report.supervisorRemarks).toContain('expedite masonry');
    const asset = await prisma.jmAsset.findUniqueOrThrow({ where: { id: assetId } });
    expect(asset.overallProgress).toBe(74);
    expect(asset.lastInspectionDate?.toISOString().slice(0, 10)).toBe(iso(-1));

    // a second report for the same asset still awaiting review is provisional and not double counted
    const second = await officer.post('/api/jm/reports', { ...report({ currentProgress: 78, previousProgress: 74, delayDays: 45 }), certConfirmed: true, submit: true });
    expect(second.status).toBe(201);
    const dash = await admin.get(`/api/jm/dashboard?from=${iso(-5)}&to=${iso(1)}`);
    expect(dash.body.summary.totalReports).toBe(2);
    expect(dash.body.summary.slightlyDelayed).toBe(1);
    expect(dash.body.summary.significantlyDelayed).toBe(0);
    expect(dash.body.summary.satisfactoryQuality).toBe(1);
    expect(dash.body.lists.slightlyDelayed[0].name).toBe('Jawan Markaz Mardan');
    expect(dash.body.provisional.significantlyDelayed[0].name).toBe('Jawan Markaz Mardan');
    expect(dash.body.summary.criticalRisks).toBeGreaterThanOrEqual(1);
    const byAsset = await admin.get(`/api/jm/dashboard?filter=asset:${assetId}`);
    expect(byAsset.body.summary.totalReports).toBe(2);
    const pdf = await admin.get(`/api/jm/dashboard/export?format=pdf&from=${iso(-5)}&to=${iso(1)}`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('analytics: planned vs actual, review ageing, turnaround, search and status filters', async () => {
    const range = `from=${iso(-5)}&to=${iso(1)}`;
    const a = await supervisor.get(`/api/jm/dashboard/analytics?${range}`);
    expect(a.status).toBe(200);
    const row = a.body.progressComparison.find((r: any) => r.reportNo === reportNo);
    expect(row).toMatchObject({ planned: 80, actual: 74, gap: -6, delayDays: 20, scheduleClass: 'SLIGHTLY_DELAYED' });
    const waiting = a.body.pendingReview.filter((r: any) => r.asset === 'Jawan Markaz Mardan');
    expect(waiting).toHaveLength(1);
    expect(waiting[0].assignee).toBeTruthy();
    expect(a.body.turnaround.find((t: any) => t.district === 'Mardan').verified).toBe(1);
    expect(a.body.inspectionTypes.find((x: any) => x.name === 'Routine').value).toBeGreaterThanOrEqual(2);

    const verifiedOnly = await supervisor.get(`/api/jm/dashboard/analytics?${range}&status=VERIFIED`);
    expect(verifiedOnly.body.pendingReview).toHaveLength(0);
    const searched = await supervisor.get(`/api/jm/dashboard/analytics?${range}&search=${encodeURIComponent(reportNo)}`);
    expect(searched.body.reviewStatus).toEqual([{ name: 'Verified', value: 1 }]);
    const none = await supervisor.get(`/api/jm/dashboard/analytics?${range}&search=no-such-asset`);
    expect(none.body.progressComparison).toHaveLength(0);

    const xlsx = await admin.get(`/api/jm/dashboard/analytics/export?format=xlsx&${range}`);
    expect(xlsx.status).toBe(200);
    expect((await hostelOnly.get(`/api/jm/dashboard/analytics?${range}`)).status).toBe(403);
  });

  it('asset profile shows progress history, registers and photos; registers track actions to verification', async () => {
    const a = await supervisor.get(`/api/jm/assets/${assetId}`);
    expect(a.status).toBe(200);
    expect(a.body.progressSeries).toHaveLength(1);
    expect(a.body.photos.length).toBe(2);
    const actions = await supervisor.get('/api/jm/registers/actions?overdue=true');
    const act = actions.body.rows.find((x: any) => x.report.reportNo === reportNo);
    expect(act).toBeTruthy();
    expect((await supervisor.patch(`/api/jm/registers/actions/${act.id}`, { status: 'VERIFIED' })).status).toBe(400);
    expect((await officer.patch(`/api/jm/registers/actions/${act.id}`, { status: 'COMPLETED', completionRemarks: 'Teams deployed.' })).status).toBe(200);
    expect((await officer.patch(`/api/jm/registers/actions/${act.id}`, { status: 'VERIFIED' })).status).toBe(403);
    expect((await supervisor.patch(`/api/jm/registers/actions/${act.id}`, { status: 'VERIFIED' })).status).toBe(200);
    expect((await hostelOnly.get(`/api/jm/assets/${assetId}`)).status).toBe(403);
  });

  it('administrators can register assets; the PDF report renders all sections', async () => {
    const district = (await prisma.district.findUniqueOrThrow({ where: { name: 'Swabi' } })).id;
    const created = await admin.post('/api/jm/assets', { name: 'Jawan Markaz Swabi', districtId: district, location: 'Swabi city', currentStatus: 'PLANNING', latitude: 34.12, longitude: 72.47 });
    expect(created.status).toBe(201);
    expect(created.body.assetCode).toMatch(/^JMA-\d{4}$/);
    expect((await officer.post('/api/jm/assets', { name: 'x', districtId: district, location: 'x', currentStatus: 'PLANNING' })).status).toBe(403);
    const pdf = await officer.get(`/api/jm/reports/${id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.body.length).toBeGreaterThan(3000);
  });
});

describe('Security & configuration', () => {
  it('rejects unauthenticated access and cross-site requests', async () => {
    const anon = client();
    expect((await anon.get('/api/daamr/requests')).status).toBe(401);
    const noHeader = await anon.agent.post('/api/auth/login').send({ email: 'admin@dya.gov.pk', password: 'Password@123' });
    expect(noHeader.status).toBe(403);
  });

  it('locks an account after repeated failed sign-ins', async () => {
    const c = client();
    for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email: 'head.swat@dya.gov.pk', password: 'wrong' });
    expect((await c.post('/api/auth/login', { email: 'head.swat@dya.gov.pk', password: 'Password@123' })).status).toBe(423);
    const admin = await login('admin@dya.gov.pk');
    expect((await admin.post(`/api/admin/users/${await idOf('head.swat@dya.gov.pk')}/unlock`)).status).toBe(200);
  });

  it('expires idle sessions', async () => {
    const c = await login('do.swat@dya.gov.pk');
    await prisma.session.updateMany({ where: { user: { email: 'do.swat@dya.gov.pk' } }, data: { lastSeenAt: new Date(Date.now() - 3 * 3600_000) } });
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('password reset does not reveal whether an account exists', async () => {
    const c = client();
    const a = await c.post('/api/auth/forgot-password', { email: 'nobody@nowhere.pk' });
    const b = await c.post('/api/auth/forgot-password', { email: 'admin@dya.gov.pk' });
    expect(a.body.message).toBe(b.body.message);
  });

  it('workflow steps are configurable: a district-specific chain overrides the default', async () => {
    const admin = await login('admin@dya.gov.pk');
    const swat = (await prisma.district.findUniqueOrThrow({ where: { name: 'Swat' } })).id;
    const head = await idOf('head.swat@dya.gov.pk');
    const wf = await admin.post('/api/admin/workflows', {
      module: 'DAAMR_REQUEST', name: 'Swat fast-track', districtId: swat, isActive: true, resubmitPolicy: 'RETURNING_LEVEL',
      levels: [{ name: 'District Head only', approverType: 'USER', approverUserId: head, districtScope: 'ANY', allowReject: true, allowReturn: true }],
    });
    expect(wf.status).toBe(201);
    const req = await login('requester.swat@dya.gov.pk');
    const r = await req.post('/api/daamr/requests', { requesteeEmail: 'requester.swat@dya.gov.pk', districtId: swat, subject: 'Hiking camp', area: 'Kalam', description: 'Camp', startDate: iso(5), endDate: iso(6), venue: 'Kalam', venueAddress: 'Kalam valley', objectives: 'Outdoor skills', proposedBudget: 1000, submit: true });
    expect(r.status).toBe(201);
    const d = await admin.get(`/api/daamr/requests/${r.body.id}`);
    expect(d.body.timeline.instance.currentAssignee.id).toBe(head);
    expect(d.body.timeline.stages).toHaveLength(2);
    const audit = await prisma.auditLog.count({ where: { action: 'WORKFLOW_CREATED', entityId: wf.body.id } });
    expect(audit).toBe(1);
    const reqUser = await login('requester.mardan@dya.gov.pk');
    expect((await reqUser.post('/api/admin/workflows', {})).status).toBe(403);
  });
});

describe('Inspection schedule, overdue reminders and geo-tagged gallery', () => {
  it('flags overdue follow-up inspections and sends reminders to the officer and supervisors', async () => {
    const officer = await login('requester.mardan@dya.gov.pk');
    const admin = await login('admin@dya.gov.pk');
    const buner = (await prisma.jmAsset.findUniqueOrThrow({ where: { name: 'Jawan Markaz Buner' } })).id;
    const r = await officer.post('/api/jm/reports', {
      ...report({ assetId: buner, inspectionDate: iso(-40), periodFrom: iso(-60), periodTo: iso(-40), nextInspectionDate: iso(-10), issues: [], risks: [],
        actions: [{ description: 'Repair cracked parapet', actionType: 'REQUIRED', targetDate: iso(-5), status: 'OPEN' }] }),
      certConfirmed: true, submit: true,
    });
    expect(r.status).toBe(201);
    // no reviewer is posted in Buner → pending assignment; administrator acts by override at each level
    const d0 = await admin.get(`/api/jm/reports/${r.body.id}`);
    expect(d0.body.timeline.stages[1].state).toBe('PENDING_ASSIGNMENT');
    for (let i = 0; i < 3; i++) expect((await admin.post(`/api/jm/reports/${r.body.id}/decision`, { action: 'APPROVE', remarks: 'Override approval' })).status).toBe(200);
    const sched = await admin.get('/api/jm/monitoring/inspections?state=OVERDUE');
    const row = sched.body.find((x: any) => x.assetId === buner);
    expect(row).toMatchObject({ state: 'OVERDUE', daysOverdue: 10 });
    const dash = await admin.get('/api/jm/dashboard');
    expect(dash.body.summary.overdueInspections).toBeGreaterThanOrEqual(1);

    const before = await prisma.emailLog.count({ where: { event: { in: ['JM_OVERDUE_REMINDER', 'JM_OVERDUE_DIGEST'] } } });
    const run = await admin.post('/api/jm/monitoring/reminders/run');
    expect(run.status).toBe(200);
    expect(run.body.overdueInspections).toBeGreaterThanOrEqual(1);
    expect(run.body.overdueActions).toBeGreaterThanOrEqual(1);
    await settleEmails();
    const mails = await prisma.emailLog.findMany({ where: { event: { in: ['JM_OVERDUE_REMINDER', 'JM_OVERDUE_DIGEST'] } } });
    expect(mails.length).toBeGreaterThan(before);
    expect(mails.some((m) => m.toEmail === 'requester.mardan@dya.gov.pk' && m.status === 'SENT' && m.body.includes('Repair cracked parapet'))).toBe(true);
    expect(mails.some((m) => m.toEmail === 'supervisor@dya.gov.pk' && m.event === 'JM_OVERDUE_DIGEST')).toBe(true);
    expect((await officer.post('/api/jm/monitoring/reminders/run')).status).toBe(403);
  });

  it('gallery returns only photos the user may see, with map points for located photos', async () => {
    const supervisor = await login('supervisor@dya.gov.pk');
    const g = await supervisor.get('/api/jm/monitoring/gallery?located=true');
    expect(g.status).toBe(200);
    expect(g.body.points.length).toBeGreaterThanOrEqual(1);
    expect(g.body.rows.every((p: any) => p.latitude != null)).toBe(true);
    const hostelOnly = await login('hq.officer@dya.gov.pk');
    expect((await hostelOnly.get('/api/jm/monitoring/gallery')).status).toBe(403);
  });
});

describe('Email (SMTP) settings configured from the admin screen', () => {
  it('saved settings override .env, password stays write-only, test email reports the real result', async () => {
    const second = await startSmtp(2527);
    try {
      const admin = await login('admin@dya.gov.pk');
      expect((await admin.put('/api/admin/smtp', { host: 'bad host!', port: 25, from: 'x' })).status).toBe(422);
      const save = await admin.put('/api/admin/smtp', { host: '127.0.0.1', port: 2527, secure: false, ignoreTls: true, user: '', password: 'S3cret-pass', from: 'DYA Portal <portal@test.local>' });
      expect(save.status).toBe(200);
      const got = await admin.get('/api/admin/smtp');
      expect(got.body.saved).toMatchObject({ host: '127.0.0.1', port: 2527, passwordSet: true });
      expect(JSON.stringify(got.body)).not.toContain('S3cret');
      expect(got.body.activeSource).toBe('SETTINGS');
      const stored = await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'smtp' } });
      expect(JSON.stringify(stored.value)).not.toContain('S3cret'); // encrypted at rest

      const ok = await admin.post('/api/admin/smtp/test', { to: 'it-team@test.local' });
      expect(ok.body.status).toBe('SENT');
      expect(second.received.some((m) => m.to.includes('it-team@test.local'))).toBe(true);
      const bounced = await admin.post('/api/admin/smtp/test', { to: 'bounce@test.local' });
      expect(bounced.body.status).toBe('FAILED');
      expect(bounced.body.error).toBeTruthy();

      // keep stored password when the field is left empty
      await admin.put('/api/admin/smtp', { host: '127.0.0.1', port: 2527, ignoreTls: true, from: 'portal@test.local' });
      expect((await admin.get('/api/admin/smtp')).body.saved.passwordSet).toBe(true);

      const officer = await login('requester.mardan@dya.gov.pk');
      expect((await officer.get('/api/admin/smtp')).status).toBe(403);
      expect((await officer.post('/api/admin/smtp/test', { to: 'a@b.pk' })).status).toBe(403);

      expect((await admin.del('/api/admin/smtp')).status).toBe(200);
      expect((await admin.get('/api/admin/smtp')).body.activeSource).toBe('ENV');
      expect(await prisma.auditLog.count({ where: { action: { in: ['SMTP_SETTINGS_UPDATED', 'SMTP_TEST_SENT', 'SMTP_SETTINGS_CLEARED'] } } })).toBeGreaterThanOrEqual(4);
    } finally {
      await second.close();
    }
  });
});
