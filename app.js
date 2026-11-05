// CircuitView: generic viewer. Per circuit: circuits/<name>/circuit.svg (device elements with ids) and circuit.json
// (legs, gates, conduction table, anchors of the current paths). Per run: runs/<id>.npz (circuitview-run/1).
// Layout: every waveform row, the time axis (#axis) and the overview (#over) are flex rows
//   [ .lab (CSS --labw) | .plot (flex) ] and #rows keeps a fixed scrollbar gutter that #axis/#over mirror with
//   padding-right = --sbw (measured in syncGutter), so all plot canvases share the same x-extent to the pixel.
// Row label column: [ .tools (+ signal / remove) | .chips (name + live value) | .yax (y tick labels) ].
'use strict';
const $ = s => document.querySelector(s);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const PALETTE = ['#1d1d1f', '#e07b00', '#7b3fb5', '#0f8a8a', '#8a6d3b', '#d0021b'];
const PHASE = { a: '--pa', b: '--pb', c: '--pc', d: '--pd', e: '--pe', f: '--pf' };
// leg colours: a CSS variable of the page (circuit.json 'color': '--pa' ...) or a colour; never an invalid colour
const LEG_FALLBACK = ['#1f5fbf', '#c0392b', '#2e8b57', '#a8661c', '#6b4fa0', '#1f7f86'];
function legColor(L) { const v = L.color || '', c = v.startsWith('--') ? css(v) : v; return c || LEG_FALLBACK[L.i % LEG_FALLBACK.length]; }
// conduction style variant: ?style=A (phase-tinted) | B (ink + single accent) | C (spotlight, default)
const CV_STYLE = (/^[ABC]$/i.exec(new URLSearchParams(location.search).get('style') || '') || ['C'])[0].toUpperCase();
document.documentElement.dataset.cvStyle = CV_STYLE;
// the capacitor charge arrow (shaft + open head) as a small inline icon, the same glyph as on the drawing
const CHG_SVG = dir => `<svg class="chg" viewBox="0 0 8 10" aria-hidden="true"><path d="${dir === 'up' ? 'M4 9.2V1M1.4 3.6 4 1l2.6 2.6' : 'M4 .8V9M1.4 6.4 4 9l2.6-2.6'}"/></svg>`;
// legend items: [swatch kind, colour token, text with optional {O} = the neutral-point letter in math]; the HTML legend
// and the snapshot SVG (snapshot.js) are both drawn from this list
function legendItems(J) {
  const np = (/(\S+)$/.exec(J.np_label || '') || [])[1];                 // 'the dc midpoint O' -> O
  return [['line', '--dev-off', 'gate off'], ['line', '--dev-on', 'gate on, not conducting'],
    [CV_STYLE === 'B' ? 'line' : 'phases', '--cond-ink', 'conducting'],
    ...(J.np_node ? [['ring', '--gold', np ? 'through {' + np + '}' : 'through the neutral point']] : []),
    ...((J.srcs || []).length ? [['arrow', '--dc', 'dc current']] : []),
    ...((J.caps || []).length ? [['line', '--gold', J.np_node && np ? 'current at {' + np + '}' : 'capacitor current'], ['chg', '--np-ink', 'charging / discharging']] : []),
    ['iref', '--ink-2', 'direction of {i_x} at the cursor (> 0: as drawn)'],          // the i_x arrows beside the output wires
    ['note', '', 'width ∝ |{i}|']];
}
function legendHTML(J) {
  const sw = { line: c => `<i class="sw-line" style="background:var(${c})"></i>`, phases: () => '<i class="sw-phases"></i>', ring: () => '<i class="sw-ring"></i>',
    arrow: () => '<svg class="sw-flow" viewBox="0 0 18 8" aria-hidden="true"><path d="M0 4h13"/><path class="hd" d="M17.5 4 12 .8 13.4 4 12 7.2Z"/></svg>',
    chg: () => CHG_SVG('up') + CHG_SVG('down'), note: () => '',
    iref: () => '<svg class="sw-iref" viewBox="0 0 18 8" aria-hidden="true"><path d="M1 4h10.5"/><path class="hd" d="M17.5 4 10.6.7c.9 2.1.9 4.5 0 6.6Z"/></svg>' };
  const txt = t => esc(t).replace(/\{([^}_]*)(?:_([^}]*))?\}/g, (m, b, s) => `<span class="tex"><i>${b}</i>${s ? `<sub>${s}</sub>` : ''}</span>`);
  return legendItems(J).map(([k, c, t]) => `<span>${sw[k](c)}${txt(t)}</span>`).join('');
}

const S = {
  runs: [], run: null, meta: null, sig: {}, arr: {}, circ: null, circName: null,
  t0: 0, t1: 1, view: [0, 1], cur: 0, rows: [], edges: null, imax: 1,
};
// ---------------------------------------------------------------- data
// A self-contained export (export_html.py) carries its data in window.CV_EMBED instead of asking the server:
// json[url], text[url], arr[key] (gzip + base64 float64), state (the view to open)
const EMB = window.CV_EMBED || null;
async function getJSON(u) {
  if (EMB) { if (!(u in EMB.json)) throw new Error(u + ' is not in this file'); return JSON.parse(JSON.stringify(EMB.json[u])); }
  const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json();
}
async function getText(u) { if (EMB) return EMB.text[u]; return (await fetch(u)).text(); }
async function unpack(b64) {                              // gzip + base64 -> Float64Array (DecompressionStream)
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new Float64Array(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
async function arr(key, run = S.run) {
  const k = run + '|' + key;
  if (!S.arr[k]) S.arr[k] = EMB ? (key in EMB.arr ? unpack(EMB.arr[key]) : Promise.reject(new Error(key))) :
    fetch(`/api/arr?id=${encodeURIComponent(run)}&key=${encodeURIComponent(key)}`)
      .then(r => { if (!r.ok) throw new Error(key); return r.arrayBuffer(); }).then(b => new Float64Array(b));
  return S.arr[k];
}
async function loadSig(name, sig = S.sig, run = S.run) {
  const m = sig[name]; if (!m) throw new Error('no signal ' + name);
  if (m.data) return m.data;
  if (m.kind === 'analog') m.data = { t: await arr('time:' + m.time, run), v: await arr('ana:' + name, run) };
  else m.data = { t: await arr(`stp:${name}:t`, run), v: await arr(`stp:${name}:v`, run) };
  return m.data;
}
function lastLE(t, x) { let lo = 0, hi = t.length - 1; if (x < t[0]) return -1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (t[m] <= x) lo = m; else hi = m - 1; } return lo; }
function valueAt(name, x) {
  const m = S.sig[name]; if (!m || !m.data) return NaN;
  const { t, v } = m.data, k = lastLE(t, x);
  if (m.kind === 'step') return v[Math.max(k, 0)];
  if (k < 0) return v[0]; if (k >= t.length - 1) return v[t.length - 1];
  const f = (x - t[k]) / (t[k + 1] - t[k]); return v[k] + f * (v[k + 1] - v[k]);
}

// ---------------------------------------------------------------- run + circuit
// A run is loaded into new objects and committed to S in one step at the end, so S.run / S.sig never describe a
// half-loaded run; a request overtaken by a newer openRun is dropped (S.ready = the promise of the latest request).
let openSeq = 0;
function openRun(id) { S.ready = openRunNow(id, ++openSeq); return S.ready; }
async function openRunNow(id, seq) {
  const meta = await getJSON('/api/run?id=' + encodeURIComponent(id));
  const sig = {}; for (const s of meta.signals) sig[s.name] = { ...s };
  if (S.circName !== meta.circuit) await openCircuit(meta.circuit);
  const need = new Set();
  if (S.circ) for (const L of S.circ.legs) { L.gates.forEach(g => need.add(g)); need.add(L.current); }
  if (S.circ) for (const c of [...(S.circ.J.caps || []), ...(S.circ.J.srcs || [])]) need.add(c.i);
  if (S.rows.length) S.rows.forEach(r => r.sigs.forEach(n => need.add(n)));
  else defaultRows(sig).forEach(r => r.sigs.forEach(n => need.add(n)));
  await Promise.all([...need].filter(n => sig[n]).map(n => loadSig(n, sig, id)));
  if (seq !== openSeq) return;                                   // overtaken by a newer request
  S.run = id; S.meta = meta; S.sig = sig;
  [S.t0, S.t1] = S.meta.t_range;
  if (!S.rows.length) S.rows = defaultRows();
  S.rows = S.rows.map(r => ({ ...r, sigs: r.sigs.filter(n => S.sig[n]) }));
  // switching edges of all gates (keyboard navigation) and the largest leg current (path width)
  const e = [];
  for (const n in S.sig) if (S.sig[n].kind === 'step' && S.sig[n].data && n.startsWith('g_')) S.sig[n].data.t.forEach((x, i) => i && e.push(x));
  S.edges = Float64Array.from(new Set(e)).sort();
  const ne = new Map(); for (const x of e) ne.set(x, (ne.get(x) || 0) + 1);
  $('#egates').style.width = Math.min(150, 4 + 40 * Math.max(1, ...ne.values())) + 'px';   // fits the busiest edge
  S.imax = S.meta.imax || 1e-9;                                  // a trimmed record (CircuitView Live) brings the full-run value
  if (S.circ && !S.meta.imax) for (const L of S.circ.legs) { const d = S.sig[L.current] && S.sig[L.current].data; if (d) for (const x of d.v) S.imax = Math.max(S.imax, Math.abs(x)); }
  if (!(S.view[0] >= S.t0 && S.view[1] <= S.t1 && S.view[1] > S.view[0])) S.view = [S.t0, S.t1];
  if (!(S.cur >= S.t0 && S.cur <= S.t1)) S.cur = S.t0 + 0.25 * (S.t1 - S.t0);
  if ($('#run').options.length) runTitle();
  buildRows(); redraw();
}
function defaultRows(sig = S.sig) {
  // generic: first pole voltage, the leg currents of the circuit, the dc-link voltages, the neutral-point voltage
  // v_d = v_C1 - v_C2 (its own row: its scale is a few volts; user, 2026-11-05), the gates of the first leg, the
  // neutral-point current (rows that would be empty are dropped)
  const all = Object.values(sig), grp = g => all.filter(s => s.group === g).map(s => s.name);
  const legs = S.circ ? S.circ.legs : [];
  const r = [
    grp('pole voltage').slice(0, 1),
    legs.length ? legs.map(L => L.current).filter(n => sig[n]) : grp('current').slice(0, 4),
    grp('dc link').filter(n => n !== 'v_d').slice(0, 2),
    ['v_d'].filter(n => sig[n]),
    legs.length ? legs[0].gates.filter(n => sig[n]) : [],
    ['i_O'].filter(n => sig[n]),
  ];
  return r.filter(x => x.length).map(x => ({ sigs: x }));
}
const subst = (s, x) => s.replace(/\{x\}/g, x);
async function openCircuit(name) {
  const seq = S.circSeq = (S.circSeq || 0) + 1;                   // a later call (same circuit too) wins
  S.circName = name; S.circ = null; $('#svghost').innerHTML = '';
  let J; try { J = await getJSON(`circuits/${name}/circuit.json`); } catch (e) { $('#svghost').textContent = 'no circuit "' + name + '"'; return; }
  // load symbol (Settings): circuit.json is the default drawing and lists the others (legcells.finish, load)
  // and placement (below the inverter / to its right): circuit.json lists every drawing (style x placement)
  if (J.load) {
    const want = S.loadStyle || store.get(LOAD_KEY), place = S.loadPlace || store.get(PLACE_KEY) || 'below';
    const ent = (J.load.styles || []).find(s => s.id === want) || (J.load.styles || []).find(s => s.id === J.load.style);
    const file = ent && (place === 'right' && ent.file_right ? ent.file_right : ent.file);
    if (file && file !== 'circuit.json') { try { J = await getJSON(`circuits/${name}/${file}`); } catch (e) { /* not there: the default drawing */ } }
  }
  if (seq !== S.circSeq) return;                                  // overtaken by another call
  const txt = await getText(`circuits/${name}/${J.svg}`);
  if (seq !== S.circSeq) return;
  $('#svghost').innerHTML = txt;
  const svg = $('#svghost svg'); svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const anchors = { ...(J.anchors || {}) };
  svg.querySelectorAll('[id^="anc-"]').forEach(el => { const b = el.getBBox(); anchors[el.id.slice(4)] = [b.x + b.width / 2, b.y + b.height / 2]; });
  const legs = J.legs.map((x, i) => {
    if (typeof x === 'object')                                   // per-leg table (netlist + solver + router, v2)
      return { x: x.name, i, current: x.current, gates: x.gates, dev: { ...x.devices }, table: x.table,
        color: x.color || (J.colors ? J.colors[i] : PHASE[x.name]) };
    const L = J.leg, dev = {};
    for (const k in L.devices) dev[subst(k, x)] = { ...L.devices[k], gate: L.devices[k].gate && subst(L.devices[k].gate, x) };
    return { x, i, current: subst(L.current, x), gates: L.gates.map(g => subst(g, x)), dev, table: L.table, color: J.colors ? J.colors[i] : PHASE[x] };
  });
  for (const L of legs) for (const id in L.dev) { const el = svg.getElementById(id); if (el) el.classList.add('cv-dev'); else console.warn('device not in svg', id); }
  // junction dots inside a device symbol (IGBT + antiparallel diode): their own group, coloured from the pair in drawCircuit
  const dotGroups = [...svg.querySelectorAll('[data-sym]')].flatMap(sym => {
    const devs = [...sym.children].filter(c => c.classList.contains('cv-dev'));
    return devs.length ? [...sym.children].filter(c => !c.classList.contains('cv-dev') && c.querySelector('ellipse, circle')).map(g => { g.classList.add('cv-dots'); return [g, devs]; }) : [];
  });
  for (const c of J.caps || []) { const el = svg.querySelector(`[data-sym][data-key="${c.id}"]`); if (el) el.classList.add('cv-cap-sym'); }
  for (const c of J.loads || []) { const el = svg.querySelector(`[data-sym][data-key="${c.id}"]`); if (el) el.classList.add('cv-load'); }
  const ov = document.createElementNS('http://www.w3.org/2000/svg', 'g'); ov.id = 'cv-overlay'; svg.appendChild(ov);
  const vb = svg.viewBox.baseVal;
  S.circ = { J, svg, anchors, legs, ov, dotGroups, unit: Math.max(vb.width, vb.height) / 260 };
  $('#legend').innerHTML = legendHTML(J);
  syncSettings();
}
// ---------------------------------------------------------------- settings: load symbol
// The choice is remembered (circuitview.load) and applies to every circuit that has that drawing; the others keep
// their default. S.loadStyle: a style asked for by a state (applyState: a slide or an exported file), not stored.
const LOAD_KEY = 'circuitview.load', PLACE_KEY = 'circuitview.loadplace';
const LOAD_ICON = {
  rle: '<path d="M0 11h2l1.2-4.5 2.2 9 2.2-9 2.2 9 1.2-4.5h1.6a2.7 2.7 0 0 1 5.4 0 2.7 2.7 0 0 1 5.4 0 2.7 2.7 0 0 1 5.4 0H33"/><path d="M33 11a5 5 0 1 1 10 0 5 5 0 1 1-10 0M35.2 11c.95-2.4 1.9-2.4 2.8 0s1.85 2.4 2.8 0M43 11h3"/>',
  rl: '<path d="M1 11h5l1.5-4.5 2.6 9 2.6-9 2.6 9 1.5-4.5h2.2a3 3 0 0 1 6 0 3 3 0 0 1 6 0 3 3 0 0 1 6 0H45"/>',
  zbox: '<path d="M1 11h10M35 11h10"/><path d="M10.4 8.6v6.4h23.6" stroke-width="2" stroke-linecap="butt"/><rect x="11" y="7" width="24" height="8" fill="var(--surface)"/>',
  box: '<path d="M12 1v7M23 1v7M34 1v7"/><path d="M4.4 9.8v10.4h36.6" stroke-width="2.2" stroke-linecap="butt"/><rect x="5" y="8" width="36" height="11" fill="var(--surface)"/>',
};
function setLoadPlace(id) {
  S.loadPlace = null; store.set(PLACE_KEY, id);
  const name = S.circName; if (!name) return;
  clearTimeout(S.loadTm);
  S.loadTm = setTimeout(() => openCircuit(name).then(() => { setLayout(); redraw(); }), 150);
}
function setLoadStyle(id) {
  S.loadStyle = null; store.set(LOAD_KEY, id);
  const name = S.circName; if (!name) return;
  clearTimeout(S.loadTm);                                          // arrow keys walk the radios: load the last one only
  S.loadTm = setTimeout(() => openCircuit(name).then(() => { setLayout(); redraw(); }), 150);
}
function syncSettings() {
  const box = $('#loadopts'); if (!box) return;
  const L = S.circ && S.circ.J.load, have = L ? L.styles.map(s => s.id) : [], cur = L ? L.style : null;
  const focused = box.contains(document.activeElement);
  box.innerHTML = ['rle', 'rl', 'zbox', 'box'].map(id => {
    const ok = have.includes(id), on = id === cur, nm = { rle: 'R + L + emf', rl: 'R + L', zbox: 'Box per phase', box: 'One box' }[id];
    const tag = !ok ? 'not drawn' : L.default === id ? 'default' : '';
    return `<label class="${on ? 'on' : ''}${ok ? '' : ' off'}"${ok && L.default === id ? ' title="the drawing of the simulated circuit"' : ''}>` +
      `<input type="radio" name="loadsym" value="${id}"${on ? ' checked' : ''}${ok ? '' : ' disabled'}${tag ? ` aria-describedby="ld-${id}"` : ''}>` +
      `<svg viewBox="0 0 46 22" aria-hidden="true">${LOAD_ICON[id]}</svg><span class="lnm">${nm}</span>${tag ? `<span class="dflt" id="ld-${id}">${tag}</span>` : ''}</label>`;
  }).join('');
  box.querySelectorAll('input').forEach(r => { r.onchange = () => { if (r.checked) setLoadStyle(r.value); }; });
  if (focused) { const c = box.querySelector('input:checked'); if (c) c.focus({ preventScroll: true }); }
  // placement: below the inverter (the drop under the N rail) or to its right (straight phase wires)
  const pb = $('#placeopts'); if (!pb) return;
  const places = L && L.places ? L.places : ['below'], pcur = L ? (L.place || 'below') : 'below', pf = pb.contains(document.activeElement);
  pb.innerHTML = ['below', 'right'].map(id => {
    const ok = places.includes(id), on = id === pcur, nm = { below: 'Below the inverter', right: 'Right of the inverter' }[id];
    const tag = !ok ? 'not drawn' : id === 'below' ? 'default' : '';
    return `<label class="${on ? 'on' : ''}${ok ? '' : ' off'}">` +
      `<input type="radio" name="loadplace" value="${id}"${on ? ' checked' : ''}${ok ? '' : ' disabled'}${tag ? ` aria-describedby="lp-${id}"` : ''}>` +
      `<svg viewBox="0 0 46 22" aria-hidden="true">${PLACE_ICON[id]}</svg><span class="lnm">${nm}</span>${tag ? `<span class="dflt" id="lp-${id}">${tag}</span>` : ''}</label>`;
  }).join('');
  pb.querySelectorAll('input').forEach(r => { r.onchange = () => { if (r.checked) setLoadPlace(r.value); }; });
  if (pf) { const c = pb.querySelector('input:checked'); if (c) c.focus({ preventScroll: true }); }
  // circuit pane: the sampling period at the cursor under the drawing (svm.js; three-level runs)
  const ob = $('#paneopts'); if (!ob) return;
  const opt = (id, on, ok, icon, nm, na) => `<label class="${on && ok ? 'on' : ''}${ok ? '' : ' off'}"><input type="checkbox" id="${id}"${on ? ' checked' : ''}${ok ? '' : ` disabled aria-describedby="${id}-na"`}>` +
    `<svg viewBox="0 0 46 22" aria-hidden="true">${icon}</svg><span class="lnm">${nm}</span>${ok ? '' : `<span class="dflt" id="${id}-na">${na}</span>`}</label>`;
  const hasTsp = typeof window.tspSetting === 'function';                 // no svm.js on this page: no Tsp option
  const capsOk = !!(S.circ && (S.circ.J.caps || []).length);
  ob.innerHTML = (hasTsp ? opt('tspchk', window.tspSetting(), document.documentElement.classList.contains('has-svm'), PLACE_ICON.tsp,
    'Sampling period under the circuit', '3-level runs') : '') +
    opt('capwchk', capWords(), capsOk, PLACE_ICON.capw, 'Charging / Discharging', 'no dc-link capacitors');
  if (hasTsp) $('#tspchk').onchange = e => { window.tspSetting(e.target.checked); syncSettings(); };
  $('#capwchk').onchange = e => { store.set(CAPW_KEY, e.target.checked); syncSettings(); if (S.circ) drawCircuit(); };
}
// the words Charging / Discharging beside each dc-link capacitor, read upward in the gap above its plates (default on)
const CAPW_KEY = 'circuitview.capwords';
function capWords() { return store.get(CAPW_KEY) !== false; }
// the drawing's label of capacitor id (a <text> reading e.g. C1), found once per circuit
function capName(C, id) {
  if (!C.capNames) C.capNames = {};
  if (!(id in C.capNames)) C.capNames[id] = [...C.svg.querySelectorAll('text')].find(t => t.textContent.replace(/\s/g, '') === id) || null;
  return C.capNames[id];
}
// what the capacitor words keep clear of: the drawing's text labels and the place of the i_O arrow + label (np_jog)
function capObstacles(C, K) {
  if (!C.capObs) {
    C.capObs = [...C.svg.querySelectorAll(':scope > :not(#cv-overlay) text')].map(t => { const b = t.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    if (C.J.np_jog) {
      const [[xa, y0], [xb]] = C.J.np_jog, y = y0 - 7 * K / 0.75, hw = (2.8 * K) / 2 + 1.6 * K;
      C.capObs.push({ x: xa, y: y - hw - 2.6 * K / 0.75 - 7, w: xb - xa, h: 7 + 2.6 * K / 0.75 + 2 * hw });
    }
  }
  return C.capObs;
}
// length of the longer word in em of the drawing's text face (measured once)
function capwEm() {
  if (!capwEm.v) { const c = document.createElement('canvas').getContext('2d'); c.font = '100px "Times New Roman", Times, serif'; capwEm.v = c.measureText('Discharging').width / 100; }
  return capwEm.v;
}
const PLACE_ICON = {
  below: '<rect x="3" y="2" width="22" height="9" rx="1"/><path d="M9 11v9M14 11v9M19 11v9"/>',
  right: '<rect x="3" y="4" width="18" height="14" rx="1"/><path d="M21 8h22M21 11h22M21 14h22"/>',
  tsp: '<rect x="3" y="2" width="40" height="7" rx="1"/><path d="M3 15h8v-3h10v3h10v-3h12M3 20h40"/>',
  capw: '<path d="M12 2v7M5 9h14M5 13h14M12 13v7M29 18V4M26 7l3-3 3 3M38 4v14M35 15l3 3 3-3"/>',
};

// The drawn i_x arrow beside each output wire turns to the direction the current flows at the cursor, and its label
// reads "i_a > 0" / "i_a < 0" (the sign against the drawn reference direction) (user, 2026-11-05). |i| < i_eps: the
// drawn direction and plain i_a. The flip is a mirror along the arrow's own axis about the middle of its drawing; the
// label (the <text> reading i_x nearest to the arrow) is centred over the arrow, so the longer text grows to both sides.
function iArrows(C, legs) {
  if (!C.iarr) {
    C.iarr = {};
    const texts = [...C.svg.querySelectorAll('text')];
    for (const { L } of legs) {
      const el = C.svg.querySelector(`[data-sym="arrow_i"][data-key="i${L.x}"]`); if (!el) continue;
      const b = el.getBBox(), m = el.transform.baseVal.consolidate(), ax = b.x + (m ? m.matrix.e : 0), ay = b.y + (m ? m.matrix.f : 0);
      let lab = null, bd = Infinity;
      for (const t of texts) {
        if (t.textContent.replace(/\s/g, '') !== 'i' + L.x) continue;
        const d = Math.hypot(+t.getAttribute('x') - ax, +t.getAttribute('y') - ay);
        if (d < bd) { bd = d; lab = t; }
      }
      if (lab) { lab.setAttribute('x', +(ax + b.width / 2).toFixed(3)); lab.setAttribute('text-anchor', 'middle'); }
      C.iarr[L.x] = { el, lab, base: el.getAttribute('transform') || '', cx: b.x + b.width / 2 };
    }
  }
  for (const { L, st } of legs) {
    const a = C.iarr[L.x]; if (!a) continue;
    a.el.setAttribute('transform', a.base + (st.sign === '-' ? ` translate(${+(2 * a.cx).toFixed(3)},0) scale(-1,1)` : ''));
    a.el.setAttribute('data-dir', st.sign === '-' ? 'reversed' : 'drawn');
    const t = a.lab; if (!t) continue;
    t.querySelectorAll('.cv-isign').forEach(e => e.remove());
    if (st.sign === '0') continue;
    const sub = t.querySelectorAll('tspan')[1], big = t.querySelector('tspan');
    const sp = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    sp.setAttribute('class', 'cv-isign'); sp.setAttribute('font-size', big ? big.getAttribute('font-size') : '8.35');
    sp.setAttribute('font-style', 'normal'); if (sub && sub.getAttribute('dy')) sp.setAttribute('dy', -parseFloat(sub.getAttribute('dy')));
    sp.textContent = st.sign === '+' ? ' > 0' : ' < 0';     // relation with a four-per-em space each side
    t.appendChild(sp);
  }
}
// ---------------------------------------------------------------- circuit state at the cursor
function legState(L, t) {
  const g = L.gates.map(n => Math.round(valueAt(n, t))), key = g.join('');
  const i = valueAt(L.current, t), eps = S.circ.J.i_eps || 0;
  const sign = i > eps ? '+' : i < -eps ? '-' : '0';
  const row = L.table[key];
  const cs = row ? (row[sign] || (sign === '0' ? { on: [], path: [] } : null)) : null;
  // |i| below i_eps: no conduction is drawn, but the leg's connection is shown as an idle (dashed, arrowless) path:
  // the '+' path when both signs end at the same rail, both paths when they differ (dead-time: the rail follows the sign)
  const idle = [];
  if (row && sign === '0') {
    const p = row['+'], m = row['-'];
    if (p && p.path && p.path.length) idle.push({ path: p.path, rail: p.rail });
    if (m && m.path && m.path.length && (!p || p.rail !== m.rail)) idle.push({ path: m.path, rail: m.rail });
  }
  return { g, key, i, sign, state: row ? row.state : '?', known: !!cs, on: cs ? cs.on.map(d => subst(d, L.x)) : [],
    path: cs ? cs.path.map(a => typeof a === 'string' ? subst(a, L.x) : a) : [], np: !!(cs && cs.np), rail: cs ? cs.rail : null, idle };
}
// dc-link capacitor at the cursor: i_<id> positive = charging (+ plate first along 'pieces'); |i| < i_eps: steady;
// a run without i_<id> (not logged) shows neither path nor mark
// A run whose meta lists cap_np {i_C1: k1, ...} (split dc link, ideal Vdc: i_C = k·i_O) gets i_C from the legs drawn
// via the neutral point at this instant, i_O = Σ i_x over those legs (gate-exact, so the gold branch always agrees
// with the drawn paths; the logged i_C samples would mix both sides of a switching edge between samples)
function capState(c, t, legs) {
  const eps = S.circ.J.i_eps || 0, k = (S.meta.cap_np || {})[c.i];
  let i;
  if (k !== undefined && legs) i = k * legs.reduce((a, { st }) => a + (st.np ? st.i : 0), 0);
  else if (S.sig[c.i] && S.sig[c.i].data) i = valueAt(c.i, t);
  else return { c, logged: false, i: NaN, sign: '0' };
  return { c, logged: true, i, sign: i > eps ? '+' : i < -eps ? '-' : '0' };
}
// net neutral-point current at the cursor: i_O = Σ i_x over the legs drawn via O (positive = out of O into the legs)
const netO = legs => legs.reduce((a, { st }) => a + (st.np ? st.i : 0), 0);
// dc source at the cursor: i_dc positive = delivering (out of the + plate into P). A cap_np run (ideal Vdc) gets it by
// KCL at P, gate-exact: i_dc = Σ i_x over the legs drawn from P + the current of the capacitors hanging from P
// (caps_p); otherwise the logged i_dc, else 'not logged'
function srcState(c, legs, caps) {
  const eps = S.circ.J.i_eps || 0;
  let i;
  if (S.meta.cap_np && legs) {
    i = legs.reduce((a, { st }) => a + (st.rail === 'P' ? st.i : 0), 0);
    for (const cs of caps) if ((c.caps_p || []).includes(cs.c.id)) i += cs.logged ? cs.i : 0;
  } else if (S.sig[c.i] && S.sig[c.i].data) i = valueAt(c.i, S.cur);
  else return { c, logged: false, i: NaN, sign: '0' };
  return { c, logged: true, i, sign: i > eps ? '+' : i < -eps ? '-' : '0' };
}
// Conduction styling (presentation only; classes and the one 'cv-path' per leg are what tests/check_ui.py reads).
// Overlay, bottom to top: cv-path-under (soft underlays), cv-path-np (gold edge, only via the neutral point),
// per leg cv-path-case (paper casing) + cv-path (crisp core, stroke = leg colour, width ∝ |i|), cv-arrow (arrowheads). Ring cv-np-ring at
// the neutral point. Widths are in drawing units relative to the wire width of the drawing (0.75 pt).
// Path geometry -> SVG d: straight steps, except where a step crosses a hop chord listed in circuit.json "hops" (a wire
// jumping another one): there the path follows the same half-ellipse as the drawn wire, so a highlighted path never
// seems to connect to the wire it jumps. The plain polyline is kept in data-pts (tests read the points from it).
function polyD(pts) { return 'M' + pts.map(p => p.join(',')).join('L'); }
function pathD(pts, hops, tol = 1e-3) {
  if (!hops || !hops.length) return polyD(pts);
  let d = 'M' + pts[0].join(',');
  for (let k = 0; k < pts.length - 1; k++) {
    const [x1, y1] = pts[k], [x2, y2] = pts[k + 1];
    if (Math.abs(y1 - y2) < 1e-6 && Math.abs(x2 - x1) > 1e-6) {           // horizontal step: hops on this line
      const dir = x2 > x1 ? 1 : -1, lo = Math.min(x1, x2), hi = Math.max(x1, x2);
      const on = hops.filter(h => Math.abs(h.p0[1] - y1) < tol && Math.min(h.p0[0], h.p1[0]) > lo - 1e-6 && Math.max(h.p0[0], h.p1[0]) < hi + 1e-6)
        .sort((a, b) => dir * (a.p0[0] - b.p0[0]));
      for (const h of on) {
        const a = dir > 0 ? Math.min(h.p0[0], h.p1[0]) : Math.max(h.p0[0], h.p1[0]), e = dir > 0 ? Math.max(h.p0[0], h.p1[0]) : Math.min(h.p0[0], h.p1[0]);
        const rx = Math.abs(h.p1[0] - h.p0[0]) / 2, up = h.up !== false;
        d += 'L' + a + ',' + y1 + 'A' + rx + ' ' + h.rise + ' 0 0 ' + ((dir > 0) === up ? 1 : 0) + ' ' + e + ',' + y1;
      }
    }
    d += 'L' + x2 + ',' + y2;
  }
  return d;
}
// Shared wires (KCL): every leg path (in its current direction) is split at all vertices used by any leg. A piece used
// by one leg stays in that leg's colour; a piece used by two or more legs carries one current, their net
// i_net = Σ ±|i_x| (+ along the piece's canonical direction), drawn once as a 'net' line in the colour of the dc net it
// lies on (O: gold, P / N: --dc), width ∝ |i_net|, arrows in the net direction; none while |i_net| ≤ i_eps. The leg
// paths split at the node where they leave the shared wire. Returns per leg its parts (polylines of its own pieces) and
// the straight runs of those parts; and the net chains (consecutive shared pieces with the same users and net).
// The table points stay in data-pts.
const straight = pts => pts.filter((p, j) => j === 0 || j === pts.length - 1 ||
  Math.abs((p[0] - pts[j - 1][0]) * (pts[j + 1][1] - p[1]) - (p[1] - pts[j - 1][1]) * (pts[j + 1][0] - p[0])) > 1e-9);
const runsOf = pts => pts.slice(1).map((b, j) => ({ a: pts[j], b, k: 1 }));
// extra: points that also cut the runs (IGBT route corners, so a device's leads are pieces of their own); inner: piece
// keys inside a device symbol (circuit.json dev_routes) - a part never mixes inner and outer pieces (D.inner[j]).
// A diagonal step (an IGBT's collector / emitter diagonal) is one piece of its own.
function shareGeometry(drawn, eps, extra = [], inner = null) {
  const E = 1e-6, keyP = p => p[0].toFixed(4) + ',' + p[1].toFixed(4), V = new Map();
  for (const D of drawn) for (const p of D.pts) V.set(keyP(p), p);
  for (const p of extra) V.set(keyP(p), p);
  const verts = [...V.values()];
  const pieces = new Map();                                          // canonical key -> { a, b, users: [{ di, dir }] }
  drawn.forEach((D, di) => {
    D.pieces = [];
    for (let k = 0; k < D.pts.length - 1; k++) {
      const a = D.pts[k], b = D.pts[k + 1], horiz = Math.abs(a[1] - b[1]) < E;
      if (Math.abs(a[0] - b[0]) < E && Math.abs(a[1] - b[1]) < E) continue;
      if (Math.abs(a[0] - b[0]) > E && Math.abs(a[1] - b[1]) > E) {            // diagonal: one piece, never cut
        const [ka, kb] = [keyP(a), keyP(b)], fwd = ka < kb, key = fwd ? ka + '|' + kb : kb + '|' + ka;
        if (!pieces.has(key)) pieces.set(key, { a: fwd ? a : b, b: fwd ? b : a, users: [] });
        pieces.get(key).users.push({ di, dir: fwd ? 1 : -1 });
        D.pieces.push({ a, b, key }); continue;
      }
      const ax = horiz ? 0 : 1, lo = Math.min(a[ax], b[ax]), hi = Math.max(a[ax], b[ax]), dir = b[ax] > a[ax] ? 1 : -1;
      const cuts = verts.filter(v => Math.abs(v[1 - ax] - a[1 - ax]) < E && v[ax] > lo + E && v[ax] < hi - E).map(v => v[ax]);
      const along = [a[ax], ...cuts.sort((p, q) => dir * (p - q)), b[ax]];
      for (let j = 0; j < along.length - 1; j++) {
        const p = horiz ? [along[j], a[1]] : [a[0], along[j]], q = horiz ? [along[j + 1], a[1]] : [a[0], along[j + 1]];
        const [kp, kq] = [keyP(p), keyP(q)], fwd = kp < kq, key = fwd ? kp + '|' + kq : kq + '|' + kp;
        if (!pieces.has(key)) pieces.set(key, { a: fwd ? p : q, b: fwd ? q : p, users: [] });
        pieces.get(key).users.push({ di, dir: fwd ? 1 : -1 });
        D.pieces.push({ a: p, b: q, key });
      }
    }
  });
  const shared = key => pieces.get(key).users.length > 1;
  for (const D of drawn) {
    D.parts = [];
    let cur = null;
    for (const P of D.pieces) {
      if (shared(P.key)) { cur = null; continue; }
      const inn = !!(inner && inner.has(P.key));
      if (!cur || cur.inner !== inn) { cur = [P.a]; cur.inner = inn; D.parts.push(cur); }
      cur.push(P.b);
    }
    D.inner = D.parts.map(p => p.inner);
    D.parts = D.parts.map(straight);
    D.runs = D.parts.flatMap(runsOf);
  }
  // shared pieces in the net direction, chained while users and net stay the same
  const segs = [];
  for (const [key, pc] of pieces) {
    if (pc.users.length < 2) continue;
    const net = pc.users.reduce((s, u) => s + u.dir * Math.abs(drawn[u.di].st.i), 0);
    const sig = pc.users.map(u => u.di).sort().join(',') + ':' + Math.abs(net).toFixed(9);   // the sign follows the piece's key
    segs.push({ key, sig, net, users: pc.users.map(u => drawn[u.di].L.x), from: net >= 0 ? pc.a : pc.b, to: net >= 0 ? pc.b : pc.a });
  }
  const chains = [], used = new Set(), at = new Map();
  for (const g of segs) { const k = g.sig + '@' + keyP(g.from); if (!at.has(k)) at.set(k, []); at.get(k).push(g); }
  const heads = segs.filter(g => !segs.some(h => h !== g && h.sig === g.sig && keyP(h.to) === keyP(g.from)));
  for (const g0 of [...heads, ...segs]) {                             // heads first; loops (none expected) after
    if (used.has(g0.key)) continue;
    const pts = [g0.from, g0.to]; used.add(g0.key); let g = g0;
    for (;;) {
      const nx = (at.get(g.sig + '@' + keyP(g.to)) || []).find(h => !used.has(h.key));
      if (!nx) break;
      used.add(nx.key); pts.push(nx.to); g = nx;
    }
    chains.push({ pts: straight(pts), net: g0.net, users: g0.users });
  }
  return chains.filter(c => Math.abs(c.net) > eps);
}
// ---------------------------------------------------------------- flowing arrowheads
// With flow on, the arrowheads travel along every conduction lane (and capacitor branch) in the current direction at
// a speed ∝ |i|, FLOW_GAP apart on every path (one rhythm for all lanes); they rest while the
// cursor moves, fade in and out at the path ends and hide where a static arrowhead would not be placed (hop arcs,
// drawn i-arrow symbols, beside a charge arrow). Off: one static arrowhead per straight run (as before).
// Switch: toolbar 'Flow' (remembered), ?flow=0|1; prefers-reduced-motion starts it off.
const FLOW_GAP = 24, FLOW_V0 = 5, FLOW_V1 = 30, FLOW_REST = 250;      // drawing units, units/s, ms after a cursor move
const FLOW_IDLE = 60000;                                             // ms without mouse / key input: the heads stop where they are
const FLOW = { on: true, items: [], phase: {}, moved: 0, last: 0, raf: 0, input: performance.now(), idle: false };
{
  const q = new URLSearchParams(location.search).get('flow');
  let on = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { const v = JSON.parse(localStorage.getItem('circuitview.flow')); if (typeof v === 'boolean') on = v; } catch (e) { /* no storage */ }
  FLOW.on = q === '0' ? false : q === '1' ? true : on;
}
// one flowing path: polyline pts (in the current direction), arrow colour / core width, per-segment bundle size k
function flowItem(id, pts, col, w, k, iabs, keep) {
  const segs = []; let L = 0;
  for (let n = 0; n < pts.length - 1; n++) {
    const a = pts[n], b = pts[n + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    segs.push({ a, b, s0: L, len, ang: Math.atan2(b[1] - a[1], b[0] - a[0]), k: k ? k(a, b) : 1 }); L += len;
  }
  const n = Math.floor(L / FLOW_GAP) + 2;                            // heads at ph + (m-1)·FLOW_GAP, m = 0..n-1
  return { id, segs, L, n, col, w, keep, v: FLOW_V0 + FLOW_V1 * Math.min(1, iabs / S.imax), els: [] };
}
function flowPlace() {
  const K = S.circ ? (S.circ.J.wire_width || 0.75) : 0.75;
  for (const it of FLOW.items) {
    const ph = FLOW.phase[it.id] || 0;
    it.els.forEach((el, m) => {
      const s = ph + (m - 1) * FLOW_GAP;
      if (s <= 0 || s >= it.L) { el.setAttribute('opacity', 0); return; }
      const g = it.segs.find(q => s >= q.s0 && s <= q.s0 + q.len) || it.segs[it.segs.length - 1];
      const f = (s - g.s0) / g.len, x = g.a[0] + f * (g.b[0] - g.a[0]), y = g.a[1] + f * (g.b[1] - g.a[1]);
      const gi = it.segs.indexOf(g), hl = 4.4 * K;                       // fade into / out of a corner (no 90° snap)
      const dc = Math.min(gi > 0 ? s - g.s0 : Infinity, gi < it.segs.length - 1 ? g.s0 + g.len - s : Infinity);
      const fade = Math.max(0, Math.min(1, (s - 2.5 * K) / (3 * K), (it.L - s - 2.5 * K) / (3 * K), dc / hl));
      el.setAttribute('transform', `translate(${x.toFixed(3)},${y.toFixed(3)}) rotate(${(g.ang * 180 / Math.PI).toFixed(2)})`);
      el.setAttribute('opacity', (fade * it.keep(x, y)).toFixed(3));
      if (el.dataset.k !== String(g.k)) {                               // inside a bundle the head stays in its lane gap
        el.dataset.k = g.k; const hl = 4.4 * K, hw = it.w / 2 + (g.k > 1 ? 0.55 : 1.6) * K;
        el.setAttribute('d', `M${hl / 2},0L${-hl / 2},${hw}L${-hl * 0.28},0L${-hl / 2},${-hw}Z`);
      }
    });
  }
}
function flowTick(ts) {
  FLOW.raf = 0;
  if (!FLOW.on || !FLOW.items.length) return;
  if (performance.now() - FLOW.input > FLOW_IDLE) { FLOW.idle = true; return; }   // resumes on the next input (wireUI)
  const dt = FLOW.last ? Math.min(0.1, (ts - FLOW.last) / 1000) : 0; FLOW.last = ts;
  if (performance.now() - FLOW.moved > FLOW_REST && !document.hidden) {
    for (const it of FLOW.items) FLOW.phase[it.id] = ((FLOW.phase[it.id] || 0) + it.v * dt) % FLOW_GAP;
    flowPlace();
  }
  FLOW.raf = requestAnimationFrame(flowTick);
}
function flowStart() { if (FLOW.on && FLOW.items.length && !FLOW.raf) { FLOW.last = 0; FLOW.raf = requestAnimationFrame(flowTick); } }
function setFlow(on) {
  FLOW.on = on; try { localStorage.setItem('circuitview.flow', JSON.stringify(on)); } catch (e) { /* no storage */ }
  const b = $('#flow'); if (b) b.setAttribute('aria-pressed', String(on));
  drawCircuit();
}
// centres of the drawing's current-arrow symbols (data-sym="arrow_i"), so overlay arrowheads keep clear of them.
// Since 2026-11-03 the i_x reference arrows sit BESIDE the output wire (legcells.output, lint R9), so the wire
// belongs to the flowing heads: only an arrow drawn ON a wire (older drawings, no data-beside) is avoided.
function arrowSymbols(svg) {
  return [...svg.querySelectorAll('[data-sym="arrow_i"]:not([data-beside])')].map(el => {
    const b = el.getBBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2, t = el.transform && el.transform.baseVal.consolidate();
    const m = t && t.matrix; return m ? [m.a * cx + m.c * cy + m.e, m.b * cx + m.d * cy + m.f] : [cx, cy];
  });
}
// Overlay, bottom to top: cv-path-under (soft underlays), cv-path-np (gold edge, only via the neutral point),
// cv-path-case (paper casings), cv-lane (crisp cores, stroke = leg colour, width ∝ |i|), cv-arrow (arrowheads);
// cv-path = unpainted per-leg record on the exact table geometry.
function drawCircuit() {
  const C = S.circ; if (!C) return drawInfo([], []);
  const NS = 'http://www.w3.org/2000/svg', K = C.J.wire_width || 0.75;
  C.ov.innerHTML = ''; FLOW.items = []; FLOW.moved = performance.now();
  // the overlay lies above the wires but below the device and component symbols, so a path never hides a symbol
  const devLayer = C.svg.querySelector(':scope > .layer-dev');
  if (devLayer && C.ov.nextElementSibling !== devLayer) C.svg.insertBefore(C.ov, devLayer);
  if (!C.arrowSyms) C.arrowSyms = arrowSymbols(C.svg);
  const legs = C.legs.map(L => ({ L, st: legState(L, S.cur) }));
  iArrows(C, legs);
  const mk = (tag, cls, attrs) => { const p = document.createElementNS(NS, tag); p.setAttribute('class', cls); for (const k in attrs) p.setAttribute(k, attrs[k]); C.ov.appendChild(p); return p; };
  // dc-link capacitors: the branch current in gold (the neutral-point colour), width ∝ |i| on the legs' scale, one
  // arrowhead per wire piece in the current direction, the symbol lit; beside it ↑ charging (v_C rising) / ↓ discharging.
  // Layers: cap casings first (under the leg layers), the gold cores and arrowheads after the leg casings (capTop), so
  // neither the leg casings cut the gold at P / O nor the cap casings cut the leg lanes or the ring at O
  const caps = (C.J.caps || []).map(c => capState(c, S.cur, legs)), gold = css('--gold'), markInk = css('--np-ink'), capTop = [], capFlow = [];
  // one dc-link branch (capacitor: gold; source: --dc): casing now, core + one arrowhead per straight run in capTop
  // (static) or capFlow (flowing); pieces in the positive sense, reversed for a negative current
  const branch = (kind, id, pieces0, sign, i, col) => {
    const w = K * (1 + 1.8 * Math.min(1, Math.abs(i) / S.imax));
    const pieces = sign === '+' ? pieces0 : pieces0.map(p => [...p].reverse()).reverse();
    pieces.forEach((p, j) => {
      mk('path', `cv-${kind}-case`, { d: polyD(p), 'stroke-width': w + 0.9 * K });
      capTop.push(['path', `cv-${kind}`, { d: polyD(p), 'data-pts': polyD(p), ['data-' + kind]: id, stroke: col, 'stroke-width': w }]);
      if (FLOW.on) { capFlow.push([kind + ':' + id + ':' + j, p, col, w, Math.abs(i)]); return; }
      for (let n = 0; n < p.length - 1; n++) {
        const [x1, y1] = p[n], [x2, y2] = p[n + 1], a = Math.atan2(y2 - y1, x2 - x1), mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        if (Math.hypot(x2 - x1, y2 - y1) < 14 * K) continue;
        const hl = 4.4 * K, hw = w / 2 + 1.6 * K;
        const P = [[hl / 2, 0], [-hl / 2, hw], [-hl * 0.28, 0], [-hl / 2, -hw]].map(([px, py]) => [mx + px * Math.cos(a) - py * Math.sin(a), my + px * Math.sin(a) + py * Math.cos(a)]);
        capTop.push(['path', 'cv-arrow', { d: 'M' + P.map(q => q.map(v => +v.toFixed(3)).join(',')).join('L') + 'Z', fill: col }]);
      }
    });
  };
  const srcs = (C.J.srcs || []).map(c => srcState(c, legs, caps)), dcInk = css('--dc');
  for (const ss of srcs) if (ss.sign !== '0') branch('src', ss.c.id, ss.c.pieces, ss.sign, ss.i, dcInk);
  for (const cs of caps) {
    const sym = C.svg.querySelector(`[data-sym][data-key="${cs.c.id}"]`);
    if (sym) sym.classList.toggle('cv-cap-on', cs.sign !== '0');
    if (cs.sign === '0') continue;
    branch('cap', cs.c.id, cs.c.pieces, cs.sign, cs.i, gold);
    // charge arrow: shaft + open head (a different glyph from the filled current arrowheads), up = charging = v_C rising.
    // Words on (Settings): the word Charging / Discharging takes the arrow's place beside the plates, read upward, and the
    // arrow moves above the capacitor's name with the voltage it describes (v_C1 ↑), so it is not read as a current
    const [mx, my] = cs.c.mark, hw = cs.c.mark_w / 2, hh = (cs.c.mark_h || 4.4) / 2, up = cs.sign === '+', s = up ? -1 : 1;
    const r3 = v => +v.toFixed(3);
    const arrow = (ax, ay) => mk('path', 'cv-cap-mark', { d: `M${r3(ax)},${r3(ay - s * hh)}L${r3(ax)},${r3(ay + s * hh)}M${r3(ax - hw)},${r3(ay + s * hh - s * hw)}L${r3(ax)},${r3(ay + s * hh)}L${r3(ax + hw)},${r3(ay + s * hh - s * hw)}`,
      stroke: markInk, 'stroke-width': 0.6 * K / 0.75, 'data-cap': cs.c.id, 'data-dir': up ? 'up' : 'down' });
    const pc = cs.c.pieces, top = pc[0][0], bot = pc[pc.length - 1][pc[pc.length - 1].length - 1];
    const name = capWords() && Math.abs(top[0] - bot[0]) < 1e-6 && capName(C, cs.c.id);
    if (!name) { arrow(mx, my); continue; }
    // the word: in the arrow's column, centred on the plates when it fits, kept clear of the lit rows at both nodes, of
    // the drawing's labels in that column and of the i_O arrow + label beside the O jog (shown or not, so it never jumps)
    const m = 2.6 * K / 0.75, L46 = 4.6 * capwEm();
    let lo = top[1] + m, hi = bot[1] - m;
    const col = [mx - 3, mx + 3], keep = b => b.x < col[1] && b.x + b.w > col[0];
    const boxes = capObstacles(C, K);
    for (const b of boxes) if (keep(b)) { if (b.y + b.h <= my) lo = Math.max(lo, b.y + b.h + 1); else if (b.y >= my) hi = Math.min(hi, b.y - 1); }
    const cy = hi - lo >= L46 ? Math.min(Math.max(my, lo + L46 / 2), hi - L46 / 2) : (lo + hi) / 2;
    const lab = mk('text', 'cv-cap-word', { x: 0, y: 0, transform: `translate(${r3(mx)},${r3(cy)}) rotate(-90)`, 'text-anchor': 'middle',
      'dominant-baseline': 'central', fill: markInk, 'data-cap': cs.c.id });
    lab.textContent = up ? 'Charging' : 'Discharging';
    lab.setAttribute('font-size', r3(Math.min(4.6, 0.95 * (hi - lo) / capwEm())));
    // v_C and its arrow above the name, the pair centred on it, in the drawing's math face
    const nb = name.getBBox(), big = 8.35, small = 4.843, base = nb.y - 1.2 - small * 0.75;
    const v = mk('text', 'cv-cap-v', { x: 0, y: r3(base), fill: markInk, 'data-cap': cs.c.id });
    v.innerHTML = `<tspan font-size="${big}" font-style="italic">v</tspan><tspan font-size="${small}" dy="${r3(small * 0.52)}">` +
      cs.c.id.replace(/(\D+)|(\d+)/g, (q, l, d) => l ? `<tspan font-style="italic">${l}</tspan>` : d) + '</tspan>';   // C italic, 1 upright, as the name
    const vw = v.getBBox().width, gap = 0.9, x0 = nb.x + nb.width / 2 - (vw + gap + 2 * hw) / 2;
    v.setAttribute('x', r3(x0));
    arrow(x0 + vw + gap + hw, base - big * 0.3);
  }
  let npAny = false;
  const drawn = [];
  for (const { L, st } of legs) {
    const col = legColor(L);
    for (const id in L.dev) {
      const el = C.svg.getElementById(id); if (!el) continue;
      const d = L.dev[id]; el.classList.remove('cv-on', 'cv-off', 'cv-cond-igbt', 'cv-cond-diode');
      el.style.setProperty('--leg', col);
      if (st.on.includes(id)) el.classList.add(d.kind === 'diode' ? 'cv-cond-diode' : 'cv-cond-igbt');
      else if (d.gate) el.classList.add(Math.round(valueAt(d.gate, S.cur)) ? 'cv-on' : 'cv-off');
      else el.classList.add('cv-off');
    }
    if (st.np) npAny = true;
    const pts = st.path.map(a => typeof a === 'string' ? C.anchors[a] : a).filter(Boolean);   // anchor names or [x, y]
    if (pts.length < 2) continue;
    drawn.push({ L, st, pts, col, w: K * (1 + 1.8 * Math.min(1, Math.abs(st.i) / S.imax)) });   // core 0.75..2.1 units
  }
  // a symbol's junction dots take the strongest state of its devices: conducting (leg colour) > gate on > gate off
  const RANK = ['cv-off', 'cv-on', 'cv-cond-diode', 'cv-cond-igbt'];
  for (const [g, devs] of C.dotGroups || []) {
    const top = devs.reduce((a, el) => { const r = RANK.findIndex(c => el.classList.contains(c)); return r > a.r ? { r, el } : a; }, { r: -1, el: null });
    g.classList.remove(...RANK);
    if (top.el) { g.classList.add(RANK[top.r]); g.style.setProperty('--leg', top.el.style.getPropertyValue('--leg')); }
  }
  // inside an IGBT symbol the path follows its drawing (dev_routes) as a slim line, so the lit symbol stays readable
  if (!C.inner) {
    const kp = p => p[0].toFixed(4) + ',' + p[1].toFixed(4);
    C.inner = new Set(); C.routePts = [];
    for (const r of Object.values(C.J.dev_routes || {})) {
      C.routePts.push(...r);
      for (let k = 1; k < r.length; k++) { const a = kp(r[k - 1]), b = kp(r[k]); C.inner.add(a < b ? a + '|' + b : b + '|' + a); }
    }
  }
  const chains = shareGeometry(drawn, C.J.i_eps || 0, C.routePts, C.inner);
  // net lines: colour of the dc net the shared wire lies on (O: gold, P / N: --dc)
  const onNet = ([x, y], segs) => segs.some(([a, b]) => Math.abs((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) < 1e-3 * Math.hypot(b[0] - a[0], b[1] - a[1]) &&
    x >= Math.min(a[0], b[0]) - 1e-4 && x <= Math.max(a[0], b[0]) + 1e-4 && y >= Math.min(a[1], b[1]) - 1e-4 && y <= Math.max(a[1], b[1]) + 1e-4);
  for (const N of chains) {
    const [p, q] = N.pts, nets = C.J.nets || {}, m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];   // a chain stays on one net
    N.net_name = Object.keys(nets).find(n => onNet(m, nets[n])) || '';
    N.col = N.net_name === 'O' ? gold : dcInk;
    N.w = K * (1 + 1.8 * Math.min(1, Math.abs(N.net) / S.imax));
  }
  const hops = C.J.hops || [], tol = 3 * K;                           // drawn paths match a hop chord within tol
  // idle connections (|i| < i_eps): thin dashed line in the leg colour, no arrows, under everything else
  for (const { L, st } of legs) for (const id of st.idle) {
    const pts = id.path.map(a => typeof a === 'string' ? C.anchors[subst(a, L.x)] : a).filter(Boolean);
    if (pts.length > 1) mk('path', 'cv-path-idle', { d: pathD(pts, hops), 'data-pts': polyD(pts), stroke: legColor(L), 'data-leg': L.x, 'data-rail': id.rail || '' });
  }
  // the straight step that jumps a hop is painted again after every other part (case and lane last), so the wire it
  // jumps over lies BEHIND the arc, as in the drawing (user, 2026-11-05). Only that step goes on top: the rest of its
  // part may itself cross another leg's hop (load to the right: a leg's drop crosses the row of the leg before it)
  const arcs = d => /A/.test(d);
  for (const D of drawn) {
    const outer = D.parts.filter((p, j) => !D.inner[j]);
    D.d = outer.map(p => pathD(p, hops, tol)).join('');
    D.dh = outer.flatMap(p => p.slice(1).map((q, k) => pathD([p[k], q], hops, tol)).filter(arcs)).join('');
    D.di = D.parts.filter((p, j) => D.inner[j]).map(p => pathD(p, hops, tol)).join('');
    D.wi = Math.min(D.w, 1.25 * K); D.dp = polyD(D.pts);
  }
  for (const N of chains) { N.d = pathD(N.pts, hops, tol); N.dp = polyD(N.pts); N.hop = arcs(N.d); }
  const layers = (dk, hop) => {
    const ds = drawn.filter(D => D[dk]), ns = chains.filter(N => !!N.hop === hop);
    if (!hop) for (const D of ds) mk('path', 'cv-path-under', { d: D[dk], 'data-pts': D.dp, stroke: D.col, 'stroke-width': D.w + 2.2 * K });   // once: it is translucent
    for (const D of ds) if (D.st.np) mk('path', 'cv-path-np', { d: D[dk], 'data-pts': D.dp, 'stroke-width': D.w + 1.5 * K });
    for (const N of ns) mk('path', 'cv-path-under', { d: N.d, 'data-pts': N.dp, stroke: N.col, 'stroke-width': N.w + 2.2 * K });
    for (const D of ds) mk('path', 'cv-path-case', { d: D[dk], 'data-pts': D.dp, 'stroke-width': D.w + 0.9 * K });
    for (const N of ns) mk('path', 'cv-path-case', { d: N.d, 'data-pts': N.dp, 'stroke-width': N.w + 0.9 * K });
    if (!hop) {
      for (const D of drawn) if (D.di) mk('path', 'cv-path-case', { d: D.di, 'data-pts': D.dp, 'stroke-width': D.wi + 0.6 * K });
      for (const a of capTop) mk(...a);
    }
    for (const D of ds) mk('path', 'cv-lane', { d: D[dk], 'data-pts': D.dp, stroke: D.col, 'stroke-width': D.w });
    if (!hop) for (const D of drawn) if (D.di) mk('path', 'cv-lane', { d: D.di, 'data-pts': D.dp, stroke: D.col, 'stroke-width': D.wi });
    for (const N of ns) mk('path', 'cv-net', { d: N.d, 'data-pts': N.dp, stroke: N.col, 'stroke-width': N.w, 'data-net': N.net_name, 'data-i': N.net.toFixed(6), 'data-legs': N.users.join('') });
  };
  layers('d', false); layers('dh', true);
  // a hop on a wire that carries no lit current: the drawing's own arc lies under the overlay, so a lit leg crossing
  // it would cover the arc. Repaint that arc on top (paper case, then the wire in the drawing's wire colour)
  const litBy = test => drawn.some(D => D.parts.some((p, j) => !D.inner[j] && test(p))) || chains.some(N => test(N.pts));
  const wireEl = C.svg.querySelector('.layer-wire path'), wireCol = wireEl ? getComputedStyle(wireEl).stroke : '#000';
  for (const h of hops) {
    const x0 = Math.min(h.p0[0], h.p1[0]), x1 = Math.max(h.p0[0], h.p1[0]), y = h.p0[1];
    const step = (pts, f) => pts.some((p, k) => k > 0 && f(pts[k - 1], p));
    const row = pts => step(pts, (a, b) => Math.abs(a[1] - y) < tol && Math.abs(b[1] - y) < tol &&
      Math.min(a[0], b[0]) <= x0 + 1e-6 && Math.max(a[0], b[0]) >= x1 - 1e-6);
    const cross = pts => step(pts, (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && a[0] > x0 && a[0] < x1 &&
      Math.min(a[1], b[1]) < y - 1e-6 && Math.max(a[1], b[1]) > y + 1e-6);
    if (litBy(row) || !litBy(cross)) continue;                     // lit arc already on top / nothing lit under it
    const arc = `A${(x1 - x0) / 2} ${h.rise} 0 0 ${h.up !== false ? 1 : 0} ${x1},${y}`, s = 1.5 * K;
    mk('path', 'cv-hop-case', { d: `M${x0},${y}` + arc, 'stroke-width': 2.2 * K });
    mk('path', 'cv-hop', { d: `M${x0 - s},${y}L${x0},${y}` + arc + `L${x1 + s},${y}`, stroke: wireCol, 'stroke-width': K });
  }
  // load parts: lit in the leg colour while their leg conducts; the line stops at the part's body (a paper patch over
  // the body, wide enough for the widest underlay), so the lit zigzag / coil itself carries the current
  const lit = new Map(legs.map(({ L, st }) => [L.x, st.sign !== '0' && st.path.length ? legColor(L) : null]));
  const half = (K * 2.8 + 2.2 * K) / 2 + 0.3 * K;
  for (const ld of C.J.loads || []) {
    const sym = C.svg.querySelector(`[data-sym][data-key="${ld.id}"]`), col = lit.get(ld.leg);
    if (sym) { sym.classList.toggle('cv-load-on', !!col); if (col) sym.style.setProperty('--leg', col); }
    let [x0, y0, x1, y1] = ld.body;
    if (x1 - x0 < y1 - y0) { const cx = (x0 + x1) / 2; x0 = Math.min(x0, cx - half); x1 = Math.max(x1, cx + half); }
    else { const cy = (y0 + y1) / 2; y0 = Math.min(y0, cy - half); y1 = Math.max(y1, cy + half); }
    mk('rect', 'cv-knock', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, 'data-load': ld.id, 'data-lit': col ? 1 : 0 });
  }
  // one cv-path per leg on the exact table geometry (with its hops): the leg's semantic record, read by the tests;
  // it is not painted, the lanes above show it
  for (const D of drawn) mk('path', 'cv-path', { d: pathD(D.pts, hops), 'data-pts': D.dp, stroke: D.col, 'stroke-width': D.w });
  // one slim arrowhead per straight run, at its middle (or at 1/3, 2/3 when that is clear of a drawn i-arrow symbol)
  // keep-out: drawn i-arrow symbols (radius 6); charge arrows: no leg arrowhead level with one (|dy| ≥ 6.5 within 10 sideways)
  const marks = (C.J.caps || []).map(c => c.mark), hh = 2.2 * K;                   // hh: half the head length
  // keep-out zones of arrowheads: device and part symbols (boxes), node dots, hop chords
  if (!C.symBoxes) {
    const inv = C.svg.getCTM().inverse();
    C.symBoxes = [...C.svg.querySelectorAll(':scope > .layer-dev [data-sym]:not([data-beside])')].map(el => {
      const b = el.getBBox(), m = inv.multiply(el.getCTM()), P = [[b.x, b.y], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      return [Math.min(P[0].x, P[1].x), Math.min(P[0].y, P[1].y), Math.max(P[0].x, P[1].x), Math.max(P[0].y, P[1].y)];
    });
    C.dots = [...C.svg.querySelectorAll(':scope > .layer-top circle')].map(el => [+el.getAttribute('cx'), +el.getAttribute('cy'), +el.getAttribute('r') || 1]);
  }
  const boxD = (x, y, [x0, y0, x1, y1]) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
  const hopD = (x, y, h) => Math.max(Math.min(h.p0[0], h.p1[0]) - 2 * K - x, x - Math.max(h.p0[0], h.p1[0]) - 2 * K, Math.abs(y - h.p0[1]) - tol);
  // static heads: off drawn i-arrow symbols (radius ARROW_R), not level with a charge arrow (|dy| ≥ 6.5 within 10 sideways),
  // off symbols, node dots and hop chords
  // ARROW_R: a lane head against the i_x reference arrow would read as one double-headed arrow when i_x < 0;
  // SYM_GAP: a head right beside a diode triangle reads as a second diode
  const ARROW_R = 13, SYM_GAP = hh + 1.5 * K;
  const clear = (x, y) => C.arrowSyms.every(([sx, sy]) => Math.hypot(x - sx, y - sy) > ARROW_R) &&
    marks.every(([mx, my]) => Math.abs(x - mx) > 10 || Math.abs(y - my) >= 6.5) &&
    C.symBoxes.every(b => boxD(x, y, b) > SYM_GAP) && C.dots.every(([cx, cy, r]) => Math.hypot(x - cx, y - cy) > r + hh) && hops.every(h => hopD(x, y, h) > 0);
  if (FLOW.on) {
    // flowing arrowheads: off the hop chords (the lanes follow the arcs there), clear of symbols and charge arrows
    // keep factor 0..1: each keep-out zone fades the head over 3K from its edge instead of popping it in one frame;
    // zones: hop chords (±2K), drawn i-arrow symbols (r 6), beside a charge arrow (|dx| 10, |dy| 6.5), symbols, node dots
    const ramp = d => Math.max(0, Math.min(1, d / (3 * K)));
    const keep = (x, y, inside = false) => {
      let f = 1;
      for (const h of hops) {                                         // ramps along x (lanes on the hop row) and y (lanes crossing it)
        const lo = Math.min(h.p0[0], h.p1[0]) - 2 * K, hi = Math.max(h.p0[0], h.p1[0]) + 2 * K;
        f = Math.min(f, ramp(Math.max(lo - x, x - hi, Math.abs(y - h.p0[1]) - tol)));
      }
      for (const [sx, sy] of C.arrowSyms) f = Math.min(f, ramp(Math.hypot(x - sx, y - sy) - ARROW_R));
      for (const [mx, my] of marks) f = Math.min(f, ramp(Math.max(Math.abs(x - mx) - 10, Math.abs(y - my) - 6.5)));
      if (!inside) for (const b of C.symBoxes) f = Math.min(f, ramp(boxD(x, y, b) - SYM_GAP));
      for (const [cx, cy, r] of C.dots) f = Math.min(f, ramp(Math.hypot(x - cx, y - cy) - r - hh));
      return f;
    };
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'cv-flow-layer'); C.ov.appendChild(g);
    // inside an IGBT the heads follow its drawn route (slim, not kept out of the symbol box): the current runs through it
    const keepIn = (x, y) => keep(x, y, true);
    for (const D of drawn) D.parts.forEach((p, j) => FLOW.items.push(flowItem('leg:' + D.L.x + D.st.sign + ':' + j, p, D.col, D.inner[j] ? D.wi : D.w, null, Math.abs(D.st.i), D.inner[j] ? keepIn : keep)));
    for (const N of chains) FLOW.items.push(flowItem('net:' + N.users.join('') + ':' + N.dp, N.pts, N.col, N.w, null, Math.abs(N.net), keep));
    for (const [id, p, col, w, ia] of capFlow) FLOW.items.push(flowItem(id, p, col, w, null, ia, keep));
    for (const it of FLOW.items) for (let m = 0; m < it.n; m++) {
      const el = document.createElementNS(NS, 'path'); el.setAttribute('class', 'cv-arrow'); el.setAttribute('fill', it.col); el.dataset.flow = it.id;
      g.appendChild(el); it.els.push(el);
    }
    flowPlace(); flowStart();
  }
  for (const D of [...drawn, ...chains.map(N => ({ ...N, runs: runsOf(N.pts) }))]) for (const R of (FLOW.on ? [] : D.runs)) {
    const [x1, y1] = R.a, [x2, y2] = R.b, len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 14 * K) continue;
    const f = [0.5, 0.35, 0.65, 0.25, 0.75].find(t => clear(x1 + t * (x2 - x1), y1 + t * (y2 - y1)));
    if (f === undefined) continue;
    const a = Math.atan2(y2 - y1, x2 - x1), mx = x1 + f * (x2 - x1), my = y1 + f * (y2 - y1);
    const hl = 4.4 * K, hw = D.w / 2 + 1.6 * K;
    const P = [[hl / 2, 0], [-hl / 2, hw], [-hl * 0.28, 0], [-hl / 2, -hw]].map(([px, py]) => [mx + px * Math.cos(a) - py * Math.sin(a), my + px * Math.sin(a) + py * Math.cos(a)]);
    mk('path', 'cv-arrow', { d: 'M' + P.map(q => q.map(v => +v.toFixed(3)).join(',')).join('L') + 'Z', fill: D.col });
  }
  // net current of the neutral point, i_O = Σ i_x over the legs drawn via O (out of O into the legs): one gold arrow
  // beside the O jog (O node -> jog corner, 'np_jog'), pointing out of O (i_O > 0) or into O, width ∝ |i_O|, labelled
  // i_O like the drawing's i_x arrows; none while |i_O| ≤ i_eps. The lanes show each leg, this arrow their sum.
  const io = netO(legs);
  if (C.J.np_jog && Math.abs(io) > (C.J.i_eps || 0)) {
    const [[xa, y0], [xb]] = C.J.np_jog, w = K * (1 + 1.8 * Math.min(1, Math.abs(io) / S.imax)), out = io > 0;
    const y = y0 - 7 * K / 0.75, hl = 4.4 * K, hw = w / 2 + 1.6 * K, x1 = xa + 2.5 * K / 0.75, x2 = xb - 2.5 * K / 0.75;
    const tip = out ? x2 : x1, tail = out ? x1 : x2, s = out ? 1 : -1, r3 = v => +v.toFixed(3);
    mk('path', 'cv-np-net', { d: `M${r3(tail)},${r3(y)}L${r3(tip - s * hl * 0.6)},${r3(y)}`, stroke: gold, 'stroke-width': w, 'data-dir': out ? 'out' : 'in' });
    mk('path', 'cv-arrow cv-np-head', { d: `M${r3(tip)},${r3(y)}L${r3(tip - s * hl)},${r3(y - hw)}L${r3(tip - s * hl * 0.72)},${r3(y)}L${r3(tip - s * hl)},${r3(y + hw)}Z`, fill: gold });
    const lab = mk('text', 'cv-np-lab', { x: r3((x1 + x2) / 2), y: r3(y - hw - 2.6 * K / 0.75), 'text-anchor': 'middle' });
    lab.innerHTML = 'i<tspan dy="1.6" font-size="5.85">O</tspan>';
  }
  const npEl = C.J.np_node && C.svg.getElementById(C.J.np_node);
  if (npEl) {
    npEl.classList.toggle('cv-node-np', npAny);
    if (npAny) { const b = npEl.getBBox(); mk('circle', 'cv-np-ring', { cx: b.x + b.width / 2, cy: b.y + b.height / 2, r: 3.4 * K, 'stroke-width': 0.8 * K }); }
  }
  drawInfo(legs, caps, srcs);
}
const fmt = (v, u) => !isFinite(v) ? '–' : (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(3)) + (u ? ' ' + u : '');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- labels and numbers
// TeX-like label -> HTML: x_{ab} / x_a -> subscript, ^ -> superscript, single-letter symbols in italics,
// greek names, ' - ' -> minus. A multi-letter word before '_' (e.g. dead_time) is plain text with a space.
const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', theta: 'θ', phi: 'φ', omega: 'ω', tau: 'τ', mu: 'µ' };
function texHTML(s) {
  s = String(s); let out = '', i = 0;
  const grp = () => {                                   // {group}, else the letter/digit run (f_sp -> f_{sp})
    if (s[i] !== '{') { const r = /^[A-Za-z0-9]+/.exec(s.slice(i)); const g = r ? r[0] : s[i] || ''; i += g.length || 1; return g; }
    let d = 1, j = i + 1; while (j < s.length && d) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; }
    const g = s.slice(i + 1, j - 1); i = j; return g;
  };
  while (i < s.length) {
    const m = /^[A-Za-z]+/.exec(s.slice(i));
    if (m) {
      const w = m[0], nx = s[i + w.length];
      if (nx === '_' || nx === '^') {
        if (w.length === 1) { out += `<i>${w}</i>`; i += 1; continue; }
        if (GREEK[w]) { out += GREEK[w]; i += w.length; continue; }
        if (nx === '_') { out += esc(w) + ' '; i += w.length + 1; continue; }
      }
      out += esc(GREEK[w] || w); i += w.length; continue;
    }
    const c = s[i];
    if (c === '\\' && s[i + 1] === '_') { out += '_'; i += 2; continue; }   // literal underscore (file names)
    if (c === '_' || c === '^') { i++; const tag = c === '_' ? 'sub' : 'sup'; out += `<${tag}>${texHTML(grp()).replace(/(\d+)(?![^<]*>)/g, '<span class="up">$1</span>')}</${tag}>`; continue; }
    if (c === '-' && s[i - 1] === ' ' && s[i + 1] === ' ') { out += '−'; i++; continue; }
    out += esc(c); i++;
  }
  return out;
}
const fullLab = n => (S.sig[n] && S.sig[n].label) || n;
const shortLab = n => fullLab(n).split(/ = | \(/)[0].trim();
const labHTML = n => `<span class="tex" title="${esc(n + ' : ' + fullLab(n))}">${texHTML(shortLab(n))}</span>`;
// fixed decimals per signal (from its largest magnitude over the record) so values do not jitter
function decOf(n) {
  const m = S.sig[n]; if (!m) return 3; if (m.dec !== undefined) return m.dec;
  if (m.kind === 'step') return (m.dec = 0);
  if (!m.data) return 3;
  let a = 0; for (const x of m.data.v) { const q = Math.abs(x); if (q > a) a = q; }
  return (m.dec = a > 0 ? Math.min(3, Math.max(0, 4 - Math.floor(Math.log10(a)))) : 3);
}
// decimal-aligned number: [integer part, right-aligned][fraction, left-aligned][unit]
function numHTML(v, dec, unit) {
  if (!isFinite(v)) return `<span class="num"><span class="vi">–</span><span class="vf"></span><span class="vu">${esc(unit || '')}</span></span>`;
  const s = Math.abs(v).toFixed(dec), p = s.indexOf('.'), neg = v < 0 && +s !== 0;
  const ip = p < 0 ? s : s.slice(0, p), fp = p < 0 ? '' : s.slice(p);
  return `<span class="num"><span class="vi">${neg ? '−' : ''}${ip}</span><span class="vf">${fp}</span><span class="vu">${esc(unit || '')}</span></span>`;
}
// value shown at the cursor: as sampled (linear between samples), except the neutral-point quantities of a run with
// cap_np: i_O = Σ i_x over the legs drawn via O and i_C = k·i_O, gate-exact like the drawing and the DC link rows
function curVal(n) {
  const cn = S.meta && S.meta.cap_np;
  if (cn && S.circ && (n === 'i_O' || cn[n] !== undefined)) {
    const io = S.circ.legs.reduce((a, L) => { const st = legState(L, S.cur); return a + (st.np ? st.i : 0); }, 0);
    return n === 'i_O' ? io : cn[n] * io;
  }
  return valueAt(n, S.cur);
}
const sigNum = n => !S.sig[n] ? '' : numHTML(curVal(n), decOf(n), S.sig[n].unit);
// export text (ASCII) -> typeset text: units and angles as printed (uF -> µF, us -> µs, ohm -> Ω, deg -> °), '='
// with non-breaking spaces (an equation never breaks), file names keep their underscores
const prettyVal = v => String(v).replace(/(\d)\s*uF\b/g, '$1 µF').replace(/(\d)\s*us\b/g, '$1 µs').replace(/\bohm\b/g, 'Ω')
  .replace(/(\d)\s*deg\b/g, '$1°').replace(/ = /g, '\u00a0=\u00a0').replace(/(\d) (?=[A-Za-zµΩ])/g, '$1\u00a0');
const prettyText = s => prettyVal(s).replace(/[\w.-]+\.(?:slx|mat|npz|py|m)\b/g, f => f.replace(/_/g, '\\_'));
// the same as plain text (run selector options cannot hold markup): greek letters, x_a -> xa
const plainText = s => prettyText(s).replace(/\\_/g, '_').replace(/\b([A-Za-z])_([A-Za-z0-9]{1,3})\b/g, '$1$2')
  .replace(/\b(alpha|beta|gamma|delta|Delta|theta|phi|omega|tau)\b/g, w => GREEK[w]);
// parameter keys -> math (Vdc -> V_dc, C1 -> C_1, phi_deg -> φ); values: number + unit decimal-aligned like Signals
const PKEY = { Vdc: 'V_{dc}', phi_deg: 'phi', E_back: 'E_{back}' };
const keyTex = k => PKEY[k] || k.replace(/^([A-Za-z])(\d+)$/, '$1_{$2}');
function paramHTML(k, v) {
  const s = prettyVal(v) + (/_deg$/.test(k) && /^[-+]?[\d.]+$/.test(String(v)) ? '°' : '');
  const m = /^([-+]?\d+(?:\.(\d+))?)(?:\s*([^\s\d()°][^\s()]*))?$/.exec(s);
  if (m) return numHTML(+m[1], m[2] ? m[2].length : 0, m[3] || '');
  return esc(s).replace(/\b([RLCE]) (?=\d)/g, '<span class="tex"><i>$1</i></span>\u00a0=\u00a0');
}

// previous switching edge at or before the cursor and the gates that switched there
function edgeInfo() {
  const E = S.edges; if (!E || !E.length) return null;
  const k = lastLE(E, S.cur); if (k < 0) return null;
  const te = E[k], gates = [];
  for (const n in S.sig) {
    const m = S.sig[n]; if (m.kind !== 'step' || !m.data || !n.startsWith('g_')) continue;
    const { t, v } = m.data, j = lastLE(t, te); if (j > 0 && t[j] === te) gates.push({ n, up: v[j] > v[j - 1] });
  }
  return { te, dt: S.cur - te, gates };
}
const devHTML = d => { const m = /^([A-Z])([a-z])(\d+)$/.exec(d); return m ? `${m[1]}<sub>${m[2]}<span class="up">${m[3]}</span></sub>` : esc(d); };
const gatesHTML = gs => gs.map(g => `${texHTML(shortLab(g.n))}${g.up ? '↑' : '↓'}`).join(' ');

function drawInfo(legs, caps = [], srcs = []) {
  if (!S.meta) return;                                             // circuit drawn before its run is loaded
  // order: what changes with the cursor first (Legs, DC link, Signals), so it is in view without scrolling
  let h = '';
  if (legs.length) {
    // two rows per leg (read by tests/ui_probe.html): [badge | state | gate bits | current] and [ | conducting devices];
    // the gate bits are one cell per gate whose text is the bit, so the cell text joins to the gate key ('0101')
    const nG = Math.max(...legs.map(x => x.L.gates.length));
    h += `<h4>Legs</h4><table class="legs"><colgroup><col class="c-leg"><col class="c-st"><col class="c-g" style="width:${12 + 15 * nG}px"><col></colgroup>` +
      `<tr><th>leg</th><th>state</th><th>gates</th><th class="r">current</th></tr>`;
    for (const { L, st } of legs) {
      const devs = st.on.map(d => `<span class="dev dev-${(L.dev[d] || {}).kind === 'diode' ? 'diode' : 'igbt'}" title="${esc(d)}">${devHTML(d)}</span>`).join('<span class="plus"> + </span>') || (st.sign === '0' ? '<span class="note"><span class="tex">|<i>i</i>|</span> below <span class="tex"><i>i</i><sub>ε</sub></span>' + (st.idle.length ? ', held at ' + st.idle.map(x => esc(x.rail || '?')).join(' / ') + ' (dashed line)' : '') + '</span>' : '');
      const np = st.np ? ' class="np"' : '';
      const bits = st.g.map((b, j) => `<span class="bit ${b ? 'on' : 'off'}" title="${esc(L.gates[j])} = ${b}">${b}</span>`).join('');
      h += `<tr${np}><td><span class="badge" style="color:${legColor(L)}">${esc(L.x)}</span></td><td>${st.known ? '<span class="st' + (st.state.length === 1 ? ' st1' : '') + '">' + esc(st.state) + '</span>' : '<span class="warn">' + esc(st.key) + ' ?</span>'}</td>` +
        `<td class="key"><span class="bits">${bits}</span></td><td class="r">${numHTML(st.i, decOf(L.current), 'A')}</td></tr>` +
        `<tr${np}><td></td><td colspan="3" class="wrap devs">${devs}${st.np ? ' <span class="via">via ' + esc(S.circ.J.np_label || 'NP') + '</span>' : ''}</td></tr>`;
    }
    h += '</table>';
    if (legs.some(x => !x.st.known)) h += `<div class="warn note">Gate pattern not in the conduction table (shoot-through or missing row)</div>`;
  }
  if (caps.length || srcs.length) {
    // one row per source: [name | delivering / absorbing / idle | i_dc]; one per capacitor: [name | ↑ charging /
    // ↓ discharging / steady | i_C]; currents decimal-aligned like Signals
    h += `<h4>DC link</h4><table class="kv caps"><colgroup><col style="width:40px"><col><col style="width:148px"></colgroup>` +
      srcs.map(ss => `<tr data-src="${esc(ss.c.id)}"><td><span class="tex">${texHTML(keyTex(ss.c.id))}</span></td>` +
        (!ss.logged ? '<td colspan="2" class="note">not logged in this run</td>' :
          `<td>${ss.sign === '+' ? 'delivering' : ss.sign === '-' ? 'absorbing' : '<span class="note">idle</span>'}</td>` +
          `<td class="r">${numHTML(ss.i, decOf(S.circ.legs[0].current), 'A')}</td>`) + '</tr>').join('') +
      caps.map(cs => `<tr data-cap="${esc(cs.c.id)}"><td><span class="tex">${texHTML(cs.c.id.replace(/^([A-Za-z])(\d+)$/, '$1_{$2}'))}</span></td>` +
        (!cs.logged ? '<td colspan="2" class="note">not logged in this run</td>' :
          `<td>${cs.sign === '+' ? CHG_SVG('up') + 'charging' : cs.sign === '-' ? CHG_SVG('down') + 'discharging' : '<span class="note">steady</span>'}</td>` +
          `<td class="r">${numHTML(cs.i, decOf(cs.c.i), 'A')}</td>`) + '</tr>').join('') +
      (S.circ.J.np_jog ? (() => { const io = netO(legs), e = S.circ.J.i_eps || 0;
        return `<tr data-np="O"><td><span class="tex"><i>O</i></span></td><td>${io > e ? 'net out of <span class="tex"><i>O</i></span>' : io < -e ? 'net into <span class="tex"><i>O</i></span>' : '<span class="note">balanced</span>'}</td>` +
          `<td class="r">${numHTML(io, decOf(S.circ.legs[0].current), 'A')}</td></tr>`; })() : '') + '</table>';
  }
  const shown = [...new Set(S.rows.flatMap(r => r.sigs))];
  h += `<h4>Signals</h4><table class="kv sigs"><colgroup><col><col style="width:148px"></colgroup>` +
    shown.map(n => `<tr><td>${labHTML(n)}</td><td class="r">${sigNum(n)}</td></tr>`).join('') + '</table>';
  // then the cursor and the run (the cursor is also in the toolbar readout, the run in the selector)
  const E = edgeInfo();
  h += `<h4>Cursor</h4><table class="kv"><colgroup><col><col style="width:148px"></colgroup>` +
    `<tr><td>Time <span class="tex"><i>t</i></span></td><td class="r mono">${(S.cur * 1e3).toFixed(4)} ms</td></tr>` +
    `<tr><td>Since previous edge</td><td class="r mono">${E ? (E.dt * 1e6).toFixed(2) + ' µs' : '–'}</td></tr>` +
    `<tr><td>Gates switched there</td><td class="r"><span class="tex">${E ? gatesHTML(E.gates) : '–'}</span></td></tr></table>`;
  h += `<h4>Run</h4><div class="run" title="${esc(S.meta.title)}">${mathSpans(texHTML(prettyText(S.meta.title)))}${S.meta.synthetic && !/synthetic/i.test(S.meta.title) ? ' <span class="warn">(synthetic)</span>' : ''}</div>`;
  const p = S.meta.params || {};
  h += `<h4>Parameters</h4><table class="kv params"><colgroup><col><col style="width:148px"></colgroup>` +
    Object.keys(p).map(k => `<tr><td title="${esc(k)}">${mathSpans(texHTML(keyTex(k)))}</td><td class="r wrap">${paramHTML(k, p[k])}</td></tr>`).join('') + '</table>';
  if (S.meta.notes) h += `<p class="note" style="margin:12px 0 0">${mathSpans(texHTML(prettyText(S.meta.notes)))}</p>`;
  $('#info').innerHTML = '<div class="info-cols">' + h + '</div>'; moreFade();   // columns on the inner block: it grows downwards, #info scrolls
  $('#infosum').innerHTML = legs.map(({ L, st }) => `<span><span class="badge" style="color:${legColor(L)}">${esc(L.x)}</span>${esc(st.known ? st.state : '?')}</span>`).join('');
}
// drawer cut mid-row: fade its last lines while more lies below
const moreFade = () => { const el = $('#info'); el.classList.toggle('more', el.scrollTop + el.clientHeight < el.scrollHeight - 2); };
// inside running text only the math symbols (italic letters with their sub/superscripts, greek) use the math face
const mathSpans = html => html.replace(/(<i>[^<]*<\/i>(?:<su[bp]>.*?<\/su[bp]>)*|[α-ωΔ](?:<su[bp]>.*?<\/su[bp]>)*)/g, '<span class="tex">$1</span>');

// ---------------------------------------------------------------- waveform rows
// trace colours: the user's choice per signal name (signal menu; remembered, carried by cvState) before the defaults
const COLOR_KEY = 'circuitview.colors';
const TRACE_COLORS = ['#1f5fbf', '#c0392b', '#2e8b57', '#e07b00', '#7b3fb5', '#0f8a8a', '#8a6d3b', '#d0021b', '#1d1d1f', '#87909a'];
const userColors = () => S.colors || (S.colors = store.get(COLOR_KEY) || {});
function sigColor(n, k) {
  const uc = userColors()[n]; if (uc) return uc;
  const m = /^(?:i|v|s)_([a-f])(?:O|N)?$/.exec(n) || /^g_S([a-f])\d$/.exec(n);
  if (m) return css(PHASE[m[1]]) || LEG_FALLBACK['abcdef'.indexOf(m[1])];
  return PALETTE[k % PALETTE.length];
}
const isLanes = r => r.sigs.length >= 2 && r.sigs.every(n => S.sig[n] && S.sig[n].kind === 'step' && /^g_/.test(n));
const LANE = 24, CHIP = 20;
const defaultH = r => isLanes(r) ? LANE * r.sigs.length + 1 : Math.max(97, 13 + LANE * r.sigs.length);
const minH = r => isLanes(r) ? 16 * r.sigs.length + 1 : 49;
const rowH = r => Math.max(minH(r), r.h || defaultH(r));
function buildRows() {
  const host = $('#rows'), scroll = host.scrollTop; host.innerHTML = '';
  const opts = Object.values(S.sig).reduce((a, s) => { (a[s.group || 'other'] = a[s.group || 'other'] || []).push(s); return a; }, {});
  const optHTML = '<option value="">Add signal</option>' + Object.keys(opts).map(g => `<optgroup label="${esc(g)}">` +
    opts[g].map(s => `<option value="${esc(s.name)}">${esc(s.name)}${s.unit ? ' [' + esc(s.unit) + ']' : ''}</option>`).join('') + '</optgroup>').join('');
  S.rows.forEach((r, ri) => {
    const row = document.createElement('div'); row.className = 'row'; row.style.height = rowH(r) + 'px';
    const lab = document.createElement('div'); lab.className = 'lab';
    // tools: add signal (native select under a '+' glyph), remove row
    const tools = document.createElement('div'); tools.className = 'tools';
    const add = document.createElement('label'); add.className = 'tool'; add.title = 'add a signal to this row'; add.innerHTML = '<svg viewBox="0 0 10 10"><path d="M5 1v8M1 5h8"/></svg>';
    const sel = document.createElement('select'); sel.innerHTML = optHTML; add.appendChild(sel);
    sel.onchange = async () => { const v = sel.value; sel.blur(); if (!v) return; await loadSig(v); r.sigs.push(v); buildRows(); redraw(); };
    const rm = document.createElement('button'); rm.className = 'tool'; rm.innerHTML = '<svg viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6"/></svg>'; rm.title = 'remove row';
    rm.onclick = () => { S.rows.splice(ri, 1); buildRows(); redraw(); };
    tools.append(add, rm);
    const chips = document.createElement('div'); chips.className = 'chips' + (isLanes(r) ? ' lanes' : '');
    // a signal chip: click = emphasise its trace (click again: all equal); the x on its swatch (hover) or Delete removes it
    r.sigs.forEach((n, k) => {
      const c = document.createElement('button'); c.type = 'button'; c.className = 'chip' + (r.hl === n ? ' hl' : '');
      c.style.setProperty('--c', sigColor(n, k)); c.dataset.sig = n;
      c.title = `${n} : ${fullLab(n)}\n${isLanes(r) ? '' : 'click: emphasise the trace; '}line mark or right-click: colour, scale, remove; Delete: remove it`;
      c.setAttribute('aria-pressed', String(r.hl === n));
      const gk = gainOf(r, n);
      c.innerHTML = `<span class="sw" title="colour, scale, remove"></span><span class="nm"><span class="tex">${texHTML(shortLab(n))}</span>` +
        (gk !== 1 ? `<span class="gn" title="drawn ×${fmtGain(gk)} (readout: true value)">×${fmtGain(gk)}</span>` : '') + `</span><span class="val"></span>`;
      const remove = () => {
        const sigs = r.sigs.slice(), hl = r.hl; r.sigs.splice(k, 1); if (r.hl === n) r.hl = null; buildRows(); redraw();
        undoToast(`Removed ${n}`, () => { r.sigs = sigs; r.hl = hl; buildRows(); redraw(); });
      };
      c.oncontextmenu = e => { e.preventDefault(); openSigPop(c, r, n, k, remove); };
      c.onclick = e => {
        if (e.target.closest('.sw')) return openSigPop(c, r, n, k, remove);
        if (isLanes(r)) return;                                    // gate lanes never overlap: nothing to emphasise
        r.hl = r.hl === n ? null : n; buildRows(); redraw();
        const again = r.el && r.el.chips.querySelector(`.chip[data-sig="${CSS.escape(n)}"]`); if (again && e.detail === 0) again.focus();
      };
      c.onkeydown = e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); } };
      chips.appendChild(c);
    });
    if (!r.sigs.length) chips.innerHTML = '<span class="empty">Empty row: add a signal with +</span>';
    const yax = document.createElement('div'); yax.className = 'yax'; const ycv = document.createElement('canvas'); yax.appendChild(ycv);
    if (!isLanes(r) && r.sigs.length) { yax.classList.add('set'); yax.title = 'y axis range (click)'; yax.onclick = () => openYPop(yax, r); }
    lab.append(tools, chips, yax);
    const plot = document.createElement('div'); plot.className = 'plot';
    const base = document.createElement('canvas'), top = document.createElement('canvas');
    plot.append(base, top);
    const rz = document.createElement('div'); rz.className = 'rz'; rz.title = 'drag to set the row height (double-click: default)';
    row.append(lab, plot, rz); host.appendChild(row);
    r.el = { row, base, top, plot, chips, yax: ycv };
    attachPlot(plot, r); attachResize(rz, r);
  });
  host.scrollTop = scroll;
}
function sizeCanvas(cv) {
  const d = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
  const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); return [g, w, h];
}
const X = (t, w) => (t - S.view[0]) / (S.view[1] - S.view[0]) * w;
const T = (x, w) => S.view[0] + x / w * (S.view[1] - S.view[0]);
const DPR = () => devicePixelRatio || 1;
const px = x => (Math.round(x * DPR() - 0.5) + 0.5) / DPR();   // centre of a device pixel: crisp 1-device-px lines
function range(n) {           // min/max of a signal over the view (analog: samples inside + the edges)
  const { t, v } = S.sig[n].data; let i0 = Math.max(lastLE(t, S.view[0]), 0), i1 = Math.min(lastLE(t, S.view[1]) + 1, t.length - 1);
  let lo = Infinity, hi = -Infinity; for (let i = i0; i <= i1; i++) { if (v[i] < lo) lo = v[i]; if (v[i] > hi) hi = v[i]; }
  return [lo, hi];
}
function drawTrace(g, n, w, y, col, lw) {
  const { t, v } = S.sig[n].data, step = S.sig[n].kind === 'step';
  let i0 = Math.max(lastLE(t, S.view[0]), 0), i1 = Math.min(lastLE(t, S.view[1]) + 1, t.length - 1);
  g.strokeStyle = col; g.lineWidth = lw || 1.2; g.lineJoin = 'round'; g.beginPath();
  if (step) {
    let px = Math.max(X(t[i0], w), -2), py = y(v[i0]); g.moveTo(px, py);
    for (let i = i0 + 1; i <= i1; i++) { const x = X(t[i], w), yy = y(v[i]); g.lineTo(x, py); g.lineTo(x, yy); py = yy; }
    g.lineTo(w + 2, py);
  } else if (i1 - i0 > 3 * w) {                                     // min/max per pixel column
    let col0 = -1, mn = 0, mx = 0, first = true;
    for (let i = i0; i <= i1; i++) {
      const c = Math.floor(X(t[i], w));
      if (c !== col0) { if (col0 >= 0) { if (first) { g.moveTo(col0, y(mn)); first = false; } g.lineTo(col0, y(mn)); g.lineTo(col0, y(mx)); } col0 = c; mn = mx = v[i]; }
      else { if (v[i] < mn) mn = v[i]; if (v[i] > mx) mx = v[i]; }
    }
    g.lineTo(col0, y(mn)); g.lineTo(col0, y(mx));
  } else {
    g.moveTo(X(t[i0], w), y(v[i0])); for (let i = i0 + 1; i <= i1; i++) g.lineTo(X(t[i], w), y(v[i]));
  }
  g.stroke();
}
function niceStep(lo, hi, n) {
  const span = hi - lo || 1, raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
function niceTicks(lo, hi, n) {
  const span = hi - lo || 1, st = niceStep(lo, hi, n), out = [];
  for (let k = Math.ceil(lo / st - 1e-9); k * st <= hi + 1e-12 * span; k++) out.push(Math.abs(k) < 1e-9 ? 0 : k * st);
  return out;
}
const decFor = step => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
const nT = w => Math.max(2, w / 110);                    // time ticks: same count for rows and the axis
const fmtTick = (v, d) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
// canvas text face from the interface tokens (--f-canvas), read at draw time
const NUMF_ = () => css('--f-canvas') || '"Segoe UI", sans-serif';
// tabular canvas text: every digit on the advance of '0' (canvas has no font-variant-numeric), so a changing number
// never jitters; align 'left' | 'center' | 'right' at x
function tabText(g, s, x, y, align) {
  const d = g.measureText('0').width, wOf = ch => /[0-9]/.test(ch) ? d : g.measureText(ch).width;
  const W = [...s].reduce((a, ch) => a + wOf(ch), 0); let p = align === 'center' ? x - W / 2 : align === 'right' ? x - W : x;
  g.textAlign = 'center'; for (const ch of s) { const w = wOf(ch); g.fillText(ch, p + w / 2, y); p += w; }
  return W;
}
// decimal-aligned canvas number: the integer part ends at x, the fraction starts there
function decText(g, s, x, y) {
  const p = s.indexOf('.'), ip = p < 0 ? s : s.slice(0, p), fp = p < 0 ? '' : s.slice(p);
  tabText(g, ip, x, y, 'right'); if (fp) tabText(g, fp, x, y, 'left');
}
// ---------------------------------------------------------------- y axes, gains, colours (user, 2026-11-05)
// A row's signals of the first signal's unit share the left axis; signals of another unit get a second axis on the
// plot's right edge, with its own range (a current next to the pole voltages, both readable). A gain per signal
// (signal menu) scales the drawn trace only, like a scope's probe factor, onto the LEFT axis: its chip says ×k, every
// readout stays true, and the right axis only ever shows true values.
// r.y / r.y2: ranges the user fixed (y-axis menu, Ctrl+wheel on the left axis); double-click the plot: automatic.
const gainOf = (r, n) => (r.gain && +r.gain[n]) || 1;
const fmtGain = k => String(+k.toPrecision(4));
function rowAxes(r) {
  const unit = n => (S.sig[n] && S.sig[n].unit) || '', u0 = unit(r.sigs[0]);
  const L = { side: 'L', unit: u0, sigs: [] }, R = { side: 'R', unit: '', sigs: [] };
  for (const n of r.sigs) {
    const A = unit(n) === u0 || gainOf(r, n) !== 1 ? L : R; A.sigs.push(n);         // a scaled signal joins the left axis
    if (A === R && !R.unit.split(', ').includes(unit(n))) R.unit = R.unit ? R.unit + ', ' + unit(n) : unit(n);
  }
  for (const [A, held] of [[L, r.y], [R, r.y2]]) {
    if (!A.sigs.length) continue;
    let lo = Infinity, hi = -Infinity;
    for (const n of A.sigs) { const k = gainOf(r, n), [a, b] = range(n); lo = Math.min(lo, a * k, b * k); hi = Math.max(hi, a * k, b * k); }
    if (!(hi > lo)) { lo -= 1; hi += 1; } const pad = 0.08 * (hi - lo);
    [A.lo, A.hi] = held || [lo - pad, hi + pad]; A.held = !!held;
  }
  return { L, R: R.sigs.length ? R : null, of: n => (R.sigs.includes(n) ? R : L) };
}
// one small menu at a time over the waveforms: the signal menu or the y-axis menu
function popMenu(anchor, html, wire) {
  closePop();
  const p = document.createElement('div'); p.className = 'cvpop'; p.setAttribute('role', 'dialog'); p.innerHTML = html;
  document.body.appendChild(p);
  const a = anchor.getBoundingClientRect(), pw = p.offsetWidth, ph = p.offsetHeight;
  p.style.left = Math.round(Math.min(Math.max(8, a.left), innerWidth - pw - 8)) + 'px';
  p.style.top = Math.round(a.bottom + 6 + ph > innerHeight - 8 ? Math.max(8, a.top - ph - 6) : a.bottom + 6) + 'px';
  const off = e => { if (!p.contains(e.target) && !anchor.contains(e.target)) closePop(); };
  const key = e => { if (e.key === 'Escape') { closePop(); anchor.focus && anchor.focus(); } };
  setTimeout(() => { document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', key, true); }, 0);
  S.pop = { p, off, key };
  wire(p);
  const f = p.querySelector('input, button'); if (f) f.focus({ preventScroll: true });
  return p;
}
function closePop() {
  const P = S.pop; if (!P) return;
  document.removeEventListener('pointerdown', P.off, true); document.removeEventListener('keydown', P.key, true);
  P.p.remove(); S.pop = null;
}
function saveColors() { store.set(COLOR_KEY, Object.keys(userColors()).length ? userColors() : null); }
function openSigPop(chip, r, n, k, remove) {
  const cur = sigColor(n, k), lanes = isLanes(r), gk = gainOf(r, n);
  const sw = TRACE_COLORS.map(c => `<button type="button" class="pc${c.toLowerCase() === String(cur).toLowerCase() ? ' on' : ''}" data-c="${c}" style="--c:${c}" aria-label="colour ${c}"></button>`).join('');
  popMenu(chip, `<div class="ph tex">${texHTML(shortLab(n))}<span class="pn">${esc(n)}</span></div>` +
    `<div class="pk">Colour</div><div class="pcs">${sw}</div><button type="button" class="pl" data-c="">Default colour</button>` +
    (lanes ? '' : `<div class="pk">Scale (drawn trace only)</div><div class="prow"><span>×</span><input type="number" step="any" min="0" class="pg" value="${fmtGain(gk)}" aria-label="scale factor"><button type="button" class="pl ps">1</button></div>` +
      `<div class="pnote">The readout and the axis keep the true value; the chip shows ×k.</div>`) +
    `<button type="button" class="pl pr">Remove from this row</button>`, p => {
    p.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
      const c = b.dataset.c; if (c) userColors()[n] = c; else delete userColors()[n];
      saveColors(); closePop(); buildRows(); redraw();
    });
    const g = p.querySelector('.pg');
    const setG = v => { v = +v; r.gain = r.gain || {}; if (v > 0 && v !== 1) r.gain[n] = v; else delete r.gain[n]; buildRows(); redraw(); };
    if (g) { g.onchange = () => setG(g.value); g.onkeydown = e => { if (e.key === 'Enter') { setG(g.value); closePop(); } }; }
    const one = p.querySelector('.ps'); if (one) one.onclick = () => { setG(1); closePop(); };
    p.querySelector('.pr').onclick = () => { closePop(); remove(); };
  });
}
function openYPop(yax, r) {
  const AX = rowAxes(r), dd = A => decFor(niceStep(A.lo, A.hi, 4)) + 1;
  const sec = (A, key) => `<div class="pk">${A.side === 'L' ? 'Left' : 'Right'} axis${A.unit ? ' [' + esc(A.unit) + ']' : ''}</div>` +
    `<div class="prow"><input type="number" step="any" data-k="${key}" data-i="0" value="${A.lo.toFixed(dd(A))}" aria-label="minimum">` +
    `<span>to</span><input type="number" step="any" data-k="${key}" data-i="1" value="${A.hi.toFixed(dd(A))}" aria-label="maximum">` +
    `<button type="button" class="pl pa" data-k="${key}">Auto</button></div>`;
  popMenu(yax, sec(AX.L, 'y') + (AX.R ? sec(AX.R, 'y2') : '') +
    '<div class="pnote">Ctrl + wheel on the plot zooms the left axis; double-click the plot: both automatic.</div>', p => {
    const apply = key => {
      const v = [...p.querySelectorAll(`input[data-k="${key}"]`)].map(i => +i.value);
      if (isFinite(v[0]) && isFinite(v[1]) && v[1] > v[0]) { r[key] = v; drawRows(); }
    };
    p.querySelectorAll('input').forEach(i => { i.onchange = () => apply(i.dataset.k); i.onkeydown = e => { if (e.key === 'Enter') { apply(i.dataset.k); closePop(); } }; });
    p.querySelectorAll('.pa').forEach(b => b.onclick = () => { r[b.dataset.k] = null; closePop(); drawRows(); });
  });
}
function drawRows() {
  const grid = css('--grid'), slate = css('--ink-3'), faint = css('--tick'), rule = css('--rule'), lw = 1 / DPR();
  for (const r of S.rows) {
    if (!r.el) continue;                                 // rows not built yet (run still loading)
    const [g, w, h] = sizeCanvas(r.el.base); g.clearRect(0, 0, w, h);
    const [ga, aw, ah] = sizeCanvas(r.el.yax); ga.clearRect(0, 0, aw, ah);
    g.strokeStyle = grid; g.lineWidth = lw;
    for (const tt of niceTicks(S.view[0], S.view[1], nT(w))) { const x = px(X(tt, w)); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    if (!r.sigs.length || r.sigs.some(n => !S.sig[n] || !S.sig[n].data)) continue;
    if (isLanes(r)) {
      const lh = h / r.sigs.length, chips = r.el.chips.children, tl = r.el.chips.previousElementSibling;
      if (tl) tl.style.paddingTop = Math.max(0, (lh - 18) / 2) + 'px';        // '+' on the first lane's centre line
      r.sigs.forEach((n, k) => {
        const y0 = k * lh, y = v => y0 + lh * (0.78 - 0.56 * v), col = sigColor(n, k);
        if (k) { g.strokeStyle = rule; g.lineWidth = lw; g.beginPath(); g.moveTo(0, px(y0)); g.lineTo(w, px(y0)); g.stroke(); }
        if (chips[k]) chips[k].style.top = (y0 + (lh - CHIP) / 2) + 'px';
        // 'on' intervals as a quiet tint of the trace colour
        const { t, v } = S.sig[n].data; let i0 = Math.max(lastLE(t, S.view[0]), 0), i1 = Math.min(lastLE(t, S.view[1]) + 1, t.length - 1);
        g.fillStyle = col; g.globalAlpha = 0.09;
        for (let i = i0; i <= i1; i++) if (v[i] > 0.5) { const xa = Math.max(X(t[i], w), 0), xb = Math.min(i + 1 < t.length ? X(t[i + 1], w) : w, w); g.fillRect(xa, y(1), xb - xa, y(0) - y(1)); }
        g.globalAlpha = 1;
        drawTrace(g, n, w, y, col, 1.25);
      });
      continue;
    }
    const AX = rowAxes(r), { lo, hi } = AX.L;
    r.yr = [lo, hi]; r.yr2 = AX.R ? [AX.R.lo, AX.R.hi] : null;
    const y = v => h - (v - lo) / (hi - lo) * h;
    const nt = Math.max(2, h / 40), d = decFor(niceStep(lo, hi, nt)), ticks = niceTicks(lo, hi, nt);
    ga.font = `${css('--fs-tick')} ${NUMF_()}`; ga.textBaseline = 'middle';
    const ax = aw - 10 - (d ? ga.measureText('.' + '0'.repeat(d)).width : 0);   // shared decimal anchor
    for (const v of ticks) {
      const yy = px(y(v)); if (yy < 1 || yy > h - 1) continue;
      g.strokeStyle = grid; g.lineWidth = lw; g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy); g.stroke();
      ga.strokeStyle = faint; ga.lineWidth = lw; ga.beginPath(); ga.moveTo(aw - 5, yy); ga.lineTo(aw, yy); ga.stroke();
      ga.fillStyle = slate; decText(ga, fmtTick(v, d), ax, Math.min(Math.max(yy, 7), h - 7));
    }
    if (lo < 0 && hi > 0) { g.strokeStyle = css('--zero'); g.lineWidth = lw; g.beginPath(); g.moveTo(0, px(y(0))); g.lineTo(w, px(y(0))); g.stroke(); }
    ga.fillStyle = faint; ga.textAlign = 'left'; ga.textBaseline = 'top'; ga.font = `${css('--fs-tick')} ${NUMF_()}`;
    if (AX.L.held || AX.R) ga.fillText([AX.R ? AX.L.unit : '', AX.L.held ? 'held' : ''].filter(Boolean).join(' · '), 4, 4);
    // each trace on its axis (scaled by its gain); an emphasised signal: the others recede, it is drawn last and heavier
    const yOf = n => { const A = AX.of(n), k = gainOf(r, n); return v => h - (v * k - A.lo) / (A.hi - A.lo) * h; };
    const hl = r.hl && r.sigs.includes(r.hl) ? r.hl : null;
    r.sigs.forEach((n, k) => { if (n === hl) return; g.globalAlpha = hl ? 0.28 : 1; drawTrace(g, n, w, yOf(n), sigColor(n, k), 1.25); });
    g.globalAlpha = 1; if (hl) drawTrace(g, hl, w, yOf(hl), sigColor(hl, r.sigs.indexOf(hl)), 1.8);
    if (AX.R) {                                                  // the second unit's axis: inside the plot's right edge
      const R = AX.R, yr = v => h - (v - R.lo) / (R.hi - R.lo) * h, nt2 = Math.max(2, h / 40), d2 = decFor(niceStep(R.lo, R.hi, nt2));
      g.font = `${css('--fs-tick')} ${NUMF_()}`; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const halo = (s, x, yy) => { g.strokeStyle = css('--surface'); g.lineWidth = 3; g.textAlign = 'right'; g.strokeText(s, x, yy); g.fillStyle = slate; g.fillText(s, x, yy); };
      for (const v of niceTicks(R.lo, R.hi, nt2)) {
        const yy = px(yr(v)); if (yy < 18 || yy > h - 1) continue;          // clear of the unit label at the top
        g.strokeStyle = faint; g.lineWidth = lw; g.beginPath(); g.moveTo(w - 5, yy); g.lineTo(w, yy); g.stroke();
        halo(fmtTick(v, d2), w - 8, Math.min(Math.max(yy, 7), h - 7));
      }
      g.textBaseline = 'top'; halo([R.unit, R.held ? 'held' : ''].filter(Boolean).join(' · '), w - 8, 4);
    }
  }
}
// a short message with an Undo button over the waveforms (the plain toast of snapshot.js does not take clicks)
let undoTimer = 0;
function undoToast(msg, undo) {
  const el = $('#toast'); if (!el) return;
  el.textContent = msg + ' '; el.classList.remove('bad');
  const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Undo';
  b.onclick = () => { clearTimeout(undoTimer); el.classList.remove('on', 'act'); undo(); };
  el.appendChild(b); el.classList.add('on', 'act');
  clearTimeout(undoTimer); undoTimer = setTimeout(() => el.classList.remove('on', 'act'), 6000);
}
function drawCursor() {
  const cur = css('--cursor'), lw = 1 / DPR();
  for (const r of S.rows) {
    if (!r.el) continue;
    const [g, w, h] = sizeCanvas(r.el.top); g.clearRect(0, 0, w, h);
    const x = px(X(S.cur, w)); g.strokeStyle = cur; g.lineWidth = lw; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    r.el.chips.querySelectorAll('.chip').forEach(c => { c.querySelector('.val').innerHTML = sigNum(c.dataset.sig); });
  }
  drawAxis(); drawOverview();
  const E = edgeInfo();
  $('#tcur').textContent = `${(S.cur * 1e3).toFixed(4)} ms`;
  $('#tedge').textContent = E ? `${(E.dt * 1e6).toFixed(2)} µs` : '–';
  $('#egates').innerHTML = E ? gatesHTML(E.gates) : '';
  drawCircuit();
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function drawAxis() {
  const [g, w, h] = sizeCanvas($('#axiscv')); g.clearRect(0, 0, w, h);
  const span = S.view[1] - S.view[0], st = niceStep(S.view[0], S.view[1], nT(w)), us = span < 2e-4, lw = 1 / DPR();
  const ref = us ? Math.floor(S.view[0] * 1e4 + 1e-9) / 1e4 : 0;       // µs labels count from a 0.1-ms mark
  const d = us ? decFor(st * 1e6) : decFor(st * 1e3);
  $('#axlab').innerHTML = us ? `<span class="tex"><i>t</i></span>&nbsp;<span class="u">− ${(ref * 1e3).toFixed(1)} ms, in µs</span>` : '<span class="tex"><i>t</i></span>&nbsp;<span class="u">in ms</span>';
  // time flag at the cursor: in ms with the readout's 4 decimals (µs view: two more than the ticks); tabular digits, width from the
  // digit count only, so neither the flag nor its text moves sideways while the value changes
  const xc = px(X(S.cur, w)), cur = css('--cursor'), F = NUMF_(), fs = css('--fs-tick');
  const flag = us ? ((S.cur - ref) * 1e6).toFixed(Math.min(d + 2, 3)) : (S.cur * 1e3).toFixed(4);
  g.font = `600 ${fs} ${F}`;
  const fw = Math.ceil(tabWidth(g, flag)) + 14, fh = 18, fy = 7;
  const fx = Math.round(Math.min(Math.max(xc - fw / 2, 0), w - fw));
  g.font = `${fs} ${F}`; g.textBaseline = 'alphabetic';
  for (const tt of niceTicks(S.view[0], S.view[1], nT(w))) {
    const x = px(X(tt, w)); g.strokeStyle = css('--tick'); g.lineWidth = lw; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 5); g.stroke();
    const lbl = us ? ((tt - ref) * 1e6).toFixed(d) : (tt * 1e3).toFixed(d), tw = tabWidth(g, lbl);
    if (x < tw / 2 + 4 || x > w - tw / 2 - 4) continue;                    // no label squeezed against an edge
    const lx = x;
    if (lx + tw / 2 > fx - 6 && lx - tw / 2 < fx + fw + 6) continue;       // the flag covers this label
    g.fillStyle = css('--ink-3'); tabText(g, lbl, lx, 20.5, 'center');
  }
  g.strokeStyle = cur; g.lineWidth = lw; g.beginPath(); g.moveTo(xc, 0); g.lineTo(xc, fy); g.stroke();
  g.fillStyle = cur; roundRect(g, fx, fy, fw, fh, +css('--flag-r') || 0); g.fill();
  g.font = `600 ${fs} ${F}`; g.fillStyle = '#fff'; tabText(g, flag, fx + fw / 2, fy + 13, 'center');
}
const tabWidth = (g, s) => { const d = g.measureText('0').width; return [...s].reduce((a, ch) => a + (/[0-9]/.test(ch) ? d : g.measureText(ch).width), 0); };
function drawOverview() {
  const [o, ow, oh] = sizeCanvas($('#overcv')); o.clearRect(0, 0, ow, oh);
  const OX = t => (t - S.t0) / (S.t1 - S.t0) * ow, lw = 1 / DPR();
  if (S.sig.i_a && S.sig.i_a.data) { const { t, v } = S.sig.i_a.data; o.strokeStyle = css('--ov-trace'); o.lineWidth = 1; o.beginPath(); for (let i = 0; i < t.length; i += Math.max(1, (t.length / ow) | 0)) { const x = OX(t[i]), yy = oh / 2 - v[i] / S.imax * oh * 0.36; i ? o.lineTo(x, yy) : o.moveTo(x, yy); } o.stroke(); }
  const a = Math.round(OX(S.view[0])), b = Math.max(Math.round(OX(S.view[1])), a + 3);
  o.fillStyle = css('--ov-win'); o.fillRect(a, 3, b - a, oh - 6);
  o.strokeStyle = css('--ov-edge'); o.lineWidth = lw; o.strokeRect(a + 0.5, 3.5, b - a - 1, oh - 7);
  const xc = px(OX(S.cur)); o.strokeStyle = css('--cursor'); o.beginPath(); o.moveTo(xc, 0); o.lineTo(xc, oh); o.stroke();
}
function syncGutter() {
  const R = $('#rows'), sb = R.offsetWidth - R.clientWidth;
  if (css('--sbw') !== sb + 'px') document.documentElement.style.setProperty('--sbw', sb + 'px');
}
function redraw() { if (!S.meta) return; setLayout(); syncGutter(); drawRows(); drawCursor(); }

// ---------------------------------------------------------------- panels and layout
// Four panels: circuit (#circ), space vectors (#svm, three-level runs only: svm.js calls setPanelAvail), details
// (#infobox), waveforms (#waves). Each can be hidden (toolbar 'Panels', keys 1-4, the x in its header); the last one
// shown cannot be hidden. One layout for every circuit (the user's choice, 2026-11-04; root class lay-tall):
//   circ column --circw on the left, full height; on the right [svm --svmw | info 1fr] (height --infoh) over the
//   waveforms. A wide drawing fits the column's width (at most 55 % of the window) and leaves room under it.
// setLayout writes main's grid (columns, rows, areas) from the panels shown: a hidden panel drops its track and its
// neighbours take the space. Every edge between two shown panels is a splitter (#sp-v1, #sp-v2, #sp-h): dragging it
// (or the arrow keys on it) sizes the fixed track next to it; double-click / Enter returns that size to its default.
// Sizes are remembered per circuit (circuitview.layout.<circuit>.tall), the panel set globally (circuitview.panels).
// The names setLayout, --circw and lay-tall are kept: office/live/live.js patches setLayout and sets --circw after it.
// a self-contained export (EMB) writes nothing: the file:// origin is shared by every exported file
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { if (EMB) return; try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* no storage */ } } };
const PANELS = ['circ', 'svm', 'info', 'waves'];
const PANEL_EL = { circ: 'circ', svm: 'svm', info: 'infobox', waves: 'waves' };
const PANEL_KEY = 'circuitview.panels';
const PV = (() => {                                             // shown (the user's choice) per panel
  const saved = store.get(PANEL_KEY), v = Object.assign({ circ: true, svm: true, info: true, waves: true }, saved || {});
  if (!saved && store.get('circuitview.svm') === false) v.svm = false;   // svm.js's former switch
  return v;
})();
const PAVAIL = { circ: true, svm: false, info: true, waves: true };   // available in this run (svm: set by svm.js)
const panelShown = id => !!(PAVAIL[id] && PV[id]);
const GAP = 8, PANE_H = 32;
const MIN = { circW: 280, svm: 160, infoW: 300, infoH: 120, wavesW: 360, wavesH: 130 };
const LAYMEM = {};                                              // sizes in memory (also when nothing can be stored)
let LAY = null;                                                 // the last plan: sizes and splitter roles (drag)
function layoutMode() {
  const vb = S.circ && S.circ.svg.viewBox.baseVal, a = vb && vb.height ? vb.width / vb.height : 2;
  return { a, key: 'circuitview.layout.' + (S.circName || '-') + '.tall' };
}
function savedSizes(key) {
  if (!LAYMEM[key]) {
    let s = store.get(key);
    if (!s || typeof s !== 'object') {                          // the former single splitter size
      const old = store.get(key.replace('.layout.', '.split.'));
      s = typeof old === 'number' ? { circw: old } : {};
    }
    LAYMEM[key] = s;
  }
  return LAYMEM[key];
}
function saveSizes(key) { const s = LAYMEM[key]; store.set(key, s && Object.keys(s).length ? s : null); }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
const wavesKeep = H => Math.min(300, Math.round(0.4 * H));             // default height kept for the waveforms
const svmSide = h => Math.max(MIN.svm, Math.round(h - PANE_H - 52));    // square diagram: row height - header - readout
// the plan of one layout: grid columns / rows / areas, the size variables and, per splitter, the size it moves
function planLayout(W, H, a, sv) {
  const sh = panelShown, collapsed = $('#infobox').classList.contains('collapsed');
  const vals = {}, cols = [], areas = [], rows = [], sp = {};
  const mid = ['svm', 'info'].filter(sh), waves = sh('waves'), circ = sh('circ');
  // ---- circ column | [svm | info] over the waveforms
  const right = mid.length > 0 || waves;
  const rightMin = Math.max(waves ? MIN.wavesW : 0, (sh('svm') ? MIN.svm : 0) + (sh('info') ? MIN.infoW : 0) + (mid.length > 1 ? GAP : 0));
  let circw = sv.circw;
  if (!circw) {
    const svgH = H - 2 - 16 - 80;                               // card border, svghost insets (tall)
    circw = Math.min(0.55 * innerWidth, svgH * a + 48 + 2, W - GAP - 560);
  }
  circw = circ && right ? Math.round(clamp(circw, MIN.circW, Math.max(MIN.circW, W - GAP - rightMin))) : W;
  const rightW = circ ? W - GAP - circw : W;
  const topAuto = !sh('svm') && collapsed;                      // Details alone and collapsed: its header only
  let infoh = sv.infoh || Math.round(Math.max(160, Math.min(0.45 * H, H - GAP - wavesKeep(H))));
  infoh = waves ? Math.round(clamp(infoh, sh('svm') ? MIN.svm + PANE_H + 40 : MIN.infoH, Math.max(MIN.infoH, H - GAP - MIN.wavesH))) : H;
  let svmw = sv.svmw || (sh('info') ? Math.min(svmSide(infoh), Math.round(0.5 * (rightW - GAP))) : svmSide(infoh));
  if (sh('info')) svmw = Math.round(clamp(svmw, MIN.svm, Math.max(MIN.svm, rightW - GAP - MIN.infoW)));
  Object.assign(vals, { circw, infoh, svmw });
  const rcols = [], rtop = [];
  mid.forEach((id, k) => {
    if (k) { rcols.push(GAP + 'px'); rtop.push('sp-v2'); sp['sp-v2'] = { dir: 'x', A: 'svmw', B: null }; }
    rcols.push(id === 'svm' && mid.length > 1 ? 'var(--svmw)' : 'minmax(0, 1fr)'); rtop.push(id);
  });
  if (!rcols.length && waves) rcols.push('minmax(0, 1fr)');
  const left = circ ? ['circ', ...(right ? ['sp-v1'] : [])] : [];
  if (circ) cols.push(right ? 'var(--circw)' : 'minmax(0, 1fr)', ...(right ? [GAP + 'px'] : []));
  if (circ && right) sp['sp-v1'] = { dir: 'x', A: 'circw', B: null };
  cols.push(...rcols);
  if (mid.length) { areas.push([...left, ...rtop]); rows.push(waves ? (topAuto ? 'auto' : 'var(--infoh)') : 'minmax(0, 1fr)'); }
  if (mid.length && waves) { areas.push([...left, ...rcols.map(() => 'sp-h')]); rows.push(GAP + 'px'); sp['sp-h'] = { dir: 'y', A: topAuto ? null : 'infoh', B: null }; }
  if (waves) { areas.push([...left, ...rcols.map(() => 'waves')]); rows.push('minmax(0, 1fr)'); }
  if (!areas.length) { areas.push(left); rows.push('minmax(0, 1fr)'); }
  return { cols, rows, areas, vals, sp };
}
function setLayout() {
  const { a, key } = layoutMode(), root = document.documentElement, main = $('main');
  root.classList.add('lay-tall');
  const cs = getComputedStyle(main);
  const W = main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const H = main.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (!(W > 0 && H > 0)) return;
  const L = planLayout(W, H, a, savedSizes(key));
  const set = (p, v) => { if (main.style[p] !== v) main.style[p] = v; };
  set('gridTemplateColumns', L.cols.join(' ')); set('gridTemplateRows', L.rows.join(' '));
  set('gridTemplateAreas', L.areas.map(r => '"' + r.join(' ') + '"').join(' '));
  for (const k in L.vals) if (isFinite(L.vals[k])) { const v = Math.round(L.vals[k]) + 'px'; if (root.style.getPropertyValue('--' + k) !== v) root.style.setProperty('--' + k, v); }
  for (const id of ['sp-v1', 'sp-v2', 'sp-h']) {
    const el = $('#' + id), s = L.sp[id], live = !!(s && (s.A || s.B));
    el.hidden = !s; el.classList.toggle('inert', !!s && !live);
    if (!s) continue;
    el.setAttribute('aria-orientation', s.dir === 'x' ? 'vertical' : 'horizontal');
    el.tabIndex = live ? 0 : -1;
    if (live) el.setAttribute('aria-valuenow', String(Math.round(L.vals[s.B || s.A]))); else el.removeAttribute('aria-valuenow');
    el.setAttribute('aria-label', live ? 'panel edge: drag or use the arrow keys to resize; Enter: default size' : 'panel edge');
    el.title = live ? 'drag to resize (double-click: default size)' : '';
  }
  LAY = { key, ...L };
}
// panel switches: toolbar buttons (aria-pressed), the x in each panel header; the last panel shown stays
function syncPanelUI() {
  const shown = PANELS.filter(panelShown);
  for (const id of PANELS) {
    const el = document.getElementById(PANEL_EL[id]); if (el) el.hidden = !panelShown(id);
    document.querySelectorAll(`#panels [data-panel="${id}"]`).forEach(b => {
      b.hidden = !PAVAIL[id]; b.setAttribute('aria-pressed', String(panelShown(id)));
      b.disabled = shown.length === 1 && panelShown(id);
    });
  }
  document.querySelectorAll('.pane-x').forEach(b => { b.disabled = shown.length === 1; });
}
function setPanelAvail(id, ok) { PAVAIL[id] = !!ok; syncPanelUI(); }
function setPanel(id, on) {
  if (!PAVAIL[id] || panelShown(id) === !!on) return;
  if (!on && PANELS.filter(panelShown).length <= 1) return;
  const a = document.activeElement, inside = !on && a && a.closest && a.closest('#' + PANEL_EL[id]);
  PV[id] = !!on; store.set(PANEL_KEY, PV); syncPanelUI();
  if (inside) { const b = $(`#panels [data-panel="${id}"]`); if (b && !b.hidden) b.focus(); else blurControls(); }
  setLayout(); redraw();
}
function setDetailsOpen(open) {
  const ib = $('#infobox'), ih = $('#infohead');
  ib.classList.toggle('collapsed', !open); ih.setAttribute('aria-expanded', String(open)); store.set('circuitview.details', open);
}
function resetLayout() {
  const key = layoutMode().key; LAYMEM[key] = {}; store.set(key, null);
  for (const id of PANELS) PV[id] = true;
  store.set(PANEL_KEY, PV); setDetailsOpen(true); syncPanelUI(); setLayout(); redraw();
}
function wireSplit() {
  // splitters: drag, arrow keys (16 px, Shift 64 px), Home / End (smallest / largest), Enter or double-click (default)
  const move = (sp, d, from) => {                               // move the edge by d px from the plan 'from'
    const s = from.sp[sp.id]; if (!s || !(s.A || s.B)) return;
    const v = s.B || s.A, sv = savedSizes(from.key);
    sv[v] = Math.round(from.vals[v] + (s.B ? -d : d));
    setLayout(); if (LAY.vals[v] !== undefined) sv[v] = Math.round(LAY.vals[v]);   // keep what is shown (clamped)
    saveSizes(from.key); redraw();
  };
  const reset = sp => {
    const s = LAY && LAY.sp[sp.id]; if (!s || !(s.A || s.B)) return;
    delete savedSizes(LAY.key)[s.B || s.A]; saveSizes(LAY.key); setLayout(); redraw();
  };
  const snap = () => ({ ...LAY, vals: { ...LAY.vals } });
  for (const sp of document.querySelectorAll('.sp')) {
    sp.addEventListener('pointerdown', e => {
      const s = LAY && LAY.sp[sp.id];
      if (!s || !(s.A || s.B) || e.button !== 0) return;
      e.preventDefault(); capture(sp, e);
      const from = snap(), x0 = e.clientX, y0 = e.clientY;
      document.body.classList.add('dragging', s.dir === 'x' ? 'drag-x' : 'drag-y'); sp.classList.add('on');
      const mv = ev => move(sp, s.dir === 'x' ? ev.clientX - x0 : ev.clientY - y0, from);
      const up = () => {
        sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up); sp.removeEventListener('pointercancel', up);
        document.body.classList.remove('dragging', 'drag-x', 'drag-y'); sp.classList.remove('on');
      };
      sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up); sp.addEventListener('pointercancel', up);
    });
    sp.addEventListener('dblclick', () => reset(sp));
    sp.addEventListener('keydown', e => {
      const s = LAY && LAY.sp[sp.id]; if (!s || !(s.A || s.B)) return;
      const k = e.key, step = e.shiftKey ? 64 : 16;
      const fwd = s.dir === 'x' ? 'ArrowRight' : 'ArrowDown', back = s.dir === 'x' ? 'ArrowLeft' : 'ArrowUp';
      let d = null;
      if (k === fwd) d = step; else if (k === back) d = -step;
      else if (k === 'Home') d = s.B ? 1e5 : -1e5; else if (k === 'End') d = s.B ? -1e5 : 1e5;
      else if (k === 'Enter') { e.preventDefault(); reset(sp); return; }
      if (d === null) return;
      e.preventDefault(); e.stopPropagation(); move(sp, d, snap());
    });
  }
  // panel switches and the x in each panel header
  document.querySelectorAll('#panels [data-panel]').forEach(b => { b.onclick = () => setPanel(b.dataset.panel, !panelShown(b.dataset.panel)); });
  document.querySelectorAll('.pane-x').forEach(b => { b.onclick = e => { e.stopPropagation(); setPanel(b.dataset.hide, false); }; });
  // Details: collapse to its header (with the leg summary)
  const ib = $('#infobox'), ih = $('#infohead');
  $('#info').addEventListener('scroll', moreFade, { passive: true }); addEventListener('resize', moreFade);
  ih.addEventListener('click', () => { setDetailsOpen(ib.classList.contains('collapsed')); setLayout(); redraw(); });
  if (store.get('circuitview.details') === false) setDetailsOpen(false);
  // the keys popover ('?'): mouse and keyboard reference, Reset layout
  const kb = $('#keysbtn'), km = $('#keys');
  const closeKeys = () => { km.hidden = true; kb.setAttribute('aria-expanded', 'false'); };
  const openKeys = () => {
    if (S.closeSet) S.closeSet();                                 // one popover at a time
    const r = kb.getBoundingClientRect(); km.hidden = false;
    km.style.top = (r.bottom + 6) + 'px'; km.style.left = Math.max(8, Math.min(r.right - km.offsetWidth, innerWidth - km.offsetWidth - 8)) + 'px';
    kb.setAttribute('aria-expanded', 'true'); $('#relayout').focus({ preventScroll: true });
  };
  kb.onclick = e => { e.stopPropagation(); if (km.hidden) openKeys(); else closeKeys(); };
  $('#relayout').onclick = () => { closeKeys(); resetLayout(); };
  addEventListener('click', e => { if (!km.hidden && !km.contains(e.target)) closeKeys(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !km.hidden) { closeKeys(); kb.focus(); } });
  S.toggleKeys = () => { if (km.hidden) openKeys(); else { closeKeys(); kb.focus(); } };
  // the settings popover (gear): load symbol
  const sb = $('#setbtn'), sm = $('#settings');
  const closeSet = () => { sm.hidden = true; sb.setAttribute('aria-expanded', 'false'); };
  const openSet = () => {
    closeKeys(); syncSettings(); const r = sb.getBoundingClientRect(); sm.hidden = false;
    sm.style.top = (r.bottom + 6) + 'px'; sm.style.left = Math.max(8, Math.min(r.right - sm.offsetWidth, innerWidth - sm.offsetWidth - 8)) + 'px';
    sb.setAttribute('aria-expanded', 'true'); const c = sm.querySelector('input:checked') || sm.querySelector('input:not(:disabled)'); if (c) c.focus({ preventScroll: true });
  };
  S.closeSet = closeSet;
  sb.hidden = !!EMB;                                               // an exported file carries one drawing only
  sb.onclick = e => { e.stopPropagation(); if (sm.hidden) openSet(); else closeSet(); };
  addEventListener('click', e => { if (!sm.hidden && !sm.contains(e.target)) closeSet(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !sm.hidden) { closeSet(); sb.focus(); } });
  syncPanelUI(); setLayout();
}
// ---------------------------------------------------------------- interaction
function setView(a, b) {
  const minSpan = 2e-6, span = Math.max(b - a, minSpan), full = S.t1 - S.t0;
  if (span >= full) { S.view = [S.t0, S.t1]; return; }
  if (a < S.t0) a = S.t0; if (a + span > S.t1) a = S.t1 - span; S.view = [a, a + span];
}
function capture(el, e) { try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic or lost pointer */ } }
function blurControls() { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); }
function attachPlot(plot, r) {
  plot.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey && r && r.yr && !isLanes(r)) {                       // y zoom around the mouse (row holds its range)
      const h = plot.clientHeight, [lo, hi] = r.yr, vm = hi - e.offsetY / h * (hi - lo), k = e.deltaY > 0 ? 1.25 : 0.8;
      r.y = [vm - (vm - lo) * k, vm + (hi - vm) * k]; drawRows(); return;
    }
    const w = plot.clientWidth, tm = T(e.offsetX, w), k = e.deltaY > 0 ? 1.25 : 0.8;
    setView(tm - (tm - S.view[0]) * k, tm + (S.view[1] - tm) * k); redraw();
  }, { passive: false });
  plot.addEventListener('contextmenu', e => e.preventDefault());
  plot.addEventListener('pointerdown', e => {
    blurControls();
    capture(plot, e); const w = plot.clientWidth, pan = e.shiftKey || e.button === 2 || e.button === 1;
    const x0 = e.clientX, v0 = S.view.slice();
    const move = ev => {
      if (pan) { const dt = (ev.clientX - x0) / w * (v0[1] - v0[0]); setView(v0[0] - dt, v0[1] - dt); redraw(); }
      else { S.cur = Math.min(S.t1, Math.max(S.t0, T(ev.clientX - plot.getBoundingClientRect().left, w))); drawCursor(); }
    };
    move(e);
    const up = () => { plot.removeEventListener('pointermove', move); plot.removeEventListener('pointerup', up); };
    plot.addEventListener('pointermove', move); plot.addEventListener('pointerup', up);
  });
  if (r) plot.addEventListener('dblclick', () => { r.y = null; r.y2 = null; r.h = null; r.el.row.style.height = rowH(r) + 'px'; redraw(); });
}
function attachResize(rz, r) {
  rz.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation(); blurControls();
    capture(rz, e); const h0 = r.el.row.offsetHeight, y0 = e.clientY;
    const mv = ev => { r.h = Math.min(640, Math.max(minH(r), Math.round(h0 + ev.clientY - y0))); r.el.row.style.height = r.h + 'px'; redraw(); };
    const up = () => { rz.removeEventListener('pointermove', mv); rz.removeEventListener('pointerup', up); };
    rz.addEventListener('pointermove', mv); rz.addEventListener('pointerup', up);
  });
  rz.addEventListener('dblclick', () => { r.h = null; r.el.row.style.height = rowH(r) + 'px'; redraw(); });
}
function jumpEdge(dir) {
  const E = S.edges; if (!E || !E.length) return;
  // the cursor lands 1 ns after an edge, so it shows the new state
  const tgt = dir > 0 ? E[lastLE(E, S.cur + 1e-10) + 1] : E[lastLE(E, S.cur - 2e-9)];
  if (tgt === undefined) return;
  S.cur = tgt + 1e-9;
  if (S.cur < S.view[0] || S.cur > S.view[1]) { const s = S.view[1] - S.view[0]; setView(S.cur - s / 2, S.cur + s / 2); drawRows(); }
  drawCursor();
}
function zoomAround(span) { setView(S.cur - span / 2, S.cur + span / 2); redraw(); }
function resetView() {
  S.view = [S.t0, S.t1]; S.rows.forEach(r => { r.y = null; r.h = null; r.hl = null; });   // the panel layout stays (Reset layout: '?')
  buildRows(); redraw();
}
function wireUI() {
  $('#fit').onclick = () => { S.view = [S.t0, S.t1]; redraw(); };
  $('#per').onclick = () => zoomAround(S.meta.Tsp || (S.t1 - S.t0) / 100);
  $('#cyc').onclick = () => zoomAround(0.02);
  $('#reset').onclick = resetView;
  $('#prev').onclick = () => jumpEdge(-1); $('#next').onclick = () => jumpEdge(1);
  $('#flow').setAttribute('aria-pressed', String(FLOW.on)); $('#flow').onclick = () => setFlow(!FLOW.on);
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel'])
    addEventListener(ev, () => { FLOW.input = performance.now(); if (FLOW.idle) { FLOW.idle = false; flowStart(); } }, { passive: true, capture: true });
  $('#addrow').onclick = () => { S.rows.push({ sigs: [] }); buildRows(); redraw(); const R = $('#rows'); R.scrollTop = R.scrollHeight; };
  $('#run').onchange = () => { $('#run').blur(); runTitle(); openRun($('#run').value); };
  addEventListener('keydown', e => {
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {          // always the time cursor, also when a select has focus
      e.preventDefault(); if (e.target.tagName === 'SELECT') e.target.blur();
      const d = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) { S.cur = Math.min(S.t1, Math.max(S.t0, S.cur + d * 1e-6)); drawCursor(); } else jumpEdge(d);
      return;
    }
    // panels: 1-4 show / hide, 0 all panels at their default sizes, ? the keys popover
    if (e.ctrlKey || e.altKey || e.metaKey || e.target.tagName === 'SELECT') return;
    const P = { 1: 'circ', 2: 'svm', 3: 'info', 4: 'waves' }[e.key];
    if (P) { e.preventDefault(); setPanel(P, !panelShown(P)); }
    else if (e.key === '0') { e.preventDefault(); resetLayout(); }
    else if (e.key === '?' && S.toggleKeys && !$('#keysbtn').hidden && getComputedStyle($('#keysbtn')).display !== 'none') { e.preventDefault(); S.toggleKeys(); }
  });
  addEventListener('resize', redraw);
  new ResizeObserver(() => { if (S.meta) redraw(); }).observe($('#waves'));
  (function dpr() {             // zoom or another monitor changes the device pixel ratio but not the CSS size: redraw the canvases sharp
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { if (S.meta) redraw(); dpr(); }, { once: true });
  })();
  attachPlot($('#axplot'));
  const ov = $('#over');
  ov.addEventListener('pointerdown', e => {
    blurControls(); capture(ov, e);
    const go = ev => { const r = ov.querySelector('canvas').getBoundingClientRect(), t = S.t0 + (ev.clientX - r.left) / r.width * (S.t1 - S.t0), s = S.view[1] - S.view[0]; setView(t - s / 2, t + s / 2); redraw(); };
    go(e); const up = () => { ov.removeEventListener('pointermove', go); ov.removeEventListener('pointerup', up); };
    ov.addEventListener('pointermove', go); ov.addEventListener('pointerup', up);
  });
  ov.addEventListener('keydown', e => {                           // focused overview: the arrow keys move the view
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); e.stopPropagation();
    const s = S.view[1] - S.view[0], d = (e.key === 'ArrowRight' ? 1 : -1) * s * (e.shiftKey ? 1 : 0.25);
    setView(S.view[0] + d, S.view[1] + d); redraw();
  });
  wireSplit();
}
// the run list shows the title cut to the box: the whole title as its tooltip
function runTitle() { const o = $('#run').selectedOptions[0]; $('#run').title = o ? o.textContent : 'simulation run'; }
(async function main() {
  wireUI();
  S.runs = await getJSON('/api/runs');
  $('#run').innerHTML = S.runs.map(r => `<option value="${esc(r.id)}">${esc(plainText(r.title))}${r.synthetic && !/synthetic/i.test(r.title) ? ' (synthetic)' : ''}</option>`).join('');
  const want = new URLSearchParams(location.search).get('run');
  const first = (want && S.runs.find(r => r.id === want)) || S.runs.find(r => /SQ1_m080_phip60$/.test(r.id)) || S.runs[0];
  if (first) { $('#run').value = first.id; await openRun(first.id); }
  const tq = parseFloat(new URLSearchParams(location.search).get('t'));      // ?t=<ms>: cursor time (figures, links)
  if (EMB && EMB.state) await applyState(EMB.state);
  else if (isFinite(tq) && S.meta) { S.cur = Math.min(S.t1, Math.max(S.t0, tq / 1e3)); drawCursor(); }
})();
