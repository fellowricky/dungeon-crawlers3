/**
 * Loot editor — Budget & Costs panel + Item Level Ladder.
 *
 * Every knob in loot_budget.json is rendered here and edited live. This module
 * imports the SAME budget.js the game uses and drives it through setTuning(), so
 * a preview in the editor can never disagree with what the game will actually
 * roll — there is one pricing implementation, not two.
 *
 * Overrides persist to localStorage and export as a drop-in replacement for
 * src/game/loot_budget.json.
 */
import {
  RARITIES, RARITY_ORDER, rollItem, itemSpend, bonusText,
} from './game/items.js';
import {
  getTuning, setTuning, defaultTuning, itemBudget, bonusLabel, rarityWeight,
} from './game/budget.js';

const TUNING_STORAGE_KEY = 'dc_loot_editor_tuning_v1';

/* Reference costs measured by sim/value.mjs (sim/reports/value_latest.md).
   Shown beside each knob so a hand-tuned value can be compared against what the
   simulator actually produced. Keys the harness structurally cannot measure are
   absent on purpose rather than given a fabricated figure. */
const MEASURED_COSTS = {
  ac: 20, atk: 10, dmg: 12, crit: 7, hp: 3, heal: 2,
  str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8,
};
const UNMEASURED_NOTE = {
  save: 'estimate — saving throws are not modelled by the harness',
  move: 'estimate — the abstract combat model has no positions',
  speed: 'estimate — exploration speed is not simulated',
  skill: 'estimate — skill checks are not simulated',
  elem: 'estimate — elemental damage post-dates the sweep',
  spellSlotBase: 'estimate — slot economy is not simulated',
  spellSlotPerLevel: 'estimate — slot economy is not simulated',
  grantSpellPerLevel: 'NOT YET WIRED — granted spells are not an affix yet',
};

/* Set by init() so this module can nudge the rest of the editor after a change
   without importing it (which would be circular). */
let onTuningChanged = () => {};

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

/* ─── Persistence ───────────────────────────────────────────────────────── */

function loadTuningDraft() {
  const saved = localStorage.getItem(TUNING_STORAGE_KEY);
  if (!saved) return;
  try {
    setTuning(JSON.parse(saved));
  } catch (e) {
    console.error('Bad saved tuning draft, falling back to defaults:', e);
  }
}

function saveTuningDraft() {
  localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(getTuning()));
}

function refreshAfterTuningChange() {
  saveTuningDraft();
  renderBalancePanels();
  renderLadder();
  onTuningChanged();
}

/** Set a dotted path inside the live tuning object, then refresh everything. */
function setTuningPath(path, value) {
  const T = getTuning();
  const parts = path.split('.');
  let node = T;
  for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]];
  node[parts[parts.length - 1]] = value;
  setTuning(T);
  refreshAfterTuningChange();
}

/* ─── Knob rendering ────────────────────────────────────────────────────── */

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function knobRow(label, path, value, hint) {
  const step = (!Number.isInteger(value) && Math.abs(value) < 3) ? '0.05' : '1';
  return '<div class="knob-row">'
    + '<div class="knob-label"><span>' + esc(label) + '</span>'
    + (hint ? '<span class="knob-hint">' + esc(hint) + '</span>' : '')
    + '</div>'
    + '<input type="number" class="form-input knob-input" step="' + step
    + '" value="' + value + '" data-path="' + path + '">'
    + '</div>';
}

function knobPanel(title, blurb, rowsHtml) {
  return '<section class="section-card">'
    + '<div class="section-title"><span>' + title + '</span></div>'
    + (blurb ? '<div class="knob-blurb">' + blurb + '</div>' : '')
    + '<div class="knob-grid">' + rowsHtml + '</div>'
    + '</section>';
}

/** Numeric leaf keys, skipping `_note`-style string metadata. */
function numericKeys(obj) {
  return Object.keys(obj || {}).filter(k => typeof obj[k] === 'number');
}

function prettyCostLabel(key) {
  switch (key) {
    case 'spellSlotBase': return 'Spell slot — base';
    case 'spellSlotPerLevel': return 'Spell slot — per level';
    case 'grantSpellPerLevel': return 'Granted spell — per level';
    case 'save': return 'Saving throw (each)';
    case 'elem': return 'Elemental damage (each)';
    case 'skill': return 'Skill rank (kit only)';
    case 'move': return 'Combat move (per foot)';
    case 'speed': return 'Exploration speed (per 1.0)';
    default: return bonusLabel(key);
  }
}

/** Live odds table, so a weight edit shows its real effect immediately. */
function rarityOddsTable() {
  const tiers = [1, 5, 10, 15, 20];
  const head = tiers.map(t => '<th>T' + t + '</th>').join('');
  const rows = RARITY_ORDER.map(r => {
    const cells = tiers.map(t => {
      const tot = RARITY_ORDER.reduce((s, rr) => s + rarityWeight(rr, t), 0);
      const pct = tot > 0 ? (100 * rarityWeight(r, t) / tot) : 0;
      const txt = (pct > 0 && pct < 0.01) ? '&lt;0.01' : pct.toFixed(2);
      return '<td>' + txt + '%</td>';
    }).join('');
    return '<tr><td style="color:' + RARITIES[r].color + ';font-weight:700">'
      + r + '</td>' + cells + '</tr>';
  }).join('');
  return '<table class="odds-table"><tr><th>rarity</th>' + head + '</tr>' + rows + '</table>';
}

/** Perk costs are informational — perks are budget-exempt and never spend. */
function perkCostPanel() {
  const T = getTuning();
  const mc = T.perks.measuredCost || {};
  const un = T.perks.unmeasured || {};
  const rows = Object.keys(mc).sort((a, b) => mc[b] - mc[a]).map(id => {
    const flag = un[id];
    const hint = flag === 'lower-bound'
      ? 'LOWER BOUND — sustain runs away against immortal monsters'
      : flag === 'unmeasurable'
        ? 'UNMEASURABLE — procs on kill, and nothing dies in the defense mode'
        : 'measured by sim/value.mjs';
    return knobRow(id, 'perks.measuredCost.' + id, mc[id], hint);
  }).join('');
  return knobPanel('★ Perk costs (reference only)',
    'Perks are <b>budget-exempt</b> and exclusive to the top rarity — these numbers rank '
    + 'them against each other but are never actually spent. Two of them the valuation '
    + 'harness genuinely cannot price; those are flagged, and are the ones most worth '
    + 'setting by hand.',
    rows);
}

export function renderBalancePanels() {
  const host = document.getElementById('balance-panels');
  if (!host) return;
  const T = getTuning();
  const out = [];

  const costRows = numericKeys(T.costs).map(key => {
    const measured = MEASURED_COSTS[key];
    let hint;
    if (measured != null) {
      hint = measured === T.costs[key] ? 'measured ' + measured
        : 'measured ' + measured + ' — overridden';
    } else {
  hint = UNMEASURED_NOTE[key] || '';
    }
    return knobRow(prettyCostLabel(key), 'costs.' + key, T.costs[key], hint);
  });
  out.push(knobPanel('💰 Bonus costs (points per 1 unit)',
    'What one unit of each bonus is worth. <b>+1 Attack = 10</b> and <b>+1 AC = 20</b> are '
    + 'the anchors the entire scale hangs on — changing either rescales everything else '
    + 'implicitly.',
    costRows.join('')));

  out.push(knobPanel('📈 Budget curve',
    'An item\'s budget is <code>(intercept + perIlvl × ilvl) × slotWeight × rarityMult</code>. '
    + 'Linear on purpose: 5e\'s own math is linear (proficiency +2→+6, ability mod +0→+5), '
    + 'and a geometric curve is what made the old system spike.',
    numericKeys(T.budget).map(k => knobRow(k, 'budget.' + k, T.budget[k])).join('')));

  out.push(knobPanel('⚖️ Slot weights',
    'Bigger slots carry more power, so a ring can never out-stat a greatsword.',
    numericKeys(T.slotWeight).map(k => knobRow(k, 'slotWeight.' + k, T.slotWeight[k])).join('')));

  out.push(knobPanel('✨ Rarity budget multipliers',
    'Deliberately <b>flat</b> versus the old 1.0 / 1.7 / 2.5 / 3.5 / 4.8. This is the '
    + 'single biggest lever against the power spike, and it is what makes removing the '
    + 'rarity gate safe — a shallow epic stays a good find rather than a run-breaker.',
    numericKeys(T.rarityMult).map(k => knobRow(k, 'rarityMult.' + k, T.rarityMult[k])).join('')));

  out.push(knobPanel('🧩 Affix lines',
    'How many affix <i>lines</i> a rarity grants — rarity buys breadth, not bigger numbers. '
    + '<code>_perIlvl</code> adds a line every N item levels; without it the budget curve '
    + 'outruns affix capacity at high ilvl and deep items silently underspend. '
    + '<code>_maxPerIlvl</code> does the same for each affix\'s own magnitude cap.',
    numericKeys(T.affixSlots).map(k => knobRow(k, 'affixSlots.' + k, T.affixSlots[k])).join('')));

  const wRows = [];
  for (const r of RARITY_ORDER) {
    const w = T.rarityWeights[r];
    if (!w) continue;
    wRows.push(knobRow(r + ' — base', 'rarityWeights.' + r + '.base', w.base));
    wRows.push(knobRow(r + ' — per tier', 'rarityWeights.' + r + '.perTier', w.perTier));
  }
  out.push(knobPanel('🎲 Rarity drop weights',
    'Drop <i>chance</i> only — there is no rarity gate any more, so every rarity is '
    + 'reachable at every depth and scarcity alone makes the top tiers special. Weight is '
    + '<code>clamp(base + perTier × questTier)</code>.' + rarityOddsTable(),
    wRows.join('')));

  const sRows = [];
  for (const src of Object.keys(T.sourceIlvl)) {
    if (src.charAt(0) === '_') continue;
    sRows.push(knobRow(src + ' — offset', 'sourceIlvl.' + src + '.offset', T.sourceIlvl[src].offset));
    sRows.push(knobRow(src + ' — spread', 'sourceIlvl.' + src + '.spread', T.sourceIlvl[src].spread));
  }
  out.push(knobPanel('🎯 Loot source item levels',
    'Item level comes from the <b>quest tier</b> plus the source offset — never from the '
    + 'floor the party happens to be standing on. Depth within a dungeon leans rarity, not '
    + 'item level.',
    sRows.join('')));

  const bpRows = numericKeys(T.basePricing).map(k =>
    knobRow(k, 'basePricing.' + k, T.basePricing[k]));
  for (const slot of Object.keys(T.basePricing.tierIlvl || {})) {
    T.basePricing.tierIlvl[slot].forEach((lvl, i) => {
      bpRows.push(knobRow(slot + ' tier ' + (i + 1) + ' — unlocks at ilvl',
        'basePricing.tierIlvl.' + slot + '.' + i, lvl));
    });
  }
  out.push(knobPanel('🗡️ Base item pricing',
    'The base is charged against the same budget as its affixes. That is what replaced the '
    + 'old hand-maintained minimum-floor table — an expensive base simply cannot fit a low '
    + 'budget, so nothing has to gate it explicitly. <code>damageDieRef</code> is the free '
    + 'baseline die. Armour and helms are the exception: they are priced from their authored '
    + '<code>tier</code> rather than their AC, so light, medium and heavy can share unlock levels '
    + 'even though their AC numbers differ. These knobs set which item level each tier unlocks '
    + 'at; which tier a base belongs to lives on the base itself. Any slot listed here gets tier '
    + 'pricing — slots absent from it (shields) still price off their chassis AC.',
    bpRows.join('')));

  out.push(knobPanel('🔥 Elemental type multipliers',
    'Commonly-resisted damage types cost less than rarely-resisted ones, which is what '
    + 'makes damage type a real choice rather than a reskin.',
    numericKeys(T.elemTypeMult).map(k =>
      knobRow(k, 'elemTypeMult.' + k, T.elemTypeMult[k])).join('')));

  out.push(knobPanel('🪙 Gold value',
    'Sell price derives from the item\'s real point cost, so the economy cannot drift away '
    + 'from the power curve.',
    numericKeys(T.gold).map(k => knobRow(k, 'gold.' + k, T.gold[k])).join('')));

  out.push(knobPanel('🎁 Anti-drought (pity) <span class="knob-todo">not yet wired</span>',
    '<b>These knobs currently drive nothing</b> — the mechanic is designed and budgeted but '
    + 'not implemented yet. Random slot selection across 11 slots is the real cause of dry '
    + 'spells, not the curves; the intent is that after this many drops which failed to beat '
    + 'a hero\'s current gear, the next roll is forced into their weakest slot.',
    numericKeys(T.pity).map(k => knobRow(k, 'pity.' + k, T.pity[k])).join('')));

  out.push(perkCostPanel());

  host.innerHTML = out.join('');

  host.querySelectorAll('.knob-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (Number.isNaN(v)) { inp.value = '0'; return; }
      setTuningPath(inp.getAttribute('data-path'), v);
      toast('Tuning updated — ladder and simulator refreshed.');
    });
  });
}

/* ─── Export / reset ────────────────────────────────────────────────────── */

async function handleSaveTuningToProject() {
  try {
    const res = await fetch('/api/save-loot-budget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getTuning(), null, 2),
    });
    const out = await res.json();
    if (!out.success) throw new Error(out.error || 'save failed');
    toast('Saved to src/game/loot_budget.json — live for the game.');
  } catch (e) {
    /* Only the vite dev server exposes the endpoint; fall back to a download. */
    console.error(e);
    toast('Could not save (dev server only) — exporting a file instead.');
    handleExportTuning();
  }
}

function handleExportTuning() {
  const blob = new Blob([JSON.stringify(getTuning(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'loot_budget.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported — drop it into src/game/ to make it live.');
}

function handleResetTuning() {
  if (!confirm('Discard all tuning overrides and go back to the measured defaults?')) return;
  localStorage.removeItem(TUNING_STORAGE_KEY);
  setTuning(defaultTuning());
  refreshAfterTuningChange();
  toast('Tuning reset to measured defaults.');
}

/* ══════════════════════════════════════════════════════════════════════════
   ITEM LEVEL LADDER — ilvl 0..20 down the rows, rarity across the columns.
   The question it exists to answer: does a deep common still beat a shallow
   epic? If it doesn't, the rarity multipliers are too steep again.
   ══════════════════════════════════════════════════════════════════════════ */

const LADDER_SLOTS = ['weapon', 'armor', 'shield', 'helm', 'amulet', 'ring', 'gloves', 'boots'];

/* Deterministic RNG so a ladder cell doesn't reshuffle on every re-render. */
function seededRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function renderLadder() {
  const grid = document.getElementById('ladder-grid');
  if (!grid) return;
  const slotSel = document.getElementById('ladder-slot');
  const slot = (slotSel && slotSel.value) || 'weapon';
  const modeSel = document.getElementById('ladder-mode');
  const mode = (modeSel && modeSel.value) || 'budget';
  const seedEl = document.getElementById('ladder-seed');
  const seed = parseInt((seedEl && seedEl.value) || '7', 10) || 7;
  const maxIlvl = getTuning().budget.maxIlvl;

  const head = RARITY_ORDER.map(r =>
    '<th style="color:' + RARITIES[r].color + '">' + r + '</th>').join('');

  const rows = [];
  for (let ilvl = 0; ilvl <= maxIlvl; ilvl++) {
    const cells = RARITY_ORDER.map((r, ri) => {
      const budget = itemBudget(slot, ilvl, r);
      if (mode === 'budget') return '<td class="ladder-cell"><b>' + budget + '</b></td>';

      const rng = seededRng(seed + ilvl * 977 + ri * 31);
      const it = rollItem(ilvl, rng, slot, { ilvl, forceRarity: r });
      if (!it) return '<td class="ladder-cell">—</td>';
      const spend = itemSpend(it);
      const over = spend > budget ? ' ladder-over' : '';
      return '<td class="ladder-cell">'
        + '<div class="ladder-name" style="color:' + RARITIES[r].color + '">' + esc(it.name) + '</div>'
        + '<div class="ladder-stats">' + esc(bonusText(it) || '—') + '</div>'
        + '<div class="ladder-pts' + over + '">' + spend + ' / ' + budget + ' pts</div>'
        + '</td>';
    }).join('');
    rows.push('<tr><th class="ladder-ilvl">ilvl ' + ilvl + '</th>' + cells + '</tr>');
  }
  grid.innerHTML = '<table class="ladder-table"><tr><th></th>' + head + '</tr>'
    + rows.join('') + '</table>';
}

/* ─── Init ──────────────────────────────────────────────────────────────── */

/**
 * @param {object} opts
 * @param {Function} opts.onChange called after any tuning edit, so the rest of
 *   the editor (simulator, item preview) can re-render against the new numbers.
 */
export function initBalanceAndLadder(opts = {}) {
  onTuningChanged = opts.onChange || (() => {});

  const sel = document.getElementById('ladder-slot');
  if (sel) {
    sel.innerHTML = LADDER_SLOTS.map(s => '<option value="' + s + '">' + s + '</option>').join('');
    sel.addEventListener('change', renderLadder);
  }
  const modeEl = document.getElementById('ladder-mode');
  if (modeEl) modeEl.addEventListener('change', renderLadder);
  const seedEl = document.getElementById('ladder-seed');
  if (seedEl) seedEl.addEventListener('change', renderLadder);
  const reroll = document.getElementById('btn-ladder-reroll');
  if (reroll) {
    reroll.addEventListener('click', () => {
      if (seedEl) seedEl.value = String((Math.random() * 100000) | 0);
      renderLadder();
    });
  }
  const exp = document.getElementById('btn-export-tuning');
  if (exp) exp.addEventListener('click', handleExportTuning);
  const sav = document.getElementById('btn-save-tuning');
  if (sav) sav.addEventListener('click', handleSaveTuningToProject);
  const rst = document.getElementById('btn-reset-tuning');
  if (rst) rst.addEventListener('click', handleResetTuning);

  loadTuningDraft();
  renderBalancePanels();
  renderLadder();
}
