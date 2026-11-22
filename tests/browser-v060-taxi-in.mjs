// v0.6.0: after a landing at a region airport the game offers a taxi-in route (gate-flow.js
// afterLanding) from runways whose taxiways the map doesn't join to the centreline. In the page:
// the aircraft is put on the runway at 55 % of its length, rolling at 20 kt, and the game's own
// gate flow is asked for the route; the route must exist, start ahead and name a stand, and its
// line is drawn. A functional check (no frame rates). Headless, muted.
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 4 -- node games/flight-sim/tests/browser-v060-taxi-in.mjs [ICAO:RWY ...]
import { chromium } from './pw.mjs';   // (v0.7.4: Playwright with every close on a timeout; the module itself is PW or /tmp/flight-sim/pw's)
const BASE = process.env.E2E_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim/', import.meta.url).pathname);
const args = process.argv.slice(2).filter((a) => /^[A-Z]{4}:/.test(a));
const LIST = (args.length ? args : ['ZSQD:34', 'RJBB:24R', 'RJAA:16R', 'ZSSS:18R']).map((a) => a.split(':'));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
let bad = 0;
const check = (name, ok, note = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${note}`); if (!ok) bad++; };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const [icao, rwy] of LIST) {
    await page.goto(`${BASE}?test&eastasia=1&origin=${icao}&dep=${rwy}&dest=${icao}&arr=${rwy}&start=runway&view=orbit${process.env.E2E_EXTRA || ''}`);
    await page.waitForFunction(() => window.__fs && window.__fs.frames > 30 && window.__fs.sim.state.onGround, null, { timeout: 60000 });
    const r = await page.evaluate(async () => {
      const f = window.__fs, d = f.dest, ax = f.runwayAxis(d.end, d.other);
      const L = Math.hypot(d.other.x - d.end.x, d.other.y - d.end.y);
      const x = d.end.x + ax.ux * L * 0.55, y = d.end.y + ax.uy * L * 0.55;
      await f.world.heightfield.tiles.whenReady(x, y, 3000, 'aircraft');
      f.sim.reset({ x, y, hdg: ax.hdg, onGround: true, iasMs: 10, flapLever: 4, gearDown: true });
      f.gate.clear();
      const out = f.gate.afterLanding(f.sim.state);
      if (!out) return null;
      const ahead = (out.points[1][0] - x) * ax.ux + (out.points[1][1] - y) * ax.uy;
      return { text: out.text, stand: out.stand, lengthM: out.lengthM, ahead, n: out.points.length, phase: f.gate.phase };
    });
    check(`${icao} ${rwy}: a taxi-in route after landing`, !!r && r.phase === 'taxi-in' && r.ahead > -15 && !!r.stand, r ? `${r.text} (${r.lengthM.toFixed(0)} m, the exit ${r.ahead.toFixed(0)} m ahead)` : 'none');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}${process.env.E2E_PREFIX || 'v060'}-taxi-in-${icao.toLowerCase()}-${rwy.toLowerCase()}.png` });
  }
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
