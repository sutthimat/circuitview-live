// CircuitView snapshot: the current view as ONE standalone vector SVG (PowerPoint, figures) and the state it shows.
// Loaded after app.js and uses its globals (S, FLOW, css, drawCircuit, ...).
//   cvState()            {run, t, view, rows, style}: what a slide needs to reopen the view (stored in the shape's tags)
//   applyState(st)       reopen such a state
//   snapshotSVG()        the drawing with its conduction overlay (static arrowheads), the legend, the waveform rows of
//                        the app (same channels, ranges and colours) with the cursor and its time flag, and a header
// Every element carries explicit presentation attributes (no CSS, no classes, colours as #rrggbb), because PowerPoint's
// SVG reader ignores stylesheets. Text stays text: Times New Roman italic for math, Segoe UI for numbers and words.
'use strict';
const SNAP = { W: 1600, H: 900, PAD: 24, HEAD: 40, LEG: 30, AXIS: 30, LAB: 170, YAX: 48,
  UI: "'Segoe UI', Arial, sans-serif", MATH: "'Times New Roman', Times, serif" };

function cvState() {
  return { v: 1, run: S.run, t: S.cur, view: S.view.slice(), style: CV_STYLE,
    load: S.circ && S.circ.J.load ? S.circ.J.load.style : null,
    place: S.circ && S.circ.J.load ? (S.circ.J.load.place || 'below') : null,
    rows: S.rows.map(r => ({ sigs: r.sigs.slice(), h: r.h || null, y: r.y || null, y2: r.y2 || null, gain: r.gain && Object.keys(r.gain).length ? { ...r.gain } : null })),
    colors: Object.keys(userColors()).length ? { ...userColors() } : null };
}
async function applyState(st) {
  if (!st || !st.run) throw new Error('no CircuitView state');
  S.rows = (st.rows || []).map(r => ({ sigs: r.sigs.slice(), h: r.h || undefined, y: r.y || undefined, y2: r.y2 || undefined, gain: r.gain || undefined }));
  if (st.colors) S.colors = { ...st.colors };                     // the view's trace colours (not stored)
  const cur = S.circ && S.circ.J.load ? S.circ.J.load.style : null, pcur = S.circ && S.circ.J.load ? (S.circ.J.load.place || 'below') : null;
  const load = st.load || (S.circ && S.circ.J.load ? S.circ.J.load.default : null);   // an older state: the default drawing
  const place = st.place || 'below';
  S.loadStyle = load; S.loadPlace = place;                        // the state's drawing (not stored; the next choice clears it)
  const other = (load && load !== cur) || (pcur && place !== pcur);
  if (st.run !== S.run) { $('#run').value = st.run; if (other) S.circName = null; await openRun(st.run); }
  else { if (cur && other) { await openCircuit(S.circName); setLayout(); } buildRows(); }
  S.view = st.view.slice(); S.cur = st.t; redraw();
}

// ------------------------------------------------------------------ helpers
const sx = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r2 = v => +(+v).toFixed(2);
function rgb(c) {                                         // computed colour -> ['#rrggbb' | 'none', alpha]
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(c || '');
  if (!m) return [c && c !== 'rgba(0, 0, 0, 0)' ? c : 'none', 1];
  const a = m[4] === undefined ? 1 : +m[4];
  return [a === 0 ? 'none' : '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join(''), a];
}
const tok = v => rgb(css(v))[0] === 'none' ? css(v) : rgb(css(v))[0];   // CSS token -> #rrggbb
// math label 'v_{aO}', 'i_\alpha', 'S_{a1}' -> tspans: letters italic, figures upright, subscript 70 % lowered
function texSVG(tex, size) {
  const s = String(tex).replace(/\\([A-Za-z]+)/g, (m, g) => GREEK[g] || g);
  const m = /^([^_]*)(?:_\{([^}]*)\}|_(.))?(.*)$/.exec(s) || [s, s, '', '', ''];
  const run = (txt, fs, dy) => [...txt].map((ch, k) => `<tspan font-size="${r2(fs)}"${k === 0 && dy ? ` dy="${r2(dy)}"` : ''} font-style="${/[0-9()+\-=,.|]/.test(ch) ? 'normal' : 'italic'}">${sx(ch)}</tspan>`).join('');
  const sub = m[2] !== undefined ? m[2] : m[3];
  let out = run(m[1], size, 0);
  if (sub) out += run(sub, size * 0.7, size * 0.28) + (m[4] ? `<tspan dy="${r2(-size * 0.28)}"></tspan>` : '');
  if (m[4]) out += run(m[4], size, 0);
  return out;
}
// run title with its math: m_a -> italic m, subscript a (Times); Greek names -> letters
function titleSVG(s, size) {
  const t = prettyText(s).replace(/\\_/g, '_').replace(/\b(alpha|beta|gamma|delta|Delta|theta|phi|omega|tau)\b/g, w => GREEK[w]);
  const parts = t.split(/\b([A-Za-z])_([A-Za-z0-9]{1,3})\b/), dy = r2(size * 0.28);
  let out = '', down = false;
  parts.forEach((p, k) => {
    if (k % 3 === 0) { if (p) out += down ? `<tspan dy="${-dy}">${sx(p)}</tspan>` : sx(p); down = down && !p; }
    else if (k % 3 === 1) out += `<tspan${down ? ` dy="${-dy}"` : ''} font-family="${SNAP.MATH}" font-style="italic" font-size="${r2(size * 1.12)}">${sx(p)}</tspan>`;
    else { out += `<tspan font-size="${r2(size * 0.78)}" dy="${dy}">${sx(p)}</tspan>`; down = true; }
  });
  return out;
}
// {x} inside a text = math italic (legend items)
const mixSVG = (t, size) => sx(t).replace(/\{([^}_]*)(?:_([^}]*))?\}/g, (m, x, s) => `<tspan font-family="${SNAP.MATH}" font-style="italic" font-size="${r2(size * 1.12)}">${x}</tspan>` +
  (s ? `<tspan font-family="${SNAP.MATH}" font-style="italic" font-size="${r2(size * 0.8)}" dy="${r2(size * 0.25)}">${s}</tspan><tspan dy="${r2(-size * 0.25)}"> </tspan>` : ''));

// ------------------------------------------------------------------ circuit (clone of the live drawing, styles inlined)
function inlineStyles(src, dst) {
  const cs = getComputedStyle(src), tag = src.tagName.toLowerCase();
  if (tag === 'title' || cs.display === 'none' || cs.visibility === 'hidden') { dst.remove(); return; }
  if (['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan'].includes(tag)) {
    const [f, fa] = rgb(cs.fill), [st, sa] = rgb(cs.stroke);
    dst.setAttribute('fill', f); dst.setAttribute('stroke', st);
    const fo = fa * +cs.fillOpacity, so = sa * +cs.strokeOpacity;
    if (fo < 1) dst.setAttribute('fill-opacity', r2(fo)); if (so < 1) dst.setAttribute('stroke-opacity', r2(so));
    if (st !== 'none') {
      dst.setAttribute('stroke-width', parseFloat(cs.strokeWidth));
      dst.setAttribute('stroke-linecap', cs.strokeLinecap); dst.setAttribute('stroke-linejoin', cs.strokeLinejoin);
      if (cs.strokeDasharray && cs.strokeDasharray !== 'none') dst.setAttribute('stroke-dasharray', cs.strokeDasharray.replace(/px/g, ''));
    }
    if (tag === 'text' || tag === 'tspan') {
      dst.setAttribute('font-family', cs.fontFamily); dst.setAttribute('font-size', parseFloat(cs.fontSize));
      dst.setAttribute('font-style', cs.fontStyle); if (cs.fontWeight !== '400') dst.setAttribute('font-weight', cs.fontWeight);
    }
  }
  if (cs.paintOrder && cs.paintOrder !== 'normal') dst.setAttribute('paint-order', cs.paintOrder);   // halo under the glyphs
  if (+cs.opacity < 1) dst.setAttribute('opacity', r2(cs.opacity));
  dst.removeAttribute('class'); dst.removeAttribute('style');
  for (const a of [...dst.attributes]) if (a.name.startsWith('data-')) dst.removeAttribute(a.name);
  const sc = [...src.children], dc = [...dst.children];
  sc.forEach((c, k) => inlineStyles(c, dc[k]));
}
function circuitGroup(x, y, w, h, moving) {             // moving: keep the flowing arrowheads as placed (video frames)
  const C = S.circ, flow = FLOW.on && !moving;
  if (flow) { FLOW.on = false; drawCircuit(); }             // still figure: one static arrowhead per straight run
  C.svg.classList.add('cv-snap'); void C.svg.getBoundingClientRect();   // no transitions: computed = final colours
  const clone = C.svg.cloneNode(true);
  inlineStyles(C.svg, clone);
  C.svg.classList.remove('cv-snap'); clone.removeAttribute('class');
  if (flow) { FLOW.on = true; drawCircuit(); }
  const vb = C.svg.viewBox.baseVal, k = Math.min(w / vb.width, h / vb.height);
  const ox = x + (w - vb.width * k) / 2 - vb.x * k, oy = y + (h - vb.height * k) / 2 - vb.y * k;
  return { svg: `<g transform="translate(${r2(ox)},${r2(oy)}) scale(${+k.toFixed(5)})">${clone.innerHTML}</g>`, k,
    box: [ox + vb.x * k, oy + vb.y * k, vb.width * k, vb.height * k] };
}
function legendSVG(x, y, w) {
  const items = legendItems(S.circ.J), fs = 13, gap = 22, sw = 18;
  const meas = document.createElement('canvas').getContext('2d'); meas.font = `${fs}px Segoe UI`;
  const wid = items.map(([k, , t]) => (k === 'note' ? 0 : sw + 7) + meas.measureText(t.replace(/[{}]/g, '')).width);
  let lines = [[]], lw = 0;
  items.forEach((it, j) => { if (lw && lw + wid[j] > w) { lines.push([]); lw = 0; } lines[lines.length - 1].push(j); lw += wid[j] + gap; });
  let out = '';
  lines.forEach((ln, li) => {
    const tot = ln.reduce((a, j) => a + wid[j], 0) + gap * (ln.length - 1);
    let cx = x + (w - tot) / 2; const cy = y + li * 22;
    for (const j of ln) {
      const [k, c, t] = items[j], col = c ? tok(c) : '';
      if (k === 'line') out += `<line x1="${r2(cx)}" y1="${cy}" x2="${r2(cx + sw)}" y2="${cy}" stroke="${col}" stroke-width="3" stroke-linecap="round"/>`;
      if (k === 'phases') ['--pa', '--pb', '--pc'].forEach((p, q) => { out += `<line x1="${r2(cx + q * 6)}" y1="${cy}" x2="${r2(cx + q * 6 + 6)}" y2="${cy}" stroke="${tok(p)}" stroke-width="3"/>`; });
      if (k === 'ring') out += `<circle cx="${r2(cx + 9)}" cy="${cy}" r="5" fill="none" stroke="${col}" stroke-width="1.5"/>`;
      if (k === 'arrow') out += `<line x1="${r2(cx)}" y1="${cy}" x2="${r2(cx + 13)}" y2="${cy}" stroke="${col}" stroke-width="3"/><path d="M${r2(cx + 18)},${cy}L${r2(cx + 12)},${cy - 3.5}L${r2(cx + 13.4)},${cy}L${r2(cx + 12)},${cy + 3.5}Z" fill="${col}"/>`;
      if (k === 'iref') out += `<line x1="${r2(cx + 1)}" y1="${cy}" x2="${r2(cx + 11.5)}" y2="${cy}" stroke="${col}" stroke-width="1.4"/><path d="M${r2(cx + 17.5)},${cy}L${r2(cx + 10.6)},${r2(cy - 3.3)}C${r2(cx + 11.5)},${r2(cy - 1.2)} ${r2(cx + 11.5)},${r2(cy + 1.2)} ${r2(cx + 10.6)},${r2(cy + 3.3)}Z" fill="${col}"/>`;
      if (k === 'chg') out += `<path d="M${r2(cx + 4)},${cy + 5}V${cy - 4}M${r2(cx + 1.4)},${cy - 1.4}L${r2(cx + 4)},${cy - 4}L${r2(cx + 6.6)},${cy - 1.4}M${r2(cx + 13)},${cy - 5}V${cy + 4}M${r2(cx + 10.4)},${cy + 1.4}L${r2(cx + 13)},${cy + 4}L${r2(cx + 15.6)},${cy + 1.4}" fill="none" stroke="${col}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`;
      const tx = k === 'note' ? cx : cx + sw + 7;
      out += `<text x="${r2(tx)}" y="${cy + 4.5}" font-family="${SNAP.UI}" font-size="${fs}" fill="${tok(k === 'note' ? '--ink-3' : '--ink-2')}">${mixSVG(t, fs)}</text>`;
      cx += wid[j] + gap;
    }
  });
  return { svg: out, h: lines.length * 22 };
}

// ------------------------------------------------------------------ waveform rows (same channels, ranges, colours)
function traceD(n, w, X0, y) {
  const { t, v } = S.sig[n].data, step = S.sig[n].kind === 'step', Xs = tt => X0 + X(tt, w);
  let i0 = Math.max(lastLE(t, S.view[0]), 0), i1 = Math.min(lastLE(t, S.view[1]) + 1, t.length - 1);
  const P = [];
  if (step) {
    let py = y(v[i0]); P.push([Math.max(Xs(t[i0]), X0), py]);
    for (let i = i0 + 1; i <= i1 && t[i] < S.view[1]; i++) {
      if (t[i] <= S.view[0]) { py = y(v[i]); P[0][1] = py; continue; }
      const x = Xs(t[i]), yy = y(v[i]); if (yy !== py) { P.push([x, py], [x, yy]); py = yy; }
    }
    P.push([X0 + w, py]);
  } else if (i1 - i0 > 2 * w) {                                 // min/max per output pixel column
    let c0 = -1, mn = 0, mx = 0;
    for (let i = i0; i <= i1; i++) {
      const c = Math.floor(X(t[i], w));
      if (c !== c0) { if (c0 >= 0) P.push([X0 + c0, y(mn)], [X0 + c0, y(mx)]); c0 = c; mn = mx = v[i]; }
      else { if (v[i] < mn) mn = v[i]; if (v[i] > mx) mx = v[i]; }
    }
    P.push([X0 + c0, y(mn)], [X0 + c0, y(mx)]);
  } else for (let i = i0; i <= i1; i++) P.push([Xs(t[i]), y(v[i])]);
  const Q = P.filter(([x]) => x >= X0 - 1 && x <= X0 + w + 1);
  return 'M' + Q.map(([x, yy]) => r2(x) + ',' + r2(yy)).join('L');
}
function wavesSVG(x, y, W, H, L = 'full') {          // L: full | base (no cursor) | top (cursor only)
  const B = L !== 'top', T = L !== 'base';
  const pw = W - SNAP.LAB - SNAP.YAX, X0 = x + SNAP.LAB + SNAP.YAX, rows = S.rows.filter(r => r.sigs.length && r.sigs.every(n => S.sig[n] && S.sig[n].data));
  const hs = rows.map(rowH), tot = hs.reduce((a, b) => a + b, 0) || 1, k = (H - SNAP.AXIS) / tot;
  const grid = tok('--grid'), rule = tok('--rule'), hair = tok('--hair'), slate = tok('--ink-3'), ink = tok('--ink'), cur = tok('--cursor');
  const ticks = niceTicks(S.view[0], S.view[1], Math.max(2, pw / 110));
  let out = B ? `<rect x="${x}" y="${y}" width="${SNAP.LAB + SNAP.YAX}" height="${r2(H)}" fill="${tok('--lab-bg')}"/>` : '', yy = y;
  const o = (b, svg) => { if (b) out += svg; };                 // emit only for the selected layer
  rows.forEach((r, j) => {
    const h = hs[j] * k, y0 = yy; yy += h;
    if (B) for (const tt of ticks) out += `<line x1="${r2(X0 + X(tt, pw))}" y1="${r2(y0)}" x2="${r2(X0 + X(tt, pw))}" y2="${r2(y0 + h)}" stroke="${grid}" stroke-width="1"/>`;
    if (isLanes(r)) {
      const lh = h / r.sigs.length;
      r.sigs.forEach((n, q) => {
        const ly = y0 + q * lh, yv = v => ly + lh * (0.78 - 0.56 * v), col = sigColor(n, q);
        o(B && q, `<line x1="${x}" y1="${r2(ly)}" x2="${r2(x + W)}" y2="${r2(ly)}" stroke="${rule}" stroke-width="1"/>`);
        if (!B) { o(T, `<text x="${x + SNAP.LAB - 8}" y="${r2(ly + lh / 2 + 4.5)}" text-anchor="end" font-family="${SNAP.UI}" font-size="13" fill="${ink}">${Math.round(curVal(n))}</text>`); return; }
        const { t, v } = S.sig[n].data; let i0 = Math.max(lastLE(t, S.view[0]), 0), i1 = Math.min(lastLE(t, S.view[1]) + 1, t.length - 1), on = null;
        for (let i = i0; i <= i1 + 1; i++) {                    // 'on' intervals, merged below half a pixel
          const hi = i <= i1 && v[i] > 0.5, xa = Math.max(X(t[Math.min(i, t.length - 1)], pw), 0);
          if (hi && !on) on = [xa, 0];
          if (on && (!hi || i === i1 + 1)) { const xb = Math.min(i <= i1 ? X(t[i], pw) : pw, pw); if (xb - on[0] > 0.2) out += `<rect x="${r2(X0 + on[0])}" y="${r2(yv(1))}" width="${r2(xb - on[0])}" height="${r2(yv(0) - yv(1))}" fill="${col}" fill-opacity="0.09"/>`; on = null; if (hi) on = [xa, 0]; }
        }
        out += `<path d="${traceD(n, pw, X0, yv)}" fill="none" stroke="${col}" stroke-width="1.4" stroke-linejoin="round"/>`;
        out += `<line x1="${x + 10}" y1="${r2(ly + lh / 2)}" x2="${x + 22}" y2="${r2(ly + lh / 2)}" stroke="${col}" stroke-width="2"/>` +
          `<text x="${x + 30}" y="${r2(ly + lh / 2 + 5)}" font-family="${SNAP.MATH}" fill="${col}">${texSVG(shortLab(n), 16)}</text>`;
        o(T, `<text x="${x + SNAP.LAB - 8}" y="${r2(ly + lh / 2 + 4.5)}" text-anchor="end" font-family="${SNAP.UI}" font-size="13" fill="${ink}">${Math.round(curVal(n))}</text>`);
      });
    } else {
      const AX = rowAxes(r), { lo, hi } = AX.L;
      const yv = v => y0 + h - (v - lo) / (hi - lo) * h, nt = Math.max(2, h / 40), d = decFor(niceStep(lo, hi, nt));
      const yOf = n => { const A = AX.of(n), g = gainOf(r, n); return v => y0 + h - (v * g - A.lo) / (A.hi - A.lo) * h; };
      if (B && AX.R) {                                           // second unit: its axis inside the plot's right edge
        const R = AX.R, yr = v => y0 + h - (v - R.lo) / (R.hi - R.lo) * h, d2 = decFor(niceStep(R.lo, R.hi, nt));
        for (const v of niceTicks(R.lo, R.hi, nt)) {
          const ty = yr(v); if (ty < y0 + 22 || ty > y0 + h - 8) continue;
          out += `<line x1="${r2(X0 + pw - 5)}" y1="${r2(ty)}" x2="${r2(X0 + pw)}" y2="${r2(ty)}" stroke="${tok('--tick')}" stroke-width="1"/>` +
            `<text x="${r2(X0 + pw - 8)}" y="${r2(ty + 4)}" text-anchor="end" font-family="${SNAP.UI}" font-size="12" fill="${slate}" stroke="${tok('--surface')}" stroke-width="3" paint-order="stroke">${fmtTick(v, d2)}</text>`;
        }
        out += `<text x="${r2(X0 + pw - 8)}" y="${r2(y0 + 14)}" text-anchor="end" font-family="${SNAP.UI}" font-size="12" fill="${slate}" stroke="${tok('--surface')}" stroke-width="3" paint-order="stroke">${sx(R.unit)}</text>` +
          `<text x="${X0 - 8}" y="${r2(y0 + 14)}" text-anchor="end" font-family="${SNAP.UI}" font-size="12" fill="${slate}">${sx(AX.L.unit)}</text>`;
      }
      for (const v of B ? niceTicks(lo, hi, nt) : []) {
        const ty = yv(v); if (ty < y0 + 8 || ty > y0 + h - 8) continue;
        out += `<line x1="${X0}" y1="${r2(ty)}" x2="${r2(X0 + pw)}" y2="${r2(ty)}" stroke="${grid}" stroke-width="1"/>` +
          `<text x="${X0 - 8}" y="${r2(Math.min(Math.max(ty, y0 + 8), y0 + h - 5) + 4)}" text-anchor="end" font-family="${SNAP.UI}" font-size="12" fill="${slate}">${fmtTick(v, d)}</text>`;
      }
      if (B && lo < 0 && hi > 0) out += `<line x1="${X0}" y1="${r2(yv(0))}" x2="${r2(X0 + pw)}" y2="${r2(yv(0))}" stroke="${tok('--zero')}" stroke-width="1"/>`;
      r.sigs.forEach((n, q) => {
        const col = sigColor(n, q), ly = y0 + 18 + q * 22, u = S.sig[n].unit || '', v = curVal(n);
        const gk = gainOf(r, n);
        o(B, `<path d="${traceD(n, pw, X0, yOf(n))}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round"/>` +
          `<line x1="${x + 10}" y1="${r2(ly - 4)}" x2="${x + 22}" y2="${r2(ly - 4)}" stroke="${col}" stroke-width="2"/>` +
          `<text x="${x + 30}" y="${r2(ly + 1)}" font-family="${SNAP.MATH}" fill="${col}">${texSVG(shortLab(n), 16)}${gk !== 1 ? `<tspan font-family="${SNAP.UI}" font-size="11" fill="${slate}"> ×${fmtGain(gk)}</tspan>` : ''}</text>`);
        o(T, `<text x="${x + SNAP.LAB - 8}" y="${r2(ly)}" text-anchor="end" font-family="${SNAP.UI}" font-size="13" fill="${ink}">${isFinite(v) ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(decOf(n)) : '–'}${u ? `<tspan fill="${slate}" font-size="11"> ${sx(u)}</tspan>` : ''}</text>`);
      });
    }
    o(B, `<line x1="${x}" y1="${r2(yy)}" x2="${r2(x + W)}" y2="${r2(yy)}" stroke="${rule}" stroke-width="1"/>`);
  });
  // time axis, cursor and its flag (the app's rules: µs labels from a 0.1-ms mark when the view is under 0.2 ms)
  const span = S.view[1] - S.view[0], st = niceStep(S.view[0], S.view[1], Math.max(2, pw / 110)), us = span < 2e-4;
  const ref = us ? Math.floor(S.view[0] * 1e4 + 1e-9) / 1e4 : 0, d = us ? decFor(st * 1e6) : decFor(st * 1e3), ay = yy;
  o(B, `<line x1="${x}" y1="${r2(ay)}" x2="${r2(x + W)}" y2="${r2(ay)}" stroke="${hair}" stroke-width="1"/>`);
  const xc = X0 + X(S.cur, pw), flag = us ? ((S.cur - ref) * 1e6).toFixed(Math.min(d + 2, 3)) : (S.cur * 1e3).toFixed(4), fw = 9 * flag.length + 16;
  const fx = Math.min(Math.max(xc - fw / 2, X0), X0 + pw - fw);
  for (const tt of B ? ticks : []) {                      // base layer: every label (the top layer's flag covers its own)
    const tx = X0 + X(tt, pw), lbl = us ? ((tt - ref) * 1e6).toFixed(d) : (tt * 1e3).toFixed(d), tw = 7.5 * lbl.length;
    out += `<line x1="${r2(tx)}" y1="${r2(ay)}" x2="${r2(tx)}" y2="${r2(ay + 5)}" stroke="${tok('--tick')}" stroke-width="1"/>`;
    if (tx - tw / 2 < X0 + 2 || tx + tw / 2 > X0 + pw - 2 || (T && tx + tw / 2 > fx - 6 && tx - tw / 2 < fx + fw + 6)) continue;
    out += `<text x="${r2(tx)}" y="${r2(ay + 21)}" text-anchor="middle" font-family="${SNAP.UI}" font-size="12" fill="${slate}">${lbl}</text>`;
  }
  o(B, `<text x="${r2(X0 - 8)}" y="${r2(ay + 21)}" text-anchor="end" font-family="${SNAP.UI}" font-size="12" fill="${slate}"><tspan font-family="${SNAP.MATH}" font-style="italic" font-size="15" fill="${ink}">t</tspan> ${us ? `− ${(ref * 1e3).toFixed(1)} ms, in µs` : 'in ms'}</text>`);
  // top layer over a base layer with every tick label: paper under the flag hides the labels it would touch
  if (L === 'top') for (const tt of ticks) {                 // exactly the labels the full picture leaves out
    const tx = X0 + X(tt, pw), tw = 7.5 * (us ? ((tt - ref) * 1e6).toFixed(d) : (tt * 1e3).toFixed(d)).length;
    if (tx - tw / 2 < X0 + 2 || tx + tw / 2 > X0 + pw - 2) continue;   // the base layer leaves these out too
    if (tx + tw / 2 > fx - 6 && tx - tw / 2 < fx + fw + 6) out += `<rect x="${r2(tx - tw / 2 - 3)}" y="${r2(ay + 8)}" width="${r2(tw + 6)}" height="17" fill="#ffffff"/>`;
  }
  o(T, `<line x1="${r2(xc)}" y1="${y}" x2="${r2(xc)}" y2="${r2(ay + 7)}" stroke="${cur}" stroke-width="1.2"/>` +
    `<rect x="${r2(fx)}" y="${r2(ay + 6)}" width="${fw}" height="20" rx="3" fill="${cur}"/>` +
    `<text x="${r2(fx + fw / 2)}" y="${r2(ay + 20.5)}" text-anchor="middle" font-family="${SNAP.UI}" font-size="13" font-weight="600" fill="#ffffff">${flag}</text>`);
  SNAP.geo = { X0, pw, y, ay, view: S.view.slice() };          // plot geometry of the last snapshot (slide click zones)
  return out;
}

// ------------------------------------------------------------------ the whole slide picture
// layer: full (one picture) | base (title, waveforms without the cursor: the same for every instant of a view) |
// top (transparent: drawing, legend, time, cursor, values); base + top at the same place give the full picture.
// flow: true keeps the flowing arrowheads where they are (film frames, video.js) instead of static ones
function snapshotSVG(opts = {}) {
  if (!S.circ || !S.meta) throw new Error('nothing to snapshot yet');
  const L = opts.layer || 'full', B = L !== 'top', T = L !== 'base';
  const { W, H, PAD, HEAD } = SNAP, vb = S.circ.svg.viewBox.baseVal, wide = vb.width / vb.height > 1.6;
  const ink = tok('--ink'), slate = tok('--ink-3');
  let body = '';
  // header: run title (left), cursor time (right)
  if (B) body += `<text x="${PAD}" y="${PAD + 10}" font-family="${SNAP.UI}" font-size="15" fill="${tok('--ink-2')}">${titleSVG(S.meta.title, 15)}</text>`;
  if (T) body += `<text x="${W - PAD}" y="${PAD + 10}" text-anchor="end" font-family="${SNAP.UI}" font-size="17" font-weight="600" fill="${tok('--cursor')}"><tspan font-family="${SNAP.MATH}" font-style="italic" font-weight="400" fill="${slate}">t</tspan><tspan fill="${slate}" font-weight="400"> = </tspan>${(S.cur * 1e3).toFixed(4)} ms</text>`;
  const top = PAD + HEAD, avail = H - top - PAD;
  let cx, cy, cw, ch, wx, wy, ww, wh;
  if (wide) { cx = PAD; cy = top; cw = W - 2 * PAD; ch = Math.round(avail * 0.5); wx = PAD; wy = cy + ch + 12; ww = cw; wh = H - PAD - wy; }
  else { cx = PAD; cy = top; ch = avail; cw = Math.min(Math.round(W * 0.56), Math.round((ch - SNAP.LEG - 30) * vb.width / vb.height) + 40); wx = cx + cw + 24; wy = top; ww = W - PAD - wx; wh = avail; }
  // space-vector panel (svm.js) while it is shown: beside the drawing (wide) or above the waveforms (tall); top layer
  const svm = typeof svmSnapshot === 'function' && svmSnapshot.shown();
  let sx0, sy0, sw0, sh0;
  if (svm && wide) { sw0 = ch; cw -= sw0 + 16; sx0 = cx + cw + 16; sy0 = cy; sh0 = ch; }
  else if (svm) { sh0 = Math.min(Math.round(avail * 0.5), ww); sw0 = ww; sx0 = wx; sy0 = wy; wy += sh0 + 12; wh -= sh0 + 12; }
  if (T && svm) body += svmSnapshot(sx0, sy0, sw0, sh0);
  if (T) {
    const leg = legendSVG(cx, 0, cw), lh = leg.h + 8;
    const g = circuitGroup(cx, cy, cw, ch - lh, opts.flow);
    body += g.svg;
    body += `<g transform="translate(0,${r2(Math.min(cy + ch - lh, g.box[1] + g.box[3] + 10) + 10)})">${leg.svg}</g>`;
  }
  if (B) body += `<rect x="${r2(wx - 0.5)}" y="${r2(wy - 0.5)}" width="${r2(ww + 1)}" height="${r2(wh + 1)}" fill="none" stroke="${tok('--hair')}" stroke-width="1"/>`;
  body += wavesSVG(wx, wy, ww, wh, L);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    (B ? `<rect width="${W}" height="${H}" fill="#ffffff"/>` : '') + `${body}</svg>`;
}

// ------------------------------------------------------------------ Export menu (PowerPoint bridge, HTML, SVG)
let toastTimer = 0;
function toast(msg, bad) {
  const el = $('#toast'); el.textContent = msg; el.classList.toggle('bad', !!bad); el.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), bad ? 6000 : 3000);
}
async function post(u, d) {
  const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
  if (!r.ok) throw new Error(r.status === 404 ? 'restart the CircuitView server once to enable PowerPoint' : 'server ' + r.status);
  const j = await r.json(); if (!j.ok) throw new Error(j.error); return j.result;
}
function b64(u8) {                                        // bytes -> base64 (in slices: no call-stack limit)
  let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// one picture per switching state of one sampling period from the cursor: the state at the cursor, then the instant
// after every switching edge before cursor + T_sp (as the Edge buttons place the cursor); at most 40
function sequenceItems() {
  const t0 = S.cur, Tsp = S.meta.Tsp || (S.t1 - S.t0) / 100, ts = [t0];
  for (const e of S.edges || []) if (e > t0 + 1e-9 && e < t0 + Tsp && ts.length < 40) ts.push(e + 1e-9);
  const items = ts.map(t => { S.cur = t; drawCursor(); return { svg: snapshotSVG(), state: cvState() }; });
  S.cur = t0; drawCursor();
  return items;
}
// clickable slides (pptbridge.interactive): one state per switching edge inside the view (and the state at its start),
// the shared base layer, one top layer per state and the click zone of each state, [t_k, t_k+1) in snapshot px
function interactiveSet(max = 80) {
  const [a, b] = S.view, t0 = S.cur, ts = [a + 1e-9];
  for (const e of S.edges || []) if (e > a && e < b) ts.push(e + 1e-9);
  if (ts.length > max) throw new Error(`this view has ${ts.length} switching states; zoom in to ${max} or fewer (for example 1 Tsp)`);
  const base = snapshotSVG({ layer: 'base' }), geo = { ...SNAP.geo };
  const xs = ts.map(t => geo.X0 + X(t, geo.pw));
  const zones = xs.map((x, k) => [k ? x : geo.X0, k + 1 < xs.length ? xs[k + 1] : geo.X0 + geo.pw]);
  const items = ts.map(t => { S.cur = t; drawCursor(); return { svg: snapshotSVG({ layer: 'top' }), state: cvState() }; });
  S.cur = t0; drawCursor();
  return { base, items, zones, geo: { y: geo.y, ay: geo.ay }, title: plainText(S.meta.title) };
}
const fileBase = () => `${S.run}_t${(S.cur * 1e3).toFixed(4).replace('.', 'p')}ms`;
async function exportAction(x) {
  try {
    if (x === 'svg') { download(fileBase() + '.svg', new Blob([snapshotSVG()], { type: 'image/svg+xml' })); return toast('Picture saved'); }
    if (x === 'cvlive') {
      const a = document.createElement('a'); a.href = `/api/export_live?id=${encodeURIComponent(S.run)}&state=${encodeURIComponent(JSON.stringify(cvState()))}`;
      a.download = S.run + '.cvlive'; document.body.appendChild(a); a.click(); a.remove(); return toast('Preparing the live slide file');
    }
    if (x === 'html') {
      const a = document.createElement('a'); a.href = `/api/export_html?id=${encodeURIComponent(S.run)}&state=${encodeURIComponent(JSON.stringify(cvState()))}`;
      a.download = S.run + '.html'; document.body.appendChild(a); a.click(); a.remove(); return toast('Preparing the HTML file');
    }
    if (x === 'ppt-open') {
      const r = await fetch('/api/ppt/selection'); if (!r.ok) throw new Error('restart the CircuitView server once to enable PowerPoint');
      const j = await r.json(); if (!j.ok) throw new Error(j.error);
      await applyState(j.result); return toast('Opened the selected picture');
    }
    if (x === 'ppt-inter') {
      const d = interactiveSet(); toast(`Sending ${d.items.length} clickable slides`);
      const r = await post('/api/ppt/interactive', d); return toast(`Clickable slides ${r.slides[0]}–${r.slides[1]} added`);
    }
    if (x === 'ppt-seq') {
      const items = sequenceItems(); toast(`Sending ${items.length} slides`);
      const r = await post('/api/ppt/sequence', { items }); return toast(`Slides ${r.slides[0]}–${r.slides[1]} added`);
    }
    if (x === 'ppt-video' || x === 'mp4' || (x === 'ppt-update' && PPT.target && PPT.target.kind === 'video')) {
      const v = await recordDialog(x === 'mp4' ? 'file' : 'ppt');  // format, speed, progress + Stop (video.js)
      if (!v) return;
      const cut = v.stopped ? ', stopped early' : '';
      if (v.gif) { download(fileBase() + '.gif', new Blob([v.gif], { type: 'image/gif' })); return toast(`GIF saved (${v.seconds} s${cut})`); }
      if (x === 'mp4') { download(fileBase() + '.mp4', new Blob([v.mp4], { type: 'video/mp4' })); return toast(`Video saved (${v.seconds} s${cut})`); }
      const d = { mp4: b64(v.mp4), state: cvState() }; toast('Sending the video to PowerPoint');
      if (x === 'ppt-video') { const r = await post('/api/ppt/video', d); return toast(`Video on slide ${r.slide} (${v.seconds} s)`); }
      const t = PPT.target, r = await post('/api/ppt/update_video', { ...d, slide: t.slide, shape: t.shape, pres: t.pres });
      t.shape = r.id; return toast(`Video updated on slide ${r.slide}`);
    }
    if (x === 'ppt-update' && PPT.target) {                   // the picture the add-in opened (its own layer)
      const t = PPT.target, d = { svg: snapshotSVG({ layer: t.layer === 'top' ? 'top' : 'full' }), state: cvState(), slide: t.slide, shape: t.shape, pres: t.pres };
      const r = await post('/api/ppt/update', d); t.shape = r.id; return toast(`Updated on slide ${r.slide}`);
    }
    const d = { svg: snapshotSVG(), state: cvState() };
    if (x === 'ppt-update') { const r = await post('/api/ppt/update', d); return toast(`Updated on slide ${r.slide}`); }
    const r = await post('/api/ppt/send', { ...d, where: x === 'ppt-here' ? 'here' : 'new' });
    toast(`Placed on slide ${r.slide}`);
  } catch (e) { toast(String(e.message || e), true); }
}
// PowerPoint add-in modes (office/): ?ppt=edit&slide=<SlideID>&shape=<shape Id>&pres=<FullName> opens that picture's view and offers
// Update; ?ppt=insert offers the insert actions. A bar under the toolbar holds the actions of the mode.
const PPT = { target: null };
async function pptMode() {
  const q = new URLSearchParams(location.search), mode = q.get('ppt'), bar = $('#pptbar');
  if (!mode || EMB || !bar) return;
  for (let k = 0; k < 400 && !(S.ready && S.meta); k++) await new Promise(r => setTimeout(r, 50));
  await S.ready;
  const acts = mode === 'edit' ? [['ppt-update', 'Update the picture in PowerPoint', true]] :
    [['ppt-here', 'Insert on the current slide', true], ['ppt-new', 'New slide'], ['ppt-inter', 'Clickable slides of this view'], ['ppt-video', 'Video slide']];
  $('#pptacts').innerHTML = acts.map(([x, t, main]) => `<button data-x="${x}"${main ? ' class="main"' : ''}>${t}</button>`).join('');
  bar.hidden = false; document.documentElement.classList.add('ppt-mode'); redraw();
  $('#pptacts').onclick = e => { const b = e.target.closest('button[data-x]'); if (b) exportAction(b.dataset.x); };
  if (mode === 'edit') {
    try {
      const r = await fetch(`/api/ppt/shape?slide=${encodeURIComponent(q.get('slide'))}&shape=${encodeURIComponent(q.get('shape'))}&pres=${encodeURIComponent(q.get('pres') || '')}`);
      const j = await r.json(); if (!j.ok) throw new Error(j.error);
      PPT.target = { slide: j.result.slide, shape: j.result.shape, layer: j.result.layer, pres: j.result.pres, kind: j.result.kind };
      await applyState(j.result.state);
      $('#pptmsg').textContent = `Editing the picture on slide ${q.get('index') || ''}`.trim();
    } catch (e) { $('#pptmsg').textContent = ''; toast(String(e.message || e), true); }
  } else $('#pptmsg').textContent = 'Set the view, then';
}
function wireExport() {
  const b = $('#xport'), m = $('#xmenu');
  if (!b || !m) return;
  if (EMB) m.querySelectorAll('[data-x^="ppt"], [data-x="html"], [data-x="cvlive"], .xh').forEach(el => el.remove());   // no server in a file
  const close = () => { m.hidden = true; b.setAttribute('aria-expanded', 'false'); };
  b.onclick = e => {
    e.stopPropagation();
    if (!m.hidden) return close();
    const r = b.getBoundingClientRect(); m.hidden = false;
    m.style.top = (r.bottom + 6) + 'px'; m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + 'px';
    b.setAttribute('aria-expanded', 'true'); m.querySelector('button').focus();
  };
  m.onclick = e => { const it = e.target.closest('button[data-x]'); if (!it) return; close(); exportAction(it.dataset.x); };
  addEventListener('click', e => { if (!m.hidden && !m.contains(e.target)) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !m.hidden) { close(); b.focus(); } });
}
wireExport();
pptMode();
