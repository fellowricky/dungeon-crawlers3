/**
 * Spell definitions and casting logic.
 *
 * Every spell is a self-contained definition with a `cast(game, h, foe, alive)`
 * function. Adding a new spell is just a new entry in the registry — no need
 * to touch combat.js's resolveSpell chain.
 *
 * Cast functions receive the Game instance as `game` and use its helper
 * methods (`game.fxSprite`, `game.fxProjectile`, `game.fxSlash`, `game.fxText`,
 * `game.fxLog`) to avoid circular imports.
 */

import { applyEffect, clearEffect, hasEffect, getEffectMods, EFFECTS, ROUND_SECONDS } from './conditions.js';
import { hasFeature } from './features.js';
import { isPointInLineSegment, isPointInCone } from './aoe_system.js';

/* ── tiny dice helpers (avoid srd.js import → circular deps) ── */
function roll(count, sides, bonus = 0) {
  let t = bonus;
  for (let i = 0; i < count; i++) t += Math.floor(Math.random() * sides) + 1;
  return t;
}
function die(sides) { return Math.floor(Math.random() * sides) + 1; }

/* Sequenced projectiles (darts, rays, hailstones, chain arcs) ride the COMBAT
   clock via game.fxDelay, never setTimeout: at the default 0.7 speed a real-
   time stagger lands ~30% early against the flight animation, and hit-stop
   pushes it further. Falls back for hosts without the hook (older tests). */
function later(game, delayMs, fn, opts = null) {
  if (typeof game.fxDelay === 'function') return game.fxDelay(delayMs / 1000, fn, opts);
  if (typeof game.fxSchedule === 'function') return game.fxSchedule(delayMs, fn);
  return fn();
}
function mod(score) { return Math.floor((score - 10) / 2); }

/* ── helpers ── */
function castAbility(h) {
  const d = h.data;
  const clsAtk = d._classAtk || 'int';   // set by recalc() from the class's attack ability
  return d.effStats?.[clsAtk] ?? 10;
}
/* 5e spell save DC: 8 + proficiency bonus + casting-ability modifier */
export function spellDC(h) {
  const lvl = h.data.level || 1;
  return 8 + (2 + Math.floor((lvl - 1) / 4)) + mod(castAbility(h));
}

function clusterAround(game, center, r) {
  /* The AI picks where a blast actually lands (combat_eval.bestAoECenter) and
     parks it here for the duration of the cast. Without this every AoE simply
     detonated on whatever single monster the caster happened to be targeting,
     which is why Fireballs so often caught one goblin while three more stood
     two tiles away. Caster-centred spells (aoeOrigin:'self') never set it. */
  if (game && game._aoeCenter) center = game._aoeCenter;
  if (!center) return [];
  const cx = center.x != null ? center.x : 0;
  const cz = center.z != null ? center.z : 0;
  return (game.monsters || []).filter(m =>
    m.data && m.data.hp > 0 && m.active !== false && Math.hypot(m.x - cx, m.z - cz) <= r
  );
}

function pickProjectileTarget(game, h, primaryFoe, allocatedHpMap = null) {
  const activeMonsters = (game.monsters || []).filter(m => m.data && m.data.hp > 0 && m.active !== false);
  if (!activeMonsters.length) return null;

  // If primary target is valid and still has estimated HP > 0, keep focusing it
  if (primaryFoe && !primaryFoe.dead && activeMonsters.includes(primaryFoe)) {
    const estHp = allocatedHpMap?.has(primaryFoe) ? allocatedHpMap.get(primaryFoe) : primaryFoe.data.hp;
    if (estHp > 0) return primaryFoe;
  }

  // Look for any active foe with positive estimated HP, prioritizing lowest HP (finish off low HP foes)
  let bestTarget = null;
  let minHp = Infinity;
  for (const m of activeMonsters) {
    const estHp = allocatedHpMap?.has(m) ? allocatedHpMap.get(m) : m.data.hp;
    if (estHp > 0 && estHp < minHp) {
      minHp = estHp;
      bestTarget = m;
    }
  }
  if (bestTarget) return bestTarget;

  // Fallback to any living monster
  return (primaryFoe && !primaryFoe.dead) ? primaryFoe : activeMonsters[0];
}

/* ── Thrown items (flasks, bolas, dusts) ──
   Adventuring gear anybody can throw: an improvised ranged attack with the
   better of STR/DEX plus proficiency against AC, or a save against
   8 + proficiency + that modifier — no spellcasting involved. They live in
   the spell registry because the trinket slot already knows how to cast a
   spellKey, spend a charge and reload the next one from the bag; `thrown:
   true` is what tells the UI and the AI they are items, not magic. */
function throwMod(h) {
  const s = (h.data && h.data.effStats) || {};
  return Math.max(mod(s.str ?? 10), mod(s.dex ?? 10));
}
export function throwDC(h) { return 8 + ((h.data && h.data.atkProf) || 2) + throwMod(h); }
export function throwRoll(h, foe) {
  const selfMods = getEffectMods(h), foeMods = getEffectMods(foe);
  let adv = 0;
  if (foeMods.defAdvantage) adv += 1;
  if (selfMods.atkDisadvantage) adv -= 1;
  if (selfMods.atkAdvantage) adv += 1;
  const a = die(20), b = die(20);
  const d20 = adv > 0 ? Math.max(a, b) : adv < 0 ? Math.min(a, b) : a;
  const bonus = ((h.data && h.data.atkProf) || 2) + throwMod(h) + (selfMods.atkBonus || 0);
  const ac = ((foe.data && foe.data.ac) || 10) + (foeMods.acBonus || 0);
  const crit = d20 === 20;
  const hit = crit || (d20 !== 1 && d20 + bonus >= ac);
  return { hit, crit, detail: `(${d20}+${bonus}=${d20 + bonus} vs AC ${ac})` };
}
/* Lob a flask at one foe; `onHit(crit)` resolves the splash when it lands. */
function throwAt(game, h, foe, sp, verb, onHit, onMiss = null) {
  if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
  if (!foe) return false;
  game.markSpellUsed(h, sp);
  const from = game._v3(h.x, 0.6, h.z);
  const to = game._v3(foe.x, 0.45 * ((foe.data && foe.data.scale) || 1.0) + 0.3, foe.z);
  if (h.ent && typeof game.triggerLunge === 'function') game.triggerLunge(h, foe);
  const r = throwRoll(h, foe);
  game.fxLog(`${sp.icon || '🧪'} ${h.data.name} ${verb} ${foe.data.name}${r.hit ? (r.crit ? ' — critical!' : '') : ' — miss'}`, r.hit ? (r.crit ? 'crit' : 'roll') : 'miss', { detail: r.detail });
  game.fxProjectile(from, to, 'bolt', sp.color, () => {
    if (foe.dead || (foe.data && foe.data.hp <= 0)) return;
    if (r.hit) onHit(r.crit); else if (onMiss) onMiss();
  }, { dmgType: sp.dmgType || 'magic' });
  return true;
}

/* ================================================================
   THE SPELL REGISTRY
   ================================================================ */
export const SPELLS = {

  /* ============ THROWN ITEMS (trinket consumables, any class) ============ */
  acidVial: {
    label:'Vial of Acid', level:0, thrown:true, icon:'🧪',
    desc:'Throw at a foe: 2d6 acid on a hit.',
    ai:{ when:'eliteOrBoss', priority:5 },
    dmgType:'acid', color:0x7fd14a,
    cast(game, h, foe) {
      return throwAt(game, h, foe, this, 'hurls a vial of acid at', (crit) => {
        game.playAbilityFx(h, 'acidVial', { at:foe, noAnim:true, scale:1.6 });
        game.spellDamage(foe, roll(crit ? 4 : 2, 6), h, crit, { dmgType:this.dmgType });
      }, () => game.fxSprite('dcss/effect/cloud_acid_0.png', game._v3(foe.x, 0.3, foe.z), 1.0, 0.3));
    }
  },
  alchemistsFire: {
    label:"Alchemist's Fire", level:0, thrown:true, icon:'🔥',
    desc:'Throw at a foe: 1d4 fire on a hit, and it keeps burning — 2 fire a round for 3 rounds.',
    ai:{ when:'any', priority:4, minCombatSec:1.0 },
    dmgType:'fire', color:0xff7a30,
    cast(game, h, foe) {
      return throwAt(game, h, foe, this, "flings alchemist's fire at", (crit) => {
        game.playAbilityFx(h, 'alchemistsFire', { at:foe, noAnim:true, scale:1.6 });
        game.spellDamage(foe, roll(crit ? 2 : 1, 4), h, crit, { dmgType:this.dmgType });
        if (foe.dead || foe.data.hp <= 0) return;
        foe.burn = { ticks: 3, dmg: 2, src: h, clock: game.fxNow };
        game.fxText('BURN', game._v3(foe.x, 1.2, foe.z), '#ff7a30');
      });
    }
  },
  holyWater: {
    label:'Flask of Holy Water', level:0, thrown:true, icon:'💧',
    desc:'Throw at a fiend or undead: 2d6 radiant on a hit. Harmless to anything else.',
    ai:{ when:'eliteOrBoss', priority:6, onlyTypes:['undead','fiend'] },
    dmgType:'radiant', color:0xffe8a0,
    cast(game, h, foe) {
      return throwAt(game, h, foe, this, 'splashes holy water over', (crit) => {
        const t = foe.data && foe.data.type;
        if (t !== 'undead' && t !== 'fiend') {
          game.fxLog(`   ↳ the water runs off ${foe.data.name} harmlessly.`, 'miss');
          return;
        }
        game.playAbilityFx(h, 'holyWater', { at:foe, noAnim:true, scale:1.8 });
        game.spellDamage(foe, roll(crit ? 4 : 2, 6), h, crit, { dmgType:this.dmgType, magical:true });
      });
    }
  },
  bolas: {
    label:'Bolas', level:0, thrown:true, icon:'🪢',
    desc:'Throw at a foe: on a hit it is RESTRAINED for two rounds (cannot move; attacks against it have advantage).',
    ai:{ when:'eliteOrBoss', priority:6, debuffEffect:'restrained', avoidTypes:['ooze','swarm of tiny beasts'] },
    dmgType:'bludgeoning', color:0xbfa060,
    cast(game, h, foe) {
      return throwAt(game, h, foe, this, 'whirls bolas at', () => {
        if (applyEffect(foe, 'restrained', { duration: ROUND_SECONDS * 2, elapsed: game.fxNow, source:h })) {
          game.playAbilityFx(h, 'bolas', { at:foe, noAnim:true, scale:1.7 });
          game.fxLog(`   ↳ ${foe.data.name}'s legs are tangled — RESTRAINED!`, 'crit');
        }
      });
    }
  },
  chokingDust: {
    label:'Choking Dust', level:0, thrown:true, icon:'🌫',
    desc:'Throw: everything within 10 ft coughs and sneezes — CON save or STUNNED for a round.',
    ai:{ when:'cluster', priority:7, minTargets:2, aoeRadius:2.0 },
    aoeRadius:2.0, dmgType:'poison', color:0xc8c0a0,
    cast(game, h, foe, alive, slotLevel, targetPos) {
      const center = targetPos || foe;
      if (!center) return false;
      const foes = clusterAround(game, center, 2.0);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = throwDC(h);
      game.playAbilityFx(h, 'chokingDust', { at:center, alsoAt:foes, ring:2.0, scale:2.2 });
      game.fxLog(`🌫 ${h.data.name} throws a fistful of choking dust!`, 'crit');
      for (const m of foes) {
        if (m.dead) continue;
        if (game.spellSave(m, 'con', dc, {})) continue;
        if (applyEffect(m, 'stunned', { duration: ROUND_SECONDS, elapsed: game.fxNow, source:h }))
          game.fxLog(`   ↳ ${m.data.name} is choking — STUNNED!`, 'crit');
      }
      return true;
    }
  },
  beadOfForce: {
    label:'Bead of Force', level:0, thrown:true, icon:'🔮',
    desc:'Throw: bursts for 5d4 force in a 10-ft radius (DEX save for half).',
    ai:{ when:'cluster', priority:8, minTargets:2, aoeRadius:2.0 },
    aoeRadius:2.0, dmgType:'force', color:0x9fb8ff,
    cast(game, h, foe, alive, slotLevel, targetPos) {
      const center = targetPos || foe;
      if (!center) return false;
      const foes = clusterAround(game, center, 2.0);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = throwDC(h);
      game.playAbilityFx(h, 'beadOfForce', { at:center, alsoAt:foes, ring:2.0, scale:2.4 });
      game.fxLog(`🔮 ${h.data.name} throws a bead of force — it detonates!`, 'crit');
      for (const m of foes) {
        if (m.dead) continue;
        let dmg = roll(5, 4);
        if (game.spellSave(m, 'dex', dc, { magic:true })) dmg = Math.floor(dmg / 2);
        game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
      }
      return true;
    }
  },
  fireBreath: {
    label:'Fire Breath', level:0, thrown:true, icon:'🐲',
    desc:'Exhale a 15-ft cone of fire: 4d6 (DEX save for half).',
    ai:{ when:'cluster', priority:7, minTargets:2, aoeRadius:3.0, aoeOrigin:'self' },
    dmgType:'fire', color:0xff7a30,
    cast(game, h, foe) {
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const dx = foe.x - h.x, dz = foe.z - h.z, range = 3.2;
      const list = (game.monsters || []).filter(m => m && !m.dead && m.data?.hp > 0 && m.active !== false
        && isPointInCone(m.x, m.z, h.x, h.z, dx, dz, range, 0.55));
      if (!list.length) return false;
      game.markSpellUsed(h, this);
      const dc = throwDC(h);
      game.playAbilityFx(h, 'dragonBreathSpell', { at:foe, alsoAt:list, ring:2.0, scale:2.0 });
      game.fxLog(`🐲 ${h.data.name} breathes fire!`, 'crit');
      for (const m of list) {
        let dmg = roll(4, 6);
        if (game.spellSave(m, 'dex', dc, { magic:true })) dmg = Math.floor(dmg / 2);
        game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
      }
      return true;
    }
  },

  /* ============ EXISTING SPELLS ============ */

  magicMissile: {
    label:'Magic Missile', level:1,
    desc:'3+ unerring darts of force (1d4+1 each, +1 dart per spell level).',
    recharge:'slot',
    ai:{ when:'any', priority:6, targetType:'execute', aoeRadius:0 },
    dmgType:'force',
    color:0xb08cff,
    cast(game, h, foe, alive, slotLevel = 1, targetPos = null, assignedTargets = null) {
      const d = h.data;
      if ((!foe || foe.dead) && (!assignedTargets || !assignedTargets.length)) {
        foe = pickProjectileTarget(game, h, foe);
      }
      if (!foe && (!assignedTargets || !assignedTargets.length)) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'magicMissile', { at:h, spell:true });

      const castLvl = Math.max(slotLevel || 1, 1);
      const darts = 3 + Math.max(0, castLvl - 1);

      game.fxLog(`✴ ${d.name} casts Magic Missile (Lvl ${castLvl}, ${darts} darts)!`, 'crit');

      const curves = [
        { side: -3.6, up: 2.4 },
        { side:  0.0, up: 3.8 },
        { side:  3.6, up: 2.4 },
        { side: -4.5, up: 1.4 },
        { side:  4.5, up: 1.4 },
        { side: -2.4, up: 3.2 },
        { side:  2.4, up: 3.2 },
        { side: -5.0, up: 2.2 },
        { side:  5.0, up: 2.2 },
      ];

      const allocatedHpMap = new Map();
      for (const m of (game.monsters || [])) {
        if (m.data && m.data.hp > 0) allocatedHpMap.set(m, m.data.hp);
      }
      const avgDartDmg = 3.5 + (d.dmgBonus || 0);

      for (let i = 0; i < darts; i++) {
        const delayMs = i * 160;
        const curve = curves[i % curves.length];

        let dartTarget = (assignedTargets && assignedTargets[i]) ? assignedTargets[i] : pickProjectileTarget(game, h, foe, allocatedHpMap);
        if (dartTarget) {
          const curEst = allocatedHpMap.get(dartTarget) || dartTarget.data.hp;
          allocatedHpMap.set(dartTarget, curEst - avgDartDmg);
        }

        later(game, delayMs, () => {
          if (!dartTarget || dartTarget.dead) {
            dartTarget = pickProjectileTarget(game, h, foe);
          }
          if (!dartTarget || dartTarget.dead) return;
          game.fxPlaySfx('spellArcane', { volume: 0.45 });

          const from = game._v3(h.x, 0.55, h.z);
          const t = game._v3(
            dartTarget.x + (Math.random() - 0.5) * 0.3,
            0.4 * (dartTarget.data?.scale || 1.0) + 0.4,
            dartTarget.z + (Math.random() - 0.5) * 0.3
          );

          const targetRef = dartTarget;
          game.fxProjectile(from, t, 'bolt', this.color, () => {
            if (targetRef.dead) return;
            game.spellDamage(targetRef, roll(1, 4, 1) + d.dmgBonus, h, false, { dmgType: this.dmgType, magical: true });
            game.fxSprite('dcss/effect/magic_bolt_1.png', t, 0.9, 0.25);
          }, {
            sheetKey: 'round_sparkle_burst_001_large_blue',
            scale: 1.3,
            curve
          });
        }, delayMs);
      }
      return true;
    }
  },

  shield: {
    label:'Shield', level:1,
    desc:'When bloodied, gain +5 AC for 6 seconds.',
    recharge:'slot',
    ai:{ when:'selfHurt', priority:8, hpFrac:0.4 },
    color:0x88aaff,
    cast(game, h) {
      game.markSpellUsed(h, this);
      applyEffect(h, 'shielded', { duration:6, elapsed: game.fxNow, source:h });
      game.playAbilityFx(h, 'shield', { at:h, spell:true });
      game.fxLog(`🛡 ${h.data.name} casts Shield! (+5 AC)`, 'buff');
      return true;
    }
  },

  scorchingRay: {
    label:'Scorching Ray', level:2,
    desc:'Three rays of fire (+1 ray per slot above 2nd).',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7, targetType:'singleBurst' },
    dmgType:'fire',
    color:0xff7a30,
    cast(game, h, foe, alive, slotLevel = 2) {
      if (!foe || foe.dead) {
        foe = pickProjectileTarget(game, h, foe);
      }
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'scorchingRay', { at:h, spell:true });
      game.fxLog(`🔥 ${d.name} casts Scorching Ray!`, 'crit');

      const rayCount = 3 + Math.max(0, (slotLevel || 2) - 2);
      const allocatedHpMap = new Map();
      for (const m of (game.monsters || [])) {
        if (m.data && m.data.hp > 0) allocatedHpMap.set(m, m.data.hp);
      }
      const avgRayDmg = 7.0 + (d.dmgBonus || 0);

      for (let i = 0; i < rayCount; i++) {
        const delayMs = i * 140;

        let rayTarget = pickProjectileTarget(game, h, foe, allocatedHpMap);
        if (rayTarget) {
          const curEst = allocatedHpMap.get(rayTarget) || rayTarget.data.hp;
          allocatedHpMap.set(rayTarget, curEst - avgRayDmg);
        }

        later(game, delayMs, () => {
          if (!rayTarget || rayTarget.dead) {
            rayTarget = pickProjectileTarget(game, h, foe);
          }
          if (!rayTarget || rayTarget.dead) return;
          game.fxPlaySfx('fireball', { volume: 0.45 });

          const from = game._v3(h.x, 0.55, h.z);
          const to = game._v3(rayTarget.x, 0.5 * (rayTarget.data?.scale || 1.0) + 0.4, rayTarget.z);
          const targetRef = rayTarget;

          game.fxBeam(from, to, {
            type: 'laser',
            color: this.color,
            coreColor: 0xffe060,
            width: 0.32,
            duration: 0.45,
            scrollSpeed: 5.0,
            casterBurst: 'epic_explosion_001_large_orange',
            targetBurst: 'stylized_explosion_001_large_yellow',
            onHit: () => {
              if (targetRef.dead) return;
              game.spellDamage(targetRef, roll(2, 6, d.dmgBonus), h, false, { dmgType: this.dmgType, magical: true });
              game.fxSprite('dcss/effect/searing_ray_3.png', to, 1.1, 0.28);
            }
          });
        }, delayMs);
      }
      return true;
    }
  },

  fireball: {
    label:'Fireball', level:3,
    desc:'8d6 fire (+1d6 per slot above 3rd) in a 20 ft radius (DEX save for half).',
    recharge:'slot',
    ai:{ when:'cluster', priority:9, minTargets:2, aoeRadius:4.0 },
    dmgType:'fire',
    color:0xff7a30,
    cast(game, h, foe, alive, slotLevel = 3, targetPos = null) {
      const d = h.data;
      const center = targetPos || (foe ? { x: foe.x, z: foe.z } : null);
      if (!center) return false;
      const foes = clusterAround(game, center, 4.0);
      const from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(center.x, 0.5, center.z);
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const diceCount = 8 + Math.max(0, (slotLevel || 3) - 3);
      game.playAbilityFx(h, 'fireball', { at:h, spell:true });
      game.fxLog(`🔥 ${d.name} casts Fireball (Lvl ${slotLevel || 3}, ${diceCount}d6)!`, 'crit');

      // Fast fiery streak projectile that detonates into a 4-meter wide inferno
      game.fxProjectile(from, to, 'bolt', this.color, () => {
        game.fxSprite('dcss/effect/cloud_fire_2.png', to, 4.5, 0.6);
        if (game.triggerShake) game.triggerShake(0.7, 0.35);
        if (game.fxFlashLight) game.fxFlashLight(to, 0xff8822, 6.0, 15.0, 0.38);
        for (const m of foes) {
          if (m.dead) continue;
          let dmg = roll(diceCount, 6, d.dmgBonus);
          if (game.spellSave(m, 'dex', dc, { magic: true })) dmg = Math.floor(dmg / 2);
          game.spellDamage(m, dmg, h, true, { dmgType: this.dmgType, magical: true });
        }
      }, { sheetKey: 'epic_explosion_002_large_yellow', scale: 2.2, dmgType: 'fire' });
      return true;
    }
  },

  haste: {
    label:'Haste', level:3, concentration:true,
    desc:'Hasten yourself: +40% speed and +2 AC (concentration, 1 min).',
    recharge:'slot',
    ai:{ when:'selfHurt', priority:5, hpFrac:0.55, buffEffect:'hasted', buffTarget:'self' },
    color:0xa0e0ff,
    cast(game, h) {
      game.markSpellUsed(h, this);
      applyEffect(h, 'hasted', { duration:60, elapsed: game.fxNow, source:h });
      game.concentrate(h, 'haste', [{ e:h, key:'hasted' }]);
      game.playAbilityFx(h, 'haste', { at:h, spell:true });
      game.fxLog(`⚡ ${h.data.name} casts Haste!`, 'buff');
      return true;
    }
  },

  /* --- cleric --- */
  bless: {
    label:'Bless', level:1, concentration:true,
    desc:'Party-wide +1d4 to attack rolls (concentration, 1 min).',
    recharge:'slot',
    ai:{ when:'any', priority:4, buffEffect:'inspired', buffTarget:'party' },
    color:0xffe08a,
    cast(game, h, _, alive) {
      game.markSpellUsed(h, this);
      for (const a of alive) applyEffect(a, 'inspired', { duration:60, elapsed: game.fxNow, source:h });
      game.concentrate(h, 'bless', alive.map(a => ({ e:a, key:'inspired' })));
      game.playAbilityFx(h, 'bless', { at:h, alsoAt:alive, spell:true });
      game.fxLog(`✨ ${h.data.name} casts Bless! (+1d4 to hit)`, 'buff');
      return true;
    }
  },

  spiritualWeapon: {
    label:'Spiritual Weapon', level:2, bonusAction:true,
    desc:'Force weapon strikes the foe for 1d8 + WIS.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:6 },
    dmgType:'force',
    color:0xbfe0ff,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      const d = h.data, amt = roll(1, 8, mod(castAbility(h)) + d.dmgBonus);
      const from = game._v3(foe.x + (Math.random() - 0.5) * 0.4, 3.2, foe.z + (Math.random() - 0.5) * 0.4);
      const to = game._v3(foe.x, 0.5 * (foe.data?.scale || 1.0) + 0.4, foe.z);
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'spiritualWeapon', { at:h, spell:true });
      game.fxLog(`⚔ ${d.name} casts Spiritual Weapon!`, 'crit');
      game.fxProjectile(from, to, 'bolt', this.color, () => {
        if (!foe.dead) {
          game.spellDamage(foe, amt, h, false, { dmgType: this.dmgType, magical: true });
          game.fxSprite('dcss/effect/orb_glow_0.png', to, 1.4, 0.35);
        }
      }, { sheetKey: 'directional_impact_004_large_yellow', scale: 1.5, curve: { side: 0, up: 0.5 } });
      return true;
    }
  },

  spiritGuardians: {
    label:'Spirit Guardians', level:3, concentration:true,
    desc:'Damaging aura: 3d8 radiant to nearby enemies (Wis save for half; concentration).',
    recharge:'slot',
    ai:{ when:'cluster', priority:8, minTargets:2 , aoeRadius:3, aoeOrigin:'self'},
    color:0xd0c0ff,
    dmgType:'radiant',
    cast(game, h, foe) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'spiritGuardians', { at:h, spell:true, ring:3.0 });
      game.fxLog(`✨ ${d.name} casts Spirit Guardians!`, 'crit');

      const zone = game.spawnAoEZone(h, 'spiritGuardians', h.x, h.z, 3.0, {
        color: this.color, dur: 600,
        loopSheet: { sheetKey: 'round_light_burst_001_large_yellow', opacity: 0.28, y: 1.2 }
      });

      const foes = clusterAround(game, h, 3.0);
      for (const m of foes) {
        if (m.dead) continue;
        let dmg = roll(3, 8, d.dmgBonus);
        if (game.spellSave(m, 'wis', dc, { magic:true })) dmg = Math.floor(dmg / 2);
        game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
      }

      game.concentrate(h, 'spiritGuardians', [], zone);
      return true;
    }
  },

  /* --- druid --- */
  entangle: {
    label:'Entangle', level:1, concentration:true,
    desc:'Grasping weeds sprout in a 20-ft area: difficult terrain; creatures in area or entering must make STR save or be restrained (concentration up to 1 min).',
    recharge:'slot',
    ai:{ when:'cluster', priority:5, minTargets:2 , aoeRadius:2},
    color:0x388e3c,
    cast(game, h, foe, alive = null, slotLevel = 1, targetPos = null) {
      const castX = targetPos ? targetPos.x : (foe ? foe.x : h.x);
      const castZ = targetPos ? targetPos.z : (foe ? foe.z : h.z);
      if (castX == null || castZ == null) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'entangle', { at: targetPos || foe || h, spell:true, ring:2.0 });
      game.fxLog(`🌿 ${h.data.name} casts Entangle!`, 'crit');

      const zone = game.spawnAoEZone(h, 'entangle', castX, castZ, 2.0, {
        color: 0x4caf50,
        borderColor: 0x2e7d32,
        dur: 60,
        difficultTerrain: true,
        procedural: 'vines',
        vines: 16,
        innerOpacity: 0.32,
        borderOpacity: 0.95,
        pointLight: true,
        lightColor: 0x4caf50,
        lightIntensity: 2.2,
        lightRange: 6.0,
        loopSheet: {
          sheetKey: 'spell_entangle',
          repeatCount: 7,
          scale: 1.8,
          opacity: 0.95,
          grounded: true,
          additive: false,
          centerY: 0.0,
          y: 0.03,
          startFrame: 10,
          endFrame: 18,
          fps: 8
        }
      });

      const foes = clusterAround(game, targetPos || foe || { x: castX, z: castZ }, 2.0);
      const applied = [];
      for (const m of foes) {
        if (m.dead) continue;
        if (game.spellSave(m, 'str', dc, { magic:true })) {
          game.fxLog(`🌿 ${m.data?.name || 'Foe'} avoids grasping vines (STR save).`, 'miss');
          continue;
        }
        if (applyEffect(m, 'restrained', { duration:60, elapsed: game.fxNow, source:h,
            repeatSave:{ ability:'str', dc, every:6 } })) {
          applied.push({ e:m, key:'restrained' });
          game.fxLog(`🌿 ${m.data?.name || 'Foe'} is ensnared and RESTRAINED by Entangle!`, 'crit');
        }
      }
      game.concentrate(h, 'entangle', applied, zone);
      return true;
    }
  },

  moonbeam: {
    label:'Moonbeam', level:2, concentration:true,
    desc:'5-ft radius cylinder of pale light (2d10 Radiant, CON save). Can move beam 60ft as an action on later turns.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7 },
    dmgType:'radiant',
    color:0xc0e8ff,
    cast(game, h, foe, alive, slotLevel = 2) {
      if (!foe || foe.dead) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'moonbeam', { at:h, spell:true });
      game.fxLog(`✨ ${d.name} casts Moonbeam!`, 'crit');

      const targetX = foe.x, targetZ = foe.z;
      const zone = game.spawnAoEZone(h, 'moonbeam', targetX, targetZ, 1.8, {
        color: this.color,
        dur: 60,
        slotLevel: slotLevel || 2,
        cylinderBeam: true,
        beamHeight: 8.0,
        beamColor: 0xe0f4ff,
        beamOpacity: 0.5,
        lightIntensity: 0.7,
        borderRing: false,
        innerCircle: false
      });

      game.concentrate(h, 'moonbeam', [], zone);

      const from = game._v3(targetX, 6.0, targetZ);
      const to = game._v3(targetX, 0.4, targetZ);
      game.fxBeam(from, to, {
        type: 'pillar',
        color: this.color,
        coreColor: 0xffffff,
        width: 1.6,
        duration: 0.75,
        opacity: 0.5,
        targetBurst: 'round_light_burst_001_large_yellow'
      });

      const foes = (h._side === 'mon' ? game.heroes : game.monsters).filter(m =>
        m.data && m.data.hp > 0 && m.active !== false && Math.hypot(m.x - targetX, m.z - targetZ) <= 1.8
      );
      for (const m of foes) {
        if (!zone.savesThisTurn.has(m)) {
          zone.savesThisTurn.add(m);
          game.resolveMoonbeamDamage(zone, m);
        }
      }
      return true;
    }
  },

  callLightning: {
    label:'Call Lightning', level:3,
    desc:'Bolt the pack: 3d10 to clustered foes.',
    recharge:'slot',
    ai:{ when:'cluster', priority:8, minTargets:2 , aoeRadius:2.2},
    dmgType:'lightning',
    color:0x7090ff,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.2);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const from = game._v3(foe.x, 7.0, foe.z); // High storm cloud position
      const to = game._v3(foe.x, 0.4 * (foe.data?.scale || 1.0) + 0.3, foe.z);

      game.playAbilityFx(h, 'callLightning', { at:foe, alsoAt:foes, spell:true, ring:2.0, scale:2.0 });
      game.fxLog(`⚡ ${d.name} calls Lightning!`, 'crit');

      game.fxBeam(from, to, {
        type: 'lightning',
        color: 0x80a0ff,
        coreColor: 0xffffff,
        width: 0.65,
        duration: 0.6,
        targetBurst: 'lightning_strike_001_large_violet'
      });

      for (const m of foes) {
        if (m.dead) continue;
        let dmg = roll(3, 10, d.dmgBonus);
        if (game.spellSave(m, 'dex', dc, { magic:true })) dmg = Math.floor(dmg / 2);
        game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
      }
      return true;
    }
  },

  /* --- bard --- */
  healingWord: {
    label:'Healing Word', level:1, bonusAction:true,
    desc:'Bonus heal on a wounded ally (1d4 + mod; +1d4 per slot above 1st).',
    recharge:'slot',
    ai:{ when:'hurtAlly', priority:8, hpFrac:0.55 },
    color:0xe8a8ff,
    cast(game, h, targetAlly, alive, slotLevel = 1) {
      const d = h.data;
      const isManual = game && game.controlMode === 'manual';
      let target = (targetAlly && targetAlly._side === 'hero') ? targetAlly : null;
      if (!target) {
        const targets = alive.concat(game.heroes.filter(x => x.data.hp <= 0));
        let worst = null, wf = 1;
        for (const a of targets) { const f = Math.max(0, a.data.hp / a.data.maxHp); if (f < wf) { wf = f; worst = a; } }
        if (!worst || (!isManual && worst.data.hp > 0 && wf >= 0.55)) return false;
        target = worst;
      }
      game.markSpellUsed(h, this);
      const diceCount = 1 + Math.max(0, (slotLevel || 1) - 1);
      const amt = roll(diceCount, 4, mod(castAbility(h)) + (d.healBonus || 0));
      game.healHero(target, amt);
      game.playAbilityFx(h, 'healingWord', { at:target, spell:true });
      game.fxLog(`💬 ${d.name} casts Healing Word on ${target.data.name} (+${amt}).`, 'heal');
      return true;
    }
  },

  shatter: {
    label:'Shatter', level:2,
    desc:'Thunderous burst: 3d8 thunder (+1d8 per slot above 2nd) in a 10 ft radius (CON save for half).',
    recharge:'slot',
    ai:{ when:'cluster', priority:7, minTargets:3 , aoeRadius:2},
    dmgType:'thunder',
    color:0xd0a0ff,
    cast(game, h, foe, alive, slotLevel = 2) {
      const d = h.data, foes = clusterAround(game, foe, 2.0);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const diceCount = 3 + Math.max(0, (slotLevel || 2) - 2);
      game.playAbilityFx(h, 'shatter', { at:foe, alsoAt:foes, spell:true, ring:2.0, scale:2.0 });
      game.fxLog(`💥 ${d.name} casts Shatter!`, 'crit');
      for (const m of foes) {
        if (m.dead) continue;
        let dmg = roll(diceCount, 8, d.dmgBonus);
        if (game.spellSave(m, 'con', dc, { magic:true })) dmg = Math.floor(dmg / 2);
        game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
      }
      return true;
    }
  },

  /* --- sorcerer --- */
  chaosBolt: {
    label:'Chaos Bolt', level:1,
    desc:'Unstable bolt: 2d8 + CHA, crits more often. Random damage type each cast.',
    recharge:'slot',
    ai:{ when:'any', priority:5 },
    color:0xff8844,
    cast(game, h, foe) {
      /* Chaos Bolt: roll a random damage type on each cast (5e). */
      const chaosTypes = ['acid','cold','fire','lightning','poison','thunder'];
      const dmgType = chaosTypes[Math.floor(Math.random() * chaosTypes.length)];
      const d = h.data, amt = roll(2, 8, mod(castAbility(h)) + d.dmgBonus);
      const from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5*(foe.data?.scale || 1.0)+0.4, foe.z);
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'chaosBolt', { at:h, spell:true });
      game.fxLog(`✨ ${d.name} casts Chaos Bolt!`, 'crit');
      game.fxProjectile(from, to, 'bolt', this.color, () => {
        if (!foe.dead) { game.spellDamage(foe, amt, h, Math.random()<0.15, { dmgType, magical:true }); game.fxSprite('dcss/effect/cloud_chaos_4.png', to, 1.3, 0.35); }
      }, { sheetKey: 'round_firework_burst_001_large_green', scale: 1.3 });
      return true;
    }
  },

  dragonBreathSpell: {
    label:'Burning Hands', level:1,
    desc:'15-ft cone of fire: 3d6 (+1d6 per slot above 1st) fire damage to creatures in the cone (Dex save for half).',
    recharge:'slot',
    ai:{ when:'cluster', priority:6, minTargets:2, aoeRadius:3.2 },
    dmgType:'fire',
    color:0xff6020,
    cast(game, h, foe, alive, slotLevel = 1) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const diceCount = 3 + Math.max(0, (slotLevel || 1) - 1);
      const dx = foe.x - h.x;
      const dz = foe.z - h.z;
      const range = 3.2; // 15-ft cone

      game.playAbilityFx(h, 'dragonBreathSpell', { at:foe, spell:true, ring:2.0, scale:2.0 });
      game.fxLog(`🔥 ${d.name} casts Burning Hands in a 15-ft cone!`, 'crit');

      const list = game.monsters || [];
      for (const m of list) {
        if (!m || m.dead || m.data?.hp <= 0 || m.active === false) continue;
        if (isPointInCone(m.x, m.z, h.x, h.z, dx, dz, range, 0.55)) {
          let dmg = roll(diceCount, 6, d.dmgBonus);
          if (game.spellSave(m, 'dex', dc, { magic:true })) dmg = Math.floor(dmg / 2);
          game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
        }
      }
      return true;
    }
  },

  /* --- warlock --- */
  hex: {
    label:'Hex', level:1, concentration:true, bonusAction:true,
    desc:'Curse a foe: +1d6 damage on your hits (concentration).',
    recharge:'short',
    ai:{ when:'eliteOrBoss', priority:7 },
    color:0x9b59b6,
    cast(game, h, foe) {
      game.markSpellUsed(h, this);
      applyEffect(foe, 'hexMarked', { duration:120, elapsed: game.fxNow, source:h });
      game.concentrate(h, 'hex', [{ e:foe, key:'hexMarked' }]);
      game.playAbilityFx(h, 'hex', { at:foe, spell:true });
      game.fxLog(`🔮 ${h.data.name} casts Hex on ${foe.data.name}!`, 'crit');
      return true;
    }
  },

  armsOfHadar: {
    label:'Arms of Hadar', level:1,
    desc:'Dark tentacles: 2d6 to nearby foes.',
    recharge:'slot',
    ai:{ when:'cluster', priority:6, minTargets:2 , aoeRadius:2.2},
    dmgType:'necrotic',
    color:0x6a3080,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.2);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'armsOfHadar', { at:foe, alsoAt:foes, spell:true, ring:2.0, scale:2.0 });
      game.fxLog(`🟣 ${d.name} casts Arms of Hadar!`, 'crit');
      for (const m of foes) if (!m.dead) game.spellDamage(m, roll(2,6,d.dmgBonus), h, false, { dmgType:this.dmgType, magical:true });
      return true;
    }
  },

  /* --- paladin / ranger --- */
  thunderousSmite: {
    label:'Thunderous Smite', level:1, bonusAction:true,
    desc:'Next melee hit deals +2d6 thunder.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7 },
    dmgType:'thunder',
    color:0xf1c40f,
    cast(game, h) {
      game.markSpellUsed(h, this);
      h.smiteNext = true;
      game.playAbilityFx(h, 'thunderousSmite', { at:h, spell:true });
      game.fxLog(`⚡ ${h.data.name} readies Thunderous Smite!`, 'crit');
      return true;
    }
  },

  huntersMark: {
    label:"Hunter's Mark", level:1, concentration:true, bonusAction:true,
    desc:'Mark prey: +1d6 damage on your hits (concentration).',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7 },
    color:0x1abc9c,
    cast(game, h, foe) {
      game.markSpellUsed(h, this);
      applyEffect(foe, 'huntersMarked', { duration:120, elapsed: game.fxNow, source:h });
      game.concentrate(h, 'huntersMark', [{ e:foe, key:'huntersMarked' }]);
      game.playAbilityFx(h, 'huntersMark', { at:foe, spell:true });
      game.fxLog(`🎯 ${h.data.name} marks ${foe.data.name}!`, 'crit');
      return true;
    }
  },

  /* ============ NEW CONDITION-BASED SPELLS ============ */

  blindness: {
    label:'Blindness/Deafness', level:2,
    desc:'Blind a foe (CON save). Disadv on atks; enemies get adv to hit.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:6, minCombatSec:1.5 },
    color:0x888899,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'blindness', { at:h, spell:true });
      if (game.spellSave(foe, 'con', dc, { magic:true })) {
        game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`🧿 ${foe.data.name} resists Blindness!`, 'miss', { cat: 'effect' });
      } else {
        applyEffect(foe, 'blinded', { duration:60, elapsed: game.fxNow, source:h,
          repeatSave:{ ability:'con', dc, every:6 } });
        game.playAbilityFx(h, 'blindness', { at:foe });
        game.fxLog(`🧿 ${h.data.name} blinds ${foe.data.name}!`, 'crit', { cat: 'effect' });
      }
      return true;
    }
  },

  holdPerson: {
    label:'Hold Person', level:2, concentration:true,
    desc:'Paralyze a foe (WIS save, repeats each round). Melee hits auto-crit.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:8, minCombatSec:1.5 },
    color:0x8090c0,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'holdPerson', { at:h, spell:true });
      if (game.spellSave(foe, 'wis', dc, { magic:true })) {
        game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`🔗 ${foe.data.name} resists Hold Person!`, 'miss', { cat: 'effect' });
      } else {
        applyEffect(foe, 'paralyzed', { duration:60, elapsed: game.fxNow, source:h,
          repeatSave:{ ability:'wis', dc, every:6 } });
        game.concentrate(h, 'holdPerson', [{ e:foe, key:'paralyzed' }]);
        game.playAbilityFx(h, 'holdPerson', { at:foe });
        game.fxLog(`🔗 ${h.data.name} paralyzes ${foe.data.name}!`, 'crit', { cat: 'effect' });
      }
      return true;
    }
  },

  sleep: {
    label:'Sleep', level:1,
    desc:'Put foes to sleep by HP pool (5d8 + 2d8 per slot level above 1st; no save). Unconscious foes cannot act.',
    recharge:'slot',
    ai:{ when:'any', priority:4, minCombatSec:1.0 },
    color:0x6688aa,
    cast(game, h, foe, alive, slotLevel = 1) {
      if (!foe || foe.dead) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'sleep', { at:h, spell:true });

      const poolDice = 5 + Math.max(0, (slotLevel || 1) - 1) * 2;
      let hpPool = roll(poolDice, 8);
      game.fxLog(`💤 ${h.data.name} rolls ${hpPool} HP pool for Sleep!`, 'buff', { cat: 'effect' });

      const foes = (h._side === 'mon' ? game.heroes : game.monsters)
        .filter(m => m.data && m.data.hp > 0 && m.active !== false)
        .sort((a, b) => a.data.hp - b.data.hp);

      let sleptCount = 0;
      for (const m of foes) {
        if (m.data.hp <= hpPool) {
          hpPool -= m.data.hp;
          applyEffect(m, 'unconscious', { duration:60, elapsed: game.fxNow, source:h });
          game.playAbilityFx(m, 'sleep', { at:m });
          game.fxLog(`💤 ${m.data.name} falls asleep!`, 'crit', { cat: 'effect' });
          sleptCount++;
        }
      }
      if (sleptCount === 0) {
        game.fxLog(`💤 Sleep had no effect (target HP exceeds pool).`, 'miss');
      }
      return true;
    }
  },

  fear: {
    label:'Fear', level:3, concentration:true,
    desc:'Frighten foes (WIS save, repeats each round): disadvantage on attacks.',
    recharge:'slot',
    ai:{ when:'cluster', priority:7, minTargets:2, minCombatSec:1.5 , aoeRadius:3},
    color:0x9b59b6,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 3.0);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'fear', { at:h, alsoAt:foes, spell:true, ring:2.4, scale:2.2 });
      game.fxLog(`👻 ${d.name} casts Fear!`, 'crit');
      const applied = [];
      for (const m of foes) {
        if (m.dead) continue;
        if (!game.spellSave(m, 'wis', dc, { magic:true })
            && applyEffect(m, 'frightened', { duration:60, elapsed: game.fxNow, source:h,
                repeatSave:{ ability:'wis', dc, every:6 } }))
          applied.push({ e:m, key:'frightened' });
      }
      game.concentrate(h, 'fear', applied);
      return true;
    }
  },

  slow: {
    label:'Slow', level:3, concentration:true,
    desc:'Slow nearby foes: half speed, -2 AC (WIS save; concentration).',
    recharge:'slot',
    ai:{ when:'cluster', priority:6, minTargets:2, minCombatSec:1.0 , aoeRadius:3},
    color:0x8fd4e8,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 3.0);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'slow', { at:h, alsoAt:foes, spell:true, ring:2.2 });
      game.fxLog(`🐌 ${d.name} casts Slow!`, 'crit');
      const applied = [];
      for (const m of foes) {
        if (m.dead) continue;
        if (!game.spellSave(m, 'wis', dc, { magic:true })
            && applyEffect(m, 'slowed', { duration:60, elapsed: game.fxNow, source:h }))
          applied.push({ e:m, key:'slowed' });
      }
      game.concentrate(h, 'slow', applied);
      return true;
    }
  },

  bane: {
    label:'Bane', level:1, concentration:true,
    desc:'Curse nearby foes: -3 to attacks (CHA save; concentration).',
    recharge:'slot',
    ai:{ when:'cluster', priority:5, minTargets:2, minCombatSec:1.0 , aoeRadius:2.5},
    color:0xd0a0ff,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.5);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'bane', { at:h, alsoAt:foes, spell:true, ring:1.8 });
      game.fxLog(`🧿 ${d.name} casts Bane!`, 'crit');
      const applied = [];
      for (const m of foes) {
        if (m.dead) continue;
        if (!game.spellSave(m, 'cha', dc, { magic:true })
            && applyEffect(m, 'baned', { duration:60, elapsed: game.fxNow, source:h }))
          applied.push({ e:m, key:'baned' });
      }
      game.concentrate(h, 'bane', applied);
      return true;
    }
  },

  faerieFire: {
    label:'Faerie Fire', level:1, concentration:true,
    desc:'DEX save. Outline foes — attacks against them have advantage.',
    recharge:'slot',
    ai:{ when:'cluster', priority:5, minTargets:2, minCombatSec:1.0 , aoeRadius:2.5},
    color:0xb08cff,
    cast(game, h, foe) {
      if (!foe) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const foes = clusterAround(game, foe, 2.5);
      game.playAbilityFx(h, 'faerieFire', { at:foe, alsoAt:foes, spell:true, ring:2.5, scale:2.2 });
      game.fxLog(`✨ ${h.data.name} casts Faerie Fire!`, 'crit');
      
      const zone = game.spawnAoEZone(h, 'faerieFire', foe.x, foe.z, 2.5, {
        color: this.color, dur: 60,
        procedural: 'sparkleCube',
        lightColor: 0xb08cff,
        lightIntensity: 1.2,
        lightRange: 5.0
      });
      
      const applied = [];
      for (const m of foes) {
        if (m.dead) continue;
        if (!game.spellSave(m, 'dex', dc, { magic:true })
            && applyEffect(m, 'faerieFire', { duration:60, elapsed: game.fxNow, source:h }))
          applied.push({ e:m, key:'faerieFire' });
      }
      game.concentrate(h, 'faerieFire', applied, zone);
      return true;
    }
  },

  rayOfEnfeeblement: {
    label:'Ray of Enfeeblement', level:2, concentration:true,
    desc:'Halve a foe\'s damage (CON save, repeats each round; concentration).',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7, minCombatSec:1.5 },
    color:0xd0a080,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      const d = h.data, from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5 * (foe.data?.scale || 1.0) + 0.4, foe.z);
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'rayOfEnfeeblement', { at:h, spell:true });
      game.fxBeam(from, to, {
        type: 'drain',
        color: 0x6ae06a,
        coreColor: 0xa8ff88,
        width: 0.38,
        duration: 0.65,
        scrollSpeed: -4.0,
        casterBurst: 'spell_poison_001_large_green',
        targetBurst: 'spell_poison_001_large_green',
        onHit: () => {
          if (foe.dead) return;
          if (game.spellSave(foe, 'con', dc, { magic: true })) {
            game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
            game.fxLog(`💪 ${foe.data.name} resists Ray of Enfeeblement!`, 'miss');
          } else {
            applyEffect(foe, 'weakenedDmg', { duration: 60, elapsed: game.fxNow, source: h,
              repeatSave: { ability: 'con', dc, every: 6 } });
            game.concentrate(h, 'rayOfEnfeeblement', [{ e: foe, key: 'weakenedDmg' }]);
            game.playAbilityFx(h, 'rayOfEnfeeblement', { at: foe });
            game.fxLog(`💪 ${h.data.name} enfeebles ${foe.data.name}!`, 'crit');
          }
        }
      });
      return true;
    }
  },

  web: {
    label:'Web', level:2, concentration:true,
    desc:'Restrain foes (DEX save; STR save each round to break free).',
    recharge:'slot',
    ai:{ when:'cluster', priority:6, minTargets:2, minCombatSec:1.0 , aoeRadius:2.5},
    color:0xbfa060,
    cast(game, h, foe) {
      if (!foe) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const foes = clusterAround(game, foe, 2.5);
      game.fxLog(`🕸 ${h.data.name} casts Web!`, 'crit');
      /* The orb travels first; the web itself only appears — and the saves
         only land — once it actually reaches the target, not the instant the
         spell is cast. */
      game.playAbilityFx(h, 'web', { at:foe, spell:true, onImpact: () => {
        const zone = game.spawnAoEZone(h, 'web', foe.x, foe.z, 2.5, {
          color: this.color, dur: 60,
          /* No generic zone disc/ring — the web lattice itself is the only
             indicator. It's a flat ground decal (not an upright billboard)
             that plays its grow-in once and then holds on the fully-formed
             frame for the rest of the concentration, rather than looping. */
          innerOpacity: 0, borderOpacity: 0,
          loopSheet: { sheetKey: 'spell_web', flat: true, once: true, scale: 5.5, opacity: 0.95, additive: false }
        });

        const applied = [];
        for (const m of foes) {
          if (m.dead) continue;
          if (!game.spellSave(m, 'dex', dc, { magic:true })
              && applyEffect(m, 'restrained', { duration:60, elapsed: game.fxNow, source:h,
                  repeatSave:{ ability:'str', dc, every:6 } }))
            applied.push({ e:m, key:'restrained' });
        }
        game.concentrate(h, 'web', applied, zone);
      } });
      return true;
    }
  },

  hideousLaughter: {
    label:"Tasha's Hideous Laughter", level:1, concentration:true,
    desc:'Incapacitate a foe with laughter (WIS save, repeats each round).',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7, minCombatSec:1.5 },
    color:0xe8a8ff,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'hideousLaughter', { at:h, spell:true });
      if (game.spellSave(foe, 'wis', dc, { magic:true })) {
        game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`😂 ${foe.data.name} resists Laughter!`, 'miss');
      } else {
        applyEffect(foe, 'prone', { duration:60, elapsed: game.fxNow, source:h,
          repeatSave:{ ability:'wis', dc, every:6 } });
        applyEffect(foe, 'incapacitated', { duration:60, elapsed: game.fxNow, source:h,
          repeatSave:{ ability:'wis', dc, every:6 } });
        game.concentrate(h, 'hideousLaughter', [{ e:foe, key:'prone' }, { e:foe, key:'incapacitated' }]);
        game.playAbilityFx(h, 'hideousLaughter', { at:foe });
        game.fxLog(`😂 ${h.data.name} incapacitates ${foe.data.name} with laughter!`, 'crit');
      }
      return true;
    }
  },

  lesserRestoration: {
    label:'Lesser Restoration', level:2,
    desc:'Cure an ally of blindness, deafness, paralysis, or poison.',
    recharge:'slot',
    ai:{ when:'hurtAlly', priority:6, hpFrac:0.6, minCombatSec:1.0 },
    color:0x6ae06a,
    cast(game, h, _, alive) {
      const curable = ['blinded','deafened','paralyzed','poisoned'];
      let target = null;
      for (const a of alive) {
        for (const c of curable) if (hasEffect(a, c)) { target = a; break; }
        if (target) break;
      }
      if (!target) return false;
      game.markSpellUsed(h, this);
      for (const c of curable) clearEffect(target, c);
      game.playAbilityFx(h, 'lesserRestoration', { at:target, spell:true });
      game.fxLog(`✨ ${h.data.name} casts Lesser Restoration on ${target.data.name}!`, 'buff');
      return true;
    }
  },

  greaterRestoration: {
    label:'Greater Restoration', level:5,
    desc:'Purge all harmful conditions from an ally.',
    recharge:'long',
    ai:{ when:'hurtAlly', priority:9, hpFrac:0.4, minCombatSec:2.0 },
    color:0xffe08a,
    cast(game, h, _, alive) {
      const debuffKeys = Object.keys(EFFECTS).filter(k => EFFECTS[k].category==='debuff');
      let target = null;
      for (const a of alive) {
        if (debuffKeys.some(c => hasEffect(a, c))) { target = a; break; }
      }
      if (!target) return false;
      game.markSpellUsed(h, this);
      for (const c of debuffKeys) clearEffect(target, c);
      game.playAbilityFx(h, 'greaterRestoration', { at:target, spell:true, scale:2.0 });
      game.fxLog(`🌟 ${h.data.name} casts Greater Restoration on ${target.data.name}!`, 'buff');
      return true;
    }
  },

  protectionFromEvil: {
    label:'Protection from Evil', level:1,
    desc:'Cleanse charmed/frightened; immune for 10s.',
    recharge:'slot',
    ai:{ when:'selfHurt', priority:6, hpFrac:0.45, minCombatSec:1.0 },
    color:0xffe08a,
    cast(game, h) {
      game.markSpellUsed(h, this);
      clearEffect(h, 'charmed');
      clearEffect(h, 'frightened');
      game.playAbilityFx(h, 'protectionFromEvil', { at:h, spell:true });
      game.fxLog(`🛡 ${h.data.name} casts Protection from Evil — cleansed!`, 'buff');
      return true;
    }
  },

  /* ============ EXTENDED SPELL LIST ============ */

  /* ── Level 1 ── */
  grease: {
    label:'Grease', level:1,
    desc:'Slick area knocks foes prone (DEX save).',
    recharge:'slot',
    ai:{ when:'cluster', priority:4, minTargets:2, minCombatSec:1.0 , aoeRadius:2.5},
    color:0xbfa060,
    cast(game, h, foe) {
      if (!foe) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'grease', { at:foe, spell:true, ring:2.5 });
      game.fxLog(`🛢 ${h.data.name} casts Grease!`, 'crit');
      
      // Spawn persistent AoE zone (duration: 60s, non-concentration)
      game.spawnAoEZone(h, 'grease', foe.x, foe.z, 2.5, {
        color: this.color, dur: 60,
        loopSheet: { sheetKey: 'symmetrical_smoke_burst_001_large_brown', opacity: 0.20 }
      });
      
      const foes = clusterAround(game, foe, 2.5);
      for (const m of foes) {
        if (m.dead) continue;
        if (!game.spellSave(m, 'dex', dc, { magic:true }))
          applyEffect(m, 'prone', { duration:6, elapsed: game.fxNow, source:h });
      }
      return true;
    }
  },

  inflictWounds: {
    label:'Inflict Wounds', level:1,
    desc:'Melee-range necrotic burst: 3d10 (+1d10 per slot above 1st) to a single foe.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:8 },
    dmgType:'necrotic',
    color:0xc04040,
    cast(game, h, foe, alive, slotLevel = 1) {
      if (!foe || foe.dead) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const diceCount = 3 + Math.max(0, (slotLevel || 1) - 1);
      const amt = roll(diceCount, 10, d.dmgBonus);
      game.playAbilityFx(h, 'inflictWounds', { at:foe, spell:true });
      game.spellDamage(foe, amt, h, false, { dmgType:this.dmgType, magical:true });
      game.fxLog(`💀 ${d.name} casts Inflict Wounds on ${foe.data.name}!`, 'crit');
      return true;
    }
  },

  /* ── Level 2 ── */
  acidArrow: {
    label:'Acid Arrow', level:2,
    desc:'Corrosive bolt: 4d4 acid (+1d4 per slot above 2nd) to a single foe.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:6, minCombatSec:1.5 },
    dmgType:'acid',
    color:0x4cae4c,
    cast(game, h, foe, alive, slotLevel = 2) {
      if (!foe || foe.dead) return false;
      const d = h.data, from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5*(foe.data?.scale || 1.0)+0.4, foe.z);
      const diceCount = 4 + Math.max(0, (slotLevel || 2) - 2);
      const amt = roll(diceCount, 4, d.dmgBonus);
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'acidArrow', { at:h, spell:true });
      game.fxProjectile(from, to, 'bolt', this.color, () => {
        if (foe.dead) return;
        game.spellDamage(foe, amt, h, false, { dmgType:this.dmgType, magical:true });
        game.fxSprite('dcss/effect/acid_venom.png', to, 1.1, 0.3);
      }, { sheetKey: 'burst_splatter_003_large_green', scale: 1.3, dmgType: 'acid' });
      game.fxLog(`🧪 ${d.name} casts Acid Arrow!`, 'crit');
      return true;
    }
  },

  mistyStep: {
    label:'Misty Step', level:2, bonusAction:true,
    desc:'Teleport away and gain +2 AC for 4s.',
    recharge:'short',
    ai:{ when:'selfHurt', priority:7, hpFrac:0.35 },
    color:0x8fd4e8,
    cast(game, h) {
      game.markSpellUsed(h, this);
      applyEffect(h, 'phaseStep', { duration:ROUND_SECONDS, elapsed: game.fxNow });
      game.playAbilityFx(h, 'mistyStep', { at:h, spell:true, scale:1.8 });
      game.fxLog(`💨 ${h.data.name} uses Misty Step! (+4 AC)`, 'buff');
      return true;
    }
  },

  silence: {
    label:'Silence', level:2,
    desc:'Disrupt foes: -4 AC (reduces armor) for 5s (no save).',
    recharge:'slot',
    ai:{ when:'cluster', priority:6, minTargets:2, minCombatSec:1.0 , aoeRadius:2.5},
    color:0x888899,
    cast(game, h, foe) {
      const foes = clusterAround(game, foe, 2.5);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'silence', { at:foe, alsoAt:foes, spell:true, ring:2.2 });
      game.fxLog(`🔇 ${h.data.name} casts Silence on ${foes.length} foes! (-4 AC)`, 'crit');
      for (const m of foes) {
        if (m.dead) continue;
        m.data.ac = Math.max(1, m.data.ac - 4);
        /* A rules duration on the combat clock — it must not hold the turn. */
        later(game, 5000, () => { if (m && m.data && !m.dead) m.data.ac += 4; }, { hold: false });
      }
      return true;
    }
  },

  /* ── Level 3 ── */
  bestowCurse: {
    label:'Bestow Curse', level:3, concentration:true,
    desc:'Random strong debuff: weakened, slowed, or baned (WIS save; concentration).',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7, minCombatSec:1.5 },
    color:0x9b59b6,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'bestowCurse', { at:h, spell:true });
      if (game.spellSave(foe, 'wis', dc, { magic:true })) {
        game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`🧿 ${foe.data.name} resists Bestow Curse!`, 'miss');
      } else {
        const curses = ['weakenedDmg','slowed','baned'];
        const curse = curses[Math.floor(Math.random() * curses.length)];
        applyEffect(foe, curse, { duration:60, elapsed: game.fxNow, source:h });
        game.concentrate(h, 'bestowCurse', [{ e:foe, key:curse }]);
        game.playAbilityFx(h, 'bestowCurse', { at:foe });
        const labels = { weakenedDmg:'Weakened', slowed:'Slowed', baned:'Baned' };
        game.fxLog(`🧿 ${h.data.name} curses ${foe.data.name} — ${labels[curse]}!`, 'crit');
      }
      return true;
    }
  },

  lightningBolt: {
    label:'Lightning Bolt', level:3,
    desc:'100-ft line of lightning: 8d6 (+1d6 per slot above 3rd) lightning damage to all creatures in the line (Dex save for half).',
    recharge:'slot',
    ai:{ when:'cluster', priority:8, minTargets:2, aoeRadius:8.0 },
    dmgType:'lightning',
    color:0x7090ff,
    cast(game, h, foe, alive, slotLevel = 3) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const diceCount = 8 + Math.max(0, (slotLevel || 3) - 3);

      const dx = foe.x - h.x;
      const dz = foe.z - h.z;
      const dist = Math.hypot(dx, dz) || 1.0;
      const dirX = dx / dist;
      const dirZ = dz / dist;

      const lineLength = 20.0; // 100 ft line
      const lineWidth = 1.0;
      const startX = h.x;
      const startZ = h.z;
      const endX = h.x + dirX * lineLength;
      const endZ = h.z + dirZ * lineLength;

      const from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(endX, 0.55, endZ);

      game.playAbilityFx(h, 'lightningBolt', { at:foe, spell:true, scale:2.5 });
      game.fxLog(`⚡ ${d.name} casts Lightning Bolt in a 100-ft crackling line!`, 'crit');

      game.fxBeam(from, to, {
        type: 'lightning',
        color: this.color,
        coreColor: 0xffffff,
        width: 0.65,
        duration: 0.65,
        casterBurst: 'lightning_burst_002_large_violet',
        targetBurst: 'lightning_strike_001_large_violet'
      });

      const list = game.monsters || [];
      for (const m of list) {
        if (!m || m.dead || m.data?.hp <= 0 || m.active === false) continue;
        if (isPointInLineSegment(m.x, m.z, startX, startZ, endX, endZ, lineWidth * 0.5 + 0.35)) {
          let dmg = roll(diceCount, 6, d.dmgBonus);
          if (game.spellSave(m, 'dex', dc, { magic:true })) dmg = Math.floor(dmg / 2);
          game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
        }
      }
      return true;
    }
  },

  massHealingWord: {
    label:'Mass Healing Word', level:3, bonusAction:true,
    desc:'Heal 3 wounded allies (1d4 + mod each; +1d4 per slot above 3rd).',
    recharge:'slot',
    ai:{ when:'hurtAlly', priority:9, hpFrac:0.5, minCombatSec:1.0 },
    color:0x6ae06a,
    cast(game, h, _, alive, slotLevel = 3) {
      const d = h.data;
      const targets = alive.concat(game.heroes.filter(x => x.data.hp <= 0));
      const hurt = targets
        .filter(a => a.data.hp <= 0 || a.data.hp < a.data.maxHp * 0.75)
        .sort((a, b) => Math.max(0, a.data.hp) / a.data.maxHp - Math.max(0, b.data.hp) / b.data.maxHp)
        .slice(0, 3);
      if (!hurt.length) return false;
      game.markSpellUsed(h, this);
      const diceCount = 1 + Math.max(0, (slotLevel || 3) - 3);
      for (const a of hurt) {
        const amt = roll(diceCount, 4, mod(castAbility(h)) + d.healBonus);
        game.healHero(a, amt);
      }
      game.playAbilityFx(h, 'massHealingWord', { at:h, alsoAt:hurt, spell:true, ring:2.0 });
      game.fxLog(`✨ ${d.name} casts Mass Healing Word on ${hurt.length} allies!`, 'heal');
      return true;
    }
  },

  vampiricTouch: {
    label:'Vampiric Touch', level:3,
    desc:'Drain foe for 3d6 (+1d6 per slot above 3rd) and heal self for half.',
    recharge:'slot',
    ai:{ when:'selfHurt', priority:7, hpFrac:0.45, minCombatSec:1.5 },
    dmgType:'necrotic',
    color:0xc04040,
    cast(game, h, foe, alive, slotLevel = 3) {
      if (!foe || foe.dead) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5 * (foe.data?.scale || 1.0) + 0.4, foe.z);

      game.fxBeam(from, to, {
        type: 'drain',
        color: 0x9b59b6,
        coreColor: 0xff6060,
        width: 0.42,
        duration: 0.65,
        scrollSpeed: -3.5,
        casterBurst: 'spell_absorb_001_large_violet',
        targetBurst: 'spell_death_001_large_red'
      });

      const diceCount = 3 + Math.max(0, (slotLevel || 3) - 3);
      const dmg = roll(diceCount, 6, d.dmgBonus);
      game.spellDamage(foe, dmg, h, false, { dmgType:this.dmgType, magical:true });
      const heal = Math.max(1, Math.round(dmg * 0.5));
      game.healHero(h, heal);
      game.playAbilityFx(h, 'vampiricTouch', { at:foe, spell:true });
      game.fxLog(`🩸 ${d.name} drains ${foe.data.name}, healing ${heal}!`, 'crit');
      return true;
    }
  },

  /* ── Level 4 ── */
  iceStorm: {
    label:'Ice Storm', level:4,
    desc:'Hailstorm: 2d8 bludgeoning + 4d6 cold (+1d6 cold per slot above 4th, DEX half) + slow on failed save.',
    recharge:'slot',
    ai:{ when:'cluster', priority:9, minTargets:3, minCombatSec:1.5, aoeRadius:3.0 },
    aoeRadius: 3.0,
    dmgType:'cold',
    color:0x7fd4ff,
    cast(game, h, foe, alive, slotLevel = 4, targetPos = null) {
      const d = h.data;
      const center = targetPos || (foe ? { x: foe.x, z: foe.z } : null);
      if (!center) return false;
      const foes = clusterAround(game, center, 3.0);
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const coldDice = 4 + Math.max(0, (slotLevel || 4) - 4);
      game.playAbilityFx(h, 'iceStorm', { at: center, alsoAt: foes, spell: true, ring: 3.0, scale: 2.4 });
      game.fxLog(`❄ ${d.name} casts Ice Storm!`, 'crit');

      // Staggered falling hailstones over target area
      for (let i = 0; i < 4; i++) {
        const delayMs = i * 100;
        later(game, delayMs, () => {
          const from = game._v3(center.x + (Math.random() - 0.5) * 2.0, 6.0, center.z + (Math.random() - 0.5) * 2.0);
          const to = game._v3(from.x, 0.4, from.z);
          game.fxProjectile(from, to, 'bolt', this.color, () => {
            game.fxSprite('dcss/effect/cloud_cold_0.png', to, 1.6, 0.35);
          }, { sheetKey: 'round_sparkle_burst_001_large_blue', scale: 1.4 });
        }, delayMs);
      }

      for (const m of foes) {
        if (m.dead) continue;
        const saved = game.spellSave(m, 'dex', dc, { magic:true });
        const mul = saved ? 0.5 : 1;
        game.spellDamage(m, Math.floor(roll(2, 8, d.dmgBonus) * mul), h, false, { dmgType:'bludgeoning', magical:true });
        game.spellDamage(m, Math.floor(roll(coldDice, 6, d.dmgBonus) * mul), h, false, { dmgType:'cold', magical:true });
        if (!saved) applyEffect(m, 'slowed', { duration:ROUND_SECONDS, elapsed: game.fxNow, source:h });
      }
      return true;
    }
  },

  blight: {
    label:'Blight', level:4,
    desc:'Necromantic drain: 8d8 necrotic (+1d8 per slot above 4th, CON save half). No effect on undead/constructs.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:9, minCombatSec:2.0 },
    dmgType:'necrotic',
    color:0x6a3080,
    cast(game, h, foe, alive, slotLevel = 4) {
      if (!foe || foe.dead) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'blight', { at:foe, spell:true, scale:2.0 });

      /* Blight has no effect on undead or constructs (5e). */
      if (foe.data.type === 'undead' || foe.data.type === 'construct') {
        game.fxText('no effect', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`🟣 ${d.name}'s Blight has no effect on ${foe.data.name}.`, 'miss');
        return true;
      }

      const from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5 * (foe.data?.scale || 1.0) + 0.4, foe.z);

      game.fxBeam(from, to, {
        type: 'drain',
        color: 0x6a3080,
        coreColor: 0x000000,
        width: 0.50,
        duration: 0.70,
        scrollSpeed: -4.5,
        casterBurst: 'spell_death_001_large_red',
        targetBurst: 'stylized_skull_smoke_burst_001_large_white'
      });

      const dc = spellDC(h);
      const diceCount = 8 + Math.max(0, (slotLevel || 4) - 4);
      let dmg = roll(diceCount, 8, d.dmgBonus);
      if (game.spellSave(foe, 'con', dc, { magic:true })) dmg = Math.floor(dmg / 2);
      game.spellDamage(foe, dmg, h, false, { dmgType:this.dmgType, magical:true });
      game.fxLog(`🟣 ${d.name} casts Blight on ${foe.data.name}!`, 'crit');
      return true;
    }
  },

  deathWard: {
    label:'Death Ward', level:4,
    desc:'Protect an ally: next time they go down, survive at 1 HP instead.',
    recharge:'long',
    ai:{ when:'hurtAlly', priority:9, hpFrac:0.25, minCombatSec:2.0 },
    color:0xffe08a,
    cast(game, h, _, alive) {
      let worst = null, wf = 1;
      for (const a of alive) {
        const f = a.data.hp / a.data.maxHp;
        if (f < wf && !hasEffect(a, 'deathWarded')) { wf = f; worst = a; }
      }
      if (!worst) return false;
      game.markSpellUsed(h, this);
      /* 8 hours in RAW, no concentration — effectively lasts until triggered */
      applyEffect(worst, 'deathWarded', { duration:600, elapsed: game.fxNow });
      game.playAbilityFx(h, 'deathWard', { at:worst, spell:true, scale:1.6 });
      game.fxLog(`🛡 ${h.data.name} casts Death Ward on ${worst.data.name}!`, 'buff');
      return true;
    }
  },

  wallOfFire: {
    label:'Wall of Fire', level:4, concentration:true,
    desc:'Blazing wall (60-ft line): 5d8 fire damage to creatures in its area on cast or entering (Dex save for half; concentration).',
    recharge:'slot',
    ai:{ when:'cluster', priority:8, minTargets:2, minCombatSec:1.5, aoeRadius:6.0 },
    color:0xff5010,
    dmgType:'fire',
    cast(game, h, foe) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);

      const dx = foe.x - h.x;
      const dz = foe.z - h.z;
      const dist = Math.hypot(dx, dz) || 1.0;
      const dirX = dx / dist;
      const dirZ = dz / dist;

      const lineLength = 12.0; // 60 ft (12 tiles)
      const lineWidth = 1.0;  // 5 ft (1 tile)
      const startX = h.x;
      const startZ = h.z;
      const endX = h.x + dirX * lineLength;
      const endZ = h.z + dirZ * lineLength;
      const midX = (startX + endX) * 0.5;
      const midZ = (startZ + endZ) * 0.5;
      const angle = Math.atan2(dirZ, dirX);

      game.playAbilityFx(h, 'wallOfFire', { at: { x: midX, z: midZ }, spell:true, scale:2.8 });
      game.fxLog(`🔥 ${d.name} casts Wall of Fire in a 60-ft blazing line!`, 'crit');

      const zone = game.spawnAoEZone(h, 'wallOfFire', midX, midZ, lineLength * 0.5, {
        color: this.color,
        shape: 'line',
        startX,
        startZ,
        endX,
        endZ,
        width: lineWidth,
        length: lineLength,
        angle,
        dur: 60,
        indicatorOpacity: 0.28,
        pointLight: false,
        loopSheet: {
          sheetKey: 'wall_of_fire_fire',
          opacity: 0.85,
          scale: 6.9,
          repeatCount: 16,
          layout: 'line',
          length: lineLength,
          grounded: true,
          centerY: 0.235,
          y: -0.28
        }
      });

      const list = game.monsters || [];
      for (const m of list) {
        if (!m || m.dead || m.data?.hp <= 0 || m.active === false) continue;
        if (isPointInLineSegment(m.x, m.z, startX, startZ, endX, endZ, lineWidth * 0.5 + 0.35)) {
          let dmg = roll(5, 8, d.dmgBonus);
          if (game.spellSave(m, 'dex', dc, { magic:true })) dmg = Math.floor(dmg / 2);
          game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
        }
      }

      game.concentrate(h, 'wallOfFire', [], zone);
      return true;
    }
  },

  /* ── Level 5 ── */
  coneOfCold: {
    label:'Cone of Cold', level:5,
    desc:'60-ft cone of frost: 8d8 (+1d8 per slot above 5th) cold damage to creatures in the cone (Con save for half).',
    recharge:'slot',
    ai:{ when:'cluster', priority:9, minTargets:2, minCombatSec:1.5, aoeRadius:8.0 },
    dmgType:'cold',
    color:0x7fd4ff,
    cast(game, h, foe, alive, slotLevel = 5) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const diceCount = 8 + Math.max(0, (slotLevel || 5) - 5);
      const dx = foe.x - h.x;
      const dz = foe.z - h.z;
      const range = 12.0; // 60 ft cone

      game.playAbilityFx(h, 'coneOfCold', { at:foe, spell:true, ring:2.8, scale:2.6 });
      game.fxLog(`❄️ ${d.name} blasts a 60-ft Cone of Cold!`, 'crit');

      const list = game.monsters || [];
      for (const m of list) {
        if (!m || m.dead || m.data?.hp <= 0 || m.active === false) continue;
        if (isPointInCone(m.x, m.z, h.x, h.z, dx, dz, range, 0.55)) {
          let dmg = roll(diceCount, 8, d.dmgBonus);
          if (game.spellSave(m, 'con', dc, { magic:true })) dmg = Math.floor(dmg / 2);
          game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
        }
      }
      return true;
    }
  },

  flameStrike: {
    label:'Flame Strike', level:5,
    desc:'Divine fire column: 4d6 fire + 4d6 radiant (+1d6 each per slot above 5th).',
    recharge:'slot',
    ai:{ when:'cluster', priority:9, minTargets:2, minCombatSec:2.0 , aoeRadius:2.5},
    dmgType:'radiant',
    color:0xffd34a,
    cast(game, h, foe, alive, slotLevel = 5) {
      const d = h.data, foes = clusterAround(game, foe, 2.5);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const upBonus = Math.max(0, (slotLevel || 5) - 5);
      const from = game._v3(foe.x, 7.0, foe.z);
      const to = game._v3(foe.x, 0.4 * (foe.data?.scale || 1.0) + 0.3, foe.z);

      game.playAbilityFx(h, 'flameStrike', { at:foe, alsoAt:foes, spell:true, ring:2.5, scale:2.4 });
      game.fxLog(`🔥 ${d.name} calls down Flame Strike!`, 'crit');

      game.fxBeam(from, to, {
        type: 'pillar',
        color: 0xffd34a,
        coreColor: 0xffffff,
        width: 2.2,
        duration: 0.80,
        scrollSpeed: 5.0,
        targetBurst: 'epic_explosion_002_large_yellow'
      });

      for (const m of foes) {
        if (m.dead) continue;
        const saved = game.spellSave(m, 'dex', dc, { magic:true });
        const mul = saved ? 0.5 : 1;
        game.spellDamage(m, Math.floor(roll(4 + upBonus, 6, d.dmgBonus) * mul), h, false, { dmgType:'fire', magical:true });
        game.spellDamage(m, Math.floor(roll(4 + upBonus, 6, d.dmgBonus) * mul), h, false, { dmgType:'radiant', magical:true });
      }
      return true;
    }
  },

  massCureWounds: {
    label:'Mass Cure Wounds', level:5,
    desc:'Heal all living party members for 3d8 + mod (+1d8 per slot above 5th).',
    recharge:'long',
    ai:{ when:'hurtAlly', priority:10, hpFrac:0.35, minCombatSec:2.0 },
    color:0x6ae06a,
    cast(game, h, _, alive, slotLevel = 5) {
      const d = h.data;
      const targets = alive.concat(game.heroes.filter(x => x.data.hp <= 0));
      game.markSpellUsed(h, this);
      const diceCount = 3 + Math.max(0, (slotLevel || 5) - 5);
      for (const a of targets) {
        const amt = roll(diceCount, 8, mod(castAbility(h)) + d.healBonus);
        game.healHero(a, amt);
      }
      game.playAbilityFx(h, 'massCureWounds', { at:h, alsoAt:targets, spell:true, ring:2.5, scale:2.2 });
      game.fxLog(`✨ ${d.name} casts Mass Cure Wounds — party healed!`, 'heal');
      return true;
    }
  },

  holdMonster: {
    label:'Hold Monster', level:5, concentration:true,
    desc:'Paralyze any creature (WIS save, repeats each round). Melee auto-crits.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:9, minCombatSec:2.0 },
    color:0x8090c0,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'holdMonster', { at:h, spell:true });
      if (game.spellSave(foe, 'wis', dc, { magic:true })) {
        game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`🔗 ${foe.data.name} resists Hold Monster!`, 'miss');
      } else {
        applyEffect(foe, 'paralyzed', { duration:60, elapsed: game.fxNow, source:h,
          repeatSave:{ ability:'wis', dc, every:6 } });
        game.concentrate(h, 'holdMonster', [{ e:foe, key:'paralyzed' }]);
        game.playAbilityFx(h, 'holdMonster', { at:foe });
        game.fxLog(`🔗 ${h.data.name} paralyzes ${foe.data.name}!`, 'crit', { cat: 'effect' });
      }
      return true;
    }
  },

  /* ============ NEW ICONIC SPELLS (SRD audit 2026-07-12) ============ */

  guidingBolt: {
    label:'Guiding Bolt', level:1,
    desc:'4d6 radiant (+1d6 per slot above 1st) + marks the foe (attacks against it have advantage).',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7 },
    dmgType:'radiant',
    color:0xffe08a,
    cast(game, h, foe, alive, slotLevel = 1) {
      if (!foe || foe.dead) return false;
      const d = h.data, from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5 * (foe.data?.scale || 1.0) + 0.4, foe.z);
      const diceCount = 4 + Math.max(0, (slotLevel || 1) - 1);
      const amt = roll(diceCount, 6, d.dmgBonus);
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'guidingBolt', { at:h, spell:true });

      game.fxBeam(from, to, {
        type: 'laser',
        color: this.color,
        coreColor: 0xffffff,
        width: 0.42,
        duration: 0.5,
        scrollSpeed: 4.5,
        casterBurst: 'round_light_burst_001_large_yellow',
        targetBurst: 'round_light_burst_001_large_yellow',
        onHit: () => {
          if (foe.dead) return;
          game.spellDamage(foe, amt, h, false, { dmgType:this.dmgType, magical:true });
          game.fxSprite('dcss/effect/orb_glow_0.png', to, 1.2, 0.3);
        }
      });

      /* next attack vs this foe has advantage (reuses the faerieFire marking) */
      applyEffect(foe, 'faerieFire', { duration:ROUND_SECONDS, elapsed: game.fxNow, source:h });
      game.fxLog(`✦ ${d.name} hits ${foe.data.name} with Guiding Bolt!`, 'crit');
      return true;
    }
  },

  thunderwave: {
    label:'Thunderwave', level:1,
    desc:'Wave of thunder: 2d8 thunder (+1d8 per slot above 1st) to foes within 15 ft (CON save half; pushes 10 ft on fail).',
    recharge:'slot',
    ai:{ when:'cluster', priority:6, minTargets:2 , aoeRadius:3, aoeOrigin:'self'},
    dmgType:'thunder',
    color:0xdfe4ee,
    cast(game, h, foe, alive, slotLevel = 1) {
      const d = h.data, foes = clusterAround(game, h, 3.0);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const diceCount = 2 + Math.max(0, (slotLevel || 1) - 1);
      game.playAbilityFx(h, 'thunderwave', { at:h, alsoAt:foes, spell:true, ring:3.0, scale:2.0 });
      game.fxLog(`💥 ${d.name} casts Thunderwave!`, 'crit');
      for (const m of foes) {
        if (m.dead) continue;
        const saved = game.spellSave(m, 'con', dc, { magic:true });
        let dmg = roll(diceCount, 8, d.dmgBonus);
        if (saved) {
          dmg = Math.floor(dmg / 2);
        } else {
          // Push foe 2 cells (10 ft) away from caster, stopping at walls/bodies.
          if (typeof game.pushEntity === 'function') {
            game.pushEntity(m, h.x, h.z, 2, 1);
          } else {
            const dist = Math.hypot(m.x - h.x, m.z - h.z) || 1.0;
            m.x += ((m.x - h.x) / dist) * 2.0;
            m.z += ((m.z - h.z) / dist) * 2.0;
          }
        }
        game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
      }
      return true;
    }
  },

  cureWounds: {
    label:'Cure Wounds', level:1,
    desc:'Strong touch heal on the most-wounded ally (1d8 + mod; +1d8 per slot above 1st).',
    recharge:'slot',
    ai:{ when:'hurtAlly', priority:7, hpFrac:0.5 },
    color:0x6ae06a,
    cast(game, h, targetAlly, alive, slotLevel = 1) {
      const d = h.data;
      const isManual = game && game.controlMode === 'manual';
      let target = (targetAlly && targetAlly._side === 'hero') ? targetAlly : null;
      if (!target) {
        const targets = alive.concat(game.heroes.filter(x => x.data.hp <= 0));
        let worst = null, wf = 1;
        for (const a of targets) { const f = Math.max(0, a.data.hp / a.data.maxHp); if (f < wf) { wf = f; worst = a; } }
        if (!worst || (!isManual && worst.data.hp > 0 && wf >= 0.6)) return false;
        target = worst;
      }
      game.markSpellUsed(h, this);
      const diceCount = 1 + Math.max(0, (slotLevel || 1) - 1);
      const amt = roll(diceCount, 8, mod(castAbility(h)) + (d.healBonus || 0));
      game.healHero(target, amt);
      game.playAbilityFx(h, 'cureWounds', { at:target, spell:true });
      game.fxLog(`💚 ${d.name} casts Cure Wounds on ${target.data.name} (+${amt}).`, 'heal');
      return true;
    }
  },

  shieldOfFaith: {
    label:'Shield of Faith', level:1, bonusAction:true, concentration:true,
    desc:'+2 AC on a hard-pressed ally (concentration).',
    recharge:'slot',
    ai:{ when:'hurtAlly', priority:6, hpFrac:0.6, buffEffect:'shieldOfFaith', buffTarget:'ally' },
    color:0xa0c0ff,
    cast(game, h, foe, alive) {
      /* Ward the most-wounded ally that isn't already shielded. */
      let worst = null, wf = 1;
      for (const a of alive) {
        if (hasEffect(a, 'shieldOfFaith')) continue;
        const f = a.data.hp / a.data.maxHp;
        if (f < wf) { wf = f; worst = a; }
      }
      if (!worst) return false;
      game.markSpellUsed(h, this);
      applyEffect(worst, 'shieldOfFaith', { duration:60, elapsed: game.fxNow });
      game.concentrate(h, 'shieldOfFaith', [{ e:worst, key:'shieldOfFaith' }]);
      game.playAbilityFx(h, 'shieldOfFaith', { at:worst, spell:true });
      game.fxLog(`🛡 ${h.data.name} casts Shield of Faith on ${worst.data.name}! (+2 AC)`, 'buff');
      return true;
    }
  },

  magicWeapon: {
    label:'Magic Weapon', level:2, concentration:true,
    desc:'Imbue your weapon with magic: +1 atk/dmg and bypasses nonmagical resistance.',
    recharge:'slot',
    ai:{ when:'any', priority:5, minCombatSec:1.0, buffEffect:'magicWeapon', buffTarget:'self' },
    color:0xb08cff,
    cast(game, h) {
      game.markSpellUsed(h, this);
      applyEffect(h, 'magicWeapon', { duration:60, elapsed: game.fxNow, source:h });
      game.concentrate(h, 'magicWeapon', [{ e:h, key:'magicWeapon' }]);
      game.playAbilityFx(h, 'magicWeapon', { at:h, spell:true });
      game.fxLog(`✨ ${h.data.name}'s weapon glows with magic! (+1)`, 'buff');
      return true;
    }
  },

  barkskin: {
    label:'Barkskin', level:2, concentration:true,
    desc:'Tough bark: AC can\'t go below 16 for 1 min.',
    recharge:'slot',
    ai:{ when:'selfHurt', priority:6, hpFrac:0.5, buffEffect:'barkskin', buffTarget:'self' },
    color:0x6aaa4a,
    cast(game, h) {
      game.markSpellUsed(h, this);
      applyEffect(h, 'barkskin', { duration:60, elapsed: game.fxNow, source:h });
      game.concentrate(h, 'barkskin', [{ e:h, key:'barkskin' }]);
      game.playAbilityFx(h, 'barkskin', { at:h, spell:true });
      game.fxLog(`🪵 ${h.data.name}'s skin hardens like bark! (AC ≥ 16)`, 'buff');
      return true;
    }
  },

  enlargeReduce: {
    label:'Enlarge', level:2, concentration:true,
    desc:'Magically grow by 50%: +25% damage and +2 bonus damage on attacks.',
    recharge:'slot',
    ai:{ when:'any', priority:6, minCombatSec:0.5, buffEffect:'enlarged', buffTarget:'ally' },
    color:0xffb45a,
    cast(game, h, foe, alive) {
      /* Pick an ally that does not yet have enlarged, preferring frontline martial classes */
      let best = h;
      for (const a of (alive || [h])) {
        if (hasEffect(a, 'enlarged')) continue;
        const cls = a.data?.classKey;
        if (cls === 'barbarian' || cls === 'fighter' || cls === 'paladin' || cls === 'monk') {
          best = a; break;
        }
      }
      game.markSpellUsed(h, this);
      applyEffect(best, 'enlarged', { duration:60, elapsed: game.fxNow, source:h });
      game.concentrate(h, 'enlargeReduce', [{ e:best, key:'enlarged' }]);
      game.playAbilityFx(h, 'enlargeReduce', { at:best, spell:true });
      game.fxLog(`💪 ${h.data.name} enlarges ${best.data.name}! (+50% size, +25% damage)`, 'buff');
      return true;
    }
  },
  /* ============ NEW EXPANDED SPELLS & WARLOCK INVOCATIONS ============ */

  eldritchBlast: {
    label:'Eldritch Blast', level:0, cantrip:true,
    desc:'Beam of crackling force (1d10 force each; +1 beam at Lvl 5, 11, 17). Augmented by Eldritch Invocations.',
    recharge:'none',
    ai:{ when:'any', priority:7 },
    dmgType:'force',
    color:0xa050ff,
    cast(game, h, foe) {
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const d = h.data || h;
      const lvl = d.level || 1;

      // 5e Beam scaling: 1 beam at Lvl 1-4, 2 beams at Lvl 5-10, 3 beams at Lvl 11-16, 4 beams at Lvl 17-20
      const beams = lvl >= 17 ? 4 : lvl >= 11 ? 3 : lvl >= 5 ? 2 : 1;

      game.playAbilityFx(h, 'eldritchBlast', { at:h, spell:true });
      game.fxLog(`🔮 ${d.name} casts Eldritch Blast (${beams} beam${beams === 1 ? '' : 's'})!`, 'crit');

      const hasAgonizing = hasFeature(h, 'agonizingBlast') || (d.invocations && d.invocations.includes('agonizingBlast'));
      const hasRepelling = hasFeature(h, 'repellingBlast') || (d.invocations && d.invocations.includes('repellingBlast'));
      const hasGrasp = hasFeature(h, 'graspOfHadar') || (d.invocations && d.invocations.includes('graspOfHadar'));
      const hasLance = hasFeature(h, 'lanceOfLethargy') || (d.invocations && d.invocations.includes('lanceOfLethargy'));
      const chaMod = mod(d.effStats?.cha ?? 10);

      const allocatedHpMap = new Map();
      for (const m of (game.monsters || [])) {
        if (m.data && m.data.hp > 0) allocatedHpMap.set(m, m.data.hp);
      }
      const avgBeamDmg = 5.5 + (hasAgonizing ? Math.max(0, chaMod) : 0) + (d.dmgBonus || 0);

      for (let i = 0; i < beams; i++) {
        const delayMs = i * 140;
        let beamTarget = pickProjectileTarget(game, h, foe, allocatedHpMap);
        if (beamTarget) {
          const curEst = allocatedHpMap.get(beamTarget) || beamTarget.data.hp;
          allocatedHpMap.set(beamTarget, curEst - avgBeamDmg);
        }

        later(game, delayMs, () => {
          if (!beamTarget || beamTarget.dead) beamTarget = pickProjectileTarget(game, h, foe);
          if (!beamTarget || beamTarget.dead) return;

          const from = game._v3(h.x, 0.55, h.z);
          const to = game._v3(beamTarget.x, 0.5 * (beamTarget.data?.scale || 1.0) + 0.4, beamTarget.z);
          const targetRef = beamTarget;

          game.fxBeam(from, to, {
            type: 'lightning',
            color: this.color,
            coreColor: 0x80ff80,
            width: 0.45,
            duration: 0.5,
            scrollSpeed: 6.0,
            casterBurst: 'spell_darkness_001_large_violet',
            targetBurst: 'round_firework_burst_001_large_green',
            onHit: () => {
              if (targetRef.dead) return;
              let dmg = roll(1, 10, d.dmgBonus || 0);
              if (hasAgonizing) dmg += Math.max(0, chaMod);

              game.spellDamage(targetRef, dmg, h, false, { dmgType: this.dmgType, magical: true });
              game.fxSprite('dcss/effect/cloud_chaos_4.png', to, 1.2, 0.3);

              if (hasRepelling) {
                if (typeof game.pushEntity === 'function') {
                  game.pushEntity(targetRef, h.x, h.z, 2, 1);
                } else {
                  const dist = Math.hypot(targetRef.x - h.x, targetRef.z - h.z) || 1.0;
                  targetRef.x += ((targetRef.x - h.x) / dist) * 2.0;
                  targetRef.z += ((targetRef.z - h.z) / dist) * 2.0;
                }
                game.fxLog(`💨 Repelling Blast pushes ${targetRef.data.name} back 10 ft!`, 'roll');
              } else if (hasGrasp) {
                if (typeof game.pushEntity === 'function') {
                  game.pushEntity(targetRef, h.x, h.z, 2, -1);
                } else {
                  const dist = Math.hypot(targetRef.x - h.x, targetRef.z - h.z) || 1.0;
                  targetRef.x -= ((targetRef.x - h.x) / dist) * 2.0;
                  targetRef.z -= ((targetRef.z - h.z) / dist) * 2.0;
                }
                game.fxLog(`🧲 Grasp of Hadar pulls ${targetRef.data.name} 10 ft closer!`, 'roll');
              }

              if (hasLance) {
                applyEffect(targetRef, 'slowed', { duration: ROUND_SECONDS, elapsed: game.fxNow, source: h });
              }
            }
          });
        }, delayMs);
      }
      return true;
    }
  },

  chillTouch: {
    label:'Chill Touch', level:0, cantrip:true,
    desc:'Ghostly hand of necrotic energy (1d8 necrotic; +1 die at Lvl 5, 11, 17).',
    recharge:'none',
    ai:{ when:'any', priority:7 },
    dmgType:'necrotic',
    color:0x7fd8c8,
    cast(game, h, foe) {
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const d = h.data || h;
      const lvl = d.level || 1;
      const diceCount = lvl >= 17 ? 4 : lvl >= 11 ? 3 : lvl >= 5 ? 2 : 1;
      const amt = roll(diceCount, 8, d.dmgBonus || 0);
      const from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5 * (foe.data?.scale || 1.0) + 0.4, foe.z);

      game.playAbilityFx(h, 'chillTouch', { at: h, spell: true });
      game.fxLog(`👻 ${d.name} casts Chill Touch!`, 'crit');
      game.fxProjectile(from, to, 'bolt', this.color, () => {
        if (foe.dead) return;
        game.spellDamage(foe, amt, h, false, { dmgType: 'necrotic', magical: true });
      }, { classKey: 'sorcerer', dmgType: 'necrotic', scale: 1.4 });
      return true;
    }
  },

  chromaticOrb: {
    label:'Chromatic Orb', level:1,
    desc:'Orb of elemental energy: 3d8 (+1d8 per slot above 1st) fire, cold, lightning, or acid.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7 },
    color:0xff88ee,
    cast(game, h, foe, alive, slotLevel = 1) {
      if (!foe || foe.dead) return false;
      const elements = ['fire', 'cold', 'lightning', 'acid', 'poison'];
      const dmgType = elements[Math.floor(Math.random() * elements.length)];
      const d = h.data, from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5 * (foe.data?.scale || 1.0) + 0.4, foe.z);
      const diceCount = 3 + Math.max(0, (slotLevel || 1) - 1);
      const amt = roll(diceCount, 8, d.dmgBonus);
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'chromaticOrb', { at:h, spell:true });

      game.fxProjectile(from, to, 'bolt', this.color, () => {
        if (foe.dead) return;
        game.spellDamage(foe, amt, h, false, { dmgType, magical:true });
        game.fxSprite('dcss/effect/cloud_chaos_4.png', to, 1.4, 0.35);
      }, { sheetKey: 'round_firework_burst_001_large_green', scale: 1.4 });

      game.fxLog(`🌈 ${d.name} casts Chromatic Orb (${dmgType})!`, 'crit');
      return true;
    }
  },

  rayOfSickness: {
    label:'Ray of Sickness', level:1,
    desc:'Ray of noxious energy: 2d8 poison (+1d8 per slot above 1st) and poisoned condition on CON save fail.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:6 },
    dmgType:'poison',
    color:0x40c040,
    cast(game, h, foe, alive, slotLevel = 1) {
      if (!foe || foe.dead) return false;
      const d = h.data, from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5 * (foe.data?.scale || 1.0) + 0.4, foe.z);
      const dc = spellDC(h);
      const diceCount = 2 + Math.max(0, (slotLevel || 1) - 1);
      const amt = roll(diceCount, 8, d.dmgBonus);
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'rayOfSickness', { at:h, spell:true });

      game.fxBeam(from, to, {
        type: 'laser',
        color: this.color,
        coreColor: 0xa0ffa0,
        width: 0.38,
        duration: 0.5,
        onHit: () => {
          if (foe.dead) return;
          game.spellDamage(foe, amt, h, false, { dmgType:this.dmgType, magical:true });
          if (!game.spellSave(foe, 'con', dc, { magic:true })) {
            applyEffect(foe, 'poisoned', { duration:60, elapsed: game.fxNow, source:h });
            game.fxLog(`🤢 ${foe.data.name} is poisoned by Ray of Sickness!`, 'crit');
          }
        }
      });
      game.fxLog(`🤢 ${d.name} casts Ray of Sickness!`, 'crit');
      return true;
    }
  },

  flamingSphere: {
    label:'Flaming Sphere', level:2, concentration:true,
    desc:'Summon a 5-ft fire sphere: 2d6 fire (+1d6 per slot above 2nd, DEX save half) to nearby foes.',
    recharge:'slot',
    ai:{ when:'cluster', priority:7, minTargets:2 , aoeRadius:2.2},
    color:0xff6600,
    dmgType:'fire',
    cast(game, h, foe, alive, slotLevel = 2) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'flamingSphere', { at:foe, spell:true, ring:2.2 });
      game.fxLog(`🔥 ${d.name} summons a Flaming Sphere!`, 'crit');

      const zone = game.spawnAoEZone(h, 'flamingSphere', foe.x, foe.z, 2.2, {
        color: this.color, dur: 60,
        loopSheet: { sheetKey: 'epic_explosion_001_large_orange', opacity: 0.36, scale: 2.0 }
      });
      const foes = clusterAround(game, foe, 2.2);
      const diceCount = 2 + Math.max(0, (slotLevel || 2) - 2);

      for (const m of foes) {
        if (m.dead) continue;
        let dmg = roll(diceCount, 6, d.dmgBonus);
        if (game.spellSave(m, 'dex', dc, { magic:true })) dmg = Math.floor(dmg / 2);
        game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
      }

      game.concentrate(h, 'flamingSphere', [], zone);
      return true;
    }
  },

  mirrorImage: {
    label:'Mirror Image', level:2,
    desc:'Summon 3 illusory duplicates of yourself to absorb incoming attacks (+3 AC bonus for 1 min).',
    recharge:'slot',
    ai:{ when:'selfHurt', priority:7, hpFrac:0.7 },
    color:0x88ccff,
    cast(game, h) {
      game.markSpellUsed(h, this);
      applyEffect(h, 'shielded', { duration:60, elapsed: game.fxNow, source:h });
      game.playAbilityFx(h, 'mirrorImage', { at:h, spell:true, scale:2.2 });
      game.fxLog(`🪞 ${h.data.name} creates 3 Mirror Images! (+3 AC)`, 'buff');
      return true;
    }
  },

  counterspell: {
    label:'Counterspell', level:3, reaction:true,
    desc:'Interrupt and nullify an enemy spell cast.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:10 },
    color:0x4080ff,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'counterspell', { at:foe, spell:true, scale:2.0 });
      game.fxText('countered!', game._v3(foe.x, 1.2, foe.z), '#4080ff');
      game.fxLog(`🚫 ${h.data.name} counterspells ${foe.data.name}'s casting!`, 'crit');
      return true;
    }
  },

  hypnoticPattern: {
    label:'Hypnotic Pattern', level:3, concentration:true,
    desc:'Pattern of colors incapacitates foes in a 30 ft area (WIS save; concentration).',
    recharge:'slot',
    ai:{ when:'cluster', priority:9, minTargets:3 , aoeRadius:3.5},
    color:0xee88ff,
    cast(game, h, foe, alive, slotLevel = 3) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const foes = clusterAround(game, foe, 3.5);
      game.playAbilityFx(h, 'hypnoticPattern', { at:foe, alsoAt:foes, spell:true, ring:3.5, scale:2.5 });
      game.fxLog(`🌀 ${d.name} weaves a Hypnotic Pattern!`, 'crit');

      const applied = [];
      for (const m of foes) {
        if (m.dead) continue;
        if (game.spellSave(m, 'wis', dc, { magic:true })) {
          game.fxText('saved', game._v3(m.x, 1.2, m.z), '#9aa');
        } else {
          applyEffect(m, 'unconscious', { duration:60, elapsed: game.fxNow, source:h });
          applied.push({ e:m, key:'unconscious' });
          game.fxLog(`🌀 ${m.data.name} is hypnotized!`, 'crit');
        }
      }
      game.concentrate(h, 'hypnoticPattern', applied);
      return true;
    }
  },

  polymorph: {
    label:'Polymorph', level:4, concentration:true,
    desc:'Transform an ally into a Giant Ape (+30 Temp HP & heavy slams) or a foe into a docile Sheep.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:8 },
    color:0x50c878,
    cast(game, h, foe, alive) {
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);

      let worstAlly = null, wf = 1;
      for (const a of alive) {
        const f = a.data.hp / a.data.maxHp;
        if (f < wf) { wf = f; worstAlly = a; }
      }

      if (worstAlly && wf < 0.45) {
        worstAlly.data.tempHp = (worstAlly.data.tempHp || 0) + 30;
        applyEffect(worstAlly, 'blessed', { duration:60, elapsed: game.fxNow, source:h });
        game.concentrate(h, 'polymorph', [{ e:worstAlly, key:'blessed' }]);
        game.playAbilityFx(h, 'polymorph', { at:worstAlly, spell:true, scale:2.4 });
        game.fxLog(`🦍 ${d.name} polymorphs ${worstAlly.data.name} into a Giant Ape (+30 Temp HP)!`, 'buff');
      } else if (foe && !foe.dead) {
        if (game.spellSave(foe, 'wis', dc, { magic:true })) {
          game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
          game.fxLog(`🐑 ${foe.data.name} resists Polymorph!`, 'miss');
        } else {
          applyEffect(foe, 'slowed', { duration:60, elapsed: game.fxNow, source:h });
          game.concentrate(h, 'polymorph', [{ e:foe, key:'slowed' }]);
          game.playAbilityFx(h, 'polymorph', { at:foe, spell:true, scale:2.0 });
          game.fxLog(`🐑 ${d.name} polymorphs ${foe.data.name} into a harmless Sheep!`, 'crit');
        }
      }
      return true;
    }
  },

  dimensionDoor: {
    label:'Dimension Door', level:4,
    desc:'Instant teleportation: teleport caster and nearest ally up to 300 ft.',
    recharge:'slot',
    ai:{ when:'selfHurt', priority:8, hpFrac:0.3 },
    color:0x90e0ef,
    cast(game, h) {
      game.markSpellUsed(h, this);
      applyEffect(h, 'phaseStep', { duration:ROUND_SECONDS, elapsed: game.fxNow });
      game.playAbilityFx(h, 'dimensionDoor', { at:h, spell:true, scale:2.5 });
      game.fxLog(`🚪 ${h.data.name} steps through Dimension Door! (+5 AC)`, 'buff');
      return true;
    }
  },

  cloudkill: {
    label:'Cloudkill', level:5, concentration:true,
    desc:'20-ft radius poisonous cloud: 5d8 poison (+1d8 per slot above 5th, CON save half).',
    recharge:'slot',
    ai:{ when:'cluster', priority:9, minTargets:3 , aoeRadius:3.2},
    color:0x32cd32,
    dmgType:'poison',
    cast(game, h, foe, alive, slotLevel = 5) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'cloudkill', { at:foe, spell:true, ring:3.2, scale:2.6 });
      game.fxLog(`☣ ${d.name} creates a deadly Cloudkill!`, 'crit');

      const zone = game.spawnAoEZone(h, 'cloudkill', foe.x, foe.z, 3.2, {
        color: this.color, dur: 60,
        loopSheet: { sheetKey: 'burst_splatter_003_large_green', opacity: 0.30, y: 1.6 }
      });
      const foes = clusterAround(game, foe, 3.2);
      const diceCount = 5 + Math.max(0, (slotLevel || 5) - 5);

      for (const m of foes) {
        if (m.dead) continue;
        let dmg = roll(diceCount, 8, d.dmgBonus);
        if (game.spellSave(m, 'con', dc, { magic:true })) dmg = Math.floor(dmg / 2);
        game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
      }

      game.concentrate(h, 'cloudkill', [], zone);
      return true;
    }
  },

  animateObjects: {
    label:'Animate Objects', level:5, concentration:true,
    desc:'Animate 5 floating blades: strike foes for 1d4+4 force damage each as a bonus action.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:9 },
    color:0xffd700,
    dmgType:'force',
    cast(game, h, foe) {
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'animateObjects', { at:h, spell:true });
      game.fxLog(`⚔ ${d.name} animates 5 floating blades!`, 'crit');

      for (let i = 0; i < 5; i++) {
        const delayMs = i * 100;
        later(game, delayMs, () => {
          if (!foe || foe.dead) return;
          const from = game._v3(h.x + (Math.random() - 0.5) * 2.0, 1.2, h.z + (Math.random() - 0.5) * 2.0);
          const to = game._v3(foe.x, 0.5 * (foe.data?.scale || 1.0) + 0.3, foe.z);

          game.fxProjectile(from, to, 'bolt', this.color, () => {
            if (foe.dead) return;
            const dmg = roll(1, 4, 4 + (d.dmgBonus || 0));
            game.spellDamage(foe, dmg, h, false, { dmgType: this.dmgType, magical: true });
          }, { sheetKey: 'round_sparkle_burst_001_large_blue', scale: 1.2 });
        }, delayMs);
      }

      game.concentrate(h, 'animateObjects', []);
      return true;
    }
  },

  findFamiliar: {
    label:'Find Familiar', level:1, targetType:'self',
    desc:'Summon an arcane familiar (choose Owl 🦉, Imp 👿, or Viper 🐍) to assist in combat.',
    recharge:'long',
    ai:{ when:'any', priority:6 },
    color:0x88ccff,
    cast(game, h, foe, alive, slotLevel = 1, targetPos = null, choice = null) {
      const hasActiveFam = game.heroes && game.heroes.some(c =>
        c.companion && c.kind && (c.kind.includes('Familiar') || c.kind === 'owl' || c.kind === 'imp' || c.kind === 'viper') &&
        c.summonerName === h.data.name &&
        c.summonerClassKey === h.data.classKey &&
        c.data && c.data.hp > 0
      );
      if (hasActiveFam) {
        if (typeof game.fxLog === 'function') {
          game.fxLog(`🦉 ${h.data.name} already has an active familiar.`, 'sys');
        }
        return false;
      }
      game.markSpellUsed(h, this);
      const rawKind = choice || h.data?.familiarChoice || 'owlFamiliar';
      const kindMap = { owl: 'owlFamiliar', imp: 'impFamiliar', viper: 'viperFamiliar' };
      const chosenKind = kindMap[rawKind] || rawKind || 'owlFamiliar';
      game.playAbilityFx(h, 'findFamiliar', { at:h, spell:true, scale:2.0 });

      if (game.summons) {
        const spawned = game.summons.spawn(h, chosenKind);
        if (spawned) {
          const names = { owlFamiliar: 'Owl 🦉', impFamiliar: 'Imp 👿', viperFamiliar: 'Viper 🐍' };
          game.fxLog(`✨ ${h.data.name} summons an arcane ${names[chosenKind] || 'Familiar'}!`, 'buff');
        }
      }
      return true;
    }
  },

  /* ============ ICONIC LOWER TIER SPECIALS ============ */

  spikeGrowth: {
    label:'Spike Growth', level:2, concentration:true,
    desc:'Transmute ground into 20-ft hazard: creatures moving through take 2d4 piercing damage per 5 ft.',
    recharge:'slot',
    ai:{ when:'cluster', priority:7, minTargets:2, aoeRadius:3.5 },
    dmgType:'piercing',
    color:0x2e8b57,
    cast(game, h, foe, alive, slotLevel = 2) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'entangle', { at:foe, spell:true, ring:3.5, scale:2.2 });
      game.fxLog(`🌵 ${d.name} casts Spike Growth!`, 'crit');

      const zone = game.spawnAoEZone(h, 'spikeGrowth', foe.x, foe.z, 3.5, {
        color: this.color, dur: 45,
        loopSheet: { sheetKey: 'burst_splatter_003_large_green', opacity: 0.25, y: 0.1 }
      });
      const foes = clusterAround(game, foe, 3.5);
      for (const m of foes) {
        if (m.dead) continue;
        const dmg = roll(2, 4, d.dmgBonus);
        game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
      }
      game.concentrate(h, 'spikeGrowth', [], zone);
      return true;
    }
  },

  passWithoutTrace: {
    label:'Pass Without Trace', level:2, concentration:true, targetType:'party',
    desc:'Shadows cloak the party: +10 bonus to Stealth and movement concealment.',
    recharge:'slot',
    ai:{ when:'any', priority:6 },
    color:0x4a5568,
    cast(game, h) {
      game.markSpellUsed(h, this);
      for (const ally of (game.heroes || [])) {
        if (ally.data && ally.data.hp > 0) {
          applyEffect(ally, 'stealthed', { duration: 60, elapsed: game.fxNow, source: h });
        }
      }
      game.playAbilityFx(h, 'shadowStep', { at:h, spell:true, scale:2.0 });
      game.fxLog(`👣 ${h.data.name} casts Pass Without Trace! Party is shrouded in stealth.`, 'buff');
      game.concentrate(h, 'passWithoutTrace', []);
      return true;
    }
  },

  crusadersMantle: {
    label:"Crusader's Mantle", level:3, concentration:true, targetType:'party',
    desc:'Holy power radiates 30 ft: weapon attacks of nearby allies deal +1d4 extra radiant damage.',
    recharge:'slot',
    ai:{ when:'any', priority:7 },
    color:0xffd700,
    cast(game, h) {
      game.markSpellUsed(h, this);
      for (const ally of (game.heroes || [])) {
        if (ally.data && ally.data.hp > 0) {
          applyEffect(ally, 'blessed', { duration: 30, elapsed: game.fxNow, source: h });
        }
      }
      game.playAbilityFx(h, 'divineSmite', { at:h, spell:true, scale:2.5 });
      game.fxLog(`⚔️ ${h.data.name} radiates Crusader's Mantle! Allies gain radiant strikes.`, 'buff');
      game.concentrate(h, 'crusadersMantle', []);
      return true;
    }
  },

  banishment: {
    label:'Banishment', level:4, concentration:true,
    desc:'Banish a creature to an extradimensional pocket (CHA save negates) for 10 seconds.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:9 },
    color:0x9b59b6,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'dimensionDoor', { at:foe, spell:true, scale:2.2 });

      if (game.spellSave(foe, 'cha', dc, { magic:true })) {
        game.fxLog(`🌀 ${foe.data.name} resists Banishment!`, 'miss');
      } else {
        applyEffect(foe, 'stunned', { duration: 10, elapsed: game.fxNow, source: h });
        applyEffect(foe, 'blinded', { duration: 10, elapsed: game.fxNow, source: h });
        game.fxLog(`🌀 ${d.name} banishes ${foe.data.name} from the battlefield!`, 'crit');
        game.concentrate(h, 'banishment', [{ e:foe, key:'stunned' }]);
      }
      return true;
    }
  },

  steelWindStrike: {
    label:'Steel Wind Strike', level:5,
    desc:'Flourish weapon and teleport strike up to 5 distinct foes for 6d10 force damage each.',
    recharge:'slot',
    ai:{ when:'cluster', priority:9, minTargets:2 },
    dmgType:'force',
    color:0x00f5d4,
    cast(game, h, foe) {
      const d = h.data;
      const activeMonsters = (game.monsters || []).filter(m => m.data && m.data.hp > 0 && m.active !== false);
      if (!activeMonsters.length) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'shadowStep', { at:h, spell:true, scale:2.0 });
      game.fxLog(`🌪️ ${d.name} executes Steel Wind Strike across 5 foes!`, 'crit');

      const targets = activeMonsters.slice(0, 5);
      targets.forEach((tgt, idx) => {
        const delayMs = idx * 120;
        later(game, delayMs, () => {
          if (tgt.dead) return;
          const dmg = roll(6, 10, d.dmgBonus);
          game.spellDamage(tgt, dmg, h, false, { dmgType: this.dmgType, magical: true });
        }, delayMs);
      });
      return true;
    }
  },

  /* ============ 6TH LEVEL SPELLS ============ */

  disintegrate: {
    label:'Disintegrate', level:6,
    desc:'Thin green ray of total destruction: 10d6+40 force damage (DEX save for 0). Slain foes turn to dust.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:10, targetType:'execute' },
    dmgType:'force',
    color:0x39ff14,
    cast(game, h, foe) {
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.fxLog(`🟢 ${d.name} fires a deadly Disintegrate beam at ${foe.data.name}!`, 'crit');

      const from = game._v3(h.x, 0.6, h.z);
      const to = game._v3(foe.x, 0.5 * (foe.data?.scale || 1.0) + 0.3, foe.z);
      game.fxBeam(from, to, {
        type: 'laser',
        color: this.color,
        coreColor: 0xffffff,
        width: 0.45,
        duration: 0.5,
        onHit: () => {
          if (foe.dead) return;
          if (game.spellSave(foe, 'dex', dc, { magic: true })) {
            game.fxLog(`💨 ${foe.data.name} dodges the Disintegrate beam! (0 dmg)`, 'miss');
          } else {
            const dmg = roll(10, 6, 40 + (d.dmgBonus || 0));
            if (game.triggerHitStop) game.triggerHitStop(6);
            if (game.triggerShake) game.triggerShake(0.8, 0.35);
            if (game.fxFlashLight) game.fxFlashLight(to, 0x44ff66, 6.0, 14.0, 0.35);
            game.spellDamage(foe, dmg, h, false, { dmgType: this.dmgType, magical: true });
            game.fxSprite('dcss/effect/cloud_poison_0.png', to, 1.4, 0.35);
            if (foe.dead || foe.data.hp <= 0) {
              game.fxLog(`💀 ${foe.data.name} is disintegrated into a pile of gray dust!`, 'crit');
            }
          }
        }
      });
      return true;
    }
  },

  chainLightning: {
    label:'Chain Lightning', level:6,
    desc:'10d8 lightning to primary target, arcing to up to 3 additional foes within 30 ft (DEX save half).',
    recharge:'slot',
    ai:{ when:'cluster', priority:10, minTargets:2 },
    dmgType:'lightning',
    color:0x00d4ff,
    cast(game, h, foe) {
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.fxLog(`⚡ ${d.name} casts Chain Lightning!`, 'crit');

      const allActive = (game.monsters || []).filter(m => m.data && m.data.hp > 0 && m.active !== false);
      const targets = [foe];
      const otherMonsters = allActive.filter(m => m !== foe).sort((a, b) => Math.hypot(a.x - foe.x, a.z - foe.z) - Math.hypot(b.x - foe.x, b.z - foe.z));
      for (let i = 0; i < Math.min(3, otherMonsters.length); i++) targets.push(otherMonsters[i]);

      targets.forEach((tgt, idx) => {
        const delayMs = idx * 100;
        later(game, delayMs, () => {
          if (tgt.dead) return;
          const originPos = idx === 0 ? game._v3(h.x, 0.6, h.z) : game._v3(targets[idx - 1].x, 0.5, targets[idx - 1].z);
          const targetPos = game._v3(tgt.x, 0.5 * (tgt.data?.scale || 1.0) + 0.3, tgt.z);
          game.fxBeam(originPos, targetPos, {
            type: 'lightning',
            color: this.color,
            coreColor: 0xffffff,
            width: 0.35,
            duration: 0.35,
            onHit: () => {
              let dmg = roll(10, 8, d.dmgBonus);
              if (game.spellSave(tgt, 'dex', dc, { magic: true })) dmg = Math.floor(dmg / 2);
              game.spellDamage(tgt, dmg, h, false, { dmgType: this.dmgType, magical: true });
              game.fxSprite('dcss/effect/kny_spark_3.png', targetPos, 1.2, 0.25);
            }
          });
        }, delayMs);
      });
      return true;
    }
  },

  heal: {
    label:'Heal', level:6,
    desc:'Surge of positive energy restores 70 HP to an ally and cleanses blindness, deafness, and poison.',
    recharge:'slot',
    ai:{ when:'anyHurt', priority:10, hpFrac:0.4 },
    color:0x38ef7d,
    cast(game, h) {
      const injured = (game.heroes || []).filter(a => a.data && a.data.hp > 0).sort((a, b) => (a.data.hp / a.data.maxHp) - (b.data.hp / b.data.maxHp));
      const target = injured[0] || h;
      game.markSpellUsed(h, this);
      const healAmt = 70;
      target.data.hp = Math.min(target.data.maxHp, target.data.hp + healAmt);
      clearEffect(target, 'poisoned');
      clearEffect(target, 'blinded');
      game.playAbilityFx(h, 'heal', { at: target, spell: true, scale: 2.4 });
      game.fxText(target, `+${healAmt} HP`, '#38ef7d');
      game.fxLog(`💖 ${h.data.name} casts Heal on ${target.data.name}! (+70 HP, cleansed)`, 'heal');
      return true;
    }
  },

  sunbeam: {
    label:'Sunbeam', level:6, concentration:true,
    desc:'60-ft line of brilliant sunlight: 6d8 radiant damage and blinds creatures in the line (CON save for half and no blind; undead/oozes have disadvantage).',
    recharge:'slot',
    ai:{ when:'cluster', priority:9, minTargets:2, aoeRadius:6.0 },
    dmgType:'radiant',
    color:0xfffa65,
    cast(game, h, foe) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);

      const dx = foe.x - h.x;
      const dz = foe.z - h.z;
      const dist = Math.hypot(dx, dz) || 1.0;
      const dirX = dx / dist;
      const dirZ = dz / dist;

      const lineLength = 12.0; // 60 ft line
      const lineWidth = 1.0;
      const startX = h.x;
      const startZ = h.z;
      const endX = h.x + dirX * lineLength;
      const endZ = h.z + dirZ * lineLength;

      game.fxLog(`☀️ ${d.name} channels a 60-ft searing Sunbeam!`, 'crit');

      const from = game._v3(h.x, 0.6, h.z);
      const to = game._v3(endX, 0.6, endZ);
      game.fxBeam(from, to, {
        type: 'laser',
        color: this.color,
        coreColor: 0xffffff,
        width: 0.65,
        duration: 0.65,
        casterBurst: 'round_light_burst_001_large_yellow',
        targetBurst: 'round_light_burst_002_large_yellow'
      });

      const list = game.monsters || [];
      for (const m of list) {
        if (!m || m.dead || m.data?.hp <= 0 || m.active === false) continue;
        if (isPointInLineSegment(m.x, m.z, startX, startZ, endX, endZ, lineWidth * 0.5 + 0.35)) {
          const isUndeadOrOoze = m.data?.raceKey === 'undead' || m.data?.type === 'undead' || m.data?.type === 'ooze' || m.data?.tag === 'undead';
          let dmg = roll(6, 8, d.dmgBonus);
          const savePassed = game.spellSave(m, 'con', dc, { magic: true, disadvantage: isUndeadOrOoze });
          if (savePassed) {
            dmg = Math.floor(dmg / 2);
          } else {
            applyEffect(m, 'blinded', { duration: 6, elapsed: game.fxNow, source: h });
          }
          game.spellDamage(m, dmg, h, false, { dmgType: this.dmgType, magical: true });
        }
      }
      game.concentrate(h, 'sunbeam', []);
      return true;
    }
  },

  harm: {
    label:'Harm', level:6,
    desc:'Unleash virulent necrotic pestilence: 14d6 necrotic damage (CON save half) and reduces maximum HP.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:9 },
    dmgType:'necrotic',
    color:0x4a0e4e,
    cast(game, h, foe) {
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'inflictWounds', { at: foe, spell: true, scale: 2.2 });
      game.fxLog(`☣️ ${d.name} casts Harm on ${foe.data.name}!`, 'crit');

      let dmg = roll(14, 6, d.dmgBonus);
      if (game.spellSave(foe, 'con', dc, { magic: true })) dmg = Math.floor(dmg / 2);
      game.spellDamage(foe, dmg, h, false, { dmgType: this.dmgType, magical: true });
      return true;
    }
  },

  /* ============ 7TH LEVEL SPELLS ============ */

  fingerOfDeath: {
    label:'Finger of Death', level:7,
    desc:'7d8+30 necrotic damage (CON save half). Humanoids killed rise as loyal zombie minions.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:10, targetType:'execute' },
    dmgType:'necrotic',
    color:0x111111,
    cast(game, h, foe) {
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'inflictWounds', { at: foe, spell: true, scale: 2.5 });
      game.fxLog(`💀 ${d.name} points the Finger of Death at ${foe.data.name}!`, 'crit');

      let dmg = roll(7, 8, 30 + (d.dmgBonus || 0));
      if (game.spellSave(foe, 'con', dc, { magic: true })) dmg = Math.floor(dmg / 2);
      game.spellDamage(foe, dmg, h, false, { dmgType: this.dmgType, magical: true });

      if ((foe.dead || foe.data.hp <= 0) && game.summons) {
        game.summons.spawn(h, 'impFamiliar');
        game.fxLog(`🧟 ${foe.data.name} rises from death as an undead thrall!`, 'buff');
      }
      return true;
    }
  },

  fireStorm: {
    label:'Fire Storm', level:7,
    desc:'Sheets of roaring flame cover a 30-ft radius: 7d10 fire damage (DEX save half).',
    recharge:'slot',
    ai:{ when:'cluster', priority:10, minTargets:3, aoeRadius:4.5 },
    dmgType:'fire',
    color:0xff3d00,
    cast(game, h, foe) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'fireball', { at: foe, spell: true, scale: 3.5 });
      game.fxLog(`🌋 ${d.name} unleashes a colossal Fire Storm!`, 'crit');

      const foes = clusterAround(game, foe, 4.5);
      for (const m of foes) {
        if (m.dead) continue;
        let dmg = roll(7, 10, d.dmgBonus);
        if (game.spellSave(m, 'dex', dc, { magic: true })) dmg = Math.floor(dmg / 2);
        game.spellDamage(m, dmg, h, false, { dmgType: this.dmgType, magical: true });
        game.fxSprite('dcss/effect/cloud_fire_1.png', { x: m.x, y: 0.4, z: m.z }, 1.3, 0.35);
      }
      return true;
    }
  },

  regenerate: {
    label:'Regenerate', level:7,
    desc:'Touch restores 4d8+15 HP immediately and regenerates 1 HP every second for the rest of the floor.',
    recharge:'slot',
    ai:{ when:'anyHurt', priority:9, hpFrac:0.5 },
    color:0x10b981,
    cast(game, h) {
      const injured = (game.heroes || []).filter(a => a.data && a.data.hp > 0).sort((a, b) => (a.data.hp / a.data.maxHp) - (b.data.hp / b.data.maxHp));
      const target = injured[0] || h;
      game.markSpellUsed(h, this);
      const burst = roll(4, 8, 15);
      target.data.hp = Math.min(target.data.maxHp, target.data.hp + burst);
      applyEffect(target, 'blessed', { duration: 180, elapsed: game.fxNow, source: h });
      game.playAbilityFx(h, 'cureWounds', { at: target, spell: true, scale: 2.5 });
      game.fxText(target, `+${burst} HP (Regen)`, '#10b981');
      game.fxLog(`🌿 ${h.data.name} casts Regenerate on ${target.data.name}! (+${burst} HP, rapid regen)`, 'heal');
      return true;
    }
  },

  prismaticSpray: {
    label:'Prismatic Spray', level:7,
    desc:'Eight multi-colored rays burst outward: 10d6 elemental/status damage (DEX save half).',
    recharge:'slot',
    ai:{ when:'cluster', priority:10, minTargets:2, aoeRadius:4.0 },
    dmgType:'radiant',
    color:0xf43f5e,
    cast(game, h, foe) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'chaosBolt', { at: foe, spell: true, scale: 3.0 });
      game.fxLog(`🌈 ${d.name} casts Prismatic Spray!`, 'crit');

      const foes = clusterAround(game, foe, 4.0);
      const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899'];
      for (const m of foes) {
        if (m.dead) continue;
        const c = colors[Math.floor(Math.random() * colors.length)];
        let dmg = roll(10, 6, d.dmgBonus);
        if (game.spellSave(m, 'dex', dc, { magic: true })) dmg = Math.floor(dmg / 2);
        game.spellDamage(m, dmg, h, false, { dmgType: this.dmgType, magical: true });
      }
      return true;
    }
  },

  /* ============ 8TH LEVEL SPELLS ============ */

  sunburst: {
    label:'Sunburst', level:8,
    desc:'Brilliant sunlight in a 60-ft radius: 12d6 radiant damage and blinds monsters for 1 minute (CON save half/no blind).',
    recharge:'slot',
    ai:{ when:'cluster', priority:10, minTargets:2, aoeRadius:5.0 },
    dmgType:'radiant',
    color:0xffea00,
    cast(game, h, foe) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'sunbeam', { at: foe, spell: true, scale: 4.0 });
      game.fxLog(`💥 ${d.name} detonates a blinding Sunburst!`, 'crit');

      const foes = clusterAround(game, foe, 5.0);
      for (const m of foes) {
        if (m.dead) continue;
        let dmg = roll(12, 6, d.dmgBonus);
        if (game.spellSave(m, 'con', dc, { magic: true })) {
          dmg = Math.floor(dmg / 2);
        } else {
          applyEffect(m, 'blinded', { duration: 15, elapsed: game.fxNow, source: h });
        }
        game.spellDamage(m, dmg, h, false, { dmgType: this.dmgType, magical: true });
      }
      return true;
    }
  },

  earthquake: {
    label:'Earthquake', level:8,
    desc:'Violent seismic tremor across a 100-ft radius: 10d6 bludgeoning damage and knocks creatures prone/stunned.',
    recharge:'slot',
    ai:{ when:'cluster', priority:10, minTargets:3, aoeRadius:5.0 },
    dmgType:'bludgeoning',
    color:0x8b5a2b,
    cast(game, h, foe) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'shatter', { at: foe, spell: true, scale: 4.0 });
      game.fxLog(`⛰️ ${d.name} tears open the ground with an Earthquake!`, 'crit');

      const foes = clusterAround(game, foe, 5.0);
      for (const m of foes) {
        if (m.dead) continue;
        let dmg = roll(10, 6, d.dmgBonus);
        if (game.spellSave(m, 'dex', dc, { magic: true })) {
          dmg = Math.floor(dmg / 2);
        } else {
          applyEffect(m, 'slowed', { duration: 8, elapsed: game.fxNow, source: h });
        }
        game.spellDamage(m, dmg, h, false, { dmgType: this.dmgType, magical: true });
      }
      return true;
    }
  },

  mindBlank: {
    label:'Mind Blank', level:8, targetType:'party',
    desc:'Total mental ward: target is immune to psychic damage, charm, fear, and magical influence for 24 hours.',
    recharge:'slot',
    ai:{ when:'any', priority:8 },
    color:0x06b6d4,
    cast(game, h) {
      game.markSpellUsed(h, this);
      for (const ally of (game.heroes || [])) {
        if (ally.data && ally.data.hp > 0) {
          applyEffect(ally, 'inspired', { duration: 300, elapsed: game.fxNow, source: h });
          clearEffect(ally, 'frightened');
        }
      }
      game.playAbilityFx(h, 'shield', { at: h, spell: true, scale: 2.5 });
      game.fxLog(`🧠 ${h.data.name} casts Mind Blank! Party is shielded from mental harm.`, 'buff');
      return true;
    }
  },

  dominateMonster: {
    label:'Dominate Monster', level:8, concentration:true,
    desc:'Bends any beast or monster to your will (WIS save negates): forces it to turn on other monsters.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:10 },
    color:0xa855f7,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'hex', { at: foe, spell: true, scale: 2.5 });

      if (game.spellSave(foe, 'wis', dc, { magic: true })) {
        game.fxLog(`👁️ ${foe.data.name} resists Dominate Monster!`, 'miss');
      } else {
        applyEffect(foe, 'confused', { duration: 20, elapsed: game.fxNow, source: h });
        game.fxLog(`👁️ ${d.name} dominates ${foe.data.name}! It turns on its allies.`, 'crit');
        game.concentrate(h, 'dominateMonster', [{ e: foe, key: 'confused' }]);
      }
      return true;
    }
  },

  /* ============ 9TH LEVEL SPELLS ============ */

  meteorSwarm: {
    label:'Meteor Swarm', level:9,
    desc:'Call 4 flaming orbs from the sky: 20d6 fire + 20d6 bludgeoning damage across 40-ft radius (DEX save half).',
    recharge:'slot',
    ai:{ when:'cluster', priority:10, minTargets:2, aoeRadius:6.0 },
    dmgType:'fire',
    color:0xff1744,
    cast(game, h, foe) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'fireball', { at: foe, spell: true, scale: 4.5 });
      game.fxLog(`☄️ ${d.name} summons an apocalyptic METEOR SWARM!`, 'crit');

      const foes = clusterAround(game, foe, 6.0);
      if (game.triggerShake) game.triggerShake(1.2, 0.7);
      if (game.triggerHitStop) game.triggerHitStop(5);
      if (game.fxFlashLight) game.fxFlashLight({ x: foe.x, y: 0.5, z: foe.z }, 0xff3311, 7.5, 20.0, 0.5);

      for (let i = 0; i < 4; i++) {
        const delayMs = i * 150;
        later(game, delayMs, () => {
          if (game.triggerShake) game.triggerShake(0.6, 0.25);
          for (const m of foes) {
            if (m.dead) continue;
            let dmg = roll(5, 6, 0) + roll(5, 6, Math.floor((d.dmgBonus || 0) / 4));
            if (game.spellSave(m, 'dex', dc, { magic: true })) dmg = Math.floor(dmg / 2);
            game.spellDamage(m, dmg, h, false, { dmgType: this.dmgType, magical: true });
            game.fxSprite('dcss/effect/cloud_fire_2.png', { x: m.x + (Math.random() - 0.5) * 1.5, y: 0.4, z: m.z + (Math.random() - 0.5) * 1.5 }, 1.6, 0.4);
          }
        }, delayMs);
      }
      return true;
    }
  },

  timeStop: {
    label:'Time Stop', level:9,
    desc:'Freeze the flow of time for all enemies for 3 turns, allowing free actions and repositioning.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:10 },
    color:0x38bdf8,
    cast(game, h) {
      game.markSpellUsed(h, this);
      for (const m of (game.monsters || [])) {
        if (m.data && m.data.hp > 0) {
          applyEffect(m, 'stunned', { duration: 6, elapsed: game.fxNow, source: h });
        }
      }
      applyEffect(h, 'hasted', { duration: 6, elapsed: game.fxNow, source: h });
      game.playAbilityFx(h, 'slow', { at: h, spell: true, scale: 3.5 });
      game.fxLog(`⏳ ${h.data.name} stops the flow of TIME! (+Haste, enemies frozen)`, 'crit');
      return true;
    }
  },

  powerWordKill: {
    label:'Power Word Kill', level:9,
    desc:'Utter a word of cosmic mortality: any creature with 100 HP or fewer dies instantly (no saving throw).',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:10, targetType:'execute' },
    dmgType:'necrotic',
    color:0x000000,
    cast(game, h, foe) {
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'inflictWounds', { at: foe, spell: true, scale: 3.0 });

      if (foe.data.hp <= 100) {
        game.fxLog(`☠️ ${d.name} speaks the POWER WORD: KILL! ${foe.data.name} perishes instantly.`, 'crit');
        game.spellDamage(foe, foe.data.hp + 999, h, false, { dmgType: this.dmgType, magical: true });
      } else {
        game.fxLog(`☠️ ${d.name} speaks Power Word Kill, but ${foe.data.name} has over 100 HP!`, 'miss');
      }
      return true;
    }
  },

  massHeal: {
    label:'Mass Heal', level:9,
    desc:'A flood of supreme curative power restores up to 700 combined HP across the entire party.',
    recharge:'slot',
    ai:{ when:'anyHurt', priority:10, hpFrac:0.5 },
    color:0x10b981,
    cast(game, h) {
      game.markSpellUsed(h, this);
      const livingAllies = (game.heroes || []).filter(a => a.data && a.data.hp > 0);
      const healPerHero = Math.floor(700 / Math.max(1, livingAllies.length));
      for (const a of livingAllies) {
        a.data.hp = Math.min(a.data.maxHp, a.data.hp + healPerHero);
        clearEffect(a, 'poisoned');
        clearEffect(a, 'blinded');
        clearEffect(a, 'frightened');
        game.playAbilityFx(h, 'cureWounds', { at: a, spell: true, scale: 2.5 });
        game.fxText(a, `+${healPerHero} HP`, '#10b981');
      }
      game.fxLog(`🌟 ${h.data.name} casts MASS HEAL! (+${healPerHero} HP to all party members, all cured)`, 'heal');
      return true;
    }
  },

  wish: {
    label:'Wish', level:9,
    desc:'The mightiest spell: alter reality itself to fully rejuvenate the party and smite all enemies.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:10 },
    color:0xf59e0b,
    cast(game, h) {
      const d = h.data;
      game.markSpellUsed(h, this);
      for (const a of (game.heroes || [])) {
        if (a.data && a.data.hp > 0) {
          a.data.hp = a.data.maxHp;
          applyEffect(a, 'blessed', { duration: 60, elapsed: game.fxNow, source: h });
          applyEffect(a, 'inspired', { duration: 60, elapsed: game.fxNow, source: h });
          game.fxText(a, `FULL HP`, '#f59e0b');
        }
      }
      for (const m of (game.monsters || [])) {
        if (m.data && m.data.hp > 0 && m.active !== false) {
          const dmg = roll(12, 8, d.dmgBonus);
          game.spellDamage(m, dmg, h, false, { dmgType: 'force', magical: true });
        }
      }
      game.playAbilityFx(h, 'chaosBolt', { at: h, spell: true, scale: 4.5 });
      game.fxLog(`💫 ${d.name} alters reality with WISH! Full party rejuvenation and mass smite!`, 'crit');
      return true;
    }
  },

  /* ============ HIGH-TIER LIST FILLERS ============
     Added to give the thin upper tiers a real choice: the bard in particular
     drew three 9th-level picks from a pool of exactly one spell. All of these
     reuse existing FX keys and conditions — no new art, no new engine flags. */

  dominatePerson: {
    label:'Dominate Person', level:5, concentration:true,
    desc:'Bend a humanoid mind to your will (WIS save). It cannot bring itself to harm you.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:8 },
    color:0xe8a8ff,
    cast(game, h, foe) {
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'holdPerson', { at: foe, spell: true, scale: 2.0 });

      const dc = spellDC(h);
      if (game.spellSave(foe, 'wis', dc, { magic:true })) {
        game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`\u{1F300} ${foe.data.name} shrugs off the domination!`, 'miss', { cat: 'effect' });
        return true;
      }
      /* SRD lets the target re-save each time it takes damage; the engine's
         repeatSave timer is the closest standing equivalent. */
      applyEffect(foe, 'charmed', { duration: 60, elapsed: game.fxNow, source: h,
        repeatSave:{ ability:'wis', dc, every:6 } });
      applyEffect(foe, 'slowed', { duration: 60, elapsed: game.fxNow, source: h,
        repeatSave:{ ability:'wis', dc, every:6 } });
      game.concentrate(h, 'dominatePerson', [{ e:foe, key:'charmed' }, { e:foe, key:'slowed' }]);
      game.fxLog(`\u{1F300} ${d.name} DOMINATES ${foe.data.name}!`, 'crit', { cat: 'effect' });
      return true;
    }
  },

  forcecage: {
    label:'Forcecage', level:7,
    desc:'An immovable cage of invisible force traps the target — no save, no escape.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:9 },
    color:0xbfa060,
    cast(game, h, foe) {
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'web', { at: foe, spell: true, scale: 2.4 });
      /* SRD Forcecage allows no saving throw — that is the point of it. */
      applyEffect(foe, 'restrained', { duration: ROUND_SECONDS * 3, elapsed: game.fxNow, source: h });
      game.fxLog(`\u{1F532} ${d.name} seals ${foe.data.name} inside a FORCECAGE!`, 'crit');
      return true;
    }
  },

  foresight: {
    label:'Foresight', level:9, targetType:'party',
    desc:'An ally sees moments into the future: advantage on attacks and +3 AC for the fight.',
    recharge:'slot',
    ai:{ when:'any', priority:9 },
    color:0xffd9a0,
    cast(game, h) {
      const d = h.data;
      const allies = (game.heroes || []).filter(a => a.data && a.data.hp > 0);
      if (!allies.length) return false;
      game.markSpellUsed(h, this);
      /* Favour whoever swings hardest — the front line, not the caster. */
      let best = allies[0], bestScore = -Infinity;
      for (const a of allies) {
        const score = (a.data.dmgBonus || 0) + (a.data.level || 1) + (a.data.weaponProfile ? 3 : 0);
        if (score > bestScore) { bestScore = score; best = a; }
      }
      applyEffect(best, 'foresight', { duration: 60, elapsed: game.fxNow, source: h });
      game.playAbilityFx(h, 'bless', { at: best, spell: true, scale: 2.2 });
      game.fxLog(`\u{1F441} ${d.name} grants ${best.data.name} FORESIGHT!`, 'crit');
      return true;
    }
  },

  powerWordHeal: {
    label:'Power Word Heal', level:9,
    desc:'A word of pure life: one ally is restored to full HP and freed of every restraint.',
    recharge:'slot',
    ai:{ when:'hurtAlly', priority:10, hpFrac:0.5 },
    color:0x6ae06a,
    cast(game, h) {
      const d = h.data;
      const allies = (game.heroes || []).filter(a => a.data);
      if (!allies.length) return false;
      /* the worst off, counting the downed — this is the word that picks them up */
      let worst = null, wf = Infinity;
      for (const a of allies) {
        const f = a.data.hp / Math.max(1, a.data.maxHp);
        if (f < wf) { wf = f; worst = a; }
      }
      if (!worst) return false;
      game.markSpellUsed(h, this);
      const wasDown = worst.data.hp <= 0;
      worst.data.hp = worst.data.maxHp;
      for (const c of ['charmed','frightened','paralyzed','stunned','poisoned','blinded','restrained','prone'])
        clearEffect(worst, c);
      if (wasDown && typeof game._reviveHeroPose === 'function') game._reviveHeroPose(worst);
      game.playAbilityFx(h, 'greaterRestoration', { at: worst, spell: true, scale: 2.6 });
      game.fxText(worst, 'FULL HP', '#6ae06a');
      game.fxLog(`\u{1F49A} ${d.name} speaks the POWER WORD: HEAL! ${worst.data.name} is made whole.`, 'heal');
      return true;
    }
  },

  stormOfVengeance: {
    label:'Storm of Vengeance', level:9,
    desc:'A towering thunderhead lashes every enemy on the field with lightning.',
    recharge:'slot',
    ai:{ when:'cluster', priority:10 },
    dmgType:'lightning',
    color:0x8fd4e8,
    cast(game, h) {
      const d = h.data;
      const foes = (game.monsters || []).filter(m => m.data && m.data.hp > 0 && m.active !== false);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'callLightning', { at: h, spell: true, scale: 3.2 });
      game.fxLog(`\u{26C8} ${d.name} calls down a STORM OF VENGEANCE!`, 'crit');
      for (const m of foes) {
        const amt = roll(6, 6, d.dmgBonus || 0);
        game.spellDamage(m, amt, h, false, { dmgType: this.dmgType, magical: true });
        applyEffect(m, 'deafened', { duration: ROUND_SECONDS * 2, elapsed: game.fxNow, source: h });
        game.playAbilityFx(h, 'callLightning', { at: m, spell: true, scale: 1.6 });
      }
      return true;
    }
  },

  trueResurrection: {
    label:'True Resurrection', level:9,
    desc:'Call a fallen companion back whole, or restore a living one completely.',
    recharge:'slot',
    ai:{ when:'hurtAlly', priority:10, hpFrac:0.4 },
    color:0xffe08a,
    cast(game, h) {
      const d = h.data;
      const allies = (game.heroes || []).filter(a => a.data);
      /* the dead first — that is what separates this from a heal */
      let target = allies.find(a => a.data.hp <= 0);
      if (!target) {
        let wf = Infinity;
        for (const a of allies) {
          const f = a.data.hp / Math.max(1, a.data.maxHp);
          if (f < wf) { wf = f; target = a; }
        }
      }
      if (!target) return false;
      const wasDead = target.data.hp <= 0;
      game.markSpellUsed(h, this);
      target.data.hp = target.data.maxHp;
      for (const c of ['charmed','frightened','paralyzed','stunned','poisoned','blinded','restrained','prone','wounded','drained'])
        clearEffect(target, c);
      if (wasDead && typeof game._reviveHeroPose === 'function') game._reviveHeroPose(target);
      game.playAbilityFx(h, 'greaterRestoration', { at: target, spell: true, scale: 3.0 });
      game.fxText(target, wasDead ? 'RESURRECTED' : 'RESTORED', '#ffe08a');
      game.fxLog(`\u{2728} ${d.name} casts TRUE RESURRECTION on ${target.data.name}!`, 'heal');
      return true;
    }
  },
};

/* Stamp each spell with its own registry key so code holding a spell object
   (recharge pools, tooltips) can name it without threading the key through. */
for (const k of Object.keys(SPELLS)) SPELLS[k].key = k;

/* ================================================================
   Spell pools — what spells each class can learn at each spell tier
   ================================================================ */
export const SPELL_POOLS = {
  wizard: {
    1: ['magicMissile','shield','grease','thunderwave','chromaticOrb','rayOfSickness','findFamiliar','sleep'],
    2: ['scorchingRay','magicMissile','shield','blindness','hideousLaughter','sleep','mistyStep','acidArrow','magicWeapon','flamingSphere','mirrorImage','enlargeReduce','web','holdPerson'],
    3: ['fireball','haste','scorchingRay','slow','fear','lightningBolt','bestowCurse','vampiricTouch','counterspell','hypnoticPattern'],
    4: ['iceStorm','blight','wallOfFire','polymorph','dimensionDoor','banishment'],
    5: ['coneOfCold','holdMonster','cloudkill','animateObjects','steelWindStrike','dominatePerson'],
    6: ['disintegrate','chainLightning','sunbeam'],
    7: ['fingerOfDeath','prismaticSpray','forcecage'],
    8: ['sunburst','mindBlank','dominateMonster'],
    9: ['meteorSwarm','timeStop','powerWordKill','wish','foresight'],
  },
  cleric: {
    1: ['bless','healingWord','cureWounds','shieldOfFaith','bane','protectionFromEvil','inflictWounds','guidingBolt'],
    2: ['spiritualWeapon','bless','shieldOfFaith','blindness','lesserRestoration','holdPerson','silence','magicWeapon'],
    3: ['spiritGuardians','spiritualWeapon','slow','fear','massHealingWord','bestowCurse'],
    4: ['deathWard','iceStorm','banishment'],
    5: ['flameStrike','massCureWounds','holdMonster','greaterRestoration'],
    6: ['heal','harm','sunbeam'],
    7: ['fireStorm','regenerate'],
    8: ['sunburst','earthquake'],
    9: ['massHeal','trueResurrection'],
  },
  druid: {
    1: ['entangle','healingWord','cureWounds','faerieFire','sleep','grease','thunderwave'],
    2: ['moonbeam','entangle','web','lesserRestoration','holdPerson','acidArrow','barkskin','flamingSphere','spikeGrowth','passWithoutTrace'],
    3: ['callLightning','moonbeam','slow','massHealingWord','lightningBolt'],
    4: ['iceStorm','blight','wallOfFire','polymorph'],
    5: ['massCureWounds','coneOfCold','holdMonster','greaterRestoration'],
    6: ['heal','sunbeam'],
    7: ['fireStorm','regenerate'],
    8: ['sunburst','earthquake'],
    9: ['massHeal','trueResurrection','stormOfVengeance','foresight'],
  },
  bard: {
    1: ['healingWord','cureWounds','bless','bane','hideousLaughter','faerieFire','sleep','thunderwave'],
    2: ['shatter','healingWord','blindness','lesserRestoration','holdPerson','silence','mirrorImage'],
    3: ['shatter','haste','slow','fear','massHealingWord','hypnoticPattern','bestowCurse'],
    4: ['dimensionDoor','polymorph','banishment','fear'],
    5: ['massCureWounds','animateObjects','holdMonster','dominatePerson','greaterRestoration'],
    6: ['heal','disintegrate','holdMonster','massCureWounds'],
    7: ['regenerate','prismaticSpray','forcecage','heal','disintegrate'],
    8: ['mindBlank','dominateMonster','regenerate','prismaticSpray'],
    9: ['powerWordKill','foresight','powerWordHeal','regenerate','dominateMonster'],
  },
  sorcerer: {
    1: ['chaosBolt','dragonBreathSpell','shield','sleep','grease','thunderwave','chromaticOrb','rayOfSickness'],
    2: ['scorchingRay','chaosBolt','blindness','web','holdPerson','rayOfEnfeeblement','mistyStep','flamingSphere','mirrorImage','enlargeReduce'],
    3: ['fireball','haste','slow','fear','lightningBolt','counterspell','hypnoticPattern'],
    4: ['blight','wallOfFire','iceStorm','polymorph','banishment','dimensionDoor'],
    5: ['coneOfCold','holdMonster','cloudkill','animateObjects','dominatePerson'],
    6: ['disintegrate','chainLightning','sunbeam'],
    7: ['fingerOfDeath','fireStorm','prismaticSpray'],
    8: ['sunburst','earthquake','dominateMonster'],
    9: ['meteorSwarm','timeStop','powerWordKill','wish'],
  },
  warlock: {
    1: ['hex','armsOfHadar','magicMissile','bane','faerieFire','inflictWounds','rayOfSickness','findFamiliar'],
    2: ['hex','scorchingRay','blindness','holdPerson','rayOfEnfeeblement','mistyStep','magicWeapon','mirrorImage'],
    3: ['armsOfHadar','hex','fear','vampiricTouch','bestowCurse','counterspell','hypnoticPattern'],
    4: ['blight','dimensionDoor','banishment'],
    5: ['holdMonster','blight','dimensionDoor','banishment','counterspell','hypnoticPattern','bestowCurse'],
    6: ['disintegrate','harm'],
    7: ['fingerOfDeath'],
    8: ['dominateMonster','mindBlank'],
    9: ['powerWordKill'],
  },
  paladin: {
    1: ['thunderousSmite','bless','shieldOfFaith','protectionFromEvil','cureWounds','guidingBolt'],
    2: ['thunderousSmite','bless','shieldOfFaith','lesserRestoration','magicWeapon','barkskin','holdPerson','silence'],
    3: ['spiritGuardians','spiritualWeapon','slow','fear','massHealingWord','bestowCurse','haste','crusadersMantle'],
    4: ['deathWard','iceStorm','banishment'],
    5: ['flameStrike','massCureWounds','holdMonster','greaterRestoration'],
  },
  ranger: {
    1: ['huntersMark','entangle','faerieFire','cureWounds','sleep','grease'],
    2: ['huntersMark','healingWord','lesserRestoration','barkskin','magicWeapon','silence','holdPerson','web','mistyStep','acidArrow','spikeGrowth','passWithoutTrace'],
    3: ['callLightning','moonbeam','slow','haste','lightningBolt','massHealingWord'],
    4: ['iceStorm','blight','polymorph'],
    5: ['massCureWounds','coneOfCold','holdMonster','steelWindStrike','greaterRestoration'],
  }
};
