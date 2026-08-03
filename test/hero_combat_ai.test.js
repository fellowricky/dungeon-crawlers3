import { describe, it, expect } from 'vitest';
import { combatMethods } from '../src/game/combat.js';

/* Hero-side counterparts to the monster AI's tactical checks. Monsters have
   avoided opportunity attacks since the OA system landed; heroes did not, and
   ranged heroes never backed out of melee. These cover both decisions. */

/* cellOf is stubbed to 55, so a hero "standing on 55" with path [56] is about
   to step OUT of that square — which is what provokes an opportunity attack.
   Kite checks require no active path (they only fire at the start of a turn). */
const hero = (over = {}) => ({
  x: 5, z: 5, data: { name: 'Archer', hp: 30, maxHp: 30, speedMult: 1, aiPrefs: {} },
  path: null, pathI: 0, actUsed: false, moveLeft: 6,
  ...over
});

const steppingOut = (over = {}) => hero({ path: [56], pathI: 0, ...over });

const mon = (over = {}) => ({
  x: 5.5, z: 5, active: true, data: { name: 'Goblin', hp: 10 }, ...over
});

/** Minimal host: real combat methods, stubbed collaborators. */
function mkGame(over = {}) {
  const g = {
    initiative: { active: true },
    monsters: [],
    cellOf: () => 55,
    cellsForSpeed: () => 6,
    hasteMult: () => 1,
    moveStep: () => true,
    findFleePath: () => [55, 44, 33],
    oaHostiles: () => [],
    fxLog() {},
    playAbilityFx() {},
    log: [],
    ...over
  };
  Object.assign(g, combatMethods, over);
  return g;
}

const MELEE = { melee: true, range: 1.4 };
const BOW = { melee: false, range: 7 };

describe('Hero avoids opportunity-attack risk', () => {
  it('Disengages rather than eating a free hit when leaving a threatened square', () => {
    const h = steppingOut();
    let disengaged = false;
    const g = mkGame({
      cellOf: () => 55,
      oaHostiles: () => [{ entity: mon(), threatened: new Set([55]) }],
      takeCommonAction: (e, kind) => {
        if (kind !== 'disengage') return false;
        disengaged = true; e.disengageActive = true; return true;
      }
    });

    // Disengage succeeds → the step is now safe, so the caller may proceed.
    expect(g.heroAvoidOA(h, mon(), MELEE)).toBe(false);
    expect(disengaged).toBe(true);
  });

  it('holds position instead of taking a free hit when the action is spent', () => {
    const h = steppingOut({ actUsed: true });
    const foe = mon({ x: 5.5, z: 5 });          // already within melee reach
    const g = mkGame({
      oaHostiles: () => [{ entity: foe, threatened: new Set([55]) }],
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
      oaHostiles: () => [{ entity: mon(), threatened: new Set([55]) }],
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
      oaHostiles: () => [{ entity: mon(), threatened: new Set([55, 56]) }],
      cellOf: () => 55,
      takeCommonAction: () => { throw new Error('should not act'); }
    });
    h.path = [56];
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

describe('Ranged heroes kite out of melee', () => {
  it('backs a pinned archer out of melee, spending Disengage', () => {
    const h = hero();
    let disengaged = false;
    const g = mkGame({
      monsters: [mon()],
      takeCommonAction: (e, kind) => {
        if (kind !== 'disengage') return false;
        disengaged = true; return true;
      }
    });

    expect(g.heroKite(h, BOW, 0.016)).toBe(true);
    expect(disengaged).toBe(true);
    expect(h.path).toEqual([55, 44, 33]);
  });

  it('leaves melee heroes to hold the line', () => {
    const g = mkGame({
      monsters: [mon()],
      takeCommonAction: () => { throw new Error('melee hero should not kite'); }
    });
    expect(g.heroKite(hero(), MELEE, 0.016)).toBe(false);
  });

  it('ignores ranged attackers standing nearby — only melee pins a shooter', () => {
    const g = mkGame({
      monsters: [mon({ data: { name: 'Archer', hp: 10, ranged: true } })],
      takeCommonAction: () => { throw new Error('a ranged foe should not pin') }
    });
    expect(g.heroKite(hero(), BOW, 0.016)).toBe(false);
  });

  it('respects a hold-position hero (combatMovement 0)', () => {
    const h = hero();
    h.data.aiPrefs = { combatMovement: 0 };
    const g = mkGame({
      monsters: [mon()],
      takeCommonAction: () => { throw new Error('should honour hold position'); }
    });
    expect(g.heroKite(h, BOW, 0.016)).toBe(false);
  });

  it('does not kite mid-move, only at the start of a turn', () => {
    const h = hero({ moveLeft: 1 });            // already spent most of its movement
    const g = mkGame({
      monsters: [mon()],
      takeCommonAction: () => { throw new Error('should not kite mid-move'); }
    });
    expect(g.heroKite(h, BOW, 0.016)).toBe(false);
  });

  it('stands and shoots when cornered with no flee route', () => {
    const h = hero();
    const g = mkGame({
      monsters: [mon()],
      findFleePath: () => null,
      takeCommonAction: () => true
    });
    expect(g.heroKite(h, BOW, 0.016)).toBe(true);
    expect(h.moving).toBe(false);
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
    const h = hero();
    h.data.aiPrefs = { movementStyle: 'hold' };
    const g = mkGame({
      monsters: [mon()],
      takeCommonAction: () => { throw new Error('should honour hold ground movementStyle'); }
    });
    expect(g.heroKite(h, BOW, 0.016)).toBe(false);
  });
});
