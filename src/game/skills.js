/**
 * Skill Challenge System 2.0 — Multi-Choice Cards with Risk/Reward Scaling
 *
 * Non-combat skill checks that trigger automatically during dungeon exploration.
 * When a challenge fires, the game pauses and a card overlay offers 2-3
 * approaches (safe / standard / risky), each using a different skill with a
 * different DC and reward scale. The player picks an approach and which
 * eligible hero attempts it (or a "party check" where everyone rolls and at
 * least half must succeed). The chosen card flips over to reveal the d20 roll.
 *
 * Persistent floor-long consequences:
 *   - Momentum: consecutive successes grant a stacking +1 bonus (max +3)
 *   - Wounded Pride: a hero who fails takes -1 to that skill for the floor
 *   - Alerted: some risky failures wake the dungeon — an unvisited room
 *     gains extra monsters
 *   - _floorBuffs / _floorDebuffs arrays on game state, cleared per floor
 *
 * Integrated into game.js — all data, logic, and UI lives here.
 */
import { SKILLS, mod, d as die, roll as d20roll, spawnMonster, makeHero, recalc, grantXp } from './srd.js';
import { rollItem } from './items.js';
import { log, updateResources, updatePartyFrames } from './ui.js';
import { partyShortRest } from './rest.js';
import { applyEffect, clearEffectsByTag, EFFECTS } from './conditions.js';
import { recoverSlots, totalSlots } from './features.js';
import { playNarration, queueNarration, narrationId } from './audio.js';

/* ================================================================
   Module State — no global leaks
   ================================================================ */
let G = null;                          // game controller reference
let _challengesFired = new Set();      // room IDs where a challenge has fired
let _activeChallenge = null;           // challenge currently showing in overlay
let _resolveOverlay = null;            // callback to close the overlay
let _autoContinueTimer = null;         // timeout for auto-continue after result
let _autoChooseTimer = null;           // timeout for auto-pick in choose phase
let _diceInterval = null;              // dice tick animation handle
let _phase = 'idle';                   // idle | choose | rolling | result

/* ================================================================
   Approach Tiers — risk/reward scaling
     safe:     low DC, modest reward (scalable rewards halved)
     standard: normal DC, normal reward
     risky:    high DC, double reward + crit potential (nat 20 pays extra),
               and failure usually has teeth (damage or alerting the dungeon)
   ================================================================ */
const TIERS = {
  safe:     { dc: 10, label: 'SAFE',     mult: 0.5 },
  standard: { dc: 14, label: 'STANDARD', mult: 1 },
  risky:    { dc: 18, label: 'RISKY',    mult: 2 }
};

const REWARD_LABELS = {
  item: 'Gear', gold: 'Gold', potion: 'Potion', heal: 'Party Heal',
  shortRest: 'Short Rest', buff: 'Boon', secret: 'Secret Room',
  shortcut: 'Shortcut', reveal: 'Map Reveal', info: 'Insight',
  tempHp: 'Temp HP', xp: 'Experience', cleanse: 'Cleanse',
  abilityCharge: 'Ability Charge', summonAlly: 'Ally', buffEffect: 'Combat Boon'
};
const REWARD_ICONS = {
  item: '🗡', gold: '💰', potion: '🧪', heal: '💚', shortRest: '🏕',
  buff: '✨', secret: '🚪', shortcut: '🧭', reveal: '🗺', info: '📜',
  tempHp: '💙', xp: '✦', cleanse: '🌟', abilityCharge: '🔋', summonAlly: '🤝', buffEffect: '🛡'
};
/* Reward kinds whose payout scales with tier multiplier */
const SCALABLE = new Set(['item', 'gold', 'potion', 'heal', 'tempHp', 'xp']);

/* Tactical combat buffs grantable via the buffEffect reward kind (short timed
 * bursts via the EFFECTS registry). Strategic floor-long boons use kind:'buff'. */
const BUFF_EFFECTS = {
  raging: 30, hasted: 20, shielded: 15, sacredWeapon: 20,
  inspired: 30, bearTotem: 25, remarkableAthlete: 30
};

/* Debuffs applicable by the 'debuff'/'poison'/'frighten'/'curse' failEffects,
 * mapped to their EFFECTS key and default floor-long duration (null = floor). */
const FAIL_DEBUFFS = {
  poisoned: 'poisoned', frightened: 'frightened', slowed: 'slowed',
  restrained: 'restrained', blinded: 'blinded', weakened: 'weakenedDmg',
  baned: 'baned', faerieFire: 'faerieFire', cursed: 'baned'
};

/* ================================================================
   Challenge Vignette — Visual Asset Mapping
   Maps each challenge name to contextual DCSS prop sprites and the
   hero LPC animation to play during the check.
   ================================================================ */
const DCSS = './dcss/';  // asset root relative to public/

const CHALLENGE_VISUALS = {
  // -- Strength: Athletics --
  'Collapsed Passage':      { props: [`${DCSS}dungeon/boulder.png`],                                                   heroAnim: 'slash' },
  'Heave the Gate':         { props: [`${DCSS}dungeon/doors/gate_closed_middle.png`],                                   heroAnim: 'slash' },
  'Crack the Wall':         { props: [`${DCSS}dungeon/boulder.png`],                                                   heroAnim: 'slash' },
  // -- Dexterity: Acrobatics --
  'Rope Bridge':            { props: [`${DCSS}dungeon/traps/shaft.png`],                                                heroAnim: 'walk' },
  'Shattered Floor':        { props: [`${DCSS}dungeon/traps/shaft.png`, `${DCSS}item/potion/emerald.png`],              heroAnim: 'walk' },
  'Narrow Ledge':           { props: [`${DCSS}dungeon/statues/crumbled_column.png`],                                    heroAnim: 'walk' },
  // -- Dexterity: Sleight of Hand --
  'Locked Chest':           { props: [`${DCSS}dungeon/chest.png`, `${DCSS}item/misc/key.png`],                          heroAnim: 'walk' },
  'Trapped Reliquary':      { props: [`${DCSS}dungeon/statues/pedestal.png`, `${DCSS}item/misc/misc_crystal.png`],      heroAnim: 'walk' },
  'Disarm the Contraption': { props: [`${DCSS}dungeon/traps/trap_dart.png`],                                            heroAnim: 'walk' },
  // -- Dexterity: Stealth --
  'Sleeping Guardian':      { props: [`${DCSS}monster/animals/bear.png`],                                               heroAnim: 'walk' },
  'Hidden Stash':           { props: [`${DCSS}item/gold/gold_pile.png`],                                                heroAnim: 'walk' },
  // -- Intelligence: Arcana --
  'Rune-Sealed Door':       { props: [`${DCSS}dungeon/doors/runed_door.png`, `${DCSS}item/misc/misc_rune.png`],         heroAnim: 'spellcast' },
  'Crystal Conduit':        { props: [`${DCSS}item/misc/misc_crystal.png`],                                             heroAnim: 'spellcast' },
  'Identify Enchantment':   { props: [`${DCSS}effect/cloud_magic_trail_0.png`],                                         heroAnim: 'spellcast' },
  // -- Intelligence: History --
  'Annal Tablet':           { props: [`${DCSS}item/scroll/scroll.png`, `${DCSS}item/book/misc_book.png`],               heroAnim: 'walk' },
  'Tomb Rite':              { props: [`${DCSS}dungeon/sarcophagus_open.png`],                                           heroAnim: 'spellcast' },
  'Architect Insight':      { props: [`${DCSS}dungeon/doors/detected_secret_door.png`],                                 heroAnim: 'walk' },
  // -- Intelligence: Investigation --
  'Hidden Armory':          { props: [`${DCSS}dungeon/doors/detected_secret_door.png`],                                 heroAnim: 'walk' },
  'Pressure Plate Puzzle':  { props: [`${DCSS}dungeon/traps/pressure_plate.png`, `${DCSS}dungeon/traps/trap_dart.png`], heroAnim: 'walk' },
  'Search for Clues':       { props: [`${DCSS}item/book/misc_book.png`],                                                heroAnim: 'walk' },
  // -- Intelligence: Nature --
  'Overgrown Grove':        { props: [`${DCSS}item/potion/emerald.png`, `${DCSS}item/potion/potion_golden.png`],        heroAnim: 'walk' },
  'Mushroom Chamber':       { props: [`${DCSS}monster/fungi_plants/wandering_mushroom.png`],                                        heroAnim: 'walk' },
  'Toxic Pool':             { props: [`${DCSS}effect/cloud_poison_0.png`],                                              heroAnim: 'walk' },
  // -- Intelligence: Religion --
  'Desecrated Shrine':      { props: [`${DCSS}dungeon/altars/altar_elyvilon.png`],                                      heroAnim: 'spellcast' },
  'Heretic Ward':           { props: [`${DCSS}dungeon/doors/sealed_door.png`],                                          heroAnim: 'spellcast' },
  'Holy Symbol':            { props: [`${DCSS}dungeon/altars/misc_altar.png`],                                          heroAnim: 'walk' },
  // -- Wisdom: Animal Handling --
  'Caged Beast':            { props: [`${DCSS}monster/animals/wolf.png`],                                               heroAnim: 'walk' },
  'Pack Beast':             { props: [`${DCSS}monster/animals/yak.png`, `${DCSS}item/gold/gold_pile_10.png`],           heroAnim: 'walk' },
  'Lost Pet':               { props: [`${DCSS}monster/fire_drake.png`],                                                 heroAnim: 'walk' },
  // -- Wisdom: Insight --
  'Mimic Sense':            { props: [`${DCSS}dungeon/chest.png`],                                                      heroAnim: 'walk' },
  'Merchant Riddle':        { props: [`${DCSS}item/gold/gold_pile_25.png`],                                             heroAnim: 'walk' },
  'Fake Wall':              { props: [`${DCSS}dungeon/doors/detected_secret_door.png`],                                 heroAnim: 'walk' },
  // -- Wisdom: Medicine --
  'Sick Wanderer':          { props: [`${DCSS}item/potion/potion_golden.png`],                                          heroAnim: 'walk' },
  'Triage Aftermath':       { props: [`${DCSS}effect/goldaura_0.png`],                                                  heroAnim: 'spellcast' },
  'Plague Source':          { props: [`${DCSS}effect/cloud_poison_0.png`],                                              heroAnim: 'spellcast' },
  // -- Wisdom: Perception --
  'Secret Junction':        { props: [`${DCSS}dungeon/doors/detected_secret_door.png`],                                 heroAnim: 'walk' },
  'Hidden Switch':          { props: [`${DCSS}dungeon/traps/pressure_plate.png`],                                       heroAnim: 'walk' },
  'Ambush Warning':         { props: [`${DCSS}monster/animals/wolf.png`],                                               heroAnim: 'walk' },
  'Treasure Glint':         { props: [`${DCSS}item/gold/gold_pile.png`],                                                heroAnim: 'walk' },
  // -- Wisdom: Survival --
  'Lost Trail':             { props: [`${DCSS}dungeon/doors/open_door.png`],                                            heroAnim: 'walk' },
  'Forage Supplies':        { props: [`${DCSS}item/potion/emerald.png`],                                                heroAnim: 'walk' },
  'Safe Camp':              { props: [`${DCSS}effect/goldaura_0.png`],                                                  heroAnim: 'walk' },
  'Environment Hazard':     { props: [`${DCSS}dungeon/boulder.png`, `${DCSS}item/gold/gold_pile.png`],                  heroAnim: 'walk' },
  // -- Charisma: Deception --
  'Bluff the Sentinel':     { props: [`${DCSS}monster/nonliving/guardian_golem.png`],                                   heroAnim: 'walk' },
  'Feign Authority':        { props: [`${DCSS}item/gold/gold_pile_25.png`],                                             heroAnim: 'walk' },
  'False Trail':            { props: [`${DCSS}item/scroll/scroll.png`],                                                 heroAnim: 'walk' },
  // -- Charisma: Intimidation --
  'Cower the Scavengers':   { props: [`${DCSS}monster/animals/rat.png`, `${DCSS}item/gold/gold_pile.png`],              heroAnim: 'slash' },
  'Demand Passage':         { props: [`${DCSS}dungeon/doors/gate_closed_middle.png`],                                   heroAnim: 'walk' },
  'Awe the Cultist':        { props: [`${DCSS}monster/necromancer.png`],                                                heroAnim: 'walk' },
  // -- Charisma: Performance --
  'Riddle Court':           { props: [`${DCSS}monster/sphinx.png`],                                                     heroAnim: 'spellcast' },
  'Echoing Alcove':         { props: [`${DCSS}item/misc/misc_horn.png`],                                                heroAnim: 'spellcast' },
  'Distract the Guard':     { props: [`${DCSS}monster/orc_warrior.png`],                                                heroAnim: 'walk' },
  // -- Charisma: Persuasion --
  'Merchant Discount':      { props: [`${DCSS}item/gold/gold_pile_25.png`],                                             heroAnim: 'walk' },
  'Freed Captive':          { props: [`${DCSS}monster/human_slave.png`],                                                heroAnim: 'walk' },
  'Calm the Crowd':         { props: [`${DCSS}monster/human.png`, `${DCSS}item/gold/gold_pile.png`],                    heroAnim: 'walk' },
};

/* Fallback visuals keyed by reward kind (used when a challenge isn't in the table) */
const REWARD_VISUALS = {
  item:      { props: [`${DCSS}dungeon/chest.png`],                      heroAnim: 'slash' },
  gold:      { props: [`${DCSS}item/gold/gold_pile.png`],                heroAnim: 'walk' },
  potion:    { props: [`${DCSS}item/potion/emerald.png`],                heroAnim: 'walk' },
  heal:      { props: [`${DCSS}effect/goldaura_0.png`],                  heroAnim: 'spellcast' },
  shortRest: { props: [`${DCSS}effect/goldaura_0.png`],                  heroAnim: 'spellcast' },
  buff:      { props: [`${DCSS}effect/gold_sparkles_1.png`],             heroAnim: 'spellcast' },
  secret:    { props: [`${DCSS}dungeon/doors/detected_secret_door.png`], heroAnim: 'walk' },
  shortcut:  { props: [`${DCSS}dungeon/doors/open_door.png`],            heroAnim: 'walk' },
  reveal:    { props: [`${DCSS}item/scroll/scroll.png`],                 heroAnim: 'walk' },
  info:      { props: [`${DCSS}item/book/misc_book.png`],                heroAnim: 'walk' },
};

function getVisuals(challenge) {
  return CHALLENGE_VISUALS[challenge.name]
    || REWARD_VISUALS[challenge.reward?.kind]
    || { props: [], heroAnim: 'walk' };
}

/* ================================================================
   Challenge Vignette — 2D Canvas Renderer
   Draws the hero sprite (composited from LPC layers, same as the
   portrait system) performing an animation, surrounded by floating
   DCSS prop sprites on a <canvas> in the overlay.
   ================================================================ */

const VIGNETTE_W = 320, VIGNETTE_H = 160;

/* LPC sprite metadata (duplicated from sprite_animator for independence) */
const VIG_ANIM_META = {
  spellcast: { cols: 7, rows: 4, speed: 10 },
  thrust:    { cols: 8, rows: 4, speed: 12 },
  walk:      { cols: 9, rows: 4, speed: 12 },
  slash:     { cols: 6, rows: 4, speed: 12 },
  shoot:     { cols: 13, rows: 4, speed: 15 },
  hurt:      { cols: 6, rows: 1, speed: 8 }
};

const VIG_LAYER_ORDER = [
  'shield_behind','weapon_behind','body','head','eyes','legs','torso',
  'feet','shoulders','gloves','ears','horns','facialHair','hair',
  'helm','visor','shield','weapon'
];

const vigImageCache = {};
function vigLoadImage(src) {
  if (vigImageCache[src]) return Promise.resolve(vigImageCache[src]);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { vigImageCache[src] = img; resolve(img); };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function vigHexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}
function vigRgbToHsl(r,g,b) {
  r/=255; g/=255; b/=255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
  let h=0,s=0,l=(mx+mn)/2;
  if(mx!==mn){
    const d=mx-mn; s=l>0.5?d/(2-mx-mn):d/(mx+mn);
    if(mx===r) h=((g-b)/d+(g<b?6:0))/6;
    else if(mx===g) h=((b-r)/d+2)/6;
    else h=((r-g)/d+4)/6;
  }
  return [h,s,l];
}
function vigHslToRgb(h,s,l) {
  if(s===0){const v=Math.round(l*255);return[v,v,v];}
  const hue2rgb=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
  const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
  return [Math.round(hue2rgb(p,q,h+1/3)*255),Math.round(hue2rgb(p,q,h)*255),Math.round(hue2rgb(p,q,h-1/3)*255)];
}

function vigDrawTinted(ctx, img, tintColor) {
  if (!tintColor) { ctx.drawImage(img, 0, 0); return; }
  const tc = document.createElement('canvas');
  tc.width = img.width; tc.height = img.height;
  const t = tc.getContext('2d');
  t.drawImage(img, 0, 0);
  const id = t.getImageData(0, 0, img.width, img.height);
  const d = id.data;
  const [tr,tg,tb] = vigHexToRgb(tintColor);
  const [th,ts] = vigRgbToHsl(tr,tg,tb);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i+3] === 0) continue;
    const [,,ll] = vigRgbToHsl(d[i], d[i+1], d[i+2]);
    const [cr,cg,cb] = vigHslToRgb(th, ts, ll);
    d[i]=cr; d[i+1]=cg; d[i+2]=cb;
  }
  t.putImageData(id, 0, 0);
  ctx.drawImage(tc, 0, 0);
}

/** Composite a hero's LPC layers into a single spritesheet canvas for the given action */
async function vigCompositeHeroSheet(hero, action) {
  const meta = VIG_ANIM_META[action];
  if (!meta) return null;
  const canvas = document.createElement('canvas');
  canvas.width = meta.cols * 64;
  canvas.height = meta.rows * 64;
  const ctx = canvas.getContext('2d');

  const visual = hero.visual || {};
  const equipment = hero.equipment || {};
  const g = visual.gender || 'male';
  const isMonster = (g === 'skeleton' || g === 'zombie');
  const customHead = visual.head;
  const clothG = (g === 'muscular' || g === 'teen' || g === 'child') ? 'male' : g;
  const ASSETS_ROOT = './lpc/';

  const w = equipment.weapon ? equipment.weapon.visualWeapon : null;
  const t = equipment.armor ? equipment.armor.visualTorso : null;
  const l = equipment.armor ? (equipment.armor.visualLegs || 'pants') : (visual.pants !== undefined ? visual.pants : 'pants');
  const hlm = equipment.helm ? equipment.helm.visualHelm : null;
  const v = equipment.helm ? equipment.helm.visualVisor : null;
  const sh = equipment.offhand ? equipment.offhand.visualShield : null;
  const f = equipment.boots ? equipment.boots.visualShoes : (visual.shoes !== undefined ? visual.shoes : 'shoes/basic');
  const shld = equipment.armor ? equipment.armor.visualShoulders : null;
  const glv = equipment.gloves ? equipment.gloves.visualGloves : null;

  let w_behind = w ? `weapon_behind/${w}` : null;
  let sh_behind = null;
  if (sh && sh.includes('crusader/fg')) sh_behind = `shield_behind/crusader/fg/${clothG}`;

  const paths = {
    shield_behind: sh_behind,
    weapon_behind: w_behind,
    body: `body/bodies/${g}`,
    head: customHead ? `head/heads/${customHead}` : (isMonster ? null : `head/heads/human/${clothG}`),
    eyes: (isMonster || customHead) ? null : `eyes/human/adult/default`,
    ears: (!isMonster && visual.ears && visual.ears !== 'none'
           && (!customHead || visual.ears === 'dragon')) ? `head/ears/${visual.ears}/adult` : null,
    horns: (!isMonster && visual.horns && visual.horns !== 'none') ? `head/horns/${visual.horns}` : null,
    legs: (isMonster || l === 'none') ? null : `legs/${l}/${l === 'armour/plate' ? 'male' : clothG}`,
    torso: (isMonster || t === 'none' || !t) ? null : `torso/${t}/${clothG}`,
    feet: (isMonster || f === 'none') ? null : `feet/${f}/${clothG === 'male' ? 'male' : 'thin'}`,
    shoulders: shld ? `shoulders/${shld}/${shld === 'legion' ? clothG : (clothG === 'male' ? 'male' : 'thin')}` : null,
    gloves: glv ? `${glv}/${clothG === 'male' ? 'male' : 'thin'}` : null,
    facialHair: (isMonster || customHead || !visual.facialHair || visual.facialHair === 'none') ? null : `beards/${visual.facialHair}`,
    hair: (isMonster || customHead || visual.hair === 'none') ? null : `hair/${visual.hair}`,
    helm: hlm ? (hlm.includes('greathelm') ? `hat/${hlm}/${clothG}` : `hat/${hlm}/adult`) : null,
    visor: v ? `hat/visor/${v}/adult` : null,
    shield: sh ? (sh === 'round' ? `shield/${sh}` : `shield/${sh}/${clothG}`) : null,
    weapon: w ? `weapon/${w}` : null
  };

  for (const layer of VIG_LAYER_ORDER) {
    if (!paths[layer]) continue;
    const img = await vigLoadImage(`${ASSETS_ROOT}${paths[layer]}/${action}.png`);
    if (!img) continue;
    if (layer === 'body' || layer === 'head' || layer === 'ears' || layer === 'horns') {
      vigDrawTinted(ctx, img, visual.skinColor);
    } else if (layer === 'hair' || layer === 'facialHair') {
      vigDrawTinted(ctx, img, visual.hairColor);
    } else if (layer === 'eyes' && visual.eyeColor) {
      vigDrawTinted(ctx, img, visual.eyeColor);
    } else {
      let slotKey = layer;
      if (layer === 'helm' || layer === 'visor') slotKey = 'helm';
      else if (layer === 'shield' || layer === 'shield_behind') slotKey = 'offhand';
      else if (layer === 'weapon' || layer === 'weapon_behind') slotKey = 'weapon';
      else if (layer === 'legs' || layer === 'torso' || layer === 'feet' || layer === 'shoulders') slotKey = 'armor';
      else if (layer === 'gloves') slotKey = 'gloves';
      const it = equipment[slotKey];
      if (it && it.visualColor) vigDrawTinted(ctx, img, it.visualColor);
      else ctx.drawImage(img, 0, 0);
    }
  }
  return canvas;
}

/** The live vignette instance, if any */
let _vignette = null;

class ChallengeVignette {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.heroes = [];         // [{walk, sheet, action, hurt, actionMeta, name, _heroData}]
    this.performerIdx = -1;   // -1 = party view, >= 0 = single performer focus
    this.propImages = [];
    this.propPositions = [];
    this.time = 0;
    this.rafId = null;
    this.state = 'idle'; // idle | action | success | failure
    this.effectTime = 0;
    this.sparkles = [];
    this.destroyed = false;
    this._lastTS = 0;
    this._actionName = 'walk';
  }

  async init(heroes, challenge) {
    if (this.destroyed) return;
    const visuals = getVisuals(challenge);
    this._actionName = visuals.heroAnim;

    // Composite walk sheets for all heroes in parallel
    const walkSheets = await Promise.all(
      heroes.map(h => vigCompositeHeroSheet(h.hero, 'walk'))
    );

    this.heroes = heroes.map((h, i) => ({
      walk: walkSheets[i],
      sheet: walkSheets[i],
      action: null,
      hurt: null,
      actionMeta: null,
      name: h.name,
      _heroData: h.hero
    }));

    this.performerIdx = -1;

    // Pre-load action + hurt for the first hero (common fast path)
    if (this.heroes.length > 0) {
      const h0 = this.heroes[0];
      const firstAction = visuals.heroAnim !== 'walk'
        ? await vigCompositeHeroSheet(heroes[0].hero, visuals.heroAnim)
        : walkSheets[0];
      h0.action = firstAction;
      h0.actionMeta = VIG_ANIM_META[visuals.heroAnim] || VIG_ANIM_META.walk;
      h0.hurt = await vigCompositeHeroSheet(heroes[0].hero, 'hurt');
    }

    // Load prop sprites
    const propPromises = visuals.props.map(src => vigLoadImage(src));
    const loaded = await Promise.all(propPromises);
    this.propImages = loaded.filter(Boolean);
    this._layoutProps();

    this._lastTS = performance.now();
    this._tick = this._tick.bind(this);
    this.rafId = requestAnimationFrame(this._tick);
  }

  _layoutProps() {
    const cx = VIGNETTE_W / 2;
    const count = this.propImages.length;
    this.propPositions = this.propImages.map((img, i) => {
      const side = count === 1 ? -1 : (i % 2 === 0 ? -1 : 1);
      const xOff = count === 1 ? -70 : (50 + i * 30) * side;
      const yBase = VIGNETTE_H - 50 - Math.random() * 10;
      return {
        x: cx + xOff - (img.width * 2) / 2,
        y: yBase - (img.height * 2),
        baseY: yBase - (img.height * 2),
        phase: Math.random() * Math.PI * 2,
        amplitude: 3 + Math.random() * 3
      };
    });
  }

  _tick(ts) {
    if (this.destroyed) return;
    const dt = Math.min((ts - this._lastTS) / 1000, 0.1);
    this._lastTS = ts;
    this.time += dt;
    this.effectTime += dt;
    this._draw(dt);
    this.rafId = requestAnimationFrame(this._tick);
  }

  _draw(dt) {
    const ctx = this.ctx;
    const w = VIGNETTE_W, h = VIGNETTE_H;
    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createRadialGradient(w/2, h*0.65, 10, w/2, h*0.65, w*0.5);
    if (this.state === 'failure') {
      const flash = Math.max(0, 1 - this.effectTime * 2);
      grad.addColorStop(0, `rgba(180,40,30,${0.15 + flash * 0.25})`);
      grad.addColorStop(1, 'rgba(10,8,6,0)');
    } else if (this.state === 'success') {
      const glow = 0.15 + Math.sin(this.effectTime * 4) * 0.08;
      grad.addColorStop(0, `rgba(232,194,90,${glow})`);
      grad.addColorStop(1, 'rgba(10,8,6,0)');
    } else {
      grad.addColorStop(0, 'rgba(200,170,90,0.08)');
      grad.addColorStop(1, 'rgba(10,8,6,0)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < this.propImages.length; i++) {
      const img = this.propImages[i];
      const p = this.propPositions[i];
      if (!img || !p) continue;
      const bob = Math.sin(this.time * 1.5 + p.phase) * p.amplitude;
      const sc = 2;
      let alpha = 1;
      if (this.state === 'failure') alpha = Math.max(0.3, 1 - this.effectTime * 0.5);
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, p.x, p.baseY + bob - (img.height * sc - img.height), img.width * sc, img.height * sc);
      ctx.globalAlpha = 1;
    }

    this._drawHeroes(ctx);

    if (this.state === 'success') this._drawSparkles(ctx, dt);
  }

  _drawHeroes(ctx) {
    if (this.heroes.length === 0) return;

    // Performer focus (action / result phase)
    if (this.performerIdx >= 0 && this.state !== 'idle') {
      const h = this.heroes[this.performerIdx];
      if (!h || !h.sheet) return;
      const dir = 2;
      const fw = 64, fh = 64;
      const scale = 2.5;
      const drawW = fw * scale, drawH = fh * scale;
      const x = VIGNETTE_W / 2 - drawW / 2;
      const y = VIGNETTE_H - drawH - 2;
      const meta = this.heroAction === 'hurt' ? VIG_ANIM_META.hurt
        : (h.actionMeta || VIG_ANIM_META.walk);
      let frameIdx;
      if (this.heroAction === 'walk') {
        frameIdx = this.state === 'success' ? 0
          : (1 + Math.floor(this.time * meta.speed - 1) % 8);
        if (frameIdx < 1) frameIdx = 0;
      } else if (this.heroAction === 'hurt') {
        frameIdx = Math.min(Math.floor(this.effectTime * meta.speed), meta.cols - 1);
      } else {
        frameIdx = Math.floor(this.time * meta.speed) % meta.cols;
      }
      const row = meta.rows === 1 ? 0 : dir;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(h.sheet, frameIdx * fw, row * fh, fw, fh, x, y, drawW, drawH);
      ctx.imageSmoothingEnabled = true;
      return;
    }

    // Party view (choose phase / idle) — all heroes standing side by side
    const count = this.heroes.length;
    const pad = 20;
    const totalW = VIGNETTE_W - pad * 2;
    const gap = 6;
    const scale = Math.min(1.3, totalW / (count * 64 + (count - 1) * gap));
    const drawW = 64 * scale;
    const drawH = 64 * scale;
    const totalUsed = count * drawW + (count - 1) * gap;
    const startX = (VIGNETTE_W - totalUsed) / 2;
    const heroY = VIGNETTE_H - drawH - 2;

    ctx.fillStyle = '#f0e6cc';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';

    for (let i = 0; i < count; i++) {
      const h = this.heroes[i];
      if (!h || !h.walk) continue;
      const x = startX + i * (drawW + gap);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(h.walk, 0, 128, 64, 64, x, heroY, drawW, drawH);
      ctx.imageSmoothingEnabled = true;
      ctx.fillText(h.name, x + drawW / 2, heroY - 4);
    }
  }

  _drawSparkles(ctx, dt) {
    if (this.effectTime < 2.5 && Math.random() < 0.4) {
      this.sparkles.push({
        x: VIGNETTE_W / 2 + (Math.random() - 0.5) * 120,
        y: VIGNETTE_H * 0.3 + Math.random() * VIGNETTE_H * 0.5,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.6,
        size: 2 + Math.random() * 3
      });
    }
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const s = this.sparkles[i];
      s.life += dt;
      if (s.life >= s.maxLife) { this.sparkles.splice(i, 1); continue; }
      const t = s.life / s.maxLife;
      const alpha = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
      const brightness = 180 + Math.floor(75 * Math.sin(s.life * 12));
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = `rgb(${brightness}, ${Math.floor(brightness * 0.85)}, ${Math.floor(brightness * 0.4)})`;
      ctx.beginPath();
      const sz = s.size * (0.7 + 0.3 * Math.sin(s.life * 8));
      ctx.moveTo(s.x, s.y - sz);
      ctx.lineTo(s.x + sz * 0.3, s.y);
      ctx.lineTo(s.x, s.y + sz);
      ctx.lineTo(s.x - sz * 0.3, s.y);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s.x - sz, s.y);
      ctx.lineTo(s.x, s.y + sz * 0.3);
      ctx.lineTo(s.x + sz, s.y);
      ctx.lineTo(s.x, s.y - sz * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      s.y -= dt * 15;
    }
  }

  /** Switch to a specific hero's challenge action animation */
  playAction(heroIdx) {
    if (this.destroyed) return;
    const h = this.heroes[heroIdx];
    if (!h) return;
    this.performerIdx = heroIdx;
    if (!h.action) {
      vigCompositeHeroSheet(h._heroData, this._actionName).then(sheet => {
        if (this.destroyed) return;
        h.action = sheet;
        h.actionMeta = VIG_ANIM_META[this._actionName] || VIG_ANIM_META.walk;
        if (this.performerIdx === heroIdx && this.state === 'action') {
          h.sheet = sheet;
        }
      });
      if (!h.hurt) {
        vigCompositeHeroSheet(h._heroData, 'hurt').then(sheet => {
          if (this.destroyed) return; h.hurt = sheet;
        });
      }
    } else {
      h.sheet = h.action;
    }
    this.heroAction = this._actionName;
    this.state = 'action';
    this.time = 0;
  }

  /** Show success reaction on the performer */
  showSuccess() {
    if (this.destroyed) return;
    this.state = 'success';
    this.effectTime = 0;
    this.sparkles = [];
    const h = this.heroes[this.performerIdx >= 0 ? this.performerIdx : 0];
    if (h) h.sheet = h.walk;
    this.heroAction = 'walk';
  }

  /** Show failure reaction on the performer */
  showFailure() {
    if (this.destroyed) return;
    this.state = 'failure';
    this.effectTime = 0;
    const h = this.heroes[this.performerIdx >= 0 ? this.performerIdx : 0];
    if (h && h.hurt) {
      h.sheet = h.hurt;
      this.heroAction = 'hurt';
    } else {
      this.heroAction = 'walk';
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }
}

/* ================================================================
   Challenge Data
   Each entry:
     name       — title shown in the overlay
     type       — 'room' | 'postClear' | 'camp' (flavor/eligibility grouping)
     desc       — situation text
     reward     — base reward, scaled by the chosen approach's tier
     approaches — 2-3 of:
       tier       — 'safe' | 'standard' | 'risky'
       skill      — key from SKILLS in srd.js
       label      — the action shown on the card
       win / lose — outcome flavor text
       failEffect — optional: 'damage' (attempting hero hurt) | 'alert'
                    (an unvisited room gains extra monsters)
       party      — optional: everyone rolls, at least half must succeed
   ================================================================ */
const CHALLENGES = [
  /* ------- Strength: Athletics ------- */
  {
    name: 'Collapsed Passage', type: 'room', reward: { kind: 'shortcut' },
    desc: 'A pile of rubble blocks the corridor ahead.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Scout a way around',
        win: 'You find a crawlspace skirting the rubble — a modest shortcut.',
        lose: 'Every side passage dead-ends. The long way it is.' },
      { tier: 'standard', skill: 'athletics', label: 'Clear the rubble',
        win: 'You heave the debris aside, revealing a shortcut deeper into the dungeon.',
        lose: 'The rubble is too dense. The party takes the long way around.' },
      { tier: 'risky', skill: 'athletics', label: 'Smash straight through', failEffect: 'damage',
        win: 'Stone explodes outward — a clean tunnel, and loose valuables in the fill!',
        lose: 'The heap shifts and half-buries you.' }
    ]
  },
  {
    name: 'Heave the Gate', type: 'room', reward: { kind: 'item' },
    desc: 'A rusted portcullis bars the way to a side chamber. A chest gleams beyond.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Look for a winch',
        win: 'You find the rusted winch and crank the gate open enough to reach through.',
        lose: 'The winch mechanism is destroyed. No easy way in.' },
      { tier: 'standard', skill: 'athletics', label: 'Lift the portcullis',
        win: 'With a groan of straining metal, the gate rises. The chest is yours.',
        lose: 'The gate won\'t budge. You\'ll need another way in.' },
      { tier: 'risky', skill: 'athletics', label: 'Wrench it off its rails', failEffect: 'damage',
        win: 'The whole gate tears free! Nothing stands between you and the loot.',
        lose: 'The gate snaps back down, catching your arm.' }
    ]
  },
  {
    name: 'Crack the Wall', type: 'postClear', reward: { kind: 'gold' },
    desc: 'This section of wall sounds hollow.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Tap for weak spots',
        win: 'You find a loose block and slide it out — coins glint in the cavity.',
        lose: 'Solid rock everywhere you tap.' },
      { tier: 'standard', skill: 'athletics', label: 'Shoulder the wall',
        win: 'Stone crumbles away, revealing a hidden cache of gold!',
        lose: 'Just solid rock. The effort leaves you winded and empty-handed.' },
      { tier: 'risky', skill: 'athletics', label: 'Bring the whole wall down', failEffect: 'damage',
        win: 'The wall collapses — behind it, a forgotten strongbox!',
        lose: 'The ceiling sheds rubble on your head.' }
    ]
  },

  /* ------- Dexterity: Acrobatics ------- */
  {
    name: 'Rope Bridge', type: 'room', reward: { kind: 'item' },
    desc: 'A frayed rope bridge spans a deep chasm. A chest is tied at its midpoint.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Test each plank first',
        win: 'Slow and steady — you reach the chest and haul it back.',
        lose: 'Too many planks are rotten through. Not worth the fall.' },
      { tier: 'standard', skill: 'acrobatics', label: 'Cross with grace',
        win: 'You cross with fluid grace, claiming the isolated chest.',
        lose: 'The bridge sways violently. You retreat to solid ground.' },
      { tier: 'risky', skill: 'acrobatics', label: 'Everyone rushes across', party: true, failEffect: 'damage',
        win: 'The whole party thunders across before the ropes can complain — and strips the bridge of everything!',
        lose: 'Planks snap under the weight. Bruised bodies dangle from the ropes.' }
    ]
  },
  {
    name: 'Shattered Floor', type: 'room', reward: { kind: 'potion' },
    desc: 'Crumbling tiles span a gap. A potion sits on a pedestal on the far side.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Chart the solid tiles',
        win: 'You map a safe route tile by tile and retrieve the prize.',
        lose: 'Cracks run through every tile. No safe path exists.' },
      { tier: 'standard', skill: 'acrobatics', label: 'Spring across', failEffect: 'damage',
        win: 'Light on your feet, you spring across the broken tiles and grab the prize!',
        lose: 'A tile gives way beneath you! You take a nasty tumble.' },
      { tier: 'risky', skill: 'acrobatics', label: 'Leap the whole gap', failEffect: 'damage',
        win: 'One impossible leap — you stick the landing and sweep the pedestal clean!',
        lose: 'You come up short and crash into the pit.' }
    ]
  },
  {
    name: 'Narrow Ledge', type: 'room', reward: { kind: 'item' },
    desc: 'A crumbling ledge hugs the wall, barely a foot wide. Something glints in an alcove ahead.',
    approaches: [
      { tier: 'safe', skill: 'athletics', label: 'Rope up and anchor',
        win: 'Anchored and careful, you retrieve the stash without a scare.',
        lose: 'No solid anchor point holds. You abandon the attempt.' },
      { tier: 'standard', skill: 'acrobatics', label: 'Edge along the ledge',
        win: 'You edge along with perfect balance and claim the hidden stash.',
        lose: 'A pebble skitters into the void. Too risky — you turn back.' },
      { tier: 'risky', skill: 'acrobatics', label: 'Sprint the ledge', failEffect: 'damage',
        win: 'You dash the ledge like a mountain goat and scoop up everything in the alcove!',
        lose: 'The ledge crumbles mid-stride. You catch yourself hard on the lip.' }
    ]
  },

  /* ------- Dexterity: Sleight of Hand ------- */
  {
    name: 'Locked Chest', type: 'room', reward: { kind: 'item' },
    desc: 'An ornate chest with a complex locking mechanism sits against the wall.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Study the mechanism',
        win: 'You find the maker\'s release catch hidden under the lid. Click.',
        lose: 'The mechanism is beyond you. The chest stays shut.' },
      { tier: 'standard', skill: 'sleightOfHand', label: 'Pick the lock',
        win: 'The lock clicks open! Inside you find treasure.',
        lose: 'The lock jams. The chest won\'t budge.' },
      { tier: 'risky', skill: 'athletics', label: 'Pry it open', failEffect: 'damage',
        win: 'The lid tears off its hinges — everything inside is yours!',
        lose: 'A needle trap fires from the strained lock.' }
    ]
  },
  {
    name: 'Trapped Reliquary', type: 'room', reward: { kind: 'potion' },
    desc: 'A gem rests on a pressure-plate pedestal. One wrong move could trigger a trap.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Map the trigger plates',
        win: 'You chart every plate and lift the gem from the one blind angle.',
        lose: 'The trigger pattern defeats you. Better left alone.' },
      { tier: 'standard', skill: 'sleightOfHand', label: 'Lift the gem gently',
        win: 'With nerves of steel, you lift the gem without triggering the mechanism.',
        lose: 'The mechanism clicks ominously. You retreat empty-handed.' },
      { tier: 'risky', skill: 'sleightOfHand', label: 'Snatch and run', failEffect: 'damage',
        win: 'Grab, sprint, slide — the darts hit nothing but wall. What a haul!',
        lose: 'A volley of darts finds you mid-sprint.' }
    ]
  },
  {
    name: 'Disarm the Contraption', type: 'room', reward: { kind: 'gold' },
    desc: 'A tripwire stretches across the passage, connected to something deadly.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Trace the tripwire',
        win: 'You follow the wire to its housing and simply step around the whole rig — pocketing the trapper\'s stash.',
        lose: 'The wire vanishes into the wall. You give it a wide berth.' },
      { tier: 'standard', skill: 'sleightOfHand', label: 'Disarm the mechanism',
        win: 'You carefully dismantle the trap, revealing a cache of gold behind it.',
        lose: 'A dart fires from the wall! You flinch back empty-handed.' },
      { tier: 'risky', skill: 'athletics', label: 'Smash through and grab everything', failEffect: 'damage',
        win: 'You barrel through before the trap can cycle — and rip its gilded housing off the wall!',
        lose: 'The trap fires true. That one hurt.' }
    ]
  },

  /* ------- Dexterity: Stealth ------- */
  {
    name: 'Sleeping Guardian', type: 'room', reward: { kind: 'item' },
    desc: 'A hibernating beast blocks the passage to a glittering hoard.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Find a wide berth',
        win: 'You spot a drainage crawl that loops behind the beast. Slow, filthy, effective.',
        lose: 'No way around. The beast guards the only path.' },
      { tier: 'standard', skill: 'stealth', label: 'Slip past silently',
        win: 'You slip past without a sound, claiming the treasure behind it.',
        lose: 'The beast stirs! The party flees the room.' },
      { tier: 'risky', skill: 'stealth', label: 'The whole party sneaks the hoard', party: true, failEffect: 'alert',
        win: 'Impossibly, five sets of boots make no sound. You strip the hoard bare!',
        lose: 'Someone kicks a coin. The beast\'s roar echoes through the dungeon.' }
    ]
  },
  {
    name: 'Hidden Stash', type: 'postClear', reward: { kind: 'gold' },
    desc: 'The monsters must have hidden something in this room.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Scan for loose stones',
        win: 'A scuffed flagstone gives it away — a small pouch of gold underneath.',
        lose: 'If there\'s a stash here, it\'s hidden too well.' },
      { tier: 'standard', skill: 'stealth', label: 'Ease it out without springing the bell',
        win: 'Tucked behind a loose stone — and rigged to a bell — you find a pouch of gold. The bell never rings.',
        lose: 'The bell clangs. The prize drops into a chute and is gone.' },
      { tier: 'risky', skill: 'sleightOfHand', label: 'Grab it fast', failEffect: 'alert',
        win: 'Faster than the trap can trigger — you rip the whole stash free!',
        lose: 'The alarm bell rings through the halls. Something answers.' }
    ]
  },

  /* ------- Intelligence: Arcana ------- */
  {
    name: 'Rune-Sealed Door', type: 'room', reward: { kind: 'item' },
    desc: 'Glowing runes pulse on a sealed stone door.',
    approaches: [
      { tier: 'safe', skill: 'history', label: 'Recall the sigil lore',
        win: 'You remember this school of warding — and its standard master phrase. The seal fades.',
        lose: 'The sigils match nothing you\'ve read.' },
      { tier: 'standard', skill: 'arcana', label: 'Trace counter-runes',
        win: 'You trace the counter-runes — the seal dissolves, opening the way to a bonus chamber.',
        lose: 'The runes flare but hold. The door stays sealed.' },
      { tier: 'risky', skill: 'arcana', label: 'Overload the seal', failEffect: 'damage',
        win: 'You pour raw magic into the ward until it bursts — the chamber and its riches lie open!',
        lose: 'The ward discharges into you with a crack.' }
    ]
  },
  {
    name: 'Crystal Conduit', type: 'room', reward: { kind: 'shortcut' },
    desc: 'Floating crystals hum with untapped energy, begging for alignment.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Study the resonance',
        win: 'You deduce the alignment sequence and nudge one crystal — the rest follow.',
        lose: 'The pattern shifts faster than you can chart it.' },
      { tier: 'standard', skill: 'arcana', label: 'Align the crystals',
        win: 'The crystals lock into alignment, creating a teleport nexus for this floor.',
        lose: 'The crystals dim. The resonance eludes you.' },
      { tier: 'risky', skill: 'arcana', label: 'Force the resonance', failEffect: 'damage',
        win: 'You slam the frequencies together — the nexus roars to life, shedding crystal shards worth a fortune!',
        lose: 'A crystal shatters, spraying you with shards.' }
    ]
  },
  {
    name: 'Identify Enchantment', type: 'postClear', reward: { kind: 'reveal' },
    desc: 'Magical residue lingers from the defeated caster.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Sift the residue',
        win: 'Scorch marks point the way — you sketch a partial route toward the boss lair.',
        lose: 'The residue is too scattered to read.' },
      { tier: 'standard', skill: 'arcana', label: 'Read the residue',
        win: 'The residue reveals a vision of the boss chamber and its location on your map.',
        lose: 'The residue fades too quickly to read.' }
    ]
  },

  /* ------- Intelligence: History ------- */
  {
    name: 'Annal Tablet', type: 'room', reward: { kind: 'reveal' },
    desc: 'An ancient stone tablet is carved with intricate script.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Copy the carvings',
        win: 'Your careful rubbing captures a floor plan etched into the border.',
        lose: 'The rubbing smears. Nothing legible survives.' },
      { tier: 'standard', skill: 'history', label: 'Translate the script',
        win: 'You decipher the annals — the floor layout is revealed on your minimap.',
        lose: 'The script is too eroded to read.' },
      { tier: 'risky', skill: 'arcana', label: 'Divine the meaning',
        win: 'You let the tablet speak through you — the whole floor unfolds in your mind, and the vision points to buried coin!',
        lose: 'The divination collapses into noise and a splitting headache.' }
    ]
  },
  {
    name: 'Tomb Rite', type: 'room', reward: { kind: 'item' },
    desc: 'A sarcophagus bears funerary inscriptions.',
    approaches: [
      { tier: 'safe', skill: 'religion', label: 'Offer a simple blessing',
        win: 'The spirit accepts your respect. The lid slides open an inch — enough.',
        lose: 'The blessing goes unanswered. The lid stays sealed.' },
      { tier: 'standard', skill: 'history', label: 'Recite the burial rites',
        win: 'You recite the ancient rites. The sarcophagus opens, yielding fine grave goods.',
        lose: 'A spectral wail echoes through the chamber, but the lid holds.' },
      { tier: 'risky', skill: 'athletics', label: 'Force the lid', failEffect: 'damage',
        win: 'Stone grinds aside — the occupant was buried with everything they owned!',
        lose: 'The lid slams back down on your fingers, and a chill saps your strength.' }
    ]
  },
  {
    name: 'Architect Insight', type: 'postClear', reward: { kind: 'secret' },
    desc: 'The room\'s architectural style is distinctive.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Pace the walls',
        win: 'One wall is two feet thicker than it should be. A secret door!',
        lose: 'The walls measure true. Nothing hidden.' },
      { tier: 'standard', skill: 'history', label: 'Read the builder\'s style',
        win: 'You recognize the builder\'s mark — a secret door is nearby!',
        lose: 'The room looks ordinary. No secrets here.' }
    ]
  },

  /* ------- Intelligence: Investigation ------- */
  {
    name: 'Hidden Armory', type: 'postClear', reward: { kind: 'item' },
    desc: 'This room feels like it might have a concealed storage area.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Check for scuff marks',
        win: 'Drag marks lead to a false panel — a piece of gear inside!',
        lose: 'The floor tells you nothing.' },
      { tier: 'standard', skill: 'investigation', label: 'Search methodically',
        win: 'Behind a false wall panel, you discover a piece of gear!',
        lose: 'You find nothing of value.' },
      { tier: 'risky', skill: 'athletics', label: 'Tear out the panels', failEffect: 'damage',
        win: 'You rip every panel off the walls — an entire hidden rack of equipment!',
        lose: 'A panel splinters, driving spikes into your hand.' }
    ]
  },
  {
    name: 'Pressure Plate Puzzle', type: 'room', reward: { kind: 'gold' },
    desc: 'A patterned floor stretches ahead. One wrong step and darts fly.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Watch the dust patterns',
        win: 'Undisturbed dust marks the safe tiles. You cross to the pedestal at a stroll.',
        lose: 'The dust lies evenly everywhere. No hints.' },
      { tier: 'standard', skill: 'investigation', label: 'Deduce the safe path', failEffect: 'damage',
        win: 'You map the safe path and reach the reward pedestal at the center.',
        lose: 'A wrong step triggers a dart trap! The party takes some scratches.' },
      { tier: 'risky', skill: 'acrobatics', label: 'Dance across the plates', failEffect: 'damage',
        win: 'You cartwheel through the dart volleys untouched and empty the pedestal — twice over!',
        lose: 'Darts fill the air, and you catch several.' }
    ]
  },
  {
    name: 'Search for Clues', type: 'postClear', reward: { kind: 'info' },
    desc: 'A discarded journal lies in the corner.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Skim the journal',
        win: 'A few legible pages hold useful notes about this dungeon.',
        lose: 'The journal is mostly illegible.' },
      { tier: 'standard', skill: 'history', label: 'Cross-reference the entries',
        win: 'Dates and names line up — the journal yields real tactical insight.',
        lose: 'The references lead nowhere.' }
    ]
  },

  /* ------- Intelligence: Nature ------- */
  {
    name: 'Overgrown Grove', type: 'room', reward: { kind: 'potion' },
    desc: 'Rare alchemical herbs grow among the ancient roots.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Gather the obvious herbs',
        win: 'You collect the common healing herbs you recognize on sight.',
        lose: 'The plants are common weeds. Nothing useful.' },
      { tier: 'standard', skill: 'nature', label: 'Harvest the rare specimens',
        win: 'You gather several prime specimens — enough for healing potions!',
        lose: 'The rare herbs crumble at your touch. Wrong season.' },
      { tier: 'risky', skill: 'nature', label: 'Strip the whole grove', failEffect: 'damage',
        win: 'You harvest everything — a full satchel of alchemical treasure!',
        lose: 'A defensive bloom bursts, searing your skin with sap.' }
    ]
  },
  {
    name: 'Mushroom Chamber', type: 'room', reward: { kind: 'heal' },
    desc: 'A dazzling array of fungi covers the walls. Some heal — some kill.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Pick only what you know',
        win: 'A modest handful of trusted caps — the party shares a small meal.',
        lose: 'Nothing here you can vouch for. Better hungry than dead.' },
      { tier: 'standard', skill: 'nature', label: 'Sort edible from deadly',
        win: 'You sort the edible from the poisonous. The party shares the safe ones.',
        lose: 'Sleep spores trigger! The party coughs in the haze.' },
      { tier: 'risky', skill: 'nature', label: 'Trust your gut and feast', failEffect: 'damage',
        win: 'Every cap you pick is a restorative rarity — the party feasts!',
        lose: 'That one was definitely poison.' }
    ]
  },
  {
    name: 'Toxic Pool', type: 'postClear', reward: { kind: 'gold' },
    desc: 'A pool of bubbling gas fills a low section of the room. A stash glints on the far side.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Wait and watch the fumes',
        win: 'The gas ebbs on a cycle. You time your crossing and back with room to spare.',
        lose: 'The fumes never thin. Not worth the lungs.' },
      { tier: 'standard', skill: 'nature', label: 'Read the gas currents',
        win: 'You identify the clear route through the gas and reach the stash.',
        lose: 'The gas stings your eyes. You retreat.' },
      { tier: 'risky', skill: 'athletics', label: 'Hold breath and dash', failEffect: 'damage',
        win: 'Thirty seconds of sprinting through poison — and you carry back everything!',
        lose: 'You gasp halfway. The gas burns going down.' }
    ]
  },

  /* ------- Intelligence: Religion ------- */
  {
    name: 'Desecrated Shrine', type: 'room', reward: { kind: 'shortRest', fullHeal: true },
    desc: 'A once-holy shrine has been corrupted by dark energy.',
    approaches: [
      { tier: 'safe', skill: 'religion', label: 'Cleanse the outer icons',
        win: 'The icons brighten. A gentle warmth settles over the party as it rests.',
        lose: 'The grime won\'t lift. The corruption runs deeper than the surface.' },
      { tier: 'standard', skill: 'religion', label: 'Perform the purification',
        win: 'The shrine glows with restored light — the party rests, fully healed!',
        lose: 'The corruption holds. The shrine remains defiled.' },
      { tier: 'risky', skill: 'arcana', label: 'Burn out the corruption', failEffect: 'damage',
        win: 'Dark energy screams out of the stone — the shrine blazes, and its offering bowl fills with old tithes!',
        lose: 'The corruption lashes back before the ritual completes.' }
    ]
  },
  {
    name: 'Heretic Ward', type: 'room', reward: { kind: 'item' },
    desc: 'Profane symbols seal this door.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Find the anchor glyph',
        win: 'Every ward has a keystone. You scratch through it and the seal unravels.',
        lose: 'The glyphs loop into themselves. No anchor found.' },
      { tier: 'standard', skill: 'religion', label: 'Recite the counter-litany',
        win: 'Your recitation breaks the ward! The door swings open to a bonus chamber.',
        lose: 'The symbols flash red. The door stays sealed.' },
      { tier: 'risky', skill: 'athletics', label: 'Break the door down', failEffect: 'alert',
        win: 'Ward or no ward, hinges are hinges. The chamber and everything in it is yours!',
        lose: 'The ward detonates with a thunderclap heard through the whole floor.' }
    ]
  },
  {
    name: 'Holy Symbol', type: 'room', reward: { kind: 'gold' },
    desc: 'A buried relic peeks from the rubble.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Dig it out carefully',
        win: 'You free the relic intact — a collector will pay well.',
        lose: 'It crumbles as you pull. Just corroded tin.' },
      { tier: 'standard', skill: 'religion', label: 'Identify the relic',
        win: 'You recognize the holy symbol and recover it properly — a valuable find!',
        lose: 'Just a rock. Nothing special.' }
    ]
  },

  /* ------- Wisdom: Animal Handling ------- */
  {
    name: 'Caged Beast', type: 'room', reward: { kind: 'buff' },
    desc: 'A magical creature is trapped in a cage. It looks scared but not hostile.',
    approaches: [
      { tier: 'safe', skill: 'nature', label: 'Read its body language',
        win: 'You understand what it needs and it warms to you, sniffing out hidden things nearby.',
        lose: 'The creature stays pressed to the far bars.' },
      { tier: 'standard', skill: 'animalHandling', label: 'Befriend the creature',
        win: 'You befriend the creature! It follows the party, sniffing out hidden items.',
        lose: 'The creature cowers in the back of its cage, unreachable.' },
      { tier: 'risky', skill: 'animalHandling', label: 'Open the cage', failEffect: 'damage',
        win: 'It bounds out — and adopts the whole party, dragging over a buried keepsake as tribute!',
        lose: 'It panics and rakes you on the way out.' }
    ]
  },
  {
    name: 'Pack Beast', type: 'room', reward: { kind: 'gold' },
    desc: 'A spooked pack mule carries valuable goods. It\'s about to bolt.',
    approaches: [
      { tier: 'safe', skill: 'nature', label: 'Calm it with fodder',
        win: 'It settles over a handful of feed and lets you unstrap a saddlebag.',
        lose: 'It shies from your hand and trots away.' },
      { tier: 'standard', skill: 'animalHandling', label: 'Soothe the mule',
        win: 'You soothe the mule. It drops its cargo before trotting off.',
        lose: 'The mule bolts with the goods.' },
      { tier: 'risky', skill: 'athletics', label: 'Grab the harness', failEffect: 'damage',
        win: 'You wrestle the mule still — every saddlebag is yours!',
        lose: 'A hoof catches you square in the ribs.' }
    ]
  },
  {
    name: 'Lost Pet', type: 'postClear', reward: { kind: 'item' },
    desc: 'A lost drake pup sniffs at your pack.',
    approaches: [
      { tier: 'safe', skill: 'nature', label: 'Leave a scent trail',
        win: 'It follows the trail of jerky right to you — then leads you to its owner\'s pack.',
        lose: 'It loses interest and skitters off.' },
      { tier: 'standard', skill: 'animalHandling', label: 'Win its trust',
        win: 'The drake wags its tail and leads you to its former owner\'s stash!',
        lose: 'It runs away before you can approach.' }
    ]
  },

  /* ------- Wisdom: Insight ------- */
  {
    name: 'Mimic Sense', type: 'room', reward: { kind: 'info' },
    desc: 'Something feels wrong about that chest in the corner.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Watch from a distance',
        win: 'You catch it breathing. Mimic confirmed — the party won\'t be surprised.',
        lose: 'It looks like a chest. Probably. You keep your distance anyway.' },
      { tier: 'standard', skill: 'insight', label: 'Study its tells',
        win: 'You spot the telltale signs — it\'s a mimic! The party strikes first.',
        lose: 'Seems normal enough. You proceed cautiously.' },
      { tier: 'risky', skill: 'athletics', label: 'Poke it with a sword', failEffect: 'damage',
        win: 'It shrieks and spits out its swallowed hoard before fleeing into the dark!',
        lose: 'It bites the sword — and your arm with it.' }
    ]
  },
  {
    name: 'Merchant Riddle', type: 'camp', reward: { kind: 'gold' },
    desc: 'The camp merchant smiles slyly. "Answer my riddle, and the discount is steep."',
    approaches: [
      { tier: 'safe', skill: 'history', label: 'Recall old riddle-lore',
        win: 'An old chestnut — you\'ve read this one. The merchant grumbles and pays out.',
        lose: 'None of your books covered this one.' },
      { tier: 'standard', skill: 'insight', label: 'See through the trick',
        win: 'You see through the merchant\'s trick and claim the prize!',
        lose: 'The riddle stumps you. You pay the normal price.' }
    ]
  },
  {
    name: 'Fake Wall', type: 'postClear', reward: { kind: 'item' },
    desc: 'The room feels slightly too small for its outer dimensions.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Listen for drafts',
        win: 'A whisper of moving air betrays the seam. The hidden room opens.',
        lose: 'The air is dead still.' },
      { tier: 'standard', skill: 'insight', label: 'Feel what\'s off about the room',
        win: 'A section of wall sounds hollow! You break through to a secret room with loot.',
        lose: 'Nothing unusual about these walls.' },
      { tier: 'risky', skill: 'athletics', label: 'Knock the wall in', failEffect: 'damage',
        win: 'The false wall caves — the smugglers\' whole cache spills out!',
        lose: 'That wall was real. Your shoulder disagrees with it.' }
    ]
  },

  /* ------- Wisdom: Medicine ------- */
  {
    name: 'Sick Wanderer', type: 'room', reward: { kind: 'secret' },
    desc: 'A wounded NPC lies against the wall, feverish and weak.',
    approaches: [
      { tier: 'safe', skill: 'nature', label: 'Brew a folk remedy',
        win: 'The tea breaks the fever. Grateful, they tell you of a hidden room.',
        lose: 'The remedy soothes but doesn\'t cure. They sleep restlessly.' },
      { tier: 'standard', skill: 'medicine', label: 'Diagnose and treat',
        win: 'You treat the ailment. Grateful, they hand you a key to a locked door on this floor.',
        lose: 'The ailment is beyond your skill.' },
      { tier: 'risky', skill: 'medicine', label: 'Attempt the risky surgery',
        win: 'The surgery succeeds beyond hope! They press their entire map and coin purse on you.',
        lose: 'You do more harm than good. They wave you away, wincing.' }
    ]
  },
  {
    name: 'Triage Aftermath', type: 'postClear', reward: { kind: 'heal' },
    desc: 'After the fight, the party\'s wounds need tending.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Apply salves and rest',
        win: 'Field salves take the edge off — everyone feels a little better.',
        lose: 'The salves have gone rancid. No help there.' },
      { tier: 'standard', skill: 'medicine', label: 'Proper triage',
        win: 'You bandage wounds and set minor fractures — everyone regains vitality.',
        lose: 'The injuries are too fresh for field medicine to help much.' },
      { tier: 'risky', skill: 'medicine', label: 'Aggressive field surgery', failEffect: 'damage',
        win: 'Stitches, splints, and one very brave incision — the party feels remade!',
        lose: 'The scalpel slips. Now there\'s one more wound to bind.' }
    ]
  },
  {
    name: 'Plague Source', type: 'room', reward: { kind: 'info' },
    desc: 'A foul contamination seeps from a crack in the floor.',
    approaches: [
      { tier: 'safe', skill: 'nature', label: 'Read the flora die-off',
        win: 'The withered moss maps the seepage. You chart the safe ground for the party.',
        lose: 'The die-off pattern makes no sense.' },
      { tier: 'standard', skill: 'medicine', label: 'Neutralize the source',
        win: 'You identify the contamination and neutralize it. The area is safe now.',
        lose: 'The contamination remains, too hazardous to approach.' },
      { tier: 'risky', skill: 'arcana', label: 'Purge it with raw magic', failEffect: 'damage',
        win: 'Your purge sterilizes the crack — and crystallizes the residue into something sellable!',
        lose: 'The purge backfires, splashing you with the stuff.' }
    ]
  },

  /* ------- Wisdom: Perception ------- */
  {
    name: 'Secret Junction', type: 'room', reward: { kind: 'item' },
    desc: 'Something about this room feels off, like there\'s more here than meets the eye.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Measure the room',
        win: 'The math doesn\'t add up — and the missing space holds a cache.',
        lose: 'The dimensions check out. Just a room.' },
      { tier: 'standard', skill: 'perception', label: 'Spot the hairline crack',
        win: 'You notice a hairline crack in the masonry — a secret door! It leads to a bonus room.',
        lose: 'The walls are blank. Nothing hidden here.' },
      { tier: 'risky', skill: 'athletics', label: 'Sound the walls with a hammer', failEffect: 'alert',
        win: 'CLANG — hollow! You smash straight into the hidden vault!',
        lose: 'The hammering echoes down every corridor on the floor.' }
    ]
  },
  {
    name: 'Hidden Switch', type: 'room', reward: { kind: 'gold' },
    desc: 'The floor has a subtle pattern. One stone might be a pressure switch.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Map the floor pattern',
        win: 'The pattern resolves into a sequence. The last stone sinks with a click.',
        lose: 'The pattern repeats endlessly. No anomaly.' },
      { tier: 'standard', skill: 'perception', label: 'Spot the depression',
        win: 'You spot the worn depression. Stepping on it opens a treasure alcove!',
        lose: 'Nothing stands out. Just another room.' },
      { tier: 'risky', skill: 'athletics', label: 'Stomp every stone', failEffect: 'damage',
        win: 'Stomp seventeen finds it — the alcove opens wide, twice the cache you hoped for!',
        lose: 'Stomp nine was a spike trigger.' }
    ]
  },
  {
    name: 'Ambush Warning', type: 'postClear', reward: { kind: 'info' },
    desc: 'The signs are subtle — disturbed dust, a faint smell. You might not be alone.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Read the tracks',
        win: 'Fresh tracks, headed east. The party won\'t be caught off guard.',
        lose: 'The tracks are old. Or you\'re reading them wrong.' },
      { tier: 'standard', skill: 'perception', label: 'Notice the disturbed dust',
        win: 'You notice tracks! A lurking monster group is nearby — the party prepares.',
        lose: 'No sign of anything lurking nearby.' }
    ]
  },
  {
    name: 'Treasure Glint', type: 'postClear', reward: { kind: 'gold' },
    desc: 'Torchlight catches something shiny in the rubble.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Follow the glint',
        win: 'A coin — and a thin trail of them leading to a spilled purse.',
        lose: 'Just a shadow playing tricks on you.' },
      { tier: 'standard', skill: 'investigation', label: 'Dig through the rubble',
        win: 'You pry up a loose stone and find a small cache of gold!',
        lose: 'Nothing under the rubble but more rubble.' },
      { tier: 'risky', skill: 'athletics', label: 'Heave the slab aside', failEffect: 'damage',
        win: 'Under the slab: an entire strongbox, untouched for a century!',
        lose: 'The slab slips and pins your foot.' }
    ]
  },

  /* ------- Wisdom: Survival ------- */
  {
    name: 'Lost Trail', type: 'room', reward: { kind: 'shortcut' },
    desc: 'The path ahead forks. One way winds — the other might be a shortcut.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Follow the worn path',
        win: 'Boot-worn stone marks the traveled route — a modest shortcut.',
        lose: 'The trail leads in circles.' },
      { tier: 'standard', skill: 'nature', label: 'Read the moss and airflow',
        win: 'The draft and moss growth point true — a shortcut straight toward the boss.',
        lose: 'The signs contradict each other.' },
      { tier: 'risky', skill: 'acrobatics', label: 'Take the vertical shortcut', failEffect: 'damage',
        win: 'Up the wall, along a beam, down a shaft — you cut past half the floor and land beside someone\'s dropped purse!',
        lose: 'The beam snaps. It\'s a long way down.' }
    ]
  },
  {
    name: 'Forage Supplies', type: 'postClear', reward: { kind: 'potion' },
    desc: 'The area has edible plants and hidden caches if you know where to look.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Gather the basics',
        win: 'You scavenge successfully, finding useful supplies.',
        lose: 'Nothing useful here.' },
      { tier: 'standard', skill: 'nature', label: 'Harvest medicinal plants',
        win: 'Proper herbs, properly cut — the makings of good medicine.',
        lose: 'The medicinal plants are all blighted.' }
    ]
  },
  {
    name: 'Safe Camp', type: 'postClear', reward: { kind: 'shortRest' },
    desc: 'This nook could serve as a safe resting spot — if it\'s as sheltered as it looks.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Fortify the nook',
        win: 'Barricaded and quiet — the party takes a short rest.',
        lose: 'Too exposed even with barricades. No rest here.' },
      { tier: 'standard', skill: 'perception', label: 'Verify it\'s truly hidden',
        win: 'Sightlines checked, approaches watched — the party rests easy.',
        lose: 'You spot three ways a monster could stumble in. Not safe.' },
      { tier: 'risky', skill: 'stealth', label: 'Rest right here, quietly', party: true, failEffect: 'alert',
        win: 'The whole party rests in perfect silence — deeply, wonderfully. And someone finds coins in the bedding!',
        lose: 'A snore. A loud one. Things are coming.' }
    ]
  },
  {
    name: 'Environment Hazard', type: 'room', reward: { kind: 'gold' },
    desc: 'The ceiling groans under shifting weight. Treasure lies beyond the unstable stretch.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Chart the stable ground',
        win: 'You guide the party through the unstable area safely, reaching the treasure.',
        lose: 'No stable line through. You turn back.' },
      { tier: 'standard', skill: 'acrobatics', label: 'Pick through nimbly',
        win: 'Quick feet on solid spots — you\'re across and back with the goods.',
        lose: 'A near-miss from falling rock ends the attempt.' },
      { tier: 'risky', skill: 'athletics', label: 'Everyone sprints through', party: true, failEffect: 'damage',
        win: 'The party sprints as the ceiling rains stone — everyone through, arms full of everything!',
        lose: 'The collapse catches the stragglers.' }
    ]
  },

  /* ------- Charisma: Deception ------- */
  {
    name: 'Bluff the Sentinel', type: 'room', reward: { kind: 'item' },
    desc: 'A spectral sentinel bars the way. It might respond to authority — or a convincing lie.',
    approaches: [
      { tier: 'safe', skill: 'history', label: 'Cite the old passphrases',
        win: 'The archaic greeting you recall satisfies its ancient orders. It stands aside.',
        lose: 'The passphrase has evidently changed in the last thousand years.' },
      { tier: 'standard', skill: 'deception', label: 'Bluff with confidence',
        win: 'Your confident bluff convinces the sentinel you belong here. It reveals the room\'s treasure.',
        lose: 'The sentinel doesn\'t buy it.' },
      { tier: 'risky', skill: 'intimidation', label: 'Command it to kneel', failEffect: 'alert',
        win: 'It KNEELS. And surrenders the vault inventory it was guarding!',
        lose: 'Its shriek of outrage rings through the dungeon.' }
    ]
  },
  {
    name: 'Feign Authority', type: 'postClear', reward: { kind: 'gold' },
    desc: 'An official-looking courier approaches with a heavy satchel.',
    approaches: [
      { tier: 'safe', skill: 'insight', label: 'Size up the courier',
        win: 'You read them perfectly and talk your way into a "delivery fee".',
        lose: 'They\'re unreadable. Best not to risk it.' },
      { tier: 'standard', skill: 'deception', label: 'Pose as an inspector',
        win: 'You pose as an inspector so convincingly the courier hands over a tribute of gold!',
        lose: 'You\'re ignored. The courier passes by.' },
      { tier: 'risky', skill: 'intimidation', label: 'Shake them down', failEffect: 'alert',
        win: 'They empty the whole satchel and run!',
        lose: 'They blow a warning whistle as they flee.' }
    ]
  },
  {
    name: 'False Trail', type: 'postClear', reward: { kind: 'item' },
    desc: 'A rival party\'s tracks cross yours.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Study the rival tracks',
        win: 'You backtrack them to a stashed supply drop. Finders keepers.',
        lose: 'The tracks scatter over stone and vanish.' },
      { tier: 'standard', skill: 'deception', label: 'Plant misdirection',
        win: 'The rivals follow your false trail and abandon their supplies. You claim the spoils!',
        lose: 'No one takes the bait.' }
    ]
  },

  /* ------- Charisma: Intimidation ------- */
  {
    name: 'Cower the Scavengers', type: 'room', reward: { kind: 'gold' },
    desc: 'A pack of scavengers has claimed a cache of treasure.',
    approaches: [
      { tier: 'safe', skill: 'animalHandling', label: 'Shoo them off gently',
        win: 'Calm, firm gestures move them along. Most of the cache remains.',
        lose: 'They snap and hold their ground.' },
      { tier: 'standard', skill: 'intimidation', label: 'A fierce display',
        win: 'Your fierce display sends them scurrying! You collect their hoard.',
        lose: 'They scatter, but take the goods with them.' },
      { tier: 'risky', skill: 'athletics', label: 'Charge the pack', failEffect: 'damage',
        win: 'You scatter them like leaves and claim everything they\'ve ever hoarded!',
        lose: 'The pack swarms you before fleeing.' }
    ]
  },
  {
    name: 'Demand Passage', type: 'room', reward: { kind: 'item' },
    desc: 'A greedy gatekeeper demands tribute to pass.',
    approaches: [
      { tier: 'safe', skill: 'persuasion', label: 'Haggle the toll down',
        win: 'You talk the toll down to nothing — and charm a "gift" out of them besides.',
        lose: 'The gatekeeper holds firm on the price.' },
      { tier: 'standard', skill: 'intimidation', label: 'Bully your way through',
        win: 'Your threatening presence convinces the gatekeeper to let you pass — with an apology gift.',
        lose: 'The gatekeeper holds firm, unimpressed.' },
      { tier: 'risky', skill: 'stealth', label: 'Slip past while they argue', failEffect: 'alert',
        win: 'While the gatekeeper lectures your decoy, the rest of you clean out the toll box!',
        lose: 'Caught red-handed. The gatekeeper\'s bellow carries far.' }
    ]
  },
  {
    name: 'Awe the Cultist', type: 'postClear', reward: { kind: 'buff' },
    desc: 'A lone cultist recognizes your reputation.',
    approaches: [
      { tier: 'safe', skill: 'insight', label: 'Read their fears',
        win: 'You see exactly what they dread and let them imagine it. They talk.',
        lose: 'Their fanaticism is a closed book.' },
      { tier: 'standard', skill: 'intimidation', label: 'Press your reputation',
        win: 'The cultist quakes and reveals the boss\'s weakness!',
        lose: 'The cultist flees before you can question them.' },
      { tier: 'risky', skill: 'deception', label: 'Claim to be their dark master', failEffect: 'alert',
        win: 'They prostrate themselves and confess EVERYTHING — weaknesses, patrols, and where the tithes are kept!',
        lose: 'The real dark master, it seems, has a secret handshake. The alarm goes up.' }
    ]
  },

  /* ------- Charisma: Performance ------- */
  {
    name: 'Riddle Court', type: 'room', reward: { kind: 'buff' },
    desc: 'A fey creature blocks the path, demanding entertainment.',
    approaches: [
      { tier: 'safe', skill: 'history', label: 'Recite an old fey tale',
        win: 'It knows the tale — and adores your telling. A small boon is granted.',
        lose: 'It has heard that one. Many times. It yawns.' },
      { tier: 'standard', skill: 'performance', label: 'Sing for the fey',
        win: 'Your performance delights the fey! It grants a boon.',
        lose: 'The fey is bored. You\'re dismissed with nothing.' },
      { tier: 'risky', skill: 'deception', label: 'Flatter with an invented epic', failEffect: 'damage',
        win: 'Your shameless invented epic of its glory earns a mighty boon and a purse of fey gold!',
        lose: 'Fey take poorly to flattery they see through. The curse stings.' }
    ]
  },
  {
    name: 'Echoing Alcove', type: 'room', reward: { kind: 'potion' },
    desc: 'A magical instrument sits in an alcove with strange notation.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Study the notation',
        win: 'You work out the sequence note by note. A compartment slides open.',
        lose: 'The notation defies analysis.' },
      { tier: 'standard', skill: 'performance', label: 'Play the melody',
        win: 'Your melody resonates with the room\'s magic. A hidden compartment slides open!',
        lose: 'A discordant noise. Nothing happens.' },
      { tier: 'risky', skill: 'arcana', label: 'Amplify it with magic', failEffect: 'alert',
        win: 'The amplified chord opens every compartment in the alcove at once!',
        lose: 'The amplified discord howls through the entire floor.' }
    ]
  },
  {
    name: 'Distract the Guard', type: 'room', reward: { kind: 'item' },
    desc: 'A roaming guard patrols near a treasure.',
    approaches: [
      { tier: 'safe', skill: 'stealth', label: 'Wait for the patrol gap',
        win: 'Patience pays. In the gap between rounds, the treasure walks off with you.',
        lose: 'The patrol never leaves a gap wide enough.' },
      { tier: 'standard', skill: 'performance', label: 'Put on a show',
        win: 'The guard is captivated! Someone else slips past to snag the treasure.',
        lose: 'The guard ignores your antics. No opening.' },
      { tier: 'risky', skill: 'sleightOfHand', label: 'Pickpocket mid-patrol', failEffect: 'alert',
        win: 'You lift the treasure AND the guard\'s own coin purse in one pass!',
        lose: 'A hand on your wrist. A whistle. Running.' }
    ]
  },

  /* ------- Charisma: Persuasion ------- */
  {
    name: 'Merchant Discount', type: 'camp', reward: { kind: 'buff' },
    desc: 'The merchant quotes a high price.',
    approaches: [
      { tier: 'safe', skill: 'insight', label: 'Spot what the merchant needs',
        win: 'You notice their worn boots and trade dungeon gossip for a discount.',
        lose: 'The merchant\'s needs remain a mystery.' },
      { tier: 'standard', skill: 'persuasion', label: 'Charm the merchant',
        win: 'Your silver tongue works wonders — prices reduced for this visit!',
        lose: 'The merchant holds firm on prices.' }
    ]
  },
  {
    name: 'Freed Captive', type: 'room', reward: { kind: 'secret' },
    desc: 'A prisoner cowers in a cage.',
    approaches: [
      { tier: 'safe', skill: 'insight', label: 'Earn trust slowly',
        win: 'Patience wins them over. They whisper of a hidden room.',
        lose: 'They stay silent, eyes down.' },
      { tier: 'standard', skill: 'persuasion', label: 'Convince them quickly',
        win: 'You convince the prisoner you\'re trustworthy. They reveal a secret room!',
        lose: 'The captive clams up and leaves without a word.' },
      { tier: 'risky', skill: 'athletics', label: 'Break the cage open', failEffect: 'alert',
        win: 'The cage bursts — the grateful captive maps every secret they overheard!',
        lose: 'The cage\'s alarm chain rattles through the halls.' }
    ]
  },
  {
    name: 'Calm the Crowd', type: 'room', reward: { kind: 'gold' },
    desc: 'Hostile NPCs are on the verge of attacking.',
    approaches: [
      { tier: 'safe', skill: 'insight', label: 'Find the ringleader',
        win: 'You pick out the instigator and quietly talk them down. The rest deflate.',
        lose: 'No clear leader. The mob is a hydra.' },
      { tier: 'standard', skill: 'persuasion', label: 'Talk them down',
        win: 'Your measured words defuse the tension. The room resolves peacefully, with compensation.',
        lose: 'They mutter and disperse, giving nothing.' },
      { tier: 'risky', skill: 'intimidation', label: 'The party stares them down', party: true, failEffect: 'alert',
        win: 'Five unblinking stares. The crowd drops their weapons AND their purses.',
        lose: 'The staredown fails and the shouting draws every ear on the floor.' }
    ]
  },

  /* ==================================================================
     Expansion set — richer rewards (tempHp/xp/cleanse/abilityCharge/
     summonAlly/buffEffect) and harsher consequences (debuff/trap/noise/
     curse/frighten/poison/setback). Sparse skills (Stealth) topped up.
     ================================================================== */

  /* -- Athletics -- */
  {
    name: 'Collapsing Pillar', type: 'room', reward: { kind: 'buffEffect', buffKey: 'hasted', buffTargets: 'party', buffDuration: 20 },
    desc: 'A cracked pillar groans over a narrow gap. Bracing it could let the whole party dash through before it falls.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Time the groans',
        win: 'You read the rhythm and pick a safe moment.',
        lose: 'The groans are erratic — you wait it out.' },
      { tier: 'standard', skill: 'athletics', label: 'Brace and sprint',
        win: 'You shoulder the pillar and the party bolts through, hearts pounding.',
        lose: 'The pillar bucks you off — dust and stone rain down.' },
      { tier: 'risky', skill: 'athletics', label: 'Hold it for everyone', party: true, failEffect: 'trap',
        win: 'You hold the stone long enough for five pairs of boots — then leap clear as it crashes!',
        lose: 'It gives way mid-crossing. Debris hammers the rearmost.',
        fail: { damage: [2, 6, 1], damageType: 'crushing' } }
    ]
  },
  {
    name: 'Boulder Crush', type: 'room', reward: { kind: 'gold' },
    desc: 'A massive boulder blocks a side passage — and there\'s a glint of coin behind it.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Find the leverage point',
        win: 'You locate a fulcrum and roll it aside with ease.',
        lose: 'No good angle — it barely budges.' },
      { tier: 'standard', skill: 'athletics', label: 'Heave together',
        win: 'Muscle prevails. The hoard behind is yours.',
        lose: 'It rolls back, pinning your purse of coin in the dirt.', failEffect: 'setback',
        fail: { goldLossMult: 0.08 } },
      { tier: 'risky', skill: 'athletics', label: 'Crack it with a spike', party: true, failEffect: 'trap',
        win: 'The boulder splits clean — the treasure spills out!',
        lose: 'Shrapnel bursts outward as it cracks.',
        fail: { damage: [2, 4, 2], damageType: 'crushing' } }
    ]
  },

  /* -- Acrobatics -- */
  {
    name: 'Geyser Vault', type: 'room', reward: { kind: 'tempHp', amount: 8 },
    desc: 'Scalding geysers erupt in a slow, predictable rhythm across a treasure plaza. The spray itself is invigorating to brave.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Watch the cycle',
        win: 'You map the cycle and pick the calm path.',
        lose: 'The pattern is too erratic — you stay put.' },
      { tier: 'standard', skill: 'acrobatics', label: 'Leap between plumes',
        win: 'You weave the eruptions, skin flushed with heat — you feel invincible.',
        lose: 'A plume catches you. Painful, but you retreat alive.' },
      { tier: 'risky', skill: 'acrobatics', label: 'Bathe in the spray', party: true, failEffect: 'trap',
        win: 'The whole party storms the plaza — the steam hardens you for the fights ahead!',
        lose: 'Scalding water hammers everyone down.',
        fail: { damage: [1, 8, 0], damageType: 'fire' } }
    ]
  },
  {
    name: 'Collapsing Stair', type: 'room', reward: { kind: 'buffEffect', buffKey: 'hasted', buffTargets: 'party', buffDuration: 25 },
    desc: 'A grand stair is shedding steps as it falls. Sprinting it grants a rush of speed — if you don\'t fall.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Find sound treads',
        win: 'You hop the intact stones carefully.',
        lose: 'Too risky — you find another way.' },
      { tier: 'standard', skill: 'acrobatics', label: 'Bound up the ruin',
        win: 'You vault the gaps, blood singing — the rush lingers.',
        lose: 'A step gives way; you barely catch the rail.' },
      { tier: 'risky', skill: 'acrobatics', label: 'Race the collapse', party: true, failEffect: 'trap',
        win: 'Five heroes outpace the avalanche of stone — adrenaline carries you onward!',
        lose: 'The stair drops away beneath the slowest.',
        fail: { damage: [1, 6, 1], damageType: 'crushing' } }
    ]
  },

  /* -- Sleight of Hand -- */
  {
    name: 'Poison Needle', type: 'room', reward: { kind: 'gold' },
    desc: 'A jewel sits on a poisoned pedestal. The needle is visible — disarming it cleanly pays double.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Map the trigger',
        win: 'You see exactly where not to touch.',
        lose: 'The mechanism is too fine to read.' },
      { tier: 'standard', skill: 'sleightOfHand', label: 'Lift the jewel clean',
        win: 'Steady hands — the jewel slides free, needle never twitching.',
        lose: 'The needle pricks before you pull clear!', failEffect: 'poison',
        fail: { debuff: 'poisoned', dotDmg: 2, debuffDuration: 30 } },
      { tier: 'risky', skill: 'sleightOfHand', label: 'Strip the whole trap', party: true, failEffect: 'poison',
        win: 'You disarm it AND take the jewel — poison glands and all, worth a fortune.',
        lose: 'A spray of venom catches everyone working close.',
        fail: { debuff: 'poisoned', dotDmg: 3, debuffTargets: 'party', debuffDuration: 30 } }
    ]
  },
  {
    name: 'Switch the Idol', type: 'room', reward: { kind: 'item' },
    desc: 'A gem-eyed idol sits on a weighted altar. A clever swap might let you walk away with the real prize.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Study the weight',
        win: 'You gauge the idol\'s heft perfectly.',
        lose: 'The weight is unclear — too risky.' },
      { tier: 'standard', skill: 'sleightOfHand', label: 'Swap in a fake',
        win: 'A bag of sand trades places with the idol. Clean.',
        lose: 'The altar sinks — darts whistle out!', failEffect: 'trap',
        fail: { damage: [1, 8, 1], damageType: 'piercing' } },
      { tier: 'risky', skill: 'sleightOfHand', label: 'Loot the eyes too', party: true, failEffect: 'trap',
        win: 'Idol, eyes, and all — you strip the altar bare!',
        lose: 'A saw-blade swings across the dais.',
        fail: { damage: [2, 6, 2], damageType: 'slashing' } }
    ]
  },

  /* -- Stealth (topped up) -- */
  {
    name: 'Assassin\'s Perch', type: 'room', reward: { kind: 'item' },
    desc: 'A bolted nest overlooks the chamber — an assassin\'s roost, still stocked. Climbing to it unseen is the trick.',
    approaches: [
      { tier: 'safe', skill: 'athletics', label: 'Climb the open column',
        win: 'You haul up the column in the open and claim the cache.',
        lose: 'The handholds are slick — you slide back.' },
      { tier: 'standard', skill: 'stealth', label: 'Slip up the shadowed side',
        win: 'You reach the roost unheard and pocket the goods.',
        lose: 'A loose tile clatters down — guards turn.' },
      { tier: 'risky', skill: 'stealth', label: 'Rig a rope for the party', party: true, failEffect: 'alert',
        win: 'A silent rope-line and everyone strips the roost together!',
        lose: 'The rope groans; the whole floor hears.' }
    ]
  },
  {
    name: 'Thieves\' Guild Cache', type: 'postClear', reward: { kind: 'gold' },
    desc: 'Signs of the local guild are scratched on the wall — a hidden dead-drop may be near.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Read the scratches',
        win: 'The code points to a loose stone — a small purse inside.',
        lose: 'The markings mean nothing to you.' },
      { tier: 'standard', skill: 'stealth', label: 'Shadow the drop point',
        win: 'You wait motionless, spot the trick stone, and lift a fat pouch.',
        lose: 'You fumble the catch — a bell jingles somewhere.', failEffect: 'alert' }
    ]
  },

  /* -- Arcana -- */
  {
    name: 'Mana Rift', type: 'room', reward: { kind: 'abilityCharge' },
    desc: 'A raw tear in the weave crackles against the wall. Drawing from it could recharge your casters — or burn.',
    approaches: [
      { tier: 'safe', skill: 'arcana', label: 'Sip carefully',
        win: 'A trickle of power flows back into your spells.',
        lose: 'The rift spits sparks; you withdraw.' },
      { tier: 'standard', skill: 'arcana', label: 'Funnel the flow',
        win: 'You shape the rift into a clean current — slots and charges refill!',
        lose: 'The weave snaps back, scrambling your thoughts.', failEffect: 'debuff',
        fail: { debuff: 'baned', debuffDuration: 30 } },
      { tier: 'risky', skill: 'arcana', label: 'Bask in the tear', party: true, failEffect: 'debuff',
        win: 'The party drinks deep — every spell and ability brims full!',
        lose: 'Raw magic sears your minds.',
        fail: { debuff: 'baned', debuffTargets: 'party', debuffDuration: 40 } }
    ]
  },
  {
    name: 'Warding Seal', type: 'room', reward: { kind: 'buffEffect', buffKey: 'shielded', buffTargets: 'party', buffDuration: 30 },
    desc: 'A defensive ward-cluster glows on a door. Re-keying it to your side would shield the party — botching it curses.',
    approaches: [
      { tier: 'safe', skill: 'religion', label: 'Recite the old litany',
        win: 'The ward recognizes the rite and hums to life around you.',
        lose: 'The litany is half-forgotten — the ward stays cold.' },
      { tier: 'standard', skill: 'arcana', label: 'Re-key the runes',
        win: 'You retune the sigils — a shimmering shield wraps the party.',
        lose: 'The runes invert — a curse bleeds out!', failEffect: 'curse',
        fail: { debuff: 'baned' } },
      { tier: 'risky', skill: 'arcana', label: 'Overload the ward', party: true, failEffect: 'curse',
        win: 'The ward flares brilliant and coats everyone in arcane armor!',
        lose: 'The ward detonates, cursing all who stand near.',
        fail: { debuff: 'baned', debuffTargets: 'party' } }
    ]
  },
  {
    name: 'Forbidden Tome', type: 'room', reward: { kind: 'xp', amount: 30 },
    desc: 'A chained grimoire whispers from a lectern. The lore within is potent — and corrosive to the unprepared mind.',
    approaches: [
      { tier: 'safe', skill: 'history', label: 'Skim the margins',
        win: 'You glean a fragment of safe, useful lore.',
        lose: 'The margins are gibberish.' },
      { tier: 'standard', skill: 'arcana', label: 'Read a chapter aloud',
        win: 'Power thrums through you — experience burns itself into memory.',
        lose: 'The words writhe — your stomach turns.', failEffect: 'debuff',
        fail: { debuff: 'frightened', debuffDuration: 20 } },
      { tier: 'risky', skill: 'arcana', label: 'Devour the book', party: true, failEffect: 'debuff',
        win: 'The party absorbs the tome entire — a flood of hard-won insight!',
        lose: 'Forbidden knowledge scourges your minds.',
        fail: { debuff: 'frightened', debuffTargets: 'party', debuffDuration: 30 } }
    ]
  },

  /* -- History -- */
  {
    name: 'Tactician\'s Map', type: 'room', reward: { kind: 'abilityCharge' },
    desc: 'A salt-rotted map shows the floor\'s battles. Reading the old deployments lends cunning to your own.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Note the chokepoints',
        win: 'You mark the safest lanes — a useful edge.',
        lose: 'The ink has bled beyond reading.' },
      { tier: 'standard', skill: 'history', label: 'Reconstruct the campaign',
        win: 'The old general\'s plan clicks into place — your abilities feel refreshed.',
        lose: 'The map crumbles as you handle it.', failEffect: 'noise',
        fail: { noiseRooms: 1 } },
      { tier: 'risky', skill: 'history', label: 'Trace every battle', party: true, failEffect: 'noise',
        win: 'The whole floor\'s history unfolds — your party fights like veterans!',
        lose: 'You argue the tactics aloud — and loudly.',
        fail: { noiseRooms: 2 } }
    ]
  },
  {
    name: 'Battle Standard', type: 'room', reward: { kind: 'buffEffect', buffKey: 'raging', buffTargets: 'party', buffDuration: 25 },
    desc: 'A tattered banner stands in a forgotten rallying point. Raising it might stir old battle-fury.',
    approaches: [
      { tier: 'safe', skill: 'history', label: 'Identify the legion',
        win: 'You name the company — a small, steady pride stirs.',
        lose: 'The standard is too faded to identify.' },
      { tier: 'standard', skill: 'athletics', label: 'Raise the pole',
        win: 'The banner snaps upright — fury kindles in every chest.',
        lose: 'The pole rots through; it falls.' },
      { tier: 'risky', skill: 'intimidation', label: 'Swear the old oath', party: true, failEffect: 'frighten',
        win: 'The oath thunders out — the party is ablaze with rage!',
        lose: 'The oath sits wrong on modern tongues — unease spreads.',
        fail: { debuffTargets: 'party' } }
    ]
  },

  /* -- Investigation -- */
  {
    name: 'Murder Scene', type: 'postClear', reward: { kind: 'info' },
    desc: 'A grisly tableau — an adventurer, dead of something not quite physical. The scene has a story to tell.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Note the wounds',
        win: 'The wound pattern reveals the killer — and its weakness.',
        lose: 'The body tells you nothing new.' },
      { tier: 'standard', skill: 'investigation', label: 'Reconstruct the death',
        win: 'You piece together the last moments — the boss\'s nature is laid bare.',
        lose: 'The scene was staged; you can\'t trust it.', failEffect: 'debuff',
        fail: { debuff: 'frightened', debuffDuration: 15 } }
    ]
  },
  {
    name: 'Pressure Runes', type: 'room', reward: { kind: 'gold' },
    desc: 'Runes on the floor pulse in a weight-sensitive grid. The right path leads to a coffer; the wrong one, fire.',
    approaches: [
      { tier: 'safe', skill: 'arcana', label: 'Read the safe sequence',
        win: 'You decode the safe stones and step across.',
        lose: 'The pattern is too dense to parse.' },
      { tier: 'standard', skill: 'investigation', label: 'Deduce the pattern',
        win: 'Logic wins — you cross and claim the coffer.',
        lose: 'A wrong deduction — gouts of flame!', failEffect: 'trap',
        fail: { damage: [1, 8, 1], damageType: 'fire' } },
      { tier: 'risky', skill: 'investigation', label: 'Sprint the grid', party: true, failEffect: 'trap',
        win: 'You crack the code on the fly — everyone skates through unburned!',
        lose: 'Half the party stands on the wrong stones.',
        fail: { damage: [2, 6, 2], damageType: 'fire' } }
    ]
  },

  /* -- Nature -- */
  {
    name: 'Blood Moss', type: 'room', reward: { kind: 'heal' },
    desc: 'A carpet of crimson moss bleeds a thick, healing nectar — but the spores are toxic if disturbed wrong.',
    approaches: [
      { tier: 'safe', skill: 'survival', label: 'Press the fronds gently',
        win: 'You milk a steady draught of healing nectar.',
        lose: 'The moss is dry here.' },
      { tier: 'standard', skill: 'nature', label: 'Harvest the right crop',
        win: 'You pick only the benign heads — a potent party salve.',
        lose: 'You bruise the wrong heads — spores puff out.', failEffect: 'poison',
        fail: { debuff: 'poisoned', dotDmg: 1, debuffDuration: 20 } },
      { tier: 'risky', skill: 'nature', label: 'Wring the whole carpet', party: true, failEffect: 'poison',
        win: 'You harvest it all — enough nectar to drench the party in healing!',
        lose: 'A cloud of crimson spores chokes everyone.',
        fail: { debuff: 'poisoned', dotDmg: 2, debuffTargets: 'party', debuffDuration: 30 } }
    ]
  },
  {
    name: 'Spirit Grove', type: 'room', reward: { kind: 'cleanse' },
    desc: 'A ring of pale trees hums with cleansing light. Resting in it purges affliction — and steadies the spirit.',
    approaches: [
      { tier: 'safe', skill: 'medicine', label: 'Tend the wounded',
        win: 'A soft mend passes over the party\'s hurts.',
        lose: 'The grove stays quiet.' },
      { tier: 'standard', skill: 'nature', label: 'Breathe the pollen',
        win: 'Light fills every chest — poisons and curses burn away.',
        lose: 'The pollen is too thin to matter.' },
      { tier: 'risky', skill: 'nature', label: 'Invoke the grove\'s spirit', party: true, failEffect: 'debuff',
        win: 'The grove blazes — every debuff scourged, the party inspired!',
        lose: 'The spirit is offended — it saps your vigor.',
        fail: { debuff: 'weakened', debuffTargets: 'party', debuffDuration: 20 } }
    ]
  },

  /* -- Religion -- */
  {
    name: 'Dedicated Offering', type: 'room', reward: { kind: 'buffEffect', buffKey: 'sacredWeapon', buffTargets: 'party', buffDuration: 25 },
    desc: 'An altar waits for an offering of blood or gold. A proper dedication could consecrate your blades.',
    approaches: [
      { tier: 'safe', skill: 'religion', label: 'Leave a token',
        win: 'A faint blessing settles on your weapons.',
        lose: 'The altar rejects the token.' },
      { tier: 'standard', skill: 'religion', label: 'Speak the rite of edge',
        win: 'Your blades shimmer with sacred light.',
        lose: 'The rite is mispronounced — the altar dims.' },
      { tier: 'risky', skill: 'religion', label: 'Anoint every blade', party: true, failEffect: 'curse',
        win: 'The whole party\'s arms blaze with consecrated fire!',
        lose: 'The altar finds your offering wanting — it curses you.',
        fail: { debuff: 'baned', debuffTargets: 'party' } }
    ]
  },
  {
    name: 'Corrupted Font', type: 'room', reward: { kind: 'cleanse' },
    desc: 'A once-holy font now wells with blackness. Cleansing it could purify the party — failing invites the corruption.',
    approaches: [
      { tier: 'safe', skill: 'arcana', label: 'Test the water',
        win: 'A careful dip reveals the cleansing was already done.',
        lose: 'The blackness recoils — you leave it.' },
      { tier: 'standard', skill: 'religion', label: 'Pronounce the exorcism',
        win: 'The blackness boils away — clear water washes the party clean.',
        lose: 'The corruption surges — it stains you.', failEffect: 'curse',
        fail: { debuff: 'baned' } },
      { tier: 'risky', skill: 'religion', label: 'Bathe in the font', party: true, failEffect: 'curse',
        win: 'You scour the font and yourselves in one rite — perfectly pure!',
        lose: 'The corruption drenches everyone.',
        fail: { debuff: 'baned', debuffTargets: 'party' } }
    ]
  },

  /* -- Animal Handling -- */
  {
    name: 'Alpha Wolf', type: 'room', reward: { kind: 'summonAlly' },
    desc: 'A wounded dire-wolf lord snarls from a pit. Dominating it could win a loyal companion for the floor.',
    approaches: [
      { tier: 'safe', skill: 'nature', label: 'Toss it food',
        win: 'It eats, watches you warily, and trots along.',
        lose: 'It turns its nose up and limps away.' },
      { tier: 'standard', skill: 'animalHandling', label: 'Hold out a hand',
        win: 'Yellow eyes meet yours — the alpha lowers its head and joins you.',
        lose: 'It lunges; you barely pull your hand back.', failEffect: 'trap',
        fail: { damage: [1, 6, 0], damageType: 'piercing' } },
      { tier: 'risky', skill: 'animalHandling', label: 'Stare it down', party: true, failEffect: 'trap',
        win: 'The whole party holds its gaze — the wolf submits, proud and loyal!',
        lose: 'It reads your fear and leads the pack in.',
        fail: { damage: [2, 6, 1], damageType: 'piercing' } }
    ]
  },
  {
    name: 'Stag Mount', type: 'room', reward: { kind: 'buffEffect', buffKey: 'remarkableAthlete', buffTargets: 'party', buffDuration: 30 },
    desc: 'A great stag of strange intelligence paws at a gate. Calming it could lend its vigor to the party\'s stride.',
    approaches: [
      { tier: 'safe', skill: 'nature', label: 'Approach with grain',
        win: 'It takes the grain and bows its head — a small spring in your step.',
        lose: 'It shies away into the dark.' },
      { tier: 'standard', skill: 'animalHandling', label: 'Soothe the beast',
        win: 'You lay hands on its flank — its vigor flows into the party.',
        lose: 'It bolts, clipping you with an antler.', failEffect: 'trap',
        fail: { damage: [1, 4, 0], damageType: 'piercing' } },
      { tier: 'risky', skill: 'animalHandling', label: 'Ride it as a mascot', party: true, failEffect: 'trap',
        win: 'The stag accepts you all — the party moves like the wind!',
        lose: 'It panics, trampling everyone in its rush.',
        fail: { damage: [2, 4, 1], damageType: 'crushing' } }
    ]
  },

  /* -- Insight -- */
  {
    name: 'Read the Traitor', type: 'postClear', reward: { kind: 'info' },
    desc: 'A captive taken in the fight sweats and stammers. Reading him right could pry loose the boss\'s secret.',
    approaches: [
      { tier: 'safe', skill: 'persuasion', label: 'Offer a deal',
        win: 'He cracks easily — a useful crumb of intel.',
        lose: 'He clams up, suspicious of the deal.' },
      { tier: 'standard', skill: 'insight', label: 'Spot the lie he wants to tell',
        win: 'You feed him the lie he\'s aching to tell — and learn the boss\'s weakness.',
        lose: 'He reads YOU instead — and grins.', failEffect: 'debuff',
        fail: { debuff: 'baned', debuffDuration: 20 } }
    ]
  },
  {
    name: 'Gambling Den', type: 'postClear', reward: { kind: 'gold' },
    desc: 'A back-room dice table, still felted. The crew here ran — but their pot and their marked dice remain.',
    approaches: [
      { tier: 'safe', skill: 'sleightOfHand', label: 'Pocket the pot',
        win: 'A quick palm — the house\'s loss is your gain.',
        lose: 'The pot was already emptied.' },
      { tier: 'standard', skill: 'insight', label: 'Read the marked dice',
        win: 'You spot the rig and clean out what they stashed.',
        lose: 'You misread the rig — and pay the house back.', failEffect: 'setback',
        fail: { goldLossMult: 0.1 } }
    ]
  },

  /* -- Medicine -- */
  {
    name: 'Field Hospital', type: 'postClear', reward: { kind: 'heal' },
    desc: 'A field surgeon\'s kit lies abandoned, bandages and salves still good. Tending the party now pays double.',
    approaches: [
      { tier: 'safe', skill: 'nature', label: 'Use the salves',
        win: 'A brisk mend passes over everyone.',
        lose: 'The salves have gone rancid.' },
      { tier: 'standard', skill: 'medicine', label: 'Proper triage',
        win: 'You clean, stitch, and dose — the party is healed AND cleansed.',
        lose: 'The kit\'s poultice was tainted.', failEffect: 'poison',
        fail: { debuff: 'poisoned', dotDmg: 1, debuffTargets: 'party', debuffDuration: 20 } }
    ]
  },
  {
    name: 'Plague Corpse', type: 'room', reward: { kind: 'info' },
    desc: 'A plague-riddled corpse slumps against a sealed door. Diagnosing it reveals what — and who — lies beyond.',
    approaches: [
      { tier: 'safe', skill: 'religion', label: 'Last rites and retreat',
        win: 'You note the sores\' pattern as you pray — useful.',
        lose: 'The rites done, you learn nothing new.' },
      { tier: 'standard', skill: 'medicine', label: 'Open the corpse',
        win: 'The plague\'s signature is unmistakable — the boss\'s nature is clear.',
        lose: 'A spray of infected blood catches you.', failEffect: 'poison',
        fail: { debuff: 'poisoned', dotDmg: 2, debuffDuration: 25 } }
    ]
  },

  /* -- Perception -- */
  {
    name: 'Sniper\'s Nest', type: 'room', reward: { kind: 'buffEffect', buffKey: 'bearTotem', buffTargets: 'party', buffDuration: 25 },
    desc: 'An old sniper\'s roost overlooks the next hall. The vantage hardens you to what\'s coming.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Check the roost',
        win: 'You find a serviceable vantage — a small edge.',
        lose: 'The roost has collapsed.' },
      { tier: 'standard', skill: 'perception', label: 'Read the kill-zone',
        win: 'You map every angle — the party steels itself, damage halved ahead.',
        lose: 'You misread a creak — a crossbow fires!', failEffect: 'trap',
        fail: { damage: [1, 8, 1], damageType: 'piercing' } },
      { tier: 'risky', skill: 'perception', label: 'Spot every trap on the floor', party: true, failEffect: 'trap',
        win: 'The whole floor\'s ambushes lay bare — the party becomes iron!',
        lose: 'You lean out too far — the old trap still works.',
        fail: { damage: [2, 6, 1], damageType: 'piercing' } }
    ]
  },
  {
    name: 'Lost Map Cache', type: 'postClear', reward: { kind: 'reveal' },
    desc: 'A rolled chart peeks from a dead scout\'s pack. The boss\'s location could be yours — if you read it before the ink flees.',
    approaches: [
      { tier: 'safe', skill: 'history', label: 'Note the landmarks',
        win: 'You get a rough sense of the floor — useful.',
        lose: 'The landmarks have shifted.' },
      { tier: 'standard', skill: 'perception', label: 'Read the marching lines',
        win: 'The chart is plain — the boss\'s chamber stands revealed.',
        lose: 'You fumble and tear the chart — and pay for a new copy.', failEffect: 'setback',
        fail: { goldLossMult: 0.05 } }
    ]
  },

  /* -- Survival -- */
  {
    name: 'Hunter\'s Trophies', type: 'postClear', reward: { kind: 'tempHp', amount: 6 },
    desc: 'A rack of beast-trophies radiates a faint vigor. Donning a tooth or claw hardens the body.',
    approaches: [
      { tier: 'safe', skill: 'nature', label: 'Take a token',
        win: 'A small,steady fortitude settles in.',
        lose: 'The trophies are all rotted.' },
      { tier: 'standard', skill: 'survival', label: 'Choose the right charm',
        win: 'You pick a potent trophy — the party feels fortified.',
        lose: 'The beast\'s spirit objects — a spectral bite.', failEffect: 'trap',
        fail: { damage: [1, 4, 0], damageType: 'necrotic' } }
    ]
  },
  {
    name: 'Wyrm Track', type: 'postClear', reward: { kind: 'info' },
    desc: 'A scorched, claw-marked trail leads deeper. Reading it tells you exactly what waits at the bottom.',
    approaches: [
      { tier: 'safe', skill: 'nature', label: 'Note the claw count',
        win: 'The track is unmistakably draconic — useful.',
        lose: 'The track is too cold to read.' },
      { tier: 'standard', skill: 'survival', label: 'Follow the scorch',
        win: 'You trace the beast — the boss\'s identity and weakness are clear.',
        lose: 'You blunder down a side tunnel, kicking rubble.', failEffect: 'noise',
        fail: { noiseRooms: 1 } }
    ]
  },
  {
    name: 'Wild Camp', type: 'postClear', reward: { kind: 'shortRest' },
    desc: 'A hidden dell offers a brief, safe rest. Setting watch properly is the difference between rest and ambush.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Quick scout',
        win: 'You confirm the dell is safe — a brief breather.',
        lose: 'You can\'t be sure — you push on.' },
      { tier: 'standard', skill: 'survival', label: 'Set proper watch',
        win: 'A clean, short rest — abilities restored.',
        lose: 'Your watch fires at shadows — and wakes the wild.', failEffect: 'alert' },
      { tier: 'risky', skill: 'survival', label: 'Long rest in the wild', party: true, failEffect: 'alert',
        win: 'A full, safe recovery in the enemy\'s blind spot!',
        lose: 'Smoke and snoring carry — the whole floor stirs.',
        fail: { noiseRooms: 2 } }
    ]
  },

  /* -- Deception -- */
  {
    name: 'Smuggler\'s Toll', type: 'room', reward: { kind: 'gold' },
    desc: 'A smuggler\'s post guards a bridge. Flashing the right sign and confidence could wave you through rich.',
    approaches: [
      { tier: 'safe', skill: 'insight', label: 'Read what they want',
        win: 'You catch their tells and play along.',
        lose: 'Their game is too opaque.' },
      { tier: 'standard', skill: 'deception', label: 'Fake the password',
        win: 'You bluff the countersign — they wave you through with a "gift".',
        lose: 'The bluff fails — they shout the alarm.', failEffect: 'noise',
        fail: { noiseRooms: 1 } },
      { tier: 'risky', skill: 'deception', label: 'Rob them blind', party: true, failEffect: 'noise',
        win: 'You play them so well they hand over the whole stash!',
        lose: 'The con collapses — every post on the floor hears.',
        fail: { noiseRooms: 2 } }
    ]
  },
  {
    name: 'False Priest', type: 'room', reward: { kind: 'buffEffect', buffKey: 'inspired', buffTargets: 'party', buffDuration: 30 },
    desc: 'A naive cult tends a shrine. Donning their vestments and leading a rite could inspire your party — or draw a curse.',
    approaches: [
      { tier: 'safe', skill: 'religion', label: 'Mutter along',
        win: 'A faint, steady resolve settles on the party.',
        lose: 'The rite feels wrong — you stop.' },
      { tier: 'standard', skill: 'deception', label: 'Lead the rite',
        win: 'You play the priest flawlessly — the party leaves inspired.',
        lose: 'The cult senses the fraud — the rite inverts.', failEffect: 'curse',
        fail: { debuff: 'baned' } },
      { tier: 'risky', skill: 'deception', label: 'Bless the whole party', party: true, failEffect: 'curse',
        win: 'A flawless sermon — the party walks out aflame with confidence!',
        lose: 'The heresy is plain — the cult curses you all.',
        fail: { debuff: 'baned', debuffTargets: 'party' } }
    ]
  },

  /* -- Intimidation -- */
  {
    name: 'Warlord\'s Tribute', type: 'room', reward: { kind: 'gold' },
    desc: 'A warlord\'s old strongbox sits under a glaring guard-statue. Taking it by presence, not force, is the trick.',
    approaches: [
      { tier: 'safe', skill: 'persuasion', label: 'Claim a small share',
        win: 'You talk your way to a token.',
        lose: 'The statue is unmoved.' },
      { tier: 'standard', skill: 'intimidation', label: 'Demand the box',
        win: 'You shout the old warlord\'s name — the tribute is yours.',
        lose: 'Your voice cracks — the statue\'s gaze frightens you.', failEffect: 'frighten',
        fail: { debuff: 'frightened', debuffDuration: 20 } },
      { tier: 'risky', skill: 'intimidation', label: 'Claim the warlord\'s name', party: true, failEffect: 'frighten',
        win: 'Five voices bellow the name — the strongbox and more are yours!',
        lose: 'The name does not take — dread fills the chamber.',
        fail: { debuff: 'frightened', debuffTargets: 'party', debuffDuration: 30 } }
    ]
  },
  {
    name: 'Break the Line', type: 'room', reward: { kind: 'buffEffect', buffKey: 'raging', buffTargets: 'party', buffDuration: 25 },
    desc: 'A shield-wall of old constructs blocks the way. A roaring charge could shatter their nerve before a blade is drawn.',
    approaches: [
      { tier: 'safe', skill: 'history', label: 'Find the weak file',
        win: 'You spot the gap — a small advantage.',
        lose: 'The line is solid everywhere.' },
      { tier: 'standard', skill: 'intimidation', label: 'Roar the charge',
        win: 'Your roar cracks the line — fury carries the party through.',
        lose: 'They hold — and the noise echoes on.', failEffect: 'alert' },
      { tier: 'risky', skill: 'intimidation', label: 'Bellow as one', party: true, failEffect: 'alert',
        win: 'A unified roar shatters the constructs AND every nerve on the floor — the party is berserk!',
        lose: 'The constructs reform — and now the floor is awake.',
        fail: { noiseRooms: 2 } }
    ]
  },

  /* -- Performance -- */
  {
    name: 'Bardic Contest', type: 'room', reward: { kind: 'xp', amount: 25 },
    desc: 'A spectral bard demands a contest before you pass. Winning earns the lore of old masters; losing costs pride.',
    approaches: [
      { tier: 'safe', skill: 'history', label: 'Cite the classics',
        win: 'Your scholarship impresses — a small share of lore.',
        lose: 'The bard finds you dull.' },
      { tier: 'standard', skill: 'performance', label: 'Play a piece',
        win: 'Your tune wins — the bard gifts you a verse of hard-won experience.',
        lose: 'You fumble a phrase — the bard jeers.', failEffect: 'debuff',
        fail: { debuff: 'baned', debuffDuration: 20 } },
      { tier: 'risky', skill: 'performance', label: 'A full ensemble', party: true, failEffect: 'debuff',
        win: 'The party plays as one — the bard is moved to teach you everything!',
        lose: 'A cacophony — the bard\'s criticism cuts deep.',
        fail: { debuff: 'baned', debuffTargets: 'party', debuffDuration: 25 } }
    ]
  },
  {
    name: 'Lullaby', type: 'room', reward: { kind: 'heal' },
    desc: 'A music box plays an endless, drowsy tune. Harmonizing could soothe the party\'s hurts — or lull you senseless.',
    approaches: [
      { tier: 'safe', skill: 'medicine', label: 'Rest to the tune',
        win: 'A refreshing pause — minor hurts mend.',
        lose: 'The tune is just noise.' },
      { tier: 'standard', skill: 'performance', label: 'Harmonize',
        win: 'You weave the melody into a balm — the party heals.',
        lose: 'You nod off mid-phrase; everyone wakes groggy.', failEffect: 'debuff',
        fail: { debuff: 'slowed', debuffTargets: 'party', debuffDuration: 15 } }
    ]
  },

  /* -- Persuasion -- */
  {
    name: 'Recruit the Guard', type: 'room', reward: { kind: 'summonAlly' },
    desc: 'A lone, weary guard eyes your coin and your cause. The right words could turn his coat — and arm.',
    approaches: [
      { tier: 'safe', skill: 'insight', label: 'Feel out his price',
        win: 'You learn he\'s almost ready — a nudge later, he\'s yours.',
        lose: 'He stays cagey.' },
      { tier: 'standard', skill: 'persuasion', label: 'Appeal to his fatigue',
        win: 'He sighs, drops his pike, and joins the column.',
        lose: 'He balks — and demands a bribe you can\'t refuse.', failEffect: 'setback',
        fail: { goldLossMult: 0.1 } },
      { tier: 'risky', skill: 'persuasion', label: 'Turn the whole watch', party: true, failEffect: 'setback',
        win: 'Your words sweep the watch — a squad of turncoats joins you!',
        lose: 'The captain overhears — and fines you for the trouble.',
        fail: { goldLossMult: 0.15 } }
    ]
  },
  {
    name: 'Royal Pardon', type: 'room', reward: { kind: 'secret' },
    desc: 'A wax-sealed pardon lies on a clerk\'s desk. Flashing it could open the sealed vault nearby — or raise the alarm.',
    approaches: [
      { tier: 'safe', skill: 'history', label: 'Verify the seal',
        win: 'The seal is genuine — you note which vault it opens.',
        lose: 'The seal is too smudged to read.' },
      { tier: 'standard', skill: 'persuasion', label: 'Present the pardon',
        win: 'The vault\'s ward accepts the seal — and swings wide.',
        lose: 'The clerk screams fraud before the ward drops.', failEffect: 'noise',
        fail: { noiseRooms: 1 } },
      { tier: 'risky', skill: 'persuasion', label: 'Claim a ducal errand', party: true, failEffect: 'noise',
        win: 'You bluff the whole sealed wing open — secret rooms galore!',
        lose: 'The bluff collapses; every ward in the wing shrieks.',
        fail: { noiseRooms: 2 } }
    ]
  },

  /* -- Camp (expanding the now-wired camp pool) -- */
  {
    name: 'Tavern Tales', type: 'camp', reward: { kind: 'buffEffect', buffKey: 'inspired', buffTargets: 'party', buffDuration: 40 },
    desc: 'Around the merchant\'s fire, a traveling bard offers a tale for a tale. A good story could lift spirits before you descend.',
    approaches: [
      { tier: 'safe', skill: 'history', label: 'Recall an old legend',
        win: 'The bard nods — the party feels a familiar, steady resolve.',
        lose: 'The bard has heard it before.' },
      { tier: 'standard', skill: 'persuasion', label: 'Tell your own exploits',
        win: 'Your tale rouses the camp — the party sets out inspired.',
        lose: 'The tale falls flat — polite silence.' }
    ]
  },
  {
    name: 'Mark the Mark', type: 'camp', reward: { kind: 'gold' },
    desc: 'A sharper-eyed merchant\'s guard is running a side hustle. Reading him could win a tidy purse.',
    approaches: [
      { tier: 'safe', skill: 'perception', label: 'Watch his hands',
        win: 'You spot the loaded game — a small, easy profit.',
        lose: 'His hands are too quick.' },
      { tier: 'standard', skill: 'insight', label: 'Read his hustle',
        win: 'You play along just enough to clean him out.',
        lose: 'He reads you back — and lightens your purse.', failEffect: 'setback',
        fail: { goldLossMult: 0.08 } }
    ]
  }
];

/* ================================================================
   Room-type to eligible skill mapping (for post-clear challenges)
   ================================================================ */
const POST_CLEAR_SKILLS = {
  combat:    ['investigation', 'perception', 'survival', 'nature'],
  elite:     ['investigation', 'history', 'arcana', 'intimidation'],
  treasure:  ['sleightOfHand', 'perception', 'investigation'],
  shrine:    ['religion', 'arcana', 'insight'],
  boss:      ['history', 'arcana', 'religion', 'perception']
};

/* ================================================================
   DC Calculation
   actualDC = tier base DC + floor((dungeonLevel - 1) * 1.5) + random(-2, +2)
   ================================================================ */
function calcDC(baseDC, dungeonLevel) {
  const levelScale = Math.floor((dungeonLevel - 1) * 1.5);
  const variation = Math.floor(Math.random() * 5) - 2; // -2 to +2
  return baseDC + levelScale + variation;
}

/* ================================================================
   Skill Bonus — hero's derived bonus, adjusted by Wounded Pride
   ================================================================ */
function skillBonus(game, hero, skillKey) {
  let b = hero.data.skillsDerived?.[skillKey] ?? 0;
  if (game._floorDebuffs) {
    for (const deb of game._floorDebuffs) {
      if (deb.type === 'woundedPride' && deb.hero === hero.data.name && deb.skill === skillKey) {
        b += deb.value;
      }
    }
  }
  return b;
}

function momentumBonus(game) {
  return Math.min(3, game._skillMomentum || 0);
}

/* Top N alive heroes for a skill, sorted by adjusted bonus */
function topHeroes(game, skillKey, n = 3) {
  return game.heroes
    .filter(h => h.data.hp > 0)
    .map(h => ({ hero: h, bonus: skillBonus(game, h, skillKey) }))
    .sort((a, b) => b.bonus - a.bonus)
    .slice(0, n);
}

/* ================================================================
   Challenge Selection
   'room' and 'postClear' challenges share one pool — a challenge is
   eligible for a room type if any of its approaches uses one of the
   room type's skills. 12% chance to fire per cleared room.
   ================================================================ */
function pickPostClearChallenge(roomType) {
  const eligibleSkills = POST_CLEAR_SKILLS[roomType];
  if (!eligibleSkills || eligibleSkills.length === 0) return null;

  if (Math.random() > 0.12) return null;

  const pool = CHALLENGES.filter(c =>
    (c.type === 'room' || c.type === 'postClear') &&
    c.approaches.some(a => eligibleSkills.includes(a.skill))
  );
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function checkForChallenge(game) {
  if (game.state !== 'crawl' || game.paused || !game.D) return false;
  if (!game._skillsInited) return false;

  const alive = game.heroes.filter(h => h.data.hp > 0);
  if (alive.length === 0) return false;

  const { rooms } = game.D;
  for (let rid = 0; rid < rooms.length; rid++) {
    if (_challengesFired.has(rid)) continue;
    if (!game.visitedRooms[rid]) continue;
    if (!game.roomDone(rid)) continue;

    const room = rooms[rid];
    const challenge = pickPostClearChallenge(room.type);
    _challengesFired.add(rid); // mark checked either way so we don't re-roll every frame
    if (challenge) {
      fireChallenge(game, challenge);
      return true; // challenge fired, game is now paused
    }
  }

  return false;
}

/* ================================================================
   Reward preview (shown on card fronts — no exact values revealed)
   ================================================================ */
function rewardPreview(reward, tierKey) {
  const icon = REWARD_ICONS[reward.kind] || '🎁';
  const label = REWARD_LABELS[reward.kind] || 'Reward';
  if (tierKey === 'risky') {
    return SCALABLE.has(reward.kind) ? `${icon} ${label} ×2 ⚡` : `${icon} ${label} + 💰 ⚡`;
  }
  if (tierKey === 'safe' && SCALABLE.has(reward.kind)) {
    return `${icon} ${label} (modest)`;
  }
  if (tierKey === 'safe' && reward.kind === 'shortRest' && reward.fullHeal) {
    return `${icon} ${label} (partial)`;
  }
  return `${icon} ${label}`;
}

/* ================================================================
   Reward pre-computation (tier-aware)
   safe: scalable rewards halved; standard: as authored;
   risky: doubled, plus a gold rider on non-scalable kinds;
   risky crit (nat 20 / flawless party check): extra payout on top.
   ================================================================ */
function getGoldValue(dungeonLevel, baseValue) {
  if (baseValue) return baseValue;
  return 15 + die(10) * 2 + dungeonLevel * 5;
}

function precomputeReward(game, reward, tierKey, isCrit) {
  if (!reward) return null;
  const lvl = game.activeQuest ? game.activeQuest.level : (game.dungeonLevel || 1);
  const mult = TIERS[tierKey].mult;
  const critBonus = isCrit && tierKey === 'risky';
  const out = { data: null, detailText: '' };

  switch (reward.kind) {
    case 'item': {
      let count = tierKey === 'risky' ? 2 : 1;
      if (critBonus) count++;
      const items = [];
      for (let i = 0; i < count; i++) items.push(rollItem(lvl));
      out.data = { kind: 'item', items };
      out.detailText = items.map(it => it.name).join(', ');
      break;
    }
    case 'gold': {
      let gold = Math.max(5, Math.round(getGoldValue(lvl, reward.value) * mult));
      if (critBonus) gold = Math.round(gold * 1.5);
      out.data = { kind: 'gold', gold };
      out.detailText = `${gold} gold${critBonus ? ' (crit!)' : ''}`;
      break;
    }
    case 'potion': {
      const potions = [];
      if (tierKey === 'safe') {
        potions.push({ greater: false });
      } else if (tierKey === 'standard') {
        potions.push({ greater: Math.random() < 0.3 && lvl >= 3 });
      } else {
        potions.push({ greater: lvl >= 3 });
        potions.push({ greater: false });
        if (critBonus) potions.push({ greater: lvl >= 3 });
      }
      out.data = { kind: 'potion', potions };
      const g = potions.filter(p => p.greater).length, n = potions.length - g;
      const parts = [];
      if (g) parts.push(`${g}× Greater Healing Potion`);
      if (n) parts.push(`${n}× Healing Potion`);
      out.detailText = parts.join(', ');
      break;
    }
    case 'heal': {
      const amounts = [];
      let total = 0;
      for (const h of game.heroes) {
        if (h.data.hp <= 0) { amounts.push(0); continue; }
        let amt = d20roll(1, 6, 2);
        amt = Math.max(1, Math.round(amt * mult * (critBonus ? 1.5 : 1)));
        amounts.push(amt);
        total += amt;
      }
      out.data = { kind: 'heal', amounts, total };
      out.detailText = `Party heals ${total} HP`;
      break;
    }
    case 'shortRest': {
      // safe tier downgrades a full-heal rest to a plain one
      const fullHeal = !!reward.fullHeal && tierKey !== 'safe';
      out.data = { kind: 'shortRest', fullHeal };
      out.detailText = fullHeal
        ? 'Short rest — full heal + abilities'
        : 'Short rest — abilities recharged';
      break;
    }
    case 'buff': {
      out.data = { kind: 'buff' };
      out.detailText = 'Floor-long boon';
      break;
    }
    case 'buffEffect': {
      const buffKey = reward.buffKey && BUFF_EFFECTS[reward.buffKey] ? reward.buffKey : 'inspired';
      let duration = reward.buffDuration || BUFF_EFFECTS[buffKey];
      if (critBonus) duration = Math.round(duration * 1.5);
      const targets = reward.buffTargets || 'party';
      out.data = { kind: 'buffEffect', buffKey, duration, targets };
      const lbl = EFFECTS[buffKey]?.label || buffKey;
      out.detailText = `${lbl} ${targets === 'self' ? 'on hero' : 'on party'} (${duration}s${critBonus ? ', crit!' : ''})`;
      break;
    }
    case 'tempHp': {
      let amount = reward.amount || (5 + lvl * 2);
      amount = Math.max(2, Math.round(amount * mult * (critBonus ? 1.5 : 1)));
      out.data = { kind: 'tempHp', amount };
      out.detailText = `+${amount} temp HP${critBonus ? ' (crit!)' : ''}`;
      break;
    }
    case 'xp': {
      let amount = reward.amount || (20 + lvl * 10);
      amount = Math.max(5, Math.round(amount * mult * (critBonus ? 1.5 : 1)));
      out.data = { kind: 'xp', amount };
      out.detailText = `${amount} XP${critBonus ? ' (crit!)' : ''}`;
      break;
    }
    case 'cleanse': {
      out.data = { kind: 'cleanse' };
      out.detailText = 'All debuffs cleansed';
      break;
    }
    case 'abilityCharge': {
      out.data = { kind: 'abilityCharge' };
      out.detailText = 'Ability charge + spell slot restored';
      break;
    }
    case 'summonAlly': {
      out.data = { kind: 'summonAlly' };
      out.detailText = 'Temporary ally joins the party';
      break;
    }
    case 'secret': {
      out.data = { kind: 'secret' };
      out.detailText = 'Secret room revealed';
      break;
    }
    case 'shortcut': {
      out.data = { kind: 'shortcut' };
      out.detailText = 'Shortcut nexus';
      break;
    }
    case 'reveal': {
      out.data = { kind: 'reveal' };
      out.detailText = 'Boss location revealed';
      break;
    }
    case 'info': {
      out.data = { kind: 'info' };
      out.detailText = 'Boss intel — foe marked & revealed';
      break;
    }
    default: {
      const gold = Math.round(getGoldValue(lvl, reward.value) * mult);
      out.data = { kind: 'gold', gold };
      out.detailText = `${gold} gold`;
      break;
    }
  }

  // Risky tier pays a gold rider on rewards that can't scale numerically
  if (tierKey === 'risky' && !SCALABLE.has(reward.kind)) {
    const rider = getGoldValue(lvl) * (critBonus ? 2 : 1);
    out.data.riderGold = rider;
    out.detailText += ` + ${rider} gold`;
  }

  return out;
}

function applyComputedReward(game, computed, challenge, hero) {
  if (!computed || !computed.data) return;
  const d = computed.data;

  switch (d.kind) {
    case 'item': {
      for (const item of d.items) game.inventory.push(item);
      break;
    }
    case 'gold': {
      game.gold += d.gold;
      break;
    }
    case 'potion': {
      for (const p of d.potions) {
        if (p.greater) game.potions.greater++;
        else game.potions.heal++;
      }
      break;
    }
    case 'heal': {
      game.heroes.forEach((h, i) => {
        if (h.data.hp > 0 && d.amounts[i] > 0) {
          h.data.hp = Math.min(h.data.maxHp, h.data.hp + d.amounts[i]);
        }
      });
      break;
    }
    case 'shortRest': {
      partyShortRest(game, {
        fullHeal: !!d.fullHeal,
        reason: 'skill check',
        silent: false
      });
      break;
    }
    case 'buff': {
      if (!game._floorBuffs) game._floorBuffs = [];
      const buffType = challengeBuffType(challenge);
      game._floorBuffs.push({ type: buffType, source: hero?.data?.name || 'party' });
      applyStrategicBuff(game, buffType, hero);
      break;
    }
    case 'buffEffect': {
      const targets = d.targets === 'self' && hero ? [hero]
        : game.heroes.filter(h => h.data.hp > 0);
      for (const h of targets) {
        applyEffect(h, d.buffKey, { duration: d.duration, elapsed: game.elapsed || 0, tag: 'skill' });
      }
      const lbl = EFFECTS[d.buffKey]?.label || d.buffKey;
      log(`  ↳ 🛡 ${lbl} granted to ${targets.length} hero${targets.length > 1 ? 'es' : ''} for ${d.duration}s.`, 'heal');
      break;
    }
    case 'tempHp': {
      for (const h of game.heroes) {
        if (h.data.hp > 0) h.tempHp = (h.tempHp || 0) + d.amount;
      }
      log(`  ↳ 💙 +${d.amount} temp HP to the party.`, 'heal');
      break;
    }
    case 'xp': {
      for (const h of game.heroes) {
        if (h.data.hp > 0) grantXp(h.data, d.amount, game);
      }
      log(`  ↳ ✦ +${d.amount} XP to the party.`, 'treasure');
      break;
    }
    case 'cleanse': {
      for (const h of game.heroes) {
        if (!h._effects) continue;
        for (const k of Object.keys(h._effects)) {
          if (EFFECTS[k]?.category === 'debuff' || EFFECTS[k]?.category === 'dot') {
            delete h._effects[k];
          }
        }
        h._effectCache = null;
      }
      log(`  ↳ 🌟 Debilitating effects cleansed from the party.`, 'heal');
      break;
    }
    case 'abilityCharge': {
      for (const h of game.heroes) {
        if (h.data.hp > 0) {
          if (h.data.abilityUsed?.short) h.data.abilityUsed.short = false;
          if (totalSlots(h.data)) recoverSlots(h.data);
        }
      }
      log(`  ↳ 🔋 Ability charges & spell slots restored.`, 'heal');
      break;
    }
    case 'summonAlly': {
      spawnBeastAlly(game);
      break;
    }
    case 'secret': {
      if (game.D && game.D.rooms) {
        const unrevealed = [];
        for (let i = 0; i < game.D.rooms.length; i++) {
          if (game.D.rooms[i].type === 'combat' && !game.visitedRooms[i]) {
            unrevealed.push(i);
          }
        }
        if (unrevealed.length > 0) {
          const target = unrevealed[Math.floor(Math.random() * unrevealed.length)];
          game.visitRoom(target, true);
        }
      }
      break;
    }
    case 'reveal': {
      if (game.D && game.D.boss !== undefined) game.visitRoom(game.D.boss, true);
      break;
    }
    case 'shortcut': {
      if (game.D && game.D.rooms) {
        const hidden = [];
        for (let i = 0; i < game.D.rooms.length; i++) {
          const t = game.D.rooms[i].type;
          if ((t === 'treasure' || t === 'shrine') && !game.visitedRooms[i]) hidden.push(i);
        }
        if (hidden.length > 0) {
          const target = hidden[Math.floor(Math.random() * hidden.length)];
          game.visitRoom(target, true);
          game.recalculateFog(game);
        }
      }
      break;
    }
    case 'info': {
      /* Boss intel: reveal the boss room and tag the boss as vulnerable (faerieFire-style)
       * for the floor, giving the party advantage to hit it. */
      if (!game._floorBuffs) game._floorBuffs = [];
      if (!game._floorBuffs.some(b => b.type === 'bossIntel')) {
        game._floorBuffs.push({ type: 'bossIntel', source: hero?.data?.name || 'party' });
      }
      if (game.D && game.D.boss !== undefined) game.visitRoom(game.D.boss, true);
      applyBossEffect(game, 'faerieFire');
      log(`  ↳ 📜 You've learned the boss's weakness — it's marked and revealed.`, 'treasure');
      break;
    }
  }

  if (d.riderGold) game.gold += d.riderGold;

  updateResources(game);
  updatePartyFrames(game.heroes.map(h => h.data));
}

/* Buff typing keyed to the challenge's standard-approach skill */
function challengeBuffType(challenge) {
  const std = challenge?.approaches?.find(a => a.tier === 'standard');
  const skill = std ? std.skill : null;
  if (skill === 'animalHandling') return 'animalFriend';
  if (skill === 'intimidation') return 'bossWeakness';
  if (skill === 'performance') return 'betterShop';
  if (skill === 'persuasion') return 'merchantDiscount';
  if (skill === 'survival') return 'rested';
  return 'genericBuff';
}

/* Apply a floor-long strategic buff now that _floorBuffs is wired to consumers.
 * Each type carries a real mechanical effect instead of being a dead record. */
function applyStrategicBuff(game, buffType, hero) {
  switch (buffType) {
    case 'rested':
      partyShortRest(game, { reason: 'safe camp boon', silent: true });
      log(`  ↳ 🏕 Safe rest boon — abilities recharged.`, 'heal');
      break;
    case 'bossWeakness':
      applyBossEffect(game, 'bossWeakened');
      log(`  ↳ ⚔ The boss is cowed — weakened for the floor (-2 AC, -2 atk).`, 'treasure');
      break;
    case 'animalFriend':
      spawnBeastAlly(game);
      break;
    case 'merchantDiscount':
      log(`  ↳ 💰 Merchant's favour — 15% off at the next shop.`, 'treasure');
      break;
    case 'betterShop':
      log(`  ↳ 🎭 Renowned — the next shop will stock better gear.`, 'treasure');
      break;
    default: {
      /* genericBuff → inspire the party for the next combat */
      const targets = game.heroes.filter(h => h.data.hp > 0);
      for (const h of targets) applyEffect(h, 'inspired', { duration: 45, elapsed: game.elapsed || 0, tag: 'skill' });
      log(`  ↳ ✨ The party feels inspired (+1d4 atk) for the next fight.`, 'heal');
    }
  }
}

/* Apply an effect to every boss monster on the floor (bossWeakened / faerieFire). */
function applyBossEffect(game, effectKey) {
  if (!game.monsters) return;
  let n = 0;
  for (const m of game.monsters) {
    if (m.isBoss && m.data && m.data.hp > 0) {
      if (applyEffect(m, effectKey, { elapsed: game.elapsed || 0, tag: 'skill' })) n++;
    }
  }
  if (n > 0) {
    const lbl = EFFECTS[effectKey]?.label || effectKey;
    log(`  ↳ ${lbl} applied to ${n} boss${n > 1 ? 'es' : ''}.`, 'sys');
  }
}

/* Spawn a temporary beast ally via the game orchestrator's mesh/group plumbing. */
function spawnBeastAlly(game) {
  if (game.heroes.some(h => h.temp)) {
    log(`  ↳ A beast already travels with you.`, 'sys');
    return;
  }
  const lvl = Math.max(1, (game.effectiveLevel || 1) | 0);
  const visual = {
    race: 'human', gender: 'male', bodyType: 'male',
    skinColor: '#7a6a55', hairColor: '#2a2a2a',
    spriteScaleX: 0.7, spriteScaleY: 0.7
  };
  const data = makeHero('Beast Companion', 'human', 'ranger',
    { str: 14, dex: 14, con: 14, int: 8, wis: 12, cha: 8 }, visual);
  data.level = lvl;
  data.name = 'Beast Companion';
  recalc(data);
  data.hp = data.maxHp;
  if (typeof game.spawnTempAlly === 'function') {
    game.spawnTempAlly(data, 'beast');
    log(`  ↳ 🐾 A loyal beast joins the party for this floor.`, 'treasure');
  }
}

/* ================================================================
   Failure Consequences
   ================================================================ */

/* Wounded Pride: -1 to the failed skill for the rest of the floor (max -3).
 * Harsher: once a hero is already nursing 2+ failures, a further miss also
 * leaves them briefly weakened (-50% dmg) for the next fight. */
function applyWoundedPride(game, hero, skillKey) {
  if (!game._floorDebuffs) game._floorDebuffs = [];
  const existing = game._floorDebuffs.filter(d =>
    d.type === 'woundedPride' && d.hero === hero.data.name && d.skill === skillKey);
  const skillLabel = SKILLS[skillKey]?.label || skillKey;
  if (existing.length >= 3) {
    /* maxed out — pile on a short weakness instead */
    applyEffect(hero, 'weakenedDmg', { duration: 20, elapsed: game.elapsed || 0, tag: 'skill' });
    log(`  ↳ ${hero.data.name} is rattled — weakened (-50% dmg) for the next fight.`, 'down');
    return;
  }
  game._floorDebuffs.push({ type: 'woundedPride', hero: hero.data.name, skill: skillKey, value: -1 });
  log(`  ↳ ${hero.data.name}'s pride is wounded: -1 to ${skillLabel} this floor.`, 'sys');
  if (existing.length >= 1) {
    /* second+ failure bites into combat output too */
    applyEffect(hero, 'weakenedDmg', { duration: 15, elapsed: game.elapsed || 0, tag: 'skill' });
  }
}

/* Alerted: an unvisited room gains 1-2 extra monsters */
function applyAlerted(game) {
  if (!game.D || !game.D.rooms) return;
  const { W } = game.D;
  const candidates = [];
  for (let i = 0; i < game.D.rooms.length; i++) {
    if (!game.visitedRooms[i] && game.D.rooms[i].type === 'combat') candidates.push(i);
  }
  if (candidates.length === 0) return;
  const rid = candidates[Math.floor(Math.random() * candidates.length)];
  const anchor = game.roomAnchor[rid];
  const ax = anchor % W, ay = Math.floor(anchor / W);
  const extra = 1 + (Math.random() < 0.5 ? 1 : 0);
  const questInfo = {
    dungeonLevel: game.activeQuest ? game.activeQuest.level : game.dungeonLevel,
    questFloor: game.questFloor,
    floors: game.activeQuest ? game.activeQuest.floors : 10
  };
  for (let i = 0; i < extra; i++) {
    const spec = spawnMonster(1, game.effectiveLevel, Math.random, null, questInfo);
    game.addMonster(spec, ax + (Math.random() - 0.5), ay + (Math.random() - 0.5), rid);
  }
  log(`  ↳ ⚠ The dungeon is alerted! Reinforcements gather ahead (+${extra} monsters).`, 'down');
}

/* ================================================================
   Fire a Challenge — choose → roll → result state machine
   ================================================================ */
export function fireChallenge(game, challenge) {
  const alive = game.heroes.filter(h => h.data.hp > 0);
  if (alive.length === 0) return;
  if (_phase !== 'idle') return; // one challenge at a time

  // Build approach view-models: actual DC, eligible heroes, reward preview
  const approaches = challenge.approaches.map(a => ({
    ...a,
    actualDC: calcDC(TIERS[a.tier].dc, game.dungeonLevel),
    heroes: a.party ? [] : topHeroes(game, a.skill, 3),
    preview: rewardPreview(challenge.reward, a.tier)
  }));

  game.setPaused(true);
  _phase = 'choose';
  _activeChallenge = { game, challenge, approaches };

  showChoosePhase(_activeChallenge);
}

/**
 * Resolve the chosen approach: roll dice, precompute outcome, then hand
 * the results to the roll-phase UI. Consequences apply on Continue.
 */
/* Narration id stem for a challenge. `nid` overrides the name-slug where two
   challenges share a display name (e.g. the two "Locked Chest"s); must match
   the base computed in scripts/narration/extract.mjs. */
function narrBase(ch) { return ch.nid || narrationId(ch.name); }

function resolveApproach(state, apprIdx, chosenHero) {
  if (_phase !== 'choose') return;
  _phase = 'rolling';
  if (_autoChooseTimer) { clearTimeout(_autoChooseTimer); _autoChooseTimer = null; }

  const { game, challenge } = state;
  const appr = state.approaches[apprIdx];
  /* Narrate the chosen action; the outcome line is queued after it in showResult. */
  playNarration(`${narrBase(challenge)}_a${apprIdx}_act`);
  const dc = appr.actualDC;
  const momentum = momentumBonus(game);

  let result;
  if (appr.party) {
    /* Party check: everyone alive rolls; at least half must succeed */
    const alive = game.heroes.filter(h => h.data.hp > 0);
    const needed = Math.ceil(alive.length / 2);
    const rolls = alive.map(h => {
      const bonus = skillBonus(game, h, appr.skill) + momentum;
      const d20 = die(20);
      const total = d20 + bonus;
      const ok = d20 === 20 ? true : d20 === 1 ? false : total >= dc;
      return { hero: h, name: h.data.name, d20, bonus, total, ok };
    });
    const successes = rolls.filter(r => r.ok).length;
    const success = successes >= needed;
    const isCrit = success && successes === rolls.length && rolls.length > 1; // flawless
    result = { party: true, rolls, needed, successes, success, isCrit, isCritFail: false };
  } else {
    const hero = chosenHero || appr.heroes[0]?.hero;
    if (!hero) { _phase = 'choose'; return; }
    const bonus = skillBonus(game, hero, appr.skill) + momentum;
    const d20 = die(20);
    const total = d20 + bonus;
    const isCrit = d20 === 20;
    const isCritFail = d20 === 1;
    const success = isCrit ? true : isCritFail ? false : total >= dc;
    result = { party: false, hero, d20, bonus, total, success, isCrit, isCritFail };
  }

  // Precompute reward / failure details for display
  const computedReward = result.success
    ? precomputeReward(game, challenge.reward, appr.tier, result.isCrit)
    : null;

  let computedFailure = null;
  if (!result.success && appr.failEffect) {
    const fe = appr.failEffect;
    const fail = appr.fail || {};
    const failingHeroes = result.party
      ? result.rolls.filter(r => !r.ok).map(r => r.hero)
      : [result.hero];

    if (fe === 'damage' || fe === 'trap') {
      /* trap: per-challenge dice spec [count, sides, bonus]; damage: legacy rule */
      let dmgSpec = fail.damage;
      if (!dmgSpec) {
        const dieSize = appr.tier === 'risky' ? 6 : 4;
        dmgSpec = [1, dieSize, 0];
      }
      const hits = failingHeroes.map(h => {
        let dmg = 0;
        for (let i = 0; i < dmgSpec[0]; i++) dmg += die(dmgSpec[1]);
        dmg += dmgSpec[2] || 0;
        return { hero: h, dmg, type: fail.damageType || 'physical' };
      });
      const total = hits.reduce((s, x) => s + x.dmg, 0);
      const dt = fail.damageType ? ` ${fail.damageType}` : '';
      computedFailure = { kind: 'damage', hits,
        detailText: `${hits.length} hero${hits.length > 1 ? 'es' : ''} take${hits.length > 1 ? '' : 's'} ${total}${dt} damage` };
    }
    else if (fe === 'alert' || fe === 'noise') {
      const rooms = fe === 'noise' ? (fail.noiseRooms || 2) : 1;
      computedFailure = { kind: 'alert', noiseRooms: rooms,
        detailText: rooms > 1 ? `The dungeon stirs — ${rooms} rooms send reinforcements!`
          : 'The dungeon is alerted — more monsters ahead!' };
    }
    else if (fe === 'debuff' || fe === 'frighten' || fe === 'poison') {
      let key = fail.debuff;
      if (!key) key = fe === 'frighten' ? 'frightened' : fe === 'poison' ? 'poisoned' : 'slowed';
      key = FAIL_DEBUFFS[key] || key;
      const targets = fail.debuffTargets === 'party'
        ? game.heroes.filter(h => h.data.hp > 0)
        : failingHeroes;
      computedFailure = { kind: 'debuff', effectKey: key,
        duration: fail.debuffDuration != null ? fail.debuffDuration : null,
        dotDmg: fe === 'poison' ? (fail.dotDmg || 1) : null,
        targets,
        detailText: `${EFFECTS[key]?.label || key} on ${targets.length} hero${targets.length > 1 ? 'es' : ''}` };
    }
    else if (fe === 'curse') {
      const key = FAIL_DEBUFFS[fail.debuff || 'cursed'] || 'baned';
      const targets = game.heroes.filter(h => h.data.hp > 0);
      computedFailure = { kind: 'debuff', effectKey: key, duration: null, targets,
        detailText: `The party is cursed (${EFFECTS[key]?.label || key}) for the floor` };
    }
    else if (fe === 'setback') {
      const lossMult = fail.goldLossMult || 0.1;
      const loss = Math.round((game.gold || 0) * lossMult);
      computedFailure = { kind: 'setback', goldLoss: loss,
        detailText: loss > 0 ? `Setback — lose ${loss} gold` : 'A careless mistake — nothing lost' };
    }
  }

  state.apprIdx = apprIdx;
  state.appr = appr;
  state.result = result;
  state.momentum = momentum;
  state.computedReward = computedReward;
  state.computedFailure = computedFailure;

  startRollPhase(state, () => applyOutcome(state));
}

/**
 * Apply the resolved outcome to game state (called on Continue).
 */
function applyOutcome(state) {
  const { game, challenge, appr, result, computedReward, computedFailure } = state;

  if (result.success) {
    if (challenge.reward) applyComputedReward(game, computedReward, challenge, result.hero);
    const who = result.party ? 'The party' : result.hero.data.name;
    log(`✨ ${who} succeeds at "${challenge.name}" (${TIERS[appr.tier].label.toLowerCase()})! ${computedReward ? computedReward.detailText : ''}`, 'treasure');
    game._skillMomentum = (game._skillMomentum || 0) + 1;
    if (momentumBonus(game) > 0) {
      log(`  ↳ 🔥 Momentum +${momentumBonus(game)} on skill checks.`, 'sys');
    }
  } else {
    const who = result.party ? 'The party' : result.hero.data.name;
    log(`❌ ${who} fails at "${challenge.name}". ${appr.lose}`, 'sys');

    // Wounded pride for whoever failed
    if (result.party) {
      for (const r of result.rolls) if (!r.ok) applyWoundedPride(game, r.hero, appr.skill);
    } else {
      applyWoundedPride(game, result.hero, appr.skill);
    }

    // Failure effects
    if (computedFailure?.kind === 'damage') {
      for (const hit of computedFailure.hits) {
        hit.hero.data.hp = Math.max(0, hit.hero.data.hp - hit.dmg);
        log(`  ↳ ${hit.hero.data.name} takes ${hit.dmg} damage from the mishap.`, 'down');
      }
    } else if (computedFailure?.kind === 'alert') {
      const reps = computedFailure.noiseRooms || 1;
      for (let i = 0; i < reps; i++) applyAlerted(game);
    } else if (computedFailure?.kind === 'debuff') {
      const opts = { elapsed: game.elapsed || 0, tag: 'skill' };
      if (computedFailure.duration != null) opts.duration = computedFailure.duration;
      if (computedFailure.dotDmg != null) opts.dotDmg = computedFailure.dotDmg;
      for (const h of computedFailure.targets) {
        applyEffect(h, computedFailure.effectKey, opts);
      }
      log(`  ↳ ⚠ ${computedFailure.detailText}.`, 'down');
    } else if (computedFailure?.kind === 'setback') {
      if (computedFailure.goldLoss > 0) {
        game.gold = Math.max(0, game.gold - computedFailure.goldLoss);
        log(`  ↳ 💸 ${computedFailure.detailText}.`, 'down');
      }
    }

    game._skillMomentum = 0;
  }

  updateResources(game);
  updatePartyFrames(game.heroes.map(h => h.data));

  _activeChallenge = null;
  _phase = 'idle';
  game.setPaused(false);

  /* Notify externally-fired challenges (quest puzzle wards). Runs after the
     state machine is idle again — callbacks must NOT fire a new challenge
     synchronously; the update loop re-fires on the next idle frame. */
  if (typeof challenge.onResolved === 'function') {
    try { challenge.onResolved(result.success, state); } catch (e) { /* never break the loop */ }
  }
}

/* ================================================================
   UI — card overlay with 3D flip
   ================================================================ */
export function initSkills(game) {
  G = game;
  game._skillsInited = true;
  if (!game._floorBuffs) game._floorBuffs = [];
  if (!game._floorDebuffs) game._floorDebuffs = [];
  if (game._skillMomentum === undefined) game._skillMomentum = 0;

  if (!document.getElementById('challengescreen')) {
    const ov = document.createElement('div');
    ov.id = 'challengescreen';
    ov.innerHTML = `
      <div class="cs-frame challenge-frame">
        <div class="cs-header">
          <div class="cs-tabs">
            <span style="color:#e8c25a; font-weight:700; font-size:14px; letter-spacing:1px;">⚔ SKILL CHALLENGE</span>
            <span id="challenge-momentum" class="challenge-momentum"></span>
          </div>
        </div>
        <div class="cs-body" style="flex-direction:column; padding:16px 20px;">
          <div class="challenge-vignette-wrap">
            <canvas id="challenge-vignette" width="${VIGNETTE_W}" height="${VIGNETTE_H}"></canvas>
          </div>
          <div class="challenge-text">
            <div class="challenge-name" id="challenge-name"></div>
            <div class="challenge-desc" id="challenge-desc"></div>
          </div>
          <div id="challenge-cards"></div>
          <div class="challenge-outcome" id="challenge-outcome"></div>
          <div class="challenge-reward" id="challenge-reward"></div>
          <div class="challenge-actions">
            <button id="challenge-continue" class="challenge-btn">CONTINUE</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);

    document.getElementById('challenge-continue').addEventListener('click', () => {
      if (_phase !== 'result') return;
      if (_autoContinueTimer) { clearTimeout(_autoContinueTimer); _autoContinueTimer = null; }
      dismissOverlay();
      if (_resolveOverlay) {
        const fn = _resolveOverlay;
        _resolveOverlay = null;
        fn();
      }
    });
  }

  if (!document.getElementById('skill-challenge-css')) {
    const style = document.createElement('style');
    style.id = 'skill-challenge-css';
    style.textContent = `
      #challengescreen {
        position: fixed; inset: 0; z-index: 52; display: none;
        background: rgba(4,5,9,0.85); backdrop-filter: blur(5px);
        align-items: center; justify-content: center; padding: 24px;
      }
      #challengescreen.show { display: flex; }

      .challenge-frame {
        width: 720px; max-width: 94vw; height: auto;
        background: rgba(14, 16, 22, 0.96);
        border: 1px solid rgba(200, 170, 90, 0.2);
        border-radius: 12px;
        overflow: hidden;
      }
      .challenge-frame .cs-body {
        flex-direction: column !important;
        padding: 16px 20px !important;
        display: flex !important;
      }
      .challenge-momentum {
        margin-left: 12px; font-size: 12px; font-weight: 700; color: #ff9a3c;
      }

      .challenge-text { text-align: center; margin-bottom: 4px; }
      .challenge-name {
        font-size: 20px; font-weight: 700; color: #e8c25a; margin-bottom: 6px;
      }
      .challenge-desc {
        font-size: 13px; color: #a8a294; line-height: 1.5; padding: 0 8px;
      }

      /* ---- approach cards ---- */
      #challenge-cards {
        display: flex; gap: 14px; justify-content: center; align-items: stretch;
        flex-wrap: wrap; margin: 14px 0 6px; min-height: 230px;
      }
      .appr-card {
        width: 204px; height: 250px; perspective: 900px; cursor: pointer;
        transition: opacity 0.4s, transform 0.4s;
      }
      .appr-card.dimmed { opacity: 0.22; transform: scale(0.94); pointer-events: none; }
      .appr-card.chosen { cursor: default; }
      .appr-inner {
        position: relative; width: 100%; height: 100%;
        transform-style: preserve-3d;
        transition: transform 0.65s cubic-bezier(.4,.15,.25,1);
      }
      .appr-card.flipped .appr-inner { transform: rotateY(180deg); }
      .appr-face {
        position: absolute; inset: 0;
        backface-visibility: hidden; -webkit-backface-visibility: hidden;
        border-radius: 12px; padding: 12px;
        border: 1px solid rgba(200,170,90,0.25);
        background: linear-gradient(180deg, rgba(32,30,24,0.96), rgba(16,15,12,0.98));
        display: flex; flex-direction: column;
      }
      .appr-card:not(.chosen):not(.dimmed):hover .appr-front {
        border-color: rgba(232,194,90,0.65);
        box-shadow: 0 4px 18px rgba(232,194,90,0.12);
      }
      .appr-card:not(.chosen):not(.dimmed):hover { transform: translateY(-4px); }
      .appr-back { transform: rotateY(180deg); align-items: center; justify-content: center; text-align: center; }

      .appr-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .appr-tier {
        font-size: 10px; font-weight: 800; letter-spacing: 1.2px;
        padding: 2px 8px; border-radius: 8px;
      }
      .appr-tier.tier-safe     { color: #6aea6a; background: rgba(106,234,106,0.12); border: 1px solid rgba(106,234,106,0.35); }
      .appr-tier.tier-standard { color: #e8c25a; background: rgba(232,194,90,0.12);  border: 1px solid rgba(232,194,90,0.35); }
      .appr-tier.tier-risky    { color: #ff6a55; background: rgba(255,106,85,0.12);  border: 1px solid rgba(255,106,85,0.4); }
      .appr-dc {
        font-size: 12px; font-weight: 800; color: #f0e2c0;
        background: rgba(35,30,25,0.9); border: 1px solid rgba(200,170,90,0.35);
        border-radius: 8px; padding: 2px 8px;
      }
      .appr-label {
        font-size: 14px; font-weight: 700; color: #f0e6cc; line-height: 1.3;
        margin-bottom: 4px; min-height: 36px;
      }
      .appr-skill { font-size: 11px; color: #8fb0d8; margin-bottom: 8px; }
      .appr-reward {
        font-size: 12px; font-weight: 700; color: #e8c25a;
        padding: 5px 8px; border-radius: 8px;
        background: rgba(232,194,90,0.07); border: 1px dashed rgba(232,194,90,0.25);
        margin-bottom: 8px; text-align: center;
      }
      .appr-heroes { margin-top: auto; display: flex; flex-wrap: wrap; gap: 5px; }
      .appr-hero-chip {
        font-size: 11px; font-weight: 600; color: #d8d0bc;
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14);
        border-radius: 10px; padding: 3px 9px; cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
      }
      .appr-hero-chip:hover { background: rgba(232,194,90,0.18); border-color: rgba(232,194,90,0.55); color: #fff; }
      .appr-hero-chip b { color: #6aea6a; }
      .appr-party-note {
        margin-top: auto; font-size: 11px; font-weight: 700; color: #c88fe0;
        text-align: center; padding: 5px 6px;
        background: rgba(200,143,224,0.08); border: 1px dashed rgba(200,143,224,0.3);
        border-radius: 8px;
      }

      /* ---- card back: dice ---- */
      .appr-d20 {
        width: 64px; height: 64px; margin: 0 auto 8px;
        background: rgba(35, 30, 25, 0.8);
        border: 2px solid rgba(200, 170, 90, 0.3);
        border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        font-size: 30px; font-weight: 700; color: #f0e2c0;
        font-family: 'Georgia', serif;
        transition: border-color 0.3s, color 0.3s;
      }
      .appr-d20.success { border-color: #6aea6a; color: #6aea6a; }
      .appr-d20.failure { border-color: #e0483a; color: #e0483a; }
      .appr-d20.crit { border-color: #ffd34a; color: #ffd34a; text-shadow: 0 0 16px rgba(255,211,74,0.4); }
      .appr-d20.fumble { border-color: #ff5040; color: #ff5040; text-shadow: 0 0 16px rgba(255,80,64,0.4); }
      .appr-roll-math { font-size: 12px; color: #a8a294; margin-bottom: 4px; min-height: 16px; }
      .appr-roll-sub { font-size: 10px; color: #7a7466; margin-bottom: 6px; min-height: 13px; }
      .appr-verdict { font-size: 16px; font-weight: 800; letter-spacing: 1px; min-height: 22px; }
      .appr-verdict.success { color: #6aea6a; }
      .appr-verdict.failure { color: #e0483a; }
      .appr-verdict.crit { color: #ffd34a; text-shadow: 0 0 20px rgba(255,211,74,0.3); }

      /* ---- card back: party rolls ---- */
      .appr-party-rolls { width: 100%; }
      .pr-row {
        display: flex; justify-content: space-between; align-items: center;
        font-size: 11px; color: #c8c0ac; padding: 2px 4px;
        opacity: 0; transition: opacity 0.3s;
      }
      .pr-row.show { opacity: 1; }
      .pr-row .pr-ok { color: #6aea6a; font-weight: 700; }
      .pr-row .pr-no { color: #e0483a; font-weight: 700; }
      .pr-needed { font-size: 10px; color: #8a8474; margin-bottom: 6px; }

      .challenge-outcome {
        text-align: center; font-size: 13px; color: #c8c0ac;
        line-height: 1.5; padding: 6px 4px; margin: 2px 0 4px;
        opacity: 0; transition: opacity 0.4s; min-height: 20px;
      }
      .challenge-outcome.show { opacity: 1; }

      .challenge-reward {
        text-align: center; font-size: 14px; font-weight: 700; color: #e8c25a;
        line-height: 1.5; padding: 2px 4px; min-height: 20px;
        opacity: 0; transition: opacity 0.4s;
      }
      .challenge-reward.show { opacity: 1; }

      .challenge-actions { text-align: center; padding: 8px 0 4px; min-height: 46px; }
      .challenge-btn {
        background: linear-gradient(180deg, #b06a28, #8a4e1c); color: #fff;
        border: 1px solid rgba(255,255,255,0.15); border-radius: 8px;
        padding: 10px 32px; font-size: 14px; font-weight: 700;
        cursor: pointer; letter-spacing: 1px;
        transition: filter 0.15s, opacity 0.3s;
      }
      .challenge-btn:hover { filter: brightness(1.15); }
      .challenge-btn.hidden { opacity: 0; pointer-events: none; }

      /* ---- Vignette canvas ---- */
      .challenge-vignette-wrap {
        display: flex; justify-content: center; padding: 6px 0 2px;
      }
      #challenge-vignette {
        border-radius: 10px;
        background: radial-gradient(ellipse at center, rgba(40,35,25,0.6), rgba(10,10,10,0.9));
        border: 1px solid rgba(200,170,90,0.15);
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
    `;
    document.head.appendChild(style);
  }

  log('Skill challenge system ready.', 'sys');
}

/* ---------- choose phase: render approach cards ---------- */
function showChoosePhase(state) {
  const ov = document.getElementById('challengescreen');
  if (!ov) return;
  const { game, challenge, approaches } = state;

  document.getElementById('challenge-name').textContent = challenge.name;
  document.getElementById('challenge-desc').textContent = challenge.desc;
  /* Narrate the situation line, if a voice file has been recorded for it.
     id = narrBase(challenge), matching scripts/narration/extract.mjs. */
  playNarration(narrBase(challenge));

  const mom = momentumBonus(game);
  document.getElementById('challenge-momentum').textContent = mom > 0 ? `🔥 Momentum +${mom}` : '';

  const outcomeEl = document.getElementById('challenge-outcome');
  const rewardEl = document.getElementById('challenge-reward');
  outcomeEl.classList.remove('show'); outcomeEl.textContent = '';
  rewardEl.classList.remove('show'); rewardEl.textContent = ''; rewardEl.style.color = '#e8c25a';
  document.getElementById('challenge-continue').classList.add('hidden');

  /* --- Initialize the vignette --- */
  if (_vignette) { _vignette.destroy(); _vignette = null; }
  const vigCanvas = document.getElementById('challenge-vignette');
  if (vigCanvas) {
    // Build party roster for the vignette: all alive heroes with their data
    const alive = game.heroes.filter(h => h.data.hp > 0);
    const party = alive.map((h, i) => ({ hero: h.data, name: h.data.name, index: i }));
    if (party.length > 0) {
      _vignette = new ChallengeVignette(vigCanvas);
      _vignette.init(party, challenge);
    }
  }

  const cardsEl = document.getElementById('challenge-cards');
  cardsEl.innerHTML = approaches.map((a, i) => {
    const skillInfo = SKILLS[a.skill];
    const skillLabel = skillInfo ? skillInfo.label : a.skill;
    const abilityLabel = skillInfo ? skillInfo.ability.toUpperCase() : '?';
    const attempt = a.party
      ? `<div class="appr-party-note">👥 PARTY CHECK<br>everyone rolls · half must succeed</div>`
      : `<div class="appr-heroes">${a.heroes.map(h =>
          `<span class="appr-hero-chip" data-appr="${i}" data-hero="${h.hero.data.name}">${h.hero.data.name} <b>${h.bonus >= 0 ? '+' : ''}${h.bonus}</b></span>`
        ).join('')}</div>`;
    return `
      <div class="appr-card" data-appr="${i}">
        <div class="appr-inner">
          <div class="appr-face appr-front">
            <div class="appr-top">
              <span class="appr-tier tier-${a.tier}">${TIERS[a.tier].label}</span>
              <span class="appr-dc">DC ${a.actualDC}</span>
            </div>
            <div class="appr-label">${a.label}</div>
            <div class="appr-skill">${skillLabel} (${abilityLabel})</div>
            <div class="appr-reward">${a.preview}</div>
            ${attempt}
          </div>
          <div class="appr-face appr-back"></div>
        </div>
      </div>`;
  }).join('');

  // Wire clicks: hero chip = that hero; anywhere else on card = best hero / party roll
  cardsEl.querySelectorAll('.appr-hero-chip').forEach(chip => {
    chip.addEventListener('click', e => {
      e.stopPropagation();
      const idx = +chip.dataset.appr;
      const hero = game.heroes.find(h => h.data.name === chip.dataset.hero);
      resolveApproach(state, idx, hero);
    });
  });
  cardsEl.querySelectorAll('.appr-card').forEach(card => {
    card.addEventListener('click', () => {
      resolveApproach(state, +card.dataset.appr, null);
    });
  });

  ov.classList.add('show');

  // Idle safety: auto-pick the first (safest) approach with the best hero
  if (_autoChooseTimer) clearTimeout(_autoChooseTimer);
  _autoChooseTimer = setTimeout(() => {
    _autoChooseTimer = null;
    if (_phase === 'choose') resolveApproach(state, 0, null);
  }, 30000);
}

/* ---------- roll phase: flip the chosen card, animate dice ---------- */
function startRollPhase(state, onContinue) {
  const cardsEl = document.getElementById('challenge-cards');
  const cards = cardsEl.querySelectorAll('.appr-card');
  const chosen = cardsEl.querySelector(`.appr-card[data-appr="${state.apprIdx}"]`);
  if (!chosen) return;

  const { result, appr, momentum } = state;

  /* --- Trigger vignette action animation --- */
  if (_vignette) {
    let perfIdx = -1;
    if (!result.party && result.hero) {
      perfIdx = _vignette.heroes.findIndex(h => h.name === result.hero.data.name);
    }
    if (perfIdx >= 0) _vignette.playAction(perfIdx);
  }

  _resolveOverlay = onContinue;

  cards.forEach(c => {
    if (c === chosen) c.classList.add('chosen');
    else c.classList.add('dimmed');
  });

  const back = chosen.querySelector('.appr-back');

  if (result.party) {
    // Party check back: needed count + one row per hero, revealed sequentially
    back.innerHTML = `
      <div class="appr-party-rolls">
        <div class="pr-needed">DC ${appr.actualDC} · need ${result.needed}/${result.rolls.length} successes${momentum ? ` · 🔥+${momentum}` : ''}</div>
        ${result.rolls.map(r => `
          <div class="pr-row">
            <span>${r.name}</span>
            <span>${r.d20}${r.bonus >= 0 ? '+' : ''}${r.bonus} = ${r.total}</span>
            <span class="${r.ok ? 'pr-ok' : 'pr-no'}">${r.ok ? '✓' : '✗'}</span>
          </div>`).join('')}
        <div class="appr-verdict" style="margin-top:8px;"></div>
      </div>`;
    chosen.classList.add('flipped');

    const rows = back.querySelectorAll('.pr-row');
    let i = 0;
    function revealNext() {
      if (i < rows.length) {
        rows[i].classList.add('show');
        i++;
        _diceInterval = setTimeout(revealNext, 260);
      } else {
        _diceInterval = null;
        const verdictEl = back.querySelector('.appr-verdict');
        if (result.isCrit) { verdictEl.textContent = '⚡ FLAWLESS!'; verdictEl.className = 'appr-verdict crit'; }
        else if (result.success) { verdictEl.textContent = `✅ ${result.successes}/${result.rolls.length} — SUCCESS`; verdictEl.className = 'appr-verdict success'; }
        else { verdictEl.textContent = `❌ ${result.successes}/${result.rolls.length} — FAILURE`; verdictEl.className = 'appr-verdict failure'; }
        showResult(state);
      }
    }
    _diceInterval = setTimeout(revealNext, 700); // wait for flip
    return;
  }

  // Single-hero back: d20 + math + verdict
  const skillInfo = SKILLS[appr.skill];
  back.innerHTML = `
    <div style="font-size:12px; font-weight:700; color:#f0e6cc; margin-bottom:6px;">${result.hero.data.name}</div>
    <div class="appr-d20">0</div>
    <div class="appr-roll-math"></div>
    <div class="appr-roll-sub">${skillInfo ? skillInfo.label : appr.skill}${momentum ? ` · 🔥 momentum +${momentum}` : ''} · DC ${appr.actualDC}</div>
    <div class="appr-verdict"></div>`;
  chosen.classList.add('flipped');

  const d20El = back.querySelector('.appr-d20');

  // Dice tick sequence: fast → slow for suspense (starts after the flip)
  const rollSequence = [];
  for (let i = 0; i < 10; i++) rollSequence.push(40);
  for (let i = 0; i < 6; i++) rollSequence.push(70 + i * 6);
  for (let i = 0; i < 6; i++) rollSequence.push(120 + i * 18);
  for (let i = 0; i < 4; i++) rollSequence.push(220 + i * 25);

  let seqIdx = 0;
  function nextRollTick() {
    if (seqIdx >= rollSequence.length) {
      _diceInterval = null;
      d20El.textContent = String(result.d20);
      if (result.isCrit) d20El.className = 'appr-d20 crit';
      else if (result.isCritFail) d20El.className = 'appr-d20 fumble';
      else if (result.success) d20El.className = 'appr-d20 success';
      else d20El.className = 'appr-d20 failure';

      back.querySelector('.appr-roll-math').textContent =
        `${result.d20} ${result.bonus >= 0 ? '+' : '−'} ${Math.abs(result.bonus)} = ${result.total} vs DC ${appr.actualDC}`;

      const verdictEl = back.querySelector('.appr-verdict');
      if (result.isCrit) { verdictEl.textContent = '⚡ CRITICAL!'; verdictEl.className = 'appr-verdict crit'; }
      else if (result.isCritFail) { verdictEl.textContent = '💥 FUMBLE!'; verdictEl.className = 'appr-verdict failure'; }
      else if (result.success) { verdictEl.textContent = '✅ SUCCESS'; verdictEl.className = 'appr-verdict success'; }
      else { verdictEl.textContent = '❌ FAILURE'; verdictEl.className = 'appr-verdict failure'; }

      showResult(state);
      return;
    }
    d20El.textContent = String(die(20));
    _diceInterval = setTimeout(nextRollTick, rollSequence[seqIdx++]);
  }
  _diceInterval = setTimeout(nextRollTick, 700); // wait for flip
}

/* ---------- result phase: outcome text, reward, continue ---------- */
function showResult(state) {
  _phase = 'result';
  const { result, appr, computedReward, computedFailure } = state;

  /* --- Trigger vignette success/failure reaction --- */
  if (_vignette) {
    if (result.success) _vignette.showSuccess();
    else _vignette.showFailure();
  }

  setTimeout(() => {
    const outcomeEl = document.getElementById('challenge-outcome');
    const rewardEl = document.getElementById('challenge-reward');

    outcomeEl.textContent = result.success ? appr.win : appr.lose;
    outcomeEl.classList.add('show');
    /* Queue the outcome line to play a beat after the action line finishes. */
    queueNarration(`${narrBase(state.challenge)}_a${state.apprIdx}${result.success ? '_win' : '_lose'}`, { delay: 500 });

    if (result.success && computedReward?.detailText) {
      rewardEl.textContent = `Reward: ${computedReward.detailText}`;
      rewardEl.classList.add('show');
    } else if (!result.success && computedFailure?.detailText) {
      rewardEl.textContent = computedFailure.detailText;
      rewardEl.style.color = '#e0705a';
      rewardEl.classList.add('show');
    }

    document.getElementById('challenge-continue').classList.remove('hidden');

    // 15s auto-continue — player can click sooner
    if (!_autoContinueTimer) {
      _autoContinueTimer = setTimeout(() => {
        const btn = document.getElementById('challenge-continue');
        if (btn) btn.click();
      }, 15000);
    }
  }, 350);
}

function dismissOverlay() {
  const ov = document.getElementById('challengescreen');
  if (ov) ov.classList.remove('show');
  if (_diceInterval) { clearTimeout(_diceInterval); _diceInterval = null; }
  if (_autoContinueTimer) { clearTimeout(_autoContinueTimer); _autoContinueTimer = null; }
  if (_autoChooseTimer) { clearTimeout(_autoChooseTimer); _autoChooseTimer = null; }
  /* --- Destroy vignette on overlay dismiss --- */
  if (_vignette) { _vignette.destroy(); _vignette = null; }
}

/* ================================================================
   Reset per-floor state (called when a new dungeon loads)
   ================================================================ */
export function resetChallengeState(game) {
  _challengesFired = new Set();
  _activeChallenge = null;
  _phase = 'idle';
  _resolveOverlay = null;
  if (_autoContinueTimer) { clearTimeout(_autoContinueTimer); _autoContinueTimer = null; }
  if (_autoChooseTimer) { clearTimeout(_autoChooseTimer); _autoChooseTimer = null; }
  if (_diceInterval) { clearTimeout(_diceInterval); _diceInterval = null; }
  if (game) {
    game._floorBuffs = [];    // floor-long boons expire with the floor
    game._floorDebuffs = [];  // wounded pride etc. expire with the floor
    game._skillMomentum = 0;  // momentum resets between floors
    game._entryChallenged = new Set();   // room-entry challenge roll tracking
    game._preBossFired = false;          // one-shot pre-boss challenge
    /* expire skill-granted EFFECTS-registry buffs/debuffs from heroes */
    if (game.heroes) {
      for (const h of game.heroes) clearEffectsByTag(h, 'skill');
    }
    /* dismiss any temp beast ally from animalFriend */
    if (typeof game.dismissTempAlly === 'function') game.dismissTempAlly();
  }
}

/* ================================================================
   Fire a specific camp challenge
   Called during camp/shop events for Persuasion/Insight checks
   ================================================================ */
export function fireCampChallenge(game, skillKey, onDone) {
  const pool = CHALLENGES.filter(c =>
    c.type === 'camp' && c.approaches.some(a => a.skill === skillKey));
  if (pool.length === 0) return false;

  const base = pool[Math.floor(Math.random() * pool.length)];
  /* Clone so we can attach an onResolved without mutating the registry. */
  const challenge = onDone
    ? { ...base, onResolved: (ok) => { try { onDone(ok); } catch (e) { /* noop */ } } }
    : base;
  fireChallenge(game, challenge);
  return true;
}

/* ================================================================
   Trigger helpers — chest, shrine, room-entry, pre-boss
   Each builds a dynamic challenge and fires it, calling onResolved
   (true/false) when the overlay closes so the caller can proceed.
   ================================================================ */

/* Static data for the dynamic-trigger challenges (chest / shrine / pre-boss).
   Pure data (no onResolved) so scripts/narration/extract.mjs can read them
   alongside CHALLENGES. `nid` overrides the narration id where the display name
   would collide with an array challenge (there are two "Locked Chest"s). Fired
   via fireChallenge, which clones approaches per fire — safe to reuse. */
export const CHALLENGES_DYNAMIC = [
  {
    key: 'lockedChest', nid: 'locked_chest_trapped',
    name: 'Locked Chest', type: 'room', reward: { kind: 'gold' },
    desc: 'An iron-bound chest sits unopened, its lock tarnished but cunning. A trap mechanism glints in the keyhole.',
    approaches: [
      { tier: 'safe', skill: 'investigation', label: 'Inspect for traps first',
        win: 'You find and ease the trigger. The lock yields meekly.',
        lose: 'The mechanism is too well hidden — you resort to brute force.' },
      { tier: 'standard', skill: 'sleightOfHand', label: 'Pick the lock',
        win: 'Tumblers fall one by one — the lid swings open.',
        lose: 'A pin snaps with a sharp click! A dart fires.', failEffect: 'trap',
        fail: { damage: [1, 6, 1], damageType: 'piercing' } },
      { tier: 'risky', skill: 'sleightOfHand', label: 'Everyone pry it open', party: true,
        win: 'Crowbars bite, the hinge screams — and the chest yields its hoard!',
        lose: 'Springs and darts! Everyone ducks a heartbeat too late.', failEffect: 'trap',
        fail: { damage: [2, 6, 2], damageType: 'piercing' } }
    ]
  },
  {
    key: 'shrine',
    name: 'Ancient Shrine', type: 'room',
    reward: { kind: 'buffEffect', buffKey: 'shielded', buffTargets: 'party', buffDuration: 25 },
    desc: 'A weathered shrine hums with old power. The correct rites might amplify its blessing before you rest.',
    approaches: [
      { tier: 'safe', skill: 'religion', label: 'Offer a quiet prayer',
        win: 'The shrine warms — a ward settles over the party.',
        lose: 'The shrine stays cold. No heed.' },
      { tier: 'standard', skill: 'arcana', label: 'Channel the resonance',
        win: 'Arcane energy flows — the party is shielded.',
        lose: 'The energy disperses into the stone.' },
      { tier: 'risky', skill: 'religion', label: 'Invoke the old name aloud', party: true,
        win: 'The shrine blazes! A powerful ward shields everyone.',
        lose: 'Blasphemy — the shrine recoils with a frightful roar.', failEffect: 'frighten',
        fail: { debuffTargets: 'party' } }
    ]
  },
  {
    key: 'preBoss',
    name: 'Whispers at the Threshold', type: 'room', reward: { kind: 'info' },
    desc: 'Before the final door, old carvings murmur of what waits beyond. A clever reading could reveal its weakness.',
    approaches: [
      { tier: 'safe', skill: 'history', label: 'Recall what the carvings depict',
        win: 'The tale names the foe — and where it falters.',
        lose: 'The script is too weathered to parse.' },
      { tier: 'standard', skill: 'arcana', label: 'Read the binding runes',
        win: 'The runes lay the boss\'s nature bare. It is marked.',
        lose: 'The runes are cold and uninformative.' },
      { tier: 'risky', skill: 'religion', label: 'Demand the truth', party: true,
        win: 'The carvings blaze — the boss\'s weakness is laid open for all to see!',
        lose: 'The carvings screech. Something stirs beyond the door.', failEffect: 'alert' }
    ]
  }
];
const dynChallenge = k => CHALLENGES_DYNAMIC.find(c => c.key === k);

/** A locked/trapped chest: success pays bonus gold then the caller opens it,
 *  failure springs a trap (piercing damage). */
export function fireChestChallenge(game, chest, onResolved) {
  if (_phase !== 'idle') return false;
  fireChallenge(game, { ...dynChallenge('lockedChest'),
    onResolved: (ok) => { try { onResolved(ok); } catch (e) { /* noop */ } } });
  return true;
}

/** A shrine: proper rites grant a shielded boon; blasphemy frightens the party. */
export function fireShrineChallenge(game, shrine, onResolved) {
  if (_phase !== 'idle') return false;
  fireChallenge(game, { ...dynChallenge('shrine'),
    onResolved: (ok) => { try { onResolved(ok); } catch (e) { /* noop */ } } });
  return true;
}

/** Pre-boss lore challenge: reveals & marks the boss (bossIntel) on success. */
export function firePreBossChallenge(game, onResolved) {
  if (_phase !== 'idle') return false;
  fireChallenge(game, { ...dynChallenge('preBoss'),
    onResolved: (ok) => { try { onResolved(ok); } catch (e) { /* noop */ } } });
  return true;
}

/**
 * Per-frame scan for room-entry challenges (combat/elite rooms just entered)
 * and the one-shot pre-boss challenge. Idempotent via the _entryChallenged set.
 */
export function checkRoomEntryChallenge(game) {
  if (!game || !game.D || !game.D.rooms) return;
  if (_phase !== 'idle') return;
  if (game.state !== 'crawl' || game.paused) return;
  if (!game.heroes.some(h => h.data.hp > 0)) return;

  if (!game._entryChallenged) game._entryChallenged = new Set();

  /* Pre-boss: when the boss room is adjacent/known but not yet entered, fire once. */
  if (!game._preBossFired && game.D.boss !== undefined && game.visitedRooms &&
      !game.visitedRooms[game.D.boss] && game._searchRoom === game.D.boss) {
    /* party is actively heading to the boss — fire the threshold challenge */
    if (Math.random() < 0.5) {
      game._preBossFired = true;
      const ok = firePreBossChallenge(game, () => {});
      if (ok) return;
    } else {
      game._preBossFired = true;   // rolled, skip
    }
  }

    /* Room-entry: small chance when a combat/elite room is freshly visited. */
  for (let rid = 0; rid < game.D.rooms.length; rid++) {
    if (game._entryChallenged.has(rid)) continue;
    if (!game.visitedRooms || !game.visitedRooms[rid]) continue;
    const t = game.D.rooms[rid].type;
    if (t !== 'combat' && t !== 'elite') continue;
    game._entryChallenged.add(rid);
    if (Math.random() < 0.09) {
      const pool = CHALLENGES.filter(c =>
        (c.type === 'room') && c.approaches.some(a =>
          a.skill === 'perception' || a.skill === 'insight' || a.skill === 'investigation'));
      if (pool.length) {
        fireChallenge(game, pool[Math.floor(Math.random() * pool.length)]);
        return;
      }
    }
  }
}

/* Exported for testing/debug console use */
export { CHALLENGES };
