/**
 * DUNGEON FORGE — procedural texture generation, materials, shaders & post-processing.
 */
import * as THREE from 'three';
import { mulberry32 } from '../dungeon/dungeon_generator.js';

function makeCanvas(sz, h){
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
function makeStoneTex(){
  const [cv,g] = makeCanvas(256);
  g.fillStyle='#c9c9c9'; g.fillRect(0,0,256,256);
  for(let i=0;i<2600;i++){
    const v = 170 + texRand()*110 | 0;
    g.fillStyle = 'rgba('+v+','+v+','+v+',0.16)';
    g.fillRect(texRand()*256, texRand()*256, 1+texRand()*3.4, 1+texRand()*3.4);
  }
  for(let i=0;i<420;i++){
    g.fillStyle = 'rgba(40,40,48,'+(0.05+texRand()*0.10).toFixed(3)+')';
    g.fillRect(texRand()*256, texRand()*256, 1+texRand()*2, 1+texRand()*2);
  }
  g.strokeStyle='rgba(30,30,36,0.20)'; g.lineWidth=1;
  for(let i=0;i<7;i++){
    let x=texRand()*256, y=texRand()*256;
    g.beginPath(); g.moveTo(x,y);
    for(let s=0;s<6;s++){ x+=(texRand()-0.5)*46; y+=(texRand()-0.5)*46; g.lineTo(x,y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace;
  return t;
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

function makeShaftTex(){
  const [cv,g] = makeCanvas(128,256);
  const grad = g.createLinearGradient(0,0,0,256);
  grad.addColorStop(0,'rgba(255,255,255,0.8)');
  grad.addColorStop(1,'rgba(255,255,255,0.0)');
  g.fillStyle = grad; g.fillRect(0,0,128,256);
  return srgbTex(cv);
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

export const TEX = {
  stone: makeStoneTex(), crack: makeCrackTex(), rune: makeRuneTex(), swirl: makeSwirlTex(),
  shaft: makeShaftTex(), glow: makeGlowTex(), blot: makeBlotTex(), wood: makeWoodTex(),
  rug: makeRugTex(), magicCircle: makeMagicCircleTex(), tapestry: makeTapestryTex(),
  goldSeal: makeGoldSealTex(), necroCircle: makeNecroCircleTex(), sporeCircle: makeSporeCircleTex(),
  campRing: makeCampRingTex(), regimentalBanner: makeRegimentalBannerTex(),
  metal: makeMetalTex(), ceramic: makeCeramicTex(), bone: makeBoneTex(), ice: makeIceTex(),
  web: makeWebTex()
};

/* ---------------- Material Kit ---------------- */
export const matStone = new THREE.MeshStandardMaterial({map:TEX.stone, roughness:0.92, metalness:0.02});
export const matWood = new THREE.MeshStandardMaterial({map:TEX.wood, roughness:0.82, metalness:0.04});
export const matMetal = new THREE.MeshStandardMaterial({map:TEX.metal, roughness:0.35, metalness:0.85});
export const matCeramic = new THREE.MeshStandardMaterial({map:TEX.ceramic, roughness:0.52, metalness:0.08});
export const matRug = new THREE.MeshStandardMaterial({map:TEX.rug, roughness:0.95, side:THREE.DoubleSide});
export const matMagicCircle = new THREE.MeshBasicMaterial({map:TEX.magicCircle, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide});
matMagicCircle.toneMapped = false;
export const matTapestry = new THREE.MeshLambertMaterial({map:TEX.tapestry, side:THREE.DoubleSide});
export const matSconce = new THREE.MeshStandardMaterial({map:TEX.metal, roughness:0.3, metalness:0.8});
export const matGoldInlay = new THREE.MeshStandardMaterial({map:TEX.goldSeal, roughness:0.25, metalness:0.85});
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
  mat.onBeforeCompile = sh=>{
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aUvO;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = vMapUv*0.5 + aUvO;
#endif
#ifdef USE_BUMPMAP
  vBumpMapUv = vBumpMapUv*0.5 + aUvO;
#endif`);
  };
  mat.customProgramCacheKey = ()=>'atlas';
  return mat;
}

/* ---------------- Pixel-art tile atlases ----------------
   Baked 2x2 atlases (tools/build_tile_atlas.py) that stand in for the
   procedural flagstone/masonry above on a per-theme basis. Same layout, so the
   instanced `aUvO` quadrant picking and the per-cell theme tint are unchanged;
   only the map/bumpMap swap. Themes with no entry keep the procedural look. */
const PIXEL_TILES = {
  ancient: { floor:'./art/tiles/ancient_floor.png', floorBump:0.45,
             wall:'./art/tiles/ancient_wall.png',   wallBump:0.45,
             cap:'./art/tiles/ancient_cap.png' },
  molten:  { floor:'./art/tiles/molten_floor.png',  floorBump:0.45,
             wall:'./art/tiles/molten_wall.png',    wallBump:0.45,
             cap:'./art/tiles/molten_cap.png' },
  frost:   { floor:'./art/tiles/frost_floor.png',   floorBump:0.45,
             wall:'./art/tiles/frost_wall.png',     wallBump:0.45,
             cap:'./art/tiles/frost_cap.png' },
  grim:    { floor:'./art/tiles/grim_floor.png',    floorBump:0.45,
             wall:'./art/tiles/grim_wall.png',      wallBump:0.45,
             cap:'./art/tiles/grim_cap.png' },
  verdant: { floor:'./art/tiles/verdant_floor.png', floorBump:0.45,
             wall:'./art/tiles/verdant_wall.png',   wallBump:0.45,
             cap:'./art/tiles/verdant_cap.png' }
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

/** Point the shared floor/wall materials at a theme's pixel atlas, if it has
 *  one. Called from buildScene before the level is assembled. */
export function applyTileTheme(themeKey){
  const P = PIXEL_TILES[themeKey] || {};
  if(P.floor){
    matFloor.map = pixelTex(P.floor);
    matFloor.bumpMap = pixelTex(P.floor.replace('.png','_bump.png'), true);
    matFloor.bumpScale = P.floorBump ?? 0.45;
  } else {
    matFloor.map = FLAGTEX.map;
    matFloor.bumpMap = FLAGTEX.bump;
    matFloor.bumpScale = 0.9;
  }
  if(P.wall){
    matWall.map = pixelTex(P.wall);
    matWall.bumpMap = pixelTex(P.wall.replace('.png','_bump.png'), true);
    matWall.bumpScale = P.wallBump ?? 0.45;
  } else {
    matWall.map = MASONTEX.map;
    matWall.bumpMap = MASONTEX.bump;
    matWall.bumpScale = 0.8;
  }
  /* Wall tops read as the same masonry as the wall sides. They need their own
     atlas rather than sharing matWall's: wall atlases are baked with --stack 2
     to keep tiles square on a 2-unit-tall wall face, and a cap is a flat slab
     whose UVs span the quadrant, so it would show both stacked tiles squashed
     into one cell. The cap atlas is the same source tiles, unstacked. */
  if(P.cap){
    matWallCap.map = pixelTex(P.cap);
    matWallCap.bumpMap = pixelTex(P.cap.replace('.png','_bump.png'), true);
    matWallCap.bumpScale = P.capBump ?? 0.45;
  } else {
    matWallCap.map = MASONTEX.map;
    matWallCap.bumpMap = MASONTEX.bump;
    matWallCap.bumpScale = 0.8;
  }
  if(tileOverride){
    for(const [slot, mat] of [['floor',matFloor], ['wall',matWall], ['cap',matWallCap]]){
      const o = tileOverride[slot];
      if(!o || !o.map) continue;
      mat.map = o.map;
      if(o.bump) mat.bumpMap = o.bump;
      if(o.bumpScale != null) mat.bumpScale = o.bumpScale;
    }
  }
}

export const matFloor = atlasPatch(new THREE.MeshStandardMaterial({map:FLAGTEX.map, bumpMap:FLAGTEX.bump, bumpScale:0.9, roughness:0.93, metalness:0.02}));
export const matWall  = atlasPatch(new THREE.MeshStandardMaterial({map:MASONTEX.map, bumpMap:MASONTEX.bump, bumpScale:0.8, roughness:0.94, metalness:0.02, polygonOffset:true, polygonOffsetFactor:2, polygonOffsetUnits:5000}));
export const matWallCap = atlasPatch(new THREE.MeshStandardMaterial({map:MASONTEX.map, bumpMap:MASONTEX.bump, bumpScale:0.8, roughness:0.94, metalness:0.02}));
export const matTrim  = new THREE.MeshStandardMaterial({roughness:0.38, metalness:0.75, polygonOffset:true, polygonOffsetFactor:2, polygonOffsetUnits:5000});
export const matGlow  = new THREE.MeshBasicMaterial({color:0xffffff});
matGlow.toneMapped = false;
export const matCloth = new THREE.MeshLambertMaterial({side:THREE.DoubleSide});
export const matIce   = new THREE.MeshStandardMaterial({roughness:0.16, metalness:0.02, transparent:true, opacity:0.88});
export const matMoss  = new THREE.MeshLambertMaterial();
export const matBark  = new THREE.MeshStandardMaterial({map:TEX.wood, roughness:0.88, metalness:0.04});
export const matGrass = new THREE.MeshStandardMaterial({map:TEX.stone, color:0x8ba67a, roughness:0.95, metalness:0});
export const matLeaf  = new THREE.MeshStandardMaterial({map:TEX.swirl, roughness:0.75, metalness:0.02});
export const matCrackD = new THREE.MeshBasicMaterial({map:TEX.crack, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false});
matCrackD.toneMapped = false;
export const matRune  = new THREE.MeshBasicMaterial({map:TEX.rune, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide});
matRune.toneMapped = false;
export const matPortal= new THREE.MeshBasicMaterial({map:TEX.swirl, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false});
matPortal.toneMapped = false;
export const matShaft = new THREE.MeshBasicMaterial({map:TEX.shaft, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide, opacity:0.13});
matShaft.toneMapped = false;
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
    uScale: { value: 0.12 }
  },
  vertexShader: `
    varying vec2 vWorldPos;
    varying vec2 vUv;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xz;
      vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec2 vWorldPos;
    varying vec2 vUv;
    uniform float uTime, uDensity, uSpeed, uScale;
    uniform vec3 uColor;

    float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float vnoise(vec2 p){
      vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      float a=h21(i), b=h21(i+vec2(1,0)), c=h21(i+vec2(0,1)), d=h21(i+vec2(1,1));
      return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
    }
    float fbm(vec2 p){
      float v=0.0, a=0.5;
      for(int i=0;i<4;i++){ v+=a*vnoise(p); p=p*2.03+11.7; a*=0.5; }
      return v;
    }

    void main(){
      vec2 wp = vWorldPos * uScale;
      // Multi-layer wind drift: sweeping diagonal highland breeze + micro swirls
      vec2 drift1 = vec2(uTime * uSpeed * 1.6, uTime * uSpeed * 0.95);
      vec2 drift2 = vec2(-uTime * uSpeed * 0.6, uTime * uSpeed * 1.3) + vec2(17.3, 42.1);
      vec2 drift3 = vec2(uTime * uSpeed * 0.35, -uTime * uSpeed * 0.45) + vec2(83.7, 29.4);
      
      // Domain warping for organic wisps and drifting fingers of fog
      float q1 = fbm(wp * 0.85 + drift1);
      float q2 = fbm(wp * 0.85 + drift2);
      vec2 warped = wp + vec2(q1, q2) * 1.8;

      float n1 = fbm(warped + drift1 * 0.5);
      float n2 = fbm(warped * 1.6 - drift2 * 0.7);
      float n3 = fbm(warped * 2.8 + drift3);

      float rawVal = n1 * 0.55 + n2 * 0.32 + n3 * 0.13;

      // High-contrast threshold: wide clear areas (rawVal < 0.48 are 100% transparent),
      // rolling mist banks form above 0.48 with wispy feathering up to 0.72.
      float patchMask = smoothstep(0.48, 0.72, rawVal);

      // Subtle edge wisps within the fog patches
      float wisps = 0.85 + 0.15 * sin(uTime * 0.4 + n2 * 8.0);

      // Edge fade against the outer perimeter of the plane so it blends smoothly into scene fog
      float edgeX = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
      float edgeY = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
      float edgeFade = edgeX * edgeY;

      float alpha = patchMask * uDensity * wisps * edgeFade;
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
      gl_FragColor = vec4(c * smoothstep(0.58, 0.95, l), 1.0);
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
      uTime:{value:0}, uBloom:{value:0.9}, uTilt:{value:1.0} }, vertexShader:V, fragmentShader:`
    varying vec2 vUv; uniform sampler2D tS, tB; uniform vec2 uRes; uniform float uTime, uBloom, uTilt;
    void main(){
      vec2 px = 1.0 / uRes;
      vec3 col = texture2D(tS, vUv).rgb;
      float band = smoothstep(0.15, 0.52, abs(vUv.y - 0.5)) * uTilt;
      float r = band * 3.4;
      vec3 b = col * 0.4;
      b += texture2D(tS, vUv + vec2( px.x*r,  px.y*r*0.6)).rgb * 0.15;
      b += texture2D(tS, vUv + vec2(-px.x*r,  px.y*r*0.6)).rgb * 0.15;
      b += texture2D(tS, vUv + vec2( px.x*r, -px.y*r*0.6)).rgb * 0.15;
      b += texture2D(tS, vUv + vec2(-px.x*r, -px.y*r*0.6)).rgb * 0.15;
      col = mix(col, b, min(1.0, band));
      col += texture2D(tB, vUv).rgb * uBloom;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.90, 0.95, 1.03), (1.0 - smoothstep(0.0, 0.45, lum)) * 0.25);
      col = mix(col, col * vec3(1.04, 0.98, 0.92), smoothstep(0.40, 1.0, lum) * 0.20);
      col = mix(vec3(lum), col, 0.88);
      col = (col - 0.5) * 1.02 + 0.50;
      float vg = smoothstep(1.35, 0.5, length(vUv - 0.5) * 1.55);
      col *= mix(0.85, 1.02, vg);
      float gr = fract(sin(dot(gl_FragCoord.xy + mod(uTime,10.0)*37.0, vec2(12.9898,78.233))) * 43758.5453);
      col += (gr - 0.5) * 0.012;
      col = pow(max(col, 0.0), vec3(0.4545));
      gl_FragColor = vec4(col, 1.0);
    }`, depthTest:false, depthWrite:false });
  return { qcam, sThresh:mkScene(thresh), sBlur:mkScene(blur), sFinal:mkScene(fin),
           thresh, blur, fin, rtScene:null, rtA:null, rtB:null, w:0, h:0, enabled:true };
})();
