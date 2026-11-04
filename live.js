// CircuitView Live: the CircuitView app inside a PowerPoint slide (an Office content add-in, manifest.xml).
// The slide keeps its own data: the CV_EMBED payload of one view (export_html.payload, a '.cvlive' file made by the
// app's Export menu) is stored in the add-in's document settings, i.e. inside the .pptx. Whoever opens the file with
// this add-in gets the live view (cursor, zoom, edges, flowing arrows, Play); without it PowerPoint shows the snapshot.
//   no data yet -> a picker for a .cvlive file;  data -> app.js + snapshot.js start on it (window.CV_EMBED)
// A .cvlive of kind 'page' carries one self-contained HTML page instead (an interactive course demo): bootPage.
// Outside Office (a plain browser tab) the picker works too, without saving (for testing the page).
'use strict';
(function () {
  const KEY = 'circuitview', FMT = 'circuitview-live/1', WKEY = 'circuitview.window';
  const WIN = new URLSearchParams(location.search).has('window');   // this page is the view's own window (windowButton)
  const $ = s => document.querySelector(s);
  let settings = null;

  function load(src) {
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error(src)); document.body.appendChild(s); });
  }
  const say = (m, bad) => typeof toast === 'function' ? toast(m, bad) : console.warn(m);   // app.js's toast, absent on a page
  // A .cvlive is either a CircuitView view (run + circuit, app.js draws it) or an interactive page (kind 'page': one
  // self-contained HTML document, e.g. a course demo). Both live in the slide's settings the same way.
  const isPage = d => !!(d && d.format === FMT && d.kind === 'page' && typeof d.html === 'string');
  const boot = d => isPage(d) ? bootPage(d) : bootView(d);
  // ---- an interactive page: shown in a frame over the whole slide. The frame keeps the add-in's origin (the user's
  // decision, 2026-11-03): with an opaque origin the frame ran out of process and PowerPoint's web view showed no mouse
  // pointer over it. So a page can reach the add-in: load only .cvlive files you made yourself. The sandbox still
  // blocks navigation, pop-ups and forms. <html data-host="slide"> tells the page that it sits in a slide frame.
  function bootPage(d) {
    window.CV_EMBED = d;
    $('#livepick').hidden = true;
    document.documentElement.classList.add('cv-page');
    const f = document.createElement('iframe'); f.id = 'livepage'; f.title = d.title || 'interactive page';
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock');
    const mark = '<script>document.documentElement.setAttribute("data-host","slide")<\/script>';
    f.srcdoc = /<head[^>]*>/i.test(d.html) ? d.html.replace(/<head[^>]*>/i, m => m + mark) : mark + d.html;
    document.body.appendChild(f);
    const bar = document.createElement('div'); bar.id = 'livepagebar';
    if (WIN) bar.appendChild(fullButton());
    else { const w = windowButton(); if (w) bar.appendChild(w); bar.appendChild(replaceButton()); }
    document.body.appendChild(bar);
    drawnPointer(document);
    f.addEventListener('load', () => { try { drawnPointer(f.contentDocument); } catch (e) { /* frame not reachable */ } });
    return Promise.resolve();
  }
  // ---- PowerPoint's web view shows no mouse pointer over an interactive page (the user saw it vanish over the frame,
  // in edit view too). Each document draws its own arrow at the mouse position and hides the system one, so the
  // pointer is always visible and never doubled.
  const ARROW = '<svg width="20" height="24" viewBox="0 0 20 24" aria-hidden="true"><path d="M2 2 L2 19 L6.5 15 L9.5 22 L12.5 20.7 L9.6 14 L15.5 14 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  function drawnPointer(doc) {
    if (!doc || !doc.body || doc.getElementById('cvptr')) return;
    const st = doc.createElement('style');
    st.textContent = 'html, html * { cursor: none !important; } #cvptr { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; ' +
      'width: 20px; height: 24px; margin: -1px 0 0 -1px; will-change: transform; } #cvptr[hidden] { display: none; }';
    doc.head ? doc.head.appendChild(st) : doc.body.appendChild(st);
    const p = doc.createElement('div'); p.id = 'cvptr'; p.hidden = true; p.innerHTML = ARROW;
    doc.body.appendChild(p);
    const at = e => { p.hidden = false; p.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; };
    doc.addEventListener('pointermove', at, { passive: true, capture: true });
    doc.addEventListener('pointerdown', at, { passive: true, capture: true });
    doc.documentElement.addEventListener('pointerleave', () => { p.hidden = true; });
  }
  async function bootView(emb) {
    window.CV_EMBED = emb;
    $('#livepick').hidden = true;
    try { if (localStorage.getItem('circuitview.details') === null) localStorage.setItem('circuitview.details', 'false'); } catch (e) { /* no storage */ }   // a slide starts with the waveforms, Details folded
    for (const f of ['app.js', 'snapshot.js', 'video.js', 'svm.js', 'brand.js']) await load(f);   // in order (build.py APP_JS)
    slideLayout();
    lighter();
    addPlay();
    hud();
    for (let k = 0; k < 200 && !(S.meta && S.circ); k++) await new Promise(r => setTimeout(r, 50));
    flowLayer();
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
  // Details open every move (its numbers). Arrowheads advance at most 50 frames/s (a 100 Hz screen: every 2nd frame).
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
      if (ts - ran < 18) { FLOW.raf = requestAnimationFrame(flowTick); return; }
      ran = ts; tick(ts);
    };
  }
  // ---- Slide Show passes the add-in's picture through a slower path: every moved arrowhead used to repaint the whole
  // circuit drawing. The arrowheads go to their own SVG on top (same viewBox, own compositing layer), so per frame
  // only the small heads are painted; the circuit is painted again only when drawCircuit rebuilds it. The heads are
  // kept clear of the symbols (app.js keep zones), so lying above the symbol layer changes nothing visible.
  function flowLayer() {
    const C = S.circ, host = $('#svghost'); if (!C || !host) return;
    const top = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); top.id = 'liveflow';
    host.appendChild(top);
    let items = null;
    const move = () => {
      top.setAttribute('viewBox', C.svg.getAttribute('viewBox')); top.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      if (FLOW.items === items) return;                           // lighter() kept the drawing: the heads stay where they are
      items = FLOW.items;
      const g = C.ov.querySelector(':scope > .cv-flow-layer');
      if (g) top.replaceChildren(g); else top.replaceChildren();
    };
    const draw = drawCircuit;
    drawCircuit = function () { const r = draw.apply(this, arguments); move(); return r; };
    const group = circuitGroup;
    circuitGroup = function (x, y, w, h, moving) {                // a video frame keeps the heads: put them back for the copy
      const g = moving && top.firstElementChild;
      if (g) C.ov.appendChild(g);
      try { return group.apply(this, arguments); } finally { if (g && g.isConnected && FLOW.items === items) top.appendChild(g); }
    };
    move();
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
  function valid(d) { return isPage(d) || !!(d && d.format === FMT && d.json && d.text && d.arr); }

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
      } catch (err) { say(String(err.message || err), true); }
    };
    return b;
  }

  // ---- Slide Show shows a content add-in through a slow path (measured: the page draws 100 frames/s, the screen
  // shows far fewer; the edit view at the same zoom is smooth). 'Window' opens the same view in its own window (Office
  // dialog), which the slide show does not pass through. The window gets the slide's data through localStorage
  // (same site) or, if that is empty, in pieces from the slide (DialogApi 1.2 messageChild).
  const CHUNK = 200000;
  function windowButton() {
    if (!(window.Office && Office.context && Office.context.ui && Office.context.ui.displayDialogAsync)) return null;
    const b = document.createElement('button'); b.id = 'livewin'; b.title = 'open this view in its own window: smooth in Slide Show';
    b.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 4.5v-3h3M10.5 4.5v-3h-3M1.5 7.5v3h3M10.5 7.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>Window';
    b.onclick = () => {
      const d = window.CV_EMBED, txt = JSON.stringify(d);
      try { localStorage.setItem(WKEY, txt); } catch (e) { /* too large or no storage: messageChild below */ }
      const url = location.href.split(/[?#]/)[0] + '?window=1';
      Office.context.ui.displayDialogAsync(url, { width: 90, height: 90, displayInIframe: false }, r => {
        if (r.status !== 'succeeded') return say('the window could not open: ' + (r.error && r.error.message || r.status), true);
        const dlg = r.value;
        dlg.addEventHandler(Office.EventType.DialogMessageReceived, a => {
          if (a.message !== 'ready') return;
          const n = Math.ceil(txt.length / CHUNK);
          for (let k = 0; k < n; k++) dlg.messageChild(JSON.stringify({ n, k, s: txt.slice(k * CHUNK, (k + 1) * CHUNK) }));
        });
      });
    };
    return b;
  }
  // inside the window: full screen on the window's own monitor (Esc leaves it)
  function fullButton() {
    const b = document.createElement('button'); b.id = 'livefull'; b.title = 'full screen (Esc to leave)';
    b.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 4.5v-3h3M10.5 4.5v-3h-3M1.5 7.5v3h3M10.5 7.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>Full screen';
    b.onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(e => say(String(e.message || e), true));
    return b;
  }
  function windowStart() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(WKEY)); localStorage.removeItem(WKEY); } catch (e) { d = null; }
    if (valid(d)) return boot(d);
    const parts = []; let got = 0;
    Office.context.ui.addHandlerAsync(Office.EventType.DialogParentMessageReceived, a => {
      const m = JSON.parse(a.message);
      if (parts[m.k] === undefined) { parts[m.k] = m.s; got++; }
      if (got === m.n) { const v = JSON.parse(parts.join('')); if (valid(v)) boot(v); else picker('the view did not arrive'); }
    }, () => Office.context.ui.messageParent('ready'));
  }

  // ---- Play: the cursor sweeps the view (about 1.5 s per switching state, as the video), arrowheads keep flowing
  function addPlay() {
    const bar = $('#bar'); if (!bar) return;
    if ($('#play')) {                                                                       // the app's own Play (video.js): only Window / Replace here
      if (WIN) bar.insertBefore(fullButton(), $('#xport'));
      else { const w = windowButton(); if (w) bar.insertBefore(w, $('#xport')); bar.insertBefore(replaceButton(), $('#xport')); }
      return;
    }
    const p = document.createElement('button'); p.id = 'liveplay'; p.className = 'tog'; p.setAttribute('aria-pressed', 'false');
    p.title = 'sweep the cursor across the view'; p.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2v8l6-4z"/></svg>Play';
    bar.insertBefore(p, bar.firstChild);                                                     // Play leads; Window or Replace beside Export
    if (WIN) bar.insertBefore(fullButton(), $('#xport'));
    else { const w = windowButton(); if (w) bar.insertBefore(w, $('#xport')); bar.insertBefore(replaceButton(), $('#xport')); }
    let raf = 0, last = 0;
    const stop = () => { cancelAnimationFrame(raf); raf = 0; p.setAttribute('aria-pressed', 'false'); FLOW.last = 0; flowStart(); };
    const tick = ts => {
      if (last && ts - last < 18) { raf = requestAnimationFrame(tick); return; }   // at most 50 frames/s, as the arrowheads
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
  if (window.Office && Office.onReady) Office.onReady(info => {
    if (WIN && Office.context.ui && Office.context.ui.messageParent) { document.documentElement.classList.add('cv-window'); windowStart(); }
    else if (info.host) { settings = Office.context.document.settings; start(); } else test();
  });
  else test();
})();
