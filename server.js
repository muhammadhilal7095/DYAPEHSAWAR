// Entry file for hosts that run `node server.js` from the project root (e.g. Hostinger Node.js apps).
// Applies database migrations, seeds a brand-new database, then starts the API + built web app.
const path = require('node:path');
const { execSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

process.chdir(path.join(__dirname, 'server'));
execSync('npx prisma migrate deploy && npx tsx prisma/seed.ts --if-empty', { stdio: 'inherit' });
import(pathToFileURL(path.join(process.cwd(), 'dist/index.js')).href);
