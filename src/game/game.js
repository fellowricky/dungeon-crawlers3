/**
 * Dungeon Crawlers — game controller.
 * Heroes explore autonomously (Clickpocalypse-style); the player watches,
 * clicks potions, and builds the party. Combat math is SRD 5.1.
 */
import * as THREE from 'three';
import { makeHero, normalizeHero, grantXp, heroAttackBonus, heroDamage, spawnMonster,
         recalc, canEquip, pendingPoints, spendAbilityPoint, spendSkillPoint,
         subclassOf, pickSubclass, SUBCLASSES,
         CLASSES, RACES, roll, d as die, mod, profBonus, MONSTER_THEMES } from './srd.js';
import { makeHeroMesh, makeMonsterMesh, drawBar, makeFloatText, updateFloatTexts,
         hitFlash, updateFlash, spawnProjectile, spawnSlash, updateProjectiles, clearEffects, spawnSpriteEffect } from './entities.js';
import { rollChestLoot, rollItem, slotsFor } from './items.js';
import { log, buildPartyFrames, updatePartyFrames, updateResources, showBanner, showSetup } from './ui.js';
import { initMenus, refreshMenus } from './menus.js';
import { initShop, showShop } from './shop.js';

const FLOOR = 1, WALL = 2;
const THEME_ORDER = ['ancient','verdant','frost','grim','molten'];
const SAVE_KEY = 'dungeon-crawlers-save-v1';

const HERO_SPEED = 3.1;
const AGGRO_RANGE = 8.5;
const HERO_ATTACK_CD = 2.2;    // slower, more deliberate exchanges
const MONSTER_ATTACK_CD = 2.6;
const XP_SHARE = 0.15;         // each living hero gets xp * this (deliberate but not glacial)
const REVEAL_RADIUS = 4.5;
const COHESION_MAX = 4.6;      // leader waits if any ally is farther than this
const COMBAT_SPEED = 0.72;     // fraction of move speed used for combat repositioning

const _v = new THREE.Vector3();

class Game {
  constructor(){
    this.state = 'boot';
    this.engine = null;
    this.D = null;
    this.heroes = [];
    this.monsters = [];
    this.chests = [];
    this.shrines = [];
    this.gold = 0;
    this.potions = { heal:2, greater:0 };
    this.inventory = [];
    this.dungeonLevel = 1;
    this.follow = null;
    this.freeCamUntil = 0;
    this.elapsed = 0;
    this.gameGroup = null;
    this.saveTimer = 0;
    this.paused = false;
  }

  /* ============ boot / setup ============ */
  init(engine){
    this.engine = engine;
    const save = this.loadSave();
    showSetup(!!save,
      slots => {                                  // Embark with new party
        this.heroes = slots.map(s => ({ data: makeHero(s.name, s.raceKey, s.classKey, s.baseStats, s.visual) }));
        this.gold = 0; this.potions = { heal:2, greater:0 }; this.inventory = []; this.dungeonLevel = 1;
        this.beginRun();
      },
      () => {                                     // Continue saved party
        this.heroes = save.heroes.map(h => ({ data: normalizeHero(h) }));
        this.gold = save.gold; this.potions = save.potions;
        this.inventory = save.inventory || [];
        this.dungeonLevel = save.dungeonLevel;
        this.beginRun();
      });

    document.getElementById('potheal').addEventListener('click', ()=>this.drinkPotion('heal'));
    document.getElementById('potgreater').addEventListener('click', ()=>this.drinkPotion('greater'));
    initMenus(this);
    initShop(this);
  }

  beginRun(){
    buildPartyFrames(this.heroes.map(h=>h.data));
    updateResources(this);
    log(`A party of ${this.heroes.length} sets out. Good luck — they won't need your help. Mostly.`, 'sys');
    this.nextDungeon(true);
  }

  nextDungeon(first=false){
    this.state = 'transition';
    const lvl = this.dungeonLevel;
    const seed = 1 + Math.floor(Math.random()*999999);
    const roomCount = Math.min(70, 16 + lvl*4);
    const themeKey = THEME_ORDER[(lvl-1) % THEME_ORDER.length];
    for(const h of this.heroes){
      h.data.hp = Math.min(h.data.maxHp, Math.max(h.data.hp, Math.round(h.data.maxHp*0.5)));
      h.data.secondWindUsed = false;
      if(CLASSES[h.data.classKey].healer) h.data.healSlots = h.data.healSlotsMax;
      /* a new floor is a long rest: every ability tier recharges */
      h.data.abilityUsed = { short:false, day:false };
      h.data.slots = h.data.slotsMax || 0;
    }
    this.engine.reforge(seed, roomCount, themeKey, false);   // instant build; fog does the reveal
    if(!first) this.saveGame();
  }

  /* ============ dungeon load (called by engine forge) ============ */
  onDungeon(d){
    if(this.state === 'boot') return;             // backdrop forge before party exists
    this.D = d;
    const eng = this.engine;

    if(this.gameGroup){ eng.scene.remove(this.gameGroup); }
    clearEffects(eng.scene);
    this.gameGroup = new THREE.Group();
    eng.scene.add(this.gameGroup);

    const { W, H, grid, roomId, rooms } = d;
    this.wx = x => x - W/2 + 0.5;
    this.wz = y => y - H/2 + 0.5;
    this.cellOf = (x,z) => {
      const cx = Math.round(x + W/2 - 0.5), cy = Math.round(z + H/2 - 0.5);
      return (cx<0||cy<0||cx>=W||cy>=H) ? -1 : cy*W + cx;
    };

    /* Precompute wall-adjacency for pathfinding tiebreaker —
       cells next to a wall are less desirable waypoints so paths
       prefer centre routes through rooms. */
    const total = W * H;
    const wallAdj = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      if (grid[i] !== FLOOR) continue;
      const x = i % W;
      if ((x > 0 && grid[i - 1] === WALL) ||
          (x < W - 1 && grid[i + 1] === WALL) ||
          (i >= W && grid[i - W] === WALL) ||
          (i < total - W && grid[i + W] === WALL)) {
        wallAdj[i] = 1;
      }
    }
    d.wallAdj = wallAdj;

    /* --- fog: map cells -> instance indices (must match buildScene order) --- */
    this.floorInst = new Int32Array(W*H).fill(-1);
    this.wallInst  = new Int32Array(W*H).fill(-1);
    let fi=0, wi=0;
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      const c = y*W+x;
      if(grid[c]===FLOOR && !d.lakeMask[c]) this.floorInst[c] = fi++;
      else if(grid[c]===WALL) this.wallInst[c] = wi++;
    }
    this.revealed = new Uint8Array(W*H);
    this.visitedRooms = new Uint8Array(rooms.length);
    this.fogAll();

    /* --- room anchors (nearest floor cell to each room center) --- */
    this.roomAnchor = rooms.map(r=>{
      let c = r.cy*W + r.cx;
      if(grid[c]===FLOOR) return c;
      for(let rad=1; rad<6; rad++)
        for(let oy=-rad;oy<=rad;oy++) for(let ox=-rad;ox<=rad;ox++){
          const nx=r.cx+ox, ny=r.cy+oy;
          if(nx>=0&&ny>=0&&nx<W&&ny<H && grid[ny*W+nx]===FLOOR && roomId[ny*W+nx]===r.id) return ny*W+nx;
        }
      return c;
    });

    /* --- monsters from generator spawn data --- */
    this.monsters = [];
    const roomThemes = {};
    for(const sp of d.spawns){
      if (roomThemes[sp.roomId] === undefined) {
        // Assign a theme to the room based on roomId so it is consistent
        roomThemes[sp.roomId] = MONSTER_THEMES[sp.roomId % MONSTER_THEMES.length];
      }
      const theme = roomThemes[sp.roomId];
      const allowedNames = theme ? theme.monsters[sp.tier] : null;
      const m = spawnMonster(sp.tier, this.dungeonLevel, Math.random, allowedNames);
      this.addMonster(m, sp.x, sp.y, sp.roomId);
    }
    /* boss */
    const br = rooms[d.boss];
    const bossSpec = spawnMonster('boss', this.dungeonLevel, Math.random);
    const ba = this.roomAnchor[d.boss];
    this.addMonster(bossSpec, (ba%W)+1, Math.floor(ba/W), d.boss, true);
    this.boss = this.monsters[this.monsters.length-1];

    /* --- interactables --- */
    this.chests = d.props.filter(p=>p.kind==='chest').map(p=>({x:p.x, y:p.y, roomId:p.roomId, looted:false}));
    this.shrines = d.props.filter(p=>p.kind==='shrineCrystal').map(p=>({x:p.x, y:p.y, roomId:p.roomId, used:false}));

    /* --- heroes at entrance --- */
    const ea = this.roomAnchor[d.entrance];
    const ex = ea % W, ey = Math.floor(ea/W);
    this.heroes.forEach((h,i)=>{
      if(h.ent) { /* rebuild visuals per dungeon */ }
      h.ent = makeHeroMesh(h.data);
      h.x = this.wx(ex + (i%2===0?-0.5:0.5));
      h.z = this.wz(ey + (i<2?-0.5:0.5));
      h.ent.grp.position.set(h.x, 0, h.z);
      h.path = null; h.pathI = 0; h.cd = Math.random();
      h.target = null; h.repathT = 0; h.walkPhase = Math.random()*6;
      this.gameGroup.add(h.ent.grp);
      drawBar(h.ent.bar, Math.max(0,h.data.hp/h.data.maxHp));
    });
    this.leaderTrail = [];
    this.targetRoom = -1;
    this.userGoal = -1;
    this.combat = false;
    this.wipeT = 0;
    this.completeT = 0;

    this.visitRoom(d.entrance, true);
    this.state = 'crawl';
    const themeLabel = d.params.themeKey.toUpperCase();
    log(`— Floor ${this.dungeonLevel}: ${d.name} (${themeLabel}) —`, 'sys');
    showBanner(d.name, `Floor ${this.dungeonLevel} · ${d.stats.rooms} rooms`);
    updateResources(this);
    updatePartyFrames(this.heroes.map(h=>h.data));
    refreshMenus(this);
  }

  addMonster(spec, x, y, roomId, isBoss=false){
    const m = { data: spec, x: this.wx(x), z: this.wz(y), roomId, isBoss,
                active:false, path:null, pathI:0, cd:Math.random()*2, repathT:0,
                walkPhase: Math.random()*6 };
    m.ent = makeMonsterMesh(spec);
    m.ent.grp.position.set(m.x, 0, m.z);
    m.ent.grp.visible = false;
    this.gameGroup.add(m.ent.grp);
    this.monsters.push(m);
  }

  /* ============ fog of war ============ */
  fogAll(){
    const { floor, wall, wallCap } = this.engine.getMeshes();
    this.dimInstances(floor, null);
    this.dimInstances(wall, null);
    this.dimInstances(wallCap, null);
  }
  dimInstances(mesh, only){
    if(!mesh) return;
    const set = mesh.userData.set;
    const c = new THREE.Color();
    for(let i=0;i<set.n;i++){
      if(only && !only.has(i)) continue;
      mesh.setColorAt(i, c.set(set.col[i]).multiplyScalar(0.055));
    }
    if(mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  revealCell(c){
    if(this.revealed[c]) return;
    this.revealed[c] = 1;
    const { floor, wall, wallCap } = this.engine.getMeshes();
    const col = new THREE.Color();
    const fi = this.floorInst[c];
    if(fi>=0 && floor){
      floor.setColorAt(fi, col.set(floor.userData.set.col[fi]));
      floor.instanceColor.needsUpdate = true;
    }
    const wiN = this.wallInst[c];
    if(wiN>=0){
      if(wall){ wall.setColorAt(wiN, col.set(wall.userData.set.col[wiN])); wall.instanceColor.needsUpdate = true; }
      if(wallCap){ wallCap.setColorAt(wiN, col.set(wallCap.userData.set.col[wiN])); wallCap.instanceColor.needsUpdate = true; }
    }
  }
  revealAround(cell, radius){
    const { W, H } = this.D;
    const cx = cell % W, cy = Math.floor(cell / W);
    const r = Math.ceil(radius);
    for(let oy=-r;oy<=r;oy++) for(let ox=-r;ox<=r;ox++){
      if(ox*ox+oy*oy > radius*radius) continue;
      const nx=cx+ox, ny=cy+oy;
      if(nx<0||ny<0||nx>=W||ny>=H) continue;
      this.revealCell(ny*W+nx);
    }
  }
  visitRoom(rid, silent=false){
    if(rid<0 || this.visitedRooms[rid]) return;
    this.visitedRooms[rid] = 1;
    const { W, H, roomId, rooms } = this.D;
    const r = rooms[rid];
    /* reveal the whole room plus its wall ring */
    const x0=Math.max(0,Math.floor(r.cx-r.w/2)-1), x1=Math.min(W-1,Math.ceil(r.cx+r.w/2)+1);
    const y0=Math.max(0,Math.floor(r.cy-r.h/2)-1), y1=Math.min(H-1,Math.ceil(r.cy+r.h/2)+1);
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
      const c=y*W+x;
      if(roomId[c]===rid || this.D.grid[c]===WALL) this.revealCell(c);
    }
    for(const m of this.monsters) if(m.roomId===rid && m.data.hp>0) m.ent.grp.visible = true;
    if(silent) return;
    const flavor = {
      combat:'The party presses on.',
      elite:'⚠ An elite guard room! Steel yourselves.',
      treasure:'✨ A treasure vault glitters ahead!',
      shrine:'🔮 A shrine hums with restorative magic.',
      boss:'💀 The boss lair. This is it.',
      entrance:''
    }[r.type];
    if(flavor) log(flavor, r.type);
  }

  /* ============ pathfinding (BFS, uniform cost) ============ */
  findPath(from, to){
    const { W, H, grid } = this.D;
    if(from===to || from<0 || to<0) return null;
    if(grid[to]!==FLOOR) return null;
    const par = new Int32Array(W*H).fill(-2);
    par[from] = -1;
    const q = new Int32Array(W*H); let qh=0, qt=0;
    q[qt++] = from;
    const total = W*H;
    const wallAdj = this.D.wallAdj;
    while(qh<qt){
      const c = q[qh++];
      if(c===to) break;
      const x = c % W;
      /* Collect unvisited neighbours, then sort so non-wall-adjacent
         cells are explored first — this biases BFS toward centre-room
         paths without changing the hop-count distance. */
      const nb = [];
      let n;
      if(x>0       && grid[n=c-1]===FLOOR && par[n]===-2){ nb.push(n); }
      if(x<W-1     && grid[n=c+1]===FLOOR && par[n]===-2){ nb.push(n); }
      if(c>=W      && grid[n=c-W]===FLOOR && par[n]===-2){ nb.push(n); }
      if(c<total-W && grid[n=c+W]===FLOOR && par[n]===-2){ nb.push(n); }
      if(nb.length>1) nb.sort((a,b)=>wallAdj[a]-wallAdj[b]);
      for(const nn of nb){ par[nn]=c; q[qt++]=nn; }
    }
    if(par[to]===-2) return null;
    const path = [];
    for(let c=to; c!==-1; c=par[c]) path.push(c);
    path.reverse();
    return path;
  }
  hasLOS(x0,z0,x1,z1){
    const { W } = this.D;
    const dx=x1-x0, dz=z1-z0;
    const dist = Math.hypot(dx,dz);
    const steps = Math.ceil(dist*3);
    for(let i=1;i<steps;i++){
      const t=i/steps;
      const c = this.cellOf(x0+dx*t, z0+dz*t);
      if(c<0 || this.D.grid[c]===WALL) return false;
    }
    return true;
  }

  /* move entity along its path; returns true if moving.
     Wall repulsion is applied after each position update to keep
     sprites from clipping into wall geometry. */
  stepAlong(e, speed, dt){
    if(!e.path || e.pathI >= e.path.length) return false;
    const { W } = this.D;
    const c = e.path[e.pathI];
    const tx = this.wx(c % W), tz = this.wz(Math.floor(c / W));
    const dx = tx - e.x, dz = tz - e.z;
    const dist = Math.hypot(dx, dz);
    const step = speed * dt;
    if(dist <= step){
      e.x = tx; e.z = tz; e.pathI++;
      this.wallRepel(e);
      return e.pathI < e.path.length;
    }
    e.x += dx/dist*step; e.z += dz/dist*step;
    this.wallRepel(e);
    e.ent.grp.rotation.y = Math.atan2(dx, dz);
    return true;
  }

  /* Push entity away from nearby walls — prevents sprite clipping
     and keeps heroes centred in corridors instead of hugging walls.
     Uses a soft falloff so repulsion is gentle at normal distances
     and ramps up only when the entity drifts too close. */
  wallRepel(e){
    const { W, H, grid } = this.D;
    const cx = this.cellOf(e.x, e.z);
    if(cx < 0) return;
    const cxX = cx % W, cxY = Math.floor(cx / W);
    let pushX = 0, pushZ = 0;
    /* Check 4 cardinal directions for nearby walls */
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for(const [dx,dz] of dirs){
      const nx = cxX + dx, ny = cxY + dz;
      if(nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      if(grid[ny * W + nx] !== WALL) continue;
      const wx = this.wx(nx), wz = this.wz(ny);
      const tox = e.x - wx, toz = e.z - wz;
      const d = Math.hypot(tox, toz);
      if(d < 0.48 && d > 0.001){
        const force = (0.48 - d) / 0.48 * 2.2;
        pushX += (tox / d) * force;
        pushZ += (toz / d) * force;
      }
    }
    const mag = Math.hypot(pushX, pushZ);
    if(mag < 0.0005) return;
    /* Cap per-frame push so entities don't jitter */
    const maxPush = 0.05;
    const s = Math.min(mag, maxPush) / mag;
    const nx = e.x + pushX * s;
    const nz = e.z + pushZ * s;
    if(!this.blocked(nx, nz, 0.22)){ e.x = nx; e.z = nz; }
  }

  /* ============ main update ============ */
  update(dt, elapsed){
    this.elapsed = elapsed;
    updateFloatTexts(this.engine.scene, dt);
    updateProjectiles(this.engine.scene, dt);
    if(this.paused) return;                        // a menu is open
    if(this.state !== 'crawl' || !this.D) return;
    if(this.engine.isAnimating()) return;

    const alive = this.heroes.filter(h=>h.data.hp>0);

    /* party wipe / revive */
    if(alive.length===0){
      this.wipeT += dt;
      if(this.wipeT > 2.8) this.respawnParty();
      return;
    }
    this.wipeT = 0;

    const leader = alive[0];

    /* reveal around each hero + room visits */
    for(const h of alive){
      const c = this.cellOf(h.x, h.z);
      if(c>=0 && c!==h.lastCell){
        h.lastCell = c;
        this.revealAround(c, REVEAL_RADIUS);
        const rid = this.D.roomId[c];
        if(rid>=0) this.visitRoom(rid);
      }
    }

    /* leader breadcrumb trail for follower formation */
    const lc = this.cellOf(leader.x, leader.z);
    if(lc>=0 && (this.leaderTrail.length===0 || this.leaderTrail[0]!==lc)){
      this.leaderTrail.unshift(lc);
      if(this.leaderTrail.length>30) this.leaderTrail.pop();
    }

    /* monster activation + AI */
    let anyCombat = false;
    for(const m of this.monsters){
      if(m.data.hp<=0) continue;
      updateFlash(m.ent, dt);
      if(!m.active){
        if(this.visitedRooms[m.roomId] || this.revealed[this.cellOf(m.x,m.z)]){
          let near=false;
          for(const h of alive) if(Math.hypot(h.x-m.x, h.z-m.z) < AGGRO_RANGE){ near=true; break; }
          if(near){ m.active = true; m.ent.grp.visible = true; }
        }
        if(!m.active) continue;
      }
      anyCombat = true;
      /* nearest living hero */
      let tgt=null, best=1e9;
      for(const h of alive){
        const d2 = Math.hypot(h.x-m.x, h.z-m.z);
        if(d2<best){ best=d2; tgt=h; }
      }
      if(!tgt) continue;
      m.cd -= dt;
      if(best > 1.35){
        m.repathT -= dt;
        if(m.repathT<=0 || !m.path || m.pathI>=m.path.length){
          m.path = this.findPath(this.cellOf(m.x,m.z), this.cellOf(tgt.x,tgt.z));
          m.pathI = 0; m.repathT = 0.7;
        }
        this.stepAlong(m, m.data.speed, dt);
        m.walk = true;
      } else {
        m.walk = false;
        m.ent.grp.rotation.y = Math.atan2(tgt.x-m.x, tgt.z-m.z);
        if(m.cd<=0){
          m.cd = MONSTER_ATTACK_CD;
          this.monsterAttack(m, tgt);
        }
      }
    }

    /* hero AI */
    this.combat = false;
    for(const h of alive){
      updateFlash(h.ent, dt);
      const foe = this.pickHeroTarget(h, alive);
      if(foe){
        this.combat = true;
        this.heroCombat(h, foe, alive, dt);
      }
    }

    /* short rest: when the fighting stops, per-rest abilities recharge */
    if(this.combat) this.wasCombat = true;
    else if(this.wasCombat){
      this.wasCombat = false;
      let rested = false;
      for(const h of alive){
        if(h.data.abilityUsed && h.data.abilityUsed.short){ h.data.abilityUsed.short = false; rested = true; }
      }
      if(rested){
        log('The party catches its breath — abilities recharged.', 'heal');
        updatePartyFrames(this.heroes.map(x=>x.data));
      }
    }

    if(!this.combat){
      this.exploreAI(alive, leader, dt);
      /* revive downed heroes once the fighting stops */
      for(const h of this.heroes) if(h.data.hp<=0){
        h.data.hp = Math.max(1, Math.round(h.data.maxHp*0.3));
        h.ent.grp.rotation.z = 0;
        h.x = leader.x + (Math.random()-0.5); h.z = leader.z + (Math.random()-0.5);
        log(`${h.data.name} staggers back to their feet.`, 'heal');
        drawBar(h.ent.bar, h.data.hp/h.data.maxHp);
      }
      this.checkInteractables(alive);
    }

    /* keep bodies from stacking: soft pairwise separation, wall-aware */
    this.applySeparation(alive, dt);

    /* visuals: position, bob, attack lunge */
    const cx = this.engine.cam.position.x - this.engine.camTarget.x;
    const cz = this.engine.cam.position.z - this.engine.camTarget.z;
    const camAngle = Math.atan2(cx, cz);
    const cosC = Math.cos(camAngle), sinC = Math.sin(camAngle);

    for(const h of this.heroes){
      const [ox,oz] = this.lungeOffset(h, dt);
      h.ent.grp.position.set(h.x+ox, 0, h.z+oz);
      
      if(h.data.hp<=0) {
        h.ent.anim.play('hurt');
        h.ent.anim.time = 0; // lock to first frame of hurt if dead
      } else {
        if(h.lungeT > 0) {
          // Play spellcast for wizards/clerics, shoot for rogues, slash/thrust for fighters
          const c = h.data.classKey;
          const a = (c==='wizard'||c==='cleric') ? 'spellcast' : (c==='rogue' ? 'shoot' : 'slash');
          h.ent.anim.play(a);
          const rdx = h.lungeDX * cosC - h.lungeDZ * sinC;
          const rdz = h.lungeDX * sinC + h.lungeDZ * cosC;
          h.ent.anim.setDirection(rdx, rdz);
        } else {
          h.ent.anim.play('walk');
          if (h.moving) {
            const angle = h.ent.grp.rotation.y;
            const mdx = Math.sin(angle), mdz = Math.cos(angle);
            const rdx = mdx * cosC - mdz * sinC;
            const rdz = mdx * sinC + mdz * cosC;
            h.ent.anim.setDirection(rdx, rdz);
          } else {
            h.ent.anim.time = 0;
          }
        }
      }
      h.ent.anim.update(dt);
    }
    for(const m of this.monsters){
      if(m.data.hp<=0) continue;
      const [ox,oz] = this.lungeOffset(m, dt);
      m.ent.grp.position.set(m.x+ox, 0, m.z+oz);
      
      if(m.lungeT > 0) {
        const rdx = m.lungeDX * cosC - m.lungeDZ * sinC;
        const rdz = m.lungeDX * sinC + m.lungeDZ * cosC;
        m.ent.anim.setDirection(rdx, rdz);
        m.ent.anim.mesh.position.y = 0;
      } else {
        if (m.walk) {
          const angle = m.ent.grp.rotation.y;
          const mdx = Math.sin(angle), mdz = Math.cos(angle);
          const rdx = mdx * cosC - mdz * sinC;
          const rdz = mdx * sinC + mdz * cosC;
          m.ent.anim.setDirection(rdx, rdz);
          m.ent.anim.mesh.position.y = Math.abs(Math.sin(elapsed * 15)) * 0.15;
        } else {
          m.ent.anim.time = 0;
          m.ent.anim.mesh.position.y = 0;
        }
      }
      m.ent.anim.update(dt);
    }

    /* camera follow */
    if(elapsed > this.freeCamUntil){
      _v.set(leader.x, 0, leader.z);
      this.engine.camTarget.lerp(_v, Math.min(1, dt*2.2));
      this.engine.updateCam();
    }

    /* dungeon complete */
    if(this.boss && this.boss.data.hp<=0){
      this.completeT += dt;
      if(this.completeT > 3.2) this.finishDungeon();
    }

    /* periodic autosave + HUD */
    this.saveTimer += dt;
    if(this.saveTimer > 5){
      this.saveTimer = 0;
      this.saveGame();
      updatePartyFrames(this.heroes.map(x=>x.data));
    }
  }

  pickHeroTarget(h, alive){
    let tgt=null, best=1e9;
    for(const m of this.monsters){
      if(m.data.hp<=0 || !m.active) continue;
      const dd = Math.hypot(m.x-h.x, m.z-h.z);
      if(dd < best && dd < 13){ best=dd; tgt=m; }
    }
    return tgt;
  }

  heroCombat(h, foe, alive, dt){
    const cls = CLASSES[h.data.classKey];
    const atk = cls.attack;
    const dist = Math.hypot(foe.x-h.x, foe.z-h.z);
    h.cd -= dt;

    /* fighter second wind (a reflex — fires regardless of range/cd) */
    if(h.data.secondWind && !h.data.secondWindUsed && h.data.hp < h.data.maxHp*0.3){
      h.data.secondWindUsed = true;
      const amt = roll(1,10,h.data.level);
      h.data.hp = Math.min(h.data.maxHp, h.data.hp+amt);
      makeFloatText(this.engine.scene, '+'+amt, _v.set(h.x,1.3,h.z), '#6ae06a');
      spawnSpriteEffect(this.engine.scene, 'dcss/effect/goldaura_0.png', _v, 1.5, 0.4);
      drawBar(h.ent.bar, h.data.hp/h.data.maxHp);
      log(`${h.data.name} catches a second wind (+${amt}).`, 'heal');
    }

    const sc = subclassOf(h.data);
    /* rogue cunning action — a defensive reflex, like second wind */
    if(sc && sc.active.key==='cunningAction' && !h.data.abilityUsed.short && h.data.hp < h.data.maxHp*0.4){
      h.data.abilityUsed.short = true;
      h.cunningUntil = this.elapsed + 6;
      spawnSpriteEffect(this.engine.scene, 'dcss/effect/sanctuary.png', _v.set(h.x,0.5,h.z), 1.3, 0.4);
      log(`💨 ${h.data.name} uses Cunning Action — darting clear! (+4 AC, +40% speed)`, 'heal');
    }

    const inRange = dist <= atk.range && (atk.melee || this.hasLOS(h.x,h.z,foe.x,foe.z));
    if(!inRange){
      h.combatFoe = null;                          // reset positioning when re-approaching
      h.repathT -= dt;
      if(h.repathT<=0 || !h.path || h.pathI>=h.path.length){
        h.path = this.findPath(this.cellOf(h.x,h.z), this.cellOf(foe.x,foe.z));
        h.pathI = 0; h.repathT = 0.5;
      }
      h.moving = this.stepAlong(h, HERO_SPEED*h.data.speedMult*this.hasteMult(h), dt);
      if(!h.moving && h !== alive[0]){
        h.stuckT = (h.stuckT||0) + dt;
        if(h.stuckT > 3.0){
          h.stuckT = 0;
          const leader = alive[0];
          h.x = leader.x + (Math.random()-0.5)*0.5;
          h.z = leader.z + (Math.random()-0.5)*0.5;
          h.path = null;
          log(`✨ Teleported ${h.data.name} to join combat.`, 'sys');
        }
      } else {
        h.stuckT = 0;
      }
      return;
    } else {
      h.stuckT = 0;
    }

    /* in range — keep moving: hold a spot around the foe and sway (no statues) */
    this.combatMove(h, foe, atk, dt);
    h.ent.grp.rotation.y = Math.atan2(foe.x-h.x, foe.z-h.z);
    if(h.cd>0) return;

    /* cleric: heal a badly-hurt ally instead of attacking */
    if(cls.healer && h.data.healSlots>0){
      let worst=null, wf=0.55;
      for(const a of alive){ const f=a.data.hp/a.data.maxHp; if(f<wf){ wf=f; worst=a; } }
      if(worst){
        h.cd = HERO_ATTACK_CD;
        h.data.healSlots--;
        const amt = roll(1,8,mod(h.data.effStats.wis)+h.data.healBonus);
        worst.data.hp = Math.min(worst.data.maxHp, worst.data.hp+amt);
        makeFloatText(this.engine.scene, '+'+amt, _v.set(worst.x,1.3,worst.z), '#6ae06a');
        spawnSpriteEffect(this.engine.scene, 'dcss/effect/sanctuary.png', _v, 1.5, 0.4);
        spawnSlash(this.engine.scene, {x:worst.x,z:worst.z}, 0x6ae06a, 1.1);
        log(`${h.data.name} casts Cure Wounds on ${worst.data.name} (+${amt}).`, 'heal');
        drawBar(worst.ent.bar, worst.data.hp/worst.data.maxHp);
        updatePartyFrames(this.heroes.map(x=>x.data));
        return;
      }
    }

    h.cd = HERO_ATTACK_CD;

    /* subclass actives that consume the whole turn (day / spell-slot tiers) */
    if(sc && this.castSubclassSpell(h, sc, foe, alive)) return;

    /* subclass actives that empower THIS attack (short-rest tier) */
    const opts = {};
    if(sc && !h.data.abilityUsed.short){
      if(sc.active.key==='deathstrike' && foe.data.hp >= foe.data.maxHp){
        h.data.abilityUsed.short = true; opts.autoCrit = true;
        log(`🗡 ${h.data.name} lines up a Deathstrike!`, 'crit');
      } else if(sc.active.key==='guidedStrike' && (foe.isBoss || this.monsterEliteRoom(foe))){
        h.data.abilityUsed.short = true; opts.atkBonus = 10; opts.extraDmg = roll(2,8);
        log(`⚡ ${h.data.name} calls a Guided Strike! (+10 to hit, +2d8)`, 'crit');
      }
    }

    this.heroAttackRoll(h, foe, alive, opts);

    /* champion action surge: a second full attack on the same turn */
    if(sc && sc.active.key==='actionSurge' && !h.data.abilityUsed.short && foe.data.hp>0){
      h.data.abilityUsed.short = true;
      log(`⚔ ${h.data.name} surges with action — attacking again!`, 'crit');
      this.heroAttackRoll(h, foe, alive, {});
    }
  }

  /* one d20 attack roll + resolution (extracted so Action Surge can repeat it) */
  heroAttackRoll(h, foe, alive, opts={}){
    const cls = CLASSES[h.data.classKey];
    let d20 = die(20);
    if(d20===1 && RACES[h.data.raceKey].lucky) d20 = die(20);
    const atkBonus = heroAttackBonus(h.data) + (opts.atkBonus||0);
    const crit = !!opts.autoCrit || d20 >= h.data.critRange;
    const total = d20 + atkBonus;
    const miss = !crit && total < foe.data.ac;
    let dmg = 0, sneak = false;
    if(!miss){
      dmg = heroDamage(h.data, crit) + (opts.extraDmg||0);
      /* rogue sneak attack: ally adjacent to the target */
      if(cls.sneakDice){
        const flanked = alive.some(a=>a!==h && Math.hypot(a.x-foe.x,a.z-foe.z)<1.7);
        if(flanked){ dmg += roll(cls.sneakDice(h.data.level), 6); sneak = true; }
      }
    }
    /* verbose combat log: the roll math, then the outcome */
    const vs = `(${d20}+${atkBonus} vs AC ${foe.data.ac})`;
    if(crit) log(`💥 ${h.data.name} crits ${foe.data.name}! ${opts.autoCrit?'(Deathstrike)':`(nat ${d20})`} — ${dmg} dmg${sneak?' +sneak':''}`, 'crit');
    else if(miss) log(`${h.data.name} → ${foe.data.name}: ${total} ${vs} miss`, 'miss');
    else log(`${h.data.name} → ${foe.data.name}: ${total} ${vs} hit, ${dmg} dmg${sneak?' +sneak':''}`, 'roll');
    this.strike(h, foe, dmg, crit, miss);
  }

  /* day- and slot-tier actives; returns true if one consumed this turn */
  castSubclassSpell(h, sc, foe, alive){
    const key = sc.active.key, d = h.data;
    if(key==='rallyingCry' && !d.abilityUsed.day){
      const hurt = alive.filter(a=>a.data.hp < a.data.maxHp*0.5);
      if(hurt.length>=2){
        d.abilityUsed.day = true;
        log(`📣 ${d.name} bellows a Rallying Cry!`, 'heal');
        for(const a of alive) this.healHero(a, roll(1,10,d.level));
        updatePartyFrames(this.heroes.map(x=>x.data));
        return true;
      }
      return false;
    }
    if(key==='preserveLife' && !d.abilityUsed.day){
      const hurt = alive.filter(a=>a.data.hp < a.data.maxHp*0.4);
      if(hurt.length>=2){
        d.abilityUsed.day = true;
        log(`✨ ${d.name} channels divinity — Preserve Life!`, 'heal');
        for(const a of alive) this.healHero(a, d.level*2 + mod(d.effStats.wis) + d.healBonus);
        updatePartyFrames(this.heroes.map(x=>x.data));
        return true;
      }
      return false;
    }
    if(key==='fireball' && d.slots>0){
      const cluster = this.monsters.filter(m=>m.data.hp>0 && m.active && Math.hypot(m.x-foe.x,m.z-foe.z)<2.2);
      if(cluster.length>=3){
        d.slots--;
        updatePartyFrames(this.heroes.map(x=>x.data));
        log(`🔥 ${d.name} spends a slot — FIREBALL! (${d.slots}/${d.slotsMax} left)`, 'crit');
        const from = new THREE.Vector3(h.x, 0.6, h.z);
        const to = new THREE.Vector3(foe.x, 0.5, foe.z);
        spawnProjectile(this.engine.scene, from, to, 'bolt', 0xff7a30, ()=>{
          spawnSpriteEffect(this.engine.scene, 'dcss/effect/cloud_fire_2.png', to, 2.5, 0.5);
          spawnSlash(this.engine.scene, {x:foe.x,z:foe.z}, 0xff8a30, 2.6);
          for(const m of cluster){ if(m.dead) continue; this.damageMonster(m, roll(8,6,d.dmgBonus), h, true); }
        });
        return true;
      }
      return false;
    }
    if(key==='magicMissile' && d.slots>0 && (foe.isBoss || this.monsterEliteRoom(foe) || foe.data.hp>=15)){
      d.slots--;
      updatePartyFrames(this.heroes.map(x=>x.data));
      const darts = 3 + Math.floor(d.level/4);
      log(`✴ ${d.name} spends a slot — Magic Missile, ${darts} darts! (${d.slots}/${d.slotsMax} left)`, 'crit');
      const from = new THREE.Vector3(h.x, 0.55, h.z);
      for(let i=0;i<darts;i++){
        const to = new THREE.Vector3(foe.x+(Math.random()-0.5)*0.5, 0.4*foe.data.scale+0.4, foe.z+(Math.random()-0.5)*0.5);
        spawnProjectile(this.engine.scene, from, to, 'bolt', 0xb08cff, ()=>{
          if(foe.dead) return;
          this.damageMonster(foe, roll(1,4,1), h, false);
          spawnSpriteEffect(this.engine.scene, 'dcss/effect/magic_bolt_1.png', to, 0.9, 0.25);
        });
      }
      return true;
    }
    return false;
  }

  healHero(a, amt){
    if(a.data.hp<=0) return;
    a.data.hp = Math.min(a.data.maxHp, a.data.hp + amt);
    makeFloatText(this.engine.scene, '+'+amt, _v.set(a.x,1.3,a.z), '#6ae06a');
    drawBar(a.ent.bar, a.data.hp/a.data.maxHp);
  }

  /* dynamic in-combat positioning: hold a slot around the foe with a gentle
     orbital sway so heroes read as fighting, not standing still. */
  combatMove(h, foe, atk, dt){
    if(h.combatFoe !== foe){
      h.combatFoe = foe;
      const idx = this.heroes.indexOf(h);
      h.anchorAngle = idx*(Math.PI*2/this.heroes.length) + (Math.random()-0.5)*0.4;
      h.swayPhase = Math.random()*6.28;
      h.swayDir = Math.random()<0.5 ? -1 : 1;
    }
    const desiredR = atk.melee ? 1.05 : Math.max(2.6, Math.min(atk.range-0.8, atk.range*0.6));
    const ang = h.anchorAngle + Math.sin(this.elapsed*0.75 + h.swayPhase)*0.55*h.swayDir;
    const r   = desiredR + Math.sin(this.elapsed*1.15 + h.swayPhase)*0.22;
    const tx = foe.x + Math.cos(ang)*r;
    const tz = foe.z + Math.sin(ang)*r;
    h.moving = this.nudgeToward(h, tx, tz, HERO_SPEED*COMBAT_SPEED*h.data.speedMult*this.hasteMult(h), dt);
  }

  /* temporary speed boost from Cunning Action */
  hasteMult(h){ return h.cunningUntil > this.elapsed ? 1.4 : 1; }
  /* effective AC including temporary buffs */
  heroAC(h){ return h.data.ac + (h.cunningUntil > this.elapsed ? 4 : 0); }

  /* 4-point wall probe used by local (non-pathfinding) movement */
  blocked(nx, nz, r=0.35){
    let c;
    if((c=this.cellOf(nx-r, nz))<0 || this.D.grid[c]===WALL) return true;
    if((c=this.cellOf(nx+r, nz))<0 || this.D.grid[c]===WALL) return true;
    if((c=this.cellOf(nx, nz-r))<0 || this.D.grid[c]===WALL) return true;
    if((c=this.cellOf(nx, nz+r))<0 || this.D.grid[c]===WALL) return true;
    return false;
  }

  /* direct local move that refuses to step into a wall */
  nudgeToward(e, tx, tz, speed, dt){
    const dx = tx-e.x, dz = tz-e.z, d = Math.hypot(dx,dz);
    if(d < 0.05) return false;
    const step = Math.min(d, speed*dt);
    
    const stepX = dx/d*step;
    const stepZ = dz/d*step;
    const nx = e.x + stepX;
    const nz = e.z + stepZ;
    
    // Check if full move is blocked
    if(!this.blocked(nx, nz, 0.35)){
      e.x = nx; e.z = nz;
      return step > 0.012;
    }
    
    // Slide along X wall
    if(!this.blocked(nx, e.z, 0.35)){
      e.x = nx;
      return Math.abs(stepX) > 0.012;
    }
    
    // Slide along Z wall
    if(!this.blocked(e.x, nz, 0.35)){
      e.z = nz;
      return Math.abs(stepZ) > 0.012;
    }
    
    return false;
  }

  /* soft pairwise separation so heroes and monsters never stand on the same
     spot — overlapping bodies push each other apart a little each frame,
     which spreads melee scrums into a readable ring. Wall-aware. */
  applySeparation(alive, dt){
    const ents = [];
    for(const h of alive) ents.push({ e:h, r:0.36 });
    for(const m of this.monsters)
      if(m.data.hp>0 && m.active) ents.push({ e:m, r:0.34*(m.data.scale||1) });
    const maxPush = 4.5*dt;                      // must outpace chase speed or bodies merge
    for(let i=0;i<ents.length;i++) for(let j=i+1;j<ents.length;j++){
      const A = ents[i], B = ents[j];
      let dx = B.e.x-A.e.x, dz = B.e.z-A.e.z;
      let dd = Math.hypot(dx, dz);
      const min = A.r + B.r;
      if(dd >= min) continue;
      if(dd < 1e-4){                             // exactly stacked: pick a direction
        const a = Math.random()*Math.PI*2;
        dx = Math.cos(a); dz = Math.sin(a); dd = 1;
      }
      const push = Math.min((min-dd)*0.5, maxPush);
      const px = dx/dd*push, pz = dz/dd*push;
      if(!this.blocked(A.e.x-px, A.e.z-pz, 0.3)){ A.e.x -= px; A.e.z -= pz; }
      if(!this.blocked(B.e.x+px, B.e.z+pz, 0.3)){ B.e.x += px; B.e.z += pz; }
    }
  }

  /* resolve an attack's visuals: melee lunge+slash, ranged projectile */
  strike(h, foe, dmg, crit, miss){
    const cls = CLASSES[h.data.classKey], a = cls.attack;
    if(a.melee){
      this.triggerLunge(h, foe);
      if(miss){ this.showMiss(foe); }
      else {
        this.damageMonster(foe, dmg, h, crit);
        spawnSlash(this.engine.scene, {x:foe.x,z:foe.z}, crit?0xffd34a:0xdfe4ee, foe.data.scale);
        spawnSpriteEffect(this.engine.scene, crit ? 'dcss/effect/flame_0.png' : 'dcss/effect/blood_0.png', new THREE.Vector3(foe.x, 0.5, foe.z), 1.0, 0.3);
      }
    } else {
      const color = h.data.classKey==='wizard' ? 0xff7a30
                  : h.data.classKey==='cleric' ? 0xbfe0ff : 0xe8d8a8;
      const kind = h.data.classKey==='rogue' ? 'arrow' : 'bolt';
      const from = new THREE.Vector3(h.x, 0.55, h.z);
      const to = new THREE.Vector3(foe.x, 0.4*foe.data.scale+0.4, foe.z);
      spawnProjectile(this.engine.scene, from, to, kind, color, ()=>{
        if(foe.dead) return;
        if(miss) this.showMiss(foe);
        else { 
          this.damageMonster(foe, dmg, h, crit); 
          if(kind==='bolt') {
            spawnSlash(this.engine.scene, {x:foe.x,z:foe.z}, color, foe.data.scale*0.9);
            spawnSpriteEffect(this.engine.scene, 'dcss/effect/magic_bolt_1.png', to, 1.2, 0.3);
          } else {
            spawnSpriteEffect(this.engine.scene, 'dcss/effect/arrow_4.png', to, 1.0, 0.3);
          }
        }
      });
    }
  }
  showMiss(foe){ makeFloatText(this.engine.scene, 'miss', _v.set(foe.x,1.1,foe.z), '#9aa'); }

  /* set up an attack lunge for any entity toward a target */
  triggerLunge(e, target){
    const dx = target.x-e.x, dz = target.z-e.z, d = Math.hypot(dx,dz)||1;
    e.lungeDX = dx/d; e.lungeDZ = dz/d; e.lungeT = 0.22;
  }
  /* returns the current [x,z] lunge offset for an entity, advancing its timer */
  lungeOffset(e, dt){
    if(!e.lungeT || e.lungeT<=0) return [0,0];
    e.lungeT -= dt;
    const p = 1 - Math.max(0, e.lungeT)/0.22;       // 0→1 over the lunge
    const amp = Math.sin(Math.min(1,p)*Math.PI) * 0.42;
    return [e.lungeDX*amp, e.lungeDZ*amp];
  }

  damageMonster(m, dmg, h, crit=false){
    if(m.dead) return;                             // a deferred projectile hit a corpse
    m.data.hp -= dmg;
    m.active = true;
    h.data.dmgDealt += dmg;
    hitFlash(m.ent);
    makeFloatText(this.engine.scene, String(dmg), _v.set(m.x, 0.9*m.data.scale+0.5, m.z), crit?'#ffd34a':'#ff8a5a');
    drawBar(m.ent.bar, Math.max(0,m.data.hp/m.data.maxHp), '#e0483a');
    if(m.data.hp<=0) this.killMonster(m, h);
  }

  killMonster(m, h){
    m.dead = true;
    m.ent.grp.visible = false;
    h.data.kills++;
    this.gold += m.data.gold;
    const before = this.heroes.map(a=>a.data.level);
    const share = Math.max(1, Math.round(m.data.xp * XP_SHARE));
    for(const a of this.heroes) if(a.data.hp>0) grantXp(a.data, share, log);
    log(`${h.data.name} slays the ${m.data.name}. (+${m.data.gold}g, +${share} XP each)`, m.isBoss?'boss':'kill');
    /* item drops: bosses always, elites often, others occasionally */
    let dropChance = m.isBoss ? 1 : (m.data.name && this.monsterEliteRoom(m) ? 0.35 : 0.10);
    if(Math.random() < dropChance){
      const it = rollItem(this.dungeonLevel);
      this.inventory.push(it);
      log(`  ↳ ${m.data.name} dropped ${it.name}!`, 'treasure');
    }
    if(m.isBoss){
      log(`👑 ${m.data.name} falls! The floor is conquered!`, 'boss');
      showBanner('FLOOR CLEARED!', `${m.data.name} defeated`);
      this.gold += 50 * this.dungeonLevel;
      /* boss guarantees a bonus drop */
      const it = rollItem(this.dungeonLevel+2);
      this.inventory.push(it);
      log(`  ↳ ${it.name} claimed from the hoard!`, 'treasure');
    }
    if(this.heroes.some((a,i)=>a.data.level>before[i])) this.announceLevelUp();
    updateResources(this);
    updatePartyFrames(this.heroes.map(x=>x.data));
    refreshMenus(this);
  }
  monsterEliteRoom(m){
    const r = this.D.rooms[m.roomId];
    return r && (r.type==='elite');
  }
  announceLevelUp(){
    const total = this.heroes.reduce((n,h)=>n+pendingPoints(h.data),0);
    const badge = document.getElementById('nav-levelup-badge');
    if(badge){ badge.textContent = total; badge.style.display = total>0?'':'none'; }
  }

  monsterAttack(m, h){
    this.triggerLunge(m, h);
    const d20 = die(20);
    const total = d20 + m.data.atk;
    const crit = d20===20;
    const ac = this.heroAC(h);
    if(!crit && total < ac){
      makeFloatText(this.engine.scene, 'miss', _v.set(h.x,1.1,h.z), '#9aa');
      log(`${m.data.name} → ${h.data.name}: ${total} (vs AC ${ac}) miss`, 'miss');
      return;
    }
    let dice = m.data.dmg[0]; if(crit) dice*=2;
    const dmg = roll(dice, m.data.dmg[1], m.data.dmg[2]||0);
    log(`${m.data.name} hits ${h.data.name} for ${dmg}${crit?' (crit!)':''}`, crit?'down':'roll');
    spawnSlash(this.engine.scene, {x:h.x,z:h.z}, crit?0xff5040:0xff9a7a, 0.9);
    spawnSpriteEffect(this.engine.scene, crit ? 'dcss/effect/flame_0.png' : 'dcss/effect/blood_0.png', new THREE.Vector3(h.x, 0.5, h.z), 1.0, 0.3);
    h.data.hp -= dmg;
    hitFlash(h.ent);
    makeFloatText(this.engine.scene, String(dmg), _v.set(h.x,1.2,h.z), crit?'#ff5040':'#ff9a7a');
    drawBar(h.ent.bar, Math.max(0,h.data.hp/h.data.maxHp));
    updatePartyFrames(this.heroes.map(x=>x.data));
    if(h.data.hp<=0){
      h.data.hp = 0; h.data.downs++;
      log(`💀 ${h.data.name} goes down!`, 'down');
    }
  }

  /* ============ exploration ============ */
  exploreAI(alive, leader, dt){
    const { W } = this.D;
    let goalCell = -1;

    /* a player-ordered destination takes priority over room AI */
    if(this.userGoal>=0){
      const gx = this.wx(this.userGoal%W), gz = this.wz(Math.floor(this.userGoal/W));
      if(Math.hypot(leader.x-gx, leader.z-gz) < 1.1){
        this.userGoal = -1;
        log('The party arrives. Back to exploring.', 'sys');
      } else goalCell = this.userGoal;
    }
    if(goalCell<0){
      if(this.targetRoom<0 || this.roomDone(this.targetRoom)){
        this.targetRoom = this.pickNextRoom(leader);
      }
      /* aim at the room's actual point of interest (living monster, unlooted
         chest, unused shrine) — going only to the room CENTER left rooms
         uncompletable and froze the party */
      if(this.targetRoom>=0) goalCell = this.roomTargetCell(this.targetRoom, leader);
    }

    /* cohesion: the leader holds up if anyone has fallen too far behind */
    let strayMax = 0;
    for(const h of alive){ if(h===leader) continue;
      strayMax = Math.max(strayMax, Math.hypot(h.x-leader.x, h.z-leader.z)); }
    const hold = strayMax > COHESION_MAX && this.userGoal < 0;

    if(goalCell>=0 && !hold){
      if(!leader.path || leader.pathI>=leader.path.length || leader.pathGoal!==goalCell){
        leader.path = this.findPath(this.cellOf(leader.x,leader.z), goalCell);
        leader.pathI = 0; leader.pathGoal = goalCell;
        if(!leader.path && this.userGoal>=0){
          this.userGoal = -1;
          log("The party can't find a way there.", 'sys');
        }
      }
      leader.moving = this.stepAlong(leader, HERO_SPEED*leader.data.speedMult, dt);
    } else leader.moving = false;

    /* stuck watchdog: standing still with a live goal means something is
       off (bad path, unreachable POI) — clear state and re-decide */
    if(leader.moving || hold) this.stuckT = 0;
    else if(goalCell>=0){
      this.stuckT = (this.stuckT||0) + dt;
      if(this.stuckT > 3){
        this.stuckT = 0;
        leader.path = null; leader.pathGoal = -1;
        this.targetRoom = this.pickNextRoom(leader);
      }
    }

    /* followers chase the leader's current position, keeping loose spacing so
       they cluster without stacking. Hustle harder the farther behind. */
    const goal = this.cellOf(leader.x, leader.z);
    alive.forEach((h)=>{
      if(h===leader) return;
      const i = alive.indexOf(h);
      const spacing = 1.25 + i*0.45;
      const dLead = Math.hypot(h.x-leader.x, h.z-leader.z);
      if(dLead < spacing){ h.moving=false; h.stuckT=0; return; }
      h.repathT -= dt;
      if(h.repathT<=0 || !h.path || h.pathI>=h.path.length || h.pathGoal!==goal){
        h.path = this.findPath(this.cellOf(h.x,h.z), goal);
        h.pathI = 0; h.repathT = 0.35; h.pathGoal = goal;
      }
      const catchup = 1.1 + Math.min(1.2, Math.max(0, (dLead-2.5)*0.25));
      h.moving = this.stepAlong(h, HERO_SPEED*catchup*h.data.speedMult, dt);
      if(!h.moving){
        h.stuckT = (h.stuckT||0) + dt;
        if(h.stuckT > 3.0){
          h.stuckT = 0;
          h.x = leader.x + (Math.random()-0.5)*0.5;
          h.z = leader.z + (Math.random()-0.5)*0.5;
          h.path = null;
          log(`✨ Teleported ${h.data.name} to catch up.`, 'sys');
        }
      } else {
        h.stuckT = 0;
      }
    });
  }

  /* the cell the leader should actually walk to in a room: nearest living
     monster first (so fights start), then unlooted chest, unused shrine,
     falling back to the room anchor */
  roomTargetCell(rid, leader){
    const { W } = this.D;
    let best=-1, bd=1e9;
    for(const m of this.monsters) if(m.roomId===rid && m.data.hp>0){
      const dd = Math.hypot(m.x-leader.x, m.z-leader.z);
      if(dd<bd){ bd=dd; best=this.nearFloorCell(this.cellOf(m.x, m.z), 2); }
    }
    if(best>=0) return best;
    for(const ch of this.chests) if(ch.roomId===rid && !ch.looted)
      return this.nearFloorCell(ch.y*W + ch.x, 2);
    for(const s of this.shrines) if(s.roomId===rid && !s.used)
      return this.nearFloorCell(s.y*W + s.x, 2);
    return this.roomAnchor[rid];
  }

  /* snap a cell to the nearest walkable floor cell within `rad` (props like
     chests can sit on non-floor tiles that BFS refuses as a destination) */
  nearFloorCell(cell, rad=3){
    if(cell<0) return -1;
    const { W, H, grid } = this.D;
    if(grid[cell]===FLOOR) return cell;
    const cx = cell%W, cy = Math.floor(cell/W);
    for(let r=1; r<=rad; r++)
      for(let oy=-r; oy<=r; oy++) for(let ox=-r; ox<=r; ox++){
        const nx=cx+ox, ny=cy+oy;
        if(nx<0||ny<0||nx>=W||ny>=H) continue;
        if(grid[ny*W+nx]===FLOOR) return ny*W+nx;
      }
    return -1;
  }

  /* player clicked the map: send the party there, then AI resumes */
  commandMove(x, z){
    if(this.state!=='crawl' || !this.D || this.paused) return;
    const cell = this.nearFloorCell(this.cellOf(x, z), 3);
    if(cell<0) return;                             // clicked the void
    this.userGoal = cell;
    const { W } = this.D;
    const gx = this.wx(cell%W), gz = this.wz(Math.floor(cell/W));
    spawnSlash(this.engine.scene, {x:gx, z:gz}, 0x6ac8ff, 1.3);
    log('📍 You point the way — the party heads there.', 'sys');
  }

  roomDone(rid){
    if(!this.visitedRooms[rid]) return false;
    for(const m of this.monsters) if(m.roomId===rid && m.data.hp>0) return false;
    for(const ch of this.chests) if(ch.roomId===rid && !ch.looted) return false;
    for(const s of this.shrines) if(s.roomId===rid && !s.used) return false;
    return true;
  }

  pickNextRoom(leader){
    const { rooms, W, grid } = this.D;
    const from = this.cellOf(leader.x, leader.z);
    /* BFS distance field from leader */
    const dist = new Int32Array(this.D.W*this.D.H).fill(-1);
    const q = new Int32Array(this.D.W*this.D.H); let qh=0, qt=0;
    if(from>=0 && grid[from]===FLOOR){ q[qt++]=from; dist[from]=0; }
    const total = this.D.W*this.D.H;
    while(qh<qt){
      const c=q[qh++], x=c%W, b=dist[c]+1;
      let n;
      if(x>0       && grid[n=c-1]===FLOOR && dist[n]<0){ dist[n]=b; q[qt++]=n; }
      if(x<W-1     && grid[n=c+1]===FLOOR && dist[n]<0){ dist[n]=b; q[qt++]=n; }
      if(c>=W      && grid[n=c-W]===FLOOR && dist[n]<0){ dist[n]=b; q[qt++]=n; }
      if(c<total-W && grid[n=c+W]===FLOOR && dist[n]<0){ dist[n]=b; q[qt++]=n; }
    }
    let best=-1, bd=1e9, bossOnly=true;
    for(let i=0;i<rooms.length;i++){
      if(this.roomDone(i)) continue;
      if(i!==this.D.boss) bossOnly=false;
    }
    for(let i=0;i<rooms.length;i++){
      if(this.roomDone(i)) continue;
      if(i===this.D.boss && !bossOnly) continue;   // save the boss for last
      const dd = dist[this.roomAnchor[i]];
      if(dd>=0 && dd<bd){ bd=dd; best=i; }
    }
    return best;
  }

  checkInteractables(alive){
    for(const ch of this.chests){
      if(ch.looted) continue;
      const cx=this.wx(ch.x), cz=this.wz(ch.y);
      if(alive.some(h=>Math.hypot(h.x-cx,h.z-cz)<1.5)){
        ch.looted = true;
        let g = 25*this.dungeonLevel + roll(3,20);
        /* thief's Fast Hands: bonus gold from chests */
        const thiefBonus = Math.max(0, ...alive.map(h=>{
          const sc = subclassOf(h.data);
          return (sc && sc.chestGold) || 0;
        }));
        if(thiefBonus) g = Math.round(g * (1 + thiefBonus));
        this.gold += g;
        log(`🪙 The party loots a chest: ${g} gold${thiefBonus?' (Fast Hands)':''}.`, 'treasure');
        if(Math.random()<0.6){
          if(this.dungeonLevel>=3 && Math.random()<0.4){ this.potions.greater++; log('  ↳ a Greater Healing Potion.', 'treasure'); }
          else { this.potions.heal++; log('  ↳ a Healing Potion.', 'treasure'); }
        }
        const loot = rollChestLoot(this.dungeonLevel);
        for(const it of loot){
          this.inventory.push(it);
          log(`  ↳ ${it.name}!`, 'treasure');
        }
        updateResources(this);
        refreshMenus(this);
      }
    }
    for(const s of this.shrines){
      if(s.used) continue;
      const sx=this.wx(s.x), sz=this.wz(s.y);
      if(alive.some(h=>Math.hypot(h.x-sx,h.z-sz)<1.6)){
        s.used = true;
        for(const h of this.heroes){
          if(h.data.hp>0) h.data.hp = h.data.maxHp;
          if(CLASSES[h.data.classKey].healer) h.data.healSlots = h.data.healSlotsMax;
          h.data.secondWindUsed = false;
          /* shrines are a rest: per-rest abilities + spell slots recharge (day stays spent) */
          if(h.data.abilityUsed) h.data.abilityUsed.short = false;
          h.data.slots = h.data.slotsMax || 0;
          drawBar(h.ent.bar, Math.max(0,h.data.hp/h.data.maxHp));
        }
        log('🔮 The shrine restores the party to full strength!', 'heal');
        updatePartyFrames(this.heroes.map(x=>x.data));
      }
    }
  }

  respawnParty(){
    const { W } = this.D;
    const ea = this.roomAnchor[this.D.entrance];
    log('The party limps back to the entrance to regroup…', 'down');
    this.heroes.forEach((h,i)=>{
      h.data.hp = Math.max(1, Math.round(h.data.maxHp*0.5));
      h.x = this.wx(ea%W) + (i%2===0?-0.5:0.5);
      h.z = this.wz(Math.floor(ea/W)) + (i<2?-0.5:0.5);
      h.path = null; h.ent.grp.rotation.z = 0;
      drawBar(h.ent.bar, h.data.hp/h.data.maxHp);
    });
    /* monsters lose interest */
    for(const m of this.monsters){ m.active=false; m.path=null; }
    this.targetRoom = -1;
    this.wipeT = 0;
    updatePartyFrames(this.heroes.map(x=>x.data));
  }

  finishDungeon(){
    this.completeT = -1e9;
    this.dungeonLevel++;
    this.saveGame();
    log(`The floor is cleared. The party rests at a merchant camp before descending to floor ${this.dungeonLevel}…`, 'sys');
    this.state = 'shop';
    showShop();
  }

  /* ============ player clicks ============ */
  drinkPotion(kind){
    if(this.state!=='crawl' || this.potions[kind]<=0) return;
    let worst=null, wf=1;
    for(const h of this.heroes){
      if(h.data.hp<=0) continue;
      const f=h.data.hp/h.data.maxHp;
      if(f<wf){ wf=f; worst=h; }
    }
    if(!worst || wf>=1) return;
    this.potions[kind]--;
    const amt = kind==='greater' ? roll(4,4,4) : roll(2,4,2);
    worst.data.hp = Math.min(worst.data.maxHp, worst.data.hp+amt);
    makeFloatText(this.engine.scene, '+'+amt, _v.set(worst.x,1.3,worst.z), '#6ae0ff');
    log(`🧪 You toss ${worst.data.name} a potion (+${amt}).`, 'heal');
    drawBar(worst.ent.bar, worst.data.hp/worst.data.maxHp);
    updatePartyFrames(this.heroes.map(x=>x.data));
    updateResources(this);
  }

  notifyUserPan(){
    this.freeCamUntil = this.elapsed + 6;
  }

  /* ============ menu actions (called by menus.js) ============ */
  setPaused(p){
    this.paused = p;
    if(!p) this.freeCamUntil = this.elapsed + 1.5;   // brief grace so cam doesn't snap
  }

  /** Equip an inventory item onto a hero. `preferSlot` picks between ring slots. */
  equipItem(hero, item, preferSlot=null){
    if(!canEquip(hero, item)) return { ok:false, reason:'Not proficient with that.' };
    const opts = slotsFor(item.slot);
    const slot = preferSlot && opts.includes(preferSlot) ? preferSlot
               : (opts.find(s=>!hero.equipment[s]) || opts[0]);
    const displaced = hero.equipment[slot] || null;
    hero.equipment[slot] = item;
    const idx = this.inventory.indexOf(item);
    if(idx>=0) this.inventory.splice(idx,1);
    if(displaced) this.inventory.push(displaced);
    recalc(hero);
    hero.hp = Math.min(hero.hp, hero.maxHp);
    this.afterGearChange(hero);
    return { ok:true };
  }
  unequipItem(hero, slot){
    const it = hero.equipment[slot];
    if(!it) return;
    delete hero.equipment[slot];
    this.inventory.push(it);
    recalc(hero);
    hero.hp = Math.min(hero.hp, hero.maxHp);
    this.afterGearChange(hero);
  }
  sellItem(item){
    const idx = this.inventory.indexOf(item);
    if(idx<0) return;
    this.inventory.splice(idx,1);
    this.gold += item.value;
    log(`💰 Sold ${item.name} for ${item.value}g.`, 'treasure');
    updateResources(this);
  }
  /** Sort inventory by rarity or name. */
  sortInventory(order){
    const RANK = { legendary:5, epic:4, rare:3, uncommon:2, common:1 };
    if(order === 'rarity-desc'){
      this.inventory.sort((a,b) => (RANK[b.rarity]||0) - (RANK[a.rarity]||0) || a.name.localeCompare(b.name));
    } else if(order === 'rarity-asc'){
      this.inventory.sort((a,b) => (RANK[a.rarity]||0) - (RANK[b.rarity]||0) || a.name.localeCompare(b.name));
    } else if(order === 'name'){
      this.inventory.sort((a,b) => a.name.localeCompare(b.name));
    }
    this.saveGame();
  }
  /** Sell every item of a given rarity. Returns the count sold. */
  sellByRarity(rarity){
    const items = this.inventory.filter(it => it.rarity === rarity);
    if(items.length === 0) return 0;
    let total = 0;
    for(const it of items) total += it.value;
    this.inventory = this.inventory.filter(it => it.rarity !== rarity);
    this.gold += total;
    log(`💰 Sold ${items.length} ${rarity} item(s) for ${total}g.`, 'treasure');
    updateResources(this);
    this.saveGame();
    return items.length;
  }
  afterGearChange(hero){
    if(hero===undefined) return;
    const wrap = this.heroes.find(h=>h.data===hero);
    if(wrap && wrap.ent) {
      drawBar(wrap.ent.bar, Math.max(0,hero.hp/hero.maxHp));
      if (wrap.ent.anim) {
        // Force the sprite animator to re-compose the layered textures with the new gear
        wrap.ent.anim.loadState('walk');
        wrap.ent.anim.loadState('slash');
        wrap.ent.anim.loadState('hurt');
      }
    }
    updatePartyFrames(this.heroes.map(x=>x.data));
    updateResources(this);
    this.saveGame();
  }
  allocateAbility(hero, ability){
    if(spendAbilityPoint(hero, ability)){ this.afterGearChange(hero); this.announceLevelUp(); return true; }
    return false;
  }
  allocateSkill(hero, skillKey){
    if(spendSkillPoint(hero, skillKey)){ this.afterGearChange(hero); this.announceLevelUp(); return true; }
    return false;
  }
  chooseSubclass(hero, key){
    if(!pickSubclass(hero, key)) return false;
    const sc = SUBCLASSES[hero.classKey][key];
    log(`🌟 ${hero.name} becomes a ${sc.label}! (${sc.active.name})`, 'level');
    this.afterGearChange(hero);
    this.announceLevelUp();
    return true;
  }

  /* ============ persistence ============ */
  saveGame(){
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        heroes: this.heroes.map(h=>h.data),
        inventory: this.inventory,
        gold: this.gold, potions: this.potions, dungeonLevel: this.dungeonLevel
      }));
    } catch(e){ /* storage full/blocked — play on without saves */ }
  }
  loadSave(){
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e){ return null; }
  }
}

export const game = new Game();
if(typeof window !== 'undefined') window.__game = game;
