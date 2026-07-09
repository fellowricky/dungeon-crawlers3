import * as THREE from 'three';

const ASSETS_ROOT = './lpc/';
const LAYER_ORDER = [
  'shield_behind',
  'weapon_behind',
  'body',
  'head',
  'eyes',
  'legs',
  'torso',
  'feet',
  'shoulders',
  'gloves',
  'ears',
  'horns',
  'facialHair',
  'hair',
  'helm',
  'visor',
  'shield',
  'weapon'
];

const ANIM_META = {
  spellcast: { cols: 7, rows: 4, speed: 10 },
  thrust:    { cols: 8, rows: 4, speed: 12 },
  walk:      { cols: 9, rows: 4, speed: 12 },
  slash:     { cols: 6, rows: 4, speed: 12 },
  shoot:     { cols: 13, rows: 4, speed: 15 },
  hurt:      { cols: 6, rows: 1, speed: 8 }
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

// Cache composed textures so we don't redraw canvases for identical visual setups
const textureCache = {};

export class HeroSprite {
  constructor(hero, color) {
    this.visual = hero.visual || {};
    this.equipment = hero.equipment || {};
    this.color = color;
    this.textures = {}; 
    this.material = new THREE.SpriteMaterial({ transparent: true, depthTest: true, depthWrite: false });
    this.mesh = new THREE.Sprite(this.material);
    const sx = this.visual.spriteScaleX || 1.0;
    const sy = this.visual.spriteScaleY || 1.0;
    this.mesh.scale.set(1.5 * sx, 1.5 * sy, 1);
    // LPC frames leave only ~3% transparent padding below the feet — anchor
    // there so feet sit ON the floor instead of sinking through it
    this.mesh.center.set(0.5, 0.04);
    this.mesh.visible = false; // Hide until texture loads to prevent white box

    this.state = 'walk';
    this.dir = 'down';
    this.time = 0;
    this.animating = true;

    this.loadState('walk');
    this.loadState('slash');
    this.loadState('hurt');
    this.loadState('shoot');
    this.loadState('spellcast');
  }

  /* re-compose every loaded animation (called after equipment changes) */
  reloadAll(){
    for (const k of Object.keys(this.textures)) this.loadState(k);
  }

  getCacheKey(action) {
    const w = this.equipment.weapon ? `${this.equipment.weapon.visualWeapon}|${this.equipment.weapon.visualColor||''}` : 'none';
    const t = this.equipment.armor ? `${this.equipment.armor.visualTorso}|${this.equipment.armor.visualColor||''}|${this.equipment.armor.visualShoulders||''}` : 'none';
    const l = this.equipment.armor ? `${this.equipment.armor.visualLegs || 'pants'}|${this.equipment.armor.visualColor||''}` : 'none';
    const hm = this.equipment.helm ? `${this.equipment.helm.visualHelm}|${this.equipment.helm.visualColor||''}|${this.equipment.helm.visualVisor||''}` : 'none';
    const sh = this.equipment.offhand ? `${this.equipment.offhand.visualShield}|${this.equipment.offhand.visualColor||''}` : 'none';
    const f = this.equipment.boots ? `${this.equipment.boots.visualShoes}|${this.equipment.boots.visualColor||''}` : 'none';
    const glv = this.equipment.gloves ? `${this.equipment.gloves.visualGloves}|${this.equipment.gloves.visualColor||''}` : 'none';
    return [
      action, this.visual.gender, this.visual.skinColor, this.visual.hair, this.visual.hairColor,
      w, t, l, hm, sh, f, glv,
      this.visual.horns || 'none', this.visual.ears || 'none',
      this.visual.spriteScaleX || 1.0, this.visual.spriteScaleY || 1.0
    ].join('|');
  }

  // Draw an image to the canvas, tinting it using source-in if a tint color is provided
  drawTintedLayer(ctx, img, tintColor) {
    if (!tintColor) {
      ctx.drawImage(img, 0, 0);
      return;
    }
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width; tempCanvas.height = img.height;
    const tctx = tempCanvas.getContext('2d');
    
    // Draw original image
    tctx.drawImage(img, 0, 0);
    // Tint it using multiply (so shadows remain)
    tctx.globalCompositeOperation = 'multiply';
    tctx.fillStyle = tintColor;
    tctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    
    // The previous step tinted the transparent pixels too! We must mask it using destination-in
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(img, 0, 0);
    
    // Draw the properly tinted layer onto the main canvas
    ctx.drawImage(tempCanvas, 0, 0);
  }

  async loadState(action) {
    if (!ANIM_META[action]) return;
    const cacheKey = this.getCacheKey(action);
    if (textureCache[cacheKey]) {
      this.textures[action] = textureCache[cacheKey];
      return;
    }

    const meta = ANIM_META[action];
    const canvas = document.createElement('canvas');
    canvas.width = meta.cols * 64;
    canvas.height = meta.rows * 64;
    const ctx = canvas.getContext('2d');
    
    const g = this.visual.gender;
    const isMonster = (g === 'skeleton' || g === 'zombie');
    const customHead = this.visual.head;
    const clothG = (g === 'muscular' || g === 'teen' || g === 'child') ? 'male' : g;
    
    const w = this.equipment.weapon ? this.equipment.weapon.visualWeapon : null;
    const t = this.equipment.armor ? this.equipment.armor.visualTorso : null;
    const l = this.equipment.armor ? (this.equipment.armor.visualLegs || 'pants') : (this.visual.pants !== undefined ? this.visual.pants : 'pants');
    const h = this.equipment.helm ? this.equipment.helm.visualHelm : null;
    const v = this.equipment.helm ? this.equipment.helm.visualVisor : null;
    const sh = this.equipment.offhand ? this.equipment.offhand.visualShield : null;
    const f = this.equipment.boots ? this.equipment.boots.visualShoes : (this.visual.shoes !== undefined ? this.visual.shoes : 'shoes/basic');
    const shld = this.equipment.armor ? this.equipment.armor.visualShoulders : null;
    const glv = this.equipment.gloves ? this.equipment.gloves.visualGloves : null;
    
    let w_behind = w ? `weapon_behind/${w}` : null;

    let sh_behind = null;
    if (sh && sh.includes('crusader/fg')) {
      sh_behind = `shield_behind/crusader/fg/${clothG}`;
    }

    const paths = {
      shield_behind: sh_behind,
      weapon_behind: w_behind,
      body: `body/bodies/${g}`,
      head: customHead ? `head/heads/${customHead}` : (isMonster ? null : `head/heads/human/${clothG}`),
      eyes: (isMonster || customHead) ? null : `eyes/human/adult/default`,
      ears: (!isMonster && this.visual.ears && this.visual.ears !== 'none'
             && (!customHead || this.visual.ears === 'dragon')) ? `head/ears/${this.visual.ears}/adult` : null,
      horns: (!isMonster && this.visual.horns && this.visual.horns !== 'none') ? `head/horns/${this.visual.horns}` : null,
      legs: (isMonster || l === 'none') ? null : `legs/${l}/${l === 'armour/plate' ? 'male' : clothG}`,
      torso: (isMonster || t === 'none' || !t) ? null : `torso/${t}/${clothG}`,
      feet: (isMonster || f === 'none') ? null : `feet/${f}/${clothG === 'male' ? 'male' : 'thin'}`,
      shoulders: shld ? `shoulders/${shld}/${shld === 'legion' ? clothG : (clothG === 'male' ? 'male' : 'thin')}` : null,
      gloves: glv ? `${glv}/${clothG === 'male' ? 'male' : 'thin'}` : null,
      facialHair: (isMonster || customHead || !this.visual.facialHair || this.visual.facialHair === 'none') ? null : `beards/${this.visual.facialHair}`,
      hair: (isMonster || customHead || this.visual.hair==='none') ? null : `hair/${this.visual.hair}`,
      helm: h ? (h.includes('greathelm') ? `hat/${h}/${clothG}` : `hat/${h}/adult`) : null,
      visor: v ? `hat/visor/${v}/adult` : null,
      shield: sh ? (sh === 'round' ? `shield/${sh}` : `shield/${sh}/${clothG}`) : null,
      weapon: w ? `weapon/${w}` : null
    };

    for (const layer of LAYER_ORDER) {
      if (!paths[layer]) continue;
      const img = await loadImage(`${ASSETS_ROOT}${paths[layer]}/${action}.png`);
      if (img) {
        if (layer === 'body' || layer === 'head' || layer === 'ears' || layer === 'horns') {
          this.drawTintedLayer(ctx, img, this.visual.skinColor);
        } else if (layer === 'hair' || layer === 'facialHair') {
          this.drawTintedLayer(ctx, img, this.visual.hairColor);
        } else if (layer === 'eyes' && this.visual.eyeColor) {
          this.drawTintedLayer(ctx, img, this.visual.eyeColor);
        } else {
          // If the equipment in this slot has a visual color, tint it!
          let slotKey = layer;
          if (layer === 'helm' || layer === 'visor') slotKey = 'helm';
          else if (layer === 'shield' || layer === 'shield_behind') slotKey = 'offhand';
          else if (layer === 'weapon' || layer === 'weapon_behind') slotKey = 'weapon';
          else if (layer === 'legs' || layer === 'torso' || layer === 'feet' || layer === 'shoulders') slotKey = 'armor';
          else if (layer === 'gloves') slotKey = 'gloves';

          const it = this.equipment[slotKey];
          if (it && it.visualColor) {
            this.drawTintedLayer(ctx, img, it.visualColor);
          } else {
            ctx.drawImage(img, 0, 0);
          }
        }
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.repeat.set(1 / meta.cols, 1 / meta.rows);
    
    textureCache[cacheKey] = tex;
    this.textures[action] = tex;
  }

  play(action, forceRestart = false) {
    if (this.state === action && !forceRestart) return;
    this.state = action;
    this.time = 0;
    this.animating = true;
    if (!this.textures[action]) {
      this.loadState(action);
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
    if (this.animating) {
      this.time += dt;
    }
    
    const meta = ANIM_META[this.state] || ANIM_META['walk'];
    let tex = this.textures[this.state];
    
    if (!tex) {
      tex = this.textures['walk'];
      if (!tex) return;
    }

    if (this.material.map !== tex) {
      this.material.map = tex;
      this.mesh.visible = true;
    }

    const frames = meta.cols;
    let currentFrame;
    if (this.state === 'walk') {
      // Official LPC walk cycle uses frames 1-8, skipping frame 0 (standing/idle pose).
      // When time ≈ 0 (hero is idle), show frame 0 so the hero stands still.
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
      
      // If hurt finishes, return to walk(idle)
      if (this.state === 'hurt') {
        this.play('walk');
        return;
      }
    }

    const rowIdx = meta.rows === 1 ? 0 : DIRS[this.dir];
    const vOffset = (meta.rows - 1 - rowIdx) / meta.rows;
    const uOffset = currentFrame / meta.cols;

    tex.offset.set(uOffset, vOffset);
  }
}

/* ================= static portrait ==================================
   Composes a hero's front-facing (down) standing frame with their CURRENT
   equipment onto a 2D canvas — so the character screen reflects gear the
   player just equipped. Mirrors HeroSprite's layer/path resolution but
   draws a single frame (walk sheet, row 2 = facing camera, frame 0). */
function drawPortraitFrame(ctx, img, tint){
  // walk sheet is 9×4 of 64px cells; row 2 (y=128) faces the camera
  if(!tint){ ctx.drawImage(img, 0, 128, 64, 64, 0, 0, 64, 64); return; }
  const tmp = document.createElement('canvas'); tmp.width = 64; tmp.height = 64;
  const t = tmp.getContext('2d');
  t.drawImage(img, 0, 128, 64, 64, 0, 0, 64, 64);
  t.globalCompositeOperation = 'multiply';
  t.fillStyle = tint; t.fillRect(0, 0, 64, 64);
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(img, 0, 128, 64, 64, 0, 0, 64, 64);
  ctx.drawImage(tmp, 0, 0);
}

export async function drawHeroPortrait(canvas, hero){
  const ctx = canvas.getContext('2d');
  const token = (canvas._portraitToken = (canvas._portraitToken || 0) + 1);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const visual = hero.visual || {};
  const equipment = hero.equipment || {};
  const g = visual.gender || 'male';
  const isMonster = (g === 'skeleton' || g === 'zombie');
  const customHead = visual.head;
  const clothG = (g === 'muscular' || g === 'teen' || g === 'child') ? 'male' : g;

  const w = equipment.weapon ? equipment.weapon.visualWeapon : null;
  const t = equipment.armor ? equipment.armor.visualTorso : null;
  const l = equipment.armor ? (equipment.armor.visualLegs || 'pants') : (visual.pants !== undefined ? visual.pants : 'pants');
  const hlm = equipment.helm ? equipment.helm.visualHelm : null;
  const v = equipment.helm ? equipment.helm.visualVisor : null;
  const sh = equipment.offhand ? equipment.offhand.visualShield : null;
  const f = equipment.boots ? equipment.boots.visualShoes : (visual.shoes !== undefined ? visual.shoes : 'shoes/basic');
  const shld = equipment.armor ? equipment.armor.visualShoulders : null;
  const glv = equipment.gloves ? equipment.gloves.visualGloves : null;
 
  let w_behind = w ? `weapon_behind/${w}` : null;

  let sh_behind = null;
  if (sh && sh.includes('crusader/fg')) {
    sh_behind = `shield_behind/crusader/fg/${clothG}`;
  }

  const paths = {
    shield_behind: sh_behind,
    weapon_behind: w_behind,
    body: `body/bodies/${g}`,
    head: customHead ? `head/heads/${customHead}` : (isMonster ? null : `head/heads/human/${clothG}`),
    eyes: (isMonster || customHead) ? null : `eyes/human/adult/default`,
    ears: (!isMonster && visual.ears && visual.ears !== 'none'
           && (!customHead || visual.ears === 'dragon')) ? `head/ears/${visual.ears}/adult` : null,
    horns: (!isMonster && visual.horns && visual.horns !== 'none') ? `head/horns/${visual.horns}` : null,
    legs: (isMonster || l === 'none') ? null : `legs/${l}/${l === 'armour/plate' ? 'male' : clothG}`,
    torso: (isMonster || t === 'none' || !t) ? null : `torso/${t}/${clothG}`,
    feet: (isMonster || f === 'none') ? null : `feet/${f}/${clothG === 'male' ? 'male' : 'thin'}`,
    shoulders: shld ? `shoulders/${shld}/${shld === 'legion' ? clothG : (clothG === 'male' ? 'male' : 'thin')}` : null,
    gloves: glv ? `${glv}/${clothG === 'male' ? 'male' : 'thin'}` : null,
    facialHair: (isMonster || customHead || !visual.facialHair || visual.facialHair === 'none') ? null : `beards/${visual.facialHair}`,
    hair: (isMonster || customHead || visual.hair === 'none') ? null : `hair/${visual.hair}`,
    helm: hlm ? (hlm.includes('greathelm') ? `hat/${hlm}/${clothG}` : `hat/${hlm}/adult`) : null,
    visor: v ? `hat/visor/${v}/adult` : null,
    shield: sh ? (sh === 'round' ? `shield/${sh}` : `shield/${sh}/${clothG}`) : null,
    weapon: w ? `weapon/${w}` : null
  };

  for(const layer of LAYER_ORDER){
    if(!paths[layer]) continue;
    const img = await loadImage(`${ASSETS_ROOT}${paths[layer]}/walk.png`);
    if(canvas._portraitToken !== token) return;   // a newer draw superseded us
    if(!img) continue;
    if(layer === 'body' || layer === 'head' || layer === 'ears' || layer === 'horns') drawPortraitFrame(ctx, img, visual.skinColor);
    else if(layer === 'hair' || layer === 'facialHair') drawPortraitFrame(ctx, img, visual.hairColor);
    else if(layer === 'eyes' && visual.eyeColor) drawPortraitFrame(ctx, img, visual.eyeColor);
    else {
      let slotKey = layer;
      if (layer === 'helm' || layer === 'visor') slotKey = 'helm';
      else if (layer === 'shield' || layer === 'shield_behind') slotKey = 'offhand';
      else if (layer === 'weapon' || layer === 'weapon_behind') slotKey = 'weapon';
      else if (layer === 'legs' || layer === 'torso' || layer === 'feet' || layer === 'shoulders') slotKey = 'armor';
      else if (layer === 'gloves') slotKey = 'gloves';

      const it = equipment[slotKey];
      if (it && it.visualColor) {
        drawPortraitFrame(ctx, img, it.visualColor);
      } else {
        drawPortraitFrame(ctx, img, null);
      }
    }
  }
}
