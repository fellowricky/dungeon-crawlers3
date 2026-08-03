/**
 * Boss reveal card — a purely cosmetic cinematic banner shown the first time
 * the party sets foot in a story mission's boss room.
 *
 * Deliberately non-blocking: it does NOT pause the crawl or touch game state,
 * because the crawl is an idle loop the player may be watching unattended. It
 * fades itself out after a beat, and a click dismisses it early.
 *
 * Driven by two fields on the story mission (see story.js):
 *   bossArt:      './art/<file>.webp'   — required, or nothing fires
 *   bossArtLabel: 'short epithet'       — optional line under the name
 */

const HOLD_MS = 5200;

let root = null;
let hideTimer = null;

function ensureDom() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'boss-card';
  root.innerHTML = `
    <div class="bc-frame">
      <div class="bc-art" id="bc-art"></div>
      <div class="bc-caption">
        <div class="bc-kicker" id="bc-kicker"></div>
        <div class="bc-name" id="bc-name"></div>
        <div class="bc-label" id="bc-label"></div>
      </div>
    </div>`;
  document.body.appendChild(root);
  root.addEventListener('click', dismiss);
}

function dismiss() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (root) root.classList.remove('show');
}

/** Show the reveal for `mission`. No-op if the mission has no boss art. */
export function showBossCard(mission, bossName) {
  if (!mission || !mission.bossArt) return false;
  ensureDom();
  root.querySelector('#bc-art').style.backgroundImage = `url("${mission.bossArt}")`;
  root.querySelector('#bc-kicker').textContent = 'The way down is blocked by';
  root.querySelector('#bc-name').textContent = bossName || 'something waiting';
  root.querySelector('#bc-label').textContent = mission.bossArtLabel || '';
  root.classList.add('show');
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(dismiss, HOLD_MS);
  return true;
}

/**
 * Per-frame check: fire the reveal once, the first time the boss room of a
 * story mission is visited. Safe to call every frame.
 */
export function checkBossReveal(game) {
  if (!game || game.state !== 'crawl') return;
  const q = game.activeQuest;
  if (!q || !q.bossArt) return;
  /* Keyed by quest id rather than a bare flag, so starting a different
     expedition re-arms the reveal without needing a separate reset hook. */
  if (game._bossCardFiredFor === q.id) return;

  /* Intermediate floors also have a `boss` room index, so the room alone is
     not enough — require an actual living boss monster on this floor. */
  if (!game.boss || !game.boss.data || game.boss.data.hp <= 0) return;
  const bossRoom = game.D && game.D.boss;
  if (bossRoom === undefined || !game.visitedRooms || !game.visitedRooms[bossRoom]) return;

  game._bossCardFiredFor = q.id;
  showBossCard(q, q.finalBossName);
}

/** Clear the fired state so the card can show again on a later expedition. */
export function resetBossCard(game) {
  if (game) game._bossCardFiredFor = null;
  dismiss();
}
