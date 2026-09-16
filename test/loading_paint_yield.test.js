import { describe, it, expect, vi, afterEach } from 'vitest';
import { nextPaint } from '../src/ui/loading_screen.js';

const originalRaf = globalThis.requestAnimationFrame;

afterEach(() => {
  globalThis.requestAnimationFrame = originalRaf;
  vi.useRealTimers();
});

describe('nextPaint — the feedback guarantee', () => {
  /* One rAF hands the thread back BEFORE the coming paint, so blocking work
     started there still blocks the frame it was meant to wait for. Two is the
     minimum that lands after a committed paint — this is the whole fix. */
  it('waits for two animation frames, not one', async () => {
    let depth = 0;
    let resolvedAt = -1;
    globalThis.requestAnimationFrame = (cb) => {
      const d = ++depth;
      setTimeout(() => cb(d), 0);
      return d;
    };
    const p = nextPaint().then(() => { resolvedAt = depth; });
    await p;
    expect(resolvedAt).toBe(2);
  });

  it('resolves rather than stranding the caller when rAF never fires', async () => {
    vi.useFakeTimers();
    globalThis.requestAnimationFrame = () => 1;   // registered, never called
    let settled = false;
    const p = nextPaint().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(settled).toBe(true);
  });

  it('resolves only once even if both rAF and the timeout fire', async () => {
    let resolutions = 0;
    globalThis.requestAnimationFrame = (cb) => { setTimeout(cb, 0); return 1; };
    await nextPaint().then(() => { resolutions++; });
    await new Promise(r => setTimeout(r, 150));   // let the safety timeout land too
    expect(resolutions).toBe(1);
  });

  it('degrades to a resolved promise where rAF does not exist at all', async () => {
    globalThis.requestAnimationFrame = undefined;
    await expect(nextPaint()).resolves.toBeUndefined();
  });
});
