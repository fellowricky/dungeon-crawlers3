/**
 * Unit card — what a hero or monster is, how it's doing, and what's on it.
 *
 *   Auto mode (and outside manual combat): click a creature to pin its card in
 *     a fixed spot above the combat log; click it again, its ×, or empty ground
 *     to put it away.
 *   Manual combat: rest the cursor on a creature for a moment and the card
 *     pops up beside it, off to the side so it never covers what you click.
 *
 * A monster shows its stat block only once its Bestiary entry is unlocked
 * (BESTIARY_UNLOCK kills): before that, a health bar with no numbers, its
 * effects, and how many more kills reveal the rest. That is the Bestiary's
 * mechanical payoff.
 *
 * unitCardData / unitCardHTML are DOM-free so vitest can drive them.
 */

import { EFFECTS, getEffectMods, ROUND_SECONDS } from './conditions.js';
import { BESTIARY_UNLOCK } from './constants.js';
import { CLASSES, RACES } from './srd.js';
import { iconHtml } from './icons.js';
import { visualOf } from './entities.js';

/* The selection outline (the sprite shader's uSprOutline, sprite_animator.js):
   white on the creature under the cursor, red on the one whose card is up. */
const OUTLINE_HOVER = [1, 1, 1];
const OUTLINE_SELECTED = [1, 0.025, 0.015];
const OUTLINE_TURN = [0.04, 1, 0.06];    // linear: a clear green after the sRGB output   // linear: lands as a true red after the sRGB output (0.24 read as pink)

const ABILS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const HOVER_MS = 250;          // manual mode: how long the cursor rests on a creature before its card shows
const REFRESH_MS = 250;        // live HP / effect refresh while a card is up

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const modOf = (score) => Math.floor(((score == null ? 10 : score) - 10) / 2);
const fmt = (n) => (n >= 0 ? '+' : '') + n;
const crText = (cr) => (cr == null ? '' : cr === 0.125 ? '1/8' : cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : String(cr));

export const isHeroUnit = (e) => !!(e && e.data && (e._side === 'hero' || e.data.classKey) && !e.isMonster && !e.data.isRival);

/** The creature's active effects, longest-lasting last, with rounds left on the combat clock. */
function effectsOf(game, e) {
  const fx = e._effects || (e.data && e.data._effects) || {};
  const now = (game && game.fxNow) || 0;
  const out = [];
  for (const [key, rec] of Object.entries(fx)) {
    const def = EFFECTS[key];
    if (!def || !rec) continue;
    const rounds = rec.until != null ? Math.max(0, Math.ceil((rec.until - now) / ROUND_SECONDS)) : null;
    if (rounds === 0) continue;
    out.push({ key, label: def.label || key, desc: def.desc || '', category: def.category || 'debuff', rounds, stacks: rec.stacks > 1 ? rec.stacks : 0 });
  }
  out.sort((a, b) => (a.category === b.category ? 0 : a.category === 'buff' ? -1 : 1) || (a.rounds ?? 99) - (b.rounds ?? 99));
  return out;
}

/** Everything the card shows, as plain data. */
export function unitCardData(game, e) {
  if (!e || !e.data) return null;
  const d = e.data, hero = isHeroUnit(e);
  const maxHp = Math.max(1, d.maxHp || d.hp || 1), hp = Math.max(0, d.hp || 0);
  const mods = getEffectMods(e) || {};
  const ac = hero && game && typeof game.heroAC === 'function'
    ? game.heroAC(e)
    : (d.ac || 10) + (mods.acBonus || 0) - (d._acPenalty || 0);
  const speedFt = game && typeof game.cellsForSpeed === 'function' ? game.cellsForSpeed(e) * 5 : (d.speedFt || 30);
  const stats = d.effStats || d.stats || {};
  const saves = d.saves || {};
  const abilities = ABILS.map((ab) => {
    const m = modOf(stats[ab]);
    const prof = saves[ab] != null;
    return { ab, mod: m, save: prof ? saves[ab] : m, prof };
  });
  const kills = !hero && game && game.bestiary && d.id ? (game.bestiary[d.id] || 0) : 0;
  const unlocked = hero || kills >= BESTIARY_UNLOCK;
  const sb = d.statblock || {};
  const sub = hero
    ? [RACES[d.raceKey] && RACES[d.raceKey].label, CLASSES[d.classKey] && CLASSES[d.classKey].label, `Lv ${d.level || 1}`].filter(Boolean).join(' · ')
    : [d.size, d.type, d.cr != null ? `CR ${crText(d.cr)}` : ''].filter(Boolean).join(' · ');
  return {
    hero, name: d.name, sub,
    hp, maxHp, tempHp: d.tempHp || 0, pct: hp / maxHp, bloodied: hp > 0 && hp <= maxHp / 2, down: hp <= 0,
    unlocked, kills, need: BESTIARY_UNLOCK,
    ac, speedFt, abilities,
    resist: sb.resist || [], immune: sb.immune || [], vulnerable: sb.vulnerable || [], condImmune: sb.condImmune || [],
    effects: effectsOf(game, e),
  };
}

function effectHTML(f) {
  const ico = iconHtml('status', f.key, '', { size: 20, cls: 'uc-fx-ico' });
  const left = f.rounds == null ? '' : `${f.rounds} rnd`;
  return `<div class="uc-fx ${f.category === 'buff' ? 'buff' : 'debuff'}" title="${esc(f.desc)}">
    ${ico || '<span class="uc-fx-dot"></span>'}<span class="uc-fx-name">${esc(f.label)}${f.stacks ? ` ×${f.stacks}` : ''}</span><span class="uc-fx-left">${left}</span></div>`;
}

const tagLine = (label, list, cls) => (list && list.length ? `<div class="uc-tags ${cls}"><span>${label}</span>${list.map((t) => `<i>${esc(t)}</i>`).join('')}</div>` : '');

export function unitCardHTML(c, { pinned = false } = {}) {
  if (!c) return '';
  const barCls = c.down ? 'down' : c.pct <= 0.25 ? 'low' : c.pct <= 0.5 ? 'mid' : 'ok';
  const hpText = c.unlocked
    ? `<b>${c.hp}</b> / ${c.maxHp}${c.tempHp ? ` <span class="uc-temp">+${c.tempHp}</span>` : ''}`
    : (c.down ? 'Down' : c.bloodied ? '<span class="uc-blood">Bloodied</span>' : '');
  const bar = `<div class="uc-hp"><div class="uc-bar ${barCls}"><i style="width:${Math.round(c.pct * 100)}%"></i>${c.tempHp ? `<em style="width:${Math.min(100, Math.round((c.tempHp / c.maxHp) * 100))}%"></em>` : ''}</div><div class="uc-hp-txt">${hpText}</div></div>`;
  let body;
  if (c.unlocked) {
    const head = `<div class="uc-keys"><div><span>AC</span><b>${c.ac}</b></div><div><span>Speed</span><b>${c.speedFt} ft</b></div></div>`;
    const grid = `<table class="uc-abil"><tr><th></th>${c.abilities.map((a) => `<th>${a.ab.toUpperCase()}</th>`).join('')}</tr>
      <tr class="uc-mod"><td class="uc-rowl">Mod</td>${c.abilities.map((a) => `<td>${fmt(a.mod)}</td>`).join('')}</tr>
      <tr class="uc-save"><td class="uc-rowl">Save</td>${c.abilities.map((a) => `<td class="${a.prof ? 'prof' : ''}" title="${a.prof ? 'Proficient save' : 'Save'}">${fmt(a.save)}</td>`).join('')}</tr></table>`;
    body = head + grid
      + tagLine('Resists', c.resist, 'res') + tagLine('Immune', c.immune, 'imm') + tagLine('Vulnerable', c.vulnerable, 'vul') + tagLine('Can’t be', c.condImmune, 'cimm');
  } else {
    body = `<div class="uc-locked">Bestiary <b>${Math.min(c.kills, c.need)}/${c.need}</b> kills to reveal stats</div>`;
  }
  const fx = c.effects.length ? `<div class="uc-fxs">${c.effects.map(effectHTML).join('')}</div>` : '<div class="uc-nofx">No active effects</div>';
  return `<div class="uc-head"><div><div class="uc-name ${c.hero ? 'hero' : 'foe'}">${esc(c.name)}</div><div class="uc-sub">${esc(c.sub)}</div></div>
      ${pinned ? '<button class="uc-close" title="Close">×</button>' : ''}</div>
    ${bar}${body}<div class="uc-sec">Effects</div>${fx}`;
}

/* ── the DOM controller ──────────────────────────────────────────────── */

let _g = null, _el = null, _mode = null, _ent = null, _timer = 0, _hoverPending = null, _hoverAt = null;
let _cursorEnt = null;            // the creature under the cursor, any mode
let _turnEnt = null;              // whoever's turn it is in combat (green)
let _turnMat = null;              // its body material when set (a wild shape swaps it)
const _outlined = new Set();      // materials currently outlined

function outlineMat(e) {
  const v = e && (visualOf(e) || e.ent || e);
  const mesh = v && v.anim && v.anim.mesh;
  const u = mesh && mesh.material && mesh.material.userData && mesh.material.userData.sprOutline;
  return u ? mesh.material : null;
}

/** Re-paint the outlines: green on whoever's turn it is, white on the one under the
 *  cursor, red on the carded creature; when they're the same creature red beats white
 *  beats green. */
function applyOutlines() {
  const want = new Map();
  if (_turnEnt && alive(_turnEnt)) {
    const m = outlineMat(_turnEnt);
    if (m) want.set(m, OUTLINE_TURN);
  }
  if (_cursorEnt && _cursorEnt !== _ent && alive(_cursorEnt)) {
    const m = outlineMat(_cursorEnt);
    if (m) want.set(m, OUTLINE_HOVER);
  }
  if (_ent && _el && _el.classList.contains('show')) {
    const m = outlineMat(_ent);
    if (m) want.set(m, OUTLINE_SELECTED);
  }
  for (const m of _outlined) if (!want.has(m)) { m.userData.sprOutline.value.w = 0; _outlined.delete(m); }
  for (const [m, c] of want) {
    m.userData.sprOutline.value.set(c[0], c[1], c[2], 1);
    _outlined.add(m);
  }
}

/** Whoever's turn it is in combat (null between fights): a green outline, in place of
 *  the old glow behind them. Called every frame from game.js updateTurnHighlights. */
export function setTurnUnit(ent) {
  if (_turnEnt === ent && (!ent || outlineMat(ent) === _turnMat)) return;
  _turnEnt = ent || null;
  _turnMat = ent ? outlineMat(ent) : null;   // a wild shape swaps the body: re-apply then
  applyOutlines();
}

/** The cursor is over `ent` (null: over nothing). Any mode: it gets the white outline. */
export function setCursorUnit(ent) {
  if (_cursorEnt === ent) return;
  _cursorEnt = ent || null;
  applyOutlines();
}

const CSS = `
#unit-card{position:fixed;z-index:46;display:none;width:300px;padding:10px 12px 11px;pointer-events:none;
  background:var(--px-panel-strong, rgba(7,8,10,0.97));border:2px solid #5a4a36;box-shadow:4px 4px 0 rgba(0,0,0,.6);
  font-size:18px;color:#b1b8bf;}
#unit-card.show{display:block;}
#unit-card.pinned{pointer-events:auto;border-color:#c8a35a;}
#unit-card .uc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;}
#unit-card .uc-name{font-size:22px;font-weight:700;line-height:1.1;}
#unit-card .uc-name.foe{color:#e8866a}#unit-card .uc-name.hero{color:#9cc4f0}
#unit-card .uc-sub{font-size:15px;color:#6d7a8a;text-transform:capitalize;margin-top:2px;}
#unit-card .uc-close{background:none;border:0;color:#c8a35a;font-size:24px;line-height:1;cursor:pointer;padding:0 2px;}
#unit-card .uc-hp{margin-top:8px;display:flex;align-items:center;gap:8px;}
#unit-card .uc-bar{position:relative;flex:1;height:10px;background:#1a1414;border:1px solid #000;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);}
#unit-card .uc-bar i{position:absolute;left:0;top:0;bottom:0;background:#5fbf5a;}
#unit-card .uc-bar.mid i{background:#d8b040}#unit-card .uc-bar.low i{background:#d0503a}#unit-card .uc-bar.down i{background:#444}
#unit-card .uc-bar em{position:absolute;right:0;top:0;bottom:0;background:rgba(156,196,240,.55);}
#unit-card .uc-hp-txt{font-size:17px;white-space:nowrap;min-width:60px;text-align:right;}
#unit-card .uc-hp-txt b{color:#e8ecef}#unit-card .uc-temp{color:#9cc4f0}#unit-card .uc-blood{color:#e06a5a}
#unit-card .uc-keys{display:flex;gap:18px;margin-top:8px;}
#unit-card .uc-keys span{color:#6d7a8a;font-size:15px;margin-right:6px;}
#unit-card .uc-keys b{color:#e8ecef;font-size:20px;}
#unit-card .uc-abil{width:100%;border-collapse:collapse;margin-top:6px;text-align:center;}
#unit-card .uc-abil th{font-size:12px;font-weight:normal;color:#6d7a8a;letter-spacing:.06em;}
#unit-card .uc-abil td{font-size:17px;padding:1px 0;color:#d4d8dc;}
#unit-card .uc-abil .uc-save td{font-size:14px;color:#6d7a8a;}
#unit-card .uc-abil .uc-save td.prof{color:#e8c25a;font-weight:700;}
#unit-card .uc-abil td.uc-rowl{font-size:12px;color:#6d7a8a;text-align:left;letter-spacing:.06em;text-transform:uppercase;}
#unit-card .uc-tags{display:flex;flex-wrap:wrap;gap:4px;align-items:baseline;margin-top:5px;font-size:15px;}
#unit-card .uc-tags span{color:#6d7a8a;margin-right:2px;}
#unit-card .uc-tags i{font-style:normal;padding:0 5px;border:1px solid currentColor;text-transform:capitalize;}
#unit-card .uc-tags.res i{color:#9cc4f0}#unit-card .uc-tags.imm i{color:#e8c25a}#unit-card .uc-tags.vul i{color:#e06a5a}#unit-card .uc-tags.cimm i{color:#b0a0d8}
#unit-card .uc-locked{margin-top:8px;font-size:16px;color:#8a7a5a;font-style:italic;}
#unit-card .uc-locked b{color:#c8a35a;font-style:normal;}
#unit-card .uc-sec{margin-top:9px;padding-top:6px;border-top:1px solid rgba(205,186,144,.14);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#616e7f;}
#unit-card .uc-fxs{display:flex;flex-direction:column;gap:2px;margin-top:4px;}
#unit-card .uc-fx{display:grid;grid-template-columns:22px 1fr auto;align-items:center;gap:6px;font-size:16px;}
#unit-card .uc-fx.buff .uc-fx-name{color:#7fe08a}#unit-card .uc-fx.debuff .uc-fx-name{color:#e88a6a}
#unit-card .uc-fx-left{color:#8a93a0;font-size:14px;}
#unit-card .uc-fx-ico{width:20px;height:20px;image-rendering:pixelated;}
#unit-card .uc-fx-dot{display:inline-block;width:10px;height:10px;margin:0 5px;background:currentColor;}
#unit-card .uc-nofx{margin-top:4px;font-size:15px;color:#4a5462;font-style:italic;}`;

export function initUnitCard(game) {
  _g = game;
  if (typeof document === 'undefined' || document.getElementById('unit-card')) return;
  _el = document.createElement('div');
  _el.id = 'unit-card';
  document.body.appendChild(_el);
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  _el.addEventListener('click', (ev) => { if (ev.target.closest('.uc-close')) unpinUnitCard(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && _mode === 'pin') unpinUnitCard(); });
}

const alive = (e) => e && e.data && (isHeroUnit(e) || (e.data.hp > 0 && !e.dead));

function render() {
  if (!_el || !_ent) return;
  if (!alive(_ent)) { hide(); return; }
  _el.innerHTML = unitCardHTML(unitCardData(_g, _ent), { pinned: _mode === 'pin' });
}

function place() {
  if (!_el) return;
  if (_mode === 'pin') {
    /* above the combat log, right edges aligned */
    const log = document.getElementById('logpanel');
    const r = log && log.getBoundingClientRect();
    const h = _el.offsetHeight || 260;
    if (r && r.width) {
      _el.style.left = `${Math.max(8, r.right - _el.offsetWidth)}px`;
      _el.style.top = `${Math.max(8, r.top - h - 10)}px`;
    } else {
      _el.style.left = `${Math.max(8, window.innerWidth - _el.offsetWidth - 16)}px`;
      _el.style.top = `${Math.max(8, window.innerHeight - h - 220)}px`;
    }
  } else if (_hoverAt) {
    /* beside the creature: to its right, or its left when that runs off screen */
    const w = _el.offsetWidth || 300, h = _el.offsetHeight || 260, gap = 46;
    let x = _hoverAt.x + gap;
    if (x + w > window.innerWidth - 8) x = _hoverAt.x - gap - w;
    const y = Math.min(window.innerHeight - h - 8, Math.max(8, _hoverAt.y - h / 2));
    _el.style.left = `${Math.max(8, x)}px`;
    _el.style.top = `${y}px`;
  }
}

function show(mode) {
  _mode = mode;
  _el.classList.toggle('pinned', mode === 'pin');
  render();
  _el.classList.add('show');
  place();
  applyOutlines();
  clearInterval(_timer);
  /* refresh keeps the outline on too: a wild shape or a death swaps the body sprite */
  _timer = setInterval(() => { render(); place(); applyOutlines(); }, REFRESH_MS);
}

function hide() {
  if (_el) _el.classList.remove('show', 'pinned');
  clearInterval(_timer);
  _timer = 0; _mode = null; _ent = null; _hoverAt = null;
  applyOutlines();
}

/** Auto mode: pin `ent`'s card above the combat log (clicking the same creature again puts it away). */
export function pinUnitCard(ent) {
  if (!_el || !ent) return;
  if (_hoverPending) clearTimeout(_hoverPending.id);
  _hoverPending = null;
  if (_mode === 'pin' && _ent === ent) { unpinUnitCard(); return; }
  _ent = ent;
  show('pin');
}

export function unpinUnitCard() {
  if (_mode === 'pin') hide();
}

export function isUnitCardPinned() { return _mode === 'pin'; }

/** Manual mode: the cursor is resting on `ent` (null: on nothing), whose screen position is (sx, sy).
 *  The card shows after HOVER_MS on the same creature, and follows it while shown. */
export function hoverUnitCard(ent, sx = 0, sy = 0) {
  if (!_el || _mode === 'pin') return;
  if (!ent) {
    if (_hoverPending) clearTimeout(_hoverPending.id);
    _hoverPending = null;
    if (_mode === 'hover') hide();
    return;
  }
  _hoverAt = { x: sx, y: sy };
  if (_mode === 'hover' && _ent === ent) { place(); return; }
  if (_mode === 'hover') hide();
  if (_hoverPending && _hoverPending.ent === ent) return;
  clearTimeout(_hoverPending && _hoverPending.id);
  const id = setTimeout(() => { _hoverPending = null; _ent = ent; _hoverAt = { x: sx, y: sy }; show('hover'); }, HOVER_MS);
  _hoverPending = { ent, id };
}

/** Level change: drop any card. */
export function clearUnitCard() {
  if (_hoverPending) clearTimeout(_hoverPending.id);
  _hoverPending = null;
  _cursorEnt = null;
  _turnEnt = null; _turnMat = null;
  hide();
  for (const m of _outlined) m.userData.sprOutline.value.w = 0;
  _outlined.clear();
}
