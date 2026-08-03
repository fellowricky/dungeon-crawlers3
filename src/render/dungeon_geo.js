/**
 * DUNGEON FORGE — procedural 3D geometry kit.
 * Contains procedural shape generators and merged mesh assets for walls, floors,
 * props, decorations, and theme markers.
 */
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _E = new THREE.Euler();

export function bgFromTris(v){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v),3));
  const p = g.attributes.position, uv = new Float32Array(p.count*2);
  for(let i=0;i<p.count;i++){
    uv[i*2]   = (p.getX(i)+p.getZ(i))*0.53 + 0.5;
    uv[i*2+1] = p.getY(i)*0.61 + (p.getX(i)-p.getZ(i))*0.21;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv,2));
  g.computeVertexNormals();
  return g;
}

export function chamferBox(w,h,d,ch){
  const hw=w/2, hd=d/2, iw=Math.max(0.01,hw-ch), id=Math.max(0.01,hd-ch), hb=Math.max(0.01,h-ch);
  const v=[];
  const q=(a,b,c,e)=>{ v.push(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2],
                              a[0],a[1],a[2], c[0],c[1],c[2], e[0],e[1],e[2]); };
  const b0=[-hw,0,-hd],b1=[hw,0,-hd],b2=[hw,0,hd],b3=[-hw,0,hd];
  const m0=[-hw,hb,-hd],m1=[hw,hb,-hd],m2=[hw,hb,hd],m3=[-hw,hb,hd];
  const t0=[-iw,h,-id],t1=[iw,h,-id],t2=[iw,h,id],t3=[-iw,h,id];
  q(b1,b0,m0,m1); q(b3,b2,m2,m3); q(b2,b1,m1,m2); q(b0,b3,m3,m0);
  q(m1,m0,t0,t1); q(m3,m2,t2,t3); q(m2,m1,t1,t2); q(m0,m3,t3,t0);
  q(t3,t2,t1,t0); q(b0,b1,b2,b3);
  return bgFromTris(v);
}

export function spireGeo(rBase,h,twist){
  const rings=[{r:rBase,y:0,a:0},{r:rBase*0.8,y:h*0.45,a:twist*0.5},{r:rBase*0.48,y:h*0.78,a:twist}];
  const pt=(r,y,a,k)=>{ const ang=a + k*Math.PI/2 + Math.PI/4;
    return [Math.cos(ang)*r, y, Math.sin(ang)*r]; };
  const v=[];
  for(let i=0;i<rings.length-1;i++){
    const A=rings[i], B=rings[i+1];
    for(let k=0;k<4;k++){
      const a0=pt(A.r,A.y,A.a,k), a1=pt(A.r,A.y,A.a,k+1), b0=pt(B.r,B.y,B.a,k), b1=pt(B.r,B.y,B.a,k+1);
      v.push(...a1,...a0,...b0, ...a1,...b0,...b1);
    }
  }
  const T=rings[rings.length-1];
  for(let k=0;k<4;k++){
    const a0=pt(T.r,T.y,T.a,k), a1=pt(T.r,T.y,T.a,k+1);
    v.push(...a1,...a0, 0,h,0);
  }
  for(let k=0;k<4;k++){
    const a0=pt(rings[0].r,0,0,k), a1=pt(rings[0].r,0,0,k+1);
    v.push(...a0,...a1, 0,0,0);
  }
  return bgFromTris(v);
}

export function xg(g, x,y,z, rx,ry,rz, sx,sy,sz){
  const c = g.index ? g.toNonIndexed() : g.clone();
  _m.compose(_p.set(x,y,z), _q.setFromEuler(_E.set(rx,ry,rz)),
             _s.set(sx, sy===undefined?sx:sy, sz===undefined?sx:sz));
  c.applyMatrix4(_m);
  return c;
}

export function mergeGeos(list){
  let vc=0;
  for(const g of list) vc += g.attributes.position.count;
  const pos=new Float32Array(vc*3), nor=new Float32Array(vc*3), uv=new Float32Array(vc*2);
  let o=0;
  for(const g of list){
    pos.set(g.attributes.position.array, o*3);
    nor.set(g.attributes.normal.array, o*3);
    if(g.attributes.uv) uv.set(g.attributes.uv.array, o*2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos,3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor,3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv,2));
  return out;
}

export const tube = (a,b,c)=> new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a,b,c), 7, 0.055, 6, false);
const V3 = (x,y,z) => new THREE.Vector3(x,y,z);

export function boxUV(g){
  g.computeBoundingBox();
  const mn=g.boundingBox.min, mx=g.boundingBox.max;
  const sx=Math.max(1e-5,mx.x-mn.x), sy=Math.max(1e-5,mx.y-mn.y), sz=Math.max(1e-5,mx.z-mn.z);
  const p=g.attributes.position, n=g.attributes.normal, uv=g.attributes.uv;
  const f=t=>0.02+t*0.96;
  for(let i=0;i<p.count;i++){
    const ax=Math.abs(n.getX(i)), ay=Math.abs(n.getY(i)), az=Math.abs(n.getZ(i));
    let u,v;
    if(ay>=ax&&ay>=az){ u=(p.getX(i)-mn.x)/sx; v=(p.getZ(i)-mn.z)/sz; }
    else if(ax>=az)   { u=(p.getZ(i)-mn.z)/sz; v=(p.getY(i)-mn.y)/sy; }
    else              { u=(p.getX(i)-mn.x)/sx; v=(p.getY(i)-mn.y)/sy; }
    uv.setXY(i, f(u), f(v));
  }
  return g;
}

export const GEO = {};
GEO.floor   = boxUV(chamferBox(0.96,0.22,0.96,0.05).translate(0,-0.22,0));
GEO.wall    = boxUV(chamferBox(1,1,1,0.07));
GEO.wallCap = boxUV(chamferBox(1.09,0.13,1.09,0.035));
GEO.basin   = new THREE.BoxGeometry(1,0.55,1).translate(0,-0.43,0);
GEO.pillar  = mergeGeos([
  xg(chamferBox(0.68,0.15,0.68,0.035), 0,0,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.19,0.25,1.5,10), 0,0.89,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.27,0.27,0.07,10), 0,1.68,0, 0,0,0, 1),
  xg(chamferBox(0.55,0.14,0.55,0.03), 0,1.72,0, 0,0,0, 1)
]);
/* Default (ANCIENT-flavoured) doorway. Every theme's variant is built further
   down, next to the spawn-portal variants — see the DOORWAY block after the
   spawn geometry, and DOORWAY_THEMES in dungeon_generator.js for the wiring. */
GEO.archPost   = chamferBox(0.24,1.74,0.24,0.045);
GEO.archLintel = chamferBox(1,0.22,0.36,0.05);
GEO.gate       = chamferBox(1,1,0.08,0.015);
GEO.torch = mergeGeos([
  xg(new THREE.BoxGeometry(0.07,0.36,0.07), 0,0.16,0.07, -0.42,0,0, 1),
  xg(new THREE.CylinderGeometry(0.11,0.05,0.16,7), 0,0.36,0.15, 0,0,0, 1)
]);
GEO.flame     = new THREE.ConeGeometry(0.13,0.42,7).translate(0,0.21,0);
GEO.flameCore = new THREE.ConeGeometry(0.065,0.26,7).translate(0,0.13,0);
GEO.debrisA = xg(new THREE.IcosahedronGeometry(0.15,0), 0,0.05,0, 0,0,0, 1);
GEO.debrisB = mergeGeos([
  xg(new THREE.IcosahedronGeometry(0.13,0), 0,0.05,0, 0.3,0.5,0, 1),
  xg(new THREE.IcosahedronGeometry(0.09,0), 0.17,0.04,0.05, 0,1.1,0.4, 1),
  xg(new THREE.IcosahedronGeometry(0.07,0), -0.12,0.03,0.13, 0.7,0,0, 1)
]);
GEO.debrisC = xg(chamferBox(0.34,0.07,0.28,0.02), 0,0,0, 0,0.4,0.06, 1);
GEO.chestBody = mergeGeos([
  xg(chamferBox(0.8,0.36,0.52,0.04), 0,0,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.25,0.25,0.78,10,1,false,0,Math.PI).rotateZ(Math.PI/2), 0,0.36,0, 0,0,0, 1),
  xg(new THREE.CircleGeometry(0.25,8,0,Math.PI), 0.39,0.36,0, 0,Math.PI/2,0, 1),
  xg(new THREE.CircleGeometry(0.25,8,0,Math.PI), -0.39,0.36,0, 0,-Math.PI/2,0, 1)
]);
GEO.chestTrim = mergeGeos([
  xg(new THREE.BoxGeometry(0.07,0.4,0.55), -0.2,0.2,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.07,0.4,0.55), 0.2,0.2,0, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.26,0.036,6,10,Math.PI).rotateY(Math.PI/2), -0.2,0.36,0, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.26,0.036,6,10,Math.PI).rotateY(Math.PI/2), 0.2,0.36,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.11,0.16,0.06), 0,0.33,0.26, 0,0,0, 1)
]);
GEO.chestSeam = new THREE.BoxGeometry(0.6,0.045,0.03).translate(0,0.36,0.25);
GEO.grave = mergeGeos([
  xg(new THREE.BoxGeometry(0.36,0.5,0.09), 0,0.25,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.18,0.18,0.09,10,1,false,0,Math.PI).rotateX(Math.PI/2).rotateZ(Math.PI/2), 0,0.5,0, 0,0,0, 1)
]);
GEO.sarco = mergeGeos([
  xg(chamferBox(1.5,0.44,0.8,0.06), 0,0,0, 0,0,0, 1),
  xg(chamferBox(1.38,0.16,0.68,0.05), 0,0.44,0, 0,0,0, 1)
]);
GEO.candle = new THREE.CylinderGeometry(0.05,0.065,0.18,6).translate(0,0.09,0);
GEO.icicle = mergeGeos([
  xg(new THREE.ConeGeometry(0.075,0.5,6).rotateX(Math.PI), 0,-0.25,0, 0,0,0, 1),
  xg(new THREE.ConeGeometry(0.05,0.34,6).rotateX(Math.PI), 0.11,-0.17,0.04, 0,0,0, 1),
  xg(new THREE.ConeGeometry(0.04,0.26,5).rotateX(Math.PI), -0.09,-0.13,-0.05, 0,0,0, 1)
]);
GEO.shard = spireGeo(0.17,0.6,0.6);
GEO.roots = mergeGeos([
  xg(tube(V3(0,1.75,-0.1),  V3(0.05,1.1,0.42),  V3(0.5,0.02,0.75)), 0,0,0, 0,0,0, 1),
  xg(tube(V3(-0.1,1.6,-0.1),V3(-0.3,0.9,0.4),   V3(-0.55,0.02,0.9)), 0,0,0, 0,0,0, 1),
  xg(tube(V3(0.12,1.45,-0.08),V3(0.15,0.8,0.3), V3(0.05,0.02,1.1)), 0,0,0, 0,0,0, 1),
  xg(tube(V3(-0.02,1.2,-0.05),V3(-0.5,0.7,0.3), V3(-0.2,0.02,0.55)), 0,0,0, 0,0,0, 1)
]);
GEO.moss  = new THREE.CircleGeometry(0.42,9).rotateX(-Math.PI/2).translate(0,0.013,0);
GEO.crack = new THREE.PlaneGeometry(1.2,1.2).rotateX(-Math.PI/2).translate(0,0.016,0);
GEO.seal  = new THREE.PlaneGeometry(0.86,0.86).rotateX(-Math.PI/2).translate(0,0.02,0);
GEO.blot  = new THREE.PlaneGeometry(1.15,1.15).rotateX(-Math.PI/2).translate(0,0.018,0);
GEO.skirt = new THREE.PlaneGeometry(2.7,2.7).rotateX(-Math.PI/2).translate(0,0.02,0);
GEO.bannerRod = new THREE.CylinderGeometry(0.028,0.028,0.74,6).rotateZ(Math.PI/2);
GEO.bannerCloth = (()=>{
  const s = new THREE.Shape();
  s.moveTo(-0.27,0); s.lineTo(0.27,0); s.lineTo(0.27,-0.62); s.lineTo(0,-0.8); s.lineTo(-0.27,-0.62); s.closePath();
  return new THREE.ShapeGeometry(s);
})();
GEO.emblem = new THREE.PlaneGeometry(0.17,0.17).rotateZ(Math.PI/4);
GEO.barrel = mergeGeos([
  xg(new THREE.CylinderGeometry(0.32,0.32,0.64,10), 0,0.32,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.36,0.36,0.22,10), 0,0.32,0, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.33,0.02,6,12).rotateX(Math.PI/2), 0,0.12,0, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.33,0.02,6,12).rotateX(Math.PI/2), 0,0.52,0, 0,0,0, 1)
]);
GEO.crate = mergeGeos([
  xg(chamferBox(0.65,0.65,0.65,0.03), 0,0.325,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.67,0.08,0.67), 0,0.325,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.67,0.67,0.08), 0,0.325,0, 0,0,0, 1)
]);
GEO.table = mergeGeos([
  xg(chamferBox(1.2,0.08,0.7,0.02), 0,0.52,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.08,0.48,0.08), -0.5,0.24,-0.25, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.08,0.48,0.08), 0.5,0.24,-0.25, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.08,0.48,0.08), -0.5,0.24,0.25, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.08,0.48,0.08), 0.5,0.24,0.25, 0,0,0, 1)
]);
GEO.bench = mergeGeos([
  xg(chamferBox(1.0,0.05,0.32,0.015), 0,0.3,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.07,0.28,0.28), -0.4,0.14,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.07,0.28,0.28), 0.4,0.14,0, 0,0,0, 1)
]);
GEO.chair = mergeGeos([
  xg(chamferBox(0.38,0.05,0.38,0.015), 0,0.32,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.05,0.3,0.05), -0.14,0.15,-0.14, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.05,0.3,0.05), 0.14,0.15,-0.14, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.05,0.3,0.05), -0.14,0.15,0.14, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.05,0.3,0.05), 0.14,0.15,0.14, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.04,0.38,0.38), -0.15,0.52,0, 0,0,0, 1)
]);
GEO.bookshelf = mergeGeos([
  xg(chamferBox(0.9,1.6,0.35,0.03), 0,0.8,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.82,0.04,0.3), 0,0.45,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.82,0.04,0.3), 0,0.9,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.82,0.04,0.3), 0,1.35,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.18,0.32,0.22), -0.22,0.63,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.24,0.28,0.22), 0.05,0.61,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.16,0.35,0.22), -0.18,1.09,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.28,0.3,0.22), 0.18,1.07,0, 0,0,0, 1)
]);
GEO.weaponRack = mergeGeos([
  xg(new THREE.BoxGeometry(0.06,1.1,0.06), -0.4,0.55,-0.15, 0.2,0,0, 1),
  xg(new THREE.BoxGeometry(0.06,1.1,0.06), -0.4,0.55,0.15, -0.2,0,0, 1),
  xg(new THREE.BoxGeometry(0.06,1.1,0.06), 0.4,0.55,-0.15, 0.2,0,0, 1),
  xg(new THREE.BoxGeometry(0.06,1.1,0.06), 0.4,0.55,0.15, -0.2,0,0, 1),
  xg(new THREE.BoxGeometry(0.9,0.05,0.05), 0,0.9,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.9,0.05,0.05), 0,0.3,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.015,0.015,1.2,5), -0.2,0.6,0, 0,0,0.1, 1),
  xg(new THREE.CylinderGeometry(0.015,0.015,1.2,5), 0,0.6,0, 0,0,-0.08, 1),
  xg(new THREE.CylinderGeometry(0.015,0.015,1.2,5), 0.2,0.6,0, 0,0,0.06, 1)
]);
GEO.statue = mergeGeos([
  xg(chamferBox(0.8,0.45,0.8,0.05), 0,0.225,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.3,0.35,0.2,8), 0,0.55,0, 0,0,0, 1),
  xg(new THREE.ConeGeometry(0.25,1.1,6), 0,1.2,0, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.16,8,8), 0,1.85,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.08,0.9,0.08), 0.28,1.2,0.1, 0.2,0,0, 1)
]);
GEO.urn = mergeGeos([
  xg(new THREE.CylinderGeometry(0.18,0.12,0.12,10), 0,0.06,0, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.28,10,8), 0,0.34,0, 0,0,0, 1,1.1,1),
  xg(new THREE.CylinderGeometry(0.16,0.24,0.18,10), 0,0.65,0, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.18,0.025,6,12).rotateX(Math.PI/2), 0,0.74,0, 0,0,0, 1)
]);
GEO.rug = new THREE.PlaneGeometry(2.2,1.4).rotateX(-Math.PI/2).translate(0,0.017,0);
GEO.magicCircle = new THREE.PlaneGeometry(2.2,2.2).rotateX(-Math.PI/2).translate(0,0.019,0);
GEO.tapestry = mergeGeos([
  xg(new THREE.CylinderGeometry(0.025,0.025,1.1,6).rotateZ(Math.PI/2), 0,1.8,0, 0,0,0, 1),
  xg(new THREE.PlaneGeometry(0.9,1.4).translate(0,1.0,0), 0,0,0, 0,0,0, 1)
]);
GEO.treasureHeap = mergeGeos([
  xg(new THREE.ConeGeometry(0.55, 0.22, 10), 0,0.11,0, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.35, 8, 6), 0.1,0.08,0.1, 0,0,0, 1,0.4,1),
  xg(new THREE.IcosahedronGeometry(0.12, 0), -0.2,0.12,0.15, 0.3,0.5,0, 1),
  xg(new THREE.IcosahedronGeometry(0.1, 0), 0.18,0.1, -0.18, 0,0.8,0.2, 1)
]);
GEO.alchemyBench = mergeGeos([
  xg(chamferBox(1.3,0.1,0.75,0.02), 0,0.55,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.09,0.5,0.09), -0.55,0.25,-0.28, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.09,0.5,0.09), 0.55,0.25,-0.28, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.09,0.5,0.09), -0.55,0.25,0.28, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.09,0.5,0.09), 0.55,0.25,0.28, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.06,0.12,0.22,7), -0.3,0.71,-0.1, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.04,0.08,0.18,6), -0.12,0.69,-0.12, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.12,8,8), 0.25,0.72,0.05, 0,0,0, 1)
]);
GEO.hangingCage = mergeGeos([
  xg(new THREE.CylinderGeometry(0.02,0.02,1.2,5), 0,1.4,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.32,0.32,0.75,8,1,true), 0,0.42,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.34,0.34,0.06,8), 0,0.8,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.34,0.34,0.06,8), 0,0.04,0, 0,0,0, 1)
]);
GEO.webbing = new THREE.PlaneGeometry(1.1,1.1).rotateX(-Math.PI/3).translate(0,0.6,0);
GEO.shackle = mergeGeos([
  xg(new THREE.TorusGeometry(0.12,0.03,6,10), -0.22,1.1,0.05, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.12,0.03,6,10), 0.22,1.1,0.05, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.015,0.015,0.4,4), -0.22,1.3,0.03, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.015,0.015,0.4,4), 0.22,1.3,0.03, 0,0,0, 1)
]);
GEO.alcove = mergeGeos([
  xg(chamferBox(0.65,0.9,0.22,0.02), 0,0.9,0, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.12,7,6), 0,0.8,0.08, 0,0,0, 1)
]);
GEO.stalagmite = mergeGeos([
  xg(spireGeo(0.22, 1.25, 0.2), 0,0,0, 0,0,0, 1),
  xg(spireGeo(0.14, 0.85, -0.3), 0.18,0,-0.1, 0.1,0.2,-0.1, 1),
  xg(spireGeo(0.11, 0.65, 0.4), -0.15,0,0.12, -0.15,0,0.1, 1)
]);
GEO.scrollPedestal = mergeGeos([
  xg(chamferBox(0.45,0.8,0.45,0.03), 0,0.4,0, 0,0,0, 1),
  xg(chamferBox(0.55,0.08,0.45,0.02), 0,0.84,0, -0.25,0,0, 1),
  xg(new THREE.CylinderGeometry(0.03,0.03,0.4,6).rotateZ(Math.PI/2), 0,0.9,0, 0,0.2,0, 1)
]);
GEO.weaponRackShield = mergeGeos([
  xg(chamferBox(0.9,0.05,0.05,0.01), 0,0.9,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.06,1.1,0.06), -0.4,0.55,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.06,1.1,0.06), 0.4,0.55,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.26,0.26,0.04,10).rotateX(Math.PI/2), -0.18,0.55,0.1, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.26,0.26,0.04,10).rotateX(Math.PI/2), 0.18,0.55,0.1, 0,0,0, 1)
]);
GEO.potionPedestal = mergeGeos([
  xg(new THREE.CylinderGeometry(0.18,0.24,0.85,8), 0,0.425,0, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.14,8,8), 0,0.98,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.04,0.04,0.08,6), 0,1.14,0, 0,0,0, 1)
]);
GEO.charnelPile = mergeGeos([
  xg(new THREE.SphereGeometry(0.14,7,6), 0,0.1,0, 0,0,0, 1,0.5,1),
  xg(new THREE.SphereGeometry(0.08,6,6), 0.12,0.12,0.08, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.08,6,6), -0.1,0.09,-0.09, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.02,0.02,0.4,5).rotateZ(Math.PI/3), 0.05,0.05,-0.05, 0,0.5,0, 1),
  xg(new THREE.CylinderGeometry(0.02,0.02,0.35,5).rotateX(Math.PI/4), -0.05,0.04,0.06, 0,-0.3,0, 1)
]);
GEO.crystalCluster = mergeGeos([
  xg(new THREE.OctahedronGeometry(0.18,0), 0,0.25,0, 0.1,0,0.1, 1,1.4,1),
  xg(new THREE.OctahedronGeometry(0.13,0), 0.18,0.18,-0.08, 0.2,0.4,-0.15, 1,1.4,1),
  xg(new THREE.OctahedronGeometry(0.11,0), -0.15,0.14,0.12, -0.2,-0.3,0.1, 1,1.4,1)
]);

function makeColGeo(r1, r2, h) { return xg(new THREE.CylinderGeometry(r1, r2, h, 6), 0, h/2, 0, 0, 0, 0, 1); }
function makeCrysGeo(r, h) { return xg(new THREE.OctahedronGeometry(r, 0), 0, h/2, 0, 0, 0, 0, 1, h/(r*2), 1); }
function makeGothicSpikeGeo(r, h) {
  return mergeGeos([
    xg(new THREE.BoxGeometry(r*1.6, h*0.12, r*1.6), 0, h*0.06, 0, 0,0,0, 1),
    xg(new THREE.CylinderGeometry(r*0.7, r, h*0.6, 4).rotateY(Math.PI/4), 0, h*0.48, 0, 0,0,0, 1),
    xg(new THREE.ConeGeometry(r*0.7 * Math.sqrt(2), h*0.28, 4).rotateY(Math.PI/4), 0, h*0.86, 0, 0,0,0, 1)
  ]);
}
function makeShroomGeo(rCap, h) {
  return mergeGeos([
    xg(new THREE.CylinderGeometry(rCap*0.28, rCap*0.36, h*0.75, 8), 0, h*0.375, 0, 0,0,0, 1),
    xg(new THREE.SphereGeometry(rCap, 8, 6, 0, Math.PI*2, 0, Math.PI/2), 0, h*0.75, 0, 0,0,0, 1, h*0.25/rCap, 1)
  ]);
}

GEO.sconce = mergeGeos([
  xg(new THREE.BoxGeometry(0.06,0.28,0.06), 0,0.95,0.04, -0.3,0,0, 1),
  xg(new THREE.CylinderGeometry(0.08,0.04,0.12,7), 0,1.06,0.12, 0,0,0, 1)
]);
GEO.forge = mergeGeos([
  xg(chamferBox(0.7,0.45,0.7,0.04), 0,0.225,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.55,0.28,0.28), 0,0.59,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.08,0.08,0.12,6), 0.18,0.79,0, 0,0,0, 1)
]);
GEO.cauldron = mergeGeos([
  xg(new THREE.SphereGeometry(0.35,10,8, 0,Math.PI*2, 0,Math.PI*0.75), 0,0.3,0, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.36,0.03,6,12).rotateX(Math.PI/2), 0,0.55,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.03,0.03,0.3,5), -0.22,0.12,0, 0,0,0.4, 1),
  xg(new THREE.CylinderGeometry(0.03,0.03,0.3,5), 0.22,0.12,0, 0,0,-0.4, 1),
  xg(new THREE.CylinderGeometry(0.03,0.03,0.3,5), 0,0.12,0.22, -0.4,0,0, 1)
]);
GEO.ossuaryWall = mergeGeos([
  // outer frame / border — shallow against wall
  xg(chamferBox(0.92,1.4,0.08,0.015), 0,0.7,0, 0,0,0, 1),
  // recessed back panel (slightly darker area)
  xg(new THREE.BoxGeometry(0.76,1.2,0.04), 0,0.7,0.03, 0,0,0, 1),
  // stone shelf dividers (horizontal)
  xg(new THREE.BoxGeometry(0.82,0.04,0.10), 0,0.38,0.02, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.82,0.04,0.10), 0,0.72,0.02, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.82,0.04,0.10), 0,1.06,0.02, 0,0,0, 1),
  // decorative lintel across top
  xg(chamferBox(0.96,0.08,0.12,0.01), 0,1.38,0, 0,0,0, 1),
  // bottom tier skulls (3)
  xg(new THREE.SphereGeometry(0.08,6,6), -0.24,0.22,0.06, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.08,6,6),  0.00,0.22,0.06, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.08,6,6),  0.24,0.22,0.06, 0,0,0, 1),
  // middle tier skulls (2)
  xg(new THREE.SphereGeometry(0.08,6,6), -0.14,0.56,0.06, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.08,6,6),  0.14,0.56,0.06, 0,0,0, 1),
  // top tier skull (1)
  xg(new THREE.SphereGeometry(0.08,6,6),  0.00,0.90,0.06, 0,0,0, 1),
  // long bone fragments on shelves
  xg(new THREE.CylinderGeometry(0.018,0.018,0.28,5).rotateZ(Math.PI/2), -0.08,0.42,0.05, 0,0.3,0, 1),
  xg(new THREE.CylinderGeometry(0.018,0.018,0.22,5).rotateZ(Math.PI/2),  0.12,0.76,0.05, 0,-0.2,0, 1),
  xg(new THREE.CylinderGeometry(0.018,0.018,0.20,5).rotateZ(Math.PI/2), -0.05,1.10,0.05, 0,0.15,0, 1)
]);
GEO.sporePod = mergeGeos([
  xg(new THREE.SphereGeometry(0.38,9,8, 0,Math.PI*2, 0,Math.PI*0.75), 0,0.3,0, 0,0,0, 1,1.3,1),
  xg(new THREE.SphereGeometry(0.18,7,6), 0.22,0.2,-0.12, 0.2,0,-0.2, 1),
  xg(new THREE.SphereGeometry(0.15,7,6), -0.2,0.16,0.18, -0.2,0,0.3, 1)
]);
GEO.megalith = spireGeo(0.38, 2.1, 0.15);
GEO.wagon = mergeGeos([
  xg(chamferBox(1.3,0.35,0.85,0.03), 0,0.35,0, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.24,0.03,6,12), -0.45,0.24,0.44, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.24,0.03,6,12), 0.45,0.24,0.44, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.24,0.03,6,12), -0.45,0.24,-0.44, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.24,0.03,6,12), 0.45,0.24,-0.44, 0,0,0, 1)
]);
GEO.altarTable = mergeGeos([
  xg(chamferBox(1.4,0.3,0.8,0.04), 0,0.15,0, 0,0,0, 1),
  xg(chamferBox(1.2,0.35,0.65,0.03), 0,0.475,0, 0,0,0, 1)
]);
GEO.iceThrone = mergeGeos([
  xg(chamferBox(0.9,0.35,0.8,0.04), 0,0.175,0, 0,0,0, 1),
  xg(chamferBox(0.85,1.1,0.25,0.03), 0,0.9,-0.3, 0,0,0, 1),
  xg(makeCrysGeo(0.15, 0.9), -0.38,0.6,-0.28, 0,0,-0.2, 1),
  xg(makeCrysGeo(0.15, 0.9), 0.38,0.6,-0.28, 0,0,0.2, 1)
]);
GEO.globe = mergeGeos([
  xg(new THREE.CylinderGeometry(0.04,0.14,0.6,6), 0,0.3,0, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.28,0.025,6,14), 0,0.8,0, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.2,10,10), 0,0.8,0, 0,0,0, 1)
]);
GEO.spawn1 = mergeGeos([
  xg(new THREE.ConeGeometry(0.1,0.5,5), 0,0.24,0, 0,0,0.24, 1),
  xg(new THREE.ConeGeometry(0.085,0.42,5), 0.16,0.2,-0.06, 0.3,0,-0.3, 1),
  xg(new THREE.ConeGeometry(0.07,0.34,5), -0.13,0.17,0.11, -0.28,0,0.22, 1)
]);
GEO.spawn2 = spireGeo(0.17,1.15,0.5);
GEO.band2  = chamferBox(0.26,0.07,0.26,0.015);
GEO.spawn3 = spireGeo(0.22,1.65,0.85);
GEO.band3  = chamferBox(0.33,0.09,0.33,0.02);

GEO.spawn1_molten = mergeGeos([
  xg(makeColGeo(0.09, 0.11, 0.45), 0,0,0, 0,0,0.1, 1),
  xg(makeColGeo(0.075, 0.09, 0.35), 0.12,0,-0.04, 0.1,0.2,-0.1, 1),
  xg(makeColGeo(0.065, 0.08, 0.3), -0.1,0,0.08, -0.1,-0.15,0.12, 1)
]);
GEO.spawn2_molten = mergeGeos([
  xg(makeColGeo(0.15, 0.17, 1.15), 0,0,0, 0,0,-0.05, 1),
  xg(makeColGeo(0.1, 0.12, 0.8), 0.18,0,0.05, 0.08,0,0.12, 1),
  xg(makeColGeo(0.08, 0.1, 0.65), -0.15,0,-0.1, -0.1,0,-0.08, 1)
]);
GEO.spawn3_molten = mergeGeos([
  xg(makeColGeo(0.19, 0.22, 1.65), 0,0,0, 0,0,0.04, 1),
  xg(makeColGeo(0.13, 0.15, 1.2), 0.22,0,-0.1, 0.06,0,-0.08, 1),
  xg(makeColGeo(0.11, 0.13, 0.95), -0.22,0,0.12, -0.08,0,0.1, 1),
  xg(makeColGeo(0.09, 0.11, 0.7), 0.05,0,0.22, -0.05,0,-0.12, 1)
]);

GEO.spawn1_frost = mergeGeos([
  xg(makeCrysGeo(0.1, 0.5), 0,0,0, 0.1,0,0.15, 1),
  xg(makeCrysGeo(0.08, 0.38), 0.12,0,-0.05, 0.25,0.4,-0.2, 1),
  xg(makeCrysGeo(0.07, 0.32), -0.1,0,0.08, -0.2,-0.3,0.15, 1)
]);
GEO.spawn2_frost = mergeGeos([
  xg(makeCrysGeo(0.16, 1.15), 0,0,0, -0.05,0,0.08, 1),
  xg(makeCrysGeo(0.12, 0.8), 0.18,0,-0.08, 0.15,0.3,-0.12, 1),
  xg(makeCrysGeo(0.1, 0.65), -0.15,0,0.14, -0.18,-0.2,0.1, 1)
]);
GEO.spawn3_frost = mergeGeos([
  xg(makeCrysGeo(0.2, 1.65), 0,0,0, 0.08,0,-0.05, 1),
  xg(makeCrysGeo(0.14, 1.2), 0.22,0,0.1, 0.12,0.5,0.08, 1),
  xg(makeCrysGeo(0.12, 0.95), -0.22,0,-0.12, -0.15,-0.4,-0.1, 1),
  xg(makeCrysGeo(0.1, 0.7), -0.05,0,0.22, -0.1,0.2,0.18, 1)
]);

GEO.spawn1_grim = mergeGeos([
  xg(makeGothicSpikeGeo(0.08, 0.5), 0,0,0, 0,0,0.05, 1),
  xg(makeGothicSpikeGeo(0.065, 0.4), 0.12,0,-0.05, 0.1,0.2,-0.08, 1),
  xg(makeGothicSpikeGeo(0.055, 0.32), -0.1,0,0.08, -0.08,-0.15,0.06, 1)
]);
GEO.spawn2_grim = mergeGeos([
  xg(makeGothicSpikeGeo(0.15, 1.15), 0,0,0, 0,0,0, 1),
  xg(makeGothicSpikeGeo(0.09, 0.7), 0.18,0,0.08, 0.08,0,-0.05, 1)
]);
GEO.spawn3_grim = mergeGeos([
  xg(makeGothicSpikeGeo(0.2, 1.65), 0,0,0, 0,0,0, 1),
  xg(makeGothicSpikeGeo(0.12, 1.15), -0.22,0,-0.08, -0.05,0,0.05, 1),
  xg(makeGothicSpikeGeo(0.1, 0.9), 0.2,0,0.12, 0.06,0,-0.08, 1)
]);

GEO.spawn1_verdant = mergeGeos([
  xg(makeShroomGeo(0.16, 0.45), 0,0,0, 0.08,0,-0.05, 1),
  xg(makeShroomGeo(0.12, 0.35), 0.12,0,-0.06, 0.2,0.5,-0.15, 1),
  xg(makeShroomGeo(0.1, 0.28), -0.1,0,0.08, -0.15,-0.3,0.12, 1)
]);
GEO.spawn2_verdant = mergeGeos([
  xg(makeShroomGeo(0.32, 1.1), 0,0,0, 0.05,0,-0.05, 1),
  xg(makeShroomGeo(0.18, 0.65), 0.2,0,0.08, 0.15,0.4,-0.12, 1),
  xg(makeShroomGeo(0.14, 0.5), -0.18,0,-0.1, -0.12,-0.2,0.08, 1)
]);
GEO.spawn3_verdant = mergeGeos([
  xg(makeShroomGeo(0.42, 1.55), 0,0,0, 0,0,0, 1),
  xg(makeShroomGeo(0.24, 0.95), 0.24,0,-0.1, 0.1,0.2,-0.08, 1),
  xg(makeShroomGeo(0.18, 0.75), -0.22,0,0.12, -0.08,-0.15,0.06, 1),
  xg(makeShroomGeo(0.14, 0.55), 0.05,0,0.25, 0.05,0.3,0.12, 1)
]);
/* ─────────────────────── Themed doorways ───────────────────────────────
 * Every theme used to share one chamfered-box doorway tinted from TH.wall, so
 * a lava vault and an ice cavern had identical thresholds. Each theme now gets
 * its own post + lintel silhouette, resolved through DOORWAY_THEMES
 * (dungeon_generator.js) exactly like the spawn-portal variants above.
 *
 * The posts must stay within roughly the default 0.24 x 1.74 x 0.24 footprint:
 * the arch loop in dungeon_scene.js places them half a cell either side of a
 * doorway, and a fatter post would poke into the walkable gap.
 */

/* ANCIENT — fluted masonry: stepped base, tapered shaft, flared capital. */
GEO.archPost_ancient = mergeGeos([
  xg(chamferBox(0.30,0.12,0.30,0.02), 0,0.06,0, 0,0,0, 1),
  xg(chamferBox(0.26,0.10,0.26,0.02), 0,0.17,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.10,0.12,1.30,8), 0,0.87,0, 0,0,0, 1),
  xg(chamferBox(0.24,0.09,0.24,0.02), 0,1.56,0, 0,0,0, 1),
  xg(chamferBox(0.30,0.10,0.30,0.02), 0,1.66,0, 0,0,0, 1)
]);
/* keystone in the middle of a flat lintel */
GEO.archLintel_ancient = mergeGeos([
  xg(chamferBox(1,0.20,0.34,0.04), 0,0,0, 0,0,0, 1),
  xg(chamferBox(0.16,0.30,0.38,0.03), 0,0.04,0, 0,0,0, 1)
]);

/* MOLTEN — fractured basalt: chunky, canted blocks and a cracked lintel. */
GEO.archPost_molten = mergeGeos([
  xg(chamferBox(0.28,0.52,0.28,0.03), 0,0.26,0, 0,0.10,0.02, 1),
  xg(chamferBox(0.24,0.46,0.25,0.03), 0,0.75,0, 0,-0.14,-0.03, 1),
  xg(chamferBox(0.26,0.44,0.24,0.03), 0,1.20,0, 0,0.20,0.02, 1),
  xg(chamferBox(0.22,0.26,0.22,0.02), 0,1.55,0, 0,-0.10,0, 1)
]);
GEO.archLintel_molten = mergeGeos([
  xg(chamferBox(1,0.24,0.36,0.03), 0,0,0, 0,0,0, 1),
  xg(new THREE.ConeGeometry(0.09,0.20,4), -0.26,-0.16,0, Math.PI,0,0, 1),
  xg(new THREE.ConeGeometry(0.07,0.16,4), 0.22,-0.14,0, Math.PI,0,0.2, 1)
]);

/* FROST — rimed ice: faceted tapering columns under a crystal lintel. */
GEO.archPost_frost = mergeGeos([
  xg(new THREE.CylinderGeometry(0.14,0.17,0.30,6), 0,0.15,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.09,0.14,1.24,6), 0,0.92,0, 0,0.3,0, 1),
  xg(new THREE.OctahedronGeometry(0.13,0), 0,1.62,0, 0,0.4,0, 1,1.5,1)
]);
GEO.archLintel_frost = mergeGeos([
  xg(chamferBox(1,0.16,0.30,0.03), 0,0,0, 0,0,0, 1),
  xg(new THREE.OctahedronGeometry(0.13,0), 0,0.10,0, 0,0.5,0, 1,1.2,1),
  xg(new THREE.ConeGeometry(0.06,0.22,5), -0.30,-0.16,0, Math.PI,0,0, 1),
  xg(new THREE.ConeGeometry(0.05,0.17,5), 0.28,-0.13,0, Math.PI,0,0, 1)
]);

/* GRIM — gothic iron: narrow barbed posts and a pointed, spiked lintel. */
GEO.archPost_grim = mergeGeos([
  xg(chamferBox(0.28,0.10,0.28,0.02), 0,0.05,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.085,0.10,1.42,4).rotateY(Math.PI/4), 0,0.81,0, 0,0,0, 1),
  xg(new THREE.ConeGeometry(0.10,0.24,4).rotateY(Math.PI/4), 0,1.62,0, 0,0,0, 1),
  xg(new THREE.ConeGeometry(0.05,0.16,4), 0.13,1.10,0, 0,0,-1.45, 1),
  xg(new THREE.ConeGeometry(0.05,0.16,4), -0.13,0.78,0, 0,0,1.45, 1)
]);
GEO.archLintel_grim = mergeGeos([
  xg(chamferBox(1,0.15,0.30,0.02), 0,0,0, 0,0,0, 1),
  xg(new THREE.ConeGeometry(0.11,0.26,4).rotateY(Math.PI/4), 0,0.16,0, 0,0,0, 1),
  xg(new THREE.ConeGeometry(0.05,0.18,4), -0.32,0.12,0, 0,0,0, 1),
  xg(new THREE.ConeGeometry(0.05,0.18,4), 0.32,0.12,0, 0,0,0, 1)
]);

/* VERDANT — overgrown: knotted root posts under a living branch lintel. */
GEO.archPost_verdant = mergeGeos([
  xg(new THREE.CylinderGeometry(0.13,0.16,0.36,7), 0,0.18,0, 0,0,0.03, 1),
  xg(new THREE.CylinderGeometry(0.10,0.13,0.62,7), 0,0.66,0, 0,0,-0.05, 1),
  xg(new THREE.SphereGeometry(0.13,7,5), 0,1.02,0, 0,0,0, 1,0.8,1),
  xg(new THREE.CylinderGeometry(0.085,0.11,0.58,7), 0,1.36,0, 0,0,0.04, 1),
  /* a root spilling off the side */
  xg(new THREE.CylinderGeometry(0.035,0.05,0.34,5), 0.11,0.50,0.02, 0.1,0,-0.9, 1)
]);
GEO.archLintel_verdant = mergeGeos([
  xg(new THREE.CylinderGeometry(0.11,0.11,1,7).rotateZ(Math.PI/2), 0,0,0, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.12,7,5), -0.22,0.02,0, 0,0,0, 1,0.85,1),
  xg(new THREE.SphereGeometry(0.10,7,5), 0.26,-0.01,0, 0,0,0, 1,0.85,1),
  /* a couple of vines trailing down into the opening */
  xg(new THREE.CylinderGeometry(0.025,0.035,0.30,5), -0.34,-0.18,0.04, 0,0,0.2, 1),
  xg(new THREE.CylinderGeometry(0.022,0.03,0.22,5), 0.30,-0.14,-0.04, 0,0,-0.18, 1)
]);

/* OVERLAND — a waymarked threshold rather than a built door: two leaning
   standing stones under a lashed timber crossbeam. Used for trail gates and
   the palisade entrance on every open-terrain biome. */
GEO.archPost_overland = mergeGeos([
  xg(chamferBox(0.26,1.30,0.22,0.05), 0,0.65,0, 0,0.12,0.055, 1),
  xg(chamferBox(0.20,0.26,0.18,0.04), 0,1.42,0, 0,0.12,0.09, 1)
]);
GEO.archLintel_overland = mergeGeos([
  xg(new THREE.CylinderGeometry(0.09,0.09,1,6).rotateZ(Math.PI/2), 0,0,0, 0,0,0.02, 1),
  /* lashings at either end */
  xg(new THREE.TorusGeometry(0.11,0.022,5,10).rotateY(Math.PI/2), -0.30,0,0, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.11,0.022,5,10).rotateY(Math.PI/2), 0.30,0,0, 0,0,0, 1)
]);

GEO.bossShard = spireGeo(0.34,2.3,0.7);
GEO.plinth   = chamferBox(0.92,0.5,0.92,0.06);
GEO.platform = chamferBox(2.35,0.14,2.35,0.06);
GEO.crystal = mergeGeos([
  xg(new THREE.OctahedronGeometry(0.3,0), 0,0,0, 0,0,0, 1,1.45,1),
  xg(new THREE.OctahedronGeometry(0.16,0), 0,0.34,0, 0,0.6,0, 1,1.4,1)
]);
GEO.ring     = new THREE.TorusGeometry(0.95,0.07,8,30).rotateX(-Math.PI/2);
GEO.portal   = new THREE.CircleGeometry(0.86,24).rotateX(-Math.PI/2);
GEO.runeRing = new THREE.RingGeometry(1.5,2.3,48).rotateX(-Math.PI/2);
GEO.shaft    = new THREE.CylinderGeometry(0.45,1.7,6,12,1,true).translate(0,3,0);
GEO.brazier = mergeGeos([
  xg(new THREE.BoxGeometry(0.07,0.5,0.07), 0.16,0.25,0, 0,0,-0.25, 1),
  xg(new THREE.BoxGeometry(0.07,0.5,0.07), -0.08,0.25,0.14, 0.22,0,0.13, 1),
  xg(new THREE.BoxGeometry(0.07,0.5,0.07), -0.08,0.25,-0.14, -0.22,0,0.13, 1),
  xg(new THREE.CylinderGeometry(0.32,0.16,0.26,9), 0,0.52,0, 0,0,0, 1)
]);
GEO.coals = mergeGeos([
  xg(new THREE.IcosahedronGeometry(0.09,0), 0,0.63,0.03, 0,0,0, 1),
  xg(new THREE.IcosahedronGeometry(0.07,0), 0.1,0.62,-0.06, 0,0.5,0, 1),
  xg(new THREE.IcosahedronGeometry(0.06,0), -0.1,0.61,-0.02, 0.4,0,0, 1)
]);
GEO.treeTrunk = new THREE.CylinderGeometry(0.15,0.24,1,7).translate(0,0.5,0);
GEO.treeCanopy = mergeGeos([
  xg(new THREE.ConeGeometry(0.74,0.95,7), 0,0.47,0, 0,0,0, 1),
  xg(new THREE.ConeGeometry(0.58,0.82,7), 0,0.98,0, 0,0.5,0, 1),
  xg(new THREE.ConeGeometry(0.40,0.68,7), 0,1.45,0, 0,1.0,0, 1)
]);
GEO.tent = mergeGeos([
  xg(new THREE.ConeGeometry(0.95,1.05,4), 0,0.52,0, 0,Math.PI/4,0, 1),
  xg(new THREE.CylinderGeometry(0.035,0.035,1.32,5), 0,0.62,0, 0,0,0, 1)
]);
GEO.bone = mergeGeos([
  xg(new THREE.CylinderGeometry(0.024,0.024,0.34,5).rotateZ(Math.PI/2), 0,0.03,0, 0,0.4,0, 1),
  xg(new THREE.CylinderGeometry(0.02,0.02,0.3,5).rotateZ(Math.PI/2), 0.04,0.05,0.06, 0,-0.7,0, 1),
  xg(new THREE.SphereGeometry(0.08,7,6), -0.12,0.08,-0.09, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.07,0.05,0.06), -0.12,0.03,-0.03, 0,0,0, 1)
]);

GEO.skull = mergeGeos([
  xg(new THREE.SphereGeometry(0.13, 10, 8), 0, 0.12, 0, 0, 0, 0, 1, 0.92, 1.1),
  xg(new THREE.BoxGeometry(0.12, 0.08, 0.1), 0, 0.04, 0.05, 0.12, 0, 0, 1),
  xg(new THREE.BoxGeometry(0.035, 0.035, 0.04), -0.04, 0.11, 0.1, 0, 0, 0, 1),
  xg(new THREE.BoxGeometry(0.035, 0.035, 0.04),  0.04, 0.11, 0.1, 0, 0, 0, 1),
  xg(new THREE.BoxGeometry(0.02, 0.03, 0.03), 0, 0.08, 0.1, 0, 0, 0, 1)
]);

GEO.skeleton = mergeGeos([
  xg(GEO.skull, 0.35, 0.06, 0, 0.2, 0.4, -0.3, 0.9),
  xg(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 6).rotateZ(Math.PI/2), 0.05, 0.03, 0, 0, 0.1, 0, 1),
  xg(new THREE.TorusGeometry(0.11, 0.018, 5, 10, Math.PI*1.2).rotateX(Math.PI/2), 0.18, 0.07, 0, 0, 0, 0.2, 1),
  xg(new THREE.TorusGeometry(0.12, 0.018, 5, 10, Math.PI*1.2).rotateX(Math.PI/2), 0.12, 0.07, 0, 0, 0, 0.1, 1),
  xg(new THREE.TorusGeometry(0.11, 0.018, 5, 10, Math.PI*1.2).rotateX(Math.PI/2), 0.06, 0.06, 0, 0, 0, 0, 1),
  xg(new THREE.TorusGeometry(0.09, 0.018, 5, 10, Math.PI*1.2).rotateX(Math.PI/2), 0.00, 0.05, 0, 0, 0, -0.1, 1),
  xg(new THREE.BoxGeometry(0.16, 0.04, 0.12), -0.22, 0.03, 0, 0, 0.2, 0, 1),
  xg(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 5).rotateZ(Math.PI/2), -0.42, 0.03, 0.08, 0, 0.25, 0, 1),
  xg(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 5).rotateZ(Math.PI/2), -0.4, 0.03, -0.09, 0, -0.3, 0, 1),
  xg(new THREE.CylinderGeometry(0.016, 0.016, 0.35, 5).rotateZ(Math.PI/2), 0.1, 0.03, 0.2, 0, 0.7, 0, 1),
  xg(new THREE.CylinderGeometry(0.016, 0.016, 0.35, 5).rotateZ(Math.PI/2), 0.08, 0.03, -0.22, 0, -0.6, 0, 1)
]);

GEO.bonePile = mergeGeos([
  xg(GEO.skull, 0, 0.07, 0, 0.3, 0.5, 0.1, 0.95),
  xg(GEO.skull, -0.18, 0.05, 0.12, -0.4, 1.2, 0.3, 0.8),
  xg(new THREE.CylinderGeometry(0.02, 0.02, 0.48, 5).rotateZ(Math.PI/2), 0.02, 0.03, 0, 0.1, 0.6, 0.1, 1),
  xg(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 5).rotateZ(Math.PI/2), -0.05, 0.04, 0.02, -0.2, -0.8, 0.15, 1),
  xg(new THREE.CylinderGeometry(0.018, 0.018, 0.4, 5).rotateZ(Math.PI/2), 0.12, 0.02, -0.1, 0.3, 0.2, -0.1, 1),
  xg(new THREE.CylinderGeometry(0.018, 0.018, 0.38, 5).rotateZ(Math.PI/2), -0.1, 0.03, -0.12, -0.3, -0.4, 0.2, 1),
  xg(new THREE.SphereGeometry(0.06, 6, 5), 0.22, 0.04, 0.14, 0, 0, 0, 1),
  xg(new THREE.SphereGeometry(0.05, 6, 5), -0.25, 0.03, -0.15, 0, 0, 0, 1)
]);

/* A quarter-disc that hangs in the inside corner of a room: hub at the corner
   post, its two straight edges running along the two wall faces that meet there,
   and the free rim sagging between them. Symmetric about the diagonal, so it
   reads the same whichever wall you're looking along.

   UVs are the fan's own parameters — u along the strands, v from hub to rim —
   because matWeb's texture is drawn in exactly that space. bgFromTris' world-space
   UV projection would sample it as noise, so this builds its attributes by hand. */
function makeWebMesh(){
  const R = 0.82, HUB = 1.72, NR = 9, NG = 6;
  const at = (i, k) => {
    const a = (i / (NR - 1)) * (Math.PI / 2);
    /* Edges stay near the walls; the sag peaks on the diagonal and grows with
       distance from the hub, the way a slack sheet of silk actually hangs. */
    const sag = k * (0.10 + 0.42 * Math.sin(2 * a) * k);
    return [Math.cos(a) * R * k, HUB - sag, Math.sin(a) * R * k];
  };
  const pos = [], uv = [];
  const push = (i, k) => { const p = at(i, k); pos.push(p[0], p[1], p[2]); uv.push(i / (NR - 1), k); };
  for(let r=0; r<NG; r++){
    const k0 = r / NG, k1 = (r + 1) / NG;
    for(let i=0; i<NR-1; i++){
      push(i, k0); push(i+1, k0); push(i, k1);
      push(i+1, k0); push(i+1, k1); push(i, k1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.computeVertexNormals();
  return g;
}
GEO.spiderWeb = makeWebMesh();
