/**
 * Centralized status-effects engine — 5e SRD conditions + class buffs.
 *
 * Each effect is a keyed entry in the EFFECTS registry.  A unified
 * apply / has / clear / tick API stores timed effects on the entity
 * (`e._effects`), and `getEffectMods(e)` computes aggregate combat
 * modifiers (cached per-frame for performance).
 *
 * Saving throws and type-based condition immunities are also handled
 * here so every apply call can check them automatically.
 */

/* ── tiny dice helpers (avoid srd.js import to prevent circular deps) ── */
function roll(count, sides, bonus = 0) {
  let t = bonus;
  for (let i = 0; i < count; i++) t += Math.floor(Math.random() * sides) + 1;
  return t;
}

/* ================================================================
   EFFECTS registry
   Fields:
     label, category ('buff'|'debuff'|'dot'), color, float
     Mechanical modifiers consumed by getEffectMods():
       acBonus / acPenalty          flat AC delta
       atkBonus / atkPenalty        flat attack-roll delta
       dmgBonus                     flat damage bonus
       dmgMul / dmgTakenMul         damage dealt / taken multipliers
       speedMul                     movement-speed multiplier
       incapacitated                cannot act
       defAdvantage                 attackers gain advantage
       atkDisadvantage              disadvantage on its own attacks
       autoCritMelee                melee hits against it auto-crit
       cantAttackSource             cannot attack the charmer (effect.source)
       abilityDisadvantage          disadv on ability checks
       dexDisadvantage             disadv on DEX saves
       dotData / dotTickTimer       DoT handled outside getEffectMods
       wildShapeDmg / sacredDice / hexEffect / markEffect  special flags
   ================================================================ */
export const EFFECTS = {
  /* ── 5e Core Conditions (debuffs) ── */
  blinded: {
    label:'Blinded', category:'debuff', color:0x888899, float:'#888899',
    acPenalty:0, speedMul:1, dmgMul:1,
    atkDisadvantage:true, defAdvantage:true,
    desc:'Disadvantage on attacks. Enemies gain advantage to hit.'
  },
  charmed: {
    label:'Charmed', category:'debuff', color:0xe8a8ff, float:'#e8a8ff',
    acPenalty:0, speedMul:1, dmgMul:1,
    cantAttackSource:true,
    desc:'Cannot attack or harm the charmer.'
  },
  frightened: {
    label:'Frightened', category:'debuff', color:0x9b59b6, float:'#9b59b6',
    acPenalty:0, speedMul:1, dmgMul:1,
    atkDisadvantage:true,
    desc:'Disadvantage on attacks while source is visible.'
  },
  poisoned: {
    label:'Poisoned', category:'debuff', color:0x4cae4c, float:'#4cae4c',
    acPenalty:0, speedMul:1, dmgMul:1,
    atkDisadvantage:true, abilityDisadvantage:true,
    desc:'Disadvantage on attacks and ability checks.'
  },
  paralyzed: {
    label:'Paralyzed', category:'debuff', color:0x8090c0, float:'#8090c0',
    acPenalty:0, speedMul:0, dmgMul:1,
    incapacitated:true, defAdvantage:true, autoCritMelee:true,
    desc:'Cannot act. Melee hits are auto-crits.'
  },
  stunned: {
    label:'Stunned', category:'debuff', color:0xffd34a, float:'#ffd34a',
    acPenalty:0, speedMul:0, dmgMul:1,
    incapacitated:true, defAdvantage:true,
    desc:'Cannot act. Enemies gain advantage to hit.'
  },
  restrained: {
    label:'Restrained', category:'debuff', color:0xbfa060, float:'#bfa060',
    acPenalty:0, speedMul:0, dmgMul:1,
    atkDisadvantage:true, defAdvantage:true, dexDisadvantage:true,
    desc:'Speed zero. Disadvantage on attacks.'
  },
  slowed: {
    label:'Slowed', category:'debuff', color:0x8fd4e8, float:'#8fd4e8',
    acPenalty:2, speedMul:0.5, dmgMul:1,
    desc:'Half speed. -2 AC.'
  },
  burning: {
    label:'Burning', category:'dot', color:0xff7a30, float:'#ff7a30',
    acPenalty:0, speedMul:1, dmgMul:1,
    dotData:true,
    desc:'Takes fire damage each second.'
  },
  prone: {
    label:'Prone', category:'debuff', color:0xbfa060, float:'#bfa060',
    acPenalty:0, speedMul:0.3, dmgMul:1,
    atkDisadvantage:true,
    desc:'Crawling. Disadvantage on attacks.'
  },
  deafened: {
    label:'Deafened', category:'debuff', color:0x888899, float:'#888899',
    acPenalty:0, speedMul:1, dmgMul:1,
    desc:'No combat penalty in idle mode.'
  },
  incapacitated: {
    label:'Incapacitated', category:'debuff', color:0x999999, float:'#999999',
    acPenalty:0, speedMul:1, dmgMul:1,
    incapacitated:true,
    desc:'Cannot take actions or reactions.'
  },
  unconscious: {
    label:'Unconscious', category:'debuff', color:0x666688, float:'#666688',
    acPenalty:0, speedMul:0, dmgMul:1,
    incapacitated:true, defAdvantage:true, autoCritMelee:true,
    desc:'Cannot act. Melee hits auto-crit.'
  },

  /* ── Class / Spell Buffs ── */
  raging: {
    label:'Raging', category:'buff', color:0xff4020, float:'#ff6040',
    acBonus:2, speedMul:1, dmgMul:1,
    atkBonus:0, dmgBonus:2, dmgTakenMul:0.5,
    desc:'Half damage taken. +2 damage. +2 AC.'
  },
  hasted: {
    label:'Hasted', category:'buff', color:0xa0e0ff, float:'#a0e0ff',
    acBonus:2, speedMul:1.4, dmgMul:1,
    desc:'+40% speed. +2 AC.'
  },
  inspired: {
    label:'Inspired', category:'buff', color:0xe8a8ff, float:'#e8a8ff',
    acBonus:0, speedMul:1, dmgMul:1,
    blessDice:true,
    desc:'+1d4 to attack rolls (Bless / inspiration).'
  },
  shielded: {
    label:'Shielded', category:'buff', color:0x88aaff, float:'#88aaff',
    acBonus:5, speedMul:1, dmgMul:1,
    desc:'+5 AC.'
  },
  sacredWeapon: {
    label:'Sacred Weapon', category:'buff', color:0xffe08a, float:'#ffe08a',
    acBonus:0, speedMul:1, dmgMul:1,
    atkBonus:4, sacredDice:true,
    desc:'+4 to hit. +1d8 damage.'
  },
  bearTotem: {
    label:'Bear Totem', category:'buff', color:0xc08040, float:'#c08040',
    acBonus:0, speedMul:1, dmgMul:1,
    dmgTakenMul:0.5,
    desc:'Damage halved.'
  },
  wildShape: {
    label:'Wild Shape', category:'buff', color:0x6aaa4a, float:'#6aaa4a',
    acBonus:0, speedMul:1, dmgMul:1,
    wildShapeDmg:true,
    desc:'+2d6 melee damage.'
  },
  remarkableAthlete: {
    label:'Remarkable Athlete', category:'buff', color:0xaab4cc, float:'#aab4cc',
    acBonus:2, speedMul:1.1, dmgMul:1,
    desc:'+10% speed. +2 AC.'
  },
  phaseStep: {
    label:'Phase Step', category:'buff', color:0x8fd4e8, float:'#8fd4e8',
    acBonus:4, speedMul:1, dmgMul:1,
    desc:'+4 AC.'
  },

  /* ── Spell-dealt debuffs ── */
  weakenedDmg: {
    label:'Weakened', category:'debuff', color:0xd0a080, float:'#d0a080',
    acPenalty:0, speedMul:1, dmgMul:0.5,
    desc:'Deals half damage.'
  },
  baned: {
    label:'Baned', category:'debuff', color:0xd0a0ff, float:'#d0a0ff',
    acPenalty:0, speedMul:1, dmgMul:1,
    atkPenalty:3,
    desc:'-3 to attack rolls.'
  },
  faerieFire: {
    label:'Faerie Fired', category:'debuff', color:0xb08cff, float:'#b08cff',
    acPenalty:0, speedMul:1, dmgMul:1,
    defAdvantage:true,
    desc:'Enemies have advantage to hit.'
  },
  hexMarked: {
    label:'Hex', category:'debuff', color:0x9b59b6, float:'#9b59b6',
    acPenalty:0, speedMul:1, dmgMul:1,
    hexEffect:true,
    desc:'Takes +1d6 from caster.'
  },
  huntersMarked: {
    label:'Marked', category:'debuff', color:0x1abc9c, float:'#1abc9c',
    acPenalty:0, speedMul:1, dmgMul:1,
    markEffect:true,
    desc:'Takes +1d6 from ranger.'
  },
  deathWarded: {
    label:'Death Ward', category:'buff', color:0xffe08a, float:'#ffe08a',
    acBonus:0, speedMul:1, dmgMul:1,
    desc:'Protected: next fatal blow leaves you at 1 HP.'
  },
  bossWeakened: {
    label:'Weakened Foe', category:'debuff', color:0xff5a4a, float:'#ff7a6a',
    acPenalty:2, atkPenalty:2, speedMul:1, dmgMul:0.85,
    desc:'Boss is weakened: -2 AC, -2 atk, -15% dmg.'
  },
  wounded: {
    label:'Wounded', category:'dot', color:0xb03030, float:'#d04040',
    acPenalty:0, speedMul:1, dmgMul:1,
    dotData:true,
    desc:'Bleeding: loses HP each second.'
  },
};

/* ================================================================
   Type-based condition immunities (applied per-monster on spawn)
   Tags used: monster.type or monster.tags[] entries
   ================================================================ */
export const TYPE_IMMUNITIES = {
  undead: ['poisoned','charmed','frightened','unconscious'],
  construct: ['poisoned','charmed','frightened','blinded','deafened','stunned','paralyzed','unconscious'],
  elemental: ['poisoned','paralyzed','stunned','unconscious'],
  fiend: ['poisoned'],
  celestial: ['charmed'],
  plant: ['blinded','deafened','frightened','paralyzed','poisoned','stunned','unconscious'],
  ooze: ['blinded','charmed','deafened','frightened','paralyzed','prone','stunned','unconscious'],
  fey: ['poisoned'],
  dragon: [],
  giant: [],
  beast: [],
  humanoid: [],
  monstrosity: [],
  aberration: [],
};

/* ================================================================
   Public API
   ================================================================ */

/** Apply an effect to an entity.  Returns false if immune. */
export function applyEffect(e, key, opts = {}) {
  if (!e || !EFFECTS[key]) return false;

  /* type-based immunity */
  const dt = e.data || e;
  if (dt.type && _typeImm(dt.type, key)) return false;
  if (dt.tags && dt.tags.some(t => _typeImm(t, key))) return false;

  e._effects = e._effects || {};
  const dur = opts.duration || null;
  const until = dur != null ? (opts.elapsed || 0) + dur : null;

  /* prefer longer duration if already active */
  const existing = e._effects[key];
  if (existing && existing.until != null && until != null && until <= existing.until)
    return true;

  e._effects[key] = {
    applied: opts.elapsed || 0,
    until,
    source: opts.source || null,
    tag: opts.tag || null,
  };
  /* 5e repeat save: target re-rolls the save every `every` seconds ("at the
     end of each of its turns") and shakes the effect off on a success. */
  if (opts.repeatSave) {
    e._effects[key].repeatSave = opts.repeatSave;   // { ability, dc, every }
    e._effects[key].nextSave = (opts.elapsed || 0) + (opts.repeatSave.every || 6);
  }
  if (EFFECTS[key].dotData && opts.dotDmg != null) {
    e._effects[key].dotDmg = opts.dotDmg;
    e._effects[key].dotSrc = opts.source || null;
    e._effects[key].dotTick = 0;
  }
  if (e.data) e.data._effects = e._effects;
  e._effectCache = null;
  return true;
}

export function hasEffect(e, key) {
  return !!(e && e._effects && e._effects[key]);
}

export function getEffect(e, key) {
  return (e && e._effects && e._effects[key]) || null;
}

export function clearEffect(e, key) {
  if (!e || !e._effects || !e._effects[key]) return;
  delete e._effects[key];
  if (e.data) e.data._effects = e._effects;
  e._effectCache = null;
}

export function clearAllEffects(e) {
  if (!e) return;
  e._effects = {};
  if (e.data) e.data._effects = e._effects;
  e._effectCache = null;
}

/** Remove every effect whose stored `tag` matches (e.g. 'skill' boons/debuffs).
 *  Leaves class features and other sources intact. */
export function clearEffectsByTag(e, tag) {
  if (!e || !e._effects || !tag) return;
  let ch = false;
  for (const k of Object.keys(e._effects)) {
    if (e._effects[k].tag === tag) { delete e._effects[k]; ch = true; }
  }
  if (ch) {
    if (e.data) e.data._effects = e._effects;
    e._effectCache = null;
  }
}

/** Expire timed effects and roll repeat saves.  Call once per frame per active entity. */
export function tickEffects(e, elapsed) {
  if (!e || !e._effects) return;
  let ch = false;
  for (const k of Object.keys(e._effects)) {
    const eff = e._effects[k];
    if (eff.until != null && elapsed >= eff.until) {
      delete e._effects[k];
      ch = true;
      continue;
    }
    if (eff.repeatSave && elapsed >= eff.nextSave) {
      eff.nextSave = elapsed + (eff.repeatSave.every || 6);
      if (rollSave(e, eff.repeatSave.ability, eff.repeatSave.dc, { magic: true })) {
        delete e._effects[k];
        ch = true;
      }
    }
  }
  if (ch) {
    if (e.data) e.data._effects = e._effects;
    e._effectCache = null;
  }
}

/** Compute aggregate combat modifiers.  Result is cached per-frame. */
export function getEffectMods(e) {
  if (e._effectCache) return e._effectCache;
  const m = {
    acBonus:0, atkBonus:0, dmgBonus:0,
    speedMul:1, dmgTakenMul:1, dmgDealtMul:1,
    incapacitated:false, defAdvantage:false,
    atkDisadvantage:false, autoCritMelee:false,
    wildShapeDmg:false, sacredDice:false, blessDice:false,
    cantAttackSource:null,
  };
  if (!e._effects) { e._effectCache = m; return m; }
  for (const [k, eff] of Object.entries(e._effects)) {
    const d = EFFECTS[k]; if (!d) continue;
    m.acBonus += (d.acBonus||0) - (d.acPenalty||0);
    m.atkBonus += (d.atkBonus||0) - (d.atkPenalty||0);
    m.dmgBonus += d.dmgBonus||0;
    m.speedMul *= d.speedMul!=null ? d.speedMul : 1;
    m.dmgTakenMul *= d.dmgTakenMul!=null ? d.dmgTakenMul : 1;
    m.dmgDealtMul *= d.dmgMul!=null ? d.dmgMul : 1;
    if (d.incapacitated) m.incapacitated = true;
    if (d.defAdvantage) m.defAdvantage = true;
    if (d.atkDisadvantage) m.atkDisadvantage = true;
    if (d.autoCritMelee) m.autoCritMelee = true;
    if (d.wildShapeDmg) m.wildShapeDmg = true;
    if (d.sacredDice) m.sacredDice = true;
    if (d.blessDice) m.blessDice = true;
    if (d.cantAttackSource && eff.source) m.cantAttackSource = eff.source;
  }
  e._effectCache = m;
  return m;
}

/* ---------- Saving Throw ---------- */

/**
 * d20 + abilityMod vs dc, with 5e advantage/disadvantage.  Returns true on success.
 *
 * Heroes use their effective ability scores. Monsters (no effStats) get a
 * CR-scaled modifier so a dragon shrugs off Hold Monster far more often
 * than a goblin.
 *
 * opts: { adv: +1/-1/0, magic: true when the save is against a spell }
 */
export function rollSave(entity, ability, dc, opts = {}) {
  const data = entity.data || entity;
  let m = 0;
  if (data.saves && data.saves[ability] != null) {
    /* stat-block save proficiency: total bonus (ability mod + proficiency) */
    m = data.saves[ability];
  } else if (data.effStats && data.effStats[ability] != null) {
    m = Math.floor((data.effStats[ability] - 10) / 2);
  } else if (data.cr != null) {
    m = Math.max(0, Math.min(8, Math.floor(data.cr / 2)));
  }

  let adv = opts.adv || 0;
  /* restrained: disadvantage on DEX saves */
  if (ability === 'dex' && entity._effects) {
    for (const k in entity._effects) if (EFFECTS[k]?.dexDisadvantage) { adv -= 1; break; }
  }
  /* Gnome Cunning: advantage on INT/WIS/CHA saves against magic */
  if (opts.magic && data.raceKey === 'gnome' && ['int', 'wis', 'cha'].includes(ability)) {
    adv += 1;
  }

  const a = roll(1, 20);
  let d20 = a;
  if (adv) {
    const b = roll(1, 20);
    d20 = adv > 0 ? Math.max(a, b) : Math.min(a, b);
  }
  return d20 + m >= dc;
}

/* ---------- Internals ---------- */

function _typeImm(type, key) {
  const imm = TYPE_IMMUNITIES[type];
  return !!(imm && imm.includes(key));
}
