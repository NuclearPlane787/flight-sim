// The region (v0.6.0): East Asia, Korea's map grown. Since v0.7.0 it is the only game: v0.6.0's
// flags (the region, each country's cities, the new ground) and v0.5.8's Korea-only paths are gone.
//
// v0.7.0: a page is in one region (regions.js: East Asia, or Europe). What differs by region is asked
// for here: the map's extent (outline.js's rectangle round the region's outline), the country rules
// (East Asia's below, Europe's in rules-europe.js, with the transition altitudes its airports set
// themselves), and the query a worker needs to open in the page's region. East Asia's answers are the
// ones it gave before.
//
// The terrain loader also lives here: it keeps the tiles round the aircraft, the camera, the
// departure and the arrival resident, loads ahead along the track, and tells the sim's loop
// whether this frame's steps may run (briefs/V0-6-0.md, "The sim never sees a missing tile").

import { setMagModel, toMap } from './frame.js';
import { loadGeoRules } from './geo-rules.js';
import { REGION, REGION_ID, DEFAULT_REGION } from './regions.js';
import { regionExtent } from './outline.js';
import { EUROPE_RULES, EUROPE_DEFAULT_RULES, EUROPE_AIRPORT_TRANSITIONS, AIRPORT_TRANSITION_RADIUS_M } from './rules-europe.js';

// A URL parameter (the page's, or the prediction worker's own script URL, which predict.js
// gives the same query) or, in node, an environment variable: '1' or '0', else null.
function urlFlag(name) {
  try {
    const q = (typeof location !== 'undefined' && location && location.search) || '';
    const m = new RegExp('[?&]' + name + '=([01])\\b').exec(q);
    return m ? m[1] === '1' : null;
  } catch (e) { return null; }
}
function envFlag(name) {
  try { const v = typeof process !== 'undefined' && process.env ? process.env[name] : undefined; return v === '1' ? true : v === '0' ? false : null; } catch (e) { return null; }
}
// An airport still being checked (v0.6.1: Yancheng) sits in the manifest's `airportsPending` and
// `patchesPending`, which nothing reads unless ?pending=1 is on the page's URL (FS_PENDING=1 in
// node): out of every list, the map and the terrain until it has passed the check the others
// passed, then its entries move to `airportsRegion` and `patchesRegion`. Off by default, always.
// Importers see the live binding: read PENDING_ON when you need it, never copy it at import time.
export let PENDING_ON = urlFlag('pending') ?? envFlag('FS_PENDING') ?? false;
export function setPending(on) { PENDING_ON = !!on; }
// The query to add to a worker's or a dev page's URL so it sees the same region as this page: the region
// itself unless it is the default (a worker has no storage to remember one with: regions.js), and pending.
export const regionQuery = () => {
  const q = [];
  if (REGION_ID !== DEFAULT_REGION) q.push('region=' + REGION_ID);
  if (PENDING_ON) q.push('pending=1');
  return q.length ? '?' + q.join('&') : '';
};

// The map's extent (m, the map frame): the region's whole data, the 1 km level's rectangle round
// 24-46 N, 112-148 E. FINE_EXTENT is the 250 m data's bounding rectangle (v0.6.0: the tiles meeting
// 29-40 N, 119-142 E; v0.6.3 adds 26 tiles round Beijing and north to Vladivostok, v0.6.4 ten over
// Hokkaido: the data itself is the manifest's `covered` tiles, fineOutline()). The predicted path
// ends at mapExtent(), and the path map draws it. (tests/region-loader.test.mjs checks both against
// the manifest.)
export const REGION_EXTENT = { x0: -1600000, y0: -1338000, x1: 2110000, y1: 1284000 };
export const FINE_EXTENT = { x0: -1040000, y0: -784000, x1: 1520000, y1: 1008000 };   // (v0.6.3: Beijing's column in the west, two rows north to Vladivostok, y1 880000; v0.6.4: Hokkaido's row, y1 1008000; v0.6.2's was -912000 .. 624000)
// (REGION_EXTENT and FINE_EXTENT are East Asia's. Europe's map extent is the rectangle round its outline; its
// 250 m data's rectangle comes from the manifest's covered tiles once one has been read.)
const HOME_REGION = REGION_ID === 'east-asia';
const MAP_RECT = HOME_REGION ? REGION_EXTENT : regionExtent();
export const mapExtent = () => MAP_RECT;
// v0.6.3: the 250 m data is a set of tiles, not a rectangle (Shane, 2026-11-20: "we don't have to keep every
// region a perfect rectangle"). fineOutline() is its edge for the map: every side of a covered tile whose
// neighbour isn't covered, as [x0, y0, x1, y1] in map metres; null until a manifest with the region's tiles has
// been read (terrainSpec() notes it).
let fineSpec = null, fineEdges = null;
export function tileOutline(spec) {
  const L = spec && spec.levels && spec.levels[0];
  if (!L || !L.covered) return null;
  const size = L.tile * L.cell, has = new Set(L.covered), out = [];
  for (const name of L.covered) {
    const [i, j] = name.split('_').map(Number), x = spec.x0 + i * size, y = spec.y0 + j * size;
    if (!has.has(`${i}_${j - 1}`)) out.push([x, y, x + size, y]);
    if (!has.has(`${i}_${j + 1}`)) out.push([x, y + size, x + size, y + size]);
    if (!has.has(`${i - 1}_${j}`)) out.push([x, y, x, y + size]);
    if (!has.has(`${i + 1}_${j}`)) out.push([x + size, y, x + size, y + size]);
  }
  return out;
}
export function fineOutline() {
  if (!fineSpec) return null;
  return fineEdges || (fineEdges = tileOutline(fineSpec));
}
let fineRect = null;
function coveredRect() {
  if (fineRect || !fineSpec) return fineRect;
  const L = fineSpec.levels && fineSpec.levels[0];
  if (!L || !L.covered || !L.covered.length) return null;
  const size = L.tile * L.cell;
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
  for (const name of L.covered) { const [i, j] = name.split('_').map(Number); if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
  fineRect = { x0: fineSpec.x0 + i0 * size, y0: fineSpec.y0 + j0 * size, x1: fineSpec.x0 + (i1 + 1) * size, y1: fineSpec.y0 + (j1 + 1) * size };
  return fineRect;
}
export const fineExtent = () => (HOME_REGION ? FINE_EXTENT : coveredRect() || MAP_RECT);

// ---- The local rules by place (briefs/V0-6-0.md Part 5). One lookup the sim, the screens and the clock
// share. `geo` is geo-rules.js's object (the country raster and WMM2025), installed once it is
// loaded: by main.js, by the prediction worker before its first run, and by node's tests. Before
// it is installed, everywhere is Korea (and the magnetic model frame.js's plane). A function of
// position only: nothing here may depend on the frame, the clock or what happens to be loaded.
let geo = null;
// Installing the geo rules also installs frame.js's magnetic model (briefs/V0-6-0.md, "Magnetic
// variation"): geo.magVarAt (the plane itself inside south-korea.poly).
export function setGeoRules(g) {
  geo = g || null;
  const G = geo;
  setMagModel(G && typeof G.magVarAt === 'function' ? (x, y, plane) => G.magVarAt(x, y, plane) : null);
}
export const geoRules = () => geo;
// The page and the prediction worker, once at startup: a promise that resolves once the geo
// rules are loaded and installed (to the rules, or to null if they could not load: then the
// plane holds everywhere). It never rejects. Whoever steps the sim waits for it.
let localRules = null;
export function loadLocalRules(base) {
  if (!localRules) {
    // Three tries (a dropped request shouldn't leave one side on the plane), then null.
    const attempt = (n) => loadGeoRules(base).then((g) => { setGeoRules(g); return g; }, (e) => {
      if (n > 1) return new Promise((r) => setTimeout(r, 400)).then(() => attempt(n - 1));
      console.warn('region: the local rules did not load; the plane everywhere', e);
      localRules = null;                 // a later call may try again (the worker does, see below)
      return null;
    });
    localRules = attempt(3);
  }
  return localRules;
}
// 'KR' | 'KP' | 'JP' | 'CN' | 'RU' (v0.6.3) | 'other' in East Asia; an ISO code from Europe's raster in Europe
// (the sea takes its nearest land's country). Before the rules are in: the region's default country.
const DEFAULT_COUNTRY = REGION.defaultCountry;
export function countryAt(x, y) { return geo ? geo.countryAt(x, y) : DEFAULT_COUNTRY; }
const FT_M = 0.3048;
const KR_RULES = { country: 'KR', timeZone: 'Asia/Seoul', zoneName: 'KST', baroUnit: 'hPa',
  transAltM: 14000 * FT_M, transLevelM: 14000 * FT_M, metricAlt: false, metar: 'kr' };
export const COUNTRY_RULES = {
  KR: KR_RULES,
  // North Korea (v0.6.4; Korea's rules with Pyongyang's zone until then, when nothing landed there). It publishes
  // no AIP online, so these are open secondary sources' ([EST]; the notes, with each source, were read 2026-11-21):
  // QNH in hPa and altitudes in feet (RVSM in feet since 2009), the transition altitude 12,000 ft and level FL130
  // (open nav data and an open scenery agree for Pyongyang; Wonsan's 5,000 ft there is older and isn't taken), the
  // wind in metres per second (sure: its own TAFs), UTC+9.
  KP: { ...KR_RULES, country: 'KP', timeZone: 'Asia/Pyongyang', transAltM: 12000 * FT_M, transLevelM: 13000 * FT_M, metar: 'kp' },
  // Japan: inches of mercury (hPa on request), 14,000 ft / FL140 (AIP Japan), `Q1014 ... RMK A2997`.
  JP: { ...KR_RULES, country: 'JP', timeZone: 'Asia/Tokyo', zoneName: 'JST', baroUnit: 'inHg', metar: 'jp' },
  // China: hPa, metres on the PFD, Pudong's 3,000 m / 3,600 m (Hongqiao's and Qingdao's [EST] the
  // same until their charts are read), the wind in metres per second.
  CN: { ...KR_RULES, country: 'CN', timeZone: 'Asia/Shanghai', zoneName: 'CST', transAltM: 3000, transLevelM: 3600, metricAlt: true, metar: 'cn' },
  // Russia (v0.6.3), from AIP Russia as read on 2026-11-20 (UHWW AD 2.17 and its ILS Z 25L chart, ENR 1.7, GEN 2.1):
  // QNH in hPa and altitudes in feet at Vladivostok, the transition altitude 8,000 ft, the level FL090 with the QNH at
  // 1013 hPa or more (FL100 from 977, FL110 below: one value here, the standard day's), the wind in metres per
  // second, UTC+10 with no summer time. The whole of Russia's part of the map takes Vladivostok's zone and
  // transition (Sakhalin is UTC+11): right at the one Russian airport, [EST] elsewhere.
  RU: { ...KR_RULES, country: 'RU', timeZone: 'Asia/Vladivostok', zoneName: 'VLAT', transAltM: 8000 * FT_M, transLevelM: 9000 * FT_M, metar: 'ru' },
};
// v0.7.0: the page's region's table and default. COUNTRY_RULES above is East Asia's, as it was.
const RULES = HOME_REGION ? COUNTRY_RULES : EUROPE_RULES;
const DEFAULT_RULES = HOME_REGION ? KR_RULES : EUROPE_DEFAULT_RULES;
export const regionRulesTable = () => RULES;
// The transition altitudes set airport by airport (rules-europe.js; East Asia has none): within the radius of
// such an airport its altitude and level replace the country's, the nearer airport's where two reach. The zone,
// the units and the country stay the place's own. One object per (country, airport), made once: no garbage.
const AIRPORT_TA = HOME_REGION ? [] : Object.entries(EUROPE_AIRPORT_TRANSITIONS).map(([icao, t]) => {
  const [x, y] = toMap(t.at[0], t.at[1]);
  return { icao, x, y, transAltM: t.taFt * FT_M, transLevelM: t.tlFl * 100 * FT_M };
});
const TA_R2 = AIRPORT_TRANSITION_RADIUS_M * AIRPORT_TRANSITION_RADIUS_M;
const taRules = new Map();
export function rulesAt(x, y) {
  const r = RULES[countryAt(x, y)] || DEFAULT_RULES;
  if (AIRPORT_TA.length === 0) return r;
  let best = null, bd = TA_R2;
  for (let k = 0; k < AIRPORT_TA.length; k++) {
    const a = AIRPORT_TA[k], dx = x - a.x, dy = y - a.y, d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = a; }
  }
  if (best === null || (best.transAltM === r.transAltM && best.transLevelM === r.transLevelM)) return r;
  const key = r.country + '|' + best.icao;
  let o = taRules.get(key);
  if (o === undefined) { o = Object.freeze({ ...r, transAltM: best.transAltM, transLevelM: best.transLevelM, transAt: best.icao }); taRules.set(key, o); }
  return o;
}

// Which terrain the manifest gives: the region's tiles (`tilesRegion`), and Korea's three airports'
// `patches`/`coastPatches`/`airports` with the region's (`…Region`) and, with PENDING_ON, the
// pending ones (`…Pending`) added. `region` is true whenever the manifest has the region's tiles.
export function terrainSpec(manifest) {
  const m = manifest || {};
  const region = !!m.tilesRegion;
  if (m.tilesRegion && m.tilesRegion !== fineSpec) { fineSpec = m.tilesRegion; fineEdges = null; }   // (for fineOutline())
  const pending = region && PENDING_ON;
  return {
    region,
    tiles: region ? m.tilesRegion : null,
    patches: (m.patches || []).concat(region ? m.patchesRegion || [] : [], pending ? m.patchesPending || [] : []),
    coastPatches: (m.coastPatches || []).concat(region ? m.coastPatchesRegion || [] : [], pending ? m.coastPatchesPending || [] : []),   // (coastPatchesPending: v0.6.3)
    airports: (m.airports || []).concat(region ? m.airportsRegion || [] : [], pending ? m.airportsPending || [] : []),
  };
}

export const KEEP_RADIUS_M = 40000;      // round the aircraft and the camera
export const AHEAD_S = 120;              // load ahead along the track this far
export const END_RADIUS_M = 30000;       // round the departure and the arrival
export const WAIT_NOTICE_MS = 500;       // "Loading terrain…" once a wait passes this

// hf: a tiled heightfield (heightfield.js with layers.tiles), or anything else (then the
// loader does nothing and never holds a step).
export function createTerrainLoader(hf) {
  const T = hf && hf.layers && hf.layers.tiles;
  let noticed = false, waitingSince = 0, lastX = Infinity, lastY = Infinity, lastT = 0;
  const loader = {
    // Each frame: ask for the tiles the flight will read. Throttled: again once the aircraft has
    // moved 2 km or a second has passed (no garbage per frame).
    update(state, cam, ends = [], force = false) {
      if (!T) return;
      const p = state.pos, v = state.vel || { x: 0, y: 0 };
      const now = performance.now();
      if (!force && Math.hypot(p.x - lastX, p.y - lastY) < 2000 && now - lastT < 1000) return;
      lastX = p.x; lastY = p.y; lastT = now;
      T.whenReady(p.x, p.y, KEEP_RADIUS_M, 'aircraft');
      T.whenReady(p.x + v.x * AHEAD_S, p.y + v.y * AHEAD_S, KEEP_RADIUS_M, 'ahead');
      if (cam) T.whenReady(cam.x, cam.y, KEEP_RADIUS_M, 'camera');
      ends.forEach((e, k) => { if (e) T.whenReady(e.x, e.y, END_RADIUS_M, 'end' + k); });
    },
    // May steps covering `seconds` of sim time run now? The aircraft can move at most
    // |v|·seconds plus a margin (a jump or a restore moves it outright: the next frame asks again).
    ready(state, seconds) {
      if (!T) return true;
      const v = state.vel || { x: 0, y: 0, z: 0 };
      const reach = Math.hypot(v.x, v.y) * seconds + 2000;
      const ok = T.isReady(state.pos.x, state.pos.y, reach);
      if (ok) { waitingSince = 0; noticed = false; }
      else if (!waitingSince) waitingSince = performance.now();
      return ok;
    },
    // True once per wait, when it has lasted long enough to say so.
    showWaiting() {
      if (noticed || !waitingSince || performance.now() - waitingSince <= WAIT_NOTICE_MS) return false;
      noticed = true;
      return true;
    },
    // A jump, a new flight or a loaded scenario: resolves when the target's tiles are in.
    whenReadyAt(x, y, r = KEEP_RADIUS_M) { return T ? T.whenReady(x, y, r, 'aircraft') : Promise.resolve(); },
  };
  return loader;
}
