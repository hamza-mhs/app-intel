// `npm start` runs this supervisor. It starts the server as a child process and:
//  - copies all server output to the console AND to data/server.log (so crashes leave a record),
//  - restarts the server if it ever exits unexpectedly (backoff; gives up after 5 quick crashes),
//  - stops cleanly on Ctrl+C.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
fs.mkdirSync(dataDir, { recursive: true });
const logFile = path.join(dataDir, 'server.log');
try { if (fs.statSync(logFile).size > 5e6) fs.renameSync(logFile, path.join(dataDir, 'server.old.log')); } catch {}
const log = fs.createWriteStream(logFile, { flags: 'a' });
const stamp = () => new Date().toISOString();
const note = (msg) => { const line = `[${stamp()}] [supervisor] ${msg}\n`; process.stdout.write(line); log.write(line); };

let child = null;
let stopping = false;
let quickCrashes = 0;

function run() {
  const startedAt = Date.now();
  child = spawn(process.execPath, ['--no-warnings', '--max-old-space-size=4096', path.join(root, 'server.js')], {
    cwd: root,
    env: { ...process.env, APP_INTEL_MAIN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { process.stdout.write(d); log.write(d); });
  child.stderr.on('data', (d) => { process.stderr.write(d); log.write(d); });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return process.exit(0);
    note(`server stopped unexpectedly (exit code ${code}${signal ? `, signal ${signal}` : ''}). Details are in data/server.log.`);
    quickCrashes = Date.now() - startedAt < 120_000 ? quickCrashes + 1 : 1;
    if (quickCrashes > 5) {
      note('server crashed 5 times in a row within 2 minutes each; not restarting. Send data/server.log for diagnosis.');
      return process.exit(1);
    }
    const wait = 2000 * quickCrashes;
    note(`restarting in ${wait / 1000}s…`);
    setTimeout(run, wait);
  });
}

const stop = () => { stopping = true; if (child) child.kill(); else process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
note('starting App Intel');
run();
