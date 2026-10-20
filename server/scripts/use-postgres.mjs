// Switches the project from SQLite to PostgreSQL using the bundled PostgreSQL migration.
//   1. set DATABASE_URL="postgresql://user:pass@host:5432/dya_portal?schema=public" in .env (an empty database)
//   2. npm run db:switch-postgres
//   3. npm run setup        (applies the migration, incl. append-only triggers, and seeds base data)
import fs from 'node:fs';
const schema = 'prisma/schema.prisma';
const s = fs.readFileSync(schema, 'utf8');
if (s.includes('provider = "postgresql"')) {
  console.log('Schema already targets PostgreSQL.');
  process.exit(0);
}
fs.writeFileSync(schema, s.replace('provider = "sqlite"', 'provider = "postgresql"'));
fs.renameSync('prisma/migrations', 'prisma/migrations-sqlite');
fs.cpSync('prisma/migrations-postgresql', 'prisma/migrations', { recursive: true });
console.log('Switched to PostgreSQL (SQLite migrations kept in prisma/migrations-sqlite).');
console.log('Next: npx prisma generate && npm run setup');
