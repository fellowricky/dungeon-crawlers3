/**
 * DUNGEON FORGE — procedural dungeon generator core & algorithms.
 * Pipeline: scatter → separate → Delaunay → MST+loops → semantics
 *           → carve → rasterize+BFS → decorate
 * Deterministic: mulberry32 threaded through every stage.
 */
import THEME_OVERRIDES from '../game/theme_overrides.json' with { type: 'json' };
/* Encounter-density levers (room threat budget + the CR→cost curve that prices
   each spawn against it). Lives in JSON so the bestiary's "Spawn Budget" tab
   can retune dungeon population without touching the generator. */
import SPAWN_BUDGET from '../game/spawn_budget.json' with { type: 'json' };
import {
  baseCrForDungeonLevel, crForDungeonLevel, maxCrForDungeonLevel, crToCost,
  crAnchorCRs
} from '../game/constants.js';
import { dungeonMonsterCRs, isRoomStyleEnabled } from '../game/srd.js';
import { buildElevation, buildOverlandElevation } from './elevation.js';
import { getPropFootprintCells, SOLID_PROP_KINDS, PODIUM_PROP_KINDS } from '../game/pathfinding.js';
import { resolveOverlandEnvironment, buildEffectiveOverlandTheme } from './overland_weather.js';
export { resolveOverlandEnvironment, buildEffectiveOverlandTheme };
export { SPAWN_BUDGET };

export function getSpawnBudget() {
  let edits = null;
  try {
    const raw = globalThis.localStorage?.getItem('dc_spawn_budget_edits');
    if (raw) edits = JSON.parse(raw);
  } catch { }
  if (!edits) return SPAWN_BUDGET;
  const merged = JSON.parse(JSON.stringify(SPAWN_BUDGET));
  for (const [k, v] of Object.entries(edits)) {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      merged[k] = { ...(merged[k] || {}), ...v };
    } else {
      merged[k] = v;
    }
  }
  return merged;
}

/* Per-dungeon-level entry from the spawn budget's level curve. Levels past the
   end of the table reuse the last row, so a 20-row table covers any depth. */
export function spawnLevelRow(level = 1, data = getSpawnBudget()) {
  const curve = data?.levelCurve || {};
  const keys = Object.keys(curve).map(Number).filter(n => isFinite(n)).sort((a, b) => a - b);
  if (!keys.length) return { budgetMult: 1, spawnCap: data?.maxSpawns ?? 10 };
  const lvl = Math.max(1, Math.round(Number(level) || 1));
  let best = keys[0];
  for (const k of keys) { if (k <= lvl) best = k; }
  const row = curve[best] || {};
  return {
    budgetMult: row.budgetMult ?? 1,
    spawnCap: row.spawnCap ?? (data?.maxSpawns ?? 10)
  };
}

/* Threat purse for one room, straight off spawn_budget.json. */
export function roomSpawnBudget(roomType, difficulty, threatMult = 1, level = 1, data = getSpawnBudget()) {
  return Math.round((data?.baseBudget ?? 150) * (threatMult || 1) * spawnLevelRow(level, data).budgetMult
    * ((data?.difficultyFloor ?? 0.35) + (data?.difficultySpan ?? 0.65) * difficulty)
    * (data?.typeMult?.[roomType] ?? 1));
}

/* Hard ceiling on slots for one room: the global cap and the level curve's cap,
   whichever is tighter. This is the ONLY thing that limits how many monsters a
   room may hold — tune it in the Spawn Budget tab. */
export function roomSpawnCap(level = 1, data = getSpawnBudget()) {
  return Math.min(data?.maxSpawns ?? 10, spawnLevelRow(level, data).spawnCap ?? 99);
}

/* Ascending list of CRs a room at this level may buy: the theme roster's CRs
   (or an explicit list), capped by the level's CR ceiling. Falls back to the
   level curve's anchor CRs when no roster is known. */
export function crLadderFor({ level = 1, themeKey = null, availableCRs = null, data = SPAWN_BUDGET } = {}) {
  const ceiling = maxCrForDungeonLevel(level, data);
  const src = (availableCRs && availableCRs.length) ? availableCRs
    : (themeKey ? dungeonMonsterCRs(themeKey) : null);
  let ladder = ((src && src.length) ? src : crAnchorCRs(data)).filter(c => c > 0 && c <= ceiling);
  ladder = [...new Set(ladder)].sort((a, b) => a - b);
  if (!ladder.length) ladder = [Math.min(ceiling, baseCrForDungeonLevel(level, data))];
  return ladder;
}

/* Snap DOWN to the dearest rung at or below `cr` — never up.
   crForDungeonLevel interpolates between anchors (it can return 2.9), and a
   roster may not carry that CR. Rounding to the *nearest* rung would sometimes
   round up and field a creature stronger than the level's controlled strength,
   which is never wanted; erring cheap is. Only if nothing on the ladder sits at
   or below `cr` do we take the cheapest rung there is. */
export function snapCRToLadder(cr, ladder) {
  if (!ladder || !ladder.length) return cr;
  let best = null;
  for (const x of ladder) { if (x <= cr) best = x; else break; }
  return best ?? ladder[0];
}

/**
 * Spend a room's threat purse on monster slots.
 *
 * SINGLE SOURCE OF TRUTH — the generator and the bestiary's Spawn Budget
 * preview both call this, so the tab cannot drift from what a floor actually
 * fields. (It used to be duplicated by hand in bestiary.js.)
 *
 * A room keeps buying until it hits the slot cap or genuinely cannot afford the
 * cheapest creature available. When a rolled CR is too expensive for what's left
 * in the purse it steps DOWN the CR ladder to the dearest thing it can still
 * afford rather than giving up — previously the loop broke on the first
 * unaffordable roll, which left 13-23% of every room's budget unspent and meant
 * rooms never came near the slot cap.
 *
 *   level         dungeon level, drives the CR curve
 *   budget        threat purse (roomSpawnBudget)
 *   cap           max slots (roomSpawnCap)
 *   rng           () => [0,1)
 *   costOf        CR -> cost; injectable so the bestiary can preview live edits
 *   themeKey      dungeon theme; its roster's CRs become the ladder, so the
 *                 purse is only ever charged for a creature that can really be
 *                 placed. This is what keeps paid cost == fielded cost.
 *   availableCRs  explicit ladder, overriding themeKey. Defaults to the level
 *                 curve's anchor CRs when neither is given.
 */
export function buyRoomSpawns(opts = {}) {
  const {
    level = 1, difficulty = 0, roomType = 'combat', threatMult = 1,
    data = SPAWN_BUDGET, rng = Math.random,
    costOf = (c) => crToCost(c, data),
    themeKey = null
  } = opts;
  const availableCRs = opts.availableCRs
    ?? (themeKey ? dungeonMonsterCRs(themeKey) : null);

  const budget = opts.budget ?? roomSpawnBudget(roomType, difficulty, threatMult, level, data);
  const cap = opts.cap ?? roomSpawnCap(level, data);
  const slack = data.overspendSlack ?? 0;
  const ceiling = maxCrForDungeonLevel(level, data);

  const ladder = crLadderFor({ level, themeKey, availableCRs, data });
  const snap = (c) => snapCRToLadder(c, ladder);
  const canAfford = (cost, rem) => cost <= rem + cost * slack;
  /* Dearest ladder entry still payable out of `rem`, or null. */
  const bestAffordable = (rem) => {
    for (let i = ladder.length - 1; i >= 0; i--) {
      if (canAfford(costOf(ladder[i]), rem)) return ladder[i];
    }
    return null;
  };

  /* One target CR per room, drawn across the level's WHOLE ladder instead of
     always the ceiling. The level curve's anchors sit on every level, so
     crForDungeonLevel returns the ceiling CR every time — which is why every
     room used to field the same mix (level 4 always rolled CR 1 and bought
     three bodies + a filler). Drawing lower is weighted HALF as likely per rung
     down, so rooms keep near their designed strength but sometimes come in a
     band down: same budget, different shape — a level-4 CR-1/2 draw buys five
     bodies instead of four CR-1s. */
  const drawRoomCR = (() => {
    const n = ladder.length;
    const w = [];
    let sum = 0;
    for (let i = 0; i < n; i++) { const wi = Math.pow(2, i); w.push(wi); sum += wi; }
    return () => {
      let r = rng() * sum;
      for (let i = 0; i < n; i++) { if ((r -= w[i]) < 0) return ladder[i]; }
      return ladder[n - 1];
    };
  })();

  const crs = [];
  let remaining = budget;
  /* Boss/finale rooms (the overland camp, the dungeon's exit room) keep a
     FIXED, densest composition: draw the cheapest rung the purse can buy under
     the slot cap, so the finale packs more bodies than any combat zone while
     still spending its (× typeMult) budget. Regular rooms use the varied draw
     so encounters differ. */
  let target = ladder[ladder.length - 1];
  if (roomType === 'boss') {
    for (let i = 0; i < ladder.length; i++) {
      if (Math.floor(budget / costOf(ladder[i])) < cap) { target = ladder[i]; break; }
    }
  } else {
    target = drawRoomCR();
    /* A cheap draw can overflow the room's slot cap before the purse is spent
       (a level-8 budget can afford thirteen CR-2s, but a room holds ten — it
       would cap out with most of the budget unspent). Step the draw UP to the
       cheapest rung that still leaves the cap room to spend the purse, so the
       room's shape varies but its budget is still honoured. Low-level budgets
       are small enough that this never triggers and variety is free. */
    if (Math.floor(budget / costOf(target)) >= cap) {
      let stepped = false;
      for (let i = 0; i < ladder.length; i++) {
        if (Math.floor(budget / costOf(ladder[i])) < cap) {
          target = ladder[i];
          stepped = true;
          break;
        }
      }
      if (!stepped) target = ladder[ladder.length - 1];
    }
  }
  while (crs.length < cap) {
    let c = snap(target);
    let cost = costOf(c);
    if (!canAfford(cost, remaining)) {
      const cheaper = bestAffordable(remaining);
      if (cheaper == null) break;      // purse exhausted — stop, not "buy anyway"
      c = cheaper;
      cost = costOf(c);
    }
    crs.push(c);
    remaining -= cost;
  }
  /* A purse too small for even the cheapest creature still yields one monster —
     an empty combat room reads as a bug to the player. */
  if (!crs.length) crs.push(snap(baseCrForDungeonLevel(level, data)));

  return { crs, budget, cap, spent: budget - remaining, remaining, ladder };
}

/* ---------------- RNG ---------------- */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const r = mulberry32(seed);
  return {
    f: (a, b) => a + r() * (b - a),
    i: (a, b) => a + Math.floor(r() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
    raw: r,
    gauss(mu, sig) {
      let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r();
      return mu + sig * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
  };
}

/* ---------------- constants ---------------- */
export const VOID = 0, FLOOR = 1, WALL = 2, POOL = 3;
/* How far an open grave sinks, in tiles at scale 1: the model's rim stands
   0.13 above its base (measured on 3d/Grim/Opengrave.glb) and it is drawn at
   1.94x (PROP_SCALE_MULTIPLIER.openGrave in dungeon_scene.js; keep the two in step). */
export const OPEN_GRAVE_RIM = 0.13 * 1.94;
/* The Shrine of Light (docs/LIGHT_IDEAS.md 47): at most one per DUNGEON floor
   (overland maps never get one, see generateOverland). A floor
   has a LIGHT_SHRINE_CHANCE chance of one, and it is one of that floor's
   ordinary shrines, so a floor without shrines never has one. Both are picked
   from a hash of the seed, not rng, so the roll doesn't reshuffle the rest of
   the level. The choice is stamped on the prop as `lightShrine`, so the
   renderer can draw the sun shrine and exploration can bless the party from
   the same flag. Shrines are placed with lightShrine:false so the rival
   room's shrineCrystal (no flag) is never a candidate. */
export const LIGHT_SHRINE_CHANCE = 0.25;
export function chooseLightShrine(props, seed) {
  const shrines = props.filter(p => p.kind === 'shrineCrystal' && p.lightShrine === false);
  const h = Math.imul((seed >>> 0) ^ 0x5ca1ab1e, 2654435761) >>> 0;
  if (!shrines.length || (h % 10000) >= LIGHT_SHRINE_CHANCE * 10000) return null;
  const pick = shrines[(h >>> 16) % shrines.length];
  pick.lightShrine = true;
  return pick;
}
export const TYPE = { ENTRANCE: 'entrance', COMBAT: 'combat', ELITE: 'elite', TREASURE: 'treasure', SHRINE: 'shrine', BOSS: 'boss', RIVAL: 'rival' };
export const TINT = { entrance: 0x3fd0bb, combat: 0x8f95a3, elite: 0x9b6cf0, treasure: 0xd9a441, shrine: 0x5a8fe8, boss: 0xd8433a, rival: 0xe8973f };

export const ROOM_STYLES = {
  swarm: {
    id: 'swarm',
    title: 'INFESTATION',
    subtitle: 'An overwhelming horde of low-level creatures!',
    themes: null
  },
  miniboss: {
    id: 'miniboss',
    title: "COMMANDER'S GARRISON",
    subtitle: 'A formidable leader commands bodyguards here!',
    themes: null
  },
  ritual: {
    id: 'ritual',
    title: 'CULT RITUAL CHAMBER',
    subtitle: 'Spellcasters channel ancient magic behind fanatical guards.',
    themes: ['ancient', 'grim', 'frost', 'molten', 'holdfast']
  },
  ambush: {
    id: 'ambush',
    title: 'PINCER AMBUSH',
    subtitle: 'Monsters lie in wait to encircle your party!',
    themes: null
  },
  killzone: {
    id: 'killzone',
    title: 'THE KILLZONE',
    subtitle: 'Snipers hold the rear wall behind heavy defenders.',
    themes: ['holdfast', 'ancient', 'grim', 'frost']
  },
  nest: {
    id: 'nest',
    title: 'THE BROOD NEST',
    subtitle: 'A brood mother defends her ravenous hatchlings!',
    themes: ['verdant', 'forest', 'mire', 'moor']
  },
  juggernaut: {
    id: 'juggernaut',
    title: 'SIEGE VANGUARD',
    subtitle: 'Heavily armored juggernauts block the way!',
    themes: ['molten', 'ancient', 'holdfast', 'frost']
  },
  duelists: {
    id: 'duelists',
    title: "CHAMPIONS' RING",
    subtitle: 'Two elite martial champions stand ready for battle.',
    themes: null
  },
  necromantic: {
    id: 'necromantic',
    title: 'NECROMANTIC GRAVEYARD',
    subtitle: 'A dark practitioner summons undead from the soil.',
    themes: ['grim', 'ancient']
  },
  arcane_surge: {
    id: 'arcane_surge',
    title: 'LEY LINE SURGE',
    subtitle: 'Volatile magic infuses all monsters in this room!',
    themes: ['ancient', 'molten', 'frost', 'verdant']
  }
};

/* ---------------- theme specs ---------------- */
export const THEMES = {
  ancient: {
    label: 'ANCIENT', accent: '#e8973f',
    bg: 0x141a22, fog: 0x141a22, fogD: 0.0020,
    hemi: [0x485c72, 0x1c2028, 0.52], dir: [0xedd5b8, 0.75],
    floor: 0x646a78, corridor: 0x505866, wall: 0x424a58, cap: 0x545a68,
    pillar: 0x424a58, debris: [0x383e4a, 0x504438],
    flame: 0xffa640, flameCore: 0xfff3c8, torchLight: [0xff8c3a, 1.8, 9.5],
    cloth: 0x5c201b,
    tile: { runes: 0.55 },
    propScatter: { vase: 0.0025, grainjars: 0.0035 },
    pools: null, particles: { kind: 0, color: 0x8894ac, n: 110 },
    nameA: ['Sunken', 'Forgotten', 'Silent', 'Hollow', 'Elder', 'Broken', 'Nameless', 'Fallen'],
    nameB: ['Halls', 'Vaults', 'Catacombs', 'Depths', 'Sanctum', 'Undercroft', 'Barrows', 'Reliquary']
  },
  molten: {
    label: 'MOLTEN', accent: '#ff8642',
    bg: 0x161010, fog: 0x1c1414, fogD: 0.0022,
    hemi: [0x5c3826, 0x1a0e0c, 0.50], dir: [0xffc898, 0.60],
    /* walls/caps are cool basalt grey, not warm brown: every light in this
       theme is orange (hemi, dir and torches), so a warm albedo compounds into
       tan. The fire colour comes from the lighting and lava, not the rock. */
    floor: 0x645448, corridor: 0x504036, wall: 0x2a2c33, cap: 0x36383f,
    pillar: 0x4a3b30, debris: [0x382a20, 0x503a28],
    flame: 0xff8c26, flameCore: 0xffe9b0, torchLight: [0xff7326, 1.8, 10],
    cloth: 0x54180e,
    tile: { embers: 0.05 },
    propScatter: { anvil: 0.002, stalagmite: 0.005, boulderPile: 0.004, forgeChains: 0.0035, ingotStack: 0.0025, smeltingCrucible: 0.002 },
    pools: {
      mode: 0, colA: 0x2b0d05, colB: 0xff5a1f, glow: 1.75, amount: 0.16, pits: 2,
      /* [min,max] cells per body: wall-seepage flows, then floor pits */
      body: [4, 9], pitBody: [3, 6]
    },
    particles: { kind: 1, color: 0xff8030, n: 420 },
    nameA: ['Molten', 'Ashen', 'Cindered', 'Smouldering', 'Charred', 'Burning', 'Ember', 'Scorched'],
    nameB: ['Forges', 'Furnaces', 'Calderas', 'Foundry', 'Kilns', 'Vents', 'Crucible', 'Depths']
  },
  frost: {
    label: 'FROST', accent: '#7fd4ff',
    bg: 0x101824, fog: 0x162232, fogD: 0.0022,
    hemi: [0x425d7e, 0x121824, 0.50], dir: [0xcfe4ff, 0.72],
    floor: 0x6c7a8e, corridor: 0x546274, wall: 0x445268, cap: 0x5e6e82,
    pillar: 0x506074, debris: [0x3e4d64, 0x586478],
    flame: 0x86d9ff, flameCore: 0xe8f7ff, torchLight: [0x6fc4ff, 1.8, 9.5],
    cloth: 0x1b3550,
    tile: { rime: 0.5, rough: 0.62 },
    propScatter: { icebone: 0.003 },
    pools: { mode: 1, colA: 0x4a86c0, colB: 0xbfe4ff, glow: 0.55, amount: 0, body: [3, 6], pitBody: [2, 4] },
    lakes: true, icicles: true, particles: { kind: 2, color: 0xe8f4ff, n: 350 },
    nameA: ['Frozen', 'Rimebound', 'Glacial', 'Howling', 'Pale', 'Shivering', 'Wintered', 'Whitelocked'],
    nameB: ['Crypts', 'Caverns', 'Hollows', 'Galleries', 'Sepulchre', 'Warrens', 'Reaches', 'Throat']
  },
  grim: {
    label: 'GRIM', accent: '#9fe66a',
    bg: 0x101610, fog: 0x141e14, fogD: 0.0025,
    hemi: [0x324638, 0x101610, 0.48], dir: [0xb8d0aa, 0.52],
    floor: 0x56624e, corridor: 0x44503e, wall: 0x343e2e, cap: 0x4b5642,
    pillar: 0x424c3a, debris: [0x323c2d, 0x4a4834],
    flame: 0x8fe05a, flameCore: 0xe9ffd0, torchLight: [0x77d94a, 1.8, 9],
    cloth: 0x223014,
    tile: { stains: 0.07 },
    pools: { mode: 3, colA: 0x0a1207, colB: 0x41602c, glow: 0.6, amount: 0.05, pits: 1, body: [3, 7], pitBody: [2, 5] },
    graveyards: true, bones: true, particles: { kind: 3, color: 0x7ec44e, n: 150 },
    groundFog: { density: 0.20, speed: 0.02, color: 0x84a872, scale: 0.11, height: 0.20 },
    nameA: ['Blighted', 'Weeping', 'Rotting', 'Cursed', 'Umbral', 'Plagued', 'Mournful', 'Grim'],
    nameB: ['Necropolis', 'Ossuary', 'Tombs', 'Charnels', 'Graves', 'Catacombs', 'Morgue', 'Crypts']
  },
  verdant: {
    label: 'VERDANT', accent: '#59d68f',
    bg: 0x141810, fog: 0x1c2016, fogD: 0.0022,
    /* daylight filtering into the overgrowth: warm white sun plus a soft warm
       ambient, rather than the green-on-green it used to be. The theme's green
       still comes from the foliage, the torch flames and the pool glow. */
    hemi: [0x7a7a5e, 0x18160f, 0.52], dir: [0xffeccb, 0.72],
    /* walls/caps sit near-neutral so the vine-brick tile shows its own brown
       and green; a green tint here would filter the brick back out to moss */
    floor: 0x54321e, corridor: 0x452818, wall: 0x5c5c54, cap: 0x6a6a60,
    pillar: 0x405038, debris: [0x2f3e26, 0x465038],
    flame: 0xffcf6a, flameCore: 0xfff6da, torchLight: [0xffd28a, 1.8, 9],
    cloth: 0x143624,
    tile: { growth: 0.45, sprout: 0.04 },
    propScatter: { fren1: 0.0012, fren2: 0.0012, fren3: 0.0012, fren4: 0.0012, mushroomA: 0.003, mushroomB: 0.003, rootsA: 0.0025, rootsB: 0.0025 },
    pools: { mode: 2, colA: 0x0c3532, colB: 0x2fa38a, glow: 0.6, amount: 0.05, pits: 1, body: [4, 9], pitBody: [3, 6] },
    roots: true, shafts: false, particles: { kind: 4, color: 0x6cb88e, n: 200 },
    nameA: ['Verdant', 'Overgrown', 'Sporebound', 'Tangled', 'Mossgrown', 'Waking', 'Feral', 'Blooming'],
    nameB: ['Gardens', 'Warrens', 'Roots', 'Conservatory', 'Hollows', 'Groves', 'Cisterns', 'Arbors']
  },
  forest: {
    label: 'FOREST', accent: '#8fd45a', overland: true,
    bg: 0x5282a8, fog: 0x709ec4, fogD: 0.0006,
    hemi: [0x82b4dc, 0x4e6638, 0.45], dir: [0xfff4db, 0.78], sunAngle: [54, 46],
    floor: 0x587e46, corridor: 0x8e7a5c, wall: 0x5a5448, cap: 0x3d6630,
    pillar: 0x52483a, debris: [0x585c54, 0x765e48],
    flame: 0xffa640, flameCore: 0xfff3c8, torchLight: [0xff8c3a, 1.8, 9.5],
    cloth: 0x61341a,
    tile: {},
    oc: {
      liquid: { amount: 0.020, body: [6, 14] },   /* woodland ponds */
      roadBand: [2, 2],
      /* standalone trees in the clearings: pine plus the broadleaf models
         (3d/Holdfast, leafed by tree_foliage.js), same total as the old pine-only 0.012 */
      ground: {
        spruce: 0.002, fir: 0.001, pine: 0.001, oak: 0.002, elm: 0.002, birch: 0.002, hawthorn: 0.002, mushroomLog: 0.05, rocks: 0.06, stump: 0.04, vinemound: 0.03, cairn: 0.02, stakes: 0.018, rack: 0.015, goblinfire: 0.015, skulltotem: 0.008,
        firewood: 0.008
      }
    },   /* woodcutters' stacks */
    pools: { mode: 2, colA: 0x0d2a33, colB: 0x3f9ec4, glow: 0.40, amount: 0 },
    particles: { kind: 0, color: 0xffe8aa, n: 120 },
    nameA: ['Greenrise', 'Bramblewood', 'Thornfell', 'Wildmere', 'Oakshade', 'Ferndeep', 'Mosswild', 'Tanglebrook'],
    nameB: ['Glade', 'Hollow', 'Camp', 'Crossing', 'Thicket', 'Clearing', 'Trailhead', 'Verge']
  },
  moor: {
    label: 'MOOR', accent: '#c9b877', overland: true,
    bg: 0x1b201a, fog: 0x242a22, fogD: 0.0022,
    hemi: [0x525848, 0x1c1e18, 0.50], dir: [0xd8d4bc, 0.60],
    floor: 0x58623f, corridor: 0x6e644e, wall: 0x4e5046, cap: 0x4e582c,
    pillar: 0x4e4b44, debris: [0x48443b, 0x525039],
    flame: 0xffa640, flameCore: 0xfff3c8, torchLight: [0xff8c3a, 1.8, 9],
    cloth: 0x3d331d,
    tile: {},
    blocker: { trunkH: 0.34, trunkR: 2.1, canopyS: 1.45, canopyY: 0.10 },
    oc: {
      liquid: { amount: 0.024, body: [5, 12] },   /* peat bog pools */
      roadBand: [3, 3],
      edgeMin: 1, edgeRand: 2, belt: 0.16, beltLinked: 0.05, lone: 0.034,
      copseDiv: 820, copseChance: 0.55,
      camp: { palisade: false, tents: 0, bones: true },
      ground: { pine: 0.004, spruce: 0.004, swamptree: 0.008, debris: 0.05, moss: 0.018, bush: 0.05, signpost: 0.008, brokenSignpost: 0.008, wheel: 0.005 }
    },
    pools: { mode: 3, colA: 0x141a0e, colB: 0x4a5a2c, glow: 0.30, amount: 0 },
    nameA: ['Windbare', 'Greyfell', 'Cairnmoor', 'Highfold', 'Stonecrop', 'Coldrise', 'Hetherwold', 'Longbarrow'],
    nameB: ['Moor', 'Downs', 'Drove-road', 'Heath', 'Pasture', 'Sinkhole', 'Reach', 'Waste']
  },
  mire: {
    label: 'MIRE', accent: '#6f9a72', overland: true,
    bg: 0x101614, fog: 0x161e1b, fogD: 0.0032,
    hemi: [0x3c4c42, 0x121614, 0.46], dir: [0xadbcad, 0.50],
    floor: 0x3a4234, corridor: 0x464434, wall: 0x323028, cap: 0x36382a,
    pillar: 0x312e26, debris: [0x282a20, 0x343124],
    flame: 0x9ad6a0, flameCore: 0xe0ffe4, torchLight: [0x76c48a, 1.8, 8],
    cloth: 0x1e2619,
    tile: { stains: 0.10 },
    blocker: { trunkH: 1.35, trunkR: 0.85, canopyS: 0.34, canopyY: 0.72 },
    oc: {
      liquid: { amount: 0.060, body: [20, 48], bridge: 'wood' },  /* broad meres, planked over */
      roadBand: [2, 2],
      edgeMin: 3, edgeRand: 4, belt: 0.78, beltLinked: 0.14, lone: 0.05,
      copseDiv: 250, copseChance: 0.8,
      camp: { palisade: false, tents: 0, bones: true },
      ground: {
        swamptree: 0.008, deadtree: 0.008, debris: 0.012, moss: 0.11,
        standingStoneA: 0.004, standingStoneB: 0.004
      },
      shore: { cattails: 0.09, cattailsMax: 36, boats: [1, 3] }
    },
    pools: { mode: 3, colA: 0x070d09, colB: 0x2f4a34, glow: 0.35, amount: 0.22, pits: 2, body: [3, 7], pitBody: [2, 5] },
    particles: { kind: 5, color: 0x82a898, n: 350 },
    nameA: ['Marrowfen', 'Blackwater', 'Sunkmoss', 'Drownfield', 'Reedmourn', 'Stillwater', 'Bogrun', 'Quagmire'],
    nameB: ['Fen', 'Mire', 'Sinks', 'Causeway', 'Shallows', 'Marsh', 'Drownings', 'Verge']
  },
  holdfast: {
    label: 'HOLDFAST', accent: '#e0a24a', overland: true,
    bg: 0x171410, fog: 0x241d15, fogD: 0.0018,
    hemi: [0xd8c2a0, 0x2e2820, 0.58], dir: [0xffe0b0, 0.66],
    floor: 0x6f7a4e, corridor: 0xa08d63, wall: 0x7a6a52, cap: 0x5e7040,
    pillar: 0x86755a, debris: [0x6b6152, 0x7a6a4a],
    flame: 0xffb452, flameCore: 0xfff6d2, torchLight: [0xffa04a, 1.8, 10],
    cloth: 0x8e2b24,
    tile: {},
    stake: 0x9a825e, stakeCap: 0x7a6448,
    /* Settled country: trees at the edge of the map, not masonry, and a dirt
       road autotiled from the DCSS grass/dirt fringe set down the trail.
       groundTiles.road = half-width of the dirt in tiles either side of the
       centreline; wear = chance (in clumps) that the next row out is worn to
       dirt too; sat/bright grade the bright DCSS tiles toward the biome.
       road 0 + wear 0.5 is a ~2-tile track (road 1 read too wide, Zenu 2026-10-27). */
    blockerGeo: 'tree',
    /* fraction of the tree belt actually planted: settled country is open
       land with stands of trees, not a forest wall (Zenu, 2026-10-27) */
    treeDensity: 0.35,
    groundTiles: { road: 0, wear: 0.5, sat: 0.55, bright: 0.78 },
    oc: {
      liquid: { amount: 0.010, body: [4, 8] },    /* cisterns & moat remnants */
      /* a river right across the map, bridged where the road meets it.
         halfWidth = half the water's width in tiles ([2, 2.5] = 4-5 wide,
         Zenu 2026-10-29); it narrows to 3 where two clearings pinch it.
         chance = how many holdfast maps get one; params.river forces it */
      river: { chance: 0.6, halfWidth: [2, 2.5], lanes: 3, bridge: 'wood' },
      roadBand: [3, 2],
      edgeMin: 2, edgeRand: 2, belt: 0.30, beltLinked: 0.03, lone: 0.012,
      copseDiv: 700, copseChance: 0.6,
      /* palisadeModel: the camp ring is drawn as 'stakes' fence sections laid
         along it instead of plain timber posts (the cells stay WALL) */
      camp: { palisade: true, palisadeModel: 'stakes', tents: [6, 8], bones: false },
      /* settled, worked ground — weapon racks, cart wreckage. Stakes are
         not scattered here: they come as fences (ruins, fences, camp) */
      ground: {
        debris: 0.035, moss: 0.030, rack: 0.020,
        /* no cairn here: the stacked-stone model reads as snow country */
        wheel: 0.004, signpost: 0.012, bush: 0.025,
        /* settled-country models (3d/Holdfast): a lone broken wall
           section, a cart, a well, woodpiles. The long wall is only
           used by the ruins below. Walls and the cart are solid, so
           they stay sparse enough not to wall off the clearings. */
        stoneWallB: 0.005, oldCart: 0.006, oldWell: 0.004, firewood: 0.014
      },
      /* L- and U-shaped footings of field walls: where a building stood.
         fence = chance the footing's open front gets a stake fence with a
         gate gap */
      ruins: { count: [3, 5], fence: 0.75 }
    },
    /* No free-standing `fences` runs: lone stake lines in open clearings
       looked out of place (Zenu, 2026-10-27). The generator still supports
       oc.fences:{ count, len, turn } for a theme that wants them. */
    pools: { mode: 2, colA: 0x11242b, colB: 0x3d8ba6, glow: 0.35, amount: 0 }, particles: { kind: 0, color: 0xe8d8a8, n: 120 },
    nameA: ['Aldergate', 'Kingsmuster', 'Charterhall', 'Wardstone', 'Oathkeep', 'Highmarch', 'Stoneyard', 'Banneret'],
    nameB: ['Holdfast', 'Chapterhouse', 'Muster', 'Yard', 'Bastion', 'Proving-ground', 'Gate', 'Bailey']
  },

  /* ---- threshold overlands: the doorstep of each dungeon theme ----
     These are the floor-2 surfaces of the overland prologue (see
     game/overland_prologue.js). Each one is the dungeon theme's own country
     seen from above ground, so the walk in reads as one continuous descent.
     `blockerGeo` picks the wall silhouette ('tree' trunks+canopy, the original
     overland look, or 'block' masonry), `groundMat` picks the floor texture,
     and `canopyTint` recolors the foliage blend on tree blockers. */
  boneyard: {
    label: 'BONEYARD', accent: '#9fd08a', overland: true, threshold: 'grim',
    bg: 0x151a16, fog: 0x1b221c, fogD: 0.0024,
    hemi: [0x4a5850, 0x161a16, 0.50], dir: [0xc8ccc0, 0.55],
    floor: 0x4e5844, corridor: 0x5e5c4c, wall: 0x6e7068, cap: 0x7a7c72,
    pillar: 0x6a6c64, debris: [0x4a4c44, 0x5c5a4e],
    flame: 0x8fe05a, flameCore: 0xe9ffd0, torchLight: [0x77d94a, 1.8, 9],
    cloth: 0x223014,
    tile: { stains: 0.05 },
    /* dead trees (3d/Grim), sparse: the masonry boxes read as a field of
       pillars over the ~60% of the map that is blocker (Zenu, 2026-11-01) */
    blockerGeo: 'tree', treeDensity: 0.4, groundMat: 'grass',
    /* holdfast's tiled ground, but the track is laid in cobbles (surface:
       'cobble', guild_ground.js) and the turf is graded duller and darker */
    groundTiles: { road: 0, wear: 0.5, sat: 0.45, bright: 0.72, sepia: 0.6, surface: 'cobble' },
    /* dead, brown-grey turf: `sepia` above browns the baked ground, and
       deadGrass swaps the 3D grass tufts and wall moss to dry straw tones
       (Zenu: too green and alive, 2026-11-01) */
    deadGrass: true,
    oc: {
      /* no water: the grave meres made it read as moor (Zenu, 2026-11-01) */
      roadBand: [2, 2],
      edgeMin: 2, edgeRand: 2, belt: 0.34, beltLinked: 0.05, lone: 0.018,
      copseDiv: 620, copseChance: 0.50,
      camp: { palisade: false, tents: 0, bones: true },
      /* Tended ground, not wilderness (Zenu, 2026-11-01): headstones stand in
         rows (graveyards.rows) with only a few strays, the wooden stakes are
         gone, and the gallows tree is a lone landmark out in the open */
      ground: {
        tombstone: 0.020, cairn: 0.020, bush: 0.030,
        rocks: 0.018, debris: 0.022, moss: 0.020, gallowsTree: 0.008,
        /* the Grim crypts' bone models, out in the open */
        skull: 0.014, bonePile: 0.012, skeleton: 0.010, bones: 0.012
      },
      /* fenced plots, outer sides picked from `sizes` (odd: whole two-cell
         fence segments); `bell` is the chance one plot gets a funeral bell
         beside its gate, `lychgate` the chance a plot's gateway gets one */
      graveyards: { count: [3, 4], sizes: [5, 7], bell: 0.4, lychgate: 0.85,
        /* the boss camp is a fenced yard round a mausoleum (Zenu, 2026-11-01) */
        arena: true, openGraves: [1, 2],
        /* lone landmarks out in the open: [min, max] per map */
        mausoleums: [2, 4], angels: [2, 3], benches: [3, 5],
        /* rows of headstones out in the open: [min, max] rows, stones per row */
        rows: { count: [7, 11], len: [3, 6] },
        /* wrought-iron fence along the treeline: run length in cells, the
           share of each flanking row that must already be trees / open
           ground, and the chance each fitting stretch is fenced */
        edgeFences: { len: [3, 15], diagLen: [4, 10], wall: 0.55, depth: 2, chance: 1 } }
    },
    pools: { mode: 3, colA: 0x0d120e, colB: 0x38492f, glow: 0.28, amount: 0 },
    particles: { kind: 3, color: 0x98c088, n: 200 },
    nameA: ['Gravewatch', 'Lychfield', 'Bonerow', 'Mournhill', 'Silentyard', 'Palerow', 'Cold-earth', 'Wakeless'],
    nameB: ['Boneyard', 'Graves', 'Lychyard', 'Burial-field', 'Gravewalk', 'Grave-rows', 'Potter’s Field', 'Restings']
  },
  ruinfield: {
    label: 'RUINFIELD', accent: '#e8973f', overland: true, threshold: 'ancient',
    bg: 0x1c1b18, fog: 0x252219, fogD: 0.0018,
    hemi: [0x7a7462, 0x24211a, 0.54], dir: [0xf0dcb8, 0.70],
    floor: 0x7a705a, corridor: 0x8c8064, wall: 0x6e6a60, cap: 0x7e7a6e,
    pillar: 0x76726a, debris: [0x5c584e, 0x6e6656],
    flame: 0xffa640, flameCore: 0xfff3c8, torchLight: [0xff8c3a, 1.8, 9.5],
    cloth: 0x5c201b,
    tile: { runes: 0.30 },
    blockerGeo: 'block', blockerH: [1.25, 0.7], groundMat: 'floor',
    oc: {
      liquid: { amount: 0.016, body: [5, 11] },   /* flooded foundations */
      roadBand: [3, 2],
      edgeMin: 2, edgeRand: 3, belt: 0.40, beltLinked: 0.06, lone: 0.020,
      copseDiv: 560, copseChance: 0.55,
      camp: { palisade: false, tents: [3, 4], bones: true },
      ground: {
        pillarA: 0.020, pillarB: 0.020, vase: 0.018, rocks: 0.045,
        cairn: 0.018, debris: 0.040
      }
    },
    pools: { mode: 2, colA: 0x122529, colB: 0x46909e, glow: 0.35, amount: 0 }, particles: { kind: 0, color: 0xbfae8c, n: 140 },
    nameA: ['Sunken', 'Toppled', 'Nameless', 'Weathered', 'Drift-buried', 'Elder', 'Broken', 'Wind-scoured'],
    nameB: ['Ruins', 'Colonnade', 'Plaza', 'Foundations', 'Terraces', 'Stones', 'Concourse', 'Approach']
  },
  ashfield: {
    label: 'ASHFIELD', accent: '#ff8642', overland: true, threshold: 'molten',
    bg: 0x18100c, fog: 0x241610, fogD: 0.0028,
    hemi: [0x6a3824, 0x1c100a, 0.50], dir: [0xffb488, 0.52],
    floor: 0x4a4038, corridor: 0x5a4c3e, wall: 0x38302c, cap: 0x463a34,
    pillar: 0x3e3630, debris: [0x2e2824, 0x4a3a2c],
    flame: 0xff8c26, flameCore: 0xffe9b0, torchLight: [0xff7326, 1.8, 10],
    cloth: 0x54180e,
    tile: { embers: 0.035 },
    blockerGeo: 'block', blockerH: [1.35, 0.8], groundMat: 'floor',
    oc: {
      liquid: { amount: 0.022, body: [7, 16] },   /* open lava flows */
      roadBand: [3, 2],
      edgeMin: 2, edgeRand: 3, belt: 0.42, beltLinked: 0.07, lone: 0.026,
      copseDiv: 480, copseChance: 0.58,
      camp: { palisade: false, tents: [3, 5], bones: true },
      ground: {
        rocks: 0.055, anvil: 0.010, stakes: 0.014, skulltotem: 0.008,
        cairn: 0.016, debris: 0.035, coolingRocks: 0.014, lavaSpikeA: 0.004, lavaSpikeB: 0.004
      }
    },
    pools: { mode: 0, colA: 0x2b0d05, colB: 0xff5a1f, glow: 1.45, amount: 0 },
    particles: { kind: 6, color: 0xff9450, n: 420 },
    nameA: ['Cinderflat', 'Ashfall', 'Scoriawaste', 'Emberreach', 'Slagfield', 'Smouldering', 'Blackglass', 'Vent-scarred'],
    nameB: ['Ashfields', 'Flows', 'Cinder-cones', 'Slaglands', 'Burnt-waste', 'Vents', 'Barrens', 'Approach']
  },
  snowfield: {
    label: 'SNOWFIELD', accent: '#7fd4ff', overland: true, threshold: 'frost',
    bg: 0x16202e, fog: 0x1e2c3e, fogD: 0.0026,
    hemi: [0x6d88a8, 0x1a2230, 0.56], dir: [0xe4f0ff, 0.78],
    floor: 0x9aa8b8, corridor: 0x8494a6, wall: 0x4a4238, cap: 0x8fa6b4,
    pillar: 0x5a6472, debris: [0x64707e, 0x7e8a96],
    flame: 0x86d9ff, flameCore: 0xe8f7ff, torchLight: [0x6fc4ff, 1.8, 9.5],
    cloth: 0x1b3550,
    tile: { rime: 0.45, rough: 0.55 },
    blockerGeo: 'tree', canopyTint: 0xdfe9f2, groundMat: 'grass',
    blocker: { trunkH: 1.15, trunkR: 0.55, canopyS: 0.62, canopyY: 0.62 },
    icicles: true,
    oc: {
      liquid: { amount: 0.020, body: [8, 18] },   /* frozen meltwater */
      roadBand: [3, 3],
      edgeMin: 2, edgeRand: 3, belt: 0.44, beltLinked: 0.07, lone: 0.030,
      copseDiv: 420, copseChance: 0.62,
      camp: { palisade: false, tents: [3, 5], bones: true },
      ground: {
        snowspruce: 0.012, snowfir: 0.008, snowpine: 0.008, icebone: 0.048, cairn: 0.024, rocks: 0.038, signpost: 0.008,
        brokenSignpost: 0.008, debris: 0.020, snowcartA: 0.004, snowcartB: 0.004
      }
    },
    pools: { mode: 1, colA: 0x4a86c0, colB: 0xbfe4ff, glow: 0.50, amount: 0 },
    particles: { kind: 2, color: 0xffffff, n: 500 },
    nameA: ['Whitewaste', 'Windbite', 'Palefall', 'Frostmarch', 'Snowbound', 'Rimeflat', 'Coldreach', 'Glacier-edge'],
    nameB: ['Snowfield', 'Pass', 'White-waste', 'Drifts', 'Crossing', 'Barrens', 'Windrow', 'Approach']
  },
  sporewood: {
    label: 'SPOREWOOD', accent: '#59d68f', overland: true, threshold: 'verdant',
    bg: 0x0f1712, fog: 0x142018, fogD: 0.0032,
    hemi: [0x2e4738, 0x0f1712, 0.52], dir: [0x8fd6a4, 0.65],
    floor: 0x223326, corridor: 0x2a3d2e, wall: 0x2a2233, cap: 0x287d52,
    pillar: 0x28382c, debris: [0x1c2b20, 0x2e4233],
    flame: 0x59d68f, flameCore: 0xdaffed, torchLight: [0x4ad98e, 1.8, 9.5],
    cloth: 0x123020,
    tile: { growth: 0.45, sprout: 0.04 },
    blockerGeo: 'tree', canopyTint: 0x59d68f, groundMat: 'grass',
    blocker: { trunkH: 0.75, trunkR: 0.75, canopyS: 1.2, canopyY: 0.55 },
    oc: {
      liquid: { amount: 0.020, body: [5, 12] },   /* spore-clouded seeps */
      roadBand: [2, 2],
      edgeMin: 3, edgeRand: 3, belt: 0.58, beltLinked: 0.10, lone: 0.040,
      copseDiv: 300, copseChance: 0.72,
      camp: { palisade: false, tents: 0, bones: true },
      ground: {
        swamptree: 0.012, mushroomA: 0.048, mushroomB: 0.048, rootsA: 0.028, rootsB: 0.028,
        fren1: 0.012, fren2: 0.012, fren3: 0.012, fren4: 0.012,
        vinemound: 0.028, moss: 0.090
      }
    },
    pools: { mode: 3, colA: 0x0a1a12, colB: 0x3fa06a, glow: 0.55, amount: 0 },
    particles: { kind: 4, color: 0x8fd0a0, n: 300 },
    nameA: ['Sporebound', 'Capfell', 'Mycelian', 'Blightbloom', 'Rotcap', 'Veilspore', 'Dampwood', 'Fruiting'],
    nameB: ['Sporewood', 'Grove', 'Caps', 'Bloom', 'Thicket', 'Mouth', 'Hollow', 'Approach']
  }
};
/* Tuning layer written by the dungeon editor (dungeon_editor.html). Values here
   are merged over the tables above, so THEMES stays the readable default and a
   tuning pass is a small reviewable diff instead of edits scattered through the
   theme literals. Nested objects merge key-by-key; arrays replace wholesale. */
function mergeThemeOverrides(base, patch) {
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      mergeThemeOverrides(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}
for (const key of Object.keys(THEME_OVERRIDES)) {
  if (THEMES[key]) mergeThemeOverrides(THEMES[key], THEME_OVERRIDES[key]);
}

export const THEME_KEYS = Object.keys(THEMES).filter(k => !THEMES[k].overland);

export const SPAWN_THEMES = {
  ancient: { spawnMatName: 'stone', spawn1GeoName: 'spawn1', spawn2GeoName: 'spawn2', spawn3GeoName: 'spawn3', baseCol: 0x6a707e, ringCol: 0x3fd0bb, crystalCol: 0x8fbcff },
  molten: { spawnMatName: 'stone', spawn1GeoName: 'spawn1_molten', spawn2GeoName: 'spawn2_molten', spawn3GeoName: 'spawn3_molten', baseCol: 0x201c1a, ringCol: 0xff5a1f, crystalCol: 0xff7a30 },
  frost: { spawnMatName: 'ice', spawn1GeoName: 'spawn1_frost', spawn2GeoName: 'spawn2_frost', spawn3GeoName: 'spawn3_frost', baseCol: 0xbfe2ff, ringCol: 0x7fd4ff, crystalCol: 0xffffff },
  grim: { spawnMatName: 'stone', spawn1GeoName: 'spawn1_grim', spawn2GeoName: 'spawn2_grim', spawn3GeoName: 'spawn3_grim', baseCol: 0x3b4238, ringCol: 0x9fe66a, crystalCol: 0xe9ffd0 },
  verdant: { spawnMatName: 'bark', spawn1GeoName: 'spawn1_verdant', spawn2GeoName: 'spawn2_verdant', spawn3GeoName: 'spawn3_verdant', baseCol: 0x6b5a45, ringCol: 0x59d68f, crystalCol: 0x62e0a8 },
  forest: { spawnMatName: 'bark', spawn1GeoName: 'spawn1', spawn2GeoName: 'spawn2', spawn3GeoName: 'spawn3', baseCol: 0x6b4a2f, ringCol: 0xff8c3a, crystalCol: 0xffd27a },
  moor: { spawnMatName: 'stone', spawn1GeoName: 'spawn1', spawn2GeoName: 'spawn2', spawn3GeoName: 'spawn3', baseCol: 0x6d6b63, ringCol: 0xc9b877, crystalCol: 0xefe6c0 },
  mire: { spawnMatName: 'bark', spawn1GeoName: 'spawn1_verdant', spawn2GeoName: 'spawn2_verdant', spawn3GeoName: 'spawn3_verdant', baseCol: 0x3e3a31, ringCol: 0x6f9a72, crystalCol: 0xbfe0c4 },
  holdfast: { spawnMatName: 'stone', spawn1GeoName: 'spawn1', spawn2GeoName: 'spawn2', spawn3GeoName: 'spawn3', baseCol: 0x7a6a52, ringCol: 0xe0a24a, crystalCol: 0xffe0b0 },
  /* threshold overlands reuse their parent dungeon theme's spawn silhouettes */
  boneyard: { spawnMatName: 'stone', spawn1GeoName: 'spawn1_grim', spawn2GeoName: 'spawn2_grim', spawn3GeoName: 'spawn3_grim', baseCol: 0x5a6054, ringCol: 0x9fd08a, crystalCol: 0xe9ffd0 },
  ruinfield: { spawnMatName: 'stone', spawn1GeoName: 'spawn1', spawn2GeoName: 'spawn2', spawn3GeoName: 'spawn3', baseCol: 0x8a8270, ringCol: 0xe8973f, crystalCol: 0xffd9a8 },
  ashfield: { spawnMatName: 'stone', spawn1GeoName: 'spawn1_molten', spawn2GeoName: 'spawn2_molten', spawn3GeoName: 'spawn3_molten', baseCol: 0x2a2422, ringCol: 0xff5a1f, crystalCol: 0xff7a30 },
  snowfield: { spawnMatName: 'ice', spawn1GeoName: 'spawn1_frost', spawn2GeoName: 'spawn2_frost', spawn3GeoName: 'spawn3_frost', baseCol: 0xc8dcec, ringCol: 0x7fd4ff, crystalCol: 0xffffff },
  sporewood: { spawnMatName: 'bark', spawn1GeoName: 'spawn1_verdant', spawn2GeoName: 'spawn2_verdant', spawn3GeoName: 'spawn3_verdant', baseCol: 0x5e4e68, ringCol: 0x59d68f, crystalCol: 0x62e0a8 }
};

/**
 * Per-theme doorway styling. Every theme used to share one chamfered-box
 * threshold tinted from TH.wall, which made a lava vault and an ice cavern read
 * identically at the door. Each theme now names its own post/lintel silhouette
 * (built in dungeon_geo.js) and its own material + tints.
 *
 *   postGeoName / lintelGeoName  keys into GEO; missing keys fall back to the
 *                                default ancient-flavoured pair
 *   matName                      'stone' | 'ice' | 'bark' — same material pool
 *                                the spawn portals draw from
 *   postCol / lintelCol          null = derive from the theme's wall colour, so
 *                                a theme that wants to stay neutral can
 *   gateMix                      how far the gate slab under the arch is
 *                                darkened toward black
 *
 * Open-terrain biomes share the 'overland' silhouette — standing stones and a
 * lashed crossbeam — which is what gives overland maps their own themed
 * entrance and zone-transition markers.
 */
export const DOORWAY_THEMES = {
  ancient: {
    postGeoName: 'archPost_ancient', lintelGeoName: 'archLintel_ancient', matName: 'stone',
    postCol: null, lintelCol: null, gateMix: 0.20
  },
  molten: {
    postGeoName: 'archPost_molten', lintelGeoName: 'archLintel_molten', matName: 'stone',
    postCol: 0x2e2724, lintelCol: 0x4a3a30, gateMix: 0.35
  },
  frost: {
    postGeoName: 'archPost_frost', lintelGeoName: 'archLintel_frost', matName: 'ice',
    postCol: 0xbfe2ff, lintelCol: 0xd8efff, gateMix: 0.10
  },
  grim: {
    postGeoName: 'archPost_grim', lintelGeoName: 'archLintel_grim', matName: 'stone',
    postCol: 0x2f342c, lintelCol: 0x3d4438, gateMix: 0.30
  },
  verdant: {
    postGeoName: 'archPost_verdant', lintelGeoName: 'archLintel_verdant', matName: 'bark',
    postCol: 0x5c4a34, lintelCol: 0x4f6b38, gateMix: 0.25
  },
  /* open terrain — waymarked thresholds, tinted to each biome's ground */
  forest: {
    postGeoName: 'archPost_overland', lintelGeoName: 'archLintel_overland', matName: 'bark',
    postCol: 0x6a6558, lintelCol: 0x6b4a2f, gateMix: 0.22
  },
  moor: {
    postGeoName: 'archPost_overland', lintelGeoName: 'archLintel_overland', matName: 'stone',
    postCol: 0x74705f, lintelCol: 0x5e5442, gateMix: 0.22
  },
  mire: {
    postGeoName: 'archPost_overland', lintelGeoName: 'archLintel_overland', matName: 'bark',
    postCol: 0x4a4638, lintelCol: 0x3e3a31, gateMix: 0.28
  },
  holdfast: {
    postGeoName: 'archPost_overland', lintelGeoName: 'archLintel_overland', matName: 'stone',
    postCol: 0x8a8270, lintelCol: 0x7a6a52, gateMix: 0.20
  },
  boneyard: {
    postGeoName: 'archPost_overland', lintelGeoName: 'archLintel_overland', matName: 'stone',
    postCol: 0x6d7266, lintelCol: 0x5a6054, gateMix: 0.26
  },
  ruinfield: {
    postGeoName: 'archPost_overland', lintelGeoName: 'archLintel_overland', matName: 'stone',
    postCol: 0x968d78, lintelCol: 0x7d7461, gateMix: 0.22
  },
  ashfield: {
    postGeoName: 'archPost_overland', lintelGeoName: 'archLintel_overland', matName: 'stone',
    postCol: 0x3a3330, lintelCol: 0x2a2422, gateMix: 0.34
  },
  snowfield: {
    postGeoName: 'archPost_overland', lintelGeoName: 'archLintel_overland', matName: 'ice',
    postCol: 0xc8dcec, lintelCol: 0x9fb4c4, gateMix: 0.12
  },
  sporewood: {
    postGeoName: 'archPost_overland', lintelGeoName: 'archLintel_overland', matName: 'bark',
    postCol: 0x5e4e68, lintelCol: 0x4a5a3c, gateMix: 0.26
  }
};

/* ---------------- name generator ---------------- */
export function dungeonName(rng, th) {
  const C = ['Mal', 'Vor', 'Ash', 'Ker', 'Ul', 'Dra', 'Noth', 'Zar', 'Bel', 'Mor', 'Gol', 'Ith'];
  const D = ['goth', 'ath', 'ruk', 'esh', 'mir', 'gul', 'dan', 'oth', 'ek', 'ash', 'uzek', 'arim'];
  return 'The ' + rng.pick(th.nameA) + ' ' + rng.pick(th.nameB) + ' of ' + rng.pick(C) + '\u2019' + rng.pick(D);
}

/* ---------------- Delaunay (Bowyer–Watson) ---------------- */
export function delaunay(pts) {
  const n = pts.length;
  if (n < 2) return [];
  let minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y;
  for (let i = 1; i < n; i++) {
    minX = Math.min(minX, pts[i].x); maxX = Math.max(maxX, pts[i].x);
    minY = Math.min(minY, pts[i].y); maxY = Math.max(maxY, pts[i].y);
  }
  const dx = maxX - minX, dy = maxY - minY, delta = Math.max(dx, dy) * 10;
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const p0 = { x: midX - delta, y: midY - delta, id: -1 };
  const p1 = { x: midX + delta, y: midY - delta, id: -2 };
  const p2 = { x: midX, y: midY + delta, id: -3 };
  const P = pts.map((p, i) => ({ x: p.x, y: p.y, id: i })).concat([p0, p1, p2]);

  let tris = [{ a: n, b: n + 1, c: n + 2 }];
  const inCirc = (p, t) => {
    const A = P[t.a], B = P[t.b], C = P[t.c];
    const D = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
    if (Math.abs(D) < 1e-9) return false;
    const ux = ((A.x * A.x + A.y * A.y) * (B.y - C.y) + (B.x * B.x + B.y * B.y) * (C.y - A.y) + (C.x * C.x + C.y * C.y) * (A.y - B.y)) / D;
    const uy = ((A.x * A.x + A.y * A.y) * (C.x - B.x) + (B.x * B.x + B.y * B.y) * (A.x - C.x) + (C.x * C.x + C.y * C.y) * (B.x - A.x)) / D;
    const r2 = (A.x - ux) * (A.x - ux) + (A.y - uy) * (A.y - uy);
    return (p.x - ux) * (p.x - ux) + (p.y - uy) * (p.y - uy) <= r2 + 1e-7;
  };

  for (let i = 0; i < n; i++) {
    const pt = P[i];
    const bad = [];
    for (const t of tris) if (inCirc(pt, t)) bad.push(t);
    const poly = [];
    for (const t of bad) {
      const edges = [[t.a, t.b], [t.b, t.c], [t.c, t.a]];
      for (const e of edges) {
        let shared = false;
        for (const ot of bad) {
          if (ot === t) continue;
          if ((ot.a === e[0] || ot.b === e[0] || ot.c === e[0]) && (ot.a === e[1] || ot.b === e[1] || ot.c === e[1])) { shared = true; break; }
        }
        if (!shared) poly.push(e);
      }
    }
    tris = tris.filter(t => !bad.includes(t));
    for (const e of poly) tris.push({ a: e[0], b: e[1], c: i });
  }
  const em = new Set();
  const out = [];
  for (const t of tris) {
    if (t.a < n && t.b < n && t.c < n) {
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
        const k = Math.min(u, v) + ',' + Math.max(u, v);
        if (!em.has(k)) { em.add(k); out.push([Math.min(u, v), Math.max(u, v)]); }
      }
    }
  }
  return out;
}

/* ---------------- MAIN GENERATOR ENTRY POINT ---------------- */
export function generateDungeon(a, b) {
  let seed, params;
  if (typeof a === 'object' && a !== null) {
    params = a;
    seed = (params.seed !== undefined ? params.seed : 0) >>> 0;
  } else {
    seed = (a !== undefined ? a : 0) >>> 0;
    params = (typeof b === 'object' && b !== null) ? b : {};
  }
  const p = Object.assign({
    seed: seed,
    roomCount: 16,
    loopChance: 0.18,
    decorDensity: 1.0,
    themeKey: 'ancient',
    threatMult: 1.0
  }, params);
  if (params.theme && !params.themeKey) p.themeKey = params.theme;
  p.seed = seed;

  const TH = THEMES[p.themeKey] || THEMES.ancient;
  if (TH.overland) {
    return generateOverland(p);
  }
  const t0 = performance.now();
  let attempt = 0, curSeed = seed, d = null;
  while (attempt < 5) {
    d = tryGenerate(curSeed, p);
    if (d && d.valid) break;
    curSeed = (Math.imul(curSeed, 9301) + 49297) >>> 0; attempt++;
  }
  if (d) {
    d.stats.genMs = performance.now() - t0;
    d.stats.attempts = attempt + 1;
  }
  return d;
}

function tryGenerate(seed, params) {
  const rng = makeRng(seed);
  const N = Math.max(4, Math.min(80, params.roomCount || 16));
  const TH = THEMES[params.themeKey] || THEMES.ancient;
  const thKey = params.themeKey || 'ancient';

  /* -- 1. scatter -- */
  const R = Math.sqrt(N) * 6.5;
  const rooms = [];
  const large = [];
  for (let i = 0; i < N; i++) {
    const t = rng.raw();
    let w, h, arch;
    if (t < 0.45) { arch = 's'; w = rng.i(9, 11); h = rng.i(9, 11); }
    else if (t < 0.85) { arch = 'm'; w = rng.i(12, 15); h = rng.i(12, 15); }
    else { arch = 'l'; w = rng.i(16, 22); h = rng.i(16, 22); large.push(i); }
    const st = rng.raw();
    const shape = st < 0.60 ? 'rect' : (st < 0.82 ? 'ellipse' : 'oct');
    const ang = rng.f(0, Math.PI * 2), rad = R * Math.sqrt(rng.raw());
    rooms.push({
      id: i, cx: Math.cos(ang) * rad, cy: Math.sin(ang) * rad, w, h, arch, shape,
      sx0: Math.cos(ang) * rad, sy0: Math.sin(ang) * rad,
      type: TYPE.COMBAT, depth: 0, difficulty: 0.2, degree: 0
    });
  }
  while (large.length < 2) {
    const j = rng.i(0, N - 1);
    if (rooms[j].arch !== 'l') { rooms[j].arch = 'l'; rooms[j].w = rng.i(16, 22); rooms[j].h = rng.i(16, 22); rooms[j].shape = 'rect'; large.push(j); }
  }

  /* -- 2. separate -- */
  const PAD = 2;
  {
    const CX = new Float64Array(N), CY = new Float64Array(N), HW = new Float64Array(N), HH = new Float64Array(N);
    for (let i = 0; i < N; i++) { CX[i] = rooms[i].cx; CY[i] = rooms[i].cy; HW[i] = rooms[i].w / 2 + PAD / 2; HH[i] = rooms[i].h / 2 + PAD / 2; }
    for (let iter = 0; iter < 300; iter++) {
      let moved = false;
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const ox = HW[i] + HW[j] - Math.abs(CX[i] - CX[j]);
        if (ox <= 0) continue;
        const oy = HH[i] + HH[j] - Math.abs(CY[i] - CY[j]);
        if (oy <= 0) continue;
        moved = true;
        if (ox < oy) { const s = CX[i] <= CX[j] ? -1 : 1; CX[i] += s * ox / 2; CX[j] -= s * ox / 2; }
        else { const s = CY[i] <= CY[j] ? -1 : 1; CY[i] += s * oy / 2; CY[j] -= s * oy / 2; }
      }
      if (!moved) break;
    }
    for (let i = 0; i < N; i++) { rooms[i].cx = Math.round(CX[i]); rooms[i].cy = Math.round(CY[i]); }
  }

  /* -- 3. graph: Delaunay -> MST -> loops -- */
  const centers = rooms.map(r => ({ x: r.cx, y: r.cy }));
  let delEdges = delaunay(centers);
  if (delEdges.length === 0) { delEdges = []; for (let i = 0; i < N - 1; i++) delEdges.push([i, i + 1]); }
  const elen = e => Math.hypot(centers[e[0]].x - centers[e[1]].x, centers[e[0]].y - centers[e[1]].y);

  const adj = Array.from({ length: N }, () => []);
  delEdges.forEach((e, idx) => { const w = elen(e); adj[e[0]].push({ b: e[1], w, idx }); adj[e[1]].push({ b: e[0], w, idx }); });
  const inT = new Uint8Array(N); inT[0] = 1; let inCount = 1;
  const mstIdx = new Set();
  while (inCount < N) {
    let best = null;
    for (let a = 0; a < N; a++) if (inT[a]) for (const e of adj[a]) if (!inT[e.b] && (!best || e.w < best.w)) best = e;
    if (!best) break;
    inT[best.b] = 1; inCount++; mstIdx.add(best.idx);
  }
  if (inCount < N) return { valid: false, stats: {} };

  let mstLenSum = 0; for (const i of mstIdx) mstLenSum += elen(delEdges[i]);
  const mstMean = mstLenSum / Math.max(1, mstIdx.size);

  const edges = [];
  delEdges.forEach((e, idx) => {
    if (mstIdx.has(idx)) edges.push({ a: e[0], b: e[1], isLoop: false, isCritical: false });
    else if (elen(e) < mstMean * 2.2 && rng.chance(params.loopChance))
      edges.push({ a: e[0], b: e[1], isLoop: true, isCritical: false });
  });
  for (const e of edges) { rooms[e.a].degree++; rooms[e.b].degree++; }

  /* leaf guard */
  if (N >= 20) {
    let leafCount = 0;
    for (let i = 0; i < N; i++) if (rooms[i].degree === 1) leafCount++;
    while (leafCount < 3) {
      let bi = -1, bs = -1;
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]; if (!e.isLoop) continue;
        const s = (rooms[e.a].degree === 2 ? 1 : 0) + (rooms[e.b].degree === 2 ? 1 : 0);
        const L = Math.hypot(centers[e.a].x - centers[e.b].x, centers[e.a].y - centers[e.b].y);
        const score = s * 10000 + L;
        if (score > bs) { bs = score; bi = i; }
      }
      if (bi < 0) break;
      const e = edges[bi];
      if (--rooms[e.a].degree === 1) leafCount++;
      if (--rooms[e.b].degree === 1) leafCount++;
      edges.splice(bi, 1);
    }
  }

  /* -- 4. semantics before carving -- */
  const gAdj = Array.from({ length: N }, () => []);
  edges.forEach((e, i) => { gAdj[e.a].push({ b: e.b, i }); gAdj[e.b].push({ b: e.a, i }); });

  let boss = 0; for (let i = 1; i < N; i++) if (rooms[i].w * rooms[i].h > rooms[boss].w * rooms[boss].h) boss = i;

  const distFrom = src => {
    const D = new Int32Array(N).fill(-1); D[src] = 0; const q = [src];
    for (let h = 0; h < q.length; h++) { const a = q[h]; for (const e of gAdj[a]) if (D[e.b] < 0) { D[e.b] = D[a] + 1; q.push(e.b); } }
    return D;
  };
  const dB = distFrom(boss);
  let entrance = -1, bestD = -1;
  for (let i = 0; i < N; i++) if (i !== boss && rooms[i].degree === 1 && dB[i] > bestD) { bestD = dB[i]; entrance = i; }
  if (entrance < 0) { for (let i = 0; i < N; i++) if (i !== boss && dB[i] > bestD) { bestD = dB[i]; entrance = i; } }

  const dE = distFrom(entrance);
  let maxDepth = 1; for (let i = 0; i < N; i++) if (dE[i] > maxDepth) maxDepth = dE[i];
  rooms.forEach((r, i) => { r.depth = Math.max(0, dE[i]); r.difficulty = Math.min(1, 0.15 + 0.85 * (r.depth / maxDepth)); });
  rooms[entrance].type = TYPE.ENTRANCE; rooms[entrance].difficulty = 0;
  rooms[boss].type = TYPE.BOSS; rooms[boss].difficulty = 1;
  /* Dark rooms (docs/LIGHT_IDEAS.md 44): about one ordinary room in five is
     unlit — its sconces start dark (below) — and holds tougher monsters
     (difficulty feeds the spawn budget) and richer chests (chest_loot.js).
     Own RNG stream, so the rest of the layout doesn't reshuffle. */
  {
    const darkRng = makeRng((seed ^ 0xda4c0001) >>> 0);
    rooms.forEach((r, i) => {
      if (i === entrance || i === boss) return;
      if (darkRng.f(0, 1) < 0.2) { r.dark = true; r.difficulty = Math.min(1, r.difficulty + 0.25); }
    });
  }

  const par = new Int32Array(N).fill(-1), pe = new Int32Array(N).fill(-1);
  {
    const q = [entrance], vis = new Uint8Array(N); vis[entrance] = 1;
    for (let h = 0; h < q.length; h++) {
      const a = q[h];
      for (const e of gAdj[a]) if (!vis[e.b]) { vis[e.b] = 1; par[e.b] = a; pe[e.b] = e.i; q.push(e.b); }
    }
  }
  const critRooms = new Set(); let critLen = 0;
  for (let c = boss; c !== -1; c = par[c]) { critRooms.add(c); if (pe[c] >= 0) { edges[pe[c]].isCritical = true; critLen++; } if (c === entrance) break; }

  const leaves = [];
  for (let i = 0; i < N; i++) if (i !== entrance && i !== boss && rooms[i].degree === 1) leaves.push(i);
  leaves.sort((a, b) => rooms[b].depth - rooms[a].depth);
  leaves.slice(0, 4).forEach(i => { rooms[i].type = TYPE.TREASURE; });

  const shrineC = [];
  for (let i = 0; i < N; i++) {
    const r = rooms[i];
    if (r.type === TYPE.COMBAT && !critRooms.has(i) && r.depth > maxDepth * 0.3 && r.depth < maxDepth * 0.85) shrineC.push(i);
  }
  for (let k = 0; k < 2 && shrineC.length > 0; k++) {
    const j = shrineC.splice(rng.i(0, shrineC.length - 1), 1)[0]; rooms[j].type = TYPE.SHRINE;
  }
  const eliteC = [];
  for (const i of critRooms) {
    const r = rooms[i];
    if (r.type === TYPE.COMBAT && r.depth >= maxDepth * 0.55 && r.depth <= maxDepth * 0.85) eliteC.push(i);
  }
  eliteC.sort((a, b) => rooms[a].depth - rooms[b].depth);
  for (let k = 0; k < Math.min(2, eliteC.length); k++) rooms[eliteC[eliteC.length - 1 - k]].type = TYPE.ELITE;

  /* -- 4.4b rival room assignment (strictly 1 per floor when requested) -- */
  if (params && params.hasRivalRoom) {
    const rivalC = [];
    for (let i = 0; i < N; i++) {
      const r = rooms[i];
      if (r.type === TYPE.COMBAT && i !== entrance && i !== boss && Math.min(r.w, r.h) >= 7) {
        rivalC.push(i);
      }
    }
    if (rivalC.length > 0) {
      rivalC.sort((a, b) => Math.abs(rooms[a].depth - maxDepth * 0.5) - Math.abs(rooms[b].depth - maxDepth * 0.5));
      const chosen = rivalC[0];
      rooms[chosen].type = TYPE.RIVAL;
      rooms[chosen].rival = true;
    }
  }

  /* -- 4.5 theme room mutations -- */
  if (TH.lakes) {
    const lc = [];
    for (let i = 0; i < N; i++) {
      const r = rooms[i];
      if ((r.type === TYPE.COMBAT || r.type === TYPE.ELITE) && Math.min(r.w, r.h) >= 9) lc.push(i);
    }
    for (let k = 0; k < 2 && lc.length > 0; k++) rooms[lc.splice(rng.i(0, lc.length - 1), 1)[0]].lake = true;
  }
  if (TH.graveyards) {
    const gc = [];
    for (let i = 0; i < N; i++) {
      const r = rooms[i];
      if (r.type === TYPE.COMBAT && r.shape !== 'ellipse' && Math.min(r.w, r.h) >= 8) gc.push(i);
    }
    for (let k = 0; k < 3 && gc.length > 0; k++) rooms[gc.splice(rng.i(0, gc.length - 1), 1)[0]].grave = true;
  }

  /* -- 4.6 room style assignment (~12% chance per combat/elite room) -- */
  const activeThemeKey = thKey || 'ancient';
  for (let i = 0; i < N; i++) {
    const r = rooms[i];
    if ((r.type === TYPE.COMBAT || r.type === TYPE.ELITE) && rng.chance(0.12)) {
      const validStyles = Object.values(ROOM_STYLES).filter(s => isRoomStyleEnabled ? isRoomStyleEnabled(s.id, activeThemeKey) : (!s.themes || s.themes.includes(activeThemeKey)));
      if (validStyles.length > 0) {
        const style = rng.pick(validStyles);
        r.roomStyle = style.id;
        r.banner = { title: style.title, subtitle: style.subtitle, style: style.id };
      }
    }
  }

  /* -- 5. carve + rasterize -- */
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const r of rooms) {
    minX = Math.min(minX, r.cx - Math.ceil(r.w / 2)); maxX = Math.max(maxX, r.cx + Math.ceil(r.w / 2));
    minY = Math.min(minY, r.cy - Math.ceil(r.h / 2)); maxY = Math.max(maxY, r.cy + Math.ceil(r.h / 2));
  }
  const PADG = 5, offX = PADG - minX, offY = PADG - minY;
  const W = (maxX - minX) + PADG * 2 + 1, H = (maxY - minY) + PADG * 2 + 1;
  for (const r of rooms) { r.cx += offX; r.cy += offY; r.sx0 += offX; r.sy0 += offY; }

  const grid = new Uint8Array(W * H);
  const roomId = new Int16Array(W * H).fill(-1);
  const corridor = new Uint8Array(W * H);
  const idx = (x, y) => y * W + x;
  const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const magmaBridgeProps = [];

  for (const r of rooms) {
    const rx = r.w / 2, ry = r.h / 2, sh = r.shape, ch = Math.min(rx, ry) * 0.55;
    const irx2 = 1 / (rx * rx), iry2 = 1 / (ry * ry);
    const y0 = Math.max(0, Math.floor(r.cy - ry)), y1 = Math.min(H - 1, Math.ceil(r.cy + ry));
    const x0 = Math.max(0, Math.floor(r.cx - rx)), x1 = Math.min(W - 1, Math.ceil(r.cx + rx));
    for (let y = y0; y <= y1; y++) {
      const dy = y - r.cy, ady = Math.abs(dy), row = y * W;
      if (ady > ry) continue;
      for (let x = x0; x <= x1; x++) {
        const dx = x - r.cx, adx = Math.abs(dx);
        if (adx > rx) continue;
        let ok = true;
        if (sh === 'ellipse') ok = dx * dx * irx2 + dy * dy * iry2 <= 1.0;
        else if (sh === 'oct') ok = adx <= rx - ch || ady <= ry - ch || (adx - (rx - ch)) + (ady - (ry - ch)) <= ch;
        if (ok) { const c = row + x; grid[c] = FLOOR; roomId[c] = r.id; }
      }
    }
  }

  const stamp = (x, y) => { if (inB(x, y) && grid[idx(x, y)] !== FLOOR) { grid[idx(x, y)] = FLOOR; corridor[idx(x, y)] = 1; } };
  const offs = w => w === 1 ? [0] : (w === 2 ? [0, 1] : [-1, 0, 1]);
  const hLine = (x0, x1, y, w) => { const o = offs(w); for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (const k of o) stamp(x, y + k); };
  const vLine = (y0, y1, x, w) => { const o = offs(w); for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (const k of o) stamp(x + k, y); };

  for (const e of edges) {
    const A = rooms[e.a], B = rooms[e.b];
    let w = e.isCritical ? 3 : 2;
    const dx = Math.abs(A.cx - B.cx), dy = Math.abs(A.cy - B.cy);
    const ovX = Math.min(A.cx + A.w / 2, B.cx + B.w / 2) - Math.max(A.cx - A.w / 2, B.cx - B.w / 2);
    const ovY = Math.min(A.cy + A.h / 2, B.cy + B.h / 2) - Math.max(A.cy - A.h / 2, B.cy - B.h / 2);
    if (ovX >= w + 2 && dy > 0) { const x = Math.round((Math.max(A.cx - A.w / 2, B.cx - B.w / 2) + Math.min(A.cx + A.w / 2, B.cx + B.w / 2)) / 2); vLine(A.cy, B.cy, x, w); }
    else if (ovY >= w + 2 && dx > 0) { const y = Math.round((Math.max(A.cy - A.h / 2, B.cy - B.h / 2) + Math.min(A.cy + A.h / 2, B.cy + B.h / 2)) / 2); hLine(A.cx, B.cx, y, w); }
    else if (rng.chance(0.5)) { hLine(A.cx, B.cx, A.cy, w); vLine(A.cy, B.cy, B.cx, w); }
    else { vLine(A.cy, B.cy, A.cx, w); hLine(A.cx, B.cx, B.cy, w); }
  }

  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (grid[row + x] !== FLOOR) continue;
      const ya = Math.max(0, y - 1), yb = Math.min(H - 1, y + 1);
      const xa = Math.max(0, x - 1), xb = Math.min(W - 1, x + 1);
      for (let ny = ya; ny <= yb; ny++) {
        const nrow = ny * W;
        for (let nx = xa; nx <= xb; nx++) {
          const ni = nrow + nx;
          if (grid[ni] === VOID) grid[ni] = WALL;
        }
      }
    }
  }

  const doorway = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const c = row + x;
      if (!corridor[c]) continue;
      if ((x < W - 1 && roomId[c + 1] >= 0) || (x > 0 && roomId[c - 1] >= 0) ||
        (y < H - 1 && roomId[c + W] >= 0) || (y > 0 && roomId[c - W] >= 0)) doorway[c] = 1;
    }
  }

  widenNarrowDoorways(grid, W, H, corridor, doorway, roomId);

  /* liquid pockets */
  const pools = [];
  if (TH.pools && TH.pools.amount > 0) {
    const nearDoorC = (x, y, d) => {
      for (let oy = -d; oy <= d; oy++) for (let ox = -d; ox <= d; ox++) {
        const nx = x + ox, ny = y + oy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && doorway[idx(nx, ny)]) return true;
      } return false;
    };
    const cand = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const c = idx(x, y);
      if (grid[c] !== WALL || nearDoorC(x, y, 2)) continue;
      let nf = 0;
      if (grid[c + 1] === FLOOR) nf++; if (grid[c - 1] === FLOOR) nf++;
      if (grid[c + W] === FLOOR) nf++; if (grid[c - W] === FLOOR) nf++;
      if (nf === 1) cand.push({ x, y });
    }
    for (let i = cand.length - 1; i > 0; i--) { const j = rng.i(0, i); const t = cand[i]; cand[i] = cand[j]; cand[j] = t; }
    const target = Math.round(cand.length * TH.pools.amount);
    /* Each seed grows into a multi-tile body rather than staying a lone tile.
       Growth is confined to WALL cells away from doorways, so it eats rock the
       party could never walk on anyway — no connectivity risk, and the result
       reads as a pool or lava flow seeping along the room edge. */
    const [bodyMin, bodyMax] = TH.pools.body || [2, 5];
    const canFlood = c => {
      if (grid[c] !== WALL || doorway[c]) return false;
      const x = c % W, y = (c - x) / W;
      return !nearDoorC(x, y, 2);
    };
    for (const s of cand) {
      if (pools.length >= target) break;
      let close = false;
      for (const p of pools) if (Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) < 3) { close = true; break; }
      if (close) continue;
      const seed = idx(s.x, s.y);
      const body = growLiquidBody(W, H, seed, rng.i(bodyMin, bodyMax), canFlood, rng);
      /* A seed wedged in a one-cell alcove can't grow. Skip it rather than
         leaving behind the lone tile this whole system exists to replace. */
      if (body.length < 2) continue;
      for (const c of body) {
        grid[c] = POOL;
        pools.push({ x: c % W, y: (c - (c % W)) / W });
      }
    }
    for (const p of pools)
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const nx = p.x + ox, ny = p.y + oy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && grid[idx(nx, ny)] === VOID) grid[idx(nx, ny)] = WALL;
      }
  }

  if (TH.pools && TH.pools.pits) {
    /* Room pits DO consume walkable floor, so every candidate body is checked
       against a flood fill from the entrance before it is committed — a lava
       flow must never sever the route to the stairs or fence off a corner. */
    const refCell = idx(rooms[entrance].cx, rooms[entrance].cy);
    const pitReach = reachableFloorMask(grid, W, H, refCell);
    const [pitMin, pitMax] = TH.pools.pitBody || [2, 4];

    /* Chasm/water crossings: a channel cut across one room, spanned by a
       bridge. Molten gets an iron bridge over lava, verdant a timber
       footbridge over water — identical layout, different construction. */
    const BRIDGE_KIT = {
      molten: { deck: 'magmaBridge', rail: 'bridgeRailing' },
      verdant: { deck: 'woodBridge', rail: 'woodRailing' }
    };
    if (BRIDGE_KIT[thKey]) {
      const kit = BRIDGE_KIT[thKey];
      const bridgeCandidates = rooms.filter(r => (r.type === TYPE.COMBAT || r.type === TYPE.ELITE) && !r.lake && r.w >= 8 && r.h >= 8);
      if (bridgeCandidates.length > 0) {
        /* Try candidates in turn rather than betting the floor on one room.
           A single rng.pick lost the bridge entirely whenever that room's
           channel failed the connectivity check — about a quarter of floors.
           Big dungeons can carry a second crossing. */
        const order = bridgeCandidates.slice();
        for (let i = order.length - 1; i > 0; i--) {
          const j = rng.i(0, i); const t = order[i]; order[i] = order[j]; order[j] = t;
        }
        /* One crossing per floor, and sometimes a second once the floor is
           big enough to hide it — always two read as a motif rather than a
           feature. */
        const maxBridges = (rooms.length >= 28 && rng.chance(0.45)) ? 2 : 1;
        let built = 0;
        for (const r of order) {
          if (built >= maxBridges) break;
          const body = [];
          const isVertRiver = r.w >= r.h;
          const bridgeTiles = [];

          if (isVertRiver) {
            const rx = r.cx;
            const bridgeY0 = r.cy - 1, bridgeY1 = r.cy + 1;
            const yMin = Math.floor(r.cy - r.h / 2) + 1, yMax = Math.ceil(r.cy + r.h / 2) - 1;
            for (let y = yMin; y <= yMax; y++) {
              if (y >= bridgeY0 && y <= bridgeY1) {
                for (let ox = -1; ox <= 1; ox++) {
                  const x = rx + ox;
                  if (inB(x, y) && grid[idx(x, y)] === FLOOR && roomId[idx(x, y)] === r.id) {
                    bridgeTiles.push({ x, y, rot: 0 });
                  }
                }
                continue;
              }
              for (let ox = -1; ox <= 1; ox++) {
                const x = rx + ox;
                if (!inB(x, y)) continue;
                const c = idx(x, y);
                if (grid[c] === FLOOR && roomId[c] === r.id && !doorway[c]) {
                  body.push(c);
                }
              }
            }
          } else {
            const ry = r.cy;
            const bridgeX0 = r.cx - 1, bridgeX1 = r.cx + 1;
            const xMin = Math.floor(r.cx - r.w / 2) + 1, xMax = Math.ceil(r.cx + r.w / 2) - 1;
            for (let x = xMin; x <= xMax; x++) {
              if (x >= bridgeX0 && x <= bridgeX1) {
                for (let oy = -1; oy <= 1; oy++) {
                  const y = ry + oy;
                  if (inB(x, y) && grid[idx(x, y)] === FLOOR && roomId[idx(x, y)] === r.id) {
                    bridgeTiles.push({ x, y, rot: Math.PI / 2 });
                  }
                }
                continue;
              }
              for (let oy = -1; oy <= 1; oy++) {
                const y = ry + oy;
                if (!inB(x, y)) continue;
                const c = idx(x, y);
                if (grid[c] === FLOOR && roomId[c] === r.id && !doorway[c]) {
                  body.push(c);
                }
              }
            }
          }

          if (body.length >= 4 && floorStaysConnected(grid, W, H, body, refCell, pitReach)) {
            for (const bc of body) {
              grid[bc] = POOL;
              pitReach[bc] = 0;
              pools.push({ x: bc % W, y: (bc - (bc % W)) / W });
            }
            built++;
            for (const bt of bridgeTiles) {
              magmaBridgeProps.push({ kind: kit.deck, x: bt.x, y: bt.y, rot: bt.rot, scale: 1, roomId: r.id });
            }
            /* Railings run along the two OUTER edges of the deck, never through
               it. The deck is three tiles wide, so baking a railing into the tile
               geometry fenced off the middle of the crossing; instead each tile
               asks whether it actually has a neighbour on the side in question,
               and only the tiles that do not get a rail there.
               Sides are taken perpendicular to travel — the ends of the bridge
               are where you walk on, and must stay open. */
            const bridgeSet = new Set(bridgeTiles.map(t => t.y * W + t.x));
            for (const bt of bridgeTiles) {
              /* isVertRiver: the channel runs along Y and you cross along X, so
                 the open sides are ±Y. Otherwise the reverse. */
              const sides = isVertRiver ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
              for (const [sx, sy] of sides) {
                if (bridgeSet.has((bt.y + sy) * W + (bt.x + sx))) continue;
                magmaBridgeProps.push({
                  kind: kit.rail, x: bt.x, y: bt.y,
                  ox: sx * 0.46, oz: sy * 0.46,
                  /* the railing model runs along X, so turn it a quarter when it
                     guards an X-facing edge */
                  rot: sx ? Math.PI / 2 : 0,
                  scale: 1, roomId: r.id
                });
              }
            }
          }
        }
      }
    }

    for (const r of rooms) {
      if ((r.type !== TYPE.COMBAT && r.type !== TYPE.ELITE) || r.lake || r.grave) continue;
      let n = Math.min(TH.pools.pits, Math.floor(r.w * r.h / 45) + 1), guard = 0;
      /* stay inside this room, off doorways, and never touch a wall — the body
         has to float in open floor with a walkable rim all the way around */
      const canFlood = c => {
        if (grid[c] !== FLOOR || roomId[c] !== r.id || doorway[c]) return false;
        const x = c % W, y = (c - x) / W;
        if (!inB(x, y)) return false;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const nc = idx(x + ox, y + oy);
          if (grid[nc] !== FLOOR && grid[nc] !== POOL) return false;
        }
        return true;
      };
      while (n > 0 && guard++ < 40) {
        const x = rng.i(Math.floor(r.cx - r.w / 2) + 2, Math.ceil(r.cx + r.w / 2) - 2);
        const y = rng.i(Math.floor(r.cy - r.h / 2) + 2, Math.ceil(r.cy + r.h / 2) - 2);
        if (!inB(x, y)) continue;
        const c = idx(x, y);
        if (!canFlood(c)) continue;
        let ok = true;
        for (const p of pools) if (Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) < 4) { ok = false; break; }
        if (!ok) continue;

        const body = growLiquidBody(W, H, c, rng.i(pitMin, pitMax), canFlood, rng);
        if (!floorStaysConnected(grid, W, H, body, refCell, pitReach)) continue;
        for (const bc of body) {
          grid[bc] = POOL;
          pitReach[bc] = 0;
          pools.push({ x: bc % W, y: (bc - (bc % W)) / W });
        }
        n--;
      }
    }
  }

  const lakeMask = new Uint8Array(W * H);
  const lakeCells = [];
  for (const r of rooms) {
    if (!r.lake) continue;
    for (let y = Math.floor(r.cy - r.h / 2) + 2; y <= Math.ceil(r.cy + r.h / 2) - 2; y++)
      for (let x = Math.floor(r.cx - r.w / 2) + 2; x <= Math.ceil(r.cx + r.w / 2) - 2; x++) {
        if (!inB(x, y)) continue;
        const c = idx(x, y);
        if (roomId[c] !== r.id || grid[c] !== FLOOR || doorway[c]) continue;
        let solid = false;
        for (let oy = -1; oy <= 1 && !solid; oy++) for (let ox = -1; ox <= 1; ox++)
          if (grid[idx(x + ox, y + oy)] !== FLOOR) { solid = true; break; }
        if (!solid) { lakeMask[c] = 1; lakeCells.push({ x, y }); }
      }
  }

  const arches = [];
  {
    const usedCells = new Uint8Array(W * H);

    const getRoomAnchor = (r) => {
      let c = idx(r.cx, r.cy);
      if (grid[c] === FLOOR) return c;
      for (let rad = 1; rad < 8; rad++) {
        for (let oy = -rad; oy <= rad; oy++) {
          for (let ox = -rad; ox <= rad; ox++) {
            const nx = r.cx + ox, ny = r.cy + oy;
            if (inB(nx, ny) && grid[idx(nx, ny)] === FLOOR) return idx(nx, ny);
          }
        }
      }
      return c;
    };

    // BFS helper to trace the exact floor path between two room anchors
    const findEdgePath = (roomA, roomB) => {
      const start = getRoomAnchor(roomA);
      const target = getRoomAnchor(roomB);
      if (start === target || start < 0 || target < 0) return [];
      const q = [start];
      const prev = new Int32Array(W * H).fill(-1);
      const visited = new Uint8Array(W * H);
      visited[start] = 1;
      let qhead = 0;
      let found = false;
      while (qhead < q.length) {
        const curr = q[qhead++];
        if (curr === target) { found = true; break; }
        const cx = curr % W, cy = (curr / W) | 0;
        const nbrs = [
          cy > 0 ? curr - W : -1,
          cy < H - 1 ? curr + W : -1,
          cx > 0 ? curr - 1 : -1,
          cx < W - 1 ? curr + 1 : -1
        ];
        for (const n of nbrs) {
          if (n >= 0 && grid[n] === FLOOR && !visited[n]) {
            visited[n] = 1;
            prev[n] = curr;
            q.push(n);
          }
        }
      }
      if (!found) return [];
      const path = [];
      let c = target;
      while (c !== -1) {
        path.push(c);
        c = prev[c];
      }
      path.reverse();
      return path;
    };

    /* `len` is the rendered gate width and is capped at 4, but `cells` used to
       list EVERY floor cell of the opening — on a wide hall that meant a
       4-wide gate whose cellToArch footprint was 20+ cells. The door then
       blocked a swath of open floor with nothing drawn across it (invisible
       wall), and neighbouring arches fought over the same cells. Keep the
       cell run centred on the gate and the same width as the gate. */
    const archSpanCells = (lo, hi, center, len, make) => {
      let start = Math.round(center - (len - 1) / 2);
      start = Math.max(lo, Math.min(start, hi - len + 1));
      const cells = [];
      for (let i = start; i <= Math.min(hi, start + len - 1); i++) cells.push(make(i));
      return cells;
    };

    /* A gate is only a gate if it seals the opening it stands in. Openings
       wider than this aren't doorways, they're halls — placing a door there
       gave a 4-wide gate across a 20-wide gap, so the "closed" door blocked
       cells with nothing drawn over them. Those candidates are now rejected
       and the caller moves on to the next cell along the path. */
    const MAX_ARCH_SPAN = 4;

    const fitArchToOpening = (x, y, preferredPx) => {
      const isFloor = (cx, cy) => cx >= 0 && cy >= 0 && cx < W && cy < H && grid[idx(cx, cy)] === FLOOR;

      if (preferredPx === 1) {
        // Arch spans across X between left solid boundary (xl) and right solid boundary (xr)
        let xl = x; while (isFloor(xl, y)) xl--;
        let xr = x; while (isFloor(xr, y)) xr++;
        const gap = Math.max(1, xr - xl - 1);
        if (gap > MAX_ARCH_SPAN) return null;
        const len = Math.min(MAX_ARCH_SPAN, gap);
        const centerX = xl + (xr - xl) / 2;
        const cells = archSpanCells(
          Math.max(0, xl + 1), Math.min(W - 1, xr - 1), centerX, len, ix => idx(ix, y));
        return { x: centerX, y, px: 1, py: 0, len, cells };
      } else {
        // Arch spans across Y/Z between top solid boundary (yt) and bottom solid boundary (yb)
        let yt = y; while (isFloor(x, yt)) yt--;
        let yb = y; while (isFloor(x, yb)) yb++;
        const gap = Math.max(1, yb - yt - 1);
        if (gap > MAX_ARCH_SPAN) return null;
        const len = Math.min(MAX_ARCH_SPAN, gap);
        const centerY = yt + (yb - yt) / 2;
        const cells = archSpanCells(
          Math.max(0, yt + 1), Math.min(H - 1, yb - 1), centerY, len, iy => idx(x, iy));
        return { x, y: centerY, px: 0, py: 1, len, cells };
      }
    };

    for (const e of edges) {
      const roomA = rooms[e.a], roomB = rooms[e.b];
      const path = findEdgePath(roomA, roomB);
      if (!path || path.length < 2) continue;

      let bestArch = null;
      let bestScore = -1;

      /* Only commit a candidate when the opening actually fits a gate.
         fitArchToOpening returns null for openings too wide to seal, and a
         rejected fit must not out-rank an arch we already found. The
         usedCells re-check matters because the candidate cell alone may be
         free while the fitted span reaches into a neighbouring arch — that
         was leaving two gates sharing cells, so opening one silently opened
         part of the other. */
      const fitIsFree = fit => {
        if (!fit) return false;
        if (!fit.cells.every(c => !usedCells[c])) return false;
        // Never place an arch directly overlapping or adjacent to an existing arch
        if (arches.some(a => Math.hypot(a.x - fit.x, a.y - fit.y) < 2.5)) return false;
        return true;
      };
      const consider = (score, x, y, preferredPx) => {
        if (score <= bestScore) return;
        const fit = fitArchToOpening(x, y, preferredPx);
        if (!fitIsFree(fit)) return;
        bestScore = score;
        bestArch = fit;
      };

      for (let i = 1; i < path.length - 1; i++) {
        const c = path[i];
        if (usedCells[c]) continue;
        // MUST be a carved corridor cell (never inside a room)
        if (!corridor[c]) continue;

        const x = c % W, y = (c / W) | 0;
        if (x <= 0 || x >= W - 1 || y <= 0 || y >= H - 1) continue;

        // Big bonus for room threshold boundary cells (doorway[c] === 1)
        const isThreshold = doorway[c] === 1;
        const threshBonus = isThreshold ? 200 : 0;

        // 1. Horizontal 1-wide arch (walls left & right at x-1 and x+1)
        if (grid[idx(x - 1, y)] === WALL && grid[idx(x + 1, y)] === WALL &&
          grid[idx(x, y - 1)] === FLOOR && grid[idx(x, y + 1)] === FLOOR) {
          consider(100 + threshBonus, x, y, 1);
        }

        // 2. Vertical 1-wide arch (walls top & bottom at y-1 and y+1)
        if (grid[idx(x, y - 1)] === WALL && grid[idx(x, y + 1)] === WALL &&
          grid[idx(x - 1, y)] === FLOOR && grid[idx(x + 1, y)] === FLOOR) {
          consider(100 + threshBonus, x, y, 0);
        }

        // 3. Horizontal 2-wide arch
        if (x < W - 2 && grid[idx(x + 1, y)] === FLOOR && !usedCells[idx(x + 1, y)] &&
          grid[idx(x - 1, y)] === WALL && grid[idx(x + 2, y)] === WALL &&
          grid[idx(x, y - 1)] === FLOOR && grid[idx(x, y + 1)] === FLOOR) {
          consider(80 + threshBonus, x, y, 1);
        }

        // 4. Vertical 2-wide arch
        if (y < H - 2 && grid[idx(x, y + 1)] === FLOOR && !usedCells[idx(x, y + 1)] &&
          grid[idx(x, y - 1)] === WALL && grid[idx(x, y + 2)] === WALL &&
          grid[idx(x - 1, y)] === FLOOR && grid[idx(x + 1, y)] === FLOOR) {
          consider(80 + threshBonus, x, y, 0);
        }

        // 5. Horizontal 3-wide arch
        if (x > 0 && x < W - 3 && grid[idx(x + 1, y)] === FLOOR && grid[idx(x + 2, y)] === FLOOR &&
          !usedCells[idx(x + 1, y)] && !usedCells[idx(x + 2, y)] &&
          grid[idx(x - 1, y)] === WALL && grid[idx(x + 3, y)] === WALL &&
          grid[idx(x, y - 1)] === FLOOR && grid[idx(x, y + 1)] === FLOOR) {
          consider(70 + threshBonus, x, y, 1);
        }

        // 6. Vertical 3-wide arch
        if (y > 0 && y < H - 3 && grid[idx(x, y + 1)] === FLOOR && grid[idx(x, y + 2)] === FLOOR &&
          !usedCells[idx(x, y + 1)] && !usedCells[idx(x, y + 2)] &&
          grid[idx(x, y - 1)] === WALL && grid[idx(x, y + 3)] === WALL &&
          grid[idx(x - 1, y)] === FLOOR && grid[idx(x + 1, y)] === FLOOR) {
          consider(70 + threshBonus, x, y, 0);
        }
      }

      // Fallback: If no strict wall-flanked arch was found along the path,
      // pick an unused corridor threshold cell (or any threshold cell along the path)
      if (!bestArch) {
        for (let i = 1; i < path.length - 1; i++) {
          const c = path[i];
          if (!corridor[c] || usedCells[c]) continue;
          const x = c % W, y = (c / W) | 0;
          if (x <= 0 || x >= W - 1 || y <= 0 || y >= H - 1) continue;

          const prevC = path[i - 1];
          const px0 = prevC % W;
          const dx = Math.abs(x - px0);
          const prefPx = dx > 0 ? 0 : 1;

          const fit = fitArchToOpening(x, y, prefPx);
          if (!fitIsFree(fit)) continue;
          bestArch = fit;
          if (doorway[c] === 1) break;
        }
      }
      if (!bestArch) {
        for (let i = 1; i < path.length - 1; i++) {
          const c = path[i];
          if (!corridor[c]) continue;
          const x = c % W, y = (c / W) | 0;
          if (x <= 0 || x >= W - 1 || y <= 0 || y >= H - 1) continue;

          const prevC = path[i - 1];
          const px0 = prevC % W;
          const dx = Math.abs(x - px0);
          const prefPx = dx > 0 ? 0 : 1;

          const fit = fitArchToOpening(x, y, prefPx);
          if (!fitIsFree(fit)) continue;
          bestArch = fit;
          if (doorway[c] === 1) break;
        }
      }

      if (bestArch) {
        for (const cell of bestArch.cells) {
          usedCells[cell] = 1;
          doorway[cell] = 1;
        }
        // Mark 1-cell buffer around the entire arch opening so neighbouring paths cannot place adjacent arches
        const minX = Math.floor(bestArch.x - (bestArch.px === 1 ? bestArch.len * 0.5 + 0.8 : 0.8));
        const maxX = Math.ceil(bestArch.x + (bestArch.px === 1 ? bestArch.len * 0.5 + 0.8 : 0.8));
        const minY = Math.floor(bestArch.y - (bestArch.py === 1 ? bestArch.len * 0.5 + 0.8 : 0.8));
        const maxY = Math.ceil(bestArch.y + (bestArch.py === 1 ? bestArch.len * 0.5 + 0.8 : 0.8));
        for (let py = Math.max(0, minY); py <= Math.min(H - 1, maxY); py++) {
          for (let px = Math.max(0, minX); px <= Math.min(W - 1, maxX); px++) {
            usedCells[idx(px, py)] = 1;
          }
        }
        arches.push(bestArch);
      }
    }
  }

  /* -- 6. BFS field + validation -- */
  const bfs = new Int16Array(W * H).fill(-1);
  const ei = idx(rooms[entrance].cx, rooms[entrance].cy);
  const total = W * H;
  let floorTotal = 0; for (let i = 0; i < total; i++) if (grid[i] === FLOOR) floorTotal++;
  let reach = 0, maxBfs = 0;
  if (grid[ei] === FLOOR) {
    const q = new Int32Array(floorTotal); let qh = 0, qt = 0;
    q[qt++] = ei; bfs[ei] = 0; reach = 1;
    while (qh < qt) {
      const c = q[qh++], x = c % W, b = bfs[c] + 1;
      let n;
      if (x > 0 && grid[n = c - 1] === FLOOR && bfs[n] < 0) { bfs[n] = b; q[qt++] = n; reach++; }
      if (x < W - 1 && grid[n = c + 1] === FLOOR && bfs[n] < 0) { bfs[n] = b; q[qt++] = n; reach++; }
      if (c >= W && grid[n = c - W] === FLOOR && bfs[n] < 0) { bfs[n] = b; q[qt++] = n; reach++; }
      if (c < total - W && grid[n = c + W] === FLOOR && bfs[n] < 0) { bfs[n] = b; q[qt++] = n; reach++; }
    }
    maxBfs = bfs[q[qt - 1]];
  }
  const valid = reach === floorTotal && floorTotal > 0;

  /* -- 7. decoration -- */
  const props = [...magmaBridgeProps], spawns = [];
  const occ = new Uint8Array(W * H);
  const doorwayCells = [];
  for (let dy = 0; dy < H; dy++) {
    const row = dy * W;
    for (let dx = 0; dx < W; dx++) {
      if (doorway[row + dx]) doorwayCells.push({ x: dx, y: dy });
    }
  }
  const nearDoor = (x, y, d) => {
    for (let oy = -d; oy <= d; oy++) for (let ox = -d; ox <= d; ox++)
      if (inB(x + ox, y + oy) && doorway[idx(x + ox, y + oy)]) return true; return false;
  };
  const interior = (x, y) => {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++)
      if (!inB(x + ox, y + oy) || grid[idx(x + ox, y + oy)] !== FLOOR) return false; return true;
  };
  const roomHasLectern = new Set();
  const put = (kind, x, y, rot, scale, rid, oy) => {
    if (kind === 'sarco' || kind === 'coffin') {
      // Enforce strict minimum spacing of 4.5 tiles between any sarcophagi / coffins
      for (const p of props) {
        if ((p.kind === 'sarco' || p.kind === 'coffin') && Math.hypot(p.x - x, p.y - y) < 4.5) return;
      }
    }
    if (kind === 'lectern') {
      // Enforce maximum of one lectern in any room
      if (rid !== undefined && rid >= 0 && roomHasLectern.has(rid)) return;
      if (rid !== undefined && rid >= 0) roomHasLectern.add(rid);
    }
    const propObj = { kind, x, y, rot: rot || 0, scale: scale || 1, roomId: rid, oy: oy || 0 };
    props.push(propObj);
    const cells = getPropFootprintCells(propObj, W, H);
    for (const c of cells) {
      occ[c] = 1;
    }
  };

  /* Per-theme multipliers over the hand-tuned decoration rates below, so the
     dungeon editor can dial clutter without the constants being re-tuned. 1 is
     the designed rate; 0 turns a sweep off. Room furnishing (putF) also honours
     values above 1 by adding extra clutter on leftover tiles. */
  const DEC = TH.decor || {};
  const dmul = k => (DEC[k] == null ? 1 : DEC[k]);
  const putF = (kind, x, y, rot, scale, rid, oy) => {
    const m = dmul('furniture');
    if (m < 1 && !rng.chance(m)) return;
    put(kind, x, y, rot, scale, rid, oy);
  };

  /* The weeping angel is a rare Grim centrepiece: at most one per level, on
     about 3 levels in 10. It rolls on its own stream so that adding it does
     not reshuffle the rest of the level's decoration. */
  const angelRng = makeRng((seed ^ 0x5eed0a9e) >>> 0);
  let angelsLeft = (thKey === 'grim' && angelRng.chance(0.3)) ? 1 : 0;
  let angelRoom = -1;
  /* The funeral bell is just as rare, on its own stream, and never shares a
     room with the angel. */
  const bellRng = makeRng((seed ^ 0xbe11f00d) >>> 0);
  let bellsLeft = (thKey === 'grim' && bellRng.chance(0.25)) ? 1 : 0;

  for (const r of rooms) {
    const cix = idx(r.cx, r.cy);
    if (r.type === TYPE.ENTRANCE) put('ring', r.cx, r.cy, 0, 1, r.id);
    if (r.type === TYPE.BOSS) {
      if (thKey === 'grim') {
        // Grim Boss Arena: Grand Sepulcher Dais centerpiece with Master Sarcophagus & Sconced Pillars
        put('sepulcherDais', r.cx, r.cy, 0, 1.25, r.id);
        put('sarco', r.cx, r.cy, (r.w >= r.h ? 0 : Math.PI / 2), 1.35, r.id);
        put('candle', r.cx, r.cy, 0, 1.1, r.id, 0.72); // Candle directly atop sarcophagus lid!

        const pox = Math.min(3, Math.floor(r.w / 2) - 2);
        const poy = Math.min(3, Math.floor(r.h / 2) - 2);
        for (const [px, py] of [[r.cx - pox, r.cy - poy], [r.cx + pox, r.cy - poy], [r.cx - pox, r.cy + poy], [r.cx + pox, r.cy + poy]]) {
          if (interior(px, py) && !occ[idx(px, py)] && !nearDoor(px, py, 2)) {
            put('pillar', px, py, 0, 1.0, r.id);
            put('candle', px, py, rng.f(0, 6.28), 0.9, r.id, 1.72);
          }
        }
        const rr = Math.max(3.0, Math.min(r.w, r.h) / 2 - 1.5), a0 = rng.f(0, 1);
        for (let k = 0; k < 6; k++) {
          const a = a0 + k * Math.PI / 3;
          const bx = Math.round(r.cx + Math.cos(a) * rr), by = Math.round(r.cy + Math.sin(a) * rr);
          if (inB(bx, by) && grid[idx(bx, by)] === FLOOR && !occ[idx(bx, by)] && !nearDoor(bx, by, 1)) put('brazier', bx, by, 0, 1, r.id);
        }
      } else if (thKey === 'molten') {
        // Molten Boss Arena: Grand Infernal Foundry Crucible Dais
        put('sepulcherDais', r.cx, r.cy, 0, 1.3, r.id);
        put('forge', r.cx, r.cy, (r.w >= r.h ? 0 : Math.PI / 2), 1.25, r.id, 0.29);
        put('anvil', r.cx + (r.w >= r.h ? 1 : 0), r.cy + (r.w >= r.h ? 0 : 1), rng.f(0, 6.28), 1.0, r.id, 0.29);
        put('smeltingCrucible', r.cx - (r.w >= r.h ? 1 : 0), r.cy - (r.w >= r.h ? 0 : 1), 0, 1.0, r.id, 0.29);
        put('ingotStack', r.cx, r.cy + (r.w >= r.h ? 1 : 0), rng.f(0, 6.28), 0.9, r.id, 0.29);

        // 4 Bastion Basalt Pillars with Glowing Magma Braziers and chains
        const pox = Math.min(3, Math.floor(r.w / 2) - 2);
        const poy = Math.min(3, Math.floor(r.h / 2) - 2);
        for (const [px, py] of [[r.cx - pox, r.cy - poy], [r.cx + pox, r.cy - poy], [r.cx - pox, r.cy + poy], [r.cx + pox, r.cy + poy]]) {
          if (interior(px, py) && !occ[idx(px, py)] && !nearDoor(px, py, 2)) {
            put('pillar', px, py, 0, 1.1, r.id);
            put('brazier', px, py, 0, 1.0, r.id);
            put('forgeChains', px, py, rng.f(0, 6.28), 1.0, r.id);
          }
        }
        // Ring of braziers, basalt stalagmites & glowing magma cracks
        const rr = Math.max(3.0, Math.min(r.w, r.h) / 2 - 1.5), a0 = rng.f(0, 1);
        for (let k = 0; k < 6; k++) {
          const a = a0 + k * Math.PI / 3;
          const bx = Math.round(r.cx + Math.cos(a) * rr), by = Math.round(r.cy + Math.sin(a) * rr);
          if (inB(bx, by) && grid[idx(bx, by)] === FLOOR && !occ[idx(bx, by)] && !nearDoor(bx, by, 1)) {
            if (k % 2 === 0) put('brazier', bx, by, 0, 1, r.id);
            else put('stalagmite', bx, by, rng.f(0, 6.28), 1.15, r.id);
            if (rng.chance(0.6)) put('crack', bx, by, rng.f(0, 6.28), 1.0, r.id);
          }
        }
      } else if (thKey === 'frost') {
        // Frost Boss Arena: The High Jarl's Mammoth Throne & Glacial Runic Sanctum
        put('sepulcherDais', r.cx, r.cy, 0, 1.3, r.id);
        put('iceThrone', r.cx, r.cy, (r.w >= r.h ? 0 : Math.PI / 2), 1.25, r.id, 0.29);
        put('mammothTusks', r.cx, r.cy, (r.w >= r.h ? 0 : Math.PI / 2), 1.2, r.id, 0.29);
        put('hearthPit', r.cx + (r.w >= r.h ? 0 : 1), r.cy + (r.w >= r.h ? 1 : 0), 0, 1.0, r.id, 0.29);
        put('shieldRack', r.cx - (r.w >= r.h ? 0 : 1), r.cy - (r.w >= r.h ? 1 : 0), (r.w >= r.h ? Math.PI / 2 : 0), 1.0, r.id, 0.29);

        // 4 Bastion Runic Obelisks with Coldfire Hearths & Glacial Spires
        const pox = Math.min(3, Math.floor(r.w / 2) - 2);
        const poy = Math.min(3, Math.floor(r.h / 2) - 2);
        for (const [px, py] of [[r.cx - pox, r.cy - poy], [r.cx + pox, r.cy - poy], [r.cx - pox, r.cy + poy], [r.cx + pox, r.cy + poy]]) {
          if (interior(px, py) && !occ[idx(px, py)] && !nearDoor(px, py, 2)) {
            put('runicObelisk', px, py, 0, 1.1, r.id);
            put('glacialSpire', px, py, rng.f(0, 6.28), 0.95, r.id);
          }
        }
        // Radial Ring of mammoth tusks, bone totems, coldfire hearths & glacial spires
        const rr = Math.max(3.0, Math.min(r.w, r.h) / 2 - 1.5), a0 = rng.f(0, 1);
        for (let k = 0; k < 6; k++) {
          const a = a0 + k * Math.PI / 3;
          const bx = Math.round(r.cx + Math.cos(a) * rr), by = Math.round(r.cy + Math.sin(a) * rr);
          if (inB(bx, by) && grid[idx(bx, by)] === FLOOR && !occ[idx(bx, by)] && !nearDoor(bx, by, 1)) {
            if (k % 3 === 0) put('mammothTusks', bx, by, a + Math.PI / 2, 1.05, r.id);
            else if (k % 3 === 1) put('glacialSpire', bx, by, rng.f(0, 6.28), 1.15, r.id);
            else put('boneTotem', bx, by, a, 1.1, r.id);
            if (rng.chance(0.6)) put('crack', bx, by, rng.f(0, 6.28), 1.0, r.id);
          }
        }
      } else if (thKey === 'ancient') {
        // Ancient Boss Arena: the old king's throne on a raised dais, a colonnade and fire.
        // (The red crystal used to stand here; it only suits some dungeons. A solid
        // centrepiece is fine: game.js moves the room anchor/exit to a free cell.)
        put('sepulcherDais', r.cx, r.cy, 0, 1.3, r.id);
        put('throne', r.cx, r.cy, (r.w >= r.h ? 0 : Math.PI / 2), 1.0, r.id, 0.29);
        const pox = Math.min(3, Math.floor(r.w / 2) - 2);
        const poy = Math.min(3, Math.floor(r.h / 2) - 2);
        let col = 0;
        for (const [px, py] of [[r.cx - pox, r.cy - poy], [r.cx + pox, r.cy - poy], [r.cx - pox, r.cy + poy], [r.cx + pox, r.cy + poy]]) {
          if (interior(px, py) && !occ[idx(px, py)] && !nearDoor(px, py, 2)) put(col++ & 1 ? 'pillarB' : 'pillarA', px, py, 0, 1.0, r.id);
        }
        const rr = Math.max(3.0, Math.min(r.w, r.h) / 2 - 1.5), a0 = rng.f(0, 1);
        for (let k = 0; k < 6; k++) {
          const a = a0 + k * Math.PI / 3;
          const bx = Math.round(r.cx + Math.cos(a) * rr), by = Math.round(r.cy + Math.sin(a) * rr);
          if (inB(bx, by) && grid[idx(bx, by)] === FLOOR && !occ[idx(bx, by)] && !nearDoor(bx, by, 1)) {
            put(k % 2 === 0 ? 'brazier' : 'urn', bx, by, k % 2 === 0 ? 0 : rng.f(0, 6.28), 1, r.id);
          }
        }
      } else if (thKey === 'verdant') {
        // Verdant Boss Arena: a swollen spore pod rooted on the dais, gnarled roots at the
        // corners, a ring of mushrooms and ferns lit by braziers.
        put('sepulcherDais', r.cx, r.cy, 0, 1.3, r.id);
        put('sporePod', r.cx, r.cy, rng.f(0, 6.28), 1.3, r.id, 0.29);
        const pox = Math.min(3, Math.floor(r.w / 2) - 2);
        const poy = Math.min(3, Math.floor(r.h / 2) - 2);
        let col = 0;
        for (const [px, py] of [[r.cx - pox, r.cy - poy], [r.cx + pox, r.cy - poy], [r.cx - pox, r.cy + poy], [r.cx + pox, r.cy + poy]]) {
          if (interior(px, py) && !occ[idx(px, py)] && !nearDoor(px, py, 2)) put(col++ & 1 ? 'rootsB' : 'rootsA', px, py, rng.f(0, 6.28), 1.1, r.id);
        }
        const rr = Math.max(3.0, Math.min(r.w, r.h) / 2 - 1.5), a0 = rng.f(0, 1);
        const ringKinds = ['brazier', 'mushroomA', 'fren1', 'brazier', 'mushroomB', 'fren3'];
        for (let k = 0; k < 6; k++) {
          const a = a0 + k * Math.PI / 3;
          const bx = Math.round(r.cx + Math.cos(a) * rr), by = Math.round(r.cy + Math.sin(a) * rr);
          if (inB(bx, by) && grid[idx(bx, by)] === FLOOR && !occ[idx(bx, by)] && !nearDoor(bx, by, 1)) {
            put(ringKinds[k], bx, by, ringKinds[k] === 'brazier' ? 0 : rng.f(0, 6.28), 1, r.id);
          }
        }
      } else {
        put('bossCrystal', r.cx, r.cy, rng.f(0, 6.28), 1, r.id);
        const rr = Math.max(2.5, Math.min(r.w, r.h) / 2 - 2), a0 = rng.f(0, 1);
        for (let k = 0; k < 6; k++) {
          const a = a0 + k * Math.PI / 3;
          const bx = Math.round(r.cx + Math.cos(a) * rr), by = Math.round(r.cy + Math.sin(a) * rr);
          if (inB(bx, by) && grid[idx(bx, by)] === FLOOR && !occ[idx(bx, by)] && !nearDoor(bx, by, 1)) put('brazier', bx, by, 0, 1, r.id);
        }
      }
    }
    if (r.type === TYPE.TREASURE && grid[cix] === FLOOR) put('chest', r.cx, r.cy, rng.i(0, 3) * Math.PI / 2, 1, r.id);
    if (r.type === TYPE.SHRINE && grid[cix] === FLOOR) {
      put('shrineCrystal', r.cx, r.cy, rng.f(0, 6.28), 1, r.id);
      props[props.length - 1].lightShrine = false;   // chooseLightShrine may pick it
    }
    if (r.type === TYPE.RIVAL && grid[cix] === FLOOR) {
      put('shrineCrystal', r.cx, r.cy, 0, 1, r.id);
      put('weaponRack', r.cx - 2, r.cy, 0, 1, r.id);
      put('crate', r.cx + 2, r.cy - 1, 0.4, 1, r.id);
      put('barrel', r.cx + 2, r.cy + 1, 0, 1, r.id);
      put('bench', r.cx, r.cy - 2, 0, 1, r.id);
    }

    if ((r.type === TYPE.COMBAT || r.type === TYPE.ELITE) && Math.min(r.w, r.h) >= 10 && r.shape !== 'ellipse' && !r.grave && !r.lake) {
      /* occasional accent: a matched set of statue-pillars flanking the room corners */
      if (thKey === 'ancient' && Math.min(r.w, r.h) >= 12 && rng.chance(0.4 * dmul('pillars'))) {
        const kind = rng.chance(0.5) ? 'pillarA' : 'pillarB';
        const ox = Math.max(3, Math.floor(r.w / 2) - 3), oy = Math.max(3, Math.floor(r.h / 2) - 3);
        for (const [cx0, cy0] of [[r.cx - ox, r.cy - oy], [r.cx + ox, r.cy - oy], [r.cx - ox, r.cy + oy], [r.cx + ox, r.cy + oy]]) {
          const x = Math.round(cx0), y = Math.round(cy0);
          if (interior(x, y) && !occ[idx(x, y)] && !nearDoor(x, y, 2))
            put(kind, x, y, rng.i(0, 3) * (Math.PI / 2), rng.f(0.94, 1.06), r.id);
        }
      }
      const step = Math.min(r.w, r.h) >= 14 ? 4 : 3;
      for (let y = Math.ceil(r.cy - r.h / 2) + 2; y <= r.cy + r.h / 2 - 2; y++)
        for (let x = Math.ceil(r.cx - r.w / 2) + 2; x <= r.cx + r.w / 2 - 2; x++) {
          if (((x - r.cx) % step) !== 0 || ((y - r.cy) % step) !== 0) continue;
          if (x === r.cx && y === r.cy) continue;
          if (interior(x, y) && !occ[idx(x, y)] && !nearDoor(x, y, 2)) put('pillar', x, y, 0, rng.f(0.94, 1.06), r.id);
        }
    }

    if (r.grave || (thKey === 'grim' && (r.type === TYPE.COMBAT || r.type === TYPE.ELITE))) {
      /* Occasional single accent tombstone in a corner */
      if (Math.min(r.w, r.h) >= 8 && rng.chance(0.25 * dmul('pillars'))) {
        const ox = Math.max(2, Math.floor(r.w / 2) - 2), oy = Math.max(2, Math.floor(r.h / 2) - 2);
        const x = r.cx + (rng.chance(0.5) ? ox : -ox), y = r.cy + (rng.chance(0.5) ? oy : -oy);
        if (interior(x, y) && !occ[idx(x, y)] && !nearDoor(x, y, 2))
          put('tombstone', x, y, rng.i(0, 3) * (Math.PI / 2), rng.f(0.85, 1.05), r.id);
      }

      /* Clean geometric sarcophagus placement */
      if (Math.min(r.w, r.h) >= 8 && grid[cix] === FLOOR && !occ[cix] && rng.chance(0.75)) {
        const isLarge = Math.min(r.w, r.h) >= 12;
        if (isLarge && rng.chance(0.5)) {
          // Symmetrical dual-bier pair spaced 4 tiles apart along minor axis with parallel alignment
          if (r.w >= r.h) {
            const s1y = r.cy - 2, s2y = r.cy + 2;
            if (interior(r.cx, s1y) && interior(r.cx, s2y) && !occ[idx(r.cx, s1y)] && !occ[idx(r.cx, s2y)] && !nearDoor(r.cx, s1y, 2) && !nearDoor(r.cx, s2y, 2)) {
              put('sarco', r.cx, s1y, 0, 1, r.id);
              put('candle', r.cx, s1y, 0, 0.9, r.id, 0.72);
              put('sarco', r.cx, s2y, 0, 1, r.id);
              put('candle', r.cx, s2y, 0, 0.9, r.id, 0.72);
            } else {
              put('sarco', r.cx, r.cy, 0, 1, r.id);
              put('candle', r.cx, r.cy, 0, 0.9, r.id, 0.72);
            }
          } else {
            const s1x = r.cx - 2, s2x = r.cx + 2;
            if (interior(s1x, r.cy) && interior(s2x, r.cy) && !occ[idx(s1x, r.cy)] && !occ[idx(s2x, r.cy)] && !nearDoor(s1x, r.cy, 2) && !nearDoor(s2x, r.cy, 2)) {
              put('sarco', s1x, r.cy, Math.PI / 2, 1, r.id);
              put('candle', s1x, r.cy, 0, 0.9, r.id, 0.72);
              put('sarco', s2x, r.cy, Math.PI / 2, 1, r.id);
              put('candle', s2x, r.cy, 0, 0.9, r.id, 0.72);
            } else {
              put('sarco', r.cx, r.cy, Math.PI / 2, 1, r.id);
              put('candle', r.cx, r.cy, 0, 0.9, r.id, 0.72);
            }
          }
        } else {
          // Single central sarcophagus aligned with room's primary axis
          const sarcoRot = (r.w >= r.h) ? 0 : Math.PI / 2;
          put('sarco', r.cx, r.cy, sarcoRot, 1, r.id);
          put('candle', r.cx, r.cy, 0, 0.9, r.id, 0.72);
        }
      }

      let cd = 3;
      while (cd-- > 0) {
        const x = rng.i(Math.floor(r.cx - r.w / 2) + 1, Math.ceil(r.cx + r.w / 2) - 1);
        const y = rng.i(Math.floor(r.cy - r.h / 2) + 1, Math.ceil(r.cy + r.h / 2) - 1);
        if (inB(x, y) && roomId[idx(x, y)] === r.id && grid[idx(x, y)] === FLOOR && !occ[idx(x, y)])
          put('candle', x, y, 0, rng.f(0.85, 1.2), r.id);
      }
    }

    if (r.type !== TYPE.ENTRANCE) {
      const thKey = params.themeKey || 'ancient';
      let arch = 'GUARD_ROOM';
      if (r.type === TYPE.SHRINE) arch = 'SANCTUM';
      else if (r.type === TYPE.TREASURE) arch = 'TREASURY';
      else if (r.type === TYPE.BOSS) arch = 'SANCTUM';
      else if (r.grave) arch = 'CRYPT';
      else if (r.lake) arch = 'OVERGROWN';
      else {
        const themeArchMap = {
          ancient: ['RELIQUARY_VAULT', 'ELDER_ARCHIVE', 'SOLAR_OBSERVATORY', 'ARMORY'],
          molten: ['INFERNAL_FORGE', 'CALDERA_CRUCIBLE', 'ASHEN_GUARDHOUSE'],
          frost: ['JARLS_MEAD_HALL', 'SHAMAN_RUNE_SANCTUM', 'WARRIORS_ARMORY', 'GLACIAL_VAULT'],
          grim: ['NECROPOLIS_OSSUARY', 'PLAGUE_ALTAR', 'CHARNEL_PIT'],
          verdant: ['SPORE_NURSERY', 'BOTANICAL_CONSERVATORY', 'ROOT_SHRINE'],
          forest: ['GOBLIN_CAMP', 'DRUIDIC_GROVE', 'ARMORY'],
          moor: ['MEGALITH_RIDGE', 'BARROW_TOMB'],
          mire: ['WITCH_HOVEL', 'DROWNED_CAUSEWAY'],
          holdfast: ['PALISADE_ARMORY', 'COMMAND_PAVILION', 'GUARD_ROOM']
        };
        const pool = themeArchMap[thKey] || ['ARMORY', 'LIBRARY', 'ALCHEMY_LAB', 'GUARD_ROOM', 'SANCTUM', 'TREASURY'];
        arch = pool[(r.id ^ seed) % pool.length];
      }

      const wallTiles = [];
      const cornerTiles = [];
      const freeInterior = [];

      for (let y = Math.floor(r.cy - r.h / 2) + 1; y <= Math.ceil(r.cy + r.h / 2) - 1; y++) {
        for (let x = Math.floor(r.cx - r.w / 2) + 1; x <= Math.ceil(r.cx + r.w / 2) - 1; x++) {
          if (!inB(x, y)) continue;
          const c = idx(x, y);
          if (roomId[c] !== r.id || grid[c] !== FLOOR || occ[c] || nearDoor(x, y, 1)) continue;
          let wallCount = 0;
          let wallDx = 0, wallDy = 0;
          if (x < W - 1 && grid[c + 1] === WALL) { wallCount++; wallDx = 1; }
          if (x > 0 && grid[c - 1] === WALL) { wallCount++; wallDx = -1; }
          if (y < H - 1 && grid[c + W] === WALL) { wallCount++; wallDy = 1; }
          if (y > 0 && grid[c - W] === WALL) { wallCount++; wallDy = -1; }

          if (wallCount >= 2) cornerTiles.push({ x, y, dx: wallDx, dy: wallDy });
          else if (wallCount === 1) wallTiles.push({ x, y, dx: wallDx, dy: wallDy });
          else if (interior(x, y) && !nearDoor(x, y, 2)) freeInterior.push({ x, y });
        }
      }

      /* A magic circle takes the clear 3x3 of plain floor nearest the room's
         centre, not just any free tile: it is reserved (occ) so later
         furniture and scatter stay off it, and buildElevation pins a circle's
         3x3 to level 0 so no step or ramp runs through it. At scale 1.25 the
         2.2-wide decal spans 2.75 tiles, inside its 3x3. With
         `lecternChance`, a lectern sometimes stands in the middle, picked
         from a hash of the room rather than rng so the rest of the level
         isn't reshuffled. Returns false when no 3x3 fits. */
      const placeMagicCircle = (lecternChance = 0) => {
        let best = null, bestD = Infinity;
        for (const f of freeInterior) {
          let ok = true;
          for (let oy = -1; oy <= 1 && ok; oy++) for (let ox = -1; ox <= 1; ox++) {
            const x = f.x + ox, y = f.y + oy;
            if (!inB(x, y)) { ok = false; break; }
            const c = idx(x, y);
            if (roomId[c] !== r.id || grid[c] !== FLOOR || occ[c] || nearDoor(x, y, 1)) { ok = false; break; }
          }
          if (!ok) continue;
          const dd = Math.hypot(f.x - r.cx, f.y - r.cy);
          if (dd < bestD) { bestD = dd; best = f; }
        }
        if (!best) return false;
        put('magicCircle', best.x, best.y, 0, 1.25, r.id);
        if (((((r.id + 1) * 2654435761) ^ seed) >>> 0) % 100 < lecternChance * 100)
          put('lectern', best.x, best.y, ((r.id ^ seed) & 3) * Math.PI / 2, 1, r.id);
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) occ[idx(best.x + ox, best.y + oy)] = 1;
        return true;
      };

      // Helpers for purposeful, structured table and desk placement
      const placePlanningTable = (accessory = 'candle') => {
        if (Math.min(r.w, r.h) < 6) return false;
        const candidates = freeInterior.filter(t => !nearDoor(t.x, t.y, 2) && !occ[idx(t.x, t.y)]);
        if (candidates.length === 0) return false;
        candidates.sort((a, b) => Math.hypot(a.x - r.cx, a.y - r.cy) - Math.hypot(b.x - r.cx, b.y - r.cy));
        const ct = candidates[0];
        const isWide = (r.w >= r.h);
        const tableRot = isWide ? 0 : Math.PI / 2;
        putF('table', ct.x, ct.y, tableRot, 1, r.id);
        if (accessory === 'globe') putF('globe', ct.x, ct.y, 0, 0.8, r.id, 0.58);
        else if (accessory === 'candle') put('candle', ct.x, ct.y, rng.f(0, 6.28), 0.9, r.id, 0.58);

        if (isWide) {
          const northIdx = idx(ct.x, ct.y - 1);
          if (inB(ct.x, ct.y - 1) && grid[northIdx] === FLOOR && !occ[northIdx] && !nearDoor(ct.x, ct.y - 1, 1)) {
            putF('bench', ct.x, ct.y - 1, 0, 0.9, r.id);
          }
          const southIdx = idx(ct.x, ct.y + 1);
          if (inB(ct.x, ct.y + 1) && grid[southIdx] === FLOOR && !occ[southIdx] && !nearDoor(ct.x, ct.y + 1, 1)) {
            putF('bench', ct.x, ct.y + 1, 0, 0.9, r.id);
          }
        } else {
          const westIdx = idx(ct.x - 1, ct.y);
          if (inB(ct.x - 1, ct.y) && grid[westIdx] === FLOOR && !occ[westIdx] && !nearDoor(ct.x - 1, ct.y, 1)) {
            putF('bench', ct.x - 1, ct.y, Math.PI / 2, 0.9, r.id);
          }
          const eastIdx = idx(ct.x + 1, ct.y);
          if (inB(ct.x + 1, ct.y) && grid[eastIdx] === FLOOR && !occ[eastIdx] && !nearDoor(ct.x + 1, ct.y, 1)) {
            putF('bench', ct.x + 1, ct.y, Math.PI / 2, 0.9, r.id);
          }
        }
        return true;
      };

      const placeStudyDesk = (wt) => {
        if (!wt || occ[idx(wt.x, wt.y)] || nearDoor(wt.x, wt.y, 1)) return false;
        const isHorizWall = (wt.dy !== 0);
        const deskRot = isHorizWall ? 0 : Math.PI / 2;
        putF('table', wt.x, wt.y, deskRot, 1, r.id);
        put('candle', wt.x, wt.y, rng.f(0, 6.28), 0.9, r.id, 0.58);

        const cx = wt.x - wt.dx;
        const cy = wt.y - wt.dy;
        const cidx = idx(cx, cy);
        if (inB(cx, cy) && grid[cidx] === FLOOR && !occ[cidx] && !nearDoor(cx, cy, 1)) {
          const chairRot = Math.atan2(wt.dx, wt.dy);
          putF('chair', cx, cy, chairRot, 0.85, r.id);
        }
        return true;
      };

      if (arch === 'INFERNAL_FORGE') {
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length / 2)];
          putF('forge', fit.x, fit.y, 0, 1.15, r.id);
          if (freeInterior.length > 1) {
            const fit2 = freeInterior[0];
            putF('anvil', fit2.x, fit2.y, rng.f(0, 6.28), 1.0, r.id);
          }
          if (freeInterior.length > 2) {
            const fit3 = freeInterior[freeInterior.length - 1];
            putF('ingotStack', fit3.x, fit3.y, rng.f(0, 6.28), 1.0, r.id);
          }
          /* batch 3: quench tub beside the anvil. Rotations come from the
             tile, not rng, so the rest of the level keeps its layout. */
          const fit4 = freeInterior[1];
          if (fit4 && freeInterior.length > 3 && !occ[idx(fit4.x, fit4.y)])
            putF('quenchBarrel', fit4.x, fit4.y, ((fit4.x * 7 + fit4.y * 3) % 4) * Math.PI / 2, 1.0, r.id);
        }
        {
          const wt3 = wallTiles[2] || cornerTiles[2];
          if (wt3 && !occ[idx(wt3.x, wt3.y)])
            putF('mineCart', wt3.x, wt3.y, (wt3.dy !== 0 ? 0 : Math.PI / 2), 1.0, r.id);
        }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('forgeChains', ct.x, ct.y, rng.f(0, 6.28), 1, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('boulderPile', ct2.x, ct2.y, rng.f(0, 6.28), 1, r.id); }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('weaponRack', wt.x, wt.y, Math.atan2(wt.dx, wt.dy), 1, r.id); }
        if (wallTiles.length > 1) { const wt2 = wallTiles[1]; putF('smeltingCrucible', wt2.x, wt2.y, 0, 1.0, r.id); }
      } else if (arch === 'CALDERA_CRUCIBLE') {
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length / 2)];
          putF('smeltingCrucible', fit.x, fit.y, 0, 1.2, r.id);
          if (freeInterior.length > 1) {
            const fit2 = freeInterior[0];
            putF('stalagmite', fit2.x, fit2.y, rng.f(0, 6.28), 1.1, r.id);
          }
        }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('boulderPile', ct.x, ct.y, rng.f(0, 6.28), 1.1, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('stalagmite', ct2.x, ct2.y, rng.f(0, 6.28), 1.0, r.id); }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('forgeChains', wt.x, wt.y, rng.f(0, 6.28), 1, r.id); }
        for (let k = 2; k < Math.min(4, cornerTiles.length); k++) {
          const ct = cornerTiles[k];
          if (!occ[idx(ct.x, ct.y)]) putF(k === 2 ? 'lavaSpikeA' : 'lavaSpikeB', ct.x, ct.y, ((ct.x + ct.y) % 4) * Math.PI / 2, 1.0, r.id);
        }
        {
          const fr = freeInterior[1];
          if (fr && freeInterior.length > 3 && !occ[idx(fr.x, fr.y)])
            putF('coolingRocks', fr.x, fr.y, ((fr.x * 5 + fr.y) % 4) * Math.PI / 2, 1.0, r.id);
        }
      } else if (arch === 'ASHEN_GUARDHOUSE') {
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length / 2)];
          putF('table', fit.x, fit.y, 0, 1.0, r.id);
          if (freeInterior.length > 1) {
            const fit2 = freeInterior[0];
            putF('bench', fit2.x, fit2.y, 0, 0.9, r.id);
          }
        }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('weaponRack', wt.x, wt.y, Math.atan2(wt.dx, wt.dy), 1, r.id); }
        if (wallTiles.length > 1) { const wt2 = wallTiles[1]; putF('weaponRack', wt2.x, wt2.y, Math.atan2(wt2.dx, wt2.dy), 1, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('crate', ct.x, ct.y, rng.f(0, 6.28), 1.1, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('forgeChains', ct2.x, ct2.y, rng.f(0, 6.28), 1.0, r.id); }
      } else if (arch === 'JARLS_MEAD_HALL') {
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length / 2)];
          putF('table', fit.x, fit.y, 0, 1.1, r.id);
          if (freeInterior.length > 1) {
            const fit2 = freeInterior[0];
            putF('bench', fit2.x, fit2.y, 0, 1.0, r.id);
          }
          if (freeInterior.length > 2) {
            const fit3 = freeInterior[freeInterior.length - 1];
            putF('hearthPit', fit3.x, fit3.y, 0, 1.0, r.id);
          }
        }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('shieldRack', wt.x, wt.y, Math.atan2(wt.dx, wt.dy), 1, r.id); }
        if (wallTiles.length > 1) { const wt2 = wallTiles[1]; putF('mammothTusks', wt2.x, wt2.y, Math.atan2(wt2.dx, wt2.dy), 1, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('barrel', ct.x, ct.y, rng.f(0, 6.28), 1.05, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('glacialSpire', ct2.x, ct2.y, rng.f(0, 6.28), 1.0, r.id); }
      } else if (arch === 'SHAMAN_RUNE_SANCTUM') {
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length / 2)];
          putF('runicObelisk', fit.x, fit.y, 0, 1.15, r.id);
          if (freeInterior.length > 1) placeMagicCircle();
          if (freeInterior.length > 2) {
            const fit3 = freeInterior[freeInterior.length - 1];
            putF('hearthPit', fit3.x, fit3.y, 0, 1.0, r.id);
          }
        }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('runicObelisk', wt.x, wt.y, Math.atan2(wt.dx, wt.dy), 1.05, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('boneTotem', ct.x, ct.y, rng.f(0, 6.28), 1.1, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('glacialSpire', ct2.x, ct2.y, rng.f(0, 6.28), 1.1, r.id); }
      } else if (arch === 'WARRIORS_ARMORY') {
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length / 2)];
          putF('hearthPit', fit.x, fit.y, 0, 1.0, r.id);
        }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('weaponRack', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1, r.id); }
        if (wallTiles.length > 1) { const wt2 = wallTiles[1]; putF('shieldRack', wt2.x, wt2.y, Math.atan2(-wt2.dx, -wt2.dy), 1, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('mammothTusks', ct.x, ct.y, rng.f(0, 6.28), 1.0, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('crate', ct2.x, ct2.y, rng.f(0, 6.28), 1.1, r.id); }
      } else if (arch === 'GLACIAL_VAULT') {
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length / 2)];
          putF('iceThrone', fit.x, fit.y, 0, 1.1, r.id);
          if (freeInterior.length > 1) {
            const fit2 = freeInterior[0];
            putF('glacialSpire', fit2.x, fit2.y, rng.f(0, 6.28), 1.1, r.id);
          }
        }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; props.push({ kind: 'icicle', x: wt.x, y: wt.y, dx: wt.dx, dy: wt.dy, rot: rng.f(0, 6.28), scale: 1, roomId: r.id }); }
        if (wallTiles.length > 1) { const wt2 = wallTiles[1]; putF('mammothTusks', wt2.x, wt2.y, Math.atan2(-wt2.dx, -wt2.dy), 1.0, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('boneTotem', ct.x, ct.y, rng.f(0, 6.28), 1.0, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('glacialSpire', ct2.x, ct2.y, rng.f(0, 6.28), 1.15, r.id); }
      } else if (arch === 'NECROPOLIS_OSSUARY' || arch === 'PLAGUE_ALTAR' || arch === 'CHARNEL_PIT' || arch === 'CRYPT') {
        if (wallTiles.length > 0) {
          const wt = wallTiles[0];
          putF('altarTable', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1.0, r.id);
          put('candle', wt.x, wt.y, rng.f(0, 6.28), 0.95, r.id, 0.65); // Sits ON TOP of altar
        }
        if (wallTiles.length > 1) {
          const wt = wallTiles[1];
          props.push({ kind: 'ossuaryWall', x: wt.x, y: wt.y, dx: wt.dx, dy: wt.dy, rot: 0, scale: 1, roomId: r.id });
          occ[idx(wt.x, wt.y)] = 1;
        }
        if (wallTiles.length > 2 && rng.chance(0.7)) {
          // the plague altar keeps its remedies on an apothecary shelf, not a scholar's desk
          if (arch === 'PLAGUE_ALTAR') {
            const wt = wallTiles[2];
            putF('apothecaryShelf', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1.0, r.id);
          } else {
            placeStudyDesk(wallTiles[2]);
          }
        }
        if (cornerTiles.length > 0) {
          const ct = cornerTiles[0];
          put('candle', ct.x, ct.y, rng.f(0, 6.28), 1.0, r.id);
        }
        if (cornerTiles.length > 1) {
          const ct2 = cornerTiles[1];
          putF('urn', ct2.x, ct2.y, rng.f(0, 6.28), 0.9, r.id);
        }
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length / 2)];
          if (arch === 'PLAGUE_ALTAR') {
            putF('altarTable', fit.x, fit.y, 0, 1.1, r.id);
            put('candle', fit.x, fit.y, 0, 1.0, r.id, 0.65); // Sits ON TOP of altar
          } else if ((thKey === 'ancient' || thKey === 'grim') && rng.chance(0.65)) {
            putF(rng.chance(0.5) ? 'cage' : 'cage2', fit.x, fit.y, rng.f(0, 6.28), 1.0, r.id);
          }
        }
        if (angelsLeft > 0 && thKey === 'grim' && angelRng.chance(0.4)) {
          // backed against a free stretch of wall, facing into the room
          const spot = wallTiles.slice(3).find(wt => !occ[idx(wt.x, wt.y)] && !nearDoor(wt.x, wt.y, 2));
          if (spot) {
            put('weepingAngel', spot.x, spot.y, Math.atan2(-spot.dx, -spot.dy), 1.0, r.id);
            angelsLeft--;
            angelRoom = r.id;
          }
        }
        if (bellsLeft > 0 && thKey === 'grim' && r.id !== angelRoom && bellRng.chance(0.4)) {
          // frame parallel to the wall, the bell hanging toward the room
          const spot = wallTiles.slice(3).find(wt => !occ[idx(wt.x, wt.y)] && !nearDoor(wt.x, wt.y, 2));
          if (spot) {
            put('funeralBell', spot.x, spot.y, Math.atan2(-spot.dx, -spot.dy), 1.0, r.id);
            bellsLeft--;
          }
        }
      } else if (arch === 'SPORE_NURSERY') {
        if (freeInterior.length > 0) { const fit = freeInterior[Math.floor(freeInterior.length / 2)]; putF('sporePod', fit.x, fit.y, 0, 1.2, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('moss', ct.x, ct.y, rng.f(0, 6.28), 1.2, r.id); }
      } else if (arch === 'MEGALITH_RIDGE' || arch === 'DRUIDIC_GROVE') {
        if (freeInterior.length > 0) { const fit = freeInterior[Math.floor(freeInterior.length / 2)]; putF('megalith', fit.x, fit.y, 0, 1.2, r.id); }
      } else if (arch === 'WITCH_HOVEL') {
        if (freeInterior.length > 0) { const fit = freeInterior[Math.floor(freeInterior.length / 2)]; putF('cauldron', fit.x, fit.y, 0, 1.1, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('urn', ct.x, ct.y, 0, 0.9, r.id); }
      } else if (arch === 'PALISADE_ARMORY' || arch === 'COMMAND_PAVILION') {
        if (arch === 'COMMAND_PAVILION') {
          placePlanningTable('globe');
        } else if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length / 2)];
          putF('wagon', fit.x, fit.y, 0, 1, r.id);
        }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('weaponRack', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1, r.id); }
      } else if (arch === 'ARMORY') {
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('weaponRack', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('barrel', ct.x, ct.y, rng.f(0, 6.28), 1, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('crate', ct2.x, ct2.y, rng.f(0, 6.28), 1, r.id); }
        placePlanningTable();
        if (wallTiles.length > 1) { const wt = wallTiles[1]; props.push({ kind: 'tapestry', x: wt.x, y: wt.y, dx: wt.dx, dy: wt.dy, rot: 0, scale: 1, roomId: r.id }); }
      } else if (arch === 'ELDER_ARCHIVE' || arch === 'LIBRARY') {
        const shelfKind = (thKey === 'ancient' ? 'scrollshelf' : 'bookshelf');
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF(shelfKind, wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1, r.id); }
        if (wallTiles.length > 1) { const wt2 = wallTiles[1]; putF(shelfKind, wt2.x, wt2.y, Math.atan2(-wt2.dx, -wt2.dy), 1, r.id); }
        if (wallTiles.length > 2) {
          const wt3 = wallTiles[2];
          if (thKey === 'ancient') {
            if (rng.chance(0.5)) putF('scrollshelf', wt3.x, wt3.y, Math.atan2(-wt3.dx, -wt3.dy), 1, r.id);
            else placeStudyDesk(wt3);
          } else {
            placeStudyDesk(wt3);
          }
        }
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length / 2)];
          if (thKey === 'ancient') {
            putF('lectern', fit.x, fit.y, rng.i(0, 3) * Math.PI / 2, 1, r.id);
          } else {
            placePlanningTable();
          }
        }
        if (cornerTiles.length > 0) {
          const ct = cornerTiles[0];
          putF(thKey === 'ancient' ? 'grainjars' : 'urn', ct.x, ct.y, rng.f(0, 6.28), 0.95, r.id);
        }
        if (cornerTiles.length > 1 && thKey === 'ancient') {
          const ct2 = cornerTiles[1];
          putF('grainjars', ct2.x, ct2.y, rng.f(0, 6.28), 0.95, r.id);
        }
      } else if (arch === 'SOLAR_OBSERVATORY') {
        /* the observatory's circle has a lectern in it about a third of the time */
        placeMagicCircle(0.35);
        if (wallTiles.length > 0) {
          const wt = wallTiles[0];
          putF('scrollshelf', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1, r.id);
        }
        if (wallTiles.length > 1) {
          const wt2 = wallTiles[1];
          putF('scrollshelf', wt2.x, wt2.y, Math.atan2(-wt2.dx, -wt2.dy), 1, r.id);
        }
        if (cornerTiles.length > 0) {
          const ct = cornerTiles[0];
          putF('brazier', ct.x, ct.y, 0, 1, r.id);
        }
        if (cornerTiles.length > 1) {
          const ct2 = cornerTiles[1];
          putF('grainjars', ct2.x, ct2.y, rng.f(0, 6.28), 0.95, r.id);
        }
      } else if (arch === 'FROZEN_LAB' || arch === 'ALCHEMY_LAB') {
        placeMagicCircle(0.25);
        if (wallTiles.length > 0) {
          placeStudyDesk(wallTiles[0]);
        }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('brazier', ct.x, ct.y, 0, 1, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('barrel', ct2.x, ct2.y, rng.f(0, 6.28), 1, r.id); }
      } else if (arch === 'ASHEN_GUARDHOUSE' || arch === 'GUARD_ROOM') {
        placePlanningTable();
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('barrel', ct.x, ct.y, rng.f(0, 6.28), 1, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('crate', ct2.x, ct2.y, rng.f(0, 6.28), 1, r.id); }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; props.push({ kind: 'tapestry', x: wt.x, y: wt.y, dx: wt.dx, dy: wt.dy, rot: 0, scale: 1, roomId: r.id }); }
      } else if (arch === 'RELIQUARY_VAULT' || arch === 'REL IQUARY_VAULT' || arch === 'SANCTUM') {
        if (wallTiles.length > 0) {
          const wt = wallTiles[0];
          if (thKey === 'ancient' && (r.type === TYPE.BOSS || rng.chance(0.35))) {
            putF('throne', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1.3, r.id);
          } else {
            putF('altarTable', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1.1, r.id);
            put('candle', wt.x, wt.y, rng.f(0, 6.28), 1.0, r.id, 0.65); // Sits ON TOP of altar
          }
        }
        if (freeInterior.length > 0 && r.type !== TYPE.BOSS && r.type !== TYPE.SHRINE) {
          const fit = freeInterior[Math.floor(freeInterior.length / 2)];
          if (thKey === 'ancient' && rng.chance(0.5)) {
            putF('lectern', fit.x, fit.y, rng.f(0, 6.28), 1, r.id);
          }
        }
        if (wallTiles.length > 1) {
          const wt = wallTiles[1];
          if (thKey === 'ancient' && rng.chance(0.6)) putF('scrollshelf', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1, r.id);
          else props.push({ kind: 'sconce', x: wt.x, y: wt.y, dx: wt.dx, dy: wt.dy, rot: 0, scale: 1, roomId: r.id });
        }
        if (cornerTiles.length > 0 && thKey === 'ancient') {
          const ct = cornerTiles[0];
          putF(rng.chance(0.5) ? 'grainjars' : 'vase', ct.x, ct.y, rng.f(0, 6.28), 0.95, r.id);
        }
        if (cornerTiles.length > 1 && thKey === 'ancient' && rng.chance(0.45)) {
          const ct2 = cornerTiles[1];
          putF(rng.chance(0.5) ? 'cage' : 'cage2', ct2.x, ct2.y, rng.f(0, 6.28), 1.0, r.id);
        }
      } else if (arch === 'TREASURY') {
        // Corner wealth clutter: stacked crates, barrels, jars, urns, and gleaming gold bullion
        const cornerClutter = ['crate', 'barrel', 'urn', 'grainjars', 'goldBullion'];
        for (let i = 0; i < Math.min(cornerTiles.length, 4); i++) {
          const ct = cornerTiles[i];
          const kind = cornerClutter[i % cornerClutter.length];
          putF(kind, ct.x, ct.y, rng.f(0, 6.28), 1.0, r.id);
        }
        // Wall vault decor: weapon/shield racks, banners, and gold bullion stacks
        if (wallTiles.length > 0) {
          const wt = wallTiles[0];
          putF('weaponRack', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1, r.id);
        }
        if (wallTiles.length > 1) {
          const wt2 = wallTiles[1];
          putF(rng.chance(0.65) ? 'goldBullion' : 'crate', wt2.x, wt2.y, rng.f(0, 6.28), 1.0, r.id);
        }
        if (wallTiles.length > 2) {
          const wt3 = wallTiles[2];
          props.push({ kind: 'banner', x: wt3.x, y: wt3.y, dx: wt3.dx, dy: wt3.dy, rot: 0, scale: 1, roomId: r.id });
        }
        // Flank central chest with gleaming gold bullion pyramids and treasure urns
        if (r.type === TYPE.TREASURE) {
          const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          for (const [ox, oy] of offsets) {
            const fx = r.cx + ox, fy = r.cy + oy;
            const fc = idx(fx, fy);
            if (inB(fx, fy) && grid[fc] === FLOOR && !occ[fc] && !nearDoor(fx, fy, 1)) {
              if (rng.chance(0.65)) {
                const wealthProp = rng.chance(0.65) ? 'goldBullion' : (rng.chance(0.5) ? 'urn' : 'grainjars');
                putF(wealthProp, fx, fy, rng.f(0, 6.28), 1.0, r.id);
              }
            }
          }
        } else if (freeInterior.length > 0) {
          // If a non-treasure room generates as TREASURY archetype, it gets a single chest
          const fit = freeInterior[Math.floor(freeInterior.length / 2)];
          putF('chest', fit.x, fit.y, 0, 1.2, r.id);
        }
      }

      if (wallTiles.length > 2 && rng.chance(0.65 * dmul('sconces'))) {
        const wt = wallTiles[2];
        props.push({ kind: 'sconce', x: wt.x, y: wt.y, dx: wt.dx, dy: wt.dy, rot: 0, scale: 1, roomId: r.id });
      }

      /* decor.furniture above 1 sprinkles generic clutter onto the tiles the
         archetype pass left empty, so "more furniture" is available as well as
         less, without every room repeating its archetype's exact set. */
      const extraFurn = dmul('furniture') - 1;
      if (extraFurn > 0) {
        const pick = a => a[rng.i(0, a.length - 1)];
        /* per-tile rates kept low: an archetype only places a handful of pieces,
           so filling every free tile would be orders of magnitude more, not "a
           bit more". At the 2.0 end this lands around 3x the designed clutter. */
        const sprinkle = (tiles, kinds, faceWall, rate) => {
          for (const t of tiles) {
            if (occ[idx(t.x, t.y)] || !rng.chance(extraFurn * rate)) continue;
            const rot = faceWall ? Math.atan2(-t.dx, -t.dy) : rng.i(0, 3) * (Math.PI / 2);
            put(pick(kinds), t.x, t.y, rot, 1, r.id);
          }
        };
        sprinkle(cornerTiles, ['barrel', 'crate', 'urn'], false, 0.10);
        // Wall furniture sits against walls facing the room (including benches and chairs):
        sprinkle(wallTiles, ['bookshelf', 'weaponRack', 'bench', 'chair'], true, 0.08);
        // Free interior never gets random lone chairs scattered in open space
      }
    }

    if (r.type === TYPE.COMBAT || r.type === TYPE.ELITE || r.type === TYPE.BOSS) {
      const SB = SPAWN_BUDGET;
      /* Depth axis: r.difficulty only ranks rooms WITHIN a floor, so without
         this a level-1 dungeon's back rooms were as packed as a level-20 one's. */
      const budget = roomSpawnBudget(r.type, r.difficulty, params.threatMult || 1, params.level || 1);
      /* Price against the CR the floor ACTUALLY fields. game.js overrides the
         generator's target CR for every ordinary spawn (crForDungeonLevel), so
         deep rooms were paying tier-5 prices for tier-1 monsters and ended up
         emptier than the entrance. */
      /* Every targetCR this room hands out is snapped onto the theme roster's
         CR ladder. A slot must be priced for a creature that can actually be
         placed — otherwise the purse pays CR-3 money (28) for a slot game.js
         can only fill with a CR-1 (16), and the room quietly comes in light. */
      const crLadder = crLadderFor({ level: params.level || 1, themeKey: params.themeKey });
      const snapCR = c => snapCRToLadder(c, crLadder);

      const naturalCR = snapCR(baseCrForDungeonLevel(params.level || 1));
      /* Global ceiling, tightened by the level curve so early floors stay small
         even in themed rooms that build fixed squads. */
      const sbData = getSpawnBudget();
      const MAX_SPAWNS = roomSpawnCap(params.level || 1, sbData);

      /* CR offsets for themed squads. These replace the old ±1 tier math: a
         band step is roughly ×1.5 CR (up) or ×0.6 (down), clamped to a sane
         floor so a level-1 dungeon never fields a CR-3 miniboss. */
      const stepUp = cr => snapCR(Math.max(0.25, cr * 1.5));
      const stepDown = cr => snapCR(Math.max(0.125, cr * 0.6));
      const swarmCR = snapCR(0.25);

      const spawnSpecs = [];
      if (r.roomStyle === 'swarm') {
        /* Unified horde: every body shares one target CR, so the game's
           room-lock resolves all slots to the same species (ten grey rats, not
           a menagerie). Infestations bypass the standard level spawnCap to field
           a true horde, spending their purse on cheap minions up to hordeMaxSpawns. */
        const hordeCap = sbData.hordeMaxSpawns ?? 18;
        let swarmSpeciesCR = crLadder[0];
        for (const c of crLadder) {
          if (hordeCap * crToCost(c) <= budget) swarmSpeciesCR = c; else break;
        }
        const count = Math.min(hordeCap, Math.floor(budget / crToCost(swarmSpeciesCR)));
        for (let i = 0; i < count; i++) {
          spawnSpecs.push({ targetCR: swarmSpeciesCR, role: 'minion', fixedCR: true });
        }
      } else if (r.roomStyle === 'miniboss') {
        spawnSpecs.push({ targetCR: stepUp(naturalCR), role: 'miniboss', crOffset: 1 });
        const guardCount = rng.i(3, 5);
        for (let i = 0; i < guardCount; i++) {
          spawnSpecs.push({ targetCR: stepDown(naturalCR), role: 'guard', crOffset: -1 });
        }
      } else if (r.roomStyle === 'ritual') {
        const casterCount = rng.i(1, 2);
        for (let i = 0; i < casterCount; i++) {
          spawnSpecs.push({ targetCR: naturalCR, role: 'caster', crOffset: 0 });
        }
        const zealotCount = rng.i(3, 4);
        for (let i = 0; i < zealotCount; i++) {
          spawnSpecs.push({ targetCR: naturalCR, role: 'melee', crOffset: 0 });
        }
      } else if (r.roomStyle === 'ambush') {
        const count = rng.i(4, 6);
        for (let i = 0; i < count; i++) {
          spawnSpecs.push({ targetCR: naturalCR, role: 'ambush', crOffset: 0 });
        }
      } else if (r.roomStyle === 'killzone') {
        for (let i = 0; i < 2; i++) {
          spawnSpecs.push({ targetCR: naturalCR, role: 'tank', crOffset: 0 });
        }
        const sniperCount = rng.i(3, 4);
        for (let i = 0; i < sniperCount; i++) {
          spawnSpecs.push({ targetCR: naturalCR, role: 'ranged', crOffset: 0 });
        }
      } else if (r.roomStyle === 'nest') {
        /* Brood nest: queen + hatchling swarm. Bypasses standard room spawnCap
           so the queen is accompanied by a full brood within the room's threat budget. */
        const queenCR = stepUp(naturalCR);
        spawnSpecs.push({ targetCR: queenCR, role: 'boss', crOffset: 1 });
        const hordeCap = sbData.hordeMaxSpawns ?? 18;
        const remBudget = Math.max(0, budget - crToCost(queenCR));
        const hatchlingCount = Math.min(hordeCap - 1, Math.max(3, Math.floor(remBudget / crToCost(swarmCR))));
        for (let i = 0; i < hatchlingCount; i++) {
          spawnSpecs.push({ targetCR: swarmCR, role: 'minion', fixedCR: true });
        }
      } else if (r.roomStyle === 'juggernaut') {
        const tankCR = stepUp(naturalCR);
        spawnSpecs.push({ targetCR: tankCR, role: 'tank', crOffset: 1 });
        spawnSpecs.push({ targetCR: tankCR, role: 'tank', crOffset: 1 });
      } else if (r.roomStyle === 'duelists') {
        const champCR = stepUp(naturalCR);
        spawnSpecs.push({ targetCR: champCR, role: 'boss', crOffset: 1 });
        spawnSpecs.push({ targetCR: champCR, role: 'boss', crOffset: 1 });
      } else if (r.roomStyle === 'necromantic') {
        spawnSpecs.push({ targetCR: naturalCR, role: 'caster', crOffset: 0 });
        const minionCount = rng.i(4, 6);
        for (let i = 0; i < minionCount; i++) {
          spawnSpecs.push({ targetCR: stepDown(naturalCR), role: 'minion', crOffset: -1 });
        }
      } else {
        /* Buy monsters at the level's going rate until the purse is spent or the
           cap is hit — the shared loop steps down the CR ladder rather than
           giving up on the first roll it can't afford, so a room lands close to
           its budget. Room depth shows up purely as a bigger budget, which is
           what makes the back of a floor a heavier fight than its entrance. */
        const { crs } = buyRoomSpawns({
          level: params.level || 1, budget, cap: MAX_SPAWNS, rng: rng.raw,
          availableCRs: params.availableCRs || crLadder,
          data: sbData
        });
        for (const c of crs) spawnSpecs.push({ targetCR: c, role: null });
      }

      /* Themed rooms build fixed squads (a miniboss + 5 guards, a queen + a
         brood) that ignore the budget loop, so the cap is enforced here too.
         Every style pushes its leaders first — trimming the tail thins the
         escort rather than decapitating the room.
         Infestation (swarm) and Brood Nest (nest) bypass the standard level
         spawnCap to field a true horde, using hordeMaxSpawns instead. */
      const isHorde = r.roomStyle === 'swarm' || r.roomStyle === 'nest';
      const effectiveCap = isHorde ? (sbData.hordeMaxSpawns ?? 18) : MAX_SPAWNS;
      if (spawnSpecs.length > effectiveCap) spawnSpecs.length = effectiveCap;

      /* Gather all valid candidate floor cells in room r and compute distance
         from any doorway cell, so monsters spawn away from doorways. */
      const xMin = Math.max(1, Math.floor(r.cx - r.w / 2) + 1);
      const xMax = Math.min(W - 2, Math.ceil(r.cx + r.w / 2) - 1);
      const yMin = Math.max(1, Math.floor(r.cy - r.h / 2) + 1);
      const yMax = Math.min(H - 2, Math.ceil(r.cy + r.h / 2) - 1);

      const roomCandidates = [];
      for (let cy = yMin; cy <= yMax; cy++) {
        for (let cx = xMin; cx <= xMax; cx++) {
          const c = idx(cx, cy);
          if (roomId[c] === r.id && grid[c] === FLOOR && !doorway[c] && !lakeMask[c]) {
            let minDoorDist = 999;
            for (let di = 0; di < doorwayCells.length; di++) {
              const d = doorwayCells[di];
              const dist = Math.hypot(cx - d.x, cy - d.y);
              if (dist < minDoorDist) minDoorDist = dist;
            }
            roomCandidates.push({ x: cx, y: cy, c, dist: minDoorDist });
          }
        }
      }

      for (const spec of spawnSpecs) {
        const available = roomCandidates.filter(k => !occ[k.c]);
        if (!available.length) break;

        let maxDist = 0;
        for (const k of available) {
          if (k.dist > maxDist) maxDist = k.dist;
        }

        /* Monsters spawn deep inside rooms, away from doors. The buffer used to
           be purely RELATIVE to the room's own dimensions (maxDist - 1.5), so a
           cramped room happily placed a monster 1.5 cells from its threshold —
           close enough to open a fight through the doorway with the party still
           on the far side of it.
           So: an absolute floor of DOOR_BUFFER first, and only if no cell in
           the room can manage that do we fall back to the relative rule and
           take the deepest available. */
        const DOOR_BUFFER = 3.0;
        let pool = available.filter(k => k.dist >= DOOR_BUFFER);
        if (!pool.length) {
          const targetMinDist = maxDist >= 3.0 ? Math.max(2.5, maxDist - 1.5) : Math.max(1.5, maxDist - 0.8);
          pool = available.filter(k => k.dist >= targetMinDist);
        }
        if (!pool.length) pool = available;

        const chosen = rng.pick(pool);
        occ[chosen.c] = 1;

        spawns.push({
          x: chosen.x,
          y: chosen.y,
          targetCR: spec.targetCR,
          role: spec.role || undefined,
          roomStyle: r.roomStyle || undefined,
          roomBuff: r.roomStyle === 'arcane_surge' ? 'arcane_surge' : undefined,
          fixedCR: spec.fixedCR || undefined,
          crOffset: spec.crOffset !== undefined ? spec.crOffset : undefined,
          roomId: r.id
        });
      }
    }
  }

  const torchCand = [];
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const c = row + x;
      if (grid[c] !== WALL) continue;
      if (x < W - 1 && grid[c + 1] === FLOOR) torchCand.push({ x, y, dx: 1, dy: 0 });
      else if (x > 0 && grid[c - 1] === FLOOR) torchCand.push({ x, y, dx: -1, dy: 0 });
      else if (y < H - 1 && grid[c + W] === FLOOR) torchCand.push({ x, y, dx: 0, dy: 1 });
      else if (y > 0 && grid[c - W] === FLOOR) torchCand.push({ x, y, dx: 0, dy: -1 });
    }
  }
  for (let i = torchCand.length - 1; i > 0; i--) { const j = rng.i(0, i); const t = torchCand[i]; torchCand[i] = torchCand[j]; torchCand[j] = t; }
  const torches = [];
  for (const c of torchCand) {
    let ok = true;
    for (const t of torches) if (Math.max(Math.abs(t.x - c.x), Math.abs(t.y - c.y)) < 4) { ok = false; break; }
    if (ok) torches.push(c);
  }
  /* a dark room's sconces start unlit (a hero can Kindle them) */
  for (const t of torches) {
    const fr = roomId[(t.y + t.dy) * W + (t.x + t.dx)];
    if (fr >= 0 && rooms[fr] && rooms[fr].dark) t.lit = false;
  }
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const c = row + x;
      if (grid[c] !== FLOOR || occ[c] || doorway[c] || lakeMask[c]) continue;
      const rid = roomId[c];
      const diff = rid >= 0 ? rooms[rid].difficulty : 0.5;
      let p = params.decorDensity * 0.045 * dmul('debris') * (1.25 - 0.6 * diff);
      if (corridor[c]) p *= 0.45;
      if (rng.chance(p)) {
        if (rng.chance(0.35)) {
          props.push({ kind: 'fallenBrick', x, y, rot: rng.f(0, 6.28), scale: rng.f(0.85, 1.2), roomId: rid });
        } else {
          props.push({ kind: 'debris', x, y, rot: rng.f(0, 6.28), scale: rng.f(0.6, 1.35), roomId: rid, v: rng.i(0, 2) });
        }
      } else if (TH.propScatter && !nearDoor(x, y, 1)) {
        for (const k in TH.propScatter) {
          if (k === 'coffin' || k === 'sarco') continue; // Sarcophagi/coffins are strictly placed via architectural passes
          if (rng.chance(TH.propScatter[k] * params.decorDensity * (corridor[c] ? 0.4 : 1))) {
            props.push({ kind: k, x, y, rot: rng.i(0, 3) * (Math.PI / 2), scale: rng.f(0.85, 1.2), roomId: rid });
            break;
          }
        }
      }
    }
  }

  /* -- 7.4c Verdant Dungeon Pool Grass --
     Clusters of wild grass and reeds around water pool edges in Verdant dungeons only. */
  if (thKey === 'verdant') {
    const grassKinds = ['swampgrass', 'swampgrass2', 'swampgrass3'];
    const rate = 0.35 * params.decorDensity;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const c = idx(x, y);
        if (grid[c] !== FLOOR || doorway[c] || occ[c] || nearDoor(x, y, 1)) continue;
        let nearWater = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nc = idx(x + dx, y + dy);
            if (grid[nc] === POOL) nearWater = true;
          }
        }
        if (nearWater && rng.chance(rate)) {
          const roll = rng.raw();
          const count = roll < 0.35 ? 2 : (roll < 0.80 ? 3 : 4);
          for (let s = 0; s < count; s++) {
            const kind = grassKinds[rng.i(0, grassKinds.length - 1)];
            const angle = (s * (Math.PI * 2 / count)) + rng.f(-0.35, 0.35);
            const dist = count <= 2 ? rng.f(0.06, 0.20) : rng.f(0.12, 0.28);
            props.push({ kind, x: x + Math.cos(angle) * dist, y: y + Math.sin(angle) * dist, rot: rng.f(0, 6.28), scale: rng.f(0.85, 1.25), roomId: roomId[c] ?? 0 });
          }
        }
      }
    }
  }

  /* -- 7.4b Room & Corridor Corner Rubble Sweep --
     Places authentic wall-textured masonry rubble in 90-degree inner corners. */
  for (let y = 1; y < H - 1; y++) {
    const row = y * W;
    for (let x = 1; x < W - 1; x++) {
      const c = row + x;
      if (grid[c] !== FLOOR || occ[c] || doorway[c] || lakeMask[c] || nearDoor(x, y, 1)) continue;
      const rid = roomId[c];
      const wL = (grid[c - 1] === WALL);
      const wR = (grid[c + 1] === WALL);
      const wU = (grid[c - W] === WALL);
      const wD = (grid[c + W] === WALL);

      let cornerDx = 0, cornerDy = 0, baseRot = 0;
      if (wL && wU && grid[c - W - 1] === WALL) { cornerDx = -1; cornerDy = -1; baseRot = 0; }
      else if (wR && wU && grid[c - W + 1] === WALL) { cornerDx = 1; cornerDy = -1; baseRot = -Math.PI / 2; }
      else if (wR && wD && grid[c + W + 1] === WALL) { cornerDx = 1; cornerDy = 1; baseRot = Math.PI; }
      else if (wL && wD && grid[c + W - 1] === WALL) { cornerDx = -1; cornerDy = 1; baseRot = Math.PI / 2; }

      if (cornerDx !== 0 && cornerDy !== 0) {
        const isAncient = (thKey === 'ancient');
        const cornerChance = (isAncient ? 0.75 : 0.52) * params.decorDensity * dmul('debris') * (corridor[c] ? 0.6 : 1.0);
        if (rng.chance(cornerChance)) {
          const offDist = 0.28;
          const px = x + cornerDx * offDist;
          const py = y + cornerDy * offDist;
          const rotJitter = rng.f(-0.20, 0.20);
          const scale = rng.f(0.85, 1.25);
          const variant = rng.i(0, 3);
          props.push({
            kind: 'cornerRubble',
            x: px,
            y: py,
            dx: cornerDx,
            dy: cornerDy,
            rot: baseRot + rotJitter,
            scale,
            v: variant,
            roomId: rid
          });
          occ[c] = 1;
        }
      }
    }
  }

  /* -- 7.5 theme prop sweeps -- */
  const floorDir = (x, y) => {
    const c = idx(x, y);
    if (x < W - 1 && grid[c + 1] === FLOOR) return [1, 0];
    if (x > 0 && grid[c - 1] === FLOOR) return [-1, 0];
    if (y < H - 1 && grid[c + W] === FLOOR) return [0, 1];
    if (y > 0 && grid[c - W] === FLOOR) return [0, -1];
    return null;
  };
  /* The `|| DEC.x` arms let the editor's decor sliders switch a sweep on for a
     theme that wouldn't otherwise run it. Untouched sliders leave DEC.x
     undefined, so the theme's own rules still decide. */
  if (TH.icicles || DEC.icicles) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (grid[idx(x, y)] !== WALL) continue;
      const d = floorDir(x, y);
      if (d && rng.chance((0.06 + 0.08 * params.decorDensity) * dmul('icicles')))
        props.push({ kind: 'icicle', x, y, dx: d[0], dy: d[1], rot: rng.f(0, 6.28), scale: rng.f(0.7, 1.3) });
    }
    /* Ice shards grow anywhere on open floor, not just on the frozen lakes —
       those just stay the densest spot. Each hit drops a cluster of 1-3 with
       independent sizes and sub-tile offsets, so they read as a shattered heap
       rather than one shard centred in every cell. */
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = idx(x, y);
      if (grid[c] !== FLOOR || occ[c] || doorway[c]) continue;
      const p = (lakeMask[c] ? 0.05 : 0.014) * params.decorDensity * dmul('icicles');
      if (!rng.chance(p)) continue;
      const rv = rng.raw();
      const n = rv < 0.5 ? 1 : (rv < 0.82 ? 2 : 3);
      const rid = roomId[c];
      for (let s = 0; s < n; s++) {
        const lead = s === 0;
        props.push({
          kind: 'shardIce', x, y,
          ox: lead ? rng.f(-0.14, 0.14) : rng.f(-0.34, 0.34),
          oz: lead ? rng.f(-0.14, 0.14) : rng.f(-0.34, 0.34),
          rot: rng.f(0, 6.28),
          scale: lead ? rng.f(0.55, 1.65) : rng.f(0.3, 0.9),
          roomId: rid
        });
      }
    }
  }
  const mossMask = new Uint8Array(W * H);
  if (TH.roots) {
    const sites = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (grid[idx(x, y)] !== WALL) continue;
      const d = floorDir(x, y);
      if (d && roomId[idx(x + d[0], y + d[1])] >= 0) sites.push({ x, y, dx: d[0], dy: d[1] });
    }
    for (let i = sites.length - 1; i > 0; i--) { const j = rng.i(0, i); const t = sites[i]; sites[i] = sites[j]; sites[j] = t; }
    const breaches = [];
    for (const s of sites) {
      if (breaches.length >= 5) break;
      let close = false;
      for (const b of breaches) if (Math.max(Math.abs(b.x - s.x), Math.abs(b.y - s.y)) < 7) { close = true; break; }
      if (!close) breaches.push(s);
    }
    for (const b of breaches) {
      props.push({ kind: 'roots', x: b.x, y: b.y, dx: b.dx, dy: b.dy, rot: 0, scale: rng.f(0.9, 1.2) });
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
        const nx = b.x + ox, ny = b.y + oy;
        if (!inB(nx, ny)) continue;
        const c = idx(nx, ny);
        if (grid[c] === FLOOR && !mossMask[c] && rng.chance(0.75)) {
          mossMask[c] = 1; props.push({ kind: 'moss', x: nx, y: ny, rot: rng.f(0, 6.28), scale: rng.f(0.7, 1.4) });
        }
      }
    }
  }
  /* Wall-fringe moss: its own sweep, so raising the slider grows moss on any
     theme rather than only the root-breached ones. */
  if (TH.roots || DEC.moss) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = idx(x, y);
      if (grid[c] !== FLOOR || mossMask[c] || lakeMask[c]) continue;
      let nw = 0;
      if (x < W - 1 && grid[c + 1] === WALL) nw++; if (x > 0 && grid[c - 1] === WALL) nw++;
      if (y < H - 1 && grid[c + W] === WALL) nw++; if (y > 0 && grid[c - W] === WALL) nw++;
      if (nw > 0 && rng.chance(0.12 * params.decorDensity * dmul('moss'))) {
        mossMask[c] = 1; props.push({ kind: 'moss', x, y, rot: rng.f(0, 6.28), scale: rng.f(0.6, 1.3) });
      }
    }
  }
  if (TH.bones || thKey === 'grim' || thKey === 'ancient') {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = idx(x, y);
      if (grid[c] !== FLOOR || occ[c] || doorway[c]) continue;
      const rid = roomId[c];
      if (rid >= 0) {
        const r = rooms[rid];
        const isCryptRoom = r && (r.grave || r.type === TYPE.BOSS || thKey === 'grim');
        const pChance = (isCryptRoom ? (0.05 + 0.04 * params.decorDensity) : (0.018 + 0.02 * params.decorDensity)) * dmul('bones');
        if (rng.chance(pChance)) {
          const rv = rng.raw();
          let bKind;
          if ((thKey === 'ancient' || thKey === 'grim') && rv < 0.12) {
            bKind = rng.chance(0.5) ? 'cage' : 'cage2';
          } else if (rv < 0.40) {
            bKind = 'skull';
          } else if (rv < 0.68) {
            bKind = 'bonePile';
          } else if (rv < 0.86) {
            bKind = 'skeleton';
          } else {
            bKind = 'bones';
          }
          props.push({ kind: bKind, x, y, rot: rng.f(0, 6.28), scale: rng.f(0.85, 1.25), roomId: rid });
        }
      }
    }
  }
  /* Spiderweb corner sweep. Anchored on FLOOR cells that have walls on two
     perpendicular sides — an inside corner — because that is the only place the
     web geometry has two faces to span. dx/dy point at those two walls; the
     renderer hangs the fan off the post where they meet. Corners are far rarer
     than wall tiles, so the per-site chance is correspondingly higher. */
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const c = idx(x, y);
    if (grid[c] !== FLOOR || doorway[c] || lakeMask[c]) continue;
    const rid = roomId[c];
    if (rid < 0) continue;
    const r = rooms[rid];
    const isWebby = r && (r.grave || thKey === 'grim' || thKey === 'ancient' ||
      thKey === 'verdant' || DEC.webs);
    if (!isWebby) continue;
    const sx = grid[c + 1] === WALL ? 1 : (grid[c - 1] === WALL ? -1 : 0);
    const sy = grid[c + W] === WALL ? 1 : (grid[c - W] === WALL ? -1 : 0);
    if (!sx || !sy) continue;
    if (rng.chance(0.5 * params.decorDensity * dmul('webs')))
      props.push({
        kind: 'spiderWeb', x, y, dx: sx, dy: sy, rot: 0,
        scale: rng.f(0.85, 1.05), roomId: rid
      });
  }

  /* Cut-out wall ossuary niches for Grim crypts & catacombs */
  if (thKey === 'grim' || TH.bones) {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const c = idx(x, y);
      if (grid[c] !== FLOOR || occ[c] || doorway[c] || lakeMask[c]) continue;
      const rid = roomId[c];
      // Check if adjacent to exactly 1 wall
      let wdx = 0, wdy = 0, wc = 0;
      if (grid[c + 1] === WALL) { wdx = 1; wc++; }
      if (grid[c - 1] === WALL) { wdx = -1; wc++; }
      if (grid[c + W] === WALL) { wdy = 1; wc++; }
      if (grid[c - W] === WALL) { wdy = -1; wc++; }
      if (wc === 1) {
        const isCorridor = corridor[c];
        const isCrypt = rid >= 0 && (rooms[rid]?.grave || thKey === 'grim');
        const chance = (isCorridor ? 0.09 : (isCrypt ? 0.07 : 0.02)) * params.decorDensity;
        if (rng.chance(chance)) {
          props.push({ kind: 'ossuaryWall', x, y, dx: wdx, dy: wdy, rot: 0, scale: 1, roomId: rid });
          occ[c] = 1;
        }
      }
    }
  }

  /* Norse & Barbarian prop scatter for Frost theme */
  if (thKey === 'frost') {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const c = idx(x, y);
      if (grid[c] !== FLOOR || occ[c] || doorway[c] || lakeMask[c]) continue;
      const rid = roomId[c];
      let wdx = 0, wdy = 0, wc = 0;
      if (grid[c + 1] === WALL) { wdx = 1; wc++; }
      if (grid[c - 1] === WALL) { wdx = -1; wc++; }
      if (grid[c + W] === WALL) { wdy = 1; wc++; }
      if (grid[c - W] === WALL) { wdy = -1; wc++; }

      if (wc === 1 && rng.chance(0.04 * params.decorDensity)) {
        const pick = rng.pick(['shieldRack', 'mammothTusks', 'runicObelisk']);
        props.push({ kind: pick, x, y, rot: Math.atan2(wdx, wdy), scale: rng.f(0.9, 1.1), roomId: rid });
        occ[c] = 1;
      } else if (wc >= 2 && rng.chance(0.06 * params.decorDensity)) {
        const pick = rng.pick(['glacialSpire', 'boneTotem']);
        props.push({ kind: pick, x, y, rot: rng.f(0, 6.28), scale: rng.f(0.9, 1.15), roomId: rid });
        occ[c] = 1;
      }
    }
  }
  {
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (TH.pools && (TH.pools.mode === 0 || TH.pools.mode === 3)) {
      const pv = TH.pools.mode === 0 ? 0.8 : 0.45;
      for (const p of pools)
        for (const [dx, dy] of DIRS) {
          const nx = p.x + dx, ny = p.y + dy;
          if (!inB(nx, ny) || grid[idx(nx, ny)] !== FLOOR) continue;
          if (rng.chance(pv))
            props.push({ kind: 'crack', x: nx, y: ny, dx, dy, rot: rng.f(0, 6.28), scale: rng.f(0.9, 1.5) });
        }
    }
    if (TH.lakes) {
      for (const lc of lakeCells)
        for (const [dx, dy] of DIRS) {
          const nx = lc.x + dx, ny = lc.y + dy;
          if (!inB(nx, ny)) continue;
          const c2 = idx(nx, ny);
          if (grid[c2] !== FLOOR || lakeMask[c2]) continue;
          if (rng.chance(0.3))
            props.push({ kind: 'crack', x: nx, y: ny, dx, dy, rot: rng.f(0, 6.28), scale: rng.f(0.7, 1.2), ice: 1 });
        }
    }
  }
  for (const r of rooms) {
    if (r.type !== TYPE.ELITE && r.type !== TYPE.BOSS) continue;
    const cand = [];
    for (let y = Math.floor(r.cy - r.h / 2) - 1; y <= Math.ceil(r.cy + r.h / 2) + 1; y++)
      for (let x = Math.floor(r.cx - r.w / 2) - 1; x <= Math.ceil(r.cx + r.w / 2) + 1; x++) {
        if (!inB(x, y) || grid[idx(x, y)] !== WALL) continue;
        const d = floorDir(x, y);
        if (d && roomId[idx(x + d[0], y + d[1])] === r.id) cand.push({ x, y, dx: d[0], dy: d[1] });
      }
    for (let i = cand.length - 1; i > 0; i--) { const j = rng.i(0, i); const t = cand[i]; cand[i] = cand[j]; cand[j] = t; }
    const placed = [];
    for (const s of cand) {
      if (placed.length >= (r.type === TYPE.BOSS ? 4 : 2)) break;
      let close = false;
      for (const p of placed) if (Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) < 4) { close = true; break; }
      if (!close) { placed.push(s); props.push({ kind: 'banner', x: s.x, y: s.y, dx: s.dx, dy: s.dy, rot: 0, scale: 1 }); }
    }
  }

  if (thKey === 'molten') {
    for (const r of rooms) {
      const cand = [];
      for (let y = Math.floor(r.cy - r.h / 2) - 1; y <= Math.ceil(r.cy + r.h / 2) + 1; y++)
        for (let x = Math.floor(r.cx - r.w / 2) - 1; x <= Math.ceil(r.cx + r.w / 2) + 1; x++) {
          if (!inB(x, y) || grid[idx(x, y)] !== WALL) continue;
          const d = floorDir(x, y);
          if (d && roomId[idx(x + d[0], y + d[1])] === r.id) cand.push({ x, y, dx: d[0], dy: d[1] });
        }
      for (let i = cand.length - 1; i > 0; i--) { const j = rng.i(0, i); const t = cand[i]; cand[i] = cand[j]; cand[j] = t; }
      const maxChains = r.type === TYPE.BOSS ? 4 : (rng.chance(0.65) ? rng.i(1, 2) : 0);
      const placedChains = [];
      for (const s of cand) {
        if (placedChains.length >= maxChains) break;
        let close = false;
        for (const p of placedChains) if (Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) < 3) { close = true; break; }
        if (!close) {
          placedChains.push(s);
          props.push({ kind: 'hangingChains', x: s.x, y: s.y, dx: s.dx, dy: s.dy, rot: 0, scale: 1, roomId: r.id });
        }
      }
    }
  }

  const loops = edges.filter(e => e.isLoop).length;

  /* Terrain elevation, last: buildElevation needs the FINAL walkable set, so it
     runs after every carving pass (pools, pits, doorway widening) and after
     props — props read their Y from the cell they stand on, so anything on a
     dais rides up with it without extra bookkeeping. */
  const { height, ramp, features: elevationFeatures } =
    buildElevation({
      W, H, grid, roomId, corridor, doorway, rooms, params, lakeMask, props,
      /* So stair carving sees a prop's whole footprint, not just the tile
         it is centred on. Passed in rather than imported: pathfinding.js
         already imports elevation.js, and importing back would close the
         cycle. */
      footprintCells: getPropFootprintCells,
      /* And which of those footprints pathfinding will treat as a
         wall, so terrain is planned around them instead of being
         repaired later by deleting them. */
      isSolidProp: pr => !!pr && SOLID_PROP_KINDS.has(pr.kind)
        && !(pr.podium && PODIUM_PROP_KINDS.has(pr.kind))
    }, rng);

  /* A candle set on a sarcophagus lid, table or pillar top (oy) needs that host to
     still be under it. put() can refuse the sarcophagus (the 4.5-tile spacing
     rule) and buildElevation deletes a prop standing on a stair site, and
     both left the candle hanging at lid height over bare floor. Such a
     candle comes down to the floor, so the room keeps its light. */
  const CANDLE_HOSTS = new Set(['sarco', 'coffin', 'pillar', 'altarTable', 'table']);
  for (const c of props) {
    if (c.kind !== 'candle' || !(c.oy > 0.3)) continue;
    const cell = idx(Math.round(c.x), Math.round(c.y));
    if (!props.some(h => CANDLE_HOSTS.has(h.kind) && getPropFootprintCells(h, W, H).includes(cell))) c.oy = 0;
  }

  /* Intelligent ceremonial carpet pass:
     Places carpets only on completely flat ground (no steps, no ramps),
     guarantees clearance from all pillars and architectural obstructions,
     and positions them beneath or before relevant focal furniture. */
  placeCeremonialCarpets({ W, H, grid, roomId, rooms, props, height, ramp, rng, themeKey: params.themeKey, doorway });

  /* after buildElevation, which can delete a shrine standing on a stair site */
  chooseLightShrine(props, seed);

  return {
    valid, params, seed, name: dungeonName(rng, TH), themeKey: params.themeKey,
    W, H, grid, roomId, corridor, doorway, bfs, maxBfs,
    height, ramp, elevationFeatures,
    rooms, edges, entrance, boss, maxDepth,
    props, spawns, torches, pools, lakeCells, lakeMask, arches,
    stats: { rooms: N, edges: edges.length, loops, critLen, floorTiles: floorTotal, reach, genMs: 0, attempts: 1 }
  };
}

/**
 * Intelligent carpet placement pass:
 * Ensures red carpets only spawn on completely flat ground (no height changes, no ramps),
 * with guaranteed clearance from all pillars and architectural obstructions, and
 * specifically placed beneath or before relevant focal furniture (planning tables,
 * study desks, scripture lecterns, and ceremonial altars).
 */
function placeCeremonialCarpets({ W, H, grid, roomId, rooms, props, height, ramp, rng, themeKey, doorway }) {
  const isCarpetFootprintValid = (cx, cy, rot, roomIdVal) => {
    if (cx < 2 || cx >= W - 2 || cy < 2 || cy >= H - 2) return false;
    const cCenter = cy * W + cx;
    if (roomId[cCenter] !== roomIdVal || grid[cCenter] !== FLOOR) return false;
    if (ramp && ramp[cCenter] !== 0) return false;
    const baseH = height ? height[cCenter] : 0;

    // A rug plane (GEO.rug: 2.2 x 1.4) extends ~1.2 tiles along major axis and ~0.8 along minor axis.
    // Check all tiles in the 3x3 footprint to ensure complete elevation uniformity and clearance.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= W || y < 0 || y >= H) return false;
        const c = y * W + x;
        // Must belong to the exact same room
        if (roomId[c] !== roomIdVal) return false;
        // Must be plain walkable floor
        if (grid[c] !== FLOOR) return false;
        // Must not be a doorway or doorway apron
        if (doorway && doorway[c]) return false;
        // Must have no ramps / stairs
        if (ramp && ramp[c] !== 0) return false;
        // Must have uniform height across every single tile
        if (height && height[c] !== baseH) return false;
      }
    }

    // Must have clearance from pillars and heavy architecture
    const FORBIDDEN = new Set([
      'pillar', 'pillarA', 'pillarB', 'statue', 'brazier', 'forge', 'hearthPit',
      'cauldron', 'boulderPile', 'stalagmite', 'glacialSpire', 'sporePod', 'megalith',
      'boneTotem', 'sarco', 'tombstone', 'cage', 'cage2', 'magicCircle'
    ]);

    for (const pr of props) {
      if (pr.kind === 'rug') {
        if (Math.hypot(pr.x - cx, pr.y - cy) < 2.2) return false;
      }
      if (FORBIDDEN.has(pr.kind)) {
        if (Math.abs(pr.x - cx) <= 1.45 && Math.abs(pr.y - cy) <= 1.45) {
          return false;
        }
      }
    }

    return true;
  };

  for (const r of rooms) {
    if (r.type === 'entrance') continue;
    let placedInRoom = false;

    // 1. Check for thrones (throne or iceThrone in sanctums, boss rooms, or grand halls)
    const thrones = props.filter(p => (p.kind === 'throne' || p.kind === 'iceThrone') && p.roomId === r.id);
    for (const th of thrones) {
      const rot = th.rot || 0;
      if (isCarpetFootprintValid(th.x, th.y, rot, r.id)) {
        props.push({ kind: 'rug', x: th.x, y: th.y, rot, scale: 1.25, roomId: r.id });
        placedInRoom = true;
        break;
      }
    }
    if (placedInRoom) continue;

    // 2. Check for treasure chest in treasure vaults
    if (r.type === TYPE.TREASURE) {
      const chest = props.find(p => p.kind === 'chest' && p.roomId === r.id);
      if (chest && isCarpetFootprintValid(chest.x, chest.y, chest.rot || 0, r.id)) {
        props.push({ kind: 'rug', x: chest.x, y: chest.y, rot: chest.rot || 0, scale: 1.25, roomId: r.id });
        placedInRoom = true;
      }
    }
    if (placedInRoom) continue;

    // 3. Check for planning tables (table with benches / accessories)
    const tables = props.filter(p => p.kind === 'table' && p.roomId === r.id);
    for (const t of tables) {
      const rot = t.rot || 0;
      if (isCarpetFootprintValid(t.x, t.y, rot, r.id)) {
        props.push({ kind: 'rug', x: t.x, y: t.y, rot, scale: 1.15, roomId: r.id });
        placedInRoom = true;
        break;
      }
    }
    if (placedInRoom) continue;

    // 3. Check for lecterns (scripture stands in ancient archives, observatories, shrines)
    const lecterns = props.filter(p => p.kind === 'lectern' && p.roomId === r.id);
    for (const l of lecterns) {
      if (isCarpetFootprintValid(l.x, l.y, 0, r.id)) {
        props.push({ kind: 'rug', x: l.x, y: l.y, rot: 0, scale: 1.1, roomId: r.id });
        placedInRoom = true;
        break;
      }
    }
    if (placedInRoom) continue;

    // 4. Check for altars (altarTable in reliquary vaults / sanctums / crypts)
    const altars = props.filter(p => p.kind === 'altarTable' && p.roomId === r.id);
    for (const a of altars) {
      const inwardDirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (const [idxStep, idyStep] of inwardDirs) {
        const ax = a.x + idxStep, ay = a.y + idyStep;
        if (isCarpetFootprintValid(ax, ay, 0, r.id)) {
          props.push({ kind: 'rug', x: ax, y: ay, rot: 0, scale: 1.15, roomId: r.id });
          placedInRoom = true;
          break;
        }
      }
      if (placedInRoom) break;
    }
    if (placedInRoom) continue;

    // 4. In ancient theme: Grand pristine room centerpieces
    if (themeKey === 'ancient' && Math.min(r.w, r.h) >= 8 && rng.chance(0.4)) {
      const rot = (r.w >= r.h ? 0 : Math.PI / 2);
      if (isCarpetFootprintValid(r.cx, r.cy, rot, r.id)) {
        props.push({ kind: 'rug', x: r.cx, y: r.cy, rot, scale: 1.15, roomId: r.id });
      }
    }
  }
}

/* Spacing of 'stakes' fence sections laid end to end, in tiles. The model is a
   row of three posts along its local X, ~0.9 tiles long at its scene scale
   (PROP_SCALE_MULTIPLIER.stakes in dungeon_scene.js — keep the two in step).
   rotation.y = rot carries local X to grid (cos rot, -sin rot), so a section
   lined up with direction (dx, dy) takes rot = atan2(-dy, dx). */
const STAKE_SEG = 0.9;

/* The shape of every quest overland floor (overland_prologue.js passes it on;
   the map editor defaults to it): a long narrow RIBBON with one road up its
   length in gentle bends and nine clearings along it (Zenu, 2026-10-27;
   compared in scratch/worldmap_campaign/biomes/ribbon_50x300.png). Widened
   from 50 to 60 so the large arenas (RIBBON_ARENA) fit beside the road
   wherever it swings. It replaced
   portrait maps of 60-78 x 90-120 whose road climbed in side-to-side hauls. */
export const QUEST_OVERLAND_MAP = { mapW: 60, mapH: 300, zones: 9, layout: 'ribbon' };

export function generateOverland(params) {
  const t0 = performance.now();
  const seed = params.seed >>> 0;
  const rng = makeRng(seed);
  const TH = THEMES[params.themeKey] || THEMES.forest;
  const OC = Object.assign({
    edgeMin: 2, edgeRand: 3,
    belt: 0.62, beltLinked: 0.10,
    lone: 0.022,
    copseDiv: 370, copseChance: 0.72,
    /* [minimum verge, ragged extra] in tiles either side of the road */
    roadBand: [2, 2],
    camp: { palisade: true, tents: [4, 6], bones: true },
    ground: { debris: 0.018, moss: 0.05 }
  }, TH.oc || {});
  OC.camp = Object.assign({ palisade: true, tents: [4, 6], bones: true }, (TH.oc && TH.oc.camp) || {});
  OC.ground = Object.assign({ debris: 0.018, moss: 0.05 }, (TH.oc && TH.oc.ground) || {});

  /* layout 'ribbon' (prototype, 2026-10-27): a long narrow map with one road
     running its length in gentle bends, instead of the portrait map's
     side-to-side hauls. It needs far more height than the 120 cap allows. */
  const ribbon = (params.layout || OC.layout) === 'ribbon';
  const W = Math.max(ribbon ? 36 : 48, Math.min(120, params.mapW || 58));
  const H = Math.max(48, Math.min(ribbon ? 320 : 120, params.mapH || 58));
  const total = W * H;
  /* Zone density is set for BATTLEFIELD-sized clearings (radius 8-12), so it is
     far sparser than the old wide-spot-in-the-road zones. Callers that do not
     pass `zones` — every hand-authored story mission — land here, so this
     divisor is what keeps their maps from being wall-to-wall clearing. */
  const zoneTarget = Math.max(4, Math.min(12, params.zones || Math.round(total / 900)));
  const idx = (x, y) => y * W + x;
  const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const hn = (x, y, k) => { const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7 + (seed % 1000) * 0.573) * 43758.5453; return s - Math.floor(s); };

  const rooms = [];
  const addZone = (cx, cy, rad) => rooms.push({
    id: rooms.length, cx, cy, w: rad * 2, h: rad * 2, rad,
    arch: 'm', shape: 'zone', type: TYPE.COMBAT, depth: 0, difficulty: 0.2, degree: 0,
    sx0: cx, sy0: cy
  });
  /* Clearings are BIG — each one is a battlefield you fight across, not a wide
     spot in the road. `minD` is the centre-to-centre spacing the road has to
     deliver to keep open ground between them (roughly two radii plus a march). */
  const ZONE_RAD = [8, 12];
  /* Ribbon arenas sit beside the road and need room for terrain. Two sizes:
     medium (radius 10-13), and large at about twice the area (15-18), which
     about a third of them roll. `off` is how far the centre moves off the
     road, as a fraction of the radius: far enough that the road only skirts
     the arena's edge, never past rad - 2, so it still runs inside it. */
  const RIBBON_ARENA = {
    medium: { rad: [10, 13], off: [0.65, 0.85] },
    large: { rad: [15, 18], off: [0.70, 0.88] }, largeChance: 0.35
  };
  const campRad = Math.min(15, 12 + Math.floor((Math.max(W, H) - 92) / 16));
  const minD = Math.max(30, Math.round(Math.sqrt(total / zoneTarget) * 0.72));

  /* ---- meandering road ----
     Overland maps are a JOURNEY, not a region. The road is a single long
     polyline that wanders from the trailhead at the bottom of the map to the
     enemy camp at the top: a short climb, then a long run left or right, then
     another climb, and so on — irregular leg lengths so it reads as a road
     following the country rather than a switchback ramp.

     Zones are then dropped at even ARC-LENGTH intervals along that polyline, so
     they come one after another down the road however much it wanders, and are
     linked only to their immediate neighbours. Everything more than a few tiles
     off the road is walled off by the corridor mask further down, which is what
     makes the map a long ribbon instead of an open square with a snake on it. */
  const padX = 7, padY = 6;
  const yBot = H - 1 - padY, yTop = campRad + 4;
  /* ribbon: where the road forks below the camp (its spur climbs to the camp) */
  const yBranch = yTop + campRad + 4;
  const vspan = yBot - yTop;

  /* Runs sweep most of the map's width — long hauls with few turns, so the
     road crosses the whole country instead of ping-ponging in one corner. The
     leg count then falls out of how much road is needed to seat every zone at
     comfortable spacing: the climbs only supply `vspan`, and the long runs make
     up the shortfall. That shortfall is what stretches the journey out. */
  const xLo = padX, xHi = W - 1 - padX;
  const runAvg = (xHi - xLo) * 0.74;
  const targetLen = (zoneTarget - 1) * minD * 1.35;
  /* Two stacked runs have to clear each other or the corridors fuse into
     horizontal stripes, so the number of legs is capped by how much height
     each one can be given (LEG_PITCH tiles of climb per leg). Journey maps are
     generated portrait for exactly this reason — height is what buys legs.
     Pitch is set by the CORRIDOR width, not the clearing width: clearings only
     occur at zone points, so a little overlap there is fine (and reads as a
     wide meadow), whereas fused corridors flatten the whole map into stripes. */
  const LEG_PITCH = 17;
  const legRoom = Math.max(3, Math.floor(vspan / LEG_PITCH));
  const legs = Math.max(3, Math.min(7, legRoom, Math.round((targetLen - vspan) / runAvg)));
  const vstep = vspan / legs;

  const road = [];
  if (ribbon) {
    /* Ribbon: one long climb up the map that SNAKES. The road follows a
       sine of irregular wavelength (each half-wave 55-95 tiles, its swing
       re-rolled per half-wave) across most of the map's width, plus a little
       noise so no two curves match; it never turns back down. The clearings
       are pushed off to the side of it further down (ribbon arenas). */
    const xMid = (xLo + xHi) / 2;
    const amp = Math.max(3, (xHi - xLo) / 2 - 3);
    const STEP = 5;
    let theta = rng.f(0, Math.PI * 2), half = rng.f(55, 95), swing = amp * rng.f(0.6, 1);
    let y = yBot, wob = 0;
    const xAt = () => Math.max(xMid - amp, Math.min(xMid + amp, xMid + Math.sin(theta) * swing + wob));
    road.push([xAt(), y]);
    /* The snaking road ends at the BRANCH below the camp; the camp hangs off it
       on a spur and the road carries on off the map (ribbonTail, below). */
    while (y - STEP > yBranch) {
      y -= STEP;
      const before = Math.sin(theta);
      theta += Math.PI * STEP / half;
      /* a new half-wave starts at each zero crossing: fresh length and swing */
      if (Math.sign(Math.sin(theta)) !== Math.sign(before)) { half = rng.f(55, 95); swing = amp * rng.f(0.6, 1); }
      wob = wob * 0.6 + rng.f(-1, 1) * 1.2;
      road.push([xAt(), y]);
    }
    road.push([road[road.length - 1][0], yBranch]);
  } else {
    /* start hard against one side so the first haul crosses the map */
    const startLeft = rng.chance(0.5);
    let x = startLeft ? xLo + rng.i(2, 8) : xHi - rng.i(2, 8);
    let dir = startLeft ? 1 : -1;
    let y = yBot;
    road.push([x, y]);
    for (let l = 0; l < legs; l++) {
      /* climb */
      y = Math.max(yTop, y - vstep * rng.f(0.72, 1.28));
      road.push([x, y]);
      /* long run — turn back early if this side is running out of map */
      let run = runAvg * rng.f(0.65, 1.35);
      const roomR = xHi - x, roomL = x - xLo;
      if (dir > 0 && roomR < run * 0.55) dir = -1;
      else if (dir < 0 && roomL < run * 0.55) dir = 1;
      run = Math.min(run, dir > 0 ? roomR : roomL);
      x += dir * run;
      road.push([x, y]);
      dir = -dir;
    }
    road.push([x, yTop]);              // final climb into the camp
  }

  /* walk the polyline and drop a zone every `step` tiles of travel */
  const zoneArc = [];   // arc length of each zone along the road (ribbon trails follow it)
  const zoneOnRoad = []; // the road point each zone was laid at, before a ribbon arena moves off it
  const roadArc = [0];  // arc length at each road vertex
  for (let i = 1; i < road.length; i++)
    roadArc.push(roadArc[i - 1] + Math.hypot(road[i][0] - road[i - 1][0], road[i][1] - road[i - 1][1]));
  {
    const seg = [];
    let totalLen = 0;
    for (let i = 0; i < road.length - 1; i++) {
      const L = Math.hypot(road[i + 1][0] - road[i][0], road[i + 1][1] - road[i][1]);
      seg.push(L); totalLen += L;
    }
    const at = s => {
      let acc = 0;
      for (let i = 0; i < seg.length; i++) {
        if (acc + seg[i] >= s || i === seg.length - 1) {
          const t = seg[i] > 0 ? Math.min(1, (s - acc) / seg[i]) : 0;
          return [road[i][0] + t * (road[i + 1][0] - road[i][0]),
          road[i][1] + t * (road[i + 1][1] - road[i][1])];
        }
        acc += seg[i];
      }
      return road[road.length - 1];
    };
    for (let i = 0; i < zoneTarget; i++) {
      const last = i === zoneTarget - 1;
      const s = totalLen * (i / (zoneTarget - 1));
      zoneArc.push(s);
      let [px, py] = at(s);
      zoneOnRoad.push([px, py]);
      /* Ribbon arenas: bigger clearings that BULGE off to one side of the road
         rather than sitting on it, so a fight happens in open ground beside the
         track, with room for terrain, and the road skirts the arena's edge.
         The centre is pushed out along the road's normal by 55-75% of the
         radius (so the road still runs inside the clearing), toward whichever
         side has more room. The trailhead and the camp stay on the road. */
      const arena = ribbon && i > 0 && !last;
      const tier = arena ? (rng.chance(RIBBON_ARENA.largeChance) ? RIBBON_ARENA.large : RIBBON_ARENA.medium) : null;
      const rad = last ? campRad : (arena ? rng.i(tier.rad[0], tier.rad[1]) : rng.i(ZONE_RAD[0], ZONE_RAD[1]));
      const pad = rad + 2;
      if (arena) {
        const [ax0, ay0] = at(Math.max(0, s - 4)), [ax1, ay1] = at(Math.min(totalLen, s + 4));
        let nx = -(ay1 - ay0), ny = ax1 - ax0;
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const off = Math.min(rad - 2, rad * rng.f(tier.off[0], tier.off[1]));
        const room = sgn => Math.min(px + sgn * nx * off - pad, W - 1 - pad - (px + sgn * nx * off));
        const side = room(1) === room(-1) ? (rng.chance(0.5) ? 1 : -1) : (room(1) > room(-1) ? 1 : -1);
        px += side * nx * off; py += side * ny * off;
      }
      /* nudge each clearing off the centreline so the road isn't a ruler
         (arenas already sit off it; a nudge back toward the road would undo that) */
      const jx = (last || arena) ? 0 : rng.i(-2, 2), jy = (last || arena) ? 0 : rng.i(-2, 2);
      addZone(
        Math.max(pad, Math.min(W - 1 - pad, Math.round(px) + jx)),
        Math.max(pad, Math.min(H - 1 - pad, Math.round(py) + jy)),
        rad
      );
      if (arena) { const z = rooms[rooms.length - 1]; z.arena = tier === RIBBON_ARENA.large ? 'large' : 'medium'; z.roadX = zoneOnRoad[i][0]; z.roadY = zoneOnRoad[i][1]; }
    }
  }

  /* Ribbon: the boss camp is a Y BRANCH off the road, not its dead end. The
     journey goes on past it, so the road carries on up and off the top edge
     of the map, and the camp sits beside it on a short spur. The road keeps to
     one side of the map and the camp takes the other, so the through road
     never cuts the camp's palisade. The spur is the camp's own trail (its zone
     still meets the road at the branch point, zoneOnRoad). */
  const ribbonTail = [];
  if (ribbon && rooms.length) {
    const camp0 = rooms[rooms.length - 1];
    const [bx, by] = road[road.length - 1];
    const xMid = (xLo + xHi) / 2;
    const roadSide = Math.abs(bx - xMid) > 2 ? Math.sign(bx - xMid) : (rng.chance(0.5) ? 1 : -1);
    camp0.cx = Math.round(xMid - roadSide * (W / 2 - camp0.rad - 3));
    camp0.cy = Math.round(yTop);
    camp0.sx0 = camp0.cx; camp0.sy0 = camp0.cy;
    /* the through road eases across to its edge lane, then climbs off the map */
    const lane = xMid + roadSide * ((xHi - xLo) / 2 - 1);
    for (let y = by - 4, k = 1; y > 0; y -= 4, k++) {
      const t = Math.min(1, k / 5);
      ribbonTail.push([bx + (lane - bx) * (t * t * (3 - 2 * t)), y]);
    }
    ribbonTail.push([lane, 0]);   // right to the top row: the road leaves the map
  }

  const N = rooms.length, entrance = 0, boss = N - 1;
  rooms[entrance].type = TYPE.ENTRANCE;
  rooms[boss].type = TYPE.BOSS;

  /* one edge per step of the journey — no Delaunay, no MST, no loops */
  const edges = [];
  for (let i = 0; i < N - 1; i++) edges.push({ a: i, b: i + 1, isLoop: false, isCritical: true });
  for (const e of edges) { rooms[e.a].degree++; rooms[e.b].degree++; }
  const gAdj = Array.from({ length: N }, () => []);
  edges.forEach((e, i) => { gAdj[e.a].push({ b: e.b, i }); gAdj[e.b].push({ b: e.a, i }); });
  const edgeSet = new Set(edges.map(e => Math.min(e.a, e.b) * 64 + Math.max(e.a, e.b)));

  /* on a path the graph distance from the entrance IS the index, so difficulty
     ramps evenly from the trailhead to the camp */
  const maxDepth = Math.max(1, N - 1);
  rooms.forEach((r, i) => { r.depth = i; r.difficulty = Math.min(1, 0.15 + 0.85 * (i / maxDepth)); });
  rooms[entrance].difficulty = 0; rooms[boss].difficulty = 1;
  rooms.maxDepth = maxDepth;

  /* Place the treasure and shrine by position ALONG the journey. Sorting by
     depth (the old behaviour) would now always pick the zone immediately before
     the camp, since depth is just the index. */
  if (N >= 4) {
    const at = f => Math.max(1, Math.min(N - 2, Math.round((N - 1) * f)));
    const ti = at(0.70 + rng.f(-0.06, 0.06));
    rooms[ti].type = TYPE.TREASURE;
    let si = at(0.40 + rng.f(-0.08, 0.08));
    if (si === ti) si = ti - 1;
    if (si >= 1 && si !== ti) rooms[si].type = TYPE.SHRINE;
  }

  const grid = new Uint8Array(total).fill(FLOOR);
  const roomId = new Int16Array(total);
  const corridor = new Uint8Array(total);
  const doorway = new Uint8Array(total);
  const protect = new Uint8Array(total);
  const palisadeMask = new Uint8Array(total);
  const near1 = new Int16Array(total), bDist = new Float32Array(total);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = idx(x, y);
    let d1 = 1e9, d2 = 1e9, a = -1, b2 = -1;
    for (const r of rooms) {
      const dd = (r.cx - x) * (r.cx - x) + (r.cy - y) * (r.cy - y);
      if (dd < d1) { d2 = d1; b2 = a; d1 = dd; a = r.id; }
      else if (dd < d2) { d2 = dd; b2 = a; }
    }
    roomId[c] = a; near1[c] = b2;
    bDist[c] = Math.sqrt(d2) - Math.sqrt(d1);
  }

  /* `via`: optional waypoints the trail passes through on its way to B (the
     ribbon layout routes each leg through the road's own bends). */
  const stampTrail = (A, B, via = []) => {
    let x = A.cx, y = A.cy, steps = 0;
    const path = [];
    for (const T of [...via, B]) {
      const tx = Math.round(T.cx), ty = Math.round(T.cy);
      while ((x !== tx || y !== ty) && steps++ < 900) {
        path.push([x, y]);
        const dxs = Math.sign(tx - x), dys = Math.sign(ty - y);
        /* random sidesteps roughen the trail; a ribbon's road already bends
           through its waypoints, so it takes far fewer or it reads as jagged */
        if (rng.chance(ribbon ? 0.05 : 0.16) && steps > 2) {
          if (Math.abs(tx - x) >= Math.abs(ty - y)) y = Math.max(2, Math.min(H - 3, y + (rng.chance(0.5) ? 1 : -1)));
          else x = Math.max(2, Math.min(W - 3, x + (rng.chance(0.5) ? 1 : -1)));
        }
        else if (Math.abs(tx - x) >= Math.abs(ty - y)) x += dxs; else y += dys;
      }
    }
    path.push([B.cx, B.cy]);
    const half = path.length / 2;
    path.forEach(([px, py], i) => {
      const own = i < half ? A.id : B.id;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        /* NB: this bounds test read `py+py` until 2026-07-27, so every trail
           cell in the bottom half of the map was skipped — no protect, no
           corridor. The old loop-rich zone graph routed around the damage;
           a single linear path cannot, which is how it finally surfaced. */
        if (!inB(px + ox, py + oy)) continue;
        const c = idx(px + ox, py + oy);
        protect[c] = 1;
        if (Math.abs(ox) + Math.abs(oy) <= 1) { corridor[c] = 1; roomId[c] = own; }
      }
    });
  };
  for (const e of edges) {
    if (!ribbon) { stampTrail(rooms[e.a], rooms[e.b]); continue; }
    /* Ribbon: the trail follows the road from where one zone meets it to where
       the next does, through the road's own bends. Arenas sit beside the road,
       so it must not detour through their centres; their open ground is kept
       by the clearing test in the corridor mask. */
    const via = road.filter((_, i) => roadArc[i] > zoneArc[e.a] + 3 && roadArc[i] < zoneArc[e.b] - 3).map(([cx, cy]) => ({ cx, cy }));
    const onRoad = k => ({ id: k, cx: Math.round(zoneOnRoad[k][0]), cy: Math.round(zoneOnRoad[k][1]) });
    stampTrail(e.a === entrance ? rooms[e.a] : onRoad(e.a), e.b === boss ? rooms[e.b] : onRoad(e.b), via);
  }
  /* Ribbon: the through road past the camp branch, to the top edge. It is
     protected, so the map-edge wall can't close it: it visibly leaves the map.
     Its cells keep their nearest-zone roomId (the camp's). */
  if (ribbon && ribbonTail.length) {
    let [x, y] = road[road.length - 1].map(Math.round);
    for (const [tx0, ty0] of ribbonTail) {
      const tx = Math.round(tx0), ty = Math.round(ty0);
      while (x !== tx || y !== ty) {
        if (Math.abs(tx - x) >= Math.abs(ty - y)) x += Math.sign(tx - x); else y += Math.sign(ty - y);
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          if (!inB(x + ox, y + oy)) continue;
          const c = idx(x + ox, y + oy);
          protect[c] = 1;
          if (Math.abs(ox) + Math.abs(oy) <= 1) corridor[c] = 1;
        }
      }
    }
  }
  for (const r of rooms)
    for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++)
      if (inB(r.cx + ox, r.cy + oy) && ox * ox + oy * oy <= 9) protect[idx(r.cx + ox, r.cy + oy)] = 1;

  const camp = rooms[boss], campR = camp.rad;
  const campD2 = (x, y) => (x - camp.cx) * (x - camp.cx) + (y - camp.cy) * (y - camp.cy);
  const density = Math.max(0.4, Math.min(1.5, params.decorDensity || 1));
  /* Same decor multipliers the dungeon generator uses, so the editor's Scatter
     sliders are not inert out here. Only the kinds an overland map actually
     places respond — see tabScatter, which hides the rest. */
  const DEC = TH.decor || {};
  const dmul = k => (DEC[k] == null ? 1 : DEC[k]);

  /* ---- corridor mask ----
     Distance in tiles from the travelled road: a multi-source BFS out of every
     trail cell and every zone clearing. Anything past the road band becomes
     solid wilderness, which is what makes the map a long ribbon you travel
     along rather than an open square you cross. `roadBand` is [min, ragged]
     per theme — open country (moor, holdfast) gets a wide verge, close country
     (mire, sporewood) gets a tight one. */
  const roadDist = new Int16Array(total).fill(-1);
  {
    const q = new Int32Array(total); let qh = 0, qt = 0;
    /* seeded from the trail CENTRELINE only — seeding whole zone clearings too
       would measure the band from the clearing edge and blow the ribbon out
       into an open field. Clearings are kept open by their own test below. */
    for (let c = 0; c < total; c++) if (corridor[c]) { roadDist[c] = 0; q[qt++] = c; }
    const maxD = 40;
    while (qh < qt) {
      const c = q[qh++], x = c % W, dnext = roadDist[c] + 1;
      if (dnext > maxD) continue;
      let n;
      if (x > 0 && roadDist[n = c - 1] < 0) { roadDist[n] = dnext; q[qt++] = n; }
      if (x < W - 1 && roadDist[n = c + 1] < 0) { roadDist[n] = dnext; q[qt++] = n; }
      if (c >= W && roadDist[n = c - W] < 0) { roadDist[n] = dnext; q[qt++] = n; }
      if (c < total - W && roadDist[n = c + W] < 0) { roadDist[n] = dnext; q[qt++] = n; }
    }
  }
  const [bandMin, bandVar] = OC.roadBand;

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = idx(x, y);
    if (protect[c]) continue;
    if (campD2(x, y) < (campR + 2) * (campR + 2)) continue;
    const zr = rooms[roomId[c]];
    const inZone = zr && (zr.cx - x) * (zr.cx - x) + (zr.cy - y) * (zr.cy - y) <= (zr.rad + 1) * (zr.rad + 1);
    const rd = roadDist[c];
    if (!inZone && (rd < 0 || rd > bandMin + hn(x, y, 7) * bandVar)) { grid[c] = WALL; continue; }
    const de = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (de < OC.edgeMin + Math.floor(hn(x, y, 1) * OC.edgeRand)) { grid[c] = WALL; continue; }
    if (bDist[c] < 2.1) {
      const a = roomId[c], b2 = near1[c];
      const linked = b2 >= 0 && edgeSet.has(Math.min(a, b2) * 64 + Math.max(a, b2));
      if (hn(x, y, 2) < (linked ? OC.beltLinked : OC.belt) * density) { grid[c] = WALL; continue; }
    }
    if (hn(x, y, 3) < OC.lone * density) grid[c] = WALL;
  }
  const copseCount = Math.round(total / OC.copseDiv);
  for (let k = 0; k < copseCount; k++) {
    const x0 = rng.i(6, W - 7), y0 = rng.i(6, H - 7), r0 = rng.f(1.6, 3.2);
    let ok = campD2(x0, y0) > (campR + 5) * (campR + 5);
    for (const r of rooms) if (ok && (r.cx - x0) * (r.cx - x0) + (r.cy - y0) * (r.cy - y0) < 25) ok = false;
    if (!ok) continue;
    for (let oy = -4; oy <= 4; oy++) for (let ox = -4; ox <= 4; ox++) {
      const x = x0 + ox, y = y0 + oy;
      if (!inB(x, y) || protect[idx(x, y)]) continue;
      if (ox * ox + oy * oy <= r0 * r0 && rng.chance(OC.copseChance)) grid[idx(x, y)] = WALL;
    }
  }

  const props = [], arches = [], spawns = [], pools = [], lakeCells = [], lakeMask = new Uint8Array(total);
  if (OC.camp.palisade) {
    for (let y = camp.cy - campR - 2; y <= camp.cy + campR + 2; y++)
      for (let x = camp.cx - campR - 2; x <= camp.cx + campR + 2; x++) {
        if (!inB(x, y)) continue;
        const d2 = (x - camp.cx) * (x - camp.cx) + (y - camp.cy) * (y - camp.cy);
        if (Math.abs(Math.sqrt(d2) - campR) < 0.85) {
          const c = idx(x, y);
          if (corridor[c]) {
            // Open palisade camp entrance (overland maps do not use doors)
          }
          else { grid[c] = WALL; palisadeMask[c] = 1; roomId[c] = boss; }
        }
      }
    /* palisadeModel: draw the ring as fence sections laid along the circle,
       each turned to the tangent, instead of plain posts. The cells stay WALL
       (they are what blocks); the renderer skips its posts on these themes.
       Sections where the ring is open (the road's gateway) are left out. */
    if (OC.camp.palisadeModel) {
      const n = Math.round(2 * Math.PI * campR / STAKE_SEG);
      for (let i = 0; i < n; i++) {
        const a = (i + 0.5) / n * 2 * Math.PI;
        const x = camp.cx + Math.cos(a) * campR, y = camp.cy + Math.sin(a) * campR;
        if (!inB(Math.round(x), Math.round(y)) || !palisadeMask[idx(Math.round(x), Math.round(y))]) continue;
        /* tangent (-sin a, cos a) -> rot = atan2(-cos a, -sin a) */
        props.push({
          kind: OC.camp.palisadeModel, x, y, rot: Math.atan2(-Math.cos(a), -Math.sin(a)), scale: 1,
          roomId: boss, palisade: true
        });
      }
    }
  }
  if (OC.camp.tents) {
    const [tMin, tMax] = Array.isArray(OC.camp.tents) ? OC.camp.tents : [3, 5];
    const numT = rng.i(tMin, tMax);
    for (let k = 0; k < numT; k++) {
      const a = k * (Math.PI * 2 / numT) + rng.f(-0.3, 0.3);
      const r = rng.f(campR * 0.35, campR * 0.7);
      const tx = Math.round(camp.cx + Math.cos(a) * r), ty = Math.round(camp.cy + Math.sin(a) * r);
      if (inB(tx, ty) && grid[idx(tx, ty)] === FLOOR)
        props.push({ kind: 'tent', x: tx, y: ty, rot: Math.atan2(-Math.cos(a), -Math.sin(a)), scale: rng.f(0.9, 1.2), roomId: boss });
    }
    props.push({ kind: 'brazier', x: camp.cx, y: camp.cy, rot: 0, scale: 1.3, roomId: boss });
  }
  if (OC.camp.bones) {
    for (let k = 0; k < 8; k++) {
      const a = rng.f(0, 6.28), r = rng.f(1, campR * 0.8);
      const bx = Math.round(camp.cx + Math.cos(a) * r), by = Math.round(camp.cy + Math.sin(a) * r);
      if (inB(bx, by) && grid[idx(bx, by)] === FLOOR)
        props.push({ kind: 'bones', x: bx, y: by, rot: rng.f(0, 6.28), scale: rng.f(0.7, 1.2), roomId: boss });
    }
  }

  /* ── Overland liquid bodies ────────────────────────────────────────────
   * Open terrain had no liquids at all — the single-tile POOL pockets were a
   * dungeon-only feature. Ponds, bogs and lava flows are generated here as
   * proper multi-tile bodies (`oc.liquid.body` cells each), sized by biome.
   *
   * POOL is not walkable, and out here there are no walls to hide behind, so
   * every candidate body must clear floorStaysConnected from the entrance
   * before it is committed — a lava flow across the road would otherwise
   * strand the party. Bodies also keep off the road itself and away from the
   * camp so they can't smother the objective. */
  /* Declared out here because the orphan reclaim below has to run AFTER every
     later pass that edits the grid — widenNarrowDoorways in particular carves
     fresh WALL into FLOOR next to doorways, and a cell it creates beside a
     mere can be born unreachable. Reclaiming before that ran left exactly
     those cells stranded. */
  /* Doorway widening carves WALL into FLOOR, so it has to happen BEFORE the
     liquids: run afterwards, it can cut a fresh cell into the edge of a mere
     that no water check ever saw, and that cell is born unreachable. Widening
     first means every connectivity test below judges the final walkable set. */
  widenNarrowDoorways(grid, W, H, corridor, doorway, roomId);
  let nb4 = null, flood4 = null, preLiquidReach = null, preLiquidFloor = null;
  let riverCount = 0;
  const riverDecks = [];
  if (OC.liquid && OC.liquid.amount > 0) {
    const refCellL = idx(rooms[entrance].cx, rooms[entrance].cy);
    const [lqMin, lqMax] = OC.liquid.body || [4, 10];
    const campKeep = (campR + 3) * (campR + 3);
    /* eligible cell: open ground off the road, clear of the camp, protected
       props and the palisade, with no wall touching it — a body needs a
       walkable rim or the party can end up pinched against terrain */
    const canFlood = c => {
      if (grid[c] !== FLOOR || corridor[c] || doorway[c]) return false;
      if (protect[c] || palisadeMask[c]) return false;
      const x = c % W, y = (c - x) / W;
      if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) return false;
      if ((x - camp.cx) * (x - camp.cx) + (y - camp.cy) * (y - camp.cy) < campKeep) return false;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const nc = idx(x + ox, y + oy);
        if (grid[nc] !== FLOOR && grid[nc] !== POOL) return false;
      }
      return true;
    };

    const targetCells = Math.round(total * OC.liquid.amount);
    /* Baseline reachability, captured once. Overland maps already contain small
       pockets fenced off by copses, so bodies are judged on whether they strand
       anything NEW — not on whether the whole map is one component. Committing a
       body clears its cells from the mask, keeping the baseline exact. */
    const reachMask = reachableFloorMask(grid, W, H, refCellL);

    /* CARDINAL helpers, hoisted to the enclosing scope so the reclaim pass can
       run after EVERYTHING that touches the grid — see below. Bodies and reachability
       are judged 4-way elsewhere in the project, and 8-way is strictly weaker:
       a cell reachable only across a corner counts as stranded there. */
    nb4 = (c) => {
      const x = c % W;
      const out = [];
      if (x > 0) out.push(c - 1);
      if (x < W - 1) out.push(c + 1);
      if (c >= W) out.push(c - W);
      if (c < W * H - W) out.push(c + W);
      return out;
    };
    flood4 = (g) => {
      const seen = new Uint8Array(W * H);
      if (g[refCellL] !== FLOOR) return seen;
      const st = [refCellL]; seen[refCellL] = 1;
      while (st.length) {
        const c = st.pop();
        for (const n of nb4(c)) {
          if (seen[n] || g[n] !== FLOOR) continue;
          seen[n] = 1; st.push(n);
        }
      }
      return seen;
    };
    /* Ground that was walkable BEFORE any water went down. Anything in here
       that ends up unreachable afterwards was orphaned by the liquids. */
    preLiquidReach = flood4(grid);
    /* Which cells were floor at all back then. widenNarrowDoorways carves new
       floor out of wall AFTER the water goes down, so a cell it creates has no
       entry in preLiquidReach and must be judged on its own terms below. */
    preLiquidFloor = new Uint8Array(W * H);
    for (let c = 0; c < W * H; c++) if (grid[c] === FLOOR) preLiquidFloor[c] = 1;

    /* Walk a shuffled list of eligible cells rather than throwing random darts:
       most of an overland map is tree cover, so darts mostly miss. Same pattern
       as the dungeon alcove pools above. */
    const seeds = [];
    for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
      const c = idx(x, y);
      if (canFlood(c)) seeds.push(c);
    }
    for (let i = seeds.length - 1; i > 0; i--) { const j = rng.i(0, i); const t = seeds[i]; seeds[i] = seeds[j]; seeds[j] = t; }

    /* ── crossings ────────────────────────────────────────────────────
       Span a body with a two-tile-wide walkway at its narrowest axis. Only
       bodies wide enough to be a genuine obstacle get one; a puddle you can
       step round does not need a bridge. */
    const BRIDGE_KIND = { wood: { deck: 'woodBridge', rail: 'woodRailing' } };
    const bridgeKit = BRIDGE_KIND[OC.liquid.bridge];
    /* Only a mere big enough to be a real detour earns a crossing, and a
       handful per map — bridging every pond turned the mire into a boardwalk.
       MAX_CROSSINGS is per map, not per body. */
    const MIN_BRIDGE_BODY = 30, MIN_SPAN = 4, MAX_CROSSINGS = 3;
    let crossings = 0, placedDividers = 0;
    const crossingOver = (body, axis, minBody) => {
      const out = new Set();
      if (!bridgeKit || crossings >= MAX_CROSSINGS) return out;
      if (body.length < (minBody === undefined ? MIN_BRIDGE_BODY : minBody)) return out;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const c of body) {
        const x = c % W, y = (c - x) / W;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      /* Walk across the SHORT axis — the shortest way over the water. */
      const spanX = x1 - x0 + 1, spanY = y1 - y0 + 1;
      /* `axis` is the direction of TRAVEL: 'x' means you walk along x, so the
         deck is a band of constant y. Zone dividers pass the road's direction;
         free-standing ponds fall back to their own short axis. */
      const horiz = axis ? axis === 'x' : spanX <= spanY;
      if ((horiz ? spanX : spanY) < MIN_SPAN) return out;
      const mid = horiz ? Math.round((y0 + y1) / 2) : Math.round((x0 + x1) / 2);
      const lanes = [mid, mid + 1];
      for (const c of body) {
        const x = c % W, y = (c - x) / W;
        if (lanes.includes(horiz ? y : x)) out.add(c);
      }
      /* A one-cell stub is not a crossing. */
      return out.size >= MIN_SPAN ? out : new Set();
    };
    /* rot: the deck model's planks lie across local X, so 0 crosses along x
       and PI/2 along y. The mere crossings have always passed 0. */
    const addCrossingProps = (deck, kit = bridgeKit, rot = 0) => {
      for (const c of deck) {
        const x = c % W, y = (c - x) / W;
        props.push({ kind: kit.deck, x, y, rot, scale: 1, roomId: roomId[c] });
        /* Rail only the outer edges of the walkway, never through it. */
        for (const [sx, sy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nc = idx(x + sx, y + sy);
          if (deck.has(nc)) continue;
          /* ends of the span are where you step on — leave those open */
          if (grid[nc] === FLOOR && !deck.has(nc)) continue;
          props.push({
            kind: kit.rail, x, y,
            ox: sx * 0.46, oz: sy * 0.46,
            rot: sx ? Math.PI / 2 : 0, scale: 1, roomId: roomId[c]
          });
        }
      }
    };

    /* Cutting a deck through a mere splits it in two, and either half can
       come out as a lone tile — or pinch off a scrap of bank. The incremental
       check the scattered ponds use does not see this, so a divider is
       simulated in full and verified against two rules before it commits:
       no liquid fragment smaller than a puddle, and nothing that was
       reachable before becomes unreachable after. */
    const MIN_FRAGMENT = 4;
    const dividerOk = (wet) => {
      const wetSet = new Set(wet), seenW = new Set();
      for (const c0 of wet) {
        if (seenW.has(c0)) continue;
        const st = [c0]; seenW.add(c0);
        let n = 0;
        while (st.length) {
          const c = st.pop(); n++;
          for (const k of nb4(c))
            if (wetSet.has(k) && !seenW.has(k)) { seenW.add(k); st.push(k); }
        }
        if (n < MIN_FRAGMENT) return false;
      }
      const before = flood4(grid);
      const scratch = grid.slice();
      for (const c of wet) scratch[c] = POOL;
      const after = flood4(scratch);
      for (let c = 0; c < W * H; c++) {
        if (!before[c] || scratch[c] === POOL) continue;
        if (!after[c]) return false;
      }
      return true;
    };

    /* ── river ────────────────────────────────────────────────────────
       One river right across the map, edge to edge, between two consecutive
       clearings, bridged where the road meets it. Unlike a divider mere it
       cannot be walked round: the bridge is the only way over, so the
       crossing is a real chokepoint.
       Its course is the boundary between the clearings before the gap and
       the clearings after it (dA - dB = 0, measured from each clearing's
       edge), so it keeps as far from both as it can wherever the road has
       wandered, then wobbled by two sine waves so it meanders.
       Elevation steps the road between tiers (zoneBaseH in elevation.js); a
       river across a step would put the stair on the deck, so only gaps whose
       two clearings sit on the same tier are tried. */
    const RV = OC.river;
    if (RV && params.river !== false && rooms.length >= 3) {
      /* Its own stream, so a map that rolls no river (or fails to fit one)
         keeps exactly the layout it had before rivers existed. */
      const rr = makeRng((seed ^ 0x52495645) >>> 0);
      if (params.river === true || rr.chance(RV.chance == null ? 1 : RV.chance)) {
        const kit = BRIDGE_KIND[RV.bridge || 'wood'];
        /* half-width in tiles, rolled slowly along the course */
        const [rMin, rMax] = RV.halfWidth || [2, 2.5];
        const lanes = RV.lanes || 3;
        const nZ = rooms.length;
        const tier = i => Math.min(2, Math.round(i / (nZ - 1) * 2));
        const gapsR = [];
        for (let i = 0; i < nZ - 1; i++) if (tier(i) === tier(i + 1)) gapsR.push(i);
        /* middle of the journey first: a river at the trailhead or the camp
           gate is a much weaker beat than one halfway */
        const midG = (nZ - 2) / 2;
        gapsR.sort((a, b) => Math.abs(a - midG) - Math.abs(b - midG));
        /* Doorways are fair game: out here they are only widened gaps in the
           tree belts, and the reachability check below covers them. A river
           may lap the rim of a clearing (square maps pack them too tightly
           for anything else) but never the inner part, where the fight is. */
        const keepOut = (c) => {
          if (palisadeMask[c]) return true;
          const x = c % W, y = (c - x) / W;
          for (const zr of rooms) {
            const dx = x - zr.cx, dy = y - zr.cy, core = zr.rad * 0.6;
            if (dx * dx + dy * dy < core * core) return true;
          }
          return (x - camp.cx) * (x - camp.cx) + (y - camp.cy) * (y - camp.cy) < campKeep;
        };
        /* clear[c]: tiles to the nearest clearing edge (the camp counts two
           tiles wider, matching campKeep), so the river can narrow and stop
           meandering where two clearings crowd it */
        const base = new Float32Array(total), g = new Float32Array(total), clear = new Float32Array(total);
        /* core[c]: tiles to the nearest ground keepOut forbids (the inner
           part of a clearing, the camp and its margin) — how wide the river
           may be there */
        const core = new Float32Array(total);
        for (const gi of gapsR) {
          if (riverCount) break;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            let dA = 1e9, dB = 1e9, dK = 1e9;
            for (let i = 0; i < nZ; i++) {
              const zr = rooms[i];
              const dc = Math.hypot(x - zr.cx, y - zr.cy);
              const d = dc - zr.rad - (i === boss ? 2 : 0);
              if (i <= gi) { if (d < dA) dA = d; } else if (d < dB) dB = d;
              dK = Math.min(dK, dc - (i === boss ? zr.rad + 3 : zr.rad * 0.6));
            }
            base[idx(x, y)] = dA - dB;
            clear[idx(x, y)] = Math.min(dA, dB);
            core[idx(x, y)] = dK;
          }
          /* dA - dB is steep between the clearings and nearly flat out in the
             wilds, so a fixed wobble would fold the far reaches into lakes.
             Dividing by its slope turns it into tiles from the centreline,
             and the meander below is then the same size everywhere. */
          for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
            const c = idx(x, y);
            const gx = (base[c + 1] - base[c - 1]) / 2, gy = (base[c + W] - base[c - W]) / 2;
            g[c] = base[c] / Math.max(0.5, Math.hypot(gx, gy));
          }
          for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) base[idx(x, y)] = g[idx(x, y)];
          for (let attempt = 0; attempt < 8 && !riverCount; attempt++) {
            /* amplitudes in tiles; their combined slope stays under ~1 so
               the course bends without doubling back on itself */
            const a1 = rr.f(1.5, 3), k1 = 2 * Math.PI / rr.f(28, 44), t1 = rr.f(0, Math.PI), p1 = rr.f(0, 6.283);
            const a2 = rr.f(0.3, 0.7), k2 = 2 * Math.PI / rr.f(12, 18), t2 = rr.f(0, Math.PI), p2 = rr.f(0, 6.283);
            const c1 = Math.cos(t1), s1 = Math.sin(t1), c2 = Math.cos(t2), s2 = Math.sin(t2);
            /* the meander fades out where there is no room for it */
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
              const c = idx(x, y);
              const room = Math.max(0, Math.min(1, (clear[c] - rMax - 2) / 4));
              g[c] = base[c] + room * (a1 * Math.sin((x * c1 + y * s1) * k1 + p1)
                + a2 * Math.sin((x * c2 + y * s2) * k2 + p2));
            }

            /* The water is every cell whose centre lies within half a width of
               the centreline. g is about tiles from it already, and dividing
               by its local slope corrects what the meander adds, so the width
               comes out in tiles: half 2 is 4 wide, 2.5 is 5. A band at least
               3 wide is 4-connected, so nothing can slip across a corner. */
            const wetSet = new Set();
            let bad = false;
            for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
              const c = idx(x, y);
              /* g is only tile-like near the line: at a clearing's centre its
                 slope collapses and the ratio below would read as close */
              if (Math.abs(g[c]) > rMax * 2.5) continue;
              const slope = Math.hypot((g[c + 1] - g[c - 1]) / 2, (g[c + W] - g[c - W]) / 2);
              const dist = Math.abs(g[c]) / Math.max(0.35, slope);
              if (dist > rMax) continue;
              /* narrower through a pinch, never below a 3-wide channel */
              const half = Math.max(1.5, Math.min(core[c] + dist - 0.6,
                rMin + (rMax - rMin) * (0.5 + 0.5 * Math.sin(x * 0.11 + y * 0.09 + p2 * 3))));
              if (dist < half) wetSet.add(c);
            }
            /* a cell the band skipped by rounding, with water on three sides,
               is an islet no one could reach: drown it */
            for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
              const c = idx(x, y);
              if (wetSet.has(c)) continue;
              if (wetSet.has(c - 1) + wetSet.has(c + 1) + wetSet.has(c - W) + wetSet.has(c + W) >= 3) wetSet.add(c);
            }
            if (!wetSet.size) continue;
            for (const c of wetSet) if (keepOut(c)) { bad = true; break; }
            if (bad) continue;

            /* The road has to cross exactly once, or there would be water on
               the road with no bridge over it. */
            const roadWet = [...wetSet].filter(c => corridor[c] && grid[c] === FLOOR);
            if (!roadWet.length) continue;
            const roadSet = new Set(roadWet), seenR = new Set([roadWet[0]]), stR = [roadWet[0]];
            while (stR.length) { const c = stR.pop(); for (const n of nb4(c)) if (roadSet.has(n) && !seenR.has(n)) { seenR.add(n); stR.push(n); } }
            if (seenR.size !== roadSet.size) continue;

            /* The bridge goes where the road meets the centre of the river,
               straight across it: the travel axis is the field's gradient. */
            let P = roadWet[0];
            for (const c of roadWet) if (Math.abs(g[c]) < Math.abs(g[P])) P = c;
            const px = P % W, py = (P - px) / W;
            const alongY = Math.abs(g[P + W] - g[P - W]) >= Math.abs(g[P + 1] - g[P - 1]);
            /* Each lane's run of water, walked out from the crossing both ways
               along the travel axis; over a slanting river the runs are
               staggered, so the deck is squared off to the span of all of
               them and its short ends rest on the bank as abutments. */
            const half = (lanes - 1) >> 1;
            const at = (l, s) => alongY ? idx(px + l, py + s) : idx(px + s, py + l);
            let sLo = 1e9, sHi = -1e9, lanesWet = 0;
            for (let l = -half; l < lanes - half; l++) {
              let s0 = null;
              for (const s of [0, 1, -1, 2, -2, 3, -3]) if (wetSet.has(at(l, s))) { s0 = s; break; }
              if (s0 === null) continue;
              lanesWet++;
              let s1 = s0, s2 = s0;
              while (wetSet.has(at(l, s2 + 1))) s2++;
              while (wetSet.has(at(l, s1 - 1))) s1--;
              sLo = Math.min(sLo, s1); sHi = Math.max(sHi, s2);
            }
            if (lanesWet < lanes || sHi - sLo < 1) continue;
            const deck = new Set();
            for (let l = -half; l < lanes - half && !bad; l++)
              for (let s = sLo; s <= sHi; s++) {
                const c = at(l, s);
                if (!wetSet.has(c) && grid[c] !== FLOOR) { bad = true; break; }
                deck.add(c);
              }
            if (bad) continue;
            const wet = [...wetSet].filter(c => !deck.has(c));

            /* A real barrier: without the deck the far side is cut off... */
            const scratch = grid.slice();
            for (const c of wetSet) scratch[c] = POOL;
            const bossC = idx(rooms[boss].cx, rooms[boss].cy);
            if (flood4(scratch)[bossC]) continue;
            /* ...and with it, nothing reachable before is stranded, and
               neither half of the river is a puddle. */
            if (!dividerOk(wet)) continue;

            for (const c of wet) {
              grid[c] = POOL;
              reachMask[c] = 0;
              pools.push({ x: c % W, y: (c - (c % W)) / W });
            }
            addCrossingProps(deck, kit, alongY ? Math.PI / 2 : 0);
            /* The bridge is road now: the passes after this one keep off the
               road, so without this they wall off or plant on the deck. */
            /* A deck cell can be one the river took from the tree belt, so lay
               it as floor rather than trusting what was there. */
            for (const c of deck) { grid[c] = FLOOR; corridor[c] = 1; roadDist[c] = 0; protect[c] = 1; }
            riverDecks.push([...deck]);
            riverCount++;
          }
        }
      }
    }

    /* ── zone dividers ────────────────────────────────────────────────
       An overland map is a chain of clearings strung along one road, so the
       natural place for water is BETWEEN two of them: a mere across the road,
       bridged where the road meets it. That turns a crossing into a gateway
       from one part of the journey to the next.
       Scattered ponds cannot do this, because canFlood keeps every body clear
       of the road — so their bridges always spanned water you could simply walk
       around, which is what made them look arbitrary. This pass deliberately
       floods the road band and hands the road back as planking. */
    if (bridgeKit && rooms.length >= 3) {
      /* Flooding the road means ignoring the road exclusion AND the
         no-wall-contact rule — a mere between two tree lines touches them. */
      const canFloodRoad = c => {
        if (grid[c] !== FLOOR || doorway[c]) return false;
        /* NOT the `protect` mask: stampTrail sets it on every road cell, so
           honouring it here rejected the entire road and no divider ever
           placed. Flooding the road is the whole point of this pass. The
           clearings themselves are still off limits — a mere belongs BETWEEN
           two zones, not swallowing the middle of one. */
        if (palisadeMask[c]) return false;
        const x = c % W, y = (c - x) / W;
        for (const zr of rooms) {
          const zd = (x - zr.cx) * (x - zr.cx) + (y - zr.cy) * (y - zr.cy);
          if (zd < zr.rad * zr.rad) return false;
        }
        if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) return false;
        if ((x - camp.cx) * (x - camp.cx) + (y - camp.cy) * (y - camp.cy) < campKeep) return false;
        return true;
      };
      const roadCellNear = (mx, my) => {
        let best = -1, bd = 1e9;
        for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
          const c = idx(x, y);
          if (!corridor[c] || grid[c] !== FLOOR) continue;
          const dd = (x - mx) * (x - mx) + (y - my) * (y - my);
          if (dd < bd) { bd = dd; best = c; }
        }
        return best;
      };
      /* Space the dividers out along the journey rather than bunching them. */
      const gaps = [];
      for (let i = 0; i < rooms.length - 1; i++) gaps.push(i);
      for (let i = gaps.length - 1; i > 0; i--) { const j = rng.i(0, i); const t = gaps[i]; gaps[i] = gaps[j]; gaps[j] = t; }

      /* Travel follows the road: whichever axis separates the two zones. */
      const DIVIDER_MIN_BODY = 18;
      for (const gi of gaps) {
        if (crossings >= MAX_CROSSINGS) break;
        const A = rooms[gi], B = rooms[gi + 1];
        const axis = Math.abs(B.cx - A.cx) >= Math.abs(B.cy - A.cy) ? 'x' : 'y';
        /* Sample several points along the gap, not just the midpoint: the road
           wanders, and the exact centre often lands inside a clearing (where
           water is not wanted) or on ground too pinched to grow a mere. */
        for (const f of [0.5, 0.38, 0.62, 0.44, 0.56]) {
          if (crossings >= MAX_CROSSINGS) break;
          const mx = Math.round(A.cx + (B.cx - A.cx) * f);
          const my = Math.round(A.cy + (B.cy - A.cy) * f);
          const seedC = roadCellNear(mx, my);
          if (seedC < 0 || !canFloodRoad(seedC)) continue;

          const body = growLiquidBody(W, H, seedC, rng.i(30, 60), canFloodRoad, rng);
          if (body.length < DIVIDER_MIN_BODY) continue;
          const deck = crossingOver(body, axis, DIVIDER_MIN_BODY);
          if (!deck.size) continue;

          const wet = body.filter(c => !deck.has(c));
          if (!wet.length || !dividerOk(wet)) continue;

          for (const bc of wet) {
            grid[bc] = POOL;
            reachMask[bc] = 0;
            pools.push({ x: bc % W, y: (bc - (bc % W)) / W });
          }
          addCrossingProps(deck);
          crossings++;
          placedDividers++;
          break;                                   // one mere per gap
        }
      }
    }

    let placed = 0;
    for (const seed of seeds) {
      if (placed >= targetCells) break;
      if (!canFlood(seed)) continue;                 // an earlier body may have taken it
      const sx = seed % W, sy = (seed - sx) / W;
      /* keep bodies apart so the map reads as distinct pools, not one swamp */
      let close = false;
      for (const p of pools) if (Math.max(Math.abs(p.x - sx), Math.abs(p.y - sy)) < 4) { close = true; break; }
      if (close) continue;

      const body = growLiquidBody(W, H, seed, rng.i(lqMin, lqMax), canFlood, rng);
      if (body.length < lqMin) continue;                     // too cramped to bother
      if (!floorStaysConnected(grid, W, H, body, refCellL, reachMask)) continue;

      /* A broad mere is a wall unless you can get over it. Pick a crossing
         BEFORE flooding, so the deck cells simply never become POOL — much
         safer than carving them back out afterwards, which would leave them in
         the `pools` array and draw water over the planking. */
      /* Scattered ponds sit OFF the road by construction, so a bridge over one
         spans water you could simply walk around — which is exactly what made
         the first pass look arbitrary. Only the zone dividers above get decks;
         these are just water. */
      const deck = new Set();
      for (const bc of body) {
        if (deck.has(bc)) continue;                          // stays walkable
        grid[bc] = POOL;
        reachMask[bc] = 0;
        pools.push({ x: bc % W, y: (bc - (bc % W)) / W });
      }
      if (deck.size) { addCrossingProps(deck); crossings++; }
      placed += body.length;
    }

  }

  const bfs = new Int16Array(total).fill(-1);
  const ei = idx(rooms[entrance].cx, rooms[entrance].cy);
  let floorTotal = 0; for (let i = 0; i < total; i++) if (grid[i] === FLOOR) floorTotal++;
  let reach = 0, maxBfs = 0;
  if (grid[ei] === FLOOR) {
    const q = new Int32Array(floorTotal); let qh = 0, qt = 0;
    q[qt++] = ei; bfs[ei] = 0; reach = 1;
    while (qh < qt) {
      const c = q[qh++], x = c % W, b = bfs[c] + 1; let n;
      if (x > 0 && grid[n = c - 1] === FLOOR && bfs[n] < 0) { bfs[n] = b; q[qt++] = n; reach++; }
      if (x < W - 1 && grid[n = c + 1] === FLOOR && bfs[n] < 0) { bfs[n] = b; q[qt++] = n; reach++; }
      if (c >= W && grid[n = c - W] === FLOOR && bfs[n] < 0) { bfs[n] = b; q[qt++] = n; reach++; }
      if (c < total - W && grid[n = c + W] === FLOOR && bfs[n] < 0) { bfs[n] = b; q[qt++] = n; reach++; }
    }
    maxBfs = bfs[q[qt - 1]];
  }

  /* ── fenced graveyard plots ───────────────────────────────────────────
     A rectangle of fence segments with one gateway and rows of headstones
     inside. Each segment spans two cells between posts, so a side runs corner
     to corner and the four sides meet cleanly. A plot only goes where it AND a one-cell verge
     around it are open ground off the road: the verge keeps the land around
     the fence connected, and the gateway always leads inside. Rolled on its
     own stream so no other overland's layout moves. */
  const plotMask = new Uint8Array(total);
  const flatCamp = !!(OC.graveyards && OC.graveyards.arena);
  /* the boss arena's fenced yard (oc.graveyards.arena): ground scatter keeps out */
  const arenaMask = new Uint8Array(total);
  let arenaBox = null;   // { x0, y0, x1, y1 } of that yard: the boss room's spawns go inside it
  /* open-grave cells: their ground is drawn sunken, so no grass tufts on them */
  const sunkMask = new Uint8Array(total);
  const plots = [];
  if (OC.graveyards) {
    const G = OC.graveyards;
    const gRng = makeRng((seed ^ 0x6a7e7a1d) >>> 0);
    const campKeepP = (campR + 3) * (campR + 3);
    /* Terrain heights are decided at the very end, but they depend only on
       the layout, which is final by now, so preview them: a plot needs flat
       ground with no stairs, or the fence floats and leaks. */
    const elevPreview = () => buildOverlandElevation({ W, H, grid, corridor, rooms, entrance, boss, pools, lakeMask, params, props, bridges: riverDecks, flatCamp }, rng);
    let preview = elevPreview();
    const fits = (x0, y0, x1, y1) => {
      if (x0 < 4 || y0 < 4 || x1 >= W - 4 || y1 >= H - 4) return false;
      const h0 = preview.height[idx(x0, y0)];
      for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
        const c = idx(x, y);
        if (grid[c] !== FLOOR || doorway[c] || palisadeMask[c] || plotMask[c]) return false;
        if (preview.height[c] !== h0 || preview.ramp[c]) return false;
        if (campD2(x, y) < campKeepP) return false;
        /* the verge only has to stay walkable, so it may run along the road;
           the fence and the graves themselves keep off it */
        const verge = x < x0 || x > x1 || y < y0 || y > y1;
        if (!verge && (corridor[c] || protect[c])) return false;
      }
      return true;
    };
    /* Headstones come in four models; plots and the arena draw from the same mix. */
    const headstone = () => {
      const v = gRng.raw();
      return v < 0.5 ? 'tombstone' : v < 0.75 ? 'stoneCross' : v < 0.875 ? 'woodMarkerA' : 'woodMarkerB';
    };
    /* An open grave: two cells long, its ground sunk (p.sink) so the model's
       pit drops below the turf; the renderer lowers those cells and the
       neighbouring slabs' sides become the dirt walls. `along` [dx, dy] is
       the long axis. */
    const openGrave = (x, y, along, rid) => {
      const x2 = x + along[0], y2 = y + along[1];
      const s = gRng.f(0.95, 1.05);
      props.push({
        kind: 'openGrave', x: (x + x2) / 2, y: (y + y2) / 2, rot: along[0] ? Math.PI / 2 : 0, scale: s,
        sink: OPEN_GRAVE_RIM * s, oy: -OPEN_GRAVE_RIM * s, sinkCells: [idx(x, y), idx(x2, y2)], roomId: rid
      });
      plotMask[idx(x, y)] = plotMask[idx(x2, y2)] = 1;
      sunkMask[idx(x, y)] = sunkMask[idx(x2, y2)] = 1;
    };

    /* ---- the boss arena as a fenced graveyard (oc.graveyards.arena) ----
       A square yard round the camp centre with a mausoleum where the road
       ends, headstones on alternate cells, two open graves, and a lychgate
       where the road comes through the fence. Only the solid cells go into
       plotMask (spawns, scatter and furniture keep off them): the open ground
       between the graves is where the boss fight happens. Skipped, leaving the
       plain clearing, if the camp is not one flat level. */
    if (G.arena) {
      const half = Math.max(3, Math.min(6, Math.round(campR * 0.45)));
      const x0 = camp.cx - half, x1 = camp.cx + half, y0 = camp.cy - half, y1 = camp.cy + half;
      let flat = x0 >= 2 && y0 >= 2 && x1 < W - 2 && y1 < H - 2;
      const h0 = flat ? preview.height[idx(camp.cx, camp.cy)] : 0;
      for (let y = y0; flat && y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const c = idx(x, y);
        if (grid[c] !== FLOOR || preview.height[c] !== h0 || preview.ramp[c]) { flat = false; break; }
      }
      if (flat) {
        const rid = boss;
        arenaBox = { x0, y0, x1, y1 };
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) arenaMask[idx(x, y)] = 1;
        /* the way the road comes in: the mean offset of the trail cells near the centre */
        let vx = 0, vy = 0;
        for (let y = camp.cy - 4; y <= camp.cy + 4; y++) for (let x = camp.cx - 4; x <= camp.cx + 4; x++)
          if (inB(x, y) && corridor[idx(x, y)]) { vx += x - camp.cx; vy += y - camp.cy; }
        const n = Math.abs(vx) > Math.abs(vy) ? [Math.sign(vx) || 1, 0] : [0, vy >= 0 ? 1 : -1];
        /* fence: segments of two cells, posts shared with the next. A segment
           is left out where the road crosses it (or one of its posts); a
           cell is blocked only while some segment still draws it */
        const segs = [];
        for (const y of [y0, y1]) for (let x = x0; x < x1; x += 2)
          segs.push({ cells: [idx(x, y), idx(x + 1, y), idx(x + 2, y)], x: x + 1, y, rot: Math.PI / 2, side: [0, y === y0 ? -1 : 1] });
        for (const x of [x0, x1]) for (let y = y0; y < y1; y += 2)
          segs.push({ cells: [idx(x, y), idx(x, y + 1), idx(x, y + 2)], x, y: y + 1, rot: 0, side: [x === x0 ? -1 : 1, 0] });
        for (const sg of segs) sg.open = sg.cells.some(c => corridor[c]);
        /* the road may stop short of the fence: then open the middle of the road-facing side */
        if (!segs.some(sg => sg.open)) {
          const facing = segs.filter(sg => sg.side[0] === n[0] && sg.side[1] === n[1]);
          facing[facing.length >> 1].open = true;
        }
        const drawn = new Set();
        for (const sg of segs) if (!sg.open) {
          props.push({ kind: 'graveFence', x: sg.x, y: sg.y, rot: sg.rot, scale: 1, roomId: rid, plot: -1 });
          for (const c of sg.cells) drawn.add(c);
        }
        for (const c of drawn) {
          props.push({ kind: 'graveFenceBlock', x: c % W, y: (c / W) | 0, rot: 0, scale: 1, roomId: rid, plot: -1 });
          plotMask[c] = 1;
        }
        /* the lychgate stands in the first gap, over the road */
        const gate = segs.find(sg => sg.open);
        props.push({ kind: 'lychgate', x: gate.x, y: gate.y, rot: gate.rot === 0 ? Math.PI / 2 : 0, scale: 1, roomId: rid });

        /* mausoleum: 2x2, set back from the road's end so the road leads to its door */
        const mx = Math.round(camp.cx - n[0] * 2 - 0.5) + 0.5, my = Math.round(camp.cy - n[1] * 2 - 0.5) + 0.5;
        props.push({
          kind: gRng.pick(['mausoleumA', 'mausoleumB', 'mausoleumC']), x: mx, y: my,
          rot: Math.atan2(n[0], n[1]), scale: 1, roomId: rid
        });
        const keep = new Uint8Array(total);   // the mausoleum and a one-cell walk round it
        for (let y = Math.floor(my) - 1; y <= Math.ceil(my) + 1; y++) for (let x = Math.floor(mx) - 1; x <= Math.ceil(mx) + 1; x++) {
          keep[idx(x, y)] = 1;
          if (Math.abs(x - mx) < 1 && Math.abs(y - my) < 1) plotMask[idx(x, y)] = 1;
        }
        /* two open graves, long side across the road's line, off the road */
        const free = (x, y) => x > x0 && x < x1 && y > y0 && y < y1 && !keep[idx(x, y)] && !plotMask[idx(x, y)] && roadDist[idx(x, y)] >= 2;
        const along = [n[1] ? 1 : 0, n[0] ? 1 : 0];
        const graveSpots = [];
        for (let y = y0 + 2; y < y1 - 1; y++) for (let x = x0 + 2; x < x1 - 1; x++)
          if (free(x, y) && free(x + along[0], y + along[1])) graveSpots.push([x, y]);
        for (let k = 0; k < 2 && graveSpots.length; k++) {
          const [gx, gy] = graveSpots.splice(gRng.i(0, graveSpots.length - 1), 1)[0];
          if (!free(gx, gy) || !free(gx + along[0], gy + along[1])) { k--; continue; }
          openGrave(gx, gy, along, rid);
          for (let y = gy - 1; y <= gy + along[1] + 1; y++) for (let x = gx - 1; x <= gx + along[0] + 1; x++) keep[idx(x, y)] = 1;
        }
        /* headstones on alternate cells, sparser than a plot: this is a fight */
        for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) {
          if ((x - x0) % 2 !== 1 || (y - y0) % 2 !== 1 || !free(x, y) || !gRng.chance(0.5)) continue;
          props.push({ kind: headstone(), x, y, rot: Math.atan2(n[0], n[1]), scale: gRng.f(0.85, 1.05), roomId: rid, plot: -1 });
          plotMask[idx(x, y)] = 1;
        }
      }
    }

    const want = gRng.i(G.count[0], G.count[1]);
    while (plots.length < want) {
      /* Open ground big enough for a plot is scarce, so list every spot that
         fits rather than guessing, shrinking the plot until one does. */
      /* sides are whole two-cell fence segments, so outer sizes are odd */
      const small = Math.min(...G.sizes);
      let w = gRng.pick(G.sizes), h = gRng.pick(G.sizes), spots;
      for (; ;) {
        spots = [];
        for (let y = 4; y + h - 1 < H - 4; y++) for (let x = 4; x + w - 1 < W - 4; x++)
          if (fits(x, y, x + w - 1, y + h - 1)) spots.push([x, y]);
        if (spots.length || (w <= small && h <= small)) break;
        if (w > small) w -= 2; else h -= 2;
      }
      if (!spots.length) break;
      const [x0, y0] = gRng.pick(spots);
      const x1 = x0 + w - 1, y1 = y0 + h - 1;
      /* Scatter and spawns keep two cells off the fence, not one: a cairn's
         footprint reaches past its own cell and could plug the verge or the
         ground in front of the gate. */
      for (let y = y0 - 2; y <= y1 + 2; y++) for (let x = x0 - 2; x <= x1 + 2; x++)
        if (inB(x, y)) plotMask[idx(x, y)] = 1;

      /* the gateway faces the nearest stretch of road */
      const pcx = (x0 + x1) / 2, pcy = (y0 + y1) / 2;
      let rdx = 0, rdy = -1, best = 1e9;
      for (let c = 0; c < total; c++) {
        if (!corridor[c]) continue;
        const cx = c % W, cy = (c - cx) / W;
        const dd = (cx - pcx) * (cx - pcx) + (cy - pcy) * (cy - pcy);
        if (dd < best) { best = dd; rdx = cx - pcx; rdy = cy - pcy; }
      }
      const n = Math.abs(rdx) > Math.abs(rdy) ? [Math.sign(rdx), 0] : [0, rdy >= 0 ? 1 : -1];
      /* the gateway is the middle cell of a segment, i.e. an odd offset along
         its side, so dropping that one segment opens exactly it */
      const gx = n[0] ? (n[0] > 0 ? x1 : x0) : x0 + (((w - 1) / 2) | 1);
      const gy = n[1] ? (n[1] > 0 ? y1 : y0) : y0 + (((h - 1) / 2) | 1);
      const rid = roomId[idx(Math.round(pcx), Math.round(pcy))];
      const plot = plots.length;

      /* Drawn and blocking are separate: a fence segment is a two-cell model
         (hero height needs that much length), and every fence cell but the
         gateway gets an invisible one-cell blocker. */
      for (const y of [y0, y1]) for (let x = x0; x < x1; x += 2)
        if (!(x + 1 === gx && y === gy))
          props.push({ kind: 'graveFence', x: x + 1, y, rot: Math.PI / 2, scale: 1, roomId: rid, plot });
      for (const x of [x0, x1]) for (let y = y0; y < y1; y += 2)
        if (!(x === gx && y + 1 === gy))
          props.push({ kind: 'graveFence', x, y: y + 1, rot: 0, scale: 1, roomId: rid, plot });
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1 || y === y0 || y === y1;
        if (edge && !(x === gx && y === gy))
          props.push({ kind: 'graveFenceBlock', x, y, rot: 0, scale: 1, roomId: rid, plot });
      }

      /* headstones on alternate rows and columns, so the paths between them
         stay open, all turned toward the gateway */
      const inside = idx(gx - n[0], gy - n[1]);
      for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) {
        if ((x - x0) % 2 !== 1 || (y - y0) % 2 !== 1 || idx(x, y) === inside) continue;
        if (!gRng.chance(0.85)) continue;
        props.push({
          kind: headstone(), x, y, rot: Math.atan2(n[0], n[1]),
          scale: gRng.f(0.85, 1.05), roomId: rid, plot
        });
      }
      /* a roofed lychgate over the gateway, its passage running through the fence */
      const lych = !!(G.lychgate && gRng.chance(G.lychgate));
      if (lych) props.push({ kind: 'lychgate', x: gx, y: gy, rot: n[0] ? Math.PI / 2 : 0, scale: 1, roomId: rid, plot });
      plots.push({ x0, y0, x1, y1, gx, gy, n, lych });
    }

    /* Wrought-iron fence along the treeline (oc.graveyards.edgeFences), so
       the wild edge reads as a walled churchyard. The treeline is ragged
       cell by cell, so a run STRAIGHTENS it first: along 3-15 cells the row
       behind the fence is filled to trees and the row in front cleared to
       open ground, and the fence stands on the clean line between.
       Only shallow notches are filled (trees close them off within `depth`
       cells) and shallow pokes cleared (open ground within `depth`), each run
       is checked with a flood fill and reverted if any room or road cell is
       lost, and any pocket a fill seals off is planted over afterwards.
       Heights are then re-previewed and a run that is not flat keeps its
       straightened edge but gets no fence. */
    if (G.edgeFences) {
      const F = G.edgeFences;
      const taken = new Uint8Array(total);
      const fenceRow = new Uint8Array(total);
      const blockedFor = c => plotMask[c] || arenaMask[c] || protect[c] || doorway[c];
      const must = [];   // room centres and road cells: never cut off
      for (const r of rooms) must.push(idx(r.cx, r.cy));
      for (let c = 0; c < total; c++) if (corridor[c]) must.push(c);
      const reachAll = () => {
        const seen = new Uint8Array(total), q = new Int32Array(total);
        let qh = 0, qt = 0;
        const s0 = idx(rooms[entrance].cx, rooms[entrance].cy);
        seen[s0] = 1; q[qt++] = s0;
        while (qh < qt) {
          const c = q[qh++], x = c % W;
          for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
            if (n < 0 || n >= total || seen[n] || grid[n] !== FLOOR || fenceRow[n]) continue;
            seen[n] = 1; q[qt++] = n;
          }
        }
        return must.every(c => seen[c]);
      };
      const depth = F.depth || 1;
      /* The cells a run would turn to trees (fill) and to open ground (clear),
         or null if it does not fit. A notch behind is filled only if trees
         close it within `depth` cells, a poke in front cleared only if open
         ground lies within `depth`. */
      const tryRun = (x, y, d, p, len) => {
        let wallBehind = 0, openAhead = 0;
        const n = len + 2, fill = [], clear = [];
        for (let i = -1; i <= len; i++) {
          const fx = x + d[0] * i, fy = y + d[1] * i;
          if (fx < 4 || fy < 4 || fx >= W - 4 || fy >= H - 4) return null;
          const f = idx(fx, fy), b = idx(fx + p[0], fy + p[1]), a = idx(fx - p[0], fy - p[1]);
          if (taken[f] || taken[b] || taken[a] || blockedFor(f) || blockedFor(b) || blockedFor(a)) return null;
          if (corridor[f] || corridor[b] || roadDist[f] < 2) return null;
          if (grid[b] === WALL) wallBehind++;
          else {
            let k = 1;
            for (; k <= depth; k++) {
              const c = idx(fx + (1 + k) * p[0], fy + (1 + k) * p[1]);
              if (grid[c] === WALL) break;
              if (grid[c] !== FLOOR || corridor[c] || blockedFor(c)) return null;
            }
            if (k > depth) return null;
            for (let j = 0; j < k; j++) fill.push(idx(fx + (1 + j) * p[0], fy + (1 + j) * p[1]));
          }
          if (grid[a] === FLOOR) openAhead++;
          else {
            let k = 1;
            for (; k <= depth; k++) {
              const c = idx(fx - (1 + k) * p[0], fy - (1 + k) * p[1]);
              if (grid[c] === FLOOR) break;
              if (grid[c] !== WALL) return null;
            }
            if (k > depth) return null;
            for (let j = 0; j < k; j++) clear.push(idx(fx - (1 + j) * p[0], fy - (1 + j) * p[1]));
          }
        }
        return (wallBehind >= n * F.wall && openAhead >= n * F.wall) ? { fill, clear } : null;
      };
      const cands = [];
      for (const d of [[1, 0], [0, 1]]) for (const b of [-1, 1]) {
        const p = [d[1] * b, d[0] * b];   // toward the trees
        for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
          const c = idx(x, y);
          if (grid[idx(x + p[0], y + p[1])] !== WALL || grid[idx(x - p[0], y - p[1])] !== FLOOR) continue;
          for (let len = F.len[1] | 1; len >= F.len[0]; len -= 2)
            if (tryRun(x, y, d, p, len)) { cands.push({ x, y, d, p, len }); break; }
        }
      }
      /* longest first (shuffled within a length), so the long straight runs
         claim the treeline before short ones break it up */
      for (const c of cands) c.k = c.len + gRng.raw();
      cands.sort((a, b) => b.k - a.k);
      const runs = [];
      for (const { x, y, d, p, len } of cands) {
        const plan = tryRun(x, y, d, p, len);
        if (!plan || !gRng.chance(F.chance ?? 1)) continue;
        const changed = [];
        const set = (c, v) => { if (grid[c] !== v) { changed.push([c, grid[c]]); grid[c] = v; } };
        for (const c of plan.fill) set(c, WALL);
        for (const c of plan.clear) set(c, FLOOR);
        for (let i = 0; i < len; i++) {
          const f = idx(x + d[0] * i, y + d[1] * i);
          set(f, FLOOR); fenceRow[f] = 1;
        }
        if (!reachAll()) {
          for (const [c, v] of changed.reverse()) grid[c] = v;
          for (let i = 0; i < len; i++) fenceRow[idx(x + d[0] * i, y + d[1] * i)] = 0;
          continue;
        }
        /* claim the run and its two flanking rows; the next run may start one cell on */
        for (let i = -1; i <= len; i++) for (const o of [-1, 0, 1]) {
          const tx = x + d[0] * i + p[0] * o, ty = y + d[1] * i + p[1] * o;
          if (inB(tx, ty)) taken[idx(tx, ty)] = 1;
        }
        runs.push({ x, y, d, p, len });
      }
      /* Diagonal runs, for where the road band (and so the treeline) runs on
         the diagonal and the edge is a staircase no straight run can follow.
         Fence cells (x+i, y+i*s); the two half-rows either side are
         (x+i+1, y+i*s) and (x+i, y+(i+1)*s). The tree side gets single
         notches filled (only where both its deeper neighbours are trees),
         the open side single pokes cleared (only beside open ground). */
      const diag = [];
      if (F.diagLen) {
        const tryDiag = (x, y, s, t, len) => {
          /* t = 1: trees on the (x+1) half-row, t = -1: on the (y+s) half-row */
          const tree = i => t > 0 ? [x + i + 1, y + i * s] : [x + i, y + (i + 1) * s];
          const open = i => t > 0 ? [x + i, y + (i + 1) * s] : [x + i + 1, y + i * s];
          const deepT = t > 0 ? [[1, 0], [0, -s]] : [[0, s], [-1, 0]];
          const deepO = t > 0 ? [[0, s], [-1, 0]] : [[1, 0], [0, -s]];
          let wallBehind = 0, openAhead = 0;
          const fill = [], clear = [];
          for (let i = -1; i <= len; i++) {
            const fx = x + i, fy = y + i * s;
            if (fx < 4 || fy < 4 || fx >= W - 4 || fy >= H - 4) return null;
            const f = idx(fx, fy);
            const [tx, ty] = tree(i), [ox, oy] = open(i);
            if (tx < 3 || ty < 3 || tx >= W - 3 || ty >= H - 3 || ox < 3 || oy < 3 || ox >= W - 3 || oy >= H - 3) return null;
            const b = idx(tx, ty), a = idx(ox, oy);
            if (taken[f] || taken[b] || taken[a] || blockedFor(f) || blockedFor(b) || blockedFor(a)) return null;
            if (i >= 0 && i < len && (corridor[f] || roadDist[f] < 2)) return null;
            if (corridor[b]) return null;
            if (grid[b] === WALL) wallBehind++;
            else if (grid[b] === FLOOR && deepT.every(([dx, dy]) => grid[idx(tx + dx, ty + dy)] === WALL)) fill.push(b);
            else return null;
            if (grid[a] === FLOOR) openAhead++;
            else if (grid[a] === WALL && deepO.some(([dx, dy]) => grid[idx(ox + dx, oy + dy)] === FLOOR)) clear.push(a);
            else return null;
          }
          const n = len + 2;
          return (wallBehind >= n * F.wall && openAhead >= n * F.wall) ? { fill, clear } : null;
        };
        const dc = [];
        for (const s of [1, -1]) for (const t of [1, -1])
          for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
            for (let len = F.diagLen[1]; len >= F.diagLen[0]; len--)
              if (tryDiag(x, y, s, t, len)) { dc.push({ x, y, s, t, len }); break; }
          }
        for (const c of dc) c.k = c.len + gRng.raw();
        dc.sort((a, b) => b.k - a.k);
        for (const { x, y, s, t, len } of dc) {
          const plan = tryDiag(x, y, s, t, len);
          if (!plan || !gRng.chance(F.chance ?? 1)) continue;
          const changed = [];
          const set = (c, v) => { if (grid[c] !== v) { changed.push([c, grid[c]]); grid[c] = v; } };
          for (const c of plan.fill) set(c, WALL);
          for (const c of plan.clear) set(c, FLOOR);
          for (let i = 0; i < len; i++) { const f = idx(x + i, y + i * s); set(f, FLOOR); fenceRow[f] = 1; }
          if (!reachAll()) {
            for (const [c, v] of changed.reverse()) grid[c] = v;
            for (let i = 0; i < len; i++) fenceRow[idx(x + i, y + i * s)] = 0;
            continue;
          }
          for (let i = -1; i <= len; i++) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++)
            if (inB(x + i + ox, y + i * s + oy)) taken[idx(x + i + ox, y + i * s + oy)] = 1;
          diag.push({ x, y, s, t, len });
        }
      }

      /* a filled notch can seal a pocket of open ground off behind the trees:
         plant it over, so nothing spawns or scatters where no one can reach */
      if (runs.length || diag.length) {
        const seen = new Uint8Array(total), q = new Int32Array(total);
        let qh = 0, qt = 0;
        const s0 = idx(rooms[entrance].cx, rooms[entrance].cy);
        seen[s0] = 1; q[qt++] = s0;
        while (qh < qt) {
          const c = q[qh++], x = c % W;
          for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
            if (n < 0 || n >= total || seen[n] || grid[n] !== FLOOR) continue;
            seen[n] = 1; q[qt++] = n;
          }
        }
        for (let c = 0; c < total; c++) if (grid[c] === FLOOR && !seen[c] && !plotMask[c] && !arenaMask[c]) grid[c] = WALL;
        preview = elevPreview();
      }
      for (const { x, y, d, p, len } of runs) {
        const h0 = preview.height[idx(x, y)];
        let flat = true;
        for (let i = -1; flat && i <= len; i++) {
          const f = idx(x + d[0] * i, y + d[1] * i), a = idx(x + d[0] * i - p[0], y + d[1] * i - p[1]);
          if ((i >= 0 && i < len && (preview.height[f] !== h0 || preview.ramp[f])) || preview.ramp[a]) flat = false;
        }
        if (!flat) { for (let i = 0; i < len; i++) fenceRow[idx(x + d[0] * i, y + d[1] * i)] = 0; continue; }
        const rid = roomId[idx(x, y)];
        for (let i = 0; i + 2 <= len; i += 2)
          props.push({ kind: 'graveFence', x: x + d[0] * (i + 1), y: y + d[1] * (i + 1), rot: d[0] ? Math.PI / 2 : 0, scale: 1, roomId: rid, plot: -1 });
        for (let i = 0; i < len; i++) {
          const fx = x + d[0] * i, fy = y + d[1] * i;
          props.push({ kind: 'graveFenceBlock', x: fx, y: fy, rot: 0, scale: 1, roomId: rid, plot: -1 });
          plotMask[idx(fx, fy)] = 2;
        }
        /* the row in front stays walkable, but nothing solid may be scattered
           onto it later: it is the way along the fence (3 = keep clear) */
        for (let i = -1; i <= len; i++) {
          const a = idx(x + d[0] * i - p[0], y + d[1] * i - p[1]);
          if (!plotMask[a]) plotMask[a] = 3;
        }
      }
      /* Diagonal runs: segments turned 45 deg, laid every two world units
         along the line through the fence cells' centres (a segment is two
         units long, so they meet post to post), blockers on the stair cells. */
      for (const { x, y, s, t, len } of diag) {
        const h0 = preview.height[idx(x, y)];
        let flat = true;
        for (let i = 0; flat && i < len; i++) {
          const f = idx(x + i, y + i * s);
          if (preview.height[f] !== h0 || preview.ramp[f]) flat = false;
        }
        if (!flat) continue;
        const rid = roomId[idx(x, y)];
        const span = (len - 1) * Math.SQRT2, nSeg = Math.floor(span / 2 + 0.25);
        const off = (span - nSeg * 2) / 2;   // centre the segments on the run
        for (let k = 0; k < nSeg; k++) {
          const u = (off + 1 + 2 * k) / Math.SQRT2;
          props.push({ kind: 'graveFence', x: x + u, y: y + u * s, rot: Math.atan2(1, s), scale: 1, roomId: rid, plot: -1 });
        }
        for (let i = 0; i < len; i++) {
          const fx = x + i, fy = y + i * s;
          props.push({ kind: 'graveFenceBlock', x: fx, y: fy, rot: 0, scale: 1, roomId: rid, plot: -1 });
          plotMask[idx(fx, fy)] = 2;
          const [ox, oy] = t > 0 ? [fx, fy + s] : [fx + 1, fy];
          if (!plotMask[idx(ox, oy)]) plotMask[idx(ox, oy)] = 3;
        }
      }
    }

    /* now and then a funeral bell stands at a gateway */
    if (G.bell && plots.length && gRng.chance(G.bell)) {
      const { gx, gy, n, lych } = plots[0];
      const ox = gx + n[0], oy = gy + n[1], tx = Math.abs(n[1]), ty = Math.abs(n[0]);
      const off = lych ? 2 : 1;   // clear of a lychgate's roof
      for (const s of [off, -off]) {
        const bx = ox + tx * s, by = oy + ty * s;
        if (!inB(bx, by)) continue;
        const c = idx(bx, by);
        if (grid[c] !== FLOOR || corridor[c] || protect[c]) continue;
        props.push({ kind: 'funeralBell', x: bx, y: by, rot: Math.atan2(n[0], n[1]), scale: 1, roomId: roomId[c], plot: 0 });
        break;
      }
    }

    /* a fresh grave or two out in the open, off the road and on flat ground */
    if (G.openGraves) {
      const flatFree = (x, y) => {
        if (x < 4 || y < 4 || x >= W - 4 || y >= H - 4) return false;
        const h0 = preview.height[idx(x, y)];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const c = idx(x + dx, y + dy);
          if (grid[c] !== FLOOR || plotMask[c] || arenaMask[c] || protect[c] || preview.height[c] !== h0 || preview.ramp[c]) return false;
        }
        return roadDist[idx(x, y)] >= 3 && roadDist[idx(x, y)] <= 6;
      };
      const spots = [];
      for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
        const along = hn(x, y, 31) < 0.5 ? [1, 0] : [0, 1];
        if (flatFree(x, y) && flatFree(x + along[0], y + along[1])) spots.push([x, y, along]);
      }
      let left = gRng.i(G.openGraves[0], G.openGraves[1]);
      while (left > 0 && spots.length) {
        const [x, y, along] = spots.splice(gRng.i(0, spots.length - 1), 1)[0];
        if (!flatFree(x, y) || !flatFree(x + along[0], y + along[1])) continue;
        openGrave(x, y, along, roomId[idx(x, y)]);
        left--;
      }
    }

    /* Landmarks out in the open (Zenu, 2026-11-01): a few mausoleums (2x2)
       and weeping-angel statues standing near the road and facing it, the
       big pieces first so the headstone rows fill in around them. Each needs
       flat open ground with a clear one-cell ring, so it can never close a
       way through; the cells in front of its face are kept clear too. */
    const landmark = (count, size, kinds, minGap) => {
      if (!count) return;
      const placed = [];
      let left = gRng.i(count[0], count[1]);
      for (let tries = 0; left > 0 && tries < 800; tries++) {
        const x = gRng.i(4, W - 4 - size), y = gRng.i(4, H - 4 - size);
        const h0 = preview.height[idx(x, y)];
        let ok = true, rdMin = 99;
        for (let oy = -1; ok && oy <= size; oy++) for (let ox = -1; ox <= size; ox++) {
          const c = idx(x + ox, y + oy);
          if (grid[c] !== FLOOR || plotMask[c] || arenaMask[c] || protect[c] || corridor[c] || doorway[c]
            || preview.height[c] !== h0 || preview.ramp[c]) { ok = false; break; }
          if (ox >= 0 && oy >= 0 && ox < size && oy < size) rdMin = Math.min(rdMin, roadDist[c]);
        }
        if (!ok || rdMin < 2 || rdMin > 7) continue;
        const cx = x + (size - 1) / 2, cy = y + (size - 1) / 2;
        if (placed.some(([px, py]) => (px - cx) ** 2 + (py - cy) ** 2 < minGap * minGap)) continue;
        /* face the side nearer the road */
        let n = [0, 1], best = 1e9;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const rd = roadDist[idx(Math.round(cx + dx * (size / 2 + 0.5)), Math.round(cy + dy * (size / 2 + 0.5)))];
          if (rd < best) { best = rd; n = [dx, dy]; }
        }
        props.push({ kind: gRng.pick(kinds), x: cx, y: cy, rot: Math.atan2(n[0], n[1]), scale: 1, roomId: roomId[idx(x, y)] });
        for (let oy = 0; oy < size; oy++) for (let ox = 0; ox < size; ox++) plotMask[idx(x + ox, y + oy)] = 1;
        for (let oy = -1; oy <= size; oy++) for (let ox = -1; ox <= size; ox++)
          if (!plotMask[idx(x + ox, y + oy)]) plotMask[idx(x + ox, y + oy)] = 3;
        placed.push([cx, cy]);
        left--;
      }
    };
    landmark(G.mausoleums, 2, ['mausoleumA', 'mausoleumB', 'mausoleumC'], 14);
    landmark(G.angels, 1, ['weepingAngel'], 10);

    /* Stone benches along the road verge, set parallel to it: two cells long,
       with the same clear ring as the landmarks so a bench never pinches the
       verge shut. */
    if (G.benches) {
      let left = gRng.i(G.benches[0], G.benches[1]);
      const placed = [];
      for (let tries = 0; left > 0 && tries < 800; tries++) {
        const x = gRng.i(4, W - 6), y = gRng.i(4, H - 6);
        const along = gRng.chance(0.5) ? [1, 0] : [0, 1];
        const x2 = x + along[0], y2 = y + along[1];
        const c1 = idx(x, y), c2 = idx(x2, y2);
        if (roadDist[c1] < 2 || roadDist[c1] > 4 || roadDist[c2] !== roadDist[c1]) continue;
        const h0 = preview.height[c1];
        let ok = true;
        for (let oy = -1; ok && oy <= 1 + along[1]; oy++) for (let ox = -1; ox <= 1 + along[0]; ox++) {
          const c = idx(x + ox, y + oy), seat = (ox === 0 && oy === 0) || (ox === along[0] && oy === along[1]);
          /* The ring may share keep-clear cells (3), and on the side away
             from the road it may back onto a treeline fence (2): the road
             side stays clear, so the way past is never shut. */
          const back = roadDist[c] > roadDist[c1];
          const shareOk = plotMask[c] === 3 || (plotMask[c] === 2 && back);
          if ((grid[c] !== FLOOR && !(back && grid[c] === WALL)) || (plotMask[c] && (seat || !shareOk)) || arenaMask[c] || protect[c] || corridor[c] || doorway[c]
            || (grid[c] === FLOOR && (preview.height[c] !== h0 || preview.ramp[c]))) { ok = false; break; }
        }
        if (!ok) continue;
        const cx = (x + x2) / 2, cy = (y + y2) / 2;
        if (placed.some(([px, py]) => (px - cx) ** 2 + (py - cy) ** 2 < 100)) continue;
        props.push({ kind: 'stoneBench', x: cx, y: cy, rot: along[0] ? Math.PI / 2 : 0, scale: gRng.f(0.95, 1.05), roomId: roomId[c1] });
        plotMask[c1] = plotMask[c2] = 1;
        for (let oy = -1; oy <= 1 + along[1]; oy++) for (let ox = -1; ox <= 1 + along[0]; ox++) {
          const c = idx(x + ox, y + oy);
          if (!plotMask[c] && grid[c] === FLOOR) plotMask[c] = 3;
        }
        placed.push([cx, cy]);
        left--;
      }
    }

    /* Rows of headstones out in the open, a cell apart and all facing the
       road side, so the ground reads as a tended burial field rather than
       stones dropped at random. A row needs flat open ground with its front
       and back cells walkable, and never butts against another row. */
    if (G.rows) {
      const R = G.rows;
      const okStone = (x, y, h0) => {
        if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) return false;
        const c = idx(x, y);
        return grid[c] === FLOOR && !corridor[c] && !plotMask[c] && !arenaMask[c] && !protect[c] && !doorway[c]
          && roadDist[c] >= 2 && preview.height[c] === h0 && !preview.ramp[c];
      };
      const okSide = (x, y) => inB(x, y) && grid[idx(x, y)] === FLOOR && !plotMask[idx(x, y)];
      let rows = gRng.i(R.count[0], R.count[1]);
      for (let tries = 0; rows > 0 && tries < 600; tries++) {
        const x = gRng.i(3, W - 4), y = gRng.i(3, H - 4);
        if (!inB(x, y) || grid[idx(x, y)] !== FLOOR) continue;
        const d = gRng.chance(0.5) ? [1, 0] : [0, 1], p = [d[1], d[0]];
        const len = gRng.i(R.len[0], R.len[1]), h0 = preview.height[idx(x, y)];
        let ok = true;
        for (let i = 0; ok && i < len; i++) {
          const sx = x + d[0] * i * 2, sy = y + d[1] * i * 2;
          ok = okStone(sx, sy, h0) && okSide(sx + p[0], sy + p[1]) && okSide(sx - p[0], sy - p[1]);
        }
        if (!ok) continue;
        /* face whichever side lies nearer the road */
        const front = roadDist[idx(x + p[0], y + p[1])] <= roadDist[idx(x - p[0], y - p[1])] ? p : [-p[0], -p[1]];
        const rid = roomId[idx(x, y)];
        for (let i = 0; i < len; i++) {
          const sx = x + d[0] * i * 2, sy = y + d[1] * i * 2;
          props.push({ kind: headstone(), x: sx, y: sy, rot: Math.atan2(front[0], front[1]), scale: gRng.f(0.88, 1.04), roomId: rid });
          plotMask[idx(sx, sy)] = 1;
        }
        rows--;
      }
    }

  }

  props.push({ kind: 'ring', x: rooms[entrance].cx, y: rooms[entrance].cy, rot: 0, scale: 1, roomId: entrance });
  /* No red crystal at the camp: the palisade ring, the tents and the camp's
     central brazier already say "this is where the fight is", and the crystal
     only suits some dungeons (Zenu, 2026-10-27). */
  /* Map-wide, not per-zone: neighbouring clearings are allowed to overlap, and
     two zones drawing into the shared ground would otherwise stack monsters on
     the same tile. */
  const spawnTaken = new Set();
  /* Zone furniture (the treasure chest, the campfire) stands BESIDE the road,
     never on it: the trail runs through every clearing's centre, so the old
     r.cx/r.cy put both in the middle of the track. Take the nearest open cell
     to the centre that is 2-4 tiles off the centreline; `furniture` keeps the
     scatter and the ruins off it. */
  const furniture = new Set();
  const besideRoad = r => {
    const R = Math.max(3, Math.round((r.rad || 5) * 0.8));
    let best = null, bd = Infinity;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = r.cx + dx, y = r.cy + dy;
      if (!inB(x, y)) continue;
      const c = idx(x, y), rd = roadDist[c];
      if (grid[c] !== FLOOR || doorway[c] || plotMask[c] || rd < 2 || rd > 4) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = { x, y }; }
    }
    const at = best || { x: r.cx, y: r.cy };
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (inB(at.x + dx, at.y + dy)) furniture.add(idx(at.x + dx, at.y + dy));
    return at;
  };
  for (const r of rooms) {
    if (r.type === TYPE.TREASURE) {
      const at = besideRoad(r);
      props.push({ kind: 'chest', x: at.x, y: at.y, rot: rng.f(0, 6.28), scale: 1, roomId: r.id });
    }
    if (r.type === TYPE.SHRINE) {
      const at = besideRoad(r);
      props.push({
        kind: 'shrineCrystal', x: at.x, y: at.y, rot: rng.f(0, 6.28), scale: 1, roomId: r.id,
        lightShrine: false
      });   // chooseLightShrine may pick it
    }
    if (r.type === TYPE.RIVAL) {
      props.push({ kind: 'shrineCrystal', x: r.cx, y: r.cy, rot: 0, scale: 1, roomId: r.id });
      props.push({ kind: 'weaponRack', x: r.cx - 2, y: r.cy, rot: 0, scale: 1, roomId: r.id });
      props.push({ kind: 'crate', x: r.cx + 2, y: r.cy - 1, rot: 0.4, scale: 1, roomId: r.id });
      props.push({ kind: 'barrel', x: r.cx + 2, y: r.cy + 1, rot: 0, scale: 1, roomId: r.id });
      props.push({ kind: 'bench', x: r.cx, y: r.cy - 1.8, rot: 0, scale: 1, roomId: r.id });
    }
    if (r.type === TYPE.COMBAT || r.type === TYPE.ELITE || r.type === TYPE.BOSS) {
      /* Overland clearings use the SAME purse as dungeon rooms — literally the
         same function, so the bestiary's "Spawn Budget" tab previews what an
         overland floor actually fields. This used to divide the budget by ONE
         rolled CR and give every spawn that same CR; buyRoomSpawns prices each
         slot individually and keeps buying down the ladder, so a clearing lands
         close to its budget instead of rounding down to a single division. */
      const lvl = params.level || 1;
      const sbData = getSpawnBudget();
      const { crs: ovCRs } = buyRoomSpawns({
        level: lvl, roomType: r.type, difficulty: r.difficulty,
        threatMult: params.threatMult || 1, rng: rng.raw,
        themeKey: params.themeKey, availableCRs: params.availableCRs || null,
        data: sbData
      });
      const isArena = !!(r.arena && r.roadX !== undefined && r.roadY !== undefined);
      let ax = 0, ay = 0, baseAngle = 0;
      if (isArena) {
        ax = r.cx - r.roadX;
        ay = r.cy - r.roadY;
        const al = Math.hypot(ax, ay) || 1;
        ax /= al;
        ay /= al;
        baseAngle = Math.atan2(ay, ax);
      }
      for (const ovCR of ovCRs) {
        /* In battle arenas (ribbon layout), push monsters deep into the arena
           away from the road rather than clustering in the middle or near the
           road margin. That way the party cannot engage from the road and must
           enter and use the full arena space. */
        for (let attempt = 0; attempt < 36; attempt++) {
          let sx, sy;
          if (arenaBox && r.id === boss) {
            /* the boss and its guard stand among the graves, inside the fence,
               off the road for the first tries */
            sx = rng.i(arenaBox.x0 + 1, arenaBox.x1 - 1);
            sy = rng.i(arenaBox.y0 + 1, arenaBox.y1 - 1);
            if (attempt < 24 && roadDist[idx(sx, sy)] < 2) continue;
          } else if (isArena) {
            // Fan out across the far half of the arena (away from the road).
            const spread = attempt < 24 ? 1.25 : (attempt < 30 ? 1.75 : Math.PI);
            const a = baseAngle + rng.f(-spread, spread);
            // Minimum distance outward from the arena center (away from the road).
            const minFrac = attempt < 20 ? 0.20 : (attempt < 30 ? 0.05 : 0);
            const maxFrac = 0.82;
            const dist = (minFrac + (maxFrac - minFrac) * Math.sqrt(rng.raw())) * r.rad;
            sx = Math.round(r.cx + Math.cos(a) * dist);
            sy = Math.round(r.cy + Math.sin(a) * dist);

            if (!inB(sx, sy)) continue;
            const sc = idx(sx, sy);
            // Road buffer: keep monsters at least minRoad tiles away from the trail centreline.
            const minRoad = attempt < 20 ? Math.max(6, Math.round(r.rad * 0.50)) : (attempt < 30 ? 4 : 2);
            if (roadDist && roadDist[sc] < minRoad) continue;
          } else {
            /* sqrt keeps the draw area-uniform, so they fill the clearing instead
               of bunching around the middle */
            const a = rng.f(0, 6.28), dist = 1 + Math.sqrt(rng.raw()) * (r.rad * 0.82 - 1);
            sx = Math.round(r.cx + Math.cos(a) * dist);
            sy = Math.round(r.cy + Math.sin(a) * dist);

            if (!inB(sx, sy)) continue;
            const sc = idx(sx, sy);
            if (roadDist && attempt < 20 && roadDist[sc] < 2) continue;
          }

          const sc = idx(sx, sy);
          if (grid[sc] !== FLOOR || bfs[sc] < 0 || spawnTaken.has(sc) || plotMask[sc] || furniture.has(sc)) continue;
          spawnTaken.add(sc);
          spawns.push({ x: sx, y: sy, targetCR: ovCR, roomId: r.id });
          break;
        }
      }
    }
    }

  /* ---- arena terrain: bluffs / hollows (ribbon arenas) ----
       About half the combat arenas get a plateau that elevation.js raises two
       levels (or sinks two, where the arena is already near the height cap):
       sheer cliffs all round except one one-level stepped shoulder, so it is
       high ground you must walk round to take. Chosen here because the generator
       knows the road: the plateau sits on the arena's far side from it, clear of
       the road band, furniture and graves (monsters may stand on it: that is
       the point). Its cells go to buildOverlandElevation as `mesas` (the ruins
       preview and the final pass), which raises it against the highest ground
       on its rim and cuts the shoulder; the ruins see it as uneven and keep off. */
    const mesas = [];
    const mesaCells = new Set();
    if (ribbon) {
      const mRng = makeRng((seed ^ 0x3e5a1b07) >>> 0);
      for (const r of rooms) {
        if (!r.arena || r.type !== TYPE.COMBAT || !mRng.chance(0.5)) continue;
        /* away from the road: the centre of the high ground sits on the far side */
        let ax = r.cx - r.roadX, ay = r.cy - r.roadY;
        const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
        const mr = Math.max(2.5, Math.min(r.arena === 'large' ? 5.5 : 4, r.rad * 0.33));
        const mx = r.cx + ax * r.rad * 0.3, my = r.cy + ay * r.rad * 0.3;
        /* the disc's open ground: rim trees, pools and the road band are left
           out, then only the patch joined to the middle is kept */
        const disc = new Set();
        for (let y = Math.floor(my - mr - 1); y <= Math.ceil(my + mr + 1); y++)
          for (let x = Math.floor(mx - mr - 1); x <= Math.ceil(mx + mr + 1); x++) {
            /* a slightly lumpy disc, so it reads as a rock bluff, not a coin */
            const d2 = (x - mx) * (x - mx) + (y - my) * (y - my);
            if (!inB(x, y) || d2 > (mr + (hn(x, y, 11) - 0.5) * 1.2) ** 2) continue;
            const c = idx(x, y);
            if (grid[c] === FLOOR && roadDist[c] >= 3 && !doorway[c] && !plotMask[c] && !furniture.has(c)) disc.add(c);
          }
        let seedC = -1, sd = Infinity;
        for (const c of disc) { const dd = (c % W - mx) ** 2 + (Math.floor(c / W) - my) ** 2; if (dd < sd) { sd = dd; seedC = c; } }
        const cells = [];
        if (seedC >= 0) {
          const seen = new Set([seedC]), q = [seedC];
          while (q.length) {
            const c = q.pop(); cells.push(c);
            for (const n of [c - 1, c + 1, c - W, c + W]) if (disc.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
          }
        }
        if (cells.length < 10) continue;
        /* the stepped approach faces the road half the time, round the back
           otherwise; elevation.js picks the actual rim cells from the heights */
        const face = mRng.chance(0.5) ? Math.atan2(-ay, -ax) : mRng.f(0, Math.PI * 2);
        mesas.push({ roomId: r.id, cx: mx, cy: my, cells, face });
        /* the plateau and a ring round it (the rim and its shoulder) */
        for (const c of cells) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) mesaCells.add(c + oy * W + ox);
      }
    }

    /* ---- ruins (oc.ruins) and stake fences (oc.fences) ----
       Field-wall footings in L and U shapes, where a building once stood, and
       fences of the 'stakes' model. The walls come from the two wall models,
       which dungeon_scene.js scales to one height: stoneWallA is a ~5.4-tile run,
       stoneWallB ~2.2. A ruin is several props sharing a `ruin` id, so one that
       lands on a slope can be taken back out whole once elevation exists (see
       tiltedRuins below). Everything here keeps off the road, doorways, graves,
       spawns and the zone furniture, and the scatter below keeps off it. */
    const ruinCells = new Set();
    const ruinCellLists = [];
    /* Heights come at the very end but depend only on the layout (and never
       draw from rng), so preview them, as the graveyards do: walls and fences
       need one level with no stairs. Without this about half the U/L shapes
       landed across a step. */
    const flat = (OC.ruins || OC.fences || OC.thickets)
      ? buildOverlandElevation({ W, H, grid, corridor, rooms, entrance, boss, pools, lakeMask, params, props, bridges: riverDecks, flatCamp, mesas }, rng)
      : null;
    const freeCell = (c, minRoad) => c >= 0 && grid[c] === FLOOR && !doorway[c] && !plotMask[c] && !furniture.has(c)
      && !spawnTaken.has(c) && !ruinCells.has(c) && roadDist[c] >= minRoad;
    const levelAt = (c, h0) => flat.height[c] === h0 && !flat.ramp[c];
    /* Stake fence sections laid end to end along (x0,y0)->(x1,y1), STAKE_SEG
       apart, optionally leaving a gate gap mid-run. Each is rotated so its row of
       posts runs along the line (rot = atan2(-dy, dx), see STAKE_SEG). A section
       whose cell is taken or off-level is just missing: a broken fence. */
    const fenceSections = (x0, y0, x1, y1, gate, h0, extra) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 0.01) return [];
      const n = Math.max(1, Math.round(len / STAKE_SEG));
      const ux = (x1 - x0) / len, uy = (y1 - y0) / len, rot = Math.atan2(-uy, ux);
      const out = [];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * len / n;
        if (gate && Math.abs(t - len / 2) < STAKE_SEG) continue;
        const x = x0 + ux * t, y = y0 + uy * t;
        const c = inB(Math.round(x), Math.round(y)) ? idx(Math.round(x), Math.round(y)) : -1;
        if (!freeCell(c, 2) || !levelAt(c, h0)) continue;
        ruinCells.add(c);
        out.push(Object.assign({ kind: 'stakes', x, y, rot, scale: 1, roomId: roomId[c] }, extra));
      }
      return out;
    };

    if (OC.ruins) {
      const RUN = { stoneWallA: 5.4, stoneWallB: 2.2 }, THICK = 0.8;
      /* Segments in local tiles; h = the wall runs along x. Short walls sit just
         inside the long wall's ends so the corners overlap rather than gap.
         `fence` is the open side a stake fence may close: [x0,y0,x1,y1,gate]. */
      const SHAPES = [
        {
          walls: [{ k: 'stoneWallA', x: 0, y: -1.1, h: true }, { k: 'stoneWallB', x: -2.3, y: 0, h: false }, { k: 'stoneWallB', x: 2.3, y: 0, h: false }],
          fence: [-2.3, 1.2, 2.3, 1.2, true]
        },                                                              // U
        {
          walls: [{ k: 'stoneWallA', x: 0, y: -1.1, h: true }, { k: 'stoneWallB', x: -2.3, y: 0, h: false }],
          fence: [-2.3, 1.2, 2.3, 1.2, true]
        },                                                              // L
        {
          walls: [{ k: 'stoneWallB', x: 0, y: -1.0, h: true }, { k: 'stoneWallB', x: -0.9, y: 0.1, h: false }],
          fence: [1.1, -0.5, 1.1, 1.3, false]
        }                                                              // small L
      ];
      const ruinRng = makeRng((seed ^ 0x2b1d0c55) >>> 0);
      const [rMin, rMax] = OC.ruins.count || [1, 2];
      const want = ruinRng.i(rMin, rMax);
      /* On the ribbon the ruins go in the fight arenas (they are cover to fight
         round, Zenu 2026-10-27), not on the road between them. */
      const zones = rooms.filter(r => r.id !== entrance && r.id !== boss && (!ribbon || r.arena));
      /* The U needs the most clear ground, so it fails placement most often;
         weight it up or nearly every ruin comes out as the small L. */
      const SHAPE_PICK = [0, 0, 0, 0, 1, 1, 1, 2];
      const turn = (x, y, q) => { for (let i = 0; i < q; i++) [x, y] = [-y, x]; return [x, y]; };
      for (let tries = 0; zones.length && tries < want * 60 && ruinCellLists.length < want; tries++) {
        const z = zones[ruinRng.i(0, zones.length - 1)];
        const shape = SHAPES[SHAPE_PICK[ruinRng.i(0, SHAPE_PICK.length - 1)]];
        const q = ruinRng.i(0, 3);                       // quarter turns
        const a = ruinRng.f(0, 6.28), dist = ruinRng.f(0, (z.rad || 5) * 0.7);
        const cx = Math.round(z.cx + Math.cos(a) * dist), cy = Math.round(z.cy + Math.sin(a) * dist);
        const segs = shape.walls.map(s => {
          const [x, y] = turn(s.x, s.y, q);
          return { k: s.k, x: cx + x, y: cy + y, h: (q & 1) ? !s.h : s.h };
        });
        const cells = [];
        let ok = true;
        for (const s of segs) {
          const hx = s.h ? RUN[s.k] / 2 : THICK / 2, hy = s.h ? THICK / 2 : RUN[s.k] / 2;
          for (let y = Math.round(s.y - hy); ok && y <= Math.round(s.y + hy); y++)
            for (let x = Math.round(s.x - hx); x <= Math.round(s.x + hx); x++) {
              const c = inB(x, y) ? idx(x, y) : -1;
              if (!freeCell(c, 3)) { ok = false; break; }
              cells.push(c);
            }
        }
        if (ok && cells.some(c => !levelAt(c, flat.height[cells[0]]))) ok = false;
        if (!ok) continue;
        const id = ruinCellLists.length;
        ruinCellLists.push(cells);
        for (const c of cells) ruinCells.add(c);
        /* rot pi/2 turns the model's local-Z run onto the grid's x axis */
        for (const s of segs) props.push({
          kind: s.k, x: s.x, y: s.y, rot: s.h ? Math.PI / 2 : 0, scale: 1,
          roomId: roomId[idx(Math.round(s.x), Math.round(s.y))], ruin: id
        });
        /* A yard fence across the open side, with a gate gap where it has one. */
        if (shape.fence && ruinRng.chance(OC.ruins.fence ?? 0)) {
          const [fx0, fy0, fx1, fy1, gate] = shape.fence;
          const [ax, ay] = turn(fx0, fy0, q), [bx, by] = turn(fx1, fy1, q);
          props.push(...fenceSections(cx + ax, cy + ay, cx + bx, cy + by, gate, flat.height[cells[0]], { ruin: id }));
        }
      }
    }

    /* Free-standing fence runs: a straight line of sections on one of the eight
       compass/diagonal headings, sometimes turning a right angle halfway. Kept
       only if most of it stands, so it reads as a fence rather than litter. */
    if (OC.fences) {
      const F = OC.fences;
      const fRng = makeRng((seed ^ 0x7fe1ce05) >>> 0);
      const want = fRng.i(F.count[0], F.count[1]);
      const zones = rooms.filter(r => r.id !== entrance && r.id !== boss);
      let placed = 0;
      for (let tries = 0; zones.length && tries < want * 40 && placed < want; tries++) {
        const z = zones[fRng.i(0, zones.length - 1)];
        const a = fRng.f(0, 6.28), dist = fRng.f(0, (z.rad || 5) * 0.8);
        const sx = Math.round(z.cx + Math.cos(a) * dist), sy = Math.round(z.cy + Math.sin(a) * dist);
        const c0 = inB(sx, sy) ? idx(sx, sy) : -1;
        if (!freeCell(c0, 3)) continue;
        const head = fRng.i(0, 7) * Math.PI / 4;
        const n = fRng.i(F.len[0], F.len[1]);
        const bend = fRng.chance(F.turn ?? 0) ? Math.floor(n / 2) : -1;
        const bendDir = fRng.chance(0.5) ? 1 : -1;
        const h0 = flat.height[c0];
        /* lay the legs as lines so the sections share fenceSections' spacing */
        const legs = [];
        let x = sx, y = sy, hdg = head;
        for (const k of (bend > 0 ? [bend, n - bend] : [n])) {
          const x1 = x + Math.cos(hdg) * k * STAKE_SEG, y1 = y + Math.sin(hdg) * k * STAKE_SEG;
          legs.push([x, y, x1, y1]);
          x = x1; y = y1; hdg += bendDir * Math.PI / 2;
        }
        const marked = [...ruinCells];
        const run = legs.flatMap(([ax, ay, bx, by]) => fenceSections(ax, ay, bx, by, false, h0, { fence: placed }));
        if (run.length < Math.max(2, n - 1)) {
          /* too broken: give its cells back */
          ruinCells.clear(); for (const c of marked) ruinCells.add(c);
          continue;
        }
        props.push(...run);
        placed++;
      }
    }

    /* ---- arena terrain: thickets (ribbon arenas) ----
       Small knots of trees grown solid in the middle of a fight arena: WALL
       cells, so they stop movement and line of sight like the belt round the
       map, but planted at full density whatever the theme's treeDensity (the
       scene reads `thicketMask`). Large arenas get 2-3, medium 1-2, one fewer
       where the arena already has a bluff. They keep off the road band, the
       bluffs, ruins, graves, furniture and the monsters' spawn cells, and any
       knot that would cut off part of the map is put back as open ground. */
    const thicketMask = new Uint8Array(total);
    let thicketCount = 0;
    if (ribbon && OC.thickets !== false) {
      const tRng = makeRng((seed ^ 0x71c4e9d3) >>> 0);
      const eRoom = rooms[entrance];
      const startC = idx(eRoom.cx, eRoom.cy);
      const bfsQ = new Int32Array(total), bfsSeen = new Uint8Array(total);
      const reachCount = () => {
        bfsSeen.fill(0);
        if (grid[startC] !== FLOOR) return 0;
        let qh = 0, qt = 0; bfsQ[qt++] = startC; bfsSeen[startC] = 1;
        while (qh < qt) {
          const c = bfsQ[qh++];
          for (const n of [c - 1, c + 1, c - W, c + W])
            if (n >= 0 && n < total && !bfsSeen[n] && (grid[n] === FLOOR || grid[n] === POOL)) { bfsSeen[n] = 1; bfsQ[qt++] = n; }
        }
        return qt;
      };
      const nearSpawn = c => { for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (spawnTaken.has(c + oy * W + ox)) return true; return false; };
      let reached = reachCount();
      const mesaRooms = new Set(mesas.map(m => m.roomId));
      for (const r of rooms) {
        if (!r.arena || r.type !== TYPE.COMBAT) continue;
        let want = r.arena === 'large' ? tRng.i(2, 3) : tRng.i(1, 2);
        if (mesaRooms.has(r.id)) want--;
        for (let tries = 0; want > 0 && tries < 40; tries++) {
          const a = tRng.f(0, Math.PI * 2), dist = tRng.f(0.25, 0.75) * r.rad;
          const bx = r.cx + Math.cos(a) * dist, by = r.cy + Math.sin(a) * dist;
          const br = tRng.f(1.6, 2.6);
          /* a lumpy disc of open ground, minus what it may not cover, then
             only the part joined to its middle (so a knot never scatters) */
          const disc = new Set();
          for (let y = Math.floor(by - br - 1); y <= Math.ceil(by + br + 1); y++)
            for (let x = Math.floor(bx - br - 1); x <= Math.ceil(bx + br + 1); x++) {
              const d2 = (x - bx) * (x - bx) + (y - by) * (y - by);
              if (!inB(x, y) || d2 > (br + (hn(x, y, 17) - 0.5) * 1.1) ** 2) continue;
              const c = idx(x, y);
              if (grid[c] !== FLOOR || roadDist[c] < 4 || corridor[c] || doorway[c] || plotMask[c]
                || furniture.has(c) || ruinCells.has(c) || mesaCells.has(c) || thicketMask[c] || nearSpawn(c)) continue;
              disc.add(c);
            }
          const mid = idx(Math.round(bx), Math.round(by));
          if (!disc.has(mid)) continue;
          const blob = [], seen = new Set([mid]), q = [mid];
          while (q.length) {
            const c = q.pop(); blob.push(c);
            for (const n of [c - 1, c + 1, c - W, c + W]) if (disc.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
          }
          if (blob.length < 6) continue;
          const wasReached = blob.filter(c => bfsSeen[c]).length;
          for (const c of blob) grid[c] = WALL;
          const now = reachCount();
          if (now !== reached - wasReached) {
            for (const c of blob) grid[c] = FLOOR;
            reachCount();
            continue;
          }
          reached = now;
          for (const c of blob) thicketMask[c] = 1;
          thicketCount++;
          want--;
        }
      }
    }

    /* Every ground-prop kind an overland theme may name in `oc.ground`. A kind is
       only placed if the active theme gives it a density, so this list is a
       superset — but a kind missing from it can never be scattered, which is why
       the threshold-overland props (tombstone, pillars, icebone, caps…) are here. */
    const scatterKinds = ['mushroomLog', 'rocks', 'stump', 'vinemound', 'cairn', 'stakes', 'rack', 'goblinfire', 'skulltotem', 'bush', 'signpost', 'brokenSignpost', 'wheel',
      'tombstone', 'pillarA', 'pillarB', 'vase', 'icebone', 'anvil', 'coffin',
      'mushroomA', 'mushroomB', 'rootsA', 'rootsB', 'fren1', 'fren2', 'fren3', 'fren4', 'moss',
      'standingStoneA', 'standingStoneB', 'coolingRocks', 'lavaSpikeA', 'lavaSpikeB', 'snowcartA', 'snowcartB',
      'stoneWallA', 'stoneWallB', 'oldCart', 'oldWell', 'firewood',
      'oak', 'elm', 'birch', 'hawthorn', 'pollarded', 'spruce', 'fir', 'pine', 'snowspruce', 'snowfir', 'snowpine',
      'skull', 'bonePile', 'skeleton', 'bones', 'gallowsTree'];
    /* Clearings are big enough to fight across, so they need enough ground cover
       to break up the sightlines. `scatterGain` lifts every theme's ground
       densities together, keeping each theme's own prop MIX intact — tune this
       one number rather than editing nine density tables. */
    const gain = (OC.scatterGain ?? 2.0) * density;
    const BONE_KINDS = new Set(['icebone', 'skull', 'bonePile', 'skeleton', 'bones']);
    for (let y = 2; y < H - 2; y += 3) for (let x = 2; x < W - 2; x += 3) {
      const c = idx(x, y);
      if (grid[c] !== FLOOR || corridor[c] || plotMask[c] || arenaMask[c] || furniture.has(c) || ruinCells.has(c)) continue;
      if (hn(x, y, 4) < OC.ground.debris * gain * dmul('debris')) {
        props.push({ kind: 'debris', x, y, rot: rng.f(0, 6.28), scale: rng.f(0.7, 1.3), roomId: roomId[c], v: rng.i(0, 2) });
        continue;
      }
      for (let si = 0; si < scatterKinds.length; si++) {
        const k = scatterKinds[si], dens = OC.ground[k];
        if (!dens) continue;
        const km = k === 'moss' ? dmul('moss') : (BONE_KINDS.has(k) ? dmul('bones') : 1);
        if (hn(x, y, 6 + si) < dens * gain * km) {
          props.push({ kind: k, x, y, rot: rng.i(0, 3) * (Math.PI / 2), scale: rng.f(0.85, 1.2), roomId: roomId[c] });
          break;
        }
      }
    }

    /* Shorelines (oc.shore): reed clumps and the odd rotting rowboat drawn up
       on the bank, on the floor cells that touch water. Own RNG stream so the
       rest of the map doesn't reshuffle; skips the road, doorways and any cell
       a prop already stands on. */
    if (OC.shore) {
      const shRng = makeRng((seed ^ 0x5407e0b1) >>> 0);
      const taken = new Set(props.map(p => idx(Math.round(p.x), Math.round(p.y))));
      const shore = [];
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        const c = idx(x, y);
        if (grid[c] !== FLOOR || corridor[c] || doorway[c] || plotMask[c] || taken.has(c)) continue;
        const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => grid[idx(x + dx, y + dy)] === POOL);
        if (wet) shore.push({ x, y, dx: wet[0], dy: wet[1] });
      }
      for (let i = shore.length - 1; i > 0; i--) { const j = shRng.i(0, i); const t = shore[i]; shore[i] = shore[j]; shore[j] = t; }
      const S = OC.shore;
      const [bMin, bMax] = S.boats || [0, 0];
      let boats = bMax > 0 ? shRng.i(bMin, bMax) : 0;
      let reeds = 0;
      const used = new Set();
      for (const s of shore) {
        const c = idx(s.x, s.y);
        if (used.has(c)) continue;
        if (boats > 0) {
          /* moored broadside to the bank, overhanging the water by a little;
             the hull runs along the model's Z */
          const along = s.dx !== 0 ? 0 : Math.PI / 2;
          props.push({
            kind: 'rotBoat', x: s.x + s.dx * 0.35, y: s.y + s.dy * 0.35,
            rot: along + (shRng.chance(0.5) ? Math.PI : 0) + shRng.f(-0.12, 0.12),
            scale: shRng.f(0.9, 1.05), roomId: roomId[c]
          });
          for (let k = -1; k <= 1; k++) used.add(idx(s.x + (s.dy !== 0 ? k : 0), s.y + (s.dx !== 0 ? k : 0)));
          boats--;
          continue;
        }
        if (reeds < (S.cattailsMax || 0) && shRng.chance(S.cattails || 0)) {
          props.push({
            kind: shRng.chance(0.5) ? 'cattailsA' : 'cattailsB',
            x: s.x + s.dx * shRng.f(0.15, 0.4), y: s.y + s.dy * shRng.f(0.15, 0.4),
            rot: shRng.f(0, 6.28), scale: shRng.f(0.8, 1.15), roomId: roomId[c]
          });
          used.add(c);
          reeds++;
        }
      }
    }

    /* Winter sweep: ice shards in clusters on open ground, icicles hanging off the
       blockers that edge it. Mirrors the dungeon version so one slider drives both,
       but icicles ride lower here — overland blockers are trees about a third the
       height of a dungeon wall, so the dungeon's fixed 1.9 would float them above
       the canopy. */
    if (TH.icicles || DEC.icicles) {
      const im = dmul('icicles');
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const c = idx(x, y);
        if (grid[c] === WALL) {
          const d = grid[c + 1] === FLOOR ? [1, 0] : grid[c - 1] === FLOOR ? [-1, 0]
            : grid[c + W] === FLOOR ? [0, 1] : grid[c - W] === FLOOR ? [0, -1] : null;
          if (d && rng.chance(0.05 * density * im))
            props.push({
              kind: 'icicle', x, y, dx: d[0], dy: d[1], oy: -0.55,
              rot: rng.f(0, 6.28), scale: rng.f(0.6, 1.1)
            });
          continue;
        }
        if (grid[c] !== FLOOR || doorway[c]) continue;
        /* Thinner on the road itself so the trail stays readable. */
        if (!rng.chance((corridor[c] ? 0.012 : 0.03) * density * im)) continue;
        const rv = rng.raw();
        const n = rv < 0.5 ? 1 : (rv < 0.82 ? 2 : 3);
        for (let s = 0; s < n; s++) {
          const lead = s === 0;
          props.push({
            kind: 'shardIce', x, y,
            ox: lead ? rng.f(-0.14, 0.14) : rng.f(-0.34, 0.34),
            oz: lead ? rng.f(-0.14, 0.14) : rng.f(-0.34, 0.34),
            rot: rng.f(0, 6.28),
            scale: lead ? rng.f(0.55, 1.65) : rng.f(0.3, 0.9),
            roomId: roomId[c]
          });
        }
      }
    }


    /* ── reclaim orphans ──────────────────────────────────────────────────
       Runs LAST, after every pass that can edit the grid. Each liquid body is
       judged on its own against a running mask, so a road divider and a later
       pond can combine to pinch off a scrap of bank that neither would have
       severed alone — and widenNarrowDoorways, which runs after all of them,
       can carve a brand-new floor cell straight into a mere's edge.
       Ground the water has cut off is unreachable by definition, so leaving it
       as walkable floor is a lie: flood it and let it read as part of the mere.
       Only cells that WERE reachable before any liquid went down are touched,
       so pockets that were always walled off (inside a copse, say) stay dry. */
    if (flood4 && preLiquidReach) {
      const now = flood4(grid);
      for (let c = 0; c < total; c++) {
        if (grid[c] !== FLOOR || now[c]) continue;
        /* Reclaim ground the water orphaned, and any floor carved out later that
           was born unreachable. A cell that was already floor AND already
           unreachable before any liquid (a pocket inside a copse) is left dry —
           the water did not cause it. */
        if (preLiquidFloor[c] && !preLiquidReach[c]) continue;
        /* An orphan the water made is by definition touching that water, so
           flooding it MERGES into the body beside it — no lone one-tile pool.
           An orphan with no water against it was not caused by the liquids at
           all (a doorway nub carved into solid rock, reachable only across a
           corner); close that as rock instead, which is what it looks like. */
        const x = c % W, y = (c - x) / W;
        const wetNb = (x > 0 && grid[c - 1] === POOL)
          || (x < W - 1 && grid[c + 1] === POOL)
          || (y > 0 && grid[c - W] === POOL)
          || (y < H - 1 && grid[c + W] === POOL);
        if (wetNb) {
          grid[c] = POOL;
          pools.push({ x, y });
        } else {
          grid[c] = WALL;
        }
      }
    }

    /* ── Tall Swamp Grass (Moor, Mire, Forest, Boneyard, Sporewood) ───────
     * Wild swamp grass and reeds line the edges of water bodies and densely
     * frame the boundary where perimeter trees/walls meet the playable area. */
    const tKey = (params.themeKey || '').toLowerCase();
    let baseGrassChance = 0;
    if (tKey === 'mire') baseGrassChance = 0.88;
    else if (tKey === 'moor') baseGrassChance = 0.82;
    else if (tKey === 'forest' || tKey === 'holdfast') baseGrassChance = 0.65;
    else if (tKey === 'boneyard') baseGrassChance = 0.385;   // 0.55 less 30% (Zenu, 2026-11-01)
    else if (tKey === 'sporewood') baseGrassChance = 0.40;

    if (baseGrassChance > 0) {
      const grassKinds = ['swampgrass', 'swampgrass2', 'swampgrass3'];
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const c = idx(x, y);
          if (grid[c] !== FLOOR || doorway[c] || sunkMask[c]) continue;

          let wallNbCount = 0;
          let waterNbCount = 0;
          let wallDirX = 0;
          let wallDirY = 0;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nc = idx(x + dx, y + dy);
              if (nc < 0 || nc >= total) continue;
              if (grid[nc] === WALL) {
                wallNbCount++;
                wallDirX += dx;
                wallDirY += dy;
              } else if (grid[nc] === POOL) {
                waterNbCount++;
              }
            }
          }

          const nearWall = wallNbCount > 0;
          const nearWater = waterNbCount > 0;

          if (nearWall) {
            // Edges where trees/walls meet the play area — high density, thick treeline framing
            let chance = Math.min(0.98, baseGrassChance * (1.30 + wallNbCount * 0.10));
            if (corridor[c]) chance *= 0.65; // keep main overland road walkable while framed by grass

            if (rng.chance(chance * density)) {
              // Direction vector towards the adjacent trees
              const wLen = Math.hypot(wallDirX, wallDirY) || 1;
              const ndx = wallDirX / wLen;
              const ndy = wallDirY / wLen;
              const tax = -ndy;
              const tay = ndx;

              // Dense cluster: 3 to 6 clumps per edge tile hugging the tree trunks
              const roll = rng.raw();
              const count = roll < 0.22 ? 3 : (roll < 0.62 ? 4 : (roll < 0.88 ? 5 : 6));

              for (let s = 0; s < count; s++) {
                const kind = grassKinds[rng.i(0, grassKinds.length - 1)];
                // Bias offset towards the tree base (0.10 to 0.38 tiles into the tree border)
                const wallNudge = rng.f(0.10, 0.38);
                const tangentScatter = rng.f(-0.35, 0.35);
                const jitterAngle = rng.f(0, Math.PI * 2);
                const jitterRad = rng.f(0.04, 0.15);

                const gx = x + ndx * wallNudge + tax * tangentScatter + Math.cos(jitterAngle) * jitterRad;
                const gy = y + ndy * wallNudge + tay * tangentScatter + Math.sin(jitterAngle) * jitterRad;
                const rot = rng.f(0, 6.28);
                const scale = rng.f(0.85, 1.35);
                props.push({ kind, x: gx, y: gy, rot, scale, roomId: roomId[c] ?? 0 });
              }
            }
          } else if (nearWater) {
            // Along water shorelines / mere rims
            let chance = baseGrassChance * 1.25;
            if (corridor[c]) chance *= 0.45;

            if (rng.chance(chance * density)) {
              const roll = rng.raw();
              const count = roll < 0.25 ? 2 : (roll < 0.70 ? 3 : 4);
              for (let s = 0; s < count; s++) {
                const kind = grassKinds[rng.i(0, grassKinds.length - 1)];
                const angle = (s * (Math.PI * 2 / count)) + rng.f(-0.35, 0.35);
                const dist = count <= 2 ? rng.f(0.06, 0.20) : rng.f(0.14, 0.30);
                const gx = x + Math.cos(angle) * dist;
                const gy = y + Math.sin(angle) * dist;
                const rot = rng.f(0, 6.28);
                const scale = rng.f(0.80, 1.25);
                props.push({ kind, x: gx, y: gy, rot, scale, roomId: roomId[c] ?? 0 });
              }
            }
          } else {
            // Organic 2nd-row transition zone: distance 2 from tree borders
            let nearWall2 = false;
            for (let dy = -2; dy <= 2; dy++) {
              for (let dx = -2; dx <= 2; dx++) {
                if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) continue;
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && ny >= 0 && nx < W && ny < H && grid[idx(nx, ny)] === WALL) {
                  nearWall2 = true;
                  break;
                }
              }
              if (nearWall2) break;
            }

            if (nearWall2 && !corridor[c] && rng.chance(baseGrassChance * 0.36 * density)) {
              const roll = rng.raw();
              const count = roll < 0.60 ? 1 : 2;
              for (let s = 0; s < count; s++) {
                const kind = grassKinds[rng.i(0, grassKinds.length - 1)];
                const angle = rng.f(0, 6.28);
                const dist = rng.f(0.08, 0.26);
                const gx = x + Math.cos(angle) * dist;
                const gy = y + Math.sin(angle) * dist;
                const rot = rng.f(0, 6.28);
                const scale = rng.f(0.75, 1.15);
                props.push({ kind, x: gx, y: gy, rot, scale, roomId: roomId[c] ?? 0 });
              }
            }
          }
        }
      }
    }

    const { height, ramp, features: elevationFeatures } =
      buildOverlandElevation({ W, H, grid, corridor, rooms, entrance, boss, pools, lakeMask, params, props, bridges: riverDecks, flatCamp, mesas }, rng);

    /* Elevation is decided after the props, so a graveyard plot can land on a
       slope. Take any such plot back out: a fence across a step floats or sinks,
       and buildSolidProps never blocks a stair cell, so the ring would leak. */
    const tiltedPlots = new Set();
    plots.forEach((pl, k) => {
      const h0 = height[idx(pl.x0, pl.y0)];
      for (let y = pl.y0 - 1; y <= pl.y1 + 1; y++) for (let x = pl.x0 - 1; x <= pl.x1 + 1; x++) {
        const c = idx(x, y);
        if (height[c] !== h0 || ramp[c]) tiltedPlots.add(k);
      }
    });
    if (tiltedPlots.size) {
      for (let i = props.length - 1; i >= 0; i--)
        if (props[i].plot !== undefined && tiltedPlots.has(props[i].plot)) props.splice(i, 1);
    }
    /* Same for ruins: a wall run across a step would float or sink, so a ruin
       that is not on one level goes, all of its walls together. */
    const tiltedRuins = new Set();
    ruinCellLists.forEach((cells, k) => {
      const h0 = height[cells[0]];
      if (cells.some(c => height[c] !== h0 || ramp[c])) tiltedRuins.add(k);
    });
    if (tiltedRuins.size) {
      for (let i = props.length - 1; i >= 0; i--)
        if (props[i].ruin !== undefined && tiltedRuins.has(props[i].ruin)) props.splice(i, 1);
    }

    /* No Shrine of Light on overland maps (Zenu, 2026-10-27): it is a dungeon
       feature. Overland shrines stay campfires (lightShrine:false), so
       chooseLightShrine is deliberately not called here. */

    const weatherEnv = resolveOverlandEnvironment(params.themeKey, seed, params);
    const effectiveTheme = buildEffectiveOverlandTheme(TH, weatherEnv);

    return {
      valid: reach === floorTotal && floorTotal > 0, overland: true, palisadeMask,
      params, seed, name: dungeonName(rng, TH), themeKey: params.themeKey,
      weather: weatherEnv.weather, timeOfDay: weatherEnv.timeOfDay, weatherEnv, effectiveTheme,
      /* roadDist: tiles from the trail centreline (-1 = past the band). The
         renderer draws the road surface from it on themes with groundTiles. */
      W, H, grid, roomId, corridor, doorway, bfs, maxBfs, roadDist, mesas, thicketMask,
      height, ramp, elevationFeatures,
      rooms, edges, entrance, boss, maxDepth: rooms.maxDepth || 4,
      props, spawns, torches: [], pools, lakeCells, lakeMask, arches,
      stats: {
        rooms: N, edges: edges.length, loops: edges.filter(e => e.isLoop).length, critLen: 0, floorTiles: floorTotal, reach, genMs: performance.now() - t0, attempts: 1,
        graveyards: plots.length - tiltedPlots.size, graveyardsTilted: tiltedPlots.size,
        ruins: ruinCellLists.length - tiltedRuins.size, ruinsTilted: tiltedRuins.size, thickets: thicketCount, mesas: mesas.length,
        river: riverCount
      }
    };
  }

  /* ─────────────────────── Multi-tile liquid bodies ───────────────────────
   * Liquids used to be single tiles: one POOL cell per alcove, one pit per room.
   * These two helpers grow them into pools, rivers and lava flows instead.
   *
   * The hard constraint is that POOL is NOT walkable (pathfinding only crosses
   * FLOOR), so a body grown across open floor can wall the party off from the
   * stairs. Bodies carved out of WALL are always safe — they replace cells that
   * already blocked movement — but bodies grown over FLOOR must be checked with
   * floorStaysConnected before they are committed.
   */

  /**
   * Grow an organic blob of `size` cells outward from `seed`.
   *
   * Randomised frontier selection (rather than a strict BFS queue) is what makes
   * the shapes read as puddles and flows instead of diamonds. `canTake(cell)`
   * decides which cells are eligible — callers pass a WALL test or a FLOOR test.
   * Returns the cell list, seed first; it may be shorter than `size` (or just the
   * seed) when growth runs out of room.
   */
  function growLiquidBody(W, H, seed, size, canTake, rng) {
    const taken = [seed];
    const inBlob = new Set([seed]);
    let frontier = [seed];

    while (taken.length < size && frontier.length) {
      /* pull a random frontier cell so growth wanders instead of expanding in
         neat rings */
      const fi = rng.i(0, frontier.length - 1);
      const from = frontier[fi];
      const fx = from % W, fy = (from - (from % W)) / W;

      const opts = [];
      const push = (nx, ny) => {
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) return;
        const n = ny * W + nx;
        if (inBlob.has(n) || !canTake(n)) return;
        opts.push(n);
      };
      push(fx + 1, fy); push(fx - 1, fy); push(fx, fy + 1); push(fx, fy - 1);

      if (!opts.length) { frontier.splice(fi, 1); continue; }
      const next = opts[rng.i(0, opts.length - 1)];
      taken.push(next);
      inBlob.add(next);
      frontier.push(next);
    }
    return taken;
  }

  /**
   * Mask of FLOOR cells reachable from `fromCell` (4-way, FLOOR only).
   *
   * This is the baseline that liquid placement is judged against. It is NOT the
   * same as "every FLOOR cell": overland maps legitimately contain small pockets
   * fenced off by copses, so testing against the total floor count would reject
   * every candidate body out there.
   */
  function reachableFloorMask(grid, W, H, fromCell) {
    const seen = new Uint8Array(grid.length);
    if (fromCell < 0 || grid[fromCell] !== FLOOR) return seen;
    const stack = [fromCell];
    seen[fromCell] = 1;
    while (stack.length) {
      const c = stack.pop();
      const x = c % W;
      const tryN = n => {
        if (n < 0 || n >= grid.length || seen[n] || grid[n] !== FLOOR) return;
        seen[n] = 1; stack.push(n);
      };
      if (x > 0) tryN(c - 1);
      if (x < W - 1) tryN(c + 1);
      tryN(c - W);
      tryN(c + W);
    }
    return seen;
  }

  /**
   * Would turning every cell in `body` into non-walkable liquid cut anything off?
   *
   * Re-floods with `body` treated as solid and requires that every cell the
   * `baseline` mask says was reachable — minus the body itself — is still
   * reachable. That is the precise property we care about: the body may consume
   * floor, but it must not strand floor. Mutates nothing.
   *
   * Called a few dozen times per map, so the O(cells) re-flood per candidate is
   * not worth optimising.
   */
  function floorStaysConnected(grid, W, H, body, fromCell, baseline) {
    const blocked = new Set(body);
    if (blocked.has(fromCell)) return false;
    if (grid[fromCell] !== FLOOR) return false;

    /* how many baseline-reachable cells should survive */
    let expected = 0;
    for (let i = 0; i < baseline.length; i++) if (baseline[i] && !blocked.has(i)) expected++;
    if (expected === 0) return false;

    const seen = new Uint8Array(grid.length);
    const stack = [fromCell];
    seen[fromCell] = 1;
    let reached = 0;
    while (stack.length) {
      const c = stack.pop();
      if (baseline[c]) reached++;
      const x = c % W;
      const tryN = n => {
        if (n < 0 || n >= grid.length || seen[n] || grid[n] !== FLOOR || blocked.has(n)) return;
        seen[n] = 1; stack.push(n);
      };
      if (x > 0) tryN(c - 1);
      if (x < W - 1) tryN(c + 1);
      tryN(c - W);
      tryN(c + W);
    }
    return reached === expected;
  }

  function widenNarrowDoorways(grid, W, H, corridor, doorway, roomId) {
    const idx = (x, y) => y * W + x;
    const inB = (x, y) => x >= 2 && y >= 2 && x < W - 2 && y < H - 2;

    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const c = idx(x, y);
        if (grid[c] !== FLOOR) continue;

        // Vertical 1-tile doorway (left & right are WALL, top & bottom are FLOOR)
        if (grid[idx(x - 1, y)] === WALL && grid[idx(x + 1, y)] === WALL &&
          grid[idx(x, y - 1)] === FLOOR && grid[idx(x, y + 1)] === FLOOR) {
          let carved = false;
          if (inB(x + 1, y)) {
            grid[idx(x + 1, y)] = FLOOR;
            if (corridor && corridor[c]) corridor[idx(x + 1, y)] = 1;
            if (doorway) { doorway[idx(x + 1, y)] = 1; doorway[c] = 1; }
            if (roomId && roomId[c] >= 0) roomId[idx(x + 1, y)] = roomId[c];
            carved = true;
          }
          if (!carved && inB(x - 1, y)) {
            grid[idx(x - 1, y)] = FLOOR;
            if (corridor && corridor[c]) corridor[idx(x - 1, y)] = 1;
            if (doorway) { doorway[idx(x - 1, y)] = 1; doorway[c] = 1; }
            if (roomId && roomId[c] >= 0) roomId[idx(x - 1, y)] = roomId[c];
          }
        }
        // Horizontal 1-tile doorway (top & bottom are WALL, left & right are FLOOR)
        else if (grid[idx(x, y - 1)] === WALL && grid[idx(x, y + 1)] === WALL &&
          grid[idx(x - 1, y)] === FLOOR && grid[idx(x + 1, y)] === FLOOR) {
          let carved = false;
          if (inB(x, y + 1)) {
            grid[idx(x, y + 1)] = FLOOR;
            if (corridor && corridor[c]) corridor[idx(x, y + 1)] = 1;
            if (doorway) { doorway[idx(x, y + 1)] = 1; doorway[c] = 1; }
            if (roomId && roomId[c] >= 0) roomId[idx(x, y + 1)] = roomId[c];
            carved = true;
          }
          if (!carved && inB(x, y - 1)) {
            grid[idx(x, y - 1)] = FLOOR;
            if (corridor && corridor[c]) corridor[idx(x, y - 1)] = 1;
            if (doorway) { doorway[idx(x, y - 1)] = 1; doorway[c] = 1; }
            if (roomId && roomId[c] >= 0) roomId[idx(x, y - 1)] = roomId[c];
          }
        }
      }
    }
  }

