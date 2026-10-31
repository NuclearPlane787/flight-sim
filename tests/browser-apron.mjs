// Apron screenshots and performance numbers, in Chrome on the real GPU.
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 6 -- node games/flight-sim/tests/browser-apron.mjs [name ...]
// Writes Claude outputs/flight-sim/apron-<name>.png and prints fps, draw calls, triangles.
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim', import.meta.url).pathname);
const BASE = 'http://localhost:8001/games/flight-sim/tests/dev-apron.html';
const FT = 0.3048;

export const SHOTS = {
  // Gimpo's domestic terminal (centroid -61553, 173068) from 300 ft over the apron, to the north-west.
  'gimpo-domestic-300ft': 'x=-61250&y=172700&agl=300&look=-61600,173050&parked=RKSS:5,RKSS:14',
  // In the captain's seat at gate 7, with A321s on the neighbouring gates.
  'gimpo-stand-eye': 'stand=RKSS:7&parked=RKSS:5,RKSS:14&pitch=-6',
  'gimpo-stand-eye-left': 'stand=RKSS:7&parked=RKSS:5,RKSS:14&pitch=-4&dhdg=-70',
  'gimpo-stand-eye-notrees': 'stand=RKSS:7&parked=RKSS:5,RKSS:14&pitch=-6&trees=0',
  // Taxiing in on a remote stand's lead-in: is the number readable?
  'gimpo-leadin-121': 'approach=RKSS:121&back=45&eye=5&pitch=-9&trees=0',
  'incheon-leadin-38': 'approach=RKSI:38&back=45&eye=5&pitch=-9&trees=0&parked=RKSI:37,RKSI:39',
  // Bridge alignment from outside: gate 7 with a parked A321.
  'gimpo-gate-close': 'x=-61470&y=172930&agl=60&look=-61540,172965,25&parked=RKSS:7,RKSS:5',
  'gimpo-gate-top': 'x=-61540&y=172985&agl=260&hdg=0&pitch=-89.9&parked=RKSS:7,RKSS:5,RKSS:3',
  // A hold-short on a taxiway into 14R/32L, from the taxiway at eye height.
  'gimpo-hold-14r': 'hold=RKSS:0&back=45&eye=5&ahead=20',
  'gimpo-hold-14r-above': 'hold=RKSS:0&back=25&eye=40&ahead=0',
  // Where the taxiway meets 14R/32L: the runway's paint must win over the taxiway's.
  'gimpo-junction': 'hold=RKSS:0&back=-20&eye=30&ahead=120',
  // Jeju's apron and terminal (synthetic aprons).
  'jeju-terminal': 'x=-93300&y=-276350&agl=600&look=-93600,-275900',
  // Incheon T1 and its concourse from 2,000 ft.
  'incheon-t1': 'x=-91700&y=162600&alt=2000&look=-93000,161500',
  // Gimpo overview from 3,000 ft.
  'gimpo-overview': 'x=-60300&y=171300&alt=3000&look=-62500,173300',
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
mkdirSync(OUT, { recursive: true });
mkdirSync('/tmp/flight-sim/apron', { recursive: true });
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
    const perf = await page.evaluate(async () => {
      const d = window.__dev;
      const n0 = d.frameTimes.length;
      await new Promise((r) => setTimeout(r, 2000));
      const ft = d.frameTimes.slice(n0);
      const avg = ft.reduce((a, b) => a + b, 0) / Math.max(ft.length, 1);
      return { fps: 1000 / avg, worstMs: Math.max(...ft), calls: d.info.calls, triangles: d.info.triangles, cpuMs: d.info.cpuMs,
        aprons: d.info.aprons, apronMs: d.apronMs, sites: d.aprons.sites.map((s) => ({ icao: s.icao, calls: s.drawCalls, tris: s.tris, ...s.info })) };
    });
    await page.evaluate(() => { document.getElementById('hud').style.display = 'none'; });
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${OUT}/apron-${name}.png` });
    results.push({ name, ...perf, errors });
    console.log(`${name}: ${perf.fps.toFixed(1)} fps (worst ${perf.worstMs.toFixed(1)} ms), ${perf.calls} calls, ${(perf.triangles / 1000).toFixed(0)}k tris; aprons ${perf.aprons.drawCalls} calls ${(perf.aprons.triangles / 1000).toFixed(0)}k, built in ${perf.apronMs.toFixed(0)} ms` +
      (errors.length ? `\n  ${errors.slice(0, 5).join('\n  ')}` : ''));
    await page.close();
  }
  console.log(JSON.stringify(results[0] && results[0].sites));
} finally {
  await browser.close();
}
writeFileSync('/tmp/flight-sim/apron/last-run.json', JSON.stringify(results, null, 2));
