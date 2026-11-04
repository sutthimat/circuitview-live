// CircuitView - space-vector panel (#svm) for three-level runs.
// The diagram is Fig. 1(b) of the LUT-SVM paper (work/lut_svm_paper/.../F1_svm_diagram.tex): hexagon of the 27
// states, region shading 1 / 2 / 3-4, the two medium triangles, sector arcs, the m_a = 1 circle. Coordinates are
// in units of Vdc/3 (large vector = 2, small = 1, medium = sqrt 3), alpha to the right, beta up.
// At the cursor it shows
//   Vref  = volt-second average of the applied leg states s_a, s_b, s_c (-1 / 0 / +1) over the sampling period Tsp
//           that holds the cursor: Vref = (1/Tsp) Int (s_a + a s_b + a^2 s_c) dt, a = e^{j120 deg}   [Vdc/3]
//   m_a   = |Vref| / sqrt 3   (the dashed circle is m_a = 1)
//   the state applied at the cursor (ring), the states visited in that period (thin path), the Vref tips of the
//   last fundamental cycle (trail), the sector (bold outline), the region of the sector (1A / 1B / 2A / 2B / 3 / 4,
//   darker shade) and the readout below the diagram.
// Shown only when the run has step signals s_a, s_b, s_c with values in {-1, 0, 1}.
(function () {
  const NS = 'http://www.w3.org/2000/svg', R3 = Math.sqrt(3), D = Math.PI / 180;
  const COL = { z: '#4D4D4D', s: '#2364AA', m: '#D9730D', l: '#2E7D32', ref: '#B3122E',
    r1a: '#DCEAF7', r1b: '#C3DAF0', r2a: '#FCE9D2', r2b: '#F8D6AE', r3: '#DCEED5', r4: '#C4E3B9',
    tri1: '#0B4F6C', tri2: '#C0392B' };
  const P = { svg: null, dyn: null, run: null, ok: false, fns: null, f1: 0, Tsp: 0, a0: 0 };
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e); return e;
  };
  const xy = (r, deg) => [r * Math.cos(deg * D), -r * Math.sin(deg * D)];      // screen y down
  const pts = a => a.map(p => p[0].toFixed(4) + ',' + p[1].toFixed(4)).join(' ');
  const rot = (p, deg) => { const c = Math.cos(deg * D), s = Math.sin(deg * D); return [p[0] * c + p[1] * s, -p[0] * s + p[1] * c]; };
  // a state (s_a, s_b, s_c) -> its vector [Vdc/3], screen coordinates
  const vec = (a, b, c) => [a - 0.5 * b - 0.5 * c, -(R3 / 2) * (b - c)];
  const LET = { '1': 'P', '0': 'O', '-1': 'N' };

  // ------------------------------------------------------------ static diagram (Fig. 1(b))
  function label(g, x, y, sub, size, halo) {
    // V with a right harpoon above it and an upright subscript, centred on (x, y); Times as in the paper
    const t = el('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'svm-lab' + (halo ? ' halo' : ''),
      'font-size': size }, g);
    const v = el('tspan', { 'font-style': 'italic' }, t); v.textContent = 'V';
    const s = el('tspan', { 'font-size': (size * 0.72).toFixed(3), dy: (size * 0.28).toFixed(3) }, t); s.textContent = sub;
    t._harpoon = true; return t;
  }
  function harpoons(svg) {                   // after layout: a harpoon over every 'V' (needs the text rendered)
    svg.querySelectorAll('text.svm-lab').forEach(t => {
      if (t._h) return; let b; try { b = t.getExtentOfChar(0); } catch (e) { return; }
      if (!b || !b.width) return;
      const fs = parseFloat(t.getAttribute('font-size')), x0 = b.x + 0.18 * b.width, x1 = b.x + b.width * 1.02, y = b.y + 0.06 * fs;
      const w = 0.045 * fs;
      t._h = el('path', { d: `M${x0.toFixed(4)},${y.toFixed(4)}H${x1.toFixed(4)}l${(-0.18 * fs).toFixed(4)},${(-0.10 * fs).toFixed(4)}`,
        class: 'svm-harp' + (t.classList.contains('svm-reflab') ? ' ref' : ''), 'stroke-width': w.toFixed(4) }, t.parentNode);
    });
  }
  function build(host) {
    host.innerHTML = '';
    const svg = el('svg', { viewBox: '-2.9 -2.9 5.8 5.8', class: 'svm-svg', role: 'img', 'aria-label': 'space-vector diagram' }, host);
    const hex = [0, 60, 120, 180, 240, 300].map(d => xy(2, d));
    el('polygon', { points: pts(hex), fill: COL.r3 }, svg);
    el('polygon', { points: pts([xy(R3, 30), xy(R3, 150), xy(R3, 270)]), fill: COL.r2a }, svg);
    el('polygon', { points: pts([xy(R3, 90), xy(R3, 210), xy(R3, 330)]), fill: COL.r2a }, svg);
    el('polygon', { points: pts([0, 60, 120, 180, 240, 300].map(d => xy(1, d))), fill: COL.r1a }, svg);
    P.region = el('polygon', { points: '', class: 'svm-region' }, svg);              // current region, darker shade
    // the triangular lattice (black 18 %) and the six spokes to the large vectors (black 50 %)
    const lat = [];
    for (let k = 0; k < 6; k++) {
      const a = k * 60;
      lat.push([xy(1, a), xy(1, a + 60)], [xy(1, a), xy(2, a)], [xy(1, a), xy(R3, a + 30)], [xy(1, a), xy(R3, a - 30)],
        [xy(R3, a + 30), xy(2, a)], [xy(R3, a + 30), xy(2, a + 60)], [[0, 0], xy(1, a)]);
    }
    el('path', { d: lat.map(([p, q]) => `M${p[0].toFixed(4)},${p[1].toFixed(4)}L${q[0].toFixed(4)},${q[1].toFixed(4)}`).join(''),
      class: 'svm-lat' }, svg);
    el('path', { d: [0, 60, 120, 180, 240, 300].map(d => { const p = xy(2, d); return `M0,0L${p[0].toFixed(4)},${p[1].toFixed(4)}`; }).join(''),
      class: 'svm-spoke' }, svg);
    el('polygon', { points: pts(hex), class: 'svm-hex' }, svg);
    el('polygon', { points: pts([xy(R3, 30), xy(R3, 150), xy(R3, 270)]), class: 'svm-tri', stroke: COL.tri1 }, svg);
    el('polygon', { points: pts([xy(R3, 90), xy(R3, 210), xy(R3, 330)]), class: 'svm-tri', stroke: COL.tri2 }, svg);
    el('circle', { cx: 0, cy: 0, r: R3, class: 'svm-ma1' }, svg);
    P.sector = el('polygon', { points: '', class: 'svm-sector' }, svg);              // current sector, bold outline
    // sector arcs with arrows and the names along the arc (top sectors read clockwise, bottom ones counter-clockwise)
    const defs = el('defs', {}, svg), ra = 2.625;
    const mk = el('marker', { id: 'svm-ah', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,1.2L10,5L0,8.8z', class: 'svm-ah' }, mk);
    const arc = (a1, a2) => { const p = xy(ra, a1), q = xy(ra, a2), sweep = a2 < a1 ? 1 : 0;
      return `M${p[0].toFixed(4)},${p[1].toFixed(4)}A${ra},${ra} 0 0 ${sweep} ${q[0].toFixed(4)},${q[1].toFixed(4)}`; };
    for (let k = 1; k <= 6; k++) {
      const c = 60 * k - 30, top = c < 180;
      const tk = xy(2.58, 60 * (k - 1)), tk2 = xy(2.67, 60 * (k - 1));
      el('path', { d: `M${tk[0]},${tk[1]}L${tk2[0]},${tk2[1]}`, class: 'svm-arc' }, svg);
      el('path', { d: arc(c - 13, c - 28.8), class: 'svm-arc', 'marker-end': 'url(#svm-ah)' }, svg);
      el('path', { d: arc(c + 13, c + 28.8), class: 'svm-arc', 'marker-end': 'url(#svm-ah)' }, svg);
      const id = 'svm-sp' + k;
      el('path', { id, d: top ? arc(c + 13, c - 13) : arc(c - 13, c + 13), fill: 'none' }, defs);
      const t = el('text', { class: 'svm-sec', 'font-size': 0.23, dy: 0.08 }, svg);
      const tp = el('textPath', { href: '#' + id, startOffset: '50%', 'text-anchor': 'middle' }, t);
      tp.textContent = 'Sector ' + k; P['sec' + k] = t;
    }
    // vector dots and names (outward, as in the paper); zero vector at the centre, its name below
    const dots = el('g', {}, svg), labs = el('g', {}, svg), fs = 0.25;
    P.keep = [[0, 0.36, 0.18, 0.17], [0, 0, 0.08, 0.08]];     // boxes [cx, cy, half w, half h] the V_ref name avoids
    const dot = (p, col, r) => el('circle', { cx: p[0].toFixed(4), cy: p[1].toFixed(4), r, fill: col, class: 'svm-dot' }, dots);
    const name = (p, deg, sub, halo) => {
      const c = Math.cos(deg * D), s = Math.sin(deg * D), d = 0.12 + 0.2 * Math.abs(c) + 0.15 * Math.abs(s);
      label(labs, (p[0] + d * c).toFixed(4), (p[1] - d * s).toFixed(4), sub, fs, halo);
      P.keep.push([p[0] + d * c, p[1] - d * s, 0.25, 0.17], [p[0], p[1], 0.07, 0.07]);
    };
    for (let k = 1; k <= 6; k++) {
      const a = 60 * (k - 1);
      dot(xy(1, a), COL.s, 0.06); name(xy(1, a), a, 'S' + k, true);
      dot(xy(R3, a + 30), COL.m, 0.06); name(xy(R3, a + 30), a + 30, 'M' + k, false);
      dot(xy(2, a), COL.l, 0.06); name(xy(2, a), a, 'L' + k, false);
    }
    dot([0, 0], COL.z, 0.07); label(labs, 0, 0.36, '0', fs, true);
    // dynamic layer: trail of the last cycle, the period's state path, Vref, the applied state
    const dyn = el('g', {}, svg); P.dyn = dyn;
    P.trail = el('polyline', { points: '', class: 'svm-trail' }, dyn);
    P.seq = el('polyline', { points: '', class: 'svm-seq' }, dyn);
    P.now = el('circle', { r: 0.12, class: 'svm-now' }, dyn);
    P.ref = el('path', { d: '', class: 'svm-ref' }, dyn);
    P.refHead = el('path', { d: '', class: 'svm-refhead' }, dyn);
    P.refLab = label(dyn, 0, 0, 'ref', fs, true); P.refLab.classList.add('svm-reflab');
    P.svg = svg;
    const rd = document.createElement('div'); rd.className = 'svm-read'; host.appendChild(rd); P.read = rd;
    requestAnimationFrame(() => harpoons(svg));
  }

  // ------------------------------------------------------------ data: cumulative integrals of the leg states
  function prep() {
    const fns = ['s_a', 's_b', 's_c'].map(n => {
      const { t, v } = S.sig[n].data, c = new Float64Array(t.length);
      for (let i = 1; i < t.length; i++) c[i] = c[i - 1] + v[i - 1] * (t[i] - t[i - 1]);
      return { t, v, c, F: x => { const k = lastLE(t, x); return k < 0 ? v[0] * (x - t[0]) : c[k] + v[k] * (x - t[k]); } };
    });
    P.fns = fns;
    P.Tsp = S.meta.Tsp || 0;
    P.a0 = phase(fns, P.Tsp);
    const f = /([\d.]+)\s*Hz/.exec((S.meta.params || {}).f1 || ''); P.f1 = f ? parseFloat(f[1]) : 0;
  }
  // where the sampling periods start: the offset (one of the switching instants, modulo Tsp) for which the most
  // periods hold a symmetric (palindromic) state sequence, as a centred 7-segment pattern does; ties keep the first
  // logged instant. The runs log gates one solver step after the command, so the offset is not always S.t0.
  function phase(fns, T) {
    if (!(T > 0)) return S.t0;
    const st = x => fns.map(f => f.v[Math.max(lastLE(f.t, x), 0)]).join();
    const seqOf = (a, b) => {
      const ts = new Set([a]); for (const f of fns) for (let i = Math.max(lastLE(f.t, a), 0); i < f.t.length && f.t[i] < b; i++) if (f.t[i] > a) ts.add(f.t[i]);
      const q = []; for (const x of [...ts].sort((p, r) => p - r)) { const k = st(x + 1e-12); if (k !== q[q.length - 1]) q.push(k); }
      return q;
    };
    const score = c => { let n = 0; for (let j = 1; j <= 24; j++) { const a = c + j * T; if (a + T > S.t1) break; const q = seqOf(a + 1e-12, a + T - 1e-12); if (q.join('|') === q.slice().reverse().join('|')) n++; } return n; };
    const cand = [S.t0];
    for (const f of fns) for (let i = 1; i < f.t.length && f.t[i] < S.t0 + 3 * T; i++) cand.push(S.t0 + ((f.t[i] - S.t0) % T + T) % T);
    let best = S.t0, bs = score(S.t0);
    for (const c of cand) { const sc = score(c); if (sc > bs) { bs = sc; best = c; } }
    return best;
  }
  function avg(a, b) {                                  // volt-second average over [a, b] -> [x, y] screen units
    const s = P.fns.map(f => (f.F(b) - f.F(a)) / (b - a));
    return vec(s[0], s[1], s[2]);
  }
  const stateAt = x => P.fns.map(f => f.v[Math.max(lastLE(f.t, x), 0)]);

  // ------------------------------------------------------------ cursor update
  function regionOf(p) {                                // p in screen units -> {sec, theta, name, poly}
    const ang = Math.atan2(-p[1], p[0]) / D, a = (ang + 360) % 360, sec = Math.min(6, Math.floor(a / 60) + 1);
    const th = a - 60 * (sec - 1), q = rot(p, -60 * (sec - 1));                 // sector-1 frame (screen y down)
    const h = -q[1] / (R3 / 2), g = q[0] - 0.5 * h;                              // q = g e0 + h e60
    const X = [0.75, -R3 / 4], S1 = [1, 0], S2 = [0.5, -R3 / 2], M1 = [1.5, -R3 / 2], L1 = [2, 0], L2 = [1, -R3];
    let name, poly;
    if (g + h > 2 + 1e-9) { name = 'outside'; poly = null; }
    else if (g + h <= 1) { name = th < 30 ? '1A' : '1B'; poly = th < 30 ? [[0, 0], S1, X] : [[0, 0], X, S2]; }
    else if (g > 1) { name = '3'; poly = [S1, L1, M1]; }
    else if (h > 1) { name = '4'; poly = [S2, M1, L2]; }
    else { name = th < 30 ? '2A' : '2B'; poly = th < 30 ? [S1, M1, X] : [X, M1, S2]; }
    return { sec, ang: a, th, name, poly: poly && poly.map(v => rot(v, 60 * (sec - 1))) };
  }
  const SHADE = { '1A': 'r1b', '1B': 'r1b', '2A': 'r2b', '2B': 'r2b', '3': 'r4', '4': 'r4' };
  function update() {
    if (!P.ok || !P.svg) return;
    const T = P.Tsp, t = S.cur, k = Math.floor((t - P.a0) / T), a = P.a0 + k * T, b = a + T;
    if (!(T > 0) || a < S.t0 - 1e-12 || b > S.t1 + 1e-9) {     // first / last partial period: nothing to average
      P.read.innerHTML = '<span class="k">no full period at the cursor</span>';
      P.dyn.setAttribute('visibility', 'hidden'); P.sector.setAttribute('points', ''); P.region.setAttribute('points', '');
      for (let j = 1; j <= 6; j++) P['sec' + j].classList.remove('on');
      P.last = null; return;
    }
    P.dyn.removeAttribute('visibility');
    const v = avg(a, b), m = Math.hypot(v[0], v[1]) / R3, R = regionOf(v);
    // Vref arrow with a filled head (shaft stops at the head's base)
    const L = Math.hypot(v[0], v[1]), ux = v[0] / (L || 1), uy = v[1] / (L || 1), hl = Math.min(0.2, 0.6 * L), hw = 0.075;
    const bx = v[0] - ux * hl, by = v[1] - uy * hl;
    P.ref.setAttribute('d', `M0,0L${bx.toFixed(4)},${by.toFixed(4)}`);
    P.refHead.setAttribute('d', `M${v[0].toFixed(4)},${v[1].toFixed(4)}L${(bx - uy * hw).toFixed(4)},${(by + ux * hw).toFixed(4)}L${(bx + uy * hw).toFixed(4)},${(by - ux * hw).toFixed(4)}z`);
    // name near the tip, at the first candidate place that keeps clear of the fixed names, the dots and the arrow
    const cands = [[0.18, 0.24], [0.18, -0.24], [0.34, 0], [0, 0.3], [0, -0.3], [0.32, 0.3], [0.32, -0.3], [-0.25, 0.28], [-0.25, -0.28]];
    let bestP = null, bestS = Infinity;
    cands.forEach(([along, side], j) => {
      const cx = v[0] + ux * along - uy * side, cy = v[1] + uy * along + ux * side, hw = 0.23, hh = 0.15;
      let sc = j * 1e-3;
      for (const [kx, ky, kw, kh] of P.keep) {
        const ox = Math.min(cx + hw, kx + kw) - Math.max(cx - hw, kx - kw), oy = Math.min(cy + hh, ky + kh) - Math.max(cy - hh, ky - kh);
        if (ox > 0 && oy > 0) sc += ox * oy;
      }
      const tt = Math.max(0, Math.min(1, (cx * v[0] + cy * v[1]) / (L * L || 1))), dx = cx - tt * v[0], dy = cy - tt * v[1];
      if (Math.hypot(dx, dy) < hh + 0.03) sc += 0.05;                            // on the arrow itself
      if (sc < bestS) { bestS = sc; bestP = [cx, cy]; }
    });
    P.refLab.setAttribute('x', bestP[0].toFixed(4)); P.refLab.setAttribute('y', bestP[1].toFixed(4));
    if (P.refLab._h) { P.refLab._h.remove(); P.refLab._h = null; } harpoons(P.svg);
    // trail: the Vref tips of the last fundamental cycle up to this period
    if (P.f1 > 0) {
      const n = Math.max(2, Math.round(1 / (P.f1 * T))), tr = [];
      for (let j = Math.max(0, k - n + 1); j <= k; j++) { const aa = P.a0 + j * T; if (aa + T <= S.t1 + 1e-9) tr.push(avg(aa, aa + T)); }
      P.trail.setAttribute('points', pts(tr));
    }
    // the states visited in this period, in order, and the state applied at the cursor
    const ts = new Set([a]); for (const f of P.fns) { let i = Math.max(lastLE(f.t, a), 0); for (; i < f.t.length && f.t[i] < b; i++) if (f.t[i] > a) ts.add(f.t[i]); }
    const seq = []; let last = '';
    for (const x of [...ts].sort((p, q) => p - q)) { const s = stateAt(x), key = s.join(); if (key !== last) { seq.push(vec(...s)); last = key; } }
    P.seq.setAttribute('points', pts(seq));
    const sn = stateAt(t), pn = vec(...sn);
    P.now.setAttribute('cx', pn[0].toFixed(4)); P.now.setAttribute('cy', pn[1].toFixed(4));
    // sector outline and region shade
    P.sector.setAttribute('points', pts([[0, 0], xy(2, 60 * (R.sec - 1)), xy(2, 60 * R.sec)]));
    P.region.setAttribute('points', R.poly ? pts(R.poly) : ''); P.region.setAttribute('fill', R.poly ? COL[SHADE[R.name]] : 'none');
    for (let j = 1; j <= 6; j++) P['sec' + j].classList.toggle('on', j === R.sec);
    const st = sn.map(x => LET[String(x)] || '?').join('');
    P.last = { m, sec: R.sec, th: R.th, name: R.name, st };
    P.read.innerHTML =
      `<span class="rd"><span class="k tex"><i>m</i><sub>a</sub></span><b>${m.toFixed(3)}</b></span>` +
      `<span class="rd"><span class="k">Sector</span><b>${R.sec}</b></span>` +
      `<span class="rd"><span class="k tex"><i>θ</i></span><b>${R.th.toFixed(1)}°</b></span>` +
      `<span class="rd"><span class="k">Region</span><b>${R.name}</b></span>` +
      `<span class="rd"><span class="k">State</span><b class="st">${st}</b></span>`;
  }

  // ------------------------------------------------------------ run changes, visibility, hook into the cursor
  // app.js owns the panel: setPanelAvail('svm', ok) shows its switch (and the panel, unless the user hid it),
  // panelShown('svm') says whether it is on screen. The diagram goes into #svmbody, under the panel header.
  const shown = () => P.ok && (typeof panelShown === 'function' ? panelShown('svm') : true);
  function sync() {
    const host = document.getElementById('svmbody') || document.getElementById('svm');
    if (typeof setPanelAvail === 'function') setPanelAvail('svm', P.ok);
    document.documentElement.classList.toggle('has-svm', P.ok);
    if (!host || !shown()) return;
    if (!P.svg) build(host);
    harpoons(P.svg); update();
  }
  async function onRun() {
    P.run = S.run; P.ok = false;
    const names = ['s_a', 's_b', 's_c'];
    if (names.every(n => S.sig[n] && S.sig[n].kind === 'step')) {
      try { await Promise.all(names.map(n => loadSig(n))); } catch (e) { /* not in this record */ }
      if (P.run !== S.run) return;
      P.ok = names.every(n => S.sig[n].data && S.sig[n].data.v.every(x => x === -1 || x === 0 || x === 1));
      // a two-level leg logs 0 / 1 only: treat as three-level only when -1 occurs somewhere
      if (P.ok) P.ok = names.some(n => S.sig[n].data.v.some(x => x === -1));
      // and the drawing must be three legs that can clamp to O (a two-level leg logs 0 only for dead-time)
      if (P.ok) P.ok = !!S.circ && S.circ.legs.length === 3 && S.circ.legs.every(L => Object.values(L.table).some(r => r.state === 'O'));
    }
    if (P.ok) prep();
    sync();
    if (typeof setLayout === 'function') setLayout();
    if (typeof redraw === 'function') redraw();
  }
  // the panel as SVG for pictures and video frames (snapshot.js): the diagram with inline styles, letterboxed into
  // (x, y, w, h), and the readout as one text line under it
  window.svmSnapshot = function (x, y, w, h) {
    if (!shown() || !P.svg || !P.last) return '';
    const RH = 30, side = Math.max(10, Math.min(w, h - RH)), ox = x + (w - side) / 2;
    const clone = P.svg.cloneNode(true); inlineStyles(P.svg, clone);
    const L = P.last, ink = '#16191d', k = '#87909a', ui = "'Segoe UI', Arial, sans-serif", math = "'Times New Roman', Times, serif";
    const it = (s, sub) => `<tspan font-family="${math}" font-style="italic" font-size="17" fill="${k}">${s}</tspan>` +
      (sub ? `<tspan font-family="${math}" font-size="12" dy="4" fill="${k}">${sub}</tspan><tspan dy="-4"> </tspan>` : ' ');
    const b = v => `<tspan font-weight="600" fill="${ink}">${v}</tspan>`, gap = '<tspan> </tspan>';
    const line = `${it('m', 'a')}${b(L.m.toFixed(3))}${gap}<tspan fill="${k}">Sector </tspan>${b(L.sec)}${gap}` +
      `${it('θ')}${b(L.th.toFixed(1) + '°')}${gap}<tspan fill="${k}">Region </tspan>${b(L.name)}${gap}` +
      `<tspan fill="${k}">State </tspan>${b(L.st)}`;
    return `<svg x="${ox.toFixed(2)}" y="${y.toFixed(2)}" width="${side.toFixed(2)}" height="${side.toFixed(2)}" viewBox="${P.svg.getAttribute('viewBox')}">${clone.innerHTML}</svg>` +
      `<text x="${(x + w / 2).toFixed(2)}" y="${(y + side + 21).toFixed(2)}" text-anchor="middle" font-family="${ui}" font-size="15">${line}</text>`;
  };
  window.svmSnapshot.shown = () => !!(shown() && P.svg && P.last);
  const dc = drawCursor;
  drawCursor = function () {                    // app.js calls the global binding: every cursor move lands here
    dc.apply(this, arguments);
    if (S.run !== P.run) { P.run = S.run; onRun(); return; }
    if (shown()) {                              // shown again after being hidden: build once, then follow the cursor
      if (!P.svg) { build(document.getElementById('svmbody') || document.getElementById('svm')); harpoons(P.svg); }
      update();
    }
  };
})();
