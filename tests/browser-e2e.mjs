// End-to-end flight in Chrome on the real GPU: Gimpo 14R → climb → AP towards Jeju →
// time compression → a path-map jump → skip to final → a hands-on landing on Jeju 07 by
// the test-only controller → the landing score. Screenshots at each phase.
//
// Run from GameDump's root, through the guard:
//   python3 games/flight-sim/tools/cpu-guard.py -- node games/flight-sim/tests/browser-e2e.mjs
// Env: E2E_URL (default http://localhost:8001/games/flight-sim/), E2E_OUT (screenshot dir).

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.E2E_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const URL0 = (process.env.E2E_URL || 'http://localhost:8001/games/flight-sim/') +
  '?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=7500';
const FT = 3.28084, KT = 1.943844, DEG = Math.PI / 180;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960', '--autoplay-policy=no-user-gesture-required'] });
let exitCode = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(URL0);
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 60000 });
  await page.addScriptTag({ content: readFileSync(path.join(here, 'e2e-controller.js'), 'utf8') });
  const st = () => page.evaluate(() => {
    const s = window.__fs.sim.state;
    return { t: s.t, x: s.pos.x, y: s.pos.y, z: s.pos.z, ias: s.ias, agl: s.agl, vs: s.vs, onGround: s.onGround,
      pitch: s.pitch, roll: s.roll, hdg: s.hdg, fuel: s.fuelKg, crashed: s.crashed, gearPos: s.gearPos,
      ap: window.__fs.ap.ap, ts: window.__fs.timeScale, n1: s.engines[0].n1 };
  });
  const waitFor = async (fn, ms, label) => {
    const t0 = Date.now();
    for (;;) {
      const s = await st();
      if (fn(s)) return s;
      if (s.crashed) throw new Error(`crashed while waiting for ${label}: ${s.crashed}`);
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}: ${JSON.stringify(s)}`);
      await page.waitForTimeout(200);
    }
  };
  const shot = (name) => page.screenshot({ path: path.join(OUT, `e2e-${name}.png`) });

  await page.waitForTimeout(1500);
  await shot('1-gimpo-14R-lineup');

  // 1. Take-off with scripted keys: thrust to TOGA with R, the controller rotates at VR.
  await page.evaluate(() => {
    const fs = window.__fs, ax = fs.runwayAxis(fs.runwayEnds('RKSS', '14R').end, fs.runwayEnds('RKSS', '14R').other);
    window.__e2e.rwyHdg = ax.hdg; window.__e2e.vr = 145; window.__e2e.phase = 'takeoff';
  });
  await page.keyboard.down('KeyR');
  await page.waitForTimeout(2700); // IDLE → CL → FLX/MCT → TOGA, pausing at each detent
  await page.keyboard.up('KeyR');
  const lever = await page.evaluate(() => window.__fs.input.lever);
  check('thrust lever at TOGA by keyboard', Math.abs(lever - 1) < 1e-6, `lever=${lever.toFixed(3)}`);
  await waitFor((s) => s.ias * KT > 100, 60000, '100 kt');
  await shot('2-takeoff-roll');
  const lift = await waitFor((s) => !s.onGround && s.agl * FT > 50, 60000, 'liftoff');
  check('lift-off', true, `t=${lift.t.toFixed(1)} s, ias ${(lift.ias * KT).toFixed(0)} kt`);
  await page.keyboard.press('KeyG');
  await waitFor((s) => s.agl * FT > 1500, 90000, '1500 ft');
  await shot('3-climb-out');
  // Thrust to CL, flaps up on schedule, then the autopilot.
  await page.evaluate(() => { window.__fs.input.lever = 25 / 45; window.__e2e.phase = 'idle'; });
  await page.keyboard.press('Digit6');
  await page.evaluate(() => {
    const fs = window.__fs, ap = fs.ap, s = fs.sim.state;
    const j = fs.runwayEnds('RKPC', '07').end;
    const brg = Math.atan2(j.x - s.pos.x, j.y - s.pos.y); // grid
    window.__e2e.brg = brg;
    ap.setSpd(250); ap.setAlt(24000);
    if (!ap.athr) ap.toggleAthr();
    ap.engageAp();
    ap.setHdg(Math.round(fs.gridToMagDeg(brg, s.pos.x, s.pos.y)) % 360 || 360);
    ap.levelChange();
  });
  // 2. The autopilot holds: AP on, climbing on the heading.
  const apOn = await waitFor((s) => s.ap && s.agl * FT > 3500, 120000, 'AP climb through 3500 ft');
  check('autopilot engaged and climbing', apOn.ap, `alt ${(apOn.z * FT).toFixed(0)} ft`);
  await shot('4-ap-climb');

  // 3. Time compression, then the map and a jump.
  const ts = await page.evaluate(() => window.__fs.setTimeScale(8));
  check('time compression 8x accepted', ts === 8, `rate=${ts}`);
  const before = await st();
  await page.waitForTimeout(5000);
  const after = await st();
  const simRate = (after.t - before.t) / 5;
  check('sim ran faster than real time', simRate > 4, `${simRate.toFixed(1)}x over 5 s real`);
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__fs.prediction && window.__fs.prediction.length > 20, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await shot('5-map-predicted-path');
  const jump = await page.evaluate(() => {
    const fs = window.__fs, p = fs.prediction, j = fs.runwayEnds('RKPC', '07').end;
    // The sample about 60 nm from Jeju (or the closest one).
    let best = p[0], bd = Infinity;
    for (const q of p) { const d = Math.abs(Math.hypot(q.x - j.x, q.y - j.y) - 60 * 1852); if (d < bd) { bd = d; best = q; } }
    fs.jumpTo(best);
    return { x: best.x, y: best.y, z: best.z, t: best.t, n: p.length };
  });
  await page.waitForTimeout(1200);
  // The sim keeps flying after the jump, so take back the motion since the sample's time.
  const aj = await page.evaluate(() => { const s = window.__fs.sim.state; return { t: s.t, x: s.pos.x, y: s.pos.y, z: s.pos.z, vx: s.vel.x, vy: s.vel.y, vz: s.vel.z }; });
  const dtj = aj.t - jump.t;
  const miss = Math.hypot(aj.x - aj.vx * dtj - jump.x, aj.y - aj.vy * dtj - jump.y);
  const missZ = Math.abs(aj.z - aj.vz * dtj - jump.z);
  check('jump lands on the predicted path', dtj >= 0 && dtj < 5 && miss < 5 && missZ < 2, `miss ${miss.toFixed(2)} m horizontal, ${missZ.toFixed(2)} m vertical, after taking back ${dtj.toFixed(2)} s of flight; ${jump.n} samples`);
  await page.keyboard.press('KeyM');
  await shot('6-after-jump');

  // 4. Skip to final at Jeju.
  await page.evaluate(() => { window.__fs.setTimeScale(1); window.__fs.skipToFinal(); });
  await page.waitForTimeout(1500);
  const fin = await st();
  check('skip to final placed the aircraft', fin.ap && Math.abs(fin.ias * KT - 180) < 15, `alt ${(fin.z * FT).toFixed(0)} ft, ${(fin.ias * KT).toFixed(0)} kt`);
  await shot('7-jeju-15nm-final');

  // 5. Land with the test-only controller.
  await page.evaluate(() => {
    const fs = window.__fs, d = fs.dest, ax = fs.runwayAxis(d.end, d.other);
    window.__e2e.axis = { ...ax, elev: d.end.elevM ?? d.airport.elevM };
    window.__e2e.phase = 'approach';
  });
  await waitFor((s) => s.agl * FT < 1000, 400000, '1000 ft on final');
  await shot('8-jeju-short-final');
  await waitFor((s) => s.onGround, 200000, 'touchdown');
  await shot('9-jeju-touchdown');
  await page.waitForFunction(() => window.__fsLastScore, null, { timeout: 120000 });
  const score = await page.evaluate(() => window.__fsLastScore);
  await page.waitForTimeout(500);
  await shot('10-landing-score');
  const final = await st();
  check('landing score came out', !!score && !!score.grade, score ? `${score.grade} ${score.points}: ` + score.parts.map((p) => `${p.name} ${p.value}${p.unit}`).join(', ') : '');
  check('not crashed', !final.crashed && !(await page.evaluate(() => window.__fs.crashed)), final.crashed || '');
  // M2: after landing, a taxi route to a free stand.
  await page.waitForTimeout(1500);
  const taxiIn = await page.evaluate(() => { const g = window.__fs.gate; return { phase: g.phase, n: g.points.length, status: g.status, stand: g.stand && g.stand.ref }; });
  check('taxi-in route to a free stand after landing', taxiIn.phase === 'taxi-in' && taxiIn.n > 1, JSON.stringify(taxiIn));
  await shot('11-taxi-in-route');
  const calls = await page.evaluate(() => window.__fs.callouts.heard.slice());
  check('callouts heard (incl. retard)', calls.includes('retard') && calls.includes('one hundred'), calls.join(', '));
  console.log('controller log:', (await page.evaluate(() => window.__e2eLog)).join(' | '));
  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));
} catch (e) {
  console.log('FAIL exception', e.message);
  results.push({ name: 'exception', ok: false, detail: e.message });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : exitCode);
