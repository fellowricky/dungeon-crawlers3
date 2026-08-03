/**
 * Modular summon / companion system.
 *
 * Any class ability, spell, or passive can spawn a persistent, hero-like
 * companion through a single API:
 *
 *     game.summons.spawn(summoner, 'wolf')
 *
 * Companions live inside `game.heroes` (the same array as real heroes), so they
 * inherit rendering, follow-AI, initiative, combat, monster-targeting and party
 * frames for free. A `companion:true` flag distinguishes them from:
 *   - real heroes (companions are excluded from XP / loot / leadership / save /
 *     run-stats / party-size caps), and
 *   - `temp:true` quest allies (the dedicated slot lets a companion coexist with
 *     one temp ally — e.g. a Beastmaster wolf AND a summoned guard at once).
 *
 * Per-companion behaviour is data-driven via the COMPANIONS registry, so adding
 * a new summon type (a Necromancer skeleton, a Druid fey, an elemental…) is one
 * registry entry + one spawn() call — no new plumbing anywhere else.
 */
import { makeHeroMesh, drawBar } from './entities.js';
import { buildPartyFrames } from './ui.js';
import { createWolfCompanion, createFamiliarCompanion } from './srd.js';

/**
 * Registry of summonable companion types.
 *   factory(level)   -> a fresh hero-data record (already recalced)
 *   lifetime         : 'run' (persists across floors + save) | 'floor' | 'combat'
 *   deathPolicy      : 'reviveOnShortRest' | 'gone' | 'reviveOnResummon'
 *   slot             : 'dedicated' (per summoner — coexists with temp allies)
 *   maxPerSummoner   : cap per individual summoner (for the 'dedicated' slot)
 *   scaleWith        : 'summonerLevel' keeps the companion's stats in step as
 *                      its master levels up
 */
export const COMPANIONS = {
  wolf: {
    label: 'Wolf Companion',
    kind: 'wolf',
    factory: (level) => createWolfCompanion(level),
    icon: '🐺',                        // shown in the owner's party-frame badge
    lifetime: 'run',
    deathPolicy: 'reviveOnShortRest',
    slot: 'dedicated',
    maxPerSummoner: 1,
    scaleWith: 'summonerLevel'
  },
  owlFamiliar: {
    label: 'Owl Familiar',
    kind: 'owlFamiliar',
    factory: (level) => createFamiliarCompanion('owl', level),
    icon: '🦉',
    lifetime: 'run',
    deathPolicy: 'reviveOnResummon',
    slot: 'dedicated',
    maxPerSummoner: 1,
    scaleWith: 'summonerLevel'
  },
  impFamiliar: {
    label: 'Imp Familiar',
    kind: 'impFamiliar',
    factory: (level) => createFamiliarCompanion('imp', level),
    icon: '👿',
    lifetime: 'run',
    deathPolicy: 'reviveOnResummon',
    slot: 'dedicated',
    maxPerSummoner: 1,
    scaleWith: 'summonerLevel'
  },
  viperFamiliar: {
    label: 'Viper Familiar',
    kind: 'viperFamiliar',
    factory: (level) => createFamiliarCompanion('viper', level),
    icon: '🐍',
    lifetime: 'run',
    deathPolicy: 'reviveOnResummon',
    slot: 'dedicated',
    maxPerSummoner: 1,
    scaleWith: 'summonerLevel'
  }
};

/** Build the summon manager bound to a game instance. Attached as `game.summons`. */
export function createSummonManager(game) {
  let nextId = 1;

  function refreshFrames() {
    buildPartyFrames(game.heroes.map(h => h.data));
  }

  /** Resolve the summoner hero wrapper for a companion. Linked by name + class
   *  key, which survive roster reshuffles in town — array indices do not. */
  function findSummoner(c) {
    return game.heroes.find(h =>
      !h.companion && !h.temp &&
      h.data.name === c.summonerName &&
      h.data.classKey === c.summonerClassKey);
  }

  function summonerLevelOf(c) {
    const s = findSummoner(c);
    return s ? s.data.level : (game.effectiveLevel || 1);
  }

  /** The active companion of `kind` belonging to `summoner`, or null. */
  function getActive(kind, summoner) {
    if (!summoner) return null;
    return game.heroes.find(h =>
      h.companion && h.kind === kind &&
      h.summonerName === summoner.data.name &&
      h.summonerClassKey === summoner.data.classKey) || null;
  }

  /** Compact companion summary for a hero's party-frame badge, or null if the
   *  hero has no companion. Drives the small circular indicator inside the
   *  owner's UI (icon + HP-coloured ring). */
  function summaryFor(heroData) {
    if (!heroData) return null;
    const c = game.heroes.find(h =>
      h.companion &&
      h.summonerName === heroData.name &&
      h.summonerClassKey === heroData.classKey);
    if (!c) return null;
    const def = COMPANIONS[c.kind];
    return {
      icon: (def && def.icon) || '🐾',
      label: (def && def.label) || 'Companion',
      hp: c.data.hp,
      maxHp: c.data.maxHp,
      down: c.data.hp <= 0
    };
  }

  /** Spawn a new companion for `summoner` if the slot policy allows it.
   *  Returns the wrapper, or null if blocked (already at maxPerSummoner). */
  function spawn(summoner, kind) {
    const def = COMPANIONS[kind];
    if (!def || !summoner) return null;
    if (def.slot === 'dedicated' && getActive(kind, summoner)) return null;

    const lvl = summoner.data.level || (game.effectiveLevel || 1);
    const data = def.factory(lvl);
    data.companion = true;              // so party-frame UI can filter it out
    const w = {
      data,
      companion: true,
      _side: 'hero',
      kind,
      summonerName: summoner.data.name,
      summonerClassKey: summoner.data.classKey,
      summonerLevel: lvl,
      id: nextId++,
      x: summoner.x !== undefined ? summoner.x : game.wx(0),
      z: summoner.z !== undefined ? summoner.z : game.wz(0),
      ent: null,
      path: null, pathI: 0, cd: Math.random(), repathT: 0,
      target: null, walkPhase: Math.random() * 6
    };
    w.ent = makeHeroMesh(data);
    w.ent.grp.position.set(w.x, 0, w.z);
    game.gameGroup.add(w.ent.grp);
    drawBar(w.ent.bar, Math.max(0, data.hp / data.maxHp));
    game.heroes.push(w);

    /* Mid-combat summon: join the initiative order so the companion can act
       this fight (combat.js gates every hero on isCurrentActor). */
    if (game.initiative && game.initiative.active && typeof game._insertActor === 'function') {
      game._insertActor(w);
    }

    refreshFrames();
    return w;
  }

  function dismiss(c) {
    const idx = game.heroes.indexOf(c);
    if (idx < 0) return;
    game.heroes.splice(idx, 1);
    if (c.ent && c.ent.grp && c.ent.grp.parent) c.ent.grp.parent.remove(c.ent.grp);
    refreshFrames();
  }

  /** Reset the downed sprite (forward lean + sunk mesh + death-anim flags) so a
   *  revived companion stands back up. Mirrors combat._reviveHeroPose. */
  function revivePose(c) {
    if (!c.ent) return;
    c.ent.grp.rotation.z = 0;
    c.ent.grp.rotation.x = 0;
    c.ent.anim.mesh.position.y = 0;
    c._dyingStarted = false;
    c._deathLean = 0;
    c.ent.anim._dying = false;
    c.ent.anim._deathDone = false;
    c.ent.anim.play('walk');
  }

  /** Revive a downed companion of `kind` for `summoner` to `hpPct` of maxHp.
   *  No-op (returns null) if there is none or it is already alive. */
  function revive(kind, summoner, hpPct = 1) {
    const c = getActive(kind, summoner);
    if (!c || c.data.hp > 0) return null;
    c.data.hp = Math.max(1, Math.round(c.data.maxHp * hpPct));
    revivePose(c);
    if (c.ent && c.ent.bar) drawBar(c.ent.bar, c.data.hp / c.data.maxHp);
    refreshFrames();
    return c;
  }

  /** Rescale a companion in-place to match its summoner's current level.
   *  Preserves the HP ratio when alive; leaves a downed companion downed. */
  function rescale(c) {
    const def = COMPANIONS[c.kind];
    if (!def || def.scaleWith !== 'summonerLevel') return;
    const newLevel = summonerLevelOf(c);
    if (newLevel === c.summonerLevel) return;
    const wasAlive = c.data.hp > 0;
    const ratio = wasAlive ? c.data.hp / c.data.maxHp : 0;
    const fresh = def.factory(newLevel);
    Object.assign(c.data, fresh);          // adopt recalced level-scaled stats
    c.summonerLevel = newLevel;
    c.data.hp = wasAlive
      ? Math.max(1, Math.round(c.data.maxHp * ratio))
      : Math.min(c.data.hp, 0);            // stay downed
    if (c.ent && c.ent.bar) drawBar(c.ent.bar, Math.max(0, c.data.hp / c.data.maxHp));
  }

  /** Catch up any companion whose summoner has leveled since it was spawned. */
  function syncScales() {
    for (const h of game.heroes) if (h.companion) rescale(h);
  }

  /** Short rest: revive downed companions whose policy allows it (to 50% HP),
   *  and rescale the rest. */
  function onShortRest() {
    for (const c of game.heroes) {
      if (!c.companion) continue;
      const def = COMPANIONS[c.kind];
      if (c.data.hp <= 0 && def.deathPolicy === 'reviveOnShortRest') {
        c.data.hp = Math.max(1, Math.round(c.data.maxHp * 0.5));
        revivePose(c);
      } else {
        rescale(c);
      }
      if (c.ent && c.ent.bar) drawBar(c.ent.bar, Math.max(0, c.data.hp / c.data.maxHp));
    }
    refreshFrames();
  }

  /** Long rest (floor clear): full heal + rescale, reviving the downed. */
  function onLongRest() {
    for (const c of game.heroes) {
      if (!c.companion) continue;
      rescale(c);
      if (c.data.hp <= 0) revivePose(c);
      c.data.hp = c.data.maxHp;
      if (c.ent && c.ent.bar) drawBar(c.ent.bar, 1);
    }
    refreshFrames();
  }

  /** Called when a new floor loads. Run-persistent companions are re-wrapped by
   *  the floor-load loop; floor/combat-lifetime ones (and orphans whose summoner
   *  has left the party) are dismissed. */
  function onFloorEnter() {
    for (const h of [...game.heroes]) {
      if (!h.companion) continue;
      const def = COMPANIONS[h.kind];
      if (!def || !findSummoner(h) || def.lifetime !== 'run') dismiss(h);
    }
  }

  /** Snapshot run-persistent companions for the save file. */
  function serialize() {
    const out = [];
    for (const h of game.heroes) {
      if (!h.companion) continue;
      const def = COMPANIONS[h.kind];
      if (!def || def.lifetime !== 'run') continue;   // don't persist floor/combat
      if (!findSummoner(h)) continue;                 // don't persist orphans
      out.push({
        kind: h.kind,
        summonerName: h.summonerName,
        summonerClassKey: h.summonerClassKey,
        summonerLevel: h.summonerLevel,
        data: h.data
      });
    }
    return out;
  }

  /** Re-inject saved companions after the party is rebuilt on load. Wrappers are
   *  added WITHOUT meshes; the floor-load loop creates them like it does for
   *  every other hero. */
  function restore(saved) {
    if (!Array.isArray(saved)) return;
    let added = false;
    for (const entry of saved) {
      if (!COMPANIONS[entry.kind]) continue;
      const summoner = game.heroes.find(h =>
        !h.companion && !h.temp &&
        h.data.name === entry.summonerName &&
        h.data.classKey === entry.summonerClassKey);
      if (!summoner) continue;                        // summoner no longer present
      entry.data.companion = true;     // so party-frame UI can filter it out
      /* Re-stamp the visual from the current factory so a companion saved
         under an older asset (e.g. the broken wolfsheet1 atlas) always loads
         with the artwork the factory produces now. */
      const lvl = entry.summonerLevel || summoner.data.level;
      const fresh = COMPANIONS[entry.kind].factory(lvl);
      if (fresh && fresh.visual) entry.data.visual = fresh.visual;
      game.heroes.push({
        data: entry.data,
        companion: true,
        _side: 'hero',
        kind: entry.kind,
        summonerName: entry.summonerName,
        summonerClassKey: entry.summonerClassKey,
        summonerLevel: entry.summonerLevel || summoner.data.level,
        id: nextId++,
        x: 0, z: 0, ent: null,
        path: null, pathI: 0, cd: Math.random(), repathT: 0,
        target: null, walkPhase: Math.random() * 6
      });
      added = true;
    }
    if (added) refreshFrames();
  }

  return {
    COMPANIONS,
    spawn, dismiss, revive, getActive, summaryFor,
    onShortRest, onLongRest, onFloorEnter, syncScales,
    serialize, restore
  };
}
