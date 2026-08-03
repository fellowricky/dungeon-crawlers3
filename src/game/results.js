/**
 * End-of-quest results screen — story exposition, rewards, and the run's
 * statistics (from run_stats.js). Shown by completeQuest() in place of the
 * old auto-transition; its Continue button opens the world map.
 *
 * DOM built lazily on first show (same pattern as the death-choice screen).
 */
import { RARITIES, perkText, bonusText, ilvlText } from './items.js';
import { drawHeroPortrait } from './sprite_animator.js';
import { BOSS_SLAIN, CHAIN_EPILOGUE } from './quest_story.js';
import { mulberry32 } from './quests.js';

const $ = id => document.getElementById(id);

function ensureOverlay() {
  if ($('resultsscreen')) return;

  const ov = document.createElement('div');
  ov.id = 'resultsscreen';
  ov.innerHTML = `
    <div class="cs-frame rs-frame">
      <div class="rs-header">
        <div class="rs-kicker" id="rs-kicker">QUEST COMPLETE</div>
        <div class="rs-title" id="rs-title"></div>
      </div>
      <div class="rs-body">
        <div class="rs-story" id="rs-story"></div>
        <div class="rs-columns">
          <div class="rs-col rs-col-stats">
            <h4>The Party's Deeds</h4>
            <table class="rs-table" id="rs-stats-table"></table>
          </div>
          <div class="rs-col rs-col-side">
            <h4>Rewards</h4>
            <div class="rs-rewards" id="rs-rewards"></div>
            <h4>The Run</h4>
            <div class="rs-run" id="rs-run"></div>
          </div>
        </div>
      </div>
      <div class="rs-footer">
        <button id="rs-continue" class="btn primary">CONTINUE</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  if (!$('results-css')) {
    const style = document.createElement('style');
    style.id = 'results-css';
    style.textContent = `
      #resultsscreen{ position:fixed; inset:0; z-index:55; display:none;
        align-items:center; justify-content:center; padding:10px;
        background:rgba(5,4,2,0.82); backdrop-filter:blur(5px); }
      #resultsscreen.show{ display:flex; }
      .rs-frame{ width:min(880px,96vw); max-height:min(860px,94vh); height:auto;
        display:flex; flex-direction:column; padding:0; overflow:hidden; }
      .rs-header{ text-align:center; padding:18px 20px 10px; }
      /* Pixel type scale — VT323 body runs compact, so sizes are bumped ~40%
         vs. the old serif; section labels use the chunky Press Start 2P face. */
      .rs-kicker{ font-family:var(--px-disp); letter-spacing:.06em; font-size:13px;
        color:#e8a83f; text-shadow:2px 2px 0 var(--px-ink); }
      .rs-kicker.saga{ color:#b98cf5; text-shadow:2px 2px 0 var(--px-ink); }
      .rs-title{ font-family:var(--dc-display); font-size:36px; line-height:1.15;
        color:#f2e7c8; margin-top:8px; }
      .rs-body{ overflow-y:auto; padding:6px 22px 12px; }
      .rs-story{ font-style:italic; color:#cbbfa4; line-height:1.35; font-size:22px;
        border-top:1px solid rgba(200,170,90,0.18); border-bottom:1px solid rgba(200,170,90,0.18);
        padding:12px 6px; margin-bottom:14px; }
      .rs-story p{ margin:0 0 8px; } .rs-story p:last-child{ margin-bottom:0; }
      .rs-columns{ display:flex; gap:18px; flex-wrap:wrap; }
      .rs-col{ flex:1 1 300px; min-width:280px; }
      .rs-col h4{ font-family:var(--px-disp); color:#e8a83f; letter-spacing:0;
        font-size:11px; margin:8px 0 12px; }
      .rs-table{ width:100%; border-collapse:collapse; font-size:21px; color:#d8d4c8; }
      .rs-table th{ font-family:var(--px-disp); color:#9b8a6d; font-weight:400; text-align:right;
        padding:5px 6px; border-bottom:1px solid rgba(200,170,90,0.22); font-size:10px; letter-spacing:0; }
      .rs-table th:first-child{ text-align:left; }
      .rs-table td{ text-align:right; padding:5px 6px; border-bottom:1px solid rgba(200,170,90,0.08); }
      .rs-table td:first-child{ text-align:left; white-space:nowrap; }
      .rs-table tr.rs-total td{ border-top:1px solid rgba(200,170,90,0.3); border-bottom:none;
        color:#e8c25a; font-weight:700; }
      .rs-hero-cell{ display:flex; align-items:center; gap:10px; }
      .rs-hero-cell canvas{ width:52px; height:52px; image-rendering:pixelated; }
      .rs-rewards .rs-line, .rs-run .rs-line{ padding:4px 0; font-size:21px; color:#d8d4c8; }
      .rs-reward-item{ margin-top:6px; padding:10px; border:1px solid rgba(200,170,90,0.25);
        background:rgba(226,196,138,0.04); font-size:19px; }
      .rs-reward-item .name{ font-weight:700; }
      .rs-notable{ color:#b98cf5; }
      .rs-footer{ text-align:center; padding:14px 20px 20px; }
      #rs-continue{ font-size:13px; padding:14px 46px; letter-spacing:0; }
    `;
    document.head.appendChild(style);
  }
}

function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function fmtNum(n) { return (n || 0).toLocaleString(); }

function storyHTML(quest) {
  const parts = [];
  if (quest.finalBossName) {
    const rng = mulberry32((quest.seed || 1) + 17);
    const pool = BOSS_SLAIN[quest.theme] || BOSS_SLAIN.generic;
    const line = pool[Math.floor(rng() * pool.length)]
      .replace(/\{boss\}/g, quest.finalBossName)
      .replace(/\{place\}/g, quest.place || 'this place');
    parts.push(line);
  }
  if (quest.victoryText) parts.push(quest.victoryText);
  if (quest.chain && quest.chain.part === 3) {
    const rng = mulberry32((quest.seed || 1) + 41);
    parts.push(CHAIN_EPILOGUE[Math.floor(rng() * CHAIN_EPILOGUE.length)]
      .replace(/\{place\}/g, quest.place || 'that place'));
  }
  return parts.map(p => `<p>${p}</p>`).join('');
}

function rewardsHTML(game, quest, summary) {
  const real = game.heroes.filter(h => !h.temp);
  const xpEach = Math.max(1, Math.round((quest.rewardXp || 0) / Math.max(1, real.length)));
  let html = '';
  if (quest.rewardGold) html += `<div class="rs-line">🪙 +${fmtNum(quest.rewardGold)} gold</div>`;
  if (quest.rewardXp) html += `<div class="rs-line">✨ +${fmtNum(xpEach)} XP each</div>`;
  const it = quest.rewardItem;
  if (it) {
    const color = it.color || (RARITIES[it.rarity] && RARITIES[it.rarity].color) || '#d8d4c8';
    const bits = [bonusText(it), perkText(it)].filter(Boolean).join(' · ');
    html += `<div class="rs-reward-item">
      <div class="name" style="color:${color}">${it.icon && !String(it.icon).includes('/') ? it.icon + ' ' : ''}${it.name}</div>
      <div>${it.rarity} · ${ilvlText(it)}</div>
      ${bits ? `<div>${bits}</div>` : ''}
    </div>`;
  }
  return html || '<div class="rs-line">The deed is its own reward.</div>';
}

function runHTML(quest, summary) {
  const rar = Object.entries(summary.lootByRarity || {})
    .map(([r, n]) => `${n} ${r}`).join(', ');
  let html = `
    <div class="rs-line">🏰 Floors cleared: ${summary.floorsCleared} / ${quest.floors || summary.floorsCleared}</div>
    <div class="rs-line">🪙 Gold earned (loot &amp; rewards): ${fmtNum(summary.goldEarned)}</div>
    <div class="rs-line">🎒 Items looted: ${summary.itemsLooted}${rar ? ` (${rar})` : ''}</div>
    <div class="rs-line">⏱ Time: ${fmtTime(summary.elapsedSec)}</div>`;
  for (const n of summary.notableLoot || []) {
    html += `<div class="rs-line rs-notable">★ ${n.name} (${n.rarity})</div>`;
  }
  return html;
}

function statsTableHTML(summary) {
  const head = `<tr><th>Hero</th><th>Kills</th><th>Dmg Dealt</th><th>Dmg Taken</th><th>Downs</th><th>XP</th></tr>`;
  const rows = summary.heroes.map((h, i) => `
    <tr>
      <td><span class="rs-hero-cell"><canvas class="rs-portrait" data-i="${i}" width="64" height="64"></canvas>${h.name}</span></td>
      <td>${fmtNum(h.kills)}</td><td>${fmtNum(h.dmgDealt)}</td>
      <td>${fmtNum(h.dmgTaken)}</td><td>${fmtNum(h.downs)}</td><td>${fmtNum(h.xp)}</td>
    </tr>`).join('');
  const t = summary.totals;
  const total = `<tr class="rs-total"><td>Total</td>
    <td>${fmtNum(t.kills)}</td><td>${fmtNum(t.dmgDealt)}</td>
    <td>${fmtNum(t.dmgTaken)}</td><td>${fmtNum(t.downs)}</td><td>${fmtNum(t.xp)}</td></tr>`;
  return head + rows + total;
}

/**
 * Show the results overlay. `summary` comes from finalizeRunStats() and may be
 * null (old save with no tracked run) — the stats table is hidden then.
 * `onContinue` fires exactly once, on button / backdrop / Escape.
 */
export function showQuestResults(game, quest, summary, onContinue) {
  ensureOverlay();
  const ov = $('resultsscreen');

  const saga = quest.chain && quest.chain.part === 3;
  const kicker = $('rs-kicker');
  kicker.textContent = saga ? 'SAGA COMPLETE' : 'QUEST COMPLETE';
  kicker.classList.toggle('saga', !!saga);
  $('rs-title').textContent = quest.name || 'The Quest';
  $('rs-story').innerHTML = storyHTML(quest);
  $('rs-rewards').innerHTML = rewardsHTML(game, quest, summary || { });

  const statsCol = ov.querySelector('.rs-col-stats');
  if (summary) {
    statsCol.style.display = '';
    $('rs-stats-table').innerHTML = statsTableHTML(summary);
    $('rs-run').innerHTML = runHTML(quest, summary);
    /* portraits render async; heroes looked up by name from the summary */
    ov.querySelectorAll('.rs-portrait').forEach(c => {
      const row = summary.heroes[+c.dataset.i];
      const hero = game.heroes.find(h => !h.temp && h.data.name === row.name);
      if (hero) drawHeroPortrait(c, hero.data);
    });
  } else {
    statsCol.style.display = 'none';
    $('rs-run').innerHTML = '';
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    ov.classList.remove('show');
    removeEventListener('keydown', onKey);
    if (onContinue) onContinue();
  };
  const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') finish(); };

  $('rs-continue').onclick = finish;
  ov.onclick = e => { if (e.target === ov) finish(); };
  addEventListener('keydown', onKey);

  ov.classList.add('show');
}
