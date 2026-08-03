/* Monster roster expansion builder.
   - Fetches real SRD stat blocks from the 5e API for monsters it covers.
   - Adds tier-scaled custom variants for families the SRD lacks but DCSS has art for.
   - Converts to the game's monsters.json schema, dedups, appends, verifies coverage.
   Run from the repo root or anywhere:  node tools/build_monsters.mjs [--write]
   To add monsters: append entries to API_ADD (real SRD stats) or CUSTOM_ADD
   (tier-scaled variants). Always dry-run (no --write) first to check routing.
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME = path.join(ROOT, 'src/game/monsters.json');
const SPRITE_DIR = path.join(ROOT, 'public/dcss/monster');
const CACHE = new URL('./.api_cache/', import.meta.url);
const API = 'https://www.dnd5eapi.co/api/2014/monsters/';
const WRITE = process.argv.includes('--write');

if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE);
/* Derive the available sprite set straight from the filesystem (relative paths
   under public/dcss/monster/, forward slashes) so no snapshot file is needed. */
function walk(dir, base=''){ const out=[]; for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const rel = base ? base+'/'+e.name : e.name;
  if(e.isDirectory()) out.push(...walk(path.join(dir,e.name), rel));
  else if(e.name.endsWith('.png')) out.push(rel);
} return out; }
const spriteSet = new Set(walk(SPRITE_DIR));
function haveSprite(p){ return spriteSet.has(p); }

/* ---------- helpers ---------- */
function crToTier(cr){ if(cr<1) return 1; if(cr<=2) return 2; if(cr<=5) return 3; if(cr<=9) return 4; return 5; }
const SCALE = { tiny:0.55, small:0.7, medium:0.95, large:1.5, huge:2.1, gargantuan:2.6 };
const DMG_TYPES = ['acid','cold','fire','force','lightning','necrotic','poison','psychic','radiant','thunder','bludgeoning','piercing','slashing'];
const THEME_COLOR = { 'Orc Horde':0x5a7a3a, 'Fey':0x4caE7a, 'Vermin':0x8a7a4a, 'Drow & Shadow':0x6a4a8a, 'Undead':0x8aa0a8, 'Draconic':0xb05a3a, 'Goblinoid':0x7a8a4a };

function parseDice(str){ // "5d8+10" -> [5,8,10]
  const m = /(\d+)d(\d+)(?:\s*\+\s*(\d+))?/.exec(str||'');
  if(!m) return null;
  return m[3] ? [ +m[1], +m[2], +m[3] ] : [ +m[1], +m[2] ];
}
function mod(s){ return Math.floor((s-10)/2); }

function extractResist(arr){ // API strings -> game type/meta strings
  const out = [];
  for(const s of (arr||[])){
    const low = s.toLowerCase();
    if(low.includes('nonmagical')){ out.push('bludgeoning, piercing, and slashing from nonmagical weapons'); continue; }
    for(const t of DMG_TYPES){ if(low.includes(t)) out.push(t); }
  }
  return [...new Set(out)];
}

function primaryAttack(actions){
  // find an action with a to-hit bonus and a damage line
  for(const a of (actions||[])){
    const hit = /([+-]\d+)\s+to hit/.exec(a.desc);
    const dmg = /Hit:\s*\d+\s*\(([^)]+)\)\s*(\w+)/.exec(a.desc);
    if(hit && dmg){
      const ranged = /Ranged Weapon Attack/i.test(a.desc) && !/Melee/i.test(a.desc);
      const rng = /range\s+(\d+)/.exec(a.desc);
      return { atk:+hit[1], dmg:parseDice(dmg[1])||[1,6,0], ranged, rngRange: rng?Math.max(4,Math.round(+rng[1]/12)):6 };
    }
  }
  return { atk:3, dmg:[1,6,1], ranged:false };
}

async function fetchApi(index){
  const f = new URL(index+'.json', CACHE);
  if(fs.existsSync(f)) return JSON.parse(fs.readFileSync(f,'utf8'));
  const r = await fetch(API+index);
  if(!r.ok) throw new Error('fetch '+index+' -> '+r.status);
  const j = await r.json();
  fs.writeFileSync(f, JSON.stringify(j));
  return j;
}

function convertApi(m, {sprite, theme, boss, tags}){
  const size = (m.size||'Medium').toLowerCase();
  const cr = m.challenge_rating;
  const ac = Array.isArray(m.armor_class) ? m.armor_class[0].value : m.armor_class;
  const hp = parseDice(m.hit_points_roll||m.hit_dice) || [Math.max(1,Math.round(m.hit_points/5)),8];
  const pa = primaryAttack(m.actions);
  const saves = {};
  const skills = {};
  for(const p of (m.proficiencies||[])){
    const n = p.proficiency?.name||'';
    let mm;
    if((mm=/Saving Throw:\s*(\w+)/.exec(n))) saves[mm[1].toLowerCase()] = p.value;
    else if((mm=/Skill:\s*([\w ]+)/.exec(n))) skills[mm[1].trim().toLowerCase()] = p.value;
  }
  const senses = {};
  if(m.senses){ for(const k in m.senses){ const v=m.senses[k]; const num=/(\d+)/.exec(String(v)); senses[k.replace(/_(\w)/g,(_,c)=>c.toUpperCase())] = num?+num[1]:v; } }
  return {
    id: m.index, name: m.name, cr, tier: boss?'boss':crToTier(cr), theme,
    ac, hp, atk: pa.atk, dmg: pa.dmg, xp: m.xp||Math.round(cr*200)||25,
    color: THEME_COLOR[theme]||0x999999, scale: SCALE[size]||0.95,
    speed: (()=>{ const w=/(\d+)/.exec(m.speed?.walk||'30'); return w?Math.max(1.8, +w[1]/10):3; })(),
    sprite, type: (m.type||'').toLowerCase(), size,
    tags: tags || [theme.toLowerCase().replace(/[^a-z]/g,'')],
    threat: Math.max(8, Math.round(10+cr*8)),
    effStats: { str:m.strength, dex:m.dexterity, con:m.constitution, int:m.intelligence, wis:m.wisdom, cha:m.charisma },
    saves,
    ...(pa.ranged ? { ranged:true, rngRange: pa.rngRange } : {}),
    statblock: {
      source:'srd', prof:m.proficiency_bonus||2, skills, senses,
      resist: extractResist(m.damage_resistances),
      immune: extractResist(m.damage_immunities),
      vulnerable: extractResist(m.damage_vulnerabilities),
      condImmune: (m.condition_immunities||[]).map(c=>c.name?.toLowerCase()).filter(Boolean),
      languages: m.languages||'',
      traits: (m.special_abilities||[]).map(t=>({name:t.name,desc:t.desc})),
      actions: (m.actions||[]).map(a=>({name:a.name,desc:a.desc}))
    }
  };
}

/* tier-scaled template for custom variants SRD lacks */
const T = {
  1:{cr:0.5, hp:[3,8,2], ac:13, atk:4, dmg:[1,6,2], xp:100, st:{str:12,dex:13,con:12,int:9,wis:10,cha:9}},
  2:{cr:2,   hp:[5,8,6], ac:14, atk:5, dmg:[1,8,3], xp:450, st:{str:14,dex:14,con:13,int:10,wis:11,cha:10}},
  3:{cr:4,   hp:[7,10,14],ac:15, atk:6, dmg:[2,6,3], xp:1100,st:{str:16,dex:14,con:15,int:11,wis:12,cha:11}},
  4:{cr:7,   hp:[10,10,30],ac:16,atk:8, dmg:[2,8,4], xp:2900,st:{str:18,dex:14,con:17,int:12,wis:13,cha:12}},
  5:{cr:11,  hp:[14,10,56],ac:17,atk:9, dmg:[3,8,5], xp:7200,st:{str:20,dex:14,con:19,int:13,wis:14,cha:14}},
  boss:{cr:13,hp:[16,10,64],ac:17,atk:10,dmg:[3,10,6],xp:10000,st:{str:21,dex:14,con:20,int:14,wis:15,cha:16}},
};
function mkCustom({id,name,tier,sprite,theme,type,size='medium',ranged,traits,langs}){
  const t = T[tier];
  return {
    id, name, cr:t.cr, tier, theme, ac:t.ac, hp:t.hp.slice(), atk:t.atk, dmg:t.dmg.slice(),
    xp:t.xp, color:THEME_COLOR[theme]||0x999999, scale:SCALE[size]||0.95, speed:3,
    sprite, type, size, tags:[theme.toLowerCase().replace(/[^a-z]/g,'')],
    threat:Math.max(8,Math.round(10+t.cr*8)),
    effStats:{...t.st}, saves:{},
    ...(ranged?{ranged:true,rngRange:7}:{}),
    statblock:{source:'homebrew',prof:tier==='boss'?5:Math.min(6,2+Math.floor(t.cr/4)),skills:{},senses:{darkvision:60,passivePerception:10},
      resist:[],immune:[],vulnerable:[],condImmune:[],languages:langs||'',
      traits:traits||[], actions:[{name:'Attack',desc:`Melee Weapon Attack: +${t.atk} to hit, reach 5 ft., one target.`}]}
  };
}

/* ================= CURATED ADDITIONS ================= */
// API-sourced (real SRD stats). tier auto from CR unless boss:true.
const API_ADD = [
  // --- Vermin (breadth + snakes/bugs) ---
  { i:'giant-wasp', theme:'Vermin', sprite:'animals/giant_blowfly.png' },
  { i:'giant-poisonous-snake', theme:'Vermin', sprite:'animals/adder.png' },
  { i:'constrictor-snake', theme:'Vermin', sprite:'animals/snake.png' },
  { i:'flying-snake', theme:'Vermin', sprite:'animals/adder.png' },
  { i:'scorpion', theme:'Vermin', sprite:'animals/scorpion.png' },
  { i:'swarm-of-insects', theme:'Vermin', sprite:'animals/giant_cockroach.png', tags:['vermin'] },
  { i:'swarm-of-centipedes', theme:'Vermin', sprite:'animals/giant_centipede.png', tags:['vermin'] },
  { i:'remorhaz', theme:'Vermin', sprite:'animals/lava_worm.png', tags:['vermin'] },
  { i:'purple-worm', theme:'Vermin', sprite:'animals/spiny_worm.png', boss:true, tags:['vermin'] },
  // --- Fey ---
  { i:'treant', theme:'Fey', sprite:'fungi_plants/treant.png', tags:['fey'] },
  { i:'blink-dog', theme:'Fey', sprite:'animals/jackal.png', tags:['fey'] },
  // --- Drow & Shadow (aberration/underdark) ---
  { i:'drow', theme:'Drow & Shadow', sprite:'deep_elf_fighter.png' },
  { i:'gray-ooze', theme:'Drow & Shadow', sprite:'amorphous/ooze.png', tags:['ooze'] },
  { i:'black-pudding', theme:'Drow & Shadow', sprite:'amorphous/death_ooze.png', tags:['pudding'] },
  { i:'gibbering-mouther', theme:'Drow & Shadow', sprite:'demons/abomination_large.png', tags:['mouther'] },
  { i:'grick', theme:'Drow & Shadow', sprite:'animals/rock_worm.png', tags:['grick'] },
  { i:'otyugh', theme:'Drow & Shadow', sprite:'aberration/unseen_horror.png', tags:['otyugh'] },
  { i:'roper', theme:'Drow & Shadow', sprite:'animals/spiny_worm.png', tags:['roper'] },
  { i:'chuul', theme:'Drow & Shadow', sprite:'abyss/apocalypse_crab.png', tags:['chuul'] },
  { i:'cloaker', theme:'Drow & Shadow', sprite:'unique/murray.png', tags:['cloaker'] },
  // --- Undead (fill T5/variety) ---
  { i:'specter', theme:'Undead', sprite:'undead/silent_spectre.png' },
  { i:'vampire-spawn', theme:'Undead', sprite:'undead/vampire.png' },
  { i:'ogre-zombie', theme:'Undead', sprite:'undead/zombies/zombie_ogre.png' },
  { i:'will-o-wisp', theme:'Undead', sprite:'nonliving/insubstantial_wisp.png' },
  { i:'mummy-lord', theme:'Undead', sprite:'undead/greater_mummy.png', boss:true },
  // --- Draconic (fill T1 + young dragon variety) ---
  { i:'pseudodragon', theme:'Draconic', sprite:'draconic/draconic_base-mottle.png' },
  { i:'red-dragon-wyrmling', theme:'Draconic', sprite:'draconic/draconic_base-red.png' },
  { i:'white-dragon-wyrmling', theme:'Draconic', sprite:'draconic/draconic_base-white.png' },
  { i:'green-dragon-wyrmling', theme:'Draconic', sprite:'draconic/draconic_base-green.png' },
  { i:'black-dragon-wyrmling', theme:'Draconic', sprite:'draconic/draconic_base-black.png' },
  { i:'blue-dragon-wyrmling', theme:'Draconic', sprite:'draconic/draconic_base-purple.png' },
];

// Custom variants (SRD gap fillers) using verified DCSS art.
const CUSTOM_ADD = [
  // Orc Horde: T3/T4/boss (SRD only has base orc/gnoll)
  mkCustom({id:'orc-wizard', name:'Orc Wizard', tier:3, sprite:'orc_wizard.png', theme:'Orc Horde', type:'humanoid', ranged:true, langs:'Orc'}),
  mkCustom({id:'orc-sorcerer', name:'Orc Sorcerer', tier:3, sprite:'orc_sorcerer.png', theme:'Orc Horde', type:'humanoid', ranged:true, langs:'Orc'}),
  mkCustom({id:'orc-high-priest', name:'Orc High Priest', tier:4, sprite:'orc_high_priest.png', theme:'Orc Horde', type:'humanoid', langs:'Orc'}),
  mkCustom({id:'orc-knight', name:'Orc Knight', tier:4, sprite:'orc_knight.png', theme:'Orc Horde', type:'humanoid', size:'medium', langs:'Orc'}),
  mkCustom({id:'orc-warlord', name:'Orc Warlord', tier:'boss', sprite:'orc_warlord.png', theme:'Orc Horde', type:'humanoid', size:'large', langs:'Orc, Common'}),
  mkCustom({id:'gnoll-sergeant', name:'Gnoll Sergeant', tier:3, sprite:'gnoll_sergeant.png', theme:'Orc Horde', type:'humanoid', langs:'Gnoll'}),
  mkCustom({id:'gnoll-shaman', name:'Gnoll Shaman', tier:3, sprite:'gnoll_shaman.png', theme:'Orc Horde', type:'humanoid', ranged:true, langs:'Gnoll'}),
  // Fey: spriggan court + faun/nymph (fills T1/T2/T3/T4)
  mkCustom({id:'faun', name:'Faun', tier:1, sprite:'faun.png', theme:'Fey', type:'fey', langs:'Sylvan'}),
  mkCustom({id:'water-nymph', name:'Water Nymph', tier:2, sprite:'water_nymph.png', theme:'Fey', type:'fey', ranged:true, langs:'Sylvan'}),
  mkCustom({id:'spriggan', name:'Spriggan', tier:2, sprite:'spriggan/spriggan.png', theme:'Fey', type:'fey', size:'small', langs:'Sylvan'}),
  mkCustom({id:'spriggan-defender', name:'Spriggan Defender', tier:3, sprite:'spriggan/spriggan_defender.png', theme:'Fey', type:'fey', size:'small', langs:'Sylvan'}),
  mkCustom({id:'spriggan-druid', name:'Spriggan Druid', tier:3, sprite:'spriggan/spriggan_druid.png', theme:'Fey', type:'fey', size:'small', ranged:true, langs:'Sylvan'}),
  mkCustom({id:'spriggan-berserker', name:'Spriggan Berserker', tier:3, sprite:'spriggan_berserker.png', theme:'Fey', type:'fey', size:'small', langs:'Sylvan'}),
  mkCustom({id:'spriggan-rider', name:'Spriggan Rider', tier:4, sprite:'spriggan/spriggan_rider.png', theme:'Fey', type:'fey', langs:'Sylvan'}),
  mkCustom({id:'fey-queen', name:'The Fey Queen', tier:'boss', sprite:'spriggan_enchanter.png', theme:'Fey', type:'fey', ranged:true, langs:'Sylvan, Common'}),
  // Drow & Shadow: deep-elf sorcerer (blademaster/death-mage/etc already exist)
  mkCustom({id:'deep-elf-sorcerer', name:'Deep Elf Sorcerer', tier:3, sprite:'deep_elf_sorcerer.png', theme:'Drow & Shadow', type:'humanoid', ranged:true, langs:'Elvish'}),
  // Drow & Shadow: beholder-kin (eyes/ art) — fills T2/T3/T4/T5
  mkCustom({id:'gazer', name:'Gazer', tier:2, sprite:'eyes/giant_eyeball.png', theme:'Drow & Shadow', type:'aberration', size:'small', ranged:true, langs:''}),
  mkCustom({id:'shining-eye', name:'Shining Eye', tier:3, sprite:'eyes/shining_eye.png', theme:'Drow & Shadow', type:'aberration', ranged:true, langs:''}),
  mkCustom({id:'eye-of-devastation', name:'Eye of Devastation', tier:4, sprite:'eyes/eye_of_devastation.png', theme:'Drow & Shadow', type:'aberration', ranged:true, langs:''}),
  mkCustom({id:'great-orb-of-eyes', name:'Great Orb of Eyes', tier:5, sprite:'eyes/great_orb_of_eyes.png', theme:'Drow & Shadow', type:'aberration', size:'large', ranged:true, langs:''}),
  // Vermin high-tier worms
  mkCustom({id:'rock-worm', name:'Rock Worm', tier:2, sprite:'animals/rock_worm.png', theme:'Vermin', type:'monstrosity', langs:''}),
  mkCustom({id:'spiny-worm', name:'Spiny Worm', tier:3, sprite:'animals/spiny_worm.png', theme:'Vermin', type:'monstrosity', langs:''}),
  mkCustom({id:'brain-worm-swarm', name:'Brain Worm Swarm', tier:4, sprite:'animals/brain_worm.png', theme:'Vermin', type:'monstrosity', langs:''}),
  mkCustom({id:'giant-leech-swarm', name:'Giant Leech Swarm', tier:2, sprite:'animals/giant_leech.png', theme:'Vermin', type:'beast', langs:''}),
  // Undead: phantom (vampire-knight/mage already exist)
  mkCustom({id:'phantom', name:'Phantom', tier:2, sprite:'undead/phantom.png', theme:'Undead', type:'undead', langs:''}),
  // Goblinoid: high-tier leaders (SRD goblinoids are all low-CR)
  mkCustom({id:'hobgoblin-captain', name:'Hobgoblin Captain', tier:3, sprite:'hobgoblin.png', theme:'Goblinoid', type:'humanoid', langs:'Goblin, Common'}),
  mkCustom({id:'hobgoblin-warlord', name:'Hobgoblin Warlord', tier:4, sprite:'hobgoblin.png', theme:'Goblinoid', type:'humanoid', langs:'Goblin, Common'}),
  mkCustom({id:'goblin-king', name:'The Goblin King', tier:'boss', sprite:'big_kobold.png', theme:'Goblinoid', type:'humanoid', langs:'Goblin, Common'}),
  // Fey: fungal/plant court (fungi_plants/ art)
  mkCustom({id:'wandering-mushroom', name:'Wandering Mushroom', tier:1, sprite:'fungi_plants/wandering_mushroom.png', theme:'Fey', type:'plant', size:'small', langs:''}),
  mkCustom({id:'oklob-plant', name:'Oklob Plant', tier:2, sprite:'fungi_plants/oklob_plant.png', theme:'Fey', type:'plant', ranged:true, langs:''}),
  mkCustom({id:'vine-stalker', name:'Vine Stalker', tier:2, sprite:'fungi_plants/vine_stalker.png', theme:'Fey', type:'plant', langs:'Sylvan'}),
  mkCustom({id:'thorn-hunter', name:'Thorn Hunter', tier:3, sprite:'fungi_plants/thorn_hunter.png', theme:'Fey', type:'plant', langs:'Sylvan'}),
  // --- batch 3: close remaining thin buckets ---
  mkCustom({id:'orc-whelp', name:'Orc Whelp', tier:1, sprite:'orc.png', theme:'Orc Horde', type:'humanoid', size:'small', langs:'Orc'}),
  mkCustom({id:'gnoll-hunter', name:'Gnoll Hunter', tier:1, sprite:'gnoll.png', theme:'Orc Horde', type:'humanoid', ranged:true, langs:'Gnoll'}),
  mkCustom({id:'orc-warbringer', name:'Orc Warbringer', tier:5, sprite:'orc_warlord.png', theme:'Orc Horde', type:'humanoid', size:'large', langs:'Orc, Common'}),
  mkCustom({id:'giant-tarantula', name:'Giant Tarantula', tier:5, sprite:'animals/wolf_spider.png', theme:'Vermin', type:'beast', size:'large', langs:''}),
  mkCustom({id:'broodmother-spider', name:'Broodmother Spider', tier:'boss', sprite:'animals/redback.png', theme:'Vermin', type:'beast', size:'huge', langs:''}),
  mkCustom({id:'drow-matron', name:'Drow Matron', tier:'boss', sprite:'deep_elf_high_priest.png', theme:'Drow & Shadow', type:'humanoid', ranged:true, langs:'Elvish, Undercommon'}),
  mkCustom({id:'barrow-wight', name:'Barrow Wight', tier:5, sprite:'undead/vampire_knight.png', theme:'Undead', type:'undead', langs:''}),
];

/* ================= BUILD ================= */
const game = JSON.parse(fs.readFileSync(GAME,'utf8'));
const existing = new Set(game.map(m=>m.id));
const added = [];
const problems = [];

for(const spec of API_ADD){
  if(existing.has(spec.i)){ problems.push('DUP skip '+spec.i); continue; }
  if(!haveSprite(spec.sprite)){ problems.push('NO SPRITE '+spec.i+' -> '+spec.sprite); continue; }
  try{
    const raw = await fetchApi(spec.i);
    const conv = convertApi(raw, {sprite:spec.sprite, theme:spec.theme, boss:spec.boss, tags:spec.tags});
    added.push(conv); existing.add(conv.id);
  }catch(e){ problems.push('ERR '+spec.i+': '+e.message); }
}
for(const c of CUSTOM_ADD){
  if(existing.has(c.id)){ problems.push('DUP skip '+c.id); continue; }
  if(!haveSprite(c.sprite)){ problems.push('NO SPRITE '+c.id+' -> '+c.sprite); continue; }
  added.push(c); existing.add(c.id);
}

console.log('ADDED:', added.length);
if(problems.length){ console.log('\nPROBLEMS:\n  '+problems.join('\n  ')); }

/* verify theme routing of the new ones with the game classifier */
const themesList=["Goblinoid","Undead","Vermin","Beasts","Orc Horde","Draconic","Elemental","Fiendish","Fey","Giantkind","Drow & Shadow"];
function themeOf(m){
  if(m.theme && themesList.includes(m.theme)) return m.theme;   // matches srd.js fix
  const id=m.id.toLowerCase(),type=(m.type||"").toLowerCase(),tags=(m.tags||[]).map(t=>t.toLowerCase());
  if(type==="dragon"||/dragon|wyvern|drake|lindwurm|basilisk|cockatrice|chimera|hydra/.test(id))return "Draconic";
  if(type==="undead"||/ghost|specter|ghoul|zombie|skeleton|mummy|vampire|lich|wraith|shadow|death-knight/.test(id))return "Undead";
  if(tags.includes("goblinoid")||tags.includes("kobold")||/goblin|kobold|bugbear|hobgoblin/.test(id))return "Goblinoid";
  if(tags.includes("orc")||/orc|gnoll/.test(id))return "Orc Horde";
  if(type==="fiend"||/devil|demon|imp|quasit|succubus|hell-hound|dretch|lemure|manes|vrock|barbed-devil|hezrou|glabrezu|marilith|balor/.test(id))return "Fiendish";
  if(type==="fey"||/dryad|satyr|centaur|hag|pixie|sprite|nymph|elf|elven|pegasus|unicorn/.test(id))return "Fey";
  if(type==="elemental"||type==="construct"||/gargoyle|elemental|salamander|efreet|magmin|magma|fire-beetle|mephit|golem/.test(id))return "Elemental";
  if(type==="giant"||/giant|ogre|troll|ettin|cyclops|minotaur|firbolg|goliath/.test(id))return "Giantkind";
  if(/drow|shadow|dark|deep|duergar|underdark|drider|medusa|mind-flayer|beholder|spectator|grimlock|roper|choker|hook-horror|rust-monster|ooze|pudding|jelly|cube/.test(id))return "Drow & Shadow";
  if(tags.includes("vermin")||/spider|scorpion|centipede|rat|ant|beetle|cockroach|mite|slug|snail|fly|mosquito|leech|moth|carrion-crawler|wasp|bee/.test(id))return "Vermin";
  if(type==="beast"||/wolf|bear|boar|cat|dog|panther|lion|tiger|dinosaur|snake|viper|bat|owl|hawk|eagle|crab|fish/.test(id))return "Beasts";
  return "Beasts";
}
console.log('\n=== NEW MONSTER ROUTING (want theme == intended) ===');
for(const m of added){ console.log(`  ${m.id.padEnd(24)} T${String(m.tier).padEnd(4)} -> ${themeOf(m)}`); }

if(WRITE){
  const out = game.concat(added);
  fs.writeFileSync(GAME, JSON.stringify(out, null, 1));
  console.log('\nWROTE', out.length, 'monsters to', GAME);
} else {
  console.log('\n(dry run — pass --write to save)');
}
