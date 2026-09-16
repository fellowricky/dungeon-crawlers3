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
 *   - It only ever zooms OUT from the zoom the player last chose by hand. A
 *     director that zooms in overrides a deliberate choice; one that only pulls
 *     back to reveal something is read as helpful.
 *   - Heroes are a hard constraint, monsters a preference. Whenever fitting the
 *     hostiles would push a hero out of frame, the hostiles lose.
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

/** Approach rates, per second, for the focus point and the zoom. */
export const CAM_FOCUS_LERP = 1.8;
export const CAM_ZOOM_LERP = 1.8;

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
 *  block the view. At pitch 0.64 the sight line clears a 3-unit wall after
 *  about four tiles, so looking further is wasted work. */
export const CAM_OCCLUSION_TILES = 5;

/** Yaw is only ever changed by a quarter turn, and only when the new quadrant
 *  hides at least this many fewer blockers. Anything finer than a quadrant
 *  turns the isometric wall art through angles it was never drawn for. */
export const CAM_YAW_MARGIN = 3;

/** Seconds the better quadrant must stay better before the camera commits, and
 *  seconds the quarter-turn itself takes. */
export const CAM_YAW_DWELL = 2.5;
export const CAM_COMBAT_YAW_DWELL = 0.8;
export const CAM_YAW_TURN = 1.2;

/** Minimum seconds between automated rotations to prevent camera spinning. */
export const CAM_TURN_COOLDOWN = 3.0;

/** Camera tilt (pitch) in radians. Pitch is angle up/down from ground. */
export const CAM_DEFAULT_PITCH = 0.64;  // standard 3/4 isometric tilt (~36.7 deg)
export const CAM_ACTION_PITCH = 0.52;   // lower-angle dramatic hero tilt (~29.8 deg) on action
export const CAM_TACTICAL_PITCH = 0.70; // steeper tilt (~40.1 deg) to view past walls on wide pull
export const CAM_PITCH_LERP = 2.4;      // rate at which tilt adjusts per second

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
 * framed by their shadows.
 */
export function framingExtent(points, focusX, focusZ, yaw, pitch,
                              height = CAM_BODY_HEIGHT) {
  let hx = 0, hy = 0;
  for (const p of points || []) {
    if (!p) continue;
    const top = p.h != null ? p.h : height;
    for (const py of [0, top]) {
      const o = screenOffset(p.x, py, p.z, focusX, focusZ, yaw, pitch);
      const ax = Math.abs(o.sx), ay = Math.abs(o.sy);
      if (ax > hx) hx = ax;
      if (ay > hy) hy = ay;
    }
  }
  return { hx, hy };
}

/**
 * Largest orthographic zoom at which a box of these half-extents still fits.
 * The frustum is +/-baseHalf vertically and +/-baseHalf*aspect horizontally,
 * all divided by zoom, so each axis caps the zoom independently and the tighter
 * cap wins. Returns Infinity for a degenerate (single-point) box — the caller
 * clamps.
 */
export function fitZoom(hx, hy, aspect, baseHalf, margin = CAM_FRAME_MARGIN) {
  const ex = hx + margin, ey = hy + margin;
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
  margin = CAM_FRAME_MARGIN, budgetZoom = CAM_FIT_FLOOR_ZOOM
} = {}) {
  if (!partyC || !pulled) return pulled || partyC;
  const dx = pulled.x - partyC.x, dz = pulled.z - partyC.z;
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return pulled;

  const base = framingExtent(party, partyC.x, partyC.z, yaw, pitch);
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
 */
export function frameCamera({
  party = [], foes = [], aspect = 16 / 9, baseHalf = 55,
  yaw = Math.PI / 4, pitch = 0.64,
  minZoom = 1, maxZoom = 14, restZoom = 14,
  floorZoom = CAM_FIT_FLOOR_ZOOM, margin = CAM_FRAME_MARGIN,
  focus: focusOverride = null,
  action = null,
  actionZoom = false,
  actionZoomMax = CAM_ACTION_ZOOM_MAX
} = {}) {
  let focus = focusOverride;
  if (!focus) {
    focus = clampPull(centroid(party), weightedFocus(party, foes), party,
                 { aspect, baseHalf, yaw, pitch, margin,
                   budgetZoom: Math.min(floorZoom, restZoom, maxZoom) });
  }
  if (!focus) return null;         // nothing alive to look at

  /* Always apply action focus pull when active clash exists */
  if (action && action.intensity > 0 && (action.actor || action.target)) {
    const epic = actionEpicenter(action.actor, action.target);
    const w = (action.weight ?? CAM_ACTION_FOCUS_WEIGHT) * Math.min(1, action.intensity);
    const blended = blendFocus(focus, epic, w);
    focus = clampPull(centroid(party), blended, party,
                      { aspect, baseHalf, yaw, pitch, margin,
                        budgetZoom: Math.min(floorZoom, restZoom, maxZoom) });
  }

  const pe = framingExtent(party, focus.x, focus.z, yaw, pitch);
  const ae = framingExtent(party.concat(foes), focus.x, focus.z, yaw, pitch);

  const zoomParty = fitZoom(pe.hx, pe.hy, aspect, baseHalf, margin);
  const zoomAll   = fitZoom(ae.hx, ae.hy, aspect, baseHalf, margin);

  let ceiling = Math.min(maxZoom, restZoom, zoomParty);

  /* Action zoom punch-in: when in an active clash, frame the action participants
     tighter (up to actionZoomMax), but never crop heroes. */
  if (actionZoom && action && action.intensity > 0 && (action.actor || action.target)) {
    const actPts = [action.actor, action.target].filter(Boolean);
    const actExt = framingExtent(actPts, focus.x, focus.z, yaw, pitch);
    const fitAct = fitZoom(actExt.hx, actExt.hy, aspect, baseHalf, CAM_ACTION_MARGIN);
    const punchTarget = Math.min(maxZoom, actionZoomMax, zoomParty, fitAct);
    if (punchTarget > restZoom) {
      const punchCeiling = restZoom + (punchTarget - restZoom) * Math.min(1, action.intensity);
      ceiling = Math.min(maxZoom, punchCeiling, zoomParty);
    }
  }

  let zoom;
  if (actionZoom && action && action.intensity > 0 && (action.actor || action.target)) {
    zoom = Math.min(ceiling, Math.max(minZoom, floorZoom, ceiling));
  } else {
    zoom = Math.min(ceiling, Math.max(minZoom, Math.max(zoomAll, floorZoom)));
  }

  return { x: focus.x, z: focus.z, zoom, zoomParty, zoomAll, foesFramed: zoom <= zoomAll };
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
  const WALL_H = 2.5;

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
 * Only the four quadrants of the current yaw are considered. An orthographic
 * dungeon drawn as pixel art has exactly four angles its walls, floors and
 * sprite sheets were authored for; stopping between them makes every surface in
 * the level read wrong, and gains almost nothing besides — with this aspect and
 * pitch the horizontal and vertical framing budgets differ by about 6%, so
 * there is no meaningful fit to be won by rotating. What rotating does win is
 * an unobstructed view, which is what this scores.
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
    action: port.action, actionZoom: port.actionZoom, actionZoomMax: port.actionZoomMax
  });
  if (!frame) return null;

  /* Focus: smooth dual-stage exponential filtering to eliminate jitter when switching subjects */
  const driftDist = Math.hypot(frame.x - (st.focusGoalX ?? frame.x), frame.z - (st.focusGoalZ ?? frame.z));
  if (st.focusGoalX == null || driftDist > CAM_FOCUS_DEADBAND) {
    const goalRate = (port.action && port.action.intensity > 0.1) ? 5.5 : 3.5;
    const gk = Math.min(1, dt * goalRate);
    st.focusGoalX = (st.focusGoalX ?? frame.x) + (frame.x - (st.focusGoalX ?? frame.x)) * gk;
    st.focusGoalZ = (st.focusGoalZ ?? frame.z) + (frame.z - (st.focusGoalZ ?? frame.z)) * gk;
  }
  const focusLerp = (port.action && port.action.intensity > 0.1) ? 3.0 : CAM_FOCUS_LERP;
  const fk = Math.min(1, dt * focusLerp);
  const x = port.targetX + (st.focusGoalX - port.targetX) * fk;
  const z = port.targetZ + (st.focusGoalZ - port.targetZ) * fk;

  /* Zoom: retarget only outside the deadband, approach faster during action */
  if (st.zoomGoal == null || zoomChanged(st.zoomGoal, frame.zoom)) st.zoomGoal = frame.zoom;
  const zoomLerp = (port.action && port.action.intensity > 0.1) ? 3.2 : CAM_ZOOM_LERP;
  const zk = Math.min(1, dt * zoomLerp);
  const zoom = port.zoom > 0
    ? port.zoom * Math.exp(Math.log(st.zoomGoal / port.zoom) * zk)
    : st.zoomGoal;

  /* Pitch: dynamically tilt to clear wall occlusions, or tilt flatter for action shots */
  const basePitch = port.restPitch ?? CAM_DEFAULT_PITCH;
  let targetPitch = basePitch;

  // Check entity occlusion at current yaw and base pitch
  const entities = port.entities || port.party || [];
  const occ = entityOcclusion(entities, port.yaw, targetPitch, port.isBlocked);

  if (occ.occludedCount > 0) {
    // Elevate camera to see over blocking walls
    targetPitch = Math.max(targetPitch, occ.minClearingPitch);
  } else if (port.action && port.action.intensity > 0) {
    // Lower tilt for cinematic action shots when clear of walls
    targetPitch = basePitch + (CAM_ACTION_PITCH - basePitch) * Math.min(1, port.action.intensity);
  } else if (frame.zoom < CAM_FIT_FLOOR_ZOOM + 1) {
    targetPitch = Math.min(1.1, basePitch + 0.08);
  }

  const pk = Math.min(1, dt * CAM_PITCH_LERP);
  const pitch = port.pitch > 0 ? port.pitch + (targetPitch - port.pitch) * pk : targetPitch;

  /* Turn cooldown timer */
  if (st.turnCooldown > 0) {
    st.turnCooldown = Math.max(0, st.turnCooldown - dt);
  }

  /* Yaw: a committed quarter-turn, never a continuous drift. Once a turn
     starts it runs to completion — reversing mid-swing on a flicker of the
     score is far more disorienting than the turn itself. */
  let yaw = port.yaw;
  if (port.autoRotate) {
    if (st.turnT != null) {
      st.turnT += dt;
      const u = Math.min(1, st.turnT / CAM_YAW_TURN);
      yaw = st.turnFrom + st.turnDelta * smoothstep(u);
      if (u >= 1) {
        st.turnT = null;
        st.dwell = 0;
        st.turnCooldown = CAM_TURN_COOLDOWN;
      }
    } else if (!st.turnCooldown || st.turnCooldown <= 0) {
      const act = port.action;
      const hasAction = !!(act && act.intensity > 0 && act.actor && act.target);
      const want = hasAction
        ? pickActionYaw(port.yaw, frame.x, frame.z, port.isBlocked, {
            actor: act.actor, target: act.target, entities,
            actionWeight: port.actionYawWeight ?? 2.0, pitch: port.pitch
          })
        : pickYaw(port.yaw, frame.x, frame.z, port.isBlocked, { entities, pitch: port.pitch });

      if (Math.abs(shortestTurn(port.yaw, want)) > 1e-6) {
        st.dwell = (st.dwell || 0) + dt;
        const requiredDwell = hasAction ? (port.combatDwell ?? CAM_COMBAT_YAW_DWELL) : (port.dwell ?? CAM_YAW_DWELL);
        if (st.dwell >= requiredDwell) {
          st.turnFrom = port.yaw;
          st.turnDelta = shortestTurn(port.yaw, want);
          st.turnT = 0;
        }
      } else {
        st.dwell = 0;      // the view cleared on its own; forget the candidate
      }
    }
  } else if (st.turnT != null) {
    st.turnT = null; st.dwell = 0;   // rotation switched off mid-turn
  }

  return { x, z, zoom, yaw, pitch, frame };
}

/** Drop any in-flight turn and zoom goal — on a new floor, or a camera snap. */
export function resetDirector(st) {
  st.zoomGoal = null; st.dwell = 0; st.turnT = null;
  st.turnFrom = 0; st.turnDelta = 0; st.turnCooldown = 0;
  st.focusGoalX = null; st.focusGoalZ = null;
}

