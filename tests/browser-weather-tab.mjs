// The Weather tab and the setup's chooser, in Chrome (no WebGL: tests/dev-weather-tab.html).
//   python3 tools/cpu-guard.py -- node tests/browser-weather-tab.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = (process.env.BASE || 'http://localhost:8014') + '/games/flight-sim/';
const DEV = ROOT + 'tests/dev-weather-tab.html';
const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim/', import.meta.url).pathname);
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'fs-wx-')), { channel: 'chrome', headless: false,
  viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, args: ['--window-size=1440,960'] });
let fails = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.location()?.url || '')) errors.push(m.text() + ' ' + (m.location()?.url || '')); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push(r.status() + ' ' + r.url()); });
  const go = async () => { await page.goto(DEV); await page.waitForFunction(() => window.__ready, null, { timeout: 15000 }); await page.waitForTimeout(200); };
  const shot = async (name) => { await page.screenshot({ path: OUT + name }); console.log('shot ' + name); };
  const W = '.fswx';
  const metar = () => page.textContent(`${W} [data-o="metar"]`);
  const name = () => page.textContent(`${W} [data-o="name"]`);
  const msg = () => page.textContent(`${W} [data-o="msg"]`);
  const applied = () => page.evaluate(() => window.__applied.length);
  const last = () => page.evaluate(() => window.__applied.at(-1));
  const field = (k) => `${W} [data-f="${k}"]`;
  const clickSeg = (seg, v) => page.click(`${W} [data-seg="${seg}"] button[data-v="${v}"]`);
  const clearOf = (a, b) => page.evaluate(([a, b]) => { const r = document.querySelector(a).getBoundingClientRect(), s = document.querySelector(b).getBoundingClientRect(); return r.right <= s.left || s.right <= r.left || r.bottom <= s.top || s.bottom <= r.top; }, [a, b]);
  const inView = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });

  await go();
  check(await page.isVisible(W), 'the Weather tab is open');
  check(await name() === 'Clear', 'the calm world shows as Clear: ' + await name());
  check((await metar()).includes('00000KT CAVOK 15/07 Q1013'), 'the METAR line: ' + await metar());
  check(await page.$eval(field('wind.kt'), (e) => e.value) === '0', 'fields filled');
  check(await inView(W) && await clearOf(W, '[data-m="pfd"]'), 'inside the window and clear of the PFD at 1440x900');
  await shot('v040-weather-tab-clear.png');

  // Presets apply at once.
  for (const [id, label, want] of [['rain', 'Rain', ' RA '], ['thunderstorm', 'Thunderstorm', 'TSRA'], ['snow', 'Snow', 'SN'], ['fog', 'Fog', 'FG'], ['gusty-crosswind', 'Crosswind', 'G35KT'], ['overcast', 'Overcast', 'OVC'], ['few-clouds', 'Few clouds', 'FEW040']]) {
    const n = await applied();
    await page.click(`${W} [data-p="${id}"]`);
    check(await applied() === n + 1 && (await last()).preset === id, `${id} applies at once`);
    check(await name() === label && (await metar()).includes(want), `${id}: ${await metar()}`);
    if (id === 'thunderstorm') { check((await last()).microbursts.length >= 6, 'scattered cells: ' + (await last()).microbursts.length); await page.waitForTimeout(100); await shot('v040-weather-tab-thunderstorm.png'); }
    if (id === 'gusty-crosswind') check(await page.$eval(field('wind.fromDeg'), (e) => e.value) === '156', 'across RKPC 07 (066): from 156');
  }

  // A field: keys stay in it, the METAR shows what it would give, the tag goes Custom, Enter applies.
  await page.click(`${W} [data-p="rain"]`);
  await page.waitForTimeout(150);
  const before = await applied(), keys = await page.evaluate(() => window.__keys.length);
  await page.click(field('wind.kt'));
  await page.fill(field('wind.kt'), '');
  await page.keyboard.type('18');
  check(await name() === 'Custom', 'an edit makes it Custom');
  check((await metar()).includes('20018G22KT'), 'the METAR shows the edit before Apply: ' + await metar());
  check(await page.$eval(field('wind.kt'), (e) => e.classList.contains('edited')), 'the field shows as edited');
  check(await page.isEnabled(`${W} [data-a="apply"]`), 'Apply on');
  check(await applied() === before, 'not applied yet');
  await page.keyboard.press('Enter');
  const c = await last();
  check(await applied() === before + 1 && c.preset === 'custom' && c.wind.kt === 18, 'Enter applies as custom');
  check(c.precip.kind === 'rain' && c.seed === 13, 'the rest stays');
  check(await msg() === 'Weather set.', 'message: ' + await msg());
  check((await page.evaluate(() => window.__keys.length)) === keys, 'typing and Enter in a field never reached the game');
  await page.keyboard.press('KeyW');
  check((await page.evaluate(() => window.__keys.at(-1))) === 'KeyW', 'after Apply the keys are the flight’s');
  await page.click(field('wind.gustKt'));
  await page.fill(field('wind.gustKt'), '3');
  check((await msg()).startsWith('Gusts are the peak') && !(await page.isEnabled(`${W} [data-a="apply"]`)), 'a bad value stops Apply: ' + await msg());
  await page.click(`${W} [data-a="revert"]`);
  check(await page.$eval(field('wind.gustKt'), (e) => e.value) === '22', 'Undo edits refills');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  check(!await page.isVisible(W), 'Esc from a field... closes it');
  await page.evaluate(() => window.__show('weather'));

  // Buttons don't take the focus; L toggles; the seg controls.
  await clickSeg('turbulence', 'severe');
  check(await name() === 'Custom' && await page.evaluate(() => !document.querySelector('.fswx').contains(document.activeElement)), 'a seg button leaves the focus alone');
  await page.click(`${W} [data-p="clear"]`);
  await clickSeg('runway', 'ice');
  await clickSeg('precipKind', 'snow');
  await clickSeg('rate', 'heavy');
  await clickSeg('lightning', 'frequent');
  await page.selectOption(`${W} select[data-cover="0"]`, 'OVC');
  check(!await page.$eval(`${W} select[data-cover="0"]`, (e) => e === document.activeElement), 'a cover gives the keys back');
  await page.fill(field('clouds.0.baseFt'), '800');
  await page.fill(field('clouds.0.topFt'), '2500');
  await page.fill(field('mbNm'), '2.5');
  await page.fill(field('mbKt'), '50');
  await page.fill(field('shear.kt'), '20');
  await page.fill(field('shear.ftAgl'), '600');
  await page.fill(field('tempC'), '-5');
  await page.fill(field('qnh'), '998');
  check((await metar()).includes('OVC008') && (await metar()).includes('M05') && (await metar()).includes('Q998') && (await metar()).includes('WS ALL RWY'), 'all in the METAR: ' + await metar());
  await page.click(`${W} [data-a="apply"]`);
  const d = await last();
  check(d.preset === 'custom' && d.runway === 'ice' && d.precip.kind === 'snow' && d.precip.rate === 0.85 && d.lightning === 0.8 && d.clouds[0].okta === 8 && d.shear.kt === 20 && d.microbursts.length === 1 && d.tempC === -5 && d.qnh === 998, 'Apply carries every kind of field');
  await page.waitForTimeout(150);
  check((await page.$eval(field('mbNm'), (e) => e.value)) === '2.5', 'the microburst reads back: ' + await page.$eval(field('mbNm'), (e) => e.value));
  await shot('v040-weather-tab-custom.png');

  // The wheel scrolls the settings, and doesn't reach the game.
  const box = await page.$eval(`${W} .fswx-scroll`, (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, e.scrollHeight, e.clientHeight]; });
  check(box[2] > box[3], `the settings scroll (${box[2]} in ${box[3]})`);
  await page.mouse.move(box[0], box[1]); await page.mouse.wheel(0, 200); await page.waitForTimeout(100);
  check(await page.$eval(`${W} .fswx-scroll`, (e) => e.scrollTop) > 0, 'the wheel scrolls them');
  await page.mouse.wheel(0, 900); await page.waitForTimeout(150);
  await shot('v040-weather-tab-scrolled.png');

  // The tabs: L's window, three on each.
  for (const [t, sel] of [['sky', '.fssw:not(.fslw):not(.fswx)'], ['load', '.fslw'], ['weather', W]]) {
    await page.evaluate((t) => window.__show(t), t);
    await page.waitForTimeout(100);
    check(await page.$$eval(`${sel} .fssw-tab`, (e) => e.length) === 3, `${t}: three tabs`);
    const rows = await page.$eval(`${sel} .fssw-head`, (h) => { const x = h.querySelector('.fssw-x').getBoundingClientRect(), t = h.querySelector('.fssw-tabs').getBoundingClientRect(); return x.left >= t.right && h.getBoundingClientRect().height <= 34; });
    check(rows, `${t}: the title bar holds together`);
    await shot(`v040-weather-tabs-${t}.png`);
  }
  await page.evaluate(() => window.__show('load'));
  await page.click('.fslw [data-tab="weather"]');
  check(await page.evaluate(() => window.__tab()) === 'weather' && await page.isVisible(W), 'from Weight to Weather');
  await page.click(`${W} [data-tab="sky"]`);
  check(await page.evaluate(() => window.__tab()) === 'sky', 'from Weather to Sky');
  await page.click('.fssw:not(.fslw):not(.fswx) [data-tab="weather"]');
  check(await page.isVisible(W), 'from Sky to Weather');
  await page.keyboard.press('KeyL');
  check(!await page.isVisible(W), 'L closes it');
  await page.keyboard.press('KeyL');
  check(await page.isVisible(W), 'L opens it again');

  // Crashed: no changes. A weather set elsewhere refills an unedited tab.
  await page.evaluate(() => { window.__crashed = true; }); await page.waitForTimeout(150);
  check((await msg()).startsWith('Crashed') && !await page.isEnabled(`${W} [data-p="rain"]`), 'a crash stops it');
  await page.evaluate(() => { window.__crashed = false; window.__setWx({ preset: 'fog', visM: 300, fogTopFt: 300, qnh: 1030 }); }); await page.waitForTimeout(200);
  check(await page.$eval(field('qnh'), (e) => e.value) === '1030', 'a weather set elsewhere shows');

  // 1280x720.
  await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(200);
  check(await inView(W) && await clearOf(W, '[data-m="pfd"]'), 'inside the window and clear of the PFD at 1280x720');
  await shot('v040-weather-tab-720p.png');
  await page.setViewportSize({ width: 1440, height: 900 });

  // The setup: the chooser beside the start time; clear by default; goes into the plan; not into lastPlan.
  await page.evaluate(() => { window.__show('weather'); window.__win.close(); window.__showSetup(null, { title: 'Flight setup' }); });
  await page.waitForTimeout(300);
  const S = '.fsui-setup';
  check(await page.$eval(`${S} [data-f="weather"]`, (e) => e.value) === 'clear', 'the setup starts Clear');
  await page.selectOption(`${S} [data-f="weather"]`, 'snow');
  check((await page.$eval(`${S} [data-f="weather"]`, (e) => e.title)).startsWith('Below freezing'), 'its note');
  check(await page.$eval('.fsui-dlg', (d) => { const r = d.querySelector('[data-f="weather"]').getBoundingClientRect(), f = d.querySelector('.fsui-foot').getBoundingClientRect(); return r.bottom <= f.top; }), 'the chooser is above the footer, not cut off');
  await shot('v040-setup-weather.png');
  await page.click(`${S} [data-a="fly"]`); await page.waitForTimeout(100);
  check((await page.evaluate(() => window.__plan?.weather)) === 'snow', 'the plan carries it');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gamedump:flight-sim:settings') || '{}').lastPlan || {});
  check(!('weather' in stored), 'lastPlan does not');
  await page.evaluate(() => { window.__showSetup({ weather: 'rain' }, { title: 'New flight', cancel: true }); });
  await page.waitForTimeout(200);
  check(await page.$eval(`${S} [data-f="weather"]`, (e) => e.value) === 'rain', 'a New flight keeps the plan’s');
  await page.click(`${S} [data-a="cancel"]`);
  await page.evaluate(() => { window.__showSetup(null, { title: 'New scenario', cancel: true }); });
  await page.waitForTimeout(200);
  check(await page.$eval(`${S} [data-f="weather"]`, (e) => e.value) === 'clear', 'a new scenario is Clear again');
  await page.click(`${S} [data-a="cancel"]`);
  check(!errors.length, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { console.log('FAIL (threw) ' + e); fails++; }
await ctx.close();
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
