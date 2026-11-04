// The Boeings' wings bending with the lift: a 3rd-person look from ahead, on the ground and in cruise,
// with the tip lamp staying on the tip.  python3 tools/cpu-guard.py --minutes 4 -- node tests/browser-wing-flex.mjs [type]
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const type = process.argv[2] || 'b787-9';
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${d}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${BASE}?test&type=${type}&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=20000`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 90000 });
  await page.evaluate(() => { const f = window.__fs; f.clock.set(Date.UTC(2026, 9, 31, 6, 0)); f.clock.setRunning(false); document.getElementById('hud').style.visibility = 'hidden'; f.rig.viewId = 'orbit'; Object.assign(f.rig.looks.orbit, { yaw: Math.PI, pitch: 0.02, fov: 40 }); });
  await page.waitForTimeout(1500);
  const lamp = () => page.evaluate(() => { const a = window.__fs.aircraft.object.children.find((c) => c.isPoints).geometry.getAttribute('position'); return a.getY(0); });
  const y0 = await lamp();
  await page.screenshot({ path: path.join(OUT, `v030-${type}-wings-on-ground.png`) });
  await page.evaluate(() => { const f = window.__fs; f.sim.reset({ x: 0, y: 100000, z: 9000, hdg: 0, onGround: false, iasMs: 270 / 1.944, flapLever: 0, gearDown: false, fuelKg: 30000, payloadKg: 30000, ap: { ap: true, athr: true, spdKt: 270, hdgDeg: 0, altFt: 29500, vertical: 'ALT' } }); f.sim.controls.gearDown = false; f.gate.clear(); });
  await page.waitForTimeout(9000);
  const y1 = await lamp();
  await page.screenshot({ path: path.join(OUT, `v030-${type}-wings-in-flight.png`) });
  check('the tip lamp rises with the wing', y1 - y0 > 1 && y1 - y0 < 3.5, `${(y1 - y0).toFixed(2)} m`);
  check('no page errors', errs.length === 0, errs[0] || '');
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
