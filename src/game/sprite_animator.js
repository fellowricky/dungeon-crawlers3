import * as THREE from 'three';
import { recolorPixels, isCharacterLayer,
         LAYER_ORDER, buildLayerPaths, layerTint } from './appearance.js';

const ASSETS_ROOT = './lpc/';
const ANIM_META = {
  spellcast:   { cols: 7, rows: 4, speed: 10 },
  thrust:      { cols: 8, rows: 4, speed: 12 },
  walk:        { cols: 9, rows: 4, speed: 12 },
  slash:       { cols: 6, rows: 4, speed: 12 },
  shoot:       { cols: 13, rows: 4, speed: 15 },
  hurt:        { cols: 6, rows: 1, speed: 8 },
  idle:        { cols: 2, rows: 4, speed: 3 },
  combat_idle: { cols: 9, rows: 4, speed: 12 }
};

const DIRS = { up: 0, left: 1, down: 2, right: 3 };

const imageCache = {};
function loadImage(src) {
  if (imageCache[src]) return Promise.resolve(imageCache[src]);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { imageCache[src] = img; resolve(img); };
    img.onerror = () => {
      console.warn("Failed to load sprite sheet:", src);
      resolve(null);
    }; // resolve null on missing layer
    img.src = src;
  });
}

/* Recolor at native size. `matchLightness` is set for character layers so a
   dark swatch actually renders dark — see recolorPixels in appearance.js.
   Returns the original image when no tint is requested. */
function tintImage(img, tintColor, matchLightness = false) {
  if (!tintColor) return img;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = img.width; tempCanvas.height = img.height;
  const tctx = tempCanvas.getContext('2d');
  tctx.drawImage(img, 0, 0);
  const id = tctx.getImageData(0, 0, img.width, img.height);
  recolorPixels(id.data, tintColor, matchLightness);
  tctx.putImageData(id, 0, 0);
  return tempCanvas;
}

/* LPC sheets come in several frame sizes: standard 64px, plus 128px and 192px
   "oversize" weapon sheets (walk_128, slash_oversize, thrust_oversize, …).
   Returns the frame size, or 0 when the sheet doesn't divide evenly. */
function frameSizeOf(img, meta) {
  const fs = img.height / meta.rows;
  return Number.isInteger(fs) ? fs : 0;
}

/* Blit one layer sheet onto the composed atlas frame-by-frame so mixed frame
   sizes stay aligned (each frame is centered in its cell). Sheets narrower
   than the animation repeat their last frame; wider sheets (13-col padded
   walk_128 exports) simply use the leading frames. */
function blitLayer(ctx, src, meta, cell) {
  const fs = frameSizeOf(src, meta);
  if (!fs) { // malformed sheet — legacy fallback: scale to fit
    ctx.drawImage(src, 0, 0, ctx.canvas.width, ctx.canvas.height);
    return;
  }
  const imgCols = Math.floor(src.width / fs);
  const pad = (cell - fs) / 2;
  for (let r = 0; r < meta.rows; r++) {
    for (let c = 0; c < meta.cols; c++) {
      const sc = Math.min(c, imgCols - 1);
      ctx.drawImage(src, sc * fs, r * fs, fs, fs, c * cell + pad, r * cell + pad, fs, fs);
    }
  }
}

/**
 * Configures a SpriteMaterial with camera-aligned depth tilt correction.
 *
 * In 2.5D / isometric view with pitch (e.g. looking down at ~36°), standard
 * Three.js SpriteMaterial assigns every pixel of the billboard quad a constant
 * view-space Z equal to the entity's base on the floor. Because vertical 3D geometry
 * (walls, pillars, chests) extends upwards and closer to the camera, the top parts
 * of walls behind the entity end up with higher depth than the sprite's quad, causing
 * severe clipping through the entity's head/body.
 *
 * This hook tilts the quad's view-space Z to match the world-up vertical slope
 * (viewMatrix[1].z / viewMatrix[1].y), plus a small forward bias. The sprite thus:
 * 1. Never clips through background walls or objects on/behind its tile.
 * 2. Remains properly occluded by foreground walls/objects in front of it.
 */
export function configureSpriteMaterial(mat, options = {}) {
  const forwardBias = options.forwardBias !== undefined ? options.forwardBias : 0.08;
  const oldOnBeforeCompile = mat.onBeforeCompile;

  mat.onBeforeCompile = (shader, renderer) => {
    if (oldOnBeforeCompile) oldOnBeforeCompile(shader, renderer);

    shader.vertexShader = shader.vertexShader.replace(
      'mvPosition.xy += rotatedPosition;',
      `mvPosition.xy += rotatedPosition;
      float wallSlope = (abs(viewMatrix[1].y) > 0.0001) ? (viewMatrix[1].z / viewMatrix[1].y) : 0.0;
      float groundSlope = (abs(viewMatrix[2].y) > 0.0001) ? abs(viewMatrix[2].z / viewMatrix[2].y) : 0.0;
      float zOffset = (rotatedPosition.y >= 0.0) ? (rotatedPosition.y * wallSlope) : (-rotatedPosition.y * groundSlope);
      mvPosition.z += zOffset + ${forwardBias.toFixed(3)};`
    );
  };

  mat.customProgramCacheKey = () => `depthTiltSprite_${forwardBias.toFixed(3)}`;
  return mat;
}

// Cache composed textures so we don't redraw canvases for identical visual setups
const textureCache = {};
export class HeroSprite {
  constructor(hero, color) {
    /* Share the hero's own visual object rather than a copy — the Equipment
       tab mutates visual.hideHelm in place and then calls reloadAll(). */
    this.visual = hero.visual || (hero.visual = {});
    this.equipment = hero.equipment || {};
    this.color = color;
    this.textures = {};
    this.material = configureSpriteMaterial(new THREE.SpriteMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      alphaTest: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    }));
    this.mesh = new THREE.Sprite(this.material);
    this.mesh.renderOrder = 1;
    this._curCell = 64;
    this.applyCell(64);
    this.mesh.visible = false; // Hide until texture loads to prevent white box

    this.state = 'walk';
    this.dir = 'down';
    this.time = 0;
    this.animating = true;

    this._readyPromise = Promise.all([
      this.loadState('walk'),
      this.loadState('slash'),
      this.loadState('hurt'),
      this.loadState('shoot'),
      this.loadState('spellcast'),
      this.loadState('thrust')
    ]);
  }

  whenReady() {
    return this._readyPromise || Promise.resolve();
  }

  /* Size the sprite quad for the atlas cell size (64 = standard LPC frame;
     128/192 = oversize weapon sheets). The body stays the same world size —
     only the quad grows so oversize weapon sweeps aren't cropped. The anchor
     keeps the feet (~3% padding inside the 64px body frame) on the floor. */
  applyCell(cell) {
    this._curCell = cell;
    const k = cell / 64;
    const sx = this.visual.spriteScaleX || 1.0;
    const sy = this.visual.spriteScaleY || 1.0;
    this.mesh.scale.set(1.125 * sx * k, 1.125 * sy * k, 1);
    this.mesh.center.set(0.5, ((cell - 64) / 2 + 64 * 0.04) / cell);
  }

  /* re-compose every loaded animation (called after equipment changes) */
  reloadAll(){
    for (const k of Object.keys(this.textures)) this.loadState(k);
  }

  getCacheKey(action) {
    const w = this.equipment.weapon ? `${this.equipment.weapon.visualWeapon}|${this.equipment.weapon.visualColor||''}` : 'none';
    const a = this.equipment.armor;
    const t = a ? `${a.visualTorso}|${a.visualColor||''}|${a.visualShoulders||''}|${a.visualSleeves||''}|${a.visualBracers||''}|${a.visualCape||''}|${a.visualBelt||''}` : 'none';
    const l = this.equipment.armor ? `${this.equipment.armor.visualLegs || 'pants'}|${this.equipment.armor.visualColor||''}` : 'none';
    const hm = this.equipment.helm ? `${this.equipment.helm.visualHelm}|${this.equipment.helm.visualColor||''}|${this.equipment.helm.visualVisor||''}` : 'none';
    const sh = this.equipment.offhand ? `${this.equipment.offhand.visualShield}|${this.equipment.offhand.visualColor||''}` : 'none';
    const f = this.equipment.boots ? `${this.equipment.boots.visualShoes}|${this.equipment.boots.visualColor||''}` : 'none';
    const glv = this.equipment.gloves ? `${this.equipment.gloves.visualGloves}|${this.equipment.gloves.visualColor||''}` : 'none';
    /* Every visual field that changes a composed pixel has to appear here —
       a missing one makes two differently-styled heroes collide in
       textureCache and share the first one's sprite. */
    const parts = [
      this.visual.gender || 'male',
      this.visual.race || 'human',
      this.visual.bodyType || 'male',
      this.visual.head || '',
      this.visual.skinColor || '',
      this.visual.hair || '',
      this.visual.hairColor || '',
      this.visual.hairExtension || '',
      this.visual.hairExtColor || '',
      this.visual.eyeColor || '',
      this.visual.facialHair || '',
      this.visual.ears || '',
      this.visual.horns || '',
      this.visual.pants ?? '',
      this.visual.shoes ?? '',
      /* Per-hero hide-hats toggle drops the helm/visor layers, so two heroes
         in identical gear compose different sprites — without this they would
         share a textureCache entry and the toggle would appear to do nothing. */
      this.visual.hideHelm ? 'nohat' : '',
      action
    ];
    if (this.equipment) {
      for (const k in this.equipment) {
        if (this.equipment[k]) parts.push(`${k}:${this.equipment[k].id}:${this.equipment[k].visualColor||''}`);
      }
    }
    return parts.join('|');
  }

  async loadState(action) {
    if (!ANIM_META[action]) return;
    const cacheKey = this.getCacheKey(action);
    if (textureCache[cacheKey]) {
      this.textures[action] = textureCache[cacheKey];
      return;
    }

    const meta = ANIM_META[action];
    const paths = buildLayerPaths(this.visual, this.equipment);

    // Load every layer in parallel, then size the atlas to the largest frame
    const imgs = await Promise.all(LAYER_ORDER.map(layer =>
      paths[layer] ? loadImage(`${ASSETS_ROOT}${paths[layer]}/${action}.png`) : Promise.resolve(null)
    ));
    let cell = 64;
    for (const img of imgs) {
      if (!img) continue;
      const fs = frameSizeOf(img, meta);
      if (fs > cell) cell = fs;
    }

    const canvas = document.createElement('canvas');
    canvas.width = meta.cols * cell;
    canvas.height = meta.rows * cell;
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < LAYER_ORDER.length; i++) {
      const img = imgs[i];
      if (!img) continue;
      const layer = LAYER_ORDER[i];
      const tint = layerTint(layer, this.visual, this.equipment);
      const src = tint ? tintImage(img, tint, isCharacterLayer(layer)) : img;
      blitLayer(ctx, src, meta, cell);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.repeat.set(1 / meta.cols, 1 / meta.rows);
    tex._cell = cell;

    textureCache[cacheKey] = tex;
    this.textures[action] = tex;
    if (this.state === action) {
      this.material.map = tex;
      this.material.needsUpdate = true;
      this.mesh.visible = true;
      if (tex._cell !== this._curCell) this.applyCell(tex._cell);
    }
  }

  play(action, force = false) {
    if (this.state === action && !force) return;
    this.state = action;
    this.time = 0;
    this.animating = true;
    this._dying = false;
    if (!this.textures[action]) {
      this.loadState(action);
    }
  }

  /** Begin the death animation: play hurt once, then hold the last frame. */
  playDeath() {
    this.state = 'hurt';
    this.time = 0;
    this.animating = true;
    this._dying = true;
    this._deathDone = false;
    this.dir = 'down'; // always face camera when falling
    if (!this.textures['hurt']) {
      this.loadState('hurt');
    }
  }

  setDirection(dx, dz) {
    if (Math.abs(dx) > Math.abs(dz)) {
      this.dir = dx > 0 ? 'right' : 'left';
    } else if (Math.abs(dz) > 0.05) {
      this.dir = dz > 0 ? 'down' : 'up';
    }
  }

  update(dt) {
    if (this.animating) this.time += dt;
    const meta = ANIM_META[this.state];
    if (!meta) return;

    const tex = this.textures[this.state];
    if (tex) {
      if (this.material.map !== tex) {
        this.material.map = tex;
        this.mesh.visible = true;
      }
      if (tex._cell !== this._curCell) this.applyCell(tex._cell);
    }

    const frames = meta.cols;
    let currentFrame;
    if (this.state === 'walk') {
      if (this.time * meta.speed < 1.0) {
        currentFrame = 0;
      } else {
        currentFrame = 1 + Math.floor(this.time * meta.speed - 1) % 8;
      }
    } else {
      currentFrame = Math.floor(this.time * meta.speed) % frames;
    }

    if (this.state !== 'walk' && this.time * meta.speed >= frames) {
      currentFrame = frames - 1;
      this.animating = false;

      if (this._dying) {
        // Death anim finished — hold the last hurt frame indefinitely
        this._deathDone = true;
      } else if (this.state === 'hurt' && !this._dying) {
        // If hurt finishes (non-death), return to walk
        this.play('walk');
        return;
      }
    }

    const rowIdx = meta.rows === 1 ? 0 : DIRS[this.dir];
    const vOffset = (meta.rows - 1 - rowIdx) / meta.rows;
    const uOffset = currentFrame / meta.cols;

    if (tex) {
      tex.offset.set(uOffset, vOffset);
    }
  }
}

/* ================= static portrait ==================================
   Composes a hero's front-facing (down) standing frame with their CURRENT
   equipment onto a 2D canvas — so the character screen reflects gear the
   player just equipped. Uses the same layer/path resolution as HeroSprite but
   draws a single frame (walk sheet, facing-camera row, frame 0). */

/* Draw the front-facing standing frame of a walk sheet, handling both 64px
   and oversize (128px) frames — oversize frames are center-cropped so the
   body lands in the same spot. Optional multiply tint. */
function drawPortraitFrame(ctx, img, tint) {
  const fs = frameSizeOf(img, ANIM_META.walk) || 64;
  const off = (64 - fs) / 2; // negative for oversize: center-crop to the body
  const cw = ctx.canvas.width || 64;
  const ch = ctx.canvas.height || 64;
  if (!tint) { ctx.drawImage(img, 0, 2 * fs, fs, fs, 0, 0, cw, ch); return; }
  const tmp = document.createElement('canvas'); tmp.width = 64; tmp.height = 64;
  const t = tmp.getContext('2d');
  t.drawImage(img, 0, 2 * fs, fs, fs, off, off, fs, fs);
  t.globalCompositeOperation = 'multiply';
  t.fillStyle = tint; t.fillRect(0, 0, 64, 64);
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(img, 0, 2 * fs, fs, fs, off, off, fs, fs);
  ctx.drawImage(tmp, 0, 0, cw, ch);
}

/* Portrait frame for character layers — same lightness-matching recolour the
   animated sprite uses, so a portrait matches the sprite in the dungeon. */
function drawCharacterPortraitFrame(ctx, img, tintColor) {
  if (!tintColor) { drawPortraitFrame(ctx, img, null); return; }
  const fs = frameSizeOf(img, ANIM_META.walk) || 64;
  const off = (64 - fs) / 2;
  const tc = document.createElement('canvas'); tc.width = 64; tc.height = 64;
  const t = tc.getContext('2d');
  t.drawImage(img, 0, 2 * fs, fs, fs, off, off, fs, fs);
  const id = t.getImageData(0, 0, 64, 64);
  recolorPixels(id.data, tintColor, true);
  t.putImageData(id, 0, 0);
  const cw = ctx.canvas.width || 64;
  const ch = ctx.canvas.height || 64;
  ctx.drawImage(tc, 0, 0, cw, ch);
}

export async function drawHeroPortrait(canvas, hero){
  if (!canvas) return;
  if (!canvas.width || canvas.width === 300) canvas.width = 64;
  if (!canvas.height || canvas.height === 150) canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const token = (canvas._portraitToken = (canvas._portraitToken || 0) + 1);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const visual = hero.visual || {};
  const equipment = hero.equipment || {};
  const paths = buildLayerPaths(visual, equipment);

  for(const layer of LAYER_ORDER){
    if(!paths[layer]) continue;
    const img = await loadImage(`${ASSETS_ROOT}${paths[layer]}/walk.png`);
    if(canvas._portraitToken !== token) return;   // a newer draw superseded us
    if(!img) continue;
    if(isCharacterLayer(layer)) drawCharacterPortraitFrame(ctx, img, layerTint(layer, visual, equipment));
    else drawPortraitFrame(ctx, img, layerTint(layer, visual, equipment));
  }
}

/* ---------------- Wolf Sprite Animator ----------------
   Supports two modes, selected by hero.visual:
   - singleImage : one full-frame static sprite (e.g. sprites/wolf.png, 64x64).
     No UV slicing or frame animation — the whole texture is the wolf.
   - atlas       : a sliced sheet (visual.atlasTotalCols / atlasOriginCol /
     atlasRows). For wolfsheet1.png the usable frames occupy the right half —
     5 cols x 6 rows of 64px cells starting at column 5 (x=320).
   Row map (atlas mode): 0 Down (3f) · 1 Left (5f) · 2 Right (5f) ·
   3 Up (5f) · 4 Bite/Attack (5f).
*/
const DIRS_WOLF = { down: 0, left: 1, right: 2, up: 3 };

export class WolfSprite {
  constructor(hero, color) {
    this.visual = hero.visual || {};
    this.color = color || 0xa0c080;
    this.material = configureSpriteMaterial(new THREE.SpriteMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      alphaTest: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    }));
    this.mesh = new THREE.Sprite(this.material);
    this.mesh.renderOrder = 1;
    this._curCell = 64;
    const sx = this.visual.spriteScaleX || 1.0;
    const sy = this.visual.spriteScaleY || 1.0;
    this.mesh.scale.set(1.125 * sx, 1.125 * sy, 1);
    this.mesh.center.set(0.5, 0.04);
    this.mesh.visible = false;

    this.state = 'walk';
    this.dir = 'down';
    this.time = 0;
    this.animating = true;
    this._dying = false;
    this._deathDone = false;

    /* Single-image mode (visual.singleImage): loads one full-frame texture
       with no UV slicing or animation — a static sprite. Otherwise the texture
       is treated as an atlas sliced via the visual.atlas* params below. */
    this.single = !!this.visual.singleImage;
    this.atlas = this.single ? null : {
      totalCols: this.visual.atlasTotalCols || 10,
      originCol: this.visual.atlasOriginCol != null ? this.visual.atlasOriginCol : 5,
      rows: this.visual.atlasRows || 6
    };
    const path = this.visual.spriteSheet
      || (this.single ? 'sprites/wolf.png' : 'sprites/wolfsheet1.png');
    const loader = new THREE.TextureLoader();
    this._readyPromise = new Promise(resolve => {
      loader.load(path, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        if (this.single) { tex.repeat.set(1, 1); tex.offset.set(0, 0); }
        else { tex.repeat.set(1 / this.atlas.totalCols, 1 / this.atlas.rows); }
        this.texture = tex;
        this.material.map = tex;
        this.material.needsUpdate = true;
        this.mesh.visible = true;
        if (!this.single) this.updateUV();
        resolve();
      }, undefined, resolve);
    });
  }

  whenReady() {
    return this._readyPromise || Promise.resolve();
  }

  applyCell(cell) {
    const sx = this.visual.spriteScaleX || 1.0;
    const sy = this.visual.spriteScaleY || 1.0;
    this.mesh.scale.set(1.125 * sx, 1.125 * sy, 1);
    this.mesh.center.set(0.5, 0.04);
  }

  reloadAll() {}

  play(action, force = false) {
    if (this.state === action && !force) return;
    this.state = action;
    this.time = 0;
    this.animating = true;
    this._dying = false;
    this.updateUV();
  }

  playDeath() {
    this.state = 'hurt';
    this.time = 0;
    this.animating = true;
    this._dying = true;
    this._deathDone = false;
    this.dir = 'down';
    this.updateUV();
  }

  setDirection(dx, dz) {
    if (Math.abs(dx) > Math.abs(dz)) {
      this.dir = dx > 0 ? 'right' : 'left';
    } else if (Math.abs(dz) > 0.05) {
      this.dir = dz > 0 ? 'down' : 'up';
    }
  }

  update(dt) {
    if (this.animating) this.time += dt;
    this.updateUV();
  }

  updateUV() {
    if (!this.texture || this.single) return;   // single image: whole texture is one frame
    let row = 0;
    let maxCols = 5;
    let col = 0;

    if (this.state === 'slash' || this.state === 'thrust' || this.state === 'spellcast' || this.state === 'shoot') {
      row = 4;
      maxCols = 5;
      col = Math.floor(this.time * 12) % maxCols;
      if (this.time * 12 >= maxCols) {
        col = maxCols - 1;
        this.animating = false;
      }
    } else if (this.state === 'hurt') {
      row = 4;
      col = 4;
      if (this.time * 8 >= 1) {
        if (this._dying) {
          this._deathDone = true;
        } else {
          this.play('walk');
          return;
        }
      }
    } else {
      row = DIRS_WOLF[this.dir] != null ? DIRS_WOLF[this.dir] : 0;
      maxCols = row === 0 ? 3 : 5;
      if (this.state === 'idle') {
        col = 0;
      } else {
        col = Math.floor(this.time * 10) % maxCols;
      }
    }

    const { totalCols, originCol, rows } = this.atlas;
    const uOffset = (originCol + col) / totalCols;
    const vOffset = (rows - 1 - row) / rows;
    this.texture.offset.set(uOffset, vOffset);
  }
}

export class BeastSprite {
  constructor(hero, color, formConfig = {}) {
    this.visual = hero.visual || {};
    this.color = color || 0x2ecc71;
    this.material = configureSpriteMaterial(new THREE.SpriteMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      alphaTest: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    }));
    this.mesh = new THREE.Sprite(this.material);
    this.mesh.renderOrder = 10;

    const sx = (this.visual.spriteScaleX || 1.0) * ((formConfig.scaleX || 1.6) * 0.75);
    const sy = (this.visual.spriteScaleY || 1.0) * ((formConfig.scaleY || 1.6) * 0.75);
    this.mesh.scale.set(sx, sy, 1);
    this.mesh.center.set(0.5, 0.04);
    this.mesh.visible = false;

    this.state = 'walk';
    this.dir = 'down';
    this.time = 0;
    this.animating = true;
    this._dying = false;

    const path = formConfig.sprite || 'sprites/wolf.png';
    const loader = new THREE.TextureLoader();
    this._readyPromise = new Promise(resolve => {
      loader.load(path, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.repeat.set(1, 1);
        tex.offset.set(0, 0);
        this.texture = tex;
        this.material.map = tex;
        this.material.needsUpdate = true;
        this.mesh.visible = true;
        resolve();
      }, undefined, resolve);
    });
  }

  whenReady() {
    return this._readyPromise || Promise.resolve();
  }

  applyCell(cell) {}
  reloadAll() {}
  play(action, force = false) {}
  playDeath() {}
  setDirection(dx, dz) {}
  update(dt) {}
}

