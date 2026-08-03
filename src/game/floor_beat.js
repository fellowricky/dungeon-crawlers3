/**
 * End-of-floor story beats — a branching, voiced dialogue interlude that fires
 * the moment a non-boss floor is swept, and hands off into a skill challenge.
 *
 * This is the narrative centrepiece between floors: the party pauses at the
 * cleared floor, a short scene plays (art banner + voiced branching text), and
 * the terminal choice launches a skill check (the existing challenge vignette).
 *
 * Data lives on the mission as `floorBeats[floorNumber]` (see story.js). The
 * overlay reuses the briefing frame's CSS (.sb-*) under its own #floor-beat id.
 *
 *   beat = {
 *     art, speaker,                       // banner image + speaker label
 *     start: 'root',
 *     nodes: { id: { text, effect?, choices: [ { label, next? } ] } },
 *     challenge: { … }                    // launched when a node has no choices
 *   }
 *
 * Voice ids are composed as `${mission.id}_fb${floor}_${nodeId}` for dialogue
 * nodes (extract_story.mjs mirrors this); the challenge voices itself off its
 * own name-slug, same as every other story challenge.
 *
 * Pausing contract: showFloorBeat pauses the game. If the scene ends in a
 * challenge, the overlay hands the pause straight to fireChallenge (which
 * unpauses on resolve). A challenge-less scene unpauses itself on close.
 */
import { log, updateResources } from './ui.js';
import { playNarration, stopNarration } from './audio.js';

let root = null;
let G = null;
let beat = null;
let voiceBase = null;      // `${mission.id}_fb${floor}`
let flags = null;
let appliedNodes = null;
let playedVoiceNodes = null;
let launchChallengeCb = null;
let onDoneCb = null;

function ensureDom() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'floor-beat';
  root.innerHTML = `
    <div class="sb-frame">
      <div class="sb-header">
        <div class="sb-mission" id="fb-place"></div>
        <button class="sb-close" id="fb-skip" title="Skip ahead">Skip ▸</button>
      </div>
      <div class="sb-art" id="fb-art"></div>
      <div class="sb-speaker" id="fb-speaker"></div>
      <div class="sb-text" id="fb-text"></div>
      <div class="sb-note" id="fb-note"></div>
      <div class="sb-choices" id="fb-choices"></div>
    </div>`;
  document.body.appendChild(root);
  root.querySelector('#fb-skip').addEventListener('click', finish);
}

/** Close the dialogue overlay. If the beat carries a challenge, hand the
 *  (still-paused) game straight to it; otherwise resume the crawl. */
function finish() {
  stopNarration();
  if (root) root.classList.remove('show');
  const ch = beat && beat.challenge;
  const cb = launchChallengeCb;
  beat = null;
  if (ch && cb) {
    cb(ch);                      // challenge owns the pause from here
  } else {
    if (G) G.setPaused(false);
  }
  if (onDoneCb) { const d = onDoneCb; onDoneCb = null; d(); }
}

function applyNodeEffect(nodeId, node) {
  if (!node.effect || appliedNodes.has(nodeId)) return '';
  appliedNodes.add(nodeId);
  const fx = node.effect;
  const notes = [];
  if (fx.gold) { G.gold += fx.gold; notes.push(`🪙 +${fx.gold} gold`); }
  if (fx.potion) {
    G.potions[fx.potion] = (G.potions[fx.potion] || 0) + 1;
    const names = { heal: 'Healing Potion', greater: 'Greater Healing Potion', superior: 'Superior Healing Potion' };
    notes.push(`🧪 ${names[fx.potion] || 'Potion'} received`);
  }
  if (fx.flag) { flags[fx.flag] = true; notes.push('📜 Noted for the road ahead'); }
  if (notes.length) {
    if (typeof G.notifyLootFeedback === 'function') {
      G.notifyLootFeedback({ gold: fx.gold, potion: fx.potion });
    }
    updateResources(G); log(notes.join(' · '), 'treasure');
  }
  return notes.join(' · ');
}

function renderNode(nodeId) {
  const node = beat.nodes[nodeId];
  if (!node) { finish(); return; }

  const artEl = root.querySelector('#fb-art');
  const artSrc = node.art || beat.art || '';
  artEl.style.backgroundImage = artSrc ? `url("${artSrc}")` : '';
  artEl.classList.toggle('show', !!artSrc);

  root.querySelector('#fb-speaker').textContent = node.speaker || beat.speaker || '';
  root.querySelector('#fb-text').textContent = node.text || '';
  root.querySelector('#fb-note').textContent = applyNodeEffect(nodeId, node);

  /* voiced line for this node; missing audio just stays silent */
  if (voiceBase) {
    const voiceKey = `${voiceBase}_${nodeId}`;
    if (!playedVoiceNodes || !playedVoiceNodes.has(voiceKey)) {
      if (playedVoiceNodes) playedVoiceNodes.add(voiceKey);
      playNarration(voiceKey);
    } else {
      stopNarration();
    }
  }

  const box = root.querySelector('#fb-choices');
  box.innerHTML = '';
  const choices = node.choices || [];

  /* A node with no onward choices is terminal: its button ends the scene
     (and launches the challenge, if any). */
  if (!choices.length) {
    const btn = document.createElement('button');
    btn.className = 'sb-choice sb-setout';
    btn.textContent = beat.challenge ? (node.go || 'Look closer…') : (node.go || 'Move on');
    btn.addEventListener('click', finish);
    box.appendChild(btn);
    return;
  }

  for (const choice of choices) {
    const btn = document.createElement('button');
    btn.className = 'sb-choice';
    btn.textContent = choice.label;
    btn.addEventListener('click', () => renderNode(choice.next));
    box.appendChild(btn);
  }
}

/**
 * Show the floor beat. `opts.launchChallenge(challenge)` is invoked (with the
 * game left paused) if the scene ends in a challenge; `opts.onDone()` fires
 * once the dialogue portion closes either way.
 */
export function showFloorBeat(game, theBeat, { voiceBase: vb, launchChallenge, onDone } = {}) {
  if (!theBeat || !theBeat.nodes) { if (onDone) onDone(); return; }
  stopNarration();
  ensureDom();
  G = game;
  beat = theBeat;
  voiceBase = vb || null;
  flags = {};
  appliedNodes = new Set();
  playedVoiceNodes = new Set();
  launchChallengeCb = launchChallenge || null;
  onDoneCb = onDone || null;

  root.querySelector('#fb-place').textContent = theBeat.place || 'The floor is swept';
  game.setPaused(true);
  root.classList.add('show');
  renderNode(theBeat.start || 'root');
}
