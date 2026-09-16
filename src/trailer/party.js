/**
 * TRAILER PARTY — a standing party of real heroes, owned by the trailer rather
 * than by the game.
 *
 * The party lives in its own Group added straight to `scene`, mirroring how
 * game.js parents heroes to `gameGroup`. That matters: disposeLevel() only
 * tears down the level `group`, so a party parented to the scene survives a
 * theme rebuild untouched. The world can be demolished and re-risen around
 * heroes who never move — which is the whole shot.
 */
import * as THREE from 'three';
import { makeHero } from '../game/srd.js';
import { makeHeroMesh } from '../game/entities.js';
import { getRaceDefaults } from '../game/appearance.js';
import { scene, cam } from '../render/dungeon_scene.js';
import { groundY, easeBodyY } from '../dungeon/elevation.js';

/* Every action HeroSprite can compose. Pre-warming all of them means a later
   pose change (or gear swap) is a synchronous textureCache hit. */
export const ALL_ACTIONS = ['walk', 'slash', 'hurt', 'shoot', 'spellcast', 'thrust'];

const DEFAULT_STATS = { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 };

/* Marching formation in the party's LOCAL frame: +z is the direction of
   travel, +x is its right. The leader takes point and the rest trail in a
   wedge, so the group reads as a party moving somewhere rather than a row of
   sprites. Rotated into world space by the current heading. */
export const FORMATION = [
  [0.0,  0.0],   /* leader — the one the camera locks onto */
  [-1.2, -1.3], [1.2, -1.3],
  [0.0, -2.5],
  [-2.4, -2.6], [2.4, -2.6]
];

function visualFor(raceKey, spec) {
  return {
    ...getRaceDefaults(raceKey),
    gender: spec.gender || 'male',
    hair: spec.hair || 'messy1/adult',
    hairExtension: 'none',
    hairExtColor: '',
    ...(spec.visual || {})
  };
}

export class Party {
  constructor(specs) {
    this.group = new THREE.Group();
    this.group.name = 'trailer-party';
    scene.add(this.group);

    this.members = specs.map(spec => {
      const data = makeHero(
        spec.name,
        spec.race,
        spec.cls,
        spec.stats || DEFAULT_STATS,
        visualFor(spec.race, spec)
      );
      const ent = makeHeroMesh(data);
      this.group.add(ent.grp);
      return { spec, data, ent, anim: ent.anim };
    });

    this.heading = { x: 0, z: 1 };
    this.speed = 1.8;
    this.leaderPos = { x: 0, z: 0 };
    /* The level the party is standing ON. Levels carry terrain elevation, so a
       hero's Y is a property of where they are, not a constant. Null until a
       beat hands one over, which is the flat-ground case. */
    this.level = null;
    this.leaderY = 0;

    this.pose('idle');
    this.face('down');
    this.showHud(false);
  }

  /**
   * makeHeroMesh ships each hero with gameplay furniture: a circular HP ring on
   * the ground, a status-effect tray, and a turn highlight. Fine in game, wrong
   * in a cinematic — the ring in particular reads as a targeting decal. Off by
   * default here; flip it on for a shot that is explicitly selling the HUD.
   */
  showHud(on) {
    for (const m of this.members) {
      if (m.ent.bar && m.ent.bar.spr) m.ent.bar.spr.visible = on;
      if (m.ent.statusTray && m.ent.statusTray.spr) m.ent.statusTray.spr.visible = on;
      if (m.ent.turnHighlight && m.ent.turnHighlight.group) m.ent.turnHighlight.group.visible = false;
    }
    this._hud = on;
  }

  /**
   * `idle` holds LPC walk frame 0 — the standing pose. (update() special-cases
   * 'walk' to skip frame 0 while moving, so a frozen walk is the idle pose.)
   * `walk` marches them in place.
   */
  pose(kind) {
    for (const m of this.members) {
      m.anim.state = 'walk';
      m.anim.time = 0;
      m.anim.animating = (kind === 'walk');
    }
    this._pose = kind;
  }

  /** LPC row select: 'up' | 'left' | 'down' | 'right'. */
  face(dir) {
    for (const m of this.members) m.anim.dir = dir;
  }

  /** The hero the camera locks onto. */
  get leader() { return this.members[0]; }

  /** Heading is the direction of travel, in world XZ. Normalised on set. */
  setHeading(hx, hz) {
    const len = Math.hypot(hx, hz) || 1;
    this.heading = { x: hx / len, z: hz / len };
  }

  /** Metres per second the leader covers. LPC's walk cycle reads right at ~1.8. */
  setSpeed(v) { this.speed = v; }

  /**
   * Hand the party the level it is standing on, so it can ride the terrain.
   *
   * Elevation arrived after this rig did, and every hero was pinned at y=0 —
   * on a tiered room that put them shin-deep in the stone they were supposed to
   * be walking over. Y now comes from `groundY` per member per frame, the same
   * source game.js uses.
   */
  setLevel(d) { this.level = d || null; }

  /** Ground height under a world XZ, or 0 on a flat/absent level. */
  groundAt(x, z) { return this.level ? groundY(this.level, x, z) : 0; }

  /**
   * Put the leader at a world position and lay the formation out behind it,
   * rotated into the current heading.
   */
  placeAt(wx, wz) {
    this.group.position.set(0, 0, 0);
    this.leaderPos = { x: wx, z: wz };
    this.layout();
  }

  /**
   * Re-derive every member's position from the leader position and heading.
   *
   * `dt` of 0 snaps the height (a placement); a positive dt eases it, so a
   * hero crossing an unstaired ledge hops rather than teleporting a whole STEP
   * between frames. That is `easeBodyY`'s job in the game too — X and Z stay
   * exact either way, so nobody ever lags their own logical position.
   */
  layout(dt = 0) {
    const h = this.heading || { x: 0, z: 1 };
    /* Local +z is forward, local +x is its right, on the ground plane. */
    const fx = h.x, fz = h.z;
    const rx = h.z, rz = -h.x;
    const { x: lx, z: lz } = this.leaderPos;

    this.members.forEach((m, i) => {
      const [ox, oz] = FORMATION[i % FORMATION.length];
      m.x = lx + rx * ox + fx * oz;
      m.z = lz + rz * ox + fz * oz;
      const want = this.groundAt(m.x, m.z);
      m.y = dt > 0 ? easeBodyY(m.y ?? want, want, dt) : want;
      m.ent.grp.position.set(m.x, m.y, m.z);
    });
    /* What the camera aims at vertically — the leader's own ground, eased with
       everyone else so the frame does not jolt on a step. */
    this.leaderY = this.leader ? this.leader.y : this.groundAt(lx, lz);
  }

  /**
   * Choose each hero's LPC row from how their travel reads ON SCREEN, not in
   * world space. The sprites are billboards, so as the camera orbits a party
   * walking one fixed world direction has to change row to keep looking like
   * it is walking that way. Projecting through the camera gets this exactly
   * right at every yaw, including the diagonals where it flips.
   */
  faceByScreen() {
    /* cam.matrixWorldInverse is only refreshed by renderer.render(), so it
       still holds last frame's orbit at this point. Refresh it here or the
       facing lags the camera by a frame. */
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

    const h = this.heading || { x: 0, z: 1 };
    const m0 = this.leader;
    const y = m0.y || 0;
    const a = new THREE.Vector3(m0.x, y, m0.z).project(cam);
    const b = new THREE.Vector3(m0.x + h.x, y, m0.z + h.z).project(cam);
    /* HeroSprite.setDirection wants (dx, dz) where +dz means "toward viewer";
       on screen that is downward, i.e. decreasing NDC y. */
    const dx = b.x - a.x, dz = -(b.y - a.y);
    for (const m of this.members) m.anim.setDirection(dx, dz);
  }

  /**
   * Movement only. Split from update() because the camera has to be re-aimed
   * at the leader's NEW position before facing can be resolved on screen —
   * Stage sequences step -> aim camera -> update.
   */
  step(dt) {
    if (this._pose !== 'walk') return;
    if (!this.speed || !this.heading || !this.leaderPos) return;
    this.leaderPos.x += this.heading.x * this.speed * dt;
    this.leaderPos.z += this.heading.z * this.speed * dt;
    this.layout(dt);
  }

  /** Facing + sprite animation, after the camera is in its final pose. */
  update(dt) {
    if (this._pose === 'walk') this.faceByScreen();
    for (const m of this.members) m.anim.update(dt);
  }

  /**
   * Compose and cache every action sheet for the party's current gear, so the
   * first frame that shows them is already complete.
   *
   * Note this awaits loadState() directly rather than calling reloadAll() —
   * reloadAll fires the promises and discards them, so awaiting it is a no-op.
   */
  async warm(actions = ALL_ACTIONS) {
    for (const m of this.members) {
      await Promise.all(actions.map(a => m.anim.loadState(a)));
    }
    /* update() is what actually binds material.map and flips mesh.visible —
       without a tick the heroes stay invisible even with textures ready. */
    this.update(0);
  }

  /**
   * Slots the gear ladder owns. A tier that omits one CLEARS it rather than
   * leaving the previous rung's item in place — otherwise a fighter who picks
   * up a shield at one tier is still holding it two tiers later while swinging
   * a two-handed claymore.
   */
  static GEAR_SLOTS = ['weapon', 'armor', 'helm', 'offhand'];

  /**
   * Re-equip every member and re-compose their sprites.
   *   equipFor(member) -> { weapon?, armor?, helm?, offhand? } | null
   * Returning null leaves that member untouched.
   */
  async equip(equipFor, actions = ['walk']) {
    for (const m of this.members) {
      const gear = equipFor(m);
      if (!gear) continue;
      for (const slot of Party.GEAR_SLOTS) {
        if (gear[slot]) m.data.equipment[slot] = gear[slot];
        else delete m.data.equipment[slot];
      }
      m.anim.equipment = m.data.equipment;
    }
    await this.warm(actions);
  }

  /**
   * Compose every rung of the ladder up front, then return the party to the
   * first one. HeroSprite caches by a full visual+equipment signature, so once
   * a rung has been composed, switching to it mid-shot is a synchronous cache
   * hit and costs no frames.
   *
   * Only the actions the trailer actually plays are warmed — the party walks
   * and never swings, so warming all six would quadruple preflight for sheets
   * no frame ever shows.
   */
  async warmLadder(tiers, gearAt, actions = ['walk']) {
    for (let i = tiers.length - 1; i >= 0; i--) {
      await this.equip(gearAt(i), actions);
    }
  }

  dispose() {
    scene.remove(this.group);
  }
}

/**
 * Remove every party group currently in the scene.
 *
 * runShot builds a fresh Party each run and the group is parented to `scene`,
 * which is a module singleton that outlives any single run — so a second
 * Preview used to leave the first party standing exactly where it stopped
 * while the new one walked away from it. Two parties on screen, one frozen.
 *
 * Swept by name rather than by holding a reference, so it also catches groups
 * orphaned by a hot reload, where the module instance that created them is
 * gone but their meshes are still in the scene.
 */
export function clearParties() {
  for (const child of [...scene.children]) {
    if (child.name === 'trailer-party') scene.remove(child);
  }
}

/** The stock test party — one of each armour silhouette so gear reads clearly. */
export const DEFAULT_PARTY = [
  { name: 'Bram',   race: 'human',    cls: 'fighter' },
  { name: 'Sable',  race: 'elf',      cls: 'rogue',  gender: 'female', hair: 'long/adult' },
  { name: 'Orrin',  race: 'dwarf',    cls: 'cleric' },
  { name: 'Vess',   race: 'tiefling', cls: 'wizard', gender: 'female', hair: 'long/adult' }
];
