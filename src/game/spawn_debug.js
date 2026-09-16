/**
 * SPAWN DEBUG — per-fight room roster + budget readout.
 *
 * Fired once each time a new fight engages (see game.js, the
 * `this.combat && !this.wasCombat` block). Prints, to the console, the
 * monsters actually fielded in that room, the threat budget the generator
 * charged for the room, and the constraints (budget, spawn cap, CR ceiling,
 * roster ladder, dungeon level/theme/threat) the room was supposed to
 * honour — so over- and under-budget rooms are visible before anything is
 * "fixed".
 *
 * Always on by default; set `window.DC_SPAWN_DEBUG = false` to silence.
 */
import {
  roomSpawnBudget, roomSpawnCap, crLadderFor
} from '../dungeon/dungeon_generator.js';
import { maxCrForDungeonLevel, crToCost } from './constants.js';
import { dungeonMonsterIds, MONSTERS_BY_ID } from './srd.js';

const PREFIX = '[spawn-debug]';

let enabled = typeof window === 'undefined' || window.DC_SPAWN_DEBUG !== false;

export function setSpawnDebugEnabled(v) {
  enabled = !!v;
}

function fmtCR(cr) {
  if (cr === 0.125) return '1/8';
  if (cr === 0.25) return '1/4';
  if (cr === 0.5) return '1/2';
  return String(cr ?? '?');
}

function costOf(cr) {
  return crToCost(cr ?? 0);
}

function fmtCost(cr) {
  const c = costOf(cr);
  return `${fmtCR(cr)}(${c})`;
}

/**
 * Log the room's spawn budget + fielded monsters for one combat.
 * `roomId` comes from game.combatRoomId (the leader's cell at fight start).
 */
export function logRoomSpawnDebug(game, roomId) {
  if (!enabled) return;
  const D = game && game.D;
  if (!D || !Array.isArray(D.rooms) || !Array.isArray(D.spawns)) return;

  const room = D.rooms[roomId];
  if (!room || (room.type !== 'combat' && room.type !== 'elite' && room.type !== 'boss')) return;

  const level = D.params?.level || 1;
  const threatMult = D.params?.threatMult || 1;
  const themeKey = D.themeKey || D.params?.themeKey || 'ancient';
  const difficulty = room.difficulty || 0;

  /* -- constraints the room was meant to be constrained by -- */
  const budget = roomSpawnBudget(room.type, difficulty, threatMult, level);
  const cap = roomSpawnCap(level);
  const ceiling = maxCrForDungeonLevel(level);
  const ladder = crLadderFor({ level, themeKey });

  /* -- budget side: the generator's priced slots for this room -- */
  const slots = D.spawns.filter(sp => sp.roomId === roomId);
  const paid = slots.reduce((a, sp) => a + costOf(sp.targetCR), 0);

  /* -- fielded side: actual monsters in the room -- */
  const fielded = (game.monsters || []).filter(m => m.roomId === roomId);
  const fieldedWorth = fielded.reduce((a, m) => a + costOf(m.data?.cr), 0);

  /* The runtime draws from dungeonMonsterIds(themeKey) — the SAME roster the
     generator prices against via dungeonMonsterCRs. If the two disagree (e.g.
     localStorage bestiary edits), the paid price and the fielded creature
     drift apart. Dump the multiset so a mismatch is visible. */
  const rosterIds = dungeonMonsterIds(themeKey);
  const rosterCRs = {};
  for (const id of rosterIds) {
    const c = MONSTERS_BY_ID[id]?.cr;
    if (typeof c === 'number' && c > 0) rosterCRs[fmtCR(c)] = (rosterCRs[fmtCR(c)] || 0) + 1;
  }

  const isEliteRoom = roomId === D.boss && fielded.some(m => m.isElitePack);
  const isBossRoom = roomId === D.boss && fielded.some(m => m.isBoss);

  console.groupCollapsed(
    `${PREFIX} Room ${roomId} · ${room.type}${room.roomStyle && room.roomStyle !== 'generic' ? ' · ' + room.roomStyle : ''}` +
    ` · difficulty ${difficulty.toFixed(2)} · ${themeKey} @ lvl ${level} · threat ×${threatMult}` +
    ` (runtime quest lvl ${game.activeQuest?.level ?? game.dungeonLevel}, floor ${game.questFloor ?? '?'})`
  );

  console.log(
    `constraints: budget ${budget} · cap ${cap} · ceiling CR ≤ ${fmtCR(ceiling)}` +
    ` · ladder [${ladder.map(fmtCR).join(', ')}]` +
    (isEliteRoom ? ' · ELITE PACK ROOM' : '') +
    (isBossRoom ? ' · FINAL BOSS ROOM' : '')
  );
  console.log(
    `runtime roster (dungeonMonsterIds ${themeKey}): ${rosterIds.length} ids ·` +
    ` CR multiset {${Object.entries(rosterCRs).map(([c, n]) => `${c}:${n}`).join(', ')}}`
  );

  if (slots.length) {
    console.log(
      `budget spent (generator slots): ${paid}/${budget}${paid < budget ? '  ⚠ under' : ''}` +
      ` · slots: ${slots.map(sp => fmtCost(sp.targetCR)).join(', ')}`
    );
  } else {
    console.log('budget spent (generator slots): none — room has no priced spawn slots');
  }

  /* What game.js actually asked spawnMonster for, per slot (captured live). */
  const live = (game._spawnDbg || []).filter(r => r.roomId === roomId);
  if (live.length) {
    console.log(
      'runtime spawn calls:' +
      live.map(r =>
        ` tcr ${fmtCR(r.tcr)}` +
        ` band ${r.band}` +
        (r.allowed != null ? ` pool ${r.allowed}ids` : ' pool ALL') +
        (r.role ? ` role ${r.role}` : '') +
        ` -> ${r.fieldedId}@${fmtCR(r.fieldedCR)}`
      ).join(' |')
    );
  }

  if (fielded.length) {
    console.log(`fielded ${fielded.length} · worth ${fieldedWorth}:`);
    /* The main spawn loop adds monsters in d.spawns order, so each non-elite/
       non-boss fielded monster maps 1:1 onto a priced slot. This exposes a
       slot priced at CR 1 being filled by a CR-1/8 creature. */
    const slotTCRs = slots.map(sp => sp.targetCR);
    let fi = 0;
    for (const m of fielded) {
      const cr = m.data?.cr;
      const over = cr > ceiling;
      const slot = (m.isElitePack || m.isBoss) ? null : slotTCRs[fi++];
      const marks = [
        slot != null ? `slot ${fmtCR(slot)}` : '',
        m.isElitePack ? 'elite-pack' : '',
        m.isBoss ? 'boss' : '',
        slot != null && cr < slot ? `↓ (${fmtCR(cr)} vs ${fmtCR(slot)})` : '',
        over ? `⚠ over ceiling (≤${fmtCR(ceiling)})` : ''
      ].filter(Boolean).join(' · ');
      console.log(
        `  ${String(m.data?.name || m.data?.id || '?').padEnd(24)} CR ${fmtCR(cr).padStart(4)}` +
        `  hp ${String(m.data?.hp ?? '?').padStart(3)}${marks ? '   [' + marks + ']' : ''}`
      );
    }
  } else {
    console.log('fielded: none');
  }

  console.groupEnd();
}
