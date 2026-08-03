/**
 * Import missing SRD monsters into the game.
 * Fetches stats from 5e API, maps to DCSS sprites, assigns themes.
 * Usage: node tools/import_missing.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME_PATH = path.join(ROOT, 'src/game/monsters.json');
const SPRITE_DIR = path.join(ROOT, 'public/dcss/monster');
const CACHE_DIR = path.join(ROOT, 'tools/.api_cache');
const API = 'https://www.dnd5eapi.co/api/2014/monsters/';
const DRY_RUN = process.argv.includes('--dry-run');

/* ============ MISSING SRD MONSTERS TO IMPORT ============ */
/* Each entry: { index: 'api-index', theme, sprite, tags?, boss? } */
/* Organized by theme for clean routing */

const TO_IMPORT = [
  // ===== DRACONIC (dragons) =====
  { index: 'adult-blue-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-purple.png' },
  { index: 'adult-green-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-green.png' },
  { index: 'adult-black-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-black.png' },
  { index: 'adult-silver-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-white.png' },
  { index: 'adult-brass-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-mottle.png' },
  { index: 'adult-bronze-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-purple.png' },
  { index: 'adult-copper-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-red.png' },
  { index: 'ancient-red-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-red.png', boss: true },
  { index: 'ancient-black-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-black.png', boss: true },
  { index: 'ancient-blue-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-purple.png', boss: true },
  { index: 'ancient-green-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-green.png', boss: true },
  { index: 'ancient-white-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-white.png', boss: true },
  { index: 'ancient-silver-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-white.png', boss: true },
  { index: 'ancient-brass-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-mottle.png', boss: true },
  { index: 'ancient-bronze-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-purple.png', boss: true },
  { index: 'ancient-copper-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-red.png', boss: true },
  { index: 'young-brass-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-mottle.png' },
  { index: 'young-bronze-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-purple.png' },
  { index: 'young-copper-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-red.png' },
  { index: 'young-gold-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-yellow.png' },
  { index: 'young-silver-dragon', theme: 'Draconic', sprite: 'draconic/draconic_base-white.png' },
  { index: 'brass-dragon-wyrmling', theme: 'Draconic', sprite: 'draconic/draconic_base-mottle.png' },
  { index: 'bronze-dragon-wyrmling', theme: 'Draconic', sprite: 'draconic/draconic_base-purple.png' },
  { index: 'copper-dragon-wyrmling', theme: 'Draconic', sprite: 'draconic/draconic_base-red.png' },
  { index: 'gold-dragon-wyrmling', theme: 'Draconic', sprite: 'draconic/draconic_base-yellow.png' },
  { index: 'silver-dragon-wyrmling', theme: 'Draconic', sprite: 'draconic/draconic_base-white.png' },
  { index: 'dragon-turtle', theme: 'Draconic', sprite: 'animals/alligator_snapping_turtle.png', boss: true },

  // ===== FIENDISH (devils & demons) =====
  { index: 'bone-devil', theme: 'Fiendish', sprite: 'demons/blue_devil.png' },
  { index: 'chain-devil', theme: 'Fiendish', sprite: 'demons/hellion.png' },
  { index: 'erinyes', theme: 'Fiendish', sprite: 'demons/hell_sentinel.png' },
  { index: 'succubus-incubus', theme: 'Fiendish', sprite: 'demons/ynoxinul.png' },
  { index: 'marilith', theme: 'Fiendish', sprite: 'demons/balrug.png', boss: true },
  { index: 'nalfeshnee', theme: 'Fiendish', sprite: 'demons/cacodemon.png' },

  // ===== LYCANTHROPES =====
  { index: 'werebear-hybrid', theme: 'Beasts', sprite: 'animals/bear.png', tags: ['lycanthrope'] },
  { index: 'wereboar-hybrid', theme: 'Beasts', sprite: 'animals/hog.png', tags: ['lycanthrope'] },
  { index: 'wererat-hybrid', theme: 'Beasts', sprite: 'animals/rat.png', tags: ['lycanthrope'] },
  { index: 'weretiger-hybrid', theme: 'Beasts', sprite: 'animals/jumping_spider.png', tags: ['lycanthrope'] },

  // ===== GOLEMS =====
  { index: 'clay-golem', theme: 'Elemental', sprite: 'nonliving/clay_golem.png' },
  { index: 'stone-golem', theme: 'Elemental', sprite: 'nonliving/stone_golem.png' },

  // ===== GIANTS =====
  { index: 'storm-giant', theme: 'Giantkind', sprite: 'cyclops.png', boss: true },

  // ===== ELEMENTALS =====
  { index: 'djinni', theme: 'Elemental', sprite: 'nonliving/air_elemental.png' },
  { index: 'invisible-stalker', theme: 'Elemental', sprite: 'nonliving/insubstantial_wisp.png' },
  { index: 'dust-mephit', theme: 'Elemental', sprite: 'nonliving/vapour.png' },
  { index: 'ice-mephit', theme: 'Elemental', sprite: 'holy/daeva.png' },
  { index: 'magma-mephit', theme: 'Elemental', sprite: 'nonliving/scorch.png' },
  { index: 'steam-mephit', theme: 'Elemental', sprite: 'nonliving/insubstantial_wisp.png' },
  { index: 'azer', theme: 'Elemental', sprite: 'demons/red_devil.png' },
  { index: 'xorn', theme: 'Elemental', sprite: 'animals/boulder_beetle.png' },

  // ===== MONSTROSITIES =====
  { index: 'lamia', theme: 'Fiendish', sprite: 'demons/beast.png', tags: ['monstrosity'] },
  { index: 'gorgon', theme: 'Beasts', sprite: 'animals/catoblepas.png' },
  { index: 'roc', theme: 'Beasts', sprite: 'animals/moth_of_wrath.png', boss: true },
  { index: 'winter-wolf', theme: 'Beasts', sprite: 'animals/warg.png' },
  { index: 'oni', theme: 'Giantkind', sprite: 'demons/hellion.png' },

  // ===== PLANTS =====
  { index: 'shambling-mound', theme: 'Fey', sprite: 'fungi_plants/plant.png' },
  { index: 'awakened-tree', theme: 'Fey', sprite: 'fungi_plants/treant.png' },
  { index: 'violet-fungus', theme: 'Fey', sprite: 'fungi_plants/wandering_mushroom.png' },

  // ===== ABERRATIONS =====
  { index: 'aboleth', theme: 'Drow & Shadow', sprite: 'abyss/lurking_horror.png', boss: true },
  { index: 'drider', theme: 'Drow & Shadow', sprite: 'animals/jumping_spider.png' },

  // ===== CELESTIALS & FEY =====
  { index: 'couatl', theme: 'Fey', sprite: 'animals/sea_snake.png' },
  { index: 'pegasus', theme: 'Fey', sprite: 'holy/shedu.png' },
  { index: 'unicorn', theme: 'Fey', sprite: 'animals/holy_swine.png' },
  { index: 'solar', theme: 'Fey', sprite: 'holy/angel.png', boss: true },
  { index: 'planetar', theme: 'Fey', sprite: 'holy/daeva.png' },
  { index: 'night-hag', theme: 'Fey', sprite: 'demons/beast.png', tags: ['hag'] },
  { index: 'sprite', theme: 'Fey', sprite: 'holy/cherub.png' },

  // ===== UNDEAD =====
  { index: 'minotaur-skeleton', theme: 'Undead', sprite: 'undead/skeletons/skeleton_humanoid_large.png' },
  { index: 'warhorse-skeleton', theme: 'Undead', sprite: 'undead/skeletons/skeleton_quadruped_large.png' },

  // ===== BEASTS =====
  { index: 'giant-ape', theme: 'Beasts', sprite: 'demons/beast.png' },
  { index: 'giant-crocodile', theme: 'Beasts', sprite: 'animals/alligator.png' },
  { index: 'giant-shark', theme: 'Beasts', sprite: 'aquatic/shark.png' },
  { index: 'hunter-shark', theme: 'Beasts', sprite: 'aquatic/shark.png' },
  { index: 'mammoth', theme: 'Beasts', sprite: 'animals/elephant_dire.png' },
  { index: 'saber-toothed-tiger', theme: 'Beasts', sprite: 'animals/warg.png' },
  { index: 'triceratops', theme: 'Beasts', sprite: 'animals/elephant_slug.png' },
  { index: 'tyrannosaurus-rex', theme: 'Beasts', sprite: 'demons/abomination_large.png', boss: true },
  { index: 'plesiosaurus', theme: 'Beasts', sprite: 'animals/snapping_turtle.png' },
  { index: 'giant-elk', theme: 'Beasts', sprite: 'animals/yak.png' },
  { index: 'giant-eagle', theme: 'Beasts', sprite: 'animals/caustic_shrike.png' },
  { index: 'giant-vulture', theme: 'Beasts', sprite: 'animals/caustic_shrike.png' },
  { index: 'giant-boar', theme: 'Beasts', sprite: 'animals/hell_hog.png' },
  { index: 'giant-lizard', theme: 'Beasts', sprite: 'animals/gila_monster.png' },
  { index: 'giant-goat', theme: 'Beasts', sprite: 'animals/sheep.png' },
  { index: 'giant-hyena', theme: 'Beasts', sprite: 'animals/warg.png' },
  { index: 'giant-octopus', theme: 'Beasts', sprite: 'amorphous/jelly.png' },

  // ===== SWARMS =====
  { index: 'swarm-of-beetles', theme: 'Vermin', sprite: 'animals/boring_beetle.png', tags: ['swarm'] },
  { index: 'swarm-of-poisonous-snakes', theme: 'Vermin', sprite: 'animals/adder.png', tags: ['swarm'] },
  { index: 'swarm-of-ravens', theme: 'Vermin', sprite: 'animals/caustic_shrike.png', tags: ['swarm'] },
  { index: 'swarm-of-spiders', theme: 'Vermin', sprite: 'animals/spider.png', tags: ['swarm'] },
  { index: 'swarm-of-wasps', theme: 'Vermin', sprite: 'animals/killer_bee.png', tags: ['swarm'] },

  // ===== CONSTRUCTS =====
  { index: 'animated-armor', theme: 'Elemental', sprite: 'nonliving/ushabti.png' },
  { index: 'flying-sword', theme: 'Elemental', sprite: 'nonliving/spectral_sbl.png' },
  { index: 'rug-of-smothering', theme: 'Elemental', sprite: 'amorphous/ooze.png' },
  { index: 'shield-guardian', theme: 'Elemental', sprite: 'nonliving/guardian_golem.png', boss: true },

  // ===== OTHER =====
  { index: 'gynosphinx', theme: 'Fey', sprite: 'animals/jumping_spider.png' },
  { index: 'androsphinx', theme: 'Fey', sprite: 'animals/jumping_spider.png', boss: true },
  { index: 'homunculus', theme: 'Drow & Shadow', sprite: 'demons/abomination_small.png' },
  { index: 'shrieker', theme: 'Fey', sprite: 'fungi_plants/wandering_mushroom.png' },
  { index: 'lizardfolk', theme: 'Beasts', sprite: 'animals/iguana.png', tags: ['humanoid'] },
  { index: 'sahuagin', theme: 'Beasts', sprite: 'animals/iguana.png', tags: ['humanoid'] },
  { index: 'merrow', theme: 'Beasts', sprite: 'animals/big_fish.png' },
  { index: 'grimlock', theme: 'Drow & Shadow', sprite: 'demons/abomination_small.png' },
  { index: 'sea-hag', theme: 'Fey', sprite: 'demons/beast.png', tags: ['hag'] },
];

/* ============ HELPERS ============ */
const SCALE = { tiny: 0.55, small: 0.7, medium: 0.95, large: 1.5, huge: 2.1, gargantuan: 2.6 };
const DMG_TYPES = ['acid','cold','fire','force','lightning','necrotic','poison','psychic','radiant','thunder','bludgeoning','piercing','slashing'];
const THEME_COLOR = {
  'Draconic': 0xb05a3a, 'Fiendish': 0xb04040, 'Beasts': 0x8a8a6a,
  'Elemental': 0x6a8aaa, 'Giantkind': 0x8a6a4a, 'Fey': 0x4cae7a,
  'Drow & Shadow': 0x6a4a8a, 'Undead': 0x8aa0a8, 'Vermin': 0x8a7a4a,
  'Orc Horde': 0x5a7a3a, 'Goblinoid': 0x7a8a4a,
};

function parseDice(str) {
  const m = /(\d+)d(\d+)(?:\s*[+-]\s*(\d+))?/.exec(str || '');
  if (!m) return null;
  return m[3] ? [+m[1], +m[2], +m[3]] : [+m[1], +m[2], 0];
}

function extractResist(arr) {
  const out = [];
  for (const s of (arr || [])) {
    const low = (typeof s === 'string' ? s : s.name || '').toLowerCase();
    if (low.includes('nonmagical')) { out.push('bludgeoning, piercing, and slashing from nonmagical weapons'); continue; }
    for (const t of DMG_TYPES) { if (low.includes(t)) out.push(t); }
  }
  return [...new Set(out)];
}

function primaryAttack(actions) {
  for (const a of (actions || [])) {
    const hit = /([+-]?\d+)\s+to hit/.exec(a.desc || '');
    const dmg = /Hit:\s*\d+\s*\(([^)]+)\)\s*(\w+)/.exec(a.desc || '');
    if (hit && dmg) {
      const dice = parseDice(dmg[1]);
      const ranged = /Ranged Weapon Attack/i.test(a.desc) && !/Melee/i.test(a.desc);
      const rng = /range\s+(\d+)/.exec(a.desc || '');
      return { atk: +hit[1], dmg: dice || [1, 6, 0], ranged, rngRange: rng ? Math.max(4, Math.round(+rng[1] / 12)) : 6 };
    }
  }
  return { atk: 3, dmg: [1, 6, 0], ranged: false, rngRange: 5 };
}

function parseMultiattack(actions) {
  if (!actions) return 1;
  const ma = actions.find(a => /multiattack/i.test(a.name || ''));
  if (!ma) return 1;
  const desc = ma.desc || '';
  const word = { two: 2, three: 3, four: 4, five: 5, six: 6 };
  const m1 = /makes\s+(two|three|four|five|six|2|3|4|5|6)\s+attacks/i.exec(desc);
  if (m1) return word[m1[1].toLowerCase()] || (+m1[1]) || 2;
  if (/makes\s+one\s+.*(?:and|or)\s+one/i.test(desc)) return 2;
  return 2;
}

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else if (e.name.endsWith('.png')) out.push(rel);
  }
  return out;
}

function findBestSprite(wanted) {
  const sprites = walk(SPRITE_DIR);
  if (sprites.includes(wanted)) return wanted;
  // Try without _new/_old suffix or directory
  const base = wanted.replace(/_new|_old/g, '');
  for (const s of sprites) {
    if (s.replace(/_new|_old/g, '') === base) return s;
  }
  // Try matching just the filename
  const name = path.basename(wanted);
  for (const s of sprites) {
    if (path.basename(s) === name) return s;
  }
  // Try partial match
  for (const s of sprites) {
    if (s.includes(name.replace('.png', ''))) return s;
  }
  return wanted; // Return as-is, will be reported if missing
}

/* ============ FETCH ============ */
async function fetchApi(index) {
  const f = path.join(CACHE_DIR, index + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  try {
    const r = await fetch(API + index);
    if (!r.ok) throw new Error(index + ' -> ' + r.status);
    const j = await r.json();
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(j));
    return j;
  } catch (e) {
    return null;
  }
}

function convertApi(raw, { sprite, theme, boss, tags }) {
  const size = (raw.size || 'Medium').toLowerCase();
  const cr = raw.challenge_rating;
  const ac = Array.isArray(raw.armor_class) ? raw.armor_class[0].value : raw.armor_class;
  const hp = parseDice(raw.hit_points_roll || raw.hit_dice) || [Math.max(1, Math.round(raw.hit_points / 5)), 8, 0];
  const pa = primaryAttack(raw.actions);

  const saves = {}, skills = {};
  for (const p of (raw.proficiencies || [])) {
    const n = p.proficiency?.name || '';
    let mm;
    if ((mm = /Saving Throw:\s*(\w+)/.exec(n))) saves[mm[1].toLowerCase()] = p.value;
    else if ((mm = /Skill:\s*([\w ]+)/.exec(n))) skills[mm[1].trim().toLowerCase()] = p.value;
  }

  const senses = {};
  if (raw.senses) {
    for (const k in raw.senses) {
      const v = raw.senses[k];
      const num = /(\d+)/.exec(String(v));
      senses[k.replace(/_(\w)/g, (_, c) => c.toUpperCase())] = num ? +num[1] : v;
    }
  }

  const multi = parseMultiattack(raw.actions);

  return {
    id: raw.index,
    name: raw.name,
    cr,
    ac,
    hp,
    atk: pa.atk,
    dmg: pa.dmg,
    xp: raw.xp || Math.round(cr * 200) || 25,
    color: THEME_COLOR[theme] || 0x999999,
    scale: SCALE[size] || 0.95,
    speed: (() => { const w = /(\d+)/.exec(raw.speed?.walk || '30'); return w ? Math.max(1.8, +w[1] / 10) : 3; })(),
    sprite,
    type: (raw.type || '').toLowerCase(),
    size,
    tags: tags || [],
    threat: Math.max(8, Math.round(10 + cr * 8)),
    ...(boss ? { isBoss: true } : {}),
    ...(pa.ranged ? { ranged: true, rngRange: pa.rngRange } : {}),
    effStats: { str: raw.strength || 10, dex: raw.dexterity || 10, con: raw.constitution || 10, int: raw.intelligence || 10, wis: raw.wisdom || 10, cha: raw.charisma || 10 },
    saves,
    ...(multi > 1 ? { attacksPerTurn: multi } : {}),
    statblock: {
      source: 'srd',
      prof: raw.proficiency_bonus || (2 + Math.floor(Math.max(0, cr - 1) / 4)),
      skills,
      senses,
      resist: extractResist(raw.damage_resistances),
      immune: extractResist(raw.damage_immunities),
      vulnerable: extractResist(raw.damage_vulnerabilities),
      condImmune: (raw.condition_immunities || []).map(c => (c.name || c.index || '').toLowerCase()).filter(Boolean),
      languages: raw.languages || '',
      traits: (raw.special_abilities || []).map(t => ({ name: t.name, desc: t.desc })),
      actions: (raw.actions || []).map(a => ({ name: a.name, desc: a.desc })),
    },
  };
}

/* ============ MAIN ============ */
async function main() {
  console.log('=== Import Missing SRD Monsters ===\n');
  console.log('Monsters to import: ' + TO_IMPORT.length);
  if (DRY_RUN) console.log('[DRY RUN]\n');

  const game = JSON.parse(fs.readFileSync(GAME_PATH, 'utf8'));
  const existing = new Set(game.map(m => m.id));

  // Check sprite availability
  const allSprites = walk(SPRITE_DIR);
  const spriteSet = new Set(allSprites);

  const added = [];
  const skipped = [];
  const problems = [];

  for (const spec of TO_IMPORT) {
    if (existing.has(spec.index)) {
      skipped.push(spec.index + ' (already exists)');
      continue;
    }

    const sprite = findBestSprite(spec.sprite);
    if (!spriteSet.has(sprite)) {
      problems.push(spec.index + ': NO SPRITE ' + spec.sprite);
      continue;
    }

    try {
      const raw = await fetchApi(spec.index);
      if (!raw) {
        problems.push(spec.index + ': API fetch failed');
        continue;
      }

      const m = convertApi(raw, { sprite, theme: spec.theme, boss: spec.boss, tags: spec.tags });
      added.push(m);
      existing.add(m.id);
      console.log('  + ' + m.id.padEnd(30) + ' CR ' + m.cr + ' [' + spec.theme + ']');
    } catch (e) {
      problems.push(spec.index + ': ' + e.message);
    }
  }

  console.log('\n=== Results ===');
  console.log('Added: ' + added.length);
  if (skipped.length) console.log('Skipped (already exist): ' + skipped.length);
  if (problems.length) {
    console.log('Problems: ' + problems.length);
    problems.forEach(p => console.log('  ! ' + p));
  }

  if (!DRY_RUN && added.length > 0) {
    // Backup
    fs.writeFileSync(GAME_PATH.replace('.json', '.pre_import.json'), JSON.stringify(game, null, 1));
    const out = game.concat(added);
    fs.writeFileSync(GAME_PATH, JSON.stringify(out, null, 1));
    console.log('\nWritten ' + out.length + ' total monsters.');
  } else if (DRY_RUN) {
    console.log('\n[DRY RUN - no changes written]');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
