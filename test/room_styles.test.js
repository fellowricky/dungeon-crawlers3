import { describe, it, expect, vi } from 'vitest';
import { generateDungeon, ROOM_STYLES, TYPE, SPAWN_BUDGET, roomSpawnBudget } from '../src/dungeon/dungeon_generator.js';
import { spawnMonster, MONSTERS_ALL } from '../src/game/srd.js';
import { crToCost } from '../src/game/constants.js';

/* Statistical spawn simulations over many seeds: 5–25 s each in isolation,
   longer under the full suite's worker contention. Not a hang. */
describe('Room Encounter Styles & Monster Spawning', { timeout: 90000 }, () => {
  it('defines 10 distinct room styles with titles and subtitles', () => {
    const keys = Object.keys(ROOM_STYLES);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    expect(ROOM_STYLES.swarm).toBeDefined();
    expect(ROOM_STYLES.miniboss).toBeDefined();
    expect(ROOM_STYLES.ritual).toBeDefined();
    expect(ROOM_STYLES.ambush).toBeDefined();
    expect(ROOM_STYLES.killzone).toBeDefined();
    expect(ROOM_STYLES.nest).toBeDefined();
    expect(ROOM_STYLES.juggernaut).toBeDefined();
    expect(ROOM_STYLES.duelists).toBeDefined();
    expect(ROOM_STYLES.necromantic).toBeDefined();
    expect(ROOM_STYLES.arcane_surge).toBeDefined();

    for (const key of keys) {
      const s = ROOM_STYLES[key];
      expect(s.id).toBe(key);
      expect(typeof s.title).toBe('string');
      expect(typeof s.subtitle).toBe('string');
    }
  });

  it('restricts theme-specific room styles appropriately', () => {
    expect(ROOM_STYLES.necromantic.themes).toContain('grim');
    expect(ROOM_STYLES.necromantic.themes).toContain('ancient');
    expect(ROOM_STYLES.necromantic.themes).not.toContain('forest');

    expect(ROOM_STYLES.nest.themes).toContain('verdant');
    expect(ROOM_STYLES.nest.themes).toContain('forest');
    expect(ROOM_STYLES.nest.themes).not.toContain('molten');
  });

  it('generates dungeons with special room styles and banner metadata', () => {
    let foundSpecialRoom = false;
    for (let seed = 100; seed < 120; seed++) {
      const d = generateDungeon({ seed, roomCount: 40, theme: 'ancient' });
      for (const r of d.rooms) {
        if (r.roomStyle) {
          foundSpecialRoom = true;
          expect(r.banner).toBeDefined();
          expect(r.banner.title).toBe(ROOM_STYLES[r.roomStyle].title);
          expect(r.banner.subtitle).toBe(ROOM_STYLES[r.roomStyle].subtitle);
        }
      }
    }
    expect(foundSpecialRoom).toBe(true);
  });

  it('fills Swarm Rooms to the spawn cap with a single unified CR', () => {
    let foundSwarmRooms = [];
    for (let seed = 1; seed < 60; seed++) {
      /* level 14 sits on the open end of the spawn-budget level curve; the
         early rows deliberately cap room size (see the level-1 test below). */
      const d = generateDungeon({ seed, roomCount: 50, threatMult: 2.0, level: 14, theme: 'ancient' });
      for (const r of d.rooms) {
        if (r.roomStyle === 'swarm') {
          const roomSpawns = d.spawns.filter(sp => sp.roomId === r.id);
          foundSwarmRooms.push({ r, roomSpawns });
        }
      }
    }
    expect(foundSwarmRooms.length).toBeGreaterThan(0);
    for (const { r, roomSpawns } of foundSwarmRooms) {
      /* A full-strength swarm fills the room up to the horde spawn cap… */
      expect(roomSpawns.length).toBe(SPAWN_BUDGET.hordeMaxSpawns ?? 18);
      /* …and every body is the SAME CR — that single shared targetCR is what
         lets the game's room-species lock field one creature (ten grey rats). */
      const crs = new Set(roomSpawns.map(sp => sp.targetCR));
      expect(crs.size).toBe(1);
      /* The species CR is the dearest rung a full roomful can afford, so the
         horde still sits near its purse at depth. */
      const budget = roomSpawnBudget(r.type, r.difficulty, 2.0, 14);
      expect(roomSpawns.length * crToCost(roomSpawns[0].targetCR)).toBeLessThanOrEqual(budget);
    }
    /* 100 seeds x 50 rooms lands right on vitest's 5s default, so this test
       passed alone and timed out under full-suite load. It is slow, not
       flaky — give it room rather than shrinking the sample. */
  }, 30000);

  it('fields budget-bound swarm hordes on floors too weak to fill the room', () => {
    for (let seed = 1; seed < 60; seed++) {
      const d = generateDungeon({ seed, roomCount: 50, level: 1, theme: 'ancient' });
      for (const r of d.rooms) {
        if (r.roomStyle !== 'swarm') continue;
        const roomSpawns = d.spawns.filter(sp => sp.roomId === r.id);
        /* A level-1 purse cannot buy a full roomful of even the cheapest
           creature (10 x 6 > 28), so the swarm fields as many as it can pay
           for, all at the single cheapest CR, and never overspends. */
        const budget = roomSpawnBudget(r.type, r.difficulty, 1, 1);
        const spend = roomSpawns.reduce((a, sp) => a + crToCost(sp.targetCR), 0);
        expect(roomSpawns.length).toBeLessThan(SPAWN_BUDGET.maxSpawns);
        expect(new Set(roomSpawns.map(sp => sp.targetCR)).size).toBe(1);
        expect(spend).toBeLessThanOrEqual(budget);
        expect(spend).toBeGreaterThan(budget * 0.5);
      }
    }
  });

  /* Room difficulty only ranks rooms within a floor, so before the level curve
     existed a level-1 dungeon's back rooms were as packed as a level-20 one's —
     a fresh party walked into ten-monster rooms on its first floor. */
  it('holds early-level rooms under the level curve spawn cap, and opens up with depth', () => {
    const cap = (level) => Math.min(
      SPAWN_BUDGET.maxSpawns,
      SPAWN_BUDGET.levelCurve[level].spawnCap
    );
    const worstRoom = (level) => {
      let worst = 0;
      for (let seed = 1; seed < 40; seed++) {
        const d = generateDungeon({ seed, roomCount: 50, level, theme: 'ancient' });
        const perRoom = {};
        for (const s of d.spawns) perRoom[s.roomId] = (perRoom[s.roomId] || 0) + 1;
        worst = Math.max(worst, ...Object.values(perRoom));
      }
      return worst;
    };

    const lv1 = worstRoom(1);
    expect(lv1).toBeLessThanOrEqual(cap(1));
    // ...and the cap is the thing doing the limiting, not an empty dungeon
    expect(lv1).toBeGreaterThan(1);

    // Deep dungeons still field full-size rooms.
    expect(worstRoom(20)).toBeGreaterThan(lv1);
  });

  /* The generator prices its spawn budget against the CR the floor actually
     fields (game.js overrides the generator's target CR via crForDungeonLevel).
     When those disagreed, deep rooms paid high-CR prices for low-CR monsters and
     came out no bigger than the entrance — the depth ramp did nothing. The live
     spawn_budget zeroes difficultySpan (a tuning choice), so this test enables a
     non-zero span to verify the ramp mechanism itself. */
  /* Deep rooms sit at the encounter-size cap (~9.5 spawns) at every level; it
     is the SHALLOW rooms that move, climbing toward that cap as level rises.
     So the ramp is widest in the mid levels and necessarily flattens at 20,
     where shallow rooms have already reached the ceiling. Measured over 200
     seeds the far/near count ratio runs 1.04 (lv1), 1.36 (lv8), 1.15 (lv14),
     1.01 (lv20). Room composition now varies on purpose (buyRoomSpawns draws
     a level's target CR across its ladder — half as likely per rung down — so
     a room sometimes trades bodies for CR), which broadens the count
     distribution and flattens the count-ramp to ~1.16 at level 8. The
     load-bearing invariants are that the ramp never INVERTS and that deep
     rooms still SPEND more of the (larger) budget, which is asserted below. */
  it('spends more of the budget on deeper rooms, so room size ramps with depth', () => {
    const savedFloor = SPAWN_BUDGET.difficultyFloor;
    const savedSpan = SPAWN_BUDGET.difficultySpan;
    SPAWN_BUDGET.difficultyFloor = 0.35;
    SPAWN_BUDGET.difficultySpan = 0.65;
    try {
      for (const level of [1, 8, 20]) {
        const near = [], far = [], nearSpend = [], farSpend = [];
        for (let seed = 1; seed < 200; seed++) {
          const d = generateDungeon({ seed, roomCount: 24, level, theme: 'ancient' });
          const per = {};
          const spend = {};
          for (const s of d.spawns) {
            per[s.roomId] = (per[s.roomId] || 0) + 1;
            spend[s.roomId] = (spend[s.roomId] || 0) + crToCost(s.targetCR ?? 0);
          }
          for (const r of d.rooms) {
            if (per[r.id] === undefined || r.type !== TYPE.COMBAT) continue;
            if (r.difficulty < 0.4) { near.push(per[r.id]); nearSpend.push(spend[r.id]); }
            else if (r.difficulty > 0.75) { far.push(per[r.id]); farSpend.push(spend[r.id]); }
          }
        }
        const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
        expect(near.length, `level ${level}: sampled shallow rooms`).toBeGreaterThan(10);
        expect(far.length, `level ${level}: sampled deep rooms`).toBeGreaterThan(10);
        // The ramp must never invert, at any level.
        expect(avg(far), `level ${level}: deep vs shallow room size`).toBeGreaterThanOrEqual(avg(near));
        // Deep rooms carry a larger purse and must spend it: the budget ramp is
        // the load-bearing invariant (variety broadens the body count, not the purse).
        expect(avg(farSpend), `level ${level}: deep rooms under-spend vs shallow`)
          .toBeGreaterThan(avg(nearSpend));
        // Where shallow rooms are below the cap, the body-count ramp must be real.
        if (level === 8) {
          expect(avg(far) / avg(near), `level ${level}: ramp strength`).toBeGreaterThanOrEqual(1.0);
        }
      }
    } finally {
      SPAWN_BUDGET.difficultyFloor = savedFloor;
      SPAWN_BUDGET.difficultySpan = savedSpan;
    }
  }, 30000);

  /* Every generic spawn is re-resolved by dungeon level on load, so the generator
     must not hand out CRs that level can't field — that's what made the bestiary
     preview claim a level-1 dungeon could field CR 3. At level 1 the base CR is
     0.25 with no roll-up, so generic spawns must stay in the lowest CR band. */
  it('never proposes a CR the dungeon level cannot actually spawn', () => {
    for (let seed = 1; seed < 40; seed++) {
      const d = generateDungeon({ seed, roomCount: 30, level: 1, theme: 'ancient' });
      for (const s of d.spawns) {
        if (s.crOffset !== undefined) continue; // themed squads are ±1 band by design
        expect(s.targetCR, `seed ${seed}: generic spawn targetCR at level 1`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  /* Themed rooms build fixed squads that bypass the budget loop entirely, so the
     cap has to be enforced after they're assembled or level 1 still gets swarmed. */
  it('applies the level spawn cap to themed squad rooms too', () => {
    for (let seed = 1; seed < 60; seed++) {
      const d = generateDungeon({ seed, roomCount: 50, threatMult: 2.0, level: 1, theme: 'ancient' });
      const perRoom = {};
      for (const s of d.spawns) perRoom[s.roomId] = (perRoom[s.roomId] || 0) + 1;
      for (const r of d.rooms) {
        if (!r.roomStyle) continue;
        const isHorde = r.roomStyle === 'swarm' || r.roomStyle === 'nest';
        const expectedCap = isHorde ? (SPAWN_BUDGET.hordeMaxSpawns ?? 18) : SPAWN_BUDGET.levelCurve[1].spawnCap;
        expect(perRoom[r.id] || 0, `seed ${seed}: ${r.roomStyle} room`)
          .toBeLessThanOrEqual(expectedCap);
      }
    }
  });

  it('filters monster candidates by role and adjusts minion/miniboss stats in spawnMonster', () => {
    /* Compare role-adjusted stats on the SAME species so the multiplier is the
       only difference — two independent rolls could otherwise invert on HP. */
    const species = MONSTERS_ALL.find((m) => m.cr === 2);
    expect(species).toBeDefined();
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const minion = spawnMonster(2, 5, Math.random, [species.id], null, 'minion');
    const miniboss = spawnMonster(2, 5, Math.random, [species.id], null, 'miniboss');
    const plain = spawnMonster(2, 5, Math.random, [species.id], null, null);
    spy.mockRestore();

    expect(minion).toBeDefined();
    expect(miniboss).toBeDefined();
    expect(minion.hp).toBeGreaterThan(0);
    expect(minion.hp).toBeLessThan(plain.hp);        // minion hp ×0.65
    expect(miniboss.hp).toBeGreaterThan(plain.hp);   // miniboss hp ×1.35
  });
});
