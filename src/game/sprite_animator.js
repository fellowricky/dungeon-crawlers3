import * as THREE from 'three';

const ASSETS_ROOT = './lpc/';
const LAYER_ORDER = [
  'body',
  'head',
  'eyes',
  'legs',
  'torso',
  'feet',
  'ears',
  'facialHair',
  'hair',
  'helm',
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
    img.onerror = () => { resolve(null); }; // resolve null on missing layer
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
    this.mesh.scale.set(1.5, 1.5, 1);
    // 0.15 represents the vertical padding from bottom to character's feet
    this.mesh.center.set(0.5, 0.15); 
    this.mesh.visible = false; // Hide until texture loads to prevent white box
    
    this.state = 'walk';
    this.dir = 'down';
    this.time = 0;
    this.animating = true;
    
    this.loadState('walk');
    this.loadState('slash');
    this.loadState('hurt');
  }

  getCacheKey(action) {
    const w = this.equipment.weapon ? this.equipment.weapon.visualWeapon : 'none';
    const t = this.equipment.armor ? this.equipment.armor.visualTorso : 'none';
    const l = this.equipment.armor ? this.equipment.armor.visualLegs : 'none';
    return [
      action, this.visual.gender, this.visual.skinColor, this.visual.hair, this.visual.hairColor,
      w, t, l
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
    
    const paths = {
      body: `body/bodies/${g}`,
      head: customHead ? `head/heads/${customHead}` : (isMonster ? null : `head/heads/human/${clothG}`),
      eyes: (isMonster || customHead) ? null : `eyes/human/adult`,
      ears: (!isMonster && !customHead && this.visual.ears === 'elven') ? `head/ears/elven/adult` : null,
      legs: (isMonster || l === 'none') ? null : `legs/${l}/${l === 'armour/plate' ? 'male' : clothG}`,
      torso: (isMonster || t === 'none' || !t) ? null : `torso/${t}/${clothG}`,
      feet: (isMonster || this.visual.shoes === 'none') ? null : `feet/${l === 'armour/plate' ? 'armour/plate' : 'shoes/basic'}/${clothG === 'male' ? 'male' : 'thin'}`,
      facialHair: (isMonster || customHead || !this.visual.facialHair || this.visual.facialHair === 'none') ? null : `beards/${this.visual.facialHair}`,
      hair: (isMonster || customHead || this.visual.hair==='none') ? null : `hair/${this.visual.hair}`,
      helm: h ? `hat/${h}${h === 'helmet/greathelm' ? '/' + clothG : ''}` : null,
      weapon: w ? `weapon/${w}` : null
    };

    for (const layer of LAYER_ORDER) {
      if (!paths[layer]) continue;
      const img = await loadImage(`${ASSETS_ROOT}${paths[layer]}/${action}.png`);
      if (img) {
        if (layer === 'body' || layer === 'head' || layer === 'ears') {
          this.drawTintedLayer(ctx, img, this.visual.skinColor);
        } else if (layer === 'hair' || layer === 'facialHair') {
          this.drawTintedLayer(ctx, img, this.visual.hairColor);
        } else if (layer === 'eyes' && this.visual.eyeColor) {
          this.drawTintedLayer(ctx, img, this.visual.eyeColor);
        } else {
          ctx.drawImage(img, 0, 0);
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
    let currentFrame = Math.floor(this.time * meta.speed) % frames;
    
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
