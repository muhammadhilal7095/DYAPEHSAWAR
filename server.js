// Entry file for hosts that run `node server.js` from the project root (e.g. Hostinger Node.js apps).
// Builds the app if the host did not, applies database migrations, seeds a brand-new database,
// then starts the API + built web app. Until it is ready, the same HTTP server answers with a
// status page ("starting up", or the error if a step fails) so the host never shows a bare 503.
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const port = Number(process.env.PORT) || 4000;
let status = 'Starting up — please refresh in a minute.';
let log = '';

const esc = (s) => s.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
const page = () =>
  `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="15"><title>DYA Portal</title>` +
  `<body style="font-family:system-ui;max-width:900px;margin:40px auto;padding:0 16px"><h2>${esc(status)}</h2>` +
  `<pre style="white-space:pre-wrap;background:#f4f4f4;padding:12px;font-size:12px">${esc(log.slice(-8000))}</pre>`;
const statusPage = (_req, res) => res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' }).end(page());

// Some hosts (e.g. LiteSpeed's Node.js launcher) allow only one listening server, so the status
// server is kept and handed to the app: Express's app.listen() gets this server back.
const server = http.createServer(statusPage);
server.listen(port);
function handOverToApp() {
  const create = http.createServer;
  http.createServer = (handler) => {
    http.createServer = create;
    server.removeListener('request', statusPage);
    server.on('request', handler);
    server.listen = (...args) => {
      const cb = args.find((a) => typeof a === 'function');
      if (cb) setImmediate(cb);
      return server;
    };
    return server;
  };
}

// The host may start node without npm (or even node) on PATH: put node's own directory and
// npm/npx shims next to it on PATH so the build scripts work.
function toolPath() {
  const nodeDir = path.dirname(process.execPath);
  const find = (cli) =>
    [path.join(nodeDir, '../lib/node_modules/npm/bin', cli), path.join(nodeDir, 'node_modules/npm/bin', cli), path.join('/usr/lib/node_modules/npm/bin', cli), path.join('/usr/local/lib/node_modules/npm/bin', cli)].find((f) => fs.existsSync(f));
  const npmCli = find('npm-cli.js');
  if (!npmCli) throw new Error(`npm was not found next to node (${process.execPath}).`);
  const shims = fs.mkdtempSync(path.join(os.tmpdir(), 'dya-bin-'));
  for (const [name, cli] of [['npm', npmCli], ['npx', find('npx-cli.js')]]) {
    if (!cli) continue;
    fs.writeFileSync(path.join(shims, name), `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`, { mode: 0o755 });
  }
  return [shims, nodeDir, process.env.PATH].filter(Boolean).join(path.delimiter);
}

function run(cmd, cwd, env) {
  return new Promise((resolve, reject) => {
    log += `\n$ ${cmd}\n`;
    const p = spawn(cmd, { cwd, shell: true, env });
    const out = (d) => { process.stdout.write(d); log += d; try { fs.appendFileSync(progressFile, d); } catch {} };
    p.stdout.on('data', out);
    p.stderr.on('data', out);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`"${cmd}" exited with code ${code}`))));
  });
}

// The host may start several copies of this file at once (and stop any of them at any time);
// only the one holding the lock installs/builds/migrates, the others wait and show its progress.
// The holder refreshes the lock every 15 s; a lock whose holder is gone, or that has not been
// refreshed for 90 s, is taken over.
const lockDir = path.join(__dirname, '.startup-lock');
const progressFile = path.join(__dirname, '.startup.log');
let heartbeat;
function holderGone() {
  try {
    if (Date.now() - fs.statSync(lockDir).mtimeMs > 90_000) return true;
    const pid = Number(fs.readFileSync(path.join(lockDir, 'pid'), 'utf8'));
    if (pid) process.kill(pid, 0);
    return false;
  } catch (e) {
    return e.code === 'ESRCH';
  }
}
function tryLock() {
  try {
    fs.mkdirSync(lockDir);
  } catch {
    if (holderGone()) fs.rmSync(lockDir, { recursive: true, force: true });
    return false;
  }
  fs.writeFileSync(path.join(lockDir, 'pid'), String(process.pid));
  heartbeat = setInterval(() => { try { const t = new Date(); fs.utimesSync(lockDir, t, t); } catch {} }, 15_000);
  fs.writeFileSync(progressFile, '');
  return true;
}
function unlock() {
  clearInterval(heartbeat);
  fs.rmSync(lockDir, { recursive: true, force: true });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isBuilt = () => ['server/dist/index.js', 'client/dist/index.html'].every((f) => fs.existsSync(path.join(__dirname, f)));

(async () => {
  let locked = false;
  try {
    if (!process.env.DATA_ENCRYPTION_KEY && process.env.NODE_ENV === 'production') throw new Error('DATA_ENCRYPTION_KEY environment variable is not set.');
    // Shared hosting caps the number of threads per account; the native build tools (Tailwind's
    // Rust scanner, esbuild, libuv) otherwise start one per CPU core and crash with EAGAIN.
    const env = { ...process.env, PATH: toolPath(), RAYON_NUM_THREADS: '1', GOMAXPROCS: '1', UV_THREADPOOL_SIZE: '2' };
    const serverDir = path.join(__dirname, 'server');
    while (!(locked = tryLock())) {
      status = 'Another start-up is building the portal — this page refreshes itself.';
      try { log = fs.readFileSync(progressFile, 'utf8'); } catch {}
      await sleep(5000);
    }
    log = '';
    if (!isBuilt()) {
      status = 'Building the portal (first start, takes a few minutes) — this page refreshes itself.';
      // `npm ci` starts from a clean node_modules, so a half-finished earlier install cannot break it.
      // Retried: an install left running by a start-up the host stopped can still be finishing.
      const install = async (dir) => {
        for (let attempt = 1; ; attempt++) {
          try {
            return await run('npm ci --include=dev --no-audit --no-fund', dir, env);
          } catch (e) {
            if (attempt === 3) throw e;
            await sleep(60_000);
          }
        }
      };
      await install(serverDir);
      await install(path.join(__dirname, 'client'));
      await run('npm run build', serverDir, env);
      await run('npm run build', path.join(__dirname, 'client'), env);
    }
    status = 'Preparing the database…';
    await run('npx prisma migrate deploy && npx tsx prisma/seed.ts --if-empty', serverDir, env);
    unlock();
    locked = false;
    process.chdir(serverDir);
    handOverToApp();
    await import(pathToFileURL(path.join(serverDir, 'dist/index.js')).href);
  } catch (e) {
    if (locked) unlock();
    status = `Start-up failed: ${e.message}`;
    console.error(e);
  }
})();
