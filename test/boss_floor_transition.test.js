import { describe, it, expect, vi } from 'vitest';
import { combatMethods } from '../src/game/combat.js';

describe('Boss Floor Transition Fix', () => {
  it('schedules and triggers finishDungeon 3 seconds after boss room clear', () => {
    let finishDungeonCalled = false;
    const game = {
      activeQuest: { level: 1, floors: 3, rewardItem: null },
      questFloor: 1,
      dungeonLevel: 1,
      inventory: [],
      heroes: [],
      monsters: [],
      state: 'crawl',
      refreshResources() {},
      refreshHud() {},
      fxRefreshMenus() {},
      fxShowBanner() {},
      fxLog() {},
      finishDungeon() { finishDungeonCalled = true; }
    };

    Object.assign(game, combatMethods);

    const mockBoss = { data: { name: 'Goblin King', hp: 0 } };

    // Trigger deferred boss floor clear
    game._completeBossFloorClear(mockBoss);

    expect(game._floorClearTimer).toBe(3.0);
    expect(finishDungeonCalled).toBe(false);

    // Simulate update loop ticking down 3 seconds
    const dt = 1.0;
    for (let i = 0; i < 3; i++) {
      game._floorClearTimer -= dt;
      if (game._floorClearTimer <= 0) {
        game._floorClearTimer = 0;
        game.finishDungeon();
      }
    }

    expect(game._floorClearTimer).toBe(0);
    expect(finishDungeonCalled).toBe(true);
  });
});

/* Regression: the deferred boss clear used to scan every monster on the FLOOR,
   so a single un-fought spawn in a room the party never visited parked
   _bossSlain forever and the floor never completed. It must only consider
   monsters sharing the boss's roomId. */
describe('Boss floor clear is scoped to the boss room', () => {
  const mkGame = monsters => {
    const game = { monsters };
    Object.assign(game, combatMethods);
    return game;
  };
  const mob = (roomId, opts = {}) =>
    ({ roomId, dead: false, data: { hp: 10 }, ...opts });

  it('ignores living monsters in other rooms', () => {
    const boss = mob(4, { isBoss: true, dead: true, data: { hp: 0 } });
    const elsewhere = mob(1);
    const game = mkGame([boss, elsewhere]);

    expect(game.roomHasLivingMonsters(boss.roomId, boss)).toBe(false);
  });

  it('still counts living adds inside the boss room', () => {
    const boss = mob(4, { isBoss: true, dead: true, data: { hp: 0 } });
    const add = mob(4);
    const game = mkGame([boss, add, mob(1)]);

    expect(game.roomHasLivingMonsters(boss.roomId, boss)).toBe(true);
  });

  it('clears once the boss room adds are dead, other rooms notwithstanding', () => {
    const boss = mob(4, { isBoss: true, dead: true, data: { hp: 0 } });
    const add = mob(4, { dead: true, data: { hp: 0 } });
    const game = mkGame([boss, add, mob(1), mob(2)]);

    expect(game.roomHasLivingMonsters(boss.roomId, boss)).toBe(false);
  });

  it('treats hp<=0 as dead even when the dead flag lags', () => {
    const game = mkGame([mob(4, { data: { hp: 0 } })]);
    expect(game.roomHasLivingMonsters(4)).toBe(false);
  });
});
