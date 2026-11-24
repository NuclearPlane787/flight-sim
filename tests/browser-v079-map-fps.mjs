// v0.7.9: the frame time with the path map open and zoomed right in on an airport (the lead's frame-rate check: run
// alone, on mains). A gate start at Incheon (or Heathrow with FS_REGION=europe), the map opened and set to the
// aircraft's place at 2 m a pixel and at 1 m a pixel, 5 s of frames each; the same with the map closed before it.
//   [FS_REGION=europe] node tests/browser-v079-map-fps.mjs [--base <url>] [--q "&map79=0"]
// The last line printed: "done N of 3".
import { chromium } from './pw.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { standList } from '../src/ground/gate-flow.js';
import { typeById } from '../src/sim/types.js';
import { REGION } from '../src/world/regions.js';
import { tmpdir } from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const BASE = opt('--base', 'http://127.0.0.1:8014/games/flight-sim/'), Q = opt('--q', '');
const EU = process.env.FS_REGION === 'europe';
const START = EU ? { icao: 'EGLL', end: '27R' } : { icao: 'RKSI', end: '33L' };
{ // the third gate the setup offers the A321 (as browser-v079-map.mjs picks one)
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ap = JSON.parse(readFileSync(path.join(here, '..', REGION.data, `airports/${START.icao}.json`), 'utf8'));
  const gates = standList(ap, typeById('a321neo')).filter((s) => s.gate);
  START.stand = gates[Math.min(2, gates.length - 1)].ref;
}
const profile = mkdtempSync(path.join(tmpdir(), 'fs-v079-mapfps-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 },
  args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let done = 0;
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}?test${EU ? '&region=europe' : ''}&origin=${START.icao}&dep=${START.end}&dest=${START.icao}&arr=${START.end}&start=gate&stand=${encodeURIComponent(START.stand)}&view=orbit&type=a321neo${Q}`);
  await page.waitForFunction(() => window.__fs && window.__fs.gate && window.__fs.gate.phase === 'parked' && window.__fs.frames > 120, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  const measure = (name) => page.evaluate((nm) => new Promise((res) => {
    const ts = []; const t0 = performance.now();
    const tick = (t) => { ts.push(t); if (t - t0 < 5000) requestAnimationFrame(tick); else { const d = ts.slice(1).map((v, i) => v - ts[i]).sort((a, b) => a - b); res(`${nm}: ${((ts.length - 1) * 1000 / (ts[ts.length - 1] - ts[0])).toFixed(1)} fps, frame time median ${d[d.length >> 1].toFixed(1)} ms, 99th ${d[Math.floor(d.length * 0.99)].toFixed(1)} ms, worst ${d[d.length - 1].toFixed(1)} ms`); } };
    requestAnimationFrame(tick);
  }), name);
  console.log(await measure('the map closed, at the gate')); done++;
  const g = await page.evaluate(() => { const s = window.__fs.sim.state; window.__fs.map.open(); return [s.pos.x, s.pos.y]; });
  await page.waitForTimeout(4000);
  for (const mpp of [2, 1]) {
    const has = await page.evaluate(([x, y, m]) => { const M = window.__fs.map; if (!M._devView) return false; M._devView(x, y, m); return true; }, [g[0], g[1], mpp]);
    if (!has) { console.log(`the map has no _devView (the pushed v0.7.8's): open at its own zoom`); }
    await page.waitForTimeout(1500);
    console.log(await measure(`the map open at ${mpp} m a pixel on the aircraft`)); done++;
  }
  if (errors.length) console.log('ERRORS ' + errors.join(' | ').slice(0, 300));
} catch (e) { console.log(`FAILED ${String(e).slice(0, 300)}`); } finally {
  await ctx.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* the temp folder stays */ }
}
console.log(`done ${done} of 3`);
