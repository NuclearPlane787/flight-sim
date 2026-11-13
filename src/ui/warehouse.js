// v0.5.0: the Warehouse, a page of the main menu (menu.js opens it). The list of designs (New from one of
// the three types, Duplicate, Rename, Delete; a click opens one), and the editor: the aircraft in 3D on its own
// canvas (drag to go round it, pinch or scroll to zoom, as in 3rd person), the parts beside it and the numbers
// that follow from them, live (src/sim/designs.js designNumbers()), with warnings in amber and red.
// Styles in warehouse.css (fsw-*, linked on the first open); rows and buttons reuse menu.css and ui.css.
//
//   const wh = createWarehouse(root, { store? });   store: a DesignStore (src/designs-store.js), the page's by default
//   wh.open(); wh.close(); wh.isOpen; wh.onclose = () => {}
//
// The 3D view (three.js and the models, src/type-assets.js) loads on the first editor, renders only on demand
// while the editor is open (a drag, a zoom, a rebuild), and is disposed (its renderer, its WebGL context, its
// listeners and timers) when the editor closes: nothing runs once you go back. The page needs no keys but the
// name and registration typed; Esc goes back.
//
// The pure parts (readout(), editDesign(), engineLabel(), viewKey(), orbit maths) have no DOM and are tested in
// node (tests/warehouse.test.mjs).

import { designDef, designNumbers, normalizeDesign, stationRange, COUNTS, RANGES } from '../sim/designs.js';
import { ENGINE_LIST, ENGINE_TYPES } from '../sim/engine-types.js';
import { TYPES, TYPE_LIST } from '../sim/types.js';
import { cleanName, nameOk, NAME_MIN, NAME_MAX } from '../scenarios.js';
import { designStore } from '../designs-store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const kg = (v) => `${Math.round(v).toLocaleString('en-US')} kg`;
const m2 = (v) => `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(2)} m`;
const pct = (v, d = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d)} %`;

// ---- The pure parts ----

// Where the warnings start (amber); red is a failure (a pylon over its limit) or a touch (clearance ≤ 0).
export const WARN = { clearM: 0.3, pylonFrac: 0.9, thrustToWeight: 0.22, payloadFrac: 0.5 };

// Engine i's place, in designs.js's order: the left wing outboard to inboard, (the tail), the right inboard to outboard.
export function engineLabel(i, count) {
  const p = count === 3 ? 1 : count / 2, tail = count === 3;
  const L = { 1: ['Left'], 2: ['Left outboard', 'Left inboard'], 3: ['Left outer', 'Left middle', 'Left inner'] }[p];
  const R = { 1: ['Right'], 2: ['Right inboard', 'Right outboard'], 3: ['Right inner', 'Right middle', 'Right outer'] }[p];
  if (i < p) return L[i];
  if (tail && i === p) return 'Tail';
  return R[i - p - (tail ? 1 : 0)] ?? `Engine ${i + 1}`;
}
// The pairs' names for the station sliders, inboard first.
export function pairLabel(k, pairs) {
  if (pairs === 1) return 'Station';
  if (pairs === 2) return k === 0 ? 'Inboard pair' : 'Outboard pair';
  return ['Inner pair', 'Middle pair', 'Outer pair'][k] ?? `Pair ${k + 1}`;
}

const lvl = (bad, warn) => (bad ? 'bad' : warn ? 'warn' : 'ok');

// The editor's numbers for a design: rows (label, value, level, note), one entry per engine, and the problems.
export function readout(design) {
  const d = normalizeDesign(design), def = designDef(d), n = designNumbers(def);
  const T = TYPES[d.base], A0 = T.data, base = designNumbers(designDef({ ...d, engine: ENGINE_LIST.find((e) => e.from === d.base)?.id, count: 2, stations: [T.geo.ENGINES[0].y], thrustScale: 1, oewDeltaKg: 0, fuelCapacityKg: A0.FUEL_MAX, gearExtendM: 0 }));
  const issues = [];
  const rows = [];
  const add = (k, label, value, level = 'ok', note = '') => { rows.push({ k, label, value, level, note }); if (level !== 'ok' && note) issues.push({ level, text: note }); };
  add('oew', 'Empty weight (OEW)', kg(n.oewKg), 'ok', '');
  add('mtow', 'MTOW (the base’s)', kg(n.mtowKg));
  const payBad = n.payloadMaxKg <= 0, payWarn = n.payloadMaxKg < WARN.payloadFrac * base.payloadMaxKg;
  add('payload', 'Payload room (MZFW − OEW)', kg(n.payloadMaxKg), lvl(payBad, payWarn),
    payBad ? 'No payload left: the empty weight is at the base’s MZFW.' : payWarn ? 'Under half the base’s payload room: heavier engines eat into it.' : '');
  const fuelRoom = n.mtowKg - n.oewKg - n.payloadKg;
  // Not a warning (the 777-300ER's own full tanks and default load are over MTOW): what MTOW leaves, beside it.
  add('fuel', 'Fuel capacity', kg(n.fuelCapacityKg) + (n.fuelCapacityKg > fuelRoom ? ` (MTOW allows ${kg(Math.max(0, fuelRoom))})` : ''));
  const twWarn = n.thrustToWeight < WARN.thrustToWeight;
  add('tw', 'Thrust to weight at MTOW', n.thrustToWeight.toFixed(2), lvl(false, twWarn), twWarn ? 'Little thrust for the weight: a long take-off roll and a slow climb.' : '');
  add('range', 'Range (default load, full fuel up to MTOW)', `${Math.round(n.rangeNm).toLocaleString('en-US')} nm`);
  add('tail', 'Tail-strike angle', `${n.tailStrikeDeg.toFixed(1)}°`);
  const engines = n.engines.map((e) => {
    const restLvl = e.tail ? 'ok' : lvl(e.clearRestM <= 0, e.clearRestM < WARN.clearM);
    const tsLvl = e.tail ? 'ok' : lvl(e.clearTailStrikeM <= 0, e.clearTailStrikeM < WARN.clearM);
    const pyLvl = lvl(e.pylonFrac > 1, e.pylonFrac > WARN.pylonFrac);
    return { ...e, label: engineLabel(e.i, d.count), restLvl, tsLvl, pyLvl };
  });
  const touchRest = engines.filter((e) => e.restLvl === 'bad'), touchTs = engines.filter((e) => e.tsLvl === 'bad' && e.restLvl !== 'bad');
  const pyBad = engines.filter((e) => e.pyLvl === 'bad');
  if (touchRest.length) issues.unshift({ level: 'bad', text: `${touchRest.length === engines.filter((e) => !e.tail).length ? 'The nacelles touch' : touchRest.map((e) => e.label).join(', ') + ' touch'} the ground standing: it would scrape. Lengthen the gear or move the engines.` });
  if (touchTs.length) issues.unshift({ level: 'bad', text: `${touchTs.map((e) => e.label).join(', ')}: the nacelle strikes the ground before the tail does on rotation. Lengthen the gear.` });
  if (n.overlap) issues.unshift({ level: 'bad', text: 'The nacelles overlap: this many of these engines don’t fit on this wing. Fewer engines, a smaller type, or spread the pairs.' });
  if (pyBad.length) issues.unshift({ level: 'bad', text: `Full thrust is past the pylons’ limit (${Math.round(Math.max(...pyBad.map((e) => e.pylonFrac)) * 100)} %): the engines tear off at take-off. Lower the thrust scale.` });
  const lowRest = engines.filter((e) => e.restLvl === 'warn' || e.tsLvl === 'warn');
  if (lowRest.length) issues.push({ level: 'warn', text: `Under ${WARN.clearM} m of ground clearance (${lowRest.map((e) => e.label).join(', ')}): a firm landing or a crosswind could scrape.` });
  const pyWarn = engines.filter((e) => e.pyLvl === 'warn');
  if (n.thrustToWeight > 1) issues.push({ level: 'warn', text: `Thrust to weight over 1 (${n.thrustToWeight.toFixed(2)}): full thrust on the runway can pitch the nose up into a tail strike. Take off with the levers part way.` });
  if (pyWarn.length) issues.push({ level: 'warn', text: `The pylons carry over ${Math.round(WARN.pylonFrac * 100)} % of their limit at full thrust.` });
  const worst = issues.some((i) => i.level === 'bad') ? 'bad' : issues.length ? 'warn' : 'ok';
  return { design: d, def, numbers: n, base, rows, engines, issues, worst };
}

// One part changed, the design normalized. `key`: name, registration, count, engine, station (with index),
// thrustScale, oewFrac (a fraction of the base's OEW), fuelFrac (of the base's capacity), gearExtendM.
export function editDesign(design, key, value, index = 0) {
  const d = normalizeDesign(design), A = TYPES[d.base].data;
  const v = typeof value === 'string' && key !== 'name' && key !== 'registration' && key !== 'engine' ? Number(value) : value;
  switch (key) {
    case 'name': return normalizeDesign({ ...d, name: String(v) });
    case 'registration': return normalizeDesign({ ...d, registration: String(v) });
    case 'count': {
      const count = COUNTS.includes(+v) ? +v : d.count;
      // A new count starts from the default stations (designs.js), not from the old ones squeezed.
      return normalizeDesign({ ...d, count, stations: count === d.count ? d.stations : [] });
    }
    case 'engine': return normalizeDesign({ ...d, engine: ENGINE_TYPES[v] ? v : d.engine, stations: d.stations });
    case 'station': { const s = d.stations.slice(); s[index] = v; return normalizeDesign({ ...d, stations: s }); }
    case 'thrustScale': return normalizeDesign({ ...d, thrustScale: v });
    case 'oewFrac': return normalizeDesign({ ...d, oewDeltaKg: Math.round(v * A.OEW) });
    case 'fuelFrac': return normalizeDesign({ ...d, fuelCapacityKg: Math.round((v * A.FUEL_MAX) / 10) * 10 });
    case 'gearExtendM': return normalizeDesign({ ...d, gearExtendM: v });
    default: return d;
  }
}

// What the 3D model depends on: a change here rebuilds it.
export const viewKey = (d) => JSON.stringify([d.base, d.engine, d.count, d.stations, d.gearExtendM, d.registration]);

// The view's orbit, as camera.js's 3rd person: a drag of one screen height turns DRAG_ORBIT radians, the
// pitch between −5° and 85°; a pinch (ctrl + wheel) or a scroll zooms by exp(deltaY × 0.01), a sideways swipe turns.
export const DRAG_ORBIT = 3.2;
const DEG = Math.PI / 180;
// Where the view starts (and a double-click goes back to): ahead of the right wing, a little above the wheels, so
// the engines and the ground under them show.
const HOME = { yaw: 140 * DEG, pitch: 7 * DEG };
export function orbitTurn(view, dx, dy, h) {
  const k = DRAG_ORBIT / Math.max(1, h);
  return { ...view, yaw: view.yaw - dx * k, pitch: Math.max(-5 * DEG, Math.min(85 * DEG, view.pitch + dy * k)) };
}
export function orbitWheel(view, e, limits = [12, 400]) {
  if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
    // A mouse wheel's notch (±100) is a step of about 1.6×, not 2.7×: one event moves at most 50.
    const dy = Math.max(-50, Math.min(50, e.deltaY || 0));
    const dist = Math.min(limits[1], Math.max(limits[0], view.dist * Math.exp(dy * 0.01)));
    return { ...view, dist };
  }
  return { ...view, yaw: view.yaw + (e.deltaX || 0) * 0.0035 };
}

// ---- The 3D view ----
// Its own renderer and scene: a sky colour, a hemisphere light and a sun with shadows, a ground plane at the
// design's wheels with a 10 m grid. Rebuilt (the old model's geometry and materials disposed) when viewKey changes,
// at most every 150 ms while a slider moves.
async function createView(host, onStatus) {
  const [THREE, assets] = await Promise.all([import('../../vendor/three.module.js'), import('../type-assets.js')]);
  const canvas = document.createElement('canvas');
  canvas.className = 'fsw-canvas';
  host.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#7f9bb8');
  scene.add(new THREE.HemisphereLight('#d6e6ff', '#7a7468', 2.0));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
  sun.position.set(-30, 60, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
  scene.add(sun, sun.target);
  const groundMat = new THREE.MeshStandardMaterial({ color: '#6f7377', roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  const grid = new THREE.GridHelper(200, 20, '#8d9297', '#80858a');
  grid.material.transparent = true; grid.material.opacity = 0.5;
  scene.add(ground, grid);
  const camera = new THREE.PerspectiveCamera(35, 1.6, 0.5, 3000);

  let view = null, model = null, builtKey = null, pending = null, timer = 0, lastBuild = 0, raf = 0, disposed = false;
  let groundY = -3.9, distLim = [12, 400], baseDist = 75;
  const target = new THREE.Vector3();

  function frame() {
    raf = 0;
    if (disposed || !view) return;
    const cp = Math.cos(view.pitch);
    camera.position.set(target.x + view.dist * cp * Math.sin(view.yaw), target.y + view.dist * Math.sin(view.pitch), target.z + view.dist * cp * Math.cos(view.yaw));
    if (camera.position.y < groundY + 1) camera.position.y = groundY + 1;
    camera.lookAt(target);
    renderer.render(scene, camera);
  }
  const request = () => { if (!raf && !disposed && !document.hidden) raf = requestAnimationFrame(frame); };

  function disposeModel() {
    if (!model) return;
    scene.remove(model.object);
    model.object.traverse((o) => {
      o.geometry?.dispose?.();
      for (const mt of [].concat(o.material || [])) mt.dispose?.();
    });
    model = null;
  }
  // The builders for a design's type entry (the engine builder's), else the base's model.
  function buildersOf(def) {
    const b = assets.buildersFor(def);
    return b === assets.buildersFor('a321neo') && def.id !== 'a321neo' ? assets.buildersFor(def.id) : b;
  }
  function build() {
    timer = 0;
    if (disposed || !pending) return;
    const d = pending, key = viewKey(d);
    pending = null;
    if (key === builtKey) return;
    lastBuild = performance.now();
    const def = designDef(d);
    let next;
    try { next = buildersOf(def).createAircraft(); } catch (err) { onStatus?.(`The model could not be built: ${err.message}`); return; }
    disposeModel();
    model = next;
    model.setCockpitView?.(false);
    model.setLights?.({});   // parked with its lights off: no glows in the hangar's daylight
    model.object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    model.update?.({ t: 0, surfaces: { elevator: 0, stab: 0, aileronL: 0, aileronR: 0, rudder: 0, spoilersL: [0, 0, 0, 0, 0], spoilersR: [0, 0, 0, 0, 0] },
      slatDeg: 0, flapDeg: 0, flapLever: 0, gearPos: 1, gearDoors: 0, steerAngle: 0, wheelRate: { nose: 0, main: 0 },
      engines: def.geo.ENGINES.map(() => ({ n1: 0, rev: 0 })), thrustLever: 0, speedbrake: 0, pitch: 0, roll: 0, hdg: 0 }, 0);
    scene.add(model.object);
    groundY = -def.geo.GROUND_Z;
    ground.position.y = groundY; grid.position.y = groundY + 0.01;
    target.set(0, groundY * 0.45, 0);
    sun.target.position.set(0, groundY, 0);
    const span = def.geo.SPAN || 40;
    Object.assign(sun.shadow.camera, { left: -span * 0.8, right: span * 0.8, top: span * 1.2, bottom: -span * 1.2 });
    sun.shadow.camera.updateProjectionMatrix();
    const d0 = (def.orbitDist ?? 75) * 0.95;
    if (!view) view = { yaw: HOME.yaw, pitch: HOME.pitch, dist: d0 };
    else if (Math.abs(baseDist - d0) > 1e-6 && Math.abs(view.dist - baseDist) < 1e-6) view.dist = d0;
    baseDist = d0;
    distLim = [Math.max(10, span * 0.45), span * 8];
    builtKey = key;
    onStatus?.('');
    request();
  }
  function setDesign(d, now = false) {
    pending = d;
    if (viewKey(d) === builtKey) { pending = null; return; }
    if (timer) return;
    const wait = now ? 0 : Math.max(0, 150 - (performance.now() - lastBuild));
    timer = setTimeout(build, wait);
  }

  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    request();
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  ro?.observe(host);
  resize();

  // Drag to go round, pinch or scroll to zoom, a sideways swipe turns, double-click recentres.
  let drag = null;
  const onDown = (e) => { if (e.button !== 0 || !e.isPrimary) return; drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture(e.pointerId); } catch { /* gone */ } canvas.classList.add('drag'); };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id || !view) return;
    view = orbitTurn(view, e.clientX - drag.x, e.clientY - drag.y, canvas.clientHeight);
    drag.x = e.clientX; drag.y = e.clientY;
    request();
  };
  const onUp = (e) => { if (drag && e.pointerId === drag.id) { drag = null; canvas.classList.remove('drag'); } };
  const onWheel = (e) => { e.preventDefault(); if (!view) return; view = orbitWheel(view, e, distLim); request(); };
  const onDbl = () => { if (view) { view = { yaw: HOME.yaw, pitch: HOME.pitch, dist: baseDist }; request(); } };
  const onVis = () => { if (!document.hidden) request(); };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDbl);
  document.addEventListener('visibilitychange', onVis);

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    raf = timer = 0;
    ro?.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    disposeModel();
    ground.geometry.dispose(); groundMat.dispose(); grid.geometry.dispose(); grid.material.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
    canvas.remove();
  }
  return {
    setDesign, dispose, request, resize,
    get view() { return view; },
    get builtKey() { return builtKey; },
    get busy() { return !!(raf || timer); },
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  };
}

// ---- The page ----

function linkCss() {
  if (document.querySelector('link[data-fsw-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('./warehouse.css', import.meta.url).href; l.dataset.fswCss = '';
  document.head.appendChild(l);
}

const typesShown = () => TYPE_LIST();

export function createWarehouse(root, { store = designStore() } = {}) {
  linkCss();
  const el = document.createElement('div');
  el.className = 'fsw';
  el.hidden = true;
  el.tabIndex = -1;
  el.innerHTML = `
    <header class="fsw-bar">
      <h2>Warehouse</h2><span class="fsw-crumb" data-o="crumb"></span>
      <button class="fsui-b" data-a="top">Back to the menu</button>
    </header>
    <section class="fsw-listpage" data-o="listPage" aria-label="Designs">
      <div class="fsw-listcard">
        <div class="fsw-new"><span>New design from the</span>${typesShown().map((t) => `<button class="fsui-b primary" data-new="${esc(t.id)}">${esc(t.name)}</button>`).join('')}</div>
        <p class="fsm-note" data-o="listMsg" aria-live="polite"></p>
        <div class="fsm-list" data-o="list"></div>
        <p class="fsm-help">A design is one of the three types with its engines, weight, fuel and gear changed. Click one to open it. Saved designs fly from New scenario’s aircraft picker. Esc goes back.</p>
      </div>
    </section>
    <section class="fsw-editor" data-o="editor" hidden aria-label="Design">
      <div class="fsw-view" data-o="view">
        <p class="fsw-viewmsg" data-o="viewMsg">Loading the model…</p>
        <p class="fsw-viewhelp">Drag to go round it · pinch or scroll to zoom · double-click recentres</p>
      </div>
      <aside class="fsw-side">
        <div class="fsw-scroll">
          <div class="fsw-issues" data-o="issues" aria-live="polite"></div>
          <div class="fsw-parts" data-o="parts"></div>
          <h3 class="fsw-h">The numbers</h3>
          <div class="fsw-nums" data-o="nums"></div>
        </div>
        <div class="fsw-foot">
          <div class="fsw-ask" data-o="ask" hidden><span>Leave without saving the changes?</span><button class="fsui-b" data-a="keep">Keep editing</button><button class="fsui-b danger" data-a="discard">Discard</button></div>
          <span class="fsw-msg" data-o="msg" aria-live="polite"></span>
          <button class="fsui-b" data-a="back">Back to the list</button>
          <button class="fsui-b primary" data-a="save">Save</button>
        </div>
      </aside>
    </section>`;
  root.appendChild(el);
  const $ = (k) => el.querySelector(`[data-o="${k}"]`);
  const act = (k) => el.querySelector(`[data-a="${k}"]`);

  let page = 'list';
  let editing = null, confirming = null, renameMsg = '', listMsg = '', listMsgBad = false;
  let cur = null, savedJson = null, isNew = false;
  let view = null, viewLoading = null, viewGen = 0;

  // ---- The list ----
  function rowHtml(d) {
    const def = designDef(d), id = esc(d.id);
    let main;
    if (editing === d.id) {
      main = `<div class="fsm-rename">
          <input type="text" class="fsm-input" data-r="name" maxlength="${NAME_MAX + 10}" value="${esc(d.name)}" aria-label="Design name" spellcheck="false" autocomplete="off">
          <button class="fsui-b primary" data-r="save">Save</button><button class="fsui-b" data-r="cancel">Cancel</button>
          <span class="fsm-err" data-o="renameMsg">${esc(renameMsg)}</span></div>`;
    } else {
      const r = readout(d);
      main = `<div class="fsm-row-main"><b>${esc(d.name)}</b>
          <small>${esc(TYPES[d.base].name)} · ${esc(def.engineName)} · ${esc(d.registration)}${r.worst !== 'ok' ? ` · <span class="fsw-${r.worst}">${r.worst === 'bad' ? 'fails a check' : 'a warning'}</span>` : ''}</small></div>
        <span class="fsm-when">${Math.round(r.numbers.rangeNm).toLocaleString('en-US')} nm · T/W ${r.numbers.thrustToWeight.toFixed(2)}</span>`;
    }
    const acts = confirming === d.id
      ? `<div class="fsm-confirm"><span>Delete “${esc(d.name)}”? Scenarios flying it keep their copy.</span>
          <button class="fsui-b" data-r="no">Cancel</button><button class="fsui-b danger" data-r="yes">Delete</button></div>`
      : editing === d.id ? ''
      : `<div class="fsm-row-act"><button class="fsui-b primary" data-r="open">Open</button><button class="fsui-b" data-r="rename">Rename</button><button class="fsui-b" data-r="duplicate">Duplicate</button><button class="fsui-b" data-r="delete">Delete</button></div>`;
    return `<div class="fsm-row${confirming === d.id ? ' asking' : ''}" data-id="${id}" tabindex="0">${main}${acts}</div>`;
  }
  function renderList(focusId) {
    const m = $('listMsg'); m.textContent = listMsg; m.classList.toggle('bad', listMsgBad);
    const list = store.list();
    $('list').innerHTML = list.length ? list.map(rowHtml).join('') : '<div class="fsm-empty">No designs yet. Start one from a type above.</div>';
    if (editing) { const inp = $('list').querySelector('[data-r="name"]'); if (inp) { inp.focus(); if (!renameMsg) inp.select(); } }
    else if (confirming) $('list').querySelector(`.fsm-row[data-id="${CSS.escape(confirming)}"] [data-r="no"]`)?.focus();
    else if (focusId !== undefined) {
      const row = focusId && $('list').querySelector(`.fsm-row[data-id="${CSS.escape(focusId)}"]`);
      (row || el).focus({ preventScroll: !row });
    }
  }
  function commitRename(id) {
    const inp = $('list').querySelector('[data-r="name"]');
    const r = store.rename(id, inp ? inp.value : '');
    if (!r.ok) {
      renameMsg = r.error === 'quota' ? 'Browser storage is full: the name was not saved.' : r.error === 'name' ? `A name needs ${NAME_MIN}–${NAME_MAX} characters.` : 'That design is gone.';
      const mm = $('list').querySelector('[data-o="renameMsg"]'); if (mm) mm.textContent = renameMsg;
      return;
    }
    editing = null; renameMsg = '';
    renderList(id);
  }
  $('list').addEventListener('click', (ev) => {
    const row = ev.target.closest('.fsm-row[data-id]');
    if (!row) return;
    const id = row.dataset.id, r = ev.target.closest('[data-r]')?.dataset.r;
    if (r === 'name') return;
    listMsg = ''; listMsgBad = false;
    if (r === 'duplicate') {
      const res = store.duplicate(id);
      editing = confirming = null;
      listMsgBad = !res.ok;
      listMsg = res.ok ? `Copied as “${res.design.name}”: at the top.` : res.error === 'quota' ? 'Browser storage is full: no copy was made.' : 'That design is gone.';
      renderList(res.ok ? res.design.id : id);
      if (res.ok) $('list').scrollTop = 0;
      return;
    }
    if (r === 'rename') { editing = id; confirming = null; renameMsg = ''; renderList(); return; }
    if (r === 'save') { commitRename(id); return; }
    if (r === 'cancel') { editing = null; renameMsg = ''; renderList(id); return; }
    if (r === 'delete') { confirming = id; editing = null; renderList(); return; }
    if (r === 'no') { confirming = null; renderList(id); return; }
    if (r === 'yes') {
      const list = store.list(), i = list.findIndex((d) => d.id === id);
      if (!store.remove(id)) { listMsg = 'Browser storage refused the change: the design is still there.'; listMsgBad = true; }
      confirming = null;
      const next = store.list();
      renderList(next[Math.min(i, next.length - 1)]?.id || null);
      return;
    }
    if (editing === id || confirming === id) return;
    const d = store.get(id);
    if (d) openEditor(d, false);
  });
  $('list').addEventListener('keydown', (e) => {
    if (e.target.dataset?.r === 'name') {
      const row = e.target.closest('.fsm-row[data-id]');
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitRename(row.dataset.id); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const id = editing; editing = null; renameMsg = ''; renderList(id); }
      return;
    }
    const row = e.target.closest?.('.fsm-row[data-id]');
    if (row && e.target === row && e.key === 'Enter' && !confirming) { e.preventDefault(); const d = store.get(row.dataset.id); if (d) openEditor(d, false); }
  });
  for (const b of el.querySelectorAll('[data-new]')) b.onclick = () => openEditor(store.draft(b.dataset.new), true);

  // ---- The editor ----
  const dirty = () => isNew || JSON.stringify(cur) !== savedJson;
  const slider = (k, label, min, max, step, value, out, index) =>
    `<label class="fsw-part"><span class="lab">${esc(label)}</span><input type="range" data-p="${k}"${index !== undefined ? ` data-i="${index}"` : ''} min="${min}" max="${max}" step="${step}" value="${value}"><output data-out="${k}${index ?? ''}">${esc(out)}</output></label>`;

  function partsHtml() {
    const d = cur, T = TYPES[d.base], A = T.data, def = designDef(d), [lo, hi] = stationRange(d.base, d.engine, d.count);
    const pairs = d.count === 3 ? 1 : d.count / 2;
    const segBtns = (k, items, on) => `<div class="fsui-seg fsw-seg" data-seg="${k}">${items.map(([v, t]) => `<button type="button" data-v="${esc(v)}" class="${String(v) === String(on) ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>`;
    return `
      <div class="fsw-two">
        <label class="fsw-field"><span>Name</span><input type="text" class="fsw-text" data-p="name" maxlength="${NAME_MAX + 10}" value="${esc(d.name)}" spellcheck="false" autocomplete="off"></label>
        <label class="fsw-field fsw-reg"><span>Registration</span><input type="text" class="fsw-text" data-p="registration" maxlength="8" value="${esc(d.registration)}" spellcheck="false" autocomplete="off"></label>
      </div>
      <p class="fsw-base">On the ${esc(T.maker)} ${esc(T.name)} (its wing, fuselage, tail and limits)</p>
      <h3 class="fsw-h">Engines</h3>
      <p class="fsw-base">Stations are each pair’s distance out from the centreline. Each pylon holds 1.5 × its engine’s rated thrust.</p>
      <div class="fsw-row"><span class="lab">Count</span>${segBtns('count', COUNTS.map((c) => [c, c === 3 ? '3 (one in the tail)' : String(c)]), d.count)}</div>
      <div class="fsw-row"><span class="lab">Type</span>${segBtns('engine', ENGINE_LIST.map((e) => [e.id, e.short]), d.engine)}</div>
      ${d.stations.map((y, k) => slider('station', pairLabel(k, pairs), lo.toFixed(2), hi.toFixed(2), 0.05, y, `${y.toFixed(2)} m`, k)).join('')}
      ${d.count === 3 ? '<p class="fsw-base">The third engine sits on the centreline, through the fin’s root.</p>' : ''}
      ${slider('thrustScale', 'Thrust scale', RANGES.thrustScale[0], RANGES.thrustScale[1], 0.05, d.thrustScale, thrustOut(def, d))}
      <h3 class="fsw-h">Weight, fuel and gear</h3>
      ${slider('oewFrac', 'Empty weight change', RANGES.oewFrac[0], RANGES.oewFrac[1], 0.005, (d.oewDeltaKg / A.OEW).toFixed(3), oewOut(d, A))}
      ${slider('fuelFrac', 'Fuel capacity', RANGES.fuelFrac[0], RANGES.fuelFrac[1], 0.01, (d.fuelCapacityKg / A.FUEL_MAX).toFixed(3), fuelOut(d, A))}
      ${slider('gearExtendM', 'Gear extension', RANGES.gearExtendM[0], RANGES.gearExtendM[1], 0.05, d.gearExtendM, `+${d.gearExtendM.toFixed(2)} m`)}`;
  }
  const thrustOut = (def, d) => `×${d.thrustScale.toFixed(2)} · ${Math.round(def.data.T0_ENGINE / 1000)} kN each`;
  const oewOut = (d, A) => `${pct(d.oewDeltaKg / A.OEW, 1)} (${d.oewDeltaKg >= 0 ? '+' : '−'}${Math.abs(d.oewDeltaKg).toLocaleString('en-US')} kg)`;
  const fuelOut = (d, A) => `${Math.round((d.fuelCapacityKg / A.FUEL_MAX) * 100)} % · ${kg(d.fuelCapacityKg)}`;

  function numsHtml(r) {
    const rows = r.rows.map((x) => `<div class="fsw-num ${x.level}" data-n="${x.k}"><span>${esc(x.label)}</span><b>${esc(x.value)}</b></div>`).join('');
    const eng = r.engines.map((e) => `<tr data-e="${e.i}"><td>${e.i + 1} · ${esc(e.label)}</td>
        <td class="${e.restLvl}">${e.tail ? '—' : m2(e.clearRestM)}</td><td class="${e.tsLvl}">${e.tail ? '—' : m2(e.clearTailStrikeM)}</td>
        <td class="${e.pyLvl}">${Math.round(e.loadN / 1000)} / ${Math.round(e.limitN / 1000)} kN · ${Math.round(e.pylonFrac * 100)} %</td></tr>`).join('');
    return `${rows}
      <table class="fsw-eng"><thead><tr><th>Engine</th><th>Clearance standing</th><th>At tail strike</th><th>Pylon at full thrust</th></tr></thead><tbody>${eng}</tbody></table>`;
  }
  function issuesHtml(r) {
    if (!r.issues.length) return '<p class="fsw-issue ok">Every check passes.</p>';
    return r.issues.map((i) => `<p class="fsw-issue ${i.level}">${esc(i.text)}</p>`).join('');
  }

  function renderNumbers() {
    const r = readout(cur);
    $('issues').innerHTML = issuesHtml(r);
    $('nums').innerHTML = numsHtml(r);
    $('crumb').textContent = `${cur.name}${dirty() ? ' · not saved' : ''}`;
    el.dataset.worst = r.worst;
    return r;
  }
  // The outputs beside the sliders, and the sliders the normalization moved (not the one being dragged).
  function syncParts(active) {
    const d = cur, A = TYPES[d.base].data, def = designDef(d);
    const set = (k, v, out, i) => {
      const inp = el.querySelector(`[data-p="${k}"]${i !== undefined ? `[data-i="${i}"]` : ''}`);
      if (inp && inp !== active) inp.value = v;
      const o = el.querySelector(`[data-out="${k}${i ?? ''}"]`); if (o) o.textContent = out;
    };
    d.stations.forEach((y, k) => set('station', y, `${y.toFixed(2)} m`, k));
    set('thrustScale', d.thrustScale, thrustOut(def, d));
    set('oewFrac', (d.oewDeltaKg / A.OEW).toFixed(3), oewOut(d, A));
    set('fuelFrac', (d.fuelCapacityKg / A.FUEL_MAX).toFixed(3), fuelOut(d, A));
    set('gearExtendM', d.gearExtendM, `+${d.gearExtendM.toFixed(2)} m`);
  }
  function changed(full, active) {
    if (full) $('parts').innerHTML = partsHtml(); else syncParts(active);
    renderNumbers();
    $('msg').textContent = ''; $('msg').className = 'fsw-msg';
    view?.setDesign(cur);
  }

  $('parts').addEventListener('input', (e) => {
    const p = e.target.dataset.p;
    if (!p) return;
    if (p === 'name' || p === 'registration') {
      // Typed as it goes; the normalized value (registration upper-cased, A–Z 0–9 -) is what's saved.
      // An emptied field keeps the last value until something is typed (Save checks the name's length).
      const v = p === 'name' ? cleanName(e.target.value) : e.target.value;
      if (v) cur = normalizeDesign({ ...cur, [p]: v });
      renderNumbers();
      view?.setDesign(cur);
      return;
    }
    cur = editDesign(cur, p, e.target.value, +e.target.dataset.i || 0);
    changed(false, e.target);
  });
  $('parts').addEventListener('change', (e) => { if (e.target.type === 'range') syncParts(null); });
  $('parts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg] button');
    if (!b) return;
    const k = b.closest('[data-seg]').dataset.seg;
    const next = editDesign(cur, k, k === 'count' ? +b.dataset.v : b.dataset.v);
    if (JSON.stringify(next) === JSON.stringify(cur)) return;
    cur = next;
    changed(true);
  });

  function save() {
    const name = $('parts').querySelector('[data-p="name"]')?.value ?? cur.name;
    if (!nameOk(name)) { setMsg(`A name needs ${NAME_MIN}–${NAME_MAX} characters.`, 'bad'); $('parts').querySelector('[data-p="name"]')?.focus(); return false; }
    cur = normalizeDesign({ ...cur, name: cleanName(name) });
    const res = store.save(cur);
    if (!res.ok) { setMsg('Browser storage is full: the design was not saved.', 'bad'); return false; }
    cur = res.design; savedJson = JSON.stringify(cur); isNew = false;
    renderNumbers();
    setMsg(`Saved. It’s in New scenario’s aircraft picker.`, 'ok');
    return true;
  }
  function setMsg(t, cls) { $('msg').textContent = t; $('msg').className = `fsw-msg ${cls || ''}`; }

  function openEditor(d, fresh) {
    cur = normalizeDesign(d); savedJson = JSON.stringify(cur); isNew = !!fresh;
    page = 'editor';
    editing = confirming = null;
    $('listPage').hidden = true; $('editor').hidden = false; $('ask').hidden = true;
    act('top').textContent = 'Back to the list';
    $('parts').innerHTML = partsHtml();
    renderNumbers();
    setMsg(fresh ? `A new design: the ${TYPES[cur.base].name} as it is. Change its parts, then Save.` : '', '');
    startView();
    $('parts').querySelector('[data-p="name"]')?.focus({ preventScroll: true });
  }
  function startView() {
    const gen = ++viewGen;
    $('viewMsg').textContent = 'Loading the model…'; $('viewMsg').hidden = false;
    viewLoading = createView($('view'), (t) => { $('viewMsg').textContent = t; $('viewMsg').hidden = !t; })
      .then((v) => {
        if (gen !== viewGen || page !== 'editor' || el.hidden) { v.dispose(); return; }
        view = v; viewLoading = null;
        view.setDesign(cur, true);
      })
      .catch((err) => { viewLoading = null; if (gen === viewGen) { $('viewMsg').textContent = `No 3D view: ${err.message}`; $('viewMsg').hidden = false; } });
  }
  function stopView() { viewGen++; view?.dispose(); view = null; }
  function leaveEditor(force) {
    if (!force && dirty()) { $('ask').hidden = false; act('keep').focus(); return false; }
    stopView();
    const id = cur?.id;
    cur = null; savedJson = null; isNew = false;
    showList(store.get(id) ? id : null);
    return true;
  }
  function showList(focusId) {
    page = 'list';
    $('editor').hidden = true; $('listPage').hidden = false;
    act('top').textContent = 'Back to the menu';
    $('crumb').textContent = '';
    delete el.dataset.worst;
    renderList(focusId ?? null);
  }

  act('save').onclick = () => save();
  act('back').onclick = () => leaveEditor(false);
  act('keep').onclick = () => { $('ask').hidden = true; };
  act('discard').onclick = () => leaveEditor(true);
  act('top').onclick = () => { if (page === 'editor') leaveEditor(false); else api.close(); };

  // Keys stay here (typing the name never flies the aircraft); Esc goes back a step.
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    back();
  });
  function back() {
    if (page === 'editor') { if (!$('ask').hidden) $('ask').hidden = true; else leaveEditor(false); }
    else if (confirming) { const id = confirming; confirming = null; renderList(id); }
    else api.close();
  }
  el.addEventListener('keyup', (e) => e.stopPropagation());
  for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) el.addEventListener(t, (e) => e.stopPropagation());
  el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  // A click on nothing keeps the keys here (else they'd go to the page under it).
  el.addEventListener('pointerdown', (e) => { if (!e.target.closest('input, button, select, textarea, [tabindex]')) el.focus({ preventScroll: true }); });

  const api = {
    el,
    onclose: null,
    open() {
      if (!el.hidden) return;
      el.hidden = false;
      listMsg = ''; listMsgBad = false;
      showList(null);
      el.focus({ preventScroll: true });
    },
    close() {
      if (el.hidden) return;
      stopView();
      cur = null; page = 'list';
      if (el.contains(document.activeElement)) document.activeElement.blur();
      el.hidden = true;
      api.onclose?.();
    },
    back,
    get isOpen() { return !el.hidden; },
    get page() { return page; },
    get design() { return cur; },
    get view() { return view; },
    openEditor: (d) => openEditor(d, false),
  };
  return api;
}
