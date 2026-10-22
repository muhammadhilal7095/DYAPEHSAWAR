// Entry file for hosts that run `node server.js` from the project root (e.g. Hostinger Node.js apps).
// Builds the app if the host did not, applies database migrations, seeds a brand-new database,
// then starts the API + built web app. While this runs, a temporary page answers on PORT
// ("starting up", or the error if a step fails) so the host never shows a bare 503.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const port = Number(process.env.PORT) || 4000;
let status = 'Starting up — please refresh in a minute.';
let log = '';

const page = () =>
  `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="15"><title>DYA Portal</title>` +
  `<body style="font-family:system-ui;max-width:900px;margin:40px auto;padding:0 16px"><h2>${status}</h2>` +
  `<pre style="white-space:pre-wrap;background:#f4f4f4;padding:12px;font-size:12px">${log.slice(-6000).replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</pre>`;
const holding = http.createServer((_req, res) => res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' }).end(page()));
holding.listen(port);

function run(cmd, cwd) {
  return new Promise((resolve, reject) => {
    log += `\n$ ${cmd}\n`;
    const p = spawn(cmd, { cwd, shell: true, env: process.env });
    const out = (d) => { process.stdout.write(d); log += d; };
    p.stdout.on('data', out);
    p.stderr.on('data', out);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`"${cmd}" exited with code ${code}`))));
  });
}

(async () => {
  try {
    if (!process.env.DATA_ENCRYPTION_KEY && process.env.NODE_ENV === 'production') throw new Error('DATA_ENCRYPTION_KEY environment variable is not set.');
    const built = ['server/dist/index.js', 'client/dist/index.html'].every((f) => fs.existsSync(path.join(__dirname, f)));
    if (!built) await run('npm run build', __dirname);
    const serverDir = path.join(__dirname, 'server');
    await run('npx prisma migrate deploy && npx tsx prisma/seed.ts --if-empty', serverDir);
    await new Promise((r) => { holding.close(r); holding.closeAllConnections(); });
    process.chdir(serverDir);
    await import(pathToFileURL(path.join(serverDir, 'dist/index.js')).href);
  } catch (e) {
    status = `Start-up failed: ${e.message}`;
    console.error(e);
    if (!holding.listening) http.createServer((_req, res) => res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' }).end(page())).listen(port);
  }
})();
