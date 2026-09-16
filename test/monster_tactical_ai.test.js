import { describe, it, expect } from 'vitest';
import {
  monsterAiMethods,
  monsterCombatStyle,
  monsterHurtFrac,
  shouldDisengage,
} from '../src/game/monster_ai.js';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { reservationMethods } from '../src/game/reservation.js';

/* The tactical fallbacks (Dash / Dodge / Disengage) spend the monster's whole
   Action, so they must only fire when they actually pay off. These cover the
   combat-style helper and the gates inside monsterTacticalAction. */

const mon = (over = {}) => ({
  x: 0, z: 0,
  data: { name: 'Goblin', hp: 20, maxHp: 20, speed: 3.0, ranged: false },
  actUsed: false, disengageActive: false,
  path: null, pathI: 0, moveLeft: 4,
  walk: false, moving: false, _stuckT: 0,
  ent: { grp: { rotation: { y: 0 } } },
  ...over
});

const hero = (over = {}) => ({
  x: 1, z: 0, data: { name: 'Hero', hp: 30, maxHp: 30 }, ...over
});

/** Minimal host: real monster tactical methods, stubbed collaborators.
 *  pathfindingMethods is applied FIRST so its shim setEntityPath/clearEntityPath
 *  are available, but the test's stub findPath/approachCellNear win. */
function mkGame(over = {}) {
  const g = {
    initiative: { active: true },
    heroes: [],
    monsters: [],
    isCurrentActor: () => true,
    cellOf: (x, z) => Math.round(x) + Math.round(z) * 100,
    cellsForSpeed: () => 4,
    findPath: () => [0, 1, 2, 3, 4, 5, 6],          // travel = 6 cells by default
    approachCellNear: (c) => c,
    hasLOS: () => true,
    findFleePath: () => null,
    moveStep: () => true,
    nearFloorCell: (c) => c,
    monsterRangedAttack: () => {},
    takeCommonAction: (e, kind) => {
      e.actUsed = true;
      if (kind === 'disengage') e.disengageActive = true;
      return true;
    },
    fxLog() {},
    ...over
  };
  /* monsterKite gates its repath on reservation.js's hasLivePath, the same
     way the hero AI does. Real method, no stub: it only reads e.path/pathI. */
  Object.assign(g, { hasLivePath: reservationMethods.hasLivePath });
  Object.assign(g, pathfindingMethods);
  /* Re-apply stubs that pathfindingMethods just overwrote. */
  g.findPath = over.findPath || (() => [0, 1, 2, 3, 4, 5, 6]);
  g.approachCellNear = over.approachCellNear || ((c) => c);
  g.findFleePath = over.findFleePath || (() => null);
  g.hasLOS = over.hasLOS || (() => true);
  g.nearFloorCell = over.nearFloorCell || ((c) => c);
  g.cellsForSpeed = over.cellsForSpeed || (() => 4);
  Object.assign(g, monsterAiMethods, over);
  return g;
}

const FAR_TGT = { x: 8, z: 0 };      // 8 units away, out of a 1.5 melee reach
const BAND_TGT = { x: 1.6, z: 0 };   // just outside melee reach — the disengage band (1.5 < d <= 1.8)

describe('monsterCombatStyle — role derivation', () => {
  it('honours an explicit tactics override', () => {
    expect(monsterCombatStyle(mon({ data: { tactics: 'berserker', speed: 5 } }))).toBe('berserker');
  });
  it('calls ranged monsters ranged', () => {
    expect(monsterCombatStyle(mon({ data: { ranged: true, speed: 3 } }))).toBe('ranged');
  });
  it('calls bloodFrenzy monsters berserkers', () => {
    expect(monsterCombatStyle(mon({ data: { bloodFrenzy: true, speed: 3 } }))).toBe('berserker');
  });
  it('calls martialAdvantage monsters brutes', () => {
    expect(monsterCombatStyle(mon({ data: { martialAdvantage: true, speed: 3 } }))).toBe('brute');
  });
  it('calls slow sturdy monsters tanks', () => {
    expect(monsterCombatStyle(mon({ data: { speed: 2.5, hp: 60, maxHp: 60 } }))).toBe('tank');
  });
  it('calls fast fragile monsters skirmishers', () => {
    expect(monsterCombatStyle(mon({ data: { speed: 5, hp: 20, maxHp: 20 } }))).toBe('skirmisher');
  });
  it('defaults to standard', () => {
    expect(monsterCombatStyle(mon({ data: { speed: 3, hp: 20, maxHp: 20 } }))).toBe('standard');
  });
});

describe('shouldDisengage — role-gated break-contact', () => {
  it('berserkers never disengage, even when bloodied and pinned', () => {
    const m = mon({ data: { tactics: 'berserker', hp: 2, maxHp: 20 } });
    expect(shouldDisengage(m, { pinned: true })).toBe(false);
  });
  it('bloodied monsters of any non-berserker style disengage', () => {
    const m = mon({ data: { hp: 2, maxHp: 20 } });
    expect(shouldDisengage(m, { pinned: true })).toBe(true);
  });
  it('healthy standard monsters hold the line', () => {
    const m = mon({ data: { hp: 20, maxHp: 20 } });
    expect(shouldDisengage(m, { pinned: true })).toBe(false);
  });
  it('ranged monsters bail out of melee', () => {
    const m = mon({ data: { ranged: true, hp: 20, maxHp: 20 } });
    expect(shouldDisengage(m, { pinned: true })).toBe(true);
    expect(shouldDisengage(m, { pinned: false })).toBe(false);
  });
  it('skirmishers bail out of melee', () => {
    const m = mon({ data: { speed: 5, hp: 20, maxHp: 20 } });
    expect(shouldDisengage(m, { pinned: true })).toBe(true);
  });
  it('brutes eat the opportunity attack unless bloodied', () => {
    const m = mon({ data: { martialAdvantage: true, hp: 20, maxHp: 20 } });
    expect(shouldDisengage(m, { pinned: true })).toBe(false);
    m.data.hp = 2;
    expect(shouldDisengage(m, { pinned: true })).toBe(true);
  });
});

describe('monsterTacticalAction — Dash', () => {
  it('a stationary target is not worth a Dash for a standard monster', () => {
    const m = mon({ moveLeft: 4 });
    const g = mkGame({ heroes: [hero({ x: 8 })] });
    const res = g.monsterTacticalAction(m, FAR_TGT, 8, 0.016);
    expect(res).toBe(false);
    expect(m.actUsed).toBe(false);   // walked instead, kept the Action
  });

  it('a skirmisher Dashes when a double-move lands the strike', () => {
    const m = mon({ moveLeft: 4, data: { name: 'Wisp', speed: 5, hp: 20, maxHp: 20 } });
    const g = mkGame({ heroes: [hero({ x: 8 })] });
    const res = g.monsterTacticalAction(m, FAR_TGT, 8, 0.016);
    expect(res).toBe(true);
    expect(m.actUsed).toBe(true);
    expect(m.path).not.toBeNull();
  });

  it('a standard monster Dashes to chase a fleeing target', () => {
    const m = mon({ moveLeft: 4, _fleeStrike: 3 });
    const g = mkGame({ heroes: [hero({ x: 8 })] });
    const res = g.monsterTacticalAction(m, FAR_TGT, 8, 0.016);
    expect(res).toBe(true);
    expect(m.actUsed).toBe(true);
  });

  it('never Dashes when even a double-move cannot close the gap', () => {
    const m = mon({ moveLeft: 4, data: { name: 'Wisp', speed: 5, hp: 20, maxHp: 20 }, _fleeStrike: 3 });
    const g = mkGame({
      heroes: [hero({ x: 8 })],
      findPath: () => Array.from({ length: 21 }, (_, i) => i), // travel = 20
    });
    const res = g.monsterTacticalAction(m, FAR_TGT, 8, 0.016);
    expect(res).toBe(false);
    expect(m.actUsed).toBe(false);
  });
});

describe('monsterTacticalAction — Dodge', () => {
  it('a healthy, unpinned monster never spends the Action on Dodge', () => {
    const m = mon({ moveLeft: 0 });
    const g = mkGame({ heroes: [hero({ x: 8 })] });
    const res = g.monsterTacticalAction(m, FAR_TGT, 8, 0.016);
    expect(res).toBe(true);          // frame handled — holds ground
    expect(m.actUsed).toBe(false);   // but no Action spent
  });

  it('a bloodied monster braces with Dodge when movement is spent', () => {
    const m = mon({ moveLeft: 0, data: { name: 'Goblin', hp: 5, maxHp: 20, speed: 3 } });
    const g = mkGame({ heroes: [hero({ x: 8 })] });
    const res = g.monsterTacticalAction(m, FAR_TGT, 8, 0.016);
    expect(res).toBe(true);
    expect(m.actUsed).toBe(true);
  });

  it('a brute never Dodges — it holds the line instead', () => {
    const m = mon({ moveLeft: 0, data: { name: 'Ogre', hp: 2, maxHp: 30, speed: 3, martialAdvantage: true } });
    const g = mkGame({ heroes: [hero({ x: 8 })] });
    const res = g.monsterTacticalAction(m, FAR_TGT, 8, 0.016);
    expect(res).toBe(true);
    expect(m.actUsed).toBe(false);
  });
});

describe('monsterTacticalAction — Disengage', () => {
  it('a healthy standard monster pinned in melee does not Disengage', () => {
    const m = mon({ moveLeft: 4 });
    const g = mkGame({ heroes: [hero({ x: 1.6, z: 0 })] });
    const res = g.monsterTacticalAction(m, BAND_TGT, 1.6, 0.016);
    expect(res).toBe(false);         // falls through to close and fight
    expect(m.actUsed).toBe(false);
  });

  it('a bloodied standard monster pinned in melee Disengages and flees', () => {
    const m = mon({ moveLeft: 4, data: { name: 'Goblin', hp: 2, maxHp: 20, speed: 3 } });
    const g = mkGame({ heroes: [hero({ x: 1.6, z: 0 })] });
    const res = g.monsterTacticalAction(m, BAND_TGT, 1.6, 0.016);
    expect(res).toBe(true);
    expect(m.actUsed).toBe(true);
  });

  it('a bloodied berserker pinned in melee still refuses to Disengage', () => {
    const m = mon({ moveLeft: 4, data: { name: 'Frenzy', hp: 2, maxHp: 20, speed: 5, bloodFrenzy: true } });
    const g = mkGame({
      heroes: [hero({ x: 1.6, z: 0 })],
      findPath: () => [0, 1],          // essentially already in reach → no Dash either
    });
    const res = g.monsterTacticalAction(m, BAND_TGT, 1.6, 0.016);
    expect(res).toBe(false);           // falls through to press the attack
    expect(m.actUsed).toBe(false);
    expect(m.disengageActive).toBe(false);
  });
});

describe('monsterKite — ranged disengage gate', () => {
  it('a healthy ranged monster pinned by one hero does not Disengage every turn', () => {
    const m = mon({ data: { name: 'Slinger', hp: 20, maxHp: 20, speed: 3, ranged: true, rngRange: 6 } });
    const pinner = hero({ x: 1.6, z: 0 });
    const g = mkGame({ heroes: [pinner], monsters: [] });
    g.monsterKite(m, { x: 10, z: 0 }, pinner, 0.016);
    expect(m.actUsed).toBe(false);
    expect(m.disengageActive).toBe(false);
  });

  it('a bloodied ranged monster Disengages before retreating', () => {
    const m = mon({ data: { name: 'Slinger', hp: 5, maxHp: 20, speed: 3, ranged: true, rngRange: 6 } });
    const pinner = hero({ x: 1.6, z: 0 });
    const g = mkGame({ heroes: [pinner], monsters: [] });
    g.monsterKite(m, { x: 10, z: 0 }, pinner, 0.016);
    expect(m.actUsed).toBe(true);
    expect(m.disengageActive).toBe(true);
  });

  it('a ranged monster double-pinned by melee Disengages to escape', () => {
    const m = mon({ data: { name: 'Slinger', hp: 20, maxHp: 20, speed: 3, ranged: true, rngRange: 6 } });
    const g = mkGame({
      heroes: [hero({ x: 1.6, z: 0 }), hero({ x: 0.5, z: 1.2 })],
      monsters: [],
    });
    const pinner = g.heroes[0];
    g.monsterKite(m, { x: 10, z: 0 }, pinner, 0.016);
    expect(m.actUsed).toBe(true);
    expect(m.disengageActive).toBe(true);
  });
});

describe('monsterHurtFrac', () => {
  it('reports 0 at full HP and 1 at zero', () => {
    expect(monsterHurtFrac(mon({ data: { hp: 20, maxHp: 20 } }))).toBe(0);
    expect(monsterHurtFrac(mon({ data: { hp: 0, maxHp: 20 } }))).toBe(1);
  });
});

describe('monsterTrackFlee / monsterTargetFleeing', () => {
  it('only flags a target that backs away across consecutive windows', () => {
    const m = mon({});
    const g = mkGame({ heroes: [hero({ x: 8 })] });
    // Two ~0.6s windows of the target moving away by 0.2/frame.
    const frames = [6, 6.2, 6.4, 6.6, 6.8, 7.0, 7.2, 7.4, 7.6, 7.8];
    for (const d of frames.slice(0, 4)) g.monsterTrackFlee(m, d, 0.2); // 1st window
    expect(g.monsterTargetFleeing(m)).toBe(false); // only one window so far
    for (const d of frames.slice(4)) g.monsterTrackFlee(m, d, 0.2);   // 2nd window
    expect(g.monsterTargetFleeing(m)).toBe(true);
  });

  it('does not flag a stationary or approaching target', () => {
    const m = mon({});
    const g = mkGame({ heroes: [hero({ x: 8 })] });
    for (let i = 0; i < 8; i++) g.monsterTrackFlee(m, 6, 0.2);        // stationary
    expect(g.monsterTargetFleeing(m)).toBe(false);
    for (let i = 0; i < 8; i++) g.monsterTrackFlee(m, 6 - i * 0.2, 0.2); // approaching
    expect(g.monsterTargetFleeing(m)).toBe(false);
  });
});
