/**
 * TRAILER HARNESS — entry point.
 *
 * A filming rig for the game's own renderer, sibling to dungeon_editor.js.
 * It never calls game.init(); it forges real dungeons, stands a real party in
 * them, and drives the visual half of the frame off a fixed-timestep clock.
 *
 * Two modes:
 *   Preview  — paced to wall clock so timing can be judged. No files.
 *   Render   — as fast as the machine allows, dumping numbered PNGs to
 *              trailer_out/<shot>/ via the vite dev middleware.
 *
 * Both produce the identical frame sequence, because wall clock never reaches
 * the simulation.
 */
import { SHOTS, DEFAULT_SHOT } from './trailer/shots.js';
import { runShot } from './trailer/director.js';

const el = id => document.getElementById(id);
let running = false;

function setStatus(msg, kind = '') {
  const s = el('status');
  s.textContent = msg;
  s.className = kind;
}

function progress({ phase, detail, frame, total }) {
  if (phase === 'preflight') setStatus(`Preflight — ${detail}…`, 'warn');
  else if (phase === 'beat')  setStatus(`Beat: ${detail} (frame ${frame})`, 'warn');
  else if (phase === 'render') {
    const pct = total ? ((frame / total) * 100).toFixed(0) : 0;
    setStatus(`Rendering ${frame}/${total} (${pct}%)`, '');
  } else if (phase === 'done') setStatus(`Done — ${frame} frames`, 'ok');
}

async function go(backend) {
  if (running) return;
  const shot = SHOTS[el('shot').value];
  if (!shot) return;

  running = true;
  el('preview').disabled = el('record').disabled = el('frames').disabled = true;
  const t0 = performance.now();

  try {
    const res = await runShot(shot, {
      backend,
      pace: backend === 'none',
      onProgress: progress
    });
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    if (backend === 'video') {
      const r = res.capture.result || {};
      const mb = r.bytes ? (r.bytes / 1048576).toFixed(1) : '?';
      setStatus(`${res.frames} frames in ${secs}s → ${r.out} (${mb} MB)`, 'ok');
      el('ffmpeg').textContent = r.out || '';
      el('ffmpeg').style.display = r.out ? 'block' : 'none';
    } else if (backend === 'server') {
      setStatus(`${res.frames} frames in ${secs}s → trailer_out/${shot.name}/`, 'ok');
      el('ffmpeg').textContent = res.capture.ffmpegHint();
      el('ffmpeg').style.display = 'block';
    } else {
      setStatus(`Preview finished — ${res.frames} frames in ${secs}s`, 'ok');
    }
    window.__trailer = res;
  } catch (e) {
    console.error(e);
    setStatus(`Failed: ${e.message}`, 'err');
  } finally {
    running = false;
    el('preview').disabled = el('record').disabled = el('frames').disabled = false;
  }
}

/* ---------------- boot ---------------- */
const sel = el('shot');
for (const key of Object.keys(SHOTS)) {
  const o = document.createElement('option');
  o.value = key;
  o.textContent = `${key} · ${SHOTS[key].duration}s @ ${SHOTS[key].fps}fps · ${SHOTS[key].size.join('x')}`;
  sel.appendChild(o);
}
sel.value = DEFAULT_SHOT;

el('preview').onclick = () => go('none');
el('record').onclick = () => go('video');
el('frames').onclick = () => go('server');
setStatus('Ready — pick a shot and hit Preview.');

/* Handle for scripted checks, mirroring window.__editor. */
window.__trailerHarness = { SHOTS, runShot };
