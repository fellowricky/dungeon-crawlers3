/**
 * AI-quality metrics for the headless simulator.
 *
 * These measure *decision quality*, not power. A party can win while playing
 * badly (and a stronger party masks a worse AI), so class-balance numbers alone
 * can't tell you whether the combat AI improved. These can:
 *
 *   wastedTurns    turns that spent the Action and produced nothing —
 *                  no damage, no healing, no condition applied. The Disengage
 *                  problem shows up here directly.
 *   overkillDmg    damage dealt past a target's remaining HP. High = the party
 *                  is not coordinating its focus fire.
 *   aoeTargets     monsters actually caught per AoE cast. ~1.0 means AoE spells
 *                  are being used as expensive single-target spells.
 *   slotValue      (damage + healing) per spell-slot LEVEL spent. Catches
 *                  dumping high-level slots on trash.
 *   overlaps       frames where two live bodies shared a cell.
 *
 * Implemented by monkey-patching a HeadlessGame instance so no metrics code
 * lives in src/. Call attachAiMetrics(game) after construction, then read
 * game.aiStats.
 */
import { SPELLS } from '../src/game/spells.js';
import { Trace } from '../src/game/ai_trace.js';
import { hasEffect } from '../src/game/conditions.js';
import { heroAttackEv, gridDist, inMortalDanger } from '../src/game/combat_eval.js';
import { spellDamageProfile, spellArea, fightOutlook } from '../src/game/turn_planner.js';

export function makeAiStats() {
  return {
    turns: 0,
    wastedTurns: 0,
    heroTurns: 0,
    heroWastedTurns: 0,
    commonActions: { dash: 0, dodge: 0, disengage: 0 },
    heroCommonActions: { dash: 0, dodge: 0, disengage: 0 },
    dmgToMonsters: 0,
    overkillDmg: 0,
    aoeCasts: 0,
    aoeTargetsHit: 0,
    spellCasts: 0,
    slotLevelsSpent: 0,
    wonFightSlots: 0,      // leveled casts while the fight was already won on paper (fightOutlook.cleanup)
    wonFightSlotLevels: 0,
    wonFightPotions: 0,    // trinket potions drunk in the same state
    potionsDrunk: 0,
    slotValue: 0,          // damage + healing produced while a leveled spell resolved
    overlapFrames: 0,
    restingOverlapFrames: 0,
    stillFrames: 0,
    offCentreFrames: 0,
    offCentreTotal: 0,
    attacksOnCorpses: 0,
    rangedRestFrames: 0,
    rangedInMeleeFrames: 0,
    /* The four behaviours Zenu reported (docs/AI_REVIEW.md). */
    loneAoE: 0,              // AoE casts that caught at most one creature
    loneAoEBy: {},           // ... by spell key
    slotOnWeak: 0,           // leveled spell on a foe the basic attack would likely finish
    slotOnWeakBy: {},
    leveledTargeted: 0,      // leveled casts with a monster target (denominator)
    backtrackTurns: 0,       // walked out >=2 tiles and ended back near the start
    dashBacktrack: 0,        // ... on a turn that spent the Action on Dash
    movedTurns: 0,
    monsterAoECasts: 0,
    monsterAoETargets: 0,
    monsterLoneAoE: 0,
    casterExposedTurns: 0,   // melee hero ended its turn away from a caster under melee attack it could have reached
    guardChecks: 0,
    encounters: 0,
    rounds: 0,
    wipes: 0,
    victories: 0,
    timeouts: 0,
  };
}

/** Merge b into a (used to fold per-encounter stats into a campaign total). */
export function mergeAiStats(a, b) {
  for (const k of Object.keys(b)) {
    if (typeof b[k] === 'number') a[k] = (a[k] || 0) + b[k];
    else if (b[k] && typeof b[k] === 'object') {
      a[k] = a[k] || {};
      for (const kk of Object.keys(b[k])) a[k][kk] = (a[k][kk] || 0) + b[k][kk];
    }
  }
  return a;
}

export function attachAiMetrics(game) {
  const stats = makeAiStats();
  game.aiStats = stats;

  /* Per-turn accumulator: what did the actor whose spotlight this is actually
     produce? Reset by _beginTurn, judged by the next _beginTurn. */
  let turn = null;
  const flushTurn = () => {
    if (!turn) return;
    stats.turns++;
    const isHero = turn.side === 'hero';
    const a = turn.actor;
    if (!isHero && turn.couldHit) {
      stats.monsterHitChances = (stats.monsterHitChances || 0) + 1;
      if (!turn.attacked) {
        stats.monsterIdle = (stats.monsterIdle || 0) + 1;
        if (game.__idleSamples && game.__idleSamples.length < 40 && a && a.data) {
          const nearest = Math.min(...game.heroes.filter(h => h.data.hp > 0).map(h => gridDist(game, a, h)));
          game.__idleSamples.push({ name: a.data.name, style: a.data.tactics || (a.data.ranged ? 'ranged' : ''),
            moved: +turn.maxD.toFixed(1), nearest, actUsed: !!a.actUsed, dashed: turn.dashed,
            moveLeft: a.moveLeft, who: a.__who, inc: !!(a._effects && Object.keys(a._effects).join(',')),
            fx: a._effects ? Object.keys(a._effects).join(',') : '', trace: (turn.trace || []).slice(-5) });
        }
      }
    }
    /* Across turns: this turn's move undoes the last one (pointing back the
       way it came), and the last one was a Dash. That is the "dashes out,
       then walks back" the eye picks up even when each turn alone looks fine. */
    if (a && a.data) {
      const vx = a.x - turn.sx, vz = a.z - turn.sz, len = Math.hypot(vx, vz);
      const prev = a.__lastTurnMove;
      if (prev && len >= 2 && prev.len >= 2) {
        const dot = (vx * prev.vx + vz * prev.vz) / (len * prev.len);
        if (dot < -0.5) {
          const k = isHero ? 'heroReversals' : 'monsterReversals';
          stats[k] = (stats[k] || 0) + 1;
          if (prev.dashed) stats[k + 'AfterDash'] = (stats[k + 'AfterDash'] || 0) + 1;
          /* the ones the eye actually catches: four tiles out, four back */
          if (len >= 4 && prev.len >= 4) stats[k + 'Big'] = (stats[k + 'Big'] || 0) + 1;
          if (game.__backtrackSamples && game.__backtrackSamples.length < 12 && (prev.dashed || game.__sampleAllReversals)) {
            game.__backtrackSamples.push({ name: a.data.name, side: turn.side, dashed: prev.dashed, reversal: true,
              maxD: +prev.len.toFixed(2), net: +len.toFixed(2), trace: [...(prev.trace || []).slice(-6), '-- next turn --', ...(turn.trace || []).slice(-8)] });
          }
        }
      }
      a.__lastTurnMove = { vx, vz, len, dashed: turn.dashed, trace: turn.trace };
    }
    if (isHero && a && a.data) {
      /* Walk-out-and-back: the hero got at least two tiles from where it began
         and finished the turn most of the way back there. */
      const net = Math.hypot(a.x - turn.sx, a.z - turn.sz);
      if (turn.maxD >= 1.5) {
        stats.movedTurns++;
        if (turn.maxD >= 2 && net <= turn.maxD - 1.5) {
          stats.backtrackTurns++;
          if (turn.dashed) stats.dashBacktrack++;
        }
      }
      judgeGuard(a);
    } else if (a && a.data && turn.maxD >= 1.5) {
      const net = Math.hypot(a.x - turn.sx, a.z - turn.sz);
      stats.monsterMovedTurns = (stats.monsterMovedTurns || 0) + 1;
      if (turn.maxD >= 2 && net <= turn.maxD - 1.5) {
        stats.monsterBacktrack = (stats.monsterBacktrack || 0) + 1;
        if (turn.dashed) stats.monsterDashBacktrack = (stats.monsterDashBacktrack || 0) + 1;
      }
    }
    /* keep a sample of backtracking turns, with the actor's decisions, for diagnosis */
    if (a && a.data && turn.maxD >= 2 && Math.hypot(a.x - turn.sx, a.z - turn.sz) <= turn.maxD - 1.5
        && game.__backtrackSamples && game.__backtrackSamples.length < 12) {
      game.__backtrackSamples.push({ name: a.data.name, side: turn.side, dashed: turn.dashed,
        maxD: +turn.maxD.toFixed(2), net: +Math.hypot(a.x - turn.sx, a.z - turn.sz).toFixed(2),
        trace: (turn.trace || []).slice(-14) });
    }
    if (isHero) stats.heroTurns++;
    /* "Wasted" = the Action was spent and nothing came of it. A turn that only
       moved is NOT wasted (repositioning is legitimate); a turn that spent the
       Action to no effect is. */
    if (turn.actUsed && !turn.produced) {
      stats.wastedTurns++;
      if (isHero) stats.heroWastedTurns++;
    }
    turn = null;
  };

  const origBegin = game._beginTurn.bind(game);
  game._beginTurn = function () {
    flushTurn();
    const r = origBegin();
    const cur = this._currentActor && this._currentActor();
    turn = {
      actor: cur,
      side: cur && cur._side === 'hero' ? 'hero' : 'monster',
      actUsed: false,
      produced: false,
      dashed: false,
      sx: cur ? cur.x : 0, sz: cur ? cur.z : 0, maxD: 0,
      attacked: false,
      couldHit: false,
    };
    if (cur && cur.data && this.monsters.includes(cur) && cur.active && !cur.dominatedBy) {
      const speed = typeof this.cellsForSpeed === 'function' ? this.cellsForSpeed(cur) : 6;
      const range = cur.data.ranged ? Math.round(cur.data.rngRange || 6) : 1;
      turn.couldHit = this.heroes.some(h => {
        if (!h.data || h.data.hp <= 0) return false;
        const t = gridDist(this, cur, h);
        if (t < 0) return false;
        if (cur.data.ranged) return t <= range && (typeof this.hasLOS !== 'function' || this.hasLOS(cur.x, cur.z, h.x, h.z));
        return t <= speed + 1;
      });
    }
    stats.rounds = Math.max(stats.rounds, (this.initiative && this.initiative.round) || 0);
    return r;
  };

  /* Dash / Dodge / Disengage — the tactical fallbacks. */
  const origCommon = game.takeCommonAction.bind(game);
  game.takeCommonAction = function (e, kind) {
    const ok = origCommon(e, kind);
    if (ok && kind === 'dash' && turn && turn.actor === e) turn.dashed = true;
    if (ok && stats.commonActions[kind] != null) {
      stats.commonActions[kind]++;
      if (e && e._side === 'hero') stats.heroCommonActions[kind]++;
      if (turn && turn.actor === e) turn.actUsed = true;
    }
    return ok;
  };

  /* Damage to monsters: overkill is anything past remaining HP. */
  const origDamage = game.damageMonster.bind(game);
  game.damageMonster = function (m, dmg, h, crit, opts) {
    const before = (m && m.data && m.data.hp) || 0;
    if (before <= 0) stats.attacksOnCorpses = (stats.attacksOnCorpses || 0) + 1;
    const r = origDamage(m, dmg, h, crit, opts);
    const applied = Math.max(0, before - ((m && m.data && m.data.hp) || 0));
    const wasted = Math.max(0, (dmg || 0) - before);
    stats.dmgToMonsters += applied;
    stats.overkillDmg += wasted;
    if (spellDepth > 0) stats.spellOverkill = (stats.spellOverkill || 0) + wasted;
    if (turn && turn.actor === h) turn.produced = true;
    if (spellDepth > 0) { spellDamageDealt += applied; spellTargets.add(m); }
    return r;
  };

  /* Healing counts as production too, so a healer's turn isn't "wasted". */
  const origHeal = game.healHero.bind(game);
  game.healHero = function (a, amt, healer) {
    /* Phase 2: was the heal wasted (overheal), and did it go to the right ally?
       A triage miss is healing someone who was in no danger while another
       ally was down or about to drop. */
    const before = (a && a.data && a.data.hp) || 0;
    const urgent = (x) => x && x.data && (x.data.hp <= 0 || inMortalDanger(this, x));
    if (amt > 0 && a && a.data && this.heroes.includes(a)) {
      stats.heals = (stats.heals || 0) + 1;
      const others = this.heroes.filter(x => x !== a && x.data && !x.data.dead && urgent(x));
      /* only heals cast by one hero on another can be misdirected */
      if (healer && healer !== a) {
        stats.allyHeals = (stats.allyHeals || 0) + 1;
        if (!urgent(a) && others.length) stats.triageMiss = (stats.triageMiss || 0) + 1;
      }
    }
    const r = origHeal(a, amt, healer);
    if (amt > 0 && a && a.data && this.heroes.includes(a)) {
      const gained = Math.max(0, a.data.hp - before);
      stats.healRolled = (stats.healRolled || 0) + amt;
      stats.overheal = (stats.overheal || 0) + Math.max(0, amt - gained);
    }
    if (turn && turn.actor && amt > 0) turn.produced = true;
    if (spellDepth > 0) spellDamageDealt += amt || 0;
    return r;
  };

  /* Spell resolution: measure AoE coverage and slot value. Re-entrant-safe
     (a spell may trigger another) via a depth counter. */
  let spellDepth = 0;
  let spellDamageDealt = 0;
  let spellTargets = new Set();
  const origResolve = game.resolveSpell.bind(game);
  game.resolveSpell = function (h, key, foe, alive, opts) {
    const outerDamage = spellDamageDealt, outerTargets = spellTargets;
    if (spellDepth === 0) { spellDamageDealt = 0; spellTargets = new Set(); }
    /* Snapshot before the spell resolves: would the hero's ordinary attack
       probably have finished this foe anyway? */
    let weakFoe = false;
    const spPre = SPELLS[key];
    if (spellDepth === 0 && spPre && spPre.level > 0 && foe && foe.data && foe.data.hp > 0
        && this.monsters.includes(foe) && h && h.data) {
      stats.leveledTargeted++;
      const prof = h.data.weaponProfile || h.data.cantripProfile || h.data.lastProfile;
      const ev = prof ? heroAttackEv(h, prof, foe, this) : 0;
      /* single-target damage spells only — an area spell aimed through a weak
         foe can still be worth it for the others it catches (loneAoE covers
         the bad case), and control spells are not judged on damage */
      const single = !!spellDamageProfile(key, spPre) && !spellArea(spPre);
      if (single && ev > 0 && foe.data.hp <= ev) weakFoe = true;
    }
    /* Measured whether or not the cleanup rule is switched on, so the A/B
       shows how often a won fight still drew a slot. */
    const wonFight = spellDepth === 0 && spPre && spPre.level > 0 && h && this.heroes.includes(h)
      && fightOutlook(this, this.heroes.filter(a => a.data.hp > 0)).cleanup;
    spellDepth++;
    let ok = false;
    try {
      ok = origResolve(h, key, foe, alive, opts);
    } finally {
      spellDepth--;
      if (spellDepth === 0) {
        if (ok) {
          const sp = SPELLS[key];
          const level = (sp && sp.level) || 0;
          const isAoE = !!(sp && (sp.aoeRadius || (sp.ai && sp.ai.when === 'cluster')));
          stats.spellCasts++;
          if (isAoE) {
            stats.aoeCasts++;
            stats.aoeTargetsHit += spellTargets.size;
            if (spellTargets.size <= 1) {
              stats.loneAoE++;
              stats.loneAoEBy[key] = (stats.loneAoEBy[key] || 0) + 1;
            }
          }
          if (weakFoe) {
            stats.slotOnWeak++;
            stats.slotOnWeakBy[key] = (stats.slotOnWeakBy[key] || 0) + 1;
          }
          if (level > 0 && wonFight) { stats.wonFightSlots++; stats.wonFightSlotLevels += level; }
          if (level > 0) {
            stats.slotLevelsSpent += level;
            stats.slotValue += spellDamageDealt;
          }
          if (spellDamageDealt > 0 && turn && turn.actor === h) turn.produced = true;
        }
        spellDamageDealt = outerDamage;
        spellTargets = outerTargets;
      }
    }
    return ok;
  };

  if (typeof game._usePotion === 'function') {
    const origPotion = game._usePotion.bind(game);
    game._usePotion = function (h, potion) {
      const won = fightOutlook(this, this.heroes.filter(a => a.data.hp > 0)).cleanup;
      const ok = origPotion(h, potion);
      if (ok) { stats.potionsDrunk++; if (won) stats.wonFightPotions++; }
      return ok;
    };
  }

  /* Weapon attacks mark production through damageMonster. Conditions applied
     without damage (Hold Person, Faerie Fire…) also count as a real turn. */
  const origSpellSave = game.spellSave.bind(game);
  game.spellSave = function (entity, ability, dc, opts) {
    const saved = origSpellSave(entity, ability, dc, opts);
    if (spellDepth > 0 && entity && this.monsters.includes(entity)) spellTargets.add(entity);
    if (!saved && turn) turn.produced = true;   // failed save = the spell landed
    return saved;
  };

  /* Per-frame body-overlap check — the occupancy invariant. */
  const origTick = game.tick.bind(game);
  game.tick = function (dt) {
    const r = origTick(dt);
    for (const h of this.heroes) {
      const hp = (h.data && h.data.hp) || 0;
      if (h.__prevHp > 0 && hp <= 0) stats.heroDowns = (stats.heroDowns || 0) + 1;
      h.__prevHp = hp;
    }
    if (turn && turn.actor) {
      const d = Math.hypot(turn.actor.x - turn.sx, turn.actor.z - turn.sz);
      if (d > turn.maxD) turn.maxD = d;
    }
    const seen = new Map();
    const check = (e) => {
      if (!e || !e.data || e.data.hp <= 0) return;
      if (e.active === false) return;
      const c = this.cellOf(e.x, e.z);
      if (c < 0) return;
      const other = seen.get(c);
      if (other) {
        stats.overlapFrames++;
        /* The one that actually shows: two bodies STOPPED on one tile. A pair
           crossing the same square mid-stride is invisible at walking speed and
           is legal 5e movement (you may pass through an ally). */
        const still = (x) => !x.moving && !x.walk;
        if (still(e) && still(other)) stats.restingOverlapFrames++;
      } else seen.set(c, e);
    };
    /* Ranged heroes standing inside melee range of a live monster. A shooter
       that has come to rest toe-to-toe with something has either run past its
       target or failed to keep its distance. */
    for (const h of this.heroes) {
      if (!h || !h.data || h.data.hp <= 0) continue;
      if (h.moving || h.walk) continue;
      const prof = h.data.lastProfile;
      if (!prof || prof.melee) continue;
      stats.rangedRestFrames++;
      for (const m of this.monsters) {
        if (!m || !m.active || !m.data || m.data.hp <= 0) continue;
        const dx = Math.abs(this.cellOf(h.x, h.z) % this.D.W - this.cellOf(m.x, m.z) % this.D.W);
        const dy = Math.abs(Math.floor(this.cellOf(h.x, h.z) / this.D.W) - Math.floor(this.cellOf(m.x, m.z) / this.D.W));
        if (Math.max(dx, dy) <= 1) { stats.rangedInMeleeFrames++; break; }
      }
    }

    /* Off-centre settling: a stopped body that is not on its tile's centre.
       This is what reads as "jittering about until it shifts to the middle" —
       the correction is visible because it happens after the body has already
       come to rest. */
    const W = this.D.W;
    for (const e of [...this.heroes, ...this.monsters]) {
      if (!e || !e.data || e.data.hp <= 0 || e.active === false) continue;
      if (e.moving || e.walk) continue;
      const c = this.cellOf(e.x, e.z);
      if (c < 0) continue;
      const off = Math.hypot(this.wx(c % W) - e.x, this.wz(Math.floor(c / W)) - e.z);
      stats.stillFrames++;
      if (off > 0.05) stats.offCentreFrames++;
      stats.offCentreTotal += off;
    }
    for (const h of this.heroes) check(h);
    for (const m of this.monsters) check(m);
    return r;
  };

  /* Monster attacks mark the turn as productive; hero opportunity attacks
     on monsters count the free hits monsters walk into. */
  for (const fn of ['monsterAttack', 'monsterRangedAttack']) {
    if (typeof game[fn] !== 'function') continue;
    const orig = game[fn].bind(game);
    game[fn] = function (m, h, ...rest) {
      if (turn && turn.actor === m) turn.attacked = true;
      return orig(m, h, ...rest);
    };
  }
  if (typeof game.heroAttackRoll === 'function') {
    const origRoll = game.heroAttackRoll.bind(game);
    game.heroAttackRoll = function (h, foe, alive, opts = {}) {
      if (opts && opts.opportunity && foe && this.monsters.includes(foe)) {
        stats.oaOnMonsters = (stats.oaOnMonsters || 0) + 1;
      }
      return origRoll(h, foe, alive, opts);
    };
  }

  /* Monster area abilities: how many heroes does each one actually catch? */
  if (typeof game._castAbilityFx === 'function') {
    const origCast = game._castAbilityFx.bind(game);
    game._castAbilityFx = function (m, tgt, fx, label, k) {
      if (turn && turn.actor === m) turn.attacked = true;
      if (fx && this.monsters.includes(m)) {
        stats.monsterAbilities = (stats.monsterAbilities || 0) + 1;
        /* a condition the target already has: the ability did nothing */
        const key = fx.effect && fx.effect.key;
        if (key && !fx.aoe && tgt && hasEffect(tgt, key)) stats.monsterRedundant = (stats.monsterRedundant || 0) + 1;
        if (key && fx.aoe && tgt) {
          const inside = this.heroes.filter(h => h.data && h.data.hp > 0 && Math.hypot(h.x - tgt.x, h.z - tgt.z) <= fx.aoe);
          if (inside.length && inside.every(h => hasEffect(h, key))) stats.monsterRedundant = (stats.monsterRedundant || 0) + 1;
        }
        if (fx.heal) {
          const hurt = [m, ...this.monsters.filter(o => o !== m && o.data && o.data.hp > 0 && Math.hypot(o.x - m.x, o.z - m.z) < 3.5)]
            .some(o => o.data.hp < o.data.maxHp * 0.8);
          if (!hurt) stats.monsterRedundant = (stats.monsterRedundant || 0) + 1;
        }
      }
      if (fx && fx.aoe && tgt && this.monsters.includes(m)) {
        const n = this.heroes.filter(h => h.data && h.data.hp > 0
          && Math.hypot(h.x - tgt.x, h.z - tgt.z) <= fx.aoe).length;
        stats.monsterAoECasts++;
        stats.monsterAoETargets += n;
        if (n <= 1) stats.monsterLoneAoE++;
      }
      return origCast(m, tgt, fx, label, k);
    };
  }

  /* A melee hero ends its turn. Is a caster ally being hit in melee by a
     monster this hero could have reached this turn, while the hero stands well
     away from that caster? That is "the tank abandons the backline". */
  function judgeGuard(a) {
    const prof = a.data.lastProfile;
    if (!prof || !prof.melee) return;
    const speed = typeof game.cellsForSpeed === 'function' ? game.cellsForSpeed(a) : 6;
    for (const c of game.heroes) {
      if (c === a || !c.data || c.data.hp <= 0) continue;
      const cp = c.data.lastProfile;
      if (!cp || cp.melee) continue;
      const attackers = game.monsters.filter(m => m.active && m.data && m.data.hp > 0 && !m.data.ranged
        && gridDist(game, m, c) >= 0 && gridDist(game, m, c) <= 1);
      if (!attackers.length) continue;
      stats.guardChecks++;
      const reachable = attackers.some(m => { const t = gridDist(game, a, m); return t >= 0 && t <= speed + 1; });
      const away = gridDist(game, a, c);
      const helping = attackers.some(m => gridDist(game, a, m) <= 1);
      if (reachable && !helping && away > 4) {
        stats.casterExposedTurns++;
        /* already toe-to-toe with something else: leaving costs an
           opportunity attack, so staying can be the right call */
        const engaged = game.monsters.some(m => m.active && m.data && m.data.hp > 0 && !m.data.ranged && gridDist(game, a, m) <= 1);
        if (!engaged) stats.casterExposedFree = (stats.casterExposedFree || 0) + 1;
        const role = a.data.classKey;
        stats.casterExposedBy = stats.casterExposedBy || {};
        stats.casterExposedBy[role] = (stats.casterExposedBy[role] || 0) + 1;
      }
    }
  }

  /* Optional: route the AI trace into the current turn, so a sampled bad turn
     carries the decisions that produced it (sim/dungeon_probe.mjs). */
  game.__traceTurns = () => {
    Trace.enable(true);
    Trace.sink = (e, ev, why) => { if (turn && turn.actor === e) (turn.trace || (turn.trace = [])).push(`${ev}: ${why}`); };
  };

  game._flushAiTurn = flushTurn;
  return stats;
}

function topKeys(o, n = 5) {
  const e = Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
  return e.length ? '[' + e.map(([k, v]) => `${k} ${v}`).join(', ') + ']' : '';
}

/** Format the collected stats as report lines. */
export function formatAiMetrics(s) {
  const pct = (a, b) => (b > 0 ? (100 * a / b).toFixed(1) + '%' : '—');
  const per = (a, b) => (b > 0 ? (a / b).toFixed(2) : '—');
  return [
    `Hero turns:            ${s.heroTurns}`,
    `Wasted hero turns:     ${s.heroWastedTurns} (${pct(s.heroWastedTurns, s.heroTurns)})`,
    `Hero Disengage:        ${s.heroCommonActions.disengage}  (${per(s.heroCommonActions.disengage, s.heroTurns)}/turn)`,
    `Hero Dodge / Dash:     ${s.heroCommonActions.dodge} / ${s.heroCommonActions.dash}`,
    `Damage to monsters:    ${Math.round(s.dmgToMonsters)}`,
    `Overkill damage:       ${Math.round(s.overkillDmg)} (${pct(s.overkillDmg, s.dmgToMonsters + s.overkillDmg)} of damage rolled)`,
    `  ...from spells:      ${Math.round(s.spellOverkill || 0)}`,
    `AoE casts:             ${s.aoeCasts}`,
    `Avg targets per AoE:   ${per(s.aoeTargetsHit, s.aoeCasts)}`,
    `Slot levels spent:     ${s.slotLevelsSpent}`,
    `Value per slot level:  ${per(s.slotValue, s.slotLevelsSpent)}`,
    `Slots in a won fight:  ${s.wonFightSlots} casts, ${s.wonFightSlotLevels} slot levels (${pct(s.wonFightSlotLevels, s.slotLevelsSpent)} of all)`,
    `Potions in a won fight: ${s.wonFightPotions} of ${s.potionsDrunk}`,
    `Body-overlap frames:   ${s.overlapFrames} (in transit — legal, invisible)`,
    `RESTING overlap frames:${String(s.restingOverlapFrames).padStart(7)}  <- the visible artefact`,
    `Off-centre while still: ${pct(s.offCentreFrames, s.stillFrames)} of stopped frames (avg ${s.stillFrames ? (s.offCentreTotal / s.stillFrames).toFixed(3) : '-'} tiles off)`,
    `Ranged hero in melee:  ${pct(s.rangedInMeleeFrames, s.rangedRestFrames)} of their stopped frames`,
    `Attacks on corpses:    ${s.attacksOnCorpses}`,
    `-- reported behaviours --`,
    `AoE catching <=1:      ${s.loneAoE} of ${s.aoeCasts} (${pct(s.loneAoE, s.aoeCasts)})  ${topKeys(s.loneAoEBy)}`,
    `Slot on a dying foe:   ${s.slotOnWeak} of ${s.leveledTargeted} targeted leveled casts (${pct(s.slotOnWeak, s.leveledTargeted)})  ${topKeys(s.slotOnWeakBy)}`,
    `Walk-out-and-back:     ${s.backtrackTurns} of ${s.movedTurns} moving turns (${pct(s.backtrackTurns, s.movedTurns)}), ${s.dashBacktrack} after a Dash`,
    `  monsters:            ${s.monsterBacktrack || 0} of ${s.monsterMovedTurns || 0} moving turns (${pct(s.monsterBacktrack || 0, s.monsterMovedTurns || 0)}), ${s.monsterDashBacktrack || 0} after a Dash`,
    `Turn-to-turn reversals: heroes ${s.heroReversals || 0} (${s.heroReversalsBig || 0} of 4+ tiles, ${s.heroReversalsAfterDash || 0} right after a Dash), monsters ${s.monsterReversals || 0} (${s.monsterReversalsBig || 0} of 4+, ${s.monsterReversalsAfterDash || 0} after a Dash)`,
    `Hero knockdowns:       ${s.heroDowns || 0} (${per(s.heroDowns || 0, s.encounters)}/fight)`,
    `Heals:                 ${s.heals || 0}, overheal ${pct(s.overheal || 0, s.healRolled || 0)} of HP rolled, triage misses ${s.triageMiss || 0} of ${s.allyHeals || 0} ally heals (${pct(s.triageMiss || 0, s.allyHeals || 0)})`,
    `Caster left exposed:   ${s.casterExposedTurns} of ${s.guardChecks} checks (${pct(s.casterExposedTurns, s.guardChecks)}), ${s.casterExposedFree || 0} while not engaged  ${topKeys(s.casterExposedBy, 6)}`,
    `Monster idle turns:    ${s.monsterIdle || 0} of ${s.monsterHitChances || 0} turns where a hero was reachable (${pct(s.monsterIdle || 0, s.monsterHitChances || 0)})`,
    `OAs monsters walked into: ${s.oaOnMonsters || 0} (${per(s.oaOnMonsters || 0, s.encounters)}/fight)`,
    `Monster abilities wasted: ${s.monsterRedundant || 0} of ${s.monsterAbilities || 0} (${pct(s.monsterRedundant || 0, s.monsterAbilities || 0)})  — debuff already on, heal with nobody hurt`,
    `Monster AoE:           ${s.monsterAoECasts} casts, ${per(s.monsterAoETargets, s.monsterAoECasts)} heroes each, ${pct(s.monsterLoneAoE, s.monsterAoECasts)} caught <=1`,
    `Encounters:            ${s.encounters}  (victory ${s.victories} / wipe ${s.wipes} / timeout ${s.timeouts})`,
  ];
}
