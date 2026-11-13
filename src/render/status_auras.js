/**
 * Status auras — a live pixelfx effect on a creature for exactly as long as it
 * has a status: Zs over a magically sleeping goblin until something wakes it,
 * a violet stain creeping up a hexed one, stone over a petrified one.
 *
 * Each frame syncStatusAuras() is handed every creature on the field and
 * compares STATUS_AURAS against each one's _effects: a status that appeared
 * gets its aura, one that ended (or a creature that died or left the list)
 * has its aura fade out — or, for a held one-shot, play out its ending (the
 * stone shatters off, the roots crumble). Auras are painted onto the
 * creature's own sprite (body_fx.js), so they sit on its real head and body,
 * follow it and scale with it.
 *
 * pixelfx has thirteen status effects; the game has many more statuses, so
 * effects are reused in different palettes (Hex violet, Bane blood, Drained
 * necrotic) and a few non-status effects fill in (holy shields and halos for
 * wards, necro skulls for fear, roots for Rooted). Statuses with no aura here
 * either show elsewhere (zones, size, the polymorph model, invisibility) or
 * have no pixelfx effect that fits yet.
 */

import { hasEffect, getEffect } from '../game/conditions.js';
import { syncMirrorImages } from './mirror_images.js';
import { spawnBodyFx, spawnBodyEffect } from './body_fx.js';
import { PAL } from '../vendor/pixelfx/core/index.js';
import * as sleep from './pfx/status_sleep.js';
import * as bleeding from '../vendor/pixelfx/fx/status/bleeding.js';
import * as burning from '../vendor/pixelfx/fx/status/burning.js';
import * as charmed from '../vendor/pixelfx/fx/status/charmed.js';
import * as confused from '../vendor/pixelfx/fx/status/confused.js';
import * as cursed from './pfx/status_cursed.js';
import * as statusWarded from './pfx/status_warded.js';
import * as statusBlinded from './pfx/status_blinded.js';
import * as statusLaughter from './pfx/status_laughter.js';
import * as statusShielded from './pfx/status_shielded.js';
import * as statusRime from './pfx/status_rime.js';
import * as haste from '../vendor/pixelfx/fx/status/haste.js';
import * as petrified from '../vendor/pixelfx/fx/status/petrified.js';
import * as poisoned from './pfx/status_poisoned.js';
import * as rage from '../vendor/pixelfx/fx/status/rage.js';
import * as slowed from '../vendor/pixelfx/fx/status/slowed.js';
import * as stunned from '../vendor/pixelfx/fx/status/stunned.js';
import * as blessing from '../vendor/pixelfx/fx/holy/blessing.js';
import * as divineShield from '../vendor/pixelfx/fx/holy/divine-shield.js';
import * as halo from '../vendor/pixelfx/fx/holy/halo.js';
import * as necroSkulls from '../vendor/pixelfx/fx/shadow/necro-skulls.js';
import * as rootSnare from '../vendor/pixelfx/fx/nature/root-snare.js';
import * as markedMote from './pfx/marked_mote.js';
import * as runeCircle from '../vendor/pixelfx/fx/arcane/rune-circle.js';
import { RAMPS } from './pfx/ramps.js';

/* status key -> { mod, options?, holdAt?, anchor?, tint?, still? } — tint multiplies the creature's own
   sprite and still stops its animation, for as long as the status lasts; options go to the effect
   (palette ramps of any length are refitted by pixelfx); holdAt freezes a
   one-shot at that second for as long as the status lasts; anchor 'overhead'
   lifts an effect authored round a floor point up over the head. */
export const STATUS_AURAS = {
  /* ── debuffs ── */
  unconscious:   { mod: sleep },                                              // Sleep: Zs off the head
  charmed:       { mod: charmed },                                            // a beating heart, pink eyes
  frightened:    { mod: necroSkulls, options: { palette: RAMPS.spectral } },  // pale skulls circling
  blinded:       { mod: statusBlinded, fadeIn: 0.2 },                         // black smoke across the eyes
  poisoned:      { mod: poisoned },                                           // blisters and dripping sweat
  acidCoated:    { mod: poisoned, options: { palette: PAL.leaf } },           // Acid Arrow still eating in: blisters and drips
  corroded:      { mod: poisoned, options: { palette: RAMPS.acid } },         // acid eating the armour
  paralyzed:     { mod: statusRime, options: { palette: PAL.arcane }, fadeIn: 0.2, tint: 0xb9a6ff, still: true },  // Hold Person: the body itself tinted and stopped, rime over it
  stunned:       { mod: stunned },                                            // stars and birds
  incapacitated: { mod: confused },                                           // Hideous Laughter: head in a spin
  dominated:     { mod: confused, options: { palette: PAL.shadow } },         // a dark spiral: not your own mind
  slowed:        { mod: slowed },                                             // the heavy clock
  burning:       { mod: burning },
  guided:        { mod: burning, options: { palette: PAL.volt } },            // Guiding Bolt: glittering in bright yellow light
  faerieFire:    { mod: burning, options: { palette: RAMPS.faerie } },        // outlined in violet faerie flame
  wounded:       { mod: bleeding },
  hexMarked:     { mod: cursed },                                             // violet smoke, a stain from the feet
  baned:         { mod: cursed, options: { palette: PAL.blood } },
  drained:       { mod: cursed, options: { palette: RAMPS.necrotic } },
  weakenedDmg:   { mod: cursed, options: { palette: PAL.dust } },
  bossWeakened:  { mod: cursed, options: { palette: PAL.metal } },
  petrified:     { mod: petrified, holdAt: 1.8 },                             // stone, then it shatters off
  rooted:        { mod: rootSnare, holdAt: 1.3 },                             // roots wrap, then crumble
  restrained:    { mod: rootSnare, options: { palette: PAL.bone, glow: RAMPS.silkGlow }, holdAt: 1.3 },  // bound in pale silk / rope
  silenced:      { mod: runeCircle, options: { palette: RAMPS.hush } },       // a hushed night-indigo seal turning underfoot
  huntersMarked: { mod: markedMote, options: { palette: RAMPS.marked }, anchor: 'overhead' },  // a small red mote circling over the quarry's head

  /* ── buffs ── */
  blessed:       { mod: halo },                                               // Bless: a gold ring over the head
  inspired:      { mod: blessing, options: { palette: PAL.arcane } },
  regenerating:  { mod: blessing, options: { palette: PAL.heal } },
  crusadersMantle: { mod: blessing, options: { palette: PAL.gold } },
  shieldOfFaith: { mod: statusShielded, options: { palette: PAL.holy }, fadeIn: 0.01 },
  shielded:      { mod: statusShielded, options: { palette: PAL.ice }, fadeIn: 0.01 },        // Shield: arcane blue
  warded:        { mod: statusWarded, options: { palette: PAL.holy } },       // a faint gold outline, a few motes
  resistant:     { mod: divineShield, options: { palette: PAL.stone } },
  heroism:       { mod: halo },
  foresight:     { mod: halo, options: { palette: PAL.ice } },
  deathWarded:   { mod: halo, options: { palette: PAL.bone } },
  hasted:        { mod: haste },
  raging:        { mod: rage },
  bloodlust:     { mod: rage, options: { palette: PAL.blood } },
  barkskin:      { mod: statusWarded, options: { palette: PAL.wood, motes: 4, line: 0.4 }, endsWith: 'barkBurst' },  // the body turns to bark
};

/* A status that looks different depending on what caused it: the effect record
   names one of these in its `aura` (Entangle's restrained is green roots, not silk). */
const AURA_VARIANTS = {
  entangled: { mod: rootSnare, options: { palette: PAL.leaf }, holdAt: 1.3 },
  laughing: { mod: statusLaughter, fadeIn: 0.01 },
};

/* Statuses drawn on the creature some other way than an aura: the paper doll's weapon glows (Magic Weapon), or ghosts of it
   drift round it (Mirror Image). */
const DRAWN_ON_BODY = new Set(['magicWeapon', 'mirrorImages']);

/** True when a status has a pixel indicator of its own, so the emoji tray over the head leaves it out. A status added to
 *  STATUS_AURAS drops its emoji with no other change. */
export function hasPixelIndicator(key) {
  return Object.prototype.hasOwnProperty.call(STATUS_AURAS, key) || DRAWN_ON_BODY.has(key);
}

/* creature -> { status key -> live handle }. A WeakMap, not a field on the
   creature, so nothing render-side can end up in a save. */
const auras = new WeakMap();
let tracked = new Set();

/** A status's hold on the creature's own sprite: its tint, and a stopped animation. */
function holdBody(e, def, on) {
  const v = e.ent, anim = v && v.anim, mesh = anim && anim.mesh;
  if (!mesh) return;
  if (def.tint != null) {
    v.restTint = on ? def.tint : undefined;
    if (!(v.flashT > 0)) mesh.material.color.set(on ? def.tint : 0xffffff);   // a hit flash ends on restTint
  }
  if (def.still && on && !anim._held) {
    anim._held = anim.update;
    anim.update = () => {};
  } else if (def.still && !on && anim._held) {
    anim.update = anim._held;
    anim._held = null;
  }
}

/** Bring every creature's auras in line with its statuses. */
export function syncStatusAuras(creatures) {
  const seen = new Set();
  for (const e of creatures) {
    if (!e || !e.ent || !e.ent.grp) continue;
    /* only a counted-down hp means dead (bestiary rows carry hp as dice) */
    const alive = !e.dead && !(e.data && typeof e.data.hp === 'number' && e.data.hp <= 0);
    let mine = auras.get(e);
    for (const [key, def] of Object.entries(STATUS_AURAS)) {
      const want = alive && hasEffect(e, key);
      const have = mine && mine[key];
      if (want && !have) {
        /* null until the sprite has loaded: try again next frame */
        const look = AURA_VARIANTS[getEffect(e, key)?.aura] || def;
        const fx = spawnBodyFx(look.mod, e, { options: look.options, holdAt: look.holdAt, anchor: look.anchor, fadeIn: look.fadeIn });
        if (fx) {
          if (!mine) auras.set(e, (mine = {}));
          mine[key] = fx;
          holdBody(e, def, true);
        }
      } else if (!want && have) {
        have.remove();
        delete mine[key];
        holdBody(e, def, false);
        if (def.endsWith && alive) spawnBodyEffect(def.endsWith, e);
      }
    }
    /* Mirror Image: no aura, a ghost of the creature per image left */
    syncMirrorImages(e, alive ? (getEffect(e, 'mirrorImages')?.images || 0) : 0);
    /* Magic Weapon: no aura, the paper doll's own weapon glows (creatures without one simply don't) */
    if (e.ent.anim && e.ent.anim.setWeaponGlow) e.ent.anim.setWeaponGlow(alive && hasEffect(e, 'magicWeapon'));
    if (mine) seen.add(e);
  }
  /* creatures gone from the field (killed and removed, a floor change) */
  for (const e of tracked) if (!seen.has(e)) dropAuras(e);
  tracked = seen;
}

function dropAuras(e) {
  const mine = auras.get(e);
  if (!mine) return;
  for (const k of Object.keys(mine)) {
    mine[k].remove();
    holdBody(e, STATUS_AURAS[k], false);
  }
  auras.delete(e);
}
