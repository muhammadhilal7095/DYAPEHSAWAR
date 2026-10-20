// One-off database backup: npm run db:backup  (see src/lib/backup.ts)
import { runBackup, backupDir } from '../src/lib/backup.js';
import { prisma } from '../src/db.js';

runBackup()
  .then((b) => console.log(`Backup written to ${backupDir}/${b.name} (${(b.size / 1024).toFixed(0)} KB)`))
  .catch((e) => {
    console.error('Backup failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
