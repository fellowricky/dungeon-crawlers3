/* ─────────────── The party must not oscillate between two targets ───────────
 * Captured from a live stall: leader `moving: true` with a valid 13-cell path,
 * no cohesion hold, no door wait, not searching, `combat: false`, a target room
 * set — and `posHistory: 0`. An empty buffer while actively walking means the
 * detector was being wiped every frame, which only happens on a repath.
 *
 * Cause: roomTargetCell picks the nearest living monster to the LEADER, fresh
 * every frame with a bare `<` tiebreak. Two roughly equidistant monsters swap
 * which one is nearest as the leader edges toward one, so the goal cell flips,
 * the caller repaths, and the stall detector's history is wiped with it. The
 * party lurches on the spot between two targets indefinitely — and dormant
 * monsters never activate, so no fight ever breaks the tie.
 */
import { describe, it, expect } from 'vitest';
import { exploreMethods } from '../src/game/explore.js';
import { ROOM_TARGET_SWITCH_MARGIN } from '../src/game/constants.js';

/** Two dormant monsters straddling the leader, as in the captured stall. */
function twoMonsterRoom() {
  const W = 100;
  const mk = (x, z) => ({ x, z, roomId: 7, active: false, data: { hp: 10 } });
  const g = Object.assign({}, exploreMethods, {
    D: { W, H: 100, grid: new Uint8Array(10000).fill(1), rooms: [] },
    monsters: [mk(8, 10), mk(12, 10)],
    chests: [], shrines: [], floorExit: null,
    roomAnchor: [], _roomTargetMon: null,
    cellOf(x, z) { return Math.round(z) * W + Math.round(x); },
    nearFloorCell: c => c
  });
  return g;
}

describe('Room target stability', () => {
  it('does not flip targets as the leader edges between two equidistant monsters', () => {
    const g = twoMonsterRoom();
    const leader = { x: 10, z: 10 };
    const seen = new Set();
    // Walk the leader back and forth across the midpoint, as jitter does.
    for (let i = 0; i < 40; i++) {
      leader.x = 10 + (i % 2 ? 0.05 : -0.05);
      seen.add(g.roomTargetCell(7, leader));
    }
    expect(seen.size).toBe(1);
  });

  it('still switches when another monster is clearly closer', () => {
    const g = twoMonsterRoom();
    const leader = { x: 8.5, z: 10 };
    const first = g.roomTargetCell(7, leader);      // locks onto the near one
    leader.x = 11.8;                                 // now decisively by the other
    const second = g.roomTargetCell(7, leader);
    expect(second).not.toBe(first);
  });

  it('keeps following a target that moves', () => {
    const g = twoMonsterRoom();
    const leader = { x: 8.2, z: 10 };
    const target = g.monsters[0];
    const before = g.roomTargetCell(7, leader);
    target.z = 13;                                   // it wanders
    const after = g.roomTargetCell(7, leader);
    expect(after).not.toBe(before);
    expect(after).toBe(g.cellOf(target.x, target.z));
  });

  it('drops the sticky target when it dies', () => {
    const g = twoMonsterRoom();
    const leader = { x: 8.5, z: 10 };
    g.roomTargetCell(7, leader);
    g.monsters[0].data.hp = 0;
    const next = g.roomTargetCell(7, leader);
    expect(next).toBe(g.cellOf(g.monsters[1].x, g.monsters[1].z));
  });

  it('uses a margin wide enough to cover a jitter-sized wobble', () => {
    // The oscillation is driven by sub-tile leader movement; the margin has to
    // exceed that comfortably or it buys nothing.
    expect(ROOM_TARGET_SWITCH_MARGIN).toBeGreaterThan(0.5);
  });
});
