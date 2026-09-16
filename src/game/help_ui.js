/**
 * How to play — the game explained inside the game.
 *
 * This is a dense game (SRD 5.1 rules, initiative, concentration, spell slots,
 * a guild, quest chains, skill challenges, two control modes and a handful of
 * hotkeys) and until now the only explanation of any of it was the README,
 * written for developers. Three tabs: the loop, combat in plain words, and
 * the keys — plus one-time tips that fire the first time a system appears
 * (see `firstRunTip`). Everything here describes what the code actually does;
 * when a rule changes, change the sentence.
 *
 * Same overlay pattern as options_ui.js: a host node owned here, shown with
 * a class, Escape/backdrop dismiss.
 */

import { getSetting, setSetting } from './settings.js';

const $ = id => (typeof document === 'undefined' ? null : document.getElementById(id));

export const HELP_TABS = [
  {
    key: 'loop', label: 'The loop',
    html: `
      <p><b>Your company crawls on its own.</b> Pick a quest on the world map, and the party
      explores the floor, fights what it meets, opens chests and finds the stairs. You watch,
      and you decide the things that matter: gear, level-ups, who leads, when to rest.</p>
      <h4>A run</h4>
      <ul>
        <li><b>Floors.</b> A quest is several floors. Clearing one is a <b>long rest</b>: full HP and every spell slot back.</li>
        <li><b>Shrines</b> on a floor are a <b>short rest</b>: Second Wind, Action Surge, Ki, Warlock slots and short-rest features return.</li>
        <li><b>Chests</b> spin the loot wheel. The item's <b>Power Score</b> (PS) is the quick comparison — the tooltip shows the full delta against what is equipped.</li>
        <li><b>Skill challenges</b> are the non-combat rooms: pick an approach, the best-suited hero rolls. Options can automate them.</li>
        <li><b>Downed heroes</b> stagger back up at 30% HP once the fight ends (any healing brings them up mid-fight). If everyone drops, the run is over.</li>
      </ul>
      <h4>Between runs — the Guild</h4>
      <ul>
        <li><b>Facilities</b> level up from materials and essences; assign heroes from the tavern to staff them.</li>
        <li><b>Doctrines</b> and <b>slaying orders</b> are company-wide stances you choose, not passive luck.</li>
        <li><b>The armoury</b> stores gear across runs; <b>runes</b> are crafted there.</li>
      </ul>
      <h4>Two ways to play</h4>
      <p><b>Auto</b> lets the heroes' AI take every turn — tune it per hero on the Party screen's
      <i>AI Priorities</i> tab. <b>Manual</b> (press <kbd>M</kbd>) pauses on each hero's turn until you act.
      Switch at any time, even mid-fight.</p>`
  },
  {
    key: 'combat', label: 'Combat',
    html: `
      <p>Fights use the SRD 5.1 rules, one turn at a time in <b>initiative</b> order (a d20 + DEX for
      heroes). Every combatant gets a <b>move</b>, an <b>action</b> and a <b>bonus action</b> each turn.</p>
      <h4>Hitting things</h4>
      <ul>
        <li><b>To hit:</b> d20 + proficiency + ability modifier against the target's <b>AC</b>. A natural 20 always hits and <b>crits</b> (doubled dice); a natural 1 always misses.</li>
        <li><b>Advantage</b> rolls two d20 and keeps the best; <b>disadvantage</b> keeps the worst. Blinded, restrained and paralysed targets grant advantage; a prone or poisoned attacker rolls at disadvantage.</li>
        <li>In manual mode, hovering a target shows the <b>hit chance, crit chance and damage range</b> before you commit — and why.</li>
        <li><b>Extra Attack</b> (fighters, rangers, paladins, barbarians from 5th level) swings twice per action; a second weapon in the off hand adds a bonus-action strike.</li>
      </ul>
      <h4>Moving</h4>
      <ul>
        <li>One square is <b>5 ft</b>. Speed 30 ft = 6 squares. Diagonals alternate 5 / 10 ft.</li>
        <li>Leaving a square a melee enemy threatens <b>provokes an opportunity attack</b>. Those squares glow <span style="color:#ff7a6a">red</span> on your turn; <b>Disengage</b> makes you safe to leave. <b>Dash</b> doubles movement; <b>Dodge</b> gives attackers disadvantage.</li>
      </ul>
      <h4>Magic</h4>
      <ul>
        <li><b>Cantrips</b> are free and unlimited; <b>leveled spells</b> spend a slot of that level or higher (upcasting).</li>
        <li><b>Concentration</b> spells (Bless, Haste, Moonbeam…) last while the caster keeps them up: one at a time, and taking damage forces a CON save to hold on.</li>
        <li>Spells that ask for a <b>saving throw</b> ignore AC — the target rolls against the caster's DC. Halved damage on a success where the spell says so.</li>
      </ul>
      <h4>The pace</h4>
      <p>Combat runs at the speed in Options (0.7× by default). The game waits for a blow to land
      before the next actor moves, and dwells a beat longer on crits and kills so you can read what happened.</p>`
  },
  {
    key: 'keys', label: 'Keys',
    html: `
      <table class="help-keys">
        <tr><td><kbd>M</kbd></td><td>Switch Auto / Manual control</td></tr>
        <tr><td><kbd>E</kbd></td><td>End the current hero's turn (manual)</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Cancel targeting or a queued move; close a panel</td></tr>
        <tr><td><kbd>Space</kbd></td><td>Pause / resume while exploring</td></tr>
        <tr><td><kbd>L</kbd></td><td>Cycle the party leader (who the others follow)</td></tr>
        <tr><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></td><td>Drink a healing / greater / superior potion</td></tr>
        <tr><td><kbd>I</kbd></td><td>Party screen — equipment &amp; bag</td></tr>
        <tr><td><kbd>K</kbd></td><td>Party screen — attributes &amp; level-up points</td></tr>
        <tr><td><kbd>F3</kbd></td><td>Performance readout</td></tr>
        <tr><td><b>Mouse</b></td><td>Drag to pan · right-drag (or Shift-drag) to orbit · wheel to zoom. The camera hands control back for a few seconds after you touch it.</td></tr>
      </table>
      <h4>Manual mode, in one line each</h4>
      <ul>
        <li><b>Move:</b> click a floor square — the path and its cost show as you hover; red squares provoke.</li>
        <li><b>Attack:</b> click a monster, or pick a weapon option from the Action menu and then a target.</li>
        <li><b>Spells:</b> Action → Spells &amp; Magic → tier → spell, then click the target or area. Magic Missile asks for each dart.</li>
        <li><b>Thrown gear:</b> acid, alchemist's fire, bolas and the like sit in the trinket slot and show up under Spells &amp; Magic for <i>any</i> hero — no caster needed. When the last one is used, the next from the bag is readied.</li>
        <li><b>Bonus actions</b> live under the Bonus button: off-hand attacks, Second Wind, Rage, Flurry, potions.</li>
      </ul>`
  }
];

let _escBound = false;

function host() {
  if (typeof document === 'undefined') return null;
  let ov = $('help-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'help-overlay';
    document.body.appendChild(ov);
  }
  return ov;
}

export function openHelp(tabKey = 'loop') {
  const ov = host();
  if (!ov) return;
  const tab = HELP_TABS.find(t => t.key === tabKey) || HELP_TABS[0];
  ov.innerHTML = `<div class="opt-panel help-panel">
    <h2 class="opt-title">How to play</h2>
    <div class="help-tabs">
      ${HELP_TABS.map(t => `<button class="help-tab${t.key === tab.key ? ' on' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div class="help-body">${tab.html}</div>
    <div class="opt-actions">
      <button id="help-close" class="btn primary">↩ Back</button>
    </div>
  </div>`;
  ov.classList.add('show');
  ov.querySelectorAll('.help-tab').forEach(b => b.addEventListener('click', () => openHelp(b.dataset.tab)));
  const close = ov.querySelector('#help-close');
  if (close) close.addEventListener('click', closeHelp);
  ov.addEventListener('click', e => { if (e.target === ov) closeHelp(); });
  if (!_escBound) {
    _escBound = true;
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('show')) closeHelp(); });
  }
}

export function closeHelp() {
  const ov = $('help-overlay');
  if (ov) ov.classList.remove('show');
}

/* ---------------- first-run tips ----------------
   One sentence, once, the first time a system shows up. Remembered in the
   settings blob (`seenTips`) so a reinstall shows them again and a veteran
   never sees them twice. The tip is a combat-log line plus a short toast. */
export const TIPS = {
  initiative: 'First fight: everyone rolled initiative. Turns go in that order — press M any time to take the wheel yourself.',
  manual: 'Manual mode: click a square to move, a monster to attack. Hover to see hit chances; red squares provoke attacks when you leave them. E ends the turn.',
  concentration: 'That spell needs concentration: it lasts while the caster keeps it up, one at a time, and taking damage can break it.',
  shrine: 'A shrine is a short rest — Second Wind, Ki, Warlock slots and short-rest features come back. Long rests happen when a floor is cleared.',
  chest: 'The loot wheel: the item’s Power Score is the quick read. Open the Party screen (I) to compare it against what is equipped.',
  guild: 'The Guild is where a company grows between runs: facilities, doctrines and the armoury all persist even when a run ends.',
  levelUp: 'A hero has points to spend. Press K for the attributes tab — the Party button pulses while something is waiting.'
};

let _showTip = null;
/** The UI registers how a tip is shown (toast + log). */
export function onTip(fn) { _showTip = fn; }

/** Show `key`'s tip if it has never been shown. Returns true when it fired. */
export function firstRunTip(key) {
  const text = TIPS[key];
  if (!text) return false;
  const seen = getSetting('seenTips') || {};
  if (seen[key]) return false;
  setSetting('seenTips', { ...seen, [key]: true });
  if (_showTip) _showTip(key, text);
  return true;
}
