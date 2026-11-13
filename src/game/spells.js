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
import { addVirtualLight, removeVirtualLight, hasVirtualLight, addDarkZone, DARK_ZONES, zonePos, heroLightSource } from './light_sources.js';
import { canSee } from './light_rules.js';
import { hasFeature } from './features.js';
import { isPointInLineSegment, isPointInCone } from './aoe_system.js';
import { placeSphereBody, SPHERE_REACH } from './flaming_sphere.js';

/* ── tiny dice helpers (avoid srd.js import → circular deps) ── */
function roll(count, sides, bonus = 0) {
  /* Empowered Spell (sorcerer talent, class_talents.js empowerSpell): during
     the sorcerer's own turn, damage dice that land 1 or 2 are rerolled once. */
  const emp = SPELL_ROLL.empower;
  const live = !!(emp && emp.live());
  if (emp && !live) SPELL_ROLL.empower = null;
  const reroll = live && sides > 2 && sides < 20;
  /* Spell Bombardment (wild_magic.js): the first die this turn that lands on
     its top face is rolled again and added. */
  const bomb = SPELL_ROLL.bombard;
  const bombLive = !!(bomb && !bomb.used && bomb.live());
  if (bomb && !bombLive) SPELL_ROLL.bombard = null;
  let t = bonus;
  for (let i = 0; i < count; i++) {
    let r = Math.floor(Math.random() * sides) + 1;
    if (reroll && r <= 2) r = Math.floor(Math.random() * sides) + 1;
    if (bombLive && !bomb.used && sides > 2 && sides < 20 && r === sides) {
      const extra = Math.floor(Math.random() * sides) + 1;
      bomb.used = true;
      t += extra;
      if (bomb.onFire) bomb.onFire(extra);
    }
    t += r;
  }
  return t;
}
/* Armed by class_talents.js empowerSpell / metamagic.js: { owner, live() };
   bombard by wild_magic.js armSpellBombardment: { owner, used, live(), onFire } */
export const SPELL_ROLL = { empower: null, bombard: null };
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
/* Inflict Wounds' look: a blood scythe reaps round the target, and as it starts to
   tear away a blood Mana Burst blows out of the wound. */
function playReap(game, caster, foe) {
  later(game, 0, () => { if (game.fxScytheReap) game.fxScytheReap(foe, caster, REAP_SIZE); });
  later(game, REAP_BURST_MS, () => { if (game.fxManaBurst) game.fxManaBurst(foe, 'blood', REAP_SIZE); });
}
/* render/pfx/shock_ring.js: seconds after the clap for the ring (8 art px to 104 in 0.5 s, easing out) to reach `px`. */
function shockArrives(px) { return 0.5 * (1 - Math.cbrt(1 - Math.max(0, Math.min(1, (px - 8) / 96)))); }
function mod(score) { return Math.floor((score - 10) / 2); }

/* Dancing Lights: where the three motes sit round their point. */
const DANCING_LIGHT_OFFSETS = [[0, 0], [1.6, 0.8], [-1.4, 1.0]];

/* The PAL ramp each type Chaos Bolt can roll bursts in. */
export const CHAOS_BOLT_PALETTES = { acid:'cyber', cold:'ice', fire:'fire', lightning:'volt', poison:'poison', thunder:'arcane' };
/* Chromatic Orb's damage types, and how far into each landing effect
   (render/pixelfx_live.js spawnElementImpact, and body_fx.js for poison) its flash comes. */
export const CHROMATIC_ORB_HIT_MS = { fire:0, cold:170, lightning:70, acid:250, poison:480 };
const CHAOS_BOLT_FLASH_MS = 220;      // arcane/mana-burst's GATHER
const CURE_WOUNDS_HEAL_MS = 740;      // holy/heal's hoop reaches the top of the body
const FAERIE_STARS_LAND_MS = 400;     // render/pfx/faerie_stars.js: the first stars reach the floor
const GREASE_SPREAD_MS = 300;         // render/pfx/grease_slick.js has run most of the way out
const BLESS_HALO_MS = 2500;           // holy/blessing starts fading out 0.5 s before its 3 s ends
const BANE_FLARE_MS = 2600;           // shadow/hex-sigil's FLARE
const ARMS_OF_HADAR_LASH_MS = 450;   // into shadow/shadow-tendrils (its OPEN is 0.34 s, then the rise)
const ARMS_OF_HADAR_RADIUS = 2.2;    // who the tentacles reach, and the rim of the flat portal under them

/** The caster's Dancing Lights still burning, or null (a floor change cleared
 *  the lights). */
export function activeDancingLights(h) {
  const motes = h && h._dancingLights;
  return motes && motes.some(m => hasVirtualLight(m.light)) ? motes : null;
}
export function clearDancingLights(h) {
  for (const m of (h && h._dancingLights) || []) {
    removeVirtualLight(m.light);
    if (m.wisp) m.wisp.remove();
  }
  if (h) h._dancingLights = null;
}
/* The Light cantrip's mote: a small white point at the shoulder of a hero who
   is seeing by the spell. A lantern or torch that outranks it, a goblin's
   bucket, a fall or the end of the floor puts it out. It adds no light of its
   own, and it trails a walking hero slightly. */
const LIGHT_MOTE_RATE = 6, LIGHT_MOTE_OFFSET = [0.3, 0.3, -0.25];
export function tickLightMotes(game, dt) {
  if (!game.fxLightMote) return;
  const motes = game._lightMotes || (game._lightMotes = new Map());
  const onFloor = game.state === 'crawl';
  for (const [h, m] of motes) {
    if (onFloor && (game.heroes || []).includes(h) && h.data.hp > 0 && heroLightSource(h.data) === 'light') continue;
    m.fx.remove();
    motes.delete(h);
  }
  if (!onFloor) return;
  for (const h of game.heroes || []) {
    if (!h.data || h.data.hp <= 0 || heroLightSource(h.data) !== 'light') continue;
    const c = game.fxChestPos(h);
    const x = c.x + LIGHT_MOTE_OFFSET[0], y = c.y + LIGHT_MOTE_OFFSET[1], z = c.z + LIGHT_MOTE_OFFSET[2];
    let m = motes.get(h);
    if (!m) {
      m = { fx: game.fxLightMote(x, y, z), x, y, z };
      motes.set(h, m);
      continue;
    }
    const k = Math.min(1, dt * LIGHT_MOTE_RATE);
    m.x += (x - m.x) * k; m.y += (y - m.y) * k; m.z += (z - m.z) * k;
    m.fx.place(m.x, m.y, m.z);
  }
}
/* In a fight the wisps move only on the caster's turn: they drift to the
   nearest foe the party can't see within 60 ft, or back to the caster. */
export function dancingLightsTurn(game, h, seconds = 0.8) {
  const motes = activeDancingLights(h);
  if (!motes) return;
  const lost = (game.monsters || [])
    .filter(m => m && m.data && m.data.hp > 0 && m.active && !m.dead && !canSee(h, m) && Math.hypot(m.x - h.x, m.z - h.z) <= 12)
    .sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z))[0];
  const at = lost || h;
  motes.forEach((m, i) => {
    m.x = at.x + DANCING_LIGHT_OFFSETS[i][0];
    m.z = at.z + DANCING_LIGHT_OFFSETS[i][1];
    if (m.wisp) m.wisp.glideTo(m.x, m.z, seconds);
  });
}
/* Outside a fight they trail the caster, easing after them each frame. A
   caster who has fallen takes the lights with them. */
const WISP_FOLLOW_RATE = 2.5;
export function tickDancingLights(game, dt) {
  for (const h of game.heroes || []) {
    if (!h._dancingLights) continue;
    if (!activeDancingLights(h) || !h.data || h.data.hp <= 0) { clearDancingLights(h); continue; }
    if (game.isCombatActive && game.isCombatActive()) continue;
    const k = Math.min(1, dt * WISP_FOLLOW_RATE);
    h._dancingLights.forEach((m, i) => {
      m.x += (h.x + DANCING_LIGHT_OFFSETS[i][0] - m.x) * k;
      m.z += (h.z + DANCING_LIGHT_OFFSETS[i][1] - m.z) * k;
      if (m.wisp) m.wisp.place(m.x, m.z);
    });
  }
}

/* Where a spell leaves its caster: the centre of the chest, on the floor the
   caster actually stands on. */
function chestOf(game, e) {
  return game.fxChestPos ? game.fxChestPos(e) : game._v3(e.x, 0.55, e.z);
}
/* A height above the floor under `e` (raised or sunken), for aiming at a body. */
function onFloor(game, e, y) {
  return game._v3(e.x, (game.fxGroundY ? game.fxGroundY(e.x, e.z) : 0) + y, e.z);
}

/* When each pixelfx impact visibly connects, so the damage numbers pop with
   it rather than before it: the bolt reaching the floor, the icicle stabbing
   down, the skull stamping (ms from the cast; see vfx_animations.json). */
const CALL_LIGHTNING_HIT_MS = 520;
/* Call Lightning's cloud: time to gather before the first bolt, and to glide
   over a new target before each later one. */
const STORM_GATHER_MS = 500;
const STORM_GLIDE_MS = 600;
const ICE_STORM_HIT_MS = 480;
const MARK_LOCK_MS = 350;              // render/pfx/target_reticle.js: the brackets lock
const HEX_STAMP_MS = 550;              // shadow/curse's skull lands
const REAP_SIZE = 0.7;
const REAP_BURST_MS = 560;             // melee/scythe-reap has swept and hung; it starts to tear away
/* Thunderwave's timing, kept with its art so the blows and the ring can't drift apart. */
const THUNDERCLAP_RING_DELAY = 0.12, THUNDERWAVE_PX_PER_UNIT = 38 / 1.1;
const SLEEP_TAKES_MS = 600;            // render/pfx/ward_circle.js has opened and is turning
const WARD_RISES_MS = 600;              // render/pfx/ward_circle.js has opened and is turning
const BLIGHT_HIT_MS = 620;

/* ── helpers ── */
function castAbility(h) {
  const d = h.data;
  const clsAtk = d._classAtk || 'int';   // set by recalc() from the class's attack ability
  return d.effStats?.[clsAtk] ?? 10;
}
/* 5e spell save DC: 8 + proficiency bonus + casting-ability modifier, plus any
   spell-DC bonus (srd.js recalc spellDCBonus: skill-tree potency nodes, passives) */
export function spellDC(h) {
  const lvl = h.data.level || 1;
  return 8 + (2 + Math.floor((lvl - 1) / 4)) + mod(castAbility(h)) + (h.data.spellDCBonus || 0);
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

export function pickProjectileTarget(game, h, primaryFoe, allocatedHpMap = null) {
  const activeMonsters = (game.monsters || []).filter(m => {
    if (!m || !m.data || m.data.hp <= 0 || m.active === false) return false;
    if (h && typeof game.hasLOS === 'function' && !game.hasLOS(h.x, h.z, m.x, m.z)) return false;
    return true;
  });
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

  // Fallback to any living monster with line of sight
  return (primaryFoe && !primaryFoe.dead && activeMonsters.includes(primaryFoe)) ? primaryFoe : activeMonsters[0];
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
  const from = chestOf(game, h);
  const to = onFloor(game, foe, 0.45 * ((foe.data && foe.data.scale) || 1.0) + 0.3);
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
    ai:{ when:'any', priority:4, minCombatRound:1 },
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
  /* docs/LIGHT_IDEAS.md 24: oil splashes and catches — a pool of fire that
     burns anyone standing in or walking through it (allies too), and lights
     the area while it burns. */
  oilFlask: {
    label:'Flask of Oil', level:0, thrown:true, icon:'🛢️',
    desc:'Throw: lights a 3x3 pool of burning oil for 3 rounds. Anyone entering or starting a turn in it takes 2d4 fire. It lights the area while it burns.',
    ai:{ when:'cluster', priority:5, minTargets:2, minCombatRound:1, aoeRadius:1.2 },
    dmgType:'fire', color:0xff7a30,
    cast(game, h, foe) {
      const ignite = () => {
        if (!foe) return;
        const x = foe.x, z = foe.z;
        game.spawnAoEZone(h, 'oilFire', x, z, 1.25, {
          color: 0xff6a20, dur: 18, damageType: 'fire', indicatorOpacity: 0.32, pointLight: false
        });
        if (game.addVirtualLight) game.addVirtualLight({ x, z, bright: 1, dim: 3, color: 0xff8a30, ttl: 18 });
        game.fxLog(`🔥 The oil catches — a pool of fire spreads around ${foe.data ? foe.data.name : 'the target'}!`, 'crit');
      };
      return throwAt(game, h, foe, this, 'smashes a flask of oil at', () => ignite(), () => ignite());
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
    area:{ shape:'cone', range:3.2, halfAngle:0.55 },   // 15-ft cone at the target, as cast below
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
          const from = chestOf(game, h);
          const t = game._v3(
            dartTarget.x + (Math.random() - 0.5) * 0.3,
            onFloor(game, dartTarget, 0.4 * (dartTarget.data?.scale || 1.0) + 0.4).y,
            dartTarget.z + (Math.random() - 0.5) * 0.3
          );

          const targetRef = dartTarget;
          /* Each dart is the authored animation (vfx_animations.json `magicMissile`)
             on its own bend; the first one plays the caster's spellcast. */
          game.playAbilityFx(h, 'magicMissile', {
            at:targetRef, fromPos:from, toPos:t, curve, spell:true, noAnim:i > 0, sfxVolume:0.45,
            onImpact: () => {
              if (targetRef.dead) return;
              game.spellDamage(targetRef, roll(1, 4, 1) + d.dmgBonus, h, false, { dmgType: this.dmgType, magical: true });
            }
          });
        }, delayMs);
      }
      return true;
    }
  },

  shield: {
    label:'Shield', level:1,
    desc:'When bloodied, gain +5 AC for 1 round.',
    recharge:'slot',
    ai:{ when:'selfHurt', priority:8, hpFrac:0.4 },
    color:0x88aaff,
    cast(game, h) {
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'shield', { at:h, spell:true });
      /* All the spell shows is its status: the bubble grows when the charge ends. */
      later(game, 0, () => {
        if (!h.data || h.data.hp <= 0) return;
        applyEffect(h, 'shielded', { duration:ROUND_SECONDS, elapsed: game.fxNow, source:h });
      });
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

          const from = chestOf(game, h);
          const to = onFloor(game, rayTarget, 0.5 * (rayTarget.data?.scale || 1.0) + 0.4);
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
    /* The hit geometry, read by the cast and drawn by the VFX editor's Hit area. */
    area:{ shape:'circle', radius:4.0 },
    dmgType:'fire',
    color:0xff7a30,
    cast(game, h, foe, alive, slotLevel = 3, targetPos = null) {
      const d = h.data;
      const center = targetPos || (foe ? { x: foe.x, z: foe.z } : null);
      if (!center) return false;
      const foes = clusterAround(game, center, this.area.radius);
      const from = chestOf(game, h);
      /* The bolt flies at body height; the blast layer is `ground`, so it
         sits on the floor under this point. */
      const to = onFloor(game, center, 0.5);
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const diceCount = 8 + Math.max(0, (slotLevel || 3) - 3);
      game.fxLog(`🔥 ${d.name} casts Fireball (Lvl ${slotLevel || 3}, ${diceCount}d6)!`, 'crit');

      /* The bolt (vfx_animations.json `fireball`) streaks from the caster to
         the blast point and bursts there; the damage lands with the burst. */
      game.playAbilityFx(h, 'fireball', { at:center, spell:true, fromPos:from, toPos:to, onImpact: () => {
        if (game.triggerShake) game.triggerShake(0.7, 0.35);
        if (game.fxFlashLight) game.fxFlashLight(to, 0xff8822, 6.0, 15.0, 0.38);
        for (const m of foes) {
          if (m.dead) continue;
          let dmg = roll(diceCount, 6, d.dmgBonus);
          if (game.spellSave(m, 'dex', dc, { magic: true })) dmg = Math.floor(dmg / 2);
          game.spellDamage(m, dmg, h, true, { dmgType: this.dmgType, magical: true });
        }
      } });
      return true;
    }
  },

  haste: {
    label:'Haste', level:3, concentration:true,
    desc:'Hasten yourself: double speed, +2 AC and one extra weapon attack each turn (concentration, 10 rounds).',
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
    desc:'Party-wide +1d4 to attack rolls and saving throws (concentration, 10 rounds).',
    recharge:'slot',
    ai:{ when:'any', priority:4, buffEffect:'inspired', buffTarget:'party' },
    color:0xffe08a,
    cast(game, h, _, alive) {
      game.markSpellUsed(h, this);
      /* A cone of light on every ally; as it fades, the halo and the bonus arrive. */
      if (game.fxBodyEffect) for (const a of alive) game.fxBodyEffect('blessing', a);
      game.playAbilityFx(h, 'bless', { at:h, spell:true });
      game.fxLog(`✨ ${h.data.name} casts Bless! (+1d4 to hit)`, 'buff');
      later(game, BLESS_HALO_MS, () => {
        if (!h.data || h.data.hp <= 0) return;
        const living = alive.filter(a => a.data && a.data.hp > 0);
        for (const a of living) applyEffect(a, 'blessed', { duration:60, elapsed: game.fxNow, source:h });
        game.concentrate(h, 'bless', living.map(a => ({ e:a, key:'blessed' })));
      });
      return true;
    }
  },

  spiritualWeapon: {
    label:'Spiritual Weapon', level:2, bonusAction:true,
    desc:'A floating force weapon strikes a foe for 1d8 + WIS now and again as a bonus action every round for 10 rounds (no concentration).',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:6 },
    dmgType:'force',
    color:0xbfe0ff,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      /* already up — the sustained strike handles later rounds, don't re-cast */
      if (h.sustained && h.sustained.key === 'spiritualWeapon') return false;
      const d = h.data;
      const spell = this;
      const strike = (g, caster, tgt) => {
        if (!tgt || tgt.dead || !tgt.data || tgt.data.hp <= 0) return false;
        const amt = roll(1, 8, mod(castAbility(caster)) + (caster.data.dmgBonus || 0));
        const from = g._v3(tgt.x + (Math.random() - 0.5) * 0.4, 3.2, tgt.z + (Math.random() - 0.5) * 0.4);
        const to = onFloor(g, tgt, 0.5 * (tgt.data?.scale || 1.0) + 0.4);
        g.fxProjectile(from, to, 'bolt', spell.color, () => {
          if (!tgt.dead) {
            g.spellDamage(tgt, amt, caster, false, { dmgType: spell.dmgType, magical: true });
            g.fxSprite('dcss/effect/orb_glow_0.png', to, 1.4, 0.35);
          }
        }, { sheetKey: 'directional_impact_004_large_yellow', scale: 1.5, curve: { side: 0, up: 0.5 } });
        return true;
      };
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'spiritualWeapon', { at:h, spell:true });
      game.fxLog(`⚔ ${d.name} conjures a Spiritual Weapon!`, 'crit');
      strike(game, h, foe);
      /* 5e: lasts 1 minute, no concentration; each later round it attacks as
         the cleric's bonus action (so it competes with Healing Word). */
      if (game.sustainSpell) game.sustainSpell(h, 'spiritualWeapon', 10, (g, caster) => {
        if (caster._bonusActed) return;
        const tgt = g.findMonsterTarget ? g.findMonsterTarget(caster) : null;
        if (tgt && strike(g, caster, tgt)) {
          caster._bonusActed = true;
          g.fxLog(`⚔ ${caster.data.name}'s Spiritual Weapon strikes ${tgt.data.name}.`, 'roll');
        }
      });
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
      game.playAbilityFx(h, 'entangle', { at: targetPos || foe || h, spell:true });
      game.fxLog(`🌿 ${h.data.name} casts Entangle!`, 'crit');

      /* No flight: when the charge ends the weeds are simply there, and whoever
         fails the save is seized in the same moment. */
      later(game, 0, () => {
        if (!h.data || h.data.hp <= 0) return;
        const zone = game.spawnAoEZone(h, 'entangle', castX, castZ, 2.0, {
          color: 0x4caf50,
          borderColor: 0x2e7d32,
          dur: 60,
          difficultTerrain: true,
          innerOpacity: 0.32,
          borderOpacity: 0.95,
          pointLight: true,
          lightColor: 0x4caf50,
          lightIntensity: 2.2,
          lightRange: 6.0,
        });
        /* The weeds stand for as long as the zone does, and sink away when it ends. */
        if (zone && game.fxEntangleWeeds) zone.liveFx = game.fxEntangleWeeds(castX, castZ, 2.0);

        const foes = clusterAround(game, targetPos || foe || { x: castX, z: castZ }, 2.0);
        const applied = [];
        for (const m of foes) {
          if (m.dead) continue;
          if (game.spellSave(m, 'str', dc, { magic:true })) {
            game.fxLog(`🌿 ${m.data?.name || 'Foe'} avoids grasping vines (STR save).`, 'miss');
            continue;
          }
          if (applyEffect(m, 'restrained', { duration:60, elapsed: game.fxNow, source:h, data:{ aura:'entangled' },
              repeatSave:{ ability:'str', dc, every:ROUND_SECONDS } })) {
            applied.push({ e:m, key:'restrained' });
            game.fxLog(`🌿 ${m.data?.name || 'Foe'} is ensnared and RESTRAINED by Entangle!`, 'crit');
          }
        }
        game.concentrate(h, 'entangle', applied, zone);
      });
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
      game.fxLog(`✨ ${d.name} casts Moonbeam!`, 'crit');
      /* After the charge the shaft drops onto the target (render/pfx/moonbeam_shaft.js); it burns as it lands. */
      game.playAbilityFx(h, 'moonbeam', { at:foe, spell:true, onImpact: () => {
        if (d.hp <= 0) return;
        const targetX = foe.x, targetZ = foe.z;
        const zone = game.spawnAoEZone(h, 'moonbeam', targetX, targetZ, 1.8, {
          color: this.color,
          dur: 60,
          slotLevel: slotLevel || 2,
          noGround: true,
          lightIntensity: 0.7,
        });
        if (game.fxMoonbeam) zone.liveFx = game.fxMoonbeam(targetX, targetZ);
        game.concentrate(h, 'moonbeam', [], zone);
        later(game, 280, () => {
          if (h.conc?.zone !== zone) return;
          const foes = (h._side === 'mon' ? game.heroes : game.monsters).filter(m =>
            m.data && m.data.hp > 0 && m.active !== false && Math.hypot(m.x - zone.x, m.z - zone.z) <= zone.radius
          );
          for (const m of foes) {
            if (!zone.savesThisTurn.has(m)) {
              zone.savesThisTurn.add(m);
              game.resolveMoonbeamDamage(zone, m);
            }
          }
        });
      } });
      return true;
    }
  },

  callLightning: {
    label:'Call Lightning', level:3, concentration:true,
    desc:'A storm cloud gathers: 3d10 lightning to clustered foes now, and another bolt each round while you concentrate (DEX save half).',
    recharge:'slot',
    ai:{ when:'cluster', priority:8, minTargets:2 , aoeRadius:2.2},
    /* Each bolt's blast, read by the cast and drawn by the VFX editor's Hit area. */
    area:{ shape:'circle', radius:2.2 },
    dmgType:'lightning',
    color:0x7090ff,
    cast(game, h, foe) {
      /* the storm is already overhead — each round's bolt comes from onTurn */
      if (h.conc && h.conc.key === 'callLightning') return false;
      const d = h.data, foes = clusterAround(game, foe, this.area.radius);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      game.fxLog(`⚡ ${d.name} calls Lightning!`, 'crit');

      /* The storm cloud (render/pfx/storm_cloud.js, drawn live so it never
         loops) gathers over the first target and hangs on for the whole
         concentration, gliding over each round's new target. It never strikes
         on its own: a bolt (vfx_animations.json `callLightning`) comes down only
         when one is called, the cloud lights up from inside as it lands, and
         the damage lands with it. */
      const cloud = game.fxStormCloud ? game.fxStormCloud(foe.x, foe.z) : null;
      const spell = this;
      const callBolt = (g, caster, tgt, pack, delayMs) => {
        const dc = spellDC(caster);
        later(g, delayMs, () => {
          g.playAbilityFx(caster, 'callLightning', { at:tgt, alsoAt:pack, spell:true, ring:2.0, scale:2.0 });
          later(g, CALL_LIGHTNING_HIT_MS, () => {
            if (cloud) cloud.flash(1);
            for (const m of pack) {
              if (m.dead) continue;
              let dmg = roll(3, 10, caster.data.dmgBonus);
              if (g.spellSave(m, 'dex', dc, { magic:true })) dmg = Math.floor(dmg / 2);
              g.spellDamage(m, dmg, caster, false, { dmgType: spell.dmgType, magical:true });
            }
          });
        });
      };
      callBolt(game, h, foe, foes, cloud ? STORM_GATHER_MS : 0);

      /* 5e: on each of your turns you can call another bolt as your action.
         The druid keeps calling lightning until concentration breaks or
         nothing is left to hit; casting anything else breaks it — and takes
         the cloud with it (the concentration's zone). */
      game.concentrate(h, 'callLightning', [], cloud ? { liveFx: cloud } : null);
      if (h.conc) h.conc.onTurn = (g, caster) => {
        if (caster.actUsed) return;
        const tgt = g.findMonsterTarget ? g.findMonsterTarget(caster) : null;
        if (!tgt) return;
        const pack = clusterAround(g, tgt, spell.area.radius);
        if (!pack.length) return;
        if (cloud) cloud.glideTo(tgt.x, tgt.z, STORM_GLIDE_MS / 1000);
        callBolt(g, caster, tgt, pack, cloud ? STORM_GLIDE_MS : 0);
        g.fxLog(`⚡ ${caster.data.name} calls another bolt down on ${pack.length} foe${pack.length === 1 ? '' : 's'}.`, 'crit');
        caster.actUsed = true;
      };
      return true;
    }
  },

  /* --- bard --- */
  healingWord: {
    label:'Healing Word', level:1, bonusAction:true,
    desc:'Bonus heal on a wounded ally (1d4 + mod; +1d4 per slot above 1st).',
    recharge:'slot',
    ai:{ when:'hurtAlly', priority:8, hpFrac:0.55 },
    color:0x7cc048,  /* PAL.leaf, the same green as its mote and landing */
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
      /* A soft mote of light drifts across and a hoop of light climbs the body; the
         wound closes as it reaches the top, as with Cure Wounds. */
      game.playAbilityFx(h, 'healingWord', { at:target, spell:true, onImpact: () => {
        if (game.fxBodyEffect) game.fxBodyEffect('healingWord', target);
        later(game, CURE_WOUNDS_HEAL_MS, () => game.healHero(target, amt, h));
      } });
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
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      /* Chaos Bolt: roll a random damage type on each cast (5e). */
      const chaosTypes = Object.keys(CHAOS_BOLT_PALETTES);
      const dmgType = chaosTypes[Math.floor(Math.random() * chaosTypes.length)];
      const d = h.data, amt = roll(2, 8, mod(castAbility(h)) + d.dmgBonus);
      const from = chestOf(game, h);
      const to = onFloor(game, foe, 0.5*(foe.data?.scale || 1.0)+0.4);
      game.markSpellUsed(h, this);
      game.fxLog(`✨ ${d.name} casts Chaos Bolt!`, 'crit');
      /* The rainbow bolt gives nothing away (vfx_animations.json `chaosBolt`);
         where it lands, the burst's colour is the type it rolled. */
      game.playAbilityFx(h, 'chaosBolt', { at:foe, spell:true, fromPos:from, toPos:to, follow:foe, onImpact: () => {
        if (game.fxManaBurst) game.fxManaBurst(foe, CHAOS_BOLT_PALETTES[dmgType]);
        later(game, CHAOS_BOLT_FLASH_MS, () => {
          if (foe.dead) return;
          game.fxLog(`🎲 The bolt erupts in ${dmgType}!`, 'crit');
          game.spellDamage(foe, amt, h, Math.random()<0.15, { dmgType, magical:true });
        });
      } });
      return true;
    }
  },

  dragonBreathSpell: {
    label:'Burning Hands', level:1,
    desc:'15-ft cone of fire: 3d6 (+1d6 per slot above 1st) fire damage to creatures in the cone (Dex save for half).',
    recharge:'slot',
    ai:{ when:'cluster', priority:6, minTargets:2, aoeRadius:3.2 },
    /* 15 ft from the caster, ~31 degrees either side of the aim. */
    area:{ shape:'cone', range:3.2, halfAngle:0.55 },
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
      const { range, halfAngle } = this.area;

      const hit = (game.monsters || []).filter(m => m && !m.dead && m.data?.hp > 0 && m.active !== false
        && isPointInCone(m.x, m.z, h.x, h.z, dx, dz, range, halfAngle));
      game.fxLog(`🔥 ${d.name} casts Burning Hands in a 15-ft cone!`, 'crit');

      /* The flames (vfx_animations.json `dragonBreathSpell`) roar out from the
         caster; everyone caught burns as they reach them. */
      game.playAbilityFx(h, 'dragonBreathSpell', { at:foe, spell:true, onImpact: () => {
        for (const m of hit) {
          if (m.dead || m.data?.hp <= 0) continue;
          let dmg = roll(diceCount, 6, d.dmgBonus);
          if (game.spellSave(m, 'dex', dc, { magic:true })) dmg = Math.floor(dmg / 2);
          game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
        }
      } });
      return true;
    }
  },

  /* --- warlock --- */
  hex: {
    label:'Hex', level:1, concentration:true, bonusAction:true,
    desc:'Curse a foe: +1d6 damage on your hits; when it falls, a bonus action moves the hex (concentration).',
    recharge:'short',
    ai:{ when:'eliteOrBoss', priority:7 },
    color:0x9b59b6,
    cast(game, h, foe) {
      game.markSpellUsed(h, this);
      /* No flight: wisps gather over the target and a skull stamps down, and the curse
         takes hold with the stamp (pixelfx shadow/curse, on its own sprite). */
      if (game.fxBodyEffect) game.fxBodyEffect('hexCurse', foe);
      game.playAbilityFx(h, 'hex', { at:foe, spell:true });
      game.fxLog(`🔮 ${h.data.name} casts Hex on ${foe.data.name}!`, 'crit');
      later(game, HEX_STAMP_MS, () => {
        if (!h.data || h.data.hp <= 0 || foe.dead) return;
        applyEffect(foe, 'hexMarked', { duration:120, elapsed: game.fxNow, source:h });
        game.concentrate(h, 'hex', [{ e:foe, key:'hexMarked' }]);
      });
      return true;
    }
  },

  armsOfHadar: {
    label:'Arms of Hadar', level:1,
    desc:'Dark tentacles: 2d6 to nearby foes.',
    recharge:'slot',
    ai:{ when:'cluster', priority:6, minTargets:2 , aoeRadius:ARMS_OF_HADAR_RADIUS},
    dmgType:'necrotic',
    color:0x6a3080,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, ARMS_OF_HADAR_RADIUS);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      /* One effect at the AoE's centre — the point clusterAround measured from
         (the AI's chosen blast point when it set one, else `foe`); no `alsoAt`,
         which replayed the whole sheet on every foe. Under the upright tentacles,
         the flat void they rise from (pfx/hadar_portal.js), its rim on the
         spell's radius so it reads from any camera angle. */
      const center = game._aoeCenter || foe;
      game.playAbilityFx(h, 'armsOfHadar', { at:center, spell:true, ring:2.0, scale:2.0, focus:foes,
        onImpact: (pos) => { if (game.fxHadarPortal) game.fxHadarPortal(pos.x, pos.z, ARMS_OF_HADAR_RADIUS); } });
      game.fxLog(`🟣 ${d.name} casts Arms of Hadar!`, 'crit');
      /* The pool opens first; the hit comes with the tentacles lashing up. */
      later(game, ARMS_OF_HADAR_LASH_MS, () => {
        for (const m of foes) if (!m.dead) game.spellDamage(m, roll(2,6,d.dmgBonus), h, false, { dmgType:this.dmgType, magical:true });
      });
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
    color:0x7cc8ff,
    cast(game, h) {
      game.markSpellUsed(h, this);
      h.smiteNext = true;
      game.playAbilityFx(h, 'thunderousSmite', { at:h, spell:true });
      /* The hero shows it's held ready; buildAttackOpts takes this off with the swing that spends it. */
      later(game, 0, () => {
        if (!game.fxBodyEffect || !h.smiteNext) return;
        if (h._smiteFx) h._smiteFx.remove();
        h._smiteFx = game.fxBodyEffect('smiteReady', h);
      });
      game.fxLog(`⚡ ${h.data.name} readies Thunderous Smite!`, 'crit');
      return true;
    }
  },

  huntersMark: {
    label:"Hunter's Mark", level:1, concentration:true, bonusAction:true,
    desc:'Mark prey: +1d6 damage on your hits; when it falls, a bonus action moves the mark (concentration).',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7 },
    color:0xc02424,
    cast(game, h, foe) {
      game.markSpellUsed(h, this);
      /* No flight: brackets snap in round the prey, and the mark takes with the lock. */
      if (game.fxBodyEffect) game.fxBodyEffect('huntersReticle', foe);
      game.playAbilityFx(h, 'huntersMark', { at:foe, spell:true });
      game.fxLog(`🎯 ${h.data.name} marks ${foe.data.name}!`, 'crit');
      later(game, MARK_LOCK_MS, () => {
        if (!h.data || h.data.hp <= 0 || foe.dead) return;
        applyEffect(foe, 'huntersMarked', { duration:120, elapsed: game.fxNow, source:h });
        game.concentrate(h, 'huntersMark', [{ e:foe, key:'huntersMarked' }]);
      });
      return true;
    }
  },

  /* ============ NEW CONDITION-BASED SPELLS ============ */

  blindness: {
    label:'Blindness/Deafness', level:2,
    desc:'Blind a foe (CON save). Disadv on atks; enemies get adv to hit.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:6, minCombatRound:1 },
    color:0x888899,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      /* A dark mote drifts across; the save is made when it lands. */
      game.playAbilityFx(h, 'blindness', { at:foe, spell:true, onImpact: () => {
        if (foe.dead) return;
        if (game.spellSave(foe, 'con', dc, { magic:true })) {
          game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
          game.fxLog(`🧿 ${foe.data.name} resists Blindness!`, 'miss', { cat: 'effect' });
        } else {
          applyEffect(foe, 'blinded', { duration:60, elapsed: game.fxNow, source:h,
            repeatSave:{ ability:'con', dc, every:ROUND_SECONDS } });
          game.fxLog(`🧿 ${h.data.name} blinds ${foe.data.name}!`, 'crit', { cat: 'effect' });
        }
      } });
      return true;
    }
  },

  holdPerson: {
    label:'Hold Person', level:2, concentration:true,
    desc:'Paralyze a foe (WIS save, repeats each round). Melee hits auto-crit.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:8, minCombatRound:1 },
    color:0x8090c0,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      /* A violet mote crosses; the save is made when it lands. Crystal jaws slam shut on the target as
         the rime spreads, or stop short and shatter if it resists. */
      game.playAbilityFx(h, 'holdPerson', { at:foe, spell:true, onImpact: () => {
        if (foe.dead || h.data.hp <= 0) return;
        const held = !game.spellSave(foe, 'wis', dc, { magic:true })
          && applyEffect(foe, 'paralyzed', { duration:60, elapsed: game.fxNow, source:h,
            repeatSave:{ ability:'wis', dc, every:ROUND_SECONDS } });
        if (game.fxBodyEffect) game.fxBodyEffect(held ? 'holdClamp' : 'holdBreak', foe);
        if (held) {
          game.concentrate(h, 'holdPerson', [{ e:foe, key:'paralyzed' }]);
          game.fxLog(`🔗 ${h.data.name} paralyzes ${foe.data.name}!`, 'crit', { cat: 'effect' });
        } else {
          game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
          game.fxLog(`🔗 ${foe.data.name} resists Hold Person!`, 'miss', { cat: 'effect' });
        }
      } });
      return true;
    }
  },

  sleep: {
    label:'Sleep', level:1,
    desc:'Put foes to sleep by HP pool (5d8 + 2d8 per slot level above 1st; no save). Unconscious foes cannot act.',
    recharge:'slot',
    ai:{ when:'any', priority:4, minCombatRound:1 },
    color:0x6688aa,
    cast(game, h, foe, alive, slotLevel = 1) {
      if (!foe || foe.dead) return false;
      game.markSpellUsed(h, this);

      const poolDice = 5 + Math.max(0, (slotLevel || 1) - 1) * 2;
      let hpPool = roll(poolDice, 8);
      game.fxLog(`💤 ${h.data.name} rolls ${hpPool} HP pool for Sleep!`, 'buff', { cat: 'effect' });

      const foes = (h._side === 'mon' ? game.heroes : game.monsters)
        .filter(m => m.data && m.data.hp > 0 && m.active !== false)
        .sort((a, b) => a.data.hp - b.data.hp);

      const slept = [];
      for (const m of foes) {
        if (m.data.hp <= hpPool) {
          hpPool -= m.data.hp;
          slept.push(m);
        }
      }
      game.playAbilityFx(h, 'sleep', { at: slept[0] || foe, spell:true });
      /* A night-blue rune circle opens under each one the pool covers (under the target
         alone if it covers nobody), and they drop as it turns, the Zs rising out of it. */
      later(game, 0, () => {
        if (game.fxWardCircle) for (const m of (slept.length ? slept : [foe])) game.fxWardCircle(m, 'hush');
      });
      later(game, SLEEP_TAKES_MS, () => {
        for (const m of slept) {
          if (m.dead) continue;
          applyEffect(m, 'unconscious', { duration:60, elapsed: game.fxNow, source:h });
          game.fxLog(`💤 ${m.data.name} falls asleep!`, 'crit', { cat: 'effect' });
        }
      });
      if (slept.length === 0) {
        game.fxLog(`💤 Sleep had no effect (target HP exceeds pool).`, 'miss');
      }
      return true;
    }
  },

  fear: {
    label:'Fear', level:3, concentration:true,
    desc:'Frighten foes (WIS save, repeats each round): disadvantage on attacks.',
    recharge:'slot',
    ai:{ when:'cluster', priority:7, minTargets:2, minCombatRound:1 , aoeRadius:3},
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
                repeatSave:{ ability:'wis', dc, every:ROUND_SECONDS } }))
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
    ai:{ when:'cluster', priority:6, minTargets:2, minCombatRound:1 , aoeRadius:3},
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
    ai:{ when:'cluster', priority:5, minTargets:2, minCombatRound:1 , aoeRadius:2.5},
    color:0xc01c28,
    cast(game, h, foe) {
      const d = h.data, foes = clusterAround(game, foe, 2.5);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      /* A sigil drawn in the air over the foes, filling most of the area; the
         curse lands when it flares. */
      game.playAbilityFx(h, 'bane', { at:foe, spell:true });
      game.fxLog(`🧿 ${d.name} casts Bane!`, 'crit');
      later(game, BANE_FLARE_MS, () => {
        if (!d || d.hp <= 0) return;
        const applied = [];
        for (const m of foes) {
          if (m.dead) continue;
          if (!game.spellSave(m, 'cha', dc, { magic:true })
              && applyEffect(m, 'baned', { duration:60, elapsed: game.fxNow, source:h }))
            applied.push({ e:m, key:'baned' });
        }
        game.concentrate(h, 'bane', applied);
      });
      return true;
    }
  },

  faerieFire: {
    label:'Faerie Fire', level:1, concentration:true,
    desc:'DEX save. Outline foes — attacks against them have advantage.',
    recharge:'slot',
    ai:{ when:'cluster', priority:5, minTargets:2, minCombatRound:1 , aoeRadius:2.5},
    color:0xb08cff,
    cast(game, h, foe) {
      if (!foe) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const x = foe.x, z = foe.z;
      game.playAbilityFx(h, 'faerieFire', { at:foe, spell:true });
      game.fxLog(`✨ ${h.data.name} casts Faerie Fire!`, 'crit');
      later(game, 0, () => { if (game.fxFaerieStars) game.fxFaerieStars(x, z); });

      /* As the first stars land the area lights, and whoever fails the save is
         outlined. The zone goes on marking foes that enter it (aoe_system.js). */
      later(game, FAERIE_STARS_LAND_MS, () => {
        if (!h.data || h.data.hp <= 0) return;
        const zone = game.spawnAoEZone(h, 'faerieFire', x, z, 2.5, {
          color: this.color, dur: 60,
          lightColor: 0xb08cff,
          lightIntensity: 1.2,
          lightRange: 5.0
        });
        if (zone && game.fxFaerieSparkle) zone.liveFx = game.fxFaerieSparkle(x, z);

        const applied = [];
        for (const m of clusterAround(game, { x, z }, 2.5)) {
          if (m.dead) continue;
          if (!game.spellSave(m, 'dex', dc, { magic:true })
              && applyEffect(m, 'faerieFire', { duration:60, elapsed: game.fxNow, source:h }))
            applied.push({ e:m, key:'faerieFire' });
        }
        game.concentrate(h, 'faerieFire', applied, zone);
      });
      return true;
    }
  },

  rayOfEnfeeblement: {
    label:'Ray of Enfeeblement', level:2, concentration:true,
    desc:'Halve a foe\'s damage (CON save, repeats each round; concentration).',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7, minCombatRound:1 },
    color:0xd0a080,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      const d = h.data, from = chestOf(game, h);
      const to = onFloor(game, foe, 0.5 * (foe.data?.scale || 1.0) + 0.4);
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
              repeatSave: { ability: 'con', dc, every: ROUND_SECONDS } });
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
    ai:{ when:'cluster', priority:6, minTargets:2, minCombatRound:1 , aoeRadius:2.5},
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
                  repeatSave:{ ability:'str', dc, every:ROUND_SECONDS } }))
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
    ai:{ when:'eliteOrBoss', priority:7, minCombatRound:1 },
    color:0xe8a8ff,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      /* A soft mote drifts across; the save is made when it lands. */
      game.playAbilityFx(h, 'hideousLaughter', { at:foe, spell:true, onImpact: () => {
        if (foe.dead) return;
        if (game.spellSave(foe, 'wis', dc, { magic:true })) {
          game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
          game.fxLog(`😂 ${foe.data.name} resists Laughter!`, 'miss');
        } else {
          applyEffect(foe, 'prone', { duration:60, elapsed: game.fxNow, source:h,
            repeatSave:{ ability:'wis', dc, every:ROUND_SECONDS } });
          applyEffect(foe, 'incapacitated', { duration:60, elapsed: game.fxNow, source:h, data:{ aura:'laughing' },
            repeatSave:{ ability:'wis', dc, every:ROUND_SECONDS } });
          game.concentrate(h, 'hideousLaughter', [{ e:foe, key:'prone' }, { e:foe, key:'incapacitated' }]);
          game.fxLog(`😂 ${h.data.name} incapacitates ${foe.data.name} with laughter!`, 'crit');
        }
      } });
      return true;
    }
  },

  lesserRestoration: {
    label:'Lesser Restoration', level:2,
    desc:'Cure an ally of blindness, deafness, paralysis, or poison.',
    recharge:'slot',
    ai:{ when:'hurtAlly', priority:6, hpFrac:0.6, minCombatRound:1 },
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
      game.fxLog(`✨ ${h.data.name} casts Lesser Restoration on ${target.data.name}!`, 'buff');
      /* A pale mote crosses; where it lands the affliction lifts off them. */
      game.playAbilityFx(h, 'lesserRestoration', { at:target, spell:true, onImpact: () => {
        if (h.data.hp <= 0 || target.data.hp <= 0) return;
        for (const c of curable) clearEffect(target, c);
        if (game.fxBodyEffect) game.fxBodyEffect('afflictionLift', target);
      } });
      return true;
    }
  },

  greaterRestoration: {
    label:'Greater Restoration', level:5,
    desc:'Purge all harmful conditions from an ally.',
    recharge:'long',
    ai:{ when:'hurtAlly', priority:9, hpFrac:0.4, minCombatRound:2 },
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
    desc:'Cleanse charmed/frightened; immune to both for 10 rounds.',
    recharge:'slot',
    ai:{ when:'selfHurt', priority:6, hpFrac:0.45, minCombatRound:1 },
    color:0xffe08a,
    cast(game, h) {
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'protectionFromEvil', { at:h, spell:true });
      game.fxLog(`🛡 ${h.data.name} casts Protection from Evil — cleansed and warded for 10 rounds!`, 'buff');
      /* A rune circle opens under the caster; as it turns, the ward rises out of it. */
      later(game, 0, () => { if (game.fxWardCircle) game.fxWardCircle(h); });
      later(game, WARD_RISES_MS, () => {
        if (!h.data || h.data.hp <= 0) return;
        clearEffect(h, 'charmed');
        clearEffect(h, 'frightened');
        /* the "immune" half of the spell — applyEffect refuses charm/fear while warded */
        applyEffect(h, 'warded', { duration:ROUND_SECONDS * 10, elapsed: game.fxNow, source:h });
      });
      return true;
    }
  },

  /* ============ EXTENDED SPELL LIST ============ */

  /* ── Level 1 ── */
  grease: {
    label:'Grease', level:1,
    desc:'Slick area knocks foes prone (DEX save).',
    recharge:'slot',
    ai:{ when:'cluster', priority:4, minTargets:2, minCombatRound:1 , aoeRadius:2.5},
    color:0xbfa060,
    cast(game, h, foe) {
      if (!foe) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const x = foe.x, z = foe.z;
      game.playAbilityFx(h, 'grease', { at:foe, spell:true });
      game.fxLog(`🛢 ${h.data.name} casts Grease!`, 'crit');

      /* No flight: the slick spreads out from the middle when the charge ends. It
         lasts 60 s without concentration, and fades with its zone. */
      later(game, 0, () => {
        const zone = game.spawnAoEZone(h, 'grease', x, z, 2.5, {
          color: this.color, dur: 60, pointLight: false,
        });
        if (zone && game.fxGreaseSlick) zone.liveFx = game.fxGreaseSlick(x, z);
      });
      /* Foes lose their footing as it runs under them. */
      later(game, GREASE_SPREAD_MS, () => {
        for (const m of clusterAround(game, { x, z }, 2.5)) {
          if (m.dead) continue;
          if (!game.spellSave(m, 'dex', dc, { magic:true }))
            applyEffect(m, 'prone', { duration:ROUND_SECONDS, elapsed: game.fxNow, source:h });
        }
      });
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
      playReap(game, h, foe);
      /* the blow lands on the burst's flash */
      later(game, REAP_BURST_MS + CHAOS_BOLT_FLASH_MS, () => {
        if (!foe.dead) game.spellDamage(foe, amt, h, false, { dmgType:this.dmgType, magical:true });
      });
      game.fxLog(`💀 ${d.name} casts Inflict Wounds on ${foe.data.name}!`, 'crit');
      return true;
    }
  },

  /* ── Level 2 ── */
  acidArrow: {
    label:'Acid Arrow', level:2,
    desc:'Corrosive bolt: 4d4 acid (+1d4 per slot above 2nd) to a single foe, and 2d4 more acid a round later.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:6, minCombatRound:1 },
    dmgType:'acid',
    color:0x4cae4c,
    cast(game, h, foe, alive, slotLevel = 2) {
      if (!foe || foe.dead) return false;
      const d = h.data, from = chestOf(game, h);
      const to = onFloor(game, foe, 0.5*(foe.data?.scale || 1.0)+0.4);
      const diceCount = 4 + Math.max(0, (slotLevel || 2) - 2);
      const amt = roll(diceCount, 4, d.dmgBonus);
      game.markSpellUsed(h, this);
      /* A green arrow over a twisting ribbon (vfx_animations.json `acidArrow`) that was never
         solid: it bursts as liquid where it strikes. 5e: 2d4 more acid a round later. */
      game.playAbilityFx(h, 'acidArrow', { at:foe, spell:true, fromPos:from, toPos:to, onImpact: () => {
        if (game.fxAcidSplat) game.fxAcidSplat(to, h);
        if (game.fxPlaySfx) game.fxPlaySfx('spellImpact', { volume: 0.75 });
        if (foe.dead) return;
        game.spellDamage(foe, amt, h, false, { dmgType:this.dmgType, magical:true });
        if (foe.dead || (foe.data && foe.data.hp <= 0)) return;
        foe.acid = { dmg: roll(2, 4), src: h, clock: game.fxNow };
        applyEffect(foe, 'acidCoated', { duration:ROUND_SECONDS, elapsed: game.fxNow, source:h });
      } });
      game.fxLog(`🧪 ${d.name} casts Acid Arrow!`, 'crit');
      return true;
    }
  },

  mistyStep: {
    label:'Misty Step', level:2, bonusAction:true,
    desc:'Bonus action: teleport up to 30 ft (6 tiles) to a space you can see, away from your foes.',
    recharge:'short',
    ai:{ when:'selfHurt', priority:7, hpFrac:0.35 },
    color:0x8fd4e8,
    cast(game, h) {
      /* A movement spell, not a buff: 5e Misty Step is "teleport up to 30 feet
         to an unoccupied space you can see". The AI casts it when hurt, so the
         landing spot is the one that gets furthest from the nearest foe. */
      const cell = game.escapeTeleportCell ? game.escapeTeleportCell(h, 6, true) : -1;
      if (cell < 0) return false;                       // nowhere better to go — keep the slot
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'mistyStep', { at:h, spell:true });
      game.fxLog(`💨 ${h.data.name} vanishes in silver mist and reappears out of reach!`, 'buff');
      /* Blinks out where they stand, and in at the far side: they cross as the line of light pops. */
      later(game, 0, () => {
        const cross = () => {
          if (h.data.hp <= 0) return;
          /* someone may have stepped onto the tile during the blink */
          const taken = game.isCellOccupiedAny && game.isCellOccupiedAny(cell, h);
          const to = taken ? game.escapeTeleportCell(h, 6, true) : cell;
          if (to >= 0) game.teleportEntity(h, to);
          game.playAbilityFx(h, 'mistyStep', { at:h });
        };
        if (h.data.hp > 0 && game.fxBlinkStep) game.fxBlinkStep(h, cross);
        else cross();
      });
      return true;
    }
  },

  silence: {
    label:'Silence', level:2,
    desc:'A sphere of silence: foes caught in it cannot cast spells for 3 rounds (no save).',
    recharge:'slot',
    ai:{ when:'cluster', priority:6, minTargets:2, minCombatRound:1 , aoeRadius:2.5},
    color:0x888899,
    cast(game, h, foe) {
      const foes = clusterAround(game, foe, 2.5);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'silence', { at:foe, alsoAt:foes, spell:true, ring:2.2 });
      /* No verbal components inside the sphere: the effect gates spellcasting
         in tryMonsterCycleAbility. Non-casters are unaffected, as in 5e. */
      let hushed = 0;
      for (const m of foes) {
        if (m.dead) continue;
        if (applyEffect(m, 'silenced', { duration:ROUND_SECONDS * 3, elapsed: game.fxNow, source:h })) hushed++;
      }
      game.fxLog(`🔇 ${h.data.name} casts Silence — ${hushed} foe${hushed === 1 ? '' : 's'} cannot cast spells for 3 rounds!`, 'crit');
      return true;
    }
  },

  /* ── Level 3 ── */
  bestowCurse: {
    label:'Bestow Curse', level:3, concentration:true,
    desc:'Random strong debuff: weakened, slowed, or baned (WIS save; concentration).',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7, minCombatRound:1 },
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
    /* The footprint the AI aims with (turn_planner.spellArea) — the same
       100-ft x 5-ft line the cast below resolves. */
    area:{ shape:'line', length:20, width:1 },
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

      const from = chestOf(game, h);
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
    ai:{ when:'hurtAlly', priority:9, hpFrac:0.5, minCombatRound:1 },
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
        game.healHero(a, amt, h);
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
    ai:{ when:'selfHurt', priority:7, hpFrac:0.45, minCombatRound:1 },
    dmgType:'necrotic',
    color:0xc04040,
    cast(game, h, foe, alive, slotLevel = 3) {
      if (!foe || foe.dead) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const from = chestOf(game, h);
      const to = onFloor(game, foe, 0.5 * (foe.data?.scale || 1.0) + 0.4);

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
      game.healHero(h, heal, h);
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
    ai:{ when:'cluster', priority:9, minTargets:3, minCombatRound:1, aoeRadius:3.0 },
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
      /* One hailstorm over the whole blast (vfx_animations.json `iceStorm`:
         three ice-palette Starfalls layered into one sheet), not one per
         creature; the damage lands with the first wave of impacts. */
      game.playAbilityFx(h, 'iceStorm', { at: center, spell: true, ring: 3.0, scale: 2.4 });
      game.fxLog(`❄ ${d.name} casts Ice Storm!`, 'crit');

      later(game, ICE_STORM_HIT_MS, () => {
        for (const m of foes) {
          if (m.dead) continue;
          const saved = game.spellSave(m, 'dex', dc, { magic:true });
          const mul = saved ? 0.5 : 1;
          game.spellDamage(m, Math.floor(roll(2, 8, d.dmgBonus) * mul), h, false, { dmgType:'bludgeoning', magical:true });
          game.spellDamage(m, Math.floor(roll(coldDice, 6, d.dmgBonus) * mul), h, false, { dmgType:'cold', magical:true });
          if (!saved) applyEffect(m, 'slowed', { duration:ROUND_SECONDS, elapsed: game.fxNow, source:h });
        }
      });
      return true;
    }
  },

  blight: {
    label:'Blight', level:4,
    desc:'Necromantic drain: 8d8 necrotic (+1d8 per slot above 4th, CON save half). No effect on undead/constructs.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:9, minCombatRound:2 },
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

      /* Wisps gather over the target, a skull stamps down, and the blight
         floods the target's own body necrotic green before the skull cracks and
         crumbles (pixelfx shadow/curse painted onto its sprite — render/body_fx.js);
         the damage lands with the skull. */
      if (game.fxBodyEffect) game.fxBodyEffect('blight', foe);
      const dc = spellDC(h);
      const diceCount = 8 + Math.max(0, (slotLevel || 4) - 4);
      game.fxLog(`🟣 ${d.name} casts Blight on ${foe.data.name}!`, 'crit');
      later(game, BLIGHT_HIT_MS, () => {
        if (foe.dead) return;
        let dmg = roll(diceCount, 8, d.dmgBonus);
        if (game.spellSave(foe, 'con', dc, { magic:true })) dmg = Math.floor(dmg / 2);
        game.spellDamage(foe, dmg, h, false, { dmgType:this.dmgType, magical:true });
      });
      return true;
    }
  },

  deathWard: {
    label:'Death Ward', level:4,
    desc:'Protect an ally: next time they go down, survive at 1 HP instead.',
    recharge:'long',
    ai:{ when:'hurtAlly', priority:9, hpFrac:0.25, minCombatRound:2 },
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
    ai:{ when:'cluster', priority:8, minTargets:2, minCombatRound:1, aoeRadius:6.0 },
    area:{ shape:'line', length:12, width:1 },   // 60-ft line, as cast below
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
    ai:{ when:'cluster', priority:9, minTargets:2, minCombatRound:1, aoeRadius:8.0 },
    /* 60 ft from the caster, ~31 degrees either side of the aim. */
    area:{ shape:'cone', range:12.0, halfAngle:0.55 },
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
      const { range, halfAngle } = this.area;

      const hit = (game.monsters || []).filter(m => m && !m.dead && m.data?.hp > 0 && m.active !== false
        && isPointInCone(m.x, m.z, h.x, h.z, dx, dz, range, halfAngle));
      game.fxLog(`❄️ ${d.name} blasts a 60-ft Cone of Cold!`, 'crit');

      /* The frost (vfx_animations.json `coneOfCold`) rolls out from the caster
         to the target; everyone caught freezes, and takes the damage, as it lands. */
      game.playAbilityFx(h, 'coneOfCold', { at:foe, alsoAt:hit, spell:true, ring:2.8, scale:2.6, onImpact: () => {
        for (const m of hit) {
          if (m.dead || m.data?.hp <= 0) continue;
          let dmg = roll(diceCount, 8, d.dmgBonus);
          if (game.spellSave(m, 'con', dc, { magic:true })) dmg = Math.floor(dmg / 2);
          game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
        }
      } });
      return true;
    }
  },

  flameStrike: {
    label:'Flame Strike', level:5,
    desc:'Divine fire column: 4d6 fire + 4d6 radiant (+1d6 each per slot above 5th).',
    recharge:'slot',
    ai:{ when:'cluster', priority:9, minTargets:2, minCombatRound:2 , aoeRadius:2.5},
    dmgType:'radiant',
    color:0xffd34a,
    cast(game, h, foe, alive, slotLevel = 5) {
      const d = h.data, foes = clusterAround(game, foe, 2.5);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const upBonus = Math.max(0, (slotLevel || 5) - 5);
      const from = game._v3(foe.x, 7.0, foe.z);
      const to = onFloor(game, foe, 0.4 * (foe.data?.scale || 1.0) + 0.3);

      game.playAbilityFx(h, 'flameStrike', { at:foe, alsoAt:foes, spell:true, ring:2.5, scale:2.4 });
      game.fxLog(`🔥 ${d.name} calls down Flame Strike!`, 'crit');

      game.fxBeam(from, to, {
        type: 'pillar', flame: true,
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
    ai:{ when:'hurtAlly', priority:10, hpFrac:0.35, minCombatRound:2 },
    color:0x6ae06a,
    cast(game, h, _, alive, slotLevel = 5) {
      const d = h.data;
      const targets = alive.concat(game.heroes.filter(x => x.data.hp <= 0));
      game.markSpellUsed(h, this);
      const diceCount = 3 + Math.max(0, (slotLevel || 5) - 5);
      for (const a of targets) {
        const amt = roll(diceCount, 8, mod(castAbility(h)) + d.healBonus);
        game.healHero(a, amt, h);
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
    ai:{ when:'eliteOrBoss', priority:9, minCombatRound:2 },
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
          repeatSave:{ ability:'wis', dc, every:ROUND_SECONDS } });
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
      const d = h.data, from = chestOf(game, h);
      const to = onFloor(game, foe, 0.5 * (foe.data?.scale || 1.0) + 0.4);
      const diceCount = 4 + Math.max(0, (slotLevel || 1) - 1);
      const amt = roll(diceCount, 6, d.dmgBonus);
      game.markSpellUsed(h, this);

      /* A thrown bolt of light (vfx_animations.json `guidingBolt`). When it
         lands: the damage, and the mark — next attack against this foe has
         advantage, and it glitters in bright yellow until then. */
      game.playAbilityFx(h, 'guidingBolt', { at:foe, spell:true, fromPos:from, toPos:to, onImpact: () => {
        if (foe.dead) return;
        game.spellDamage(foe, amt, h, false, { dmgType:this.dmgType, magical:true });
        if (!foe.dead) applyEffect(foe, 'guided', { duration:ROUND_SECONDS, elapsed: game.fxNow, source:h });
      } });
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
    color:0x7cc8ff,
    cast(game, h, foe, alive, slotLevel = 1) {
      const d = h.data, foes = clusterAround(game, h, 3.0);
      if (!foes.length) return false;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      const diceCount = 2 + Math.max(0, (slotLevel || 1) - 1);
      game.playAbilityFx(h, 'thunderwave', { at:h, spell:true });
      game.fxLog(`💥 ${d.name} casts Thunderwave!`, 'crit');
      later(game, 0, () => { if (game.fxThunderclap) game.fxThunderclap(h); });
      /* The wave reaches each foe in turn, and that's when it hurts and throws them. */
      for (const m of foes) {
        const dist = Math.hypot(m.x - h.x, m.z - h.z);
        later(game, (THUNDERCLAP_RING_DELAY + shockArrives(dist * THUNDERWAVE_PX_PER_UNIT)) * 1000, () => {
          if (m.dead) return;
          const saved = game.spellSave(m, 'con', dc, { magic:true });
          let dmg = roll(diceCount, 8, d.dmgBonus);
          if (saved) {
            dmg = Math.floor(dmg / 2);
          } else {
            // Push foe 2 cells (10 ft) away from caster, stopping at walls/bodies.
            if (typeof game.pushEntity === 'function') {
              game.pushEntity(m, h.x, h.z, 2, 1);
            } else {
              const away = Math.hypot(m.x - h.x, m.z - h.z) || 1.0;
              m.x += ((m.x - h.x) / away) * 2.0;
              m.z += ((m.z - h.z) / away) * 2.0;
            }
          }
          game.spellDamage(m, dmg, h, false, { dmgType:this.dmgType, magical:true });
        });
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
      /* The hoop of light climbs the body; the wound closes as it reaches the top. */
      if (game.fxBodyEffect) game.fxBodyEffect('cureWounds', target);
      game.playAbilityFx(h, 'cureWounds', { at:target, spell:true });
      later(game, CURE_WOUNDS_HEAL_MS, () => game.healHero(target, amt, h));
      game.fxLog(`💚 ${d.name} casts Cure Wounds on ${target.data.name} (+${amt}).`, 'heal');
      return true;
    }
  },

  shieldOfFaith: {
    label:'Shield of Faith', level:1, bonusAction:true, concentration:true,
    desc:'+2 AC on a hard-pressed ally (concentration).',
    recharge:'slot',
    ai:{ when:'hurtAlly', priority:6, hpFrac:0.6, buffEffect:'shieldOfFaith', buffTarget:'ally' },
    color:0xf5c84c,
    cast(game, h, foe, alive) {
      /* Ward the ally it was aimed at, else the most-wounded one that isn't already shielded. */
      let worst = (foe && foe._side === 'hero' && !hasEffect(foe, 'shieldOfFaith')) ? foe : null, wf = 1;
      if (!worst) for (const a of alive) {
        if (hasEffect(a, 'shieldOfFaith')) continue;
        const f = a.data.hp / a.data.maxHp;
        if (f < wf) { wf = f; worst = a; }
      }
      if (!worst) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'shieldOfFaith', { at:worst, spell:true });
      /* All the spell shows is its status: the bubble grows when the charge ends. */
      later(game, 0, () => {
        if (!h.data || h.data.hp <= 0 || !worst.data || worst.data.hp <= 0) return;
        applyEffect(worst, 'shieldOfFaith', { duration:60, elapsed: game.fxNow });
        game.concentrate(h, 'shieldOfFaith', [{ e:worst, key:'shieldOfFaith' }]);
      });
      game.fxLog(`🛡 ${h.data.name} casts Shield of Faith on ${worst.data.name}! (+2 AC)`, 'buff');
      return true;
    }
  },

  magicWeapon: {
    label:'Magic Weapon', level:2, concentration:true,
    desc:'Imbue your weapon with magic: +1 atk/dmg and bypasses nonmagical resistance.',
    recharge:'slot',
    ai:{ when:'any', priority:5, minCombatRound:1, buffEffect:'magicWeapon', buffTarget:'self' },
    color:0xb08cff,
    cast(game, h) {
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'magicWeapon', { at:h, spell:true });
      game.fxLog(`✨ ${h.data.name}'s weapon glows with magic! (+1)`, 'buff');
      /* Takes hold as the charge ends: the weapon flares violet and keeps glowing (sprite_animator.js). */
      later(game, 0, () => {
        if (h.data.hp <= 0) return;
        applyEffect(h, 'magicWeapon', { duration:60, elapsed: game.fxNow, source:h });
        game.concentrate(h, 'magicWeapon', [{ e:h, key:'magicWeapon' }]);
      });
      return true;
    }
  },

  barkskin: {
    label:'Barkskin', level:2, concentration:true,
    desc:'Tough bark on yourself: AC can\'t go below 14 + your spellcasting modifier for 1 min.',
    recharge:'slot',
    ai:{ when:'selfHurt', priority:6, hpFrac:0.5, buffEffect:'barkskin', buffTarget:'self' },
    color:0x6aaa4a,
    cast(game, h) {
      game.markSpellUsed(h, this);
      const floor = 14 + mod(castAbility(h));
      game.playAbilityFx(h, 'barkskin', { at:h, spell:true });
      game.fxLog(`🪵 ${h.data.name}'s skin hardens like bark! (AC ≥ ${floor})`, 'buff');
      /* When the charge ends bark climbs the body, leaving a faint outline for as long as it lasts. */
      later(game, 0, () => {
        if (!h.data || h.data.hp <= 0) return;
        if (game.fxBodyEffect) game.fxBodyEffect('barkCreep', h);
        applyEffect(h, 'barkskin', { duration:60, elapsed: game.fxNow, source:h, data:{ acFloor: floor } });
        game.concentrate(h, 'barkskin', [{ e:h, key:'barkskin' }]);
      });
      return true;
    }
  },

  enlargeReduce: {
    label:'Enlarge', level:2, concentration:true,
    desc:'Magically grow by 50%: +25% damage and +2 bonus damage on attacks.',
    recharge:'slot',
    ai:{ when:'any', priority:6, minCombatRound:1, buffEffect:'enlarged', buffTarget:'ally' },
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
      game.playAbilityFx(h, 'enlargeReduce', { at:best, spell:true });
      game.fxLog(`💪 ${h.data.name} enlarges ${best.data.name}! (+50% size, +25% damage)`, 'buff');
      /* When the charge ends they start to grow, in an aura that fades as they reach full size. The size is all that lasts. */
      later(game, 0, () => {
        if (!h.data || h.data.hp <= 0 || !best.data || best.data.hp <= 0) return;
        if (game.fxBodyEffect) game.fxBodyEffect('growthAura', best);
        applyEffect(best, 'enlarged', { duration:60, elapsed: game.fxNow, source:h });
        game.concentrate(h, 'enlargeReduce', [{ e:best, key:'enlarged' }]);
      });
      return true;
    }
  },
  /* ============ NEW EXPANDED SPELLS & WARLOCK INVOCATIONS ============ */

  eldritchBlast: {
    label:'Eldritch Blast', level:0, cantrip:true,
    desc:'Bolt of crackling force (1d10 force each; +1 bolt at Lvl 5, 11, 17). Augmented by Eldritch Invocations.',
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

      game.fxLog(`🔮 ${d.name} casts Eldritch Blast (${beams} bolt${beams === 1 ? '' : 's'})!`, 'crit');

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
        const delayMs = i * 220;
        let beamTarget = pickProjectileTarget(game, h, foe, allocatedHpMap);
        if (beamTarget) {
          const curEst = allocatedHpMap.get(beamTarget) || beamTarget.data.hp;
          allocatedHpMap.set(beamTarget, curEst - avgBeamDmg);
        }

        later(game, delayMs, () => {
          if (!beamTarget || beamTarget.dead) beamTarget = pickProjectileTarget(game, h, foe);
          if (!beamTarget || beamTarget.dead) return;

          const from = chestOf(game, h);
          const to = onFloor(game, beamTarget, 0.5 * (beamTarget.data?.scale || 1.0) + 0.4);
          const targetRef = beamTarget;

          /* A missile each (vfx_animations.json `eldritchBlast`), homing on its
             own target; the first plays the caster's spellcast. */
          game.playAbilityFx(h, 'eldritchBlast', {
            at:targetRef, fromPos:from, toPos:to, spell:true, noAnim:i > 0, follow:targetRef,
            onImpact: () => {
              if (targetRef.dead) return;
              let dmg = roll(1, 10, d.dmgBonus || 0);
              if (hasAgonizing) dmg += Math.max(0, chaMod);

              game.spellDamage(targetRef, dmg, h, false, { dmgType: this.dmgType, magical: true });

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

  /* Always on, never cast: knowing it is the effect. A steady white light
     shines from the hero for the whole floor (render/dungeon_scene.js reads it
     through light_sources.js heroLightSource), which frees the trinket slot a
     torch would hold. `passive` keeps it out of the AI's spell scoring and the
     manual action menus. */
  light: {
    label:'Light', level:0, cantrip:true, passive:true,
    desc:'A steady white light shines from you, as far as a torch. No torch needed in your trinket slot. On until you put it out — turn it off on the character sheet to hide in the shadows.',
    recharge:'none',
    ai:{ when:'never', priority:0 },
    color:0xe6eeff,
    cast() { return false; }
  },

  /* docs/LIGHT_IDEAS.md 35: up to three motes of dim light, anywhere within
     12 tiles — scouting, or lighting a fight from the back line. */
  dancingLights: {
    label:'Dancing Lights', level:0, cantrip:true, targetType:'self',
    desc:'Three floating motes of dim light (2 tiles each) that stay with you until the floor ends. They follow the party, and in a fight drift each turn to light a foe the party cannot see. Nothing can target or block them.',
    recharge:'none',
    ai:{ when:'never', priority:0 },
    color:0xffd23c,
    cast(game, h, foe, alive, slotLevel, targetPos = null) {
      const at = targetPos || foe || h;
      clearDancingLights(h);
      /* Three wisps (fxWisp, drawn live) that stay for the rest of the floor,
         each carrying its own light. They are not bodies: nothing in the game
         can target or collide with them. They arrive when the cast's charge ends. */
      const motes = DANCING_LIGHT_OFFSETS.map(([dx, dz]) => ({ x: at.x + dx, z: at.z + dz, light: null, wisp: null }));
      h._dancingLights = motes;
      motes.forEach((mote, i) => {
        /* Rules only: what you see is a real light (dungeon_scene.js updatePartyLights). */
        mote.light = addVirtualLight({ follow: mote, bright: 0, dim: 2, color: this.color, glow: false });
        later(game, 0, () => { if (hasVirtualLight(mote.light) && game.fxWisp) mote.wisp = game.fxWisp(mote.x, mote.z, i); });
      });
      game.fxLog(`✨ ${h.data.name} conjures Dancing Lights.`, 'buff');
      return true;
    }
  },

  /* docs/LIGHT_IDEAS.md 31: magical Darkness — no ordinary light reaches
     inside; only Devil's Sight and blindsight see in or out. Your allies
     inside are as blind as the enemy. */
  darkness: {
    label:'Darkness', level:2,
    desc:'Magical darkness fills a 15-ft radius for a minute. No light penetrates it; only Devil\'s Sight and blindsight see in or out — allies inside are blinded too.',
    recharge:'slot',
    ai:{ when:'cluster', priority:4, minTargets:3, minCombatRound:1, aoeRadius:3 },
    color:0x302040,
    cast(game, h, foe) {
      if (!foe) return false;
      game.markSpellUsed(h, this);
      /* A dark mote drifts across; the dome swells from where it lands. */
      game.playAbilityFx(h, 'darkness', { at:foe, spell:true, onImpact: () => {
        addDarkZone({ x: foe.x, z: foe.z, r: 3, ttl: 60, spell: true, dome: true });
      } });
      game.fxLog(`🌑 ${h.data.name} casts Darkness — an inky void swallows the light!`, 'crit');
      return true;
    }
  },

  /* docs/LIGHT_IDEAS.md 32: a 60-ft sphere of bright light that dispels
     magical Darkness it touches. Its sunlight burns vampires. */
  daylight: {
    label:'Daylight', level:3,
    desc:'A 60-ft radius of bright light (and dim beyond) for the rest of the floor. Dispels magical Darkness it overlaps; vampires in it burn.',
    recharge:'slot',
    ai:{ when:'cluster', priority:3, minTargets:2, minCombatRound:1, aoeRadius:6 },
    color:0xfff3c0,
    cast(game, h, foe) {
      const at = foe || h;
      game.markSpellUsed(h, this);
      addVirtualLight({ x: at.x, z: at.z, bright: 12, dim: 24, color: 0xfff3c0, ttl: 600, sunlight: true });
      let dispelled = 0;
      for (const Z of [...DARK_ZONES]) {
        const p = zonePos(Z);
        if (Math.hypot(p.x - at.x, p.z - at.z) > 12 + Z.r) continue;
        DARK_ZONES.delete(Z); dispelled++;
        if (Z.follow) Z.follow._darkZone = 'dispelled';      // a darkmantle stays snuffed
      }
      game.fxLog(`☀️ ${h.data.name} casts Daylight${dispelled ? ' — the magical darkness burns away!' : '!'}`, 'crit');
      return true;
    }
  },

  chillTouch: {
    label:'Chill Touch', level:0, cantrip:true,
    desc:'Ghostly hand of necrotic energy (1d8 necrotic; +1 die at Lvl 5, 11, 17).',
    recharge:'none',
    ai:{ when:'any', priority:7 },
    dmgType:'necrotic',
    color:0x18b4b0,
    cast(game, h, foe) {
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const d = h.data || h;
      const lvl = d.level || 1;
      const diceCount = lvl >= 17 ? 4 : lvl >= 11 ? 3 : lvl >= 5 ? 2 : 1;
      const amt = roll(diceCount, 8, d.dmgBonus || 0);
      const from = chestOf(game, h);
      const to = onFloor(game, foe, 0.5 * (foe.data?.scale || 1.0) + 0.4);

      game.fxLog(`👻 ${d.name} casts Chill Touch!`, 'crit');
      /* A plasma bolt, then snowflakes round the target, in the matrix palette
         (vfx_animations.json `chillTouch`, shared with the sorcerer's basic attack). */
      game.playAbilityFx(h, 'chillTouch', { at: foe, spell: true, fromPos: from, toPos: to, onImpact: () => {
        if (foe.dead) return;
        game.spellDamage(foe, amt, h, false, { dmgType: 'necrotic', magical: true });
      } });
      return true;
    }
  },

  /* Coded and animated, but on no class's list yet: nothing can learn it until
     it joins SPELL_POOLS. */
  viciousMockery: {
    label:'Vicious Mockery', level:0, cantrip:true,
    desc:'Words laced with subtle enchantment (WIS save or 1d4 psychic and disadvantage on attacks until its next turn ends; +1 die at Lvl 5, 11, 17).',
    recharge:'none',
    ai:{ when:'any', priority:7 },
    dmgType:'psychic',
    color:0xf040c0,
    chargeFx:'mockeryRage',       // winds up seething, in place of the gather at the chest
    cast(game, h, foe) {
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const d = h.data || h;
      const lvl = d.level || 1;
      const diceCount = lvl >= 17 ? 4 : lvl >= 11 ? 3 : lvl >= 5 ? 2 : 1;
      const dc = spellDC(h);
      const from = chestOf(game, h);
      const to = onFloor(game, foe, 0.5 * (foe.data?.scale || 1.0) + 0.4);

      game.fxLog(`🎵 ${d.name} hurls a Vicious Mockery at ${foe.data.name}!`, 'crit');
      /* Half a second of rage on the caster (chargeFx), then, if the insult
         lands, half a second of a spinning head on the target. There is no
         flight: vfx_animations.json `viciousMockery` only times the beat and
         plays the sound. */
      game.playAbilityFx(h, 'viciousMockery', { at: foe, spell: true, fromPos: from, toPos: to, onImpact: () => {
        if (foe.dead) return;
        if (game.spellSave(foe, 'wis', dc, { magic: true })) {
          game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
          game.fxLog(`🎵 ${foe.data.name} shrugs off the insult.`, 'miss');
          return;
        }
        game.fxBodyEffect('mockeryConfused', foe);
        game.spellDamage(foe, roll(diceCount, 4, d.dmgBonus || 0), h, false, { dmgType: 'psychic', magical: true });
        if (!foe.dead) applyEffect(foe, 'mocked', { duration: ROUND_SECONDS, elapsed: game.fxNow, source: h });
      } });
      return true;
    }
  },

  chromaticOrb: {
    label:'Chromatic Orb', level:1,
    desc:'Orb of elemental energy: 3d8 (+1d8 per slot above 1st) fire, cold, lightning, acid, or poison.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:7 },
    color:0xff88ee,
    cast(game, h, foe, alive, slotLevel = 1) {
      if (!foe || foe.dead) return false;
      const elements = Object.keys(CHROMATIC_ORB_HIT_MS);
      const dmgType = elements[Math.floor(Math.random() * elements.length)];
      const d = h.data, from = chestOf(game, h);
      const to = onFloor(game, foe, 0.5 * (foe.data?.scale || 1.0) + 0.4);
      const diceCount = 3 + Math.max(0, (slotLevel || 1) - 1);
      const amt = roll(diceCount, 8, d.dmgBonus);
      game.markSpellUsed(h, this);
      /* The orb sheet swells as it flies and comes apart on arrival
         (vfx_animations.json `chromaticOrb`); what it leaves there shows the
         type it rolled, and the blow lands on that effect's flash. */
      game.playAbilityFx(h, 'chromaticOrb', { at:foe, spell:true, fromPos:from, toPos:to, follow:foe, onImpact: () => {
        if (game.fxElementImpact) game.fxElementImpact(foe, dmgType);
        later(game, CHROMATIC_ORB_HIT_MS[dmgType], () => {
          if (game.fxPlaySfx) game.fxPlaySfx('spellImpact', { volume: 0.75 });
          if (!foe.dead) game.spellDamage(foe, amt, h, false, { dmgType, magical:true });
        });
      } });

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
      const d = h.data, from = chestOf(game, h);
      const to = onFloor(game, foe, 0.5 * (foe.data?.scale || 1.0) + 0.4);
      const dc = spellDC(h);
      const diceCount = 2 + Math.max(0, (slotLevel || 1) - 1);
      const amt = roll(diceCount, 8, d.dmgBonus);
      game.markSpellUsed(h, this);
      /* The live-drawn beam and its hit are vfx_animations.json `rayOfSickness`. */
      game.playAbilityFx(h, 'rayOfSickness', { at:foe, spell:true, fromPos:from, toPos:to, onImpact: () => {
        if (foe.dead) return;
        game.spellDamage(foe, amt, h, false, { dmgType:this.dmgType, magical:true });
        if (!game.spellSave(foe, 'con', dc, { magic:true })) {
          applyEffect(foe, 'poisoned', { duration:60, elapsed: game.fxNow, source:h });
          game.fxLog(`🤢 ${foe.data.name} is poisoned by Ray of Sickness!`, 'crit');
        }
      } });
      game.fxLog(`🤢 ${d.name} casts Ray of Sickness!`, 'crit');
      return true;
    }
  },

  flamingSphere: {
    label:'Flaming Sphere', level:2, concentration:true,
    desc:'Summon a ball of fire that fills a tile. Anyone, friend or foe, who ends a turn beside it takes 2d6 fire (+1d6 per slot above 2nd, DEX save half). Bonus action: roll it up to 30 ft; ramming a creature burns them and stops it.',
    recharge:'slot',
    ai:{ when:'cluster', priority:7, minTargets:2 , aoeRadius:1.5},
    color:0xff6600,
    dmgType:'fire',
    cast(game, h, foe, alive, slotLevel = 2) {
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      game.fxLog(`🔥 ${d.name} summons a Flaming Sphere!`, 'crit');
      /* A mote of fire flies over and the sphere takes up a tile beside the target. It deals no damage
         on arrival: as in 5e it burns at the end of a turn beside it, or when rammed (flaming_sphere.js). */
      const body = placeSphereBody(game, h, foe);
      game.playAbilityFx(h, 'flamingSphere', { at:body, spell:true, onImpact:() => {
        if (!d || d.hp <= 0) { if (game.releaseReservation) game.releaseReservation(body); return; }
        const zone = game.spawnAoEZone(h, 'flamingSphere', body.x, body.z, SPHERE_REACH, { color: this.color, dur: 60 });
        if (zone) {
          zone.body = body;
          zone.slotLevel = slotLevel || 2;
          if (game.fxFlamingSphere) zone.liveFx = game.fxFlamingSphere(body.x, body.z);
        }
        game.concentrate(h, 'flamingSphere', [], zone);
      } });
      return true;
    }
  },

  mirrorImage: {
    label:'Mirror Image', level:2,
    desc:'Three illusory duplicates: each attack that would hit you may strike an image instead (10 rounds).',
    recharge:'slot',
    ai:{ when:'selfHurt', priority:7, hpFrac:0.7 },
    color:0x88ccff,
    cast(game, h) {
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'mirrorImage', { at:h, spell:true });
      game.fxLog(`🪞 ${h.data.name} creates 3 Mirror Images!`, 'buff');
      /* As the charge ends the duplicates split out of the body (render/mirror_images.js). */
      later(game, 0, () => {
        if (h.data.hp <= 0) return;
        applyEffect(h, 'mirrorImages', { duration:ROUND_SECONDS * 10, elapsed: game.fxNow, source:h, data: { images: 3 } });
      });
      return true;
    }
  },

  counterspell: {
    label:'Counterspell', level:3, reaction:true,
    desc:'Reaction: when a foe within 12 tiles casts a spell worth stopping, spend a 3rd-level slot to nullify it. Spells above 3rd level need a casting check (d20 + casting modifier vs 10 + spell level). Used automatically.',
    recharge:'slot',
    /* never cast as an action: abjuration.js heroCounterspell fires it as a
       reaction to a monster's spell. As an action it did nothing but burn the slot. */
    ai:{ when:'never', priority:0 },
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
    desc:'Transform a hurt ally into a Giant Ape (+30 temp HP, heavier blows) or a foe into a sheep that is harmless until struck (WIS save; concentration).',
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
        /* the ape's slams: the Enlarge damage profile (it used to apply an
           undefined 'blessed' effect and grant nothing but the temp HP) */
        applyEffect(worstAlly, 'enlarged', { duration:60, elapsed: game.fxNow, source:h });
        game.concentrate(h, 'polymorph', [{ e:worstAlly, key:'enlarged' }]);
        game.playAbilityFx(h, 'polymorph', { at:worstAlly, spell:true, scale:2.4 });
        game.fxLog(`🦍 ${d.name} polymorphs ${worstAlly.data.name} into a Giant Ape (+30 Temp HP)!`, 'buff');
      } else if (foe && !foe.dead) {
        if (game.spellSave(foe, 'wis', dc, { magic:true })) {
          game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
          game.fxLog(`🐑 ${foe.data.name} resists Polymorph!`, 'miss');
        } else {
          /* A sheep: cannot attack, and any real damage pops it back to its
             true form with its HP intact (damageMonster handles the pool).
             Heroes leave it alone while anything else stands (findMonsterTarget). */
          foe._polyHp = 4;
          applyEffect(foe, 'polymorphed', { duration:60, elapsed: game.fxNow, source:h });
          game.concentrate(h, 'polymorph', [{ e:foe, key:'polymorphed' }]);
          game.playAbilityFx(h, 'polymorph', { at:foe, spell:true, scale:2.0 });
          game.fxLog(`🐑 ${d.name} polymorphs ${foe.data.name} into a harmless Sheep!`, 'crit');
        }
      }
      return true;
    }
  },

  dimensionDoor: {
    label:'Dimension Door', level:4,
    desc:'Teleport yourself and the nearest ally up to 60 ft (12 tiles) away from your foes.',
    recharge:'slot',
    ai:{ when:'selfHurt', priority:8, hpFrac:0.3 },
    color:0x90e0ef,
    cast(game, h) {
      /* Line of sight is not required (5e: "a place you can visualize"), so
         the search is the whole 12-tile radius. */
      const cell = game.escapeTeleportCell ? game.escapeTeleportCell(h, 12, false) : -1;
      if (cell < 0) return false;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'dimensionDoor', { at:h, spell:true, scale:2.5 });
      /* the nearest standing ally (within 5 ft in 5e; one tile here) comes along */
      const ally = (game.heroes || [])
        .filter(a => a !== h && a.data && a.data.hp > 0 && Math.hypot(a.x - h.x, a.z - h.z) <= 1.6)
        .sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z))[0] || null;
      game.teleportEntity(h, cell);
      let took = '';
      if (ally) {
        const near = game.teleportCandidates(h, 1, false)[0];
        if (near) { game.teleportEntity(ally, near.cell); took = ` with ${ally.data.name}`; }
      }
      game.playAbilityFx(h, 'dimensionDoor', { at:h, spell:true, scale:1.6 });
      game.fxLog(`🚪 ${h.data.name} steps through a Dimension Door${took}!`, 'buff');
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
    desc:'Animate 5 floating blades that strike a foe for 1d4+4 force each, now and every round as a bonus action while you concentrate.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:9 },
    color:0xffd700,
    dmgType:'force',
    cast(game, h, foe) {
      if (h.conc && h.conc.key === 'animateObjects') return false;   // the blades are already out
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'animateObjects', { at:h, spell:true });
      game.fxLog(`⚔ ${d.name} animates 5 floating blades!`, 'crit');

      const spell = this;
      const volley = (g, caster, tgt) => {
        for (let i = 0; i < 5; i++) {
          const delayMs = i * 100;
          later(g, delayMs, () => {
            if (!tgt || tgt.dead) return;
            const from = g._v3(caster.x + (Math.random() - 0.5) * 2.0, 1.2, caster.z + (Math.random() - 0.5) * 2.0);
            const to = onFloor(g, tgt, 0.5 * (tgt.data?.scale || 1.0) + 0.3);
            g.fxProjectile(from, to, 'bolt', spell.color, () => {
              if (tgt.dead) return;
              const dmg = roll(1, 4, 4 + (caster.data.dmgBonus || 0));
              g.spellDamage(tgt, dmg, caster, false, { dmgType: spell.dmgType, magical: true });
            }, { sheetKey: 'round_sparkle_burst_001_large_blue', scale: 1.2 });
          }, delayMs);
        }
      };
      volley(game, h, foe);
      /* 5e: the objects attack again each round on your bonus action, for
         as long as you concentrate. */
      game.concentrate(h, 'animateObjects', []);
      if (h.conc) h.conc.onTurn = (g, caster) => {
        if (caster._bonusActed) return;
        const tgt = g.findMonsterTarget ? g.findMonsterTarget(caster) : null;
        if (!tgt) return;
        caster._bonusActed = true;
        volley(g, caster, tgt);
        g.fxLog(`⚔ ${caster.data.name}'s blades harry ${tgt.data.name}.`, 'roll');
      };
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
      game.playAbilityFx(h, 'findFamiliar', { at:h, spell:true });

      /* It arrives when the charge ends, unseen until the light opens into its shape. */
      later(game, 0, () => {
        if (!game.summons) return;
        const spawned = game.summons.spawn(h, chosenKind);
        if (spawned) {
          if (game.fxSummonArrival) game.fxSummonArrival(spawned);
          const names = { owlFamiliar: 'Owl 🦉', impFamiliar: 'Imp 👿', viperFamiliar: 'Viper 🐍' };
          game.fxLog(`✨ ${h.data.name} summons an arcane ${names[chosenKind] || 'Familiar'}!`, 'buff');
        }
      });
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
    desc:'Shadows cloak the party: each member is unseen — untargetable and striking with advantage — until they attack (concentration, 10 rounds).',
    recharge:'slot',
    ai:{ when:'any', priority:6 },
    color:0x4a5568,
    cast(game, h) {
      game.markSpellUsed(h, this);
      for (const ally of (game.heroes || [])) {
        if (ally.data && ally.data.hp > 0) {
          applyEffect(ally, 'invisible', { duration: 60, elapsed: game.fxNow, source: h });
        }
      }
      game.playAbilityFx(h, 'shadowStep', { at:h, spell:true, scale:2.0 });
      game.fxLog(`👣 ${h.data.name} casts Pass Without Trace! The party melts into the shadows.`, 'buff');
      game.concentrate(h, 'passWithoutTrace', (game.heroes || []).filter(a => a.data && a.data.hp > 0).map(a => ({ e:a, key:'invisible' })));
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
          applyEffect(ally, 'crusadersMantle', { duration: ROUND_SECONDS * 10, elapsed: game.fxNow, source: h });   // 5e: 1 minute
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
    desc:'Banish a creature to another plane (CHA save negates): it vanishes and cannot act or be touched for up to 10 rounds while you concentrate.',
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
        if (!game.banishMonster(h, foe, 10)) return true;
        game.fxLog(`🌀 ${d.name} banishes ${foe.data.name} from this plane!`, 'crit');
        game.concentrate(h, 'banishment', [{ e:foe, key:'banished' }]);
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

      const from = chestOf(game, h);
      const to = onFloor(game, foe, 0.5 * (foe.data?.scale || 1.0) + 0.3);
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
          const originPos = idx === 0 ? chestOf(game, h) : game._v3(targets[idx - 1].x, 0.5, targets[idx - 1].z);
          const targetPos = onFloor(game, tgt, 0.5 * (tgt.data?.scale || 1.0) + 0.3);
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
      const hBefore = target.data.hp;
      target.data.hp = Math.min(target.data.maxHp, target.data.hp + healAmt);
      if (game.creditHeal) game.creditHeal(h, target.data.hp - hBefore);
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
    area:{ shape:'line', length:12, width:1 },   // 60-ft line, as cast below
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
      /* docs/LIGHT_IDEAS.md 29: the caster blazes with sunlight for the minute */
      addVirtualLight({ follow: h, bright: 6, dim: 12, color: 0xfff3c0, ttl: 60, sunlight: true });

      const from = chestOf(game, h);
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
            applyEffect(m, 'blinded', { duration: ROUND_SECONDS, elapsed: game.fxNow, source: h });
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
      game.playAbilityFx(h, 'inflictWounds', { at: foe, spell: true });
      playReap(game, h, foe);
      game.fxLog(`☣️ ${d.name} casts Harm on ${foe.data.name}!`, 'crit');

      let dmg = roll(14, 6, d.dmgBonus);
      if (game.spellSave(foe, 'con', dc, { magic: true })) dmg = Math.floor(dmg / 2);
      game.spellDamage(foe, dmg, h, false, { dmgType: this.dmgType, magical: true });
      /* 5e: maximum HP is reduced by the damage taken (here: 5 per Drained
         stack, until the creature rests — which a monster never does). */
      if (dmg > 0 && foe.data && foe.data.hp > 0) {
        const stacks = Math.max(1, Math.round(dmg / 5));
        for (let i = 0; i < stacks; i++) applyEffect(foe, 'drained', { elapsed: game.fxNow, source: h });
        foe.data.maxHp = Math.max(1, foe.data.maxHp - stacks * 5);
        foe.data.hp = Math.min(foe.data.hp, foe.data.maxHp);
        game.fxLog(`☣️ ${foe.data.name}'s maximum HP withers by ${stacks * 5}.`, 'roll');
      }
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
      game.playAbilityFx(h, 'inflictWounds', { at: foe, spell: true });
      playReap(game, h, foe);
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
    desc:'Touch restores 4d8+15 HP at once, then 1 HP at the start of every round for the rest of the fight.',
    recharge:'slot',
    ai:{ when:'anyHurt', priority:9, hpFrac:0.5 },
    color:0x10b981,
    cast(game, h) {
      const injured = (game.heroes || []).filter(a => a.data && a.data.hp > 0).sort((a, b) => (a.data.hp / a.data.maxHp) - (b.data.hp / b.data.maxHp));
      const target = injured[0] || h;
      game.markSpellUsed(h, this);
      const burst = roll(4, 8, 15);
      const hBefore = target.data.hp;
      target.data.hp = Math.min(target.data.maxHp, target.data.hp + burst);
      if (game.creditHeal) game.creditHeal(h, target.data.hp - hBefore);
      applyEffect(target, 'regenerating', { duration: 600, elapsed: game.fxNow, source: h });
      if (game.fxBodyEffect) game.fxBodyEffect('cureWounds', target);
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
          /* 5e: blinded 1 minute, CON save at the end of each turn to shake it */
          applyEffect(m, 'blinded', { duration: ROUND_SECONDS * 10, elapsed: game.fxNow, source: h,
            repeatSave:{ ability:'con', dc, every:ROUND_SECONDS } });
        }
        game.spellDamage(m, dmg, h, false, { dmgType: this.dmgType, magical: true });
      }
      return true;
    }
  },

  earthquake: {
    label:'Earthquake', level:8,
    desc:'Violent seismic tremor across a 100-ft radius: 10d6 bludgeoning damage (DEX save half) and knocks those who fail prone.',
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
          applyEffect(m, 'prone', { duration: ROUND_SECONDS, elapsed: game.fxNow, source: h });
        }
        game.spellDamage(m, dmg, h, false, { dmgType: this.dmgType, magical: true });
      }
      return true;
    }
  },

  mindBlank: {
    label:'Mind Blank', level:8, targetType:'party',
    desc:'Total mental ward: the party is immune to charm and fear for the rest of the fight.',
    recharge:'slot',
    ai:{ when:'any', priority:8 },
    color:0x06b6d4,
    cast(game, h) {
      game.markSpellUsed(h, this);
      for (const ally of (game.heroes || [])) {
        if (ally.data && ally.data.hp > 0) {
          clearEffect(ally, 'frightened');
          clearEffect(ally, 'charmed');
          applyEffect(ally, 'warded', { duration: 600, elapsed: game.fxNow, source: h });
        }
      }
      game.playAbilityFx(h, 'shield', { at: h, spell: true, scale: 2.5 });
      game.fxLog(`🧠 ${h.data.name} casts Mind Blank! Party is shielded from mental harm.`, 'buff');
      return true;
    }
  },

  dominateMonster: {
    label:'Dominate Monster', level:8, concentration:true,
    desc:'Bends any monster to your will (WIS save negates): it fights for you against its own kind for up to 10 rounds while you concentrate.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:10 },
    color:0xa855f7,
    cast(game, h, foe) {
      if (!foe || foe.dead) return false;
      const d = h.data;
      game.markSpellUsed(h, this);
      const dc = spellDC(h);
      if (game.fxBodyEffect) game.fxBodyEffect('hexCurse', foe);
      game.playAbilityFx(h, 'hex', { at: foe, spell: true });

      if (game.spellSave(foe, 'wis', dc, { magic: true })) {
        game.fxLog(`👁️ ${foe.data.name} resists Dominate Monster!`, 'miss');
      } else {
        /* It changes sides: game.dominateMonster flips who it fights, who
           fights it and who its hits are credited to, for 10 rounds or until
           concentration breaks (the concentration record clears the effect,
           and monster_ai releases the creature when it sees that). */
        if (!game.dominateMonster(h, foe, 10)) {
          game.fxLog(`👁️ ${foe.data.name}'s mind cannot be seized.`, 'miss');
          return true;
        }
        game.fxLog(`👁️ ${d.name} dominates ${foe.data.name}! It turns on its own kind.`, 'crit');
        game.concentrate(h, 'dominateMonster', [{ e: foe, key: 'dominated' }]);
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
    desc:'Time stops for everyone but you: take 1d4+1 turns in a row before anyone else can act.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:10 },
    color:0x38bdf8,
    cast(game, h) {
      game.markSpellUsed(h, this);
      /* initiative._advanceTurn re-opens the caster's turn this many times
         before the order moves on, with the combat clock held still. */
      const turns = roll(1, 4, 1);
      h._timeStopTurns = (h._timeStopTurns || 0) + turns;
      game.playAbilityFx(h, 'slow', { at: h, spell: true, scale: 3.5 });
      game.fxLog(`⏳ ${h.data.name} stops the flow of TIME — ${turns} extra turns!`, 'crit');
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
      game.playAbilityFx(h, 'inflictWounds', { at: foe, spell: true });
      playReap(game, h, foe);

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
        const hBefore = a.data.hp;
        a.data.hp = Math.min(a.data.maxHp, a.data.hp + healPerHero);
        if (game.creditHeal) game.creditHeal(h, a.data.hp - hBefore);
        clearEffect(a, 'poisoned');
        clearEffect(a, 'blinded');
        clearEffect(a, 'frightened');
        if (game.fxBodyEffect) game.fxBodyEffect('cureWounds', a);
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
          applyEffect(a, 'foresight', { duration: 60, elapsed: game.fxNow, source: h });
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
    desc:'Bend a humanoid to your will (WIS save negates): it fights for you against its own kind for up to 10 rounds while you concentrate. Only works on humanoids.',
    recharge:'slot',
    ai:{ when:'eliteOrBoss', priority:8 },
    color:0xe8a8ff,
    cast(game, h, foe) {
      if (!foe || foe.dead) foe = pickProjectileTarget(game, h, foe);
      if (!foe) return false;
      const d = h.data;
      const isHumanoid = (foe.data.type || '').toLowerCase() === 'humanoid'
        || (foe.data.tags || []).includes('humanoid');
      if (!isHumanoid) {
        game.fxLog(`\u{1F300} Dominate Person only works on humanoids — ${foe.data.name} is not one.`, 'sys');
        return false;                                  // slot kept; the AI picks something else
      }
      game.markSpellUsed(h, this);
      game.playAbilityFx(h, 'holdPerson', { at: foe, spell: true, scale: 2.0 });

      const dc = spellDC(h);
      if (game.spellSave(foe, 'wis', dc, { magic:true })) {
        game.fxText('saved', game._v3(foe.x, 1.2, foe.z), '#9aa');
        game.fxLog(`\u{1F300} ${foe.data.name} shrugs off the domination!`, 'miss', { cat: 'effect' });
        return true;
      }
      /* Same team-switch as Dominate Monster (game.dominateMonster). */
      if (!game.dominateMonster(h, foe, 10)) return true;
      game.concentrate(h, 'dominatePerson', [{ e:foe, key:'dominated' }]);
      game.fxLog(`\u{1F300} ${d.name} DOMINATES ${foe.data.name}! It turns on its own kind.`, 'crit', { cat: 'effect' });
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
    1: ['magicMissile','shield','grease','thunderwave','chromaticOrb','rayOfSickness','findFamiliar','sleep','light','dancingLights'],
    2: ['scorchingRay','magicMissile','shield','blindness','hideousLaughter','sleep','mistyStep','acidArrow','magicWeapon','flamingSphere','mirrorImage','enlargeReduce','web','holdPerson','darkness'],
    3: ['fireball','haste','scorchingRay','slow','fear','lightningBolt','bestowCurse','vampiricTouch','counterspell','hypnoticPattern'],
    4: ['iceStorm','blight','wallOfFire','polymorph','dimensionDoor','banishment'],
    5: ['coneOfCold','holdMonster','cloudkill','animateObjects','steelWindStrike','dominatePerson'],
    6: ['disintegrate','chainLightning','sunbeam'],
    7: ['fingerOfDeath','prismaticSpray','forcecage'],
    8: ['sunburst','mindBlank','dominateMonster'],
    9: ['meteorSwarm','timeStop','powerWordKill','wish','foresight'],
  },
  cleric: {
    1: ['bless','healingWord','cureWounds','shieldOfFaith','bane','protectionFromEvil','inflictWounds','guidingBolt','light'],
    2: ['spiritualWeapon','bless','shieldOfFaith','blindness','lesserRestoration','holdPerson','silence','magicWeapon'],
    3: ['spiritGuardians','spiritualWeapon','slow','fear','massHealingWord','bestowCurse','daylight'],
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
    3: ['callLightning','moonbeam','slow','massHealingWord','lightningBolt','daylight'],
    4: ['iceStorm','blight','wallOfFire','polymorph'],
    5: ['massCureWounds','coneOfCold','holdMonster','greaterRestoration'],
    6: ['heal','sunbeam'],
    7: ['fireStorm','regenerate'],
    8: ['sunburst','earthquake'],
    9: ['massHeal','trueResurrection','stormOfVengeance','foresight'],
  },
  bard: {
    1: ['healingWord','cureWounds','bless','bane','hideousLaughter','faerieFire','sleep','thunderwave','light','dancingLights'],
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
    1: ['chaosBolt','dragonBreathSpell','shield','sleep','grease','thunderwave','chromaticOrb','rayOfSickness','light','dancingLights'],
    2: ['scorchingRay','chaosBolt','blindness','web','holdPerson','rayOfEnfeeblement','mistyStep','flamingSphere','mirrorImage','enlargeReduce','darkness'],
    3: ['fireball','haste','slow','fear','lightningBolt','counterspell','hypnoticPattern','daylight'],
    4: ['blight','wallOfFire','iceStorm','polymorph','banishment','dimensionDoor'],
    5: ['coneOfCold','holdMonster','cloudkill','animateObjects','dominatePerson'],
    6: ['disintegrate','chainLightning','sunbeam'],
    7: ['fingerOfDeath','fireStorm','prismaticSpray'],
    8: ['sunburst','earthquake','dominateMonster'],
    9: ['meteorSwarm','timeStop','powerWordKill','wish'],
  },
  warlock: {
    1: ['hex','armsOfHadar','magicMissile','bane','faerieFire','inflictWounds','rayOfSickness','findFamiliar'],
    2: ['hex','scorchingRay','blindness','holdPerson','rayOfEnfeeblement','mistyStep','magicWeapon','mirrorImage','darkness'],
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
