/* Abilities and spells run on the combat clock in WHOLE rounds — never on
   real time and never on a fraction of a round. These tests pin the
   September 2026 sweep that removed the last live-timer leftovers:
     - applyEffect snaps every duration up to whole rounds
     - Silence stops spellcasting (heroes, cantrips, monster casters) rather
       than shaving AC on a real-time timer
     - Protection from Evil's "immune" clause actually exists (warded)
     - Misty Step / Dimension Door move the caster instead of buffing AC
     - the AI pacing gate counts rounds, not seconds since the fight began */
import { describe, it, expect, vi } from 'vitest';
import {
  applyEffect, hasEffect, EFFECTS, ROUND_SECONDS, wholeRounds, roundDuration
} from '../src/game/conditions.js';
import { combatMethods } from '../src/game/combat.js';
import { SPELLS } from '../src/game/spells.js';
import { pickAttackProfile } from '../src/game/srd.js';
import { FEATS, featOnHit } from '../src/game/features.js';

describe('durations are whole rounds', () => {
  it('wholeRounds / roundDuration round UP and never below one round', () => {
    expect(wholeRounds(2)).toBe(1);
    expect(wholeRounds(6)).toBe(1);
    expect(wholeRounds(8)).toBe(2);
    expect(wholeRounds(60)).toBe(10);
    expect(roundDuration(10)).toBe(12);
    expect(roundDuration(Infinity)).toBe(Infinity);
  });

  it('applyEffect snaps a sub-round or off-grid duration up to whole rounds', () => {
    const e = { data: { type: 'humanoid' } };
    applyEffect(e, 'slowed', { duration: 2.5, elapsed: 100 });
    expect(e._effects.slowed.until).toBe(100 + ROUND_SECONDS);
    applyEffect(e, 'poisoned', { duration: 10, elapsed: 100 });
    expect(e._effects.poisoned.until).toBe(100 + 2 * ROUND_SECONDS);
    applyEffect(e, 'inspired', { duration: Infinity, elapsed: 100 });
    expect(e._effects.inspired.until).toBe(Infinity);
  });

  it('feat on-hit riders are authored in rounds and last at least one', () => {
    for (const f of Object.values(FEATS)) {
      if (!f.onHit || !f.onHit.effect) continue;
      expect(f.onHit.duration).toBeUndefined();
      expect(Number.isInteger(f.onHit.rounds)).toBe(true);
      expect(f.onHit.rounds).toBeGreaterThanOrEqual(1);
    }
    const h = { feats: ['tavernBrawler'] };
    const seen = [];
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0);   // pass every chance roll
    try {
      const out = featOnHit(h, { melee: true, hasShield: false, crit: false });
      seen.push(...out.effects);
    } finally { rnd.mockRestore(); }
    expect(seen.length).toBe(1);
    expect(seen[0].duration % ROUND_SECONDS).toBe(0);
  });

  it('no player-facing spell, feature or effect text talks in seconds', () => {
    const texts = [
      ...Object.values(SPELLS).map(s => s.desc || ''),
      ...Object.values(EFFECTS).map(e => e.desc || ''),
      ...Object.values(FEATS).map(f => f.desc || ''),
    ];
    const offenders = texts.filter(t => /\b\d+(\.\d+)?\s*(s|sec|secs|second|seconds)\b/i.test(t) || /each second|per second/i.test(t));
    expect(offenders).toEqual([]);
  });
});

describe('silenced', () => {
  it('is a real effect and blocks a hero spell in resolveSpell', () => {
    expect(EFFECTS.silenced).toBeDefined();
    const game = Object.assign({ fxNow: 0, fxLog: () => {} }, combatMethods);
    game.canUseSpellRecharge = () => true;
    game.checkCounterspellInterrupt = () => false;
    const h = { data: { name: 'Wiz', hp: 10 } };
    applyEffect(h, 'silenced', { duration: ROUND_SECONDS * 3, elapsed: 0 });
    expect(game.resolveSpell(h, 'shield', null, [h])).toBe(false);
  });

  it('drops a caster onto their weapon instead of a cantrip', () => {
    const d = {
      cantripProfile: { name: 'Fire Bolt', cantripScale: true, source: 'cantrip', range: 6 },
      weaponProfile: { name: 'Dagger', dmg: [1, 4], melee: true, ability: 'dex' },
      aiPrefs: { rangedPref: 1.0 },
    };
    expect(pickAttackProfile(d).name).toBe('Fire Bolt');
    applyEffect({ data: d }, 'silenced', { duration: ROUND_SECONDS, elapsed: 0 });
    expect(pickAttackProfile(d).name).toBe('Dagger');
  });

  it('Silence applies the effect for 3 whole rounds and no longer touches AC', () => {
    /* stubs go AFTER combatMethods so the real fx/hud plumbing is replaced */
    const game = Object.assign({}, combatMethods, {
      fxNow: 0, fxLog: () => {}, playAbilityFx: () => {}, markSpellUsed: () => {},
      monsters: [],
    });
    const foe = { x: 0, z: 0, active: true, data: { name: 'Shaman', hp: 10, ac: 13 } };
    game.monsters = [foe];
    const h = { x: 1, z: 0, data: { name: 'Bard', hp: 10 } };
    expect(SPELLS.silence.cast(game, h, foe)).toBe(true);
    expect(foe.data.ac).toBe(13);
    expect(hasEffect(foe, 'silenced')).toBe(true);
    expect(foe._effects.silenced.until).toBe(3 * ROUND_SECONDS);
  });
});

describe('Protection from Evil wards against charm and fear', () => {
  it('applies warded and applyEffect then refuses charmed / frightened', () => {
    const game = Object.assign({}, combatMethods, { fxNow: 0, fxLog: () => {}, playAbilityFx: () => {}, markSpellUsed: () => {} });
    const h = { data: { name: 'Cleric', hp: 10, type: 'humanoid' } };
    applyEffect(h, 'charmed', { duration: 60, elapsed: 0 });
    expect(SPELLS.protectionFromEvil.cast(game, h)).toBe(true);
    expect(hasEffect(h, 'charmed')).toBe(false);
    expect(hasEffect(h, 'warded')).toBe(true);
    expect(applyEffect(h, 'charmed', { duration: 60, elapsed: 0 })).toBe(false);
    expect(applyEffect(h, 'frightened', { duration: 60, elapsed: 0 })).toBe(false);
    expect(applyEffect(h, 'poisoned', { duration: 60, elapsed: 0 })).toBe(true);
  });
});

/* A 9x9 open room, hero in the middle, one monster right next to them. */
function roomGame() {
  const W = 9, H = 9;
  const grid = new Array(W * H).fill(1);
  const game = Object.assign({}, combatMethods, {
    fxNow: 0, fxLog: () => {}, playAbilityFx: () => {}, markSpellUsed: () => {},
    D: { W, H, grid },
    heroes: [], monsters: [],
    wx: x => x - W / 2 + 0.5,
    wz: y => y - H / 2 + 0.5,
    hasLOS: () => true,
  });
  game.cellOf = (x, z) => {
    const cx = Math.round(x + W / 2 - 0.5), cy = Math.round(z + H / 2 - 0.5);
    return (cx < 0 || cy < 0 || cx >= W || cy >= H) ? -1 : cy * W + cx;
  };
  return game;
}

describe('Misty Step and Dimension Door are movement spells', () => {
  it('Misty Step relocates the caster away from the nearest foe and grants no AC', () => {
    const game = roomGame();
    const h = { x: 0, z: 0, data: { name: 'Sorc', hp: 5, maxHp: 20 } };
    const foe = { x: 1, z: 0, active: true, data: { name: 'Orc', hp: 10 } };
    game.heroes = [h]; game.monsters = [foe];
    const before = Math.hypot(foe.x - h.x, foe.z - h.z);
    expect(SPELLS.mistyStep.cast(game, h)).toBe(true);
    const after = Math.hypot(foe.x - h.x, foe.z - h.z);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(6 * Math.SQRT2 + 1e-6);   // inside the 6-tile radius
    expect(hasEffect(h, 'phaseStep')).toBe(false);
  });

  it('Misty Step keeps the slot when nowhere is further from every foe', () => {
    const game = roomGame();
    /* solid walls everywhere except the hero's own cell */
    game.D.grid.fill(0); game.D.grid[game.cellOf(0, 0)] = 1;
    const h = { x: 0, z: 0, data: { name: 'Sorc', hp: 5 } };
    game.heroes = [h]; game.monsters = [{ x: 1, z: 0, active: true, data: { hp: 10 } }];
    const used = vi.fn(); game.markSpellUsed = used;
    expect(SPELLS.mistyStep.cast(game, h)).toBe(false);
    expect(used).not.toHaveBeenCalled();
  });

  it('Dimension Door takes the adjacent ally along', () => {
    const game = roomGame();
    const h = { x: 0, z: 0, data: { name: 'Wiz', hp: 5 } };
    const ally = { x: 1, z: 0, data: { name: 'Rogue', hp: 5 } };
    const foe = { x: -1, z: 0, active: true, data: { name: 'Orc', hp: 10 } };
    game.heroes = [h, ally]; game.monsters = [foe];
    expect(SPELLS.dimensionDoor.cast(game, h)).toBe(true);
    expect(Math.hypot(foe.x - h.x, foe.z - h.z)).toBeGreaterThan(1);
    expect(Math.hypot(ally.x - h.x, ally.z - h.z)).toBeLessThanOrEqual(Math.SQRT2 + 1e-6);
    expect(hasEffect(h, 'phaseStep')).toBe(false);
  });
});

describe('AI pacing gate counts rounds on the combat clock', () => {
  it('_combatRound advances with fxNow, not with real time', () => {
    const game = Object.assign({ fxNow: 100, elapsed: 0 }, combatMethods);
    game._combatEngagedAt = 100;
    expect(game._combatRound()).toBe(1);
    expect(game._combatStable(1)).toBe(true);
    expect(game._combatStable(2)).toBe(false);
    game.elapsed = 9999;                 // a long real-time wait changes nothing
    expect(game._combatStable(2)).toBe(false);
    game.fxNow = 100 + ROUND_SECONDS;    // one full pass of the initiative order
    expect(game._combatRound()).toBe(2);
    expect(game._combatStable(2)).toBe(true);
  });

  it('every spell AI gate is a whole round count', () => {
    for (const [k, sp] of Object.entries(SPELLS)) {
      if (!sp.ai) continue;
      expect(sp.ai.minCombatSec, k).toBeUndefined();
      if (sp.ai.minCombatRound != null) expect(Number.isInteger(sp.ai.minCombatRound), k).toBe(true);
    }
  });
});
