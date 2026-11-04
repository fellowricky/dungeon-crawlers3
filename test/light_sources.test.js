import { describe, it, expect } from 'vitest';
import { generateDungeon, FLOOR } from '../src/dungeon/dungeon_generator.js';

if (typeof globalThis.document === 'undefined') {
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  const dummyCtx = new Proxy({
    font: '', measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8Array(4) }),
    createImageData: (w = 100, h = 100) => ({ data: new Uint8Array(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} })
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    }
  });
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: { setProperty: () => {} },
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx,
    querySelector: () => dummyEl,
    querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [], body: dummyEl,
    documentElement: dummyEl
  };
}

describe('light sources (phase 1)', async () => {
  const { makeHero, createWolfCompanion, normalizeHero, RACES } = await import('../src/game/srd.js');
  const items = await import('../src/game/items.js');
  const { SPELLS, SPELL_POOLS } = await import('../src/game/spells.js');
  const { LIGHT_SOURCES, heroLightSource } = await import('../src/game/light_sources.js');

  it('every new hero starts with a torch in the trinket slot', () => {
    const h = makeHero('Ana', 'human', 'fighter');
    expect(h.equipment.trinket).toBeTruthy();
    expect(h.equipment.trinket.lightSource).toBe('torch');
    expect(heroLightSource(h)).toBe('torch');
  });

  it('companions carry no torch', () => {
    const wolf = createWolfCompanion(3);
    expect(wolf.equipment.trinket).toBeUndefined();
    expect(heroLightSource(wolf)).toBeNull();
  });

  it('a torch is a light, not a consumable, and never rolls as loot', () => {
    const t = items.makeLightSourceItem('torch');
    expect(items.isLightSource(t)).toBe(true);
    expect(items.isConsumable(t)).toBe(false);
    expect(items.bonusText(t)).toMatch(new RegExp(`bright to ${LIGHT_SOURCES.torch.bright} tiles, dim to ${LIGHT_SOURCES.torch.dim}`));
    /* migration leaves it alone (no starter rename, no stat recompute) */
    const copy = JSON.parse(JSON.stringify(t));
    delete copy._migrated;
    items.migrateItem(copy);
    expect(copy.lightSource).toBe('torch');
    expect(copy.name).toBe('Torch');
    expect(copy.bonuses).toEqual({});
    /* loot never rolls a light source, at any depth */
    for (const r of ['common', 'uncommon', 'rare', 'epic'])
      for (const lvl of [0, 5, 20])
        expect(items.trinketPool(lvl, r).some(b => b.lightSource)).toBe(false);
    let rngState = 7;
    const rng = () => ((rngState = (rngState * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 600; i++) {
      const it = items.rollItem(1 + (i % 12), rng, 'trinket', { source: 'chest' });
      expect(it && it.lightSource).toBeFalsy();
    }
  });

  it('the lantern beats a torch; the Light cantrip beats a torch but not a lantern', () => {
    const h = makeHero('Bo', 'gnome', 'wizard');
    h.knownSpells.push('light');
    expect(heroLightSource(h)).toBe('light');
    h.equipment.trinket = items.makeLightSourceItem('lantern');
    expect(heroLightSource(h)).toBe('lantern');
    delete h.equipment.trinket;
    expect(heroLightSource(h)).toBe('light');       // Light frees the slot
    expect(LIGHT_SOURCES.lantern.bright).toBeGreaterThan(LIGHT_SOURCES.torch.bright);
  });

  it('Light is a passive cantrip offered to bard, cleric, sorcerer and wizard only', () => {
    expect(SPELLS.light).toBeTruthy();
    expect(SPELLS.light.passive).toBe(true);
    expect(SPELLS.light.cantrip).toBe(true);
    const learners = Object.keys(SPELL_POOLS).filter(c => Object.values(SPELL_POOLS[c]).some(t => t.includes('light')));
    expect(learners.sort()).toEqual(['bard', 'cleric', 'sorcerer', 'wizard']);
  });

  it('no hero race has darkvision (removed — every party needs a light)', () => {
    expect(Object.entries(RACES).filter(([, r]) => r.darkvision).map(([k]) => k)).toEqual([]);
  });

  it('heroes from older saves get a torch: equipped if the slot is free, owed to the bag if not', () => {
    const free = makeHero('Cy', 'human', 'rogue');
    delete free.equipment.trinket; delete free.torchGranted;
    normalizeHero(free);
    expect(free.equipment.trinket && free.equipment.trinket.lightSource).toBe('torch');
    expect(free._torchOwed).toBeUndefined();

    const busy = makeHero('Di', 'human', 'rogue');
    delete busy.torchGranted;
    busy.equipment.trinket = { slot: 'trinket', name: 'Potion of Heroism', potion: true, buffKey: 'heroism', charges: 1 };
    normalizeHero(busy);
    expect(busy.equipment.trinket.potion).toBe(true);
    expect(busy._torchOwed).toBe(true);

    /* only once */
    const again = makeHero('Ed', 'human', 'rogue');
    delete again.equipment.trinket;
    normalizeHero(again);
    expect(again.equipment.trinket).toBeUndefined();
  });

  it('party lights follow the heroes carrying a light, in that light\'s colour', async () => {
    const S = await import('../src/render/dungeon_scene.js');
    const { game } = await import('../src/game/game.js');
    const d = generateDungeon(42, { roomCount: 16, themeKey: 'ancient' });
    S.buildScene(d);
    expect(S.partyLights.length).toBe(4);

    const keep = { heroes: game.heroes, state: game.state, leaderIdx: game.leaderIdx };
    try {
      const torch = makeHero('A', 'human', 'fighter');
      const caster = makeHero('B', 'human', 'wizard');
      caster.knownSpells.push('light');
      const dark = makeHero('C', 'human', 'rogue');
      delete dark.equipment.trinket;
      game.heroes = [{ data: torch, x: 0, z: 0 }, { data: caster, x: 10, z: 0 }, { data: dark, x: -10, z: 0 }];
      game.leaderIdx = 0;
      game.state = 'crawl';
      S.liveUpdate(1, Infinity, 0.016);

      const lit = S.partyLights.filter(L => L.intensity > 0);
      expect(lit.length).toBe(2);                      // the rogue has no light
      const at = x => S.partyLights.find(L => L.intensity > 0 && Math.abs(L.position.x - x) < 0.01);
      expect(at(0).color.getHex()).toBe(new (await import('three')).Color(LIGHT_SOURCES.torch.color).getHex());
      expect(at(10).color.getHex()).toBe(new (await import('three')).Color(LIGHT_SOURCES.light.color).getHex());
      expect(at(0).distance).toBe(LIGHT_SOURCES.torch.reach);

      game.state = 'worldmap';
      S.liveUpdate(1.1, Infinity, 0.016);
      expect(S.partyLights.every(L => L.intensity === 0)).toBe(true);
    } finally {
      game.heroes = keep.heroes; game.state = keep.state; game.leaderIdx = keep.leaderIdx;
    }
  });

  it('a hero torch is bright and dim to its own radii for the rules, whatever the falloff', async () => {
    const S = await import('../src/render/dungeon_scene.js');
    const L = await import('../src/render/sprite_lighting.js');
    const { game } = await import('../src/game/game.js');
    const { LIGHT_LEVELS, classifyLight } = await import('../src/game/light_sources.js');
    /* a sealed dungeon with no fires of its own: only the hero's torch */
    const d = generateDungeon(42, { roomCount: 16, themeKey: 'ancient' });
    d.torches = [];
    d.props = (d.props || []).filter(p => p.kind !== 'candle' && p.kind !== 'brazier');
    S.buildScene(d);
    const keep = { heroes: game.heroes, state: game.state, leaderIdx: game.leaderIdx, hi: S.hemi.intensity, di: S.dirL.intensity };
    try {
      S.hemi.intensity = 0; S.dirL.intensity = 0;
      const torch = makeHero('A', 'human', 'fighter');
      game.heroes = [{ data: torch, x: 0, z: 0 }];
      game.leaderIdx = 0; game.state = 'crawl';
      S.liveUpdate(1, Infinity, 0.016);
      L.updateSpriteLighting([], 0.6);
      const st = r => classifyLight(L.lightLevelAt(r, 0, 0));
      expect(st(0)).toBe('bright');
      const { bright: rb, dim: rd } = LIGHT_SOURCES.torch;
      expect(st(rb - 0.1)).toBe('bright');
      expect(st(rb + 0.2)).toBe('dim');
      expect(st(rd - 0.1)).toBe('dim');
      expect(st(rd + 0.3)).toBe('dark');
      /* and the visible pool really reads the bright threshold at the bright radius */
      const P = S.partyLights.find(l => l.intensity > 0);
      const lum = 0.2126 * P.color.r + 0.7152 * P.color.g + 0.0722 * P.color.b;
      const h = P.position.y, dd = Math.hypot(rb, h), q = dd / P.distance, w = Math.max(0, 1 - q ** 4);
      const steadyI = LIGHT_SOURCES.torch.base / Math.max(0.2, lum) * 4 * Math.PI;   // flicker mean 1
      const floor4 = steadyI * lum * (h / dd) / Math.pow(dd, P.decay) * w * w / Math.PI;
      expect(floor4).toBeCloseTo(LIGHT_LEVELS.bright, 1);
    } finally {
      game.heroes = keep.heroes; game.state = keep.state; game.leaderIdx = keep.leaderIdx;
      S.hemi.intensity = keep.hi; S.dirL.intensity = keep.di;
    }
  });

  it('an equipped hooded lantern lights its bearer on a foggy-day overland, in the scene and the F4 grid', async () => {
    const S = await import('../src/render/dungeon_scene.js');
    const L = await import('../src/render/sprite_lighting.js');
    const { game } = await import('../src/game/game.js');
    const { classifyLight } = await import('../src/game/light_sources.js');
    /* a misty daytime overland: its weather never asks for a party light,
       which used to switch every carried light off */
    const d = generateDungeon(7, { themeKey: 'mire', timeOfDay: 'day', weather: 'fog' });
    expect(d.effectiveTheme.overland).toBe(true);
    expect(d.effectiveTheme.heroLightNeeded).toBe(false);
    S.buildScene(d);
    const keep = { heroes: game.heroes, state: game.state, leaderIdx: game.leaderIdx, hi: S.hemi.intensity, di: S.dirL.intensity };
    const points = [];
    S.scene.traverse(o => { if (o.isPointLight && !S.partyLights.includes(o)) points.push(o); });
    const keepI = points.map(p => p.intensity);
    try {
      /* only the lantern may light anything */
      S.hemi.intensity = 0; S.dirL.intensity = 0;
      for (const p of points) p.intensity = 0;
      const barb = makeHero('Barb', 'human', 'barbarian');
      barb.equipment.trinket = items.makeLightSourceItem('lantern');
      const other = makeHero('Rogue', 'human', 'rogue');
      delete other.equipment.trinket;
      /* stand the barbarian on a walkable tile centre */
      const { W, H, grid } = d;
      let bx = 0, bz = 0;
      for (let i = 0; i < grid.length; i++) if (grid[i] === FLOOR) { bx = (i % W) - W / 2 + 0.5; bz = Math.floor(i / W) - H / 2 + 0.5; break; }
      game.heroes = [{ data: other, x: bx + 1, z: bz }, { data: barb, x: bx, z: bz }];
      game.leaderIdx = 0; game.state = 'crawl';
      S.liveUpdate(1, Infinity, 0.016);

      const lit = S.partyLights.filter(l => l.intensity > 0);
      expect(lit.length).toBe(1);
      expect(Math.abs(lit[0].position.x - bx) < 0.01 && Math.abs(lit[0].position.z - bz) < 0.01).toBe(true);
      expect(game.heroes[1]._lightActive).toBe(true);

      L.setLightDebug(true);
      L.updateSpriteLighting([], 0.6);
      const st = r => classifyLight(L.lightLevelAt(bx + r, 0, bz));
      expect(st(0)).toBe('bright');
      expect(st(LIGHT_SOURCES.lantern.bright + 0.5)).toBe('dim');
      /* and the debug grid paints the bearer's tile bright */
      const tile = L.lightDebugTiles().find(t => Math.abs(t.x - bx) < 0.01 && Math.abs(t.z - bz) < 0.01);
      expect(tile && tile.state).toBe('bright');
    } finally {
      L.setLightDebug(false);
      game.heroes = keep.heroes; game.state = keep.state; game.leaderIdx = keep.leaderIdx;
      S.hemi.intensity = keep.hi; S.dirL.intensity = keep.di;
      points.forEach((p, i) => { p.intensity = keepI[i]; });
    }
  });

  it('the hero record carries its light state for the party frames, but saves leave it out', async () => {
    const { heroSaveRecord } = await import('../src/game/inventory.js');
    const L = await import('../src/render/sprite_lighting.js');
    const THREE = await import('three');
    const data = makeHero('B', 'dwarf', 'cleric');
    const grp = new THREE.Group();
    const u = { data, ent: { grp, anim: null } };
    L.updateSpriteLighting([u], 0.016);
    expect(['bright', 'dim', 'dark']).toContain(u.lightState);
    expect(data._lightState).toBe(u.lightState);
    expect(heroSaveRecord(data)._lightState).toBeUndefined();
  });
});
