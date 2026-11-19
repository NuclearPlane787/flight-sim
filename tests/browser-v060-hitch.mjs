// v0.6.0: where the long frames come from while the region's tiles load. The free camera
// (tests/dev-world.html, the region on) flies from Seoul to Tokyo at FL350 at a 16x cruise's
// ground speed (3.84 km/s) on real frames; every frame's interval is logged, and the world's
// parts (the clip window's fill and upload, the cities' and the lights' block lists, each
// update) are timed from outside, so a slow frame names its cause.
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 6 -- node games/flight-sim/tests/browser-v060-hitch.mjs [--alt 35000] [--speed 3840] [--from lat,lon] [--to lat,lon]
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { toMap } from '../src/world/frame.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const alt = Number(arg('--alt', 35000)), speed = Number(arg('--speed', 3840));
const from = arg('--from', '37.56,126.80').split(',').map(Number), to = arg('--to', '35.55,139.78').split(',').map(Number);
const [x0, y0] = toMap(from[0], from[1]), [x1, y1] = toMap(to[0], to[1]);
const hdg = Math.atan2(x1 - x0, y1 - y0) * 180 / Math.PI;
const cities = process.argv.includes('--cities') ? '&cities=1' : '';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${ROOT}games/flight-sim/tests/dev-world.html?hud=0&eastasia=1${cities}&x=${x0.toFixed(0)}&y=${y0.toFixed(0)}&alt=${alt}&hdg=${hdg.toFixed(1)}&pitch=-9`);
  await page.waitForFunction(() => window.__dev && window.__dev.info, null, { timeout: 90000 });
  // Let the first window fill, then start.
  await page.waitForFunction(() => { const c = window.__dev.world.uniforms.__clip; return !c || !c.window.pending(); }, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const res = await page.evaluate(async ({ x1, y1, speed }) => {
    const d = window.__dev, w = d.world, cam = d.cam;
    const marks = [];   // { name, t, ms } for anything over 2 ms
    const wrap = (obj, fn, name) => {
      if (!obj || typeof obj[fn] !== 'function') return;
      const f = obj[fn].bind(obj);
      obj[fn] = (...a) => { const t = performance.now(); const r = f(...a); const ms = performance.now() - t; if (ms > 2) marks.push({ name, t, ms }); return r; };
    };
    const clip = w.uniforms.__clip;
    wrap(clip, 'update', 'clip.update (fill)'); wrap(clip, 'flush', 'clip.flush (upload)');
    // Inside the fill: each step with what it filled, and the store's part.
    if (clip) {
      const cw = clip.window, st = cw.step.bind(cw), T0 = w.heightfield.tiles;
      cw.step = () => { const t = performance.now(); const r = st(); const ms = performance.now() - t; if (ms > 2) marks.push({ name: 'step ' + (r ? cw.win.last : 'none (waiting)'), t, ms }); return r; };
      wrap(cw, 'moveTo', 'cw.moveTo'); wrap(cw, 'valid', 'cw.valid'); wrap(cw, 'peak', 'cw.peak');
      wrap(T0, 'request', 'store.request'); wrap(T0, 'tileGrid', 'store.tileGrid');
    }
    const near = w.uniforms.__near;
    wrap(near, 'update', 'near.update'); wrap(near, 'flush', 'near.flush');
    wrap(w.terrain, 'update', 'terrain.update'); wrap(w.cities, 'update', 'cities.update'); wrap(w.cityLights, 'update', 'cityLights.update');
    wrap(w.runways, 'update', 'runways.update'); wrap(w.aprons, 'update', 'aprons.update'); wrap(w.traffic, 'update', 'traffic.update');
    wrap(w.taxiLights, 'update', 'taxiLights.update'); wrap(w.trees, 'update', 'trees.update'); wrap(w.sky, 'update', 'sky.update');
    wrap(w, 'update', 'world.update (all)'); wrap(d.renderer, 'render', 'renderer.render');
    const sx = cam.x, sy = cam.y, dist = Math.hypot(x1 - sx, y1 - sy), ux = (x1 - sx) / dist, uy = (y1 - sy) / dist;
    const frames = [];
    let last = performance.now(), t0 = last, done = false;
    await new Promise((resolve) => {
      const tick = (t) => {
        const dt = t - last; last = t;
        frames.push({ t, dt, x: cam.x });
        const go = Math.min(dist, (t - t0) / 1000 * speed);
        cam.x = sx + ux * go; cam.y = sy + uy * go;
        if (go >= dist) { done = true; resolve(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const dts = frames.slice(2).map((f) => f.dt).sort((a, b) => a - b);
    const slow = frames.slice(2).filter((f) => f.dt > 25).map((f) => ({ dt: f.dt, km: (f.x - sx) / 1000, why: marks.filter((m) => m.t >= f.t - f.dt - 1 && m.t <= f.t + 1 && m.name !== 'world.update (all)').map((m) => `${m.name} ${m.ms.toFixed(1)}`) }));
    const byName = {};
    for (const m of marks) { const nm = m.name.startsWith('step ') ? 'cw.step' : m.name; const b = byName[nm] = byName[nm] || { n: 0, max: 0, sum: 0 }; b.n++; b.sum += m.ms; if (m.ms > b.max) b.max = m.ms; }
    const T = w.heightfield.tiles, mem = d.renderer.info.memory;
    const steps = marks.filter((m) => m.name.startsWith('step ')).sort((p, q) => q.ms - p.ms).slice(0, 12).map((m) => `${m.name} ${m.ms.toFixed(1)}`);
    return { steps, n: dts.length, secs: (last - t0) / 1000, km: dist / 1000, p50: dts[dts.length >> 1], p99: dts[Math.floor(dts.length * 0.99)], worst: dts[dts.length - 1], over25: slow.length, slow: slow.slice(0, 30), byName,
      uploads: clip ? clip.uploadsDone : 0, tiles: T.resident().length, loads: T.loads, evictions: T.evictions, geometries: mem.geometries, textures: mem.textures, heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576) };
  }, { x1, y1, speed });
  console.log(`${res.km.toFixed(0)} km in ${res.secs.toFixed(0)} s (${res.n} frames): median ${res.p50.toFixed(1)} ms, p99 ${res.p99.toFixed(1)} ms, worst ${res.worst.toFixed(1)} ms, ${res.over25} over 25 ms`);
  console.log(`clip uploads ${res.uploads}; store ${res.tiles} tiles resident, ${res.loads} loaded, ${res.evictions} released; geometries ${res.geometries}, textures ${res.textures}, heap ${res.heapMB} MB`);
  console.log('calls over 2 ms, by part:');
  for (const [k, v] of Object.entries(res.byName).sort((a, b) => b[1].max - a[1].max)) console.log(`  ${k}: ${v.n} times, max ${v.max.toFixed(1)} ms, mean ${(v.sum / v.n).toFixed(1)} ms`);
  console.log('slowest fill steps:', res.steps.join(' | '));
  for (const s of res.slow) console.log(`slow frame ${s.dt.toFixed(1)} ms at ${s.km.toFixed(0)} km: ${s.why.join('; ') || '(nothing of ours over 2 ms)'}`);
  if (errors.length) { console.log('console errors:', errors.slice(0, 5).join(' | ')); bad++; }
  if (res.worst > 25) bad++;
  console.log(res.worst <= 25 ? 'PASS worst frame at most 25 ms' : 'FAIL worst frame over 25 ms');
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
