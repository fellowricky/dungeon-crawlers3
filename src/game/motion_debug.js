/**
 * Motion / jitter tracer.
 *
 * Combat position bugs are hard to see in a log of *decisions* (Trace). This
 * records *where the sprite went* and which system moved it, and flags a
 * reversal (the tell of tile-edge jitter: one system walks forward, another
 * pulls back).
 *
 * Off by default. Turn on from the console:
 *   __motionDebug(true)     // verbose: every real move, reversals as warnings
 *   __motionDump()          // last trail + reversals
 *   __motionReversals()     // just the back-and-forth events
 *
 * The stuck-turn ceiling always dumps a snapshot of the actor even when this
 * is off, so the warning names the actual reason the spotlight hung.
 */

const TRAIL_MAX = 240;
const REV_MAX = 60;
const EPS = 0.008;

function round3(n) { return Math.round(n * 1000) / 1000; }

export function describeActor(game, e) {
  if (!e) return { name: '?' };
  const W = game && game.D && game.D.W;
  const cell = (game && typeof game.cellOf === 'function') ? game.cellOf(e.x, e.z) : -1;
  let dCenter = null;
  if (cell >= 0 && W != null && typeof game.wx === 'function') {
    const tx = game.wx(cell % W), tz = game.wz(Math.floor(cell / W));
    dCenter = Math.hypot(e.x - tx, e.z - tz);
  }
  return {
    name: (e.data && e.data.name) || '?',
    x: round3(e.x), z: round3(e.z),
    cell,
    dCenter: dCenter != null ? round3(dCenter) : null,
    moving: !!e.moving,
    walk: !!e.walk,
    actUsed: !!e.actUsed,
    moveLeft: e.moveLeft,
    pathI: e.pathI | 0,
    pathLeft: (e.path && e.pathI < e.path.length) ? (e.path.length - e.pathI) : 0,
    lungeT: round3(e.lungeT || 0),
    knockT: round3(e.knockT || 0),
    tween: e._posTween
      ? { t: round3(e._posTween.t), dur: round3(e._posTween.dur) }
      : null,
    reservedCell: e.reservedCell,
    settledCell: e._settledCell,
    pendingAttacks: e._pendingAttacks || 0,
    lastSrc: e._mot && e._mot.src,
  };
}

export const Motion = {
  on: false,
  trail: [],
  reversals: [],

  enable(v = true) {
    this.on = !!v;
    if (!v) return 'motion debug OFF';
    return 'motion debug ON — reversals print as console.warn; __motionDump() for the trail';
  },

  clear() {
    this.trail.length = 0;
    this.reversals.length = 0;
  },

  /**
   * Call after a system may have written e.x / e.z.
   * `src` is a short tag: 'stepAlong' | 'snapToTileCenter' | 'wallRepel' | …
   */
  after(game, e, src) {
    if (!e) return;
    const prev = e._mot;
    const dx = prev ? e.x - prev.x : 0;
    const dz = prev ? e.z - prev.z : 0;
    const dist = Math.hypot(dx, dz);
    const rec = {
      t: (game && game.elapsed) || 0,
      src,
      name: (e.data && e.data.name) || '?',
      x: round3(e.x), z: round3(e.z),
      dx: round3(dx), dz: round3(dz), dist: round3(dist),
    };
    if (game) Object.assign(rec, describeActor(game, e));
    rec.src = src;
    rec.dx = round3(dx); rec.dz = round3(dz); rec.dist = round3(dist);

    const moved = dist > EPS;
    if (moved && prev && (prev.dx * dx + prev.dz * dz) < -1e-6
        && Math.hypot(prev.dx, prev.dz) > EPS) {
      rec.reversal = true;
      rec.prevSrc = prev.src;
      this.reversals.push(rec);
      if (this.reversals.length > REV_MAX) this.reversals.shift();
      console.warn('[motion] REVERSAL', rec.name,
        prev.src, '→', src,
        'at', rec.x, rec.z,
        'dCenter', rec.dCenter,
        'moving', rec.moving,
        'pathLeft', rec.pathLeft,
        'lungeT', rec.lungeT);
    } else if (this.on && moved) {
      console.log('[motion]', rec.name, src, rec);
    }

    e._mot = { x: e.x, z: e.z, dx, dz, src, t: rec.t };
    if (moved || rec.reversal) {
      this.trail.push(rec);
      if (this.trail.length > TRAIL_MAX) this.trail.splice(0, this.trail.length - TRAIL_MAX);
    }
  },

  /** Visual-only offset (attack lunge / knockback glide) — does not touch e.x/z.
   *  Quiet unless debug is on: a melee lunge always goes out and back, and that
   *  is not the logical jitter we are hunting. */
  visual(game, e, vx, vz, src) {
    if (!this.on || !e) return;
    const prev = e._motVis;
    const dx = prev ? vx - prev.x : 0;
    const dz = prev ? vz - prev.z : 0;
    const dist = Math.hypot(dx, dz);
    e._motVis = { x: vx, z: vz, dx, dz, src };
    if (dist <= EPS) return;
    const rec = {
      t: (game && game.elapsed) || 0,
      src,
      visual: true,
      name: (e.data && e.data.name) || '?',
      x: round3(vx), z: round3(vz),
      dx: round3(dx), dz: round3(dz), dist: round3(dist),
      lungeT: round3(e.lungeT || 0),
      knockT: round3(e.knockT || 0),
    };
    if (prev && (prev.dx * dx + prev.dz * dz) < -1e-6 && Math.hypot(prev.dx, prev.dz) > EPS) {
      rec.reversal = true;
      rec.prevSrc = prev.src;
      this.reversals.push(rec);
      if (this.reversals.length > REV_MAX) this.reversals.shift();
      if (this.on) {
        console.warn('[motion] VISUAL REVERSAL', rec.name, prev.src, '→', src,
          'amp', rec.dist, 'lungeT', rec.lungeT, 'knockT', rec.knockT);
      }
    } else if (this.on) {
      console.log('[motion]', rec.name, src, rec);
    }
    this.trail.push(rec);
    if (this.trail.length > TRAIL_MAX) this.trail.splice(0, this.trail.length - TRAIL_MAX);
  },

  dump(name) {
    const trail = name ? this.trail.filter(r => r.name === name) : this.trail;
    const revs = name ? this.reversals.filter(r => r.name === name) : this.reversals;
    return { trail, reversals: revs };
  },
};

export function installMotionConsole() {
  if (typeof window === 'undefined') return;
  window.__motionDebug = (v = true) => Motion.enable(v);
  window.__motionDump = (name) => {
    const d = Motion.dump(name);
    console.log('[motion] trail', d.trail);
    console.warn('[motion] reversals', d.reversals);
    return d;
  };
  window.__motionReversals = (name) =>
    (name ? Motion.reversals.filter(r => r.name === name) : Motion.reversals);
  window.__motionClear = () => { Motion.clear(); return 'motion trail cleared'; };
}
