// v0.7.9 (map): the path map drawn in node into a recording 2D context, so a test can hash the canvas calls of a few
// fixed views. Run as a child process, one region a process (the region binds at import):
//
//   FS_REGION=europe FS_MAP79=0 node tests/v079-map-calls.mjs [<game root>] [--ms]
//
// <game root> is a flight-sim folder (the tree's own by default, found from this file's URL): its src/ui/map.js, its
// data. Prints one JSON line: { region, views: { <name>: { sha, calls } } } (with --ms, each view's draw in ms too).
// Nothing here is a game file: a stub DOM (one element kind), a stub fetch that reads the root's files, a stub
// Path2D and ImageData. measureText's width is the text's length times 0.56 of the font's px, the same in both trees.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const ROOT = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(HERE, '..'));
const WANT_MS = args.includes('--ms');
const [DUMP, DUMP_TO] = (args.find((a) => a.startsWith('--dump=')) || '').slice(7).split(':');   // --dump=<view>:<file>: that view's calls
const W = 1440, H = 900;

// ---- the recording ----
let log = [];
let pathIds = 0;
const ser = (v) => {
  if (typeof v === 'number') return String(v);
  if (v && v.__path2d) return `P2D(${v.sig()})`;
  if (v && v.__canvas) return `canvas ${v.width}x${v.height}`;
  if (Array.isArray(v)) return '[' + v.map(ser).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => k + ':' + ser(v[k])).join(',') + '}';
  return String(v);
};
class Path2DStub {
  constructor() { this.__path2d = true; this.ops = []; this.id = ++pathIds; this._sig = null; }
  sig() { if (this._sig == null) this._sig = crypto.createHash('sha256').update(this.ops.join(';')).digest('hex').slice(0, 16); return this._sig; }
}
for (const m of ['moveTo', 'lineTo', 'closePath', 'rect', 'arc', 'bezierCurveTo', 'quadraticCurveTo', 'ellipse', 'roundRect']) {
  Path2DStub.prototype[m] = function (...a) { this._sig = null; this.ops.push(m + '(' + a.map(ser).join(',') + ')'); };
}
Path2DStub.prototype.addPath = function (p) { this._sig = null; this.ops.push('add(' + p.sig() + ')'); };
globalThis.Path2D = Path2DStub;
globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };

function recordingContext(canvas) {
  const state = { font: '10px sans-serif' };
  const pxOf = () => { const m = /([\d.]+)px/.exec(state.font); return m ? Number(m[1]) : 10; };
  const target = {};
  return new Proxy(target, {
    get(t, p) {
      if (p === 'canvas') return canvas;
      if (p === 'measureText') return (s) => { log.push('measureText(' + ser(s) + ')'); return { width: String(s).length * pxOf() * 0.56 }; };
      if (p === 'getImageData' || p === 'createImageData') return (...a) => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      if (p in state) return state[p];
      return (...a) => { log.push(String(p) + '(' + a.map(ser).join(',') + ')'); };
    },
    set(t, p, v) { state[p] = v; log.push(String(p) + '=' + ser(v)); return true; },
  });
}

// ---- a stub DOM ----
function fakeElement(tag = 'div') {
  const kids = new Map();
  const el = {
    tagName: tag.toUpperCase(), className: '', hidden: false, style: {}, dataset: {}, textContent: '', _html: '',
    width: 0, height: 0, __canvas: tag === 'canvas',
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    _on: {},
    appendChild(c) { return c; }, addEventListener(t, f) { (this._on[t] ||= []).push(f); }, removeEventListener() {}, setPointerCapture() {},
    querySelector(sel) { if (!kids.has(sel)) kids.set(sel, fakeElement(sel === 'canvas' ? 'canvas' : 'div')); return kids.get(sel); },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return this._rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    getContext() { if (!this._ctx) this._ctx = this.__canvas ? recordingContext(this) : null; return this._ctx; },
    putImageData() {},
  };
  if (tag === 'canvas') el.getContext = function () { if (!this._ctx) this._ctx = recordingContext(this); return this._ctx; };
  return el;
}
// an element the map makes itself (its own overlay element) is the window's size; its children (the bar, the help, the
// info) read as zero-sized, so nothing is kept clear of them, the same in both trees
let mapElement = null;
globalThis.document = { createElement: (t) => { const e = fakeElement(t); mapElement ||= e; e._rect = { left: 0, top: 0, right: W, bottom: H, width: W, height: H }; return e; }, fonts: null };
globalThis.window = { devicePixelRatio: 1, addEventListener() {} };
globalThis.requestAnimationFrame = () => 0;

// fetch: the root's own files (a relative URL is resolved against the root's folder)
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  const s = String(u);
  const p = s.startsWith('file:') ? fileURLToPath(s) : path.join(ROOT, s);
  try { return new Response(fs.readFileSync(p), { status: 200 }); } catch (e) { return new Response(null, { status: 404 }); }
};
void realFetch;

const R = (rel) => pathToFileURL(path.join(ROOT, rel)).href;
const { REGION, REGION_ID } = await import(R('src/world/regions.js'));
const { loadAirports } = await import(R('src/world/runways.js'));
const { createMap } = await import(R('src/ui/map.js'));
const dataDir = path.join(ROOT, REGION.data);
const dataBase = pathToFileURL(dataDir).href + '/';
const air = await loadAirports(dataBase);
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (e) { return null; } };
const coast = readJ('coast-region.json'), urban = readJ('urban-region.json');

const root = fakeElement('div');
const map = createMap(root, { airports: air.airports, coast, urban });
await map.loadExtras(dataBase);

const list = air.airports;
const byIcao = Object.fromEntries(list.map((a) => [a.icao, a]));
const origin = (icao) => byIcao[icao]?.origin || [byIcao[icao].runways[0].ends[0].x, byIcao[icao].runways[0].ends[0].y];

const VIEWS = REGION_ID === 'europe'
  ? [['all', null, 3000], ['egll-300', 'EGLL', 300], ['egll-30', 'EGLL', 30], ['egll-6', 'EGLL', 6], ['egll-2', 'EGLL', 2],
     ['lfpg-3', 'LFPG', 3], ['eddf-12', 'EDDF', 12], ['etar-8', 'ETAR', 8], ['etar-40', 'ETAR', 40], ['lezg-15', 'LEZG', 15]]
  : [['all', null, 3000], ['rksi-300', 'RKSI', 300], ['rksi-40', 'RKSI', 40], ['rksi-8', 'RKSI', 8], ['rksi-2', 'RKSI', 2],
     ['rjtt-5', 'RJTT', 5], ['rkjk-12', 'RKJK', 12], ['rjnk-60', 'RJNK', 60]];

// a flight: on the ground at the first airport of the views, to the region's default destination
const plan = REGION.defaultPlan;
const destA = byIcao[plan.dest], destEnd = destA.runways.flatMap((r) => r.ends).find((e) => e.ident === plan.arrRunway);
const icao0 = REGION_ID === 'europe' ? 'EGLL' : 'RKSI';
const [sx0, sy0] = origin(icao0);
const view = {
  state: { pos: { x: sx0 + 120, y: sy0 - 80, z: 10 }, hdg: 1.2, t: 100, ias: 5, gs: 5, tas: 5, onGround: true, fuelKg: 8000, type: 'a321neo', wind: null },
  ap: {}, dest: destEnd, destAirport: destA, timeScale: 1, timeScaleActual: 1, paused: false, waypoints: [],
  taxiRoute: [[sx0 + 120, sy0 - 80], [sx0 + 300, sy0 - 60], [sx0 + 500, sy0 + 200], [sx0 + 900, sy0 + 260]],
  taxiPhase: (args.find((a) => a.startsWith('--phase=')) || '--phase=taxi').slice(8),   // gate-flow.js's phase
};
view.taxiAssigned = { kind: 'out', runway: '33L', stand: '38', points: view.taxiRoute };

const out = { region: REGION_ID, views: {} };
map.update(view);
map.open();
for (const [name, icao, mpp] of VIEWS) {
  let x, y;
  if (icao) [x, y] = origin(icao);
  else { const { mapExtent } = await import(R('src/world/region.js')); const E = mapExtent(); x = (E.x0 + E.x1) / 2; y = (E.y0 + E.y1) / 2; }
  log = [];
  map._devView(x, y, mpp);
  const calls = log.length;
  if (DUMP && name === DUMP) fs.writeFileSync(DUMP_TO, log.join('\n') + '\n');
  const sha = crypto.createHash('sha256').update(log.join('\n')).digest('hex');
  // what was drawn, counted: the taxi route's line, the taxiways' name boxes, the stands' numbers (their casing)
  const rec = { sha, calls, taxiLine: log.filter((l) => l === 'strokeStyle=#ff7a3d').length,
    names: log.filter((l) => l.startsWith('strokeRect(')).length, holds: log.filter((l) => l === 'strokeStyle=#ffd23a').length };
  if (WANT_MS) rec.ms = Math.round(map._devDrawMs(10) * 100) / 100;
  out.views[name] = rec;
}
// --tips=<ICAO,...>: the tooltip over each airport's label (a pointer move on the canvas), and the closest zoom the
// wheel reaches (40 wheel steps in, read back as pixels a metre)
const TIPS = (args.find((a) => a.startsWith('--tips=')) || '').slice(7);
if (TIPS) {
  out.tips = {};
  const mapEl = mapElement;
  const canvas = mapEl.querySelector('canvas'), tipEl = mapEl.querySelector('.fsui-tip');
  for (const icao of TIPS.split(',')) {
    const [x, y] = origin(icao);
    map._devView(x, y, 900);
    const p = map._devLabel(icao);
    if (!p) { out.tips[icao] = null; continue; }
    for (const f of canvas._on.pointermove || []) f({ clientX: p[0], clientY: p[1], stopPropagation() {}, preventDefault() {} });
    out.tips[icao] = tipEl.hidden ? null : tipEl.textContent;
  }
  const [x, y] = origin(icao0);
  map._devView(x, y, 20);
  for (let i = 0; i < 40; i++) for (const f of mapEl._on.wheel || []) f({ clientX: 720, clientY: 450, deltaY: -400, deltaX: 0, deltaMode: 0, ctrlKey: false, target: { closest: () => null }, stopPropagation() {}, preventDefault() {} });
  const a = map._devScreen(x, y), b = map._devScreen(x + 100, y);
  out.closestPxPerM = (b[0] - a[0]) / 100;
}
process.stdout.write(JSON.stringify(out) + '\n');
process.exit(0);
