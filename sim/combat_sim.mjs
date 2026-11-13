/**
 * Headless, turn-based combat model for balance testing.
 *
 * The real game combat (src/game/combat.js) is a real-time, spatial, THREE.js-
 * coupled system — not runnable headlessly without the whole render/AI/loop
 * stack. This module instead abstracts the SPATIAL/timing layer (positions,
 * pathfinding, cooldown clocks) into clean rounds, while reusing the game's
 * AUTHORITATIVE damage math so the numbers stay honest:
 *
 *   - heroDamage()      — dice, ability mod, crit doubling, cantrip scaling,
 *                         savage crit, gear/skill/subclass flat damage bonus
 *   - featBonusDamage() — GWM / Sharpshooter / etc. conditional feat damage
 *   - featExtraAttacks()— feat-granted bonus strikes
 *   - h.critRange / h.atkProf / h.effStats / h.weaponProfile — from recalc()
 *
 * On top of that it hand-models the high-impact class levers the game applies
 * inside combat.js (extra attacks, sneak attack, rage, divine smite, favored
 * enemy, second wind, action surge, flurry, healer casting, a few conditional
 * subclass procs). THIS TABLE is the one place to extend as the game grows —
 * see FEATURE_LAYER notes inline.
 *
 * Monster offense mirrors monster_ai.js: d20 + monster.atk vs hero AC, crit on
 * a natural 20, damage = roll(dice, sides, bonus) with dice doubled on a crit.
 */
import {
  CLASSES, RACES, mod, roll, d as die, d20Roll,
  heroDamage, pickAttackProfile, subclassOf, spawnMonster, crForDungeonLevel,
} from '../src/game/srd.js';
import { hasFeature, featBonusDamage, totalSlots } from '../src/game/features.js';
/* featExtraAttacks left features.js when feat bonus attacks became bonus actions
   (featBonusActionAttack); the abstract model just counts none. */
const featExtraAttacks = () => 0;
import { perkMag } from '../src/game/items.js';

const ROUND_CAP = 300;          // safety net against un-winnable stalemates
const SNEAK_DICE_SIDES = 6;
const SPELL_SAVE_HALF_CHANCE = 0.4;   // abstract monster save-for-half probability

/* ------------------------------------------------------------------ */
/* Damage-spell table — dice mirrored from spells.js cast() bodies.     */
/* This is the caster fidelity layer: leveled slot spells the blasters/  */
/* healers actually throw. Keys match SPELL_POOLS ids. Extend as spells  */
/* are added to spells.js. `hits` = multi-roll (rays/darts), aoe = hits  */
/* several foes (save-for-half), save = single-target save-for-half.     */
/* ------------------------------------------------------------------ */
export const SPELL_DAMAGE = {
  magicMissile:      { level: 1, dice: [1, 4], darts: true },              // 3+ darts, auto-hit
  chaosBolt:         { level: 1, dice: [2, 8] },
  guidingBolt:       { level: 1, dice: [4, 6] },
  inflictWounds:     { level: 1, dice: [3, 10] },
  thunderwave:       { level: 1, dice: [2, 8], aoe: true, save: true },
  armsOfHadar:       { level: 1, dice: [2, 6], aoe: true, save: true },
  dragonBreathSpell: { level: 1, dice: [3, 6], aoe: true, save: true },
  scorchingRay:      { level: 2, dice: [2, 6], hits: 3 },
  shatter:           { level: 2, dice: [3, 8], aoe: true, save: true },
  acidArrow:         { level: 2, dice: [4, 4] },
  moonbeam:          { level: 2, dice: [2, 10] },
  fireball:          { level: 3, dice: [8, 6], aoe: true, save: true },
  lightningBolt:     { level: 3, dice: [8, 6], aoe: true, save: true },
  callLightning:     { level: 3, dice: [3, 10], aoe: true, save: true },
  spiritGuardians:   { level: 3, dice: [3, 8], aoe: true, save: true },
  vampiricTouch:     { level: 3, dice: [3, 6] },
  blight:            { level: 4, dice: [8, 8], save: true },
  iceStorm:          { level: 4, dice: [6, 6], aoe: true, save: true },
  wallOfFire:        { level: 4, dice: [5, 8], aoe: true, save: true },
  coneOfCold:        { level: 5, dice: [8, 8], aoe: true, save: true },
  flameStrike:       { level: 5, dice: [8, 6], aoe: true, save: true },
};

/** Expected damage of a spell (for AI spell selection). */
export function spellExpected(id, level, targets) {
  const sp = SPELL_DAMAGE[id]; if (!sp) return 0;
  const n = sp.darts ? (3 + Math.floor(level / 4)) : (sp.hits || 1);
  const per = sp.dice[0] * (sp.dice[1] + 1) / 2;
  const mult = sp.aoe ? Math.min(targets, 6) : 1;
  return n * per * mult;
}

/* ------------------------------------------------------------------ */
/* PERK_LAYER — equipped-gear perks (items.js PERKS)                    */
/* ------------------------------------------------------------------ */
/**
 * Proc perks from equipped gear. PASSIVE perks (keenEdge / bulwark /
 * windwalker) are deliberately absent: their stats already flow into recalc via
 * aggregateEquipment, so modeling them here would double-count. `perkMag`
 * returns null for those, which is how they're filtered out.
 *
 * Magnitudes come from the game's own PERK_MAGS band table keyed on the item's
 * found-ilvl, so the sim tracks any retune of items.json automatically.
 *
 * Refreshed once per encounter (gear only changes on level-up) — see
 * refreshPerks() in runEncounter.
 */
export function refreshPerks(h) {
  const map = {};
  for (const slot of Object.keys(h.equipment || {})) {
    const it = h.equipment[slot];
    if (!it || !it.perk || !it.perk.id) continue;
    const m = perkMag(it.perk.id, it.ilvl || 1);
    if (m == null) continue;                 // passive perk — handled by recalc
    // two copies of a perk don't stack; the stronger one wins
    map[it.perk.id] = Math.max(map[it.perk.id] || 0, m);
  }
  h._perks = map;
  return map;
}

/** Magnitude of a proc perk on this hero, or 0 if not equipped. */
function pm(h, id) { return (h._perks && h._perks[id]) || 0; }

/** Credit damage from a perk proc to the hero and resolve a kill. */
function perkDamage(h, foe, dmg) {
  if (!foe || !foe.alive || dmg <= 0) return 0;
  foe.hp -= dmg;
  h._sim.dmgDealt += dmg;
  lvlBucket(h).dmgDealt += dmg;
  if (foe.hp <= 0) {
    h._sim.overkill += -foe.hp;
    foe.alive = false;
    h._sim.kills++;
    lvlBucket(h).kills++;
  }
  return dmg;
}

/** A living foe other than `except` (cleave / arc-chain secondary target). */
function otherFoe(enemies, except) {
  if (!enemies) return null;
  for (const m of enemies) if (m.alive && m.hp > 0 && m !== except) return m;
  return null;
}

/** Tick burn DoT stacks at end of round. `burn` is damage per round. */
function tickBurns(enemies) {
  for (const m of enemies) {
    if (!m.alive || m.hp <= 0 || !m._burn) continue;
    const src = m._burnSrc;
    if (m._burnRounds-- <= 0) { m._burn = 0; m._burnSrc = null; continue; }
    if (src) perkDamage(src, m, m._burn);
  }
}

/* ------------------------------------------------------------------ */
/* Per-hero statistics                                                 */
/* ------------------------------------------------------------------ */

export function initHeroStats(h) {
  h._sim = {
    class: h.classKey, race: h.raceKey,
    encounters: 0, rounds: 0,
    dmgDealt: 0, dmgTaken: 0, mitigated: 0, overkill: 0,
    healingDone: 0, healingReceived: 0,
    attacks: 0, hits: 0, misses: 0, crits: 0,
    kills: 0, downs: 0, deaths: 0, revives: 0,
    // per-level breakdown, keyed by character level
    byLevel: {},
  };
  return h._sim;
}

function lvlBucket(h) {
  const s = h._sim;
  if (!s.byLevel[h.level]) {
    s.byLevel[h.level] = {
      encounters: 0, rounds: 0, dmgDealt: 0, dmgTaken: 0, healingDone: 0,
      kills: 0, downs: 0, deaths: 0,
      maxHp: h.maxHp, ac: h.ac, atkBonus: h.atkBonus,
    };
  }
  return s.byLevel[h.level];
}

/* ------------------------------------------------------------------ */
/* Encounter generation                                                */
/* ------------------------------------------------------------------ */

/**
 * Build one encounter appropriate for a party of the given level.
 * kind: 'normal' | 'elite' | 'boss'.
 */
export function makeEncounter(level, partySize, kind, rng) {
  const monsters = [];
  const rp = Math.random; // seeded globally

  if (kind === 'boss') {
    const boss = spawnMonster(level, level, rp, null, null);
    boss.isBoss = true;
    monsters.push(wrapMonster(boss, 'boss'));
    // a couple of minions accompany the boss
    const minions = 1 + Math.floor(rng() * partySize);
    for (let i = 0; i < minions; i++) {
      const cr = crForDungeonLevel(level, rng);
      monsters.push(wrapMonster(spawnMonster(cr, level, rp, null, null), 'normal'));
    }
    return { kind, monsters };
  }

  // normal / elite pack: scale count with party size and depth
  const base = Math.max(2, partySize - 1);
  const count = base + Math.floor(rng() * 3);            // base .. base+2
  for (let i = 0; i < count; i++) {
    const cr = crForDungeonLevel(level, rng);
    const m = spawnMonster(cr, level, rp, null, null);
    monsters.push(wrapMonster(m, 'normal'));
  }
  if (kind === 'elite') {
    // one beefed-up elite leads the pack
    const cr = crForDungeonLevel(level, rng) * 1.5;
    const elite = spawnMonster(cr, level + 1, rp, null, null);
    elite.maxHp = Math.round(elite.maxHp * 1.6); elite.hp = elite.maxHp;
    elite.atk += 1;
    monsters.push(wrapMonster(elite, 'elite'));
  }
  return { kind, monsters };
}

function wrapMonster(spec, band) {
  return {
    ...spec,
    band,                                   // 'normal' | 'elite' | 'boss'
    isBoss: band === 'boss',
    isElite: band === 'elite',
    alive: true,
  };
}

/* ------------------------------------------------------------------ */
/* Hero action — mirrors combat.js heroCombat + heroAttackRoll         */
/* ------------------------------------------------------------------ */

/** Number of weapon attacks a hero makes on its action (Extra Attack ladder). */
function attackCount(h) {
  let n = 1;
  if (hasFeature(h, 'extraAttack2')) n = 3;
  else if (hasFeature(h, 'extraAttack')) n = 2;
  return n;
}

/**
 * One d20 attack roll + damage resolution against a monster. Returns the raw
 * damage dealt (0 on a miss). Mirrors combat.js heroAttackRoll's core.
 */
function oneAttack(h, foe, party, profile, opts = {}) {
  const s = h._sim;
  const cls = CLASSES[h.classKey];
  s.attacks++;

  let adv = opts.adv || 0;
  let d20 = d20Roll(adv);
  if (d20 === 1 && RACES[h.raceKey].lucky) d20 = die(20);       // halfling luck

  const atkBonus = h.atkProf + mod(h.effStats[profile.ability]) + (opts.atkBonus || 0);
  const crit = !!opts.autoCrit || d20 >= h.critRange;
  const total = d20 + atkBonus;
  const miss = !crit && total < foe.ac;
  if (miss) { s.misses++; return 0; }

  s.hits++;
  if (crit) s.crits++;

  let dmg = heroDamage(h, crit, profile) + (opts.extraDmg || 0);

  /* ── PERK_LAYER: damage-shaping perks, applied before the hit lands. */
  {
    const exec = pm(h, 'execute');
    if (exec && foe.hp < foe.maxHp * 0.3) dmg *= exec;
    const first = pm(h, 'firstStrike');
    if (first && !h._firstStrikeUsed) { h._firstStrikeUsed = true; dmg *= first; }
    const surge = pm(h, 'critSurge');
    if (surge && crit) dmg += surge;
    dmg = Math.round(dmg);
  }

  /* ── FEATURE_LAYER: Agonizing Blast (warlock) — CHA mod to each EB beam. */
  if (profile.cantripScale && hasFeature(h, 'agonizingBlast')) {
    dmg += mod(h.effStats.cha);
  }

  /* ── FEATURE_LAYER: sneak attack (rogue / sneakAttack feature) ───────────
     Requires a flanking ally in-game; in the abstract brawl we treat the foe
     as flanked whenever the party has another living member fighting. */
  if ((cls.sneakDice || hasFeature(h, 'sneakAttack')) && party.aliveCount > 1) {
    const dice = cls.sneakDice ? cls.sneakDice(h.level) : Math.ceil(h.level / 2);
    dmg += roll(dice, SNEAK_DICE_SIDES);
  }

  /* ── FEATURE_LAYER: conditional feat damage (GWM/Sharpshooter/…) ─────── */
  dmg += featBonusDamage(h, {
    profile,
    weapon: h.equipment && h.equipment.weapon,
    foeFullHp: foe.hp >= foe.maxHp,
    foeElite: foe.isBoss || foe.isElite,
    foeImpaired: false,
  });

  /* ── FEATURE_LAYER: conditional subclass procs (flat, per hit) ───────── */
  dmg += subclassConditionalDamage(h, foe);

  foe.hp -= dmg;
  s.dmgDealt += dmg;
  if (foe.hp <= 0) {
    s.overkill += -foe.hp;
    foe.alive = false;
    s.kills++;
    lvlBucket(h).kills++;
  }

  /* ── PERK_LAYER: on-hit / on-kill procs ─────────────────────────────────
     Ordered so secondary damage is credited to the wielder, keeping DPR whole. */
  if (h._perks) {
    const enemies = party && party.enemies;

    const steal = pm(h, 'lifesteal');
    if (steal) heal(h, h, Math.max(1, Math.round(dmg * steal)));

    const burn = pm(h, 'burn');
    if (burn && foe.alive) { foe._burn = burn; foe._burnRounds = 3; foe._burnSrc = h; }

    const cleave = pm(h, 'cleave');
    if (cleave) {
      const other = otherFoe(enemies, foe);
      if (other) perkDamage(h, other, Math.round(dmg * cleave));
    }

    /* Arc Chain is ranged/magic only — melee swings never proc it. */
    const chain = pm(h, 'chain');
    if (chain && !profile.melee && Math.random() < chain) {
      const other = otherFoe(enemies, foe);
      if (other) perkDamage(h, other, dmg);
    }

    const font = pm(h, 'manaFont');
    if (font && h.slots && h.slotsMax && Math.random() < font) {
      /* restore the lowest spent slot */
      for (const lv of Object.keys(h.slotsMax).map(Number).sort((a, b) => a - b)) {
        if ((h.slots[lv] || 0) < h.slotsMax[lv]) { h.slots[lv] = (h.slots[lv] || 0) + 1; break; }
      }
    }

    const phase = pm(h, 'phaseStep');
    if (phase && !foe.alive) { h._phaseAc = phase; h._phaseRounds = 1; }
  }
  return dmg;
}

/**
 * Conditional subclass damage the game applies inside combat (the flat "+N
 * always" subclass bonuses are already folded into h.dmgBonus by recalc, so
 * only the situational ones are modeled here).
 */
function subclassConditionalDamage(h, foe) {
  const sc = subclassOf(h);
  if (!sc) return 0;
  const key = sc.passiveKey;
  const wounded = foe.hp < foe.maxHp;
  const full = foe.hp >= foe.maxHp;
  switch (key) {
    case 'giantKiller':   return full ? 2 : 0;                 // Hunter: +2 vs full HP
    case 'assassinsMark': return full ? roll(1, 6) : 0;        // Assassin: +1d6 vs full HP
    case 'relentless':    return wounded ? 2 : 0;              // Vengeance: +2 vs wounded
    case 'opportunist':   return wounded ? roll(1, 4) : 0;     // Thief: +1d4 vs wounded
    case 'sacredWrath':   return (foe.type === 'undead' || foe.type === 'fiend') ? roll(1, 6) : 0;
    default:              return 0;
  }
}

/**
 * FEATURE_LAYER: cast the best available leveled damage spell, spending a slot.
 * Returns true if a spell was cast (the hero's action is then spent).
 * Mirrors combat.js tryCastKnownSpell / castSubclassSpell intent: blasters open
 * with slot spells (AoE on packs, single-target burst otherwise) and fall back
 * to cantrips when slots run dry.
 */
function casterAction(h, enemies, party) {
  if (!h.slots || totalSlots(h.slots) <= 0) return false;

  // candidate spells the hero actually knows (+ any slot-recharge subclass nuke)
  const known = new Set((h.knownSpells || []).filter(id => SPELL_DAMAGE[id]));
  const sc = subclassOf(h);
  if (sc && sc.active && sc.active.recharge === 'slot' && SPELL_DAMAGE[sc.active.key]) {
    known.add(sc.active.key);
  }
  if (!known.size) return false;

  const alive = enemies.filter(m => m.alive && m.hp > 0);
  if (!alive.length) return false;

  // highest slot level currently available
  const availLevels = Object.keys(h.slots).map(Number).filter(L => h.slots[L] > 0).sort((a, b) => a - b);
  const maxSlot = availLevels[availLevels.length - 1];

  // choose the highest-expected-damage castable spell
  let best = null, bestExp = 0;
  for (const id of known) {
    const sp = SPELL_DAMAGE[id];
    if (sp.level > maxSlot) continue;
    // don't waste an AoE nuke on a lone target — prefer it only on packs
    const exp = spellExpected(id, h.level, alive.length);
    if (sp.aoe && alive.length < 3) continue;
    if (exp > bestExp) { bestExp = exp; best = id; }
  }
  // if nothing selected (e.g. only AoE known but few foes), allow a single-target one
  if (!best) {
    for (const id of known) {
      const sp = SPELL_DAMAGE[id];
      if (sp.level > maxSlot) continue;
      const exp = spellExpected(id, h.level, alive.length);
      if (exp > bestExp) { bestExp = exp; best = id; }
    }
  }
  if (!best) return false;

  const sp = SPELL_DAMAGE[best];
  // spend the lowest slot that can power it
  const slotLevel = availLevels.find(L => L >= sp.level);
  if (slotLevel == null) return false;
  h.slots[slotLevel]--;

  const s = h._sim;
  if (sp.aoe) {
    const targets = alive.sort((a, b) => a.hp - b.hp).slice(0, 6);
    for (const foe of targets) {
      let dmg = rollSpell(best, h);
      if (sp.save && Math.random() < SPELL_SAVE_HALF_CHANCE) dmg = Math.floor(dmg / 2);
      applySpellDamage(h, foe, dmg);
    }
  } else {
    const foe = pickFoe(enemies);
    if (foe) {
      let dmg = rollSpell(best, h);
      if (sp.save && Math.random() < SPELL_SAVE_HALF_CHANCE) dmg = Math.floor(dmg / 2);
      applySpellDamage(h, foe, dmg);
    }
  }
  return true;
}

/** Roll a spell's damage from the table (+ the hero's spell damage bonus). */
function rollSpell(id, h) {
  const sp = SPELL_DAMAGE[id];
  const bonus = h.dmgBonus || 0;
  if (sp.darts) {
    const darts = 3 + Math.floor(h.level / 4);
    let t = bonus;
    for (let i = 0; i < darts; i++) t += roll(1, 4, 1);
    return t;
  }
  const hits = sp.hits || 1;
  let t = bonus;
  for (let i = 0; i < hits; i++) t += roll(sp.dice[0], sp.dice[1]);
  return t;
}

function applySpellDamage(h, foe, dmg) {
  if (dmg <= 0) return;
  foe.hp -= dmg;
  h._sim.dmgDealt += dmg;
  if (foe.hp <= 0) { h._sim.overkill += -foe.hp; foe.alive = false; h._sim.kills++; lvlBucket(h).kills++; }
}

/**
 * A hero's full action for the round: heal if a healer and someone needs it,
 * then the attack sequence (main + extra attacks + offhand + once-per-rest
 * action surge / flurry). Retargets spare attacks when a foe dies mid-sequence.
 */
export function heroAction(h, enemies, party) {
  if (h.hp <= 0) return;

  /* ── FEATURE_LAYER: Rage (barbarian) — enter when bloodied, lasts the fight.
     Grants +2 damage (added via extraDmg) and +2 AC and half incoming physical
     (applied in monster attack). Modeled as a per-encounter flag. */
  if (h.classKey === 'barbarian' && !h._raging && h.hp < h.maxHp) {
    h._raging = true;
  }

  /* ── FEATURE_LAYER: Second Wind (fighter) — self-heal once/short when low. */
  if ((h.secondWind || hasFeature(h, 'secondWind')) && !h._secondWindUsed && h.hp < h.maxHp * 0.3) {
    h._secondWindUsed = true;
    const amt = roll(1, 10, h.level);
    heal(h, h, amt);
  }

  /* Healer heal (Cure Wounds): an ordinary level-1 slot spell now, so it
     competes with the blasting spells for the same pool instead of drawing on
     the old bespoke heal budget. */
  if (canHeal(h)) {
    const target = mostWounded(party.heroes);
    /* pick the target first — spending the slot is the last step, so a healer
       with nobody hurt keeps its slots for the blasting path below */
    if (target && target.hp < target.maxHp * 0.55 && spendLowestSlot(h, 1)) {
      const dice = Math.min(3, 1 + Math.floor(h.level / 6));
      const castMod = mod(h.effStats[CLASSES[h.classKey].attack.ability]);
      heal(h, target, roll(dice, 8, (h.healBonus || 0) + Math.max(0, castMod)));
    }
  }

  /* ── FEATURE_LAYER: leveled slot spells (blasters + healers with slots).
     Warlock is excluded — it spams multi-beam Eldritch Blast instead (handled
     in the attack path below), which is its real primary damage. */
  if (h.classKey !== 'warlock' && casterAction(h, enemies, party)) return;

  const profile = pickAttackProfile(h) || h.weaponProfile || CLASSES[h.classKey].attack;
  h.lastProfile = profile;

  const opts = buildActionOpts(h);
  /* Eldritch Blast fires multiple beams (1, +1 at L5/L11/L17). Each beam is a
     separate attack roll of the cantrip. */
  let swings = attackCount(h)
    + (profile.source === 'weapon' ? featExtraAttacks(h) : 0);
  if (profile.cantripScale && hasFeature(h, 'eldritchBlast')) {
    swings = 1 + (h.level >= 5 ? 1 : 0) + (h.level >= 11 ? 1 : 0) + (h.level >= 17 ? 1 : 0);
  }

  let dealtThisAction = 0;
  for (let i = 0; i < swings; i++) {
    const foe = pickFoe(enemies);
    if (!foe) return;
    dealtThisAction += oneAttack(h, foe, party, profile, i === 0 ? opts : { ...opts, adv: opts.adv });
  }

  /* Off-hand attack (two-weapon fighting). */
  if (profile.source === 'weapon' && h.offhandProfile) {
    const foe = pickFoe(enemies);
    if (foe) oneAttack(h, foe, party, h.offhandProfile, {});
  }

  /* ── FEATURE_LAYER: Action Surge (fighter) — one extra action, once/short. */
  if (!h._surgeUsed && (hasFeature(h, 'actionSurgeClass') ||
      (subclassOf(h) && subclassOf(h).active && subclassOf(h).active.key === 'actionSurge'))) {
    h._surgeUsed = true;
    const foe = pickFoe(enemies);
    if (foe) for (let i = 0; i < attackCount(h); i++) {
      const f = pickFoe(enemies); if (f) oneAttack(h, f, party, profile, opts);
    }
  }

  /* ── FEATURE_LAYER: Flurry of Blows (monk) — bonus attack, once/short. */
  else if (!h._flurryUsed && hasFeature(h, 'flurryOfBlows')) {
    h._flurryUsed = true;
    const foe = pickFoe(enemies);
    if (foe) oneAttack(h, foe, party, profile, opts);
  }

  return dealtThisAction;
}

/** Build the per-attack option bag (advantage, flat extra damage) for a hero. */
function buildActionOpts(h) {
  const opts = { extraDmg: 0, adv: 0 };
  /* Rage bonus damage. */
  if (h._raging) opts.extraDmg += 2;
  /* Favored Enemy (ranger) — the game grants +2 vs all monsters. */
  if (h.classKey === 'ranger') opts.extraDmg += 2;
  /* Divine Smite (paladin) — spent once per short rest, saved for the action. */
  if (h.classKey === 'paladin' && !h._smiteUsed) {
    h._smiteUsed = true;
    opts.extraDmg += roll(2, 8);
  }
  return opts;
}

/* ------------------------------------------------------------------ */
/* Monster action — mirrors monster_ai.js basic attack                 */
/* ------------------------------------------------------------------ */

/* Cross-encounter counters the valuation harness reads (value.mjs). Counting
   monster ATTACKS rather than rounds lets defensive value be measured free of
   offensive contamination: killing faster shortens fights, which would depress
   damage-taken-per-round even when mitigation is unchanged. */
export const simCounters = { monsterActions: 0 };

export function monsterAction(m, party) {
  if (!m.alive || m.hp <= 0) return;
  const target = pickHeroTarget(party.heroes);
  if (!target) return;
  simCounters.monsterActions++;

  const d20 = d20Roll(0);
  const crit = d20 === 20;
  const total = d20 + m.atk;
  /* rage AC bonus + PERK_LAYER Phase Step's brief post-kill AC */
  let ac = target.ac + (target._raging ? 2 : 0) + (target._phaseAc || 0);
  if (!crit && total < ac) return;                       // miss

  let dice = m.dmg[0]; if (crit) dice *= 2;
  let dmg = roll(dice, m.dmg[1], m.dmg[2] || 0);

  /* Rage: halve incoming physical damage (SRD). We treat basic monster hits
     as physical. */
  if (target._raging) { const before = dmg; dmg = Math.floor(dmg / 2); target._sim.mitigated += before - dmg; }

  target.hp -= dmg;
  target._sim.dmgTaken += dmg;
  lvlBucket(target).dmgTaken += dmg;
  if (target.hp <= 0) {
    target.hp = 0;
    target._sim.downs++;
    lvlBucket(target).downs++;
  }

  /* ── PERK_LAYER: retaliation. Thorns answers any attacker; Riposte only
     melee. Monster `range` mirrors the gear convention (< 2.2 == melee). */
  if (target._perks) {
    const thorns = pm(target, 'thorns');
    if (thorns) perkDamage(target, m, thorns);
    const riposte = pm(target, 'riposte');
    if (riposte && !(m.range > 2.2)) perkDamage(target, m, riposte);
  }
}

/* ------------------------------------------------------------------ */
/* Healing                                                             */
/* ------------------------------------------------------------------ */

function canHeal(h) {
  return !!CLASSES[h.classKey].healer || hasFeature(h, 'layOnHands');
}

function heal(source, target, amount) {
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  const real = target.hp - before;
  source._sim.healingDone += real;
  lvlBucket(source).healingDone += real;
  target._sim.healingReceived += real;
  return real;
}

function mostWounded(heroes) {
  let worst = null, frac = 1;
  for (const h of heroes) {
    if (h.hp <= 0) continue;
    const f = h.hp / h.maxHp;
    if (f < frac) { frac = f; worst = h; }
  }
  return worst;
}

/* ------------------------------------------------------------------ */
/* Targeting                                                           */
/* ------------------------------------------------------------------ */

/** Heroes focus-fire the lowest-HP living enemy (fastest way to cut incoming). */
function pickFoe(enemies) {
  let best = null, lo = Infinity;
  for (const m of enemies) {
    if (!m.alive || m.hp <= 0) continue;
    if (m.hp < lo) { lo = m.hp; best = m; }
  }
  return best;
}

/** Monsters pick a living hero at random (uniform — no positional aggro).
    Uniform targeting is a deliberate control: it removes tank/position bias so
    survivability differences trace to AC/HP/mitigation, which is what we test. */
function pickHeroTarget(heroes) {
  const alive = heroes.filter(h => h.hp > 0);
  if (!alive.length) return null;
  return alive[Math.floor(Math.random() * alive.length)];
}

/* ------------------------------------------------------------------ */
/* Rests                                                               */
/* ------------------------------------------------------------------ */

/** Short rest: refresh once-per-short-rest abilities + partial heal. */
export function shortRest(party) {
  for (const h of party) {
    h._secondWindUsed = false; h._surgeUsed = false; h._flurryUsed = false;
    h._smiteUsed = false; h._raging = false;
    // spend "hit dice": recover up to ~half missing HP
    if (h.hp > 0) h.hp = Math.min(h.maxHp, h.hp + Math.ceil((h.maxHp - h.hp) * 0.5));
    // Warlock Pact Magic slots recharge on a short rest
    if (h.classKey === 'warlock' && h.slotsMax) h.slots = { ...h.slotsMax };
  }
}

/** Long rest: full reset + full heal + revive the fallen. */
export function longRest(party) {
  for (const h of party) {
    const wasDown = h.hp <= 0;
    h.hp = h.maxHp;
    h._secondWindUsed = false; h._surgeUsed = false; h._flurryUsed = false;
    h._smiteUsed = false; h._raging = false;
    if (wasDown && h._diedThisFloor) { h._sim.revives++; h._diedThisFloor = false; }
    if (h.slotsMax) h.slots = { ...h.slotsMax };   // full spell slots on a long rest
  }
}

/** Spend the lowest available slot of level >= lvl. Mirrors spendSlotFor. */
function spendLowestSlot(h, lvl = 1) {
  if (!h.slots) return false;
  const levels = Object.keys(h.slots).map(Number).filter(L => L >= lvl && h.slots[L] > 0);
  if (!levels.length) return false;
  h.slots[Math.min(...levels)]--;
  return true;
}

/* ------------------------------------------------------------------ */
/* Encounter driver                                                    */
/* ------------------------------------------------------------------ */

/**
 * Resolve a single encounter to completion. Mutates hero HP and stats.
 * Returns { win, rounds, wiped }.
 */
export function runEncounter(party, encounter) {
  const heroes = party;
  const enemies = encounter.monsters;
  const ctx = {
    heroes,
    enemies,                                  // PERK_LAYER needs secondary targets
    get aliveCount() { return heroes.reduce((n, h) => n + (h.hp > 0 ? 1 : 0), 0); },
  };
  for (const h of heroes) { h._raging = false; }
  for (const h of heroes) { h._sim.encounters++; lvlBucket(h).encounters++; }
  /* PERK_LAYER: re-read gear perks and clear once-per-encounter proc state. */
  for (const h of heroes) {
    refreshPerks(h);
    h._firstStrikeUsed = false;
    h._phaseAc = 0; h._phaseRounds = 0;
  }

  /* `encounter.maxRounds` lets a caller bound a fight that would otherwise run
     to ROUND_CAP. The valuation harness needs it: against immortal monsters a
     party with enough sustain never wipes, so an unbounded stopping time turns
     any lifesteal-style effect into an infinite score. */
  const cap = Math.min(ROUND_CAP, encounter.maxRounds || ROUND_CAP);
  let rounds = 0;
  while (rounds < cap) {
    if (!enemies.some(m => m.alive && m.hp > 0)) break;      // party wins
    if (!heroes.some(h => h.hp > 0)) break;                  // party wipes
    rounds++;

    // Hero phase (party order)
    for (const h of heroes) {
      if (h.hp <= 0) continue;
      if (!enemies.some(m => m.alive && m.hp > 0)) break;
      const before = h._sim.dmgDealt;
      heroAction(h, enemies, ctx);
      lvlBucket(h).dmgDealt += h._sim.dmgDealt - before;
    }

    // Monster phase
    for (const m of enemies) monsterAction(m, ctx);

    /* PERK_LAYER: end-of-round — burn DoT ticks, Phase Step's AC decays. */
    tickBurns(enemies);
    for (const h of heroes) if (h._phaseAc && --h._phaseRounds <= 0) h._phaseAc = 0;

    // per-round bookkeeping
    for (const h of heroes) if (h.hp > 0) { h._sim.rounds++; lvlBucket(h).rounds++; }
  }

  // mark deaths (heroes still at 0 when the encounter ended and party survived)
  const wiped = !heroes.some(h => h.hp > 0);
  for (const h of heroes) {
    if (h.hp <= 0 && !h._diedThisFloor) {
      h._diedThisFloor = true;
      h._sim.deaths++; lvlBucket(h).deaths++;
    }
  }
  // reconcile kill buckets (kills counted globally during the fight)
  return { win: !wiped, rounds, wiped };
}
