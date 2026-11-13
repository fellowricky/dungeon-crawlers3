/**
 * Batch runner for real-game balance runs.
 *
 * Starts several hidden browser copies of the game (dev server must be up on
 * :5173), hands each a queue of jobs, and collects one JSON record per job.
 *
 *   node sim/real/runner.mjs --level 5 --runs 24 --workers 8
 *
 *   --level N         party and quest level (default 1)
 *   --runs N          number of jobs (default 8)
 *   --workers N       browser copies running at once (default 4)
 *   --floor X         road | dungeon | boss | <number>   (default dungeon)
 *   --floors N        floors to play per job (default 1)
 *   --seed N          batch seed: same seed, same parties and quests (default 1)
 *   --classes a,b,c,d fix the party's classes (default: 4 different random ones)
 *   --maxGameMin N    give up on a floor after this much game time (default 60)
 *   --browser X       chrome | edge | <path to exe>  (default chrome)
 *   --show            visible windows instead of headless
 *   --url URL         game URL (default http://localhost:5173/)
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { summarize } from './report.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; };
const cfg = {
  level: +opt('level', 1), runs: +opt('runs', 8), workers: +opt('workers', 4),
  floor: opt('floor', 'dungeon'), floors: +opt('floors', 1), seed: +opt('seed', 1),
  classes: opt('classes', null), maxGameMin: +opt('maxGameMin', 60),
  browser: opt('browser', 'chrome'), show: !!opt('show', false), url: opt('url', 'http://localhost:5173/'),
  port: +opt('port', 5191), jobWallMin: +opt('jobWallMin', 25),
};
if (/^\d+$/.test(String(cfg.floor))) cfg.floor = +cfg.floor;
const BROWSERS = {
  chrome: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  edge: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
};
const exe = BROWSERS[cfg.browser] || cfg.browser;
if (!fs.existsSync(exe)) { console.error('Browser not found: ' + exe); process.exit(1); }

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'reports');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const base = `real_L${cfg.level}_${cfg.floor}_${stamp}`;
const jsonl = path.join(outDir, base + '.jsonl');

const jobs = [];
for (let i = 0; i < cfg.runs; i++) {
  jobs.push({
    id: i, level: cfg.level, floor: cfg.floor, floors: cfg.floors, maxGameMin: cfg.maxGameMin,
    maxWallMin: cfg.jobWallMin - 2,
    partySeed: cfg.seed * 100003 + i * 7 + 1, questSeed: cfg.seed * 7919 + i * 13 + 5,
    classes: cfg.classes ? String(cfg.classes).split(',') : undefined,
  });
}
const queue = jobs.slice();
const results = [];
const inFlight = new Map();     // worker id -> { job, since }
const procs = new Map();        // worker id -> child process
const tries = new Map();
let finished = false;
const t0 = Date.now();

function kill(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {});
  else child.kill('SIGKILL');
}
function launch(w) {
  const profile = path.join(os.tmpdir(), 'dc-sim-profiles', `${stamp}-w${w}-${Date.now() % 100000}`);
  fs.mkdirSync(profile, { recursive: true });
  const u = new URL(cfg.url);
  u.searchParams.set('sim', '1'); u.searchParams.set('runner', `http://localhost:${cfg.port}`); u.searchParams.set('w', String(w));
  const flags = [
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion,Translate', '--autoplay-policy=no-user-gesture-required',
    '--window-size=640,480', '--ignore-gpu-blocklist',
  ];
  if (!cfg.show) flags.push('--headless=new');
  const child = spawn(exe, [...flags, u.toString()], { stdio: 'ignore' });
  child._profile = profile;
  procs.set(w, child);
}
function done() {
  if (finished) return;
  finished = true;
  for (const c of procs.values()) kill(c);
  server.close();
  const wallMin = (Date.now() - t0) / 60000;
  const md = summarize(results, { ...cfg, wallMin });
  fs.writeFileSync(path.join(outDir, base + '.md'), md);
  console.log('\n' + md);
  console.log(`\nRecords: ${path.relative(process.cwd(), jsonl)}`);
  setTimeout(() => {
    for (const c of procs.values()) { try { fs.rmSync(c._profile, { recursive: true, force: true }); } catch (e) { /* still locked */ } }
    process.exit(0);
  }, 2500);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.end(); return; }
  const w = u.searchParams.get('w');
  if (u.pathname === '/job') {
    const job = queue.shift();
    if (job) inFlight.set(w, { job, since: Date.now() }); else inFlight.delete(w);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(job || { done: true }));
    return;
  }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    if (u.pathname === '/result') {
      let r = null;
      try { r = JSON.parse(body); } catch (e) { /* ignore */ }
      if (r) {
        results.push(r);
        fs.appendFileSync(jsonl, JSON.stringify(r) + '\n');
        inFlight.delete(String(r.worker));
        const f = r.fights || [];
        console.log(`[${results.length}/${jobs.length}] job ${r.id} w${r.worker}: ${r.outcome}  ${r.gameMin} game min in ${r.wallSec}s (x${r.speed})  fights ${f.length}  downs ${r.downs}  ${(r.party || []).map(h => h.cls).join('/')}${(r.errors || []).length ? '  ERR ' + r.errors[0].slice(0, 120) : ''}`);
      }
    }
    res.end('ok');
    if (results.length >= jobs.length) done();
  });
});

server.listen(cfg.port, async () => {
  try { const r = await fetch(cfg.url); if (!r.ok) throw new Error('HTTP ' + r.status); }
  catch (e) { console.error(`The game's dev server is not answering at ${cfg.url} (${e.message}). Start it with: npm run dev`); process.exit(1); }
  const n = Math.min(cfg.workers, jobs.length);
  console.log(`Real-game batch: ${jobs.length} runs, level ${cfg.level}, floor "${cfg.floor}", ${n} browsers (${cfg.show ? 'visible' : 'headless'} ${path.basename(exe)})`);
  for (let w = 0; w < n; w++) setTimeout(() => launch(w), w * 1500);   // stagger the asset loads
});

/* Watchdog: a job that never reports back gets one more try on a fresh browser. */
setInterval(() => {
  if (finished) return;
  for (const [w, f] of inFlight) {
    if (Date.now() - f.since < cfg.jobWallMin * 60000) continue;
    inFlight.delete(w);
    const n = (tries.get(f.job.id) || 0) + 1; tries.set(f.job.id, n);
    console.log(`job ${f.job.id} on w${w} went silent; ${n < 2 ? 'retrying' : 'giving up'}`);
    kill(procs.get(w));
    if (n < 2) queue.push(f.job);
    else { const r = { id: f.job.id, job: f.job, outcome: 'lost', fights: [], errors: ['no result'] }; results.push(r); fs.appendFileSync(jsonl, JSON.stringify(r) + '\n'); }
    if (results.length >= jobs.length) done(); else setTimeout(() => launch(w), 1000);
  }
}, 15000);
process.on('SIGINT', () => { console.log('\ninterrupted — writing what finished'); done(); });
