import { describe, it, expect } from 'vitest';
import { projectVec, REVEAL_MAX_SECONDS } from '../src/game/initiative_reveal.js';

/* A camera whose matrices are identity: world coords pass through as NDC, which
   makes the expected viewport pixels trivially checkable by hand. */
const identityCam = {
  matrixWorldInverse: { elements: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] },
  projectionMatrix:   { elements: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] },
};
const canvas = (w = 800, h = 600, left = 0, top = 0) => ({
  getBoundingClientRect: () => ({ left, top, width: w, height: h }),
});

describe('initiative reveal — world→screen projection', () => {
  it('puts the world origin at the centre of the canvas', () => {
    const p = projectVec(identityCam, canvas(), 0, 0, 0);
    expect(p.x).toBeCloseTo(400, 5);
    expect(p.y).toBeCloseTo(300, 5);
  });

  it('maps +x right and +y UP the screen (y is flipped vs NDC)', () => {
    const right = projectVec(identityCam, canvas(), 0.5, 0, 0);
    const up    = projectVec(identityCam, canvas(), 0, 0.5, 0);
    expect(right.x).toBeGreaterThan(400);
    expect(up.y).toBeLessThan(300);          // smaller y = higher on screen
  });

  it('respects a canvas that is not at the viewport origin', () => {
    const p = projectVec(identityCam, canvas(800, 600, 100, 50), 0, 0, 0);
    expect(p.x).toBeCloseTo(500, 5);
    expect(p.y).toBeCloseTo(350, 5);
  });

  it('returns null rather than NaN coordinates when w is degenerate', () => {
    const degenerate = {
      matrixWorldInverse: identityCam.matrixWorldInverse,
      projectionMatrix: { elements: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,0] },
    };
    expect(projectVec(degenerate, canvas(), 1, 1, 1)).toBeNull();
  });

  it('returns null on a camera with no matrices instead of throwing', () => {
    expect(projectVec({}, canvas(), 0, 0, 0)).toBeNull();
    expect(projectVec(identityCam, { getBoundingClientRect: () => ({ left:0, top:0, width:0, height:0 }) }, 0, 0, 0))
      .not.toBeNull();   // a zero-size canvas is degenerate but not an error
  });
});

describe('initiative reveal — timing budget', () => {
  it('is bounded, so a fight can never be held open by the ceremony', () => {
    expect(REVEAL_MAX_SECONDS).toBeGreaterThan(0);
    expect(REVEAL_MAX_SECONDS).toBeLessThanOrEqual(8);   // generous, but still bounded
  });
});
