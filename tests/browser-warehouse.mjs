// v0.5.0: the Warehouse in the real game, in Chrome (its own temporary profile), at 1440×900: the button behind
// its flag (?warehouse=1), designs made, edited, saved, reloaded, duplicated, renamed and deleted; the 3D view
// orbited and zoomed, and nothing left running after Back; the designs' cards in New scenario's picker and the
// plan carrying the design. Pictures v050-warehouse-*.png in Claude outputs/flight-sim/.
//   python3 tests/cloud/serve.py <GameDump folder> 8014 &
//   python3 tools/cpu-guard.py --minutes 10 -- node tests/browser-warehouse.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.E2E_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.E2E_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
const errors = [];
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? ` (${extra})` : ''}`); if (!ok) fails++; };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

const rows = (page) => page.$$eval('.fsw .fsm-row', (els) => els.map((e) => e.querySelector('b')?.textContent ?? ''));
const setRange = (page, sel, v) => page.$eval(sel, (e, v) => { e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, v);
const typeIn = async (page, p, text) => { await page.fill(`.fsw [data-p="${p}"]`, text); };
const viewReady = async (page) => {
  await page.waitForFunction(() => { const m = document.querySelector('.fsw [data-o="viewMsg"]'); return m && m.hidden && document.querySelector('.fsw canvas'); }, null, { timeout: 60000 });
  await page.waitForTimeout(600);
};
const badCells = (page) => page.$$eval('.fsw .fsw-eng td.bad', (e) => e.length);
const engRows = (page) => page.$$eval('.fsw .fsw-eng tbody tr', (e) => e.length);
const worst = (page) => page.$eval('.fsw', (e) => e.dataset.worst || '');
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gamedump:flight-sim:designs') || '[]'));
// requestAnimationFrame calls over `ms` (the page's own and the warehouse's), counted by a wrapper.
const rafOver = (page, ms) => page.evaluate((ms) => new Promise((res) => { const n0 = window.__raf; setTimeout(() => res(window.__raf - n0), ms); }), ms);

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    window.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) => { window.__raf++; return raf(f); };
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });

  // ---- The flag: no button without it ----
  await page.goto(BASE);
  await page.waitForSelector('.fsm:not([hidden])', { timeout: 90000 });
  // v0.5.0 ships the Warehouse (WAREHOUSE_ON): the button is on the menu without the flag.
  check('the Warehouse button is on the menu (WAREHOUSE_ON)', await page.$eval('[data-k="warehouse"]', (b) => !b.hidden));
  await page.goto(BASE + '?warehouse=1');
  await page.waitForSelector('.fsm:not([hidden])', { timeout: 90000 });
  const navOrder = await page.$$eval('.fsm-nav > :not([hidden])', (els) => els.map((e) => e.dataset.k));
  check('with it, Warehouse comes after Load scenario', navOrder.indexOf('warehouse') === navOrder.indexOf('load') + 1, navOrder.join(','));
  await page.waitForTimeout(800);
  const rafMenu = await rafOver(page, 1500);

  // ---- The list, empty; a four-engine 777 ----
  await page.click('[data-k="warehouse"]');
  await page.waitForSelector('.fsw:not([hidden])');
  check('the list starts empty', (await rows(page)).length === 0);
  await page.click('.fsw [data-new="b777-300er"]');
  await viewReady(page);
  check('a new 777 passes every check', (await worst(page)) === 'ok');
  await page.click('.fsw [data-seg="count"] button[data-v="4"]');
  await page.waitForTimeout(300);
  check('four engines in the table', (await engRows(page)) === 4);
  check('two station sliders', (await page.$$('.fsw [data-p="station"]')).length === 2);
  await setRange(page, '.fsw [data-p="thrustScale"]', 1.2);
  await setRange(page, '.fsw [data-p="fuelFrac"]', 1.3);
  await typeIn(page, 'name', 'Quad 777');
  await typeIn(page, 'registration', 'hl7004');
  await page.waitForTimeout(500);
  // Orbit and zoom: the picture changes.
  const canvas = await page.$('.fsw canvas');
  const box = await canvas.boundingBox();
  const before = await canvas.screenshot();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(300);
  const after = await canvas.screenshot();
  check('drag and scroll move the view', !before.equals(after));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 - 30, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(300);
  await canvas.dblclick();   // recentred for the picture
  await page.waitForTimeout(300);
  await page.click('.fsw [data-a="save"]');
  check('saved', /Saved/.test(await page.textContent('.fsw [data-o="msg"]')));
  let st = await stored(page);
  check('stored: 4 × GE90, thrust 1.2, HL7004', st.length === 1 && st[0].count === 4 && st[0].thrustScale === 1.2 && st[0].registration === 'HL7004' && st[0].name === 'Quad 777', JSON.stringify(st[0]));
  await shot(page, 'v050-warehouse-777-quad.png');

  // ---- A GE90 on the A321: red, then cleared with long gear ----
  await page.click('.fsw [data-a="back"]');
  await page.waitForSelector('.fsw [data-o="listPage"]:not([hidden])');
  check('Back after a save goes straight to the list', (await rows(page)).length === 1);
  check('the 3D view is gone', (await page.$$('.fsw canvas')).length === 0);
  await page.click('.fsw [data-new="a321neo"]');
  await viewReady(page);
  await page.click('.fsw [data-seg="engine"] button[data-v="ge90-115b"]');
  await viewReady(page);
  await page.waitForTimeout(400);
  check('GE90 A321: red clearance', (await badCells(page)) >= 2 && (await worst(page)) === 'bad', `${await badCells(page)} red cells`);
  await shot(page, 'v050-warehouse-a321-ge90-red.png');
  await setRange(page, '.fsw [data-p="gearExtendM"]', 1.5);
  await viewReady(page);
  await page.waitForTimeout(400);
  check('with 1.5 m of gear nothing is red', (await badCells(page)) === 0 && (await worst(page)) !== 'bad', await worst(page));
  await typeIn(page, 'name', 'GE90 A321');
  await shot(page, 'v050-warehouse-a321-ge90-gear.png');
  // Back with unsaved changes asks first.
  await page.click('.fsw [data-a="back"]');
  check('Back unsaved asks', !(await page.$eval('.fsw [data-o="ask"]', (e) => e.hidden)));
  await page.click('.fsw [data-a="keep"]');
  await page.click('.fsw [data-a="save"]');
  await page.click('.fsw [data-a="back"]');
  await page.waitForSelector('.fsw [data-o="listPage"]:not([hidden])');
  check('two designs, newest first', JSON.stringify(await rows(page)) === JSON.stringify(['GE90 A321', 'Quad 777']), JSON.stringify(await rows(page)));
  await shot(page, 'v050-warehouse-list.png');

  // ---- Back to the menu: nothing runs ----
  await page.click('.fsw [data-a="top"]');
  await page.waitForSelector('.fsw', { state: 'hidden' });
  check('the menu is back', await page.$eval('.fsm-nav', (n) => !n.hidden));
  await page.waitForTimeout(500);
  const rafAfter = await rafOver(page, 1500);
  check('no more frames requested than in the menu before', rafAfter <= rafMenu + 1, `menu ${rafMenu}, after ${rafAfter}`);
  check('no canvas left in the warehouse', (await page.$$('.fsw canvas')).length === 0);

  // ---- Reload: still there; duplicate, rename, delete ----
  await page.reload();
  await page.waitForSelector('.fsm:not([hidden])', { timeout: 90000 });
  await page.click('[data-k="warehouse"]');
  await page.waitForSelector('.fsw:not([hidden])');
  check('after a reload both are listed', (await rows(page)).length === 2, JSON.stringify(await rows(page)));
  await page.click('.fsw .fsm-row:has-text("Quad 777") [data-r="duplicate"]');
  check('duplicate: "Quad 777 (copy)" at the top', (await rows(page))[0] === 'Quad 777 (copy)', JSON.stringify(await rows(page)));
  await page.click('.fsw .fsm-row:has-text("Quad 777 (copy)") [data-r="rename"]');
  await page.fill('.fsw [data-r="name"]', 'Quad spare');
  await page.keyboard.press('Enter');
  check('renamed', (await rows(page)).includes('Quad spare'), JSON.stringify(await rows(page)));
  await page.click('.fsw .fsm-row:has-text("Quad spare") [data-r="delete"]');
  await page.click('.fsw .fsm-row.asking [data-r="yes"]');
  check('deleted', JSON.stringify(await rows(page)) === JSON.stringify(['GE90 A321', 'Quad 777']), JSON.stringify(await rows(page)));
  // Open one, check it's the one saved.
  await page.click('.fsw .fsm-row:has-text("Quad 777") .fsm-row-main');
  await viewReady(page);
  check('opened: four engines, thrust 1.2', (await engRows(page)) === 4 && (await page.$eval('.fsw [data-p="thrustScale"]', (e) => Number(e.value))) === 1.2);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.fsw [data-o="listPage"]:not([hidden])');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.fsw', { state: 'hidden' });

  // ---- New scenario's picker ----
  await page.click('[data-k="new"]');
  await page.waitForSelector('.fsui-setup:not([hidden])');
  await page.waitForTimeout(500);
  const dc = await page.$$eval('.fsui-designs button.fsui-dc', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  check('two design cards under the three types', dc.length === 2 && (await page.$$('.fsui-types button.fsui-tc')).length === 3, JSON.stringify(dc));
  check('a card says "4 × GE90-115B" and its base', dc.some((t) => t.includes('Quad 777') && t.includes('4 × GE90-115B') && t.includes('on the 777-300ER')));
  await page.click('.fsui-designs button.fsui-dc:has-text("GE90 A321")');
  await page.waitForTimeout(300);
  const sub = await page.textContent('.fsui-dlg .sub');
  const fuelMax = await page.$eval('[data-f="fuelKg"]', (e) => Number(e.max));
  const want = (await stored(page)).find((d) => d.name === 'GE90 A321');
  check('picked: the sub line names the design', /GE90 A321/.test(sub), sub);
  check('the tanks are the design\'s', fuelMax === want.fuelCapacityKg, `${fuelMax} vs ${want.fuelCapacityKg}`);
  check('only that card is on', (await page.$$('.fsui-setup .fsui-tc.on')).length === 1);
  await shot(page, 'v050-warehouse-picker.png');
  // A load that fits its smaller payload room, then Fly: the plan carries the design.
  check('the load was cut to fit the design\'s payload room', !(await page.$eval('[data-a="fly"]', (b) => b.disabled)), await page.textContent('.fsui-foot .msg'));
  await page.click('[data-a="enough"]');
  await page.waitForTimeout(200);
  check('Fly is enabled', !(await page.$eval('[data-a="fly"]', (b) => b.disabled)), await page.textContent('.fsui-foot .msg'));
  await page.click('[data-a="fly"]');
  await page.waitForTimeout(1500);
  const last = await page.evaluate(() => JSON.parse(localStorage.getItem('gamedump:flight-sim:settings') || '{}').lastPlan);
  check('plan.type is the base, plan.design the design whole', last?.type === 'a321neo' && last?.design?.id === want.id && last.design.engine === 'ge90-115b' && last.design.gearExtendM === 1.5, JSON.stringify(last?.design));
  // End to end (the run's lead, v0.5.0): the game flies the design picked, and it takes off.
  await page.waitForFunction(() => window.__fs && !window.__fs.inMenu && window.__fs.plan, null, { timeout: 60000 });
  const flying = await page.evaluate(async () => {
    const f = window.__fs, s = f.sim.state, c = f.sim.controls;
    const out = { design: f.sim.design?.name, engines: s.engines.length, gearExt: f.sim.type.geo.GEAR_EXTEND_M, start: f.plan.start, scenario: f.current?.name };
    if (f.gate.phase && f.gate.phase !== 'none' && f.plan.start === 'gate') return out;
    f.setPaused(true, true);
    c.parkingBrake = false; f.input.lever = 0.3; c.thrust = 0.3; c.spoilersArmed = true;
    for (let i = 0; i < 120 * 90 && s.onGround !== false || (s.agl < 100 && i < 120 * 90); i++) {
      if (s.ias > 145 * 0.514444) c.pitch = Math.max(-1, Math.min(1, 0.3 * ((s.onGround ? 8 : 12) - s.pitch * 57.3) - 0.05 * s.q * 57.3));
      f.sim.step(1 / 120); f.sim.events.length = 0;
      if (s.crashed) break;
    }
    return { ...out, agl: s.agl, crashed: s.crashed };
  });
  check('the game flies the design picked, and it takes off', flying.design === want.name && flying.engines === 2 && flying.gearExt === 1.5 && (flying.agl === undefined || (flying.agl > 30 && !flying.crashed)), JSON.stringify(flying));
  check('every design key under the prefix', (await page.evaluate(() => Object.keys(localStorage))).every((k) => k.startsWith('gamedump:')));

  // ---- A saved design deleted, and still gone after a reload ----
  await page.goto(BASE + '?warehouse=1');
  await page.waitForSelector('.fsm:not([hidden])', { timeout: 90000 });
  await page.click('[data-k="warehouse"]');
  await page.waitForSelector('.fsw:not([hidden])');
  await page.click('.fsw .fsm-row:has-text("Quad 777") [data-r="delete"]');
  await page.click('.fsw .fsm-row.asking [data-r="yes"]');
  await page.reload();
  await page.waitForSelector('.fsm:not([hidden])', { timeout: 90000 });
  await page.click('[data-k="warehouse"]');
  await page.waitForSelector('.fsw:not([hidden])');
  check('Quad 777 deleted, after a reload too', JSON.stringify(await rows(page)) === JSON.stringify(['GE90 A321']), JSON.stringify(await rows(page)));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  console.log('FAIL threw', err);
  fails++;
} finally {
  await browser.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
