/* ── light & sight rules ───────────────────────────────────────────────────
   Who can see whom, and what that does to an attack. Built on the hidden
   light status every creature carries (render/sprite_lighting.js writes
   u.lightState from the steady light map; game/light_sources.js reads it).
   docs/LIGHT_IDEAS.md items 1, 2, 5, 15, 16, 18, 52.

   A creature standing in BRIGHT or DIM light is seen by everyone. One in the
   DARK is seen only by an observer with a sense that reaches it:
     - darkvision (monsters only, from statblock senses — heroes have none),
     - Devil's Sight (warlock invocation) — also pierces magical Darkness,
     - blindsight / tremorsense / truesight (monsters) — ignore light entirely.
   Attacking from the dark gives you away: the attacker stays "revealed" until
   it moves off the spot it struck from.

   Pure logic — no THREE, no scene — so combat code and tests share it. */
import { lightStateOf } from './light_sources.js';
import { hasFeat, hasFeature } from './features.js';
import { hasEffect } from './conditions.js';

const FT = 5;                         // feet per tile
const DEVILS_SIGHT_TILES = 24;        // 120 ft
const REVEAL_MOVE = 1.5;              // tiles an attacker must move to slip back into the dark

const dataOf = u => (u && (u.data || u)) || null;

/** Sense ranges in tiles: { darkvision, blindsight, devilsSight }. */
export function senseRanges(u) {
  const d = dataOf(u);
  const out = { darkvision: 0, blindsight: 0, devilsSight: 0 };
  if (!d) return out;
  /* heroes have no darkvision (removed: it read badly) — only the warlock's
     Devil's Sight lets one see in the dark */
  if (hasFeature(d, 'devilsSight')) out.devilsSight = DEVILS_SIGHT_TILES;
  /* monsters: statblock senses (feet) */
  const s = d.statblock && d.statblock.senses;
  if (s) {
    if (s.darkvision) out.darkvision = Math.max(out.darkvision, s.darkvision / FT);
    const blind = Math.max(s.blindsight || 0, s.tremorsense || 0, s.truesight || 0);
    if (blind) out.blindsight = blind / FT;
  }
  if (d.darkvision && !s) out.darkvision = Math.max(out.darkvision, d.darkvision / FT);
  return out;
}

/** The light a creature counts as standing in, for sight. An outlined
 *  creature (Faerie Fire, Guiding Bolt) is never darker than dim. */
export function isOutlined(u) {
  return !!(u && (u._outlined || (u.data && u.data._outlined) || hasEffect(u, 'faerieFire') || hasEffect(u, 'guided')));
}
export function effectiveLightState(u) {
  const st = lightStateOf(u);
  if (st === 'dark' && isOutlined(u)) return 'dim';
  return st;
}

/** Has `u` struck from the dark and not yet moved off that spot? */
function isRevealed(u) {
  const r = u && u._revealedAt;
  if (!r) return false;
  if (Math.hypot((u.x || 0) - r.x, (u.z || 0) - r.z) >= REVEAL_MOVE) { u._revealedAt = null; return false; }
  return true;
}

/* Ranger "Umbral Sight" talent: unseen by darkvision while standing in the dark. */
function hasUmbralSight(u) {
  const d = dataOf(u);
  return !!(d && d.skills && d.skills.umbralSight > 0);
}

/** Hide (rogue Cunning Action, Skulker): possible on a dim or dark tile. */
export function canHide(u) {
  const d = dataOf(u);
  if (!d) return false;
  const able = hasFeature(d, 'cunningActionClass') || hasFeat(d, 'skulker');
  return able && effectiveLightState(u) !== 'bright';
}

/** Can `observer` see `target` right now? */
export function canSee(observer, target) {
  if (!observer || !target || observer === target) return true;
  const dist = Math.hypot((target.x || 0) - (observer.x || 0), (target.z || 0) - (observer.z || 0));
  const sense = senseRanges(observer);
  if (sense.blindsight >= dist) return true;
  /* Hidden (Cunning Action / Skulker): unseen until it attacks or steps into
     bright light. Only blindsight (above) finds it. */
  if (target._hidden) {
    if (effectiveLightState(target) === 'bright' || isOutlined(target)) target._hidden = false;
    else return false;
  }
  /* magical Darkness: only Devil's Sight (and blindsight, above) pierces it,
     from either side */
  if (target._inMagicalDarkness || observer._inMagicalDarkness) {
    return sense.devilsSight >= dist;
  }
  if (effectiveLightState(target) !== 'dark') return true;
  if (isRevealed(target)) return true;
  if (sense.devilsSight >= dist) return true;
  if (sense.darkvision >= dist && !hasUmbralSight(target)) return true;
  return false;
}

/**
 * Advantage from sight for `attacker` hitting `target` (5e):
 *   -1  the attacker can't see the target (unseen target)
 *   +1  the target can't see the attacker (unseen attacker) — not against
 *       a target with the Alert feat
 * Returns { adv, unseenTarget, unseenAttacker }.
 */
export function sightAdvantage(attacker, target) {
  const unseenTarget = !canSee(attacker, target);
  const unseenAttacker = !canSee(target, attacker) && !hasFeat(dataOf(target), 'alert');
  return { adv: (unseenTarget ? -1 : 0) + (unseenAttacker ? 1 : 0), unseenTarget, unseenAttacker };
}

/** Call after an attack resolves. Striking unseen gives the attacker away
 *  until it moves off the spot (it no longer counts as hidden). */
export function noteAttackFromDark(attacker, wasUnseen) {
  if (!attacker || !wasUnseen) return;
  attacker._revealedAt = { x: attacker.x || 0, z: attacker.z || 0 };
}

/** Is `u` currently giving its position away with a carried light? */
export function carriesActiveLight(u) {
  return !!(u && u._lightActive);
}

/* Rule 4: monsters notice a lit hero from further, an unseen one from closer. */
export const NOTICE = { lit: 1.5, unseen: 0.7 };
export function noticeRangeMul(monster, hero) {
  if (carriesActiveLight(hero)) return NOTICE.lit;
  if (!canSee(monster, hero)) return NOTICE.unseen;
  return 1;
}

/* Rule 3/15/53: Perception in dim light (or darkness seen only through
   darkvision) is at disadvantage. Dungeon Delver ignores it. Returns -1 or 0. */
export function perceptionAdv(u) {
  const d = dataOf(u);
  if (d && hasFeat(d, 'dungeonDelver')) return 0;
  const st = effectiveLightState(u);
  if (st === 'dim' && d && hasFeat(d, 'skulker')) return 0;   // Skulker: dim never hinders you
  return (st === 'dim' || st === 'dark') ? -1 : 0;
}
