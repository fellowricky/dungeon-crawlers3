import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateDungeon, FLOOR, WALL } from '../src/dungeon/dungeon_generator.js';

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

const lum = v => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;

describe('sprite lighting', async () => {
  const S = await import('../src/render/dungeon_scene.js');
  const { configureSpriteMaterial } = await import('../src/game/sprite_animator.js');
  const { updateSpriteLighting, SPRITE_LIGHT, lightLevelAt, setLightDebug, lightDebugTiles } = await import('../src/render/sprite_lighting.js');
  const { classifyLight, lightStateOf, LIGHT_LEVELS } = await import('../src/game/light_sources.js');

  const d = generateDungeon(42, { roomCount: 16, themeKey: 'ancient' });
  S.buildScene(d);
  /* Fixed test lighting — the theme's own values are tuned live in the
     dungeon editor and must not move these tests. A bright day sky and the
     default sun direction (toward +x/+z, which the cell picks below assume). */
  S.setSunAngle(54, 46.5);
  S.hemi.color.set(0x485c72); S.hemi.groundColor.set(0x1c2028); S.hemi.intensity = 0.85 * 4 * Math.PI;
  S.dirL.color.set(0xedd5b8); S.dirL.intensity = 0.75 * 4 * Math.PI;
  const { W, H, grid } = d;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? WALL : grid[y * W + x];
  const flat = c => !d.height || d.height[c] === d.height[0];

  /* Every authored light off, so only the sky and sun are in play. */
  const points = [];
  S.scene.traverse(o => { if (o.isPointLight) points.push(o); });
  const quiet = () => { for (const L of points) L.intensity = 0; };

  /* The sun sits toward +x/+z (setSunAngle default az 54°), so a floor cell
     tucked into a room's +x/+z corner is in the walls' shadow, and one with a
     long run of open floor toward +x/+z is in the sun. */
  let shadeCell = null, sunCell = null;
  for (let y = 1; y < H - 1 && !(shadeCell && sunCell); y++) {
    for (let x = 1; x < W - 1; x++) {
      if (at(x, y) !== FLOOR || !flat(y * W + x)) continue;
      if (!shadeCell && at(x + 1, y) === WALL && at(x, y + 1) === WALL && at(x + 1, y + 1) === WALL) shadeCell = { x, y };
      if (!sunCell) {
        let open = true;
        for (let k = 1; k <= 5 && open; k++) for (let j = -1; j <= 1 && open; j++) {
          if (at(x + k + j, y + k) !== FLOOR || at(x + k, y + k + j) !== FLOOR) open = false;
        }
        if (open) sunCell = { x, y };
      }
    }
  }

  /* a cell in the middle of a flat 5x5 patch of floor, for the fog tests */
  let flatCell = null;
  for (let y = 2; y < H - 2 && !flatCell; y++) for (let x = 2; x < W - 2 && !flatCell; x++) {
    const h0 = d.height ? d.height[y * W + x] : 0;
    let ok = true;
    for (let j = -2; j <= 2 && ok; j++) for (let i = -2; i <= 2 && ok; i++) {
      const c = (y + j) * W + x + i;
      if (grid[c] !== FLOOR || (d.height && d.height[c] !== h0)) ok = false;
    }
    if (ok) flatCell = { x, y };
  }

  const unit = cell => {
    const grp = new THREE.Group();
    grp.position.set(cell.x - W / 2 + 0.5, d.height ? d.height[cell.y * W + cell.x] * 0.45 : 0, cell.y - H / 2 + 0.5);
    const mesh = new THREE.Sprite(configureSpriteMaterial(new THREE.SpriteMaterial({ transparent: true })));
    mesh.scale.set(1.125, 1.125, 1);
    grp.add(mesh);
    S.scene.add(grp);
    grp.updateMatrixWorld(true);
    return { ent: { grp, anim: { mesh } } };
  };
  const litOf = u => u.ent.anim.mesh.material.userData.sprLit;

  it('finds a sunlit and a shaded floor cell to test on', () => {
    expect(sunCell).toBeTruthy();
    expect(shadeCell).toBeTruthy();
  });

  it('a unit in open sun keeps its sprite brightness; one in wall shadow is dimmed', () => {
    quiet();
    const sun = unit(sunCell), shade = unit(shadeCell);
    updateSpriteLighting([sun, shade], 0.016);
    const sunAvg = (lum(litOf(sun).L.value) + lum(litOf(sun).R.value)) / 2;
    const shadeAvg = (lum(litOf(shade).L.value) + lum(litOf(shade).R.value)) / 2;
    /* Matches the floor: the sprite gets the same multiplier the ground
       texture does in that spot (ancient is a dim, sky-lit theme). */
    expect(sunAvg).toBeGreaterThan(0.45);
    expect(sunAvg).toBeLessThanOrEqual(SPRITE_LIGHT.cap + 1e-6);
    expect(shadeAvg).toBeLessThan(sunAvg * 0.8);
    expect(lum(litOf(shade).L.value)).toBeCloseTo(lum(litOf(shade).R.value), 3);   // both sides shaded
    expect(shadeAvg).toBeGreaterThan(0.15);   // still readable
  });

  it('an overhead dungeon sun still lights a body on open stone', () => {
    quiet();
    const keep = { di: S.dirL.intensity, hi: S.hemi.intensity };
    /* ancient theme_overrides: sun at 85°, directional almost off. The side
       normal missed that light and left the sprite near 0.24. */
    S.setSunAngle(360, 85);
    S.hemi.intensity = 0.47 * 4 * Math.PI;
    S.dirL.intensity = 0.07 * 4 * Math.PI;
    const u = unit(sunCell);
    updateSpriteLighting([u], 0.016);
    const avg = (lum(litOf(u).L.value) + lum(litOf(u).R.value)) / 2;
    S.setSunAngle(54, 46.5);
    S.dirL.intensity = keep.di;
    S.hemi.intensity = keep.hi;
    expect(avg).toBeGreaterThan(0.35);
    expect(avg).toBeLessThanOrEqual(SPRITE_LIGHT.cap + 1e-6);
    expect(lum(litOf(u).L.value)).toBeCloseTo(lum(litOf(u).R.value), 2);
  });

  it('a torch to one side lights that side of the body more than the other', () => {
    quiet();
    const shade = unit(shadeCell);
    updateSpriteLighting([shade], 0.016);
    const before = lum(litOf(shade).L.value);
    const L = points[points.length - 1];
    const right = new THREE.Vector3().setFromMatrixColumn(S.cam.matrixWorld, 0).setY(0).normalize();
    L.position.copy(shade.ent.grp.position).addScaledVector(right, -1.5).setY(1.6);
    L.parent && L.parent.updateMatrixWorld(true);
    L.updateMatrixWorld(true);
    L.color.set(0xff8c3a); L.intensity = 1.5 * 4 * Math.PI; L.distance = 16; L.decay = 2;
    for (let i = 0; i < 60; i++) updateSpriteLighting([shade], 0.05);   // let the easing settle
    const l = lum(litOf(shade).L.value), r = lum(litOf(shade).R.value);
    expect(l).toBeGreaterThan(before + 0.1);
    expect(l).toBeGreaterThan(r + 0.05);
    expect(litOf(shade).L.value.x).toBeGreaterThan(litOf(shade).L.value.z);   // warm, not white
    quiet();
  });

  it('a moonlit unit stays dark instead of reading as fully lit', () => {
    quiet();
    const keep = { dc: S.dirL.color.getHex(), di: S.dirL.intensity, hc: S.hemi.color.getHex(), hg: S.hemi.groundColor.getHex(), hi: S.hemi.intensity };
    /* overland_weather.js night values */
    S.dirL.color.set(0x88aacc); S.dirL.intensity = 0.28 * 4 * Math.PI;
    S.hemi.color.set(0x182436); S.hemi.groundColor.set(0x080c14); S.hemi.intensity = 0.38 * 4 * Math.PI;
    const u = unit(sunCell);
    updateSpriteLighting([u], 0.016);
    const avg = (lum(litOf(u).L.value) + lum(litOf(u).R.value)) / 2;
    S.dirL.color.setHex(keep.dc); S.dirL.intensity = keep.di;
    S.hemi.color.setHex(keep.hc); S.hemi.groundColor.setHex(keep.hg); S.hemi.intensity = keep.hi;
    /* Up-facing room light matches the ground, so a moonlit body is a little
       brighter than the old sideways sample (~0.39) and still far from full. */
    expect(avg).toBeLessThan(0.45);
    expect(avg).toBeGreaterThan(0.1);
    expect(litOf(u).L.value.z).toBeGreaterThan(litOf(u).L.value.x);   // moonlight reads blue
  });

  it('gives each unit a contact shadow that fades with the sprite', () => {
    quiet();
    const u = unit(sunCell);
    updateSpriteLighting([u], 0.016);
    const sh = u.ent._contactShadow;
    expect(sh).toBeTruthy();
    expect(sh.parent).toBe(u.ent.grp);
    expect(sh.material.opacity).toBeCloseTo(SPRITE_LIGHT.shadow, 5);
    u.ent.anim.mesh.material.opacity = 0.5;
    updateSpriteLighting([u], 0.016);
    expect(sh.material.opacity).toBeCloseTo(SPRITE_LIGHT.shadow * 0.5, 5);
    u.ent.anim.mesh.visible = false;
    updateSpriteLighting([u], 0.016);
    expect(sh.visible).toBe(false);
  });

  it('legs fog exactly as much as the mist drawn at their feet, and not in its clear gaps', async () => {
    quiet();
    const { createMistMaterial } = await import('../src/render/dungeon_materials.js');
    const { GEO } = await import('../src/render/dungeon_geo.js');
    const { mistSheetDensity } = await import('../src/render/sprite_lighting.js');
    /* only our sheet: set the level's own mist and ground fog aside */
    const keepMists = S.fx.mists.splice(0), keepPlane = S.fx.fogPlane;
    S.fx.fogPlane = null;
    const u = unit(flatCell);
    const fy = u.ent.grp.position.y;
    const mat = createMistMaterial(0xa4e2b0, 0.3);
    mat.uniforms.uTime.value = 0;
    const m = new THREE.Mesh(GEO.mistSheet, mat);
    const S6 = 6;
    m.scale.set(S6, 1, S6);
    m.userData = { mat };
    S.scene.add(m);
    S.fx.mists.push(m);
    const placeUnitAtUv = (uu, vv) => {          // sheet moved so the unit sits at sheet uv (uu, vv)
      m.position.set(u.ent.grp.position.x - (uu - 0.5) * S6, fy + 0.16, u.ent.grp.position.z - (0.5 - vv) * S6);
      m.updateMatrixWorld(true);
    };
    try {
      /* centre of the sheet: the legs take what the sheet shows there */
      placeUnitAtUv(0.5, 0.5);
      updateSpriteLighting([u], 2.0);
      const raw = mistSheetDensity(0.5, 0.5, 0) * 0.3 * SPRITE_LIGHT.mistGain * SPRITE_LIGHT.fogGain;
      const f0 = SPRITE_LIGHT.fogFloor, k = Math.max(0, Math.min(1, (raw - f0) / (2 * f0)));
      const fog = litOf(u).fog.value;
      expect(raw).toBeGreaterThan(3 * f0);                       // a visibly misty spot
      expect(fog.w).toBeCloseTo(Math.min(SPRITE_LIGHT.fogMax, raw) * k * k * (3 - 2 * k), 3);
      expect(fog.y).toBeGreaterThan(fog.x);   // the mist's green, not white

      /* a thin patch inside the sheet: no fog on the legs */
      let gap = null;
      for (let vv = 0.3; vv <= 0.7 && !gap; vv += 0.01)
        for (let uu = 0.3; uu <= 0.7 && !gap; uu += 0.01)
          if (mistSheetDensity(uu, vv, 0) * 0.3 * SPRITE_LIGHT.mistGain < SPRITE_LIGHT.fogFloor * 0.9) gap = [uu, vv];
      expect(gap).toBeTruthy();
      placeUnitAtUv(gap[0], gap[1]);
      updateSpriteLighting([u], 2.0);
      expect(litOf(u).fog.value.w).toBeLessThan(0.005);
    } finally {
      S.fx.mists.splice(0);
      S.fx.mists.push(...keepMists);
      S.fx.fogPlane = keepPlane;
      S.scene.remove(m);
    }
  });

  it('fog thins out where the ground rises to meet the sheet', async () => {
    const { fogClearance, fogGroundAt } = await import('../src/render/dungeon_materials.js');
    const x = flatCell.x - W / 2 + 0.5, z = flatCell.y - H / 2 + 0.5;
    const g = fogGroundAt(x, z);
    expect(g).not.toBeNull();
    expect(fogClearance(x, z, g + 0.16)).toBeCloseTo(1, 5);    // a mist sheet over flat floor: untouched
    expect(fogClearance(x, z, g - 0.05)).toBe(0);               // below it: gone
    const mid = fogClearance(x, z, g + 0.05);
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(1); // a ramp, not a cut
  });

  it('classifies light with a buffer so flicker cannot make the state chatter', () => {
    const { bright: B, dim: Dm, hyst: h } = LIGHT_LEVELS;
    expect(classifyLight(B + 0.01)).toBe('bright');
    expect(classifyLight(B - 0.01)).toBe('dim');
    expect(classifyLight(Dm - 0.001)).toBe('dark');
    /* just under the line: stays where it was */
    expect(classifyLight(B * (h + 0.05), 'bright')).toBe('bright');
    expect(classifyLight(B * (h + 0.05), 'dim')).toBe('dim');
    expect(classifyLight(Dm * (h + 0.05), 'dim')).toBe('dim');
    expect(classifyLight(Dm * (h + 0.05), 'dark')).toBe('dark');
    /* well under: drops */
    expect(classifyLight(B * (h - 0.05), 'bright')).toBe('dim');
    /* unknown creatures count as bright for rules */
    expect(lightStateOf({})).toBe('bright');
    expect(lightStateOf({ lightState: 'dark' })).toBe('dark');
  });

  it('a creature on a dim tile drops out of bright when the dim band sits above the hold', () => {
    const keep = { bright: LIGHT_LEVELS.bright, dim: LIGHT_LEVELS.dim, hyst: LIGHT_LEVELS.hyst, skyWeight: LIGHT_LEVELS.skyWeight };
    const wx = flatCell.x - W / 2 + 0.5, wz = flatCell.y - H / 2 + 0.5;
    const u = unit(flatCell);
    u.data = {};
    try {
      setLightDebug(true);
      updateSpriteLighting([u], 0.6);
      const v = u.lightLevel;
      expect(v).toBeGreaterThan(0);
      /* Moor night's shape: bright 0.55, dim 0.45, hyst 0.8, so bright*hyst
         (0.44) is below the dim line and the old hold never let go. */
      const pad = Math.max(v * 0.1, 1e-4);
      LIGHT_LEVELS.bright = v + pad;
      LIGHT_LEVELS.dim = (LIGHT_LEVELS.bright * LIGHT_LEVELS.hyst + v) / 2;
      expect(LIGHT_LEVELS.bright * LIGHT_LEVELS.hyst).toBeLessThan(LIGHT_LEVELS.dim);
      expect(v).toBeGreaterThanOrEqual(LIGHT_LEVELS.dim);
      expect(v).toBeLessThan(LIGHT_LEVELS.bright);
      u.lightState = 'bright';
      u.data._lightState = 'bright';
      updateSpriteLighting([u], 0.6);
      const tile = lightDebugTiles().find(t => Math.abs(t.x - wx) < 0.01 && Math.abs(t.z - wz) < 0.01);
      expect(tile && tile.state).toBe('dim');
      expect(u.lightState).toBe('dim');
      expect(u.data._lightState).toBe('dim');
    } finally {
      Object.assign(LIGHT_LEVELS, keep);
      setLightDebug(false);
      S.scene.remove(u.ent.grp);
    }
  });

  /* the floor cell with the least steady light — the light map counts every
     wall torch, candle and brazier whether or not a pooled light is on it,
     so "dark" has to be found, not assumed */
  const darkestCell = () => {
    let best = null, bv = Infinity;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (at(x, y) !== FLOOR) continue;
      const gy = d.height ? d.height[y * W + x] * 0.45 : 0;
      const v = lightLevelAt(x - W / 2 + 0.5, gy, y - H / 2 + 0.5);
      if (v < bv) { bv = v; best = { x, y }; }
    }
    return best;
  };

  it('every creature gets a light status: dark far from every light, bright under a torch', () => {
    quiet();
    const keep = { dc: S.dirL.color.getHex(), di: S.dirL.intensity, hc: S.hemi.color.getHex(), hg: S.hemi.groundColor.getHex(), hi: S.hemi.intensity };
    /* a sealed dungeon: no sky, no sun — only the level's own fires */
    S.dirL.intensity = 0;
    S.hemi.intensity = 0;
    try {
      updateSpriteLighting([], 0.6);
      const u = unit(darkestCell());
      updateSpriteLighting([u], 0.016);
      expect(u.lightState).toBe('dark');
      expect(lightStateOf(u)).toBe('dark');

      /* a torch held over the creature (same numbers the party light uses) */
      const L = points[points.length - 1];
      L.position.copy(u.ent.grp.position).setY(u.ent.grp.position.y + 2.0);
      L.parent && L.parent.updateMatrixWorld(true);
      L.updateMatrixWorld(true);
      L.color.set(0xff9a4a); L.decay = 1; L.distance = 9;
      L.intensity = 0.99 / 0.45 * 4 * Math.PI;
      L.userData.steady = L.intensity;          // as party lights publish it
      updateSpriteLighting([u], 0.6);            // past the light-list refresh
      expect(u.lightState).toBe('bright');      // no easing: the same frame

      /* F4 overlay paints the same answer on the tile under it */
      setLightDebug(true);
      updateSpriteLighting([u], 0.3);
      const tiles = lightDebugTiles();
      expect(tiles.length).toBeGreaterThan(50);
      const here = tiles.find(t => Math.abs(t.x - u.ent.grp.position.x) < 0.01 && Math.abs(t.z - u.ent.grp.position.z) < 0.01);
      expect(here && here.state).toBe('bright');
      expect(tiles.some(t => t.state === 'dark')).toBe(true);           // the rest of the night map
      /* and the creature's ring wears its state's colour */
      expect(u.ent._contactShadow.material.color.getHex()).not.toBe(0x000000);
      setLightDebug(false);
      updateSpriteLighting([u], 0.016);
      expect(u.ent._contactShadow.material.color.getHex()).toBe(0x000000);
      expect(lightLevelAt(u.ent.grp.position.x, u.ent.grp.position.y, u.ent.grp.position.z)).toBeGreaterThan(LIGHT_LEVELS.bright);
      delete L.userData.steady;
    } finally {
      S.dirL.color.setHex(keep.dc); S.dirL.intensity = keep.di;
      S.hemi.color.setHex(keep.hc); S.hemi.groundColor.setHex(keep.hg); S.hemi.intensity = keep.hi;
      quiet();
    }
  });

  it('reads steady light: flicker and the camera-nearest pool never change a tile', () => {
    const src = S.steadyLightSources();
    expect(src.length).toBeGreaterThan(0);                 // the level's wall torches etc.
    const s0 = src[0];
    const gy = d.height ? 0 : 0;
    const x = s0.x, z = s0.z + 0.6;
    /* every real light off (as if the camera were far away / pool unassigned) */
    quiet();
    updateSpriteLighting([], 0.6);
    const off = lightLevelAt(x, gy, z);
    /* now flicker every light wildly, pooled torches included */
    for (const L of points) L.intensity = 50 * Math.random();
    updateSpriteLighting([], 0.6);
    const flick = lightLevelAt(x, gy, z);
    quiet();
    expect(flick).toBeCloseTo(off, 6);
    expect(off).toBeGreaterThan(0);                        // the sconce still counts
    expect(S.steadyLightSources()).toBe(src);              // cached per level
  });

  it('the sky fill brightens the picture but not the rules (skyWeight 0)', () => {
    const x = 0.5, z = 0.5;
    const keep = S.hemi.intensity;
    try {
      S.hemi.intensity = 0.2 * 4 * Math.PI;
      updateSpriteLighting([], 0.6);
      const low = lightLevelAt(x, 0, z);
      S.hemi.intensity = 2.0 * 4 * Math.PI;
      updateSpriteLighting([], 0.6);
      const high = lightLevelAt(x, 0, z);
      expect(high).toBeCloseTo(low, 6);
      LIGHT_LEVELS.skyWeight = 1;                  // opt back in: now it counts
      expect(lightLevelAt(x, 0, z)).toBeGreaterThan(low + 0.1);
    } finally {
      LIGHT_LEVELS.skyWeight = 0;
      S.hemi.intensity = keep;
    }
  });

  it('the theme torch intensity drives the wall torches (the editor slider)', async () => {
    const { THEMES } = await import('../src/dungeon/dungeon_generator.js');
    const TH = THEMES[d.params?.themeKey || d.themeKey];
    const keep = TH.torchLight[1];
    try {
      const a = S.steadyLightSources().find(s => s.kind === 'torch');
      TH.torchLight[1] = keep * 2;
      const b = S.steadyLightSources().find(s => s.kind === 'torch');
      expect(b.intensity).toBeCloseTo(a.intensity * 2, 6);
    } finally {
      TH.torchLight[1] = keep;
    }
  });

  it('shades the floor by the light map: nothing in bright, cool in dim, darker in the dark', async () => {
    const L = await import('../src/render/sprite_lighting.js');
    quiet();
    const keep = { hi: S.hemi.intensity, di: S.dirL.intensity, str: L.DARK_CUE.strength };
    try {
      S.hemi.intensity = 0; S.dirL.intensity = 0;       // only the level's fires
      updateSpriteLighting([], 0.6);
      expect(L.darknessCueShown()).toBe(true);
      const tiles = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (at(x, y) !== FLOOR) continue;
        const wx = x - W / 2 + 0.5, wz = y - H / 2 + 0.5;
        const gy = d.height ? d.height[y * W + x] * 0.45 : 0;
        tiles.push({ wx, wz, st: classifyLight(lightLevelAt(wx, gy, wz)), a: L.darknessCueAt(wx, wz) });
      }
      const of = st => tiles.filter(t => t.st === st);
      expect(of('dark').length).toBeGreaterThan(0);
      expect(of('bright').length).toBeGreaterThan(0);
      for (const t of of('bright')) expect(t.a).toBe(0);
      for (const t of of('dark')) expect(t.a).toBeGreaterThanOrEqual(0.69);
      for (const t of of('dim')) { expect(t.a).toBeGreaterThan(0.2); expect(t.a).toBeLessThan(0.55); }
      /* off at strength 0, and hidden outside a crawl */
      L.DARK_CUE.strength = 0;
      updateSpriteLighting([], 0.6);
      expect(L.darknessCueShown()).toBe(false);
      L.DARK_CUE.strength = keep.str;
      updateSpriteLighting([], 0.6);
      expect(L.darknessCueShown()).toBe(true);
      L.hideLightOverlays();
      expect(L.darknessCueShown()).toBe(false);
    } finally {
      S.hemi.intensity = keep.hi; S.dirL.intensity = keep.di; L.DARK_CUE.strength = keep.str;
    }
  });

  it('a level loads its theme\'s light cut-offs (per time of day overland) and falls back to the defaults', async () => {
    const { applyThemeLightLevels, DARK_CUE, DARK_CUE_DEFAULT } = await import('../src/render/sprite_lighting.js');
    const { LIGHT_LEVELS, LIGHT_LEVEL_DEFAULTS } = await import('../src/game/light_sources.js');
    try {
      applyThemeLightLevels({ lightLevels: { bright: 1, dim: 0.4, darkCue: 1.2 } });
      expect([LIGHT_LEVELS.bright, LIGHT_LEVELS.dim, DARK_CUE.strength]).toEqual([1, 0.4, 1.2]);
      expect(LIGHT_LEVELS.skyWeight).toBe(LIGHT_LEVEL_DEFAULTS.skyWeight);
    } finally {
      applyThemeLightLevels({});
    }
    expect([LIGHT_LEVELS.bright, LIGHT_LEVELS.dim, DARK_CUE.strength])
      .toEqual([LIGHT_LEVEL_DEFAULTS.bright, LIGHT_LEVEL_DEFAULTS.dim, DARK_CUE_DEFAULT]);
  });

  it('virtual lights brighten their radius, glowing creatures light their spot, darkness zones black it all out', async () => {
    const LS = await import('../src/game/light_sources.js');
    const { MONSTERS_BY_ID } = await import('../src/game/srd.js');
    quiet();
    const keep = { hi: S.hemi.intensity, di: S.dirL.intensity };
    try {
      S.hemi.intensity = 0; S.dirL.intensity = 0;
      updateSpriteLighting([], 0.6);
      LS.clearLightRegistry();
      const x = flatCell.x - W / 2 + 0.5, z = flatCell.y - H / 2 + 0.5;
      const gy = d.height ? d.height[flatCell.y * W + flatCell.x] * 0.45 : 0;
      const base = lightLevelAt(x, gy, z);
      /* a thrown torch on the spot */
      const torch = LS.addVirtualLight({ x, z, bright: 2, dim: 4 });
      expect(classifyLight(lightLevelAt(x + 1, gy, z))).toBe('bright');
      expect(lightLevelAt(x + 3, gy, z)).toBeGreaterThanOrEqual(LIGHT_LEVELS.dim);
      LS.removeVirtualLight(torch);
      expect(lightLevelAt(x, gy, z)).toBeCloseTo(base, 6);
      /* a glowing creature: a fire beetle standing there */
      const beetle = unit(flatCell);
      beetle.data = { ...MONSTERS_BY_ID['giant-fire-beetle'], id: 'giant-fire-beetle', hp: 5, maxHp: 5 };
      beetle.x = x; beetle.z = z;
      updateSpriteLighting([beetle], 0.016);
      expect(beetle.lightState).toBe('bright');
      /* magical Darkness on top: nothing is lit inside, and the beetle is in it */
      LS.addDarkZone({ x, z, r: 3 });
      updateSpriteLighting([beetle], 0.016);
      expect(lightLevelAt(x, gy, z)).toBe(0);
      expect(beetle._inMagicalDarkness).toBe(true);
      expect(beetle.lightState).toBe('dark');
    } finally {
      LS.clearLightRegistry();
      S.hemi.intensity = keep.hi; S.dirL.intensity = keep.di;
    }
  });

  it('leaves sprites the sampler never visits at full brightness', () => {
    const m = configureSpriteMaterial(new THREE.SpriteMaterial({}));
    expect(m.userData.sprLit.L.value.toArray()).toEqual([1, 1, 1]);
    expect(m.userData.sprLit.R.value.toArray()).toEqual([1, 1, 1]);
  });
});
