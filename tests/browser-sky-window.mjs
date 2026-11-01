// The Sky window and the setup's start time, in Chrome at 1440x900 (and 1280x720):
// tests/dev-sky-window.html (no WebGL, a real clock) for the window, then the real game for the
// setup's Time section and the window over the real HUD. Takes v020-night-skywin-*.png and checks
// the track, the jumps, play/pause, the speed, the date, Esc, and that flight keys still reach the game.
//   python3 tools/cpu-guard.py -- node tests/browser-sky-window.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';

const ROOT = (process.env.BASE || 'http://localhost:8014') + '/games/flight-sim/';
const DEV = ROOT + 'tests/dev-sky-window.html';
const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim/', import.meta.url).pathname);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
let fails = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.location()?.url || '')) errors.push(m.text() + ' ' + (m.location()?.url || '')); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push(r.status() + ' ' + r.url()); });
  const go = async (q) => {
    await page.goto(`${DEV}?${q}`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 15000 });
    await page.waitForTimeout(300);
  };
  const shot = async (name) => { await page.screenshot({ path: OUT + name }); console.log('shot ' + name); };
  const text = (o) => page.textContent(`.fssw [data-o="${o}"]`);
  const kst = () => page.evaluate(() => { const d = new Date(window.__clock.ms + 9 * 3600e3); return d.toISOString().slice(0, 16).replace('T', ' '); });
  const overlap = (a, b) => page.evaluate(([a, b]) => {
    const r = document.querySelector(a).getBoundingClientRect(), s = document.querySelector(b).getBoundingClientRect();
    return !(r.right <= s.left || s.right <= r.left || r.bottom <= s.top || s.bottom <= r.top);
  }, [a, b]);
  const inView = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });

  // ---- The shots: day, the full Moon at night, dusk ----
  await go('t=2026-11-01T13:10&run=0');
  check(await text('time') === '13:10', 'time big: ' + await text('time'));
  check(await text('date') === 'Sun 1 Nov 2026', 'date: ' + await text('date'));
  check(await text('tag') === 'Day', 'tag Day');
  check(!await overlap('.fssw', '[data-m="pfd"]') && !await overlap('.fssw', '[data-m="eng"]'), 'clear of the PFD and the engine panel at 1440x900');
  check(await inView('.fssw'), 'inside the window at 1440x900');
  await shot('v020-night-skywin-day.png');
  await go('t=2026-11-24T23:00&run=0');
  check(await text('tag') === 'Night', 'tag Night at 23:00');
  await shot('v020-night-skywin-night.png');
  await go('t=2026-11-01T17:52&run=0');
  check(['Dusk', 'Golden hour'].includes(await text('tag')), 'tag at 17:52: ' + await text('tag'));
  await shot('v020-night-skywin-dusk.png');

  // ---- The clock runs at 600x and the window follows ----
  await go('t=2026-11-01T12:00&speed=600');
  const t1 = await text('time');
  await page.waitForTimeout(1500);
  const t2 = await text('time');
  check(t1 !== t2, `the time moves at 600x (${t1} -> ${t2})`);
  check(await text('speed') === '600×', 'speed shows 600×');

  // ---- Play and pause, - and + ----
  await page.click('.fssw [data-a="play"]');
  check(await page.evaluate(() => !window.__clock.running), 'Pause stops the clock');
  check((await page.textContent('.fssw [data-a="play"]')).trim() === 'Play', 'the button says Play');
  const stopped = await page.evaluate(() => window.__clock.ms);
  await page.waitForTimeout(400);
  check(await page.evaluate((s) => window.__clock.ms === s, stopped), 'stopped means stopped');
  await page.click('.fssw [data-a="slower"]');
  check(await page.evaluate(() => window.__clock.speed) === 300 && await text('speed') === '300×', '− slows to 300×');
  for (let i = 0; i < 9; i++) await page.click('.fssw [data-a="slower"]', { force: true }).catch(() => {});
  check(await page.evaluate(() => window.__clock.speed) === 1 && await text('speed') === '1×', '− down to 1×');
  check(await page.isDisabled('.fssw [data-a="slower"]'), '− disabled at 1×');
  await page.click('.fssw [data-a="faster"]');
  check(await page.evaluate(() => window.__clock.speed) === 2, '+ to 2×');
  await page.click('.fssw [data-a="play"]');
  check(await page.evaluate(() => window.__clock.running), 'Play starts it again');
  await page.click('.fssw [data-a="play"]');

  // ---- Dragging the track sets the clock (the day stays) ----
  await go('t=2026-11-01T03:00&run=0');
  const tb = await page.$eval('.fssw-track', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
  await page.mouse.move(tb.x + tb.w * 0.25, tb.y);
  await page.mouse.down();
  check(await kst() === '2026-11-01 06:00', 'click at a quarter: 06:00 · ' + await kst());
  await page.mouse.move(tb.x + tb.w * 0.5, tb.y, { steps: 5 });
  await page.mouse.move(tb.x + tb.w * 0.75, tb.y, { steps: 5 });
  check(await kst() === '2026-11-01 18:00', 'dragged to three quarters: 18:00 · ' + await kst());
  await page.mouse.move(tb.x + tb.w * 1.3, tb.y, { steps: 3 });
  check(await kst() === '2026-11-01 23:59', 'dragged past the end: 23:59, same day · ' + await kst());
  await page.mouse.up();
  check(await text('time') === '23:59', 'the time shows the drag');

  // ---- The jumps (Seoul, 21 Dec 2026) and the date ----
  await go('t=2026-12-21T10:00&run=0');
  await page.click('.fssw [data-a="sunset"]');
  check(await kst() === '2026-12-21 17:17', 'Sunset: 17:17 · ' + await kst());
  check(await text('tSet') === '17:17', 'Sunset button says 17:17');
  await page.click('.fssw [data-a="sunrise"]');
  check(['07:42', '07:43', '07:44'].includes((await kst()).slice(11)), 'Sunrise ≈ 07:43 · ' + await kst());
  await page.click('.fssw [data-a="noon"]');
  check(/^2026-12-21 12:(2[5-9]|3[0-4])$/.test(await kst()), 'Noon (Seoul, 127 E: about 12:30) · ' + await kst());
  await page.click('.fssw [data-a="midnight"]');
  check(await kst() === '2026-12-21 00:00', 'Midnight: 00:00 · ' + await kst());
  await page.click('.fssw [data-a="dayfwd"]');
  check(await kst() === '2026-12-22 00:00' && await text('date') === 'Tue 22 Dec 2026', 'a day forward');
  await page.click('.fssw [data-a="dayback"]'); await page.click('.fssw [data-a="dayback"]');
  check(await kst() === '2026-12-20 00:00', 'two days back');
  await page.click('.fssw [data-a="today"]');
  const today = await page.evaluate(() => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10));
  check(await kst() === today + ' 00:00', 'Today keeps the time: ' + await kst());
  await page.click('.fssw [data-a="now"]');
  check(await page.evaluate(() => Math.abs(window.__clock.ms - Date.now()) < 5000), 'Now is the real time');

  // ---- Keys: flight keys reach the game; Esc closes it first; L toggles ----
  await page.click('.fssw [data-a="play"]');   // a button was just clicked: it must not hold the focus
  const running = await page.evaluate(() => window.__clock.running);
  check(await page.evaluate(() => !document.querySelector('.fssw').contains(document.activeElement)), 'buttons never take the focus');
  await page.evaluate(() => { window.__keys.length = 0; });
  for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyR', 'KeyF', 'Space']) await page.keyboard.press(k);
  const keys = await page.evaluate(() => window.__keys.slice());
  check(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyR', 'KeyF', 'Space'].every((k) => keys.includes(k)), 'W/S/A/D/R/F/Space reach the window listener while open: ' + keys.join(','));
  check(await page.evaluate((r) => window.__clock.running === r, running), 'Space did not press the last button');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' })));
  check(await page.evaluate(() => window.__keys.at(-1) === 'KeyW'), 'a W keydown on window still reaches a window listener');
  await page.evaluate(() => { window.__keys.length = 0; });
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => !window.__win.isOpen && window.__closed === 1), 'Esc closes it (onclose called)');
  check(await page.evaluate(() => !window.__keys.includes('Escape')), 'that Esc never reached the game (no pause menu)');
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => window.__keys.includes('Escape')), 'with it closed, Esc goes to the game');
  await page.keyboard.press('KeyL');
  check(await page.evaluate(() => window.__win.isOpen), 'L opens it (the lead\'s toggle)');
  await page.keyboard.press('KeyL');
  check(await page.evaluate(() => !window.__win.isOpen), 'L closes it');
  await page.click('[data-m="pfd"]').catch(() => {});

  // ---- Cheap: no redraw while the minute stays ----
  await go('t=2026-11-01T12:00&run=0');
  const cost = await page.evaluate(() => {
    const t = performance.now(); for (let i = 0; i < 200; i++) window.__win.update(); const same = performance.now() - t;
    const t2 = performance.now(); for (let i = 0; i < 50; i++) { window.__clock.set(window.__clock.ms + 60e3); window.__win.update(); } const moving = performance.now() - t2;
    return { same: same / 200, moving: moving / 50 };
  });
  check(cost.same < 0.05, `update() with nothing new: ${(cost.same * 1000).toFixed(1)} µs`);
  check(cost.moving < 4, `update() with a new minute: ${cost.moving.toFixed(2)} ms`);

  // ---- 1280x720 ----
  await page.setViewportSize({ width: 1280, height: 720 });
  await go('t=2026-11-24T23:00&run=0');
  check(await inView('.fssw'), 'inside the window at 1280x720');
  check(!await overlap('.fssw', '[data-m="pfd"]'), 'clear of the PFD at 1280x720');
  await shot('v020-night-skywin-720.png');
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---- The real game: the setup's Time, and the window over the real HUD ----
  await page.goto(ROOT);
  await page.waitForFunction(() => window.__fs && window.__fs.inMenu, null, { timeout: 90000 });
  await page.click('.fsm-nav [data-k="new"]');
  await page.waitForSelector('.fsui-setup:not([hidden])');
  check(await page.$eval('[data-seg="time"] .on', (b) => b.dataset.v) === 'now', 'Time defaults to Now');
  await page.click('[data-seg="time"] [data-v="set"]');
  check(await page.isVisible('[data-t="date"]') && await page.isVisible('[data-t="time"]'), 'Set shows the date and time fields');
  await page.fill('[data-t="date"]', '2026-11-24');
  await page.fill('[data-t="time"]', '23:00');
  await page.evaluate(() => { window.__gk = 0; window.addEventListener('keydown', () => window.__gk++); });
  await page.focus('[data-t="time"]');
  await page.keyboard.press('KeyW');
  check(await page.evaluate(() => window.__gk === 0), 'keys typed in the time fields never reach the game');
  await shot('v020-night-skywin-setup-time.png');
  const plan = await page.evaluate(async () => {
    const p = window.__fs.setup.show({}, { title: 'Test' });   // a second show replaces the dialog's plan
    document.querySelector('[data-seg="time"] [data-v="set"]').click();
    const d = document.querySelector('[data-t="date"]'), t = document.querySelector('[data-t="time"]');
    d.value = '2026-11-24'; t.value = '23:00';
    document.querySelector('.fsui-setup [data-a="fly"]').click();
    return await p;
  });
  check(plan?.time?.mode === 'set' && plan.time.ms === Date.UTC(2026, 10, 24, 14, 0), 'plan.time = { mode: set, ms: 24 Nov 23:00 KST }: ' + JSON.stringify(plan?.time));
  const plan2 = await page.evaluate(async () => {
    const p = window.__fs.setup.show({ time: { mode: 'set', ms: Date.UTC(2026, 11, 21, 8, 17) } }, { title: 'Test' });
    const vals = [document.querySelector('[data-t="date"]').value, document.querySelector('[data-t="time"]').value];
    document.querySelector('[data-seg="time"] [data-v="now"]').click();
    document.querySelector('.fsui-setup [data-a="fly"]').click();
    return { vals, plan: await p };
  });
  check(plan2.vals.join(' ') === '2026-12-21 17:17', 'defaults.time fills the fields: ' + plan2.vals.join(' '));
  check(plan2.plan?.time?.mode === 'now', 'Now gives { mode: now }');

  // a flight, then L: the window over the real HUD
  await page.goto(ROOT + '?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway');
  await page.waitForFunction(() => window.__fs && window.__fs.plan && !window.__fs.inMenu, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__fs.clock.set(Date.UTC(2026, 10, 1, 8, 40)));
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(500);
  check(await page.isVisible('.fssw'), 'L opens the window in the game');
  await page.evaluate(() => window.__fs.setPaused(true, true));
  await page.waitForTimeout(300);
  await shot('v020-night-skywin-game.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check(!await page.isVisible('.fssw'), 'Esc closes it in the game');

  // WebGL shader errors come from other jobs' world shaders (work in progress tonight), not from this window
  const shader = errors.filter((e) => /WebGLProgram|three\.core\.js/.test(e)), mine = errors.filter((e) => !shader.includes(e));
  if (shader.length) console.log(`note ${shader.length} WebGL shader error(s) in the game, not from the Sky window: ` + shader.map((e) => (e.match(/ERROR: [^\n]*/) || [e.slice(0, 80)])[0]).join(' | '));
  check(mine.length === 0, 'no console errors from the Sky window or the setup' + (mine.length ? ': ' + mine.join(' | ') : ''));
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
