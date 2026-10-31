// Logbook and landing-score card check: loads tests/dev-logbook.html in Chrome at 1440x900,
// takes logbook-*.png and score-*.png, and checks the row detail, the clear confirm and Esc.
//   python3 tools/cpu-guard.py -- node tests/browser-logbook.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';

const BASE = 'http://localhost:8001/games/flight-sim/tests/dev-logbook.html';
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

  // The list, newest first
  await go('logbook');
  const routes = await page.$$eval('.fslb-row[data-i] .route', (els) => els.map((e) => e.textContent));
  check(routes.length === 6 && routes[0] === 'RKSS–RKSI' && routes[5] === 'RKSS–RKPC', 'newest first: ' + routes.join(', '));
  const tot = await page.$eval('.fslb-totals', (e) => e.innerText.replace(/\s+/g, ' '));
  check(/Flights 6/i.test(tot) && /Hours 4:36/i.test(tot) && /Average points 65/i.test(tot) && /A 96/.test(tot), 'totals: ' + tot.trim());
  await shot('logbook-list.png');

  // A row opened
  await page.click('.fslb-row[data-i="4"]');
  check(await page.$$eval('.fslb-detail .fssc-part', (e) => e.length) === 7, 'row detail shows the 7 parts');
  await shot('logbook-row.png');
  await page.click('.fslb-row[data-i="4"]');
  check(await page.$$eval('.fslb-detail', (e) => e.length) === 0, 'click again closes the detail');

  // Esc closes, and the game's window listener never sees it
  const before = await page.evaluate(() => window.__keys.length);
  await page.keyboard.press('Escape');
  check(!(await page.evaluate(() => window.__logbook.isOpen)), 'Esc closes');
  check(await page.evaluate((n) => window.__keys.length === n, before), 'Esc did not reach the game');
  check(await page.evaluate(() => document.activeElement === document.body), 'focus back on the page after closing');
  await page.keyboard.press('KeyW');
  check(await page.evaluate(() => window.__keys.at(-1) === 'w'), 'keys reach the game when closed');

  // Reopen from the pause menu, clear with the in-panel confirm
  await page.click('[data-act="logbook"]');
  await page.click('[data-k="clear"]');
  check(await page.isVisible('.fslb-confirm'), 'clear asks first');
  await shot('logbook-clear.png');
  await page.keyboard.press('Escape');
  check(!(await page.isVisible('.fslb-confirm')) && await page.evaluate(() => window.__logbook.isOpen), 'Esc cancels the confirm only');
  await page.click('[data-k="clear"]');
  await page.click('[data-k="really"]');
  check(await page.evaluate(() => window.__mem.logbook.length === 0), 'cleared and saved');
  check(await page.isVisible('.fslb-empty'), 'empty state shows');
  await shot('logbook-empty.png');
  await page.click('[data-k="close"]');
  check(await page.evaluate(() => window.__closed === 2), 'Close button closes (onclose called)');

  // Score cards
  for (const s of ['a', 'd']) {
    await go('score-' + s);
    check(await page.isVisible('.fssc-card'), `score ${s} card visible`);
    await shot(`score-${s}.png`);
  }
  await page.click('.fssc-card [data-k="new"]');
  check(await page.evaluate(() => window.__newflight && document.getElementById('score').hidden), 'New flight hides the card and calls back');

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} finally {
  await browser.close();
}
console.log(fails ? `${fails} failed` : 'all ok');
process.exit(fails ? 1 : 0);
