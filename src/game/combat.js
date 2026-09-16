/**
 * Hero combat resolution: attacks, subclass actives, damage, kills, loot drops.
 * Monster chase/AI lives in monster_ai.js; this module owns hero-side fighting
 * and shared combat outcomes (damageMonster / killMonster).
 *
 * Mixed onto Game — uses pathfinding (findPath, hasLOS, stepAlong, nudgeToward).
 * All VFX/UI/audio calls go through this.* hooks (see game_hooks.js) so the
 * same code runs headlessly in Node.js for mass balance simulation.
 */
import {
  grantXp, heroAttackBonus, heroDamage, subclassOf,
  CLASSES, RACES, roll, d as die, d20Roll, mod, pendingPoints, pickAttackProfile,
  WILD_SHAPE_FORMS, recalc, unarmedFallback, CANTRIP_SAVE_ABILITY
} from './srd.js';
import { rollItem, makeDye, equippedPerks, perkMag, addToInventory, takeFromInventory } from './items.js';
import { iconHtml } from './icons.js';
import {
  FLOOR, WALL, HERO_SPEED, HERO_ATTACK_CD, HERO_THINK_INTERVAL, COMBAT_SPEED, COMBAT_MOVE_BOOST, XP_SHARE,
  TACTICAL_BLOODIED_FRAC, TACTICAL_DODGE_BLOODIED_FRAC, TACTICAL_DODGE_PIN_THREATS, DAMAGE_TYPE_ICONS
} from './constants.js';
import { hasFeature, hasFeat, hasSlotFor, spendSlotFor, recoverSlots, totalSlots,
  hasCharge, spendCharge, isArcanum,
  hasKi, spendKi, restoreKi, kiLeft,
  featBonusDamage, featExtraAttacks, featOnHit, featIncomingDamage, featACBonus,
  featCombatStartTempHp } from './features.js';
import { trackGold, trackLoot } from './run_stats.js';
import { GIGAPACK_REGISTRY } from './gigapack_registry.js';
import { aoeZoneManager } from './aoe_system.js';
import {
  meleeThreats, opportunityRisk, inMortalDanger, anyTargetInReach,
  effectiveHp, damageValue, heroAttackEv, slotCost, bestAoECenter, monsterDpr,
  gridDist, gridFeet, reachTiles, canAttackFrom,
} from './combat_eval.js';
import { Trace } from './ai_trace.js';
import { VFX_ANIMS, CANTRIP_ANIM_BINDINGS } from './vfx_animations.js';

/* Dye drop odds per kill (independent of the gear-drop roll) */
const DYE_DROP_BOSS = 0.35, DYE_DROP_ELITE = 0.08, DYE_DROP_NORMAL = 0.02;

/* How close a melee attacker has to be before it counts as pinning a hero in
   melee — used by the Disengage and kite branches of the hero AI. */
/* Pinning is grid adjacency: one tile (5 ft), diagonals included. It used to be
   a float radius of 1.6, which covered the 1.414 diagonal while the melee reach
   test (1.4) did not — so a hero could be "pinned" by a monster it was not
   allowed to attack. Reach and pinning must use the same measure. */
const MELEE_PIN_TILES = 1;

export function getAbilityUseWeight(h) {
  const ai = (h && h.data && h.data.aiPrefs) || (h && h.aiPrefs) || {};
  if (ai.abilityUsage === 'conservative') return 0.0;
  if (ai.abilityUsage === 'unleash') return 1.0;
  return 0.5;
}

export function getCombatMovementWeight(h) {
  const ai = (h && h.data && h.data.aiPrefs) || (h && h.aiPrefs) || {};
  if (ai.movementStyle === 'hold') return 0.0;
  if (ai.movementStyle === 'kite') return 0.7;
  if (ai.movementStyle === 'flank') return 1.0;
  return 0.5;
}

export function getPotionHpThreshold(h) {
  const ai = (h && h.data && h.data.aiPrefs) || (h && h.aiPrefs) || {};
  if (ai.potionTrigger === 'off') return 0.0;
  if (ai.potionTrigger === 'emergency') return 0.25;
  if (ai.potionTrigger === 'proactive') return 0.50;
  if (ai.potionTrigger === 'early') return 0.75;
  return 0.25;
}

/**
 * Should auto-combat transform this druid right now?
 *
 * Extracted so the "Wild Shape only when out of spell slots" policy is
 * reachable from a test. It previously lived inline in the combat tick, and the
 * test that claimed to cover it re-implemented the condition on a literal and
 * asserted on its own local variable — it never called this code and would have
 * passed with the gate deleted.
 */
export function shouldAutoWildShape(d) {
  if (!d) return false;
  if (!hasFeature(d, 'wildShapeClass') || !hasCharge(d, 'wildShapeClass')) return false;
  if (d.inWildShape) return false;
  if (d.hp >= d.maxHp * 0.55) return false;
  /* Policy toggle from the druid panel: keep casting while slots remain and
     hold the form in reserve until they are spent. */
  if (d.wildShapeOnlyOutOfSlots) {
    const hasSlots = d.slots && Object.values(d.slots).some(n => n > 0);
    if (hasSlots) return false;
  }
  return true;
}

export function getAvailableAttackOptions(hero) {
  const options = [];
  const d = hero ? (hero.data || hero) : null;
  if (!d) return options;

  if (d.inWildShape && d.wildShapeActiveForm && WILD_SHAPE_FORMS[d.wildShapeActiveForm]) {
    const wf = WILD_SHAPE_FORMS[d.wildShapeActiveForm];
    const profile = pickAttackProfile(d);
    options.push({
      key: 'wildshape_attack',
      label: `${wf.icon} ${profile.name}`,
      sub: `${profile.dmg[0]}d${profile.dmg[1]} ${profile.dmgType} (Melee 5 ft)`,
      profile: profile,
      type: 'melee'
    });
    return options;
  }

  if (d.weaponProfile) {
    const w = d.weaponProfile;
    options.push({
      key: 'weapon_melee',
      label: `⚔️ ${w.name || 'Weapon Strike'} (Melee)`,
      sub: `${w.dmg ? w.dmg[0] + 'd' + w.dmg[1] : '1d6'} Physical (Melee 5 ft)`,
      profile: w,
      type: 'melee'
    });

    const n = (w.name || '').toLowerCase();
    if (n.includes('dagger') || n.includes('handaxe') || n.includes('javelin') || n.includes('spear') || w.thrown) {
      options.push({
        key: 'weapon_thrown',
        label: `🎯 Throw ${w.name || 'Dagger'}`,
        sub: `${w.dmg ? w.dmg[0] + 'd' + w.dmg[1] : '1d4'} Thrown (Range 30 ft)`,
        profile: { ...w, melee: false, range: w.range || 6 },
        type: 'thrown'
      });
    }
  }

  if (d.cantripProfile) {
    const c = d.cantripProfile;
    options.push({
      key: 'cantrip',
      label: `✨ ${c.name || 'Cantrip'}`,
      sub: `1d${c.dmg ? c.dmg[1] : 10} ${c.dmgType || 'Magic'} (${(c.range || 8) * 5} ft)`,
      profile: c,
      type: 'cantrip'
    });
  }

  if (!options.length) {
    options.push({
      key: 'unarmed',
      label: `👊 Unarmed Strike`,
      sub: `1 Bludgeoning (Melee 5 ft)`,
      profile: { name: 'Unarmed Strike', melee: true, range: 1, dmg: [1, 1] },
      type: 'unarmed'
    });
  }

  return options;
}

/** Sprite paths + tint colors for ability / spell feedback.
 *  Each entry may include `frames` (texture-path array) + `frameInterval`
 *  to produce an animated sprite effect that cycles through the sequence. */
export const ABILITY_FX = {
  /* ── Class Features ── */
  secondWind:      { sheetKey: 'spell_heal_001_large_red', sprite: 'dcss/effect/gold_sparkles_1.png', color: 0x6ae06a, label: '2nd WIND',     float: '#6ae06a' },
  actionSurge:     { sheetKey: 'spell_haste_001_large_green', sprite: 'dcss/effect/heataura_1.png',      color: 0xffd34a, label: 'SURGE',         float: '#ffd34a' },
  flurry:          { sheetKey: 'symmetrical_impact_004_large_yellow', sprite: 'dcss/effect/heataura_2.png',      color: 0xe8d8a8, label: 'FLURRY',        float: '#e8d8a8' },
  frenzy:          { sheetKey: 'spell_attack_up_001_large_red', sprite: 'dcss/effect/flame_0.png',
    frames: ['dcss/effect/flame_0.png','dcss/effect/flame_1.png','dcss/effect/flame_2.png'],
    frameInterval: 0.06,                                        color: 0xff6030, label: 'FRENZY',        float: '#ff6030' },
  cunningAction:   { sheetKey: 'directional_smoke_burst_001_large_white', sprite: 'dcss/effect/xom_sparkles_blue.png', color: 0x8fd4e8, label: 'DASH',         float: '#8fd4e8' },
  dash:            { sheetKey: 'directional_smoke_burst_001_large_white', sprite: 'dcss/effect/xom_sparkles_blue.png', color: 0x8fd4e8, label: 'DASH',         float: '#8fd4e8' },
  disengage:       { sheetKey: 'directional_smoke_burst_001_large_white', sprite: 'dcss/effect/cloud_magic_trail_0.png', color: 0x8fd4e8, label: 'DISENGAGE',    float: '#8fd4e8' },
  dodge:           { sheetKey: 'spell_defense_up_001_large_blue', sprite: 'dcss/effect/sanctuary.png',         color: 0xa0c0ff, label: 'DODGE',        float: '#a0c0ff' },
  patientDefense:  { sheetKey: 'spell_defense_up_001_large_blue', sprite: 'dcss/effect/sanctuary.png',         color: 0xa0c0ff, label: 'DODGE',        float: '#a0c0ff' },
  stepOfTheWind:   { sheetKey: 'directional_smoke_burst_001_large_white', sprite: 'dcss/effect/xom_sparkles_blue.png', color: 0x8fd4e8, label: 'STEP', float: '#8fd4e8' },
  stunningStrike:  { sheetKey: 'directional_impact_004_large_yellow', sprite: 'dcss/effect/quad_glow.png',     color: 0xffd34a, label: 'STUN',         float: '#ffd34a' },
  bloodlust:       { sheetKey: 'burst_splatter_001_large_red', sprite: 'dcss/effect/drain_red_2.png',       color: 0xff5040, label: 'BLOODLUST',   float: '#ff5040' },
  shieldOfFaith:   { sheetKey: 'spell_defense_up_001_large_blue', sprite: 'dcss/effect/sanctuary.png',         color: 0xa0c0ff, label: 'SHIELD',       float: '#a0c0ff' },
  remarkableAthlete: { sheetKey: 'spell_haste_001_large_green', sprite: 'dcss/effect/gold_sparkles_1.png', color: 0xaab4cc, label: 'ATHLETE',      float: '#aab4cc' },
  fastHands:       { sheetKey: 'directional_smoke_burst_001_large_white', sprite: 'dcss/effect/cloud_magic_trail_0.png', color: 0x8fd4e8, label: 'SMOKE BOMB',   float: '#8fd4e8' },
  rage:            { sheetKey: 'spell_attack_up_001_large_red', sprite: 'dcss/effect/flame_0.png',
    frames: ['dcss/effect/flame_0.png','dcss/effect/flame_1.png','dcss/effect/flame_2.png'],
    frameInterval: 0.07,                                        color: 0xff4020, label: 'RAGE',          float: '#ff6040' },
  bearTotem:       { sheetKey: 'spell_defense_up_001_large_blue', sprite: 'dcss/effect/cloud_forest_fire.png', color: 0xc08040, label: 'BEAR',          float: '#c08040' },
  bardic:          { sheetKey: 'directional_music_burst_001_large_red', sprite: 'dcss/effect/gold_sparkles_1.png',
    frames: ['dcss/effect/gold_sparkles_1.png','dcss/effect/gold_sparkles_2.png','dcss/effect/gold_sparkles_3.png'],
    frameInterval: 0.07,                                        color: 0xe8a8ff, label: 'INSPIRE',       float: '#e8a8ff' },
  wildShape:       { sheetKey: 'directional_smoke_burst_001_large_white', sprite: 'dcss/effect/cloud_magic_trail_0.png',
    frames: ['dcss/effect/cloud_magic_trail_0.png','dcss/effect/cloud_magic_trail_1.png','dcss/effect/cloud_magic_trail_2.png','dcss/effect/cloud_magic_trail_3.png'],
    frameInterval: 0.06,                                        color: 0x6aaa4a, label: 'WILD SHAPE',    float: '#6aaa4a' },
  combatSong:      { sheetKey: 'directional_music_burst_002_large_yellow', sprite: 'dcss/effect/goldaura_0.png',
    frames: ['dcss/effect/goldaura_0.png','dcss/effect/goldaura_1.png','dcss/effect/goldaura_2.png'],
    frameInterval: 0.07,                                        color: 0xffd080, label: 'BATTLE SONG',   float: '#ffd080' },
  divineSmite:     { sheetKey: 'symmetrical_impact_006_large_yellow', sprite: 'dcss/effect/searing_ray_0.png',
    frames: ['dcss/effect/searing_ray_0.png','dcss/effect/searing_ray_1.png','dcss/effect/searing_ray_2.png','dcss/effect/searing_ray_3.png'],
    frameInterval: 0.05,                                        color: 0xffe08a, label: 'SMITE',         float: '#ffe08a' },
  tidesOfChaos:    { sheetKey: 'round_sparkle_burst_003_large_red', sprite: 'dcss/effect/cloud_chaos_1.png',
    frames: ['dcss/effect/cloud_chaos_1.png','dcss/effect/cloud_chaos_2.png'],
    frameInterval: 0.08,                                        color: 0xb06cf0, label: 'CHAOS',         float: '#b06cf0' },
  indomitable:     { sheetKey: 'spell_defense_up_001_large_blue', sprite: 'dcss/effect/sanctuary.png',         color: 0xa0c0ff, label: 'INDOMITABLE',   float: '#a0c0ff' },
  lucky:           { sheetKey: 'status_sparkling_001_large_yellow', sprite: 'dcss/effect/gold_sparkles_3.png',   color: 0x6aea6a, label: 'LUCKY',         float: '#6aea6a' },
  layOnHands:      { sheetKey: 'spell_heal_001_large_red', sprite: 'dcss/effect/goldaura_1.png',        color: 0xffe08a, label: null,            float: '#6ae06a' },
  cureWounds:      { sheetKey: 'spell_heal_001_large_red', sprite: 'dcss/effect/goldaura_0.png',        color: 0x6ae06a, label: null,            float: '#6ae06a' },
  healingWord:     { sheetKey: 'status_sparkling_001_large_yellow', sprite: 'dcss/effect/gold_sparkles_2.png',   color: 0xe8a8ff, label: null,            float: '#6ae06a' },
  deathstrike:     { sheetKey: 'spell_death_001_large_red', sprite: 'dcss/effect/drain_red_0.png',
    frames: ['dcss/effect/drain_red_0.png','dcss/effect/drain_red_1.png','dcss/effect/drain_red_2.png'],
    frameInterval: 0.06,                                        color: 0xc04040, label: 'DEATHSTRIKE',   float: '#e07070' },
  guidedStrike:    { sheetKey: 'directional_impact_004_large_yellow', sprite: 'dcss/effect/quad_glow.png',         color: 0xffe08a, label: 'GUIDED',        float: '#ffe08a' },
  vowOfEnmity:     { sheetKey: 'spell_attack_up_001_large_red', sprite: 'dcss/effect/flame_2.png',           color: 0xe8a83f, label: 'VOW',           float: '#e8a83f' },
  shadowStep:      { sheetKey: 'scifi_warp_003_large_blue', sprite: 'dcss/effect/umbra_0.png',
    frames: ['dcss/effect/umbra_0.png','dcss/effect/umbra_1.png','dcss/effect/umbra_2.png','dcss/effect/umbra_3.png'],
    frameInterval: 0.05,                                        color: 0x6a5080, label: 'SHADOW STEP',   float: '#a080c0' },
  sacredWeapon:    { sheetKey: 'round_light_burst_001_large_yellow', sprite: 'dcss/effect/irradiate_0.png',
    frames: ['dcss/effect/irradiate_0.png','dcss/effect/irradiate_1.png','dcss/effect/irradiate_2.png','dcss/effect/irradiate_3.png'],
    frameInterval: 0.06,                                        color: 0xffe08a, label: 'SACRED',        float: '#ffe08a' },
  colossusSlayer:  { sheetKey: 'directional_impact_003_large_violet', sprite: 'dcss/effect/searing_ray_5.png',     color: 0xe8a83f, label: 'PREY',          float: '#e8a83f' },
  summonCompanion: { sheetKey: 'round_sparkle_burst_002_large_green', sprite: 'dcss/effect/cloud_magic_trail_3.png', color: 0xa0c080, label: 'SUMMON',     float: '#a0c080' },
  quiveringPalm:   { sheetKey: 'symmetrical_impact_006_large_yellow', sprite: 'dcss/effect/sandblast_0.png',
    frames: ['dcss/effect/sandblast_0.png','dcss/effect/sandblast_1.png','dcss/effect/sandblast_2.png'],
    frameInterval: 0.06,                                        color: 0xffd080, label: 'QUIVERING',     float: '#ffd080' },
  rallyingCry:     { sheetKey: 'spell_defense_up_001_large_blue', sprite: 'dcss/effect/goldaura_2.png',        color: 0xe8a83f, label: 'RALLY',         float: '#e8a83f' },
  preserveLife:    { sheetKey: 'spell_heal_001_large_red', sprite: 'dcss/effect/orb_glow_0.png',
    frames: ['dcss/effect/orb_glow_0.png','dcss/effect/orb_glow_1.png'],
    frameInterval: 0.08,                                        color: 0xbfe0ff, label: 'PRESERVE',      float: '#bfe0ff' },
  dragonBreath:    { sheetKey: 'epic_explosion_001_large_orange', sprite: 'dcss/effect/cloud_fire_0.png',
    frames: ['dcss/effect/cloud_fire_0.png','dcss/effect/cloud_fire_1.png','dcss/effect/cloud_fire_2.png'],
    frameInterval: 0.06,                                        color: 0xff6020, label: 'BREATH',        float: '#ff6020' },
  wildSurge:       { sheetKey: 'round_firework_burst_002_large_yellow', sprite: 'dcss/effect/cloud_chaos_3.png',
    frames: ['dcss/effect/cloud_chaos_3.png','dcss/effect/cloud_chaos_4.png','dcss/effect/cloud_chaos_5.png'],
    frameInterval: 0.06,                                        color: 0xff8844, label: 'WILD MAGIC',    float: '#ff8844' },
  cuttingWords:    { sheetKey: 'directional_music_burst_001_large_red', sprite: 'dcss/effect/cloud_neg_1.png',       color: 0xd0a0ff, label: 'CUTTING WORDS', float: '#d0a0ff' },
  fiendishBlessing:{ sheetKey: 'spell_absorb_001_large_violet', sprite: 'dcss/effect/cloud_neg_0.png',
    frames: ['dcss/effect/cloud_neg_0.png','dcss/effect/cloud_neg_1.png','dcss/effect/cloud_neg_2.png'],
    frameInterval: 0.07,                                        color: 0x9b59b6, label: 'FIENDISH',      float: '#9b59b6' },
  feyPresence:     { sheetKey: 'round_sparkle_burst_001_large_blue', sprite: 'dcss/effect/cloud_spectral_0.png',
    frames: ['dcss/effect/cloud_spectral_0.png','dcss/effect/cloud_spectral_1.png','dcss/effect/cloud_spectral_2.png'],
    frameInterval: 0.07,                                        color: 0xe8a8ff, label: 'FEY',           float: '#e8a8ff' },
  /* ── Spells ── */
  magicMissile:    { sheetKey: 'round_sparkle_burst_001_large_blue', sprite: 'dcss/effect/magic_bolt_1.png',
    frames: ['dcss/effect/magic_bolt_1.png','dcss/effect/magic_bolt_2.png','dcss/effect/magic_bolt_3.png','dcss/effect/magic_bolt_4.png','dcss/effect/magic_bolt_5.png','dcss/effect/magic_bolt_6.png'],
    frameInterval: 0.04,                                        color: 0xb08cff, label: 'MISSILE',       float: '#b08cff' },
  shield:          { sheetKey: 'spell_defense_up_001_large_blue', sprite: 'dcss/effect/sanctuary.png',         color: 0x88aaff, label: 'SHIELD',        float: '#88aaff' },
  scorchingRay:    { sheetKey: 'stylized_explosion_001_large_yellow', sprite: 'dcss/effect/searing_ray_0.png',
    frames: ['dcss/effect/searing_ray_0.png','dcss/effect/searing_ray_1.png','dcss/effect/searing_ray_2.png','dcss/effect/searing_ray_3.png','dcss/effect/searing_ray_4.png','dcss/effect/searing_ray_5.png'],
    frameInterval: 0.04,                                        color: 0xff7a30, label: 'SCORCH',        float: '#ff7a30' },
  fireball:        { sheetKey: 'epic_explosion_002_large_yellow', sprite: 'dcss/effect/cloud_fire_0.png',
    frames: ['dcss/effect/cloud_fire_0.png','dcss/effect/cloud_fire_1.png','dcss/effect/cloud_fire_2.png'],
    frameInterval: 0.05,                                        color: 0xff7a30, label: 'FIREBALL',      float: '#ff7a30' },
  haste:           { sheetKey: 'spell_haste_001_large_green', sprite: 'dcss/effect/xom_sparkles_blue.png', color: 0xa0e0ff, label: 'HASTE',         float: '#a0e0ff' },
  bless:           { sheetKey: 'status_sparkling_001_large_yellow', sprite: 'dcss/effect/gold_sparkles_1.png',
    frames: ['dcss/effect/gold_sparkles_1.png','dcss/effect/gold_sparkles_2.png','dcss/effect/gold_sparkles_3.png'],
    frameInterval: 0.07,                                        color: 0xffe08a, label: 'BLESS',         float: '#ffe08a' },
  spiritualWeapon: { sheetKey: 'directional_impact_004_large_yellow', sprite: 'dcss/effect/orb_glow_0.png',
    frames: ['dcss/effect/orb_glow_0.png','dcss/effect/orb_glow_1.png'],
    frameInterval: 0.08,                                        color: 0xbfe0ff, label: 'SPIRIT WEAPON', float: '#bfe0ff' },
  spiritGuardians: { sheetKey: 'round_light_burst_001_large_yellow', sprite: 'dcss/effect/cloud_spectral_0.png',
    frames: ['dcss/effect/cloud_spectral_0.png','dcss/effect/cloud_spectral_1.png','dcss/effect/cloud_spectral_2.png'],
    frameInterval: 0.07,                                        color: 0xd0c0ff, label: 'GUARDIANS',     float: '#d0c0ff' },
  entangle:        { sheetKey: 'directional_bubble_burst_001_large_green', sprite: 'dcss/effect/cloud_magic_trail_0.png',
    frames: ['dcss/effect/cloud_magic_trail_0.png','dcss/effect/cloud_magic_trail_1.png','dcss/effect/cloud_magic_trail_2.png','dcss/effect/cloud_magic_trail_3.png'],
    frameInterval: 0.06,                                        color: 0x4cae4c, label: 'ENTANGLE',      float: '#4cae4c' },
  moonbeam:        { sheetKey: 'round_light_burst_001_large_yellow', sprite: 'dcss/effect/cloud_cold_0.png',
    frames: ['dcss/effect/cloud_cold_0.png','dcss/effect/cloud_cold_1.png','dcss/effect/cloud_cold_2.png'],
    frameInterval: 0.07,                                        color: 0xc0e8ff, label: 'MOONBEAM',      float: '#c0e8ff' },
  callLightning:   { sheetKey: 'lightning_strike_001_large_violet', sprite: 'dcss/effect/zap_0.png',
    frames: ['dcss/effect/zap_0.png','dcss/effect/zap_1.png','dcss/effect/zap_2.png','dcss/effect/zap_3.png'],
    frameInterval: 0.05,                                        color: 0x7090ff, label: 'LIGHTNING',     float: '#7090ff' },
  shatter:         { sheetKey: 'symmetrical_impact_006_large_yellow', sprite: 'dcss/effect/sandblast_0.png',
    frames: ['dcss/effect/sandblast_0.png','dcss/effect/sandblast_1.png','dcss/effect/sandblast_2.png'],
    frameInterval: 0.06,                                        color: 0xd0a0ff, label: 'SHATTER',       float: '#d0a0ff' },
  chaosBolt:       { sheetKey: 'round_firework_burst_001_large_green', sprite: 'dcss/effect/cloud_chaos_3.png',
    frames: ['dcss/effect/cloud_chaos_3.png','dcss/effect/cloud_chaos_4.png','dcss/effect/cloud_chaos_5.png'],
    frameInterval: 0.05,                                        color: 0xff8844, label: 'CHAOS BOLT',    float: '#ff8844' },
  dragonBreathSpell:{ sheetKey: 'epic_explosion_001_large_orange', sprite: 'dcss/effect/cloud_fire_0.png',
    frames: ['dcss/effect/cloud_fire_0.png','dcss/effect/cloud_fire_1.png','dcss/effect/cloud_fire_2.png'],
    frameInterval: 0.06,                                        color: 0xff6020, label: 'BURNING HANDS', float: '#ff6020' },
  hex:             { sheetKey: 'spell_death_001_large_red', sprite: 'dcss/effect/drain_red_0.png',
    frames: ['dcss/effect/drain_red_0.png','dcss/effect/drain_red_1.png','dcss/effect/drain_red_2.png'],
    frameInterval: 0.07,                                        color: 0x9b59b6, label: 'HEX',           float: '#9b59b6' },
  armsOfHadar:     { sheetKey: 'stylized_skull_smoke_burst_001_large_white', sprite: 'dcss/effect/cloud_gloom_new.png',   color: 0x6a3080, label: 'HADAR',         float: '#6a3080' },
  thunderousSmite: { sheetKey: 'lightning_burst_002_large_violet', sprite: 'dcss/effect/zap_0.png',
    frames: ['dcss/effect/zap_0.png','dcss/effect/zap_1.png','dcss/effect/zap_2.png','dcss/effect/zap_3.png'],
    frameInterval: 0.06,                                        color: 0xf1c40f, label: 'THUNDEROUS',    float: '#f1c40f' },
  huntersMark:     { sheetKey: 'directional_impact_003_large_violet', sprite: 'dcss/effect/searing_ray_1.png',     color: 0x1abc9c, label: "HUNTER'S MARK", float: '#1abc9c' },
  /* ── New condition-based spells ── */
  blindness:       { sheetKey: 'directional_smoke_burst_001_large_white', sprite: 'dcss/effect/cloud_black_smoke.png', color: 0x888899, label: 'BLINDED', float: '#888899' },
  holdPerson:      { sheetKey: 'spell_absorb_001_large_violet', sprite: 'dcss/effect/silenced.png',         color: 0x8090c0, label: 'PARALYZED', float: '#8090c0' },
  sleep:           { sheetKey: 'round_sparkle_burst_001_large_blue', sprite: 'dcss/effect/cloud_yellow_smoke.png', color: 0x6688aa, label: 'SLEEP', float: '#6688aa' },
  fear:            { sheetKey: 'stylized_skull_smoke_burst_001_large_white', sprite: 'dcss/effect/cloud_gloom_new.png',   color: 0x9b59b6, label: 'FEAR', float: '#9b59b6' },
  slow:            { sheetKey: 'symmetrical_smoke_burst_001_large_brown', sprite: 'dcss/effect/cloud_blue_smoke.png',  color: 0x8fd4e8, label: 'SLOW', float: '#8fd4e8' },
  bane:            { sheetKey: 'spell_death_001_large_red', sprite: 'dcss/effect/cloud_neg_1.png',       color: 0xd0a0ff, label: 'BANE', float: '#d0a0ff' },
  faerieFire:      { sheetKey: 'stylized_explosion_002_large_violet', sprite: 'dcss/effect/kny_spark_0.png',
    frames: ['dcss/effect/kny_spark_0.png','dcss/effect/kny_spark_1.png','dcss/effect/kny_spark_2.png','dcss/effect/kny_spark_3.png'],
    frameInterval: 0.08,                                        color: 0xb08cff, label: 'FAERIE FIRE', float: '#c084fc' },
  rayOfEnfeeblement:{ sheetKey: 'spell_poison_001_large_green', sprite: 'dcss/effect/cloud_meph_0.png',    color: 0xd0a080, label: 'ENFEEBLED', float: '#d0a080' },
  web:             { sheetKey: 'directional_bubble_burst_001_large_green', sprite: 'dcss/effect/net_trap.png',          color: 0xbfa060, label: 'WEB', float: '#bfa060' },
  /* thrown items (trinket consumables) */
  acidVial:        { sprite: 'dcss/effect/cloud_acid_0.png',
    frames: ['dcss/effect/cloud_acid_0.png','dcss/effect/cloud_acid_1.png','dcss/effect/cloud_acid_2.png'],
    frameInterval: 0.06,                                        color: 0x7fd14a, label: 'ACID',          float: '#7fd14a' },
  alchemistsFire:  { sprite: 'dcss/effect/cloud_fire_0.png',
    frames: ['dcss/effect/cloud_fire_0.png','dcss/effect/cloud_fire_1.png','dcss/effect/cloud_fire_2.png'],
    frameInterval: 0.05,                                        color: 0xff7a30, label: 'FIRE',          float: '#ff7a30' },
  holyWater:       { sprite: 'dcss/effect/gold_sparkles_1.png',
    frames: ['dcss/effect/gold_sparkles_1.png','dcss/effect/gold_sparkles_2.png','dcss/effect/gold_sparkles_3.png'],
    frameInterval: 0.07,                                        color: 0xffe8a0, label: 'HOLY',          float: '#ffe8a0' },
  bolas:           { sprite: 'dcss/effect/throwing_net_0.png',
    frames: ['dcss/effect/throwing_net_0.png','dcss/effect/throwing_net_2.png','dcss/effect/throwing_net_4.png','dcss/effect/throwing_net_6.png'],
    frameInterval: 0.06,                                        color: 0xbfa060, label: 'TANGLED',       float: '#bfa060' },
  chokingDust:     { sprite: 'dcss/effect/cloud_calc_dust_0.png',
    frames: ['dcss/effect/cloud_calc_dust_0.png','dcss/effect/cloud_calc_dust_1.png','dcss/effect/cloud_calc_dust_2.png','dcss/effect/cloud_calc_dust_3.png'],
    frameInterval: 0.07,                                        color: 0xc8c0a0, label: 'DUST',          float: '#c8c0a0' },
  beadOfForce:     { sheetKey: 'epic_explosion_002_large_yellow', sprite: 'dcss/effect/magic_bolt_1.png',
    frames: ['dcss/effect/magic_bolt_1.png','dcss/effect/magic_bolt_3.png','dcss/effect/magic_bolt_5.png'],
    frameInterval: 0.05,                                        color: 0x9fb8ff, label: 'FORCE',         float: '#9fb8ff' },
  hideousLaughter: { sheetKey: 'round_firework_burst_002_large_yellow', sprite: 'dcss/effect/cloud_chaos_1.png',
    frames: ['dcss/effect/cloud_chaos_1.png','dcss/effect/cloud_chaos_2.png'],
    frameInterval: 0.08,                                        color: 0xe8a8ff, label: 'LAUGHTER!', float: '#e8a8ff' },
  lesserRestoration:{ sheetKey: 'spell_heal_001_large_red', sprite: 'dcss/effect/gold_sparkles_1.png',
    frames: ['dcss/effect/gold_sparkles_1.png','dcss/effect/gold_sparkles_2.png','dcss/effect/gold_sparkles_3.png'],
    frameInterval: 0.07,                                        color: 0x6ae06a, label: 'RESTORED', float: '#6ae06a' },
  greaterRestoration:{ sheetKey: 'spell_heal_001_large_red', sprite: 'dcss/effect/goldaura_0.png',
    frames: ['dcss/effect/goldaura_0.png','dcss/effect/goldaura_1.png','dcss/effect/goldaura_2.png'],
    frameInterval: 0.06,                                        color: 0xffe08a, label: 'RESTORED!', float: '#ffe08a' },
  protectionFromEvil:{ sheetKey: 'spell_defense_up_001_large_blue', sprite: 'dcss/effect/sanctuary.png',      color: 0xffe08a, label: 'PROTECTED', float: '#ffe08a' },
  /* ── Extended spell list ── */
  grease:          { sheetKey: 'symmetrical_smoke_burst_001_large_brown', sprite: 'dcss/effect/cloud_yellow_smoke.png', color: 0xbfa060, label: 'GREASE', float: '#bfa060' },
  inflictWounds:   { sheetKey: 'spell_death_001_large_red', sprite: 'dcss/effect/drain_red_0.png',
    frames: ['dcss/effect/drain_red_0.png','dcss/effect/drain_red_1.png','dcss/effect/drain_red_2.png'],
    frameInterval: 0.06,                                        color: 0xc04040, label: 'WOUNDS', float: '#c04040' },
  acidArrow:       { sheetKey: 'burst_splatter_003_large_green', sprite: 'dcss/effect/acid_venom.png',        color: 0x4cae4c, label: 'ACID', float: '#4cae4c' },
  mistyStep:       { sheetKey: 'directional_smoke_burst_001_large_white', sprite: 'dcss/effect/cloud_blue_smoke.png',  color: 0x8fd4e8, label: 'MISTY STEP', float: '#8fd4e8' },
  silence:         { sheetKey: 'spell_absorb_001_large_violet', sprite: 'dcss/effect/silenced.png',          color: 0x888899, label: 'SILENCE', float: '#888899' },
  bestowCurse:     { sheetKey: 'spell_death_001_large_red', sprite: 'dcss/effect/cloud_neg_0.png',
    frames: ['dcss/effect/cloud_neg_0.png','dcss/effect/cloud_neg_1.png','dcss/effect/cloud_neg_2.png'],
    frameInterval: 0.06,                                        color: 0x9b59b6, label: 'CURSED', float: '#9b59b6' },
  lightningBolt:   { sheetKey: 'lightning_strike_001_large_violet', sprite: 'dcss/effect/zap_0.png',
    frames: ['dcss/effect/zap_0.png','dcss/effect/zap_1.png','dcss/effect/zap_2.png','dcss/effect/zap_3.png'],
    frameInterval: 0.05,                                        color: 0x7090ff, label: 'BOLT!', float: '#7090ff' },
  massHealingWord: { sheetKey: 'spell_heal_001_large_red', sprite: 'dcss/effect/gold_sparkles_1.png',
    frames: ['dcss/effect/gold_sparkles_1.png','dcss/effect/gold_sparkles_2.png','dcss/effect/gold_sparkles_3.png'],
    frameInterval: 0.07,                                        color: 0x6ae06a, label: 'HEAL', float: '#6ae06a' },
  vampiricTouch:   { sheetKey: 'spell_absorb_001_large_violet', sprite: 'dcss/effect/drain_red_0.png',
    frames: ['dcss/effect/drain_red_0.png','dcss/effect/drain_red_1.png','dcss/effect/drain_red_2.png'],
    frameInterval: 0.06,                                        color: 0xc04040, label: 'DRAIN', float: '#c04040' },
  iceStorm:        { sheetKey: 'round_sparkle_burst_001_large_blue', sprite: 'dcss/effect/cloud_cold_0.png',
    frames: ['dcss/effect/cloud_cold_0.png','dcss/effect/cloud_cold_1.png','dcss/effect/cloud_cold_2.png'],
    frameInterval: 0.06,                                        color: 0x7fd4ff, label: 'ICE STORM', float: '#7fd4ff' },
  blight:          { sheetKey: 'spell_death_001_large_red', sprite: 'dcss/effect/cloud_neg_0.png',
    frames: ['dcss/effect/cloud_neg_0.png','dcss/effect/cloud_neg_1.png','dcss/effect/cloud_neg_2.png'],
    frameInterval: 0.05,                                        color: 0x6a3080, label: 'BLIGHT', float: '#6a3080' },
  deathWard:       { sheetKey: 'spell_defense_up_001_large_blue', sprite: 'dcss/effect/sanctuary.png',         color: 0xffe08a, label: 'WARDED', float: '#ffe08a' },
  wallOfFire:      { sheetKey: 'epic_explosion_001_large_orange', sprite: 'dcss/effect/cloud_fire_0.png',
    frames: ['dcss/effect/cloud_fire_0.png','dcss/effect/cloud_fire_1.png','dcss/effect/cloud_fire_2.png'],
    frameInterval: 0.05,                                        color: 0xff6020, label: 'FIRE WALL', float: '#ff6020' },
  coneOfCold:      { sheetKey: 'round_sparkle_burst_001_large_blue', sprite: 'dcss/effect/frost_0.png',
    frames: ['dcss/effect/frost_0.png','dcss/effect/frost_1.png'],
    frameInterval: 0.07,                                        color: 0x7fd4ff, label: 'CONE OF COLD', float: '#7fd4ff' },
  flameStrike:     { sheetKey: 'epic_explosion_002_large_yellow', sprite: 'dcss/effect/flame_0.png',
    frames: ['dcss/effect/flame_0.png','dcss/effect/flame_1.png','dcss/effect/flame_2.png'],
    frameInterval: 0.05,                                        color: 0xffd34a, label: 'FLAME STRIKE', float: '#ffd34a' },
  massCureWounds:  { sheetKey: 'spell_heal_001_large_red', sprite: 'dcss/effect/goldaura_0.png',
    frames: ['dcss/effect/goldaura_0.png','dcss/effect/goldaura_1.png','dcss/effect/goldaura_2.png'],
    frameInterval: 0.06,                                        color: 0x6ae06a, label: 'CURED!', float: '#6ae06a' },
  holdMonster:     { sheetKey: 'spell_absorb_001_large_violet', sprite: 'dcss/effect/silenced.png',          color: 0x8090c0, label: 'HELD', float: '#8090c0' },
  /* ── New spells (SRD audit) ── */
  guidingBolt:     { sheetKey: 'round_light_burst_001_large_yellow', sprite: 'dcss/effect/orb_glow_0.png',        color: 0xffe08a, label: 'GUIDANCE', float: '#ffe08a' },
  thunderwave:     { sheetKey: 'lightning_burst_001_large_violet', sprite: 'dcss/effect/sandblast_1.png',       color: 0xdfe4ee, label: 'THUNDER',  float: '#dfe4ee' },
  magicWeapon:     { sheetKey: 'directional_impact_004_large_yellow', sprite: 'dcss/effect/irradiate_0.png',       color: 0xb08cff, label: 'MAGIC WPN', float: '#b08cff' },
  barkskin:        { sheetKey: 'spell_defense_up_001_large_blue', sprite: 'dcss/effect/stone_arrow_0.png',     color: 0x6aaa4a, label: 'BARKSKIN', float: '#6aaa4a' },
  enlargeReduce:   { sheetKey: 'symmetrical_impact_006_large_yellow', sprite: 'dcss/effect/stone_arrow_0.png', color: 0xffb45a, label: 'ENLARGE', float: '#ffb45a' },
  enlarge:         { sheetKey: 'symmetrical_impact_006_large_yellow', sprite: 'dcss/effect/stone_arrow_0.png', color: 0xffb45a, label: 'ENLARGE', float: '#ffb45a' },
  flamingSphere:   { sheetKey: 'epic_explosion_001_large_orange', sprite: 'dcss/effect/cloud_fire_0.png',
    frames: ['dcss/effect/cloud_fire_0.png','dcss/effect/cloud_fire_1.png','dcss/effect/cloud_fire_2.png'],
    frameInterval: 0.05,                                        color: 0xff6600, label: 'FLAME ORB', float: '#ff6600' },
  cloudkill:       { sheetKey: 'burst_splatter_003_large_green', sprite: 'dcss/effect/cloud_poison_0.png',
    frames: ['dcss/effect/cloud_poison_0.png','dcss/effect/cloud_poison_1.png','dcss/effect/cloud_acid_0.png','dcss/effect/cloud_acid_1.png'],
    frameInterval: 0.06,                                        color: 0x32cd32, label: 'CLOUDKILL', float: '#32cd32' },
  /* ── Extended spells ── */
  animateObjects:  { sheetKey: 'symmetrical_impact_006_large_yellow', sprite: 'dcss/effect/kny_light_0.png',
    frames: ['dcss/effect/kny_light_0.png','dcss/effect/kny_light_1.png','dcss/effect/kny_star_2.png','dcss/effect/kny_star_4.png'],
    frameInterval: 0.05,                                        color: 0xffd700, label: 'ANIMATE', float: '#ffd700' },
  chromaticOrb:    { sheetKey: 'round_firework_burst_001_large_green', sprite: 'dcss/effect/cloud_chaos_3.png',
    frames: ['dcss/effect/cloud_chaos_3.png','dcss/effect/cloud_chaos_4.png','dcss/effect/cloud_chaos_5.png'],
    frameInterval: 0.05,                                        color: 0xff88ee, label: 'CHROMATIC', float: '#ff88ee' },
  counterspell:    { sheetKey: 'lightning_burst_002_large_violet', sprite: 'dcss/effect/zap_0.png',
    frames: ['dcss/effect/zap_0.png','dcss/effect/zap_1.png','dcss/effect/zap_2.png','dcss/effect/zap_3.png'],
    frameInterval: 0.05,                                        color: 0x4080ff, label: 'COUNTER', float: '#4080ff' },
  dimensionDoor:   { sheetKey: 'directional_smoke_burst_001_large_white', sprite: 'dcss/effect/cloud_blue_smoke.png',
    frames: ['dcss/effect/cloud_blue_smoke.png','dcss/effect/cloud_magic_trail_0.png','dcss/effect/cloud_magic_trail_2.png'],
    frameInterval: 0.07,                                        color: 0x7fd4ff, label: 'DIM DOOR', float: '#7fd4ff' },
  eldritchBlast:   { sheetKey: 'round_sparkle_burst_002_large_green', sprite: 'dcss/effect/cloud_magic_trail_0.png',
    frames: ['dcss/effect/cloud_magic_trail_0.png','dcss/effect/cloud_magic_trail_1.png','dcss/effect/cloud_magic_trail_2.png','dcss/effect/cloud_magic_trail_3.png'],
    frameInterval: 0.05,                                        color: 0x86ff5a, label: 'BLAST', float: '#86ff5a' },
  chillTouch:      { sheetKey: 'spell_death_001_large_red', sprite: 'dcss/effect/cloud_neg_0.png',
    frames: ['dcss/effect/cloud_neg_0.png','dcss/effect/cloud_neg_1.png','dcss/effect/cloud_neg_2.png'],
    frameInterval: 0.06,                                        color: 0x7fd8c8, label: 'CHILL', float: '#7fd8c8' },
  findFamiliar:    { sheetKey: 'round_sparkle_burst_002_large_green', sprite: 'dcss/effect/cloud_magic_trail_3.png',   color: 0xa0c080, label: 'FAMILIAR', float: '#a0c080' },
  hypnoticPattern:{ sheetKey: 'round_firework_burst_002_large_yellow', sprite: 'dcss/effect/cloud_chaos_1.png',
    frames: ['dcss/effect/cloud_chaos_1.png','dcss/effect/cloud_chaos_2.png'],
    frameInterval: 0.08,                                        color: 0xe8a8ff, label: 'HYPNOTIC', float: '#e8a8ff' },
  mirrorImage:     { sheetKey: 'directional_impact_002_large_white', sprite: 'dcss/effect/cloud_spectral_0.png',
    frames: ['dcss/effect/cloud_spectral_0.png','dcss/effect/cloud_spectral_1.png','dcss/effect/cloud_spectral_2.png'],
    frameInterval: 0.06,                                        color: 0x88ccff, label: 'MIRROR', float: '#88ccff' },
  polymorph:       { sheetKey: 'scifi_warp_002_large_red', sprite: 'dcss/effect/cloud_gloom_new.png',
    frames: ['dcss/effect/cloud_gloom_new.png','dcss/effect/umbra_1.png','dcss/effect/disjunct_0.png'],
    frameInterval: 0.07,                                        color: 0x9b59b6, label: 'POLYMORPH', float: '#9b59b6' },
  rayOfSickness:   { sheetKey: 'burst_splatter_003_large_green', sprite: 'dcss/effect/acid_venom.png',
    frames: ['dcss/effect/acid_venom.png','dcss/effect/cloud_poison_0.png','dcss/effect/cloud_poison_1.png'],
    frameInterval: 0.06,                                        color: 0x4cae4c, label: 'SICK', float: '#4cae4c' },
};

/** Per-class cantrip impact FX — animated spritesheets (custom pixel-art
 *  single-row strips from the spell-VFX pipeline, 64px frames,
 *  public/fx/spells). Each caster's signature cantrip gets a unique burst on
 *  hit; `color` also tints the bolt projectile and impact ring. fps × dur
 *  controls how much of the particle loop plays per hit. */
export const CANTRIP_FX = {
  /* Fire Bolt (Wizard) — roaring orange flame particle orb */
  wizard:   { url:'fx/spells/cantrip_fire_bolt.png',        cols:19, rows:1, frames:19, fps:30, dur:1.0, scale:2.5, color:0xff7a30, projSheet: 'stylized_explosion_001_large_yellow' },
  /* Chill Touch (Sorcerer) — spectral ghostly hand, pale necrotic green */
  sorcerer: { url:'fx/spells/cantrip_chill_touch.png',      cols:25, rows:1, frames:25, fps:30, dur:1.0, scale:2.5, color:0x7fd8c8, projSheet: 'spell_death_001_large_red' },
  /* Sacred Flame (Cleric) — golden radiant sunburst */
  cleric:   { url:'fx/spells/cantrip_sacred_flame.png',     cols:25, rows:1, frames:25, fps:30, dur:1.0, scale:2.7, color:0xffd34a, projSheet: 'round_light_burst_001_large_yellow' },
  /* Produce Flame (Druid) — bright natural flame */
  druid:    { url:'fx/spells/cantrip_produce_flame.png',    cols:30, rows:1, frames:30, fps:30, dur:1.0, scale:2.5, color:0xffa040, projSheet: 'round_sparkle_burst_002_large_green' },
  /* Eldritch Blast (Warlock) — crackling purple fel ring */
  warlock:  { url:'fx/spells/cantrip_eldritch_blast.png',   cols:19, rows:1, frames:19, fps:40, dur:1.0, scale:2.2, color:0x8a5cf6, projSheet: 'round_sparkle_burst_003_large_red' },
  /* Vicious Mockery (Bard) — glowing magenta musical note burst */
  bard:     { url:'fx/spells/2_magic8_spritesheet.png',    cols:8,  rows:8,  frames:61, fps:30, dur:1.0,  scale:2.2, color:0xe8a8ff, projSheet: 'directional_music_burst_002_large_yellow' },
  /* Ray of Frost (Artificer) — frost ice burst (10x10 grid of 100px, 86 frames) */
  artificer:{ url:'fx/spells/19_freezing_spritesheet.png', cols:10, rows:10, frames:86, fps:30, dur:1.0, scale:2.4, color:0x7fd4ff, projSheet: 'round_sparkle_burst_001_large_blue' },
};

import { SPELLS, spellDC } from './spells.js';
import { applyEffect, clearEffect, hasEffect, getEffect, getEffectMods, tickEffects, clearAllEffects, rollSave, rollSaveDetail, EFFECTS, ROUND_SECONDS } from './conditions.js';
import { provokesOA, strikeInterval, scheduleFollowUpStrike } from './turn_engine.js';
import { canFly, isGroundFor } from './pathfinding.js';
import { firstRunTip } from './help_ui.js';


export const combatMethods = {
  /* ── FX bridge methods now live in game_hooks.js (gameHookMethods) ──
     _v3, fxSprite, fxProjectile, fxBeam, fxSlash, fxText, fxLog are provided
     by the hook layer so domain code never imports entities/ui/audio directly. */

  /* ── spell readout bridge ──────────────────────────────────────────
     Spells route their damage and saving throws through these so the combat
     log shows a real breakdown — the damage dealt to each foe (with any
     resist/immune/vulnerable modifier) and every save roll with its result.
     They log at the moment the effect resolves, so delayed projectile hits
     still report correctly. Signatures mirror damageMonster / rollSave so the
     spell definitions can call them as drop-in replacements. */
  spellDamage(m, dmg, h, crit = false, opts = {}) {
    if (!m || m.dead) return 0;
    const name = m.data?.name || 'foe';
    const { dmg: dealt, modLabel } = this.damageMonster(m, dmg, h, crit, opts);
    const type = opts.dmgType ? ` ${opts.dmgType}` : '';
    const tag = modLabel ? ` (${modLabel})` : '';
    this.fxLog(`   ↳ ${dealt}${type}${tag} to ${name}`, crit ? 'crit' : 'roll');
    return dealt;
  },

  spellSave(entity, ability, dc, opts = {}) {
    const r = rollSaveDetail(entity, ability, dc, opts);
    const name = entity.data?.name || 'foe';
    this.fxLog(`   ↳ ${name} ${ability.toUpperCase()} save — ${r.saved ? 'success' : 'fail'}`,
        r.saved ? 'miss' : 'roll', { detail: `(${r.total} vs DC ${dc})` });
    return r.saved;
  },
  /* Effects expire on the combat clock (fxNow), never the wall clock — see
     the time-base note in conditions.js. */
  tickEffectsOn(e) { tickEffects(e, this.fxNow); },

  /** Refresh ability icons on party frames after a cast/spend. */
  refreshAbilityHud() {
    this.refreshHud();
  },

  /**
   * Play cast animation + world VFX for a class feature / spell.
   * @param {object} h hero entity
   * @param {string} key ABILITY_FX key
   * @param {object} [opts] { at: entity|{x,z}, alsoAt: entity[], noAnim, scale, dur, floatY }
   */
  playAbilityFx(h, key, opts = {}) {
    const at = opts.at || h;
    const anim = VFX_ANIMS[key];
    if (anim) {
      /* Authored composite animation (VFX animation editor) replaces the static
         cast burst: travel from the caster to the target, impact on arrival.
         Additional targets get their own impact layers (no extra sound). */
      const from = this._v3(h.x, 0.55, h.z);
      const toY = at.data && at.data.scale != null ? 0.4 * at.data.scale + 0.4 : 0.55;
      const to = this._v3(at.x != null ? at.x : h.x, toY, at.z != null ? at.z : h.z);
      this.fxCompositeAnimation(anim, from, to, {
        travelSound: () => this.fxPlaySfx(this.fxSpellSfx(key), { volume: 0.65 }),
        /* Lets a caller (e.g. Web) defer spawning a persistent ground effect
           until the travel bolt actually lands, instead of it appearing the
           instant the spell is cast while the orb is still mid-flight. */
        onImpact: opts.onImpact,
      });
      for (const t of opts.alsoAt || []) {
        if (!t || t === at) continue;
        const ty = t.data && t.data.scale != null ? 0.4 * t.data.scale + 0.4 : 0.45;
        this.fxCompositeAnimation(anim, from, this._v3(t.x, ty, t.z), { skipTravel: true, travelSound: false, impactSound: false });
      }
      if (!opts.noAnim && h?.ent) {
        h.castAnim = !!opts.spell;
        if (opts.at && opts.at !== h && opts.at.x != null) this.triggerLunge(h, opts.at);
        else {
          h.lungeDX = 0; h.lungeDZ = 1; h.lungeT = 0.28;
        }
      }
      return;
    }

    this.fxPlaySfx(this.fxSpellSfx(key), { volume: 0.65 });
    const fx = ABILITY_FX[key] || { sprite: 'dcss/effect/magic_bolt_1.png', color: 0xc0a060, label: null, float: '#e8c25a' };
    const x = at.x, z = at.z;
    const y = opts.floatY != null ? opts.floatY : 1.35;
    const scale = opts.scale || 2.0;
    const dur = opts.dur || 0.45;

    const sheetDef = fx.sheetDef || (fx.sheetKey ? GIGAPACK_REGISTRY[fx.sheetKey] : null);
    if (sheetDef) {
      this.fxSheetEffect(sheetDef, this._v3(x, 0.55, z), scale, dur);
    }
    if (fx.sprite) {
      const spriteDef = fx.frames ? { sprite: fx.sprite, frames: fx.frames, frameInterval: fx.frameInterval } : fx.sprite;
      this.fxSprite(spriteDef, this._v3(x, 0.55, z), scale, dur);
    }
    if (!sheetDef && !fx.sprite && fx.color != null && opts.ring) {
      this.fxSlash({ x, z }, fx.color, opts.ring || 1.2);
    }
    if (fx.label) {
      this.fxText(fx.label, this._v3(x, y, z), fx.float || '#e8c25a');
    }
    if (opts.alsoAt) {
      for (const t of opts.alsoAt) {
        if (!t || t === at) continue;
        if (sheetDef) {
          this.fxSheetEffect(sheetDef, this._v3(t.x, 0.45, t.z), scale * 0.85, dur * 0.9);
        }
        if (fx.sprite) {
          const spriteDef2 = fx.frames ? { sprite: fx.sprite, frames: fx.frames, frameInterval: fx.frameInterval } : fx.sprite;
          this.fxSprite(spriteDef2, this._v3(t.x, 0.45, t.z), scale * 0.85, dur * 0.9);
        }
        if (!sheetDef && !fx.sprite && fx.color != null && opts.ring) {
          this.fxSlash({ x: t.x, z: t.z }, fx.color || 0xc0a060, 0.9);
        }
      }
    }

    /* Hero cast / strike animation (drives spellcast / slash sprites in the update loop) */
    if (!opts.noAnim && h?.ent) {
      h.castAnim = !!opts.spell;
      if (opts.at && opts.at !== h && opts.at.x != null) this.triggerLunge(h, opts.at);
      else {
        h.lungeDX = 0; h.lungeDZ = 1; h.lungeT = 0.28;
      }
    }
  },

  /* ── Combat pacing helpers ────────────────────────────────────── */

  /** Seconds since the current combat encounter began. */
  _combatSec() {
    return this._combatEngagedAt != null ? this.elapsed - this._combatEngagedAt : 999;
  },

  /** True when combat has lasted at least minSec — prevents instant cooldown dumps. */
  _combatStable(minSec = 2.0) {
    return this._combatSec() >= minSec;
  },

  getAbilityUseWeight,
  getCombatMovementWeight,
  getPotionHpThreshold,

  /**
   * Threat assessment: is this foe worth spending limited resources on?
   * @param {'normal'|'high'|'low'} threshold  high = boss/elite only; low = almost always
   */
  _worthSpending(h, foe, alive, threshold = 'normal') {
    const w = getAbilityUseWeight(h);
    if (w <= 0) return false;
    if (!foe || foe.dead) return false;
    if (foe.isBoss) return true;
    if (this.monsterEliteRoom(foe)) return true;
    if (threshold === 'high') return false;
    // Trash with decent HP — still worth a spell or two. Liberal heroes lower the bar.
    const hpBar = 24 * (1 - w);
    if (foe.data.hp >= hpBar) return true;
    // Party is struggling — use whatever we have. Liberal heroes intervene sooner.
    if (alive && alive.length) {
      const partyFrac = alive.reduce((s, a) => s + a.data.hp / a.data.maxHp, 0) / alive.length;
      if (partyFrac < 0.3 + 0.5 * w) return true;
    }
    // Don't waste on nearly-dead trash. Conservative heroes skip earlier.
    const skipCut = 0.2 + 0.3 * (1 - w);
    if (foe.data.hp / Math.max(foe.data.maxHp, 1) < skipCut) return false;
    if (threshold === 'low') return w >= 0.4;
    return false;
  },

  /* Throttled wrapper around pickHeroTarget. Because pickHeroTarget re-rolls a
     random tiebreaker on every call, calling it each frame made heroes flip
     targets ~60x/sec — re-facing and re-pathing constantly (the jitter).
     Even a short think timer let a hero switch targets mid-approach, so they
     could ping-pong between two foes and never commit to either. So a hero may
     only CHOOSE a new target on its own turn in the initiative order: once
     picked, that foe is locked in until the hero comes back around.

     The only exception is a target that stopped being a legal one (dead /
     inactive / out of engagement range) — then we retarget immediately so kills
     don't leave the hero standing idle for a whole round.

     Outside initiative (no active order) we fall back to the old staggered
     think timer. Movement, facing and animation keep running every frame off
     the cached foe, so the sprites stay smooth either way. */
  heroDecideTarget(h, alive, dt) {
    h.thinkT = (h.thinkT || 0) - dt;
    const f = h.aiFoe;
    const valid = f && f.data.hp > 0 && f.active
      && (this.initiative && this.initiative.active || Math.hypot(f.x - h.x, f.z - h.z) < 13);

    let retarget;
    if (this.initiative && this.initiative.active) {
      /* _canRetarget is armed once per turn by _beginTurn (initiative.js) and
         consumed here, so exactly one decision happens per turn. */
      retarget = !valid || (this.isCurrentActor(h) && h._canRetarget);
    } else {
      retarget = !valid || h.thinkT <= 0;
    }

    if (retarget) {
      const prev = h.aiFoe;
      h.aiFoe = this.pickHeroTarget(h, alive);
      /* Target selection runs for every hero every frame, not just the one
         whose turn it is — only trace the actor's own choice, or the log fills
         with off-turn noise that looks like idle turns. */
      if (Trace.on && h.aiFoe !== prev
          && (!this.initiative?.active || this.isCurrentActor(h))) {
        const t = h.aiFoe;
        Trace.record(h, 'target',
          t ? `${t.data.name} (hp ${t.data.hp}/${t.data.maxHp}, ${gridFeet(this, h, t)} ft away)`
            : 'NO TARGET — nothing alive in engagement range');
      }
      h._canRetarget = false;
      /* ±15% jitter on the interval so the party doesn't all think in lockstep */
      h.thinkT = HERO_THINK_INTERVAL * (0.85 + Math.random() * 0.3);
    }
    return h.aiFoe;
  },

  pickHeroTarget(h, alive) {
    const ai = (h && h.data && h.data.aiPrefs) || (h && h.aiPrefs) || {};
    const targeting = ai.targeting || 'nearest';

    const cands = [];
    for (const m of this.monsters) {
      if (!m || !m.data || m.data.hp <= 0 || !m.active) continue;
      /* Invisible monsters can't be auto-targeted until they attack (5e). */
      if (getEffectMods(m).invisible) continue;
      const dd = Math.hypot(m.x - h.x, m.z - h.z);
      if ((this.initiative && this.initiative.active) || dd < 13) cands.push({ m, dd });
    }
    if (!cands.length) return null;

    /* Crowd control the party does not immediately shatter.
       Sleep and Hypnotic Pattern both ride the `unconscious` key, and
       damageMonster clears it on any damage (5e: the effect ends if the
       creature takes damage). Nothing told target selection that, so heroes
       picked a hypnotised foe like any other and broke the spell within a
       fraction of a second — and because a melee hit on an unconscious target
       is an auto-crit, the scorer actively PREFERRED the one enemy it should
       have left alone. A 3rd-level slot bought a status icon and nothing else.
       So: leave them be while anything else is still standing, and fall back
       to hitting them only when they are all that is left (never returning
       nothing, which would drop the party out of combat). */
    const awake = cands.filter(c => !hasEffect(c.m, 'unconscious'));
    if (awake.length && awake.length < cands.length) {
      cands.length = 0;
      for (const c of awake) cands.push(c);
    }

    if (cands.length === 1) return cands[0].m;

    const SQUISHY = ['wizard', 'sorcerer', 'warlock', 'bard', 'cleric', 'druid', 'rogue'];
    const isSquishy = a => a && a.data && SQUISHY.includes(a.data.classKey);
    const isRangedCaster = ['wizard', 'sorcerer', 'warlock', 'ranger'].includes(h.data?.classKey);

    /* This hero's swing, used to judge how much of its damage a given target
       can actually absorb. */
    const prof = h.data.lastProfile || h.data.weaponProfile || h.data.cantripProfile
      || (CLASSES[h.data.classKey] && CLASSES[h.data.classKey].attack);

    let best = null, bestScore = -1e9;
    for (const c of cands) {
      const m = c.m;
      const hpFrac = m.data.hp / Math.max(m.data.maxHp, 1);
      let det = 0;

      /* Expected-value term. damageValue caps the swing at what the target can
         still absorb and adds a bonus for actually finishing it off, so this
         one term handles both halves of the overkill problem: it stops a
         40-damage crit being aimed at a 4 HP rat when a healthy ogre is
         standing next to it, while still rewarding the kill when removing that
         rat's attacks is worth more than the wasted damage.

         The ledger (effectiveHp) subtracts damage allies have already promised
         this round, so the party spreads out instead of all piling on. */
      if (prof) {
        const ev = heroAttackEv(h, prof, m, this);
        /* Dimensionless efficiency: "how much is this swing worth compared to
           landing it cleanly?" 1.0 = every point lands, >1 = it also finishes
           something dangerous, <<1 = most of the damage spills onto a corpse. */
        const eff = damageValue(this, m, ev) / Math.max(ev, 1);
        det += Math.min(3, eff) * 1.4;
      }
      if (effectiveHp(this, m) <= 0) det -= 6;   // already dead on paper

      // Immediate threat bonus: monster is right next to hero (melee range <= 2.2)
      if (c.dd <= 2.2) {
        det += 1.5;
      }

      if (targeting === 'guard_backline') {
        const victim = (m._tgtIdx != null) ? this.heroes[m._tgtIdx] : null;
        if (victim && victim !== h && victim.data.hp > 0 && isSquishy(victim)) det += 1.2;
        for (const a of alive) {
          if (a === h || !isSquishy(a)) continue;
          if (Math.hypot(m.x - a.x, m.z - a.z) < 2.0) { det += 0.8; break; }
        }
        if (victim === h) det += 0.5;
        det += (1 - hpFrac) * 0.3;
      } else if (targeting === 'focus_low') {
        det += (1 - hpFrac) * 1.2;
        if (hpFrac < 0.20) det += 0.5;
        if (isRangedCaster && (m.isBoss || (m.data.tags && m.data.tags.includes('caster')))) det += 0.25;
      } else if (targeting === 'boss_caster') {
        if (m.isBoss || m.isElite || (m.data.tags && (m.data.tags.includes('boss') || m.data.tags.includes('caster')))) det += 1.5;
        det += (1 - hpFrac) * 0.4;
      } else {
        // 'nearest' (Default)
        det += (1 - hpFrac) * 0.3;
      }

      const noise = (Math.random() - 0.5) * 0.1;
      // Increased distance penalty (-0.15 instead of -0.02) to prevent sprinting past foes
      const score = det + noise - c.dd * 0.15;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  },

  /* Nearest valid monster fallback for manual-mode action buttons and any
     spell/attack resolver that wasn't handed an explicit target. Mirrors the
     auto AI's pickHeroTarget but is deterministic (no jitter) and ignores AI
     prefs — the player has already chosen the action, we just need a body.
     Prefers the hero's currently-engaged foe, then the closest live monster,
     tie-broken toward the most-wounded so a bar click finishes a kill. */
  findMonsterTarget(h) {
    if (!h || !this.monsters || !this.monsters.length) return null;
    const engaged = h.aiFoe;
    if (engaged && engaged.data && engaged.data.hp > 0 && engaged.active) return engaged;
    let best = null, bestScore = -Infinity;
    for (const m of this.monsters) {
      if (!m || !m.data || m.data.hp <= 0 || !m.active) continue;
      if (getEffectMods(m).invisible) continue;
      const dd = Math.hypot(m.x - h.x, m.z - h.z);
      const hpFrac = m.data.hp / Math.max(m.data.maxHp, 1);
      const score = (1 - hpFrac) * 1.0 - dd * 0.5;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  },

  /* A fight is on but this hero has no foe within engagement range —
     run toward the nearest active monster so the party regroups on the
     fight instead of standing frozen wherever combat caught them.
     If no active monster is nearby, move toward the party leader to
     close the gap and eventually activate distant monsters. */
  combatCatchup(h, alive, dt) {
    let anchor = null, best = 1e9, isFoe = false;
    for (const m of this.monsters) {
      if (m.data.hp <= 0 || !m.active) continue;
      const dd = Math.hypot(m.x - h.x, m.z - h.z);
      if (dd < best) { best = dd; anchor = m; isFoe = true; }
    }
    if (!anchor) {
      anchor = this.partyLeader(alive);
      isFoe = false;
      if (h === anchor || Math.hypot(h.x - anchor.x, h.z - anchor.z) < 1.2) { h.moving = false; return; }
    }
    const goal = isFoe && typeof this.approachCellNear === 'function'
      ? this.approachCellNear(this.cellOf(anchor.x, anchor.z), h)
      : this.nearFloorCell(this.cellOf(anchor.x, anchor.z), 2);
    if (goal < 0) { h.moving = false; return; }
    if (!this.hasLivePath(h)) {
      this.setEntityPath(h, this.findPath(this.cellOf(h.x, h.z), goal, { mover: h }));
      h.pathGoal = goal;
    }
    h.moving = this.moveStep(h, HERO_SPEED * 1.05 * h.data.speedMult * this.hasteMult(h), dt);
    if (!h.moving && this.canMove(h) && h.path && h.pathI < h.path.length) {
      if (this.handleStuck) this.handleStuck(h, this.partyLeader(alive), dt);
      else { h.stuckT = 0; h.stuckStage = 0; }
    } else { h.stuckT = 0; h.stuckStage = 0; }
  },

  /**
   * Dash / Dodge / Disengage for an auto-mode hero, mirroring the monster-side
   * decision in monster_ai.monsterTacticalAction so both sides of a fight play
   * by the same action economy.
   *
   *   • Disengage — a ranged hero pinned in melee that is about to give ground.
   *     Costs the Action (no attack), so it is held back for the cases where
   *     eating an opportunity attack actually hurts: bloodied, or pinned by
   *     more than one monster.
   *   • Dash — the movement budget is spent, the foe is still out of weapon
   *     reach, and one more move's worth would close the gap on a real route.
   *   • Dodge — nothing is reachable this turn, so brace instead of idling.
   *
   * Returns true when an action was taken and heroCombat should stand down for
   * this frame.
   */
  /**
   * Hero-side mirror of the opportunity-attack check monsters already run
   * (monster_ai.js). Before stepping out of a square a hostile threatens,
   * decide whether the reposition is worth a free hit. Disengage is the
   * standard way to break contact; failing that, a hero who can already
   * swing at something is better off standing still than eating an attack
   * to shuffle one square.
   *
   * Returns true when the caller should NOT step this frame.
   */
  heroAvoidOA(h, foe, atk) {
    if (!this.initiative || !this.initiative.active) return false;
    if (h.disengageActive) return false;
    if (!h.path || h.pathI >= h.path.length) return false;
    if (getEffectMods(h).incapacitated) return false;

    const fromCell = this.cellOf(h.x, h.z);
    const nextCell = h.path[h.pathI];
    if (fromCell < 0 || nextCell == null || fromCell === nextCell) return false;

    const provokers = provokesOA(this.oaHostiles(h), fromCell, nextCell);
    if (!provokers.length) return false;

    /* This used to spend the Action on Disengage right here, mid-approach —
       which is exactly the "hero runs up to a monster and then disengages,
       doing nothing" behaviour. A reposition is never worth the turn. Either
       stand and fight, or accept the free hit and keep walking. */

    /* Standing and fighting beats a free hit — but only if there is something
       to fight. Otherwise the reposition is worth eating the hit for. */
    if (foe && atk) {
      /* gridDist returns -1 for an off-grid position; that must never read as
         "in reach", so check the lower bound too. */
      const tilesToFoe = gridDist(this, h, foe);
      if (tilesToFoe >= 0 && tilesToFoe <= reachTiles(atk)) {
        h.path = null; h.pathI = 0;
        h.moving = false;
        return true;
      }
    }
    return false;
  },

  /**
   * Whether `h` should spend its whole Action on Disengage.
   *
   * Disengage buys exactly one thing: immunity to opportunity attacks for the
   * rest of the turn. It costs the Action. A hero's action is typically worth
   * 8-30 HP of value; a single opportunity attack is worth 4-8. The old version
   * of this returned `true` for *every* ranged profile unconditionally, which
   * is why archers and casters spent roughly one turn in five running away
   * from a goblin instead of shooting it — 21% of all hero turns were spent
   * this way, producing nothing.
   *
   * The trade is only correct when the hero is genuinely about to be torn apart
   * by several attackers AND has nothing useful to do from where it stands.
   */
  heroShouldDisengage(h, atk) {
    const ms = (h.data && h.data.aiPrefs && h.data.aiPrefs.movementStyle) || 'standard';
    if (ms === 'hold') return false;

    /* Rule 1, and the one that matters most: if the hero can hit something
       from where it is standing, hitting it always beats giving up the turn to
       avoid one free swing. */
    if (anyTargetInReach(this, h, atk)) return false;

    const threats = meleeThreats(this, h, MELEE_PIN_TILES);
    if (threats.length < 2) return false;      // one OA is never worth an Action

    /* Multiple attackers: compare what leaving actually costs against the
       damage we'd soak by standing here another round. */
    const risk = opportunityRisk(this, h, threats);
    return risk >= 8 || inMortalDanger(this, h);
  },

  /** Is `h` under enough pressure to justify bracing with the Dodge action?
      Bloodied, or pinned by several hostiles at once. */
  heroUnderPressure(h) {
    const d = h.data || {};
    const maxHp = d.maxHp || d.hp || 1;
    if (maxHp > 0 && (1 - d.hp / maxHp) >= TACTICAL_DODGE_BLOODIED_FRAC) return true;
    let adjacent = 0;
    for (const m of this.monsters || []) {
      if (!m || !m.active || !m.data || m.data.hp <= 0) continue;
      const t = gridDist(this, h, m);
      if (t >= 0 && t <= MELEE_PIN_TILES) adjacent++;
      if (adjacent >= TACTICAL_DODGE_PIN_THREATS) return true;
    }
    return false;
  },

  /**
   * A shooter caught in melee gives ground — AFTER it has already fired.
   *
   * This used to run before the attack and pay for the withdrawal with the
   * Action (Disengage), which meant a pinned archer's entire turn was "walk
   * backwards". Worse, when it was cornered and `findFleePath` came back null
   * it still burned the Disengage and then stood there: no move, no shot, a
   * completely blank turn.
   *
   * Two facts make the old trade indefensible here:
   *   1. this engine applies no disadvantage to ranged attacks in melee
   *      (see heroAttackRoll), so standing and shooting costs nothing;
   *   2. movement and the Action are independent budgets (turn_engine.js), so
   *      the hero can shoot first and *then* walk out on leftover movement.
   *
   * So: shoot, then step back with whatever movement is left, eating at most
   * one opportunity attack. Reads as a deliberate fighting withdrawal instead
   * of a panic, and costs nothing.
   *
   * Returns true when a withdrawal was started (the caller must keep the turn
   * alive so the walk finishes).
   */
  heroPostAttackWithdraw(h, atk, dt) {
    if (!atk || atk.melee) return false;                 // melee heroes hold the line
    if (h.disengageActive) return false;
    if (getEffectMods(h).incapacitated) return false;
    if (!this.initiative || !this.initiative.active || !this.isCurrentActor(h)) return false;

    /* The Combat Positioning weight doubles as a "hold position" knob — at 0 the
       player has picked Hold Ground, so respect that over kiting. */
    const cm = this.getCombatMovementWeight(h);
    if (cm <= 0) return false;

    /* Needs movement left over after the attack, and no walk already running. */
    const speedCells = this.cellsForSpeed(h);
    if ((h.moveLeft || 0) < Math.max(1, speedCells * 0.34)) return false;
    if (h.path && h.pathI < h.path.length) return false;

    /* Only melee-capable hostiles pin a shooter — another archer at 1 square
       is not a reason to move at all. */
    const pinners = meleeThreats(this, h, MELEE_PIN_TILES);
    if (!pinners.length) return false;

    const fleePath = this.findFleePath(h, pinners, h.moveLeft || speedCells);
    if (!fleePath) return false;                         // cornered — just stay put

    this.setEntityPath(h, fleePath); h.repathT = 0.6; h.stuckT = 0;
    h.moving = this.moveStep(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt || 0.016);
    this.fxLog(`🏹 ${h.data.name} gives ground, keeping the shot open.`, 'sys');
    return true;
  },

  heroTacticalAction(h, foe, alive, dist, atk, dt) {
    if (this.controlMode === 'manual') return false;
    if (!this.initiative || !this.initiative.active || !this.isCurrentActor(h)) return false;
    if (h.actUsed) return false;
    if (getEffectMods(h).incapacitated) return false;

    /* Grid distance, in tiles — see combat_eval.gridDist. Float comparisons
       here were what made a diagonally adjacent foe read as out of reach. */
    const reach = reachTiles(atk);
    const tiles = gridDist(this, h, foe);
    const inRange = tiles >= 0 && tiles <= reach
      && (atk.melee || this.hasLOS(h.x, h.z, foe.x, foe.z));

    /* If the hero can already hit its target, nothing tactical is worth doing
       instead — take the shot. The withdrawal for pinned shooters now happens
       AFTER the attack (heroPostAttackWithdraw), not instead of it. */
    if (inRange) return false;

    const speedCells = this.cellsForSpeed(h);
    const hasFullMove = (h.moveLeft == null || h.moveLeft >= speedCells * 0.85) && (!h.path || h.pathI >= h.path.length);

    /* A) DISENGAGE: last resort only. We are already past the in-range check,
       so this hero cannot hit anything it is standing next to. heroShouldDisengage
       additionally demands two or more melee attackers and real danger, and we
       refuse to spend the Action unless there is somewhere to actually run —
       burning Disengage and then standing still was a guaranteed blank turn. */
    if (hasFullMove && !h.disengageActive && this.heroShouldDisengage(h, atk)) {
      const threats = meleeThreats(this, h, 3);
      const fleePath = threats.length
        ? this.findFleePath(h, threats, h.moveLeft || speedCells)
        : null;
      if (fleePath && this.takeCommonAction(h, 'disengage')) {
        Trace.on && Trace.record(h, 'disengage',
          `pinned by ${threats.length} melee attackers with nothing in reach — breaking contact`);
        this.setEntityPath(h, fleePath); h.repathT = 0.6; h.stuckT = 0;
        h.moving = this.moveStep(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt || 0.016);
        return true;
      }
    }

    /* B) DASH CHECK: ONLY at turn start, and ONLY when a double-move genuinely
       lands the hero in strike range. Spending the Action to Dash at a
       stationary target is pointless — walking reaches it just as fast — so
       only flankers (who sprint in to wrap the foe) spend the turn on it.
       Hold-ground and standard heroes walk; kite heroes are already holding
       their firing band. */
    if (hasFullMove) {
      let goal = this.cellOf(foe.x, foe.z);
      if (atk && atk.melee) {
        if (typeof this.approachCellNear === 'function') goal = this.approachCellNear(goal, h);
      } else {
        const R = this.desiredStandoff(h, atk);
        const dx = h.x - foe.x, dz = h.z - foe.z, dl = Math.hypot(dx, dz) || 1;
        goal = this.cellOf(foe.x + (dx / dl) * R, foe.z + (dz / dl) * R);
        if (goal < 0 || this.D.grid[goal] !== FLOOR) goal = this.nearFloorCell(goal, 2);
      }
      const route = this.findPath(this.cellOf(h.x, h.z), goal, { mover: h });
      const ms = (h.data && h.data.aiPrefs && h.data.aiPrefs.movementStyle) || 'standard';
      /* Dash when a single move genuinely cannot close the gap but a double
         move can. This used to be flankers-only, which is why melee heroes
         would jog toward a fight, run out of movement a few tiles short and
         then just stand there with a full Action — the single most visible
         piece of "why is the paladin wandering around instead of fighting".
         Hold-ground heroes still hold; nothing else is lost by Dashing,
         because the alternative really is doing nothing at all. */
      if (route && ms !== 'hold') {
        const travel = Math.max(0, route.length - 1);
        if (this.dashSavesATurn(h, travel) && this.takeCommonAction(h, 'dash')) {
          Trace.on && Trace.record(h, 'dash',
            `${foe.data.name} is ${travel} tiles (${travel * 5} ft) off, speed ${speedCells} tiles — dashing saves a turn`);
          this.setEntityPath(h, route); h.repathT = 0.6; h.stuckT = 0;
          h.moving = this.moveStep(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt || 0.016);
          return true;
        }
      }
    }

    /* C) DODGE CHECK: out of movement budget and no route available. Only
       spend the Action bracing under real pressure (bloodied or outnumbered);
       hold-ground heroes just hold. Either way, exhaust the frame so the
       stuck-recovery path never nudges the hero on a spent budget. */
    if ((h.moveLeft || 0) <= 0 && (!h.path || h.pathI >= h.path.length)) {
      const ms = (h.data && h.data.aiPrefs && h.data.aiPrefs.movementStyle) || 'standard';

      /* Movement spent and the target still out of reach, but the Action is
         untouched — Dash and keep going. Standing here achieves literally
         nothing, so any use of the Action beats holding. This is the tail end
         of the same "walks partway, then stops" behaviour the turn-start Dash
         above catches earlier. */
      if (ms !== 'hold' && !h.actUsed) {
        const { route } = this.heroApproachRoute(h, foe, atk);
        const travel = route ? Math.max(0, route.length - 1) : 0;
        if (route && this.dashSavesATurn(h, travel) && this.takeCommonAction(h, 'dash')) {
          Trace.on && Trace.record(h, 'dash',
            `movement spent, ${foe.data.name} still ${travel} tiles (${travel * 5} ft) off — dashing saves a turn`);
          this.setEntityPath(h, route); h.repathT = 0.6; h.stuckT = 0;
          h.moving = this.moveStep(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt || 0.016);
          return true;
        }
      }

      if (ms !== 'hold' && this.heroUnderPressure(h) && this.takeCommonAction(h, 'dodge')) {
        Trace.on && Trace.record(h, 'dodge', 'out of movement, under pressure — bracing');
        h.moving = false;
        this.clearEntityPath(h); h.stuckT = 0;
        return true;
      }
      /* no action spent — just hold ground */
      Trace.on && Trace.record(h, 'hold',
        `out of movement with ${foe ? foe.data.name : 'target'} still ${foe ? gridFeet(this, h, foe) : '?'} ft away (reach ${reach * 5} ft) — turn ends without acting`);
      h.moving = false;
      this.clearEntityPath(h); h.stuckT = 0;
      return true;
    }
    return false;
  },

  /**
   * Find somewhere this hero can actually fight `foe` from, and a route to it.
   *
   * The old inline version computed a single goal and gave up if it was
   * unreachable. Two ways that failed badly:
   *
   *   • A caster whose line of sight was blocked counted as "out of range", so
   *     it aimed at a standoff tile along the hero→foe ray — which is roughly
   *     where it was already standing. findPath(from === to) returns null, so
   *     it stood still and did nothing, every turn, for the whole fight. This
   *     was 58% of all wizard turns.
   *   • A melee hero whose target was ringed by other bodies got the target's
   *     own (occupied) cell back from approachCellNear and could not path to
   *     it, so it milled around instead of attacking.
   *
   * So: generate several candidate stances, best first, and take the first one
   * we can actually reach. For ranged that means tiles at the preferred band
   * WITH line of sight; for melee, tiles adjacent to the target.
   *
   * Returns { goal, route } — route is null when nothing is reachable.
   */
  /**
   * Is spending the Action on Dash actually worth it?
   *
   * Dash buys movement, never an attack — you can never swing on the turn you
   * Dash. So it only pays when it brings the FIRST attack forward by a turn.
   *
   * With `R` tiles still to travel, `M` movement left this turn and speed `S`:
   *   R <= M       → you arrive and attack this turn. Dashing throws that away.
   *   M < R <= M+S → you arrive next turn and attack next turn either way.
   *                  Dashing arrives sooner but attacks on the same turn, so it
   *                  is pure loss.
   *   R > M + S    → dashing genuinely removes a turn from the approach.
   *
   * The old rule was `travel > speed && travel <= 2 * speed` — exactly the band
   * where Dash gains nothing. Restricting it to flankers hid the cost; opening
   * it to everyone made it obvious (one wasted turn per Dash, and fights got
   * measurably longer).
   */
  dashSavesATurn(h, travelTiles) {
    if (!(travelTiles > 0)) return false;
    const S = this.cellsForSpeed(h);
    const M = h.moveLeft != null ? h.moveLeft : S;
    return travelTiles > M + S;
  },

  heroApproachRoute(h, foe, atk) {
    const from = this.cellOf(h.x, h.z);
    const R = this.desiredStandoff(h, atk);
    const candidates = [];
    /* Must match what approachCellNear/getUnoccupiedCellNear will hand back,
       or a flyer's stance over water is picked and then thrown away here. */
    const flies = canFly(h);
    const push = (cell) => {
      if (cell < 0 || cell === from) return;
      if (!isGroundFor(this.D.grid, cell, flies)) return;
      if (candidates.includes(cell)) return;
      candidates.push(cell);
    };

    if (atk.melee) {
      /* Any free tile adjacent to the target, nearest ring first. */
      if (typeof this.approachCellNear === 'function') {
        const c = this.approachCellNear(this.cellOf(foe.x, foe.z), h);
        if (c !== this.cellOf(foe.x, foe.z)) push(c);
      }
      /* Fall back to a widening scan around the target so a packed melee
         scrum still yields somewhere to stand. */
      if (typeof this.getUnoccupiedCellNear === 'function') {
        push(this.getUnoccupiedCellNear(this.cellOf(foe.x, foe.z), h, 4));
      }
    } else {
      /* Ring of firing positions around the target at the preferred band, and
         one ring closer in case the good band has no line of sight. Sorted by
         how little the hero has to move. */
      const rings = [R, Math.max(1.6, R * 0.65)];
      const ranked = [];
      for (const rad of rings) {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const tx = foe.x + Math.cos(a) * rad, tz = foe.z + Math.sin(a) * rad;
          const cell = this.cellOf(tx, tz);
          if (cell < 0 || !isGroundFor(this.D.grid, cell, flies)) continue;
          /* A firing position is only worth walking to if we can see the
             target from it — this is the check that was missing entirely. */
          if (!this.hasLOS(tx, tz, foe.x, foe.z)) continue;
          if (typeof this.isCellBodyOccupied === 'function'
              && this.isCellBodyOccupied(cell, h)) continue;
          ranked.push({ cell, d: Math.hypot(tx - h.x, tz - h.z) });
        }
      }
      ranked.sort((p, q) => p.d - q.d);
      for (const r of ranked) push(r.cell);
    }

    /* Last resort for both: close on the target however we can. Better to walk
       into weapon reach than to stand still doing nothing. */
    if (typeof this.approachCellNear === 'function') {
      push(this.approachCellNear(this.cellOf(foe.x, foe.z), h));
    }

    /* Take the first reachable candidate. Capped so a hero surrounded by walls
       doesn't run a full search every repath. */
    const tries = Math.min(candidates.length, 10);
    for (let i = 0; i < tries; i++) {
      const route = this.findPath(from, candidates[i], { mover: h });
      if (route) return { goal: candidates[i], route };
    }
    return { goal: candidates[0] ?? -1, route: null };
  },

  heroCombat(h, foe, alive, dt) {
    const cls = CLASSES[h.data.classKey];
    /* Attack profile is resolved per-turn from the equipped weapon (casters
       roll between cantrip and weapon via aiPrefs.rangedPref). Threaded through
       opts.profile to every heroAttackRoll call below, including Extra Attack /
       Action Surge / Flurry / Frenzy so they share the same stance this turn. */
    const atk = h.data.weaponProfile || h.data.cantripProfile
      ? pickAttackProfile(h.data) : (h.data.lastProfile || cls.attack);
    h.data.lastProfile = atk;
    /* not const: the "something is already in reach" check below can switch
       targets mid-turn, and everything downstream reads this distance. */
    let dist = Math.hypot(foe.x - h.x, foe.z - h.z);
    /* Per-hero AI priority directives (see menus.js AI Priorities tab). */
    const abilityUse = this.getAbilityUseWeight(h);
    const cm = this.getCombatMovementWeight(h);
    /* Initiative gate: off-turn heroes cannot act or move on other creatures' turns. */
    if (this.initiative && this.initiative.active && !this.isCurrentActor(h)) return;

    // Track combat engagement for pacing / staggering
    if (!this._combatEngagedAt) this._combatEngagedAt = this.elapsed;
    h._abilityUsedThisCycle = false;

    /* Manual mode: player heroes do NOT auto-chase or auto-attack.
       If player issued a manual movement path, step along it. */
    if (this.controlMode === 'manual') {
      if (h.path && h.pathI < h.path.length) {
        h.moving = this.moveStep(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt);
      } else {
        h.moving = false;
      }
      return;
    }

    /* Incapacitated (paralyzed / stunned / held): the hero cannot act or move. */
    if (getEffectMods(h).incapacitated) {
      Trace.on && Trace.record(h, 'skip', 'incapacitated - cannot act or move');
      h.moving = false; return;
    }

    /* If hero is actively executing a tactical flee / dash path, continue
       stepping — UNLESS the walk has already achieved what it was for. A stale
       path used to keep a hero marching past a target that had wandered into
       reach (or that it had already arrived next to), burning the whole turn on
       movement with its Action untouched. Range is re-checked every frame now,
       and reaching weapon range cancels the walk. */
    if (h.path && h.pathI < h.path.length && (h.moveLeft || 0) > 0) {
      const arrived = !h.actUsed && !h.disengageActive && anyTargetInReach(this, h, atk);
      if (arrived) {
        /* Switch to whatever is actually in reach. Cancelling the walk while
           keeping a target we still can't hit just sent the hero straight back
           into the move branch next frame — it re-pathed, re-cancelled, and
           ping-ponged until the turn timer ran out. Something in reach is worth
           more than something across the room, so commit to it. */
        if (arrived !== foe) {
          Trace.on && Trace.record(h, 'retarget',
            `${arrived.data.name} is already in reach — switching off ${foe.data.name} (${gridFeet(this, h, foe)} ft away)`);
          h.aiFoe = arrived;
          foe = arrived;
          dist = Math.hypot(foe.x - h.x, foe.z - h.z);
        } else {
          Trace.on && Trace.record(h, 'stop', `already in reach of ${arrived.data.name} — cancelling the walk to attack`);
        }
        this.clearEntityPath(h);
        h.moving = false;
      } else {
        if (this.heroAvoidOA(h, foe, atk)) return;
        h.moving = this.moveStep(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt);
        if (h.moving) return;
      }
    }

    /* Defensive/buff reflexes are "abilities" — skip entirely at 0% ability-use. */
    if (abilityUse > 0) this.runCombatReflexes(h, alive, foe);

    /* Moonbeam reposition AI check: if concentrating on moonbeam and action available */
    if (!h.actUsed && h.conc?.key === 'moonbeam' && h.conc.zone) {
      const zone = h.conc.zone;
      const foesInZone = this.monsters.filter(m => m.active && m.data && m.data.hp > 0 && Math.hypot(m.x - zone.x, m.z - zone.z) <= zone.radius);
      if (foesInZone.length === 0 || (foe && Math.hypot(foe.x - zone.x, foe.z - zone.z) > zone.radius)) {
        const bestTarget = foe || this.findMonsterTarget(h);
        if (bestTarget && Math.hypot(bestTarget.x - h.x, bestTarget.z - h.z) <= 12.0) {
          if (this.useMoveMoonbeam(h, { x: bestTarget.x, z: bestTarget.z })) {
            return;
          }
        }
      }
    }

    /* Dash / Dodge / Disengage — the same tactical fallbacks the monsters use. */
    if (this.heroTacticalAction(h, foe, alive, dist, atk, dt)) return;

    const attackRange = reachTiles(atk);
    const tilesToFoe = gridDist(this, h, foe);
    const inRange = tilesToFoe >= 0 && tilesToFoe <= attackRange
      && (atk.melee || this.hasLOS(h.x, h.z, foe.x, foe.z));
    if (!inRange) {
      /* Combat Positioning: low weights make the hero hold position instead of
         chasing across the room. chaseRange runs from just beyond melee reach
         (cm=0) up to the full 13-unit engagement range (cm=1). */
      const baseReach = attackRange + 1.5;
      const chaseRange = baseReach + (13 - baseReach) * cm;
      if (!this.initiative?.active && dist > chaseRange) {
        h.combatFoe = null;
        h.moving = false;
        h.stuckT = 0; h.stuckStage = 0;
        this.faceTowards(h, foe.x, foe.z, dt);
        return;
      }
      h.combatFoe = null;
      if (!this.hasLivePath(h)) {
        const from = this.cellOf(h.x, h.z);
        const { goal, route } = this.heroApproachRoute(h, foe, atk);
        this.setEntityPath(h, route);
        if (Trace.on) {
          Trace.record(h, 'move',
            route
              ? `approach ${foe.data.name}: ${gridFeet(this, h, foe)} ft away, reach ${attackRange * 5} ft — routing ${route.length - 1} tiles to cell ${goal}`
              : `CANNOT REACH ${foe.data.name} (${gridFeet(this, h, foe)} ft away): no path from ${from} to ${goal}`
                + (goal === this.cellOf(foe.x, foe.z) ? ' — every tile around the target is occupied' : ''),
            { goal, from, reachable: !!route });
        }
      }
      if (this.heroAvoidOA(h, foe, atk)) return;
      h.moving = this.moveStep(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt);

      if (!h.moving && h !== this.partyLeader(alive) && this.canMove(h)
          && h.path && h.pathI < h.path.length) {
        this.handleStuck(h, this.partyLeader(alive), dt);
      } else {
        h.stuckT = 0; h.stuckStage = 0;
      }
      return;
    } else {
      h.stuckT = 0; h.stuckStage = 0;
    }

    /* Already spent the Action this turn — do not keep orbiting. combatMove
       after a swing was leaving `moving` true for the rest of the spotlight,
       which is why the 2.5 s stuck-ceiling would fire on a hero who had
       already attacked (and why they jittered on the tile after the lunge).
       A deliberate fighting withdrawal still runs: heroPostAttackWithdraw
       sets a path, and the path-follow at the top of heroCombat walks it. */
    if (h.actUsed) {
      this.faceTowards(h, foe.x, foe.z, dt);
      return;
    }

    /* In-range tactical repositioning: combatMove smoothly orbits and shuffles at weapon reach */
    if (cm > 0.12) {
      this.combatMove(h, foe, atk, dt);
    } else {
      h.combatFoe = foe;
      h.moving = false;
    }
    this.faceTowards(h, foe.x, foe.z, dt);

    /* Queued Action execution (from character card ability click) */
    const d = h.data;
    const queuedKey = (d && d._queuedAction) || h._queuedAction;
    if (queuedKey) {
      if (d) d._queuedAction = null;
      h._queuedAction = null;
      if (typeof this.refreshHud === 'function') this.refreshHud();
      let executed = false;
      if (queuedKey.startsWith('spell:')) {
        const spellKey = queuedKey.replace('spell:', '');
        executed = this.manualCastSpell(h, spellKey);
      } else {
        executed = this.manualPerformBonusAbility(h, queuedKey);
      }
      if (executed && d) {
        this.fxLog(`⚡ ${d.name} executes queued action!`, 'crit');
      }
    }

    /* AI potion: if this hero's HP is below their Auto-Potion Trigger, drink from
       the shared stash. Costs the turn just like an attack. Off => never. */
    {
      const pt = this.getPotionHpThreshold(h);
      if (pt > 0 && h.data.hp > 0 && h.data.hp / h.data.maxHp < pt) {
        const kind = this.potions.heal > 0 ? 'heal'
          : (this.potions.greater > 0 ? 'greater'
          : (this.potions.superior > 0 ? 'superior' : null));
        if (kind) {
          this.potions[kind]--;
          const amt = kind === 'superior' ? roll(8, 4, 8) : kind === 'greater' ? roll(4, 4, 4) : roll(2, 4, 2);
          h.data.hp = Math.min(h.data.maxHp, h.data.hp + amt);
          this.fxText('+' + amt, this._v3(h.x, 1.3, h.z), '#6ae0ff');
          this.fxLog(`🧪 ${h.data.name} drinks a potion (+${amt}).`, 'heal');
          this.fxDrawBar(h.ent.bar, h.data.hp / h.data.maxHp);
          this.refreshHud();
          this.refreshResources();
          Trace.on && Trace.record(h, 'heal', 'drank a potion at low HP (+' + amt + ')');
          h.actUsed = true;
          return;
        }
      }
    }

    /* heal threshold scales with the Ability & Spell Budget weight: 0.5 (Balanced)
       ≈ original (0.45), Unleash tops off sooner, Conservative waits. Blocked
       entirely at Conservative (weight 0). */
    const healThresh = 0.2 + 0.5 * abilityUse;

    /* Healing is no longer special-cased here. Cure Wounds is an ordinary
       level-1 slot spell on the healer's known list, so it competes for slots
       through the normal spell AI (_pickKnownSpell scores it via
       ai.when:'hurtAlly') like every other spell. */

    /* Lay on Hands (paladin) */
    if (abilityUse > 0 && hasFeature(h.data, 'layOnHands') && (h.data.layOnHands || 0) > 0) {
      let worst = null, wf = healThresh;
      for (const a of this.heroes) {
        const f = Math.max(0, a.data.hp / a.data.maxHp);
        if (f < wf) { wf = f; worst = a; }
      }
      if (worst) {
        const spend = Math.min(h.data.layOnHands, 10 + h.data.level);
        h.data.layOnHands -= spend;
        h.actUsed = true;
        this.healHero(worst, spend + h.data.healBonus);
        Trace.on && Trace.record(h, 'heal', 'Lay on Hands -> ' + worst.data.name + ' (+' + spend + ')');
        this.playAbilityFx(h, 'layOnHands', { at: worst, spell: true });
        this.fxLog(`🙏 ${h.data.name} uses Lay on Hands on ${worst.data.name} (+${spend}).`, 'heal');
        this.refreshAbilityHud();
        return;
      }
    }

    h.actUsed = true;

    /* Action economy: a spotlight grants one action + one bonus action. The
       bonus-action flags (h._bonusActed / h._bonusLeveled) are reset at the
       start of the turn in initiative.js _beginTurn — NOT here — so the reflex
       phase (runCombatReflexes, above) and this attack/spell phase share the
       same single bonus action for the turn. */

    /* known spells (learned via progression) */
    const sc = subclassOf(h.data);
    if (abilityUse > 0) {
      /* Bonus-action phase: cast a bonus-action spell (Healing Word, Hex,
         Hunter's Mark, Misty Step…) WITHOUT ending the turn, then fall through
         to the action below. For buff-then-swing spells (Hex, Hunter's Mark,
         Thunderous Smite) this means the same-turn weapon attack benefits. */
      this.tryCastBonusSpell(h, foe, alive);
      /* Action phase: a leveled action-spell. 5e bonus-spell rule — if a leveled
         spell was already cast as a bonus action this turn, the action can only
         be a weapon attack or cantrip, not a second leveled spell. */
      if (!h._bonusLeveled) {
        if (this.tryCastKnownSpell(h, foe, alive)) { this.heroPostAttackWithdraw(h, atk, dt); return; }
        if (sc && this.castSubclassSpell(h, sc, foe, alive)) { this.heroPostAttackWithdraw(h, atk, dt); return; }
      }
    }

    Trace.on && Trace.record(h, 'attack',
      `${atk.source || (atk.melee ? 'melee' : 'ranged')} → ${foe.data.name} at ${gridFeet(this, h, foe)} ft (reach ${attackRange * 5} ft)`);
    const opts = this.buildAttackOpts(h, foe, sc);
    opts.profile = atk;
    this.beginBlastAction(h, atk);
    const delaySec = this.heroPerformAttack(h, foe, alive, opts);
    this.fireExtraBeams(h, foe, alive, atk);

    /* Extra Attack / Improved Extra Attack */
    let attacks = 1;
    if (hasFeature(h.data, 'extraAttack2')) attacks = 3;
    /* Thirsting Blade is the warlock's invocation-flavoured Extra Attack, and
       like Extra Attack it is a weapon thing — it must not double the beams. */
    else if (hasFeature(h.data, 'extraAttack')
          || (hasFeature(h.data, 'thirstingBlade') && !atk.beams)) attacks = 2;
    /* Follow-up swings ride the combat clock (see scheduleFollowUpStrike):
       each one starts once the previous animation has finished, however the
       speed slider or hit-stop has stretched it. */
    const interval = strikeInterval(delaySec);
    const followUp = (delay, profile) => scheduleFollowUpStrike(this, h, delay, () => {
      if (foe && foe.data && foe.data.hp > 0 && h.data && h.data.hp > 0) {
        this.heroPerformAttack(h, foe, alive, { profile });
      }
    });
    for (let i = 1; i < attacks; i++) followUp(i * interval, atk);

    /* Feat-granted bonus strikes (Polearm Master butt-end, Crossbow Expert). */
    if (atk.source === 'weapon') {
      const feExtra = featExtraAttacks(h.data);
      for (let i = 0; i < feExtra; i++) followUp((attacks + i) * interval, atk);
    }

    /* Two-Weapon Fighting (5e): when dual-wielding two light weapons, the
       off hand lands one bonus-action attack this turn. No ability mod to its
       damage (the noAbilityMod flag is set on the offhand profile). Only fires
       when the main attack this turn was a weapon swing, not a cantrip — and
       only if the hero hasn't already spent its bonus action (e.g. on Healing
       Word or another bonus-action ability). Claims the bonus action. */
    if (atk.source === 'weapon' && h.data.offhandProfile && foe.data.hp > 0 && !h._bonusActed) {
      const offDelay = (attacks + featExtraAttacks(h.data)) * interval;
      h._bonusActed = true;
      followUp(offDelay, h.data.offhandProfile);
    }

    /* Action Surge (class feature or Champion subclass) — only when it matters */
    const surgeWorthy = foe.data.hp / Math.max(foe.data.maxHp, 1) > 0.30 || foe.isBoss || this.monsterEliteRoom(foe);
    const canSurge = abilityUse > 0
      && (hasFeature(h.data, 'actionSurgeClass') || (sc && sc.active.key === 'actionSurge'))
      && hasCharge(h.data, 'actionSurgeClass') && foe.data.hp > 0 && surgeWorthy && !h._abilityUsedThisCycle;
    if (canSurge) {
      spendCharge(h.data, 'actionSurgeClass'); h._abilityUsedThisCycle = true;
      this.playAbilityFx(h, 'actionSurge', { at: h });
      this.fxLog(`⚔ ${h.data.name} surges with action — attacking again!`, 'crit');
      followUp((attacks + 1.0) * interval, atk);
      this.refreshAbilityHud();
    }

    /* Flurry of Blows (bonus action) — spends 1 Ki to make 2 unarmed strikes */
    else if (abilityUse > 0 && hasFeature(h.data, 'flurryOfBlows') && hasKi(h.data, 1) && foe.data.hp > 0
        && surgeWorthy && !h._abilityUsedThisCycle && !h._bonusActed) {
      spendKi(h.data, 1); h._abilityUsedThisCycle = true; h._bonusActed = true;
      this.playAbilityFx(h, 'flurry', { at: foe });
      this.fxLog(`👊 ${h.data.name} spends 1 Ki for Flurry of Blows! (2 strikes)`, 'crit');
      const unarmedProf = unarmedFallback(h.data);
      const flurryDelay = this.heroPerformAttack(h, foe, alive, { profile: unarmedProf });
      followUp(strikeInterval(flurryDelay), unarmedProf);
      this.refreshAbilityHud();
    }

    /* Martial Arts (bonus action) — 1 free unarmed strike after attacking */
    else if (hasFeature(h.data, 'martialArts') && foe.data.hp > 0
        && !h._abilityUsedThisCycle && !h._bonusActed) {
      h._abilityUsedThisCycle = true; h._bonusActed = true;
      const unarmedProf = unarmedFallback(h.data);
      followUp(interval, unarmedProf);
    }

    /* Berserker frenzy (bonus-action attack) — don't waste on near-dead foes */
    else if (abilityUse > 0 && sc && sc.active.key === 'frenzy' && hasCharge(h.data, 'frenzy') && foe.data.hp > 0
        && h.raging && foe.data.hp / Math.max(foe.data.maxHp, 1) > 0.35 && !h._abilityUsedThisCycle && !h._bonusActed) {
      spendCharge(h.data, 'frenzy'); h._abilityUsedThisCycle = true; h._bonusActed = true;
      this.playAbilityFx(h, 'frenzy', { at: foe });
      this.fxLog(`😤 ${h.data.name} frenzies — another strike!`, 'crit');
      this.heroPerformAttack(h, foe, alive, { profile: atk });
      this.refreshAbilityHud();
    }

    /* The shot is away — a pinned archer now gives ground on leftover movement.
       Costs no action, so unlike the old Disengage-first kite this can never
       blank the turn. */
    this.heroPostAttackWithdraw(h, atk, dt);
  },

  /* defensive / buff reflexes that fire outside the attack cadence
   *   Now staggered: only ONE reflex fires per cycle, and most require
   *   a minimum combat duration so we don't dump everything on frame 1. */
  runCombatReflexes(h, alive, foe) {
    const d = h.data;
    let hudDirty = false;

    /* Rage expiry handled by tickEffects in game loop */

    const sc = subclassOf(d);

    /* ── Second Wind (bonus action) — immediate save if critically low ── */
    if ((d.secondWind || hasFeature(d, 'secondWind')) && !d.secondWindUsed && d.hp < d.maxHp * 0.3 && !h._bonusActed) {
      d.secondWindUsed = true; h._abilityUsedThisCycle = true; h._bonusActed = true;
      const amt = roll(1, 10, d.level);
      d.hp = Math.min(d.maxHp, d.hp + amt);
      this.playAbilityFx(h, 'secondWind', { at: h });
      this.fxText('+' + amt, this._v3(h.x, 1.55, h.z), '#6ae06a');
      this.fxDrawBar(h.ent.bar, d.hp / d.maxHp);
      this.fxLog(`${d.name} catches a second wind (+${amt}).`, 'heal');
      hudDirty = true;
    }

    /* ── Cunning Action — dodge when bloodied ── */
    if (!h._abilityUsedThisCycle) {
      const cunning = hasFeature(d, 'cunningActionClass') || (sc && sc.active.key === 'cunningAction');
      if (cunning && hasCharge(d, 'cunningActionClass') && d.hp < d.maxHp * 0.35 && !h._bonusActed) {
        spendCharge(d, 'cunningActionClass'); h._abilityUsedThisCycle = true; h._bonusActed = true;
        applyEffect(h, 'hasted', { duration: 30, elapsed: this.fxNow });
        this.playAbilityFx(h, 'cunningAction', { at: h });
        this.fxLog(`💨 ${d.name} uses Cunning Action — darting clear! (+4 AC, +40% speed)`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Patient Defense (monk, bonus action) — spend 1 Ki to Dodge when hard-pressed ── */
    if (!h._abilityUsedThisCycle && !h._bonusActed) {
      if ((hasFeature(d, 'patientDefense') || hasFeature(d, 'flurryOfBlows')) && hasKi(d, 1)
          && d.hp < d.maxHp * 0.5 && this._combatStable(1.0)) {
        spendKi(d, 1); h._abilityUsedThisCycle = true; h._bonusActed = true;
        applyEffect(h, 'patientDefense', { duration: ROUND_SECONDS, elapsed: this.fxNow });
        this.playAbilityFx(h, 'patientDefense', { at: h });
        this.fxLog(`🛡 ${d.name} spends 1 Ki on Patient Defense — dodging! (+5 AC)`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Step of the Wind (monk, bonus action) — spend 1 Ki to Dash/Disengage when surrounded ── */
    if (!h._abilityUsedThisCycle && !h._bonusActed) {
      if (hasFeature(d, 'stepOfTheWind') && hasKi(d, 1) && d.hp < d.maxHp * 0.4
          && this.monsters.filter(m => m.active && m.data && m.data.hp > 0 && Math.hypot(m.x - h.x, m.z - h.z) < 2.0).length >= 2) {
        spendKi(d, 1); h._abilityUsedThisCycle = true; h._bonusActed = true;
        applyEffect(h, 'hasted', { duration: 6.0, elapsed: this.fxNow });
        this.playAbilityFx(h, 'stepOfTheWind', { at: h });
        this.fxLog(`💨 ${d.name} spends 1 Ki on Step of the Wind — darting away! (+4 AC, +40% speed)`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Fast Hands (Thief subclass active) — smoke bomb blinding nearby foes ── */
    if (!h._abilityUsedThisCycle) {
      if (sc && sc.active.key === 'fastHands' && hasCharge(d, 'fastHands') && !h._bonusActed
          && this.monsters.some(m => m.data.hp > 0 && Math.hypot(m.x - h.x, m.z - h.z) < 4.0)) {
        spendCharge(d, 'fastHands'); h._abilityUsedThisCycle = true; h._bonusActed = true;
        this.playAbilityFx(h, 'fastHands', { at: h });
        this.fxLog(`💨 ${d.name} uses Fast Hands to throw a smoke bomb!`, 'heal');
        for (const m of this.monsters) {
          if (m.data.hp > 0 && Math.hypot(m.x - h.x, m.z - h.z) < 4.0) {
            applyEffect(m, 'blinded', { duration: 6, elapsed: this.fxNow, source: h });
            this.fxText('BLINDED', this._v3(m.x, 1.3, m.z), '#888899');
          }
        }
        hudDirty = true;
      }
    }

    /* ── Remarkable Athlete (Champion subclass active) ── */
    if (!h._abilityUsedThisCycle) {
      if (sc && sc.active.key === 'remarkableAthlete' && hasCharge(d, 'remarkableAthlete')
          && this._combatStable(1.5)) {
        spendCharge(d, 'remarkableAthlete'); h._abilityUsedThisCycle = true;
        applyEffect(h, 'remarkableAthlete', { duration: 30, elapsed: this.fxNow });
        this.playAbilityFx(h, 'remarkableAthlete', { at: h });
        this.fxLog(`🏃 ${d.name} uses Remarkable Athlete — physical peak reached! (+2 AC, +10% speed)`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Rage — fire on the first available turn of a real fight.
       Rage is a fixed-duration buff, so holding it until the barbarian is
       hurt wastes most of its uptime; the damage reduction is worth most
       while the hits are still incoming. Gate on a live hostile in reach
       rather than on HP so it doesn't burn on a fleeing straggler. ── */
    if (!h._abilityUsedThisCycle) {
      const rageWorthIt = this.monsters.some(m =>
        m.data.hp > 0 && !m.dead && Math.hypot(m.x - h.x, m.z - h.z) < 12);
      if (hasFeature(d, 'rage') && hasCharge(d, 'rage') && rageWorthIt && !h._bonusActed) {
        spendCharge(d, 'rage'); h._abilityUsedThisCycle = true; h._bonusActed = true;
        applyEffect(h, 'raging', { duration: 30, elapsed: this.fxNow });
        this.playAbilityFx(h, 'rage', { at: h, scale: 1.7 });
        this.fxLog(`😡 ${d.name} enters a Rage!`, 'crit');
        hudDirty = true;
      }
    }

    /* ── Bear Totem — emergency DR for bear barbarians ── */
    if (!h._abilityUsedThisCycle) {
      if (sc && sc.active.key === 'bearTotem' && hasCharge(d, 'bearTotem') && d.hp < d.maxHp * 0.35) {
        spendCharge(d, 'bearTotem'); h._abilityUsedThisCycle = true;
        applyEffect(h, 'bearTotem', { duration: 30, elapsed: this.fxNow });
        this.playAbilityFx(h, 'bearTotem', { at: h, scale: 1.6 });
        this.fxLog(`🐻 ${d.name} summons the Bear Totem — damage halved!`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Bardic Inspiration — don't inspire in the first 2s, wait for real trouble ── */
    if (!h._abilityUsedThisCycle) {
      if (hasFeature(d, 'bardicInspiration') && hasCharge(d, 'bardicInspiration') && alive.length >= 2
          && this._combatStable(2.0) && !h._bonusActed) {
        const anyHurt = alive.some(a => a.data.hp < a.data.maxHp * 0.6);
        const uninspiredAllies = alive.filter(a => !hasEffect(a, 'inspired'));
        if (anyHurt && uninspiredAllies.length > 0) {
          spendCharge(d, 'bardicInspiration'); h._abilityUsedThisCycle = true; h._bonusActed = true;
          for (const a of alive)
            applyEffect(a, 'inspired', { duration: Infinity, elapsed: this.fxNow });
          this.playAbilityFx(h, 'bardic', { at: h, alsoAt: alive, spell: true });
          this.fxLog(`🎵 ${d.name} inspires the party! (advantage on next attack)`, 'heal');
          hudDirty = true;
        }
      }
    }

    /* ── Wild Shape — druid transform ── */
    if (!h._abilityUsedThisCycle) {
      if (shouldAutoWildShape(d)) {
        spendCharge(d, 'wildShapeClass'); h._abilityUsedThisCycle = true;
        Trace.on && Trace.record(h, 'shift', `Wild Shape at ${d.hp}/${d.maxHp} HP`);
        this.activateWildShape(h);
        hudDirty = true;
      }
    }

    /* ── Combat Inspiration (Valor bard) — requires combat to be underway ── */
    if (!h._abilityUsedThisCycle) {
      if (sc && sc.active.key === 'combatInspiration' && hasCharge(d, 'combatInspiration')
          && this._combatStable(2.5) && alive.length >= 2) {
        const anyHurt = alive.some(a => a.data.hp < a.data.maxHp * 0.65);
        const uninspiredAllies = alive.filter(a => !hasEffect(a, 'inspired'));
        if (anyHurt && uninspiredAllies.length > 0) {
          spendCharge(d, 'combatInspiration'); h._abilityUsedThisCycle = true;
          for (const a of alive)
            applyEffect(a, 'inspired', { duration: Infinity, elapsed: this.fxNow });
          this.playAbilityFx(h, 'combatSong', { at: h, alsoAt: alive, spell: true });
          this.fxLog(`🎶 ${d.name} plays a battle song! (advantage on next attack)`, 'heal');
          hudDirty = true;
        }
      }
    }

    if (hudDirty) this.refreshAbilityHud();
  },

  buildAttackOpts(h, foe, sc) {
    const opts = {};
    const d = h.data;
    let hudDirty = false;
    const stable = this._combatStable(1.5);
    if (sc && hasCharge(d, sc.active.key)) {
      if (sc.active.key === 'deathstrike' && foe.data.hp >= foe.data.maxHp
          && this._worthSpending(h, foe, null, 'normal')) {
        spendCharge(d, 'deathstrike'); opts.autoCrit = true;
        this.playAbilityFx(h, 'deathstrike', { at: foe });
        this.fxLog(`🗡 ${d.name} lines up an Assassinate!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'guidedStrike' && (foe.isBoss || this.monsterEliteRoom(foe))
          && this._worthSpending(h, foe, null, 'high')) {
        spendCharge(d, 'guidedStrike'); opts.atkBonus = 10; opts.extraDmg = roll(2, 8);
        this.playAbilityFx(h, 'guidedStrike', { at: foe, spell: true });
        this.fxLog(`⚡ ${d.name} calls a Guided Strike! (+10 to hit, +2d8)`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'vowOfEnmity' && (foe.isBoss || this.monsterEliteRoom(foe))
          && this._worthSpending(h, foe, null, 'high')) {
        spendCharge(d, 'vowOfEnmity'); opts.adv = (opts.adv || 0) + 1;
        this.playAbilityFx(h, 'vowOfEnmity', { at: foe, spell: true });
        this.fxLog(`⚔️ ${d.name} swears a Vow of Enmity! (advantage)`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'shadowStep' && stable
          && this._worthSpending(h, foe, null, 'low')) {
        spendCharge(d, 'shadowStep'); opts.atkBonus = 4; opts.extraDmg = roll(2, 6);
        this.playAbilityFx(h, 'shadowStep', { at: foe });
        this.fxLog(`🌑 ${d.name} Shadow Steps behind the foe!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'sacredWeapon' && stable
          && this._worthSpending(h, foe, null, 'normal')) {
        spendCharge(d, 'sacredWeapon');
        applyEffect(h, 'sacredWeapon', { duration: 30, elapsed: this.fxNow });
        this.playAbilityFx(h, 'sacredWeapon', { at: h, spell: true });
        this.fxLog(`✨ ${d.name} blesses their weapon!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'colossusSlayer' && foe.data.hp < foe.data.maxHp
          && this._worthSpending(h, foe, null, 'low')) {
        spendCharge(d, 'colossusSlayer'); opts.extraDmg = roll(1, 8);
        this.playAbilityFx(h, 'colossusSlayer', { at: foe });
        this.fxLog(`🏹 ${d.name}'s Colossus Slayer finds the wound!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'summonCompanion' && stable
          && this._worthSpending(h, foe, null, 'normal') && this.summons) {
        /* Beast Master: summon (or mid-fight revive) the wolf companion.
           If a wolf is already alive, the charge is left untouched — there is
           nothing to summon. A downed wolf is revived at full HP. */
        const wolf = this.summons.getActive('wolf', h);
        if (!wolf || wolf.data.hp <= 0) {
          spendCharge(d, 'summonCompanion');
          if (wolf) this.summons.revive('wolf', h, 1);
          else      this.summons.spawn(h, 'wolf');
          this.playAbilityFx(h, 'summonCompanion', { at: h });
          this.fxLog(`🐺 ${d.name} calls forth a wolf companion!`, 'crit');
          hudDirty = true;
        }
      } else if (sc.active.key === 'quiveringPalm' && (foe.isBoss || this.monsterEliteRoom(foe))
          && this._worthSpending(h, foe, null, 'high')) {
        spendCharge(d, 'quiveringPalm'); opts.extraDmg = roll(4, 10);
        this.playAbilityFx(h, 'quiveringPalm', { at: foe });
        this.fxLog(`✋ ${d.name} delivers Quivering Palm!`, 'crit');
        hudDirty = true;
      }
    }
    if (hasFeature(d, 'divineSmite') && !d.smiteUsed
        && (foe.isBoss || this.monsterEliteRoom(foe))
        && this._worthSpending(h, foe, null, 'high')) {
      d.smiteUsed = true;
      opts.extraDmg = (opts.extraDmg || 0) + roll(2, 8);
      this.playAbilityFx(h, 'divineSmite', { at: foe, spell: true });
      this.fxLog(`💫 ${d.name} Divine Smites!`, 'crit');
      hudDirty = true;
    }
    if (hasFeature(d, 'tidesOfChaos') && !d.tidesUsed && stable
        && this._worthSpending(h, foe, null, 'normal')) {
      d.tidesUsed = true;
      opts.adv = (opts.adv || 0) + 1;
      this.playAbilityFx(h, 'tidesOfChaos', { at: h, spell: true });
      this.fxLog(`🌀 ${d.name} rides the Tides of Chaos! (advantage)`, 'crit');
      hudDirty = true;
    }
    if (hudDirty) this.refreshAbilityHud();
    if (hasFeature(d, 'colossusSlayerClass') && foe.data.hp < foe.data.maxHp) {
      opts.extraDmg = (opts.extraDmg || 0) + roll(1, 8);
    }
    /* Reckless Attack: advantage on the attack (monsters get advantage back) */
    if (hasEffect(h, 'raging') && hasFeature(d, 'recklessAttack')) opts.adv = (opts.adv || 0) + 1;
    if (hasEffect(h, 'raging')) opts.extraDmg = (opts.extraDmg || 0) + 2;
    /* sacredWeapon's +4 to hit comes from its effect mods in heroAttackRoll */
    if (hasEffect(h, 'sacredWeapon')) {
      opts.extraDmg = (opts.extraDmg || 0) + roll(1, 8);
    }
    const hexEff = getEffect(foe, 'hexMarked');
    if (hexEff && hexEff.source === h) opts.extraDmg = (opts.extraDmg || 0) + roll(1, 6);
    const markEff = getEffect(foe, 'huntersMarked');
    if (markEff && markEff.source === h) opts.extraDmg = (opts.extraDmg || 0) + roll(1, 6);
    if (h.smiteNext) {
      opts.extraDmg = (opts.extraDmg || 0) + roll(2, 6);
      h.smiteNext = false;
    }
    if (hasFeat(d, 'mageSlayer') && (foe.isBoss || this.monsterEliteRoom(foe))) {
      opts.extraDmg = (opts.extraDmg || 0) + 2;
    }
    /* subclass passive: conditional to-hit / bonus damage */
    this.subclassAttackMods(h, foe, opts);
    return opts;
  },

  /**
   * Face the target and begin playing the hero's full attack animation sequence
   * (slash, thrust, shoot, or spellcast). Returns the animation duration in seconds.
   */
  heroStartAttackAnim(h, foe, profile = null) {
    if (!h || !foe) return 0;
    const dx = (foe.x ?? 0) - (h.x ?? 0);
    const dz = (foe.z ?? 0) - (h.z ?? 0);
    const d = Math.hypot(dx, dz) || 1;
    h.attackTargetDX = dx / d;
    h.attackTargetDZ = dz / d;

    if (!h.ent || !h.ent.anim) return 0;

    let action = 'slash';
    if (typeof h.ent.anim.resolveAttackAction === 'function') {
      action = h.ent.anim.resolveAttackAction(profile);
    } else {
      const c = h.data?.classKey;
      const casters = new Set(['wizard', 'cleric', 'sorcerer', 'warlock', 'druid', 'bard']);
      const wpn = h.data?.equipment && h.data.equipment.weapon;
      const vw = (wpn && wpn.visualWeapon) || '';
      if (profile?.source === 'cantrip' || profile?.cantripScale || casters.has(c)) action = 'spellcast';
      else if (vw.startsWith('ranged/') || (profile && !profile.melee)) action = 'shoot';
      else if (vw === 'polearm/scythe') action = 'slash';
      else if (vw.startsWith('polearm/') || vw.startsWith('magic/')) action = 'thrust';
      else action = 'slash';
    }

    if (action === 'spellcast') h.castAnim = true;

    if (h.ent.anim.anims) {
      h.ent.anim.play('attack', true);
    } else {
      h.ent.anim.play(action, true);
    }

    /* Prefer the IMPACT delay over the full animation length, so the blow lands
       on the contact pose rather than after the swing has finished — the same
       timing monsters already use (monster_ai.js:889). For LPC heroes the two
       are identical, since HeroSprite.attackImpactDelay() just returns
       attackDuration(); the difference only shows on frame-sliced sheets
       (companions, wild-shape forms), where sprite_atlas.js puts contact at
       ATTACK_IMPACT_FRAC = 2/3 of the way through. */
    const dur = typeof h.ent.anim.attackImpactDelay === 'function'
      ? h.ent.anim.attackImpactDelay(action)
      : (typeof h.ent.anim.attackDuration === 'function' ? h.ent.anim.attackDuration(action) : 0.6);
    return Math.max(0.1, dur);
  },

  /**
   * Executes a hero attack: starts the animation, then triggers the physical
   * lunge and rolls to-hit/damage dice at the CONTACT POSE rather than after the
   * animation has finished. heroStartAttackAnim returns that impact delay.
   */
  heroPerformAttack(h, foe, alive, opts = {}) {
    const profile = opts.profile || h.data?.lastProfile || h.data?.weaponProfile;
    const animDur = this.heroStartAttackAnim(h, foe, profile);
    const delaySec = (this.fxImpactDelay && animDur > 0) ? animDur : 0;

    if (delaySec > 0) {
      this.fxImpactDelay(delaySec, () => {
        if (!foe || foe.dead || (foe.data && foe.data.hp <= 0) || !h || h.dead || (h.data && h.data.hp <= 0)) return;
        this.heroAttackRoll(h, foe, alive, opts);
      });
    } else {
      this.heroAttackRoll(h, foe, alive, opts);
    }
    return delaySec;
  },

  /* one d20 attack roll + resolution (extracted so Action Surge can repeat it) */
  heroAttackRoll(h, foe, alive, opts = {}) {
    const cls = CLASSES[h.data.classKey];
    /* Profile (weapon/cantrip/unarmed) is threaded in from heroCombat; falls
       back to the cached lastProfile if a caller omitted it. */
    const profile = opts.profile || h.data.lastProfile || h.data.weaponProfile || cls.attack;
    const isCantrip = !!(profile.isSave || profile.cantripScale || profile.source === 'cantrip');

    /* 5e advantage/disadvantage: sum sources, roll 2d20 take high/low */
    const selfMods = getEffectMods(h);
    const foeMods = getEffectMods(foe);
    let adv = opts.adv || 0;
    if (foeMods.defAdvantage) adv += 1;        // foe blinded / paralyzed / faerie-fired…
    if (selfMods.atkDisadvantage) adv -= 1;    // attacker poisoned / frightened / prone…
    if (selfMods.atkAdvantage) adv += selfMods.atkAdvantage; // Bardic Inspiration advantage

    /* Boss intel (foreshadow phase): the party knows the final boss's weaknesses */
    const qIntel = this.activeQuest;
    const intel = !!(qIntel && qIntel.bossIntel && foe.isBoss
      && (this.questFloor | 0) >= (qIntel.floors | 0));
    if (intel && !this._intelLogged) {
      this._intelLogged = true;
      this.fxLog('🔎 The party knows this foe — they strike where the old warnings said to strike.', 'story');
    }

    let miss = false;
    let crit = false;
    let total = 0;
    let vs = '';
    let d20 = 0;
    let atkBonus = 0;

    if (isCantrip) {
      /* Cantrips target a saving throw instead of Armor Class:
         - Fire Bolt: DEX Save
         - Eldritch Blast: CHA Save
         - Chill Touch: CON Save
         - Produce Flame: WIS Save
         - Sacred Flame: DEX Save */
      const dc = spellDC(h);
      const saveAb = profile.saveAbility || CANTRIP_SAVE_ABILITY[profile.nameKey] || 'dex';
      /* In D&D 5e, target rolling a save: advantage on attacker translates to disadvantage on target's save */
      const saveRes = rollSaveDetail(foe, saveAb, dc, { magic: true, adv: -adv });
      d20 = saveRes.d20;
      total = saveRes.total;
      vs = `(${saveAb.toUpperCase()} save: ${total} vs DC ${dc})`;
      miss = saveRes.saved;
      crit = !miss && (d20 === 1 || !!opts.autoCrit);
      if (miss) {
        this.fxLog(`${foe.data.name} succeeds on ${saveAb.toUpperCase()} save vs ${h.data.name}'s ${profile.name}! (no damage)`, 'miss', { detail: vs });
      } else {
        this.fxLog(`${foe.data.name} fails ${saveAb.toUpperCase()} save vs ${h.data.name}'s ${profile.name}!`, 'roll', { detail: vs });
      }
    } else {
      /* Standard weapon/unarmed attack roll vs Armor Class */
      d20 = d20Roll(adv);
      /* Consume one-shot attack buffs (Bardic Inspiration: advantage on next attack) */
      if (selfMods.atkAdvantage && hasEffect(h, 'inspired')) clearEffect(h, 'inspired');
      if (d20 === 1 && RACES[h.data.raceKey].lucky) d20 = die(20);
      /* Compose the to-hit bonus from the profile's ability + cached proficiency/gear. */
      const baseAtk = h.data.atkProf + mod(h.data.effStats[profile.ability]);
      atkBonus = baseAtk + (opts.atkBonus || 0) + selfMods.atkBonus;
      if (selfMods.blessDice) atkBonus += die(4);   // Bless / inspiration: +1d4 to hit
      if (intel) atkBonus += 2;

      crit = !!opts.autoCrit || d20 >= h.data.critRange;
      total = d20 + atkBonus;
      /* Foe AC reflects active effects (bossWeakened -2, faerieFire, etc.) */
      const foeAc = foe.data.ac + foeMods.acBonus;
      miss = !crit && total < foeAc;
      /* paralyzed / unconscious foes: any melee hit is a critical (5e) */
      if (!miss && foeMods.autoCritMelee && profile.melee) crit = true;
      if (crit) { this.triggerHitStop(3); }

      /* Indomitable (long rest) / Lucky feat (short rest): convert a miss */
      if (miss && hasFeature(h.data, 'indomitable') && hasCharge(h.data, 'indomitable')) {
        spendCharge(h.data, 'indomitable');
        miss = false;
        this.playAbilityFx(h, 'indomitable', { at: h });
        this.fxLog(`🛡 ${h.data.name} is Indomitable — the miss becomes a hit!`, 'crit');
        this.refreshAbilityHud();
      } else if (miss && hasFeat(h.data, 'lucky') && hasCharge(h.data, 'lucky')) {
        spendCharge(h.data, 'lucky');
        miss = false;
        this.playAbilityFx(h, 'lucky', { at: h });
        this.fxLog(`🍀 ${h.data.name}'s Lucky feat turns a miss into a hit!`, 'crit');
        this.refreshAbilityHud();
      }

      const advTag = adv > 0 ? ', adv' : adv < 0 ? ', dis' : '';
      /* The roll math states its own total, so the line never has to print the
         number twice — "hit, 13 dmg 13 (6+7 vs AC 13)" read as though 13 meant
         two different things, because it did. */
      vs = `(${d20}+${atkBonus}=${total} vs AC ${foeAc}${advTag})`;
      if (crit && !miss) this.fxLog(`💥 ${h.data.name} crits ${foe.data.name}!`, 'crit',
        { detail: opts.autoCrit ? '(Assassinate)' : `(nat ${d20})` });
      else if (miss) this.fxLog(`${h.data.name} → ${foe.data.name}: miss ${vs}`, 'miss');
    }

    let dmg = 0, sneak = false;
    if (!miss) {
      let wasCrit = crit;
      dmg = heroDamage(h.data, wasCrit, profile) + (opts.extraDmg || 0);
      if (wasCrit && hasFeature(h.data, 'brutalCritical') && profile.melee) {
        dmg += die(profile.dmg[1] || 6);
      }
      if (h.wildShapeUntil > this.elapsed) dmg += roll(2, 6);
      if (cls.sneakDice || hasFeature(h.data, 'sneakAttack')) {
        const flanked = alive.some(a => a !== h && Math.hypot(a.x - foe.x, a.z - foe.z) < 1.7);
        if (flanked) {
          const dice = cls.sneakDice ? cls.sneakDice(h.data.level) : Math.ceil(h.data.level / 2);
          dmg += roll(dice, 6); sneak = true;
        }
      }
      /* Agonizing Blast: CHA to cantrip damage for warlocks */
      if (hasFeature(h.data, 'agonizingBlast') && profile.cantripScale) {
        dmg += mod(h.data.effStats.cha);
      }
      /* Feat conditional bonus damage (GWM / Sharpshooter / Charger / Grappler /
         Mounted Combatant / Spell Sniper / Skulker / Keen Mind). */
      dmg += featBonusDamage(h.data, {
        profile,
        weapon: h.data.equipment && h.data.equipment.weapon,
        foeFullHp: foe.data.hp >= foe.data.maxHp,
        foeElite: foe.isBoss || this.monsterEliteRoom(foe),
        foeImpaired: hasEffect(foe, 'slowed') || hasEffect(foe, 'prone') || hasEffect(foe, 'restrained')
      });
      /* Legendary perk pre-damage modifiers (execute, first strike, crit surge) */
      dmg = this.applyPerkDamageMods(h, foe, dmg, wasCrit);
      if (intel) dmg = Math.round(dmg * 1.25);
    }

    /* Logged from the resolution callback, not here: `dmg` at this point is the
       raw roll, and damageMonster still has resistance, immunity and the
       elemental split to apply. Printing it up front made the combat log
       contradict the number that appears over the target's head. */
    this.strike(h, foe, dmg, crit && !miss, miss, alive, profile, (dealt, modLabel) => {
      if (isCantrip || miss || crit) return;
      /* Order: what happened, then how it was rolled, then the damage LAST —
         the number the player is actually looking for ends the line instead of
         sitting in the middle of the roll math. */
      const soak = modLabel === 'IMMUNE' ? ' (immune)'
        : (modLabel && dealt !== dmg) ? ` (${dmg} before resistance)` : '';
      this.fxLog(`${h.data.name} → ${foe.data.name}: hit ${vs}${sneak ? ' +sneak' : ''} — ${dealt} dmg${soak}`,
        'roll');
    });
  },

  /* ── Eldritch Blast ────────────────────────────────────────────────────────
     The blast used to exist twice: a full multi-beam implementation in
     SPELLS.eldritchBlast (reachable only from the manual cast button) and the
     ordinary cantrip attack the auto-battler actually runs, which knew about
     Agonizing Blast and nothing else. That is why the damage looked right
     while the knockback never happened and every level drew a single beam.
     The attack path now owns the beams, so both paths agree. */

  /** Reset the once-per-turn invocation riders at the start of an attack. */
  beginBlastAction(h, profile) {
    if (profile && profile.beams) h._blastRiders = { grasp: false, lance: false };
  },

  /** Beams 2..N of an Eldritch Blast, each its own attack roll, staggered so
   *  they read as separate bolts rather than one thick line. */
  fireExtraBeams(h, foe, alive, profile) {
    const beams = (profile && profile.beams) || 0;
    for (let i = 1; i < beams; i++) {
      /* Wider than the 140 ms the old spell-cast path used: that one drew an
         instant beam, while the cantrip attack plays a ~0.55 s travelling
         projectile. Too tight and consecutive bolts land on top of each other
         and read as a single hit that dealt damage twice. */
      scheduleFollowUpStrike(this, h, i * 0.22, () => {
        if (foe && foe.data && foe.data.hp > 0 && h.data && h.data.hp > 0) {
          this.heroAttackRoll(h, foe, alive, { profile });
        }
      });
    }
  },

  /** Repelling Blast / Grasp of Hadar / Lance of Lethargy, on a beam that hit.
   *  Repelling fires on every hit; Grasp and Lance are once per turn. */
  applyBlastRiders(h, foe) {
    if (!foe || !foe.data || foe.data.hp <= 0) return;
    const d = h.data;
    const once = h._blastRiders || (h._blastRiders = { grasp: false, lance: false });

    if (hasFeature(d, 'repellingBlast')) {
      if (this.pushEntity(foe, h.x, h.z, 2, 1) > 0) {
        this.fxLog(`💨 Repelling Blast shoves ${foe.data.name} back 10 ft!`, 'roll');
      }
    } else if (hasFeature(d, 'graspOfHadar') && !once.grasp) {
      once.grasp = true;
      if (this.pushEntity(foe, h.x, h.z, 2, -1) > 0) {
        this.fxLog(`🧲 Grasp of Hadar hauls ${foe.data.name} 10 ft closer!`, 'roll');
      }
    }

    if (hasFeature(d, 'lanceOfLethargy') && !once.lance) {
      once.lance = true;
      applyEffect(foe, 'slowed', { duration: ROUND_SECONDS, elapsed: this.fxNow, source: h });
      this.fxLog(`🐌 Lance of Lethargy saps ${foe.data.name}'s speed.`, 'roll');
    }
  },

  /** Pre-hit damage multipliers/adders from equipped legendary perks.
   *  Magnitudes scale with the item's found ilvl (perkMag band). */
  applyPerkDamageMods(h, foe, dmg, crit) {
    let d = dmg;
    const perks = equippedPerks(h.data);
    for (const { perk, item } of perks) {
      if (perk.id === 'execute' && foe.data.maxHp > 0 && foe.data.hp / foe.data.maxHp < 0.30) {
        d = Math.round(d * perkMag('execute', item.ilvl));
        this.fxText('EXECUTE', this._v3(foe.x, 1.4, foe.z), '#e8a83f');
      }
      if (perk.id === 'firstStrike' && !h._foughtThisCombat) {
        d = Math.round(d * perkMag('firstStrike', item.ilvl));
        this.fxText('FIRST STRIKE', this._v3(foe.x, 1.5, foe.z), '#8fd4e8');
      }
      if (perk.id === 'critSurge' && crit) {
        d += perkMag('critSurge', item.ilvl);
      }
    }
    return Math.max(0, d);
  },

  /** On-hit legendary perk procs (lifesteal, cleave, burn, chain, mana font). */
  applyOnHitPerks(h, foe, dmg, crit, alive) {
    if (dmg <= 0 || foe.dead) return;
    this.subclassOnHit(h, foe, dmg, crit);
    h._foughtThisCombat = true;
    const perks = equippedPerks(h.data, 'onHit').concat(
      equippedPerks(h.data, 'onCrit').filter(p => crit)
    );
    const seen = new Set();
    for (const { perk, item } of perks) {
      if (seen.has(perk.id)) continue;
      seen.add(perk.id);
      const id = perk.id;

      if (id === 'lifesteal') {
        const heal = Math.max(1, Math.round(dmg * perkMag('lifesteal', item.ilvl)));
        h.data.hp = Math.min(h.data.maxHp, h.data.hp + heal);
        this.fxText(`+${heal}`, this._v3(h.x, 1.35, h.z), '#e07070');
        this.fxDrawBar(h.ent.bar, h.data.hp / h.data.maxHp);
      }

      if (id === 'cleave' && (h.data.lastProfile || h.data.weaponProfile) && (h.data.lastProfile || h.data.weaponProfile).melee) {
        const splash = Math.max(1, Math.round(dmg * perkMag('cleave', item.ilvl)));
        let best = null, bestD = 2.4;
        for (const m of this.monsters) {
          if (m === foe || m.dead || m.data.hp <= 0) continue;
          const dd = Math.hypot(m.x - foe.x, m.z - foe.z);
          if (dd < bestD) { bestD = dd; best = m; }
        }
        if (best) {
          this.damageMonster(best, splash, h, false, { skipPerks: true });
          this.fxText('CLEAVE', this._v3(best.x, 1.3, best.z), '#e8a83f');
          this.fxSlash({ x: best.x, z: best.z }, 0xe8a83f, ((best.data && best.data.scale) || 1.0) * 0.8);
        }
      }

      if (id === 'burn') {
        const ticks = 3;
        const tickDmg = perkMag('burn', item.ilvl);
        foe.burn = { ticks, dmg: tickDmg, src: h, clock: this.fxNow };
        this.fxText('BURN', this._v3(foe.x, 1.2, foe.z), '#ff7a30');
        this.fxSprite('dcss/effect/flame_0.png',
          this._v3(foe.x, 0.5, foe.z), 0.9, 0.25);
      }

      if (id === 'chain' && !((h.data.lastProfile || h.data.weaponProfile) || {melee:true}).melee && Math.random() < perkMag('chain', item.ilvl)) {
        const arc = Math.max(1, Math.round(dmg * 0.5));
        let best = null, bestD = 4.5;
        for (const m of this.monsters) {
          if (m === foe || m.dead || m.data.hp <= 0) continue;
          const dd = Math.hypot(m.x - foe.x, m.z - foe.z);
          if (dd < bestD) { bestD = dd; best = m; }
        }
        if (best) {
          this.damageMonster(best, arc, h, false, { skipPerks: true });
          this.fxText('ARC', this._v3(best.x, 1.3, best.z), '#8fd4e8');
          this.fxSprite('dcss/effect/magic_bolt_1.png',
            this._v3(best.x, 0.5, best.z), 1.0, 0.25);
        }
      }

      if (id === 'manaFont' && Math.random() < perkMag('manaFont', item.ilvl)) {
        if (recoverSlots(h.data, 1) > 0) {
          this.fxText('+slot', this._v3(h.x, 1.5, h.z), '#b06cf0');
          this.fxLog(`✦ ${h.data.name}'s ${item.name} restores a spell slot!`, 'heal');
          this.refreshHud();
        }
      }

      if (id === 'critSurge' && crit) {
        this.fxSprite('dcss/effect/flame_0.png',
          this._v3(foe.x, 0.6, foe.z), 1.1, 0.3);
      }

      if (id === 'arcaneBurst') {
        const blastDmg = perkMag('arcaneBurst', item.ilvl) || 8;
        const nearby = this.monsters.filter(m => !m.dead && m.data.hp > 0 && Math.hypot(m.x - foe.x, m.z - foe.z) <= 2.0);
        for (const target of nearby) {
          this.damageMonster(target, blastDmg, h, false, { dmgType: 'force', magical: true, skipPerks: true });
        }
        this.fxText('ARCANE BURST', this._v3(foe.x, 1.4, foe.z), '#b06cf0');
        this.fxSprite('dcss/effect/magic_bolt_1.png', this._v3(foe.x, 0.5, foe.z), 1.5, 0.3);
      }

      if (id === 'frostBite') {
        applyEffect(foe, 'chilled', { duration: 3.0, elapsed: this.fxNow, source: h });
        this.fxText('FROSTBITE', this._v3(foe.x, 1.3, foe.z), '#8fd4e8');
        this.fxSprite('dcss/effect/cloud_magic_trail_0.png', this._v3(foe.x, 0.5, foe.z), 1.2, 0.3);
      }

      if (id === 'holySmite') {
        const smiteDmg = perkMag('holySmite', item.ilvl) || 10;
        this.damageMonster(foe, smiteDmg, h, false, { dmgType: 'radiant', magical: true, skipPerks: true });
        this.fxText('HOLY SMITE', this._v3(foe.x, 1.4, foe.z), '#ffe08a');
        this.fxSprite('dcss/effect/irradiate_0.png', this._v3(foe.x, 0.5, foe.z), 1.3, 0.3);
      }
    }
    /* Feat on-hit riders (Sentinel root, Shield Master shove, Grappler/Tavern
       Brawler stagger, Martial Adept maneuver). */
    this.applyFeatOnHit(h, foe, crit);
  },

  /** Apply feat on-hit status effects + bonus damage to a struck foe. */
  applyFeatOnHit(h, foe, crit) {
    if (foe.dead || foe.data.hp <= 0) return;
    const p = h.data.lastProfile || h.data.weaponProfile || { melee: true };
    const hasShield = !!(h.data.equipment && h.data.equipment.shield);
    const res = featOnHit(h.data, { melee: !!p.melee, crit, hasShield });
    for (const e of res.effects) {
      if (!hasEffect(foe, e.key)) {
        applyEffect(foe, e.key, { duration: e.duration, elapsed: this.fxNow, source: h });
      }
    }
    if (res.bonusDmg > 0) {
      this.fxText('MANEUVER', this._v3(foe.x, 1.4, foe.z), '#e8c25a');
      this.damageMonster(foe, res.bonusDmg, h, false, { dmgType: 'force', magical: true, skipPerks: true });
    }
  },

  /** Defensive perks when a hero takes damage (thorns, riposte). */
  applyOnDamagedPerks(h, attacker, dealt) {
    if (!attacker || dealt <= 0 || attacker.dead) return;
    const perks = equippedPerks(h.data, 'onDamaged');
    const seen = new Set();
    for (const { perk, item } of perks) {
      if (seen.has(perk.id)) continue;
      seen.add(perk.id);
      if (perk.id === 'thorns') {
        const thornDmg = perkMag('thorns', item.ilvl);
        attacker.data.hp -= thornDmg;
        this.fxText(String(thornDmg), this._v3(attacker.x, 1.1, attacker.z), '#6aea6a');
        if (attacker.data.hp <= 0) this.killMonster(attacker, h);
      }
      if (perk.id === 'riposte' && (h.data.lastProfile || h.data.weaponProfile) && (h.data.lastProfile || h.data.weaponProfile).melee) {
        const ret = perkMag('riposte', item.ilvl);
        attacker.data.hp -= ret;
        this.fxText('RIPOSTE', this._v3(attacker.x, 1.35, attacker.z), '#e8a83f');
        this.fxText(String(ret), this._v3(attacker.x, 1.1, attacker.z), '#ffd34a');
        this.fxSlash({ x: attacker.x, z: attacker.z }, 0xe8a83f, 0.7);
        if (attacker.data.hp <= 0) this.killMonster(attacker, h);
      }
    }
  },

  /** On-kill legendary perks. */
  applyOnKillPerks(h, m) {
    this.subclassOnKill(h, m);
    const perks = equippedPerks(h.data, 'onKill');
    for (const { perk, item } of perks) {
      if (perk.id === 'phaseStep') {
        const ac = perkMag('phaseStep', item.ilvl);
        h.phaseStepUntil = this.elapsed + 3;
        h.phaseStepAc = ac;
        this.fxText('PHASE', this._v3(h.x, 1.4, h.z), '#8fd4e8');
        this.fxLog(`◈ ${h.data.name}'s Phase Step grants +${ac} AC briefly.`, 'heal');
      }
    }
  },

  /* ================================================================
     Subclass PASSIVES — flavor-driven triggered effects layered on top
     of each subclass's flat pb bonus (folded in by recalc). Dispatched
     by sc.passiveKey so the whole system lives in one place; every
     number here is deliberately modest and easy to tune. Defined in
     SUBCLASSES (srd.js); described on the character sheet.
     ================================================================ */

  /** Offensive passives — conditional to-hit / bonus damage into attack opts.
   *  Called from buildAttackOpts. Reads target health + type. */
  subclassAttackMods(h, foe, opts) {
    const sc = subclassOf(h.data);
    if (!sc || !sc.passiveKey) return;
    const d = h.data;
    const full = foe.data.hp >= foe.data.maxHp;
    const wounded = foe.data.hp < foe.data.maxHp * 0.5;
    const ftype = (foe.data.type || '').toLowerCase();
    switch (sc.passiveKey) {
      case 'assassinsMark':                  // Assassin: pressure the healthy
        if (full) opts.extraDmg = (opts.extraDmg || 0) + roll(1, 6);
        break;
      case 'opportunist':                    // Thief: finish the wounded
        if (wounded) opts.extraDmg = (opts.extraDmg || 0) + roll(1, 4);
        break;
      case 'relentless':                     // Vengeance: hound the wounded
        if (wounded) opts.extraDmg = (opts.extraDmg || 0) + 2;
        break;
      case 'giantKiller':                    // Hunter: crack the fresh
        if (full) opts.extraDmg = (opts.extraDmg || 0) + 2;
        break;
      case 'elementalAffinity':              // Draconic: elemental bite
        opts.extraDmg = (opts.extraDmg || 0) + 2;
        break;
      case 'sacredWrath':                    // Devotion: radiant vs unholy
        if (ftype === 'undead' || ftype === 'fiend') opts.extraDmg = (opts.extraDmg || 0) + roll(1, 6);
        break;
      case 'warBlessing':                    // War Domain: opening advantage
        if (!h._foughtThisCombat) opts.adv = (opts.adv || 0) + 1;
        break;
      case 'peerlessSkill':                  // Lore: shine vs tough foes
        if (foe.isBoss || this.monsterEliteRoom(foe)) opts.atkBonus = (opts.atkBonus || 0) + die(4);
        break;
      case 'openHandTech':                   // Open Hand: forceful opener
        if (!h._foughtThisCombat) opts.extraDmg = (opts.extraDmg || 0) + Math.max(1, mod(d.effStats.wis)) + roll(1, 4);
        break;
      case 'bloodlust':                      // Berserker: spend stacked kill-fury
        if (h._bloodlust && h._bloodlustUntil > this.elapsed)
          opts.extraDmg = (opts.extraDmg || 0) + h._bloodlust * 2;
        break;
    }
  },

  /** On-hit passives — procs when a hero deals damage. Called from applyOnHitPerks. */
  subclassOnHit(h, foe, dmg, crit) {
    const sc = subclassOf(h.data);
    if (!sc || !sc.passiveKey || dmg <= 0 || foe.dead) return;
    const d = h.data;
    if (sc.passiveKey === 'survivor' && crit) {          // Champion: crits mend you
      this.healHero(h, 2 + Math.floor(d.level / 2));
    } else if (sc.passiveKey === 'sculptedBlast'         // Evoker: bolt arcs onward
        && ((h.data.lastProfile || h.data.weaponProfile) || {}).cantripScale
        && Math.random() < 0.20) {
      let best = null, bestD = 4.5;
      for (const m of this.monsters) {
        if (m === foe || m.dead || m.data.hp <= 0) continue;
        const dd = Math.hypot(m.x - foe.x, m.z - foe.z);
        if (dd < bestD) { bestD = dd; best = m; }
      }
      if (best) {
        const splash = Math.max(1, Math.round(dmg * 0.5));
        this.damageMonster(best, splash, h, false, { skipPerks: true, dmgType: 'fire', magical: true });
        this.fxText('ARC', this._v3(best.x, 1.3, best.z), '#b06cf0');
      }
    } else if (sc.passiveKey === 'beguiling'             // Archfey: unnerve the foe
        && Math.random() < 0.15 && !hasEffect(foe, 'frightened')) {
      applyEffect(foe, 'frightened', { duration: ROUND_SECONDS, elapsed: this.fxNow, source: h });
      this.fxText('FEAR', this._v3(foe.x, 1.3, foe.z), '#c07de8');
    }
  },

  /** On-kill passives. Called from applyOnKillPerks. */
  subclassOnKill(h, m) {
    const sc = subclassOf(h.data);
    if (!sc || !sc.passiveKey) return;
    const d = h.data;
    if (sc.passiveKey === 'bloodlust') {                 // Berserker: fury stacks
      const cur = (h._bloodlust && h._bloodlustUntil > this.elapsed) ? h._bloodlust : 0;
      h._bloodlust = Math.min(3, cur + 1);
      h._bloodlustUntil = this.elapsed + 6;
      this.fxText(`FURY x${h._bloodlust}`, this._v3(h.x, 1.5, h.z), '#ff6030');
    } else if (sc.passiveKey === 'darkBlessing') {       // Fiend: temp HP on kill
      const t = Math.max(1, d.level);
      h.data.tempHp = Math.max(h.data.tempHp || 0, t);
      this.fxText(`+${t} ward`, this._v3(h.x, 1.4, h.z), '#b06cf0');
    } else if (sc.passiveKey === 'bestialBond') {        // Beast Master: companion mends
      this.healHero(h, roll(1, 6));
    } else if (sc.passiveKey === 'naturalRecovery' && Math.random() < 0.20) { // Land: slot back
      if (recoverSlots(d, 1) > 0) {
        this.fxText('+slot', this._v3(h.x, 1.5, h.z), '#6ae06a');
        this.refreshHud();
      }
    } else if (sc.passiveKey === 'songOfVictory') {      // Valor: heal the wounded ally
      let worst = null;
      for (const a of this.heroes) {
        if (a.data.hp <= 0 || a === h) continue;
        if (!worst || a.data.hp / a.data.maxHp < worst.data.hp / worst.data.maxHp) worst = a;
      }
      if (worst && worst.data.hp < worst.data.maxHp) this.healHero(worst, roll(1, 6));
    }
  },

  /** Incoming-damage multiplier from defensive passives. Called from applyIncomingDamage. */
  subclassIncomingMul(h) {
    const sc = subclassOf(h.data);
    if (sc && sc.passiveKey === 'bearSpirit' && h.data.hp < h.data.maxHp * 0.5) return 0.8;
    return 1;
  },

  /** Conditional AC bonus from defensive passives. Called from heroAC. */
  subclassACBonus(h) {
    const sc = subclassOf(h.data);
    if (!sc || !sc.passiveKey) return 0;
    if (sc.passiveKey === 'holdTheLine') {
      const allyHurt = this.heroes.some(a => a !== h && a.data.hp > 0
        && a.data.hp < a.data.maxHp * 0.4 && Math.hypot(a.x - h.x, a.z - h.z) < 4);
      return allyHurt ? 2 : 0;
    }
    if (sc.passiveKey === 'cloakOfShadows') {
      return h.data.hp >= h.data.maxHp ? 2 : 0;
    }
    return 0;
  },

  /** Start-of-fight passives (wards, temp HP, surges). Fires once per fight,
   *  driven from the update loop when combat first engages. */
  subclassCombatStart(h, alive) {
    if (h.data.hp <= 0) return;
    const d = h.data;

    /* Perfect Self (Monk L20 capstone): Regain 4 Ki when starting combat at 0 Ki */
    if (hasFeature(d, 'perfectSelf') && (d.ki || 0) === 0) {
      d.ki = Math.min(d.kiMax || 20, 4);
      this.fxText('+4 Ki', this._v3(h.x, 1.5, h.z), '#e8d8a8');
      this.fxLog(`🥋 ${d.name}'s Perfect Self restores 4 Ki points!`, 'crit');
    }

    const sc = subclassOf(h.data);
    if (!sc || !sc.passiveKey) return;
    if (sc.passiveKey === 'arcaneWard') {
      const t = d.level + Math.max(0, mod(d.effStats.int));
      h.data.tempHp = Math.max(h.data.tempHp || 0, t);
      this.fxText(`+${t} ward`, this._v3(h.x, 1.4, h.z), '#8fd4e8');
    } else if (sc.passiveKey === 'thickHide') {
      const t = d.level;
      h.data.tempHp = Math.max(h.data.tempHp || 0, t);
      this.fxText(`+${t} hide`, this._v3(h.x, 1.4, h.z), '#2ecc71');
    } else if (sc.passiveKey === 'discipleOfLife') {
      const t = Math.ceil(d.level / 2);
      for (const a of (alive || this.heroes)) {
        if (a.data.hp <= 0) continue;
        a.data.tempHp = Math.max(a.data.tempHp || 0, t);
      }
      this.fxText('BLESSING', this._v3(h.x, 1.5, h.z), '#5a8fe8');
    } else if (sc.passiveKey === 'tidesOfChaosPassive') {
      if (Math.random() < 0.5) {
        const t = d.level;
        h.data.tempHp = Math.max(h.data.tempHp || 0, t);
        this.fxText('SURGE +HP', this._v3(h.x, 1.5, h.z), '#e67e22');
      } else {
        applyEffect(h, 'hasted', { duration: 6, elapsed: this.fxNow });
        this.fxText('SURGE HASTE', this._v3(h.x, 1.5, h.z), '#e67e22');
      }
    }

    /* Fiendish Blessing (Fiend Warlock): 1 / short rest, +10 temp HP when starting combat */
    if (sc.active && sc.active.key === 'fiendishBlessing' && hasCharge(d, 'fiendishBlessing')) {
      spendCharge(d, 'fiendishBlessing');
      h.data.tempHp = (h.data.tempHp || 0) + 10;
      this.playAbilityFx(h, 'fiendishBlessing', { at: h, spell: true });
      this.fxLog(`😈 ${d.name} gains Fiendish Blessing (+10 temp HP)!`, 'heal');
      this.fxText('+10 HP', this._v3(h.x, 1.5, h.z), '#9333ea');
    }
  },

  /** Inspiring Leader feat: the best contributor's oration grants the whole
   *  party temporary HP once, at the start of each fight. */
  applyInspiringLeader(alive) {
    let best = 0;
    for (const h of alive) if (h.data.hp > 0) best = Math.max(best, featCombatStartTempHp(h.data));
    if (best <= 0) return;
    for (const h of alive) {
      if (h.data.hp <= 0) continue;
      h.data.tempHp = Math.max(h.data.tempHp || 0, best);
      this.fxText(`+${best}`, this._v3(h.x, 1.4, h.z), '#ffd36a');
    }
    this.fxLog(`📣 Inspiring words rally the party — +${best} temporary HP!`, 'heal');
  },

  /* ── Concentration (5e): one concentration spell per caster ────────
     Casting a new concentration spell ends the old one; taking damage
     forces a CON save (DC = max(10, half the damage)); going down ends it. */

  /**
   * Spawns a persistent Area of Effect (AoE) zone.
   */
  spawnAoEZone(caster, spellKey, x, z, radius, options = {}) {
    return aoeZoneManager.spawnZone(this, caster, spellKey, x, z, radius, options);
  },

  moveAoEZone(zone, newX, newZ, moveDuration = 0.5) {
    return aoeZoneManager.moveZone(zone, newX, newZ, moveDuration);
  },

  removeAoEZone(zone) {
    return aoeZoneManager.removeZone(this, zone);
  },

  updateAoEZones(dt) {
    return aoeZoneManager.updateZones(this, dt);
  },

  processTurnZones(actor) {
    return aoeZoneManager.processTurnZones(this, actor);
  },

  processStepZones(actor, fromCell, toCell) {
    return aoeZoneManager.processStepZones(this, actor, fromCell, toCell);
  },

  isDifficultTerrain(cell, mover = null) {
    return aoeZoneManager.isDifficultTerrain(this, cell, mover);
  },

  resolveMoonbeamDamage(zone, target) {
    if (!target || !target.data || target.data.hp <= 0) return;
    const caster = zone.caster;
    const dc = spellDC(caster);
    const slotLvl = zone.slotLevel || 2;
    const diceCount = 2 + Math.max(0, slotLvl - 2);
    let amt = roll(diceCount, 10, caster.data?.dmgBonus || 0);

    const saved = this.spellSave(target, 'con', dc, { magic: true });
    if (saved) amt = Math.floor(amt / 2);

    this.spellDamage(target, amt, caster, false, { dmgType: 'radiant', magical: true });
    this.fxLog(`🌙 ${target.data.name} ${saved ? 'saves (half dmg)' : 'fails save'} vs Moonbeam! (${amt} radiant)`, saved ? 'roll' : 'crit');

    if (!saved) {
      if (target.data.inWildShape) {
        this.fxLog(`✨ Moonbeam reverts ${target.data.name} to true form!`, 'crit');
        this.revertWildShape(target);
      }
    }
  },

  useMoveMoonbeam(h, targetPos) {
    if (!h || !h.conc || h.conc.key !== 'moonbeam' || !h.conc.zone) {
      this.fxLog(`No active Moonbeam to move.`, 'sys');
      return false;
    }
    const zone = h.conc.zone;
    const maxDist = 12.0;
    const dist = Math.hypot(targetPos.x - h.x, targetPos.z - h.z);
    if (dist > maxDist + 1.5) {
      this.fxLog(`Target position is too far for Moonbeam (max 60 ft).`, 'sys');
      return false;
    }

    this.moveAoEZone(zone, targetPos.x, targetPos.z, 0.5);
    this.fxLog(`🌙 ${h.data.name} directs the Moonbeam to glide to new coordinates!`, 'crit');
    this.playAbilityFx(h, 'moonbeam', { at: targetPos, spell: true });

    const from = this._v3(targetPos.x, 6.0, targetPos.z);
    const to = this._v3(targetPos.x, 0.4, targetPos.z);
    this.fxBeam(from, to, {
      type: 'pillar',
      color: 0xc0e8ff,
      coreColor: 0xffffff,
      width: 1.6,
      duration: 0.75,
      opacity: 0.5,
      targetBurst: 'round_light_burst_001_large_yellow'
    });

    const targets = (h._side === 'mon' ? this.heroes : this.monsters).filter(m =>
      m.data && m.data.hp > 0 && m.active !== false && Math.hypot(m.x - targetPos.x, m.z - targetPos.z) <= zone.radius
    );

    for (const m of targets) {
      if (!zone.savesThisTurn.has(m)) {
        zone.savesThisTurn.add(m);
        this.resolveMoonbeamDamage(zone, m);
      }
    }

    h.actUsed = true;
    this.refreshAbilityHud();
    return true;
  },

  /**
   * Register a caster's concentration on a spell.
   * @param {object} h caster entity
   * @param {string} spellKey SPELLS registry key
   * @param {Array<{e:object, key:string}>} applied effects this spell placed
   * @param {object} [zone] persistent AoE zone tied to this concentration
   */
  concentrate(h, spellKey, applied, zone = null) {
    this.breakConcentration(h, 'casting another spell');
    h.conc = { key: spellKey, targets: applied || [], zone };
    if (h.data) h.data.conc = h.conc;
    firstRunTip('concentration');
    this.refreshHud();
  },

  breakConcentration(h, reason) {
    if (!h.conc && !h.data?.conc) return;
    const key = h.conc?.key || h.data?.conc?.key;
    const label = SPELLS[key]?.label || key;
    const targets = h.conc?.targets || h.data?.conc?.targets || [];
    const zone = h.conc?.zone || h.data?.conc?.zone;
    for (const t of targets) {
      if (t && t.e) clearEffect(t.e, t.key);
    }
    if (zone) {
      this.removeAoEZone(zone);
    }
    h.conc = null;
    if (h.data) h.data.conc = null;
    if (reason && h.data) this.fxLog(`💫 ${h.data.name}'s concentration on ${label} ends (${reason}).`, 'miss');
    this.refreshHud();
  },

  /** Spend the lowest available slot of level ≥ spellLevel. */
  spendSlot(h, spellLevel = 1) {
    if (!spendSlotFor(h.data, spellLevel)) return false;
    this.refreshAbilityHud();
    return true;
  },

  canUseSpellRecharge(h, spell) {
    if (spell.key === 'findFamiliar') {
      const hasFam = this.heroes && this.heroes.some(c =>
        c.companion && c.kind && (c.kind.includes('Familiar') || c.kind === 'owl' || c.kind === 'imp' || c.kind === 'viper') &&
        c.summonerName === h.data.name &&
        c.summonerClassKey === h.data.classKey &&
        c.data && c.data.hp > 0
      );
      if (hasFam) return false;
    }
    /* Mystic Arcanum outranks any pact slot the warlock will ever have, so it
       bills its own once-per-long-rest pool instead. Checked ahead of the slot
       branch because these are ordinary slot-recharge spells to everyone else. */
    if (isArcanum(h.data, spell.key)) {
      return hasCharge(h.data, 'arcanum:' + spell.key);
    }
    if (spell.recharge === 'slot') {
      /* An equipped scroll of this spell supplies its own power — no slot needed. */
      const sc = this._equippedScroll(h.data);
      if (sc && sc.spellKey === spell.key) return true;
      return hasSlotFor(h.data, spell.level || 1);
    }
    if (spell.recharge === 'short' || spell.recharge === 'long' || spell.recharge === 'day') {
      /* Each rest-recharge spell owns its own pool (`spell:<key>`) rather than
         sharing one flag with every class feature. */
      return hasCharge(h.data, 'spell:' + spell.key);
    }
    return true;
  },

  markSpellUsed(h, spell) {
    /* Scroll-cast (the spell was NOT known — it came from the equipped trinket):
       consume a scroll charge instead of a slot/rest resource. */
    if (h._scrollCastKey === spell.key) {
      h._scrollCastKey = null;
      this._consumeScrollFor(h, spell.key);
      return;
    }
    if (isArcanum(h.data, spell.key)) {
      spendCharge(h.data, 'arcanum:' + spell.key);
      this.refreshAbilityHud();
      return;
    }
    if (spell.recharge === 'slot') {
      if (this.spendSlot(h, spell.level || 1)) return;
      /* Known the spell but out of slots — an equipped scroll of it still
         works, so burn a charge rather than casting it for free. */
      if (this._consumeScrollFor(h, spell.key)) return;
      return;
    }
    else if (spell.recharge === 'short' || spell.recharge === 'long' || spell.recharge === 'day') {
      spendCharge(h.data, 'spell:' + spell.key);
      this.refreshAbilityHud();
    }
  },

  /* The equipped trinket when it is a usable scroll (charges left). */
  _equippedScroll(d) {
    const it = d && d.equipment && d.equipment.trinket;
    if (!it || !it.scroll || !it.spellKey || (it.charges | 0) <= 0) return null;
    return it;
  },

  /* The equipped trinket when it is a drinkable potion (charges left). */
  _equippedPotion(d) {
    const it = d && d.equipment && d.equipment.trinket;
    if (!it || !it.potion || !(it.buffKey || (it.cures && it.cures.length)) || (it.charges | 0) <= 0) return null;
    return it;
  },

  /* A used-up trinket leaves the slot; if the bag holds a fresh stack of the
     same thing, the next one goes straight in so a hero carrying five
     Scrolls of Fireball reads five, not one. Only an exact match reloads —
     a different scroll is a choice the player makes, not the game. */
  _reloadTrinketFromBag(h, spent) {
    delete h.data.equipment.trinket;
    if (!spent || !Array.isArray(this.inventory)) return null;
    const same = (it) => it && it.slot === 'trinket' && (it.charges | 0) > 0
      && (it.baseKey || it.name) === (spent.baseKey || spent.name)
      && it.spellKey === spent.spellKey && it.buffKey === spent.buffKey;
    /* the fullest stack first, so a half-read leftover waits its turn */
    const stack = this.inventory.filter(same).sort((a, b) => (b.charges | 0) - (a.charges | 0))[0];
    if (!stack) return null;
    const next = takeFromInventory(this.inventory, stack, 1);
    if (!next) return null;
    h.data.equipment.trinket = next;
    this.fxLog(`  ↳ ${h.data.name} readies another ${next.name} from the bag.`, 'sys');
    return next;
  },

  /* Consume one charge of an equipped scroll of `spellKey`. Logs the read and
     crumbles the scroll to dust (removing it from the trinket slot) at 0. */
  _consumeScrollFor(h, spellKey) {
    const scroll = this._equippedScroll(h.data);
    if (!scroll || scroll.spellKey !== spellKey) return false;
    scroll.charges -= 1;
    this.fxLog(`📜 ${h.data.name} reads from the ${scroll.name} (${scroll.charges} charge${scroll.charges === 1 ? '' : 's'} left)`);
    if (scroll.charges <= 0) {
      this.fxLog(`📜 The ${scroll.name} crumbles to dust.`, 'sys');
      this._reloadTrinketFromBag(h, scroll);
    }
    this.refreshAbilityHud?.();
    this.refreshHud?.();
    return true;
  },

  /* Drink an equipped potion trinket: apply its buff to the hero and consume
     the charge. */
  _usePotion(h, potion) {
    if (!potion || (potion.charges | 0) <= 0) return false;
    if (potion.buffKey) applyEffect(h, potion.buffKey, { duration: potion.buffDuration || 60, elapsed: this.fxNow, source: h });
    if (potion.tempHp > 0) h.data.tempHp = Math.max(h.data.tempHp || 0, potion.tempHp);
    const cured = [];
    for (const c of potion.cures || []) if (hasEffect(h, c)) { clearEffect(h, c); cured.push((EFFECTS[c] && EFFECTS[c].label) || c); }
    this.playAbilityFx(h, potion.buffKey || 'cureWounds', { at: h, spell: true });
    this.fxLog(`🧪 ${h.data.name} drinks the ${potion.name}.${cured.length ? ` Cured: ${cured.join(', ')}.` : ''}`, 'heal');
    potion.charges -= 1;
    if (potion.charges <= 0) {
      this.fxLog(`🧪 The ${potion.name} is empty.`, 'sys');
      this._reloadTrinketFromBag(h, potion);
    }
    this.refreshAbilityHud?.();
    this.refreshHud?.();
    return true;
  },

  /* Score drinking the equipped potion right now. Higher = more worth it. */
  _scorePotion(h, potion, alive) {
    if (!potion || (potion.charges | 0) <= 0) return -1;
    /* A cure is worth drinking the moment something it cures is on us, fight
       or no fight; otherwise it waits. */
    if (potion.cures && potion.cures.length) {
      return (potion.cures.some(c => hasEffect(h, c))) ? 20 : -1;
    }
    if (!potion.buffKey) return -1;
    if (hasEffect(h, potion.buffKey)) return -1;      // already active
    const w = getAbilityUseWeight(h);
    if (w <= 0) return -1;
    const enemies = (this.monsters || []).filter(m => m.data && m.data.hp > 0 && m.active !== false);
    if (!enemies.length) return -1;
    if (!this._combatStable(1.0)) return -1;
    /* Don't waste a potion in an open wipe. */
    const partyFrac = (alive || []).length
      ? (alive || []).reduce((s, a) => s + a.data.hp / a.data.maxHp, 0) / (alive || []).length
      : 0;
    if (partyFrac < 0.2) return -1;
    const RANK = { epic: 9, rare: 8, uncommon: 7, common: 6 };
    return (RANK[potion.rarity] || 6) + w;
  },

  /* Score a spell candidate for the current situation. Higher score = better
     cast choice. `out` (optional) collects the chosen AoE blast centre so the
     caller can hand it to the cast — see _pickKnownSpell. */
  _scoreSpellForTarget(h, key, foe, alive, out = null) {
    let _aoeSpot = null;
    const sp = SPELLS[key];
    if (!sp || !this.canUseSpellRecharge(h, sp)) return -1;

    /* already concentrating on this spell — don't waste a slot recasting it */
    if (sp.concentration && h.conc?.key === key) return -1;

    const d = h.data;
    const ai = sp.ai || { when: 'any', priority: 1 };
    const _w = this.getAbilityUseWeight(h);
    if (_w <= 0) return -1;

    // Check target immunity / avoided types
    if (ai.avoidTypes && foe && foe.data && ai.avoidTypes.includes(foe.data.type)) {
      return -1;
    }
    /* Only worth anything against these types (holy water vs undead/fiends).
       If the hero's own target is the wrong kind, look past it: a skeleton
       standing behind the necromancer's wolf is still the better throw. The
       substitute is handed back through `out.foe` so the cast aims at it. */
    if (ai.onlyTypes) {
      const okType = (m) => m && m.data && m.data.hp > 0 && m.active !== false && ai.onlyTypes.includes(m.data.type);
      if (!okType(foe)) {
        const alt = (this.monsters || []).filter(okType)
          .sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z))[0];
        if (!alt) return -1;
        foe = alt;
        if (out) out.foe = alt;
      }
    }

    // Check redundant debuffs (don't recast debuff if foe already has condition)
    if (ai.debuffEffect && foe) {
      if (hasEffect(foe, ai.debuffEffect)) return -1;
    }

    // Check redundant buffs (don't recast buff if self, target, or party already has condition)
    if (ai.buffEffect) {
      if (ai.buffTarget === 'self' && hasEffect(h, ai.buffEffect)) return -1;
      if (ai.buffTarget === 'party') {
        const partyNeedsBuff = (alive || [h]).some(a => !hasEffect(a, ai.buffEffect));
        if (!partyNeedsBuff) return -1;
      }
      if (ai.buffTarget === 'ally') {
        const anyAllyNeedsBuff = (alive || [h]).some(a => !hasEffect(a, ai.buffEffect));
        if (!anyAllyNeedsBuff) return -1;
      }
    }

    let score = ai.priority || 1;

    /* Slot economy. This used to be `score += sp.level * 3`, which made the
       biggest available spell win by default — heroes opened every fight with
       their top slot and dropped 3rd-level spells on dying trash.
       A higher-level slot still buys a better effect, so the level bonus stays;
       what it now has to clear is a COST that rises with the level and with how
       few slots are left, and falls away when the fight is genuinely dangerous.
       Net effect: big spells for big problems, cantrips for rats.
       (Units here are the scoring scale used by the ai.priority values below,
       not HP — slotCost() is the HP-denominated version used by the planner.) */
    const lvl = sp.level || 0;
    if (lvl > 0) {
      const danger = !!(foe && (foe.isBoss || this.monsterEliteRoom(foe)))
        || ((alive || []).length
          && (alive.reduce((s, a) => s + a.data.hp / Math.max(a.data.maxHp, 1), 0) / alive.length) < 0.5);
      const remaining = (d.slots && d.slots[lvl]) || 0;
      let cost = lvl * 2.2;
      if (remaining <= 1) cost *= 1.6;            // the last one has to count
      else if (remaining >= 3) cost *= 0.7;       // plenty left, spend freely
      if (danger) cost *= 0.45;                   // this is what they're for
      cost *= (1.5 - _w);                         // conservative heroes hoard
      score += lvl * 3.0 - cost;
    }

    // ── Self Hurt / Defensive Reflexes ──
    if (ai.when === 'selfHurt') {
      const healThresh = 0.2 + 0.5 * _w;
      const hpFrac = h.data.hp / Math.max(h.data.maxHp, 1);
      if (hpFrac < (ai.hpFrac != null ? ai.hpFrac : healThresh)) {
        score += 15 * (1 - hpFrac);
      } else {
        return -1;
      }
    }

    // ── Hurt Ally / Healing ──
    else if (ai.when === 'hurtAlly') {
      const healThresh = 0.2 + 0.5 * _w;
      const targets = (alive || []).concat(this.heroes.filter(x => x.data.hp <= 0));
      const worstHurt = targets.reduce((min, a) => Math.min(min, a.data.hp / Math.max(a.data.maxHp, 1)), 1);
      if (worstHurt < (ai.hpFrac != null ? ai.hpFrac : healThresh) || this.heroes.some(a => a.data.hp <= 0)) {
        score += 18 * (1 - worstHurt);
      } else {
        return -1;
      }
    }

    /* ── AoE Cluster Spells ──
       The blast no longer detonates on whatever the caster happened to be
       aiming at: bestAoECenter searches monster positions and pair-midpoints
       for the placement that covers the most *useful* damage, and that centre
       is carried through to the cast. This is what stops a Fireball landing on
       one goblin with three more standing just outside the radius. */
    else if (ai.when === 'cluster') {
      const radius = this.aoeRadiusOf(sp) || 2.5;
      const minReq = ai.minTargets || 2;
      if (ai.aoeOrigin === 'self') {
        /* Caster-centred aura — it goes off around the hero wherever they are,
           so the only question is how many foes that already covers. */
        const count = this.monsters.filter(m => m.data.hp > 0 && m.active
          && Math.hypot(m.x - h.x, m.z - h.z) <= radius).length;
        if (count < minReq) return -1;
        score += 10 + (count - 1) * 8;
      } else {
        if (!foe) return -1;
        const spot = bestAoECenter(this, h, radius, {
          minTargets: minReq,
          maxRange: 12,
          mustCover: foe,          // the blast still has to catch our own target
          perTargetDamage: sp.level ? 4 + sp.level * 3.5 : 6,
        });
        if (!spot) return -1;
        _aoeSpot = spot;
        score += 10 + (spot.targets.length - 1) * 8;
      }
    }

    // ── Single-Target Burst / Elite / Boss Spells ──
    else if (ai.when === 'eliteOrBoss') {
      if (!foe) return -1;
      const isDangerous = foe.isBoss || this.monsterEliteRoom(foe) || foe.data.hp >= 20;
      if (!isDangerous && !this._worthSpending(h, foe, alive, 'low')) return -1;
      score += isDangerous ? 12 : 4;
    }

    // ── "Any" Spells ──
    else if (ai.when === 'any') {
      if (!this._combatStable(ai.minCombatSec || 1.0) || !this._worthSpending(h, foe, alive, 'low')) {
        return -1;
      }
    }

    // ── Execute / Finisher Special Scoring (e.g. Magic Missile) ──
    if (key === 'magicMissile') {
      const activeEnemies = this.monsters.filter(m => m.data.hp > 0 && m.active);
      const lowHpTarget = activeEnemies.find(m => m.data.hp <= 25 || m.data.hp / Math.max(m.data.maxHp, 1) < 0.3);
      if (lowHpTarget) {
        score += 14; // Auto-hit force darts make Magic Missile an ideal finisher
      }
    }

    /* ── Overkill guard ──
       The old version only fired at level>=3 AND hp<12 AND hp<25% of max, so a
       Fireball aimed at a 30 HP monster sitting on 12 HP sailed straight
       through. Judge it on value instead: how much of the spell's damage the
       target can actually absorb, against what the slot is worth. A leveled
       damage spell that can't cash in most of its damage is a bad trade
       regardless of which thresholds it happens to sit between. */
    if (foe && (sp.level || 0) > 0 && ai.when !== 'hurtAlly' && ai.when !== 'selfHurt') {
      const target = _aoeSpot ? null : foe;
      if (target) {
        const est = 4 + (sp.level || 0) * 3.5;
        const ehp = effectiveHp(this, target);
        if (ehp > 0 && est > ehp) {
          /* Only part of the blast lands. Scale the penalty by how much is
             thrown away, softened by how dangerous the target was — finishing
             something that hits hard is still worth it. */
          const wasteFrac = (est - ehp) / est;
          const worthKilling = Math.min(1, monsterDpr(target, null, this) / 12);
          score -= 14 * wasteFrac * (1 - 0.6 * worthKilling);
        }
      }
    }

    if (out && _aoeSpot) out.center = { x: _aoeSpot.x, z: _aoeSpot.z };
    return score;
  },

  /* Idle AI: pick the best known spell (or equipped trinket) for this moment
     via dynamic contextual scoring. Returns { key, viaScroll, potion } —
     `viaScroll` marks a spell that came from an equipped scroll rather than
     memory, and `potion` is set (instead of `key`) when drinking a potion is
     the best use of a bonus action. */
  _pickKnownSpell(h, foe, alive, filter) {
    if (h.data && h.data.inWildShape) return null;
    const knownBase = h.data.knownSpells || [];
    const scroll = this._equippedScroll(h.data);
    const potion = this._equippedPotion(h.data);
    const known = knownBase.slice();
    if (scroll && scroll.spellKey && !knownBase.includes(scroll.spellKey)) known.push(scroll.spellKey);
    if (!known.length && !potion) return null;

    const w = getAbilityUseWeight(h);
    if (w <= 0) return null;

    let best = null, bestViaScroll = false, bestPotion = null, maxScore = -1;
    let bestCenter = null, bestFoe = null;
    for (const key of known) {
      const sp = SPELLS[key];
      if (!sp || !filter(sp)) continue;
      const out = {};
      const score = this._scoreSpellForTarget(h, key, foe, alive, out);
      if (score > maxScore) {
        maxScore = score;
        best = key;
        bestViaScroll = !knownBase.includes(key);
        bestPotion = null;
        bestCenter = out.center || null;   // where the AoE should actually land
        bestFoe = out.foe || null;         // a retarget the spell insisted on (holy water → the undead)
      }
    }

    /* Potions are a bonus action — only considered on the bonus-action pass
       (whose filter is `sp.bonusAction === true`). */
    if (potion && filter({ bonusAction: true })) {
      const score = this._scorePotion(h, potion, alive);
      if (score > maxScore) {
        maxScore = score;
        best = null;
        bestViaScroll = false;
        bestPotion = potion;
      }
    }

    if (maxScore <= 0) return null;
    if (bestPotion) return { key: null, viaScroll: false, potion: bestPotion };
    if (!best) return null;

    /* Final conservation gate. The scoring above already prices a slot against
       what the spell accomplishes; this is the coarse "don't burn the whole
       book on one pack of rats" rationing on top, and it stays because the
       encounter chain between rests is what it's really protecting. */
    const chosenSpell = SPELLS[best];
    const isLimited = (chosenSpell.level || 0) > 0 || chosenSpell.recharge === 'slot'
      || chosenSpell.recharge === 'short' || chosenSpell.recharge === 'long'
      || chosenSpell.recharge === 'day';

    if (isLimited) {
      const ai = chosenSpell.ai || {};
      const isEmergency = (ai.when === 'selfHurt' && h.data.hp / Math.max(h.data.maxHp, 1) < 0.3)
                       || (ai.when === 'hurtAlly' && (alive || []).some(a => a.data.hp / Math.max(a.data.maxHp, 1) < 0.35 || a.data.hp <= 0));
      if (!isEmergency) {
        const isHighThreat = foe && (foe.isBoss || this.monsterEliteRoom(foe));
        const chance = isHighThreat ? Math.min(1.0, w * 2.5) : w;
        if (Math.random() > chance) return null;   // fall back to cantrip / weapon
      }
    }

    return { key: best, viaScroll: bestViaScroll, potion: null, center: bestCenter, foe: bestFoe };
  },

  /* Action-phase caster AI: leveled action-spells only (bonus-action spells are
     handled separately in tryCastBonusSpell, so they're excluded here). */
  tryCastKnownSpell(h, foe, alive) {
    const pick = this._pickKnownSpell(h, foe, alive, sp => sp.bonusAction !== true);
    if (!pick) return false;
    if (pick.potion) return this._usePotion(h, pick.potion);
    h._scrollCastKey = pick.viaScroll ? pick.key : null;
    const ok = this.resolveSpell(h, pick.key, pick.foe || foe, alive, { center: pick.center });
    h._scrollCastKey = null;
    return ok;
  },

  /* Bonus-action phase: cast one bonus-action spell (Healing Word, Hex, Misty
     Step…) or drink the equipped potion WITHOUT consuming the hero's action.
     Marks the bonus action used and, for a leveled spell, sets _bonusLeveled so
     the 5e "no second leveled spell this turn" rule can block a follow-up
     action-spell. Returns true if cast. */
  tryCastBonusSpell(h, foe, alive) {
    if (h._bonusActed) return false;
    const pick = this._pickKnownSpell(h, foe, alive, sp => sp.bonusAction === true);
    if (!pick) return false;
    if (pick.potion) return this._usePotion(h, pick.potion);
    h._scrollCastKey = pick.viaScroll ? pick.key : null;
    const sp = SPELLS[pick.key];
    const ok = this.resolveSpell(h, pick.key, foe, alive, { center: pick.center });
    h._scrollCastKey = null;
    if (!ok) return false;
    h._bonusActed = true;
    if ((sp.level || 0) > 0) h._bonusLeveled = true;
    return true;
  },

  checkCounterspellInterrupt(caster, spellKey, spellDef) {
    if (!caster || !spellDef || spellKey === 'counterspell' || spellDef.level === 0) return false;

    // Determine target opposing team
    const isMonsterCaster = !this.heroes.includes(caster);
    const reactors = isMonsterCaster ? (this.heroes || []) : (this.monsters || []);

    for (const r of reactors) {
      if (!r || r.dead || r.active === false || r.reactionUsed) continue;

      // Distance check: within 12 tiles (60 ft)
      const dist = Math.hypot((r.x || 0) - (caster.x || 0), (r.z || 0) - (caster.z || 0));
      if (dist > 12.0) continue;

      const d = r.data || r;
      const knowsCounter = (d.knownSpells && d.knownSpells.includes('counterspell')) ||
                           (d.spellPool && Object.values(d.spellPool).flat().includes('counterspell')) ||
                           hasFeature(r, 'counterspell');

      if (knowsCounter && hasSlotFor(d, 3)) {
        r.reactionUsed = true;
        spendSlotFor(d, 3);

        const spellLabel = spellDef.label || spellKey;
        this.playAbilityFx(r, 'counterspell', { at: caster, spell: true, scale: 2.0 });
        this.fxText('countered!', this._v3(caster.x, 1.2, caster.z), '#4080ff');
        this.fxLog(`🚫 ${d.name} uses Reaction to cast Counterspell! ${caster.data?.name || 'Caster'}'s ${spellLabel} was nullified!`, 'crit');
        this.refreshHud();
        return true;
      }
    }
    return false;
  },

  /** Radius an AoE spell actually detonates with. Declared on the spell so the
   *  AI's scoring and the cast itself can never drift apart (they used to:
   *  Call Lightning was scored at a 2.5 radius and cast at 2.2). */
  aoeRadiusOf(sp) {
    if (!sp) return 0;
    return sp.aoeRadius ?? sp.ai?.aoeRadius ?? 0;
  },

  resolveSpell(h, key, foe, alive, opts = {}) {
    if (h.data && h.data.inWildShape && key !== 'wildShape') return false;
    const sp = SPELLS[key];
    if (!sp || !this.canUseSpellRecharge(h, sp)) return false;
    if (this.checkCounterspellInterrupt(h, key, sp)) return false;
    if (!sp.cast) return false;
    /* Hand the chosen blast centre to clusterAround for the duration of the
       cast. Caster-centred spells (Spirit Guardians, Thunderwave) are anchored
       on the caster and must never be relocated. */
    const self = sp.ai?.aoeOrigin === 'self';
    this._aoeCenter = (!self && opts.center) ? opts.center : null;
    if (Trace.on) {
      const r = this.aoeRadiusOf(sp);
      let why = `${sp.label || key} (lvl ${sp.level || 0})`;
      if (r && opts.center) {
        const hit = (this.monsters || []).filter(m => m.data && m.data.hp > 0 && m.active !== false
          && Math.hypot(m.x - opts.center.x, m.z - opts.center.z) <= r).length;
        why += ` — blast r${r} placed to catch ${hit} foes`;
      } else if (r && self) {
        why += ` — aura r${r} centred on self`;
      } else if (foe) {
        why += ` → ${foe.data.name}`;
      }
      Trace.record(h, 'cast', why);
    }
    try {
      return sp.cast(this, h, foe, alive, opts.slotLevel, opts.center || null);
    } finally {
      this._aoeCenter = null;
    }
  },

  /* day- and slot-tier subclass actives; returns true if one consumed this turn */
  castSubclassSpell(h, sc, foe, alive) {
    if (h.data && h.data.inWildShape) return false;
    const key = sc.active.key, d = h.data;
    if (key === 'rallyingCry' && hasCharge(d, 'rallyingCry')) {
      const hurt = alive.filter(a => a.data.hp < a.data.maxHp * 0.5);
      if (hurt.length >= 2) {
        spendCharge(d, 'rallyingCry');
        this.playAbilityFx(h, 'rallyingCry', { at: h, alsoAt: alive });
        this.fxLog(`📣 ${d.name} bellows a Rallying Cry!`, 'heal');
        for (const a of alive) this.healHero(a, roll(1, 10, d.level));
        this.refreshAbilityHud();
        return true;
      }
      return false;
    }
    if (key === 'preserveLife' && hasCharge(d, 'preserveLife')) {
      const hurt = alive.filter(a => a.data.hp < a.data.maxHp * 0.4);
      if (hurt.length >= 2) {
        spendCharge(d, 'preserveLife');
        this.playAbilityFx(h, 'preserveLife', { at: h, alsoAt: alive, spell: true });
        this.fxLog(`✨ ${d.name} channels divinity — Preserve Life!`, 'heal');
        for (const a of alive) this.healHero(a, d.level * 2 + mod(d.effStats.wis) + d.healBonus);
        this.refreshAbilityHud();
        return true;
      }
      return false;
    }
    if (key === 'fireball' && hasSlotFor(d, 3)) {
      const w = this.getAbilityUseWeight(h);
      if (w > 0 && Math.random() <= w && this._worthSpending(h, foe, alive, 'normal')) {
        return this.resolveSpell(h, 'fireball', foe, alive);
      }
      return false;
    }
    if (key === 'magicMissile' && hasSlotFor(d, 1)
        && (foe.isBoss || this.monsterEliteRoom(foe) || foe.data.hp >= 15)
        && this._worthSpending(h, foe, alive, 'normal')) {
      const w = this.getAbilityUseWeight(h);
      if (w > 0 && Math.random() <= w) {
        return this.resolveSpell(h, 'magicMissile', foe, alive);
      }
      return false;
    }
    if (key === 'dragonBreath' && hasCharge(d, 'dragonBreath') && this._combatStable(1.0)) {
      const foes = this.monsters.filter(m => m.data.hp > 0 && m.active && Math.hypot(m.x - h.x, m.z - h.z) < 3);
      if (foes.length >= 2) {
        spendCharge(d, 'dragonBreath');
        this.playAbilityFx(h, 'dragonBreath', { at: h, alsoAt: foes, scale: 2.2, ring: 2.2 });
        this.fxLog(`🐉 ${d.name} breathes fire!`, 'crit');
        for (const m of foes) this.spellDamage(m, roll(3, 6, d.dmgBonus), h, false, { dmgType: 'fire', magical: true });
        this.refreshAbilityHud();
        return true;
      }
    }
    if (key === 'wildSurge' && hasCharge(d, 'wildSurge') && this._combatStable(1.5)) {
      // Only surge when someone is actually hurt — don't waste the heal
      const anyHurt = alive.some(a => a.data.hp < a.data.maxHp * 0.8);
      if (anyHurt) {
        spendCharge(d, 'wildSurge');
        this.playAbilityFx(h, 'wildSurge', { at: h, alsoAt: alive, spell: true });
        this.fxLog(`🌈 ${d.name}'s Wild Magic heals the party!`, 'heal');
        for (const a of alive) this.healHero(a, roll(1, 10, d.level));
        this.refreshAbilityHud();
        return true;
      }
    }
    if (key === 'cuttingWords' && hasCharge(d, 'cuttingWords') && (foe.isBoss || this.monsterEliteRoom(foe))
        && this._worthSpending(h, foe, alive, 'high')) {
      spendCharge(d, 'cuttingWords');
      foe.cutWordsUntil = this.fxNow + ROUND_SECONDS;   // one round, on the combat clock
      foe.data._acPenalty = 4;
      this.playAbilityFx(h, 'cuttingWords', { at: foe, spell: true });
      this.fxLog(`🎤 ${d.name} uses Cutting Words on ${foe.data.name}!`, 'crit');
      this.refreshAbilityHud();
      return true;
    }
    if (key === 'feyPresence' && hasCharge(d, 'feyPresence') && this._combatStable(1.2)) {
      const foes = this.monsters.filter(m => m.data.hp > 0 && m.active && Math.hypot(m.x - h.x, m.z - h.z) < 3);
      if (foes.length) {
        spendCharge(d, 'feyPresence');
        for (const m of foes) m.charmedUntil = this.elapsed + 3;
        this.playAbilityFx(h, 'feyPresence', { at: h, alsoAt: foes, spell: true });
        this.fxLog(`🧚 ${d.name}'s Fey Presence charms nearby foes!`, 'heal');
        this.refreshAbilityHud();
        return true;
      }
    }
    if (key === 'wildShape' && hasCharge(d, 'wildShapeClass') && !d.inWildShape) {
      spendCharge(d, 'wildShapeClass');
      this.activateWildShape(h);
      this.refreshAbilityHud();
      return true;
    }
    return false;
  },

  activateWildShape(h) {
    const d = h.data;
    d.preWildShapeHp = d.hp;
    const formKey = d.wildShapeForm || 'bear';
    const formDef = WILD_SHAPE_FORMS[formKey] || WILD_SHAPE_FORMS.bear;
    const conM = mod(d.effStats ? d.effStats.con : (d.stats ? d.stats.con : 10));
    const hpPool = formDef.hpFormula(d.level, conM);
    
    d.wildShapeHp = hpPool;
    d.wildShapeMaxHp = hpPool;
    d.inWildShape = true;
    d.wildShapeActiveForm = formKey;
    
    recalc(d);
    if (h.ent) this.fxSwapHeroSprite(h.ent, d);
    this.playAbilityFx(h, 'wildShape', { at: h, scale: 2.0 });
    this.fxLog(`${formDef.icon} ${d.name} Wild Shapes into a ${formDef.label}! (${hpPool} HP Pool)`, 'heal');
    this.refreshHud();
  },

  /* opts.voluntary — the druid chose to drop the form (the Drop Wild Shape
     control), rather than the form's HP running out. Only the log line differs,
     but announcing "HP was depleted!" after a deliberate click was wrong, and
     the manual bonus action papered over it by logging a second, contradictory
     line right afterwards. */
  revertWildShape(h, overflow = 0, opts = {}) {
    const d = h.data;
    const formKey = d.wildShapeActiveForm || 'bear';
    const formDef = WILD_SHAPE_FORMS[formKey] || WILD_SHAPE_FORMS.bear;

    d.inWildShape = false;
    d.wildShapeHp = 0;
    d.hp = Math.max(1, (d.preWildShapeHp || d.hp) - overflow);

    recalc(d);
    if (h.ent) this.fxSwapHeroSprite(h.ent, d);
    this.playAbilityFx(h, 'wildShape', { at: h, scale: 1.8 });
    this.fxLog(opts.voluntary
      ? `🌿 ${d.name} drops ${formDef.label} form and returns to natural form (${d.hp}/${d.maxHp} HP).`
      : `🌿 ${d.name}'s ${formDef.label} HP was depleted! Reverted to natural form (${d.hp}/${d.maxHp} HP).`,
      'heal');
    this.refreshHud();
  },

  healHero(a, amt) {
    const wasDown = a.data.hp <= 0;
    if (!wasDown && amt <= 0) return;
    /* Any healing revives a downed ally (5e): floor at 1 HP and reset the
       death pose so the sprite stands back up. */
    const gain = wasDown ? Math.max(1, amt) : amt;
    a.data.hp = Math.min(a.data.maxHp, Math.max(0, a.data.hp) + gain);
    if (wasDown) {
      this._reviveHeroPose(a);
      this.fxLog(`✨ ${a.data.name} is revived at ${a.data.hp} HP!`, 'heal');
      this.refreshHud();
    }
    this.fxText('+' + gain, this._v3(a.x, 1.3, a.z), '#6ae06a');
    this.fxDrawBar(a.ent.bar, a.data.hp / a.data.maxHp);
  },

  /* Reset the downed sprite (forward lean + sunk mesh + death-anim flags) so a
     revived hero stands back up. Mirrors the pose reset used by the explore
     auto-revive and the death-respawn flow. */
  _reviveHeroPose(h) {
    h.ent.grp.rotation.z = 0;
    h.ent.grp.rotation.x = 0;
    h.ent.anim.mesh.position.y = 0;
    h._dyingStarted = false;
    h._deathLean = 0;
    h.ent.anim._dying = false;
    h.ent.anim._deathDone = false;
    h.ent.anim.play('walk');
  },

  /* Per-weapon, per-style preferred firing/engagement distance (world units).
     Kite = 80% of max range, hold = 90%, standard = 70%.  Melee reach weapons
     stand at the end of their reach instead of wading in point-blank; normal
     melee hugs the adjacent tile.  Clamped so the standoff always remains
     inside the weapon's own max range (a shot must connect). */
  desiredStandoff(h, atk) {
    if (!atk) return 1;
    const ai = (h && h.data && h.data.aiPrefs) || (h && h.aiPrefs) || {};
    /* Whole TILES — the standoff is a place to stand, and every place to stand
       is a tile centre. The old fractional bands (1.35, 4.9, 6.3…) could never
       be occupied exactly, so a hero would creep toward a target it could not
       reach and re-path every time it drifted across the band edge. */
    if (atk.melee) return reachTiles(atk);
    const rangeTiles = reachTiles(atk);
    const frac = ai.movementStyle === 'kite' ? 0.8
      : ai.movementStyle === 'hold' ? 0.9 : 0.7;
    /* At least 2 tiles (10 ft) so a shooter is never parked in melee, and
       never beyond its own range or the shot cannot connect. */
    return Math.max(2, Math.min(rangeTiles - 1, Math.round(rangeTiles * frac)));
  },

  /* dynamic in-combat positioning: hold a standoff band around the foe at the
     weapon's preferred distance (see desiredStandoff).  Only the current actor
     moves; once inside the band the hero holds still and spends no movement,
     so ranged heroes stop burning their whole move budget orbiting.  Movement
     is tile-based (moveStep → grid-cell centres), never fractional nudgeToward,
     and the destination is always a whole floor tile — never the foe's cell. */
  combatMove(h, foe, atk, dt) {
    if (h.combatFoe !== foe) {
      h.combatFoe = foe;

      /* Which side of the foe does this hero want to stand on?
       *
       * This used to be the direction from the foe toward the ROOM CENTRE, a
       * leftover from when combat was a free-form brawl and the goal was to
       * fan the party out into the open floor instead of letting them clump
       * against a wall. On a grid with real standoff bands it backfires: when
       * the party comes in through a door and the monster stands between them
       * and the middle of the room, every hero's "ideal" spot is on the FAR
       * side of the monster. A ranged hero already at a perfectly good
       * distance would walk around (or straight through) the fight to get
       * there — which is why shooters kept ending up toe-to-toe.
       *
       * Anchoring on the bearing the hero already has means a hero that is
       * well placed simply adjusts range and holds. Bodies can no longer share
       * a tile, so nothing is needed to keep the party spread out. */
      let ang = Math.atan2(h.z - foe.z, h.x - foe.x);
      if (!Number.isFinite(ang)) ang = Math.random() * Math.PI * 2;

      /* Corridor fight: only one axis is open, so snap to whichever end of it
         the hero is already nearer. A cell is in a corridor when both cardinal
         neighbours on an axis are walls; the open axis is the perpendicular. */
      const fc = this.cellOf(foe.x, foe.z);
      if (fc >= 0) {
        const { W, grid } = this.D;
        const cfx = fc % W, cfy = Math.floor(fc / W);
        const xBlocked = (cfx > 0 && grid[fc - 1] === WALL) && (cfx < W - 1 && grid[fc + 1] === WALL);
        const zBlocked = (cfy > 0 && grid[fc - W] === WALL) && (cfy < this.D.H - 1 && grid[fc + W] === WALL);
        if (xBlocked !== zBlocked) {
          ang = xBlocked
            ? (Math.sin(ang) >= 0 ? Math.PI / 2 : -Math.PI / 2)   /* Z axis open */
            : (Math.cos(ang) >= 0 ? 0 : Math.PI);                 /* X axis open */
        }
      }

      h.anchorAngle = ang;
      h.swayPhase = Math.random() * 6.28;
      h.swayDir = Math.random() < 0.5 ? -1 : 1;
    }
    const R = this.desiredStandoff(h, atk);
    const dist = Math.hypot(foe.x - h.x, foe.z - h.z);

    /* Hold band.  Inside it we stand still and spend zero movement.  Melee
       heroes hold as soon as they can land a hit (no micro-adjustment around
       the foe); reach melee holds at the end of the reach; ranged heroes hold
       around the 80% band and only step out again if a monster closes in. */
    let hold;
    if (atk.melee) {
      hold = dist >= R - 0.8;
    } else {
      hold = dist >= R - 1.0 && dist <= R + 1.0;
    }
    if (hold) {
      h.combatFoe = foe;
      h.moving = false;
      this.clearEntityPath(h);
      return;
    }

    const tactical = !!(this.initiative && this.initiative.active);
    if (tactical && (!this.isCurrentActor(h) || (h.moveLeft || 0) <= 0)) {
      h.moving = false;
      return;
    }

    /* Pick a whole-tile destination on the standoff ring and step to it.
       The slow sin() sway is FROZEN when the hero is close to the foe
       (within R+2.0): without this, heroes just outside the hold band
       re-pathed every 0.4 s onto a swaying target tile and visibly shuffled
       around the foe. Far away, the sway still spreads multiple heroes into
       a ring so they don't all converge on the same approach vector. */
    const swayOn = dist > R + 2.0;
    const ang = h.anchorAngle + (swayOn ? (Math.sin(this.elapsed * 0.75 + h.swayPhase) * 0.4 * h.swayDir) : 0);
    const tx = foe.x + Math.cos(ang) * R;
    const tz = foe.z + Math.sin(ang) * R;
    let tc = this.cellOf(tx, tz);
    if (tc < 0 || this.D.grid[tc] !== FLOOR) tc = this.nearFloorCell(tc, 1);
    /* nearFloorCell only knows about walls, so the standoff tile it hands back
       can already have somebody on it. Slide to a free neighbour rather than
       pathing into an occupied square. */
    if (tc >= 0 && typeof this.getUnoccupiedCellNear === 'function') {
      tc = this.getUnoccupiedCellNear(tc, h, 2);
    }
    if (tc < 0) { h.moving = false; return; }

    if (!this.hasLivePath(h)) {
      const cur = this.cellOf(h.x, h.z);
      if (cur === tc) { h.moving = false; this.clearEntityPath(h); return; }
      this.setEntityPath(h, this.findPath(cur, tc, { mover: h }));
    }
    if (h.path && h.pathI < h.path.length) {
      const spd = HERO_SPEED * COMBAT_SPEED * h.data.speedMult * this.hasteMult(h)
        * (tactical ? COMBAT_MOVE_BOOST : 1);
      h.moving = this.moveStep(h, spd, dt);
    } else {
      h.moving = false;
    }
  },

  /* Effect-aware speed multiplier: haste raises it, slows/restrained/prone lower
     it (bidirectional since the monster-abilities work — Slow now actually slows). */
  hasteMult(h) { return getEffectMods(h).speedMul; },
  heroAC(h) {
    let ac = h.data.ac;
    const mods = getEffectMods(h);
    ac += mods.acBonus;
    ac += this.subclassACBonus(h); // conditional subclass passive (Hold the Line / Cloak of Shadows)
    /* Phase Step legendary perk: short AC surge after a kill. */
    if (h.phaseStepUntil && this.elapsed < h.phaseStepUntil) ac += h.phaseStepAc || 4;
    /* Barkskin: AC has a floor (default 16) while the effect is active. */
    if (mods.acFloor) ac = Math.max(ac, mods.acFloor);
    return ac;
  },

  /** Spend temp HP against incoming damage, return the unabsorbed remainder.
   *  Pure resource math — no concentration/charm/uncanny side effects, so it's
   *  safe for DoT ticks and non-attack mishaps. Temp HP is never regained. */
  absorbTempHp(h, dmg, detail = null) {
    let d = dmg;
    if (h.data.tempHp > 0) {
      const absorb = Math.min(h.data.tempHp, d);
      h.data.tempHp -= absorb;
      d -= absorb;
      if (detail) detail.tempAbsorbed = (detail.tempAbsorbed || 0) + absorb;
    }
    return d;
  },

  /** Short suffix for a combat-log line explaining why a blow landed for less
   *  than it rolled. Empty when nothing was mitigated, so the common case reads
   *  exactly as before. */
  describeMitigation(mit, raw, dealt) {
    if (!mit || dealt === raw) return '';
    const parts = [];
    if (mit.tempAbsorbed > 0) parts.push(`${mit.tempAbsorbed} soaked by temp HP`);
    const other = (raw - dealt) - (mit.tempAbsorbed || 0);
    if (other > 0) parts.push(`${other} reduced`);
    return parts.length ? ` (${parts.join(', ')})` : '';
  },

  /** The floating number over a hero. A bare "0" is meaningless — it looks like
   *  a bug rather than a shield holding — so when the blow was fully absorbed,
   *  say that instead of printing nothing-shaped digits. */
  fxDamageNumber(h, dealt, mit, color) {
    const pos = this._v3(h.x, 1.2, h.z);
    if (dealt > 0) { this.fxText(String(dealt), pos, color); return; }
    const soaked = mit && mit.tempAbsorbed > 0;
    this.fxText(soaked ? 'absorbed' : '0', pos, soaked ? '#6ae0ff' : '#9aa');
  },

  /** Incoming damage after rage / totem / uncanny dodge / temp HP. */
  /** `detail`, when passed, is filled in with how the blow was reduced:
   *  { raw, dealt, tempAbsorbed, mitigated }. Callers use it to say something
   *  truthful on screen — a bare "0" over a hero's head with no explanation
   *  reads as a bug, and the combat log printing the RAW roll while the
   *  floating number printed the mitigated one made the two contradict
   *  each other outright. */
  applyIncomingDamage(h, dmg, detail = null) {
    /* Same floor as damageMonster, for the same reason: this ends in `hp -= d`,
       so a negative would heal the hero it was supposed to hurt. */
    let d = Math.max(0, dmg);
    if (detail) { detail.raw = d; detail.tempAbsorbed = 0; }
    const mods = getEffectMods(h);
    d = Math.round(d * mods.dmgTakenMul);
    d = Math.round(d * this.subclassIncomingMul(h)); // subclass passive (e.g. Bear Spirit)
    if (hasFeature(h.data, 'uncannyDodge') && !h.uncannyUsed) {
      h.uncannyUsed = true;
      d = Math.ceil(d / 2);
    }
    /* Feat flat damage reduction (Heavy Armor Master). */
    d = featIncomingDamage(h.data, d);
    d = this.absorbTempHp(h, d, detail);

    /* Wild Shape health pool absorption */
    if (h.data.inWildShape && h.data.wildShapeHp > 0) {
      if (d <= h.data.wildShapeHp) {
        h.data.wildShapeHp -= d;
        if (d > 0) h.data.dmgTaken = (h.data.dmgTaken || 0) + d;
        if (h.ent && h.ent.bar) this.fxDrawBar(h.ent.bar, h.data.wildShapeHp / h.data.wildShapeMaxHp, '#2ecc71');
        if (h.data.wildShapeHp <= 0) {
          this.revertWildShape(h, 0);
        }
        if (detail) { detail.dealt = d; detail.mitigated = (detail.raw || 0) - d; }
        return d;
      } else {
        const overflow = d - h.data.wildShapeHp;
        const absorbed = h.data.wildShapeHp;
        h.data.wildShapeHp = 0;
        if (d > 0) h.data.dmgTaken = (h.data.dmgTaken || 0) + absorbed;
        this.revertWildShape(h, overflow);
        if (detail) { detail.dealt = d; detail.mitigated = (detail.raw || 0) - d; }
        return d;
      }
    }
    /* Death Ward: if hit would be lethal, survive at 1 HP instead */
    if (hasEffect(h, 'deathWarded') && d >= h.data.hp) {
      clearEffect(h, 'deathWarded');
      d = Math.max(0, h.data.hp - 1);
      this.fxLog(`🛡 ${h.data.name}'s Death Ward triggers — survives at 1 HP!`, 'heal');
    }
    h.data.hp -= d;
    if (d > 0) h.data.dmgTaken = (h.data.dmgTaken || 0) + d;
    if (h.companion && h.data.hp <= 0 && this.killCompanion) {
      this.killCompanion(h);
    }
    /* Charm breaks on damage (5e): taking damage grants a fresh save. */
    if (d > 0 && hasEffect(h, 'charmed')) {
      const eff = getEffect(h, 'charmed');
      const rs = eff.repeatSave || { ability: 'wis', dc: 12 };
      if (rollSave(h, rs.ability || 'wis', rs.dc || 12, { magic: true })) {
        clearEffect(h, 'charmed');
        this.fxLog(`💫 ${h.data.name} snaps out of the charm!`, 'heal');
        this.fxText('charm broken', this._v3(h.x, 1.35, h.z), '#e8a8ff');
      }
    }
    /* Concentration check (5e): CON save DC max(10, half damage), or the spell drops */
    if (h.conc) {
      if (h.data.hp <= 0) {
        this.breakConcentration(h, 'downed');
      } else if (d > 0) {
        const dc = Math.max(10, Math.floor(d / 2));
        if (!rollSave(h, 'con', dc)) this.breakConcentration(h, `took ${d} damage — failed DC ${dc} CON save`);
      }
    }
    if (detail) { detail.dealt = d; detail.mitigated = (detail.raw || 0) - d; }
    return d;
  },

  /* ── Charmed hero: fights for the charmer ──────────────────────────
     A charmed hero switches teams — attacks the nearest living ally until the
     charm breaks (damage-triggered save in applyIncomingDamage, or the repeat
     save each round via tickEffects). Runs INSTEAD of heroCombat (game.js). */
  charmedHeroUpdate(h, alive, dt) {
    /* initiative gate, same as heroCombat */
    if (this.initiative && this.initiative.active && !this.isCurrentActor(h)) return;
    if (getEffectMods(h).incapacitated) { h.moving = false; return; }

    /* nearest living ally (not self) */
    let ally = null, bd = 1e9;
    for (const o of alive) {
      if (o === h || o.data.hp <= 0) continue;
      const d = Math.hypot(o.x - h.x, o.z - h.z);
      if (d < bd) { bd = d; ally = o; }
    }
    if (!ally) { h.moving = false; return; }

    const profile = pickAttackProfile(h.data) || h.data.lastProfile || CLASSES[h.data.classKey].attack;
    h.data.lastProfile = profile;
    const range = profile.melee ? 1.2 : profile.range;

    if (bd > range) {
      /* stalk the ally */
      if (!this.hasLivePath(h)) {
        let goal = this.cellOf(ally.x, ally.z);
        if (typeof this.approachCellNear === 'function') goal = this.approachCellNear(goal, h);
        this.setEntityPath(h, this.findPath(this.cellOf(h.x, h.z), goal, { mover: h }));
      }
      h.moving = this.moveStep(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt);
      this.faceTowards(h, ally.x, ally.z, dt);
      return;
    }

    h.moving = false;
    this.faceTowards(h, ally.x, ally.z, dt);
    if (h.actUsed) return;
    h.actUsed = true;

    /* one attack roll vs the ally's AC */
    const d20 = d20Roll(0);
    const total = d20 + (h.data.atkProf || 0) + mod(h.data.effStats[profile.ability] || 10);
    const crit = d20 === 20;
    const ac = this.heroAC(ally);
    this.triggerLunge(h, ally);
    this.fxPlaySfx('swordAttack', { volume: 0.6 });
    if (!crit && total < ac) {
      this.showMiss(ally, h);
      this.fxLog(`💜 ${h.data.name} (charmed) swings at ${ally.data.name} — miss!`, 'miss');
      return;
    }
    const dmg = heroDamage(h.data, crit, profile);
    this.fxLog(`💜 ${h.data.name} (charmed) hits ${ally.data.name} for ${dmg}!`, 'down', { cat: 'hitmiss' });
    this.hurtHero(ally, dmg, h, 0xe8a8ff, profile.dmgType);
  },

  /* ── Effect-based DoTs on heroes (poison, swallow acid, wounded…) ──
     applyEffect stores { dotDmg, dotClock } on the record; one damage pulse per
     round, matching 5e's "at the start of each of its turns". The pulse is
     driven off the combat clock rather than real seconds so a poison ticks the
     same number of times whether a round resolves fast or slow — and doesn't
     tick at all while the party is out of combat.
     Called each frame from the hero status loop in game.js. */
  tickHeroDots(h) {
    if (!h._effects || h.data.hp <= 0) return;
    for (const k in h._effects) {
      const eff = h._effects[k];
      if (eff.dotDmg == null) continue;
      if (eff.dotClock == null) eff.dotClock = this.fxNow;
      if (this.fxNow - eff.dotClock < ROUND_SECONDS) continue;
      eff.dotClock += ROUND_SECONDS;
      /* Temp HP soaks DoTs too (5e), but skip the combat-reaction side effects
         of applyIncomingDamage — a 1/sec tick must not burn Uncanny Dodge. */
      const d = this.absorbTempHp(h, eff.dotDmg);
      h.data.hp -= d;
      h.data.dmgTaken = (h.data.dmgTaken || 0) + d;
      this.fxText(String(d), this._v3(h.x, 1.15, h.z), '#4cae4c');
      this.fxDrawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
      if (h.data.hp <= 0) {
        if (h.companion && this.killCompanion) {
          this.killCompanion(h);
        } else {
          h.data.hp = 0; h.data.downs++;
          this.fxLog(`💀 ${h.data.name} succumbs to ${(EFFECTS[k] && EFFECTS[k].label) || k} and goes down!`, 'down');
        }
        this.refreshHud();
      }
    }
  },

  /** `onDealt(dealt, modLabel)` fires when the blow ACTUALLY resolves, with the
   *  post-mitigation number. The caller logs from there rather than up front:
   *  a ranged attack resolves inside the projectile's onImpact, half a second
   *  after it was rolled, and resistance/immunity are applied inside
   *  damageMonster — so a line printed before the swing lands is reporting the
   *  raw roll, not what happened. That is how "hit, 14 dmg" ended up over a
   *  floating 13. */
  strike(h, foe, dmg, crit, miss, alive = null, profile = null, onDealt = null) {
    /* Profile carries melee/ranged, damage type, and source — drives the
       lunge-vs-projectile visual and the physical damage type. */
    const p = profile || h.data.lastProfile || h.data.weaponProfile
      || { melee:true, dmgType:'slashing', source:'weapon' };
    const party = alive || this.heroes.filter(x => x.data.hp > 0);
    /* Magic Weapon (spell): weapon counts as magical → bypasses nonmagical resistance.
       Cantrips are inherently magical. */
    const wDmgType = p.dmgType || 'slashing';
    const wMagical = !!getEffectMods(h).magicWeapon || p.source === 'cantrip';
    const elemDamage = (p.source !== 'cantrip' && h.data?.elemDamage && (h.data?.elemDamageTotal > 0))
      ? h.data.elemDamage
      : null;
    if (p.melee) {
      this.triggerLunge(h, foe);
      this.fxPlaySfx('swordAttack', { volume: 0.7 });
      if (miss) { this.showMiss(foe, h); this.fxPlaySfx(Math.random() < 0.5 ? 'swordBlock' : 'swordParry', { volume: 0.6 }); }
      else {
        this.fxPlaySfx('swordHit', { volume: 0.8 });
        if (crit) {
          this.triggerHitStop(4);
          this.triggerShake(0.5, 0.25);
        } else {
          this.triggerHitStop(1);
        }
        const res = this.damageMonster(foe, dmg, h, crit, { dmgType: wDmgType, magical: wMagical, elemDamage });
        if (onDealt) onDealt(res.dmg, res.modLabel);
        this.applyOnHitPerks(h, foe, dmg, crit, party);
        /* Monk Stunning Strike (Level 5+): spend 1 Ki on melee hit to stun foe */
        if (hasFeature(h.data, 'stunningStrike') && hasKi(h.data, 1) && foe && foe.data && foe.data.hp > 0 && !hasEffect(foe, 'stunned')) {
          const abilityUse = getAbilityUseWeight(h);
          const worthy = foe.isBoss || this.monsterEliteRoom(foe) || (foe.data.hp / Math.max(foe.data.maxHp, 1) > 0.3) || foe.data.caster;
          if (abilityUse > 0 && worthy) {
            spendKi(h.data, 1);
            const dc = h.data.kiSaveDC || (8 + (h.data.atkProf || 2) + mod(h.data.effStats?.wis || 10));
            const saveRes = rollSaveDetail(foe, 'con', dc);
            if (!saveRes.pass) {
              applyEffect(foe, 'stunned', { duration: 6.0, elapsed: this.fxNow, source: h });
              this.playAbilityFx(foe, 'stunningStrike', { at: foe });
              this.fxLog(`💫 ${h.data.name} delivers a Stunning Strike! ${foe.data.name} is stunned! (Save ${saveRes.total} vs DC ${dc})`, 'crit');
            } else {
              this.fxLog(`💫 ${foe.data.name} resists Stunning Strike (Save ${saveRes.total} vs DC ${dc}).`, 'miss');
            }
          }
        }
        this.fxMeleeHitVFX({ x: foe.x, z: foe.z }, { x: h.x, z: h.z }, crit, wDmgType, foe.data.scale || 1.0, { elemDamage });
      }
    } else {
      /* Ranged: physical bows/crossbows shoot arrows; caster cantrips play their
         composite animation (vfx_animations.json) when one exists, falling back
         to the classic projectile + CANTRIP_FX burst. */
      const isCantrip = p.source === 'cantrip';
      const classKey = h.data.classKey;
      const anim = isCantrip ? VFX_ANIMS[CANTRIP_ANIM_BINDINGS[classKey]] : null;
      const cfx = isCantrip ? CANTRIP_FX[classKey] : null;
      const color = cfx ? cfx.color : 0xe8d8a8;
      const kind = isCantrip ? 'bolt' : 'arrow';
      const foeScale = (foe && foe.data && foe.data.scale != null) ? foe.data.scale : 1.0;
      const from = this._v3(h.x, 0.55, h.z);
      const to = this._v3(foe.x, 0.4 * foeScale + 0.4, foe.z);

      /* Resolve the hit once the effect lands (composite impact or projectile). */
      const resolveHit = () => {
        if (foe.dead) return;
        /* The target may have moved while the bolt was in the air, so re-aim
           the impact at where it actually is — otherwise the burst blooms in
           the square it left. The travel FX tracked it via `follow`; this is
           the same correction for the impact visuals. */
        /* Field assignment, not to.set(): the browser passes a THREE.Vector3
           but the headless sim's _v3 is a plain {x,y,z}, and calling .set on
           that threw straight through every sim run. */
        const curFoeScale = (foe && foe.data && foe.data.scale != null) ? foe.data.scale : 1.0;
        to.x = foe.x; to.y = 0.4 * curFoeScale + 0.4; to.z = foe.z;
        if (miss) {
          if (isCantrip) {
            this.fxText('Saved!', this._v3(foe.x, 1.1, foe.z), '#9aa');
            if (h && this.triggerDodge) this.triggerDodge(foe, h);
            this.fxPlaySfx('spellImpact', { volume: 0.45 });
          } else {
            this.showMiss(foe, h);
            this.fxPlaySfx('bowBlock', { volume: 0.55 });
          }
          return;
        }
        this.fxPlaySfx(kind === 'arrow' ? 'bowHit' : 'spellImpact', { volume: 0.75 });
        const res = this.damageMonster(foe, dmg, h, crit, { dmgType: wDmgType, magical: wMagical, elemDamage });
        if (onDealt) onDealt(res.dmg, res.modLabel);
        this.applyOnHitPerks(h, foe, dmg, crit, party);
        if (kind === 'bolt') {
          if (!anim && cfx) this.fxSheetEffect(cfx, to, cfx.scale * Math.max(1, curFoeScale * 0.8));
          else if (!anim) this.fxSprite('dcss/effect/magic_bolt_1.png', to, 1.2, 0.3);
        } else {
          /* Physical projectiles only. A cantrip's impact is its own sheet /
             composite above; the weapon-hit burst treats every non-piercing,
             non-bludgeoning type as a slash, so it was laying a blade cut
             over every Eldritch Blast, Fire Bolt and Sacred Flame. */
          this.fxMeleeHitVFX({ x: foe.x, z: foe.z }, { x: h.x, z: h.z }, crit, wDmgType, curFoeScale, { elemDamage, ranged: true });
        }
        /* Eldritch Blast invocations land WITH the bolt, and last: applying
           them when the attack was ROLLED shoved the target clear a whole
           travel time before the beam arrived, so the bolt flew into the empty
           square it had just been knocked out of. Kept after the impact
           visuals so those still play where the bolt actually struck. */
        if (p.beams) this.applyBlastRiders(h, foe);
      };

      if (isCantrip) {
        /* Composite animation when the class has one, else the bolt with that
           class's sheet. Shared with monster casters via fxCantripDelivery so
           the same cantrip looks the same whoever casts it. `follow` homes on
           the target: over a ~0.55 s flight it can be shoved by an earlier
           beam, step away on its own turn, or be pulled in. */
        this.fxCantripDelivery(from, to, classKey, {
          color, dmgType: wDmgType, follow: foe, onImpact: resolveHit
        });
      } else {
        this.fxPlaySfx('bowAttack', { volume: 0.7 });
        this.fxProjectile(from, to, 'arrow', color, resolveHit, { dmgType: wDmgType, scale: 1.0 });
      }
    }
  },

  /** Deliver a cantrip the way a hero casts it: the composite travel+impact
   *  animation when that class has one (vfx_animations.json), otherwise the
   *  classic bolt with that class's own projectile sheet.
   *
   *  Shared deliberately. Monster casters used to hand-roll a bare
   *  `fxProjectile(..., 'bolt', ...)` with no opts, which fell through
   *  spawnProjectile's element fallback to a generic red sparkle — a cultist
   *  casting Chill Touch looked nothing like a hero casting Chill Touch. Both
   *  paths now read the same CANTRIP_FX / CANTRIP_ANIM_BINDINGS tables, so
   *  adding a cantrip in one place updates every caster that uses it.
   *
   *  `onImpact` resolves the hit; the caller owns damage and riders. */
  fxCantripDelivery(from, to, classKey, opts = {}) {
    const anim = VFX_ANIMS[CANTRIP_ANIM_BINDINGS[classKey]];
    const cfx = CANTRIP_FX[classKey];
    const color = opts.color != null ? opts.color : (cfx ? cfx.color : 0xe8d8a8);
    const onImpact = opts.onImpact || (() => {});

    if (anim) {
      this.fxCompositeAnimation(anim, from, to, {
        travelSound: () => this.fxPlaySfx(this.fxCantripSfx(classKey), { volume: 0.4 }),
        impactSound: false,
        onImpact,
        follow: opts.follow || null
      });
      return;
    }
    this.fxPlaySfx(this.fxCantripSfx(classKey), { volume: 0.4 });
    this.fxProjectile(from, to, 'bolt', color, onImpact, {
      classKey,
      sheetDef: cfx?.projSheet ? GIGAPACK_REGISTRY[cfx.projSheet] : null,
      dmgType: opts.dmgType || 'magic',
      scale: 1.4,
      follow: opts.follow || null
    });
  },

  showMiss(foe, from) {
    if (!foe) return;
    this.fxText('miss', this._v3(foe.x, 1.1, foe.z), '#9aa');
    if (from) this.triggerDodge(foe, from);
  },

  triggerLunge(e, target) {
    const dx = target.x - e.x, dz = target.z - e.z, d = Math.hypot(dx, dz) || 1;
    e.lungeDX = dx / d; e.lungeDZ = dz / d;
    e.lungeDur = 0.22; e.lungeAmp = 0.16; e.lungeT = 0.22;
  },

  /** Target leans away from `from` then the sin envelope snaps them back. */
  triggerDodge(e, from) {
    if (!e || !from) return;
    const dx = e.x - from.x, dz = e.z - from.z, d = Math.hypot(dx, dz) || 1;
    e.lungeDX = dx / d; e.lungeDZ = dz / d;
    e.lungeDur = 0.20; e.lungeAmp = 0.14; e.lungeT = 0.20;
  },

  /** Per-frame visual offset applied to a sprite on top of its real position:
   *  the attack lunge, plus the knockback glide left behind by pushEntity. */
  lungeOffset(e, dt) {
    let ox = 0, oz = 0;
    if (e.lungeT && e.lungeT > 0) {
      e.lungeT -= dt;
      const dur = e.lungeDur > 0 ? e.lungeDur : 0.22;
      const peak = e.lungeAmp != null ? e.lungeAmp : 0.16;
      const p = 1 - Math.max(0, e.lungeT) / dur;
      /* 0.42 reached the tile edge and read as post-attack jitter. Keep the
         punch, stay well inside the square. */
      const amp = Math.sin(Math.min(1, p) * Math.PI) * peak;
      ox += e.lungeDX * amp;
      oz += e.lungeDZ * amp;
    }
    /* Knockback: the entity is already standing on its destination cell, so
       the offset starts at the full displacement (putting the sprite back
       where it was hit) and eases to zero. */
    if (e.knockT && e.knockT > 0) {
      e.knockT = Math.max(0, e.knockT - dt);
      const k = e.knockDur > 0 ? e.knockT / e.knockDur : 0;
      const ease = k * k;
      ox += (e.knockOX || 0) * ease;
      oz += (e.knockOZ || 0) * ease;
    }
    return [ox, oz];
  },

  damageMonster(m, dmg, h, crit = false, opts = {}) {
    if (m.dead) return { dmg: 0, modLabel: null };

    // Guild: War Room Monster Slaying Orders & Academy Tech Passives
    if (this.guild && dmg > 0) {
      if (opts.spell) {
        const spellBonus = this.guild.getTechBonus ? this.guild.getTechBonus('spellDmgBonus') : 0;
        if (spellBonus > 0) dmg = Math.round(dmg * (1 + spellBonus));
      } else {
        const physBonus = this.guild.getTechBonus ? this.guild.getTechBonus('physDmgBonus') : 0;
        if (physBonus > 0) dmg = Math.round(dmg * (1 + physBonus));
      }

      if (this.guild.isUnlocked && this.guild.isUnlocked('war_room') && this.guild.activeSlayingOrder && m.data) {
        const orderKey = this.guild.activeSlayingOrder;
        const mFam = (m.data.family || '').toLowerCase();
        const mId = (m.data.id || '').toLowerCase();
        const mName = (m.data.name || '').toLowerCase();

        const matchesOrder =
          (orderKey === 'undead_purge' && (mFam === 'undead' || mId.includes('skeleton') || mId.includes('zombie') || mId.includes('ghost') || mName.includes('lich') || mName.includes('vampire'))) ||
          (orderKey === 'fiendbane' && (mFam === 'fiend' || mFam === 'demon' || mFam === 'devil' || mId.includes('imp') || mId.includes('cultist'))) ||
          (orderKey === 'dragon_hunt' && (mFam === 'dragon' || mId.includes('dragon') || mId.includes('wyrm') || mId.includes('drake'))) ||
          (orderKey === 'beast_cull' && (mFam === 'beast' || mFam === 'monstrosity' || mId.includes('wolf') || mId.includes('spider') || mId.includes('bear'))) ||
          (orderKey === 'aberration_ward' && (mFam === 'aberration' || mId.includes('flayer') || mId.includes('beholder') || mId.includes('slime')));

        if (matchesOrder) {
          const warLvl = this.guild.getFacilityLevel('war_room');
          const bonusPct = 0.10 + warLvl * 0.02;
          dmg = Math.round(dmg * (1 + bonusPct));
        }
      }
    }

    // Inscribed Weapon Runes (e.g. Vampiric Rune heal)
    const heroWeapon = h?.data?.equipment?.weapon || h?.data?.inventory?.find(i => i.slot === 'weapon' && i.equipped);
    const inscribed = heroWeapon?.inscribedRune || h?.data?.inscribedRune;
    if (inscribed && dmg > 0) {
      if (inscribed.runeKey === 'rune_vampire' && h && h.data) {
        this.healHero(h, Math.max(1, Math.round(dmg * 0.06)));
      }
    }

    /* Damage-type modifiers: resistance / immunity / vulnerability (5e).
     * Spell damage passes { dmgType, magical:true }; weapon strikes pass a
     * physical type with magical:false so nonmagical-weapon resistance applies.
     * Elemental damage from gear/affixes applies separately so that nonmagical
     * weapon immunity (e.g. wererats, ghosts, golems) does not negate +fire, +cold, etc. */
    let modLabel = null;
    let finalDmg = dmg;
    const originalDmg = dmg;   // pre-resistance, for the "a landed hit does >= 1" floor
    const resistedTypes = [];
    const vulnTypes = [];
    const damageBreakdown = [];

    if (opts.elemDamage && typeof opts.elemDamage === 'object' && dmg > 0) {
      const elemSum = Object.values(opts.elemDamage).reduce((acc, v) => acc + (v || 0), 0);
      const physDmg = Math.max(0, dmg - elemSum);
      let physFinal = physDmg;
      let physMod = null;
      if (opts.dmgType && physDmg > 0) {
        physMod = this.damageModifier(m, opts.dmgType, !!opts.magical || !!opts.spell);
        if (physMod === 'immune') physFinal = 0;
        else if (physMod === 'vuln') {
          physFinal = physDmg * 2;
          vulnTypes.push(opts.dmgType);
        }
        else if (physMod === 'resist') {
          physFinal = Math.floor(physDmg / 2);
          resistedTypes.push(opts.dmgType);
        }
      }
      if (physDmg > 0) {
        damageBreakdown.push({
          type: opts.dmgType || 'slashing',
          amount: physFinal,
          mod: physMod,
          original: physDmg
        });
      }
      let elemFinal = 0;
      let hasElemImmune = false;
      let hasElemResist = false;
      let hasElemVuln = false;
      for (const [elemType, val] of Object.entries(opts.elemDamage)) {
        if (!val || val <= 0) continue;
        const emod = this.damageModifier(m, elemType, true);
        let ed = val;
        if (emod === 'immune') { ed = 0; hasElemImmune = true; }
        else if (emod === 'vuln') {
          ed = val * 2;
          hasElemVuln = true;
          vulnTypes.push(elemType);
        }
        else if (emod === 'resist') {
          ed = Math.floor(val / 2);
          hasElemResist = true;
          resistedTypes.push(elemType);
        }
        elemFinal += ed;
        damageBreakdown.push({
          type: elemType,
          amount: ed,
          mod: emod,
          original: val
        });
      }
      finalDmg = physFinal + elemFinal;
      if (finalDmg <= 0) {
        modLabel = 'IMMUNE';
      } else {
        const parts = [];
        if (vulnTypes.length > 0) {
          const uniqueVuln = [...new Set(vulnTypes)];
          const icons = uniqueVuln.map(t => DAMAGE_TYPE_ICONS[t] || '🛡️').join('');
          parts.push(`⭕${icons}`);
        }
        if (resistedTypes.length > 0) {
          const uniqueResisted = [...new Set(resistedTypes)];
          const icons = uniqueResisted.map(t => DAMAGE_TYPE_ICONS[t] || '🛡️').join('');
          parts.push(`❌${icons}`);
        }
        if (parts.length > 0) {
          modLabel = parts.join(' ');
        }
      }
    } else if (opts.dmgType && dmg > 0) {
      const mod = this.damageModifier(m, opts.dmgType, !!opts.magical || !!opts.spell);
      if (mod === 'immune') { finalDmg = 0; modLabel = 'IMMUNE'; }
      else if (mod === 'vuln') {
        finalDmg = dmg * 2;
        const icon = DAMAGE_TYPE_ICONS[opts.dmgType] || '🛡️';
        modLabel = `⭕${icon}`;
      }
      else if (mod === 'resist') {
        finalDmg = Math.floor(dmg / 2);
        const icon = DAMAGE_TYPE_ICONS[opts.dmgType] || '🛡️';
        modLabel = `❌${icon}`;
      }
      damageBreakdown.push({
        type: opts.dmgType,
        amount: finalDmg,
        mod,
        original: dmg
      });
    } else if (dmg > 0) {
      damageBreakdown.push({
        type: null,
        amount: dmg,
        mod: null,
        original: dmg
      });
    }
    /* Floor. Two separate rules:
         - Nothing may go negative: `hp -= dmg` turns a negative into a heal,
           which is a silent, confusing way to lose a fight.
         - A blow that connected and was not shrugged off entirely deals at
           least 1. Resistance halves with Math.floor, so 1 damage resisted
           became 0 — a hit that visibly lands for nothing.
       IMMUNE stays at 0: that one is deliberate, and it is labelled on screen,
       so the player can see why nothing happened. */
    const wasImmune = modLabel === 'IMMUNE';
    dmg = Math.max(0, finalDmg);
    if (!wasImmune && originalDmg > 0 && dmg < 1) dmg = 1;
    m.data.hp -= dmg;
    if (!m.active) {
      m.active = true;
      if (m.ent && m.ent.grp) m.ent.grp.visible = true;
      this.activateRoomMonsters(m.roomId);
    }
    /* sleeping creatures wake when damaged (5e Sleep) */
    if (dmg > 0 && hasEffect(m, 'unconscious')) clearEffect(m, 'unconscious');
    if (h?.data) h.data.dmgDealt += dmg;
    /* accrue threat so damage pulls aggro off whoever's nearest */
    if (!opts.skipThreat && dmg > 0 && this.creditThreat) this.creditThreat(m, h, dmg);
    this.fxHitFlash(m.ent);

    // Combat Juice: hitstop and screen shake on critical hits and heavy damage
    if (crit) {
      if (this.triggerHitStop) this.triggerHitStop(4);
      if (this.triggerShake) this.triggerShake(0.55, 0.25);
    } else if (dmg >= 35) {
      if (this.triggerShake) this.triggerShake(Math.min(0.85, 0.35 + dmg * 0.008), 0.22);
    }

    const mScale = (m && m.data && m.data.scale != null) ? m.data.scale : 1.0;
    const hitPos = this._v3(m.x, 0.9 * mScale + 0.5, m.z);

    if (damageBreakdown.length > 1) {
      for (const comp of damageBreakdown) {
        const icon = DAMAGE_TYPE_ICONS[comp.type] || '🛡️';
        if (comp.mod === 'immune') {
          this.fxText(`IMMUNE ${icon}`, hitPos, '#9aa');
        } else if (comp.mod === 'vuln') {
          this.fxText(`${comp.amount} ⭕${icon}`, hitPos, '#4ade80', crit);
        } else if (comp.mod === 'resist') {
          this.fxText(`${comp.amount} ❌${icon}`, hitPos, '#ff8a7a', crit);
        } else {
          const col = crit ? '#ffd34a' : '#ff8a5a';
          this.fxText(`${comp.amount} ${icon}`, hitPos, col, crit);
        }
      }
    } else {
      if (modLabel === 'IMMUNE') {
        this.fxText('IMMUNE', hitPos, '#9aa');
      } else {
        const isResist = modLabel && (modLabel === 'RESIST' || modLabel.includes('❌'));
        const isVuln = modLabel && (modLabel === 'VULNERABLE' || modLabel.includes('⭕') || modLabel.includes('🟢'));
        const col = isVuln ? '#4ade80'
          : isResist ? '#ff8a7a'
          : crit ? '#ffd34a' : '#ff8a5a';
        this.fxText(String(dmg) + (modLabel ? ` ${modLabel}` : ''), hitPos, col, crit);
      }
    }
    /* Regeneration suppression (SRD trolls): fire or acid stops the healing */
    const isFireOrAcid = opts.dmgType === 'fire' || opts.dmgType === 'acid'
      || (opts.elemDamage && ((opts.elemDamage.fire || 0) > 0 || (opts.elemDamage.acid || 0) > 0));
    if (m.data.regen && dmg > 0 && isFireOrAcid) {
      m._noRegenUntil = this.fxNow + ROUND_SECONDS;   // one round, on the combat clock
    }
    /* Undead Fortitude (SRD zombies): CON save DC 5+dmg to drop to 1 HP instead,
       unless the blow was radiant or a critical hit. */
    const isRadiant = opts.dmgType === 'radiant' || (opts.elemDamage && ((opts.elemDamage.radiant || 0) > 0));
    if (m.data.hp <= 0 && m.data.undeadFortitude && dmg > 0) {
      if (crit || isRadiant) {
        this.fxLog(`☠ ${m.data.name}'s Undead Fortitude bypassed by ${crit ? 'critical hit' : 'radiant damage'}!`, 'roll');
      } else {
        const dc = 5 + dmg;
        const res = rollSaveDetail(m, 'con', dc);
        if (res.saved) {
          m.data.hp = 1;
          this.fxText('fortitude!', this._v3(m.x, 1.1, m.z), '#9aa');
          this.fxLog(`☠ ${m.data.name} refuses to die! Undead Fortitude — PASSED!`, 'crit',
            { detail: `(CON save ${res.d20} + ${res.mod} = ${res.total} vs DC ${dc})` });
        } else {
          this.fxLog(`☠ ${m.data.name} Undead Fortitude — FAILED.`, 'roll',
            { detail: `(CON save ${res.d20} + ${res.mod} = ${res.total} vs DC ${dc})` });
        }
      }
    }
    /* Phase F hooks: onDamaged retaliates against the attacker (fire
       elemental Fire Form, salamander Heated Body). onBloodied fires
       once when HP first crosses 50% (flesh-golem Berserk, enrage). */
    if (dmg > 0 && m.data.hp > 0 && m.data.abilities && h?.data?.hp > 0) {
      this.applyOnDamagedAbilities(m, h, dmg, opts);
    }
    if (!m._bloodied && m.data.hp > 0 && m.data.maxHp && m.data.hp < m.data.maxHp / 2) {
      m._bloodied = true;
      if (m.data.abilities) this.applyOnBloodiedAbilities(m);
    }
    this.fxDrawBar(m.ent.bar, Math.max(0, m.data.hp / m.data.maxHp), '#e0483a');
    if (m.data.hp <= 0) this.killMonster(m, h);
    return { dmg, modLabel };
  },

  /** Resolve a damage-type modifier for a monster target.
   *  Returns 'immune' | 'resist' | 'vuln' | null based on statblock arrays.
   *  `magical` true bypasses the "nonmagical weapons" meta-resistances. */
  damageModifier(m, dmgType, magical = false) {
    const sb = m.data?.statblock;
    if (!sb || !dmgType) return null;
    const t = dmgType;
    const isPhys = t === 'bludgeoning' || t === 'piercing' || t === 'slashing';
    /* Meta-type strings some monsters carry (e.g. mummies, devils). These only
     * bite nonmagical weapon hits; spells are magical and ignore them. */
    const physMeta = !magical && isPhys && (
      (sb.immune || []).some(x => typeof x === 'string' && x.includes('nonmagical')) ||
      (sb.resist || []).some(x => typeof x === 'string' && x.includes('nonmagical'))
    );
    if (physMeta && (sb.immune || []).some(x => typeof x === 'string' && x.includes('nonmagical'))) return 'immune';
    if ((sb.immune || []).includes(t)) return 'immune';
    if ((sb.vulnerable || []).includes(t)) return 'vuln';
    if ((sb.resist || []).includes(t)) return 'resist';
    if (physMeta) return 'resist';
    return null;
  },

  /** Damage type for the hero's active attack profile (weapon- or cantrip-driven).
   *  Kept for any external caller; combat now reads profile.dmgType directly in strike(). */
  heroWeaponDmgType(h) {
    const p = h.data.lastProfile || h.data.weaponProfile;
    return (p && p.dmgType) || 'slashing';
  },

  /** Tick burn DoTs on monsters (called from update loop).
   *  One pulse per round on the combat clock, like every other DoT — see
   *  tickHeroDots and the time-base note in conditions.js. `burn.ticks` is
   *  therefore a count of ROUNDS the burn lasts, not of real seconds. */
  updateMonsterStatus() {
    for (const m of this.monsters) {
      if (m.dead || m.data.hp <= 0 || !m.burn) continue;
      if (m.burn.clock == null) m.burn.clock = this.fxNow;
      if (this.fxNow - m.burn.clock >= ROUND_SECONDS) {
        m.burn.clock += ROUND_SECONDS;
        m.burn.ticks--;
        const bd = m.burn.dmg;
        m.data.hp -= bd;
        this.fxText(String(bd), this._v3(m.x, 1.0, m.z), '#ff7a30');
        this.fxDrawBar(m.ent.bar, Math.max(0, m.data.hp / m.data.maxHp), '#e0483a');
        if (m.data.hp <= 0) this.killMonster(m, m.burn.src);
        else if (m.burn.ticks <= 0) m.burn = null;
      }
    }
  },

  /** Any living monster still in `roomId`, ignoring `exclude` (the one that
   *  just died — its `dead` flag is set, but callers pass it for clarity).
   *
   *  Room-scoped on purpose. The boss floor clear used to scan every monster
   *  on the floor, so a single un-fought spawn in a room the party never
   *  visited kept `_bossSlain` parked and the floor never completed. */
  roomHasLivingMonsters(roomId, exclude = null) {
    return this.monsters.some(o =>
      o !== exclude && !o.dead && o.data.hp > 0 && o.roomId === roomId);
  },

  killCompanion(c, killer = null) {
    if (!c || c.dead) return;
    c.dead = true;
    c.data.hp = 0;
    if (c.ent) {
      if (c.ent.bar?.spr) c.ent.bar.spr.visible = false;
      if (c.ent.statusTray?.spr) c.ent.statusTray.spr.visible = false;
      if (c.ent.turnHighlight?.group) c.ent.turnHighlight.group.visible = false;
      if (c.ent.grp) {
        const mesh = c.ent.anim?.mesh;
        const baseScaleX = mesh?.scale?.x || 1.0;
        const baseScaleY = mesh?.scale?.y || 1.0;
        let dir = Math.random() < 0.5 ? 1 : -1;
        if (killer && (killer.x !== c.x || killer.z !== c.z)) {
          const dx = c.x - killer.x;
          dir = dx >= 0 ? 1 : -1;
        }
        c._deathAnim = {
          t: 0,
          dur: 0.65,
          targetRot: dir * (Math.PI * 0.44),
          baseScaleX,
          baseScaleY,
          poppedBurst: false
        };
        if (mesh?.material) {
          mesh.material.transparent = true;
          mesh.material.alphaTest = 0;
          mesh.material.rotation = 0;
        }
      }
    }
    const name = c.data.name || 'Companion';
    this.fxLog(`💨 ${name} is destroyed and dissipates!`, 'down');
    if (typeof this.triggerShake === 'function') this.triggerShake(0.5, 0.25);
    if (this.refreshHud) this.refreshHud();
  },

  killMonster(m, h) {
    m.dead = true;
    m.burn = null;
    if (m.ent) {
      if (m.ent.bar?.spr) m.ent.bar.spr.visible = false;
      if (m.ent.statusTray?.spr) m.ent.statusTray.spr.visible = false;
      if (m.ent.turnHighlight?.group) m.ent.turnHighlight.group.visible = false;
      if (m.ent.grp) {
        const mesh = m.ent.anim?.mesh;
        const baseScaleX = mesh?.scale?.x || 1.5;
        const baseScaleY = mesh?.scale?.y || 1.5;
        m._deathAnim = {
          t: 0,
          dur: 1.85,
          kind: 'evaporate',
          baseScaleX,
          baseScaleY,
          started: false,
          pixAcc: 0,
          /* Hold the dissolve until the killing blow has finished landing. This
             used to clear flashT and reset the colour on the spot, so the ONE
             hit that most deserves the flash and recoil was the only hit that
             never got them — the body just began evaporating mid-swing. */
          holdT: (this.fxHitFlashSeconds ? this.fxHitFlashSeconds() : 0)
        };
        if (mesh?.material) {
          mesh.material.transparent = true;
          mesh.material.alphaTest = 0;
        }
      }
    }
    /* onDeath abilities (magmin Death Burst…) detonate before the loot flow */
    if (m.data.abilities && this.monsterDeathBurst) this.monsterDeathBurst(m);
    /* bestiary: tally kills per monster id (unlocks the compendium entry at 10) */
    if (m.data && m.data.id) {
      if (!this.bestiary) this.bestiary = {};
      this.bestiary[m.data.id] = (this.bestiary[m.data.id] || 0) + 1;
    }
    if (h?.data) {
      h.data.kills++;
      this.applyOnKillPerks(h, m);
    }
    /* Companion kill: forward on-kill perks to the summoner (e.g. Beast Bond heal) */
    if (h && h.companion) {
      const s = this.heroes.find(a =>
        !a.companion && !a.temp &&
        a.data.name === h.summonerName &&
        a.data.classKey === h.summonerClassKey &&
        a.data.hp > 0);
      if (s) this.applyOnKillPerks(s, m);
    }
    /* Kill-streak tracking */
    this._killStreak = (this._killStreak || 0) + 1;
    this._killStreakTimer = 2.0;
    if (this._killStreak === 3) this.fxText('TRIPLE KILL!', this._v3(m.x, 1.5, m.z), '#ff9a3c');
    else if (this._killStreak === 5) this.fxText('MULTI KILL!', this._v3(m.x, 1.6, m.z), '#ff4030');
    else if (this._killStreak >= 7) {
      this.fxText('MASSACRE!', this._v3(m.x, 1.7, m.z), '#ffd34a');
      this.triggerShake(0.5, 0.3);
    }
    this.gold += m.data.gold;
    trackGold(this, m.data.gold);
    if (m.data.gold > 0 && typeof this.notifyLootFeedback === 'function') {
      this.notifyLootFeedback({ gold: m.data.gold });
    }
    const before = this.heroes.map(a => a.data.level);
    const dungeonLevel = this.dungeonLevel || 1;
    const share = (m.isBoss ? 10 : (m.data._ambushElite || this.monsterEliteRoom(m) ? 3 : 1)) * dungeonLevel;
    for (const a of this.heroes) if (a.data.hp > 0 && !a.temp && !a.companion) grantXp(a.data, share, (msg, style) => this.fxLog(msg, style));
    if (this.summons && typeof this.summons.syncScales === 'function') this.summons.syncScales();   // a level-up from this kill rescales companions
    if (this.guild) this.guild.dispatchDungeonXp(share);
    const killer = h?.data?.name || 'The party';
    const goldText = m.data.gold ? ` (+${m.data.gold}g, +${share} XP each)` : ` (+${share} XP each)`;
    this.fxLog(`${killer} slays the ${m.data.name}.${goldText}`, m.data._ambushElite ? 'elite' : m.isBoss ? 'boss' : 'kill');
    if (this.fxOnKill) this.fxOnKill(m, h);

    /* Rival adventurer defeat: drop equipped gear & check for full company wipe */
    if (m.isRival || (m.data && m.data.isRival)) {
      const eqItems = Object.values(m.data.equipment || {}).filter(Boolean);
      if (eqItems.length > 0 && Math.random() < 0.65) {
        const droppedItem = eqItems[Math.floor(Math.random() * eqItems.length)];
        addToInventory(this.inventory, droppedItem, this);
        trackLoot(this, droppedItem);
        if (typeof this.notifyLootFeedback === 'function') {
          this.notifyLootFeedback({ item: droppedItem });
        }
        this.fxLog(`  ↳ 🎁 ${m.data.name} dropped their ${droppedItem.name}!`, 'treasure');
      }
      const remainingRivals = this.monsters.filter(o => !o.dead && o.data && o.data.hp > 0 && (o.isRival || o.data.isRival));
      if (remainingRivals.length === 0) {
        const company = m.data.companyName || this.rivalCompany || 'The rival company';
        this.fxLog(`🏆 VICTORY! You have vanquished ${company}!`, 'crit');
        this.fxText('RIVALS VANQUISHED!', this._v3(m.x, 1.8, m.z), '#fcd34d');
        if (this.triggerShake) this.triggerShake(0.8, 0.4);
        if (this.activeQuest) this.activeQuest.rivalDefeated = true;
      }
    }

    /* Random drops: common–epic only (legendaries are quest rewards). */
    let dropChance = m.isBoss ? 1 : ((m.data._ambushElite || this.monsterEliteRoom(m)) ? 0.35 : 0.10);
    if (this.inventory && Math.random() < dropChance) {
      const it = rollItem(this.activeQuest ? this.activeQuest.level : this.dungeonLevel, Math.random, null, { source: 'trash' });
      addToInventory(this.inventory, it, this);
      trackLoot(this, it);
      if (typeof this.notifyLootFeedback === 'function') {
        this.notifyLootFeedback({ item: it });
      }
      this.fxLog(`  ↳ ${m.data.name} dropped ${it.name} (ilvl ${it.ilvl})!`, 'treasure');
    }

    /* Knowledge Tomes for the Academy: ONLY the final dungeon floor boss drops ancient tomes */
    if (this.guild && m.isBoss) {
      const q = this.activeQuest;
      const isFinalFloorBoss = !q || (this.questFloor | 0) >= (q.floors | 0);
      if (isFinalFloorBoss) {
        const tomesDropped = Math.max(1, Math.min(3, Math.floor((this.dungeonLevel || 1) / 3) + 1));
        this.guild.tomes = (this.guild.tomes || 0) + tomesDropped;
        this.fxLog(`  ↳ 📚 Recovered ${tomesDropped}x Knowledge Tomes from the dungeon boss!`, 'treasure');
      }
    }

    /* Independent dye roll — cosmetic loot on top of the gear table. */
    const dyeChance = m.isBoss ? DYE_DROP_BOSS : ((m.data._ambushElite || this.monsterEliteRoom(m)) ? DYE_DROP_ELITE : DYE_DROP_NORMAL);
    if (Math.random() < dyeChance) {
      const dye = makeDye();
      addToInventory(this.inventory, dye);
      trackLoot(this, dye);
      if (typeof this.notifyLootFeedback === 'function') {
        this.notifyLootFeedback({ item: dye });
      }
      this.fxLog(`  ↳ 🎨 ${m.data.name} dropped a ${dye.name}!`, 'treasure');
    }
    if (m.isBoss) {
      /* Boss death spectacle: hit-stop freeze, slow-mo, shake, golden fountain */
      if (this.triggerHitStop) this.triggerHitStop(8);
      this.triggerSlowMo(1.5);
      this.triggerShake(1.2, 0.6);
      this.fxDeathFountain(this._v3(m.x, 0.1, m.z));
      this.fxPlaySfx('gateOpen', { volume: 0.9 });
      const bossBonusGold = 50 * this.dungeonLevel;
      this.gold += bossBonusGold;
      trackGold(this, bossBonusGold);
      if (typeof this.notifyLootFeedback === 'function') {
        this.notifyLootFeedback({ gold: bossBonusGold });
      }

      /* Defer the floor clear until the boss ROOM is empty. */
      const minionsAlive = this.roomHasLivingMonsters(m.roomId, m);
      if (minionsAlive) {
        this._bossSlain = m;
        this.fxLog(`👑 ${m.data.name} falls! Defeat the remaining minions to conquer the floor!`, 'boss');
      } else {
        this._completeBossFloorClear(m);
      }
    } else if (this._bossSlain) {
      /* A minion died after the boss — check if the boss room is now clear */
      const anyLeft = this.roomHasLivingMonsters(this._bossSlain.roomId);
      if (!anyLeft) {
        const boss = this._bossSlain;
        this._bossSlain = null;
        this.fxLog(`🏆 All enemies defeated! The floor is conquered!`, 'boss');
        this._completeBossFloorClear(boss);
      }
    }
    if (this.heroes.some((a, i) => a.data.level > before[i])) this.announceLevelUp();

    /* Song of Rest: passive post-combat heal (10% max HP) when all room
       monsters are dead and a bard with songOfRest is in the party. */
    if (!this.roomHasLivingMonsters(m.roomId, m)) {
      for (const bard of this.heroes) {
        if (bard.data && bard.data.hp > 0 && hasFeature(bard.data, 'songOfRest')) {
          for (const ally of this.heroes) {
            if (ally.data && ally.data.hp > 0 && ally.data.hp < ally.data.maxHp) {
              const healAmt = Math.max(1, Math.floor(ally.data.maxHp * 0.10));
              ally.data.hp = Math.min(ally.data.maxHp, ally.data.hp + healAmt);
              this.fxText('+' + healAmt, this._v3(ally.x, 1.2, ally.z), '#6ae06a');
              if (ally.ent && ally.ent.bar) this.fxDrawBar(ally.ent.bar, ally.data.hp / ally.data.maxHp);
            }
          }
          this.fxLog(`🎶 ${bard.data.name}'s Song of Rest heals the party (10% max HP).`, 'heal');
          break;  // only one bard triggers Song of Rest per encounter
        }
      }
    }

    if (typeof this.refreshResources === 'function') this.refreshResources();
    if (typeof this.refreshHud === 'function') this.refreshHud();
    if (typeof this.fxRefreshMenus === 'function') this.fxRefreshMenus();
  },

  monsterEliteRoom(m) {
    const r = this.D?.rooms?.[m?.roomId];
    return !!(r && r.type === 'elite');
  },

  /** Deferred boss floor clear: rewards, banner, quest completion. Called when
      the boss AND all its minions are dead. */
  _completeBossFloorClear(boss) {
    const q = this.activeQuest;
    const finalFloor = q && (this.questFloor|0) >= (q.floors|0);

    if (finalFloor && q.rewardItem && !q.rewardClaimed) {
      this.grantQuestRewardsAtDungeonEnd();
    } else {
      this.fxShowBanner('FLOOR CLEARED!', `${boss.data.name} defeated`);
      const hoardLvl = this.activeQuest ? this.activeQuest.level : this.dungeonLevel;
      const it = rollItem(hoardLvl, Math.random, null, { source: 'hoard', luck: 4 });
      addToInventory(this.inventory, it, this);
      trackLoot(this, it);
      if (typeof this.notifyLootFeedback === 'function') {
        this.notifyLootFeedback({ item: it });
      }
      this.fxLog(`  ↳ ${it.name} (ilvl ${it.ilvl}) claimed from the hoard!`, 'treasure');
    }
    this.refreshResources();
    this.refreshHud();
    this.fxRefreshMenus();
    this._floorClearTimer = 3.0;
  },

  announceLevelUp() {
    firstRunTip('levelUp');
    const total = this.heroes.filter(h => !h.companion && !h.temp).reduce((n, h) => n + pendingPoints(h.data), 0);
    /* The level-up button was folded into Party; its badge went with it. */
    if (typeof document !== 'undefined') {
      const badge = document.getElementById('nav-party-badge');
      if (badge) { badge.textContent = total; badge.style.display = total > 0 ? '' : 'none'; }
    }
  },

  /* ================================================================
     Manual Mode Combat Execution API
     ================================================================ */

  /* Resolve the attack profile for a manual attack. `profileOverride` may be:
     - undefined/null → the equipped melee weapon profile (default attack).
     - 'thrown' → a thrown variant of the weapon (melee:false, range bumped),
       mirroring pickAttackProfile's auto-mode behaviour (srd.js).
     - 'melee' → explicit melee (same as default).
     - a full profile object → used as-is (e.g. from getAvailableAttackOptions). */
  _resolveAttackProfile(h, profileOverride) {
    const wp = (h.data && h.data.weaponProfile) || null;
    if (profileOverride && typeof profileOverride === 'object') return profileOverride;
    if (profileOverride === 'thrown' && wp) {
      return { ...wp, melee: false, range: Math.max(wp.range || 1.5, 5), thrown: true };
    }
    return wp || { name: 'Unarmed', d: 4, n: 1, type: 'bludgeoning', source: 'weapon' };
  },

  manualPerformAttack(h, targetFoe = null, profileOverride = null) {
    if (!h || h.actUsed) return false;
    const alive = this.heroes.filter(x => x.data.hp > 0);
    const foe = targetFoe || this.findMonsterTarget(h);
    if (!foe || foe.data.hp <= 0) {
      this.fxLog(`No valid target for ${h.data.name}'s attack.`, 'sys');
      return false;
    }

    const atk = this._resolveAttackProfile(h, profileOverride);
    const tiles = gridDist(this, h, foe);
    const reach = reachTiles(atk);
    const feet = gridFeet(this, h, foe);
    const inReach = canAttackFrom(this, h, foe, atk);

    /* Out of reach handling. Melee weapons walk closer and queue the strike
       on arrival (the queued-attack consumer in turn_engine fires it once in
       melee range). Ranged/thrown attacks never require adjacency — if the
       target is beyond range or out of LOS, just say so; the player can
       reposition with their movement and try again. */
    if (!inReach) {
      if (!atk.melee) {
        const why = (tiles >= 0 && tiles > reach) ? `out of range (${feet} ft, max ${reach * 5} ft)` : 'no line of sight';
        this.fxLog(`🎯 ${h.data.name} can't hit ${foe.data.name} from here — ${why}.`, 'sys');
        return false;
      }
      const budget = h.moveLeft != null ? h.moveLeft : this.cellsForSpeed(h);
      if (budget <= 0) {
        this.fxLog(`🦶 ${h.data.name} has no movement left to reach ${foe.data.name}.`, 'sys');
        return false;
      }
      const goalCell = (typeof this.approachCellNear === 'function')
        ? this.approachCellNear(this.cellOf(foe.x, foe.z), h)
        : this.nearFloorCell(this.cellOf(foe.x, foe.z), 2);
      if (goalCell >= 0) {
        const path = this.findPath(this.cellOf(h.x, h.z), goalCell, { mover: h });
        if (path && path.length > 1) {
          const maxSteps = Math.min(budget, path.length - 1);
          const actualPath = path.slice(0, maxSteps + 1);
          this.setEntityPath(h, actualPath);
          h.repathT = 0;
          h.moving = true;
          h.moveLeft = Math.max(0, budget - maxSteps);
          h._pendingAttackTarget = foe;
          this.fxLog(`🏃 ${h.data.name} moves toward ${foe.data.name}...`, 'sys');
          this.fxUpdateManualBar();
          return true;
        }
      }
      this.fxLog(`🦶 ${h.data.name} can't find a path to ${foe.data.name}.`, 'sys');
      return false;
    }

    const sc = subclassOf(h.data);
    const opts = this.buildAttackOpts(h, foe, sc);
    opts.profile = atk;

    /* Extra Attack / Thirsting Blade resolution for manual mode:
       A hero taking the Attack action receives a pool of attacks based on
       their features. Each manual strike consumes 1 attack from the pool.
       If attacks remain (e.g. killing a foe on attack 1), the hero keeps
       actUsed = false so they can target another foe or move. */
    if (h.attacksLeft == null) {
      let total = 1;
      if (hasFeature(h.data, 'extraAttack3')) total = 4;
      else if (hasFeature(h.data, 'extraAttack2')) total = 3;
      else if (hasFeature(h.data, 'extraAttack') || (hasFeature(h.data, 'thirstingBlade') && !atk.beams)) total = 2;
      h.attacksLeft = total;
      h.attackActionCommitted = true;
    }

    h.attacksLeft = Math.max(0, h.attacksLeft - 1);
    if (h.attacksLeft <= 0) {
      h.actUsed = true;
      h.attackActionCommitted = false;
    }

    this.beginBlastAction(h, atk);
    const delaySec = this.heroPerformAttack(h, foe, alive, opts);
    this.fireExtraBeams(h, foe, alive, atk);

    if (h.attacksLeft > 0) {
      h.actUsed = false;
      const atkWord = h.attacksLeft === 1 ? 'attack' : 'attacks';
      if (foe.data.hp <= 0) {
        this.fxLog(`💀 ${foe.data.name} defeated! ⚔️ ${h.data.name} has ${h.attacksLeft} ${atkWord} remaining — select another target.`, 'crit');
      } else {
        this.fxLog(`⚔️ ${h.data.name} has ${h.attacksLeft} ${atkWord} remaining this turn.`, 'sys');
      }
    }

    this.refreshHud();
    this.fxUpdateInitTracker();
    this.fxUpdateManualBar();
    return true;
  },

  /* Manual attack targeting — mirrors spell targeting. Selecting an attack
     option (melee / thrown) arms this state; the next monster click (handled
     in explore.commandMove) resolves the attack with the stored profile. Esc
     or a ground click cancels. */
  startAttackTargeting(h, profileOverride) {
    this.cancelAttackTargeting();
    this.cancelSpellTargeting();
    if (this.clearPendingMove) this.clearPendingMove();
    if (!h || h.actUsed) {
      this.fxLog(`${h ? h.data.name : 'Hero'} has no Action left to attack.`, 'sys');
      return false;
    }
    const atk = this._resolveAttackProfile(h, profileOverride);
    const ranged = !atk.melee;
    const label = atk.name || (ranged ? 'Ranged attack' : 'Melee attack');
    this.attackTargetingState = { active: true, hero: h, profile: atk, profileOverride };
    this.fxLog(`🎯 Aiming ${label} — click a target${ranged ? ` (range ${reachTiles(atk) * 5} ft)` : ''} (Esc to cancel).`, 'sys');
    this.fxUpdateManualBar();
    return true;
  },

  cancelAttackTargeting() {
    if (this.attackTargetingState && this.attackTargetingState.active) {
      this.attackTargetingState = null;
      this.fxUpdateManualBar();
    }
  },

  startSpellTargeting(h, key, radius = 4.0, isAoE = true, slotLevel = 1, isAlly = false) {
    this.cancelSpellTargeting();
    const sp = SPELLS[key] || (key === 'moveMoonbeam' ? { label: 'Move Moonbeam', color: 0xc0e8ff } : null);
    const spName = sp ? sp.label : key;
    const isMultiTarget = key === 'magicMissile' || key === 'scorchingRay';
    const totalDarts = isMultiTarget ? (key === 'magicMissile' ? 3 + Math.max(0, slotLevel - 1) : 3 + Math.max(0, slotLevel - 2)) : 1;

    this.targetingState = {
      active: true,
      hero: h,
      spellKey: key,
      radius,
      isAoE,
      isAlly,
      slotLevel,
      isMultiTarget,
      totalDarts,
      assignedTargets: [],
      isBonus: sp && (sp.bonusAction === true || sp.castingTime === 'bonus')
    };

    if (this.engine && this.engine.scene) {
      this._targetingVisualObj = this.fxAoEVisual({ x: h.x, z: h.z }, sp?.color || 0xffaa30, radius);
    }

    if (isMultiTarget) {
      this.fxLog(`🎯 Aiming ${spName} (Level ${slotLevel}) — Click target for Dart 1 of ${totalDarts} (Esc to cancel).`, 'sys');
    } else if (isAlly) {
      this.fxLog(`🎯 Aiming ${spName} [Target Ally] — Click an ally to cast (Esc to cancel).`, 'sys');
    } else {
      const modeLabel = isAoE ? `Area (${Math.round(radius * 5)} ft radius)` : `Target`;
      this.fxLog(`🎯 Aiming ${spName} [${modeLabel}] — Click target on screen to cast (Esc to cancel).`, 'sys');
    }
    this.fxUpdateManualBar();
  },

  updateSpellTargeting(x, z) {
    if (!this.targetingState || !this.targetingState.active) return;
    if (this._targetingVisualObj && this._targetingVisualObj.group) {
      this._targetingVisualObj.group.position.set(x, 0.05, z);
    }
  },

  confirmSpellTargeting(x, z, clickedTarget = null) {
    if (!this.targetingState || !this.targetingState.active) return false;
    const { hero, spellKey, slotLevel, isMultiTarget, totalDarts, assignedTargets } = this.targetingState;

    if (isMultiTarget) {
      const target = clickedTarget || (x != null && z != null ? this.monsters.find(m => m.active && m.data.hp > 0 && Math.hypot(m.x - x, m.z - z) <= 2.5) : null) || this.findMonsterTarget(hero);
      if (target) {
        assignedTargets.push(target);
        this.fxText(`🎯 Dart ${assignedTargets.length}`, { x: target.x, y: 1.5, z: target.z }, '#ffda7b');
        this.fxLog(`🎯 Dart ${assignedTargets.length} assigned to ${target.data.name} (${totalDarts - assignedTargets.length} remaining).`, 'sys');

        if (assignedTargets.length < totalDarts) {
          this.fxLog(`🎯 Click target for Dart ${assignedTargets.length + 1} of ${totalDarts}.`, 'sys');
          this.fxUpdateManualBar();
          return true;
        }
      }
    }

    const finalTargets = isMultiTarget ? (assignedTargets.length ? assignedTargets : null) : null;
    this.cancelSpellTargeting();
    return this.manualPerformSpell(hero, spellKey, clickedTarget, { x, z }, slotLevel, finalTargets);
  },

  cancelSpellTargeting() {
    if (this._targetingVisualObj && this._targetingVisualObj.group && this.engine && this.engine.scene) {
      this.engine.scene.remove(this._targetingVisualObj.group);
      this._targetingVisualObj = null;
    }
    this.targetingState = null;
    this.fxUpdateManualBar();
  },

  manualPerformSpell(h, key, targetFoe = null, targetPos = null, slotLevel = null, assignedTargets = null) {
    if (!h) return false;
    if (key === 'moveMoonbeam') {
      if (!h.conc || h.conc.key !== 'moonbeam' || !h.conc.zone) {
        this.fxLog(`No active Moonbeam to move.`, 'sys');
        return false;
      }
      if (h.actUsed) {
        this.fxLog(`${h.data.name} already used their Action this turn.`, 'sys');
        return false;
      }
      if (!targetPos && !targetFoe && this.controlMode === 'manual') {
        this.startSpellTargeting(h, 'moveMoonbeam', 1.8, true, 2);
        return true;
      }
      const pos = targetPos || (targetFoe ? { x: targetFoe.x, z: targetFoe.z } : null);
      if (pos) return this.useMoveMoonbeam(h, pos);
      return false;
    }
    const sp = SPELLS[key];
    if (!sp) return false;
    const isBonus = sp.bonusAction === true || sp.castingTime === 'bonus';
    if (isBonus && (h.bonusUsed || h._bonusActed)) {
      this.fxLog(`${h.data.name} already used their Bonus Action this turn.`, 'sys');
      return false;
    }
    if (!isBonus && (h.actUsed || (h.attacksLeft > 0 && h.attackActionCommitted))) {
      this.fxLog(`${h.data.name} already committed their Action to attacking this turn.`, 'sys');
      return false;
    }

    const isAoE = !!(sp.aoeRadius || sp.ai?.aoeRadius || sp.targetType === 'area' || sp.ai?.when === 'cluster');
    const radius = sp.aoeRadius || sp.ai?.aoeRadius || (key === 'fireball' ? 4.0 : 2.5);
    const chosenSlotLevel = slotLevel || sp.level || 1;

    const isSelf = sp.targetType === 'self' || sp.ai?.buffTarget === 'self' || sp.ai?.when === 'selfHurt' || key === 'shield' || key === 'magicWeapon';
    const isParty = sp.targetType === 'party' || sp.ai?.buffTarget === 'party' || key === 'bless';
    const isAlly = !isSelf && !isParty && (sp.ai?.buffTarget === 'ally' || sp.ai?.when === 'hurtAlly' || key === 'cureWounds' || key === 'healingWord' || key === 'shieldOfFaith');

    /* In manual mode, if no target foe or position has been selected yet, enter targeting mode (unless self or party buff)! */
    if (!targetPos && !targetFoe && !assignedTargets && this.controlMode === 'manual') {
      if (!isSelf && !isParty) {
        this.startSpellTargeting(h, key, isAoE ? radius : 1.2, isAoE, chosenSlotLevel, isAlly);
        return true;
      }
    }

    const alive = this.heroes.filter(x => x.data.hp > 0);
    const foe = isAlly ? (targetFoe || null) : (targetFoe || (targetPos ? this.monsters.find(m => m.active && m.data.hp > 0 && Math.hypot(m.x - targetPos.x, m.z - targetPos.z) <= radius) : null) || this.findMonsterTarget(h));

    /* A spell cast from an equipped scroll (not known from memory) consumes a
       scroll charge instead of a slot — flag it for markSpellUsed. */
    const viaScroll = !(h.data.knownSpells || []).includes(key) && this._equippedScroll(h.data)?.spellKey === key;
    h._scrollCastKey = viaScroll ? key : null;
    const success = sp.cast ? sp.cast(this, h, foe, alive, chosenSlotLevel, targetPos, assignedTargets) : this.resolveSpell(h, key, foe, alive);
    h._scrollCastKey = null;
    if (success) {
      if (isBonus) {
        h.bonusUsed = true;
        h._bonusActed = true;
        if ((sp.level || 0) > 0) h._bonusLeveled = true;
      } else {
        h.actUsed = true;
        h.attacksLeft = 0;
        h.attackActionCommitted = false;
      }
      if (!viaScroll) spendSlotFor(h.data, chosenSlotLevel);
      this.refreshHud();
      this.fxUpdateInitTracker();
      this.fxUpdateManualBar();
      return true;
    }
    return false;
  },

  /* Manual mode: drink the equipped potion trinket (consumes the Bonus Action
     like the AI's potion logic). */
  manualUseTrinket(h) {
    if (!h) return false;
    if (h._bonusActed || h.bonusUsed) {
      this.fxLog(`${h.data.name} already used their Bonus Action this turn.`, 'sys');
      return false;
    }
    const potion = this._equippedPotion(h.data);
    if (!potion) return false;
    if (!this._usePotion(h, potion)) return false;
    h.bonusUsed = true;
    h._bonusActed = true;
    this.refreshHud();
    this.fxUpdateInitTracker();
    this.fxUpdateManualBar();
    return true;
  },

  manualPerformCommonAction(h, actionType) {
    if (!h || h.actUsed || (h.attacksLeft > 0 && h.attackActionCommitted)) return false;
    /* Dash / Dodge / Disengage all run through the shared turn-engine helper
       (turn_engine.takeCommonAction) so manual mode and both AIs book the same
       budgets and effects. The extra flavour log stays manual-only. */
    if (actionType === 'dash') {
      const boost = this.cellsForSpeed(h);
      if (!this.takeCommonAction(h, 'dash')) return false;
      this.fxLog(`(+${boost * 5} ft movement budget)`, 'heal');
    } else if (actionType === 'dodge') {
      if (!this.takeCommonAction(h, 'dodge')) return false;
      h.dodgeActive = true;
      this.fxLog('(+5 AC until the start of their next turn)', 'heal');
    } else if (actionType === 'disengage') {
      if (!this.takeCommonAction(h, 'disengage')) return false;
      this.fxLog('(movement provokes no opportunity attacks this turn)', 'heal');
    } else if (actionType === 'help') {
      h.actUsed = true;
      h.attacksLeft = 0;
      h.attackActionCommitted = false;
      const ally = this.heroes.find(x => x !== h && x.data.hp > 0);
      if (ally) applyEffect(ally, 'inspired', { duration: ROUND_SECONDS, elapsed: this.fxNow });
      this.fxLog(`🤝 ${h.data.name} takes the Help action to assist allies!`, 'heal');
    } else {
      return false;
    }
    h.attacksLeft = 0;
    h.attackActionCommitted = false;
    this.refreshHud();
    this.fxUpdateInitTracker();
    this.fxUpdateManualBar();
    return true;
  },

  manualPerformBonusAbility(h, abilityKey) {
    if (!h || h.bonusUsed || h._bonusActed) {
      this.fxLog(`${h.data.name} already used their Bonus Action this turn.`, 'sys');
      return false;
    }
    const d = h.data;
    const alive = (this.heroes || []).filter(x => x.data && x.data.hp > 0);

    if (abilityKey === 'secondWind') {
      if (d.secondWindUsed) { this.fxLog('Second Wind has already been used.', 'sys'); return false; }
      d.secondWindUsed = true; h.bonusUsed = true; h._bonusActed = true;
      const amt = roll(1, 10, d.level);
      d.hp = Math.min(d.maxHp, d.hp + amt);
      this.playAbilityFx(h, 'secondWind', { at: h });
      this.fxText('+' + amt, this._v3(h.x, 1.55, h.z), '#6ae06a');
      this.fxDrawBar(h.ent.bar, d.hp / d.maxHp);
      this.fxLog(`💚 ${d.name} uses Second Wind (+${amt} HP).`, 'heal');
    } else if (abilityKey === 'offhand') {
      const foe = typeof this.findMonsterTarget === 'function' ? this.findMonsterTarget(h) : null;
      if (!d.offhandProfile) { this.fxLog('No off-hand weapon equipped.', 'sys'); return false; }
      if (!foe || foe.data.hp <= 0) { this.fxLog('No target for off-hand attack.', 'sys'); return false; }
      h.bonusUsed = true; h._bonusActed = true;
      this.heroPerformAttack(h, foe, alive, { profile: d.offhandProfile });
    } else if (abilityKey === 'rage') {
      if (!spendCharge(d, 'rage')) { this.fxLog('Rage has no uses left.', 'sys'); return false; }
      h.bonusUsed = true; h._bonusActed = true;
      applyEffect(h, 'raging', { duration: 30, elapsed: this.fxNow });
      this.playAbilityFx(h, 'rage', { at: h, scale: 1.7 });
      this.fxLog(`😡 ${d.name} enters a Rage!`, 'crit');
    } else if (abilityKey === 'cunningAction') {
      if (!spendCharge(d, 'cunningActionClass')) { this.fxLog('Cunning Action has no uses left.', 'sys'); return false; }
      h.bonusUsed = true; h._bonusActed = true;
      applyEffect(h, 'hasted', { duration: 30, elapsed: this.fxNow });
      this.playAbilityFx(h, 'cunningAction', { at: h });
      this.fxLog(`💨 ${d.name} uses Cunning Action (+4 AC, +40% speed)!`, 'heal');
    } else if (abilityKey === 'flurry') {
      const foe = typeof this.findMonsterTarget === 'function' ? this.findMonsterTarget(h) : null;
      if (!foe || foe.data.hp <= 0) { this.fxLog('No target for Flurry of Blows.', 'sys'); return false; }
      if (!spendKi(d, 1)) { this.fxLog('No Ki points left for Flurry of Blows.', 'sys'); return false; }
      h.bonusUsed = true; h._bonusActed = true;
      this.playAbilityFx(h, 'flurry', { at: foe });
      const profile = unarmedFallback(d);
      const delaySec = this.heroPerformAttack(h, foe, alive, { profile });
      scheduleFollowUpStrike(this, h, strikeInterval(delaySec), () => {
        if (foe && foe.data && foe.data.hp > 0 && h.data && h.data.hp > 0) {
          this.heroPerformAttack(h, foe, alive, { profile });
        }
      });
      this.fxLog(`👊 ${d.name} uses Flurry of Blows!`, 'crit');
    } else if (abilityKey === 'patientDefense') {
      if (!spendKi(d, 1)) { this.fxLog('No Ki points left for Patient Defense.', 'sys'); return false; }
      h.bonusUsed = true; h._bonusActed = true;
      applyEffect(h, 'patientDefense', { duration: ROUND_SECONDS, elapsed: this.fxNow });
      this.playAbilityFx(h, 'patientDefense', { at: h });
      this.fxLog(`🛡 ${d.name} uses Patient Defense (+5 AC)!`, 'heal');
    } else if (abilityKey === 'stepOfTheWind') {
      if (!spendKi(d, 1)) { this.fxLog('No Ki points left for Step of the Wind.', 'sys'); return false; }
      h.bonusUsed = true; h._bonusActed = true;
      applyEffect(h, 'hasted', { duration: 6.0, elapsed: this.fxNow });
      this.playAbilityFx(h, 'stepOfTheWind', { at: h });
      this.fxLog(`💨 ${d.name} uses Step of the Wind (+4 AC, +40% speed)!`, 'heal');
    } else if (abilityKey === 'bardicInspiration') {
      if (!spendCharge(d, 'bardicInspiration')) { this.fxLog('Bardic Inspiration has no uses left.', 'sys'); return false; }
      h.bonusUsed = true; h._bonusActed = true;
      for (const a of alive) applyEffect(a, 'inspired', { duration: Infinity, elapsed: this.fxNow });
      this.playAbilityFx(h, 'bardic', { at: h, alsoAt: alive, spell: true });
      this.fxLog(`🎵 ${d.name} uses Bardic Inspiration (advantage on next attack)!`, 'heal');
    } else if (abilityKey === 'dropWildShape' || abilityKey === 'revertWildShape') {
      if (!d.inWildShape) { this.fxLog(`${d.name} is not in Wild Shape.`, 'sys'); return false; }
      this.revertWildShape(h, 0, { voluntary: true });
    } else {
      return false;
    }

    this.refreshHud();
    this.fxUpdateInitTracker();
    this.fxUpdateManualBar();
    return true;
  },

  manualPerformActionAbility(h, abilityKey) {
    if (!h) return false;
    const d = h.data;
    if (!d) return false;
    const alive = (this.heroes || []).filter(x => x.data && x.data.hp > 0);

    if (abilityKey === 'actionSurge') {
      if (h._actionSurged) { this.fxLog(`${d.name} has already used Action Surge this turn.`, 'sys'); return false; }
      if (!hasFeature(d, 'actionSurgeClass') && !(subclassOf(d) && subclassOf(d).active.key === 'actionSurge')) {
        this.fxLog(`${d.name} does not have Action Surge.`, 'sys'); return false;
      }
      if (!hasCharge(d, 'actionSurgeClass')) { this.fxLog('Action Surge has no uses left.', 'sys'); return false; }
      spendCharge(d, 'actionSurgeClass');
      h._actionSurged = true;
      h.actUsed = false;
      h.attacksLeft = null;
      h.attackActionCommitted = false;
      this.playAbilityFx(h, 'actionSurge', { at: h });
      this.fxLog(`⚔ ${d.name} surges with action — one additional Action granted!`, 'crit');
    } else if (abilityKey === 'fastHands') {
      const sc = subclassOf(d);
      if (!sc || sc.active.key !== 'fastHands') { this.fxLog(`${d.name} does not have Fast Hands.`, 'sys'); return false; }
      if (!hasCharge(d, 'fastHands')) { this.fxLog('Fast Hands has no uses left.', 'sys'); return false; }
      if (h.actUsed || (h.attacksLeft > 0 && h.attackActionCommitted)) { this.fxLog(`${d.name} already used their Action this turn.`, 'sys'); return false; }
      const foes = this.monsters.filter(m => m.data && m.data.hp > 0 && m.active && Math.hypot(m.x - h.x, m.z - h.z) < 4.0);
      if (!foes.length) { this.fxLog('No foes in range for a smoke bomb (4 m).', 'sys'); return false; }
      spendCharge(d, 'fastHands');
      h.actUsed = true;
      h.attacksLeft = 0;
      h.attackActionCommitted = false;
      this.playAbilityFx(h, 'fastHands', { at: h });
      this.fxLog(`💨 ${d.name} uses Fast Hands to throw a smoke bomb!`, 'heal');
      for (const m of foes) {
        applyEffect(m, 'blinded', { duration: 6, elapsed: this.fxNow, source: h });
        this.fxText('BLINDED', this._v3(m.x, 1.3, m.z), '#888899');
      }
    } else {
      this.fxLog(`Unknown action ability: ${abilityKey}.`, 'sys');
      return false;
    }

    this.refreshHud();
    this.fxUpdateInitTracker();
    this.fxUpdateManualBar();
    return true;
  },

  manualEndTurn() {
    if (this.cancelSpellTargeting) this.cancelSpellTargeting();
    if (this.cancelAttackTargeting) this.cancelAttackTargeting();
    if (this.clearPendingMove) this.clearPendingMove();
    if (!this.initiative || !this.initiative.active) return;
    const cur = this._currentActor();
    if (cur) {
      cur.attacksLeft = null;
      cur.attackActionCommitted = false;
      this.fxLog(`⏱️ ${cur.data.name} ends their turn.`, 'sys');
    }
    if (typeof this._advanceTurn === 'function') this._advanceTurn();
    this.fxUpdateManualBar();
  }
};

export default combatMethods;
