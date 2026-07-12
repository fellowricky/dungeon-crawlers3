import { roll, subclassOf } from './srd.js';
import { rollChestLoot, bonusText } from './items.js';
import { log, updateResources } from './ui.js';
import { refreshMenus } from './menus.js';
import { onChestLooted } from './quest_events.js';
import { playSfx } from './audio.js';

let _g = null;
let _state = null;

export function initChestWheel(game) {
  _g = game;

  const ov = document.createElement('div');
  ov.id = 'chestwheelscreen';
  ov.innerHTML = `
    <div class="cw-frame">
      <div class="cw-header">The Chest Creaks Open</div>
      <div class="cw-wheel-wrap">
        <canvas id="chest-wheel-canvas" width="260" height="260"></canvas>
        <div id="chest-wheel-arrow"></div>
      </div>
      <div id="chest-loot-display"></div>
      <button id="chest-wheel-continue">TAKE LOOT</button>
    </div>`;
  document.body.appendChild(ov);

  const css = document.createElement('style');
  css.textContent = `
#chestwheelscreen {
  position:fixed;inset:0;z-index:54;display:none;
  background:radial-gradient(ellipse at center,rgba(8,6,4,0.82) 0%,rgba(2,1,1,0.96) 100%);
  backdrop-filter:blur(4px) saturate(0.6);
  align-items:center;justify-content:center;flex-direction:column;
}
#chestwheelscreen.show{display:flex;}
.cw-frame{
  background:linear-gradient(160deg,#171310 0%,#0b0908 60%,#080606 100%);
  border:2px solid #4a3a26;border-radius:6px;
  padding:22px 28px 18px;max-width:340px;width:90vw;
  box-shadow:0 0 60px rgba(0,0,0,0.9),0 0 22px rgba(120,50,25,0.12),inset 0 0 34px rgba(0,0,0,0.75);
  text-align:center;display:flex;flex-direction:column;align-items:center;
}
.cw-header{
  font-family:MedievalSharp,serif;font-size:20px;
  color:#9a8a6a;text-shadow:0 2px 3px #000,0 0 16px rgba(140,60,30,0.35);
  margin-bottom:14px;letter-spacing:3px;
  animation:cw-flicker 3.2s infinite;
}
@keyframes cw-flicker{
  0%,100%{opacity:1;}
  87%{opacity:1;}
  89%{opacity:0.72;}
  91%{opacity:0.95;}
  93%{opacity:0.8;}
  95%{opacity:1;}
}
.cw-wheel-wrap{
  position:relative;margin-bottom:10px;
}
#chest-wheel-canvas{
  border-radius:50%;
  box-shadow:0 6px 22px rgba(0,0,0,0.85),0 0 18px rgba(120,50,25,0.18);
}
#chest-wheel-arrow{
  position:absolute;top:-6px;left:50%;transform:translateX(-50%);
  width:0;height:0;
  border-left:9px solid transparent;border-right:9px solid transparent;
  border-top:16px solid #8a7c60;
  filter:drop-shadow(0 1px 2px #000) drop-shadow(0 0 5px rgba(140,40,30,0.6));
}
#chest-loot-display{
  color:#a89c84;font-family:'Segoe UI',sans-serif;font-size:13px;
  min-height:50px;text-align:center;width:100%;margin:4px 0;
}
#chest-loot-display .loot-gold{
  color:#b08d3c;font-size:14px;margin:2px 0;
  text-shadow:0 1px 2px #000;
}
#chest-loot-display .loot-pot{
  color:#6e8a5e;font-size:13px;margin:2px 0;
}
#chest-loot-display .loot-item{
  margin-top:6px;padding:6px 8px;
  background:rgba(0,0,0,0.35);border-radius:3px;
  border:1px solid #2c241a;border-left:3px solid currentColor;text-align:left;
}
#chest-loot-display .loot-item .li-name{
  font-size:14px;font-weight:bold;
}
#chest-loot-display .loot-item .li-bonus{
  font-size:12px;opacity:0.8;margin-top:2px;
}
#chest-wheel-continue{
  font-family:MedievalSharp,serif;font-size:15px;
  background:linear-gradient(180deg,#26201a 0%,#120e0b 100%);
  color:#a89c7c;border:1px solid #4a3a26;border-radius:3px;
  padding:8px 32px;cursor:pointer;margin-top:10px;
  letter-spacing:1px;transition:all 0.2s;display:none;
  text-shadow:0 1px 2px #000;
}
#chest-wheel-continue:hover{
  background:linear-gradient(180deg,#332a20 0%,#1c1610 100%);
  border-color:#7a3020;color:#c8b890;
  box-shadow:0 0 14px rgba(140,50,30,0.35);
}`;
  document.head.appendChild(css);

  document.getElementById('chest-wheel-continue').addEventListener('click', () => dismissWheel());
  document.getElementById('chestwheelscreen').addEventListener('click', (e) => {
    if (_state && _state.phase === 'result' && e.target.id === 'chestwheelscreen') dismissWheel();
  });
}

export function lootChest(chest, showWheel = false) {
  if (!_g || chest.looted) return;

  playSfx('chestOpen', { volume: 0.8 });
  const gold = rollChestGold();
  const potion = rollChestPotion();
  const items = rollChestLoot(_g.dungeonLevel);

  if (showWheel) {
    showSpinWheel({ chest, gold, potion, items });
  } else {
    applyLoot(chest, gold, potion, items);
  }
}

function rollChestGold() {
  const alive = _g.heroes.filter(h => h.data.hp > 0);
  let g = 25 * _g.dungeonLevel + roll(3, 20);
  const thiefBonus = Math.max(0, ...alive.map(h => {
    const sc = subclassOf(h.data);
    return (sc && sc.chestGold) || 0;
  }));
  if (thiefBonus) g = Math.round(g * (1 + thiefBonus));
  return g;
}

function rollChestPotion() {
  if (Math.random() >= 0.6) return null;
  return (_g.dungeonLevel >= 3 && Math.random() < 0.4) ? 'greater' : 'heal';
}

function applyLoot(chest, gold, potion, items) {
  chest.looted = true;
  _g.gold += gold;
  if (potion === 'greater') _g.potions.greater++;
  else if (potion === 'heal') _g.potions.heal++;

  for (const it of items) _g.inventory.push(it);
  updateResources(_g);
  refreshMenus(_g);
  onChestLooted(_g);

  log(`\u{1FA99} The party loots a chest: ${gold} gold.`, 'treasure');
  if (potion) log(`  \u{21B3} a ${potion === 'greater' ? 'Greater Healing' : 'Healing'} Potion.`, 'treasure');
  for (const it of items) log(`  \u{21B3} ${it.name}!`, 'treasure');
}

/* ── spinning wheel overlay ── */

function showSpinWheel(lootData) {
  _g.setPaused(true);

  _state = {
    ...lootData,
    phase: 'spinning',
    angle: Math.random() * Math.PI * 2,
    speed: 9 + Math.random() * 5,
    elapsed: 0,
    _lastT: 0,
  };

  const ov = document.getElementById('chestwheelscreen');
  ov.classList.add('show');
  document.getElementById('chest-wheel-continue').style.display = 'none';
  document.getElementById('chest-loot-display').innerHTML =
    '<div style="color:#7a6c52;font-size:13px;font-style:italic;">the lock gives way&hellip;</div>';

  drawWheel(_state.angle);
  requestAnimationFrame(tick);
}

function tick(ts) {
  if (!_state || _state.phase !== 'spinning') return;

  if (!_state._lastT) _state._lastT = ts;
  const dt = Math.min((ts - _state._lastT) / 1000, 0.1);
  _state._lastT = ts;
  _state.elapsed += dt;

  if (_state.elapsed < 1.6) {
    _state.speed = Math.max(_state.speed, 3);
  } else {
    _state.speed *= Math.pow(0.025, dt);
  }

  _state.angle += _state.speed * dt;

  if (_state.speed < 0.12) {
    _state.phase = 'result';
    showLootPanel();
    return;
  }

  drawWheel(_state.angle);
  requestAnimationFrame(tick);
}

const SEG_COLORS = ['#221c15','#171310','#2a211a','#3a1c18','#171310','#221c15','#2e2015','#171310'];
const SEG_RUNES  = ['\u16a0','\u16cf','\u16a6','\u16df','\u16b1','\u16de','\u16c9','\u16d2'];

function drawWheel(angle) {
  const cvs = document.getElementById('chest-wheel-canvas');
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  const cx = 130, cy = 130, R = 115;
  ctx.clearRect(0, 0, 260, 260);

  /* segments: cold iron plates, one stained dried-blood */
  const N = SEG_COLORS.length;
  for (let i = 0; i < N; i++) {
    const a0 = angle + (i * Math.PI * 2) / N;
    const a1 = a0 + (Math.PI * 2) / N;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a1);
    ctx.closePath();
    ctx.fillStyle = SEG_COLORS[i];
    ctx.fill();
    ctx.strokeStyle = '#060504';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    const ma = a0 + Math.PI / N;
    ctx.translate(cx + Math.cos(ma) * R * 0.62, cy + Math.sin(ma) * R * 0.62);
    ctx.rotate(ma + Math.PI / 2);
    ctx.fillStyle = '#7a6c52';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    ctx.font = '20px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(SEG_RUNES[i], 0, 0);
    ctx.restore();
  }

  /* soot vignette so the plates fall into shadow toward the rim */
  const vg = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = vg;
  ctx.fill();

  /* riveted iron rim */
  ctx.beginPath();
  ctx.arc(cx, cy, R - 3, 0, Math.PI * 2);
  ctx.strokeStyle = '#3a3128';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, R - 3, 0, Math.PI * 2);
  ctx.strokeStyle = '#1a1510';
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let i = 0; i < 16; i++) {
    const ra = angle + (i * Math.PI * 2) / 16;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ra) * (R - 3), cy + Math.sin(ra) * (R - 3), 2.2, 0, Math.PI * 2);
    ctx.fillStyle = '#57493a';
    ctx.fill();
  }

  /* hub: blackened iron boss with a skull */
  ctx.beginPath();
  ctx.arc(cx, cy, 24, 0, Math.PI * 2);
  const hg = ctx.createRadialGradient(cx - 5, cy - 6, 3, cx, cy, 24);
  hg.addColorStop(0, '#3c332a');
  hg.addColorStop(1, '#14100c');
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.strokeStyle = '#4a3a26';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#8a7c60';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 4;
  ctx.font = '20px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u2620', cx, cy + 1);
  ctx.shadowBlur = 0;
}

function showLootPanel() {
  if (!_state) return;
  const d = document.getElementById('chest-loot-display');

  let html = `<div class="loot-gold">\u{1FA99} ${_state.gold} gold</div>`;
  if (_state.potion) {
    html += `<div class="loot-pot">\u{1F9EA} ${_state.potion === 'greater' ? 'Greater Healing' : 'Healing'} Potion</div>`;
  }
  for (const item of _state.items) {
    const b = bonusText(item) || '';
    html += `<div class="loot-item" style="border-left-color:${item.color || '#888'}">
      <div class="li-name" style="color:${item.color || '#d0d4dc'}">${item.name}</div>
      ${b ? `<div class="li-bonus">${b}</div>` : ''}
    </div>`;
  }
  if (!_state.items.length) {
    html += '<div style="color:#a09878;font-size:13px;margin-top:4px;">The chest is otherwise empty.</div>';
  }

  d.innerHTML = html;
  document.getElementById('chest-wheel-continue').style.display = 'inline-block';
  startAutoTake();
}

/* idle safety net: claim the loot on its own after 30s */
const AUTO_TAKE_SECS = 30;
let _autoTimer = null;

function startAutoTake() {
  stopAutoTake();
  let remain = AUTO_TAKE_SECS;
  const btn = document.getElementById('chest-wheel-continue');
  btn.textContent = `TAKE LOOT (${remain})`;
  _autoTimer = setInterval(() => {
    if (!_state) { stopAutoTake(); return; }
    remain--;
    if (remain <= 0) { dismissWheel(); return; }
    btn.textContent = `TAKE LOOT (${remain})`;
  }, 1000);
}

function stopAutoTake() {
  if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
}

function dismissWheel() {
  if (!_state) return;
  stopAutoTake();
  const { chest, gold, potion, items } = _state;
  _state = null;

  document.getElementById('chestwheelscreen').classList.remove('show');
  document.getElementById('chest-loot-display').innerHTML = '';

  applyLoot(chest, gold, potion, items);
  _g.setPaused(false);
}
