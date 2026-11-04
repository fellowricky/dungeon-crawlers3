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
 *
 * ── TIME BASE: the combat clock, not the wall clock ──────────────────
 * Every `duration:` in this codebase is expressed in **5e seconds**, where
 * one round = `ROUND_SECONDS` (6). `duration:60` means "1 minute" = 10 rounds,
 * `duration:6` means "1 round".
 *
 * Those numbers are measured against `game.fxNow` — the *combat clock* owned
 * by initiative.js — and **never** against `game.elapsed` (real seconds).
 * `fxNow` advances only while an initiative order is running, by
 * `ROUND_SECONDS / order.length` per spotlight, so one full pass of the
 * turn order = exactly one round = 6 fx-seconds regardless of how fast the
 * turn-based engine actually resolves those turns in real time.
 *
 * Two consequences that the game design leans on:
 *   1. Out of combat the clock is frozen, so a buff earned from a skill
 *      challenge does not burn down while the party walks around — its timer
 *      starts at the top of the next fight.
 *   2. `clearCombatEffects` wipes everything at the end of a fight, so
 *      nothing but the explicitly `persist`-flagged effects survive a combat.
 */

/** 5e round length in "in-game" seconds — the unit every `duration:` uses. */
export const ROUND_SECONDS = 6;

/** A duration in combat-clock seconds -> the whole number of rounds it lasts.
 *  Always rounds UP and never below 1: a rule that lasts "a bit of a round"
 *  does not exist in a turn-based game — it lasts the round. */
export function wholeRounds(sec) {
  if (!(sec > 0) || !isFinite(sec)) return 0;
  return Math.max(1, Math.ceil(sec / ROUND_SECONDS - 1e-9));
}
/** Snap a duration to whole rounds (Infinity and non-positive pass through). */
export function roundDuration(sec) {
  return (sec > 0 && isFinite(sec)) ? wholeRounds(sec) * ROUND_SECONDS : sec;
}

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
       dotData                      DoT handled outside getEffectMods
       wildShapeDmg / sacredDice / hexEffect / markEffect  special flags
     Lifetime:
       persist                      survives clearCombatEffects (until a rest)
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
  mocked: {
    label:'Mocked', category:'debuff', color:0xf040c0, float:'#f040c0',
    acPenalty:0, speedMul:1, dmgMul:1,
    atkDisadvantage:true,
    desc:'Rattled by an insult: disadvantage on attacks.'
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
    desc:'Takes fire damage each round.'
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
  /* Silence: no verbal components, so no spells or cantrips. Checked by
     resolveSpell / manualPerformSpell (heroes), the cantrip attack profile,
     and tryMonsterCycleAbility (monster casters). */
  silenced: {
    label:'Silenced', category:'debuff', color:0x7a7a9a, float:'#9a9ab8',
    acPenalty:0, speedMul:1, dmgMul:1,
    noSpells:true,
    desc:'Cannot cast spells or cantrips.'
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
  petrified: {
    label:'Petrified', category:'debuff', color:0x8f8f9a, float:'#b8b8c4',
    acPenalty:0, speedMul:0, dmgMul:1,
    incapacitated:true, defAdvantage:true, autoCritMelee:true,
    desc:'Turned to stone. Cannot act. Melee hits auto-crit.'
  },
  enlarged: {
    label:'Enlarged', category:'buff', color:0xffb45a, float:'#ffb45a',
    acBonus:0, speedMul:1, dmgMul:1.25,
    dmgBonus:2,
    desc:'Magically enlarged: +25% damage dealt, +2 damage.'
  },
  dreadAmbush: {
    label:'Dread Ambush', category:'buff', color:0x4a6a5a, float:'#7fb89a',
    acBonus:0, speedMul:1, dmgMul:1,
    extraAttack:1,
    desc:'Umbral Sight: an extra attack in the opening round.'
  },
  invisible: {
    label:'Invisible', category:'buff', color:0xaabbcc, float:'#aabbcc',
    acBonus:0, speedMul:1, dmgMul:1,
    invisible:true,
    desc:'Hidden from enemies until it attacks.'
  },
  giantStrength: {
    label:'Giant Strength', category:'buff', color:0xc9a24a, float:'#c9a24a',
    acBonus:0, speedMul:1, dmgMul:1,
    atkBonus:2, dmgBonus:2,
    desc:'Potent strength: +2 to hit and +2 damage.'
  },

  /* ── Class / Spell Buffs ── */
  raging: {
    label:'Raging', category:'buff', color:0xff4020, float:'#ff6040',
    acBonus:2, speedMul:1, dmgMul:1,
    atkBonus:0, dmgBonus:2, dmgTakenMul:0.5,
    desc:'Half damage taken. +2 damage. +2 AC.'
  },
  /* The Haste spell: doubled speed, +2 AC and one extra weapon attack per
     turn (extraAttack is read by heroCombat's attack count). */
  hasted: {
    label:'Hasted', category:'buff', color:0xa0e0ff, float:'#a0e0ff',
    acBonus:2, speedMul:2, dmgMul:1,
    extraAttack:1,
    desc:'Double speed. +2 AC. One extra weapon attack each turn.'
  },
  /* Sentinel: an opportunity-attack hit drops the target's speed to 0. */
  rooted: {
    label:'Rooted', category:'debuff', color:0xbfa060, float:'#bfa060',
    acPenalty:0, speedMul:0, dmgMul:1,
    desc:'Speed 0 until the end of the round.'
  },
  /* A Dash (Cunning Action, Step of the Wind): doubled movement, nothing else. */
  dashing: {
    label:'Dashing', category:'buff', color:0xa0e0ff, float:'#a0e0ff',
    acBonus:0, speedMul:2, dmgMul:1,
    desc:'Double speed this turn.'
  },
  /* Bardic Inspiration: the inspiration die is stored on the effect record
     (`die`, d6 by default) and added to the next attack roll, then spent. */
  inspired: {
    label:'Inspired', category:'buff', color:0xe8a8ff, float:'#e8a8ff',
    acBonus:0, speedMul:1, dmgMul:1,
    inspireDie:true, consumeOnAttack:true,
    desc:'Add an inspiration die to your next attack roll.'
  },
  /* Bless: +1d4 on attack rolls and saving throws (blessDice is read by
     heroAttackRoll and rollSaveDetail). */
  blessed: {
    label:'Blessed', category:'buff', color:0xffe08a, float:'#ffe08a',
    acBonus:0, speedMul:1, dmgMul:1,
    blessDice:true,
    desc:'+1d4 to attack rolls and saving throws.'
  },
  /* Regenerate: 1 HP at the start of every round (tickHeroDots). */
  regenerating: {
    label:'Regenerating', category:'buff', color:0x6ae06a, float:'#6ae06a',
    acBonus:0, speedMul:1, dmgMul:1,
    regenPerRound:1,
    desc:'Regains 1 HP every round.'
  },
  /* Mirror Image: `images` on the record counts the duplicates left. A blow
     that would land is rolled against the images first (mirrorImageIntercept). */
  mirrorImages: {
    label:'Mirror Image', category:'buff', color:0xc0d8ff, float:'#c0d8ff',
    acBonus:0, speedMul:1, dmgMul:1,
    desc:'Illusory duplicates draw attacks away from you.'
  },
  foresight: {
    label:'Foresight', category:'buff', color:0xffd9a0, float:'#ffd9a0',
    acBonus:3, speedMul:1, dmgMul:1,
    atkAdvantage:1,
    /* Deliberately NOT consumeOnAttack — unlike Bardic Inspiration this is a
       9th-level effect that stands for the whole fight. */
    desc:'Advantage on attack rolls. +3 AC from glimpsing what comes next.'
  },
  shielded: {
    label:'Shielded', category:'buff', color:0x88aaff, float:'#88aaff',
    acBonus:5, speedMul:1, dmgMul:1,
    desc:'+5 AC.'
  },
  /* Channel Divinity: Sacred Weapon — +CHA modifier to attack rolls (carried
     per-instance as `atkBonus` on the record) and the weapon counts as magical. */
  sacredWeapon: {
    label:'Sacred Weapon', category:'buff', color:0xffe08a, float:'#ffe08a',
    acBonus:0, speedMul:1, dmgMul:1,
    magicWeapon:true,
    desc:'Your Charisma modifier to attack rolls; the weapon is magical.'
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
  shieldOfFaith: {
    label:'Shield of Faith', category:'buff', color:0xa0c0ff, float:'#a0c0ff',
    acBonus:2, speedMul:1, dmgMul:1,
    desc:'+2 AC (shimmering shield of protective energy).'
  },
  /* Monk Patient Defense — the Dodge action. This game has no "attackers roll
     with disadvantage" channel, so Dodge is abstracted as a strong short AC
     buff (harder to hit for a beat), consistent with Bear Totem / Phase Step. */
  patientDefense: {
    label:'Dodge', category:'buff', color:0xa0c0ff, float:'#a0c0ff',
    acBonus:5, speedMul:1, dmgMul:1,
    desc:'Dodging: +5 AC until your next turn.'
  },
  /* Monster enrage / killbuff buff (gnoll Rampage, flesh-golem Berserk,
     orc-warlord Bloodlust). Pure offense: no AC change so it doesn't
     double as a defensive cooldown. */
  bloodlust: {
    label:'Bloodlust', category:'buff', color:0xff5040, float:'#ff5040',
    acBonus:0, speedMul:1.3, dmgMul:1,
    dmgBonus:2,
    desc:'+30% speed. +2 damage.'
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
  guided: {
    label:'Guided', category:'debuff', color:0xffd23c, float:'#ffd23c',
    acPenalty:0, speedMul:1, dmgMul:1,
    defAdvantage:true,
    desc:'Glittering with mystical light: attackers have advantage.'
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
    desc:'Bleeding: loses HP each round.'
  },
  /* Polymorph (on a foe): a harmless beast with its own tiny HP pool
     (m._polyHp, see damageMonster). Cannot attack; the first real hit ends it. */
  polymorphed: {
    label:'Sheep', category:'debuff', color:0xf0f0f0, float:'#f0f0f0',
    acPenalty:0, speedMul:0.6, dmgMul:1,
    incapacitated:true,
    desc:'Turned into a sheep. Harmless until struck.'
  },
  /* Banishment: gone from the field entirely — see game.banishMonster. */
  banished: {
    label:'Banished', category:'debuff', color:0x8090c0, float:'#a0b0e0',
    acPenalty:0, speedMul:0, dmgMul:1,
    incapacitated:true,
    desc:'Sent to another plane. Cannot act or be targeted.'
  },
  /* Dominate Monster: the creature changes sides for the duration. The flag is
     read by monster_ai (who it fights), initiative (_side 'ally', so it does
     not keep a fight alive) and hero targeting (they leave it be). The caster
     wrapper is kept on m.dominatedBy; see game.dominateMonster. */
  dominated: {
    label:'Dominated', category:'debuff', color:0xc084fc, float:'#c084fc',
    acPenalty:0, speedMul:1, dmgMul:1,
    dominated:true,
    desc:'Fights for the caster.'
  },
  /* Crusader's Mantle: the caster's allies add 1d4 radiant to weapon hits —
     rolled in heroCombat next to Sacred Weapon's die. */
  crusadersMantle: {
    label:"Crusader's Mantle", category:'buff', color:0xffd700, float:'#ffd700',
    acBonus:0, speedMul:1, dmgMul:1,
    desc:'+1d4 radiant damage on weapon hits.'
  },
  /* Protection from Evil: the ward that makes the spell's "immune to charm
     and fear" line real — applyEffect refuses those two keys while it holds. */
  warded: {
    label:'Warded', category:'buff', color:0xffe08a, float:'#ffe08a',
    acBonus:0, speedMul:1, dmgMul:1,
    immuneCharmFear:true,
    desc:'Immune to charmed and frightened.'
  },
  /* Potion of Heroism: Bless's +1d4 on attacks (the tempHp is granted by the
     potion itself, see _usePotion). */
  heroism: {
    label:'Heroic', category:'buff', color:0xffd27a, float:'#ffd27a',
    acBonus:0, speedMul:1, dmgMul:1,
    blessDice:true,
    desc:'Heroic: +1d4 to attack rolls.'
  },
  /* Potion of Resistance, flattened: this game has no per-type resistance
     channel on heroes, so it shaves a quarter off everything instead. */
  resistant: {
    label:'Resistant', category:'buff', color:0x9fd0b0, float:'#9fd0b0',
    acBonus:0, speedMul:1, dmgMul:1,
    dmgTakenMul:0.75,
    desc:'Resistant: takes 25% less damage.'
  },
  magicWeapon: {
    label:'Magic Weapon', category:'buff', color:0xb08cff, float:'#b08cff',
    acBonus:0, atkBonus:1, dmgBonus:1, speedMul:1, dmgMul:1,
    magicWeapon:true,
    desc:'Weapon is magical: +1 to hit/damage, bypasses nonmagical resistance.'
  },
  barkskin: {
    label:'Barkskin', category:'buff', color:0x6aaa4a, float:'#6aaa4a',
    acBonus:0, speedMul:1, dmgMul:1,
    acFloor:16,
    desc:'AC cannot go below 16.'
  },

  /* ── Monster-ability debuffs (persist until a rest — applied with no
        duration + tag:'rest'; cleared in rest.js partyShortRest/LongRest) ── */
  drained: {
    label:'Drained', category:'debuff', color:0x6a3080, float:'#b070d0',
    acPenalty:0, speedMul:1, dmgMul:1,
    stacking:true, maxHpDrainPerStack:5, persist:true,
    desc:'Life force drained: -5 max HP per stack until a rest.'
  },
  corroded: {
    label:'Corroded', category:'debuff', color:0xc08040, float:'#d0a060',
    acPenalty:0, speedMul:1, dmgMul:1,
    stacking:true, acPenaltyPerStack:1, persist:true,
    desc:'Armor corroded: -1 AC per stack until a rest.'
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

/**
 * Apply an effect to an entity.  Returns false if immune.
 *
 * @param {object} e     hero/monster wrapper
 * @param {string} key   EFFECTS key
 * @param {object} opts
 *   duration  lifetime in 5e seconds (6 = one round). Omit for indefinite.
 *   elapsed   **combat-clock** reading to measure `duration` from — pass
 *             `game.fxNow`, never `game.elapsed`. See the time-base note at
 *             the top of this file.
 *   source, tag, repeatSave, dotDmg  as before.
 */
export function applyEffect(e, key, opts = {}) {
  if (!e || !EFFECTS[key]) return false;

  /* type-based immunity */
  const dt = e.data || e;
  if (dt.type && _typeImm(dt.type, key)) return false;
  if (dt.tags && dt.tags.some(t => _typeImm(t, key))) return false;
  /* per-monster statblock condition immunity (case-insensitive match against
     the monster's condImmune array — e.g. skeleton carries "Poisoned"). */
  const condImmune = dt.statblock?.condImmune;
  if (condImmune && condImmune.length && condImmune.some(ci => ci.toLowerCase() === key)) return false;
  /* spell-granted immunity (Protection from Evil's ward) */
  if ((key === 'charmed' || key === 'frightened') && e._effects?.warded) return false;

  e._effects = e._effects || {};
  /* Every effect lasts a whole number of rounds. Callers pass combat-clock
     seconds; anything that is not already a multiple of ROUND_SECONDS (old
     wall-clock values in data, a x1.5 crit bonus) is rounded UP here so no
     effect can expire part-way through a round. */
  const dur = opts.duration ? roundDuration(opts.duration) : null;
  const until = dur != null ? (opts.elapsed || 0) + dur : null;

  /* stacking effects (corroded / drained): re-application adds a stack */
  const existing = e._effects[key];
  if (EFFECTS[key].stacking && existing) {
    existing.stacks = (existing.stacks || 1) + 1;
    if (until != null && (existing.until == null || until > existing.until)) existing.until = until;
    e._effectCache = null;
    if (e.data) e.data._effects = e._effects;
    return true;
  }

  /* prefer longer duration if already active */
  if (existing && existing.until != null && until != null && until <= existing.until)
    return true;

  e._effects[key] = {
    applied: opts.elapsed || 0,
    until,
    source: opts.source || null,
    tag: opts.tag || null,
    stacks: EFFECTS[key].stacking ? 1 : undefined,
  };
  /* Per-instance numbers (Mirror Image's image count, Bardic Inspiration's
     die, Sacred Weapon's CHA bonus) ride on the record. */
  if (opts.data) Object.assign(e._effects[key], opts.data);
  /* 5e repeat save: target re-rolls the save every `every` seconds ("at the
     end of each of its turns") and shakes the effect off on a success. */
  if (opts.repeatSave) {
    e._effects[key].repeatSave = opts.repeatSave;   // { ability, dc, every }
    e._effects[key].nextSave = (opts.elapsed || 0) + (opts.repeatSave.every || 6);
  }
  /* any effect can carry a DoT payload (burning, wounded, poison bites,
     swallow/engulf acid on restrained…) — ticked by tickHeroDots (heroes) */
  if (opts.dotDmg != null) {
    e._effects[key].dotDmg = opts.dotDmg;
    e._effects[key].dotSrc = opts.source || null;
    /* dotClock = combat-clock reading of the last pulse; tickHeroDots fires one
       pulse per ROUND_SECONDS from here. */
    e._effects[key].dotClock = opts.elapsed || 0;
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

/**
 * Wipe every combat-scoped effect from an entity — the end-of-fight reset.
 *
 * Buffs and debuffs live for one encounter and one encounter only: whatever
 * the party banked from a skill challenge, whatever a caster stacked up, and
 * whatever the monsters landed on the party all evaporate when the last
 * aggroed monster dies. Only effects flagged `persist` in the registry
 * (drained / corroded — "until a rest" monster abilities) or explicitly
 * tagged `'rest'` survive; those are rest.js's business.
 *
 * Returns the number of effects removed.
 */
export function clearCombatEffects(e) {
  if (!e || !e._effects) return 0;
  let n = 0;
  for (const k of Object.keys(e._effects)) {
    if (EFFECTS[k]?.persist || e._effects[k].tag === 'rest') continue;
    delete e._effects[k];
    n++;
  }
  if (n) {
    if (e.data) e.data._effects = e._effects;
    e._effectCache = null;
  }
  return n;
}

/** Expire timed effects and roll repeat saves.  Call once per frame per active entity.
 *
 *  `now` is the **combat clock** (`game.fxNow`), not the wall clock. Because
 *  that clock is frozen outside combat, this is a no-op between fights — which
 *  is what keeps a skill-challenge boon banked until the next encounter. No
 *  separate "pause" bookkeeping is needed (an earlier `opts.combatActive` flag
 *  did that job against the wall clock and has been removed). */
export function tickEffects(e, now) {
  if (!e || !e._effects) return;
  let ch = false;
  for (const k of Object.keys(e._effects)) {
    const eff = e._effects[k];
    if (eff.until != null && now >= eff.until) {
      delete e._effects[k];
      ch = true;
      continue;
    }
    if (eff.repeatSave && now >= eff.nextSave) {
      eff.nextSave = now + (eff.repeatSave.every || ROUND_SECONDS);
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
    atkDisadvantage:false, atkAdvantage:0, autoCritMelee:false,
    wildShapeDmg:false, sacredDice:false, blessDice:false,
    cantAttackSource:null, acFloor:0, magicWeapon:false,
    invisible:false, extraAttack:0, regenPerRound:0,
  };
  if (!e._effects) { e._effectCache = m; return m; }
  for (const [k, eff] of Object.entries(e._effects)) {
    const d = EFFECTS[k]; if (!d) continue;
    /* stacking penalties (corroded: -1 AC per stack) */
    if (d.acPenaltyPerStack) m.acBonus -= d.acPenaltyPerStack * (eff.stacks || 1);
    m.acBonus += (d.acBonus||0) - (d.acPenalty||0);
    m.atkBonus += (d.atkBonus||0) - (d.atkPenalty||0) + (eff.atkBonus||0);
    if (d.extraAttack) m.extraAttack += d.extraAttack;
    if (d.regenPerRound) m.regenPerRound += d.regenPerRound;
    m.dmgBonus += d.dmgBonus||0;
    m.speedMul *= d.speedMul!=null ? d.speedMul : 1;
    m.dmgTakenMul *= d.dmgTakenMul!=null ? d.dmgTakenMul : 1;
    m.dmgDealtMul *= d.dmgMul!=null ? d.dmgMul : 1;
    if (d.acFloor) m.acFloor = Math.max(m.acFloor, d.acFloor);
    if (d.magicWeapon) m.magicWeapon = true;
    if (d.incapacitated) m.incapacitated = true;
    if (d.defAdvantage) m.defAdvantage = true;
    if (d.atkDisadvantage) m.atkDisadvantage = true;
    if (d.atkAdvantage) m.atkAdvantage += d.atkAdvantage;
    if (d.autoCritMelee) m.autoCritMelee = true;
    if (d.wildShapeDmg) m.wildShapeDmg = true;
    if (d.sacredDice) m.sacredDice = true;
    if (d.blessDice) m.blessDice = true;
    if (d.cantAttackSource && eff.source) m.cantAttackSource = eff.source;
    if (d.invisible) m.invisible = true;
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
/* Full roll breakdown — the raw d20, the save modifier, and the total — so the
   combat log can show "DEX save: 14 vs DC 15 — fail". rollSave wraps this and
   returns just the pass/fail boolean for the many call sites that only need it. */
/** The flat modifier `entity` adds to a saving throw of `ability` (stat mod +
 *  proficiency where it has it) — no dice, no advantage. Shared by the real
 *  roll below and the AI's expected-damage estimates, so the two agree. */
export function saveModifier(entity, ability) {
  const data = entity.data || entity;
  let m = 0;
  if (data.effStats && data.effStats[ability] != null) {
    const statMod = Math.floor((data.effStats[ability] - 10) / 2);
    const prof = data.statblock?.prof || Math.max(2, Math.floor((data.cr || 1) / 4) + 2);
    const isProf = (data.saves && data.saves[ability] != null && data.saves[ability] > statMod) || (data.statblock?.saves && data.statblock.saves.includes(ability));
    m = statMod + (isProf ? prof : 0);
    if (data.saves && data.saves[ability] != null) m = Math.max(m, data.saves[ability]);
  } else if (data.saves && data.saves[ability] != null) {
    m = data.saves[ability];
  } else if (data.cr != null) {
    m = Math.max(0, Math.min(8, Math.floor(data.cr / 2)));
  }
  return m;
}

export function rollSaveDetail(entity, ability, dc, opts = {}) {
  const data = entity.data || entity;
  let m = saveModifier(entity, ability);

  let adv = opts.adv || 0;
  /* restrained: disadvantage on DEX saves */
  if (ability === 'dex' && entity._effects) {
    for (const k in entity._effects) if (EFFECTS[k]?.dexDisadvantage) { adv -= 1; break; }
  }
  /* Gnome Cunning: advantage on INT/WIS/CHA saves against magic */
  if (opts.magic && data.raceKey === 'gnome' && ['int', 'wis', 'cha'].includes(ability)) {
    adv += 1;
  }
  /* Magic Resistance (SRD trait): advantage on saving throws vs spells & magic */
  if (opts.magic && data.magicResistance) adv += 1;
  /* Bless: +1d4 on saving throws as well as attacks */
  if (entity._effects) {
    for (const k in entity._effects) if (EFFECTS[k]?.blessDice) { m += roll(1, 4); break; }
  }
  /* Shield Master: +2 on DEX saves against spells while holding a shield */
  if (ability === 'dex' && opts.magic && data.feats && data.feats.includes('shieldMaster')
      && data.equipment?.offhand?.slot === 'shield') m += 2;
  if (opts.bonus) m += opts.bonus;

  const a = roll(1, 20);
  let d20 = a;
  if (adv) {
    const b = roll(1, 20);
    d20 = adv > 0 ? Math.max(a, b) : Math.min(a, b);
  }
  const total = d20 + m;
  return { saved: total >= dc, d20, mod: m, total, dc };
}

export function rollSave(entity, ability, dc, opts = {}) {
  return rollSaveDetail(entity, ability, dc, opts).saved;
}

/* ---------- Internals ---------- */

function _typeImm(type, key) {
  const imm = TYPE_IMMUNITIES[type];
  return !!(imm && imm.includes(key));
}
