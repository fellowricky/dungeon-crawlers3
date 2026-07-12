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
  CLASSES, RACES, roll, d as die, d20Roll, mod, pendingPoints
} from './srd.js';
import {
  drawBar, makeFloatText, hitFlash,
  spawnProjectile, spawnSlash, spawnSpriteEffect, spawnDeathFountain
} from './entities.js';
import { rollItem, equippedPerks } from './items.js';
import { log, updatePartyFrames, updateResources, showBanner } from './ui.js';
import { refreshMenus } from './menus.js';
import {
  FLOOR, WALL, HERO_SPEED, HERO_ATTACK_CD, COMBAT_SPEED, XP_SHARE,
  STUCK_SIDESTEP_T, STUCK_TELEPORT_T, STUCK_SIDESTEP_DIST
} from './constants.js';
import { _v } from './shared.js';
import { hasFeature, hasFeat, hasSlotFor, spendSlotFor, recoverSlots, totalSlots } from './features.js';
import { onKill } from './quest_events.js';
import { playSfx, spellSfx } from './audio.js';

/** Sprite paths + tint colors for ability / spell feedback.
 *  Each entry may include `frames` (texture-path array) + `frameInterval`
 *  to produce an animated sprite effect that cycles through the sequence. */
const ABILITY_FX = {
  /* ── Class Features ── */
  secondWind:      { sprite: 'dcss/effect/gold_sparkles_1.png', color: 0x6ae06a, label: '2nd WIND',     float: '#6ae06a' },
  actionSurge:     { sprite: 'dcss/effect/heataura_1.png',      color: 0xffd34a, label: 'SURGE',         float: '#ffd34a' },
  flurry:          { sprite: 'dcss/effect/heataura_2.png',      color: 0xe8d8a8, label: 'FLURRY',        float: '#e8d8a8' },
  frenzy:          { sprite: 'dcss/effect/flame_0.png',
    frames: ['dcss/effect/flame_0.png','dcss/effect/flame_1.png','dcss/effect/flame_2.png'],
    frameInterval: 0.06,                                        color: 0xff6030, label: 'FRENZY',        float: '#ff6030' },
  cunningAction:   { sprite: 'dcss/effect/xom_sparkles_blue.png', color: 0x8fd4e8, label: 'DASH',         float: '#8fd4e8' },
  remarkableAthlete: { sprite: 'dcss/effect/gold_sparkles_1.png', color: 0xaab4cc, label: 'ATHLETE',      float: '#aab4cc' },
  fastHands:       { sprite: 'dcss/effect/cloud_magic_trail_0.png', color: 0x8fd4e8, label: 'SMOKE BOMB',   float: '#8fd4e8' },
  rage:            { sprite: 'dcss/effect/flame_0.png',
    frames: ['dcss/effect/flame_0.png','dcss/effect/flame_1.png','dcss/effect/flame_2.png'],
    frameInterval: 0.07,                                        color: 0xff4020, label: 'RAGE',          float: '#ff6040' },
  bearTotem:       { sprite: 'dcss/effect/cloud_forest_fire.png', color: 0xc08040, label: 'BEAR',          float: '#c08040' },
  bardic:          { sprite: 'dcss/effect/gold_sparkles_1.png',
    frames: ['dcss/effect/gold_sparkles_1.png','dcss/effect/gold_sparkles_2.png','dcss/effect/gold_sparkles_3.png'],
    frameInterval: 0.07,                                        color: 0xe8a8ff, label: 'INSPIRE',       float: '#e8a8ff' },
  wildShape:       { sprite: 'dcss/effect/cloud_magic_trail_0.png',
    frames: ['dcss/effect/cloud_magic_trail_0.png','dcss/effect/cloud_magic_trail_1.png','dcss/effect/cloud_magic_trail_2.png','dcss/effect/cloud_magic_trail_3.png'],
    frameInterval: 0.06,                                        color: 0x6aaa4a, label: 'WILD SHAPE',    float: '#6aaa4a' },
  combatSong:      { sprite: 'dcss/effect/goldaura_0.png',
    frames: ['dcss/effect/goldaura_0.png','dcss/effect/goldaura_1.png','dcss/effect/goldaura_2.png'],
    frameInterval: 0.07,                                        color: 0xffd080, label: 'BATTLE SONG',   float: '#ffd080' },
  divineSmite:     { sprite: 'dcss/effect/searing_ray_0.png',
    frames: ['dcss/effect/searing_ray_0.png','dcss/effect/searing_ray_1.png','dcss/effect/searing_ray_2.png','dcss/effect/searing_ray_3.png'],
    frameInterval: 0.05,                                        color: 0xffe08a, label: 'SMITE',         float: '#ffe08a' },
  tidesOfChaos:    { sprite: 'dcss/effect/cloud_chaos_1.png',
    frames: ['dcss/effect/cloud_chaos_1.png','dcss/effect/cloud_chaos_2.png'],
    frameInterval: 0.08,                                        color: 0xb06cf0, label: 'CHAOS',         float: '#b06cf0' },
  indomitable:     { sprite: 'dcss/effect/sanctuary.png',         color: 0xa0c0ff, label: 'INDOMITABLE',   float: '#a0c0ff' },
  lucky:           { sprite: 'dcss/effect/gold_sparkles_3.png',   color: 0x6aea6a, label: 'LUCKY',         float: '#6aea6a' },
  layOnHands:      { sprite: 'dcss/effect/goldaura_1.png',        color: 0xffe08a, label: null,            float: '#6ae06a' },
  cureWounds:      { sprite: 'dcss/effect/goldaura_0.png',        color: 0x6ae06a, label: null,            float: '#6ae06a' },
  healingWord:     { sprite: 'dcss/effect/gold_sparkles_2.png',   color: 0xe8a8ff, label: null,            float: '#6ae06a' },
  deathstrike:     { sprite: 'dcss/effect/drain_red_0.png',
    frames: ['dcss/effect/drain_red_0.png','dcss/effect/drain_red_1.png','dcss/effect/drain_red_2.png'],
    frameInterval: 0.06,                                        color: 0xc04040, label: 'DEATHSTRIKE',   float: '#e07070' },
  guidedStrike:    { sprite: 'dcss/effect/quad_glow.png',         color: 0xffe08a, label: 'GUIDED',        float: '#ffe08a' },
  vowOfEnmity:     { sprite: 'dcss/effect/flame_2.png',           color: 0xe8a83f, label: 'VOW',           float: '#e8a83f' },
  shadowStep:      { sprite: 'dcss/effect/umbra_0.png',
    frames: ['dcss/effect/umbra_0.png','dcss/effect/umbra_1.png','dcss/effect/umbra_2.png','dcss/effect/umbra_3.png'],
    frameInterval: 0.05,                                        color: 0x6a5080, label: 'SHADOW STEP',   float: '#a080c0' },
  sacredWeapon:    { sprite: 'dcss/effect/irradiate_0.png',
    frames: ['dcss/effect/irradiate_0.png','dcss/effect/irradiate_1.png','dcss/effect/irradiate_2.png','dcss/effect/irradiate_3.png'],
    frameInterval: 0.06,                                        color: 0xffe08a, label: 'SACRED',        float: '#ffe08a' },
  colossusSlayer:  { sprite: 'dcss/effect/searing_ray_5.png',     color: 0xe8a83f, label: 'PREY',          float: '#e8a83f' },
  companionStrike: { sprite: 'dcss/effect/cloud_magic_trail_3.png', color: 0xa0c080, label: 'COMPANION',    float: '#a0c080' },
  quiveringPalm:   { sprite: 'dcss/effect/sandblast_0.png',
    frames: ['dcss/effect/sandblast_0.png','dcss/effect/sandblast_1.png','dcss/effect/sandblast_2.png'],
    frameInterval: 0.06,                                        color: 0xffd080, label: 'QUIVERING',     float: '#ffd080' },
  rallyingCry:     { sprite: 'dcss/effect/goldaura_2.png',        color: 0xe8a83f, label: 'RALLY',         float: '#e8a83f' },
  preserveLife:    { sprite: 'dcss/effect/orb_glow_0.png',
    frames: ['dcss/effect/orb_glow_0.png','dcss/effect/orb_glow_1.png'],
    frameInterval: 0.08,                                        color: 0xbfe0ff, label: 'PRESERVE',      float: '#bfe0ff' },
  dragonBreath:    { sprite: 'dcss/effect/cloud_fire_0.png',
    frames: ['dcss/effect/cloud_fire_0.png','dcss/effect/cloud_fire_1.png','dcss/effect/cloud_fire_2.png'],
    frameInterval: 0.06,                                        color: 0xff6020, label: 'BREATH',        float: '#ff6020' },
  wildSurge:       { sprite: 'dcss/effect/cloud_chaos_3.png',
    frames: ['dcss/effect/cloud_chaos_3.png','dcss/effect/cloud_chaos_4.png','dcss/effect/cloud_chaos_5.png'],
    frameInterval: 0.06,                                        color: 0xff8844, label: 'WILD MAGIC',    float: '#ff8844' },
  cuttingWords:    { sprite: 'dcss/effect/cloud_neg_1.png',       color: 0xd0a0ff, label: 'CUTTING WORDS', float: '#d0a0ff' },
  fiendishBlessing:{ sprite: 'dcss/effect/cloud_neg_0.png',
    frames: ['dcss/effect/cloud_neg_0.png','dcss/effect/cloud_neg_1.png','dcss/effect/cloud_neg_2.png'],
    frameInterval: 0.07,                                        color: 0x9b59b6, label: 'FIENDISH',      float: '#9b59b6' },
  feyPresence:     { sprite: 'dcss/effect/cloud_spectral_0.png',
    frames: ['dcss/effect/cloud_spectral_0.png','dcss/effect/cloud_spectral_1.png','dcss/effect/cloud_spectral_2.png'],
    frameInterval: 0.07,                                        color: 0xe8a8ff, label: 'FEY',           float: '#e8a8ff' },
  /* ── Spells ── */
  magicMissile:    { sprite: 'dcss/effect/magic_bolt_1.png',
    frames: ['dcss/effect/magic_bolt_1.png','dcss/effect/magic_bolt_2.png','dcss/effect/magic_bolt_3.png','dcss/effect/magic_bolt_4.png','dcss/effect/magic_bolt_5.png','dcss/effect/magic_bolt_6.png'],
    frameInterval: 0.04,                                        color: 0xb08cff, label: 'MISSILE',       float: '#b08cff' },
  shield:          { sprite: 'dcss/effect/sanctuary.png',         color: 0x88aaff, label: 'SHIELD',        float: '#88aaff' },
  scorchingRay:    { sprite: 'dcss/effect/searing_ray_0.png',
    frames: ['dcss/effect/searing_ray_0.png','dcss/effect/searing_ray_1.png','dcss/effect/searing_ray_2.png','dcss/effect/searing_ray_3.png','dcss/effect/searing_ray_4.png','dcss/effect/searing_ray_5.png'],
    frameInterval: 0.04,                                        color: 0xff7a30, label: 'SCORCH',        float: '#ff7a30' },
  fireball:        { sprite: 'dcss/effect/cloud_fire_0.png',
    frames: ['dcss/effect/cloud_fire_0.png','dcss/effect/cloud_fire_1.png','dcss/effect/cloud_fire_2.png'],
    frameInterval: 0.05,                                        color: 0xff7a30, label: 'FIREBALL',      float: '#ff7a30' },
  haste:           { sprite: 'dcss/effect/xom_sparkles_blue.png', color: 0xa0e0ff, label: 'HASTE',         float: '#a0e0ff' },
  bless:           { sprite: 'dcss/effect/gold_sparkles_1.png',
    frames: ['dcss/effect/gold_sparkles_1.png','dcss/effect/gold_sparkles_2.png','dcss/effect/gold_sparkles_3.png'],
    frameInterval: 0.07,                                        color: 0xffe08a, label: 'BLESS',         float: '#ffe08a' },
  spiritualWeapon: { sprite: 'dcss/effect/orb_glow_0.png',
    frames: ['dcss/effect/orb_glow_0.png','dcss/effect/orb_glow_1.png'],
    frameInterval: 0.08,                                        color: 0xbfe0ff, label: 'SPIRIT WEAPON', float: '#bfe0ff' },
  spiritGuardians: { sprite: 'dcss/effect/cloud_spectral_0.png',
    frames: ['dcss/effect/cloud_spectral_0.png','dcss/effect/cloud_spectral_1.png','dcss/effect/cloud_spectral_2.png'],
    frameInterval: 0.07,                                        color: 0xd0c0ff, label: 'GUARDIANS',     float: '#d0c0ff' },
  entangle:        { sprite: 'dcss/effect/cloud_magic_trail_0.png',
    frames: ['dcss/effect/cloud_magic_trail_0.png','dcss/effect/cloud_magic_trail_1.png','dcss/effect/cloud_magic_trail_2.png','dcss/effect/cloud_magic_trail_3.png'],
    frameInterval: 0.06,                                        color: 0x4cae4c, label: 'ENTANGLE',      float: '#4cae4c' },
  moonbeam:        { sprite: 'dcss/effect/cloud_cold_0.png',
    frames: ['dcss/effect/cloud_cold_0.png','dcss/effect/cloud_cold_1.png','dcss/effect/cloud_cold_2.png'],
    frameInterval: 0.07,                                        color: 0xc0e8ff, label: 'MOONBEAM',      float: '#c0e8ff' },
  callLightning:   { sprite: 'dcss/effect/zap_0.png',
    frames: ['dcss/effect/zap_0.png','dcss/effect/zap_1.png','dcss/effect/zap_2.png','dcss/effect/zap_3.png'],
    frameInterval: 0.05,                                        color: 0x7090ff, label: 'LIGHTNING',     float: '#7090ff' },
  shatter:         { sprite: 'dcss/effect/sandblast_0.png',
    frames: ['dcss/effect/sandblast_0.png','dcss/effect/sandblast_1.png','dcss/effect/sandblast_2.png'],
    frameInterval: 0.06,                                        color: 0xd0a0ff, label: 'SHATTER',       float: '#d0a0ff' },
  chaosBolt:       { sprite: 'dcss/effect/cloud_chaos_3.png',
    frames: ['dcss/effect/cloud_chaos_3.png','dcss/effect/cloud_chaos_4.png','dcss/effect/cloud_chaos_5.png'],
    frameInterval: 0.05,                                        color: 0xff8844, label: 'CHAOS BOLT',    float: '#ff8844' },
  dragonBreathSpell:{ sprite: 'dcss/effect/cloud_fire_0.png',
    frames: ['dcss/effect/cloud_fire_0.png','dcss/effect/cloud_fire_1.png','dcss/effect/cloud_fire_2.png'],
    frameInterval: 0.06,                                        color: 0xff6020, label: 'BURNING HANDS', float: '#ff6020' },
  hex:             { sprite: 'dcss/effect/drain_red_0.png',
    frames: ['dcss/effect/drain_red_0.png','dcss/effect/drain_red_1.png','dcss/effect/drain_red_2.png'],
    frameInterval: 0.07,                                        color: 0x9b59b6, label: 'HEX',           float: '#9b59b6' },
  armsOfHadar:     { sprite: 'dcss/effect/cloud_gloom_new.png',   color: 0x6a3080, label: 'HADAR',         float: '#6a3080' },
  thunderousSmite: { sprite: 'dcss/effect/zap_0.png',
    frames: ['dcss/effect/zap_0.png','dcss/effect/zap_1.png','dcss/effect/zap_2.png','dcss/effect/zap_3.png'],
    frameInterval: 0.06,                                        color: 0xf1c40f, label: 'THUNDEROUS',    float: '#f1c40f' },
  huntersMark:     { sprite: 'dcss/effect/searing_ray_1.png',     color: 0x1abc9c, label: "HUNTER'S MARK", float: '#1abc9c' },
  /* ── New condition-based spells ── */
  blindness:       { sprite: 'dcss/effect/cloud_black_smoke.png', color: 0x888899, label: 'BLINDED', float: '#888899' },
  holdPerson:      { sprite: 'dcss/effect/silenced.png',         color: 0x8090c0, label: 'PARALYZED', float: '#8090c0' },
  sleep:           { sprite: 'dcss/effect/cloud_yellow_smoke.png', color: 0x6688aa, label: 'SLEEP', float: '#6688aa' },
  fear:            { sprite: 'dcss/effect/cloud_gloom_new.png',   color: 0x9b59b6, label: 'FEAR', float: '#9b59b6' },
  slow:            { sprite: 'dcss/effect/cloud_blue_smoke.png',  color: 0x8fd4e8, label: 'SLOW', float: '#8fd4e8' },
  bane:            { sprite: 'dcss/effect/cloud_neg_1.png',       color: 0xd0a0ff, label: 'BANE', float: '#d0a0ff' },
  faerieFire:      { sprite: 'dcss/effect/cloud_spectral_0.png',
    frames: ['dcss/effect/cloud_spectral_0.png','dcss/effect/cloud_spectral_1.png','dcss/effect/cloud_spectral_2.png'],
    frameInterval: 0.07,                                        color: 0xb08cff, label: 'FAERIE FIRE', float: '#b08cff' },
  rayOfEnfeeblement:{ sprite: 'dcss/effect/cloud_meph_0.png',    color: 0xd0a080, label: 'ENFEEBLED', float: '#d0a080' },
  web:             { sprite: 'dcss/effect/net_trap.png',          color: 0xbfa060, label: 'WEB', float: '#bfa060' },
  hideousLaughter: { sprite: 'dcss/effect/cloud_chaos_1.png',
    frames: ['dcss/effect/cloud_chaos_1.png','dcss/effect/cloud_chaos_2.png'],
    frameInterval: 0.08,                                        color: 0xe8a8ff, label: 'LAUGHTER!', float: '#e8a8ff' },
  lesserRestoration:{ sprite: 'dcss/effect/gold_sparkles_1.png',
    frames: ['dcss/effect/gold_sparkles_1.png','dcss/effect/gold_sparkles_2.png','dcss/effect/gold_sparkles_3.png'],
    frameInterval: 0.07,                                        color: 0x6ae06a, label: 'RESTORED', float: '#6ae06a' },
  greaterRestoration:{ sprite: 'dcss/effect/goldaura_0.png',
    frames: ['dcss/effect/goldaura_0.png','dcss/effect/goldaura_1.png','dcss/effect/goldaura_2.png'],
    frameInterval: 0.06,                                        color: 0xffe08a, label: 'RESTORED!', float: '#ffe08a' },
  protectionFromEvil:{ sprite: 'dcss/effect/sanctuary.png',      color: 0xffe08a, label: 'PROTECTED', float: '#ffe08a' },
  /* ── Extended spell list ── */
  grease:          { sprite: 'dcss/effect/cloud_yellow_smoke.png', color: 0xbfa060, label: 'GREASE', float: '#bfa060' },
  inflictWounds:   { sprite: 'dcss/effect/drain_red_0.png',
    frames: ['dcss/effect/drain_red_0.png','dcss/effect/drain_red_1.png','dcss/effect/drain_red_2.png'],
    frameInterval: 0.06,                                        color: 0xc04040, label: 'WOUNDS', float: '#c04040' },
  acidArrow:       { sprite: 'dcss/effect/acid_venom.png',        color: 0x4cae4c, label: 'ACID', float: '#4cae4c' },
  mistyStep:       { sprite: 'dcss/effect/cloud_blue_smoke.png',  color: 0x8fd4e8, label: 'MISTY STEP', float: '#8fd4e8' },
  silence:         { sprite: 'dcss/effect/silenced.png',          color: 0x888899, label: 'SILENCE', float: '#888899' },
  bestowCurse:     { sprite: 'dcss/effect/cloud_neg_0.png',
    frames: ['dcss/effect/cloud_neg_0.png','dcss/effect/cloud_neg_1.png','dcss/effect/cloud_neg_2.png'],
    frameInterval: 0.06,                                        color: 0x9b59b6, label: 'CURSED', float: '#9b59b6' },
  lightningBolt:   { sprite: 'dcss/effect/zap_0.png',
    frames: ['dcss/effect/zap_0.png','dcss/effect/zap_1.png','dcss/effect/zap_2.png','dcss/effect/zap_3.png'],
    frameInterval: 0.05,                                        color: 0x7090ff, label: 'BOLT!', float: '#7090ff' },
  massHealingWord: { sprite: 'dcss/effect/gold_sparkles_1.png',
    frames: ['dcss/effect/gold_sparkles_1.png','dcss/effect/gold_sparkles_2.png','dcss/effect/gold_sparkles_3.png'],
    frameInterval: 0.07,                                        color: 0x6ae06a, label: 'HEAL', float: '#6ae06a' },
  vampiricTouch:   { sprite: 'dcss/effect/drain_red_0.png',
    frames: ['dcss/effect/drain_red_0.png','dcss/effect/drain_red_1.png','dcss/effect/drain_red_2.png'],
    frameInterval: 0.06,                                        color: 0xc04040, label: 'DRAIN', float: '#c04040' },
  iceStorm:        { sprite: 'dcss/effect/cloud_cold_0.png',
    frames: ['dcss/effect/cloud_cold_0.png','dcss/effect/cloud_cold_1.png','dcss/effect/cloud_cold_2.png'],
    frameInterval: 0.06,                                        color: 0x7fd4ff, label: 'ICE STORM', float: '#7fd4ff' },
  blight:          { sprite: 'dcss/effect/cloud_neg_0.png',
    frames: ['dcss/effect/cloud_neg_0.png','dcss/effect/cloud_neg_1.png','dcss/effect/cloud_neg_2.png'],
    frameInterval: 0.05,                                        color: 0x6a3080, label: 'BLIGHT', float: '#6a3080' },
  deathWard:       { sprite: 'dcss/effect/sanctuary.png',         color: 0xffe08a, label: 'WARDED', float: '#ffe08a' },
  wallOfFire:      { sprite: 'dcss/effect/cloud_fire_0.png',
    frames: ['dcss/effect/cloud_fire_0.png','dcss/effect/cloud_fire_1.png','dcss/effect/cloud_fire_2.png'],
    frameInterval: 0.05,                                        color: 0xff6020, label: 'FIRE WALL', float: '#ff6020' },
  coneOfCold:      { sprite: 'dcss/effect/frost_0.png',
    frames: ['dcss/effect/frost_0.png','dcss/effect/frost_1.png'],
    frameInterval: 0.07,                                        color: 0x7fd4ff, label: 'CONE OF COLD', float: '#7fd4ff' },
  flameStrike:     { sprite: 'dcss/effect/flame_0.png',
    frames: ['dcss/effect/flame_0.png','dcss/effect/flame_1.png','dcss/effect/flame_2.png'],
    frameInterval: 0.05,                                        color: 0xffd34a, label: 'FLAME STRIKE', float: '#ffd34a' },
  massCureWounds:  { sprite: 'dcss/effect/goldaura_0.png',
    frames: ['dcss/effect/goldaura_0.png','dcss/effect/goldaura_1.png','dcss/effect/goldaura_2.png'],
    frameInterval: 0.06,                                        color: 0x6ae06a, label: 'CURED!', float: '#6ae06a' },
  holdMonster:     { sprite: 'dcss/effect/silenced.png',          color: 0x8090c0, label: 'HELD', float: '#8090c0' },
};

import { SPELLS } from './spells.js';
import { applyEffect, clearEffect, hasEffect, getEffect, getEffectMods, tickEffects, clearAllEffects, rollSave } from './conditions.js';

export const combatMethods = {
  /* ── FX bridge methods (called by spells.js cast() functions) ── */
  _v3(x, y, z) { return new THREE.Vector3(x, y, z); },
  fxSprite(path, pos, scale, dur) { spawnSpriteEffect(this.engine.scene, path, pos, scale, dur); },
  fxProjectile(from, to, kind, color, onHit) { spawnProjectile(this.engine.scene, from, to, kind, color, onHit); },
  fxSlash(pos, color, size) { spawnSlash(this.engine.scene, pos, color, size); },
  fxText(text, pos, color) { makeFloatText(this.engine.scene, text, pos, color); },
  fxLog(msg, style) { log(msg, style); },
  tickEffectsOn(e) { tickEffects(e, this.elapsed); },

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
    const scale = opts.scale || 1.5;
    const dur = opts.dur || 0.45;

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
    return threshold !== 'high';
  },

  pickHeroTarget(h, alive) {
    /* targetPref: 0 = focus lowest-CR foe (clear trash first), 1 = focus highest-CR
       foe (engage the boss/biggest threat), 0.5 = near-random. Randomization peaks
       at 0.5 and vanishes at the extremes so the slider ends stay deterministic.
       CR (m.data.cr) is the monster's difficulty-budget value. */
    const pref = h.data.aiPrefs && h.data.aiPrefs.targetPref != null ? h.data.aiPrefs.targetPref : 0.5;
    const cands = [];
    for (const m of this.monsters) {
      if (m.data.hp <= 0 || !m.active) continue;
      const dd = Math.hypot(m.x - h.x, m.z - h.z);
      if (dd < 13) cands.push({ m, dd, cr: (m.data.cr != null ? m.data.cr : 0) });
    }
    if (!cands.length) return null;
    if (cands.length === 1) return cands[0].m;
    let minCr = Infinity, maxCr = -Infinity;
    for (const c of cands) { if (c.cr < minCr) minCr = c.cr; if (c.cr > maxCr) maxCr = c.cr; }
    const span = maxCr - minCr;
    const noiseW = 1 - Math.abs(pref - 0.5) * 2;   // 0 at pref=0/1, 1 at pref=0.5
    let best = null, bestScore = -1e9;
    for (const c of cands) {
      const crNorm = span > 1e-6 ? (c.cr - minCr) / span : 0;
      const det = crNorm * (2 * pref - 1);         // pref=0 -> -crNorm (low CR wins); pref=1 -> +crNorm
      const noise = (Math.random() - 0.5) * noiseW;
      const score = det + noise - c.dd * 0.02;      // small distance tiebreak keeps heroes local
      if (score > bestScore) { bestScore = score; best = c.m; }
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
      anchor = alive[0];
      if (h === anchor || Math.hypot(h.x - anchor.x, h.z - anchor.z) < 1.2) { h.moving = false; return; }
    }
    const goal = this.nearFloorCell(this.cellOf(anchor.x, anchor.z), 2);
    if (goal < 0) { h.moving = false; return; }
    h.repathT -= dt;
    if (h.repathT <= 0 || !h.path || h.pathI >= h.path.length || h.pathGoal !== goal) {
      h.path = this.findPath(this.cellOf(h.x, h.z), goal);
      h.pathI = 0; h.repathT = 0.6; h.pathGoal = goal;
    }
    h.moving = this.stepAlong(h, HERO_SPEED * 1.05 * h.data.speedMult * this.hasteMult(h), dt);
    if (!h.moving) {
      if (this.handleStuck) this.handleStuck(h, alive[0], dt);
      else { h.stuckT = 0; h.stuckStage = 0; }
    } else { h.stuckT = 0; h.stuckStage = 0; }
  },

  heroCombat(h, foe, alive, dt) {
    const cls = CLASSES[h.data.classKey];
    const atk = cls.attack;
    const dist = Math.hypot(foe.x - h.x, foe.z - h.z);
    /* Per-hero AI priority knobs (see menus.js AI Priorities tab). */
    const ai = h.data.aiPrefs || {};
    const abilityUse = ai.abilityUse != null ? ai.abilityUse : 0.5;
    const cm = ai.combatMovement != null ? ai.combatMovement : 0.5;
    /* Initiative gate: only the current actor's cooldown may reach "ready";
       off-turn heroes stay frozen (they still move via combatMove below). */
    if (this.initiative && this.initiative.active && !this.isCurrentActor(h)) {
      if (h.cd < 0.05) h.cd = 0.05;
    } else {
      h.cd -= dt;
    }

    // Track combat engagement for pacing / staggering
    if (!this._combatEngagedAt) this._combatEngagedAt = this.elapsed;
    h._abilityUsedThisCycle = false;

    /* Defensive/buff reflexes are "abilities" — skip entirely at 0% ability-use. */
    if (abilityUse > 0) this.runCombatReflexes(h, alive, foe);

    const inRange = dist <= atk.range && (atk.melee || this.hasLOS(h.x, h.z, foe.x, foe.z));
    if (!inRange) {
      /* combatMovement: low values make the hero hold position instead of chasing
         across the room. chaseRange runs from just beyond melee reach (cm=0) up to
         the full 13-unit engagement range (cm=1). */
      const baseReach = atk.range + 1.5;
      const chaseRange = baseReach + (13 - baseReach) * cm;
      if (dist > chaseRange) {
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
      h.moving = this.stepAlong(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt);

      /* multi-stage stuck recovery during combat */
      if (!h.moving && h !== alive[0]) {
        h.stuckT = (h.stuckT || 0) + dt;
        h.stuckStage = h.stuckStage || 0;

        /* Stage 1: lateral dodge perpendicular to foe */
        if (h.stuckStage === 0 && h.stuckT > STUCK_SIDESTEP_T) {
          h.stuckStage = 1;
          const perpX = -(foe.z - h.z), perpZ = (foe.x - h.x);
          const d = Math.hypot(perpX, perpZ) || 1;
          const sx = h.x + (perpX / d) * STUCK_SIDESTEP_DIST;
          const sz = h.z + (perpZ / d) * STUCK_SIDESTEP_DIST;
          if (!this.blocked(sx, sz, 0.3)) {
            h.x = sx; h.z = sz; h.path = null;
            h.stuckT = 0; h.stuckStage = 0;
          } else {
            const sx2 = h.x - (perpX / d) * STUCK_SIDESTEP_DIST;
            const sz2 = h.z - (perpZ / d) * STUCK_SIDESTEP_DIST;
            if (!this.blocked(sx2, sz2, 0.3)) {
              h.x = sx2; h.z = sz2; h.path = null;
              h.stuckT = 0; h.stuckStage = 0;
            }
          }
        }

        /* Stage 2: force repath */
        if (h.stuckStage === 1 && h.stuckT > 1.2) {
          h.stuckStage = 2;
          h.path = null;
        }

        /* Stage 3: teleport (last resort) */
        if (h.stuckStage >= 2 && h.stuckT > STUCK_TELEPORT_T) {
          h.stuckT = 0; h.stuckStage = 0;
          const leader = alive[0];
          h.x = leader.x + (Math.random() - 0.5) * 0.5;
          h.z = leader.z + (Math.random() - 0.5) * 0.5;
          h.path = null;
          log(`✨ Teleported ${h.data.name} to join combat.`, 'sys');
        }
      } else {
        h.stuckT = 0; h.stuckStage = 0;
      }
      return;
    } else {
      h.stuckT = 0; h.stuckStage = 0;
    }

    /* In-range tactical repositioning (ring around the foe). Low combatMovement
       suppresses the dance — the hero plants and attacks from where it engaged. */
    if (cm > 0.12) {
      this.combatMove(h, foe, atk, dt);
    } else {
      h.combatFoe = foe;
    }
    h.ent.grp.rotation.y = Math.atan2(foe.x - h.x, foe.z - h.z);
    if (h.cd > 0) return;

    /* AI potion: if this hero's HP is below their potionThreshold, drink from the
       shared stash. Costs the turn just like an attack. potionThreshold=0 => never. */
    {
      const pt = ai.potionThreshold != null ? ai.potionThreshold : 0.5;
      if (pt > 0 && h.data.hp > 0 && h.data.hp / h.data.maxHp < pt) {
        const kind = this.potions.heal > 0 ? 'heal'
          : (this.potions.greater > 0 ? 'greater' : null);
        if (kind) {
          this.potions[kind]--;
          const amt = kind === 'greater' ? roll(4, 4, 4) : roll(2, 4, 2);
          h.data.hp = Math.min(h.data.maxHp, h.data.hp + amt);
          makeFloatText(this.engine.scene, '+' + amt, _v.set(h.x, 1.3, h.z), '#6ae0ff');
          log(`🧪 ${h.data.name} drinks a potion (+${amt}).`, 'heal');
          drawBar(h.ent.bar, h.data.hp / h.data.maxHp);
          updatePartyFrames(this.heroes.map(x => x.data));
          updateResources(this);
          h.cd = HERO_ATTACK_CD;
          return;
        }
      }
    }

    /* heal threshold scales with abilityUse: 0.5 ≈ original (0.45), liberal tops off
       sooner, conservative waits. Blocked entirely at abilityUse=0. */
    const healThresh = 0.2 + 0.5 * abilityUse;

    /* healers: heal a badly-hurt ally instead of attacking */
    if (abilityUse > 0 && cls.healer && h.data.healSlots > 0) {
      let worst = null, wf = healThresh;
      for (const a of alive) { const f = a.data.hp / a.data.maxHp; if (f < wf) { wf = f; worst = a; } }
      if (worst) {
        h.cd = HERO_ATTACK_CD;
        h.data.healSlots--;
        const ab = cls.attack.ability === 'cha' ? 'cha' : 'wis';
        const amt = roll(1, 8, mod(h.data.effStats[ab]) + h.data.healBonus);
        worst.data.hp = Math.min(worst.data.maxHp, worst.data.hp + amt);
        this.playAbilityFx(h, 'cureWounds', { at: worst, spell: true });
        makeFloatText(this.engine.scene, '+' + amt, _v.set(worst.x, 1.55, worst.z), '#6ae06a');
        log(`${h.data.name} casts Cure Wounds on ${worst.data.name} (+${amt}).`, 'heal');
        drawBar(worst.ent.bar, worst.data.hp / worst.data.maxHp);
        this.refreshAbilityHud();
        return;
      }
    }

    /* Lay on Hands (paladin) */
    if (abilityUse > 0 && hasFeature(h.data, 'layOnHands') && (h.data.layOnHands || 0) > 0) {
      let worst = null, wf = healThresh;
      for (const a of alive) { const f = a.data.hp / a.data.maxHp; if (f < wf) { wf = f; worst = a; } }
      if (worst) {
        const spend = Math.min(h.data.layOnHands, 10 + h.data.level);
        h.data.layOnHands -= spend;
        h.cd = HERO_ATTACK_CD;
        this.healHero(worst, spend + h.data.healBonus);
        this.playAbilityFx(h, 'layOnHands', { at: worst, spell: true });
        log(`🙏 ${h.data.name} uses Lay on Hands on ${worst.data.name} (+${spend}).`, 'heal');
        this.refreshAbilityHud();
        return;
      }
    }

    h.cd = HERO_ATTACK_CD;

    /* known spells (learned via progression) */
    const sc = subclassOf(h.data);
    if (abilityUse > 0) {
      if (this.tryCastKnownSpell(h, foe, alive)) return;
      if (sc && this.castSubclassSpell(h, sc, foe, alive)) return;
    }

    const opts = this.buildAttackOpts(h, foe, sc);
    this.heroAttackRoll(h, foe, alive, opts);

    /* Extra Attack / Improved Extra Attack */
    let attacks = 1;
    if (hasFeature(h.data, 'extraAttack2')) attacks = 3;
    else if (hasFeature(h.data, 'extraAttack')) attacks = 2;
    for (let i = 1; i < attacks && foe.data.hp > 0; i++) {
      this.heroAttackRoll(h, foe, alive, {});
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
      this.heroAttackRoll(h, foe, alive, {});
      this.refreshAbilityHud();
    }

    /* Flurry of Blows — only when foe is worth the effort */
    else if (abilityUse > 0 && hasFeature(h.data, 'flurryOfBlows') && !h.data.abilityUsed.short && foe.data.hp > 0
        && h.data.hp < h.data.maxHp * 0.7 && surgeWorthy && !h._abilityUsedThisCycle) {
      h.data.abilityUsed.short = true; h._abilityUsedThisCycle = true;
      this.playAbilityFx(h, 'flurry', { at: foe });
      log(`👊 ${h.data.name} uses Flurry of Blows!`, 'crit');
      this.heroAttackRoll(h, foe, alive, {});
      this.refreshAbilityHud();
    }

    /* Berserker frenzy — free extra attack, don't waste on near-dead foes */
    else if (abilityUse > 0 && sc && sc.active.key === 'frenzy' && !h.data.abilityUsed.short && foe.data.hp > 0
        && h.raging && foe.data.hp / Math.max(foe.data.maxHp, 1) > 0.35 && !h._abilityUsedThisCycle) {
      h.data.abilityUsed.short = true; h._abilityUsedThisCycle = true;
      this.playAbilityFx(h, 'frenzy', { at: foe });
      log(`😤 ${h.data.name} frenzies — another strike!`, 'crit');
      this.heroAttackRoll(h, foe, alive, {});
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

    /* ── Second Wind — immediate save if critically low ── */
    if ((d.secondWind || hasFeature(d, 'secondWind')) && !d.secondWindUsed && d.hp < d.maxHp * 0.3) {
      d.secondWindUsed = true; h._abilityUsedThisCycle = true;
      const amt = roll(1, 10, d.level);
      d.hp = Math.min(d.maxHp, d.hp + amt);
      this.playAbilityFx(h, 'secondWind', { at: h });
      makeFloatText(this.engine.scene, '+' + amt, _v.set(h.x, 1.55, h.z), '#6ae06a');
      drawBar(h.ent.bar, d.hp / d.maxHp);
      log(`${d.name} catches a second wind (+${amt}).`, 'heal');
      hudDirty = true;
    }

    /* ── Cunning Action — dodge when bloodied ── */
    else if (!h._abilityUsedThisCycle) {
      const cunning = hasFeature(d, 'cunningActionClass') || (sc && sc.active.key === 'cunningAction');
      if (cunning && !d.abilityUsed.short && d.hp < d.maxHp * 0.35) {
        d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
        applyEffect(h, 'hasted', { duration: 30, elapsed: this.elapsed });
        this.playAbilityFx(h, 'cunningAction', { at: h });
        log(`💨 ${d.name} uses Cunning Action — darting clear! (+4 AC, +40% speed)`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Fast Hands (Thief subclass active) — smoke bomb blinding nearby foes ── */
    else if (!h._abilityUsedThisCycle) {
      if (sc && sc.active.key === 'fastHands' && !d.abilityUsed.short
          && this.monsters.some(m => m.data.hp > 0 && Math.hypot(m.x - h.x, m.z - h.z) < 4.0)) {
        d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
        this.playAbilityFx(h, 'fastHands', { at: h });
        log(`💨 ${d.name} uses Fast Hands to throw a smoke bomb!`, 'heal');
        for (const m of this.monsters) {
          if (m.data.hp > 0 && Math.hypot(m.x - h.x, m.z - h.z) < 4.0) {
            applyEffect(m, 'blinded', { duration: 6, elapsed: this.elapsed, source: h });
            makeFloatText(this.engine.scene, 'BLINDED', _v.set(m.x, 1.3, m.z), '#888899');
          }
        }
        hudDirty = true;
      }
    }

    /* ── Remarkable Athlete (Champion subclass active) ── */
    else if (!h._abilityUsedThisCycle) {
      if (sc && sc.active.key === 'remarkableAthlete' && !d.abilityUsed.short
          && this._combatStable(1.5)) {
        d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
        applyEffect(h, 'remarkableAthlete', { duration: 30, elapsed: this.elapsed });
        this.playAbilityFx(h, 'remarkableAthlete', { at: h });
        log(`🏃 ${d.name} uses Remarkable Athlete — physical peak reached! (+2 AC, +10% speed)`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Rage — only after combat has been going a bit ── */
    else if (!h._abilityUsedThisCycle) {
      if (hasFeature(d, 'rage') && !d.rageUsed && d.hp < d.maxHp * 0.45
          && this._combatStable(1.2)) {
        d.rageUsed = true; h._abilityUsedThisCycle = true;
        applyEffect(h, 'raging', { duration: 30, elapsed: this.elapsed });
        this.playAbilityFx(h, 'rage', { at: h, scale: 1.7 });
        log(`😡 ${d.name} enters a Rage!`, 'crit');
        hudDirty = true;
      }
    }

    /* ── Bear Totem — emergency DR for bear barbarians ── */
    else if (!h._abilityUsedThisCycle) {
      if (sc && sc.active.key === 'bearTotem' && !d.abilityUsed.short && d.hp < d.maxHp * 0.35) {
        d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
        applyEffect(h, 'bearTotem', { duration: 30, elapsed: this.elapsed });
        this.playAbilityFx(h, 'bearTotem', { at: h, scale: 1.6 });
        log(`🐻 ${d.name} summons the Bear Totem — damage halved!`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Bardic Inspiration — don't inspire in the first 2s, wait for real trouble ── */
    else if (!h._abilityUsedThisCycle) {
      if (hasFeature(d, 'bardicInspiration') && !d.abilityUsed.short && alive.length >= 2
          && this._combatStable(2.0)) {
        const anyHurt = alive.some(a => a.data.hp < a.data.maxHp * 0.6);
        if (anyHurt) {
          d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
          for (const a of alive)
            applyEffect(a, 'inspired', { duration: 30, elapsed: this.elapsed });
          this.playAbilityFx(h, 'bardic', { at: h, alsoAt: alive, spell: true });
          log(`🎵 ${d.name} inspires the party! (+1d4 to hit)`, 'heal');
          hudDirty = true;
        }
      }
    }

    /* ── Wild Shape — druid panic button ── */
    else if (!h._abilityUsedThisCycle) {
      if (hasFeature(d, 'wildShapeClass') && !d.abilityUsed.short && d.hp < d.maxHp * 0.4) {
        d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
        applyEffect(h, 'wildShape', { duration: 30, elapsed: this.elapsed });
        h.tempHp = (h.tempHp || 0) + 15 + d.level;
        this.playAbilityFx(h, 'wildShape', { at: h, scale: 1.8 });
        log(`🐻 ${d.name} Wild Shapes! (+temp HP, fierce claws)`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Combat Inspiration (Valor bard) — requires combat to be underway ── */
    else if (!h._abilityUsedThisCycle) {
      if (sc && sc.active.key === 'combatInspiration' && !d.abilityUsed.short
          && this._combatStable(2.5) && alive.length >= 2) {
        const anyHurt = alive.some(a => a.data.hp < a.data.maxHp * 0.65);
        if (anyHurt) {
          d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
          for (const a of alive)
            applyEffect(a, 'inspired', { duration: 30, elapsed: this.elapsed });
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
        log(`🗡 ${d.name} lines up a Deathstrike!`, 'crit');
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
        applyEffect(h, 'sacredWeapon', { duration: 30, elapsed: this.elapsed });
        this.playAbilityFx(h, 'sacredWeapon', { at: h, spell: true });
        log(`✨ ${d.name} blesses their weapon!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'colossusSlayer' && foe.data.hp < foe.data.maxHp
          && this._worthSpending(h, foe, null, 'low')) {
        d.abilityUsed.short = true; opts.extraDmg = roll(1, 8);
        this.playAbilityFx(h, 'colossusSlayer', { at: foe });
        log(`🏹 ${d.name}'s Colossus Slayer finds the wound!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'companionStrike' && stable
          && this._worthSpending(h, foe, null, 'normal')) {
        d.abilityUsed.short = true; opts.extraDmg = roll(1, 8, 3);
        this.playAbilityFx(h, 'companionStrike', { at: foe });
        log(`🐺 ${d.name}'s companion strikes!`, 'crit');
        hudDirty = true;
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
    return opts;
  },

  /* one d20 attack roll + resolution (extracted so Action Surge can repeat it) */
  heroAttackRoll(h, foe, alive, opts = {}) {
    const cls = CLASSES[h.data.classKey];

    /* 5e advantage/disadvantage: sum sources, roll 2d20 take high/low */
    const selfMods = getEffectMods(h);
    const foeMods = getEffectMods(foe);
    let adv = opts.adv || 0;
    if (foeMods.defAdvantage) adv += 1;        // foe blinded / paralyzed / faerie-fired…
    if (selfMods.atkDisadvantage) adv -= 1;    // attacker poisoned / frightened / prone…
    let d20 = d20Roll(adv);
    if (d20 === 1 && RACES[h.data.raceKey].lucky) d20 = die(20);
    let atkBonus = heroAttackBonus(h.data) + (opts.atkBonus || 0) + selfMods.atkBonus;
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
    if (!miss && foeMods.autoCritMelee && cls.attack.melee) crit = true;
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
      dmg = heroDamage(h.data, wasCrit) + (opts.extraDmg || 0);
      if (wasCrit && hasFeature(h.data, 'brutalCritical') && cls.attack.melee) {
        dmg += die(cls.attack.dmg[1] || 6);
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
      if (hasFeature(h.data, 'agonizingBlast') && cls.attack.cantripScale) {
        dmg += mod(h.data.effStats.cha);
      }
      /* Legendary perk pre-damage modifiers (execute, first strike, crit surge) */
      dmg = this.applyPerkDamageMods(h, foe, dmg, wasCrit);
      if (intel) dmg = Math.round(dmg * 1.25);
    }
    const advTag = adv > 0 ? ', adv' : adv < 0 ? ', dis' : '';
    const vs = `(${d20}+${atkBonus} vs AC ${foeAc}${advTag})`;
    if (crit && !miss) log(`💥 ${h.data.name} crits ${foe.data.name}! ${opts.autoCrit ? '(Deathstrike)' : `(nat ${d20})`} — ${dmg} dmg${sneak ? ' +sneak' : ''}`, 'crit');
    else if (miss) log(`${h.data.name} → ${foe.data.name}: ${total} ${vs} miss`, 'miss');
    else log(`${h.data.name} → ${foe.data.name}: ${total} ${vs} hit, ${dmg} dmg${sneak ? ' +sneak' : ''}`, 'roll');
    this.strike(h, foe, dmg, crit && !miss, miss, alive);
  },

  /** Pre-hit damage multipliers/adders from equipped legendary perks. */
  applyPerkDamageMods(h, foe, dmg, crit) {
    let d = dmg;
    const perks = equippedPerks(h.data);
    for (const { perk } of perks) {
      if (perk.id === 'execute' && foe.data.maxHp > 0 && foe.data.hp / foe.data.maxHp < 0.30) {
        d = Math.round(d * 1.35);
        makeFloatText(this.engine.scene, 'EXECUTE', _v.set(foe.x, 1.4, foe.z), '#e8a83f');
      }
      if (perk.id === 'firstStrike' && !h._foughtThisCombat) {
        d = Math.round(d * 1.50);
        makeFloatText(this.engine.scene, 'FIRST STRIKE', _v.set(foe.x, 1.5, foe.z), '#8fd4e8');
      }
      if (perk.id === 'critSurge' && crit) {
        d += 4;
      }
    }
    return Math.max(0, d);
  },

  /** On-hit legendary perk procs (lifesteal, cleave, burn, chain, mana font). */
  applyOnHitPerks(h, foe, dmg, crit, alive) {
    if (dmg <= 0 || foe.dead) return;
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
        const heal = Math.max(1, Math.round(dmg * 0.18));
        h.data.hp = Math.min(h.data.maxHp, h.data.hp + heal);
        makeFloatText(this.engine.scene, `+${heal}`, _v.set(h.x, 1.35, h.z), '#e07070');
        drawBar(h.ent.bar, h.data.hp / h.data.maxHp);
      }

      if (id === 'cleave' && CLASSES[h.data.classKey].attack.melee) {
        const splash = Math.max(1, Math.round(dmg * 0.45));
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
        const tickDmg = Math.max(1, 1 + Math.floor(h.data.level / 3));
        foe.burn = { ticks, dmg: tickDmg, src: h, t: 0 };
        makeFloatText(this.engine.scene, 'BURN', _v.set(foe.x, 1.2, foe.z), '#ff7a30');
        spawnSpriteEffect(this.engine.scene, 'dcss/effect/flame_0.png',
          new THREE.Vector3(foe.x, 0.5, foe.z), 0.9, 0.25);
      }

      if (id === 'chain' && !CLASSES[h.data.classKey].attack.melee && Math.random() < 0.40) {
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

      if (id === 'manaFont' && Math.random() < 0.15) {
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
  },

  /** Defensive perks when a hero takes damage (thorns, riposte). */
  applyOnDamagedPerks(h, attacker, dealt) {
    if (!attacker || dealt <= 0 || attacker.dead) return;
    const perks = equippedPerks(h.data, 'onDamaged');
    const seen = new Set();
    for (const { perk } of perks) {
      if (seen.has(perk.id)) continue;
      seen.add(perk.id);
      if (perk.id === 'thorns') {
        const thornDmg = 2 + Math.floor(h.data.level / 3);
        attacker.data.hp -= thornDmg;
        makeFloatText(this.engine.scene, String(thornDmg), _v.set(attacker.x, 1.1, attacker.z), '#6aea6a');
        if (attacker.data.hp <= 0) this.killMonster(attacker, h);
      }
      if (perk.id === 'riposte' && CLASSES[h.data.classKey].attack.melee) {
        const ret = 3 + Math.floor(h.data.level / 2);
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
    const perks = equippedPerks(h.data, 'onKill');
    for (const { perk } of perks) {
      if (perk.id === 'phaseStep') {
        h.phaseStepUntil = this.elapsed + 3;
        makeFloatText(this.engine.scene, 'PHASE', _v.set(h.x, 1.4, h.z), '#8fd4e8');
        log(`◈ ${h.data.name}'s Phase Step grants +4 AC briefly.`, 'heal');
      }
    }
  },

  /* ── Concentration (5e): one concentration spell per caster ────────
     Casting a new concentration spell ends the old one; taking damage
     forces a CON save (DC = max(10, half the damage)); going down ends it. */

  /**
   * Register a caster's concentration on a spell.
   * @param {object} h caster entity
   * @param {string} spellKey SPELLS registry key
   * @param {Array<{e:object, key:string}>} applied effects this spell placed
   */
  concentrate(h, spellKey, applied) {
    this.breakConcentration(h, 'casting another spell');
    h.conc = { key: spellKey, targets: applied || [] };
  },

  breakConcentration(h, reason) {
    if (!h.conc) return;
    const label = SPELLS[h.conc.key]?.label || h.conc.key;
    for (const t of h.conc.targets) {
      if (t && t.e) clearEffect(t.e, t.key);
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

  /* Idle AI: pick the best known spell for this moment.
   *   Now conservative — "any" spells gate behind combat time + threat,
   *   elite/boss spells check threat, and nearly-dead targets are skipped. */
  tryCastKnownSpell(h, foe, alive) {
    const known = h.data.knownSpells || [];
    if (!known.length) return false;

    /* heal thresholds follow the hero's abilityUse knob (0.5 ≈ original). */
    const _w = h.data.aiPrefs && h.data.aiPrefs.abilityUse != null ? h.data.aiPrefs.abilityUse : 0.5;
    const healThresh = 0.2 + 0.5 * _w;

    let best = null, bestP = -1;
    for (const key of known) {
      const sp = SPELLS[key];
      if (!sp || !this.canUseSpellRecharge(h, sp)) continue;
      /* already concentrating on this spell — don't waste a slot recasting it */
      if (sp.concentration && h.conc?.key === key) continue;
      const ai = sp.ai || { when: 'any', priority: 1 };
      let ok = false;
      if (ai.when === 'any') {
        // "Any" spells (Bless, Chaos Bolt) are always eligible — but we gate
        // them behind combat stability + threat so they aren't wasted on trash.
        ok = this._combatStable(ai.minCombatSec || 2.0)
          && this._worthSpending(h, foe, alive, 'low');
      }
      else if (ai.when === 'eliteOrBoss') {
        ok = (foe.isBoss || this.monsterEliteRoom(foe) || foe.data.hp >= 15)
          && this._worthSpending(h, foe, alive, 'normal');
      }
      else if (ai.when === 'selfHurt') ok = h.data.hp / h.data.maxHp < (ai.hpFrac != null ? ai.hpFrac : healThresh);
      else if (ai.when === 'hurtAlly') {
        ok = alive.some(a => a.data.hp / a.data.maxHp < (ai.hpFrac != null ? ai.hpFrac : healThresh));
      } else if (ai.when === 'cluster') {
        const n = this.monsters.filter(m => m.data.hp > 0 && m.active && Math.hypot(m.x - foe.x, m.z - foe.z) < 2.2).length;
        ok = n >= (ai.minTargets || 3);
      }
      if (ok && ai.priority > bestP) { bestP = ai.priority; best = key; }
    }
    if (!best) return false;
    // Final guard: don't cast at a foe that's one hit from death (unless it's a defensive/urgent spell)
    const sp = SPELLS[best];
    if (sp && sp.ai && sp.ai.when !== 'selfHurt' && sp.ai.when !== 'hurtAlly'
        && foe.data.hp / Math.max(foe.data.maxHp, 1) < 0.25 && foe.data.hp < 8) {
      return false;
    }
    return this.resolveSpell(h, best, foe, alive);
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
      return this.resolveSpell(h, 'fireball', foe, alive);
    }
    if (key === 'magicMissile' && hasSlotFor(d, 1)
        && (foe.isBoss || this.monsterEliteRoom(foe) || foe.data.hp >= 15)
        && this._worthSpending(h, foe, alive, 'normal')) {
      return this.resolveSpell(h, 'magicMissile', foe, alive);
    }
    if (key === 'dragonBreath' && !d.abilityUsed.short && this._combatStable(1.0)) {
      const foes = this.monsters.filter(m => m.data.hp > 0 && m.active && Math.hypot(m.x - h.x, m.z - h.z) < 3);
      if (foes.length >= 2) {
        d.abilityUsed.short = true;
        this.playAbilityFx(h, 'dragonBreath', { at: h, alsoAt: foes, scale: 2.2, ring: 2.2 });
        log(`🐉 ${d.name} breathes fire!`, 'crit');
        for (const m of foes) this.damageMonster(m, roll(3, 6, d.dmgBonus), h, false);
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
      foe.cutWordsUntil = this.elapsed + 6;
      foe.data._acPenalty = 4;
      this.playAbilityFx(h, 'cuttingWords', { at: foe, spell: true });
      log(`🎤 ${d.name} uses Cutting Words on ${foe.data.name}!`, 'crit');
      this.refreshAbilityHud();
      return true;
    }
    if (key === 'fiendishBlessing' && !d.abilityUsed.short
        && this._combatStable(1.8) && d.hp < d.maxHp * 0.8) {
      d.abilityUsed.short = true;
      h.tempHp = (h.tempHp || 0) + 10;
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
      h.tempHp = (h.tempHp || 0) + 20;
      this.playAbilityFx(h, 'wildShape', { at: h, scale: 1.9 });
      log(`🐻 ${d.name} Wild Shapes into a bear!`, 'heal');
      this.refreshAbilityHud();
      return true;
    }
    return false;
  },

  healHero(a, amt) {
    if (a.data.hp <= 0) return;
    a.data.hp = Math.min(a.data.maxHp, a.data.hp + amt);
    makeFloatText(this.engine.scene, '+' + amt, _v.set(a.x, 1.3, a.z), '#6ae06a');
    drawBar(a.ent.bar, a.data.hp / a.data.maxHp);
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
        const n = Math.max(1, this.heroes.length - 1);
        h.anchorAngle = centerAng + (idx / n - 0.5) * 2.8 + (Math.random() - 0.5) * 0.25;
      }
      h.swayPhase = Math.random() * 6.28;
      h.swayDir = Math.random() < 0.5 ? -1 : 1;
    }
    const desiredR = atk.melee ? 1.05 : Math.max(2.6, Math.min(atk.range - 0.8, atk.range * 0.6));
    const ang = h.anchorAngle + Math.sin(this.elapsed * 0.75 + h.swayPhase) * 0.55 * h.swayDir;
    const r = desiredR + Math.sin(this.elapsed * 1.15 + h.swayPhase) * 0.22;
    let tx = foe.x + Math.cos(ang) * r;
    let tz = foe.z + Math.sin(ang) * r;
    let moved = false;
    if (!this.blocked(tx, tz, 0.3)) {
      moved = true;
    } else {
      /* slot landed in a wall — probe angle + radius variations */
      const probeRadii = [desiredR, desiredR * 0.75, desiredR * 1.3, desiredR * 0.55];
      const probeAngles = [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4];
      outer:
      for (const pr of probeRadii) {
        for (const dAng of probeAngles) {
          const ax = foe.x + Math.cos(ang + dAng) * pr;
          const az = foe.z + Math.sin(ang + dAng) * pr;
          if (!this.blocked(ax, az, 0.3)) { tx = ax; tz = az; moved = true; break outer; }
        }
      }
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
      h.moving = this.nudgeToward(h, tx, tz, HERO_SPEED * COMBAT_SPEED * h.data.speedMult * this.hasteMult(h), dt);
    } else {
      h.moving = false;
    }
  },

  hasteMult(h) { const mods = getEffectMods(h); return mods.speedMul > 1 ? mods.speedMul : 1; },
  heroAC(h) {
    let ac = h.data.ac;
    const mods = getEffectMods(h);
    ac += mods.acBonus;
    if (hasEffect(h, 'raging')) ac += 2; // redundant with mods, kept for clarity
    return ac;
  },

  /** Incoming damage after rage / totem / uncanny dodge / temp HP. */
  applyIncomingDamage(h, dmg) {
    let d = dmg;
    const mods = getEffectMods(h);
    d = Math.round(d * mods.dmgTakenMul);
    if (hasFeature(h.data, 'uncannyDodge') && !h.uncannyUsed) {
      h.uncannyUsed = true;
      d = Math.ceil(d / 2);
    }
    if (h.tempHp > 0) {
      const absorb = Math.min(h.tempHp, d);
      h.tempHp -= absorb;
      d -= absorb;
    }
    /* Death Ward: if hit would be lethal, survive at 1 HP instead */
    if (hasEffect(h, 'deathWarded') && d >= h.data.hp) {
      clearEffect(h, 'deathWarded');
      d = Math.max(0, h.data.hp - 1);
      log(`🛡 ${h.data.name}'s Death Ward triggers — survives at 1 HP!`, 'heal');
    }
    h.data.hp -= d;
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

  strike(h, foe, dmg, crit, miss, alive = null) {
    const cls = CLASSES[h.data.classKey], a = cls.attack;
    const party = alive || this.heroes.filter(x => x.data.hp > 0);
    if (a.melee) {
      this.triggerLunge(h, foe);
      playSfx('swordAttack', { volume: 0.7 });
      if (miss) { this.showMiss(foe); playSfx(Math.random() < 0.5 ? 'swordBlock' : 'swordParry', { volume: 0.6 }); }
      else {
        playSfx('swordHit', { volume: 0.8 });
        this.damageMonster(foe, dmg, h, crit);
        this.applyOnHitPerks(h, foe, dmg, crit, party);
        spawnSlash(this.engine.scene, { x: foe.x, z: foe.z }, crit ? 0xffd34a : 0xdfe4ee, foe.data.scale);
        spawnSpriteEffect(this.engine.scene, crit ? 'dcss/effect/flame_0.png' : 'dcss/effect/blood_0.png', new THREE.Vector3(foe.x, 0.5, foe.z), 1.0, 0.3);
      }
    } else {
      const color = h.data.classKey === 'wizard' ? 0xff7a30
        : h.data.classKey === 'cleric' ? 0xbfe0ff : 0xe8d8a8;
      const kind = h.data.classKey === 'rogue' ? 'arrow' : 'bolt';
      const from = new THREE.Vector3(h.x, 0.55, h.z);
      const to = new THREE.Vector3(foe.x, 0.4 * foe.data.scale + 0.4, foe.z);
      playSfx(kind === 'arrow' ? 'bowAttack' : 'spellBuff', { volume: kind === 'arrow' ? 0.7 : 0.4 });
      spawnProjectile(this.engine.scene, from, to, kind, color, () => {
        if (foe.dead) return;
        if (miss) { this.showMiss(foe); playSfx('bowBlock', { volume: 0.55 }); }
        else {
          playSfx(kind === 'arrow' ? 'bowHit' : 'spellImpact', { volume: 0.75 });
          this.damageMonster(foe, dmg, h, crit);
          this.applyOnHitPerks(h, foe, dmg, crit, party);
          if (kind === 'bolt') {
            spawnSlash(this.engine.scene, { x: foe.x, z: foe.z }, color, foe.data.scale * 0.9);
            spawnSpriteEffect(this.engine.scene, 'dcss/effect/magic_bolt_1.png', to, 1.2, 0.3);
          } else {
            spawnSpriteEffect(this.engine.scene, 'dcss/effect/arrow_4.png', to, 1.0, 0.3);
          }
        }
      });
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
    if (m.dead) return;
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
    makeFloatText(this.engine.scene, String(dmg), _v.set(m.x, 0.9 * m.data.scale + 0.5, m.z), crit ? '#ffd34a' : '#ff8a5a');
    drawBar(m.ent.bar, Math.max(0, m.data.hp / m.data.maxHp), '#e0483a');
    if (m.data.hp <= 0) this.killMonster(m, h);
  },

  /** Tick burn DoTs on monsters (called from update loop). */
  updateMonsterStatus(dt) {
    for (const m of this.monsters) {
      if (m.dead || m.data.hp <= 0 || !m.burn) continue;
      m.burn.t = (m.burn.t || 0) + dt;
      if (m.burn.t >= 1.0) {
        m.burn.t -= 1.0;
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
    const before = this.heroes.map(a => a.data.level);
    const share = Math.max(1, Math.round(m.data.xp * XP_SHARE));
    /* temp allies fight for free — no XP, no level-ups on a one-floor guest */
    for (const a of this.heroes) if (a.data.hp > 0 && !a.temp) grantXp(a.data, share, log);
    const killer = h?.data?.name || 'The party';
    log(`${killer} slays the ${m.data.name}. (+${m.data.gold}g, +${share} XP each)`, m.data._ambushElite ? 'elite' : m.isBoss ? 'boss' : 'kill');
    onKill(this, m, h);
    /* Random drops: common–epic only (legendaries are quest rewards). */
    let dropChance = m.isBoss ? 1 : ((m.data._ambushElite || this.monsterEliteRoom(m)) ? 0.35 : 0.10);
    if (Math.random() < dropChance) {
      const it = rollItem(this.activeQuest ? this.activeQuest.level : this.dungeonLevel);
      this.inventory.push(it);
      log(`  ↳ ${m.data.name} dropped ${it.name} (ilvl ${it.ilvl})!`, 'treasure');
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

      const q = this.activeQuest;
      const finalFloor = q && (this.questFloor|0) >= (q.floors|0);

      if (finalFloor && q.rewardItem && !q.rewardClaimed) {
        /* Quest reward is delivered at the end of the final dungeon floor. */
        this.grantQuestRewardsAtDungeonEnd();
      } else {
        showBanner('FLOOR CLEARED!', `${m.data.name} defeated`);
        const it = rollItem((this.activeQuest ? this.activeQuest.level : this.dungeonLevel) + 2, Math.random, null, { forceRarity: 'epic' });
        this.inventory.push(it);
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
    const badge = document.getElementById('nav-levelup-badge');
    if (badge) { badge.textContent = total; badge.style.display = total > 0 ? '' : 'none'; }
  }
};
