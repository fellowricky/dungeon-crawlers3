/* ─────────────── Line-of-sight fog reveal ───────────────
 * Rooms past an opened door used to stay pitch black until a hero physically
 * stepped onto a tile inside them: the per-frame reveal driver is a plain
 * radius with no sight test, and revealCell refuses cells in unvisited rooms
 * outright. These cover the field of view that fixes that, and the two
 * separations it depends on:
 *
 *   - sight vs collision  (a coffin stops feet, not eyes)
 *   - sighting vs visiting (`losSeen` must never leak into `revealed`, which
 *     is what lets a monster wake)
 */
import { describe, it, expect } from 'vitest';
import { fogMethods } from '../src/game/fog.js';
import { FLOOR, WALL } from '../src/game/constants.js';
import {
  buildSolidProps, buildSightBlockers, pathfindingMethods,
  SOLID_PROP_KINDS, SIGHT_BLOCKING_KINDS
} from '../src/game/pathfinding.js';

const FRONTIER_DIM = 0.35;

/** Fog harness over a W×H map with no real meshes: records painted brightness. */
function makeFog(W, H, grid, roomId, opts = {}) {
  const painted = new Float64Array(W * H).fill(-1);
  const g = Object.assign({}, fogMethods, {
    D: {
      W, H, grid, roomId,
      rooms: opts.rooms || [],
      edges: opts.edges || [],
      sightBlockers: opts.sightBlockers || null,
      overland: false
    },
    engine: { getMeshes: () => ({}), getLights: () => null, getParticles: () => null, getStandalone: () => null },
    monsters: opts.monsters || [],
    revealed: new Uint8Array(W * H),
    losSeen: new Uint8Array(W * H),
    losVisible: new Uint8Array(W * H),
    visitedRooms: new Uint8Array((opts.rooms || []).length),
    floorInst: new Int32Array(W * H).fill(-1),
    floorInstN: new Uint8Array(W * H),
    wallInst: new Int32Array(W * H).fill(-1),
    cellOf: (x, z) => {
      const cx = Math.round(x + W / 2 - 0.5), cy = Math.round(z + H / 2 - 0.5);
      return (cx < 0 || cy < 0 || cx >= W || cy >= H) ? -1 : cy * W + cx;
    },
    isCellDoorClosed: opts.isCellDoorClosed || (() => false)
  });
  // Capture brightness instead of touching Three.js instances.
  g._paintCell = (c, m) => { painted[c] = m; };
  g.painted = painted;
  return g;
}

const at = (W, x, y) => y * W + x;
/** World position of a cell centre, matching the harness cellOf. */
const pos = (W, H, x, y) => ({ x: x - W / 2 + 0.5, z: y - H / 2 + 0.5 });

describe('Sight blocking is not collision blocking', () => {
  it('treats every sight blocker as solid, but not every solid prop as opaque', () => {
    for (const k of SIGHT_BLOCKING_KINDS) expect(SOLID_PROP_KINDS.has(k)).toBe(true);
    // Waist-high furniture stops feet only.
    for (const k of ['coffin', 'sarco', 'table', 'chair', 'barrel', 'crate', 'bench', 'chest']) {
      expect(SOLID_PROP_KINDS.has(k)).toBe(true);
      expect(SIGHT_BLOCKING_KINDS.has(k)).toBe(false);
    }
    // Tall masses stop both.
    for (const k of ['pillar', 'statue', 'bookshelf']) {
      expect(SIGHT_BLOCKING_KINDS.has(k)).toBe(true);
    }
  });

  it('hasLOS sees over a coffin but not past a pillar', () => {
    const W = 9, H = 3;
    const grid = new Uint8Array(W * H).fill(WALL);
    for (let x = 0; x < W; x++) grid[at(W, x, 1)] = FLOOR;
    const props = [
      { kind: 'coffin', x: 3, y: 1, rot: 0, scale: 1 },
      { kind: 'pillar', x: 6, y: 1, rot: 0, scale: 1 }
    ];
    const d = { W, H, grid, props, entrance: { x: 0, y: 1 }, rooms: [] };
    d.solidProps = buildSolidProps(d);
    d.sightBlockers = buildSightBlockers(d, d.solidProps);

    // Both still block movement.
    expect(d.solidProps[at(W, 3, 1)]).toBe(1);
    expect(d.solidProps[at(W, 6, 1)]).toBe(1);
    // Only the pillar blocks sight.
    expect(d.sightBlockers[at(W, 3, 1)]).toBe(0);
    expect(d.sightBlockers[at(W, 6, 1)]).toBe(1);

    const g = Object.assign({}, pathfindingMethods, {
      D: d,
      cellOf: (x, z) => {
        const cx = Math.round(x + W / 2 - 0.5), cy = Math.round(z + H / 2 - 0.5);
        return (cx < 0 || cy < 0 || cx >= W || cy >= H) ? -1 : cy * W + cx;
      }
    });
    const p = (x, y) => pos(W, H, x, y);
    const a = p(1, 1), overCoffin = p(5, 1), pastPillar = p(8, 1);
    expect(g.hasLOS(a.x, a.z, overCoffin.x, overCoffin.z)).toBe(true);
    expect(g.hasLOS(a.x, a.z, pastPillar.x, pastPillar.z)).toBe(false);
  });

  it('does not mark a prop opaque when the connectivity guard cleared it', () => {
    // A pillar is the only link to a 1-cell nook, so buildSolidProps must clear
    // its collision — and a prop you can walk through cannot still block sight.
    const W = 7, H = 5;
    const grid = new Uint8Array(W * H).fill(WALL);
    for (let x = 1; x <= 5; x++) grid[at(W, x, 2)] = FLOOR;
    const props = [{ kind: 'pillar', x: 2, y: 2, rot: 0, scale: 1 }];
    const d = { W, H, grid, props, entrance: { x: 5, y: 2 }, rooms: [{ id: 0, cx: 4, cy: 2, w: 2, h: 1 }] };
    d.solidProps = buildSolidProps(d);
    d.sightBlockers = buildSightBlockers(d, d.solidProps);

    expect(d.solidProps[at(W, 2, 2)]).toBe(0);
    expect(d.sightBlockers[at(W, 2, 2)]).toBe(0);
  });
});

describe('Field of view', () => {
  /* 11×7. Two rooms split by a wall at x=5 with a single doorway at (5,3).
     Room 0 (left, x 1..4) is where the party stands; room 1 (right, x 6..9)
     is unvisited and unlit. */
  function twoRooms(opts = {}) {
    const W = 11, H = 7;
    const grid = new Uint8Array(W * H).fill(WALL);
    const roomId = new Int32Array(W * H).fill(-1);
    for (let y = 1; y <= 5; y++) {
      for (let x = 1; x <= 4; x++) { grid[at(W, x, y)] = FLOOR; roomId[at(W, x, y)] = 0; }
      for (let x = 6; x <= 9; x++) { grid[at(W, x, y)] = FLOOR; roomId[at(W, x, y)] = 1; }
    }
    grid[at(W, 5, 3)] = FLOOR;              // the doorway
    const rooms = [{ id: 0, cx: 2, cy: 3, w: 4, h: 5 }, { id: 1, cx: 7, cy: 3, w: 4, h: 5 }];
    const g = makeFog(W, H, grid, roomId, { rooms, edges: [{ a: 0, b: 1 }], ...opts });
    g.visitedRooms[0] = 1;                  // party has been in the left room
    return { g, W, H };
  }

  it('reveals nothing past a closed door', () => {
    const { g, W, H } = twoRooms({ isCellDoorClosed: (c) => c === at(11, 5, 3) });
    const hero = { data: { hp: 10 }, ...pos(W, H, 4, 3) };
    g.updateVisionField([hero], 8);

    // The gate itself is in plain view — it is what you are looking at...
    expect(g.losSeen[at(W, 5, 3)]).toBe(1);
    // ...and nothing behind it is.
    expect(g.losSeen[at(W, 6, 3)]).toBe(0);
    expect(g.losSeen[at(W, 7, 3)]).toBe(0);
  });

  it('reveals the far room by line of sight once the door opens', () => {
    const { g, W, H } = twoRooms();
    const hero = { data: { hp: 10 }, ...pos(W, H, 4, 3) };

    expect(g.updateVisionField([hero], 8)).toBe(true);
    // Straight through the doorway — visible without anyone entering.
    expect(g.losVisible[at(W, 7, 3)]).toBe(1);
    expect(g.losSeen[at(W, 7, 3)]).toBe(1);
    // The room was never entered: that still requires stepping inside.
    expect(g.visitedRooms[1]).toBe(0);
  });

  it('leaves the far corners dark — sight through a door is a wedge', () => {
    const { g, W, H } = twoRooms();
    const hero = { data: { hp: 10 }, ...pos(W, H, 1, 3) };
    g.updateVisionField([hero], 8);

    // On the axis: seen. Off in the corner behind the wall: not.
    expect(g.losSeen[at(W, 6, 3)]).toBe(1);
    expect(g.losSeen[at(W, 9, 1)]).toBe(0);
    expect(g.losSeen[at(W, 9, 5)]).toBe(0);
  });

  it('widens the visible wedge as the party approaches the doorway', () => {
    const { g, W, H } = twoRooms();
    const far = { data: { hp: 10 }, ...pos(W, H, 1, 3) };
    g.updateVisionField([far], 8);
    const seenFar = g.losSeen.reduce((n, v) => n + v, 0);

    const g2 = twoRooms().g;
    const near = { data: { hp: 10 }, ...pos(W, H, 4, 3) };
    g2.updateVisionField([near], 8);
    const seenNear = g2.losSeen.reduce((n, v) => n + v, 0);

    expect(seenNear).toBeGreaterThan(seenFar);
  });

  it('reveals the corridor past a doorway, not only rooms', () => {
    /* Regression: LOS marking was restricted to cells in unvisited ROOMS, on the
       theory that corridors already had rules of their own. But a corridor is
       what sits immediately past most doors — sampled at the party's position on
       a real crypt floor the sight radius held 7 corridor cells and 0
       unvisited-room cells, so the restriction excluded everything actually
       visible and the only things that appeared past a door were props. */
    const W = 14, H = 5;
    const grid = new Uint8Array(W * H).fill(WALL);
    const roomId = new Int32Array(W * H).fill(-1);
    for (let x = 1; x <= 12; x++) grid[at(W, x, 2)] = FLOOR;
    for (let x = 1; x <= 3; x++) roomId[at(W, x, 2)] = 0;    // entered room
    for (let x = 10; x <= 12; x++) roomId[at(W, x, 2)] = 1;  // room beyond
    // x = 4..9 stays roomId -1: the corridor.
    const rooms = [{ id: 0, cx: 2, cy: 2, w: 3, h: 1 }, { id: 1, cx: 11, cy: 2, w: 3, h: 1 }];
    const g = makeFog(W, H, grid, roomId, { rooms, edges: [{ a: 0, b: 1 }] });
    g.visitedRooms[0] = 1;

    const hero = { data: { hp: 10 }, ...pos(W, H, 3, 2) };
    expect(g.updateVisionField([hero], 12)).toBe(true);

    for (const x of [4, 6, 8, 9]) expect(g.losSeen[at(W, x, 2)]).toBe(1);
    expect(g.losSeen[at(W, 10, 2)]).toBe(1);   // and on into the far room
    expect(g.visitedRooms[1]).toBe(0);         // still nobody has been there
  });

  it('lights a sighted corridor cell that the party has never walked', () => {
    const W = 14, H = 5;
    const grid = new Uint8Array(W * H).fill(WALL);
    const roomId = new Int32Array(W * H).fill(-1);
    for (let x = 1; x <= 12; x++) grid[at(W, x, 2)] = FLOOR;
    for (let x = 1; x <= 3; x++) roomId[at(W, x, 2)] = 0;
    const rooms = [{ id: 0, cx: 2, cy: 2, w: 3, h: 1 }];
    const g = makeFog(W, H, grid, roomId, { rooms, edges: [] });
    g.visitedRooms[0] = 1;

    const hero = { data: { hp: 10 }, ...pos(W, H, 3, 2) };
    g.updateVisionField([hero], 12);
    g.recalculateFog({ _roomCleared: () => false });

    // _sinkCorridors would otherwise hold this at FRONTIER_DIM or sink it.
    expect(g.painted[at(W, 8, 2)]).toBe(1.0);
    expect(g.revealed[at(W, 8, 2)]).toBe(0);   // seen, but not "been there"
  });

  it('never writes a sighting into `revealed`, which gates monster activation', () => {
    const { g, W, H } = twoRooms();
    const hero = { data: { hp: 10 }, ...pos(W, H, 4, 3) };
    g.updateVisionField([hero], 8);

    const cell = at(W, 7, 3);
    expect(g.losSeen[cell]).toBe(1);
    expect(g.revealed[cell]).toBe(0);

    // And a fog repaint must not promote it either.
    g.recalculateFog({ _roomCleared: () => false });
    expect(g.revealed[cell]).toBe(0);
  });

  it('survives recalculateFog instead of being repainted back to black', () => {
    const { g, W, H } = twoRooms();
    // Back from the door, so the wedge is narrow and the far corners stay out
    // of it — adjacent to the doorway it opens wide enough to take the room.
    const hero = { data: { hp: 10 }, ...pos(W, H, 1, 3) };
    g.updateVisionField([hero], 8);
    g.recalculateFog({ _roomCleared: () => false });

    // Lit while in sight...
    expect(g.painted[at(W, 6, 3)]).toBe(1.0);
    // ...and a corner of the same unvisited room, never seen, stays dark.
    expect(g.painted[at(W, 9, 1)]).toBe(0);
  });

  it('dims a sighted cell to the remembered tier once it drops out of sight', () => {
    const { g, W, H } = twoRooms();
    const atDoor = { data: { hp: 10 }, ...pos(W, H, 4, 3) };
    g.updateVisionField([atDoor], 8);
    const cell = at(W, 7, 3);
    g.recalculateFog({ _roomCleared: () => false });
    expect(g.painted[cell]).toBe(1.0);

    // Walk away behind the wall — no longer visible, but still remembered.
    const away = { data: { hp: 10 }, ...pos(W, H, 1, 1) };
    g.updateVisionField([away], 3);
    g.recalculateFog({ _roomCleared: () => false });

    expect(g.losVisible[cell]).toBe(0);
    expect(g.losSeen[cell]).toBe(1);
    expect(g.painted[cell]).toBe(FRONTIER_DIM);
  });

  it('reports no change when nothing new comes into view', () => {
    const { g, W, H } = twoRooms({ isCellDoorClosed: () => true });
    const a = { data: { hp: 10 }, ...pos(W, H, 1, 1) };
    g.updateVisionField([a], 8);
    // Standing still against the same walls: the field is stable, so the
    // caller skips the fog rebuild rather than repainting every frame.
    expect(g.updateVisionField([a], 8)).toBe(false);

    // And once proximity has revealed that ground, crossing it adds nothing
    // either — which is what keeps the repaint rare while the party explores.
    g.revealed.fill(1);
    g.updateVisionField([a], 8);                       // absorb the transition
    const b = { data: { hp: 10 }, ...pos(W, H, 2, 2) };
    expect(g.updateVisionField([b], 8)).toBe(false);
  });

  it('shows a monster the party can see, without waking it', () => {
    const monster = {
      data: { hp: 5 }, roomId: 1, active: false,
      ent: { grp: { visible: false } },
      ...pos(11, 7, 7, 3)
    };
    const { g, W, H } = twoRooms({ monsters: [monster] });
    const hero = { data: { hp: 10 }, ...pos(W, H, 4, 3) };

    g.updateVisionField([hero], 8);
    g.recalculateFog({ _roomCleared: () => false });

    expect(monster.ent.grp.visible).toBe(true);   // rendered
    expect(monster.active).toBe(false);           // but still asleep
    expect(g.revealed[at(W, 7, 3)]).toBe(0);      // and not "been there"
  });
});
