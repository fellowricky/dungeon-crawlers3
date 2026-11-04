/**
 * Automatic camera director.
 *
 * The old rule was one line: lerp camTarget onto the party centroid. It framed
 * the party fine and ignored the fight — a caster trading fire across a long
 * hall, a boss the party had backed away from, and half a flanking pack all sat
 * off-screen while the camera stared placidly at four heroes.
 *
 * This module answers three questions, all as pure functions so they can be
 * checked without a renderer:
 *
 *   WHERE   a weighted centroid — the party pulls 70%, the engaged hostiles 30%.
 *           Not the centre of the bounding box: with six goblins on one side the
 *           box centre sits among the goblins, and the party you actually
 *           control drifts to the edge of frame.
 *
 *   HOW FAR the zoom that fits everyone, measured in the camera's own screen
 *           axes rather than in world XZ — the view is a pitched orthographic
 *           three-quarter, so a metre "north" and a metre "east" cost very
 *           different amounts of screen.
 *
 *   WHICH WAY  a quadrant of yaw with the fewest walls standing between the
 *           camera and the party.
 *
 * Two rules keep the director from fighting the player:
 *   - The zoom the player last chose by hand is a ceiling the director pulls
 *     back from but does not push past. Exploring and fighting each remember
 *     their own (see userZoom / exploreZoom in dungeon_scene.js), so the close
 *     exploration shot and the wider tactical one never overwrite each other.
 *     The one exception is the brief action punch-in on a strike or a cast.
 *   - Heroes are a hard constraint, monsters a preference. Whenever fitting the
 *     hostiles would push a hero out of frame, the hostiles lose.
 *
 * Out of combat the frame is fitted differently (framing: 'box'): the camera
 * centres the party's on-screen bounding box rather than a point on the floor,
 * with a margin proportional to the group. Centring on a floor point wastes the
 * lower half of the screen — feet sit at the centre, heads stand 2.4 units
 * above it — and at the tight zooms exploration wants that waste is the
 * difference between a close shot and a medium one.
 */

/** Party's share of the weighted focus point; hostiles get the remainder. */
export const CAM_PARTY_WEIGHT = 0.7;

/** Breathing room kept outside the bounding box, in TILES AS SEEN ON SCREEN
 *  (camera-space units). Horizontally that is exactly two floor tiles; the
 *  vertical screen axis is foreshortened by the camera pitch, so the same two
 *  units cover more ground there — which is the intent, since that is the
 *  direction sprites are tall in. */
export const CAM_FRAME_MARGIN = 2.0;

/** World height a body occupies above its tile. Framing the feet alone crops
 *  heads off at the top of the screen, which is exactly where the health bars
 *  and floating damage numbers live. */
export const CAM_BODY_HEIGHT = 2.4;

/** Height the combat camera aims at: mid-body, not the floor. Aiming at the
 *  feet frames a lone hero from their toes to two body-heights above their
 *  head. Applied as a ground shift (see groundShift) because camTarget stays
 *  on y = 0 for everything else that reads it. */
export const CAM_AIM_HEIGHT = CAM_BODY_HEIGHT / 2;

/** Exploration margin: a fraction of the party's own on-screen half-extent
 *  plus a small floor, in camera units. The fixed CAM_FRAME_MARGIN is two
 *  units a side — at MAX zoom the half-height is only 3.9, so it would spend
 *  half the screen on breathing room. */
export const CAM_EXPLORE_MARGIN_FRAC = 0.15;
export const CAM_EXPLORE_MARGIN = 0.5;

/** Look-ahead while the party walks: the frame leads the leader by this many
 *  seconds of their smoothed velocity, capped at CAM_LEAD_MAX tiles. Without
 *  it the smoothing makes the camera trail, and the screen shows more of the
 *  corridor behind the party than of the one it is walking into. */
export const CAM_LEAD_SECONDS = 0.6;
export const CAM_LEAD_MAX = 2.0;
/** Per-second rate the velocity estimate follows the leader's actual motion. */
export const CAM_LEAD_RATE = 2.5;
/** A leader displacement larger than this in one frame is a teleport (a new
 *  floor, a portal, a snap), not walking: the estimate is dropped. */
export const CAM_LEAD_JUMP = 3.0;

/** Seconds of no camera input before the director takes the wheel back. */
export const CAM_FREE_SECONDS = 7.0;

/** Minimum seconds to hold camera on an action subject before switching targets. */
export const CAM_SUBJECT_HOLD = 1.2;

/** Deadband in tiles on focus drift to eliminate idle micro-jitter. */
export const CAM_FOCUS_DEADBAND = 0.15;

/** Fractional change in the fitted zoom needed before the director retargets.
 *  Without it every step a monster takes rewrites the zoom and the view
 *  breathes continuously. */
export const CAM_ZOOM_DEADBAND = 0.06;

/** Smoothing, as critically damped spring smooth times in seconds (see
 *  smoothDamp): roughly how far behind a steadily moving goal each channel
 *  runs. Exploration is slow and soft; a clash is quicker so the punch-in
 *  lands while the swing is still happening. */
export const CAM_FOCUS_SMOOTH = 0.55;
export const CAM_FOCUS_SMOOTH_ACTION = 0.33;
export const CAM_ZOOM_SMOOTH = 0.6;
export const CAM_ZOOM_SMOOTH_ACTION = 0.32;
export const CAM_ZOOM_SMOOTH_EXPLORE = 1.0;
export const CAM_PITCH_SMOOTH = 0.55;
/** Per-second rate the focus goal follows the fitted frame once it has moved
 *  past CAM_FOCUS_DEADBAND (exploring / during a clash) — the spring's input
 *  filter, so a hop of the fitted frame is not a step for the spring. */
export const CAM_FOCUS_GOAL_RATE = 3.5;
export const CAM_FOCUS_GOAL_RATE_ACTION = 5.5;

/** The exhale after a fight: zoom and tilt hold for CAM_EXHALE_HOLD, then
 *  ease to the exploration shot over CAM_EXHALE_EASE on long smooth times.
 *  Snapping straight from the tactical frame to the close shot the instant the
 *  last enemy drops reads as the camera losing interest mid-moment. The focus
 *  keeps following throughout, so a party that walks off is not left behind. */
export const CAM_EXHALE_HOLD = 1.0;
export const CAM_EXHALE_EASE = 2.5;
export const CAM_ZOOM_SMOOTH_EXHALE = 1.4;
export const CAM_PITCH_SMOOTH_EXHALE = 1.2;

/** The director will not pull back past this to fit a distant hostile — beyond
 *  it the party is too small to read, and a straggler across the floor is not
 *  worth the whole fight becoming ants. Heroes override it (see frameCamera). */
export const CAM_FIT_FLOOR_ZOOM = 3.2;

/** Tighter punch-in zoom for action shots (attacks, spells, crits). */
export const CAM_ACTION_ZOOM_MAX = 13.0;

/** Tighter framing margin outside the action bounding box (in camera units). */
export const CAM_ACTION_MARGIN = 1.3;

/** How strongly an active combat clash pulls the focus point away from the group. */
export const CAM_ACTION_FOCUS_WEIGHT = 0.65;

/** How far in front of the party (toward the camera) a wall can stand and still
 *  block the view, at the default pitch. Past it the sight line has risen above
 *  wall height. occlusionTiles() derives the distance for other pitches — the
 *  low exploration angle needs a longer look. */
export const CAM_OCCLUSION_TILES = 5;

/** Tallest stone wall the forge builds: 2.0 +/- 0.25 (dungeon_scene.js wall
 *  loop). The occlusion tests measure sight lines against this. */
export const CAM_WALL_HEIGHT = 2.25;

/** Tiles of floor in front of a body that a wall can stand on and still hide
 *  it, at `pitch`: the sight line rises tan(pitch) per tile. */
export function occlusionTiles(pitch) {
  return Math.ceil(CAM_WALL_HEIGHT / Math.tan(Math.max(0.2, pitch))) + 1;
}

/** Yaw is only ever changed by a quarter turn, and only when the new quadrant
 *  hides at least this many fewer blockers. Anything finer than a quadrant
 *  turns the isometric wall art through angles it was never drawn for. */
export const CAM_YAW_MARGIN = 3;

/** Seconds the better quadrant must stay better before the camera commits, and
 *  seconds the quarter-turn itself takes. */
export const CAM_YAW_DWELL = 2.5;
export const CAM_COMBAT_YAW_DWELL = 0.8;
export const CAM_YAW_TURN = 1.2;
/** Exploration's quarter turn takes longer — nothing is happening that the
 *  camera has to catch, and a slow turn reads as part of the orbit. */
export const CAM_YAW_TURN_EXPLORE = 2.2;

/** Minimum seconds between automated rotations to prevent camera spinning. */
export const CAM_TURN_COOLDOWN = 3.0;

/** Exploration orbit: a slow pendulum sway of the yaw around the quadrant the
 *  occlusion picker chose, never a full revolution — the screen-to-world
 *  mapping click-to-move relies on only ever drifts this far. Peak angular
 *  speed is AMPLITUDE * 2pi / PERIOD, about 1.6 deg/s. Sprite facing has a
 *  wider rest band than AMPLITUDE (FACING_BAND_REST in sprite_animator.js) so
 *  standing bodies do not flip on every swing. */
export const CAM_ORBIT_AMPLITUDE = 18 * Math.PI / 180;
export const CAM_ORBIT_PERIOD = 70;
/** Seconds the sway takes to grow in after combat, or settle out when combat
 *  starts — the envelope runs through a smoothstep so neither end is a jolt. */
export const CAM_ORBIT_EASE = 3.0;
/** Per-second rate the sway's speed eases to a stop while the player is
 *  pointing at something, and back up after. The camera holds where it is
 *  rather than swinging home, so the tile under the cursor stays put. */
export const CAM_ORBIT_HOLD_RATE = 2.5;
/** Seconds after the pointer last moved over the canvas that the sway stays
 *  held — the player is aiming a click, and a world drifting under the
 *  cursor moves the tile they are about to pick. */
export const CAM_ORBIT_POINTER_HOLD = 2.0;

/** Camera tilt (pitch) in radians. Pitch is angle up/down from ground. */
export const CAM_DEFAULT_PITCH = 0.64;  // standard 3/4 isometric tilt (~36.7 deg)
export const CAM_ACTION_PITCH = 0.52;   // lower-angle dramatic hero tilt (~29.8 deg) on action
export const CAM_TACTICAL_PITCH = 0.70; // steeper tilt (~40.1 deg) to view past walls on wide pull
export const CAM_PITCH_DEADBAND = 0.02;  // deadband (~1.15 deg) to ignore minor fluctuations
export const CAM_PITCH_DWELL = 0.35;     // seconds sustained demand required before tilting
export const CAM_PITCH_COOLDOWN = 0.40;  // seconds before tilt direction is permitted to reverse

/**
 * Project a world point into the camera's screen axes, relative to the focus
 * point. Returns offsets in camera units: +sx is right, +sy is up.
 *
 * The basis is three's own lookAt basis for an eye at
 * `focus + (cosP*sinYaw, sinP, cosP*cosYaw)`:
 *   right = ( cos yaw, 0, -sin yaw)          — always horizontal
 *   up    = (-sinP*sin yaw, cosP, -sinP*cos yaw)
 * so ground distance along the screen-vertical axis is foreshortened by
 * sin(pitch) while height is scaled by cos(pitch).
 */
export function screenOffset(px, py, pz, focusX, focusZ, yaw, pitch) {
  const dx = px - focusX, dz = pz - focusZ;
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  return {
    sx: dx * cy - dz * sy,
    sy: py * cp - sp * (dx * sy + dz * cy)
  };
}

/**
 * Half-extents, in camera units, of the smallest screen-aligned box centred on
 * `focus` that contains every point. Centred on the focus rather than fitted to
 * the cloud because the focus is deliberately off-centre (see CAM_PARTY_WEIGHT)
 * and it is the focus that ends up in the middle of the screen.
 *
 * Each body is sampled at its feet and at its head, so tall things are not
 * framed by their shadows. A point's `y` is the ground it stands on (podiums,
 * raised terrain), so a hero up on a dais is framed by their actual head.
 * `aimY` is the height of the point the camera looks at (see CAM_AIM_HEIGHT).
 */
export function framingExtent(points, focusX, focusZ, yaw, pitch,
                              height = CAM_BODY_HEIGHT, aimY = 0) {
  let hx = 0, hy = 0;
  for (const p of points || []) {
    if (!p) continue;
    const top = p.h != null ? p.h : height;
    const base = p.y || 0;
    for (const py of [base, base + top]) {
      const o = screenOffset(p.x, py - aimY, p.z, focusX, focusZ, yaw, pitch);
      const ax = Math.abs(o.sx), ay = Math.abs(o.sy);
      if (ax > hx) hx = ax;
      if (ay > hy) hy = ay;
    }
  }
  return { hx, hy };
}

/**
 * The ground offset that moves the screen centre by (sx, sy) camera units.
 *
 * Inverse of screenOffset's ground terms: a shift u of the look-at point moves
 * every point's sx by -(u . right) and its sy by +sinP * (u . toward-camera),
 * so solving for u is a rotation by yaw with the vertical term scaled by
 * 1/sinP. This is also how a raised aim point becomes a ground one — looking
 * at height h is looking at the floor h*cosP/sinP further from the camera —
 * which keeps camTarget on y = 0, where boss_cutscene and the light rig
 * expect it.
 */
export function groundShift(sx, sy, yaw, pitch) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const b = -sy / Math.max(1e-3, Math.sin(pitch));
  return { x: c * sx + s * b, z: -s * sx + c * b };
}

/**
 * The screen-aligned bounding box of a set of bodies, centred on itself rather
 * than on a chosen focus: returns the ground point to aim at so the box sits
 * in the middle of the screen, and its half-extents in camera units.
 *
 * framingExtent measures from a fixed focus — right in combat, where the focus
 * is deliberately off-centre — but out of combat it is pure waste: a lone hero
 * standing on the focus spans 0..2 units above centre and nothing below it.
 */
export function framingBox(points, yaw, pitch, height = CAM_BODY_HEIGHT) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let ox = null, oz = 0;
  for (const p of points || []) {
    if (!p) continue;
    if (ox == null) { ox = p.x; oz = p.z; }   // a local origin keeps the sums small
    const top = p.h != null ? p.h : height;
    const base = p.y || 0;
    for (const py of [base, base + top]) {
      const o = screenOffset(p.x, py, p.z, ox, oz, yaw, pitch);
      if (o.sx < minX) minX = o.sx;
      if (o.sx > maxX) maxX = o.sx;
      if (o.sy < minY) minY = o.sy;
      if (o.sy > maxY) maxY = o.sy;
    }
  }
  if (ox == null) return null;
  const u = groundShift((minX + maxX) / 2, (minY + maxY) / 2, yaw, pitch);
  return { x: ox + u.x, z: oz + u.z, hx: (maxX - minX) / 2, hy: (maxY - minY) / 2 };
}

/**
 * Largest orthographic zoom at which a box of these half-extents still fits.
 * The frustum is +/-baseHalf vertically and +/-baseHalf*aspect horizontally,
 * all divided by zoom, so each axis caps the zoom independently and the tighter
 * cap wins. Returns Infinity for a degenerate (single-point) box — the caller
 * clamps.
 *
 * `frac` scales the box itself before the fixed `margin` is added, for a
 * margin that grows with the group (CAM_EXPLORE_MARGIN_FRAC).
 */
export function fitZoom(hx, hy, aspect, baseHalf, margin = CAM_FRAME_MARGIN, frac = 0) {
  const ex = hx * (1 + frac) + margin, ey = hy * (1 + frac) + margin;
  const zx = ex > 1e-6 ? (baseHalf * aspect) / ex : Infinity;
  const zy = ey > 1e-6 ? baseHalf / ey : Infinity;
  return Math.min(zx, zy);
}

/** Arithmetic mean of a point list, or null when it is empty. */
export function centroid(points) {
  let x = 0, z = 0, n = 0;
  for (const p of points || []) { if (!p) continue; x += p.x; z += p.z; n++; }
  return n ? { x: x / n, z: z / n } : null;
}

/**
 * The point the camera aims at: the party centre pulled `1 - w` of the way
 * toward the hostile centre. With no hostiles it is simply the party centre,
 * which is the pre-existing behaviour — so a quiet floor frames exactly as it
 * always did.
 */
export function weightedFocus(party, foes, w = CAM_PARTY_WEIGHT) {
  const pc = centroid(party), fc = centroid(foes);
  if (!pc) return fc;              // whole party down — watch the monsters
  if (!fc) return pc;
  return { x: pc.x + (fc.x - pc.x) * (1 - w), z: pc.z + (fc.z - pc.z) * (1 - w) };
}

/**
 * Midpoint of an active clash (actor and target).
 */
export function actionEpicenter(actor, target) {
  if (!actor) return target ? { x: target.x, z: target.z } : null;
  if (!target) return { x: actor.x, z: actor.z };
  return {
    x: (actor.x + target.x) * 0.5,
    z: (actor.z + target.z) * 0.5
  };
}

/**
 * Blend a base focus point towards an action epicenter by weight w in [0, 1].
 */
export function blendFocus(base, action, w = CAM_ACTION_FOCUS_WEIGHT) {
  if (!base) return action;
  if (!action) return base;
  const k = Math.max(0, Math.min(1, w));
  return {
    x: base.x + (action.x - base.x) * k,
    z: base.z + (action.z - base.z) * k
  };
}

/**
 * Walk a pulled focus back toward the party until the party still fits at
 * `budgetZoom`.
 *
 * Without this the weighting quietly defeats itself. Aiming 30% of the way at a
 * monster fifty tiles off puts the focus fifteen tiles from the party, and the
 * hero guarantee then drags the zoom right out to keep everyone framed around a
 * point nobody is standing near — a wider shot than showing the monster would
 * have needed, of a fight you still cannot see.
 *
 * Both screen half-extents grow linearly with the pull, so the largest safe
 * fraction of it is available in closed form. Solving rather than switching
 * between "aim at the fight" and "aim at the party" also means the focus eases
 * as a monster walks away instead of snapping when it crosses a threshold.
 */
export function clampPull(partyC, pulled, party, {
  aspect = 16 / 9, baseHalf = 55, yaw = Math.PI / 4, pitch = 0.64,
  margin = CAM_FRAME_MARGIN, budgetZoom = CAM_FIT_FLOOR_ZOOM, aimY = 0
} = {}) {
  if (!partyC || !pulled) return pulled || partyC;
  const dx = pulled.x - partyC.x, dz = pulled.z - partyC.z;
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return pulled;

  const base = framingExtent(party, partyC.x, partyC.z, yaw, pitch, CAM_BODY_HEIGHT, aimY);
  const budX = (baseHalf * aspect) / budgetZoom - margin - base.hx;
  const budY = baseHalf / budgetZoom - margin - base.hy;

  /* The pull's own screen-space length, per unit of pull. */
  const d = screenOffset(dx, 0, dz, 0, 0, yaw, pitch);
  const ax = Math.abs(d.sx), ay = Math.abs(d.sy);

  let s = 1;
  if (ax > 1e-9) s = Math.min(s, budX / ax);
  if (ay > 1e-9) s = Math.min(s, budY / ay);
  s = Math.max(0, Math.min(1, s));
  return { x: partyC.x + dx * s, z: partyC.z + dz * s };
}

/**
 * Full framing solution: where to look and how far back to stand.
 *
 * `restZoom` is the zoom the player last set by hand and acts as a ceiling: the
 * director may pull back from it but never pushes past it, so it can reveal a
 * fight without ever overriding a deliberate choice to zoom out and look
 * around. `zoomParty` is the other ceiling and the reason heroes are never
 * cropped — it is computed from the heroes alone, so no arrangement of monsters
 * can raise it.
 *
 * When `actionZoom` is enabled and `action.intensity > 0`, the director can
 * punch in closer for dramatic attacks, spells and critical hits while still
 * strictly guaranteeing no alive hero is cropped.
 *
 * An explicit `focus` is final: the caller has already weighed the party, the
 * hostiles and the clash, and blending the clash in again here pulled the
 * frame toward it twice (~96% at full intensity instead of the caller's 90%).
 * Without one, the weighted focus is computed here and the clash blended in.
 *
 * `framing: 'box'` is the exploration fit — see framingBox. It ignores
 * `focus`, frames `party` plus the optional `lead` point (the look-ahead), and
 * sizes its margin with `marginFrac`. `aimY` raises the look-at point of the
 * default framing (CAM_AIM_HEIGHT); the returned x/z are always the ground
 * point to put camTarget on.
 */
export function frameCamera({
  party = [], foes = [], aspect = 16 / 9, baseHalf = 55,
  yaw = Math.PI / 4, pitch = 0.64,
  minZoom = 1, maxZoom = 14, restZoom = 14,
  floorZoom = CAM_FIT_FLOOR_ZOOM, margin = CAM_FRAME_MARGIN,
  focus: focusOverride = null,
  action = null,
  actionZoom = false,
  actionZoomMax = CAM_ACTION_ZOOM_MAX,
  framing = 'focus', marginFrac = 0, aimY = 0, lead = null
} = {}) {
  if (framing === 'box') {
    const box = framingBox(lead ? party.concat([lead]) : party, yaw, pitch);
    if (!box) return null;
    const zoomParty = fitZoom(box.hx, box.hy, aspect, baseHalf, margin, marginFrac);
    let zoomAll = zoomParty;
    if (foes.length) {
      const ae = framingExtent(party.concat(foes), box.x, box.z, yaw, pitch);
      zoomAll = fitZoom(ae.hx, ae.hy, aspect, baseHalf, margin, marginFrac);
    }
    const ceiling = Math.min(maxZoom, restZoom, zoomParty);
    const zoom = Math.min(ceiling, Math.max(minZoom, Math.max(zoomAll, floorZoom)));
    return { x: box.x, z: box.z, zoom, zoomParty, zoomAll, foesFramed: zoom <= zoomAll };
  }

  const clash = !!(action && action.intensity > 0 && (action.actor || action.target));
  const pullOpts = { aspect, baseHalf, yaw, pitch, margin, aimY,
                     budgetZoom: Math.min(floorZoom, restZoom, maxZoom) };
  let focus = focusOverride;
  if (!focus) {
    focus = clampPull(centroid(party), weightedFocus(party, foes), party, pullOpts);
    if (focus && clash) {
      const epic = actionEpicenter(action.actor, action.target);
      const w = (action.weight ?? CAM_ACTION_FOCUS_WEIGHT) * Math.min(1, action.intensity);
      focus = clampPull(centroid(party), blendFocus(focus, epic, w), party, pullOpts);
    }
  }
  if (!focus) return null;         // nothing alive to look at

  const pe = framingExtent(party, focus.x, focus.z, yaw, pitch, CAM_BODY_HEIGHT, aimY);
  const ae = framingExtent(party.concat(foes), focus.x, focus.z, yaw, pitch, CAM_BODY_HEIGHT, aimY);

  const zoomParty = fitZoom(pe.hx, pe.hy, aspect, baseHalf, margin);
  const zoomAll   = fitZoom(ae.hx, ae.hy, aspect, baseHalf, margin);

  let ceiling = Math.min(maxZoom, restZoom, zoomParty);

  /* Action zoom punch-in: when in an active clash, frame the action participants
     tighter (up to actionZoomMax), but never crop heroes. */
  if (actionZoom && clash) {
    const actPts = [action.actor, action.target].filter(Boolean);
    const actExt = framingExtent(actPts, focus.x, focus.z, yaw, pitch, CAM_BODY_HEIGHT, aimY);
    const fitAct = fitZoom(actExt.hx, actExt.hy, aspect, baseHalf, CAM_ACTION_MARGIN);
    const punchTarget = Math.min(maxZoom, actionZoomMax, zoomParty, fitAct);
    if (punchTarget > restZoom) {
      const punchCeiling = restZoom + (punchTarget - restZoom) * Math.min(1, action.intensity);
      ceiling = Math.min(maxZoom, punchCeiling, zoomParty);
    }
  }

  /* During a clash the frame belongs to the clash: it sits at the ceiling and
     does not pull back for hostiles outside it. Heroes are still guaranteed —
     the ceiling never exceeds zoomParty. */
  const zoom = (actionZoom && clash)
    ? ceiling
    : Math.min(ceiling, Math.max(minZoom, Math.max(zoomAll, floorZoom)));

  const lift = aimY ? groundShift(0, aimY * Math.cos(pitch), yaw, pitch) : { x: 0, z: 0 };
  return { x: focus.x + lift.x, z: focus.z + lift.z,
           zoom, zoomParty, zoomAll, foesFramed: zoom <= zoomAll };
}

/**
 * How much scenery stands between the camera and a point, for one yaw.
 *
 * The camera is up and behind at `focus + t*(sin yaw, ?, cos yaw)`, so anything
 * occluding it lies along that ray on the ground plane. Only the first few
 * tiles matter: past those the camera has risen above wall height.
 *
 * `isBlocked(x, z)` reports walls and view-blocking props at a world point.
 */
export function occlusionScore(focusX, focusZ, yaw, isBlocked,
                              tiles = CAM_OCCLUSION_TILES) {
  if (typeof isBlocked !== 'function') return 0;
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  let hits = 0, lastX = null, lastZ = null;
  for (let t = 0.5; t <= tiles + 1e-9; t += 0.5) {
    const x = Math.round(focusX + dx * t), z = Math.round(focusZ + dz * t);
    if (x === lastX && z === lastZ) continue;   // same tile twice — count once
    lastX = x; lastZ = z;
    if (isBlocked(focusX + dx * t, focusZ + dz * t)) hits++;
  }
  return hits;
}

/**
 * Test sightline occlusion across multiple entities (heroes, active duelists).
 * Returns { occludedCount, severity, minClearingPitch }:
 * - occludedCount: how many entities have a wall blocking the camera's sightline
 * - severity: total normalized occlusion depth across entities
 * - minClearingPitch: camera pitch angle that allows sightline to look over the blocking walls
 */
export function entityOcclusion(entities = [], yaw = Math.PI / 4, pitch = 0.64, isBlocked = null, tiles = CAM_OCCLUSION_TILES) {
  if (typeof isBlocked !== 'function' || !entities || !entities.length) {
    return { occludedCount: 0, severity: 0, minClearingPitch: pitch };
  }
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  const tanP = Math.tan(pitch);
  const WALL_H = CAM_WALL_HEIGHT;

  let occludedCount = 0;
  let severity = 0;
  let minClearingPitch = pitch;

  for (const ent of entities) {
    if (!ent || typeof ent.x !== 'number' || typeof ent.z !== 'number') continue;
    let worstDeficit = 0;
    let lastX = null, lastZ = null;

    for (let t = 0.6; t <= tiles + 1e-6; t += 0.5) {
      const wx = Math.round(ent.x + dx * t);
      const wz = Math.round(ent.z + dz * t);
      if (wx === lastX && wz === lastZ) continue;
      lastX = wx; lastZ = wz;

      if (isBlocked(wx, wz)) {
        const rayH = t * tanP;
        if (rayH < WALL_H) {
          const deficit = (WALL_H - rayH) / WALL_H;
          if (deficit > worstDeficit) worstDeficit = deficit;

          if (t >= 1.2) {
            const reqP = Math.atan(WALL_H / t) + 0.04;
            if (reqP > minClearingPitch) minClearingPitch = reqP;
          }
        }
      }
    }

    if (worstDeficit > 0.05) {
      occludedCount++;
      severity += worstDeficit;
    }
  }

  return {
    occludedCount,
    severity,
    minClearingPitch: Math.min(0.82, minClearingPitch)
  };
}

/**
 * Measure how well a yaw shows an active confrontation.
 * Returns score evaluating horizontal separation + hero over-the-shoulder perspective.
 */
export function actionAngleScore(yaw, actor, target) {
  if (!actor || !target) return 0;
  const dx = target.x - actor.x;
  const dz = target.z - actor.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.5) return 0;
  const sx = Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw)) / dist;
  // Positive dot product means camera looks from behind actor toward target
  const viewDot = (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / dist;
  const heroPerspective = (viewDot > 0.1) ? 0.35 : 0.0;
  return sx + heroPerspective;
}

/**
 * Pick the quarter-turn that best frames an active clash, considering both
 * wall occlusion and line-of-action horizontal separation.
 */
export function pickActionYaw(currentYaw, focusX, focusZ, isBlocked, {
  actor = null, target = null, entities = null,
  margin = 0.5,
  tiles = CAM_OCCLUSION_TILES,
  actionWeight = 2.0,
  pitch = 0.64
} = {}) {
  const ents = entities || [actor, target].filter(Boolean);
  const hereEntOcc = entityOcclusion(ents, currentYaw, pitch, isBlocked, tiles);
  const hereOccl = occlusionScore(focusX, focusZ, currentYaw, isBlocked, tiles);
  const hereAction = actionAngleScore(currentYaw, actor, target);
  const hereScore = -(hereEntOcc.occludedCount * 4.0 + hereEntOcc.severity * 2.0 + hereOccl * 2.0) + hereAction * actionWeight;

  let bestYaw = currentYaw;
  let bestScore = hereScore;

  for (let k = 1; k < 4; k++) {
    const y = currentYaw + k * Math.PI / 2;
    const entOcc = entityOcclusion(ents, y, pitch, isBlocked, tiles);
    const occ = occlusionScore(focusX, focusZ, y, isBlocked, tiles);
    const act = actionAngleScore(y, actor, target);
    const s = -(entOcc.occludedCount * 4.0 + entOcc.severity * 2.0 + occ * 2.0) + act * actionWeight;
    if (s > bestScore) {
      bestScore = s;
      bestYaw = y;
    }
  }

  return (bestScore - hereScore) >= margin ? bestYaw : currentYaw;
}

/**
 * Pick the quarter-turn with the clearest view of the focus, or keep the
 * current one.
 *
 * Only the four quadrants of the current yaw are considered. The level is real
 * 3D geometry and the player's own orbit is continuous, so nothing breaks
 * between quadrants — but a quarter turn is the smallest move that reliably
 * changes which walls stand in front of the party, and with this aspect and
 * pitch the horizontal and vertical framing budgets differ by about 6%, so
 * there is no fit to be won by a finer angle. What rotating does win is an
 * unobstructed view, which is what this scores.
 *
 * Returns the incumbent unless a rival hides at least `margin` fewer blockers,
 * so a single pillar drifting in and out of the sight line cannot start the
 * camera spinning.
 */
export function pickYaw(currentYaw, focusX, focusZ, isBlocked, {
  margin = CAM_YAW_MARGIN, tiles = CAM_OCCLUSION_TILES,
  actor = null, target = null, entities = null, actionWeight = 0,
  pitch = 0.64
} = {}) {
  if (actor && target && actionWeight > 0) {
    return pickActionYaw(currentYaw, focusX, focusZ, isBlocked, {
      actor, target, entities, margin, tiles, actionWeight, pitch
    });
  }
  if (entities && entities.length) {
    const hereEntOcc = entityOcclusion(entities, currentYaw, pitch, isBlocked, tiles);
    let bestYaw = currentYaw;
    let bestScore = -(hereEntOcc.occludedCount * 4.0 + hereEntOcc.severity * 2.0);

    for (let k = 1; k < 4; k++) {
      const y = currentYaw + k * Math.PI / 2;
      const entOcc = entityOcclusion(entities, y, pitch, isBlocked, tiles);
      const s = -(entOcc.occludedCount * 4.0 + entOcc.severity * 2.0);
      if (s > bestScore) { bestScore = s; bestYaw = y; }
    }
    const currentScore = -(hereEntOcc.occludedCount * 4.0 + hereEntOcc.severity * 2.0);
    return (bestScore - currentScore) >= margin ? bestYaw : currentYaw;
  }

  // Classic single-point occlusion score when no entity list is provided
  const here = occlusionScore(focusX, focusZ, currentYaw, isBlocked, tiles);
  let bestYaw = currentYaw, bestScore = here;
  for (let k = 1; k < 4; k++) {
    const y = currentYaw + k * Math.PI / 2;
    const s = occlusionScore(focusX, focusZ, y, isBlocked, tiles);
    if (s < bestScore) { bestScore = s; bestYaw = y; }
  }
  return (here - bestScore) >= margin ? bestYaw : currentYaw;
}

/** Shortest signed angle from a to b, in (-pi, pi]. */
export function shortestTurn(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Should the director adopt `next` as its zoom goal?
 *
 * A deadband on the RATIO, not the difference: zoom is multiplicative (the same
 * step is a much bigger visual change at 3 than at 12), so a fixed absolute
 * threshold would be twitchy when close in and unresponsive when far out.
 */
export function zoomChanged(current, next, deadband = CAM_ZOOM_DEADBAND) {
  if (!(current > 0) || !(next > 0)) return true;
  return Math.abs(Math.log(next / current)) > deadband;
}

const smoothstep = u => u * u * (3 - 2 * u);

/**
 * One step of a critically damped spring toward `target`: returns
 * [value, velocity]. The game-programming SmoothDamp (Game Programming Gems 4,
 * 1.10), with its rational approximation of exp(-omega*dt).
 *
 * Replaces the director's old `value += (goal - value) * min(1, dt * k)`. That
 * form jumps to full speed the instant a goal changes — the camera lurches off
 * and only the arrival is soft — and how far it moves per second depends on
 * the frame rate. A spring carries its velocity, so it eases out of rest as
 * well as into it, never overshoots, and moves the same at 60 Hz and 144 Hz.
 */
export function smoothDamp(cur, target, vel, smoothTime, dt) {
  if (!(dt > 0)) return [cur, vel || 0];
  const omega = 2 / Math.max(1e-4, smoothTime);
  const x = omega * dt;
  const k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = ((vel || 0) + omega * change) * dt;
  let v = ((vel || 0) - omega * temp) * k;
  let out = target + (change + temp) * k;
  if ((target - cur > 0) === (out > target)) { out = target; v = 0; }   // no overshoot
  return [out, v];
}

/**
 * One frame of the director, smoothing included.
 *
 * Deliberately takes a plain `port` describing the camera rather than the
 * camera itself, so the whole director — including the parts that carry state
 * across frames, which are exactly the parts that go wrong — can be driven and
 * inspected without a renderer, a scene or a canvas.
 *
 * `st` is the caller's mutable scratch (goal zoom, dwell timer, in-flight
 * turn, turn cooldown). Returns the values to apply, or null when there is
 * nothing to look at.
 */
export function driveCamera(st, port, dt) {
  const frame = frameCamera({
    party: port.party, foes: port.foes, focus: port.focus,
    aspect: port.aspect, baseHalf: port.baseHalf,
    yaw: port.yaw, pitch: port.pitch,
    minZoom: port.minZoom, maxZoom: port.maxZoom, restZoom: port.restZoom,
    action: port.action, actionZoom: port.actionZoom, actionZoomMax: port.actionZoomMax,
    framing: port.framing, margin: port.margin, marginFrac: port.marginFrac,
    aimY: port.aimY, lead: port.lead
  });
  if (!frame) return null;

  const clash = !!(port.action && port.action.intensity > 0.1);
  const explore = port.framing === 'box';

  /* The exhale: a fight has just ended (combat framing gave way to the
     exploration box). Zoom and tilt hold, then ease over long smooth times. */
  if (explore && st.wasExplore === false) st.exhaleT = 0;
  else if (!explore) st.exhaleT = null;
  st.wasExplore = explore;
  let exhale = null;                 // 'hold' | 'ease' | null
  if (st.exhaleT != null) {
    st.exhaleT += dt;
    if (st.exhaleT < CAM_EXHALE_HOLD) exhale = 'hold';
    else if (st.exhaleT < CAM_EXHALE_HOLD + CAM_EXHALE_EASE) exhale = 'ease';
    else st.exhaleT = null;
  }

  /* Anything else that moved the camera since our last frame — a drag, the
     wheel, a cutscene, a floor snap — invalidates the springs' velocities:
     they describe motion the camera is no longer making. */
  const moved = (a, b) => b == null || Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b));
  if (moved(port.targetX, st.outX) || moved(port.targetZ, st.outZ)) { st.focusVX = 0; st.focusVZ = 0; }
  if (moved(port.zoom, st.outZoom)) st.zoomV = 0;
  if (moved(port.pitch, st.outPitch)) st.pitchV = 0;

  /* Focus: a deadbanded, filtered goal (idle micro-drift never reaches it),
     and a spring from the camera to the goal. */
  const driftDist = Math.hypot(frame.x - (st.focusGoalX ?? frame.x), frame.z - (st.focusGoalZ ?? frame.z));
  if (st.focusGoalX == null || driftDist > CAM_FOCUS_DEADBAND) {
    const gk = 1 - Math.exp(-(clash ? CAM_FOCUS_GOAL_RATE_ACTION : CAM_FOCUS_GOAL_RATE) * Math.max(0, dt));
    st.focusGoalX = (st.focusGoalX ?? frame.x) + (frame.x - (st.focusGoalX ?? frame.x)) * gk;
    st.focusGoalZ = (st.focusGoalZ ?? frame.z) + (frame.z - (st.focusGoalZ ?? frame.z)) * gk;
  }
  const focusSmooth = clash ? CAM_FOCUS_SMOOTH_ACTION : CAM_FOCUS_SMOOTH;
  const [x, vx] = smoothDamp(port.targetX, st.focusGoalX, st.focusVX, focusSmooth, dt);
  const [z, vz] = smoothDamp(port.targetZ, st.focusGoalZ, st.focusVZ, focusSmooth, dt);
  st.focusVX = vx; st.focusVZ = vz;

  /* Zoom: retarget only outside the deadband, and spring in log space — zoom
     is multiplicative, so equal steps of log zoom look like equal steps. While
     the exhale holds, the goal stays where the fight left it (pulled in only
     if a hero would otherwise leave the frame). */
  if (exhale === 'hold' && st.zoomGoal != null) {
    st.zoomGoal = Math.min(st.zoomGoal, frame.zoomParty);
  } else if (st.zoomGoal == null || zoomChanged(st.zoomGoal, frame.zoom)) {
    st.zoomGoal = frame.zoom;
  }
  const zoomSmooth = exhale ? CAM_ZOOM_SMOOTH_EXHALE
    : clash ? CAM_ZOOM_SMOOTH_ACTION
    : explore ? CAM_ZOOM_SMOOTH_EXPLORE : CAM_ZOOM_SMOOTH;
  let zoom = st.zoomGoal;
  if (port.zoom > 0) {
    const [lz, zv] = smoothDamp(Math.log(port.zoom), Math.log(st.zoomGoal), st.zoomV, zoomSmooth, dt);
    zoom = Math.exp(lz); st.zoomV = zv;
  }

  /* Pitch: dynamically tilt to clear wall occlusions, or tilt flatter for action shots.
     Uses dwell delay, deadband, and cooldown to eliminate rapid tilt oscillations and jitter. */
  const basePitch = port.restPitch ?? CAM_DEFAULT_PITCH;
  let targetPitch = basePitch;

  // Check entity occlusion at current yaw and base pitch
  const entities = port.entities || port.party || [];
  const tiles = occlusionTiles(basePitch);
  const occ = entityOcclusion(entities, port.yaw, basePitch, port.isBlocked, tiles);

  /* With the wall cutaway on, walls in front of a body are dissolved by the
     renderer (render/wall_cutaway.js), so tilting up to see over them would
     only throw away the low angle for nothing. The lift is the fallback for
     players who switch the cutaway off. */
  if (occ.occludedCount > 0 && !port.cutaway) {
    // Elevate camera to see over blocking walls
    targetPitch = Math.max(basePitch, occ.minClearingPitch);
  } else if (port.action && port.action.intensity > 0) {
    // Lower tilt for cinematic action shots when clear of walls
    targetPitch = basePitch + (CAM_ACTION_PITCH - basePitch) * Math.min(1, port.action.intensity);
  } else if (frame.zoom < CAM_FIT_FLOOR_ZOOM + 1) {
    targetPitch = Math.min(1.1, basePitch + 0.08);
  }

  // Tilt stabilization: require sustained dwell time before adopting a new pitch goal
  if (st.pitchCooldown > 0) {
    st.pitchCooldown = Math.max(0, st.pitchCooldown - dt);
  }

  if (st.pitchGoal == null) {
    st.pitchGoal = port.pitch > 0 ? port.pitch : basePitch;
    st.pitchDwell = 0;
    st.pitchCooldown = 0;
  } else if (exhale === 'hold') {
    st.pitchDwell = 0;               // the exhale holds the fight's tilt
  } else {
    const pitchDiff = Math.abs(targetPitch - st.pitchGoal);
    if (pitchDiff > CAM_PITCH_DEADBAND && (!st.pitchCooldown || st.pitchCooldown <= 0)) {
      st.pitchDwell = (st.pitchDwell || 0) + dt;
      if (st.pitchDwell >= CAM_PITCH_DWELL) {
        st.pitchGoal = targetPitch;
        st.pitchDwell = 0;
        st.pitchCooldown = CAM_PITCH_COOLDOWN;
      }
    } else {
      st.pitchDwell = 0;
    }
  }

  let pitch = st.pitchGoal;
  if (port.pitch > 0) {
    const [p, pv] = smoothDamp(port.pitch, st.pitchGoal, st.pitchV,
                               exhale ? CAM_PITCH_SMOOTH_EXHALE : CAM_PITCH_SMOOTH, dt);
    pitch = p; st.pitchV = pv;
  }

  /* Turn cooldown timer */
  if (st.turnCooldown > 0) {
    st.turnCooldown = Math.max(0, st.turnCooldown - dt);
  }

  /* Yaw is two layers. The base is a committed quarter-turn, never a
     continuous drift: once a turn starts it runs to completion — reversing
     mid-swing on a flicker of the score is far more disorienting than the turn
     itself. On top of it sits the exploration orbit's sway (orbitStep). The
     camera's yaw carries last frame's sway, so it is taken off before the
     quarter-turn logic reasons about quadrants and put back after. */
  const base = port.yaw - (st.orbitOffset || 0);
  let baseYaw = base;
  if (port.autoRotate) {
    if (st.turnT != null) {
      st.turnT += dt;
      const u = Math.min(1, st.turnT / (st.turnDur || CAM_YAW_TURN));
      baseYaw = st.turnFrom + st.turnDelta * smoothstep(u);
      if (u >= 1) {
        st.turnT = null;
        st.dwell = 0;
        st.turnCooldown = CAM_TURN_COOLDOWN;
      }
    } else if (!st.turnCooldown || st.turnCooldown <= 0) {
      const act = port.action;
      const hasAction = !!(act && act.intensity > 0 && act.actor && act.target);
      const want = hasAction
        ? pickActionYaw(base, frame.x, frame.z, port.isBlocked, {
            actor: act.actor, target: act.target, entities,
            actionWeight: port.actionYawWeight ?? 2.0, pitch: port.pitch,
            tiles: occlusionTiles(port.pitch)
          })
        : pickYaw(base, frame.x, frame.z, port.isBlocked,
                  { entities, pitch: port.pitch, tiles: occlusionTiles(port.pitch) });

      if (Math.abs(shortestTurn(base, want)) > 1e-6) {
        st.dwell = (st.dwell || 0) + dt;
        const requiredDwell = hasAction ? (port.combatDwell ?? CAM_COMBAT_YAW_DWELL) : (port.dwell ?? CAM_YAW_DWELL);
        if (st.dwell >= requiredDwell) {
          st.turnFrom = base;
          st.turnDelta = shortestTurn(base, want);
          st.turnT = 0;
          st.turnDur = (explore && !hasAction) ? CAM_YAW_TURN_EXPLORE : CAM_YAW_TURN;
        }
      } else {
        st.dwell = 0;      // the view cleared on its own; forget the candidate
      }
    }
  } else if (st.turnT != null) {
    st.turnT = null; st.dwell = 0;   // rotation switched off mid-turn
  }

  const yaw = baseYaw + orbitStep(st, !!port.orbit, !!port.orbitHold, dt);

  st.outX = x; st.outZ = z; st.outZoom = zoom; st.outPitch = pitch;
  return { x, z, zoom, yaw, pitch, frame };
}

/**
 * Advance the exploration orbit one frame and return the yaw offset to add to
 * the base yaw: CAM_ORBIT_AMPLITUDE * sin(phase), scaled by an envelope.
 *
 * `on` grows the envelope in (exploring, setting on) or settles it out
 * (combat, setting off) over CAM_ORBIT_EASE through a smoothstep, so the sway
 * neither kicks in nor stops dead. While the envelope is fully out the phase
 * rests at zero, so the next sway starts from the base yaw instead of
 * wherever the last one was cut off.
 *
 * `hold` (the player is pointing at something) eases the phase speed to zero
 * without touching the envelope: the camera stops where it is rather than
 * swinging back, and resumes from there.
 */
export function orbitStep(st, on, hold, dt) {
  const step = (dt > 0 ? dt : 0) / CAM_ORBIT_EASE;
  st.orbitEnv = Math.max(0, Math.min(1, (st.orbitEnv || 0) + (on ? step : -step)));
  if (st.orbitEnv <= 0) {
    st.orbitPhase = 0;
    st.orbitOffset = 0;
    return 0;
  }
  const want = hold ? 0 : 1;
  st.orbitSpeed = st.orbitSpeed == null ? want
    : st.orbitSpeed + (want - st.orbitSpeed) * (1 - Math.exp(-CAM_ORBIT_HOLD_RATE * Math.max(0, dt)));
  st.orbitPhase = (st.orbitPhase || 0) + Math.max(0, dt) * (2 * Math.PI / CAM_ORBIT_PERIOD) * st.orbitSpeed;
  st.orbitOffset = CAM_ORBIT_AMPLITUDE * Math.sin(st.orbitPhase) * smoothstep(st.orbitEnv);
  return st.orbitOffset;
}

/**
 * The look-ahead point for exploration framing: where the leader will be in
 * CAM_LEAD_SECONDS at their smoothed walking velocity, or null when they are
 * standing still. Framed as a ground-level point (h 0) alongside the party, so
 * the box — and with it the camera — extends in the direction of travel.
 *
 * The velocity is filtered (CAM_LEAD_RATE) rather than read raw: path-following
 * jinks round every corner, and an unfiltered lead would swing the frame with
 * each one. State lives on `st` (leadPX/leadPZ last position, leadVX/leadVZ
 * velocity estimate).
 */
export function leadPoint(st, leader, dt) {
  if (!leader) { st.leadPX = null; return null; }
  if (st.leadPX == null || !(dt > 0)) {
    if (st.leadPX == null) { st.leadVX = 0; st.leadVZ = 0; }
    st.leadPX = leader.x; st.leadPZ = leader.z;
  } else {
    const mx = leader.x - st.leadPX, mz = leader.z - st.leadPZ;
    st.leadPX = leader.x; st.leadPZ = leader.z;
    if (Math.hypot(mx, mz) > CAM_LEAD_JUMP) {
      st.leadVX = 0; st.leadVZ = 0;      // a teleport, not a step
    } else {
      const k = 1 - Math.exp(-CAM_LEAD_RATE * dt);
      st.leadVX += (mx / dt - st.leadVX) * k;
      st.leadVZ += (mz / dt - st.leadVZ) * k;
    }
  }
  let lx = st.leadVX * CAM_LEAD_SECONDS, lz = st.leadVZ * CAM_LEAD_SECONDS;
  const len = Math.hypot(lx, lz);
  if (len < 0.05) return null;
  if (len > CAM_LEAD_MAX) { lx *= CAM_LEAD_MAX / len; lz *= CAM_LEAD_MAX / len; }
  return { x: leader.x + lx, z: leader.z + lz, y: leader.y || 0, h: 0 };
}

const alive = e => !!(e && (!e.data || e.data.hp > 0));
const closest = (from, list) => {
  let best = null, bestD = Infinity;
  for (const e of list) {
    const d = Math.hypot(e.x - from.x, e.z - from.z);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
};

/**
 * WHO the combat camera is watching: the hero and hostile of the clash worth
 * framing this frame, plus whether a swing or cast is actually in progress.
 *
 * In priority order: anyone mid-lunge or mid-cast; the initiative actor and
 * their target; the hero currently choosing a target; the closest
 * hero/hostile pair. A swing holds the subject for CAM_SUBJECT_HOLD so the
 * frame is not yanked to the next candidate the instant the lunge ends.
 *
 * The pointer deliberately has no say. Hover used to pick the hostile, so the
 * camera slid the hovered monster out from under the cursor, the hover moved
 * to whatever slid in, and the camera slid again. Targeting modes contribute
 * their hero only, for the same reason — their target follows the pointer.
 *
 * `ctx`: heroes, monsters (game entities), party/foes (framed points, used for
 * the closest-pair fallbacks), curActor, targetingHero, now. Holds its state
 * on `st.subject` / `st.subjectUntil`.
 */
export function pickClash(st, {
  heroes = [], monsters = [], party = [], foes = [],
  curActor = null, targetingHero = null, now = 0
} = {}) {
  let hero = null, foe = null, striking = false;

  for (const h of heroes) {
    if (alive(h) && h.data && (h.lungeT > 0 || h.castAnim)) {
      hero = h; foe = h.target || h._pendingAttackTarget || h._lastTarget;
      striking = true;
      break;
    }
  }
  if (!hero) {
    for (const m of monsters) {
      if (m && m.active && alive(m) && m.data && (m.lungeT > 0 || m.castAnim)) {
        foe = m; hero = m.target || m._lastTarget;
        striking = true;
        break;
      }
    }
  }

  if (!hero && !foe && curActor) {
    if (curActor._side === 'hero' || heroes.includes(curActor)) {
      hero = curActor;
      foe = curActor.target || curActor.aiFoe || curActor._pendingAttackTarget || curActor._lastTarget;
    } else {
      foe = curActor;
      hero = curActor.target || (curActor._tgtIdx != null ? heroes[curActor._tgtIdx] : null) || curActor._lastTarget;
    }
  }

  if (!hero && targetingHero) hero = targetingHero;

  if (hero && !foe && foes.length) foe = closest(hero, foes);
  else if (foe && !hero && party.length) hero = closest(foe, party);

  if (!hero && !foe && party.length && foes.length) {
    let bestD = Infinity;
    for (const p of party) for (const f of foes) {
      const d = Math.hypot(p.x - f.x, p.z - f.z);
      if (d < bestD) { bestD = d; hero = p; foe = f; }
    }
  }

  if (striking && hero) {
    st.subject = { actor: hero, target: foe };
    st.subjectUntil = now + CAM_SUBJECT_HOLD;
  } else if (st.subject && now < (st.subjectUntil || 0)) {
    const s = st.subject;
    const standing = e => !e || alive(e);   // an absent target is not a dead one
    if (standing(s.actor) && standing(s.target) && !targetingHero) {
      hero = s.actor; foe = s.target;
    } else {
      st.subject = null;
    }
  } else if (hero) {
    st.subject = { actor: hero, target: foe };
    st.subjectUntil = now + 0.2;
  }

  return { actor: hero, target: foe, striking };
}

/** Drop everything the director carries across frames — on a new floor, or a
 *  camera snap (a scripted cutscene move counts). */
export function resetDirector(st) {
  st.zoomGoal = null; st.dwell = 0; st.turnT = null;
  st.turnFrom = 0; st.turnDelta = 0; st.turnCooldown = 0;
  st.focusGoalX = null; st.focusGoalZ = null;
  st.pitchGoal = null; st.pitchDwell = 0; st.pitchCooldown = 0;
  st.subject = null; st.subjectUntil = 0; st.intensity = 0;
  st.leadPX = null; st.leadPZ = null; st.leadVX = 0; st.leadVZ = 0;
  st.orbitEnv = 0; st.orbitPhase = 0; st.orbitOffset = 0; st.orbitSpeed = null;
  st.focusVX = 0; st.focusVZ = 0; st.zoomV = 0; st.pitchV = 0;
  st.outX = null; st.outZ = null; st.outZoom = null; st.outPitch = null;
  st.exhaleT = null; st.wasExplore = null; st.turnDur = null;
}

