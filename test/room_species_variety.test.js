import { describe, it, expect } from 'vitest';
import {
  pickRoomSpecies, SPECIES_CAP,
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID, getThemeForMonster
} from '../src/game/srd.js';
import { generateDungeon, mulberry32 } from '../src/dungeon/dungeon_generator.js';
import { crBandIndex, maxCrForDungeonLevel } from '../src/game/constants.js';

/* Family map for the pure unit tests — the helper is family-agnostic, so we
   drive it with synthetic species ids instead of the real bestiary. */
const fam = { a: 'F1', b: 'F2', c: 'F1' };
const familyOf = (id) => fam[id];

describe('pickRoomSpecies (per-room species variety cap)', () => {
  it('caps a single species at SPECIES_CAP when alternatives exist', () => {
    const bandPool = [];
    const counts = {};
    let anchor = null;
    for (let i = 0; i < 6; i++) {
      const id = pickRoomSpecies({
        bandPool, counts, anchorFamily: anchor, familyOf,
        window: ['a', 'b'],
        roll: (pool) => pool[0]
      });
      counts[id] = (counts[id] || 0) + 1;
      if (!anchor) anchor = familyOf(id);
    }
    /* roll(pool) returns pool[0]; the pool is 'a' only while a is under-cap,
       then must flip to 'b' (window order) — so 'a' can never exceed the cap. */
    expect(counts.a).toBeLessThanOrEqual(SPECIES_CAP);
    expect(counts.b).toBeGreaterThan(0);
  });

  it('reuses an under-cap pool species before rolling a new one', () => {
    const bandPool = ['a', 'b'];
    let rollCalls = 0;
    const id = pickRoomSpecies({
      bandPool, counts: { a: SPECIES_CAP, b: 1 }, anchorFamily: 'F1', familyOf,
      window: ['a', 'b'],
      roll: (pool) => { rollCalls++; return pool[0]; }
    });
    expect(id).toBe('b');          // a is capped; b is under-cap
    expect(rollCalls).toBe(0);
  });

  it('prefers a fresh roll of the room\'s own family over an off-family one', () => {
    /* anchor F1; 'c' (F1) is picked from the window before 'b' (F2). */
    const id = pickRoomSpecies({
      bandPool: [], counts: {}, anchorFamily: 'F1', familyOf,
      window: ['c', 'b'],
      roll: (pool) => pool[0]
    });
    expect(id).toBe('c');
  });

  it('falls back to any under-cap species when the room\'s family is exhausted', () => {
    /* anchor F1 but the only under-cap species in the window is 'b' (F2). */
    const id = pickRoomSpecies({
      bandPool: [], counts: {}, anchorFamily: 'F1', familyOf,
      window: ['b'],
      roll: (pool) => pool[0]
    });
    expect(id).toBe('b');
  });

  it('falls back to a duplicate only when the roster band has nothing else', () => {
    const bandPool = ['a'];
    const id = pickRoomSpecies({
      bandPool, counts: { a: SPECIES_CAP }, anchorFamily: 'F1', familyOf,
      window: ['a'],
      roll: (pool) => pool[0]
    });
    expect(id).toBe('a');
  });

  it('keeps the room\'s vibe family as the anchor once set', () => {
    const bandPool = [];
    const counts = {};
    let anchor = null;
    for (let i = 0; i < 4; i++) {
      const id = pickRoomSpecies({
        bandPool, counts, anchorFamily: anchor, familyOf,
        window: ['b', 'a'],
        roll: (pool) => pool[0]
      });
      counts[id] = (counts[id] || 0) + 1;
      if (!anchor) anchor = familyOf(id);
    }
    expect(anchor).toBe('F2');     // first fielded species was 'b'
  });
});

describe('per-room species cap through real dungeon spawns', () => {
  it('never fields more than SPECIES_CAP of one creature in a generic room', () => {
    const familyOfId = (id) => getThemeForMonster(MONSTERS_BY_ID[id]);
    for (const [level, theme] of [[4, 'grim'], [8, 'ancient'], [14, 'grim']]) {
      const roster = dungeonMonsterIds(theme);
      expect(roster.length).toBeGreaterThan(0);
      for (let seed = 1; seed <= 40; seed++) {
        const d = generateDungeon(seed, { seed, roomCount: 40, level, theme });
        /* Seeded, not Math.random: the dungeon seed was fixed but the monster
           roll was not, so this test's verdict depended on the global RNG
           sequence — which shifts whenever another test file is added, and did.
           A cap violation must be reproducible to be worth acting on. */
        const rng = mulberry32(seed ^ 0x9e3779b9);
        for (const r of d.rooms) {
          if (r.roomStyle && r.roomStyle !== 'generic') continue;
          const spawns = d.spawns.filter((s) => s.roomId === r.id);
          if (!spawns.length) continue;
          const counts = {};
          const pools = {};
          let anchor = null;
          for (const sp of spawns) {
            const band = crBandIndex(sp.targetCR);
            const key = sp.role ? `role_${sp.role}_${band}` : String(band);
            if (!pools[key]) pools[key] = [];
            const minCR = Math.max(0, sp.targetCR * 0.5);
            const maxCR = Math.min(Math.max(sp.targetCR * 1.5, sp.targetCR + 0.5),
              maxCrForDungeonLevel(level));
            const window = roster.filter((id) => {
              const c = MONSTERS_BY_ID[id] && MONSTERS_BY_ID[id].cr;
              return typeof c === 'number' && c >= minCR && c <= maxCR;
            });
            const id = pickRoomSpecies({
              bandPool: pools[key], counts, anchorFamily: anchor, familyOf: familyOfId,
              window,
              roll: (pool) => spawnMonster(
                sp.targetCR, level, rng, pool,
                { dungeonLevel: level, questFloor: 1, floors: 1 }).id
            });
            counts[id] = (counts[id] || 0) + 1;
            if (!anchor) anchor = familyOfId(id);
          }
          for (const [id, n] of Object.entries(counts)) {
            expect(n, `seed ${seed} lvl ${level} ${theme} room ${r.id}: ${n} x ${MONSTERS_BY_ID[id]?.name || id}`)
              .toBeLessThanOrEqual(SPECIES_CAP);
          }
        }
      }
    }
    /* 3 themes x 40 seeds x 40 rooms with a spawnMonster per slot runs past the
       5s default under full-suite load — slow, so give it room. It sat at 30s
       and started timing out (not failing its assertion) the moment another
       test file was added to the suite, so the margin is now generous: this
       budget exists for machine load, and a cap violation should be what fails
       it, not the clock. It is also deterministic now (see the seeded rng
       above); it previously fed in unseeded Math.random. */
  }, 120000);
});
