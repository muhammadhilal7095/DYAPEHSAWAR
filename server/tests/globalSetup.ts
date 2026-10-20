import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Fresh database for every test run. SQLite by default (recreated automatically).
 * For PostgreSQL set TEST_DATABASE_URL to an EMPTY, disposable database — it is migrated and seeded, never reset.
 */
export default function setup() {
  const root = path.resolve(__dirname, '..');
  const url = process.env.TEST_DATABASE_URL ?? 'file:./test.db';
  const env = { ...process.env, DATABASE_URL: url };
  const run = (cmd: string) => execSync(cmd, { cwd: root, env, stdio: 'pipe' });
  fs.rmSync(path.join(root, 'storage/test-uploads'), { recursive: true, force: true });
  if (url.startsWith('file:')) {
    for (const f of ['prisma/test.db', 'prisma/test.db-journal']) fs.rmSync(path.join(root, f), { force: true });
    run('npx prisma migrate deploy');
  } else {
    run('npx prisma migrate deploy'); // bundled PostgreSQL migration includes the append-only triggers
  }
  run('npx tsx prisma/seed.ts');
}
