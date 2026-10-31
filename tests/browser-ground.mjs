// Gate start in the real game (Chrome, real GPU): Gimpo gate, the taxi route drawn,
// mid-pushback, the end of the pushback, and the route from above. Screenshots
// `ground-*.png` in Claude outputs/flight-sim/. The gate flow is created in the page
// (main.js doesn't call it yet), with the scene and uniforms taken from window.__fs.
//
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 6 -- node games/flight-sim/tests/browser-ground.mjs [stand] [dep]

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.E2E_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.E2E_URL || 'http://localhost:8001/games/flight-sim/';
const STAND = process.argv[2] || '3', DEP = process.argv[3] || '14R';

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
const errors = [];
let ok = true;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + `?test&origin=RKSS&dep=${DEP}&dest=RKPC&arr=07&start=runway&view=orbit`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  const info = await page.evaluate(async ([stand, dep]) => {
    const fs = window.__fs;
    const { createGateFlow } = await import('./src/ground/gate-flow.js');
    const scene = fs.world.runways.group.parent;
    const gate = createGateFlow({ sim: fs.sim, airports: fs.world.airports.airports, scene, uniforms: fs.world.uniforms, heightAt: fs.world.heightAt });
    const toast = document.getElementById('toast');
    gate.onstatus = (t) => { toast.textContent = t; toast.hidden = false; };
    const r = gate.start({ origin: 'RKSS', depRunway: dep, stand, fuelKg: 7500, pax: 180, cargoKg: 2000 });
    fs.input.lever = 0;
    window.__gate = gate;
    window.__fsController = (sim, dt) => gate.update(dt, sim.controls);
    const L = fs.rig.looks.orbit; L.yaw = 2.5; L.pitch = 0.42; L.dist = 95;
    return { status: gate.status, route: r && { n: r.points.length, lengthM: Math.round(r.lengthM), text: r.text }, pb: gate.pushback.state };
  }, [STAND, DEP]);
  console.log('start:', JSON.stringify(info));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'ground-1-gimpo-gate-route.png') });

  await page.evaluate(() => window.__gate.onKey('pushback'));
  const t0 = Date.now();
  await page.waitForTimeout(24000);
  const mid = await page.evaluate(() => { const s = window.__fs.sim.state; return { phase: window.__gate.phase, pb: window.__gate.pushback.state.phase, gs: s.gs, onGround: s.onGround, crashed: s.crashed, status: window.__gate.status, stats: window.__fsStats }; });
  console.log('mid-pushback:', JSON.stringify(mid));
  await page.screenshot({ path: path.join(OUT, 'ground-2-mid-pushback.png') });

  await page.waitForFunction(() => window.__gate.phase !== 'pushback', null, { timeout: 120000 });
  const end = await page.evaluate(() => {
    const s = window.__fs.sim.state, g = window.__gate, p0 = g.route.points[0];
    return { phase: g.phase, secs: 0, status: g.status, parkingBrake: window.__fs.sim.controls.parkingBrake, crashed: s.crashed, toRouteStartM: Math.hypot(s.pos.x - p0[0], s.pos.y - p0[1]), route: { n: g.route.points.length, lengthM: Math.round(g.route.lengthM) } };
  });
  end.secs = Math.round((Date.now() - t0) / 1000);
  console.log('end of pushback:', JSON.stringify(end));
  await page.evaluate(() => { const L = window.__fs.rig.looks.orbit; L.yaw = 2.0; L.pitch = 0.5; L.dist = 110; });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'ground-3-pushback-done.png') });

  await page.evaluate(() => { const L = window.__fs.rig.looks.orbit; L.yaw = 0.6; L.pitch = 1.0; L.dist = 320; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'ground-4-route-above-near.png') });
  await page.evaluate(() => { const L = window.__fs.rig.looks.orbit; L.yaw = 0; L.pitch = 1.45; L.dist = 1500; });
  await page.waitForTimeout(2000);
  const stats = await page.evaluate(() => window.__fsStats);
  console.log('from above:', JSON.stringify(stats));
  await page.screenshot({ path: path.join(OUT, 'ground-5-route-from-above.png') });
  if (end.phase !== 'taxi' || end.crashed || mid.crashed) ok = false;
} catch (e) {
  ok = false;
  console.error('FAILED:', e);
} finally {
  await browser.close();
}
console.log('console errors:', errors.length ? errors : 'none');
console.log(ok && !errors.length ? 'PASS' : 'FAIL');
process.exit(ok && !errors.length ? 0 : 1);
