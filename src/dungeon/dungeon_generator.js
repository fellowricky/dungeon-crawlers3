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
/* The theme's roster CRs. The purse must only ever buy a CR the roster can
   actually field, or the price paid stops matching the creature placed. */
import { dungeonMonsterCRs, isRoomStyleEnabled } from '../game/srd.js';
import { buildElevation } from './elevation.js';
import { getPropFootprintCells, SOLID_PROP_KINDS, PODIUM_PROP_KINDS } from '../game/pathfinding.js';
export { SPAWN_BUDGET };

export function getSpawnBudget() {
  let edits = null;
  try {
    const raw = globalThis.localStorage?.getItem('dc_spawn_budget_edits');
    if (raw) edits = JSON.parse(raw);
  } catch {}
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
export function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed){
  const r = mulberry32(seed);
  return {
    f:(a,b)=> a + r()*(b-a),
    i:(a,b)=> a + Math.floor(r()*(b-a+1)),
    pick:(arr)=> arr[Math.floor(r()*arr.length)],
    chance:(p)=> r() < p,
    raw:r,
    gauss(mu,sig){ let u=0,v=0; while(u===0)u=r(); while(v===0)v=r();
      return mu + sig*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
  };
}

/* ---------------- constants ---------------- */
export const VOID=0, FLOOR=1, WALL=2, POOL=3;
export const TYPE = { ENTRANCE:'entrance', COMBAT:'combat', ELITE:'elite', TREASURE:'treasure', SHRINE:'shrine', BOSS:'boss', RIVAL:'rival' };
export const TINT = { entrance:0x3fd0bb, combat:0x8f95a3, elite:0x9b6cf0, treasure:0xd9a441, shrine:0x5a8fe8, boss:0xd8433a, rival:0xe8973f };

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
    label:'ANCIENT', accent:'#e8973f',
    bg:0x141a22, fog:0x141a22, fogD:0.0020,
    hemi:[0x485c72, 0x1c2028, 0.52], dir:[0xedd5b8, 0.75],
    floor:0x646a78, corridor:0x505866, wall:0x424a58, cap:0x545a68,
    pillar:0x4a505e, debris:[0x383e4a, 0x504438],
    flame:0xffa640, flameCore:0xfff3c8, torchLight:[0xff8c3a, 1.5, 9.5],
    cloth:0x5c201b,
    tile:{runes:0.55},
    propScatter:{ vase:0.0025, grainjars:0.0035 },
    pools:null, particles:{kind:0, color:0x8894ac, n:110},
    nameA:['Sunken','Forgotten','Silent','Hollow','Elder','Broken','Nameless','Fallen'],
    nameB:['Halls','Vaults','Catacombs','Depths','Sanctum','Undercroft','Barrows','Reliquary']
  },
  molten: {
    label:'MOLTEN', accent:'#ff8642',
    bg:0x161010, fog:0x1c1414, fogD:0.0022,
    hemi:[0x5c3826, 0x1a0e0c, 0.50], dir:[0xffc898, 0.60],
    /* walls/caps are cool basalt grey, not warm brown: every light in this
       theme is orange (hemi, dir and torches), so a warm albedo compounds into
       tan. The fire colour comes from the lighting and lava, not the rock. */
    floor:0x645448, corridor:0x504036, wall:0x2a2c33, cap:0x36383f,
    pillar:0x4a3b30, debris:[0x382a20, 0x503a28],
    flame:0xff8c26, flameCore:0xffe9b0, torchLight:[0xff7326, 1.7, 10],
    cloth:0x54180e,
    tile:{embers:0.05},
    propScatter:{ anvil:0.002, stalagmite:0.005, boulderPile:0.004, forgeChains:0.0035, ingotStack:0.0025, smeltingCrucible:0.002 },
    pools:{mode:0, colA:0x2b0d05, colB:0xff5a1f, glow:1.75, amount:0.16, pits:2,
           /* [min,max] cells per body: wall-seepage flows, then floor pits */
           body:[4,9], pitBody:[3,6]},
    particles:{kind:1, color:0xff8030, n:420},
    nameA:['Molten','Ashen','Cindered','Smouldering','Charred','Burning','Ember','Scorched'],
    nameB:['Forges','Furnaces','Calderas','Foundry','Kilns','Vents','Crucible','Depths']
  },
  frost: {
    label:'FROST', accent:'#7fd4ff',
    bg:0x101824, fog:0x162232, fogD:0.0022,
    hemi:[0x425d7e, 0x121824, 0.50], dir:[0xcfe4ff, 0.72],
    floor:0x6c7a8e, corridor:0x546274, wall:0x445268, cap:0x5e6e82,
    pillar:0x506074, debris:[0x3e4d64, 0x586478],
    flame:0x86d9ff, flameCore:0xe8f7ff, torchLight:[0x6fc4ff, 1.35, 9.5],
    cloth:0x1b3550,
    tile:{rime:0.5, rough:0.62},
    propScatter:{ icebone:0.003 },
    pools:{mode:1, colA:0x4a86c0, colB:0xbfe4ff, glow:0.55, amount:0, body:[3,6], pitBody:[2,4]},
    lakes:true, icicles:true, particles:{kind:2, color:0xe8f4ff, n:350},
    nameA:['Frozen','Rimebound','Glacial','Howling','Pale','Shivering','Wintered','Whitelocked'],
    nameB:['Crypts','Caverns','Hollows','Galleries','Sepulchre','Warrens','Reaches','Throat']
  },
  grim: {
    label:'GRIM', accent:'#9fe66a',
    bg:0x101610, fog:0x141e14, fogD:0.0025,
    hemi:[0x324638, 0x101610, 0.48], dir:[0xb8d0aa, 0.52],
    floor:0x56624e, corridor:0x44503e, wall:0x343e2e, cap:0x4b5642,
    pillar:0x424c3a, debris:[0x323c2d, 0x4a4834],
    flame:0x8fe05a, flameCore:0xe9ffd0, torchLight:[0x77d94a, 1.35, 9],
    cloth:0x223014,
    tile:{stains:0.07},
    pools:{mode:3, colA:0x0a1207, colB:0x41602c, glow:0.6, amount:0.05, pits:1, body:[3,7], pitBody:[2,5]},
    graveyards:true, bones:true, particles:{kind:3, color:0x7ec44e, n:150},
    groundFog:{density:0.20, speed:0.02, color:0x84a872, scale:0.11, height:0.20},
    nameA:['Blighted','Weeping','Rotting','Cursed','Umbral','Plagued','Mournful','Grim'],
    nameB:['Necropolis','Ossuary','Tombs','Charnels','Graves','Catacombs','Morgue','Crypts']
  },
  verdant: {
    label:'VERDANT', accent:'#59d68f',
    bg:0x141810, fog:0x1c2016, fogD:0.0022,
    /* daylight filtering into the overgrowth: warm white sun plus a soft warm
       ambient, rather than the green-on-green it used to be. The theme's green
       still comes from the foliage, the torch flames and the pool glow. */
    hemi:[0x7a7a5e, 0x18160f, 0.52], dir:[0xffeccb, 0.72],
    /* walls/caps sit near-neutral so the vine-brick tile shows its own brown
       and green; a green tint here would filter the brick back out to moss */
    floor:0x54321e, corridor:0x452818, wall:0x5c5c54, cap:0x6a6a60,
    pillar:0x405038, debris:[0x2f3e26, 0x465038],
    flame:0xffcf6a, flameCore:0xfff6da, torchLight:[0xffd28a, 1.35, 9],
    cloth:0x143624,
    tile:{growth:0.45, sprout:0.04},
    propScatter:{ fren1:0.0012, fren2:0.0012, fren3:0.0012, fren4:0.0012, mushroomA:0.003, mushroomB:0.003, rootsA:0.0025, rootsB:0.0025 },
    pools:{mode:2, colA:0x0c3532, colB:0x2fa38a, glow:0.6, amount:0.05, pits:1, body:[4,9], pitBody:[3,6]},
    roots:true, shafts:false, particles:{kind:4, color:0x6cb88e, n:200},
    nameA:['Verdant','Overgrown','Sporebound','Tangled','Mossgrown','Waking','Feral','Blooming'],
    nameB:['Gardens','Warrens','Roots','Conservatory','Hollows','Groves','Cisterns','Arbors']
  },
  forest: {
    label:'FOREST', accent:'#8fd45a', overland:true,
    bg:0x1a242c, fog:0x1e2832, fogD:0.0016,
    hemi:[0x50657a, 0x1e261d, 0.50], dir:[0xedd5b8, 0.68],
    floor:0x4a643c, corridor:0x6e604d, wall:0x4a463e, cap:0x325228,
    pillar:0x52483a, debris:[0x585c54, 0x765e48],
    flame:0xffa640, flameCore:0xfff3c8, torchLight:[0xff8c3a, 1.5, 9.5],
    cloth:0x61341a,
    tile:{},
    oc:{ liquid:{ amount:0.020, body:[6,14] },   /* woodland ponds */
         roadBand:[2, 2],
         ground:{ tree:0.012, mushroomLog:0.05, rocks:0.06, stump:0.04, vinemound:0.03, cairn:0.02, stakes:0.018, rack:0.015, goblinfire:0.015, skulltotem:0.008 } },
    pools:{mode:2, colA:0x0d2a33, colB:0x3f9ec4, glow:0.40, amount:0},
    particles:{kind:5, color:0x98bed2, n:450},
    groundFog:{density:0.12, speed:0.02, color:0xb4c8b6, scale:0.08, height:0.12},
    nameA:['Greenrise','Bramblewood','Thornfell','Wildmere','Oakshade','Ferndeep','Mosswild','Tanglebrook'],
    nameB:['Glade','Hollow','Camp','Crossing','Thicket','Clearing','Trailhead','Verge']
  },
  moor: {
    label:'MOOR', accent:'#c9b877', overland:true,
    bg:0x1b201a, fog:0x242a22, fogD:0.0022,
    hemi:[0x525848, 0x1c1e18, 0.50], dir:[0xd8d4bc, 0.60],
    floor:0x58623f, corridor:0x6e644e, wall:0x4e5046, cap:0x4e582c,
    pillar:0x4e4b44, debris:[0x48443b, 0x525039],
    flame:0xffa640, flameCore:0xfff3c8, torchLight:[0xff8c3a, 1.4, 9],
    cloth:0x3d331d,
    tile:{},
    blocker:{ trunkH:0.34, trunkR:2.1, canopyS:1.45, canopyY:0.10 },
    oc:{ liquid:{ amount:0.024, body:[5,12] },   /* peat bog pools */
         roadBand:[3, 3],
         edgeMin:1, edgeRand:2, belt:0.16, beltLinked:0.05, lone:0.034,
         copseDiv:820, copseChance:0.55,
         camp:{ palisade:false, tents:0, bones:true },
         ground:{ tree:0.008, swamptree:0.008, debris:0.05, moss:0.018, bush:0.05, signpost:0.008, brokenSignpost:0.008, wheel:0.012 } },
    pools:{mode:3, colA:0x141a0e, colB:0x4a5a2c, glow:0.30, amount:0},
    groundFog:{density:0.28, speed:0.035, color:0xd6ded2, scale:0.10, height:0.24},
    nameA:['Windbare','Greyfell','Cairnmoor','Highfold','Stonecrop','Coldrise','Hetherwold','Longbarrow'],
    nameB:['Moor','Downs','Drove-road','Heath','Pasture','Sinkhole','Reach','Waste']
  },
  mire: {
    label:'MIRE', accent:'#6f9a72', overland:true,
    bg:0x101614, fog:0x161e1b, fogD:0.0032,
    hemi:[0x3c4c42, 0x121614, 0.46], dir:[0xadbcad, 0.50],
    floor:0x3a4234, corridor:0x464434, wall:0x323028, cap:0x36382a,
    pillar:0x312e26, debris:[0x282a20, 0x343124],
    flame:0x9ad6a0, flameCore:0xe0ffe4, torchLight:[0x76c48a, 1.2, 8],
    cloth:0x1e2619,
    tile:{stains:0.10},
    blocker:{ trunkH:1.35, trunkR:0.85, canopyS:0.34, canopyY:0.72 },
    oc:{ liquid:{ amount:0.060, body:[20,48], bridge:'wood' },  /* broad meres, planked over */
         roadBand:[2, 2],
         edgeMin:3, edgeRand:4, belt:0.78, beltLinked:0.14, lone:0.05,
         copseDiv:250, copseChance:0.8,
         camp:{ palisade:false, tents:0, bones:true },
         ground:{ swamptree:0.008, deadtree:0.008, debris:0.012, moss:0.11 } },
    pools:{mode:3, colA:0x070d09, colB:0x2f4a34, glow:0.35, amount:0.22, pits:2, body:[3,7], pitBody:[2,5]},
    particles:{kind:5, color:0x82a898, n:350},
    groundFog:{density:0.22, speed:0.025, color:0x809c84, scale:0.12, height:0.18},
    nameA:['Marrowfen','Blackwater','Sunkmoss','Drownfield','Reedmourn','Stillwater','Bogrun','Quagmire'],
    nameB:['Fen','Mire','Sinks','Causeway','Shallows','Marsh','Drownings','Verge']
  },
  holdfast: {
    label:'HOLDFAST', accent:'#e0a24a', overland:true,
    bg:0x171410, fog:0x241d15, fogD:0.0018,
    hemi:[0xd8c2a0, 0x2e2820, 0.58], dir:[0xffe0b0, 0.66],
    floor:0x6f7a4e, corridor:0xa08d63, wall:0x7a6a52, cap:0x5e7040,
    pillar:0x86755a, debris:[0x6b6152, 0x7a6a4a],
    flame:0xffb452, flameCore:0xfff6d2, torchLight:[0xffa04a, 1.6, 10],
    cloth:0x8e2b24,
    tile:{},
    stake:0x9a825e, stakeCap:0x7a6448,
    blockerGeo:'block', blockerH:[1.15, 0.65],
    oc:{ liquid:{ amount:0.010, body:[4,8] },    /* cisterns & moat remnants */
         roadBand:[3, 2],
         edgeMin:2, edgeRand:2, belt:0.30, beltLinked:0.03, lone:0.012,
         copseDiv:700, copseChance:0.6,
         camp:{ palisade:true, tents:[6,8], bones:false },
         /* settled, worked ground — drill stakes, weapon racks, cart wreckage */
         ground:{ debris:0.035, moss:0.030, stakes:0.030, rack:0.020,
                  wheel:0.018, signpost:0.012, bush:0.025, cairn:0.012 } },
    pools:{mode:2, colA:0x11242b, colB:0x3d8ba6, glow:0.35, amount:0}, particles:{kind:0, color:0xe8d8a8, n:120},
    nameA:['Aldergate','Kingsmuster','Charterhall','Wardstone','Oathkeep','Highmarch','Stoneyard','Banneret'],
    nameB:['Holdfast','Chapterhouse','Muster','Yard','Bastion','Proving-ground','Gate','Bailey']
  },

  /* ---- threshold overlands: the doorstep of each dungeon theme ----
     These are the floor-2 surfaces of the overland prologue (see
     game/overland_prologue.js). Each one is the dungeon theme's own country
     seen from above ground, so the walk in reads as one continuous descent.
     `blockerGeo` picks the wall silhouette ('tree' trunks+canopy, the original
     overland look, or 'block' masonry), `groundMat` picks the floor texture,
     and `canopyTint` recolors the foliage blend on tree blockers. */
  boneyard: {
    label:'BONEYARD', accent:'#9fd08a', overland:true, threshold:'grim',
    bg:0x151a16, fog:0x1b221c, fogD:0.0024,
    hemi:[0x4a5850, 0x161a16, 0.50], dir:[0xc8ccc0, 0.55],
    floor:0x4e5844, corridor:0x5e5c4c, wall:0x6e7068, cap:0x7a7c72,
    pillar:0x6a6c64, debris:[0x4a4c44, 0x5c5a4e],
    flame:0x8fe05a, flameCore:0xe9ffd0, torchLight:[0x77d94a, 1.3, 9],
    cloth:0x223014,
    tile:{stains:0.05},
    blockerGeo:'block', blockerH:[1.0, 0.55], groundMat:'grass',
    oc:{ liquid:{ amount:0.014, body:[4,10] },   /* stagnant grave water */
         roadBand:[2, 2],
         edgeMin:2, edgeRand:2, belt:0.34, beltLinked:0.05, lone:0.018,
         copseDiv:620, copseChance:0.50,
         camp:{ palisade:false, tents:0, bones:true },
         ground:{ tombstone:0.085, cairn:0.020, bush:0.030, stakes:0.012,
                  rocks:0.018, debris:0.022, moss:0.020 } },
    pools:{mode:3, colA:0x0d120e, colB:0x38492f, glow:0.28, amount:0},
    particles:{kind:3, color:0x98c088, n:200},
    groundFog:{density:0.22, speed:0.02, color:0xb0c2ac, scale:0.11, height:0.20},
    nameA:['Gravewatch','Lychfield','Bonerow','Mournhill','Silentyard','Palerow','Cold-earth','Wakeless'],
    nameB:['Boneyard','Graves','Lychyard','Burial-field','Gravewalk','Grave-rows','Potter’s Field','Restings']
  },
  ruinfield: {
    label:'RUINFIELD', accent:'#e8973f', overland:true, threshold:'ancient',
    bg:0x1c1b18, fog:0x252219, fogD:0.0018,
    hemi:[0x7a7462, 0x24211a, 0.54], dir:[0xf0dcb8, 0.70],
    floor:0x7a705a, corridor:0x8c8064, wall:0x6e6a60, cap:0x7e7a6e,
    pillar:0x76726a, debris:[0x5c584e, 0x6e6656],
    flame:0xffa640, flameCore:0xfff3c8, torchLight:[0xff8c3a, 1.5, 9.5],
    cloth:0x5c201b,
    tile:{runes:0.30},
    blockerGeo:'block', blockerH:[1.25, 0.7], groundMat:'floor',
    oc:{ liquid:{ amount:0.016, body:[5,11] },   /* flooded foundations */
         roadBand:[3, 2],
         edgeMin:2, edgeRand:3, belt:0.40, beltLinked:0.06, lone:0.020,
         copseDiv:560, copseChance:0.55,
         camp:{ palisade:false, tents:[3,4], bones:true },
         ground:{ pillarA:0.020, pillarB:0.020, vase:0.018, rocks:0.045,
                  cairn:0.018, debris:0.040 } },
    pools:{mode:2, colA:0x122529, colB:0x46909e, glow:0.35, amount:0}, particles:{kind:0, color:0xbfae8c, n:140},
    nameA:['Sunken','Toppled','Nameless','Weathered','Drift-buried','Elder','Broken','Wind-scoured'],
    nameB:['Ruins','Colonnade','Plaza','Foundations','Terraces','Stones','Concourse','Approach']
  },
  ashfield: {
    label:'ASHFIELD', accent:'#ff8642', overland:true, threshold:'molten',
    bg:0x18100c, fog:0x241610, fogD:0.0028,
    hemi:[0x6a3824, 0x1c100a, 0.50], dir:[0xffb488, 0.52],
    floor:0x4a4038, corridor:0x5a4c3e, wall:0x38302c, cap:0x463a34,
    pillar:0x3e3630, debris:[0x2e2824, 0x4a3a2c],
    flame:0xff8c26, flameCore:0xffe9b0, torchLight:[0xff7326, 1.7, 10],
    cloth:0x54180e,
    tile:{embers:0.035},
    blockerGeo:'block', blockerH:[1.35, 0.8], groundMat:'floor',
    oc:{ liquid:{ amount:0.022, body:[7,16] },   /* open lava flows */
         roadBand:[3, 2],
         edgeMin:2, edgeRand:3, belt:0.42, beltLinked:0.07, lone:0.026,
         copseDiv:480, copseChance:0.58,
         camp:{ palisade:false, tents:[3,5], bones:true },
         ground:{ rocks:0.055, anvil:0.010, stakes:0.014, skulltotem:0.008,
                  cairn:0.016, debris:0.035 } },
    pools:{mode:0, colA:0x2b0d05, colB:0xff5a1f, glow:1.45, amount:0},
    particles:{kind:6, color:0xff9450, n:420},
    groundFog:{density:0.16, speed:0.03, color:0x4a2a20, scale:0.09, height:0.16},
    nameA:['Cinderflat','Ashfall','Scoriawaste','Emberreach','Slagfield','Smouldering','Blackglass','Vent-scarred'],
    nameB:['Ashfields','Flows','Cinder-cones','Slaglands','Burnt-waste','Vents','Barrens','Approach']
  },
  snowfield: {
    label:'SNOWFIELD', accent:'#7fd4ff', overland:true, threshold:'frost',
    bg:0x16202e, fog:0x1e2c3e, fogD:0.0026,
    hemi:[0x6d88a8, 0x1a2230, 0.56], dir:[0xe4f0ff, 0.78],
    floor:0x9aa8b8, corridor:0x8494a6, wall:0x4a4238, cap:0x8fa6b4,
    pillar:0x5a6472, debris:[0x64707e, 0x7e8a96],
    flame:0x86d9ff, flameCore:0xe8f7ff, torchLight:[0x6fc4ff, 1.35, 9.5],
    cloth:0x1b3550,
    tile:{rime:0.45, rough:0.55},
    blockerGeo:'tree', canopyTint:0xdfe9f2, groundMat:'grass',
    blocker:{ trunkH:1.15, trunkR:0.55, canopyS:0.62, canopyY:0.62 },
    icicles:true,
    oc:{ liquid:{ amount:0.020, body:[8,18] },   /* frozen meltwater */
         roadBand:[3, 3],
         edgeMin:2, edgeRand:3, belt:0.44, beltLinked:0.07, lone:0.030,
         copseDiv:420, copseChance:0.62,
         camp:{ palisade:false, tents:[3,5], bones:true },
         ground:{ snowtree:0.014, tree_winter:0.014, icebone:0.048, cairn:0.024, rocks:0.038, signpost:0.008,
                  brokenSignpost:0.008, debris:0.020 } },
    pools:{mode:1, colA:0x4a86c0, colB:0xbfe4ff, glow:0.50, amount:0},
    particles:{kind:2, color:0xffffff, n:500},
    nameA:['Whitewaste','Windbite','Palefall','Frostmarch','Snowbound','Rimeflat','Coldreach','Glacier-edge'],
    nameB:['Snowfield','Pass','White-waste','Drifts','Crossing','Barrens','Windrow','Approach']
  },
  sporewood: {
    label:'SPOREWOOD', accent:'#59d68f', overland:true, threshold:'verdant',
    bg:0x0f1712, fog:0x142018, fogD:0.0032,
    hemi:[0x2e4738, 0x0f1712, 0.52], dir:[0x8fd6a4, 0.65],
    floor:0x223326, corridor:0x2a3d2e, wall:0x2a2233, cap:0x287d52,
    pillar:0x28382c, debris:[0x1c2b20, 0x2e4233],
    flame:0x59d68f, flameCore:0xdaffed, torchLight:[0x4ad98e, 1.4, 9.5],
    cloth:0x123020,
    tile:{growth:0.45, sprout:0.04},
    blockerGeo:'tree', canopyTint:0x59d68f, groundMat:'grass',
    blocker:{ trunkH:0.75, trunkR:0.75, canopyS:1.2, canopyY:0.55 },
    oc:{ liquid:{ amount:0.020, body:[5,12] },   /* spore-clouded seeps */
         roadBand:[2, 2],
         edgeMin:3, edgeRand:3, belt:0.58, beltLinked:0.10, lone:0.040,
         copseDiv:300, copseChance:0.72,
         camp:{ palisade:false, tents:0, bones:true },
         ground:{ swamptree:0.012, mushroomA:0.048, mushroomB:0.048, rootsA:0.028, rootsB:0.028,
                  fren1:0.012, fren2:0.012, fren3:0.012, fren4:0.012,
                  vinemound:0.028, moss:0.090 } },
    pools:{mode:3, colA:0x0a1a12, colB:0x3fa06a, glow:0.55, amount:0},
    particles:{kind:4, color:0x8fd0a0, n:300},
    groundFog:{density:0.18, speed:0.02, color:0x58b07a, scale:0.10, height:0.16},
    nameA:['Sporebound','Capfell','Mycelian','Blightbloom','Rotcap','Veilspore','Dampwood','Fruiting'],
    nameB:['Sporewood','Grove','Caps','Bloom','Thicket','Mouth','Hollow','Approach']
  }
};
/* Tuning layer written by the dungeon editor (dungeon_editor.html). Values here
   are merged over the tables above, so THEMES stays the readable default and a
   tuning pass is a small reviewable diff instead of edits scattered through the
   theme literals. Nested objects merge key-by-key; arrays replace wholesale. */
function mergeThemeOverrides(base, patch){
  for(const k of Object.keys(patch || {})){
    const v = patch[k];
    if(v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])){
      mergeThemeOverrides(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}
for(const key of Object.keys(THEME_OVERRIDES)){
  if(THEMES[key]) mergeThemeOverrides(THEMES[key], THEME_OVERRIDES[key]);
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
  boneyard:  { spawnMatName: 'stone', spawn1GeoName: 'spawn1_grim', spawn2GeoName: 'spawn2_grim', spawn3GeoName: 'spawn3_grim', baseCol: 0x5a6054, ringCol: 0x9fd08a, crystalCol: 0xe9ffd0 },
  ruinfield: { spawnMatName: 'stone', spawn1GeoName: 'spawn1', spawn2GeoName: 'spawn2', spawn3GeoName: 'spawn3', baseCol: 0x8a8270, ringCol: 0xe8973f, crystalCol: 0xffd9a8 },
  ashfield:  { spawnMatName: 'stone', spawn1GeoName: 'spawn1_molten', spawn2GeoName: 'spawn2_molten', spawn3GeoName: 'spawn3_molten', baseCol: 0x2a2422, ringCol: 0xff5a1f, crystalCol: 0xff7a30 },
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
  ancient:  { postGeoName:'archPost_ancient', lintelGeoName:'archLintel_ancient', matName:'stone',
              postCol:0x6e7484, lintelCol:0x7b8192, gateMix:0.20 },
  molten:   { postGeoName:'archPost_molten',  lintelGeoName:'archLintel_molten',  matName:'stone',
              postCol:0x2e2724, lintelCol:0x4a3a30, gateMix:0.35 },
  frost:    { postGeoName:'archPost_frost',   lintelGeoName:'archLintel_frost',   matName:'ice',
              postCol:0xbfe2ff, lintelCol:0xd8efff, gateMix:0.10 },
  grim:     { postGeoName:'archPost_grim',    lintelGeoName:'archLintel_grim',    matName:'stone',
              postCol:0x2f342c, lintelCol:0x3d4438, gateMix:0.30 },
  verdant:  { postGeoName:'archPost_verdant', lintelGeoName:'archLintel_verdant', matName:'bark',
              postCol:0x5c4a34, lintelCol:0x4f6b38, gateMix:0.25 },
  /* open terrain — waymarked thresholds, tinted to each biome's ground */
  forest:    { postGeoName:'archPost_overland', lintelGeoName:'archLintel_overland', matName:'bark',
               postCol:0x6a6558, lintelCol:0x6b4a2f, gateMix:0.22 },
  moor:      { postGeoName:'archPost_overland', lintelGeoName:'archLintel_overland', matName:'stone',
               postCol:0x74705f, lintelCol:0x5e5442, gateMix:0.22 },
  mire:      { postGeoName:'archPost_overland', lintelGeoName:'archLintel_overland', matName:'bark',
               postCol:0x4a4638, lintelCol:0x3e3a31, gateMix:0.28 },
  holdfast:  { postGeoName:'archPost_overland', lintelGeoName:'archLintel_overland', matName:'stone',
               postCol:0x8a8270, lintelCol:0x7a6a52, gateMix:0.20 },
  boneyard:  { postGeoName:'archPost_overland', lintelGeoName:'archLintel_overland', matName:'stone',
               postCol:0x6d7266, lintelCol:0x5a6054, gateMix:0.26 },
  ruinfield: { postGeoName:'archPost_overland', lintelGeoName:'archLintel_overland', matName:'stone',
               postCol:0x968d78, lintelCol:0x7d7461, gateMix:0.22 },
  ashfield:  { postGeoName:'archPost_overland', lintelGeoName:'archLintel_overland', matName:'stone',
               postCol:0x3a3330, lintelCol:0x2a2422, gateMix:0.34 },
  snowfield: { postGeoName:'archPost_overland', lintelGeoName:'archLintel_overland', matName:'ice',
               postCol:0xc8dcec, lintelCol:0x9fb4c4, gateMix:0.12 },
  sporewood: { postGeoName:'archPost_overland', lintelGeoName:'archLintel_overland', matName:'bark',
               postCol:0x5e4e68, lintelCol:0x4a5a3c, gateMix:0.26 }
};

/* ---------------- name generator ---------------- */
export function dungeonName(rng, th){
  const C=['Mal','Vor','Ash','Ker','Ul','Dra','Noth','Zar','Bel','Mor','Gol','Ith'];
  const D=['goth','ath','ruk','esh','mir','gul','dan','oth','ek','ash','uzek','arim'];
  return 'The ' + rng.pick(th.nameA) + ' ' + rng.pick(th.nameB) + ' of ' + rng.pick(C) + '\u2019' + rng.pick(D);
}

/* ---------------- Delaunay (Bowyer–Watson) ---------------- */
export function delaunay(pts){
  const n = pts.length;
  if(n < 2) return [];
  let minX=pts[0].x, maxX=pts[0].x, minY=pts[0].y, maxY=pts[0].y;
  for(let i=1;i<n;i++){
    minX = Math.min(minX, pts[i].x); maxX = Math.max(maxX, pts[i].x);
    minY = Math.min(minY, pts[i].y); maxY = Math.max(maxY, pts[i].y);
  }
  const dx = maxX - minX, dy = maxY - minY, delta = Math.max(dx, dy) * 10;
  const midX = (minX + maxX)/2, midY = (minY + maxY)/2;
  const p0 = {x: midX - delta, y: midY - delta, id:-1};
  const p1 = {x: midX + delta, y: midY - delta, id:-2};
  const p2 = {x: midX,         y: midY + delta, id:-3};
  const P = pts.map((p,i)=>({x:p.x, y:p.y, id:i})).concat([p0,p1,p2]);

  let tris = [{a:n, b:n+1, c:n+2}];
  const inCirc = (p, t)=>{
    const A=P[t.a], B=P[t.b], C=P[t.c];
    const D = 2 * (A.x*(B.y - C.y) + B.x*(C.y - A.y) + C.x*(A.y - B.y));
    if(Math.abs(D) < 1e-9) return false;
    const ux = ((A.x*A.x + A.y*A.y)*(B.y - C.y) + (B.x*B.x + B.y*B.y)*(C.y - A.y) + (C.x*C.x + C.y*C.y)*(A.y - B.y)) / D;
    const uy = ((A.x*A.x + A.y*A.y)*(C.x - B.x) + (B.x*B.x + B.y*B.y)*(A.x - C.x) + (C.x*C.x + C.y*C.y)*(B.x - A.x)) / D;
    const r2 = (A.x - ux)*(A.x - ux) + (A.y - uy)*(A.y - uy);
    return (p.x - ux)*(p.x - ux) + (p.y - uy)*(p.y - uy) <= r2 + 1e-7;
  };

  for(let i=0;i<n;i++){
    const pt = P[i];
    const bad = [];
    for(const t of tris) if(inCirc(pt, t)) bad.push(t);
    const poly = [];
    for(const t of bad){
      const edges = [[t.a,t.b],[t.b,t.c],[t.c,t.a]];
      for(const e of edges){
        let shared = false;
        for(const ot of bad){
          if(ot === t) continue;
          if((ot.a===e[0]||ot.b===e[0]||ot.c===e[0]) && (ot.a===e[1]||ot.b===e[1]||ot.c===e[1])){ shared=true; break; }
        }
        if(!shared) poly.push(e);
      }
    }
    tris = tris.filter(t => !bad.includes(t));
    for(const e of poly) tris.push({a:e[0], b:e[1], c:i});
  }
  const em = new Set();
  const out = [];
  for(const t of tris){
    if(t.a < n && t.b < n && t.c < n){
      for(const [u,v] of [[t.a,t.b],[t.b,t.c],[t.c,t.a]]){
        const k = Math.min(u,v)+','+Math.max(u,v);
        if(!em.has(k)){ em.add(k); out.push([Math.min(u,v), Math.max(u,v)]); }
      }
    }
  }
  return out;
}

/* ---------------- MAIN GENERATOR ENTRY POINT ---------------- */
export function generateDungeon(a, b){
  let seed, params;
  if(typeof a === 'object' && a !== null){
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
  if(TH.overland){
    return generateOverland(p);
  }
  const t0 = performance.now();
  let attempt = 0, curSeed = seed, d = null;
  while(attempt < 5){
    d = tryGenerate(curSeed, p);
    if(d && d.valid) break;
    curSeed = (Math.imul(curSeed, 9301) + 49297) >>> 0; attempt++;
  }
  if(d){
    d.stats.genMs = performance.now() - t0;
    d.stats.attempts = attempt + 1;
  }
  return d;
}

function tryGenerate(seed, params){
  const rng = makeRng(seed);
  const N = Math.max(4, Math.min(80, params.roomCount || 16));
  const TH = THEMES[params.themeKey] || THEMES.ancient;
  const thKey = params.themeKey || 'ancient';

  /* -- 1. scatter -- */
  const R = Math.sqrt(N) * 6.5;
  const rooms = [];
  const large = [];
  for(let i=0;i<N;i++){
    const t = rng.raw();
    let w,h,arch;
    if(t<0.45){ arch='s'; w=rng.i(9,11);  h=rng.i(9,11); }
    else if(t<0.85){ arch='m'; w=rng.i(12,15); h=rng.i(12,15); }
    else { arch='l'; w=rng.i(16,22); h=rng.i(16,22); large.push(i); }
    const st = rng.raw();
    const shape = st<0.60 ? 'rect' : (st<0.82 ? 'ellipse' : 'oct');
    const ang = rng.f(0, Math.PI*2), rad = R*Math.sqrt(rng.raw());
    rooms.push({ id:i, cx:Math.cos(ang)*rad, cy:Math.sin(ang)*rad, w, h, arch, shape,
      sx0:Math.cos(ang)*rad, sy0:Math.sin(ang)*rad,
      type:TYPE.COMBAT, depth:0, difficulty:0.2, degree:0 });
  }
  while(large.length < 2){
    const j = rng.i(0, N-1);
    if(rooms[j].arch !== 'l'){ rooms[j].arch='l'; rooms[j].w=rng.i(16,22); rooms[j].h=rng.i(16,22); rooms[j].shape='rect'; large.push(j); }
  }

  /* -- 2. separate -- */
  const PAD = 2;
  { const CX=new Float64Array(N), CY=new Float64Array(N), HW=new Float64Array(N), HH=new Float64Array(N);
    for(let i=0;i<N;i++){ CX[i]=rooms[i].cx; CY[i]=rooms[i].cy; HW[i]=rooms[i].w/2+PAD/2; HH[i]=rooms[i].h/2+PAD/2; }
    for(let iter=0; iter<300; iter++){
      let moved = false;
      for(let i=0;i<N;i++) for(let j=i+1;j<N;j++){
        const ox = HW[i]+HW[j] - Math.abs(CX[i]-CX[j]);
        if(ox<=0) continue;
        const oy = HH[i]+HH[j] - Math.abs(CY[i]-CY[j]);
        if(oy<=0) continue;
        moved = true;
        if(ox < oy){ const s = CX[i] <= CX[j] ? -1 : 1; CX[i] += s*ox/2; CX[j] -= s*ox/2; }
        else       { const s = CY[i] <= CY[j] ? -1 : 1; CY[i] += s*oy/2; CY[j] -= s*oy/2; }
      }
      if(!moved) break;
    }
    for(let i=0;i<N;i++){ rooms[i].cx = Math.round(CX[i]); rooms[i].cy = Math.round(CY[i]); }
  }

  /* -- 3. graph: Delaunay -> MST -> loops -- */
  const centers = rooms.map(r=>({x:r.cx, y:r.cy}));
  let delEdges = delaunay(centers);
  if(delEdges.length === 0){ delEdges = []; for(let i=0;i<N-1;i++) delEdges.push([i,i+1]); }
  const elen = e => Math.hypot(centers[e[0]].x-centers[e[1]].x, centers[e[0]].y-centers[e[1]].y);

  const adj = Array.from({length:N},()=>[]);
  delEdges.forEach((e,idx)=>{ const w=elen(e); adj[e[0]].push({b:e[1],w,idx}); adj[e[1]].push({b:e[0],w,idx}); });
  const inT = new Uint8Array(N); inT[0]=1; let inCount=1;
  const mstIdx = new Set();
  while(inCount < N){
    let best=null;
    for(let a=0;a<N;a++) if(inT[a]) for(const e of adj[a]) if(!inT[e.b] && (!best || e.w<best.w)) best=e;
    if(!best) break;
    inT[best.b]=1; inCount++; mstIdx.add(best.idx);
  }
  if(inCount < N) return { valid:false, stats:{} };

  let mstLenSum=0; for(const i of mstIdx) mstLenSum += elen(delEdges[i]);
  const mstMean = mstLenSum / Math.max(1, mstIdx.size);

  const edges = [];
  delEdges.forEach((e,idx)=>{
    if(mstIdx.has(idx)) edges.push({a:e[0], b:e[1], isLoop:false, isCritical:false});
    else if(elen(e) < mstMean*2.2 && rng.chance(params.loopChance))
      edges.push({a:e[0], b:e[1], isLoop:true, isCritical:false});
  });
  for(const e of edges){ rooms[e.a].degree++; rooms[e.b].degree++; }

  /* leaf guard */
  if(N >= 20){
    let leafCount = 0;
    for(let i=0;i<N;i++) if(rooms[i].degree===1) leafCount++;
    while(leafCount < 3){
      let bi=-1, bs=-1;
      for(let i=0;i<edges.length;i++){
        const e=edges[i]; if(!e.isLoop) continue;
        const s=(rooms[e.a].degree===2?1:0)+(rooms[e.b].degree===2?1:0);
        const L=Math.hypot(centers[e.a].x-centers[e.b].x, centers[e.a].y-centers[e.b].y);
        const score = s*10000 + L;
        if(score>bs){ bs=score; bi=i; }
      }
      if(bi<0) break;
      const e=edges[bi];
      if(--rooms[e.a].degree===1) leafCount++;
      if(--rooms[e.b].degree===1) leafCount++;
      edges.splice(bi,1);
    }
  }

  /* -- 4. semantics before carving -- */
  const gAdj = Array.from({length:N},()=>[]);
  edges.forEach((e,i)=>{ gAdj[e.a].push({b:e.b,i}); gAdj[e.b].push({b:e.a,i}); });

  let boss = 0; for(let i=1;i<N;i++) if(rooms[i].w*rooms[i].h > rooms[boss].w*rooms[boss].h) boss = i;

  const distFrom = src => {
    const D = new Int32Array(N).fill(-1); D[src]=0; const q=[src];
    for(let h=0; h<q.length; h++){ const a=q[h]; for(const e of gAdj[a]) if(D[e.b]<0){ D[e.b]=D[a]+1; q.push(e.b); } }
    return D;
  };
  const dB = distFrom(boss);
  let entrance = -1, bestD = -1;
  for(let i=0;i<N;i++) if(i!==boss && rooms[i].degree===1 && dB[i]>bestD){ bestD=dB[i]; entrance=i; }
  if(entrance < 0){ for(let i=0;i<N;i++) if(i!==boss && dB[i]>bestD){ bestD=dB[i]; entrance=i; } }

  const dE = distFrom(entrance);
  let maxDepth = 1; for(let i=0;i<N;i++) if(dE[i]>maxDepth) maxDepth = dE[i];
  rooms.forEach((r,i)=>{ r.depth = Math.max(0,dE[i]); r.difficulty = Math.min(1, 0.15 + 0.85*(r.depth/maxDepth)); });
  rooms[entrance].type = TYPE.ENTRANCE; rooms[entrance].difficulty = 0;
  rooms[boss].type = TYPE.BOSS; rooms[boss].difficulty = 1;

  const par = new Int32Array(N).fill(-1), pe = new Int32Array(N).fill(-1);
  { const q=[entrance], vis=new Uint8Array(N); vis[entrance]=1;
    for(let h=0; h<q.length; h++){ const a=q[h];
      for(const e of gAdj[a]) if(!vis[e.b]){ vis[e.b]=1; par[e.b]=a; pe[e.b]=e.i; q.push(e.b); } } }
  const critRooms = new Set(); let critLen = 0;
  for(let c=boss; c!==-1; c=par[c]){ critRooms.add(c); if(pe[c]>=0){ edges[pe[c]].isCritical=true; critLen++; } if(c===entrance) break; }

  const leaves = [];
  for(let i=0;i<N;i++) if(i!==entrance && i!==boss && rooms[i].degree===1) leaves.push(i);
  leaves.sort((a,b)=>rooms[b].depth-rooms[a].depth);
  leaves.slice(0,4).forEach(i=>{ rooms[i].type = TYPE.TREASURE; });

  const shrineC = [];
  for(let i=0;i<N;i++){ const r=rooms[i];
    if(r.type===TYPE.COMBAT && !critRooms.has(i) && r.depth>maxDepth*0.3 && r.depth<maxDepth*0.85) shrineC.push(i); }
  for(let k=0; k<2 && shrineC.length>0; k++){
    const j = shrineC.splice(rng.i(0,shrineC.length-1),1)[0]; rooms[j].type = TYPE.SHRINE;
  }
  const eliteC = [];
  for(const i of critRooms){ const r=rooms[i];
    if(r.type===TYPE.COMBAT && r.depth>=maxDepth*0.55 && r.depth<=maxDepth*0.85) eliteC.push(i); }
  eliteC.sort((a,b)=>rooms[a].depth-rooms[b].depth);
  for(let k=0;k<Math.min(2,eliteC.length);k++) rooms[eliteC[eliteC.length-1-k]].type = TYPE.ELITE;

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
  if(TH.lakes){
    const lc = [];
    for(let i=0;i<N;i++){ const r=rooms[i];
      if((r.type===TYPE.COMBAT || r.type===TYPE.ELITE) && Math.min(r.w,r.h)>=9) lc.push(i); }
    for(let k=0; k<2 && lc.length>0; k++) rooms[lc.splice(rng.i(0,lc.length-1),1)[0]].lake = true;
  }
  if(TH.graveyards){
    const gc = [];
    for(let i=0;i<N;i++){ const r=rooms[i];
      if(r.type===TYPE.COMBAT && r.shape!=='ellipse' && Math.min(r.w,r.h)>=8) gc.push(i); }
    for(let k=0; k<3 && gc.length>0; k++) rooms[gc.splice(rng.i(0,gc.length-1),1)[0]].grave = true;
  }

  /* -- 4.6 room style assignment (~12% chance per combat/elite room) -- */
  const activeThemeKey = thKey || 'ancient';
  for(let i=0; i<N; i++){
    const r = rooms[i];
    if((r.type === TYPE.COMBAT || r.type === TYPE.ELITE) && rng.chance(0.12)){
      const validStyles = Object.values(ROOM_STYLES).filter(s => isRoomStyleEnabled ? isRoomStyleEnabled(s.id, activeThemeKey) : (!s.themes || s.themes.includes(activeThemeKey)));
      if(validStyles.length > 0){
        const style = rng.pick(validStyles);
        r.roomStyle = style.id;
        r.banner = { title: style.title, subtitle: style.subtitle, style: style.id };
      }
    }
  }

  /* -- 5. carve + rasterize -- */
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  for(const r of rooms){
    minX=Math.min(minX, r.cx - Math.ceil(r.w/2)); maxX=Math.max(maxX, r.cx + Math.ceil(r.w/2));
    minY=Math.min(minY, r.cy - Math.ceil(r.h/2)); maxY=Math.max(maxY, r.cy + Math.ceil(r.h/2));
  }
  const PADG = 5, offX = PADG - minX, offY = PADG - minY;
  const W = (maxX-minX) + PADG*2 + 1, H = (maxY-minY) + PADG*2 + 1;
  for(const r of rooms){ r.cx += offX; r.cy += offY; r.sx0 += offX; r.sy0 += offY; }

  const grid = new Uint8Array(W*H);
  const roomId = new Int16Array(W*H).fill(-1);
  const corridor = new Uint8Array(W*H);
  const idx = (x,y)=> y*W + x;
  const inB = (x,y)=> x>=0 && y>=0 && x<W && y<H;
  const magmaBridgeProps = [];

  for(const r of rooms){
    const rx=r.w/2, ry=r.h/2, sh=r.shape, ch=Math.min(rx,ry)*0.55;
    const irx2=1/(rx*rx), iry2=1/(ry*ry);
    const y0=Math.max(0,Math.floor(r.cy-ry)), y1=Math.min(H-1,Math.ceil(r.cy+ry));
    const x0=Math.max(0,Math.floor(r.cx-rx)), x1=Math.min(W-1,Math.ceil(r.cx+rx));
    for(let y=y0;y<=y1;y++){
      const dy=y-r.cy, ady=Math.abs(dy), row=y*W;
      if(ady>ry) continue;
      for(let x=x0;x<=x1;x++){
        const dx=x-r.cx, adx=Math.abs(dx);
        if(adx>rx) continue;
        let ok=true;
        if(sh==='ellipse') ok = dx*dx*irx2 + dy*dy*iry2 <= 1.0;
        else if(sh==='oct') ok = adx<=rx-ch || ady<=ry-ch || (adx-(rx-ch))+(ady-(ry-ch)) <= ch;
        if(ok){ const c=row+x; grid[c]=FLOOR; roomId[c]=r.id; }
      }
    }
  }

  const stamp = (x,y)=>{ if(inB(x,y) && grid[idx(x,y)]!==FLOOR){ grid[idx(x,y)]=FLOOR; corridor[idx(x,y)]=1; } };
  const offs = w => w===1?[0] : (w===2?[0,1] : [-1,0,1]);
  const hLine=(x0,x1,y,w)=>{ const o=offs(w); for(let x=Math.min(x0,x1); x<=Math.max(x0,x1); x++) for(const k of o) stamp(x,y+k); };
  const vLine=(y0,y1,x,w)=>{ const o=offs(w); for(let y=Math.min(y0,y1); y<=Math.max(y0,y1); y++) for(const k of o) stamp(x+k,y); };

  for(const e of edges){
    const A=rooms[e.a], B=rooms[e.b];
    let w = e.isCritical ? 3 : 2;
    const dx = Math.abs(A.cx-B.cx), dy = Math.abs(A.cy-B.cy);
    const ovX = Math.min(A.cx+A.w/2, B.cx+B.w/2) - Math.max(A.cx-A.w/2, B.cx-B.w/2);
    const ovY = Math.min(A.cy+A.h/2, B.cy+B.h/2) - Math.max(A.cy-A.h/2, B.cy-B.h/2);
    if(ovX >= w+2 && dy > 0){ const x = Math.round((Math.max(A.cx-A.w/2,B.cx-B.w/2)+Math.min(A.cx+A.w/2,B.cx+B.w/2))/2); vLine(A.cy,B.cy,x,w); }
    else if(ovY >= w+2 && dx > 0){ const y = Math.round((Math.max(A.cy-A.h/2,B.cy-B.h/2)+Math.min(A.cy+A.h/2,B.cy+B.h/2))/2); hLine(A.cx,B.cx,y,w); }
    else if(rng.chance(0.5)){ hLine(A.cx,B.cx,A.cy,w); vLine(A.cy,B.cy,B.cx,w); }
    else { vLine(A.cy,B.cy,A.cx,w); hLine(A.cx,B.cx,B.cy,w); }
  }

  for(let y=0;y<H;y++){
    const row=y*W;
    for(let x=0;x<W;x++){
      if(grid[row+x]!==FLOOR) continue;
      const ya=Math.max(0,y-1), yb=Math.min(H-1,y+1);
      const xa=Math.max(0,x-1), xb=Math.min(W-1,x+1);
      for(let ny=ya;ny<=yb;ny++){
        const nrow=ny*W;
        for(let nx=xa;nx<=xb;nx++){
          const ni=nrow+nx;
          if(grid[ni]===VOID) grid[ni]=WALL;
        }
      }
    }
  }

  const doorway = new Uint8Array(W*H);
  for(let y=0;y<H;y++){
    const row=y*W;
    for(let x=0;x<W;x++){
      const c=row+x;
      if(!corridor[c]) continue;
      if((x<W-1 && roomId[c+1]>=0) || (x>0 && roomId[c-1]>=0) ||
         (y<H-1 && roomId[c+W]>=0) || (y>0 && roomId[c-W]>=0)) doorway[c]=1;
    }
  }

  widenNarrowDoorways(grid, W, H, corridor, doorway, roomId);

  /* liquid pockets */
  const pools = [];
  if(TH.pools && TH.pools.amount > 0){
    const nearDoorC = (x,y,d)=>{ for(let oy=-d;oy<=d;oy++) for(let ox=-d;ox<=d;ox++){
      const nx=x+ox, ny=y+oy;
      if(nx>=0&&ny>=0&&nx<W&&ny<H && doorway[idx(nx,ny)]) return true; } return false; };
    const cand = [];
    for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++){
      const c=idx(x,y);
      if(grid[c]!==WALL || nearDoorC(x,y,2)) continue;
      let nf=0;
      if(grid[c+1]===FLOOR) nf++; if(grid[c-1]===FLOOR) nf++;
      if(grid[c+W]===FLOOR) nf++; if(grid[c-W]===FLOOR) nf++;
      if(nf===1) cand.push({x,y});
    }
    for(let i=cand.length-1;i>0;i--){ const j=rng.i(0,i); const t=cand[i]; cand[i]=cand[j]; cand[j]=t; }
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
    for(const s of cand){
      if(pools.length >= target) break;
      let close=false;
      for(const p of pools) if(Math.max(Math.abs(p.x-s.x),Math.abs(p.y-s.y)) < 3){ close=true; break; }
      if(close) continue;
      const seed = idx(s.x, s.y);
      const body = growLiquidBody(W, H, seed, rng.i(bodyMin, bodyMax), canFlood, rng);
      /* A seed wedged in a one-cell alcove can't grow. Skip it rather than
         leaving behind the lone tile this whole system exists to replace. */
      if(body.length < 2) continue;
      for(const c of body){
        grid[c] = POOL;
        pools.push({ x: c % W, y: (c - (c % W)) / W });
      }
    }
    for(const p of pools)
      for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
        const nx=p.x+ox, ny=p.y+oy;
        if(nx>=0&&ny>=0&&nx<W&&ny<H && grid[idx(nx,ny)]===VOID) grid[idx(nx,ny)]=WALL;
      }
  }

  if(TH.pools && TH.pools.pits){
    /* Room pits DO consume walkable floor, so every candidate body is checked
       against a flood fill from the entrance before it is committed — a lava
       flow must never sever the route to the stairs or fence off a corner. */
    const refCell = idx(rooms[entrance].cx, rooms[entrance].cy);
    const pitReach = reachableFloorMask(grid, W, H, refCell);
    const [pitMin, pitMax] = TH.pools.pitBody || [2, 4];

    /* Chasm/water crossings: a channel cut across one room, spanned by a
       bridge. Molten gets an iron bridge over lava, verdant a timber
       footbridge over water — identical layout, different construction. */
    const BRIDGE_KIT = { molten: { deck: 'magmaBridge', rail: 'bridgeRailing' },
                         verdant: { deck: 'woodBridge',  rail: 'woodRailing'  } };
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

    for(const r of rooms){
      if((r.type!==TYPE.COMBAT && r.type!==TYPE.ELITE) || r.lake || r.grave) continue;
      let n = Math.min(TH.pools.pits, Math.floor(r.w*r.h/45)+1), guard=0;
      /* stay inside this room, off doorways, and never touch a wall — the body
         has to float in open floor with a walkable rim all the way around */
      const canFlood = c => {
        if (grid[c] !== FLOOR || roomId[c] !== r.id || doorway[c]) return false;
        const x = c % W, y = (c - x) / W;
        if (!inB(x, y)) return false;
        for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
          const nc = idx(x+ox, y+oy);
          if (grid[nc] !== FLOOR && grid[nc] !== POOL) return false;
        }
        return true;
      };
      while(n>0 && guard++<40){
        const x=rng.i(Math.floor(r.cx-r.w/2)+2, Math.ceil(r.cx+r.w/2)-2);
        const y=rng.i(Math.floor(r.cy-r.h/2)+2, Math.ceil(r.cy+r.h/2)-2);
        if(!inB(x,y)) continue;
        const c=idx(x,y);
        if(!canFlood(c)) continue;
        let ok=true;
        for(const p of pools) if(Math.max(Math.abs(p.x-x),Math.abs(p.y-y))<4){ ok=false; break; }
        if(!ok) continue;

        const body = growLiquidBody(W, H, c, rng.i(pitMin, pitMax), canFlood, rng);
        if(!floorStaysConnected(grid, W, H, body, refCell, pitReach)) continue;
        for(const bc of body){
          grid[bc]=POOL;
          pitReach[bc]=0;
          pools.push({ x: bc % W, y: (bc - (bc % W)) / W });
        }
        n--;
      }
    }
  }

  const lakeMask = new Uint8Array(W*H);
  const lakeCells = [];
  for(const r of rooms){
    if(!r.lake) continue;
    for(let y=Math.floor(r.cy-r.h/2)+2; y<=Math.ceil(r.cy+r.h/2)-2; y++)
      for(let x=Math.floor(r.cx-r.w/2)+2; x<=Math.ceil(r.cx+r.w/2)-2; x++){
        if(!inB(x,y)) continue;
        const c=idx(x,y);
        if(roomId[c]!==r.id || grid[c]!==FLOOR || doorway[c]) continue;
        let solid=false;
        for(let oy=-1;oy<=1 && !solid;oy++) for(let ox=-1;ox<=1;ox++)
          if(grid[idx(x+ox,y+oy)]!==FLOOR){ solid=true; break; }
        if(!solid){ lakeMask[c]=1; lakeCells.push({x,y}); }
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
      const fitIsFree = fit => fit && fit.cells.every(c => !usedCells[c]);
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
        arches.push(bestArch);
      }
    }
  }

  /* -- 6. BFS field + validation -- */
  const bfs = new Int16Array(W*H).fill(-1);
  const ei = idx(rooms[entrance].cx, rooms[entrance].cy);
  const total = W*H;
  let floorTotal=0; for(let i=0;i<total;i++) if(grid[i]===FLOOR) floorTotal++;
  let reach=0, maxBfs=0;
  if(grid[ei]===FLOOR){
    const q = new Int32Array(floorTotal); let qh=0, qt=0;
    q[qt++]=ei; bfs[ei]=0; reach=1;
    while(qh<qt){
      const c=q[qh++], x=c%W, b=bfs[c]+1;
      let n;
      if(x>0       && grid[n=c-1]===FLOOR && bfs[n]<0){ bfs[n]=b; q[qt++]=n; reach++; }
      if(x<W-1     && grid[n=c+1]===FLOOR && bfs[n]<0){ bfs[n]=b; q[qt++]=n; reach++; }
      if(c>=W      && grid[n=c-W]===FLOOR && bfs[n]<0){ bfs[n]=b; q[qt++]=n; reach++; }
      if(c<total-W && grid[n=c+W]===FLOOR && bfs[n]<0){ bfs[n]=b; q[qt++]=n; reach++; }
    }
    maxBfs = bfs[q[qt-1]];
  }
  const valid = reach === floorTotal && floorTotal > 0;

  /* -- 7. decoration -- */
  const props = [...magmaBridgeProps], spawns = [];
  const occ = new Uint8Array(W*H);
  const doorwayCells = [];
  for (let dy = 0; dy < H; dy++) {
    const row = dy * W;
    for (let dx = 0; dx < W; dx++) {
      if (doorway[row + dx]) doorwayCells.push({ x: dx, y: dy });
    }
  }
  const nearDoor = (x,y,d)=>{ for(let oy=-d;oy<=d;oy++) for(let ox=-d;ox<=d;ox++)
    if(inB(x+ox,y+oy) && doorway[idx(x+ox,y+oy)]) return true; return false; };
  const interior = (x,y)=>{ for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++)
    if(!inB(x+ox,y+oy) || grid[idx(x+ox,y+oy)]!==FLOOR) return false; return true; };
  const roomHasLectern = new Set();
  const put = (kind,x,y,rot,scale,rid,oy)=>{
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
    const propObj = {kind,x,y,rot:rot||0,scale:scale||1,roomId:rid,oy:oy||0};
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
  const putF = (kind,x,y,rot,scale,rid,oy)=>{
    const m = dmul('furniture');
    if(m < 1 && !rng.chance(m)) return;
    put(kind,x,y,rot,scale,rid,oy);
  };

  for(const r of rooms){
    const cix = idx(r.cx, r.cy);
    if(r.type===TYPE.ENTRANCE) put('ring', r.cx, r.cy, 0, 1, r.id);
    if(r.type===TYPE.BOSS){
      if(thKey === 'grim'){
        // Grim Boss Arena: Grand Sepulcher Dais centerpiece with Master Sarcophagus & Sconced Pillars
        put('sepulcherDais', r.cx, r.cy, 0, 1.25, r.id);
        put('sarco', r.cx, r.cy, (r.w >= r.h ? 0 : Math.PI/2), 1.35, r.id);
        put('candle', r.cx, r.cy, 0, 1.1, r.id, 0.72); // Candle directly atop sarcophagus lid!

        const pox = Math.min(3, Math.floor(r.w/2) - 2);
        const poy = Math.min(3, Math.floor(r.h/2) - 2);
        for(const [px, py] of [[r.cx-pox, r.cy-poy], [r.cx+pox, r.cy-poy], [r.cx-pox, r.cy+poy], [r.cx+pox, r.cy+poy]]){
          if(interior(px, py) && !occ[idx(px, py)] && !nearDoor(px, py, 2)){
            put('pillar', px, py, 0, 1.0, r.id);
            put('candle', px, py, rng.f(0, 6.28), 0.9, r.id, 1.72);
          }
        }
        const rr = Math.max(3.0, Math.min(r.w,r.h)/2 - 1.5), a0 = rng.f(0,1);
        for(let k=0;k<6;k++){
          const a = a0 + k*Math.PI/3;
          const bx = Math.round(r.cx + Math.cos(a)*rr), by = Math.round(r.cy + Math.sin(a)*rr);
          if(inB(bx,by) && grid[idx(bx,by)]===FLOOR && !occ[idx(bx,by)] && !nearDoor(bx,by,1)) put('brazier',bx,by,0,1,r.id);
        }
      } else if(thKey === 'molten'){
        // Molten Boss Arena: Grand Infernal Foundry Crucible Dais
        put('sepulcherDais', r.cx, r.cy, 0, 1.3, r.id);
        put('forge', r.cx, r.cy, (r.w >= r.h ? 0 : Math.PI/2), 1.25, r.id, 0.29);
        put('anvil', r.cx + (r.w >= r.h ? 1 : 0), r.cy + (r.w >= r.h ? 0 : 1), rng.f(0, 6.28), 1.0, r.id, 0.29);
        put('smeltingCrucible', r.cx - (r.w >= r.h ? 1 : 0), r.cy - (r.w >= r.h ? 0 : 1), 0, 1.0, r.id, 0.29);
        put('ingotStack', r.cx, r.cy + (r.w >= r.h ? 1 : 0), rng.f(0, 6.28), 0.9, r.id, 0.29);

        // 4 Bastion Basalt Pillars with Glowing Magma Braziers and chains
        const pox = Math.min(3, Math.floor(r.w/2) - 2);
        const poy = Math.min(3, Math.floor(r.h/2) - 2);
        for(const [px, py] of [[r.cx-pox, r.cy-poy], [r.cx+pox, r.cy-poy], [r.cx-pox, r.cy+poy], [r.cx+pox, r.cy+poy]]){
          if(interior(px, py) && !occ[idx(px, py)] && !nearDoor(px, py, 2)){
            put('pillar', px, py, 0, 1.1, r.id);
            put('brazier', px, py, 0, 1.0, r.id);
            put('forgeChains', px, py, rng.f(0, 6.28), 1.0, r.id);
          }
        }
        // Ring of braziers, basalt stalagmites & glowing magma cracks
        const rr = Math.max(3.0, Math.min(r.w,r.h)/2 - 1.5), a0 = rng.f(0,1);
        for(let k=0;k<6;k++){
          const a = a0 + k*Math.PI/3;
          const bx = Math.round(r.cx + Math.cos(a)*rr), by = Math.round(r.cy + Math.sin(a)*rr);
          if(inB(bx,by) && grid[idx(bx,by)]===FLOOR && !occ[idx(bx,by)] && !nearDoor(bx,by,1)){
            if(k % 2 === 0) put('brazier', bx, by, 0, 1, r.id);
            else put('stalagmite', bx, by, rng.f(0, 6.28), 1.15, r.id);
            if(rng.chance(0.6)) put('crack', bx, by, rng.f(0, 6.28), 1.0, r.id);
          }
        }
      } else if(thKey === 'frost'){
        // Frost Boss Arena: The High Jarl's Mammoth Throne & Glacial Runic Sanctum
        put('sepulcherDais', r.cx, r.cy, 0, 1.3, r.id);
        put('iceThrone', r.cx, r.cy, (r.w >= r.h ? 0 : Math.PI/2), 1.25, r.id, 0.29);
        put('mammothTusks', r.cx, r.cy, (r.w >= r.h ? 0 : Math.PI/2), 1.2, r.id, 0.29);
        put('hearthPit', r.cx + (r.w >= r.h ? 0 : 1), r.cy + (r.w >= r.h ? 1 : 0), 0, 1.0, r.id, 0.29);
        put('shieldRack', r.cx - (r.w >= r.h ? 0 : 1), r.cy - (r.w >= r.h ? 1 : 0), (r.w >= r.h ? Math.PI/2 : 0), 1.0, r.id, 0.29);

        // 4 Bastion Runic Obelisks with Coldfire Hearths & Glacial Spires
        const pox = Math.min(3, Math.floor(r.w/2) - 2);
        const poy = Math.min(3, Math.floor(r.h/2) - 2);
        for(const [px, py] of [[r.cx-pox, r.cy-poy], [r.cx+pox, r.cy-poy], [r.cx-pox, r.cy+poy], [r.cx+pox, r.cy+poy]]){
          if(interior(px, py) && !occ[idx(px, py)] && !nearDoor(px, py, 2)){
            put('runicObelisk', px, py, 0, 1.1, r.id);
            put('glacialSpire', px, py, rng.f(0, 6.28), 0.95, r.id);
          }
        }
        // Radial Ring of mammoth tusks, bone totems, coldfire hearths & glacial spires
        const rr = Math.max(3.0, Math.min(r.w,r.h)/2 - 1.5), a0 = rng.f(0,1);
        for(let k=0;k<6;k++){
          const a = a0 + k*Math.PI/3;
          const bx = Math.round(r.cx + Math.cos(a)*rr), by = Math.round(r.cy + Math.sin(a)*rr);
          if(inB(bx,by) && grid[idx(bx,by)]===FLOOR && !occ[idx(bx,by)] && !nearDoor(bx,by,1)){
            if(k % 3 === 0) put('mammothTusks', bx, by, a + Math.PI/2, 1.05, r.id);
            else if(k % 3 === 1) put('glacialSpire', bx, by, rng.f(0, 6.28), 1.15, r.id);
            else put('boneTotem', bx, by, a, 1.1, r.id);
            if(rng.chance(0.6)) put('crack', bx, by, rng.f(0, 6.28), 1.0, r.id);
          }
        }
      } else {
        put('bossCrystal', r.cx, r.cy, rng.f(0,6.28), 1, r.id);
        const rr = Math.max(2.5, Math.min(r.w,r.h)/2 - 2), a0 = rng.f(0,1);
        for(let k=0;k<6;k++){
          const a = a0 + k*Math.PI/3;
          const bx = Math.round(r.cx + Math.cos(a)*rr), by = Math.round(r.cy + Math.sin(a)*rr);
          if(inB(bx,by) && grid[idx(bx,by)]===FLOOR && !occ[idx(bx,by)] && !nearDoor(bx,by,1)) put('brazier',bx,by,0,1,r.id);
        }
      }
    }
    if(r.type===TYPE.TREASURE && grid[cix]===FLOOR) put('chest', r.cx, r.cy, rng.i(0,3)*Math.PI/2, 1, r.id);
    if(r.type===TYPE.SHRINE && grid[cix]===FLOOR) put('shrineCrystal', r.cx, r.cy, rng.f(0,6.28), 1, r.id);
    if(r.type===TYPE.RIVAL && grid[cix]===FLOOR){
      put('shrineCrystal', r.cx, r.cy, 0, 1, r.id);
      put('weaponRack', r.cx - 2, r.cy, 0, 1, r.id);
      put('crate', r.cx + 2, r.cy - 1, 0.4, 1, r.id);
      put('barrel', r.cx + 2, r.cy + 1, 0, 1, r.id);
      put('bench', r.cx, r.cy - 2, 0, 1, r.id);
    }

    if((r.type===TYPE.COMBAT || r.type===TYPE.ELITE) && Math.min(r.w,r.h)>=10 && r.shape!=='ellipse' && !r.grave && !r.lake){
      /* occasional accent: a matched set of statue-pillars flanking the room corners */
      if(thKey==='ancient' && Math.min(r.w,r.h)>=12 && rng.chance(0.4*dmul('pillars'))){
        const kind = rng.chance(0.5) ? 'pillarA' : 'pillarB';
        const ox = Math.max(3, Math.floor(r.w/2)-3), oy = Math.max(3, Math.floor(r.h/2)-3);
        for(const [cx0,cy0] of [[r.cx-ox,r.cy-oy],[r.cx+ox,r.cy-oy],[r.cx-ox,r.cy+oy],[r.cx+ox,r.cy+oy]]){
          const x=Math.round(cx0), y=Math.round(cy0);
          if(interior(x,y) && !occ[idx(x,y)] && !nearDoor(x,y,2))
            put(kind, x, y, rng.i(0,3)*(Math.PI/2), rng.f(0.94,1.06), r.id);
        }
      }
      const step = Math.min(r.w,r.h) >= 14 ? 4 : 3;
      for(let y=Math.ceil(r.cy-r.h/2)+2; y<=r.cy+r.h/2-2; y++)
        for(let x=Math.ceil(r.cx-r.w/2)+2; x<=r.cx+r.w/2-2; x++){
          if(((x-r.cx)%step)!==0 || ((y-r.cy)%step)!==0) continue;
          if(x===r.cx && y===r.cy) continue;
          if(interior(x,y) && !occ[idx(x,y)] && !nearDoor(x,y,2)) put('pillar',x,y,0,rng.f(0.94,1.06),r.id);
        }
    }

    if(r.grave || (thKey==='grim' && (r.type===TYPE.COMBAT || r.type===TYPE.ELITE))){
      /* Occasional single accent tombstone in a corner */
      if(Math.min(r.w,r.h)>=8 && rng.chance(0.25*dmul('pillars'))){
        const ox = Math.max(2, Math.floor(r.w/2)-2), oy = Math.max(2, Math.floor(r.h/2)-2);
        const x = r.cx + (rng.chance(0.5) ? ox : -ox), y = r.cy + (rng.chance(0.5) ? oy : -oy);
        if(interior(x,y) && !occ[idx(x,y)] && !nearDoor(x,y,2))
          put('tombstone', x, y, rng.i(0,3)*(Math.PI/2), rng.f(0.85,1.05), r.id);
      }

      /* Clean geometric sarcophagus placement */
      if(Math.min(r.w,r.h)>=8 && grid[cix]===FLOOR && !occ[cix] && rng.chance(0.75)){
        const isLarge = Math.min(r.w, r.h) >= 12;
        if(isLarge && rng.chance(0.5)){
          // Symmetrical dual-bier pair spaced 4 tiles apart along minor axis with parallel alignment
          if(r.w >= r.h){
            const s1y = r.cy - 2, s2y = r.cy + 2;
            if(interior(r.cx, s1y) && interior(r.cx, s2y) && !occ[idx(r.cx, s1y)] && !occ[idx(r.cx, s2y)] && !nearDoor(r.cx, s1y, 2) && !nearDoor(r.cx, s2y, 2)){
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
            if(interior(s1x, r.cy) && interior(s2x, r.cy) && !occ[idx(s1x, r.cy)] && !occ[idx(s2x, r.cy)] && !nearDoor(s1x, r.cy, 2) && !nearDoor(s2x, r.cy, 2)){
              put('sarco', s1x, r.cy, Math.PI/2, 1, r.id);
              put('candle', s1x, r.cy, 0, 0.9, r.id, 0.72);
              put('sarco', s2x, r.cy, Math.PI/2, 1, r.id);
              put('candle', s2x, r.cy, 0, 0.9, r.id, 0.72);
            } else {
              put('sarco', r.cx, r.cy, Math.PI/2, 1, r.id);
              put('candle', r.cx, r.cy, 0, 0.9, r.id, 0.72);
            }
          }
        } else {
          // Single central sarcophagus aligned with room's primary axis
          const sarcoRot = (r.w >= r.h) ? 0 : Math.PI/2;
          put('sarco', r.cx, r.cy, sarcoRot, 1, r.id);
          put('candle', r.cx, r.cy, 0, 0.9, r.id, 0.72);
        }
      }

      let cd = 3;
      while(cd-->0){
        const x=rng.i(Math.floor(r.cx-r.w/2)+1, Math.ceil(r.cx+r.w/2)-1);
        const y=rng.i(Math.floor(r.cy-r.h/2)+1, Math.ceil(r.cy+r.h/2)-1);
        if(inB(x,y) && roomId[idx(x,y)]===r.id && grid[idx(x,y)]===FLOOR && !occ[idx(x,y)])
          put('candle', x, y, 0, rng.f(0.85,1.2), r.id);
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

      for(let y=Math.floor(r.cy-r.h/2)+1; y<=Math.ceil(r.cy+r.h/2)-1; y++) {
        for(let x=Math.floor(r.cx-r.w/2)+1; x<=Math.ceil(r.cx+r.w/2)-1; x++) {
          if (!inB(x,y)) continue;
          const c = idx(x,y);
          if (roomId[c] !== r.id || grid[c] !== FLOOR || occ[c] || nearDoor(x,y,1)) continue;
          let wallCount = 0;
          let wallDx = 0, wallDy = 0;
          if (x < W-1 && grid[c+1] === WALL) { wallCount++; wallDx = 1; }
          if (x > 0 && grid[c-1] === WALL) { wallCount++; wallDx = -1; }
          if (y < H-1 && grid[c+W] === WALL) { wallCount++; wallDy = 1; }
          if (y > 0 && grid[c-W] === WALL) { wallCount++; wallDy = -1; }

          if (wallCount >= 2) cornerTiles.push({x,y,dx:wallDx,dy:wallDy});
          else if (wallCount === 1) wallTiles.push({x,y,dx:wallDx,dy:wallDy});
          else if (interior(x,y) && !nearDoor(x,y,2)) freeInterior.push({x,y});
        }
      }

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
          const fit = freeInterior[Math.floor(freeInterior.length/2)];
          putF('forge', fit.x, fit.y, 0, 1.15, r.id);
          if (freeInterior.length > 1) {
            const fit2 = freeInterior[0];
            putF('anvil', fit2.x, fit2.y, rng.f(0, 6.28), 1.0, r.id);
          }
          if (freeInterior.length > 2) {
            const fit3 = freeInterior[freeInterior.length - 1];
            putF('ingotStack', fit3.x, fit3.y, rng.f(0, 6.28), 1.0, r.id);
          }
        }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('forgeChains', ct.x, ct.y, rng.f(0,6.28), 1, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('boulderPile', ct2.x, ct2.y, rng.f(0,6.28), 1, r.id); }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('weaponRack', wt.x, wt.y, Math.atan2(wt.dx, wt.dy), 1, r.id); }
        if (wallTiles.length > 1) { const wt2 = wallTiles[1]; putF('smeltingCrucible', wt2.x, wt2.y, 0, 1.0, r.id); }
      } else if (arch === 'CALDERA_CRUCIBLE') {
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length/2)];
          putF('smeltingCrucible', fit.x, fit.y, 0, 1.2, r.id);
          if (freeInterior.length > 1) {
            const fit2 = freeInterior[0];
            putF('stalagmite', fit2.x, fit2.y, rng.f(0, 6.28), 1.1, r.id);
          }
        }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('boulderPile', ct.x, ct.y, rng.f(0,6.28), 1.1, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('stalagmite', ct2.x, ct2.y, rng.f(0,6.28), 1.0, r.id); }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('forgeChains', wt.x, wt.y, rng.f(0,6.28), 1, r.id); }
      } else if (arch === 'ASHEN_GUARDHOUSE') {
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length/2)];
          putF('table', fit.x, fit.y, 0, 1.0, r.id);
          if (freeInterior.length > 1) {
            const fit2 = freeInterior[0];
            putF('bench', fit2.x, fit2.y, 0, 0.9, r.id);
          }
        }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('weaponRack', wt.x, wt.y, Math.atan2(wt.dx, wt.dy), 1, r.id); }
        if (wallTiles.length > 1) { const wt2 = wallTiles[1]; putF('weaponRack', wt2.x, wt2.y, Math.atan2(wt2.dx, wt2.dy), 1, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('crate', ct.x, ct.y, rng.f(0,6.28), 1.1, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('forgeChains', ct2.x, ct2.y, rng.f(0,6.28), 1.0, r.id); }
      } else if (arch === 'JARLS_MEAD_HALL') {
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length/2)];
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
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('barrel', ct.x, ct.y, rng.f(0,6.28), 1.05, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('glacialSpire', ct2.x, ct2.y, rng.f(0,6.28), 1.0, r.id); }
      } else if (arch === 'SHAMAN_RUNE_SANCTUM') {
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length/2)];
          putF('runicObelisk', fit.x, fit.y, 0, 1.15, r.id);
          if (freeInterior.length > 1) {
            const fit2 = freeInterior[0];
            putF('magicCircle', fit2.x, fit2.y, 0, 1.2, r.id);
          }
          if (freeInterior.length > 2) {
            const fit3 = freeInterior[freeInterior.length - 1];
            putF('hearthPit', fit3.x, fit3.y, 0, 1.0, r.id);
          }
        }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('runicObelisk', wt.x, wt.y, Math.atan2(wt.dx, wt.dy), 1.05, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('boneTotem', ct.x, ct.y, rng.f(0,6.28), 1.1, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('glacialSpire', ct2.x, ct2.y, rng.f(0,6.28), 1.1, r.id); }
      } else if (arch === 'WARRIORS_ARMORY') {
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length/2)];
          putF('hearthPit', fit.x, fit.y, 0, 1.0, r.id);
        }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('weaponRack', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1, r.id); }
        if (wallTiles.length > 1) { const wt2 = wallTiles[1]; putF('shieldRack', wt2.x, wt2.y, Math.atan2(-wt2.dx, -wt2.dy), 1, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('mammothTusks', ct.x, ct.y, rng.f(0,6.28), 1.0, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('crate', ct2.x, ct2.y, rng.f(0,6.28), 1.1, r.id); }
      } else if (arch === 'GLACIAL_VAULT') {
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length/2)];
          putF('iceThrone', fit.x, fit.y, 0, 1.1, r.id);
          if (freeInterior.length > 1) {
            const fit2 = freeInterior[0];
            putF('glacialSpire', fit2.x, fit2.y, rng.f(0, 6.28), 1.1, r.id);
          }
        }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; props.push({kind:'icicle', x:wt.x, y:wt.y, dx:wt.dx, dy:wt.dy, rot:rng.f(0,6.28), scale:1, roomId:r.id}); }
        if (wallTiles.length > 1) { const wt2 = wallTiles[1]; putF('mammothTusks', wt2.x, wt2.y, Math.atan2(-wt2.dx, -wt2.dy), 1.0, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('boneTotem', ct.x, ct.y, rng.f(0,6.28), 1.0, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('glacialSpire', ct2.x, ct2.y, rng.f(0,6.28), 1.15, r.id); }
      } else if (arch === 'NECROPOLIS_OSSUARY' || arch === 'PLAGUE_ALTAR' || arch === 'CHARNEL_PIT' || arch === 'CRYPT') {
        if (wallTiles.length > 0) {
          const wt = wallTiles[0];
          putF('altarTable', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1.0, r.id);
          put('candle', wt.x, wt.y, rng.f(0, 6.28), 0.95, r.id, 0.65); // Sits ON TOP of altar
        }
        if (wallTiles.length > 1) {
          const wt = wallTiles[1];
          props.push({kind:'ossuaryWall', x:wt.x, y:wt.y, dx:wt.dx, dy:wt.dy, rot:0, scale:1, roomId:r.id});
          occ[idx(wt.x,wt.y)]=1;
        }
        if (wallTiles.length > 2 && rng.chance(0.7)) {
          placeStudyDesk(wallTiles[2]);
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
          const fit = freeInterior[Math.floor(freeInterior.length/2)];
          if (arch === 'PLAGUE_ALTAR') {
            putF('altarTable', fit.x, fit.y, 0, 1.1, r.id);
            put('candle', fit.x, fit.y, 0, 1.0, r.id, 0.65); // Sits ON TOP of altar
          } else if ((thKey === 'ancient' || thKey === 'grim') && rng.chance(0.65)) {
            putF(rng.chance(0.5) ? 'cage' : 'cage2', fit.x, fit.y, rng.f(0, 6.28), 1.0, r.id);
          }
        }
      } else if (arch === 'SPORE_NURSERY') {
        if (freeInterior.length > 0) { const fit = freeInterior[Math.floor(freeInterior.length/2)]; putF('sporePod', fit.x, fit.y, 0, 1.2, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('moss', ct.x, ct.y, rng.f(0,6.28), 1.2, r.id); }
      } else if (arch === 'MEGALITH_RIDGE' || arch === 'DRUIDIC_GROVE') {
        if (freeInterior.length > 0) { const fit = freeInterior[Math.floor(freeInterior.length/2)]; putF('megalith', fit.x, fit.y, 0, 1.2, r.id); }
      } else if (arch === 'WITCH_HOVEL') {
        if (freeInterior.length > 0) { const fit = freeInterior[Math.floor(freeInterior.length/2)]; putF('cauldron', fit.x, fit.y, 0, 1.1, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('urn', ct.x, ct.y, 0, 0.9, r.id); }
      } else if (arch === 'PALISADE_ARMORY' || arch === 'COMMAND_PAVILION') {
        if (arch === 'COMMAND_PAVILION') {
          placePlanningTable('globe');
        } else if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length/2)];
          putF('wagon', fit.x, fit.y, 0, 1, r.id);
        }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('weaponRack', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1, r.id); }
      } else if (arch === 'ARMORY') {
        if (wallTiles.length > 0) { const wt = wallTiles[0]; putF('weaponRack', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1, r.id); }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('barrel', ct.x, ct.y, rng.f(0,6.28), 1, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('crate', ct2.x, ct2.y, rng.f(0,6.28), 1, r.id); }
        placePlanningTable();
        if (wallTiles.length > 1) { const wt = wallTiles[1]; props.push({kind:'tapestry', x:wt.x, y:wt.y, dx:wt.dx, dy:wt.dy, rot:0, scale:1, roomId:r.id}); }
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
          const fit = freeInterior[Math.floor(freeInterior.length/2)];
          if (thKey === 'ancient') {
            putF('lectern', fit.x, fit.y, rng.i(0,3)*Math.PI/2, 1, r.id);
          } else {
            placePlanningTable();
          }
        }
        if (cornerTiles.length > 0) {
          const ct = cornerTiles[0];
          putF(thKey === 'ancient' ? 'grainjars' : 'urn', ct.x, ct.y, rng.f(0,6.28), 0.95, r.id);
        }
        if (cornerTiles.length > 1 && thKey === 'ancient') {
          const ct2 = cornerTiles[1];
          putF('grainjars', ct2.x, ct2.y, rng.f(0,6.28), 0.95, r.id);
        }
      } else if (arch === 'SOLAR_OBSERVATORY') {
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length/2)];
          putF('magicCircle', fit.x, fit.y, 0, 1.25, r.id);
          putF('lectern', fit.x, fit.y, 0, 1, r.id);
        }
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
        if (freeInterior.length > 0) {
          const fit = freeInterior[Math.floor(freeInterior.length/2)];
          putF('magicCircle', fit.x, fit.y, 0, 1, r.id);
        }
        if (wallTiles.length > 0) {
          placeStudyDesk(wallTiles[0]);
        }
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('brazier', ct.x, ct.y, 0, 1, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('barrel', ct2.x, ct2.y, rng.f(0,6.28), 1, r.id); }
      } else if (arch === 'ASHEN_GUARDHOUSE' || arch === 'GUARD_ROOM') {
        placePlanningTable();
        if (cornerTiles.length > 0) { const ct = cornerTiles[0]; putF('barrel', ct.x, ct.y, rng.f(0,6.28), 1, r.id); }
        if (cornerTiles.length > 1) { const ct2 = cornerTiles[1]; putF('crate', ct2.x, ct2.y, rng.f(0,6.28), 1, r.id); }
        if (wallTiles.length > 0) { const wt = wallTiles[0]; props.push({kind:'tapestry', x:wt.x, y:wt.y, dx:wt.dx, dy:wt.dy, rot:0, scale:1, roomId:r.id}); }
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
          const fit = freeInterior[Math.floor(freeInterior.length/2)];
          if (thKey === 'ancient' && rng.chance(0.5)) {
            putF('lectern', fit.x, fit.y, rng.f(0, 6.28), 1, r.id);
          }
        }
        if (wallTiles.length > 1) {
          const wt = wallTiles[1];
          if (thKey === 'ancient' && rng.chance(0.6)) putF('scrollshelf', wt.x, wt.y, Math.atan2(-wt.dx, -wt.dy), 1, r.id);
          else props.push({kind:'sconce', x:wt.x, y:wt.y, dx:wt.dx, dy:wt.dy, rot:0, scale:1, roomId:r.id});
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
          const fit = freeInterior[Math.floor(freeInterior.length/2)];
          putF('chest', fit.x, fit.y, 0, 1.2, r.id);
        }
      }

      if (wallTiles.length > 2 && rng.chance(0.65*dmul('sconces'))) {
        const wt = wallTiles[2];
        props.push({kind:'sconce', x:wt.x, y:wt.y, dx:wt.dx, dy:wt.dy, rot:0, scale:1, roomId:r.id});
      }

      /* decor.furniture above 1 sprinkles generic clutter onto the tiles the
         archetype pass left empty, so "more furniture" is available as well as
         less, without every room repeating its archetype's exact set. */
      const extraFurn = dmul('furniture') - 1;
      if(extraFurn > 0){
        const pick = a => a[rng.i(0, a.length-1)];
        /* per-tile rates kept low: an archetype only places a handful of pieces,
           so filling every free tile would be orders of magnitude more, not "a
           bit more". At the 2.0 end this lands around 3x the designed clutter. */
        const sprinkle = (tiles, kinds, faceWall, rate) => {
          for(const t of tiles){
            if(occ[idx(t.x,t.y)] || !rng.chance(extraFurn * rate)) continue;
            const rot = faceWall ? Math.atan2(-t.dx, -t.dy) : rng.i(0,3)*(Math.PI/2);
            put(pick(kinds), t.x, t.y, rot, 1, r.id);
          }
        };
        sprinkle(cornerTiles, ['barrel','crate','urn'], false, 0.10);
        // Wall furniture sits against walls facing the room (including benches and chairs):
        sprinkle(wallTiles, ['bookshelf','weaponRack','bench','chair'], true, 0.08);
        // Free interior never gets random lone chairs scattered in open space
      }
    }

    if(r.type===TYPE.COMBAT || r.type===TYPE.ELITE || r.type===TYPE.BOSS){
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
        for(const c of crs) spawnSpecs.push({ targetCR: c, role: null });
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

  const torchCand=[];
  for(let y=0;y<H;y++){
    const row=y*W;
    for(let x=0;x<W;x++){
      const c=row+x;
      if(grid[c]!==WALL) continue;
      if(x<W-1 && grid[c+1]===FLOOR)      torchCand.push({x,y,dx:1,dy:0});
      else if(x>0 && grid[c-1]===FLOOR)   torchCand.push({x,y,dx:-1,dy:0});
      else if(y<H-1 && grid[c+W]===FLOOR) torchCand.push({x,y,dx:0,dy:1});
      else if(y>0 && grid[c-W]===FLOOR)   torchCand.push({x,y,dx:0,dy:-1});
    }
  }
  for(let i=torchCand.length-1;i>0;i--){ const j=rng.i(0,i); const t=torchCand[i]; torchCand[i]=torchCand[j]; torchCand[j]=t; }
  const torches=[];
  for(const c of torchCand){
    let ok=true;
    for(const t of torches) if(Math.max(Math.abs(t.x-c.x),Math.abs(t.y-c.y))<4){ ok=false; break; }
    if(ok) torches.push(c);
  }
  for(let y=0;y<H;y++){
    const row=y*W;
    for(let x=0;x<W;x++){
      const c=row+x;
      if(grid[c]!==FLOOR || occ[c] || doorway[c] || lakeMask[c]) continue;
      const rid = roomId[c];
      const diff = rid>=0 ? rooms[rid].difficulty : 0.5;
      let p = params.decorDensity * 0.045 * dmul('debris') * (1.25 - 0.6*diff);
      if(corridor[c]) p *= 0.45;
      if(rng.chance(p)){
        if(rng.chance(0.35)){
          props.push({kind:'fallenBrick',x,y,rot:rng.f(0,6.28),scale:rng.f(0.85,1.2),roomId:rid});
        } else {
          props.push({kind:'debris',x,y,rot:rng.f(0,6.28),scale:rng.f(0.6,1.35),roomId:rid,v:rng.i(0,2)});
        }
      } else if(TH.propScatter && !nearDoor(x,y,1)){
        for(const k in TH.propScatter){
          if(k === 'coffin' || k === 'sarco') continue; // Sarcophagi/coffins are strictly placed via architectural passes
          if(rng.chance(TH.propScatter[k]*params.decorDensity*(corridor[c]?0.4:1))){
            props.push({kind:k, x, y, rot:rng.i(0,3)*(Math.PI/2), scale:rng.f(0.85,1.2), roomId:rid});
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
  for(let y=1; y<H-1; y++){
    const row=y*W;
    for(let x=1; x<W-1; x++){
      const c=row+x;
      if(grid[c]!==FLOOR || occ[c] || doorway[c] || lakeMask[c] || nearDoor(x,y,1)) continue;
      const rid = roomId[c];
      const wL = (grid[c-1] === WALL);
      const wR = (grid[c+1] === WALL);
      const wU = (grid[c-W] === WALL);
      const wD = (grid[c+W] === WALL);

      let cornerDx = 0, cornerDy = 0, baseRot = 0;
      if(wL && wU && grid[c-W-1] === WALL)      { cornerDx = -1; cornerDy = -1; baseRot = 0; }
      else if(wR && wU && grid[c-W+1] === WALL) { cornerDx = 1;  cornerDy = -1; baseRot = -Math.PI/2; }
      else if(wR && wD && grid[c+W+1] === WALL) { cornerDx = 1;  cornerDy = 1;  baseRot = Math.PI; }
      else if(wL && wD && grid[c+W-1] === WALL) { cornerDx = -1; cornerDy = 1;  baseRot = Math.PI/2; }

      if(cornerDx !== 0 && cornerDy !== 0){
        const isAncient = (thKey === 'ancient');
        const cornerChance = (isAncient ? 0.75 : 0.52) * params.decorDensity * dmul('debris') * (corridor[c] ? 0.6 : 1.0);
        if(rng.chance(cornerChance)){
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
  const floorDir = (x,y)=>{
    const c=idx(x,y);
    if(x<W-1 && grid[c+1]===FLOOR) return [1,0];
    if(x>0 && grid[c-1]===FLOOR) return [-1,0];
    if(y<H-1 && grid[c+W]===FLOOR) return [0,1];
    if(y>0 && grid[c-W]===FLOOR) return [0,-1];
    return null;
  };
  /* The `|| DEC.x` arms let the editor's decor sliders switch a sweep on for a
     theme that wouldn't otherwise run it. Untouched sliders leave DEC.x
     undefined, so the theme's own rules still decide. */
  if(TH.icicles || DEC.icicles){
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      if(grid[idx(x,y)]!==WALL) continue;
      const d = floorDir(x,y);
      if(d && rng.chance((0.06 + 0.08*params.decorDensity) * dmul('icicles')))
        props.push({kind:'icicle',x,y,dx:d[0],dy:d[1],rot:rng.f(0,6.28),scale:rng.f(0.7,1.3)});
    }
    /* Ice shards grow anywhere on open floor, not just on the frozen lakes —
       those just stay the densest spot. Each hit drops a cluster of 1-3 with
       independent sizes and sub-tile offsets, so they read as a shattered heap
       rather than one shard centred in every cell. */
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      const c = idx(x,y);
      if(grid[c]!==FLOOR || occ[c] || doorway[c]) continue;
      const p = (lakeMask[c] ? 0.05 : 0.014) * params.decorDensity * dmul('icicles');
      if(!rng.chance(p)) continue;
      const rv = rng.raw();
      const n = rv < 0.5 ? 1 : (rv < 0.82 ? 2 : 3);
      const rid = roomId[c];
      for(let s=0; s<n; s++){
        const lead = s === 0;
        props.push({kind:'shardIce', x, y,
                    ox: lead ? rng.f(-0.14, 0.14) : rng.f(-0.34, 0.34),
                    oz: lead ? rng.f(-0.14, 0.14) : rng.f(-0.34, 0.34),
                    rot: rng.f(0, 6.28),
                    scale: lead ? rng.f(0.55, 1.65) : rng.f(0.3, 0.9),
                    roomId: rid});
      }
    }
  }
  const mossMask = new Uint8Array(W*H);
  if(TH.roots){
    const sites=[];
    for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++){
      if(grid[idx(x,y)]!==WALL) continue;
      const d = floorDir(x,y);
      if(d && roomId[idx(x+d[0],y+d[1])]>=0) sites.push({x,y,dx:d[0],dy:d[1]});
    }
    for(let i=sites.length-1;i>0;i--){ const j=rng.i(0,i); const t=sites[i]; sites[i]=sites[j]; sites[j]=t; }
    const breaches=[];
    for(const s of sites){
      if(breaches.length>=5) break;
      let close=false;
      for(const b of breaches) if(Math.max(Math.abs(b.x-s.x),Math.abs(b.y-s.y))<7){ close=true; break; }
      if(!close) breaches.push(s);
    }
    for(const b of breaches){
      props.push({kind:'roots',x:b.x,y:b.y,dx:b.dx,dy:b.dy,rot:0,scale:rng.f(0.9,1.2)});
      for(let oy=-2;oy<=2;oy++) for(let ox=-2;ox<=2;ox++){
        const nx=b.x+ox, ny=b.y+oy;
        if(!inB(nx,ny)) continue;
        const c=idx(nx,ny);
        if(grid[c]===FLOOR && !mossMask[c] && rng.chance(0.75)){
          mossMask[c]=1; props.push({kind:'moss',x:nx,y:ny,rot:rng.f(0,6.28),scale:rng.f(0.7,1.4)});
        }
      }
    }
  }
  /* Wall-fringe moss: its own sweep, so raising the slider grows moss on any
     theme rather than only the root-breached ones. */
  if(TH.roots || DEC.moss){
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      const c=idx(x,y);
      if(grid[c]!==FLOOR || mossMask[c] || lakeMask[c]) continue;
      let nw=0;
      if(x<W-1 && grid[c+1]===WALL) nw++; if(x>0 && grid[c-1]===WALL) nw++;
      if(y<H-1 && grid[c+W]===WALL) nw++; if(y>0 && grid[c-W]===WALL) nw++;
      if(nw>0 && rng.chance(0.12*params.decorDensity*dmul('moss'))){
        mossMask[c]=1; props.push({kind:'moss',x,y,rot:rng.f(0,6.28),scale:rng.f(0.6,1.3)});
      }
    }
  }
  if(TH.bones || thKey==='grim' || thKey==='ancient'){
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      const c=idx(x,y);
      if(grid[c]!==FLOOR || occ[c] || doorway[c]) continue;
      const rid = roomId[c];
      if(rid>=0){
        const r = rooms[rid];
        const isCryptRoom = r && (r.grave || r.type===TYPE.BOSS || thKey==='grim');
        const pChance = (isCryptRoom ? (0.05 + 0.04*params.decorDensity) : (0.018 + 0.02*params.decorDensity)) * dmul('bones');
        if(rng.chance(pChance)){
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
          props.push({kind: bKind, x, y, rot: rng.f(0,6.28), scale: rng.f(0.85,1.25), roomId: rid});
        }
      }
    }
  }
  /* Spiderweb corner sweep. Anchored on FLOOR cells that have walls on two
     perpendicular sides — an inside corner — because that is the only place the
     web geometry has two faces to span. dx/dy point at those two walls; the
     renderer hangs the fan off the post where they meet. Corners are far rarer
     than wall tiles, so the per-site chance is correspondingly higher. */
  for(let y=1; y<H-1; y++) for(let x=1; x<W-1; x++){
    const c = idx(x,y);
    if(grid[c] !== FLOOR || doorway[c] || lakeMask[c]) continue;
    const rid = roomId[c];
    if(rid < 0) continue;
    const r = rooms[rid];
    const isWebby = r && (r.grave || thKey === 'grim' || thKey === 'ancient' ||
                          thKey === 'verdant' || DEC.webs);
    if(!isWebby) continue;
    const sx = grid[c+1] === WALL ? 1 : (grid[c-1] === WALL ? -1 : 0);
    const sy = grid[c+W] === WALL ? 1 : (grid[c-W] === WALL ? -1 : 0);
    if(!sx || !sy) continue;
    if(rng.chance(0.5 * params.decorDensity * dmul('webs')))
      props.push({kind: 'spiderWeb', x, y, dx: sx, dy: sy, rot: 0,
                  scale: rng.f(0.85, 1.05), roomId: rid});
  }

  /* Cut-out wall ossuary niches for Grim crypts & catacombs */
  if(thKey === 'grim' || TH.bones){
    for(let y=1; y<H-1; y++) for(let x=1; x<W-1; x++){
      const c = idx(x,y);
      if(grid[c] !== FLOOR || occ[c] || doorway[c] || lakeMask[c]) continue;
      const rid = roomId[c];
      // Check if adjacent to exactly 1 wall
      let wdx = 0, wdy = 0, wc = 0;
      if(grid[c+1] === WALL) { wdx = 1; wc++; }
      if(grid[c-1] === WALL) { wdx = -1; wc++; }
      if(grid[c+W] === WALL) { wdy = 1; wc++; }
      if(grid[c-W] === WALL) { wdy = -1; wc++; }
      if(wc === 1){
        const isCorridor = corridor[c];
        const isCrypt = rid >= 0 && (rooms[rid]?.grave || thKey === 'grim');
        const chance = (isCorridor ? 0.09 : (isCrypt ? 0.07 : 0.02)) * params.decorDensity;
        if(rng.chance(chance)){
          props.push({kind:'ossuaryWall', x, y, dx:wdx, dy:wdy, rot:0, scale:1, roomId:rid});
          occ[c] = 1;
        }
      }
    }
  }

  /* Norse & Barbarian prop scatter for Frost theme */
  if(thKey === 'frost'){
    for(let y=1; y<H-1; y++) for(let x=1; x<W-1; x++){
      const c = idx(x,y);
      if(grid[c] !== FLOOR || occ[c] || doorway[c] || lakeMask[c]) continue;
      const rid = roomId[c];
      let wdx = 0, wdy = 0, wc = 0;
      if(grid[c+1] === WALL) { wdx = 1; wc++; }
      if(grid[c-1] === WALL) { wdx = -1; wc++; }
      if(grid[c+W] === WALL) { wdy = 1; wc++; }
      if(grid[c-W] === WALL) { wdy = -1; wc++; }

      if(wc === 1 && rng.chance(0.04 * params.decorDensity)){
        const pick = rng.pick(['shieldRack', 'mammothTusks', 'runicObelisk']);
        props.push({kind: pick, x, y, rot: Math.atan2(wdx, wdy), scale: rng.f(0.9, 1.1), roomId: rid});
        occ[c] = 1;
      } else if(wc >= 2 && rng.chance(0.06 * params.decorDensity)){
        const pick = rng.pick(['glacialSpire', 'boneTotem']);
        props.push({kind: pick, x, y, rot: rng.f(0, 6.28), scale: rng.f(0.9, 1.15), roomId: rid});
        occ[c] = 1;
      }
    }
  }
  { const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
    if(TH.pools && (TH.pools.mode===0 || TH.pools.mode===3)){
      const pv = TH.pools.mode===0 ? 0.8 : 0.45;
      for(const p of pools)
        for(const [dx,dy] of DIRS){
          const nx=p.x+dx, ny=p.y+dy;
          if(!inB(nx,ny) || grid[idx(nx,ny)]!==FLOOR) continue;
          if(rng.chance(pv))
            props.push({kind:'crack',x:nx,y:ny,dx,dy,rot:rng.f(0,6.28),scale:rng.f(0.9,1.5)});
        }
    }
    if(TH.lakes){
      for(const lc of lakeCells)
        for(const [dx,dy] of DIRS){
          const nx=lc.x+dx, ny=lc.y+dy;
          if(!inB(nx,ny)) continue;
          const c2 = idx(nx,ny);
          if(grid[c2]!==FLOOR || lakeMask[c2]) continue;
          if(rng.chance(0.3))
            props.push({kind:'crack',x:nx,y:ny,dx,dy,rot:rng.f(0,6.28),scale:rng.f(0.7,1.2),ice:1});
        }
    }
  }
  for(const r of rooms){
    if(r.type!==TYPE.ELITE && r.type!==TYPE.BOSS) continue;
    const cand=[];
    for(let y=Math.floor(r.cy-r.h/2)-1; y<=Math.ceil(r.cy+r.h/2)+1; y++)
      for(let x=Math.floor(r.cx-r.w/2)-1; x<=Math.ceil(r.cx+r.w/2)+1; x++){
        if(!inB(x,y) || grid[idx(x,y)]!==WALL) continue;
        const d = floorDir(x,y);
        if(d && roomId[idx(x+d[0],y+d[1])]===r.id) cand.push({x,y,dx:d[0],dy:d[1]});
      }
    for(let i=cand.length-1;i>0;i--){ const j=rng.i(0,i); const t=cand[i]; cand[i]=cand[j]; cand[j]=t; }
    const placed=[];
    for(const s of cand){
      if(placed.length >= (r.type===TYPE.BOSS?4:2)) break;
      let close=false;
      for(const p of placed) if(Math.max(Math.abs(p.x-s.x),Math.abs(p.y-s.y))<4){ close=true; break; }
      if(!close){ placed.push(s); props.push({kind:'banner',x:s.x,y:s.y,dx:s.dx,dy:s.dy,rot:0,scale:1}); }
    }
  }

  if(thKey === 'molten'){
    for(const r of rooms){
      const cand=[];
      for(let y=Math.floor(r.cy-r.h/2)-1; y<=Math.ceil(r.cy+r.h/2)+1; y++)
        for(let x=Math.floor(r.cx-r.w/2)-1; x<=Math.ceil(r.cx+r.w/2)+1; x++){
          if(!inB(x,y) || grid[idx(x,y)]!==WALL) continue;
          const d = floorDir(x,y);
          if(d && roomId[idx(x+d[0],y+d[1])]===r.id) cand.push({x,y,dx:d[0],dy:d[1]});
        }
      for(let i=cand.length-1;i>0;i--){ const j=rng.i(0,i); const t=cand[i]; cand[i]=cand[j]; cand[j]=t; }
      const maxChains = r.type === TYPE.BOSS ? 4 : (rng.chance(0.65) ? rng.i(1, 2) : 0);
      const placedChains = [];
      for(const s of cand){
        if(placedChains.length >= maxChains) break;
        let close = false;
        for(const p of placedChains) if(Math.max(Math.abs(p.x-s.x), Math.abs(p.y-s.y)) < 3){ close=true; break; }
        if(!close){
          placedChains.push(s);
          props.push({kind:'hangingChains', x:s.x, y:s.y, dx:s.dx, dy:s.dy, rot:0, scale:1, roomId:r.id});
        }
      }
    }
  }

  const loops = edges.filter(e=>e.isLoop).length;

  /* Terrain elevation, last: buildElevation needs the FINAL walkable set, so it
     runs after every carving pass (pools, pits, doorway widening) and after
     props — props read their Y from the cell they stand on, so anything on a
     dais rides up with it without extra bookkeeping. */
  const { height, ramp, features: elevationFeatures } =
    buildElevation({ W, H, grid, roomId, corridor, doorway, rooms, params, lakeMask, props,
                     /* So stair carving sees a prop's whole footprint, not just the tile
                        it is centred on. Passed in rather than imported: pathfinding.js
                        already imports elevation.js, and importing back would close the
                        cycle. */
                     footprintCells: getPropFootprintCells,
                     /* And which of those footprints pathfinding will treat as a
                        wall, so terrain is planned around them instead of being
                        repaired later by deleting them. */
                     isSolidProp: pr => !!pr && SOLID_PROP_KINDS.has(pr.kind)
                                    && !(pr.podium && PODIUM_PROP_KINDS.has(pr.kind)) }, rng);

  /* Intelligent ceremonial carpet pass:
     Places carpets only on completely flat ground (no steps, no ramps),
     guarantees clearance from all pillars and architectural obstructions,
     and positions them beneath or before relevant focal furniture. */
  placeCeremonialCarpets({ W, H, grid, roomId, rooms, props, height, ramp, rng, themeKey: params.themeKey, doorway });

  return {
    valid, params, seed, name:dungeonName(rng, TH), themeKey: params.themeKey,
    W,H, grid, roomId, corridor, doorway, bfs, maxBfs,
    height, ramp, elevationFeatures,
    rooms, edges, entrance, boss, maxDepth,
    props, spawns, torches, pools, lakeCells, lakeMask, arches,
    stats:{ rooms:N, edges:edges.length, loops, critLen, floorTiles:floorTotal, reach, genMs:0, attempts:1 }
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
      'boneTotem', 'sarco', 'tombstone', 'cage', 'cage2'
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

function generateOverland(params){
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

  const W = Math.max(48, Math.min(120, params.mapW || 58));
  const H = Math.max(48, Math.min(120, params.mapH || 58));
  const total = W*H;
  /* Zone density is set for BATTLEFIELD-sized clearings (radius 8-12), so it is
     far sparser than the old wide-spot-in-the-road zones. Callers that do not
     pass `zones` — every hand-authored story mission — land here, so this
     divisor is what keeps their maps from being wall-to-wall clearing. */
  const zoneTarget = Math.max(4, Math.min(12, params.zones || Math.round(total/900)));
  const idx = (x,y)=> y*W + x;
  const inB = (x,y)=> x>=0 && y>=0 && x<W && y<H;
  const hn = (x,y,k)=>{ const s=Math.sin(x*127.1 + y*311.7 + k*74.7 + (seed%1000)*0.573)*43758.5453; return s-Math.floor(s); };

  const rooms = [];
  const addZone = (cx,cy,rad)=> rooms.push({ id:rooms.length, cx, cy, w:rad*2, h:rad*2, rad,
    arch:'m', shape:'zone', type:TYPE.COMBAT, depth:0, difficulty:0.2, degree:0,
    sx0:cx, sy0:cy });
  /* Clearings are BIG — each one is a battlefield you fight across, not a wide
     spot in the road. `minD` is the centre-to-centre spacing the road has to
     deliver to keep open ground between them (roughly two radii plus a march). */
  const ZONE_RAD = [8, 12];
  const campRad = Math.min(15, 12 + Math.floor((Math.max(W,H)-92)/16));
  const minD = Math.max(30, Math.round(Math.sqrt(total/zoneTarget)*0.72));

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
  {
    /* start hard against one side so the first haul crosses the map */
    const startLeft = rng.chance(0.5);
    let x = startLeft ? xLo + rng.i(2, 8) : xHi - rng.i(2, 8);
    let dir = startLeft ? 1 : -1;
    let y = yBot;
    road.push([x, y]);
    for(let l = 0; l < legs; l++){
      /* climb */
      y = Math.max(yTop, y - vstep*rng.f(0.72, 1.28));
      road.push([x, y]);
      /* long run — turn back early if this side is running out of map */
      let run = runAvg*rng.f(0.65, 1.35);
      const roomR = xHi - x, roomL = x - xLo;
      if(dir > 0 && roomR < run*0.55) dir = -1;
      else if(dir < 0 && roomL < run*0.55) dir = 1;
      run = Math.min(run, dir > 0 ? roomR : roomL);
      x += dir*run;
      road.push([x, y]);
      dir = -dir;
    }
    road.push([x, yTop]);              // final climb into the camp
  }

  /* walk the polyline and drop a zone every `step` tiles of travel */
  {
    const seg = [];
    let totalLen = 0;
    for(let i = 0; i < road.length-1; i++){
      const L = Math.hypot(road[i+1][0]-road[i][0], road[i+1][1]-road[i][1]);
      seg.push(L); totalLen += L;
    }
    const at = s => {
      let acc = 0;
      for(let i = 0; i < seg.length; i++){
        if(acc + seg[i] >= s || i === seg.length-1){
          const t = seg[i] > 0 ? Math.min(1, (s - acc)/seg[i]) : 0;
          return [road[i][0] + t*(road[i+1][0]-road[i][0]),
                  road[i][1] + t*(road[i+1][1]-road[i][1])];
        }
        acc += seg[i];
      }
      return road[road.length-1];
    };
    for(let i = 0; i < zoneTarget; i++){
      const last = i === zoneTarget-1;
      const [px, py] = at(totalLen * (i/(zoneTarget-1)));
      const rad = last ? campRad : rng.i(ZONE_RAD[0], ZONE_RAD[1]);
      const pad = rad + 2;
      /* nudge each clearing off the centreline so the road isn't a ruler */
      const jx = last ? 0 : rng.i(-2,2), jy = last ? 0 : rng.i(-2,2);
      addZone(
        Math.max(pad, Math.min(W-1-pad, Math.round(px) + jx)),
        Math.max(pad, Math.min(H-1-pad, Math.round(py) + jy)),
        rad
      );
    }
  }

  const N = rooms.length, entrance = 0, boss = N - 1;
  rooms[entrance].type = TYPE.ENTRANCE;
  rooms[boss].type = TYPE.BOSS;

  /* one edge per step of the journey — no Delaunay, no MST, no loops */
  const edges = [];
  for(let i = 0; i < N-1; i++) edges.push({a:i, b:i+1, isLoop:false, isCritical:true});
  for(const e of edges){ rooms[e.a].degree++; rooms[e.b].degree++; }
  const gAdj = Array.from({length:N},()=>[]);
  edges.forEach((e,i)=>{ gAdj[e.a].push({b:e.b,i}); gAdj[e.b].push({b:e.a,i}); });
  const edgeSet = new Set(edges.map(e=> Math.min(e.a,e.b)*64 + Math.max(e.a,e.b)));

  /* on a path the graph distance from the entrance IS the index, so difficulty
     ramps evenly from the trailhead to the camp */
  const maxDepth = Math.max(1, N-1);
  rooms.forEach((r,i)=>{ r.depth = i; r.difficulty = Math.min(1, 0.15 + 0.85*(i/maxDepth)); });
  rooms[entrance].difficulty = 0; rooms[boss].difficulty = 1;
  rooms.maxDepth = maxDepth;

  /* Place the treasure and shrine by position ALONG the journey. Sorting by
     depth (the old behaviour) would now always pick the zone immediately before
     the camp, since depth is just the index. */
  if(N >= 4){
    const at = f => Math.max(1, Math.min(N-2, Math.round((N-1)*f)));
    const ti = at(0.70 + rng.f(-0.06, 0.06));
    rooms[ti].type = TYPE.TREASURE;
    let si = at(0.40 + rng.f(-0.08, 0.08));
    if(si === ti) si = ti - 1;
    if(si >= 1 && si !== ti) rooms[si].type = TYPE.SHRINE;
  }

  const grid = new Uint8Array(total).fill(FLOOR);
  const roomId = new Int16Array(total);
  const corridor = new Uint8Array(total);
  const doorway = new Uint8Array(total);
  const protect = new Uint8Array(total);
  const palisadeMask = new Uint8Array(total);
  const near1 = new Int16Array(total), bDist = new Float32Array(total);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const c=idx(x,y);
    let d1=1e9, d2=1e9, a=-1, b2=-1;
    for(const r of rooms){
      const dd=(r.cx-x)*(r.cx-x)+(r.cy-y)*(r.cy-y);
      if(dd<d1){ d2=d1; b2=a; d1=dd; a=r.id; }
      else if(dd<d2){ d2=dd; b2=a; }
    }
    roomId[c]=a; near1[c]=b2;
    bDist[c]=Math.sqrt(d2)-Math.sqrt(d1);
  }

  const stampTrail = (A,B)=>{
    let x=A.cx, y=A.cy, steps=0;
    const path=[];
    while((x!==B.cx || y!==B.cy) && steps++<500){
      path.push([x,y]);
      const dxs=Math.sign(B.cx-x), dys=Math.sign(B.cy-y);
      if(rng.chance(0.16) && steps>2){
        if(Math.abs(B.cx-x) >= Math.abs(B.cy-y)) y = Math.max(2,Math.min(H-3, y + (rng.chance(0.5)?1:-1)));
        else x = Math.max(2,Math.min(W-3, x + (rng.chance(0.5)?1:-1)));
      }
      else if(Math.abs(B.cx-x) >= Math.abs(B.cy-y)) x+=dxs; else y+=dys;
    }
    path.push([B.cx,B.cy]);
    const half = path.length/2;
    path.forEach(([px,py], i)=>{
      const own = i<half ? A.id : B.id;
      for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
        /* NB: this bounds test read `py+py` until 2026-07-27, so every trail
           cell in the bottom half of the map was skipped — no protect, no
           corridor. The old loop-rich zone graph routed around the damage;
           a single linear path cannot, which is how it finally surfaced. */
        if(!inB(px+ox,py+oy)) continue;
        const c=idx(px+ox,py+oy);
        protect[c]=1;
        if(Math.abs(ox)+Math.abs(oy)<=1){ corridor[c]=1; roomId[c]=own; }
      }
    });
  };
  for(const e of edges) stampTrail(rooms[e.a], rooms[e.b]);
  for(const r of rooms)
    for(let oy=-3;oy<=3;oy++) for(let ox=-3;ox<=3;ox++)
      if(inB(r.cx+ox,r.cy+oy) && ox*ox+oy*oy<=9) protect[idx(r.cx+ox,r.cy+oy)]=1;

  const camp = rooms[boss], campR = camp.rad;
  const campD2 = (x,y)=> (x-camp.cx)*(x-camp.cx)+(y-camp.cy)*(y-camp.cy);
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
    const q = new Int32Array(total); let qh=0, qt=0;
    /* seeded from the trail CENTRELINE only — seeding whole zone clearings too
       would measure the band from the clearing edge and blow the ribbon out
       into an open field. Clearings are kept open by their own test below. */
    for(let c = 0; c < total; c++) if(corridor[c]){ roadDist[c]=0; q[qt++]=c; }
    const maxD = 40;
    while(qh<qt){
      const c=q[qh++], x=c%W, dnext=roadDist[c]+1;
      if(dnext>maxD) continue;
      let n;
      if(x>0        && roadDist[n=c-1]<0){ roadDist[n]=dnext; q[qt++]=n; }
      if(x<W-1      && roadDist[n=c+1]<0){ roadDist[n]=dnext; q[qt++]=n; }
      if(c>=W       && roadDist[n=c-W]<0){ roadDist[n]=dnext; q[qt++]=n; }
      if(c<total-W  && roadDist[n=c+W]<0){ roadDist[n]=dnext; q[qt++]=n; }
    }
  }
  const [bandMin, bandVar] = OC.roadBand;

  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const c=idx(x,y);
    if(protect[c]) continue;
    if(campD2(x,y) < (campR+2)*(campR+2)) continue;
    const zr = rooms[roomId[c]];
    const inZone = zr && (zr.cx-x)*(zr.cx-x)+(zr.cy-y)*(zr.cy-y) <= (zr.rad+1)*(zr.rad+1);
    const rd = roadDist[c];
    if(!inZone && (rd < 0 || rd > bandMin + hn(x,y,7)*bandVar)){ grid[c]=WALL; continue; }
    const de = Math.min(x, y, W-1-x, H-1-y);
    if(de < OC.edgeMin + Math.floor(hn(x,y,1)*OC.edgeRand)){ grid[c]=WALL; continue; }
    if(bDist[c] < 2.1){
      const a=roomId[c], b2=near1[c];
      const linked = b2>=0 && edgeSet.has(Math.min(a,b2)*64 + Math.max(a,b2));
      if(hn(x,y,2) < (linked ? OC.beltLinked : OC.belt) * density){ grid[c]=WALL; continue; }
    }
    if(hn(x,y,3) < OC.lone*density) grid[c]=WALL;
  }
  const copseCount = Math.round(total/OC.copseDiv);
  for(let k=0;k<copseCount;k++){
    const x0=rng.i(6,W-7), y0=rng.i(6,H-7), r0=rng.f(1.6,3.2);
    let ok = campD2(x0,y0) > (campR+5)*(campR+5);
    for(const r of rooms) if(ok && (r.cx-x0)*(r.cx-x0)+(r.cy-y0)*(r.cy-y0) < 25) ok=false;
    if(!ok) continue;
    for(let oy=-4;oy<=4;oy++) for(let ox=-4;ox<=4;ox++){
      const x=x0+ox, y=y0+oy;
      if(!inB(x,y) || protect[idx(x,y)]) continue;
      if(ox*ox+oy*oy <= r0*r0 && rng.chance(OC.copseChance)) grid[idx(x,y)]=WALL;
    }
  }

  const props=[], arches=[], spawns=[], pools=[], lakeCells=[], lakeMask=new Uint8Array(total);
  if(OC.camp.palisade){
    for(let y=camp.cy-campR-2; y<=camp.cy+campR+2; y++)
      for(let x=camp.cx-campR-2; x<=camp.cx+campR+2; x++){
        if(!inB(x,y)) continue;
        const d2 = (x-camp.cx)*(x-camp.cx)+(y-camp.cy)*(y-camp.cy);
        if(Math.abs(Math.sqrt(d2)-campR) < 0.85){
          const c=idx(x,y);
          if(corridor[c]){
            // Open palisade camp entrance (overland maps do not use doors)
          }
          else { grid[c]=WALL; palisadeMask[c]=1; roomId[c]=boss; }
        }
      }
  }
  if(OC.camp.tents){
    const [tMin, tMax] = Array.isArray(OC.camp.tents) ? OC.camp.tents : [3,5];
    const numT = rng.i(tMin, tMax);
    for(let k=0;k<numT;k++){
      const a = k*(Math.PI*2/numT) + rng.f(-0.3,0.3);
      const r = rng.f(campR*0.35, campR*0.7);
      const tx = Math.round(camp.cx + Math.cos(a)*r), ty = Math.round(camp.cy + Math.sin(a)*r);
      if(inB(tx,ty) && grid[idx(tx,ty)]===FLOOR)
        props.push({kind:'tent', x:tx, y:ty, rot:a+Math.PI/2, scale:rng.f(0.9,1.2), roomId:boss});
    }
    props.push({kind:'brazier', x:camp.cx, y:camp.cy, rot:0, scale:1.3, roomId:boss});
  }
  if(OC.camp.bones){
    for(let k=0;k<8;k++){
      const a=rng.f(0,6.28), r=rng.f(1,campR*0.8);
      const bx=Math.round(camp.cx+Math.cos(a)*r), by=Math.round(camp.cy+Math.sin(a)*r);
      if(inB(bx,by) && grid[idx(bx,by)]===FLOOR)
        props.push({kind:'bones', x:bx, y:by, rot:rng.f(0,6.28), scale:rng.f(0.7,1.2), roomId:boss});
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
  if(OC.liquid && OC.liquid.amount > 0){
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
      for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
        const nc = idx(x+ox, y+oy);
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
      if(x > 0) out.push(c - 1);
      if(x < W - 1) out.push(c + 1);
      if(c >= W) out.push(c - W);
      if(c < W * H - W) out.push(c + W);
      return out;
    };
    flood4 = (g) => {
      const seen = new Uint8Array(W * H);
      if(g[refCellL] !== FLOOR) return seen;
      const st = [refCellL]; seen[refCellL] = 1;
      while(st.length){
        const c = st.pop();
        for(const n of nb4(c)){
          if(seen[n] || g[n] !== FLOOR) continue;
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
    for(let c = 0; c < W * H; c++) if(grid[c] === FLOOR) preLiquidFloor[c] = 1;

    /* Walk a shuffled list of eligible cells rather than throwing random darts:
       most of an overland map is tree cover, so darts mostly miss. Same pattern
       as the dungeon alcove pools above. */
    const seeds = [];
    for(let y=4;y<H-4;y++) for(let x=4;x<W-4;x++){
      const c = idx(x,y);
      if(canFlood(c)) seeds.push(c);
    }
    for(let i=seeds.length-1;i>0;i--){ const j=rng.i(0,i); const t=seeds[i]; seeds[i]=seeds[j]; seeds[j]=t; }

    /* ── crossings ────────────────────────────────────────────────────
       Span a body with a two-tile-wide walkway at its narrowest axis. Only
       bodies wide enough to be a genuine obstacle get one; a puddle you can
       step round does not need a bridge. */
    const BRIDGE_KIND = { wood: { deck:'woodBridge', rail:'woodRailing' } };
    const bridgeKit = BRIDGE_KIND[OC.liquid.bridge];
    /* Only a mere big enough to be a real detour earns a crossing, and a
       handful per map — bridging every pond turned the mire into a boardwalk.
       MAX_CROSSINGS is per map, not per body. */
    const MIN_BRIDGE_BODY = 30, MIN_SPAN = 4, MAX_CROSSINGS = 3;
    let crossings = 0, placedDividers = 0;
    const crossingOver = (body, axis, minBody) => {
      const out = new Set();
      if(!bridgeKit || crossings >= MAX_CROSSINGS) return out;
      if(body.length < (minBody === undefined ? MIN_BRIDGE_BODY : minBody)) return out;
      let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
      for(const c of body){ const x=c%W, y=(c-x)/W;
        if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
      /* Walk across the SHORT axis — the shortest way over the water. */
      const spanX = x1-x0+1, spanY = y1-y0+1;
      /* `axis` is the direction of TRAVEL: 'x' means you walk along x, so the
         deck is a band of constant y. Zone dividers pass the road's direction;
         free-standing ponds fall back to their own short axis. */
      const horiz = axis ? axis === 'x' : spanX <= spanY;
      if((horiz ? spanX : spanY) < MIN_SPAN) return out;
      const mid = horiz ? Math.round((y0+y1)/2) : Math.round((x0+x1)/2);
      const lanes = [mid, mid+1];
      for(const c of body){
        const x=c%W, y=(c-x)/W;
        if(lanes.includes(horiz ? y : x)) out.add(c);
      }
      /* A one-cell stub is not a crossing. */
      return out.size >= MIN_SPAN ? out : new Set();
    };
    const addCrossingProps = (deck) => {
      const rot = 0;
      for(const c of deck){
        const x=c%W, y=(c-x)/W;
        props.push({ kind: bridgeKit.deck, x, y, rot, scale:1, roomId: roomId[c] });
        /* Rail only the outer edges of the walkway, never through it. */
        for(const [sx,sy] of [[0,-1],[0,1],[-1,0],[1,0]]){
          const nc = idx(x+sx, y+sy);
          if(deck.has(nc)) continue;
          /* ends of the span are where you step on — leave those open */
          if(grid[nc] === FLOOR && !deck.has(nc)) continue;
          props.push({ kind: bridgeKit.rail, x, y,
                       ox: sx*0.46, oz: sy*0.46,
                       rot: sx ? Math.PI/2 : 0, scale:1, roomId: roomId[c] });
        }
      }
    };

    /* ── zone dividers ────────────────────────────────────────────────
       An overland map is a chain of clearings strung along one road, so the
       natural place for water is BETWEEN two of them: a mere across the road,
       bridged where the road meets it. That turns a crossing into a gateway
       from one part of the journey to the next.
       Scattered ponds cannot do this, because canFlood keeps every body clear
       of the road — so their bridges always spanned water you could simply walk
       around, which is what made them look arbitrary. This pass deliberately
       floods the road band and hands the road back as planking. */
    if(bridgeKit && rooms.length >= 3){
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
        for(const zr of rooms){
          const zd = (x - zr.cx) * (x - zr.cx) + (y - zr.cy) * (y - zr.cy);
          if (zd < zr.rad * zr.rad) return false;
        }
        if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) return false;
        if ((x - camp.cx) * (x - camp.cx) + (y - camp.cy) * (y - camp.cy) < campKeep) return false;
        return true;
      };
      const roadCellNear = (mx, my) => {
        let best = -1, bd = 1e9;
        for(let y = 4; y < H - 4; y++) for(let x = 4; x < W - 4; x++){
          const c = idx(x, y);
          if(!corridor[c] || grid[c] !== FLOOR) continue;
          const dd = (x - mx) * (x - mx) + (y - my) * (y - my);
          if(dd < bd){ bd = dd; best = c; }
        }
        return best;
      };
      /* Space the dividers out along the journey rather than bunching them. */
      const gaps = [];
      for(let i = 0; i < rooms.length - 1; i++) gaps.push(i);
      for(let i = gaps.length - 1; i > 0; i--){ const j = rng.i(0,i); const t=gaps[i]; gaps[i]=gaps[j]; gaps[j]=t; }

      /* Travel follows the road: whichever axis separates the two zones. */
      const DIVIDER_MIN_BODY = 18;
      /* Cutting a deck through a mere splits it in two, and either half can
         come out as a lone tile — or pinch off a scrap of bank. The incremental
         check the scattered ponds use does not see this, so a divider is
         simulated in full and verified against two rules before it commits:
         no liquid fragment smaller than a puddle, and nothing that was
         reachable before becomes unreachable after. */
      const MIN_FRAGMENT = 4;
      const dividerOk = (wet) => {
        const wetSet = new Set(wet), seenW = new Set();
        for(const c0 of wet){
          if(seenW.has(c0)) continue;
          const st = [c0]; seenW.add(c0);
          let n = 0;
          while(st.length){
            const c = st.pop(); n++;
            for(const k of nb4(c))
              if(wetSet.has(k) && !seenW.has(k)){ seenW.add(k); st.push(k); }
          }
          if(n < MIN_FRAGMENT) return false;
        }
        const before = flood4(grid);
        const scratch = grid.slice();
        for(const c of wet) scratch[c] = POOL;
        const after = flood4(scratch);
        for(let c = 0; c < W * H; c++){
          if(!before[c] || scratch[c] === POOL) continue;
          if(!after[c]) return false;
        }
        return true;
      };
      for(const gi of gaps){
        if(crossings >= MAX_CROSSINGS) break;
        const A = rooms[gi], B = rooms[gi+1];
        const axis = Math.abs(B.cx - A.cx) >= Math.abs(B.cy - A.cy) ? 'x' : 'y';
        /* Sample several points along the gap, not just the midpoint: the road
           wanders, and the exact centre often lands inside a clearing (where
           water is not wanted) or on ground too pinched to grow a mere. */
        for(const f of [0.5, 0.38, 0.62, 0.44, 0.56]){
          if(crossings >= MAX_CROSSINGS) break;
          const mx = Math.round(A.cx + (B.cx - A.cx) * f);
          const my = Math.round(A.cy + (B.cy - A.cy) * f);
          const seedC = roadCellNear(mx, my);
          if(seedC < 0 || !canFloodRoad(seedC)) continue;

          const body = growLiquidBody(W, H, seedC, rng.i(30, 60), canFloodRoad, rng);
          if(body.length < DIVIDER_MIN_BODY) continue;
          const deck = crossingOver(body, axis, DIVIDER_MIN_BODY);
          if(!deck.size) continue;

          const wet = body.filter(c => !deck.has(c));
          if(!wet.length || !dividerOk(wet)) continue;

          for(const bc of wet){
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
    for(const seed of seeds){
      if(placed >= targetCells) break;
      if(!canFlood(seed)) continue;                 // an earlier body may have taken it
      const sx = seed % W, sy = (seed - sx) / W;
      /* keep bodies apart so the map reads as distinct pools, not one swamp */
      let close=false;
      for(const p of pools) if(Math.max(Math.abs(p.x-sx),Math.abs(p.y-sy)) < 4){ close=true; break; }
      if(close) continue;

      const body = growLiquidBody(W, H, seed, rng.i(lqMin, lqMax), canFlood, rng);
      if(body.length < lqMin) continue;                     // too cramped to bother
      if(!floorStaysConnected(grid, W, H, body, refCellL, reachMask)) continue;

      /* A broad mere is a wall unless you can get over it. Pick a crossing
         BEFORE flooding, so the deck cells simply never become POOL — much
         safer than carving them back out afterwards, which would leave them in
         the `pools` array and draw water over the planking. */
      /* Scattered ponds sit OFF the road by construction, so a bridge over one
         spans water you could simply walk around — which is exactly what made
         the first pass look arbitrary. Only the zone dividers above get decks;
         these are just water. */
      const deck = new Set();
      for(const bc of body){
        if(deck.has(bc)) continue;                          // stays walkable
        grid[bc] = POOL;
        reachMask[bc] = 0;
        pools.push({ x: bc % W, y: (bc - (bc % W)) / W });
      }
      if(deck.size){ addCrossingProps(deck); crossings++; }
      placed += body.length;
    }

  }

  const bfs = new Int16Array(total).fill(-1);
  const ei = idx(rooms[entrance].cx, rooms[entrance].cy);
  let floorTotal=0; for(let i=0;i<total;i++) if(grid[i]===FLOOR) floorTotal++;
  let reach=0, maxBfs=0;
  if(grid[ei]===FLOOR){
    const q=new Int32Array(floorTotal); let qh=0, qt=0;
    q[qt++]=ei; bfs[ei]=0; reach=1;
    while(qh<qt){
      const c=q[qh++], x=c%W, b=bfs[c]+1; let n;
      if(x>0       && grid[n=c-1]===FLOOR && bfs[n]<0){ bfs[n]=b; q[qt++]=n; reach++; }
      if(x<W-1     && grid[n=c+1]===FLOOR && bfs[n]<0){ bfs[n]=b; q[qt++]=n; reach++; }
      if(c>=W      && grid[n=c-W]===FLOOR && bfs[n]<0){ bfs[n]=b; q[qt++]=n; reach++; }
      if(c<total-W && grid[n=c+W]===FLOOR && bfs[n]<0){ bfs[n]=b; q[qt++]=n; reach++; }
    }
    maxBfs = bfs[q[qt-1]];
  }

  props.push({kind:'ring', x:rooms[entrance].cx, y:rooms[entrance].cy, rot:0, scale:1, roomId:entrance});
  props.push({kind:'bossCrystal', x:camp.cx, y:camp.cy, rot:0, scale:1.4, roomId:boss});
  /* Map-wide, not per-zone: neighbouring clearings are allowed to overlap, and
     two zones drawing into the shared ground would otherwise stack monsters on
     the same tile. */
  const spawnTaken = new Set();
  for(const r of rooms){
    if(r.type===TYPE.TREASURE) props.push({kind:'chest', x:r.cx, y:r.cy, rot:rng.f(0,6.28), scale:1, roomId:r.id});
    if(r.type===TYPE.SHRINE) props.push({kind:'shrineCrystal', x:r.cx, y:r.cy, rot:rng.f(0,6.28), scale:1, roomId:r.id});
    if(r.type===TYPE.RIVAL){
      props.push({kind:'shrineCrystal', x:r.cx, y:r.cy, rot:0, scale:1, roomId:r.id});
      props.push({kind:'weaponRack', x:r.cx - 2, y:r.cy, rot:0, scale:1, roomId:r.id});
      props.push({kind:'crate', x:r.cx + 2, y:r.cy - 1, rot:0.4, scale:1, roomId:r.id});
      props.push({kind:'barrel', x:r.cx + 2, y:r.cy + 1, rot:0, scale:1, roomId:r.id});
      props.push({kind:'bench', x:r.cx, y:r.cy - 1.8, rot:0, scale:1, roomId:r.id});
    }
    if(r.type===TYPE.COMBAT || r.type===TYPE.ELITE || r.type===TYPE.BOSS){
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
      for(const ovCR of ovCRs){
        /* sqrt keeps the draw area-uniform, so they fill the clearing instead
           of bunching around the middle */
        for(let attempt=0; attempt<24; attempt++){
          const a=rng.f(0,6.28), dist=1 + Math.sqrt(rng.raw())*(r.rad*0.82 - 1);
          const sx=Math.round(r.cx+Math.cos(a)*dist), sy=Math.round(r.cy+Math.sin(a)*dist);
          if(!inB(sx,sy)) continue;
          const sc = idx(sx,sy);
          if(grid[sc]!==FLOOR || spawnTaken.has(sc)) continue;
          spawnTaken.add(sc);
          spawns.push({x:sx, y:sy, targetCR: ovCR, roomId:r.id});
          break;
        }
      }
    }
  }
  /* Every ground-prop kind an overland theme may name in `oc.ground`. A kind is
     only placed if the active theme gives it a density, so this list is a
     superset — but a kind missing from it can never be scattered, which is why
     the threshold-overland props (tombstone, pillars, icebone, caps…) are here. */
  const scatterKinds = ['mushroomLog','rocks','stump','vinemound','cairn','stakes','rack','goblinfire','skulltotem','bush','signpost','brokenSignpost','wheel',
    'tombstone','pillarA','pillarB','vase','icebone','anvil','coffin',
    'mushroomA','mushroomB','rootsA','rootsB','fren1','fren2','fren3','fren4','moss'];
  /* Clearings are big enough to fight across, so they need enough ground cover
     to break up the sightlines. `scatterGain` lifts every theme's ground
     densities together, keeping each theme's own prop MIX intact — tune this
     one number rather than editing nine density tables. */
  const gain = (OC.scatterGain ?? 2.0) * density;
  for(let y=2;y<H-2;y+=3) for(let x=2;x<W-2;x+=3){
    const c=idx(x,y);
    if(grid[c]!==FLOOR || corridor[c]) continue;
    if(hn(x,y,4)<OC.ground.debris*gain*dmul('debris')){
      props.push({kind:'debris', x, y, rot:rng.f(0,6.28), scale:rng.f(0.7,1.3), roomId:roomId[c], v:rng.i(0,2)});
      continue;
    }
    for(let si=0; si<scatterKinds.length; si++){
      const k = scatterKinds[si], dens = OC.ground[k];
      if(!dens) continue;
      const km = k === 'moss' ? dmul('moss') : (k === 'icebone' ? dmul('bones') : 1);
      if(hn(x,y,6+si) < dens*gain*km){
        props.push({kind:k, x, y, rot:rng.i(0,3)*(Math.PI/2), scale:rng.f(0.85,1.2), roomId:roomId[c]});
        break;
      }
    }
  }

  /* Winter sweep: ice shards in clusters on open ground, icicles hanging off the
     blockers that edge it. Mirrors the dungeon version so one slider drives both,
     but icicles ride lower here — overland blockers are trees about a third the
     height of a dungeon wall, so the dungeon's fixed 1.9 would float them above
     the canopy. */
  if(TH.icicles || DEC.icicles){
    const im = dmul('icicles');
    for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++){
      const c = idx(x,y);
      if(grid[c]===WALL){
        const d = grid[c+1]===FLOOR ? [1,0] : grid[c-1]===FLOOR ? [-1,0]
                : grid[c+W]===FLOOR ? [0,1] : grid[c-W]===FLOOR ? [0,-1] : null;
        if(d && rng.chance(0.05*density*im))
          props.push({kind:'icicle', x, y, dx:d[0], dy:d[1], oy:-0.55,
                      rot:rng.f(0,6.28), scale:rng.f(0.6,1.1)});
        continue;
      }
      if(grid[c]!==FLOOR || doorway[c]) continue;
      /* Thinner on the road itself so the trail stays readable. */
      if(!rng.chance((corridor[c] ? 0.012 : 0.03)*density*im)) continue;
      const rv = rng.raw();
      const n = rv < 0.5 ? 1 : (rv < 0.82 ? 2 : 3);
      for(let s=0; s<n; s++){
        const lead = s === 0;
        props.push({kind:'shardIce', x, y,
                    ox: lead ? rng.f(-0.14, 0.14) : rng.f(-0.34, 0.34),
                    oz: lead ? rng.f(-0.14, 0.14) : rng.f(-0.34, 0.34),
                    rot: rng.f(0, 6.28),
                    scale: lead ? rng.f(0.55, 1.65) : rng.f(0.3, 0.9),
                    roomId: roomId[c]});
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
  if(flood4 && preLiquidReach){
    const now = flood4(grid);
    for(let c = 0; c < total; c++){
      if(grid[c] !== FLOOR || now[c]) continue;
      /* Reclaim ground the water orphaned, and any floor carved out later that
         was born unreachable. A cell that was already floor AND already
         unreachable before any liquid (a pocket inside a copse) is left dry —
         the water did not cause it. */
      if(preLiquidFloor[c] && !preLiquidReach[c]) continue;
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
      if(wetNb){
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
  else if (tKey === 'boneyard') baseGrassChance = 0.55;
  else if (tKey === 'sporewood') baseGrassChance = 0.40;

  if (baseGrassChance > 0) {
    const grassKinds = ['swampgrass', 'swampgrass2', 'swampgrass3'];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const c = idx(x, y);
        if (grid[c] !== FLOOR || doorway[c]) continue;

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

  return {
    valid: reach===floorTotal && floorTotal>0, overland: true, palisadeMask,
    params, seed, name: dungeonName(rng, TH), themeKey: params.themeKey,
    W, H, grid, roomId, corridor, doorway, bfs, maxBfs,
    rooms, edges, entrance, boss, maxDepth: rooms.maxDepth||4,
    props, spawns, torches:[], pools, lakeCells, lakeMask, arches,
    stats: { rooms:N, edges:edges.length, loops:edges.filter(e=>e.isLoop).length, critLen:0, floorTiles:floorTotal, reach, genMs:performance.now()-t0, attempts:1 }
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

