import { describe, it, expect } from 'vitest';
import {
  spellArea, areaTargets, bestAim, offensiveSpellPlan, spellDamageProfile,
  targetPlanBonus, foeClosingTiles, planMonsterAbility,
  heroRole, tankFormationBonus, standRisk, healTriage, monsterTargetReach,
} from '../src/game/turn_planner.js';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import { applyEffect } from '../src/game/conditions.js';
import { combatMethods } from '../src/game/combat.js';
import { SPELLS } from '../src/game/spells.js';

/* A flat 30x30 floor. One world unit = one tile; cell (cx, cy) sits at
   x = cx - 15 + 0.5, matching the game's wx/wz. */
const W = 30;
function mkGame(heroes, monsters, extra = {}) {
  return {
    D: { W, H: W, grid: new Int32Array(W * W).fill(1) },
    cellOf: (x, z) => {
      const cx = Math.round(x + W / 2 - 0.5), cy = Math.round(z + W / 2 - 0.5);
      return (cx < 0 || cy < 0 || cx >= W || cy >= W) ? -1 : cy * W + cx;
    },
    heroes, monsters,
    hasLOS: () => true,
    cellsForSpeed: (e) => (e && e.data && e.data.speedCells) || 6,
    damageModifier: () => null,
    ...extra,
  };
}
const at = (cx, cy) => ({ x: cx - W / 2 + 0.5, z: cy - W / 2 + 0.5 });
function monster(name, cx, cy, hp, more = {}) {
  return { ...at(cx, cy), active: true,
    data: { name, hp, maxHp: more.maxHp || hp, ac: 12, atk: 4, dmg: [1, 8, 2], saves: {}, cr: 2, ...more } };
}
function wizard(cx, cy, lvl = 7) {
  return { ...at(cx, cy), data: {
    name: 'Mira', classKey: 'wizard', level: lvl, hp: 40, maxHp: 40, atkProf: 3, _classAtk: 'int',
    effStats: { int: 18, dex: 14, str: 8 }, slots: { 1: 4, 2: 3, 3: 3 }, dmgBonus: 0,
    cantripProfile: { name: 'Fire Bolt', isSave: true, saveAbility: 'dex', ability: 'int', dmg: [1, 10], range: 12, melee: false, cantripScale: true },
    lastProfile: null, aiPrefs: {},
  } };
}

describe('turn planner — area footprints', () => {
  it('Lightning Bolt is a line, not an 8-tile disc', () => {
    const area = spellArea(SPELLS.lightningBolt);
    expect(area.shape).toBe('line');
    const h = wizard(5, 15);
    const onLine = monster('orc', 10, 15, 30), offLine = monster('orc', 10, 20, 30);
    const g = mkGame([h], [onLine, offLine]);
    const hit = areaTargets(g, h, area, onLine);
    expect(hit).toContain(onLine);
    expect(hit).not.toContain(offLine);
  });

  it('aims a line through the creature that lines the most foes up', () => {
    const h = wizard(5, 15);
    const a = monster('a', 9, 15, 30), b = monster('b', 13, 15, 30), lone = monster('lone', 8, 9, 30);
    const g = mkGame([h], [lone, a, b]);
    const plan = bestAim(g, h, spellArea(SPELLS.lightningBolt), {});
    expect(plan.useful).toBe(2);
    expect(plan.targets).toEqual(expect.arrayContaining([a, b]));
  });
});

describe('turn planner — damage spells must beat attacking', () => {
  it('reads dice and saves from the spell description', () => {
    const p = spellDamageProfile('fireball', SPELLS.fireball);
    expect(p.avg).toBe(28);
    expect(p.save).toBe('dex');
    expect(p.half).toBe(true);
  });

  it('no Fireball on a single nearly-dead goblin', () => {
    const h = wizard(5, 15);
    const gob = monster('goblin', 10, 15, 4, { maxHp: 12 });
    const g = mkGame([h], [gob]);
    const plan = offensiveSpellPlan(g, h, 'fireball', SPELLS.fireball, gob, [h]);
    expect(plan.worth).toBe(false);
  });

  it('a Fireball on three healthy ogres is worth the slot', () => {
    const h = wizard(5, 15);
    const ogres = [monster('ogre', 10, 15, 59), monster('ogre', 11, 16, 59), monster('ogre', 10, 17, 59)];
    const g = mkGame([h], ogres);
    const plan = offensiveSpellPlan(g, h, 'fireball', SPELLS.fireball, ogres[0], [h]);
    expect(plan.worth).toBe(true);
    expect(plan.useful).toBe(3);
  });

  it('no single-target slot on a foe the cantrip would finish', () => {
    const h = wizard(5, 15);
    h.data.lastProfile = h.data.cantripProfile;
    const rat = monster('rat', 8, 15, 3, { maxHp: 7 });
    const g = mkGame([h], [rat]);
    const plan = offensiveSpellPlan(g, h, 'guidingBolt', SPELLS.guidingBolt, rat, [h], { profile: h.data.cantripProfile });
    expect(plan.worth).toBe(false);
  });
});

describe('turn planner — target choice', () => {
  it('a melee hero values the monster on the wizard over an equal one across the room', () => {
    const fighter = { ...at(10, 15), data: { name: 'Aldric', classKey: 'fighter', hp: 50, maxHp: 50,
      lastProfile: { melee: true, range: 1.5, ability: 'str', dmg: [1, 8] } } };
    const wiz = wizard(12, 15);
    wiz.data.lastProfile = wiz.data.cantripProfile;
    const onWizard = monster('ghoul', 13, 15, 22);
    const farAway = monster('ghoul', 28, 28, 22);
    const g = mkGame([fighter, wiz], [onWizard, farAway]);
    const near = targetPlanBonus(g, fighter, onWizard, [fighter, wiz], 6, 1, true);
    const far = targetPlanBonus(g, fighter, farAway, [fighter, wiz], 6, 1, true);
    expect(near).toBeGreaterThan(far + 2);
  });

  it('an unreachable foe scores far below a reachable one', () => {
    const fighter = { ...at(10, 15), data: { name: 'Aldric', hp: 50, maxHp: 50 } };
    const m = monster('ghoul', 14, 15, 22);
    const g = mkGame([fighter], [m]);
    expect(targetPlanBonus(g, fighter, m, [fighter], 6, 1, true, Infinity))
      .toBeLessThan(targetPlanBonus(g, fighter, m, [fighter], 6, 1, true, 4) - 4);
  });
});

describe('turn planner — Dash', () => {
  const dashGame = (foe, heroAt = at(2, 15)) => {
    const h = { ...heroAt, moveLeft: 6, data: { name: 'Rogue', hp: 30, maxHp: 30 } };
    const g = mkGame([h], [foe]);
    g.dashSavesATurn = combatMethods.dashSavesATurn;
    return { g, h };
  };

  it('does not Dash at a melee foe that is walking to us anyway', () => {
    const ogre = monster('ogre', 20, 15, 59, { speedCells: 8 });
    const { g, h } = dashGame(ogre);
    expect(foeClosingTiles(g, ogre)).toBe(8);
    /* 18 tiles: the old rule (18 > 6 + 6) dashed; the ogre closes 8 of them */
    expect(g.dashSavesATurn(h, 18, ogre)).toBe(false);
  });

  it('still Dashes at a shooter that will hold its ground', () => {
    const archer = monster('archer', 20, 15, 20, { ranged: true });
    const { g, h } = dashGame(archer);
    expect(g.dashSavesATurn(h, 18, archer)).toBe(true);
  });

  it('will not run a long detour round a wall to a foe that can come to us', () => {
    const wyrm = monster('wyrmling', 11, 15, 52, { speedCells: 2 });
    const { g, h } = dashGame(wyrm);
    /* 9 tiles away as the crow flies, 60 the long way round */
    expect(g.dashSavesATurn(h, 60, wyrm)).toBe(false);
  });
});

describe('turn planner — monster abilities', () => {
  const breath = { key: 'breath', trigger: 'cycle', aoe: 2, dice: [6, 6, 0], label: 'Breath' };
  const bite = { key: 'bite', trigger: 'cycle', dice: [2, 6, 0], label: 'Bite' };
  const heal = { key: 'mend', trigger: 'cycle', heal: [2, 8, 2], label: 'Mend' };
  const hero = (cx, cy) => ({ ...at(cx, cy), data: { name: 'h', hp: 30, maxHp: 30 } });

  it('holds an area ability while the party is spread out', () => {
    const m = monster('drake', 15, 15, 40);
    const heroes = [hero(10, 10), hero(20, 20), hero(10, 20)];
    const g = mkGame(heroes, [m]);
    const pick = planMonsterAbility(g, m, heroes[0], [breath]);
    expect(pick).toBeNull();
  });

  it('aims it at the clump, not the current target', () => {
    const m = monster('drake', 15, 15, 40);
    const lone = hero(10, 10), a = hero(18, 15), b = hero(19, 15), c = hero(18, 16);
    const g = mkGame([lone, a, b, c], [m]);
    const pick = planMonsterAbility(g, m, lone, [breath, bite]);
    expect(pick.ab).toBe(breath);
    expect([a, b, c]).toContain(pick.target);
  });

  it('does not heal when nobody is hurt', () => {
    const m = monster('shaman', 15, 15, 30);
    const g = mkGame([hero(17, 15)], [m]);
    expect(planMonsterAbility(g, m, g.heroes[0], [heal])).toBeNull();
    m.data.hp = 10;
    expect(planMonsterAbility(g, m, g.heroes[0], [heal]).ab).toBe(heal);
  });
});

describe('phase 2 — roles', () => {
  const melee = { melee: true, range: 1.5, ability: 'str', dmg: [1, 8] };
  it('derives tank, healer, artillery and striker from the build', () => {
    expect(heroRole({ data: { classKey: 'fighter', lastProfile: melee } })).toBe('tank');
    expect(heroRole({ data: { classKey: 'rogue', lastProfile: melee,
      equipment: { offhand: { slot: 'shield' } } } })).toBe('tank');
    expect(heroRole({ data: { classKey: 'cleric', lastProfile: { melee: false }, knownSpells: ['cureWounds'] } })).toBe('healer');
    expect(heroRole({ data: { classKey: 'wizard', lastProfile: { melee: false }, knownSpells: ['fireball'] } })).toBe('artillery');
    expect(heroRole({ data: { classKey: 'monk', lastProfile: melee } })).toBe('striker');
  });
});

describe('phase 2 — the tank holds the line', () => {
  const tank = () => ({ ...at(10, 15), data: { name: 'Aldric', classKey: 'fighter', hp: 50, maxHp: 50,
    lastProfile: { melee: true, range: 1.5 } } });
  const wiz = () => { const w = wizard(8, 15); w.data.lastProfile = w.data.cantripProfile; return w; };

  it('prefers the monster about to reach the wizard', () => {
    const t = tank(), w = wiz();
    const charging = monster('ghoul', 13, 15, 22, { speedCells: 6 });   // 5 tiles from the wizard
    const g = mkGame([t, w], [charging]);
    expect(tankFormationBonus(g, t, charging, [t, w])).toBeGreaterThan(1);
  });

  it('is pulled back from a far fight while the backline is threatened', () => {
    const t = tank(), w = wiz();
    const far = monster('rat', 27, 27, 5);
    const charging = monster('ghoul', 13, 15, 22, { speedCells: 6 });
    const g = mkGame([t, w], [far, charging]);
    expect(tankFormationBonus(g, t, far, [t, w])).toBeLessThan(0);
  });
});

describe('phase 2 — triage', () => {
  const healer = () => ({ ...at(5, 5), data: { name: 'Odric', classKey: 'cleric', hp: 30, maxHp: 30,
    _classAtk: 'wis', effStats: { wis: 16 } } });
  const ally = (name, cx, cy, hp, maxHp) => ({ ...at(cx, cy), data: { name, hp, maxHp, ac: 15 } });
  const cure = { desc: 'Strong touch heal on the most-wounded ally (1d8 + mod).' };

  it('heals the ally about to drop, not the lowest HP fraction', () => {
    const c = healer();
    const fighter = ally('fighter', 6, 5, 20, 60);     // 33%, nothing near
    const wizardA = ally('wizard', 20, 20, 9, 20);     // 45%, an ogre on her
    const ogre = monster('ogre', 21, 20, 59, { dmg: [2, 8, 4], atk: 6 });
    const g = mkGame([c, fighter, wizardA], [ogre], { heroAC: () => 12 });
    const t = healTriage(g, c, [c, fighter, wizardA], cure);
    expect(t.target).toBe(wizardA);
    expect(t.urgent).toBe(true);
  });

  it('a downed ally comes first', () => {
    const c = healer();
    const down = ally('rogue', 6, 6, 0, 30);
    const hurt = ally('fighter', 6, 5, 10, 60);
    const g = mkGame([c, down, hurt], []);
    expect(healTriage(g, c, [c, hurt], cure).target).toBe(down);
  });

  it('nobody missing HP → nothing to heal', () => {
    const c = healer();
    const g = mkGame([c], []);
    expect(healTriage(g, c, [c], cure)).toBeNull();
  });
});

describe('phase 2 — firing positions', () => {
  it('a tile beside a melee monster is riskier than one behind the line', () => {
    const h = wizard(5, 15);
    const ogre = monster('ogre', 15, 15, 59, { speedCells: 6 });
    const g = mkGame([h], [ogre]);
    const beside = g.cellOf(at(14, 15).x, at(14, 15).z);
    const behind = g.cellOf(at(5, 15).x, at(5, 15).z);
    expect(standRisk(g, h, beside)).toBeGreaterThan(standRisk(g, h, behind) + 3);
  });
});

describe('phase 3 — monsters', () => {
  const hero = (cx, cy, hp = 30) => ({ ...at(cx, cy), data: { name: 'h', hp, maxHp: 30 } });

  it('prefers a hero it can reach this turn over one across a wall', () => {
    const m = monster('ghoul', 10, 15, 22, { speedCells: 6 });
    const near = hero(14, 15), walled = hero(13, 20);
    const g = mkGame([near, walled], [m], {
      initiative: { active: true, round: 1, idx: 0 }, isCurrentActor: () => true,
      approachCellNear: (c) => c,
      /* the far hero is only reachable the long way round */
      findPath: (from, to) => (to === g.cellOf(walled.x, walled.z) ? new Array(40).fill(0) : new Array(5).fill(0)),
    });
    expect(monsterTargetReach(g, m, near)).toBe(3);
    expect(monsterTargetReach(g, m, walled)).toBeLessThan(0);
  });

  it('a shooter scores heroes it has a shot at', () => {
    const m = monster('archer', 10, 15, 20, { ranged: true, rngRange: 8 });
    const g = mkGame([hero(14, 15)], [m]);
    expect(monsterTargetReach(g, m, g.heroes[0])).toBe(3);
    g.hasLOS = () => false;
    expect(monsterTargetReach(g, m, g.heroes[0])).toBe(0);
  });

  it('swings at the hero beside it instead of walking off toward a far target', () => {
    const m = monster('ogre', 10, 15, 59, { speedCells: 6 });
    m.moveLeft = 0;
    const beside = hero(11, 15);
    const g = mkGame([beside], [m]);
    g.D.W = W;
    Object.assign(g, { monsterAdjacentHero: monsterAiMethods.monsterAdjacentHero,
      monsterReachesThisTurn: monsterAiMethods.monsterReachesThisTurn });
    expect(g.monsterAdjacentHero(m)).toBe(beside);
    expect(g.monsterReachesThisTurn(m, hero(25, 25))).toBe(false);
  });

  it('never puts a condition on a hero who already has it', () => {
    const m = monster('lich', 15, 15, 90);
    const held = hero(17, 15), free = hero(18, 16);
    applyEffect(held, 'paralyzed', { duration: 60, elapsed: 0 });
    const g = mkGame([held, free], [m]);
    const hold = { key: 'holdPerson', effect: { key: 'paralyzed', dur: 6 }, label: 'Hold' };
    const pick = planMonsterAbility(g, m, held, [hold]);
    expect(pick.target).toBe(free);
    applyEffect(free, 'paralyzed', { duration: 60, elapsed: 0 });
    expect(planMonsterAbility(g, m, held, [hold])).toBeNull();
  });
});
