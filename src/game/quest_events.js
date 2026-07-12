/**
 * Quest events runtime — phase floors, pre-floor choices, temporary allies,
 * side objectives, puzzle gates and quest chains.
 *
 * All persistent state rides on game.activeQuest (saved whole) plus the
 * top-level game.questChains save field. Runtime-only state (floorPhase,
 * puzzleState, gems) is rebuilt per floor in resolveFloorPhase/placeGems.
 */
import * as THREE from 'three';
import { log, showBanner, buildPartyFrames, updatePartyFrames, updateResources } from './ui.js';
import { makeHero, recalc, grantXp } from './srd.js';
import { rollItem } from './items.js';
import { generateSequelQuest } from './quests.js';
import { fireChallenge } from './skills.js';
import {
  FLOOR_FLAVOR, PHASE_ANNOUNCE, PHASE_RESOLVED, PHASE_CHOICES, ALLY_PERSONAS,
  BOSS_INTEL_LINES, PUZZLE_WARDS, PUZZLE_TEXT, OBJECTIVE_COMPLETE,
  CHAIN_TEASE, CHAIN_EPILOGUE, GAUNTLET_SPOILS, MIDBOSS_SLAIN, BOSS_SLAIN
} from './quest_story.js';

let G = null;
const $ = id => document.getElementById(id);
const themed = (table, theme) => table[theme] || table.generic || [];
const sPick = (arr, n) => (arr && arr.length) ? arr[Math.abs(n | 0) % arr.length] : '';
const rPick = arr => (arr && arr.length) ? arr[Math.floor(Math.random() * arr.length)] : '';

function storyLog(text, kind = 'story') {
  if (!text) return;
  log(text, kind);
}

function personaOf(cand) {
  const pool = ALLY_PERSONAS[cand.kind] || ALLY_PERSONAS.merc;
  return pool[(cand.idx || 0) % pool.length];
}

/* ================================================================
   Boot: inject the quest tracker panel + pre-floor choice overlay
   ================================================================ */
export function initQuestEvents(game) {
  G = game;

  if (!$('questtracker')) {
    const qt = document.createElement('div');
    qt.id = 'questtracker';
    qt.style.display = 'none';
    document.body.appendChild(qt);
  }

  if (!$('floorchoicescreen')) {
    const ov = document.createElement('div');
    ov.id = 'floorchoicescreen';
    ov.innerHTML = `
      <div class="cs-frame fc-frame">
        <div class="cs-header">
          <div class="cs-tabs">
            <span style="color:#e8c25a; font-weight:700; font-size:14px; letter-spacing:1px;">🗺 THE WAY DOWN</span>
          </div>
        </div>
        <div class="cs-body" style="flex-direction:column; padding:18px 22px;">
          <div class="fc-title" id="fc-title"></div>
          <div class="fc-desc" id="fc-desc"></div>
          <div class="fc-buttons" id="fc-buttons"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
  }

  if (!$('quest-events-css')) {
    const style = document.createElement('style');
    style.id = 'quest-events-css';
    style.textContent = `
      .logline.story{ color:#e8d5a0; font-style:italic; }
      #questtracker{
        position:fixed; left:256px; top:12px; z-index:20; width:205px;
        background:rgba(10,12,18,0.78); border:1px solid rgba(232,194,90,0.25);
        border-radius:8px; padding:8px 10px; backdrop-filter:blur(3px);
        font-size:11px; line-height:1.5; color:#d8d2c0;
      }
      @media (max-width:640px){
        #questtracker{ left:196px; top:12px; width:130px; }
      }
      .qt-title{ font-weight:700; color:#e8c25a; font-size:12px; }
      .qt-chain{ display:inline-block; margin-right:6px; padding:0 5px; border:1px solid #e8a83f;
        border-radius:4px; color:#e8a83f; font-weight:800; }
      .qt-floor{ color:#8fd4e8; }
      .qt-phase{ color:#b98cf5; font-weight:600; }
      .qt-intel{ color:#8fd4e8; }
      .qt-obj{ color:#b8b4a8; }
      .qt-obj.done{ color:#7ae08a; }
      #floorchoicescreen{ position:fixed; inset:0; z-index:52; display:none;
        align-items:center; justify-content:center; background:rgba(4,6,10,0.72); }
      #floorchoicescreen.show{ display:flex; }
      .fc-frame{ width:min(560px, 92vw); }
      .fc-title{ font-size:20px; font-weight:800; letter-spacing:2px; color:#f0e8d0;
        text-align:center; margin-bottom:10px; }
      .fc-desc{ font-size:13px; color:#cfc8b4; font-style:italic; line-height:1.55;
        text-align:center; margin-bottom:16px; }
      .fc-buttons{ display:flex; gap:12px; justify-content:center; flex-wrap:wrap; }
      .fc-btn{ flex:1; min-width:200px; display:flex; flex-direction:column; gap:5px; padding:14px 16px;
        background:rgba(26,28,36,0.95); border:1px solid rgba(232,194,90,0.35); border-radius:10px;
        color:#e8e0cc; cursor:pointer; text-align:left;
        transition:transform .15s, border-color .15s, box-shadow .15s; }
      .fc-btn:hover{ transform:translateY(-2px); border-color:#e8c25a; box-shadow:0 6px 18px rgba(0,0,0,0.5); }
      .fc-btn.primary{ border-color:#e8a83f; box-shadow:0 0 12px rgba(232,168,63,0.25); }
      .fc-btn-label{ font-size:14px; font-weight:700; color:#e8c25a; }
      .fc-btn-sub{ font-size:11px; color:#a8a294; line-height:1.4; }
      .fc-count{ font-size:10px; color:#8fd4e8; }
      .quest-node.chain-quest .quest-node-pin{ border-color:#e8a83f; box-shadow:0 0 14px #e8a83f, 0 0 5px #fff; }
      .quest-node.chain-quest .quest-node-label{ border-color:rgba(232,168,63,0.7); color:#ffd9a0; }
      #wm-quest-extras{ margin-top:10px; font-size:12px; line-height:1.5; }
      .wm-chain-banner{ color:#e8a83f; font-weight:700; margin-bottom:6px; }
      .wm-rumor-head, .wm-obj-head{ color:#e8c25a; font-weight:700; margin-top:8px;
        font-size:11px; letter-spacing:1px; }
      .wm-rumor{ color:#b8a8d8; font-style:italic; }
      .wm-objective{ color:#b8c8a8; }
    `;
    document.head.appendChild(style);
  }
}

/* ================================================================
   Save-shape normalization (old saves predate phases/objectives)
   ================================================================ */
export function normalizeQuest(q) {
  if (!q) return q;
  if (!Array.isArray(q.phases)) q.phases = [];
  if (!Array.isArray(q.sideObjectives)) q.sideObjectives = [];
  if (q.chain === undefined) q.chain = null;
  if (q.bossIntel === undefined) q.bossIntel = false;
  if (!q.place) q.place = (q.name || '').split(' of ').pop() || 'the deep';
  return q;
}

/* ================================================================
   Per-floor phase state
   ================================================================ */
export function resolveFloorPhase(game) {
  const q = game.activeQuest;
  const phase = (q && Array.isArray(q.phases))
    ? (q.phases.find(p => p.floor === game.questFloor) || null)
    : null;
  game.floorPhase = phase;
  const puzzleActive = phase && phase.type === 'puzzle' && !phase.resolved;
  game.puzzleState = puzzleActive
    ? { round: 0, successes: 0, fails: 0, cycles: 0, solved: false, retryAt: 0 }
    : null;
  game.gems = [];
  game._intelLogged = false;
}

export function phaseNeedsChoice(phase) {
  return !!(phase && !phase.resolved && phase.choice === null
    && (phase.type === 'ambush' || phase.type === 'gauntlet' || phase.type === 'ally'));
}

/* ================================================================
   Pre-floor choice overlay (shown during state='transition', BEFORE
   the floor is forged — 30s timer auto-picks the bold option)
   ================================================================ */
export function offerFloorChoice(game, phase, done) {
  const ov = $('floorchoicescreen');
  const copy = PHASE_CHOICES[phase.type];
  if (!ov || !copy) { phase.choice = 'accept'; done(); return; }

  const KIND_ICON = { cleric: '✚', merc: '⚔', scout: '🏹' };
  let buttons;
  if (phase.type === 'ally') {
    const cands = (phase.data && phase.data.candidates) || [];
    if (!cands.length) { phase.choice = 'accept'; done(); return; }
    buttons = cands.map((cand, i) => {
      const p = personaOf(cand);
      return {
        icon: KIND_ICON[cand.kind] || '★', label: p.name, sub: p.blurb, primary: i === 0,
        apply() { phase.choice = 'accept'; phase.data.allyVariant = cand; }
      };
    });
  } else {
    buttons = [
      { label: copy.accept.label, sub: copy.accept.sub, primary: true, apply() { phase.choice = 'accept'; } },
      { label: copy.decline.label, sub: copy.decline.sub, primary: false, apply() { phase.choice = 'decline'; } }
    ];
  }

  ov.querySelector('#fc-title').textContent = copy.title;
  ov.querySelector('#fc-desc').textContent = copy.desc;
  const wrap = ov.querySelector('#fc-buttons');
  wrap.innerHTML = buttons.map((b, i) => `
    <button class="fc-btn ${b.primary ? 'primary' : ''}" data-i="${i}">
      <span class="fc-btn-label">${b.icon ? b.icon + ' ' : ''}${b.label}</span>
      <span class="fc-btn-sub">${b.sub || ''}</span>
      ${b.primary ? '<span class="fc-count" id="fc-count"></span>' : ''}
    </button>`).join('');
  ov.classList.add('show');

  let remaining = 30;
  let finished = false;
  const cd = ov.querySelector('#fc-count');
  if (cd) cd.textContent = `auto in ${remaining}s`;
  const timer = setInterval(() => {
    remaining--;
    if (cd) cd.textContent = `auto in ${remaining}s`;
    if (remaining <= 0) pick(buttons.findIndex(b => b.primary));
  }, 1000);

  const pick = i => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    ov.classList.remove('show');
    buttons[Math.max(0, i)].apply();
    game.saveGame();
    done();
  };
  wrap.querySelectorAll('.fc-btn').forEach(el =>
    el.addEventListener('click', () => pick(+el.dataset.i)));
}

/* ================================================================
   Ambush: elite-ify every spawn on an accepted ambush floor
   ================================================================ */
export function applyPhaseToSpawns(game, spec) {
  const p = game.floorPhase;
  if (!p || p.type !== 'ambush' || p.choice !== 'accept' || p.resolved) return spec;
  spec.maxHp = spec.hp = Math.round(spec.hp * 1.5);
  spec.atk += 2;
  spec.xp *= 2;
  spec.gold *= 2;
  spec.scale = (spec.scale || 1) * 1.12;
  spec._ambushElite = true;
  return spec;
}

/* ================================================================
   Floor-entry narration: atmosphere line + phase announcement.
   Foreshadow floors resolve here (reveal boss + grant intel);
   a scout ally reveals the whole map here.
   ================================================================ */
export function announceFloor(game) {
  const q = game.activeQuest;
  if (!q) return;

  const flavor = themed(FLOOR_FLAVOR, q.theme);
  const ratio = q.floors > 1 ? (game.questFloor - 1) / (q.floors - 1) : 1;
  const pool = ratio < 0.34 ? flavor.early
    : ratio < 0.72 ? flavor.mid
    : (q.bossIntel && flavor.lateIntel ? flavor.lateIntel : flavor.late);
  const line = sPick(pool, (q.seed || 0) + game.questFloor * 17)
    .replace(/\{boss\}/g, q.finalBossName || 'beast below');
  if (line) log(line, 'story');

  const p = game.floorPhase;
  if (p && !p.resolved) {
    if (p.type === 'ambush') {
      storyLog(rPick(p.choice === 'decline' ? PHASE_ANNOUNCE.ambushDeclined : PHASE_ANNOUNCE.ambush));
      if (p.choice === 'decline') p.resolved = true;
    } else if (p.type === 'gauntlet') {
      storyLog(rPick(p.choice === 'decline' ? PHASE_ANNOUNCE.gauntletDeclined : PHASE_ANNOUNCE.gauntlet));
      if (p.choice === 'decline') p.resolved = true;
    } else if (p.type === 'puzzle') {
      storyLog(rPick(PHASE_ANNOUNCE.puzzle));
      log(PUZZLE_TEXT.intro, 'sys');
    } else if (p.type === 'foreshadow') {
      storyLog(rPick(PHASE_ANNOUNCE.foreshadow));
      storyLog(rPick(BOSS_INTEL_LINES).replace(/\{boss\}/g, q.finalBossName || 'nameless thing'));
      q.bossIntel = true;
      log(`🔎 Boss intel gained: +2 to hit and +25% damage against ${q.finalBossName || 'the final boss'}.`, 'sys');
      p.resolved = true;
      game.saveGame();
    }
  }

  /* Scout ally: the whole floor unrolls */
  if (game.heroes.some(h => h.temp && h.allyKind === 'scout') && game.D) {
    for (let rid = 0; rid < game.D.rooms.length; rid++) game.visitRoom(rid, true);
    log(`🗺 The scout sketches the whole floor from memory — every corridor, every chamber.`, 'sys');
  }

  updateQuestTracker(game);
}

/* ================================================================
   Temporary allies
   ================================================================ */
const ALLY_KINDS = {
  cleric: { classKey: 'cleric', stats: { str: 12, dex: 8, con: 14, int: 8, wis: 15, cha: 10 } },
  merc: { classKey: 'fighter', stats: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 8 } },
  scout: { classKey: 'rogue', stats: { str: 8, dex: 15, con: 12, int: 10, wis: 14, cha: 8 } }
};

function allyVisual(race, gender) {
  const v = {
    gender: gender || 'male', head: '', skinColor: '#ffddcc', hair: 'messy1/adult',
    facialHair: 'none', hairColor: '#663311', eyeColor: '#000000',
    ears: 'none', horns: 'none', spriteScaleX: 1, spriteScaleY: 1
  };
  if (race === 'halforc') {
    v.head = 'orc/male'; v.skinColor = '#8fae7a'; v.hairColor = '#111111'; v.eyeColor = '#5a1010';
  } else if (race === 'dwarf') {
    v.skinColor = '#ffddbb'; v.hairColor = '#bbaa55'; v.facialHair = 'beard/medium';
    v.spriteScaleX = 1.15; v.spriteScaleY = 0.85;
  } else if (race === 'halfling') {
    v.skinColor = '#eeddbb'; v.hairColor = '#664422'; v.spriteScaleX = 0.82; v.spriteScaleY = 0.82;
  }
  return v;
}

/** Push the temp ally wrapper BEFORE onDungeon's hero-placement loop so it
 *  gets a mesh/position/cooldowns exactly like a real hero. */
export function spawnAlly(game) {
  const p = game.floorPhase;
  if (!p || p.type !== 'ally' || p.resolved) return;
  const cand = p.data && p.data.allyVariant;
  if (!cand) return;
  if (game.heroes.some(h => h.temp)) return;
  const persona = personaOf(cand);
  const kindDef = ALLY_KINDS[cand.kind] || ALLY_KINDS.merc;
  const data = makeHero(persona.name, persona.race, kindDef.classKey, kindDef.stats,
    allyVisual(persona.race, persona.gender));
  data.level = Math.max(1, game.effectiveLevel | 0);
  recalc(data);
  data.hp = data.maxHp;
  /* temp:true — excluded from saveGame, kill XP and quest-reward splits */
  game.heroes.push({ data, temp: true, persona, allyKind: cand.kind });
  storyLog(persona.join);
  buildPartyFrames(game.heroes.map(h => h.data));
}

export function dismissAlly(game) {
  const idx = game.heroes.findIndex(h => h.temp);
  if (idx < 0) return;
  const [ally] = game.heroes.splice(idx, 1);
  if (ally.ent && ally.ent.grp && ally.ent.grp.parent) ally.ent.grp.parent.remove(ally.ent.grp);
  if (ally.persona) storyLog(ally.persona.farewell);
  if (game.floorPhase && game.floorPhase.type === 'ally') game.floorPhase.resolved = true;
  buildPartyFrames(game.heroes.map(h => h.data));
}

/* ================================================================
   Side objectives
   ================================================================ */
function bumpObjective(game, kind, n = 1) {
  const q = game.activeQuest;
  if (!q) return;
  for (const so of q.sideObjectives || []) {
    if (so.done || so.kind !== kind) continue;
    so.have = Math.min(so.need, so.have + n);
    if (so.have >= so.need) grantSideObjectiveReward(game, so);
  }
  updateQuestTracker(game);
}

export function grantSideObjectiveReward(game, so) {
  if (so.done) return;
  so.done = true;
  storyLog(rPick(OBJECTIVE_COMPLETE[so.kind] || []));
  log(`🏅 Optional objective complete: ${so.label} — +${so.rewardGold}g, +${so.rewardXp} XP.`, 'treasure');
  game.gold += so.rewardGold;
  const real = game.heroes.filter(h => !h.temp);
  const each = Math.max(1, Math.round(so.rewardXp / Math.max(1, real.length)));
  const before = real.map(h => h.data.level);
  for (const h of real) grantXp(h.data, each, log);
  if (real.some((h, i) => h.data.level > before[i]) && game.announceLevelUp) game.announceLevelUp();
  updateResources(game);
  updatePartyFrames(game.heroes.map(h => h.data));
  game.saveGame();
}

/** Kill hook (from combat.killMonster): slay objectives, ally barks,
 *  and boss story lines. */
export function onKill(game, m, killer) {
  if (killer && killer.temp && killer.persona && !killer._barked) {
    killer._barked = true;
    storyLog(killer.persona.bark);
  }
  const q = game.activeQuest;
  if (!q) return;
  for (const so of q.sideObjectives || []) {
    if (so.done || so.kind !== 'slay') continue;
    if (so.targetIds && !so.targetIds.includes(m.data.id)) continue;
    so.have = Math.min(so.need, so.have + 1);
    if (so.have >= so.need) grantSideObjectiveReward(game, so);
  }
  if (m.isBoss) {
    const finalFloor = (game.questFloor | 0) >= (q.floors | 0);
    const bossN = m.data.name;
    if (finalFloor) {
      storyLog(rPick(themed(BOSS_SLAIN, q.theme))
        .replace(/\{boss\}/g, bossN)
        .replace(/\{place\}/g, q.place || 'this place'));
    } else {
      storyLog(rPick(MIDBOSS_SLAIN).replace(/\{boss\}/g, bossN));
    }
  }
  updateQuestTracker(game);
}

export function onChestLooted(game) {
  bumpObjective(game, 'chests', 1);
}

/* ---- gem pickups (collect-N objective) ---- */
export function placeGems(game) {
  game.gems = [];
  const q = game.activeQuest;
  if (!q || !game.D) return;
  const so = (q.sideObjectives || []).find(s => s.kind === 'gems' && !s.done);
  if (!so) return;
  const remaining = Math.max(0, so.need - so.have);
  if (!remaining) return;
  const count = Math.min(3, remaining);
  const d = game.D;
  const roomIds = [];
  for (let i = 0; i < d.rooms.length; i++) if (i !== d.entrance) roomIds.push(i);
  for (let i = roomIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roomIds[i], roomIds[j]] = [roomIds[j], roomIds[i]];
  }
  for (let k = 0; k < count && k < roomIds.length; k++) {
    const rid = roomIds[k];
    const a = game.roomAnchor[rid];
    const gx = a % d.W, gy = Math.floor(a / d.W);
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22),
      new THREE.MeshStandardMaterial({
        color: 0x7ae0ff, emissive: 0x2a70a0, emissiveIntensity: 0.9,
        metalness: 0.3, roughness: 0.2
      })
    );
    mesh.position.set(game.wx(gx), 0.55, game.wz(gy));
    mesh.visible = false;
    game.gameGroup.add(mesh);
    game.gems.push({ x: gx, y: gy, roomId: rid, taken: false, mesh });
  }
}

/** Called from explore.checkInteractables — proximity pickup + sparkle. */
export function checkGems(game, alive) {
  for (const g of game.gems || []) {
    if (g.taken) continue;
    g.mesh.visible = !!game.visitedRooms[g.roomId];
    if (g.mesh.visible) {
      g.mesh.rotation.y = game.elapsed * 1.6;
      g.mesh.position.y = 0.55 + Math.sin(game.elapsed * 2.5) * 0.08;
    }
    const gx = game.wx(g.x), gz = game.wz(g.y);
    if (alive.some(h => Math.hypot(h.x - gx, h.z - gz) < 1.5)) {
      g.taken = true;
      g.mesh.visible = false;
      log('💎 The party pockets an arcane gem.', 'treasure');
      bumpObjective(game, 'gems', 1);
    }
  }
}

/* ================================================================
   Puzzle floor — the boss room is sealed until 2 of 3 wards break.
   pickNextRoom (explore.js) skips the boss room while unsolved;
   this gate fires ward rounds once everything else is cleared.
   ================================================================ */
const WARD_APPROACHES = [
  [
    { tier: 'safe', skill: 'investigation', label: 'Trace the ward-script to its keystone',
      win: 'The keystone dims and the ward unravels.', lose: 'The script rearranges itself mid-reading.' },
    { tier: 'standard', skill: 'arcana', label: 'Unweave the binding lattice',
      win: 'The lattice comes apart thread by thread.', lose: 'The lattice snaps back and bites.', failEffect: 'damage' },
    { tier: 'risky', skill: 'athletics', label: 'Shatter the ward-stone outright',
      win: 'One tremendous blow and the ward-stone bursts.', lose: 'The stone drinks the blow and returns it.', failEffect: 'damage' }
  ],
  [
    { tier: 'safe', skill: 'religion', label: 'Recite the counter-litany',
      win: 'The old words still hold power — the ward bows.', lose: 'The litany falters on a forgotten verse.' },
    { tier: 'standard', skill: 'insight', label: "Find the rhythm in the ward's pulse",
      win: 'Between one pulse and the next, the ward stands open.', lose: 'The rhythm shifts — it was listening too.', failEffect: 'damage' },
    { tier: 'risky', skill: 'sleightOfHand', label: "Pick the seal's living lock",
      win: 'Fingers faster than magic — the lock clicks open.', lose: 'The lock bites down like a trap.', failEffect: 'damage' }
  ],
  [
    { tier: 'safe', skill: 'perception', label: "Watch for the ward's blind moment",
      win: "There — a flicker. The party slips the ward's gaze.", lose: 'The ward does not blink after all.' },
    { tier: 'standard', skill: 'arcana', label: "Ground the seal's stored power",
      win: 'The stored power drains harmlessly into the stone.', lose: 'The discharge arcs the wrong way.', failEffect: 'damage' },
    { tier: 'risky', skill: 'intimidation', label: "Command the seal in its maker's name",
      win: 'The seal, cowed, releases its grip.', lose: 'The seal answers defiance with fire.', failEffect: 'damage' }
  ]
];

export function checkPuzzleGate(game) {
  const ps = game.puzzleState;
  if (!ps || ps.solved) return;
  if (game.state !== 'crawl' || game.paused || game.combat || !game.D) return;
  if (ps.retryAt && game.elapsed < ps.retryAt) return;
  for (let i = 0; i < game.D.rooms.length; i++) {
    if (i === game.D.boss) continue;
    if (!game.roomDone(i)) return;
  }
  fireWardRound(game, ps);
}

function fireWardRound(game, ps) {
  const q = game.activeQuest;
  const wardNames = themed(PUZZLE_WARDS, q ? q.theme : 'generic');
  const round = ps.round % 3;
  const challenge = {
    name: wardNames[round % wardNames.length],
    type: 'puzzle',
    desc: `${PUZZLE_TEXT.roundDesc[round]} (Ward ${round + 1} of 3 — break 2 to shatter the seal. Broken: ${ps.successes} · Held: ${ps.fails})`,
    reward: { kind: 'gold', value: 20 + 8 * (game.activeQuest ? game.activeQuest.level : (game.dungeonLevel || 1)) },
    approaches: WARD_APPROACHES[round],
    onResolved(success) {
      ps.round++;
      if (success) ps.successes++; else ps.fails++;
      if (ps.successes >= 2) {
        ps.solved = true;
        if (ps.fails === 0) {
          storyLog(PUZZLE_TEXT.solvedFlawless);
          const it = rollItem((game.activeQuest ? game.activeQuest.level : (game.dungeonLevel || 1)) + 1);
          game.inventory.push(it);
          log(`  ↳ 💎 ${it.name} pried from the seal's wreckage!`, 'treasure');
        } else {
          storyLog(PUZZLE_TEXT.solved);
        }
        log('🚪 The boss chamber stands open.', 'sys');
        game.saveGame();
      } else if (ps.fails >= 2) {
        ps.cycles++;
        if (ps.cycles >= 3) {
          /* anti-softlock: sheer stubbornness always wins eventually */
          ps.solved = true;
          storyLog(PUZZLE_TEXT.forceOpen);
          log('🚪 The boss chamber stands open.', 'sys');
        } else {
          storyLog(PUZZLE_TEXT.cycleFail, 'down');
          for (const h of game.heroes) {
            if (h.data.hp <= 0) continue;
            const dmg = 1 + Math.floor(Math.random() * 6);
            h.data.hp = Math.max(1, h.data.hp - dmg);
          }
          log('  ↳ ⚡ The wards lash out — the party is scorched but standing.', 'down');
          ps.round = 0; ps.successes = 0; ps.fails = 0;
          ps.retryAt = game.elapsed + 8;
        }
      }
      updatePartyFrames(game.heroes.map(h => h.data));
      updateQuestTracker(game);
    }
  };
  fireChallenge(game, challenge);
}

/* ================================================================
   Floor cleared: phase aftermath + gauntlet spoils.
   Returns true when the merchant camp should be skipped (gauntlet).
   Must run BEFORE questFloor++ in finishDungeon.
   ================================================================ */
export function onFloorCleared(game) {
  const q = game.activeQuest;
  if (!q) return false;

  /* spoils promised by the previous floor's accepted gauntlet */
  if (q._gauntletSpoils) {
    q._gauntletSpoils = false;
    const gold = 75 * (game.activeQuest ? game.activeQuest.level : (game.dungeonLevel || 1));
    game.gold += gold;
    const it = rollItem((game.activeQuest ? game.activeQuest.level : (game.dungeonLevel || 1)) + 1, Math.random, null, { forceRarity: 'epic' });
    game.inventory.push(it);
    storyLog(rPick(GAUNTLET_SPOILS));
    log(`  ↳ 🪙 +${gold}g and ${it.name} from the gauntlet's cache!`, 'treasure');
  }

  const p = game.floorPhase;
  let skipShop = false;
  if (p && !p.resolved) {
    if (p.type === 'ambush' && p.choice === 'accept') {
      const gold = 50 * (game.dungeonLevel || 1);
      game.gold += gold;
      storyLog(rPick(PHASE_RESOLVED.ambush));
      log(`  ↳ 🪙 War-chest: +${gold}g.`, 'treasure');
    } else if (p.type === 'gauntlet' && p.choice === 'accept') {
      storyLog(rPick(PHASE_RESOLVED.gauntlet));
      q._gauntletSpoils = true;
      skipShop = true;
    } else if (p.type === 'puzzle') {
      storyLog(rPick(PHASE_RESOLVED.puzzle));
    }
    p.resolved = true;
  }

  updateResources(game);
  updateQuestTracker(game);
  return skipShop;
}

/* ================================================================
   Quest chains — 3-part sagas pinned to one map location
   ================================================================ */
export function onQuestCompleted(game, q) {
  if (!game.questChains) game.questChains = { active: [], log: [] };
  if (q.victoryText) storyLog(q.victoryText);

  const part = q.chain ? q.chain.part : 1;
  if (part >= 3) {
    game.questChains.active = game.questChains.active.filter(e => e.chainId !== q.chain.chainId);
    game.questChains.log.push({
      chainId: q.chain.chainId, arcTitle: q.chain.arcTitle,
      theme: q.theme, completedAt: Date.now()
    });
    storyLog(rPick(CHAIN_EPILOGUE).replace(/\{place\}/g, q.place || 'that place'));
    showBanner('SAGA COMPLETE', q.chain.arcTitle);
    return;
  }
  if (part === 1 && (q.floors || 1) < 3) return; /* trivial quests don't spawn sagas */

  const entry = {
    chainId: q.chain ? q.chain.chainId : 'ch_' + (q.seed || Math.floor(Math.random() * 888888)),
    part: part + 1,
    arcTitle: q.chain ? q.chain.arcTitle : q.name,
    place: q.place || (q.name || '').split(' of ').pop() || 'the deep',
    locType: q.locType || 'Depths',
    theme: q.theme,
    mapLocation: q.mapLocation,
    baseSeed: (q.chain && q.chain.baseSeed) || q.seed,
    level: q.level, floors: q.floors,
    unlockedAt: Date.now()
  };
  game.questChains.active = game.questChains.active.filter(e => e.chainId !== entry.chainId);
  game.questChains.active.push(entry);
  while (game.questChains.active.length > 2) game.questChains.active.shift();
  storyLog(rPick(CHAIN_TEASE[entry.part] || CHAIN_TEASE[2]).replace(/\{place\}/g, entry.place));
  log(`📜 A new chapter awaits on the world map: ${entry.arcTitle}.`, 'sys');
}

/** Stable sequel offers materialized from persisted chain entries. */
export function getSequelOffers(game, partyLevel) {
  const chains = (game.questChains && Array.isArray(game.questChains.active))
    ? game.questChains.active : [];
  return chains.slice(0, 2).map(e => {
    try { return generateSequelQuest(e, partyLevel); } catch (err) { return null; }
  }).filter(Boolean);
}

/* ================================================================
   Quest tracker HUD (above the game log)
   ================================================================ */
export function updateQuestTracker(game) {
  const el = $('questtracker');
  if (!el) return;
  const q = game.activeQuest;
  if (!q || game.state === 'worldmap') { el.style.display = 'none'; return; }
  el.style.display = 'block';

  const chainBadge = q.chain ? `<span class="qt-chain">${q.chain.part === 2 ? 'Ⅱ' : 'Ⅲ'}</span>` : '';
  let html = `<div class="qt-title">${chainBadge}${q.name}</div>
    <div class="qt-floor">Floor ${game.questFloor || 1} of ${q.floors}</div>`;

  const p = game.floorPhase;
  if (p && !p.resolved) {
    const labels = {
      ambush: p.choice === 'decline' ? '🌫 Ambush avoided' : '⚔ AMBUSH — all elites, spoils doubled',
      puzzle: (game.puzzleState && game.puzzleState.solved)
        ? '🔓 Seal broken — the boss chamber is open'
        : '🔒 A warded seal bars the boss chamber',
      ally: '🤝 A stranger walks with the party',
      gauntlet: p.choice === 'decline' ? '⛺ The slow road down' : '🔥 GAUNTLET — no camp after this floor',
      foreshadow: '🔎 A listening floor'
    };
    if (labels[p.type]) html += `<div class="qt-phase">${labels[p.type]}</div>`;
  }
  if (q.bossIntel) html += `<div class="qt-intel">🔎 Boss intel: ${q.finalBossName || 'the deep one'}</div>`;
  for (const so of q.sideObjectives || []) {
    html += so.done
      ? `<div class="qt-obj done">✓ ${so.label} — claimed!</div>`
      : `<div class="qt-obj">◈ ${so.label} (${so.have}/${so.need})</div>`;
  }
  el.innerHTML = html;
}
