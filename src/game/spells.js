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

import { applyEffect, clearEffect, hasEffect, getEffectMods, EFFECTS,
         rollSave as _rollSave } from './conditions.js';

/* ── tiny dice helpers (avoid srd.js import → circular deps) ── */
function roll(count, sides, bonus = 0) {
  let t = bonus;
  for (let i = 0; i < count; i++) t += Math.floor(Math.random() * sides) + 1;
  return t;
}
function die(sides) { return Math.floor(Math.random() * sides) + 1; }
function mod(score) { return Math.floor((score - 10) / 2); }

/* ── helpers ── */
function castAbility(h) {
  const d = h.data;
  const clsAtk = d._classAtk || 'int';   // set by recalc() from the class's attack ability
  return d.effStats?.[clsAtk] ?? 10;
}
/* 5e spell save DC: 8 + proficiency bonus + casting-ability modifier */
function spellDC(h) {
  const lvl = h.data.level || 1;
  return 8 + (2 + Math.floor((lvl - 1) / 4)) + mod(castAbility(h));
}

function clusterAround(game, foe, r) {
  return game.monsters.filter(m =>
    m.data.hp > 0 && m.active && Math.hypot(m.x - foe.x, m.z - foe.z) < r
  );
}

/* ================================================================
   THE SPELL REGISTRY
   ================================================================ */
export const SPELLS = {

  /* ============ EXISTING SPELLS ============ */

  magicMissile: {
    label:'Magic Missile', level:1,
    desc:'3 unerring darts of force (1d4+1 each). Great vs elites.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:6 },
    color:0xb08cff,
    cast(game, h, foe) {
      const d = h.data, from = game._v3(h.x, 0.55, h.z);
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'magicMissile', { at:h, spell:true });
      game.fxLog(`✴ ${d.name} casts Magic Missile (${3 + Math.floor(d.level/4)} darts)!`, 'crit');
      const darts = 3 + Math.floor(d.level / 4);
      for (let i = 0; i < darts; i++) {
        const t = game._v3(
          foe.x + (Math.random()-0.5)*0.5, 0.4*foe.data.scale+0.4, foe.z + (Math.random()-0.5)*0.5);
        game.fxProjectile(from, t, 'bolt', this.color, () => {
          if (foe.dead) return;
          game.damageMonster(foe, roll(1,4,1)+d.dmgBonus, h, false);
          game.fxSprite('dcss/effect/magic_bolt_1.png', t, 0.9, 0.25);
        });
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
      applyEffect(h, 'shielded', { duration:6, elapsed:game.elapsed, source:h });
      game.playAbilityFx(h, 'shield', { at:h, spell:true });
      game.fxLog(`🛡 ${h.data.name} casts Shield! (+5 AC)`, 'heal');
      return true;
    }
  },

  scorchingRay: {
    label:'Scorching Ray', level:2,
    desc:'Three rays of fire; solid single-target burst.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7 },
    color:0xff7a30,
    cast(game, h, foe) {
      const d = h.data, from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5*foe.data.scale+0.4, foe.z);
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'scorchingRay', { at:h, spell:true });
      game.fxLog(`🔥 ${d.name} casts Scorching Ray!`, 'crit');
      for (let i = 0; i < 3; i++) {
        game.fxProjectile(from, to, 'bolt', this.color, () => {
          if (foe.dead) return;
          game.damageMonster(foe, roll(2,6,d.dmgBonus), h, false);
          game.fxSprite('dcss/effect/searing_ray_3.png', to, 1.1, 0.28);
        });
      }
      return true;
    }
  },

  fireball: {
    label:'Fireball', level:3,
    desc:'8d6 blast when foes cluster together.',
    recharge:'slot',
    ai:{ when:'cluster', priority:9, minTargets:3 },
    color:0xff7a30,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.2);
      if (foes.length < 2) return false;
      const from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5*foe.data.scale+0.4, foe.z);
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'fireball', { at:h, spell:true });
      game.fxLog(`🔥 ${d.name} casts Fireball!`, 'crit');
      game.fxProjectile(from, to, 'bolt', this.color, () => {
        game.fxSprite('dcss/effect/cloud_fire_2.png', to, 2.5, 0.5);
        game.fxSlash({ x:foe.x, z:foe.z }, this.color, 2.4);
        for (const m of foes) if (!m.dead) game.damageMonster(m, roll(8,6,d.dmgBonus), h, true);
      });
      return true;
    }
  },

  haste: {
    label:'Haste', level:3, concentration:true,
    desc:'Hasten yourself: +40% speed and +2 AC (concentration, 1 min).',
    recharge:'slot',
    ai:{ when:'selfHurt', priority:5, hpFrac:0.55 },
    color:0xa0e0ff,
    cast(game, h) {
      game.markSpellUsed(h, this);
      applyEffect(h, 'hasted', { duration:60, elapsed:game.elapsed, source:h });
      game.concentrate(h, 'haste', [{ e:h, key:'hasted' }]);
      game.playAbilityFx(h, 'haste', { at:h, spell:true });
      game.fxLog(`⚡ ${h.data.name} casts Haste!`, 'heal');
      return true;
    }
  },

  /* --- cleric --- */
  bless: {
    label:'Bless', level:1, concentration:true,
    desc:'Party-wide +1d4 to attack rolls (concentration, 1 min).',
    recharge:'slot',
    ai:{ when:'any', priority:4 },
    color:0xffe08a,
    cast(game, h, _, alive) {
      game.markSpellUsed(h, this);
      for (const a of alive) applyEffect(a, 'inspired', { duration:60, elapsed:game.elapsed, source:h });
      game.concentrate(h, 'bless', alive.map(a => ({ e:a, key:'inspired' })));
      game.playAbilityFx(h, 'bless', { at:h, alsoAt:alive, spell:true });
      game.fxLog(`✨ ${h.data.name} casts Bless! (+1d4 to hit)`, 'heal');
      return true;
    }
  },

  spiritualWeapon: {
    label:'Spiritual Weapon', level:2,
    desc:'Force weapon strikes the foe for 1d8 + WIS.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:6 },
    color:0xbfe0ff,
    cast(game, h, foe) {
      const d = h.data, amt = roll(1, 8, mod(castAbility(h)) + d.dmgBonus);
      const from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5*foe.data.scale+0.4, foe.z);
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'spiritualWeapon', { at:h, spell:true });
      game.fxLog(`⚔ ${d.name} casts Spiritual Weapon!`, 'crit');
      game.fxProjectile(from, to, 'bolt', this.color, () => {
        if (!foe.dead) { game.damageMonster(foe, amt, h, false); game.fxSprite('dcss/effect/orb_glow_0.png', to, 1.2, 0.3); }
      });
      return true;
    }
  },

  spiritGuardians: {
    label:'Spirit Guardians', level:3,
    desc:'Damaging aura: 3d8 to nearby enemies.',
    recharge:'slot',
    ai:{ when:'cluster', priority:8, minTargets:2 },
    color:0xd0c0ff,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.2);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'spiritGuardians', { at:foe, alsoAt:foes, spell:true, ring:2.0, scale:2.0 });
      game.fxLog(`✨ ${d.name} casts Spirit Guardians!`, 'crit');
      for (const m of foes) if (!m.dead) game.damageMonster(m, roll(3,8,d.dmgBonus), h, false);
      return true;
    }
  },

  /* --- druid --- */
  entangle: {
    label:'Entangle', level:1, concentration:true,
    desc:'Roots nearby foes (STR save each round to escape) and chips damage.',
    recharge:'slot',
    ai:{ when:'cluster', priority:5, minTargets:2 },
    color:0x4cae4c,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.2);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'entangle', { at:foe, alsoAt:foes, spell:true, ring:2.0, scale:2.0 });
      game.fxLog(`🌿 ${d.name} casts Entangle!`, 'crit');
      const applied = [];
      for (const m of foes) {
        if (m.dead) continue;
        game.damageMonster(m, roll(1,6,d.dmgBonus), h, false);
        if (applyEffect(m, 'slowed', { duration:60, elapsed:game.elapsed, source:h,
            repeatSave:{ ability:'str', dc, every:6 } }))
          applied.push({ e:m, key:'slowed' });
      }
      game.concentrate(h, 'entangle', applied);
      return true;
    }
  },

  moonbeam: {
    label:'Moonbeam', level:2,
    desc:'Silver fire burns a target for 2d10.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7 },
    color:0xc0e8ff,
    cast(game, h, foe) {
      const d = h.data, amt = roll(2, 10, d.dmgBonus);
      const from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5*foe.data.scale+0.4, foe.z);
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'moonbeam', { at:h, spell:true });
      game.fxLog(`✨ ${d.name} casts Moonbeam!`, 'crit');
      game.fxProjectile(from, to, 'bolt', this.color, () => {
        if (!foe.dead) { game.damageMonster(foe, amt, h, false); game.fxSprite('dcss/effect/orb_glow_1.png', to, 1.3, 0.35); }
      });
      return true;
    }
  },

  callLightning: {
    label:'Call Lightning', level:3,
    desc:'Bolt the pack: 3d10 to clustered foes.',
    recharge:'slot',
    ai:{ when:'cluster', priority:8, minTargets:2 },
    color:0x7090ff,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.2);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'callLightning', { at:foe, alsoAt:foes, spell:true, ring:2.0, scale:2.0 });
      game.fxLog(`⚡ ${d.name} calls Lightning!`, 'crit');
      for (const m of foes) if (!m.dead) game.damageMonster(m, roll(3,10,d.dmgBonus), h, false);
      return true;
    }
  },

  /* --- bard --- */
  healingWord: {
    label:'Healing Word', level:1,
    desc:'Bonus heal on a wounded ally (1d4 + CHA).',
    recharge:'slot',
    ai:{ when:'hurtAlly', priority:8, hpFrac:0.55 },
    color:0xe8a8ff,
    cast(game, h, _, alive) {
      const d = h.data;
      let worst = null, wf = 1;
      for (const a of alive) { const f = a.data.hp / a.data.maxHp; if (f < wf) { wf = f; worst = a; } }
      if (!worst || wf >= 0.55) return false;
      game.markSpellUsed(h, this);
      const amt = roll(1, 4, mod(castAbility(h)) + d.healBonus);
      game.healHero(worst, amt);
      game.playAbilityFx(h, 'healingWord', { at:worst, spell:true });
      game.fxLog(`💬 ${d.name} casts Healing Word on ${worst.data.name} (+${amt}).`, 'heal');
      return true;
    }
  },

  shatter: {
    label:'Shatter', level:2,
    desc:'Thunderous burst: 3d8 to a cluster.',
    recharge:'slot',
    ai:{ when:'cluster', priority:7, minTargets:3 },
    color:0xd0a0ff,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.2);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'shatter', { at:foe, alsoAt:foes, spell:true, ring:2.0, scale:2.0 });
      game.fxLog(`💥 ${d.name} casts Shatter!`, 'crit');
      for (const m of foes) if (!m.dead) game.damageMonster(m, roll(3,8,d.dmgBonus), h, false);
      return true;
    }
  },

  /* --- sorcerer --- */
  chaosBolt: {
    label:'Chaos Bolt', level:1,
    desc:'Unstable bolt: 2d8 + CHA, crits more often.',
    recharge:'slot',
    ai:{ when:'any', priority:5 },
    color:0xff8844,
    cast(game, h, foe) {
      const d = h.data, amt = roll(2, 8, mod(castAbility(h)) + d.dmgBonus);
      const from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5*foe.data.scale+0.4, foe.z);
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'chaosBolt', { at:h, spell:true });
      game.fxLog(`✨ ${d.name} casts Chaos Bolt!`, 'crit');
      game.fxProjectile(from, to, 'bolt', this.color, () => {
        if (!foe.dead) { game.damageMonster(foe, amt, h, Math.random()<0.15); game.fxSprite('dcss/effect/cloud_chaos_4.png', to, 1.3, 0.35); }
      });
      return true;
    }
  },

  dragonBreathSpell: {
    label:'Burning Hands', level:1,
    desc:'Cone of fire: 3d6 to nearby enemies.',
    recharge:'slot',
    ai:{ when:'cluster', priority:6, minTargets:2 },
    color:0xff6020,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.2);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'dragonBreathSpell', { at:foe, alsoAt:foes, spell:true, ring:2.0, scale:2.0 });
      game.fxLog(`🔥 ${d.name} casts Burning Hands!`, 'crit');
      for (const m of foes) if (!m.dead) game.damageMonster(m, roll(3,6,d.dmgBonus), h, false);
      return true;
    }
  },

  /* --- warlock --- */
  hex: {
    label:'Hex', level:1, concentration:true,
    desc:'Curse a foe: +1d6 damage on your hits (concentration).',
    recharge:'short',
    ai:{ when:'eliteOrBoss', priority:7 },
    color:0x9b59b6,
    cast(game, h, foe) {
      game.markSpellUsed(h, this);
      applyEffect(foe, 'hexMarked', { duration:120, elapsed:game.elapsed, source:h });
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
    ai:{ when:'cluster', priority:6, minTargets:2 },
    color:0x6a3080,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.2);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'armsOfHadar', { at:foe, alsoAt:foes, spell:true, ring:2.0, scale:2.0 });
      game.fxLog(`🕱 ${d.name} casts Arms of Hadar!`, 'crit');
      for (const m of foes) if (!m.dead) game.damageMonster(m, roll(2,6,d.dmgBonus), h, false);
      return true;
    }
  },

  /* --- paladin / ranger --- */
  thunderousSmite: {
    label:'Thunderous Smite', level:1,
    desc:'Next melee hit deals +2d6 thunder.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7 },
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
    label:"Hunter's Mark", level:1, concentration:true,
    desc:'Mark prey: +1d6 damage on your hits (concentration).',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7 },
    color:0x1abc9c,
    cast(game, h, foe) {
      game.markSpellUsed(h, this);
      applyEffect(foe, 'huntersMarked', { duration:120, elapsed:game.elapsed, source:h });
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
      if (_rollSave(foe, 'con', dc, { magic:true })) {
        game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`🧿 ${foe.data.name} resists Blindness!`, 'miss');
      } else {
        applyEffect(foe, 'blinded', { duration:60, elapsed:game.elapsed, source:h,
          repeatSave:{ ability:'con', dc, every:6 } });
        game.playAbilityFx(h, 'blindness', { at:foe });
        game.fxLog(`🧿 ${h.data.name} blinds ${foe.data.name}!`, 'crit');
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
      if (_rollSave(foe, 'wis', dc, { magic:true })) {
        game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`🔗 ${foe.data.name} resists Hold Person!`, 'miss');
      } else {
        applyEffect(foe, 'paralyzed', { duration:60, elapsed:game.elapsed, source:h,
          repeatSave:{ ability:'wis', dc, every:6 } });
        game.concentrate(h, 'holdPerson', [{ e:foe, key:'paralyzed' }]);
        game.playAbilityFx(h, 'holdPerson', { at:foe });
        game.fxLog(`🔗 ${h.data.name} paralyzes ${foe.data.name}!`, 'crit');
      }
      return true;
    }
  },

  sleep: {
    label:'Sleep', level:1,
    desc:'Put a foe to sleep if low HP (WIS save). Unconscious foes can\'t act.',
    recharge:'slot',
    ai:{ when:'any', priority:4, minCombatSec:1.0 },
    color:0x6688aa,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      const hpFrac = foe.data.hp / Math.max(foe.data.maxHp, 1);
      if (hpFrac > 0.5 && foe.data.hp > 20) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'sleep', { at:h, spell:true });
      if (_rollSave(foe, 'wis', dc, { magic:true })) {
        game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`💤 ${foe.data.name} resists Sleep!`, 'miss');
      } else {
        /* 1 minute or until damaged (damageMonster wakes sleepers) */
        applyEffect(foe, 'unconscious', { duration:60, elapsed:game.elapsed, source:h });
        game.playAbilityFx(h, 'sleep', { at:foe });
        game.fxLog(`💤 ${h.data.name} puts ${foe.data.name} to sleep!`, 'crit');
      }
      return true;
    }
  },

  fear: {
    label:'Fear', level:3, concentration:true,
    desc:'Frighten foes (WIS save, repeats each round): disadvantage on attacks.',
    recharge:'slot',
    ai:{ when:'cluster', priority:7, minTargets:2, minCombatSec:1.5 },
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
        if (!_rollSave(m, 'wis', dc, { magic:true })
            && applyEffect(m, 'frightened', { duration:60, elapsed:game.elapsed, source:h,
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
    ai:{ when:'cluster', priority:6, minTargets:2, minCombatSec:1.0 },
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
        if (!_rollSave(m, 'wis', dc, { magic:true })
            && applyEffect(m, 'slowed', { duration:60, elapsed:game.elapsed, source:h }))
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
    ai:{ when:'cluster', priority:5, minTargets:2, minCombatSec:1.0 },
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
        if (!_rollSave(m, 'cha', dc, { magic:true })
            && applyEffect(m, 'baned', { duration:60, elapsed:game.elapsed, source:h }))
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
    ai:{ when:'cluster', priority:5, minTargets:2, minCombatSec:1.0 },
    color:0xb08cff,
    cast(game, h, foe) {
      const foes = clusterAround(game, foe, 2.5);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'faerieFire', { at:foe, alsoAt:foes, spell:true, ring:2.0 });
      game.fxLog(`✨ ${h.data.name} casts Faerie Fire!`, 'crit');
      const applied = [];
      for (const m of foes) {
        if (m.dead) continue;
        if (!_rollSave(m, 'dex', dc, { magic:true })
            && applyEffect(m, 'faerieFire', { duration:60, elapsed:game.elapsed, source:h }))
          applied.push({ e:m, key:'faerieFire' });
      }
      game.concentrate(h, 'faerieFire', applied);
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
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'rayOfEnfeeblement', { at:h, spell:true });
      if (_rollSave(foe, 'con', dc, { magic:true })) {
        game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`💪 ${foe.data.name} resists Ray of Enfeeblement!`, 'miss');
      } else {
        applyEffect(foe, 'weakenedDmg', { duration:60, elapsed:game.elapsed, source:h,
          repeatSave:{ ability:'con', dc, every:6 } });
        game.concentrate(h, 'rayOfEnfeeblement', [{ e:foe, key:'weakenedDmg' }]);
        game.playAbilityFx(h, 'rayOfEnfeeblement', { at:foe });
        game.fxLog(`💪 ${h.data.name} enfeebles ${foe.data.name}!`, 'crit');
      }
      return true;
    }
  },

  web: {
    label:'Web', level:2, concentration:true,
    desc:'Restrain foes (DEX save; STR save each round to break free).',
    recharge:'slot',
    ai:{ when:'cluster', priority:6, minTargets:2, minCombatSec:1.0 },
    color:0xbfa060,
    cast(game, h, foe) {
      const foes = clusterAround(game, foe, 2.5);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'web', { at:foe, alsoAt:foes, spell:true, ring:2.2 });
      game.fxLog(`🕸 ${h.data.name} casts Web!`, 'crit');
      const applied = [];
      for (const m of foes) {
        if (m.dead) continue;
        if (!_rollSave(m, 'dex', dc, { magic:true })
            && applyEffect(m, 'restrained', { duration:60, elapsed:game.elapsed, source:h,
                repeatSave:{ ability:'str', dc, every:6 } }))
          applied.push({ e:m, key:'restrained' });
      }
      game.concentrate(h, 'web', applied);
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
      if (_rollSave(foe, 'wis', dc, { magic:true })) {
        game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`😂 ${foe.data.name} resists Laughter!`, 'miss');
      } else {
        applyEffect(foe, 'prone', { duration:60, elapsed:game.elapsed, source:h,
          repeatSave:{ ability:'wis', dc, every:6 } });
        applyEffect(foe, 'incapacitated', { duration:60, elapsed:game.elapsed, source:h,
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
      game.fxLog(`✨ ${h.data.name} casts Lesser Restoration on ${target.data.name}!`, 'heal');
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
      game.fxLog(`🌟 ${h.data.name} casts Greater Restoration on ${target.data.name}!`, 'heal');
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
      game.fxLog(`🛡 ${h.data.name} casts Protection from Evil — cleansed!`, 'heal');
      return true;
    }
  },

  /* ============ EXTENDED SPELL LIST ============ */

  /* ── Level 1 ── */
  grease: {
    label:'Grease', level:1,
    desc:'Slick area knocks foes prone (DEX save).',
    recharge:'slot',
    ai:{ when:'cluster', priority:4, minTargets:2, minCombatSec:1.0 },
    color:0xbfa060,
    cast(game, h, foe) {
      const foes = clusterAround(game, foe, 2.5);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'grease', { at:foe, alsoAt:foes, spell:true, ring:2.0 });
      game.fxLog(`🛢 ${h.data.name} casts Grease!`, 'crit');
      for (const m of foes) {
        if (m.dead) continue;
        if (!_rollSave(m, 'dex', dc, { magic:true }))
          applyEffect(m, 'prone', { duration:5, elapsed:game.elapsed, source:h });
      }
      return true;
    }
  },

  inflictWounds: {
    label:'Inflict Wounds', level:1,
    desc:'Melee-range necrotic burst: 3d10 to a single foe.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:8 },
    color:0xc04040,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const amt = roll(3, 10, d.dmgBonus);
      game.playAbilityFx(h, 'inflictWounds', { at:foe, spell:true });
      game.damageMonster(foe, amt, h, false);
      game.fxLog(`💀 ${d.name} casts Inflict Wounds on ${foe.data.name} — ${amt} dmg!`, 'crit');
      return true;
    }
  },

  /* ── Level 2 ── */
  acidArrow: {
    label:'Acid Arrow', level:2,
    desc:'Corrosive bolt: 4d4 acid to a single foe.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:6, minCombatSec:1.5 },
    color:0x4cae4c,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      const d = h.data, from = game._v3(h.x, 0.55, h.z);
      const to = game._v3(foe.x, 0.5*foe.data.scale+0.4, foe.z);
      const amt = roll(4, 4, d.dmgBonus);
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'acidArrow', { at:h, spell:true });
      game.fxProjectile(from, to, 'bolt', this.color, () => {
        if (foe.dead) return;
        game.damageMonster(foe, amt, h, false);
        game.fxSprite('dcss/effect/acid_venom.png', to, 1.1, 0.3);
      });
      game.fxLog(`🧪 ${d.name} casts Acid Arrow — ${amt} acid dmg!`, 'crit');
      return true;
    }
  },

  mistyStep: {
    label:'Misty Step', level:2,
    desc:'Teleport away and gain +2 AC for 4s.',
    recharge:'short',
    ai:{ when:'selfHurt', priority:7, hpFrac:0.35 },
    color:0x8fd4e8,
    cast(game, h) {
      game.markSpellUsed(h, this);
      applyEffect(h, 'phaseStep', { duration:4, elapsed:game.elapsed });
      game.playAbilityFx(h, 'mistyStep', { at:h, spell:true, scale:1.8 });
      game.fxLog(`💨 ${h.data.name} uses Misty Step! (+4 AC)`, 'heal');
      return true;
    }
  },

  silence: {
    label:'Silence', level:2,
    desc:'Disrupt foes: -4 AC (reduces armor) for 5s (no save).',
    recharge:'slot',
    ai:{ when:'cluster', priority:6, minTargets:2, minCombatSec:1.0 },
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
        setTimeout(() => { if (m && m.data && !m.dead) m.data.ac += 4; }, 5000);
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
      if (_rollSave(foe, 'wis', dc, { magic:true })) {
        game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`🧿 ${foe.data.name} resists Bestow Curse!`, 'miss');
      } else {
        const curses = ['weakenedDmg','slowed','baned'];
        const curse = curses[Math.floor(Math.random() * curses.length)];
        applyEffect(foe, curse, { duration:60, elapsed:game.elapsed, source:h });
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
    desc:'Line of lightning: 8d6 to a cluster.',
    recharge:'slot',
    ai:{ when:'cluster', priority:8, minTargets:2 },
    color:0x7090ff,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.5);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'lightningBolt', { at:foe, alsoAt:foes, spell:true, ring:2.5, scale:2.2 });
      game.fxLog(`⚡ ${d.name} casts Lightning Bolt!`, 'crit');
      for (const m of foes) if (!m.dead) game.damageMonster(m, roll(8, 6, d.dmgBonus), h, false);
      return true;
    }
  },

  massHealingWord: {
    label:'Mass Healing Word', level:3,
    desc:'Heal 3 wounded allies (1d4 + mod each).',
    recharge:'slot',
    ai:{ when:'hurtAlly', priority:9, hpFrac:0.5, minCombatSec:1.0 },
    color:0x6ae06a,
    cast(game, h, _, alive) {
      const d = h.data;
      const hurt = alive
        .filter(a => a.data.hp < a.data.maxHp * 0.75)
        .sort((a, b) => a.data.hp/a.data.maxHp - b.data.hp/b.data.maxHp)
        .slice(0, 3);
      if (!hurt.length) return false;
      game.markSpellUsed(h, this);
      for (const a of hurt) {
        const amt = roll(1, 4, mod(castAbility(h)) + d.healBonus);
        game.healHero(a, amt);
      }
      game.playAbilityFx(h, 'massHealingWord', { at:h, alsoAt:hurt, spell:true, ring:2.0 });
      game.fxLog(`✨ ${d.name} casts Mass Healing Word on ${hurt.length} allies!`, 'heal');
      return true;
    }
  },

  vampiricTouch: {
    label:'Vampiric Touch', level:3,
    desc:'Drain foe for 3d6 and heal self for half.',
    recharge:'slot',
    ai:{ when:'selfHurt', priority:7, hpFrac:0.45, minCombatSec:1.5 },
    color:0xc04040,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dmg = roll(3, 6, d.dmgBonus);
      game.damageMonster(foe, dmg, h, false);
      const heal = Math.max(1, Math.round(dmg * 0.5));
      game.healHero(h, heal);
      game.playAbilityFx(h, 'vampiricTouch', { at:foe, spell:true });
      game.fxLog(`🩸 ${d.name} drains ${foe.data.name} for ${dmg} dmg, heals ${heal}!`, 'crit');
      return true;
    }
  },

  /* ── Level 4 ── */
  iceStorm: {
    label:'Ice Storm', level:4,
    desc:'Hailstorm: 4d8 cold + slowed to cluster (DEX save).',
    recharge:'slot',
    ai:{ when:'cluster', priority:9, minTargets:3, minCombatSec:1.5 },
    color:0x7fd4ff,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.8);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      game.playAbilityFx(h, 'iceStorm', { at:foe, alsoAt:foes, spell:true, ring:2.6, scale:2.4 });
      game.fxLog(`❄ ${d.name} casts Ice Storm!`, 'crit');
      for (const m of foes) {
        if (m.dead) continue;
        game.damageMonster(m, roll(4, 8, d.dmgBonus), h, false);
        if (!_rollSave(m, 'dex', dc, { magic:true }))
          applyEffect(m, 'slowed', { duration:4, elapsed:game.elapsed, source:h });
      }
      return true;
    }
  },

  blight: {
    label:'Blight', level:4,
    desc:'Massive necrotic blast: 8d8 to a single foe.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:9, minCombatSec:2.0 },
    color:0x6a3080,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const amt = roll(8, 8, d.dmgBonus);
      game.playAbilityFx(h, 'blight', { at:foe, spell:true, scale:2.0 });
      game.damageMonster(foe, amt, h, false);
      game.fxLog(`🕱 ${d.name} casts Blight — ${amt} necrotic dmg on ${foe.data.name}!`, 'crit');
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
      applyEffect(worst, 'deathWarded', { duration:600, elapsed:game.elapsed });
      game.playAbilityFx(h, 'deathWard', { at:worst, spell:true, scale:1.6 });
      game.fxLog(`🛡 ${h.data.name} casts Death Ward on ${worst.data.name}!`, 'heal');
      return true;
    }
  },

  wallOfFire: {
    label:'Wall of Fire', level:4,
    desc:'Burning zone: 5d8 fire to cluster.',
    recharge:'slot',
    ai:{ when:'cluster', priority:8, minTargets:2, minCombatSec:1.5 },
    color:0xff6020,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.8);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'wallOfFire', { at:foe, alsoAt:foes, spell:true, ring:2.8, scale:2.6, dur:0.7 });
      game.fxLog(`🔥 ${d.name} casts Wall of Fire!`, 'crit');
      for (const m of foes) if (!m.dead) game.damageMonster(m, roll(5, 8, d.dmgBonus), h, false);
      return true;
    }
  },

  /* ── Level 5 ── */
  coneOfCold: {
    label:'Cone of Cold', level:5,
    desc:'Freezing blast: 8d8 cold to nearby foes.',
    recharge:'slot',
    ai:{ when:'cluster', priority:9, minTargets:2, minCombatSec:1.5 },
    color:0x7fd4ff,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 3.0);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'coneOfCold', { at:foe, alsoAt:foes, spell:true, ring:2.8, scale:2.6 });
      game.fxLog(`❄ ${d.name} casts Cone of Cold!`, 'crit');
      for (const m of foes) if (!m.dead) game.damageMonster(m, roll(8, 8, d.dmgBonus), h, false);
      return true;
    }
  },

  flameStrike: {
    label:'Flame Strike', level:5,
    desc:'Divine fire column: 8d6 radiant + fire to cluster.',
    recharge:'slot',
    ai:{ when:'cluster', priority:9, minTargets:2, minCombatSec:2.0 },
    color:0xffd34a,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.5);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'flameStrike', { at:foe, alsoAt:foes, spell:true, ring:2.5, scale:2.4 });
      game.fxLog(`🔥 ${d.name} calls down Flame Strike!`, 'crit');
      for (const m of foes) if (!m.dead) game.damageMonster(m, roll(8, 6, d.dmgBonus), h, false);
      return true;
    }
  },

  massCureWounds: {
    label:'Mass Cure Wounds', level:5,
    desc:'Heal all living party members for 3d8 + mod.',
    recharge:'long',
    ai:{ when:'hurtAlly', priority:10, hpFrac:0.35, minCombatSec:2.0 },
    color:0x6ae06a,
    cast(game, h, _, alive) {
      const d = h.data;
      game.markSpellUsed(h, this);
      for (const a of alive) {
        const amt = roll(3, 8, mod(castAbility(h)) + d.healBonus);
        game.healHero(a, amt);
      }
      game.playAbilityFx(h, 'massCureWounds', { at:h, alsoAt:alive, spell:true, ring:2.5, scale:2.2 });
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
      if (_rollSave(foe, 'wis', dc, { magic:true })) {
        game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`🔗 ${foe.data.name} resists Hold Monster!`, 'miss');
      } else {
        applyEffect(foe, 'paralyzed', { duration:60, elapsed:game.elapsed, source:h,
          repeatSave:{ ability:'wis', dc, every:6 } });
        game.concentrate(h, 'holdMonster', [{ e:foe, key:'paralyzed' }]);
        game.playAbilityFx(h, 'holdMonster', { at:foe });
        game.fxLog(`🔗 ${h.data.name} paralyzes ${foe.data.name}!`, 'crit');
      }
      return true;
    }
  },
};

/* ================================================================
   Spell pools — what spells each class can learn at each spell tier
   ================================================================ */
export const SPELL_POOLS = {
  wizard: {
    1: ['magicMissile','shield','grease'],
    2: ['scorchingRay','magicMissile','shield','blindness','hideousLaughter','sleep','mistyStep','acidArrow'],
    3: ['fireball','haste','scorchingRay','slow','fear','lightningBolt','bestowCurse','vampiricTouch'],
    4: ['iceStorm','blight','wallOfFire'],
    5: ['coneOfCold','holdMonster'],
  },
  cleric: {
    1: ['bless','healingWord','bane','protectionFromEvil','inflictWounds'],
    2: ['spiritualWeapon','bless','blindness','lesserRestoration','holdPerson','silence'],
    3: ['spiritGuardians','spiritualWeapon','slow','fear','massHealingWord','bestowCurse'],
    4: ['deathWard','iceStorm'],
    5: ['flameStrike','massCureWounds'],
  },
  druid: {
    1: ['entangle','healingWord','faerieFire','sleep','grease'],
    2: ['moonbeam','entangle','web','lesserRestoration','holdPerson','acidArrow'],
    3: ['callLightning','moonbeam','slow','massHealingWord','lightningBolt'],
    4: ['iceStorm','blight','wallOfFire'],
    5: ['massCureWounds','coneOfCold'],
  },
  bard: {
    1: ['healingWord','bless','bane','hideousLaughter','faerieFire','sleep'],
    2: ['shatter','healingWord','blindness','lesserRestoration','holdPerson','silence'],
    3: ['shatter','haste','slow','fear','massHealingWord'],
    4: ['greaterRestoration'],
    5: ['massCureWounds'],
  },
  sorcerer: {
    1: ['chaosBolt','dragonBreathSpell','shield','sleep','grease'],
    2: ['scorchingRay','chaosBolt','blindness','web','holdPerson','rayOfEnfeeblement','mistyStep'],
    3: ['fireball','haste','slow','fear','lightningBolt'],
    4: ['blight','wallOfFire','iceStorm'],
    5: ['coneOfCold','holdMonster'],
  },
  warlock: {
    1: ['hex','armsOfHadar','magicMissile','bane','faerieFire','inflictWounds'],
    2: ['hex','scorchingRay','blindness','holdPerson','rayOfEnfeeblement','mistyStep'],
    3: ['armsOfHadar','hex','fear','vampiricTouch','bestowCurse'],
    4: ['blight'],
  },
  paladin: {
    1: ['thunderousSmite','bless','protectionFromEvil'],
    2: ['thunderousSmite','bless','lesserRestoration'],
    3: [],
    4: ['deathWard'],
  },
  ranger: {
    1: ['huntersMark','entangle','faerieFire'],
    2: ['huntersMark','healingWord','lesserRestoration'],
  }
};
