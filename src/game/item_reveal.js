import { RARITIES, TIER, bonusText } from './items.js';
import { playSfx } from './audio.js';

/* Ceremony scaled to the reward. Common and uncommon drops just flow through
   the loot feed; a rare-or-better find stops the run for a card — the item
   large in its socket, name in its rarity colour, what it does, one button.
   Several finds in one haul queue up and share the single pause. Click,
   Enter/Space/Escape, or the 7s idle timer moves on. */

const MIN_TIER = TIER.rare;
const IDLE_MS = 7000;
const FLAVOUR = {
  rare: 'A rare find',
  epic: 'An epic find',
  legendary: 'A legendary find',
};

let _g = null;
let _queue = [];
let _showing = false;
let _timer = null;

export function initItemReveal(game) {
  _g = game;
  if (typeof document === 'undefined' || document.getElementById('item-reveal')) return;

  const ov = document.createElement('div');
  ov.id = 'item-reveal';
  ov.innerHTML = `
    <div class="cs-frame ir-frame">
      <div class="fc-title ir-kicker" id="ir-kicker"></div>
      <div class="ir-body">
        <div class="eq-slot ir-socket" id="ir-socket"></div>
        <div class="ir-text">
          <div class="ir-name" id="ir-name"></div>
          <div class="ir-sub" id="ir-sub"></div>
          <div class="ir-bonus" id="ir-bonus"></div>
        </div>
      </div>
      <div class="ir-actions"><button class="btn primary" id="ir-take">TAKE IT</button></div>
    </div>`;
  document.body.appendChild(ov);

  const css = document.createElement('style');
  css.textContent = `
#item-reveal{position:fixed;inset:0;z-index:58;display:none;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at center,rgba(8,6,4,.72) 0%,rgba(2,1,1,.94) 100%);}
#item-reveal.show{display:flex;animation:kit-fade .16s ease-out;}
.ir-frame{width:min(560px,92vw);height:auto;min-height:0;padding:14px 22px 18px;gap:14px;}
.ir-kicker{font-size:12px;letter-spacing:.08em;text-transform:uppercase;}
.ir-body{display:flex;gap:18px;align-items:center;}
.ir-socket{width:112px;height:112px;flex:none;display:flex;align-items:center;justify-content:center;font-size:64px;}
.ir-socket .item-ico{width:80px;height:80px;image-rendering:pixelated;}
.ir-text{flex:1;min-width:0;}
.ir-name{font-family:var(--px-disp);font-size:14px;line-height:1.5;text-shadow:2px 2px 0 #000;}
.ir-sub{font-size:17px;color:var(--dc-text-dim);margin-top:4px;text-transform:capitalize;}
.ir-bonus{font-size:19px;color:var(--dc-text);margin-top:8px;line-height:1.3;white-space:pre-line;}
.ir-actions{display:flex;justify-content:flex-end;}
.ir-frame.ir-legendary{box-shadow:0 0 0 2px rgba(232,168,63,.35),0 0 42px rgba(232,168,63,.35),4px 4px 0 rgba(0,0,0,.55) !important;}
.ir-frame.ir-epic{box-shadow:0 0 0 2px rgba(184,100,240,.3),0 0 34px rgba(184,100,240,.3),4px 4px 0 rgba(0,0,0,.55) !important;}
.ir-frame.ir-rare{box-shadow:0 0 0 2px rgba(90,160,240,.3),0 0 28px rgba(90,160,240,.28),4px 4px 0 rgba(0,0,0,.55) !important;}`;
  document.head.appendChild(css);

  document.getElementById('ir-take').addEventListener('click', next);
  ov.addEventListener('click', e => { if (e.target === ov) next(); });
  document.addEventListener('keydown', e => {
    if (!_showing) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); next(); }
  });
}

/* Hand over the whole haul; only the finds worth a card are kept. Returns the
   number queued so callers can tell whether a pause is coming. */
export function revealItems(items) {
  if (!_g || !items || !items.length) return 0;
  const worthy = items.filter(it => it && (TIER[it.rarity] || 0) >= MIN_TIER);
  if (!worthy.length) return 0;
  _queue.push(...worthy);
  if (!_showing) show();
  return worthy.length;
}

function iconHTML(icon) {
  if (icon && icon.includes('/')) return `<img class="item-ico" src="./${icon}" alt="">`;
  return icon || '';
}

function show() {
  const it = _queue.shift();
  if (!it) { finish(); return; }
  const ov = document.getElementById('item-reveal');
  if (!ov) { finish(); return; }
  if (!_showing) { _showing = true; _g.setPaused(true); }

  const R = RARITIES[it.rarity] || {};
  const color = it.color || R.color || '#d0d4d8';
  const frame = ov.querySelector('.ir-frame');
  frame.className = `cs-frame ir-frame ir-${it.rarity}`;
  document.getElementById('ir-kicker').textContent = FLAVOUR[it.rarity] || 'A find';
  document.getElementById('ir-socket').innerHTML = iconHTML(it.icon);
  const name = document.getElementById('ir-name');
  name.textContent = it.name || it.baseKey || 'Unknown item';
  name.style.color = color;
  document.getElementById('ir-sub').textContent = [R.name, it.slot].filter(Boolean).join(' · ');
  document.getElementById('ir-bonus').textContent = bonusText(it) || '';

  ov.classList.add('show');
  playSfx(it.rarity === 'legendary' ? 'lootLegendary' : 'lootRare', { volume: 0.9 });
  clearTimeout(_timer);
  _timer = setTimeout(next, IDLE_MS);
}

function next() {
  clearTimeout(_timer); _timer = null;
  if (_queue.length) show(); else finish();
}

function finish() {
  const ov = document.getElementById('item-reveal');
  if (ov) ov.classList.remove('show');
  if (_showing) { _showing = false; if (_g) _g.setPaused(false); }
}

/* Level change / new run: drop anything still queued. */
export function cancelItemReveal() {
  _queue = [];
  clearTimeout(_timer); _timer = null;
  finish();
}
