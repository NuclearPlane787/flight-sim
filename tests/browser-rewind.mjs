// Regression checks from the M1 review: rewind restores the thrust lever with the rest of the
// state (so A/THR stays engaged), and the predicted path goes away when the AP disconnects.
//
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 4 -- node games/flight-sim/tests/browser-rewind.mjs

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';

const URL0 = (process.env.E2E_URL || 'http://localhost:8001/games/flight-sim/') + '?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&view=orbit';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL0);
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 60000 });
  // 34 s of flight on final (A/THR on, lever at CL), then pull the levers to idle: A/THR drops.
  await page.waitForFunction(() => window.__fs.sim.state.t > 34, null, { timeout: 60000 });
  const before = await page.evaluate(() => { const fs = window.__fs; fs.input.lever = 0; return { lever: fs.input.lever }; });
  await page.waitForTimeout(600);
  const idle = await page.evaluate(() => ({ athr: window.__fs.ap.athr, lever: window.__fs.input.lever }));
  await page.evaluate(() => { window.__fs.setPaused(true); window.__fs.rewindNow(); });
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => { const fs = window.__fs; return { lever: fs.input.lever, thrust: fs.sim.controls.thrust, athr: fs.ap.athr, t: fs.sim.state.t }; });
  check('rewind restores the thrust lever and A/THR', Math.abs(after.lever - 25 / 45) < 1e-6 && after.athr, `idle: ${JSON.stringify(idle)} → after rewind: ${JSON.stringify(after)}`);

  // A prediction, then an AP disconnect: the path must go.
  await page.evaluate(() => { const fs = window.__fs; fs.map.open(); fs.requestPredict(); });
  await page.waitForFunction(() => window.__fs.prediction && window.__fs.prediction.length > 10, null, { timeout: 20000 });
  await page.evaluate(() => window.__fs.ap.disconnectAp('test'));
  await page.waitForTimeout(500);
  const gone = await page.evaluate(() => window.__fs.prediction);
  check('the predicted path clears when the AP disconnects', gone === null, `prediction=${gone === null ? 'null' : gone.length}`);
  // Audio stops while paused (the CPU rules): start it with a key, pause, check the context.
  // (Close the map first: with the map open, Esc closes the map instead of pausing.)
  await page.evaluate(() => window.__fs.map.close());
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(500);
  const aud0 = await page.evaluate(() => window.__fs.synth && window.__fs.synth.running);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const aud1 = await page.evaluate(() => window.__fs.synth && window.__fs.synth.running);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const aud2 = await page.evaluate(() => window.__fs.synth && window.__fs.synth.running);
  check('audio runs, stops while paused, resumes', aud0 === true && aud1 === false && aud2 === true, JSON.stringify({ running: aud0, paused: aud1, resumed: aud2 }));

  // Rewind mid-pushback: the gate flow carries on with a taxi route from where it is.
  await page.goto(URL0.replace('start=final', 'start=gate&stand=3'));
  await page.waitForFunction(() => window.__fs && window.__fs.gate && window.__fs.gate.phase === 'parked', null, { timeout: 60000 });
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__fs.sim.state.t > 36, null, { timeout: 90000 });
  const g0 = await page.evaluate(() => window.__fs.gate.phase);
  await page.evaluate(() => { window.__fs.setPaused(true); window.__fs.rewindNow(); });
  await page.waitForTimeout(800);
  const g1 = await page.evaluate(() => ({ phase: window.__fs.gate.phase, n: window.__fs.gate.points.length, status: window.__fs.gate.status, crashed: window.__fs.crashed }));
  check('rewind mid-pushback resumes the taxi route', g0 === 'pushback' && g1.phase === 'taxi' && g1.n > 1 && !g1.crashed, JSON.stringify({ before: g0, after: g1 }));
  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
