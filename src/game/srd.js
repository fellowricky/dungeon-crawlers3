/**
 * SRD 5.1 rules kit — ability scores, d20 combat math, classes, races,
 * monsters, XP thresholds. Mechanics from the Systems Reference Document 5.1
 * by Wizards of the Coast LLC, licensed under CC-BY-4.0.
 */
import {
  aggregateEquipment, PROF_RANK, makeStarterItem, attuneHeroGear,
  migrateItem, bondLegendaryOnEquip
} from './items.js';
import {
  featureBonuses, spellSlotsFor, seedNewHeroProgression, migrateProgression,
  applyLevelGrants, initProgressionFields, pendingChoiceCount, hasFeature
} from './features.js';

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

export const SKILLS = {
  athletics: { label: 'Athletics', ability: 'str' },
  acrobatics: { label: 'Acrobatics', ability: 'dex' },
  sleightOfHand: { label: 'Sleight of Hand', ability: 'dex' },
  stealth: { label: 'Stealth', ability: 'dex' },
  arcana: { label: 'Arcana', ability: 'int' },
  history: { label: 'History', ability: 'int' },
  investigation: { label: 'Investigation', ability: 'int' },
  nature: { label: 'Nature', ability: 'int' },
  religion: { label: 'Religion', ability: 'int' },
  animalHandling: { label: 'Animal Handling', ability: 'wis' },
  insight: { label: 'Insight', ability: 'wis' },
  medicine: { label: 'Medicine', ability: 'wis' },
  perception: { label: 'Perception', ability: 'wis' },
  survival: { label: 'Survival', ability: 'wis' },
  deception: { label: 'Deception', ability: 'cha' },
  intimidation: { label: 'Intimidation', ability: 'cha' },
  performance: { label: 'Performance', ability: 'cha' },
  persuasion: { label: 'Persuasion', ability: 'cha' }
};

/* proficiency bonus by level (SRD table) */
export const profBonus = lvl => 2 + Math.floor((lvl-1)/4);

/* XP needed to REACH each level (index = level) */
export const XP_TABLE = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000];
export const MAX_LEVEL = 10;

/* ---------------- races (SRD) ---------------- */
export const RACES = {
  human:      { label:'Human',    bonus:{str:1,dex:1,con:1,int:1,wis:1,cha:1}, speed:1.0, trait:'Versatile: +1 to every ability score.' },
  dwarf:      { label:'Hill Dwarf', bonus:{con:2,wis:1}, speed:0.9, hpPerLevel:1, trait:'Dwarven Toughness: +1 HP per level.' },
  elf:        { label:'High Elf', bonus:{dex:2,int:1}, speed:1.1, critFinesse:true, trait:'Keen Senses: Proficiency in Perception. Crits on 19–20 with ranged attacks.', skills: ['perception'] },
  halfling:   { label:'Lightfoot Halfling', bonus:{dex:2,cha:1}, speed:1.0, lucky:true, trait:'Lucky: rerolls natural 1s on attack rolls.' },
  halforc:    { label:'Half-Orc', bonus:{str:2,con:1}, speed:1.0, savageCrit:true, trait:'Savage Attacks: Proficiency in Intimidation. +1 damage die on melee crits.', skills: ['intimidation'] },
  dragonborn: { label:'Dragonborn', bonus:{str:2,cha:1}, speed:1.0, trait:'Draconic Ancestry: resistance to elemental damage.' },
  gnome:      { label:'Rock Gnome', bonus:{int:2,con:1}, speed:0.9, trait:'Gnome Cunning: +2 on saving throws against magic.' },
  halfelf:    { label:'Half-Elf', bonus:{cha:2,dex:1,con:1}, speed:1.0, trait:'Skill Versatility: Proficiency in 2 extra skills of choice.', skills: ['deception', 'persuasion'] },
  tiefling:   { label:'Tiefling', bonus:{cha:2,int:1}, speed:1.0, trait:'Hellish Resistance: +1 AC and fire resistance.' }
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
    ],
    skillChoices: {
      count: 2,
      list: ['athletics', 'acrobatics', 'history', 'insight', 'intimidation', 'perception', 'survival']
    }
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
    ],
    skillChoices: {
      count: 4,
      list: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleightOfHand', 'stealth']
    }
  },
  cleric: {
    label:'Cleric', color:0x5a8fe8, hitDie:8, armorProf:'medium',
    statPriority:['wis','con','str','cha','dex','int'],
    baseAC:16, acDesc:'Scale mail + shield',
    attack:{ name:'Sacred Flame', ability:'wis', dmg:[1,8], range:6, melee:false, cantripScale:true },
    feature:'Cure Wounds: heals the most wounded ally (slots recharge on short/long rest).',
    healer:true,
    skills:[
      { key:'blessedHealer', name:'Blessed Healer', max:5, desc:'+3 healing per rank.',        b:{heal:3} },
      { key:'divineFavor',   name:'Divine Favor',   max:5, desc:'+1 Sacred Flame damage per rank.', b:{dmg:1} },
      { key:'sanctuary',     name:'Sanctuary',      max:3, desc:'+1 AC per rank.',              b:{ac:1} },
      { key:'devotion',      name:'Devotion',       max:4, desc:'+5 max HP per rank.',          b:{hp:5} }
    ],
    skillChoices: {
      count: 2,
      list: ['history', 'insight', 'medicine', 'persuasion', 'religion']
    }
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
    ],
    skillChoices: {
      count: 2,
      list: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion']
    }
  },
  barbarian: {
    label:'Barbarian', color:0xe74c3c, hitDie:12, armorProf:'medium',
    statPriority:['str','con','dex','wis','cha','int'],
    baseAC:12, acPlusDex:true, acDesc:'Unarmored Defense',
    attack:{ name:'Greatsword', ability:'str', dmg:[2,6], range:1.6, melee:true },
    feature:'Rage: enter Rage when hurt (+2 melee dmg, +2 AC, halve incoming dmg).',
    skills:[
      { key:'savageStrikes', name:'Savage Strikes', max:5, desc:'+1 attack damage per rank.', b:{dmg:1} },
      { key:'unarmoredToughness', name:'Toughness', max:5, desc:'+6 max HP per rank.', b:{hp:6} },
      { key:'dangerSense', name:'Danger Sense', max:5, desc:'+1 AC per rank.', b:{ac:1} },
      { key:'furiousAtk', name:'Furious Attack', max:3, desc:'+1 to attack rolls per rank.', b:{atk:1} }
    ],
    skillChoices: {
      count: 2,
      list: ['animalHandling', 'athletics', 'intimidation', 'nature', 'perception', 'survival']
    }
  },
  bard: {
    label:'Bard', color:0xe8a8ff, hitDie:8, armorProf:'light',
    statPriority:['cha','dex','con','wis','str','int'],
    baseAC:11, acPlusDex:true, acDesc:'Leather Armor + Dex',
    attack:{ name:'Rapier', ability:'cha', dmg:[1,8], range:1.5, melee:true },
    feature:'Bardic Inspiration: heals/inspires allies (+3 to attack rolls).',
    healer:true,
    skills:[
      { key:'loreMaster', name:'Lore Master', max:5, desc:'+1 to attack rolls per rank.', b:{atk:1} },
      { key:'inspirePower', name:'Inspiring Voice', max:5, desc:'+1 healing per rank.', b:{heal:1} },
      { key:'defensiveInsp', name:'Defensive Riffs', max:5, desc:'+1 AC per rank.', b:{ac:1} },
      { key:'hearty', name:'Hearty', max:4, desc:'+5 max HP per rank.', b:{hp:5} }
    ],
    skillChoices: {
      count: 3,
      list: ['athletics', 'acrobatics', 'sleightOfHand', 'stealth', 'arcana', 'history', 'investigation', 'nature', 'religion', 'animalHandling', 'insight', 'medicine', 'perception', 'survival', 'deception', 'intimidation', 'performance', 'persuasion']
    }
  },
  druid: {
    label:'Druid', color:0x2ecc71, hitDie:8, armorProf:'medium',
    statPriority:['wis','con','dex','int','cha','str'],
    baseAC:12, acPlusDex:true, acDesc:'Leather Shield + Hide',
    attack:{ name:'Produce Flame', ability:'wis', dmg:[1,8], range:6, melee:false, cantripScale:true },
    feature:'Wild Shape: transforms into a Bear (+20 temp HP, 2d6 claws).',
    healer:true,
    skills:[
      { key:'natureWrath', name:'Nature Wrath', max:5, desc:'+1 spell damage per rank.', b:{dmg:1} },
      { key:'wildVitality', name:'Wild Vitality', max:5, desc:'+6 max HP per rank.', b:{hp:6} },
      { key:'barkskin', name:'Barkskin', max:5, desc:'+1 AC per rank.', b:{ac:1} },
      { key:'naturalHealer', name:'Natural Healer', max:3, desc:'+3 healing per rank.', b:{heal:3} }
    ],
    skillChoices: {
      count: 2,
      list: ['arcana', 'animalHandling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival']
    }
  },
  monk: {
    label:'Monk', color:0x3498db, hitDie:8, armorProf:'none',
    statPriority:['dex','wis','con','str','cha','int'],
    baseAC:12, acPlusDex:true, acDesc:'Unarmored Defense',
    attack:{ name:'Unarmed Strike', ability:'dex', dmg:[1,6], range:1.4, melee:true },
    feature:'Flurry of Blows: spend Ki to attack three times in one turn.',
    skills:[
      { key:'martialArts', name:'Martial Arts', max:5, desc:'+1 attack damage per rank.', b:{dmg:1} },
      { key:'unarmoredDef', name:'Unarmored Defense', max:5, desc:'+1 AC per rank.', b:{ac:1} },
      { key:'fastMovement', name:'Fast Movement', max:4, desc:'+8% move speed per rank.', b:{speed:0.08} },
      { key:'kiVitality', name:'Ki Vitality', max:5, desc:'+5 max HP per rank.', b:{hp:5} }
    ],
    skillChoices: {
      count: 2,
      list: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth']
    }
  },
  paladin: {
    label:'Paladin', color:0xf1c40f, hitDie:10, armorProf:'heavy',
    statPriority:['str','cha','con','wis','dex','int'],
    baseAC:16, acDesc:'Chain mail + shield',
    attack:{ name:'Longsword', ability:'str', dmg:[1,8], range:1.5, melee:true },
    feature:'Divine Smite: once per short rest, deal +2d8 radiant damage.',
    skills:[
      { key:'divineSmitePower', name:'Divine Smite', max:5, desc:'+1 attack damage per rank.', b:{dmg:1} },
      { key:'auraOfProtection', name:'Aura of Protection', max:5, desc:'+1 AC per rank.', b:{ac:1} },
      { key:'layOnHands', name:'Lay on Hands', max:5, desc:'+3 healing per rank.', b:{heal:3} },
      { key:'holyToughness', name:'Holy Toughness', max:5, desc:'+6 max HP per rank.', b:{hp:6} }
    ],
    skillChoices: {
      count: 2,
      list: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion']
    }
  },
  ranger: {
    label:'Ranger', color:0x1abc9c, hitDie:10, armorProf:'medium',
    statPriority:['dex','wis','con','str','cha','int'],
    baseAC:12, acPlusDex:true, acDesc:'Leather Armor + Dex',
    attack:{ name:'Longbow', ability:'dex', dmg:[1,8], range:8, melee:false },
    feature:'Favored Enemy: deal +2 extra damage against all monsters.',
    skills:[
      { key:'archeryStyle', name:'Archery Style', max:5, desc:'+1 to attack rolls per rank.', b:{atk:1} },
      { key:'huntersPrey', name:'Hunters Prey', max:5, desc:'+1 weapon damage per rank.', b:{dmg:1} },
      { key:'natureSurvival', name:'Nature Survival', max:5, desc:'+5 max HP per rank.', b:{hp:5} },
      { key:'elusive', name:'Elusive', max:3, desc:'+1 AC per rank.', b:{ac:1} }
    ],
    skillChoices: {
      count: 3,
      list: ['animalHandling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival']
    }
  },
  sorcerer: {
    label:'Sorcerer', color:0xe67e22, hitDie:6, armorProf:'none',
    statPriority:['cha','con','dex','int','wis','str'],
    baseAC:10, acPlusDex:true, acDesc:'No armor + Dex',
    attack:{ name:'Fire Bolt', ability:'cha', dmg:[1,10], range:8, melee:false, cantripScale:true },
    feature:'Tides of Chaos: once per short rest, gain advantage (+5 to hit).',
    blaster:true,
    skills:[
      { key:'draconicMagic', name:'Draconic Magic', max:5, desc:'+1 spell damage per rank.', b:{dmg:1} },
      { key:'sorcerousAtk', name:'Sorcerous Attack', max:5, desc:'+1 to attack rolls per rank.', b:{atk:1} },
      { key:'mageShield', name:'Mage Shield', max:3, desc:'+1 AC per rank.', b:{ac:1} },
      { key:'bloodlineToughness', name:'Bloodline Toughness', max:5, desc:'+4 max HP per rank.', b:{hp:4} }
    ],
    skillChoices: {
      count: 2,
      list: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion']
    }
  },
  warlock: {
    label:'Warlock', color:0x9b59b6, hitDie:8, armorProf:'light',
    statPriority:['cha','con','dex','wis','int','str'],
    baseAC:11, acPlusDex:true, acDesc:'Leather Armor + Dex',
    attack:{ name:'Eldritch Blast', ability:'cha', dmg:[1,10], range:8, melee:false, cantripScale:true },
    feature:'Eldritch Blast: fires 1 beam of force (1d10), +1 beam at level 5.',
    blaster:true,
    skills:[
      { key:'eldritchInvoc', name:'Eldritch Invocation', max:5, desc:'+1 spell damage per rank.', b:{dmg:1} },
      { key:'shadowArmor', name:'Shadow Armor', max:5, desc:'+1 AC per rank.', b:{ac:1} },
      { key:'fiendResilience', name:'Fiendish Vigor', max:5, desc:'+5 max HP per rank.', b:{hp:5} },
      { key:'dreadAtk', name:'Dread Attack', max:3, desc:'+1 to attack rolls per rank.', b:{atk:1} }
    ],
    skillChoices: {
      count: 2,
      list: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion']
    }
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
      active:{ key:'rallyingCry', name:'Rallying Cry', recharge:'long',
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
      active:{ key:'preserveLife', name:'Preserve Life', recharge:'long',
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
  },
  barbarian: {
    berserker: { label:'Berserker', srd:true,
      passive:'Frenzy Strikes: +1 melee damage.', pb:{dmg:1},
      active:{ key:'frenzy', name:'Frenzy', recharge:'short',
        desc:'Enter a frenzied rage, instantly attacking again on hit.' } },
    totem: { label:'Totem Warrior',
      passive:'Aspect of Bear: +1 AC.', pb:{ac:1},
      active:{ key:'bearTotem', name:'Bear Totem', recharge:'short',
        desc:'Summon the bear spirit, halving all incoming damage for 8 seconds.' } }
  },
  bard: {
    lore: { label:'College of Lore', srd:true,
      passive:'Peerless Skill: +1 to attack rolls.', pb:{atk:1},
      active:{ key:'cuttingWords', name:'Cutting Words', recharge:'short',
        desc:'Lower an elite or boss\'s AC by 4 and speed by 30% for 6 seconds.' } },
    valor: { label:'College of Valor',
      passive:'Combat Inspiration: +1 AC.', pb:{ac:1},
      active:{ key:'combatInspiration', name:'Combat Inspiration', recharge:'short',
        desc:'Play a battle song, granting all allies +3 to hit for 8 seconds.' } }
  },
  druid: {
    land: { label:'Circle of the Land', srd:true,
      passive:'Natural Recovery: +1 spell attack.', pb:{atk:1},
      active:{ key:'entangle', name:'Entangle', recharge:'short',
        desc:'Roots all nearby enemies for 4 seconds, dealing 1d6 damage.' } },
    moon: { label:'Circle of the Moon',
      passive:'Primal Strike: +1 claw damage.', pb:{dmg:1},
      active:{ key:'wildShape', name:'Wild Shape', recharge:'short',
        desc:'Transform into a Bear, gaining +20 temp HP and dealing 2d6 claws for 8s.' } }
  },
  monk: {
    openhand: { label:'Open Hand', srd:true,
      passive:'Fast Movement: +10% speed.', pb:{speed:0.10},
      active:{ key:'quiveringPalm', name:'Quivering Palm', recharge:'short',
        desc:'Deliver a vibrations strike to a boss/elite dealing 4d10 damage.' } },
    shadow: { label:'Way of Shadow',
      passive:'Cloak of Shadows: +1 AC.', pb:{ac:1},
      active:{ key:'shadowStep', name:'Shadow Step', recharge:'short',
        desc:'Teleport behind a foe, gaining +4 to hit and +2d6 damage.' } }
  },
  paladin: {
    devotion: { label:'Oath of Devotion', srd:true,
      passive:'Sacred Strike: +1 to attack rolls.', pb:{atk:1},
      active:{ key:'sacredWeapon', name:'Sacred Weapon', recharge:'short',
        desc:'Bless your blade, adding +4 to hit and +1d8 radiant damage for 8s.' } },
    vengeance: { label:'Oath of Vengeance',
      passive:'Relentless Avenger: +1 weapon damage.', pb:{dmg:1},
      active:{ key:'vowOfEnmity', name:'Vow of Enmity', recharge:'short',
        desc:'Swear an oath, gaining advantage (+5 to hit) against elite/boss targets.' } }
  },
  ranger: {
    hunter: { label:'Hunter', srd:true,
      passive:'Giant Killer: +1 weapon damage.', pb:{dmg:1},
      active:{ key:'colossusSlayer', name:'Colossus Slayer', recharge:'short',
        desc:'Deals +1d8 extra damage if the target is already below max HP.' } },
    beastmaster: { label:'Beast Master',
      passive:'Beast Defense: +1 AC.', pb:{ac:1},
      active:{ key:'companionStrike', name:'Companion Strike', recharge:'short',
        desc:'Summon a wolf companion to bite the target for 1d8+3 damage.' } }
  },
  sorcerer: {
    draconic: { label:'Draconic Blood', srd:true,
      passive:'Draconic Resilience: +1 AC, +4 max HP.', pb:{ac:1, hp:4},
      active:{ key:'dragonBreath', name:'Dragon Breath', recharge:'short',
        desc:'Breathe fire in a cone, dealing 3d6 damage to all nearby enemies.' } },
    wildmagic: { label:'Wild Magic',
      passive:'Chaos Shield: +1 spell attack.', pb:{atk:1},
      active:{ key:'wildSurge', name:'Wild Magic Surge', recharge:'short',
        desc:'Release a surge of wild magic that heals all allies for 1d10 + level.' } }
  },
  warlock: {
    fiend: { label:'The Fiend', srd:true,
      passive:'Dark One\'s Blessing: +1 spell damage.', pb:{dmg:1},
      active:{ key:'fiendishBlessing', name:'Fiendish Blessing', recharge:'short',
        desc:'Gain +10 temporary HP when starting combat.' } },
    archfey: { label:'The Archfey',
      passive:'Beguiling Defences: +1 AC.', pb:{ac:1},
      active:{ key:'feyPresence', name:'Fey Presence', recharge:'short',
        desc:'Charm all nearby enemies, preventing them from attacking for 3 seconds.' } }
  }
};
export const RECHARGE_LABEL = { short:'1 / short rest', long:'1 / long rest', day:'1 / long rest', slot:'spell slots' };
export function subclassOf(h){
  return h.subclass ? SUBCLASSES[h.classKey][h.subclass] : null;
}
export function needsSubclass(h){
  return h.level >= SUBCLASS_UNLOCK && !h.subclass;
}
export function pickSubclass(h, key){
  if(h.subclass || h.level < SUBCLASS_UNLOCK || !SUBCLASSES[h.classKey][key]) return false;
  h.subclass = key;
  h.abilityUsed = { short:false, long:false };
  initProgressionFields(h);
  /* if the hero is already past milestone levels, grant those passives now */
  if(h.level >= 6) applyLevelGrants(h, 6, null, { autosOnly: true });
  if(h.level >= 10) applyLevelGrants(h, 10, null, { autosOnly: true });
  recalc(h);
  if(h.slotsMax) h.slots = h.slotsMax;
  return true;
}

/* cantrips add a damage die at character levels 5 (SRD cantrip scaling) */
export const cantripDice = lvl => lvl >= 5 ? 2 : 1;

/* ---------------- monsters (SRD stat blocks) ----------------
   tier 1–3 come from the generator's spawn data; boss is its own pool.
   scale = visual size multiplier. */
export const MONSTERS = {
  1: [
    { name:'Giant Rat', ac:12, hp:[2,6],  atk:4, dmg:[1,4,2],  xp:25,  color:0x8a7a6a, scale:0.6, speed:3.4, sprite:'animals/rat.png' },
    { name:'Grey Rat', ac:11, hp:[1,6],  atk:3, dmg:[1,4,1],  xp:15,  color:0x7a7a7a, scale:0.55, speed:3.6, sprite:'animals/grey_rat.png' },
    { name:'Giant Bat', ac:13, hp:[1,8],  atk:4, dmg:[1,4,1],  xp:20,  color:0x5a4a3a, scale:0.7, speed:3.8, sprite:'animals/giant_bat.png' },
    { name:'Goblin',    ac:15, hp:[2,6],  atk:4, dmg:[1,6,2],  xp:50,  color:0x6a8a4a, scale:0.75, speed:3.2, sprite:'goblin.png' },
    { name:'Skeleton',  ac:13, hp:[2,8],  atk:4, dmg:[1,6,2],  xp:50,  color:0xcabfa8, scale:0.85, speed:3.0, sprite:'undead/skeletons/skeleton_humanoid_large.png' },
    { name:'Zombie',    ac:8,  hp:[3,8],  atk:3, dmg:[1,6,1],  xp:50,  color:0x5a7a5a, scale:0.9, speed:2.0, sprite:'undead/ghoul.png' },
    { name:'Giant Centipede', ac:12, hp:[2,6], atk:4, dmg:[1,4,2], xp:30, color:0xaa5a3a, scale:0.7, speed:3.2, sprite:'animals/giant_centipede.png' },
    { name:'Adder', ac:13, hp:[1,8], atk:4, dmg:[1,4,1], xp:25, color:0x3a8a3a, scale:0.6, speed:3.5, sprite:'animals/adder.png' }
  ],
  2: [
    { name:'Orc',        ac:13, hp:[2,8,6],  atk:5, dmg:[1,12,3], xp:100, color:0x4a6a3a, scale:0.95, speed:3.2, sprite:'orc.png' },
    { name:'Gnoll',      ac:14, hp:[3,8,3],  atk:4, dmg:[1,8,2],  xp:100, color:0x8a6a4a, scale:0.95, speed:3.1, sprite:'gnoll.png' },
    { name:'Hobgoblin',  ac:18, hp:[2,8,2],  atk:3, dmg:[1,8,1],  xp:100, color:0x9a5a3a, scale:0.9, speed:3.0, sprite:'hobgoblin.png' },
    { name:'Giant Spider',ac:14, hp:[4,8,4], atk:5, dmg:[1,8,3],  xp:200, color:0x3a3a4a, scale:0.9, speed:3.6, sprite:'animals/spider.png' },
    { name:'Wolf Spider', ac:14, hp:[5,8,5], atk:5, dmg:[1,8,4],  xp:200, color:0x4a4a4a, scale:0.95, speed:3.7, sprite:'animals/wolf_spider.png' },
    { name:'Ghoul',      ac:12, hp:[5,8],    atk:4, dmg:[2,6,2],  xp:200, color:0x7a8a6a, speed:3.2, scale:0.9, sprite:'undead/ghoul.png' },
    { name:'Mummy',      ac:11, hp:[4,8,8],  atk:4, dmg:[1,10,2], xp:150, color:0xdedebe, scale:0.9, speed:2.4, sprite:'undead/mummy.png' },
    { name:'Warg',       ac:13, hp:[4,8,8],  atk:4, dmg:[2,6,1],  xp:150, color:0x5a5a5a, scale:0.9, speed:3.6, sprite:'animals/warg.png' },
    { name:'Crocodile',  ac:15, hp:[3,10,9], atk:4, dmg:[1,10,2], xp:150, color:0x3a5a3a, scale:1.0, speed:2.8, sprite:'animals/crocodile.png' }
  ],
  3: [
    { name:'Bugbear',    ac:16, hp:[5,8,5],   atk:4, dmg:[2,8,2],  xp:200, color:0x8a6a3a, scale:1.1, speed:3.0, sprite:'orc_warrior.png' },
    { name:'Werewolf',   ac:12, hp:[9,8,18],  atk:4, dmg:[2,6,2],  xp:700, color:0x6a5a4a, scale:1.05, speed:3.6, sprite:'shapeshifter.png' },
    { name:'Ogre',       ac:11, hp:[7,10,21], atk:6, dmg:[2,8,4],  xp:450, color:0x9a8a5a, scale:1.35, speed:2.6, sprite:'ogre.png' },
    { name:'Minotaur',   ac:14, hp:[9,10,27], atk:6, dmg:[2,12,4], xp:700, color:0x7a4a3a, scale:1.2, speed:3.2, sprite:'minotaur.png' },
    { name:'Deep Troll', ac:14, hp:[8,10,32], atk:6, dmg:[2,6,4],  xp:700, color:0x3a6a4a, scale:1.35, speed:2.8, sprite:'deep_troll.png' },
    { name:'Manticore',  ac:13, hp:[6,10,12], atk:5, dmg:[2,4,2],  xp:450, color:0xaa6a4a, scale:1.25, speed:3.3, sprite:'manticore.png' },
    { name:'Polar Bear', ac:12, hp:[5,10,20], atk:5, dmg:[2,6,2],  xp:400, color:0xeeeeee, scale:1.2, speed:3.2, sprite:'animals/polar_bear.png' },
    { name:'Wight',      ac:14, hp:[6,8,6],   atk:4, dmg:[1,8,2],  xp:400, color:0x8a9a8a, scale:1.0, speed:2.8, sprite:'undead/wight.png' },
    { name:'Vampire',    ac:15, hp:[8,8,8],   atk:6, dmg:[1,10,3], xp:600, color:0xaaaaff, scale:1.05, speed:3.4, sprite:'undead/vampire.png' }
  ],
  boss: [
    { name:'Ettin',        ac:12, hp:[10,10,30], atk:7, dmg:[2,8,5],  xp:1100, color:0xaa7a4a, scale:1.7, speed:2.6, sprite:'ettin.png' },
    { name:'Young Dragon', ac:17, hp:[11,10,33], atk:7, dmg:[2,10,4], xp:1800, color:0xb04030, scale:1.8, speed:3.2, sprite:'dragons/dragon.png' },
    { name:'Troll',        ac:15, hp:[8,10,40],  atk:7, dmg:[2,6,4],  xp:1800, color:0x4a8a6a, scale:1.6, speed:3.0, sprite:'troll.png' },
    { name:'Stone Giant',  ac:17, hp:[11,12,44], atk:9, dmg:[3,8,6], xp:2900, color:0x8a8a9a, scale:1.9, speed:2.8, sprite:'stone_giant.png' }
  ]
};

export const MONSTER_THEMES = [
  {
    name: 'Goblinoid',
    monsters: {
      1: ['Goblin'],
      2: ['Hobgoblin'],
      3: ['Bugbear']
    }
  },
  {
    name: 'Undead',
    monsters: {
      1: ['Skeleton', 'Zombie'],
      2: ['Ghoul', 'Mummy'],
      3: ['Wight', 'Vampire']
    }
  },
  {
    name: 'Beasts & Spiders',
    monsters: {
      1: ['Giant Rat', 'Grey Rat', 'Giant Bat', 'Giant Centipede', 'Adder'],
      2: ['Giant Spider', 'Wolf Spider', 'Warg', 'Crocodile'],
      3: ['Werewolf', 'Manticore', 'Polar Bear']
    }
  },
  {
    name: 'Horde',
    monsters: {
      1: ['Goblin'],
      2: ['Orc', 'Gnoll'],
      3: ['Ogre', 'Minotaur', 'Deep Troll']
    }
  }
];

/* dungeonLevel scaling: extra HP dice + attack/AC bump so SRD blocks stay
   threatening as the party levels. */
export function spawnMonster(tier, dungeonLevel, rngPick, allowedNames = null){
  let pool = MONSTERS[tier] || MONSTERS[1];
  if (allowedNames) {
    const filtered = pool.filter(spec => allowedNames.includes(spec.name));
    if (filtered.length > 0) pool = filtered;
  }
  const spec = pool[Math.floor(rngPick()*pool.length)];
  const lvlB = Math.max(0, dungeonLevel-1);
  /* gentle depth scaling — the old rates outpaced hero growth and made
     every floor a meat grinder */
  /* +1 hit die across the board: fights last longer (slower combat), while
     the slow monster attack cadence keeps incoming damage in check */
  let hp = roll(spec.hp[0] + 1 + Math.floor(lvlB* (tier==='boss' ? 1.5 : 0.5)), spec.hp[1], spec.hp[2]||0);
  let atk = spec.atk + Math.floor(lvlB/3);
  /* training-wheels boss: SRD boss blocks are deadly to a level-2 party,
     so the first floors' boss fights at reduced strength */
  if(tier==='boss' && dungeonLevel<=2){ hp = Math.round(hp*0.65); atk -= 2; }
  return {
    name: spec.name, ac: spec.ac + Math.floor(lvlB/4), maxHp: hp, hp,
    atk,
    dmg: spec.dmg, xp: Math.round(spec.xp * (1 + lvlB*0.25)),
    color: spec.color, scale: spec.scale, speed: spec.speed,
    sprite: spec.sprite,          // per-monster DCSS art (mesh falls back to orc.png without it)
    gold: Math.round((spec.xp/10) * (1 + lvlB*0.3) * (0.6+Math.random()*0.8))
  };
}

/* ---------------- hero construction ---------------- */
export const HERO_NAMES = ['Bram','Kira','Aldric','Wren','Doric','Sariel','Toby','Magda','Fenn','Isolde','Garrick','Nyx','Piotr','Vessa','Odo','Lyra'];

export function getDefaultProficiencies(raceKey, classKey) {
  const list = [];
  const race = RACES[raceKey];
  if (race && race.skills) {
    list.push(...race.skills);
  }
  // Standard starting skills for each class
  const classProfs = {
    fighter: ['athletics', 'intimidation'],
    rogue: ['acrobatics', 'sleightOfHand', 'stealth', 'deception'],
    cleric: ['insight', 'medicine', 'religion'],
    wizard: ['arcana', 'history', 'investigation']
  };
  const defaults = classProfs[classKey] || [];
  defaults.forEach(p => {
    if (!list.includes(p)) list.push(p);
  });
  return list;
}

export function makeHero(name, raceKey, classKey, baseStats, visual, chosenProficiencies = null){
  const race = RACES[raceKey], cls = CLASSES[classKey];
  const stats = {};
  for(const ab of ABILITIES) stats[ab] = (baseStats[ab]||8) + (race.bonus[ab]||0);

  const proficiencies = chosenProficiencies || getDefaultProficiencies(raceKey, classKey);

  const h = {
    name, raceKey, classKey, stats, visual, level:1, xp:0,
    equipment:{}, skills:{}, pendingAbility:0, pendingSkill:0,
    subclass:null, abilityUsed:{ short:false, long:false },
    secondWind: !!cls.secondWind,
    kills:0, downs:0, dmgDealt:0,
    proficiencies,
    features:[], feats:[], knownSpells:[], pendingChoices:[],
    subclassMilestones:[], fightingStyle:null, spellCd:{},
    progressionVersion:0
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
  } else if (classKey === 'barbarian') {
    h.equipment.weapon = makeStarterItem('weapon', 'Greatsword');
    h.equipment.armor = makeStarterItem('armor', 'Leather Armor');
  } else if (classKey === 'bard') {
    h.equipment.weapon = makeStarterItem('weapon', 'Rapier');
    h.equipment.armor = makeStarterItem('armor', 'Leather Armor');
  } else if (classKey === 'druid') {
    h.equipment.weapon = makeStarterItem('weapon', 'Staff');
    h.equipment.armor = makeStarterItem('armor', 'Robe');
  } else if (classKey === 'monk') {
    h.equipment.weapon = makeStarterItem('weapon', 'Shortsword');
    h.equipment.armor = makeStarterItem('armor', 'Torn Robe');
  } else if (classKey === 'paladin') {
    h.equipment.weapon = makeStarterItem('weapon', 'Longsword');
    h.equipment.armor = makeStarterItem('armor', 'Chain Shirt');
    h.equipment.offhand = makeStarterItem('shield', 'Buckler');
  } else if (classKey === 'ranger') {
    h.equipment.weapon = makeStarterItem('weapon', 'Shortbow');
    h.equipment.armor = makeStarterItem('armor', 'Leather Armor');
  } else if (classKey === 'sorcerer') {
    h.equipment.weapon = makeStarterItem('weapon', 'Wand');
    h.equipment.armor = makeStarterItem('armor', 'Robe');
  } else if (classKey === 'warlock') {
    h.equipment.weapon = makeStarterItem('weapon', 'Wand');
    h.equipment.armor = makeStarterItem('armor', 'Robe');
  }

  seedNewHeroProgression(h);
  recalc(h);
  h.hp = h.maxHp;
  return h;
}

/* Fill in any fields a legacy save is missing, then recompute derived stats. */
export function normalizeHero(h){
  if(!h.equipment) h.equipment = {};
  if(!h.skills) h.skills = {};
  if(!h.visual) {
    h.visual = { gender:'male', hair:'bangs/adult', skinColor:'#ffccaa', hairColor:'#663311' };
  } else {
    if (!h.visual.skinColor) h.visual.skinColor = '#ffccaa';
    if (!h.visual.hairColor) h.visual.hairColor = '#663311';
    delete h.visual.torso;
    delete h.visual.legs;
    delete h.visual.weapon;
  }
  if(h.pendingAbility === undefined) h.pendingAbility = 0;
  if(h.pendingSkill === undefined) h.pendingSkill = 0;
  if(h.subclass === undefined) h.subclass = null;
  if(!h.abilityUsed) h.abilityUsed = { short:false, long:false };
  if(h.abilityUsed.day !== undefined) {
    h.abilityUsed.long = !!(h.abilityUsed.long || h.abilityUsed.day);
    delete h.abilityUsed.day;
  }
  if(h.abilityUsed.long === undefined) h.abilityUsed.long = false;
  
  if (!h.proficiencies) {
    h.proficiencies = getDefaultProficiencies(h.raceKey, h.classKey);
  }

  migrateProgression(h);

  /* migrate equipped gear to ilvl / perk schema; bond legendaries to level */
  for(const slot of Object.keys(h.equipment)){
    if(h.equipment[slot]) {
      migrateItem(h.equipment[slot]);
      bondLegendaryOnEquip(h.equipment[slot], h.level);
    }
  }

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
  /* legendaries bond to hero level for effective bonuses */
  const eq = aggregateEquipment(h.equipment, h.level);
  const sk = skillBonuses(h);
  const sc = h.subclass ? SUBCLASSES[h.classKey][h.subclass] : null;
  const ft = featureBonuses(h);
  const sum = k => (eq[k]||0) + (sk[k]||0) + ((sc && sc.pb && sc.pb[k])||0) + (ft[k]||0);

  /* effective ability scores (base already includes racial + spent points) */
  const eff = {};
  for(const ab of ABILITIES) eff[ab] = h.stats[ab] + sum(ab);
  h.effStats = eff;

  const conM = mod(eff.con);
  /* HP: full hit die at L1, average thereafter, + CON each level + race + bonuses.
     The flat +8 "adventurer's grit" keeps level-1 heroes from being one-shot
     by a lucky crit (SRD level 1 is glass); it fades to noise at high level. */
  const avg = Math.ceil((cls.hitDie+1)/2);
  h.maxHp = cls.hitDie + 8 + (h.level-1)*avg + h.level*(conM + (race.hpPerLevel||0)) + sum('hp');
  h.maxHp = Math.max(1, h.maxHp);
  if(h.hp !== undefined) h.hp = Math.min(h.hp, h.maxHp);

  const dexAC = cls.acPlusDex ? Math.min(mod(eff.dex), h.classKey==='rogue'?99:2) : 0;
  /* barbarian / monk unarmored: add CON or WIS if no medium/heavy armor — simplified: base already set */
  h.ac = cls.baseAC + dexAC + sum('ac');
  if(h.classKey === 'barbarian') h.ac = Math.max(h.ac, 10 + mod(eff.dex) + mod(eff.con) + sum('ac'));
  if(h.classKey === 'monk') h.ac = Math.max(h.ac, 10 + mod(eff.dex) + mod(eff.wis) + sum('ac'));

  h.atkBonus = profBonus(h.level) + mod(eff[cls.attack.ability]) + sum('atk');
  h.dmgBonus = sum('dmg');
  h.healBonus = sum('heal');
  h.speedMult = race.speed * (1 + sum('speed'));

  /* crit threshold: 20 by default; racial keen senses + gear/skill widen it */
  let crit = 20 - sum('crit');
  if(race.critFinesse && !cls.attack.melee) crit -= 1;
  h.critRange = Math.max(18, crit);

  if(cls.healer) h.healSlotsMax = Math.max(1, mod(eff.wis) + (h.classKey === 'bard' ? mod(eff.cha) : 0));
  /* lay on hands pool */
  if(hasFeature(h, 'layOnHands')) {
    h.layOnHandsMax = 5 * h.level;
    if(h.layOnHands === undefined) h.layOnHands = h.layOnHandsMax;
    h.layOnHands = Math.min(h.layOnHands, h.layOnHandsMax);
  }

  /* spell-slot pool: class caster progression, plus subclass slot actives */
  let slots = spellSlotsFor(h.classKey, h.level);
  if(sc && sc.active && sc.active.recharge === 'slot') {
    slots = Math.max(slots, 1 + Math.floor(h.level / 3));
  }
  if(hasFeature(h, 'fontOfMagic')) slots += 1;
  h.slotsMax = slots;
  if(h.slots === undefined || h.slots > h.slotsMax) h.slots = h.slotsMax;

  /* keep secondWind flag in sync with features */
  if(hasFeature(h, 'secondWind') || cls.secondWind) h.secondWind = true;

  // Recalculate derived 5e skills
  h.skillsDerived = {};
  for (const [key, skill] of Object.entries(SKILLS)) {
    const abiMod = mod(eff[skill.ability]);
    const isProf = h.proficiencies && h.proficiencies.includes(key);
    h.skillsDerived[key] = abiMod + (isProf ? profBonus(h.level) : 0);
  }

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

/* level-up: HP grows via recalc; class progression grants features / choices
   (ASI or feat, spells, fighting styles) instead of a free ability point every level. */
export function grantXp(h, amount, log){
  h.xp += amount;
  while(h.level < MAX_LEVEL && h.xp >= XP_TABLE[h.level+1]){
    h.level++;
    applyLevelGrants(h, h.level, log, { autosOnly: false });
    if(log) log(`⭐ ${h.name} reaches level ${h.level}!`, 'level');
    /* rare+ gear attunes; legendaries bond to the new level */
    attuneHeroGear(h, log);
    recalc(h);
    h.hp = h.maxHp;                       // full heal on level, like a rest
    if(log && h.level===SUBCLASS_UNLOCK && !h.subclass)
      log(`🌟 ${h.name} may choose a subclass! (Level Up menu)`, 'level');
    if(log && pendingChoiceCount(h) > 0)
      log(`📜 ${h.name} has feature choices to make (Level Up menu).`, 'level');
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
  return (h.pendingAbility||0) + (h.pendingSkill||0) + (needsSubclass(h)?1:0) + pendingChoiceCount(h);
}

/* whether a hero can equip an item given class armor proficiency */
export function canEquip(h, item){
  return PROF_RANK[item.prof||'none'] <= PROF_RANK[CLASSES[h.classKey].armorProf||'none'];
}
