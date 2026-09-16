import { describe, it, expect } from 'vitest';
import { combatMethods } from '../src/game/combat.js';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { reachTiles } from '../src/game/combat_eval.js';

/* Hero-side counterparts to the monster AI's tactical checks. Monsters have
   avoided opportunity attacks since the OA system landed; heroes did not, and
   ranged heroes never backed out of melee. These cover both decisions. */

/* These exercise real grid geometry now: reach is measured in TILES
   (combat_eval.gridDist), so the host needs a genuine cellOf/wx/wz rather than
   a constant. The hero sits at world (5,5); HERO_CELL is its tile and
   STEP_CELL the tile one square east, so a path of [STEP_CELL] means "about to
   step out of the square I am standing in" — which is what provokes an
   opportunity attack. */
const GW = 32;
const gridOf = () => ({
  D: { W: GW, H: GW, grid: new Int32Array(GW * GW) },
  cellOf(x, z) {
    const cx = Math.round(x + GW / 2 - 0.5), cy = Math.round(z + GW / 2 - 0.5);
    return (cx < 0 || cy < 0 || cx >= GW || cy >= GW) ? -1 : cy * GW + cx;
  },
  wx: (cx) => cx - GW / 2 + 0.5,
  wz: (cy) => cy - GW / 2 + 0.5,
});
const GRID = gridOf();
const HERO_CELL = GRID.cellOf(5, 5);
const STEP_CELL = HERO_CELL + 1;

const hero = (over = {}) => ({
  x: 5, z: 5, data: { name: 'Archer', hp: 30, maxHp: 30, speedMult: 1, aiPrefs: {} },
  path: null, pathI: 0, actUsed: false, moveLeft: 6,
  ...over
});

const steppingOut = (over = {}) => hero({ path: [STEP_CELL], pathI: 0, ...over });

/* One tile east of the hero — adjacent, therefore inside melee reach. */
const mon = (over = {}) => ({
  x: 6, z: 5, active: true, data: { name: 'Goblin', hp: 10, maxHp: 10, dmg: [1, 6, 2] }, ...over
});

/** Minimal host: real combat methods, stubbed collaborators.
 *  pathfindingMethods is applied FIRST so its shim setEntityPath/clearEntityPath
 *  are available, but the test's stub findFleePath/etc win. */
function mkGame(over = {}) {
  const g = {
    ...gridOf(),
    initiative: { active: true },
    monsters: [],
    heroes: [],
    isCurrentActor: () => true,
    cellsForSpeed: () => 6,
    hasteMult: () => 1,
    moveStep: () => true,
    findFleePath: () => [HERO_CELL, HERO_CELL - 1, HERO_CELL - 2],
    oaHostiles: () => [],
    takeCommonAction: (e) => { e.actUsed = true; return true; },
    fxLog() {},
    playAbilityFx() {},
    log: [],
    ...over
  };
  Object.assign(g, pathfindingMethods);
  /* Re-apply stubs that pathfindingMethods just overwrote. */
  const grid = gridOf();
  g.cellOf = over.cellOf || grid.cellOf;
  g.wx = over.wx || grid.wx;
  g.wz = over.wz || grid.wz;
  g.D = over.D || grid.D;
  g.cellsForSpeed = over.cellsForSpeed || (() => 6);
  g.findFleePath = over.findFleePath || (() => [HERO_CELL, HERO_CELL - 1, HERO_CELL - 2]);
  Object.assign(g, combatMethods, over);
  return g;
}

const MELEE = { melee: true, range: 1.4 };
const BOW = { melee: false, range: 7 };

describe('Hero avoids opportunity-attack risk', () => {
  it('a healthy melee hero holds ground instead of burning Disengage', () => {
    const h = steppingOut();
    const g = mkGame({
      oaHostiles: () => [{ entity: mon(), threatened: new Set([HERO_CELL]) }],
      takeCommonAction: (e, kind) => {
        if (kind !== 'disengage') return false;
        throw new Error('healthy melee hero should not Disengage');
      }
    });

    // Foe is within reach → stand and fight beats a free hit and a wasted turn.
    expect(g.heroAvoidOA(h, mon(), MELEE)).toBe(true);
    expect(h.path).toBeNull();
    expect(h.moving).toBe(false);
  });

  /* A reposition is never worth the whole Action. heroAvoidOA used to spend
     Disengage mid-approach, which produced the "hero runs up to a monster and
     then disengages, doing nothing" turn. It must never spend the Action now —
     it either stands and fights or accepts the free hit and walks on. */
  it('never spends the Action on Disengage mid-approach, even bloodied', () => {
    const h = steppingOut({ data: { name: 'Archer', hp: 5, maxHp: 30, speedMult: 1, aiPrefs: {} } });
    const far = mon({ x: 20, z: 20 });   // nothing in reach, so the step matters
    const g = mkGame({
      oaHostiles: () => [{ entity: mon(), threatened: new Set([HERO_CELL]) }],
      takeCommonAction: () => { throw new Error('must not spend the Action to reposition'); }
    });

    expect(g.heroAvoidOA(h, far, MELEE)).toBe(false);   // accept the OA, keep walking
    expect(h.actUsed).toBe(false);
  });

  it('a pinned ranged hero stands and shoots rather than burning its turn', () => {
    const h = steppingOut();
    const adjacent = mon({ x: 5.5, z: 5 });   // inside bow range → can just shoot
    const g = mkGame({
      oaHostiles: () => [{ entity: adjacent, threatened: new Set([HERO_CELL]) }],
      hasLOS: () => true,
      takeCommonAction: () => { throw new Error('should shoot, not Disengage'); }
    });

    expect(g.heroAvoidOA(h, adjacent, BOW)).toBe(true);  // hold, then attack
    expect(h.actUsed).toBe(false);
    expect(h.moving).toBe(false);
  });

  it('holds position instead of taking a free hit when the action is spent', () => {
    const h = steppingOut({ actUsed: true });
    const foe = mon({ x: 5.5, z: 5 });          // already within melee reach
    const g = mkGame({
      oaHostiles: () => [{ entity: foe, threatened: new Set([HERO_CELL]) }],
      takeCommonAction: () => false             // no action left to Disengage with
    });

    expect(g.heroAvoidOA(h, foe, MELEE)).toBe(true);
    expect(h.path).toBeNull();
    expect(h.moving).toBe(false);
  });

  it('accepts the hit when the reposition genuinely matters', () => {
    const h = steppingOut({ actUsed: true });
    const far = mon({ x: 20, z: 20 });          // nothing in reach to stand and fight
    const g = mkGame({
      oaHostiles: () => [{ entity: mon(), threatened: new Set([HERO_CELL]) }],
      takeCommonAction: () => false
    });

    // Standing still achieves nothing here, so moving (and eating the OA) wins.
    expect(g.heroAvoidOA(h, far, MELEE)).toBe(false);
    expect(h.path).not.toBeNull();
  });

  it('does not fire when the step stays inside the threatened area', () => {
    const h = steppingOut();
    const g = mkGame({
      // Both from and to are threatened → no OA (5e: only leaving reach provokes)
      oaHostiles: () => [{ entity: mon(), threatened: new Set([HERO_CELL, STEP_CELL]) }],
      takeCommonAction: () => { throw new Error('should not act'); }
    });
    h.path = [STEP_CELL];
    expect(g.heroAvoidOA(h, mon(), MELEE)).toBe(false);
  });

  it('is inert outside a tactical spotlight', () => {
    const h = steppingOut();
    const g = mkGame({
      initiative: { active: false },
      oaHostiles: () => { throw new Error('should not be consulted'); }
    });
    expect(g.heroAvoidOA(h, mon(), MELEE)).toBe(false);
  });
});

/* The withdrawal now happens AFTER the attack and costs no Action, so it can
   never blank a turn. These cover the replacement, heroPostAttackWithdraw. */
describe('Pinned shooters give ground after firing', () => {
  it('walks a pinned archer clear on leftover movement, spending no Action', () => {
    const h = hero({ actUsed: true });          // the shot has already gone off
    const g = mkGame({
      monsters: [mon()],
      takeCommonAction: () => { throw new Error('withdrawal must not cost the Action'); }
    });

    expect(g.heroPostAttackWithdraw(h, BOW, 0.016)).toBe(true);
    expect(h.path).toEqual([HERO_CELL, HERO_CELL - 1, HERO_CELL - 2]);
    expect(h.actUsed).toBe(true);               // unchanged — the attack spent it
  });

  it('leaves melee heroes to hold the line', () => {
    const g = mkGame({ monsters: [mon()] });
    expect(g.heroPostAttackWithdraw(hero({ actUsed: true }), MELEE, 0.016)).toBe(false);
  });

  it('ignores ranged attackers standing nearby — only melee pins a shooter', () => {
    const g = mkGame({
      monsters: [mon({ data: { name: 'Archer', hp: 10, ranged: true } })],
    });
    expect(g.heroPostAttackWithdraw(hero({ actUsed: true }), BOW, 0.016)).toBe(false);
  });

  it('respects a hold-position hero (Combat Positioning: Hold Ground)', () => {
    const h = hero({ actUsed: true });
    h.data.aiPrefs = { movementStyle: 'hold' };
    const g = mkGame({ monsters: [mon()] });
    expect(g.heroPostAttackWithdraw(h, BOW, 0.016)).toBe(false);
  });

  it('does not bother when barely any movement is left', () => {
    const h = hero({ actUsed: true, moveLeft: 1 });
    const g = mkGame({ monsters: [mon()], cellsForSpeed: () => 6 });
    expect(g.heroPostAttackWithdraw(h, BOW, 0.016)).toBe(false);
  });

  it('stays put when cornered — never gives up the turn for nothing', () => {
    const h = hero({ actUsed: true });
    const g = mkGame({
      monsters: [mon()],
      findFleePath: () => null,
      takeCommonAction: () => { throw new Error('cornered must not cost anything'); }
    });
    expect(g.heroPostAttackWithdraw(h, BOW, 0.016)).toBe(false);
    expect(h.path).toBeNull();
  });
});

describe('Hero Target Selection & Tactical Directives', () => {
  it('prioritizes adjacent threats over distant low-HP monsters (nearest threat)', () => {
    const h = hero({ x: 5, z: 5 });
    h.data.aiPrefs = { targeting: 'nearest' };

    const adjacentFullHp = mon({ x: 6, z: 5, data: { name: 'Orc', hp: 30, maxHp: 30 } });
    const distantLowHp = mon({ x: 30, z: 5, data: { name: 'Goblin', hp: 2, maxHp: 20 } });

    const g = mkGame({
      monsters: [adjacentFullHp, distantLowHp],
      heroes: [h]
    });

    const chosen = g.pickHeroTarget(h, [h]);
    expect(chosen).toBe(adjacentFullHp);
  });

  it('targets bosses / casters when boss_caster directive is active', () => {
    const h = hero({ x: 5, z: 5 });
    h.data.aiPrefs = { targeting: 'boss_caster' };

    const minion = mon({ x: 8, z: 5, data: { name: 'Skeleton', hp: 20, maxHp: 20 } });
    const boss = mon({ x: 10, z: 5, isBoss: true, data: { name: 'Necromancer Boss', hp: 50, maxHp: 50 } });

    const g = mkGame({
      monsters: [minion, boss],
      heroes: [h]
    });

    const chosen = g.pickHeroTarget(h, [h]);
    expect(chosen).toBe(boss);
  });

  it('respects movementStyle "hold"', () => {
    const h = hero({ actUsed: true });
    h.data.aiPrefs = { movementStyle: 'hold' };
    const g = mkGame({
      monsters: [mon()],
      takeCommonAction: () => { throw new Error('should honour hold ground movementStyle'); }
    });
    expect(g.heroPostAttackWithdraw(h, BOW, 0.016)).toBe(false);
  });
});

/* The standoff band is a place to STAND, so it is whole tiles (5 ft steps) —
   fractional bands could never be occupied exactly, leaving heroes creeping
   toward a distance they could not land on and re-pathing at every drift. */
describe('desiredStandoff — per-weapon, per-style firing band, in tiles', () => {
  const styled = (movementStyle) => {
    const h = hero();
    h.data.aiPrefs = { movementStyle };
    return h;
  };

  it('always lands on a whole tile', () => {
    const g = mkGame();
    for (const style of ['kite', 'hold', 'standard', 'flank']) {
      const v = g.desiredStandoff(styled(style), BOW);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('kite backs off further than standard, hold further still', () => {
    const g = mkGame();
    const kite = g.desiredStandoff(styled('kite'), BOW);
    const standard = g.desiredStandoff(styled('standard'), BOW);
    const hold = g.desiredStandoff(styled('hold'), BOW);
    expect(kite).toBeGreaterThan(standard);
    expect(hold).toBeGreaterThanOrEqual(kite);
  });

  it('keeps the standoff inside the weapon range — a shot must connect', () => {
    const g = mkGame();
    for (const style of ['kite', 'hold', 'standard']) {
      expect(g.desiredStandoff(styled(style), BOW)).toBeLessThan(reachTiles(BOW));
    }
  });

  it('never parks a shooter in melee, even with a short-ranged weapon', () => {
    const g = mkGame();
    const shortBow = { melee: false, range: 3 };
    expect(g.desiredStandoff(styled('standard'), shortBow)).toBeGreaterThanOrEqual(2);
  });

  it('reach melee stands at the end of its reach — 10 ft, not point-blank', () => {
    const g = mkGame();
    expect(g.desiredStandoff(styled('kite'), { melee: true, reach: true, range: 2.5 })).toBe(2);
  });

  it('normal melee hugs the adjacent tile — 5 ft', () => {
    const g = mkGame();
    expect(g.desiredStandoff(styled('standard'), MELEE)).toBe(1);
  });
});

describe('Hero tactical Dash / Dodge gating', () => {
  it('a healthy standard hero with no movement left holds ground, not Dodge', () => {
    const h = hero({ moveLeft: 0 });
    const g = mkGame({ monsters: [] });
    const res = g.heroTacticalAction(h, mon({ x: 20, z: 20 }), [h], 15, MELEE, 0.016);
    expect(res).toBe(true);          // frame handled — holds
    expect(h.actUsed).toBe(false);   // but no Action spent
  });

  it('a bloodied hero braces with Dodge when movement is spent', () => {
    const h = hero({ moveLeft: 0, data: { name: 'Fighter', hp: 8, maxHp: 30, speedMult: 1, aiPrefs: {} } });
    const g = mkGame({ monsters: [] });
    const res = g.heroTacticalAction(h, mon({ x: 20, z: 20 }), [h], 15, MELEE, 0.016);
    expect(res).toBe(true);
    expect(h.actUsed).toBe(true);
  });

  it('a hold-ground hero never auto-Dodges, even when bloodied', () => {
    const h = hero({ moveLeft: 0, data: { name: 'Tank', hp: 8, maxHp: 30, speedMult: 1, aiPrefs: { movementStyle: 'hold' } } });
    const g = mkGame({ monsters: [] });
    const res = g.heroTacticalAction(h, mon({ x: 20, z: 20 }), [h], 15, MELEE, 0.016);
    expect(res).toBe(true);
    expect(h.actUsed).toBe(false);
  });

  it('a standard hero does not Dash at a stationary target', () => {
    const h = hero({ moveLeft: 6 });
    const g = mkGame({
      monsters: [],
      findPath: () => [55, 56, 57, 58, 59, 60, 61, 62], // travel 7 → a double move would close
      approachCellNear: (c) => c,
    });
    const res = g.heroTacticalAction(h, mon({ x: 20, z: 20 }), [h], 15, MELEE, 0.016);
    expect(res).toBe(false);
    expect(h.actUsed).toBe(false);
  });

  /* Dash costs the Action, so you can NEVER attack on the turn you Dash. With
     R tiles to go, M movement left and speed S, it only brings the first attack
     forward when R > M + S. The old rule (R > S && R <= 2S) was exactly the
     band where Dashing gains nothing — it arrives sooner but attacks on the
     same turn, so it was pure loss. Restricting it to flankers hid the cost. */
  describe('dashSavesATurn', () => {
    const h = (moveLeft) => hero({ moveLeft, data: { name: 'Rogue', hp: 30, maxHp: 30, speedMult: 1, aiPrefs: {} } });
    const g = () => mkGame({ cellsForSpeed: () => 6 });

    it('refuses when the target is already reachable this turn', () => {
      expect(g().dashSavesATurn(h(6), 4)).toBe(false);
    });

    it('refuses in the band where you attack on the same turn either way', () => {
      /* 6 left + 6 speed = 12: walking arrives next turn and attacks next turn;
         Dashing arrives now but cannot attack until next turn. No gain. */
      expect(g().dashSavesATurn(h(6), 10)).toBe(false);
      expect(g().dashSavesATurn(h(6), 12)).toBe(false);
    });

    it('takes it when it genuinely removes a turn from the approach', () => {
      expect(g().dashSavesATurn(h(6), 13)).toBe(true);
      expect(g().dashSavesATurn(h(6), 20)).toBe(true);
    });

    it('accounts for movement already spent this turn', () => {
      /* Only 1 tile of movement left: the break-even point drops to 1 + 6. */
      expect(g().dashSavesATurn(h(1), 6)).toBe(false);
      expect(g().dashSavesATurn(h(1), 8)).toBe(true);
    });

    it('never fires for zero distance', () => {
      expect(g().dashSavesATurn(h(6), 0)).toBe(false);
    });
  });

  it('Dashes toward a target too far to reach this turn', () => {
    const h = hero({ moveLeft: 6, data: { name: 'Rogue', hp: 30, maxHp: 30, speedMult: 1, aiPrefs: {} } });
    const g = mkGame({
      monsters: [],
      cellsForSpeed: () => 6,
      findPath: () => Array.from({ length: 21 }, (_, i) => i),   // travel 20 > 6+6
      approachCellNear: (c) => c,
    });
    const res = g.heroTacticalAction(h, mon({ x: 20, z: 20 }), [h], 15, MELEE, 0.016);
    expect(res).toBe(true);
    expect(h.actUsed).toBe(true);
    expect(h.path).not.toBeNull();
  });

  it('walks instead of Dashing when Dashing would not save a turn', () => {
    const h = hero({ moveLeft: 6, data: { name: 'Rogue', hp: 30, maxHp: 30, speedMult: 1, aiPrefs: {} } });
    const g = mkGame({
      monsters: [],
      cellsForSpeed: () => 6,
      findPath: () => [55, 56, 57, 58, 59, 60, 61, 62],   // travel 7, inside 6+6
      approachCellNear: (c) => c,
    });
    const res = g.heroTacticalAction(h, mon({ x: 20, z: 20 }), [h], 15, MELEE, 0.016);
    expect(res).toBe(false);
    expect(h.actUsed).toBe(false);
  });

  it('a hold-ground hero never Dashes', () => {
    const h = hero({ moveLeft: 6, data: { name: 'Tank', hp: 30, maxHp: 30, speedMult: 1, aiPrefs: { movementStyle: 'hold' } } });
    const g = mkGame({
      monsters: [],
      findPath: () => [55, 56, 57, 58, 59, 60, 61, 62],
      approachCellNear: (c) => c,
    });
    const res = g.heroTacticalAction(h, mon({ x: 20, z: 20 }), [h], 15, MELEE, 0.016);
    expect(res).toBe(false);
    expect(h.actUsed).toBe(false);
  });
});

describe('Hero tactical helpers', () => {
  /* Disengage costs the whole Action to dodge (typically) one opportunity
     attack — a losing trade in almost every situation. It is now gated on
     "nothing to hit from here" AND "two or more melee attackers" AND real
     danger, rather than firing for every ranged profile. */
  describe('heroShouldDisengage', () => {
    const bigMon = (over = {}) => mon({
      data: { name: 'Ogre', hp: 40, maxHp: 40, dmg: [2, 8, 4], atk: 6 }, ...over
    });

    it('refuses when the hero can hit something from where it stands', () => {
      const h = hero();
      const g = mkGame({ monsters: [bigMon({ x: 5.5, z: 5 }), bigMon({ x: 4.5, z: 5 })], hasLOS: () => true });
      expect(g.heroShouldDisengage(h, BOW)).toBe(false);
      expect(g.heroShouldDisengage(h, MELEE)).toBe(false);
    });

    it('refuses against a single attacker — one free hit is not worth a turn', () => {
      const h = hero();
      const g = mkGame({ monsters: [bigMon({ x: 5.5, z: 5 })], hasLOS: () => false });
      expect(g.heroShouldDisengage(h, BOW)).toBe(false);
    });

    it('allows it when swarmed with nothing to swing at', () => {
      const h = hero({ x: 5, z: 5, data: { name: 'Mage', hp: 6, maxHp: 30, speedMult: 1, aiPrefs: {} } });
      const g = mkGame({
        monsters: [bigMon({ x: 5.6, z: 5 }), bigMon({ x: 4.4, z: 5 }), bigMon({ x: 5, z: 5.6 })],
        hasLOS: () => false,      // no shot available from here
      });
      expect(g.heroShouldDisengage(h, BOW)).toBe(true);
    });

    it('never fires for a hold-ground hero', () => {
      const h = hero({ data: { name: 'Tank', hp: 5, maxHp: 30, speedMult: 1, aiPrefs: { movementStyle: 'hold' } } });
      const g = mkGame({ monsters: [bigMon({ x: 5.5, z: 5 }), bigMon({ x: 4.5, z: 5 })], hasLOS: () => false });
      expect(g.heroShouldDisengage(h, MELEE)).toBe(false);
    });
  });

  it('heroUnderPressure: bloodied or double-pinned counts, one neighbor does not', () => {
    const g = mkGame({});
    const bloodied = hero({ data: { name: 'Fighter', hp: 8, maxHp: 30, speedMult: 1, aiPrefs: {} } });
    expect(g.heroUnderPressure(bloodied)).toBe(true);

    const healthy = hero({ data: { name: 'Fighter', hp: 30, maxHp: 30, speedMult: 1, aiPrefs: {} } });
    const one = mon({ x: 5.5, z: 5 });
    const two = mon({ x: 4.5, z: 5 });
    const crowded = hero({ data: { name: 'Fighter', hp: 30, maxHp: 30, speedMult: 1, aiPrefs: {} } });
    const g2 = mkGame({ monsters: [one] });
    expect(g2.heroUnderPressure(healthy)).toBe(false);
    const g3 = mkGame({ monsters: [one, two] });
    expect(g3.heroUnderPressure(crowded)).toBe(true);
  });
});
