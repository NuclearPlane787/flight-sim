// M2 end to end in the real game (main.js's own gate flow): a gate start at Gimpo, pushback
// with the P key, then a test-only taxi controller follows the drawn route to the holding
// point for 14R at about 15 kt. Checks: no crash, the route ends near the runway, the
// aircraft gets there. Screenshots `gate-*.png`.
//
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 15 -- node games/flight-sim/tests/browser-gate.mjs
// (a 3.3 km taxi at taxi speeds takes about 8 minutes of real time)

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const STAND = process.env.STAND || '3';
const URL0 = (process.env.E2E_URL || 'http://localhost:8001/games/flight-sim/') + `?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=gate&stand=${STAND}&view=orbit`;
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { window.addEventListener('error', (e) => { window.__lastErr = String(e.error && e.error.stack || e.message); }); });
  await page.goto(URL0);
  await page.waitForFunction(() => window.__fs && window.__fs.gate && window.__fs.gate.phase === 'parked', null, { timeout: 60000 });
  await page.evaluate(() => { window.__fs.rig.looks.orbit.pitch = 0.5; window.__fs.rig.looks.orbit.dist = 160; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'gate-1-parked.png') });
  const st = () => page.evaluate(() => { const fs = window.__fs, s = fs.sim.state; return { phase: fs.gate.phase, status: fs.gate.status, gs: s.gs, x: s.pos.x, y: s.pos.y, crashed: s.crashed || fs.crashed, t: s.t }; });

  await page.keyboard.press('KeyP');
  await page.waitForTimeout(4000);
  const mid = await st();
  check('pushback moving after P', mid.phase === 'pushback' && mid.gs > 0.5 && !mid.crashed, JSON.stringify(mid));
  await page.screenshot({ path: path.join(OUT, 'gate-2-pushback.png') });
  const t0 = Date.now();
  while ((await st()).phase === 'pushback' && Date.now() - t0 < 200000) await page.waitForTimeout(1000);
  const done = await st();
  check('pushback completes onto the taxi line', done.phase === 'taxi' && !done.crashed, JSON.stringify(done));

  // Test-only taxi controller: pure pursuit along the route at ~15 kt, slowing for turns.
  await page.evaluate(() => {
    const fs = window.__fs, KT = 1.943844;
    const pts = fs.gate.points || (fs.gate.route && fs.gate.route.points);
    window.__taxi = { i: 0, done: false, n: pts.length };
    fs.sim.controls.parkingBrake = false;
    window.__fsController = (sim) => {
      const s = sim.state, c = sim.controls, T = window.__taxi;
      // The flow hides its route once lined up near the runway; keep following the last one.
      const live = fs.gate.points;
      const P = live && live.length > 1 ? (T.pts = live) : (T.pts || pts);
      T.left = Math.round(Math.hypot(P[P.length - 1][0] - s.pos.x, P[P.length - 1][1] - s.pos.y));
      while (T.i < P.length - 1 && Math.hypot(P[T.i][0] - s.pos.x, P[T.i][1] - s.pos.y) < 35) T.i++;
      const [tx, ty] = P[T.i];
      const left = Math.hypot(P[P.length - 1][0] - s.pos.x, P[P.length - 1][1] - s.pos.y);
      if (left < 30) T.done = true;
      const want = Math.atan2(tx - s.pos.x, ty - s.pos.y);
      const err = Math.atan2(Math.sin(want - s.hdg), Math.cos(want - s.hdg));
      c.yaw = Math.max(-1, Math.min(1, err * 2.5));
      // Slow right down for sharp turns: the nosewheel skids at 10 kt with full tiller.
      const target = T.done ? 0 : Math.abs(err) > 0.6 ? 4 : Math.abs(err) > 0.25 || left < 150 ? 8 : 20; // kt
      const v = s.gs * KT;
      fs.input.lever = v < target - 2 ? 0.30 : 0;
      c.brakeL = c.brakeR = T.done ? 1 : v > target + 1 ? 0.5 : 0;
      c.pitch = 0; c.roll = 0;
    };
  });
  const t1 = Date.now();
  let last = null;
  for (;;) {
    const tp = last && last.tPrev;
    last = await page.evaluate(() => ({ ...window.__taxi, pts: undefined, gs: window.__fs.sim.state.gs * 1.943844, crashed: window.__fs.sim.state.crashed || window.__fs.crashed }));
    last.tPrev = tp;
    if (last.done || last.crashed || Date.now() - t1 > 660000) break;
    const tNow = await page.evaluate(() => window.__fs.sim.state.t);
    if (last.tPrev !== undefined && tNow === last.tPrev) {
      console.log('STALLED', JSON.stringify(await page.evaluate(() => ({ paused: window.__fs.paused, crashed: window.__fs.crashed, phase: window.__fs.gate.phase, hidden: document.hidden, err: window.__lastErr, ts: window.__fs.timeScale }))));
      break;
    }
    last.tPrev = tNow;
    if (Date.now() - t1 > 25000 && Date.now() - t1 < 27000) await page.screenshot({ path: path.join(OUT, 'gate-3-taxiing.png') });
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, 'gate-4-holding-point.png') });
  check('taxied to the holding point without crashing', last.done && !last.crashed, JSON.stringify(last));
  const end = await page.evaluate(() => { const fs = window.__fs, e = fs.runwayEnds('RKSS', '14R').end, s = fs.sim.state; return { toThresholdM: Math.hypot(s.pos.x - e.x, s.pos.y - e.y), simMin: s.t / 60, status: fs.gate.status }; });
  check('the holding point is by runway 14R', end.toThresholdM < 1500, JSON.stringify(end));
  check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
