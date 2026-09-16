import { describe, it, expect, beforeEach } from 'vitest';

/* Same headless shim the other renderer-touching suites use (see
   camera_spawn_snap.test.js), plus a `window` — boss_cutscene.js registers its
   skip listeners there. */
if (typeof globalThis.document === 'undefined') {
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  const dummyCtx = new Proxy({
    font: '', measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8Array(4) }),
    createImageData: (w = 100, h = 100) => ({ data: new Uint8Array(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} })
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    }
  });
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: { setProperty: () => {} },
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx,
    querySelector: () => dummyEl,
    querySelectorAll: () => [],
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle: () => {}
    },
    appendChild: () => {},
    set innerHTML(_v) { /* the overlay is built by string; nothing to parse here */ },
    textContent: ''
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl,
    querySelectorAll: () => [], body: dummyEl, documentElement: dummyEl
  };
}
/* Record the skip listeners so a test can fire them. */
const listeners = new Map();
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
globalThis.window.addEventListener = (type, fn, opts) => {
  if (!listeners.has(type)) listeners.set(type, new Map());
  listeners.get(type).set(fn, !!(opts && opts.once));
};
globalThis.window.removeEventListener = (type, fn) => {
  if (listeners.has(type)) listeners.get(type).delete(fn);
};
/* Honours { once: true } — without that the grace-window test has no teeth,
   since the bug it guards against is precisely a listener spending itself on
   an input it chose to ignore. */
const fire = type => {
  for (const [fn, once] of Array.from(listeners.get(type) || [])) {
    if (once) listeners.get(type).delete(fn);
    fn();
  }
};

/* Must track the beat lengths in boss_cutscene.js. The hold is derived from the
   boss's own sheet lengths, so a bare fixture (no sprites) gets the floor. */
const T_PUSH = 1.2, D_HOLD_MIN = 3.0, D_WIDE = 1.5, D_OUT = 0.8;
const T_END = T_PUSH + D_HOLD_MIN + D_WIDE + D_OUT;

let mod, camTarget, CAM_BODY_HEIGHT;

/* A boss room 8 units across: party at the door, boss on the far side, two
   escorts flanking it. Enough geometry for the framing maths to be meaningful
   without standing up a real dungeon. */
function makeGame({ cutscene = { kicker: 'k', sub: 's' }, bossHp = 40, fighting = false } = {}) {
  const boss = { x: 8, z: 0, isBoss: true, roomId: 3, data: { hp: bossHp, name: 'Ignis' }, ent: null };
  const escorts = [
    { x: 6.5, z: -1.5, isBoss: false, roomId: 3, data: { hp: 7, name: 'Magmin' }, ent: null },
    { x: 6.5, z: 1.5, isBoss: false, roomId: 3, data: { hp: 7, name: 'Rat' }, ent: null }
  ];
  return {
    state: 'crawl',
    paused: false,
    campAnim: null,
    bossCutscene: null,
    initiative: { active: fighting },
    boss,
    monsters: [boss, ...escorts],
    heroes: [{ x: 0, z: 0, data: { hp: 10 } }, { x: 0, z: 1, data: { hp: 10 } }],
    D: { boss: 3 },
    visitedRooms: { 3: true },
    activeQuest: { id: 'q-1' },
    /* Stamped by the spawner with the encounter the boss was actually built
       from — a quest need not carry a pre-rolled `bossEncounter` at all. */
    bossEncounterUsed: { bossTitle: 'Ignis, Ember-Swarm Chief', description: 'd', cutscene },
    _camDir: {},
    freeCamUntil: 999
  };
}

/** Run the scene to completion in 60fps steps, returning the frames it took. */
function play(game, steps = 600) {
  let n = 0;
  while (game.bossCutscene && n < steps) { mod.updateBossCutscene(game, 1 / 60); n++; }
  return n;
}

beforeEach(async () => {
  mod = await import('../src/game/boss_cutscene.js');
  ({ camTarget } = await import('../src/render/dungeon_scene.js'));
  ({ CAM_BODY_HEIGHT } = await import('../src/game/camera_director.js'));
});

describe('Boss intro cutscene', () => {
  it('arms for every curated encounter, with or without an authored block', () => {
    const withBlock = makeGame();
    expect(mod.checkBossCutscene(withBlock)).toBe(true);
    expect(mod.isBossCutsceneActive(withBlock)).toBe(true);

    /* All 100 encounters carry a bossTitle and a description, so an encounter
       with no authored block still has everything the card needs. */
    const plain = makeGame({ cutscene: null });
    expect(mod.checkBossCutscene(plain)).toBe(true);
    expect(plain.bossCutscene.card.name).toBe('Ignis, Ember-Swarm Chief');
    expect(plain.bossCutscene.card.sub).toBe('d');

    /* No encounter at all means no boss worth announcing. */
    const none = makeGame();
    none.bossEncounterUsed = null;
    expect(mod.checkBossCutscene(none)).toBe(false);
    expect(none.bossCutscene).toBe(null);
  });

  it('needs a living boss and a visited boss room', () => {
    const unvisited = makeGame();
    unvisited.visitedRooms = { 3: false };
    expect(mod.checkBossCutscene(unvisited)).toBe(false);

    /* Intermediate floors carry a `boss` room index but no boss in it. */
    const noBoss = makeGame();
    noBoss.boss = null;
    expect(mod.checkBossCutscene(noBoss)).toBe(false);

    const dead = makeGame({ bossHp: 0 });
    expect(mod.checkBossCutscene(dead)).toBe(false);
  });

  it('never cuts away from a fight already in progress', () => {
    expect(mod.checkBossCutscene(makeGame({ fighting: true }))).toBe(false);
    const paused = makeGame(); paused.paused = true;
    expect(mod.checkBossCutscene(paused)).toBe(false);
    const camping = makeGame(); camping.campAnim = {};
    expect(mod.checkBossCutscene(camping)).toBe(false);
  });

  it('fires once per expedition and claims the boss card so both do not play', () => {
    const g = makeGame();
    mod.checkBossCutscene(g);
    expect(g._bossCardFiredFor).toBe('q-1');
    play(g);
    expect(g.bossCutscene).toBe(null);

    /* Same quest: stays spent. */
    expect(mod.checkBossCutscene(g)).toBe(false);

    /* A later expedition re-arms without needing a reset hook. */
    g.activeQuest = { ...g.activeQuest, id: 'q-2' };
    expect(mod.checkBossCutscene(g)).toBe(true);
  });

  it('falls back to the encounter title and description when the block omits them', () => {
    const g = makeGame({ cutscene: {} });
    mod.checkBossCutscene(g);
    expect(g.bossCutscene.card.name).toBe('Ignis, Ember-Swarm Chief');
    expect(g.bossCutscene.card.sub).toBe('d');
    expect(g.bossCutscene.sfx).toBe('warCry');
  });

  it('runs the full arc on rawDt and releases the crawl', () => {
    const g = makeGame();
    mod.checkBossCutscene(g);
    const frames = play(g);
    /* Fixed-length by construction: ~T_END seconds of 60fps steps, never the
       runaway guard. */
    expect(frames).toBeGreaterThan(T_END * 60 - 2);
    expect(frames).toBeLessThan(T_END * 60 + 2);
    expect(g.bossCutscene).toBe(null);
    /* The director must be handed a clean slate and the frame back. */
    expect(g._camDir.zoomGoal).toBe(null);
    expect(g._camDir.focusGoalX).toBe(null);
    expect(g.freeCamUntil).toBe(0);
  });

  it('pushes in on the boss, then hands the camera back nearer the party', () => {
    const g = makeGame();
    mod.checkBossCutscene(g);
    const boss = g.boss, party = g.bossCutscene.party;

    /* Mid-hold (beat 2) the frame is locked to the boss. */
    while (g.bossCutscene && g.bossCutscene.t < 2.2) mod.updateBossCutscene(g, 1 / 60);
    expect(camTarget.x).toBeCloseTo(boss.x, 3);
    expect(camTarget.z).toBeCloseTo(boss.z, 3);

    /* The last beat drifts back, so the director inherits a camera that is
       already closer to the party than to the boss it just left. */
    play(g);
    const toParty = Math.hypot(camTarget.x - party.x, camTarget.z - party.z);
    const toBoss  = Math.hypot(camTarget.x - boss.x,  camTarget.z - boss.z);
    expect(toParty).toBeLessThan(toBoss);
  });

  it('aims at mid-body, not at the feet, and puts the look-at point back after', () => {
    const g = makeGame();
    mod.checkBossCutscene(g);
    mod.updateBossCutscene(g, 2.0);

    /* screenOffset measures bodies upward from the focus, so aiming at y = 0
       would centre the FLOOR on screen and stand the boss in the upper half —
       which reads as the boss being sunk into the ground. */
    expect(camTarget.y).toBeGreaterThan(0);
    expect(camTarget.y).toBeLessThan(CAM_BODY_HEIGHT);

    mod.endBossCutscene(g);
    expect(camTarget.y).toBe(0);
  });

  it('takes the aim height from the boss sprite, so a rat and a dragon both centre', () => {
    /* mesh.scale.y is the sprite quad's world height, standing on the ground
       plane — half of it is the visual centre. */
    const small = makeGame();
    small.boss.ent = { anim: { mesh: { scale: { y: 1.4 } } }, grp: { scale: { y: 1 } } };
    mod.checkBossCutscene(small);
    expect(small.bossCutscene.aim).toBeCloseTo(0.7, 5);

    const huge = makeGame();
    huge.boss.ent = { anim: { mesh: { scale: { y: 6.0 } } }, grp: { scale: { y: 1 } } };
    mod.checkBossCutscene(huge);
    expect(huge.bossCutscene.aim).toBeCloseTo(3.0, 5);

    /* The enlarged status scales the group, and that has to count. */
    const big = makeGame();
    big.boss.ent = { anim: { mesh: { scale: { y: 2.0 } } }, grp: { scale: { y: 1.5 } } };
    mod.checkBossCutscene(big);
    expect(big.bossCutscene.aim).toBeCloseTo(1.5, 5);

    /* A sprite with no layout yet falls back rather than aiming into the floor. */
    const bare = makeGame();
    mod.checkBossCutscene(bare);
    expect(bare.bossCutscene.aim).toBeCloseTo(CAM_BODY_HEIGHT * 0.5, 5);
  });

  it('holds on one whole idle cycle, then strikes, then idles out the shot', () => {
    /* 8 frames at 8fps = a 1.0s idle cycle; 5 at 10fps = a 0.5s attack. */
    const sheets = { idle:   { cfg: { cols: 8, rows: 1, fps: 8, loop: true } },
                     attack: { cfg: { cols: 5, rows: 1, fps: 10 } } };
    const g = makeGame();
    const played = [];
    g.boss.ent = { anim: { textures: sheets, mesh: { scale: { y: 2 } },
                           play: (a, force) => played.push([a, !!force]) },
                   grp: { scale: { y: 1 } } };
    mod.checkBossCutscene(g);

    /* Settled to idle up front, so the push-in never opens on a stray pose
       left over from whatever the boss was doing. */
    expect(played).toEqual([['idle', true]]);
    played.length = 0;

    /* The strike waits out one full idle cycle, measured off the sheet, and
       the hold is sized to contain the whole sequence rather than clipping it. */
    expect(g.bossCutscene.strikeAt).toBeCloseTo(T_PUSH + 1.0, 5);
    expect(g.bossCutscene.tRoar - g.bossCutscene.tPush).toBeCloseTo(D_HOLD_MIN, 5);   // 1.5s of sheets, floored

    /* Beat 1 is the push; nothing is cued on the boss yet. */
    mod.updateBossCutscene(g, T_PUSH - 0.05);
    expect(played).toEqual([]);

    /* Entering the hold restarts idle from frame 0 so the cycle reads whole. */
    mod.updateBossCutscene(g, 0.1);
    expect(played).toEqual([['idle', true]]);

    /* Still idling most of a cycle later — the strike has not landed. */
    mod.updateBossCutscene(g, 0.8);
    expect(played).toEqual([['idle', true]]);

    /* Past the cycle it strikes, exactly once. */
    mod.updateBossCutscene(g, 0.2);
    expect(played).toEqual([['idle', true], ['attack', true]]);
    mod.updateBossCutscene(g, 0.5);
    expect(played).toEqual([['idle', true], ['attack', true]]);
    /* No idle cue afterwards: the animator returns a finished one-shot to idle
       by itself, and re-cueing would restart the loop every frame. */
  });

  it('grows the hold to fit long sheets instead of clipping the idle', () => {
    /* Ignis's real numbers: a 2.4s idle and a 1.6s attack — four seconds of
       animation, which a fixed 3s hold would have cut off mid-idle. */
    const g = makeGame();
    g.boss.ent = { anim: { textures: { idle:   { cfg: { cols: 12, rows: 1, fps: 5, loop: true } },
                                       attack: { cfg: { cols: 8,  rows: 1, fps: 5 } } },
                           mesh: { scale: { y: 2 } }, play: () => {} },
                   grp: { scale: { y: 1 } } };
    mod.checkBossCutscene(g);
    const s = g.bossCutscene;
    /* The hold is exactly idle + attack — no padding. The closing idle plays
       over the pull-back, so the sequence still reads idle -> attack -> idle. */
    expect(s.tRoar - s.tPush).toBeCloseTo(2.4 + 1.6, 5);
    /* A WHOLE idle plays before the strike, and the strike ends exactly as the
       camera leaves — a safety margin here would eat the idle it protects. */
    expect(s.strikeAt).toBeCloseTo(T_PUSH + 2.4, 5);
    expect(s.strikeAt + 1.6).toBeCloseTo(s.tRoar, 5);
  });

  it('caps a pathological sheet, and still finishes the strike before the cut', () => {
    const g = makeGame();
    g.boss.ent = { anim: { textures: { idle:   { cfg: { cols: 30, rows: 1, fps: 1, loop: true } },
                                       attack: { cfg: { cols: 4,  rows: 1, fps: 8 } } },
                           mesh: { scale: { y: 2 } }, play: () => {} },
                   grp: { scale: { y: 1 } } };
    mod.checkBossCutscene(g);
    const s = g.bossCutscene;
    expect(s.tRoar - s.tPush).toBeCloseTo(6.0, 5);      // D_HOLD_MAX
    expect(s.strikeAt).toBeGreaterThan(s.tPush);
    expect(s.strikeAt + 0.5).toBeLessThanOrEqual(s.tRoar);
  });

  it('falls back to a beat when the boss has no sheets to measure', () => {
    const g = makeGame();          // bare boss, no ent
    mod.checkBossCutscene(g);
    expect(g.bossCutscene.strikeAt).toBeCloseTo(T_PUSH + 0.9, 5);
    expect(g.bossCutscene.tEnd).toBeCloseTo(T_END, 5);
  });

  it('sizes the close-up to the boss, so a rat and a dragon both fill the frame', () => {
    const sprite = y => ({ anim: { mesh: { scale: { y } } }, grp: { scale: { y: 1 } } });
    const zoomFor = h => {
      const g = makeGame();
      g.boss.ent = sprite(h);
      mod.checkBossCutscene(g);
      return g.bossCutscene.closeZoom;
    };
    const small = zoomFor(1.4), mid = zoomFor(2.0), huge = zoomFor(6.0);

    /* Taller boss, wider shot — the framing tracks the creature, not a constant. */
    expect(small).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(huge);

    /* Each covers the same share of the frame: body*cos(pitch) over the frame
       height 2*BASE_HALF/zoom. Within the clamps this is exactly CLOSE_FILL. */
    const share = (h, z) => (h * Math.cos(0.52)) / ((2 * 55) / z);
    expect(share(2.0, mid)).toBeCloseTo(share(6.0, huge), 4);
    expect(share(2.0, mid)).toBeGreaterThan(0.5);

    /* And it stays past the gameplay ceiling, which is the whole point. */
    expect(mid).toBeGreaterThan(14);
  });

  it('measures the reveal about the aim point, so it does not pull needlessly wide', () => {
    const g = makeGame();
    mod.checkBossCutscene(g);
    const group = [g.boss, ...g.monsters.filter(m => m !== g.boss)];
    const aimed  = mod.extentAboutAim(group, g.boss.x, g.boss.z, 0.8, 0.52, CAM_BODY_HEIGHT);
    const ground = mod.extentAboutAim(group, g.boss.x, g.boss.z, 0.8, 0.52, CAM_BODY_HEIGHT, 0);
    /* Straddling the centre line halves the vertical reach a body demands. */
    expect(aimed.hy).toBeLessThan(ground.hy);
  });

  it('frames the escorts alongside the boss on the reveal, not just the boss', () => {
    const g = makeGame();
    mod.checkBossCutscene(g);
    const w = g.bossCutscene.wide;
    /* Centroid of boss + two flanking escorts sits short of the boss itself. */
    expect(w.x).toBeLessThan(g.boss.x);
    expect(w.x).toBeGreaterThan(6);
    /* Pulled back from the close-up (zoom is "tighter is bigger"). */
    expect(w.zoom).toBeLessThan(13.0);
  });

  it('bails out if the boss dies mid-scene', () => {
    const g = makeGame();
    mod.checkBossCutscene(g);
    mod.updateBossCutscene(g, 0.5);
    g.boss.data.hp = 0;
    mod.updateBossCutscene(g, 1 / 60);
    expect(g.bossCutscene).toBe(null);
  });

  it('ignores input already in flight when the room opened, then stays skippable', async () => {
    const g = makeGame();
    mod.checkBossCutscene(g);

    /* A camera drag or potion key the player had already committed to lands in
       the first frames. It must not kill a scene they have not seen yet. */
    fire('pointerdown');
    expect(g.bossCutscene).not.toBe(null);
    fire('keydown');
    expect(g.bossCutscene).not.toBe(null);

    /* Past the grace window a deliberate input skips. Registering the listener
       with { once: true } would have spent it above and left the scene
       unskippable for the rest of its run. */
    await new Promise(r => setTimeout(r, 550));
    fire('pointerdown');
    expect(g.bossCutscene).toBe(null);
  });

  it('can be skipped outright, mid-move', () => {
    const g = makeGame();
    mod.checkBossCutscene(g);
    mod.updateBossCutscene(g, 1.0);
    mod.endBossCutscene(g);
    expect(g.bossCutscene).toBe(null);
    /* A second call is a no-op rather than a throw. */
    expect(() => mod.endBossCutscene(g)).not.toThrow();
  });
});
