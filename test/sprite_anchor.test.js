import { describe, it, expect } from 'vitest';

/* A canvas stub that "draws" a synthetic sheet: drawImage records the source
   rect, getImageData paints an opaque block wherever the fake image says the
   body is in that cell. Lets the anchor maths run without a real canvas. */
function installCanvasStub() {
  let drawn = null;
  const ctx = {
    drawImage: (img, sx, sy, sw, sh) => { drawn = { img, sx, sy, sw, sh }; },
    getImageData: (x, y, w, h) => {
      const data = new Uint8ClampedArray(w * h * 4);
      const cellCol = drawn.sx / drawn.sw, cellRow = drawn.sy / drawn.sh;
      const body = drawn.img.bodies[`${cellCol},${cellRow}`];
      if (body) {
        for (let yy = body.y0; yy <= body.y1; yy++)
          for (let xx = body.x0; xx <= body.x1; xx++) data[(yy * w + xx) * 4 + 3] = 255;
      }
      return { data };
    }
  };
  globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
}
installCanvasStub();

const { measureFrameAnchor, resolveAtlasAnchor, applyAtlasAnchor } = await import('../src/game/sprite_atlas.js');

/* 4-col x 1-row sheet of 100px frames. Frame 0's body is 20px wide, spanning
   x 30..49 (centre 40 -> 0.40), feet on row 89 (10 rows of padding -> 0.10). */
const sheet = { width: 400, height: 100, bodies: { '0,0': { x0: 30, x1: 49, y0: 20, y1: 89 }, '2,0': { x0: 60, x1: 79, y0: 20, y1: 94 } } };
const cfg = () => ({ frameWidth: 100, frameHeight: 100, cols: 4, rows: 1 });

describe('sprite body anchor', () => {
  it('measures the body centroid and foot line of the first playback frame', () => {
    const a = measureFrameAnchor(sheet, cfg());
    expect(a.x).toBeCloseTo(0.40, 5);
    expect(a.y).toBeCloseTo(0.10, 5);
  });

  it('honours an explicit frame sequence: the first entry is "frame 0"', () => {
    const a = measureFrameAnchor(sheet, { ...cfg(), frames: [2, 3, 2] });
    expect(a.x).toBeCloseTo(0.70, 5);
    expect(a.y).toBeCloseTo(0.05, 5);
  });

  it('returns null for an empty frame rather than anchoring on nothing', () => {
    expect(measureFrameAnchor(sheet, { ...cfg(), frames: [1] })).toBeNull();
  });

  it('anchors every state on the idle sheet when frame sizes match', () => {
    const textures = {
      idle:   { cfg: { ...cfg(), anchor: { x: 0.40, y: 0.10 } } },
      attack: { cfg: { ...cfg(), anchor: { x: 0.55, y: 0.02 } } }
    };
    expect(resolveAtlasAnchor(textures, 'attack')).toEqual({ x: 0.40, y: 0.10 });
    expect(resolveAtlasAnchor(textures, 'idle')).toEqual({ x: 0.40, y: 0.10 });
  });

  it('falls back to a sheet\'s own anchor when its frame size differs from idle', () => {
    const textures = {
      idle:   { cfg: { ...cfg(), anchor: { x: 0.40, y: 0.10 } } },
      attack: { cfg: { ...cfg(), frameWidth: 160, anchor: { x: 0.55, y: 0.02 } } }
    };
    expect(resolveAtlasAnchor(textures, 'attack')).toEqual({ x: 0.55, y: 0.02 });
  });

  it('lets authored anchorX / anchorY override the measurement', () => {
    const textures = { idle: { cfg: { ...cfg(), anchor: { x: 0.40, y: 0.10 }, anchorY: 27 / 96 } } };
    expect(resolveAtlasAnchor(textures, 'idle')).toEqual({ x: 0.40, y: 27 / 96 });
  });

  it('mirrors the x anchor with the UV flip so the body stays on the tile', () => {
    const mesh = { center: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } } };
    applyAtlasAnchor(mesh, { x: 0.40, y: 0.10 }, false);
    expect(mesh.center.x).toBeCloseTo(0.40);
    applyAtlasAnchor(mesh, { x: 0.40, y: 0.10 }, true);
    expect(mesh.center.x).toBeCloseTo(0.60);
    expect(mesh.center.y).toBeCloseTo(0.10);
  });
});
