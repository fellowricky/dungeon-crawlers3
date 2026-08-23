/**
 * TRAILER CLOCK — fixed-timestep driver.
 *
 * The whole point: nothing in a trailer render reads wall clock. Every frame
 * advances by exactly `dt`, whether the previous frame took 3ms or 3 seconds.
 * That makes "pause for loading" a non-feature — you simply stop calling
 * `step()`, and because the scene update and the frame capture both live
 * inside that one call, they cannot drift apart.
 *
 * The game code is already built for this: HeroSprite.update(dt) and
 * liveUpdate(time, tt) both take explicit time.
 */
export class Clock {
  constructor(fps = 60) {
    this.fps = fps;
    this.dt = 1 / fps;
    this.t = 0;
    this.frame = 0;
  }

  /** Advance one frame. Returns the delta so callers can pass it straight on. */
  advance() {
    this.t += this.dt;
    this.frame++;
    return this.dt;
  }

  reset() { this.t = 0; this.frame = 0; }

  /** Frame index a given time lands on — used to schedule shot boundaries. */
  frameAt(seconds) { return Math.round(seconds * this.fps); }
}

/**
 * Run a frame loop that yields to the browser between frames (so the page
 * stays responsive and textures can actually finish decoding), but never lets
 * elapsed wall time influence `clock.t`.
 *
 * `onFrame(clock)` may be async — an await inside it stalls the render for as
 * long as it likes at zero cost to the output. That is the load gate.
 * Return `false` from onFrame to stop early.
 */
export async function runFrames(clock, totalFrames, onFrame, { yieldEvery = 1 } = {}) {
  for (let i = 0; i < totalFrames; i++) {
    const cont = await onFrame(clock);
    if (cont === false) return clock.frame;
    clock.advance();
    if (yieldEvery && (i % yieldEvery) === 0) await nextTask();
  }
  return clock.frame;
}

/** Yield to the event loop without tying anything to elapsed time. */
export const nextTask = () => new Promise(r => setTimeout(r, 0));

/** Yield until the browser has painted — used when a real repaint is wanted. */
export const nextPaint = () => new Promise(r => requestAnimationFrame(() => r()));
