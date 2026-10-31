// Screens check: loads tests/dev-ui.html in Chrome at 1440x900, takes the ui-*.png
// screenshots and pokes the FCU, ND and map. Run through the cpu-guard:
//   python3 tools/cpu-guard.py -- node tests/browser-ui.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';

const BASE = 'http://localhost:8001/games/flight-sim/tests/dev-ui.html';
const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim/', import.meta.url).pathname);
const only = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
let fails = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text() + (m.location()?.url || ''))) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push(r.status() + ' ' + r.url()); });
  const go = async (scene, extra = '') => {
    await page.goto(`${BASE}?scene=${scene}${extra}`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 20000 });
    await page.waitForTimeout(600);
  };
  const shot = async (name) => { await page.screenshot({ path: OUT + name }); console.log('shot ' + name); };

  for (const scene of ['runway', 'climb', 'approach']) {
    if (only && only !== scene) continue;
    await go(scene); await shot(`ui-${scene}.png`);
  }
  if (!only || only === 'fcu') {
    await go('climb');
    const alt0 = await page.evaluate(() => window.__view.ap.altFt);
    const box = await page.locator('.fsui-win[data-k="alt"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(120); }
    const alt1 = await page.evaluate(() => window.__view.ap.altFt);
    check(alt1 > alt0, `ALT scroll up: ${alt0} -> ${alt1}`);
    const h0 = await page.evaluate(() => window.__view.ap.hdgDeg);
    const hb = await page.locator('.fsui-win[data-k="hdg"]').boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.wheel(0, -100); await page.waitForTimeout(100);
    const h1 = await page.evaluate(() => window.__view.ap.hdgDeg);
    check(h1 !== h0, `HDG scroll down: ${h0} -> ${h1}`);
    await page.click('.fsui-win[data-k="vs"]'); await page.waitForTimeout(100);
    check(await page.evaluate(() => window.__view.ap.vertical) === 'V/S', 'V/S click engages V/S');
    await page.click('.fsui-btn[data-k="ap"]'); await page.waitForTimeout(100);
    check(await page.evaluate(() => window.__view.ap.ap) === false, 'AP1 click disconnects');
    await page.click('.fsui-btn[data-k="ap"]');
    check(await page.evaluate(() => window.__view.ap.ap) === true, 'AP1 click engages');
    await page.click('.fsui-law'); await page.waitForTimeout(100);
    check(await page.evaluate(() => window.__view.controls.law) === 'alternate', 'LAW toggles to alternate');
    await page.click('.fsui-nd'); await page.click('.fsui-pfd'); await page.click('.fsui-eng');
    const nb = await page.locator('.fsui-nd').boundingBox();
    await page.mouse.move(nb.x + 100, nb.y + 100); await page.mouse.wheel(0, 100);
    check(await page.evaluate(() => window.__leaks) === 0, 'clicks and wheel on the screens do not reach window');
    check(await page.evaluate(() => document.activeElement === document.body), 'focus stays on body');
    await shot('ui-fcu-after-input.png');
  }
  if (!only || only === 'map') {
    await go('map'); await page.waitForTimeout(400); await shot('ui-map.png');
    await page.evaluate(() => window.__map._devConfirm(0.35)); await page.waitForTimeout(300); await shot('ui-map-confirm.png');
    await page.click('.fsui-confirm [data-a="yes"]'); await page.waitForTimeout(100);
    check(await page.evaluate(() => document.getElementById('dev').dataset.jump !== undefined), 'Jump confirm calls onjump');
    // Drag the magenta line to add a waypoint.
    await page.evaluate(() => window.__map.open()); await page.waitForTimeout(300);
    const seg = await page.evaluate(() => {
      const v = window.__view, st = v.state, d = v.dest;
      return { ax: st.pos.x, ay: st.pos.y, bx: d.x, by: d.y };
    });
    // Drag the middle of the line sideways: a waypoint appears.
    const [mx, my] = await page.evaluate(({ ax, ay, bx, by }) => window.__map._devScreen((ax + bx) / 2, (ay + by) / 2), seg);
    await page.mouse.move(mx, my); await page.mouse.down();
    await page.mouse.move(mx + 60, my, { steps: 4 }); await page.mouse.move(mx + 140, my + 10, { steps: 4 }); await page.mouse.up();
    await page.waitForTimeout(200);
    check(await page.evaluate(() => window.__map.waypoints.length) === 1, 'dragging the line adds a waypoint');
    await shot('ui-map-waypoint.png');
    // Double-click removes it.
    await page.mouse.dblclick(mx + 140, my + 10); await page.waitForTimeout(200);
    check(await page.evaluate(() => window.__map.waypoints.length) === 0, 'double-click removes the waypoint');
    check(await page.evaluate(() => window.__leaks) === 0, 'map input does not reach window');
  }
  if (!only || only === 'live') {
    await go('live');
    for (let i = 0; i < 4; i++) await page.keyboard.press('=');
    await page.waitForFunction(() => window.__view.state.pos.z > 2500 * 0.3048 && window.__view.ap.ap, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await shot('ui-live-climbout.png');
    // Cost of a full redraw of all panels (forced), in ms.
    const ms = await page.evaluate(() => { const h = window.__hud, v = window.__view; const t0 = performance.now();
      for (let i = 0; i < 60; i++) { h.poke(); h.update({ ...v, state: { ...v.state, t: v.state.t + i } }); h.resize(); } return (performance.now() - t0) / 60; });
    console.log(`full redraw (incl. resize) ≈ ${ms.toFixed(2)} ms`);
    check(ms < 8, 'full redraw under 8 ms');
  }
  if (!only || only === 'nd10') {
    await go('runway');
    for (let i = 0; i < 2; i++) { const nb = await page.locator('.fsui-nd').boundingBox(); await page.mouse.move(nb.x + 50, nb.y + 50); await page.mouse.wheel(0, -100); await page.waitForTimeout(80); }
    await page.waitForTimeout(200); await shot('ui-nd-range10.png');
  }
  if (!only || only === 'setup') {
    await go('setup'); await shot('ui-setup.png');
    await page.click('[data-a="enough"]');
    await page.fill('[data-f="cargoKg"]', '30000'); await page.waitForTimeout(100);
    check(await page.locator('[data-a="fly"]').isDisabled(), 'over-weight disables Fly');
    await shot('ui-setup-overweight.png');
    await page.fill('[data-f="cargoKg"]', '2000'); await page.waitForTimeout(100);
    await page.click('[data-a="fly"]'); await page.waitForTimeout(100);
    const plan = await page.evaluate(() => window.__plan);
    check(plan && plan.dest === 'RKPC' && plan.fuelKg > 3000, 'Fly resolves the plan: ' + JSON.stringify(plan));
    const stored = await page.evaluate(() => localStorage.getItem('gamedump:flight-sim:settings'));
    check(stored && stored.includes('lastPlan'), 'last plan stored');
  }
  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} finally {
  await browser.close();
}
process.exit(fails ? 1 : 0);
