import { createApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { flushEmails, smtpConfigured } from './lib/mailer.js';
import { maybeSendDailyJmReminders } from './routes/jm/monitoring.js';
import { sendAssignmentReminders } from './routes/daamr/assignments.js';
import { runCourseAutomation } from './routes/courses/common.js';
import { maybeDailyBackup } from './lib/backup.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`DYA portal API listening on http://localhost:${config.port}`);
  smtpConfigured().then((ok) => ok || console.warn('SMTP is not configured — set it in System Settings → Email (SMTP) or via SMTP_* variables; emails are logged as FAILED until then.'));
});

// Background sweep: deliver any PENDING emails (e.g. left over after a restart) and purge expired sessions.
const sweep = setInterval(async () => {
  try {
    await maybeSendDailyJmReminders();
    await sendAssignmentReminders();
    await runCourseAutomation();
    await flushEmails();
    await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch (e) {
    console.error('background sweep failed', e);
  }
}, 60_000);

// Daily database backup (checked hourly; failures are logged, never fatal)
const backups = setInterval(() => maybeDailyBackup().catch((e) => console.error('database backup failed:', e.message)), 3600_000);
setTimeout(() => maybeDailyBackup().catch((e) => console.error('database backup failed:', e.message)), 10_000);

function shutdown() {
  clearInterval(sweep);
  clearInterval(backups);
  server.close(() => prisma.$disconnect().finally(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
