// The region (v0.6.0): East Asia, Korea's map grown. Everything beyond Korea is behind
// EAST_ASIA_ON: with it off the game is v0.5.8 in everything a player sees. It stayed off until the
// new airports could be picked, flown to and landed at end to end, and is on by default since.
//
// The terrain loader also lives here: it keeps the tiles round the aircraft, the camera, the
// departure and the arrival resident, loads ahead along the track, and tells the sim's loop
// whether this frame's steps may run (V060.md, "The sim never sees a missing tile"). Over
// Korea alone every tile is loaded at the start, so it never holds a step.

import { setMagModel } from './frame.js';
import { loadGeoRules } from './geo-rules.js';

// The shipped default. A URL parameter overrides it for a test build: ?eastasia=0 turns the
// region off (v0.5.8's Korea), ?eastasia=1 on; predict.js passes the same parameter to
// the prediction worker, whose `location` is its own script's URL, so both read one value.
// Node's tests call setEastAsia(). Importers see the live binding: read EAST_ASIA_ON (or
// eastAsiaOn()) when you need it, never copy it at import time.
export const EAST_ASIA_DEFAULT = true;    // on since the evening of 2026-11-19: the eight new airports are flown to and landed at end to end (STATUS.md)
function urlFlag(name = 'eastasia') {
  try {
    const q = (typeof location !== 'undefined' && location && location.search) || '';
    const m = new RegExp('[?&]' + name + '=([01])\\b').exec(q);
    return m ? m[1] === '1' : null;
  } catch (e) { return null; }
}
// (Node: FS_EAST_ASIA=1 or 0 in the environment overrides the default for a whole test run.)
function envFlag(name) {
  try { const v = typeof process !== 'undefined' && process.env ? process.env[name] : undefined; return v === '1' ? true : v === '0' ? false : null; } catch (e) { return null; }
}
export let EAST_ASIA_ON = urlFlag() ?? envFlag('FS_EAST_ASIA') ?? EAST_ASIA_DEFAULT;
export function setEastAsia(on) { EAST_ASIA_ON = !!on; setGeoRules(geo); }   // (installing the rules again drops frame.js's last-point cache)
export const eastAsiaOn = () => EAST_ASIA_ON;

// Part 6 (each country's own city mix, the landmarks, the real centres) and Part 7 (the new
// ground) have a flag each, off until that part was done (V060.md): ?cities=0 and ?ground=0 on
// the page's URL turn them off, setCities() / setGround() in node. Both only do anything
// with the region on, except where a part changes Korea's look on purpose.
export const CITIES_DEFAULT = true, GROUND_DEFAULT = true;   // both on since the evening of 2026-11-19 (Part 6's and Part 7's views, flights and frame rates are in STATUS.md)
export let CITIES_ON = urlFlag('cities') ?? envFlag('FS_CITIES') ?? CITIES_DEFAULT;
export function setCities(on) { CITIES_ON = !!on; }
// The new ground is on by default only with the region: ?eastasia=0&cities=0 stays v0.5.8's
// Korea, pixel for pixel (?ground=1 with it still gives Korea the new ground, for a look).
export let GROUND_ON = urlFlag('ground') ?? envFlag('FS_GROUND') ?? (GROUND_DEFAULT && EAST_ASIA_ON);
export function setGround(on) { GROUND_ON = !!on; }
// The query to add to a worker's or a dev page's URL so it sees the same region as this page.
export const regionQuery = () => (EAST_ASIA_ON === EAST_ASIA_DEFAULT ? '' : `?eastasia=${EAST_ASIA_ON ? 1 : 0}`);

// The map's extent (m, the map frame): Korea's 800 km square (frame.js's MAP_EXTENT, v0.5.8),
// or the region's whole data, the 1 km level's rectangle round 24-46 N, 112-148 E. FINE_EXTENT
// is the 250 m data's rectangle (29-40 N, 119-142 E). The predicted path ends at mapExtent(),
// and the path map draws it. (tests/region-loader.test.mjs checks both against the manifest.)
export const KOREA_EXTENT = { x0: -400000, y0: -400000, x1: 400000, y1: 400000 };
export const REGION_EXTENT = { x0: -1600000, y0: -1338000, x1: 2110000, y1: 1284000 };
export const FINE_EXTENT = { x0: -912000, y0: -784000, x1: 1520000, y1: 624000 };
export const mapExtent = () => (EAST_ASIA_ON ? REGION_EXTENT : KOREA_EXTENT);
export const fineExtent = () => (EAST_ASIA_ON ? FINE_EXTENT : KOREA_EXTENT);

// ---- The local rules by place (V060.md Part 5). One lookup the sim, the screens and the clock
// share. `geo` is geo-rules.js's object (the country raster and WMM2025), installed once it is
// loaded: by main.js, by the prediction worker before its first run, and by node's tests. With
// the flag off, or before it is installed, everywhere is Korea, as in v0.5.8. A function of
// position only: nothing here may depend on the frame, the clock or what happens to be loaded.
let geo = null;
// Installing the geo rules also installs frame.js's magnetic model (V060.md, "Magnetic
// variation"): geo.magVarAt while EAST_ASIA_ON is on, the plane itself while it is off.
export function setGeoRules(g) {
  geo = g || null;
  const G = geo;
  setMagModel(G && typeof G.magVarAt === 'function' ? (x, y, plane) => (EAST_ASIA_ON ? G.magVarAt(x, y, plane) : plane) : null);
}
export const geoRules = () => geo;
// The page and the prediction worker, once at startup: with the flag off, null at once (no
// load, nothing waits: v0.5.8); with it on, a promise that resolves once the geo rules are
// loaded and installed (to the rules, or to null if they could not load: then the plane holds
// everywhere, as with the flag off). It never rejects. Whoever steps the sim waits for it.
let localRules = null;
export function loadLocalRules(base) {
  if (!EAST_ASIA_ON) return null;
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
// 'KR' | 'KP' | 'JP' | 'CN' | 'other' (the sea takes its nearest land's country).
export function countryAt(x, y) { return EAST_ASIA_ON && geo ? geo.countryAt(x, y) : 'KR'; }
const FT_M = 0.3048;
const KR_RULES = { country: 'KR', timeZone: 'Asia/Seoul', zoneName: 'KST', baroUnit: 'hPa',
  transAltM: 14000 * FT_M, transLevelM: 14000 * FT_M, metricAlt: false, metar: 'kr' };
export const COUNTRY_RULES = {
  KR: KR_RULES,
  KP: { ...KR_RULES, country: 'KP', timeZone: 'Asia/Pyongyang' },
  // Japan: inches of mercury (hPa on request), 14,000 ft / FL140 (AIP Japan), `Q1014 ... RMK A2997`.
  JP: { ...KR_RULES, country: 'JP', timeZone: 'Asia/Tokyo', zoneName: 'JST', baroUnit: 'inHg', metar: 'jp' },
  // China: hPa, metres on the PFD, Pudong's 3,000 m / 3,600 m (Hongqiao's and Qingdao's [EST] the
  // same until their charts are read), the wind in metres per second.
  CN: { ...KR_RULES, country: 'CN', timeZone: 'Asia/Shanghai', zoneName: 'CST', transAltM: 3000, transLevelM: 3600, metricAlt: true, metar: 'cn' },
};
export function rulesAt(x, y) { return COUNTRY_RULES[countryAt(x, y)] || KR_RULES; }

// Which terrain the manifest gives: with the flag off, Korea's (`tiles`, `patches`,
// `coastPatches`, v0.5.8's extent); with it on, the region's when the manifest has it
// (`tilesRegion`, and `patchesRegion`/`coastPatchesRegion`/`airportsRegion` added to Korea's).
// A manifest without the region's sections gives Korea's either way.
export function terrainSpec(manifest, on = EAST_ASIA_ON) {
  if (on === undefined || on === null) on = EAST_ASIA_ON;
  const m = manifest || {};
  const region = !!(on && m.tilesRegion);
  return {
    region,
    tiles: region ? m.tilesRegion : m.tiles,
    patches: (m.patches || []).concat(region ? m.patchesRegion || [] : []),
    coastPatches: (m.coastPatches || []).concat(region ? m.coastPatchesRegion || [] : []),
    airports: (m.airports || []).concat(region ? m.airportsRegion || [] : []),
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
