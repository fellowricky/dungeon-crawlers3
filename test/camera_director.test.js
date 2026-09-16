/* ─────────────── Automatic camera director ───────────────
 * The old director averaged the party's positions and ignored the fight
 * entirely, so a boss the party had backed away from — or half a flanking pack
 * — simply sat off-screen. These cover the three things the new one decides:
 * where to look, how far back to stand, and which way to face.
 *
 * All of it is exercised through the pure functions in camera_director.js, so
 * no renderer, canvas or scene is involved. The one thing that buys is that the
 * frame-to-frame state (zoom goal, dwell timer, in-flight turn) can be driven
 * directly, which is where a director actually goes wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  screenOffset, framingExtent, fitZoom, centroid, weightedFocus, frameCamera,
  occlusionScore, pickYaw, shortestTurn, zoomChanged, driveCamera, resetDirector, clampPull,
  actionEpicenter, blendFocus, actionAngleScore, pickActionYaw,
  CAM_PARTY_WEIGHT, CAM_FRAME_MARGIN, CAM_FIT_FLOOR_ZOOM, CAM_YAW_DWELL,
  CAM_YAW_TURN, CAM_YAW_MARGIN, CAM_OCCLUSION_TILES,
  CAM_ACTION_ZOOM_MAX, CAM_ACTION_MARGIN, CAM_COMBAT_YAW_DWELL, CAM_TURN_COOLDOWN,
  CAM_DEFAULT_PITCH, CAM_ACTION_PITCH, CAM_TACTICAL_PITCH,
  entityOcclusion, CAM_FREE_SECONDS, CAM_FOCUS_DEADBAND
} from '../src/game/camera_director.js';

/* The live camera's numbers, so the fit maths is checked at the shape of
   viewport the game actually renders into. */
const YAW = Math.PI / 4, PITCH = 0.64, BASE_HALF = 55, ASPECT = 16 / 9;
const MIN_ZOOM = 1.0, MAX_ZOOM = 14.0, DEFAULT_ZOOM = 9.67;

const fresh = () => ({ zoomGoal: null, dwell: 0, turnT: null, turnFrom: 0, turnDelta: 0 });

const port = (over = {}) => ({
  party: [], foes: [], focus: null,
  targetX: 0, targetZ: 0, zoom: DEFAULT_ZOOM, restZoom: DEFAULT_ZOOM,
  aspect: ASPECT, baseHalf: BASE_HALF, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
  yaw: YAW, pitch: PITCH, autoRotate: false, isBlocked: null,
  ...over
});

/** Run the director to convergence, feeding its own output back as the camera
 *  state — which is what the game does every frame. */
function settle(st, over = {}, seconds = 6, dt = 1 / 30) {
  let p = port(over), out = null;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    out = driveCamera(st, p, dt);
    if (!out) return null;
    p = { ...p, targetX: out.x, targetZ: out.z, zoom: out.zoom, yaw: out.yaw };
  }
  return { out, p };
}

describe('screen-space projection', () => {
  it('maps world XZ onto the camera axes, not onto the screen one-for-one', () => {
    // The whole point of projecting: at yaw 45° the world axes are diagonal on
    // screen, so a step "east" is not a step "right".
    const a = screenOffset(1, 0, 0, 0, 0, YAW, PITCH);
    expect(a.sx).toBeCloseTo(Math.cos(YAW), 6);
    expect(a.sy).toBeCloseTo(-Math.sin(PITCH) * Math.sin(YAW), 6);
  });

  it('foreshortens ground distance and keeps height nearly full size', () => {
    // Along the screen-vertical ground direction, distance costs sin(pitch)…
    const ground = screenOffset(Math.sin(YAW) * 10, 0, Math.cos(YAW) * 10, 0, 0, YAW, PITCH);
    expect(Math.abs(ground.sy)).toBeCloseTo(10 * Math.sin(PITCH), 5);
    expect(ground.sx).toBeCloseTo(0, 6);
    // …while height costs cos(pitch), which is why a body's head is framed
    // separately from its feet.
    const head = screenOffset(0, 2, 0, 0, 0, YAW, PITCH);
    expect(head.sy).toBeCloseTo(2 * Math.cos(PITCH), 6);
  });
});

describe('bounding box', () => {
  it('measures from the focus, not from the centre of the cloud', () => {
    // The focus is deliberately off-centre, and it is the focus that ends up in
    // the middle of the screen — so an extent fitted to the cloud would let the
    // far side fall outside the viewport.
    const pts = [{ x: 0, z: 0 }, { x: 10, z: 0 }];
    const atEnd = framingExtent(pts, 0, 0, YAW, PITCH);
    const atMid = framingExtent(pts, 5, 0, YAW, PITCH);
    expect(atEnd.hx).toBeGreaterThan(atMid.hx);
  });

  it('includes the tops of bodies, so heads are not cropped', () => {
    const feetOnly = framingExtent([{ x: 0, z: 0, h: 0 }], 0, 0, YAW, PITCH);
    const whole    = framingExtent([{ x: 0, z: 0, h: 2.4 }], 0, 0, YAW, PITCH);
    expect(feetOnly.hy).toBeCloseTo(0, 6);
    expect(whole.hy).toBeGreaterThan(1.9);   // 2.4 * cos(0.64)
  });

  it('grows with the spread of the group', () => {
    const tight = framingExtent([{ x: 0, z: 0 }, { x: 1, z: 1 }], 0.5, 0.5, YAW, PITCH);
    const wide  = framingExtent([{ x: 0, z: 0 }, { x: 30, z: 30 }], 15, 15, YAW, PITCH);
    expect(wide.hx + wide.hy).toBeGreaterThan(tight.hx + tight.hy);
  });
});

describe('zoom fitting', () => {
  it('leaves the requested margin outside the box', () => {
    // A box exactly as tall as the viewport must NOT fit — the margin is the
    // difference between "on screen" and "jammed against the edge".
    const half = BASE_HALF / DEFAULT_ZOOM;
    expect(fitZoom(0, half, ASPECT, BASE_HALF, 0)).toBeCloseTo(DEFAULT_ZOOM, 6);
    expect(fitZoom(0, half, ASPECT, BASE_HALF, CAM_FRAME_MARGIN)).toBeLessThan(DEFAULT_ZOOM);
  });

  it('lets the tighter axis decide', () => {
    const wide = fitZoom(40, 1, ASPECT, BASE_HALF);
    const tall = fitZoom(1, 40, ASPECT, BASE_HALF);
    // Same extent on either axis, but the viewport is wider than it is tall, so
    // the vertical case is the tighter fit.
    expect(tall).toBeLessThan(wide);
  });

  it('reports a solved zoom that actually contains the box', () => {
    const pts = [{ x: 0, z: 0 }, { x: 18, z: -7 }, { x: -4, z: 12 }];
    const f = centroid(pts);
    const e = framingExtent(pts, f.x, f.z, YAW, PITCH);
    const z = fitZoom(e.hx, e.hy, ASPECT, BASE_HALF);
    expect(e.hx).toBeLessThanOrEqual((BASE_HALF * ASPECT) / z);
    expect(e.hy).toBeLessThanOrEqual(BASE_HALF / z);
  });
});

describe('weighted focus', () => {
  it('gives the party the larger share', () => {
    const f = weightedFocus([{ x: 0, z: 0 }], [{ x: 10, z: 0 }]);
    expect(f.x).toBeCloseTo(10 * (1 - CAM_PARTY_WEIGHT), 6);
    expect(f.x).toBeLessThan(5);        // nearer the party than the midpoint
  });

  it('is unmoved by how MANY monsters there are', () => {
    // The failure the weighting exists to prevent: a bounding-box centre with
    // six goblins on one side sits among the goblins. Weighting by side means
    // one straggler and a whole pack at the same place pull identically.
    const party = [{ x: 0, z: 0 }];
    const one = weightedFocus(party, [{ x: 20, z: 0 }]);
    const many = weightedFocus(party, Array.from({ length: 8 }, () => ({ x: 20, z: 0 })));
    expect(many.x).toBeCloseTo(one.x, 6);
  });

  it('falls back cleanly at both ends', () => {
    expect(weightedFocus([{ x: 3, z: 4 }], [])).toEqual({ x: 3, z: 4 });
    expect(weightedFocus([], [{ x: 3, z: 4 }])).toEqual({ x: 3, z: 4 });
    expect(weightedFocus([], [])).toBeNull();
  });
});

describe('frameCamera', () => {
  const party = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 0, z: 2 }, { x: 2, z: 2 }];

  it('pulls back to bring a distant enemy into frame', () => {
    const quiet = frameCamera({ party, foes: [], aspect: ASPECT, restZoom: DEFAULT_ZOOM });
    const fight = frameCamera({ party, foes: [{ x: 22, z: 4 }], aspect: ASPECT, restZoom: DEFAULT_ZOOM });
    expect(quiet.zoom).toBeCloseTo(DEFAULT_ZOOM, 6);   // nothing to fit: rest zoom
    expect(fight.zoom).toBeLessThan(quiet.zoom);
    expect(fight.foesFramed).toBe(true);
  });

  it('never zooms in past the zoom the player chose', () => {
    // A lone hero fits at any zoom; without this rule the director would rush
    // all the way to MAX and override a deliberate choice to pull back.
    const solo = frameCamera({ party: [{ x: 0, z: 0 }], foes: [], aspect: ASPECT, restZoom: 4 });
    expect(solo.zoom).toBeCloseTo(4, 6);
    expect(solo.zoomParty).toBeGreaterThan(4);   // it *could* have gone closer
  });

  it('keeps every hero framed even when that means losing the monsters', () => {
    // Party spread across the floor AND an enemy beyond them: something has to
    // give, and it is never a hero.
    const spread = [{ x: -30, z: -30 }, { x: 30, z: 30 }];
    const r = frameCamera({ party: spread, foes: [{ x: 90, z: 90 }], aspect: ASPECT,
                            restZoom: DEFAULT_ZOOM, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM });
    expect(r.zoom).toBeLessThanOrEqual(r.zoomParty + 1e-9);
    expect(r.foesFramed).toBe(false);
    // and the heroes really are inside the frustum at that zoom
    const e = framingExtent(spread, r.x, r.z, YAW, PITCH);
    expect(e.hx).toBeLessThanOrEqual((BASE_HALF * ASPECT) / r.zoom);
    expect(e.hy).toBeLessThanOrEqual(BASE_HALF / r.zoom);
  });

  it('refuses to shrink the party to ants for one far-off straggler', () => {
    const r = frameCamera({ party, foes: [{ x: 120, z: 120 }], aspect: ASPECT,
                            restZoom: DEFAULT_ZOOM, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM });
    expect(r.zoom).toBeCloseTo(CAM_FIT_FLOOR_ZOOM, 6);
    expect(r.foesFramed).toBe(false);
  });

  it('honours an explicit focus so exploration still leads on the leader', () => {
    const r = frameCamera({ party, foes: [], focus: { x: 2, z: 2 }, aspect: ASPECT,
                            restZoom: DEFAULT_ZOOM });
    expect(r.x).toBe(2);
    expect(r.z).toBe(2);
  });

  it('returns null when there is nobody to look at', () => {
    expect(frameCamera({ party: [], foes: [] })).toBeNull();
  });
});

describe('clamping the pull toward the fight', () => {
  const party = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 0, z: 2 }, { x: 2, z: 2 }];
  const pc = centroid(party);
  const opts = { aspect: ASPECT, baseHalf: BASE_HALF, yaw: YAW, pitch: PITCH,
                 budgetZoom: CAM_FIT_FLOOR_ZOOM };

  it('leaves a modest pull completely alone', () => {
    const want = weightedFocus(party, [{ x: 12, z: 12 }]);
    const got = clampPull(pc, want, party, opts);
    expect(got.x).toBeCloseTo(want.x, 6);
    expect(got.z).toBeCloseTo(want.z, 6);
  });

  it('shortens a pull that would push the party out of frame', () => {
    const want = weightedFocus(party, [{ x: 200, z: 200 }]);
    const got = clampPull(pc, want, party, opts);
    expect(Math.hypot(got.x - pc.x, got.z - pc.z))
      .toBeLessThan(Math.hypot(want.x - pc.x, want.z - pc.z));
    // and the party genuinely fits at the budget zoom around the clamped point
    const e = framingExtent(party, got.x, got.z, YAW, PITCH);
    expect(e.hx + CAM_FRAME_MARGIN).toBeLessThanOrEqual((BASE_HALF * ASPECT) / CAM_FIT_FLOOR_ZOOM + 1e-9);
    expect(e.hy + CAM_FRAME_MARGIN).toBeLessThanOrEqual(BASE_HALF / CAM_FIT_FLOOR_ZOOM + 1e-9);
  });

  it('eases as the enemy retreats rather than snapping at a threshold', () => {
    // This is the reason the pull is solved instead of switched off: the focus
    // must be a continuous function of where the monster is standing.
    let prev = 0;
    for (let d = 10; d <= 300; d += 10) {
      const got = clampPull(pc, weightedFocus(party, [{ x: d, z: d }]), party, opts);
      const off = Math.hypot(got.x - pc.x, got.z - pc.z);
      expect(off).toBeGreaterThanOrEqual(prev - 1e-9);   // monotone…
      expect(off - prev).toBeLessThan(6);                // …and never a jump
      prev = off;
    }
  });

  it('collapses onto the party when the party alone already fills the frame', () => {
    const spread = [{ x: -40, z: -40 }, { x: 40, z: 40 }];
    const sc = centroid(spread);
    const got = clampPull(sc, weightedFocus(spread, [{ x: 100, z: 100 }]), spread, opts);
    expect(got.x).toBeCloseTo(sc.x, 6);
    expect(got.z).toBeCloseTo(sc.z, 6);
  });
});

describe('occlusion scoring', () => {
  /* A wall running along one side of the party, at the tiles the camera would
     have to look over from the north-east. */
  const wallAtNE = (x, z) => x > 1.5 && z > 1.5;

  it('counts scenery on the camera side only', () => {
    const ne = occlusionScore(0, 0, Math.PI / 4, wallAtNE);
    const sw = occlusionScore(0, 0, Math.PI / 4 + Math.PI, wallAtNE);
    expect(ne).toBeGreaterThan(0);
    expect(sw).toBe(0);
  });

  it('is zero with nothing in the way, and finite with everything in the way', () => {
    expect(occlusionScore(0, 0, YAW, () => false)).toBe(0);
    expect(occlusionScore(0, 0, YAW, () => true))
      .toBeLessThanOrEqual(Math.round(CAM_OCCLUSION_TILES / 0.5));
  });

  it('scores nothing when it has no way to ask about the map', () => {
    expect(occlusionScore(0, 0, YAW, null)).toBe(0);
  });
});

describe('yaw selection', () => {
  const wallAtNE = (x, z) => x > 1.5 && z > 1.5;

  it('stays put when the view is already clear', () => {
    expect(pickYaw(YAW, 0, 0, () => false)).toBe(YAW);
  });

  it('turns away from a wall standing in front of the party', () => {
    const picked = pickYaw(YAW, 0, 0, wallAtNE);
    expect(picked).not.toBe(YAW);
    expect(occlusionScore(0, 0, picked, wallAtNE)).toBeLessThan(occlusionScore(0, 0, YAW, wallAtNE));
  });

  it('only ever offers a quarter turn, so the isometric art stays square on', () => {
    const picked = pickYaw(YAW, 0, 0, wallAtNE);
    const quarters = Math.abs(shortestTurn(YAW, picked)) / (Math.PI / 2);
    expect(quarters).toBeCloseTo(Math.round(quarters), 6);
  });

  it('ignores an improvement too small to be worth the turn', () => {
    // One pillar in the sight line is not a reason to swing the whole camera.
    let calls = 0;
    const onePillar = () => (++calls === 1);   // exactly one blocker, on the first probe
    expect(pickYaw(YAW, 0, 0, onePillar)).toBe(YAW);
    expect(CAM_YAW_MARGIN).toBeGreaterThan(1);
  });

  it('takes the short way round', () => {
    expect(shortestTurn(0, Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2, 6);
    expect(shortestTurn(0.1, 0.1 + Math.PI * 2)).toBeCloseTo(0, 6);
  });
});

describe('smoothing', () => {
  it('ignores a change too small to be worth re-aiming for', () => {
    expect(zoomChanged(8, 8.1)).toBe(false);     // a monster taking one step
    expect(zoomChanged(8, 12)).toBe(true);
  });

  it('eases onto the fitted zoom rather than snapping', () => {
    const st = fresh();
    const p = port({ party: [{ x: 0, z: 0 }], foes: [{ x: 30, z: 0 }] });
    const first = driveCamera(st, p, 1 / 30);
    expect(first.zoom).toBeLessThan(DEFAULT_ZOOM);          // heading out…
    expect(first.zoom).toBeGreaterThan(st.zoomGoal);        // …but nowhere near there yet

    const done = settle(fresh(), { party: p.party, foes: p.foes });
    expect(done.out.zoom).toBeCloseTo(st.zoomGoal, 2);
  });

  it('returns to the player\'s zoom once the fight is over', () => {
    const st = fresh();
    settle(st, { party: [{ x: 0, z: 0 }], foes: [{ x: 30, z: 0 }] });
    const after = settle(st, { party: [{ x: 0, z: 0 }], foes: [], zoom: 4, restZoom: DEFAULT_ZOOM });
    expect(after.out.zoom).toBeCloseTo(DEFAULT_ZOOM, 2);
  });

  it('slides the focus toward the target instead of cutting to it', () => {
    const out = driveCamera(fresh(), port({ party: [{ x: 20, z: 20 }], targetX: 0, targetZ: 0 }), 1 / 30);
    expect(out.x).toBeGreaterThan(0);
    expect(out.x).toBeLessThan(4);
    const settled = settle(fresh(), { party: [{ x: 20, z: 20 }] });
    expect(settled.out.x).toBeCloseTo(20, 1);
  });
});

describe('committed quarter turns', () => {
  const wallAtNE = (x, z) => x > 1.5 && z > 1.5;
  const rotating = () => port({
    party: [{ x: 0, z: 0 }], autoRotate: true, isBlocked: wallAtNE
  });

  it('waits out the dwell before committing', () => {
    const st = fresh();
    let p = rotating(), out;
    for (let i = 0; i < Math.round((CAM_YAW_DWELL - 0.2) / (1 / 30)); i++) {
      out = driveCamera(st, p, 1 / 30);
      p = { ...p, yaw: out.yaw };
    }
    expect(out.yaw).toBeCloseTo(YAW, 9);   // still hasn't moved
    expect(st.dwell).toBeGreaterThan(0);   // but it is counting
  });

  it('completes the turn once committed', () => {
    const st = fresh();
    let p = rotating(), out;
    for (let i = 0; i < Math.round((CAM_YAW_DWELL + CAM_YAW_TURN + 0.5) / (1 / 30)); i++) {
      out = driveCamera(st, p, 1 / 30);
      p = { ...p, yaw: out.yaw };
    }
    const quarters = Math.abs(shortestTurn(YAW, out.yaw)) / (Math.PI / 2);
    expect(quarters).toBeCloseTo(1, 3);
    expect(st.turnT).toBeNull();
    expect(occlusionScore(0, 0, out.yaw, wallAtNE)).toBe(0);
  });

  it('forgets the candidate if the view clears before the dwell elapses', () => {
    // The party walks out from behind the pillar — no reason to turn any more.
    const st = fresh();
    let p = rotating();
    for (let i = 0; i < 30; i++) { const o = driveCamera(st, p, 1 / 30); p = { ...p, yaw: o.yaw }; }
    expect(st.dwell).toBeGreaterThan(0);
    driveCamera(st, { ...p, isBlocked: () => false }, 1 / 30);
    expect(st.dwell).toBe(0);
    expect(st.turnT).toBeNull();
  });

  it('never turns at all when rotation is switched off', () => {
    const st = fresh();
    let p = port({ party: [{ x: 0, z: 0 }], autoRotate: false, isBlocked: wallAtNE }), out;
    for (let i = 0; i < 300; i++) { out = driveCamera(st, p, 1 / 30); p = { ...p, yaw: out.yaw }; }
    expect(out.yaw).toBeCloseTo(YAW, 9);
  });

  it('abandons an in-flight turn if rotation is switched off mid-swing', () => {
    const st = fresh();
    let p = rotating(), out;
    for (let i = 0; i < Math.round((CAM_YAW_DWELL + 0.3) / (1 / 30)); i++) {
      out = driveCamera(st, p, 1 / 30);
      p = { ...p, yaw: out.yaw };
    }
    expect(st.turnT).not.toBeNull();                    // mid-turn
    driveCamera(st, { ...p, autoRotate: false }, 1 / 30);
    expect(st.turnT).toBeNull();
  });

  it('resetDirector clears everything a new floor invalidates', () => {
    const st = fresh();
    settle(st, { party: [{ x: 0, z: 0 }], foes: [{ x: 30, z: 0 }] });
    expect(st.zoomGoal).not.toBeNull();
    resetDirector(st);
    expect(st.zoomGoal).toBeNull();
    expect(st.turnT).toBeNull();
    expect(st.dwell).toBe(0);
    expect(st.turnCooldown).toBe(0);
  });
});

describe('action focus and epicenter', () => {
  it('computes midpoint between actor and target', () => {
    const epic = actionEpicenter({ x: 10, z: 2 }, { x: 20, z: 6 });
    expect(epic.x).toBe(15);
    expect(epic.z).toBe(4);
  });

  it('handles null target gracefully', () => {
    const epic = actionEpicenter({ x: 5, z: 8 }, null);
    expect(epic.x).toBe(5);
    expect(epic.z).toBe(8);
  });

  it('blends focus toward action epicenter smoothly by weight', () => {
    const base = { x: 0, z: 0 };
    const epic = { x: 10, z: 10 };
    const half = blendFocus(base, epic, 0.5);
    expect(half.x).toBeCloseTo(5);
    expect(half.z).toBeCloseTo(5);

    const full = blendFocus(base, epic, 1.0);
    expect(full.x).toBeCloseTo(10);
    expect(full.z).toBeCloseTo(10);
  });
});

describe('tighter action punch-in zoom', () => {
  const party = [{ x: 0, z: 0 }];
  const foes = [{ x: 3, z: 0 }];

  it('punches in closer than restZoom when actionZoom is active', () => {
    const normal = frameCamera({
      party, foes, restZoom: 9.67, actionZoom: false
    });
    expect(normal.zoom).toBeLessThanOrEqual(9.67);

    const punch = frameCamera({
      party, foes, restZoom: 9.67, actionZoom: true,
      action: {
        actor: party[0], target: foes[0], intensity: 1.0
      }
    });
    // With tight combatants right next to each other, punch-in zoom exceeds restZoom
    expect(punch.zoom).toBeGreaterThan(9.67);
    expect(punch.zoom).toBeLessThanOrEqual(CAM_ACTION_ZOOM_MAX);
  });

  it('never crops any party member even during full action punch', () => {
    // Two heroes spread 15 units apart
    const wideParty = [{ x: -8, z: 0 }, { x: 8, z: 0 }];
    const target = { x: -6, z: 0 };
    const punch = frameCamera({
      party: wideParty, foes: [target], restZoom: 6.0, actionZoom: true,
      action: { actor: wideParty[0], target, intensity: 1.0 }
    });
    // Must respect zoomParty so hero at x=8 is not cropped
    expect(punch.zoom).toBeLessThanOrEqual(punch.zoomParty + 1e-6);
  });

  it('eases back to normal restZoom ceiling as action intensity reaches 0', () => {
    const punch0 = frameCamera({
      party, foes, restZoom: 9.67, actionZoom: true,
      action: { actor: party[0], target: foes[0], intensity: 0.0 }
    });
    expect(punch0.zoom).toBeCloseTo(9.67, 2);
  });
});

describe('line-of-action angle scoring', () => {
  const actor = { x: 0, z: 0 };
  const target = { x: 10, z: 0 }; // Line of action is along world X (dx=10, dz=0)

  it('scores side-view perpendicular angle highest', () => {
    // yaw = 0 looks along Z; screen right is (1, 0, 0), which matches dx=10 perfectly!
    const side = actionAngleScore(0, actor, target);
    expect(side).toBeCloseTo(1.0, 5);

    // yaw = pi/2 looks along X; screen right is (0, 0, -1), giving 0 horizontal separation
    const front = actionAngleScore(Math.PI / 2, actor, target);
    expect(front).toBeCloseTo(0.0, 5);
  });

  it('pickActionYaw selects the quadrant with best horizontal separation', () => {
    // Current yaw is looking down the line (pi/2)
    const best = pickActionYaw(Math.PI / 2, 5, 0, () => false, {
      actor, target, actionWeight: 2.0
    });
    // Should rotate a quarter turn to 0 or pi to get the clear side-on view
    const diff = Math.abs(shortestTurn(Math.PI / 2, best));
    expect(diff).toBeCloseTo(Math.PI / 2, 3);
  });
});

describe('action-driven camera drive', () => {
  it('uses faster combat dwell when action presents a cooler angle', () => {
    const st = fresh();
    const actor = { x: 0, z: 0 };
    const target = { x: 10, z: 0 };
    const p = port({
      party: [actor], foes: [target],
      yaw: Math.PI / 2, autoRotate: true,
      action: { actor, target, intensity: 1.0 }
    });

    let out = null;
    // Step forward past CAM_COMBAT_YAW_DWELL (0.8s)
    for (let i = 0; i < Math.round((CAM_COMBAT_YAW_DWELL + 0.1) / (1 / 30)); i++) {
      out = driveCamera(st, p, 1 / 30);
      p.yaw = out.yaw;
    }
    // Turn should have initiated!
    expect(st.turnT).not.toBeNull();
  });

  it('sets turnCooldown after completing turn to prevent erratic spinning', () => {
    const st = fresh();
    const actor = { x: 0, z: 0 };
    const target = { x: 10, z: 0 };
    const p = port({
      party: [actor], foes: [target],
      yaw: Math.PI / 2, autoRotate: true,
      action: { actor, target, intensity: 1.0 }
    });

    // Complete the full dwell + turn
    for (let i = 0; i < Math.round((CAM_COMBAT_YAW_DWELL + CAM_YAW_TURN + 0.5) / (1 / 30)); i++) {
      const out = driveCamera(st, p, 1 / 30);
      p.yaw = out.yaw;
    }

    expect(st.turnT).toBeNull();
    expect(st.turnCooldown).toBeGreaterThan(0);
    expect(st.turnCooldown).toBeLessThanOrEqual(CAM_TURN_COOLDOWN);
  });
});

describe('camera tilt (pitch) control', () => {
  it('tilts lower into dynamic action pitch during active clash', () => {
    const st = fresh();
    const actor = { x: 0, z: 0 };
    const target = { x: 2, z: 0 };
    const p = port({
      party: [actor], foes: [target],
      pitch: CAM_DEFAULT_PITCH,
      action: { actor, target, intensity: 1.0 }
    });

    let currentPitch = CAM_DEFAULT_PITCH;
    for (let i = 0; i < 30; i++) {
      const out = driveCamera(st, { ...p, pitch: currentPitch }, 1 / 30);
      currentPitch = out.pitch;
    }

    // Pitch should have lowered toward CAM_ACTION_PITCH (0.52) for cinematic action shot
    expect(currentPitch).toBeLessThan(CAM_DEFAULT_PITCH);
    expect(currentPitch).toBeCloseTo(CAM_ACTION_PITCH, 1);
  });

  it('tilts up into tactical overhead pitch when camera is zoomed out wide', () => {
    const st = fresh();
    const p = port({
      party: [{ x: 0, z: 0 }], foes: [{ x: 40, z: 0 }], // Forces wide pull-back
      pitch: CAM_DEFAULT_PITCH,
      action: null
    });

    let currentPitch = CAM_DEFAULT_PITCH;
    for (let i = 0; i < 60; i++) {
      const out = driveCamera(st, { ...p, pitch: currentPitch }, 1 / 30);
      currentPitch = out.pitch;
    }

    // When pulled back wide, pitch tilts steeper to see over walls
    expect(currentPitch).toBeGreaterThan(CAM_DEFAULT_PITCH);
  });

  it('elevates pitch (height) to look over walls when entities are occluded', () => {
    const st = fresh();
    const hero = { x: 10, z: 10 };
    // At yaw = 0, camera is at z = +220 looking toward -Z.
    // Ray towards camera eye is (sin(0), cos(0)) = (0, 1), so walls in front of hero are at (10, 10 + t)
    const wallAtZ13 = (x, z) => (x === 10 && z === 13); // wall 3 tiles in front of hero
    const p = port({
      party: [hero], foes: [],
      entities: [hero],
      yaw: 0,
      pitch: CAM_ACTION_PITCH,
      isBlocked: wallAtZ13
    });

    let currentPitch = CAM_ACTION_PITCH;
    for (let i = 0; i < 40; i++) {
      const out = driveCamera(st, { ...p, pitch: currentPitch }, 1 / 30);
      currentPitch = out.pitch;
    }

    // Camera pitch should rise above action pitch to look over the wall at z=13
    expect(currentPitch).toBeGreaterThan(CAM_ACTION_PITCH);
  });
});

describe('multi-entity wall occlusion', () => {
  it('detects when walls block an entity sightline to the camera eye', () => {
    const hero = { x: 5, z: 5 };
    // At yaw = 0, ray to camera is in +Z direction
    const isBlocked = (x, z) => (x === 5 && z === 7); // wall 2 tiles in front
    const occ = entityOcclusion([hero], 0, 0.52, isBlocked);
    expect(occ.occludedCount).toBe(1);
    expect(occ.severity).toBeGreaterThan(0);
    // Clearing pitch should be steep enough to look over the wall
    expect(occ.minClearingPitch).toBeGreaterThan(0.52);
  });

  it('reports zero occlusion when sightline is clear', () => {
    const hero = { x: 5, z: 5 };
    const isBlocked = () => false;
    const occ = entityOcclusion([hero], 0, 0.52, isBlocked);
    expect(occ.occludedCount).toBe(0);
    expect(occ.severity).toBe(0);
  });
});

describe('focus smoothing & manual control timeout', () => {
  it('ignores micro-drift below CAM_FOCUS_DEADBAND to prevent idle jitter', () => {
    const st = fresh();
    const hero = { x: 10, z: 10 };
    const p = port({ party: [hero], focus: { x: 10, z: 10 }, targetX: 10, targetZ: 10 });
    const out1 = driveCamera(st, p, 1 / 30);

    // Subtle drift of 0.05 units (e.g. idle breathing)
    const pDrift = { ...p, focus: { x: 10.05, z: 10.05 }, targetX: out1.x, targetZ: out1.z };
    const out2 = driveCamera(st, pDrift, 1 / 30);

    // Should remain steady at 10 without drifting
    expect(out2.x).toBeCloseTo(10.0, 2);
    expect(out2.z).toBeCloseTo(10.0, 2);
  });

  it('provides a generous 7.0s manual control grace period', () => {
    expect(CAM_FREE_SECONDS).toBe(7.0);
  });
});
