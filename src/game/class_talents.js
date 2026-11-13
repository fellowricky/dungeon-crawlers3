/* ══ Class talents — the per-class talent-tree nodes that do more than add a number ══
 *
 * The flat nodes (atk / ac / fightTempHp / spellDC …) are summed by
 * srd.js skillBonuses and need nothing here. These are the class-specific
 * ones from the November rework, each with a real trigger:
 *
 *   Fighter   counterstrike   strike back when missed in melee
 *             cleave          a kill (rank 2: a crit) carries into the next foe
 *   Cleric    guidingFlame    a Sacred Flame hit lights the foe up for an ally
 *   Wizard    potentCantrip   a saved cantrip still deals part of its damage
 *             arcaneRecovery  a spell slot back when the fight ends
 *   Barbarian deepFury        (features.js chargeDef — more Rage uses)
 *             bloodiedFury    more damage while below half HP
 *   Bard      jarringChord    reaction: −1d6 on an enemy attack that would hit
 *             rousingOverture the party's first round gets +to hit
 *   Druid     beastEndurance  sturdier, surer Wild Shape forms
 *             graspingRoots   the first spell each fight restrains its target
 *   Monk      kiSiphon        Ki back on a kill
 *             pressurePoints  follow-up hits on the same foe hit harder
 *   Paladin   protectiveAura  +saves for allies within 2 tiles
 *             searingSmite    (combat.js smite — more dice vs undead/fiends)
 *   Ranger    skirmishersStep (combat.js heroPostAttackWithdraw — no OA)
 *   Sorcerer  stormTouched    +damage on fire / lightning / cold spells
 *             empoweredSpell  a leveled spell rerolls its 1s and 2s
 *   Warlock   hungeringHex    a hexed foe's death feeds you and moves the Hex
 *             darkOnesLuck    +1d10 on a failed save
 *
 * Per-fight uses live on `h._tal`, reset by talentCombatStart. Everything is
 * mixed into the combat methods (combat.js), so `this` is the game.
 */
import { applyEffect, hasEffect, clearEffect, ROUND_SECONDS, SAVE_HOOKS } from './conditions.js';
import { roll, d as die, mod, heroDamage } from './srd.js';
import { gridDist } from './combat_eval.js';
import { hasFeature } from './features.js';
import { SPELL_ROLL, spellDC } from './spells.js';
import { grantTempHp } from './temp_hp.js';

/** Ranks `h` (entity or hero data) has in talent `key`. */
export function talentRank(h, key) {
  const d = h && (h.data || h);
  return (d && d.skills && d.skills[key]) | 0;
}

const STORM_TYPES = new Set(['fire', 'lightning', 'cold']);
const UNDEAD_OR_FIEND = ['undead', 'fiend', 'demon', 'devil'];

function tal(h) {
  if (!h._tal) h._tal = freshTal();
  return h._tal;
}
function freshTal() {
  return { counter: 0, counterRound: -1, jar: 0, jarRound: -1, kiSiphon: 0, skirmish: 0,
           empower: 0, rootsUsed: false, luck: 0, cleaveTurn: null, ppKey: null, ppFoe: null, ppHits: 0 };
}
function livingHeroes(game) {
  return (game.heroes || []).filter(a => a && a.data && a.data.hp > 0);
}
function roundKey(game) {
  return game.initiative && game.initiative.active ? game.initiative.round : -1;
}
function turnKey(game) {
  const ini = game.initiative;
  return ini && ini.active ? `${ini.round}:${ini.idx}` : `t${Math.floor((game.fxNow || 0) * 2)}`;
}
function isUndeadOrFiend(m) {
  const t = ((m && m.data && m.data.type) || '').toLowerCase();
  return UNDEAD_OR_FIEND.includes(t) || ((m && m.data && m.data.tags) || []).some(x => UNDEAD_OR_FIEND.includes(x));
}

export const classTalentMethods = {
  /** Fight start: reset the per-fight uses, sing the Overture, arm the save hooks. */
  talentCombatStart(alive) {
    const party = alive || livingHeroes(this);
    for (const h of party) h._tal = freshTal();
    this.installTalentSaveHooks();

    /* Rousing Overture: the best bard's rank, for everyone, for one round */
    let best = 0, bard = null;
    for (const h of party) {
      const r = talentRank(h, 'rousingOverture');
      if (r > best && h.data.hp > 0) { best = r; bard = h; }
    }
    if (best > 0) {
      const until = (this.fxNow || 0) + ROUND_SECONDS;
      for (const h of party) { h._overture = { bonus: best, until }; }
      this.fxText(`OVERTURE +${best}`, this._v3(bard.x, 1.6, bard.z), '#e8a8ff');
      this.fxLog(`🎶 ${bard.data.name}'s Rousing Overture — the party gets +${best} to hit this round!`, 'heal');
    }
  },

  /** Conditions.js rolls every save; these hooks let the party's talents in. */
  installTalentSaveHooks() {
    const game = this;
    SAVE_HOOKS.bonus = (entity) => game.talentSaveBonus(entity);
    SAVE_HOOKS.afterFail = (entity, res) => {
      const r = game.talentSaveAfterFail(entity, res);
      /* Tides of Chaos and Bend Luck (wild_magic.js) get the next look */
      return (!r.saved && game.wildSaveAfterFail) ? game.wildSaveAfterFail(entity, r) : r;
    };
  },

  /** Aura of Protection: the best paladin within 2 tiles adds their rank. */
  talentSaveBonus(entity) {
    if (!entity || !entity.data || !(this.heroes || []).includes(entity)) return 0;
    let best = 0;
    for (const p of this.heroes) {
      const r = talentRank(p, 'protectiveAura');
      if (!r || !p.data || p.data.hp <= 0 || r <= best) continue;
      const g = p === entity ? 0 : gridDist(this, p, entity);
      if (g >= 0 && g <= 2) best = r;
    }
    return best;
  },

  /** Dark One's Luck: a failed save gets +1d10, once per fight per rank. */
  talentSaveAfterFail(entity, res) {
    if (!entity || !entity.data || !(this.heroes || []).includes(entity)) return res;
    const r = talentRank(entity, 'darkOnesLuck');
    if (!r) return res;
    const t = tal(entity);
    if (t.luck >= r) return res;
    /* Only worth spending when the d10 can actually pass it */
    if (res.total + 10 < res.dc) return res;
    t.luck++;
    const bonus = die(10);
    const total = res.total + bonus;
    this.fxText(`+${bonus} luck`, this._v3(entity.x, 1.5, entity.z), '#9b59b6');
    this.fxLog(`🎲 ${entity.data.name} calls on the Dark One's Luck: +${bonus} (${res.total} → ${total} vs DC ${res.dc})`,
      total >= res.dc ? 'crit' : 'roll');
    return { ...res, total, mod: res.mod + bonus, saved: total >= res.dc };
  },

  /** To-hit from talents for a hero's weapon / unarmed attack roll. */
  talentAttackBonus(h, foe, profile) {
    let bonus = 0;
    const d = h.data;
    /* Rousing Overture */
    if (h._overture && (this.fxNow || 0) < h._overture.until) bonus += h._overture.bonus;
    /* Guiding Flame: an ally's attack on a glowing foe (spent by the attack) */
    const g = foe && foe._guidingFlame;
    if (g && g.by !== h && (this.fxNow || 0) < g.until) {
      bonus += g.bonus;
      foe._guidingFlame = null;
      this.fxText(`+${g.bonus} guided`, this._v3(foe.x, 1.5, foe.z), '#ffe08a');
    }
    /* Beast Endurance: surer claws in Wild Shape */
    if (d.inWildShape) bonus += talentRank(h, 'beastEndurance');
    return bonus;
  },

  /** Bonus damage from talents on a hit (weapon or cantrip). */
  talentAttackDamage(h, foe, profile, isCantrip) {
    let extra = 0;
    const d = h.data;
    if (!isCantrip) {
      /* Bloodied Fury: below half HP, doubled while raging */
      const bf = talentRank(h, 'bloodiedFury');
      if (bf && d.hp < d.maxHp / 2) extra += bf * (hasEffect(h, 'raging') ? 2 : 1);
      /* Pressure Points: every hit after the first on the same foe this turn */
      const pp = talentRank(h, 'pressurePoints');
      if (pp) {
        const t = tal(h), key = turnKey(this);
        if (t.ppKey !== key || t.ppFoe !== foe) { t.ppKey = key; t.ppFoe = foe; t.ppHits = 0; }
        if (t.ppHits > 0) extra += pp;
        t.ppHits++;
      }
    } else if (profile && STORM_TYPES.has(profile.dmgType)) {
      extra += talentRank(h, 'stormTouched');
    }
    return extra;
  },

  /** After a hero's attack roll resolved (hit or miss). */
  talentAfterAttack(h, foe, res) {
    const { miss, crit, profile, isCantrip } = res;
    if (!foe || foe.dead) {
      return;
    }
    const d = h.data;
    /* Guiding Flame: a cleric's cantrip lands — the next ally's attack is surer */
    const gf = talentRank(h, 'guidingFlame');
    if (gf && isCantrip && !miss && d.classKey === 'cleric') {
      foe._guidingFlame = { bonus: gf, by: h, until: (this.fxNow || 0) + ROUND_SECONDS * 2 };
      this.fxText('GUIDED', this._v3(foe.x, 1.4, foe.z), '#ffe08a');
    }
    /* Potent Cantrip: a saved cantrip still bites */
    const pc = talentRank(h, 'potentCantrip');
    if (pc && isCantrip && miss && foe.data && foe.data.hp > 0) {
      const full = heroDamage(d, false, profile);
      const part = Math.max(1, Math.round(full * Math.min(2, pc) / 4));
      this.fxLog(`✨ ${d.name}'s Potent Cantrip still sears ${foe.data.name} through the save.`, 'roll');
      this.spellDamage(foe, part, h, false, { dmgType: profile && profile.dmgType, magical: true, skipPerks: true });
    }
    /* Cleave, rank 2: a critical melee hit carries into the next foe */
    if (crit && !miss && profile && profile.melee && !isCantrip && talentRank(h, 'cleave') >= 2) {
      this.talentCleave(h, foe, 'crit');
    }
  },

  /** On a kill by `h`. */
  talentOnKill(h, m) {
    if (!h || !h.data || h.companion) return;
    const d = h.data;
    /* Ki Siphon */
    const ks = talentRank(h, 'kiSiphon');
    if (ks) {
      const t = tal(h);
      if (t.kiSiphon < ks && (d.kiMax || 0) > 0 && (d.ki || 0) < d.kiMax) {
        t.kiSiphon++;
        d.ki = Math.min(d.kiMax, (d.ki || 0) + 1);
        this.fxText('+1 Ki', this._v3(h.x, 1.5, h.z), '#e8d8a8');
        if (this.refreshAbilityHud) this.refreshAbilityHud();
      }
    }
    /* Cleave: a melee kill carries on */
    const prof = d.lastProfile || d.weaponProfile;
    if (talentRank(h, 'cleave') && prof && prof.melee && !prof.cantripScale && !prof.isSave) {
      this.talentCleave(h, m, 'kill');
    }
  },

  /** The cleave swing itself: once per turn, at a living foe next to `h`. */
  talentCleave(h, from, why) {
    const t = tal(h), key = turnKey(this);
    if (t.cleaveTurn === key) return;
    let next = null;
    for (const o of this.monsters || []) {
      if (!o || o === from || o.dead || !o.data || o.data.hp <= 0 || o.active === false) continue;
      if (this.isHostileMonster && !this.isHostileMonster(o)) continue;
      const g = gridDist(this, h, o);
      if (g >= 0 && g <= 1 && (!next || o.data.hp < next.data.hp)) next = o;
    }
    if (!next) return;
    t.cleaveTurn = key;
    const profile = h.data.weaponProfile || h.data.lastProfile;
    this.fxLog(`🪓 ${h.data.name} cleaves on into ${next.data.name}${why === 'crit' ? ' off the critical blow' : ''}!`, 'crit');
    const swing = () => {
      if (!next || next.dead || next.data.hp <= 0 || h.data.hp <= 0) return;
      this.heroAttackRoll(h, next, livingHeroes(this), { profile, cleave: true });
    };
    if (this.fxImpactDelay) this.fxImpactDelay(0.35, swing); else swing();
  },

  /** Counterstrike: a fighter missed in melee strikes back. */
  counterstrike(m, h) {
    const r = talentRank(h, 'counterstrike');
    if (!r || !h.data || h.data.hp <= 0 || !m || m.dead || !m.data || m.data.hp <= 0) return false;
    const profile = h.data.weaponProfile || h.data.lastProfile;
    if (!profile || !profile.melee) return false;
    const g = gridDist(this, h, m);
    if (g < 0 || g > 1) return false;
    const t = tal(h), rk = roundKey(this);
    if (t.counter >= r || t.counterRound === rk) return false;
    t.counter++; t.counterRound = rk;
    this.fxText('COUNTER', this._v3(h.x, 1.5, h.z), '#ffd36a');
    this.fxLog(`⚔ ${h.data.name} turns the blow aside and counterstrikes ${m.data.name}!`, 'crit');
    this.heroAttackRoll(h, m, livingHeroes(this), { profile, counter: true });
    return true;
  },

  /**
   * Jarring Chord: `m`'s attack roll `total` would hit `target` (AC `ac`). A
   * bard with a use left, within 6 tiles of the target, subtracts 1d6 — only
   * when a d6 could turn it. Returns the (possibly lowered) total.
   */
  jarringChord(m, target, total, ac, crit) {
    if (crit || total < ac || total - 6 >= ac) return total;
    const rk = roundKey(this);
    for (const b of this.heroes || []) {
      const r = talentRank(b, 'jarringChord');
      if (!r || !b.data || b.data.hp <= 0 || b.companion) continue;
      const t = tal(b);
      if (t.jar >= r || t.jarRound === rk) continue;
      const g = b === target ? 0 : gridDist(this, b, target);
      if (g < 0 || g > 6) continue;
      t.jar++; t.jarRound = rk;
      const cut = die(6);
      const after = total - cut;
      this.fxText(`-${cut} 🎵`, this._v3(m.x, 1.5, m.z), '#e8a8ff');
      this.fxLog(`🎵 ${b.data.name} strikes a Jarring Chord: −${cut} on ${m.data.name}'s attack (${total} → ${after} vs AC ${ac})`,
        after < ac ? 'crit' : 'roll');
      if (this.playAbilityFx) this.playAbilityFx(b, 'cuttingWords', { at: m, spell: true });
      return after;
    }
    return total;
  },

  /**
   * Deflect Missiles (Monk L3 feature): once per round, a ranged weapon hit is
   * reduced by 1d10 + DEX + monk level; at 0 the missile is caught.
   * Returns the damage left.
   */
  deflectMissiles(h, dmg) {
    const d = h && h.data;
    if (!d || dmg <= 0) return dmg;
    if (!hasFeature(d, 'deflectMissiles')) return dmg;
    const t = tal(h), rk = roundKey(this);
    if (t.deflectRound === rk) return dmg;
    t.deflectRound = rk;
    const cut = die(10) + mod((d.effStats && d.effStats.dex) || 10) + (d.level || 1);
    const left = Math.max(0, dmg - cut);
    this.fxText(left === 0 ? 'CAUGHT' : `-${cut}`, this._v3(h.x, 1.5, h.z), '#e8d8a8');
    this.fxLog(left === 0
      ? `🥋 ${d.name} catches the missile out of the air!`
      : `🥋 ${d.name} deflects the missile (−${cut}).`, left === 0 ? 'crit' : 'roll');
    return left;
  },

  /** Grasping Roots: the druid's first foe-targeted spell each fight roots it. */
  graspingRoots(h, foe) {
    const r = talentRank(h, 'graspingRoots');
    if (!r || !foe || foe.dead || !foe.data || foe.data.hp <= 0 || h.data.inWildShape) return;
    if (!(this.monsters || []).includes(foe)) return;
    const t = tal(h);
    if (t.rootsUsed) return;
    t.rootsUsed = true;
    const dc = spellDC(h) + (r >= 2 ? 2 : 0);
    const saved = this.spellSave ? this.spellSave(foe, 'str', dc) : false;
    if (saved) return;
    applyEffect(foe, 'restrained', { duration: ROUND_SECONDS, elapsed: this.fxNow, source: h });
    this.fxText('ROOTED', this._v3(foe.x, 1.4, foe.z), '#6ae06a');
    this.fxLog(`🌿 Roots burst up around ${foe.data.name} — restrained!`, 'crit');
  },

  /** Empowered Spell: arm the reroll for this leveled damage spell. */
  empowerSpell(h, sp) {
    const r = talentRank(h, 'empoweredSpell');
    if (!r || !sp || !(sp.level >= 1)) return;
    const t = tal(h);
    if (t.empower >= r) return;
    t.empower++;
    /* Live for this turn only: the next turn (anyone's, even the sorcerer's
       own next one) disarms it, so it never leaks onto another spell. */
    const game = this, key = turnKey(this);
    SPELL_ROLL.empower = { owner: h, live: () => turnKey(game) === key };
    this.fxText('EMPOWERED', this._v3(h.x, 1.6, h.z), '#e67e22');
    this.fxLog(`🔥 ${h.data.name} empowers ${sp.label || 'the spell'} — 1s and 2s are rerolled.`, 'crit');
  },

  /** Storm-Touched: flat bonus on a fire / lightning / cold spell hit. */
  stormTouched(h, opts) {
    if (!h || !h.data || !opts || !STORM_TYPES.has(opts.dmgType)) return 0;
    return talentRank(h, 'stormTouched');
  },

  /** Hungering Hex: a hexed foe dies — its warlock feeds and the Hex leaps. */
  hungeringHex(m) {
    if (!m || !m._effects || !m._effects.hexMarked) return;
    const src = m._effects.hexMarked.source;
    const r = talentRank(src, 'hungeringHex');
    if (!r || !src.data || src.data.hp <= 0) return;
    const t = 2 * r;
    grantTempHp(src.data, 'hungeringHex', t);
    this.fxText(`+${t} temp`, this._v3(src.x, 1.4, src.z), '#9b59b6');
    let next = null, best = Infinity;
    for (const o of this.monsters || []) {
      if (!o || o === m || o.dead || !o.data || o.data.hp <= 0 || o.active === false) continue;
      if (this.isHostileMonster && !this.isHostileMonster(o)) continue;
      const dd = Math.hypot(o.x - m.x, o.z - m.z);
      if (dd < best) { best = dd; next = o; }
    }
    const conc = src.conc || (src.data && src.data.conc);
    if (next && conc && conc.key === 'hex') {
      clearEffect(m, 'hexMarked');
      applyEffect(next, 'hexMarked', { duration: 120, elapsed: this.fxNow, source: src });
      conc.targets = [{ e: next, key: 'hexMarked' }];
      if (src.conc) src.conc.targets = conc.targets;
      if (src.data && src.data.conc) src.data.conc.targets = conc.targets;
      if (this.fxBodyEffect) this.fxBodyEffect('hexCurse', next);
      this.fxLog(`🔮 The Hex hungers — it leaps from ${m.data.name} to ${next.data.name}, and ${src.data.name} gains ${t} temp HP.`, 'crit');
    } else {
      this.fxLog(`🔮 ${src.data.name}'s Hex feeds on ${m.data.name}'s death: +${t} temp HP.`, 'heal');
    }
  },

  /** Skirmisher's Step: may this withdrawal skip opportunity attacks? Spends a use. */
  skirmishersStep(h) {
    const r = talentRank(h, 'skirmishersStep');
    if (!r) return false;
    const t = tal(h);
    if (t.skirmish >= r) return false;
    t.skirmish++;
    h.disengageActive = true;
    this.fxText('SKIRMISH', this._v3(h.x, 1.5, h.z), '#9ad06a');
    return true;
  },

  /** Fight over: Arcane Recovery hands back one spent slot. */
  talentsFightEnd() {
    for (const h of this.heroes || []) {
      if (!h || !h.data || h.data.hp <= 0) continue;
      const r = talentRank(h, 'arcaneRecovery');
      if (!r) continue;
      const d = h.data;
      if (!d.slotsMax || typeof d.slotsMax !== 'object' || !d.slots || typeof d.slots !== 'object') continue;
      for (let lv = Math.min(3, r); lv >= 1; lv--) {
        if ((d.slots[lv] || 0) < (d.slotsMax[lv] || 0)) {
          d.slots[lv] = (d.slots[lv] || 0) + 1;
          this.fxLog(`📖 ${d.name}'s Arcane Recovery restores a level-${lv} slot.`, 'heal');
          break;
        }
      }
    }
  }
};

/** Searing Smite: extra d8s on a smite against undead / fiends. */
export function searingSmiteDice(h, foe) {
  const r = talentRank(h, 'searingSmite');
  return r && isUndeadOrFiend(foe) ? r : 0;
}

/** Beast Endurance: Wild Shape HP multiplier. */
export function beastEnduranceMul(d) {
  return 1 + 0.1 * talentRank(d, 'beastEndurance');
}
