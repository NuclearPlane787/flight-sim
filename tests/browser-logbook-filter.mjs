// v0.2.0's logbook by scenario: loads tests/dev-logbook.html in Chrome at 1440x900, checks the
// main menu's filter, the pause menu's scoped view, "Clear these flights" and the keys, and takes
// v020-logbook-dev-all.png, -filtered.png and -pause-scoped.png.
//   python3 tools/cpu-guard.py -- node tests/browser-logbook-filter.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';

const BASE = (process.env.FLIGHT_SIM_BASE || 'http://localhost:8014/games/flight-sim/') + 'tests/dev-logbook.html';
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
  const go = async (scene) => {
    await page.goto(`${BASE}?scene=${scene}`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 10000 });
    await page.waitForTimeout(300);
  };
  const shot = async (name) => { await page.screenshot({ path: OUT + name }); console.log('shot ' + name); };
  const rows = () => page.$$eval('.fslb-row[data-i]', (els) => els.length);
  const totalsText = () => page.$eval('.fslb-totals', (e) => e.innerText.replace(/\s+/g, ' ').trim());
  const options = () => page.$$eval('.fslb-filter option', (els) => els.map((o) => o.text));
  const pick = (prefix) => page.$eval('.fslb-filter select', (f, p) => {
    f.value = [...f.options].find((o) => o.text.startsWith(p)).value;
    f.dispatchEvent(new Event('change'));
  }, prefix);

  // v0.1.x call: open() with no args still works
  await go('logbook');
  check(await rows() === 6, 'open() with no args: 6 rows');
  check(/Flights 6/i.test(await totalsText()), 'open() with no args: totals over all');

  // The main menu's logbook: all flights, the filter, names on rows
  await go('all');
  check(await rows() === 8, 'all: 8 rows');
  check(/Flights 8/i.test(await totalsText()), 'all: totals over 8');
  const opts = await options();
  check(JSON.stringify(opts) === JSON.stringify(['All scenarios (8)', 'Scenario 1 (3)', 'Test A (3)', 'Night shuttle (1)', 'Not flown yet (0)', 'Busan hop (deleted) (1)']),
    'filter options: ' + opts.join(' | '));
  const names = await page.$$eval('.fslb-row[data-i] .sc', (els) => els.map((e) => e.textContent));
  check(names.length === 8 && names.includes('Busan hop') && names.filter((n) => n === 'Scenario 1').length === 3, 'rows name their scenario: ' + names.join(', '));
  check(await page.textContent('[data-k="clear"]') === 'Clear logbook', 'all: "Clear logbook"');
  await shot('v020-logbook-dev-all.png');

  // Filtered to one scenario, then the keys inside the select
  await go('filtered');
  check(await rows() === 3, 'filtered: 3 rows');
  const t = await totalsText();
  check(/Flights 3/i.test(t) && /Hours 2:13/i.test(t), 'filtered totals: ' + t);
  check(await page.$$eval('.fslb-row[data-i] .sc', (e) => e.length) === 0, 'filtered: no scenario names on rows');
  check(await page.textContent('[data-k="clear"]') === 'Clear these flights', 'filtered: "Clear these flights"');
  await shot('v020-logbook-dev-filtered.png');
  const k0 = await page.evaluate(() => window.__keys.length);
  await page.focus('.fslb-filter select');
  for (const k of ['KeyW', 'Space', 'KeyP', 'Digit1']) await page.keyboard.press(k);
  check(await page.evaluate((n) => window.__keys.length === n, k0), 'keys in the panel never reach the game');

  // A deleted scenario still filters, under the name it had
  await pick('Busan hop');
  check(await rows() === 1 && (await page.textContent('.fslb-row[data-i] .route')) === 'RKSS–RKPC', 'deleted scenario filters by id');

  // "Clear these flights" removes only that scenario's
  await pick('Test A');
  await page.click('[data-k="clear"]');
  const ct = await page.textContent('.fslb-confirm span');
  check(await page.isVisible('.fslb-confirm') && /Test A/.test(ct) && /3 flights/.test(ct), 'clear asks first: ' + ct);
  await page.click('[data-k="really"]');
  const left = await page.evaluate(() => window.__mem.logbook.map((e) => e.scenarioId ?? null));
  check(left.length === 5 && !left.includes('a'), 'only Test A cleared, stored: ' + JSON.stringify(left));
  check(await page.isVisible('.fslb-empty') && (await options()).includes('Test A (0)'), 'empty filtered view, filter updated');
  await pick('All');
  check(await rows() === 5 && await page.textContent('[data-k="clear"]') === 'Clear logbook', 'all again: 5 rows, "Clear logbook"');

  // The pause menu's logbook: one scenario, its name in the title, no filter
  await go('pause');
  check(await page.textContent('.fslb-bar h2') === 'Logbook · Test A', 'pause: title');
  check(!(await page.isVisible('.fslb-filter')), 'pause: no filter');
  check(await rows() === 3 && /Flights 3/i.test(await totalsText()), 'pause: 3 rows, totals over 3');
  check(await page.textContent('[data-k="clear"]') === 'Clear these flights', 'pause: "Clear these flights"');
  await shot('v020-logbook-dev-pause-scoped.png');
  await page.keyboard.press('Escape');
  check(!(await page.evaluate(() => window.__logbook.isOpen)), 'Esc closes');
  await page.click('[data-act="menu-logbook"]');
  check(await rows() === 8 && await page.textContent('.fslb-bar h2') === 'Logbook', 'reopened from the menu: all flights again');

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} finally {
  await browser.close();
}
console.log(fails ? `${fails} failed` : 'all ok');
process.exit(fails ? 1 : 0);
