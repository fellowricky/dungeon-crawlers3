/**
 * Per-quest run statistics — created at embark, finalized at quest complete,
 * shown on the end-of-quest results screen.
 *
 * Deliberately DOM-free (pure functions over the game object) so vitest and
 * the headless smoke tests can exercise it.
 *
 * Hero combat counters (kills / dmgDealt / dmgTaken / downs / xp) are lifetime
 * cumulative numbers on h.data — the run's share is current − baseline, where
 * the baseline is snapshotted at embark (or at save-resume for old saves).
 */

function snapshotHero(d) {
  return {
    kills: d.kills || 0,
    dmgDealt: d.dmgDealt || 0,
    dmgTaken: d.dmgTaken || 0,
    downs: d.downs || 0,
    xp: d.xp || 0
  };
}

export function initRunStats(game, quest) {
  const baseline = {};
  for (const h of game.heroes) {
    if (h.temp || h.companion) continue;
    baseline[h.data.name] = snapshotHero(h.data);
  }
  game.runStats = {
    questId: quest.id,
    questName: quest.name,
    startedAt: Date.now(),
    /* engine time bookkeeping: playedSec accumulates across save/load,
       startElapsed anchors the current session (game.elapsed resets on boot) */
    playedSec: 0,
    startElapsed: game.elapsed || 0,
    goldEarned: 0,
    itemsLooted: 0,
    lootByRarity: {},
    notableLoot: [],
    floorsCleared: 0,
    baseline
  };
}

/** Gold earned from loot & rewards (kills, bosses, chests, objectives —
 *  deliberately NOT camp-shop sale income). No-op outside a quest run. */
export function trackGold(game, n) {
  if (!game.runStats || !n) return;
  game.runStats.goldEarned += n;
}

/** An item entering the party's bag from the dungeon (drops, hoards, chests,
 *  quest rewards — not shop purchases). */
export function trackLoot(game, item) {
  if (!game.runStats || !item) return;
  const rs = game.runStats;
  rs.itemsLooted++;
  const r = item.rarity || 'common';
  rs.lootByRarity[r] = (rs.lootByRarity[r] || 0) + 1;
  if (r === 'epic' || r === 'legendary') rs.notableLoot.push({ name: item.name, rarity: r });
}

export function trackFloor(game) {
  if (!game.runStats) return;
  game.runStats.floorsCleared++;
}

/** Snapshot for the save file: fold the live session's elapsed time into
 *  playedSec so a resumed run keeps an honest clock. Does not mutate live state. */
export function serializeRunStats(game) {
  const rs = game.runStats;
  if (!rs) return null;
  const sessionSec = Math.max(0, (game.elapsed || 0) - (rs.startElapsed || 0));
  return { ...rs, playedSec: (rs.playedSec || 0) + sessionSec, startElapsed: 0 };
}

/** Re-attach saved run stats on load (game.elapsed restarts at ~0). */
export function restoreRunStats(game, saved) {
  if (!saved) { game.runStats = null; return; }
  game.runStats = { ...saved, startElapsed: 0 };
}

/**
 * Build the results-screen summary. Returns null when no run was tracked.
 * Heroes missing a baseline entry (shouldn't happen — rosters can't change
 * mid-run) are credited nothing rather than their lifetime totals.
 */
export function finalizeRunStats(game) {
  const rs = game.runStats;
  if (!rs) return null;

  const heroes = [];
  const totals = { kills: 0, dmgDealt: 0, dmgTaken: 0, downs: 0, xp: 0 };
  for (const h of game.heroes) {
    if (h.temp || h.companion) continue;
    const now = snapshotHero(h.data);
    const base = rs.baseline[h.data.name] || now;
    const row = {
      name: h.data.name,
      kills: Math.max(0, now.kills - base.kills),
      dmgDealt: Math.max(0, now.dmgDealt - base.dmgDealt),
      dmgTaken: Math.max(0, now.dmgTaken - base.dmgTaken),
      downs: Math.max(0, now.downs - base.downs),
      xp: Math.max(0, now.xp - base.xp)
    };
    heroes.push(row);
    totals.kills += row.kills;
    totals.dmgDealt += row.dmgDealt;
    totals.dmgTaken += row.dmgTaken;
    totals.downs += row.downs;
    totals.xp += row.xp;
  }

  const elapsedSec = (rs.playedSec || 0)
    + Math.max(0, (game.elapsed || 0) - (rs.startElapsed || 0));

  return {
    questId: rs.questId,
    questName: rs.questName,
    heroes,
    totals,
    goldEarned: rs.goldEarned,
    itemsLooted: rs.itemsLooted,
    lootByRarity: rs.lootByRarity,
    notableLoot: rs.notableLoot,
    floorsCleared: rs.floorsCleared,
    elapsedSec
  };
}
