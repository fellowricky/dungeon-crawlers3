/**
 * PROCEDURAL PIXEL-STYLE VFX GENERATOR
 * Authentic 16-bit pixel-art visual effects, shockwaves, psychic ripples,
 * hazard fields, ability auras, and impact slashes generated procedurally onto
 * pixel-grid canvas textures with NearestFilter sampling and Bayer dithering.
 */
import * as THREE from 'three';

const BAYER_4X4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5]
];

/** Check if pixel at (x, y) with normalized intensity [0..1] passes Bayer 4x4 dither threshold */
export function bayerDither(x, y, alpha) {
  if (alpha <= 0) return false;
  if (alpha >= 1) return true;
  const bx = (Math.abs(Math.floor(x))) % 4;
  const by = (Math.abs(Math.floor(y))) % 4;
  const threshold = (BAYER_4X4[by][bx] + 0.5) / 16.0;
  return alpha >= threshold;
}

/** Converts hex integer (0xRRGGBB) or CSS string to RGBA components */
export function parseColor(c, alpha = 1.0) {
  if (typeof c === 'number') {
    return {
      r: (c >> 16) & 255,
      g: (c >> 8) & 255,
      b: c & 255,
      a: alpha
    };
  }
  if (typeof c === 'string' && c.startsWith('#')) {
    const num = parseInt(c.slice(1), 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
      a: alpha
    };
  }
  return { r: 255, g: 255, b: 255, a: alpha };
}

/** Formats RGBA components into CSS string */
function toRgbaStr(col, alpha = 1.0) {
  return `rgba(${Math.round(col.r)},${Math.round(col.g)},${Math.round(col.b)},${Math.max(0, Math.min(1, alpha))})`;
}

/** Linear interpolation between two RGB colors */
function lerpColor(c1, c2, t) {
  return {
    r: c1.r + (c2.r - c1.r) * t,
    g: c1.g + (c2.g - c1.g) * t,
    b: c1.b + (c2.b - c1.b) * t
  };
}

/**
 * Procedural Pixel Effect Presets & Draw Routines
 */
export const PIXEL_VFX_PRESETS = {
  /**
   * Gibbering / Aberrant Psychic Ripple:
   * Chaotic undulating psychic wave with shifting harmonic frequencies,
   * aberrant eye/mouth motes, and amethyst/magenta madness halos.
   */
  gibbering(ctx, size, progress, opts = {}) {
    const cx = size / 2, cy = size / 2;
    const maxR = (size / 2) - 2;
    const currentR = maxR * Math.min(1.0, progress * 1.25);
    const waveT = progress * Math.PI * 4;

    const baseCol = parseColor(opts.color || 0xd946ef); // Magenta/violet
    const darkCol = parseColor(opts.darkColor || 0x581c87); // Deep aberrant purple
    const brightCol = parseColor(opts.brightColor || 0xfae8ff); // Glowing psychic white/pink

    if (!ctx || typeof ctx.createImageData !== 'function') return;
    const imgData = ctx.createImageData(size, size);
    if (!imgData || !imgData.data) return;
    const data = imgData.data;

    // Draw chaotic undulating waves with radial teeth
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) continue;

        const angle = Math.atan2(dy, dx);
        // Multi-frequency harmonic chaotic wobble (Gibbering madness distortion)
        const wobble = Math.sin(angle * 6 + waveT) * 2.8 + Math.cos(angle * 11 - waveT * 1.5) * 1.9;
        const effDist = dist + wobble;

        // Outer ring edge
        const dr = effDist - currentR;
        if (Math.abs(dr) <= 3.2) {
          const edgeAlpha = (1.0 - Math.abs(dr) / 3.2) * (1.0 - progress * 0.7);
          if (bayerDither(x, y, edgeAlpha)) {
            const idx = (y * size + x) * 4;
            const isCore = Math.abs(dr) <= 1.2;
            const c = isCore ? brightCol : baseCol;
            data[idx] = c.r;
            data[idx + 1] = c.g;
            data[idx + 2] = c.b;
            data[idx + 3] = 255;
          }
        } else if (dr < 0 && dr >= -6.0) {
          // Trailing inner energy resonance
          const trailAlpha = (1.0 + dr / 6.0) * 0.45 * (1.0 - progress);
          if (bayerDither(x, y, trailAlpha)) {
            const idx = (y * size + x) * 4;
            data[idx] = darkCol.r;
            data[idx + 1] = darkCol.g;
            data[idx + 2] = darkCol.b;
            data[idx + 3] = 255;
          }
        }
      }
    }

    if (ctx.putImageData) ctx.putImageData(imgData, 0, 0);

    // Draw floating aberrant eye / mouth motes around the perimeter
    const moteCount = 7;
    ctx.fillStyle = toRgbaStr(brightCol, 1.0 - progress);
    for (let i = 0; i < moteCount; i++) {
      const moteAngle = (i * ((Math.PI * 2) / moteCount)) + progress * 1.5 + (i * 0.7);
      const moteDist = currentR * (0.65 + 0.35 * Math.sin(progress * Math.PI + i));
      const mx = Math.round(cx + Math.cos(moteAngle) * moteDist);
      const my = Math.round(cy + Math.sin(moteAngle) * moteDist);
      if (mx >= 2 && mx < size - 2 && my >= 2 && my < size - 2) {
        // 2x2 or 3x3 pixel mouth/eye mote
        if (ctx.fillRect) {
          ctx.fillRect(mx - 1, my - 1, 2, 2);
          if (i % 2 === 0) {
            ctx.fillStyle = toRgbaStr(darkCol, (1.0 - progress) * 0.9);
            ctx.fillRect(mx, my, 1, 1);
            ctx.fillStyle = toRgbaStr(brightCol, 1.0 - progress);
          }
        }
      }
    }
  },

  /**
   * Stench / Miasma / Toxic Gas Aura:
   * Noxious bubbling green/yellow vapor with swirling pixel clumps.
   */
  stench(ctx, size, progress, opts = {}) {
    if (!ctx || typeof ctx.createImageData !== 'function') return;
    const cx = size / 2, cy = size / 2;
    const maxR = (size / 2) - 2;
    const currentR = maxR * Math.min(1.0, progress * 1.15);

    const baseCol = parseColor(opts.color || 0x84cc16); // Toxic lime
    const darkCol = parseColor(opts.darkColor || 0x365314); // Murky green
    const brightCol = parseColor(opts.brightColor || 0xfef08a); // Bilious yellow

    const imgData = ctx.createImageData(size, size);
    if (!imgData || !imgData.data) return;
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist > currentR + 3) continue;

        const angle = Math.atan2(dy, dx);
        // Swirling gas bubble lobes
        const bubble = Math.sin(angle * 5 + progress * 5) * 3.5 + Math.cos(angle * 8 - progress * 4) * 2.0;
        const effDist = dist + bubble;

        if (effDist <= currentR) {
          const density = (1.0 - (effDist / currentR)) * (1.0 - progress * 0.85);
          // Noise stipple for organic smoke cloud feel
          const noise = ((x * 17 + y * 31) % 19) / 19.0;
          const alpha = density * (0.6 + noise * 0.4);

          if (bayerDither(x, y, alpha)) {
            const idx = (y * size + x) * 4;
            const c = (density > 0.6) ? brightCol : (density > 0.3 ? baseCol : darkCol);
            data[idx] = c.r;
            data[idx + 1] = c.g;
            data[idx + 2] = c.b;
            data[idx + 3] = 255;
          }
        }
      }
    }
    if (ctx.putImageData) ctx.putImageData(imgData, 0, 0);
  },

  /**
   * Stepped Pixel Shockwave / Ability Telegraph Ring:
   * Concentric expanding pixel rings with 8-pointed teeth and dithered dissipation.
   */
  shockwave(ctx, size, progress, opts = {}) {
    if (!ctx || typeof ctx.createImageData !== 'function') return;
    const cx = size / 2, cy = size / 2;
    const maxR = (size / 2) - 2;
    const currentR = maxR * Math.min(1.0, progress * 1.3);

    const baseCol = parseColor(opts.color || 0xef4444);
    const brightCol = parseColor(opts.brightColor || 0xffffff);

    const imgData = ctx.createImageData(size, size);
    if (!imgData || !imgData.data) return;
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) continue;

        const angle = Math.atan2(dy, dx);
        const tooth = Math.abs(Math.sin(angle * 4)) * 1.8;
        const dr = (dist + tooth) - currentR;

        if (Math.abs(dr) <= 2.5) {
          const alpha = (1.0 - Math.abs(dr) / 2.5) * (1.0 - progress * 0.65);
          if (bayerDither(x, y, alpha)) {
            const idx = (y * size + x) * 4;
            const isCore = Math.abs(dr) <= 1.0;
            const c = isCore ? brightCol : baseCol;
            data[idx] = c.r;
            data[idx + 1] = c.g;
            data[idx + 2] = c.b;
            data[idx + 3] = 255;
          }
        }
      }
    }
    if (ctx.putImageData) ctx.putImageData(imgData, 0, 0);
  },

  /**
   * Flame Nova / Fire Burst:
   * Spiky jagged pixel flame tongues with burning yellow core and red embers.
   */
  fire(ctx, size, progress, opts = {}) {
    if (!ctx || typeof ctx.createImageData !== 'function') return;
    const cx = size / 2, cy = size / 2;
    const maxR = (size / 2) - 2;
    const currentR = maxR * Math.min(1.0, progress * 1.35);

    const coreCol = parseColor(0xfef08a); // Bright yellow
    const midCol = parseColor(opts.color || 0xf97316); // Flame orange
    const outerCol = parseColor(0xdc2626); // Deep red

    const imgData = ctx.createImageData(size, size);
    if (!imgData || !imgData.data) return;
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) continue;

        const angle = Math.atan2(dy, dx);
        const flameSpike = Math.sin(angle * 7 + progress * 8) * 3.2 + Math.cos(angle * 13 - progress * 4) * 2.0;
        const effDist = dist + flameSpike;

        if (effDist <= currentR) {
          const ratio = effDist / currentR;
          const alpha = (1.0 - ratio * 0.8) * (1.0 - progress * 0.75);
          if (bayerDither(x, y, alpha)) {
            const idx = (y * size + x) * 4;
            const c = (ratio < 0.45) ? coreCol : (ratio < 0.8 ? midCol : outerCol);
            data[idx] = c.r;
            data[idx + 1] = c.g;
            data[idx + 2] = c.b;
            data[idx + 3] = 255;
          }
        }
      }
    }
    if (ctx.putImageData) ctx.putImageData(imgData, 0, 0);
  },

  /**
   * Frost Nova / Ice Crystal Wave:
   * 6-fold geometric snowflake fractal points and icy cyan spikes.
   */
  frost(ctx, size, progress, opts = {}) {
    if (!ctx || typeof ctx.createImageData !== 'function') return;
    const cx = size / 2, cy = size / 2;
    const maxR = (size / 2) - 2;
    const currentR = maxR * Math.min(1.0, progress * 1.25);

    const coreCol = parseColor(0xffffff); // Pure ice white
    const midCol = parseColor(opts.color || 0x38bdf8); // Bright cyan
    const outerCol = parseColor(0x0284c7); // Deep glacial blue

    const imgData = ctx.createImageData(size, size);
    if (!imgData || !imgData.data) return;
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) continue;

        const angle = Math.atan2(dy, dx);
        // 6-fold crystal symmetry
        const crystal = Math.abs(Math.cos(angle * 3)) * 3.5;
        const effDist = dist - crystal;

        const dr = effDist - currentR;
        if (Math.abs(dr) <= 2.8) {
          const alpha = (1.0 - Math.abs(dr) / 2.8) * (1.0 - progress * 0.7);
          if (bayerDither(x, y, alpha)) {
            const idx = (y * size + x) * 4;
            const isCore = Math.abs(dr) <= 1.0;
            const c = isCore ? coreCol : (dr < 0 ? midCol : outerCol);
            data[idx] = c.r;
            data[idx + 1] = c.g;
            data[idx + 2] = c.b;
            data[idx + 3] = 255;
          }
        }
      }
    }
    if (ctx.putImageData) ctx.putImageData(imgData, 0, 0);
  },

  /**
   * Holy Radiant Halo / Sanctuary:
   * Concentric golden runic discs with 8-pointed star beams and sparkle motes.
   */
  holy(ctx, size, progress, opts = {}) {
    if (!ctx || typeof ctx.createImageData !== 'function') return;
    const cx = size / 2, cy = size / 2;
    const maxR = (size / 2) - 2;
    const currentR = maxR * Math.min(1.0, progress * 1.2);

    const coreCol = parseColor(0xffffff); // Pure white core
    const goldCol = parseColor(opts.color || 0xfacc15); // Rich gold
    const amberCol = parseColor(0xd97706); // Warm amber

    const imgData = ctx.createImageData(size, size);
    if (!imgData || !imgData.data) return;
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) continue;

        const angle = Math.atan2(dy, dx);
        // 8-pointed radiant star rays
        const ray = Math.pow(Math.abs(Math.cos(angle * 4)), 6) * 4.0;
        const dr = (dist - ray) - currentR;

        if (Math.abs(dr) <= 2.4 || (dist <= currentR * 0.4 && (x === Math.round(cx) || y === Math.round(cy)))) {
          const alpha = (1.0 - Math.abs(dr) / 2.4) * (1.0 - progress * 0.6);
          if (bayerDither(x, y, Math.max(alpha, 0.4 * (1.0 - progress)))) {
            const idx = (y * size + x) * 4;
            const isCore = Math.abs(dr) <= 0.8;
            const c = isCore ? coreCol : (dr < 0 ? goldCol : amberCol);
            data[idx] = c.r;
            data[idx + 1] = c.g;
            data[idx + 2] = c.b;
            data[idx + 3] = 255;
          }
        }
      }
    }
    if (ctx.putImageData) ctx.putImageData(imgData, 0, 0);
  },

  /**
   * Directional Pixel Slash Arc:
   * Curved crescent blade impact with tapered pixel ends and speedlines.
   */
  slash(ctx, size, progress, opts = {}) {
    if (!ctx || typeof ctx.createImageData !== 'function') return;
    const imgData = ctx.createImageData(size, size);
    if (!imgData || !imgData.data) return;
    const data = imgData.data;

    const cx = size / 2, cy = size / 2;
    const slashR = (size / 2) - 4;
    const baseAngle = opts.rot || 0;
    const sweep = Math.PI * 0.85;

    const coreCol = parseColor(0xffffff);
    const bladeCol = parseColor(opts.color || 0xffd34a);
    const trailCol = parseColor(0xef4444);

    const startA = baseAngle - sweep / 2;
    const endA = baseAngle + sweep / 2;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) continue;

        let a = Math.atan2(dy, dx);
        while (a < startA) a += Math.PI * 2;
        while (a > startA + Math.PI * 2) a -= Math.PI * 2;

        if (a >= startA && a <= endA) {
          const normalizedA = (a - startA) / sweep;
          // Taper thickness toward blade ends
          const taper = Math.sin(normalizedA * Math.PI);
          const maxThick = 3.5 * taper;
          const dr = Math.abs(dist - slashR);

          if (dr <= maxThick) {
            const alpha = (1.0 - dr / maxThick) * (1.0 - progress * 0.8);
            if (bayerDither(x, y, alpha)) {
              const idx = (y * size + x) * 4;
              const isBlade = dr <= 1.2;
              const c = isBlade ? coreCol : (progress < 0.4 ? bladeCol : trailCol);
              data[idx] = c.r;
              data[idx + 1] = c.g;
              data[idx + 2] = c.b;
              data[idx + 3] = 255;
            }
          }
        }
      }
    }
    if (ctx.putImageData) ctx.putImageData(imgData, 0, 0);
  },

  /**
   * Directional Pixel Slashing Arc:
   * Dynamic frame-by-frame animated sword sweep! The blade head rapidly carves across
   * the arc over time, followed by trailing razor speedlines and flying glint sparks
   * while the tail dissolves into dithered pixels.
   */
  melee_slash(ctx, size, progress, opts = {}) {
    if (!ctx || typeof ctx.createImageData !== 'function') return;
    const imgData = ctx.createImageData(size, size);
    if (!imgData || !imgData.data) return;
    const data = imgData.data;

    const cx = size / 2, cy = size / 2;
    const isCrit = !!opts.isCrit;
    const coreCol = parseColor(0xffffff);
    const bladeCol = parseColor(opts.color || (isCrit ? 0xfacc15 : 0x93c5fd));
    const trailCol = parseColor(isCrit ? 0xef4444 : 0x3b82f6);
    const darkEdge = parseColor(isCrit ? 0x78350f : 0x1e3a8a);

    // The blade cut passes directly through (cx, cy), perfectly centered on the target!
    // Curve spans y from -26 to +26, with apex curving through (cx, cy).
    const spanH = 26;
    const pHead = Math.min(1.0, progress / 0.45);
    const curHeadY = -spanH + (spanH * 2) * Math.sin(pHead * Math.PI / 2);

    const pTail = Math.max(0.0, Math.min(1.0, (progress - 0.20) / 0.75));
    const curTailY = -spanH + (spanH * 2) * (pTail * pTail);

    if (curTailY < curHeadY) {
      for (let y = 0; y < size; y++) {
        const dy = y - cy;
        if (dy < curTailY || dy > curHeadY) continue;

        // Curve equation: apex passes exactly through (cx, cy) at dy=0
        const normY = dy / spanH; // -1 to +1
        const curveOffset = (1.0 - normY * normY) * 9.0; // 9px forward curve at center
        const curveCenterX = cx - 4.5 + curveOffset; // passes through cx at center!

        const normProgress = (dy - curTailY) / Math.max(0.1, curHeadY - curTailY);
        const taper = Math.sin(normProgress * Math.PI * 0.85 + 0.15);
        const maxThick = (isCrit ? 5.8 : 4.5) * taper;

        for (let x = 0; x < size; x++) {
          const dx = x - curveCenterX;
          const dr = Math.abs(dx);

          if (dr <= maxThick) {
            const edgeFade = 1.0 - dr / maxThick;
            const timeFade = 1.0 - progress * 0.70;
            const alpha = edgeFade * timeFade;
            if (bayerDither(x, y, alpha)) {
              const idx = (y * size + x) * 4;
              const isSpine = dr <= 1.3;
              const isLead = normProgress > 0.82;
              const isOuter = dr > maxThick * 0.70;
              const c = (isLead || isSpine) ? coreCol : (isOuter ? darkEdge : (normProgress > 0.4 ? bladeCol : trailCol));
              data[idx] = c.r;
              data[idx + 1] = c.g;
              data[idx + 2] = c.b;
              data[idx + 3] = 255;
            }
          } else {
            // Secondary parallel razor speedlines trailing 5px behind
            const trailDx = Math.abs(x - (curveCenterX - 5.5));
            if (trailDx <= 2.0 * taper && normProgress < 0.75) {
              const trailAlpha = (1.0 - trailDx / (2.0 * taper)) * (1.0 - progress) * 0.75;
              if (bayerDither(x, y, trailAlpha)) {
                const idx = (y * size + x) * 4;
                data[idx] = trailCol.r;
                data[idx + 1] = trailCol.g;
                data[idx + 2] = trailCol.b;
                data[idx + 3] = 255;
              }
            }
          }
        }
      }
    }
    if (ctx.putImageData) ctx.putImageData(imgData, 0, 0);

    // Brilliant leading tip glint & sparks (centered and cutting across)
    if (progress < 0.55 && ctx.fillRect) {
      const tipNormY = Math.max(-1.0, Math.min(1.0, curHeadY / spanH));
      const tipCurveX = Math.round(cx - 4.5 + (1.0 - tipNormY * tipNormY) * 9.0);
      const tipY = Math.round(cy + curHeadY);

      ctx.fillStyle = toRgbaStr(coreCol, 1.0 - progress * 1.5);
      ctx.fillRect(tipCurveX - 2, tipY - 2, 4, 4);

      const glintCount = isCrit ? 4 : 2;
      for (let i = 0; i < glintCount; i++) {
        const gx = tipCurveX + ((i % 2 === 0) ? 4 : -4) + Math.round((progress * 12) * ((i % 2 === 0) ? 1 : -1));
        const gy = tipY - (i + 1) * 3;
        if (gx >= 0 && gx < size && gy >= 0 && gy < size) {
          ctx.fillRect(gx, gy, 2, 2);
        }
      }
    }
  },

  /**
   * Directional Pixel Piercing Thrust:
   * Massive, high-visibility energy lance thrust punching directly through the target center!
   * Thick 8-pixel luminous shaft, 14-pixel faceted diamond arrowhead, and 4 heavy
   * puncture shock prongs bursting backward.
   */
  melee_pierce(ctx, size, progress, opts = {}) {
    if (!ctx || typeof ctx.createImageData !== 'function') return;
    const imgData = ctx.createImageData(size, size);
    if (!imgData || !imgData.data) return;
    const data = imgData.data;

    const cx = size / 2, cy = size / 2;
    const isCrit = !!opts.isCrit;
    const coreCol = parseColor(0xffffff);
    const thrustCol = parseColor(opts.color || (isCrit ? 0xc084fc : 0x38bdf8));
    const darkEdge = parseColor(isCrit ? 0x581c87 : 0x0369a1);
    const prongCol = parseColor(isCrit ? 0xf43f5e : 0x0284c7);

    // Drives from -28px to +28px, perfectly centered through (cx, cy)!
    const maxReach = 56;
    const startX = cx - 28;
    const pThrust = Math.min(1.0, progress / 0.32);
    const curTipX = startX + maxReach * Math.sin(pThrust * Math.PI / 2);

    const pTail = Math.max(0.0, Math.min(1.0, (progress - 0.25) / 0.70));
    const curTailX = startX + maxReach * (pTail * pTail);

    const prongReach = 24 * Math.min(1.0, Math.max(0.0, (progress - 0.10) / 0.40));

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dy = y - cy;
        const distY = Math.abs(dy);

        // A. Bold, Thick Piercing Lance Shaft & Arrowhead (6 to 8 pixels thick!)
        if (x >= curTailX && x <= curTipX + 3) {
          const fromTip = curTipX - x;
          // Arrowhead flare at the tip (12px wide diamond)
          const isHead = fromTip <= 10;
          const maxH = isHead
            ? Math.max(1.0, (isCrit ? 6.5 : 5.2) * (1.0 - Math.abs(fromTip - 5) / 5))
            : (isCrit ? 4.5 : 3.5);

          if (distY <= maxH) {
            const edgeFade = 1.0 - distY / maxH;
            const timeFade = 1.0 - progress * 0.75;
            const alpha = edgeFade * timeFade;
            if (bayerDither(x, y, alpha)) {
              const idx = (y * size + x) * 4;
              const isCenter = distY <= 1.4;
              const isRim = distY > maxH * 0.72;
              const c = isCenter ? coreCol : (isRim ? darkEdge : thrustCol);
              data[idx] = c.r;
              data[idx + 1] = c.g;
              data[idx + 2] = c.b;
              data[idx + 3] = 255;
            }
          }
        }

        // B. Lateral puncture shock prongs bursting backward/outward at 45 degrees (thick 4px prongs)
        if (prongReach > 3) {
          const prX = x - cx; // radiating backward from center (cx, cy)
          const prY = Math.abs(dy);
          const prongDist = Math.hypot(prX, dy);
          if (prongDist > 3 && prongDist <= prongReach) {
            const angle = Math.atan2(prY, -prX);
            if (Math.abs(angle - Math.PI * 0.25) < 0.26) {
              const pAlpha = (1.0 - prongDist / prongReach) * (1.0 - progress * 0.85);
              if (bayerDither(x, y, pAlpha)) {
                const idx = (y * size + x) * 4;
                const isCoreProng = Math.abs(angle - Math.PI * 0.25) < 0.10;
                const c = isCoreProng ? coreCol : prongCol;
                data[idx] = c.r;
                data[idx + 1] = c.g;
                data[idx + 2] = c.b;
                data[idx + 3] = 255;
              }
            }
          }
        }
      }
    }
    if (ctx.putImageData) ctx.putImageData(imgData, 0, 0);

    // Radiant Diamond Arrowhead Flash at Tip
    if (progress < 0.40 && ctx.fillRect) {
      ctx.fillStyle = toRgbaStr(coreCol, 1.0 - progress * 2.2);
      const px = Math.round(curTipX);
      ctx.fillRect(px - 3, Math.round(cy - 3), 6, 6);
      ctx.fillRect(px - 5, Math.round(cy - 1), 10, 2);
      ctx.fillRect(px - 1, Math.round(cy - 5), 2, 10);
    }
  },

  /**
   * Directional Pixel Bludgeoning Impact:
   * Punchy, localized blunt impact smash. Features crisp 2x2 chunky pixels,
   * a compact shock compression disc, white impact core with subtle light blue highlights,
   * and clean kinetic particles (no explosion red/yellow).
   */
  melee_blunt(ctx, size, progress, opts = {}) {
    if (!ctx || typeof ctx.createImageData !== 'function') return;
    const imgData = ctx.createImageData(size, size);
    if (!imgData || !imgData.data) return;
    const data = imgData.data;

    const cx = size / 2, cy = size / 2;
    const isCrit = !!opts.isCrit;
    const coreCol = parseColor(0xffffff);
    const lightBlue = parseColor(0xdbeafe);   // soft subtle light blue
    const midBlue = parseColor(0x93c5fd);     // soft sky/steel blue
    const outlineBlue = parseColor(0x1e3a5f); // muted slate navy edge (clean contrast, no warm red/brown)

    // Half size: maxR around 14px instead of 29.5px
    const maxR = size * 0.23;
    const pRing = Math.max(0.0, Math.min(1.0, progress / 0.70));
    const ringR = maxR * Math.sin(pRing * Math.PI / 2);

    // Render in chunky 2x2 pixel blocks (larger pixels, half resolution)
    for (let y = 0; y < size; y += 2) {
      for (let x = 0; x < size; x += 2) {
        const dx = (x + 1) - cx, dy = (y + 1) - cy;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) continue;

        // Faceted impact teeth radiating outward
        const angle = Math.atan2(dy, dx);
        const octagonal = Math.abs(Math.sin(angle * 4)) * 1.8;
        const forwardBias = (dx / dist) * 1.5;
        const effDist = dist - octagonal - forwardBias;

        let pixelColor = null;

        // 1. Compression disc inside shockwave
        if (effDist <= ringR + 1.5) {
          const normDist = effDist / Math.max(1, ringR);
          const discAlpha = (1.0 - progress * 0.75) * (0.85 - normDist * 0.40);
          if (bayerDither(x, y, discAlpha)) {
            const isCenter = dist <= 3.5;
            pixelColor = isCenter ? coreCol : (normDist < 0.45 ? lightBlue : midBlue);
          }
        }

        // 2. Compact shock rim
        const drOuter = Math.abs(effDist - ringR);
        const thickOuter = (isCrit ? 4.0 : 3.0) * (1.0 - progress * 0.40);

        if (drOuter <= thickOuter && ringR > 2) {
          const edgeFade = 1.0 - drOuter / thickOuter;
          const timeFade = 1.0 - progress * 0.75;
          const alpha = edgeFade * timeFade;
          if (bayerDither(x, y, alpha)) {
            const isSpine = drOuter <= 1.0;
            const isRim = drOuter > thickOuter * 0.60;
            pixelColor = isSpine ? coreCol : (isRim ? outlineBlue : lightBlue);
          }
        }

        if (pixelColor) {
          // Write 2x2 pixel block
          for (let dy2 = 0; dy2 < 2 && y + dy2 < size; dy2++) {
            for (let dx2 = 0; dx2 < 2 && x + dx2 < size; dx2++) {
              const idx = ((y + dy2) * size + (x + dx2)) * 4;
              data[idx] = pixelColor.r;
              data[idx + 1] = pixelColor.g;
              data[idx + 2] = pixelColor.b;
              data[idx + 3] = 255;
            }
          }
        }
      }
    }
    if (ctx.putImageData) ctx.putImageData(imgData, 0, 0);

    // 3. Compact White & Subtle Blue Impact Cross (first 35% of impact)
    if (progress < 0.35 && ctx.fillRect) {
      const flashAlpha = 1.0 - progress / 0.35;
      const armLen = isCrit ? 12 : 9;
      const armThick = 4;

      // Soft light blue aura arms
      ctx.fillStyle = toRgbaStr(lightBlue, flashAlpha * 0.75);
      ctx.fillRect(Math.round(cx - armLen), Math.round(cy - armThick / 2), armLen * 2, armThick);
      ctx.fillRect(Math.round(cx - armThick / 2), Math.round(cy - armLen), armThick, armLen * 2);

      // Diagonal glint dots
      const diagLen = Math.round(armLen * 0.65);
      for (let d = -diagLen; d <= diagLen; d += 2) {
        if (d === 0) continue;
        ctx.fillRect(Math.round(cx + d - 1), Math.round(cy + d - 1), 2, 2);
        ctx.fillRect(Math.round(cx + d - 1), Math.round(cy - d - 1), 2, 2);
      }

      // Pure white impact core
      const coreSize = isCrit ? 6 : 4;
      ctx.fillStyle = toRgbaStr(coreCol, flashAlpha);
      ctx.fillRect(Math.round(cx - coreSize / 2), Math.round(cy - coreSize / 2), coreSize, coreSize);
    }

    // 4. Subtle Kinetic Shock Particles (4-6 chunky 2x2 particles, white & light blue)
    if (progress > 0.06 && ctx.fillRect) {
      const debrisCount = isCrit ? 6 : 4;
      for (let i = 0; i < debrisCount; i++) {
        const da = (i - (debrisCount - 1) / 2) * 0.50;
        const speed = 10 + (i % 3) * 5;
        const dd = (ringR * 0.5) + (progress - 0.06) * speed;
        const bx = Math.round(cx + Math.cos(da) * dd);
        const by = Math.round(cy + Math.sin(da) * dd);

        if (bx >= 1 && bx < size - 3 && by >= 1 && by < size - 3) {
          const chunkW = 2;
          const chunkAlpha = Math.max(0.0, 1.0 - (progress - 0.06) / 0.75);

          // Subtle slate navy shadow
          ctx.fillStyle = toRgbaStr(outlineBlue, chunkAlpha * 0.6);
          ctx.fillRect(bx - 1, by - 1, chunkW + 2, chunkW + 2);

          // White / Light blue body
          ctx.fillStyle = toRgbaStr((i % 2 === 0) ? coreCol : lightBlue, chunkAlpha);
          ctx.fillRect(bx, by, chunkW, chunkW);
        }
      }
    }
  }
};

/**
 * Procedural Pixel VFX System & Pools
 */
const _quadGeo = new THREE.PlaneGeometry(1, 1);
const activePixelVfx = [];
const vfxPool = [];
const billboardPool = [];

const CANVAS_SIZE = 64;

function createPixelVfxInstance() {
  const canvas = (typeof document !== 'undefined' && typeof document.createElement === 'function')
    ? document.createElement('canvas')
    : { width: CANVAS_SIZE, height: CANVAS_SIZE, getContext: () => null };

  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext ? canvas.getContext('2d', { willReadFrequently: true }) : null;

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide
  });
  mat.toneMapped = false;

  const mesh = new THREE.Mesh(_quadGeo, mat);
  mesh.rotation.x = -Math.PI / 2; // Flat on dungeon floor
  mesh.renderOrder = 55;

  return { mesh, canvas, ctx, tex, mat, isBillboard: false };
}

function createBillboardVfxInstance() {
  const canvas = (typeof document !== 'undefined' && typeof document.createElement === 'function')
    ? document.createElement('canvas')
    : { width: CANVAS_SIZE, height: CANVAS_SIZE, getContext: () => null };

  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext ? canvas.getContext('2d', { willReadFrequently: true }) : null;

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;

  // Pure standard SpriteMaterial with no depth tilt distortion
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: false
  });
  mat.toneMapped = false;

  const mesh = new THREE.Sprite(mat);
  mesh.renderOrder = 60;

  return { mesh, canvas, ctx, tex, mat, isBillboard: true };
}

/**
 * Spawns a procedural pixel VFX at a 3D position in the dungeon.
 * @param {THREE.Scene} scene
 * @param {Object} opts
 * @param {string} [opts.type='shockwave'] - 'gibbering', 'stench', 'shockwave', 'fire', 'frost', 'holy', 'slash', 'melee_slash', 'melee_pierce', 'melee_blunt'
 * @param {{x: number, y?: number, z: number}} opts.pos
 * @param {number} [opts.radius=2.0]
 * @param {number|string} [opts.color]
 * @param {number} [opts.duration=0.6]
 * @param {number} [opts.rot=0]
 * @param {boolean} [opts.billboard=false]
 */
export function spawnPixelVfx(scene, opts = {}) {
  if (!scene || !opts.pos) return null;

  const isBillboard = !!opts.billboard;
  const inst = isBillboard
    ? (billboardPool.pop() || createBillboardVfxInstance())
    : (vfxPool.pop() || createPixelVfxInstance());

  const type = opts.type || 'shockwave';
  const radius = opts.radius != null ? opts.radius : 2.0;
  const duration = opts.duration != null ? opts.duration : 0.6;
  const color = opts.color;
  const rot = opts.rot || 0;
  const yOffset = opts.yOffset != null ? opts.yOffset : (isBillboard ? 0 : 0.08);

  const posY = (opts.pos.y != null ? opts.pos.y : 0) + yOffset;
  inst.mesh.position.set(opts.pos.x, posY, opts.pos.z);

  if (isBillboard) {
    if (inst.mesh.material) inst.mesh.material.rotation = rot;
    inst.mesh.scale.set(radius * 2, radius * 2, 1);
  } else {
    inst.mesh.rotation.x = -Math.PI / 2;
    inst.mesh.rotation.z = rot;
    inst.mesh.scale.set(radius * 2, radius * 2, 1);
  }
  inst.mesh.visible = true;
  scene.add(inst.mesh);

  const entry = {
    ...inst,
    type,
    radius,
    duration,
    color,
    rot,
    opts,
    t: 0
  };

  activePixelVfx.push(entry);
  // Initial draw
  renderFrame(entry, 0);
  return entry;
}

function renderFrame(entry, progress) {
  const { ctx, canvas, tex, type, opts } = entry;
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const drawFn = PIXEL_VFX_PRESETS[type] || PIXEL_VFX_PRESETS.shockwave;
  drawFn(ctx, canvas.width, progress, opts);
  if (tex) tex.needsUpdate = true;
}

/**
 * Updates all active procedural pixel VFX. Call on every game tick/render loop.
 */
export function updatePixelVfx(scene, dt) {
  for (let i = activePixelVfx.length - 1; i >= 0; i--) {
    const entry = activePixelVfx[i];
    entry.t += dt;
    const progress = Math.min(1.0, entry.t / entry.duration);

    if (entry.isBillboard) {
      // Dynamic scale punch: pops on impact and eases
      const scalePunch = 1.0 + Math.sin(progress * Math.PI) * 0.18;
      const r = entry.radius * scalePunch;
      entry.mesh.scale.set(r * 2, r * 2, 1);
    }

    renderFrame(entry, progress);

    if (entry.t >= entry.duration) {
      if (entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
      activePixelVfx.splice(i, 1);
      if (entry.isBillboard) {
        billboardPool.push(entry);
      } else {
        vfxPool.push(entry);
      }
    }
  }
}

/** Clears and resets all active pixel effects (e.g. on floor transition) */
export function clearPixelVfx(scene) {
  for (const entry of activePixelVfx) {
    if (entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
    if (entry.isBillboard) billboardPool.push(entry);
    else vfxPool.push(entry);
  }
  activePixelVfx.length = 0;
}
