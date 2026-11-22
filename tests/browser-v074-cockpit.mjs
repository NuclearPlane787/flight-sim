// v0.7.4, items 7 and 9 in Chrome (headless, muted): the A321's FCU with LOC, APPR and the HDG-V/S / TRK-FPA button,
// a heading typed with decimals, the PFD's FMA on an ILS (LOC, G/S) and the bird in TRK-FPA, and each type's engine
// display at full thrust with the limit's mode and N1 above the dials (the A321's TOGA 96.5).
// Pictures: "Claude outputs/flight-sim/v074-cockpit-*.png".
//   /tmp/flight-sim/v074/gk.sh br 14 cockpit/browser.txt '^done ' node games/flight-sim/tests/browser-v074-cockpit.mjs
// Env: E2E_ROOT (default http://127.0.0.1:8014/).
import { chromium } from './pw.mjs';   // (v0.7.4: Playwright with every close on a timeout; the module itself is PW or /tmp/flight-sim/pw's)
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const GAME = ROOT + 'games/flight-sim/';
const shot = (n) => path.join(OUT, `v074-cockpit-${n}.png`);
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, sleep(ms)]);

const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed'), args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  };
  const up = (page) => page.waitForFunction(() => window.__fs && window.__fs.frames !== undefined && document.getElementById('loading').hidden, null, { timeout: 90000 });
  const simWait = (page, fn, arg, timeout = 90000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });

  // ---- 1. the A321 on final to Haneda 34R: APPR, LOC and G/S ----
  {
    const page = await ctx.newPage(); watch(page);
    await page.goto(`${GAME}?test&origin=RKSS&dep=14R&dest=RJTT&arr=34R&start=final&fuel=6000`);
    await up(page);
    await simWait(page, () => window.__fs.sim.state.t > 2);
    const fcu = page.locator('.fsui-fcu:not(.fsui-mcp)');
    check('the FCU has LOC, APPR and HDG-V/S / TRK-FPA', await fcu.locator('.fsui-btn[data-k="loc"]').count() === 1 && await fcu.locator('.fsui-btn[data-k="appr"]').count() === 1 && await fcu.locator('.fsui-btn[data-k="trkfpa"]').count() === 1);
    const order = await fcu.evaluate((el) => [...el.children].map((c) => c.dataset.k).filter(Boolean).join(' '));
    check('LOC after HDG, the TRK-FPA button between HDG and ALT, APPR after V/S', /hdg loc trkfpa alt .*vs appr/.test(order), order);
    const ils = await page.evaluate(() => !!window.__fs.ap.ils);
    check('the destination has its ILS on the A321', ils);
    // The pilot's part: the gear down and landing flaps (the final start is in CONF 1, gear up), the speed VLS + 5.
    await page.evaluate(() => { const f = window.__fs; if (!f.ap.ap) f.ap.engageAp(); if (!f.ap.athr) f.ap.toggleAthr(); f.sim.controls.gearDown = true; f.sim.controls.flapLever = 3; f.sim.controls.spoilersArmed = true; f.ap.setSpd(160); });
    await fcu.locator('.fsui-btn[data-k="appr"]').click();   // armed at once: the glideslope captures from on or below it
    const armed = await page.evaluate(() => [window.__fs.ap.armedLateral, window.__fs.ap.armedVertical].join(' '));
    check('APPR arms LOC and G/S', armed === 'LOC G/S', armed);
    await sleep(400);   // the strip redraws on the next frame
    check('APPR is lit', await fcu.locator('.fsui-btn[data-k="appr"].on').count() === 1);
    await sleep(600);
    await fcu.screenshot({ path: shot('fcu-appr') });
    await simWait(page, () => window.__fs.sim.state.config === '3' && window.__fs.sim.state.gearPos > 0.99, null, 60000).catch(() => {});
    await page.evaluate(() => { const f = window.__fs; f.ap.setSpd(Math.round(f.sim.state.vls / 0.514444 + 5)); f.setTimeScale(4); });
    await simWait(page, () => window.__fs.ap.lateral === 'LOC' && window.__fs.ap.vertical === 'G/S', null, 120000).catch(() => {});
    const modes = await page.evaluate(() => `${window.__fs.ap.lateral} ${window.__fs.ap.vertical}`);
    check('LOC and G/S captured', modes === 'LOC G/S', modes);
    await page.evaluate(() => window.__fs.setTimeScale(1));
    await sleep(800);
    await page.locator('.fsui-pfd').screenshot({ path: shot('pfd-loc-gs') });
    // The autoland: LAND at 400 ft, FLARE, ROLL OUT, and the AP lets go at 30 kt.
    await page.evaluate(() => window.__fs.setTimeScale(8));
    await simWait(page, () => window.__fs.ap.vertical === 'LAND', null, 420000).catch(() => {});
    await page.evaluate(() => window.__fs.setTimeScale(1));
    await sleep(700);
    await page.locator('.fsui-pfd').screenshot({ path: shot('pfd-land') });
    // A watcher in the page notes the modes, the touchdown and where it ends; the pilot holds the brakes (Space)
    // from the touchdown, as on the aircraft (the AP steers; it has no autobrake).
    await page.evaluate(() => {
      const f = window.__fs, w = window.__v074 = { modes: [], td: null, end: null };
      const e = f.dest.end, o = f.dest.other, L = Math.hypot(o.x - e.x, o.y - e.y), ux = (o.x - e.x) / L, uy = (o.y - e.y) / L;
      const rel = () => { const p = f.sim.state.pos; return { along: Math.round((p.x - e.x) * ux + (p.y - e.y) * uy), xte: +((p.x - e.x) * uy - (p.y - e.y) * ux).toFixed(2), len: Math.round(L) }; };
      const tick = () => {
        const v = f.ap.vertical; if (!w.modes.includes(v)) w.modes.push(v);
        if (!w.td && f.sim.state.onGround) w.td = { ...rel(), fpm: Math.round(-f.sim.state.vs * 196.85) };
        w.end = { ...rel(), ap: f.ap.ap, gsKt: f.sim.state.gs / 0.514444, crashed: f.sim.state.crashed };
        if (f.ap.ap && !f.sim.state.crashed) requestAnimationFrame(tick);
      };
      tick();
    });
    await simWait(page, () => window.__v074.td || window.__v074.end?.crashed, null, 120000).catch(() => {});
    await page.mouse.click(720, 600);
    await page.keyboard.down('Space');
    await simWait(page, () => !window.__fs.ap.ap || window.__fs.sim.state.crashed, null, 120000).catch(() => {});
    await page.keyboard.up('Space');
    const w = await page.evaluate(() => window.__v074);
    const seen = { modes: w.modes, td: w.td, ...w.end };
    check('the autoland: LAND, FLARE, ROLL OUT, and the AP off at the rollout\'s end', ['LAND', 'FLARE', 'ROLL OUT'].every((m) => seen.modes.includes(m)) && !seen.ap && seen.gsKt < 35 && !seen.crashed && Math.abs(seen.td?.xte) < 1.5, JSON.stringify(seen));
    await page.evaluate(() => window.__fs.setTimeScale(1));
    await page.close();
  }

  // ---- 2. the A321 in cruise: a decimal heading typed, TRK-FPA and the bird ----
  {
    const page = await ctx.newPage(); watch(page);
    await page.goto(`${GAME}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&fuel=6000`);
    await up(page);
    await simWait(page, () => window.__fs.sim.state.t > 2);
    await page.evaluate(() => { const f = window.__fs; if (!f.ap.ap) f.ap.engageAp(); if (!f.ap.athr) f.ap.toggleAthr(); });
    const fcu = page.locator('.fsui-fcu:not(.fsui-mcp)');
    await fcu.locator('.fsui-win[data-k="hdg"]').click();
    await page.keyboard.type('071.466');
    await page.keyboard.press('Enter');
    const h = await page.evaluate(() => window.__fs.ap.hdgDeg);
    check('a typed 071.466 is set to the thousandth', h === 71.466, String(h));
    const shown = await fcu.locator('.fsui-win[data-k="hdg"] .fsui-val').textContent();
    check('the window shows the whole degree', shown === '071', shown);
    await fcu.locator('.fsui-btn[data-k="trkfpa"]').click();
    await sleep(400);
    const lab = await fcu.locator('.fsui-win[data-k="hdg"] .fsui-lab').textContent(), labV = await fcu.locator('.fsui-win[data-k="vs"] .fsui-lab').textContent();
    check('TRK-FPA: the windows read TRK and FPA', lab === 'TRK' && labV === 'FPA', `${lab} ${labV}`);
    await page.evaluate(() => window.__fs.ap.setAlt(1000));
    await fcu.locator('.fsui-win[data-k="vs"]').click();
    await page.keyboard.type('-3.0');
    await page.keyboard.press('Enter');
    const fp = await page.evaluate(() => ({ fpa: window.__fs.ap.fpaDeg, v: window.__fs.ap.vertical, trk: window.__fs.ap.trkFpa }));
    check('an FPA of −3.0 typed and flown', fp.fpa === -3 && fp.v === 'V/S' && fp.trk, JSON.stringify(fp));
    await sleep(4000);
    await fcu.screenshot({ path: shot('fcu-trk-fpa') });
    await page.locator('.fsui-pfd').screenshot({ path: shot('pfd-trk-fpa-bird') });
    // The knob: from 071.466 one step right is 072.
    await fcu.locator('.fsui-win[data-k="hdg"]').hover();
    await page.mouse.wheel(0, 100);
    const h2 = await page.evaluate(() => window.__fs.ap.hdgDeg);
    check('one notch of the knob from 071.466 is 072', h2 === 72, String(h2));
    await page.close();
  }

  // ---- 3. each type's engine display at full thrust, on the runway ----
  for (const type of ['a321neo', 'b787-9', 'b777-300er']) {
    const page = await ctx.newPage(); watch(page);
    await page.goto(`${GAME}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=8000&type=${type}`);
    await up(page);
    await simWait(page, () => window.__fs.sim.state.t > 1);
    await page.evaluate(() => { window.__fs.sim.controls.parkingBrake = true; });
    // The levers to full with R held, as a pilot does (the lever pauses at each detent on the way).
    await page.mouse.click(720, 600);
    await page.keyboard.down('r'); await sleep(4500); await page.keyboard.up('r');
    await simWait(page, () => { const e = window.__fs.sim.state.engines[0]; return Math.abs(e.n1 - window.__fs.sim.state.leverN1) < 0.05; }, null, 60000).catch(() => {});
    const r = await page.evaluate(() => ({ n1: window.__fs.sim.state.engines[0].n1, ring: window.__fs.sim.state.leverN1, idle: window.__fs.sim.state.n1Idle }));
    check(`${type}: full thrust, the needle on the ring`, Math.abs(r.n1 - r.ring) < 0.1, `N1 ${r.n1.toFixed(2)}, ring ${r.ring.toFixed(2)}`);
    if (type === 'a321neo') check('the A321 at full: 96.5', r.ring.toFixed(1) === '96.5', r.ring.toFixed(2));
    await sleep(500);
    await page.locator('.fsui-eng').screenshot({ path: shot(`eng-${type}-full`) });
    await page.close();
  }
  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await withTimeout(ctx.close(), 8000);
} catch (e) {
  console.log('FAIL exception', e?.stack || e);
  results.push(false);
}
await withTimeout(browser.close(), 8000);
console.log(`done ${results.filter(Boolean).length} of ${results.length}`);
