/* ─────────────── Jittering counts as stuck ───────────────
 * Reported symptom: leave the game idling, come back, and the party is standing
 * in a room shuffling on the spot — never in combat, never recovering.
 *
 * The stagnant-displacement check sampled the leader's position ONLY while
 * `leader.moving` was true, and wiped its whole buffer the moment that went
 * false. Jitter is exactly an alternation between "moved a hair" and "wedged",
 * so the buffer never reached the 5 samples (1s) the test needs; and because
 * `leader.moving` was true on most of those frames, the recovery branch reset
 * stuckT every frame too. The leader could therefore shuffle in place forever
 * without ever being classified as stuck.
 */
import { describe, it, expect } from 'vitest';
import { exploreMethods } from '../src/game/explore.js';

/**
 * A leader that alternates a hair of movement with a blocked frame.
 *
 * Note the construction order: exploreMethods FIRST, then the stubs, so the
 * stubs win. Assigning the mixin last silently replaces every stub with the
 * real implementation and the harness quietly tests nothing.
 */
function jitterGame({ blockedByDoor = false, searching = -1, stragglerAt = null } = {}) {
  const leader = {
    x: 10, z: 10, moving: false, pathI: 0, path: [400, 500], pathGoal: 500,
    data: { hp: 10, speedMult: 1 }, stuckT: 0, stuckStage: 0,
    ent: { grp: { rotation: { y: 0 } } }, _blockedByDoor: blockedByDoor
  };
  const heroes = [leader];
  if (stragglerAt) {
    heroes.push({ x: stragglerAt, z: stragglerAt, moving: false, pathI: 0, path: null,
      data: { hp: 10, speedMult: 1 }, stuckT: 0, stuckStage: 0,
      ent: { grp: { rotation: { y: 0 } } } });
  }
  let frame = 0;
  const g = Object.assign({}, exploreMethods, {
    /* userGoal stays -1: a player-commanded move deliberately overrides
       cohesion holding, which would mask the regroup case below. The goal comes
       from the room target instead, as it does while idling. */
    state: 'crawl', controlMode: 'auto', userGoal: -1, campAnim: null,
    heroes, monsters: [], chests: [], shrines: [],
    targetRoom: 0, _searchRoom: searching, floorExit: null,
    visitedRooms: new Uint8Array(4), _unreachableRooms: null,
    D: { W: 40, H: 40, roomId: new Int32Array(1600).fill(0),
         rooms: [{ id: 0, cx: 10, cy: 10, w: 8, h: 8 }], doorway: null, chokepoint: null },
    wx: v => v, wz: v => v, cellOf: () => 410,
    partyLeader: a => a[0], findPath: () => [400, 500],
    setEntityPath(e, p) { e.path = p; e.pathI = 0; },
    clearEntityPath(e) { e.path = null; e.pathI = 0; },
    nearFloorCell: c => c, roomTargetCell: () => 500, roomDone: () => false,
    pickNextRoom: () => 0, updatePathVisual() {}, clearPathVisual() {},
    checkInteractables() {}, updateSearch() {},
    blocked: () => true,            // boxed in: no sidestep is available
    isCombatActive: () => false, isCellDoorClosed: () => false,
    nudgeToward: () => false,
    /* The symptom: reports "moving" on most frames, but goes nowhere. */
    stepAlong(e) {
      frame++;
      e.x += (frame % 2 ? 0.01 : -0.01);
      return frame % 5 !== 0;       // an occasional false frame, as real jitter has
    }
  });

  /* Counted for the LEADER only: a stationary follower legitimately gets stuck
     recovery of its own, which would otherwise mask the leader's behaviour. */
  g.leaderStuckCalls = 0;
  g.maxStage = 0;
  const realHandleStuck = exploreMethods.handleStuck;
  g.handleStuck = function (e, l, dt) {
    if (e === leader) this.leaderStuckCalls++;
    const r = realHandleStuck.call(this, e, l, dt);
    if (e === leader) this.maxStage = Math.max(this.maxStage, e.stuckStage || 0);
    return r;
  };
  return { g, leader };
}

const run = (g, seconds, dt = 1 / 30) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    g.exploreAI(g.heroes.filter(h => h.data.hp > 0), g.heroes[0], dt);
  }
};

describe('A jittering leader is treated as stuck', () => {
  it('invokes stuck recovery for a leader shuffling in place', () => {
    const { g, leader } = jitterGame();
    run(g, 3);
    // Before the fix the buffer was wiped every 5th frame, so it never reached
    // 5 samples and this stayed at 0 no matter how long the party shuffled.
    expect(g.leaderStuckCalls).toBeGreaterThan(0);
    expect(Math.hypot(leader.x - 10, leader.z - 10)).toBeLessThan(0.35);
  });

  it('escalates through the recovery ladder instead of resetting forever', () => {
    const { g } = jitterGame();
    run(g, 3);
    expect(g.maxStage).toBeGreaterThanOrEqual(1);
  });

  it('does not fire while the party is regrouping', () => {
    const { g } = jitterGame({ stragglerAt: 40 });   // ally far outside COHESION_HOLD_DIST
    run(g, 2);
    expect(g._cohesionHolding).toBe(true);
    expect(g.heroes[0]._posHistory.length).toBe(0);
    expect(g.leaderStuckCalls).toBe(0);
  });

  it('does not fire while waiting on a door', () => {
    const { g } = jitterGame({ blockedByDoor: true });
    run(g, 2);
    expect(g.heroes[0]._posHistory.length).toBe(0);
  });

  it('does not fire while searching a room', () => {
    const { g } = jitterGame({ searching: 0 });
    run(g, 2);
    expect(g.heroes[0]._posHistory.length).toBe(0);
  });
});
