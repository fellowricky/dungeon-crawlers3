/**
 * Entity visuals — low-poly procedural minis for heroes and monsters,
 * matching the painted-miniature look of the dungeon (no disk assets).
 * Each entity is a THREE.Group with a body and a billboarded HP bar.
 */
import * as THREE from 'three';
import { CLASSES, WILD_SHAPE_FORMS } from './srd.js';
import { HeroSprite, WolfSprite, BeastSprite, configureSpriteMaterial, pickFlip } from './sprite_animator.js';
import { tickPose } from './sprite_pose.js';

/* A twin sprite (x-ray ghost, hit overlay) bends with its body. */
function copyPose(from, to) {
  const a = from.userData && from.userData.sprPose, b = to.userData && to.userData.sprPose;
  if (!a || !b) return;
  b.pose.value.copy(a.pose.value);
  b.dir.value.copy(a.dir.value);
}
import { measureFrameAnchor, resolveAtlasAnchor, applyAtlasAnchor, atlasDuration, attackImpactDelay as atlasAttackImpactDelay,
         sharedSheetTexture, sharedSheetFromLoader, warmSharedSheet, evictSharedSheets, nextAnimPhase } from './sprite_atlas.js';
import { GIGAPACK_REGISTRY } from './gigapack_registry.js';
import LIB from './vfx_animations.json' with { type: 'json' };
import { isIdentityColorBalance, loadBalancedCanvas, colorBalanceKey } from './color_balance.js';
import { playNixieEffect, stopNixieEffect, warmupNixieVfx } from '../render/nixie_vfx.js';
import { spawnPixelVfx, updatePixelVfx, clearPixelVfx, PIXEL_VFX_PRESETS } from '../render/pixel_vfx.js';
import { clearLivePixelFx, spawnLiveBeam, spawnLivePixelFx } from '../render/pixelfx_live.js';
import * as holyPillarFx from '../vendor/pixelfx/fx/holy/holy-pillar.js';
import * as flamePillarFx from '../vendor/pixelfx/fx/fire/flame-pillar.js';
import { rampFrom } from '../render/pfx/ramps.js';
import { syncStatusAuras } from '../render/status_auras.js';
import { preloadCommonSFX } from './audio.js';
import { updateLoadingProgress } from '../ui/loading_screen.js';
import { DAMAGE_TYPE_ICONS } from './constants.js';
import { reportError } from './errors.js';
import { spanRibbon, cameraBasisFromYawPitch, cameraBasisFromMatrix } from './span_ribbon.js';

const _c = new THREE.Color();

/* -------- HP bar sprite (canvas-backed, updated on damage) -------- */
function makeBar(){
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 10;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map:tex, transparent:true, depthTest:false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.9, 0.14, 1);
  spr.renderOrder = 50;
  return { spr, cv, g: cv.getContext('2d'), tex, isCircular: false };
}

function makeCircularBar(baseColor) {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  
  const geom = new THREE.PlaneGeometry(0.55, 0.55).rotateX(-Math.PI / 2).translate(0, 0.02, 0);
  const mesh = new THREE.Mesh(geom, mat);
  
  return { spr: mesh, cv, g: cv.getContext('2d'), tex, isCircular: true, baseColor };
}

export function drawBar(bar, frac, color='#4ade4a'){
  const { g, cv, tex, isCircular, baseColor } = bar;
  g.clearRect(0,0,cv.width,cv.height);
  
  if (isCircular) {
    const cx = cv.width / 2;
    const cy = cv.height / 2;
    const r = 24;
    const lineWidth = 6;
    
    // 1. Draw full background track ring (dark grey, semi-transparent)
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.lineWidth = lineWidth;
    g.strokeStyle = 'rgba(25, 25, 30, 0.5)';
    g.stroke();
    
    // 2. Draw active health arc (from top, clockwise)
    if (frac > 0) {
      g.beginPath();
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (Math.PI * 2 * Math.max(0, Math.min(1, frac)));
      g.arc(cx, cy, r, startAngle, endAngle);
      g.lineWidth = lineWidth;
      g.strokeStyle = frac > 0.5 ? (baseColor || color) : (frac > 0.25 ? '#e8b23f' : '#e0483a');
      g.stroke();
    }
  } else {
    g.fillStyle = 'rgba(10,10,14,0.75)';
    g.fillRect(0,0,cv.width,cv.height);
    g.fillStyle = frac > 0.5 ? color : (frac > 0.25 ? '#e8b23f' : '#e0483a');
    g.fillRect(1,1,(cv.width-2)*Math.max(0,frac),cv.height-2);
  }
  
  tex.needsUpdate = true;
}

/* -------- status effect tray sprite (above entity heads) -------- */
export function makeStatusTray() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = configureSpriteMaterial(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false }));
  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.35, 0.34, 1);
  spr.position.set(0, 1.25, 0); // Positioned above entity head
  spr.renderOrder = 55;
  return { spr, cv, g: cv.getContext('2d'), tex };
}

export function drawStatusTray(tray, entity) {
  const { g, cv, tex } = tray;
  g.clearRect(0, 0, cv.width, cv.height);

  if (!entity || !entity._effects) {
    tex.needsUpdate = true;
    return;
  }

  const effects = Object.keys(entity._effects);
  if (effects.length === 0) {
    tex.needsUpdate = true;
    return;
  }

  const EFFECT_ICONS = {
    raging: '😡',
    hasted: '⚡',
    inspired: '✨',
    shielded: '🛡️',
    sacredWeapon: '⚔️',
    bearTotem: '🐻',
    wildShape: '🐺',
    phaseStep: '👥',
    remarkableAthlete: '🏃',
    deathWarded: '👼',
    blinded: '👁️',
    charmed: '💜',
    frightened: '😱',
    poisoned: '🤢',
    paralyzed: '🌀',
    stunned: '💫',
    restrained: '🕸️',
    slowed: '⏳',
    burning: '🔥',
    prone: '🛌',
    deafened: '🔇',
    incapacitated: '✖️',
    unconscious: '💤',
    weakenedDmg: '🥀',
    baned: '📉',
    faerieFire: '🧚',
    guided: '✦',
    hexMarked: '🔮',
    huntersMarked: '🎯',
    bloodlust: '🩸',
    patientDefense: '🛡️',
    enlarged: '💪',
    silenced: '🤫',
    warded: '🔰',
    crusadersMantle: '✝️',
    dominated: '🧠',
    blessed: '🙏',
    dashing: '💨',
    regenerating: '🌿',
    mirrorImages: '🪞',
    polymorphed: '🐑',
    banished: '🌀'
  };

  g.font = 'bold 44px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = '#000000';

  const size = 48;
  const totalW = effects.length * size;
  const startX = (cv.width - totalW) / 2 + size / 2;

  for (let i = 0; i < effects.length; i++) {
    const key = effects[i];
    const icon = EFFECT_ICONS[key] || '⭐';
    const x = startX + i * size;
    const y = cv.height / 2;

    g.strokeText(icon, x, y);
    g.fillText(icon, x, y);
  }

  tex.needsUpdate = true;
}

export function updateStatusTray(e) {
  if (!e || !e.ent || !e.ent.statusTray) return;
  const effects = e._effects ? Object.keys(e._effects).sort().join(',') : '';
  if (e._lastEffectsStr !== effects) {
    e._lastEffectsStr = effects;
    drawStatusTray(e.ent.statusTray, e);
  }
}

export function makeTurnHighlight(isHero = true) {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, isHero ? 'rgba(255, 230, 110, 0.95)' : 'rgba(255, 70, 70, 0.95)');
  grad.addColorStop(0.5, isHero ? 'rgba(255, 170, 30, 0.50)' : 'rgba(255, 30, 30, 0.50)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mat = configureSpriteMaterial(new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
  }), { forwardBias: 0.15 });

  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.24, 1.39, 1.0);
  spr.position.set(0, 0.52, -0.15); // Directly behind the entity sprite billboard
  spr.renderOrder = 0; // Drawn BEFORE entity sprite
  spr.visible = false;

  return { group: spr, spr, mat };
}

/* -------- hero mini: 2D animated LPC sprite -------- */
/* ─────────────── X-ray silhouettes through walls ───────────────
   An occluded hero or monster gets a translucent twin so the party stays
   readable behind geometry. The twin is a child Sprite whose material draws
   ONLY where the depth buffer already holds something nearer
   (depthFunc: GreaterDepth) — that comparison is the per-pixel definition of
   "occluded", so there is no CPU raycast per entity per frame.

   Being a CHILD of the real sprite is load-bearing: transform, scale and
   visibility are all inherited, which is what stops a hidden monster leaking
   its position through a wall the moment it is culled. */
export const XRAY_HERO_TINT = 0x8fd8ff;   // cold blue — reads as "ally, elsewhere"
export const XRAY_FOE_TINT  = 0xff8a7a;   // warm red  — reads as "threat, elsewhere"

const XRAY_OPACITY = 0.42;

export function attachXrayGhost(anim, tint) {
  if (!anim || !anim.mesh) return null;
  const src = anim.mesh;

  /* configureSpriteMaterial supplies the depth-tilt vertex patch. The twin MUST
     carry it too: without the same tilt it is compared against walls at a
     different depth than the sprite it stands in for, and the silhouette
     detaches from the body — visible as a ghost that pops on a frame early. */
  const mat = configureSpriteMaterial(new THREE.SpriteMaterial({
    map: src.material.map,
    color: tint,
    transparent: true,
    opacity: XRAY_OPACITY,
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth
  }));

  const tilt = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    tilt(shader, renderer);
    /* Flatten to a silhouette: take COLOUR from the tint (`diffuse`) instead of
       the texture, while alpha still flows from map_fragment into
       opaque_fragment — so the twin keeps the sprite's exact cut-out shape
       rather than becoming a tinted rectangle. */
    shader.fragmentShader = shader.fragmentShader.replace(
      'outgoingLight = diffuseColor.rgb;',
      'outgoingLight = diffuse;'
    );
  };
  /* A distinct cache key is mandatory. Same key + different fragment shader and
     three hands back the OPAQUE sprite's already-compiled program, at which
     point the silhouette quietly stops existing. */
  mat.customProgramCacheKey = () => 'xrayDepthTiltSprite';

  const ghost = new THREE.Sprite(mat);
  ghost.renderOrder = (src.renderOrder || 0) + 1;
  ghost.center.copy(src.center);

  /* The twin has no animation state of its own — it mirrors whatever the real
     sprite is showing this frame. */
  ghost.onBeforeRender = () => {
    const sm = src.material;
    const hadMap = mat.map != null;
    mat.map = sm.map;
    mat.rotation = sm.rotation;
    copyPose(sm, mat);
    ghost.center.copy(src.center);
    /* Gaining or losing a map flips the USE_MAP define, and only THAT needs a
       recompile. Setting needsUpdate on every frame swap would rebuild the
       program once per animation frame, per entity. */
    if ((sm.map != null) !== hadMap) mat.needsUpdate = true;
  };

  src.add(ghost);
  anim.xray = ghost;
  return ghost;
}

export function makeHeroMesh(hero){
  const cls = CLASSES[hero.classKey] || CLASSES.fighter;
  const color = cls ? cls.color : 0xa0c080;
  const grp = new THREE.Group();

  // Create the animated sprite using Wild Shape, WolfSprite, or HeroSprite
  let anim;
  if (hero.inWildShape && hero.wildShapeActiveForm && WILD_SHAPE_FORMS[hero.wildShapeActiveForm]) {
    const formDef = WILD_SHAPE_FORMS[hero.wildShapeActiveForm];
    anim = new BeastSprite(hero, color, formDef);
  } else if (hero.isWolf || hero.raceKey === 'wolf' || hero.classKey === 'wolf' || hero.visual?.isWolf || hero.visual?.spriteSheet) {
    anim = new WolfSprite(hero, color);
  } else {
    anim = new HeroSprite(hero, color);
  }
  if (anim.mesh) anim.mesh.renderOrder = 10;
  grp.add(anim.mesh);
  attachXrayGhost(anim, XRAY_HERO_TINT);
  attachHitOverlay(anim);

  const bar = makeCircularBar(color);
  drawBar(bar, 1);
  grp.add(bar.spr);

  const statusTray = makeStatusTray();
  grp.add(statusTray.spr);

  const turnHighlight = makeTurnHighlight(true);
  grp.add(turnHighlight.group);

  return { grp, bar, anim, statusTray, turnHighlight };
}

/* -------- rival hero mini: 2D animated LPC sprite configured as foe -------- */
export function makeRivalHeroMesh(hero){
  const cls = CLASSES[hero.classKey] || CLASSES.fighter;
  const foeBarColor = '#e0483a';
  const grp = new THREE.Group();

  const anim = new HeroSprite(hero, cls ? cls.color : 0xa0c080);
  if (anim.mesh) anim.mesh.renderOrder = 10;
  grp.add(anim.mesh);
  attachXrayGhost(anim, XRAY_FOE_TINT);
  attachHitOverlay(anim);

  const bar = makeCircularBar(foeBarColor);
  drawBar(bar, 1);
  grp.add(bar.spr);

  const statusTray = makeStatusTray();
  grp.add(statusTray.spr);

  const turnHighlight = makeTurnHighlight(false);
  grp.add(turnHighlight.group);

  return { grp, bar, anim, statusTray, turnHighlight };
}

export function swapHeroSprite(heroEnt, heroData) {
  if (!heroEnt || !heroEnt.grp || !heroEnt.anim) return;
  const cls = CLASSES[heroData.classKey] || CLASSES.fighter;
  const color = cls ? cls.color : 0xa0c080;
  
  if (heroEnt.anim && heroEnt.anim.mesh) {
    heroEnt.grp.remove(heroEnt.anim.mesh);
  }
  
  let anim;
  if (heroData.inWildShape && heroData.wildShapeActiveForm && WILD_SHAPE_FORMS[heroData.wildShapeActiveForm]) {
    const formDef = WILD_SHAPE_FORMS[heroData.wildShapeActiveForm];
    anim = new BeastSprite(heroData, color, formDef);
  } else if (heroData.isWolf || heroData.raceKey === 'wolf' || heroData.classKey === 'wolf' || heroData.visual?.isWolf || heroData.visual?.spriteSheet) {
    anim = new WolfSprite(heroData, color);
  } else {
    anim = new HeroSprite(heroData, color);
  }
  
  if (anim.mesh) anim.mesh.renderOrder = 10;
  heroEnt.anim = anim;
  heroEnt.grp.add(anim.mesh);
  /* The old twin was a child of the sprite we just replaced, so it left with
     it — the rebuilt sprite needs its own or the hero stops showing through
     walls the first time they wild shape. */
  attachXrayGhost(anim, XRAY_HERO_TINT);
  attachHitOverlay(anim);
}

const _bottomPadCache = new WeakMap();

export function getSpriteBottomPadding(img) {
  if (!img || typeof document === 'undefined') return 0;
  if (_bottomPadCache.has(img)) return _bottomPadCache.get(img);

  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return 0;

    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;

    let bottom = -1;
    for (let y = h - 1; y >= 0; y--) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 15) {
          bottom = y;
          break;
        }
      }
      if (bottom !== -1) break;
    }

    const pad = bottom === -1 ? 0 : (h - 1 - bottom);
    const padNorm = pad / h;
    _bottomPadCache.set(img, padNorm);
    return padNorm;
  } catch (e) {
    return 0;
  }
}

/** A bare filename in a monster record is a DCSS monster tile; anything
    already rooted (dcss/, sprites/, ./, /, http, data:) is used as given. */
export function resolveMonsterSpritePath(p, fallback = null) {
  if (!p) return fallback;
  if (/^(dcss\/|sprites\/|\.\/|\/|http|data:)/.test(p)) return p;
  return 'dcss/monster/' + p;
}

/** Every sheet a monster record's `animations` block will load, resolved. */
export function monsterSheetUrls(mon) {
  const out = [];
  const a = mon && mon.animations;
  if (!a) return out;
  for (const k of ['idle', 'attack', 'walk']) {
    const cfg = a[k];
    if (cfg && (cfg.sprite || mon.sprite)) out.push(resolveMonsterSpritePath(cfg.sprite || mon.sprite));
  }
  return out;
}

/* -------- animated monster mini: frame-sliced atlas sprite --------
   A monster record may carry an `animations` block (written by the bestiary
   editor) with `idle` and/or `attack` frame-sliced atlas configs:

     animations: {
       idle:   { sprite, frameWidth:96, frameHeight:96, cols:8, rows:1, fps:8, frames?, loop:true },
       attack: { sprite, frameWidth:96, frameHeight:96, cols:6, rows:1, fps:12, frames?, loop:false }
     }

   `frames` is an optional array of sheet indices (row-major) to play; when
   omitted the whole sheet plays in order. Frame size drives the billboard size
   exactly like the static path (framePx / 32 * 1.5 * mon.scale), so larger
   atlases (e.g. 128px or 192px frames) scale up automatically. The colour
   balance block is baked into each atlas the same way as static sprites. */
function buildMonsterAnimator(mon, fallbackSprite, cb) {
  const s = mon.scale || 1.0;
  const raw = mon.animations || {};
  const keys = ['idle', 'attack'];

  const mat = configureSpriteMaterial(new THREE.SpriteMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    alphaTest: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  }));
  const mesh = new THREE.Sprite(mat);
  mesh.renderOrder = 10;
  mesh.center.set(0.5, 0);
  mesh.position.y = (mon.yOffset || 0) * 0.02;
  mesh.visible = false;

  const anim = {
    mesh,
    animated: true,
    state: 'idle',
    time: 0,
    textures: {},   // state -> { tex, cfg }
    _flipX: !!mon.flipX,   // see the facing convention note in makeMonsterMesh
    _frame: 0,
    play(action, force = false) {
      if (action !== 'idle' && action !== 'attack') return;  // 'hurt' → stay idle
      if (!this.textures[action]) return;
      if (this.state === action && !force) return;
      this.state = action;
      this.time = 0;
      this._frame = 0;
      this._apply();
    },
    setDirection(dx, dz, band) {
      /* Hysteresis on the heading (see pickFlip), before the sheet's mirroring. */
      const inv = !!mon.flipX;
      const right = pickFlip(this._flipX == null ? null : (this._flipX !== inv), dx, dz, band);
      const flip = inv ? !right : right;
      if (flip === this._flipX) return;
      this._flipX = flip;
      this._apply();
    },
    /* Length of the one-shot attack sheet, and how far into it the blow
       lands (ATTACK_IMPACT_FRAC). monster_ai defers damage and projectile
       release by attackImpactDelay(); without these it read 0 and every
       arrow left on the wind-up frame. Both 0 while the sheet is still
       loading, so an unanimated monster keeps its instant timing. */
    attackDuration() {
      const t = this.textures.attack;
      return t ? atlasDuration(t.cfg) : 0;
    },
    attackImpactDelay() {
      const t = this.textures.attack;
      return t ? atlasAttackImpactDelay(t.cfg) : 0;
    },
    update(dt) {
      const t = this.textures[this.state];
      if (!t) return;
      this.time += dt;
      const cfg = t.cfg;
      const seq = cfg.frames && cfg.frames.length ? cfg.frames : null;
      const count = seq ? seq.length : cfg.cols * cfg.rows;
      if (count <= 0) return;
      const idx = Math.floor(this.time * cfg.fps);
      if (cfg.loop) {
        this._frame = idx % count;
      } else {
        if (idx >= count) {
          // one-shot attack finished → settle back into idle
          this.play('idle');
          return;
        }
        this._frame = idx;
      }
      this._apply();
    },
    _apply() {
      const t = this.textures[this.state];
      if (!t) return;
      const cfg = t.cfg;
      if (mat.map !== t.tex) {
        mat.map = t.tex;
        mesh.visible = true;
      }
      /* Anchor on the body, not the frame — the sheet is padded for the
         attack swing, and the anchor must mirror with the flip. See
         resolveAtlasAnchor for why every state anchors on the idle sheet. */
      applyAtlasAnchor(mesh, resolveAtlasAnchor(this.textures, this.state), this._flipX);
      mesh.scale.set(
        (cfg.frameWidth / 32) * 1.125 * s,
        (cfg.frameHeight / 32) * 1.125 * s,
        1
      );
      const seq = cfg.frames && cfg.frames.length ? cfg.frames : null;
      const count = seq ? seq.length : cfg.cols * cfg.rows;
      const frameIndex = seq ? seq[this._frame % count] : (this._frame % count);
      const totalCols = cfg.cols;
      const totalRows = cfg.rows;
      const f = Math.max(0, Math.min(frameIndex, totalCols * totalRows - 1));
      const col = f % totalCols;
      const row = Math.floor(f / totalCols);
      const invCols = 1 / totalCols;
      const invRows = 1 / totalRows;
      if (this._flipX) {
        t.tex.repeat.set(-invCols, invRows);
        t.tex.offset.set((col + 1) * invCols, (totalRows - 1 - row) * invRows);
      } else {
        t.tex.repeat.set(invCols, invRows);
        t.tex.offset.set(col * invCols, (totalRows - 1 - row) * invRows);
      }
    }
  };

  const resolvePath = (p) => resolveMonsterSpritePath(p, fallbackSprite);

  const cfgFor = (key, defaults) => {
    const r = raw[key];
    if (!r) return null;
    const frames = Array.isArray(r.frames)
      ? r.frames.map(Number).filter(Number.isFinite)
      : null;
    return {
      key,
      sprite: resolvePath(r.sprite || mon.sprite || fallbackSprite),
      frameWidth: Math.max(1, Math.round(r.frameWidth || defaults.frameWidth || 96)),
      frameHeight: Math.max(1, Math.round(r.frameHeight || defaults.frameHeight || 96)),
      cols: Math.max(1, Math.round(r.cols || defaults.cols || 8)),
      rows: Math.max(1, Math.round(r.rows || defaults.rows || 1)),
      fps: Math.max(0.1, r.fps || defaults.fps || 8),
      loop: r.loop !== false,
      frames,
      anchorX: Number.isFinite(r.anchorX) ? r.anchorX : null,
      anchorY: Number.isFinite(r.anchorY) ? r.anchorY : null
    };
  };

  /* If every configured atlas fails to load (bad path, missing file), fall back
     to the monster's static sprite so it never renders invisible. */
  let configuredCount = 0;
  let failedCount = 0;
  let staticShown = false;

  const applyStatic = (tex, imgW, imgH) => {
    if (staticShown) return;
    staticShown = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.repeat.set(1, 1);
    tex.offset.set(0, 0);
    mat.map = tex;
    mesh.visible = true;
    mesh.scale.set(
      ((imgW || 32) / 32.0) * 1.125 * s,
      ((imgH || 32) / 32.0) * 1.125 * s,
      1
    );
  };

  const showStaticFallback = () => {
    if (staticShown) return;
    staticShown = true;
    if (isIdentityColorBalance(cb)) {
      new THREE.TextureLoader().load(fallbackSprite, (t) => {
        applyStatic(t, t.image?.naturalWidth || t.image?.width, t.image?.naturalHeight || t.image?.height);
      });
    } else {
      loadBalancedCanvas(fallbackSprite, cb, (canvas) => {
        applyStatic(new THREE.CanvasTexture(canvas), canvas.width, canvas.height);
      });
    }
  };

  /* After any sheet loads/fails, settle on the best thing to display: the
     resting state's own sheet → idle → any loaded sheet → static fallback.
     Handles a missing/broken idle (shows attack frames instead of nothing). */
  const settle = () => {
    if (staticShown) return;
    if (anim.textures[anim.state]) { anim._frame = 0; anim._apply(); return; }
    if (anim.textures.idle) { anim.state = 'idle'; anim._frame = 0; anim._apply(); return; }
    if (Object.keys(anim.textures).length > 0) {
      anim.state = Object.keys(anim.textures)[0];
      anim._frame = 0;
      anim._apply();
      return;
    }
    if (configuredCount > 0 && failedCount >= configuredCount) showStaticFallback();
  };

  const onTexture = (cfg, tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.repeat.set(1 / cfg.cols, 1 / cfg.rows);
    tex.offset.set(0, 0);
    cfg.anchor = measureFrameAnchor(tex.image, cfg) || { x: 0.5, y: 0 };
    anim.textures[cfg.key] = { tex, cfg };
    /* The idle sheet's anchor governs every state, so its arrival re-plants a
       sprite that is already showing its attack sheet. */
    if (mat.map && anim.textures[anim.state]) anim._apply();
    settle();
  };

  const loadKey = (key) => {
    const cfg = cfgFor(key, {});
    if (!cfg) return;
    configuredCount++;
    const onError = () => { failedCount++; settle(); };
    /* One decode and one upload per sheet, however many of this creature the
       floor holds — see sharedSheetTexture. Each instance gets a clone for
       its own frame offset. */
    if (isIdentityColorBalance(cb)) {
      sharedSheetTexture(cfg.sprite, (tex) => onTexture(cfg, tex), onError);
    } else {
      sharedSheetFromLoader(cfg.sprite + '#' + colorBalanceKey(cb),
        (ok, fail) => loadBalancedCanvas(cfg.sprite, cb, (canvas) => ok(new THREE.CanvasTexture(canvas)), fail),
        (tex) => onTexture(cfg, tex), onError);
    }
  };
  for (const key of keys) loadKey(key);

  return { mesh, anim };
}

/* -------- monster mini: DCSS sprite -------- */
export function makeMonsterMesh(mon){
  const grp = new THREE.Group();
  const s = mon.scale || 1.0;
  const n = mon.name ? mon.name.toLowerCase() : '';
  
  let rawSprite = mon.sprite || 'orc.png';
  let spritePath = rawSprite;
  if (!rawSprite.startsWith('dcss/') && !rawSprite.startsWith('sprites/') && !rawSprite.startsWith('./') && !rawSprite.startsWith('/') && !rawSprite.startsWith('http') && !rawSprite.startsWith('data:')) {
    spritePath = 'dcss/monster/' + rawSprite;
  }

  const cb = mon.colorBalance;
  const hasAnimations = !!(mon.animations && (mon.animations.idle || mon.animations.attack));

  let mesh;
  let anim;
  if (hasAnimations) {
    const built = buildMonsterAnimator(mon, spritePath, cb);
    mesh = built.mesh;
    anim = built.anim;
  } else {
    /* Fit the billboard to the sprite's real pixel size (DCSS sheets are not all 32px). */
    let baseSX = 1.125 * s, baseSY = 1.125 * s;
    const fitToImage = (img, imgW, imgH) => {
      const padNorm = getSpriteBottomPadding(img);
      mesh.center.set(0.5, padNorm);
      baseSX = ((imgW || 32) / 32.0) * 1.125 * s;
      baseSY = ((imgH || 32) / 32.0) * 1.125 * s;
      mesh.scale.set(baseSX, baseSY, 1);
    };

    /* The bestiary's colour-balance edits live on the monsters.json record. Baking
       them here is what makes the editor's tint show up in the actual dungeon;
       without a balance we keep the cheaper straight-to-GPU texture load. */
    let tex;
    if (isIdentityColorBalance(cb)) {
      tex = new THREE.TextureLoader().load(spritePath, (t) => {
        if (t && t.image) {
          fitToImage(t.image, t.image.naturalWidth || t.image.width, t.image.naturalHeight || t.image.height);
        }
      });
    } else {
      tex = new THREE.Texture();
      loadBalancedCanvas(spritePath, cb, (canvas) => {
        tex.image = canvas;
        tex.needsUpdate = true;
        fitToImage(canvas, canvas.width, canvas.height);
      });
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;

    /* Facing convention: source art is assumed to face LEFT, and setDirection mirrors
       the texture when the monster walks right. Art drawn facing right is therefore
       backwards for its whole life. `flipX` on the monster record inverts the
       baseline instead of mirroring the file on disk, so it stays a reversible data
       edit the bestiary can toggle. */
    const baseFlip = !!mon.flipX;
    const setMirror = (mirror) => {
      tex.repeat.x = mirror ? -1 : 1;
      tex.offset.x = mirror ? 1 : 0;
    };
    setMirror(baseFlip);

    const mat = configureSpriteMaterial(new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      alphaTest: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    }));
    mesh = new THREE.Sprite(mat);
    mesh.renderOrder = 10;
    mesh.center.set(0.5, 0);
    mesh.scale.set(1.125 * s, 1.125 * s, 1);
    mesh.position.y = (mon.yOffset || 0) * 0.02;

    /* Breathing idle. 388 of the 518 monsters are still single-frame tiles
       standing next to fully animated sprites, and a perfectly still body is
       what the eye lands on in a mixed room. A ±2% vertical swell anchored at
       the feet (the sprite's centre is its foot line) reads as breath from the
       fixed camera; the golden-ratio phase keeps a pack from swelling in
       unison. Runs on its own clock — `time` is zeroed while standing (see
       updateMonsterVisuals) and must stay that way for the walk bob. */
    const breathPhase = nextAnimPhase() * Math.PI * 2;
    const breathes = mon.breathe !== false;
    anim = {
      mesh,
      time: 0,
      _breath: 0,
      play: () => {},
      update: (dt) => {
        anim.time += dt;
        if (!breathes) return;
        anim._breath += dt;
        const k = Math.sin(anim._breath * (Math.PI * 2 / 2.6) + breathPhase);
        mesh.scale.set(baseSX * (1 - 0.008 * k), baseSY * (1 + 0.022 * k), 1);
      },
      setDirection: (dx, dz) => {
        if (dx > 0.1) setMirror(!baseFlip);
        else if (dx < -0.1) setMirror(baseFlip);
      }
    };
  }

  grp.add(mesh);
  attachXrayGhost(anim, XRAY_FOE_TINT);
  attachHitOverlay(anim);

  const bar = makeCircularBar('#e0483a');
  drawBar(bar, 1);
  grp.add(bar.spr);

  const statusTray = makeStatusTray();
  grp.add(statusTray.spr);

  const turnHighlight = makeTurnHighlight(false);
  grp.add(turnHighlight.group);

  return { grp, bar, anim, statusTray };
}

/* -------- floating damage/heal/status text -------- */
const puffPool = [];
const recentFloatPositions = [];

function pushActivePuffsUp(pos, minSepY = 0.58) {
  if (!pos) return;
  const targetX = pos.x;
  const targetZ = pos.z;
  const targetY = pos.y;

  // Find all nearby active puffs and sort them by ascending Y position
  const nearby = puffPool.filter(p => {
    if (!p || !p.spr || !p.spr.position) return false;
    const dx = p.spr.position.x - targetX;
    const dz = p.spr.position.z - targetZ;
    return Math.hypot(dx, dz) < 1.8 && p.spr.position.y >= targetY - 0.25;
  }).sort((a, b) => a.spr.position.y - b.spr.position.y);

  let currentMinY = targetY + minSepY;
  for (const p of nearby) {
    if (p.spr.position.y < currentMinY) {
      p.spr.position.y = currentMinY;
    }
    currentMinY = p.spr.position.y + minSepY;
  }
}

const DAMAGE_ICONS_SET = new Set([
  ...Object.values(DAMAGE_TYPE_ICONS || {}),
  '🛡️'
]);

export function parseFloatTextTokens(str) {
  if (!str) return [];
  const hasModifierBadge = str.includes('❌') || str.includes('⭕') || str.includes('🟢');
  const hasKnownDamageIcon = Object.values(DAMAGE_TYPE_ICONS || {}).some(icon => str.includes(icon)) || str.includes('🛡️');
  if (!hasModifierBadge && !hasKnownDamageIcon) {
    return [{ type: 'text', text: str }];
  }

  // Unicode grapheme splitter to avoid breaking emoji clusters (e.g. 🗡️, 🏹, 🌩️)
  const segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
  const chars = segmenter ? [...segmenter.segment(str)].map(s => s.segment) : Array.from(str);

  const tokens = [];
  let currentMode = null; // 'resist' | 'vuln' | null
  let textBuf = '';

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '❌') {
      if (textBuf) { tokens.push({ type: 'text', text: textBuf }); textBuf = ''; }
      currentMode = 'resist';
      continue;
    }
    if (ch === '⭕' || ch === '🟢') {
      if (textBuf) { tokens.push({ type: 'text', text: textBuf }); textBuf = ''; }
      currentMode = 'vuln';
      continue;
    }
    if (currentMode) {
      if (ch === ' ') {
        currentMode = null;
        textBuf += ch;
      } else {
        tokens.push({ type: 'badge', kind: currentMode, icon: ch });
      }
    } else if (DAMAGE_ICONS_SET.has(ch)) {
      if (textBuf) { tokens.push({ type: 'text', text: textBuf }); textBuf = ''; }
      tokens.push({ type: 'badge', kind: 'neutral', icon: ch });
    } else {
      textBuf += ch;
    }
  }
  if (textBuf) {
    tokens.push({ type: 'text', text: textBuf });
  }
  return tokens;
}

export function makeFloatText(scene, text, pos, color, isCrit = false) {
  if (!text) return;
  const str = String(text);

  /* 1. Dynamic Vertical Stacking Offset */
  const spawnPosY = pos.y + 0.2;
  pushActivePuffsUp(new THREE.Vector3(pos.x, spawnPosY, pos.z), 0.48);

  const now = performance.now();
  for (let i = recentFloatPositions.length - 1; i >= 0; i--) {
    if (now - recentFloatPositions[i].time > 600) recentFloatPositions.splice(i, 1);
  }

  let horizJitter = (Math.random() - 0.5) * 0.15;
  recentFloatPositions.push({ x: pos.x, z: pos.z, time: now });

  /* 2. Dynamic High-DPI Canvas Sizing & Multi-Layer Badges */
  const tokens = parseFloatTextTokens(str);
  const hasBadges = tokens.some(t => t.type === 'badge');

  const isVuln = str.includes('VULNERABLE') || tokens.some(t => t.kind === 'vuln');
  const isResist = str.includes('RESIST') || tokens.some(t => t.kind === 'resist');
  const isImmune = str.includes('IMMUNE');

  const fontSize = isCrit ? 36 : (isVuln || isImmune ? 32 : (isResist ? 32 : 30));
  const font = `bold ${fontSize}px 'Outfit', 'Inter', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', 'Verdana', sans-serif`;

  const measureCv = document.createElement('canvas');
  const measureCtx = measureCv.getContext('2d');
  measureCtx.font = font;

  // Measure all tokens
  let totalContentWidth = 0;
  for (const token of tokens) {
    if (token.type === 'text') {
      token.width = measureCtx.measureText(token.text).width;
    } else if (token.type === 'badge') {
      const iconW = measureCtx.measureText(token.icon).width;
      token.badgeSize = Math.max(fontSize * 1.1, iconW + 6);
      token.width = token.badgeSize + 4;
    }
    totalContentWidth += token.width;
  }

  const padX = isVuln || isResist || isImmune ? 44 : 36;
  const padY = isVuln || isResist || isImmune ? 22 : 18;
  const cvW = Math.max(120, Math.ceil(totalContentWidth + padX * 2));
  const cvH = Math.ceil(fontSize + padY * 2);

  const cv = document.createElement('canvas');
  cv.width = cvW;
  cv.height = cvH;
  const g = cv.getContext('2d');
  g.font = font;
  g.textBaseline = 'middle';

  const startX = (cvW - totalContentWidth) / 2;
  const centerY = cvH / 2;

  // Background badge pill for special modifiers
  if (isVuln && hasBadges) {
    g.fillStyle = 'rgba(12, 38, 20, 0.85)';
    g.strokeStyle = 'rgba(34, 197, 94, 0.85)';
    g.lineWidth = 2.2;
    const bw = totalContentWidth + 28, bh = fontSize + 14;
    g.beginPath();
    g.roundRect ? g.roundRect(startX - 14, centerY - bh / 2, bw, bh, 9) : g.rect(startX - 14, centerY - bh / 2, bw, bh);
    g.fill();
    g.stroke();
  } else if (isVuln) {
    g.fillStyle = 'rgba(40, 25, 5, 0.8)';
    g.strokeStyle = 'rgba(255, 215, 0, 0.85)';
    g.lineWidth = 2.5;
    const bw = totalContentWidth + 32, bh = fontSize + 14;
    g.beginPath();
    g.roundRect ? g.roundRect(startX - 16, centerY - bh / 2, bw, bh, 10) : g.rect(startX - 16, centerY - bh / 2, bw, bh);
    g.fill();
    g.stroke();
  } else if (isResist) {
    g.fillStyle = 'rgba(38, 16, 22, 0.85)';
    g.strokeStyle = 'rgba(239, 68, 68, 0.85)';
    g.lineWidth = 2.2;
    const bw = totalContentWidth + 28, bh = fontSize + 12;
    g.beginPath();
    g.roundRect ? g.roundRect(startX - 14, centerY - bh / 2, bw, bh, 8) : g.rect(startX - 14, centerY - bh / 2, bw, bh);
    g.fill();
    g.stroke();
  } else if (isImmune) {
    g.fillStyle = 'rgba(35, 35, 40, 0.85)';
    g.strokeStyle = 'rgba(180, 180, 190, 0.8)';
    g.lineWidth = 2;
    const bw = totalContentWidth + 28, bh = fontSize + 12;
    g.beginPath();
    g.roundRect ? g.roundRect(startX - 14, centerY - bh / 2, bw, bh, 8) : g.rect(startX - 14, centerY - bh / 2, bw, bh);
    g.fill();
    g.stroke();
  }

  // --- LAYER 1: Background indicator layers behind badges (Red X or Green Circle) ---
  let curX = startX;
  for (const token of tokens) {
    if (token.type === 'badge') {
      const centerX = curX + token.width / 2;
      if (token.kind === 'resist') {
        // Red X layer behind damage icon
        const r = fontSize * 0.44;
        // Background soft circular glow
        g.fillStyle = 'rgba(220, 38, 38, 0.32)';
        g.beginPath();
        g.arc(centerX, centerY, r * 1.18, 0, Math.PI * 2);
        g.fill();

        // Dark outline for contrast
        g.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        g.lineWidth = 5.5;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(centerX - r, centerY - r);
        g.lineTo(centerX + r, centerY + r);
        g.moveTo(centerX + r, centerY - r);
        g.lineTo(centerX - r, centerY + r);
        g.stroke();

        // Vivid Red X lines
        g.strokeStyle = '#ef4444';
        g.lineWidth = 3.5;
        g.beginPath();
        g.moveTo(centerX - r, centerY - r);
        g.lineTo(centerX + r, centerY + r);
        g.moveTo(centerX + r, centerY - r);
        g.lineTo(centerX - r, centerY + r);
        g.stroke();
      } else if (token.kind === 'vuln') {
        // Green Circle layer behind damage icon
        const r = fontSize * 0.46;
        // Luminous green circular background
        g.fillStyle = 'rgba(34, 197, 94, 0.35)';
        g.beginPath();
        g.arc(centerX, centerY, r, 0, Math.PI * 2);
        g.fill();

        // Dark outline ring for contrast
        g.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        g.lineWidth = 5.5;
        g.beginPath();
        g.arc(centerX, centerY, r, 0, Math.PI * 2);
        g.stroke();

        // Vivid Green Ring
        g.strokeStyle = '#22c55e';
        g.lineWidth = 3.5;
        g.beginPath();
        g.arc(centerX, centerY, r, 0, Math.PI * 2);
        g.stroke();
      } else if (token.kind === 'neutral') {
        // Subtle dark circular backing for neutral damage type icons
        const r = fontSize * 0.44;
        g.fillStyle = 'rgba(20, 24, 32, 0.42)';
        g.beginPath();
        g.arc(centerX, centerY, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    curX += token.width;
  }

  // --- LAYER 2: Foreground (Text & Damage Type Icons) ---
  curX = startX;
  for (const token of tokens) {
    if (token.type === 'text') {
      g.textAlign = 'left';
      g.lineWidth = isCrit ? 7 : 5;
      g.strokeStyle = 'rgba(0, 0, 0, 0.95)';
      g.lineJoin = 'round';
      g.strokeText(token.text, curX, centerY);

      g.fillStyle = isVuln ? '#4ade80' : (isResist ? '#ff8a7a' : (color || '#ffffff'));
      g.fillText(token.text, curX, centerY);

      if (isCrit) {
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(255, 215, 0, 0.85)';
        g.strokeText(token.text, curX, centerY);
      }
    } else if (token.type === 'badge') {
      const centerX = curX + token.width / 2;
      g.textAlign = 'center';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(0, 0, 0, 0.9)';
      g.lineJoin = 'round';
      g.strokeText(token.icon, centerX, centerY);
      g.fillText(token.icon, centerX, centerY);
    }
    curX += token.width;
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;

  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);

  const worldHeight = isCrit ? 0.60 : (isVuln || isResist ? 0.52 : 0.48);
  const aspect = cvW / cvH;
  const worldWidth = worldHeight * aspect;
  spr.scale.set(worldWidth, worldHeight, 1);

  if (isCrit) {
    spawnImpactBurst(scene, pos, 'fire', color || '#ff9900', 14);
  } else if (Math.random() < 0.35) {
    const cLower = String(color || '').toLowerCase();
    const pType = (cLower.includes('7f') || cLower.includes('cf') || cLower.includes('blue') || cLower.includes('cyan')) ? 'frost' :
                  (cLower.includes('59') || cLower.includes('green') || cLower.includes('2e')) ? 'poison' :
                  (cLower.includes('9f') || cLower.includes('purple') || cLower.includes('e6')) ? 'dark' : 'physical';
    spawnImpactBurst(scene, pos, pType, color, 7);
  }

  const finalPos = new THREE.Vector3(pos.x + horizJitter, spawnPosY, pos.z);
  spr.position.copy(finalPos);
  spr.renderOrder = isCrit ? 75 : 65;
  scene.add(spr);

  puffPool.push({
    spr,
    mat,
    tex,
    t: 0,
    dur: isCrit ? 1.3 : 1.1,
    baseScaleW: worldWidth,
    baseScaleH: worldHeight,
    isCrit
  });
}

let _measureCv = null;
let _measureCtx = null;
function getMeasureCtx(font) {
  if (typeof document === 'undefined') return null;
  if (!_measureCv) {
    _measureCv = document.createElement('canvas');
    _measureCtx = _measureCv.getContext('2d');
  }
  if (_measureCtx) _measureCtx.font = font;
  return _measureCtx;
}

/* -------- Floating Gold & Gear Loot Feedback Above Party Leader -------- */
export function makeLootFloatText(scene, pos, type = 'gold', data = null) {
  if (!scene || !pos) return;

  /* Push existing active float indicators up to form a clean vertical stack */
  const spawnPosY = pos.y + 0.35;
  pushActivePuffsUp(new THREE.Vector3(pos.x, spawnPosY, pos.z), 0.58);

  const now = performance.now();
  for (let i = recentFloatPositions.length - 1; i >= 0; i--) {
    if (now - recentFloatPositions[i].time > 800) recentFloatPositions.splice(i, 1);
  }
  recentFloatPositions.push({ x: pos.x, z: pos.z, time: now });

  let text = '';
  let icon = '';
  let mainColor = '#ffd700';
  let glowColor = 'rgba(255, 215, 0, 0.85)';

  if (type === 'gold') {
    icon = '🪙';
    const val = typeof data === 'number' ? data : (data?.amount || data || 0);
    text = `+${val} Gold`;
    mainColor = '#ffe052';
    glowColor = 'rgba(255, 200, 0, 0.9)';
    spawnImpactBurst(scene, pos, 'holy', '#ffd700', 14);
  } else {
    // gear / item
    icon = '🧰';
    const itemName = typeof data === 'string' ? data : (data?.name || 'Gear Found');
    text = itemName;
    const rarity = typeof data === 'object' && data?.rarity ? String(data.rarity).toLowerCase() : 'common';

    const RARITY_COLORS = {
      common: '#ffffff',
      uncommon: '#30e060',
      rare: '#3399ff',
      epic: '#bb55ff',
      legendary: '#ff9900'
    };
    mainColor = RARITY_COLORS[rarity] || '#ffffff';
    glowColor = mainColor;
    spawnImpactBurst(scene, pos, 'holy', mainColor, rarity === 'legendary' ? 18 : 10);
  }

  const fontSize = 32;
  const font = `bold ${fontSize}px 'Outfit', 'Inter', 'Verdana', sans-serif`;

  const measureCtx = getMeasureCtx(font);
  const iconWidth = measureCtx ? measureCtx.measureText(icon + ' ').width : 36;
  const textWidth = measureCtx ? measureCtx.measureText(text).width : 120;
  const totalContentWidth = iconWidth + textWidth;

  const padX = 36;
  const padY = 18;
  const cvW = Math.max(180, Math.ceil(totalContentWidth + padX * 2));
  const cvH = Math.ceil(fontSize + padY * 2);

  const cv = document.createElement('canvas');
  cv.width = cvW;
  cv.height = cvH;
  const g = cv.getContext('2d');

  const centerX = cvW / 2;
  const centerY = cvH / 2;

  // Background pill badge for extra pop & contrast
  const radius = cvH / 2 - 2;
  g.beginPath();
  if (g.roundRect) {
    g.roundRect(4, 4, cvW - 8, cvH - 8, radius);
  } else {
    g.rect(4, 4, cvW - 8, cvH - 8);
  }
  g.fillStyle = 'rgba(12, 16, 24, 0.88)';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = glowColor;
  g.stroke();

  g.font = font;
  g.textBaseline = 'middle';

  const startX = centerX - totalContentWidth / 2;

  // Draw Icon
  g.textAlign = 'left';
  g.shadowColor = glowColor;
  g.shadowBlur = 10;
  g.fillText(icon, startX, centerY);

  // Draw Text with stroke outline and glow fill
  const textX = startX + iconWidth;
  g.shadowBlur = 0;
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(0, 0, 0, 0.95)';
  g.lineJoin = 'round';
  g.strokeText(text, textX, centerY);

  g.fillStyle = mainColor;
  g.shadowColor = glowColor;
  g.shadowBlur = 8;
  g.fillText(text, textX, centerY);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  if (_activeRenderer && typeof _activeRenderer.initTexture === 'function') {
    try { _activeRenderer.initTexture(tex); } catch(e) {}
  }

  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);

  const worldHeight = 0.46;
  const aspect = cvW / cvH;
  const worldWidth = worldHeight * aspect;
  spr.scale.set(worldWidth, worldHeight, 1);

  const finalPos = new THREE.Vector3(pos.x, spawnPosY, pos.z);
  spr.position.copy(finalPos);
  spr.renderOrder = 80;
  scene.add(spr);

  puffPool.push({
    spr,
    mat,
    tex,
    t: 0,
    dur: 1.6,
    baseScaleW: worldWidth,
    baseScaleH: worldHeight,
    isCrit: true
  });
}

export function updateFloatTexts(scene, dt) {
  for (let i = puffPool.length - 1; i >= 0; i--) {
    const p = puffPool[i];
    p.t += dt;

    const progress = p.t / p.dur;
    const riseSpeed = (1 - progress * 0.5) * 1.1;
    p.spr.position.y += dt * riseSpeed;

    if (p.t < 0.12) {
      const popK = p.t / 0.12;
      const pop = 1 + Math.sin(popK * Math.PI) * (p.isCrit ? 0.40 : 0.22);
      p.spr.scale.set(p.baseScaleW * pop, p.baseScaleH * pop, 1);
    } else {
      p.spr.scale.set(p.baseScaleW, p.baseScaleH, 1);
    }

    const fadeStart = 0.7;
    if (progress > fadeStart) {
      p.mat.opacity = Math.max(0, (1 - progress) / (1 - fadeStart));
    } else {
      p.mat.opacity = 1;
    }

    if (p.t >= p.dur) {
      scene.remove(p.spr);
      p.tex.dispose();
      p.mat.dispose();
      puffPool.splice(i, 1);
    }
  }
}

/* -------- Death fountain particles (boss kill spectacle) -------- */
const fountainPool = [];
export function spawnDeathFountain(scene, pos) {
  const count = 40;
  for (let i = 0; i < count; i++) {
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 16;
    const g = cv.getContext('2d');
    const hue = 40 + Math.random() * 20;
    g.fillStyle = `hsl(${hue}, 90%, ${60 + Math.random() * 30}%)`;
    g.beginPath(); g.arc(8, 8, 4 + Math.random() * 3, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
    spr.scale.set(0.3 + Math.random() * 0.3, 0.3 + Math.random() * 0.3, 1);
    spr.position.copy(pos);
    spr.renderOrder = 65;
    scene.add(spr);
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.8 + Math.random() * 2.5;
    fountainPool.push({
      spr, tex,
      vx: Math.cos(angle) * speed * (0.5 + Math.random()),
      vy: 1.5 + Math.random() * 3.5,
      vz: Math.sin(angle) * speed * (0.5 + Math.random()),
      t: 0, life: 0.8 + Math.random() * 0.6
    });
  }
}
function updateDeathFountains(scene, dt) {
  for (let i = fountainPool.length - 1; i >= 0; i--) {
    const p = fountainPool[i];
    p.t += dt;
    p.vy -= dt * 3;
    p.spr.position.x += p.vx * dt;
    p.spr.position.y += p.vy * dt;
    p.spr.position.z += p.vz * dt;
    p.spr.material.opacity = Math.max(0, 1 - p.t / p.life);
    if (p.t > p.life) {
      scene.remove(p.spr);
      p.tex.dispose();
      p.spr.material.dispose();
      fountainPool.splice(i, 1);
    }
  }
}

/* -------- Ground telegraph rings & procedural pixel ability warnings -------- */
const telegraphPool = [];
export function spawnTelegraph(scene, pos, radius = 2.0, color = 0xe04040, duration = 0.8, opts = {}) {
  const type = (typeof opts === 'string' ? opts : opts.type) || 'shockwave';
  const extra = typeof opts === 'object' ? opts : {};
  return spawnPixelVfx(scene, {
    type,
    pos,
    radius,
    color,
    duration,
    ...extra
  });
}
function updateTelegraphs(scene, dt) {
  for (let i = telegraphPool.length - 1; i >= 0; i--) {
    const tg = telegraphPool[i];
    tg.t += dt;
    const progress = tg.t / tg.duration;
    const scale = tg.startScale + (1 - tg.startScale) * Math.min(1, progress);
    tg.mesh.scale.set(scale, scale, scale);
    tg.mat.opacity = 0.5 * (1 - progress);
    if (tg.t >= tg.duration) {
      scene.remove(tg.mesh);
      tg.mat.dispose();
      tg.geom.dispose();
      telegraphPool.splice(i, 1);
    }
  }
}

/* ─────────────── hit flash + shudder ───────────────
   A struck body flashes warm white and shudders for a beat. The shudder is what
   sells a hit that deals little or no damage, where the number alone says
   nothing — so it runs off the flash clock rather than off the damage. */

/* Two stages, because one colour cannot do both jobs. The white blow-out is the
   IMPACT — it has to be violent and brief. The red afterburn is what the eye
   actually registers as "that thing got hurt", and it needs long enough to read.
   White alone was the subtle version: over-bright white on an already-bright
   sprite mostly just clips the highlights. */
const FLASH_SEC = 0.40;
const FLASH_TINT = 0xfff4ee;      // stage 1 — blow-out white
const FLASH_TINT_HOT = 0xff1a08;  // stage 2 — hot red; low G/B is what makes it READ red
const FLASH_BOOST = 3.4;          // see boostColor — a tint alone is an identity multiply
const FLASH_BOOST_HOT = 2.6;
const FLASH_WHITE_FRAC = 0.28;    // share of the flash spent white before the red takes over
const SHUDDER_AMP = 0.075;        // world units of local X displacement at full strength
const SHUDDER_RATE = 46;          // radians/sec — fast enough to read as a judder, not a wobble
/* Impact overlay. Colour on the sprite's OWN material cannot carry the hit: it
   multiplies the texture, and the scene renders into an 8-bit RGBA target, so
   everything above 1.0 clamps — the over-bright trick buys far less than the
   numbers suggest, and nothing at all on an already-pale sprite.

   An ADDITIVE twin does work, because it adds light to the framebuffer instead
   of scaling the texture down. It is also the only safe place to put this: a
   scale punch on anim.mesh looked great until applyCell (which owns mesh.scale,
   and fires whenever the animation swaps to a sheet with a different cell size —
   64 vs 128 vs 192) rewrote the scale mid-flash and left the sprite pinned 2-3x
   too large. The overlay is a CHILD, so it inherits scale and centre for free
   and owns nothing anybody else writes. */
const OVERLAY_OPACITY = 0.95;

/** How long a hit flash lasts. The death path holds its dissolve for this long
 *  so the killing blow still gets its flash and recoil. */
export const HIT_FLASH_SEC = FLASH_SEC;

/* A sprite's material colour MULTIPLIES its texture, so a near-white tint is
   very nearly an identity multiply — setting 0xfff4ee alone changes nothing you
   can see, which is exactly how the flash went missing while the shudder kept
   working. To actually flash white the colour has to go ABOVE 1.0 and blow the
   texture out: the dungeon renderer leaves toneMapping at NoToneMapping, so
   anything over 1 clamps to white while the sprite's alpha cut-out survives.
   Set the tint first — set() re-derives r/g/b from the hex — then scale. */
/* Scratch colours — the afterburn blends a new tint every frame, per entity,
   and allocating a THREE.Color each time would churn the GC during a fight. */
const _flashMix = new THREE.Color();
const _flashWhite = new THREE.Color(0xffffff);

function boostColor(c, tint, boost) {
  if (!c) return;
  c.set(tint);
  if (typeof c.setRGB === 'function') c.setRGB(c.r * boost, c.g * boost, c.b * boost);
}

/** The visual bundle, given either the bundle itself or the game entity holding
 *  one. Call sites pass both — combat has `m.ent` to hand, perk and AoE paths
 *  usually have the entity — and reaching through the wrong one is a silent
 *  no-op rather than an error, which is exactly how the flash goes missing. */
export function visualOf(e) {
  if (!e) return null;
  return e.ent ? e.ent : e;
}

/** The additive impact twin. Same construction as the x-ray ghost — a child
 *  Sprite mirroring the parent's frame — but additive and depth-tested normally,
 *  so it lights the body up where it IS visible rather than where it isn't.
 *  Parented to the sprite, so applyCell's scale and centre changes carry over
 *  without this code ever writing a transform anybody else owns. */
export function attachHitOverlay(anim) {
  if (!anim || !anim.mesh) return null;
  const src = anim.mesh;

  const mat = configureSpriteMaterial(new THREE.SpriteMaterial({
    map: src.material.map,
    color: FLASH_TINT,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  /* Its own cache key, for the same reason the x-ray twin needs one: same key
     plus a different blend mode and three hands back the wrong program. */
  mat.customProgramCacheKey = () => 'hitOverlayDepthTiltSprite';

  const ov = new THREE.Sprite(mat);
  /* Above the sprite AND above the x-ray twin (+1), so the impact reads on top. */
  ov.renderOrder = (src.renderOrder || 0) + 2;
  ov.center.copy(src.center);
  ov.visible = false;

  ov.onBeforeRender = () => {
    const sm = src.material;
    const hadMap = mat.map != null;
    mat.map = sm.map;
    mat.rotation = sm.rotation;
    copyPose(sm, mat);
    ov.center.copy(src.center);
    if ((sm.map != null) !== hadMap) mat.needsUpdate = true;
  };

  src.add(ov);
  anim.hitOverlay = ov;
  return ov;
}

export function hitFlash(ent){
  const v = visualOf(ent);
  if (!v) return;
  if (v.anim && v.anim.mesh) {
    /* Not every anim exposes a hurt state (static monster sprites, the stubs in
       tests) — the flash must not depend on the animation being there. */
    if (typeof v.anim.play === 'function' && !v.anim._dying) v.anim.play('hurt', true);
    boostColor(v.anim.mesh.material.color, FLASH_TINT, FLASH_BOOST);
    /* Remember the rest position ONCE, so overlapping hits cannot ratchet the
       sprite away from where it belongs. */
    if (v._shudderHome === undefined) v._shudderHome = v.anim.mesh.position.x;
    const ov = v.anim.hitOverlay;
    if (ov) {
      ov.visible = true;
      ov.material.color.set(FLASH_TINT);
      ov.material.opacity = OVERLAY_OPACITY;
    }
  } else if (v.bodyMat) {
    /* Mesh bodies have a real emissive channel, which adds rather than
       multiplies — no boost needed there. */
    v.bodyMat.emissive = v.bodyMat.emissive || new THREE.Color();
    v.bodyMat.emissive.set(FLASH_TINT);
  }
  v.flashT = FLASH_SEC;
  v.flashDur = FLASH_SEC;
}

export function updateFlash(ent, dt){
  const v = visualOf(ent);
  tickPose(v, dt);
  if (!v || v.flashT === undefined || v.flashT <= 0) return;
  v.flashT -= dt;

  if (v.flashT > 0) {
    if (v.anim && v.anim.mesh) {
      /* Local X, so it composes with the lunge/knock offset game.js writes to
         the parent group instead of fighting it. Amplitude decays with the
         remaining flash so the body settles rather than snapping back. */
      const home = v._shudderHome || 0;
      const k = v.flashT / (v.flashDur || FLASH_SEC);   // 1 -> 0 across the flash
      v.anim.mesh.position.x = home + Math.sin(v.flashT * SHUDDER_RATE) * SHUDDER_AMP * k;

      const c = v.anim.mesh.material.color;
      if (k > 1 - FLASH_WHITE_FRAC) {
        /* Impact: hold the blow-out flat rather than fading it, so the white
           lands as a hit rather than a fade-in. */
        boostColor(c, FLASH_TINT, FLASH_BOOST);
      } else {
        /* Afterburn: red, decaying to neutral over the rest of the flash. The
           TINT fades toward white as well as the brightness, otherwise the body
           sits at deep red until the last frame and then snaps back. */
        const kr = k / (1 - FLASH_WHITE_FRAC);          // 1 -> 0 across stage 2
        _flashMix.set(FLASH_TINT_HOT).lerp(_flashWhite, 1 - kr);
        boostColor(c, _flashMix, 1 + (FLASH_BOOST_HOT - 1) * kr);
      }

      /* The overlay carries the punch the scale used to: full additive white on
         impact, then red, fading out over the flash. */
      const ov = v.anim.hitOverlay;
      if (ov) {
        const white = k > 1 - FLASH_WHITE_FRAC;
        ov.material.color.set(white ? FLASH_TINT : FLASH_TINT_HOT);
        ov.material.opacity = OVERLAY_OPACITY * (white ? 1 : (k / (1 - FLASH_WHITE_FRAC)));
      }
    }
    return;
  }

  v.flashT = 0;
  if (v.anim && v.anim.mesh) {
    v.anim.mesh.material.color.set(0xffffff);
    v.anim.mesh.position.x = v._shudderHome || 0;
    if (v.anim.hitOverlay) {
      v.anim.hitOverlay.material.opacity = 0;
      v.anim.hitOverlay.visible = false;
    }
    v._shudderHome = undefined;
  } else if (v.bodyMat) {
    v.bodyMat.emissive.set(0x000000);
  }
}

/* -------- Pooled dynamic point lights (flashes, AoE zones, beams) --------
   Three.js bakes the light COUNT into every lit material's shader, so adding
   a `new THREE.PointLight` to the scene invalidates every lit program and
   recompiles the ones not yet seen at that count — a multi-second stall on
   a dungeon scene. The count must therefore never change mid-level: every
   transient effect light is borrowed from this fixed pool (parked at
   intensity 0 under the floor) and handed back when the effect ends. If the
   pool runs dry the effect simply plays unlit — never allocate a new light. */
const FLASH_LIGHT_POOL_SIZE = 10;
let _flashLightPool = null;
const activeFlashLights = [];

function _isUnderScene(obj, scene) {
  for (let o = obj; o; o = o.parent) if (o === scene) return true;
  return false;
}

export function ensureFlashLightPool(scene) {
  if (!scene) return;
  if (!_flashLightPool) {
    _flashLightPool = [];
    for (let i = 0; i < FLASH_LIGHT_POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 2);
      light.position.set(0, -100, 0);
      light.intensity = 0;
      light._pooledActive = false;
      scene.add(light);
      _flashLightPool.push(light);
    }
  } else {
    for (const light of _flashLightPool) {
      /* A light legitimately borrowed by a live effect sits inside that
         effect's group; leave it. Reclaim only lights that fell out of the
         scene graph (level disposed under them) or are already idle. */
      if (light._pooledActive && _isUnderScene(light, scene)) continue;
      releasePooledLight(scene, light);
    }
  }
}

/** Borrow an idle pooled light. Returns null when none is free. */
export function acquirePooledLight(scene) {
  if (!scene) return null;
  ensureFlashLightPool(scene);
  const light = _flashLightPool.find(l => !l._pooledActive);
  if (!light) return null;
  light._pooledActive = true;
  return light;
}

/** Hand a pooled light back: park it under the floor at the scene root.
    Safe to call on a non-pooled or already-released light. */
export function releasePooledLight(scene, light) {
  if (!light || !_flashLightPool || !_flashLightPool.includes(light)) return;
  if (light.parent !== scene) {
    if (light.parent) light.parent.remove(light);
    if (scene) scene.add(light);
  }
  light.intensity = 0;
  light.position.set(0, -100, 0);
  light._pooledActive = false;
}

/**
 * Spawns a high-impact dynamic flash point light that decays smoothly.
 * Illuminates surrounding dungeon geometry for Fireball explosions, Lightning strikes, and crits.
 */
export function spawnFlashLight(scene, pos, color = 0xffaa44, intensity = 4.5, range = 12.0, duration = 0.3) {
  if (!scene || !pos) return null;
  const light = acquirePooledLight(scene);
  if (!light) return null;

  light.color.set(color);
  light.distance = range;
  light.intensity = intensity;
  light.position.set(pos.x, (pos.y || 0) + 1.2, pos.z);

  const item = {
    light,
    baseIntensity: intensity,
    t: 0,
    dur: duration
  };
  activeFlashLights.push(item);
  return item;
}

export function updateFlashLights(scene, dt) {
  for (let i = activeFlashLights.length - 1; i >= 0; i--) {
    const fl = activeFlashLights[i];
    fl.t += dt;
    const progress = fl.t / fl.dur;
    if (progress >= 1.0) {
      releasePooledLight(scene, fl.light);
      activeFlashLights.splice(i, 1);
    } else {
      const decay = Math.exp(-progress * 4.5);
      fl.light.intensity = fl.baseIntensity * decay;
    }
  }
}

export function spawnImpactBurst(scene, pos, type = 'fire', color = null, count = 16) {
  if (!scene || !pos) return;

  // Trigger high-fidelity NixieFX micro-particle burst
  if (type === 'fire') {
    playNixieEffect('fire_burst', pos, { scale: 1.0, duration: 0.6 });
    spawnFlashLight(scene, pos, 0xff7722, 4.2, 11.0, 0.28);
  } else if (type === 'frost') {
    playNixieEffect('frost_nova', pos, { scale: 1.0, duration: 0.6 });
    spawnFlashLight(scene, pos, 0x88ddff, 3.8, 9.5, 0.28);
  } else if (type === 'lightning') {
    playNixieEffect('lightning_burst', pos, { scale: 1.0, duration: 0.45 });
    spawnFlashLight(scene, pos, 0x99bbff, 5.0, 13.0, 0.22);
  } else if (type === 'poison' || type === 'acid') {
    playNixieEffect('poison_burst', pos, { scale: 1.0, duration: 0.6 });
    spawnFlashLight(scene, pos, 0x44dd55, 3.5, 8.5, 0.25);
  } else if (type === 'holy' || type === 'radiant') {
    playNixieEffect('holy_burst', pos, { scale: 1.0, duration: 0.65 });
    spawnFlashLight(scene, pos, 0xfff088, 4.8, 12.0, 0.32);
  } else if (type === 'dark' || type === 'necrotic') {
    playNixieEffect('dark_burst', pos, { scale: 1.0, duration: 0.6 });
    spawnFlashLight(scene, pos, 0x9955dd, 3.8, 9.5, 0.28);
  } else {
    playNixieEffect('hit_sparks', pos, { scale: 1.0, duration: 0.45 });
  }
}
/** Tick pooled world FX (death fountains, boss telegraphs, procedural pixel VFX). Called from the
 *  game update loop with the live scene. */
export function updateWorldFx(scene, dt){
  updateDeathFountains(scene, dt);
  updateTelegraphs(scene, dt);
  updatePixelVfx(scene, dt);
  updateEvaporateParticles(scene, dt);
}

/* ================= attack effects: projectiles + slashes ================= */
const _projGeo = {
  arrow: new THREE.CylinderGeometry(0.016,0.016,0.44,5).rotateX(Math.PI/2),  // long axis +z
  bolt:  new THREE.IcosahedronGeometry(0.13,0)
};
const _ringGeo = new THREE.RingGeometry(0.22,0.5,22).rotateX(-Math.PI/2);
const projectiles = [];
const slashes = [];
const spriteEffects = [];
const activeAoEVisuals = [];

let _softLineTex = null;
function getSoftLineTexture() {
  if (!_softLineTex) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const ctx = cv.getContext('2d');
    if (ctx && typeof ctx.createLinearGradient === 'function') {
      try {
        const gradV = ctx.createLinearGradient(0, 0, 0, 64);
        gradV.addColorStop(0.00, 'rgba(255, 255, 255, 0.00)');
        gradV.addColorStop(0.20, 'rgba(255, 255, 255, 0.40)');
        gradV.addColorStop(0.50, 'rgba(255, 255, 255, 1.00)');
        gradV.addColorStop(0.80, 'rgba(255, 255, 255, 0.40)');
        gradV.addColorStop(1.00, 'rgba(255, 255, 255, 0.00)');

        ctx.fillStyle = gradV;
        ctx.fillRect(0, 0, 256, 64);

        ctx.globalCompositeOperation = 'destination-in';
        const gradH = ctx.createLinearGradient(0, 0, 256, 0);
        gradH.addColorStop(0.00, 'rgba(0, 0, 0, 0.00)');
        gradH.addColorStop(0.08, 'rgba(0, 0, 0, 0.85)');
        gradH.addColorStop(0.50, 'rgba(0, 0, 0, 1.00)');
        gradH.addColorStop(0.92, 'rgba(0, 0, 0, 0.85)');
        gradH.addColorStop(1.00, 'rgba(0, 0, 0, 0.00)');
        ctx.fillStyle = gradH;
        ctx.fillRect(0, 0, 256, 64);
        ctx.globalCompositeOperation = 'source-over';
      } catch (e) {}
    }
    _softLineTex = new THREE.CanvasTexture(cv);
    _softLineTex.wrapS = THREE.ClampToEdgeWrapping;
    _softLineTex.wrapT = THREE.ClampToEdgeWrapping;
  }
  return _softLineTex;
}

/**
 * Spawns a persistent ground visual indicator for continuous concentration AoE zones.
 */
export function spawnAoEVisual(scene, pos, color = 0x3fd0bb, size = 3.0, duration = null, options = {}) {
  if (!scene || !pos) return null;

  const mat = configureSpriteMaterial(new THREE.SpriteMaterial({
    color,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
    side: THREE.DoubleSide
  }));
  mat.toneMapped = false;

  const group = new THREE.Group();
  group.position.set(pos.x, 0.33, pos.z);

  let innerMat = null, borderMat = null;
  let innerBaseOp = 0.08, borderBaseOp = 0.6;
  const isLine = options && options.shape === 'line';
  if (isLine) {
    const lineLen = options.length || (size * 2) || 12.0;
    const lineWidth = options.width || 1.8;
    const lineTex = getSoftLineTexture();

    innerBaseOp = options.indicatorOpacity != null ? options.indicatorOpacity : 0.30;
    innerMat = new THREE.MeshBasicMaterial({
      map: lineTex,
      color,
      transparent: true,
      opacity: innerBaseOp,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    innerMat.toneMapped = false;
    const innerGeom = new THREE.PlaneGeometry(lineLen, lineWidth * 1.6).rotateX(-Math.PI / 2);
    const innerMesh = new THREE.Mesh(innerGeom, innerMat);
    group.add(innerMesh);

    borderBaseOp = 0.20;
    borderMat = new THREE.MeshBasicMaterial({
      map: lineTex,
      color: 0xffffff,
      transparent: true,
      opacity: borderBaseOp,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    borderMat.toneMapped = false;
    const borderGeom = new THREE.PlaneGeometry(lineLen * 0.95, lineWidth * 0.5).rotateX(-Math.PI / 2);
    const borderMesh = new THREE.Mesh(borderGeom, borderMat);
    borderMesh.position.y = 0.005;
    group.add(borderMesh);

    if (options.angle != null) {
      group.rotation.y = -options.angle;
    }
  } else {
    // Faint inner ground circle
    innerBaseOp = 0.08;
    innerMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: innerBaseOp,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    innerMat.toneMapped = false;
    const innerGeom = new THREE.CircleGeometry(size, 32).rotateX(-Math.PI/2);
    const innerMesh = new THREE.Mesh(innerGeom, innerMat);
    group.add(innerMesh);

    // Outer border ring
    borderBaseOp = 0.6;
    borderMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: borderBaseOp,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    borderMat.toneMapped = false;
    const borderGeom = new THREE.RingGeometry(size - 0.05, size + 0.05, 32).rotateX(-Math.PI/2);
    const borderMesh = new THREE.Mesh(borderGeom, borderMat);
    group.add(borderMesh);
  }

  // Optional 3D vertical cylinder beam (e.g. Moonbeam)
  let cylMat = null, coreMat = null, glowTex = null, coreTex = null;
  let cylBaseOp = null, coreBaseOp = null;
  if (options && options.cylinderBeam) {
    const beamHeight = options.beamHeight || 12.0;
    const beamRadius = size;
    const colorHex = options.beamColor || color;
    const beamOp = options.beamOpacity != null ? options.beamOpacity : 0.5;

    cylBaseOp = 0.35 * beamOp;
    coreBaseOp = 0.40 * beamOp;

    glowTex = getBeamTexture().clone();
    glowTex.repeat.set(1, 4);

    cylMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color: colorHex,
      transparent: true,
      opacity: cylBaseOp,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    cylMat.toneMapped = false;

    const cylGeom = new THREE.CylinderGeometry(beamRadius * 0.95, beamRadius, beamHeight, 24, 1, true);
    const cylMesh = new THREE.Mesh(cylGeom, cylMat);
    cylMesh.position.y = beamHeight / 2;
    group.add(cylMesh);

    coreTex = getBeamTexture().clone();
    coreTex.repeat.set(1, 4);

    coreMat = new THREE.MeshBasicMaterial({
      map: coreTex,
      color: 0xffffff,
      transparent: true,
      opacity: coreBaseOp,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    coreMat.toneMapped = false;

    const coreGeom = new THREE.CylinderGeometry(beamRadius * 0.45, beamRadius * 0.5, beamHeight, 16, 1, true);
    const coreMesh = new THREE.Mesh(coreGeom, coreMat);
    coreMesh.position.y = beamHeight / 2;
    group.add(coreMesh);
  }

  // Persistent looping spritesheet for concentration zones — keeps playing its
  // frame loop while the spell persists (flames for Wall of Fire, gas for
  // Cloudkill, sparkles for Faerie Fire, etc.).
  let sheetDef = null, sheetBaseTex = null, sheetTex = null, sheetMat = null, sheetMesh = null, sheetBaseScale = null;
  const sheetInstances = [];
  if (options && options.loopSheet) {
    sheetDef = GIGAPACK_REGISTRY[options.loopSheet.sheetKey] || null;
    if (sheetDef) {
      let base = _sheetTexCache[sheetDef.url];
      if (!base) {
        base = new THREE.TextureLoader().load(sheetDef.url);
        base.colorSpace = THREE.SRGBColorSpace;
        base.magFilter = THREE.NearestFilter;
        base.minFilter = THREE.NearestFilter;
        _sheetTexCache[sheetDef.url] = base;
      }
      /* Clones made before the image arrives get it copied in by the update
         loop (see the sheetBaseTex sync there). */
      sheetBaseTex = base;
      
      const repeatCount = options.loopSheet.repeatCount || 1;
      const baseScale = options.loopSheet.scale || size * 1.15;
      const baseOp = options.loopSheet.opacity != null ? options.loopSheet.opacity : 0.35;
      const isGrounded = options.loopSheet.grounded;
      const centerY = options.loopSheet.centerY != null ? options.loopSheet.centerY : (isGrounded ? 0 : 0.5);
      const yPos = options.loopSheet.y != null ? options.loopSheet.y : (isGrounded ? 0.05 : 0.9 + size * 0.5);

      if (repeatCount > 1) {
        for (let ri = 0; ri < repeatCount; ri++) {
          const instTex = base.clone();
          instTex.needsUpdate = true;
          const _repI = sheetFrameRepeat(sheetDef);
          instTex.repeat.set(_repI.x, _repI.y);
          const instMat = configureSpriteMaterial(new THREE.SpriteMaterial({
            map: instTex, transparent: true, depthWrite: false, opacity: 0,
            blending: THREE.AdditiveBlending
          }));
          instMat.toneMapped = false;
          const instMesh = new THREE.Sprite(instMat);
          instMesh.center.set(0.5, centerY);

          let offsetX = 0;
          let offsetZ = 0;
          if (options.loopSheet.layout === 'line') {
            const span = options.loopSheet.length || (size * 2);
            offsetX = ((ri / (repeatCount - 1)) - 0.5) * span;
            offsetZ = (Math.sin(ri * 1.8) * 0.25);
          } else if (options.loopSheet.offsets && options.loopSheet.offsets[ri]) {
            offsetX = options.loopSheet.offsets[ri].x || 0;
            offsetZ = options.loopSheet.offsets[ri].z || 0;
          } else {
            const angle = (ri / repeatCount) * Math.PI * 2;
            const r = size * 0.5;
            offsetX = Math.cos(angle) * r;
            offsetZ = Math.sin(angle) * r;
          }

          instMesh.scale.set(baseScale, baseScale, 1);
          instMesh.position.set(offsetX, yPos, offsetZ);
          instMesh.renderOrder = 25;
          group.add(instMesh);

          // Stagger timing offset per instance for organic desynchronized animation
          const timeOffset = (ri * (sheetDef.frames / (sheetDef.fps * repeatCount)) + (ri * 0.23)) % 10.0;
          sheetInstances.push({
            mesh: instMesh,
            mat: instMat,
            tex: instTex,
            baseScale,
            baseOp,
            timeOffset
          });
        }
      } else {
        sheetTex = base.clone();
        sheetTex.needsUpdate = true;
        const _repS = sheetFrameRepeat(sheetDef);
        sheetTex.repeat.set(_repS.x, _repS.y);
        sheetMat = configureSpriteMaterial(new THREE.SpriteMaterial({
          map: sheetTex, transparent: true, depthWrite: false, opacity: 0,
          blending: THREE.AdditiveBlending
        }));
        sheetMat.toneMapped = false;
        sheetMesh = new THREE.Sprite(sheetMat);
        sheetMesh.center.set(0.5, centerY);
        sheetBaseScale = baseScale;
        sheetMesh.scale.set(sheetBaseScale, sheetBaseScale, 1);
        sheetMesh.position.y = yPos;
        sheetMesh.renderOrder = 25;
        group.add(sheetMesh);
      }
    }
  }

  // Persistent procedural elements for concentration zones (sparkle cube / vines).
  let sparkleFx = null, vineFx = null;
  if (options && options.procedural === 'sparkleCube') {
    sparkleFx = buildSparkleCubeZone(group, size * 0.55, color, options);
  } else if (options && options.procedural === 'vines') {
    vineFx = buildVineZone(group, size, color, options);
  }

  // Dynamic Spell Point Light for ambient dungeon illumination (tightly bounded to spell area)
  const lights = [];
  if (!options || options.pointLight !== false) {
    const lightColor = options?.lightColor || color || 0xffaa44;
    const baseIntensity = options?.lightIntensity != null ? options.lightIntensity : (options?.cylinderBeam ? 1.4 : 0.85);
    const lightRange = options?.lightRange != null ? options.lightRange : Math.min(6.5, Math.max(3.5, size * 1.3));

    const l = acquirePooledLight(scene);
    if (l) {
      l.color.set(lightColor);
      l.intensity = baseIntensity;
      l.distance = lightRange;
      l.decay = 2;
      l.position.set(0, 1.2, 0);
      group.add(l);
      lights.push(l);
    }
  }

  scene.add(group);

  const visual = {
    group,
    mat,
    innerMat,
    borderMat,
    innerBaseOp,
    borderBaseOp,
    cylMat,
    coreMat,
    glowTex,
    coreTex,
    sheetDef,
    sheetBaseTex,
    sheetTex,
    sheetMat,
    sheetMesh,
    sheetBaseScale,
    sheetInstances,
    lights,
    baseLightIntensity: options?.lightIntensity != null ? options.lightIntensity : (isLine ? 0.7 : 0.85),
    sheetBaseOp: options && options.loopSheet && options.loopSheet.opacity != null ? options.loopSheet.opacity : 0.35,
    sheetT: 0,
    sparkleFx,
    vineFx,
    t: 0,
    dur: duration,
    size,
    shape: options && options.shape ? options.shape : 'circle',
    pulseSpeed: 1.5 + Math.random(),
    rotateSpeed: 0.2 + Math.random() * 0.3
  };

  activeAoEVisuals.push(visual);
  return visual;
}

/** Disposes and removes a persistent ground visual zone. */
export function removeAoEVisual(scene, visual) {
  if (!visual) return;
  const idx = activeAoEVisuals.indexOf(visual);
  if (idx >= 0) {
    scene.remove(visual.group);
    if (visual.innerMat) visual.innerMat.dispose();
    if (visual.borderMat) visual.borderMat.dispose();
    if (visual.mat) visual.mat.dispose();
    if (visual.cylMat) visual.cylMat.dispose();
    if (visual.coreMat) visual.coreMat.dispose();
    if (visual.glowTex) visual.glowTex.dispose();
    if (visual.coreTex) visual.coreTex.dispose();
    if (visual.sheetMat) visual.sheetMat.dispose();
    if (visual.sheetTex) visual.sheetTex.dispose();
    if (visual.lights && visual.lights.length > 0) {
      for (const l of visual.lights) releasePooledLight(scene, l);
    }
    if (visual.sheetInstances && visual.sheetInstances.length > 0) {
      for (const inst of visual.sheetInstances) {
        if (inst.mat) inst.mat.dispose();
        if (inst.tex) inst.tex.dispose();
      }
    }
    if (visual.sparkleFx) {
      if (visual.sparkleFx.wireMat) visual.sparkleFx.wireMat.dispose();
      for (const s of visual.sparkleFx.sparks || []) s.mat.dispose();
    }
    if (visual.vineFx) {
      for (const v of visual.vineFx.vines || []) {
        v.mat.dispose();
        v.tubeGeom.dispose();
      }
    }
    activeAoEVisuals.splice(idx, 1);
  }
}

const _projTexLoader = new THREE.TextureLoader();
const _projTexCache = {};
let _radialGlowTex = null;

function getRadialGlowTexture() {
  if (!_radialGlowTex) {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');
    if (ctx && typeof ctx.createRadialGradient === 'function') {
      try {
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        grad.addColorStop(0.3, 'rgba(255, 255, 255, 0.6)');
        grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.15)');
        grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
      } catch(e) {}
    }
    _radialGlowTex = new THREE.CanvasTexture(cv);
    _radialGlowTex.colorSpace = THREE.SRGBColorSpace;
  }
  return _radialGlowTex;
}

const CANTRIP_PROJ_SHEETS = {
  wizard: 'stylized_explosion_001_large_yellow',
  sorcerer: 'spell_death_001_large_red',
  cleric: 'round_light_burst_001_large_yellow',
  druid: 'round_sparkle_burst_002_large_green',
  warlock: 'round_sparkle_burst_003_large_red',
  bard: 'directional_music_burst_002_large_yellow',
  artificer: 'round_sparkle_burst_001_large_blue',
};

/** Fire a projectile from `from` to `to`; calls onHit() when it lands. */
export function spawnProjectile(scene, from, to, kind, color, onHit, opts = {}){
  if (typeof globalThis.setCombatActionFocus === 'function') {
    globalThis.setCombatActionFocus(from, to, 1.05);
  }
  if (kind === 'arrow') {
    const geo = _projGeo.arrow;
    const mat = new THREE.MeshBasicMaterial({ color }); mat.toneMapped = false;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    mesh.lookAt(to);
    scene.add(mesh);
    const dur = Math.max(0.08, from.distanceTo(to)/16);
    projectiles.push({ mesh, mat, glowMat: null, from: from.clone(), to: to.clone(), t: 0, dur, onHit, kind });
    return dur;
  }

  /* Magic Bolt / Cantrip Animated Sprite Projectile */
  let sheetDef = opts.sheetDef;
  if (!sheetDef && opts.sheetKey && GIGAPACK_REGISTRY[opts.sheetKey]) {
    sheetDef = GIGAPACK_REGISTRY[opts.sheetKey];
  }
  if (!sheetDef && opts.classKey && CANTRIP_PROJ_SHEETS[opts.classKey] && GIGAPACK_REGISTRY[CANTRIP_PROJ_SHEETS[opts.classKey]]) {
    sheetDef = GIGAPACK_REGISTRY[CANTRIP_PROJ_SHEETS[opts.classKey]];
  }

  /* Fallback Gigapack spritesheet by element if no explicit sheet passed */
  if (!sheetDef) {
    const dmgType = opts.dmgType || (kind === 'fireball' ? 'fire' : kind === 'icicle' ? 'cold' : kind === 'zap' ? 'lightning' : 'magic');
    if (dmgType === 'fire') sheetDef = GIGAPACK_REGISTRY['stylized_explosion_001_large_yellow'] || GIGAPACK_REGISTRY['epic_explosion_001_large_orange'];
    else if (dmgType === 'cold') sheetDef = GIGAPACK_REGISTRY['round_sparkle_burst_001_large_blue'];
    else if (dmgType === 'acid' || dmgType === 'poison') sheetDef = GIGAPACK_REGISTRY['spell_poison_001_large_green'];
    else if (dmgType === 'lightning') sheetDef = GIGAPACK_REGISTRY['lightning_burst_001_large_violet'];
    else if (dmgType === 'radiant') sheetDef = GIGAPACK_REGISTRY['round_light_burst_001_large_yellow'];
    else if (dmgType === 'necrotic') sheetDef = GIGAPACK_REGISTRY['spell_death_001_large_red'];
    else sheetDef = GIGAPACK_REGISTRY['round_sparkle_burst_003_large_red'];
  }

  const scale = opts.scale || 1.3;
  let mesh, mat, glowMat = null, glowMesh = null, tex = null;

  if (sheetDef) {
    const base = getOrLoadSheetTexture(sheetDef.url);
    tex = base ? base.clone() : new THREE.Texture();
    if (_empty1x1Canvas && (!tex.image || !tex.image.width)) {
      tex.image = _empty1x1Canvas;
    }
    tex.needsUpdate = true;
    const _repP = sheetFrameRepeat(sheetDef);
    tex.repeat.set(_repP.x, _repP.y);

    mat = configureSpriteMaterial(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    mesh = new THREE.Sprite(mat);
    mesh.scale.set(scale, scale, 1);
    mesh.position.copy(from);

    // Radiant additive glowing halo for spell projectile
    glowMat = configureSpriteMaterial(new THREE.SpriteMaterial({
      map: getRadialGlowTexture(),
      color: color || 0xffd34a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    glowMat.toneMapped = false;
    glowMesh = new THREE.Sprite(glowMat);
    glowMesh.scale.set(scale * 1.2, scale * 1.2, 1);
    mesh.add(glowMesh);
  } else {
    // Legacy / fallback bolt geometry with soft halo
    const geo = _projGeo.bolt;
    mat = new THREE.MeshBasicMaterial({ color: color || 0xb08cff }); mat.toneMapped = false;
    mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);

    glowMat = configureSpriteMaterial(new THREE.SpriteMaterial({ map: getRadialGlowTexture(), color: color || 0xb08cff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    glowMat.toneMapped = false;
    glowMesh = new THREE.Sprite(glowMat);
    glowMesh.scale.set(scale * 1.2, scale * 1.2, 1);
    mesh.add(glowMesh);
  }

  scene.add(mesh);
  const dur = Math.max(0.20, from.distanceTo(to) / 10.5);
  const curve = opts.curve || null;
  projectiles.push({ mesh, mat, glowMat, glowMesh, tex, sheetDef, scale, curve, from: from.clone(), to: to.clone(), t: 0, dur, onHit, kind });
  return dur;
}

/** A quick expanding procedural pixel slash / spell burst. */
export function spawnSlash(scene, pos, color, size = 1, opts = {}) {
  const rot = (typeof opts === 'object' && opts.rot != null) ? opts.rot : Math.random() * Math.PI * 2;
  return spawnPixelVfx(scene, {
    type: 'slash',
    pos: { x: pos.x, y: 0.32, z: pos.z },
    radius: size * 0.9,
    color,
    duration: 0.28,
    rot
  });
}

const _empty1x1Canvas = (() => {
  if (typeof document === 'undefined') return null;
  try {
    const cv = document.createElement('canvas');
    cv.width = 1; cv.height = 1;
    const ctx = cv.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 1, 1);
    }
    return cv;
  } catch(e) {
    return null;
  }
})();

let _activeRenderer = null;
const _spriteTexCache = new Map();
const _sharedTexLoader = new THREE.TextureLoader();

/* Some DCSS effect sprites are full-bleed faint squares — every pixel carries a
   low-but-nonzero alpha over a bright colour (goldaura_*, gold_sparkles_*) or a
   soft glow that reads as a box (sanctuary). With normal blending those faint
   backgrounds paint the whole billboard as a visible square around the effect.
   Key them out at load so only the brighter art survives. */
const EFFECT_KEY_SPRITES = new Set([
  'dcss/effect/gold_sparkles_1.png',
  'dcss/effect/gold_sparkles_2.png',
  'dcss/effect/gold_sparkles_3.png',
  'dcss/effect/goldaura_0.png',
  'dcss/effect/goldaura_1.png',
  'dcss/effect/goldaura_2.png',
  'dcss/effect/sanctuary.png'
]);
const EFFECT_KEY_ALPHA = 64; // pixels below this alpha are treated as background

function keyOutEffectBackground(img) {
  const w = img.width, h = img.height;
  if (!w || !h || w > 4096 || h > 4096) return img;
  let cv;
  try {
    cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx || typeof ctx.getImageData !== 'function') return img;
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (d[o + 3] < EFFECT_KEY_ALPHA) { d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0; }
    }
    ctx.putImageData(id, 0, 0);
    return cv;
  } catch (e) {
    return img;
  }
}

/* Sheet frames are UV-sampled as [offset, offset+repeat] in texture space.
   Many gigapack sheets are padded up to power-of-two dimensions, so a frame's
   true footprint is fw/fh of the full image, not a clean 1/cols by 1/rows tile.
   These helpers size the sample from the declared frame size (fw/fh) against
   the full image (w/h); for unpadded sheets fw/w === 1/cols, so nothing changes. */
function sheetFrameRepeat(d) {
  const x = d.fw && d.w ? d.fw / d.w : 1 / (d.cols || 1);
  const y = d.fh && d.h ? d.fh / d.h : 1 / (d.rows || 1);
  return { x, y };
}
function sheetFrameOffset(d, f) {
  const col = f % (d.cols || 1);
  const row = Math.floor(f / (d.cols || 1));
  const rep = sheetFrameRepeat(d);
  return { x: col * rep.x, y: (d.rows - 1 - row) * rep.y };
}

export function getOrLoadSpriteTexture(path) {
  if (!path) return null;
  const p = path.startsWith('dcss/') || path.startsWith('./') || path.startsWith('art/') || path.startsWith('fx/') || path.startsWith('sprites/') || path.startsWith('Sprites/')
    ? path
    : (path.includes('/') ? path : `dcss/effect/${path}`);
  let t = _spriteTexCache.get(p);
  if (!t) {
    t = _sharedTexLoader.load(
      p,
      (loadedTex) => {
        if (EFFECT_KEY_SPRITES.has(p) && loadedTex.image && typeof keyOutEffectBackground === 'function') {
          const out = keyOutEffectBackground(loadedTex.image);
          if (out !== loadedTex.image) {
            loadedTex.image = out;
            loadedTex.needsUpdate = true;
          }
        }
        loadedTex.needsUpdate = true;
        if (_activeRenderer && typeof _activeRenderer.initTexture === 'function') {
          try { _activeRenderer.initTexture(loadedTex); } catch(e) {}
        }
      },
      undefined,
      (err) => {
        // Fallback to empty transparent texture without rendering solid white box
        if (_empty1x1Canvas) {
          t.image = _empty1x1Canvas;
          t.needsUpdate = true;
        }
      }
    );
    if (_empty1x1Canvas && (!t.image || !t.image.width)) {
      t.image = _empty1x1Canvas;
      t.needsUpdate = true;
    }
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    _spriteTexCache.set(p, t);
  }
  return t;
}

export function getOrLoadSheetTexture(url) {
  if (!url) return null;
  let t = _sheetTexCache[url];
  if (!t) {
    t = _sharedTexLoader.load(
      url,
      (loadedTex) => {
        loadedTex.needsUpdate = true;
        if (_activeRenderer && typeof _activeRenderer.initTexture === 'function') {
          try { _activeRenderer.initTexture(loadedTex); } catch(e) {}
        }
      },
      undefined,
      (err) => {
        if (_empty1x1Canvas) {
          t.image = _empty1x1Canvas;
          t.needsUpdate = true;
        }
      }
    );
    if (_empty1x1Canvas && (!t.image || !t.image.width)) {
      t.image = _empty1x1Canvas;
      t.needsUpdate = true;
    }
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    _sheetTexCache[url] = t;
  }
  return t;
}

export function preloadVFX(paths = []) {
  for (const p of paths) {
    if (!p) continue;
    if (typeof p === 'string') {
      getOrLoadSpriteTexture(p);
    } else if (typeof p === 'object' && p.url) {
      getOrLoadSheetTexture(p.url);
    } else if (typeof p === 'object' && Array.isArray(p.frames)) {
      for (const f of p.frames) getOrLoadSpriteTexture(f);
    } else if (typeof p === 'object' && p.sprite) {
      getOrLoadSpriteTexture(p.sprite);
    }
  }
}

let _vfxPreloaded = false;

export function preloadAllSpellAndCombatVFX(renderer = null, scene = null, camera = null) {
  if (renderer) _activeRenderer = renderer;
  if (_vfxPreloaded) {
    // If renderer was supplied after initial preload, warm up GPU buffers now
    if (renderer && typeof renderer.initTexture === 'function') {
      try {
        const glow = getRadialGlowTexture();
        if (glow) renderer.initTexture(glow);
        const beam = getBeamTexture();
        if (beam) renderer.initTexture(beam);
        for (const [, tex] of _spriteTexCache) {
          if (tex && tex.image && (tex.image.width > 1 || tex.image.complete)) renderer.initTexture(tex);
        }
        for (const url in _sheetTexCache) {
          const tex = _sheetTexCache[url];
          if (tex && tex.image && (tex.image.width > 1 || tex.image.complete)) renderer.initTexture(tex);
        }
        for (const url in _projTexCache) {
          const tex = _projTexCache[url];
          if (tex && tex.image && (tex.image.width > 1 || tex.image.complete)) renderer.initTexture(tex);
        }
      } catch(e) {}
    }
    return;
  }
  _vfxPreloaded = true;

  const paths = [
    // Slash & Impact VFX
    'dcss/effect/kny_slash_0.png', 'dcss/effect/kny_slash_1.png', 'dcss/effect/kny_slash_2.png', 'dcss/effect/kny_slash_3.png',
    'dcss/effect/kny_light_0.png', 'dcss/effect/kny_light_1.png',
    'dcss/effect/kny_dust_0.png', 'dcss/effect/kny_dust_1.png',
    'dcss/effect/kny_spark_0.png', 'dcss/effect/kny_spark_1.png', 'dcss/effect/kny_spark_2.png', 'dcss/effect/kny_spark_3.png',
    'dcss/effect/kny_star_0.png', 'dcss/effect/kny_star_1.png', 'dcss/effect/kny_star_2.png', 'dcss/effect/kny_star_3.png', 'dcss/effect/kny_star_4.png',
    // Common Spells, Cantrips & Abilities
    'dcss/effect/flame_0.png', 'dcss/effect/flame_1.png', 'dcss/effect/flame_2.png',
    'dcss/effect/magic_bolt_1.png', 'dcss/effect/magic_bolt_2.png', 'dcss/effect/magic_bolt_3.png', 'dcss/effect/magic_bolt_4.png', 'dcss/effect/magic_bolt_5.png', 'dcss/effect/magic_bolt_6.png',
    'dcss/effect/arrow_4.png', 'dcss/effect/zap_0.png', 'dcss/effect/zap_1.png',
    'dcss/effect/orb_glow_0.png', 'dcss/effect/orb_glow_1.png',
    'dcss/effect/gold_sparkles_1.png', 'dcss/effect/gold_sparkles_2.png', 'dcss/effect/gold_sparkles_3.png',
    'dcss/effect/goldaura_0.png', 'dcss/effect/goldaura_1.png', 'dcss/effect/goldaura_2.png',
    'dcss/effect/heataura_1.png', 'dcss/effect/heataura_2.png',
    'dcss/effect/searing_ray_0.png', 'dcss/effect/searing_ray_1.png', 'dcss/effect/searing_ray_2.png', 'dcss/effect/searing_ray_3.png', 'dcss/effect/searing_ray_4.png', 'dcss/effect/searing_ray_5.png',
    'dcss/effect/cloud_fire_0.png', 'dcss/effect/cloud_fire_1.png', 'dcss/effect/cloud_fire_2.png', 'dcss/effect/cloud_forest_fire.png',
    'dcss/effect/cloud_poison_0.png', 'dcss/effect/cloud_poison_1.png', 'dcss/effect/cloud_poison_2.png',
    'dcss/effect/cloud_magic_trail_0.png', 'dcss/effect/cloud_magic_trail_1.png', 'dcss/effect/cloud_magic_trail_2.png', 'dcss/effect/cloud_magic_trail_3.png',
    'dcss/effect/cloud_chaos_1.png', 'dcss/effect/cloud_chaos_2.png', 'dcss/effect/cloud_chaos_3.png', 'dcss/effect/cloud_chaos_4.png', 'dcss/effect/cloud_chaos_5.png',
    'dcss/effect/cloud_cold_0.png', 'dcss/effect/cloud_cold_1.png', 'dcss/effect/cloud_cold_2.png',
    'dcss/effect/cloud_spectral_0.png', 'dcss/effect/cloud_spectral_1.png', 'dcss/effect/cloud_spectral_2.png',
    'dcss/effect/cloud_neg_0.png', 'dcss/effect/cloud_neg_1.png', 'dcss/effect/cloud_neg_2.png',
    'dcss/effect/cloud_blue_smoke.png', 'dcss/effect/cloud_black_smoke.png', 'dcss/effect/cloud_yellow_smoke.png', 'dcss/effect/cloud_gloom_new.png',
    'dcss/effect/sanctuary.png', 'dcss/effect/silenced.png', 'dcss/effect/acid_venom.png', 'dcss/effect/frost_0.png', 'dcss/effect/frost_1.png',
    'dcss/effect/sandblast_0.png', 'dcss/effect/sandblast_1.png', 'dcss/effect/sandblast_2.png',
    'dcss/effect/drain_red_0.png', 'dcss/effect/drain_red_1.png', 'dcss/effect/drain_red_2.png',
    'dcss/effect/umbra_0.png', 'dcss/effect/umbra_1.png', 'dcss/effect/umbra_2.png', 'dcss/effect/umbra_3.png',
    'dcss/effect/irradiate_0.png', 'dcss/effect/irradiate_1.png', 'dcss/effect/irradiate_2.png', 'dcss/effect/irradiate_3.png',
    'dcss/effect/quad_glow.png', 'dcss/effect/xom_sparkles_blue.png'
  ];

  /* Per-class cantrip impact burst sheets */
  for (const k of ['cantrip_fire_bolt','cantrip_chill_touch','cantrip_sacred_flame','cantrip_produce_flame','cantrip_eldritch_blast']) {
    preloadVFX([`fx/spells/${k}.png`]);
  }
  preloadVFX(paths);

  // 2. Preload all Gigapack VFX Spritesheets
  if (typeof GIGAPACK_REGISTRY === 'object') {
    for (const key in GIGAPACK_REGISTRY) {
      const def = GIGAPACK_REGISTRY[key];
      if (def && def.url) {
        getOrLoadSheetTexture(def.url);
      }
    }
  }

  // 3. Preload all Custom Sheets & VFX Animation references from LIB
  if (LIB && typeof LIB.sheets === 'object') {
    for (const key in LIB.sheets) {
      const def = LIB.sheets[key];
      if (def && def.url) {
        getOrLoadSheetTexture(def.url);
      }
    }
  }
  if (LIB && typeof LIB.anims === 'object') {
    for (const animKey in LIB.anims) {
      const anim = LIB.anims[animKey];
      for (const phase of ['travel', 'impact']) {
        if (!anim[phase]) continue;
        for (const slot of ['back', 'front']) {
          const layer = anim[phase][slot];
          if (!layer || !layer.enabled) continue;
          if (layer.type === 'sheet' && layer.sheet) {
            if (layer.sheet.startsWith('gigapack:')) {
              const gDef = GIGAPACK_REGISTRY[layer.sheet.slice('gigapack:'.length)];
              if (gDef && gDef.url) getOrLoadSheetTexture(gDef.url);
            } else if (LIB.sheets && LIB.sheets[layer.sheet]) {
              getOrLoadSheetTexture(LIB.sheets[layer.sheet].url);
            }
          } else if (layer.type === 'sprite') {
            if (layer.path) getOrLoadSpriteTexture(layer.path);
            if (Array.isArray(layer.frames)) {
              for (const f of layer.frames) getOrLoadSpriteTexture(f);
            }
          }
        }
      }
    }
  }

  // 4. Preload procedural textures
  getRadialGlowTexture();
  getBeamTexture();

  // 5. GPU Texture Warmup: pre-compile texture buffers on renderer to prevent first-cast lockups
  if (renderer && typeof renderer.initTexture === 'function') {
    try {
      const glow = getRadialGlowTexture();
      if (glow) renderer.initTexture(glow);
      const beam = getBeamTexture();
      if (beam) renderer.initTexture(beam);

      for (const [, tex] of _spriteTexCache) {
        if (tex && tex.image && (tex.image.width > 1 || tex.image.complete)) {
          renderer.initTexture(tex);
        }
      }
      for (const url in _sheetTexCache) {
        const tex = _sheetTexCache[url];
        if (tex && tex.image && (tex.image.width > 1 || tex.image.complete)) {
          renderer.initTexture(tex);
        }
      }
      for (const url in _projTexCache) {
        const tex = _projTexCache[url];
        if (tex && tex.image && (tex.image.width > 1 || tex.image.complete)) {
          renderer.initTexture(tex);
        }
      }
    } catch(e) {}
  }

  // 6. GPU WebGL Shader Program Pre-Compilation
  if (renderer && typeof renderer.compile === 'function') {
    try {
      const warmupScene = new THREE.Scene();
      const warmupCam = camera || new THREE.PerspectiveCamera(45, 1, 0.1, 100);

      // Normal Sprite with Depth-Tilt Shader
      const sprMatNorm = configureSpriteMaterial(new THREE.SpriteMaterial({
        map: getRadialGlowTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending
      }), { forwardBias: 0.3 });
      warmupScene.add(new THREE.Sprite(sprMatNorm));

      // Additive Sprite with Depth-Tilt Shader
      const sprMatAdd = configureSpriteMaterial(new THREE.SpriteMaterial({
        map: getRadialGlowTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      }), { forwardBias: 0.3 });
      warmupScene.add(new THREE.Sprite(sprMatAdd));

      // Slash / Burst Rings (MeshBasicMaterial)
      const ringMatNorm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide });
      warmupScene.add(new THREE.Mesh(_ringGeo, ringMatNorm));

      const ringMatAdd = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      warmupScene.add(new THREE.Mesh(_ringGeo, ringMatAdd));

      // Line / Beam geometry
      const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true });
      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(1,1,1)]);
      warmupScene.add(new THREE.Line(lineGeo, lineMat));

      // AoE cylinder geometry
      const cylMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide });
      const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16);
      warmupScene.add(new THREE.Mesh(cylGeo, cylMat));

      renderer.compile(warmupScene, warmupCam);
    } catch(e) {}
  }

  // 7. NixieFX Particle Shader & Emitter Warmup
  try {
    warmupNixieVfx(scene, camera);
  } catch(e) { reportError('nixie VFX warmup', e, 'warn'); }

  // 8. Audio SFX WebAudio Buffer Preload & Decode
  try {
    preloadCommonSFX();
  } catch(e) { reportError('SFX preload', e, 'warn'); }
}

/**
 * Preload all assets required for the active dungeon floor:
 * - Spell & combat VFX sheets and procedural textures
 * - Active floor monster sprites & animation atlas sheets
 * - Party hero sprites, familiars, companions, equipment, and campsite tents
 * - GPU VRAM texture binding and WebGL scene compilation + frame pre-render
 */
export async function preloadFloorAssets(game, renderer = null, scene = null, camera = null, onProgress = null) {
  const report = (pct, msg) => {
    if (typeof onProgress === 'function') onProgress(pct, msg);
    try { updateLoadingProgress(pct, msg); } catch(e) {}
  };

  report(15, 'Carving dungeon chambers & corridors...');
  if (renderer) _activeRenderer = renderer;
  if (scene) ensureFlashLightPool(scene);

  // 1. Preload base spell and combat VFX suite
  report(35, 'Loading spell VFX & cantrip sheets...');
  preloadAllSpellAndCombatVFX(renderer, scene, camera);

  // 2. Preload active monster textures for this floor
  report(55, 'Placing encounters & summoning monsters...');
  const monsterUrls = new Set();
  const sheetUrls = new Set();
  if (game && Array.isArray(game.monsters)) {
    for (const m of game.monsters) {
      if (!m || !m.data) continue;
      if (m.data.sprite) monsterUrls.add(m.data.sprite);
      for (const u of monsterSheetUrls(m.data)) sheetUrls.add(u);
    }
  }
  /* The party's own frame-sliced sheets (war wolf, familiars, wild shapes)
     must survive the eviction below — they cross floors with the party. */
  if (game && Array.isArray(game.heroes)) {
    for (const h of game.heroes) {
      const anims = h && h.data && h.data.visual && h.data.visual.animations;
      if (!anims) continue;
      for (const k in anims) if (anims[k] && anims[k].sprite) sheetUrls.add(anims[k].sprite);
    }
  }
  /* A druid's wild-shape sheets live on the form, not the hero's visual. */
  for (const form of Object.values(WILD_SHAPE_FORMS || {})) {
    const anims = form && form.animations;
    if (!anims) continue;
    for (const k in anims) if (anims[k] && anims[k].sprite) sheetUrls.add(anims[k].sprite);
  }
  /* Sheets from earlier floors that nobody on this one uses are freed here,
     so a long session does not keep every biome it has visited in VRAM. */
  evictSharedSheets((key) => sheetUrls.has(key.split('#')[0]));
  for (const u of sheetUrls) warmSharedSheet(u);

  // 3. Preload all party hero sprites, familiars, companions, and tent assets
  report(72, 'Composing party hero sprites...');
  const heroUrls = new Set([
    'sprites/tent/tent_front.png',
    'sprites/tent/tent_back.png',
    'sprites/tent/tent_left.png',
    'sprites/tent/tent_right.png',
    'sprites/giant_owl.png',
    'dcss/monster/demons/imp.png',
    'dcss/monster/animals/viper.png',
    'sprites/wolf.png'
  ]);

  const heroPromises = [];
  if (game && Array.isArray(game.heroes)) {
    for (const h of game.heroes) {
      if (!h) continue;
      if (h.data && h.data.visual && h.data.visual.spriteSheet) heroUrls.add(h.data.visual.spriteSheet);
      if (h.ent && h.ent.anim) {
        if (typeof h.ent.anim.whenReady === 'function') {
          heroPromises.push(h.ent.anim.whenReady());
        } else if (h.ent.anim._readyPromise) {
          heroPromises.push(h.ent.anim._readyPromise);
        }
      }
    }
  }

  for (const u of monsterUrls) {
    getOrLoadSpriteTexture(u);
  }
  for (const u of heroUrls) {
    getOrLoadSpriteTexture(u);
  }

  if (heroPromises.length > 0) {
    await Promise.race([
      Promise.all(heroPromises),
      new Promise(r => setTimeout(r, 2000))
    ]);
  }

  // 4. Wait for all pending image elements in caches to decode / complete
  report(86, 'Decoding textures & binding GPU buffers...');
  const decodePromises = [];
  if (typeof Image !== 'undefined') {
    const checkTex = (tex) => {
      if (tex && tex.image && typeof tex.image === 'object' && !tex.image.complete) {
        decodePromises.push(
          new Promise(res => {
            if (typeof tex.image.decode === 'function') {
              tex.image.decode().then(res).catch(res);
            } else {
              tex.image.onload = res;
              tex.image.onerror = res;
            }
          })
        );
      }
    };

    for (const [, tex] of _spriteTexCache) checkTex(tex);
    for (const url in _sheetTexCache) checkTex(_sheetTexCache[url]);
  }

  if (decodePromises.length > 0) {
    await Promise.race([
      Promise.all(decodePromises),
      new Promise(r => setTimeout(r, 1200))
    ]);
  }

  // 5. GPU buffer init on all loaded textures
  if (renderer && typeof renderer.initTexture === 'function') {
    try {
      const glow = getRadialGlowTexture();
      if (glow) renderer.initTexture(glow);
      const beam = getBeamTexture();
      if (beam) renderer.initTexture(beam);
      for (const [, tex] of _spriteTexCache) {
        if (tex && tex.image && (tex.image.width > 1 || tex.image.complete)) {
          renderer.initTexture(tex);
        }
      }
      for (const url in _sheetTexCache) {
        const tex = _sheetTexCache[url];
        if (tex && tex.image && (tex.image.width > 1 || tex.image.complete)) {
          renderer.initTexture(tex);
        }
      }
      if (game && Array.isArray(game.heroes)) {
        for (const h of game.heroes) {
          if (h && h.ent && h.ent.anim && h.ent.anim.textures) {
            for (const k in h.ent.anim.textures) {
              const t = h.ent.anim.textures[k];
              if (t) renderer.initTexture(t);
            }
          }
        }
      }
    } catch(e) {}
  }

  // 6. Pre-compile active live scene with renderer
  report(94, 'Compiling WebGL shaders & lighting...');
  if (renderer && scene && camera && typeof renderer.compile === 'function') {
    try {
      renderer.compile(scene, camera);
    } catch(e) { reportError('shader precompile', e, 'warn'); }
  }

  // 7. Warmup pre-render (render 1-2 frames while loading screen is covering)
  report(99, 'Warming GPU render pipeline...');
  if (renderer && scene && camera && typeof renderer.render === 'function') {
    try {
      renderer.render(scene, camera);
    } catch(e) { reportError('warmup frame', e, 'warn'); }
  }

  report(100, 'Ready!');
}

/* spriteDef: either a texture path string, or { sprite, frames, frameInterval }
   where `frames` is an array of texture paths cycled every `frameInterval`
   seconds for the effect's lifetime (ABILITY_FX animated entries). */
export function spawnSpriteEffect(scene, spriteDef, pos, scale=1.5, dur=0.4, opts = {}){
  const loadTex = p => getOrLoadSpriteTexture(p);
  const isDef = typeof spriteDef === 'object' && spriteDef !== null;
  /* `frames` may hold one or many texture paths. A single-element array used to
     fall through to `spriteDef.sprite` (which callers like spawnRichAbilityVFX
     don't set) leaving the material with no map — an untextured SpriteMaterial
     renders as a solid white square. Always honour frames, even length 1. */
  const framePaths = isDef && Array.isArray(spriteDef.frames) && spriteDef.frames.length > 0
    ? spriteDef.frames : null;
  const frames = framePaths ? framePaths.map(loadTex) : null;
  const singlePath = isDef ? (spriteDef.sprite || (Array.isArray(spriteDef.frames) ? spriteDef.frames[0] : null)) : spriteDef;
  const tex = frames ? frames[0] : loadTex(singlePath);

  const mat = configureSpriteMaterial(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: 0,
    blending: opts.blend || THREE.NormalBlending
  }), { forwardBias: 0.3 });
  mat.toneMapped = false;
  const mesh = new THREE.Sprite(mat);
  mesh.scale.set(scale, scale, 1);
  mesh.position.copy(pos);
  mesh.renderOrder = opts.renderOrder != null ? opts.renderOrder : 25;
  scene.add(mesh);

  const entry = { mesh, mat, tex, frames,
    frameInterval: frames ? (spriteDef.frameInterval || 0.07) : 0, t: 0,
    dur: (dur && dur > 0) ? dur : 0.4,
    baseOpacity: opts.opacity != null ? opts.opacity : 1 };
  spriteEffects.push(entry);
  return entry;
}

export function getSparkEffectForDamageType(dmgType) {
  if (!dmgType) return 'hit_sparks';
  const t = String(dmgType).toLowerCase();
  if (t === 'fire') return 'fire_sparks';
  if (t === 'cold' || t === 'frost') return 'frost_sparks';
  if (t === 'acid') return 'acid_sparks';
  if (t === 'poison') return 'poison_sparks';
  if (t === 'lightning') return 'lightning_sparks';
  if (t === 'radiant' || t === 'holy') return 'holy_sparks';
  if (t === 'necrotic' || t === 'dark') return 'dark_sparks';
  if (t === 'force') return 'force_sparks';
  if (t === 'psychic') return 'psychic_sparks';
  if (t === 'thunder') return 'lightning_sparks';
  if (t === 'piercing' || t === 'piercing_magical') return 'pierce_sparks';
  if (t === 'bludgeoning' || t === 'bludgeoning_magical') return 'blunt_impact';
  return 'hit_sparks';
}

/** Animated Pixel Melee & Attack Impact VFX with Damage-Color Coded Sparks */
export function spawnMeleeHitVFX(scene, targetPos, attackerPos, isCrit = false, dmgType = 'slashing', scale = 1.0, opts = {}) {
  const tX = targetPos.x, tZ = targetPos.z;
  const hitPos = new THREE.Vector3(tX, 0.55, tZ);

  /* 1. Procedural Pixel Hit Effect (Directional, Scaled to Target) */
  const isPiercing = dmgType === 'piercing' || dmgType === 'piercing_magical';
  const isBludgeoning = dmgType === 'bludgeoning' || dmgType === 'bludgeoning_magical';
  const isSlashing = !isPiercing && !isBludgeoning;

  let vfxType = 'melee_slash';
  if (isPiercing) vfxType = 'melee_pierce';
  else if (isBludgeoning) vfxType = 'melee_blunt';

  // Calculate attack angle from attacker to target in camera screen space
  const dx = attackerPos ? (tX - attackerPos.x) : 0;
  const dz = attackerPos ? (tZ - attackerPos.z) : 0;
  const camAngle = opts.camAngle || 0;
  const cosC = Math.cos(camAngle), sinC = Math.sin(camAngle);
  const rdx = dx * cosC - dz * sinC;
  const rdz = dx * sinC + dz * cosC;

  // Angle of incoming strike in camera/screen space
  let screenAngle = 0;
  if (Math.abs(rdx) > 1e-4 || Math.abs(rdz) > 1e-4) {
    screenAngle = Math.atan2(-rdz, rdx);
  }

  // Directional orientation:
  // - Slashing: blade curves through center and cuts perpendicular to strike line
  // - Piercing: thrusts directly along the strike line
  // - Bludgeoning: forward impact compression along strike line
  let rot = screenAngle;
  if (isSlashing) {
    const tilt = ((Math.abs(Math.floor(tX * 7 + tZ * 13)) % 5) - 2) * 0.12;
    rot = screenAngle + tilt;
  } else if (isPiercing) {
    rot = screenAngle;
  } else {
    rot = screenAngle;
  }

  // Baseline scale factor: never shrink weapon impacts below hero scale on small enemies
  const effScale = Math.max(1.0, Math.sqrt(scale));

  // Sizing tailored to effect profile:
  // - Bludgeoning: massive radial crushing smash (~2.5 to 3.0 tiles diameter)
  // - Piercing: heavy energy lance thrust (~2.2 to 2.6 tiles diameter)
  // - Slashing: wide centered crescent arc (~2.0 to 2.4 tiles diameter)
  let baseRadius = effScale * 1.0;
  if (isBludgeoning) {
    baseRadius = isCrit ? effScale * 1.50 : effScale * 1.25;
  } else if (isPiercing) {
    baseRadius = isCrit ? effScale * 1.30 : effScale * 1.10;
  } else {
    baseRadius = isCrit ? effScale * 1.20 : effScale * 1.00;
  }
  const pixelDur = isCrit ? 0.36 : 0.30;

  spawnPixelVfx(scene, {
    type: vfxType,
    pos: hitPos,
    radius: baseRadius,
    duration: pixelDur,
    rot,
    billboard: true,
    isCrit
  });

  /* 2. Impact Sparks with Multi-Damage-Type Color Coding */
  if (isCrit) {
    playNixieEffect('crit_sparks', hitPos, { scale: 1.25, duration: 0.45 });
  }

  // A. Primary damage spark splash
  const primarySpark = getSparkEffectForDamageType(dmgType);
  const sparkScale = isBludgeoning ? (isCrit ? 0.45 : 0.35) : (isCrit ? 1.25 : 1.0);
  playNixieEffect(primarySpark, hitPos, { scale: sparkScale, duration: 0.40 });

  // B. Secondary elemental damage splash (e.g. +2 frost, +3 fire, +2 acid)
  if (opts.elemDamage && typeof opts.elemDamage === 'object') {
    for (const [elemType, val] of Object.entries(opts.elemDamage)) {
      if (!val || val <= 0) continue;
      const elemSpark = getSparkEffectForDamageType(elemType);
      const elemPos = new THREE.Vector3(tX + (Math.random() - 0.5) * 0.12, 0.58, tZ + (Math.random() - 0.5) * 0.12);
      playNixieEffect(elemSpark, elemPos, { scale: isCrit ? 1.25 : 1.05, duration: 0.40 });
    }
  }
}

/** Rich Multi-Layered Animated Spell & Ability VFX Burst */
export function spawnRichAbilityVFX(scene, casterPos, targetPos, fx, label, opts = {}) {
  if (typeof globalThis.setCombatActionFocus === 'function' && targetPos) {
    globalThis.setCombatActionFocus(casterPos || targetPos, targetPos, 0.95, opts.aoe ? 0.28 : 0.18);
  }
  const tX = targetPos.x, tZ = targetPos.z;
  const cX = casterPos ? casterPos.x : tX;
  const cZ = casterPos ? casterPos.z : tZ;
  const hitPos = new THREE.Vector3(tX, 0.55, tZ);
  const color = fx.color || 0xe04040;
  const scale = opts.aoe ? 2.2 : 1.6;
  const dmgType = fx.dmgType || (fx.effect ? fx.effect.key : 'magic');

  /* 1. Gigapack Spritesheet Burst */
  let sheetKey = fx.sheetKey;
  if (!sheetKey) {
    if (dmgType === 'fire') sheetKey = 'epic_explosion_001_large_orange';
    else if (dmgType === 'cold') sheetKey = 'round_sparkle_burst_001_large_blue';
    else if (dmgType === 'acid' || dmgType === 'poison' || dmgType === 'poisoned') sheetKey = 'spell_poison_001_large_green';
    else if (dmgType === 'lightning') sheetKey = 'lightning_burst_001_large_violet';
    else if (dmgType === 'necrotic' || dmgType === 'drained') sheetKey = 'spell_death_001_large_red';
    else if (dmgType === 'wounded' || dmgType === 'bleed') sheetKey = 'round_sparkle_burst_003_large_red';
    else if (dmgType === 'radiant' || dmgType === 'heal') sheetKey = 'spell_heal_001_large_red';
    else if (dmgType === 'psychic' || dmgType === 'frightened' || dmgType === 'charmed' || dmgType === 'blinded') sheetKey = 'stylized_skull_smoke_burst_001_large_white';
    else sheetKey = 'round_sparkle_burst_003_large_red';
  }

  if (sheetKey && GIGAPACK_REGISTRY[sheetKey]) {
    spawnSheetEffect(scene, GIGAPACK_REGISTRY[sheetKey], hitPos, scale * 1.3, 0.45);
  }

  /* 3. Element-Specific Multi-Frame Animated Particle Sequence */
  let frames = null;
  if (dmgType === 'fire') {
    frames = ['dcss/effect/cloud_fire_0.png', 'dcss/effect/cloud_fire_1.png', 'dcss/effect/cloud_fire_2.png', 'dcss/effect/cloud_forest_fire.png', 'dcss/effect/flame_1.png'];
  } else if (dmgType === 'cold') {
    frames = ['dcss/effect/cloud_cold_0.png', 'dcss/effect/cloud_cold_1.png', 'dcss/effect/cloud_cold_2.png', 'dcss/effect/frost_0.png', 'dcss/effect/frost_1.png'];
  } else if (dmgType === 'acid' || dmgType === 'poison' || dmgType === 'poisoned') {
    frames = ['dcss/effect/cloud_acid_0.png', 'dcss/effect/cloud_acid_1.png', 'dcss/effect/cloud_poison_0.png', 'dcss/effect/cloud_poison_1.png', 'dcss/effect/acid_venom.png'];
  } else if (dmgType === 'lightning') {
    frames = ['dcss/effect/zap_0.png', 'dcss/effect/zap_1.png', 'dcss/effect/zap_2.png', 'dcss/effect/zap_3.png', 'dcss/effect/kny_spark_2.png'];
  } else if (dmgType === 'necrotic' || dmgType === 'drained') {
    frames = ['dcss/effect/cloud_neg_0.png', 'dcss/effect/cloud_neg_1.png', 'dcss/effect/cloud_neg_2.png', 'dcss/effect/drain_red_1.png', 'dcss/effect/umbra_1.png'];
  } else if (dmgType === 'wounded' || dmgType === 'bleed') {
    frames = ['dcss/effect/drain_red_0.png', 'dcss/effect/drain_red_1.png', 'dcss/effect/drain_red_2.png'];
  } else if (dmgType === 'radiant') {
    frames = ['dcss/effect/goldaura_0.png', 'dcss/effect/goldaura_1.png', 'dcss/effect/goldaura_2.png', 'dcss/effect/gold_sparkles_1.png', 'dcss/effect/gold_sparkles_2.png'];
  } else if (dmgType === 'psychic' || dmgType === 'frightened' || dmgType === 'charmed' || dmgType === 'blinded' || dmgType === 'incapacitated') {
    frames = ['dcss/effect/cloud_gloom_new.png', 'dcss/effect/quad_glow.png', 'dcss/effect/disjunct_0.png', 'dcss/effect/disjunct_1.png'];
  } else {
    const baseSprite = fx.sprite ? (fx.sprite.includes('.png') ? fx.sprite : `dcss/effect/${fx.sprite}.png`) : 'dcss/effect/magic_bolt_1.png';
    frames = [baseSprite];
  }

  spawnSpriteEffect(scene, { frames, frameInterval: 0.05 }, hitPos, scale, 0.45);

  /* 4. NixieFX Multi-Emitter Elemental Particle Blast */
  let nixieType = null;
  if (dmgType === 'fire') nixieType = 'fire_burst';
  else if (dmgType === 'cold') nixieType = 'frost_nova';
  else if (dmgType === 'lightning') nixieType = 'lightning_burst';
  else if (dmgType === 'acid' || dmgType === 'poison' || dmgType === 'poisoned') nixieType = 'poison_burst';
  else if (dmgType === 'radiant' || dmgType === 'heal') nixieType = 'holy_burst';
  else if (dmgType === 'necrotic' || dmgType === 'drained' || dmgType === 'wounded' || dmgType === 'bleed') nixieType = 'dark_burst';
  else if (dmgType === 'bludgeoning') nixieType = 'blunt_impact';
  else if (dmgType === 'piercing') nixieType = 'pierce_sparks';
  else nixieType = 'hit_sparks';

  if (nixieType) {
    playNixieEffect(nixieType, hitPos, { scale: opts.aoe ? 1.3 : 1.0, duration: opts.aoe ? 0.65 : 0.55 });
  }

  /* 5. Projectile Beam from Caster to Target for Ranged Spells Only */
  const isRanged = opts.projectile || fx.projectile || (fx.range != null && fx.range > 2);
  if (isRanged && Math.hypot(tX - cX, tZ - cZ) > 1.2) {
    const projType = dmgType === 'fire' ? 'fireball' : dmgType === 'cold' ? 'icicle' : dmgType === 'lightning' ? 'zap' : 'magic';
    const from = new THREE.Vector3(cX, 0.55, cZ);
    const to = new THREE.Vector3(tX, 0.4, tZ);
    spawnProjectile(scene, from, to, projType, color, () => {});
  }
}

/* -------- Persistent procedural VFX for concentration zones --------
   Unlike one-shot bursts (playAbilityFx), these attach to the AOE zone's visual
   group so they live and die with the spell itself: Faerie Fire keeps a cube of
   rising red sparkles, Entangle keeps vines growing from the floor. They are
   ticked inside the activeAoEVisuals update loop and disposed by removeAoEVisual().
   The sheet burst still fires on cast; these are the layer that persists. */

/** Builds a persistent swirling aura of rising sparkles as children of `group`. */
function buildSparkleCubeZone(group, radius, color, opts = {}) {
  const fxGroup = new THREE.Group();
  fxGroup.position.y = (opts.y != null ? opts.y : 0.65);
  group.add(fxGroup);

  const dotTex = getRadialGlowTexture();
  const count = opts.count || 28;
  const sparks = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const r = (0.35 + Math.random() * 0.65) * radius;
    const p = new THREE.Vector3(
      Math.cos(angle) * r,
      (Math.random() - 0.2) * 0.7,
      Math.sin(angle) * r
    );

    const mat = configureSpriteMaterial(new THREE.SpriteMaterial({
      map: dotTex, color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    mat.toneMapped = false;
    const mesh = new THREE.Sprite(mat);
    const s = 0.08 + Math.random() * 0.06;
    mesh.scale.set(s, s, 1);
    mesh.position.copy(p);
    fxGroup.add(mesh);
    sparks.push({
      mesh, mat,
      base: p.clone(),
      rise: 0.65 + Math.random() * 0.5,
      speed: 0.45 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2
    });
  }

  return { fxGroup, wireMat: null, sparks };
}

/** Builds persistent vines growing up from the floor as children of `group`. */
function buildVineZone(group, radius, color, opts = {}) {
  const fxGroup = new THREE.Group();
  fxGroup.position.y = -0.31;
  group.add(fxGroup);

  const vineCount = opts.vines || 12;
  const vines = [];
  for (let i = 0; i < vineCount; i++) {
    const ang = (i / vineCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
    const dist = radius * (0.15 + Math.random() * 0.75);
    const baseX = Math.cos(ang) * dist;
    const baseZ = Math.sin(ang) * dist;
    const height = 0.70 + Math.random() * 0.7;

    const pts = [
      new THREE.Vector3(0, 0.01, 0),
      new THREE.Vector3((Math.random() - 0.5) * 0.25, height * 0.35, (Math.random() - 0.5) * 0.25),
      new THREE.Vector3((Math.random() - 0.5) * 0.35, height * 0.7, (Math.random() - 0.5) * 0.35),
      new THREE.Vector3((Math.random() - 0.5) * 0.4, height * 1.0, (Math.random() - 0.5) * 0.4)
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    const tubeGeom = new THREE.TubeGeometry(curve, 10, 0.07 + Math.random() * 0.035, 6, false);
    const mat = new THREE.MeshBasicMaterial({
      color: color || 0x2e7d32, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false
    });
    mat.toneMapped = false;
    const mesh = new THREE.Mesh(tubeGeom, mat);
    mesh.position.set(baseX, 0, baseZ);
    mesh.renderOrder = 24;
    fxGroup.add(mesh);
    vines.push({ mesh, mat, tubeGeom, ang, seed: Math.random() * Math.PI * 2 });
  }

  return { fxGroup, vines };
}

/* -------- animated spritesheet FX (Pixel FX pack: square grids of 100px frames) --------
   def: { url, cols, rows, frames, fps, dur?, scale? }. Plays from frame 0 at
   `fps`, wrapping around the sheet's loop if `dur` outlasts it, with the same
   fade-in/out envelope as spawnSpriteEffect. Textures are cached per URL and
   cloned per instance (clones share the image source — one GPU upload). */
const sheetEffects = [];
const _sheetTexCache = {};
export function spawnSheetEffect(scene, def, pos, scale = null, dur = null, opts = {}){
  const base = getOrLoadSheetTexture(def.url);
  const tex = base ? base.clone() : new THREE.Texture();
  tex.needsUpdate = true;
  tex.repeat.set(sheetFrameRepeat(def).x, sheetFrameRepeat(def).y);
  const mat = configureSpriteMaterial(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: 0,
    blending: opts.blend || (opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending)
  }), { forwardBias: 0.3 });
  mat.toneMapped = false;
  const mesh = new THREE.Sprite(mat);
  const s = scale != null ? scale : (def.scale || 1.5);
  /* Scale is the frame's height; a non-square frame (pixelfx sheets) keeps
     its width:height. `pivot` [u, v] from the bottom-left puts the effect's
     own origin — a blast's floor line, a bolt's head — on `pos`. */
  const aspect = def.fw && def.fh ? def.fw / def.fh : 1;
  mesh.scale.set(s * aspect, s, 1);
  if (def.pivot) mesh.center.set(def.pivot[0], def.pivot[1]);
  mesh.position.copy(pos);
  mesh.renderOrder = opts.renderOrder != null ? opts.renderOrder : 30;
  scene.add(mesh);
  const rawDur = dur != null ? dur : (def.dur != null ? def.dur : (def.frames && def.fps ? def.frames / def.fps : 0.45));
  const d = (rawDur && rawDur > 0) ? rawDur : 0.45;
  const entry = { mesh, mat, tex, def, t: 0, dur: d, baseOpacity: opts.opacity != null ? opts.opacity : 1 };
  sheetEffects.push(entry);
  return entry;
}

/* -------- sheet laid from caster to target (span_ribbon.js) --------
   For a sheet that is itself a line — a ray whose source is the frame's left
   edge and whose tip is its right edge. The frame is stretched over a ribbon
   along the real from→to line, rebuilt from the rendering camera every frame
   it draws, so it stays on the beam while the camera sways or turns. Played
   and faded by the same loop as spawnSheetEffect. `thickness` is the ribbon's
   width across the line, in world units. */
export function spawnSpanSheetEffect(scene, def, from, to, thickness = 1, dur = null, opts = {}){
  const base = getOrLoadSheetTexture(def.url);
  const tex = base ? base.clone() : new THREE.Texture();
  tex.needsUpdate = true;
  tex.repeat.set(sheetFrameRepeat(def).x, sheetFrameRepeat(def).y);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide,
    blending: opts.blend || (opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending)
  });
  mat.toneMapped = false;
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(12), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const mesh = new THREE.Mesh(geo, mat);
  /* The vertices are world positions written per frame; the mesh itself never
     moves, so its bounds say nothing — never cull it. */
  mesh.frustumCulled = false;
  mesh.renderOrder = opts.renderOrder != null ? opts.renderOrder : 30;
  const span = { from: from.clone(), to: to.clone(), halfWidth: Math.max(0.05, thickness) / 2 };
  const basis = cameraBasisFromYawPitch(Math.PI / 4, 0.64);   // until the first draw
  spanRibbon(span.from, span.to, basis.right, basis.up, span.halfWidth, posAttr.array);
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    const b = cameraBasisFromMatrix(camera.matrixWorld.elements);
    spanRibbon(span.from, span.to, b.right, b.up, span.halfWidth, posAttr.array);
    posAttr.needsUpdate = true;
  };
  scene.add(mesh);
  const rawDur = dur != null ? dur : (def.dur != null ? def.dur : (def.frames && def.fps ? def.frames / def.fps : 0.45));
  const d = (rawDur && rawDur > 0) ? rawDur : 0.45;
  const entry = { mesh, mat, tex, geo, def, span, t: 0, dur: d, baseOpacity: opts.opacity != null ? opts.opacity : 1 };
  sheetEffects.push(entry);
  return entry;
}

let _beamTex = null;
function getBeamTexture() {
  if (!_beamTex) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const ctx = cv.getContext('2d');
    if (ctx && typeof ctx.createLinearGradient === 'function') {
      try {
        // Smooth horizontal linear gradient across beam width (X axis)
        const grad = ctx.createLinearGradient(0, 0, 128, 0);
        grad.addColorStop(0.00, 'rgba(255, 255, 255, 0.00)');
        grad.addColorStop(0.15, 'rgba(255, 255, 255, 0.40)');
        grad.addColorStop(0.40, 'rgba(255, 255, 255, 0.95)');
        grad.addColorStop(0.50, 'rgba(255, 255, 255, 1.00)');
        grad.addColorStop(0.60, 'rgba(255, 255, 255, 0.95)');
        grad.addColorStop(0.85, 'rgba(255, 255, 255, 0.40)');
        grad.addColorStop(1.00, 'rgba(255, 255, 255, 0.00)');

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);

        // Energy texture streaks along length (Y axis)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        for (let i = 0; i < 12; i++) {
          const y = (i * 10 + Math.random() * 5) % 128;
          const h = 3 + Math.random() * 8;
          ctx.fillRect(24, y, 80, h);
        }
      } catch(e) {}
    }

    _beamTex = new THREE.CanvasTexture(cv);
    _beamTex.colorSpace = THREE.SRGBColorSpace;
    _beamTex.wrapS = THREE.ClampToEdgeWrapping;
    _beamTex.wrapT = THREE.RepeatWrapping;
  }
  return _beamTex;
}

/* -------- 3D Continuous Beam VFX System -------- */
const activeBeams = [];

const PIXELFX_BEAM_TYPES = new Set(['ray', 'laser', 'drain', 'lightning']);
/* the holy pillar's sun opens ~165 art px over its floor mark: ~5.5 units up */
const PILLAR_PX_PER_UNIT = 30;
export function spawnBeamEffect(scene, from, to, opts = {}) {
  const type = opts.type || 'ray';
  const color = opts.color || 0xff7a30;
  const coreColor = opts.coreColor || 0xffffff;
  const width = opts.width || 0.65;
  const duration = opts.duration || 0.55;
  const scrollSpeed = opts.scrollSpeed !== undefined ? opts.scrollSpeed : 5.0;
  const onHit = opts.onHit || null;

  if (typeof globalThis.setCombatActionFocus === 'function' && from && to) {
    globalThis.setCombatActionFocus(from, to, duration + 0.35);
  }

  // Execute onHit immediately so impact damage & hit numbers trigger cleanly
  /* An impact callback is damage, a log line and a hit number — if it throws,
     the spell silently did nothing. */
  if (onHit) { try { onHit(); } catch(e){ reportError('beam impact', e); } }

  /* Rays, lasers, drains and lightning are the pixelfx beam (render/pfx/beam.js,
     drawn live), in a palette built from the spell's own colour and core
     colour: a drain's pulses run back into the caster, lightning crackles.
     It has its own source and impact flares, so the old Gigapack bursts are
     left out. Pillars and chains keep the renderers below. */
  if (PIXELFX_BEAM_TYPES.has(type)) {
    spawnLiveBeam(scene, from, to, {
      palette: opts.palette || rampFrom(color, coreColor),
      flow: type === 'drain' ? -1 : 1,
      jag: type === 'lightning' ? 1 : 0,
      width, duration, opacity: opts.opacity,
    });
    return;
  }

  /* A pillar is light breaking through from above onto the mark (pixelfx
     holy/holy-pillar: a sun opens, shafts converge on a burning floor sigil)
     in the spell's colours — Moonbeam pale silver. `flame` layers a column of
     fire erupting through it (fire/flame-pillar): Flame Strike's divine fire.
     Both stand on the floor under `to` (opts.groundY, from the caller who
     knows the terrain), drawn live, and end on their own. */
  if (type === 'pillar') {
    const at = new THREE.Vector3(to.x, opts.groundY != null ? opts.groundY : Math.max(0, (to.y || 0) - 0.4), to.z);
    const base = { pos: at, pxPerUnit: PILLAR_PX_PER_UNIT, fadeIn: 0.05, opacity: opts.opacity };
    spawnLivePixelFx(scene, holyPillarFx, { ...base, options: { palette: opts.palette || rampFrom(color, coreColor) } });
    if (opts.flame) spawnLivePixelFx(scene, flamePillarFx, base);
    return;
  }

  // 1. Optional Pixel Art Source & Target Bursts
  if (opts.casterBurst && GIGAPACK_REGISTRY[opts.casterBurst]) {
    spawnSheetEffect(scene, GIGAPACK_REGISTRY[opts.casterBurst], from, 1.4, duration * 0.8);
  }
  if (opts.targetBurst && GIGAPACK_REGISTRY[opts.targetBurst]) {
    spawnSheetEffect(scene, GIGAPACK_REGISTRY[opts.targetBurst], to, 1.8, duration * 0.8);
  }

  const group = new THREE.Group();

  if (type === 'pillar') {
    // Vertical Light Column / Pillar (Moonbeam, Call Lightning, Flame Strike)
    const beamOp = opts.opacity != null ? opts.opacity : 1.0;
    const height = Math.abs((from.y || 6.0) - (to.y || 0.05)) || 6.0;
    const radius = width * 0.9;
    const cylGeo = new THREE.CylinderGeometry(radius * 0.8, radius, height, 16, 1, true);

    const glowTex = getBeamTexture().clone();
    glowTex.repeat.set(1, 4);

    const baseGlowOp = 0.85 * beamOp;
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color,
      transparent: true,
      opacity: baseGlowOp,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    const coreTex = getBeamTexture().clone();
    coreTex.repeat.set(1, 4);

    const baseCoreOp = 0.95 * beamOp;
    const coreGeo = new THREE.CylinderGeometry(radius * 0.4, radius * 0.45, height, 12, 1, true);
    const coreMat = new THREE.MeshBasicMaterial({
      map: coreTex,
      color: coreColor,
      transparent: true,
      opacity: baseCoreOp,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    const glowMesh = new THREE.Mesh(cylGeo, glowMat);
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    group.add(glowMesh);
    group.add(coreMesh);

    group.position.set(to.x, height * 0.5 + (to.y || 0), to.z);
    scene.add(group);

    activeBeams.push({
      group, glowMat, coreMat, glowTex, coreTex, type, from: from.clone(), to: to.clone(),
      width, scrollSpeed, duration, t: 0, baseGlowOp, baseCoreOp
    });
    return;
  }

  if (type === 'lightning') {
    // REAL 3D Connected Lightning Arc Mesh Engine
    const glowTex = getBeamTexture().clone();
    glowTex.repeat.set(1, 1);

    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    const coreMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color: coreColor,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    // Dynamic Electric Point Light Source (pooled — see ensureFlashLightPool)
    const light = acquirePooledLight(scene);
    if (light) {
      light.color.set(color);
      light.intensity = 5.0;
      light.distance = 14;
      light.decay = 2;
      light.position.copy(from);
      group.add(light);
    }

    const updateLightningNodes = () => {
      // Remove old segment meshes (preserve light)
      for (let i = group.children.length - 1; i >= 0; i--) {
        if (group.children[i] !== light) group.remove(group.children[i]);
      }

      // Generate Main Jagged Path Points
      const N = 12;
      const points = [];
      const dir = new THREE.Vector3().subVectors(to, from);
      const perp1 = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      if (perp1.lengthSq() < 0.001) perp1.set(1, 0, 0);
      const perp2 = new THREE.Vector3().crossVectors(dir, perp1).normalize();

      for (let i = 0; i <= N; i++) {
        const k = i / N;
        const pt = new THREE.Vector3().lerpVectors(from, to, k);
        if (i > 0 && i < N) {
          const j1 = (Math.random() - 0.5) * 0.55 * Math.sin(k * Math.PI);
          const j2 = (Math.random() - 0.5) * 0.55 * Math.sin(k * Math.PI);
          pt.addScaledVector(perp1, j1);
          pt.addScaledVector(perp2, j2);
        }
        points.push(pt);
      }

      // Build Connected Ribbon Segments between consecutive points
      const buildSegment = (pA, pB, segWidth) => {
        const segDir = new THREE.Vector3().subVectors(pB, pA);
        const segLen = segDir.length() || 0.1;
        const segMid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);

        const pG = new THREE.PlaneGeometry(segWidth, segLen);
        const m1 = new THREE.Mesh(pG, glowMat);
        const m2 = new THREE.Mesh(pG, glowMat);
        m2.rotation.y = Math.PI / 2;

        const pC = new THREE.PlaneGeometry(segWidth * 0.45, segLen);
        const mc1 = new THREE.Mesh(pC, coreMat);
        const mc2 = new THREE.Mesh(pC, coreMat);
        mc2.rotation.y = Math.PI / 2;

        const segGrp = new THREE.Group();
        segGrp.add(m1); segGrp.add(m2);
        segGrp.add(mc1); segGrp.add(mc2);
        segGrp.position.copy(segMid);

        const segNorm = segDir.clone().normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), segNorm);
        segGrp.quaternion.copy(quat);

        group.add(segGrp);
      };

      for (let i = 0; i < points.length - 1; i++) {
        buildSegment(points[i], points[i + 1], width);
      }

      // Branching Side Arcs (2 electric side branches crackling off main bolt)
      const branchIndices = [3, 7];
      for (const bIdx of branchIndices) {
        if (points[bIdx]) {
          const bStart = points[bIdx].clone();
          const branchDir = perp1.clone().multiplyScalar((Math.random() - 0.5) > 0 ? 1 : -1).addScaledVector(dir, 0.2).normalize();
          const bEnd = bStart.clone().addScaledVector(branchDir, 1.3);
          const bMid = bStart.clone().addScaledVector(branchDir, 0.65).addScaledVector(perp2, (Math.random() - 0.5) * 0.4);
          buildSegment(bStart, bMid, width * 0.65);
          buildSegment(bMid, bEnd, width * 0.4);
        }
      }
    };

    updateLightningNodes();
    scene.add(group);

    activeBeams.push({
      group, glowMat, coreMat, type, from: from.clone(), to: to.clone(),
      width, scrollSpeed, duration, t: 0, updateLightningNodes, lastJitter: 0,
      baseGlowOp: 0.95, baseCoreOp: 1.0, light
    });
    return;
  }

  if (type === 'chain') {
    /* Hook & chain (Hook-Hauler's "Drag Them Back").
       Deliberately unlike every other beam type here: a chain is an OBJECT, not
       a glow, so it uses normal blending and a dull iron colour rather than the
       additive light ribbon the spell beams use. Additive made it read as a
       laser, which is exactly the wrong flavour for a meat-hook.

       Two phases over `duration`:
         throw  (0 .. throwFrac)  links extend from the hauler out to where the
                                  victim was standing when the hook was cast.
         reel   (throwFrac .. 1)  the far end follows `opts.followTo` — the
                                  victim's sprite group — so the chain shortens
                                  as pushEntity's knock-glide slides them in.
       Link spacing is fixed, so the chain sheds links as it shortens instead of
       bunching them up. */
    const SPACING = 0.24;
    const MAX_LINKS = 20;
    const throwFrac = opts.throwFrac != null ? opts.throwFrac : 0.26;
    const follow = opts.followTo || null;

    /* One geometry + one material shared by every link. */
    const linkGeo = new THREE.TorusGeometry(0.082, 0.028, 4, 8);
    const hookGeo = new THREE.ConeGeometry(0.1, 0.28, 5);
    const chainMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 1.0, depthWrite: false, side: THREE.DoubleSide
    });

    const links = [];
    for (let i = 0; i < MAX_LINKS; i++) {
      const link = new THREE.Mesh(linkGeo, chainMat);
      link.visible = false;
      group.add(link);
      links.push(link);
    }
    const hook = new THREE.Mesh(hookGeo, chainMat);
    group.add(hook);

    const anchor = from.clone();          // the hauler's fist — never moves
    const landed = to.clone();            // where the victim stood at cast time
    const UP = new THREE.Vector3(0, 1, 0);
    const AXIS = new THREE.Vector3(0, 0, 1);
    const end = new THREE.Vector3();
    const dirV = new THREE.Vector3();
    const qAlign = new THREE.Quaternion();
    const qTwist = new THREE.Quaternion();
    void AXIS;

    const updateChain = (k) => {
      /* Before the hook bites, aim at where they were; after, track the sprite
         so the chain stays welded to them while they are hauled in. */
      if (k >= throwFrac && follow && follow.position) {
        end.set(follow.position.x, landed.y, follow.position.z);
      } else {
        end.copy(landed);
      }
      dirV.subVectors(end, anchor);
      const span = dirV.length() || 0.001;
      dirV.normalize();

      const reach = k < throwFrac ? Math.max(0.05, k / throwFrac) : 1;
      const live = span * reach;
      const n = Math.max(1, Math.min(MAX_LINKS, Math.round(live / SPACING)));

      /* A thrown chain whips; a chain under tension is straight. Sag only
         during the throw, and damp it out as the hook lands. */
      const sag = k < throwFrac ? 0.05 * (1 - k / throwFrac) : 0;

      qAlign.setFromUnitVectors(UP, dirV);
      for (let i = 0; i < MAX_LINKS; i++) {
        const link = links[i];
        if (i >= n) { link.visible = false; continue; }
        link.visible = true;
        const f = ((i + 1) / n) * live;
        link.position.copy(anchor).addScaledVector(dirV, f);
        link.position.y += Math.sin(i * 1.1 + k * 26) * sag;
        /* Interlock: a link's ring plane contains the chain direction, and
           consecutive links are rolled 90 degrees about that direction. */
        qTwist.setFromAxisAngle(dirV, (i % 2) * Math.PI / 2);
        link.quaternion.copy(qTwist).multiply(qAlign);
      }

      hook.position.copy(anchor).addScaledVector(dirV, live);
      hook.quaternion.copy(qAlign);
    };

    updateChain(0);
    scene.add(group);

    activeBeams.push({
      group, glowMat: chainMat, type, from: anchor.clone(), to: landed.clone(),
      width, duration, t: 0, baseGlowOp: 1.0,
      updateChain, extraGeos: [linkGeo, hookGeo]
    });
    return;
  }

  // Continuous Dual Cross-Plane Laser/Ray/Drain Ribbon
  const dir = new THREE.Vector3().subVectors(to, from);
  const dist = dir.length() || 1;
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);

  // PlaneGeometry with width along X and dist along Y (length)
  const pGeo = new THREE.PlaneGeometry(width, dist);

  const glowTex = getBeamTexture().clone();
  glowTex.repeat.set(1, Math.max(1, dist * 1.5));

  const coreTex = getBeamTexture().clone();
  coreTex.repeat.set(1, Math.max(1, dist * 1.5));

  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    color,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });

  const coreMat = new THREE.MeshBasicMaterial({
    map: coreTex,
    color: coreColor,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });

  // Dynamic Point Light Source along laser beam (pooled — see ensureFlashLightPool)
  const light = acquirePooledLight(scene);
  if (light) {
    light.color.set(color);
    light.intensity = 4.0;
    light.distance = 10;
    light.decay = 2;
    light.position.copy(mid);
    group.add(light);
  }

  // Plane 1: X-plane
  const mGlow1 = new THREE.Mesh(pGeo, glowMat);
  // Plane 2: Y-plane (rotated 90 deg around Y)
  const mGlow2 = new THREE.Mesh(pGeo, glowMat);
  mGlow2.rotation.y = Math.PI / 2;

  // Inner Core Planes (narrower width)
  const pCoreGeo = new THREE.PlaneGeometry(width * 0.42, dist);
  const mCore1 = new THREE.Mesh(pCoreGeo, coreMat);
  const mCore2 = new THREE.Mesh(pCoreGeo, coreMat);
  mCore2.rotation.y = Math.PI / 2;

  group.add(mGlow1); group.add(mGlow2);
  group.add(mCore1); group.add(mCore2);

  group.position.copy(mid);

  // Map default Y axis (0, 1, 0) onto dirNorm (vector from `from` to `to`)
  const dirNorm = dir.clone().normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirNorm);
  group.quaternion.copy(quat);

  scene.add(group);

  activeBeams.push({
    group, glowMat, coreMat, glowTex, coreTex, type, from: from.clone(), to: to.clone(),
    width, scrollSpeed, duration, t: 0, baseGlowOp: 0.92, baseCoreOp: 1.0, light
  });
}

export function updateProjectiles(scene, dt){
  updateFlashLights(scene, dt);
  for(let i=projectiles.length-1;i>=0;i--){
    const p = projectiles[i];
    p.t += dt;
    const k = Math.min(1, p.t/p.dur);

    if (p.curve) {
      const dx = p.to.x - p.from.x;
      const dz = p.to.z - p.from.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len;
      const pz = dx / len;

      const midX = (p.from.x + p.to.x) * 0.5 + px * p.curve.side;
      const midY = (p.from.y + p.to.y) * 0.5 + (p.curve.up || 0.8);
      const midZ = (p.from.z + p.to.z) * 0.5 + pz * p.curve.side;

      const invK = 1 - k;
      p.mesh.position.x = invK * invK * p.from.x + 2 * invK * k * midX + k * k * p.to.x;
      p.mesh.position.y = invK * invK * p.from.y + 2 * invK * k * midY + k * k * p.to.y;
      p.mesh.position.z = invK * invK * p.from.z + 2 * invK * k * midZ + k * k * p.to.z;
    } else {
      p.mesh.position.lerpVectors(p.from, p.to, k);
    }

    if (p.kind === 'arrow') {
      p.mesh.position.y += Math.sin(k*Math.PI)*0.22;   // gentle arc
    } else {
      // Animate spritesheet UV offsets for magic bolt projectiles
      if (p.sheetDef && p.tex) {
        const d = p.sheetDef;
        const f = Math.floor(p.t * ((d.fps || 24) * 0.70)) % d.frames;
        const _offP = sheetFrameOffset(d, f);
        p.tex.offset.set(_offP.x, _offP.y);
      }
      if (p.mat && p.kind !== 'arrow') {
        p.mat.rotation += dt * 4.2; // gentle z-rotation for energy orb (30% slower)
      }
      if (p.glowMesh) {
        const pulse = 0.85 + 0.25 * Math.sin(p.t * 18);
        p.glowMesh.scale.set((p.scale || 1.3) * 1.35 * pulse, (p.scale || 1.3) * 1.35 * pulse, 1);
      }
    }

    // Dynamic projectile particle ribbon trails
    p._lastTrail = (p._lastTrail || 0) + dt;
    if (p._lastTrail >= 0.055) {
      p._lastTrail = 0;
      const trailType = (p.kind === 'fireball' || p.kind === 'fire')
        ? 'projectile_fire_trail'
        : (p.kind === 'acid' || p.kind === 'poison')
        ? 'aura_poison'
        : (p.kind !== 'arrow')
        ? 'projectile_magic_trail'
        : null;
      if (trailType) {
        playNixieEffect(trailType, p.mesh.position, { scale: (p.scale || 1.0) * 0.9, duration: 0.35 });
      }
    }

    if(k >= 1 || !Number.isFinite(k) || p.t > (p.dur || 0.5) + 1.2){
      scene.remove(p.mesh);
      if (p.mat) p.mat.dispose();
      if (p.glowMat) p.glowMat.dispose();
      if (p.tex) p.tex.dispose();
      projectiles.splice(i,1);
      if(p.onHit){ try { p.onHit(); } catch(e){ reportError('projectile impact', e); } }
    }
  }
  for(let i=slashes.length-1;i>=0;i--){
    const s = slashes[i]; s.t += dt;
    const k = s.t/s.dur;
    s.m.scale.setScalar(s.size*(0.5 + k*1.5));
    s.mat.opacity = 0.85*(1-k);
    if(k>=1){ scene.remove(s.m); s.mat.dispose(); slashes.splice(i,1); }
  }
  for(let i=spriteEffects.length-1;i>=0;i--){
    const e = spriteEffects[i];
    e.t += dt;
    const k = e.t / e.dur;
    if (e.frames && e.frames.length > 1) {
      const idx = Math.floor(e.t / ((e.frameInterval || 0.04) * 1.30)) % e.frames.length;
      if (e.frames[idx]) e.mat.map = e.frames[idx];
    }
    if(k < 0.15) e.mat.opacity = (k / 0.15) * (e.baseOpacity ?? 1);
    else if(k > 0.8) e.mat.opacity = ((1 - k) / 0.2) * (e.baseOpacity ?? 1);
    else e.mat.opacity = (e.baseOpacity ?? 1);
    
    if(k>=1){
      scene.remove(e.mesh);
      e.mat.dispose();
      spriteEffects.splice(i,1);
    }
  }
  for(let i=sheetEffects.length-1;i>=0;i--){
    const e = sheetEffects[i];
    e.t += dt;
    const k = e.t / e.dur, d = e.def;
    /* `once` sheets (one-shot pixelfx effects) animate in by themselves: no
       fade-in over their first frames, and they hold the last frame rather
       than restarting if the layer outlasts them. */
    const fRaw = Math.floor(e.t * (d.fps * 0.70));
    const f = d.once ? Math.min(fRaw, d.frames - 1) : fRaw % d.frames;
    const _offE = sheetFrameOffset(d, f);
    e.tex.offset.set(_offE.x, _offE.y);
    if(k < 0.15 && !d.once) e.mat.opacity = (k / 0.15) * (e.baseOpacity ?? 1);
    else if(k > 0.75) e.mat.opacity = ((1 - k) / 0.25) * (e.baseOpacity ?? 1);
    else e.mat.opacity = (e.baseOpacity ?? 1);
    if(k >= 1){
      scene.remove(e.mesh);
      e.mat.dispose();
      e.tex.dispose();
      if(e.geo) e.geo.dispose();
      sheetEffects.splice(i,1);
    }
  }

  // Update 3D Beam Effects
  for (let i = activeBeams.length - 1; i >= 0; i--) {
    const b = activeBeams[i];
    b.t += dt;
    const k = b.t / b.duration;

    const alpha = k < 0.15 ? (k / 0.15) : Math.max(0, 1 - (k - 0.15) / 0.85);
    if (b.glowMat) b.glowMat.opacity = (b.baseGlowOp || 0.85) * alpha;
    if (b.coreMat) b.coreMat.opacity = (b.baseCoreOp || 0.95) * alpha;
    if (b.light) b.light.intensity = 5.0 * alpha;

    if (b.glowTex) b.glowTex.offset.y -= dt * (b.scrollSpeed || 5.0);
    if (b.coreTex) b.coreTex.offset.y -= dt * (b.scrollSpeed || 5.0);

    /* The breathing pulse is for energy ribbons. A chain is solid — scaling it
       makes the links swim — so it drives its own geometry instead. */
    if (b.group && b.type !== 'lightning' && b.type !== 'chain') {
      const pulse = 1.0 + 0.15 * Math.sin(b.t * 35);
      b.group.scale.set(pulse, 1, pulse);
    }

    if (b.type === 'chain' && b.updateChain) b.updateChain(Math.min(1, k));

    if (b.type === 'lightning' && b.updateLightningNodes) {
      if (b.t - (b.lastJitter || 0) > 0.04) {
        b.lastJitter = b.t;
        b.updateLightningNodes();
      }
    }

    if (k >= 1.0) {
      scene.remove(b.group);
      if (b.glowMat) b.glowMat.dispose();
      if (b.coreMat) b.coreMat.dispose();
      if (b.glowTex) b.glowTex.dispose();
      if (b.coreTex) b.coreTex.dispose();
      if (b.light) releasePooledLight(scene, b.light);
      /* Types that build their own geometry (chain links, hook) own it. */
      if (b.extraGeos) for (const g of b.extraGeos) g.dispose();
      activeBeams.splice(i, 1);
    }
  }

  // Update persistent AoE ground visuals
  for (let i = activeAoEVisuals.length - 1; i >= 0; i--) {
    const v = activeAoEVisuals[i];
    v.t += dt;
    if (v.shape !== 'line') {
      v.group.rotation.y += dt * v.rotateSpeed;
    }
    const pulse = 0.8 + 0.2 * Math.sin(v.t * v.pulseSpeed * Math.PI);
    if (v.borderMat) v.borderMat.opacity = (v.borderBaseOp !== undefined ? v.borderBaseOp : 0.6) * pulse;
    if (v.innerMat) v.innerMat.opacity = (v.innerBaseOp !== undefined ? v.innerBaseOp : 0.08) * pulse;

    if (v.glowTex) v.glowTex.offset.y -= dt * 3.5;
    if (v.coreTex) v.coreTex.offset.y -= dt * 5.0;
    const cylBase = v.cylBaseOp != null ? v.cylBaseOp : 0.175;
    const coreBase = v.coreBaseOp != null ? v.coreBaseOp : 0.20;
    if (v.cylMat) v.cylMat.opacity = cylBase + cylBase * 0.28 * Math.sin(v.t * 3.0);
    if (v.coreMat) v.coreMat.opacity = coreBase + coreBase * 0.25 * Math.cos(v.t * 4.0);

    // Dynamic Spell Point Lights flicker
    if (v.lights && v.lights.length > 0) {
      const flicker = 0.88 + 0.12 * Math.sin(v.t * 8.5 + v.pulseSpeed) + (Math.random() - 0.5) * 0.04;
      for (let k = 0; k < v.lights.length; k++) {
        const l = v.lights[k];
        const instFlicker = flicker + Math.sin(v.t * 11.0 + k * 1.5) * 0.05;
        l.intensity = (v.baseLightIntensity || (v.shape === 'line' ? 1.8 : 3.0)) * Math.max(0.1, instFlicker);
      }
    }

    // Persistent looping spritesheet (concentration zones keep animating).
    if (v.sheetDef) {
      v.sheetT += dt;
      const d = v.sheetDef;
      const baseFps = d.fps || 12;

      // Sync image to any clones once base texture finishes loading
      if (v.sheetBaseTex && v.sheetBaseTex.image) {
        if (v.sheetInstances && v.sheetInstances.length > 0) {
          for (let k = 0; k < v.sheetInstances.length; k++) {
            const inst = v.sheetInstances[k];
            if (inst.tex && !inst.tex.image) {
              inst.tex.image = v.sheetBaseTex.image;
              inst.tex.needsUpdate = true;
            }
          }
        } else if (v.sheetTex && !v.sheetTex.image) {
          v.sheetTex.image = v.sheetBaseTex.image;
          v.sheetTex.needsUpdate = true;
        }
      }

      if (v.sheetInstances && v.sheetInstances.length > 0) {
        for (let k = 0; k < v.sheetInstances.length; k++) {
          const inst = v.sheetInstances[k];
          const t = v.sheetT + inst.timeOffset;
          const f = Math.floor(t * baseFps) % d.frames;
          const _offI = sheetFrameOffset(d, f);
          inst.tex.offset.set(_offI.x, _offI.y);
          const flicker = inst.isAdditive
            ? (0.82 + 0.18 * Math.sin(t * 7.5 + inst.timeOffset))
            : (0.92 + 0.08 * Math.sin(t * 3.5 + inst.timeOffset));
          inst.mat.opacity = (inst.baseOp || v.sheetBaseOp) * (inst.isAdditive ? (0.8 + 0.2 * Math.sin(v.t * 2.5)) : 1.0) * flicker;
          if (inst.mesh && inst.baseScale) {
            const sp = 1 + 0.04 * Math.sin(t * 5.0 + inst.timeOffset);
            inst.mesh.scale.set(inst.baseScale * sp, inst.baseScale * sp, 1);
          }
        }
      } else if (v.sheetMat && v.sheetTex) {
        const f = Math.floor(v.sheetT * (d.fps * 0.7)) % d.frames;
        const _offV = sheetFrameOffset(d, f);
        v.sheetTex.offset.set(_offV.x, _offV.y);
        v.sheetMat.opacity = v.sheetBaseOp * (0.7 + 0.3 * Math.sin(v.t * 2.5));
        if (v.sheetMesh && v.sheetBaseScale) {
          const sp = 1 + 0.05 * Math.sin(v.t * 2.0);
          v.sheetMesh.scale.set(v.sheetBaseScale * sp, v.sheetBaseScale * sp, 1);
        }
      }
    }

    // Persistent sparkle cube (Faerie Fire) — rotating wireframe + rising sparkles.
    if (v.sparkleFx) {
      const sf = v.sparkleFx;
      if (sf.fxGroup) sf.fxGroup.rotation.y += dt * 0.5;
      if (sf.wireMat) sf.wireMat.opacity = (0.12 + 0.07 * Math.sin(v.t * 2.2)) * (0.75 + 0.25 * pulse);
      for (const s of (sf.sparks || [])) {
        const k = (v.t * s.speed + s.phase) % 1;
        s.mesh.position.x = s.base.x + Math.sin(v.t * 1.5 + s.phase) * 0.12;
        s.mesh.position.z = s.base.z + Math.cos(v.t * 1.4 + s.phase) * 0.12;
        s.mesh.position.y = s.base.y + k * s.rise;
        const fade = Math.sin(k * Math.PI);
        s.mat.opacity = 0.55 * fade;
        const sc = 0.05 + 0.11 * fade;
        s.mesh.scale.set(sc, sc, 1);
      }
    }

    // Persistent vines (Entangle) — gentle sway in place.
    if (v.vineFx) {
      for (const vn of v.vineFx.vines) {
        vn.mesh.rotation.y = Math.sin(v.t * 2.2 + vn.seed) * 0.25;
        vn.mesh.scale.y = 0.96 + 0.04 * Math.sin(v.t * 1.8 + vn.seed);
        vn.mat.opacity = 0.70 + 0.18 * Math.sin(v.t * 2.6 + vn.seed);
      }
    }

    if (v.dur != null && v.t >= v.dur) {
      removeAoEVisual(scene, v);
    }
  }
}

/* -------- room-search indicator (canvas ring on the floor) -------- */

export function createSearchIndicator(parent, worldX, worldZ) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const geom = new THREE.PlaneGeometry(2.0, 2.0).rotateX(-Math.PI / 2).translate(0, 0.08, 0);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(worldX, 0, worldZ);
  mesh.renderOrder = 40;
  parent.add(mesh);

  const ctx = cv.getContext('2d');
  return { mesh, cv, ctx, tex };
}

export function updateSearchIndicator(ind, frac) {
  const { ctx, cv, tex } = ind;
  const cx = 64, cy = 64, R = 48, lw = 6;
  ctx.clearRect(0, 0, cv.width, cv.height);

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.lineWidth = lw;
  ctx.strokeStyle = 'rgba(30, 25, 20, 0.55)';
  ctx.stroke();

  if (frac > 0) {
    ctx.beginPath();
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (Math.PI * 2 * Math.max(0, Math.min(1, frac)));
    ctx.arc(cx, cy, R, startAngle, endAngle);
    ctx.lineWidth = lw;
    ctx.strokeStyle = '#b08d3c';
    ctx.stroke();
  }

  const gx = cx, gy = cy;
  const lensR = 14;
  ctx.beginPath();
  ctx.arc(gx, gy, lensR, 0, Math.PI * 2);
  ctx.strokeStyle = '#8a7c60';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const a45 = Math.PI / 4;
  const sx = gx + lensR * Math.cos(a45);
  const sy = gy + lensR * Math.sin(a45);
  const ex = gx + (lensR + 11) * Math.cos(a45);
  const ey = gy + (lensR + 11) * Math.sin(a45);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = '#8a7c60';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  tex.needsUpdate = true;
}

export function disposeSearchIndicator(ind) {
  if (!ind) return;
  if (ind.mesh.parent) ind.mesh.parent.remove(ind.mesh);
  ind.mesh.geometry.dispose();
  ind.mesh.material.map.dispose();
  ind.mesh.material.dispose();
}

/* ---------------- floor-exit marker (story missions) ----------------
   Non-final story floors have no boss: the way onward is a marked tile in
   the deepest room that only opens once the floor has been fully swept.
   Dormant it reads as a closed ring; active it pulses and beckons. */
export function createExitIndicator(parent, worldX, worldZ) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;

  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide
  });
  const geom = new THREE.PlaneGeometry(3.2, 3.2).rotateX(-Math.PI / 2).translate(0, 0.06, 0);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(worldX, 0, worldZ);
  mesh.renderOrder = 39;
  parent.add(mesh);

  return { mesh, cv, ctx: cv.getContext('2d'), tex, _t: 0 };
}

/** frac = sweep progress 0..1; active = floor done, exit is open. */
export function updateExitIndicator(ind, frac, active, time) {
  const { ctx, cv, tex } = ind;
  const cx = 128, cy = 128, R = 96;
  ctx.clearRect(0, 0, cv.width, cv.height);

  const pulse = active ? 0.55 + 0.45 * Math.sin((time || 0) * 3.0) : 1;

  /* outer ring — dim while sealed, bright and breathing once open */
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.lineWidth = 10;
  ctx.strokeStyle = active
    ? `rgba(122, 214, 255, ${0.35 + 0.4 * pulse})`
    : 'rgba(70, 80, 90, 0.40)';
  ctx.stroke();

  /* progress arc while the floor is still being swept */
  if (!active && frac > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, frac));
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#7ad6ff';
    ctx.stroke();
  }

  /* chevrons pointing down/onward */
  const arms = 3;
  for (let i = 0; i < arms; i++) {
    const y = cy - 34 + i * 30;
    const s = 30 - i * 4;
    ctx.beginPath();
    ctx.moveTo(cx - s, y);
    ctx.lineTo(cx, y + s * 0.7);
    ctx.lineTo(cx + s, y);
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = active
      ? `rgba(190, 240, 255, ${0.45 + 0.5 * pulse})`
      : 'rgba(90, 100, 110, 0.45)';
    ctx.stroke();
  }

  tex.needsUpdate = true;

  if (active && (!ind.mesh || ind.mesh.visible)) {
    if (!ind._nixieInst && ind.mesh) {
      ind._nixieInst = playNixieEffect('portal_vortex', ind.mesh.position, { scale: 0.9, duration: null });
    }
  } else if (ind._nixieInst) {
    stopNixieEffect(ind._nixieInst);
    ind._nixieInst = null;
  }
}

export function disposeExitIndicator(ind) {
  if (!ind) return;
  if (ind._nixieInst) {
    stopNixieEffect(ind._nixieInst);
    ind._nixieInst = null;
  }
  if (ind.mesh.parent) ind.mesh.parent.remove(ind.mesh);
  ind.mesh.geometry.dispose();
  ind.mesh.material.map.dispose();
  ind.mesh.material.dispose();
}

/** Continuous dynamic status auras for entities (poison, bless, rage, haste). */
export function updateEntityStatusAuras(entities = [], dt = 0.016) {
  /* A live pixelfx effect for as long as each status lasts (render/status_auras.js).
     It replaced the old Nixie pulses for poisoned / blessed / raging / hasted. */
  syncStatusAuras(entities || []);
}

/** Drop all live effects (called when a level unloads or on combat reset). */
export function clearEffects(scene){
  if (!scene) return;
  clearLivePixelFx();
  for(const p of projectiles){ scene.remove(p.mesh); if(p.mat) p.mat.dispose(); if(p.glowMat) p.glowMat.dispose(); if(p.tex) p.tex.dispose(); }
  for(const s of slashes){ scene.remove(s.m); if(s.mat) s.mat.dispose(); }
  for(const e of spriteEffects){ scene.remove(e.mesh); if(e.mat) e.mat.dispose(); }
  for(const e of sheetEffects){ scene.remove(e.mesh); if(e.mat) e.mat.dispose(); if(e.tex) e.tex.dispose(); if(e.geo) e.geo.dispose(); }
  for(const b of activeBeams){ scene.remove(b.group); if(b.glowMat) b.glowMat.dispose(); if(b.coreMat) b.coreMat.dispose(); if(b.glowTex) b.glowTex.dispose(); if(b.coreTex) b.coreTex.dispose(); if(b.light) releasePooledLight(scene, b.light); if(b.extraGeos) for(const g of b.extraGeos) g.dispose(); }
  for(const p of fountainPool){ scene.remove(p.spr); if(p.spr.material) p.spr.material.dispose(); }
  for(const t of telegraphPool){ scene.remove(t.mesh); if(t.mat) t.mat.dispose(); if(t.geom) t.geom.dispose(); }
  for(let i = activeAoEVisuals.length - 1; i >= 0; i--){
    removeAoEVisual(scene, activeAoEVisuals[i]);
  }
  projectiles.length = 0; slashes.length = 0; spriteEffects.length = 0; sheetEffects.length = 0; activeBeams.length = 0;
  fountainPool.length = 0; telegraphPool.length = 0; activeAoEVisuals.length = 0;
  for (const p of evaporateParticlePool) {
    if (scene && p.spr) scene.remove(p.spr);
    if (p.mat) p.mat.dispose();
  }
  evaporateParticlePool.length = 0;
  clearPixelVfx(scene);
  /* Every effect is gone, so every pooled light must be idle again — and the
     pool must exist before the first spell of the new level so its lights
     are already counted in the compiled shaders. */
  for (const fl of activeFlashLights) releasePooledLight(scene, fl.light);
  activeFlashLights.length = 0;
  ensureFlashLightPool(scene);
}

/** Check if any combat animations (e.g. in-flight projectiles) are currently traveling. */
export function hasActiveFX() {
  return projectiles.length > 0;
}

/* ================= monster death evaporate animation ================= */

export function beginSpriteEvaporate(material) {
  if (!material) return;
  material.transparent = true;
  if (material.color) material.color.setRGB(1, 1, 1);
  if (!material.userData) material.userData = {};
  material.userData._dissolve = 0.0;
  material.userData._evaporateTime = 0.0;
  material.alphaTest = 0;

  if (!material.userData._evaporateHooked) {
    material.userData._evaporateHooked = true;
    const prevKey = material.customProgramCacheKey;
    material.customProgramCacheKey = () => {
      const base = typeof prevKey === 'function' ? prevKey.call(material) : (prevKey || 'sprite');
      return base + '_evaporate';
    };

    const prevCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      if (typeof prevCompile === 'function') prevCompile(shader, renderer);
      material.userData.shader = shader;
      shader.uniforms.uDissolve = { value: material.userData._dissolve || 0.0 };
      shader.uniforms.uEvaporateTime = { value: material.userData._evaporateTime || 0.0 };
      shader.uniforms.uFrameBounds = { value: material.userData._uFrameBounds || new THREE.Vector4(0, 0, 1, 1) };

      shader.fragmentShader = `
        uniform float uDissolve;
        uniform float uEvaporateTime;
        uniform vec4 uFrameBounds;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (uDissolve > 0.0) {
          float vSpan = max(0.0001, uFrameBounds.w - uFrameBounds.y);
          float vNorm = clamp((vMapUv.y - uFrameBounds.y) / vSpan, 0.0, 1.0);
          float dissolveEdge = 1.0 - uDissolve;
          float jitter = sin(vMapUv.x * 60.0 + uEvaporateTime * 15.0) * 0.035;
          if (vNorm > (dissolveEdge + jitter)) {
            discard;
          }
        }
        `
      );
    };
    material.needsUpdate = true;
  }
}

export function setSpriteEvaporate(material, dissolve = 0, time = 0) {
  if (!material) return { vMin: 0, vMax: 1, uMin: 0, uMax: 1 };
  const map = material.map;
  const offX = map?.offset?.x ?? 0;
  const offY = map?.offset?.y ?? 0;
  const repX = map?.repeat?.x ?? 1;
  const repY = map?.repeat?.y ?? 1;

  const uMin = Math.min(offX, offX + repX);
  const uMax = Math.max(offX, offX + repX);
  const vMin = Math.min(offY, offY + repY);
  const vMax = Math.max(offY, offY + repY);

  if (material.userData) {
    material.userData._dissolve = dissolve;
    material.userData._evaporateTime = time;
    if (!material.userData._uFrameBounds) {
      material.userData._uFrameBounds = new THREE.Vector4(uMin, vMin, uMax, vMax);
    } else {
      material.userData._uFrameBounds.set(uMin, vMin, uMax, vMax);
    }
    const shader = material.userData.shader;
    if (shader && shader.uniforms) {
      if (shader.uniforms.uDissolve) shader.uniforms.uDissolve.value = dissolve;
      if (shader.uniforms.uEvaporateTime) shader.uniforms.uEvaporateTime.value = time;
      if (shader.uniforms.uFrameBounds) shader.uniforms.uFrameBounds.value.set(uMin, vMin, uMax, vMax);
    }
  }
  return { vMin, vMax, uMin, uMax };
}

export function sampleDissolvingPixels(mesh, dissolve = 0, count = 16) {
  if (!mesh) return [];
  const mat = mesh.material;
  const map = mat?.map;
  if (!map) return [];

  const userData = map.userData || {};
  let pixelData = userData._pixelData;
  let W = userData._pixelW || map.image?.naturalWidth || map.image?.width || 0;
  let H = userData._pixelH || map.image?.naturalHeight || map.image?.height || 0;

  if (!pixelData && map.image && typeof document !== 'undefined') {
    try {
      if (typeof HTMLCanvasElement !== 'undefined' && map.image instanceof HTMLCanvasElement) {
        const ctx = map.image.getContext('2d');
        if (ctx) pixelData = ctx.getImageData(0, 0, W, H).data;
      } else if (map.image.getContext && typeof map.image.getContext === 'function') {
        const ctx = map.image.getContext('2d');
        if (ctx) pixelData = ctx.getImageData(0, 0, W, H).data;
      } else {
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        ctx.drawImage(map.image, 0, 0);
        pixelData = ctx.getImageData(0, 0, W, H).data;
      }
      if (pixelData) {
        if (!map.userData) map.userData = {};
        map.userData._pixelData = pixelData;
        map.userData._pixelW = W;
        map.userData._pixelH = H;
      }
    } catch (e) {}
  }

  if (!pixelData || W <= 0 || H <= 0) return [];

  const offX = map.offset?.x || 0;
  const offY = map.offset?.y || 0;
  const repX = map.repeat?.x || 1;
  const repY = map.repeat?.y || 1;

  const xMin = Math.min(offX, offX + repX);
  const xMax = Math.max(offX, offX + repX);
  const x0 = Math.max(0, Math.floor(xMin * W));
  const x1 = Math.min(W, Math.ceil(xMax * W));

  let y0 = 0;
  let y1 = H;
  if (repY !== 1 || offY !== 0) {
    const vMin = Math.min(offY, offY + repY);
    const vMax = Math.max(offY, offY + repY);
    y0 = Math.max(0, Math.floor((1.0 - vMax) * H));
    y1 = Math.min(H, Math.ceil((1.0 - vMin) * H));
  }
  const frameH = Math.max(1, y1 - y0);

  const targetRow = y0 + Math.floor(Math.max(0, Math.min(0.999, dissolve)) * frameH);

  let bestRow = -1;
  for (let dy = 0; dy <= frameH; dy++) {
    const candidates = dy === 0 ? [targetRow] : [targetRow + dy, targetRow - dy];
    for (const r of candidates) {
      if (r >= y0 && r < y1) {
        let hasOpaque = false;
        for (let c = x0; c < x1; c++) {
          if (pixelData[(r * W + c) * 4 + 3] > 20) {
            hasOpaque = true;
            break;
          }
        }
        if (hasOpaque) {
          bestRow = r;
          break;
        }
      }
    }
    if (bestRow !== -1) break;
  }

  if (bestRow === -1) return [];

  const rowPixels = [];
  const colSpan = Math.max(1, x1 - x0);
  for (const r of [bestRow, bestRow + 1, bestRow - 1]) {
    if (r >= y0 && r < y1) {
      for (let c = x0; c < x1; c++) {
        const idx = (r * W + c) * 4;
        const a = pixelData[idx + 3];
        if (a > 20) {
          const normX = repX < 0
            ? 0.5 - (c - x0) / colSpan
            : (c - x0) / colSpan - 0.5;
          rowPixels.push({
            r: pixelData[idx],
            g: pixelData[idx + 1],
            b: pixelData[idx + 2],
            a: a,
            x: c,
            y: r,
            normX
          });
        }
      }
    }
  }

  if (rowPixels.length === 0) return [];

  const result = [];
  for (let i = 0; i < count; i++) {
    const pickIdx = Math.floor(Math.random() * rowPixels.length);
    result.push(rowPixels[pickIdx]);
  }
  return result;
}

const evaporateParticlePool = [];
let _pixelParticleTex = null;

function getPixelParticleTexture() {
  if (!_pixelParticleTex && typeof document !== 'undefined') {
    try {
      const cv = document.createElement('canvas');
      cv.width = 4;
      cv.height = 4;
      const ctx = cv.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 4, 4);
      }
      _pixelParticleTex = new THREE.CanvasTexture(cv);
      _pixelParticleTex.magFilter = THREE.NearestFilter;
      _pixelParticleTex.minFilter = THREE.NearestFilter;
    } catch (e) {
      _pixelParticleTex = null;
    }
  }
  return _pixelParticleTex;
}

function spawnSingleEvaporateParticle(scene, x, y, z, r, g, b) {
  let p = null;
  for (let i = 0; i < evaporateParticlePool.length; i++) {
    if (!evaporateParticlePool[i].active) {
      p = evaporateParticlePool[i];
      break;
    }
  }

  const baseSize = 0.016 + Math.random() * 0.010;

  if (!p) {
    if (evaporateParticlePool.length >= 350) return;
    const tex = getPixelParticleTexture();
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 1.0,
      depthTest: true,
      depthWrite: false
    });
    const spr = new THREE.Sprite(mat);
    spr.renderOrder = 25;
    scene.add(spr);
    p = { spr, mat, active: true, t: 0, dur: 0.65, vx: 0, vy: 0, vz: 0, baseSize, seed: Math.random() * 10 };
    evaporateParticlePool.push(p);
  } else {
    p.active = true;
    p.t = 0;
    p.spr.visible = true;
  }

  p.baseSize = baseSize;
  p.dur = 0.55 + Math.random() * 0.35;
  p.seed = Math.random() * 10;
  p.vx = (Math.random() - 0.5) * 0.16;
  p.vy = 0.48 + Math.random() * 0.38;
  p.vz = (Math.random() - 0.5) * 0.16;

  p.spr.position.set(x, y, z);
  p.spr.scale.set(baseSize, baseSize, 1);
  p.mat.color.setRGB(r / 255, g / 255, b / 255);
  p.mat.opacity = 1.0;
}

export function spawnEvaporatePixels(scene, pos, opts = {}) {
  if (!scene || !pos) return;
  const count = opts.count || 8;
  const mesh = opts.mesh;
  const dissolve = opts.dissolve ?? 0;
  const spriteWidth = opts.spriteWidth || 0.8;
  const camAngle = opts.camAngle ?? (Math.PI / 4);
  const rightX = Math.cos(camAngle);
  const rightZ = -Math.sin(camAngle);

  const sampled = (mesh && typeof sampleDissolvingPixels === 'function')
    ? sampleDissolvingPixels(mesh, dissolve, count)
    : [];

  for (let i = 0; i < count; i++) {
    const px = sampled.length > 0 ? sampled[i % sampled.length] : null;
    let r = 255, g = 204, b = 170;
    let normX = (Math.random() - 0.5) * 0.7;

    if (px) {
      r = px.r;
      g = px.g;
      b = px.b;
      if (px.normX !== undefined) {
        normX = px.normX + (Math.random() - 0.5) * 0.04;
      }
    } else if (opts.color) {
      r = (opts.color >> 16) & 255;
      g = (opts.color >> 8) & 255;
      b = opts.color & 255;
    }

    // Offset along the camera billboard plane across the actual sprite width
    const spawnX = pos.x + normX * spriteWidth * rightX;
    const spawnZ = pos.z + normX * spriteWidth * rightZ;
    const spawnY = Math.max(0.04, pos.y + (Math.random() - 0.5) * 0.03);

    spawnSingleEvaporateParticle(scene, spawnX, spawnY, spawnZ, r, g, b);
  }
}

export function updateEvaporateParticles(scene, dt) {
  for (let i = 0; i < evaporateParticlePool.length; i++) {
    const p = evaporateParticlePool[i];
    if (!p.active) continue;
    p.t += dt;
    const progress = p.t / p.dur;
    if (progress >= 1.0) {
      p.active = false;
      p.spr.visible = false;
      continue;
    }

    p.spr.position.y += p.vy * dt;
    p.spr.position.x += (p.vx + Math.sin(p.t * 6.0 + p.seed) * 0.06) * dt;
    p.spr.position.z += (p.vz + Math.cos(p.t * 6.0 + p.seed) * 0.06) * dt;
    p.vy = Math.max(0.12, p.vy - dt * 0.15);

    if (progress > 0.35) {
      p.mat.opacity = Math.max(0, 1.0 - (progress - 0.35) / 0.65);
    } else {
      p.mat.opacity = 1.0;
    }

    const s = progress > 0.65 ? p.baseSize * (1.0 - (progress - 0.65) / 0.35 * 0.45) : p.baseSize;
    p.spr.scale.set(s, s, 1);
  }
}

export { spawnPixelVfx, updatePixelVfx, clearPixelVfx, PIXEL_VFX_PRESETS };
