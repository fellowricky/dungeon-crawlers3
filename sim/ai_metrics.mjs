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
    slotValue: 0,          // damage + healing produced while a leveled spell resolved
    overlapFrames: 0,
    restingOverlapFrames: 0,
    stillFrames: 0,
    offCentreFrames: 0,
    offCentreTotal: 0,
    attacksOnCorpses: 0,
    rangedRestFrames: 0,
    rangedInMeleeFrames: 0,
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
    };
    stats.rounds = Math.max(stats.rounds, (this.initiative && this.initiative.round) || 0);
    return r;
  };

  /* Dash / Dodge / Disengage — the tactical fallbacks. */
  const origCommon = game.takeCommonAction.bind(game);
  game.takeCommonAction = function (e, kind) {
    const ok = origCommon(e, kind);
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
    if (turn && turn.actor === h) turn.produced = true;
    if (spellDepth > 0) { spellDamageDealt += applied; spellTargets.add(m); }
    return r;
  };

  /* Healing counts as production too, so a healer's turn isn't "wasted". */
  const origHeal = game.healHero.bind(game);
  game.healHero = function (a, amt) {
    const r = origHeal(a, amt);
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
  game.resolveSpell = function (h, key, foe, alive) {
    const outerDamage = spellDamageDealt, outerTargets = spellTargets;
    if (spellDepth === 0) { spellDamageDealt = 0; spellTargets = new Set(); }
    spellDepth++;
    let ok = false;
    try {
      ok = origResolve(h, key, foe, alive);
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
          }
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

  /* Weapon attacks mark production through damageMonster. Conditions applied
     without damage (Hold Person, Faerie Fire…) also count as a real turn. */
  const origSpellSave = game.spellSave.bind(game);
  game.spellSave = function (entity, ability, dc, opts) {
    const saved = origSpellSave(entity, ability, dc, opts);
    if (!saved && turn) turn.produced = true;   // failed save = the spell landed
    return saved;
  };

  /* Per-frame body-overlap check — the occupancy invariant. */
  const origTick = game.tick.bind(game);
  game.tick = function (dt) {
    const r = origTick(dt);
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

  game._flushAiTurn = flushTurn;
  return stats;
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
    `AoE casts:             ${s.aoeCasts}`,
    `Avg targets per AoE:   ${per(s.aoeTargetsHit, s.aoeCasts)}`,
    `Slot levels spent:     ${s.slotLevelsSpent}`,
    `Value per slot level:  ${per(s.slotValue, s.slotLevelsSpent)}`,
    `Body-overlap frames:   ${s.overlapFrames} (in transit — legal, invisible)`,
    `RESTING overlap frames:${String(s.restingOverlapFrames).padStart(7)}  <- the visible artefact`,
    `Off-centre while still: ${pct(s.offCentreFrames, s.stillFrames)} of stopped frames (avg ${s.stillFrames ? (s.offCentreTotal / s.stillFrames).toFixed(3) : '-'} tiles off)`,
    `Ranged hero in melee:  ${pct(s.rangedInMeleeFrames, s.rangedRestFrames)} of their stopped frames`,
    `Attacks on corpses:    ${s.attacksOnCorpses}`,
    `Encounters:            ${s.encounters}  (victory ${s.victories} / wipe ${s.wipes} / timeout ${s.timeouts})`,
  ];
}
