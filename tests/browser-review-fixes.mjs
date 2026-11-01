// Checks for the v0.2.0 reviewers' findings, in Chrome on the GPU (a fresh profile):
//   1. a crash, then New flight → Cancel: the crash panel comes back (not a frozen flight);
//   2. the Sky window's Noon while paused: the 3D view follows at once (uNight 1 → 0);
//   3. the Sky window open, then Exit to menu: the window closes, and one Esc leaves Load scenario;
//   4. a landing is saved straight away (the autosave reason 'landed');
//   5. Restart the flight keeps the clock; a rewind takes the clock back too.
// Run from GameDump's root: python3 games/flight-sim/tools/cpu-guard.py -- node games/flight-sim/tests/browser-review-fixes.mjs

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';

const URL0 = process.env.FS_URL || 'http://localhost:8014/games/flight-sim/';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const KST = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL0);
  await page.waitForFunction(() => window.__fs && window.__fs.inMenu, null, { timeout: 90000 });
  // A scenario from the menu.
  await page.click('.fsm-nav [data-k="new"]');
  await page.fill('[data-f="name"]', 'Review');
  await page.click('[data-a="fly"]');
  await page.waitForFunction(() => !window.__fs.inMenu && !window.__fs.paused, null, { timeout: 30000 });
  await page.waitForTimeout(1000);

  // 5a. Restart keeps the clock.
  const night = KST(2026, 11, 9, 23);
  await page.evaluate((ms) => { window.__fs.clock.set(ms); window.__fs.clock.setRunning(false); }, night);
  await page.keyboard.press('Escape');
  await page.click('#pause [data-act="restart"]');
  await page.waitForTimeout(500);
  const afterRestart = await page.evaluate(() => window.__fs.clock.ms);
  check('Restart the flight keeps the clock', afterRestart === night, `${new Date(afterRestart).toISOString()}`);

  // 2. The Sky window while paused: Noon shows at once.
  await page.keyboard.press('KeyL');
  await page.waitForSelector('.fssw:not([hidden])', { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => window.__fs.setPaused(true));
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => ({ night: window.__fs.world.uniforms.uNight.value, frames: window.__fs.frames }));
  await page.click('.fssw [data-a="noon"]');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ night: window.__fs.world.uniforms.uNight.value, frames: window.__fs.frames, sun: window.__fs.world.sky.state.sunAltDeg }));
  check('Noon in the Sky window while paused shows at once', before.night > 0.9 && after.night < 0.05 && after.frames > before.frames,
    `uNight ${before.night.toFixed(2)} → ${after.night.toFixed(2)}, sun ${after.sun.toFixed(1)}°, frames ${before.frames} → ${after.frames}`);

  // 3. Exit to menu closes the window; one Esc leaves Load scenario.
  await page.click('#pause [data-act="menu"]');
  await page.waitForFunction(() => window.__fs.inMenu, null, { timeout: 10000 });
  const skyOpen = await page.evaluate(() => !!document.querySelector('.fssw:not([hidden])'));
  await page.click('.fsm-nav [data-k="load"]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const loadHidden = await page.evaluate(() => document.querySelector('.fsm-load').hidden);
  check('the Sky window closes on Exit to menu, and one Esc leaves Load', !skyOpen && loadHidden, `sky open ${skyOpen}, load hidden ${loadHidden}`);

  // 1. Crash, New flight, Cancel: the crash panel comes back.
  await page.click('.fsm-nav [data-k="continue"]');
  await page.waitForFunction(() => !window.__fs.inMenu, null, { timeout: 30000 });
  await page.evaluate(() => {
    const fs = window.__fs, s = fs.sim.state;
    fs.sim.reset({ x: s.pos.x, y: s.pos.y, z: s.pos.z + 300, hdg: s.hdg, onGround: false, iasMs: 120, flapLever: 0, gearDown: false, fuelKg: 5000, payloadKg: 17000 });
    fs.sim.controls.pitch = 1; fs.input.lever = 0;
  });
  await page.evaluate(() => { const fs = window.__fs; fs.sim._core.vd = 60; });
  await page.waitForFunction(() => window.__fs.crashed, null, { timeout: 60000 });
  await page.click('#crash [data-act="setup"]');
  await page.waitForSelector('.fsui-setup:not([hidden])');
  await page.click('[data-a="cancel"]');
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({ crashPanel: !document.getElementById('crash').hidden, crashed: window.__fs.crashed, pause: !document.getElementById('pause').hidden }));
  check('a crash, then New flight → Cancel, shows the crash panel again', st.crashPanel && st.crashed && !st.pause, JSON.stringify(st));

  // 5b. Rewind takes the clock back too.
  const c0 = await page.evaluate(() => window.__fs.clock.ms);
  await page.click('#crash [data-act="rewind"]');
  await page.waitForTimeout(500);
  const c1 = await page.evaluate(() => window.__fs.clock.ms);
  check('a rewind takes the clock back', c1 <= c0, `${((c0 - c1) / 1000).toFixed(1)} s back`);

  // 4. A landing is saved at once: skip to final and land with the test controller.
  await page.evaluate(() => { const fs = window.__fs; fs.setPaused(false); fs.skipToFinal(); });
  await page.addScriptTag({ path: new URL('./e2e-controller.js', import.meta.url).pathname });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const fs = window.__fs, d = fs.dest, ax = fs.runwayAxis(d.end, d.other);
    window.__e2e.axis = { ...ax, elev: d.end.elevM ?? d.airport.elevM };
    window.__e2e.phase = 'approach';
  });
  await page.waitForFunction(() => window.__fsLastScore, null, { timeout: 400000, polling: 500 });
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => window.__fsLastSave);
  check('a landing is saved at once', saved && saved.reason === 'landed' && saved.ok, JSON.stringify(saved));
  check('no console errors', errors.length === 0, errors.slice(0, 4).join(' || '));
} catch (e) {
  console.log('FAIL exception', e.stack || e.message);
  results.push({ name: 'exception', ok: false });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
