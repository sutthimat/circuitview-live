/* Institution logos (Chiang Mai University; Department of Electrical Engineering, CMU) on the circuit sheet.
   They go in the first free corner of the sheet (bottom left, bottom right, top left, top right), as large as fits
   between HMIN and HMAX px (at most HREL of the drawing's height, so a small drawing keeps small logos), never over the
   drawing's ink, the legend or the hover header; no corner free -> hidden.
   Viewer only: export_html.py and the Live build drop this script. */
(() => {
  // [file, width/height, name, height scale: the department mark has more white space, so it is drawn a little taller]
  const LOGOS = [['brand/cmu.png', 272 / 115, 'Chiang Mai University', 1],
                 ['brand/ee_cmu.png', 297 / 138, 'Department of Electrical Engineering, Chiang Mai University', 1.12]];
  const HMAX = 56, HMIN = 26, HREL = 0.11, SEP = 15, PAD = 12, EDGE = 16, TOP = 44, LEG = 14;   // TOP: clear of the hover header
  const circ = document.getElementById('circ'), host = document.getElementById('svghost'), legend = document.getElementById('legend');
  if (!circ || !host) return;
  const box = document.createElement('div');
  box.id = 'logos'; box.hidden = true; box.setAttribute('role', 'img');
  box.setAttribute('aria-label', LOGOS.map(l => l[2]).join('; '));
  LOGOS.forEach(([src, , alt], k) => {
    if (k) { const s = document.createElement('span'); s.className = 'sep'; box.appendChild(s); }
    const im = document.createElement('img'); im.src = src; im.alt = ''; im.draggable = false; box.appendChild(im);
  });
  circ.appendChild(box);
  const aspect = LOGOS.reduce((s, l) => s + l[1] * l[3], 0), hmul = Math.max(...LOGOS.map(l => l[3]));

  // ink of the drawing and the legend, in page px; sheet-sized backgrounds are not ink. A long unfilled stroke (a wire,
  // a conduction path round a corner) is ink only along its length, so it is sampled every 3 px, not taken as its box.
  function occupied() {
    const svg = host.querySelector('svg'), out = [];
    if (!svg) return out;
    const S = svg.getBoundingClientRect(), big = 0.4 * S.width * S.height;
    for (const e of svg.querySelectorAll('path, line, polyline, polygon, rect, circle, ellipse, text, image, use')) {
      const b = e.getBoundingClientRect();
      if (!(b.width || b.height) || b.width * b.height >= big) continue;
      const stroke = /^(path|line|polyline)$/.test(e.tagName) && getComputedStyle(e).fill === 'none';
      if (!stroke || (b.width < 40 && b.height < 40) || !e.getTotalLength) { out.push(b); continue; }
      const M = e.getScreenCTM();
      if (!M) { out.push(b); continue; }
      const len = e.getTotalLength(), k = Math.hypot(M.a, M.b) || 1, n = Math.ceil(len * k / 3);
      const pt = svg.createSVGPoint();
      for (let i = 0; i <= n; i++) {
        const p = e.getPointAtLength(len * i / n); pt.x = p.x; pt.y = p.y;
        const q = pt.matrixTransform(M); out.push({ left: q.x - 2, right: q.x + 2, top: q.y - 2, bottom: q.y + 2 });
      }
    }
    let lo = Infinity, hi = -Infinity;
    for (const b of out) { if (b.top < lo) lo = b.top; if (b.bottom > hi) hi = b.bottom; }
    out.inkH = out.length ? hi - lo : 0;
    if (legend) for (const e of legend.children) { const b = e.getBoundingClientRect(); if (b.width) out.push(b); }
    const tsp = document.getElementById('tsp');                     // the sampling period under the drawing (svm.js)
    if (tsp && !tsp.hidden) out.push(tsp.getBoundingClientRect());
    return out;
  }
  function place() {
    box.hidden = true;
    try { fit(); } catch (e) { box.hidden = true; }
  }
  function fit() {
    if (circ.hidden || !host.querySelector('svg')) return;
    const C = circ.getBoundingClientRect(), occ = occupied();
    const floor = legend ? Math.min(C.bottom, legend.getBoundingClientRect().top) - LEG : C.bottom - EDGE;
    const hit = (x0, y0, x1, y1) => occ.some(b => b.right > x0 - PAD && b.left < x1 + PAD && b.bottom > y0 - PAD && b.top < y1 + PAD);
    for (let h = Math.min(HMAX, 2 * Math.floor(HREL * occ.inkH / 2)); h >= HMIN; h -= 2) {
      const w = h * aspect + SEP, hh = h * hmul, L = C.left + EDGE, R = C.right - EDGE - w, T = C.top + TOP, B = floor - hh;
      for (const [x, y] of [[L, B], [R, B], [L, T], [R, T]]) {
        if (x < L || y < T || x + w > C.right - EDGE || y + hh > floor || hit(x, y, x + w, y + hh)) continue;
        box.style.left = Math.round(x - C.left) + 'px'; box.style.top = Math.round(y - C.top) + 'px';
        box.querySelectorAll('img').forEach((im, k) => { im.style.height = Math.round(h * LOGOS[k][3]) + 'px'; });
        box.hidden = false; return;
      }
    }
  }
  // after the layout settles: a new circuit, a panel shown or hidden, a splitter drag, the window resized
  // placed again 0.9 s after the last change: a page still laying out (an exported file opening, a slow first paint,
  // a headless capture) can measure the drawing before its final size (Anwa trial: logos over the P rail)
  let tm = 0, tm2 = 0;
  const later = () => { clearTimeout(tm); clearTimeout(tm2); tm = setTimeout(place, 120); tm2 = setTimeout(place, 900); };
  const ro = new ResizeObserver(later); ro.observe(circ); ro.observe(host);
  const mo = new MutationObserver(later); mo.observe(host, { childList: true });
  if (legend) { mo.observe(legend, { childList: true }); ro.observe(legend); }   // the legend may wrap to two lines
  if (typeof setLayout === 'function') { const base = setLayout; window.setLayout = function () { const r = base.apply(this, arguments); later(); return r; }; }
  if (document.fonts) document.fonts.ready.then(later);
  window.addEventListener('load', later);
  later();
  window.logosPlace = place;
})();
