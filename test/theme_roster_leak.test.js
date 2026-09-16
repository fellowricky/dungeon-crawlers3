import { describe, it, expect } from 'vitest';
import { spawnMonster, dungeonMonsterIds, MONSTERS_ALL } from '../src/game/srd.js';
import { crForDungeonLevel } from '../src/game/constants.js';

const THEMES = ['ancient', 'molten', 'frost', 'grim', 'verdant'];

describe('dungeon roster is authoritative for spawns', () => {
  it.each(THEMES)('elite packs on a non-final floor stay on the %s roster', (theme) => {
    /* Mirrors game.js onDungeon: the boss room of a non-final floor hosts an
       elite pack. It used to pass allowedNames = null, so it rolled the entire
       bestiary — that is how a level-4 grim crypt fielded dryads. */
    const roster = new Set(dungeonMonsterIds(theme));
    expect(roster.size).toBeGreaterThan(0);

    for (let level = 1; level <= 10; level++) {
      for (let floor = 1; floor <= 4; floor++) {
        const questInfo = { dungeonLevel: level, questFloor: floor, floors: floor + 1 };
        const targetCR = crForDungeonLevel(level + (floor - 1) * 0.5);
        for (let i = 0; i < 12; i++) {
          const spec = spawnMonster(targetCR, level, Math.random,
            dungeonMonsterIds(theme), questInfo, 'miniboss');
          expect(roster.has(spec.id),
            `${spec.id} (cr ${spec.cr}) is not on the ${theme} roster ` +
            `(level ${level}, floor ${floor}, targetCR ${targetCR})`).toBe(true);
        }
      }
    }
  });

  it('keeps the roster when no monster on it fits the CR window', () => {
    /* A thin CR band must relax the CR window, not the roster. Two low-CR
       creatures asked for a CR-12 spawn: the answer is the closest one on the
       list, never something imported from the rest of the bestiary. */
    const tiny = MONSTERS_ALL.filter(m => m.cr <= 0.25).slice(0, 2).map(m => m.id);
    expect(tiny.length).toBe(2);

    for (let i = 0; i < 50; i++) {
      const spec = spawnMonster(12, 12, Math.random, tiny,
        { dungeonLevel: 12, questFloor: 1, floors: 1 });
      expect(tiny).toContain(spec.id);
    }
  });

  it('still falls back to the bestiary when the roster is genuinely empty', () => {
    const spec = spawnMonster(2, 4, Math.random, [],
      { dungeonLevel: 4, questFloor: 1, floors: 1 });
    expect(spec).toBeTruthy();
    expect(spec.id).toBeTruthy();
  });

  it('spawns exactly one monster per slot, whatever the roster looks like', () => {
    /* Body count belongs to the generator's spawn-budget purse, which already
       bought and priced this slot. spawnMonster picks the species for one paid
       slot and must never inflate the count behind the budget's back. */
    const weak = MONSTERS_ALL.filter(m => m.cr === 0.25).slice(0, 3).map(m => m.id);
    const qi = { dungeonLevel: 10, questFloor: 1, floors: 1 };
    for (const tcr of [0.5, 1, 2, 3, 6, 10]) {
      const s = spawnMonster(tcr, 10, Math.random, weak, qi);
      expect(Array.isArray(s)).toBe(false);
      expect(s.packCount).toBeUndefined();
    }
  });

  it('does not list the dryad as a grim-dungeon creature', () => {
    /* The reported symptom, pinned to its data source. */
    expect(dungeonMonsterIds('grim')).not.toContain('dryad');
    expect(dungeonMonsterIds('verdant')).toContain('dryad');
  });
});

describe('bosses no longer carry an isBoss tag', () => {
  it('no monster in the bestiary has an isBoss flag', () => {
    /* Boss fights are curated (finalBossId / boss_encounters.json), so the
       data flag was only ever leaking "boss" monsters into regular room
       spawns. Pinned: the roster must stay free of it. */
    expect(MONSTERS_ALL.filter(m => m.isBoss)).toHaveLength(0);
  });

  it.each(THEMES)('themed regular spawns never return a boss', (theme) => {
    const roster = dungeonMonsterIds(theme);
    expect(roster.length).toBeGreaterThan(0);
    for (let level = 1; level <= 10; level++) {
      const questInfo = { dungeonLevel: level, questFloor: 1, floors: 2 };
      for (let i = 0; i < 12; i++) {
        const spec = spawnMonster(crForDungeonLevel(level), level, Math.random, roster, questInfo);
        expect(spec.isBoss, `${spec.id} spawned as a boss`).toBeFalsy();
      }
    }
  });
});
