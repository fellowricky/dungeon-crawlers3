/* Comprehensive Monster Roster Auditor & 5e SRD Builder.
   Updates all 308 monsters in src/game/monsters.json with 5e SRD / official 5e stats,
   skills, saving throws, condition immunities, senses, traits, actions, and VFX abilities.
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME = path.join(ROOT, 'src/game/monsters.json');
const CACHE_DIR = path.join(ROOT, 'tools/.api_cache');
const API = 'https://www.dnd5eapi.co/api/2014/monsters/';

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const monsters = JSON.parse(fs.readFileSync(GAME, 'utf8'));

/* ---------------- API ALIAS MAPPING ---------------- */
const API_ALIASES = {
  'deep-gnome': 'deep-gnome-svirfneblin',
  'warg': 'worg',
  'grey-rat': 'giant-rat',
  'adder': 'poisonous-snake',
  'stone-giant-lord': 'stone-giant',
  'young-dragon': 'young-red-dragon',
  'vampire': 'vampire-vampire',
  'werewolf': 'werewolf-hybrid',
  'boss-troll': 'troll',
  'deep-troll': 'troll',
  'manes': 'dretch',
  'giant-ant': 'giant-centipede',
  'giant-cockroach': 'swarm-of-insects',
  'giant-beetle': 'giant-fire-beetle',
  'boulder-beetle': 'giant-fire-beetle',
  'giant-mite': 'giant-poisonous-snake',
  'giant-slug': 'black-pudding',
  'giant-snail': 'flail-snail',
  'giant-blowfly': 'giant-wasp',
  'giant-mosquito': 'stirge',
  'giant-leech': 'swarm-of-insects',
  'giant-firefly': 'giant-fire-beetle',
  'bumblebee': 'giant-wasp',
  'fire-bat': 'bat',
  'fire-crab': 'giant-crab',
  'ghost-moth': 'will-o-wisp',
  'blink-frog': 'giant-frog',
  'giant-gecko': 'lizard',
  'caustic-shrike': 'cockatrice',
  'brain-worm': 'mind-flayer',
  'wolf-spider': 'giant-wolf-spider',
  'orc-warrior': 'orc',
  'orc-priest': 'orc',
  'orc-knight': 'orc-war-chief',
  'big-kobold': 'kobold',
  'merfolk-fighter': 'merfolk',
  'merfolk-javelineer': 'merfolk',
  'merfolk-impaler': 'merfolk',
  'merfolk-aquamancer': 'merfolk',
  'naga-warrior': 'guardian-naga',
  'naga-mage': 'spirit-naga',
  'naga-ritualist': 'guardian-naga',
  'greater-naga': 'guardian-naga',
  'naga-sharpshooter': 'spirit-naga',
  'alligator': 'crocodile',
  'anaconda': 'giant-constrictor-snake',
  'death-yak': 'minotaur',
  'dire-elephant': 'elephant',
  'grizzly-bear': 'brown-bear',
  'cyclops': 'cyclops',
  'lindwurm': 'wyvern',
  'giant-amoeba': 'black-pudding',
  'giant-orange-brain': 'gibbering-mouther',
  'deep-troll-berserker': 'troll',
  'deep-troll-earth-mage': 'troll',
  'deep-troll-shaman': 'troll',
  'iron-troll': 'troll',
  'rock-troll': 'troll',
  'juggernaut': 'iron-golem',
  'titan-skeleton': 'skeleton',
  'ancient-lich': 'lich',
  'bone-dragon': 'dracolich',
  'freezing-wraith': 'wraith',
  'shadow-wraith': 'wraith',
  'phantasmal-warrior': 'wight',
  'eidolon': 'shield-golem',
  'profane-servitor': 'deva',
  'daeva': 'deva',
  'angel': 'deva',
  'soul-eater': 'fiendish-spirit',
  'reaper': 'death-dog',
  'executioner': 'executioner',
  'hell-sentinel': 'horned-devil',
  'shadow-fiend': 'shadow',
  'ice-fiend': 'ice-devil',
  'deep-elf-master-archer': 'drow',
  'titan': 'empyrean',
  'golden-dragon': 'adult-gold-dragon',
  'shadow-dragon': 'young-red-shadow-dragon',
  'mottled-dragon': 'young-green-dragon',
  'quicksilver-dragon': 'young-blue-dragon',
  'iron-dragon': 'young-black-dragon',
  'steam-dragon': 'young-red-dragon',
  'phoenix': 'firebird',
  'fiend': 'pit-fiend',
  'balrug': 'balor',
  'green-death': 'hezrou',
  'blue-death': 'glabrezu',
  'swamp-drake': 'green-dragon-wyrmling',
  'fire-drake': 'red-dragon-wyrmling',
  'forest-drake': 'green-dragon-wyrmling',
  'death-drake': 'black-dragon-wyrmling',
  'ancient-lich-lord': 'lich',
  'hell-knight': 'death-knight',
  'iron-dragon-ancient': 'adult-black-dragon',
  'shadow-dragon-ancient': 'adult-red-shadow-dragon',
  'golden-dragon-ancient': 'ancient-gold-dragon',
  'cacodemon': 'beholder',
  'hellion': 'barbed-devil',
  'tormentor': 'bearded-devil',
  'guardian-mummy': 'mummy-lord',
  'greater-mummy': 'mummy-lord',
  'skeletal-warrior': 'skeleton',
  'vampire-knight': 'vampire-vampire',
  'vampire-mage': 'vampire-vampire',
  'wight-king': 'wight',
  'mummy-priest': 'mummy',
  'reaper-lord': 'death-dog',
  'harpy-matriarch': 'harpy',
  'deep-elf-fighter': 'drow',
  'deep-elf-mage': 'drow-mage',
  'deep-elf-priest': 'drow-priestess-of-lolth',
  'deep-elf-knight': 'drow',
  'deep-elf-sorcerer': 'drow-mage',
  'deep-elf-conjurer': 'drow-mage',
  'deep-elf-demonologist': 'drow-mage',
  'deep-elf-high-priest': 'drow-priestess-of-lolth',
  'deep-elf-blademaster': 'drow',
  'deep-elf-death-mage': 'drow-mage',
  'deep-elf-summoner': 'drow-mage',
  'deep-elf-annihilator': 'drow-mage',
  'deep-dwarf-berserker': 'duergar',
  'deep-dwarf-death-knight': 'duergar',
  'deep-dwarf-artificer': 'duergar',
  'death-knight': 'death-knight',
  'necromancer': 'mage',
  'wizard': 'mage',
  'tengu-warrior': 'kenku',
  'tengu-conjurer': 'kenku',
  'tengu-reaver': 'kenku',
  'orc-wizard': 'mage',
  'orc-sorcerer': 'mage',
  'orc-high-priest': 'priest',
  'orc-warlord': 'orc-war-chief',
  'gnoll-sergeant': 'gnoll-pack-lord',
  'gnoll-shaman': 'gnoll-pack-lord',
  'gnoll-hunter': 'gnoll',
  'hobgoblin-captain': 'hobgoblin-captain',
  'hobgoblin-warlord': 'hobgoblin-warlord',
  'goblin-king': 'goblin-boss',
  'drow-matron': 'drow-priestess-of-lolth',
  'barrow-wight': 'wight'
};

/* ---------------- EXPLICIT 5E STATBLOCKS FOR NON-API MONSTERS ---------------- */
const CUSTOM_OVERRIDES = {
  'gazer': {
    name: 'Gazer', cr: 0.5, ac: 13, hp: [3, 4, 6], atk: 5, dmg: [1, 4, 3], xp: 100,
    effStats: { str: 3, dex: 17, con: 14, int: 3, wis: 10, cha: 7 },
    saves: { wis: 2 },
    skills: { perception: 4, stealth: 5 },
    condImmune: ['prone'],
    senses: { darkvision: 60, passivePerception: 14 },
    languages: '—',
    ranged: true, rngRange: 7,
    traits: [
      { name: 'Mimicry', desc: 'The gazer can mimic simple sounds of speech it has heard, in any language. A creature that hears the sounds can tell they are imitations with a successful DC 10 Wisdom (Insight) check.' }
    ],
    actions: [
      { name: 'Bite', desc: 'Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 1 piercing damage.' },
      { name: 'Eye Rays', desc: 'The gazer shoots two of the following magical eye rays at random (1- Dazing Ray: DC 12 Wisdom save or charmed, speed halved, disadv on attacks; 2- Fear Ray: DC 12 Wisdom save or frightened; 3- Frost Ray: DC 12 Dexterity save or 10 (3d6) cold damage; 4- Telekinetic Ray: DC 12 Strength save or moved up to 30 ft away).' }
    ],
    abilities: [
      { key: 'dazingRay', label: 'Dazing Ray', trigger: 'cycle', every: 2, save: { ab: 'wis', dc: 12 }, effect: { key: 'charmed', dur: 6, repeatSave: true }, sprite: 'quad_glow', color: 15247615 },
      { key: 'fearRay', label: 'Fear Ray', trigger: 'cycle', every: 2, save: { ab: 'wis', dc: 12 }, effect: { key: 'frightened', dur: 6 }, sprite: 'cloud_gloom_new', color: 10180534 },
      { key: 'frostRay', label: 'Frost Ray', trigger: 'cycle', every: 2, save: { ab: 'dex', dc: 12, half: true }, dice: [3, 6, 0], dmgType: 'cold', sprite: 'frost_0', color: 8377599 },
      { key: 'telekineticRay', label: 'Telekinetic Ray', trigger: 'cycle', every: 2, save: { ab: 'str', dc: 12 }, effect: { key: 'slowed', dur: 4 }, sprite: 'magic_bolt_1', color: 11570431 }
    ]
  },
  'deep-elf-demonologist': {
    name: 'Deep Elf Demonologist', cr: 2, ac: 13, hp: [6, 8, 6], atk: 5, dmg: [2, 6, 3], xp: 450,
    effStats: { str: 10, dex: 16, con: 12, int: 16, wis: 12, cha: 16 },
    saves: { int: 5, wis: 3, cha: 5 },
    skills: { arcana: 5, religion: 5, stealth: 5 },
    senses: { darkvision: 60, passivePerception: 11 },
    languages: 'Elvish, Undercommon, Abyssal',
    ranged: true, rngRange: 8,
    traits: [
      { name: 'Spellcasting (Demonology)', desc: 'The demonologist is a 5th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 13, +5 to hit with spell attacks).' }
    ],
    actions: [
      { name: 'Fiendish Bolt', desc: 'Ranged Spell Attack: +5 to hit, range 60 ft., one target. Hit: 10 (3d6) fire damage.' },
      { name: 'Hellfire Blast', desc: 'The demonologist unleashes a burst of hellfire in a 15-foot cone. Each creature in that area must make a DC 13 Dexterity saving throw, taking 14 (4d6) fire damage on a failed save, or half as much on a successful one.' },
      { name: 'Demonic Curse', desc: 'The demonologist targets one creature it can see within 30 feet. The target must succeed on a DC 13 Wisdom saving throw or be frightened for 1 minute.' },
      { name: 'Dagger', desc: 'Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 5 (1d4+3) piercing damage.' }
    ],
    abilities: [
      { key: 'hellfireBlast', label: 'Hellfire Blast', trigger: 'cycle', every: 2, save: { ab: 'dex', dc: 13, half: true }, dice: [4, 6, 0], dmgType: 'fire', sprite: 'cloud_fire_1', color: 16737312 },
      { key: 'demonicCurse', label: 'Demonic Curse', trigger: 'cycle', every: 3, save: { ab: 'wis', dc: 13 }, effect: { key: 'frightened', dur: 6 }, sprite: 'cloud_neg_1', color: 10180534 },
      { key: 'fiendishDrain', label: 'Fiendish Drain', trigger: 'onHit', save: { ab: 'con', dc: 13 }, dice: [2, 6, 0], dmgType: 'necrotic', effect: { key: 'drained', drainHp: 4 }, sprite: 'drain_red_1', color: 12599360 }
    ]
  },
  'deep-elf-mage': {
    name: 'Deep Elf Mage', cr: 2, ac: 12, hp: [5, 8, 5], atk: 5, dmg: [2, 6, 2], xp: 450,
    effStats: { str: 9, dex: 14, con: 12, int: 16, wis: 13, cha: 11 },
    saves: { int: 5, wis: 3 },
    skills: { arcana: 5, stealth: 4 },
    senses: { darkvision: 60, passivePerception: 11 },
    languages: 'Elvish, Undercommon',
    ranged: true, rngRange: 8,
    traits: [
      { name: 'Spellcasting', desc: 'The mage is a 4th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 13, +5 to hit with spell attacks).' }
    ],
    actions: [
      { name: 'Firebolt', desc: 'Ranged Spell Attack: +5 to hit, range 60 ft., one target. Hit: 11 (2d10) fire damage.' },
      { name: 'Ray of Frost', desc: 'Ranged Spell Attack: +5 to hit, range 60 ft., one target. Hit: 9 (2d8) cold damage and speed is reduced by 10 feet.' }
    ],
    abilities: [
      { key: 'firebolt', label: 'Firebolt', trigger: 'cycle', every: 2, save: { ab: 'dex', dc: 13, half: true }, dice: [2, 10, 0], dmgType: 'fire', sprite: 'cloud_fire_0', color: 16742960 },
      { key: 'rayOfFrost', label: 'Ray of Frost', trigger: 'cycle', every: 3, save: { ab: 'con', dc: 13 }, dice: [2, 8, 0], dmgType: 'cold', effect: { key: 'slowed', dur: 4 }, sprite: 'frost_0', color: 8377599 }
    ]
  },
  'deep-elf-sorcerer': {
    name: 'Deep Elf Sorcerer', cr: 3, ac: 13, hp: [7, 8, 7], atk: 6, dmg: [2, 8, 3], xp: 700,
    effStats: { str: 10, dex: 16, con: 12, int: 12, wis: 11, cha: 17 },
    saves: { con: 3, cha: 5 },
    skills: { arcana: 3, deception: 5, stealth: 5 },
    senses: { darkvision: 60, passivePerception: 10 },
    languages: 'Elvish, Undercommon',
    ranged: true, rngRange: 8,
    traits: [
      { name: 'Spellcasting (Metamagic)', desc: 'The sorcerer is a 5th-level spellcaster. Its spellcasting ability is Charisma (spell save DC 13, +5 to hit with spell attacks).' }
    ],
    actions: [
      { name: 'Chaos Bolt', desc: 'Ranged Spell Attack: +5 to hit, range 60 ft., one target. Hit: 12 (2d8+1d6) force damage.' },
      { name: 'Scorching Ray', desc: 'Ranged Spell Attack: +5 to hit, range 60 ft., one target. Hit: 14 (4d6) fire damage.' }
    ],
    abilities: [
      { key: 'chaosBolt', label: 'Chaos Bolt', trigger: 'cycle', every: 2, save: { ab: 'dex', dc: 13, half: true }, dice: [3, 6, 0], dmgType: 'force', sprite: 'cloud_chaos_4', color: 16746564 }
    ]
  },
  'deep-elf-conjurer': {
    name: 'Deep Elf Conjurer', cr: 3, ac: 13, hp: [6, 8, 12], atk: 5, dmg: [2, 6, 3], xp: 700,
    effStats: { str: 10, dex: 16, con: 14, int: 16, wis: 12, cha: 12 },
    saves: { int: 5, wis: 3 },
    skills: { arcana: 5, stealth: 5 },
    senses: { darkvision: 60, passivePerception: 11 },
    languages: 'Elvish, Undercommon',
    ranged: true, rngRange: 8,
    traits: [
      { name: 'Benign Transposition', desc: 'The conjurer can teleport up to 30 feet to an unoccupied space it can see.' }
    ],
    actions: [
      { name: 'Acid Arrow', desc: 'Ranged Spell Attack: +5 to hit, range 60 ft., one target. Hit: 10 (4d4) acid damage.' },
      { name: 'Poison Spray', desc: 'The conjurer projects a cloud of toxic gas. DC 13 Constitution save or 13 (3d8) poison damage.' }
    ],
    abilities: [
      { key: 'acidArrow', label: 'Acid Arrow', trigger: 'cycle', every: 2, save: { ab: 'dex', dc: 13, half: true }, dice: [3, 6, 0], dmgType: 'acid', sprite: 'acid_venom', color: 5025356 }
    ]
  },
  'deep-elf-death-mage': {
    name: 'Deep Elf Death Mage', cr: 4, ac: 14, hp: [8, 8, 16], atk: 6, dmg: [3, 6, 3], xp: 1100,
    effStats: { str: 10, dex: 16, con: 14, int: 17, wis: 14, cha: 14 },
    saves: { int: 6, wis: 5 },
    skills: { arcana: 6, stealth: 5 },
    senses: { darkvision: 60, passivePerception: 12 },
    languages: 'Elvish, Undercommon',
    ranged: true, rngRange: 8,
    traits: [
      { name: 'Grim Harvest', desc: 'When the death mage kills a target with magic, it regains hit points equal to twice the spell level.' }
    ],
    actions: [
      { name: 'Blight', desc: 'The death mage targets one creature within 60 feet. DC 14 Constitution save or 22 (5d8) necrotic damage.' },
      { name: 'Life Drain', desc: 'Ranged Spell Attack: +6 to hit, range 60 ft. Hit: 14 (4d6) necrotic damage and target maximum HP is reduced.' }
    ],
    abilities: [
      { key: 'blight', label: 'Blight', trigger: 'cycle', every: 2, save: { ab: 'con', dc: 14, half: true }, dice: [4, 8, 0], dmgType: 'necrotic', sprite: 'cloud_neg_1', color: 6959232 },
      { key: 'lifeDrain', label: 'Life Drain', trigger: 'onHit', save: { ab: 'con', dc: 14, half: true }, dice: [3, 6, 0], dmgType: 'necrotic', effect: { key: 'drained', drainHp: 5 }, sprite: 'drain_red_1', color: 11563216 }
    ]
  },
  'deep-elf-summoner': {
    name: 'Deep Elf Summoner', cr: 4, ac: 14, hp: [8, 8, 16], atk: 6, dmg: [3, 6, 3], xp: 1100,
    effStats: { str: 10, dex: 16, con: 14, int: 17, wis: 13, cha: 15 },
    saves: { int: 6, wis: 4 },
    skills: { arcana: 6, stealth: 5 },
    senses: { darkvision: 60, passivePerception: 11 },
    languages: 'Elvish, Undercommon',
    ranged: true, rngRange: 8,
    actions: [
      { name: 'Arcane Blast', desc: 'Ranged Spell Attack: +6 to hit, range 60 ft. Hit: 15 (3d8+2) force damage.' }
    ],
    abilities: [
      { key: 'arcaneBlast', label: 'Arcane Blast', trigger: 'cycle', every: 2, save: { ab: 'dex', dc: 14, half: true }, dice: [3, 8, 2], dmgType: 'force', sprite: 'magic_bolt_1', color: 11570431 }
    ]
  },
  'deep-elf-annihilator': {
    name: 'Deep Elf Annihilator', cr: 5, ac: 15, hp: [10, 8, 20], atk: 7, dmg: [4, 6, 4], xp: 1800,
    effStats: { str: 10, dex: 16, con: 14, int: 18, wis: 14, cha: 15 },
    saves: { int: 7, wis: 5 },
    skills: { arcana: 7, stealth: 6 },
    senses: { darkvision: 60, passivePerception: 12 },
    languages: 'Elvish, Undercommon',
    ranged: true, rngRange: 8,
    traits: [
      { name: 'Overchannel', desc: 'The annihilator casts destructive spells at maximum damage potential.' }
    ],
    actions: [
      { name: 'Chain Lightning', desc: 'The annihilator unleashes lightning. DC 15 Dexterity save or 27 (6d8) lightning damage.' },
      { name: 'Disintegrate Ray', desc: 'DC 15 Dexterity save or 25 (5d8+5) force damage.' }
    ],
    abilities: [
      { key: 'chainLightning', label: 'Chain Lightning', trigger: 'cycle', every: 2, save: { ab: 'dex', dc: 15, half: true }, dice: [6, 8, 0], dmgType: 'lightning', sprite: 'zap_2', color: 7377151 }
    ]
  },
  'deep-elf-high-priest': {
    name: 'Deep Elf High Priest', cr: 5, ac: 16, hp: [10, 8, 20], atk: 7, dmg: [3, 8, 4], xp: 1800,
    effStats: { str: 12, dex: 16, con: 14, int: 14, wis: 18, cha: 16 },
    saves: { wis: 7, cha: 6 },
    skills: { religion: 5, stealth: 6, insight: 7 },
    senses: { darkvision: 60, passivePerception: 14 },
    languages: 'Elvish, Undercommon',
    ranged: true, rngRange: 8,
    traits: [
      { name: 'Divine Grace', desc: 'The high priest adds its Charisma modifier to saving throws.' }
    ],
    actions: [
      { name: 'Divine Smite', desc: 'Ranged Spell Attack: +7 to hit, range 60 ft. Hit: 18 (4d8) radiant damage.' },
      { name: 'Hold Person', desc: 'DC 15 Wisdom save or paralyzed for 1 minute.' }
    ],
    abilities: [
      { key: 'divineSmite', label: 'Divine Smite', trigger: 'cycle', every: 2, save: { ab: 'dex', dc: 15, half: true }, dice: [4, 8, 0], dmgType: 'radiant', sprite: 'goldaura_1', color: 16765770 },
      { key: 'holdPerson', label: 'Hold Person', trigger: 'cycle', every: 3, save: { ab: 'wis', dc: 15 }, effect: { key: 'paralyzed', dur: 6, repeatSave: true }, sprite: 'silenced', color: 8425664 }
    ]
  }
};

/* ---------- Helpers ---------- */
const DMG_TYPES = ['acid','cold','fire','force','lightning','necrotic','poison','psychic','radiant','thunder','bludgeoning','piercing','slashing'];

function parseDice(str) {
  const m = /(\d+)d(\d+)(?:\s*\+\s*(\d+))?/.exec(str || '');
  if (!m) return null;
  return m[3] ? [+m[1], +m[2], +m[3]] : [+m[1], +m[2]];
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
    const hit = /([+-]\d+)\s+to hit/.exec(a.desc);
    const dmg = /Hit:\s*\d+\s*\(([^)]+)\)\s*(\w+)/.exec(a.desc);
    if (hit && dmg) {
      const ranged = /Ranged Weapon Attack/i.test(a.desc) && !/Melee/i.test(a.desc);
      const rng = /range\s+(\d+)/.exec(a.desc);
      return { atk: +hit[1], dmg: parseDice(dmg[1]) || [1, 6, 0], ranged, rngRange: rng ? Math.max(4, Math.round(+rng[1] / 12)) : 6 };
    }
  }
  return null;
}

async function fetchApi(index) {
  const cacheFile = path.join(CACHE_DIR, index + '.json');
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  try {
    const r = await fetch(API + index);
    if (!r.ok) return null;
    const j = await r.json();
    fs.writeFileSync(cacheFile, JSON.stringify(j));
    return j;
  } catch (e) {
    return null;
  }
}

const WORD_TO_NUM = { two: 2, three: 3, four: 4, five: 5, six: 6, 2: 2, 3: 3, 4: 4, 5: 5 };

function parseMultiattack(actions) {
  if (!actions) return 1;
  const multiAction = actions.find(a => /multiattack/i.test(a.name || ''));
  if (!multiAction) return 1;
  const desc = multiAction.desc || '';

  const m1 = /makes\s+(two|three|four|five|six|2|3|4|5|6)\s+attacks/i.exec(desc);
  if (m1) return WORD_TO_NUM[m1[1].toLowerCase()] || 2;

  const m2 = /makes\s+(three|3)\s+/i.exec(desc);
  if (m2) return 3;

  const m3 = /makes\s+one\s+.*and\s+one/i.exec(desc) || /makes\s+one\s+.*if.*makes\s+one/i.exec(desc) || /makes\s+one\s+.*one/i.exec(desc);
  if (m3) return 2;

  return 2;
}

async function runAudit() {
  console.log('Auditing and enriching all 308 monsters...');
  let updatedCount = 0;
  
  for (const m of monsters) {
    const custom = CUSTOM_OVERRIDES[m.id];
    if (custom) {
      m.cr = custom.cr;
      m.ac = custom.ac;
      m.hp = custom.hp;
      m.atk = custom.atk;
      m.dmg = custom.dmg;
      m.xp = custom.xp;
      m.effStats = { ...custom.effStats };
      m.saves = { ...custom.saves };
      if (custom.ranged) { m.ranged = true; m.rngRange = custom.rngRange || 7; }
      m.statblock = {
        source: 'srd',
        prof: Math.min(6, 2 + Math.floor(m.cr / 4)),
        skills: { ...custom.skills },
        senses: { ...custom.senses },
        resist: custom.resist || [],
        immune: custom.immune || [],
        vulnerable: custom.vulnerable || [],
        condImmune: custom.condImmune || [],
        languages: custom.languages || '',
        traits: custom.traits || [],
        actions: custom.actions || []
      };
      if (custom.abilities) m.abilities = custom.abilities;
      const multi = parseMultiattack(m.statblock.actions);
      if (multi > 1) m.attacksPerTurn = multi;
      updatedCount++;
      continue;
    }

    const apiTarget = API_ALIASES[m.id] || m.id;
    const raw = await fetchApi(apiTarget);
    if (raw) {
      m.cr = raw.challenge_rating ?? m.cr;
      m.ac = Array.isArray(raw.armor_class) ? raw.armor_class[0].value : (raw.armor_class ?? m.ac);
      m.hp = parseDice(raw.hit_points_roll || raw.hit_dice) || m.hp;
      m.xp = raw.xp ?? m.xp;
      m.effStats = {
        str: raw.strength ?? m.effStats.str,
        dex: raw.dexterity ?? m.effStats.dex,
        con: raw.constitution ?? m.effStats.con,
        int: raw.intelligence ?? m.effStats.int,
        wis: raw.wisdom ?? m.effStats.wis,
        cha: raw.charisma ?? m.effStats.cha
      };

      const pa = primaryAttack(raw.actions);
      if (pa) {
        m.atk = pa.atk;
        m.dmg = pa.dmg;
        if (pa.ranged && !m.ranged) {
          m.ranged = true;
          m.rngRange = pa.rngRange;
        }
      }

      const saves = {};
      const skills = {};
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
          senses[k.replace(/_(\w)/g, (_, c) => c.toUpperCase())] = num ? +num[1] : v;
        }
      }

      m.statblock = {
        source: 'srd',
        prof: raw.proficiency_bonus || Math.min(6, 2 + Math.floor(m.cr / 4)),
        skills,
        senses,
        resist: extractResist(raw.damage_resistances),
        immune: extractResist(raw.damage_immunities),
        vulnerable: extractResist(raw.damage_vulnerabilities),
        condImmune: (raw.condition_immunities || []).map(c => (c.name || c.index || '').toLowerCase()).filter(Boolean),
        languages: raw.languages || '—',
        traits: (raw.special_abilities || []).map(t => ({ name: t.name, desc: t.desc })),
        actions: (raw.actions || []).map(a => ({ name: a.name, desc: a.desc }))
      };

      const multi = parseMultiattack(m.statblock.actions);
      if (multi > 1) m.attacksPerTurn = multi;

      updatedCount++;
    } else {
      // Ensure existing custom/synth monsters have prof, senses, skills, saves set up cleanly
      if (!m.saves) m.saves = {};
      if (!m.statblock) m.statblock = { source: 'homebrew', prof: 2, skills: {}, senses: { darkvision: 60, passivePerception: 10 }, resist: [], immune: [], vulnerable: [], condImmune: [], languages: '', traits: [], actions: [] };
      if (!m.statblock.skills) m.statblock.skills = {};
      if (!m.statblock.senses) m.statblock.senses = { darkvision: 60, passivePerception: 10 };
      if (!m.statblock.condImmune) m.statblock.condImmune = [];

      const multi = parseMultiattack(m.statblock.actions);
      if (multi > 1) m.attacksPerTurn = multi;
    }
  }

  fs.writeFileSync(GAME, JSON.stringify(monsters, null, 1));
  console.log(`Updated ${updatedCount} monsters in monsters.json with 5e SRD statblocks and Multiattack attacksPerTurn!`);
}

runAudit();
