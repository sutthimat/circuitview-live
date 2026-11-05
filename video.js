// CircuitView video: the current view as an MP4 film (H.264, 1600 x 900) for slides that must move without any
// add-in. The cursor sweeps the view from left to right; the circuit shows the state at the cursor with its flowing
// arrowheads (the same placement as the app, advanced at the app's speed). Loaded after snapshot.js.
//   renderVideo({format, seconds, speed, fps, onProgress, stop})  -> {mp4 | gif: Uint8Array, seconds, frames}
//   format 'mp4' (default) or 'gif' (1600 x 900, ~14 frames/s, a 255-colour palette per frame, only the changed pixels);
//   speed scales the default length (2 = twice as fast); stop() true ends the film early and keeps what is filmed.
// recordDialog(kind) asks for format and speed, then shows the progress with a Stop button (Export menu).
// Frames: the 'base' snapshot layer (title, waveforms) rasterised once, the 'top' layer (drawing, legend, cursor,
// values) per frame; WebCodecs encodes, mp4Mux() below writes the file (one track, no B-frames, faststart).
'use strict';
const VID = { W: 1600, H: 900, FPS: 30, RATE: 6e6, KEY_S: 2, PER_STATE: 1.5, MIN_S: 6, MAX_S: 30,
  GW: 1600, GH: 900, GIF_CS: 7, LONGEST: 120 };   // GIF size (full, as the MP4), GIF frame delay in 1/100 s, longest film in s

// default length: about PER_STATE seconds per switching state of the view
function videoSeconds() {
  const [a, b] = S.view, n = 1 + (S.edges || []).filter(e => e > a && e < b).length;
  return Math.min(VID.MAX_S, Math.max(VID.MIN_S, Math.round(n * VID.PER_STATE)));
}

async function svgImage(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try { const im = new Image(); im.src = url; await im.decode(); return im; } finally { URL.revokeObjectURL(url); }
}

async function videoEncoder(onChunk) {
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.420028']) {   // High / Main / Baseline, level 4.0 (1600 x 900)
    const cfg = { codec, width: VID.W, height: VID.H, bitrate: VID.RATE, framerate: VID.FPS, latencyMode: 'quality', avc: { format: 'avc' } };
    const ok = await VideoEncoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
    if (!ok.supported) continue;
    let err = null;
    const enc = new VideoEncoder({ output: onChunk, error: e => { err = e; } });
    enc.configure(cfg);
    return { enc, error: () => err };
  }
  throw new Error('this browser cannot encode H.264 video (use Edge or Chrome)');
}

async function renderVideo(opts = {}) {
  const gif = opts.format === 'gif';
  if (!gif && typeof VideoEncoder === 'undefined') throw new Error('this browser cannot encode video (use Edge or Chrome, or choose GIF)');
  if (!S.circ || !S.meta) throw new Error('nothing to film yet');
  const fps = gif ? 100 / VID.GIF_CS : (opts.fps || VID.FPS);
  const secs = Math.min(VID.LONGEST, Math.max(1, opts.seconds || videoSeconds() / (opts.speed || 1)));
  const N = Math.max(1, Math.round(secs * fps));
  const [a, b] = S.view, t0 = S.cur, flow0 = FLOW.on;
  const cv = new OffscreenCanvas(VID.W, VID.H), g = cv.getContext('2d', { alpha: false });
  const chunks = []; let desc = null, enc = null, error = () => null, gw = null, n = 0;
  if (gif) gw = gifWriter(VID.GW, VID.GH, VID.GIF_CS);
  else ({ enc, error } = await videoEncoder((ch, meta) => {
    if (meta && meta.decoderConfig && meta.decoderConfig.description) desc = new Uint8Array(meta.decoderConfig.description);
    const d = new Uint8Array(ch.byteLength); ch.copyTo(d); chunks.push({ d, key: ch.type === 'key' });
  }));
  try {
    const base = await svgImage(snapshotSVG({ layer: 'base' }));
    FLOW.on = true; FLOW.phase = {};
    for (let k = 0; k < N; k++) {
      if (k && opts.stop && opts.stop()) break;                   // Stop: keep the frames filmed so far
      S.cur = a + (b - a) * (N > 1 ? k / (N - 1) : 0);
      drawCursor();                                               // also redraws the circuit for the state at the cursor
      if (FLOW.raf) { cancelAnimationFrame(FLOW.raf); FLOW.raf = 0; }   // the film owns the arrowheads
      for (const it of FLOW.items) FLOW.phase[it.id] = ((FLOW.phase[it.id] || 0) + it.v / fps) % FLOW_GAP;
      flowPlace();
      g.drawImage(base, 0, 0);
      g.drawImage(await svgImage(snapshotSVG({ layer: 'top', flow: true })), 0, 0);
      if (gif) { gw.frame(cv); await new Promise(r => setTimeout(r, 0)); }   // let the page breathe (Stop, progress)
      else {
        const fr = new VideoFrame(cv, { timestamp: Math.round(k * 1e6 / fps), duration: Math.round(1e6 / fps) });
        enc.encode(fr, { keyFrame: k % (VID.KEY_S * fps) === 0 }); fr.close();
        if (error()) throw error();
        while (enc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 5));
      }
      n = k + 1;
      if (opts.onProgress && k % 3 === 0) opts.onProgress(k / N);
    }
    if (enc) { await enc.flush(); if (error()) throw error(); }
  } finally {
    if (enc && enc.state !== 'closed') enc.close();
    FLOW.on = flow0; FLOW.phase = {}; S.cur = t0; drawCursor();
  }
  const filmed = +(n / fps).toFixed(1);
  if (gif) return { gif: gw.end(), seconds: filmed, frames: n };
  if (!desc) throw new Error('the encoder gave no H.264 configuration');
  return { mp4: mp4Mux(chunks, desc, fps), seconds: filmed, frames: n };
}

// ------------------------------------------------------------------ Play: the cursor sweeps the view, loops
// 1x = the video's length for this view (videoSeconds); #playspeed scales it. The arrowheads keep flowing. A click
// or drag elsewhere, Space or another run stops it. At most 50 frames/s (as the arrowheads).
const PLAY = { raf: 0, last: 0, speed: 1 };
function playStop() {
  if (!PLAY.raf) return;
  cancelAnimationFrame(PLAY.raf); PLAY.raf = 0;
  const p = $('#play'); if (p) { p.setAttribute('aria-pressed', 'false'); p.querySelector('.lbl').textContent = 'Play'; }
  FLOW.last = 0; flowStart();
}
function playTick(ts) {
  if (PLAY.last && ts - PLAY.last < 18) { PLAY.raf = requestAnimationFrame(playTick); return; }
  const dt = PLAY.last ? Math.min(0.1, (ts - PLAY.last) / 1000) : 0; PLAY.last = ts;
  const [a, b] = S.view, secs = videoSeconds() / PLAY.speed;
  S.cur += (b - a) * dt / secs; if (S.cur > b) S.cur = a;
  drawCursor();
  if (FLOW.raf) { cancelAnimationFrame(FLOW.raf); FLOW.raf = 0; }   // Play owns the arrowheads while it runs
  for (const it of FLOW.items) FLOW.phase[it.id] = ((FLOW.phase[it.id] || 0) + it.v * dt) % FLOW_GAP;
  flowPlace();
  PLAY.raf = requestAnimationFrame(playTick);
}
function playStart() {
  if (PLAY.raf || !S.meta) return;
  if (!FLOW.on) setFlow(true);
  if (S.cur < S.view[0] || S.cur >= S.view[1]) S.cur = S.view[0];
  const p = $('#play'); p.setAttribute('aria-pressed', 'true'); p.querySelector('.lbl').textContent = 'Pause';
  PLAY.last = 0; PLAY.raf = requestAnimationFrame(playTick);
}
(function wirePlay() {
  const p = $('#play'), sel = $('#playspeed'); if (!p) return;
  try { const v = +localStorage.getItem('circuitview.playspeed'); if ([0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 4].includes(v)) sel.value = String(v); } catch (e) { /* no storage */ }
  PLAY.speed = +sel.value || 1;
  p.onclick = () => PLAY.raf ? playStop() : playStart();
  sel.onchange = () => { PLAY.speed = +sel.value || 1; sel.blur(); if (!EMB) try { localStorage.setItem('circuitview.playspeed', sel.value); } catch (e) { /* no storage */ } };
  addEventListener('pointerdown', e => { if (PLAY.raf && !p.contains(e.target) && !sel.contains(e.target)) playStop(); }, true);
  addEventListener('keydown', e => {
    if (e.key !== ' ' || e.ctrlKey || e.altKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) return;
    e.preventDefault(); PLAY.raf ? playStop() : playStart();
  });
  $('#run').addEventListener('change', playStop);
})();

// ------------------------------------------------------------------ record dialog: format, speed, progress + Stop
// kind 'file' (MP4 or GIF) | 'ppt' (MP4 only, sent to PowerPoint). Resolves to the renderVideo result
// ({..., stopped}) or null when cancelled or failed (the error goes to the toast).
const SPEEDS = [0.25, 0.5, 1, 2, 4];
function recordDialog(kind) {
  return new Promise(resolve => {
    const d = document.createElement('div'), base = videoSeconds();
    d.id = 'recdlg'; d.className = 'card'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'record the view');
    const len = sp => Math.min(VID.LONGEST, Math.max(1, Math.round(base / sp)));
    d.innerHTML =
      `<div class="rh">Record the view</div>` +
      `<div class="rr"><span class="rk">Format</span><span class="seg">` +
      `<button type="button" data-f="mp4" aria-pressed="true">MP4 video</button>` +
      (kind === 'file' ? `<button type="button" data-f="gif" aria-pressed="false">Animated GIF</button>` : '') + `</span></div>` +
      `<div class="rr"><span class="rk">Speed</span><span class="seg">` +
      SPEEDS.map(v => `<button type="button" data-s="${v}" aria-pressed="${v === 1}">${v}×</button>`).join('') + `</span></div>` +
      `<div class="rr rn"><span class="rk"></span><span id="reclen"></span></div>` +
      `<div class="ra"><button type="button" data-a="cancel">Cancel</button><button type="button" data-a="go" class="pri">Record</button></div>`;
    document.body.appendChild(d);
    let fmt = 'mp4', sp = 1, stopped = false;
    const info = () => { d.querySelector('#reclen').textContent = `Length ${len(sp)} s · ` + (fmt === 'gif' ? `${VID.GW} × ${VID.GH} px` : `${VID.W} × ${VID.H} px`); };
    const pick = (attr, v) => d.querySelectorAll(`[data-${attr}]`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(v))));
    const close = r => { removeEventListener('keydown', key, true); d.remove(); resolve(r); };
    const key = e => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); e.preventDefault();
      if (d.classList.contains('busy')) stopped = true; else close(null);
    };
    addEventListener('keydown', key, true);
    d.onclick = async e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.f) { fmt = t.dataset.f; pick('f', fmt); info(); }
      if (t.dataset.s) { sp = +t.dataset.s; pick('s', sp); info(); }
      if (t.dataset.a === 'cancel') close(null);
      if (t.dataset.a === 'stop') { stopped = true; t.disabled = true; t.textContent = 'Stopping…'; }
      if (t.dataset.a !== 'go') return;
      d.classList.add('busy');
      d.innerHTML = `<div class="rh">Recording ${fmt === 'gif' ? 'GIF' : 'MP4'} · ${sp}×</div>` +
        `<div class="rbar"><span></span></div><div class="rr rn"><span class="rp">0 %</span></div>` +
        `<div class="ra"><button type="button" data-a="stop" class="pri">Stop and save</button></div>`;
      d.querySelector('[data-a="stop"]').focus();
      const fill = d.querySelector('.rbar span'), pct = d.querySelector('.rp');
      try {
        const v = await renderVideo({ format: fmt, speed: sp, stop: () => stopped,
          onProgress: f => { fill.style.width = (100 * f).toFixed(1) + '%'; pct.textContent = Math.round(100 * f) + ' %'; } });
        close({ ...v, stopped });
      } catch (err) { close(null); toast(String(err.message || err), true); }
    };
    info(); d.querySelector('[data-a="go"]').focus();
  });
}

// ------------------------------------------------------------------ GIF89a writer: a local palette per frame, LZW
// Every frame carries its own 255-colour table (the most frequent colours of the pixels that changed, 6 bits per
// channel; the user saw banding and wrong colours with one table from the first frame at 960 x 540); index 255 is
// transparent and marks the pixels that did not change since the previous frame, inside the changed rectangle
// (disposal: keep). Full film size (VID.GW x VID.GH = the MP4 size), no scaling, no dithering (line art).
function gifWriter(W, H, cs) {
  const cv = new OffscreenCanvas(W, H), g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  const out = [], put = (...b) => out.push(Uint8Array.from(b)), u16 = v => [v & 255, v >> 8], asc = s => [...s].map(c => c.charCodeAt(0));
  let prev = null;
  put(...asc('GIF89a'), ...u16(W), ...u16(H), 0x70, 0, 0);      // no global colour table: every frame has its own
  put(0x21, 0xff, 11, ...asc('NETSCAPE2.0'), 3, 1, 0, 0, 0);     // loop for ever
  const key6 = (px, i) => (px[i] >> 2) << 12 | (px[i + 1] >> 2) << 6 | px[i + 2] >> 2;
  const ch = v => (v << 2) | (v >> 4);                            // 6-bit channel back to 8 bits
  function frame(src) {
    g.drawImage(src, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
    if (prev) {                                                  // only the rectangle that changed
      x0 = W; y0 = H; x1 = -1; y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0, i = y * W * 4; x < W; x++, i += 4) {
        if (px[i] !== prev[i] || px[i + 1] !== prev[i + 1] || px[i + 2] !== prev[i + 2]) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) x0 = y0 = x1 = y1 = 0;
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, sub = new Uint8Array(w * h);
    // this frame's palette: the most frequent changed colours
    const cnt = new Map();
    for (let y = 0; y < h; y++) for (let x = 0, i = ((y + y0) * W + x0) * 4; x < w; x++, i += 4) {
      if (prev && px[i] === prev[i] && px[i + 1] === prev[i + 1] && px[i + 2] === prev[i + 2]) continue;
      const k = key6(px, i); cnt.set(k, (cnt.get(k) || 0) + 1);
    }
    const keys = [...cnt.keys()].sort((p, q) => cnt.get(q) - cnt.get(p)).slice(0, 255);
    const pal = keys.map(k => [ch(k >> 12 & 63), ch(k >> 6 & 63), ch(k & 63)]);
    const idx = new Map(keys.map((k, j) => [k, j]));
    const near = k => {                                          // a colour beyond the 255: the nearest one (cached)
      let j = idx.get(k); if (j !== undefined) return j;
      const r = ch(k >> 12 & 63), gg = ch(k >> 6 & 63), b = ch(k & 63);
      let bd = Infinity; j = 0;
      for (let q = 0; q < pal.length; q++) { const p = pal[q], e = (p[0] - r) ** 2 + (p[1] - gg) ** 2 + (p[2] - b) ** 2; if (e < bd) { bd = e; j = q; } }
      idx.set(k, j); return j;
    };
    for (let y = 0; y < h; y++) for (let x = 0, i = ((y + y0) * W + x0) * 4; x < w; x++, i += 4) {
      sub[y * w + x] = prev && px[i] === prev[i] && px[i + 1] === prev[i + 1] && px[i + 2] === prev[i + 2] ? 255 : (pal.length ? near(key6(px, i)) : 255);
    }
    while (pal.length < 256) pal.push([255, 255, 255]);
    prev = px;
    put(0x21, 0xf9, 4, 0x05, ...u16(cs), 255, 0);                // disposal 1 (keep), transparent index 255, delay cs/100 s
    put(0x2c, ...u16(x0), ...u16(y0), ...u16(w), ...u16(h), 0x87); // local colour table of 256 entries follows
    out.push(Uint8Array.from(pal.flat()));
    out.push(lzw(sub, 8));
  }
  function end() {
    put(0x3b);
    const n = out.reduce((s, p) => s + p.length, 0), o = new Uint8Array(n); let i = 0;
    for (const p of out) { o.set(p, i); i += p.length; }
    return o;
  }
  return { frame, end };
}
function lzw(ix, min) {                                          // GIF LZW: codes packed LSB first, 255-byte sub-blocks
  const clear = 1 << min, eoi = clear + 1, bytes = [min];
  let size = min + 1, next = eoi + 1, acc = 0, nb = 0, blk = [];
  const flushBlk = () => { bytes.push(blk.length); for (const v of blk) bytes.push(v); blk = []; };
  const emit = c => {
    acc |= c << nb; nb += size;
    while (nb >= 8) { blk.push(acc & 255); acc >>>= 8; nb -= 8; if (blk.length === 255) flushBlk(); }
  };
  let dict = new Map();
  emit(clear);
  let cur = ix[0];
  for (let i = 1; i < ix.length; i++) {
    const k = ix[i], key = cur << 8 | k, hit = dict.get(key);
    if (hit !== undefined) { cur = hit; continue; }
    emit(cur);
    if (next === 4096) { emit(clear); dict = new Map(); size = min + 1; next = eoi + 1; }
    else { if (next >= (1 << size)) size++; dict.set(key, next++); }
    cur = k;
  }
  emit(cur); emit(eoi);
  if (nb > 0) { blk.push(acc & 255); if (blk.length === 255) flushBlk(); }
  if (blk.length) flushBlk();
  bytes.push(0);
  return Uint8Array.from(bytes);
}

// ------------------------------------------------------------------ MP4 (ISO BMFF) writer: ftyp, moov, mdat
function mp4Mux(samples, avcC, fps) {
  const TS = fps * 1000, N = samples.length, dur = N * 1000;      // track timescale: 1000 ticks per frame
  const enc = new TextEncoder();
  const cat = parts => { const n = parts.reduce((s, p) => s + p.length, 0), o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
  const u = (v, n) => { const o = new Uint8Array(n); for (let k = n - 1; k >= 0; k--) { o[k] = v & 255; v = Math.floor(v / 256); } return o; };
  const u32 = v => u(v, 4), u16 = v => u(v, 2), u8 = v => u(v, 1), z = n => new Uint8Array(n);
  const box = (type, ...p) => { const body = cat(p); return cat([u32(body.length + 8), enc.encode(type), body]); };
  const full = (type, ver, flags, ...p) => box(type, u8(ver), u(flags, 3), ...p);
  const matrix = cat([0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map(u32));
  const movieDur = Math.round(N * 1000 / fps);                   // movie timescale 1000 (ms)
  const stbl = sizes => box('stbl',
    full('stsd', 0, 0, u32(1), box('avc1', z(6), u16(1), z(16), u16(VID.W), u16(VID.H), u32(0x480000), u32(0x480000), z(4), u16(1), z(32),
      u16(0x18), u16(0xffff), box('avcC', avcC))),
    full('stts', 0, 0, u32(1), u32(N), u32(1000)),
    full('stss', 0, 0, u32(samples.filter(s => s.key).length), ...samples.map((s, k) => s.key ? u32(k + 1) : z(0))),
    full('stsc', 0, 0, u32(1), u32(1), u32(N), u32(1)),
    full('stsz', 0, 0, u32(0), u32(N), ...sizes.map(u32)),
    full('stco', 0, 0, u32(1), u32(0)));                          // patched below: offset of the one chunk
  const moov = box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieDur), u32(0x10000), u16(0x100), z(10), matrix, z(24), u32(2)),
    box('trak',
      full('tkhd', 0, 3, u32(0), u32(0), u32(1), z(4), u32(movieDur), z(8), u16(0), u16(0), u16(0), z(2), matrix, u32(VID.W * 65536), u32(VID.H * 65536)),
      box('mdia',
        full('mdhd', 0, 0, u32(0), u32(0), u32(TS), u32(dur), u16(0x55c4), u16(0)),
        full('hdlr', 0, 0, u32(0), enc.encode('vide'), z(12), enc.encode('CircuitView\0')),
        box('minf', full('vmhd', 0, 1, z(8)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl(samples.map(s => s.d.length))))));
  const ftyp = box('ftyp', enc.encode('isom'), u32(0x200), enc.encode('isomiso2avc1mp41'));
  const off = ftyp.length + moov.length + 8;
  const at = moov.length - 4; moov.set(u32(off), at);              // stco is the last box of moov: its one entry
  const data = cat(samples.map(s => s.d));
  return cat([ftyp, moov, u32(data.length + 8), enc.encode('mdat'), data]);
}
