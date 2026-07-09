/**
 * SRD 5.1 rules kit — ability scores, d20 combat math, classes, races,
 * monsters, XP thresholds. Mechanics from the Systems Reference Document 5.1
 * by Wizards of the Coast LLC, licensed under CC-BY-4.0.
 */
import { aggregateEquipment, PROF_RANK, makeStarterItem } from './items.js';

/* ---------------- dice ---------------- */
export function d(n){ return 1 + Math.floor(Math.random()*n); }
export function roll(count, sides, bonus=0){
  let t = bonus;
  for(let i=0;i<count;i++) t += d(sides);
  return t;
}
/* 4d6 drop lowest, the classic stat roll */
export function rollStat(){
  const r = [d(6), d(6), d(6), d(6)].sort((a,b)=>b-a);
  return r[0]+r[1]+r[2];
}
export const mod = score => Math.floor((score-10)/2);
export const fmtMod = m => (m>=0?'+':'')+m;

export const ABILITIES = ['str','dex','con','int','wis','cha'];
export const ABILITY_LABEL = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' };

/* proficiency bonus by level (SRD table) */
export const profBonus = lvl => 2 + Math.floor((lvl-1)/4);

/* XP needed to REACH each level (index = level) */
export const XP_TABLE = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000];
export const MAX_LEVEL = 10;

/* ---------------- races (SRD) ---------------- */
export const RACES = {
  human:    { label:'Human',    bonus:{str:1,dex:1,con:1,int:1,wis:1,cha:1}, speed:1.0, trait:'Versatile: +1 to every ability score.' },
  dwarf:    { label:'Hill Dwarf', bonus:{con:2,wis:1}, speed:0.9, hpPerLevel:1, trait:'Dwarven Toughness: +1 HP per level.' },
  elf:      { label:'High Elf', bonus:{dex:2,int:1}, speed:1.1, critFinesse:true, trait:'Keen Senses: crits on 19–20 with ranged attacks.' },
  halfling: { label:'Lightfoot Halfling', bonus:{dex:2,cha:1}, speed:1.0, lucky:true, trait:'Lucky: rerolls natural 1s on attack rolls.' },
  halforc:  { label:'Half-Orc', bonus:{str:2,con:1}, speed:1.0, savageCrit:true, trait:'Savage Attacks: +1 damage die on melee crits.' }
};

/* ---------------- classes (SRD) ----------------
   statPriority: rolled stats are assigned best-first in this order.
   attack: the weapon/cantrip profile used by the auto-battler. */
export const CLASSES = {
  fighter: {
    label:'Fighter', color:0xd9a441, hitDie:10, armorProf:'heavy',
    statPriority:['str','con','dex','wis','cha','int'],
    baseAC:16, acDesc:'Chain mail',
    attack:{ name:'Longsword', ability:'str', dmg:[1,8], range:1.5, melee:true },
    feature:'Second Wind: once per dungeon, self-heal when badly hurt.',
    secondWind:true,
    skills:[
      { key:'weaponMaster', name:'Weapon Master', max:5, desc:'+1 to attack rolls per rank.', b:{atk:1} },
      { key:'brute',        name:'Brute',         max:5, desc:'+1 weapon damage per rank.',    b:{dmg:1} },
      { key:'toughness',    name:'Toughness',     max:5, desc:'+6 max HP per rank.',           b:{hp:6} },
      { key:'guardian',     name:'Guardian',      max:3, desc:'+1 AC per rank.',               b:{ac:1} }
    ]
  },
  rogue: {
    label:'Rogue', color:0x8f95a3, hitDie:8, armorProf:'light',
    statPriority:['dex','con','wis','int','cha','str'],
    baseAC:11, acPlusDex:true, acDesc:'Leather armor + Dex',
    attack:{ name:'Shortbow', ability:'dex', dmg:[1,6], range:7, melee:false },
    feature:'Sneak Attack: bonus damage when an ally is adjacent to the target.',
    sneakDice: lvl => Math.ceil(lvl/2),
    skills:[
      { key:'deadlyAim',  name:'Deadly Aim', max:5, desc:'+1 to attack rolls per rank.', b:{atk:1} },
      { key:'assassin',   name:'Assassin',   max:2, desc:'Crit range widens by 1 per rank (crit on 19, then 18).', b:{crit:1} },
      { key:'evasion',    name:'Evasion',    max:4, desc:'+1 AC per rank.',               b:{ac:1} },
      { key:'fleetfoot',  name:'Fleet-Foot', max:4, desc:'+8% move speed per rank.',      b:{speed:0.08} }
    ]
  },
  cleric: {
    label:'Cleric', color:0x5a8fe8, hitDie:8, armorProf:'medium',
    statPriority:['wis','con','str','cha','dex','int'],
    baseAC:16, acDesc:'Scale mail + shield',
    attack:{ name:'Sacred Flame', ability:'wis', dmg:[1,8], range:6, melee:false, cantripScale:true },
    feature:'Cure Wounds: heals the most wounded ally (slots recharge at shrines).',
    healer:true,
    skills:[
      { key:'blessedHealer', name:'Blessed Healer', max:5, desc:'+3 healing per rank.',        b:{heal:3} },
      { key:'divineFavor',   name:'Divine Favor',   max:5, desc:'+1 Sacred Flame damage per rank.', b:{dmg:1} },
      { key:'sanctuary',     name:'Sanctuary',      max:3, desc:'+1 AC per rank.',              b:{ac:1} },
      { key:'devotion',      name:'Devotion',       max:4, desc:'+5 max HP per rank.',          b:{hp:5} }
    ]
  },
  wizard: {
    label:'Wizard', color:0x9b6cf0, hitDie:6, armorProf:'none',
    statPriority:['int','con','dex','wis','cha','str'],
    baseAC:10, acPlusDex:true, acDesc:'No armor + Dex',
    attack:{ name:'Fire Bolt', ability:'int', dmg:[1,10], range:8, melee:false, cantripScale:true },
    feature:'Arcane Study: at level 3, chooses a school with slot-fueled spells.',
    blaster:true,
    skills:[
      { key:'evoker',     name:'Evoker',      max:5, desc:'+1 Fire Bolt damage per rank.', b:{dmg:1} },
      { key:'focused',    name:'Focused',     max:5, desc:'+1 to attack rolls per rank.',  b:{atk:1} },
      { key:'arcaneWard', name:'Arcane Ward', max:5, desc:'+4 max HP per rank.',           b:{hp:4} },
      { key:'mageArmor',  name:'Mage Armor',  max:3, desc:'+1 AC per rank.',               b:{ac:1} }
    ]
  }
};
export function classSkill(classKey, skillKey){
  return (CLASSES[classKey].skills||[]).find(s=>s.key===skillKey);
}

/* ---------------- subclasses ----------------
   Chosen once at level 3. Each grants a passive (pb: same bonus keys as
   skills/gear, folded in by recalc) and an ACTIVE ability the auto-battler
   fires on its own. Actives sit on SRD-style recharge tiers:
     'short' — once per short rest (the party rests between fights)
     'day'   — once per day (recharges when descending to a new floor)
     'slot'  — spends a spell slot from a pool (refilled at shrines + floors)
   Champion / Thief / Life Domain / Evoker are the SRD 5.1 subclasses; the
   second option for each class is built from SRD mechanics. */
export const SUBCLASS_UNLOCK = 3;
export const SUBCLASSES = {
  fighter: {
    champion: { label:'Champion', srd:true,
      passive:'Improved Critical: crit on 19–20.', pb:{crit:1},
      active:{ key:'actionSurge', name:'Action Surge', recharge:'short',
        desc:'Push past your limits: immediately attack a second time.' } },
    guardian: { label:'Guardian',
      passive:'Shield Ward: +1 AC.', pb:{ac:1},
      active:{ key:'rallyingCry', name:'Rallying Cry', recharge:'day',
        desc:'When two allies are bloodied, a battle-shout heals every ally 1d10 + level.' } }
  },
  rogue: {
    thief: { label:'Thief', srd:true,
      passive:'Fast Hands: +10% move speed, +25% gold from chests.', pb:{speed:0.10}, chestGold:0.25,
      active:{ key:'cunningAction', name:'Cunning Action', recharge:'short',
        desc:'When badly hurt, dart clear of danger: +4 AC and +40% speed for 6 seconds.' } },
    nightblade: { label:'Nightblade',
      passive:'Grim Precision: +1 weapon damage.', pb:{dmg:1},
      active:{ key:'deathstrike', name:'Deathstrike', recharge:'short',
        desc:'The first strike against an unwounded foe is an automatic critical hit.' } }
  },
  cleric: {
    life: { label:'Life Domain', srd:true,
      passive:'Disciple of Life: +2 to all healing.', pb:{heal:2},
      active:{ key:'preserveLife', name:'Preserve Life', recharge:'day',
        desc:'Channel Divinity: when two allies are badly hurt, heal every ally 2 × level + WIS.' } },
    war: { label:'War Priest',
      passive:'War God’s Favor: +1 to attack rolls.', pb:{atk:1},
      active:{ key:'guidedStrike', name:'Guided Strike', recharge:'short',
        desc:'Against an elite or boss: the next attack gains +10 to hit and +2d8 damage.' } }
  },
  wizard: {
    evoker: { label:'Evoker', srd:true,
      passive:'Empowered Evocation: +2 spell damage.', pb:{dmg:2},
      active:{ key:'fireball', name:'Fireball', recharge:'slot',
        desc:'Spend a spell slot to engulf packed enemies in an 8d6 blast.' } },
    abjurer: { label:'Abjurer',
      passive:'Arcane Ward: +1 AC, +6 max HP.', pb:{ac:1, hp:6},
      active:{ key:'magicMissile', name:'Magic Missile', recharge:'slot',
        desc:'Spend a spell slot to fire unerring darts — 3 auto-hits of 1d4+1, +1 dart per 4 levels.' } }
  }
};
export const RECHARGE_LABEL = { short:'1 / short rest', day:'1 / day', slot:'spell slots' };
export function subclassOf(h){
  return h.subclass ? SUBCLASSES[h.classKey][h.subclass] : null;
}
export function needsSubclass(h){
  return h.level >= SUBCLASS_UNLOCK && !h.subclass;
}
export function pickSubclass(h, key){
  if(h.subclass || h.level < SUBCLASS_UNLOCK || !SUBCLASSES[h.classKey][key]) return false;
  h.subclass = key;
  h.abilityUsed = { short:false, day:false };
  recalc(h);
  if(h.slotsMax) h.slots = h.slotsMax;
  return true;
}

/* cantrips add a damage die at character levels 5 (SRD cantrip scaling) */
export const cantripDice = lvl => lvl >= 5 ? 2 : 1;

/* ---------------- hero construction ---------------- */
export const HERO_NAMES = ['Bram','Kira','Aldric','Wren','Doric','Sariel','Toby','Magda','Fenn','Isolde','Garrick','Nyx','Piotr','Vessa','Odo','Lyra'];

export function makeHero(name, raceKey, classKey, baseStats, visual){
  const race = RACES[raceKey], cls = CLASSES[classKey];
  const stats = {};
  for(const ab of ABILITIES) stats[ab] = (baseStats[ab]||8) + (race.bonus[ab]||0);

  const h = {
    name, raceKey, classKey, stats, visual, level:1, xp:0,
    equipment:{}, skills:{}, pendingAbility:0, pendingSkill:0,
    subclass:null, abilityUsed:{ short:false, day:false },
    secondWind: !!cls.secondWind,
    kills:0, downs:0, dmgDealt:0
  };
  
  if (classKey === 'fighter') {
    h.equipment.weapon = makeStarterItem('weapon', 'Longsword');
    h.equipment.armor = makeStarterItem('armor', 'Chain Shirt');
  } else if (classKey === 'rogue') {
    h.equipment.weapon = makeStarterItem('weapon', 'Rusty Dagger');
    h.equipment.armor = makeStarterItem('armor', 'Leather Armor');
  } else if (classKey === 'cleric') {
    h.equipment.weapon = makeStarterItem('weapon', 'Mace');
    h.equipment.armor = makeStarterItem('armor', 'Chain Shirt');
  } else if (classKey === 'wizard') {
    h.equipment.weapon = makeStarterItem('weapon', 'Rusty Dagger');
    h.equipment.armor = makeStarterItem('armor', 'Robe');
  }

  recalc(h);
  h.hp = h.maxHp;
  return h;
}

/* Fill in any fields a legacy save is missing, then recompute derived stats. */
export function normalizeHero(h){
  if(!h.equipment) h.equipment = {};
  if(!h.skills) h.skills = {};
  if(!h.visual) {
    // Generate a fallback visual for old saves
    h.visual = { gender:'male', hair:'bangs/adult', skinColor:'#ffccaa', hairColor:'#663311' };
  } else {
    // Migrate legacy saves by ensuring colors exist
    if (!h.visual.skinColor) h.visual.skinColor = '#ffccaa';
    if (!h.visual.hairColor) h.visual.hairColor = '#663311';
    
    // Remove old keys to save space (optional, but clean)
    delete h.visual.torso;
    delete h.visual.legs;
    delete h.visual.weapon;
  }
  if(h.pendingAbility === undefined) h.pendingAbility = 0;
  if(h.pendingSkill === undefined) h.pendingSkill = 0;
  if(h.subclass === undefined) h.subclass = null;
  if(!h.abilityUsed) h.abilityUsed = { short:false, day:false };
  recalc(h);
  if(h.hp === undefined || h.hp > h.maxHp) h.hp = h.maxHp;
  return h;
}

/* Sum a hero's class-skill ranks into a bonuses object. */
export function skillBonuses(h){
  const total = {};
  const list = CLASSES[h.classKey].skills || [];
  for(const s of list){
    const rank = h.skills[s.key] || 0;
    if(!rank) continue;
    for(const k in s.b) total[k] = (total[k]||0) + s.b[k]*rank;
  }
  return total;
}

/* Recompute all derived combat fields from base stats + equipment + skills.
   Called after any change to level, stats, gear, or skills. */
export function recalc(h){
  const cls = CLASSES[h.classKey], race = RACES[h.raceKey];
  const eq = aggregateEquipment(h.equipment);
  const sk = skillBonuses(h);
  const sc = h.subclass ? SUBCLASSES[h.classKey][h.subclass] : null;
  const sum = k => (eq[k]||0) + (sk[k]||0) + ((sc && sc.pb && sc.pb[k])||0);

  /* effective ability scores (base already includes racial + spent points) */
  const eff = {};
  for(const ab of ABILITIES) eff[ab] = h.stats[ab] + sum(ab);
  h.effStats = eff;

  const conM = mod(eff.con);
  /* HP: full hit die at L1, average thereafter, + CON each level + race + bonuses */
  const avg = Math.ceil((cls.hitDie+1)/2);
  h.maxHp = cls.hitDie + (h.level-1)*avg + h.level*(conM + (race.hpPerLevel||0)) + sum('hp');
  h.maxHp = Math.max(1, h.maxHp);
  if(h.hp !== undefined) h.hp = Math.min(h.hp, h.maxHp);

  const dexAC = cls.acPlusDex ? Math.min(mod(eff.dex), h.classKey==='rogue'?99:2) : 0;
  h.ac = cls.baseAC + dexAC + sum('ac');

  h.atkBonus = profBonus(h.level) + mod(eff[cls.attack.ability]) + sum('atk');
  h.dmgBonus = sum('dmg');
  h.healBonus = sum('heal');
  h.speedMult = race.speed * (1 + sum('speed'));

  /* crit threshold: 20 by default; racial keen senses + gear/skill widen it */
  let crit = 20 - sum('crit');
  if(race.critFinesse && !cls.attack.melee) crit -= 1;
  h.critRange = Math.max(18, crit);

  if(cls.healer) h.healSlotsMax = Math.max(1, mod(eff.wis));

  /* spell-slot pool for subclasses with slot-recharge actives */
  if(sc && sc.active.recharge==='slot'){
    h.slotsMax = 1 + Math.floor(h.level/3);
    if(h.slots===undefined || h.slots>h.slotsMax) h.slots = h.slotsMax;
  } else { h.slotsMax = 0; h.slots = 0; }
  return h;
}

export function heroAttackBonus(h){ return h.atkBonus; }
export function heroDamage(h, crit){
  const cls = CLASSES[h.classKey], a = cls.attack;
  let dice = a.cantripScale ? cantripDice(h.level) : a.dmg[0];
  if(crit) dice *= 2;
  if(crit && RACES[h.raceKey].savageCrit && a.melee) dice += 1;
  /* cantrips don't add ability mod; weapons do. Gear/skill dmg bonus always applies. */
  const abilityBonus = a.cantripScale ? 0 : mod(h.effStats[a.ability]);
  return roll(dice, a.dmg[1], abilityBonus + h.dmgBonus);
}

/* level-up: HP grows automatically (via recalc); the player banks 1 ability
   point every level and 1 skill point on even levels to spend in the menus. */
export function grantXp(h, amount, log){
  h.xp += amount;
  while(h.level < MAX_LEVEL && h.xp >= XP_TABLE[h.level+1]){
    h.level++;
    h.pendingAbility += 1;
    if(h.level % 2 === 0) h.pendingSkill += 1;
    recalc(h);
    h.hp = h.maxHp;                       // full heal on level, like a rest
    if(log) log(`⭐ ${h.name} reaches level ${h.level}! (points to spend)`, 'level');
    if(log && h.level===SUBCLASS_UNLOCK && !h.subclass)
      log(`🌟 ${h.name} may choose a subclass! (Level Up menu)`, 'level');
  }
}

/* Spend a banked ability point (+1 to a score, cap 20). Returns success. */
export function spendAbilityPoint(h, ability){
  if(h.pendingAbility<=0 || h.stats[ability]>=20) return false;
  h.stats[ability]++; h.pendingAbility--;
  recalc(h);
  return true;
}
/* Spend a banked skill point on a class skill (respecting its max rank). */
export function spendSkillPoint(h, skillKey){
  const s = classSkill(h.classKey, skillKey);
  if(!s || h.pendingSkill<=0) return false;
  const cur = h.skills[skillKey] || 0;
  if(cur >= s.max) return false;
  h.skills[skillKey] = cur+1; h.pendingSkill--;
  recalc(h);
  return true;
}
export function pendingPoints(h){
  return (h.pendingAbility||0) + (h.pendingSkill||0) + (needsSubclass(h)?1:0);
}

/* whether a hero can equip an item given class armor proficiency */
export function canEquip(h, item){
  return PROF_RANK[item.prof||'none'] <= PROF_RANK[CLASSES[h.classKey].armorProf||'none'];
}

/* ============== MONSTERS ============== */

import MONSTERS_RAW from './monsters.json';

/* Index by tier for O(1) spawn-pool lookup */
const _byTier = {};
for (const m of MONSTERS_RAW) {
  const t = m.tier;
  if (!_byTier[t]) _byTier[t] = [];
  _byTier[t].push(m);
}
export const MONSTERS = _byTier;

/* Approximate threat cost per tier — used by the dungeon generator's budget
 * system to decide spawn counts. Computed from the median threat of each tier. */
export const TIER_THREAT = { 1: 12, 2: 21, 3: 38, 4: 55, 5: 90, boss: 120 };

/**
 * Dungeon visual theme → monster theme index mapping.
 * Each visual theme maps to 2–3 MONSTER_THEMES entries so monsters feel
 * native to the environment. */
export const DUNGEON_MONSTER_MAP = {
  ancient: [0, 1, 9],     // Goblinoid + Undead + Fungal
  molten:  [7, 6, 10],    // Fiendish + Elemental + Giantkind
  frost:   [3, 1, 10],    // Beasts + Undead + Giantkind
  grim:    [1, 7, 11],    // Undead + Fiendish + Drow
  verdant: [4, 8, 3],     // Orc + Fey + Beasts
};

export const MONSTER_THEMES = [
  {
    name: 'Goblinoid',
    monsters: {
      1: ['goblin', 'kobold'],
      2: ['hobgoblin'],
      3: ['bugbear'],
      4: ['hobgoblin-iron-shadow'],
      5: ['hobgoblin-iron-shadow']
    }
  },
  {
    name: 'Undead',
    monsters: {
      1: ['skeleton', 'zombie'],
      2: ['ghoul', 'shadow', 'mummy'],
      3: ['wight', 'ghast', 'vampire'],
      4: ['wraith', 'ghost'],
      5: ['wraith', 'vampire']
    }
  },
  {
    name: 'Vermin',
    monsters: {
      1: ['giant-rat', 'grey-rat', 'giant-centipede', 'giant-wolf-spider', 'stirge', 'giant-frog', 'giant-weasel'],
      2: ['giant-spider', 'wolf-spider'],
      3: ['giant-scorpion', 'phase-spider', 'ettercap', 'giant-constrictor-snake', 'ankheg'],
      4: [],
      5: ['drider']
    }
  },
  {
    name: 'Beasts',
    monsters: {
      1: ['wolf', 'giant-bat', 'giant-badger', 'giant-owl', 'poisonous-snake', 'giant-poisonous-snake'],
      2: ['dire-wolf', 'crocodile', 'warg', 'harpy'],
      3: ['owlbear', 'polar-bear', 'giant-constrictor-snake', 'basilisk'],
      4: ['bulette', 'chimera', 'hydra'],
      5: ['remorhaz', 'behir']
    }
  },
  {
    name: 'Orc Horde',
    monsters: {
      1: ['orc', 'kobold'],
      2: ['gnoll', 'orc'],
      3: ['ogre'],
      4: ['hill-giant'],
      5: ['fire-giant', 'frost-giant']
    }
  },
  {
    name: 'Draconic',
    monsters: {
      1: ['kobold'],
      2: ['kobold'],
      3: ['young-white-dragon'],
      4: ['young-black-dragon', 'young-white-dragon', 'young-green-dragon', 'wyvern'],
      5: ['young-red-dragon', 'adult-white-dragon'],
    }
  },
  {
    name: 'Elemental',
    monsters: {
      1: ['magmin'],
      2: ['magmin', 'gargoyle'],
      3: ['gargoyle', 'hell-hound'],
      4: ['air-elemental', 'earth-elemental', 'fire-elemental', 'water-elemental', 'salamander'],
      5: ['fire-elemental']
    }
  },
  {
    name: 'Fiendish',
    monsters: {
      1: ['dretch', 'manes', 'lemure'],
      2: ['imp', 'quasit'],
      3: ['hell-hound', 'bearded-devil'],
      4: ['vrock', 'barbed-devil'],
      5: ['hezrou', 'glabrezu']
    }
  },
  {
    name: 'Fey',
    monsters: {
      1: ['giant-owl'],
      2: ['satyr', 'dryad', 'centaur'],
      3: ['green-hag'],
      4: ['chimera'],
      5: []
    }
  },
  {
    name: 'Fungal',
    monsters: {
      1: ['swarm-of-rats', 'swarm-of-bats', 'giant-frog'],
      2: ['darkmantle', 'cockatrice'],
      3: ['gelatinous-cube', 'ochre-jelly', 'mimic'],
      4: ['flesh-golem'],
      5: []
    }
  },
  {
    name: 'Giantkind',
    monsters: {
      1: ['giant-poisonous-snake'],
      2: ['ogre'],
      3: ['minotaur', 'ogre', 'deep-troll', 'manticore'],
      4: ['troll', 'hill-giant', 'stone-giant'],
      5: ['frost-giant', 'fire-giant', 'cloud-giant']
    }
  },
  {
    name: 'Drow',
    monsters: {
      1: ['giant-spider', 'giant-poisonous-snake'],
      2: ['deep-gnome'],
      3: ['doppelganger', 'ettercap'],
      4: ['medusa'],
      5: ['behir']
    }
  }
];

/* effectiveLevel = max(dungeonLevel, partyLevel) so over-levelled parties
   still face threatening monsters and under-levelled ones aren't crushed.
   Gentle depth scaling: most difficulty comes from tier selection (based on
   quest level), not from stat inflation per floor. */
export function spawnMonster(tier, effectiveLevel, rngPick, allowedNames = null){
  let pool = MONSTERS[tier] || MONSTERS[1];
  if (allowedNames) {
    const filtered = pool.filter(spec => allowedNames.includes(spec.id));
    if (filtered.length > 0) pool = filtered;
  }
  const spec = pool[Math.floor(rngPick()*pool.length)];
  const lvlB = Math.max(0, effectiveLevel-1);
  /* Gentle depth scaling — most difficulty comes from tier, not floor stats.
     Per-floor bump is only ~0.15 effective levels, so lvlB grows slowly. */
  let hpBonus = Math.floor(lvlB * (tier==='boss' ? 1.5 : 0.5));
  let hp = roll(spec.hp[0] + 1 + hpBonus, spec.hp[1], spec.hp[2]||0);
  let atk = spec.atk + Math.floor(lvlB / 4);
  /* training-wheels boss: SRD boss blocks are deadly to a level-2 party */
  if(tier==='boss' && effectiveLevel<=2){ hp = Math.round(hp*0.65); atk -= 2; }
  return {
    name: spec.name, ac: spec.ac + Math.floor(lvlB/5), maxHp: hp, hp,
    atk,
    dmg: spec.dmg, xp: Math.round(spec.xp * (1 + lvlB*0.25)),
    color: spec.color, scale: spec.scale, speed: spec.speed,
    sprite: spec.sprite,
    gold: Math.round((spec.xp/10) * (1 + lvlB*0.3) * (0.6+Math.random()*0.8))
  };
}
