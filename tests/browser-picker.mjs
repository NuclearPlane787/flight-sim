// The aircraft picker in the real game: main menu → New scenario, the card with one type and with a mock
// list of three, the limits following the selection, the returned plan, the locked New flight, the fit at
// 1440×900 and 1280×720, then the type on the Load list and in the logbook.
// Needs its own server (not 8021: launchd holds that port on a Mac, for its FTP proxy):
//   python3 tests/cloud/serve.py <GameDump folder> 8121
//   python3 tools/cpu-guard.py --minutes 5 -- node tests/browser-picker.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.E2E_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.E2E_URL || 'http://127.0.0.1:8121/games/flight-sim/';
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
const errors = [];
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? ` (${extra})` : ''}`); if (!ok) fails++; };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

// The dialog and its Fly button are wholly on screen, whatever the dialog's scroll.
const fits = (page) => page.evaluate(() => {
  const d = document.querySelector('.fsui-dlg').getBoundingClientRect(), b = document.querySelector('[data-a="fly"]').getBoundingClientRect();
  const dlg = document.querySelector('.fsui-dlg');
  const onTop = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('[data-a="fly"]');
  return { h: Math.round(d.height), scroll: dlg.scrollHeight > dlg.clientHeight, fly: !!onTop && b.bottom <= innerHeight && b.top >= 0 && b.bottom <= d.bottom && b.right <= d.right };
});
const fld = (page, n) => page.$eval(`[data-f="${n}"]`, (e) => ({ value: Number(e.value), max: Number(e.max) }));
const sub = (page) => page.textContent('.fsui-dlg .sub');
const cards = (page) => page.$$eval('.fsui-tc', (els) => els.map((e) => ({ id: e.dataset.type, on: e.classList.contains('on'), tag: e.tagName, img: !!e.querySelector('img') })));

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  // A picture the lead hasn't rendered yet logs a 404: that's the case being tested, not a fault.
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE);
  await page.waitForSelector('.fsm:not([hidden])', { timeout: 90000 });
  check('the menu\'s sub-title names no single type', (await page.textContent('.fsm-sub')) === 'Airliners over South Korea');

  // ---- One type: the game as it is now ----
  await page.click('[data-k="new"]');
  await page.waitForSelector('.fsui-setup:not([hidden])');
  await page.waitForTimeout(500);
  let cs = await cards(page);
  check('the three types, the A321neo selected', cs.length === 3 && cs[0].id === 'a321neo' && cs[0].on && cs.filter((c) => c.on).length === 1 && cs.every((c) => c.img), JSON.stringify(cs));
  check('sub line', (await sub(page)) === 'A321neo · Nuclear Airlines · HL8787', await sub(page));
  check('limits are the A321\'s', (await fld(page, 'pax')).max === 244 && (await fld(page, 'cargoKg')).max === 9000 && (await fld(page, 'fuelKg')).max === 18510);   // v0.4.4: the sim's tanks
  let fit = await fits(page);
  check('1440×900: Fly on screen', fit.fly, JSON.stringify(fit));
  await shot(page, 'v030-picker-a321.png');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(200);
  fit = await fits(page);
  check('1280×720: Fly on screen', fit.fly, JSON.stringify(fit));
  // Nothing of the scrolled content shows below the footer, at either end of the scroll.
  const gapBelow = () => page.evaluate(() => Math.round(document.querySelector('.fsui-dlg').getBoundingClientRect().bottom - document.querySelector('.fsui-foot').getBoundingClientRect().bottom));
  check('1280×720: the footer reaches the dialog\'s edge', Math.abs(await gapBelow()) <= 1, await gapBelow());
  await page.$eval('.fsui-dlg', (d) => { d.scrollTop = d.scrollHeight; });
  await page.waitForTimeout(100);
  fit = await fits(page);
  check('1280×720, scrolled to the end: Fly on screen', fit.fly && Math.abs(await gapBelow()) <= 1, JSON.stringify(fit));
  const timeVisible = await page.evaluate(() => { const t = document.querySelector('[data-seg="time"]').getBoundingClientRect(), f = document.querySelector('.fsui-foot').getBoundingClientRect(); return t.bottom <= f.top; });
  check('1280×720, scrolled to the end: the last section clears the footer', timeVisible);
  await shot(page, 'v030-picker-a321-1280-end.png');
  await page.$eval('.fsui-dlg', (d) => { d.scrollTop = 0; });
  await shot(page, 'v030-picker-a321-1280.png');
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---- Three types: the mock list. Pictures: one that exists, one 404. ----
  await page.evaluate(async () => {
    const { typeById } = await import(new URL('src/sim/types.js', location.href).href);
    const a = typeById('a321neo');
    const big = (id, name, reg, kg, seats, code) => ({ ...a, id, name, maker: 'Boeing', engineName: id === 'mock789' ? 'GE GEnx-1B' : 'GE GE90-115B', registration: reg, icaoCode: code,
      limits: { OEW: kg * 0.47, MTOW: kg, MLW: kg * 0.76, MZFW: kg * 0.71, FUEL_MAX: kg * 0.4, PAX_MAX: seats, PAX_KG: 90, CARGO_MAX: 30000 },
      fuel: { climbKg: 3000, perNm: 20, holdKg: 3500, taxiKg: 500 }, defaults: { pax: Math.round(seats * 0.8), cargoKg: 8000 },
      picker: { lengthM: id === 'mock789' ? 62.8 : 73.9, spanM: id === 'mock789' ? 60.1 : 64.8, mtowT: Math.round(kg / 1000), rangeNm: 7500, seats: `up to ${seats}`,
        picture: id === 'mock789' ? 'assets/menu/gimpo-gate.jpg' : 'assets/types/does-not-exist.jpg', note: 'A mock type for this test.' } });
    window.__mock = [a, big('mock789', '787-9', 'HL7879', 254000, 420, 'E'), big('mock77w', '777-300ER', 'HL7773', 351000, 550, 'E')];
    window.__fs.setup.setTypes(window.__mock);
  });
  await page.waitForTimeout(500);
  cs = await cards(page);
  check('three cards, the A321 still selected', cs.length === 3 && cs.map((c) => c.on).join() === 'true,false,false', JSON.stringify(cs));
  check('a missing picture leaves a plain panel', !cs[2].img && cs[1].img, JSON.stringify(cs.map((c) => c.img)));
  await shot(page, 'v030-picker-three-types.png');
  fit = await fits(page);
  check('three cards, 1440×900: Fly on screen', fit.fly, JSON.stringify(fit));

  // Selecting: the limits, the sub line and the fuel follow; what fits stays.
  const fuelA = (await fld(page, 'fuelKg')).value;
  await page.click('.fsui-tc[data-type="mock789"]');
  check('selected card', (await cards(page)).map((c) => c.on).join() === 'false,true,false');
  check('sub line follows', (await sub(page)) === '787-9 · Nuclear Airlines · HL7879', await sub(page));
  check('limits follow', (await fld(page, 'pax')).max === 420 && (await fld(page, 'paxR')).max === 420 && (await fld(page, 'cargoKg')).max === 30000 && (await fld(page, 'fuelKg')).max === 101600);
  check('pax note follows', (await page.textContent('[data-o="paxNote"]')).includes('90 kg'));
  check('190 pax still fit, and stay', (await fld(page, 'pax')).value === 190);
  const fuelB = (await fld(page, 'fuelKg')).value;
  check('the "enough" fuel follows the type', fuelB > fuelA, `${fuelA} → ${fuelB}`);
  await shot(page, 'v030-picker-three-types-787.png');

  // Over the A321's limits, back to the A321: the default load and valid.
  await page.fill('[data-f="pax"]', '400');
  await page.fill('[data-f="cargoKg"]', '20000');
  await page.fill('[data-f="fuelKg"]', '60000');
  await page.dispatchEvent('[data-f="fuelKg"]', 'change');
  await page.click('.fsui-tc[data-type="a321neo"]');
  check('over-limit load goes to the default', (await fld(page, 'pax')).value === 190 && (await fld(page, 'cargoKg')).value === 1500, JSON.stringify([await fld(page, 'pax'), await fld(page, 'cargoKg')]));
  check('over-full fuel comes down', (await fld(page, 'fuelKg')).value <= 18510, (await fld(page, 'fuelKg')).value);
  check('Fly is enabled', await page.$eval('[data-a="fly"]', (b) => !b.disabled));

  // Validation uses the selected type's numbers.
  await page.click('.fsui-tc[data-type="mock77w"]');
  await page.fill('[data-f="cargoKg"]', '31000');
  check('the type\'s own hold limit is checked', (await page.textContent('[data-o="msg"]')).includes('30,000'), await page.textContent('[data-o="msg"]'));
  await page.fill('[data-f="cargoKg"]', '5000');

  // The gate: stands come through standList(airport, type), and the note counts them.
  await page.click('[data-seg="start"] button[data-v="gate"]');
  const stands = await page.$$eval('[data-f="stand"] option', (os) => os.length);
  check('the stand list is filled', stands > 0, stands);
  check('the note counts gates and remote stands', /\d+ gates, \d+ remote stands/.test(await page.textContent('[data-o="standNote"]')), await page.textContent('[data-o="standNote"]'));
  await page.click('[data-seg="start"] button[data-v="runway"]');

  // The returned plan. (Main's own New scenario waits on a show this one replaces: nothing else happens.)
  const plan = await page.evaluate(async () => {
    const p = window.__fs.setup.show({ type: 'mock77w', pax: 300, cargoKg: 5000, fuelKg: 40000 }, { title: 'Test', cancel: true });
    document.querySelector('[data-a="fly"]').click();
    return p;
  });
  check('plan.type', plan?.type === 'mock77w', JSON.stringify(plan));
  check('plan.payloadKg uses the type\'s pax weight', plan?.payloadKg === 300 * 90 + 5000, plan?.payloadKg);
  check('the last plan remembers the type', await page.evaluate(() => JSON.parse(localStorage.getItem('gamedump:flight-sim:settings')).lastPlan.type) === 'mock77w');

  // No defaults.type: the A321neo, without the last plan's load (it belonged to the 777).
  await page.evaluate(() => { window.__p = window.__fs.setup.show({}, { title: 'Test' }); });
  await page.waitForTimeout(100);
  check('no type given: the A321neo', (await cards(page)).find((c) => c.on)?.id === 'a321neo');
  check('the 777\'s load did not carry over', (await fld(page, 'pax')).value === 190 && (await fld(page, 'cargoKg')).value === 1500, JSON.stringify(await fld(page, 'pax')));

  // A scenario's New flight: its one card, no choice, the note.
  await page.evaluate(() => { window.__p = window.__fs.setup.show({ type: 'mock789', pax: 300 }, { title: 'New flight', cancel: true, lockType: true }); });
  await page.waitForTimeout(300);
  cs = await cards(page);
  check('locked: one card, not a button', cs.length === 1 && cs[0].tag === 'DIV' && cs[0].on, JSON.stringify(cs));
  check('locked: the note', (await page.textContent('[data-o="typeNote"]')) === 'A scenario keeps its aircraft. New scenario to fly another.');
  check('locked: the limits are the type\'s', (await fld(page, 'pax')).max === 420 && (await fld(page, 'pax')).value === 300);
  await shot(page, 'v030-picker-locked.png');
  const locked = await page.evaluate(() => { const r = window.__p; document.querySelector('[data-a="fly"]').click(); return r; });
  check('locked: the plan keeps the type', locked?.type === 'mock789', locked?.type);

  // ---- The rest of the game's screens ----
  // Load scenario, an old entry (no type) and a newer one.
  await page.evaluate(() => {
    window.__fs.setup.setTypes(null);
    const k = 'gamedump:flight-sim:scenarios', now = Date.now();
    localStorage.setItem(k, JSON.stringify([
      { id: 'pk1', name: 'A v0.2.2 scenario', created: now - 86400e3, savedAt: now - 86400e3, summary: { route: 'RKSS–RKPC', where: 'FL350, 120 nm to RKPC' } },
      { id: 'pk2', name: 'A long-haul scenario', created: now, savedAt: now, type: 'mock789', summary: { route: 'RKSI–RKPC', where: 'Parked at RKSI stand 112' } },
    ]));
    window.__fs.menu.show();
    window.__fs.menu.showPage('load');
  });
  await page.waitForTimeout(300);
  const rows = await page.$$eval('.fsm-row-main small', (els) => els.map((e) => e.textContent));
  check('Load list: the type next to each', rows.length === 2 && rows.some((r) => r.startsWith('A321neo · RKSS')) && rows.some((r) => r.startsWith('mock789 · RKSI')), JSON.stringify(rows));
  await shot(page, 'v030-picker-load-list.png');
  await page.evaluate(() => { window.__fs.menu.showPage('main'); window.__fs.menu.hide(); });

  // Controls: the common table as before; the Boeing section stays away until it has rows.
  await page.evaluate(() => window.__fs.controlsPage.open());
  check('Controls: the keys table, no empty family section', await page.$$eval('.fsm-controls .fsm-keys', (t) => t.length) === 1 && await page.$$eval('.fsm-controls .fsm-keys-h', (h) => h.length) === 0);
  await page.evaluate(() => window.__fs.controlsPage.close());

  // The logbook, with a type and without, and the longest name the columns must hold.
  await page.evaluate(() => {
    const score = (points, grade) => ({ points, grade, parts: [] });
    localStorage.setItem('gamedump:flight-sim:logbook', JSON.stringify([
      { date: '2026-11-01T01:00:00Z', route: 'RKSS–RKPC', depRunway: '14R', arrRunway: '07', airTimeS: 3400, fuelUsedKg: 3812, score: score(91, 'A'), scenarioId: 'pk1' },
      { date: '2026-11-02T01:00:00Z', route: 'RKSI–RKPC', depRunway: '33R', arrRunway: '25', gate: '112', airTimeS: 3900, fuelUsedKg: 12912, score: score(74, 'C'), scenarioId: 'pk2', type: 'a321neo' },
      { date: '2026-11-03T01:00:00Z', route: 'RKPC–RKSI', depRunway: '07', arrRunway: '15L', gate: '12', airTimeS: 12400, fuelUsedKg: 121912, score: score(100, 'A'), scenarioId: 'pk2', type: '777-300ER' },
    ]));
    window.__fs.logbook.open({ scenarios: [{ id: 'pk1', name: 'A v0.2.2 scenario' }, { id: 'pk2', name: 'A long-haul scenario' }] });
  });
  await page.waitForTimeout(300);
  const types = await page.$$eval('.fslb-row[data-i] .type', (els) => els.map((e) => e.textContent));
  check('logbook: each flight\'s type, A321neo without one', types.join() === '777-300ER,A321neo,A321neo', types.join());
  const over = await page.$$eval('.fslb-row[data-i] > span', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 && !e.classList.contains('route')).map((e) => e.className + ':' + e.textContent));
  check('logbook: no column overflows', !over.length, over.join());
  await shot(page, 'v030-logbook-types.png');
  await page.evaluate(() => { window.__fs.logbook.close(); localStorage.removeItem('gamedump:flight-sim:logbook'); localStorage.removeItem('gamedump:flight-sim:scenarios'); });
} catch (e) { console.error('FAILED:', e); fails++; } finally { await browser.close(); }
console.log('console errors:', errors.length ? errors : 'none');
const ok = !fails && !errors.length;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
