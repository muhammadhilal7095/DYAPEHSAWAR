/**
 * Optional demo data: drives the real API in-process (same validation, workflow, audit and
 * notification logic as production) to create sample requests, bookings and monitoring reports.
 *
 *   npm run db:seed:demo        (run after `npm run db:seed` on an empty database)
 */
import request from 'supertest';
import zlib from 'node:zlib';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { flushEmails } from '../src/lib/mailer.js';

const app = createApp();
const PASSWORD = 'Password@123';
const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function as(email: string) {
  const agent = request.agent(app);
  const h = (r: request.Test) => r.set('X-Requested-With', 'XMLHttpRequest');
  const r = await h(agent.post('/api/auth/login')).send({ email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login ${email}: ${JSON.stringify(r.body)}`);
  const ok = (res: request.Response, what: string) => {
    if (res.status >= 300) throw new Error(`${what} → ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  return {
    get: async (u: string) => ok(await agent.get(u), u),
    post: async (u: string, b?: any) => ok(await h(agent.post(u)).send(b ?? {}), u),
    put: async (u: string, b?: any) => ok(await h(agent.put(u)).send(b ?? {}), u),
    upload: async (u: string, fields: Record<string, string>, name: string, buf: Buffer) => {
      let t = h(agent.post(u));
      for (const [k, v] of Object.entries(fields)) t = t.field(k, v);
      return ok(await t.attach('files', buf, name), u);
    },
  };
}

// Minimal PNG encoder for illustrative placeholder photographs (gradient + simple shapes).
function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function photo(seed: number, w = 480, h = 320) {
  const sky = [[135, 190, 230], [250, 200, 140], [180, 210, 235]][seed % 3];
  const ground = [[90, 140, 80], [150, 120, 90], [110, 110, 115]][(seed >> 1) % 3];
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const horizon = h * 0.55 + Math.sin((x + seed * 40) / 60) * 12;
      const isGround = y > horizon;
      const bx = (x - 140 - seed * 37) % w;
      const building = !isGround && y > h * 0.3 && bx > 0 && bx < 120 && y < horizon + 2;
      const base = building ? [200, 195, 185] : isGround ? ground : sky;
      const shade = isGround ? 1 - (y - horizon) / h / 1.5 : 0.75 + (y / h) * 0.35;
      row[1 + x * 3] = Math.min(255, base[0] * shade);
      row[2 + x * 3] = Math.min(255, base[1] * shade);
      row[3 + x * 3] = Math.min(255, base[2] * shade);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

async function main() {
  if (await prisma.activityRequest.count()) {
    console.log('Demo data already present — skipping.');
    return;
  }
  const d = Object.fromEntries((await prisma.district.findMany()).map((x) => [x.name, x.id]));
  const U = {
    reqMardan: await as('requester.mardan@dya.gov.pk'), doMardan: await as('do.mardan@dya.gov.pk'), headMardan: await as('head.mardan@dya.gov.pk'),
    reqSwat: await as('requester.swat@dya.gov.pk'), doSwat: await as('do.swat@dya.gov.pk'), headSwat: await as('head.swat@dya.gov.pk'),
    directorate: await as('directorate@dya.gov.pk'), director: await as('director@dya.gov.pk'),
    hq: await as('hq.officer@dya.gov.pk'), approver: await as('hostel.approver@dya.gov.pk'),
    mgrB: await as('manager.batakundi@dya.gov.pk'), mgrC: await as('manager.chapra@dya.gov.pk'), mgrK: await as('manager.khanaspur@dya.gov.pk'),
    admin: await as('admin@dya.gov.pk'),
    reqBannu: await as('requester.bannu@dya.gov.pk'), revBannu: await as('reviewer.bannu@dya.gov.pk'), monitoring: await as('monitoring@dya.gov.pk'), supervisor: await as('supervisor@dya.gov.pk'),
  };

  // ── DAAMR ──
  const reqs = [
    { u: U.reqMardan, district: 'Mardan', category: 'SPORTS', subject: 'Inter-college cricket tournament', area: 'Mardan city', venue: 'Mardan Sports Complex', budget: 250000, stage: 'reported' },
    { u: U.reqMardan, district: 'Mardan', category: 'SKILL_DEVELOPMENT', subject: 'Digital skills bootcamp for young women', area: 'Takht Bhai', venue: 'Govt. Girls College Takht Bhai', budget: 180000, stage: 'approved' },
    { u: U.reqMardan, district: 'Mardan', category: 'AWARENESS', subject: 'Anti-drug awareness walk', area: 'Mardan city', venue: 'Shaheed Chowk', budget: 60000, stage: 'level3' },
    { u: U.reqMardan, district: 'Mardan', category: 'CULTURAL', subject: 'Pashto literary evening', area: 'Katlang', venue: 'Town Hall Katlang', budget: 90000, stage: 'returned' },
    { u: U.reqSwat, district: 'Swat', category: 'HEALTH', subject: 'Youth mental-health seminar', area: 'Mingora', venue: 'University of Swat auditorium', budget: 120000, stage: 'reported' },
    { u: U.reqSwat, district: 'Swat', category: 'COMMUNITY_SERVICE', subject: 'River-bank clean-up drive', area: 'Fizagat', venue: 'Fizagat Park', budget: 45000, stage: 'rejected' },
    { u: U.reqSwat, district: 'Swat', category: 'YOUTH_LEADERSHIP', subject: 'District youth parliament session', area: 'Saidu Sharif', venue: 'Swat Press Club', budget: 150000, stage: 'pending' },
    { u: U.reqBannu, district: 'Bannu', category: 'SPORTS', subject: 'Inter-tehsil football league', area: 'Bannu', venue: 'Bannu Sports Stadium', budget: 300000, stage: 'pending' },
  ];
  let n = 0;
  for (const r of reqs) {
    n++;
    const chain = r.district === 'Swat' ? [U.doSwat, U.headSwat, U.directorate, U.director] : r.district === 'Bannu' ? [U.revBannu] : [U.doMardan, U.headMardan, U.directorate, U.director];
    const created = await r.u.post('/api/daamr/requests', {
      requesteeEmail: r.district === 'Swat' ? 'requester.swat@dya.gov.pk' : r.district === 'Bannu' ? 'requester.bannu@dya.gov.pk' : 'requester.mardan@dya.gov.pk',
      districtId: d[r.district], category: r.category, subject: r.subject, area: r.area, venue: r.venue, proposedBudget: r.budget,
      description: `${r.subject} organised by the District Youth Office ${r.district} for local youth.`, startDate: iso(5 + n * 3), endDate: iso(6 + n * 3),
      objectives: `Engage young people of ${r.district} in ${r.category.toLowerCase().replace(/_/g, ' ')} and build leadership and teamwork skills.`,
      venueAddress: `${r.venue}, ${r.area}, District ${r.district}`, tehsil: r.area, startTime: '09:00', endTime: '16:00',
      targetAudience: 'Youth aged 15–29 from schools, colleges and the community', expectedParticipants: 100 + n * 10, priority: n % 4 === 0 ? 'HIGH' : 'NORMAL',
    });
    if (r.district === 'Mardan') {
      const staff = (await prisma.user.findMany({ where: { email: { in: ['staff.mardan@dya.gov.pk', 'staff2.mardan@dya.gov.pk'] } }, orderBy: { email: 'asc' } })).map((u) => u.id);
      await r.u.post(`/api/daamr/requests/${created.id}/assignments`, {
        assigneeIds: staff, leadId: staff[0], responsibilities: 'Coordinate venue, participants and logistics; prepare the execution report.',
        deadline: iso(6 + n * 3), priority: 'NORMAL', instructions: 'Share the participant list with the district office two days before the event.',
      });
    }
    await r.u.upload(`/api/files/activity-request/${created.id}`, { category: 'PRE_ACTIVITY', caption: `${r.venue} — venue` }, `venue-${n}.png`, photo(n));
    await r.u.upload(`/api/files/activity-request/${created.id}`, { category: 'SUPPORTING' }, `concept-note-${n}.pdf`, PDF);
    await r.u.post(`/api/daamr/requests/${created.id}/submit`);
    const id = created.id;
    const dec = (c: any, action = 'APPROVE', remarks?: string) => c.post(`/api/daamr/requests/${id}/decision`, { action, remarks });
    if (r.stage === 'pending') continue;
    if (r.stage === 'rejected') { await dec(chain[0], 'REJECT', 'Similar activity already conducted this quarter.'); continue; }
    if (r.stage === 'returned') { await dec(chain[0], 'APPROVE', 'Recommended.'); await dec(chain[1], 'RETURN', 'Please attach the participant list and reduce catering costs.'); continue; }
    await dec(chain[0], 'APPROVE', 'Recommended.');
    await dec(chain[1], 'APPROVE', 'Endorsed.');
    if (r.stage === 'level3') continue;
    await dec(chain[2], 'APPROVE', 'Within programme guidelines.');
    await dec(chain[3], 'APPROVE', 'Approved.');
    if (r.stage === 'approved') { await r.u.post(`/api/daamr/requests/${id}/execution`, { executionStatus: 'SCHEDULED' }); continue; }
    await r.u.post(`/api/daamr/requests/${id}/execution`, { executionStatus: 'COMPLETED' });
    for (let k = 0; k < 3; k++) await r.u.upload(`/api/files/activity-request/${id}`, { category: 'POST_ACTIVITY', caption: ['Opening ceremony', 'Participants', 'Prize distribution'][k] }, `evidence-${n}-${k}.png`, photo(n + k + 3));
    const male = 80 + n * 7, female = 40 + n * 5;
    const rep = await r.u.post('/api/daamr/reports', {
      requestId: id, activityDate: iso(5 + n * 3), districtId: d[r.district], activityName: r.subject, category: r.category, venue: r.venue,
      description: 'The activity was conducted successfully with active participation.', responsibleOfficer: r.district === 'Swat' ? 'Bilal Ahmad' : 'Ayesha Khan', activityStatus: 'COMPLETED',
      participants: { male, female, minority: 6, madaris: 12, transgender: 2, disabled: 4, juvenile: 35 },
      budget: { allocated: r.budget, utilized: Math.round(r.budget * (0.85 + n * 0.03)), fundSource: 'ADP Youth Programme' },
      mediaLinks: [{ platform: 'FACEBOOK', url: 'https://www.facebook.com/' }, { platform: 'NEWSPAPER', url: 'https://www.dawn.com/' }],
      submit: true,
    });
    await U.directorate.post(`/api/daamr/reports/${rep.id}/decision`, { action: 'APPROVE', remarks: 'Verified against photographs and media coverage.' });
  }

  // ── Hostels ──
  const H = Object.fromEntries((await prisma.hostel.findMany()).map((h) => [h.name.split(' ')[0], h.id]));
  const bookings = [
    { hostel: 'Batakundi', guest: 'Muhammad Usman', org: 'Government College Mardan', g: 6, r: 3, in: 0, out: 3, stage: 'completed', mgr: U.mgrB },
    { hostel: 'Chapra', guest: 'Sana Iqbal', org: 'University of Swat', g: 4, r: 2, in: 0, out: 2, stage: 'completed', mgr: U.mgrC },
    { hostel: 'Khanaspur', guest: 'Adeel Khan', org: 'Youth Parliament KP', g: 10, r: 2, in: 0, out: 4, stage: 'checkedin', mgr: U.mgrK },
    { hostel: 'Batakundi', guest: 'Hira Bibi', org: 'Girl Guides Mardan', g: 8, r: 2, in: 7, out: 10, stage: 'approved', mgr: U.mgrB },
    { hostel: 'Khanaspur', guest: 'Faisal Rehman', org: 'Boy Scouts Abbottabad', g: 5, r: 3, in: 12, out: 14, stage: 'final', mgr: U.mgrK },
    { hostel: 'Chapra', guest: 'Noor Ali', org: 'Islamia College Peshawar', g: 3, r: 2, in: 4, out: 6, stage: 'pending', mgr: U.mgrC },
    { hostel: 'Batakundi', guest: 'Zainab Shah', org: 'Private tour group', g: 20, r: 7, in: 2, out: 5, stage: 'declined', mgr: U.mgrB },
  ];
  for (const b of bookings) {
    const res = await U.reqMardan.post('/api/hostel/bookings', {
      hostelId: H[b.hostel], districtId: d.Mardan, guestName: b.guest, cnic: `1730${Math.floor(1 + Math.random() * 8)}-${String(1000000 + Math.floor(Math.random() * 8999999))}-${Math.floor(Math.random() * 9)}`,
      mobile: `0300${String(1000000 + Math.floor(Math.random() * 8999999))}`, organization: b.org, referredBy: 'Imran Yousafzai', referrerDesignation: 'District Youth Officer',
      purpose: 'Youth study tour and nature camp', numGuests: b.g, numRooms: b.r, requestedCheckIn: iso(b.in), requestedCheckOut: iso(b.out),
    });
    const id = res.booking.id;
    await U.reqMardan.upload(`/api/files/hostel-booking/${id}`, { category: 'SUPPORTING' }, 'request-letter.pdf', PDF);
    await U.reqMardan.put(`/api/hostel/bookings/${id}`, {
      hostelId: H[b.hostel], districtId: d.Mardan, guestName: b.guest, mobile: '03001234567', organization: b.org, referredBy: 'Imran Yousafzai', referrerDesignation: 'District Youth Officer',
      purpose: 'Youth study tour and nature camp', numGuests: b.g, numRooms: b.r, requestedCheckIn: iso(b.in), requestedCheckOut: iso(b.out), submit: true,
    });
    if (b.stage === 'pending') continue;
    if (b.stage === 'declined') { await U.hq.post(`/api/hostel/bookings/${id}/decision`, { action: 'REJECT', remarks: 'Group size exceeds hostel capacity for these dates.' }); continue; }
    await U.hq.post(`/api/hostel/bookings/${id}/decision`, { action: 'APPROVE', remarks: 'Recommended.' });
    if (b.stage === 'final') continue;
    await U.approver.post(`/api/hostel/bookings/${id}/decision`, { action: 'APPROVE', remarks: 'Approved. Please follow hostel rules.' });
    if (b.stage === 'approved') continue;
    await b.mgr.post(`/api/hostel/bookings/${id}/check-in`, { arrivalAt: new Date().toISOString(), actualGuests: b.g, actualRooms: b.r, idVerified: true, remarks: 'All guests verified.' });
    if (b.stage === 'checkedin') continue;
    await b.mgr.post(`/api/hostel/bookings/${id}/check-out`, { departureAt: new Date(Date.now() + 3600_000).toISOString(), finalGuests: b.g - (b.g > 4 ? 1 : 0), finalRooms: b.r, remarks: 'Rooms inspected, no damage.' });
  }

  // ── Jawan Markaz ──
  const A = Object.fromEntries((await prisma.jmAsset.findMany()).map((a) => [a.name.replace('Jawan Markaz ', ''), a]));
  const jm = [
    { a: 'Mardan', u: U.reqMardan, chain: [U.doMardan, U.monitoring, U.supervisor], cur: 74, plan: 78, delay: 12, q: 'GOOD', comp: 'FULLY_COMPLIANT', status: 'IN_PROGRESS', verify: true },
    { a: 'Bannu', u: U.reqBannu, chain: [U.revBannu, U.monitoring, U.supervisor], cur: 41, plan: 60, delay: 75, q: 'NEEDS_IMPROVEMENT', comp: 'PARTIALLY_COMPLIANT', status: 'SIGNIFICANTLY_DELAYED', verify: true },
    { a: 'Buner', u: U.reqMardan, chain: [U.doMardan, U.monitoring, U.supervisor], cur: 55, plan: 55, delay: 0, q: 'SATISFACTORY', comp: 'FULLY_COMPLIANT', status: 'ON_SCHEDULE', verify: true },
    { a: 'Charsadda', u: U.reqMardan, chain: [U.doMardan, U.monitoring, U.supervisor], cur: 63, plan: 70, delay: 25, q: 'SATISFACTORY', comp: 'PARTIALLY_COMPLIANT', status: 'SLIGHTLY_DELAYED', verify: true },
    { a: 'Chitral Upper', u: U.reqSwat, chain: [U.doSwat, U.monitoring, U.supervisor], cur: 22, plan: 25, delay: null, q: 'GOOD', comp: 'PENDING_VERIFICATION', status: 'IN_PROGRESS', verify: false },
  ];
  let k = 0;
  for (const r of jm) {
    k++;
    const asset = A[r.a];
    const body = {
      assetId: asset.id, periodFrom: iso(-30), periodTo: iso(-1), inspectionDate: iso(-2), inspectionType: 'ROUTINE',
      projectStatus: r.status, currentProgress: r.cur, previousProgress: asset.overallProgress, plannedProgress: r.plan, delayDays: r.delay ?? '',
      completedSummary: 'Structural works progressed on the main block.', expectedNextProgress: 6,
      completed: [{ description: 'Ground floor slab casting', completionDate: iso(-10), quantity: '350 m²', wasPlanned: true }, { description: 'External plaster – east wing', completionDate: iso(-5), quantity: '60%', wasPlanned: false }],
      planned: [{ description: 'First-floor brick masonry', expectedDate: iso(25), milestone: 'Masonry 50%', responsible: asset.contractor }],
      qualityRating: r.q, qualityRemarks: 'Concrete cube tests within specification.', complianceRating: r.comp,
      complianceChecklist: [{ criterion: 'Work conforms to approved drawings & specifications', result: 'COMPLIANT', note: '' }, { criterion: 'Site safety measures in place', result: r.comp === 'FULLY_COMPLIANT' ? 'COMPLIANT' : 'PARTIAL', note: 'PPE usage inconsistent' }],
      issues: r.delay && r.delay > 10 ? [{ key: 'i1', description: 'Delay in release of second instalment to contractor', category: 'FUNDING', dateIdentified: iso(-8), severity: r.delay > 30 ? 'HIGH' : 'MEDIUM', status: 'OPEN', targetDate: iso(10), responsible: 'Finance Section' }] : [],
      actions: r.delay && r.delay > 10 ? [{ issueKey: 'i1', description: 'Process pending payment with Finance Department', actionType: 'REQUIRED', responsible: 'Finance Section', dateAssigned: iso(-2), targetDate: iso(7), status: 'OPEN' }] : [],
      risks: [{ description: 'Monsoon rains may halt external works', category: 'SCHEDULE', probability: 'LIKELY', impact: r.delay && r.delay > 30 ? 'MAJOR' : 'MODERATE', status: 'OPEN', mitigations: [{ measures: 'Complete roof waterproofing before July', status: 'PLANNED' }] }],
      overallAssessment: 'Work is progressing; see issues and recommendations.', keyFindings: 'Quality acceptable; pace needs improvement.', followUpRequired: true, nextInspectionDate: iso(28),
      certConfirmed: true,
    };
    const rep = await r.u.post('/api/jm/reports', body);
    await r.u.upload(`/api/files/jm-report/${rep.id}`, { category: 'WORK_IN_PROGRESS', caption: 'Main block', latitude: String(asset.latitude! + 0.0004), longitude: String(asset.longitude! + 0.0003), locationSource: 'MANUAL' }, `site-${k}.png`, photo(k + 10));
    await r.u.upload(`/api/files/jm-report/${rep.id}`, { category: 'BEFORE_WORK', caption: 'Site at start of period' }, `site-before-${k}.png`, photo(k + 20));
    await r.u.put(`/api/jm/reports/${rep.id}`, { ...body, submit: true });
    if (!r.verify) continue;
    const pending = await prisma.jmReport.findUniqueOrThrow({ where: { id: rep.id }, include: { workflow: true } });
    if (!pending.workflow?.currentAssigneeId) {
      // no district reviewer exists in this district → administrator assigns the item manually
      await U.admin.post(`/api/jm/reports/${rep.id}/reassign`, { userId: (await prisma.user.findUniqueOrThrow({ where: { email: 'do.mardan@dya.gov.pk' } })).id, remarks: 'No district reviewer posted in this district; assigned to neighbouring district officer.' });
    }
    await r.chain[0].post(`/api/jm/reports/${rep.id}/decision`, { action: 'APPROVE', remarks: 'Site visited; figures confirmed.' });
    await r.chain[1].post(`/api/jm/reports/${rep.id}/decision`, { action: 'APPROVE', remarks: 'Progress verified against schedule.' });
    await r.chain[2].post(`/api/jm/reports/${rep.id}/decision`, { action: 'APPROVE', remarks: 'Verified.' });
  }

  await flushEmails();
  console.log('Demo data created.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
