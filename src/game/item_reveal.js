import { RARITIES, TIER } from './items.js';
import { playSfx } from './audio.js';
import { createFanfare } from '../render/loot_fanfare.js';
import { iconHtml } from './icons.js';
import { itemCardHTML } from './menus.js';
import { playScreenFx, clearScreenFx } from '../render/screen_fx.js';
import * as victoryFx from '../vendor/pixelfx/fx/ui/victory.js';

/* A fight's end isn't announced the instant the last blow lands: a beat for the
   blow and the death to read, then VICTORY! (pixelfx ui/victory, the level-up
   lettering) plays out whole and fades, and only then, after a short beat, the
   report. Anything else that wants the screen after a fight (skill challenges,
   the floor clear) waits on isRevealBusy() until the report is closed. */
const VICTORY_DELAY_MS = 450;
const REPORT_AFTER_POP_MS = Math.round((victoryFx.meta.duration + 0.25) * 1000);

/** True from a fight's end until its report (and any queued reveal) is closed. */
export function isRevealBusy() {
  return _pendingFight.length > 0 || _showing || _queue.length > 0;
}
let _pendingFight = [];   // timers between a fight's end and its report

/* The report's stat icons (public/art/icons), each with a text fallback for
   before the icon manifest has loaded. */
const STAT = {
  dealt: { icon: ['ability', 'sacredWeapon'], label: 'Dealt', alt: 'DMG' },
  taken: { icon: ['status', 'shielded'], label: 'Taken', alt: 'TKN' },
  healed: { icon: ['reward', 'heal'], label: 'Healed', alt: '+HP' },
  kills: { icon: ['damage', 'necrotic'], label: 'Kills', alt: 'KO' },
  gold: { icon: ['reward', 'gold'], label: 'gold', alt: 'g' },
  xp: { icon: ['reward', 'xp'], label: 'XP each', alt: 'XP' },
};
const statIcon = (k, size = 22) => iconHtml(STAT[k].icon[0], STAT[k].icon[1], `<span class="sp-alt">${STAT[k].alt}</span>`, { size, cls: 'sp-ico', title: STAT[k].label });

/* Loot as cards. A haul (a won fight's drops, a chest's contents) is dealt
   face down, each back glowing its rarity, best card last. Click a card to turn
   it, or REVEAL ALL; left alone for AUTO_FLIP_MS they turn themselves, so idle
   play never stalls. Each flip plays a pixelfx fanfare sized to the rarity
   (render/loot_fanfare.js). A fight's haul comes after its report (spoils.js);
   a fight that dropped no gear still gets the full report, just without cards,
   and closes itself after AUTO_CLOSE_MS idle. Several hauls queue up and share
   one pause. */

const AUTO_FLIP_MS = 10000;   // Zenu: click to flip; after 10 s idle they flip on their own
const AUTO_CLOSE_MS = 8000;   // once every card is face up
const FLIP_HALF_MS = 110;     // the squash to edge-on, then back out
/* the beat after a card lands before the next one turns: longer for a bigger fanfare */
const NEXT_GAP_MS = [380, 460, 700, 1000, 1500];
const KICKER = { common: 'Found', uncommon: 'A fine find', rare: 'A rare find', epic: 'An epic find', legendary: 'A legendary find' };

let _g = null;
let _queue = [];
let _haul = null;          // { items, report, title, sub, onDone, cards: [{ it, el, up }] }
let _showing = false;
let _pausedByUs = false;
let _idle = null;
let _auto = null;          // the auto-reveal sequence timer
let _fanfare = null;

const tierOf = (it) => TIER[it && it.rarity] || 0;
const colorOf = (it) => (it && it.color) || (RARITIES[it && it.rarity] || {}).color || '#d0d4d8';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function initItemReveal(game) {
  _g = game;
  if (typeof document === 'undefined' || document.getElementById('item-reveal')) return;

  const ov = document.createElement('div');
  ov.id = 'item-reveal';
  ov.innerHTML = `
    <canvas class="sp-fx sp-fx-back"></canvas>
    <div class="cs-frame sp-frame">
      <div class="sp-head">
        <div class="fc-title sp-title" id="sp-title"></div>
        <div class="sp-sub" id="sp-sub"></div>
      </div>
      <div class="sp-report" id="sp-report"></div>
      <div class="sp-cards" id="sp-cards"></div>
      <div class="sp-actions">
        <span class="sp-hint" id="sp-hint"></span>
        <button class="btn" id="sp-all">REVEAL ALL</button>
        <button class="btn primary" id="sp-done">TAKE IT ALL</button>
      </div>
    </div>
    <canvas class="sp-fx sp-fx-front"></canvas>`;
  document.body.appendChild(ov);


  const css = document.createElement('style');
  css.textContent = `
#item-reveal{position:fixed;inset:0;z-index:58;display:none;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at center,rgba(8,6,4,.72) 0%,rgba(2,1,1,.94) 100%);}
#item-reveal.show{display:flex;animation:kit-fade .16s ease-out;}
.sp-fx{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;pointer-events:none;}
.sp-fx-back{z-index:0}.sp-fx-front{z-index:2}
.sp-frame{position:relative;z-index:1;width:min(980px,94vw);max-height:92vh;height:auto;min-height:0;
  padding:14px 22px 16px;gap:12px;overflow:auto;background:rgba(14,11,9,.9) !important;}
.sp-frame.sp-shake{animation:sp-shake .42s steps(6) 1;}
@keyframes sp-shake{0%,100%{transform:translate(0,0)}20%{transform:translate(-5px,2px)}40%{transform:translate(4px,-3px)}
  60%{transform:translate(-3px,-2px)}80%{transform:translate(2px,3px)}}
.sp-head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;}
.sp-title{font-size:16px;letter-spacing:.08em;text-transform:uppercase;}
.sp-sub{font-size:20px;color:var(--dc-text-dim);}
.sp-report:empty{display:none}
.sp-table{width:100%;border-collapse:collapse;font-size:22px;}
.sp-table th{font-weight:normal;color:var(--dc-text-dim);text-align:right;padding:2px 12px 6px;font-size:17px;white-space:nowrap;}
.sp-table th .sp-ico{vertical-align:-6px;margin-right:5px;}
.sp-table th:first-child,.sp-table td:first-child{text-align:left;}
.sp-table td{text-align:right;padding:5px 12px;color:var(--dc-text);border-top:1px solid rgba(255,255,255,.07);white-space:nowrap;}
.sp-table td.sp-zero{color:rgba(255,255,255,.22);}
/* each column's leader: bold, larger, in the stat's colour (the rest stay plain so the winners read at a glance) */
.sp-table td.sp-top{font-weight:bold;font-size:28px;line-height:1;text-shadow:2px 2px 0 #000;}
.sp-table td.sp-dealt.sp-top{color:#ff5a4a}.sp-table td.sp-healed.sp-top{color:#5fe06a}
.sp-table td.sp-taken.sp-top{color:#5aa8ff}.sp-table td.sp-kills.sp-top{color:#c07cff}
.sp-table .sp-cls{color:var(--dc-text-dim);font-size:17px;margin-left:8px;text-transform:capitalize;}
.sp-ico{width:22px;height:22px;image-rendering:pixelated;}
.sp-alt{font-family:var(--px-disp);font-size:8px;margin-right:4px;}
.sp-badge{display:inline-block;font-family:var(--px-disp);font-size:9px;padding:3px 6px;margin-left:8px;vertical-align:3px;
  border:2px solid currentColor;}
.sp-lvl{color:#7fe08a}.sp-down{color:#e06a5a}
.sp-mvp-row td{background:rgba(255,211,106,.11);}
.sp-mvp-row td:first-child{box-shadow:inset 4px 0 0 #ffd36a;}
.sp-mvp{display:inline-block;font-family:var(--px-disp);font-size:10px;line-height:1;padding:4px 7px 4px 6px;margin-left:8px;
  vertical-align:3px;color:#2a1a06;background:#ffd36a;box-shadow:2px 2px 0 #000,inset -2px -2px 0 #c8902a,inset 2px 2px 0 #fff0b0;
  animation:sp-mvp-glint 2.4s steps(1) infinite;}
.sp-mvp::before{content:'';display:inline-block;width:8px;height:8px;margin-right:5px;vertical-align:0;background:#2a1a06;
  clip-path:polygon(50% 0,62% 38%,100% 38%,69% 60%,81% 100%,50% 76%,19% 100%,31% 60%,0 38%,38% 38%);}
@keyframes sp-mvp-glint{0%,88%{filter:none}90%,94%{filter:brightness(1.35)}}
.sp-totals{margin-top:10px;font-size:22px;color:var(--dc-text);display:flex;flex-wrap:wrap;gap:6px 20px;align-items:center;}
.sp-totals .sp-ico{vertical-align:-5px;margin-right:6px;}
.sp-totals b{color:#ffd36a;font-weight:normal}
.sp-notes{font-size:19px;color:var(--dc-text-dim);margin-top:4px;}
.sp-cards{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;padding:8px 0 4px;}
.sp-card{--rc:#b4b0a4;position:relative;width:270px;padding:0;border:0;background:none;cursor:pointer;
  font:inherit;color:inherit;opacity:0;transform:translateY(18px);display:grid;align-items:stretch;}
.sp-card.dealt{opacity:1;transform:none;transition:opacity .18s steps(3),transform .18s steps(3);}
.sp-card.squash{transform:scaleX(0);transition:transform ${FLIP_HALF_MS}ms steps(3);}
.sp-card.up{cursor:default;}
.sp-back,.sp-face{grid-area:1/1;display:flex;flex-direction:column;align-items:center;min-height:250px;
  border:3px solid var(--rc);box-shadow:4px 4px 0 rgba(0,0,0,.55);}
.sp-back{justify-content:center;background:
  repeating-linear-gradient(45deg,rgba(255,255,255,.04) 0 6px,transparent 6px 12px),
  linear-gradient(#1c1612,#0e0b09);}
.sp-back::before{content:'';width:54px;height:54px;border:3px solid var(--rc);transform:rotate(45deg);
  box-shadow:inset 0 0 0 6px rgba(0,0,0,.6);background:color-mix(in srgb,var(--rc) 22%,transparent);}
.sp-back::after{content:'?';position:absolute;font-family:var(--px-disp);font-size:18px;color:var(--rc);text-shadow:2px 2px 0 #000;}
.sp-card.t1 .sp-back{box-shadow:4px 4px 0 rgba(0,0,0,.55),0 0 10px color-mix(in srgb,var(--rc) 40%,transparent);}
.sp-card.t2 .sp-back{animation:sp-tease 1.6s steps(4) infinite;}
.sp-card.t3 .sp-back{animation:sp-tease 1.2s steps(4) infinite;--glow:26px;}
.sp-card.t4 .sp-back{animation:sp-tease .9s steps(4) infinite;--glow:36px;}
@keyframes sp-tease{0%,100%{box-shadow:4px 4px 0 rgba(0,0,0,.55),0 0 calc(var(--glow,18px)*.5) color-mix(in srgb,var(--rc) 45%,transparent);}
  50%{box-shadow:4px 4px 0 rgba(0,0,0,.55),0 0 var(--glow,18px) color-mix(in srgb,var(--rc) 85%,transparent);}}
.sp-card:not(.up):hover .sp-back{border-color:#fff;}
.sp-face{visibility:hidden;align-items:stretch;padding:0;
  background:var(--px-panel-strong, rgba(7,8,10,0.97));}
.sp-face .tt-card{padding:11px 14px 12px;}
.sp-face .tt-head{color:var(--rc) !important;}
/* the reveal shows the icon big, framed in its rarity, with the name wrapping beside it (the bag tooltip keeps its small inline one) */
.sp-face .tt-name{display:flex;align-items:center;gap:10px;margin-top:2px;}
.sp-face .tt-name .item-ico{width:56px;height:56px;flex:none;margin:0;padding:4px;box-sizing:content-box;
  background:rgba(0,0,0,.4);border:2px solid color-mix(in srgb,var(--rc) 60%,#000);box-shadow:inset 0 0 12px color-mix(in srgb,var(--rc) 25%,transparent);}
.sp-card.up .sp-back{display:none}.sp-card.up .sp-face{visibility:visible;}
.sp-actions{display:flex;justify-content:flex-end;align-items:center;gap:10px;}
.sp-hint{flex:1;font-size:17px;color:var(--dc-text-dim);}`;
  document.head.appendChild(css);

  _fanfare = createFanfare(ov.querySelector('.sp-fx-back'), ov.querySelector('.sp-fx-front'));

  document.getElementById('sp-all').addEventListener('click', (e) => { e.stopPropagation(); poke(); revealAll(); });
  document.getElementById('sp-done').addEventListener('click', (e) => { e.stopPropagation(); close(); });
  ov.addEventListener('pointerdown', poke);
  document.addEventListener('keydown', (e) => {
    if (!_showing) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); poke();
      const next = _haul && _haul.cards.find((c) => !c.up);
      if (next) flip(next); else close();
    } else if (e.key === 'Escape') {
      e.preventDefault(); poke();
      if (_haul && _haul.cards.some((c) => !c.up)) revealAll(); else close();
    }
  });
}

/* ── entry points ─────────────────────────────────────────────────────── */

/** Deal a haul as cards (a chest's contents). opts: { title, sub, onDone }.
 *  Returns the number of cards queued, so callers can tell a pause is coming. */
export function revealItems(items, opts = {}) {
  const list = (items || []).filter(Boolean);
  if (!_g || !list.length) { if (opts.onDone) opts.onDone(); return 0; }
  enqueue({ items: list, report: null, title: opts.title || 'Treasure', sub: opts.sub || '', onDone: opts.onDone || null });
  return list.length;
}

/** A fight is over (spoils.js finishFightSpoils): the full report, then its drops
 *  as cards. A fight with no gear gets the same report with no cards; it closes
 *  itself after AUTO_CLOSE_MS idle, so auto-play never stalls on it. */
export function revealFightSpoils(report) {
  if (!_g || !report) return;
  const items = (report.items || []).slice();
  if (_g.fxLog) {
    const sub = fightSub(report);
    const bits = [sub, `+${report.gold} gold`, report.xpEach ? `+${report.xpEach} XP each` : '', report.mvp ? `MVP: ${report.mvp}` : ''].filter(Boolean);
    _g.fxLog(`🏆 Victory — ${bits.join(', ')}.`, 'treasure');
    if (items.length) _g.fxLog(`🎁 Spoils: ${items.map((it) => it.name).join(', ')}.`, 'treasure');
  }
  const haul = { items, report, title: 'Victory', sub: fightSub(report), onDone: null };
  if (typeof setTimeout !== 'function' || typeof document === 'undefined') { enqueue(haul); return; }
  const later = (ms, fn) => {
    const id = setTimeout(() => { _pendingFight = _pendingFight.filter((x) => x !== id); fn(); }, ms);
    _pendingFight.push(id);
  };
  later(VICTORY_DELAY_MS, () => {
    /* no canvas (headless): straight to the report */
    const popped = playScreenFx(victoryFx, 0.5, 0.42, { scale: 4 });
    later(popped ? REPORT_AFTER_POP_MS : 0, () => enqueue(haul));
  });
}

/* Level change / new run: drop anything still queued. */
export function cancelItemReveal() {
  for (const id of _pendingFight) clearTimeout(id);
  _pendingFight = [];
  clearScreenFx();
  _queue = [];
  clearTimers();
  if (_haul) { _haul = null; }
  finish();
}

/* ── the overlay ──────────────────────────────────────────────────────── */

function enqueue(haul) {
  /* best last: the biggest fanfare closes the reveal */
  haul.items.sort((a, b) => tierOf(a) - tierOf(b));
  _queue.push(haul);
  if (!_showing) showNext();
}

function showNext() {
  const ov = typeof document !== 'undefined' && document.getElementById('item-reveal');
  _haul = _queue.shift() || null;
  if (!_haul || !ov) { finish(); return; }
  if (!_showing) {
    _showing = true;
    if (!_g.paused) { _g.setPaused(true); _pausedByUs = true; }
  }
  _fanfare.reset();

  document.getElementById('sp-title').textContent = _haul.title;
  document.getElementById('sp-sub').textContent = _haul.sub;
  document.getElementById('sp-report').innerHTML = _haul.report ? reportHTML(_haul.report) : '';
  const row = document.getElementById('sp-cards');
  row.innerHTML = '';
  _haul.cards = _haul.items.map((it, i) => {
    const t = tierOf(it);
    const el = document.createElement('button');
    el.className = `sp-card t${t}`;
    el.style.setProperty('--rc', colorOf(it));
    el.innerHTML = `<div class="sp-back"></div>${faceHTML(it)}`;
    const card = { it, el, up: false };
    el.addEventListener('click', (e) => { e.stopPropagation(); poke(); if (!card.up) flip(card); });
    row.appendChild(el);
    setTimeout(() => el.classList.add('dealt'), 60 + i * 90);   // dealt in, one after another
    return card;
  });
  ov.classList.add('show');
  playSfx('chestOpen', { volume: 0.5 });
  syncButtons();
  poke();
}

function flip(card) {
  if (!card || card.up || card.turning) return;
  card.turning = true;
  const el = card.el, t = tierOf(card.it);
  el.classList.add('squash');
  setTimeout(() => {
    card.up = true;
    card.turning = false;
    el.classList.add('up');
    el.classList.remove('squash');
    const r = el.getBoundingClientRect();
    const recipe = _fanfare.play(t, colorOf(card.it), r);
    if (recipe.shake) {
      const fr = document.querySelector('#item-reveal .sp-frame');
      fr.classList.remove('sp-shake'); void fr.offsetWidth; fr.classList.add('sp-shake');
    }
    if (t >= TIER.rare) playSfx(t >= TIER.legendary ? 'lootLegendary' : 'lootRare', { volume: t >= TIER.epic ? 0.95 : 0.75 });
    syncButtons();
  }, FLIP_HALF_MS);
}

/* Turn the rest, one at a time, leaving each fanfare its beat. */
function revealAll() {
  if (!_haul || _auto) return;
  const step = () => {
    _auto = null;
    const next = _haul && _haul.cards.find((c) => !c.up);
    if (!next) return;
    flip(next);
    _auto = setTimeout(step, FLIP_HALF_MS + NEXT_GAP_MS[tierOf(next.it)]);
  };
  step();
}

/** Any input restarts the idle clock. Idle with cards face down → they turn
 *  themselves; idle with everything up → the reveal closes. */
function poke() {
  clearTimeout(_idle);
  if (!_showing) return;
  const down = _haul && _haul.cards.some((c) => !c.up);
  _idle = setTimeout(() => { if (down) revealAll(); else close(); }, down ? AUTO_FLIP_MS : AUTO_CLOSE_MS);
}

function syncButtons() {
  if (!_haul) return;
  const down = _haul.cards.filter((c) => !c.up).length, none = !_haul.cards.length;
  document.getElementById('sp-cards').style.display = none ? 'none' : '';
  document.getElementById('sp-all').style.display = down ? '' : 'none';
  document.getElementById('sp-done').textContent = none ? 'CONTINUE' : (_haul.cards.length > 1 ? 'TAKE IT ALL' : 'TAKE IT');
  document.getElementById('sp-hint').textContent = none
    ? (_haul.report ? 'No gear dropped this fight.' : '')
    : down
      ? `Click a card to turn it. ${down > 1 ? 'They turn' : 'It turns'} by ${down > 1 ? 'themselves' : 'itself'} in ${AUTO_FLIP_MS / 1000}s.`
      : 'Everything is in the bag.';
  if (!down) poke();
}

/* Closing with cards still down takes them unseen (they're already in the bag). */
function close() {
  if (!_showing) return;
  clearTimers();
  const done = _haul && _haul.onDone;
  _haul = null;
  _fanfare.clear();
  if (_queue.length) { showNext(); if (done) done(); return; }
  finish();
  if (done) done();
}

function finish() {
  const ov = typeof document !== 'undefined' && document.getElementById('item-reveal');
  if (ov) ov.classList.remove('show');
  if (_fanfare) _fanfare.reset();
  if (_showing) {
    _showing = false;
    if (_pausedByUs && _g) _g.setPaused(false);
    _pausedByUs = false;
  }
}

function clearTimers() {
  clearTimeout(_idle); _idle = null;
  clearTimeout(_auto); _auto = null;
}

/* ── the report ───────────────────────────────────────────────────────── */

function fightSub(r) {
  const bits = [];
  if (r.rounds) bits.push(`${r.rounds} round${r.rounds > 1 ? 's' : ''}`);
  if (r.totals.kills) bits.push(`${r.totals.kills} slain`);
  return bits.join(' · ');
}

/* The fight's totals as icon chips: gold, XP each, then the party's dealt / taken / healed. */
function totalsLine(r) {
  const chip = (k, html) => `<span class="sp-chip">${statIcon(k)}${html}</span>`;
  const bits = [chip('gold', `<b>+${r.gold}</b> gold`)];
  if (r.xpEach) bits.push(chip('xp', `<b>+${r.xpEach}</b> XP each`));
  bits.push(chip('dealt', `${r.totals.dmgDealt} dealt`), chip('taken', `${r.totals.dmgTaken} taken`));
  if (r.totals.healDone) bits.push(chip('healed', `${r.totals.healDone} healed`));
  return bits.join('');
}

const MVP_TAG = '<span class="sp-mvp" title="Most damage dealt plus healing done">MVP</span>';

function reportHTML(r) {
  /* the leader of each column (every hero tied for it); nobody leads a column of zeros */
  const FIELD = { dealt: 'dmgDealt', taken: 'dmgTaken', healed: 'healDone', kills: 'kills' };
  const best = {};
  for (const [k, f] of Object.entries(FIELD)) best[k] = Math.max(0, ...r.heroes.map((h) => h[f] || 0));
  const cell = (k, n) => `<td class="sp-${k}${n ? '' : ' sp-zero'}${n && n === best[k] ? ' sp-top' : ''}">${n || '–'}</td>`;
  const rows = r.heroes.map((h) => {
    const mvp = h.name === r.mvp;
    const badges = (mvp ? MVP_TAG : '')
      + (h.levelUp ? '<span class="sp-badge sp-lvl">LEVEL UP</span>' : '')
      + (h.downs ? '<span class="sp-badge sp-down">DOWNED</span>' : '');
    return `<tr${mvp ? ' class="sp-mvp-row"' : ''}><td>${esc(h.name)}<span class="sp-cls">${esc(h.classKey || '')}</span>${badges}</td>
      ${cell('dealt', h.dmgDealt)}${cell('taken', h.dmgTaken)}${cell('healed', h.healDone)}${cell('kills', h.kills)}</tr>`;
  }).join('');
  const head = ['dealt', 'taken', 'healed', 'kills'].map((k) => `<th>${statIcon(k)}${STAT[k].label}</th>`).join('');
  const notes = r.notes && r.notes.length ? `<div class="sp-notes">Also recovered: ${r.notes.map(esc).join(', ')}.</div>` : '';
  return `<table class="sp-table"><thead><tr><th>Hero</th>${head}</tr></thead>
    <tbody>${rows}</tbody></table><div class="sp-totals">${totalsLine(r)}</div>${notes}`;
}

/* A turned card shows the inventory's own item card (menus.js itemCardHTML): the
   same name, headline stat, stat rows, perk and Power Score the bag shows, so a
   find reads at a glance exactly as it will when equipped. */
function faceHTML(it) {
  const head = KICKER[it.rarity] || 'Found';
  return `<div class="sp-face item-card">${itemCardHTML(it, esc(head), colorOf(it))}</div>`;
}

/* exposed for tests */
export const _internal = { fightSub, totalsLine, reportHTML, AUTO_FLIP_MS };
