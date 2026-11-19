// v0.6.0 Part 1: the game over Korea's own tiles with the region off (?eastasia=0: v0.5.8's Korea), headless on the M5 (Shane: no windows until 01:30).
// Boots a test flight at Gimpo, checks the sim runs (the loader never holds a step over Korea),
// no console errors, the WebGL renderer, the prediction over the terrain, and the frame numbers.
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 4 -- node games/flight-sim/tests/browser-v060-tiles.mjs [rootUrl]
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
const ROOT = process.argv[2] || process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(ROOT + 'games/flight-sim/?test&eastasia=0&cities=0&ground=0&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway');
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.frames > 30, null, { timeout: 90000 });
  const gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return c.getParameter(e.UNMASKED_RENDERER_WEBGL); });
  console.log('renderer:', gl, '(headless)');
  const t0 = await page.evaluate(() => window.__fs.sim.state.t);
  await page.waitForTimeout(3000);
  const t1 = await page.evaluate(() => window.__fs.sim.state.t);
  check('the sim steps (no wait over Korea)', t1 - t0 > 2.5, `${(t1 - t0).toFixed(2)} s in 3 s`);
  const agl = await page.evaluate(() => { const s = window.__fs.sim.state; return { z: s.pos.z, agl: s.agl, onGround: s.onGround }; });
  check('on the runway at Gimpo', agl.onGround && Math.abs(agl.z - 18) < 6, JSON.stringify(agl));
  await page.evaluate(() => window.__fs.requestPredict());
  await page.waitForTimeout(4000);
  const pr = await page.evaluate(() => { const p = window.__fs.prediction; return Array.isArray(p) ? { samples: p.length } : null; });
  // (On the runway the path may be empty; browser-predict-terrain.mjs checks the path over the terrain in flight.)
  console.log('prediction on the runway:', JSON.stringify(pr));
  const perf = await page.evaluate(async () => {
    const f0 = window.__fs.frames, t = performance.now();
    await new Promise((r) => setTimeout(r, 3000));
    const ri = window.__fs.renderer ? window.__fs.renderer.info.render : null;
    return { fps: (window.__fs.frames - f0) / ((performance.now() - t) / 1000), calls: ri && ri.calls, triangles: ri && ri.triangles, heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1e6 : null };
  });
  console.log('perf (headless):', JSON.stringify(perf));
  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
} finally { await browser.close(); }
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
