// v0.7.4, Shane's item 12 in the page: the left panel's SILENCE button on all three types (unlit, then lit after a
// press while the AP disconnect's cavalry charge sounds; its key ' too), the Settings page's volumes under the master
// (each bus's gain follows its slider; saved and restored with the settings; an older settings object without them
// reads as 100 %). Headless runs are muted (navigator.webdriver): the checks read the graph (synth.levels()).
//
//   node games/flight-sim/tests/browser-v074-sound.mjs [--headed]      (E2E_ROOT: http://127.0.0.1:8014/)
// Pictures: Claude outputs/flight-sim/v074-sound-<type>-unlit.png, -lit.png (the PFD), v074-sound-settings.png.
// Last line: "sound N of M passed".

import { chromium } from './pw.mjs';   // (v0.7.4: Playwright with every close on a timeout; the module itself is PW or /tmp/flight-sim/pw's)
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const GAME = ROOT + 'games/flight-sim/';
const shot = (n) => path.join(OUT, `v074-sound-${n}.png`);
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const closeIn = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed'), args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  };
  const up = (page, timeout = 90000) => page.waitForFunction(() => window.__fs && window.__fs.frames !== undefined && document.getElementById('loading').hidden, null, { timeout });

  // ---- 1. the button on each type ----
  for (const type of ['a321neo', 'b787-9', 'b777-300er']) {
    const page = await ctx.newPage(); watch(page);
    await page.goto(`${GAME}?test&origin=RKSS&dep=14R&dest=RJTT&arr=34L&start=final&type=${type}`);
    await up(page);
    await page.waitForFunction(() => window.__fs.sim.state.t > 2, null, { timeout: 60000 });
    await page.mouse.click(720, 600);   // a user gesture: the sound starts
    await page.waitForFunction(() => window.__fs.synth?.running, null, { timeout: 10000 });
    const pfd = page.locator('.fsui-pfd');
    const btn = page.locator('.fsui-pfd .fsui-silence');
    check(`${type}: the button is on the left panel`, await btn.isVisible(), await btn.textContent());
    // The button inside the PFD's box, in its bottom right corner.
    const [pb, bb] = [await pfd.boundingBox(), await btn.boundingBox()];
    check(`${type}: in the PFD's bottom right corner`, bb.x > pb.x + pb.width * 0.7 && bb.y > pb.y + pb.height * 0.88 && bb.x + bb.width <= pb.x + pb.width && bb.y + bb.height <= pb.y + pb.height,
      `PFD ${pb.width.toFixed(0)}×${pb.height.toFixed(0)}, button ${bb.width.toFixed(0)}×${bb.height.toFixed(0)} at ${(bb.x - pb.x).toFixed(0)},${(bb.y - pb.y).toFixed(0)}`);
    // A clean picture: the flight paused, unlit.
    await page.evaluate(() => window.__fs.setPaused(true));
    await page.waitForTimeout(400);
    check(`${type}: unlit with nothing silenced`, !(await btn.evaluate((b) => b.classList.contains('on'))));
    await pfd.screenshot({ path: shot(`${type}-unlit`) });
    // The AP engaged, then disconnected: the cavalry charge sounds; the button (clicked) silences it.
    await page.evaluate(() => { window.__fs.setPaused(false); window.__fs.ap.engageAp(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__fs.ap.disconnectAp('pilot'));
    await page.waitForFunction(() => window.__fs.synth.sounding.apDisc, null, { timeout: 5000 });
    const warn = await page.evaluate(() => ({ ...window.__fs.sim.state.warnings }));
    if (type === 'a321neo') await btn.click(); else await page.keyboard.press('Quote');   // the button, and its key
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => ({ silenced: window.__fs.synth.silenced, apDisc: window.__fs.synth.sounding.apDisc, warn: window.__fs.sim.state.warnings.apDisc }));
    check(`${type}: ${type === 'a321neo' ? 'clicked' : 'its key (\')'}: the charge silenced, the sim's warning (the screens' and lights') still on`,
      warn.apDisc && after.silenced && !after.apDisc && after.warn, JSON.stringify(after));
    await page.evaluate(() => window.__fs.setPaused(true));
    await page.waitForTimeout(300);
    check(`${type}: lit while something is silenced`, await btn.evaluate((b) => b.classList.contains('on')));
    await pfd.screenshot({ path: shot(`${type}-lit`) });
    // The warning ends (3 s): unlit; the next disconnect sounds again.
    await page.evaluate(() => window.__fs.setPaused(false));
    await page.waitForFunction(() => !window.__fs.sim.state.warnings.apDisc, null, { timeout: 10000 });
    await page.waitForTimeout(200);
    const lit = await btn.evaluate((b) => b.classList.contains('on'));
    await page.evaluate(() => { window.__fs.ap.engageAp(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__fs.ap.disconnectAp('pilot'));
    const again = await page.waitForFunction(() => window.__fs.synth.sounding.apDisc, null, { timeout: 5000 }).then(() => true, () => false);
    check(`${type}: unlit when the warning ends; the next disconnect sounds again`, !lit && again);
    await closeIn(page.close(), 5000);
  }

  // ---- 2. the volumes ----
  {
    const page = await ctx.newPage(); watch(page);
    // An older settings object (v0.7.3's fields only): every new volume reads as 100 %.
    await page.goto(GAME);
    await page.evaluate(() => localStorage.setItem('gamedump:flight-sim:settings', JSON.stringify({ volume: 0.8, muted: false, panelScale: 1 })));
    await page.reload();
    await up(page);
    const old = await page.evaluate(() => ({ mix: window.__fs.mix, synth: window.__fs.synth.volumes, level: window.__fs.callouts.level, vol: window.__fs.callouts.volume }));
    check('an older settings object: every new volume 100 %, the master as saved', Object.values(old.mix).every((v) => v === 1) && Object.values(old.synth).every((v) => v === 1) && old.level === 1 && old.vol === 0.8, JSON.stringify(old));
    // Settings: the four sliders under the master.
    await page.evaluate(() => window.__fs.settingsPage.open());
    await page.waitForTimeout(300);
    const labels = await page.$$eval('.fsm-settings .fsm-set-sub .lab', (ls) => ls.map((l) => l.childNodes[0].textContent.trim()));
    check('Settings: Warnings, Callouts, Engines, Airframe and ground, under the master', JSON.stringify(labels) === JSON.stringify(['Warnings', 'Callouts volume', 'Engines', 'Airframe and ground']), labels.join(', '));
    const set = (k, v) => page.$eval(`[data-s="mix-${k}"]`, (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await set('warnings', 40); await set('callouts', 70); await set('engines', 25); await set('frame', 55);
    await page.waitForTimeout(900);
    await page.locator('.fsm-settings').screenshot({ path: shot('settings') });
    await page.evaluate(() => window.__fs.synth.start());   // the graph is built (its context may stay suspended: no gesture)
    const lv = await page.evaluate(() => ({ L: window.__fs.synth.levels(), level: window.__fs.callouts.level, stored: JSON.parse(localStorage.getItem('gamedump:flight-sim:settings')) }));
    const near = (x, v) => Math.abs(x - v) < 1e-6;   // a gain built at a value holds it as a 32-bit float
    check('each bus\'s gain follows its slider', near(lv.L.engines, 0.25) && near(lv.L.frame, 0.55) && lv.level === 0.7, JSON.stringify(lv.L));
    check('saved with the settings', lv.stored.volWarnings === 0.4 && lv.stored.volCallouts === 0.7 && lv.stored.volEngines === 0.25 && lv.stored.volFrame === 0.55 && lv.stored.volume === 0.8, JSON.stringify(lv.stored));
    await page.reload();
    await up(page);
    const back = await page.evaluate(() => { window.__fs.settingsPage.open(); return { mix: window.__fs.mix, synth: window.__fs.synth.volumes, level: window.__fs.callouts.level,
      shown: ['warnings', 'callouts', 'engines', 'frame'].map((k) => document.querySelector(`[data-s="mixOut-${k}"]`).textContent) }; });
    check('restored after a reload (and shown on the page)', back.mix.warnings === 0.4 && back.synth.engines === 0.25 && back.synth.frame === 0.55 && back.synth.warnings === 0.4 && back.level === 0.7 && back.shown.join() === '40%,70%,25%,55%', JSON.stringify(back));
    // The warnings' bus in flight follows its volume (×0.4).
    await page.goto(`${GAME}?test&origin=RKSS&dep=14R&dest=RJTT&arr=34L&start=final`);
    await up(page);
    await page.mouse.click(720, 600);
    await page.waitForFunction(() => window.__fs.synth?.running && window.__fs.sim.state.t > 1, null, { timeout: 30000 });
    await page.waitForTimeout(300);
    const fl = await page.evaluate(() => window.__fs.synth.levels());
    check('in flight: warnings 0.4, engines 0.25, airframe 0.55', near(fl.warnings, 0.4) && near(fl.engines, 0.25) && near(fl.frame, 0.55), JSON.stringify(fl));
    // Back to the defaults for whoever uses this profile next (a fresh context each run anyway).
    await page.evaluate(() => localStorage.removeItem('gamedump:flight-sim:settings'));
    await closeIn(page.close(), 5000);
  }
  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  await closeIn(ctx.close(), 5000);
} finally {
  await closeIn(browser.close(), 8000);
}
console.log(`sound ${results.filter(Boolean).length} of ${results.length} passed`);
