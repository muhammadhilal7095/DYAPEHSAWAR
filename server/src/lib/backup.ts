import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { prisma } from '../db.js';
import { getSettings } from './settings.js';

/**
 * Database backups.
 *  – SQLite: a consistent online copy made with `VACUUM INTO` (safe while the server is running).
 *  – PostgreSQL: `pg_dump --format=custom` (requires the PostgreSQL client tools on the server).
 * Backups are written to BACKUP_DIR (default ./storage/backups) and the newest `backupKeep` are retained.
 * Uploaded files live in UPLOAD_DIR and must be backed up separately (e.g. by the server's file backup).
 */
export const backupDir = path.resolve(process.env.BACKUP_DIR ?? './storage/backups');
const url = () => process.env.DATABASE_URL ?? '';
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

export function listBackups() {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((f) => /^db-\d{8}-\d{6}\.(sqlite|dump)$/.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(backupDir, f));
      return { name: f, size: st.size, createdAt: st.mtime };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function pgDump(target: string) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn('pg_dump', ['--format=custom', '--no-owner', `--file=${target}`, url()], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(new Error(`pg_dump is not available on this server (${e.message}).`)));
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump failed: ${err.trim().slice(0, 500)}`))));
  });
}

export async function runBackup() {
  fs.mkdirSync(backupDir, { recursive: true });
  const isPg = url().startsWith('postgres');
  const target = path.join(backupDir, `db-${stamp()}.${isPg ? 'dump' : 'sqlite'}`);
  if (isPg) await pgDump(target);
  else await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const { backupKeep } = await getSettings();
  for (const old of listBackups().slice(backupKeep)) fs.rmSync(path.join(backupDir, old.name), { force: true });
  const st = fs.statSync(target);
  return { name: path.basename(target), size: st.size, createdAt: st.mtime };
}

/** Called by the background sweep: one automatic backup per day when enabled. */
export async function maybeDailyBackup() {
  const s = await getSettings();
  if (!s.backupEnabled) return null;
  const last = listBackups()[0];
  if (last && Date.now() - last.createdAt.getTime() < 23.5 * 3600_000) return null;
  const b = await runBackup();
  console.log(`Database backup written: ${b.name}`);
  return b;
}
