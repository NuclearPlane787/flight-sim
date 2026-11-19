// V060.md Part 6 step 3: pictures of the landmarks, headless, from a fixed clock. For every landmark a
// close pass by day (about 1.5x its height away, a little above mid-height) and one at night, a skyline per
// city from about 3,000 ft a few km away, and the frame rate, draw calls and triangles with the landmarks on
// and off at Lujiazui and central Tokyo (3,000 ft, night). One page load per city. Through the CPU guard:
//   python3 tools/cpu-guard.py --minutes 20 -- node tests/browser-v060-landmarks.mjs \
//     --base http://127.0.0.1:8014/games/flight-sim/ [cities: seoul busan songdo shanghai tokyo osaka fukuoka]
// Writes "Claude outputs/flight-sim/v060-landmark-<id>.png", "-night.png", "v060-landmark-skyline-<city>.png",
// and the numbers to /tmp/flight-sim/v060/landmarks-work/landmarks-<cities>.json.
// The page is tests/dev-landmarks.html with ?cities=1 (and &eastasia=1 outside Korea); its frames are stepped
// by hand (as browser-v060-stills.mjs does) until the fps run at the end.
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim', import.meta.url).pathname);
const JSON_DIR = '/tmp/flight-sim/v060/landmarks-work';
const KST = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, 0);
const DAY = KST(2026, 11, 19, 13, 0), NIGHT = KST(2026, 11, 19, 22, 0);

// Per city: the landmarks, the close pass's azimuth (grid bearing from the landmark to the camera) for each,
// and the skyline: the point looked at (lat, lon), the camera's bearing from it and distance (m).
const CITIES = {
  seoul: { region: false, lms: { lotte: 230, b63: 170, nseoul: 200, parc1: 200 }, sky: [37.535, 126.98, 245, 9000], perf: null },
  busan: { region: false, lms: { lct: 150 }, sky: [35.16, 129.165, 160, 4500] },
  songdo: { region: false, lms: { neatt: 200 }, sky: [37.39, 126.644, 230, 4500] },
  shanghai: { region: true, lms: { shtower: 210, swfc: 120, jinmao: 300, pearl: 240 }, sky: [31.238, 121.500, 225, 5000], perf: true },
  tokyo: { region: true, lms: { skytree: 200, tokyotower: 210, azabudai: 160, tmg: 75, ylmt: 160 }, sky: [35.675, 139.76, 200, 7000], perf: true },
  osaka: { region: true, lms: { harukas: 200, umeda: 200 }, sky: [34.675, 135.50, 190, 7000] },
  fukuoka: { region: true, lms: { fktower: 160, fkdome: [200, 480, 14] }, sky: [33.594, 130.356, 150, 3500] },
};
const SKY_FT = 3000;

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

const a = process.argv.slice(2);
let base = null;
const names = [];
for (let i = 0; i < a.length; i++) { if (a[i] === '--base') base = a[++i]; else names.push(a[i]); }
if (!base) { console.error('usage: node browser-v060-landmarks.mjs --base <game folder url> [cities]'); process.exit(2); }
if (!base.endsWith('/')) base += '/';
const cities = names.length ? names : Object.keys(CITIES);
for (const c of cities) if (!CITIES[c]) { console.error('unknown city', c); process.exit(2); }
mkdirSync(OUT, { recursive: true });
mkdirSync(JSON_DIR, { recursive: true });

// In the page: a view (a landmark's pass, or a skyline), settle the region's terrain, fix the clock, capture.
const SHOOT = async ({ view, ms, steps }) => {
  const d = window.__dev, w = d.world, cam = d.cam;
  const { toMap, toGeo } = await import(new URL('../src/world/frame.js', location.href).href);
  if (view.lm) await d.pose(view.lm, view.dist ?? null, view.az, view.el ?? 8, view.look ?? 0.55);
  else {
    const [tx, ty] = toMap(view.lat, view.lon);
    const T = w.heightfield.tiles;
    cam.x = tx + view.dist * Math.sin(view.az * Math.PI / 180); cam.y = ty + view.dist * Math.cos(view.az * Math.PI / 180);
    if (T && T.whenReady) { await T.whenReady(tx, ty, 3000, 'target'); await T.whenReady(cam.x, cam.y, 40000, 'camera'); }
    const g = w.heightAt(tx, ty);
    cam.z = view.ft * 0.3048;
    cam.hdg = (view.az + 180) * Math.PI / 180;
    cam.pitch = Math.atan2(g + (view.aim ?? 150) - cam.z, view.dist);
  }
  const clip = w.uniforms.__clip;
  for (let i = 0; i < 3000; i++) {
    window.__raf.step(1);
    const lmPending = d.landmarks.items.some((it) => it.state === 'pending');
    if (i > 5 && (!clip || !clip.window.pending()) && !lmPending) break;
    await new Promise((res) => setTimeout(res, 4));
  }
  const [lat, lon] = toGeo(cam.x, cam.y);
  w.sky.setTime(ms, lat, lon);
  if (Number.isFinite(w.sky.state.exposure)) d.renderer.toneMappingExposure = w.sky.state.exposure;
  for (let i = 0; i < steps; i += 10) { window.__raf.step(Math.min(10, steps - i)); await new Promise((res) => setTimeout(res, 0)); }
  window.__raf.step(1);
  const url = d.renderer.domElement.toDataURL('image/png');
  const ri = d.renderer.info.render;
  return { url, cam: { ...cam }, calls: ri.calls, triangles: ri.triangles, lm: { ...d.landmarks.stats }, night: w.uniforms.uNight.value };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const results = [];
let failed = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(INIT);
  for (const city of cities) {
    const C = CITIES[city];
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const t0 = Date.now();
    const first = Object.keys(C.lms)[0];
    await page.goto(`${base}tests/dev-landmarks.html?hud=0&cities=1${C.region ? '&eastasia=1' : ''}&lm=${first}`);
    try {
      await page.waitForFunction(() => window.__dev && window.__raf && window.__raf.has(), null, { timeout: 120000, polling: 250 });
    } catch {
      console.log(city, 'did not start', errors.join('\n')); failed++; await page.close(); continue;
    }
    const shots = [];
    for (const [id, v] of Object.entries(C.lms)) {
      // v: the azimuth, or [azimuth, distance (m), elevation (deg)] where 1.5x the height is too close (the dome)
      const [az, dist, el] = Array.isArray(v) ? v : [v, null, 8];
      shots.push({ file: `v060-landmark-${id}.png`, view: { lm: id, az, dist, el }, ms: DAY });
      shots.push({ file: `v060-landmark-${id}-night.png`, view: { lm: id, az, dist, el }, ms: NIGHT });
    }
    const [la, lo, az, dist] = C.sky;
    shots.push({ file: `v060-landmark-skyline-${city}.png`, view: { lat: la, lon: lo, az, dist, ft: SKY_FT }, ms: DAY });
    shots.push({ file: `v060-landmark-skyline-${city}-night.png`, view: { lat: la, lon: lo, az, dist, ft: SKY_FT }, ms: NIGHT });
    for (const s of shots) {
      try {
        const r = await page.evaluate(SHOOT, { view: s.view, ms: s.ms, steps: 60 });
        writeFileSync(`${OUT}/${s.file}`, Buffer.from(r.url.split(',')[1], 'base64'));
        const { url, ...rest } = r;
        results.push({ city, file: s.file, ...rest });
        console.log(`${s.file}: ${r.calls} calls, ${(r.triangles / 1000).toFixed(0)}k tris, landmarks ${r.lm.shown} shown, ${r.lm.drawCalls} calls, ${(r.lm.triangles / 1000).toFixed(1)}k tris, night ${r.night.toFixed(2)}`);
      } catch (e) { console.log(s.file, 'failed', e.message); failed++; }
    }
    if (C.perf) {
      // The frame rate over the skyline at night, the landmarks on, then off (real frames).
      const perf = await page.evaluate(async () => {
        const st = window.__raf, d = window.__dev;
        st.goReal();
        const run = async () => {
          await new Promise((res) => setTimeout(res, 600));
          const n0 = st.stamps.length;
          await new Promise((res) => setTimeout(res, 3000));
          const s = st.stamps.slice(n0), ri = d.renderer.info.render;
          return { fps: (s.length - 1) * 1000 / (s[s.length - 1] - s[0]), worstMs: Math.max(...s.slice(1).map((t, i) => t - s[i])), calls: ri.calls, triangles: ri.triangles, lm: { ...d.landmarks.stats } };
        };
        const on = await run();
        d.landmarks.enabled = false;
        const off = await run();
        d.landmarks.enabled = true;
        return { on, off };
      });
      results.push({ city, perf });
      console.log(`${city} perf (3,000 ft, night): on ${perf.on.fps.toFixed(1)} fps (worst ${perf.on.worstMs.toFixed(1)} ms), ${perf.on.calls} calls, ${(perf.on.triangles / 1000).toFixed(0)}k tris; off ${perf.off.fps.toFixed(1)} fps (worst ${perf.off.worstMs.toFixed(1)} ms), ${perf.off.calls} calls, ${(perf.off.triangles / 1000).toFixed(0)}k tris`);
    }
    const builds = await page.evaluate(() => window.__dev.landmarks.items.filter((it) => it.ms).map((it) => [it.L.id, +it.ms.toFixed(2), it.tris]));
    console.log(`${city}: builds ${JSON.stringify(builds)}; ${((Date.now() - t0) / 1000).toFixed(0)} s${errors.length ? '\n  ' + [...new Set(errors)].slice(0, 6).join('\n  ') : ''}`);
    results.push({ city, builds, errors: [...new Set(errors)].slice(0, 20) });
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(`${JSON_DIR}/landmarks-${cities.join('-')}.json`, JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
