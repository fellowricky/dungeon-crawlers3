/**
 * Entity visuals — low-poly procedural minis for heroes and monsters,
 * matching the painted-miniature look of the dungeon (no disk assets).
 * Each entity is a THREE.Group with a body and a billboarded HP bar.
 */
import * as THREE from 'three';
import { CLASSES } from './srd.js';
import { HeroSprite } from './sprite_animator.js';

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
  return { spr, cv, g: cv.getContext('2d'), tex };
}
export function drawBar(bar, frac, color='#4ade4a'){
  const { g, cv, tex } = bar;
  g.clearRect(0,0,cv.width,cv.height);
  g.fillStyle = 'rgba(10,10,14,0.75)';
  g.fillRect(0,0,cv.width,cv.height);
  g.fillStyle = frac > 0.5 ? color : (frac > 0.25 ? '#e8b23f' : '#e0483a');
  g.fillRect(1,1,(cv.width-2)*Math.max(0,frac),cv.height-2);
  tex.needsUpdate = true;
}

/* -------- hero mini: 2D animated LPC sprite -------- */
export function makeHeroMesh(hero){
  const cls = CLASSES[hero.classKey];
  const grp = new THREE.Group();

  // Create the animated sprite using the hero's visual setup
  const anim = new HeroSprite(hero, cls.color);
  grp.add(anim.mesh);

  const bar = makeBar();
  bar.spr.position.y = 1.25;
  drawBar(bar, 1);
  grp.add(bar.spr);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.24,0.3,20).rotateX(-Math.PI/2).translate(0,0.02,0),
    new THREE.MeshBasicMaterial({ color:cls.color, transparent:true, opacity:0.55, depthWrite:false }));
  grp.add(ring);

  return { grp, bar, anim };
}

/* -------- monster mini: DCSS sprite -------- */
export function makeMonsterMesh(mon){
  const grp = new THREE.Group();
  const s = mon.scale;
  const n = mon.name.toLowerCase();
  
  let spritePath = 'dcss/monster/' + (mon.sprite || 'orc.png');
  
  const tex = new THREE.TextureLoader().load(spritePath);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Sprite(mat);
  mesh.center.set(0.5, 0);
  mesh.scale.set(1.5 * s, 1.5 * s, 1);
  grp.add(mesh);

  const bar = makeBar();
  bar.spr.position.y = 1.5 * s + 0.2;
  drawBar(bar, 1, '#e0483a');
  grp.add(bar.spr);
  
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
  
  return { grp, bar, anim };
}

/* -------- floating damage/heal numbers -------- */
const puffPool = [];
export function makeFloatText(scene, text, pos, color){
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 48;
  const g = cv.getContext('2d');
  g.font = 'bold 30px Verdana';
  g.textAlign = 'center';
  g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(text, 64, 34);
  g.fillStyle = color;
  g.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map:tex, transparent:true, depthTest:false }));
  spr.scale.set(1.6,0.6,1);
  spr.position.copy(pos);
  spr.renderOrder = 60;
  scene.add(spr);
  puffPool.push({ spr, t:0 });
}
export function updateFloatTexts(scene, dt){
  for(let i=puffPool.length-1;i>=0;i--){
    const p = puffPool[i];
    p.t += dt;
    p.spr.position.y += dt*1.2;
    p.spr.material.opacity = Math.max(0, 1 - p.t/1.1);
    if(p.t > 1.1){
      scene.remove(p.spr);
      p.spr.material.map.dispose();
      p.spr.material.dispose();
      puffPool.splice(i,1);
    }
  }
}

/* flash a mesh red/white on hit */
export function hitFlash(ent){
  if (ent.anim) {
    ent.anim.play('hurt', true);
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

/* ================= attack effects: projectiles + slashes ================= */
const _projGeo = {
  arrow: new THREE.CylinderGeometry(0.016,0.016,0.44,5).rotateX(Math.PI/2),  // long axis +z
  bolt:  new THREE.IcosahedronGeometry(0.13,0)
};
const _ringGeo = new THREE.RingGeometry(0.22,0.5,22).rotateX(-Math.PI/2);
const projectiles = [];
const slashes = [];
const spriteEffects = [];

/** Fire a projectile from `from` to `to`; calls onHit() when it lands. */
export function spawnProjectile(scene, from, to, kind, color, onHit){
  const geo = _projGeo[kind] || _projGeo.bolt;
  const mat = new THREE.MeshBasicMaterial({ color }); mat.toneMapped = false;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(from);
  if(kind==='arrow') mesh.lookAt(to);
  let glowMat = null;
  if(kind!=='arrow'){                              // soft additive halo for magic bolts
    glowMat = new THREE.SpriteMaterial({ color, transparent:true, opacity:0.55, depthWrite:false, blending:THREE.AdditiveBlending });
    glowMat.toneMapped = false;
    const glow = new THREE.Sprite(glowMat); glow.scale.set(0.7,0.7,1);
    mesh.add(glow);
  }
  scene.add(mesh);
  const dur = Math.max(0.08, from.distanceTo(to)/16);
  projectiles.push({ mesh, mat, glowMat, from:from.clone(), to:to.clone(), t:0, dur, onHit, kind });
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

export function spawnSpriteEffect(scene, texturePath, pos, scale=1.5, dur=0.4){
  const tex = new THREE.TextureLoader().load(texturePath);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Sprite(mat);
  mesh.scale.set(scale, scale, 1);
  mesh.position.copy(pos);
  scene.add(mesh);
  
  spriteEffects.push({ mesh, mat, tex, t: 0, dur });
}

export function updateProjectiles(scene, dt){
  for(let i=projectiles.length-1;i>=0;i--){
    const p = projectiles[i];
    p.t += dt;
    const k = Math.min(1, p.t/p.dur);
    p.mesh.position.lerpVectors(p.from, p.to, k);
    if(p.kind==='arrow') p.mesh.position.y += Math.sin(k*Math.PI)*0.22;   // gentle arc
    else p.mesh.rotation.y += dt*13;
    if(k>=1){
      scene.remove(p.mesh); p.mat.dispose(); if(p.glowMat) p.glowMat.dispose();
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
    if(k < 0.2) e.mat.opacity = k / 0.2;
    else if(k > 0.8) e.mat.opacity = (1 - k) / 0.2;
    else e.mat.opacity = 1;
    
    if(k>=1){
      scene.remove(e.mesh);
      e.mat.dispose();
      e.tex.dispose();
      spriteEffects.splice(i,1);
    }
  }
}

/** Drop all live effects (called when a level unloads). */
export function clearEffects(scene){
  for(const p of projectiles){ scene.remove(p.mesh); p.mat.dispose(); if(p.glowMat) p.glowMat.dispose(); }
  for(const s of slashes){ scene.remove(s.m); s.mat.dispose(); }
  for(const e of spriteEffects){ scene.remove(e.mesh); e.mat.dispose(); e.tex.dispose(); }
  projectiles.length = 0; slashes.length = 0; spriteEffects.length = 0;
}
