/**
 * Item & loot system. Items are plain data carrying a `bonuses` object so the
 * rules layer (srd.js) can aggregate equipment without importing this module
 * (keeps the dependency one-way: items.js is pure data generation).
 *
 * bonuses shape (all optional, additive):
 *   str dex con int wis cha  — ability score bonuses
 *   ac atk dmg hp            — combat bonuses
 *   crit                     — lowers crit threshold (1 => crit on 19-20)
 *   heal                     — added to Cure Wounds / healing
 *   speed                    — movement multiplier bonus (0.1 = +10%)
 */

/* equipment slots, in display order */
export const SLOTS = [
  { key:'helm',   label:'Helm',    icon:'🪖' },
  { key:'amulet', label:'Amulet',  icon:'📿' },
  { key:'armor',  label:'Armor',   icon:'🧥' },
  { key:'gloves', label:'Gloves',  icon:'🧤' },
  { key:'weapon', label:'Weapon',  icon:'⚔️' },
  { key:'offhand',label:'Off-hand',icon:'🛡️' },
  { key:'ring1',  label:'Ring',    icon:'💍' },
  { key:'ring2',  label:'Ring',    icon:'💍' },
  { key:'boots',  label:'Boots',   icon:'🥾' }
];
export const SLOT_LABEL = Object.fromEntries(SLOTS.map(s=>[s.key,s.label]));
/* which equip-slot(s) an item's `slot` field can occupy */
export function slotsFor(itemSlot){
  if(itemSlot==='ring') return ['ring1','ring2'];
  if(itemSlot==='shield') return ['offhand'];
  return [itemSlot];
}

/* armor proficiency ranks */
export const PROF_RANK = { none:0, light:1, medium:2, heavy:3 };

/* rarities: weight is the base drop weight; mult scales numeric bonuses;
   affixes = how many secondary stat rolls it gets on top of the base. */
export const RARITIES = {
  common:    { name:'',          color:'#b4b0a4', weight:50,  mult:1.0, affixes:0 },
  uncommon:  { name:'Fine',      color:'#5fd46a', weight:26,  mult:1.7, affixes:1 },
  rare:      { name:'Enchanted', color:'#5aa0f0', weight:14,  mult:2.5, affixes:2 },
  epic:      { name:'Ancient',   color:'#b06cf0', weight:6,   mult:3.5, affixes:2 },
  legendary: { name:'Fabled',    color:'#e8a83f', weight:1.6, mult:4.8, affixes:3 }
};
export const RARITY_ORDER = ['common','uncommon','rare','epic','legendary'];

/* base item templates: primary bonus + slot + icon. `prof` on armor gates it
   behind class armor training. */
const BASES = {
  weapon: [
    { name:'Club',      icon:'🏏', prim:{}, visualWeapon:'blunt/club' },
    { name:'Rusty Dagger',icon:'🗡️', prim:{}, visualWeapon:'sword/dagger' },
    { name:'Wooden Wand',icon:'🪄', prim:{}, visualWeapon:'magic/wand' },
    { name:'Dagger',    icon:'🗡️', prim:{atk:1, crit:1}, visualWeapon:'sword/dagger' },
    { name:'Shortsword',icon:'⚔️', prim:{atk:1, dmg:1}, visualWeapon:'sword/longsword' },
    { name:'Longsword', icon:'⚔️', prim:{atk:2, dmg:1}, prof:'martial', visualWeapon:'sword/longsword' },
    { name:'Greatsword',icon:'🗡️', prim:{atk:2, dmg:2}, prof:'martial', twoHanded:true, visualWeapon:'sword/longsword' },
    { name:'Rapier',    icon:'🤺', prim:{atk:2, crit:1}, prof:'martial', visualWeapon:'sword/rapier' },
    { name:'Mace',      icon:'🔨', prim:{atk:1, dmg:2}, prof:'martial', visualWeapon:'blunt/mace' },
    { name:'Warhammer', icon:'🔨', prim:{dmg:2}, visualWeapon:'blunt/mace' },
    { name:'Spear',     icon:'🔱', prim:{atk:2, dmg:1}, prof:'martial', twoHanded:true, visualWeapon:'polearm/spear' },
    { name:'Battleaxe', icon:'🪓', prim:{dmg:2, crit:1}, visualWeapon:'sword/longsword' },
    { name:'Shortbow',  icon:'🏹', prim:{atk:1, dmg:1}, range:5, twoHanded:true, visualWeapon:'ranged/bow' },
    { name:'Longbow',   icon:'🏹', prim:{atk:2, dmg:2}, range:8, prof:'martial', twoHanded:true, visualWeapon:'ranged/bow' },
    { name:'Wand',      icon:'🪄', prim:{atk:1, int:1}, range:6, visualWeapon:'magic/wand' },
    { name:'Staff',     icon:'🪈', prim:{dmg:1, wis:1}, twoHanded:true, visualWeapon:'magic/wand' }
  ],
  shield: [
    { name:'Buckler',   icon:'🛡️', prim:{ac:1} },
    { name:'Kite Shield',icon:'🛡️', prim:{ac:2} },
    { name:'Tower Shield',icon:'🛡️', prim:{ac:2, hp:4}, prof:'medium' }
  ],
  helm: [
    { name:'Cap',       icon:'🪖', prim:{ac:1}, visualHelm:'cloth/leather_cap' },
    { name:'Circlet',   icon:'👑', prim:{int:1, wis:1}, visualHelm:'headband/thick' },
    { name:'Great Helm',icon:'🪖', prim:{ac:1, hp:3}, prof:'medium', visualHelm:'helmet/greathelm' }
  ],
  armor: [
    { name:'Torn Robe',   icon:'🥋', prim:{}, prof:'none', visualTorso:'clothes/longsleeve/longsleeve' },
    { name:'Peasant Shirt',icon:'👕', prim:{}, prof:'none', visualTorso:'clothes/shortsleeve/shortsleeve' },
    { name:'Robe',        icon:'🥋', prim:{ac:1, int:1}, prof:'none', visualTorso:'clothes/longsleeve/longsleeve' },
    { name:'Leather Armor',icon:'🧥', prim:{ac:2},        prof:'light', visualTorso:'armour/leather' },
    { name:'Chain Shirt', icon:'🧥', prim:{ac:3, hp:4},   prof:'medium', visualTorso:'chainmail' },
    { name:'Plate Armor', icon:'🛡️', prim:{ac:4, hp:8},   prof:'heavy', visualTorso:'armour/plate', visualLegs:'armour/plate' }
  ],
  gloves: [
    { name:'Gloves',      icon:'🧤', prim:{atk:1} },
    { name:'Gauntlets',   icon:'🧤', prim:{str:1} },
    { name:'Mage Gloves', icon:'🧤', prim:{int:1, wis:1} }
  ],
  boots: [
    { name:'Boots',       icon:'🥾', prim:{speed:0.1} },
    { name:'Swift Boots', icon:'🥾', prim:{speed:0.18, dex:1} },
    { name:'Greaves',     icon:'🥾', prim:{ac:1, hp:2} }
  ],
  ring: [
    { name:'Ring of Protection', icon:'💍', prim:{ac:1} },
    { name:'Ring of Might',      icon:'💍', prim:{str:1} },
    { name:'Ring of Precision',  icon:'💍', prim:{atk:1} },
    { name:'Ring of Vigor',      icon:'💍', prim:{hp:5} },
    { name:'Ring of the Adept',  icon:'💍', prim:{int:1, wis:1} }
  ],
  amulet: [
    { name:'Amulet of Health',   icon:'📿', prim:{con:1, hp:4} },
    { name:'Amulet of Fury',     icon:'📿', prim:{dmg:1} },
    { name:'Amulet of Warding',  icon:'📿', prim:{ac:1, hp:3} },
    { name:'Amulet of Insight',  icon:'📿', prim:{wis:1, heal:2} }
  ]
};
const BASE_SLOTS = Object.keys(BASES);

/* Minimum floor a base can start dropping on. Weak/basic gear drops from the
   start; stronger bases unlock as the party descends, so there's always a
   next upgrade to chase. (Starter items bypass this via makeStarterItem.) */
const BASE_MIN_FLOOR = {
  'Wand':2, 'Circlet':2, 'Gauntlets':2, 'Mage Gloves':2,
  'Longsword':3, 'Rapier':3, 'Mace':3, 'Battleaxe':3, 'Shortbow':3, 'Staff':3,
  'Kite Shield':3, 'Chain Shirt':3, 'Swift Boots':3, 'Greaves':3,
  'Ring of the Adept':3, 'Amulet of Health':3,
  'Great Helm':4,
  'Greatsword':5, 'Spear':5, 'Longbow':5, 'Tower Shield':5, 'Plate Armor':5
};

/* secondary affixes pulled for higher rarities */
const AFFIXES = [
  { key:'str', label:'of Strength',   b:{str:1} },
  { key:'dex', label:'of Agility',    b:{dex:1} },
  { key:'con', label:'of Endurance',  b:{con:1} },
  { key:'int', label:'of Intellect',  b:{int:1} },
  { key:'wis', label:'of Wisdom',     b:{wis:1} },
  { key:'atk', label:'of Accuracy',   b:{atk:1} },
  { key:'dmg', label:'of Wrath',      b:{dmg:1} },
  { key:'ac',  label:'of the Turtle', b:{ac:1} },
  { key:'hp',  label:'of the Bear',   b:{hp:5} },
  { key:'crit',label:'of Ruin',       b:{crit:1} }
];

let _uid = 1;
const pick = (arr, rng) => arr[Math.floor(rng()*arr.length)];

/* Highest rarity a floor allows, so power ramps with depth instead of a lucky
   floor-1 legendary trivialising early progression. */
function maxRarityIdx(floor){
  if(floor>=8) return 4;   // legendary
  if(floor>=5) return 3;   // epic
  if(floor>=3) return 2;   // rare
  return 1;                // floors 1–2: common / uncommon only
}
function rollRarity(floor, rng){
  const cap = maxRarityIdx(floor);
  const boost = 1 + floor*0.04;          // deeper floors tilt toward rarer loot
  let total=0; const w=[];
  for(let idx=0; idx<=cap; idx++){
    w[idx] = RARITIES[RARITY_ORDER[idx]].weight * Math.pow(boost, idx);
    total += w[idx];
  }
  let r = rng()*total;
  for(let idx=0; idx<=cap; idx++){ r -= w[idx]; if(r<=0) return RARITY_ORDER[idx]; }
  return 'common';
}

/* Combat bonuses (ac/atk/dmg/crit) are king in d20 math, so they scale in
   small integer steps by rarity tier — never by the raw rarity multiplier,
   which would make legendaries absurd (+5 AC on one piece). HP and gold value
   can scale more freely; ability scores cap at +2. */
const TIER = { common:0, uncommon:1, rare:2, epic:3, legendary:4 };
function scaleBonus(key, baseVal, tier, floor){
  switch(key){
    case 'ac':
    case 'atk':
    case 'dmg':
      return baseVal + Math.floor(tier/2) + Math.floor(floor/8);   // +0..+2 tier, slow floor creep
    case 'crit':
      return baseVal + (tier>=3 ? 1 : 0);
    case 'hp':
      return Math.round(baseVal * (1 + tier*0.6)) + Math.floor(floor/2)*2;
    case 'speed':
      return +(baseVal * (1 + tier*0.15)).toFixed(2);
    case 'heal':
      return baseVal + Math.floor(tier/2);
    case 'str': case 'dex': case 'con': case 'int': case 'wis': case 'cha':
      return baseVal + (tier>=2 ? 1 : 0);                          // +1, or +2 at rare+
    default:
      return baseVal;
  }
}

/** Generate one random item scaled to a dungeon floor. */
export function rollItem(floor, rng=Math.random, forceSlot=null){
  const slot = forceSlot || pick(BASE_SLOTS, rng);
  const avail = BASES[slot].filter(b => (BASE_MIN_FLOOR[b.name]||1) <= floor);
  const base = pick(avail.length ? avail : BASES[slot], rng);
  const rarityKey = rollRarity(floor, rng);
  const R = RARITIES[rarityKey];
  const tier = TIER[rarityKey];
  const bonuses = {};

  const addB = (src, isAffix) => {
    for(const k in src){
      const v = scaleBonus(k, src[k], isAffix ? Math.max(0,tier-1) : tier, floor);
      bonuses[k] = (bonuses[k]||0) + v;
    }
  };
  addB(base.prim, false);

  /* secondary affixes (one fewer effective tier so the base stays the star) */
  const usedAff = new Set(Object.keys(base.prim));
  let suffix = '';
  for(let i=0;i<R.affixes;i++){
    const options = AFFIXES.filter(a=>!usedAff.has(a.key));
    if(!options.length) break;
    const aff = pick(options, rng);
    usedAff.add(aff.key);
    addB(aff.b, true);
    if(!suffix) suffix = ' ' + aff.label;   // name after the first affix only
  }

  const prefix = R.name ? R.name + ' ' : '';
  const name = prefix + base.name + suffix;
  const value = Math.round((5 + floor*3) * R.mult * (1 + Object.keys(bonuses).length*0.3));

  return {
    id: 'i'+(_uid++), name, slot, icon: base.icon,
    rarity: rarityKey, color: R.color, bonuses,
    prof: base.prof || 'none', value, floor,
    visualTorso: base.visualTorso, visualLegs: base.visualLegs, visualWeapon: base.visualWeapon, visualHelm: base.visualHelm
  };
}

/** Create a tier-0 starter item by base name */
export function makeStarterItem(slot, baseName) {
  const base = BASES[slot].find(b => b.name === baseName);
  if (!base) return null;
  return {
    id: 'i'+(_uid++), name: base.name, slot, icon: base.icon,
    rarity: 'common', color: RARITIES.common.color, bonuses: {},
    prof: base.prof || 'none', value: 0, floor: 0,
    visualTorso: base.visualTorso, visualLegs: base.visualLegs, visualWeapon: base.visualWeapon, visualHelm: base.visualHelm
  };
}

/** Loot roll for a chest: 1–3 items, scaled to floor. */
export function rollChestLoot(floor, rng=Math.random){
  const n = 1 + (rng()<0.5?0:1) + (rng()<0.22?1:0);
  const items = [];
  for(let i=0;i<n;i++) items.push(rollItem(floor, rng));
  return items;
}

/** Human-readable one-line summary of an item's bonuses. */
export function bonusText(item){
  const order = ['ac','atk','dmg','hp','crit','heal','str','dex','con','int','wis','cha','speed'];
  const label = { ac:'AC', atk:'Hit', dmg:'Dmg', hp:'HP', crit:'Crit', heal:'Heal',
                  str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA', speed:'Speed' };
  const parts = [];
  for(const k of order){
    const v = item.bonuses[k];
    if(!v) continue;
    if(k==='speed') parts.push(`+${Math.round(v*100)}% Speed`);
    else if(k==='crit') parts.push(`+${v} Crit range`);
    else parts.push(`+${v} ${label[k]}`);
  }
  return parts.join(' · ');
}

/** Aggregate a hero's equipped items into a single bonuses object. */
export function aggregateEquipment(equipment){
  const total = {};
  for(const slot in equipment){
    const it = equipment[slot];
    if(!it) continue;
    for(const k in it.bonuses) total[k] = (total[k]||0) + it.bonuses[k];
  }
  return total;
}
