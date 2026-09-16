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

/* The whole SFX registry is data — src/game/sounds.json, edited by
 * sound_editor.html (open it from the game's system menu). It holds:
 *
 *   slots       logical sound name → { files, fallback, category, note }
 *               An EMPTY `files` list means the slot is *declared but
 *               unrecorded*: the game already asks for it by name and
 *               playSfx() substitutes `fallback` until real audio lands.
 *               No fallback + no files = intentionally silent.
 *   abilities   every spell / class feature / boss spell key → slot
 *   cantrips    caster classKey → slot (per-class signature cantrip)
 *   damageTypes damage type → slot, for data-driven monster abilities
 *               that have no named spell of their own
 *
 * audio_coverage.test.js fails the build if an ability has no slot, a slot
 * name is misspelled, or a listed file is missing from public/sounds. */
import SOUNDS from './sounds.json' with { type: 'json' };
import { hasPackedAsset } from './asset_pack.js';

const SFX = {};
const SFX_FALLBACK = {};
for (const [name, slot] of Object.entries(SOUNDS.slots)) {
  SFX[name] = slot.files || [];
  if (slot.fallback) SFX_FALLBACK[name] = slot.fallback;
}

/** Ability / spell key → SFX slot. */
export const SPELL_SFX = SOUNDS.abilities;
const CANTRIP_SFX = SOUNDS.cantrips;
const DMG_TYPE_SFX = SOUNDS.damageTypes;

/* Exposed for audio_coverage.test.js and sound_editor.html so the slot
 * inventory can be audited without duplicating it. */
export { SFX as SFX_SLOTS, SFX_FALLBACK, SFX_DIR, CANTRIP_SFX, DMG_TYPE_SFX };
export const SOUND_META = SOUNDS.slots;

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

export function spellSfx(key) {
  return SPELL_SFX[key] || 'spellImpact';
}

export function cantripSfx(classKey) {
  return CANTRIP_SFX[classKey] || 'spellArcane';
}

/** Slot for a monster ability / boss spell. `key` is its BOSS_SPELL_FX or
 *  SPELLS name when it has one; otherwise the shape of the effect decides. */
export function abilitySfx(key, fx) {
  if (key && SPELL_SFX[key]) return SPELL_SFX[key];
  if (!fx) return 'spellImpact';
  if (fx.heal) return 'spellHeal';
  if (fx.dmgType && DMG_TYPE_SFX[fx.dmgType]) return DMG_TYPE_SFX[fx.dmgType];
  if (fx.buff) return 'warCry';
  if (fx.effect) return 'spellMind';
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

const warnedSlots = new Set();

/* Walk a slot's fallback chain until one with real audio turns up. Returns
   null for a slot that is declared but deliberately silent. Exported so the
   coverage test can assert every slot resolves (or is knowingly silent). */
export function resolveSfx(name) {
  const seen = new Set();
  let n = name;
  while (n && !seen.has(n)) {
    seen.add(n);
    const v = SFX[n];
    if (v && v.length) return v;
    if (v === undefined) {                      // typo'd slot name — never plays
      if (!warnedSlots.has(n)) { warnedSlots.add(n); console.warn('[audio] unknown sfx slot:', n); }
      return null;
    }
    n = SFX_FALLBACK[n];
  }
  return null;
}

export function playSfx(name, { volume = 1, throttleMs = 70 } = {}) {
  if (!unlocked || settings.sfx <= 0) return;
  const c = ensureCtx();
  if (!c) return;
  const now = performance.now();
  if (now - (lastPlay.get(name) || -1e9) < throttleMs) return;
  lastPlay.set(name, now);

  const variants = resolveSfx(name);
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

/* ── UI: stone taps, synthesised ─────────────────────────────────────
   Buttons and tabs are cut stone now (ui_kit.css), so they click like it: a
   short band-passed noise burst with a low knock underneath. Synthesised so
   there is nothing to download and every control sounds like the same
   material; goes through sfxGain like everything else. `hover` is the same
   tap, much quieter and thinner. */
let uiNoise = null;
function noiseBuffer(c) {
  if (uiNoise) return uiNoise;
  const n = Math.floor(c.sampleRate * 0.12);
  uiNoise = c.createBuffer(1, n, c.sampleRate);
  const d = uiNoise.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return uiNoise;
}
export function playUiTap(kind = 'click') {
  if (!unlocked || settings.sfx <= 0) return;
  const c = ensureCtx();
  if (!c) return;
  const now = performance.now();
  const key = 'ui:' + kind;
  if (now - (lastPlay.get(key) || -1e9) < (kind === 'hover' ? 60 : 40)) return;
  lastPlay.set(key, now);
  const t = c.currentTime;
  const hover = kind === 'hover';
  const out = c.createGain();
  out.gain.value = hover ? 0.08 : 0.32;
  out.connect(sfxGain);
  // the grit: filtered noise, very short
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = hover ? 2600 : 1400 + Math.random() * 300;
  bp.Q.value = hover ? 2.2 : 1.1;
  const env = c.createGain();
  env.gain.setValueAtTime(1, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + (hover ? 0.035 : 0.075));
  src.connect(bp); bp.connect(env); env.connect(out);
  src.start(t); src.stop(t + 0.1);
  // the knock: a pitched thump under a click, none under a hover
  if (!hover) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(190 + Math.random() * 30, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.06);
    const g = c.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.08);
  }
}

/* ── narration (voiced flavor text) ────────────────────────────────── */

const NARR_DIR = SFX_DIR + 'Narration/';
let narrationQueue = [];   // pending [{id, volume, delay}], played in order
let narrationGen = 0;      // bumped on interrupt/stop so in-flight loads/timers bail
let narrationWaiting = false;  // true while a pre-line delay timer is pending
let narrationLoading = false;  // true while a line's buffer is fetching/decoding
                               // (without it, a queue call landing in the async
                               // load window double-pulls and lines overlap)

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
  narrationLoading = false;     // stale in-flight loads bail on the gen check
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

/* Files to try for a line, in order. Dev serves the recorded .wav; the web
   build ships narration transcoded to .mp3 inside the asset pack, and probing
   the .wav there is a guaranteed 404 per line, so go straight to the mp3 when
   the pack says that is all it has. */
function narrationCandidates(id) {
  const base = NARR_DIR + narrationId(id);
  if (hasPackedAsset(base + '.mp3') && !hasPackedAsset(base + '.wav')) return [base + '.mp3'];
  return [base + '.wav', base + '.mp3'];
}

/* Pull the next queued line and play it once the current one is free. A missing
   file is skipped (silently advances), so unrecorded lines never stall or break
   the game. Tries .wav then .mp3. */
function playNextNarration(c) {
  if (narrationSrc || narrationWaiting || narrationLoading || !narrationQueue.length) return;
  const gen = narrationGen;
  const { id, volume, delay = 0 } = narrationQueue.shift();

  const begin = () => {
    narrationWaiting = false;
    if (gen !== narrationGen) return;                         // interrupted during delay
    const [first, second] = narrationCandidates(id);
    narrationLoading = true;
    loadNarrationBuffer(c, first)
      .then(b => b || (second ? loadNarrationBuffer(c, second) : null))
      .then(b => {
        if (gen !== narrationGen) return;                     // interrupted mid-load (stop cleared the flag)
        narrationLoading = false;
        if (!b || !(b instanceof AudioBuffer)) {              // missing → skip (but say so)
          console.warn('[narration] no audio for id:', id);
          playNextNarration(c);
          return;
        }
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
      .catch(() => {
        if (gen !== narrationGen) return;
        narrationLoading = false;
        playNextNarration(c);
      });
  };

  if (delay > 0) { narrationWaiting = true; setTimeout(begin, delay); }
  else begin();
}

/* True while any narration is playing, loading, delayed, or queued — lets
   callers (e.g. the intro crawl) hold a scene open until the voice finishes. */
export function isNarrationActive() {
  return !!(narrationSrc || narrationWaiting || narrationLoading || narrationQueue.length);
}

/* Warm the buffer cache for upcoming lines so chained narration has no
   fetch/decode gap between them. Fire-and-forget; safe before unlock. */
export function preloadNarration(ids) {
  const c = ensureCtx();
  if (!c) return;
  for (const id of ids || []) {
    loadNarrationBuffer(c, narrationCandidates(id)[0]);
  }
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

export function preloadCommonSFX() {
  const c = ensureCtx();
  if (!c) return Promise.resolve();
  const promises = [];
  for (const name of Object.keys(SOUNDS.slots || {})) {
    const variants = resolveSfx(name);
    if (!variants) continue;
    for (const v of variants) {
      const path = SFX_DIR + v;
      if (!buffers.has(path)) {
        const p = fetch(encodeURI(path))
          .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
          .then(ab => c.decodeAudioData(ab))
          .then(b => { buffers.set(path, b); return b; })
          .catch(() => { buffers.delete(path); return null; });
        buffers.set(path, p);
        promises.push(p);
      }
    }
  }
  return Promise.all(promises);
}

/* ── init: autoplay unlock + volume UI ─────────────────────────────── */

function unlock() {
  if (unlocked) return;
  unlocked = true;
  const c = ensureCtx();
  if (c && c.state === 'suspended') c.resume();
  if (settings.music > 0) startMusic();
  try { preloadCommonSFX(); } catch (e) {}
}

export function initAudio() {
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  /* No volume UI here any more: the three sliders moved into the shared Options
     panel (options_ui.js), which reads/writes them through the getters and
     setters below. The volumes themselves still live in this module's own
     storage key — the audio graph owns them. */
}

