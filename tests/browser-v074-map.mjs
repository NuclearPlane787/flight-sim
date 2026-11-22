// v0.7.4 part 3, the whole path map: the same views before (the pushed v0.7.3) and after (the tree), headless, on the
// map's dev page (no WebGL). Five zooms in each region, six airports close in, and four mountain views for the colour
// by height. Each view's draw time (ms, inside the page: not a frame-rate check) and the first open's time are printed.
//   /tmp/flight-sim/v074/gk.sh br 6 map/br.txt '^done' node games/flight-sim/tests/browser-v074-map.mjs
// Env: E2E_ROOT (default http://127.0.0.1:8014/), E2E_WHICH = before | after (default after): before takes the pages
// from E2E_BASE (default E2E_ROOT + 'base/') and writes v074-map-before-*.png; after takes the tree and writes
// v074-map-after-*.png. E2E_ONLY=<regex> takes only the views whose names match.
import { chromium } from './pw.mjs';   // (v0.7.4: Playwright with every close on a timeout; the module itself is PW or /tmp/flight-sim/pw's)
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../Claude outputs/flight-sim');
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const WHICH = process.env.E2E_WHICH === 'before' ? 'before' : 'after';
const BASE = WHICH === 'before' ? (process.env.E2E_BASE || ROOT + 'base/') : ROOT;
const ONLY = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY) : null;
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

// [name, lat, lon, metres per px] or [name, ICAO, null, metres per px] (centred on the airport)
const VIEWS = {
  'east-asia': [
    ['ea-z1-region', 35.0, 130.0, 2650], ['ea-z2-wide', 36.0, 128.5, 1300], ['ea-z3-korea', 36.5, 127.8, 600],
    ['ea-z4-seoul', 37.4, 127.0, 220], ['ea-z5-incheon', 37.45, 126.6, 70],
    ['ea-z2-beijing', 40.0, 118.0, 1000], ['ea-z3-hokkaido', 42.5, 141.5, 650],
    ['apt-RKSI', 'RKSI', null, 7], ['apt-RJTT', 'RJTT', null, 6],
    ['relief-japan', 36.0, 137.8, 650], ['relief-korea', 38.0, 127.6, 750],
  ],
  europe: [
    ['eu-z1-region', 47.0, 4.0, 2650], ['eu-z2-wide', 48.0, 5.0, 1300], ['eu-z3-west', 49.5, 3.0, 600],
    ['eu-z4-london', 51.4, -0.2, 220], ['eu-z5-heathrow', 51.47, -0.45, 70],
    ['apt-EGLL', 'EGLL', null, 6], ['apt-LFPG', 'LFPG', null, 6], ['apt-EDDF', 'EDDF', null, 6], ['apt-EDDM', 'EDDM', null, 6],
    ['relief-alps', 46.4, 9.5, 650], ['relief-pyrenees', 42.7, 0.6, 520],
  ],
};

const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed'), args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
let n = 0;
try {
  for (const region of ['east-asia', 'europe']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon|country-lines|map-relief|terminal-labels/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`${BASE}games/flight-sim/tests/dev-v060-map.html?region=${region}`);
    await page.waitForFunction(() => window.__devReady, null, { timeout: 30000 });
    // The game reads the manifest (terrainSpec) before the map opens, so the 250 m data's outline is known; the dev
    // page doesn't, so do it here, the same for before and after. And whatever later layers the map has (v0.7.4's
    // country lines, relief), loaded as main.js loads them, if this build has them.
    const openMs = await page.evaluate(async () => {
      const R = await import('../src/world/region.js'), G = await import('../src/world/regions.js');
      const base = G.dataUrl(location.href, '../');
      R.terrainSpec(await (await fetch(base + 'manifest.json')).json());
      document.getElementById('nds')?.style.setProperty('display', 'none');
      const m = window.__dev.map;
      const t0 = performance.now();
      if (m.loadExtras) await m.loadExtras(base);
      const extras = performance.now() - t0;
      const t = performance.now(); m.open(); const cv = document.querySelector('.fsui-map canvas'); cv.getContext('2d').getImageData(0, 0, 1, 1);
      return { open: performance.now() - t, extras };
    });
    console.log(`${region}: first open ${openMs.open.toFixed(1)} ms (drawn and rastered); the map's own layers loaded in ${openMs.extras.toFixed(0)} ms (async, before it)`);
    await page.waitForTimeout(300);
    for (const [name, a, b, mpp] of VIEWS[region]) {
      if (ONLY && !ONLY.test(name)) continue;
      const r = await page.evaluate(async ([a, b, mpp]) => {
        const F = await import('../src/world/frame.js');
        let x, y;
        if (typeof a === 'string') {
          const apt = window.__dev.airports.find((q) => q.icao === a);
          [x, y] = apt.origin || [apt.runways[0].ends[0].x, apt.runways[0].ends[0].y];
          if (apt.runways?.length) {   // the runways' middle
            let sx = 0, sy = 0, c = 0; for (const rw of apt.runways) for (const e of rw.ends) { sx += e.x; sy += e.y; c++; }
            x = sx / c; y = sy / c;
          }
        } else [x, y] = F.toMap(a, b);
        const m = window.__dev.map; m._devView(x, y, mpp);
        if (m._devReady) await m._devReady();
        m._devView(x, y, mpp);
        const cv = document.querySelector('.fsui-map canvas'), c2 = cv.getContext('2d');
        c2.getImageData(0, 0, 1, 1);
        const t = performance.now(); for (let i = 0; i < 10; i++) { m._devDrawMs(1); c2.getImageData(0, 0, 1, 1); }
        return { ms: m._devDrawMs(10), rast: (performance.now() - t) / 10, x, y };
      }, [a, b, mpp]);
      console.log(`  ${name.padEnd(18)} draw ${r.ms.toFixed(2)} ms, with its rastering ${r.rast.toFixed(2)} ms`);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT, `v074-map-${WHICH}-${name}.png`) });
      n++;
    }
    check(`${region}: the dev page has no errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await withTimeout(ctx.close(), 8000);
  }
  // The game itself (after only): the map opened in a flight from Gimpo to Beijing Capital, zoomed out over the route,
  // with the page's own loading (main.js's loadExtras), no errors, and no country name across the magenta line.
  if (WHICH === 'after' && (!ONLY || ONLY.test('game'))) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${ROOT}games/flight-sim/?test&origin=RKSS&dep=32L&dest=ZBAA&arr=36R&start=runway`);
    await page.waitForFunction(() => window.__fs && window.__fs.frames !== undefined && document.getElementById('loading').hidden, null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      const f = window.__fs, m = f.map;
      m.open();
      const F = await import('./src/world/frame.js');
      const [x, y] = F.toMap(38.6, 121.8);
      m._devView(x, y, 1250);
      await new Promise((res) => setTimeout(res, 300));
      m._devView(x, y, 1250);
      const names = m._devCountries();
      // the route on the screen: the aircraft to Beijing's runway, as the map draws it (map.js routePts())
      const cv = document.querySelector('.fsui-map canvas').getBoundingClientRect();
      const a = m._devScreen(f.sim.state.pos.x, f.sim.state.pos.y);
      const end = f.dest && f.dest.end;
      const b = end ? m._devScreen(end.x, end.y) : a;
      const seg = [a[0] - cv.left, a[1] - cv.top, b[0] - cv.left, b[1] - cv.top];
      const hits = names.filter((n) => {
        const B = n.box; let t0 = 0, t1 = 1; const dx = seg[2] - seg[0], dy = seg[3] - seg[1];
        for (const [p, q] of [[-dx, seg[0] - B.x0], [dx, B.x1 - seg[0]], [-dy, seg[1] - B.y0], [dy, B.y1 - seg[1]]]) {
          if (p === 0) { if (q < 0) return false; continue; }
          const rr = q / p; if (p < 0) { if (rr > t1) return false; if (rr > t0) t0 = rr; } else { if (rr < t0) return false; if (rr < t1) t1 = rr; }
        }
        return true;
      });
      return { names: names.map((n) => n.name), hits: hits.map((n) => n.name), dest: end && end.ident };
    });
    await page.screenshot({ path: path.join(OUT, 'v074-map-after-game-route.png') });
    n++;
    console.log(`game: names ${r.names.join(', ')}; to ${r.dest}`);
    check('the game: the map\'s countries named, none across the route', r.names.length > 0 && r.hits.length === 0, r.hits.join(', '));
    check('the game: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await withTimeout(ctx.close(), 8000);
  }
} finally { await withTimeout(browser.close(), 8000); }
console.log(`done ${n} pictures, ${results.filter(Boolean).length} of ${results.length} checks pass`);
process.exit(results.every(Boolean) ? 0 : 1);
