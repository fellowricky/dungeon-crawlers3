/**
 * Loading-curtain worker. Draws the plate loop and the weather on canvases
 * the curtain handed over with transferControlToOffscreen, so both keep
 * moving while the main thread is stuck in a floor forge, a shader compile,
 * or a texture decode.
 *
 * The plate loop is decoded here with WebCodecs. A <video> element cannot do
 * this job: it needs the main thread to load its data and to loop, so it froze
 * along with everything else. Any failure here is reported back, and the
 * curtain falls back to the <video> element.
 *
 * Messages in:  plate-canvas {canvas}, plate {url, serial}, plate-stop,
 *               weather-canvas {canvas}, weather {kind, seed}, weather-stop,
 *               probe {on}, probe-dump
 * Messages out: plate-shown {serial}, plate-failed {serial, reason},
 *               probe {origin, weather[], plate[]}
 */
import { demuxMp4 } from './mp4_demux.js';
import { createWeatherPainter, WEATHER_FX, PLATE_WEATHER_W, PLATE_WEATHER_H } from './loading_weather_paint.js';

const FALLBACK_TICK_MS = 40;
/* Decoded frames waiting to be shown, and chunks in the decoder. A few of
   each covers the B-frame reorder without holding many 1280×736 frames. */
const MAX_READY = 6;
const MAX_DECODING = 4;
/* A decoder that falls this far behind the clock restarts the clock from
   the frame it has, so the loop slows for a moment instead of skipping. */
const LATE_US = 250000;
const CACHE_MAX = 4;

const hasRaf = typeof self.requestAnimationFrame === 'function';

let plateCanvas = null;
let plateCtx = null;
let weatherCanvas = null;
let weatherCtx = null;
let weatherImg = null;
let painter = null;

let weather = null; // { kind, seed, t0 }
let plate = null;   // playback state, see startPlate
const files = new Map(); // url -> Promise<{ buf, info }>

let probing = false;
const probeWeather = [];
const probePlate = [];

let scheduled = false;
let rafId = 0;
let timerId = 0;

function schedule() {
  if (scheduled || !(weather || plate)) return;
  scheduled = true;
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    scheduled = false;
    if (rafId && hasRaf) self.cancelAnimationFrame(rafId);
    clearTimeout(timerId);
    rafId = 0;
    tick(performance.now());
  };
  /* rAF paces to the display. The timer covers a canvas the browser is not
     drawing yet (still display:none), where worker rAF may never fire. */
  if (hasRaf) rafId = self.requestAnimationFrame(go);
  timerId = setTimeout(go, FALLBACK_TICK_MS);
}

function tick(now) {
  if (weather) drawWeather(now);
  if (plate) drawPlate(now);
  schedule();
}

/* ---------------- weather ---------------- */

function drawWeather(now) {
  if (!weatherCtx) return;
  if (!painter) painter = createWeatherPainter();
  if (!weatherImg) weatherImg = weatherCtx.createImageData(PLATE_WEATHER_W, PLATE_WEATHER_H);
  weatherImg.data.set(painter.rgba(weather.kind, (now - weather.t0) / 1000, weather.seed));
  weatherCtx.putImageData(weatherImg, 0, 0);
  if (probing) probeWeather.push(now);
}

function startWeather(kind, seed) {
  if (!weatherCanvas || !WEATHER_FX[kind]) { stopWeather(); return; }
  weather = { kind, seed: (Number(seed) >>> 0) || 1, t0: performance.now() };
  schedule();
}

function stopWeather() {
  weather = null;
  if (weatherCtx) weatherCtx.clearRect(0, 0, weatherCanvas.width, weatherCanvas.height);
}

/* ---------------- plate loop ---------------- */

function loadFile(url) {
  if (files.has(url)) return files.get(url);
  const job = fetch(url)
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    })
    .then(buf => {
      const info = demuxMp4(buf);
      if (!info) throw new Error('unsupported mp4');
      return { buf, info };
    });
  job.catch(() => files.delete(url));
  files.set(url, job);
  while (files.size > CACHE_MAX) files.delete(files.keys().next().value);
  return job;
}

function closePlate(p) {
  if (!p) return;
  p.dead = true;
  for (const f of p.ready) { try { f.close(); } catch (e) { /* closed */ } }
  p.ready.length = 0;
  if (p.decoder && p.decoder.state !== 'closed') {
    try { p.decoder.close(); } catch (e) { /* closed */ }
  }
}

function failPlate(p, reason) {
  if (p.dead) return;
  closePlate(p);
  if (plate === p) plate = null;
  self.postMessage({ op: 'plate-failed', serial: p.serial, reason: String(reason || 'error') });
}

async function startPlate(url, serial) {
  closePlate(plate);
  plate = null;
  if (!plateCanvas) {
    self.postMessage({ op: 'plate-failed', serial, reason: 'no canvas' });
    return;
  }
  const p = {
    url, serial, dead: false, decoder: null, info: null, buf: null,
    next: 0, loop: 0, flushing: false, ready: [], clock: 0, shown: false
  };
  plate = p;
  let file;
  try {
    if (typeof VideoDecoder !== 'function' || typeof EncodedVideoChunk !== 'function') throw new Error('no WebCodecs');
    file = await loadFile(url);
    const base = {
      codec: file.info.codec,
      description: file.info.description,
      codedWidth: file.info.width,
      codedHeight: file.info.height
    };
    /* Software first. A hardware decoder lives in the GPU process, and the
       shader compiles of a floor load keep that busy for a second at a time,
       which stalls the loop. One 720p stream is cheap on a CPU thread. */
    let config = null;
    for (const hardwareAcceleration of ['prefer-software', 'no-preference']) {
      const trial = { ...base, hardwareAcceleration };
      const support = await VideoDecoder.isConfigSupported(trial).catch(() => null);
      if (support && support.supported) { config = trial; break; }
    }
    if (!config) throw new Error('codec ' + base.codec + ' unsupported');
    if (p.dead) return;
    p.info = file.info;
    p.buf = file.buf;
    p.decoder = new VideoDecoder({
      output: (frame) => {
        if (p.dead) { frame.close(); return; }
        p.ready.push(frame);
      },
      error: (e) => failPlate(p, e && e.message)
    });
    p.decoder.configure(config);
  } catch (e) {
    failPlate(p, e && e.message);
    return;
  }
  if (plateCanvas.width !== p.info.width) plateCanvas.width = p.info.width;
  if (plateCanvas.height !== p.info.height) plateCanvas.height = p.info.height;
  feed(p);
  schedule();
}

function feed(p) {
  if (p.dead || !p.decoder || p.decoder.state !== 'configured') return;
  const samples = p.info.samples;
  while (!p.flushing && p.decoder.decodeQueueSize < MAX_DECODING && p.ready.length < MAX_READY) {
    if (p.next >= samples.length) {
      /* End of the file: drain the reorder buffer, then start over on the
         first keyframe with the clock carried forward one loop. */
      p.flushing = true;
      p.decoder.flush().then(() => {
        p.flushing = false;
        p.loop += 1;
        p.next = 0;
        feed(p);
      }, (e) => failPlate(p, e && e.message));
      return;
    }
    const s = samples[p.next++];
    try {
      p.decoder.decode(new EncodedVideoChunk({
        type: s.key ? 'key' : 'delta',
        timestamp: s.ptsUs + p.loop * p.info.durationUs,
        duration: s.durUs,
        data: new Uint8Array(p.buf, s.offset, s.size)
      }));
    } catch (e) {
      failPlate(p, e && e.message);
      return;
    }
  }
}

function drawPlate(now) {
  const p = plate;
  if (!p.decoder) return;
  feed(p);
  if (!p.ready.length) return;
  p.ready.sort((a, b) => a.timestamp - b.timestamp);
  if (!p.shown) p.clock = now - p.ready[0].timestamp / 1000;
  let playUs = (now - p.clock) * 1000;
  let pick = -1;
  for (let i = 0; i < p.ready.length; i++) {
    if (p.ready[i].timestamp <= playUs) pick = i;
    else break;
  }
  if (pick < 0) return;
  const frame = p.ready[pick];
  if (frame.timestamp < playUs - LATE_US) p.clock = now - frame.timestamp / 1000;
  for (let i = 0; i < pick; i++) p.ready[i].close();
  p.ready.splice(0, pick + 1);
  plateCtx.drawImage(frame, 0, 0, plateCanvas.width, plateCanvas.height);
  frame.close();
  if (probing) probePlate.push(now);
  if (!p.shown) {
    p.shown = true;
    self.postMessage({ op: 'plate-shown', serial: p.serial });
  }
  feed(p);
}

function stopPlate() {
  closePlate(plate);
  plate = null;
}

/* ---------------- messages ---------------- */

self.onmessage = (ev) => {
  const m = ev.data || {};
  switch (m.op) {
    case 'plate-canvas':
      plateCanvas = m.canvas;
      plateCtx = plateCanvas.getContext('2d', { alpha: false });
      break;
    case 'weather-canvas':
      weatherCanvas = m.canvas;
      weatherCanvas.width = PLATE_WEATHER_W;
      weatherCanvas.height = PLATE_WEATHER_H;
      weatherCtx = weatherCanvas.getContext('2d');
      weatherImg = null;
      break;
    case 'plate':
      startPlate(m.url, m.serial);
      break;
    case 'plate-stop':
      stopPlate();
      break;
    case 'weather':
      startWeather(m.kind, m.seed);
      break;
    case 'weather-stop':
      stopWeather();
      break;
    case 'probe':
      probing = !!m.on;
      break;
    case 'probe-dump':
      self.postMessage({ op: 'probe', origin: performance.timeOrigin, weather: probeWeather.slice(), plate: probePlate.slice() });
      break;
    default:
      break;
  }
};
