# Jawan Markaz Asset Monitoring & Reporting System — Sections 8–16

The original development prompt stopped partway through section 8 ("Asset-wise inspection h…").
The sections below complete it. They follow the same structure and level of detail as the
DAAMR and Youth Hostel prompts, adapted to Jawan Markaz monitoring. Each section ends with a
note on where it is implemented in this portal.

---

## 8. Reports and Analytics

Create searchable, filterable reports for:

- District-wise project progress.
- Asset-wise inspection history.
- Planned versus actual progress for each asset.
- Delayed projects, with delay in days and the gap behind plan.
- Schedule performance (On Schedule / Slightly Delayed / Significantly Delayed).
- Quality of work assessments.
- Compliance assessments.
- Issues by severity, category and status.
- Risk register by level and status.
- Corrective actions by status, including overdue actions.
- Reports pending review, showing the current level, the assigned officer and how long the report has been waiting.
- Review turnaround time from submission to final verification.
- Reports returned for correction and rejected reports.
- Monthly reporting trends.
- Inspection types conducted.
- Inspection schedule, including overdue and upcoming follow-up inspections.
- Geo-tagged photograph register.

Allow filtering by date range, district/HQ, asset and review status, plus a free-text search
on report ID, asset name or code, and district.

Use consistent calculation rules and make the reporting period explicit. Status-based
figures must use each asset's latest verified report in the period, and figures that count
assets must count distinct assets.

Provide PDF, Excel and CSV export for each report, using the current filters.

> **Implemented:** Jawan Markaz → Reports & Analytics (`/jm/analytics`), the Registers page
> (issues, actions, risks, inspection schedule), and Site Photographs (`/jm/gallery`).
> API: `GET /api/jm/dashboard/analytics` and `/analytics/export?format=pdf|xlsx|csv`.

## 9. Notifications and Email Integration

Send in-app and email notifications for:

- Report submitted.
- Report assigned to a reviewer.
- Report forwarded to the next level.
- Report returned for correction.
- Report resubmitted.
- Report rejected.
- Report verified or approved.
- Report reassigned by an administrator.
- Corrective action deadlines passed.
- Follow-up inspections overdue.

Notifications must include the DAAMR ID, the asset, the district, the current status and any
relevant remarks.

Configure SMTP or an authorised email delivery service from the administration screen.
Track email delivery as Pending, Sent or Failed. Only mark an email as Sent once the mail
server has accepted the recipient. Allow authorised users to retry failed notifications.

> **Implemented:** workflow engine notifications, the daily overdue-inspection reminder, the
> email outbox, Administration → Email Logs (retry), and System Settings → Email (SMTP).

## 10. Security and Audit Trail

Implement:

- Secure login with account lockout after repeated failed attempts.
- Password reset that does not reveal whether an account exists.
- Role-based permissions enforced by the backend API, not only the interface.
- District/HQ scoping, so officers see only the assets and reports they are entitled to.
- Secure file storage, with file type checked by content rather than by extension.
- Input validation on every form and API endpoint.
- Protection against common web vulnerabilities (CSRF, XSS, injection, brute force).
- Session expiry after inactivity and after a maximum session length.

Record in the audit log:

- Asset creation and edits.
- Report creation, edits, submission and resubmission.
- Every review decision (approve, return, reject, verify), with remarks.
- Reassignments and workflow configuration changes.
- Status changes to issues, actions, risks and mitigations.
- Photograph and document uploads and removals.
- Exports.
- Email notification attempts.

Every entry must record the user, timestamp, action and the relevant before/after values. Audit
and approval history records must not be editable or deletable.

> **Implemented:** `server/src/lib/auth.ts`, `audit.ts`, `files.ts`, and append-only database
> triggers on AuditLog and ApprovalHistory (SQLite and PostgreSQL).

## 11. Database Structure

Use a relational database with tables for:

- Users, roles and permissions.
- Districts and headquarters.
- Jawan Markaz assets.
- Monitoring and progress reports.
- Completed activities and planned activities.
- Issues, actions, risks and mitigation measures.
- Geo-tagged photographs and supporting documents.
- Approval workflow definitions and levels.
- Workflow instances, officer assignments and approval history.
- Report versions (snapshots kept when a report is corrected).
- Lookup/configuration values (statuses, ratings, categories, scales).
- Notifications, email logs and audit logs.

Use the DAAMR ID as the main reference for each report, and the Asset ID for each asset. Link
photographs, issues, actions, risks and approvals to them. Store timestamps consistently and
display them in the configured local timezone. Use transactions when generating IDs and
recording decisions.

> **Implemented:** `server/prisma/schema.prisma` (Jm* models plus the shared workflow tables).

## 12. Interface and Design

Build a professional, government-style interface based on the supplied screenshot:

- Top bar and sidebar navigation grouped by module.
- A compact, spreadsheet-style monitoring dashboard with date and District/Asset filters.
- Summary cards and asset lists by status that link to filtered reports or asset details.
- Clear status badges for schedule, quality, compliance and review status.
- A multi-section report form with an option to save as draft.
- Photograph gallery with previews, a map for located photos, and clear labelling of the location source.
- Approval timeline on every report.
- Charts with an accessible table view.
- Responsive layouts for desktop, tablet and mobile.
- Print-friendly pages and PDF export controls.
- A configurable organisation name, logo and colour theme.

## 13. Required Pages

- Login and password reset.
- Monitoring Dashboard.
- Asset Register and Asset Details.
- New Monitoring Report (the form) and Edit Report.
- Monitoring Reports list and Report Details.
- My Submitted Reports and My Assigned Reviews.
- Issues, Actions and Risk Registers.
- Inspection Schedule.
- Site Photographs gallery.
- Reports & Analytics.
- User Management.
- District and HQ Management.
- Approval Workflow Settings.
- Dropdown/assessment options configuration.
- Notifications.
- Email Logs.
- Audit Logs.
- System Settings, including email setup.

## 14. Technical Implementation

If the project is being created from scratch, use a React frontend with a secure backend API and
a relational database (PostgreSQL in production). If an existing codebase is provided, inspect it
first and preserve its working functionality.

Implement for real, not as mock-ups:

- Database persistence and migrations.
- User authentication and role-based permissions.
- Asset registration.
- Report submission with automatic DAAMR ID generation.
- Automatic progress-change calculation, delay classification and risk scoring.
- Configurable sequential review workflow with automatic forwarding.
- Geo-tagged photograph uploads, with EXIF GPS extraction where available.
- Email notifications.
- Dynamic dashboards and analytics.
- PDF, Excel and CSV exports.

Do not use static sample figures in the production dashboard. Provide migrations, seed/test
records, configuration instructions and automated tests.

## 15. Acceptance Criteria

The system is complete only when:

- An administrator can register assets and every asset gets a unique Asset ID.
- A reporting officer can submit a report and receive a unique DAAMR ID.
- The reporting period, required fields and certification are validated.
- An officer cannot certify a report on behalf of another person.
- Progress change, delay classification and risk score are calculated automatically, using administrator-configured thresholds and scales.
- Geo-tagged photographs upload, display in the gallery and show on a map, with the location source labelled clearly.
- Reviewers can approve, return or reject reports, and approved reports move to the next configured officer automatically.
- Returned reports keep their previous version and history, and can be resubmitted.
- Final verification updates the asset's latest progress and last reporting date.
- The dashboard counts distinct assets using each asset's latest verified report, and shows reports still awaiting approval separately as provisional.
- Date and District/Asset filters change all relevant figures.
- PDF exports contain the currently filtered data, and Excel and CSV exports work.
- Corrective actions can be tracked through to verification.
- Overdue follow-up inspections are flagged, and reminders are sent.
- Email logs show the real delivery results.
- Unauthorised users cannot view other districts' reports, approve reports or change assets.
- Every important change appears in the audit log.
- The application works on desktop, tablet and mobile devices.

## 16. Final Instruction

Build this as a complete, production-ready Jawan Markaz Asset Monitoring and Reporting System.
Start with the asset register and database design, then implement the reporting form, the review
workflow, photographs, the dashboard, analytics and exports. Test the full report lifecycle, from
draft through submission, return, resubmission and final verification, before marking the project
complete.

> **Verified by:** `server/tests/jm.test.ts` (run with `npm test`).
