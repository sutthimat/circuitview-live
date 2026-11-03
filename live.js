// CircuitView Live: the CircuitView app inside a PowerPoint slide (an Office content add-in, manifest.xml).
// The slide keeps its own data: the CV_EMBED payload of one view (export_html.payload, a '.cvlive' file made by the
// app's Export menu) is stored in the add-in's document settings, i.e. inside the .pptx. Whoever opens the file with
// this add-in gets the live view (cursor, zoom, edges, flowing arrows, Play); without it PowerPoint shows the snapshot.
//   no data yet -> a picker for a .cvlive file;  data -> app.js + snapshot.js start on it (window.CV_EMBED)
// Outside Office (a plain browser tab) the picker works too, without saving (for testing the page).
'use strict';
(function () {
  const KEY = 'circuitview', FMT = 'circuitview-live/1';
  const $ = s => document.querySelector(s);
  let settings = null;

  function load(src) {
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error(src)); document.body.appendChild(s); });
  }
  async function boot(emb) {
    window.CV_EMBED = emb;
    $('#livepick').hidden = true;
    try { if (localStorage.getItem('circuitview.details') === null) localStorage.setItem('circuitview.details', 'false'); } catch (e) { /* no storage */ }   // a slide starts with the waveforms, Details folded
    await load('app.js'); await load('snapshot.js'); await load('video.js');
    slideLayout();
    lighter();
    addPlay();
    hud();
    for (let k = 0; k < 200 && !(S.meta && S.circ); k++) await new Promise(r => setTimeout(r, 50));
    caption();
    redraw();
  }
  // ---- a slide frame is small: wider circuit column, every waveform row fitted into the pane (nobody scrolls in a talk)
  function slideLayout() {
    const base = setLayout;
    setLayout = function () {                                     // app.js calls it at the start of every redraw
      base();
      const root = document.documentElement;
      if (root.classList.contains('lay-tall')) root.style.setProperty('--circw', Math.round(0.52 * innerWidth) + 'px');
      const host = $('#rows'), avail = host && host.clientHeight - 2, rows = S.rows.filter(r => r.el);
      if (!avail || !rows.length) return;
      const want = rows.map(defaultH), sum = want.reduce((a, b) => a + b, 0);
      rows.forEach((r, j) => { r.h = Math.max(minH(r), Math.floor(want[j] * avail / sum)); r.el.row.style.height = r.h + 'px'; });
    };
  }
  // ---- PowerPoint's web view (full screen in Slide Show above all) is slower than a browser: per cursor move the
  // app rebuilds the whole drawing (~5-13 ms here, several times that in the slide). Rebuild only when what it shows
  // changes: a leg state or a current direction, the flow switch, or 250 ms passed (path widths follow |i|); with
  // Details open every move (its numbers). Arrowheads advance at 30 frames/s instead of the screen rate.
  function lighter() {
    const full = drawCircuit;
    let key = '', at = 0;
    const sgn = n => { const v = valueAt(n, S.cur); return v > 0 ? '+' : v < 0 ? '-' : '0'; };
    drawCircuit = function () {
      const C = S.circ;
      if (!C || !S.meta) return full();
      const k = C.legs.map(L => { const s = legState(L, S.cur); return s.key + s.sign; }).join('|') + (FLOW.on ? 'F' : 'S') +
        [...(C.J.caps || []), ...(C.J.srcs || [])].map(c => sgn(c.i)).join('');
      const now = performance.now(), open = !$('#infobox').classList.contains('collapsed');
      if (k === key && !open && now - at < 250) return;
      key = k; at = now; full();
    };
    const tick = flowTick; let ran = 0;
    flowTick = function (ts) {
      if (ts - ran < 32) { FLOW.raf = requestAnimationFrame(flowTick); return; }
      ran = ts; tick(ts);
    };
  }
  // ---- TEMPORARY diagnostic line in the bar (slide show lag / blur): CSS size and pixel ratio of the frame, screen
  // frames per second and the longest frame of the last second, JS time per cursor draw, the graphics renderer
  function hud() {
    const el = document.createElement('span'); el.id = 'livehud'; $('#bar').appendChild(el);
    let gpu = '?';
    try {
      const g = document.createElement('canvas').getContext('webgl'), x = g && g.getExtension('WEBGL_debug_renderer_info');
      gpu = !g ? 'no WebGL' : x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
    } catch (e) { gpu = 'err'; }
    gpu = String(gpu).replace(/^ANGLE \(|\)$/g, '').replace(/Direct3D.*$/, '').slice(0, 40);
    const dc = drawCursor; let js = 0, jn = 0;
    drawCursor = function () { const a = performance.now(); dc.apply(this, arguments); js += performance.now() - a; jn++; };
    let n = 0, t0 = 0, prev = 0, worst = 0;
    const loop = ts => {
      if (prev) worst = Math.max(worst, ts - prev);
      prev = ts; n++;
      if (!t0) t0 = ts;
      if (ts - t0 >= 1000) {
        el.textContent = `${innerWidth}×${innerHeight} @${devicePixelRatio.toFixed(2)} · ${Math.round(n * 1000 / (ts - t0))} fps · worst ${Math.round(worst)} ms · draw ${jn ? (js / jn).toFixed(1) : '-'} ms ×${jn} · ${gpu}`;
        n = 0; t0 = ts; worst = 0; js = 0; jn = 0;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  // the case (method, m_a, φ) in the Details header, so a slide says what it shows
  function caption() {
    const lab = $('#infohead > span:not(#infosum)'); if (!lab || !S.meta) return;
    const t = prettyText(S.meta.title).replace(/\\_/g, '_').replace(/\b(alpha|beta|gamma|delta|Delta|theta|phi|omega|tau)\b/g, w => GREEK[w]);
    lab.innerHTML = esc(t).replace(/\b([A-Za-z])_([A-Za-z0-9]{1,3})\b/g, '<span class="tex"><i>$1</i><sub>$2</sub></span>');
    lab.id = 'livecap'; $('#infohead').title = 'show or hide the details';
  }
  function valid(d) { return d && d.format === FMT && d.json && d.text && d.arr; }

  // ---- picker: a .cvlive file (drop or choose)
  function picker(msg) {
    const box = $('#livepick'); box.hidden = false;
    if (msg) $('#livemsg').textContent = msg;
    const take = async f => {
      try {
        const d = JSON.parse(await f.text());
        if (!valid(d)) throw new Error('not a CircuitView Live file (.cvlive)');
        if (settings) {
          settings.set(KEY, d);
          await new Promise((ok, no) => settings.saveAsync(r => r.status === 'succeeded' ? ok() : no(new Error(r.error && r.error.message || 'the slide could not store the view'))));
        }
        await boot(d);
      } catch (e) { $('#livemsg').textContent = String(e.message || e); }
    };
    $('#livefile').onchange = e => { if (e.target.files[0]) take(e.target.files[0]); };
    box.ondragover = e => { e.preventDefault(); box.classList.add('over'); };
    box.ondragleave = () => box.classList.remove('over');
    box.ondrop = e => { e.preventDefault(); box.classList.remove('over'); if (e.dataTransfer.files[0]) take(e.dataTransfer.files[0]); };
  }
  // the slide's own control: 'Replace' (another .cvlive) next to the toolbar
  function replaceButton() {
    const b = document.createElement('button'); b.id = 'livereplace'; b.textContent = 'Replace'; b.title = 'load another CircuitView view (.cvlive) into this slide';
    b.onclick = () => { $('#livefile').value = ''; $('#livefile').click(); };
    $('#livefile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const d = JSON.parse(await f.text()); if (!valid(d)) throw new Error('not a CircuitView Live file (.cvlive)');
        if (settings) { settings.set(KEY, d); await new Promise(ok => settings.saveAsync(ok)); }
        location.reload();                                        // app.js reads CV_EMBED once: start again on the new data
      } catch (err) { toast(String(err.message || err), true); }
    };
    return b;
  }

  // ---- Play: the cursor sweeps the view (about 1.5 s per switching state, as the video), arrowheads keep flowing
  function addPlay() {
    const bar = $('#bar'); if (!bar) return;
    const p = document.createElement('button'); p.id = 'liveplay'; p.className = 'tog'; p.setAttribute('aria-pressed', 'false');
    p.title = 'sweep the cursor across the view'; p.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2v8l6-4z"/></svg>Play';
    bar.insertBefore(p, bar.firstChild); bar.insertBefore(replaceButton(), $('#xport'));   // Play leads; Replace beside Export
    let raf = 0, last = 0;
    const stop = () => { cancelAnimationFrame(raf); raf = 0; p.setAttribute('aria-pressed', 'false'); FLOW.last = 0; flowStart(); };
    const tick = ts => {
      if (last && ts - last < 32) { raf = requestAnimationFrame(tick); return; }   // 30 frames/s, as the arrowheads
      const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0; last = ts;
      const [a, b] = S.view, secs = typeof videoSeconds === 'function' ? videoSeconds() : 10;
      S.cur += (b - a) * dt / secs; if (S.cur > b) S.cur = a;
      drawCursor();
      if (FLOW.raf) { cancelAnimationFrame(FLOW.raf); FLOW.raf = 0; }
      for (const it of FLOW.items) FLOW.phase[it.id] = ((FLOW.phase[it.id] || 0) + it.v * dt) % FLOW_GAP;
      flowPlace();
      raf = requestAnimationFrame(tick);
    };
    p.onclick = () => {
      if (raf) return stop();
      if (!FLOW.on) setFlow(true);
      if (S.cur < S.view[0] || S.cur >= S.view[1]) S.cur = S.view[0];
      last = 0; p.setAttribute('aria-pressed', 'true'); raf = requestAnimationFrame(tick);
    };
    addEventListener('pointerdown', e => { if (raf && !p.contains(e.target)) stop(); }, true);
  }

  const start = () => {
    const d = settings && settings.get(KEY);
    if (valid(d)) boot(d).catch(e => picker('This slide\'s view could not be opened: ' + (e.message || e)));
    else picker();
  };
  // outside Office only (testing the page in a browser): ?cvlive=<url> opens that file instead of the picker
  const test = () => {
    const u = new URLSearchParams(location.search).get('cvlive');
    if (!u) return start();
    fetch(u).then(r => r.json()).then(d => { if (!valid(d)) throw new Error('not a .cvlive'); return boot(d); }).catch(e => picker(String(e.message || e)));
  };
  if (window.Office && Office.onReady) Office.onReady(info => { if (info.host) { settings = Office.context.document.settings; start(); } else test(); });
  else test();
})();
