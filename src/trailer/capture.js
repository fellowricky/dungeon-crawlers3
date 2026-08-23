/**
 * TRAILER CAPTURE — one frame in, one file out.
 *
 * Deliberately not MediaRecorder. The shared renderer is created without
 * `preserveDrawingBuffer` (see createWebGLRenderer in dungeon_scene.js), so
 * canvas.toBlob() after a render is not reliable — and MediaRecorder timestamps
 * against wall clock in some browsers, which would turn a load gate into a
 * held frame in the muxed output.
 *
 * Instead: gl.readPixels straight off the default framebuffer in the same task
 * as the draw (always valid, no context flags needed), then hand a numbered PNG
 * to the dev server. Wall clock is irrelevant by construction, so a thirty
 * second stall between frames costs the output nothing.
 *
 * Backends:
 *   'none'   — render only, no files. The preview/test mode.
 *   'video'  — stream frames into a server-side ffmpeg, which writes an mp4.
 *              Nothing hits disk as an image. This is the default for a real
 *              render: a 42s 1080p tour is ~5.6 GB of PNGs and tens of MB as
 *              H.264, and it removes the manual ffmpeg step afterwards.
 *   'server' — dump numbered PNGs to trailer_out/<shot>/. Kept for when the
 *              individual stills are actually wanted (capsule art, thumbnails).
 */
import { renderer } from '../render/dungeon_scene.js';

export class Capture {
  constructor({ backend = 'none', shot = 'shot', fps = 60, crf = 18, hw = true, out = null } = {}) {
    this.backend = backend;
    this.shot = shot;
    this.fps = fps;
    this.crf = crf ?? 18;
    this.quality = 0.94;   /* JPEG quality for the video pipe */
    /* GPU encoding (NVENC) is ON by default. Measured back to back on an
       RTX 5080 at 720p, same page, same shot:

         libx264 (CPU)    15.1 fps    15.1 MB
         h264_nvenc (GPU) 21.3 fps     9.0 MB

       so it is both faster and smaller. An earlier reading suggested the
       opposite (4.6 fps) but was taken across separate page loads in different
       states and did not hold up when the two were run side by side. Set
       `hw: false` on a shot to force the CPU encoder.

       Note NVENC rejects frames below its minimum dimensions, so the server's
       capability probe uses a 256x256 test frame — a smaller one fails in a way
       that reads exactly like "no GPU encoder present". */
    this.hw = hw;
    /* Delivery size. When the render is supersampled the frames arriving here
       are larger; ffmpeg does the downscale, which is both faster and a better
       filter than doing it in canvas. */
    this.out = out;
    this.index = 0;
    this.errors = 0;
    this.result = null;
    this._canvas = null;
    this._ctx = null;
    this._started = false;
    /* Ordered transmission: blobs land here keyed by frame index, and _drain
       ships them in ascending order so ffmpeg never sees a frame early. */
    this._queue = new Map();
    this._skipped = new Set();
    this._next = 0;
    this._sending = false;
    /* Debug: stamp each frame with its index as a binary block pattern, so the
       finished video can be decoded and the frame order verified. Off unless a
       shot asks for it. */
    this.stamp = false;
  }

  get enabled() { return this.backend !== 'none'; }

  /** Spin up the encoder. Must be awaited before the first frame. */
  async begin() {
    if (this.backend !== 'video' || this._started) return;
    const res = await fetch(
      `/api/trailer-encode/start?shot=${encodeURIComponent(this.shot)}&fps=${this.fps}` +
      `&crf=${this.crf}&vflip=1&hw=${this.hw ? 1 : 0}` +
      (this.out ? `&w=${this.out[0]}&h=${this.out[1]}` : ''),
      { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) throw new Error(body.error || `encoder failed to start (HTTP ${res.status})`);
    this.encoder = body.encoder;
    console.log(`[trailer] encoding with ${body.encoder}`);
    this._started = true;
  }

  /**
   * Read the just-drawn frame out of the GL back buffer.
   *
   * `flip: false` is the fast path and the default for the video backend: the
   * pixels go into the canvas exactly as GL handed them over (bottom-up) and
   * ffmpeg rights them with `-vf vflip`, for free, on its own thread. Flipping
   * here instead costs a JS pass over two million pixels every frame.
   *
   * The 2D context is created with `alpha: false`, which also removes the
   * second pass that used to force every alpha byte to 255 — an alpha-less
   * bitmap treats the source as opaque.
   */
  _readPixels(flip = true) {
    const gl = renderer.getContext();
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;

    if (!this._buf || this._buf.length !== w * h * 4) this._buf = new Uint8Array(w * h * 4);
    const buf = this._buf;
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);

    if (!this._canvas || this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas = document.createElement('canvas');
      this._canvas.width = w; this._canvas.height = h;
      this._ctx = this._canvas.getContext('2d', { alpha: false });
      this._img = null;
    }

    if (!flip) {
      /* Wrap the read buffer directly — no copy, no per-row work. */
      const view = new Uint8ClampedArray(buf.buffer, buf.byteOffset, w * h * 4);
      this._ctx.putImageData(new ImageData(view, w, h), 0, 0);
      return this._canvas;
    }

    if (!this._img) this._img = this._ctx.createImageData(w, h);
    const img = this._img;
    const row = w * 4;
    /* GL origin is bottom-left, ImageData is top-left. */
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * row;
      img.data.set(buf.subarray(src, src + row), y * row);
    }
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    this._ctx.putImageData(img, 0, 0);
    return this._canvas;
  }

  /**
   * Capture the current frame. MUST be called in the same task as render(),
   * before any await — that is what keeps readPixels valid.
   *
   * ORDER IS LOAD-BEARING. An earlier version let up to eight frames be in
   * flight at once: each did an async toBlob and then its own fetch, and
   * concurrent POSTs arrive at the server in whatever order the network feels
   * like. The server feeds ffmpeg's stdin in arrival order, so the muxed video
   * had frames out of sequence — which plays back as the picture jumping back
   * a fraction of a second at random. Numbered PNG dumps never showed it
   * because each frame carries its index in its filename.
   *
   * So: the blob is produced before this returns (which also stops the next
   * frame's readPixels from overwriting the shared canvas mid-encode), and a
   * single drain loop transmits strictly in sequence order, one request at a
   * time.
   */
  async frame() {
    if (!this.enabled) { this.index++; return; }

    /* Video: JPEG, unflipped — 4x faster to encode than PNG and ~7x smaller to
       push over the wire, and the result is re-encoded to H.264 anyway, so a
       lossless intermediate buys nothing. PNG dumps stay lossless and upright,
       because there the frames are the deliverable. */
    const video = this.backend === 'video';
    const canvas = this._readPixels(!video);
    const seq = this.index++;
    const name = `${this.shot}_${String(seq).padStart(5, '0')}.png`;

    if (this.stamp) this._stampIndex(seq);

    const blob = await new Promise(resolve => {
      if (video) canvas.toBlob(resolve, 'image/jpeg', this.quality);
      else canvas.toBlob(resolve, 'image/png');
    });

    if (blob) this._queue.set(seq, { blob, name });
    else { this._skipped.add(seq); this.errors++; }
    this._drain();                    /* not awaited: sending overlaps rendering */
  }

  /**
   * Write `seq` into the frame as 12 black/white blocks — a machine-readable
   * frame number that survives H.264. Drawn at the canvas's bottom-left, which
   * ffmpeg's vflip puts at the TOP-left of the delivered video.
   */
  _stampIndex(seq) {
    const S = 16, y = this._canvas.height - S;
    for (let b = 0; b < 12; b++) {
      this._ctx.fillStyle = ((seq >> b) & 1) ? '#ffffff' : '#000000';
      this._ctx.fillRect(b * S, y, S, S);
    }
  }

  /** Frames encoded but not yet handed to the server. */
  get pending() { return this._queue.size + (this._sending ? 1 : 0); }

  /**
   * Send queued frames in strict sequence order, one at a time. Stops as soon
   * as the next index is missing and resumes when it arrives.
   */
  async _drain() {
    if (this._sending) return;
    this._sending = true;
    try {
      for (;;) {
        if (this._skipped.has(this._next)) { this._skipped.delete(this._next); this._next++; continue; }
        const item = this._queue.get(this._next);
        if (!item) break;
        this._queue.delete(this._next);
        try {
          await this._write(item.name, item.blob);
        } catch (e) {
          this.errors++;
          if (this.errors < 4) console.warn('[trailer] frame write failed', item.name, e);
        }
        this._next++;
      }
    } finally {
      this._sending = false;
    }
  }

  /** Resolve once everything captured so far has been sent, in order. */
  async drained() {
    while (this._next < this.index) {
      await this._drain();
      if (this._next < this.index) await new Promise(r => setTimeout(r, 5));
    }
  }

  async _write(name, blob) {
    if (this.backend === 'video') {
      const res = await fetch(`/api/trailer-encode/frame?shot=${encodeURIComponent(this.shot)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return;
    }
    if (this.backend === 'server') {
      const res = await fetch(`/api/trailer-frame?shot=${encodeURIComponent(this.shot)}&name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
  }

  /** Wait for every captured frame to be sent, in order, then close. */
  async flush() {
    await this.drained();
    if (this.backend === 'video' && this._started) {
      const res = await fetch(`/api/trailer-encode/finish?shot=${encodeURIComponent(this.shot)}`,
                              { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      this._started = false;
      if (!res.ok || !body.success) {
        throw new Error(`${body.error || 'encode failed'}${body.detail ? ` — ${body.detail}` : ''}`);
      }
      this.result = body;
    }
    return this.result;
  }

  /** The ffmpeg line that turns the dump into a video. */
  ffmpegHint(outDir = `trailer_out/${this.shot}`) {
    return `ffmpeg -framerate ${this.fps} -i ${outDir}/${this.shot}_%05d.png ` +
           `-c:v libx264 -pix_fmt yuv420p -crf 16 ${this.shot}.mp4`;
  }
}
