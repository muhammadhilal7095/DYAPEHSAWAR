// Entry file for hosts that run `node server.js` from the project root (e.g. Hostinger Node.js apps).
// Builds the app if the host did not, applies database migrations, seeds a brand-new database,
// then starts the API + built web app.
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const built = ['server/dist/index.js', 'client/dist/index.html'].every((f) => fs.existsSync(path.join(__dirname, f)));
if (!built) execSync('npm run build', { cwd: __dirname, stdio: 'inherit' });

process.chdir(path.join(__dirname, 'server'));
execSync('npx prisma migrate deploy && npx tsx prisma/seed.ts --if-empty', { stdio: 'inherit' });
import(pathToFileURL(path.join(process.cwd(), 'dist/index.js')).href);
