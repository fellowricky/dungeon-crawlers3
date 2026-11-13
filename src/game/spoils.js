/**
 * Fight spoils — what one fight won, and how the party fought it.
 *
 * Drops still land in the bag the moment a monster dies (nothing can be lost
 * to a wipe or a save mid-fight), but quietly: no feed line, no log pop. They
 * are held here instead, and the whole haul is revealed when the fight ends,
 * as cards (item_reveal.js), after a short report.
 *
 * DOM-free (pure functions over the game object) so vitest can drive it.
 * Hero counters (kills / dmgDealt / dmgTaken / healDone / downs / xp) are lifetime
 * numbers on h.data; a fight's share is the end value minus the start one.
 */

function partyOf(game) {
  return (game.heroes || []).filter((h) => h && h.data && !h.temp && !h.companion);
}

function snap(d) {
  return { kills: d.kills || 0, dmgDealt: d.dmgDealt || 0, dmgTaken: d.dmgTaken || 0, healDone: d.healDone || 0, downs: d.downs || 0, xp: d.xp || 0, level: d.level || 1 };
}

/** The fight has just engaged: remember where everyone stood. */
export function beginFightSpoils(game) {
  const base = new Map();
  for (const h of partyOf(game)) base.set(h, snap(h.data));
  game.fightSpoils = { base, gold: game.gold || 0, items: [], notes: [], rounds: 0 };
}

/** True while a fight is being tallied (drops should be held, not announced). */
export function isHoldingSpoils(game) {
  return !!game.fightSpoils;
}

/** A drop won in this fight: kept for the reveal. Returns false when no fight
 *  is being tallied, so the caller announces it the old way. */
export function holdFightLoot(game, item) {
  const s = game.fightSpoils;
  if (!s || !item) return false;
  s.items.push(item);
  noteFightRound(game);
  return true;
}

/** A line for the report that isn't gear (Knowledge Tomes, a rival company beaten). */
export function noteFightSpoil(game, text) {
  const s = game.fightSpoils;
  if (!s || !text) return false;
  s.notes.push(text);
  return true;
}

/** Initiative resets as the fight ends, so the round count is kept as it goes. */
export function noteFightRound(game) {
  const s = game.fightSpoils;
  const r = game.initiative && game.initiative.round;
  if (s && r > s.rounds) s.rounds = r;
}

/** The fight is over: the report, and the end of the tally. Null if none was running. */
export function finishFightSpoils(game) {
  const s = game.fightSpoils;
  if (!s) return null;
  noteFightRound(game);
  game.fightSpoils = null;
  const heroes = [];
  for (const [h, b] of s.base) {
    if (!h || !h.data) continue;
    const d = h.data;
    heroes.push({
      name: d.name,
      classKey: d.classKey,
      kills: (d.kills || 0) - b.kills,
      dmgDealt: (d.dmgDealt || 0) - b.dmgDealt,
      dmgTaken: (d.dmgTaken || 0) - b.dmgTaken,
      healDone: (d.healDone || 0) - b.healDone,
      downs: (d.downs || 0) - b.downs,
      xp: Math.max(0, (d.xp || 0) - b.xp),
      levelUp: (d.level || 1) > b.level,
      alive: d.hp > 0,
    });
  }
  const totals = heroes.reduce((t, r) => ({
    kills: t.kills + r.kills, dmgDealt: t.dmgDealt + r.dmgDealt, dmgTaken: t.dmgTaken + r.dmgTaken, healDone: t.healDone + r.healDone, downs: t.downs + r.downs,
  }), { kills: 0, dmgDealt: 0, dmgTaken: 0, healDone: 0, downs: 0 });
  /* MVP: the most damage dealt plus healing done (a healer who kept everyone up
     counts as much as a striker); ties go to the more kills */
  const score = (r) => r.dmgDealt + r.healDone;
  const mvp = heroes.length
    ? heroes.reduce((a, r) => (score(r) > score(a) || (score(r) === score(a) && r.kills > a.kills) ? r : a))
    : null;
  return {
    heroes,
    totals,
    mvp: mvp && score(mvp) > 0 ? mvp.name : null,
    /* XP is shared out evenly, so one hero's gain is the party's per-head share */
    xpEach: heroes.reduce((m, r) => Math.max(m, r.xp), 0),
    gold: Math.max(0, (game.gold || 0) - s.gold),
    items: s.items,
    notes: s.notes,
    rounds: s.rounds,
    wiped: heroes.length > 0 && heroes.every((r) => !r.alive),
  };
}

/** Level change / new run: drop the tally (its items are already in the bag). */
export function cancelFightSpoils(game) {
  game.fightSpoils = null;
}
