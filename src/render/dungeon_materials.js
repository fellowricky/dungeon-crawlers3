/**
 * DUNGEON FORGE — procedural texture generation, materials, shaders & post-processing.
 */
import * as THREE from 'three';
import { mulberry32 } from '../dungeon/dungeon_generator.js';
import { cutawayPatch } from './wall_cutaway.js';
import { darkMaskPatch } from './darkness.js';

const _headlessCtx = new Proxy({
  getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8Array(w * h * 4) }),
  createImageData: (w = 1, h = 1) => ({ data: new Uint8Array(w * h * 4) }),
  createLinearGradient: () => ({ addColorStop: () => {} }),
  createRadialGradient: () => ({ addColorStop: () => {} })
}, { get(t, p) { return p in t ? t[p] : () => {}; } });

function makeCanvas(sz, h){
  if (typeof document === 'undefined') {
    return [{ width: sz, height: h || sz, getContext: () => _headlessCtx }, _headlessCtx];
  }
  const c = document.createElement('canvas');
  c.width = sz; c.height = h || sz;
  return [c, c.getContext('2d')];
}
function srgbTex(c){
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const texRand = mulberry32(0xC0FFEE);

function valueNoise(size, cells){
  const g = new Float32Array((cells+1)*(cells+1));
  for(let i=0;i<g.length;i++) g[i]=texRand();
  return (x,y)=>{
    let fx=Math.min(Math.max(x/size*cells,0),cells-1e-4);
    let fy=Math.min(Math.max(y/size*cells,0),cells-1e-4);
    const ix=fx|0, iy=fy|0, tx=fx-ix, ty=fy-iy;
    const sx=tx*tx*(3-2*tx), sy=ty*ty*(3-2*ty), row=cells+1;
    const a=g[iy*row+ix], b=g[iy*row+ix+1], c=g[(iy+1)*row+ix], d=g[(iy+1)*row+ix+1];
    return a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy;
  };
}

function hash2(a,b,s){
  let t=(a*374761393 + b*668265263 + s*974634571)|0;
  t=Math.imul(t^(t>>>13),1274126177); t^=t>>>16;
  return (t>>>0)/4294967296;
}

function strokePath(g,pts,style,w){
  g.strokeStyle=style; g.lineWidth=w; g.lineCap='round'; g.beginPath();
  g.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++) g.lineTo(pts[i][0],pts[i][1]);
  g.stroke();
}

function dotAt(g,x,y,r,style){ g.fillStyle=style; g.beginPath(); g.arc(x,y,r,0,6.2832); g.fill(); }

function makeAtlasTex(kind){ /* kind 0 = flagstone, 1 = masonry blocks */
  const Q=256, SZ=512;
  const [cv,cg]=makeCanvas(SZ), [bv,bg]=makeCanvas(SZ);
  const cid=cg.createImageData(SZ,SZ), bid=bg.createImageData(SZ,SZ);
  const cD=cid.data, bD=bid.data;
  for(let qy=0;qy<2;qy++) for(let qx=0;qx<2;qx++){
    const nA=valueNoise(Q,7), nB=valueNoise(Q,7), grain=valueNoise(Q,41), qs=qy*2+qx+1;
    const seeds=[];
    if(kind===0){
      const k=3+(texRand()*3|0);
      for(let i=0;i<k;i++){
        let x=0,y=0,tries=0;
        do{ x=18+texRand()*(Q-36); y=18+texRand()*(Q-36); }
        while(++tries<24 && seeds.some(s=>(s.x-x)*(s.x-x)+(s.y-y)*(s.y-y)<6400));
        seeds.push({x,y, v:0.78+(texRand()-0.5)*0.14, w:(texRand()-0.5)*0.05});
      }
    }
    const RIM = kind===0 ? 12 : 7, warp = kind===0 ? 30 : 7;
    for(let y=0;y<Q;y++) for(let x=0;x<Q;x++){
      const wxp=x+(nA(x,y)-0.5)*warp, wyp=y+(nB(x,y)-0.5)*warp;
      let edge, sv, sw, dome=1;
      if(kind===0){
        let d1=1e9,d2=1e9,si=0;
        for(let i=0;i<seeds.length;i++){
          const dx=seeds[i].x-wxp, dy=seeds[i].y-wyp, d=dx*dx+dy*dy;
          if(d<d1){ d2=d1; d1=d; si=i; } else if(d<d2) d2=d;
        }
        edge = seeds.length>1 ? Math.sqrt(d2)-Math.sqrt(d1) : RIM;
        sv=seeds[si].v; sw=seeds[si].w;
        dome=1-Math.min(1,Math.sqrt(d1)/150)*0.25;
      } else {
        const rowH=Q/4, colW=Q/2, row=Math.floor(wyp/rowH);
        const xx=wxp+((row&1)?colW*0.5:0), col=Math.floor(xx/colW);
        const dy=Math.min(wyp-row*rowH,(row+1)*rowH-wyp);
        const dx=Math.min(xx-col*colW,(col+1)*colW-xx);
        edge=Math.min(dx,dy);
        sv=0.76+(hash2(row,col,qs)-0.5)*0.17;
        sw=(hash2(col,row,qs)-0.5)*0.05;
      }
      let h=Math.min(1,Math.max(0,edge/RIM)); h=h*h*(3-2*h);
      const gn=grain(x,y);
      let v=(0.35+(sv-0.35)*h) * (0.94+0.12*gn) * (0.85+0.15*dome);
      const o=((qy*Q+y)*SZ+(qx*Q+x))*4;
      cD[o]  =Math.max(0,Math.min(255,(v+sw*h)*255));
      cD[o+1]=Math.max(0,Math.min(255, v*255));
      cD[o+2]=Math.max(0,Math.min(255,(v-sw*h)*255));
      cD[o+3]=255;
      const hb=Math.max(0,Math.min(255, 30+185*h*dome+25*gn));
      bD[o]=bD[o+1]=bD[o+2]=hb; bD[o+3]=255;
    }
  }
  cg.putImageData(cid,0,0); bg.putImageData(bid,0,0);
  for(let qy=0;qy<2;qy++) for(let qx=0;qx<2;qx++){
    const ox=qx*Q, oy=qy*Q;
    cg.save(); bg.save();
    cg.beginPath(); cg.rect(ox,oy,Q,Q); cg.clip();
    bg.beginPath(); bg.rect(ox,oy,Q,Q); bg.clip();
    const nCr = kind===0 ? (texRand()*2.4|0) : (texRand()*1.7|0);
    for(let i=0;i<nCr;i++){
      const pts=[]; let x=ox+30+texRand()*(Q-60), y=oy+30+texRand()*(Q-60), a=texRand()*6.283;
      for(let s=0;s<7;s++){ pts.push([x,y]); a+=(texRand()-0.5)*1.1; x+=Math.cos(a)*(8+texRand()*14); y+=Math.sin(a)*(8+texRand()*14); }
      strokePath(cg,pts,'rgba(30,30,36,0.35)',1.6);
      strokePath(bg,pts,'rgba(0,0,0,0.5)',2.2);
    }
    for(let i=0;i<10;i++){
      const x=ox+12+texRand()*(Q-24), y=oy+12+texRand()*(Q-24), r=1+texRand()*2.6;
      dotAt(cg,x,y,r,'rgba(35,35,42,0.30)');
      dotAt(bg,x,y,r,'rgba(0,0,0,0.45)');
    }
    cg.restore(); bg.restore();
  }
  const mk=c=>{ const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; return t; };
  const map=mk(cv); map.colorSpace=THREE.SRGBColorSpace;
  return { map, bump:mk(bv) };
}

/* ---------------- Texture Generators ---------------- */
/* Ashlar for matStone (columns, sarcophagi, graves, plinths, door posts).
   The old canvas was a near-white field plus grit, so a theme tint painted
   every prop one flat colour and the bump (scale 0.008) never caught light.

   Courses are large on purpose. A pillar's box UV stretches this whole image
   across a ~0.7 × 1.9 block, so a horizontal mark has to be ~18px wide here
   before it survives as one world texel. Coffin UVs are closer to world
   scale (about 0.5), and the same joints still read there. Colour stays light
   and only slightly warm or cool so the per-instance stone tint still leads.

   The first stone generators burned a fixed number of texRand() calls. Wood,
   grass and the atlases continue that same generator, so those calls are
   drained and this field is hashed on its own. */
const STONE_RAND_DRAIN = 5080;
const STONE_BUMP_RAND_DRAIN = 4000;

export function paintStoneField(S = 256) {
  const rgba = new Uint8ClampedArray(S * S * 4);
  const height = new Uint8Array(S * S);
  const COLS = 3, ROWS = 5;
  const mortX = Math.max(8, Math.round(S * 0.072));
  const mortY = Math.max(4, Math.round(S * 0.034));
  const stagger = Math.floor(S / COLS / 2);
  const clamp = v => Math.max(0, Math.min(255, v));
  for (let y = 0; y < S; y++) {
    const row = Math.min(ROWS - 1, Math.floor(y * ROWS / S));
    const rowY0 = Math.floor(row * S / ROWS);
    const ly = y - rowY0;
    const cellH = Math.floor((row + 1) * S / ROWS) - rowY0;
    for (let x = 0; x < S; x++) {
      let xx = x + ((row & 1) ? stagger : 0);
      if (xx >= S) xx -= S;
      const col = Math.min(COLS - 1, Math.floor(xx * COLS / S));
      const colX0 = Math.floor(col * S / COLS);
      const lx = xx - colX0;
      const cellW = Math.floor((col + 1) * S / COLS) - colX0;
      const joint = lx < mortX || ly < mortY;
      const n = hash2(col + 3, row + 1, 2);
      let tone = (0.52 + n * 0.46) * (0.84 + hash2(col >> 1, row >> 1, 4) * 0.28);
      if (row === 1 || row === 3) tone *= 0.9;
      const warm = hash2(col, row, 3) * 2 - 1;
      const chipRoll = hash2(col, row, 5);
      let chip = false;
      if (chipRoll > 0.58) {
        const cx = hash2(col, row, 6) < 0.5 ? 0 : cellW;
        const cy = hash2(col, row, 7) < 0.5 ? 0 : cellH;
        const rad = cellW * (0.24 + hash2(col, row, 8) * 0.2);
        if (Math.hypot(lx - cx, ly - cy) < rad) chip = true;
      }
      const crack = hash2(col, row, 9) > 0.78 &&
        Math.abs(lx / cellW - ly / cellH - (hash2(col, row, 10) - 0.5) * 0.45) < 0.05;
      const pit = !joint && hash2(x >> 4, y >> 4, 11) > 0.88;
      let r = tone * 236 + warm * 18;
      let g = tone * 228;
      let b = tone * 220 - warm * 16;
      if (joint) { r *= 0.30; g *= 0.27; b *= 0.24; }
      else if (chip || crack) { r *= 0.58; g *= 0.54; b *= 0.50; }
      else if (pit) { r *= 0.8; g *= 0.78; b *= 0.76; }
      if (!joint && !chip && hash2(x >> 4, y >> 4, 13) > 0.96) {
        r += 26; g += 24; b += 20;
      }
      if (joint && hash2(x >> 3, y >> 3, 14) > 0.88) { g += 14; b += 6; }
      const o = (y * S + x) * 4;
      rgba[o] = clamp(r); rgba[o + 1] = clamp(g); rgba[o + 2] = clamp(b); rgba[o + 3] = 255;
      let H = 188 + tone * 52;
      if (chip || crack) H = 88;
      else if (pit) H = Math.min(H, 132);
      if (joint) H = 22;
      else {
        const dist = Math.min(lx, ly, cellW - 1 - lx, cellH - 1 - ly);
        if (dist < 6) H = 22 + (H - 22) * (dist / 6);
        if (!chip && !crack) {
          const cx = lx / cellW - 0.5, cy = ly / cellH - 0.5;
          H += Math.max(0, 1 - Math.hypot(cx * 2, cy * 2)) * 18;
        }
      }
      if ((row === 1 || row === 3) && !joint) H -= 14;
      height[y * S + x] = clamp(H);
    }
  }
  return { rgba, height };
}

function uploadStone(pixels, color) {
  const S = Math.round(Math.sqrt(pixels.length / (color ? 4 : 1)));
  const [cv, g] = makeCanvas(S);
  const img = g.createImageData(S, S);
  const d = img.data;
  if (color) d.set(pixels);
  else for (let i = 0; i < pixels.length; i++) {
    const o = i * 4, v = pixels[i];
    d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function makeStoneTex(){
  for (let i = 0; i < STONE_RAND_DRAIN; i++) texRand();
  return uploadStone(paintStoneField(256).rgba, true);
}

function makeStoneBumpTex(){
  for (let i = 0; i < STONE_BUMP_RAND_DRAIN; i++) texRand();
  return uploadStone(paintStoneField(256).height, false);
}

function makeCrackTex(){
  const [cv,g] = makeCanvas(128);
  g.lineCap='round';
  const branch=(x,y,a,w,d)=>{
    if(d<=0 || w<0.4) return;
    const len=9+texRand()*15, nx=x+Math.cos(a)*len, ny=y+Math.sin(a)*len;
    g.strokeStyle='rgba(255,255,255,'+(0.45+0.5*Math.min(1,w/3)).toFixed(2)+')'; g.lineWidth=w;
    g.beginPath(); g.moveTo(x,y); g.lineTo(nx,ny); g.stroke();
    branch(nx,ny, a+(texRand()-0.5)*1.0, w*0.76, d-1);
    if(texRand()<0.55) branch(nx,ny, a+(texRand()-0.5)*2.2, w*0.55, d-2);
  };
  for(let k=0;k<3;k++) branch(64,64, texRand()*6.283, 3.2, 4);
  return srgbTex(cv);
}

/* Drawn in the web fan's own (u,v) parameter space — u runs along the angular
   strands, v from the hub out to the rim — so straight lines here come out as
   radials and rings on the mesh. GEO.spiderWeb must keep those UVs. */
function makeWebTex(){
  const N = 256;
  const [cv,g] = makeCanvas(N);
  g.lineCap = 'round';
  const RAD = 8, RINGS = 6;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 2.4;
  for(let i=0;i<=RAD;i++){
    const x = (i/RAD)*(N-3) + 1.5;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, N); g.stroke();
  }
  /* Rings sag back toward the hub between strands, which is what stops it
     reading as plain graph paper. */
  g.lineWidth = 1.9;
  g.strokeStyle = 'rgba(255,255,255,0.78)';
  for(let r=1;r<=RINGS;r++){
    const y = (r/RINGS)*(N-2);
    g.beginPath(); g.moveTo(0, y);
    for(let i=1;i<=RAD;i++){
      const x = (i/RAD)*N, px = ((i-1)/RAD)*N;
      g.quadraticCurveTo((px+x)*0.5, y - N*0.022, x, y);
    }
    g.stroke();
  }
  return srgbTex(cv);
}

function makeRuneTex(){
  const [cv,g] = makeCanvas(256); g.translate(128,128);
  g.strokeStyle='#ffffff'; g.lineWidth=4; g.beginPath(); g.arc(0,0,105,0,Math.PI*2); g.stroke();
  g.lineWidth=2; g.beginPath(); g.arc(0,0,88,0,Math.PI*2); g.stroke();
  for(let i=0;i<6;i++){
    const a = i*Math.PI/3, x=Math.cos(a)*96, y=Math.sin(a)*96;
    g.beginPath(); g.moveTo(0,0); g.lineTo(x,y); g.stroke();
  }
  return srgbTex(cv);
}

function makeSwirlTex(){
  const [cv,g] = makeCanvas(256); g.translate(128,128);
  for(let i=0;i<300;i++){
    const a = i*0.1, r = i*0.35;
    g.fillStyle = 'rgba(255,255,255,'+(1 - i/300)+')';
    g.beginPath(); g.arc(Math.cos(a)*r, Math.sin(a)*r, 4 + i*0.02, 0, Math.PI*2); g.fill();
  }
  return srgbTex(cv);
}

function makeMistTex(){
  const [cv, g] = makeCanvas(256, 256);
  g.clearRect(0, 0, 256, 256);
  const imgData = g.createImageData(256, 256);
  const d = imgData.data;
  for (let y = 0; y < 256; y++) {
    const ny = (y - 128) / 128;
    for (let x = 0; x < 256; x++) {
      const nx = (x - 128) / 128;
      const dist = Math.sqrt(nx * nx + ny * ny);
      if (dist >= 1.0) continue;
      const radialMask = Math.cos(dist * Math.PI * 0.5);
      const envelope = radialMask * radialMask;

      const n1 = Math.sin(nx * 4.2 + ny * 3.1) * Math.cos(ny * 5.4 - nx * 2.2);
      const n2 = Math.sin(nx * 8.5 - ny * 7.2) * 0.5;
      const n3 = Math.cos(nx * 15.0 + ny * 14.0) * 0.25;
      const noise = (n1 + n2 + n3 + 1.75) / 3.5;

      const alpha = Math.max(0, Math.min(255, Math.round(envelope * noise * 220)));
      const idx = (y * 256 + x) * 4;
      d[idx]     = 255;
      d[idx + 1] = 255;
      d[idx + 2] = 255;
      d[idx + 3] = alpha;
    }
  }
  g.putImageData(imgData, 0, 0);
  const tex = srgbTex(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeGrassTex(){
  const [cv, g] = makeCanvas(256, 256);
  g.fillStyle = '#44662d';
  g.fillRect(0, 0, 256, 256);

  const turfTones = ['#3b5a26', '#4e7233', '#59823a', '#345021', '#669242', '#2f461e'];
  for (let i = 0; i < 400; i++) {
    const x = texRand() * 256, y = texRand() * 256;
    const r = 3 + texRand() * 9;
    g.fillStyle = turfTones[(texRand() * turfTones.length) | 0];
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  for (let i = 0; i < 600; i++) {
    const x = texRand() * 256, y = texRand() * 256;
    const bladeH = 2.5 + texRand() * 4.5;
    g.strokeStyle = (texRand() < 0.65) ? '#72a048' : '#283c18';
    g.lineWidth = 1.0;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (texRand() - 0.5) * 2.0, y - bladeH);
    g.stroke();
  }

  for (let i = 0; i < 35; i++) {
    const x = texRand() * 256, y = texRand() * 256;
    g.fillStyle = (texRand() < 0.6) ? '#d4df7a' : '#f0e698';
    g.fillRect(x, y, 1.5, 1.5);
  }

  const tex = srgbTex(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeCliffRockTex(){
  const [cv, g] = makeCanvas(256, 256);
  // Earthy stratified bedrock base matching HD-2D natural rock strata
  g.fillStyle = '#635848';
  g.fillRect(0, 0, 256, 256);

  // Horizontal sediment strata bands (layered natural rock shelves)
  const bands = 8;
  const bandH = 256 / bands;
  for (let b = 0; b < bands; b++) {
    const y0 = b * bandH;
    const tone = (b % 2 === 0) ? '#746754' : '#574d3f';
    g.fillStyle = tone;
    g.fillRect(0, y0, 256, bandH);

    // Weathered horizontal clefts / stratification lines
    g.fillStyle = 'rgba(26, 22, 17, 0.45)';
    g.fillRect(0, y0 + bandH - 2, 256, 2.5);

    // Staggered vertical stone joints / fractures
    const numJoints = 3 + (texRand() * 3 | 0);
    for (let j = 0; j < numJoints; j++) {
      const jx = (j * (256 / numJoints) + texRand() * 24) % 256;
      g.fillRect(jx, y0, 2.5, bandH);
    }
  }

  // Tactile rock grain, pebble flecks, and quartz flecks
  for (let i = 0; i < 900; i++) {
    const rx = texRand() * 256, ry = texRand() * 256;
    const s = 1.2 + texRand() * 2.2;
    g.fillStyle = texRand() > 0.55 ? 'rgba(205, 198, 175, 0.22)' : 'rgba(30, 26, 20, 0.28)';
    g.fillRect(rx, ry, s, s);
  }

  // Subtle mossy green dusting along top edge of strata bands
  for (let b = 0; b < bands; b++) {
    const y0 = b * bandH;
    g.fillStyle = 'rgba(72, 92, 42, 0.25)';
    g.fillRect(0, y0, 256, 3.5);
  }

  const tex = srgbTex(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeGlowTex(){
  const [cv,g] = makeCanvas(128);
  const grad = g.createRadialGradient(64,64,3, 64,64,62);
  grad.addColorStop(0,'rgba(255,255,255,0.85)');
  grad.addColorStop(0.35,'rgba(255,255,255,0.28)');
  grad.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0,0,128,128);
  return srgbTex(cv);
}

function makeBlotTex(){
  const [cv,g] = makeCanvas(128);
  const grad = g.createRadialGradient(64,64,10, 64,64,60);
  grad.addColorStop(0,'rgba(0,0,0,0.8)');
  grad.addColorStop(1,'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0,0,128,128);
  return srgbTex(cv);
}

function makeMetalTex(){
  const [cv,g] = makeCanvas(256);
  g.fillStyle = '#b0b0b8'; g.fillRect(0,0,256,256);
  // brushed directional grain
  for(let i=0;i<600;i++){
    const y = texRand()*256;
    const v = 140 + texRand()*80 | 0;
    g.fillStyle = 'rgba('+v+','+v+','+(v+8)+','+(0.06 + texRand()*0.10).toFixed(3)+')';
    g.fillRect(0, y, 256, 1+texRand()*2);
  }
  // hammered dents
  for(let i=0;i<35;i++){
    const x = texRand()*256, y = texRand()*256, r = 3+texRand()*8;
    const grad = g.createRadialGradient(x,y,0, x,y,r);
    grad.addColorStop(0,'rgba(60,60,72,0.12)');
    grad.addColorStop(0.6,'rgba(180,180,195,0.08)');
    grad.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x,y,r,0,6.2832); g.fill();
  }
  // specular highlights
  for(let i=0;i<12;i++){
    const x = texRand()*256, y = texRand()*256;
    g.fillStyle = 'rgba(220,220,235,0.06)';
    g.fillRect(x, y, 2+texRand()*6, 1);
  }
  const t = srgbTex(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeCeramicTex(){
  const [cv,g] = makeCanvas(256);
  g.fillStyle = '#c8a882'; g.fillRect(0,0,256,256);
  // glaze variation
  const noise = valueNoise(256,12);
  const id = g.getImageData(0,0,256,256);
  const d = id.data;
  for(let y=0;y<256;y++) for(let x=0;x<256;x++){
    const n = noise(x,y);
    const o = (y*256+x)*4;
    const v = 0.85 + 0.15*n;
    d[o]   = Math.min(255, d[o]*v   | 0);
    d[o+1] = Math.min(255, d[o+1]*v | 0);
    d[o+2] = Math.min(255, d[o+2]*v | 0);
  }
  g.putImageData(id,0,0);
  // fine crackle
  g.strokeStyle = 'rgba(80,60,40,0.12)'; g.lineWidth = 0.8;
  for(let i=0;i<15;i++){
    let x = texRand()*256, y = texRand()*256;
    g.beginPath(); g.moveTo(x,y);
    for(let s=0;s<5;s++){ x+=(texRand()-0.5)*28; y+=(texRand()-0.5)*28; g.lineTo(x,y); }
    g.stroke();
  }
  const t = srgbTex(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeBoneTex(){
  const [cv,g] = makeCanvas(256);
  g.fillStyle = '#e0d8c4'; g.fillRect(0,0,256,256);
  // porous surface detail
  for(let i=0;i<1800;i++){
    const x = texRand()*256, y = texRand()*256, r = 0.5+texRand()*2.2;
    const v = 150 + texRand()*80 | 0;
    g.fillStyle = 'rgba('+v+','+(v-10)+','+(v-25)+',0.14)';
    g.beginPath(); g.arc(x,y,r,0,6.2832); g.fill();
  }
  // darker pits
  for(let i=0;i<250;i++){
    g.fillStyle = 'rgba(90,80,60,'+(0.06+texRand()*0.08).toFixed(3)+')';
    g.beginPath(); g.arc(texRand()*256, texRand()*256, 0.6+texRand()*1.4, 0, 6.2832); g.fill();
  }
  // subtle cracks
  g.strokeStyle = 'rgba(100,88,65,0.15)'; g.lineWidth = 0.7;
  for(let i=0;i<6;i++){
    let x = texRand()*256, y = texRand()*256;
    g.beginPath(); g.moveTo(x,y);
    for(let s=0;s<4;s++){ x+=(texRand()-0.5)*36; y+=(texRand()-0.5)*36; g.lineTo(x,y); }
    g.stroke();
  }
  const t = srgbTex(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeIceTex(){
  const [cv,g] = makeCanvas(256);
  g.fillStyle = '#d8eeff'; g.fillRect(0,0,256,256);
  // crystalline veins
  g.strokeStyle = 'rgba(180,210,240,0.25)'; g.lineWidth = 1.5; g.lineCap = 'round';
  for(let i=0;i<18;i++){
    let x = texRand()*256, y = texRand()*256;
    g.beginPath(); g.moveTo(x,y);
    for(let s=0;s<6;s++){ x+=(texRand()-0.5)*40; y+=(texRand()-0.5)*40; g.lineTo(x,y); }
    g.stroke();
  }
  // frosted variation
  const noise = valueNoise(256,8);
  const id = g.getImageData(0,0,256,256);
  const d = id.data;
  for(let y=0;y<256;y++) for(let x=0;x<256;x++){
    const n = noise(x,y);
    const o = (y*256+x)*4;
    const adj = 0.90 + 0.10*n;
    d[o]   = Math.min(255, d[o]*adj   | 0);
    d[o+1] = Math.min(255, d[o+1]*adj | 0);
    d[o+2] = Math.min(255, d[o+2]*(0.92 + 0.08*n) | 0);
  }
  g.putImageData(id,0,0);
  const t = srgbTex(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeWoodTex(){
  const [cv,g] = makeCanvas(256);
  g.fillStyle = '#8a5a2c'; g.fillRect(0,0,256,256);
  for(let i=0;i<200;i++){
    const y = texRand()*256;
    g.fillStyle = 'rgba(60,35,15,'+(0.1 + texRand()*0.15).toFixed(2)+')';
    g.fillRect(0, y, 256, 1+texRand()*4);
  }
  g.strokeStyle = 'rgba(40,20,8,0.2)'; g.lineWidth = 2;
  for(let i=0;i<8;i++){
    let y = texRand()*256;
    g.beginPath(); g.moveTo(0,y);
    g.bezierCurveTo(80, y+(texRand()-0.5)*30, 170, y+(texRand()-0.5)*30, 256, y);
    g.stroke();
  }
  const t = srgbTex(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeRugTex(){
  const [cv,g] = makeCanvas(256);
  g.fillStyle = '#7a1f1d'; g.fillRect(0,0,256,256);
  g.strokeStyle = '#d4af37'; g.lineWidth = 10; g.strokeRect(12,12,232,232);
  g.strokeStyle = '#2b1010'; g.lineWidth = 4; g.strokeRect(22,22,212,212);
  g.fillStyle = '#d4af37';
  g.beginPath(); g.arc(128,128,45,0,6.2832); g.fill();
  g.fillStyle = '#7a1f1d';
  g.beginPath(); g.arc(128,128,30,0,6.2832); g.fill();
  for(let i=0;i<4;i++){
    g.save(); g.translate(128,128); g.rotate(i*Math.PI/2);
    g.fillStyle = '#d4af37'; g.fillRect(55,-8,25,16); g.restore();
  }
  return srgbTex(cv);
}

function makeMagicCircleTex(){
  const [cv,g] = makeCanvas(256); g.translate(128,128); g.lineCap='round';
  g.strokeStyle='rgba(255,255,255,0.9)'; g.lineWidth=3.5;
  g.beginPath(); g.arc(0,0,110,0,6.2832); g.stroke();
  g.lineWidth=1.8; g.beginPath(); g.arc(0,0,96,0,6.2832); g.stroke();
  g.beginPath(); g.arc(0,0,45,0,6.2832); g.stroke();
  g.lineWidth=2;
  for(let k=0;k<2;k++){
    g.beginPath();
    for(let i=0;i<3;i++){
      const a = (k*Math.PI/3) + (i*2*Math.PI/3);
      const x = Math.cos(a)*95, y = Math.sin(a)*95;
      if(i===0) g.moveTo(x,y); else g.lineTo(x,y);
    }
    g.closePath(); g.stroke();
  }
  return srgbTex(cv);
}

function makeTapestryTex(){
  const [cv,g] = makeCanvas(128);
  g.fillStyle = '#2b3a52'; g.fillRect(0,0,128,128);
  g.fillStyle = '#c8a24a'; g.fillRect(0,0,128,10); g.fillRect(0,118,128,10);
  g.fillRect(8,0,6,128); g.fillRect(114,0,6,128);
  g.fillStyle = '#c8a24a';
  g.beginPath(); g.moveTo(64,30); g.lineTo(94,64); g.lineTo(64,98); g.lineTo(34,64); g.closePath(); g.fill();
  g.fillStyle = '#8a2b2b';
  g.beginPath(); g.arc(64,64,14,0,6.2832); g.fill();
  return srgbTex(cv);
}

function makeGoldSealTex(){
  const [cv,g] = makeCanvas(256); g.translate(128,128);
  g.strokeStyle='#d4af37'; g.lineWidth=4; g.beginPath(); g.arc(0,0,105,0,6.2832); g.stroke();
  g.strokeStyle='#8a6d1c'; g.lineWidth=2; g.beginPath(); g.arc(0,0,85,0,6.2832); g.stroke();
  for(let i=0;i<8;i++){
    g.save(); g.rotate(i*Math.PI/4); g.fillStyle='#d4af37';
    g.beginPath(); g.moveTo(0,-85); g.lineTo(12,-40); g.lineTo(-12,-40); g.closePath(); g.fill(); g.restore();
  }
  return srgbTex(cv);
}

function makeNecroCircleTex(){
  const [cv,g] = makeCanvas(256); g.translate(128,128);
  g.strokeStyle='#9fe66a'; g.lineWidth=3.5; g.beginPath(); g.arc(0,0,110,0,6.2832); g.stroke();
  g.lineWidth=1.5; g.beginPath(); g.arc(0,0,80,0,6.2832); g.stroke();
  g.beginPath();
  for(let i=0;i<5;i++){
    const a = i * Math.PI * 4 / 5 - Math.PI / 2;
    const x = Math.cos(a)*105, y = Math.sin(a)*105;
    if(i===0) g.moveTo(x,y); else g.lineTo(x,y);
  }
  g.closePath(); g.stroke();
  return srgbTex(cv);
}

function makeSporeCircleTex(){
  const [cv,g] = makeCanvas(256); g.translate(128,128);
  for(let i=0;i<36;i++){
    const a = i * Math.PI / 18, r = 80 + Math.sin(i*3)*20;
    const x = Math.cos(a)*r, y = Math.sin(a)*r;
    g.fillStyle = 'rgba(89,214,143,'+(0.4+0.4*Math.sin(i)).toFixed(2)+')';
    g.beginPath(); g.arc(x,y, 6 + (i%5)*3, 0, 6.2832); g.fill();
  }
  return srgbTex(cv);
}

function makeCampRingTex(){
  const [cv,g] = makeCanvas(256); g.translate(128,128);
  g.fillStyle = 'rgba(20,15,10,0.8)'; g.beginPath(); g.arc(0,0,90,0,6.2832); g.fill();
  g.fillStyle = 'rgba(255,140,40,0.3)'; g.beginPath(); g.arc(0,0,45,0,6.2832); g.fill();
  for(let i=0;i<12;i++){
    const a = i*Math.PI/6, x=Math.cos(a)*75, y=Math.sin(a)*75;
    g.fillStyle='#5a524a'; g.beginPath(); g.arc(x,y,14,0,6.2832); g.fill();
  }
  return srgbTex(cv);
}

function makeRegimentalBannerTex(){
  const [cv,g] = makeCanvas(128);
  g.fillStyle = '#1e3a5f'; g.fillRect(0,0,128,128);
  g.fillStyle = '#e0a24a'; g.fillRect(0,0,128,12); g.fillRect(0,116,128,12);
  g.fillStyle = '#e0a24a';
  g.beginPath(); g.arc(64,64,32,0,6.2832); g.fill();
  g.fillStyle = '#1e3a5f';
  g.beginPath(); g.arc(64,64,20,0,6.2832); g.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* `stops` root -> tip; `veins` [dark, light] blade strokes. The default is the
   living marsh green; makeDeadGrassTex passes boneyard's dry straw. */
function makeSwampGrassTex(stops = ['#1c2414', '#2b381b', '#445628', '#5e7235', '#788842'],
                           veins = ['rgba(18, 26, 12, 0.45)', 'rgba(130, 150, 75, 0.22)']){
  const [cv, g] = makeCanvas(128, 256);
  // Root to tip gradient: deep peat brown-green at roots -> rich olive marsh green -> weathered reed tips
  const grad = g.createLinearGradient(0, 256, 0, 0);
  [0.0, 0.20, 0.55, 0.85, 1.0].forEach((t, i) => grad.addColorStop(t, stops[i]));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);

  // Subtle reed vertical blade veins
  for (let x = 3; x < 128; x += 5) {
    g.strokeStyle = (x % 10 === 0) ? veins[0] : veins[1];
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  return srgbTex(cv);
}

function makeIvyTex(){
  const [cv, g] = makeCanvas(128, 256);
  g.clearRect(0, 0, 128, 256);
  // Main woody vine stems
  g.strokeStyle = '#382a1a';
  g.lineWidth = 2.4;
  g.beginPath();
  let vx = 64;
  g.moveTo(vx, 0);
  for(let y=12; y<=256; y+=18){
    vx += (texRand() - 0.5) * 16;
    g.lineTo(vx, y);
  }
  g.stroke();

  // Secondary wandering branches
  g.strokeStyle = '#483622';
  g.lineWidth = 1.5;
  for(let b=0; b<4; b++){
    let bx = 28 + texRand() * 72, by = texRand() * 110;
    g.beginPath(); g.moveTo(bx, by);
    for(let s=0; s<5; s++){
      bx += (texRand() - 0.45) * 20;
      by += 14 + texRand() * 16;
      g.lineTo(bx, by);
    }
    g.stroke();
  }

  // Clustered ivy leaves
  const leafColors = ['#2c4f24', '#3c6a30', '#4d823c', '#20401a', '#5a9446', '#6eaa52'];
  for(let i=0; i<80; i++){
    const lx = 12 + texRand() * 104;
    const ly = texRand() * 240;
    const sz = 3.5 + texRand() * 6.0;
    g.fillStyle = leafColors[(texRand() * leafColors.length) | 0];
    g.beginPath();
    g.ellipse(lx, ly, sz, sz * 1.35, (texRand() - 0.5) * 1.8, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(155, 205, 135, 0.45)';
    g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(lx, ly - sz*0.7); g.lineTo(lx, ly + sz*0.7); g.stroke();
  }
  return srgbTex(cv);
}

export const TEX = {
  stone: makeStoneTex(), stoneBump: makeStoneBumpTex(), crack: makeCrackTex(), rune: makeRuneTex(), swirl: makeSwirlTex(),
  mist: makeMistTex(), shaft: makeMistTex(), glow: makeGlowTex(), blot: makeBlotTex(), wood: makeWoodTex(),
  grass: makeGrassTex(), cliffRock: makeCliffRockTex(),
  rug: makeRugTex(), magicCircle: makeMagicCircleTex(), tapestry: makeTapestryTex(),
  goldSeal: makeGoldSealTex(), necroCircle: makeNecroCircleTex(), sporeCircle: makeSporeCircleTex(),
  campRing: makeCampRingTex(), regimentalBanner: makeRegimentalBannerTex(),
  metal: makeMetalTex(), ceramic: makeCeramicTex(), bone: makeBoneTex(), ice: makeIceTex(),
  web: makeWebTex(), swampGrass: makeSwampGrassTex(), ivy: makeIvyTex(),
  /* boneyard: grey-brown roots to bleached straw tips, a hint of olive left mid-blade */
  deadGrass: makeSwampGrassTex(['#1c1912', '#2c281d', '#4a4532', '#655c44', '#7e745c'],
                               ['rgba(22, 19, 13, 0.45)', 'rgba(150, 140, 110, 0.22)'])
};

/* ---------------- Material Kit ---------------- */
export const matIvy = new THREE.MeshStandardMaterial({
  map: TEX.ivy,
  transparent: true,
  alphaTest: 0.18,
  roughness: 0.82,
  metalness: 0.0,
  side: THREE.DoubleSide
});
export const matStone = new THREE.MeshStandardMaterial({
  map: TEX.stone,
  bumpMap: TEX.stoneBump,
  /* Joints in the ashlar sit ~160 levels under the face. Around 2.4 is
     enough for that step to read as a cut, without sparkling the dome. */
  bumpScale: 2.4,
  roughness: 0.88,
  metalness: 0.02
});
export const matWood = new THREE.MeshStandardMaterial({map:TEX.wood, roughness:0.82, metalness:0.04});
export const matMetal = new THREE.MeshStandardMaterial({map:TEX.metal, roughness:0.35, metalness:0.85});
export const matCeramic = new THREE.MeshStandardMaterial({map:TEX.ceramic, roughness:0.52, metalness:0.08});
export const matRug = new THREE.MeshStandardMaterial({map:TEX.rug, roughness:0.95, side:THREE.DoubleSide});
export const matMagicCircle = new THREE.MeshBasicMaterial({map:TEX.magicCircle, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide});
matMagicCircle.toneMapped = false;
export const matTapestry = new THREE.MeshLambertMaterial({map:TEX.tapestry, side:THREE.DoubleSide});
export const matSconce = new THREE.MeshStandardMaterial({map:TEX.metal, roughness:0.3, metalness:0.8});
export const matGoldInlay = new THREE.MeshStandardMaterial({map:TEX.goldSeal, roughness:0.25, metalness:0.85});
export const matGoldBullion = new THREE.MeshStandardMaterial({map:TEX.goldSeal, color:0xffd24d, roughness:0.22, metalness:0.90});
export const matSwampGrass = new THREE.MeshStandardMaterial({map:TEX.swampGrass, roughness:0.92, metalness:0.0, side:THREE.DoubleSide});
export const matDeadGrass = new THREE.MeshStandardMaterial({map:TEX.deadGrass, roughness:0.95, metalness:0.0, side:THREE.DoubleSide});
export const matNecroCircle = new THREE.MeshBasicMaterial({map:TEX.necroCircle, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide});
matNecroCircle.toneMapped = false;
export const matSporeCircle = new THREE.MeshBasicMaterial({map:TEX.sporeCircle, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide});
matSporeCircle.toneMapped = false;
export const matCampRing = new THREE.MeshStandardMaterial({map:TEX.campRing, roughness:0.9, transparent:true, side:THREE.DoubleSide});
export const matRegimentalBanner = new THREE.MeshLambertMaterial({map:TEX.regimentalBanner, side:THREE.DoubleSide});
export const matBoneStone = new THREE.MeshStandardMaterial({map:TEX.bone, roughness:0.85, metalness:0.05});
export const matBiolum = new THREE.MeshStandardMaterial({roughness:0.4, emissive:0x228b55, emissiveIntensity:0.5});
export const matGlacialIce = new THREE.MeshStandardMaterial({map:TEX.ice, roughness:0.1, metalness:0.1, transparent:true, opacity:0.85});

const FLAGTEX = makeAtlasTex(0), MASONTEX = makeAtlasTex(1);
export function atlasPatch(mat){
  mat.onBeforeCompile = sh => {
    sh.uniforms.uLuminanceBumpScale = {
      get value() { return (mat.bumpScale != null ? mat.bumpScale * 2.5 : 1.8); }
    };
    sh.uniforms.uLuminanceBumpStep = {
      get value() { return (mat.userData?.bumpStep != null ? mat.userData.bumpStep : 1.5); }
    };

    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aUvO;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = vMapUv * 0.5 + aUvO;
#endif
#ifdef USE_BUMPMAP
  vBumpMapUv = vBumpMapUv * 0.5 + aUvO;
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv = vNormalMapUv * 0.5 + aUvO;
#endif`);

    const lumChunk = `
#ifdef USE_MAP
uniform float uLuminanceBumpScale;
uniform float uLuminanceBumpStep;

mat3 getTileTangentFrame(vec3 eye_pos, vec3 surf_norm, vec2 uv) {
  vec3 q0 = dFdx(eye_pos.xyz);
  vec3 q1 = dFdy(eye_pos.xyz);
  vec2 st0 = dFdx(uv.st);
  vec2 st1 = dFdy(uv.st);
  vec3 N = surf_norm;
  vec3 q1perp = cross(q1, N);
  vec3 q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = (det == 0.0) ? 0.0 : inversesqrt(det);
  return mat3(T * scale, B * scale, N);
}

float getAtlasLuminance(vec2 uv) {
  vec4 col = texture2D(map, uv);
  return dot(col.rgb, vec3(0.299, 0.587, 0.114));
}

vec3 getLuminanceNormal(vec2 uv, vec3 eye_pos, vec3 surf_norm, float bScale, float bStep) {
  vec2 texSize = vec2(textureSize(map, 0));
  vec2 d = bStep / texSize;

  float tl = getAtlasLuminance(uv + vec2(-d.x,  d.y));
  float tc = getAtlasLuminance(uv + vec2( 0.0,  d.y));
  float tr = getAtlasLuminance(uv + vec2( d.x,  d.y));
  float ml = getAtlasLuminance(uv + vec2(-d.x,  0.0));
  float mr = getAtlasLuminance(uv + vec2( d.x,  0.0));
  float bl = getAtlasLuminance(uv + vec2(-d.x, -d.y));
  float bc = getAtlasLuminance(uv + vec2( 0.0, -d.y));
  float br = getAtlasLuminance(uv + vec2( d.x, -d.y));

  float dX = ((tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl)) * 0.25;
  float dY = ((tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br)) * 0.25;

  vec3 tNorm = normalize(vec3(-dX * bScale, -dY * bScale, 1.0));
  mat3 tbn = getTileTangentFrame(eye_pos, surf_norm, uv);
  return normalize(tbn * tNorm);
}
#endif
`;

    sh.fragmentShader = sh.fragmentShader
      .replace('#include <bumpmap_pars_fragment>', '#include <bumpmap_pars_fragment>\n' + lumChunk)
      .replace('#include <normal_fragment_maps>', `
#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_MAP )
	if (uLuminanceBumpScale > 0.001) {
		normal = getLuminanceNormal(vMapUv, -vViewPosition, normal, uLuminanceBumpScale, uLuminanceBumpStep);
	}
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`);
  };
  mat.customProgramCacheKey = () => 'atlas_lum_bump_tbn';
  return mat;
}

/* XY gain on the depth-built tangent normals. At 1 the light barely leaves
   the surface: a wall texel sits about 20 levels off flat, a prop texel about
   6. The depth image is not sampled again. This gain is how that relief
   reaches the light. Props take more because their maps are gentler. */
export const TILE_NORMAL_SCALE = 2.5;
export const PROP_NORMAL_SCALE = 4;

/* ---------------- Pixel-art tile atlases ----------------
   Baked 2x2 atlases (tools/build_tile_atlas.py) that stand in for the
   procedural flagstone/masonry above on a per-theme basis. Same layout, so the
   instanced `aUvO` quadrant picking and the per-cell theme tint are unchanged;
   only the map/bumpMap swap. A theme may also name a tangent normal. That
   replaces the luminance bump for that slot (the atlas shader prefers
   USE_NORMALMAP), so the two do not stack. Themes with no entry keep the
   procedural look. */
const PIXEL_TILES = {
  ancient: { floor:'./art/tiles/ancient_floor.png', floorBump:0.975,
             wall:'./art/tiles/ancient_wall.png',   wallBump:0.75,
             cap:'./art/tiles/ancient_cap.png',    capBump:0.65,
             wallNormal:'./art/tiles/ancient_wall_normal.png',
             capNormal:'./art/tiles/ancient_cap_normal.png',
             normalScale:TILE_NORMAL_SCALE },
  molten:  { floor:'./art/tiles/molten_floor.png',  floorBump:0.975,
             wall:'./art/tiles/molten_wall.png',    wallBump:0.75,
             cap:'./art/tiles/molten_cap.png',     capBump:0.65,
             wallNormal:'./art/tiles/molten_wall_normal.png',
             capNormal:'./art/tiles/molten_cap_normal.png',
             normalScale:TILE_NORMAL_SCALE },
  frost:   { floor:'./art/tiles/frost_floor.png',   floorBump:0.975,
             wall:'./art/tiles/frost_wall.png',     wallBump:0.75,
             cap:'./art/tiles/frost_cap.png',      capBump:0.65,
             wallNormal:'./art/tiles/frost_wall_normal.png',
             capNormal:'./art/tiles/frost_cap_normal.png',
             normalScale:TILE_NORMAL_SCALE },
  grim:    { floor:'./art/tiles/grim_floor.png',    floorBump:0.975,
             wall:'./art/tiles/grim_wall.png',      wallBump:0.75,
             cap:'./art/tiles/grim_cap.png',       capBump:0.65,
             /* PBRFusion 4 depth, Sobel normal, OpenGL +Y, snapped onto the
                32px grid. Floor passes smear the tile art, so floors stay on
                the luminance bump. */
             wallNormal:'./art/tiles/grim_wall_normal.png',
             capNormal:'./art/tiles/grim_cap_normal.png',
             normalScale:TILE_NORMAL_SCALE },
  verdant: { floor:'./art/tiles/verdant_floor.png', floorBump:0.975,
             wall:'./art/tiles/verdant_wall.png',   wallBump:0.75,
             cap:'./art/tiles/verdant_cap.png',    capBump:0.65,
             wallNormal:'./art/tiles/verdant_wall_normal.png',
             capNormal:'./art/tiles/verdant_cap_normal.png',
             normalScale:TILE_NORMAL_SCALE }
};
const _pixelTexCache = {};
function pixelTex(url, isBump){
  const key = url + (isBump ? '#b' : '');
  if(_pixelTexCache[key]) return _pixelTexCache[key];
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;      /* crisp pixels up close… */
  t.minFilter = THREE.LinearMipmapLinearFilter;  /* …but no shimmer at distance */
  t.anisotropy = 8;
  if(!isBump) t.colorSpace = THREE.SRGBColorSpace;
  _pixelTexCache[key] = t;
  return t;
}

/* Live texture override used by the dungeon editor: it bakes atlases in the
   browser and needs them to survive the applyTileTheme() call that every
   re-forge makes. Keys are floor/wall/cap, values {map, bump, bumpScale}. */
let tileOverride = null;
export function setTileOverride(o){ tileOverride = o; }

/* A tangent normal replaces the albedo luminance bump. Clearing it on a
   theme that has none matters: floor, wall and cap are shared materials.
   loadDataNormal is the same linear nearest map, for prop sidecars. */
export function loadDataNormal(url){
  return pixelTex(url, true);
}

function setSlotNormal(mat, url, scale){
  const next = url ? pixelTex(url, true) : null;
  if(mat.normalMap !== next){
    mat.normalMap = next;
    mat.needsUpdate = true;
  }
  /* Scale still applies when the same map is already on the shared material,
     otherwise a hotter gain never lands on a theme that was already showing. */
  if(next && scale != null) mat.normalScale.set(scale, scale);
}

/** Point the shared floor/wall materials at a theme's pixel atlas, if it has
 *  one. Called from buildScene before the level is assembled. */
export function applyTileTheme(themeKey){
  const P = PIXEL_TILES[themeKey] || {};
  if(P.floor){
    matFloor.map = pixelTex(P.floor);
    matFloor.bumpMap = pixelTex(P.floor.replace('.png','_bump.png'), true);
    matFloor.bumpScale = P.floorBump ?? 0.975;
  } else {
    matFloor.map = FLAGTEX.map;
    matFloor.bumpMap = FLAGTEX.bump;
    matFloor.bumpScale = 1.35;
  }
  setSlotNormal(matFloor, P.floorNormal, P.normalScale);
  if(P.wall){
    matWall.map = pixelTex(P.wall);
    matWall.bumpMap = pixelTex(P.wall.replace('.png','_bump.png'), true);
    matWall.bumpScale = P.wallBump ?? 0.75;
  } else {
    matWall.map = MASONTEX.map;
    matWall.bumpMap = MASONTEX.bump;
    matWall.bumpScale = 0.8;
  }
  setSlotNormal(matWall, P.wallNormal, P.normalScale);
  /* Wall tops read as the same masonry as the wall sides. They need their own
     atlas rather than sharing matWall's: wall atlases are baked with --stack 2
     to keep tiles square on a 2-unit-tall wall face, and a cap is a flat slab
     whose UVs span the quadrant, so it would show both stacked tiles squashed
     into one cell. The cap atlas is the same source tiles, unstacked. */
  if(P.cap){
    matWallCap.map = pixelTex(P.cap);
    matWallCap.bumpMap = pixelTex(P.cap.replace('.png','_bump.png'), true);
    matWallCap.bumpScale = P.capBump ?? 0.65;
  } else {
    matWallCap.map = MASONTEX.map;
    matWallCap.bumpMap = MASONTEX.bump;
    matWallCap.bumpScale = 0.8;
  }
  setSlotNormal(matWallCap, P.capNormal, P.normalScale);
  matStone.map = TEX.stone;
  matStone.bumpMap = TEX.stoneBump;
  matStone.bumpScale = 0.012;
  if(tileOverride){
    for(const [slot, mat] of [['floor',matFloor], ['wall',matWall], ['cap',matWallCap]]){
      const o = tileOverride[slot];
      if(!o || !o.map) continue;
      mat.map = o.map;
      if(o.bump) mat.bumpMap = o.bump;
      if(o.bumpScale != null) mat.bumpScale = (slot === 'floor' ? o.bumpScale * 1.5 : o.bumpScale);
      setSlotNormal(mat, o.normal || null, o.normalScale);
    }
  }
}

export const matFloor = atlasPatch(new THREE.MeshStandardMaterial({map:FLAGTEX.map, bumpMap:FLAGTEX.bump, bumpScale:1.35, roughness:0.84, metalness:0.02}));
export const matWall  = atlasPatch(new THREE.MeshStandardMaterial({map:MASONTEX.map, bumpMap:MASONTEX.bump, bumpScale:0.8, roughness:0.86, metalness:0.02, polygonOffset:true, polygonOffsetFactor:2, polygonOffsetUnits:5000}));
export const matWallCap = atlasPatch(new THREE.MeshStandardMaterial({map:MASONTEX.map, bumpMap:MASONTEX.bump, bumpScale:0.8, roughness:0.86, metalness:0.02}));
export const matTrim  = new THREE.MeshStandardMaterial({roughness:0.38, metalness:0.75, polygonOffset:true, polygonOffsetFactor:2, polygonOffsetUnits:5000});
export const matGlow  = new THREE.MeshBasicMaterial({color:0xffffff});
matGlow.toneMapped = false;
export const matCloth = new THREE.MeshLambertMaterial({side:THREE.DoubleSide});
export const matIce   = new THREE.MeshStandardMaterial({roughness:0.16, metalness:0.02, transparent:true, opacity:0.88});
export const matBark  = new THREE.MeshStandardMaterial({map:TEX.wood, roughness:0.88, metalness:0.04});
export const matGrass = new THREE.MeshStandardMaterial({map:TEX.grass, color:0xa2bf86, roughness:0.92, metalness:0});
matGrass.onBeforeCompile = (shader) => {
  shader.uniforms.uCliffRockMap = { value: TEX.cliffRock };
  shader.vertexShader = shader.vertexShader.replace(
    '#include <common>',
    `#include <common>
     varying vec3 vWorldNormal;
     varying vec3 vWorldPos;`
  ).replace(
    '#include <worldpos_vertex>',
    `#include <worldpos_vertex>
     vWorldNormal = normalize(mat3(modelMatrix) * normal);
     vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
  );

  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
     uniform sampler2D uCliffRockMap;
     varying vec3 vWorldNormal;
     varying vec3 vWorldPos;`
  ).replace(
    '#include <map_fragment>',
    `#ifdef USE_MAP
       vec4 grassTex = texture2D(map, vMapUv);
       // World-space coordinates for natural horizontal rock strata on cliff faces
       vec2 rockUv = vec2((vWorldPos.x + vWorldPos.z) * 0.75, vWorldPos.y * 1.35);
       vec4 rockTex = texture2D(uCliffRockMap, rockUv);

       // Top horizontal faces (normal.y near 1.0) stay lush green turf.
       // Vertical cliff sides and risers (normal.y near 0.0) display natural rock strata.
       float cliffFactor = 1.0 - smoothstep(0.40, 0.78, abs(vWorldNormal.y));
       // Warm earthy stone tone matching HD-2D diorama references
       vec4 stoneTone = rockTex * vec4(1.06, 1.02, 0.94, 1.0);
       vec4 diffuseTex = mix(grassTex, stoneTone, cliffFactor);
       diffuseColor *= diffuseTex;
     #endif`
  );
};
matGrass.customProgramCacheKey = () => 'grass_cliff_rock_strata';

/* Overland ground baked from tiles (themes with `groundTiles`, e.g. holdfast's
   dirt road): ONE texture covering the whole map, sampled on top faces by
   world XZ, so the floor boxes' own UVs, rotations and stair treads don't
   matter. Cliff sides keep matGrass's rock strata.
   The uniforms are shared objects: setGroundTiles swaps the texture and the
   map rectangle per floor without recompiling the shader. */
/* Shown until a floor's bake lands: flat muted turf, so the first frames read
   as grass rather than black. */
const GROUND_TILES_FALLBACK = new THREE.DataTexture(new Uint8Array([88, 104, 62, 255]), 1, 1);
GROUND_TILES_FALLBACK.colorSpace = THREE.SRGBColorSpace;
GROUND_TILES_FALLBACK.needsUpdate = true;
/* Cliff sides: the DCSS stony-earth tile the road is made of, one tile per
   world unit, graded like the bake and shaded down as a bank in shadow. The
   procedural strata (TEX.cliffRock) read as striped brick here: in world
   space its eight bands repeat every ~0.09 tiles, and without the biome tint
   it shows in raw orange. */
const GROUND_SIDE_URL = './art/ground/grass/grass_full.png';
const groundTileUniforms = {
  uGroundSide:  { value: GROUND_TILES_FALLBACK },          // loaded on first use (setGroundTiles)
  uGroundTiles: { value: GROUND_TILES_FALLBACK },
  uGroundRect:  { value: new THREE.Vector4(0, 0, 1, 1) },  // x0, z0, width, depth in world units
  uGroundGrade: { value: new THREE.Vector2(1, 1) }          // saturation, brightness (theme groundTiles)
};
export const matGroundTiles = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
matGroundTiles.onBeforeCompile = (shader) => {
  shader.uniforms.uGroundSide = groundTileUniforms.uGroundSide;
  shader.uniforms.uGroundTiles = groundTileUniforms.uGroundTiles;
  shader.uniforms.uGroundRect = groundTileUniforms.uGroundRect;
  shader.uniforms.uGroundGrade = groundTileUniforms.uGroundGrade;
  shader.vertexShader = shader.vertexShader.replace(
    '#include <common>',
    `#include <common>
     varying vec3 vGtNormal;
     varying vec3 vGtPos;`
  ).replace(
    '#include <worldpos_vertex>',
    `#include <worldpos_vertex>
     {
       vec4 gp = vec4(transformed, 1.0);
       vec3 gn = normal;
       #ifdef USE_INSTANCING
         gp = instanceMatrix * gp;
         gn = mat3(instanceMatrix) * gn;
       #endif
       vGtPos = (modelMatrix * gp).xyz;
       vGtNormal = normalize(mat3(modelMatrix) * gn);
     }`
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
     uniform sampler2D uGroundSide;
     uniform sampler2D uGroundTiles;
     uniform vec4 uGroundRect;
     uniform vec2 uGroundGrade;
     varying vec3 vGtNormal;
     varying vec3 vGtPos;`
  ).replace(
    '#include <map_fragment>',
    `{
       vec2 gUv = (vGtPos.xz - uGroundRect.xy) / uGroundRect.zw;
       vec4 groundTex = texture2D(uGroundTiles, gUv);
       /* banks: stony earth, a tile per world unit, graded like the bake
          (saturate + brightness) and darkened as ground under an overhang */
       vec4 side = texture2D(uGroundSide, vec2(vGtPos.x + vGtPos.z, -vGtPos.y));
       float sl = dot(side.rgb, vec3(0.299, 0.587, 0.114));
       side.rgb = mix(vec3(sl), side.rgb, uGroundGrade.x) * uGroundGrade.y * 0.68;
       float cliffFactor = 1.0 - smoothstep(0.40, 0.78, abs(vGtNormal.y));
       diffuseColor *= mix(groundTex, side, cliffFactor);
     }`
  );
};
matGroundTiles.customProgramCacheKey = () => 'ground_tiles_world_xz_earth_banks';

/** Point matGroundTiles at a baked ground texture covering the map rectangle
 *  starting at world (x0, z0), `w` × `d` units. `tex` null = the flat fallback
 *  (used while a bake is in flight). The previous bake is disposed. */
export function setGroundTiles(tex, x0, z0, w, d, grade = null) {
  const next = tex || GROUND_TILES_FALLBACK;
  const old = groundTileUniforms.uGroundTiles.value;
  if (old && old !== next && old !== GROUND_TILES_FALLBACK) old.dispose();
  groundTileUniforms.uGroundTiles.value = next;
  if (grade) groundTileUniforms.uGroundGrade.value.set(grade.sat ?? 1, grade.bright ?? 1);
  if (groundTileUniforms.uGroundSide.value === GROUND_TILES_FALLBACK) {
    const side = new THREE.TextureLoader().load(GROUND_SIDE_URL);
    side.wrapS = side.wrapT = THREE.RepeatWrapping;
    side.magFilter = THREE.NearestFilter;
    side.colorSpace = THREE.SRGBColorSpace;
    groundTileUniforms.uGroundSide.value = side;
  }
  groundTileUniforms.uGroundRect.value.set(x0, z0, w, d);
}
export const matLeaf  = new THREE.MeshStandardMaterial({map:TEX.swirl, roughness:0.75, metalness:0.02});
export const matCrackD = new THREE.MeshBasicMaterial({map:TEX.crack, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false});
matCrackD.toneMapped = false;
export const matRune  = new THREE.MeshBasicMaterial({map:TEX.rune, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide});
matRune.toneMapped = false;
export const matPortal= new THREE.MeshBasicMaterial({map:TEX.swirl, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false});
matPortal.toneMapped = false;
/* ── fog vs terrain height ──
   Both fog layers are flat sheets. Where the ground rises through one (a
   raised tier, a dais, the foot of a wall) the sheet used to slice the
   geometry along a hard line. Each level now bakes a small height field —
   the walkable surface per cell, walls standing a little above their floor,
   lightly blurred — and the fog thins out as the ground beneath a fragment
   climbs toward the sheet. The same field is read on the CPU so a unit's
   legs fog by the same amount the sheet shows around them. */
const FOG_H_MIN = -2, FOG_H_RANGE = 6;          // byte encoding: y = r * RANGE + MIN
export const FOG_FADE = 0.1;                    // fog thins over the last this-much of clearance (sheets sit 0.16+ up)
export const fogHeightUniforms = {
  tFogH: { value: null },
  uFogHSize: { value: new THREE.Vector2(1, 1) },
  uFogHOn: { value: 0 }
};
let _fogField = null;

/** heights: Float32Array W*H of ground y per cell (already blurred). */
export function setFogHeightField(W, H, heights) {
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const r = Math.max(0, Math.min(255, Math.round((heights[i] - FOG_H_MIN) / FOG_H_RANGE * 255)));
    data[i * 4] = r; data[i * 4 + 1] = r; data[i * 4 + 2] = r; data[i * 4 + 3] = 255;
  }
  const old = fogHeightUniforms.tFogH.value;
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  fogHeightUniforms.tFogH.value = tex;
  fogHeightUniforms.uFogHSize.value.set(W, H);
  fogHeightUniforms.uFogHOn.value = 1;
  if (old) old.dispose();
  /* keep the quantised values, so the CPU reads what the GPU reads */
  const q = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) q[i] = data[i * 4] / 255 * FOG_H_RANGE + FOG_H_MIN;
  _fogField = { W, H, h: q };
}

/** Ground height under world (x, z), bilinear like the texture; null off-map. */
export function fogGroundAt(x, z) {
  const f = _fogField;
  if (!f) return null;
  const u = x + f.W / 2 - 0.5, v = z + f.H / 2 - 0.5;   // texel-centre space
  if (u < -0.5 || v < -0.5 || u > f.W - 0.5 || v > f.H - 0.5) return null;
  const x0 = Math.max(0, Math.min(f.W - 1, Math.floor(u))), y0 = Math.max(0, Math.min(f.H - 1, Math.floor(v)));
  const x1 = Math.min(f.W - 1, x0 + 1), y1 = Math.min(f.H - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, u - x0)), ty = Math.max(0, Math.min(1, v - y0));
  const a = f.h[y0 * f.W + x0], b = f.h[y0 * f.W + x1], c = f.h[y1 * f.W + x0], d = f.h[y1 * f.W + x1];
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

/** How much of a fog sheet at height `sheetY` survives over world (x, z). */
export function fogClearance(x, z, sheetY) {
  const g = fogGroundAt(x, z);
  if (g === null) return 1;
  const t = Math.max(0, Math.min(1, (sheetY - g) / FOG_FADE));
  return t * t * (3 - 2 * t);
}

const FOG_H_GLSL = `
      uniform sampler2D tFogH;
      uniform vec2 uFogHSize;
      uniform float uFogHOn;
      float fogClearance(vec3 wp) {
        if (uFogHOn < 0.5) return 1.0;
        vec2 uv = (wp.xz + uFogHSize * 0.5) / uFogHSize;
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
        float g = texture2D(tFogH, uv).r * ${FOG_H_RANGE.toFixed(1)} + (${FOG_H_MIN.toFixed(1)});
        return smoothstep(0.0, ${FOG_FADE.toFixed(2)}, wp.y - g);
      }
`;

export function createMistMaterial(color = 0xdde8d0, opacity = 0.35) {
  const c = new THREE.Color(color);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: c },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
      tMap: { value: TEX.mist },
      ...fogHeightUniforms
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      uniform sampler2D tMap;
      varying vec2 vUv;
      varying vec3 vWorld;
      ${FOG_H_GLSL}

      void main() {
        // Two non-commensurate scrolling UV layers for fluid organic mist drift
        vec2 uv1 = vUv * 1.15 + vec2(uTime * 0.018, uTime * 0.009);
        vec2 uv2 = vUv * 1.65 - vec2(uTime * 0.013, -uTime * 0.016);
        float a1 = texture2D(tMap, uv1).a;
        float a2 = texture2D(tMap, uv2).a;
        float mist = a1 * 0.58 + a2 * 0.42;

        // Smooth radial edge falloff so plane boundaries dissolve seamlessly
        float dist = length(vUv - 0.5) * 2.0;
        float edge = smoothstep(1.0, 0.40, dist);

        float a = mist * edge * uOpacity * fogClearance(vWorld);
        if (a <= 0.002) discard;

        vec3 col = uColor * (0.92 + 0.18 * mist);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide
  });
  mat.toneMapped = false;
  Object.defineProperty(mat, 'color', {
    get() { return this.uniforms.uColor.value; },
    set(v) { this.uniforms.uColor.value.set(v); }
  });
  Object.defineProperty(mat, 'opacity', {
    get() { return this.uniforms.uOpacity.value; },
    set(v) { this.uniforms.uOpacity.value = v; }
  });
  return mat;
}
export const matMist = createMistMaterial(0xdde8d0, 0.35);
export const matShaft = matMist;
export function createGodRayMaterial(color = 0xfff0cc, opacity = 0.36) {
  const c = new THREE.Color(color);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: c },
      uOpacity: { value: opacity },
      uTime: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPos.xyz;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        // Vertical envelope: 0.0 at base, peak mid-air, smooth fade to 0.0 at top
        float vertEnv = sin(clamp(vUv.y, 0.0, 1.0) * 3.14159);
        vertEnv = pow(vertEnv, 0.70);

        // Crepuscular ray streamers undulating around the cone circumference
        float ray1 = sin(vUv.x * 25.13 + uTime * 0.14) * 0.5 + 0.5;
        float ray2 = cos(vUv.x * 43.98 - uTime * 0.19) * 0.5 + 0.5;
        float rayStreamers = 0.52 + 0.48 * (ray1 * 0.6 + ray2 * 0.4);

        // View-angle limb darkening / Fresnel so cone edges dissolve into thin air
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);
        float rim = 1.0 - abs(dot(normal, viewDir));
        rim = smoothstep(0.0, 0.55, rim);

        float a = vertEnv * rayStreamers * rim * uOpacity;
        if (a < 0.001) discard;

        vec3 col = uColor * (1.15 + 0.35 * rayStreamers);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  mat.toneMapped = false;
  Object.defineProperty(mat, 'color', {
    get() { return this.uniforms.uColor.value; },
    set(v) { this.uniforms.uColor.value.set(v); }
  });
  Object.defineProperty(mat, 'opacity', {
    get() { return this.uniforms.uOpacity.value; },
    set(v) { this.uniforms.uOpacity.value = v; }
  });
  return mat;
}
export const matSkirt = new THREE.MeshBasicMaterial({map:TEX.glow, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, opacity:0.5});
matSkirt.toneMapped = false;
export const matRuneSeal = new THREE.MeshBasicMaterial({map:TEX.rune, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, opacity:0.55});
matRuneSeal.toneMapped = false;
export const matEmber = new THREE.MeshBasicMaterial({map:TEX.crack, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false});
matEmber.toneMapped = false;
export const matBlot    = new THREE.MeshBasicMaterial({map:TEX.blot, transparent:true, depthWrite:false, opacity:0.5});
export const matBlotAdd = new THREE.MeshBasicMaterial({map:TEX.blot, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, opacity:0.4});
matBlotAdd.toneMapped = false;
export const matWeb = new THREE.MeshBasicMaterial({map:TEX.web, transparent:true, opacity:0.85, side:THREE.DoubleSide, depthWrite:false});
matWeb.toneMapped = false;

/* liquid surface shader: lava / ice / water / miasma via uMode */
export const liquidMat = new THREE.ShaderMaterial({
  transparent:true, depthWrite:false,
  uniforms:{ uTime:{value:0}, uMode:{value:0}, uGlow:{value:1}, uOp:{value:1},
             uColA:{value:new THREE.Color(0x000000)}, uColB:{value:new THREE.Color(0xffffff)} },
  vertexShader:`
    attribute vec2 aE;
    attribute vec4 aM;
    varying vec2 vP, vE;
    varying vec4 vM;
    void main(){ vP = vec2(position.x, position.z); vE = aE; vM = aM;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader:`
    precision highp float;
    varying vec2 vP, vE;
    varying vec4 vM;
    uniform float uTime, uMode, uGlow, uOp;
    uniform vec3 uColA, uColB;
    float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      float a=h21(i), b=h21(i+vec2(1,0)), c=h21(i+vec2(0,1)), d=h21(i+vec2(1,1));
      return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
    float fbm(vec2 p){ float v=0.0, a=0.5;
      for(int i=0;i<4;i++){ v+=a*vnoise(p); p=p*2.03+11.7; a*=0.5; } return v; }
    void main(){
      vec3 col;
      if(uMode < 0.5){
        vec2 uv = vP * 0.55;
        float flowTime = uTime * 0.05;
        vec2 distortion = vec2(
          fbm(uv + vec2(flowTime, flowTime * 0.5)),
          fbm(uv - vec2(flowTime * 0.7, flowTime * 0.4))
        );
        vec2 p = uv + distortion * 0.35;
        float n = fbm(p + vec2(flowTime * 0.4, flowTime * 0.25));
        float crust = smoothstep(0.38, 0.64, n);
        float veins = smoothstep(0.08, 0.0, abs(n - 0.5));

        // Magma bubble burst / barrage hotspots that pop on the lava surface
        vec2 bUv = vP * 1.5;
        float bTime = uTime * 1.4;
        vec2 bCell = floor(bUv);
        float bRnd = h21(bCell);
        vec2 bFrac = fract(bUv) - 0.5;
        float bDist = length(bFrac);
        float bPhase = fract(bTime * (0.35 + 0.45 * bRnd) + bRnd);
        float bRadius = 0.16 + 0.22 * sin(bPhase * 3.14159);
        float bubbleGlow = smoothstep(bRadius, 0.0, bDist) * smoothstep(0.0, 0.25, bPhase) * smoothstep(1.0, 0.65, bPhase);

        col = mix(uColB * 1.85, uColA * 0.75, crust);
        col += vec3(1.0, 0.75, 0.30) * veins * 1.2;
        col += vec3(1.0, 0.96, 0.65) * bubbleGlow * 1.8;
        col += uColB * 0.35 * (0.5 + 0.5 * sin(uTime * 2.2 + n * 22.0));
      } else if(uMode < 1.5){
        float n = fbm(vP*0.8);
        float cr = smoothstep(0.47, 0.5, abs(fract(n*6.0)-0.5));
        col = mix(uColA, uColB, n);
        col += vec3(1.0) * cr * 0.16;
        float tw = step(0.994, h21(floor(vP*3.0) + floor(uTime*2.0)));
        col += vec3(0.8,0.95,1.0) * tw * 0.45;
      } else if(uMode < 2.5){
        float n = fbm(vP*0.7 + vec2(uTime*0.05, -uTime*0.035));
        float n2 = fbm(vP*1.3 - vec2(uTime*0.04, uTime*0.05));
        float caust = pow(1.0 - abs(n - n2), 6.0);
        col = mix(uColA, uColB, n*0.85) + vec3(0.5,0.9,0.8)*caust*0.35;
      } else {
        vec2 w = vP + 1.5*vec2(fbm(vP*0.35 + uTime*0.02), fbm(vP*0.35 - uTime*0.016));
        float n = fbm(w*0.5);
        col = mix(uColA, uColB, smoothstep(0.25, 0.75, n));
        col += uColB * 0.3 * smoothstep(0.6, 0.9, n);
      }
      float e = 0.0;
      e = max(e, vM.x * smoothstep(0.26, 0.5, -vE.x));
      e = max(e, vM.y * smoothstep(0.26, 0.5,  vE.x));
      e = max(e, vM.z * smoothstep(0.26, 0.5, -vE.y));
      e = max(e, vM.w * smoothstep(0.26, 0.5,  vE.y));
      float aOut = uOp;
      if(uMode < 0.5)      col = mix(col, vec3(0.10,0.03,0.01), e*0.85);
      else if(uMode < 1.5) col *= (1.0 - 0.25*e);
      else if(uMode < 2.5) col *= (1.0 - 0.4*e);
      else                 aOut *= (1.0 - 0.55*e);
      gl_FragColor = vec4(col * (0.5 + uGlow), aOut);
    }`
});

/* ambient particle field: dust / embers / snow / wisps / spores (GPU) */
export const partMat = new THREE.ShaderMaterial({
  transparent:true, depthWrite:false, depthTest:true, blending:THREE.AdditiveBlending,
  uniforms:{ uTime:{value:0}, uRamp:{value:1}, uZoom:{value:10}, uKind:{value:0},
             uColor:{value:new THREE.Color(0xffffff)} },
  vertexShader:`
    precision highp float;
    attribute float aSeed;
    uniform float uTime, uRamp, uZoom, uKind;
    uniform vec3 uColor;
    varying float vA;
    varying float vKind;
    varying vec3 vColor;
    float h(float n){ return fract(sin(n*127.1)*43758.5453); }
    void main(){
      vec3 p = position;
      float s = aSeed, t, sz;
      vKind = uKind;
      vColor = uColor;
      if(uKind < 0.5){            /* dust motes in light shafts */
        sz = 1.5 + 1.5*h(s+3.1);
        p.x += sin(uTime*0.10 + s*17.0)*0.25;
        p.z += cos(uTime*0.08 + s*23.0)*0.25;
        p.y += 0.25*sin(uTime*0.13 + s*31.0);
        vA = 0.20 + 0.10*sin(uTime*0.5 + s*40.0);
      } else if(uKind < 1.5){     /* erupting ember & magma spark barrage rising off lava + flames */
        float pSeed = h(s+3.1);
        sz = 2.4 + 3.2 * pSeed;
        if(pSeed > 0.82) sz += 2.4; /* popping larger cinder */
        float speed = 0.18 + 0.18 * h(s+7.4);
        t = fract(uTime * speed + s);
        float arcX = (h(s+12.0) - 0.5) * 1.5;
        float arcZ = (h(s+19.0) - 0.5) * 1.5;
        p.y += pow(t, 0.72) * (1.9 + 1.5 * h(s+5.0));
        p.x += arcX * t + sin(t * 11.0 + s * 50.0) * 0.18;
        p.z += arcZ * t + cos(t * 10.0 + s * 60.0) * 0.18;
        float sparkBurst = smoothstep(0.0, 0.08, t) * (1.0 - t * 0.85);
        float pulse = 0.75 + 0.35 * sin(uTime * 14.0 + s * 90.0);
        vA = sparkBurst * pulse;
      } else if(uKind < 2.5){     /* snowfall / blizzard flurry */
        float flakeSeed = h(s+3.1);
        sz = 2.2 + 2.6 * flakeSeed;
        if(flakeSeed > 0.82) sz += 1.8; /* occasional larger snowflake (5.5-6.5px) */
        float fallSpd = mix(0.24, 0.14, flakeSeed) + 0.03 * h(s+7.2);
        t = fract(uTime * fallSpd + s);
        p.y += (1.0 - t) * 6.5 - 0.2;
        float windGust = sin(uTime * 0.5 + p.y * 0.35) * 0.5;
        p.x += -t * 2.2 + sin(uTime * 0.85 + s * 28.0) * 0.35 + windGust;
        p.z += -t * 1.2 + cos(uTime * 0.75 + s * 34.0) * 0.35 + windGust * 0.5;
        vA = (0.70 + 0.25 * flakeSeed) * smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.88, t);
      } else if(uKind < 3.5){     /* wisps hovering over graves/candles */
        sz = 4.0 + 3.0*h(s+3.1);
        p.x += sin(uTime*0.25 + s*44.0)*0.35;
        p.z += cos(uTime*0.21 + s*52.0)*0.35;
        p.y += 0.40 + 0.30*sin(uTime*0.4 + s*20.0);
        vA = 0.35 + 0.20*sin(uTime*1.3 + s*70.0);
      } else if(uKind < 4.5){     /* spores drifting off moss/roots */
        sz = 2.0 + 2.0*h(s+3.1);
        t = fract(uTime*0.03*(0.6 + h(s)) + s);
        p.y += t*1.4 + 0.08;
        p.x += sin(uTime*0.35 + s*25.0)*0.3;
        p.z += cos(uTime*0.3 + s*29.0)*0.3;
        vA = 0.55*smoothstep(0.0,0.08,t)*(1.0-t);
      } else if(uKind < 5.5){     /* rain streaks */
        sz = 3.5 + 2.5*h(s+3.1);
        t = fract(uTime*(0.60 + 0.20*h(s)) + s);
        p.y += (1.0-t)*7.0 - 0.3;
        p.x += -t*2.8 + sin(uTime*0.4 + s*22.0)*0.1;
        p.z += -t*1.8 + cos(uTime*0.35 + s*28.0)*0.1;
        vA = 0.65 * smoothstep(0.0, 0.05, t) * smoothstep(1.0, 0.92, t);
      } else if(uKind < 6.5){     /* volcanic ashfall / cinders */
        sz = 2.0 + 2.5*h(s+3.1);
        t = fract(uTime*(0.08 + 0.04*h(s)) + s);
        p.y += (1.0-t)*5.0;
        p.x += sin(uTime*0.45 + s*35.0)*0.45 + (t-0.5)*1.8;
        p.z += cos(uTime*0.4 + s*42.0)*0.45 + (t-0.5)*1.2;
        vA = 0.65 * smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.92, t);
      } else if(uKind < 7.5){     /* blizzard: dense, fast, wind-driven, mostly sideways */
        float fs = h(s+3.1);
        sz = 1.6 + 3.0 * fs;
        if(fs > 0.88) sz += 2.0;                         /* a few big clumps close to the eye */
        t = fract(uTime * (0.38 + 0.30 * h(s+7.2)) + s); /* ~1.5-2.6 s across the view */
        float gust = 1.0 + 0.55 * sin(uTime * 0.9 + position.x * 0.06 + position.z * 0.04);
        p.y += (1.0 - t) * 4.2 - 0.1;
        p.x += (t - 0.5) * 9.0 * gust;
        p.z += (t - 0.5) * 4.2 * gust;
        /* eddies: flakes tumble around the wind line instead of riding it */
        p.x += sin(uTime * 3.1 + s * 41.0) * 0.30;
        p.y += sin(uTime * 2.3 + s * 57.0) * 0.22;
        p.z += cos(uTime * 2.7 + s * 33.0) * 0.30;
        vA = (0.62 + 0.30 * fs) * smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.86, t);
      } else {                    /* default ambient fallback */
        sz = 2.0 + 2.0*h(s+3.1);
        p.x += sin(uTime*0.2 + s*17.0)*0.2;
        p.z += cos(uTime*0.2 + s*23.0)*0.2;
        p.y += 0.2*sin(uTime*0.25 + s*31.0);
        vA = 0.25;
      }
      vA *= uRamp;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = clamp(sz * (uZoom * 0.1), 1.5, 9.0);
    }`,
  fragmentShader:`
    precision highp float;
    varying float vA;
    varying float vKind;
    varying vec3 vColor;
    void main(){
      vec2 uv = gl_PointCoord - 0.5;
      float d;
      if(vKind > 4.5 && vKind < 5.5){
        uv.x += uv.y * 0.40;
        d = length(vec2(uv.x * 4.0, uv.y * 0.8));
      } else {
        d = length(uv);
      }
      if(d > 0.5) discard;
      float a;
      vec3 col = vColor;
      if(vKind < 1.5){
        a = smoothstep(0.5, 0.05, d) * vA;
        col = mix(vec3(1.0, 0.96, 0.72), vColor * 1.4, smoothstep(0.0, 0.42, d));
      } else if(vKind > 1.5 && vKind < 2.5){
        a = smoothstep(0.5, 0.10, d) * vA;
        col = mix(vec3(0.88, 0.94, 1.0), vColor, 0.15);
      } else if(vKind > 5.5 && vKind < 6.5){
        a = smoothstep(0.5, 0.12, d) * vA;
      } else if(vKind > 6.5 && vKind < 7.5){
        /* blizzard: firm white core so flakes read against snow (normal blend) */
        a = smoothstep(0.5, 0.22, d) * vA;
        col = mix(vec3(0.97, 0.99, 1.0), vColor, 0.10);
      } else {
        a = smoothstep(0.5, 0.0, d) * vA;
      }
      if(a < 0.01) discard;
      gl_FragColor = vec4(col, a);
    }`
});
partMat.toneMapped = false;

/* rolling ground fog / low-lying mist layer shader */
export const fogPlaneMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  uniforms: {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0xdde4db) },
    uDensity: { value: 0.24 },
    uSpeed: { value: 0.035 },
    uScale: { value: 0.12 },
    ...fogHeightUniforms
  },
  vertexShader: `
    varying vec2 vWorldPos;
    varying float vWorldY;
    varying vec2 vUv;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xz;
      vWorldY = wp.y;
      vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec2 vWorldPos;
    varying float vWorldY;
    varying vec2 vUv;
    uniform float uTime, uDensity, uSpeed, uScale;
    uniform vec3 uColor;
    ${FOG_H_GLSL}

    float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float vnoise(vec2 p){
      vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      float a=h21(i), b=h21(i+vec2(1,0)), c=h21(i+vec2(0,1)), d=h21(i+vec2(1,1));
      return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
    }
    float fbm(vec2 p){
      float v=0.0, a=0.625;
      for(int i=0;i<2;i++){ v+=a*vnoise(p); p=p*2.03+11.7; a*=0.5; }
      return v;
    }

    void main(){
      vec2 wp = vWorldPos * uScale;
      // Multi-layer wind drift: sweeping diagonal highland breeze + micro swirls
      vec2 drift1 = vec2(uTime * uSpeed * 1.6, uTime * uSpeed * 0.95);
      vec2 drift2 = vec2(-uTime * uSpeed * 0.6, uTime * uSpeed * 1.3) + vec2(17.3, 42.1);
      
      // Domain warping for organic wisps and drifting fingers of fog
      float q1 = fbm(wp * 0.85 + drift1);
      float q2 = fbm(wp * 0.85 + drift2);
      vec2 warped = wp + vec2(q1, q2) * 1.8;

      float n1 = fbm(warped + drift1 * 0.5);
      float n2 = fbm(warped * 1.6 - drift2 * 0.7);

      float rawVal = n1 * 0.63 + n2 * 0.37;

      // High-contrast threshold: wide clear areas (rawVal < 0.48 are 100% transparent),
      // rolling mist banks form above 0.48 with wispy feathering up to 0.72.
      float patchMask = smoothstep(0.48, 0.72, rawVal);

      // Subtle edge wisps within the fog patches
      float wisps = 0.85 + 0.15 * sin(uTime * 0.4 + n2 * 8.0);

      // Edge fade against the outer perimeter of the plane so it blends smoothly into scene fog
      float edgeX = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
      float edgeY = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
      float edgeFade = edgeX * edgeY;

      float alpha = patchMask * uDensity * wisps * edgeFade * fogClearance(vec3(vWorldPos.x, vWorldY, vWorldPos.y));
      if (alpha < 0.003) discard;
      gl_FragColor = vec4(uColor, alpha);
    }
  `
});
fogPlaneMat.toneMapped = false;

/* ---------------- Post-Processing Pipeline Setup ---------------- */
export const POST = (()=>{
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1,-1,0, 3,-1,0, -1,3,0]),3));
  const qcam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const mkScene = mat => { const s=new THREE.Scene(); s.add(new THREE.Mesh(tri, mat)); return s; };
  const V = `varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const thresh = new THREE.ShaderMaterial({ uniforms:{ tS:{value:null} }, vertexShader:V, fragmentShader:`
    varying vec2 vUv; uniform sampler2D tS;
    void main(){
      vec3 c = texture2D(tS, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      // Tightly targeted bloom threshold: characters & props stay clean, only high emissives bloom
      gl_FragColor = vec4(c * smoothstep(0.75, 1.10, l), 1.0);
    }`, depthTest:false, depthWrite:false });
  const blur = new THREE.ShaderMaterial({ uniforms:{ tS:{value:null}, uDir:{value:new THREE.Vector2(1,0)}, uRes:{value:new THREE.Vector2(1,1)} }, vertexShader:V, fragmentShader:`
    varying vec2 vUv; uniform sampler2D tS; uniform vec2 uDir, uRes;
    void main(){
      vec2 px = uDir / uRes;
      vec3 c = texture2D(tS, vUv).rgb * 0.227;
      c += (texture2D(tS, vUv + px*1.384).rgb + texture2D(tS, vUv - px*1.384).rgb) * 0.316;
      c += (texture2D(tS, vUv + px*3.230).rgb + texture2D(tS, vUv - px*3.230).rgb) * 0.0703;
      gl_FragColor = vec4(c, 1.0);
    }`, depthTest:false, depthWrite:false });
  const fin = new THREE.ShaderMaterial({ uniforms:{
      tS:{value:null}, tB:{value:null}, uRes:{value:new THREE.Vector2(1,1)},
      uTime:{value:0}, uBloom:{value:0.65}, uTilt:{value:1.0}, uGrain:{value:1.0},
      uCombatFocus:{value:0.0},
      uFocusA:{value:new THREE.Vector2(0.5, 0.48)},
      uFocusB:{value:new THREE.Vector2(0.5, 0.48)},
      uFocusRadius:{value:0.24},
      tFocus:{value:null}, uMaskOn:{value:0.0},       // the focus mask (dungeon_scene renderFocusMask)
      uBandY:{value:0.48}, uExploreFade:{value:1.0},  // the explore band: the party's screen height, faded as the camera pulls out
      uSunScreen:{value:new THREE.Vector2(0.85, 1.25)},
      uSunDir:{value:new THREE.Vector2(0.35, 0.93)},
      uGodRayIntensity:{value:0.0},
      uGodRayColor:{value:new THREE.Color(0xfff4db)} }, vertexShader:V, fragmentShader:`
    varying vec2 vUv; uniform sampler2D tS, tB, tFocus; uniform vec2 uRes;
    uniform float uTime, uBloom, uTilt, uGrain, uCombatFocus, uFocusRadius, uGodRayIntensity, uMaskOn, uBandY, uExploreFade;
    uniform vec2 uFocusA, uFocusB, uSunScreen, uSunDir;
    uniform vec3 uGodRayColor;
    void main(){
      vec2 px = 1.0 / uRes;
      vec3 col = texture2D(tS, vUv).rgb;

      // 1. Tilt-Shift & Dynamic Action Depth of Field
      float aspect = uRes.x / max(1.0, uRes.y);
      vec2 aspectVec = vec2(aspect, 1.0);

      // Exploring: a soft horizontal band that follows the party up and down the screen,
      // fading out as the camera pulls back to the overview.
      // (Sharp for 6% of the screen either side of the party, fully soft 30% away:
      //  the old 8%..42% only reached the screen edge, where it read as nothing.)
      float exploreBand = smoothstep(0.06, 0.30, abs(vUv.y - uBandY)) * uExploreFade;

      // In combat: sharp wherever the focus mask says a creature in play is drawn (the
      // acting creature and every declared target, softened round the edges), and
      // along a thin capsule from the actor to its first target so a projectile stays
      // sharp in flight. Its radius comes in world units, so zoom doesn't change it.
      vec2 p = vUv * aspectVec;
      vec2 focA = uFocusA * aspectVec;
      vec2 focB = uFocusB * aspectVec;
      vec2 ab = focB - focA;
      float lenSq = dot(ab, ab);
      float t = lenSq > 0.00001 ? clamp(dot(p - focA, ab) / lenSq, 0.0, 1.0) : 0.0;
      float dAction = length(p - (focA + t * ab));
      float capsuleSharp = 1.0 - smoothstep(uFocusRadius, uFocusRadius * 1.9 + 0.01, dAction);
      float maskSharp = smoothstep(0.04, 0.32, texture2D(tFocus, vUv).r) * uMaskOn;
      float actionBand = 1.0 - max(capsuleSharp, maskSharp);

      float band = mix(exploreBand, actionBand, uCombatFocus) * uTilt;

      // Combat blur is half its old 11 px: at full strength it smeared the field too much
      float maxBokeh = mix(9.0, 5.5, uCombatFocus);   // exploring was 5.8 px: too faint to read on pixel art
      float r = band * maxBokeh;

      // 12-point dual-ring Poisson disc with chromatic dispersion for clean optical lens bokeh
      vec3 b = vec3(0.0);
      vec2 taps[12];
      taps[0]  = vec2( 0.000,  1.000);
      taps[1]  = vec2( 0.866,  0.500);
      taps[2]  = vec2( 0.866, -0.500);
      taps[3]  = vec2( 0.000, -1.000);
      taps[4]  = vec2(-0.866, -0.500);
      taps[5]  = vec2(-0.866,  0.500);
      taps[6]  = vec2( 0.500,  0.289);
      taps[7]  = vec2( 0.000,  0.577);
      taps[8]  = vec2(-0.500,  0.289);
      taps[9]  = vec2(-0.500, -0.289);
      taps[10] = vec2( 0.000, -0.577);
      taps[11] = vec2( 0.500, -0.289);

      float totalW = 0.0;
      for(int i = 0; i < 12; i++){
        float rad = (i < 6) ? 1.0 : 0.55;
        vec2 off = vec2(taps[i].x, taps[i].y * 0.72) * rad * px * r;
        b.r += texture2D(tS, vUv + off * 1.035).r;
        b.g += texture2D(tS, vUv + off).g;
        b.b += texture2D(tS, vUv + off * 0.965).b;
        totalW += 1.0;
      }
      b /= totalW;
      col = mix(col, b, min(1.0, band * 1.15));

      // 2. High-precision Bloom (controlled intensity, never blows out sprites)
      col += texture2D(tB, vUv).rgb * uBloom;

      // 2b. Procedural Atmospheric Forest Canopy Sunbeams
      // Rays stream directly from the direction of the sun (-uSunDir) towards the map.
      // Point of emanation is pushed far off-camera (14+ screen units) so the source hub is never visible.
      // Ray emission is directionally confined strictly towards the map, eliminating full-sphere starbursts.
      if (uGodRayIntensity > 0.001) {
        vec2 toPixel = vUv - uSunScreen;
        float rayDist = length(toPixel);
        vec2 rayDir = toPixel / max(0.0001, rayDist);

        // Main axis streaming forward from the sun towards the map
        vec2 forwardDir = -uSunDir;
        float forwardAlignment = dot(rayDir, forwardDir);

        // Directional cone: rays ONLY project forward towards the map, never into empty sky or backwards
        float coneMask = smoothstep(0.70, 0.96, forwardAlignment);

        if (coneMask > 0.001) {
          // Angle relative to central forward axis
          float rayAngle = atan(rayDir.y * forwardDir.x - rayDir.x * forwardDir.y, forwardAlignment);

          // Harmonic streamers scaled for distant virtual sun
          float beam1 = sin(rayAngle * 70.0 + uTime * 0.06) * 0.5 + 0.5;
          float beam2 = sin(rayAngle * 115.0 - uTime * 0.04 + 1.3) * 0.5 + 0.5;
          float beam3 = cos(rayAngle * 35.0 + uTime * 0.02 + 2.8) * 0.5 + 0.5;
          float beamStreamers = smoothstep(0.40, 0.88, beam1 * 0.45 + beam2 * 0.35 + beam3 * 0.35);

          // Soft canopy height distribution: strongest through the upper/mid atmosphere over the trees
          float canopyFade = smoothstep(0.04, 0.72, vUv.y);

          // Distance fade to blend softly across the terrain
          float distFade = smoothstep(22.0, 6.0, rayDist);

          float godRays = beamStreamers * coneMask * canopyFade * distFade * uGodRayIntensity;
          col += uGodRayColor * (godRays * 0.30);
        }
      }

      // 3. Cinematic Color Grading & Contrast
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.90, 0.95, 1.04), (1.0 - smoothstep(0.0, 0.45, lum)) * 0.25);
      col = mix(col, col * vec3(1.05, 0.98, 0.91), smoothstep(0.40, 1.0, lum) * 0.22);
      col = mix(vec3(lum), col, 0.92);
      col = (col - 0.5) * 1.05 + 0.50;

      // 4. Aspect-Corrected Deep HD-2D Vignette
      vec2 vigP = (vUv - 0.5) * vec2(aspect * 0.82, 1.0);
      float dVig = length(vigP);
      float vg = smoothstep(0.95, 0.38, dVig * 1.25);
      col *= mix(0.50, 1.0, vg);
      col = mix(col * vec3(0.84, 0.88, 0.98), col, vg);

      // 5. Film grain
      float gr = fract(sin(dot(gl_FragCoord.xy + mod(uTime,10.0)*37.0, vec2(12.9898,78.233))) * 43758.5453);
      col += (gr - 0.5) * 0.012 * uGrain;
      col = pow(max(col, 0.0), vec3(0.4545));
      gl_FragColor = vec4(col, 1.0);
    }`, depthTest:false, depthWrite:false });
  return { qcam, sThresh:mkScene(thresh), sBlur:mkScene(blur), sFinal:mkScene(fin),
           thresh, blur, fin, rtScene:null, rtA:null, rtB:null, w:0, h:0, enabled:true };
})();

/* Scenery that can stand between the camera and the party dissolves around
   the bodies behind it — see wall_cutaway.js. Tree themes built from GLB
   models patch their own materials where the models are instanced. */
for (const m of [matWall, matWallCap, matBark, matLeaf]) cutawayPatch(m);

/* ── scatter prop world blending ─────────────────────────────────────────────
   3D scatter props (GLB imports and procedural props alike) used to stand out
   from the terrain for four reasons:
   1. Raw AI-generated GLB textures carry bright baked top-down highlights and
      un-tinted albedos (0.60–0.90), while the terrain is triple-multiplied
      into a rich, dark range (~0.05–0.18 linear).
   2. Upward-facing prop normals under a high directional sun + sky hemisphere
      receive ~4–5x irradiance, pushing highlights past the 0.75 bloom threshold.
   3. Cold/out-of-palette prop textures (e.g. cyan-blue vine mounds in a warm
      olive forest) lacked biome color harmonization and ground-contact AO.
   4. The floor's DARK_CUE multiply sheet (sprite_lighting.js) only shaded flat
      floor tiles at y=0.012, leaving props on dim/dark tiles unshaded.

   `propBlendPatch` chains onto any lit prop material and harmonizes its albedo,
   grounds its base into the turf/floor via `tFogH`, applies `DARK_CUE` from
   `tPropCue`, and rolls off outgoing highlights below the bloom threshold.
   Live-tunable from the console via `window.__propBlend`.

   The same patch snaps prop textures onto the floor's pixel grid. A floor tile
   is 32 texels across one world unit (see tools/build_tile_atlas.py). Photo
   GLBs and the 256px procedural canvases are far finer than that, so each
   sample is taken at the world cell of size 1/perUnit and at the mip whose
   texel matches that cell. Flat canvases (stone, metal, cloth) also get a
   per-cell value step, because a snapped near-white gradient is still one
   colour. `window.__propPixel` tunes it live: `.on = 0` restores smooth
   sampling, `.perUnit` is the grid (32 matches the floors). */
export const PROP_BLEND = {
  albedoScale: 0.70,          // base diffuse multiplier so props sit in the terrain's reflectance range
  highlightCompress: 1.05,    // soft-knee compression of baked white/yellow AI texture highlights
  biomeMix: 0.25,             // how strongly prop colours harmonize toward the current biome's palette
  groundAoStrength: 0.44,     // contact ambient occlusion darkening at the base of the prop
  groundAoHeight: 0.36,       // world height over which the base contact AO fades out
  groundTintMix: 0.36,        // how much of the floor/turf colour creeps up the base of the prop
  groundTintHeight: 0.28,     // world height over which the ground colour blend fades out
  topShade: 0.24,             // extra upward-normal dampening so flat tops don't blow out under high sun
  maxLum: 0.64,               // soft-shoulder outgoing-light ceiling (stays cleanly under the 0.75 bloom threshold)
  cueFollow: 1.0              // 1.0 = props in dim/dark tiles take the same DARK_CUE shading as the floor
};

/* World-locked pixel grid for prop albedo. perUnit 32 matches the floor tiles. */
export const PROP_PIXEL = {
  on: 1,
  perUnit: 32,
  grain: 1                 // scales each material's own propPixelGrain
};
if (typeof window !== 'undefined') {
  window.__propBlend = PROP_BLEND;
  window.__propPixel = PROP_PIXEL;
}

const PROP_CUE_FALLBACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
PROP_CUE_FALLBACK.needsUpdate = true;

export const propBlendUniforms = {
  ...fogHeightUniforms,
  uPropBiomeTint:     { value: new THREE.Color(1, 1, 1) },
  uPropGroundColor:   { value: new THREE.Color(0x3a4d2c) },
  tPropCue:           { value: PROP_CUE_FALLBACK },
  uPropCueSize:       { value: new THREE.Vector2(1, 1) },
  uPropCueDim:        { value: new THREE.Vector3(0.86, 0.88, 0.94) },
  uPropCueDark:       { value: new THREE.Vector3(0.52, 0.58, 0.80) },
  uPropCueStrength:   { value: 0 },
  uPropAlbedoScale:       { get value() { return PROP_BLEND.albedoScale; } },
  uPropHighlightCompress: { get value() { return PROP_BLEND.highlightCompress; } },
  uPropBiomeMix:          { get value() { return PROP_BLEND.biomeMix; } },
  uPropGroundAo:          { get value() { return PROP_BLEND.groundAoStrength; } },
  uPropGroundAoH:         { get value() { return PROP_BLEND.groundAoHeight; } },
  uPropGroundTintMix:     { get value() { return PROP_BLEND.groundTintMix; } },
  uPropGroundTintH:       { get value() { return PROP_BLEND.groundTintHeight; } },
  uPropTopShade:          { get value() { return PROP_BLEND.topShade; } },
  uPropMaxLum:            { get value() { return PROP_BLEND.maxLum; } },
  uPropCueFollow:         { get value() { return PROP_BLEND.cueFollow; } },
  uPropPixelOn:           { get value() { return PROP_PIXEL.on; } },
  uPropPixelPerUnit:      { get value() { return PROP_PIXEL.perUnit; } }
};

const _pbGround = new THREE.Color();
const _pbWall = new THREE.Color();
const _pbGrassTint = new THREE.Color(0x6c8c4e);

/** Update the biome palette and ground contact colours for `propBlendPatch`. */
export function applyPropTheme(TH) {
  if (!TH) return;
  _pbGround.set(TH.floor != null ? TH.floor : 0x586252);
  if (TH.overland && (!TH.groundMat || TH.groundMat === 'grass') && !TH.groundTiles) {
    /* Overland grass floors multiply TEX.grass * matGrass.color * TH.floor;
       match that deeper turf tone so the base blend roots seamlessly. */
    _pbGround.multiply(_pbGrassTint);
  }
  propBlendUniforms.uPropGroundColor.value.copy(_pbGround);

  _pbWall.set(TH.wall != null ? TH.wall : (TH.pillar != null ? TH.pillar : 0x52565c));
  const tint = propBlendUniforms.uPropBiomeTint.value;
  tint.copy(_pbGround).lerp(_pbWall, 0.35);
  const lum = 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b;
  if (lum > 1e-4) tint.multiplyScalar(1 / lum);
  tint.r = Math.max(0.62, Math.min(1.32, tint.r));
  tint.g = Math.max(0.62, Math.min(1.32, tint.g));
  tint.b = Math.max(0.62, Math.min(1.32, tint.b));
}

/** Share the floor's DARK_CUE texture (sprite_lighting.js) with all patched props. */
export function setPropCueState(tex, w, h, dim, dark, strength) {
  propBlendUniforms.tPropCue.value = tex || PROP_CUE_FALLBACK;
  propBlendUniforms.uPropCueSize.value.set(Math.max(1, w || 1), Math.max(1, h || 1));
  if (dim) propBlendUniforms.uPropCueDim.value.set(dim[0], dim[1], dim[2]);
  if (dark) propBlendUniforms.uPropCueDark.value.set(dark[0], dark[1], dark[2]);
  propBlendUniforms.uPropCueStrength.value = tex ? (strength || 0) : 0;
}

const PROP_BLEND_VERT_PARS = `
varying vec3 vPropWorldPos;
varying float vPropWorldUp;
varying vec3 vPropOrigin;
`;

const PROP_BLEND_VERT_BODY = `
{
  vec4 pbPos = vec4(transformed, 1.0);
  vec3 pbNorm = objectNormal;
  #ifdef USE_INSTANCING
    pbPos = instanceMatrix * pbPos;
    pbNorm = mat3(instanceMatrix) * pbNorm;
  #endif
  vPropWorldPos = (modelMatrix * pbPos).xyz;
  vec3 pbWorldNorm = mat3(modelMatrix) * pbNorm;
  float pbLen = length(pbWorldNorm);
  vPropWorldUp = pbLen > 0.0001 ? (pbWorldNorm.y / pbLen) : 0.0;
  vec4 pbOrigin = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
    pbOrigin = instanceMatrix * pbOrigin;
  #endif
  vPropOrigin = (modelMatrix * pbOrigin).xyz;
}
`;

const PROP_BLEND_FRAG_PARS = `
varying vec3 vPropWorldPos;
varying float vPropWorldUp;
varying vec3 vPropOrigin;
uniform float uPropUvJitter;
uniform sampler2D tFogH;
uniform vec2 uFogHSize;
uniform float uFogHOn;
uniform vec3 uPropBiomeTint;
uniform vec3 uPropGroundColor;
uniform sampler2D tPropCue;
uniform vec2 uPropCueSize;
uniform vec3 uPropCueDim;
uniform vec3 uPropCueDark;
uniform float uPropCueStrength;
uniform float uPropAlbedoScale;
uniform float uPropHighlightCompress;
uniform float uPropBiomeMix;
uniform float uPropGroundAo;
uniform float uPropGroundAoH;
uniform float uPropGroundTintMix;
uniform float uPropGroundTintH;
uniform float uPropTopShade;
uniform float uPropMaxLum;
uniform float uPropCueFollow;
uniform float uPropPixelOn;
uniform float uPropPixelPerUnit;
uniform float uPropPixelGrain;

float propGroundHeight(vec3 wp) {
  if (uFogHOn < 0.5) return 0.0;
  vec2 uv = (wp.xz + uFogHSize * 0.5) / uFogHSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture2D(tFogH, uv).r * ${FOG_H_RANGE.toFixed(1)} + (${FOG_H_MIN.toFixed(1)});
}

/* UV of the world-pixel that contains this fragment. Derivatives are passed
   in (dFdx of a function argument is 0 on some GPUs). */
/* One shift per prop, from the instance origin, so two columns cut from the
   same ashlar do not show the same crop. Constant across the mesh, so the
   world-pixel snap below still lands on texel centres. */
vec2 propStoneOffset() {
  vec3 o = vPropOrigin;
  float h1 = fract(sin(dot(o.xz, vec2(127.1, 311.7))) * 43758.5453);
  float h2 = fract(sin(dot(o.zy, vec2(269.5, 183.3))) * 43758.5453);
  return vec2(h1, h2) * uPropUvJitter;
}

vec2 propPixelUvFrom(vec2 uv, vec2 dxU, vec2 dyU, vec3 dxW, vec3 dyW) {
  uv += propStoneOffset();
  float target = 1.0 / uPropPixelPerUnit;
  vec3 snapped = (floor(vPropWorldPos / target) + 0.5) * target;
  vec3 delta = snapped - vPropWorldPos;
  float a00 = dot(dxW, dxW);
  float a01 = dot(dxW, dyW);
  float a11 = dot(dyW, dyW);
  float det = a00 * a11 - a01 * a01;
  if (abs(det) < 1e-12) return uv;
  float invDet = 1.0 / det;
  float b0 = dot(dxW, delta);
  float b1 = dot(dyW, delta);
  vec2 st = clamp(vec2((a11 * b0 - a01 * b1) * invDet, (a00 * b1 - a01 * b0) * invDet), vec2(-4.0), vec2(4.0));
  return uv + dxU * st.x + dyU * st.y;
}

float propPixelLodFrom(vec2 dxU, vec2 dyU, vec3 dxW, vec3 dyW, float texW) {
  float worldSpan = max(length(dxW), length(dyW));
  float uvSpan = max(length(dxU), length(dyU));
  if (worldSpan < 1e-6 || uvSpan < 1e-8) return 0.0;
  float uvStep = (uvSpan / worldSpan) / uPropPixelPerUnit;
  return clamp(log2(max(uvStep * texW, 1.0)), 0.0, 10.0);
}

vec4 propPixelTex(sampler2D tex, vec2 uv, vec2 dxU, vec2 dyU, vec3 dxW, vec3 dyW) {
  if (uPropPixelOn < 0.5 || uPropPixelPerUnit < 1.0) return texture2D(tex, uv);
  vec2 q = propPixelUvFrom(uv, dxU, dyU, dxW, dyW);
  float lod = propPixelLodFrom(dxU, dyU, dxW, dyW, float(textureSize(tex, 0).x));
  /* Alpha-tested cards (leaves, ivy) lose their cutout if the mip averages
     them with empty texels. Two mips finer keeps the holes, still chunky. */
  #ifdef USE_ALPHATEST
    lod = max(0.0, lod - 2.0);
  #endif
  lod = floor(lod);
  vec2 size = max(vec2(textureSize(tex, 0)) / exp2(lod), vec2(1.0));
  q = (floor(q * size) + 0.5) / size;
  return textureLod(tex, q, lod);
}
`;

const PROP_BLEND_COLOR_BODY = `
{
  // 1. De-light baked AI highlights & normalize albedo into terrain reflectance range
  float pbLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  if (pbLum > 0.0001) {
    float pbComp = (pbLum * uPropAlbedoScale) / (1.0 + pbLum * uPropHighlightCompress);
    diffuseColor.rgb *= pbComp / pbLum;
    pbLum = pbComp;
  }

  // 2. Dampen upward-facing normals where AI textures bake white top-lighting & sun hits hardest
  float pbTop = smoothstep(0.35, 0.95, vPropWorldUp);
  diffuseColor.rgb *= (1.0 - pbTop * uPropTopShade);
  pbLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));

  // 3. Biome palette harmonization (shifts out-of-palette blues/greys toward the biome's chromaticity)
  vec3 pbTintTarget = mix(diffuseColor.rgb * uPropBiomeTint, uPropBiomeTint * pbLum, 0.42);
  diffuseColor.rgb = mix(diffuseColor.rgb, pbTintTarget, uPropBiomeMix);

  // 4. Ground-contact color blend & ambient occlusion (roots props into the turf/floor beneath them)
  float pbGroundY = propGroundHeight(vPropWorldPos);
  float pbH = max(0.0, vPropWorldPos.y - pbGroundY);
  float pbTintFactor = (1.0 - smoothstep(0.0, max(0.01, uPropGroundTintH), pbH)) * uPropGroundTintMix;
  diffuseColor.rgb = mix(diffuseColor.rgb, uPropGroundColor * 0.65, pbTintFactor);
  float pbAo = mix(1.0 - uPropGroundAo, 1.0, smoothstep(0.0, max(0.01, uPropGroundAoH), pbH));
  diffuseColor.rgb *= pbAo;
}
`;

const PROP_BLEND_OUTGOING_BODY = `
{
  // 5. Match the floor's DARK_CUE in dim and dark tiles so props don't glow in shadow
  if (uPropCueStrength > 0.001) {
    vec2 pbCueUv = (vPropWorldPos.xz + uPropCueSize * 0.5) / uPropCueSize;
    if (pbCueUv.x >= 0.0 && pbCueUv.y >= 0.0 && pbCueUv.x <= 1.0 && pbCueUv.y <= 1.0) {
      float pbCa = texture2D(tPropCue, pbCueUv).r;
      vec3 pbCt = pbCa < 0.5 ? mix(vec3(1.0), uPropCueDim, pbCa / 0.5) : mix(uPropCueDim, uPropCueDark, (pbCa - 0.5) / 0.5);
      float pbH = max(0.0, vPropWorldPos.y - propGroundHeight(vPropWorldPos));
      float pbCueFade = smoothstep(0.01, 0.05, pbH);
      outgoingLight *= mix(vec3(1.0), pbCt, uPropCueStrength * uPropCueFollow * pbCueFade);
    }
  }

  // 6. Soft-shoulder highlight roll-off so sunlit props never cross the 0.75 bloom threshold
  float pbOutLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  if (pbOutLum > 0.0001 && uPropMaxLum > 0.01) {
    float pbTargetLum = pbOutLum / (1.0 + pbOutLum / uPropMaxLum);
    outgoingLight *= pbTargetLum / pbOutLum;
  }
}
`;

const PROP_PIXEL_GRAIN_BODY = `
{
  // Flat procedural colours (stone, metal, cloth) have no pixels of their own.
  // One value step per world cell is the fleck the floor tiles get from art.
  if (uPropPixelGrain > 0.001 && uPropPixelOn > 0.5 && uPropPixelPerUnit > 1.0) {
    vec3 pbCell = floor(vPropWorldPos * uPropPixelPerUnit);
    float pbHash = fract(sin(dot(pbCell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    diffuseColor.rgb *= mix(1.0 - uPropPixelGrain, 1.0 + uPropPixelGrain, pbHash);
  }
}
`;

const PROP_PIXEL_MAP = `
#ifdef USE_MAP
	vec4 sampledDiffuseColor = propPixelTex( map, vMapUv, dFdx( vMapUv ), dFdy( vMapUv ), dFdx( vPropWorldPos ), dFdy( vPropWorldPos ) );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif
`;

function pixelNormalMaps() {
  const sample = 'propPixelTex( normalMap, vNormalMapUv, dFdx( vNormalMapUv ), dFdy( vNormalMapUv ), dFdx( vPropWorldPos ), dFdy( vPropWorldPos ) )';
  return THREE.ShaderChunk.normal_fragment_maps.split('texture2D( normalMap, vNormalMapUv )').join(sample);
}

function pixelBumpPars() {
  const src = THREE.ShaderChunk.bumpmap_pars_fragment;
  return src.replace(
    /float Hll = bumpScale \* texture2D\( bumpMap, vBumpMapUv \)\.x;[\s\S]*?return vec2\( dBx, dBy \);/,
    `float Hll;
		float dBx;
		float dBy;
		if (uPropPixelOn < 0.5 || uPropPixelPerUnit < 1.0) {
			Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
			dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
			dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		} else {
			vec3 pbDxW = dFdx( vPropWorldPos );
			vec3 pbDyW = dFdy( vPropWorldPos );
			vec2 pbUv = propPixelUvFrom( vBumpMapUv, dSTdx, dSTdy, pbDxW, pbDyW );
			float pbLod = floor( propPixelLodFrom( dSTdx, dSTdy, pbDxW, pbDyW, float( textureSize( bumpMap, 0 ).x ) ) );
			vec2 pbSize = max( vec2( textureSize( bumpMap, 0 ) ) / exp2( pbLod ), vec2( 1.0 ) );
			pbUv = ( floor( pbUv * pbSize ) + 0.5 ) / pbSize;
			float pbTarget = 1.0 / uPropPixelPerUnit;
			vec2 pbStepX = dSTdx * ( pbTarget / max( length( pbDxW ), 1e-5 ) );
			vec2 pbStepY = dSTdy * ( pbTarget / max( length( pbDyW ), 1e-5 ) );
			Hll = bumpScale * textureLod( bumpMap, pbUv, pbLod ).x;
			dBx = bumpScale * textureLod( bumpMap, pbUv + pbStepX, pbLod ).x - Hll;
			dBy = bumpScale * textureLod( bumpMap, pbUv + pbStepY, pbLod ).x - Hll;
		}
		return vec2( dBx, dBy );`
  );
}

function pixelAo() {
  const sample = 'propPixelTex( aoMap, vAoMapUv, dFdx( vAoMapUv ), dFdy( vAoMapUv ), dFdx( vPropWorldPos ), dFdy( vPropWorldPos ) )';
  return THREE.ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv )', sample);
}

function pixelEmissive() {
  const sample = 'propPixelTex( emissiveMap, vEmissiveMapUv, dFdx( vEmissiveMapUv ), dFdy( vEmissiveMapUv ), dFdx( vPropWorldPos ), dFdy( vPropWorldPos ) )';
  return THREE.ShaderChunk.emissivemap_fragment.replace('texture2D( emissiveMap, vEmissiveMapUv )', sample);
}

function propPixelizeFragment(src) {
  let out = src;
  if (out.includes('#include <map_fragment>')) out = out.replace('#include <map_fragment>', PROP_PIXEL_MAP);
  if (out.includes('#include <normal_fragment_maps>')) out = out.replace('#include <normal_fragment_maps>', pixelNormalMaps());
  if (out.includes('#include <bumpmap_pars_fragment>')) out = out.replace('#include <bumpmap_pars_fragment>', pixelBumpPars());
  if (out.includes('#include <aomap_fragment>')) out = out.replace('#include <aomap_fragment>', pixelAo());
  if (out.includes('#include <emissivemap_fragment>')) out = out.replace('#include <emissivemap_fragment>', pixelEmissive());
  return out;
}

/**
 * Patch a lit prop material so its albedo, ground contact, biome tint,
 * darkness-cue response, and highlight roll-off match the surrounding world,
 * and so its textures sit on the same world pixel grid as the floor tiles.
 * Chained after any existing `onBeforeCompile` and safe to call alongside `cutawayPatch`.
 *
 * `userData.propPixelOnly` snaps and grains without the blend (matIce is also
 * a floor option). `userData.propPixelGrain` is the flat-colour value step.
 */
export function propBlendPatch(mat) {
  if (Array.isArray(mat)) { mat.forEach(propBlendPatch); return mat; }
  if (!mat || (mat.userData && mat.userData.propBlend)) return mat;
  darkMaskPatch(mat);   // props can finish loading mid-level; the level-load sweep wouldn't see them
  if (!(mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial ||
        mat.isMeshLambertMaterial || mat.isMeshPhongMaterial || mat.isMeshToonMaterial ||
        mat.isMeshBasicMaterial)) return mat;
  const prev = mat.onBeforeCompile;
  const baseKey = mat.customProgramCacheKey();
  const pixelOnly = !!(mat.userData && mat.userData.propPixelOnly);
  mat.onBeforeCompile = function (sh, renderer) {
    if (prev) prev.call(this, sh, renderer);
    Object.assign(sh.uniforms, propBlendUniforms);
    sh.uniforms.uPropPixelGrain = {
      get value() {
        const g = (mat.userData && mat.userData.propPixelGrain) || 0;
        return g * PROP_PIXEL.grain;
      }
    };
    sh.uniforms.uPropUvJitter = {
      get value() { return (mat.userData && mat.userData.propUvJitter) || 0; }
    };
    const colorBody = PROP_PIXEL_GRAIN_BODY + (pixelOnly ? '' : PROP_BLEND_COLOR_BODY);
    const outgoing = pixelOnly ? '#include <opaque_fragment>' : (PROP_BLEND_OUTGOING_BODY + '\n#include <opaque_fragment>');
    /* An unlit (MeshBasicMaterial) prop never runs beginnormal_vertex, so it
       has no objectNormal — the program fails to compile and the prop drops
       out. Its raw normal attribute is the same vector before skin/morph. */
    const vertBody = mat.isMeshBasicMaterial
      ? PROP_BLEND_VERT_BODY.replace('vec3 pbNorm = objectNormal;', 'vec3 pbNorm = normal;')
      : PROP_BLEND_VERT_BODY;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + PROP_BLEND_VERT_PARS)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + vertBody);
    sh.fragmentShader = propPixelizeFragment(sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PROP_BLEND_FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + colorBody)
      .replace('#include <opaque_fragment>', outgoing));
  };
  mat.customProgramCacheKey = () => baseKey + '|prop_blend|prop_pixel' + (pixelOnly ? '|pixel_only' : '');
  if (!mat.userData) mat.userData = {};
  mat.userData.propBlend = true;
  mat.needsUpdate = true;
  return mat;
}

/* Grain is the value step on canvases that read as one colour. Stone's
   courses are in the canvas now, so its grain is only a fleck: a 0.13 step
   was washing the joints back out. propUvJitter shifts that repeat per prop.
   Patterned maps (rug, tapestry, gold, web, ivy) already have contrast, so
   they only snap. matIce stays pixel-only: it is also the optional ice floor. */
const PROP_PIXEL_MATERIALS = [
  [matStone, 0.05],
  [matWood, 0.08],
  [matBark, 0.08],
  [matBoneStone, 0.12],
  [matCeramic, 0.10],
  [matIvy, 0],
  [matSwampGrass, 0.06],
  [matLeaf, 0.06],
  [matMetal, 0.12],
  [matSconce, 0.12],
  [matTrim, 0.12],
  [matCloth, 0.14],
  [matIce, 0.08, true],
  [matGlacialIce, 0.08],
  [matRug, 0],
  [matTapestry, 0],
  [matCampRing, 0],
  [matRegimentalBanner, 0],
  [matGoldInlay, 0],
  [matGoldBullion, 0],
  [matBiolum, 0.10],
  [matWeb, 0]
];
for (const [m, grain, pixelOnly] of PROP_PIXEL_MATERIALS) {
  if (!m.userData) m.userData = {};
  m.userData.propPixelGrain = grain;
  if (pixelOnly) m.userData.propPixelOnly = true;
  propBlendPatch(m);
}
matStone.userData.propUvJitter = 1;

/* Painted canvases with real edges get the same depth-built tangent normal
   as the dungeon walls. Stone is the exception that stays on its bump: the
   ashlar height is authored next to the colour, and a generated normal of a
   flat field smeared. Bone, ceramic and ice are still too even for one.
   Lambert and unlit materials do not sample a normal map. */
function attachProcNormal(mat, file) {
  if (!mat || !mat.normalScale) return;
  const tex = loadDataNormal(`./art/proc_normals/${file}.png`);
  const src = mat.map;
  if (src) { tex.wrapS = src.wrapS; tex.wrapT = src.wrapT; }
  mat.normalMap = tex;
  mat.normalScale.set(TILE_NORMAL_SCALE, TILE_NORMAL_SCALE);
  mat.needsUpdate = true;
}
attachProcNormal(matWood, 'wood');
attachProcNormal(matBark, 'wood');
attachProcNormal(matMetal, 'metal');
attachProcNormal(matSconce, 'metal');
attachProcNormal(matRug, 'rug');
attachProcNormal(matGoldInlay, 'goldSeal');
attachProcNormal(matGoldBullion, 'goldSeal');
attachProcNormal(matIvy, 'ivy');
attachProcNormal(matCampRing, 'campRing');
attachProcNormal(matLeaf, 'swirl');
attachProcNormal(matSwampGrass, 'swampGrass');
attachProcNormal(matDeadGrass, 'swampGrass');   // same blades, same relief
