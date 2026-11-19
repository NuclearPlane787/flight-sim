// v0.6.0: no leak, the stricter way: the same two places visited three times each. The free
// camera (tests/dev-world.html, every part on) jumps Gimpo -> Haneda -> Gimpo -> ... at 3,000 ft;
// at each stop it waits for the world to settle (the tiles, the clip window, the airports'
// cluster, the city's centre and landmarks, the fine cover), then the JS heap, the GPU's
// geometries and textures and the resident tiles are read. A place's second and third visits
// must be within 20 % of its first: what is released 1,100 km away must really be released.
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 6 -- node games/flight-sim/tests/browser-v060-revisit.mjs [--settle 12]
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { toMap } from '../src/world/frame.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const SETTLE = Number(arg('--settle', 12)) * 1000;
const PLACES = { Gimpo: toMap(37.56, 126.80), Haneda: toMap(35.55, 139.78) };
const ORDER = ['Gimpo', 'Haneda', 'Gimpo', 'Haneda', 'Gimpo', 'Haneda'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const [x0, y0] = PLACES.Gimpo;
  await page.goto(`${ROOT}games/flight-sim/tests/dev-world.html?hud=0&eastasia=1&cities=1&ground=1&x=${x0.toFixed(0)}&y=${y0.toFixed(0)}&alt=3000&hdg=90&pitch=-12`);
  await page.waitForFunction(() => window.__dev && window.__dev.info, null, { timeout: 90000 });
  const seen = {};
  for (let k = 0; k < ORDER.length; k++) {
    const name = ORDER[k], [x, y] = PLACES[name];
    const m = await page.evaluate(async ({ x, y, settle }) => {
      const d = window.__dev, w = d.world;
      d.cam.x = x; d.cam.y = y;
      const busy = () => {
        const clip = w.uniforms.__clip;
        if (clip && clip.window.pending()) return 'clip';
        if (w.centres && [...w.centres.centres.values()].some((c) => ['loading', 'building', 'staging'].includes(c.state))) return 'centres';
        if (w.terrain.fine && w.terrain.fine.pending) return 'fine';
        return null;
      };
      const t0 = performance.now();
      let quiet = 0;
      while (performance.now() - t0 < 60000) {
        await new Promise((r) => setTimeout(r, 250));
        if (busy()) quiet = 0; else quiet += 250;
        if (quiet >= settle) break;
      }
      if (window.gc) { window.gc(); await new Promise((r) => setTimeout(r, 300)); window.gc(); }
      await new Promise((r) => setTimeout(r, 500));
      const T = w.heightfield.tiles, mem = d.renderer.info.memory;
      return { secs: (performance.now() - t0) / 1000, heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576), geometries: mem.geometries, textures: mem.textures,
        tiles: T.resident().length, loads: T.loads, evictions: T.evictions, misses: T.misses, calls: d.info.calls, tris: d.info.triangles, fps: d.info.fps, gc: !!window.gc };
    }, { x, y, settle: SETTLE });
    console.log(`visit ${k + 1}, ${name}: heap ${m.heapMB} MB, ${m.geometries} geometries, ${m.textures} textures, ${m.tiles} tiles resident (${m.loads} loaded, ${m.evictions} released), ${m.calls} draws, ${(m.tris / 1000).toFixed(0)}k triangles, ${m.fps.toFixed(1)} fps, settled in ${m.secs.toFixed(0)} s${m.gc ? '' : ' (no gc())'}`);
    const first = seen[name];
    if (!first) seen[name] = m;
    else {
      const ok = m.heapMB <= first.heapMB * 1.2 && m.geometries <= first.geometries * 1.2 && m.textures <= first.textures * 1.2;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name} again: within 20 % of its first visit (heap ${first.heapMB} -> ${m.heapMB} MB, geometries ${first.geometries} -> ${m.geometries}, textures ${first.textures} -> ${m.textures})`);
      if (!ok) bad++;
    }
  }
  if (errors.length) { console.log('console errors:', errors.slice(0, 4).join(' | ')); bad++; }
  console.log(bad ? 'FAIL' : 'PASS no leak over three visits to each place');
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
