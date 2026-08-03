/**
 * CR Audit & Fix v3 - Conservative approach
 * - SRD monsters: force-overwrite ALL stats from official 5e API
 * - Custom variants: change source srd→synth, leave stats alone
 * - No consistency/ATK fixes for synth (they use pre-scaled stats)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME_PATH = path.join(ROOT, 'src/game/monsters.json');
const CACHE_DIR = path.join(ROOT, 'tools/.api_cache');
const DRY_RUN = process.argv.includes('--dry-run');

/* True equivalences (same creature, different key) */
const API_ALIASES = {
  'deep-gnome': 'deep-gnome-svirfneblin', 'warg': 'worg',
  'werewolf': 'werewolf-hybrid', 'vampire': 'vampire-vampire',
  'grizzly-bear': 'brown-bear', 'lindwurm': 'wyvern',
  'wizard': 'mage', 'necromancer': 'mage',
  'orc-high-priest': 'priest', 'orc-warlord': 'orc-war-chief',
  'deep-dwarf-berserker': 'duergar', 'deep-dwarf-death-knight': 'duergar', 'deep-dwarf-artificer': 'duergar',
  'gnoll-sergeant': 'gnoll-pack-lord', 'death-knight': 'death-knight',
  'cyclops': 'cyclops', 'hobgoblin-captain': 'hobgoblin-captain',
  'hobgoblin-warlord': 'hobgoblin-warlord',
};

/* Monsters that are deliberate custom variants, NOT true SRD creatures */
const CUSTOM_VARIANTS = new Set([
  'grey-rat', 'adder', 'orc-warrior', 'orc-priest', 'orc-knight',
  'big-kobold', 'wolf-spider', 'alligator', 'anaconda',
  'boss-troll', 'deep-troll', 'deep-troll-berserker', 'deep-troll-earth-mage', 'deep-troll-shaman',
  'iron-troll', 'rock-troll',
  'merfolk-fighter', 'merfolk-javelineer', 'merfolk-impaler', 'merfolk-aquamancer',
  'naga-warrior', 'naga-mage', 'naga-ritualist', 'greater-naga', 'naga-sharpshooter',
  'deep-elf-fighter', 'deep-elf-mage', 'deep-elf-priest', 'deep-elf-knight',
  'deep-elf-sorcerer', 'deep-elf-conjurer', 'deep-elf-demonologist',
  'deep-elf-high-priest', 'deep-elf-blademaster', 'deep-elf-death-mage',
  'deep-elf-summoner', 'deep-elf-annihilator', 'deep-elf-master-archer',
  'tengu-warrior', 'tengu-conjurer', 'tengu-reaver',
  'giant-ant', 'giant-cockroach', 'giant-beetle', 'boulder-beetle',
  'giant-mite', 'giant-slug', 'giant-snail',
  'giant-blowfly', 'giant-mosquito', 'giant-leech', 'giant-firefly', 'bumblebee',
  'fire-bat', 'fire-crab', 'ghost-moth', 'caustic-shrike', 'brain-worm',
  'blink-frog', 'giant-gecko', 'manes',
  'giant-amoeba', 'giant-orange-brain',
  'death-yak', 'dire-elephant',
  'titan-skeleton', 'ancient-lich', 'bone-dragon',
  'freezing-wraith', 'shadow-wraith', 'phantasmal-warrior',
  'eidolon', 'profane-servitor', 'daeva', 'angel', 'soul-eater',
  'reaper', 'executioner', 'hell-sentinel', 'shadow-fiend', 'ice-fiend',
  'titan', 'golden-dragon', 'shadow-dragon', 'mottled-dragon',
  'quicksilver-dragon', 'iron-dragon', 'steam-dragon', 'phoenix',
  'fiend', 'balrug', 'green-death', 'blue-death',
  'swamp-drake', 'fire-drake', 'forest-drake', 'death-drake',
  'ancient-lich-lord', 'hell-knight', 'iron-dragon-ancient',
  'shadow-dragon-ancient', 'golden-dragon-ancient',
  'cacodemon', 'hellion', 'tormentor',
  'guardian-mummy', 'greater-mummy', 'skeletal-warrior',
  'vampire-knight', 'vampire-mage', 'wight-king', 'mummy-priest',
  'reaper-lord', 'harpy-matriarch',
  'guardian-serpent', 'juggernaut', 'stone-giant-lord',
  'young-dragon', 'barrow-wight',
  'goblin-king', 'drow-matron', 'giant-tarantula', 'broodmother-spider',
]);

const DMG_TYPES = ['acid','cold','fire','force','lightning','necrotic','poison','psychic','radiant','thunder','bludgeoning','piercing','slashing'];

function parseDice(str) {
  const m = /(\d+)d(\d+)(?:\s*[+-]\s*(\d+))?/.exec(str || '');
  if (!m) return null;
  return m[3] ? [+m[1], +m[2], +m[3]] : [+m[1], +m[2], 0];
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
  return null;
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

function profByCR(cr) { return 2 + Math.floor(Math.max(0, cr - 1) / 4); }

function loadApi(index) {
  const f = path.join(CACHE_DIR, index + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

/* ==================== MAIN ==================== */
console.log('=== CR Fix v3 (Conservative) ===\n');
if (DRY_RUN) console.log('[DRY RUN]\n');

const monsters = JSON.parse(fs.readFileSync(GAME_PATH, 'utf8'));

const changes = [];
let crFixed = 0, sourceFixed = 0, statsReset = 0;

for (const m of monsters) {
  const src = m.statblock?.source || '?';

  if (src === 'srd') {
    const apiTarget = API_ALIASES[m.id] || m.id;

    if (CUSTOM_VARIANTS.has(m.id)) {
      m.statblock.source = 'synth';
      changes.push(`source: ${m.id.padEnd(30)} srd -> synth`);
      sourceFixed++;
      continue;
    }

    const raw = loadApi(apiTarget);
    if (!raw || raw.challenge_rating == null) {
      if (!CUSTOM_VARIANTS.has(m.id)) {
        changes.push(`!noAPI: ${m.id.padEnd(30)} (keeping current stats)`);
      }
      continue;
    }

    const apiCR = raw.challenge_rating;
    const origCR = m.cr;
    const apiAC = Array.isArray(raw.armor_class) ? raw.armor_class[0].value : raw.armor_class;
    const apiHP = parseDice(raw.hit_points_roll || raw.hit_dice);
    const pa = primaryAttack(raw.actions);

    // Full overwrite
    if (origCR !== apiCR) {
      changes.push(`CR: ${m.id.padEnd(33)} ${origCR} -> ${apiCR}`);
      crFixed++;
    }
    m.cr = apiCR;
    m.ac = apiAC;
    if (apiHP) m.hp = apiHP;
    if (pa) {
      m.atk = pa.atk;
      m.dmg = pa.dmg;
      if (pa.ranged && !m.ranged) { m.ranged = true; m.rngRange = pa.rngRange; }
    }

    m.effStats = {
      str: raw.strength ?? 10, dex: raw.dexterity ?? 10,
      con: raw.constitution ?? 10, int: raw.intelligence ?? 10,
      wis: raw.wisdom ?? 10, cha: raw.charisma ?? 10,
    };

    const saves = {}, skills = {};
    for (const p of (raw.proficiencies || [])) {
      const n = p.proficiency?.name || '';
      let mm;
      if ((mm = /Saving Throw:\s*(\w+)/.exec(n))) saves[mm[1].toLowerCase()] = p.value;
      else if ((mm = /Skill:\s*([\w ]+)/.exec(n))) skills[mm[1].trim().toLowerCase()] = p.value;
    }
    m.saves = saves;

    const senses = {};
    if (raw.senses) {
      for (const k in raw.senses) {
        const v = raw.senses[k];
        const num = /(\d+)/.exec(String(v));
        senses[k.replace(/_(\w)/g, (_,c) => c.toUpperCase())] = num ? +num[1] : v;
      }
    }

    if (raw.xp != null) m.xp = raw.xp;

    const multi = parseMultiattack(raw.actions);
    m.statblock = {
      source: 'srd',
      prof: raw.proficiency_bonus || profByCR(apiCR),
      skills, senses,
      resist: extractResist(raw.damage_resistances),
      immune: extractResist(raw.damage_immunities),
      vulnerable: extractResist(raw.damage_vulnerabilities),
      condImmune: (raw.condition_immunities || []).map(c => (c.name || c.index || '').toLowerCase()).filter(Boolean),
      languages: raw.languages || '',
      traits: (raw.special_abilities || []).map(t => ({ name: t.name, desc: t.desc })),
      actions: (raw.actions || []).map(a => ({ name: a.name, desc: a.desc })),
    };
    if (multi > 1) m.attacksPerTurn = multi;
    statsReset++;
  }
}

// Report
console.log(`SRD CRs fixed: ${crFixed}`);
console.log(`Source srd->synth: ${sourceFixed}`);
console.log(`Stats reset from API: ${statsReset}`);

if (changes.length > 0) {
  console.log(`\n=== Changes (${changes.length}) ===`);
  for (const c of changes) console.log('  ' + c);
}

if (!DRY_RUN) {
  fs.writeFileSync(GAME_PATH, JSON.stringify(monsters, null, 1));
  console.log(`\nWritten ${monsters.length} monsters.`);
} else {
  console.log('\n[DRY RUN]');
}
