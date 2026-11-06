// CircuitView - space-vector panel (#svm) and the carrier period under the circuit for the ten-switch three-phase
// inverter (3L-SNPC, circuits/snpc3; runs with meta.svm = 'snpc', written by Work_Delta/Stamp/sim_python/cv_export.py).
// State name X|S_a1S_b1S_c1 as Tables I and II of Work_Delta/Stamp/work/tables: X = front-end state F (V_in+ = P,
// V_in- = N), U (P, O), L (O, N), Z (O, O); S_x1 = 1: phase x on V_in+, 0: on V_in-.
// The diagram (units Vdc/3, alpha to the right, beta up): the two-level hexagon at two lengths - large F vectors
// V1..V6 (2Vdc/3) and small vectors V7..V18 (Vdc/3; odd U, even L, the same S_a1S_b1S_c1 as the large vector of
// that direction) - the regions of the run's own modulation (meta.regions: 'stamp4' Stamp's four regions around the
// virtual medium vector (V1 + V2)/2, '607five' the five regions of the 607 reference), sector arcs, the m_a = 1 circle.
// At the cursor: Vref = volt-second average of the applied phase levels over the carrier period Tsp that holds the
// cursor, m_a = |Vref| / sqrt 3, the period's state path, the applied state (no trail of the last cycle: user, 2026-11-06), the
// modulation's own sector and region (steps sec, reg) and the commutations of the front-end and of the legs in it.
// Under the circuit: that period as state boxes X|abc, the rails V_in+ / V_in-, the pole voltages and v_CMV, and at
// every switching instant which stage switched.
// svm.js keeps the three-level runs (steps s_a, s_b, s_c); this file only acts on runs with meta.svm = 'snpc' and
// hands the shared hooks (pictures, Settings, the #tsp box) back to svm.js for every other run.
(function () {
  const NS = 'http://www.w3.org/2000/svg', R3 = Math.sqrt(3), D = Math.PI / 180;
  // own colours, not those of svm.js (three-level group: blue small, orange medium, green large; user, 2026-11-06):
  // teal small U/L vectors, purple large F vectors, gold for Stamp's virtual medium vector
  const COL = { z: '#4D4D4D', s: '#00838F', l: '#6A3D9A', m: '#B8860B', ref: '#B3122E',
    inner: '#DDF1F3', outer: '#ECE6F4', reg: '#A7D9DE', regL: '#CDBDE3' };
  const SIG = ['fe', 'g_Sa1', 'g_Sb1', 'g_Sc1', 'sec', 'reg'];
  const FR = { 1: 'F', 2: 'U', 3: 'L', 4: 'Z' };
  const RAIL = { F: [1, -1], U: [1, 0], L: [0, -1], Z: [0, 0] };              // levels of V_in+, V_in- (P 1, O 0, N -1)
  const LET = { '1': 'P', '0': 'O', '-1': 'N' };
  const Q = { ok: false, run: null, svg: null, host: null, fns: null, Tsp: 0, a0: 0, f1: 0, last: null };
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e); return e;
  };
  const xy = (r, deg) => [r * Math.cos(deg * D), -r * Math.sin(deg * D)];      // screen y down
  const pts = a => a.map(p => p[0].toFixed(4) + ',' + p[1].toFixed(4)).join(' ');
  const rot = (p, deg) => { const c = Math.cos(deg * D), s = Math.sin(deg * D); return [p[0] * c + p[1] * s, -p[0] * s + p[1] * c]; };
  const vec = (a, b, c) => [a - 0.5 * b - 0.5 * c, -(R3 / 2) * (b - c)];      // phase levels -> vector [Vdc/3], screen
  // regions of sector 1 (screen coordinates), rotated by 60 (k - 1) for sector k; checked against mod_607.region and
  // stamp_region.m: V7 (1, 0), V9 (1/2, sqrt3/2), V1 (2, 0), V2 (1, sqrt3), X on V7-V2 and V9-V1, M mid V7-V9,
  // E = (V1 + V2)/2 (Stamp's virtual medium vector)
  const O_ = [0, 0], V7 = [1, 0], V9 = [0.5, -R3 / 2], V1 = [2, 0], V2 = [1, -R3], X_ = [1, -R3 / 3], M_ = [0.75, -R3 / 4], E_ = [1.5, -R3 / 2];
  const REG = { '607five': { 1: [O_, V7, V9], 2: [V7, V1, X_, M_], 3: [M_, X_, V2, V9], 4: [V1, E_, X_], 5: [X_, E_, V2] },
    'stamp4': { 1: [O_, V7, V9], 2: [V7, V9, E_], 3: [V7, V1, E_], 4: [V9, E_, V2] } };
  const CODE = ['100', '110', '010', '011', '001', '101'];                     // S_a1S_b1S_c1 of the direction 60 (k - 1)

  // ------------------------------------------------------------ static diagram
  function label(g, x, y, sub, size, halo, cls) {
    const t = el('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'svm-lab' + (halo ? ' halo' : '') + (cls ? ' ' + cls : ''),
      'font-size': size }, g);
    const v = el('tspan', { 'font-style': 'italic' }, t); v.textContent = 'V';
    const s = el('tspan', { 'font-size': (size * 0.72).toFixed(3), dy: (size * 0.28).toFixed(3) }, t); s.textContent = sub;
    return t;
  }
  function text(g, x, y, s, size, cls, anchor) {
    const t = el('text', { x: x.toFixed(4), y: y.toFixed(4), 'text-anchor': anchor || 'middle', 'dominant-baseline': 'central',
      class: cls, 'font-size': size }, g);
    t.textContent = s; return t;
  }
  function build(host) {
    host.innerHTML = '';
    const svg = el('svg', { viewBox: '-2.9 -2.9 5.8 5.8', class: 'svm-svg', role: 'img', 'aria-label': 'space-vector diagram of the ten-switch inverter' }, host);
    const hex = [0, 60, 120, 180, 240, 300].map(d => xy(2, d)), hex1 = [0, 60, 120, 180, 240, 300].map(d => xy(1, d));
    el('polygon', { points: pts(hex), fill: COL.outer }, svg);
    el('polygon', { points: pts(hex1), fill: COL.inner }, svg);
    Q.region = el('polygon', { points: '', class: 'svm-region' }, svg);
    // region borders of the modulation in all six sectors, the spokes, the hexagons
    const R = REG[(S.meta || {}).regions] || REG['607five'], seg = [];
    for (let k = 0; k < 6; k++) for (const poly of Object.values(R)) {
      const p = poly.map(v => rot(v, 60 * k));
      for (let i = 0; i < p.length; i++) seg.push([p[i], p[(i + 1) % p.length]]);
    }
    el('path', { d: seg.map(([p, q]) => `M${p[0].toFixed(4)},${p[1].toFixed(4)}L${q[0].toFixed(4)},${q[1].toFixed(4)}`).join(''), class: 'svm-lat' }, svg);
    el('path', { d: [0, 60, 120, 180, 240, 300].map(d => { const p = xy(2, d); return `M0,0L${p[0].toFixed(4)},${p[1].toFixed(4)}`; }).join(''),
      class: 'svm-spoke' }, svg);
    el('polygon', { points: pts(hex), class: 'svm-hex' }, svg);
    el('polygon', { points: pts(hex1), class: 'svm-hex', 'stroke-dasharray': '.06 .04' }, svg);
    el('circle', { cx: 0, cy: 0, r: R3, class: 'svm-ma1' }, svg);
    Q.sector = el('polygon', { points: '', class: 'svm-sector' }, svg);
    Q.rnum = el('g', {}, svg);                                                  // region numbers of the cursor's sector
    // sector arcs and names (as svm.js)
    const defs = el('defs', {}, svg), ra = 2.625;
    const mk = el('marker', { id: 'svmq-ah', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,1.2L10,5L0,8.8z', class: 'svm-ah' }, mk);
    const arc = (a1, a2) => { const p = xy(ra, a1), q = xy(ra, a2), sweep = a2 < a1 ? 1 : 0;
      return `M${p[0].toFixed(4)},${p[1].toFixed(4)}A${ra},${ra} 0 0 ${sweep} ${q[0].toFixed(4)},${q[1].toFixed(4)}`; };
    for (let k = 1; k <= 6; k++) {
      const c = 60 * k - 30, top = c < 180;
      el('path', { d: arc(c - 13, c - 28.8), class: 'svm-arc', 'marker-end': 'url(#svmq-ah)' }, svg);
      el('path', { d: arc(c + 13, c + 28.8), class: 'svm-arc', 'marker-end': 'url(#svmq-ah)' }, svg);
      const id = 'svmq-sp' + k;
      el('path', { id, d: top ? arc(c + 13, c - 13) : arc(c - 13, c + 13), fill: 'none' }, defs);
      const t = el('text', { class: 'svm-sec', 'font-size': 0.23, dy: 0.08 }, svg);
      const tp = el('textPath', { href: '#' + id, startOffset: '50%', 'text-anchor': 'middle' }, t);
      tp.textContent = 'Sector ' + k; Q['sec' + k] = t;
    }
    // vectors: large F (purple) with V_k and F|code outside, small U/L (teal) with V_odd,even outside, zero at the
    // centre; Stamp: the virtual medium vector (V_k + V_k+1)/2 as an open gold dot
    const dots = el('g', {}, svg), labs = el('g', {}, svg), fs = 0.22;
    Q.keep = [[0, 0], [0, 0.27]];
    const dot = (p, col, r, open) => el('circle', { cx: p[0].toFixed(4), cy: p[1].toFixed(4), r, fill: open ? 'none' : col,
      stroke: open ? col : null, 'stroke-width': open ? 0.03 : null, class: open ? '' : 'svm-dot' }, dots);
    for (let k = 1; k <= 6; k++) {
      const a = 60 * (k - 1), c = Math.cos(a * D), s = Math.sin(a * D);
      const pL = xy(2, a), pS = xy(1, a);
      dot(pL, COL.l, 0.06); dot(pS, COL.s, 0.055);
      const dL = 0.2 + 0.14 * Math.abs(c), dS = 0.2 + 0.12 * Math.abs(c);
      label(labs, (pL[0] + dL * c).toFixed(4), (pL[1] - dL * s - 0.1).toFixed(4), String(k), fs, true);
      text(labs, pL[0] + dL * c, pL[1] - dL * s + 0.13, 'F|' + CODE[k - 1], 0.15, 'svm-lab halo svm-code');
      const qS = xy(1.17, a + 17);                                               // beside the spoke (Vref often runs along it)
      label(labs, qS[0].toFixed(4), (qS[1] - 0.07).toFixed(4), `${2 * k + 5},${2 * k + 6}`, 0.17, true);
      text(labs, qS[0], qS[1] + 0.12, 'U|L ' + CODE[k - 1], 0.12, 'svm-lab halo svm-code');
      Q.keep.push(qS, [pL[0] + dL * c, pL[1] - dL * s], pS, pL);                // the region names keep clear of these
      if ((S.meta || {}).regions === 'stamp4') dot(xy(R3, a + 30), COL.m, 0.05, true);
    }
    dot([0, 0], COL.z, 0.06); label(labs, 0, 0.27, '0', fs, true);
    // key (top left, clear of the sector arcs): which length is which front-end state; Stamp's virtual medium vector
    const key = (x, y, html) => { const t = el('text', { x, y, 'dominant-baseline': 'central', class: 'svm-sec', 'font-size': 0.15 }, labs); t.innerHTML = html; };
    const Vs = (v, after) => `<tspan font-style="italic">V</tspan><tspan font-size="0.11" dy="0.04">${v}</tspan><tspan dy="-0.04">${after}</tspan>`;
    key(-2.85, -2.8, `F: 2${Vs('dc', '/3')}`);
    key(-2.85, -2.62, `U, L: ${Vs('dc', '/3')} (odd U, even L)`);
    if ((S.meta || {}).regions === 'stamp4') {
      dot([-2.8, -2.44], COL.m, 0.045, true);
      key(-2.7, -2.44, `(${Vs('k', ' + ')}${Vs('k+1', ')/2')}`);
    }
    const dyn = el('g', {}, svg); Q.dyn = dyn;
    Q.seq = el('polyline', { points: '', class: 'svm-seq' }, dyn);
    Q.now = el('circle', { r: 0.11, class: 'svm-now' }, dyn);
    Q.ref = el('path', { d: '', class: 'svm-ref' }, dyn);
    Q.refHead = el('path', { d: '', class: 'svm-refhead' }, dyn);
    Q.svg = svg;
    const rd = document.createElement('div'); rd.className = 'svm-read'; host.appendChild(rd); Q.read = rd;
  }

  // ------------------------------------------------------------ data
  const held = (f, x) => f.v[Math.max(lastLE(f.t, x), 0)];
  function stateAt(x) {                                   // -> {X, g: [S_a1, S_b1, S_c1], lv: [x_a, x_b, x_c] (-1/0/1)}
    const X = FR[held(Q.fns.fe, x)] || 'Z', g = ['g_Sa1', 'g_Sb1', 'g_Sc1'].map(n => held(Q.fns[n], x)), [hi, lo] = RAIL[X];
    return { X, g, lv: g.map(b => b ? hi : lo), key: X + '|' + g.join('') };
  }
  function prep() {
    Q.fns = {};
    for (const n of SIG) { const { t, v } = S.sig[n].data; Q.fns[n] = { t, v }; }
    // cumulative integrals of the phase levels (for the volt-second average): on the union of the state instants
    const ts = new Set(); for (const n of SIG.slice(0, 4)) for (const x of Q.fns[n].t) ts.add(x);
    const T = Float64Array.from([...ts].sort((p, q) => p - q)), C = [0, 1, 2].map(() => new Float64Array(T.length)), V = [[], [], []];
    for (let i = 0; i < T.length; i++) { const s = stateAt(T[i]).lv; for (let j = 0; j < 3; j++) V[j].push(s[j]); }
    for (let j = 0; j < 3; j++) for (let i = 1; i < T.length; i++) C[j][i] = C[j][i - 1] + V[j][i - 1] * (T[i] - T[i - 1]);
    Q.F = x => { const k = lastLE(T, x); return [0, 1, 2].map(j => k < 0 ? V[j][0] * (x - T[0]) : C[j][k] + V[j][k] * (x - T[k])); };
    Q.Tsp = S.meta.Tsp || 0;
    Q.a0 = S.t0;                                          // cv_export cuts the record on a carrier-period start
    const f = /([\d.]+)\s*Hz/.exec((S.meta.params || {}).f1 || ''); Q.f1 = f ? parseFloat(f[1]) : 0;
  }
  function avg(a, b) { const p = Q.F(a), q = Q.F(b); return vec(...[0, 1, 2].map(j => (q[j] - p[j]) / (b - a))); }
  function period(t) {
    const T = Q.Tsp, k = Math.floor((t - Q.a0) / T + 1e-9), a = Q.a0 + k * T, b = a + T;
    return (!(T > 0) || a < S.t0 - 1e-12 || b > S.t1 + 1e-9) ? null : { k, a, b };
  }
  // the period's segments [{t0, t1, st}] and its switching instants with the stage that switched
  function segments(a, b) {
    const ts = new Set([a, b]);
    for (const n of SIG.slice(0, 4)) { const f = Q.fns[n]; for (let i = Math.max(lastLE(f.t, a), 0); i < f.t.length && f.t[i] < b; i++) if (f.t[i] > a) ts.add(f.t[i]); }
    const xs = [...ts].sort((p, q) => p - q), segs = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      const st = stateAt(xs[i] + 1e-12);
      if (segs.length && segs[segs.length - 1].st.key === st.key) segs[segs.length - 1].t1 = xs[i + 1];
      else segs.push({ t0: xs[i], t1: xs[i + 1], st });
    }
    // commutations, counted as switch pairs: a front-end letter change moves one pair (U/L <-> F, U/L <-> Z) or both
    // (U <-> L, F <-> Z; the rails V_in+ and V_in- both move), a digit change one leg pair. The switching into the
    // period's first state (from the state just before a) belongs to this period, the one after b to the next.
    let nf = 0, nl = 0, nfi = 0;
    segs.forEach((s, j) => {
      const p = j ? segs[j - 1].st : (a > S.t0 + 1e-12 ? stateAt(a - 1e-12) : s.st), w = [];
      const df = (RAIL[p.X][0] !== RAIL[s.st.X][0]) + (RAIL[p.X][1] !== RAIL[s.st.X][1]);
      if (df) { w.push('front'); nf += df; nfi++; }
      for (let i = 0; i < 3; i++) if (p.g[i] !== s.st.g[i]) { w.push('abc'[i]); nl++; }
      s.who = w.length ? (w[0] === 'front' ? 'front' + (w.length > 1 ? '+' + w.slice(1).join('') : '') : 'leg ' + w.join('')) : '';
      s.wf = df; s.wl = w.filter(x => x !== 'front');
    });
    return { segs, nf, nl, nfi };
  }

  // ------------------------------------------------------------ cursor update
  function update() {
    if (!Q.ok || !Q.svg) return;
    const t = S.cur, P = period(t);
    if (!P) {
      Q.read.innerHTML = '<span class="k">no full period at the cursor</span>';
      Q.dyn.setAttribute('visibility', 'hidden'); Q.sector.setAttribute('points', ''); Q.region.setAttribute('points', '');
      for (let j = 1; j <= 6; j++) Q['sec' + j].classList.remove('on');
      Q.last = null; return;
    }
    Q.dyn.removeAttribute('visibility');
    const v = avg(P.a, P.b), m = Math.hypot(v[0], v[1]) / R3;
    const L = Math.hypot(v[0], v[1]), ux = v[0] / (L || 1), uy = v[1] / (L || 1), hl = Math.min(0.2, 0.6 * L), hw = 0.075;
    const bx = v[0] - ux * hl, by = v[1] - uy * hl;
    Q.ref.setAttribute('d', `M0,0L${bx.toFixed(4)},${by.toFixed(4)}`);
    Q.refHead.setAttribute('d', `M${v[0].toFixed(4)},${v[1].toFixed(4)}L${(bx - uy * hw).toFixed(4)},${(by + ux * hw).toFixed(4)}L${(bx + uy * hw).toFixed(4)},${(by - ux * hw).toFixed(4)}z`);
    const { segs, nf, nl } = segments(P.a, P.b);
    Q.seq.setAttribute('points', pts(segs.map(s => vec(...s.st.lv))));
    const sn = stateAt(t), pn = vec(...sn.lv);
    Q.now.setAttribute('cx', pn[0].toFixed(4)); Q.now.setAttribute('cy', pn[1].toFixed(4));
    const sec = held(Q.fns.sec, t), reg = held(Q.fns.reg, t), R = REG[S.meta.regions] || {};
    Q.sector.setAttribute('points', sec >= 1 && sec <= 6 ? pts([[0, 0], xy(2, 60 * (sec - 1)), xy(2, 60 * sec)]) : '');
    const poly = sec >= 1 && R[reg] ? R[reg].map(p => rot(p, 60 * (sec - 1))) : null;
    Q.region.setAttribute('points', poly ? pts(poly) : ''); Q.region.setAttribute('fill', poly ? (reg === 1 ? COL.reg : COL.regL) : 'none');
    for (let j = 1; j <= 6; j++) Q['sec' + j].classList.toggle('on', j === sec);
    if (Q.rsec !== sec) {
      Q.rsec = sec; Q.rnum.innerHTML = '';
      if (sec >= 1 && sec <= 6) for (const [n, pl] of Object.entries(R)) {
        // inside the (convex) region, the point farthest from the vector names and dots: centroid and its blends
        // towards every vertex
        const c = pl.reduce((a, v) => [a[0] + v[0] / pl.length, a[1] + v[1] / pl.length], [0, 0]);
        let best = c, bd = -1;
        for (const v of [c, ...pl]) for (const f of [0, 0.25, 0.45]) {
          const q = rot([c[0] + (v[0] - c[0]) * f, c[1] + (v[1] - c[1]) * f], 60 * (sec - 1));
          const dd = Math.min(...Q.keep.map(k => Math.hypot(q[0] - k[0], (q[1] - k[1]) * 1.6)));
          if (dd > bd + 1e-6) { bd = dd; best = q; }
        }
        text(Q.rnum, best[0], best[1], 'R' + n, 0.15, 'svm-sec');
      }
    }
    const th = (((Math.atan2(-v[1], v[0]) / D - 60 * (sec - 1)) % 360) + 360) % 360 % 60;   // angle in the modulator's sector
    const out = sn.lv.map(x => LET[String(x)]).join('');
    Q.last = { m, sec, th, reg: poly ? 'R' + reg : reg + ' (none)', st: sn.key, out, nf, nl };
    Q.read.innerHTML =
      `<span class="rd"><span class="k tex"><i>m</i><sub>a</sub></span><b>${m.toFixed(3)}</b></span>` +
      `<span class="rd"><span class="k">Sector</span><b>${sec}</b></span>` +
      `<span class="rd"><span class="k tex"><i>θ</i></span><b>${th.toFixed(1)}°</b></span>` +
      `<span class="rd"><span class="k">Region</span><b>${Q.last.reg}</b></span>` +
      `<span class="rd"><span class="k">State</span><b class="st">${sn.key}</b><span class="k">(${out})</span></span>` +
      `<span class="rd" style="white-space:nowrap"><span class="k">Pairs in <i>T</i><sub>sp</sub>: front</span><b>${nf}</b><span class="k">· legs</span><b>${nl}</b></span>`;
  }

  // ------------------------------------------------------------ the carrier period under the circuit
  const TSP_MIN = 170, TSP_GAP = 14;
  const CLS = { z: '#e4e6e9', u: '#e2f4f6', L: '#b7dde2', l: '#ece6f4' };      // tints of COL s (U light, L darker) / l
  const klass = st => { const u = new Set(st.lv); return u.size === 1 ? 'z' : st.X === 'F' ? 'l' : st.X === 'U' ? 'u' : 'L'; };
  const tspOn = () => (typeof window.tspSetting === 'function' ? window.tspSetting() : true);
  function tspPlace() {
    const box = document.getElementById('tsp'), host = document.getElementById('svghost'), svg = host && host.querySelector('svg');
    if (!box || !svg) return false;
    const fit = v => { svg.setAttribute('preserveAspectRatio', v); const lf = document.getElementById('liveflow'); if (lf) lf.setAttribute('preserveAspectRatio', v); };
    if (!(Q.ok && S.circ && tspOn())) return false;
    fit('xMidYMin meet');
    const vb = svg.viewBox.baseVal, hr = host.getBoundingClientRect(), cr = document.getElementById('circ').getBoundingClientRect();
    const drawH = Math.min(hr.height, hr.width * vb.height / vb.width), room = hr.height - drawH - TSP_GAP;
    if (room < TSP_MIN) { fit('xMidYMid meet'); box.hidden = true; return false; }
    const w = Math.min(hr.width, 760);
    Object.assign(box.style, { left: Math.round(hr.left - cr.left + (hr.width - w) / 2) + 'px', width: Math.round(w) + 'px',
      top: Math.round(hr.top - cr.top + drawH + TSP_GAP) + 'px', height: Math.round(Math.min(room, 380)) + 'px' });
    const was = box.hidden; box.hidden = false;
    if (was && window.logosPlace) setTimeout(window.logosPlace, 0);
    return true;
  }
  function tspMarkup(W, H) {
    const t = S.cur, P = period(t);
    if (!P) return null;
    const { segs } = segments(P.a, P.b);
    const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const ink = css('--ink') || '#16191d', ink3 = css('--ink-3') || '#87909a', rule = css('--hair') || '#d9dde2', cur = css('--cursor') || '#d0021b';
    const pc = ['--pa', '--pb', '--pc'].map((v, i) => css(v) || ['#1f5fbf', '#c0392b', '#2e8b57'][i]);
    const NAMEW = 48, TICKW = 50, X0 = NAMEW + TICKW, X1 = W - 14;
    // a few states: each gets at least MINW px (name and duration fit); many (Stamp's chattering NP choice, tens of
    // 1 us states): true time, names and durations only where they fit, the stage tags thinned out
    const span = X1 - X0, MINW = segs.length > 12 ? 0 : Math.min(50, span / segs.length);
    let wide = segs.map(() => false), wid;
    for (let it = 0; it <= segs.length; it++) {
      const fixed = wide.filter(Boolean).length, rest = segs.reduce((q, sg, j) => q + (wide[j] ? 0 : sg.t1 - sg.t0), 0);
      wid = segs.map((sg, j) => wide[j] ? MINW : (span - fixed * MINW) * (sg.t1 - sg.t0) / (rest || 1));
      const more = wid.map((w, j) => wide[j] || w < MINW);
      if (more.every((v, j) => v === wide[j])) break;
      wide = more;
    }
    segs.forEach((sg, j) => { sg.x0 = j ? segs[j - 1].x1 : X0; sg.x1 = sg.x0 + wid[j]; });
    const X = x => { const sg = segs.find(q => x >= q.t0 && x <= q.t1) || (x < P.a ? segs[0] : segs[segs.length - 1]);
      return sg.x0 + (Math.min(Math.max(x, sg.t0), sg.t1) - sg.t0) / ((sg.t1 - sg.t0) || 1) * (sg.x1 - sg.x0); };
    const DUR = 14, BOXY = DUR + 2, BOXH = 22, R0 = BOXY + BOXH + 10, BOT = 56;
    const MF = "'Times New Roman', Times, serif", UF = "'Segoe UI', Arial, sans-serif", surf = css('--surface') || '#ffffff';
    const out = [], math = `font-family="${MF}" font-style="italic"`;
    const us = v => v >= 1e-3 ? (v * 1e3).toFixed(2) + ' ms' : (v * 1e6).toFixed(v < 1e-6 ? 2 : v < 1e-5 ? 1 : 0) + ' µs';
    const kNow = segs.findIndex(s => t >= s.t0 && t < s.t1);
    segs.forEach((s, j) => {
      const x0 = X(s.t0), x1 = X(s.t1), w = x1 - x0;
      out.push(`<rect x="${x0.toFixed(1)}" y="${BOXY}" width="${w.toFixed(1)}" height="${BOXH}" fill="${CLS[klass(s.st)]}" stroke="${j === kNow ? ink : rule}" stroke-width="${j === kNow ? 1.6 : 1}"/>`);
      if (w >= 38) out.push(`<text x="${((x0 + x1) / 2).toFixed(1)}" y="${BOXY + BOXH / 2 + 4}" text-anchor="middle" font-family="${MF}" font-size="13" fill="${ink}">${s.st.X}|${s.st.g.join('')}</text>`);
      if (w >= 34) out.push(`<text x="${((x0 + x1) / 2).toFixed(1)}" y="${DUR - 3}" text-anchor="middle" font-family="${UF}" font-size="10" fill="${ink3}">${us(s.t1 - s.t0)}</text>`);
    });
    for (const s of segs.slice(1)) out.push(`<path d="M${X(s.t0).toFixed(1)} ${BOXY}V${(H - BOT + 4).toFixed(1)}" stroke="${ink3}" stroke-width="0.8" stroke-dasharray="2 3"/>`);
    const sub = (s, d) => `<tspan font-size="11" dy="4">${s}</tspan>` + (d ? `<tspan font-size="11" dy="-9">${d}</tspan>` : '');
    const frac = (n, d) => [`<tspan ${math}>${n}</tspan>`, `<tspan font-size="8" dy="3">dc</tspan>`, `<tspan dy="-3">/${d}</tspan>`].join('');
    const smax = Math.max(1, ...segs.map(s => Math.abs(s.st.lv[0] + s.st.lv[1] + s.st.lv[2])));
    // the internal rails, one row each (P / O and O / N): they move only when the front-end switches
    const rows = [{ name: 'V' + sub('in', '+'), lines: [[s => 2 * RAIL[s.st.X][0] - 1, ink]], ticks: [[1, 'P'], [-1, 'O']], pon: true },
      { name: 'V' + sub('in', '−'), lines: [[s => 2 * RAIL[s.st.X][1] + 1, ink]], ticks: [[1, 'O'], [-1, 'N']], pon: true }];
    ['a', 'b', 'c'].forEach((ph, i) => rows.push({ name: 'v' + sub(ph + 'O'), lines: [[s => s.st.lv[i], pc[i]]], fill: true,
      ticks: [[1, frac('V', 2)], [0, '0'], [-1, frac('−V', 2)]] }));
    rows.push({ name: 'v' + sub('CMV'), lines: [[s => (s.st.lv[0] + s.st.lv[1] + s.st.lv[2]) / smax, ink3]], fill: true,
      ticks: [[1, frac('V', 6 / smax)], [0, '0'], [-1, frac('−V', 6 / smax)]] });
    const rh = (H - R0 - BOT) / rows.length, pad = Math.max(6, rh * 0.2);
    rows.forEach((R, i) => {
      const y0 = R0 + i * rh, yz = y0 + rh / 2, amp = rh / 2 - pad, Y = v => yz - v * amp;
      out.push(`<text x="${NAMEW - 6}" y="${yz + 5}" text-anchor="end" ${math} font-size="16" fill="${ink}">${R.name}</text>`);
      for (const [v, lab] of R.ticks) out.push(`<text x="${X0 - 6}" y="${Y(v) + 4}" text-anchor="end" font-family="${R.pon ? MF : UF}" font-size="10" fill="${ink3}">${lab}</text>`);
      out.push(`<path d="M${X0} ${yz}H${X1}" stroke="${rule}" stroke-width="1"/>`);
      R.lines.forEach(([f, c, tag], li) => {
        let d = '', area = '';
        segs.forEach((s, j) => {
          const v = f(s), x0 = X(s.t0), x1 = X(s.t1), y = Y(v) + (R.lines.length > 1 ? (li ? 1.2 : -1.2) : 0);
          d += (j ? `L${x0.toFixed(1)} ${y.toFixed(1)}` : `M${x0.toFixed(1)} ${y.toFixed(1)}`) + `H${x1.toFixed(1)}`;
          if (v && R.fill) area += `M${x0.toFixed(1)} ${yz}V${y.toFixed(1)}H${x1.toFixed(1)}V${yz}Z`;
        });
        if (area) out.push(`<path d="${area}" fill="${c}" fill-opacity="0.16"/>`);
        out.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"${li ? ' stroke-dasharray="5 2.5"' : ''}/>`);
        if (tag) out.push(`<text x="${X1 + 2}" y="${(Y(f(segs[segs.length - 1])) + (li ? 9 : -3)).toFixed(1)}" font-family="${UF}" font-size="9" fill="${c}">${tag}</text>`);
      });
    });
    // which stage switched at every instant, one lane per stage (the period's first instant included: the switching
    // into its first state): front-end ticks (1 or 2 pairs: U <-> L moves both rails), leg ticks in the phase colours;
    // the pair counts of the period at the left of each lane
    const { nf, nl } = segments(P.a, P.b), yF = H - BOT + 10, yL = yF + 15, fcol = COL.l;
    out.push(`<text x="${X0 - 6}" y="${yF + 4}" text-anchor="end" font-family="${UF}" font-size="11" fill="${fcol}">front <tspan font-weight="700">${nf}</tspan></text>`,
      `<text x="${X0 - 6}" y="${yL + 4}" text-anchor="end" font-family="${UF}" font-size="11" fill="${ink}">legs <tspan font-weight="700">${nl}</tspan></text>`,
      `<path d="M${X0} ${yF}H${X1}M${X0} ${yL}H${X1}" stroke="${rule}" stroke-width="0.8"/>`);
    if (segs[0].wf) {                                                           // the switching into the first state
      const p = stateAt(P.a - 1e-12);
      out.push(`<text x="${X0 + 4}" y="${yF - 3}" font-family="${UF}" font-size="8.5" fill="${ink3}">from ${p.X}|${p.g.join('')}</text>`);
    }
    for (const s of segs) {
      const x = X(s.t0).toFixed(1);
      if (s.wf) out.push(`<path d="M${x} ${yF - 5}v10" stroke="${fcol}" stroke-width="${s.wf > 1 ? 3 : 1.6}"/>`);
      s.wl.forEach((ph, i) => out.push(`<circle cx="${x}" cy="${yL + (i - (s.wl.length - 1) / 2) * 4}" r="2.6" fill="${pc['abc'.indexOf(ph)]}"/>`));
    }
    const yb = H - 10;
    out.push(`<path d="M${X0} ${yb - 6}V${yb + 6}M${X1} ${yb - 6}V${yb + 6}M${X0 + 1} ${yb}H${X1 - 1}" stroke="${ink3}" stroke-width="1"/>`,
      `<path d="M${X0 + 1} ${yb}l6 -3v6zM${X1 - 1} ${yb}l-6 -3v6z" fill="${ink3}"/>`,
      `<rect x="${(X0 + X1) / 2 - 18}" y="${yb - 9}" width="36" height="18" fill="${surf}"/>`,
      `<text x="${(X0 + X1) / 2}" y="${yb + 5}" text-anchor="middle" ${math} font-size="15" fill="${ink}">T<tspan font-size="10" dy="3">sp</tspan></text>`);
    out.push(`<path d="M${X(t).toFixed(1)} ${BOXY - 2}V${(H - BOT + 4).toFixed(1)}" stroke="${cur}" stroke-width="1.2"/>`);
    return out.join('');
  }
  function tspDraw() {
    if (!tspPlace()) return;
    const box = document.getElementById('tsp'), W = box.clientWidth, H = box.clientHeight, m = tspMarkup(W, H);
    box.innerHTML = m === null ? '<div class="tsp-none">no full carrier period at the cursor</div>' :
      `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="carrier period at the cursor: states, rails and pole voltages">${m}</svg>`;
  }
  { let tm = 0; const c = document.getElementById('circ');
    if (c && window.ResizeObserver) new ResizeObserver(() => { clearTimeout(tm); tm = setTimeout(() => { if (Q.ok) tspDraw(); }, 80); }).observe(c); }

  // ------------------------------------------------------------ shared hooks: ours for snpc runs, svm.js's otherwise
  const prevTspSet = window.tspSetting, prevTspSnap = window.tspSnapshot, prevSvmSnap = window.svmSnapshot;
  window.svmAlt = { active: () => Q.ok };                                      // svm.js leaves the #tsp box to us
  if (typeof prevTspSet === 'function')
    window.tspSetting = function (on) { const r = prevTspSet(on); if (on !== undefined && Q.ok) tspDraw(); return r; };
  window.tspSnapshot = (x, y, w, h) => {
    if (!Q.ok) return prevTspSnap ? prevTspSnap(x, y, w, h) : '';
    const m = tspMarkup(w, h); return m === null ? '' : `<g transform="translate(${x.toFixed(2)},${y.toFixed(2)})">${m}</g>`;
  };
  window.tspSnapshot.shown = () => Q.ok ? !!(tspOn() && document.getElementById('tsp') && !document.getElementById('tsp').hidden)
    : !!(prevTspSnap && prevTspSnap.shown && prevTspSnap.shown());
  const shown = () => Q.ok && (typeof panelShown === 'function' ? panelShown('svm') : true);
  window.svmSnapshot = function (x, y, w, h) {
    if (!Q.ok) return prevSvmSnap ? prevSvmSnap(x, y, w, h) : '';
    if (!shown() || !Q.svg || !Q.last) return '';
    const RH = 30, side = Math.max(10, Math.min(w, h - RH)), ox = x + (w - side) / 2;
    const clone = Q.svg.cloneNode(true); inlineStyles(Q.svg, clone);
    const L = Q.last, ink = '#16191d', k = '#87909a', ui = "'Segoe UI', Arial, sans-serif", mf = "'Times New Roman', Times, serif";
    const it = (s, sb) => `<tspan font-family="${mf}" font-style="italic" font-size="17" fill="${k}">${s}</tspan>` +
      (sb ? `<tspan font-family="${mf}" font-size="12" dy="4" fill="${k}">${sb}</tspan><tspan dy="-4"> </tspan>` : ' ');
    const b = v => `<tspan font-weight="600" fill="${ink}">${v}</tspan>`, gap = '<tspan> </tspan>';
    const line = `${it('m', 'a')}${b(L.m.toFixed(3))}${gap}<tspan fill="${k}">Sector </tspan>${b(L.sec)}${gap}` +
      `${it('θ')}${b(L.th.toFixed(1) + '°')}${gap}<tspan fill="${k}">Region </tspan>${b(L.reg)}${gap}` +
      `<tspan fill="${k}">State </tspan>${b(L.st)}<tspan fill="${k}"> (${L.out})</tspan>${gap}<tspan fill="${k}">pair commutations: front </tspan>${b(L.nf)}<tspan fill="${k}"> legs </tspan>${b(L.nl)}`;
    return `<svg x="${ox.toFixed(2)}" y="${y.toFixed(2)}" width="${side.toFixed(2)}" height="${side.toFixed(2)}" viewBox="${Q.svg.getAttribute('viewBox')}">${clone.innerHTML}</svg>` +
      `<text x="${(x + w / 2).toFixed(2)}" y="${(y + side + 21).toFixed(2)}" text-anchor="middle" font-family="${ui}" font-size="15">${line}</text>`;
  };
  window.svmSnapshot.shown = () => Q.ok ? !!(shown() && Q.svg && Q.last) : !!(prevSvmSnap && prevSvmSnap.shown && prevSvmSnap.shown());

  // ------------------------------------------------------------ run changes: our own body in #svm next to svm.js's
  function hostEl() {
    if (Q.host && Q.host.isConnected) return Q.host;
    const svm = document.getElementById('svm'); if (!svm) return null;
    Q.host = document.createElement('div'); Q.host.id = 'svmsnpc'; Q.host.hidden = true;
    Object.assign(Q.host.style, { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' });
    svm.appendChild(Q.host); return Q.host;
  }
  function sync() {
    const host = hostEl(), body = document.getElementById('svmbody');
    if (host) { host.hidden = !Q.ok; host.style.display = Q.ok ? 'flex' : 'none'; }
    if (body) body.style.display = Q.ok ? 'none' : '';
    if (!Q.ok) return;
    if (typeof setPanelAvail === 'function') setPanelAvail('svm', true);
    document.documentElement.classList.add('has-svm');
    if (host && shown()) { if (!Q.svg || Q.svgRun !== S.run) { build(host); Q.svgRun = S.run; } update(); }
  }
  async function onRun() {
    const was = Q.ok; Q.run = S.run; Q.ok = false; Q.svg = null; Q.rsec = null;
    if ((S.meta || {}).svm === 'snpc' && SIG.every(n => S.sig[n] && S.sig[n].kind === 'step')) {
      try { await Promise.all(SIG.map(n => loadSig(n))); } catch (e) { /* not in this record */ }
      if (Q.run !== S.run) return;
      Q.ok = SIG.every(n => S.sig[n].data) && !!S.circ;
    }
    if (Q.ok) prep();
    sync();
    if (Q.ok) tspDraw();
    else if (was && window.tspRedraw) window.tspRedraw();                     // back to svm.js (it hides or redraws #tsp)
    if (typeof setLayout === 'function') setLayout();
    if (typeof redraw === 'function') redraw();
  }
  const dc = drawCursor;
  drawCursor = function () {
    dc.apply(this, arguments);
    if (S.run !== Q.run) { onRun(); return; }
    if (!Q.ok) return;
    if (shown()) { const host = hostEl(); if (!Q.svg && host) { build(host); Q.svgRun = S.run; } update(); }
    tspDraw();
  };
})();
