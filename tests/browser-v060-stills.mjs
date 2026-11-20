// v0.6.0 Part 0: the "before" stills and numbers, from fixed views and a fixed clock, so later parts can be
// compared exactly (tests/v060-pixdiff.mjs). In Chrome on the Mac's GPU, through the CPU guard, from GameDump:
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 20 -- node games/flight-sim/tests/browser-v060-stills.mjs \
//     --base http://127.0.0.1:8014/games/flight-sim/ --tag base [--headed] [names or groups: part1 part6 part7 ...]
// v0.6.1: --prefix <p> names the pictures <p>-<tag>-<name>.png (v060 by default); --pending adds ?pending=1 (an airport
// still in the manifest's airportsPending), --nocull ?cull=0 (draw what is out of view too), --q '<more query>' anything else.
// Headless Chrome (ANGLE on Metal) by default; the JSON records the mode and the WebGL renderer string, and marks
// the fps not valid on SwiftShader. Before and after pictures must be made the same way (both headless).
// --base is the URL of the game's folder (the page used is <base>tests/dev-world.html). Writes
// "Claude outputs/flight-sim/v060-<tag>-<name>.png" (read off the canvas in the same task as the draw) and the numbers
// to /tmp/flight-sim/v060/stills/<tag>.json: fps over 3 s, renderer.info.render calls and triangles, the JS heap.
//
// Determinism: dev-world.html's frames come from requestAnimationFrame, which this script replaces before the page
// runs. Until the capture, frames are stepped by hand with a fixed timeline (the first frame dt = 0.1 s, the clamp;
// then exactly 1/60 s), so uTime (water, twinkling lights, runway rabbits, stars) and the traffic are the same
// every run. The clock is fixed by world.sky.setTime() (dev-world never calls it), the exposure as main.js sets
// it; the weather is dev-world's default (clear). Only after the capture does the page run on real frames, for
// the fps.
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { toMap } from '../src/world/frame.js';

const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim', import.meta.url).pathname);
const JSON_DIR = '/tmp/flight-sim/v060/stills';
const DEG = Math.PI / 180, FT = 0.3048;
const KST = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, 0);
const DAY = KST(2026, 11, 19, 13, 0), NIGHT = KST(2026, 11, 19, 22, 0);
const STEPS = 120;          // hand-stepped frames before the capture
const FPS_MS = 3000;

// A view looking at a ground point: the camera stands back along the heading so the point is in the middle of
// the frame at that pitch (aglFt above the point's ground, flat-ground geometry).
function look(lat, lon, aglFt, hdg, pitch) {
  const [tx, ty] = toMap(lat, lon), d = (aglFt * FT) / Math.tan(-pitch * DEG);
  const x = tx - d * Math.sin(hdg * DEG), y = ty - d * Math.cos(hdg * DEG);
  return `x=${x.toFixed(1)}&y=${y.toFixed(1)}&agl=${aglFt}&hdg=${hdg}&pitch=${pitch}&aglAt=${tx.toFixed(1)},${ty.toFixed(1)}`;
}
const PITCH = { 1000: -14, 3000: -20, 10000: -28 };

export const SHOTS = {};
// Part 1: Korea in tiles against v0.5.8.
SHOTS['gimpo-day'] = { q: 'app=RKSS:14R&ft=1200&pitch=-4.5', ms: DAY };
SHOTS['jeju-day'] = { q: 'app=RKPC:07&ft=1500&pitch=-4', ms: DAY };
SHOTS['incheon-day'] = { q: 'app=RKSI:33L&ft=1500&pitch=-4', ms: DAY };
SHOTS['seoul-night'] = { q: 'lat=37.505&lon=126.93&alt=3000&hdg=75&pitch=-14', ms: NIGHT };
// Part 6: Seoul's dense centres.
const CENTRES = { jamsil: [37.5125, 127.1000, 60], yeouido: [37.5250, 126.9250, 75], centre: [37.5665, 126.9780, 0] };
for (const [k, [la, lo, h]] of Object.entries(CENTRES)) {
  for (const ft of [3000, 10000]) {
    for (const [tod, ms] of [['day', DAY], ['night', NIGHT]]) SHOTS[`seoul-${k}-${ft}-${tod}`] = { q: look(la, lo, ft, h, PITCH[ft]), ms };
  }
}
// Part 7: the ground.
// (The brief's 37.55N 126.55E is open sea in the game's map and 33.40N 126.75E Hallasan's forested foothills, so
// the targets are moved onto the farmland nearby: Gimpo's plain north-west of the airport, Jeju's eastern fields.)
const GROUND = { 'west-gimpo': [37.68, 126.47, 0], 'nakdong': [35.13, 128.90, 200], 'jeju-farm': [33.45, 126.83, 90] };
for (const [k, [la, lo, h]] of Object.entries(GROUND)) {
  for (const ft of [1000, 3000, 10000]) SHOTS[`ground-${k}-${ft}`] = { q: look(la, lo, ft, h, PITCH[ft]), ms: DAY };
}
// The region (the evening sitting): --region puts ?eastasia=1 on the page and waits for the tiles
// (the store's round the camera, then the clip window's blocks) before the fixed timeline starts.
const FL350 = 35000;
SHOTS['world-fl350-kanto'] = { q: 'lat=35.75&lon=137.6&alt=35000&hdg=95&pitch=-9', ms: DAY };            // the Alps, Fuji, the Kanto plain and Tokyo ahead
SHOTS['world-fl350-seoul-east'] = { q: 'lat=37.45&lon=126.6&alt=35000&hdg=95&pitch=-9', ms: DAY };       // over Incheon, Seoul and the east coast ahead
SHOTS['world-fl350-shanghai-west'] = { q: 'lat=31.2&lon=122.6&alt=35000&hdg=270&pitch=-8', ms: DAY };    // Shanghai and inland China: no edge
SHOTS['world-fl350-nk-north'] = { q: 'lat=38.6&lon=126.8&alt=35000&hdg=10&pitch=-8', ms: DAY };          // North Korea to the Yalu and beyond: no edge
SHOTS['world-fl350-kyushu'] = { q: 'lat=34.6&lon=128.9&alt=35000&hdg=140&pitch=-10', ms: DAY };          // the old square's band: Tsushima, Kyushu
SHOTS['world-fl350-dmz'] = { q: 'lat=37.35&lon=127.4&alt=35000&hdg=345&pitch=-12', ms: DAY };            // the DMZ from cruise
SHOTS['world-fl350-kansai'] = { q: 'lat=34.2&lon=133.6&alt=35000&hdg=80&pitch=-10', ms: DAY };           // the Seto Inland Sea to Osaka Bay
SHOTS['world-fuji-15000'] = { q: 'lat=35.25&lon=138.25&alt=15000&hdg=75&pitch=-4', ms: DAY };            // Fuji from the west
SHOTS['world-3000-tokyo'] = { q: look(35.675, 139.76, 3000, 20, -12), ms: DAY };
SHOTS['world-3000-tokyo-night'] = { q: look(35.675, 139.76, 3000, 20, -12), ms: NIGHT };
SHOTS['world-3000-pudong'] = { q: look(31.2, 121.6, 3000, 285, -12), ms: DAY };
SHOTS['world-3000-shanghai-night'] = { q: look(31.235, 121.5, 3000, 285, -12), ms: NIGHT };
SHOTS['world-10000-osaka'] = { q: look(34.69, 135.5, 10000, 30, -20), ms: DAY };
SHOTS['world-10000-fukuoka'] = { q: look(33.59, 130.4, 10000, 160, -20), ms: DAY };
SHOTS['world-10000-busan'] = { q: look(35.16, 129.06, 10000, 30, -20), ms: DAY };
const FINALS = { ZSPD: '35L', RJTT: '34L', RJAA: '34L', RKPK: '36L', ZSSS: '36R', RJBB: '06R', RJFF: '16L', ZSQD: '34', ZSYN: '04' };   // (ZSYN: v0.6.1)
for (const [icao, end] of Object.entries(FINALS)) {
  SHOTS[`${icao}-final`] = { q: `app=${icao}:${end}&ft=1000&pitch=-4`, ms: DAY };
  SHOTS[`${icao}-final-night`] = { q: `app=${icao}:${end}&ft=1000&pitch=-4`, ms: NIGHT };
}
// Part 6's "Done when": the six cities from 3,000 ft and FL350, by day and by night (--region --cities).
const CITY6 = { tokyo: [35.672, 139.755, 20], shanghai: [31.237, 121.497, 285], seoul: [37.525, 126.925, 75], busan: [35.161, 129.150, 40], osaka: [34.690, 135.500, 20], fukuoka: [33.590, 130.400, 160] };
for (const [k, [la, lo, h]] of Object.entries(CITY6)) {
  for (const [alt, pitch] of [[3000, -12], [35000, -38]]) {
    for (const [tod, ms] of [['day', DAY], ['night', NIGHT]]) SHOTS[`cities-${k}-${alt === 3000 ? '3000' : 'fl350'}-${tod}`] = { q: look(la, lo, alt, h, pitch), ms };
  }
}
// The definition of done's two views, and the ground close to the camera far from the map's origin
// (briefs/V0-6-0.md, "Precision far from the origin": Narita is 1,160 km east of it, Gimpo 60 km west).
SHOTS['fuji-haneda-arrival'] = { q: 'lat=35.30&lon=139.62&alt=9000&hdg=268&pitch=-3', ms: DAY };          // Fuji from the arrival over Sagami Bay
SHOTS['gimhae-approach'] = { q: 'lat=35.02&lon=128.925&alt=3500&hdg=2&pitch=-6', ms: DAY };               // Gimhae's runways under Sineosan and Geumjeongsan
SHOTS['close-rkss'] = { q: 'rwy=RKSS:14R&back=150&eye=9&pitch=-14&hdg=176', ms: DAY };
SHOTS['close-rjaa'] = { q: 'rwy=RJAA:34L&back=150&eye=9&pitch=-14&hdg=10', ms: DAY };
SHOTS['close-rjtt'] = { q: 'rwy=RJTT:34L&back=150&eye=9&pitch=-14&hdg=20', ms: DAY };
SHOTS['close-zspd'] = { q: 'rwy=ZSPD:34L&back=150&eye=9&pitch=-14&hdg=20', ms: DAY };
const GROUND2 = { kanto: [36.05, 140.05, 30], yangtze: [31.25, 120.85, 280], kyushu: [33.2, 130.45, 0] };
for (const [k, [la, lo, h]] of Object.entries(GROUND2)) {
  for (const ft of [1000, 3000, 10000]) SHOTS[`ground-${k}-${ft}`] = { q: look(la, lo, ft, h, PITCH[ft]), ms: DAY };
}
// Looking almost straight down on woods and a lake (Pyeongchang): the tree rings from above.
for (const ft of [800, 1500, 2500, 5000]) SHOTS[`down-pyeongchang-${ft}`] = { q: look(37.3817, 128.4023, ft, 0, -80), ms: DAY };
// Hillside farmland (Part 7 step 2's terraces): Namhae's south coast and the Boso hills.
SHOTS['terrace-namhae-1000'] = { q: look(34.745, 127.90, 1000, 200, -14), ms: DAY };
SHOTS['terrace-namhae-3000'] = { q: look(34.745, 127.90, 3000, 200, -20), ms: DAY };
SHOTS['terrace-boso-1000'] = { q: look(35.12, 140.03, 1000, 90, -14), ms: DAY };
SHOTS['terrace-hadong-1000'] = { q: look(35.17, 127.70, 1000, 0, -14), ms: DAY };
for (const k of ['west-gimpo', 'kanto', 'yangtze']) SHOTS[`ground-${k}-1000-night`] = { q: SHOTS[`ground-${k}-1000`].q, ms: NIGHT };
// v0.6.1: the greenhouses' tunnels, low over the Nakdong delta's and Gimpo's plain's glass, and from straight above.
// v0.6.1: Gimhae's 18R, its landing threshold displaced 600 m (Korea's eAIP), from 500 ft on the approach and from 150 ft over the pavement's end.
SHOTS['RKPK-18R-final'] = { q: 'app=RKPK:18R&ft=500&pitch=-5', ms: DAY };
SHOTS['RKPK-18R-final-night'] = { q: 'app=RKPK:18R&ft=500&pitch=-5', ms: NIGHT };
SHOTS['RKPK-36L-final-night'] = { q: 'app=RKPK:36L&ft=500&pitch=-5', ms: NIGHT };
// v0.6.1: the aprons from above (the ground between an apron's pieces and round the remote stands), and the bare
// ground of the Nakdong delta's new town from low.
SHOTS['apron-rkpk'] = { q: 'x=131300&y=-90750&agl=600&hdg=30&pitch=-35', ms: DAY };
SHOTS['apron-rkpk-south'] = { q: 'x=130850&y=-91950&agl=500&hdg=25&pitch=-32', ms: DAY };
SHOTS['apron-zsyn'] = { q: 'x=-677750&y=-259750&agl=500&hdg=45&pitch=-30', ms: DAY };
SHOTS['bare-nakdong-500'] = { q: look(35.13, 128.90, 500, 200, -18), ms: DAY };
SHOTS['gh-pyeongchang-250'] = { q: look(37.3817, 128.4023, 250, 0, -14), ms: DAY };
SHOTS['gh-pyeongchang-600'] = { q: look(37.3817, 128.4023, 600, 40, -25), ms: DAY };
SHOTS['gh-nakdong-300'] = { q: look(35.13, 128.90, 300, 200, -16), ms: DAY };
SHOTS['gh-nakdong-600'] = { q: look(35.13, 128.90, 600, 200, -22), ms: DAY };
SHOTS['gh-nakdong-down-1200'] = { q: look(35.13, 128.90, 1200, 0, -80), ms: DAY };
SHOTS['gh-gimpo-300'] = { q: look(37.68, 126.47, 300, 0, -16), ms: DAY };
SHOTS['gh-gimpo-down-1200'] = { q: look(37.68, 126.47, 1200, 0, -80), ms: DAY };
const GROUPS = {
  dod: ['fuji-haneda-arrival', 'gimhae-approach'],
  down: [800, 1500, 2500, 5000].map((ft) => `down-pyeongchang-${ft}`),
  terraces: ['terrace-namhae-1000', 'terrace-namhae-3000', 'terrace-boso-1000', 'terrace-hadong-1000'],
  close: ['close-rkss', 'close-rjaa', 'close-rjtt', 'close-zspd'],
  cities6: Object.keys(SHOTS).filter((n) => n.startsWith('cities-')),
  'cities6-3000': Object.keys(SHOTS).filter((n) => n.startsWith('cities-') && n.includes('-3000-')),
  ground2: Object.keys(GROUND2).flatMap((k) => [1000, 3000, 10000].map((ft) => `ground-${k}-${ft}`)),
  region: Object.keys(SHOTS).filter((n) => n.startsWith('world-')),
  finals: Object.keys(FINALS).map((i) => `${i}-final`),
  'finals-night': Object.keys(FINALS).map((i) => `${i}-final-night`),
  part1: ['gimpo-day', 'jeju-day', 'incheon-day', 'seoul-night'],
  part6: Object.keys(SHOTS).filter((n) => n.startsWith('seoul-') && n !== 'seoul-night'),
  part7: Object.keys(SHOTS).filter((n) => n.startsWith('ground-')),
  gh: Object.keys(SHOTS).filter((n) => n.startsWith('gh-')),
};

// The page's frame clock, replaced before the page runs.
const INIT = () => {
  const native = window.requestAnimationFrame.bind(window);
  let queued = null, fakeNow = null, offset = 0, real = false;
  const st = window.__raf = { frames: 0, stamps: [] };
  window.requestAnimationFrame = (cb) => {
    if (real) return native((ts) => { st.frames++; st.stamps.push(ts); cb(ts + offset); });
    queued = cb; return 1;
  };
  st.has = () => !!queued;
  st.step = (n) => {
    for (let i = 0; i < n; i++) {
      const cb = queued; if (!cb) throw new Error('no frame queued');
      queued = null;
      fakeNow = fakeNow === null ? performance.now() + 1e6 : fakeNow + 1000 / 60;
      cb(fakeNow);
    }
  };
  st.goReal = () => {
    real = true; offset = fakeNow - performance.now();
    const cb = queued; queued = null;
    if (cb) native((ts) => { st.frames++; st.stamps.push(ts); cb(ts + offset); });
  };
};

function args() {
  const a = process.argv.slice(2), o = { base: null, tag: null, names: [] };
  for (let i = 0; i < a.length; i++) {
    if (['--headed', '--region', '--cities', '--ground', '--pending', '--nocull'].includes(a[i])) continue;
    else if (a[i] === '--base') o.base = a[++i];
    else if (a[i] === '--tag') o.tag = a[++i];
    else if (a[i] === '--q') o.q = a[++i];             // v0.6.1: more for the page's query ("&trees=1")
    else if (a[i] === '--prefix') o.prefix = a[++i];   // v0.6.1: the pictures' prefix (v060 by default; v061 for v0.6.1's)
    else o.names.push(a[i]);
  }
  if (!o.base || !o.tag) { console.error('usage: node browser-v060-stills.mjs --base <game folder url> --tag <tag> [names|part1|part6|part7]'); process.exit(2); }
  if (!o.base.endsWith('/')) o.base += '/';
  if (!o.names.length) o.names = Object.keys(SHOTS);
  o.names = o.names.flatMap((n) => GROUPS[n] || [n]);
  for (const n of o.names) if (!SHOTS[n]) { console.error('unknown shot', n); process.exit(2); }
  return o;
}

const opt = args();
mkdirSync(OUT, { recursive: true });
mkdirSync(JSON_DIR, { recursive: true });
// Headless by default (Shane's rule: no visible windows while he uses the Mac); --headed for a visible window.
const HEADED = process.argv.includes('--headed');
const REGION = process.argv.includes('--region');
// Part 6's and Part 7's own flags (?cities=1, ?ground=1), with or without the region.
// Always explicit, whatever the shipped defaults: without --region, --cities or --ground the page is v0.5.8's Korea.
const EXTRA = `&cities=${process.argv.includes('--cities') ? 1 : 0}&ground=${process.argv.includes('--ground') ? 1 : 0}${process.argv.includes('--pending') ? '&pending=1' : ''}${process.argv.includes('--nocull') ? '&cull=0' : ''}`;   // (--pending, v0.6.1: an airport still in the manifest's airportsPending)
const browser = await chromium.launch(HEADED
  ? { channel: 'chrome', headless: false, args: ['--mute-audio', '--window-size=1440,960', '--enable-precise-memory-info', '--js-flags=--expose-gc'] }
  : { channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const MODE = HEADED ? 'headed' : 'headless';
const results = [];
let failed = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(INIT);
  for (const name of opt.names) {
    const shot = SHOTS[name];
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // aglAt (ours, ignored by the page): the height is taken over the target, not under the camera.
    const q = shot.q.replace(/&aglAt=[^&]*/, '');
    const t0 = Date.now();
    const log = (m) => { if (process.env.V060_DEBUG) console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)} s] ${name}: ${m}`); };
    await page.goto(`${opt.base}tests/dev-world.html?hud=0&${q}&eastasia=${REGION ? 1 : 0}${EXTRA}${opt.q || ''}`);
    log('loaded');
    try {
      await page.waitForFunction(() => window.__dev && window.__raf && window.__raf.has(), null, { timeout: 90000, polling: 250 });
    } catch {
      console.log(name, 'did not start', errors.join('\n'));
      results.push({ name, error: 'timeout', errors }); failed++;
      await page.close(); continue;
    }
    log('world ready');
    const aglAt = /aglAt=([-\d.]+),([-\d.]+)/.exec(shot.q);
    const r = await page.evaluate(async ({ ms, aglAt, steps, region }) => {
      const d = window.__dev, w = d.world, cam = d.cam;
      let tilesMs = 0;
      // Part 6's real centres, when they are on: every centre in range built (none loading, building or staging).
      if (w.centres) {
        await w.centres.ready;
        for (let i = 0; i < 4000; i++) {
          window.__raf.step(1);
          if (i > 20 && ![...w.centres.centres.values()].some((c) => ['building', 'staging'].includes(c.state))) break;
          await new Promise((res) => setTimeout(res, 4));
        }
      }
      // Part 7's fine cover round the camera, when it is on.
      if (w.terrain.fine) {
        for (let i = 0; i < 1500; i++) { window.__raf.step(1); if (i > 5 && !w.terrain.fine.pending) break; await new Promise((res) => setTimeout(res, 4)); }
      }
      if (region && w.heightfield.tiles) {
        // The region: the tiles round the camera and the target, then every block of the clip window.
        const T = w.heightfield.tiles, t0 = performance.now();
        await T.whenReady(cam.x, cam.y, 40000, 'camera');
        if (aglAt) await T.whenReady(aglAt[0], aglAt[1], 5000, 'target');
        const clip = w.uniforms.__clip;
        for (let i = 0; i < 3000; i++) {
          window.__raf.step(1);
          if (i > 5 && (!clip || !clip.window.pending()) && !(w.uniforms.__near && w.uniforms.__near.pending)) break;   // the window's blocks and the patches' slots
          await new Promise((res) => setTimeout(res, 4));
        }
        tilesMs = performance.now() - t0;
      }
      const { toGeo } = await import(new URL('../src/world/frame.js', location.href).href);
      const q = new URLSearchParams(location.search);
      if (aglAt && q.has('agl')) cam.z = w.heightAt(aglAt[0], aglAt[1]) + parseFloat(q.get('agl')) * 0.3048;
      const [lat, lon] = toGeo(cam.x, cam.y);
      w.sky.setTime(ms, lat, lon);
      if (Number.isFinite(w.sky.state.exposure)) d.renderer.toneMappingExposure = w.sky.state.exposure;
      for (let i = 0; i < steps; i += 10) { window.__raf.step(Math.min(10, steps - i)); await new Promise((res) => setTimeout(res, 0)); }
      // The capture: one more frame, then the canvas read in the same task.
      window.__raf.step(1);
      const url = d.renderer.domElement.toDataURL('image/png');
      const ri = d.renderer.info.render;
      const gl = d.renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const glRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return { url, glRenderer, lat, lon, cam: { ...cam }, calls: ri.calls, triangles: ri.triangles, stats: { ...w.stats }, sun: w.sky.state.sunAltDeg, night: w.uniforms.uNight.value, exposure: d.renderer.toneMappingExposure, loadMs: d.loadMs, tilesMs, storeTiles: w.heightfield.tiles ? w.heightfield.tiles.resident().length : 0, misses: w.heightfield.tiles ? w.heightfield.tiles.misses : 0 };
    }, { ms: shot.ms, aglAt: aglAt ? [parseFloat(aglAt[1]), parseFloat(aglAt[2])] : null, steps: STEPS, region: REGION });
    const file = `${OUT}/${opt.prefix || 'v060'}-${opt.tag}-${name}.png`;
    writeFileSync(file, Buffer.from(r.url.split(',')[1], 'base64'));
    log('captured');
    // The frame rate on real frames, then the heap after a GC.
    const perf = await page.evaluate(async (fpsMs) => {
      const st = window.__raf; st.goReal();
      await new Promise((res) => setTimeout(res, 500));
      const n0 = st.stamps.length;
      await new Promise((res) => setTimeout(res, fpsMs));
      const s = st.stamps.slice(n0), dts = s.slice(1).map((t, i) => t - s[i]);
      const span = s[s.length - 1] - s[0];
      const ri = window.__dev.renderer.info.render;
      if (window.gc) window.gc();
      await new Promise((res) => setTimeout(res, 100));
      return { fps: (s.length - 1) * 1000 / span, worstMs: Math.max(...dts), frames: s.length, callsLive: ri.calls, trianglesLive: ri.triangles, heapMB: performance.memory.usedJSHeapSize / 1048576 };
    }, FPS_MS);
    const { url, ...rest } = r;
    const swiftshader = /swiftshader/i.test(r.glRenderer);
    const out = { name, file, mode: MODE, swiftshader, fpsValid: !swiftshader, ms: shot.ms, q: shot.q, ...rest, ...perf, secs: (Date.now() - t0) / 1000, errors };
    results.push(out);
    console.log(`${name}: ${perf.fps.toFixed(1)} fps (worst ${perf.worstMs.toFixed(1)} ms), ${r.calls} calls, ${(r.triangles / 1000).toFixed(0)}k tris, heap ${perf.heapMB.toFixed(0)} MB, sun ${r.sun.toFixed(1)}°, night ${r.night.toFixed(2)}, ${out.secs.toFixed(0)} s, ${MODE}, ${r.glRenderer}${swiftshader ? ' (SwiftShader: fps not valid)' : ''}` +
      (errors.length ? `\n  ${errors.slice(0, 5).join('\n  ')}` : ''));
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(`${JSON_DIR}/${opt.tag}.json`, JSON.stringify(results, null, 2));
console.log(`wrote ${JSON_DIR}/${opt.tag}.json (${results.length} shots${failed ? `, ${failed} failed` : ''})`);
process.exit(failed ? 1 : 0);
