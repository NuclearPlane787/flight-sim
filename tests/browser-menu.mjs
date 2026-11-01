// Main menu, Load scenario, Settings, Controls and the setup's Name field: loads
// tests/dev-menu.html (no WebGL, a store in memory) in Chrome at 1440x900 and 1280x720,
// takes v020-menu-dev-*.png and checks the keys, rename, delete and Cancel.
//   python3 tools/cpu-guard.py -- node tests/browser-menu.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';

const BASE = (process.env.BASE || 'http://localhost:8014') + '/games/flight-sim/tests/dev-menu.html';
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
    await page.goto(`${BASE}?${q}`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
  };
  const shot = async (name) => { await page.screenshot({ path: OUT + name }); console.log('shot ' + name); };
  const calls = () => page.evaluate(() => window.__calls.slice());
  const keysSeen = () => page.evaluate(() => window.__keys.length);
  const focused = () => page.evaluate(() => document.activeElement?.dataset?.k || document.activeElement?.className || document.activeElement?.tagName);
  // Nothing in the element sticks out of the window.
  const inView = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });

  // ---- The main menu ----
  await go('scene=main');
  check(await page.isVisible('.fsm [data-k="continue"]'), 'Continue shows with scenarios');
  const sub = await page.textContent('[data-o="contSub"]');
  check(sub === 'Test B · On the runway at RKPC', 'Continue is the newest: ' + sub);
  check(await focused() === 'continue', 'Continue has the focus');
  const bg = await page.$eval('.fsm', (e) => getComputedStyle(e).getPropertyValue('--backdrop'));
  check(/flight-sim\/assets\/menu\/.*\.jpg/.test(bg), 'a still is the backdrop: ' + bg.trim());
  check(await page.$eval('.fsm-title', (e) => getComputedStyle(e).fontFamily.startsWith('Barlow')), 'title in Barlow');
  check(await page.textContent('.fsm-version') === 'Flight Sim v0.2.0 · CL#261101', 'version label');
  check(await page.getAttribute('[data-k="exit"]', 'href') === '../../index.html', 'Exit links to Game Dump');
  const k0 = await keysSeen();
  await page.keyboard.press('ArrowDown');
  check(await focused() === 'new', 'ArrowDown moves to New scenario');
  await page.keyboard.press('KeyW');
  check(await keysSeen() === k0, 'keys on the menu never reach the game');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check(await page.isVisible('.fsui-setup'), 'Enter on New scenario opens the setup');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check((await calls()).includes('plan null') && await page.isVisible('.fsm'), 'Esc in the setup cancels (null) back to the menu');
  await page.click('[data-k="continue"]');
  check((await calls()).some((c) => c.startsWith('continue ')), 'Continue calls onContinue(id)');
  await shot('v020-menu-dev-main.png');
  check(await inView('.fsm-nav'), 'buttons inside the window at 1440x900');

  // No scenarios: Continue hidden, New scenario primary
  await go('scene=empty&bg=none');
  check(!(await page.isVisible('[data-k="continue"]')), 'Continue hidden with no scenarios');
  check(await page.$eval('[data-k="new"]', (e) => e.classList.contains('primary')), 'New scenario is primary then');
  await shot('v020-menu-dev-main-empty.png');
  await page.click('[data-k="load"]');
  check(await page.isVisible('.fsm-empty'), 'Load scenario: empty state');

  // ---- Load scenario ----
  await go('scene=main');
  await page.click('[data-k="load"]');
  const names = await page.$$eval('.fsm-row .fsm-row-main b', (els) => els.map((e) => e.textContent));
  check(names.length === 5 && names[0] === 'Test B' && names[4] === 'Scenario 1', 'newest first: ' + names.join(', '));
  const row0 = await page.$eval('.fsm-row', (e) => e.innerText.replace(/\s+/g, ' '));
  check(/RKPC 07 → RKSS 14R/.test(row0) && /On the runway at RKPC/.test(row0) && /just now/.test(row0), 'row: ' + row0);
  check(await page.$eval('.fsm-row', (e) => document.activeElement === e), 'the first row has the focus');
  await shot('v020-menu-dev-load.png');
  check(await inView('.fsm-load'), 'Load panel inside the window');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const id1 = await page.$$eval('.fsm-row', (els) => els[1].dataset.id);
  check((await calls()).includes('load ' + id1), 'ArrowDown + Enter loads the second row');
  await page.click('.fsm-row:nth-child(3) .fsm-row-main');
  const id2 = await page.$$eval('.fsm-row', (els) => els[2].dataset.id);
  check((await calls()).includes('load ' + id2), 'a click on a row loads it');

  // Rename: too short refused, then a good name
  await page.click('.fsm-row:nth-child(2) [data-r="rename"]');
  check(await page.evaluate(() => document.activeElement?.dataset?.r === 'name'), 'rename: the field has the focus');
  const k1 = await keysSeen();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('ab');
  await page.keyboard.press('Enter');
  check(/3–40/.test(await page.textContent('[data-o="renameMsg"]')), 'a 2-character name is refused');
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  await page.keyboard.type('  Gimpo   circuits  ');
  await shot('v020-menu-dev-load-rename.png');
  await page.keyboard.press('Enter');
  check(await keysSeen() === k1, 'typing a name never reaches the game');
  const renamed = await page.evaluate((id) => window.__store.list().find((e) => e.id === id)?.name, id1);
  check(renamed === 'Gimpo circuits', 'renamed and cleaned: ' + renamed);
  check(await page.$$eval('.fsm-row .fsm-row-main b', (els) => els[1].textContent) === 'Gimpo circuits', 'the list shows the new name, same place');
  // Esc cancels a rename
  await page.click('.fsm-row:nth-child(1) [data-r="rename"]');
  await page.keyboard.type('zzz');
  await page.keyboard.press('Escape');
  check(await page.isVisible('.fsm-load') && await page.evaluate(() => window.__store.list()[0].name) === 'Test B', 'Esc cancels a rename, stays on Load');

  // Delete asks first
  await page.click('.fsm-row:nth-child(4) [data-r="delete"]');
  check(await page.isVisible('.fsm-confirm'), 'delete asks first');
  await shot('v020-menu-dev-load-delete-confirm.png');
  await page.keyboard.press('Escape');
  check(!(await page.isVisible('.fsm-confirm')) && await page.evaluate(() => window.__store.list().length) === 5, 'Esc cancels the delete');
  await page.click('.fsm-row:nth-child(4) [data-r="delete"]');
  await page.click('.fsm-confirm [data-r="yes"]');
  check(await page.evaluate(() => window.__store.list().length) === 4, 'deleted after the confirm');
  await page.keyboard.press('Escape');
  check(await page.isVisible('.fsm-nav') && await focused() === 'continue', 'Esc on Load goes back to the menu');

  // ---- Settings ----
  await go('scene=settings&sky=1');
  check(await page.isVisible('.fsm-settings .fsm-card'), 'Settings open over the menu');
  check(await page.textContent('.fsm-settings output') === '80%', 'volume shows the current value');
  const k2 = await keysSeen();
  await page.focus('.fsm-settings input[type=range]');
  await page.keyboard.press('ArrowLeft');
  check(await page.textContent('.fsm-settings output') === '75%' && await page.evaluate(() => window.__settingsState.volume) === 0.75, 'slider: 75% and onVolume(0.75)');
  await page.click('.fsm-settings [data-seg="callouts"] [data-v="off"]');
  await page.click('.fsm-settings [data-seg="perf"] [data-v="on"]');
  const st = await page.evaluate(() => window.__settingsState);
  check(st.callouts === false && st.showPerf === true, 'callouts off, perf on');
  check(await keysSeen() === k2, 'keys in Settings never reach the game');
  await shot('v020-menu-dev-settings.png');
  await page.click('[data-s="sky"]');
  check((await calls()).includes('sky') && !(await page.evaluate(() => window.__settings.isOpen)), 'Sky button: closes and calls onSky');
  await page.click('[data-k="settings"]');
  await page.keyboard.press('Escape');
  check(!(await page.evaluate(() => window.__settings.isOpen)) && await page.isVisible('.fsm-nav'), 'Esc closes Settings, the menu stays');
  check(await focused() === 'settings', 'focus back on the Settings button');
  await go('scene=settings');
  check(!(await page.$('[data-s="sky"]')), 'no Sky button without onSky');

  // Over the pause menu
  await go('scene=pause');
  await page.click('#pause [data-act="settings"]');
  check(await page.isVisible('.fsm-settings .fsm-card'), 'Settings over the pause menu');
  await shot('v020-menu-dev-settings-pause.png');
  await page.keyboard.press('Escape');
  check(!(await page.evaluate(() => window.__settings.isOpen)) && await page.isVisible('#pause'), 'Esc closes, the pause menu stays');

  // ---- Controls ----
  await go('scene=controls&sky=1');
  check(await page.$$eval('.fsm-keys tr', (e) => e.length) === 12, 'keys table with the Sky row');
  check(await inView('.fsm-controls .fsm-card'), 'Controls card inside the window');
  await shot('v020-menu-dev-controls.png');
  await go('scene=controls');
  check(!/Sky window/.test(await page.textContent('.fsm-keys')), 'no Sky row without { sky: true }');

  // ---- The setup's Name field ----
  await go('scene=setup');
  check(await page.textContent('.fsui-dlg h2') === 'New scenario', 'setup title from opts');
  check(await page.inputValue('[data-f="name"]') === 'Scenario 2', 'name defaults to defaultName() (Scenario 1 is taken): ' + await page.inputValue('[data-f="name"]'));
  check(await page.isVisible('[data-a="cancel"]'), 'Cancel shows');
  const k3 = await keysSeen();
  await page.fill('[data-f="name"]', '');
  await page.focus('[data-f="name"]');
  await page.keyboard.type('Wq');
  check(await keysSeen() === k3, 'typing in the name never reaches the game');
  await page.click('[data-a="fly"]');
  check(await page.isVisible('.fsui-setup') && /name/.test(await page.textContent('[data-o="msg"]')), 'Fly refuses a 2-character name');
  await page.keyboard.type('  Night   Jeju  ');
  await shot('v020-menu-dev-setup-name.png');
  await page.click('[data-a="fly"]');
  await page.waitForTimeout(200);
  const plan = await page.evaluate(() => window.__plan);
  check(plan && plan.name === 'Wq Night Jeju' && plan.origin, 'the plan has the cleaned name: ' + plan?.name);

  // ---- 1280x720 ----
  await page.setViewportSize({ width: 1280, height: 720 });
  await go('scene=main');
  check(await inView('.fsm-nav') && await inView('.fsm-title'), 'menu fits at 1280x720');
  await shot('v020-menu-dev-main-720.png');
  await page.click('[data-k="load"]');
  check(await inView('.fsm-load'), 'Load fits at 1280x720');
  await shot('v020-menu-dev-load-720.png');
  await go('scene=controls&sky=1');
  check(await page.$eval('.fsm-controls .fsm-card', (e) => e.scrollHeight <= e.clientHeight + 1), 'Controls without a scrollbar at 1280x720');
  await shot('v020-menu-dev-controls-720.png');
  await go('scene=setup');
  await shot('v020-menu-dev-setup-name-720.png');

  check(!errors.length, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
