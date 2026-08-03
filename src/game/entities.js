/**
 * Entity visuals — low-poly procedural minis for heroes and monsters,
 * matching the painted-miniature look of the dungeon (no disk assets).
 * Each entity is a THREE.Group with a body and a billboarded HP bar.
 */
import * as THREE from 'three';
import { CLASSES, WILD_SHAPE_FORMS } from './srd.js';
import { HeroSprite, WolfSprite, BeastSprite } from './sprite_animator.js';
import { GIGAPACK_REGISTRY } from './gigapack_registry.js';
import { isIdentityColorBalance, loadBalancedCanvas } from './color_balance.js';

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
  
  const geom = new THREE.PlaneGeometry(0.7, 0.7).rotateX(-Math.PI / 2).translate(0, 0.02, 0);
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
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.8, 0.45, 1);
  spr.position.set(0, 1.6, 0); // Positioned above entity head
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
    hexMarked: '🔮',
    huntersMarked: '🎯',
    bloodlust: '🩸',
    patientDefense: '🛡️'
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

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
  });

  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.65, 1.85, 1.0);
  spr.position.set(0, 0.70, -0.15); // Directly behind the entity sprite billboard
  spr.renderOrder = 0; // Drawn BEFORE entity sprite
  spr.visible = false;

  return { group: spr, spr, mat };
}

/* -------- hero mini: 2D animated LPC sprite -------- */
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

  const bar = makeCircularBar(color);
  drawBar(bar, 1);
  grp.add(bar.spr);

  const statusTray = makeStatusTray();
  grp.add(statusTray.spr);

  const turnHighlight = makeTurnHighlight(true);
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
  
  /* Fit the billboard to the sprite's real pixel size (DCSS sheets are not all 32px). */
  const fitToImage = (imgW, imgH) => {
    const basePx = 32.0;
    mesh.scale.set(
      ((imgW || 32) / basePx) * 1.5 * s,
      ((imgH || 32) / basePx) * 1.5 * s,
      1
    );
  };

  /* The bestiary's colour-balance edits live on the monsters.json record. Baking
     them here is what makes the editor's tint show up in the actual dungeon;
     without a balance we keep the cheaper straight-to-GPU texture load. */
  const cb = mon.colorBalance;
  let tex;
  if (isIdentityColorBalance(cb)) {
    tex = new THREE.TextureLoader().load(spritePath, (t) => {
      if (t && t.image) {
        fitToImage(t.image.naturalWidth || t.image.width, t.image.naturalHeight || t.image.height);
      }
    });
  } else {
    tex = new THREE.Texture();
    loadBalancedCanvas(spritePath, cb, (canvas) => {
      tex.image = canvas;
      tex.needsUpdate = true;
      fitToImage(canvas.width, canvas.height);
    });
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    alphaTest: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
  const mesh = new THREE.Sprite(mat);
  mesh.renderOrder = 10;
  mesh.center.set(0.5, 0);
  mesh.scale.set(1.5 * s, 1.5 * s, 1);
  mesh.position.y = (mon.yOffset || 0) * 0.02;
  grp.add(mesh);

  const bar = makeCircularBar('#e0483a');
  drawBar(bar, 1);
  grp.add(bar.spr);

  const statusTray = makeStatusTray();
  grp.add(statusTray.spr);

  const turnHighlight = makeTurnHighlight(false);
  grp.add(turnHighlight.group);
  
  const anim = {
    mesh,
    time: 0,
    play: () => {},
    update: (dt) => {
      anim.time += dt;
    },
    setDirection: (dx, dz) => {
      if (dx > 0.1) {
        tex.repeat.x = -1;
        tex.offset.x = 1;
      } else if (dx < -0.1) {
        tex.repeat.x = 1;
        tex.offset.x = 0;
      }
    }
  };
  
  return { grp, bar, anim, statusTray };
}

/* -------- floating damage/heal/status text -------- */
const puffPool = [];
const recentFloatPositions = [];

function pushActivePuffsUp(pos, minSepY = 0.45) {
  if (!pos) return;
  const targetX = pos.x;
  const targetZ = pos.z;
  const targetY = pos.y;

  for (const p of puffPool) {
    if (!p || !p.spr || !p.spr.position) continue;
    const dx = p.spr.position.x - targetX;
    const dz = p.spr.position.z - targetZ;
    if (Math.hypot(dx, dz) < 1.5) {
      if (p.spr.position.y >= targetY - 0.25) {
        p.spr.position.y += minSepY;
      }
    }
  }
}

export function makeFloatText(scene, text, pos, color, isCrit = false) {
  if (!text) return;
  const str = String(text);

  /* 1. Dynamic Vertical Stacking Offset */
  const spawnPosY = pos.y + 0.2;
  pushActivePuffsUp(new THREE.Vector3(pos.x, spawnPosY, pos.z), 0.42);

  const now = performance.now();
  for (let i = recentFloatPositions.length - 1; i >= 0; i--) {
    if (now - recentFloatPositions[i].time > 600) recentFloatPositions.splice(i, 1);
  }

  let stackOffset = 0;
  let horizJitter = (Math.random() - 0.5) * 0.15;
  for (const item of recentFloatPositions) {
    const dist = Math.hypot(item.x - pos.x, item.z - pos.z);
    if (dist < 0.6) {
      stackOffset += 0.38;
    }
  }
  recentFloatPositions.push({ x: pos.x, z: pos.z, time: now });

  /* 2. Dynamic High-DPI Canvas Sizing (prevents word clipping) */
  const fontSize = isCrit ? 36 : 30;
  const font = `bold ${fontSize}px 'Outfit', 'Inter', 'Verdana', sans-serif`;

  const measureCv = document.createElement('canvas');
  const measureCtx = measureCv.getContext('2d');
  measureCtx.font = font;
  const textWidth = measureCtx.measureText(str).width;

  const padX = 40;
  const padY = 20;
  const cvW = Math.max(160, Math.ceil(textWidth + padX * 2));
  const cvH = Math.ceil(fontSize + padY * 2);

  const cv = document.createElement('canvas');
  cv.width = cvW;
  cv.height = cvH;
  const g = cv.getContext('2d');
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  const centerX = cvW / 2;
  const centerY = cvH / 2;

  g.lineWidth = isCrit ? 7 : 5;
  g.strokeStyle = 'rgba(0, 0, 0, 0.95)';
  g.lineJoin = 'round';
  g.strokeText(str, centerX, centerY);

  g.fillStyle = color || '#ffffff';
  g.fillText(str, centerX, centerY);

  if (isCrit) {
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255, 215, 0, 0.8)';
    g.strokeText(str, centerX, centerY);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;

  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);

  const worldHeight = isCrit ? 0.65 : 0.55;
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

  const finalPos = new THREE.Vector3(pos.x + horizJitter, pos.y + stackOffset, pos.z);
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

/* -------- Floating Gold & Gear Loot Feedback Above Party Leader -------- */
export function makeLootFloatText(scene, pos, type = 'gold', data = null) {
  if (!scene || !pos) return;

  /* Push existing active float indicators up to form a clean vertical stack */
  const spawnPosY = pos.y + 0.3;
  pushActivePuffsUp(new THREE.Vector3(pos.x, spawnPosY, pos.z), 0.48);

  const now = performance.now();
  for (let i = recentFloatPositions.length - 1; i >= 0; i--) {
    if (now - recentFloatPositions[i].time > 800) recentFloatPositions.splice(i, 1);
  }

  let stackOffset = 0.2;
  for (const item of recentFloatPositions) {
    const dist = Math.hypot(item.x - pos.x, item.z - pos.z);
    if (dist < 0.8) {
      stackOffset += 0.42;
    }
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

  const measureCv = document.createElement('canvas');
  const measureCtx = measureCv.getContext('2d');
  measureCtx.font = font;
  const iconWidth = measureCtx.measureText(icon + ' ').width;
  const textWidth = measureCtx.measureText(text).width;
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
  g.fillStyle = 'rgba(12, 16, 24, 0.85)';
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

  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);

  const worldHeight = 0.62;
  const aspect = cvW / cvH;
  const worldWidth = worldHeight * aspect;
  spr.scale.set(worldWidth * 1.2, worldHeight * 1.2, 1);

  const finalPos = new THREE.Vector3(pos.x, pos.y + 0.3, pos.z);
  spr.position.copy(finalPos);
  spr.renderOrder = 80;
  scene.add(spr);

  puffPool.push({
    spr,
    mat,
    tex,
    t: 0,
    dur: 1.4,
    baseScaleW: worldWidth * 1.2,
    baseScaleH: worldHeight * 1.2,
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

    if (p.t < 0.1) {
      const pop = 1 + Math.sin((p.t / 0.1) * Math.PI) * 0.25;
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

/* -------- Ground telegraph rings (monster ability warnings) -------- */
const telegraphPool = [];
export function spawnTelegraph(scene, pos, radius = 2.0, color = 0xe04040, duration = 0.8) {
  const geom = new THREE.RingGeometry(0.15, radius, 32);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthTest: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(pos.x, 0.06, pos.z);
  mesh.renderOrder = 50;
  scene.add(mesh);
  telegraphPool.push({ mesh, mat, geom, t: 0, duration, startScale: 0.3 });
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

/* flash a mesh red/white on hit */
export function hitFlash(ent){
  if (ent.anim) {
    if (!ent.anim._dying) {
      ent.anim.play('hurt', true);
    }
    ent.anim.mesh.material.color.set(0xff6050);
  } else if (ent.bodyMat) {
    ent.bodyMat.emissive = ent.bodyMat.emissive || new THREE.Color();
    ent.bodyMat.emissive.set(0xff6050);
  }
  ent.flashT = 0.15;
}
export function updateFlash(ent, dt){
  if(ent.flashT !== undefined && ent.flashT > 0){
    ent.flashT -= dt;
    if(ent.flashT <= 0) {
      if (ent.anim) {
        // Return to standard color if it's a hero, or monster color
        ent.anim.mesh.material.color.set(0xffffff); // Default tint
      } else if (ent.bodyMat) {
        ent.bodyMat.emissive.set(0x000000);
      }
    }
  }
}

/* -------- Elemental impact particle bursts -------- */
const impactPool = [];
export function spawnImpactBurst(scene, pos, type = 'fire', color = null, count = 16) {
  if (!scene || !pos) return;
  const num = count || 16;
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 16;
  const g = cv.getContext('2d');
  const baseCol = color || (type==='fire' ? '#ff7a20' : type==='frost' ? '#7fd4ff' : type==='lightning' ? '#b080ff' : type==='poison' ? '#59d68f' : type==='holy' ? '#ffe066' : type==='dark' ? '#9f50e6' : '#ffffff');
  g.fillStyle = baseCol;
  g.beginPath(); g.arc(8, 8, 5, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;

  for (let i = 0; i < num; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, blending: THREE.AdditiveBlending });
    const spr = new THREE.Sprite(mat);
    const sz = 0.15 + Math.random() * 0.25;
    spr.scale.set(sz, sz, 1);
    spr.position.set(pos.x + (Math.random() - 0.5) * 0.2, (pos.y || 0.4) + (Math.random() - 0.5) * 0.2, pos.z + (Math.random() - 0.5) * 0.2);
    spr.renderOrder = 70;
    scene.add(spr);

    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 2.2;
    const upBias = type === 'fire' ? 1.5 : (type === 'holy' ? 1.0 : 0.4);
    impactPool.push({
      spr, mat, tex,
      vx: Math.cos(angle) * speed,
      vy: (Math.random() - 0.2) * speed + upBias,
      vz: Math.sin(angle) * speed,
      t: 0,
      dur: 0.3 + Math.random() * 0.4,
      type
    });
  }
}
function updateImpactBursts(scene, dt) {
  for (let i = impactPool.length - 1; i >= 0; i--) {
    const p = impactPool[i];
    p.t += dt;
    const k = p.t / p.dur;
    p.spr.position.x += p.vx * dt;
    p.spr.position.y += p.vy * dt;
    p.spr.position.z += p.vz * dt;
    p.mat.opacity = Math.max(0, 1 - k);
    if (p.t >= p.dur) {
      scene.remove(p.spr);
      p.tex.dispose();
      p.mat.dispose();
      impactPool.splice(i, 1);
    }
  }
}

/** Tick pooled world FX (death fountains, boss telegraphs, impact bursts). Called from the
 *  game update loop with the live scene. */
export function updateWorldFx(scene, dt){
  updateDeathFountains(scene, dt);
  updateTelegraphs(scene, dt);
  updateImpactBursts(scene, dt);
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

/** Spawns a flat, persistent visual ring + inner circle indicator on the ground. */
export function spawnAoEVisual(scene, pos, color, size, duration = null, options = null) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  mat.toneMapped = false;

  const group = new THREE.Group();
  group.position.set(pos.x, 0.33, pos.z);

  // Faint inner ground circle
  const innerMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  innerMat.toneMapped = false;
  const innerGeom = new THREE.CircleGeometry(size, 32).rotateX(-Math.PI/2);
  const innerMesh = new THREE.Mesh(innerGeom, innerMat);
  group.add(innerMesh);

  // Outer border ring
  const borderMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  borderMat.toneMapped = false;
  const borderGeom = new THREE.RingGeometry(size - 0.05, size + 0.05, 32).rotateX(-Math.PI/2);
  const borderMesh = new THREE.Mesh(borderGeom, borderMat);
  group.add(borderMesh);

  // Optional 3D vertical cylinder beam (e.g. Moonbeam)
  let cylMat = null, coreMat = null, glowTex = null, coreTex = null;
  if (options && options.cylinderBeam) {
    const beamHeight = options.beamHeight || 12.0;
    const beamRadius = size;
    const colorHex = options.beamColor || color;

    glowTex = getBeamTexture().clone();
    glowTex.repeat.set(1, 4);

    cylMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color: colorHex,
      transparent: true,
      opacity: 0.40,
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
      opacity: 0.45,
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

  scene.add(group);

  const visual = {
    group,
    mat,
    innerMat,
    borderMat,
    cylMat,
    coreMat,
    glowTex,
    coreTex,
    t: 0,
    dur: duration,
    size,
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
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.3, 'rgba(255, 255, 255, 0.6)');
    grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.15)');
    grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    _radialGlowTex = new THREE.CanvasTexture(cv);
    _radialGlowTex.colorSpace = THREE.SRGBColorSpace;
  }
  return _radialGlowTex;
}

const CANTRIP_PROJ_SHEETS = {
  wizard: 'stylized_explosion_001_large_yellow',
  sorcerer: 'epic_explosion_001_large_orange',
  cleric: 'round_light_burst_001_large_yellow',
  druid: 'round_sparkle_burst_002_large_green',
  warlock: 'round_sparkle_burst_003_large_red',
  bard: 'directional_music_burst_002_large_yellow',
  artificer: 'round_sparkle_burst_001_large_blue',
};

/** Fire a projectile from `from` to `to`; calls onHit() when it lands. */
export function spawnProjectile(scene, from, to, kind, color, onHit, opts = {}){
  if (kind === 'arrow') {
    const geo = _projGeo.arrow;
    const mat = new THREE.MeshBasicMaterial({ color }); mat.toneMapped = false;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    mesh.lookAt(to);
    scene.add(mesh);
    const dur = Math.max(0.08, from.distanceTo(to)/16);
    projectiles.push({ mesh, mat, glowMat: null, from: from.clone(), to: to.clone(), t: 0, dur, onHit, kind });
    return;
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
    let base = _projTexCache[sheetDef.url];
    if (!base) {
      base = _projTexLoader.load(sheetDef.url);
      base.colorSpace = THREE.SRGBColorSpace;
      base.magFilter = THREE.NearestFilter;
      base.minFilter = THREE.NearestFilter;
      _projTexCache[sheetDef.url] = base;
    }
    tex = base.clone();
    tex.needsUpdate = true;
    tex.repeat.set(1 / sheetDef.cols, 1 / sheetDef.rows);

    mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    mesh = new THREE.Sprite(mat);
    mesh.scale.set(scale, scale, 1);
    mesh.position.copy(from);

    // Radiant additive glowing halo for spell projectile
    glowMat = new THREE.SpriteMaterial({
      map: getRadialGlowTexture(),
      color: color || 0xffd34a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
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

    glowMat = new THREE.SpriteMaterial({ map: getRadialGlowTexture(), color: color || 0xb08cff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    glowMat.toneMapped = false;
    glowMesh = new THREE.Sprite(glowMat);
    glowMesh.scale.set(scale * 1.2, scale * 1.2, 1);
    mesh.add(glowMesh);
  }

  scene.add(mesh);
  const dur = Math.max(0.20, from.distanceTo(to) / 10.5);
  const curve = opts.curve || null;
  projectiles.push({ mesh, mat, glowMat, glowMesh, tex, sheetDef, scale, curve, from: from.clone(), to: to.clone(), t: 0, dur, onHit, kind });
}

/** A quick expanding impact ring (melee slash / spell burst). */
export function spawnSlash(scene, pos, color, size=1){
  const mat = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.85, depthWrite:false, side:THREE.DoubleSide });
  mat.toneMapped = false;
  const m = new THREE.Mesh(_ringGeo, mat);
  m.position.set(pos.x, 0.32, pos.z);
  m.scale.setScalar(size*0.5);
  scene.add(m);
  slashes.push({ m, mat, t:0, dur:0.28, size });
}

const _spriteTexCache = new Map();
const _sharedTexLoader = new THREE.TextureLoader();

export function getOrLoadSpriteTexture(path) {
  if (!path) return null;
  const p = path.startsWith('dcss/') || path.startsWith('./') || path.startsWith('art/')
    ? path
    : (path.includes('/') ? path : `dcss/effect/${path}`);
  let t = _spriteTexCache.get(p);
  if (!t) {
    t = _sharedTexLoader.load(p);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    _spriteTexCache.set(p, t);
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

export function preloadAllSpellAndCombatVFX() {
  const paths = [
    // Slash & Impact VFX
    'dcss/effect/kny_slash_0.png', 'dcss/effect/kny_slash_1.png', 'dcss/effect/kny_slash_2.png', 'dcss/effect/kny_slash_3.png',
    'dcss/effect/kny_light_0.png', 'dcss/effect/kny_light_1.png',
    'dcss/effect/kny_dust_0.png', 'dcss/effect/kny_dust_1.png',
    'dcss/effect/kny_spark_0.png', 'dcss/effect/kny_spark_1.png', 'dcss/effect/kny_spark_2.png', 'dcss/effect/kny_spark_3.png',
    'dcss/effect/kny_star_0.png', 'dcss/effect/kny_star_1.png', 'dcss/effect/kny_star_2.png', 'dcss/effect/kny_star_3.png', 'dcss/effect/kny_star_4.png',
    // Common Spells & Cantrips
    'dcss/effect/flame_0.png', 'dcss/effect/flame_1.png', 'dcss/effect/flame_2.png',
    'dcss/effect/magic_bolt_1.png', 'dcss/effect/arrow_4.png',
    'dcss/effect/searing_ray_0.png', 'dcss/effect/searing_ray_1.png', 'dcss/effect/searing_ray_2.png', 'dcss/effect/searing_ray_3.png', 'dcss/effect/searing_ray_5.png',
    'dcss/effect/orb_glow_0.png', 'dcss/effect/orb_glow_1.png', 'dcss/effect/orb_glow_2.png',
    'dcss/effect/cloud_fire_0.png', 'dcss/effect/cloud_fire_1.png', 'dcss/effect/cloud_fire_2.png', 'dcss/effect/cloud_forest_fire.png',
    'dcss/effect/cloud_cold_0.png', 'dcss/effect/cloud_cold_1.png', 'dcss/effect/cloud_cold_2.png', 'dcss/effect/frost_0.png', 'dcss/effect/frost_1.png',
    'dcss/effect/cloud_acid_0.png', 'dcss/effect/cloud_acid_1.png', 'dcss/effect/cloud_poison_0.png', 'dcss/effect/cloud_poison_1.png', 'dcss/effect/acid_venom.png',
    'dcss/effect/zap_0.png', 'dcss/effect/zap_1.png', 'dcss/effect/zap_2.png', 'dcss/effect/zap_3.png',
    'dcss/effect/cloud_neg_0.png', 'dcss/effect/cloud_neg_1.png', 'dcss/effect/cloud_neg_2.png', 'dcss/effect/drain_red_0.png', 'dcss/effect/drain_red_1.png', 'dcss/effect/drain_red_2.png', 'dcss/effect/umbra_0.png', 'dcss/effect/umbra_1.png', 'dcss/effect/umbra_2.png', 'dcss/effect/umbra_3.png',
    'dcss/effect/goldaura_0.png', 'dcss/effect/goldaura_1.png', 'dcss/effect/goldaura_2.png', 'dcss/effect/gold_sparkles_1.png', 'dcss/effect/gold_sparkles_2.png', 'dcss/effect/gold_sparkles_3.png',
    'dcss/effect/cloud_gloom_new.png', 'dcss/effect/quad_glow.png', 'dcss/effect/disjunct_0.png', 'dcss/effect/disjunct_1.png', 'dcss/effect/cloud_chaos_1.png', 'dcss/effect/cloud_chaos_2.png', 'dcss/effect/cloud_chaos_4.png',
    'dcss/effect/sanctuary.png', 'dcss/effect/heataura_1.png', 'dcss/effect/heataura_2.png', 'dcss/effect/xom_sparkles_blue.png', 'dcss/effect/cloud_magic_trail_0.png', 'dcss/effect/cloud_magic_trail_1.png', 'dcss/effect/cloud_magic_trail_2.png', 'dcss/effect/cloud_magic_trail_3.png',
    'dcss/effect/irradiate_0.png', 'dcss/effect/irradiate_1.png', 'dcss/effect/irradiate_2.png', 'dcss/effect/irradiate_3.png', 'dcss/effect/sandblast_0.png'
  ];
  preloadVFX(paths);
}

/* spriteDef: either a texture path string, or { sprite, frames, frameInterval }
   where `frames` is an array of texture paths cycled every `frameInterval`
   seconds for the effect's lifetime (ABILITY_FX animated entries). */
export function spawnSpriteEffect(scene, spriteDef, pos, scale=1.5, dur=0.4){
  const loadTex = p => getOrLoadSpriteTexture(p);
  const isDef = typeof spriteDef === 'object' && spriteDef !== null;
  const framePaths = isDef && Array.isArray(spriteDef.frames) && spriteDef.frames.length > 1
    ? spriteDef.frames : null;
  const frames = framePaths ? framePaths.map(loadTex) : null;
  const tex = frames ? frames[0] : loadTex(isDef ? spriteDef.sprite : spriteDef);

  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Sprite(mat);
  mesh.scale.set(scale, scale, 1);
  mesh.position.copy(pos);
  scene.add(mesh);

  spriteEffects.push({ mesh, mat, tex, frames,
    frameInterval: frames ? (spriteDef.frameInterval || 0.07) : 0, t: 0, dur });
}

/** Animated Pixel Melee Slash Arc & Spark Impact VFX */
export function spawnMeleeHitVFX(scene, targetPos, attackerPos, isCrit = false, dmgType = 'slashing', scale = 1.0) {
  const tX = targetPos.x, tZ = targetPos.z;
  const hitPos = new THREE.Vector3(tX, 0.55, tZ);
  const slashScale = isCrit ? scale * 2.2 : scale * 1.5;
  const dur = isCrit ? 0.28 : 0.22;

  /* 1. Gigapack Pixel Impact Spritesheet */
  let impactKey = 'directional_impact_001_large_blue';
  if (dmgType === 'slashing' || dmgType === 'slashing_magical' || !dmgType) {
    impactKey = isCrit ? 'directional_impact_004_large_yellow' : 'directional_impact_001_large_blue';
  } else if (dmgType === 'piercing' || dmgType === 'piercing_magical') {
    impactKey = isCrit ? 'directional_impact_003_large_violet' : 'directional_impact_002_large_white';
  } else {
    impactKey = isCrit ? 'symmetrical_impact_006_large_yellow' : 'symmetrical_impact_001_large_yellow';
  }

  if (GIGAPACK_REGISTRY[impactKey]) {
    spawnSheetEffect(scene, GIGAPACK_REGISTRY[impactKey], hitPos, slashScale * 1.4, dur);
  }

  /* 2. Animated Pixel Slash Arc */
  if (dmgType === 'slashing' || dmgType === 'slashing_magical' || !dmgType) {
    spawnSpriteEffect(scene, {
      frames: [
        'dcss/effect/kny_slash_0.png',
        'dcss/effect/kny_slash_1.png',
        'dcss/effect/kny_slash_2.png',
        'dcss/effect/kny_slash_3.png'
      ],
      frameInterval: 0.04
    }, hitPos, slashScale, dur);
  } else if (dmgType === 'piercing' || dmgType === 'piercing_magical') {
    spawnSpriteEffect(scene, {
      frames: [
        'dcss/effect/kny_light_0.png',
        'dcss/effect/kny_light_1.png',
        'dcss/effect/kny_spark_0.png',
        'dcss/effect/kny_spark_2.png'
      ],
      frameInterval: 0.04
    }, hitPos, slashScale * 1.2, dur);
  } else {
    spawnSpriteEffect(scene, {
      frames: [
        'dcss/effect/kny_dust_0.png',
        'dcss/effect/kny_dust_1.png',
        'dcss/effect/kny_spark_1.png',
        'dcss/effect/kny_spark_3.png'
      ],
      frameInterval: 0.04
    }, hitPos, slashScale * 1.3, dur);
  }

  /* 3. Impact Sparks & Blood Splatter Burst */
  const sparkPos = new THREE.Vector3(tX + (Math.random() - 0.5) * 0.25, 0.6, tZ + (Math.random() - 0.5) * 0.25);
  if (isCrit && GIGAPACK_REGISTRY['burst_splatter_001_large_red']) {
    spawnSheetEffect(scene, GIGAPACK_REGISTRY['burst_splatter_001_large_red'], sparkPos, scale * 1.6, 0.3);
  }
  spawnSpriteEffect(scene, {
    frames: isCrit ? [
      'dcss/effect/kny_star_0.png',
      'dcss/effect/kny_star_1.png',
      'dcss/effect/kny_star_2.png',
      'dcss/effect/kny_star_3.png',
      'dcss/effect/kny_star_4.png'
    ] : [
      'dcss/effect/kny_spark_0.png',
      'dcss/effect/kny_spark_1.png',
      'dcss/effect/kny_spark_2.png',
      'dcss/effect/kny_spark_3.png'
    ],
    frameInterval: 0.04
  }, sparkPos, isCrit ? scale * 2.0 : scale * 1.25, isCrit ? 0.26 : 0.2);

  /* 4. Ground ring shockwave */
  spawnSlash(scene, { x: tX, z: tZ }, isCrit ? 0xffd34a : 0xff7a5a, isCrit ? scale * 1.6 : scale * 1.0);
}

/** Rich Multi-Layered Animated Spell & Ability VFX Burst */
export function spawnRichAbilityVFX(scene, casterPos, targetPos, fx, label, opts = {}) {
  const tX = targetPos.x, tZ = targetPos.z;
  const cX = casterPos ? casterPos.x : tX;
  const cZ = casterPos ? casterPos.z : tZ;
  const hitPos = new THREE.Vector3(tX, 0.55, tZ);
  const color = fx.color || 0xe04040;
  const scale = opts.aoe ? 2.2 : 1.6;
  const dmgType = fx.dmgType || (fx.effect ? fx.effect.key : 'magic');

  /* 1. Ground Ring Shockwave */
  spawnSlash(scene, { x: tX, z: tZ }, color, opts.aoe ? 2.2 : 1.4);

  /* 2. Gigapack Spritesheet Burst */
  let sheetKey = fx.sheetKey;
  if (!sheetKey) {
    if (dmgType === 'fire') sheetKey = 'epic_explosion_001_large_orange';
    else if (dmgType === 'cold') sheetKey = 'round_sparkle_burst_001_large_blue';
    else if (dmgType === 'acid' || dmgType === 'poison' || dmgType === 'poisoned') sheetKey = 'spell_poison_001_large_green';
    else if (dmgType === 'lightning') sheetKey = 'lightning_burst_001_large_violet';
    else if (dmgType === 'necrotic' || dmgType === 'drained') sheetKey = 'spell_death_001_large_red';
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
  } else if (dmgType === 'radiant') {
    frames = ['dcss/effect/goldaura_0.png', 'dcss/effect/goldaura_1.png', 'dcss/effect/goldaura_2.png', 'dcss/effect/gold_sparkles_1.png', 'dcss/effect/gold_sparkles_2.png'];
  } else if (dmgType === 'psychic' || dmgType === 'frightened' || dmgType === 'charmed' || dmgType === 'blinded' || dmgType === 'incapacitated') {
    frames = ['dcss/effect/cloud_gloom_new.png', 'dcss/effect/quad_glow.png', 'dcss/effect/disjunct_0.png', 'dcss/effect/disjunct_1.png'];
  } else {
    const baseSprite = fx.sprite ? (fx.sprite.includes('.png') ? fx.sprite : `dcss/effect/${fx.sprite}.png`) : 'dcss/effect/magic_bolt_1.png';
    frames = [baseSprite];
  }

  spawnSpriteEffect(scene, { frames, frameInterval: 0.05 }, hitPos, scale, 0.45);

  /* 4. Impact Spark & Starburst Burst */
  const sparkPos = new THREE.Vector3(tX + (Math.random() - 0.5) * 0.3, 0.65, tZ + (Math.random() - 0.5) * 0.3);
  spawnSpriteEffect(scene, {
    frames: [
      'dcss/effect/kny_star_0.png',
      'dcss/effect/kny_star_1.png',
      'dcss/effect/kny_star_2.png',
      'dcss/effect/kny_star_3.png',
      'dcss/effect/kny_star_4.png'
    ],
    frameInterval: 0.04
  }, sparkPos, scale * 1.1, 0.3);

  /* 5. Projectile Beam from Caster to Target for Ranged Spells */
  if (Math.hypot(tX - cX, tZ - cZ) > 1.2) {
    const projType = dmgType === 'fire' ? 'fireball' : dmgType === 'cold' ? 'icicle' : dmgType === 'lightning' ? 'zap' : 'magic';
    const from = new THREE.Vector3(cX, 0.55, cZ);
    const to = new THREE.Vector3(tX, 0.4, tZ);
    spawnProjectile(scene, from, to, projType, color, () => {});
  }
}

/* -------- animated spritesheet FX (Pixel FX pack: square grids of 100px frames) --------
   def: { url, cols, rows, frames, fps, dur?, scale? }. Plays from frame 0 at
   `fps`, wrapping around the sheet's loop if `dur` outlasts it, with the same
   fade-in/out envelope as spawnSpriteEffect. Textures are cached per URL and
   cloned per instance (clones share the image source — one GPU upload). */
const sheetEffects = [];
const _sheetTexCache = {};
export function spawnSheetEffect(scene, def, pos, scale = null, dur = null){
  let base = _sheetTexCache[def.url];
  if(!base){
    base = new THREE.TextureLoader().load(def.url);
    base.colorSpace = THREE.SRGBColorSpace;
    base.magFilter = THREE.NearestFilter;
    base.minFilter = THREE.NearestFilter;
    _sheetTexCache[def.url] = base;
  }
  const tex = base.clone();
  tex.needsUpdate = true;
  tex.repeat.set(1/def.cols, 1/def.rows);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
  const mesh = new THREE.Sprite(mat);
  const s = scale != null ? scale : (def.scale || 1.5);
  mesh.scale.set(s, s, 1);
  mesh.position.copy(pos);
  mesh.renderOrder = 30;
  scene.add(mesh);
  const d = dur != null ? dur : (def.dur != null ? def.dur : def.frames / def.fps);
  sheetEffects.push({ mesh, mat, tex, def, t: 0, dur: d });
}

let _beamTex = null;
function getBeamTexture() {
  if (!_beamTex) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const ctx = cv.getContext('2d');

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

    _beamTex = new THREE.CanvasTexture(cv);
    _beamTex.colorSpace = THREE.SRGBColorSpace;
    _beamTex.wrapS = THREE.ClampToEdgeWrapping;
    _beamTex.wrapT = THREE.RepeatWrapping;
  }
  return _beamTex;
}

/* -------- 3D Continuous Beam VFX System -------- */
const activeBeams = [];

export function spawnBeamEffect(scene, from, to, opts = {}) {
  const type = opts.type || 'ray';
  const color = opts.color || 0xff7a30;
  const coreColor = opts.coreColor || 0xffffff;
  const width = opts.width || 0.65;
  const duration = opts.duration || 0.55;
  const scrollSpeed = opts.scrollSpeed !== undefined ? opts.scrollSpeed : 5.0;
  const onHit = opts.onHit || null;

  // Execute onHit immediately so impact damage & hit numbers trigger cleanly
  if (onHit) { try { onHit(); } catch(e){} }

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
    const height = Math.abs((from.y || 6.0) - (to.y || 0.05)) || 6.0;
    const radius = width * 0.9;
    const cylGeo = new THREE.CylinderGeometry(radius * 0.8, radius, height, 16, 1, true);

    const glowTex = getBeamTexture().clone();
    glowTex.repeat.set(1, 4);

    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    const coreTex = getBeamTexture().clone();
    coreTex.repeat.set(1, 4);

    const coreGeo = new THREE.CylinderGeometry(radius * 0.4, radius * 0.45, height, 12, 1, true);
    const coreMat = new THREE.MeshBasicMaterial({
      map: coreTex,
      color: coreColor,
      transparent: true,
      opacity: 0.95,
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

    spawnSlash(scene, { x: to.x, z: to.z }, color, width * 2.8);

    activeBeams.push({
      group, glowMat, coreMat, glowTex, coreTex, type, from: from.clone(), to: to.clone(),
      width, scrollSpeed, duration, t: 0, baseGlowOp: 0.85, baseCoreOp: 0.95
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

    // Dynamic Electric Point Light Source
    const light = new THREE.PointLight(color, 5.0, 14);
    light.position.copy(from);
    group.add(light);

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

    spawnSlash(scene, { x: to.x, z: to.z }, color, width * 2.5);

    activeBeams.push({
      group, glowMat, coreMat, type, from: from.clone(), to: to.clone(),
      width, scrollSpeed, duration, t: 0, updateLightningNodes, lastJitter: 0,
      baseGlowOp: 0.95, baseCoreOp: 1.0, light
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

  // Dynamic Point Light Source along laser beam
  const light = new THREE.PointLight(color, 4.0, 10);
  light.position.copy(mid);
  group.add(light);

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
        p.tex.offset.set((f % d.cols) / d.cols, (d.rows - 1 - Math.floor(f / d.cols)) / d.rows);
      }
      if (p.mat && p.kind !== 'arrow') {
        p.mat.rotation += dt * 4.2; // gentle z-rotation for energy orb (30% slower)
      }
      if (p.glowMesh) {
        const pulse = 0.85 + 0.25 * Math.sin(p.t * 18);
        p.glowMesh.scale.set((p.scale || 1.3) * 1.35 * pulse, (p.scale || 1.3) * 1.35 * pulse, 1);
      }
    }

    if(k>=1){
      scene.remove(p.mesh);
      if (p.mat) p.mat.dispose();
      if (p.glowMat) p.glowMat.dispose();
      if (p.tex) p.tex.dispose();
      projectiles.splice(i,1);
      if(p.onHit){ try { p.onHit(); } catch(e){} }
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
    if(k < 0.15) e.mat.opacity = k / 0.15;
    else if(k > 0.8) e.mat.opacity = (1 - k) / 0.2;
    else e.mat.opacity = 1;
    
    if(k>=1){
      scene.remove(e.mesh);
      e.mat.dispose();
      if (e.frames) {
        for (const t of e.frames) t.dispose();
      } else if (e.tex) {
        e.tex.dispose();
      }
      spriteEffects.splice(i,1);
    }
  }
  for(let i=sheetEffects.length-1;i>=0;i--){
    const e = sheetEffects[i];
    e.t += dt;
    const k = e.t / e.dur, d = e.def;
    const f = Math.floor(e.t * (d.fps * 0.70)) % d.frames;
    e.tex.offset.set((f % d.cols) / d.cols, (d.rows - 1 - Math.floor(f / d.cols)) / d.rows);
    if(k < 0.15) e.mat.opacity = k / 0.15;
    else if(k > 0.75) e.mat.opacity = (1 - k) / 0.25;
    else e.mat.opacity = 1;
    if(k >= 1){
      scene.remove(e.mesh);
      e.mat.dispose();
      e.tex.dispose();
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

    if (b.group && b.type !== 'lightning') {
      const pulse = 1.0 + 0.15 * Math.sin(b.t * 35);
      b.group.scale.set(pulse, 1, pulse);
    }

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
      if (b.light) b.light.dispose();
      activeBeams.splice(i, 1);
    }
  }

  // Update persistent AoE ground visuals
  for (let i = activeAoEVisuals.length - 1; i >= 0; i--) {
    const v = activeAoEVisuals[i];
    v.t += dt;
    v.group.rotation.y += dt * v.rotateSpeed;
    const pulse = 0.8 + 0.2 * Math.sin(v.t * v.pulseSpeed * Math.PI);
    if (v.borderMat) v.borderMat.opacity = 0.6 * pulse;
    if (v.innerMat) v.innerMat.opacity = 0.08 * pulse;

    if (v.glowTex) v.glowTex.offset.y -= dt * 3.5;
    if (v.coreTex) v.coreTex.offset.y -= dt * 5.0;
    if (v.cylMat) v.cylMat.opacity = 0.35 + 0.10 * Math.sin(v.t * 3.0);
    if (v.coreMat) v.coreMat.opacity = 0.40 + 0.10 * Math.cos(v.t * 4.0);

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
}

export function disposeExitIndicator(ind) {
  if (!ind) return;
  if (ind.mesh.parent) ind.mesh.parent.remove(ind.mesh);
  ind.mesh.geometry.dispose();
  ind.mesh.material.map.dispose();
  ind.mesh.material.dispose();
}

/** Drop all live effects (called when a level unloads). */
export function clearEffects(scene){
  for(const p of projectiles){ scene.remove(p.mesh); p.mat.dispose(); if(p.glowMat) p.glowMat.dispose(); }
  for(const s of slashes){ scene.remove(s.m); s.mat.dispose(); }
  for(const e of spriteEffects){ scene.remove(e.mesh); e.mat.dispose(); e.tex.dispose(); }
  for(const p of fountainPool){ scene.remove(p.spr); p.tex.dispose(); p.spr.material.dispose(); }
  for(const t of telegraphPool){ scene.remove(t.mesh); t.mat.dispose(); t.geom.dispose(); }
  projectiles.length = 0; slashes.length = 0; spriteEffects.length = 0;
  fountainPool.length = 0; telegraphPool.length = 0;
}

/** Check if any combat animations (projectiles, slashes, spell FX) are currently active. */
export function hasActiveFX() {
  return projectiles.length > 0 || slashes.length > 0 || spriteEffects.length > 0;
}
