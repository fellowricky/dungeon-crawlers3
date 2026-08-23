/**
 * TRAILER STAGE — owns the level, the camera orbit, and the swap between
 * environments.
 *
 * Modeled on src/dungeon_editor.js, which already proves the pattern: import
 * the shipping renderer, forge a real dungeon, and drive the visual half of
 * the frame directly. game.init() is never called, so none of the game loop's
 * wall-clock or input assumptions apply.
 *
 * The one departure from the editor is time. dungeon_scene.tick() advances the
 * level's rise animation off a real THREE.Timer; the stage re-implements that
 * step against the trailer clock so a stall never eats animation frames.
 */
import * as THREE from 'three';
import { THEMES, TYPE, FLOOR, generateDungeon } from '../dungeon/dungeon_generator.js';
import {
  cam, camTarget, setYawPitch, buildScene, finishAnim, liveUpdate, renderFrame,
  writeInstancesAll, applyTorchSettings, applyThemeEnv, animEnd, meshes, scene
} from '../render/dungeon_scene.js';
import { gateReady } from './assets.js';
import { FORMATION } from './party.js';

/* tick() finishes the build-in a beat after animEnd; match it. */
const ANIM_TAIL = 0.35;
/* liveUpdate offsets the flame reveal behind the geometry rise by this much. */
const FLAME_LAG = 2.3;

/* Room types the generator drops a prop into the exact centre of: the entrance
   platform ring, the boss crystal (plus its brazier ring), the treasure chest,
   the shrine crystal. Filming in one of those walks the party straight through
   the prop, so they are never candidates. */
const CENTREPIECE_TYPES = new Set([TYPE.ENTRANCE, TYPE.BOSS, TYPE.TREASURE, TYPE.SHRINE]);

/* Props with no volume to clip into: floor decals, ground litter, and
   wall-mounted dressing. Heroes walk over these constantly in the real game and
   it reads fine.
   The list is a deliberate allowlist — anything the generator emits that is NOT
   named here counts as a blocker. An unknown prop being treated as solid costs
   a slightly more conservative lane; an unknown prop treated as flat puts a
   hero waist-deep in a coffin on camera. */
const NON_BLOCKING = new Set([
  /* flat on the floor */
  'moss', 'crack', 'debris', 'rug', 'magicCircle',
  /* ground litter, ankle height */
  'bones', 'bonePile', 'skull', 'skeleton',
  /* mounted on a wall, never on a walkable cell */
  'banner', 'tapestry', 'sconce', 'ossuaryWall', 'spiderWeb',
  'weaponRack', 'bookshelf'
]);

/* Clearance a hero needs from a blocker's centre before it reads as clipping. */
const BODY_CLEARANCE = 0.85;

/* Per-kind clearance. A single radius for every prop was wrong in the way that
   matters most: the overland themes scatter TREES as ordinary floor props, and
   dungeon_scene renders them at a 1.8x scale multiplier, so a trunk whose
   centre is a comfortable 1.0 units away still has the party inside its canopy.
   They tested clean and walked through a tree on camera.
   Values are the visible footprint, not the collision box the game would use —
   the question here is "does it look like they walked through it". */
const PROP_CLEARANCE = {
  /* the big offenders: scaled-up 3D scatter */
  tree: 2.2, tree_winter: 2.2, snowtree: 2.2, swamptree: 2.2, deadtree: 2.2,
  ring: 2.0,                       /* the entrance platform, not a prop as such */
  bossCrystal: 1.7, tent: 1.5,
  mushroomLog: 1.3, shrineCrystal: 1.2, sarco: 1.2, coffin: 1.2,
  pillarA: 1.1, pillarB: 1.1, rootsA: 1.1, rootsB: 1.1, roots: 1.1,
  rocks: 1.0, vinemound: 1.0, skulltotem: 1.0, goblinfire: 1.0, rack: 1.0,
  mushroomA: 1.0, mushroomB: 1.0, table: 1.0, statue: 1.0, brazier: 1.0,
  anvil: 1.0, icebone: 1.0, cairn: 0.95, stump: 0.95, bush: 0.95, wheel: 0.9,
  fren1: 0.9, fren2: 0.9, fren3: 0.9, fren4: 0.9,
  tombstone: 0.85, grave: 0.85, chest: 0.85, stakes: 0.8, bench: 0.8,
  shardIce: 0.8, icicle: 0.8, globe: 0.8, signpost: 0.75, brokenSignpost: 0.75,
  pillar: 0.75, barrel: 0.7, crate: 0.7, chair: 0.6, vase: 0.6, urn: 0.6,
  candle: 0.4
};
const MAX_CLEARANCE = Math.max(BODY_CLEARANCE, ...Object.values(PROP_CLEARANCE));
const CLEARANCE_CELLS = Math.ceil(MAX_CLEARANCE);

/* Props per 100 tiles a room should carry before it stops looking barren.
   Tuned against what the generator actually scatters: dungeon rooms reach
   5-10, but the overland zones are sparse by design and rarely clear 5, so
   aiming higher just distorts the room choice without finding anything. */
const TARGET_DRESSING = 5;

/* How much room to leave between the crossing and the room's walls, total
   across both ends. Generous on purpose: a crossing that uses the room's full
   width has the party bearing down on a wall as the beat ends, which reads as
   though they are about to walk into it. Leaving this much back keeps open
   floor ahead of them the whole way, and the camera orbit — not the distance
   travelled — carries the sense of movement.
   Tuned against room sizes the generator actually emits (9-22 per side): much
   above this and typical rooms leave so little run that the party has to be
   slowed to a shuffle to avoid overshooting. */
const WALL_MARGIN = 6;

/* ---- theme environment crossfade ---- */

const _cA = new THREE.Color(), _cB = new THREE.Color(), _cO = new THREE.Color();

/** Blend two colour values (hex number or '#rrggbb') and return a hex number. */
function mixColor(a, b, k) {
  _cA.set(a); _cB.set(b);
  return _cO.copy(_cA).lerp(_cB, k).getHex();
}
const mixNum = (a, b, k) => a + (b - a) * k;

/**
 * A theme-shaped object partway between two themes, for applyThemeEnv.
 *
 * buildScene applies the incoming theme's fog, background and lights in the
 * frame it is called, but the geometry takes ~2s to rise — so the world's
 * colour changed instantly while the world itself was still arriving. Feeding
 * applyThemeEnv a blend each frame puts the light on the same clock as the
 * stone.
 */
function blendTheme(a, b, k) {
  return {
    fog:    mixColor(a.fog, b.fog, k),
    fogD:   mixNum(a.fogD ?? 0.0025, b.fogD ?? 0.0025, k),
    bg:     mixColor(a.bg, b.bg, k),
    hemi:  [mixColor(a.hemi[0], b.hemi[0], k),
            mixColor(a.hemi[1], b.hemi[1], k),
            mixNum(a.hemi[2], b.hemi[2], k)],
    dir:   [mixColor(a.dir[0], b.dir[0], k), mixNum(a.dir[1], b.dir[1], k)],
    accent: '#' + mixColor(a.accent, b.accent, k).toString(16).padStart(6, '0')
  };
}

/** Lane offsets from a room's centre line, nearest first: 0, +1, -1, +2, -2 … */
function laneOffsets(reach, step = 0.5) {
  const out = [0];
  for (let v = step; v <= reach; v += step) out.push(v, -v);
  return out;
}

export class Stage {
  constructor({ party = null, orbit = {} } = {}) {
    this.party = party;
    this.D = null;

    this.orbit = {
      yaw: Math.PI / 4,
      speed: 0.10,          /* radians per second — a full turn in ~63s */
      pitch: 0.64,
      zoom: 10.0,           /* half-height = 55/zoom world units; 10 ~= 11 tiles */
      ...orbit
    };

    /* How hard the camera sticks to the leader. 0 = welded; a larger value
       trails so the walk has a little weight. Frame-rate independent. */
    this.followLag = 0.0;

    /* Sprites are anchored at the feet, so aiming at the leader's ground
       position hangs them above frame centre. Lift the aim point to roughly
       chest height and they sit centred. */
    this.focusHeight = 0.85;

    /* Longest the environment transition may take. The rise is time-scaled to
       land inside this, so a short beat never cuts it off mid-way. */
    this.riseSeconds = 2.0;

    /* Direction of travel, locked on the first forge and reused by every beat
       after it. See resolveHeading — this is what keeps the orbit reading as one
       continuous rotation instead of cutting at each environment change. */
    this.heading = null;

    /* Build-in animation clock, advanced by the trailer clock rather than by
       dungeon_scene's internal timer. */
    this.buildT = Infinity;
    this.building = false;
  }

  /**
   * Tear down the current level and raise a new one. The party is untouched:
   * disposeLevel() only removes the level group, and the party is parented to
   * the scene.
   *
   * `animate: false` snaps the level in fully settled (for the opening frame);
   * `true` plays the staggered rise, which is the environment transition.
   */
  async forge({ themeKey, seed = 1234, level = 1, roomCount = 16,
                animate = true, gate = true, walk = {} } = {}) {
    const params = { seed: seed >>> 0, themeKey, roomCount, level,
                     loopChance: 0.18, decorDensity: 1, threatMult: 1 };

    const prevTheme = this.themeKey ? THEMES[this.themeKey] : null;
    /* Declared before the environment fade below, which needs it. */
    const walkT = walk.seconds ?? 6;

    const d = generateDungeon(params.seed, params);
    this.D = d;
    buildScene(d);                       /* also calls applyThemeEnv for us */
    const TH = THEMES[themeKey] || THEMES.ancient;
    applyTorchSettings(TH);
    this.themeKey = themeKey;

    /* Fade the light from the old world to the new one over the same span the
       geometry takes to rise. Without this the palette cuts on one frame while
       the stone is still coming up, which reads as a hard edit. */
    if (animate && prevTheme && prevTheme !== TH) {
      this.envFrom = prevTheme;
      this.envTo = TH;
      this.envT = 0;
      this.envDur = Math.min(walkT * 0.7, this.riseSeconds);
      applyThemeEnv(blendTheme(prevTheme, TH, 0));
    } else {
      this.envFrom = this.envTo = null;
    }

    /* Pick a plain, roomy chamber with a clear corridor and lay the crossing out
       through it, so the party walks the life of the beat without meeting a
       pillar or the entrance platform. */
    const h = this.resolveHeading(walk.heading);
    /* Re-apply the beat's requested speed before fitting, so a previous beat
       that had to slow down for a tight room doesn't hold this one back. */
    if (this.party && walk.speed != null) this.party.setSpeed(walk.speed);
    const speed = this.party ? this.party.speed : 1.7;

    const pick = this.pickRoom(d, h, speed * walkT, walk.room || {});
    this.pick = pick;
    if (pick.cost > 0) {
      console.warn(`[trailer] ${themeKey}: no fully clear room — filming in ` +
                   `room ${pick.room.id} (${pick.room.w}x${pick.room.h}, cost ${pick.cost})`);
    }

    if (this.party) {
      /* The party marches for the whole beat at a constant speed, but the
         crossing was clamped to what the room can actually hold. Walk the
         requested speed in a room that fits, and ease off in one that doesn't,
         so they arrive at the far side exactly as the beat ends instead of
         strolling through the wall. */
      const fitted = pick.path.distance / walkT;
      if (fitted < this.party.speed - 1e-3) {
        console.log(`[trailer] ${themeKey}: room ${pick.room.id} fits ` +
                    `${pick.path.distance.toFixed(1)}u — walking at ` +
                    `${fitted.toFixed(2)}u/s instead of ${this.party.speed.toFixed(2)}`);
        this.party.setSpeed(fitted);
      }
      this.party.setHeading(h.hx, h.hz);
      this.party.placeAt(pick.path.x, pick.path.z);
      this.party.pose(walk.march === false ? 'idle' : 'walk');
      camTarget.set(pick.path.x, this.focusHeight, pick.path.z);
    } else {
      camTarget.set(pick.path.centre.x, this.focusHeight, pick.path.centre.z);
    }

    cam.zoom = this.orbit.zoom;
    cam.updateProjectionMatrix();
    setYawPitch(this.orbit.yaw, this.orbit.pitch);

    if (animate) {
      /* How long the rise ACTUALLY needs, read off the meshes that were just
         built rather than assumed.
         dungeon_scene stops the build at animEnd + 0.35 and calls settleAll(),
         which snaps every instance that has not finished to full size. Instance
         delays scale with BFS depth from the entrance, so on a big level the
         far geometry — and the torch flames, which liveUpdate holds back by a
         further FLAME_LAG — are still mid-rise when that cutoff hits. In game
         the fog of war hides it; on a fully revealed trailer level it reads as
         torches and scenery popping into frame. */
      this.buildTrue = this.riseDuration();

      /* Rather than let the beat run long, play the rise at whatever rate
         finishes it inside the window. Everything still animates in; it just
         arrives on time. */
      const want = Math.min(walkT * 0.7, this.riseSeconds);
      this.buildRate = this.buildTrue / want;
      this.buildWindow = want;
      this.buildT = 0;
      this.building = true;
    } else {
      finishAnim();
      this.buildT = Infinity;
      this.building = false;
    }

    /* Gate AFTER the scene exists so compileAsync sees the real material set. */
    if (gate) await gateReady({ label: `forge:${themeKey}` });
    return d;
  }

  /**
   * Resolve the direction of travel, LOCKING it for the whole shot.
   *
   * This is load-bearing. The camera's world yaw advances continuously, so what
   * the viewer reads is the angle between camera and party. Re-deriving the
   * heading per room snaps that relative angle on a beat boundary — a 20x20
   * room and a 19x21 room disagree by 90 degrees — and the shot cuts even
   * though the orbit never skipped a radian. Pick once, keep it, and the world
   * is the only thing that changes.
   */
  resolveHeading(explicit) {
    if (explicit) {
      const len = Math.hypot(explicit[0], explicit[1]) || 1;
      this.heading = { hx: explicit[0] / len, hz: explicit[1] / len };
    } else if (!this.heading) {
      this.heading = { hx: 1, hz: 0 };
    }
    return this.heading;
  }

  /**
   * Every prop in the level a hero would visibly clip through, bucketed by grid
   * cell. The lane search below tests thousands of sample points, so this has
   * to answer "is anything near here" in constant time rather than by scanning
   * the whole prop list.
   */
  blockers(d) {
    if (this._blockersFor === d) return this._blockers;
    const byCell = new Map();
    for (const p of d.props || []) {
      if (NON_BLOCKING.has(p.kind)) continue;
      const key = p.y * d.W + p.x;
      const at = byCell.get(key);
      const rec = { x: p.x - d.W / 2 + 0.5, z: p.y - d.H / 2 + 0.5, kind: p.kind };
      if (at) at.push(rec); else byCell.set(key, [rec]);
    }
    this._blockersFor = d;
    this._blockers = byCell;
    return byCell;
  }

  /**
   * Walk the whole party along a candidate path and count how many sample
   * positions land on something. Tests every OCCUPIED formation slot, not just
   * the leader — the followers trail behind and to the side, and they are the
   * ones that actually catch a pillar.
   *
   * `slots` is the live party's footprint, not the full FORMATION table. Using
   * the table would demand a lane wide enough for six heroes to film four, and
   * in a pillared room that rejects every plain chamber in the level.
   */
  pathCost(d, path, blockers, slots) {
    const { hx, hz } = path;
    const rx = hz, rz = -hx;                    /* the heading's right vector */
    let cost = 0;

    for (let s = 0; s <= path.distance; s += 0.5) {
      const lx = path.x + hx * s, lz = path.z + hz * s;
      for (const [ox, oz] of slots) {
        const px = lx + rx * ox + hx * oz;
        const pz = lz + rz * ox + hz * oz;

        /* Off the floor entirely (wall, void, or a liquid pool). */
        const gx = Math.round(px + d.W / 2 - 0.5);
        const gy = Math.round(pz + d.H / 2 - 0.5);
        if (gx < 0 || gy < 0 || gx >= d.W || gy >= d.H) { cost += 10; continue; }
        if (d.grid[gy * d.W + gx] !== FLOOR) { cost += 10; continue; }

        /* Walking through scenery. The search window has to cover the LARGEST
           clearance any prop asks for, not one cell — a tree three cells away
           still reaches the party. */
        let hit = false;
        for (let oy = -CLEARANCE_CELLS; oy <= CLEARANCE_CELLS && !hit; oy++) {
          for (let ox2 = -CLEARANCE_CELLS; ox2 <= CLEARANCE_CELLS && !hit; ox2++) {
            const bucket = blockers.get((gy + oy) * d.W + (gx + ox2));
            if (!bucket) continue;
            for (const b of bucket) {
              const r = PROP_CLEARANCE[b.kind] ?? BODY_CLEARANCE;
              const dx = b.x - px, dz = b.z - pz;
              if (dx * dx + dz * dz < r * r) { hit = true; break; }
            }
          }
        }
        if (hit) cost += 1;
      }
    }
    return cost;
  }

  /**
   * The distinct doorways of a room, in world coordinates.
   *
   * `d.doorway` is a per-cell flag, and a single opening spans two or three
   * adjacent cells, so the flagged cells touching this room are clustered into
   * openings before being averaged to a centre.
   */
  roomDoorways(d, room) {
    const key = `${d.seed}:${room.id}`;
    if (this._doorsFor === d && this._doors[key]) return this._doors[key];
    if (this._doorsFor !== d) { this._doorsFor = d; this._doors = {}; }

    const x0 = Math.max(0, Math.floor(room.cx - room.w / 2) - 2);
    const x1 = Math.min(d.W - 1, Math.ceil(room.cx + room.w / 2) + 2);
    const y0 = Math.max(0, Math.floor(room.cy - room.h / 2) - 2);
    const y1 = Math.min(d.H - 1, Math.ceil(room.cy + room.h / 2) + 2);

    const cells = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!d.doorway[y * d.W + x]) continue;
        /* Only openings that actually belong to this room. */
        let mine = false;
        for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= d.W || ny >= d.H) continue;
          if (d.roomId[ny * d.W + nx] === room.id) { mine = true; break; }
        }
        if (mine) cells.push([x, y]);
      }
    }

    /* Cluster touching cells into single openings. */
    const groups = [];
    for (const [x, y] of cells) {
      let g = groups.find(gr => gr.some(([gx, gy]) =>
        Math.abs(gx - x) <= 1 && Math.abs(gy - y) <= 1));
      if (g) g.push([x, y]); else groups.push([[x, y]]);
    }

    const out = groups.map(g => {
      const mx = g.reduce((a, c) => a + c[0], 0) / g.length;
      const my = g.reduce((a, c) => a + c[1], 0) / g.length;
      return { x: mx - d.W / 2 + 0.5, z: my - d.H / 2 + 0.5, cells: g.length };
    });
    this._doors[key] = out;
    return out;
  }

  /** A path of `distance` units ending at a given point, on the heading. */
  makePath(h, endX, endZ, distance, lateral, centre) {
    return {
      hx: h.hx, hz: h.hz, distance, lateral, centre,
      x: endX - h.hx * distance,
      z: endZ - h.hz * distance
    };
  }

  /**
   * Lay the walk out from the middle of the room toward the way out.
   *
   * The party STARTS at the room centre and walks toward the opening that lies
   * furthest along the heading — "the next room". Two reasons it works this way
   * rather than crossing the room end to end:
   *
   *  - A full crossing begins with the party backed against the trailing wall
   *    and the camera looking straight into it. Starting centred means they are
   *    never nearer a wall than half the room, which is most of the occlusion
   *    problem.
   *  - Walking toward an opening always reads as purposeful. Walking toward
   *    whatever masonry happens to be ahead does not.
   *
   * The heading stays locked shot-wide, so this picks the room whose way out
   * best agrees with it rather than turning the party to suit the architecture.
   */
  doorwayPath(d, room, h, distance) {
    const doors = this.roomDoorways(d, room);
    if (!doors.length) return [];

    const cx = room.cx - d.W / 2 + 0.5;
    const cz = room.cy - d.H / 2 + 0.5;
    const rx = h.hz, rz = -h.hx;
    const along = p => (p.x - cx) * h.hx + (p.z - cz) * h.hz;
    const perp  = p => (p.x - cx) * rx   + (p.z - cz) * rz;

    let exit = doors[0];
    for (const dr of doors) if (along(dr) > along(exit)) exit = dr;
    if (along(exit) < 2) return [];        /* nothing ahead worth walking to */

    /* Stop short of the threshold rather than standing in it. */
    const reach = along(exit) - 1.5;
    const dist = Math.max(1.5, Math.min(distance, reach));

    /* Bias the lane toward the opening without hugging it, so the walk drifts
       to the door instead of tracking one wall the whole way. */
    const lane = perp(exit) * 0.5;

    const out = [];
    for (const nudge of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      const lat = lane + nudge;
      out.push({
        hx: h.hx, hz: h.hz, distance: dist, lateral: lat,
        centre: { x: cx, z: cz },
        x: cx + rx * lat, z: cz + rz * lat,   /* START at the room centre */
        fit: reach,
        doorway: true,
        towards: { x: exit.x, z: exit.z }
      });
    }
    return out;
  }

  /**
   * A crossing of the room on this heading, shifted `lateral` units to the side
   * of the room's centre line.
   *
   * That offset is what makes a centrepiece survivable. Several themes — the
   * forest clearings especially — have no plain room at all: the generator
   * emits exactly four zones and every one is an entrance, shrine, treasure or
   * boss with a prop planted dead centre. Walking the centre line is guaranteed
   * to clip it. Walking a lane beside it puts the crystal in frame as scenery
   * instead, which is what you wanted anyway.
   */
  pathThrough(room, d, h, distance, lateral = 0) {
    const rx = h.hz, rz = -h.hx;                 /* the heading's right vector */
    const x = room.cx - d.W / 2 + 0.5 + rx * lateral;
    const z = room.cy - d.H / 2 + 0.5 + rz * lateral;
    /* Inscribed length of the room rectangle along (hx, hz), minus a margin so
       nobody finishes inside a wall. */
    const spanX = Math.abs(h.hx) > 1e-6 ? room.w / Math.abs(h.hx) : Infinity;
    const spanZ = Math.abs(h.hz) > 1e-6 ? room.h / Math.abs(h.hz) : Infinity;
    const fit = Math.max(2, Math.min(spanX, spanZ) - WALL_MARGIN);
    const dist = Math.min(distance, fit);
    return {
      hx: h.hx, hz: h.hz, distance: dist, fit, lateral,
      x: x - h.hx * dist / 2,
      z: z - h.hz * dist / 2,
      centre: { x, z }
    };
  }

  /**
   * The real end of the build-in: the latest any instance finishes, plus the
   * lag liveUpdate applies to flames.
   *
   * dungeon_scene stops the build at animEnd + 0.35 and calls settleAll(),
   * which snaps every unfinished instance to full size. Instance delays scale
   * with BFS depth from the entrance, so on a large level the far geometry —
   * and the torch flames, held back a further FLAME_LAG — are still rising when
   * that cutoff lands. In game the fog of war hides it; on a fully revealed
   * trailer level it reads as torches and scenery popping into frame.
   */
  riseDuration() {
    let done = animEnd;
    for (const k of Object.keys(meshes)) {
      const m = meshes[k];
      if (!m || !m.isInstancedMesh || !m.userData || !m.userData.set) continue;
      const set = m.userData.set;
      if (!set.delay || !set.n) continue;
      let mx = 0;
      for (let i = 0; i < set.n; i++) if (set.delay[i] > mx) mx = set.delay[i];
      done = Math.max(done, mx + (m.userData.dur || 0.42));
    }
    return done + FLAME_LAG + 0.2;
  }

  /**
   * Bring the world to its finished state immediately, off camera.
   *
   * The rise, the torch flames and the light fade all complete here rather than
   * during recorded frames. That is what stops torches and scenery popping in
   * mid-shot and the palette still shifting after the beat has started: by the
   * time the first frame of the beat is captured, nothing is left to arrive.
   *
   * The cost is that the world no longer builds itself on camera — beats become
   * cuts. Set `settle: false` on a beat to keep the rise visible instead.
   */
  settleNow() {
    finishAnim();
    this.building = false;
    this.buildT = Infinity;
    if (this.envTo) {
      applyThemeEnv(this.envTo);
      this.envFrom = this.envTo = null;
    }
    /* Flames and liquids at their settled size, not mid-reveal. */
    liveUpdate(this.lastT || 0, Infinity);
    if (this.party) this.party.update(0);
  }

  /** Live scene handles. A direct `import` of dungeon_scene can resolve to a
      second module instance after an HMR pass, which silently hands back a
      different camera; going through the stage always gets the real one. */
  debug() { return { cam, camTarget, meshes, scene, D: this.D, pick: this.pick }; }

  /**
   * How often the camera's view of the party is blocked over the course of the
   * beat.
   *
   * The camera orbits, so a lane that is clear from one side is behind a wall
   * from another — checking a single angle proves nothing. This marches from
   * the party toward the camera at several points along the walk and several
   * yaws across the arc the orbit will actually cover, counting solid cells in
   * the way. Trees count: on the overland themes the walls ARE trees, and they
   * are tall enough to sit right in front of the party.
   */
  occlusionCost(d, path, yaw0, yawSpan, samples = 3, angles = 5) {
    let blocked = 0;
    for (let si = 0; si < samples; si++) {
      const s = path.distance * (si / Math.max(1, samples - 1));
      const px = path.x + path.hx * s, pz = path.z + path.hz * s;
      for (let ai = 0; ai < angles; ai++) {
        const yaw = yaw0 + yawSpan * (ai / Math.max(1, angles - 1));
        /* Horizontal direction from the target toward the camera. */
        const dx = Math.sin(yaw), dz = Math.cos(yaw);
        for (let r = 1.5; r <= 7; r += 1.0) {
          const gx = Math.round(px + dx * r + d.W / 2 - 0.5);
          const gy = Math.round(pz + dz * r + d.H / 2 - 0.5);
          if (gx < 0 || gy < 0 || gx >= d.W || gy >= d.H) break;
          if (d.grid[gy * d.W + gx] !== FLOOR) { blocked++; break; }
        }
      }
    }
    return blocked / (samples * angles);      /* 0 = never blocked, 1 = always */
  }

  /**
   * How dressed the room is: props per unit of floor, ignoring the flat stuff.
   * A room with nothing in it reads as an unfinished grey box on camera, so a
   * little clutter is worth points — as long as none of it is ON the walk,
   * which the clip cost already handles separately.
   */
  dressing(d, room) {
    const blockers = this.blockers(d);
    const x0 = Math.floor(room.cx - room.w / 2), x1 = Math.ceil(room.cx + room.w / 2);
    const y0 = Math.floor(room.cy - room.h / 2), y1 = Math.ceil(room.cy + room.h / 2);
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const b = blockers.get(y * d.W + x);
        if (b) n += b.length;
      }
    }
    return n / Math.max(1, (room.w * room.h) / 100);   /* props per 100 tiles */
  }

  /**
   * Choose the room to film in, and the lane through it.
   *
   * Scored rather than filtered. An earlier version ranked rooms in tiers and
   * took the first tier that yielded a clean lane, which reliably picked a
   * cramped 9x10 chamber over a roomy one — a clean lane in a bad room beat a
   * good room outright, and the party ended up crawling to avoid walking into
   * the far wall. One score with explicit weights makes the trade visible and
   * tunable instead.
   */
  pickRoom(d, h, distance, opts = {}) {
    const W = {
      clip: 1000,        /* per sample where a hero intersects scenery or wall */
      centrepiece: 250,  /* room has a prop planted dead centre */
      short: 150,        /* per unit the room is too small for the full walk.
                            Heavy on purpose: a short route forces the party to
                            a shuffle to avoid overshooting, and a crawling
                            party reads worse than a slightly plainer room. */
      area: -0.05,       /* per square unit of floor, capped — bigger is better */
      cramped: 120,      /* per unit below the preferred minimum dimension */
      lateral: 0.05,     /* per unit off the room's centre line */
      noDoorway: 300,    /* blind crossing: no opening to aim at at all */
      occlusion: 900,    /* per unit of "camera view of the party is blocked" */
      barren: 12,        /* per prop-per-100-tiles BELOW the target dressing */
      /* `cramped` deliberately outweighs `noDoorway`: a doorway route is worth
         a lot, but not worth filming in a broom cupboard. At these weights a
         14x14 room with no usable pair still beats a 9x11 room that has one. */
      ...(opts.weights || {})
    };
    const minSize = opts.minSize ?? 14;

    const blockers = this.blockers(d);
    const n = this.party ? this.party.members.length : FORMATION.length;
    const slots = FORMATION.slice(0, n);

    /* The arc the orbit will sweep during this beat, so occlusion is judged
       over the angles the camera actually visits rather than one guess. */
    const yawSpan = (opts.yawSpan != null) ? opts.yawSpan : this.orbit.speed * 3;

    const pool = d.rooms.filter(r => !r.lake && !r.grave);
    if (!pool.length) return null;

    let best = null;
    for (const room of pool) {
      const centre = CENTREPIECE_TYPES.has(room.type) ? W.centrepiece : 0;
      const small = Math.max(0, minSize - Math.min(room.w, room.h)) * W.cramped;
      const area = Math.min(room.w * room.h, 400) * W.area;

      /* Candidate routes through this room. The doorway route comes first and
         is strongly preferred; the centred crossings are the fallback for rooms
         with no usable pair of openings — which is every overland zone, since
         those connect by open road rather than by doors. */
      const routes = [...this.doorwayPath(d, room, h, distance)];

      /* Sweep lanes out from the centre line, nearest first, so that all else
         equal the party walks as close to the middle of the room as a clean
         lane allows. */
      const reach = Math.max(2, Math.floor(Math.min(room.w, room.h) / 2) - 2);
      for (const lateral of laneOffsets(reach)) {
        routes.push(this.pathThrough(room, d, h, distance, lateral));
      }

      /* Rooms are scored for dressing once; it does not vary by lane. */
      const bare = Math.max(0, TARGET_DRESSING - this.dressing(d, room)) * W.barren;

      for (const path of routes) {
        const cost = this.pathCost(d, path, blockers, slots);
        const occ = this.occlusionCost(d, path, this.orbit.yaw, yawSpan);
        const score = cost * W.clip
                    + occ * W.occlusion
                    + centre + small + area + bare
                    + (path.doorway ? 0 : W.noDoorway)
                    + Math.max(0, distance - path.fit) * W.short
                    + Math.abs(path.lateral) * W.lateral;
        if (!best || score < best.score) best = { room, path, cost, occ, score };
      }
    }
    return best;
  }

  /**
   * One frame of stage time. Mirrors dungeon_scene.tick()'s visual half, but
   * every time value comes from the caller.
   */
  update(t, dt) {
    this.lastT = t;
    /* Order matters: move the party, re-aim the camera at where the leader now
       is, THEN let the party resolve its on-screen facing against that camera.
       Any other order costs a frame of lag in the sprite direction. */
    if (this.party) this.party.step(dt);

    if (this.party && this.party.leaderPos) {
      const { x, z } = this.party.leaderPos;
      if (this.followLag > 0) {
        const k = 1 - Math.exp(-dt / this.followLag);
        camTarget.x += (x - camTarget.x) * k;
        camTarget.z += (z - camTarget.z) * k;
        camTarget.y = this.focusHeight;
      } else {
        camTarget.set(x, this.focusHeight, z);
      }
    }

    /* Camera orbit. */
    this.orbit.yaw += dt * this.orbit.speed;
    setYawPitch(this.orbit.yaw, this.orbit.pitch);

    /* Level rise, on its own clock so it always completes. */
    if (this.building) {
      this.buildT += dt * this.buildRate;
      writeInstancesAll(this.buildT);
      if (this.buildT > this.buildTrue) {
        finishAnim();
        this.building = false;
        this.buildT = Infinity;
      }
    }

    /* Light follows the stone. */
    if (this.envTo) {
      this.envT += dt;
      const k = Math.min(1, this.envT / this.envDur);
      /* Ease so the change is quickest in the middle of the rise, matching how
         the geometry reads rather than running flat. */
      const e = k * k * (3 - 2 * k);
      applyThemeEnv(blendTheme(this.envFrom, this.envTo, e));
      if (k >= 1) { applyThemeEnv(this.envTo); this.envFrom = this.envTo = null; }
    }

    /* Torch flicker, liquids, particles. */
    liveUpdate(t, this.building ? this.buildT - FLAME_LAG : Infinity);

    if (this.party) this.party.update(dt);
  }

  render() { renderFrame(); }
}
