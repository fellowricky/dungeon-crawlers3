/**
 * Combat evaluation — the shared "how good is this?" layer.
 *
 * The hero AI used to be a reflex cascade: an ordered list of `if` statements
 * where the first branch whose local precondition passed won the turn, with no
 * comparison against the alternatives. That is why heroes would spend an entire
 * Action on Disengage to dodge one opportunity attack, drop a 3rd-level slot on
 * a dying rat, or centre a Fireball on a lone goblin.
 *
 * These functions give the AI a single common currency — **expected HP swing**
 * — so options can actually be compared. Damage is always capped at the
 * target's *remaining* HP, so overkill is worth nothing and "kill the thing
 * that's nearly dead" falls out naturally instead of being special-cased.
 *
 * Everything here is pure and headless-safe (no VFX/UI/THREE), so the balance
 * sim and unit tests can call it directly.
 */
import { mod, cantripDice, weaponSwingCap, isSmallRace } from './srd.js';
import { getEffectMods, hasEffect, saveModifier } from './conditions.js';
import { hasFeature } from './features.js';

/* An average d20 attack lands ~55-65% of the time in this game's AC bands.
   Used where a real roll isn't worth computing. */
const NOMINAL_HIT = 0.6;

/* ── Grid distance ──────────────────────────────────────────────────────────
 * One world unit is one tile is five feet (game.js: wx = x => x - W/2 + 0.5).
 * The rules are grid rules, so reach and range have to be judged in SQUARES,
 * not in euclidean float distance between two drifting sprite positions.
 *
 * Measuring in floats produced a specific, systemic bug: two diagonally
 * adjacent creatures are 1.414 units apart, so a "5 ft" reach of 1.4 excluded
 * them — a hero could not attack a monster standing corner-to-corner with it,
 * while MELEE_PIN_RANGE (1.6) still counted that monster as pinning the hero.
 * The AI would then decide it was trapped by something it was not allowed to
 * hit. Reach weapons had the same hole at the far diagonal (2.828 > 2.5).
 *
 * 5e measures grid distance with diagonals costing the same as orthogonals
 * (PHB), which is Chebyshev distance. Deriving it from cell indices also makes
 * every reach test immune to sub-tile sprite drift.
 */

/** Chebyshev distance in TILES between two entities' cells. -1 if off-grid. */
export function gridDist(game, a, b) {
  if (!game || typeof game.cellOf !== 'function' || !game.D) return -1;
  const W = game.D.W;
  const ca = game.cellOf(a.x, a.z), cb = game.cellOf(b.x, b.z);
  if (ca < 0 || cb < 0) return -1;
  const dx = Math.abs((ca % W) - (cb % W));
  const dy = Math.abs(Math.floor(ca / W) - Math.floor(cb / W));
  return Math.max(dx, dy);
}

/** Grid distance in FEET — the unit the rules are actually written in. */
export function gridFeet(game, a, b) {
  const t = gridDist(game, a, b);
  return t < 0 ? -1 : t * 5;
}

/**
 * How many tiles an attack profile reaches.
 *   normal melee  → 1 tile  (5 ft, adjacent including diagonals)
 *   reach weapon  → 2 tiles (10 ft)
 *   ranged        → its range, which is already authored in tiles
 */
export function reachTiles(profile) {
  if (!profile) return 1;
  if (profile.melee) {
    const isReach = !!(profile.reach || (profile.range && profile.range >= 2.2));
    return isReach ? 2 : 1;
  }
  return Math.max(1, Math.round(profile.range || 6));
}

/** Average result of `n`d`f` + bonus. */
export function avgRoll(n, f, bonus = 0) {
  return n * (f + 1) / 2 + (bonus || 0);
}

/**
 * Probability that a d20 + bonus meets `ac`, honouring advantage/disadvantage
 * (`adv` > 0 = advantage, < 0 = disadvantage). Nat-1 always misses, nat-20
 * always hits.
 */
export function hitChance(atkBonus, ac, adv = 0) {
  const need = ac - atkBonus;
  /* p(single d20 >= need), clamped to the 5%/95% auto-miss/auto-hit band */
  let p = (21 - need) / 20;
  p = Math.max(0.05, Math.min(0.95, p));
  if (adv > 0) return 1 - (1 - p) * (1 - p);
  if (adv < 0) return p * p;
  return p;
}

/** A monster's expected damage per round against `target` (or nominal AC 15). */
export function monsterDpr(m, target = null, game = null) {
  const d = m && m.data;
  if (!d || d.hp <= 0) return 0;
  const dice = d.dmg || [1, 6, 0];
  const statKey = d.ranged ? 'dex' : 'str';
  const statVal = d.effStats?.[statKey] ?? d.statblock?.stats?.[statKey] ?? 10;
  const dmgBonus = Math.max(dice[2] || 0, mod(statVal));
  const perHit = avgRoll(dice[0] || 1, dice[1] || 6, dmgBonus);
  const swings = Math.max(1, d.attacksPerTurn || 1);
  let p = NOMINAL_HIT;
  if (target && game && typeof game.heroAC === 'function') {
    p = hitChance((d.atk || 0) + (getEffectMods(m).atkBonus || 0), game.heroAC(target));
  }
  return perHit * swings * p * (getEffectMods(m).dmgDealtMul ?? 1);
}

/**
 * Expected damage a single hero attack does to `foe`, before resistances.
 * `profile` is a pickAttackProfile() result (weapon / cantrip / unarmed).
 */
export function heroAttackEv(h, profile, foe, game) {
  const d = h && h.data;
  if (!d || !profile || !foe || !foe.data) return 0;
  const isCantrip = !!(profile.isSave || profile.cantripScale);
  let p;
  if (isCantrip) {
    /* Every class cantrip is a saving throw: the chance it lands is the
       chance the target FAILS. Same DC as spells.spellDC and the same save
       modifier as the real roll (conditions.saveModifier). */
    const saveAb = profile.saveAbility || 'dex';
    const lvl = d.level || 1;
    const dc = 8 + (2 + Math.floor((lvl - 1) / 4)) + mod(d.effStats?.[d._classAtk || profile.ability] ?? 10) + (d.spellDCBonus || 0);
    const saveMod = saveModifier(foe, saveAb);
    const pSave = Math.max(0.05, Math.min(0.95, (21 - (dc - saveMod)) / 20));
    /* the caster's advantage is the target's disadvantage, and back */
    let adv = 0;
    if (getEffectMods(foe).defAdvantage) adv += 1;
    if (foe.data.magicResistance) adv -= 1;
    const saved = adv > 0 ? pSave * pSave : adv < 0 ? 1 - (1 - pSave) * (1 - pSave) : pSave;
    p = 1 - saved;
  } else {
    const atkBonus = (d.atkProf || 0) + mod(d.effStats?.[profile.ability] ?? 10)
      + (getEffectMods(h).atkBonus || 0);
    const foeAc = (foe.data.ac || 12) + (getEffectMods(foe).acBonus || 0);
    let adv = 0;
    if (getEffectMods(foe).defAdvantage) adv += 1;
    if (getEffectMods(h).atkDisadvantage) adv -= 1;
    if (profile.heavy && isSmallRace(d.raceKey)) adv -= 1;   // heavy weapon, Small wielder
    p = hitChance(atkBonus, foeAc, adv);
  }
  const dice = profile.dmg || [1, 6];
  /* A cantrip grows its dice with level (heroDamage) and adds no ability
     modifier; Eldritch Blast instead fires one die per beam. */
  const diceCount = isCantrip ? (profile.beams ? 1 : cantripDice(d.level || 1)) : (dice[0] || 1);
  const physHit = avgRoll(diceCount, dice[1] || 6, 0)
    + (isCantrip ? 0 : mod(d.effStats?.[profile.ability] ?? 10)) + (d.dmgBonus || 0);
  /* Extra Attack / multiattack, so a fighter's turn isn't valued like a
     wizard's cantrip — it never applies to the cantrip itself. */
  let swings = 1;
  if (isCantrip) swings = Math.max(1, profile.beams || 1);
  else if (hasFeature(d, 'extraAttack2')) swings = 3;
  else if (hasFeature(d, 'extraAttack')) swings = 2;
  if (!isCantrip) swings = weaponSwingCap(d, profile, swings);
  /* damageModifier returns a TAG ('immune'|'resist'|'vuln'|null), not a
     multiplier — translate it. */
  let physMul = 1;
  if (game && typeof game.damageModifier === 'function') {
    const tag = game.damageModifier(foe, profile.dmgType || 'slashing', !!profile.magical);
    if (tag === 'immune') physMul = 0;
    else if (tag === 'resist') physMul = 0.5;
    else if (tag === 'vuln') physMul = 2;
  }
  let elemHit = 0;
  if (d.elemDamage && game && typeof game.damageModifier === 'function') {
    for (const [elemType, val] of Object.entries(d.elemDamage)) {
      if (!val || val <= 0) continue;
      const etag = game.damageModifier(foe, elemType, true);
      const emul = etag === 'immune' ? 0 : (etag === 'resist' ? 0.5 : (etag === 'vuln' ? 2 : 1));
      elemHit += val * emul;
    }
  }
  const perHit = Math.max(0, physHit) * physMul + elemHit;
  return Math.max(0, perHit) * swings * p;
}

/**
 * Weapon or cantrip for a hero's basic attack against `foe`, decided on the
 * numbers rather than a coin flip. A cleric beside a plated knight casts Sacred
 * Flame (a DEX save ignores the plate); beside a soft goblin it swings the mace.
 *
 *   value = expected damage (heroAttackEv) — hit chance vs AC for the weapon,
 *           failed-save chance for the cantrip — and 0 for whichever cannot
 *           reach the foe with the movement left this turn;
 *   then the hero's AI Priorities "ranged" lean nudges it: neutral at 0.5,
 *   up to ±30% toward the cantrip or the weapon.
 *
 * Returns null when there is no real choice (no cantrip, silenced, no weapon,
 * a casting focus in hand, wild shape) so the caller keeps its old rules.
 */
export function chooseHeroAttackProfile(h, foe, game) {
  const d = h && h.data;
  if (!d || !foe || !foe.data) return null;
  const weapon = d.weaponProfile, cantrip = d.cantripProfile;
  const silenced = !!(d._effects && d._effects.silenced);
  if (!weapon || !cantrip || silenced || weapon.focus || d.inWildShape) return null;

  const dist = Math.hypot(foe.x - h.x, foe.z - h.z);
  const move = h.moveLeft != null ? h.moveLeft
    : (game && typeof game.cellsForSpeed === 'function' ? game.cellsForSpeed(h) : 6);
  const inReach = (range) => dist - (range || 1.5) <= move + 0.01;

  const evWeapon = inReach(weapon.melee === false ? weapon.range : Math.max(1.5, weapon.range || 1.5))
    ? heroAttackEv(h, weapon, foe, game) : 0;
  const evCantrip = inReach(cantrip.range || 6) ? heroAttackEv(h, cantrip, foe, game) : 0;
  if (evWeapon <= 0 && evCantrip <= 0) return null;

  let rp = d.aiPrefs && d.aiPrefs.rangedPref != null ? d.aiPrefs.rangedPref : null;
  if (rp == null) {
    const ms = d.aiPrefs && d.aiPrefs.movementStyle;
    /* Kite / Hold Ground say it outright; otherwise a Combat Role the player
       picked leans it: Artillery shoots, Tank and Striker get stuck in. */
    const role = d.aiPrefs && d.aiPrefs.role;
    rp = ms === 'kite' ? 0.85 : (ms === 'hold' ? 0.2
      : role === 'artillery' ? 0.8 : (role === 'tank' || role === 'striker') ? 0.25 : 0.5);
  }
  const lean = Math.max(0, Math.min(1, rp)) - 0.5;          // -0.5 … +0.5
  const scoreCantrip = evCantrip * (1 + 0.6 * lean);
  const scoreWeapon = evWeapon * (1 - 0.6 * lean);
  return scoreCantrip > scoreWeapon ? cantrip : weapon;
}

/**
 * Damage `m` has already been promised this round by other party members.
 * Reading through the ledger is what stops four heroes from all piling onto
 * the same 5 HP goblin.
 */
export function committedDamage(game, m) {
  const led = game && game.combatIntent && game.combatIntent.allocated;
  return (led && led.get(m)) || 0;
}

/** A target's HP *after* everything the party has already committed this round. */
export function effectiveHp(game, m) {
  if (!m || !m.data) return 0;
  return Math.max(0, m.data.hp - committedDamage(game, m));
}

/** Record that `h` is about to put `amount` damage into `m` this round. */
export function commitDamage(game, m, amount) {
  if (!game || !m || !(amount > 0)) return;
  if (!game.combatIntent) game.combatIntent = { allocated: new Map(), round: -1 };
  const led = game.combatIntent.allocated;
  led.set(m, (led.get(m) || 0) + amount);
}

/**
 * Value of applying `damage` to `m`, in HP-equivalents.
 *
 * Capped at the target's *effective* remaining HP — damage past that point is
 * worth nothing, which is what kills overkill and stops big spells being
 * dumped on nearly-dead trash. Finishing a target off is worth a bonus equal
 * to the damage it would otherwise still deal, because a monster at 1 HP hits
 * exactly as hard as one at full.
 */
export function damageValue(game, m, damage) {
  const ehp = effectiveHp(game, m);
  if (ehp <= 0) return 0;                       // already spoken for — worthless
  const useful = Math.min(damage, ehp);
  let value = useful;
  /* Finishing a target is worth the damage it would have gone on to deal. A
     monster at 1 HP hits exactly as hard as one at full, so removing a wounded
     heavy hitter beats chipping a fresh one — while a 40-damage swing aimed at
     a 4 HP rat still scores terribly, because the rat wasn't going to hurt
     anyone much anyway. KILL_HORIZON is roughly how many more rounds a live
     monster would keep attacking. */
  if (damage >= ehp) value += monsterDpr(m, null, game) * KILL_HORIZON;
  return value;
}

const KILL_HORIZON = 2.5;

/**
 * The other side's roster relative to `e`. Membership in `game.monsters` is the
 * test — `_side` is only stamped on once initiative rolls, so relying on it
 * would make these helpers silently return nothing before a fight starts.
 */
export function hostilesOf(game, e) {
  const isMonster = Array.isArray(game.monsters) && game.monsters.includes(e);
  return (isMonster ? game.heroes : game.monsters) || [];
}

/**
 * Melee-capable hostiles within reach of `e`. Ranged attackers standing nearby
 * do NOT pin — they can't take an opportunity attack.
 */
export function meleeThreats(game, e, rangeTiles = 1) {
  const out = [];
  for (const f of hostilesOf(game, e)) {
    if (!f || !f.data || f.data.hp <= 0) continue;
    if (f.active === false) continue;
    if (f.data.ranged) continue;
    if (getEffectMods(f).incapacitated) continue;
    /* Tiles, not floats — "adjacent" has to mean the same thing here as it does
       in the reach test, or a hero ends up pinned by something it is not
       allowed to swing at. */
    const t = gridDist(game, e, f);
    if (t >= 0 && t <= rangeTiles) out.push(f);
  }
  return out;
}

/**
 * Expected damage `e` would eat by walking out of the threatened squares —
 * one opportunity attack per melee threat that still has its reaction.
 */
export function opportunityRisk(game, e, threats = null) {
  const list = threats || meleeThreats(game, e);
  let total = 0;
  for (const t of list) {
    if (t.reactionUsed) continue;
    const dice = t.data.dmg || [1, 6, 0];
    const statVal = t.data.effStats?.str ?? t.data.statblock?.stats?.str ?? 10;
    const perHit = avgRoll(dice[0] || 1, dice[1] || 6, Math.max(dice[2] || 0, mod(statVal)));
    total += perHit * NOMINAL_HIT;   // ONE attack, not a full round
  }
  return total;
}

/** Expected incoming damage next round from everything that can reach `e`. */
export function incomingPressure(game, e) {
  let total = 0;
  for (const f of hostilesOf(game, e)) {
    if (!f || !f.data || f.data.hp <= 0 || f.active === false) continue;
    const dist = Math.hypot(f.x - e.x, f.z - e.z);
    const reach = f.data.ranged ? 8 : 1.6 + (f.data.speed || 6) * 0.5;
    if (dist > reach) continue;
    total += monsterDpr(f, e, game);
  }
  return total;
}

/**
 * True when a single unlucky round could drop `e`. This — not a flat "bloodied"
 * fraction — is the state where defensive options (Dodge, retreat, potions)
 * are actually worth an Action.
 */
export function inMortalDanger(game, e) {
  if (!e || !e.data) return false;
  const pressure = incomingPressure(game, e);
  return pressure > 0 && e.data.hp <= pressure * 1.15;
}

/**
 * The opportunity cost of burning a spell slot of `level`, in HP-equivalents.
 *
 * Replaces the old `score += level * 3` weighting, which made the biggest
 * available spell win by default and had heroes opening every fight with their
 * top slot. Cost rises steeply with level, falls when the caster is sitting on
 * plenty of slots, and falls again when the fight is genuinely dangerous
 * (a boss, or a party in trouble) — that's when the big spells *should* come out.
 */
export function slotCost(h, level, game, opts = {}) {
  if (!level) return 0;                       // cantrips are free
  const d = h.data || {};
  const slots = d.slots || {};
  const remaining = slots[level] || 0;
  /* Baseline: roughly what a slot of this level is worth in damage terms. */
  let cost = 4 + level * 5;
  /* Sitting on a pile of them? Spend more freely. */
  if (remaining >= 3) cost *= 0.6;
  else if (remaining === 2) cost *= 0.8;
  else if (remaining <= 1) cost *= 1.5;       // last one — make it count
  /* Danger discount: bosses and a struggling party justify the big guns. */
  if (opts.danger) cost *= 0.5;
  /* Player directive: conservative heroes hoard, liberal heroes spend. */
  const w = opts.abilityUse != null ? opts.abilityUse : 0.5;
  cost *= (1.6 - w);
  return cost;
}

/**
 * Best centre for an AoE of `radius`, chosen by how much *useful* damage it
 * covers rather than by defaulting to whatever the caster happened to target.
 *
 * Candidate centres: every monster's own tile, plus the midpoint of every
 * monster pair close enough to share a blast. That is enough to find the
 * cluster without a grid search, and it is what stops the AI dropping a
 * Fireball on one goblin while three more stand two tiles away.
 *
 * Returns `{ x, z, targets, value }` or null when nothing clears `minTargets`.
 */
export function bestAoECenter(game, caster, radius, opts = {}) {
  const minTargets = opts.minTargets || 1;
  const maxRange = opts.maxRange != null ? opts.maxRange : 12;
  const perTarget = opts.perTargetDamage || 0;
  const live = (game.monsters || []).filter(m =>
    m && m.data && m.data.hp > 0 && m.active !== false && !getEffectMods(m).invisible
    && !(typeof game.isDominated === 'function' && game.isDominated(m)));
  if (!live.length) return null;

  const centers = [];
  for (const m of live) centers.push({ x: m.x, z: m.z });
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) > radius * 2) continue;
      centers.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    }
  }

  /* Optionally require the blast to still cover a specific monster — normally
     the caster's own target. Without this the search will happily relocate a
     Fireball onto a marginally better cluster on the far side of the room
     while the thing actually attacking the party goes untouched: more casts,
     each worth less. The job here is to place the blast well, not to pick a
     different fight. */
  const mustCover = opts.mustCover || null;

  let best = null;
  for (const c of centers) {
    if (Math.hypot(c.x - caster.x, c.z - caster.z) > maxRange) continue;
    if (mustCover && Math.hypot(mustCover.x - c.x, mustCover.z - c.z) > radius) continue;
    if (typeof game.hasLOS === 'function' && !game.hasLOS(caster.x, caster.z, c.x, c.z)) continue;
    const covered = live.filter(m => Math.hypot(m.x - c.x, m.z - c.z) <= radius);
    if (covered.length < minTargets) continue;
    /* Value the blast by useful damage, so three near-dead rats don't outscore
       two healthy ogres. */
    let value = 0;
    for (const m of covered) value += damageValue(game, m, perTarget || effectiveHp(game, m));
    if (!best || value > best.value || (value === best.value && covered.length > best.targets.length)) {
      best = { x: c.x, z: c.z, targets: covered, value };
    }
  }
  return best;
}

/** Can `h` attack `foe` from where it is standing right now? Grid-native. */
export function canAttackFrom(game, h, foe, profile) {
  if (!foe || !foe.data || foe.data.hp <= 0 || !profile) return false;
  const tiles = gridDist(game, h, foe);
  if (tiles < 0) return false;
  if (tiles > reachTiles(profile)) return false;
  if (!profile.melee && typeof game.hasLOS === 'function'
      && !game.hasLOS(h.x, h.z, foe.x, foe.z)) return false;
  return true;
}

/** Any living, targetable foe this hero could hit without moving. */
export function anyTargetInReach(game, h, profile) {
  for (const m of game.monsters || []) {
    if (!m || !m.data || m.data.hp <= 0 || m.active === false) continue;
    if (getEffectMods(m).invisible) continue;
    if (canAttackFrom(game, h, m, profile)) return m;
  }
  return null;
}

export { hasEffect };

/**
 * Centroid of the real party — the combat camera's anchor.
 *
 * Companions and temp allies are excluded on purpose: a summoned wolf or a
 * quest ally that charges across the room would drag the frame off the people
 * the player actually controls. Same test `partyLeader()` uses, so "who counts
 * as the party" is answered one way across the codebase.
 *
 * Returns null when nobody qualifies (whole party down, or only companions
 * left standing) so the caller can fall back rather than centre on origin.
 */
export function partyCentroid(heroes) {
  let cx = 0, cz = 0, n = 0;
  for (const h of heroes || []) {
    if (!h || !h.data || h.data.hp <= 0 || h.companion || h.temp) continue;
    cx += h.x; cz += h.z; n++;
  }
  return n ? { x: cx / n, z: cz / n } : null;
}
