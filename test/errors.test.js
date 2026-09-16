import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reportError, onError, errorCounts, resetErrorCounts, installGlobalErrorHandlers } from '../src/game/errors.js';

/* The game used to swallow its errors; this is the channel that makes them
   visible. What matters: listeners hear the first occurrence, repeats fold so
   a frame-loop bug cannot flood the log, warnings stay console-only, and the
   global handlers catch what nobody wrapped. */
describe('error surfacing', () => {
  beforeEach(() => {
    resetErrorCounts();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('notifies listeners on the first occurrence and folds repeats', () => {
    const heard = [];
    const off = onError((where, err, n) => heard.push([where, err.message, n]));
    const err = new Error('boom');
    for (let i = 0; i < 120; i++) reportError('frame loop', err);
    off();
    expect(heard.map(h => h[2])).toEqual([1, 50, 100]);
    expect(heard[0]).toEqual(['frame loop', 'boom', 1]);
    expect(console.error).toHaveBeenCalledTimes(3);
    expect(errorCounts().get('frame loop: boom')).toBe(120);
  });

  it('warn-level reports go to the console once and never to listeners', () => {
    const fn = vi.fn();
    const off = onError(fn);
    reportError('nixie warmup', new Error('no canvas'), 'warn');
    reportError('nixie warmup', new Error('no canvas'), 'warn');
    off();
    expect(fn).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('a broken listener cannot break the reporter', () => {
    const off1 = onError(() => { throw new Error('listener bug'); });
    const good = vi.fn();
    const off2 = onError(good);
    expect(() => reportError('x', new Error('y'))).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    off1(); off2();
  });

  it('accepts strings and nullish throwables', () => {
    const heard = [];
    const off = onError((w, e) => heard.push(e));
    reportError('a', 'plain string');
    reportError('b', undefined);
    off();
    expect(errorCounts().has('a: plain string')).toBe(true);
    expect(errorCounts().has('b: unknown error')).toBe(true);
  });

  it('global handlers route uncaught errors and rejections through the reporter', () => {
    const handlers = {};
    const fakeWindow = { addEventListener: (type, fn) => { handlers[type] = fn; } };
    installGlobalErrorHandlers(fakeWindow);
    const heard = [];
    const off = onError((where) => heard.push(where));
    handlers.error({ error: new Error('tick blew up'), filename: 'http://x/src/game/game.js', lineno: 1664 });
    handlers.unhandledrejection({ reason: new Error('load failed') });
    off();
    expect(heard).toEqual(['uncaught (game.js:1664)', 'unhandled promise']);
  });
});
