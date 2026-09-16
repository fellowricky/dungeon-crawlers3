import { describe, it, expect } from 'vitest';
import { generateDungeon, roomSpawnCap, getSpawnBudget } from '../src/dungeon/dungeon_generator.js';

describe('Spawn Budget Level Caps Enforcement', () => {
  it('strictly caps standard Level 4 dungeon rooms to 7 units, while allowing hordes to exceed', () => {
    const sb = getSpawnBudget();
    expect(sb.levelCurve[4].spawnCap).toBe(7);
    expect(roomSpawnCap(4)).toBe(7);

    let foundHorde = false;
    for (let seed = 1; seed <= 40; seed++) {
      const d = generateDungeon({ seed, roomCount: 30, level: 4, theme: 'ancient' });
      const spawnsByRoom = {};
      for (const sp of d.spawns) {
        (spawnsByRoom[sp.roomId] ||= []).push(sp);
      }
      for (const [roomId, roomSpawns] of Object.entries(spawnsByRoom)) {
        const style = roomSpawns[0]?.roomStyle;
        const isHorde = style === 'swarm' || style === 'nest';
        if (isHorde) {
          foundHorde = true;
          // Horde rooms bypass the standard 7 cap up to hordeMaxSpawns (18)
          expect(roomSpawns.length, `horde room ${roomId} in seed ${seed}`)
            .toBeLessThanOrEqual(sb.hordeMaxSpawns ?? 18);
        } else {
          // Standard rooms and other tactical rooms must strictly obey the level curve's 7 cap
          expect(roomSpawns.length, `standard room ${roomId} in seed ${seed} (${style || 'generic'})`)
            .toBeLessThanOrEqual(7);
        }
      }
    }
    expect(foundHorde).toBe(true);
  });

  it('demonstrates that Infestation and Nest can field larger swarms than standard cap', () => {
    const sb = getSpawnBudget();
    let sawBiggerSwarm = false;
    for (let seed = 1; seed <= 60; seed++) {
      const d = generateDungeon({ seed, roomCount: 35, level: 4, theme: 'ancient' });
      const spawnsByRoom = {};
      for (const sp of d.spawns) {
        (spawnsByRoom[sp.roomId] ||= []).push(sp);
      }
      for (const roomSpawns of Object.values(spawnsByRoom)) {
        const style = roomSpawns[0]?.roomStyle;
        if ((style === 'swarm' || style === 'nest') && roomSpawns.length > 7) {
          sawBiggerSwarm = true;
          break;
        }
      }
      if (sawBiggerSwarm) break;
    }
    expect(sawBiggerSwarm).toBe(true);
  });

  it('respects custom level curve caps dynamically from getSpawnBudget for standard rooms', () => {
    const sb = getSpawnBudget();
    const custom = JSON.parse(JSON.stringify(sb));
    custom.levelCurve[4].spawnCap = 3;

    expect(roomSpawnCap(4, custom)).toBe(3);
  });
});
