/* ─────────────── Party cohesion band ───────────────
 * The leader hard-stops when a follower strays past COHESION_HOLD_DIST and
 * resumes once the party is back inside COHESION_RESUME_DIST. The gap between
 * the two is a hysteresis dead band: while strayMax sits inside it the leader
 * keeps doing whatever it was doing.
 *
 * That band was 3.5..6.0, which is far wider than the formation the party is
 * trying to hold (deepest slot ~2.5 tiles). Instrumenting the real exploreAI
 * over 20 generated dungeons, 95 of 99 leader freezes were cohesion holds with
 * the leader standing in completely open ground and a valid path — and 54 of
 * those were still holding at a stray distance already back inside HOLD,
 * because the release needed a much tighter regroup than the party ever forms.
 * Narrowing the band cut measured freezes ~41% with no loss of exploration.
 */
import { describe, it, expect } from 'vitest';
import {
  COHESION_HOLD_DIST, COHESION_RESUME_DIST, COHESION_SLOW_DIST,
  FORMATION_SPACING, FORMATION_WIDTH
} from '../src/game/constants.js';

/** Deepest follower slot, mirroring exploreMethods.getFormationSlot. */
function deepestFormationSlotDistance(followers = 3) {
  let worst = 0;
  for (let index = 0; index < followers; index++) {
    const rank = Math.floor(index / 2);
    const behind = FORMATION_SPACING * (rank + 1);
    const lateral = FORMATION_WIDTH * (rank * 0.5 + 1);
    worst = Math.max(worst, Math.hypot(behind, lateral));
  }
  return worst;
}

describe('Cohesion thresholds', () => {
  it('orders slow < resume < hold', () => {
    expect(COHESION_SLOW_DIST).toBeLessThan(COHESION_RESUME_DIST);
    expect(COHESION_RESUME_DIST).toBeLessThan(COHESION_HOLD_DIST);
  });

  it('releases the hold at a distance the party actually forms up at', () => {
    // If RESUME sat below the formation's own depth the leader would wait for a
    // regroup tighter than its formation, i.e. effectively for the hold cap to
    // expire, every single time.
    const formation = deepestFormationSlotDistance();
    expect(formation).toBeLessThan(COHESION_RESUME_DIST);
  });

  it('keeps the dead band narrow enough not to strand the leader', () => {
    // The whole point of the fix: the gap the party has to close before the
    // leader moves again stays small relative to the trigger.
    const band = COHESION_HOLD_DIST - COHESION_RESUME_DIST;
    expect(band).toBeGreaterThan(0);              // still hysteretic — no flapping
    expect(band).toBeLessThanOrEqual(1.5);
  });

  it('still slows the leader before it stops it', () => {
    expect(COHESION_SLOW_DIST).toBeLessThan(COHESION_HOLD_DIST);
  });
});
