/**
 * Final Course Completion Report (PDF) and course Excel workbook — built only from saved database records.
 */
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { prisma } from '../../db.js';
import { can, type AuthUser } from '../../lib/auth.js';
import { getSettings } from '../../lib/settings.js';
import { storedPath } from '../../lib/files.js';
import { fmtDate, fmtDateTime, humanize, type ReportDoc } from '../../lib/export.js';
import { courseProgress, courseRoles, SESSION_PHOTO_CATEGORIES, SESSION_DOC_CATEGORIES } from './common.js';

const sessionInclude = {
  trainers: true,
  attendance: { include: { participant: true } },
  files: { where: { deletedAt: null }, include: { uploadedBy: { select: { name: true } } }, orderBy: { createdAt: 'asc' as const } },
  workflow: { include: { history: { orderBy: { createdAt: 'asc' as const } } } },
  changes: { orderBy: { createdAt: 'asc' as const } },
};

async function loadCourse(id: string) {
  return prisma.course.findUniqueOrThrow({
    where: { id },
    include: {
      district: true,
      coordinator: true,
      staff: { include: { user: true } },
      trainers: { orderBy: { createdAt: 'asc' } },
      participants: { orderBy: { registrationNo: 'asc' } },
      sessions: { orderBy: { dayNumber: 'asc' }, include: sessionInclude },
      scheduleChanges: { orderBy: { createdAt: 'asc' }, include: { by: true, session: { select: { dayNumber: true } } } },
      completion: { include: { workflow: { include: { history: { orderBy: { createdAt: 'asc' } } } } } },
      activity: { include: { workflow: { include: { history: { orderBy: { createdAt: 'asc' } } } }, requester: true } },
      files: { where: { deletedAt: null, category: { not: 'COURSE_REPORT' } }, include: { uploadedBy: { select: { name: true } } } },
    },
  });
}
type Loaded = Awaited<ReturnType<typeof loadCourse>>;

/** Downscales photographs for the PDF (keeps proportions; JPEG ~80%) so long reports stay a manageable size. */
async function pdfImage(file: { storedName: string; mimeType: string }, cache: Map<string, Buffer | null>) {
  if (cache.has(file.storedName)) return cache.get(file.storedName)!;
  let out: Buffer | null = null;
  const p = storedPath(file.storedName);
  if (fs.existsSync(p)) {
    try {
      out = await sharp(p).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    } catch {
      out = null;
    }
  }
  cache.set(file.storedName, out);
  return out;
}

const safe = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v)).replace(/→/g, '->').replace(/←/g, '<-');

export async function generateCourseReport(courseId: string, opts: { version: number | null; draft: boolean; user: AuthUser }) {
  const s = await getSettings();
  const c = await loadCourse(courseId);
  const progress = await courseProgress(courseId);
  const roles = await courseRoles(opts.user, courseId);
  const showParticipants = !!roles && (roles.coordinate || roles.isStaff || can(opts.user, 'course.view_all'));
  const theme = /^#[0-9a-f]{6}$/i.test(s.themeColor) ? s.themeColor : '#0f5132';
  const generatedAt = new Date();
  const imgCache = new Map<string, Buffer | null>();

  let logo: Buffer | null = null;
  if (s.logoFileId) {
    const f = await prisma.file.findUnique({ where: { id: s.logoFileId } });
    if (f) logo = await pdfImage(f, imgCache);
  }

  const pdf = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 60, left: 50, right: 50 }, bufferPages: true, info: { Title: `${c.courseNo} — ${c.title}`, Author: s.orgName, Subject: 'Final Course Completion Report' } });
  const chunks: Buffer[] = [];
  pdf.on('data', (d) => chunks.push(d));
  const done = new Promise<Buffer>((r) => pdf.on('end', () => r(Buffer.concat(chunks))));
  const L = pdf.page.margins.left;
  const W = pdf.page.width - L - pdf.page.margins.right;
  const bottom = () => pdf.page.height - pdf.page.margins.bottom - 6;
  const newPage = () => { pdf.addPage(); pdf.x = L; pdf.y = pdf.page.margins.top; };
  const ensure = (h: number) => { if (pdf.y + h > bottom()) newPage(); };
  const toc: { title: string; level: number; page: number }[] = [];
  const pageNo = () => pdf.bufferedPageRange().start + pdf.bufferedPageRange().count - 1;

  // ── helpers ──
  const h1 = (t: string) => {
    newPage();
    toc.push({ title: t, level: 0, page: pageNo() });
    pdf.rect(L, pdf.y, 4, 22).fill(theme);
    pdf.fillColor(theme).font('Helvetica-Bold').fontSize(16).text(t, L + 12, pdf.y + 2, { width: W - 12 });
    pdf.moveDown(0.8);
    pdf.x = L;
  };
  const h2 = (t: string, inToc = false, minSpace = 60) => {
    ensure(minSpace);
    if (inToc) toc.push({ title: t, level: 1, page: pageNo() });
    pdf.moveDown(0.4);
    pdf.fillColor('#111827').font('Helvetica-Bold').fontSize(11.5).text(t, L, pdf.y, { width: W });
    pdf.moveTo(L, pdf.y + 2).lineTo(L + W, pdf.y + 2).lineWidth(0.5).strokeColor('#d1d5db').stroke();
    pdf.moveDown(0.5);
  };
  const para = (label: string | null, text: string | null | undefined, empty = 'Not reported.') => {
    const body = safe(text) || empty;
    pdf.font('Helvetica').fontSize(9.5);
    const hLabel = label ? 14 : 0;
    ensure(Math.min(pdf.heightOfString(body, { width: W }) + hLabel + 6, 140));
    if (label) pdf.fillColor('#374151').font('Helvetica-Bold').fontSize(9).text(label, L, pdf.y, { width: W });
    pdf.fillColor(safe(text) ? '#111827' : '#9ca3af').font(safe(text) ? 'Helvetica' : 'Helvetica-Oblique').fontSize(9.5).text(body, L, pdf.y, { width: W, lineGap: 1.5 });
    pdf.moveDown(0.5);
  };
  const kv = (items: [string, unknown][]) => {
    const lw = Math.min(170, W * 0.34);
    for (const [k, v] of items) {
      const val = safe(v) || '—';
      pdf.font('Helvetica').fontSize(9);
      const h = Math.max(pdf.heightOfString(val, { width: W - lw - 10 }), pdf.heightOfString(k, { width: lw - 8 })) + 7;
      ensure(h);
      const y = pdf.y;
      pdf.rect(L, y, W, h).fill('#f9fafb');
      pdf.fillColor('#374151').font('Helvetica-Bold').fontSize(9).text(k, L + 5, y + 3.5, { width: lw - 8 });
      pdf.fillColor('#111827').font('Helvetica').fontSize(9).text(val, L + lw + 5, y + 3.5, { width: W - lw - 10 });
      pdf.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.4).strokeColor('#e5e7eb').stroke();
      pdf.y = y + h;
    }
    pdf.moveDown(0.6);
    pdf.x = L;
  };
  const table = (cols: { label: string; w: number; align?: 'left' | 'right' | 'center' }[], rows: unknown[][], empty = 'No records.') => {
    const total = cols.reduce((a, c2) => a + c2.w, 0);
    const widths = cols.map((c2) => (c2.w / total) * W);
    const fs2 = cols.length > 8 ? 7.5 : 8.5;
    const draw = (vals: string[], header: boolean, shade: boolean) => {
      pdf.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs2);
      const h = Math.max(...vals.map((v, i) => pdf.heightOfString(v || ' ', { width: widths[i] - 6 }))) + 7;
      if (pdf.y + h > bottom()) {
        newPage();
        if (!header) draw(cols.map((c2) => c2.label), true, false); // repeat the header on the new page
      }
      const y = pdf.y;
      if (header) pdf.rect(L, y, W, h).fill(theme);
      else if (shade) pdf.rect(L, y, W, h).fill('#f3f4f6');
      let x = L;
      vals.forEach((v, i) => {
        pdf.fillColor(header ? '#ffffff' : '#111827').font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs2).text(v, x + 3, y + 3.5, { width: widths[i] - 6, align: cols[i].align ?? 'left' });
        x += widths[i];
      });
      pdf.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.4).strokeColor('#d1d5db').stroke();
      pdf.y = y + h;
    };
    ensure(40);
    draw(cols.map((c2) => c2.label), true, false);
    if (!rows.length) {
      pdf.font('Helvetica-Oblique').fontSize(9).fillColor('#6b7280').text(empty, L + 4, pdf.y + 4);
      pdf.moveDown(0.5);
    }
    rows.forEach((r, i) => draw(r.map(safe), false, i % 2 === 1));
    pdf.moveDown(0.6);
    pdf.x = L;
  };
  const gallery = async (items: { file: { storedName: string; mimeType: string; originalName: string }; caption: string }[], perRow = 2) => {
    const gap = 12;
    const cw = (W - gap * (perRow - 1)) / perRow;
    const ih = cw * 0.68;
    let col = 0;
    let rowY = pdf.y;
    for (const it of items) {
      const buf = await pdfImage(it.file, imgCache);
      if (!buf) continue;
      if (col === 0 && rowY + ih + 34 > bottom()) { newPage(); rowY = pdf.y; }
      const x = L + col * (cw + gap);
      pdf.rect(x, rowY, cw, ih).fill('#f3f4f6');
      pdf.image(buf, x, rowY, { fit: [cw, ih], align: 'center', valign: 'center' });
      pdf.fillColor('#374151').font('Helvetica').fontSize(7.5).text(safe(it.caption), x, rowY + ih + 3, { width: cw, height: 26, ellipsis: true });
      if (++col === perRow) { col = 0; rowY += ih + 34; }
    }
    pdf.y = col === 0 ? rowY : rowY + ih + 34;
    pdf.x = L;
  };

  const sessions = c.sessions;
  const conductedSessions = sessions.filter((x) => !['MISSED', 'CANCELLED'].includes(x.status));
  const trainerNames = (x: (typeof sessions)[number]) => x.trainers.map((t) => `${t.name}${t.designation ? ` (${t.designation})` : ''}${t.isGuest ? ' — guest' : ''}`).join('; ');
  const verifyLine = (x: (typeof sessions)[number]) => {
    const fin = x.workflow?.history.filter((h) => h.action === 'FINAL_APPROVED').at(-1);
    return x.status === 'VERIFIED' ? `Verified${fin ? ` by ${fin.actorName}${fin.actorDesignation ? `, ${fin.actorDesignation}` : ''} on ${fmtDateTime(fin.createdAt, s.timezone)}` : ''}` : humanize(x.status);
  };
  const registered = c.participants.filter((p) => p.isActive).length || c.registeredCount;

  // ── Cover page ──
  pdf.rect(0, 0, pdf.page.width, 210).fill(theme);
  if (logo) pdf.image(logo, L, 46, { fit: [70, 70] });
  const tx = logo ? L + 86 : L;
  pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text(s.orgName, tx, 54, { width: W - (tx - L) });
  pdf.font('Helvetica').fontSize(11).text(s.orgSubtitle, tx, pdf.y + 2, { width: W - (tx - L) });
  pdf.fillColor(theme).font('Helvetica-Bold').fontSize(12).text(opts.draft ? 'COURSE REPORT — DRAFT PREVIEW (NOT APPROVED)' : 'FINAL COURSE COMPLETION REPORT', L, 260, { width: W, characterSpacing: 1 });
  pdf.fillColor('#111827').font('Helvetica-Bold').fontSize(24).text(safe(c.title), L, 286, { width: W });
  pdf.moveDown(1.2);
  const coverRows: [string, string][] = [
    ['Course ID', c.courseNo],
    ['Course duration', `${c.durationDays} training day(s) — ${sessions.length} scheduled session(s)`],
    ['Start date', fmtDate(c.startDate)],
    ['End date', fmtDate(c.endDate)],
    ['Venue', `${c.venue}${c.venueAddress ? `, ${c.venueAddress}` : ''}`],
    ['District / HQ', c.district.name],
    ['Approved proposal', c.activity.daamrId],
    ['Report version', opts.version ? `Version ${opts.version}` : 'Draft preview'],
    ['Generated', `${fmtDateTime(generatedAt, s.timezone)} by ${opts.user.name}`],
  ];
  for (const [k, v] of coverRows) {
    const y = pdf.y;
    pdf.fillColor('#6b7280').font('Helvetica').fontSize(10).text(k, L, y, { width: 140 });
    pdf.fillColor('#111827').font('Helvetica-Bold').fontSize(10.5).text(safe(v), L + 150, y, { width: W - 150 });
    pdf.y = Math.max(pdf.y, y + 16) + 4;
  }
  pdf.rect(L, pdf.page.height - 120, W, 1).fill('#d1d5db');
  pdf.fillColor('#6b7280').font('Helvetica').fontSize(8.5).text('Generated from saved and authorised records of the Activity Management System. Figures and narratives are reproduced as recorded and verified; nothing has been estimated or added.', L, pdf.page.height - 108, { width: W });

  // ── Table of contents (filled in at the end) ──
  newPage();
  const tocPage = pageNo();

  // ── Section 1 ──
  h1('1. Executive Summary');
  para('Course introduction', c.completion?.summary ?? c.activity.description);
  para('Background and objectives', c.objectives);
  kv([
    ['Target audience', c.targetAudience], ['Approved proposal reference', `${c.activity.daamrId} (approved ${fmtDate(c.activity.approvedAt)})`],
    ['Course duration', `${c.durationDays} training day(s), ${fmtDate(c.startDate)} – ${fmtDate(c.endDate)}`], ['Delivery format', humanize(c.deliveryFormat) || null],
    ['Sessions verified', `${progress.verified} of ${sessions.length} (${progress.missed} missed, ${progress.cancelled} cancelled)`], ['Course status', humanize(c.status)],
  ]);

  // ── Section 2 ──
  h1('2. Course Details');
  kv([
    ['Training venue', `${c.venue}${c.venueAddress ? `, ${c.venueAddress}` : ''} — ${c.district.name}`], ['Course coordinator', `${c.coordinator.name}${c.coordinator.designation ? `, ${c.coordinator.designation}` : ''}`],
    ['Course team', c.staff.map((x) => x.user.name).join(', ') || null], ['Daily timing', [c.dailyStartTime, c.dailyEndTime].filter(Boolean).join(' – ') || null],
  ]);
  h2('Trainers and their expertise');
  table([{ label: 'Trainer', w: 2 }, { label: 'Designation', w: 2 }, { label: 'Expertise', w: 3 }, { label: 'Type', w: 1 }], c.trainers.map((t) => [t.name, t.designation, t.expertise, t.isGuest ? 'Guest' : 'Approved']));
  h2('Learning objectives');
  para(null, c.objectives);
  h2('Training methodology');
  para(null, c.methodology);
  h2('Approved schedule');
  table(
    [{ label: 'Day', w: 0.6, align: 'center' }, { label: 'Date', w: 1.3 }, { label: 'Time', w: 1.3 }, { label: 'Originally scheduled', w: 1.4 }, { label: 'Status', w: 1.2 }],
    sessions.map((x) => [x.dayNumber, fmtDate(x.sessionDate), [x.startTime, x.endTime].filter(Boolean).join(' – '), x.originalDate.getTime() !== x.sessionDate.getTime() ? fmtDate(x.originalDate) : x.isMakeup ? 'Make-up session' : 'As planned', humanize(x.status)]),
  );
  if (c.scheduleChanges.length) {
    h2('Schedule changes');
    table([{ label: 'Date recorded', w: 1.3 }, { label: 'Day', w: 0.6 }, { label: 'Change', w: 1.2 }, { label: 'From / to', w: 1.6 }, { label: 'Reason', w: 3 }, { label: 'By', w: 1.3 }],
      c.scheduleChanges.map((x) => [fmtDate(x.createdAt), x.session?.dayNumber ?? '', humanize(x.changeType), [x.fromDate && fmtDate(x.fromDate), x.toDate && fmtDate(x.toDate)].filter(Boolean).join(' -> '), x.reason, x.by.name]));
  }

  // ── Section 3 ──
  h1('3. Daily Training Reports');
  const dayToc = sessions.length <= 45;
  for (const x of sessions) {
    h2(`Day ${x.dayNumber} — ${fmtDate(x.sessionDate)}${x.isMakeup ? ' (make-up session)' : ''}`, dayToc);
    if (['MISSED', 'CANCELLED'].includes(x.status)) {
      para('Session recorded as ' + humanize(x.status).toLowerCase(), x.resolutionReason);
      continue;
    }
    kv([
      ['Trainer(s)', trainerNames(x)], ["Today's topic", x.topic], ['Participant attendance', x.presentCount != null ? `${x.presentCount} present, ${x.absentCount ?? 0} absent of ${x.registeredCount ?? registered} registered` : null],
      ['Verification status', verifyLine(x)],
    ]);
    para('Learning objectives', x.learningObjectives);
    para('Detailed content covered', x.topicsCovered);
    para('Practical activities and exercises', x.activities);
    if (x.tools) para('Tools, software and equipment', x.tools);
    para('Learning outcomes and achievements', x.achievements);
    if (x.challenges) para('Challenges or issues', x.challenges);
    if (x.attendanceRemarks) para('Daily remarks', x.attendanceRemarks);
  }

  // ── Section 4 ──
  h1('4. Photographic Documentation');
  const photoCaption = (f: { caption: string | null; category: string; takenAt: Date | null }, x: { dayNumber: number; sessionDate: Date }) =>
    `Day ${x.dayNumber}, ${fmtDate(f.takenAt ?? x.sessionDate)} — ${SESSION_PHOTO_CATEGORIES[f.category] ?? humanize(f.category)}${f.caption ? `: ${f.caption}` : ''}`;
  const included = new Set<string>();
  let anyPhoto = false;
  for (const x of conductedSessions) {
    const photos = x.files.filter((f) => f.kind === 'PHOTO' && f.category !== 'REVIEW_EVIDENCE');
    if (!photos.length) continue;
    // selected photographs; if none were selected for a day, its first two photographs are used
    const chosen = photos.some((f) => f.featured) ? photos.filter((f) => f.featured) : photos.slice(0, 2);
    chosen.forEach((f) => included.add(f.id));
    anyPhoto = true;
    // keep the day heading together with its first row of photographs
    h2(`Day ${x.dayNumber} — ${fmtDate(x.sessionDate)}${x.topic ? ` — ${x.topic}` : ''}`, false, ((W - 24) / 3) * 0.68 + 70);
    await gallery(chosen.map((f) => ({ file: f, caption: photoCaption(f, x) })), 3);
  }
  if (!anyPhoto) para(null, null, 'No photographs were recorded.');

  // ── Section 5 ──
  h1('5. Attendance and Participation');
  const att = conductedSessions.filter((x) => x.presentCount != null);
  const present = att.reduce((a, x) => a + (x.presentCount ?? 0), 0);
  const possible = att.reduce((a, x) => a + (x.presentCount ?? 0) + (x.absentCount ?? 0), 0);
  kv([
    ['Total registered participants', registered], ['Sessions with attendance recorded', `${att.length} of ${conductedSessions.length}`],
    ['Overall attendance', possible ? `${Math.round((present / possible) * 1000) / 10}% (${present} of ${possible} participant-days)` : null],
    ['Average daily attendance', att.length ? Math.round((present / att.length) * 10) / 10 : null],
  ]);
  h2('Daily attendance');
  table([{ label: 'Day', w: 0.6, align: 'center' }, { label: 'Date', w: 1.3 }, { label: 'Registered', w: 1, align: 'right' }, { label: 'Present', w: 1, align: 'right' }, { label: 'Absent', w: 1, align: 'right' }, { label: 'Attendance %', w: 1.1, align: 'right' }, { label: 'Recorded as', w: 1.4 }],
    att.map((x) => { const t = (x.presentCount ?? 0) + (x.absentCount ?? 0); return [x.dayNumber, fmtDate(x.sessionDate), x.registeredCount, x.presentCount, x.absentCount, t ? `${Math.round(((x.presentCount ?? 0) / t) * 1000) / 10}%` : '', x.attendanceMode === 'PARTICIPANT' ? 'Participant-wise' : 'Summary counts']; }));
  const partWise = c.participants.length && att.some((x) => x.attendanceMode === 'PARTICIPANT');
  if (partWise) {
    h2('Participant-wise attendance');
    if (showParticipants) {
      const pwSessions = att.filter((x) => x.attendanceMode === 'PARTICIPANT');
      table([{ label: 'Reg. no.', w: 0.9 }, { label: 'Participant', w: 2.2 }, { label: 'Institution', w: 2 }, { label: 'Present', w: 0.8, align: 'right' }, { label: 'Absent / leave', w: 1, align: 'right' }, { label: 'Attendance %', w: 1, align: 'right' }],
        c.participants.map((p) => {
          const recs = pwSessions.flatMap((x) => x.attendance.filter((a) => a.participantId === p.id));
          const pr = recs.filter((a) => a.status === 'PRESENT').length;
          return [p.registrationNo, `${p.name}${p.isActive ? '' : ' (withdrawn)'}`, p.institution, pr, recs.length - pr, recs.length ? `${Math.round((pr / recs.length) * 1000) / 10}%` : '—'];
        }));
    } else para(null, null, 'Participant-wise records are restricted to the course team and authorised officers.');
  }
  h2('Attendance sheet references');
  const sheets = conductedSessions.flatMap((x) => x.files.filter((f) => f.category === 'ATTENDANCE_SHEET').map((f) => [x.dayNumber, fmtDate(x.sessionDate), f.originalName, fmtDate(f.createdAt), f.uploadedBy.name]));
  table([{ label: 'Day', w: 0.6, align: 'center' }, { label: 'Session date', w: 1.2 }, { label: 'File', w: 3 }, { label: 'Uploaded', w: 1.2 }, { label: 'By', w: 1.5 }], sheets, 'No attendance sheets were uploaded.');

  // ── Section 6 ──
  h1('6. Outcomes and Achievements');
  const cp = c.completion;
  para('Skills developed', cp?.skillsDeveloped);
  para('Projects completed', cp?.projectsCompleted);
  para('Learning outcomes', cp?.learningOutcomes);
  para('Achievements and notable activities', cp?.achievements);
  para('Challenges encountered', cp?.challenges);
  para('Recommendations for future training', cp?.recommendations);
  h2('Outcomes recorded in daily reports');
  table([{ label: 'Day', w: 0.6, align: 'center' }, { label: 'Topic', w: 2 }, { label: 'Learning outcomes and achievements', w: 4 }], conductedSessions.filter((x) => x.achievements).map((x) => [x.dayNumber, x.topic, x.achievements]), 'No outcomes were recorded in the daily reports.');

  // ── Section 7 ──
  h1('7. Course Completion and Approvals');
  kv([
    ['Scheduled sessions', sessions.length], ['Sessions conducted', progress.conducted], ['Daily reports verified', progress.verified], ['Sessions missed', progress.missed], ['Sessions cancelled', progress.cancelled],
    ['Make-up sessions', sessions.filter((x) => x.isMakeup).length], ['Completion', `${progress.completionPercent}% of the schedule verified or formally resolved`], ['Completion report submitted', fmtDateTime(cp?.submittedAt, s.timezone) || null],
  ]);
  h2('Pending or formally resolved items');
  const resolvedItems = sessions.filter((x) => ['MISSED', 'CANCELLED'].includes(x.status) || x.status !== 'VERIFIED');
  table([{ label: 'Day', w: 0.6, align: 'center' }, { label: 'Date', w: 1.2 }, { label: 'Status', w: 1.2 }, { label: 'Reason / note', w: 4 }],
    resolvedItems.map((x) => [x.dayNumber, fmtDate(x.sessionDate), humanize(x.status), x.resolutionReason ?? (x.status === 'VERIFIED' ? '' : 'Report not yet verified')]), 'None — every scheduled session was conducted and its report verified.');
  h2("Coordinator's final remarks");
  para(null, cp?.coordinatorRemarks);
  h2('Reviewer comments and final approval');
  const hist = cp?.workflow?.history ?? [];
  table([{ label: 'Date & time', w: 1.4 }, { label: 'Stage', w: 1.5 }, { label: 'Decision', w: 1.1 }, { label: 'Name and role', w: 2 }, { label: 'Comments', w: 3 }],
    hist.filter((h) => !['ASSIGNED', 'PENDING_ASSIGNMENT'].includes(h.action)).map((h) => [fmtDateTime(h.createdAt, s.timezone), h.levelName ?? '', humanize(h.action), `${h.actorName}${h.actorDesignation ? `, ${h.actorDesignation}` : ''}`, h.remarks ?? '']),
    'The completion report has not been reviewed yet.');
  const fin = hist.filter((h) => h.action === 'FINAL_APPROVED').at(-1);
  kv([['Final approval', fin ? `${fin.actorName}${fin.actorDesignation ? `, ${fin.actorDesignation}` : ''} — ${fin.levelName}` : 'Not yet approved'], ['Approved on', fin ? fmtDateTime(fin.createdAt, s.timezone) : null]]);
  h2('Proposal approval');
  table([{ label: 'Date & time', w: 1.4 }, { label: 'Stage', w: 1.6 }, { label: 'Decision', w: 1.1 }, { label: 'Name and role', w: 2.2 }, { label: 'Comments', w: 2.6 }],
    (c.activity.workflow?.history ?? []).filter((h) => ['APPROVED', 'FINAL_APPROVED', 'RETURNED', 'RESUBMITTED', 'SUBMITTED'].includes(h.action)).map((h) => [fmtDateTime(h.createdAt, s.timezone), h.levelName ?? '', humanize(h.action), `${h.actorName}${h.actorDesignation ? `, ${h.actorDesignation}` : ''}`, h.remarks ?? '']));

  // ── Section 8 ──
  h1('8. Annexures');
  const docRow = (f: { originalName: string; category: string; createdAt: Date; uploadedBy: { name: string } }, where: string) => [where, SESSION_DOC_CATEGORIES[f.category] ?? humanize(f.category), f.originalName, fmtDate(f.createdAt), f.uploadedBy.name];
  const cols = [{ label: 'Source', w: 1.2 }, { label: 'Type', w: 1.6 }, { label: 'File', w: 3 }, { label: 'Uploaded', w: 1.1 }, { label: 'By', w: 1.4 }];
  h2('A. Supporting documents');
  table(cols, [...c.files.filter((f) => f.kind === 'DOCUMENT' && f.category === 'SUPPORTING').map((f) => docRow(f, 'Course')), ...sessions.flatMap((x) => x.files.filter((f) => f.category === 'SUPPORTING').map((f) => docRow(f, `Day ${x.dayNumber}`)))], 'None.');
  h2('B. Attendance sheets');
  table(cols, sessions.flatMap((x) => x.files.filter((f) => f.category === 'ATTENDANCE_SHEET').map((f) => docRow(f, `Day ${x.dayNumber}`))), 'None.');
  h2('C. Training materials');
  table(cols, sessions.flatMap((x) => x.files.filter((f) => f.category === 'MATERIAL').map((f) => docRow(f, `Day ${x.dayNumber}`))), 'None.');
  h2('D. Other approved evidence');
  table(cols, [...c.files.filter((f) => f.category === 'REVIEW_EVIDENCE').map((f) => docRow(f, 'Completion review')), ...sessions.flatMap((x) => x.files.filter((f) => f.category === 'REVIEW_EVIDENCE').map((f) => docRow(f, `Day ${x.dayNumber} review`)))], 'None.');
  h2('E. Additional photographs');
  const extra = [
    ...conductedSessions.flatMap((x) => x.files.filter((f) => f.kind === 'PHOTO' && f.category !== 'REVIEW_EVIDENCE' && !included.has(f.id)).map((f) => ({ file: f, caption: photoCaption(f, x) }))),
    ...c.files.filter((f) => f.kind === 'PHOTO' && f.category === 'ANNEX_PHOTO').map((f) => ({ file: f, caption: f.caption ?? f.originalName })),
  ];
  if (extra.length) {
    await gallery(extra.slice(0, 36), 3);
    if (extra.length > 36) para(null, `${extra.length - 36} further photograph(s) are held in the system and are not reproduced here.`);
  } else para(null, null, 'None.');

  // ── Table of contents ──
  pdf.switchToPage(tocPage);
  pdf.y = pdf.page.margins.top;
  pdf.fillColor(theme).font('Helvetica-Bold').fontSize(16).text('Contents', L, pdf.y);
  pdf.moveDown(0.8);
  const entries = toc.length > 60 ? toc.filter((t) => t.level === 0) : toc;
  for (const t of entries) {
    const y = pdf.y;
    const indent = t.level ? 18 : 0;
    pdf.fillColor(t.level ? '#374151' : '#111827').font(t.level ? 'Helvetica' : 'Helvetica-Bold').fontSize(t.level ? 9 : 10.5).text(t.title, L + indent, y, { width: W - 60 - indent, lineBreak: false, ellipsis: true });
    pdf.text(String(t.page + 1), L + W - 40, y, { width: 40, align: 'right' });
    pdf.y = y + (t.level ? 14 : 19);
  }

  // ── Header, footer and draft watermark on every page ──
  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    const mb = pdf.page.margins.bottom;
    const mt = pdf.page.margins.top;
    pdf.page.margins.bottom = 0;
    pdf.page.margins.top = 0;
    if (opts.draft) {
      pdf.save();
      pdf.rotate(-35, { origin: [pdf.page.width / 2, pdf.page.height / 2] });
      pdf.fillColor('#dc2626').opacity(0.08).font('Helvetica-Bold').fontSize(80).text('DRAFT', 0, pdf.page.height / 2 - 40, { width: pdf.page.width, align: 'center', lineBreak: false });
      pdf.restore();
      pdf.opacity(1);
    }
    if (i > 0) {
      pdf.font('Helvetica').fontSize(7.5).fillColor('#6b7280');
      pdf.text(s.orgName, L, 30, { width: W / 2, lineBreak: false });
      pdf.text(`${c.courseNo} — ${safe(c.title)}`, L + W / 2, 30, { width: W / 2, align: 'right', lineBreak: false, ellipsis: true });
      pdf.moveTo(L, 44).lineTo(L + W, 44).lineWidth(0.5).strokeColor(theme).stroke();
    }
    const fy = pdf.page.height - mb + 18;
    pdf.moveTo(L, fy - 6).lineTo(L + W, fy - 6).lineWidth(0.4).strokeColor('#d1d5db').stroke();
    pdf.font('Helvetica').fontSize(7.5).fillColor('#6b7280');
    pdf.text(`${opts.version ? `Report version ${opts.version}` : 'DRAFT preview — not an approved report'} · Generated ${fmtDateTime(generatedAt, s.timezone)}`, L, fy, { width: W * 0.7, lineBreak: false });
    pdf.text(`Page ${i + 1} of ${range.count}`, L + W * 0.7, fy, { width: W * 0.3, align: 'right', lineBreak: false });
    pdf.page.margins.bottom = mb;
    pdf.page.margins.top = mt;
  }
  pdf.end();
  return done;
}

// ───────────── Excel workbook ─────────────

export async function courseWorkbook(courseIds: string[]): Promise<ReportDoc> {
  const s = await getSettings();
  const courses = await Promise.all(courseIds.map(loadCourse));
  const progress = await Promise.all(courseIds.map(courseProgress));
  const rows = <T,>(f: (c: Loaded, i: number) => T[]) => courses.flatMap(f);
  return {
    title: 'Course Execution Workbook',
    filename: courses.length === 1 ? `${courses[0].courseNo}-workbook` : `courses-${new Date().toISOString().slice(0, 10)}`,
    sections: [
      {
        type: 'table', title: 'Course Summary',
        columns: [
          { key: 'courseNo', label: 'Course ID', width: 1.3 }, { key: 'title', label: 'Course Title', width: 2.5 }, { key: 'proposal', label: 'Proposal Ref', width: 1.3 }, { key: 'district', label: 'District / HQ' },
          { key: 'venue', label: 'Venue', width: 1.8 }, { key: 'category', label: 'Category' }, { key: 'start', label: 'Start Date', format: 'date' }, { key: 'end', label: 'End Date', format: 'date' },
          { key: 'days', label: 'Training Days', format: 'number' }, { key: 'sessions', label: 'Scheduled Sessions', format: 'number' }, { key: 'verified', label: 'Verified Reports', format: 'number' },
          { key: 'missed', label: 'Missed', format: 'number' }, { key: 'cancelled', label: 'Cancelled', format: 'number' }, { key: 'completion', label: 'Completion %', format: 'number' },
          { key: 'coordinator', label: 'Coordinator', width: 1.5 }, { key: 'trainers', label: 'Trainers', width: 2.5 }, { key: 'registered', label: 'Registered Participants', format: 'number' },
          { key: 'attendance', label: 'Attendance %', format: 'number' }, { key: 'status', label: 'Status' }, { key: 'completed', label: 'Completed On', format: 'datetime' },
        ],
        rows: courses.map((c, i) => ({
          courseNo: c.courseNo, title: c.title, proposal: c.activity.daamrId, district: c.district.name, venue: c.venue, category: humanize(c.category), start: c.startDate, end: c.endDate,
          days: c.durationDays, sessions: c.sessions.length, verified: progress[i].verified, missed: progress[i].missed, cancelled: progress[i].cancelled, completion: progress[i].completionPercent,
          coordinator: c.coordinator.name, trainers: c.trainers.filter((t) => t.isActive).map((t) => t.name).join(', '), registered: c.participants.filter((p) => p.isActive).length || c.registeredCount,
          attendance: progress[i].attendanceRate, status: humanize(c.status), completed: c.completedAt,
        })),
      },
      {
        type: 'table', title: 'Daily Schedule',
        columns: [
          { key: 'courseNo', label: 'Course ID', width: 1.3 }, { key: 'day', label: 'Day', format: 'number', width: 0.5 }, { key: 'date', label: 'Session Date', format: 'date' }, { key: 'original', label: 'Original Date', format: 'date' },
          { key: 'start', label: 'Start Time', width: 0.7 }, { key: 'end', label: 'End Time', width: 0.7 }, { key: 'venue', label: 'Venue', width: 1.8 }, { key: 'status', label: 'Session Status' },
          { key: 'makeup', label: 'Make-up', width: 0.7 }, { key: 'reason', label: 'Change / Resolution Reason', width: 3 },
        ],
        rows: rows((c) => c.sessions.map((x) => ({
          courseNo: c.courseNo, day: x.dayNumber, date: x.sessionDate, original: x.originalDate, start: x.startTime ?? '', end: x.endTime ?? '', venue: x.venue, status: humanize(x.status), makeup: x.isMakeup ? 'Yes' : '',
          reason: [x.resolutionReason, ...x.changes.map((ch) => `${humanize(ch.changeType)}: ${ch.reason}`)].filter(Boolean).join(' | '),
        }))),
      },
      {
        type: 'table', title: 'Daily Session Reports',
        columns: [
          { key: 'courseNo', label: 'Course ID', width: 1.3 }, { key: 'day', label: 'Day', format: 'number', width: 0.5 }, { key: 'date', label: 'Session Date', format: 'date' }, { key: 'trainers', label: 'Trainer(s)', width: 2 },
          { key: 'topic', label: 'Topic', width: 2 }, { key: 'objectives', label: 'Learning Objectives', width: 2.5 }, { key: 'covered', label: 'Topics Covered', width: 3 }, { key: 'activities', label: 'Practical Activities', width: 2.5 },
          { key: 'tools', label: 'Tools / Equipment', width: 2 }, { key: 'outcomes', label: 'Learning Outcomes', width: 2.5 }, { key: 'challenges', label: 'Challenges', width: 2 }, { key: 'next', label: 'Next Session Plan', width: 2 },
          { key: 'present', label: 'Present', format: 'number' }, { key: 'absent', label: 'Absent', format: 'number' }, { key: 'status', label: 'Report Status' }, { key: 'submitted', label: 'Submitted On', format: 'datetime' },
          { key: 'verified', label: 'Verified On', format: 'datetime' }, { key: 'verifiedBy', label: 'Verified By', width: 1.3 },
        ],
        rows: rows((c) => c.sessions.map((x) => {
          const fin = x.workflow?.history.filter((h) => h.action === 'FINAL_APPROVED').at(-1);
          return {
            courseNo: c.courseNo, day: x.dayNumber, date: x.sessionDate, trainers: x.trainers.map((t) => t.name).join(', '), topic: x.topic ?? '', objectives: x.learningObjectives ?? '', covered: x.topicsCovered ?? '',
            activities: x.activities ?? '', tools: x.tools ?? '', outcomes: x.achievements ?? '', challenges: x.challenges ?? '', next: x.nextPlan ?? '', present: x.presentCount, absent: x.absentCount,
            status: humanize(x.status), submitted: x.submittedAt, verified: x.verifiedAt, verifiedBy: fin?.actorName ?? '',
          };
        })),
      },
      {
        type: 'table', title: 'Trainer Details',
        columns: [
          { key: 'courseNo', label: 'Course ID', width: 1.3 }, { key: 'name', label: 'Trainer', width: 1.8 }, { key: 'designation', label: 'Designation', width: 1.8 }, { key: 'expertise', label: 'Expertise', width: 2.5 },
          { key: 'type', label: 'Type' }, { key: 'sessions', label: 'Sessions Delivered', format: 'number' }, { key: 'days', label: 'Days', width: 1.5 },
        ],
        rows: rows((c) => {
          const named = new Map<string, { name: string; designation: string | null; expertise: string | null; type: string; days: number[] }>();
          for (const t of c.trainers) named.set(t.id, { name: t.name, designation: t.designation, expertise: t.expertise, type: t.isGuest ? 'Guest' : 'Approved', days: [] });
          for (const x of c.sessions) for (const st of x.trainers) {
            const k = st.trainerId ?? `guest:${st.name}`;
            if (!named.has(k)) named.set(k, { name: st.name, designation: st.designation, expertise: null, type: 'Guest (recorded on the day)', days: [] });
            if (!['MISSED', 'CANCELLED'].includes(x.status)) named.get(k)!.days.push(x.dayNumber);
          }
          return [...named.values()].map((t) => ({ courseNo: c.courseNo, ...t, sessions: t.days.length, days: t.days.join(', ') }));
        }),
      },
      {
        type: 'table', title: 'Attendance Summary',
        columns: [
          { key: 'courseNo', label: 'Course ID', width: 1.3 }, { key: 'day', label: 'Day', format: 'number', width: 0.5 }, { key: 'date', label: 'Session Date', format: 'date' }, { key: 'registered', label: 'Registered', format: 'number' },
          { key: 'present', label: 'Present', format: 'number' }, { key: 'absent', label: 'Absent / Leave', format: 'number' }, { key: 'pct', label: 'Attendance %', format: 'number' }, { key: 'mode', label: 'Recorded As' }, { key: 'remarks', label: 'Remarks', width: 2.5 },
        ],
        rows: rows((c) => c.sessions.filter((x) => x.presentCount != null).map((x) => {
          const t = (x.presentCount ?? 0) + (x.absentCount ?? 0);
          return { courseNo: c.courseNo, day: x.dayNumber, date: x.sessionDate, registered: x.registeredCount, present: x.presentCount, absent: x.absentCount, pct: t ? Math.round(((x.presentCount ?? 0) / t) * 1000) / 10 : null, mode: x.attendanceMode === 'PARTICIPANT' ? 'Participant-wise' : 'Summary counts', remarks: x.attendanceRemarks ?? '' };
        })),
      },
      {
        type: 'table', title: 'Review and Approval History',
        columns: [
          { key: 'courseNo', label: 'Course ID', width: 1.3 }, { key: 'item', label: 'Item', width: 1.6 }, { key: 'cycle', label: 'Cycle', format: 'number', width: 0.5 }, { key: 'level', label: 'Review Level', width: 1.5 },
          { key: 'action', label: 'Decision / Event', width: 1.2 }, { key: 'by', label: 'Reviewer', width: 1.5 }, { key: 'role', label: 'Designation', width: 1.5 }, { key: 'at', label: 'Date & Time', format: 'datetime' },
          { key: 'remarks', label: 'Remarks', width: 3 }, { key: 'evidence', label: 'Evidence', width: 1.6 },
        ],
        rows: rows((c) => [
          ...c.sessions.flatMap((x) => (x.workflow?.history ?? []).map((h) => ({ item: `Day ${x.dayNumber} daily report`, h }))),
          ...(c.completion?.workflow?.history ?? []).map((h) => ({ item: 'Course completion report', h })),
        ].map(({ item, h }) => ({
          courseNo: c.courseNo, item, cycle: h.cycle, level: h.levelName ?? '', action: humanize(h.action), by: `${h.actorName}${h.targetUserName ? ` -> ${h.targetUserName}` : ''}`, role: h.actorDesignation ?? '',
          at: h.createdAt, remarks: h.remarks ?? '', evidence: ((h.data as any)?.evidence ?? []).map((e: any) => e.name).join(', '),
        }))),
      },
      {
        type: 'table', title: 'Supporting Documents Register',
        columns: [
          { key: 'courseNo', label: 'Course ID', width: 1.3 }, { key: 'source', label: 'Course / Day', width: 1 }, { key: 'category', label: 'Category', width: 1.8 }, { key: 'name', label: 'File Name', width: 2.5 },
          { key: 'type', label: 'Type', width: 0.8 }, { key: 'size', label: 'Size (KB)', format: 'number' }, { key: 'by', label: 'Uploaded By', width: 1.4 }, { key: 'at', label: 'Uploaded On', format: 'datetime' },
          { key: 'caption', label: 'Caption / Description', width: 2.5 }, { key: 'report', label: 'In Final Report', width: 0.9 },
        ],
        rows: rows((c) => [
          ...c.files.map((f) => ({ f, source: 'Course' })),
          ...c.sessions.flatMap((x) => x.files.map((f) => ({ f, source: `Day ${x.dayNumber}` }))),
        ].map(({ f, source }) => ({
          courseNo: c.courseNo, source, category: SESSION_PHOTO_CATEGORIES[f.category] ?? SESSION_DOC_CATEGORIES[f.category] ?? humanize(f.category), name: f.originalName, type: f.kind === 'PHOTO' ? 'Photo' : 'Document',
          size: Math.round(f.size / 1024), by: f.uploadedBy.name, at: f.createdAt, caption: [f.caption, f.description].filter(Boolean).join(' — '), report: f.featured ? 'Selected' : '',
        }))),
      },
    ],
  };
  void s;
}
