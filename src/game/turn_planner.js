/**
 * Turn planner — the one place an option is weighed against the alternatives.
 *
 * combat_eval.js already prices things in a single currency (expected HP
 * swing: damage capped at what the target can still absorb, plus a bonus for a
 * kill). What was missing is the COMPARISON: the spell AI scored each spell on
 * its own "priority points" scale and cast anything above zero, so nothing ever
 * asked "is this better than just attacking?". These helpers answer that.
 *
 *   spellArea / areaTargets / bestAim
 *       The real footprint of an area spell. Lines and cones used to be scored
 *       as circles (Lightning Bolt as an 8-tile disc), so "two foes somewhere
 *       near" passed the cluster check and the bolt then hit one of them. A
 *       spell is now aimed with the same geometry its cast resolves with.
 *   spellDamageEv
 *       Expected damage of a damage spell on one target: dice from the spell's
 *       own description, times the chance it lands (save or attack roll).
 *   offensiveSpellPlan
 *       The value of casting a damage spell this turn (all targets, aimed),
 *       minus what the slot is worth, compared with the hero's basic attack.
 *       That single comparison is what stops a 3rd-level slot on a 4 HP goblin
 *       and a Fireball on one creature.
 *   targetPlanBonus
 *       Turns-to-reach and protecting the backline, for target choice.
 *
 * Pure and headless-safe: no VFX, UI or THREE, so the sim and tests can call
 * every function directly.
 */
import { mod } from './srd.js';
import { getEffectMods, hasEffect, saveModifier } from './conditions.js';
import { isPointInLineSegment, isPointInCone } from './aoe_system.js';
import { spellDC } from './spells.js';
import {
  damageValue, effectiveHp, heroAttackEv, hitChance, slotCost, gridDist, reachTiles, monsterDpr,
  inMortalDanger, incomingPressure,
} from './combat_eval.js';

/** Kill switch for A/B runs (sim/run_headless.mjs --noPlanner). Off = the
    pre-planner rules, so a change can always be measured against them. */
export const PLANNER = { on: true, monsters: true, phase2: true, triage: true, formation: true, safeSpots: true, thrift: true };

/* ── Area footprints ───────────────────────────────────────────────────────
 * Most area spells are a disc around a chosen point and say so through
 * aoeRadius. Lines and cones are aimed FROM the caster AT a creature; those
 * declare `area` on the spell (spells.js), mirroring the numbers their cast
 * uses. Caster-centred auras (aoeOrigin:'self') are a disc around the caster. */
export function spellArea(sp) {
  if (!sp) return null;
  const a = sp.area;
  if (a && a.shape === 'line') return { shape: 'line', length: a.length || 12, width: a.width || 1 };
  if (a && a.shape === 'cone') return { shape: 'cone', range: a.range || 3, halfAngle: a.halfAngle ?? 0.55 };
  const radius = sp.aoeRadius ?? sp.ai?.aoeRadius ?? (a && a.radius) ?? 0;
  if (!radius) return null;
  if (sp.ai?.aoeOrigin === 'self') return { shape: 'aura', radius };
  return { shape: 'circle', radius };
}

/** Is this an area spell whose footprint the AI can place? */
export function isAreaSpell(sp) {
  return !!spellArea(sp);
}

function liveFoes(game) {
  return (game.monsters || []).filter(m => m && m.data && m.data.hp > 0 && m.active !== false
    && !getEffectMods(m).invisible
    && !(typeof game.isDominated === 'function' && game.isDominated(m)));
}

/**
 * Monsters a spell of `area` would catch, cast by `caster` at `aim`.
 * `aim` is the centre for a circle and the creature aimed at for a line or a
 * cone (only its position is used). Same tests as the casts themselves.
 */
export function areaTargets(game, caster, area, aim, foes = null) {
  if (!area) return [];
  const list = foes || liveFoes(game);
  if (area.shape === 'aura') {
    return list.filter(m => Math.hypot(m.x - caster.x, m.z - caster.z) <= area.radius);
  }
  if (!aim) return [];
  if (area.shape === 'circle') {
    return list.filter(m => Math.hypot(m.x - aim.x, m.z - aim.z) <= area.radius);
  }
  const dx = aim.x - caster.x, dz = aim.z - caster.z;
  const dl = Math.hypot(dx, dz) || 1;
  if (area.shape === 'line') {
    const ex = caster.x + (dx / dl) * area.length, ez = caster.z + (dz / dl) * area.length;
    return list.filter(m => isPointInLineSegment(m.x, m.z, caster.x, caster.z, ex, ez, area.width * 0.5 + 0.35));
  }
  if (area.shape === 'cone') {
    return list.filter(m => isPointInCone(m.x, m.z, caster.x, caster.z, dx, dz, area.range, area.halfAngle));
  }
  return [];
}

/**
 * Where to put an area spell for the most useful value.
 *
 *   opts.perTarget(m) → expected damage on m (0 for a pure-control spell:
 *                       then each catch counts 1 + its threat, by headcount)
 *   opts.mustCover    → a creature the area has to include (the caster's
 *                       current target), so the blast isn't relocated onto a
 *                       different fight across the room
 *   opts.maxRange     → furthest centre / aim, in tiles (default 12)
 *
 * Returns { aim, foe, targets, useful, value } or null. `foe` is the creature
 * aimed at (line/cone) — it must be handed to the cast as its target, because
 * those casts take their direction from it. `useful` counts targets that are
 * not already dead on paper.
 */
export function bestAim(game, caster, area, opts = {}) {
  if (!area) return null;
  const foes = liveFoes(game);
  if (!foes.length) return null;
  const maxRange = opts.maxRange != null ? opts.maxRange : 12;
  const per = opts.perTarget || null;
  const los = (x, z) => typeof game.hasLOS !== 'function' || game.hasLOS(caster.x, caster.z, x, z);

  const score = (targets) => {
    let value = 0, useful = 0;
    for (const m of targets) {
      if (effectiveHp(game, m) <= 0) continue;          // already spoken for this round
      useful++;
      value += per ? damageValue(game, m, per(m)) : 1;
    }
    return { value, useful };
  };

  const cands = [];
  if (area.shape === 'aura') {
    cands.push({ aim: { x: caster.x, z: caster.z }, foe: null });
  } else if (area.shape === 'circle') {
    for (const m of foes) cands.push({ aim: { x: m.x, z: m.z }, foe: m });
    for (let i = 0; i < foes.length; i++) {
      for (let j = i + 1; j < foes.length; j++) {
        const a = foes[i], b = foes[j];
        if (Math.hypot(a.x - b.x, a.z - b.z) > area.radius * 2) continue;
        cands.push({ aim: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, foe: null });
      }
    }
  } else {
    /* Lines and cones: aim at each creature in turn. */
    for (const m of foes) cands.push({ aim: { x: m.x, z: m.z }, foe: m });
  }

  let best = null;
  for (const c of cands) {
    const reachTo = Math.hypot(c.aim.x - caster.x, c.aim.z - caster.z);
    if (area.shape !== 'aura' && reachTo > maxRange) continue;
    if (area.shape !== 'aura' && !los(c.aim.x, c.aim.z)) continue;
    const targets = areaTargets(game, caster, area, c.aim, foes);
    if (!targets.length) continue;
    if (opts.mustCover && !targets.includes(opts.mustCover)) continue;
    const { value, useful } = score(targets);
    if (!best || value > best.value || (value === best.value && useful > best.useful)) {
      best = { aim: c.aim, foe: c.foe || opts.mustCover || targets[0], targets, useful, value };
    }
  }
  return best;
}

/* ── Spell damage ─────────────────────────────────────────────────────────
 * Damage dice come from the spell's own description, the one place every spell
 * already states them ("8d6 fire … (DEX save for half)", "2d8 bludgeoning +
 * 4d6 cold"). Anything inside parentheses is upcasting or a footnote and is
 * left out — the AI casts at the spell's own level. A few spells describe
 * their damage in words; those are listed here. */
const DAMAGE_OVERRIDES = {
  magicMissile: { avg: 3 * 3.5, autoHit: true },             // three 1d4+1 darts
  scorchingRay: { avg: 3 * 7, attack: true },                // three 2d6 rays
  eldritchBlast: { avg: 5.5, attack: true },
  sleep: { avg: 0 },                                          // an HP pool, not damage
  animateObjects: { avg: 5 * 6.5, attack: true },             // five 1d4+4 blades
  steelWindStrike: { avg: 33, attack: true, multi: 5 },
  chainLightning: { avg: 45, save: 'dex', half: true, multi: 4 },
  stormOfVengeance: { avg: 0 },
  timeStop: { avg: 0 },
  powerWordKill: { avg: 0 },
  hex: { avg: 0 }, huntersMark: { avg: 0 }, thunderousSmite: { avg: 0 },
  bless: { avg: 0 }, crusadersMantle: { avg: 0 },
  flamingSphere: { avg: 7, save: 'dex', half: true, sustained: true },
  spikeGrowth: { avg: 5, autoHit: true, sustained: true },
  /* dice or save only inside parentheses, which the parser leaves out */
  moonbeam: { avg: 11, save: 'con', half: true, sustained: true },
  flameStrike: { avg: 28, save: 'dex', half: true },
  armsOfHadar: { avg: 7, save: 'str', half: true },
};

/* Damage that keeps coming (a lingering zone, a summoned weapon, a DoT) is
   worth more than its first tick. Two rounds' worth is a fair middle: some
   targets die or walk out, some stay. */
const SUSTAINED_ROUNDS = 2;
const SUSTAINED_RX = /each round|every round|now and again|again as|on later turns|keeps burning|for \d+ rounds|on each of your turns|start of (its|each) turn/i;

const _parsed = new Map();

/** {avg, save, half, attack, autoHit, multi} for a damage spell, or null. */
export function spellDamageProfile(key, sp) {
  if (_parsed.has(key)) return _parsed.get(key);
  let out = null;
  const ov = DAMAGE_OVERRIDES[key];
  if (ov) {
    out = ov.avg > 0 ? { save: null, half: false, attack: false, autoHit: false, multi: 1, ...ov } : null;
  } else if (sp && sp.desc) {
    /* strip parentheticals (upcasting, footnotes) and read every NdM[+K] term */
    const body = sp.desc.replace(/\([^)]*\)/g, ' ');
    const terms = [...body.matchAll(/(\d+)d(\d+)(?:\s*\+\s*(\d+)(?!d))?/g)];
    let avg = 0;
    for (const t of terms) avg += (+t[1]) * ((+t[2]) + 1) / 2 + (t[3] ? +t[3] : 0);
    if (avg > 0 && !/\bheal|restores?\b/i.test(sp.desc.split(':')[0])) {
      const saveM = sp.desc.match(/\b(STR|DEX|CON|INT|WIS|CHA|Str|Dex|Con|Int|Wis|Cha)\b[^.]{0,12}save/);
      const save = saveM ? saveM[1].toLowerCase() : (/\bsave\b/i.test(sp.desc) ? 'dex' : null);
      out = { avg, save, half: /half/i.test(sp.desc), attack: !save, autoHit: false, multi: 1 };
    }
  }
  if (out) {
    const sustained = out.sustained ?? (!!(sp && sp.concentration) || SUSTAINED_RX.test((sp && sp.desc) || ''));
    out = { ...out, sustained, rounds: sustained ? SUSTAINED_ROUNDS : 1 };
  }
  _parsed.set(key, out);
  return out;
}

/** Expected damage of spell `key` on `target` when `h` casts it. */
export function spellDamageEv(game, h, key, sp, target) {
  const p = spellDamageProfile(key, sp);
  if (!p || !target || !target.data) return 0;
  let land;
  if (p.autoHit) land = 1;
  else if (p.save) {
    const dc = spellDC(h);
    const pSave = Math.max(0.05, Math.min(0.95, (21 - (dc - saveModifier(target, p.save))) / 20));
    land = (1 - pSave) + (p.half ? pSave * 0.5 : 0);
  } else {
    const d = h.data || {};
    const atk = (d.atkProf || 2) + mod(d.effStats?.[d._classAtk || 'int'] ?? 10) + (getEffectMods(h).atkBonus || 0);
    const ac = (target.data.ac || 12) + (getEffectMods(target).acBonus || 0);
    land = hitChance(atk, ac, getEffectMods(target).defAdvantage ? 1 : 0);
  }
  let mul = 1;
  if (game && typeof game.damageModifier === 'function' && sp.dmgType) {
    const tag = game.damageModifier(target, sp.dmgType, true);
    if (tag === 'immune') mul = 0;
    else if (tag === 'resist') mul = 0.5;
    else if (tag === 'vuln') mul = 2;
  }
  return p.avg * land * mul * (p.rounds || 1);
}

/** The value of the hero's ordinary attack on `foe` this turn, in HP. */
export function basicAttackValue(game, h, foe, profile = null) {
  if (!h || !h.data || !foe || !foe.data) return 0;
  const prof = profile || h.data.lastProfile || h.data.weaponProfile || h.data.cantripProfile;
  if (!prof) return 0;
  return damageValue(game, foe, heroAttackEv(h, prof, foe, game));
}

/** Is the fight dangerous enough that the big slots should come out? */
export function fightIsDangerous(game, foe, alive) {
  if (foe && (foe.isBoss || (typeof game.monsterEliteRoom === 'function' && game.monsterEliteRoom(foe)))) return true;
  const party = alive || [];
  if (!party.length) return false;
  const frac = party.reduce((s, a) => s + a.data.hp / Math.max(a.data.maxHp, 1), 0) / party.length;
  return frac < 0.5;
}

/* ── Fight outlook: how much danger is the party actually in? ─────────────
 * Every spender used to ask "is this foe worth it?" one foe at a time, so the
 * last two goblins of a won fight still drew Bless, a potion, Action Surge and
 * a 2nd-level slot. The outlook asks the question about the whole fight:
 *
 *   roundsToWin  the foes' remaining HP ÷ the party's expected damage per round
 *   loss         HP the party should expect to lose before then (the foes'
 *                damage per round × those rounds, ×0.6 because their damage
 *                falls off as they die)
 *   danger       0..1, that loss as a share of the party's HP, where losing
 *                half the party's HP reads as full danger. Floors: someone who
 *                could drop next round, a downed hero, a healthy boss.
 *   cleanup      danger is negligible and plain attacks end it in ≤ 3 rounds.
 *                Limited resources stay in the pack; only true emergencies
 *                (a downed ally) still spend.
 *
 * Cached per moment and per HP state, so the many spenders that ask it in one
 * turn share a single calculation. Switch: PLANNER.thrift. */
export const THRIFT = { cleanupDanger: 0.15, cleanupRounds: 3, fullDangerLoss: 0.5 };

function fightFoes(game) {
  const foes = liveFoes(game).filter(m => typeof game.isHostileMonster !== 'function' || game.isHostileMonster(m));
  const init = game.initiative;
  if (init && init.active && Array.isArray(init.order)) {
    const inOrder = new Set(init.order);
    const engaged = foes.filter(m => inOrder.has(m));
    if (engaged.length) return engaged;
  }
  return foes;
}

/** Expected damage per round from `h`'s basic attack (weapon or cantrip, whichever is better) against `foe`. */
function heroRoundDamage(game, h, foe) {
  const d = h.data;
  let best = 0;
  for (const prof of [d.lastProfile, d.weaponProfile, d.cantripProfile]) {
    if (prof) best = Math.max(best, heroAttackEv(h, prof, foe, game));
  }
  return best;
}

export function fightOutlook(game, alive = null) {
  const party = (alive || game.heroes || []).filter(a => a && a.data && a.data.hp > 0);
  const foes = fightFoes(game);
  const foeHp = foes.reduce((s, m) => s + Math.max(0, m.data.hp) + (m.data.tempHp || 0), 0);
  const partyHp = party.reduce((s, a) => s + a.data.hp + (a.data.tempHp || 0), 0);
  const key = `${game.fxNow ?? ''}|${foes.length}|${foeHp}|${party.length}|${partyHp}`;
  if (game._fightOutlook && game._fightOutlook.key === key) return game._fightOutlook.v;

  let v;
  if (!foes.length) {
    /* no fight to judge (out of combat, or a scripted check) — leave the old rules alone */
    v = { danger: 0, roundsToWin: 0, loss: 0, cleanup: false, foes: 0, why: 'no foes' };
  } else if (!party.length) {
    v = { danger: 1, roundsToWin: Infinity, loss: Infinity, cleanup: false, foes: foes.length, why: 'party down' };
  } else {
    let partyDpr = 0;
    for (const h of party) {
      let sum = 0;
      for (const m of foes) sum += heroRoundDamage(game, h, m);
      partyDpr += sum / foes.length;
    }
    const foeDpr = foes.reduce((s, m) => s + monsterDpr(m, null, game), 0);
    const roundsToWin = foeHp / Math.max(partyDpr, 0.5);
    /* the foes always get at least their next round in */
    const loss = foeDpr * Math.max(1, roundsToWin * 0.6);
    let danger = Math.min(1, loss / Math.max(partyHp, 1) / THRIFT.fullDangerLoss);
    let why = `${roundsToWin.toFixed(1)} rounds to win, ~${Math.round(loss)} of ${partyHp} party HP at stake`;
    const raise = (floor, reason) => { if (floor > danger) { danger = floor; why = reason; } };
    if ((game.heroes || []).some(a => a && a.data && a.data.hp <= 0 && !a.data.dead)) raise(0.5, 'an ally is down');
    const mortal = party.find(a => inMortalDanger(game, a));
    if (mortal) raise(0.6, `${mortal.data.name} could drop next round`);
    const boss = foes.find(m => m.isBoss && m.data.hp > m.data.maxHp * 0.3);
    if (boss) raise(0.6, `${boss.data.name} is still strong`);
    const elite = foes.find(m => typeof game.monsterEliteRoom === 'function' && game.monsterEliteRoom(m)
      && m.data.hp > m.data.maxHp * 0.5);
    if (elite) raise(0.3, `${elite.data.name} is an elite`);
    const cleanup = danger < THRIFT.cleanupDanger && roundsToWin <= THRIFT.cleanupRounds;
    v = { danger, roundsToWin, loss, cleanup, foes: foes.length, partyDpr, foeDpr, why };
  }
  game._fightOutlook = { key, v };
  return v;
}

/** True when the fight is won on paper and limited resources should stay in the pack. */
/* How far each Ability & Spell Budget setting lets a fight run down before
   resources stay in the pack. Conservative barely matters here: it spends
   nothing at all until the danger reaches CONSERVATIVE_DANGER (see
   combat.getAbilityUseWeight). */
export const BUDGET_CLEANUP = {
  conservative: { danger: THRIFT.cleanupDanger, rounds: THRIFT.cleanupRounds },
  balanced:     { danger: THRIFT.cleanupDanger, rounds: THRIFT.cleanupRounds },
  unleash:      { danger: 0.05, rounds: 1.5 },
};
export const CONSERVATIVE_DANGER = 0.5;

export function isCleanup(game, alive = null, budget = 'balanced') {
  if (!PLANNER.on || !PLANNER.thrift) return false;
  const o = fightOutlook(game, alive);
  if (!o.foes) return false;
  const b = BUDGET_CLEANUP[budget] || BUDGET_CLEANUP.balanced;
  return o.danger < b.danger && o.roundsToWin <= b.rounds;
}

/**
 * Plan a damage spell for this turn: where it goes, what it is worth, and
 * whether that beats simply attacking.
 *
 * Returns null when `key` is not a damage spell (control, buffs and healing
 * keep their own rules), otherwise
 *   { value, cost, net, basic, worth, aim, foe, targets, useful }
 *   value  HP-equivalent of everything it catches (capped, kills valued)
 *   cost   what the slot is worth (combat_eval.slotCost), 0 for a cantrip
 *   basic  the basic attack's value on the current target
 *   worth  net > basic: casting beats attacking
 */
export function offensiveSpellPlan(game, h, key, sp, foe, alive, opts = {}) {
  const prof = spellDamageProfile(key, sp);
  if (!prof) return null;
  const lvl = sp.level || 0;
  const area = spellArea(sp);
  const per = (m) => spellDamageEv(game, h, key, sp, m);
  let value = 0, aim = null, aimFoe = foe, targets = [], useful = 0;

  if (area) {
    const plan = bestAim(game, h, area, { perTarget: per, mustCover: opts.mustCover === false ? null : foe,
      maxRange: opts.maxRange });
    /* If the blast cannot include our own target, look for the best placement
       anywhere — but it then has to clear the bar on its own. */
    const p = plan || (foe ? bestAim(game, h, area, { perTarget: per, maxRange: opts.maxRange }) : null);
    if (!p) return { value: 0, cost: 0, net: -Infinity, basic: 0, worth: false, aim: null, foe, targets: [], useful: 0 };
    value = p.value; aim = p.aim; aimFoe = p.foe; targets = p.targets; useful = p.useful;
  } else if (foe) {
    const n = prof.multi > 1 ? prof.multi : 1;
    if (n > 1) {
      /* chain / multi-target spells: the primary plus the next best foes */
      const others = liveFoes(game).filter(m => m !== foe)
        .map(m => damageValue(game, m, per(m))).sort((a, b) => b - a).slice(0, n - 1);
      value = damageValue(game, foe, per(foe)) + others.reduce((s, v) => s + v, 0);
    } else {
      value = damageValue(game, foe, per(foe));
    }
    targets = [foe]; useful = effectiveHp(game, foe) > 0 ? 1 : 0;
  }

  const abilityUse = opts.abilityUse != null ? opts.abilityUse : 0.5;
  let cost = 0, cleanup = false;
  if (lvl > 0) {
    if (PLANNER.thrift) {
      /* The slot's price follows the fight's danger: 1.4× when the party is
         in no trouble, down to the old 0.5× "bring out the big guns" when it
         is. A cleanup fight doesn't spend slots at all. */
      const out = fightOutlook(game, alive);
      cleanup = out.cleanup;
      cost = slotCost(h, lvl, game, { danger: false, abilityUse }) * (1.4 - 0.9 * out.danger);
    } else {
      cost = slotCost(h, lvl, game, { danger: fightIsDangerous(game, foe, alive), abilityUse });
    }
  }
  /* A bonus-action spell doesn't replace the attack — it rides alongside it,
     so it only has to beat doing nothing with the bonus action. */
  const basic = (foe && !sp.bonusAction) ? basicAttackValue(game, h, foe, opts.profile) : 0;
  const net = value - cost;
  return { value, cost, net, basic, worth: !cleanup && net > basic, aim, foe: aimFoe, targets, useful, cleanup };
}

/* ── Target choice ────────────────────────────────────────────────────────
 * Two things the per-hero target scorer could not see:
 *
 *   Turns to reach. A foe across the room costs whole turns of not attacking.
 *   The old 0.15-per-tile nudge made a 10-tile walk cost about one kill
 *   bonus, so a fighter would leave a fight on his doorstep for a rat on the
 *   far wall. Now each extra turn of walking costs about a turn's worth of
 *   attacks on the scorer's own scale.
 *
 *   Protecting the backline. A monster in melee with a caster or a badly hurt
 *   ally is the one to deal with — and the one a melee hero is placed to deal
 *   with. That used to exist only behind the "Guard Backline" priority.
 */
const SOFT = new Set(['wizard', 'sorcerer', 'warlock', 'bard', 'druid', 'cleric']);

/** True for an ally who should not be left trading blows in melee. */
export function isSoftAlly(a) {
  if (!a || !a.data || a.data.hp <= 0) return false;
  const p = a.data.lastProfile || a.data.weaponProfile;
  const ranged = p ? !p.melee : false;
  return ranged || SOFT.has(a.data.classKey) || a.data.hp / Math.max(a.data.maxHp, 1) < 0.35;
}

/**
 * Score adjustment for `h` picking `m`, on pickHeroTarget's scale (about 1.4
 * per "clean attack"). `speed` is the hero's speed in tiles, `reach` its
 * attack reach in tiles.
 */
export function targetPlanBonus(game, h, m, alive, speed, reach, melee, pathTiles = null) {
  let bonus = 0;
  const tiles = gridDist(game, h, m);
  if (pathTiles === Infinity) {
    bonus -= 6;                                    // can't get there at all
  } else if (tiles >= 0) {
    /* the walk to an attack position, when the caller measured it; otherwise
       the grid gap to weapon reach */
    const gap = pathTiles != null ? pathTiles : Math.max(0, tiles - reach);
    /* turns of walking before the first swing: 0 if it's reachable now */
    const turns = gap <= speed ? 0 : Math.ceil((gap - speed) / Math.max(1, speed * 2));
    bonus -= turns * 1.6;
  }
  for (const a of alive || []) {
    if (a === h || !isSoftAlly(a)) continue;
    const t = gridDist(game, a, m);
    if (t >= 0 && t <= 1 && !m.data.ranged) {
      /* scaled by how hard it is hitting them: a rat nibbling the wizard is
         worth less of a detour than an ogre on top of her */
      const threat = Math.min(1, monsterDpr(m, a, game) / Math.max(4, a.data.hp * 0.5));
      bonus += (melee ? 1.8 : 0.9) * (0.5 + 0.5 * threat);
      break;
    }
  }
  return bonus;
}

export { reachTiles };

/**
 * How many tiles `foe` will close toward the party on its own before the
 * hero's next turn: a mobile melee monster walks at us, a shooter or a
 * creature that can't move does not. Feeds the Dash rule (combat.js
 * dashSavesATurn).
 */
export function foeClosingTiles(game, foe) {
  if (!foe || !foe.data || foe.data.hp <= 0 || foe.active === false) return 0;
  if (foe.data.ranged) return 0;
  if (typeof game.isDominated === 'function' && game.isDominated(foe)) return 0;
  const mods = getEffectMods(foe);
  if (mods.incapacitated || mods.restrained || hasEffect(foe, 'restrained') || hasEffect(foe, 'grappled')) return 0;
  const cells = typeof game.cellsForSpeed === 'function' ? game.cellsForSpeed(foe) : (foe.data.speedCells || 6);
  return Math.max(0, cells || 0);
}

/* ── Monster abilities ────────────────────────────────────────────────────
 * Which of a monster's ready cycle abilities to use this turn, and on whom.
 *
 *   area (aoe)  aimed at the hero with the most party members inside the
 *               radius; skipped while the party is spread out (fewer than two
 *               in the best spot) unless only one hero is left standing
 *   heal        only when the monster or an ally in reach is hurt
 *   self-buff   not while it is already up
 *   otherwise   aimed at the current target
 *
 * Returns { ab, target } or null when nothing is worth using (the monster then
 * attacks normally and the ability waits for a better moment).
 */
export function planMonsterAbility(game, m, tgt, abilities) {
  const heroes = (game.heroes || []).filter(h => h && h.data && h.data.hp > 0
    && !getEffectMods(h).invisible);
  const los = (a, b) => typeof game.hasLOS !== 'function' || game.hasLOS(a.x, a.z, b.x, b.z);
  let best = null;
  for (const ab of abilities) {
    let score = 0, target = tgt;
    if (ab.heal) {
      const allies = ab.selfOnly ? [m]
        : [m, ...(game.monsters || []).filter(o => o !== m && o.data && o.data.hp > 0 && !o.dead
          && Math.hypot(o.x - m.x, o.z - m.z) < 3.5)];
      const hurt = allies.filter(o => o.data.hp / Math.max(o.data.maxHp, 1) < 0.7);
      if (!hurt.length) continue;
      score = 2 + hurt.length;
    } else if (ab.buff) {
      const key = typeof ab.buff === 'string' ? ab.buff : ab.buff.key;
      if (key && hasEffect(m, key)) continue;
      score = 1.2;
    } else if (ab.aoe && (ab.dice || ab.effect)) {
      const reach = ab.range != null ? ab.range : 8;
      let bestN = 0, bestH = null;
      /* a pure condition only counts heroes who don't have it yet */
      const counts = (o) => !(ab.effect && !ab.dice && hasEffect(o, ab.effect.key));
      for (const c of heroes) {
        if (Math.hypot(c.x - m.x, c.z - m.z) > reach || !los(m, c)) continue;
        const n = heroes.filter(o => counts(o) && Math.hypot(o.x - c.x, o.z - c.z) <= ab.aoe).length;
        if (n > bestN || (n === bestN && c === tgt)) { bestN = n; bestH = c; }
      }
      if (!bestH) continue;
      if (bestN < 2 && heroes.length >= 2) continue;      // wait for a clump
      score = 2 + bestN * 1.5;
      target = bestH;
    } else if (ab.effect && !ab.dice) {
      /* single-target condition: never on a hero who already has it */
      const key = ab.effect.key;
      const reach = ab.range != null ? ab.range : 8;
      const fresh = (c) => c && c.data && c.data.hp > 0 && !hasEffect(c, key)
        && Math.hypot(c.x - m.x, c.z - m.z) <= reach && los(m, c);
      target = fresh(tgt) ? tgt : heroes.find(fresh);
      if (!target) continue;
      score = 1.6;
    } else {
      score = 1.5;
    }
    score += Math.random() * 0.3;                        // variety between equals
    if (!best || score > best.score) best = { ab, target, score };
  }
  return best ? { ab: best.ab, target: best.target } : null;
}

/* ══ Phase 2 — roles, formation, triage ═══════════════════════════════════
 * A party fights as a shape, not as four duellists. Each hero gets a role from
 * its build, and the role changes what a good turn looks like:
 *
 *   tank       stands between the monsters and the soft heroes: prefers the
 *              foe about to reach a caster, and is pulled back from fights
 *              far from the backline while the backline is under threat
 *   healer     heals whoever is about to drop (or is down), not whoever has
 *              the lowest HP fraction; skips heals that would mostly overheal
 *   artillery  shoots from tiles the monsters can't easily reach
 *   striker    unchanged: damage, finishing kills
 *
 * Roles are derived, never stored, so respeccing or swapping gear changes the
 * role on the next turn. The AI Priorities tab is the place to override them
 * (Phase 5).
 */
const TANK_CLASSES = new Set(['fighter', 'paladin', 'barbarian']);
const HEAL_SPELLS = new Set(['cureWounds', 'healingWord', 'massHealingWord', 'massCureWounds', 'heal',
  'regenerate', 'massHeal', 'powerWordHeal']);

/** 'tank' | 'healer' | 'artillery' | 'striker' for a hero. */
export const HERO_ROLES = ['tank', 'healer', 'artillery', 'striker'];

/** The role the player picked in the AI Priorities tab, or null for Auto. */
export function roleOverride(h) {
  const r = h && h.data && h.data.aiPrefs && h.data.aiPrefs.role;
  return HERO_ROLES.includes(r) ? r : null;
}

export function heroRole(h) {
  const d = h && h.data;
  if (!d) return 'striker';
  const picked = roleOverride(h);
  if (picked) return picked;
  const prof = d.lastProfile || d.weaponProfile;
  const melee = prof ? !!prof.melee : !d.cantripProfile;
  const heavy = !!(d.equipment && d.equipment.armor && d.equipment.armor.prof === 'heavy');
  const shield = !!(d.equipment && d.equipment.offhand && d.equipment.offhand.slot === 'shield');   // features.hasShieldEquipped
  if (melee && (TANK_CLASSES.has(d.classKey) || heavy || shield)) return 'tank';
  if ((d.knownSpells || []).some(k => HEAL_SPELLS.has(k))) return 'healer';
  return melee ? 'striker' : 'artillery';
}

/**
 * Extra target value for a TANK on `m`, on pickHeroTarget's scale.
 *   interception: m is not yet on a soft ally but will reach one this round
 *                 (its speed + 1 tile), and no other tank is already on it
 *   leash:        m is far from every soft ally while some OTHER monster is
 *                 within a round of one — going after m leaves the backline
 */
export function tankFormationBonus(game, h, m, alive) {
  /* Only real backliners — casters and shooters. A striker on low HP is not
     who the tank should abandon its own fight for. */
  const soft = (alive || []).filter(a => a !== h && a.data && a.data.hp > 0
    && heroRole(a) !== 'tank' && heroRole(a) !== 'striker');
  if (!soft.length || !m || !m.data) return 0;
  /* A tank already toe-to-toe with something holds it: peeling off to
     intercept costs an opportunity attack and lets the first monster walk
     straight past onto the casters — the dungeon sims showed this doubling
     knockdowns. The interception is for a tank that is free. */
  const engaged = (game.monsters || []).some(o => o.active !== false && o.data && o.data.hp > 0
    && !o.data.ranged && gridDist(game, h, o) >= 0 && gridDist(game, h, o) <= 1);
  const speedOf = (e) => (typeof game.cellsForSpeed === 'function' ? game.cellsForSpeed(e) : 6) || 6;
  const nearestSoft = (e) => {
    let best = Infinity;
    for (const a of soft) { const t = gridDist(game, a, e); if (t >= 0 && t < best) best = t; }
    return best;
  };
  const mobile = (e) => !e.data.ranged && !getEffectMods(e).incapacitated;
  let bonus = 0;
  const dm = nearestSoft(m);
  if (!engaged && mobile(m) && dm > 1 && dm <= speedOf(m) + 1) {
    const otherTankOn = (alive || []).some(a => a !== h && heroRole(a) === 'tank' && gridDist(game, a, m) <= 1);
    if (!otherTankOn) bonus += 1.4;
  }
  if (!engaged && dm > 8) {
    const backlineThreat = (game.monsters || []).some(o => o !== m && o.active !== false && o.data && o.data.hp > 0
      && mobile(o) && nearestSoft(o) <= speedOf(o) + 1);
    if (backlineThreat) bonus -= 1.5;
  }
  return bonus;
}

/**
 * How dangerous it is for a ranged hero to stand on `cell`: expected damage
 * from the mobile melee monsters that could be swinging at it next round,
 * plus a heavy surcharge for a tile already in someone's reach. Used to rank
 * firing positions (combat.js heroApproachRoute). Units: HP.
 */
export function standRisk(game, h, cell) {
  if (cell < 0 || !game.D) return 0;
  const W = game.D.W;
  const cx = cell % W, cy = Math.floor(cell / W);
  let risk = 0;
  for (const m of game.monsters || []) {
    if (!m || !m.data || m.data.hp <= 0 || m.active === false || m.data.ranged) continue;
    if (typeof game.isDominated === 'function' && game.isDominated(m)) continue;
    if (getEffectMods(m).incapacitated) continue;
    const mc = game.cellOf(m.x, m.z);
    if (mc < 0) continue;
    const t = Math.max(Math.abs((mc % W) - cx), Math.abs(Math.floor(mc / W) - cy));
    const speed = (typeof game.cellsForSpeed === 'function' ? game.cellsForSpeed(m) : 6) || 6;
    if (t <= 1) risk += monsterDpr(m, h, game) * 1.5 + 3;   // in its face right now
    else if (t <= speed + 1) risk += monsterDpr(m, h, game) * 0.5;
  }
  return risk;
}

/* Average healing of a heal spell (dice from its description + the caster's
   casting modifier), for triage. */
function healAverage(h, sp) {
  const m = (sp && sp.desc || '').match(/(\d+)d(\d+)/);
  const fixed = (sp && sp.desc || '').match(/restores (\d+) HP/);
  const d = h.data || {};
  const castMod = mod(d.effStats?.[d._classAtk || 'wis'] ?? 10);
  if (fixed) return +fixed[1];
  if (m) return (+m[1]) * ((+m[2]) + 1) / 2 + castMod + (d.healBonus || 0);
  return 8;
}

/**
 * Who a heal should go to. Value per candidate, in HP terms:
 *   down (0 HP)        their whole next turn back, and no death saves: top
 *   about to drop      (combat_eval.inMortalDanger) the heal plus a turn saved
 *   otherwise          the HP it actually restores (overheal is worth nothing)
 *
 * Returns { target, value, urgent, heal } or null. `urgent` is false when nobody
 * is down or in danger — then a heal that would mostly overheal is not cast.
 */
export function healTriage(game, healer, alive, sp) {
  const heal = healAverage(healer, sp);
  const cands = [...(alive || []), ...(game.heroes || []).filter(x => x && x.data && x.data.hp <= 0 && !x.data.dead)];
  let best = null;
  for (const a of cands) {
    if (!a || !a.data) continue;
    const missing = Math.max(0, a.data.maxHp - a.data.hp);
    if (missing <= 0) continue;
    const useful = Math.min(heal, missing);
    let value, urgent = false;
    if (a.data.hp <= 0) { value = useful + 20; urgent = true; }
    else if (inMortalDanger(game, a)) { value = useful + 12; urgent = true; }
    else value = useful * (incomingPressure(game, a) > 0 ? 0.8 : 0.5);
    if (!best || value > best.value) best = { target: a, value, urgent, heal, useful };
  }
  return best;
}


/* ══ Phase 3 — monster target reach ═══════════════════════════════════════
 * Score adjustment for monster `m` picking hero `h`, on pickMonsterTarget's
 * scale (about one point per tile of distance, and per point of threat).
 *
 *   +3     it can hit them this turn: a shooter in range with a clear line,
 *          a melee monster whose walk to them fits its movement
 *   -2/turn  each extra turn of walking when the route is much longer than
 *          the straight line (a wall in between)
 *   -25    no route at all
 *
 * Routes are only worked out on the monster's own turn and for heroes beyond
 * one move, and cached for that turn: pickMonsterTarget runs every frame.
 */
export function monsterTargetReach(game, m, h) {
  if (!m || !m.data || !h || !h.data) return 0;
  const g = gridDist(game, m, h);
  if (g < 0) return 0;
  const speed = (typeof game.cellsForSpeed === 'function' ? game.cellsForSpeed(m) : 6) || 6;
  if (m.data.ranged) {
    const range = Math.round(m.data.rngRange || 6);
    const los = typeof game.hasLOS !== 'function' || game.hasLOS(m.x, m.z, h.x, h.z);
    return g <= range && los ? 3 : 0;
  }
  if (g <= 1) return 3;
  const live = typeof game.isCurrentActor === 'function' && game.initiative && game.initiative.active
    && game.isCurrentActor(m);
  if (!live) return g - 1 <= speed ? 3 : 0;
  const ini = game.initiative;
  const key = `${ini.round}:${ini.idx}`;
  if (!m._reachCache || m._reachCache.key !== key) m._reachCache = { key, map: new Map() };
  let tiles = m._reachCache.map.get(h);
  if (tiles === undefined) {
    const goal = typeof game.approachCellNear === 'function'
      ? game.approachCellNear(game.cellOf(h.x, h.z), m) : game.cellOf(h.x, h.z);
    const route = typeof game.findPath === 'function'
      ? game.findPath(game.cellOf(m.x, m.z), goal, { avoidClosedDoors: true, mover: m }) : null;
    tiles = route ? Math.max(0, route.length - 1) : Infinity;
    m._reachCache.map.set(h, tiles);
  }
  if (tiles === Infinity) return -25;
  const budget = m.moveLeft != null ? m.moveLeft : speed;
  if (tiles <= budget) return 3;
  const detour = Math.max(0, tiles - g);
  return -2 * Math.ceil(detour / Math.max(1, speed));
}
