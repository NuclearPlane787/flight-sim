// The CPU-at-runtime rules (PLAN.md): nothing runs while paused or while the tab is hidden,
// the frame rate is capped at 60, and a predicted path stays within its ~2 s CPU budget.
// Counts requestAnimationFrame callbacks and reads Chrome's own task time (CDP Performance).
//
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 4 -- node games/flight-sim/tests/browser-cpu.mjs

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';

const URL0 = (process.env.E2E_URL || 'http://localhost:8001/games/flight-sim/') + '?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&view=orbit';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // Count every requestAnimationFrame callback the page runs.
  await page.addInitScript(() => {
    window.__rafCount = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => { window.__rafCount++; cb(t); });
  });
  await page.goto(URL0);
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 60000 });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const taskTime = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;
  const sample = async (ms) => {
    const a = await page.evaluate(() => ({ raf: window.__rafCount, t: window.__fs.sim.state.t }));
    const c0 = await taskTime();
    await page.waitForTimeout(ms);
    const b = await page.evaluate(() => ({ raf: window.__rafCount, t: window.__fs.sim.state.t }));
    const c1 = await taskTime();
    return { rafPerS: (b.raf - a.raf) / (ms / 1000), simS: b.t - a.t, cpuPct: ((c1 - c0) / (ms / 1000)) * 100 };
  };

  await page.waitForTimeout(2000);
  const run = await sample(3000);
  const fps = await page.evaluate(() => window.__fsStats.fps);
  check('running: sim advances, frames are capped at 60', run.simS > 2.5 && fps <= 61, `sim ${run.simS.toFixed(2)} s in 3 s, ${fps.toFixed(0)} fps rendered, ${run.rafPerS.toFixed(0)} rAF/s, main-thread CPU ${run.cpuPct.toFixed(0)}%`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const paused = await sample(3000);
  check('paused: no frames, no sim time', paused.rafPerS === 0 && paused.simS === 0, `${paused.rafPerS} rAF/s, sim ${paused.simS} s, main-thread CPU ${paused.cpuPct.toFixed(1)}%`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const resumed = await sample(1500);
  check('resumed after pause', resumed.simS > 1, `sim ${resumed.simS.toFixed(2)} s in 1.5 s`);

  // Hide the tab. Playwright puts a second page in its own window, so emulate the browser
  // hiding this one: document.hidden turns true and visibilitychange fires, as when the
  // player switches tabs.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  const hidden = await sample(3000);
  const wasHidden = await page.evaluate(() => document.hidden);
  check('hidden tab: no frames, no sim time', wasHidden && hidden.rafPerS === 0 && hidden.simS === 0, `document.hidden=${wasHidden} (emulated), ${hidden.rafPerS} rAF/s, sim ${hidden.simS} s, main-thread CPU ${hidden.cpuPct.toFixed(1)}%`);
  await page.evaluate(() => {
    delete document.hidden; delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(500);
  const pausedAfter = await page.evaluate(() => window.__fs.paused && !document.getElementById('pause').hidden);
  check('coming back shows the pause menu (the flight waits for the player)', pausedAfter === true);
  await page.keyboard.press('Escape');

  // A predicted path: one job, within its CPU budget; a newer request cancels the older.
  const pred = await page.evaluate(async () => {
    const fs = window.__fs, p = fs.predictor;
    fs.ap.setHdg(200); fs.ap.setAlt(20000); fs.ap.levelChange();
    return await new Promise((resolve) => {
      const results = [];
      const prev = p.onresult;
      p.onresult = (r) => { results.push({ n: r.samples.length, cpuMs: r.cpuMs, reason: r.reason }); prev && prev(r); };
      p.request(fs.sim.snapshot(), {});
      p.request(fs.sim.snapshot(), {}); // supersedes the first
      setTimeout(() => { p.onresult = prev; resolve(results); }, 6000);
    });
  });
  const last = pred[pred.length - 1];
  check('prediction within ~2 s CPU, superseded request dropped', pred.length === 1 && last && last.cpuMs < 2000, JSON.stringify(pred));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
