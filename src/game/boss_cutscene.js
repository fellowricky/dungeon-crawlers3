/**
 * Boss intro cutscene — a short, in-engine cinematic the first time the party
 * sets foot in a final-floor boss room.
 *
 * Why in-engine rather than another art card: boss_card.js already does the
 * card, and a card covers the very thing it is announcing. This one keeps the
 * camera in the dungeon — push in on the boss, let it roar, pull back to
 * reveal the escorts standing with it — and lays a lower third over the top.
 *
 * FREEZING CONTRACT, modelled on campAnim (see game.js). The cutscene does NOT
 * set game.paused. Pausing returns out of update() before the visual loop,
 * which freezes every sprite on screen — including the boss that is supposed
 * to be roaring. Instead `game.bossCutscene` replaces the simulation branch of
 * update() while the visual loop underneath it keeps running, so bodies
 * animate while the crawl itself is held still.
 *
 * CAMERA. Driven outright here rather than through camera_director.js. The
 * director's whole job is to react — dwell timers, deadbands, committed
 * quarter-turns — and every one of those would fight a scripted move, so
 * updateCameraDirector is skipped for the duration and this module writes
 * camTarget / zoom / yaw / pitch directly.
 *
 * TIMEBASE. Ticked with the caller's `rawDt`, so the scene is the same length
 * regardless of where the Options combat-speed slider sits — the same rule the
 * initiative roll-off follows.
 *
 * DATA. Every curated boss encounter (boss_encounters.json) gets a scene —
 * all 100 carry a `bossTitle` and a `description`, which is everything the
 * card needs, so the default costs no authoring. An optional `cutscene` block
 * on an encounter overrides any part of it, for the handful of bosses worth
 * writing a bespoke line for.
 *
 * Because the scene announces the boss itself, it claims boss_card.js's
 * once-flag: the static art card no longer fires on a floor this plays on.
 *
 *   cutscene: {
 *     kicker: 'small-caps line above the name',
 *     name:   'headline — defaults to the encounter bossTitle',
 *     sub:    'italic line under it — defaults to the encounter description',
 *     sfx:    'audio slot for the roar (default warCry)',
 *     shake:  0.7      // camera shake on the roar
 *   }
 */
import {
  cam, camTarget, setCamZoom, setYawPitch, shakeCamera,
  MIN_CAM_ZOOM, MAX_CAM_ZOOM, BASE_HALF,
  yaw as camYaw, pitch as camPitch
} from '../render/dungeon_scene.js';
import { screenOffset, fitZoom, centroid, CAM_ACTION_PITCH, CAM_BODY_HEIGHT } from './camera_director.js';
import { atlasDuration } from './sprite_atlas.js';
import { playSfx } from './audio.js';

/* ── beat lengths, in real seconds ──────────────────────────────────────
   The hold is not a fixed number, because the shot it contains is a sequence
   of the boss's OWN animations: one whole idle cycle, the strike, then idle
   again until the camera leaves. Those cycles are authored per creature and
   vary wildly — Ignis idles for 2.4s and strikes for 1.6s, which is already
   four seconds before any tail — so a constant hold would cut the idle off
   mid-cycle on some bosses and leave others standing still. D_HOLD_MIN is the
   floor for a creature whose sheets are short; D_HOLD_MAX stops a pathological
   sheet holding the player hostage. The per-scene boundaries live on the scene
   state (s.tPush … s.tEnd), not here. */
const D_PUSH     = 1.2;   // arc in from the party and settle on the boss
const D_HOLD_MIN = 3.0;   // shortest close-up, however brief the sheets are
const D_HOLD_MAX = 6.0;   // longest, however indulgent they are
const D_WIDE     = 1.5;   // pull back — the escorts are standing with it
const D_OUT      = 0.8;   // ease back toward the party, then release the crawl

/* Zoom is "tighter is bigger": half the view height is BASE_HALF / zoom, so at
   MAX_CAM_ZOOM (14) the frame is still ~7.9 world units tall and a boss stands
   about two — too wide to read as a close-up. The scene therefore drives
   `cam.zoom` past the gameplay ceiling itself (see applyZoom); that ceiling
   exists to stop the PLAYER zooming somewhere unreadable, and a scripted shot
   that returns the camera legal is not what it is guarding against.

   What share of the FULL frame height the boss should cover on the close-up.
   The letterbox eats 11vh top and bottom, leaving a 78% band, and the lower
   third sits inside the bottom of that — so 0.62 puts the boss at about four
   fifths of the visible band with his head and feet clear of the bars. Any
   higher and the shot crops him; this is the number to turn if the close-up
   wants to be tighter or looser. */
const CLOSE_FILL    = 0.62;
const CLOSE_ZOOM_MIN = 8.0;   // a dragon still has to fit
const CLOSE_ZOOM_MAX = 46.0;  // and a rat must not fill the screen
const WIDE_ZOOM_MIN = 3.6;
const WIDE_ZOOM_MAX = 8.5;
const WIDE_MARGIN   = 2.6;    // world units of air around the group on the reveal

/* One slow arc across the whole scene. Deliberately under a quarter-turn: it
   stays inside the yaw quadrant the director had already chosen as unoccluded,
   so the move cannot swing the camera behind a wall. */
const YAW_ARC = 0.35;

/* Lift the subject this fraction of the frame height above dead centre. The
   lower third occupies the bottom of the visible band, and a boss centred in
   the frame has his legs behind it — which is why a real lower third always
   sits under a subject composed high. Expressed against the frame rather than
   in world units so it holds at any zoom, and floored so the pull-back cannot
   drive the look-at point into the ground. */
const RISE_FRAC = 0.09;

/* How long the scene ignores skip input after it starts. Long enough to swallow
   an input already in flight when the boss room opened, short enough that a
   player who wants out barely notices it. */
const SKIP_GRACE_MS = 500;

/* WHERE THE CAMERA LOOKS, VERTICALLY.
   camTarget carries y = 0 everywhere else in the game, and screenOffset()
   measures every body from that ground plane upward — so aiming at a creature
   puts its FEET at the centre of the screen and its whole body in the upper
   half. The director survives that because it frames a spread-out party at a
   wide zoom, where the offset is a small fraction of the frame. A close-up
   cannot: the subject rides high with the floor dead centre, which reads as the
   boss standing in a hole. So the scene aims at mid-torso instead.
   Safe to write: updateCam() takes camTarget whole, and the director resets
   y to 0 on its first frame back.

   The height is measured off the boss rather than fixed, because these 100
   encounters run from rats to dragons — a constant that centres one of them
   leaves the rest riding high or low in frame. */
const AIM_HEIGHT = CAM_BODY_HEIGHT * 0.5;   // fallback for a body with no sprite yet

/**
 * Rendered world height of a creature. `mesh.scale.y` is the sprite quad's
 * height and the quad stands on the ground plane; `grp.scale` carries runtime
 * resizes (the enlarged status), so it has to be folded in. Falls back to the
 * director's nominal body height for a sprite that has not been laid out yet —
 * a degenerate height would otherwise aim the camera into the floor.
 */
function bodyHeight(e) {
  const mesh = e && e.ent && e.ent.anim && e.ent.anim.mesh;
  if (!mesh || !mesh.scale) return CAM_BODY_HEIGHT;
  const grp = (e.ent.grp && e.ent.grp.scale && e.ent.grp.scale.y) || 1;
  const h = mesh.scale.y * grp;
  return h > 0.2 ? h : CAM_BODY_HEIGHT;
}

/** Visual centre of a creature — what the camera should be looking at. */
function bodyAim(e) { return bodyHeight(e) * 0.5; }

/**
 * One full cycle of `action` on a creature's sprite, in seconds; 0 when it has
 * no such sheet (a static billboard, or a monster with idle art only).
 *
 * The two animator shapes spell the same map differently — monsters keep it on
 * `textures`, the wild-shape/familiar animator on `atlasTextures` — so both are
 * checked rather than assuming the boss is one or the other.
 */
function cycleSeconds(e, action) {
  const anim = e && e.ent && e.ent.anim;
  if (!anim) return 0;
  const t = (anim.textures && anim.textures[action])
         || (anim.atlasTextures && anim.atlasTextures[action]);
  return t && t.cfg ? atlasDuration(t.cfg) : 0;
}

/** Restart an action from its first frame, even if already in that state. */
function playFrom(e, action) {
  const anim = e && e.ent && e.ent.anim;
  if (anim && anim.play) anim.play(action, true);
}

/**
 * The zoom at which `boss` alone fills CLOSE_FILL of the frame height.
 *
 * Derived per boss rather than fixed: these encounters run from rats to
 * dragons, and one constant frames exactly one of them properly. A body of
 * world height h covers h*cos(pitch) camera units on screen, and the frame is
 * 2*BASE_HALF/zoom tall, so the zoom that gives it the target share falls
 * straight out.
 */
function closeZoomFor(boss, pitch) {
  const onScreen = bodyHeight(boss) * Math.cos(pitch);
  const wantFrame = onScreen / CLOSE_FILL;
  return clamp((2 * BASE_HALF) / wantFrame, CLOSE_ZOOM_MIN, CLOSE_ZOOM_MAX);
}

const lerp   = (a, b, u) => a + (b - a) * u;
/* Zoom is geometric, so interpolate it that way or the push-in visibly
   decelerates through the second half of a linear ramp. */
const zlerp  = (a, b, u) => a * Math.pow(b / a, u);
const easeIO = u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const easeO  = u => 1 - Math.pow(1 - u, 3);
const clamp  = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* setCamZoom clamps to the gameplay range, which is tighter than the shot
   needs, so the scene writes the camera directly. Everything downstream reads
   cam.zoom, and endBossCutscene puts it back inside the legal range. */
function applyZoom(z) {
  cam.zoom = Math.max(MIN_CAM_ZOOM, z);
  cam.updateProjectionMatrix();
}

/**
 * Half-extents of the smallest screen-aligned box centred on (focusX,
 * AIM_HEIGHT, focusZ) that holds every body — framingExtent's job, but about
 * the raised aim point this scene actually looks at rather than the ground.
 */
export function extentAboutAim(points, focusX, focusZ, yaw, pitch,
                               height = null, aim = AIM_HEIGHT) {
  let hx = 0, hy = 0;
  for (const p of points || []) {
    if (!p) continue;
    /* Each body at its OWN rendered height. An escort swarm measured at the
       director's nominal 2.4 would demand a reveal wide enough for creatures
       twice the size of the ones actually standing there. */
    const top = p.h != null ? p.h : (height != null ? height : bodyHeight(p));
    /* Feet and head, both measured relative to the aim, so a body straddles
       the centre line instead of sitting entirely above it. */
    for (const py of [-aim, top - aim]) {
      const o = screenOffset(p.x, py, p.z, focusX, focusZ, yaw, pitch);
      const ax = Math.abs(o.sx), ay = Math.abs(o.sy);
      if (ax > hx) hx = ax;
      if (ay > hy) hy = ay;
    }
  }
  return { hx, hy };
}

/* ── lower third + letterbox ─────────────────────────────────────────── */

let root = null;

function ensureDom() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'boss-intro';
  root.innerHTML = `
    <div class="bi-bar bi-top"></div>
    <div class="bi-bar bi-bot"></div>
    <div class="bi-third">
      <div class="bi-kicker" id="bi-kicker"></div>
      <div class="bi-name" id="bi-name"></div>
      <div class="bi-sub" id="bi-sub"></div>
    </div>`;
  document.body.appendChild(root);
}

function showBars() {
  ensureDom();
  root.classList.add('show');
  /* Party frames, initiative tracker and combat log otherwise cover most of
     the shot. See the `cutscene-active` rules in game.css. */
  document.body.classList.add('cutscene-active');
}

function showThird(card) {
  ensureDom();
  root.querySelector('#bi-kicker').textContent = card.kicker || '';
  root.querySelector('#bi-name').textContent   = card.name || '';
  root.querySelector('#bi-sub').textContent    = card.sub || '';
  root.classList.add('third');
}

function hideOverlay() {
  if (root) root.classList.remove('show', 'third');
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.remove('cutscene-active');
  }
}

/* ── lifecycle ───────────────────────────────────────────────────────── */

/** True while a scene is playing. */
export function isBossCutsceneActive(game) { return !!(game && game.bossCutscene); }

/**
 * Per-frame arm check. Fires once per expedition, the frame the party first
 * sets foot in the boss room — which is before the monsters in it have woken,
 * so the scene opens on a room nobody is fighting in yet. Safe to call every
 * frame; returns true on the frame it starts.
 */
export function checkBossCutscene(game) {
  if (!game || game.state !== 'crawl' || game.bossCutscene) return false;
  if (game.paused || game.campAnim) return false;
  /* Never cut away from a fight already in progress. */
  if (game.initiative && game.initiative.active) return false;

  const q = game.activeQuest;
  if (!q) return false;
  /* `bossEncounterUsed` is stamped by the spawner with the encounter the boss
     on this floor was actually built from — NOT `q.bossEncounter`, which a
     quest may not carry at all (a dev test delve has none, and the spawner
     falls back to the curated lookup for it).
     Every curated encounter gets a scene: the card is built from its own
     bossTitle and description, and an optional `cutscene` block overrides any
     part of it. No encounter means no boss worth announcing. */
  const enc = game.bossEncounterUsed;
  if (!enc) return false;
  const cut = enc.cutscene || {};
  /* Keyed by quest id rather than a bare flag, so a later expedition re-arms
     the scene without needing a separate reset hook (as boss_card.js does). */
  if (game._bossCutsceneFiredFor === q.id) return false;

  /* Intermediate floors also carry a `boss` room index, so the room alone is
     not enough — require an actual living boss on this floor. */
  const boss = game.boss;
  if (!boss || !boss.data || boss.data.hp <= 0) return false;
  const bossRoom = game.D && game.D.boss;
  if (bossRoom === undefined || !game.visitedRooms || !game.visitedRooms[bossRoom]) return false;

  beginBossCutscene(game, cut);
  return true;
}

/** Start the scene. Exported so the dev hook (and tests) can fire it directly. */
export function beginBossCutscene(game, cut) {
  const boss = game && game.boss;
  if (!boss || game.bossCutscene) return false;

  const q = game.activeQuest || {};
  const enc = game.bossEncounterUsed || {};
  game._bossCutsceneFiredFor = q.id;
  /* One announcement per boss: claim boss_card.js's own once-flag so the
     static reveal does not also fire over the top of the cinematic. */
  game._bossCardFiredFor = q.id;

  const escorts = (game.monsters || []).filter(
    m => m !== boss && !m.isBoss && m.roomId === game.D.boss && m.data && m.data.hp > 0
  );

  const alive = (game.heroes || []).filter(h => h.data && h.data.hp > 0);
  const partyC = centroid(alive) || { x: boss.x, z: boss.z };

  const yaw0 = camYaw;
  const yawEnd = yaw0 + YAW_ARC;
  /* Measured once: nothing resizes while the scene is frozen. */
  const aim = bodyAim(boss);
  const closeZoom = closeZoomFor(boss, CAM_ACTION_PITCH);

  /* WHEN THE BOSS STRIKES.
     One whole idle cycle first, measured off his own sheet rather than assumed
     — cycles run from a third of a second to several — then the attack, then
     idle again for whatever is left of the hold. Clamped at both ends: never
     before the push has settled, and never so late that the one-shot is still
     playing when the camera pulls off him. A creature with no idle sheet gets
     the fallback beat instead of striking instantly. */
  const idleCycle = cycleSeconds(boss, 'idle') || 0.9;
  const atkCycle  = cycleSeconds(boss, 'attack') || 0.5;
  /* The hold is exactly one idle plus the strike. There is no padding after it:
     the animator returns the finished one-shot to idle by itself, and that
     closing idle plays over the pull-back — so the sequence still reads
     idle -> attack -> idle without spending a second of held camera on it. */
  const hold  = clamp(idleCycle + atkCycle, D_HOLD_MIN, D_HOLD_MAX);
  const tPush = D_PUSH;
  const tRoar = tPush + hold;
  const tWide = tRoar + D_WIDE;
  const tEnd  = tWide + D_OUT;
  /* Still clamped, because D_HOLD_MAX can cap a hold shorter than the sequence
     wants. The upper bound carries no safety margin on purpose: when the hold
     IS idle + attack, the strike has to start the instant the idle cycle ends
     or a margin would eat into the idle it is meant to protect. */
  const strikeAt = clamp(tPush + idleCycle,
                         tPush + 0.15,
                         Math.max(tPush + 0.15, tRoar - atkCycle));

  /* The reveal framing is solved once, here, rather than per frame: nothing in
     the room moves while the scene runs, so the answer cannot change, and
     knowing it up front makes the pull-back a clean ramp to a fixed value
     instead of a chase after a live fit. */
  const group = [boss, ...escorts];
  const wideC = centroid(group) || { x: boss.x, z: boss.z };
  const aspect = cam.top > 0 ? cam.right / cam.top : 16 / 9;
  /* Measured about the raised aim point rather than through framingExtent,
     which samples every body from the ground plane up. Feeding it a ground
     focus while the camera actually looks at AIM_HEIGHT would overstate the
     vertical extent by most of a body and pull the reveal needlessly wide. */
  const ext = extentAboutAim(group, wideC.x, wideC.z, yawEnd, camPitch, null, aim);
  const wideZoom = clamp(
    fitZoom(ext.hx, ext.hy, aspect, BASE_HALF, WIDE_MARGIN),
    WIDE_ZOOM_MIN, WIDE_ZOOM_MAX
  );

  game.bossCutscene = {
    t: 0,
    boss,
    card: {
      kicker: cut.kicker || 'The way down is blocked by',
      name:   cut.name || enc.bossTitle || (boss.data && boss.data.name) || 'something waiting',
      sub:    cut.sub != null ? cut.sub : (enc.description || '')
    },
    sfx: cut.sfx || 'warCry',
    shake: cut.shake != null ? cut.shake : 0.7,
    yaw0,
    aim,
    closeZoom,
    strikeAt,
    tPush, tRoar, tWide, tEnd,
    from:  { x: camTarget.x, z: camTarget.z, zoom: cam.zoom, pitch: camPitch },
    party: partyC,
    wide:  { x: wideC.x, z: wideC.z, zoom: wideZoom },
    /* Escorts snap to attention on a stagger during the pull-back, so the
       reveal lands on a line of bodies reacting rather than on a still. */
    cues: escorts.map((m, i) => ({ m, at: tRoar + 0.14 * i, fired: false })),
    holding: false,
    struck: false,
    carded: false,
    skipHandler: null
  };

  /* The crawl is an idle loop the player may be watching unattended, so the
     scene has to be dismissible without hunting for a button.
     The grace window matters: the boss room opens mid-crawl, so an input the
     player had already committed to — a camera drag, a potion key — arrives in
     the first frames and would kill the scene before it had drawn anything.
     Skipping has to be a decision about the cutscene, not a coincidence.
     Timed off performance.now() rather than the scene clock because these
     listeners fire outside the game loop, and while the loop is paused. */
  const armedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const skip = () => {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - armedAt < SKIP_GRACE_MS) return;   // listener stays armed
    endBossCutscene(game);
  };
  game.bossCutscene.skipHandler = skip;
  /* Not { once: true } — an input inside the grace window must not consume the
     registration, or the scene becomes unskippable for the rest of its run. */
  window.addEventListener('pointerdown', skip);
  window.addEventListener('keydown', skip);

  /* Settle the boss before the push-in. In ordinary play he has not engaged
     yet and is already idling, but the scene must not depend on that — fired
     over a boss mid-swing (the dev hook does exactly this), beat 1 would
     otherwise open on a stray attack pose and the shot would show two strikes.
     The hold restarts idle from frame 0 again, so the cycle it times still
     reads whole. */
  boss.walk = false;
  playFrom(boss, 'idle');

  showBars();
  return true;
}

/** Tear the scene down and hand the camera back to the director. */
export function endBossCutscene(game) {
  const s = game && game.bossCutscene;
  if (!s) return;
  if (s.skipHandler) {
    window.removeEventListener('pointerdown', s.skipHandler);
    window.removeEventListener('keydown', s.skipHandler);
  }
  game.bossCutscene = null;
  hideOverlay();
  /* The close-up runs past the gameplay zoom ceiling, so put the camera back
     inside the legal range before handing it over — a skip can land here with
     the shot still at its tightest, and the player's own zoom controls clamp
     against this value. */
  setCamZoom(clamp(cam.zoom, MIN_CAM_ZOOM, MAX_CAM_ZOOM));
  /* Put the look-at point back on the ground plane. The director would do it
     on its next frame, but only when auto-framing is on — leaving a raised
     camTarget behind for a player who has it switched off would silently tilt
     every shot after the fight. */
  camTarget.y = 0;
  /* Handing back mid-move is fine — the director smooths from wherever the
     scene left the camera, so an early skip is not a snap. Its carried state
     (dwell, in-flight turn, zoom goal) is stale after a scripted move though,
     so drop it: this is exactly the "camera snap" case resetDirector is for. */
  if (game._camDir) {
    game._camDir.zoomGoal = null; game._camDir.dwell = 0; game._camDir.turnT = null;
    game._camDir.turnFrom = 0; game._camDir.turnDelta = 0; game._camDir.turnCooldown = 0;
    game._camDir.focusGoalX = null; game._camDir.focusGoalZ = null;
  }
  game.freeCamUntil = 0;   // the director takes the frame back immediately
}

/* ── the scene ───────────────────────────────────────────────────────── */

/**
 * One frame of the cutscene. Call with the UNSCALED delta: this is a
 * fixed-length cinematic, not combat pacing.
 */
export function updateBossCutscene(game, dt) {
  const s = game && game.bossCutscene;
  if (!s) return;

  const boss = s.boss;
  /* A boss that died mid-scene (a lingering DoT, a summon's parting shot) has
     nothing left to introduce. */
  if (!boss || !boss.data || boss.data.hp <= 0) { endBossCutscene(game); return; }

  s.t += dt;
  const t = s.t;
  if (t >= s.tEnd) { endBossCutscene(game); return; }

  /* Yaw arcs across the whole move, independent of the beat boundaries, so the
     three beats read as one continuous shot rather than as three cuts. */
  const yaw = s.yaw0 + YAW_ARC * easeIO(clamp(t / s.tWide, 0, 1));

  let fx, fz, zoom, pitch;

  if (t < s.tPush) {
    /* Beat 1 — leave the party, settle on the boss, drop to the low hero tilt. */
    const u = easeIO(t / s.tPush);
    fx    = lerp(s.party.x, boss.x, u);
    fz    = lerp(s.party.z, boss.z, u);
    zoom  = zlerp(s.from.zoom, s.closeZoom, u);
    pitch = lerp(s.from.pitch, CAM_ACTION_PITCH, u);
  } else if (t < s.tRoar) {
    /* Beat 2 — hold on the boss. He does the work: one clean idle cycle, the
       strike, then idle again for the rest of the shot. The animator returns a
       finished one-shot to idle by itself, so the tail needs no cue. */
    fx = boss.x; fz = boss.z; zoom = s.closeZoom; pitch = CAM_ACTION_PITCH;
    if (!s.holding) {
      s.holding = true;
      boss.walk = false;
      playFrom(boss, 'idle');   // from frame 0, so the cycle reads whole
    }
    if (!s.struck && t >= s.strikeAt) {
      s.struck = true;
      playFrom(boss, 'attack');
      playSfx(s.sfx, { volume: 1, throttleMs: 0 });
      shakeCamera(s.shake);
    }
    /* The lower third arrives once the push has settled, and stays up through
       the strike — it is the title, not a caption on the blow. */
    if (!s.carded && t > s.tPush + 0.35) { s.carded = true; showThird(s.card); }
  } else if (t < s.tWide) {
    /* Beat 3 — pull back onto the whole line-up. Pitch only comes two-thirds
       of the way back to rest: the reveal keeps some of the low angle. */
    const u = easeO((t - s.tRoar) / (s.tWide - s.tRoar));
    fx    = lerp(boss.x, s.wide.x, u);
    fz    = lerp(boss.z, s.wide.z, u);
    zoom  = zlerp(s.closeZoom, s.wide.zoom, u);
    pitch = lerp(CAM_ACTION_PITCH, s.from.pitch, u * 0.65);
  } else {
    /* Beat 4 — drift back toward the party and clear the overlay, so the
       director inherits a camera already most of the way home. */
    const u = easeIO((t - s.tWide) / (s.tEnd - s.tWide));
    fx    = lerp(s.wide.x, lerp(s.wide.x, s.party.x, 0.45), u);
    fz    = lerp(s.wide.z, lerp(s.wide.z, s.party.z, 0.45), u);
    zoom  = zlerp(s.wide.zoom, s.from.zoom, u * 0.6);
    pitch = lerp(lerp(CAM_ACTION_PITCH, s.from.pitch, 0.65), s.from.pitch, u);
    if (root) root.classList.remove('third');
  }

  for (const c of s.cues) {
    if (c.fired || t < c.at) continue;
    c.fired = true;
    c.m.walk = false;
    if (c.m.ent && c.m.ent.anim && c.m.ent.anim.play) c.m.ent.anim.play('attack');
  }

  /* Lift the subject clear of the lower third. Worked in camera units off the
     frame this zoom actually produces, so the composition holds from the tight
     close-up through the wide reveal; floored so a wide frame cannot drag the
     look-at point underground. */
  const frameH = (2 * BASE_HALF) / Math.max(MIN_CAM_ZOOM, zoom);
  const rise = (RISE_FRAC * frameH) / Math.max(0.25, Math.cos(pitch));
  camTarget.set(fx, Math.max(s.aim * 0.25, s.aim - rise), fz);
  applyZoom(zoom);
  setYawPitch(yaw, pitch);   // also refreshes the camera from camTarget
}
