// CircuitView video: the current view as an MP4 film (H.264, 1600 x 900) for slides that must move without any
// add-in. The cursor sweeps the view from left to right; the circuit shows the state at the cursor with its flowing
// arrowheads (the same placement as the app, advanced at the app's speed). Loaded after snapshot.js.
//   renderVideo({seconds, fps, onProgress})  -> {mp4: Uint8Array, seconds, frames}
// Frames: the 'base' snapshot layer (title, waveforms) rasterised once, the 'top' layer (drawing, legend, cursor,
// values) per frame; WebCodecs encodes, mp4Mux() below writes the file (one track, no B-frames, faststart).
'use strict';
const VID = { W: 1600, H: 900, FPS: 30, RATE: 6e6, KEY_S: 2, PER_STATE: 1.5, MIN_S: 6, MAX_S: 30 };

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
  if (typeof VideoEncoder === 'undefined') throw new Error('this browser cannot encode video (use Edge or Chrome)');
  if (!S.circ || !S.meta) throw new Error('nothing to film yet');
  const fps = opts.fps || VID.FPS, secs = opts.seconds || videoSeconds(), N = Math.round(secs * fps);
  const [a, b] = S.view, t0 = S.cur, flow0 = FLOW.on;
  const cv = new OffscreenCanvas(VID.W, VID.H), g = cv.getContext('2d', { alpha: false });
  const chunks = []; let desc = null;
  const { enc, error } = await videoEncoder((ch, meta) => {
    if (meta && meta.decoderConfig && meta.decoderConfig.description) desc = new Uint8Array(meta.decoderConfig.description);
    const d = new Uint8Array(ch.byteLength); ch.copyTo(d); chunks.push({ d, key: ch.type === 'key' });
  });
  try {
    const base = await svgImage(snapshotSVG({ layer: 'base' }));
    FLOW.on = true; FLOW.phase = {};
    for (let k = 0; k < N; k++) {
      S.cur = a + (b - a) * (N > 1 ? k / (N - 1) : 0);
      drawCursor();                                               // also redraws the circuit for the state at the cursor
      if (FLOW.raf) { cancelAnimationFrame(FLOW.raf); FLOW.raf = 0; }   // the film owns the arrowheads
      for (const it of FLOW.items) FLOW.phase[it.id] = ((FLOW.phase[it.id] || 0) + it.v / fps) % FLOW_GAP;
      flowPlace();
      g.drawImage(base, 0, 0);
      g.drawImage(await svgImage(snapshotSVG({ layer: 'top', flow: true })), 0, 0);
      const fr = new VideoFrame(cv, { timestamp: Math.round(k * 1e6 / fps), duration: Math.round(1e6 / fps) });
      enc.encode(fr, { keyFrame: k % (VID.KEY_S * fps) === 0 }); fr.close();
      if (error()) throw error();
      while (enc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 5));
      if (opts.onProgress && k % 15 === 0) opts.onProgress(k / N);
    }
    await enc.flush();
    if (error()) throw error();
  } finally {
    if (enc.state !== 'closed') enc.close();
    FLOW.on = flow0; FLOW.phase = {}; S.cur = t0; drawCursor();
  }
  if (!desc) throw new Error('the encoder gave no H.264 configuration');
  return { mp4: mp4Mux(chunks, desc, fps), seconds: secs, frames: N };
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
