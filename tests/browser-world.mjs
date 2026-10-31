// World screenshots and performance numbers, in Chrome on the real GPU.
// Run through the CPU guard, from the GameDump root or anywhere:
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 6 -- node games/flight-sim/tests/browser-world.mjs [name ...]
// Writes Claude outputs/flight-sim/world-<name>.png and prints fps, draw calls, triangles.
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim', import.meta.url).pathname);
const BASE = 'http://localhost:8001/games/flight-sim/tests/dev-world.html';

export const SHOTS = {
  'gimpo-14r': 'rwy=RKSS:14R&eye=4&pitch=-1.2',
  'jeju-07-approach': 'app=RKPC:07&ft=1500&pitch=-4',
  'seoul-han': 'lat=37.505&lon=126.93&alt=3000&hdg=75&pitch=-14',
  'hallasan': 'app=RKPC:07&ft=4000&hdg=105&pitch=-2',
  'coast-fl350': 'lat=36.0&lon=125.4&alt=35000&hdg=80&pitch=-6',
  'valley-2000': 'lat=37.37&lon=128.39&agl=2000&hdg=40&pitch=-12',
  'gimpo-14r-markings': 'rwy=RKSS:14R&eye=40&back=-20&pitch=-35',
  'gimpo-papi': 'app=RKSS:14R&ft=700&pitch=-3',
  'gimpo-papi-zoom': 'app=RKSS:14R&ft=700&pitch=-2.6&fov=6',
  'jeju-07-zoom': 'app=RKPC:07&ft=1500&pitch=-3.0&fov=8',
  'gimpo-overview': 'lat=37.585&lon=126.75&alt=2500&hdg=135&pitch=-18',
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
const results = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  for (const name of names) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(`${BASE}?${SHOTS[name] || name}`);
    try {
      await page.waitForFunction(() => window.__dev && window.__dev.ready, null, { timeout: 60000 });
    } catch (e) {
      console.log(name, 'did not start', errors.join('\n'));
      results.push({ name, error: 'timeout', errors });
      await page.close();
      continue;
    }
    await page.waitForTimeout(1500);
    // Average fps over 2 s.
    const perf = await page.evaluate(async () => {
      const d = window.__dev;
      const n0 = d.frameTimes.length;
      await new Promise((r) => setTimeout(r, 2000));
      const ft = d.frameTimes.slice(n0);
      const avg = ft.reduce((a, b) => a + b, 0) / Math.max(ft.length, 1);
      return { fps: 1000 / avg, worstMs: Math.max(...ft), calls: d.info.calls, triangles: d.info.triangles, cpuMs: d.info.cpuMs, stats: d.info.stats, loadMs: d.loadMs };
    });
    await page.evaluate(() => { document.getElementById('hud').style.display = 'none'; });
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${OUT}/world-${name}.png` });
    const r = { name, ...perf, errors };
    results.push(r);
    console.log(`${name}: ${perf.fps.toFixed(1)} fps (worst ${perf.worstMs.toFixed(1)} ms), ${perf.calls} calls, ${(perf.triangles / 1000).toFixed(0)}k tris, world.stats ${perf.stats.drawCalls} calls / ${(perf.stats.triangles / 1000).toFixed(0)}k, cpu ${perf.cpuMs.toFixed(2)} ms, load ${perf.loadMs.toFixed(0)} ms` +
      (errors.length ? `\n  ${errors.slice(0, 5).join('\n  ')}` : ''));
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync('/tmp/flight-sim/world/last-run.json', JSON.stringify(results, null, 2));
