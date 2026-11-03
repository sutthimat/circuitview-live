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
    addPlay();
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
