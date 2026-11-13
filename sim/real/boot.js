/**
 * Loaded by src/main.js (dev server only) when the page URL carries ?sim.
 *
 *   ?sim&runner=http://localhost:5191&w=3   worker page: pull jobs from the runner, post results
 *   ?sim&job={"level":5,"partySeed":1,...}  one job; the result is left on window.__simResult
 */
import { runJob } from './run.js';

const params = new URLSearchParams(location.search);
const runner = params.get('runner');
const worker = params.get('w') || '0';

async function post(path, body) {
  try { await fetch(runner + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) }); } catch (e) { /* runner gone */ }
}

async function main() {
  if (!runner) {
    const raw = params.get('job');
    if (!raw) return;
    window.__simResult = null;
    try { window.__simResult = await runJob(JSON.parse(raw)); }
    catch (e) { window.__simResult = { outcome: 'error', errors: [String(e && e.stack || e)] }; }
    return;
  }
  let job;
  try { job = await (await fetch(`${runner}/job?w=${worker}`)).json(); }
  catch (e) { return; }
  if (!job || job.done) { await post('/bye?w=' + worker, {}); return; }
  let result;
  try { result = await runJob(job); }
  catch (e) { result = { id: job.id, job, outcome: 'error', errors: [String(e && e.stack || e).slice(0, 800)] }; }
  result.worker = worker;
  await post('/result', result);
  /* A fresh page per job: no state, timers or leaked scene objects carry over. */
  location.reload();
}
main();
