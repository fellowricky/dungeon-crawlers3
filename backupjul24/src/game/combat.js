/**
 * Hero combat resolution: attacks, subclass actives, damage, kills, loot drops.
 * Monster chase/AI lives in monster_ai.js; this module owns hero-side fighting
 * and shared combat outcomes (damageMonster / killMonster).
 *
 * Mixed onto Game — uses pathfinding (findPath, hasLOS, stepAlong, nudgeToward).
 */
import * as THREE from 'three';
import {
  grantXp, heroAttackBonus, heroDamage, subclassOf,
  CLASSES, RACES, roll, d as die, d20Roll, mod, pendingPoints, pickAttackProfile
} from './srd.js';
import {
  drawBar, makeFloatText, hitFlash,
  spawnProjectile, spawnSlash, spawnSpriteEffect, spawnSheetEffect, spawnDeathFountain,
  spawnAoEVisual, removeAoEVisual, spawnMeleeHitVFX
} from './entities.js';
import { rollItem, makeDye, equippedPerks, perkMag } from './items.js';
import { log, updatePartyFrames, updateResources, showBanner, updateInitiativeTracker } from './ui.js';
import { refreshMenus } from './menus.js';
import {
  FLOOR, WALL, HERO_SPEED, HERO_ATTACK_CD, HERO_THINK_INTERVAL, COMBAT_SPEED, COMBAT_MOVE_BOOST, XP_SHARE
} from './constants.js';
import { _v } from './shared.js';
import { hasFeature, hasFeat, hasSlotFor, spendSlotFor, recoverSlots, totalSlots,
  featBonusDamage, featExtraAttacks, featOnHit, featIncomingDamage, featACBonus,
  featCombatStartTempHp } from './features.js';
import { onKill } from './quest_events.js';
import { trackGold, trackLoot } from './run_stats.js';
import { playSfx, spellSfx, cantripSfx } from './audio.js';
import { GIGAPACK_REGISTRY } from './gigapack_registry.js';

/* Dye drop odds per kill (independent of the gear-drop roll) */
const DYE_DROP_BOSS = 0.35, DYE_DROP_ELITE = 0.08, DYE_DROP_NORMAL = 0.02;

export function getAvailableAttackOptions(hero) {
  const options = [];
  const d = hero ? (hero.data || hero) : null;
  if (!d) return options;

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
  faerieFire:      { sheetKey: 'round_sparkle_burst_002_large_green', sprite: 'dcss/effect/cloud_spectral_0.png',
    frames: ['dcss/effect/cloud_spectral_0.png','dcss/effect/cloud_spectral_1.png','dcss/effect/cloud_spectral_2.png'],
    frameInterval: 0.07,                                        color: 0xb08cff, label: 'FAERIE FIRE', float: '#b08cff' },
  rayOfEnfeeblement:{ sheetKey: 'spell_poison_001_large_green', sprite: 'dcss/effect/cloud_meph_0.png',    color: 0xd0a080, label: 'ENFEEBLED', float: '#d0a080' },
  web:             { sheetKey: 'directional_bubble_burst_001_large_green', sprite: 'dcss/effect/net_trap.png',          color: 0xbfa060, label: 'WEB', float: '#bfa060' },
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
  guidingBolt:     { sheetKey: 'round_light_burst_001_large_yellow', sprite: 'dcss/effect/orb_glow_2.png',        color: 0xffe08a, label: 'GUIDANCE', float: '#ffe08a' },
  thunderwave:     { sheetKey: 'lightning_burst_001_large_violet', sprite: 'dcss/effect/sandblast_1.png',       color: 0xdfe4ee, label: 'THUNDER',  float: '#dfe4ee' },
  magicWeapon:     { sheetKey: 'directional_impact_004_large_yellow', sprite: 'dcss/effect/irradiate_0.png',       color: 0xb08cff, label: 'MAGIC WPN', float: '#b08cff' },
  barkskin:        { sheetKey: 'spell_defense_up_001_large_blue', sprite: 'dcss/effect/stone_arrow_0.png',     color: 0x6aaa4a, label: 'BARKSKIN', float: '#6aaa4a' },
};

/** Per-class cantrip impact FX — animated spritesheets (Pixel FX pack, 100px
 *  frames, public/fx/spells). Each caster's signature cantrip gets a unique
 *  burst on hit; `color` also tints the bolt projectile and impact ring.
 *  fps × dur controls how much of the particle loop plays per hit. */
const CANTRIP_FX = {
  /* Fire Bolt (Wizard) — roaring orange flame particle orb */
  wizard:   { url:'fx/spells/11_fire_spritesheet.png',      cols:8,  rows:8,  frames:61, fps:30, dur:1.0,  scale:2.5, color:0xff7a30, projSheet: 'stylized_explosion_001_large_yellow' },
  /* Fire Bolt (Sorcerer) — wild spinning fire ring */
  sorcerer: { url:'fx/spells/7_firespin_spritesheet.png',   cols:8,  rows:8,  frames:61, fps:34, dur:1.0,  scale:2.7, color:0xffb02e, projSheet: 'epic_explosion_001_large_orange' },
  /* Sacred Flame (Cleric) — golden radiant sunburst */
  cleric:   { url:'fx/spells/16_sunburn_spritesheet.png',   cols:8,  rows:8,  frames:61, fps:30, dur:1.0, scale:2.7, color:0xffd34a, projSheet: 'round_light_burst_001_large_yellow' },
  /* Produce Flame (Druid) — bright natural flame */
  druid:    { url:'fx/spells/9_brightfire_spritesheet.png', cols:8,  rows:8,  frames:61, fps:30, dur:1.0,  scale:2.5, color:0xffe14a, projSheet: 'round_sparkle_burst_002_large_green' },
  /* Eldritch Blast (Warlock) — crackling green fel ring */
  warlock:  { url:'fx/spells/17_felspell_spritesheet.png',  cols:10, rows:10, frames:91, fps:40, dur:1.0, scale:2.0, color:0x86ff5a, projSheet: 'round_sparkle_burst_003_large_red' },
  /* Vicious Mockery (Bard) — glowing magenta musical note burst */
  bard:     { url:'fx/spells/2_magic8_spritesheet.png',    cols:8,  rows:8,  frames:61, fps:30, dur:1.0,  scale:2.2, color:0xe8a8ff, projSheet: 'directional_music_burst_002_large_yellow' },
  /* Ray of Frost (Artificer) — frost ice burst */
  artificer:{ url:'fx/spells/19_freezing_spritesheet.png', cols:8,  rows:8,  frames:61, fps:30, dur:1.0,  scale:2.4, color:0x7fd4ff, projSheet: 'round_sparkle_burst_001_large_blue' },
};

import { SPELLS } from './spells.js';
import { applyEffect, clearEffect, hasEffect, getEffect, getEffectMods, tickEffects, clearAllEffects, rollSave, rollSaveDetail, EFFECTS, ROUND_SECONDS } from './conditions.js';

export const combatMethods = {
  /* ── FX bridge methods (called by spells.js cast() functions) ── */
  _v3(x, y, z) { return new THREE.Vector3(x, y, z); },
  fxSprite(path, pos, scale, dur) { spawnSpriteEffect(this.engine.scene, path, pos, scale, dur); },
  fxProjectile(from, to, kind, color, onHit, opts = {}) { spawnProjectile(this.engine.scene, from, to, kind, color, onHit, opts); },
  fxBeam(from, to, opts = {}) { spawnBeamEffect(this.engine.scene, from, to, opts); },
  fxSlash(pos, color, size) { spawnSlash(this.engine.scene, pos, color, size); },
  fxText(text, pos, color) { makeFloatText(this.engine.scene, text, pos, color); },
  fxLog(msg, style, opts) { log(msg, style, opts); },

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
    log(`   ↳ ${dealt}${type}${tag} to ${name}`, crit ? 'crit' : 'roll');
    return dealt;
  },

  spellSave(entity, ability, dc, opts = {}) {
    const r = rollSaveDetail(entity, ability, dc, opts);
    const name = entity.data?.name || 'foe';
    log(`   ↳ ${name} ${ability.toUpperCase()} save — ${r.saved ? 'success' : 'fail'}`,
        r.saved ? 'miss' : 'roll', { detail: `(${r.total} vs DC ${dc})` });
    return r.saved;
  },
  /* Effects expire on the combat clock (fxNow), never the wall clock — see
     the time-base note in conditions.js. */
  tickEffectsOn(e) { tickEffects(e, this.fxNow); },

  /** Refresh ability icons on party frames after a cast/spend. */
  refreshAbilityHud() {
    updatePartyFrames(this.heroes.map(x => x.data));
  },

  /**
   * Play cast animation + world VFX for a class feature / spell.
   * @param {object} h hero entity
   * @param {string} key ABILITY_FX key
   * @param {object} [opts] { at: entity|{x,z}, alsoAt: entity[], noAnim, scale, dur, floatY }
   */
  playAbilityFx(h, key, opts = {}) {
    playSfx(spellSfx(key), { volume: 0.65 });
    const fx = ABILITY_FX[key] || { sprite: 'dcss/effect/magic_bolt_1.png', color: 0xc0a060, label: null, float: '#e8c25a' };
    const at = opts.at || h;
    const x = at.x, z = at.z;
    const y = opts.floatY != null ? opts.floatY : 1.35;
    const scale = opts.scale || 2.0;
    const dur = opts.dur || 0.45;

    const sheetDef = fx.sheetDef || (fx.sheetKey ? GIGAPACK_REGISTRY[fx.sheetKey] : null);
    if (sheetDef) {
      spawnSheetEffect(this.engine.scene, sheetDef, new THREE.Vector3(x, 0.55, z), scale, dur);
    }
    if (fx.sprite) {
      const spriteDef = fx.frames ? { sprite: fx.sprite, frames: fx.frames, frameInterval: fx.frameInterval } : fx.sprite;
      spawnSpriteEffect(this.engine.scene, spriteDef, new THREE.Vector3(x, 0.55, z), scale, dur);
    }
    if (fx.color != null) {
      spawnSlash(this.engine.scene, { x, z }, fx.color, opts.ring || 1.2);
    }
    if (fx.label) {
      makeFloatText(this.engine.scene, fx.label, _v.set(x, y, z), fx.float || '#e8c25a');
    }
    if (opts.alsoAt) {
      for (const t of opts.alsoAt) {
        if (!t || t === at) continue;
        if (sheetDef) {
          spawnSheetEffect(this.engine.scene, sheetDef, new THREE.Vector3(t.x, 0.45, t.z), scale * 0.85, dur * 0.9);
        }
        if (fx.sprite) {
          const spriteDef2 = fx.frames ? { sprite: fx.sprite, frames: fx.frames, frameInterval: fx.frameInterval } : fx.sprite;
          spawnSpriteEffect(this.engine.scene, spriteDef2, new THREE.Vector3(t.x, 0.45, t.z), scale * 0.85, dur * 0.9);
        }
        spawnSlash(this.engine.scene, { x: t.x, z: t.z }, fx.color || 0xc0a060, 0.9);
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

  /**
   * Threat assessment: is this foe worth spending limited resources on?
   * @param {'normal'|'high'|'low'} threshold  high = boss/elite only; low = almost always
   */
  _worthSpending(h, foe, alive, threshold = 'normal') {
    /* abilityUse: per-hero "how willingly do I spend limited resources" knob.
       0 = never spend (pure basic attacks); 0.5 = original tuning; 1 = liberal. */
    const w = h.data.aiPrefs && h.data.aiPrefs.abilityUse != null ? h.data.aiPrefs.abilityUse : 0.5;
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
      h.aiFoe = this.pickHeroTarget(h, alive);
      h._canRetarget = false;
      /* ±15% jitter on the interval so the party doesn't all think in lockstep */
      h.thinkT = HERO_THINK_INTERVAL * (0.85 + Math.random() * 0.3);
    }
    return h.aiFoe;
  },

  pickHeroTarget(h, alive) {
    /* behaviorMode (AI Priorities tab) replaced the old low-CR ↔ high-CR
       targetPref slider with two explicit stances:
         aggressive — chase the kill. Score by how close a foe is to dying (HP
                      percentage), so the party focus-fires and finishes wounded
                      enemies instead of spreading damage around.
         defensive  — protect the squishies. Score foes by the danger they pose
                      to fragile allies: whoever is targeting or standing on the
                      backline gets hit first.
       Both stances keep a small distance tiebreak so heroes fight what's in
       front of them rather than sprinting across the room. */
    const mode = (h.data.aiPrefs && h.data.aiPrefs.behaviorMode) || 'aggressive';
    const cands = [];
    for (const m of this.monsters) {
      if (m.data.hp <= 0 || !m.active) continue;
      const dd = Math.hypot(m.x - h.x, m.z - h.z);
      if (this.initiative && this.initiative.active || dd < 13) cands.push({ m, dd });
    }
    if (!cands.length) return null;
    if (cands.length === 1) return cands[0].m;

    const SQUISHY = ['wizard', 'sorcerer', 'warlock', 'bard', 'cleric', 'druid', 'rogue'];
    const isSquishy = a => a && a.data && SQUISHY.includes(a.data.classKey);
    const isRangedCaster = ['wizard', 'sorcerer', 'warlock', 'ranger'].includes(h.data.classKey);

    let best = null, bestScore = -1e9;
    for (const c of cands) {
      const m = c.m;
      const hpFrac = m.data.hp / Math.max(m.data.maxHp, 1);
      let det = 0;

      if (mode === 'defensive') {
        /* Who is this monster threatening? A foe locked onto a fragile ally is
           the whole point of the stance; one merely standing next to one is
           the next best thing. */
        const victim = (m._tgtIdx != null) ? this.heroes[m._tgtIdx] : null;
        if (victim && victim !== h && victim.data.hp > 0 && isSquishy(victim)) det += 1.0;
        for (const a of alive) {
          if (a === h || !isSquishy(a)) continue;
          if (Math.hypot(m.x - a.x, m.z - a.z) < 2.0) { det += 0.6; break; }
        }
        /* A foe already on this hero still has to be answered. */
        if (victim === h) det += 0.35;
        /* All else equal, put down the one closest to dying so the threat
           count actually drops. */
        det += (1 - hpFrac) * 0.3;
      } else {
        /* Aggressive: lowest HP percentage first, hard focus on the finish. */
        det += (1 - hpFrac) * 1.2;
        if (hpFrac < 0.15) det += 0.4;                       // execute range
        if (isRangedCaster && (m.isBoss || (m.data.tags && m.data.tags.includes('caster')))) det += 0.25;
      }

      /* Light noise so a whole party doesn't lock onto one foe in lockstep. */
      const noise = (Math.random() - 0.5) * 0.15;
      const score = det + noise - c.dd * 0.02;
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
    let anchor = null, best = 1e9;
    for (const m of this.monsters) {
      if (m.data.hp <= 0 || !m.active) continue;
      const dd = Math.hypot(m.x - h.x, m.z - h.z);
      if (dd < best) { best = dd; anchor = m; }
    }
    if (!anchor) {
      anchor = this.partyLeader(alive);
      if (h === anchor || Math.hypot(h.x - anchor.x, h.z - anchor.z) < 1.2) { h.moving = false; return; }
    }
    const goal = this.nearFloorCell(this.cellOf(anchor.x, anchor.z), 2);
    if (goal < 0) { h.moving = false; return; }
    h.repathT -= dt;
    if (h.repathT <= 0 || !h.path || h.pathI >= h.path.length || h.pathGoal !== goal) {
      h.path = this.findPath(this.cellOf(h.x, h.z), goal);
      h.pathI = 0; h.repathT = 0.6; h.pathGoal = goal;
    }
    h.moving = this.moveStep(h, HERO_SPEED * 1.05 * h.data.speedMult * this.hasteMult(h), dt);
    if (!h.moving && this.canMove(h)) {
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
  heroTacticalAction(h, foe, alive, dist, atk, dt) {
    if (this.controlMode === 'manual') return false;
    if (!this.initiative || !this.initiative.active || !this.isCurrentActor(h)) return false;
    if (h.actUsed) return false;
    if (getEffectMods(h).incapacitated) return false;

    const isReach = !!(atk.reach || (atk.range && atk.range >= 2.2));
    const reach = atk.melee ? (isReach ? 2.5 : Math.max(1.4, atk.range || 1.4)) : atk.range;
    const inRange = dist <= reach && (atk.melee || this.hasLOS(h.x, h.z, foe.x, foe.z));
    if (inRange) return false;

    const speedCells = this.cellsForSpeed(h);
    const hasFullMove = (h.moveLeft == null || h.moveLeft >= speedCells * 0.85) && (!h.path || h.pathI >= h.path.length);

    /* A) DISENGAGE CHECK: ONLY at turn start if hero started turn trapped in melee threat
       AND is severely bloodied (<35% HP) or a squishy ranged caster.
       Healthy melee heroes will NEVER Disengage! */
    const threatDist = Math.hypot(foe.x - h.x, foe.z - h.z);
    if (hasFullMove && threatDist <= 1.6 && !h.disengageActive) {
      const pinnedBy = this.monsters.filter(m => m.active && m.data.hp > 0 &&
        Math.hypot(m.x - h.x, m.z - h.z) <= 1.6).length;
      const bloodied = h.data.hp <= h.data.maxHp * 0.35;
      const squishyRanged = !atk.melee && pinnedBy > 0;
      if (pinnedBy > 0 && (bloodied || squishyRanged) && this.takeCommonAction(h, 'disengage')) {
        const threats = this.monsters.filter(m => m.active && m.data.hp > 0 && Math.hypot(m.x - h.x, m.z - h.z) <= 3.5);
        const fleePath = this.findFleePath(h, threats, h.moveLeft || speedCells);
        if (fleePath) {
          h.path = fleePath; h.pathI = 0; h.repathT = 0.6; h.stuckT = 0;
          h.moving = this.moveStep(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt || 0.016);
        } else {
          h.moving = false;
        }
        return true;
      }
    }

    /* B) DASH CHECK: ONLY at turn start when target is beyond normal move + reach.
       If target IS reachable within normal movement, Dash is strictly forbidden! */
    const needsDash = hasFullMove && dist > (reach + speedCells);

    if (needsDash) {
      const route = this.findPath(this.cellOf(h.x, h.z), this.cellOf(foe.x, foe.z));
      if (route && this.takeCommonAction(h, 'dash')) {
        h.path = route; h.pathI = 0; h.repathT = 0.6; h.stuckT = 0;
        h.moving = this.moveStep(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt || 0.016);
        return true;
      }
    }

    /* C) DODGE CHECK: out of movement budget and no route available */
    if ((h.moveLeft || 0) <= 0 && (!h.path || h.pathI >= h.path.length) && this.takeCommonAction(h, 'dodge')) {
      h.moving = false;
      h.path = null; h.pathI = 0; h.stuckT = 0;
      return true;
    }
    return false;
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
    const dist = Math.hypot(foe.x - h.x, foe.z - h.z);
    /* Per-hero AI priority knobs (see menus.js AI Priorities tab). */
    const ai = h.data.aiPrefs || {};
    const abilityUse = ai.abilityUse != null ? ai.abilityUse : 0.5;
    const cm = ai.combatMovement != null ? ai.combatMovement : 0.5;
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
    if (getEffectMods(h).incapacitated) { h.moving = false; return; }

    /* If hero is actively executing a tactical flee / dash path, continue stepping */
    if (h.path && h.pathI < h.path.length && (h.moveLeft || 0) > 0) {
      h.moving = this.moveStep(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt);
      if (h.moving) return;
    }

    /* Defensive/buff reflexes are "abilities" — skip entirely at 0% ability-use. */
    if (abilityUse > 0) this.runCombatReflexes(h, alive, foe);

    /* Dash / Dodge / Disengage — the same tactical fallbacks the monsters use. */
    if (this.heroTacticalAction(h, foe, alive, dist, atk, dt)) return;

    const isReach = !!(atk.reach || (atk.range && atk.range >= 2.2));
    const attackRange = atk.melee ? (isReach ? 2.5 : Math.max(1.4, atk.range || 1.4)) : atk.range;
    const inRange = dist <= attackRange && (atk.melee || this.hasLOS(h.x, h.z, foe.x, foe.z));
    if (!inRange) {
      /* combatMovement: low values make the hero hold position instead of chasing
         across the room. chaseRange runs from just beyond melee reach (cm=0) up to
         the full 13-unit engagement range (cm=1). */
      const baseReach = attackRange + 1.5;
      const chaseRange = baseReach + (13 - baseReach) * cm;
      if (!this.initiative?.active && dist > chaseRange) {
        h.combatFoe = null;
        h.moving = false;
        h.stuckT = 0; h.stuckStage = 0;
        h.ent.grp.rotation.y = Math.atan2(foe.x - h.x, foe.z - h.z);
        return;
      }
      h.combatFoe = null;
      h.repathT -= dt;
      if (h.repathT <= 0 || !h.path || h.pathI >= h.path.length) {
        h.path = this.findPath(this.cellOf(h.x, h.z), this.cellOf(foe.x, foe.z));
        h.pathI = 0; h.repathT = 0.5;
      }
      h.moving = this.moveStep(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt);

      if (!h.moving && h !== this.partyLeader(alive) && this.canMove(h)) {
        this.handleStuck(h, this.partyLeader(alive), dt);
      } else {
        h.stuckT = 0; h.stuckStage = 0;
      }
      return;
    } else {
      h.stuckT = 0; h.stuckStage = 0;
    }

    /* In-range tactical repositioning: combatMove smoothly orbits and shuffles at weapon reach */
    if (cm > 0.12) {
      this.combatMove(h, foe, atk, dt);
    } else {
      h.combatFoe = foe;
      h.moving = false;
    }
    h.ent.grp.rotation.y = Math.atan2(foe.x - h.x, foe.z - h.z);
    if (h.actUsed) return;

    /* AI potion: if this hero's HP is below their potionThreshold, drink from the
       shared stash. Costs the turn just like an attack. potionThreshold=0 => never. */
    {
      const pt = ai.potionThreshold != null ? ai.potionThreshold : 0.5;
      if (pt > 0 && h.data.hp > 0 && h.data.hp / h.data.maxHp < pt) {
        const kind = this.potions.heal > 0 ? 'heal'
          : (this.potions.greater > 0 ? 'greater'
          : (this.potions.superior > 0 ? 'superior' : null));
        if (kind) {
          this.potions[kind]--;
          const amt = kind === 'superior' ? roll(8, 4, 8) : kind === 'greater' ? roll(4, 4, 4) : roll(2, 4, 2);
          h.data.hp = Math.min(h.data.maxHp, h.data.hp + amt);
          makeFloatText(this.engine.scene, '+' + amt, _v.set(h.x, 1.3, h.z), '#6ae0ff');
          log(`🧪 ${h.data.name} drinks a potion (+${amt}).`, 'heal');
          drawBar(h.ent.bar, h.data.hp / h.data.maxHp);
          updatePartyFrames(this.heroes.map(x => x.data));
          updateResources(this);
          h.actUsed = true;
          return;
        }
      }
    }

    /* heal threshold scales with abilityUse: 0.5 ≈ original (0.45), liberal tops off
       sooner, conservative waits. Blocked entirely at abilityUse=0. */
    const healThresh = 0.2 + 0.5 * abilityUse;

    /* healers: heal a badly-hurt ally (or revive a downed one) instead of attacking */
    if (abilityUse > 0 && cls.healer && h.data.healSlots > 0) {
      let worst = null, wf = healThresh;
      for (const a of this.heroes) {
        const f = Math.max(0, a.data.hp / a.data.maxHp);
        if (f < wf) { wf = f; worst = a; }
      }
      if (worst) {
        h.actUsed = true;
        h.data.healSlots--;
        const ab = cls.attack.ability === 'cha' ? 'cha' : 'wis';
        const amt = roll(1, 8, mod(h.data.effStats[ab]) + h.data.healBonus);
        this.healHero(worst, amt);
        this.playAbilityFx(h, 'cureWounds', { at: worst, spell: true });
        log(`${h.data.name} casts Cure Wounds on ${worst.data.name} (+${amt}).`, 'heal');
        this.refreshAbilityHud();
        return;
      }
    }

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
        this.playAbilityFx(h, 'layOnHands', { at: worst, spell: true });
        log(`🙏 ${h.data.name} uses Lay on Hands on ${worst.data.name} (+${spend}).`, 'heal');
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
        if (this.tryCastKnownSpell(h, foe, alive)) return;
        if (sc && this.castSubclassSpell(h, sc, foe, alive)) return;
      }
    }

    const opts = this.buildAttackOpts(h, foe, sc);
    opts.profile = atk;
    this.heroAttackRoll(h, foe, alive, opts);

    /* Extra Attack / Improved Extra Attack */
    let attacks = 1;
    if (hasFeature(h.data, 'extraAttack2')) attacks = 3;
    else if (hasFeature(h.data, 'extraAttack')) attacks = 2;
    for (let i = 1; i < attacks && foe.data.hp > 0; i++) {
      this.heroAttackRoll(h, foe, alive, { profile: atk });
    }

    /* Feat-granted bonus strikes (Polearm Master butt-end, Crossbow Expert). */
    if (atk.source === 'weapon') {
      const feExtra = featExtraAttacks(h.data);
      for (let i = 0; i < feExtra && foe.data.hp > 0; i++) {
        this.heroAttackRoll(h, foe, alive, { profile: atk });
      }
    }

    /* Two-Weapon Fighting (5e): when dual-wielding two light weapons, the
       off hand lands one bonus-action attack this turn. No ability mod to its
       damage (the noAbilityMod flag is set on the offhand profile). Only fires
       when the main attack this turn was a weapon swing, not a cantrip — and
       only if the hero hasn't already spent its bonus action (e.g. on Healing
       Word or another bonus-action ability). Claims the bonus action. */
    if (atk.source === 'weapon' && h.data.offhandProfile && foe.data.hp > 0 && !h._bonusActed) {
      this.heroAttackRoll(h, foe, alive, { profile: h.data.offhandProfile });
      h._bonusActed = true;
    }

    /* Action Surge (class feature or Champion subclass) — only when it matters */
    const surgeWorthy = foe.data.hp / Math.max(foe.data.maxHp, 1) > 0.30 || foe.isBoss || this.monsterEliteRoom(foe);
    const canSurge = abilityUse > 0
      && (hasFeature(h.data, 'actionSurgeClass') || (sc && sc.active.key === 'actionSurge'))
      && !h.data.abilityUsed.short && foe.data.hp > 0 && surgeWorthy && !h._abilityUsedThisCycle;
    if (canSurge) {
      h.data.abilityUsed.short = true; h._abilityUsedThisCycle = true;
      this.playAbilityFx(h, 'actionSurge', { at: h });
      log(`⚔ ${h.data.name} surges with action — attacking again!`, 'crit');
      this.heroAttackRoll(h, foe, alive, { profile: atk });
      this.refreshAbilityHud();
    }

    /* Flurry of Blows (bonus action) — only when foe is worth the effort */
    else if (abilityUse > 0 && hasFeature(h.data, 'flurryOfBlows') && !h.data.abilityUsed.short && foe.data.hp > 0
        && h.data.hp < h.data.maxHp * 0.7 && surgeWorthy && !h._abilityUsedThisCycle && !h._bonusActed) {
      h.data.abilityUsed.short = true; h._abilityUsedThisCycle = true; h._bonusActed = true;
      this.playAbilityFx(h, 'flurry', { at: foe });
      log(`👊 ${h.data.name} uses Flurry of Blows!`, 'crit');
      this.heroAttackRoll(h, foe, alive, { profile: atk });
      this.refreshAbilityHud();
    }

    /* Berserker frenzy (bonus-action attack) — don't waste on near-dead foes */
    else if (abilityUse > 0 && sc && sc.active.key === 'frenzy' && !h.data.abilityUsed.short && foe.data.hp > 0
        && h.raging && foe.data.hp / Math.max(foe.data.maxHp, 1) > 0.35 && !h._abilityUsedThisCycle && !h._bonusActed) {
      h.data.abilityUsed.short = true; h._abilityUsedThisCycle = true; h._bonusActed = true;
      this.playAbilityFx(h, 'frenzy', { at: foe });
      log(`😤 ${h.data.name} frenzies — another strike!`, 'crit');
      this.heroAttackRoll(h, foe, alive, { profile: atk });
      this.refreshAbilityHud();
    }
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
      makeFloatText(this.engine.scene, '+' + amt, _v.set(h.x, 1.55, h.z), '#6ae06a');
      drawBar(h.ent.bar, d.hp / d.maxHp);
      log(`${d.name} catches a second wind (+${amt}).`, 'heal');
      hudDirty = true;
    }

    /* ── Cunning Action — dodge when bloodied ── */
    if (!h._abilityUsedThisCycle) {
      const cunning = hasFeature(d, 'cunningActionClass') || (sc && sc.active.key === 'cunningAction');
      if (cunning && !d.abilityUsed.short && d.hp < d.maxHp * 0.35 && !h._bonusActed) {
        d.abilityUsed.short = true; h._abilityUsedThisCycle = true; h._bonusActed = true;
        applyEffect(h, 'hasted', { duration: 30, elapsed: this.fxNow });
        this.playAbilityFx(h, 'cunningAction', { at: h });
        log(`💨 ${d.name} uses Cunning Action — darting clear! (+4 AC, +40% speed)`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Patient Defense (monk, bonus action) — take the Dodge when hard-pressed.
       Shares the once-per-short-rest `abilityUsed.short` flag with Flurry of Blows
       (the game's simplified ki model — a proper ki pool is a future enhancement),
       so a monk spends its bonus action + ki on either Flurry or Dodge per rest. */
    if (!h._abilityUsedThisCycle && !h._bonusActed) {
      if (hasFeature(d, 'flurryOfBlows') && !d.abilityUsed.short
          && d.hp < d.maxHp * 0.5 && this._combatStable(1.0)) {
        d.abilityUsed.short = true; h._abilityUsedThisCycle = true; h._bonusActed = true;
        applyEffect(h, 'patientDefense', { duration: ROUND_SECONDS, elapsed: this.fxNow });
        this.playAbilityFx(h, 'patientDefense', { at: h });
        log(`🛡 ${d.name} uses Patient Defense — dodging! (+5 AC)`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Fast Hands (Thief subclass active) — smoke bomb blinding nearby foes ── */
    if (!h._abilityUsedThisCycle) {
      if (sc && sc.active.key === 'fastHands' && !d.abilityUsed.short && !h._bonusActed
          && this.monsters.some(m => m.data.hp > 0 && Math.hypot(m.x - h.x, m.z - h.z) < 4.0)) {
        d.abilityUsed.short = true; h._abilityUsedThisCycle = true; h._bonusActed = true;
        this.playAbilityFx(h, 'fastHands', { at: h });
        log(`💨 ${d.name} uses Fast Hands to throw a smoke bomb!`, 'heal');
        for (const m of this.monsters) {
          if (m.data.hp > 0 && Math.hypot(m.x - h.x, m.z - h.z) < 4.0) {
            applyEffect(m, 'blinded', { duration: 6, elapsed: this.fxNow, source: h });
            makeFloatText(this.engine.scene, 'BLINDED', _v.set(m.x, 1.3, m.z), '#888899');
          }
        }
        hudDirty = true;
      }
    }

    /* ── Remarkable Athlete (Champion subclass active) ── */
    if (!h._abilityUsedThisCycle) {
      if (sc && sc.active.key === 'remarkableAthlete' && !d.abilityUsed.short
          && this._combatStable(1.5)) {
        d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
        applyEffect(h, 'remarkableAthlete', { duration: 30, elapsed: this.fxNow });
        this.playAbilityFx(h, 'remarkableAthlete', { at: h });
        log(`🏃 ${d.name} uses Remarkable Athlete — physical peak reached! (+2 AC, +10% speed)`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Rage — only after combat has been going a bit ── */
    if (!h._abilityUsedThisCycle) {
      if (hasFeature(d, 'rage') && !d.rageUsed && d.hp < d.maxHp * 0.45
          && this._combatStable(1.2) && !h._bonusActed) {
        d.rageUsed = true; h._abilityUsedThisCycle = true; h._bonusActed = true;
        applyEffect(h, 'raging', { duration: 30, elapsed: this.fxNow });
        this.playAbilityFx(h, 'rage', { at: h, scale: 1.7 });
        log(`😡 ${d.name} enters a Rage!`, 'crit');
        hudDirty = true;
      }
    }

    /* ── Bear Totem — emergency DR for bear barbarians ── */
    if (!h._abilityUsedThisCycle) {
      if (sc && sc.active.key === 'bearTotem' && !d.abilityUsed.short && d.hp < d.maxHp * 0.35) {
        d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
        applyEffect(h, 'bearTotem', { duration: 30, elapsed: this.fxNow });
        this.playAbilityFx(h, 'bearTotem', { at: h, scale: 1.6 });
        log(`🐻 ${d.name} summons the Bear Totem — damage halved!`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Bardic Inspiration — don't inspire in the first 2s, wait for real trouble ── */
    if (!h._abilityUsedThisCycle) {
      if (hasFeature(d, 'bardicInspiration') && !d.abilityUsed.short && alive.length >= 2
          && this._combatStable(2.0) && !h._bonusActed) {
        const anyHurt = alive.some(a => a.data.hp < a.data.maxHp * 0.6);
        if (anyHurt) {
          d.abilityUsed.short = true; h._abilityUsedThisCycle = true; h._bonusActed = true;
          for (const a of alive)
            applyEffect(a, 'inspired', { duration: 30, elapsed: this.fxNow });
          this.playAbilityFx(h, 'bardic', { at: h, alsoAt: alive, spell: true });
          log(`🎵 ${d.name} inspires the party! (+1d4 to hit)`, 'heal');
          hudDirty = true;
        }
      }
    }

    /* ── Wild Shape — druid panic button ── */
    if (!h._abilityUsedThisCycle) {
      if (hasFeature(d, 'wildShapeClass') && !d.abilityUsed.short && d.hp < d.maxHp * 0.4) {
        d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
        applyEffect(h, 'wildShape', { duration: 30, elapsed: this.fxNow });
        h.data.tempHp = (h.data.tempHp || 0) + 15 + d.level;
        this.playAbilityFx(h, 'wildShape', { at: h, scale: 1.8 });
        log(`🐻 ${d.name} Wild Shapes! (+temp HP, fierce claws)`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Combat Inspiration (Valor bard) — requires combat to be underway ── */
    if (!h._abilityUsedThisCycle) {
      if (sc && sc.active.key === 'combatInspiration' && !d.abilityUsed.short
          && this._combatStable(2.5) && alive.length >= 2) {
        const anyHurt = alive.some(a => a.data.hp < a.data.maxHp * 0.65);
        if (anyHurt) {
          d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
          for (const a of alive)
            applyEffect(a, 'inspired', { duration: 30, elapsed: this.fxNow });
          this.playAbilityFx(h, 'combatSong', { at: h, alsoAt: alive, spell: true });
          log(`🎶 ${d.name} plays a battle song! (+1d4 to hit)`, 'heal');
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
    if (sc && !d.abilityUsed.short) {
      if (sc.active.key === 'deathstrike' && foe.data.hp >= foe.data.maxHp
          && this._worthSpending(h, foe, null, 'normal')) {
        d.abilityUsed.short = true; opts.autoCrit = true;
        this.playAbilityFx(h, 'deathstrike', { at: foe });
        log(`🗡 ${d.name} lines up an Assassinate!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'guidedStrike' && (foe.isBoss || this.monsterEliteRoom(foe))
          && this._worthSpending(h, foe, null, 'high')) {
        d.abilityUsed.short = true; opts.atkBonus = 10; opts.extraDmg = roll(2, 8);
        this.playAbilityFx(h, 'guidedStrike', { at: foe, spell: true });
        log(`⚡ ${d.name} calls a Guided Strike! (+10 to hit, +2d8)`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'vowOfEnmity' && (foe.isBoss || this.monsterEliteRoom(foe))
          && this._worthSpending(h, foe, null, 'high')) {
        d.abilityUsed.short = true; opts.adv = (opts.adv || 0) + 1;
        this.playAbilityFx(h, 'vowOfEnmity', { at: foe, spell: true });
        log(`⚔️ ${d.name} swears a Vow of Enmity! (advantage)`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'shadowStep' && stable
          && this._worthSpending(h, foe, null, 'low')) {
        d.abilityUsed.short = true; opts.atkBonus = 4; opts.extraDmg = roll(2, 6);
        this.playAbilityFx(h, 'shadowStep', { at: foe });
        log(`🌑 ${d.name} Shadow Steps behind the foe!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'sacredWeapon' && stable
          && this._worthSpending(h, foe, null, 'normal')) {
        d.abilityUsed.short = true;
        applyEffect(h, 'sacredWeapon', { duration: 30, elapsed: this.fxNow });
        this.playAbilityFx(h, 'sacredWeapon', { at: h, spell: true });
        log(`✨ ${d.name} blesses their weapon!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'colossusSlayer' && foe.data.hp < foe.data.maxHp
          && this._worthSpending(h, foe, null, 'low')) {
        d.abilityUsed.short = true; opts.extraDmg = roll(1, 8);
        this.playAbilityFx(h, 'colossusSlayer', { at: foe });
        log(`🏹 ${d.name}'s Colossus Slayer finds the wound!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'summonCompanion' && stable
          && this._worthSpending(h, foe, null, 'normal') && this.summons) {
        /* Beast Master: summon (or mid-fight revive) the wolf companion.
           If a wolf is already alive, the charge is left untouched — there is
           nothing to summon. A downed wolf is revived at full HP. */
        const wolf = this.summons.getActive('wolf', h);
        if (!wolf || wolf.data.hp <= 0) {
          d.abilityUsed.short = true;
          if (wolf) this.summons.revive('wolf', h, 1);
          else      this.summons.spawn(h, 'wolf');
          this.playAbilityFx(h, 'summonCompanion', { at: h });
          log(`🐺 ${d.name} calls forth a wolf companion!`, 'crit');
          hudDirty = true;
        }
      } else if (sc.active.key === 'quiveringPalm' && (foe.isBoss || this.monsterEliteRoom(foe))
          && this._worthSpending(h, foe, null, 'high')) {
        d.abilityUsed.short = true; opts.extraDmg = roll(4, 10);
        this.playAbilityFx(h, 'quiveringPalm', { at: foe });
        log(`✋ ${d.name} delivers Quivering Palm!`, 'crit');
        hudDirty = true;
      }
    }
    if (hasFeature(d, 'divineSmite') && !d.smiteUsed
        && (foe.isBoss || this.monsterEliteRoom(foe))
        && this._worthSpending(h, foe, null, 'high')) {
      d.smiteUsed = true;
      opts.extraDmg = (opts.extraDmg || 0) + roll(2, 8);
      this.playAbilityFx(h, 'divineSmite', { at: foe, spell: true });
      log(`💫 ${d.name} Divine Smites!`, 'crit');
      hudDirty = true;
    }
    if (hasFeature(d, 'tidesOfChaos') && !d.tidesUsed && stable
        && this._worthSpending(h, foe, null, 'normal')) {
      d.tidesUsed = true;
      opts.adv = (opts.adv || 0) + 1;
      this.playAbilityFx(h, 'tidesOfChaos', { at: h, spell: true });
      log(`🌀 ${d.name} rides the Tides of Chaos! (advantage)`, 'crit');
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

  /* one d20 attack roll + resolution (extracted so Action Surge can repeat it) */
  heroAttackRoll(h, foe, alive, opts = {}) {
    const cls = CLASSES[h.data.classKey];
    /* Profile (weapon/cantrip/unarmed) is threaded in from heroCombat; falls
       back to the cached lastProfile if a caller omitted it. */
    const profile = opts.profile || h.data.lastProfile || h.data.weaponProfile || cls.attack;

    /* 5e advantage/disadvantage: sum sources, roll 2d20 take high/low */
    const selfMods = getEffectMods(h);
    const foeMods = getEffectMods(foe);
    let adv = opts.adv || 0;
    if (foeMods.defAdvantage) adv += 1;        // foe blinded / paralyzed / faerie-fired…
    if (selfMods.atkDisadvantage) adv -= 1;    // attacker poisoned / frightened / prone…
    let d20 = d20Roll(adv);
    if (d20 === 1 && RACES[h.data.raceKey].lucky) d20 = die(20);
    /* Compose the to-hit bonus from the profile's ability + cached proficiency/gear.
       Works for main-hand weapon, offhand weapon (TWF), cantrip, and unarmed. */
    const baseAtk = h.data.atkProf + mod(h.data.effStats[profile.ability]);
    let atkBonus = baseAtk + (opts.atkBonus || 0) + selfMods.atkBonus;
    if (selfMods.blessDice) atkBonus += die(4);   // Bless / inspiration: +1d4 to hit
    /* Boss intel (foreshadow phase): the party knows the final boss's weaknesses */
    const qIntel = this.activeQuest;
    const intel = !!(qIntel && qIntel.bossIntel && foe.isBoss
      && (this.questFloor | 0) >= (qIntel.floors | 0));
    if (intel) {
      atkBonus += 2;
      if (!this._intelLogged) {
        this._intelLogged = true;
        log('🔎 The party knows this foe — they strike where the old warnings said to strike.', 'story');
      }
    }
    let crit = !!opts.autoCrit || d20 >= h.data.critRange;
    let total = d20 + atkBonus;
    /* Foe AC reflects active effects (bossWeakened -2, faerieFire, etc.) */
    const foeAc = foe.data.ac + foeMods.acBonus;
    let miss = !crit && total < foeAc;
    /* paralyzed / unconscious foes: any melee hit is a critical (5e) */
    if (!miss && foeMods.autoCritMelee && profile.melee) crit = true;
    if (crit && this.engine) { this.engine.triggerHitStop(3); }

    /* Indomitable (long rest) / Lucky feat (short rest): convert a miss */
    if (miss && hasFeature(h.data, 'indomitable') && !h.data.abilityUsed?.long) {
      h.data.abilityUsed.long = true;
      miss = false;
      this.playAbilityFx(h, 'indomitable', { at: h });
      log(`🛡 ${h.data.name} is Indomitable — the miss becomes a hit!`, 'crit');
      this.refreshAbilityHud();
    } else if (miss && hasFeat(h.data, 'lucky') && !h.data.abilityUsed?.short) {
      h.data.abilityUsed.short = true;
      miss = false;
      this.playAbilityFx(h, 'lucky', { at: h });
      log(`🍀 ${h.data.name}'s Lucky feat turns a miss into a hit!`, 'crit');
      this.refreshAbilityHud();
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
    /* The roll math rides in opts.detail so the Options menu can collapse it
       down to just the outcome (see ui.log / settings.js). */
    const advTag = adv > 0 ? ', adv' : adv < 0 ? ', dis' : '';
    const vs = `(${d20}+${atkBonus} vs AC ${foeAc}${advTag})`;
    if (crit && !miss) log(`💥 ${h.data.name} crits ${foe.data.name}! — ${dmg} dmg${sneak ? ' +sneak' : ''}`, 'crit',
      { detail: opts.autoCrit ? '(Assassinate)' : `(nat ${d20})` });
    else if (miss) log(`${h.data.name} → ${foe.data.name}: miss`, 'miss', { detail: `${total} ${vs}` });
    else log(`${h.data.name} → ${foe.data.name}: hit, ${dmg} dmg${sneak ? ' +sneak' : ''}`, 'roll', { detail: `${total} ${vs}` });
    this.strike(h, foe, dmg, crit && !miss, miss, alive, profile);
  },

  /** Pre-hit damage multipliers/adders from equipped legendary perks.
   *  Magnitudes scale with the item's found ilvl (perkMag band). */
  applyPerkDamageMods(h, foe, dmg, crit) {
    let d = dmg;
    const perks = equippedPerks(h.data);
    for (const { perk, item } of perks) {
      if (perk.id === 'execute' && foe.data.maxHp > 0 && foe.data.hp / foe.data.maxHp < 0.30) {
        d = Math.round(d * perkMag('execute', item.ilvl));
        makeFloatText(this.engine.scene, 'EXECUTE', _v.set(foe.x, 1.4, foe.z), '#e8a83f');
      }
      if (perk.id === 'firstStrike' && !h._foughtThisCombat) {
        d = Math.round(d * perkMag('firstStrike', item.ilvl));
        makeFloatText(this.engine.scene, 'FIRST STRIKE', _v.set(foe.x, 1.5, foe.z), '#8fd4e8');
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
        makeFloatText(this.engine.scene, `+${heal}`, _v.set(h.x, 1.35, h.z), '#e07070');
        drawBar(h.ent.bar, h.data.hp / h.data.maxHp);
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
          makeFloatText(this.engine.scene, 'CLEAVE', _v.set(best.x, 1.3, best.z), '#e8a83f');
          spawnSlash(this.engine.scene, { x: best.x, z: best.z }, 0xe8a83f, best.data.scale * 0.8);
        }
      }

      if (id === 'burn') {
        const ticks = 3;
        const tickDmg = perkMag('burn', item.ilvl);
        foe.burn = { ticks, dmg: tickDmg, src: h, clock: this.fxNow };
        makeFloatText(this.engine.scene, 'BURN', _v.set(foe.x, 1.2, foe.z), '#ff7a30');
        spawnSpriteEffect(this.engine.scene, 'dcss/effect/flame_0.png',
          new THREE.Vector3(foe.x, 0.5, foe.z), 0.9, 0.25);
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
          makeFloatText(this.engine.scene, 'ARC', _v.set(best.x, 1.3, best.z), '#8fd4e8');
          spawnSpriteEffect(this.engine.scene, 'dcss/effect/magic_bolt_1.png',
            new THREE.Vector3(best.x, 0.5, best.z), 1.0, 0.25);
        }
      }

      if (id === 'manaFont' && Math.random() < perkMag('manaFont', item.ilvl)) {
        if (recoverSlots(h.data, 1) > 0) {
          makeFloatText(this.engine.scene, '+slot', _v.set(h.x, 1.5, h.z), '#b06cf0');
          log(`✦ ${h.data.name}'s ${item.name} restores a spell slot!`, 'heal');
          updatePartyFrames(this.heroes.map(x => x.data));
        }
      }

      if (id === 'critSurge' && crit) {
        spawnSpriteEffect(this.engine.scene, 'dcss/effect/flame_0.png',
          new THREE.Vector3(foe.x, 0.6, foe.z), 1.1, 0.3);
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
      makeFloatText(this.engine.scene, 'MANEUVER', _v.set(foe.x, 1.4, foe.z), '#e8c25a');
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
        makeFloatText(this.engine.scene, String(thornDmg), _v.set(attacker.x, 1.1, attacker.z), '#6aea6a');
        if (attacker.data.hp <= 0) this.killMonster(attacker, h);
      }
      if (perk.id === 'riposte' && (h.data.lastProfile || h.data.weaponProfile) && (h.data.lastProfile || h.data.weaponProfile).melee) {
        const ret = perkMag('riposte', item.ilvl);
        attacker.data.hp -= ret;
        makeFloatText(this.engine.scene, 'RIPOSTE', _v.set(attacker.x, 1.35, attacker.z), '#e8a83f');
        makeFloatText(this.engine.scene, String(ret), _v.set(attacker.x, 1.1, attacker.z), '#ffd34a');
        spawnSlash(this.engine.scene, { x: attacker.x, z: attacker.z }, 0xe8a83f, 0.7);
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
        makeFloatText(this.engine.scene, 'PHASE', _v.set(h.x, 1.4, h.z), '#8fd4e8');
        log(`◈ ${h.data.name}'s Phase Step grants +${ac} AC briefly.`, 'heal');
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
        makeFloatText(this.engine.scene, 'ARC', _v.set(best.x, 1.3, best.z), '#b06cf0');
      }
    } else if (sc.passiveKey === 'beguiling'             // Archfey: unnerve the foe
        && Math.random() < 0.15 && !hasEffect(foe, 'frightened')) {
      applyEffect(foe, 'frightened', { duration: ROUND_SECONDS, elapsed: this.fxNow, source: h });
      makeFloatText(this.engine.scene, 'FEAR', _v.set(foe.x, 1.3, foe.z), '#c07de8');
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
      makeFloatText(this.engine.scene, `FURY x${h._bloodlust}`, _v.set(h.x, 1.5, h.z), '#ff6030');
    } else if (sc.passiveKey === 'darkBlessing') {       // Fiend: temp HP on kill
      const t = Math.max(1, d.level);
      h.data.tempHp = Math.max(h.data.tempHp || 0, t);
      makeFloatText(this.engine.scene, `+${t} ward`, _v.set(h.x, 1.4, h.z), '#b06cf0');
    } else if (sc.passiveKey === 'bestialBond') {        // Beast Master: companion mends
      this.healHero(h, roll(1, 6));
    } else if (sc.passiveKey === 'naturalRecovery' && Math.random() < 0.20) { // Land: slot back
      if (recoverSlots(d, 1) > 0) {
        makeFloatText(this.engine.scene, '+slot', _v.set(h.x, 1.5, h.z), '#6ae06a');
        updatePartyFrames(this.heroes.map(x => x.data));
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
    const sc = subclassOf(h.data);
    if (!sc || !sc.passiveKey) return;
    const d = h.data;
    if (sc.passiveKey === 'arcaneWard') {
      const t = d.level + Math.max(0, mod(d.effStats.int));
      h.data.tempHp = Math.max(h.data.tempHp || 0, t);
      makeFloatText(this.engine.scene, `+${t} ward`, _v.set(h.x, 1.4, h.z), '#8fd4e8');
    } else if (sc.passiveKey === 'thickHide') {
      const t = d.level;
      h.data.tempHp = Math.max(h.data.tempHp || 0, t);
      makeFloatText(this.engine.scene, `+${t} hide`, _v.set(h.x, 1.4, h.z), '#2ecc71');
    } else if (sc.passiveKey === 'discipleOfLife') {
      const t = Math.ceil(d.level / 2);
      for (const a of (alive || this.heroes)) {
        if (a.data.hp <= 0) continue;
        a.data.tempHp = Math.max(a.data.tempHp || 0, t);
      }
      makeFloatText(this.engine.scene, 'BLESSING', _v.set(h.x, 1.5, h.z), '#5a8fe8');
    } else if (sc.passiveKey === 'tidesOfChaosPassive') {
      if (Math.random() < 0.5) {
        const t = d.level;
        h.data.tempHp = Math.max(h.data.tempHp || 0, t);
        makeFloatText(this.engine.scene, 'SURGE +HP', _v.set(h.x, 1.5, h.z), '#e67e22');
      } else {
        applyEffect(h, 'hasted', { duration: 6, elapsed: this.fxNow });
        makeFloatText(this.engine.scene, 'SURGE HASTE', _v.set(h.x, 1.5, h.z), '#e67e22');
      }
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
      makeFloatText(this.engine.scene, `+${best}`, _v.set(h.x, 1.4, h.z), '#ffd36a');
    }
    log(`📣 Inspiring words rally the party — +${best} temporary HP!`, 'heal');
  },

  /* ── Concentration (5e): one concentration spell per caster ────────
     Casting a new concentration spell ends the old one; taking damage
     forces a CON save (DC = max(10, half the damage)); going down ends it. */

  /**
   * Spawns a persistent Area of Effect (AoE) zone.
   */
  spawnAoEZone(caster, spellKey, x, z, radius, options = {}) {
    const color = options.color || 0xffffff;
    const dur = options.dur || null;
    const visual = spawnAoEVisual(this.engine.scene, { x, z }, color, radius, dur);

    const zone = {
      id: 'z' + Math.floor(Math.random() * 100000),
      caster,
      spellKey,
      x,
      z,
      radius,
      visual,
      dur,
      elapsed: 0,
      options,
      affectedTargets: new Set()
    };

    this.activeAoEZones.push(zone);
    return zone;
  },

  /**
   * Removes a persistent AoE zone.
   */
  removeAoEZone(zone) {
    if (!zone) return;
    const idx = this.activeAoEZones.indexOf(zone);
    if (idx >= 0) {
      this.activeAoEZones.splice(idx, 1);
    }
    if (zone.visual) {
      removeAoEVisual(this.engine.scene, zone.visual);
    }
  },

  /**
   * Ticks active AoE zones, checking for target overlaps and applying effects/damage.
   */
  updateAoEZones(dt) {
    if (!this.activeAoEZones || !this.activeAoEZones.length) return;

    for (let i = this.activeAoEZones.length - 1; i >= 0; i--) {
      const zone = this.activeAoEZones[i];
      zone.elapsed += dt;

      // Caster dead/inactive -> remove zone
      if (zone.caster.data.hp <= 0 || !zone.caster.active) {
        this.removeAoEZone(zone);
        continue;
      }

      // Check ticks on intervals
      const TICK_INTERVAL = 1.0;
      zone.tickTimer = (zone.tickTimer || 0) - dt;

      // Sync position for moving auras (Spirit Guardians)
      let cx = zone.x;
      let cz = zone.z;
      if (zone.spellKey === 'spiritGuardians') {
        cx = zone.caster.x;
        cz = zone.caster.z;
        if (zone.visual && zone.visual.group) {
          zone.visual.group.position.set(cx, 0.33, cz);
        }
      }

      if (zone.tickTimer <= 0) {
        zone.tickTimer = TICK_INTERVAL;

        const targets = this.monsters.filter(m =>
          m.data.hp > 0 && m.active && Math.hypot(m.x - cx, m.z - cz) < zone.radius
        );

        if (targets.length > 0) {
          const dc = spellDC(zone.caster);

          for (const m of targets) {
            if (zone.spellKey === 'faerieFire') {
              if (!hasEffect(m, 'faerieFire')) {
                if (!this.spellSave(m, 'dex', dc, { magic: true })) {
                  applyEffect(m, 'faerieFire', { duration: 60, elapsed: this.fxNow, source: zone.caster });
                  log(`✨ ${m.data.name} is outlined in Faerie Fire!`, 'roll');
                }
              }
            } else if (zone.spellKey === 'web') {
              if (!hasEffect(m, 'restrained')) {
                if (!this.spellSave(m, 'dex', dc, { magic: true })) {
                  applyEffect(m, 'restrained', { duration: 60, elapsed: this.fxNow, source: zone.caster, repeatSave: { ability: 'str', dc, every: 6 } });
                  log(`🕸 ${m.data.name} is restrained by Web!`, 'roll');
                }
              }
            } else if (zone.spellKey === 'entangle') {
              if (!hasEffect(m, 'restrained')) {
                if (!this.spellSave(m, 'str', dc, { magic: true })) {
                  applyEffect(m, 'restrained', { duration: 60, elapsed: this.fxNow, source: zone.caster, repeatSave: { ability: 'str', dc, every: 6 } });
                  log(`🌿 ${m.data.name} is restrained by vines!`, 'roll');
                }
              }
            } else if (zone.spellKey === 'grease') {
              if (!hasEffect(m, 'prone')) {
                if (!this.spellSave(m, 'dex', dc, { magic: true })) {
                  applyEffect(m, 'prone', { duration: 6, elapsed: this.fxNow, source: zone.caster });
                  log(`🛢 ${m.data.name} slips on Grease!`, 'roll');
                }
              }
            } else if (zone.spellKey === 'spiritGuardians') {
              let dmg = roll(3, 8, zone.caster.data.dmgBonus || 0);
              if (this.spellSave(m, 'wis', dc, { magic: true })) dmg = Math.floor(dmg / 2);
              this.spellDamage(m, dmg, zone.caster, false, { dmgType: 'radiant', magical: true });
            } else if (zone.spellKey === 'wallOfFire') {
              let dmg = roll(5, 8, zone.caster.data.dmgBonus || 0);
              if (this.spellSave(m, 'dex', dc, { magic: true })) dmg = Math.floor(dmg / 2);
              this.spellDamage(m, dmg, zone.caster, false, { dmgType: 'fire', magical: true });
            }
          }
        }
      }

      if (zone.dur != null && zone.elapsed >= zone.dur) {
        this.removeAoEZone(zone);
      }
    }
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
  },

  breakConcentration(h, reason) {
    if (!h.conc) return;
    const label = SPELLS[h.conc.key]?.label || h.conc.key;
    for (const t of h.conc.targets) {
      if (t && t.e) clearEffect(t.e, t.key);
    }
    if (h.conc.zone) {
      this.removeAoEZone(h.conc.zone);
    }
    h.conc = null;
    if (reason && h.data) log(`💫 ${h.data.name}'s concentration on ${label} ends (${reason}).`, 'miss');
  },

  /** Spend the lowest available slot of level ≥ spellLevel. */
  spendSlot(h, spellLevel = 1) {
    if (!spendSlotFor(h.data, spellLevel)) return false;
    this.refreshAbilityHud();
    return true;
  },

  canUseSpellRecharge(h, spell) {
    if (spell.recharge === 'slot') return hasSlotFor(h.data, spell.level || 1);
    if (spell.recharge === 'short') return !h.data.abilityUsed?.short;
    if (spell.recharge === 'long' || spell.recharge === 'day') return !h.data.abilityUsed?.long;
    return true;
  },

  markSpellUsed(h, spell) {
    if (spell.recharge === 'slot') this.spendSlot(h, spell.level || 1);
    else if (spell.recharge === 'short') {
      if (!h.data.abilityUsed) h.data.abilityUsed = {};
      h.data.abilityUsed.short = true;
      this.refreshAbilityHud();
    } else if (spell.recharge === 'long' || spell.recharge === 'day') {
      if (!h.data.abilityUsed) h.data.abilityUsed = {};
      h.data.abilityUsed.long = true;
      this.refreshAbilityHud();
    }
  },

  /* Score a spell candidate for the current situation. Higher score = better cast choice. */
  _scoreSpellForTarget(h, key, foe, alive) {
    const sp = SPELLS[key];
    if (!sp || !this.canUseSpellRecharge(h, sp)) return -1;

    /* already concentrating on this spell — don't waste a slot recasting it */
    if (sp.concentration && h.conc?.key === key) return -1;

    const d = h.data;
    const ai = sp.ai || { when: 'any', priority: 1 };
    const _w = h.data.aiPrefs && h.data.aiPrefs.abilityUse != null ? h.data.aiPrefs.abilityUse : 0.5;
    if (_w <= 0) return -1;

    // Check target immunity / avoided types
    if (ai.avoidTypes && foe && foe.data && ai.avoidTypes.includes(foe.data.type)) {
      return -1;
    }

    // Check redundant debuffs (don't recast debuff if foe already has condition)
    if (ai.debuffEffect && foe) {
      if (hasEffect(foe, ai.debuffEffect)) return -1;
    }

    let score = ai.priority || 1;

    // Add Spell Level weight when higher-level spell slots are available
    if ((sp.level || 0) > 0) {
      score += sp.level * 3.0;
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

    // ── AoE Cluster Spells ──
    else if (ai.when === 'cluster') {
      if (!foe) return -1;
      const r = ai.aoeRadius || 2.5;
      const count = this.monsters.filter(m => m.data.hp > 0 && m.active && Math.hypot(m.x - foe.x, m.z - foe.z) <= r).length;
      const minReq = ai.minTargets || 2;
      if (count < minReq) return -1;
      score += 10 + (count - 1) * 8; // Dynamic score scaling with target count
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

    // ── Overkill Guard ──
    // Don't dump 3rd/4th level damaging spells on foes that are 1 hit from dying
    if (foe && (sp.level || 0) >= 3 && foe.data.hp < 12 && foe.data.hp / Math.max(foe.data.maxHp, 1) < 0.25) {
      score -= 20;
    }

    return score;
  },

  /* Idle AI: pick the best known spell for this moment via dynamic contextual scoring. */
  _pickKnownSpell(h, foe, alive, filter) {
    const known = h.data.knownSpells || [];
    if (!known.length) return null;

    const w = h.data.aiPrefs && h.data.aiPrefs.abilityUse != null ? h.data.aiPrefs.abilityUse : 0.5;
    if (w <= 0) return null;

    let best = null, maxScore = -1;
    for (const key of known) {
      const sp = SPELLS[key];
      if (!sp || !filter(sp)) continue;
      const score = this._scoreSpellForTarget(h, key, foe, alive);
      if (score > maxScore) {
        maxScore = score;
        best = key;
      }
    }
    if (!best || maxScore <= 0) return null;

    const chosenSpell = SPELLS[best];
    const isLimited = (chosenSpell.level || 0) > 0 || chosenSpell.recharge === 'slot' || chosenSpell.recharge === 'short' || chosenSpell.recharge === 'long' || chosenSpell.recharge === 'day';

    if (isLimited) {
      const ai = chosenSpell.ai || {};
      const isEmergency = (ai.when === 'selfHurt' && h.data.hp / Math.max(h.data.maxHp, 1) < 0.3)
                       || (ai.when === 'hurtAlly' && (alive || []).some(a => a.data.hp / Math.max(a.data.maxHp, 1) < 0.35 || a.data.hp <= 0));
      if (!isEmergency) {
        const isHighThreat = foe && (foe.isBoss || this.monsterEliteRoom(foe));
        const chance = isHighThreat ? Math.min(1.0, w * 2.5) : w;
        if (Math.random() > chance) {
          return null; // Conserve spell slot for at-will cantrip / basic attack
        }
      }
    }

    return best;
  },

  /* Action-phase caster AI: leveled action-spells only (bonus-action spells are
     handled separately in tryCastBonusSpell, so they're excluded here). */
  tryCastKnownSpell(h, foe, alive) {
    const key = this._pickKnownSpell(h, foe, alive, sp => sp.bonusAction !== true);
    if (!key) return false;
    return this.resolveSpell(h, key, foe, alive);
  },

  /* Bonus-action phase: cast one bonus-action spell (Healing Word, Hex, Misty
     Step…) WITHOUT consuming the hero's action. Marks the bonus action used and,
     for a leveled spell, sets _bonusLeveled so the 5e "no second leveled spell
     this turn" rule can block a follow-up action-spell. Returns true if cast. */
  tryCastBonusSpell(h, foe, alive) {
    if (h._bonusActed) return false;
    const key = this._pickKnownSpell(h, foe, alive, sp => sp.bonusAction === true);
    if (!key) return false;
    const sp = SPELLS[key];
    if (!this.resolveSpell(h, key, foe, alive)) return false;
    h._bonusActed = true;
    if ((sp.level || 0) > 0) h._bonusLeveled = true;
    return true;
  },

  resolveSpell(h, key, foe, alive) {
    const sp = SPELLS[key];
    if (!sp || !this.canUseSpellRecharge(h, sp)) return false;
    if (sp.cast) return sp.cast(this, h, foe, alive);
    return false;
  },

  /* day- and slot-tier subclass actives; returns true if one consumed this turn */
  castSubclassSpell(h, sc, foe, alive) {
    const key = sc.active.key, d = h.data;
    if (key === 'rallyingCry' && !d.abilityUsed?.long) {
      const hurt = alive.filter(a => a.data.hp < a.data.maxHp * 0.5);
      if (hurt.length >= 2) {
        d.abilityUsed.long = true;
        this.playAbilityFx(h, 'rallyingCry', { at: h, alsoAt: alive });
        log(`📣 ${d.name} bellows a Rallying Cry!`, 'heal');
        for (const a of alive) this.healHero(a, roll(1, 10, d.level));
        this.refreshAbilityHud();
        return true;
      }
      return false;
    }
    if (key === 'preserveLife' && !d.abilityUsed?.long) {
      const hurt = alive.filter(a => a.data.hp < a.data.maxHp * 0.4);
      if (hurt.length >= 2) {
        d.abilityUsed.long = true;
        this.playAbilityFx(h, 'preserveLife', { at: h, alsoAt: alive, spell: true });
        log(`✨ ${d.name} channels divinity — Preserve Life!`, 'heal');
        for (const a of alive) this.healHero(a, d.level * 2 + mod(d.effStats.wis) + d.healBonus);
        this.refreshAbilityHud();
        return true;
      }
      return false;
    }
    if (key === 'fireball' && hasSlotFor(d, 3)) {
      const w = d.aiPrefs && d.aiPrefs.abilityUse != null ? d.aiPrefs.abilityUse : 0.5;
      if (w > 0 && Math.random() <= w && this._worthSpending(h, foe, alive, 'normal')) {
        return this.resolveSpell(h, 'fireball', foe, alive);
      }
      return false;
    }
    if (key === 'magicMissile' && hasSlotFor(d, 1)
        && (foe.isBoss || this.monsterEliteRoom(foe) || foe.data.hp >= 15)
        && this._worthSpending(h, foe, alive, 'normal')) {
      const w = d.aiPrefs && d.aiPrefs.abilityUse != null ? d.aiPrefs.abilityUse : 0.5;
      if (w > 0 && Math.random() <= w) {
        return this.resolveSpell(h, 'magicMissile', foe, alive);
      }
      return false;
    }
    if (key === 'dragonBreath' && !d.abilityUsed.short && this._combatStable(1.0)) {
      const foes = this.monsters.filter(m => m.data.hp > 0 && m.active && Math.hypot(m.x - h.x, m.z - h.z) < 3);
      if (foes.length >= 2) {
        d.abilityUsed.short = true;
        this.playAbilityFx(h, 'dragonBreath', { at: h, alsoAt: foes, scale: 2.2, ring: 2.2 });
        log(`🐉 ${d.name} breathes fire!`, 'crit');
        for (const m of foes) this.spellDamage(m, roll(3, 6, d.dmgBonus), h, false, { dmgType: 'fire', magical: true });
        this.refreshAbilityHud();
        return true;
      }
    }
    if (key === 'wildSurge' && !d.abilityUsed.short && this._combatStable(1.5)) {
      // Only surge when someone is actually hurt — don't waste the heal
      const anyHurt = alive.some(a => a.data.hp < a.data.maxHp * 0.8);
      if (anyHurt) {
        d.abilityUsed.short = true;
        this.playAbilityFx(h, 'wildSurge', { at: h, alsoAt: alive, spell: true });
        log(`🌈 ${d.name}'s Wild Magic heals the party!`, 'heal');
        for (const a of alive) this.healHero(a, roll(1, 10, d.level));
        this.refreshAbilityHud();
        return true;
      }
    }
    if (key === 'cuttingWords' && !d.abilityUsed.short && (foe.isBoss || this.monsterEliteRoom(foe))
        && this._worthSpending(h, foe, alive, 'high')) {
      d.abilityUsed.short = true;
      foe.cutWordsUntil = this.fxNow + ROUND_SECONDS;   // one round, on the combat clock
      foe.data._acPenalty = 4;
      this.playAbilityFx(h, 'cuttingWords', { at: foe, spell: true });
      log(`🎤 ${d.name} uses Cutting Words on ${foe.data.name}!`, 'crit');
      this.refreshAbilityHud();
      return true;
    }
    if (key === 'fiendishBlessing' && !d.abilityUsed.short
        && this._combatStable(1.8) && d.hp < d.maxHp * 0.8) {
      d.abilityUsed.short = true;
      h.data.tempHp = (h.data.tempHp || 0) + 10;
      this.playAbilityFx(h, 'fiendishBlessing', { at: h, spell: true });
      log(`😈 ${d.name} gains Fiendish Blessing (+10 temp HP)!`, 'heal');
      this.refreshAbilityHud();
      return true;
    }
    if (key === 'feyPresence' && !d.abilityUsed.short && this._combatStable(1.2)) {
      const foes = this.monsters.filter(m => m.data.hp > 0 && m.active && Math.hypot(m.x - h.x, m.z - h.z) < 3);
      if (foes.length) {
        d.abilityUsed.short = true;
        for (const m of foes) m.charmedUntil = this.elapsed + 3;
        this.playAbilityFx(h, 'feyPresence', { at: h, alsoAt: foes, spell: true });
        log(`🧚 ${d.name}'s Fey Presence charms nearby foes!`, 'heal');
        this.refreshAbilityHud();
        return true;
      }
    }
    if (key === 'wildShape' && !d.abilityUsed.short
        && d.hp < d.maxHp * 0.55) {
      d.abilityUsed.short = true;
      h.wildShapeUntil = this.elapsed + 8;
      h.data.tempHp = (h.data.tempHp || 0) + 20;
      this.playAbilityFx(h, 'wildShape', { at: h, scale: 1.9 });
      log(`🐻 ${d.name} Wild Shapes into a bear!`, 'heal');
      this.refreshAbilityHud();
      return true;
    }
    return false;
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
      log(`✨ ${a.data.name} is revived at ${a.data.hp} HP!`, 'heal');
      updatePartyFrames(this.heroes.map(x => x.data));
    }
    makeFloatText(this.engine.scene, '+' + gain, _v.set(a.x, 1.3, a.z), '#6ae06a');
    drawBar(a.ent.bar, a.data.hp / a.data.maxHp);
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

  /* dynamic in-combat positioning: hold a slot around the foe with a gentle
     orbital sway so heroes read as fighting, not standing still.
     Biases positions toward the room centre (open space) so fights don't
     drift into walls. In corridors uses the open-axis direction instead of
     a ring. */
  combatMove(h, foe, atk, dt) {
    if (h.combatFoe !== foe) {
      h.combatFoe = foe;
      const idx = this.heroes.indexOf(h);
      let centerAng = null;
      const fc = this.cellOf(foe.x, foe.z);
      const rid = fc >= 0 ? this.D.roomId[fc] : -1;
      if (rid >= 0) {
        const room = this.D.rooms[rid];
        const cx = this.wx(room.cx), cz = this.wz(room.cy);
        if (Math.hypot(cx - foe.x, cz - foe.z) > 0.8) {
          centerAng = Math.atan2(cz - foe.z, cx - foe.x);
        }
      }
      if (centerAng === null) {
        /* corridor fight — detect the open axis instead of a full ring.
           A cell is in a corridor if both cardinal neighbours in an axis
           are walls; the open axis is the perpendicular. */
        const { W, grid } = this.D;
        const cfx = fc % W, cfy = Math.floor(fc / W);
        const xBlocked = (cfx > 0 && grid[fc - 1] === WALL) && (cfx < W - 1 && grid[fc + 1] === WALL);
        const zBlocked = (cfy > 0 && grid[fc - W] === WALL) && (cfy < this.D.H - 1 && grid[fc + W] === WALL);
        if (xBlocked && !zBlocked) {
          centerAng = 0; /* Z-axis is open */
        } else if (zBlocked && !xBlocked) {
          centerAng = Math.PI / 2; /* X-axis is open */
        } else {
          const n = Math.max(1, this.heroes.length - 1);
          h.anchorAngle = idx * (Math.PI * 2 / this.heroes.length) + (Math.random() - 0.5) * 0.4;
        }
      }
      if (centerAng !== null) {
        const n = Math.max(1, this.heroes.length);
        h.anchorAngle = centerAng + ((idx - (n - 1) / 2) / Math.max(1, n)) * 1.5 + (Math.random() - 0.5) * 0.2;
      }
      h.swayPhase = Math.random() * 6.28;
      h.swayDir = Math.random() < 0.5 ? -1 : 1;
    }
    const isReach = !!(atk.reach || (atk.range && atk.range >= 2.2));
    let desiredR = atk.melee
      ? (isReach ? 2.15 : 1.35)
      : Math.max(2.8, Math.min(atk.range - 0.8, atk.range * 0.6));

    /* Vicinity Emergency Retreat / Positioning: wounded heroes (< 25% HP) and squishy casters step back slightly */
    if (h.data && (h.data.hp / Math.max(h.data.maxHp, 1) < 0.25 || (!atk.melee && ['wizard', 'sorcerer', 'warlock', 'ranger'].includes(h.data.classKey)))) {
      desiredR = Math.min(atk.range - 0.5, desiredR + 1.2);
    }
    const ang = h.anchorAngle + Math.sin(this.elapsed * 0.75 + h.swayPhase) * 0.4 * h.swayDir;
    const r = desiredR + Math.sin(this.elapsed * 1.15 + h.swayPhase) * 0.15;
    let tx = foe.x + Math.cos(ang) * r;
    let tz = foe.z + Math.sin(ang) * r;
    let moved = false;
    const isHeroClear = (x, z) => {
      for (const ally of this.heroes) {
        if (ally !== h && ally.data && ally.data.hp > 0 && Math.hypot(x - ally.x, z - ally.z) < 1.0) {
          return false;
        }
      }
      return true;
    };

    if (!this.blocked(tx, tz, 0.3) && isHeroClear(tx, tz)) {
      moved = true;
    } else {
      /* slot landed in a wall or on an ally — probe angle + radius variations inward toward open space */
      const probeRadii = [desiredR, desiredR * 0.85, desiredR * 1.15, desiredR * 0.7];
      const probeAngles = [0.4, -0.4, 0.8, -0.8, 1.2, -1.2];
      outer:
      for (const pr of probeRadii) {
        for (const dAng of probeAngles) {
          const ax = foe.x + Math.cos(ang + dAng) * pr;
          const az = foe.z + Math.sin(ang + dAng) * pr;
          if (!this.blocked(ax, az, 0.3) && isHeroClear(ax, az)) {
            tx = ax; tz = az; moved = true; break outer;
          }
        }
      }
      /* Fallback if no perfectly clear spot: pick any unblocked spot */
      if (!moved && !this.blocked(tx, tz, 0.3)) moved = true;
    }
    if (!moved) {
      /* last resort — nudge toward room centre or corridor open area */
      let fallbackX = foe.x, fallbackZ = foe.z;
      const fc = this.cellOf(foe.x, foe.z);
      const rid2 = fc >= 0 ? this.D.roomId[fc] : -1;
      if (rid2 >= 0) {
        const room = this.D.rooms[rid2];
        fallbackX = this.wx(room.cx); fallbackZ = this.wz(room.cy);
        const fd = Math.hypot(fallbackX - foe.x, fallbackZ - foe.z);
        if (fd < 0.5) { fallbackX = foe.x; fallbackZ = foe.z; }
      }
      if (!this.blocked(fallbackX, fallbackZ, 0.3)) { tx = fallbackX; tz = fallbackZ; moved = true; }
    }
    if (moved) {
      /* Tactical gate: only the current actor orbits, and the orbit draws
         from its movement budget (spendMove). Off-turn or budget-spent →
         hold. Boosted speed matches moveStep so the pace stays consistent. */
      const tactical = !!(this.initiative && this.initiative.active);
      if (tactical && (!this.isCurrentActor(h) || (h.moveLeft || 0) <= 0)) {
        h.moving = false;
      } else {
        const bx = h.x, bz = h.z;
        const spd = HERO_SPEED * COMBAT_SPEED * h.data.speedMult * this.hasteMult(h)
          * (tactical ? COMBAT_MOVE_BOOST : 1);
        h.moving = this.nudgeToward(h, tx, tz, spd, dt);
        if (h.moving && tactical) this.spendMove(h, Math.hypot(h.x - bx, h.z - bz));
      }
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
  absorbTempHp(h, dmg) {
    let d = dmg;
    if (h.data.tempHp > 0) {
      const absorb = Math.min(h.data.tempHp, d);
      h.data.tempHp -= absorb;
      d -= absorb;
    }
    return d;
  },

  /** Incoming damage after rage / totem / uncanny dodge / temp HP. */
  applyIncomingDamage(h, dmg) {
    let d = dmg;
    const mods = getEffectMods(h);
    d = Math.round(d * mods.dmgTakenMul);
    d = Math.round(d * this.subclassIncomingMul(h)); // subclass passive (e.g. Bear Spirit)
    if (hasFeature(h.data, 'uncannyDodge') && !h.uncannyUsed) {
      h.uncannyUsed = true;
      d = Math.ceil(d / 2);
    }
    /* Feat flat damage reduction (Heavy Armor Master). */
    d = featIncomingDamage(h.data, d);
    d = this.absorbTempHp(h, d);
    /* Death Ward: if hit would be lethal, survive at 1 HP instead */
    if (hasEffect(h, 'deathWarded') && d >= h.data.hp) {
      clearEffect(h, 'deathWarded');
      d = Math.max(0, h.data.hp - 1);
      log(`🛡 ${h.data.name}'s Death Ward triggers — survives at 1 HP!`, 'heal');
    }
    h.data.hp -= d;
    if (d > 0) h.data.dmgTaken = (h.data.dmgTaken || 0) + d;
    /* Charm breaks on damage (5e): taking damage grants a fresh save. */
    if (d > 0 && hasEffect(h, 'charmed')) {
      const eff = getEffect(h, 'charmed');
      const rs = eff.repeatSave || { ability: 'wis', dc: 12 };
      if (rollSave(h, rs.ability || 'wis', rs.dc || 12, { magic: true })) {
        clearEffect(h, 'charmed');
        log(`💫 ${h.data.name} snaps out of the charm!`, 'heal');
        makeFloatText(this.engine.scene, 'charm broken', _v.set(h.x, 1.35, h.z), '#e8a8ff');
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
      h.repathT = (h.repathT || 0) - dt;
      if (h.repathT <= 0 || !h.path || h.pathI >= h.path.length) {
        h.path = this.findPath(this.cellOf(h.x, h.z), this.cellOf(ally.x, ally.z));
        h.pathI = 0; h.repathT = 0.6;
      }
      h.moving = this.moveStep(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt);
      h.ent.grp.rotation.y = Math.atan2(ally.x - h.x, ally.z - h.z);
      return;
    }

    h.moving = false;
    h.ent.grp.rotation.y = Math.atan2(ally.x - h.x, ally.z - h.z);
    if (h.actUsed) return;
    h.actUsed = true;

    /* one attack roll vs the ally's AC */
    const d20 = d20Roll(0);
    const total = d20 + (h.data.atkProf || 0) + mod(h.data.effStats[profile.ability] || 10);
    const crit = d20 === 20;
    const ac = this.heroAC(ally);
    this.triggerLunge(h, ally);
    playSfx('swordAttack', { volume: 0.6 });
    if (!crit && total < ac) {
      makeFloatText(this.engine.scene, 'miss', _v.set(ally.x, 1.1, ally.z), '#9aa');
      log(`💜 ${h.data.name} (charmed) swings at ${ally.data.name} — miss!`, 'miss');
      return;
    }
    const dmg = heroDamage(h.data, crit, profile);
    log(`💜 ${h.data.name} (charmed) hits ${ally.data.name} for ${dmg}!`, 'down', { cat: 'hitmiss' });
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
      makeFloatText(this.engine.scene, String(d), _v.set(h.x, 1.15, h.z), '#4cae4c');
      drawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
      if (h.data.hp <= 0) {
        h.data.hp = 0; h.data.downs++;
        log(`💀 ${h.data.name} succumbs to ${(EFFECTS[k] && EFFECTS[k].label) || k} and goes down!`, 'down');
        updatePartyFrames(this.heroes.map(x => x.data));
      }
    }
  },

  strike(h, foe, dmg, crit, miss, alive = null, profile = null) {
    /* Profile carries melee/ranged, damage type, and source — drives the
       lunge-vs-projectile visual and the physical damage type. */
    const p = profile || h.data.lastProfile || h.data.weaponProfile
      || { melee:true, dmgType:'slashing', source:'weapon' };
    const party = alive || this.heroes.filter(x => x.data.hp > 0);
    /* Magic Weapon (spell): weapon counts as magical → bypasses nonmagical resistance.
       Cantrips are inherently magical. */
    const wDmgType = p.dmgType || 'slashing';
    const wMagical = !!getEffectMods(h).magicWeapon || p.source === 'cantrip';
    if (p.melee) {
      this.triggerLunge(h, foe);
      playSfx('swordAttack', { volume: 0.7 });
      if (miss) { this.showMiss(foe); playSfx(Math.random() < 0.5 ? 'swordBlock' : 'swordParry', { volume: 0.6 }); }
      else {
        playSfx('swordHit', { volume: 0.8 });
        if (crit && this.engine) {
          this.engine.triggerHitStop(4);
          this.engine.triggerShake(0.5, 0.25);
        } else if (this.engine) {
          this.engine.triggerHitStop(1);
        }
        this.damageMonster(foe, dmg, h, crit, { dmgType: wDmgType, magical: wMagical });
        this.applyOnHitPerks(h, foe, dmg, crit, party);
        spawnMeleeHitVFX(this.engine.scene, { x: foe.x, z: foe.z }, { x: h.x, z: h.z }, crit, wDmgType, foe.data.scale || 1.0);
      }
    } else {
      /* Ranged: physical bows/crossbows shoot arrows; caster cantrips shoot bolts
         and land their class's signature animated burst (CANTRIP_FX). */
      const isCantrip = p.source === 'cantrip';
      const cfx = isCantrip ? CANTRIP_FX[h.data.classKey] : null;
      const color = cfx ? cfx.color : 0xe8d8a8;
      const kind = isCantrip ? 'bolt' : 'arrow';
      const from = new THREE.Vector3(h.x, 0.55, h.z);
      const to = new THREE.Vector3(foe.x, 0.4 * foe.data.scale + 0.4, foe.z);
      playSfx(kind === 'arrow' ? 'bowAttack' : cantripSfx(h.data.classKey),
              { volume: kind === 'arrow' ? 0.7 : 0.4 });
      
      const projOpts = {
        classKey: h.data.classKey,
        sheetDef: cfx?.projSheet ? GIGAPACK_REGISTRY[cfx.projSheet] : null,
        dmgType: wDmgType,
        scale: isCantrip ? 1.4 : 1.0
      };

      spawnProjectile(this.engine.scene, from, to, kind, color, () => {
        if (foe.dead) return;
        if (miss) { this.showMiss(foe); playSfx('bowBlock', { volume: 0.55 }); }
        else {
          playSfx(kind === 'arrow' ? 'bowHit' : 'spellImpact', { volume: 0.75 });
          this.damageMonster(foe, dmg, h, crit, { dmgType: wDmgType, magical: wMagical });
          this.applyOnHitPerks(h, foe, dmg, crit, party);
          if (kind === 'bolt') {
            spawnSlash(this.engine.scene, { x: foe.x, z: foe.z }, color, foe.data.scale * 0.9);
            if (cfx) spawnSheetEffect(this.engine.scene, cfx, to, cfx.scale * Math.max(1, foe.data.scale * 0.8));
            else spawnSpriteEffect(this.engine.scene, 'dcss/effect/magic_bolt_1.png', to, 1.2, 0.3);
          } else {
            spawnSpriteEffect(this.engine.scene, 'dcss/effect/arrow_4.png', to, 1.0, 0.3);
          }
        }
      }, projOpts);
    }
  },

  showMiss(foe) { makeFloatText(this.engine.scene, 'miss', _v.set(foe.x, 1.1, foe.z), '#9aa'); },

  triggerLunge(e, target) {
    const dx = target.x - e.x, dz = target.z - e.z, d = Math.hypot(dx, dz) || 1;
    e.lungeDX = dx / d; e.lungeDZ = dz / d; e.lungeT = 0.22;
  },

  lungeOffset(e, dt) {
    if (!e.lungeT || e.lungeT <= 0) return [0, 0];
    e.lungeT -= dt;
    const p = 1 - Math.max(0, e.lungeT) / 0.22;
    const amp = Math.sin(Math.min(1, p) * Math.PI) * 0.42;
    return [e.lungeDX * amp, e.lungeDZ * amp];
  },

  damageMonster(m, dmg, h, crit = false, opts = {}) {
    if (m.dead) return { dmg: 0, modLabel: null };
    /* Damage-type modifiers: resistance / immunity / vulnerability (5e).
     * Spell damage passes { dmgType, magical:true }; weapon strikes pass a
     * physical type with magical:false so nonmagical-weapon resistance applies. */
    let modLabel = null;
    if (opts.dmgType && dmg > 0) {
      const mod = this.damageModifier(m, opts.dmgType, !!opts.magical || !!opts.spell);
      if (mod === 'immune') { dmg = 0; modLabel = 'IMMUNE'; }
      else if (mod === 'vuln') { dmg = dmg * 2; modLabel = 'VULNERABLE'; }
      else if (mod === 'resist') { dmg = Math.floor(dmg / 2); modLabel = 'RESIST'; }
    }
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
    hitFlash(m.ent);
    if (modLabel === 'IMMUNE') {
      makeFloatText(this.engine.scene, 'IMMUNE', _v.set(m.x, 0.9 * m.data.scale + 0.5, m.z), '#9aa');
    } else {
      const col = modLabel === 'VULNERABLE' ? '#ffe070'
        : modLabel === 'RESIST' ? '#9aa'
        : crit ? '#ffd34a' : '#ff8a5a';
      makeFloatText(this.engine.scene, String(dmg) + (modLabel ? ` ${modLabel}` : ''), _v.set(m.x, 0.9 * m.data.scale + 0.5, m.z), col);
    }
    /* Regeneration suppression (SRD trolls): fire or acid stops the healing */
    if (m.data.regen && dmg > 0 && (opts.dmgType === 'fire' || opts.dmgType === 'acid')) {
      m._noRegenUntil = this.fxNow + ROUND_SECONDS;   // one round, on the combat clock
    }
    /* Undead Fortitude (SRD zombies): CON save DC 5+dmg to drop to 1 HP instead,
       unless the blow was radiant or a critical hit. */
    if (m.data.hp <= 0 && m.data.undeadFortitude && dmg > 0) {
      if (crit || opts.dmgType === 'radiant') {
        log(`☠ ${m.data.name}'s Undead Fortitude bypassed by ${crit ? 'critical hit' : 'radiant damage'}!`, 'roll');
      } else {
        const dc = 5 + dmg;
        const res = rollSaveDetail(m, 'con', dc);
        if (res.saved) {
          m.data.hp = 1;
          makeFloatText(this.engine.scene, 'fortitude!', _v.set(m.x, 1.1, m.z), '#9aa');
          log(`☠ ${m.data.name} refuses to die! Undead Fortitude — PASSED!`, 'crit',
            { detail: `(CON save ${res.d20} + ${res.mod} = ${res.total} vs DC ${dc})` });
        } else {
          log(`☠ ${m.data.name} Undead Fortitude — FAILED.`, 'roll',
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
    drawBar(m.ent.bar, Math.max(0, m.data.hp / m.data.maxHp), '#e0483a');
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
      (sb.immune || []).some(x => x.includes('from nonmagical weapons')) ||
      (sb.resist || []).some(x => x.includes('from nonmagical weapons'))
    );
    if (physMeta && (sb.immune || []).some(x => x.includes('from nonmagical weapons'))) return 'immune';
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
        makeFloatText(this.engine.scene, String(bd), _v.set(m.x, 1.0, m.z), '#ff7a30');
        drawBar(m.ent.bar, Math.max(0, m.data.hp / m.data.maxHp), '#e0483a');
        if (m.data.hp <= 0) this.killMonster(m, m.burn.src);
        else if (m.burn.ticks <= 0) m.burn = null;
      }
    }
  },

  killMonster(m, h) {
    m.dead = true;
    m.ent.grp.visible = false;
    m.burn = null;
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
    /* Kill-streak tracking */
    this._killStreak = (this._killStreak || 0) + 1;
    this._killStreakTimer = 2.0;
    if (this._killStreak === 3) makeFloatText(this.engine.scene, 'TRIPLE KILL!', _v.set(m.x, 1.5, m.z), '#ff9a3c');
    else if (this._killStreak === 5) makeFloatText(this.engine.scene, 'MULTI KILL!', _v.set(m.x, 1.6, m.z), '#ff4030');
    else if (this._killStreak >= 7) {
      makeFloatText(this.engine.scene, 'MASSACRE!', _v.set(m.x, 1.7, m.z), '#ffd34a');
      if (this.engine) this.engine.triggerShake(0.5, 0.3);
    }
    this.gold += m.data.gold;
    trackGold(this, m.data.gold);
    const before = this.heroes.map(a => a.data.level);
    const dungeonLevel = this.dungeonLevel || 1;
    const share = (m.isBoss ? 10 : (m.data._ambushElite || this.monsterEliteRoom(m) ? 3 : 1)) * dungeonLevel;
    for (const a of this.heroes) if (a.data.hp > 0 && !a.temp && !a.companion) grantXp(a.data, share, log);
    this.summons.syncScales();   // a level-up from this kill rescales companions
    if (this.guild) this.guild.dispatchDungeonXp(share);
    const killer = h?.data?.name || 'The party';
    const goldText = m.data.gold ? ` (+${m.data.gold}g, +${share} XP each)` : ` (+${share} XP each)`;
    log(`${killer} slays the ${m.data.name}.${goldText}`, m.data._ambushElite ? 'elite' : m.isBoss ? 'boss' : 'kill');
    onKill(this, m, h);
    /* Random drops: common–epic only (legendaries are quest rewards). */
    let dropChance = m.isBoss ? 1 : ((m.data._ambushElite || this.monsterEliteRoom(m)) ? 0.35 : 0.10);
    if (Math.random() < dropChance) {
      const it = rollItem(this.activeQuest ? this.activeQuest.level : this.dungeonLevel, Math.random, null, { source: 'trash' });
      this.inventory.push(it);
      trackLoot(this, it);
      log(`  ↳ ${m.data.name} dropped ${it.name} (ilvl ${it.ilvl})!`, 'treasure');
    }
    /* Independent dye roll — cosmetic loot on top of the gear table. */
    const dyeChance = m.isBoss ? DYE_DROP_BOSS : ((m.data._ambushElite || this.monsterEliteRoom(m)) ? DYE_DROP_ELITE : DYE_DROP_NORMAL);
    if (Math.random() < dyeChance) {
      const dye = makeDye();
      this.inventory.push(dye);
      trackLoot(this, dye);
      log(`  ↳ 🎨 ${m.data.name} dropped a ${dye.name}!`, 'treasure');
    }
    if (m.isBoss) {
      /* Boss death spectacle: slow-mo, shake, golden fountain */
      if (this.engine) {
        this.engine.triggerSlowMo(1.5);
        this.engine.triggerShake(1.2, 0.6);
      }
      spawnDeathFountain(this.engine.scene, new THREE.Vector3(m.x, 0.1, m.z));
      playSfx('gateOpen', { volume: 0.9 });
      log(`👑 ${m.data.name} falls! The floor is conquered!`, 'boss');
      this.gold += 50 * this.dungeonLevel;
      trackGold(this, 50 * this.dungeonLevel);

      const q = this.activeQuest;
      const finalFloor = q && (this.questFloor|0) >= (q.floors|0);

      if (finalFloor && q.rewardItem && !q.rewardClaimed) {
        /* Quest reward is delivered at the end of the final dungeon floor. */
        this.grantQuestRewardsAtDungeonEnd();
      } else {
        showBanner('FLOOR CLEARED!', `${m.data.name} defeated`);
        /* Floor-clear hoard: a guaranteed drop with boosted rarity odds — but
           the tier is still level-gated, so it's a strong item, not a free epic. */
        const hoardLvl = this.activeQuest ? this.activeQuest.level : this.dungeonLevel;
        const it = rollItem(hoardLvl, Math.random, null, { source: 'hoard', luck: 4 });
        this.inventory.push(it);
        trackLoot(this, it);
        log(`  ↳ ${it.name} (ilvl ${it.ilvl}) claimed from the hoard!`, 'treasure');
      }
    }
    if (this.heroes.some((a, i) => a.data.level > before[i])) this.announceLevelUp();
    updateResources(this);
    updatePartyFrames(this.heroes.map(x => x.data));
    refreshMenus(this);
  },

  monsterEliteRoom(m) {
    const r = this.D.rooms[m.roomId];
    return r && (r.type === 'elite');
  },

  announceLevelUp() {
    const total = this.heroes.reduce((n, h) => n + pendingPoints(h.data), 0);
    /* The level-up button was folded into Party; its badge went with it. */
    const badge = document.getElementById('nav-party-badge');
    if (badge) { badge.textContent = total; badge.style.display = total > 0 ? '' : 'none'; }
  },

  /* ================================================================
     Manual Mode Combat Execution API
     ================================================================ */

  manualPerformAttack(h, targetFoe = null) {
    if (!h || h.actUsed) return false;
    const alive = this.heroes.filter(x => x.data.hp > 0);
    const foe = targetFoe || this.findMonsterTarget(h);
    if (!foe || foe.data.hp <= 0) {
      log(`No valid target for ${h.data.name}'s attack.`, 'sys');
      return false;
    }

    const atk = h.data.weaponProfile || { name: 'Unarmed', d: 4, n: 1, type: 'bludgeoning', source: 'weapon' };
    const wpn = h.data.equipment && h.data.equipment.weapon;
    const vw = (wpn && wpn.visualWeapon) || '';
    const isRanged = vw.startsWith('ranged/');
    const dist = Math.hypot(foe.x - h.x, foe.z - h.z);
    const maxReach = isRanged ? 15.0 : 1.9;

    /* If out of melee reach and using a melee weapon, move closer first! */
    if (!isRanged && dist > maxReach) {
      const budget = h.moveLeft != null ? h.moveLeft : this.cellsForSpeed(h);
      if (budget <= 0) {
        log(`🦶 ${h.data.name} has no movement left to reach ${foe.data.name}.`, 'sys');
        return false;
      }
      const goalCell = this.nearFloorCell(this.cellOf(foe.x, foe.z), 2);
      if (goalCell >= 0) {
        const path = this.findPath(this.cellOf(h.x, h.z), goalCell);
        if (path && path.length > 1) {
          const maxSteps = Math.min(budget, path.length - 1);
          const actualPath = path.slice(0, maxSteps + 1);
          h.path = actualPath;
          h.pathI = 0;
          h.repathT = 0;
          h.moving = true;
          h.moveLeft = Math.max(0, budget - maxSteps);
          h._pendingAttackTarget = foe;
          log(`🏃 ${h.data.name} moves toward ${foe.data.name}...`, 'sys');
          if (typeof window !== 'undefined' && window.__updateManualBar) window.__updateManualBar();
          return true;
        }
      }
    }

    const sc = subclassOf(h.data);
    const opts = this.buildAttackOpts(h, foe, sc);
    opts.profile = atk;

    h.actUsed = true;
    this.heroAttackRoll(h, foe, alive, opts);

    /* Extra Attack */
    let attacks = 1;
    if (hasFeature(h.data, 'extraAttack2')) attacks = 3;
    else if (hasFeature(h.data, 'extraAttack')) attacks = 2;
    for (let i = 1; i < attacks && foe.data.hp > 0; i++) {
      this.heroAttackRoll(h, foe, alive, { profile: atk });
    }

    /* Offhand attack if applicable & bonus action free */
    if (atk.source === 'weapon' && h.data.offhandProfile && foe.data.hp > 0 && !h.bonusUsed && !h._bonusActed) {
      this.heroAttackRoll(h, foe, alive, { profile: h.data.offhandProfile });
      h.bonusUsed = true;
      h._bonusActed = true;
    }

    updatePartyFrames(this.heroes.map(x => x.data));
    updateInitiativeTracker(this);
    if (typeof window !== 'undefined' && window.__updateManualBar) window.__updateManualBar();
    return true;
  },

  startSpellTargeting(h, key, radius = 4.0, isAoE = true, slotLevel = 1) {
    this.cancelSpellTargeting();
    const sp = SPELLS[key];
    const spName = sp ? sp.label : key;
    const isMultiTarget = key === 'magicMissile' || key === 'scorchingRay';
    const totalDarts = isMultiTarget ? (key === 'magicMissile' ? 3 + Math.max(0, slotLevel - 1) : 3 + Math.max(0, slotLevel - 2)) : 1;

    this.targetingState = {
      active: true,
      hero: h,
      spellKey: key,
      radius,
      isAoE,
      slotLevel,
      isMultiTarget,
      totalDarts,
      assignedTargets: [],
      isBonus: sp && (sp.bonusAction === true || sp.castingTime === 'bonus')
    };

    if (this.engine && this.engine.scene) {
      this._targetingVisualObj = spawnAoEVisual(this.engine.scene, { x: h.x, z: h.z }, sp?.color || 0xffaa30, radius);
    }

    if (isMultiTarget) {
      log(`🎯 Aiming ${spName} (Level ${slotLevel}) — Click target for Dart 1 of ${totalDarts} (Esc to cancel).`, 'sys');
    } else {
      const modeLabel = isAoE ? `Area (${Math.round(radius * 5)} ft radius)` : `Target`;
      log(`🎯 Aiming ${spName} [${modeLabel}] — Click target on screen to cast (Esc to cancel).`, 'sys');
    }
    if (typeof window !== 'undefined' && window.__updateManualBar) window.__updateManualBar();
  },

  updateSpellTargeting(x, z) {
    if (!this.targetingState || !this.targetingState.active) return;
    if (this._targetingVisualObj && this._targetingVisualObj.group) {
      this._targetingVisualObj.group.position.set(x, 0.05, z);
    }
  },

  confirmSpellTargeting(x, z, clickedMonster = null) {
    if (!this.targetingState || !this.targetingState.active) return false;
    const { hero, spellKey, slotLevel, isMultiTarget, totalDarts, assignedTargets } = this.targetingState;

    if (isMultiTarget) {
      const target = clickedMonster || (x != null && z != null ? this.monsters.find(m => m.active && m.data.hp > 0 && Math.hypot(m.x - x, m.z - z) <= 2.5) : null) || this.findMonsterTarget(hero);
      if (target) {
        assignedTargets.push(target);
        makeFloatText(this.engine.scene, `🎯 Dart ${assignedTargets.length}`, { x: target.x, y: 1.5, z: target.z }, '#ffda7b');
        log(`🎯 Dart ${assignedTargets.length} assigned to ${target.data.name} (${totalDarts - assignedTargets.length} remaining).`, 'sys');

        if (assignedTargets.length < totalDarts) {
          log(`🎯 Click target for Dart ${assignedTargets.length + 1} of ${totalDarts}.`, 'sys');
          if (typeof window !== 'undefined' && window.__updateManualBar) window.__updateManualBar();
          return true;
        }
      }
    }

    const finalTargets = isMultiTarget ? (assignedTargets.length ? assignedTargets : null) : null;
    this.cancelSpellTargeting();
    return this.manualPerformSpell(hero, spellKey, clickedMonster, { x, z }, slotLevel, finalTargets);
  },

  cancelSpellTargeting() {
    if (this._targetingVisualObj && this._targetingVisualObj.group && this.engine && this.engine.scene) {
      this.engine.scene.remove(this._targetingVisualObj.group);
      this._targetingVisualObj = null;
    }
    this.targetingState = null;
    if (typeof window !== 'undefined' && window.__updateManualBar) window.__updateManualBar();
  },

  manualPerformSpell(h, key, targetFoe = null, targetPos = null, slotLevel = null, assignedTargets = null) {
    if (!h) return false;
    const sp = SPELLS[key];
    if (!sp) return false;
    const isBonus = sp.bonusAction === true || sp.castingTime === 'bonus';
    if (isBonus && (h.bonusUsed || h._bonusActed)) {
      log(`${h.data.name} already used their Bonus Action this turn.`, 'sys');
      return false;
    }
    if (!isBonus && h.actUsed) {
      log(`${h.data.name} already used their Action this turn.`, 'sys');
      return false;
    }

    const isAoE = !!(sp.aoeRadius || sp.ai?.aoeRadius || sp.targetType === 'area' || sp.ai?.when === 'cluster');
    const radius = sp.aoeRadius || sp.ai?.aoeRadius || (key === 'fireball' ? 4.0 : 2.5);
    const chosenSlotLevel = slotLevel || sp.level || 1;

    /* In manual mode, if no target foe or position has been selected yet, enter targeting mode! */
    if (!targetPos && !targetFoe && !assignedTargets && this.controlMode === 'manual') {
      this.startSpellTargeting(h, key, isAoE ? radius : 1.2, isAoE, chosenSlotLevel);
      return true;
    }

    const alive = this.heroes.filter(x => x.data.hp > 0);
    const foe = targetFoe || (targetPos ? this.monsters.find(m => m.active && m.data.hp > 0 && Math.hypot(m.x - targetPos.x, m.z - targetPos.z) <= radius) : null) || this.findMonsterTarget(h);

    const success = sp.cast ? sp.cast(this, h, foe, alive, chosenSlotLevel, targetPos, assignedTargets) : this.resolveSpell(h, key, foe, alive);
    if (success) {
      if (isBonus) {
        h.bonusUsed = true;
        h._bonusActed = true;
        if ((sp.level || 0) > 0) h._bonusLeveled = true;
      } else {
        h.actUsed = true;
      }
      spendSlotFor(h.data, chosenSlotLevel);
      updatePartyFrames(this.heroes.map(x => x.data));
      updateInitiativeTracker(this);
      if (typeof window !== 'undefined' && window.__updateManualBar) window.__updateManualBar();
      return true;
    }
    return false;
  },

  manualPerformCommonAction(h, actionType) {
    if (!h || h.actUsed) return false;
    /* Dash / Dodge / Disengage all run through the shared turn-engine helper
       (turn_engine.takeCommonAction) so manual mode and both AIs book the same
       budgets and effects. The extra flavour log stays manual-only. */
    if (actionType === 'dash') {
      const boost = this.cellsForSpeed(h);
      if (!this.takeCommonAction(h, 'dash')) return false;
      log(`(+${boost * 5} ft movement budget)`, 'heal');
    } else if (actionType === 'dodge') {
      if (!this.takeCommonAction(h, 'dodge')) return false;
      h.dodgeActive = true;
      log('(+5 AC until the start of their next turn)', 'heal');
    } else if (actionType === 'disengage') {
      if (!this.takeCommonAction(h, 'disengage')) return false;
      log('(movement provokes no opportunity attacks this turn)', 'heal');
    } else if (actionType === 'help') {
      h.actUsed = true;
      const ally = this.heroes.find(x => x !== h && x.data.hp > 0);
      if (ally) applyEffect(ally, 'inspired', { duration: ROUND_SECONDS, elapsed: this.fxNow });
      log(`🤝 ${h.data.name} takes the Help action to assist allies!`, 'heal');
    } else {
      return false;
    }
    updatePartyFrames(this.heroes.map(x => x.data));
    updateInitiativeTracker(this);
    if (typeof window !== 'undefined' && window.__updateManualBar) window.__updateManualBar();
    return true;
  },

  manualPerformBonusAbility(h, abilityKey) {
    if (!h || h.bonusUsed || h._bonusActed) {
      log(`${h.data.name} already used their Bonus Action this turn.`, 'sys');
      return false;
    }
    const d = h.data;
    const alive = this.heroes.filter(x => x.data.hp > 0);
    const foe = this.findMonsterTarget(h);

    if (abilityKey === 'secondWind') {
      if (d.secondWindUsed) { log('Second Wind has already been used.', 'sys'); return false; }
      d.secondWindUsed = true; h.bonusUsed = true; h._bonusActed = true;
      const amt = roll(1, 10, d.level);
      d.hp = Math.min(d.maxHp, d.hp + amt);
      this.playAbilityFx(h, 'secondWind', { at: h });
      makeFloatText(this.engine.scene, '+' + amt, _v.set(h.x, 1.55, h.z), '#6ae06a');
      drawBar(h.ent.bar, d.hp / d.maxHp);
      log(`💚 ${d.name} uses Second Wind (+${amt} HP).`, 'heal');
    } else if (abilityKey === 'offhand') {
      if (!d.offhandProfile) { log('No off-hand weapon equipped.', 'sys'); return false; }
      if (!foe || foe.data.hp <= 0) { log('No target for off-hand attack.', 'sys'); return false; }
      h.bonusUsed = true; h._bonusActed = true;
      this.heroAttackRoll(h, foe, alive, { profile: d.offhandProfile });
    } else if (abilityKey === 'rage') {
      if (d.rageUsed) { log('Rage has already been used.', 'sys'); return false; }
      d.rageUsed = true; h.bonusUsed = true; h._bonusActed = true;
      applyEffect(h, 'raging', { duration: 30, elapsed: this.fxNow });
      this.playAbilityFx(h, 'rage', { at: h, scale: 1.7 });
      log(`😡 ${d.name} enters a Rage!`, 'crit');
    } else if (abilityKey === 'cunningAction') {
      h.bonusUsed = true; h._bonusActed = true;
      applyEffect(h, 'hasted', { duration: 30, elapsed: this.fxNow });
      this.playAbilityFx(h, 'cunningAction', { at: h });
      log(`💨 ${d.name} uses Cunning Action (+4 AC, +40% speed)!`, 'heal');
    } else if (abilityKey === 'flurry') {
      if (!foe || foe.data.hp <= 0) { log('No target for Flurry of Blows.', 'sys'); return false; }
      h.bonusUsed = true; h._bonusActed = true;
      this.playAbilityFx(h, 'flurry', { at: foe });
      const profile = d.weaponProfile || { name: 'Unarmed', d: 4, n: 1, type: 'bludgeoning', source: 'weapon' };
      this.heroAttackRoll(h, foe, alive, { profile });
      log(`👊 ${d.name} uses Flurry of Blows!`, 'crit');
    } else if (abilityKey === 'bardicInspiration') {
      h.bonusUsed = true; h._bonusActed = true;
      for (const a of alive) applyEffect(a, 'inspired', { duration: 30, elapsed: this.fxNow });
      this.playAbilityFx(h, 'bardic', { at: h, alsoAt: alive, spell: true });
      log(`🎵 ${d.name} uses Bardic Inspiration (+1d4 to hit)!`, 'heal');
    } else {
      return false;
    }

    updatePartyFrames(this.heroes.map(x => x.data));
    updateInitiativeTracker(this);
    if (typeof window !== 'undefined' && window.__updateManualBar) window.__updateManualBar();
    return true;
  },

  manualEndTurn() {
    if (!this.initiative || !this.initiative.active) return;
    const cur = this._currentActor();
    if (cur) {
      log(`⏱️ ${cur.data.name} ends their turn.`, 'sys');
    }
    this._advanceTurn();
    if (typeof window !== 'undefined' && window.__updateManualBar) window.__updateManualBar();
  }
};
