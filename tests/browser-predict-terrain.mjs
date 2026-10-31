// The predicted path over the real terrain in the page: airborne 30 km south of Hallasan at
// 4,000 ft heading north, AP in ALT/HDG; the worker's path must end with reason 'terrain'
// short of the mountain, its last sample clear of the ground. Screenshots the map.
//
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 4 -- node games/flight-sim/tests/browser-predict-terrain.mjs

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';

const BASE = process.env.E2E_URL || 'http://localhost:8001/games/flight-sim/';
const URL0 = BASE + '?test&origin=RKPC&dep=07&dest=RKSS&arr=14R&start=runway';
const SHOT = process.env.SHOT || decodeURIComponent(new URL('../../../Claude outputs/flight-sim/prediction-terrain-hallasan.png', import.meta.url).pathname);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(URL0);
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const res = await page.evaluate(async () => {
    const fs = window.__fs, sim = fs.sim, p = fs.predictor;
    const { toMap } = await import(new URL('src/world/frame.js', location.href).href);
    const [HX, HY] = toMap(33.3617, 126.5331);
    const x = HX, y = HY - 30000, z = 4000 * 0.3048;
    sim.reset({ x, y, z, hdg: 0, onGround: false, iasMs: 250 * 0.514444, flapLever: 0, gearDown: false, fuelKg: 8000, payloadKg: 15000,
      ap: { ap: true, athr: true, spdKt: 250, hdgDeg: Math.round(fs.gridToMagDeg(0, x, y)), altFt: 4000 } });
    sim.controls.flapLever = 0; sim.controls.gearDown = false; sim.controls.thrust = 25 / 45;
    if (fs.input) fs.input.lever = 25 / 45;
    fs.map.open();
    const got = await new Promise((resolve) => {
      const prev = p.onresult;
      const all = [];
      p.onresult = (r) => { all.push(r); prev && prev(r); };
      fs.requestPredict();
      setTimeout(() => { p.onresult = prev; resolve(all); }, 5000);
    });
    const r = got[got.length - 1];
    if (!r) return { n: 0 };
    const last = r.samples[r.samples.length - 1];
    // Ground under the last sample, from the page's own heightfield.
    const gh = fs.world.heightAt ? fs.world.heightAt(last.x, last.y) : (fs.world.hf ? fs.world.hf.heightAt(last.x, last.y) : null);
    return { results: got.map((g) => ({ reason: g.reason, n: g.samples.length, cpuMs: g.cpuMs, terrain: g.terrain })),
      reason: r.reason, terrainFlag: !!last.terrain, impact: last.impact, last: { x: last.x, y: last.y, z: last.z, t: last.t }, gh,
      kmSouth: (HY - last.y) / 1000, impactKmSouth: last.impact ? (HY - last.impact.y) / 1000 : null };
  });
  console.log(JSON.stringify(res));
  check('worker path ran over the terrain', res.results?.some((g) => g.terrain), JSON.stringify(res.results));
  check("ends with reason 'terrain' short of Hallasan", res.reason === 'terrain' && res.terrainFlag && res.impactKmSouth > 0, `last ${res.kmSouth?.toFixed(1)} km south, impact ${res.impactKmSouth?.toFixed(1)} km south`);
  check('last sample is clear of the ground', res.gh == null || res.last.z - res.gh >= 150, `z ${res.last?.z?.toFixed(0)} m, ground ${res.gh?.toFixed?.(0)} m`);
  check('within the CPU budget', res.results?.every((g) => g.cpuMs < 2000));
  // Zoom the map in on the aircraft (Centre, then the wheel at the middle of the screen).
  // Zoom the map in around the path's end (wheel events on the map, at that point).
  const zoom = await page.evaluate(async (last) => {
    const fs = window.__fs, el = document.querySelector('.fsui-map');
    const [sx, sy] = fs.map._devScreen(last.x, last.y - 12000);
    for (let i = 0; i < 8; i++) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, clientX: sx, clientY: sy, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 50));
    }
    return [sx, sy, fs.map._devScreen(last.x, last.y)];
  }, res.last);
  console.log('zoom', JSON.stringify(zoom));
  // Preview of the proposed map.js mark (not in map.js yet): a red cross at the impact,
  // drawn by this script on an overlay.
  await page.waitForTimeout(500);
  await page.evaluate((imp) => {
    const [sx, sy] = window.__fs.map._devScreen(imp.x, imp.y);
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:${sx - 9}px;top:${sy - 9}px;width:18px;height:18px;z-index:99999;pointer-events:none;
      background:linear-gradient(45deg,transparent 42%,#ff3b30 42%,#ff3b30 58%,transparent 58%),linear-gradient(-45deg,transparent 42%,#ff3b30 42%,#ff3b30 58%,transparent 58%)`;
    document.body.appendChild(d);
  }, res.impact);
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOT });
  console.log('shot', SHOT);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
