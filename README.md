# Directorate of Youth Affairs — Integrated Portal

One web application with three modules that share login, users, districts, an approval-workflow engine, file storage, email notifications and an audit trail:

| Module | What it covers |
|---|---|
| **Activity Management (DAAMR)** | Step-by-step activity creation (cover, venue gallery, documents) → staff assignment with deadlines → configurable multi-level review with evidence → execution report (outcomes, before/after and event photos, attendance sheet) → verification → **Completed** |
| **Course Management** | Approved course proposals become courses automatically → daily session schedule → day-by-day teaching reports (trainers, content, attendance, photos, materials) → daily review → completion report → final approval → versioned **Final Course Report** PDF and Excel workbook |
| **Youth Hostels** | Booking registration → multi-level approval (with amended dates) → room allocation without overbooking → check-in / check-out → utilization dashboard |
| **Jawan Markaz** | Asset register → monitoring & progress reports (sections A–O) → multi-level review → asset progress updated from verified reports → monitoring dashboard |

**Stack:** Node.js 20+ · Express 5 · TypeScript · Prisma ORM · SQLite (development) or PostgreSQL (production) · React 19 · Vite · Tailwind CSS · Recharts · Leaflet/OpenStreetMap · PDFKit · ExcelJS · Nodemailer.

---

## Quick start (development)

```bash
npm run install:all                 # installs server/ and client/ dependencies
cp server/.env.example server/.env  # then edit values (see Configuration)
npm run setup                       # create database + base configuration (roles, districts, workflows, hostels, assets, test users)
npm run demo                        # OPTIONAL: sample requests, bookings and reports, created through the real API
npm run dev:server                  # API on http://localhost:4000
npm run dev:client                  # web app on http://localhost:5173  (proxies /api to the server)
```

> npm 11 blocks package install scripts until approved. If `prisma` or `esbuild` fail to run, approve them with
> `npm install-scripts approve @prisma/client @prisma/engines prisma esbuild` (in `server/`) and `npm install-scripts approve esbuild` (in `client/`), then `npm rebuild`.

### Test accounts (password for all: `Password@123`)

| Email | Roles |
|---|---|
| admin@dya.gov.pk | Administrator (everything) |
| requester.mardan@dya.gov.pk | DAAMR requester, hostel requester, JM reporting officer (Mardan) |
| do.mardan@dya.gov.pk · head.mardan@dya.gov.pk | DAAMR district officer / district head, JM district reviewer (Mardan) |
| requester.swat@dya.gov.pk · do.swat@dya.gov.pk · head.swat@dya.gov.pk | Same chain for Swat |
| directorate@dya.gov.pk | Department-level reviewer and execution-report verifier |
| director@dya.gov.pk | Director / final approver |
| staff.mardan@dya.gov.pk · staff2.mardan@dya.gov.pk | Assigned officers / staff members (Mardan) |
| supervisor.mardan@dya.gov.pk | Activity supervisor (Mardan) |
| deptadmin@dya.gov.pk | Department administrator (all activities, staff assignment, audit log) |
| auditor@dya.gov.pk | Read-only auditor (views and exports everything, cannot act) |
| trainer.mardan@dya.gov.pk | Course trainer (writes daily session reports for courses they teach) |
| hq.officer@dya.gov.pk · hostel.approver@dya.gov.pk | Hostel HQ reviewer / final approver |
| manager.batakundi@ · manager.chapra@ · manager.khanaspur@dya.gov.pk | Hostel managers |
| monitoring@dya.gov.pk · supervisor@dya.gov.pk | JM monitoring officer / supervising authority |
| requester.bannu@ · reviewer.bannu@dya.gov.pk | Bannu reporting officer / reviewer |

Change or remove these accounts before going live (**Administration → Users & Roles**).

### Resetting the development database

```bash
cd server
npx prisma migrate reset --force   # drops and recreates dev.db, then runs the base seed (run it yourself; Prisma blocks this command for AI agents)
npm run db:seed:demo               # optional sample data
```
Uploaded files live in `server/storage/uploads/`; delete its contents manually if you want a completely clean slate.

---

## Configuration (`server/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `file:./dev.db` (SQLite) or a `postgresql://…` URL |
| `PORT` | API port (default 4000) |
| `APP_URL` | Public URL of the web app, used in email links |
| `DATA_ENCRYPTION_KEY` | Secret used to encrypt CNIC/passport numbers at rest (AES-256-GCM). **Required in production. Do not change it after data exists**, or stored numbers become unreadable. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional fallback for outgoing mail. The easier way is **System Settings → Email (SMTP)** (see below). If neither is set, emails are logged as **Failed – SMTP not configured** and can be retried later from **Email Logs**. |
| `UPLOAD_DIR` | Private storage for uploads (outside the web root) |
| `COOKIE_SECURE` | `true` when served over HTTPS |

Organisation name, logo, theme colour, timezone, session timeouts, upload limit, the participant counting rule, Jawan Markaz delay thresholds, risk bands, the certification statement and all dropdown values are managed in the app under **Administration → System Settings**.

### Setting up email (in the app)

Sign in as an administrator and open **Administration → System Settings → Email (SMTP)**:

1. Enter the SMTP server, port, encryption, username, password and sender ("From"). The quick-fill buttons set the usual values for Microsoft 365 / Outlook and Gmail; with multi-factor sign-in, use an app password.
2. Click **Save email settings**. The password is stored encrypted and is never shown again; leave the field blank later to keep it.
3. Use **Send a test email**. The page shows the mail server's actual answer: accepted (with message ID) or the error.
4. Open **Email Logs** and click **Retry all failed** to send any notifications that failed before email was set up.

Settings saved on this page take priority over the `SMTP_*` values in `.env`. **Remove saved settings** goes back to the `.env` values. Every change and test is recorded in the audit log.

### Using PostgreSQL

A PostgreSQL migration is bundled in `server/prisma/migrations-postgresql/`. It already includes the triggers that make the audit log and approval history append-only.

```bash
cd server
# 1. point DATABASE_URL in .env at an EMPTY PostgreSQL database, e.g.
#    DATABASE_URL="postgresql://dya:password@localhost:5432/dya_portal?schema=public"
npm run db:switch-postgres     # switches the Prisma provider; SQLite migrations are kept in prisma/migrations-sqlite
npx prisma generate
npm run setup                  # applies the migration and seeds base data
npm run db:seed:demo           # optional sample data
```

Verified on PostgreSQL 17: the switch, setup and demo data all completed, and all acceptance tests passed (39 at the time). To run the tests against PostgreSQL, point `TEST_DATABASE_URL` at a separate **empty** database:
```bash
TEST_DATABASE_URL="postgresql://dya:password@localhost:5432/dya_test?schema=public" npm test
```

---

## Production deployment

```bash
npm run build      # compiles server/dist and client/dist
npm start          # one Node process serves the API and the built web app on PORT
```
Run it behind HTTPS (e.g. nginx or IIS reverse proxy) with `COOKIE_SECURE=true` and `NODE_ENV=production`. Back up the database and `UPLOAD_DIR` together. A background job delivers any pending emails every minute and clears expired sessions.

---

## How it works

### Approval workflow engine (`server/src/workflow/engine.ts`)

All three modules use one sequential engine. Administrators configure it under **Administration → Approval Workflows**; nothing is hard-coded.

- **Workflow definitions** exist per module (DAAMR request, DAAMR report verification, hostel booking, JM report). A district-specific definition overrides the default.
- **Levels** are assigned either to a **specific officer** or to **a role**. With a role, the assignee can be anyone in that role or anyone in the same district as the submission. When several officers qualify, the least-loaded one is chosen. A submitter is never assigned their own item.
- Per-level switches: can return, can reject, officer may reassign, and (hostels) can approve different dates.
- On **approve**, the engine does the following in one serializable database transaction:
  1. Records the decision.
  2. Closes the officer's assignment.
  3. Assigns the next officer.
  4. Updates the record's status.
  5. Queues in-app notifications and emails to the next officer and the requester.
- **Return for revision** requires remarks. The requester edits and resubmits, and every submission is preserved as a version snapshot. Per workflow, resubmission either restarts at level 1 or resumes at the level that returned it.
- **Reject** requires remarks and stops the chain. Only users with the `workflow.reopen` permission can reopen.
- If no eligible officer exists, the item is marked **Pending Assignment** and administrators are notified so they can assign it manually.
- Every request detail page shows a timeline. For each stage it lists the officer, assigned and decided times, the decision and remarks. Future stages show only *Awaiting Previous Approval*.
- Activity workflows can also assign a level to **the activity's responsible (lead) staff member**, e.g. *Staff Review → Supervisor Review → District/Department Review → Director*. If no lead is assigned yet, the level waits as *Pending Assignment* and is filled automatically as soon as one is.
- Reviewers may attach **supporting evidence** to a decision. It is recorded with the decision and can no longer be withdrawn once the decision is saved.
- Users never decide on their own submissions unless their role has the `workflow.self_approve` permission, which no role has by default.

### Activity lifecycle

`Draft → Under Review → (Changes Requested ↺) → Approved → In Progress → Report Under Review → Completed`, with `Rejected` as a terminal state.

- Activities are created with a 5-step form: details, schedule and location, images and documents, budget and contact, then review and submit. Images are previewed before they are saved.
- Staff are assigned with responsibilities, a deadline, priority, instructions and review requirements, and one of them is marked as the responsible officer. Assigned staff are notified, see the activity under **My Assignments**, and can acknowledge, start and complete their task.
- Approved activities are executed by the assigned staff, who submit the **execution report**. The activity becomes **Completed** only after that report passes every verification level.
- Reminders are sent (in-app, plus email when configured) before task deadlines and when tasks become overdue. The lead time is configurable in Settings.
- Budgets and expense details are shown only to users with `daamr.expense.view`, and to the activity's creator and assigned staff.
- Exports:
  - **Detailed single-activity PDF:** you choose the sections and photos to include.
  - **Activities Summary PDF.**
  - **Excel workbook:** Activities Summary, Activity Details, Staff Assignments, Review History, Execution Reports, and Participants and Outcomes sheets.
  - **CSV.**

  All exports use the current filters and contain only records the user may see.

### Course execution and daily reports

When a proposal whose **Activity type** is *Course / training programme* receives final approval, the system creates the course automatically. Proposals carry the training days, delivery format, methodology and proposed trainers. The set-up runs exactly once per proposal, guaranteed by a unique database key. It assigns:
- A Course ID (`CRS-YYYY-NNNNN`).
- One session per training day. The configured non-training weekdays (default: Sunday) and holidays are skipped.
- The activity's responsible officer as course coordinator.
- The proposal's trainers as course trainers.

**Course status:** *Approved — Awaiting Start* → *In Progress* (set automatically on the start date) → *Awaiting Verification* (when the completion report is submitted) → *Completed* (final approval). Changes requested at the final review return the course to *In Progress*.

**Session status:** *Scheduled* → *In Progress* (draft) → *Submitted* → *Verified* or *Changes Requested* → *Submitted* again.
- A report needs the class marked as conducted, the topic and content, at least one trainer, attendance, and (configurable) a photograph.
- It can only be submitted on or after its session date.
- Administrators (`course.manage`) can record a session as **Missed**, **Cancelled** or **Rescheduled**, or add a make-up session, always with a reason. Schedule changes keep the original date and are logged in an append-only table.
- The coordinator can edit the whole schedule before the course starts.

**Attendance:** with registered participants, attendance is recorded per participant and the totals are calculated from those records, so the two can never disagree. Without registered participants, present plus absent must equal the registered count.

**Reviews:** daily reports go through the `COURSE_SESSION` workflow, and course completion through `COURSE_COMPLETION`. Both use the same configurable engine as the rest of the portal, with assignment, notifications, evidence, permanent history and version snapshots.

**Completion rules (checked on the server):**
1. Every session is verified, or formally resolved as missed or cancelled.
2. Attendance and photographic evidence exist for every verified day.
3. The coordinator has submitted the completion report.
4. The final reviewer has approved it. The approval is refused if any rule above has stopped being met.

**Final Course Report (PDF):**
- Generated from saved records only, once the course is completed. Every generation is stored as a numbered version, and regenerating requires a reason.
- Contents: cover page, table of contents, 8 sections (executive summary, course details, every daily report, photographs by day, attendance, outcomes, approvals, annexures), header and footer on every page, and page numbers.
- Photographs are resized proportionally to keep the file small. A photo is used if it is marked *In final report*; for a day with no selection, its first two photos are used.
- Missing information is printed as *Not reported.*
- Reviewers can preview a watermarked draft while the completion report is under review.

**Excel workbook:** 7 sheets — Course Summary, Daily Schedule, Daily Session Reports, Trainer Details, Attendance Summary, Review and Approval History, and Supporting Documents Register.

**Background jobs** (every minute, all safe to repeat):
- Start courses on their start date.
- Remind the coordinator and trainers on each session day.
- Flag missing daily reports after the configured number of days.

### Database backups

A consistent database copy is written once a day to `server/storage/backups` (SQLite uses `VACUUM INTO`; PostgreSQL uses `pg_dump`). The newest 14 copies are kept. You can also back up on demand:
- `npm run db:backup` (in `server/`)
- **Settings → Back up now**

Uploaded files in `storage/uploads` are not included and must be backed up with the server's file backups.

### Security

- Sessions use random tokens stored hashed, in httpOnly SameSite=Strict cookies. They expire after the configured idle timeout, with an absolute maximum lifetime.
- Accounts lock for 15 minutes after 5 failed sign-ins. Password resets use one-time, 60-minute tokens, and the reset form doesn't reveal whether an account exists.
- Permissions are checked **on the server** for every list, detail, file download, export and action. The interface only hides what the server would refuse anyway.
- State-changing requests must carry `X-Requested-With`, which blocks cross-site form posts (CSRF). Helmet security headers are applied and login is rate-limited.
- Uploads are identified by their content (magic bytes), not by extension. They are stored under random names outside the web root and served only after an access check.
- CNIC/passport numbers are encrypted at rest. They are masked unless the viewer has `hostel.view_identity` or is the requester, and each view by another officer is logged in the audit log.
- Audit log and approval history rows are append-only, enforced by database triggers.
- CSV exports neutralise spreadsheet formula injection.

### Email delivery

Notifications are queued as `PENDING` inside the same transaction as the action, then delivered. A row becomes `SENT` only when the SMTP server accepts the recipient (the server's message ID is stored). Otherwise it becomes `FAILED` with the server's error. Failed emails can be retried individually or all at once.

### Dashboard counting rules

- **Activity Management dashboard:**
  - Each activity counts once, by start date.
  - Drafts are counted only as *Draft*.
  - *Pending assignments* means no active staff assignment.
  - *Pending reviews* covers both activity review and execution-report verification.
  - *Overdue* means past the end date, or a task past its deadline.
- **DAAMR participation & budget summary:**
  - Requests are counted by submission date.
  - Participants and budgets are counted by activity date.
  - A request and its final report count as one activity.
  - **Total Participants** sums only the fields chosen in Settings. The default is Male + Female + Transgender, because Minority, Madaris, Disabled and Juvenile overlap with those.
- **Hostels** (full definitions are shown on the dashboard and in the PDF):
  - Total Requests: bookings submitted in the period.
  - Approved: final approval given in the period.
  - Pending: submitted in the period and still awaiting a decision.
  - Completed: stays checked out in the period.
  - Guests Facilitated: actual guests of stays checked in during the period.
  - Rooms Booked: rooms reserved for bookings approved in the period.
  - The utilization table counts completed stays only; approved reservations are not treated as completed.
- **Jawan Markaz:**
  - Total JMs Reports counts distinct submitted reports.
  - On Schedule, Slightly Delayed, Significantly Delayed and Satisfactory Quality count **distinct assets**, using each asset's latest **verified** report in the period.
  - Assets whose newest report is still under review appear separately as *provisional*.
  - Delay classification uses delay days when reported, otherwise the planned-versus-actual progress gap. Both thresholds are configurable.

---

## Project layout

```
server/
  prisma/schema.prisma        all tables (core, workflow, DAAMR, hostels, JM)
  prisma/migrations/          SQL migrations (+ immutability triggers)
  prisma/seed.ts / demo.ts    base configuration / optional sample data
  src/workflow/engine.ts      approval engine + timeline
  src/lib/                    auth, audit, crypto, files, mailer, notifications, exports (PDF/XLSX/CSV), settings
  src/routes/                 admin, auth, files, tasks, daamr/*, hostel/*, jm/*
  tests/                      acceptance tests (vitest + supertest + local SMTP server)
client/
  src/components/             UI kit, data table, workflow timeline & review panel, uploader/gallery, charts, map
  src/pages/                  auth, home/tasks/notifications, daamr/*, hostel/*, jm/*, admin/*
```

The spec asks for tables named Activity Pictures, Attachments, Supporting Documents and Officer Assignments. They are implemented as follows:

- **Pictures, attachments and supporting documents** all live in one `File` table, with a category (pre-activity, post-activity, before work, defect evidence, supporting document and so on) and a foreign key to the record that owns the file.
- **Officer assignments** are the `OfficerAssignment` table.
- **Approval workflow definitions** and **approval levels** are the `WorkflowDefinition` and `WorkflowLevel` tables.

Each module keeps its own identifiers:

| Record | Format |
|---|---|
| DAAMR request | `DAAMR-YYYY-NNNNN` (shared by the request and its final report) |
| Activity report | `ARPT-YYYY-NNNNN` |
| Hostel booking | `YHB-YYYY-NNNNN` |
| Jawan Markaz report | `DAAMR-JM-YYYY-NNNNN` |
| Jawan Markaz asset | `JMA-NNNN` |

---

## Tests

```bash
npm test
```
63 API acceptance tests cover the acceptance criteria of all three specifications, the activity-management specification and the course-execution module:

- Submission and unique IDs.
- Automatic assignment to the next officer.
- Blocking officers who are not assigned, and blocking self-approval.
- Return and resubmit with history preserved.
- Rejection and reopening.
- The final authority acting only after all earlier levels.
- File type checks and file access control.
- Hostel overbooking prevention, including atomic rollback.
- Check-in and check-out.
- Dashboard figures computed from saved records, including filters.
- PDF, Excel and CSV exports and their permissions.
- Real SMTP delivery and bounce handling.
- Audit entries, and the database refusing to modify audit or approval history.
- Account lockout and idle session expiry.
- District-specific workflow configuration.
- Overdue-inspection detection, reminder emails and the geo-tagged photo gallery.
- Email settings saved in the app: they override `.env`, the password is write-only and encrypted, and test emails report the real delivery result.
- Activity management (`tests/activity.test.ts`):
  - Validation of the new fields, then staff assignment and its permissions.
  - A *responsible officer* first review level, with evidence attached to the decision.
  - Changes requested, resubmission, and final approval.
  - Execution report by assigned staff, with completion only after verification.
  - Activity log, global search, dashboard cards and filters.
  - Detailed and summary PDFs, and the six-sheet Excel workbook.
  - The read-only auditor.
  - Deadline and overdue reminders.
- Course execution (`tests/course.test.ts`), a full 14-day course:
  - Approval creates exactly one course (repeated processing does not duplicate it) with the correct 14-day schedule, skipping Sundays.
  - Access control.
  - Exceptions resolved with reasons.
  - Missing-report flags.
  - Day 1 with trainers, guest trainers, participant-wise attendance (contradicting totals are rejected), photos, materials and an attendance sheet.
  - Submit, changes requested, correction and verification.
  - Completion blocked while reports are missing; days 2–13 verified.
  - Completion review and final approval.
  - Final PDF versions 1 and 2.
  - The seven-sheet workbook.
  - Schedule editing before the start, with the original date kept and the change log protected from edits.
  - The automatic start.

The web UI was also exercised in headless Chrome, both at 1400 px desktop width and 390 px phone width.

---

## Notes and assumptions

- **Jawan Markaz specification:** the source text was cut off at section 8 ("Reports and Analytics"). The missing sections 8–16 are written out in [docs/jawan-markaz-spec-completion.md](docs/jawan-markaz-spec-completion.md), following the pattern of the other two specifications. Highlights:
  - Reports and analytics: district-wise progress, planned vs actual progress, reports awaiting review (with days waiting), review turnaround, asset-wise inspection history, issue, risk, action, quality and compliance distributions, inspection types, overdue actions and the inspection schedule. Filters include date, district, asset, review status and free-text search.
  - **Inspection schedule:** each asset's next follow-up date comes from its latest verified report. Assets are flagged *Overdue* or *Due within 7 days* on the dashboard, in the registers and in analytics.
  - **Reminders:** a daily digest goes out after 08:00 (can be switched off in Settings, or sent on demand with "Send reminders now"). Reporting officers get their own overdue corrective actions and inspections; officers who can update registers get a summary.
  - **Site Photographs page:** a gallery of all Jawan Markaz photos with a map of the located ones.
  - Security, database, pages and acceptance tests.
  
  Review these parts against the full original document.
- **"Satisfactory Quality"** on the JM dashboard counts Excellent, Good and Satisfactory by default. Change this under Settings if it should mean exactly "Satisfactory".
- **Photo locations:** GPS coordinates embedded in a photo (EXIF) are read automatically and labelled as such. A device location can be captured at upload with the browser's permission, or coordinates can be entered manually; each photo records which source was used. The system **does not** independently verify where or when a photo was taken.
- **PDF fonts:** PDFs use built-in Latin fonts. Urdu or Pashto text in records will not render in PDF exports unless a suitable TTF font is added to `server/src/lib/export.ts`.
- **Maps:** map tiles are loaded from OpenStreetMap, which needs internet access. Without it the map area is blank and everything else still works.
- **Email in development:** with SMTP unconfigured, every notification shows as Failed. This is intentional; nothing is reported as sent unless the mail server accepted it.
