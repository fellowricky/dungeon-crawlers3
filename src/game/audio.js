/* =========================================================================
 * Audio — WebAudio SFX + streamed music playlist with persisted volumes.
 *
 * SFX (.wav) are fetched + decoded lazily on first play and cached; each
 * logical sound has several variant files and gets slight playback-rate
 * jitter so repeated hits don't machine-gun. Music (.mp3) streams through
 * a single <audio> element as a continuously shuffled playlist.
 *
 * Nothing plays until the first user gesture (browser autoplay policy):
 * initAudio() arms one-shot pointer/key listeners that unlock the
 * AudioContext and start the music.
 * ========================================================================= */

const SFX_DIR = 'sounds/';
const MUSIC_DIR = 'music/';
const LS_KEY = 'dc_audio_v1';

const SWORD = 'Attacks/Sword Attacks Hits and Blocks/';
const BOW = 'Attacks/Bow Attacks Hits and Blocks/';
const DOORS = 'Doors Gates and Chests/';
const SPELL = 'Spells/';

const SFX = {
  swordAttack: [SWORD + 'Sword Attack 1.wav', SWORD + 'Sword Attack 2.wav', SWORD + 'Sword Attack 3.wav'],
  swordHit:    [SWORD + 'Sword Impact Hit 1.wav', SWORD + 'Sword Impact Hit 2.wav', SWORD + 'Sword Impact Hit 3.wav'],
  swordBlock:  [SWORD + 'Sword Blocked 1.wav', SWORD + 'Sword Blocked 2.wav', SWORD + 'Sword Blocked 3.wav'],
  swordParry:  [SWORD + 'Sword Parry 1.wav', SWORD + 'Sword Parry 2.wav', SWORD + 'Sword Parry 3.wav'],
  bowAttack:   [BOW + 'Bow Attack 1.wav', BOW + 'Bow Attack 2.wav'],
  bowHit:      [BOW + 'Bow Impact Hit 1.wav', BOW + 'Bow Impact Hit 2.wav', BOW + 'Bow Impact Hit 3.wav'],
  bowBlock:    [BOW + 'Bow Blocked 1.wav', BOW + 'Bow Blocked 2.wav', BOW + 'Bow Blocked 3.wav'],

  chestOpen:   [DOORS + 'Chest Open 1.wav', DOORS + 'Chest Open 2.wav'],
  doorOpen:    [DOORS + 'Door Open 1.wav', DOORS + 'Door Open 2.wav'],
  gateOpen:    [DOORS + 'Gate Open.wav'],
  portcullis:  [DOORS + 'Portcullis Gate.wav'],
  lockUnlock:  [DOORS + 'Lock Unlock.wav'],

  spellFire:      [SPELL + 'Fireball 1.wav', SPELL + 'Fireball 2.wav', SPELL + 'Fireball 3.wav'],
  spellFireSpray: [SPELL + 'Firespray 1.wav', SPELL + 'Firespray 2.wav'],
  spellBuff:      [SPELL + 'Firebuff 1.wav', SPELL + 'Firebuff 2.wav'],
  spellIce:       [SPELL + 'Ice Throw 1.wav', SPELL + 'Ice Throw 2.wav'],
  spellIceStorm:  [SPELL + 'Ice Barrage 1.wav', SPELL + 'Ice Barrage 2.wav'],
  spellFreeze:    [SPELL + 'Ice Freeze 1.wav', SPELL + 'Ice Freeze 2.wav'],
  spellIceWall:   [SPELL + 'Ice Wall 1.wav', SPELL + 'Ice Wall 2.wav'],
  spellRock:      [SPELL + 'Rock Meteor Throw 1.wav', SPELL + 'Rock Meteor Throw 2.wav'],
  spellRockStorm: [SPELL + 'Rock Meteor Swarm 1.wav', SPELL + 'Rock Meteor Swarm 2.wav'],
  spellRockWall:  [SPELL + 'Rock Wall 1.wav', SPELL + 'Rock Wall 2.wav'],
  spellWater:     [SPELL + 'Waterspray 1.wav', SPELL + 'Waterspray 2.wav'],
  spellWave:      [SPELL + 'Wave Attack 1.wav', SPELL + 'Wave Attack 2.wav'],
  spellImpact:    [SPELL + 'Spell Impact 1.wav', SPELL + 'Spell Impact 2.wav', SPELL + 'Spell Impact 3.wav'],
};

const TRACKS = [
  '1. Dawn of Blades.mp3', '2. Echoes of the Keep.mp3', '3. Twilight March.mp3',
  '4. Ballad of Ashenwood.mp3', '5. Riders of the Storm.mp3', '6. Moonlit Vale.mp3',
  '7. Chant of the Fallen.mp3', '8. Frostbound Path.mp3', '9. The Old Tavern.mp3',
  '10. Crown of Thorns.mp3', '11. Whispers in the Fog.mp3', '12. March of Iron.mp3',
  '13. The Forgotten Grove.mp3', '14. Sacred Springs.mp3', '15. Legends of the Flame.mp3',
  '16. Silent Citadel.mp3', '17. Hymn of Valor.mp3', '18. The Dark Moor.mp3',
  '19. Call of the Raven.mp3', '20. Lament of Kings.mp3', '21. The Silent Lake.mp3',
  '22. Banners in the Wind.mp3', '23. The Last Watch.mp3', '24. Blood and Honor.mp3',
  '25. Tales by Firelight.mp3', '26. Echoes of Eternity.mp3', '27. The Broken Crown.mp3',
  '28. Tales of the Hearth.mp3', '29. Arcane Whispers.mp3', '30. The Hidden Glade.mp3',
];

/* Ability/spell key (ABILITY_FX in combat.js) → SFX name. Elemental spells
 * get their own sound; anything not listed falls back by feel: heals and
 * buffs whoosh softly, offensive magic lands as a generic arcane impact. */
const SPELL_SFX = {
  fireball: 'spellFire', flameStrike: 'spellFire', wallOfFire: 'spellFireSpray',
  scorchingRay: 'spellFireSpray', dragonBreath: 'spellFireSpray', dragonBreathSpell: 'spellFireSpray',
  iceStorm: 'spellIceStorm', coneOfCold: 'spellFreeze', moonbeam: 'spellIce',
  sleep: 'spellFreeze', slow: 'spellFreeze', holdPerson: 'spellFreeze', holdMonster: 'spellFreeze',
  shatter: 'spellRockStorm', entangle: 'spellRockWall', web: 'spellRockWall', grease: 'spellRockWall',
  acidArrow: 'spellWater', vampiricTouch: 'spellWater',
  armsOfHadar: 'spellWave', blight: 'spellWave', fear: 'spellWave',
};
const HEAL_BUFF_SFX = new Set([
  'secondWind', 'actionSurge', 'flurry', 'frenzy', 'rage', 'bearTotem', 'bardic', 'combatSong',
  'cunningAction', 'remarkableAthlete', 'fastHands', 'wildShape', 'tidesOfChaos', 'indomitable',
  'lucky', 'layOnHands', 'cureWounds', 'healingWord', 'massHealingWord', 'massCureWounds',
  'lesserRestoration', 'greaterRestoration', 'preserveLife', 'rallyingCry', 'bless', 'haste',
  'shield', 'protectionFromEvil', 'deathWard', 'sacredWeapon', 'guidedStrike', 'vowOfEnmity',
  'huntersMark', 'shadowStep', 'mistyStep', 'feyPresence', 'fiendishBlessing', 'hex', 'faerieFire',
]);

export function spellSfx(key) {
  if (SPELL_SFX[key]) return SPELL_SFX[key];
  if (HEAL_BUFF_SFX.has(key)) return 'spellBuff';
  return 'spellImpact';
}

/* ── state ─────────────────────────────────────────────────────────── */

let ctx = null, sfxGain = null, narrationGain = null;
let narrationSrc = null;     // currently-playing narration source (one at a time)
let unlocked = false;
const buffers = new Map();   // path → AudioBuffer | Promise
const lastPlay = new Map();  // sfx name → performance.now() of last start

const settings = { sfx: 0.8, music: 0.5, narration: 0.9 };
try { Object.assign(settings, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch { /* fresh defaults */ }

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  sfxGain = ctx.createGain();
  sfxGain.gain.value = settings.sfx * settings.sfx;   // x² ≈ perceptual loudness
  sfxGain.connect(ctx.destination);
  narrationGain = ctx.createGain();
  narrationGain.gain.value = settings.narration * settings.narration;
  narrationGain.connect(ctx.destination);
  return ctx;
}

/* ── SFX ───────────────────────────────────────────────────────────── */

export function playSfx(name, { volume = 1, throttleMs = 70 } = {}) {
  if (!unlocked || settings.sfx <= 0) return;
  const c = ensureCtx();
  if (!c) return;
  const now = performance.now();
  if (now - (lastPlay.get(name) || -1e9) < throttleMs) return;
  lastPlay.set(name, now);

  const variants = SFX[name];
  if (!variants) return;
  const path = SFX_DIR + variants[(Math.random() * variants.length) | 0];

  let buf = buffers.get(path);
  if (!buf) {
    buf = fetch(encodeURI(path))
      .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(ab => c.decodeAudioData(ab))
      .then(b => { buffers.set(path, b); return b; })
      .catch(() => { buffers.delete(path); return null; });
    buffers.set(path, buf);
  }
  Promise.resolve(buf).then(b => {
    if (!b || !(b instanceof AudioBuffer)) return;
    const src = c.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const g = c.createGain();
    g.gain.value = volume;
    src.connect(g);
    g.connect(sfxGain);
    src.start();
  });
}

/* ── narration (voiced flavor text) ────────────────────────────────── */

const NARR_DIR = SFX_DIR + 'Narration/';
let narrationQueue = [];   // pending [{id, volume, delay}], played in order
let narrationGen = 0;      // bumped on interrupt/stop so in-flight loads/timers bail
let narrationWaiting = false;  // true while a pre-line delay timer is pending

/* slug() MUST stay byte-for-byte identical to scripts/narration/extract.mjs so
   the id the game asks for matches the recorded filename. */
export function narrationId(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/* Interrupt: cut off the current line and drop anything queued. */
export function stopNarration() {
  narrationGen++;               // bumping this makes any pending delay timer bail
  narrationQueue.length = 0;
  narrationWaiting = false;
  const src = narrationSrc;
  narrationSrc = null;
  if (src) { src.onended = null; try { src.stop(); } catch { /* already ended */ } }
}

function loadNarrationBuffer(c, path) {
  const cached = buffers.get(path);
  if (cached) return Promise.resolve(cached);
  const p = fetch(encodeURI(path))
    .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(ab => c.decodeAudioData(ab))
    .then(b => { buffers.set(path, b); return b; })
    .catch(() => { buffers.delete(path); return null; });
  buffers.set(path, p);
  return p;
}

/* Pull the next queued line and play it once the current one is free. A missing
   file is skipped (silently advances), so unrecorded lines never stall or break
   the game. Tries .wav then .mp3. */
function playNextNarration(c) {
  if (narrationSrc || narrationWaiting || !narrationQueue.length) return;
  const gen = narrationGen;
  const { id, volume, delay = 0 } = narrationQueue.shift();

  const begin = () => {
    narrationWaiting = false;
    if (gen !== narrationGen) return;                         // interrupted during delay
    const base = NARR_DIR + narrationId(id);
    loadNarrationBuffer(c, base + '.wav')
      .then(b => b || loadNarrationBuffer(c, base + '.mp3'))
      .then(b => {
        if (gen !== narrationGen) return;                     // interrupted mid-load
        if (!b || !(b instanceof AudioBuffer)) { playNextNarration(c); return; }  // missing → skip
        const src = c.createBufferSource();
        src.buffer = b;
        const g = c.createGain();
        g.gain.value = volume;
        src.connect(g);
        g.connect(narrationGain);
        src.onended = () => { if (narrationSrc === src) { narrationSrc = null; playNextNarration(c); } };
        narrationSrc = src;
        src.start();
      })
      .catch(() => { if (gen === narrationGen) playNextNarration(c); });
  };

  if (delay > 0) { narrationWaiting = true; setTimeout(begin, delay); }
  else begin();
}

/* Play a line now, interrupting whatever is playing/queued (use for a fresh
   context, e.g. a new challenge's situation line). */
export function playNarration(id, { volume = 1 } = {}) {
  if (!unlocked || settings.narration <= 0 || !id) return;
  const c = ensureCtx();
  if (!c) return;
  stopNarration();
  narrationQueue.push({ id, volume });
  playNextNarration(c);
}

/* Append a line to play after the current one finishes (use to chain, e.g. the
   chosen action line then its outcome). `delay` (ms) inserts a beat before this
   line starts, measured from when the previous line ends. */
export function queueNarration(id, { volume = 1, delay = 0 } = {}) {
  if (!unlocked || settings.narration <= 0 || !id) return;
  const c = ensureCtx();
  if (!c) return;
  narrationQueue.push({ id, volume, delay });
  playNextNarration(c);
}

/* ── music ─────────────────────────────────────────────────────────── */

let musicEl = null, playlist = [], trackI = 0, musicStarted = false, musicErrors = 0;

function shuffled() {
  const a = TRACKS.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextTrack() {
  if (trackI >= playlist.length) { playlist = shuffled(); trackI = 0; }
  musicEl.src = encodeURI(MUSIC_DIR + playlist[trackI++]);
  musicEl.play().catch(() => { /* resumes on next gesture via unlock */ });
}

function startMusic() {
  if (musicStarted) { if (musicEl.paused) musicEl.play().catch(() => {}); return; }
  musicStarted = true;
  musicEl = new Audio();
  musicEl.volume = settings.music * settings.music;
  musicEl.addEventListener('ended', nextTrack);
  musicEl.addEventListener('playing', () => { musicErrors = 0; });
  musicEl.addEventListener('error', () => {
    if (++musicErrors <= 3) setTimeout(nextTrack, 1500);   // skip a bad file, but don't loop forever
  });
  playlist = shuffled();
  trackI = 0;
  nextTrack();
}

/* ── volume API ────────────────────────────────────────────────────── */

export function setSfxVolume(v) {
  settings.sfx = v;
  if (sfxGain) sfxGain.gain.value = v * v;
  save();
}

export function setMusicVolume(v) {
  settings.music = v;
  save();
  if (!musicEl) { if (v > 0 && unlocked) startMusic(); return; }
  musicEl.volume = v * v;
  if (v <= 0) musicEl.pause();
  else if (musicEl.paused && unlocked) musicEl.play().catch(() => {});
}

export function setNarrationVolume(v) {
  settings.narration = v;
  if (narrationGain) narrationGain.gain.value = v * v;
  save();
}

export const getSfxVolume = () => settings.sfx;
export const getMusicVolume = () => settings.music;
export const getNarrationVolume = () => settings.narration;

/* ── init: autoplay unlock + volume UI ─────────────────────────────── */

function unlock() {
  if (unlocked) return;
  unlocked = true;
  const c = ensureCtx();
  if (c && c.state === 'suspended') c.resume();
  if (settings.music > 0) startMusic();
}

export function initAudio() {
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  initVolumeUI();
}

function initVolumeUI() {
  const bar = document.getElementById('topnav');
  if (!bar || document.getElementById('audio-ctl')) return;
  const wrap = document.createElement('span');
  wrap.id = 'audio-ctl';
  wrap.innerHTML = `
    <button id="audio-btn" title="Audio volume" aria-label="Audio volume">🔊 <span>Audio</span></button>
    <div id="audio-pop">
      <label>🎵 <input id="vol-music" type="range" min="0" max="100" aria-label="Music volume"></label>
      <label>⚔️ <input id="vol-sfx" type="range" min="0" max="100" aria-label="Sound effects volume"></label>
      <label>🗣️ <input id="vol-narr" type="range" min="0" max="100" aria-label="Narration volume"></label>
    </div>`;
  bar.appendChild(wrap);

  const pop = wrap.querySelector('#audio-pop');
  const mus = wrap.querySelector('#vol-music');
  const sfx = wrap.querySelector('#vol-sfx');
  const narr = wrap.querySelector('#vol-narr');
  mus.value = Math.round(settings.music * 100);
  sfx.value = Math.round(settings.sfx * 100);
  narr.value = Math.round(settings.narration * 100);

  wrap.querySelector('#audio-btn').addEventListener('click', () => pop.classList.toggle('show'));
  mus.addEventListener('input', () => setMusicVolume(mus.value / 100));
  sfx.addEventListener('input', () => setSfxVolume(sfx.value / 100));
  narr.addEventListener('input', () => setNarrationVolume(narr.value / 100));
  /* audible feedback once the user settles on an SFX level */
  sfx.addEventListener('change', () => playSfx('swordHit', { throttleMs: 0 }));
  document.addEventListener('pointerdown', e => {
    if (!wrap.contains(e.target)) pop.classList.remove('show');
  });
}
