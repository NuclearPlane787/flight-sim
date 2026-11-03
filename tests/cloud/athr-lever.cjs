// v0.2.2's autothrust lever in headless Chromium, through the real game loop: on a 15 nm final
// with the A/THR on, the thrust lever (and the engine panel's ring) sits at the thrust the
// A/THR sets; a short press of R takes it over from there (A/THR off, a toast, a small change
// of N1); X gives it back. Prints the numbers; with an outDir, a picture of the HUD.
//   node athr-lever.cjs [outDir]       (about 2 minutes with SwiftShader; FS_BASE as in stills.cjs)
// The frame clock is faked (each frame is 0.1 s of sim), as in route-views.cjs.
const { chromium } = require('playwright');
const snap = require('./snap.cjs');
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
const out = process.argv[2] || '';
if (out) require('fs').mkdirSync(out, { recursive: true });
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
(async () => {
  const viewport = { width: 1280, height: 800 };
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // The fake frame clock, which can also be held and stepped one frame at a time (for a tap
  // of exactly one frame, 0.1 s).
  await page.addInitScript(() => {
    let fake = 1000;
    window.__hold = false; window.__pending = null;
    window.requestAnimationFrame = (cb) => {
      if (window.__hold) { window.__pending = cb; return 1; }
      return setTimeout(() => { fake += 100; cb(fake); }, 0);
    };
    window.cancelAnimationFrame = (id) => clearTimeout(id);
    window.__step = () => { const cb = window.__pending; window.__pending = null; if (cb) { fake += 100; cb(fake); } };
    window.__release = () => { window.__hold = false; window.__step(); };
  });
  await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.dest, null, { timeout: 180000 });
  await page.evaluate(() => { window.__realRender = window.__fs.renderer.render.bind(window.__fs.renderer); window.__fs.renderer.render = () => {}; });
  const st = () => page.evaluate(() => {
    const f = window.__fs, s = f.sim.state, e = s.engines[0];
    return { t: s.t, athr: f.ap.athr, mode: f.ap.thrustMode, active: s.athrActive, lever: s.thrustLever, input: f.input.lever,
      leverN1: s.leverN1, n1: e.n1, n1Target: e.n1Target, ias: s.ias * 1.943844, toast: document.getElementById('toast')?.textContent || '' };
  });
  const simFor = async (sec) => { const t0 = (await st()).t; await page.waitForFunction((t) => window.__fs.sim.state.t >= t, t0 + sec, { timeout: 120000, polling: 50 }); };
  const f2 = (x) => (x === undefined ? '-' : Number(x).toFixed(2));
  const line = (k, v) => console.log(`${k}: A/THR ${v.athr} (${v.mode}${v.active === undefined ? '' : v.active ? ', moving the lever' : ''}), lever ${f2(v.lever)}, ring N1 ${f2(v.leverN1)}, N1 ${f2(v.n1)} → ${f2(v.n1Target)}, IAS ${f2(v.ias)}`);

  await simFor(20);
  const a = await st();
  line('on final', a);
  const v022 = a.active !== undefined;
  if (v022) {
    ok(a.athr && a.active && a.lever > 0.05 && a.lever < 25 / 45 - 0.02, `the A/THR has the lever (${f2(a.lever)}, below CL)`);
    ok(Math.abs(a.leverN1 - a.n1Target) < 0.01 && Math.abs(a.n1 - a.n1Target) < 3, `the ring is on the N1 it sets (${f2(a.leverN1)} / ${f2(a.n1Target)}), the needle near it (${f2(a.n1)})`);
    ok(Math.abs(a.input - a.lever) < 0.01, `the keyboard's lever follows it (a frame behind: ${f2(a.input)})`);
  }
  if (out) {
    await page.evaluate(() => { window.__fs.setPaused(true, true); window.__fs.renderer.render = window.__realRender; });
    await page.waitForTimeout(300);
    await snap(page, browser, `${out}/athr-final.png`, BASE, viewport);
    await page.evaluate(() => { window.__fs.renderer.render = () => {}; window.__fs.setPaused(false); });
    await page.waitForTimeout(300);
  }

  // A tap of R one frame (0.1 s) long: the frames are held, R goes down, one frame runs, R
  // comes up, the frames go on.
  await page.evaluate(() => { window.__hold = true; });
  await page.waitForFunction(() => window.__pending !== null, null, { timeout: 10000, polling: 20 });
  const lever0 = (await st()).lever;
  await page.keyboard.down('KeyR');
  await page.evaluate(() => window.__step());
  await page.keyboard.up('KeyR');
  await page.evaluate(() => window.__release());
  const b0 = await st();
  await simFor(8);
  const b = await st();
  line('a tap of R, 8 s on', b);
  console.log(`  the tap moved the lever ${f2(lever0)} → ${f2(b0.lever)}; N1 ${f2(a.n1)} → ${f2(b.n1)} (${(b.n1 - a.n1 >= 0 ? '+' : '') + (b.n1 - a.n1).toFixed(1)} %)`);
  if (v022) {
    ok(!b.athr && !b.active, 'the tap took the lever: A/THR off');
    ok(/A\/THR off/.test(b0.toast + b.toast), `a toast says so ("${b0.toast || b.toast}")`);
    ok(b.n1 - a.n1 > 0 && b.n1 - a.n1 < 10, `N1 changed a little: ${(b.n1 - a.n1).toFixed(1)} %`);
    ok(Math.abs(b.lever - b0.lever) < 1e-9, 'the lever stays where the tap left it');
    // X: the A/THR takes the lever again and moves it.
    await page.keyboard.press('KeyX');
    await simFor(10);
    const c = await st();
    line('X, 10 s on', c);
    ok(c.athr && c.active && Math.abs(c.lever - b.lever) > 0.01, `X gives it back: the A/THR moves the lever again (${f2(b.lever)} → ${f2(c.lever)})`);
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 5));
  ok(errors.length === 0, 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'all pass');
  await browser.close();
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
