/**
 * Combat-start initiative reveal — the d20s everyone just rolled, shown.
 *
 * Initiative was previously invisible: the order was rolled in a single frame
 * and the first actor simply started moving, so the rail on the right appeared
 * fully populated with no explanation of where it came from. This plays the roll
 * out: every combatant's die scrambles above its head, locks to its real total,
 * and then the badges fly one by one — highest first — into the initiative rail,
 * each row landing as its badge arrives.
 *
 * WHY DOM AND NOT WORLD-SPACE
 * The badges have to end up *in* the `#initiative` rail, which is DOM. A 3D
 * sprite can't land in a DOM list, so instead the entity's world position is
 * projected through the camera to screen pixels and the badge is a positioned
 * DOM element from the start. That also means the flight is a plain CSS
 * transform transition rather than anything the render loop has to know about.
 *
 * TIMING
 * Phases are ABSOLUTE seconds (see the Timing block below), not fractions of a
 * total — they get tuned against each other by feel, and a fraction scheme means
 * every tweak silently moves its neighbours. Dice roll SIMULTANEOUSLY, so the
 * scramble does not lengthen with combatant count; only the flights stagger.
 * The sequence ends when the last die actually lands, capped by
 * REVEAL_MAX_SECONDS — which only binds in crowded fights, where the stagger is
 * compressed to fit rather than the whole thing being allowed to run long.
 *
 * ESCAPE HATCHES — this sits between the player and the fight, so it has three:
 *   • an Options toggle (`initiativeReveal`) turns it off entirely
 *   • a click anywhere finishes it immediately
 *   • it is driven by elapsed time with a hard cap, so it always completes
 *
 * HEADLESS
 * Reached only through `game_hooks.js`, which HeadlessGame stubs out, so the
 * balance sim rolls initiative and starts fighting in the same frame as before.
 */

/* ── Timing ───────────────────────────────────────────────────────────────
   Absolute seconds, not fractions of a total. These phases get tuned against
   each other by feel — "the roll is too long, the pause after it is too short"
   — and a fraction-of-total scheme means every such tweak silently moves the
   others. Each number below is exactly what it says.                        */

/** How long the numbers cycle before locking to the real roll. */
const SCRAMBLE_SECONDS = 0.7;
/** Beat after the dice settle, before any of them leave. Lets the numbers be
 *  read as numbers — this is the pause that makes the roll feel decided. */
const LOCK_HOLD_SECONDS = 1.0;
/** How long one badge spends in the air on its way to the rail. */
const FLIGHT_SECONDS = 0.45;
/** Longest gap between two badges leaving. Without a cap the stagger is a fly
    window divided by the count, which spaced a 2-creature fight's dice two
    seconds apart — inside budget, but it read as the animation stalling. */
const MAX_STAGGER = 0.35;
/** Held after the last die lands, before turn 1 begins. */
const SETTLE = 0.45;

/** Hard ceiling. Only binds in very large fights, where the stagger is
 *  compressed to fit rather than the sequence being allowed to run long. */
export const REVEAL_MAX_SECONDS = 6.0;

let state = null;

const isDom = () => typeof document !== 'undefined' && typeof window !== 'undefined';

/**
 * Project a world position to viewport pixels.
 *
 * Written out longhand rather than using THREE.Vector3.project so this module
 * needs no THREE import — which is what lets the maths be unit-tested against a
 * plain fake camera instead of a real WebGL context.
 */
export function projectVec(cam, canvas, x, y, z) {
  const m = cam.matrixWorldInverse, p = cam.projectionMatrix;
  if (!m || !p || !m.elements || !p.elements) return null;
  const e = m.elements;
  const vx = e[0] * x + e[4] * y + e[8] * z + e[12];
  const vy = e[1] * x + e[5] * y + e[9] * z + e[13];
  const vz = e[2] * x + e[6] * y + e[10] * z + e[14];
  const q = p.elements;
  const cx = q[0] * vx + q[4] * vy + q[8] * vz + q[12];
  const cy = q[1] * vx + q[5] * vy + q[9] * vz + q[13];
  const cw = q[3] * vx + q[7] * vy + q[11] * vz + q[15];
  if (!cw) return null;
  const ndcX = cx / cw, ndcY = cy / cw;
  const r = canvas.getBoundingClientRect();
  return {
    x: r.left + (ndcX * 0.5 + 0.5) * r.width,
    y: r.top + (-ndcY * 0.5 + 0.5) * r.height,
  };
}

/* How high above the creature's feet the die floats, in world units. Matches
   the band combat.js uses for damage/status text (1.3–1.55) so the die reads as
   the same class of object. Added to the group's own Y rather than used as an
   absolute, so it stays correct on raised terrain (see dungeon/elevation.js). */
const DIE_HEIGHT = 1.5;

/** World-space position of a combatant, preferring its live mesh group. */
function entityWorldPos(e) {
  const p = e && e.ent && e.ent.grp && e.ent.grp.position;
  if (p) return { x: p.x, y: p.y, z: p.z };
  if (e && typeof e.x === 'number') return { x: e.x, y: 0, z: e.z };
  return null;
}

/**
 * Live screen position for a combatant's die.
 *
 * The camera matrices are refreshed first. THREE only recomputes
 * `matrixWorldInverse` inside `renderer.render()`, so anything projecting from
 * game-update code is working against wherever the camera was on some earlier
 * frame — which is what made the dice appear unrelated to the creatures that
 * rolled them rather than pinned above them.
 */
function screenPosFor(engine, ent) {
  const cam = engine && engine.cam;
  const canvas = engine && engine.renderer && engine.renderer.domElement;
  const pos = entityWorldPos(ent);
  if (!cam || !canvas || !pos) return null;
  if (typeof cam.updateMatrixWorld === 'function') cam.updateMatrixWorld();
  const mwi = cam.matrixWorldInverse;
  if (mwi && cam.matrixWorld && typeof mwi.copy === 'function' && typeof mwi.invert === 'function') {
    mwi.copy(cam.matrixWorld).invert();
  }
  return projectVec(cam, canvas, pos.x, pos.y + DIE_HEIGHT, pos.z);
}

function ensureLayer() {
  let el = document.getElementById('init-reveal-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'init-reveal-layer';
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Start the reveal. `order` is the initiative order (already sorted, highest
 * first). Returns false if it can't or shouldn't run, in which case the caller
 * should start combat immediately.
 */
export function beginInitiativeReveal(engine, order, aliveRows) {
  if (!isDom() || !engine || !order || !order.length) return false;
  finishInitiativeReveal();          // never stack two reveals

  const layer = ensureLayer();
  layer.innerHTML = '';
  layer.classList.add('on');

  const rail = document.getElementById('initiative');
  if (rail) rail.classList.add('init-revealing');
  const rows = rail ? Array.from(rail.querySelectorAll('.init-row')) : [];

  const n = aliveRows.length;
  const flight = FLIGHT_SECONDS;
  const flyStart = SCRAMBLE_SECONDS + LOCK_HOLD_SECONDS;
  /* Prefer the full stagger; compress it only if a crowded fight would
     otherwise overrun the ceiling. */
  const staggerBudget = REVEAL_MAX_SECONDS - (flyStart + flight + SETTLE);
  const stagger = n > 1
    ? Math.min(MAX_STAGGER, Math.max(0, staggerBudget) / (n - 1))
    : 0;
  /* End when the dice are actually done, not when a budget runs out — a small
     fight shouldn't sit on a finished screen waiting for the clock. */
  const endAt = flyStart + (n > 1 ? (n - 1) * stagger : 0) + flight + SETTLE;

  const badges = aliveRows.map((e, i) => {
    const scr = screenPosFor(engine, e);
    const el = document.createElement('div');
    el.className = 'init-die ' + (e._side === 'hero' ? 'hero' : 'mon');
    el.textContent = '?';
    /* Off-screen or unprojectable combatants still get a badge so the rail
       fills correctly — it just starts at the rail's own edge instead. */
    el.style.left = (scr ? scr.x : window.innerWidth - 40) + 'px';
    el.style.top = (scr ? scr.y : 120 + i * 20) + 'px';
    layer.appendChild(el);
    /* Next frame so the entry transition actually plays. */
    requestAnimationFrame(() => el.classList.add('in'));
    return { el, ent: e, row: rows[i] || null, value: e._init, launched: false, landed: false, launchAt: flyStart + i * stagger };
  });

  for (const b of badges) if (b.row) b.row.classList.add('init-pending');

  state = { t: 0, engine, badges, flight, endAt, layer, rail, done: false, onSkip: null };

  state.onSkip = () => finishInitiativeReveal();
  window.addEventListener('pointerdown', state.onSkip, { once: true });

  return true;
}

/**
 * Advance the reveal. Returns true while it is still playing, false once combat
 * may begin. `dt` is REAL seconds (game.rawDt), deliberately not scaled by the
 * Options combat-speed slider: this is a fixed-length cinematic, so its budget
 * should mean what it says. Turn pacing scales; the roll-off does not.
 */
export function tickInitiativeReveal(dt) {
  if (!state) return false;
  state.t += (typeof dt === 'number' && dt > 0) ? dt : 0;
  const t = state.t;

  const scrambleEnd = SCRAMBLE_SECONDS;

  for (const b of state.badges) {
    /* Stay pinned above the creature until the die leaves for the rail. The
       camera can pan, zoom and settle during the roll-off, and a badge placed
       once at the start would drift off its owner — which is exactly what made
       these read as free-floating numbers instead of somebody's roll. Cheap:
       a handful of elements, and `left`/`top` are deliberately not transitioned
       in the base CSS so this tracks instantly rather than lagging behind. */
    if (!b.launched) {
      const scr = screenPosFor(state.engine, b.ent);
      if (scr) { b.el.style.left = scr.x + 'px'; b.el.style.top = scr.y + 'px'; }
    }

    if (t < scrambleEnd) {
      /* Cycle a plausible d20 total rather than the raw die, so the number the
         player is watching is the same quantity that lands in the rail. */
      b.el.textContent = String(1 + Math.floor(Math.random() * 20));
      continue;
    }
    if (!b.locked) {
      b.locked = true;
      b.el.textContent = String(b.value != null ? b.value : '—');
      b.el.classList.add('locked');
    }
    if (!b.launched && t >= b.launchAt) {
      b.launched = true;
      const target = b.row ? b.row.getBoundingClientRect() : null;
      if (target) {
        /* Set here rather than in CSS so FLIGHT_SECONDS is the one place the
           flight duration lives, instead of a JS number and a CSS number that
           have to be kept in step. */
        b.el.style.transition = `left ${state.flight}s cubic-bezier(.4,0,.2,1), top ${state.flight}s cubic-bezier(.4,0,.2,1), opacity ${state.flight * 0.5}s linear ${state.flight * 0.5}s, transform ${state.flight}s ease-in`;
        b.el.style.left = (target.left + target.width - 22) + 'px';
        b.el.style.top = (target.top + target.height / 2 - 11) + 'px';
      }
      b.el.classList.add('flying');
    }
    if (b.launched && !b.landed && t >= b.launchAt + state.flight) {
      b.landed = true;
      if (b.row) { b.row.classList.remove('init-pending'); b.row.classList.add('init-landed'); }
      b.el.classList.add('landed');
    }
  }

  if (t >= state.endAt) { finishInitiativeReveal(); return false; }
  return true;
}

/** True while a reveal is playing. */
export function isRevealActive() { return !!state; }

/** Tear down immediately — skipped, combat ended, or finished naturally. */
export function finishInitiativeReveal() {
  if (!state) return;
  const s = state;
  state = null;                       // clear first: onSkip re-enters here
  try { window.removeEventListener('pointerdown', s.onSkip); } catch { /* ignore */ }
  for (const b of s.badges) if (b.row) b.row.classList.remove('init-pending', 'init-landed');
  if (s.rail) s.rail.classList.remove('init-revealing');
  if (s.layer) { s.layer.innerHTML = ''; s.layer.classList.remove('on'); }
}
