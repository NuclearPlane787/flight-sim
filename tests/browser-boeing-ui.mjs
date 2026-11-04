// The Boeing screens' check: loads tests/dev-ui-boeing.html in Chrome at 1440x900, takes the
// v030-boeing-*.png screenshots and pokes the MCP. No WebGL.
//   FS_BASE=http://127.0.0.1:8014 python3 tools/cpu-guard.py -- node tests/browser-boeing-ui.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = (process.env.FS_BASE || 'http://127.0.0.1:8014') + '/games/flight-sim/tests/dev-ui-boeing.html';
const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim/', import.meta.url).pathname);
const CROPS = process.env.FS_CROPS || '';   // a folder for each panel's close-up (for looking, not kept)
if (CROPS) mkdirSync(CROPS, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'fs-boeing-ui-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, args: ['--window-size=1440,960'] });
let fails = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };
try {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text() + (m.location()?.url || ''))) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico') && !/reference\/raw|manifest\.json|coast/.test(r.url())) errors.push(r.status() + ' ' + r.url()); });
  const go = async (scene, extra = '') => {
    await page.goto(`${BASE}?scene=${scene}${extra}`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 20000 });
    await page.waitForTimeout(500);
  };
  const shot = async (name) => { await page.screenshot({ path: OUT + name }); console.log('shot ' + name); };
  const crops = async (name) => {
    if (!CROPS) return;
    for (const p of ['pfd', 'nd', 'eng']) await page.locator('.fsui-' + p).screenshot({ path: `${CROPS}/${name}-${p}.png` });
    await page.locator('.fsui-mcp').screenshot({ path: `${CROPS}/${name}-mcp.png` });
  };

  for (const scene of ['fl350', 'final', 'takeoff', 'stall-near', 'climb', 'stand']) {
    await go(scene);
    await shot(`v030-boeing-${scene}.png`);
    await crops(scene);
  }

  // ---- the MCP ----
  await go('fl350');
  const ap = (f) => page.evaluate(f);
  const calls = async () => page.evaluate(() => { const c = window.__view.ap._calls.map((x) => x.join(' ')); window.__view.ap._calls.length = 0; return c; });
  check(await page.locator('.fsui-fcu:not(.fsui-mcp)').isHidden(), 'the FCU is hidden on a Boeing');
  check(await page.locator('.fsui-mcp').isVisible(), 'the MCP shows');
  check((await page.locator('.fsui-mcp .fsui-win[data-k="spd"] .fsui-lab').textContent()) === 'MACH', 'the speed window says MACH at FL350');
  // This scene is in VNAV, where the window is blank: the FMC has the speed. Out of VNAV it shows.
  check((await page.locator('.fsui-mcp .fsui-win[data-k="spd"] .fsui-val').textContent()) === '', 'blank in VNAV');
  await page.evaluate(() => { window.__view.ap.vertical = 'ALT'; });
  await page.waitForTimeout(200);
  check((await page.locator('.fsui-mcp .fsui-win[data-k="spd"] .fsui-val').textContent()) === '.85', 'and out of VNAV reads .85');
  await page.evaluate((v) => { window.__view.ap.vertical = v; }, 'VNAV SPD');
  await page.waitForTimeout(200);
  check(await page.locator('.fsui-mcp .fsui-btn[data-k="lnav"].on').count() === 1, 'LNAV is lit');
  check(await page.locator('.fsui-mcp .fsui-btn[data-k="vnav"].on').count() === 1, 'VNAV is lit');
  check(await page.locator('.fsui-mcp .fsui-btn[data-k="ap"].on').count() === 1, 'A/P is lit');
  check(await page.locator('.fsui-mcp .fsui-btn[data-k="at"].on').count() === 1, 'A/T is lit');

  // Each button calls its method.
  const btn = async (k, want) => {
    await page.click(`.fsui-mcp .fsui-btn[data-k="${k}"]`);
    await page.waitForTimeout(80);   // the strip redraws with the HUD, at most 30 times a second
    const c = await calls();
    check(c.length === 1 && c[0].startsWith(want), `${k} calls ${want}: ${c.join(', ')}`);
  };
  await btn('flch', 'levelChange');
  check(await page.locator('.fsui-mcp .fsui-btn[data-k="flch"].on').count() === 1, 'FLCH lights once active');
  await btn('althold', 'altHold');
  await btn('hdgsel', 'hdgSel');
  await btn('hdghold', 'hdgHold');
  await btn('lnav', 'lnav');
  await btn('vnav', 'vnav');
  await btn('loc', 'loc');
  check(await page.locator('.fsui-mcp .fsui-btn[data-k="loc"].arm').count() === 1, 'LOC shows armed');
  await btn('app', 'app');
  check(await page.locator('.fsui-mcp .fsui-btn[data-k="app"].arm').count() === 1, 'APP shows armed');
  await btn('vs', 'setVs');
  await btn('at', 'toggleAthr');
  await btn('at', 'toggleAthr');
  await btn('ap', 'disconnectAp mcp');
  await btn('ap', 'engageAp');
  await btn('toga', 'toga');

  // Scrolling, as the FCU's.
  await go('fl350');
  const wheel = async (k, dy) => {
    const b = await page.locator(`.fsui-mcp .fsui-win[data-k="${k}"]`).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.wheel(0, dy); await page.waitForTimeout(120);
  };
  const a0 = await ap(() => window.__view.ap.altFt);
  await wheel('alt', 100);
  check(await ap(() => window.__view.ap.altFt) === a0 + 100, 'ALT scrolls 100 ft');
  const h0 = await ap(() => window.__view.ap.hdgDeg);
  await wheel('hdg', -100);
  check(await ap(() => window.__view.ap.hdgDeg) === h0 - 1, 'HDG scrolls 1°');
  await page.evaluate(() => { window.__view.ap.vertical = 'ALT'; });   // the window shows out of VNAV
  await page.waitForTimeout(200);
  await wheel('spd', 100);
  check((await page.locator('.fsui-mcp .fsui-win[data-k="spd"] .fsui-val').textContent()) === '.86', 'Mach scrolls 0.01: ' + await page.locator('.fsui-mcp .fsui-win[data-k="spd"] .fsui-val').textContent());
  await calls();

  // Typing, as the FCU's, and the pushes.
  await page.click('.fsui-mcp .fsui-win[data-k="alt"]');
  await page.keyboard.type('370'); await page.keyboard.press('Enter');
  let c = await calls();
  check(c.includes('setAlt 37000') && c.includes('levelChange'), 'typed ALT 370 is FL370 and starts FLCH: ' + c.join(', '));
  await page.click('.fsui-mcp .fsui-win[data-k="hdg"]');
  await page.keyboard.type('90'); await page.keyboard.press('Enter');
  c = await calls();
  check(c.includes('setHdg 90') && c.includes('hdgSel'), 'typed HDG pushes HDG SEL: ' + c.join(', '));
  await page.click('.fsui-mcp .fsui-win[data-k="vs"]');
  await page.keyboard.type('-15'); await page.keyboard.press('Enter');
  c = await calls();
  check(c.includes('setVs -1500'), 'typed V/S −15 is −1,500: ' + c.join(', '));
  await page.click('.fsui-mcp .fsui-win[data-k="spd"]');
  await page.keyboard.type('.84'); await page.keyboard.press('Enter');
  check((await page.locator('.fsui-mcp .fsui-win[data-k="spd"] .fsui-val').textContent()) === '.84', 'typed .84 reads .84');
  await page.click('.fsui-mcp .fsui-win[data-k="spd"]');
  await page.keyboard.type('280'); await page.keyboard.press('Enter');
  check(await ap(() => window.__view.ap.spdKt) === 280, 'typed 280 is knots');
  await calls();
  await page.click('.fsui-mcp .fsui-win[data-k="alt"]');
  await page.keyboard.type('9'); await page.keyboard.press('Escape');
  check((await calls()).length === 0, 'Esc closes it unchanged');
  await page.click('.fsui-nd'); await page.click('.fsui-pfd'); await page.click('.fsui-eng');
  check(!(await page.evaluate(() => window.__leaks)), 'clicks on the screens do not reach window');

  await go('final');
  check((await page.locator('.fsui-mcp .fsui-win[data-k="spd"] .fsui-lab').textContent()) === 'IAS', 'the speed window says IAS on final');
  check(await page.locator('.fsui-mcp .fsui-btn[data-k="app"].on').count() === 1 && await page.locator('.fsui-mcp .fsui-btn[data-k="loc"].on').count() === 0, 'APP is lit on both beams, LOC dark');

  // ---- the real sim and its autopilot (src/sim/autopilot-boeing.js), not the mock ----
  const goReal = async (r) => {
    await page.goto(`${BASE}?real=${r}`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 20000 });
    await page.waitForTimeout(700);
  };
  const finite = () => page.evaluate(() => { const s = window.__sim.state; return ['vRef', 'vmm', 'vStick', 'pliDeg', 'vmax', 'ias', 'mach'].filter((k) => !Number.isFinite(s[k])); });
  const realBtn = async (k) => { await page.click(`.fsui-mcp .fsui-btn[data-k="${k}"]`); await page.waitForTimeout(100); };
  const lit = async (k) => (await page.locator(`.fsui-mcp .fsui-btn[data-k="${k}"].on`).count()) === 1;
  const rap = () => page.evaluate(() => { const a = window.__sim.ap; return { ap: a.ap, athr: a.athr, lat: a.lateral, ver: a.vertical, thr: a.thrustMode, aL: a.armedLateral, aV: a.armedVertical, alt: a.altFt }; });
  await goReal('fl350');
  check((await finite()).length === 0, 'the real sim fills the Boeing state extras: ' + (await finite()).join());
  await realBtn('ap');
  check((await rap()).ap && await lit('ap'), 'A/P engages the real autopilot, and lights');
  await realBtn('at');
  let r = await rap();
  check(r.athr && r.thr !== '' && await lit('at'), `A/T on, mode ${r.thr}, lit`);
  await realBtn('hdghold'); check((await rap()).lat === 'HDG HOLD' && await lit('hdghold'), 'HDG HOLD');
  await realBtn('hdgsel'); check((await rap()).lat === 'HDG SEL' && await lit('hdgsel'), 'HDG SEL');
  await realBtn('althold'); check((await rap()).ver === 'ALT' && await lit('althold'), 'ALT HOLD');
  await page.click('.fsui-mcp .fsui-win[data-k="alt"]'); await page.keyboard.type('310'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  r = await rap();
  check(r.alt === 31000 && r.ver === 'FLCH SPD' && await lit('flch'), `typed ALT 310 goes to FLCH: ${r.alt} ${r.ver} ${r.thr}`);
  await realBtn('vs'); check((await rap()).ver === 'V/S' && await lit('vs'), 'V/S');
  await shot('v030-boeing-real-cruise.png'); await crops('real-cruise');
  await goReal('final');
  await page.evaluate(() => { const v = window.__view, e = v.dest; window.__sim.ap.setIls({ x: e.x, y: e.y, hdgGrid: e.hdgGridDeg * Math.PI / 180, elev: e.elevM, gsDeg: 3 }); });
  await realBtn('ap'); await realBtn('app');
  await page.waitForTimeout(600);
  r = await rap();
  check(r.ap && (r.aV === 'G/S' || r.ver === 'G/S') && await lit('app') === (r.ver === 'G/S'), `APP on the real autopilot: ${r.lat}/${r.ver}, armed ${r.aL}/${r.aV}`);
  await shot('v030-boeing-real-final.png'); await crops('real-final');
  await goReal('slow');
  check((await finite()).length === 0, 'the slow scene\'s state is finite');
  await shot('v030-boeing-real-slow.png'); await crops('real-slow');

  // ---- the swap: back to the A321's panels, and to the Boeing's again ----
  await go('fl350');
  const ndb = await page.locator('.fsui-nd').boundingBox();
  await page.mouse.click(ndb.x + 40, ndb.y + 40);    // a range other than the first
  await page.evaluate(() => window.__hud.setType(window.__typeById('a321neo'))); await page.waitForTimeout(150);
  check(await page.locator('.fsui-fcu:not(.fsui-mcp)').isVisible() && await page.locator('.fsui-mcp').isHidden(), 'setType(A321): the FCU back, the MCP gone');
  await page.evaluate(() => window.__hud.setType(window.__typeById('b787-9'))); await page.waitForTimeout(150);
  check(await page.locator('.fsui-fcu:not(.fsui-mcp)').isHidden() && await page.locator('.fsui-mcp').isVisible(), 'setType(787): the MCP again');
  // The strip stays clear of the panels and the view switch.
  const m = await page.locator('.fsui-mcp').boundingBox(), v = await page.locator('.fsui-views').boundingBox();
  check(m.x + m.width <= v.x, `the MCP (ends ${Math.round(m.x + m.width)}) clears the view switch (starts ${Math.round(v.x)})`);
  await page.setViewportSize({ width: 1100, height: 700 }); await page.waitForTimeout(300);
  const m2 = await page.locator('.fsui-mcp').boundingBox();
  check(m2.x >= 0 && m2.x + m2.width <= 1100, `at 1100 wide the MCP fits: ${Math.round(m2.x)}..${Math.round(m2.x + m2.width)}`);
  await shot('v030-boeing-narrow.png');
  await page.setViewportSize({ width: 1440, height: 900 });

  const ms = await page.evaluate(() => { const h = window.__hud, v = window.__view; const t0 = performance.now();
    for (let i = 0; i < 60; i++) { h.poke(); h.update({ ...v, state: { ...v.state, t: v.state.t + i } }); h.resize(); } return (performance.now() - t0) / 60; });
  check(ms < 8, `full redraw (incl. resize) ${ms.toFixed(2)} ms, under 8`);

  // ---- the Controls page ----
  await go('stand');
  const cp = await page.evaluate(async () => {
    const { createControlsPage } = await import('../src/ui/menu.js');
    const pg = createControlsPage(document.body); window.__cp = pg;
    const text = () => pg.el.textContent;
    const a321 = { hasTrim: /trim nose/.test(text()), flaps: /flaps 0, 1, 2, 3, FULL/.test(text()), rows: pg.el.querySelectorAll('.fsm-keys tr').length };
    pg.setFamily('boeing'); pg.open();
    return { a321, trim: /trim nose down/.test(text()), flaps: /flaps UP, 5, 15, 20, 30/.test(text()), mcp: /The MCP/.test(text()), fcuHidden: pg.el.querySelector('[data-note="fcu"]').hidden };
  });
  check(!cp.a321.hasTrim && cp.a321.flaps && cp.a321.rows === 11, 'Controls: the common page has no Boeing keys');
  check(cp.trim && cp.flaps && cp.mcp && cp.fcuHidden, 'Controls: setFamily(boeing) shows the trim, the detents and the MCP, not the FCU');
  await page.waitForTimeout(150); await shot('v030-boeing-controls.png');
  const back = await page.evaluate(() => { const pg = window.__cp; pg.setFamily('airbus'); return { trim: /trim nose/.test(pg.el.textContent), flaps: /flaps 0, 1, 2, 3, FULL/.test(pg.el.textContent), fcu: !pg.el.querySelector('[data-note="fcu"]').hidden }; });
  check(!back.trim && back.flaps && back.fcu, 'Controls: setFamily(airbus) puts it back');

  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} finally {
  await ctx.close();
}
process.exit(fails ? 1 : 0);
