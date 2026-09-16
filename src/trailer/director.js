/**
 * TRAILER DIRECTOR — runs a shot definition.
 *
 * The loop is deliberately dull: gate, step, render, capture, advance. All the
 * interesting behaviour is that `await` on the gate costs the output nothing,
 * because `clock.t` is never derived from wall time.
 */
import { renderer, cam } from '../render/dungeon_scene.js';
import { Clock, nextTask } from './clock.js';
import { Party, DEFAULT_PARTY, clearParties } from './party.js';
import { Stage } from './stage.js';
import { Capture } from './capture.js';
import { gateReady } from './assets.js';
import { GEAR_TIERS, gearAt } from './gear.js';

/**
 * dungeon_scene.js installs gameplay pointer handlers on the canvas — drag to
 * pan, right-drag to orbit, wheel to zoom (clamped 0.36..7.8). On a filming rig
 * those are a hazard: one stray scroll over the viewport silently rewrites
 * cam.zoom mid-take and the shot is quietly wrong. The rig owns the camera
 * outright, so the canvas is made inert to pointer input.
 */
export function lockInput() {
  if (!renderer) return;
  renderer.domElement.style.pointerEvents = 'none';
}

/**
 * Size the render independently of the window, so output is deterministic.
 *
 * `ss` renders at a multiple of the delivery size and lets ffmpeg scale back
 * down. The camera motion is already numerically smooth — measured at 0%
 * deviation on the target and 0.56% on the camera, which is pure geometry — so
 * the shimmer that reads as "jitter" is texel crawl: nearest-filtered pixel art
 * rotating slowly under an orthographic camera makes sprite and tile pixels
 * wobble between screen positions. Supersampling averages that away; nothing
 * else does, short of not rotating.
 */
export function setRenderSize([w, h], ss = 1) {
  if (!renderer) return;
  renderer.setPixelRatio(1);
  renderer.setSize(Math.round(w * ss), Math.round(h * ss), false);
  const aspect = w / h;
  cam.left = -55 * aspect; cam.right = 55 * aspect;
  cam.top = 55; cam.bottom = -55;
  cam.updateProjectionMatrix();
  const c = renderer.domElement;
  c.style.width = '100%';
  c.style.height = '100%';
}

const paceTo = (t0, target) => new Promise(r => {
  const wait = t0 + target * 1000 - performance.now();
  wait > 1 ? setTimeout(r, wait) : r();
});

/**
 * `pace: true` makes preview playback track wall clock so a human can judge
 * timing. It only ever *delays* — clock.t stays authoritative, so a paced
 * preview and an unpaced render produce the identical sequence of frames.
 */
export async function runShot(shot, { backend = 'none', pace = false, onProgress = null } = {}) {
  const clock = new Clock(shot.fps);
  const capture = new Capture({ backend, shot: shot.name, fps: shot.fps,
                                crf: shot.crf, hw: shot.hw, out: shot.size });
  capture.stamp = !!shot.stamp;

  const ss = shot.supersample || 1;
  setRenderSize(shot.size, ss);
  lockInput();

  /* Sweep any party left standing by a previous run before adding another —
     `scene` outlives the run, so without this a second Preview shows two
     parties, the old one frozen where it stopped. */
  clearParties();
  const party = new Party(shot.party || DEFAULT_PARTY);
  const stage = new Stage({ party, orbit: { ...shot.orbit } });

  /* Start the encoder before anything expensive, so a missing ffmpeg fails
     immediately rather than after a minute of preflight. */
  await capture.begin();

  /* --- preflight: everything resident before frame 0 ------------------ */
  onProgress?.({ phase: 'preflight', detail: 'hero paperdolls' });
  await party.warm();

  /* Compose every rung of the gear ladder now, so a mid-shot change is a
     texture-cache hit. Walks the ladder backwards and finishes on rung 0, which
     is where the shot opens. */
  if (shot.beats.some(b => b.gear != null)) {
    onProgress?.({ phase: 'preflight', detail: 'gear ladder' });
    await party.warmLadder(GEAR_TIERS, gearAt);
  }

  onProgress?.({ phase: 'preflight', detail: 'props, textures, shaders' });
  await gateReady({ label: 'preflight' });

  /* Pre-warm every theme this shot visits: build it once, gate, throw it away.
     Guarantees the tile atlas, prop GLBs and shader programs for each beat are
     already resident, so the mid-shot gates are near-instant. */
  for (const beat of shot.beats) {
    onProgress?.({ phase: 'preflight', detail: `warming ${beat.themeKey}` });
    await stage.forge({ ...beat, animate: false, gate: true });
  }

  /* --- frame 0 ---------------------------------------------------------- */
  const beats = [...shot.beats].sort((a, b) => a.at - b.at);
  const schedule = beats.map(b => ({ ...b, frame: clock.frameAt(b.at) }));
  const total = Math.round(shot.duration * shot.fps);

  let next = 0;
  let currentGear = null;
  let t0 = performance.now();
  for (let f = 0; f < total; f++) {
    /* Beat boundary: rebuild, and stall the clock until it is safe to draw. */
    while (next < schedule.length && schedule[next].frame === f) {
      const beat = schedule[next++];
      onProgress?.({ phase: 'beat', detail: beat.themeKey, frame: f });
      if (beat.gear != null && beat.gear !== currentGear) {
        currentGear = beat.gear;
        await party.equip(gearAt(currentGear));
      }
      await stage.forge(beat);           /* gates internally */

      /* Buffer the changeover.
         Nothing here is recorded: the world finishes arriving, the assets are
         re-checked, and the shaders for whatever the new theme just introduced
         are compiled — all before the next captured frame. Because clock.t only
         advances when a frame is taken, this costs the output nothing however
         long it takes. */
      if (beat.settle !== false) {
        stage.settleNow();
        await gateReady({ label: `settle:${beat.themeKey}` });
        stage.settleNow();   /* again: the gate may have landed a late asset */
      }

      /* The gate consumed wall time the output never saw; re-base the pacer so
         preview resumes at speed instead of sprinting to catch up. */
      if (pace) t0 = performance.now() - clock.t * 1000;
    }

    const dt = clock.dt;
    stage.update(clock.t, dt);
    stage.render();
    /* Same task as render — required for readPixels to be valid. Awaited so
       the frame's blob is produced before the next frame overwrites the shared
       readback canvas; transmission still overlaps rendering. */
    await capture.frame();

    clock.advance();

    if (pace) await paceTo(t0, clock.t);

    /* Bound the queue so a long shot cannot exhaust memory. */
    if (capture.pending > 8) await capture.drained();
    if ((f & 3) === 0) {
      onProgress?.({ phase: 'render', frame: f, total });
      await nextTask();
    }
  }

  await capture.flush();
  onProgress?.({ phase: 'done', frame: total, total });

  return { clock, capture, stage, party, frames: total };
}
