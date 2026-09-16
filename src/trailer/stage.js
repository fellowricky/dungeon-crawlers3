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
import { heightOf, STEP, groundY } from '../dungeon/elevation.js';
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

/* Props stripped from the level before it is built, for the trailer only.
   The boss crystal is the one thing on a level that is a story beat rather than
   scenery: it plants a red glow and its rubble ring dead centre of the best
   room on the map, which is exactly the room the scorer wants to film in.
   Removing it from `d.props` rather than hiding the mesh is deliberate — the
   lane search reads the same prop list, so a hidden-but-present crystal would
   still push the party into a detour around something the viewer cannot see. */
const HIDDEN_PROPS = new Set(['bossCrystal']);

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
  bossCrystal: 1.7, tent: 1.5,   /* crystal is in HIDDEN_PROPS; kept for
                                    whoever stops hiding it */
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
   5-10, so asking for 7 picks out the dressed end of that range. The overland
   zones are sparse by design and rarely clear 5 — they simply pay the barren
   cost uniformly, which leaves their room choice decided by the other terms
   rather than distorted by one nothing can satisfy. */
const TARGET_DRESSING = 7;

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

/* Open floor the party should still have IN FRONT of them when the beat ends.
   The crossing is fitted to the room, so without this the walk can finish with
   a wall filling the screen ahead — which reads as "they are about to stop",
   even though the beat cuts away first. Measured from the end of the walk,
   along the heading. */
const RUNOUT_WANT = 7;

/* The least of the requested crossing a route may cover before it stops being
   a route. The party's speed is fitted to whatever the room allows, so a short
   route does not overshoot — it just slows everyone to a shuffle, and the LPC
   walk cycle is drawn for ~1.8 u/s. At 0.6 the slowest fitted pace is ~1.0
   u/s, which still reads as walking. */
const MIN_ROUTE_FRACTION = 0.6;

/* Occluder heights, in world units, MEASURED off the built meshes rather than
   guessed: a dungeon wall box plus its cap tops out at 2.38, and the overland
   themes render their walls as trees at a 1.8x scale multiplier, which reach
   5.5. The difference is the whole reason one radius could not serve both. */
const WALL_TOP = 2.4;
const TREE_TOP = 5.5;

/* Height on a hero the camera has to be able to see for the shot to work.
   Roughly the chest: the feet being clipped by a low wall in the foreground is
   normal framing, the torso vanishing is not. */
const CHEST = 1.0;

/* Prop tops, for the same sight-line test. Only the tall ones are listed —
   at the trailer's camera angle anything below about waist height cannot hide
   a hero standing behind it, so the default is deliberately short and the
   table names the things that genuinely block. */
const PROP_TOP = {
  tree: 5.5, tree_winter: 5.5, snowtree: 5.5, swamptree: 5.5, deadtree: 5.5,
  bossCrystal: 3.0, statue: 2.2, pillarA: 2.6, pillarB: 2.6, pillar: 2.6,
  mushroomLog: 1.8, shrineCrystal: 2.0, tent: 1.8, rack: 1.6, sarco: 1.2
};
const DEFAULT_PROP_TOP = 1.0;

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

    /* The camera's HEIGHT lags even when it is welded in X and Z.
       Vertical motion is read far more harshly than horizontal: the party
       crossing a tier moves the aim point a whole STEP (0.45) in the time it
       takes to walk one cell, and welded to that the frame snaps. Trailing it
       turns the same step into a lift the eye follows. It also damps what is
       left of a lane that touches a tier edge — the path scorer prices those
       out first (see terrainCost), this catches the remainder. */
    this.focusLagY = 0.55;

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
    /* Before buildScene, so the geometry is never created and the lane search
       never sees it. */
    if (d.props) d.props = d.props.filter(p => !HIDDEN_PROPS.has(p.kind));
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
    console.log(`[trailer] ${themeKey}: room ${pick.room.id} ` +
                `${pick.room.w}x${pick.room.h} clip=${pick.cost} ` +
                `occ=${pick.occ.toFixed(2)} runout=${pick.runout} ` +
                `tiers=${pick.terrain.tiers} cliffs=${pick.terrain.illegal}`);
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
      /* The party rides this level's terrain from here on. */
      this.party.setLevel(d);
      this.party.setHeading(h.hx, h.hz);
      this.party.placeAt(pick.path.x, pick.path.z);
      this.party.pose(walk.march === false ? 'idle' : 'walk');
      camTarget.set(pick.path.x, this.focusHeight + this.party.leaderY,
                    pick.path.z);
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

    /* Stop short of the threshold rather than standing in it. */
    const reach = along(exit) - 1.5;

    /* A door only counts as somewhere to walk if it is far enough ahead to
       walk TO. Below this the route is a couple of strides that the fitter
       then stretches over the whole beat, and the party shuffles across the
       floor at half the speed the LPC walk cycle is drawn for — which is most
       of what reads as "awkward" on camera. Better to fall back to a centred
       crossing of the room and let the orbit carry the motion. */
    if (reach < distance * MIN_ROUTE_FRACTION) return [];

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
  pathThrough(room, d, h, distance, lateral = 0, along = 0) {
    const rx = h.hz, rz = -h.hx;                 /* the heading's right vector */
    const x = room.cx - d.W / 2 + 0.5 + rx * lateral + h.hx * along;
    const z = room.cy - d.H / 2 + 0.5 + rz * lateral + h.hz * along;
    /* Inscribed length of the room rectangle along (hx, hz), minus a margin so
       nobody finishes inside a wall. */
    const spanX = Math.abs(h.hx) > 1e-6 ? room.w / Math.abs(h.hx) : Infinity;
    const spanZ = Math.abs(h.hz) > 1e-6 ? room.h / Math.abs(h.hz) : Infinity;
    const fit = Math.max(2, Math.min(spanX, spanZ) - WALL_MARGIN);
    const dist = Math.min(distance, fit);
    return {
      hx: h.hx, hz: h.hz, distance: dist, fit, lateral, along,
      x: x - h.hx * dist / 2,
      z: z - h.hz * dist / 2,
      centre: { x, z }
    };
  }

  /**
   * Where along the heading a crossing may sit inside the room.
   *
   * A big room only ever gets filmed down its middle otherwise, and that is a
   * real constraint rather than a cosmetic one: in a 22x22 verdant hall every
   * centre-line lane at every lateral offset grazed a root or a mushroom, so
   * the scorer walked away from the best room on the level and filmed a 14x12
   * chamber instead. The crossing needs `distance` units; anything the room has
   * beyond that is slack it can slide within, which turns one candidate window
   * into several and lets a well-dressed hall offer a clean one.
   *
   * Offsets are fractions of the available slack, nearest the centre first, so
   * all else equal the party still walks through the middle of the room.
   */
  alongOffsets(fit, distance) {
    const slack = (fit - distance) / 2;
    if (slack < 1) return [0];
    return [0, 0.45, -0.45, 0.85, -0.85].map(k => k * slack);
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
   * What the terrain does to the walk.
   *
   * Levels carry tiered ground, and a lane is not simply clear or blocked — it
   * can be legal and still film badly. Four things are counted:
   *
   *  - `illegal`: a step the party could not actually make. A ledge of two or
   *    more levels is a cliff, not a stair, and a hero crossing one on camera
   *    walks through the terrain rather than over it. Costed like a clip.
   *  - `steps`: how many times the lane changes level at all.
   *  - `gain`: net level change end to start. Positive means the walk finishes
   *    higher than it started, which is the shot worth having — the party
   *    climbing onto a terrace as the beat ends.
   *  - `bob`: WASTED vertical travel, in world units — the total up-and-down
   *    the leader's ground does, minus the part that gets them to their final
   *    height. This is the term that matters most, and it is measured off
   *    `groundY` rather than off the integer heights, which is the whole point:
   *    the molten beat's camera bobbed on a lane whose tier profile was
   *    perfectly flat. The wobble was groundY's ramp interpolation, invisible
   *    to a cell-height model and plainly visible on screen, because the camera
   *    aims above the leader's own ground and rides every centimetre of it.
   *    A clean climb costs nothing here — it is all net gain. A lane hugging a
   *    tier edge or drifting across a staircase pays for every reversal.
   *
   * Only the leader's line is tested, not every slot: the formation is 5 units
   * wide and almost any tier boundary crosses somebody, so testing all of them
   * rejects every route on an elevated level.
   */
  terrainCost(d, path) {
    const none = { illegal: 0, steps: 0, gain: 0, bob: 0, tiers: 0 };
    if (!d || !d.height) return none;
    const cellAt = (x, z) => {
      const gx = Math.round(x + d.W / 2 - 0.5);
      const gy = Math.round(z + d.H / 2 - 0.5);
      if (gx < 0 || gy < 0 || gx >= d.W || gy >= d.H) return -1;
      return gy * d.W + gx;
    };

    const start = cellAt(path.x, path.z);
    if (start < 0) return none;
    const base = heightOf(d, start);
    let illegal = 0, steps = 0, tiers = 0, last = base;
    let prev = start;

    /* Sampled finer than the cell grid: ramp interpolation happens between
       cells, so a half-cell stride steps straight over the wobble it makes. */
    let travel = 0, prevY = groundY(d, path.x, path.z);
    const firstY = prevY;

    for (let sMove = 0.25; sMove <= path.distance; sMove += 0.25) {
      const wx = path.x + path.hx * sMove, wz = path.z + path.hz * sMove;
      const y = groundY(d, wx, wz);
      travel += Math.abs(y - prevY);
      prevY = y;

      const c = cellAt(wx, wz);
      if (c < 0) continue;
      if (c !== prev) {
        const delta = heightOf(d, c) - heightOf(d, prev);
        if (delta !== 0) {
          /* One level is a step anyone can take; the generator's own rule is
             that anything more needs a ramp at one end. */
          if (Math.abs(delta) > 1 && !d.ramp[c] && !d.ramp[prev]) illegal++;
          steps++;
          last = heightOf(d, c);
        }
        prev = c;
      }
      if (heightOf(d, c) !== base) tiers++;
    }

    /* Everything the ground did that was not getting them to their final
       height. Zero for a clean climb, however tall. */
    const bob = Math.max(0, travel - Math.abs(prevY - firstY));
    return { illegal, steps, gain: last - base, bob, tiers };
  }

  /**
   * Open floor left in front of the party when the walk ends, in world units,
   * capped at RUNOUT_WANT.
   *
   * This is the "are they walking at a wall" term. The crossing itself is
   * always clear — that is what pathCost guarantees — but a lane fitted to a
   * room can still finish with the party a stride from the masonry, and since
   * the camera is locked on them, that wall is the whole back of frame for the
   * last second of the beat. Terrain counts: a tier rising a chest-height
   * ahead of them closes the view off just as masonry does.
   */
  runout(d, path) {
    const endX = path.x + path.hx * path.distance;
    const endZ = path.z + path.hz * path.distance;
    const cellAt = (x, z) => {
      const gx = Math.round(x + d.W / 2 - 0.5);
      const gy = Math.round(z + d.H / 2 - 0.5);
      if (gx < 0 || gy < 0 || gx >= d.W || gy >= d.H) return -1;
      return gy * d.W + gx;
    };
    const at = cellAt(endX, endZ);
    const base = at < 0 ? 0 : heightOf(d, at);

    for (let r = 0.5; r <= RUNOUT_WANT; r += 0.5) {
      const c = cellAt(endX + path.hx * r, endZ + path.hz * r);
      if (c < 0 || d.grid[c] !== FLOOR) return r - 0.5;
      /* A tier rising most of a hero's height ahead of them closes the view
         off just as masonry does. */
      if ((heightOf(d, c) - base) * STEP >= CHEST) return r - 0.5;
    }
    return RUNOUT_WANT;
  }

  /**
   * How often the camera's view of the party is blocked over the course of the
   * beat.
   *
   * The camera orbits, so a lane that is clear from one side is behind a wall
   * from another — checking a single angle proves nothing. This marches from
   * the party toward the camera at several points along the walk and several
   * yaws across the arc the orbit will actually cover.
   *
   * WHAT COUNTS AS BLOCKING IS A SIGHT LINE, NOT A RADIUS. An earlier version
   * counted any solid cell within 7 units, which was wrong in both directions
   * and wrong enough to matter: the camera is ORTHOGRAPHIC at `orbit.pitch`
   * (0.70 rad here, a 40-degree elevation), so the view climbs 0.84 units for
   * every unit it travels away from the party. A 2.4-unit dungeon wall
   * therefore hides a hero's chest only within about 1.7 units — but a 5.5-unit
   * tree hides them out to 5.3. Counting everything to 7 scored ordinary
   * dungeon rooms at 0.3-0.9 "blocked" when nothing was in the way at all, and
   * because occlusion is the heaviest term after a clip, that noise was
   * choosing the rooms. Verdant filmed in a 14x12 chamber on the strength of it.
   *
   * So: an occluder blocks when its top rises above the sight line at that
   * distance. Terrain is included on the same footing — a raised tier is just a
   * short occluder — as are the tall props, since a trunk in the foreground
   * hides a hero exactly as a wall does.
   */
  occlusionCost(d, path, yaw0, yawSpan, samples = 3, angles = 5) {
    const TH = THEMES[this.themeKey];
    const wallTop = TH && TH.overland ? TREE_TOP : WALL_TOP;
    const tan = Math.tan(this.orbit.pitch);
    /* No point marching past the distance at which the tallest thing on the
       level has already dropped below the sight line. */
    const reach = Math.max(1.5, (Math.max(wallTop, TREE_TOP) - CHEST) / tan);
    const blockers = this.blockers(d);

    let blocked = 0;
    for (let si = 0; si < samples; si++) {
      const s = path.distance * (si / Math.max(1, samples - 1));
      const px = path.x + path.hx * s, pz = path.z + path.hz * s;
      const here = Math.round(px + d.W / 2 - 0.5) +
                   Math.round(pz + d.H / 2 - 0.5) * d.W;
      const baseY = heightOf(d, here) * STEP;

      for (let ai = 0; ai < angles; ai++) {
        const yaw = yaw0 + yawSpan * (ai / Math.max(1, angles - 1));
        /* Horizontal direction from the target toward the camera. */
        const dx = Math.sin(yaw), dz = Math.cos(yaw);

        for (let r = 0.75; r <= reach; r += 0.5) {
          const gx = Math.round(px + dx * r + d.W / 2 - 0.5);
          const gy = Math.round(pz + dz * r + d.H / 2 - 0.5);
          if (gx < 0 || gy < 0 || gx >= d.W || gy >= d.H) break;
          const c = gy * d.W + gx;

          /* Tallest thing standing on this cell, in world Y. */
          let top = d.grid[c] !== FLOOR ? wallTop : heightOf(d, c) * STEP;
          if (d.grid[c] === FLOOR) {
            const bucket = blockers.get(c);
            if (bucket) {
              for (const b of bucket) {
                top = Math.max(top, heightOf(d, c) * STEP +
                                    (PROP_TOP[b.kind] ?? DEFAULT_PROP_TOP));
              }
            }
          }

          /* The sight line, measured in the same frame: chest height above the
             party's own ground, climbing with distance. */
          if (top - baseY > CHEST + r * tan) { blocked++; break; }
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
      crawl: 700,        /* flat, for a route under MIN_ROUTE_FRACTION of the
                            crossing. `short` alone is linear and a very short
                            route in an otherwise ideal room could still win on
                            the other terms; this prices the shuffle itself. */
      area: -0.08,       /* per square unit of floor, capped — bigger is better */
      cramped: 120,      /* per unit below the preferred minimum dimension */
      lateral: 10,       /* per unit off the room's centre line. Was a token
                            0.05, which broke ties and nothing else — lanes
                            ended up 4-6 units out along a side wall for no
                            gain now that the boss crystal (the thing centre
                            lanes used to collide with) is stripped before the
                            level is built. At 10 an offset has to buy
                            something real: a single clipped sample is worth
                            100 units of drift. */
      along: 5,          /* per unit the crossing is slid up or down the room.
                            Half `lateral`: sliding along the heading keeps the
                            party away from the side walls, and the runout term
                            already prices sliding too far forward. */
      noDoorway: 300,    /* blind crossing: no opening to aim at at all */
      occlusion: 1300,   /* per unit of "camera view of the party is blocked".
                            The heaviest term after an outright clip: a shot
                            where the party spends half the beat behind a wall
                            is not a shot, however handsome the room is. */
      barren: 20,        /* per prop-per-100-tiles BELOW the target dressing */
      cliff: 800,        /* per sample where the lane crosses unclimbable terrain */
      bob: 900,          /* per world unit of WASTED vertical travel. The
                            expensive one, and priced like occlusion because it
                            is just as visible: the camera aims above the
                            leader's own ground, so every centimetre the ground
                            wastes going up and back down is a jolt in frame.
                            A whole STEP of waste (0.45) costs 405 — enough to
                            lose a room, which is the intent. */
      steps: 120,        /* per level change beyond the first two — a couple of
                            steps is terrain, five is an obstacle course */
      climb: -260,       /* REWARD for a walk that finishes higher than it
                            started without ever doubling back. The party
                            climbing onto a terrace as the beat ends is the shot
                            worth having, so the scorer pays for it rather than
                            merely tolerating it. */
      runout: 90,        /* per unit of open floor MISSING ahead of the finish */
      /* `cramped` deliberately outweighs `noDoorway`: a doorway route is worth
         a lot, but not worth filming in a broom cupboard. At these weights a
         17x17 room with no usable pair still beats a 9x11 room that has one. */
      ...(opts.weights || {})
    };
    /* The floor for "a big room". Raised from 14: at 14 the scorer would take a
       merely-adequate chamber whose walls sit close behind the party, and the
       generator emits plenty of 16-22 rooms to choose from. Rooms below this
       are not excluded — `cramped` just prices them. */
    const minSize = opts.minSize ?? 17;

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
      /* Capped so one enormous hall cannot outbid every other term; raised
         with the area weight so the cap is not reached by an ordinary room. */
      const area = Math.min(room.w * room.h, 500) * W.area;

      /* Candidate routes through this room. The doorway route comes first and
         is strongly preferred; the centred crossings are the fallback for rooms
         with no usable pair of openings — which is every overland zone, since
         those connect by open road rather than by doors. */
      const routes = [...this.doorwayPath(d, room, h, distance)];

      /* Sweep lanes out from the centre line, nearest first, so that all else
         equal the party walks as close to the middle of the room as a clean
         lane allows — and, in a room with floor to spare, slide the crossing
         along the heading too. */
      const reach = Math.max(2, Math.floor(Math.min(room.w, room.h) / 2) - 2);
      const probe = this.pathThrough(room, d, h, distance, 0, 0);
      const alongs = this.alongOffsets(probe.fit, distance);
      for (const lateral of laneOffsets(reach)) {
        for (const along of alongs) {
          routes.push(this.pathThrough(room, d, h, distance, lateral, along));
        }
      }

      /* Rooms are scored for dressing once; it does not vary by lane. */
      const bare = Math.max(0, TARGET_DRESSING - this.dressing(d, room)) * W.barren;

      for (const path of routes) {
        const cost = this.pathCost(d, path, blockers, slots);
        const occ = this.occlusionCost(d, path, this.orbit.yaw, yawSpan);
        const terrain = this.terrainCost(d, path);
        const ahead = this.runout(d, path);
        const score = cost * W.clip
                    + occ * W.occlusion
                    + centre + small + area + bare
                    + (path.doorway ? 0 : W.noDoorway)
                    + Math.max(0, distance - path.fit) * W.short
                    + (path.fit < distance * MIN_ROUTE_FRACTION ? W.crawl : 0)
                    + Math.abs(path.lateral) * W.lateral
                    + Math.abs(path.along || 0) * W.along
                    + terrain.illegal * W.cliff
                    + terrain.bob * W.bob
                    + Math.max(0, terrain.steps - 2) * W.steps
                    + (terrain.gain > 0 && terrain.bob < 0.15 ? W.climb : 0)
                    + Math.max(0, RUNOUT_WANT - ahead) * W.runout;
        if (!best || score < best.score) {
          best = { room, path, cost, occ, terrain, runout: ahead, score };
        }
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
      /* Aim above the leader's own ground, not above y=0: on a tiered room a
         fixed target slid down the sprite as the party climbed. leaderY is
         already eased by the party, so this cannot jolt on a step. */
      const y = this.focusHeight + this.party.leaderY;
      if (this.followLag > 0) {
        const k = 1 - Math.exp(-dt / this.followLag);
        camTarget.x += (x - camTarget.x) * k;
        camTarget.z += (z - camTarget.z) * k;
      } else {
        camTarget.x = x;
        camTarget.z = z;
      }
      /* Height on its own, slower clock. */
      if (this.focusLagY > 0) {
        camTarget.y += (y - camTarget.y) * (1 - Math.exp(-dt / this.focusLagY));
      } else {
        camTarget.y = y;
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
