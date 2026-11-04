import { describe, it, expect } from 'vitest';
import { chooseLightShrine, LIGHT_SHRINE_CHANCE, generateOverland } from '../src/dungeon/dungeon_generator.js';

const shrine = (x, flag = false) => ({ kind: 'shrineCrystal', x, y: 0, lightShrine: flag });

describe('Shrine of Light: at most one per floor', () => {
  it('never marks more than one shrine, and hits about LIGHT_SHRINE_CHANCE of floors', () => {
    let floors = 0, lit = 0;
    for (let seed = 1; seed <= 4000; seed++) {
      const props = [shrine(1), shrine(2), shrine(3)];
      chooseLightShrine(props, seed);
      const n = props.filter(p => p.lightShrine).length;
      expect(n).toBeLessThanOrEqual(1);
      floors++; lit += n;
    }
    expect(lit / floors).toBeGreaterThan(LIGHT_SHRINE_CHANCE - 0.03);
    expect(lit / floors).toBeLessThan(LIGHT_SHRINE_CHANCE + 0.03);
  });

  it('a floor without ordinary shrines has none, and the rival room shrine is never picked', () => {
    for (let seed = 1; seed <= 500; seed++) {
      expect(chooseLightShrine([], seed)).toBeNull();
      const rival = { kind: 'shrineCrystal', x: 9, y: 9 };          // no lightShrine flag
      chooseLightShrine([rival], seed);
      expect(rival.lightShrine).toBeUndefined();
    }
  });

  it('is decided by the seed: the same floor always gets the same answer', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const a = [shrine(1), shrine(2)], b = [shrine(1), shrine(2)];
      chooseLightShrine(a, seed); chooseLightShrine(b, seed);
      expect(a.map(p => p.lightShrine)).toEqual(b.map(p => p.lightShrine));
    }
  });

  it('never appears on an overland map (it is a dungeon feature)', () => {
    let shrines = 0;
    for (const themeKey of ['holdfast', 'forest', 'moor', 'mire', 'boneyard']) {
      for (let seed = 1; seed <= 12; seed++) {
        const d = generateOverland({ seed: seed * 977, themeKey, level: 5, mapW: 66, mapH: 100, zones: 6 });
        for (const p of d.props) {
          if (p.kind !== 'shrineCrystal') continue;
          shrines++;
          expect(p.lightShrine, `${themeKey}/${seed}`).toBeFalsy();
        }
      }
    }
    expect(shrines).toBeGreaterThan(0);   // the maps do have shrines; none are lit
  });
});
