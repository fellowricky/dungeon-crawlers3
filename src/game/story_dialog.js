/**
 * Story mission briefing — a branching-dialogue overlay shown between
 * selecting a story mission and forging its map.
 *
 * Data-driven from mission.briefing (see story.js):
 *   { speaker, start, nodes: { id: { text, effect?, choices: [
 *       { label, next?, setOut? } ] } } }
 *
 * Node effects apply once per briefing showing, the moment the node is
 * entered: { gold: N } | { potion: 'heal'|'greater'|'superior' } |
 * { flag: 'name' }. Flags are collected and handed to onBegin(flags) so the
 * caller can stamp them onto the quest (quest.storyFlags).
 */
import { log, updateResources } from './ui.js';
import { playNarration, stopNarration } from './audio.js';

let root = null;
let G = null;
let briefing = null;
let missionId = null;
let flags = null;
let appliedNodes = null;
let playedVoiceNodes = null;
let onBeginCb = null;
let onCancelCb = null;

function ensureDom() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'story-briefing';
  root.innerHTML = `
    <div class="sb-frame">
      <div class="sb-header">
        <div class="sb-mission" id="sb-mission"></div>
        <button class="sb-close" id="sb-close" title="Back to the map">✕</button>
      </div>
      <div class="sb-art" id="sb-art"></div>
      <div class="sb-speaker" id="sb-speaker"></div>
      <div class="sb-text" id="sb-text"></div>
      <div class="sb-note" id="sb-note"></div>
      <div class="sb-choices" id="sb-choices"></div>
    </div>`;
  document.body.appendChild(root);
  root.querySelector('#sb-close').addEventListener('click', () => {
    hide();
    if (onCancelCb) onCancelCb();
  });
}

function hide() {
  stopNarration();
  if (root) root.classList.remove('show');
  briefing = null;
}

function applyNodeEffect(nodeId, node) {
  if (!node.effect || appliedNodes.has(nodeId)) return '';
  appliedNodes.add(nodeId);
  const fx = node.effect;
  const notes = [];
  if (fx.gold) {
    G.gold += fx.gold;
    notes.push(`🪙 +${fx.gold} gold`);
  }
  if (fx.potion) {
    G.potions[fx.potion] = (G.potions[fx.potion] || 0) + 1;
    const names = { heal: 'Healing Potion', greater: 'Greater Healing Potion', superior: 'Superior Healing Potion' };
    notes.push(`🧪 ${names[fx.potion] || 'Potion'} received`);
  }
  if (fx.flag) {
    flags[fx.flag] = true;
    notes.push('📜 Noted for the road ahead');
  }
  if (notes.length) {
    updateResources(G);
    log(notes.join(' · '), 'treasure');
  }
  return notes.join(' · ');
}

function renderNode(nodeId) {
  const node = briefing.nodes[nodeId];
  if (!node) { hide(); if (onCancelCb) onCancelCb(); return; }

  /* Chapter splash art: mission-wide by default, overridable per node. */
  const artEl = root.querySelector('#sb-art');
  const artSrc = node.art || briefing.art || '';
  artEl.style.backgroundImage = artSrc ? `url("${artSrc}")` : '';
  artEl.classList.toggle('show', !!artSrc);

  root.querySelector('#sb-speaker').textContent = briefing.speaker || '';
  root.querySelector('#sb-text').textContent = node.text || '';
  root.querySelector('#sb-note').textContent = applyNodeEffect(nodeId, node);

  /* prerecorded voice line for this node (play once per briefing session; missing = silent) */
  if (missionId) {
    const voiceKey = `${missionId}_brief_${nodeId}`;
    if (!playedVoiceNodes || !playedVoiceNodes.has(voiceKey)) {
      if (playedVoiceNodes) playedVoiceNodes.add(voiceKey);
      playNarration(voiceKey);
    } else {
      stopNarration();
    }
  }

  const box = root.querySelector('#sb-choices');
  box.innerHTML = '';
  for (const choice of node.choices || []) {
    const btn = document.createElement('button');
    btn.className = 'sb-choice' + (choice.setOut ? ' sb-setout' : '');
    btn.textContent = choice.label;
    btn.addEventListener('click', () => {
      if (choice.setOut) {
        const outFlags = flags;
        hide();
        if (onBeginCb) onBeginCb(outFlags);
      } else {
        renderNode(choice.next);
      }
    });
    box.appendChild(btn);
  }
}

/** Show the briefing for a mission. onBegin(flags) fires on a set-out choice;
 *  onCancel fires if the player backs out to the world map. */
export function showBriefing(game, mission, { onBegin, onCancel } = {}) {
  if (!mission.briefing) { if (onBegin) onBegin({}); return; }
  stopNarration();
  ensureDom();
  G = game;
  briefing = mission.briefing;
  missionId = mission.id || null;
  flags = {};
  appliedNodes = new Set();
  playedVoiceNodes = new Set();
  onBeginCb = onBegin || null;
  onCancelCb = onCancel || null;
  root.querySelector('#sb-mission').textContent = `Chapter ${mission.chapter} — ${mission.name}`;
  root.classList.add('show');
  renderNode(briefing.start);
}
