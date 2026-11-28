// v0.8.0, part 4: the Failures tab in the game, headless, one run: at a gate at Gimpo (stand 3), the L window's Failures
// tab; an engine flameout armed Now goes active and is repaired; one at a moment and one random armed (the random row shows
// its window alone); the window inside the viewport and clear of the PFD at 1440×900 and 1280×720; then a design with
// eight engines (tests/browser-airframe.mjs's stretched A321), its eight engine buttons in a row inside the window.
// Pictures "Claude outputs/flight-sim/v080-tab-<what>.png".
//   node tests/browser-v080-failures-tab.mjs [--base <url>]
// The last line printed: "done N of M".
import { chromium } from './pw.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const BASE = opt('--base', 'http://127.0.0.1:8014/games/flight-sim/');
const URL0 = `${BASE}?test&eastasia=1&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=gate&stand=3&view=orbit&type=a321neo`;
let pass = 0, total = 0;
const check = (ok, what) => { total++; if (ok) pass++; console.log((ok ? 'ok   ' : 'FAIL ') + what); };
const F = '.fssw.fsfw';

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'fs-v080-tab-')), { channel: 'chrome', headless: true,
  viewport: { width: 1440, height: 900 }, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
  const shot = (what) => page.screenshot({ path: path.join(OUT, `v080-tab-${what}.png`) }).then(() => console.log(`shot v080-tab-${what}.png`));
  const box = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
  const fits = async (tag) => {
    const w = await box(F), vw = await page.evaluate(() => [innerWidth, innerHeight]);
    check(w.l >= 0 && w.t >= 0 && w.r <= vw[0] && w.b <= vw[1], `${tag}: the window inside the viewport ${JSON.stringify(w)}`);
    const pfd = await page.$('.fsui-pfd');
    check(!!pfd, `${tag}: the PFD found`);
    if (pfd) {
      const p = await box('.fsui-pfd');
      check(w.r <= p.l || p.r <= w.l || w.b <= p.t || p.b <= w.t, `${tag}: clear of the PFD ${JSON.stringify(p)}`);
    }
    const head = await page.$eval(`${F} .fssw-head`, (h) => { const x = h.querySelector('.fssw-x').getBoundingClientRect(), t = h.querySelector('.fssw-tabs').getBoundingClientRect(); return x.left >= t.right - 0.5 && h.getBoundingClientRect().height <= 34; });
    check(head, `${tag}: four tabs and the close button in one title bar`);
  };
  const lists = () => page.$eval(`${F} [data-o="lists"]`, (e) => e.textContent);
  const click = (sel) => page.click(`${F} ${sel}`);

  await page.goto(URL0);
  await page.waitForFunction(() => window.__fs && window.__fs.gate && window.__fs.gate.phase === 'parked' && window.__fs.frames > 30, null, { timeout: 90000 });
  // The L window, then its Failures tab from the Sky window's tab row.
  await page.keyboard.press('Backslash'); await page.waitForTimeout(200);
  await page.click('.fssw:not(.fslw):not(.fswx):not(.fsfw) [data-tab="failures"]'); await page.waitForTimeout(200);
  check(await page.isVisible(F), 'the Failures tab opens from the Sky window');
  const tabs = await page.$$eval(`${F} .fssw-tab`, (b) => b.map((x) => x.textContent.trim() + (x.classList.contains('on') ? '*' : '')));
  check(tabs.join('|') === 'Sky|Weight|Weather|Failures*', 'its tabs: ' + tabs.join(' | '));
  for (const s of ['.fslw', '.fswx']) {
    await page.evaluate(([t]) => window.__fs.showLTab(t), [s === '.fslw' ? 'load' : 'weather']); await page.waitForTimeout(100);
    check(await page.$$eval(`${s} [data-tab="failures"]`, (b) => b.length) === 1, `${s}: has the Failures tab`);
    await page.click(`${s} [data-tab="failures"]`); await page.waitForTimeout(150);
    check(await page.isVisible(F) && !await page.isVisible(s), `${s}: its Failures tab opens the Failures window`);
  }
  check((await lists()).includes('Nothing has failed.') && (await lists()).includes('Nothing armed.'), 'empty lists at the start');
  await shot('gate-empty');
  await fits('1440x900');

  // An engine flameout, Now: engine 2.
  await click('[data-seg="when"] [data-v="now"]');
  await click('[data-seg="system"] [data-v="engines"]');
  await page.selectOption(`${F} [data-sel="kind"]`, 'eng-flameout');
  check(await page.$$eval(`${F} [data-eng]`, (b) => b.length) === 2, 'two engine buttons on the A321');
  await click('[data-eng="1"]');
  await click('[data-a="arm"]');
  await page.waitForTimeout(600);
  const r1 = await page.evaluate(() => ({ fails: window.__fs.sim.state.failures.map((a) => ({ ...a })), lit: window.__fs.sim.state.engines[1].lit, focus: document.activeElement?.tagName }));
  check(r1.fails.length === 1 && r1.fails[0].kind === 'eng-flameout' && r1.fails[0].target === 1, 'the sim has engine 2 flamed out: ' + JSON.stringify(r1.fails));
  check(/Engine 2: flameout/.test(await lists()) && /Repair/.test(await lists()), 'it shows in Active: ' + await lists());
  check(r1.focus !== 'INPUT' && r1.focus !== 'SELECT', 'the keys are back on the flight: ' + r1.focus);
  await shot('active');
  await page.click(`${F} [data-a="repair"]`); await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__fs.sim.state.failures.length === 0 && window.__fs.sim.failures === null), 'repaired: nothing failed, nothing armed');
  check((await lists()).includes('Nothing has failed.'), 'the lists are empty again');

  // At a moment: the nose won't lock down on short final. After a time: an engine fire in 5 min.
  await click('[data-seg="when"] [data-v="moment"]');
  await click('[data-seg="system"] [data-v="gear"]');
  await page.selectOption(`${F} [data-sel="kind"]`, 'gear-nolock');
  await click('[data-seg="leg"] [data-v="0"]');
  await page.selectOption(`${F} [data-sel="moment"]`, 'final500');
  await click('[data-a="arm"]'); await page.waitForTimeout(200);
  await click('[data-seg="when"] [data-v="after"]');
  await click('[data-seg="system"] [data-v="engines"]');
  await page.selectOption(`${F} [data-sel="kind"]`, 'eng-fire');
  await page.fill(`${F} [data-f="min"]`, '5'); await page.fill(`${F} [data-f="sec"]`, '0');
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  // Random: within 12 minutes, engine kinds only.
  await click('[data-seg="when"] [data-v="random"]');
  for (const k of ['gear-noext', 'gear-nolock', 'gear-collapse']) await click(`[data-tick="${k}"]`);
  await page.fill(`${F} [data-f="win"]`, '12');
  await click('[data-a="arm"]'); await page.waitForTimeout(400);
  const L = await lists();
  check(L.includes('Nose gear: won’t lock down') && L.includes('On short final below 500 ft'), 'the moment one is armed: ' + L);
  check(/Engine \d: fire.*in [45] min/.test(L), 'the timed one counts down');
  check(L.includes('A random failure armed, within 12 minutes'), 'the random one shows its window');
  const plan = await page.evaluate(() => JSON.parse(JSON.stringify(window.__fs.sim.failures)));
  check(plan && plan.items.length === 3 && plan.items[2].hidden, 'the plan holds three, the last hidden');
  const hid = plan.items[2];
  const html = await page.$eval(F, (e) => e.outerHTML);
  const rowHtml = await page.$eval(`${F} .fsfw-rand`, (e) => e.outerHTML);
  check(!rowHtml.includes(hid.kind) && !rowHtml.includes(String(hid.seed)) && !rowHtml.includes(hid.at.toFixed(1)) && !/title=/.test(rowHtml) && !/Engine|flameout|seizure|fire/i.test(rowHtml), 'the random row tells nothing but its window: ' + rowHtml);
  check(!html.includes(String(hid.seed)) && !html.includes(hid.at.toFixed(2)), 'nor the whole window\'s HTML its seed or time');
  await shot('armed');
  // The settings scroll.
  const sc = await page.$eval(`${F} .fsfw-scroll`, (e) => [e.scrollHeight, e.clientHeight]);
  console.log(`scroll ${sc[0]} in ${sc[1]}`);
  // Disarm all.
  await page.click(`${F} [data-a="disarmAll"]`); await page.waitForTimeout(200);
  check(await page.evaluate(() => window.__fs.sim.failures === null), 'disarm all: nothing armed');

  // 1280×720.
  await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(600);
  await click('[data-seg="when"] [data-v="now"]');
  await fits('1280x720');
  await shot('1280x720');

  // A design with eight engines (tests/browser-airframe.mjs's stretched A321), on the runway.
  await page.setViewportSize({ width: 1440, height: 900 });
  const r8 = await page.evaluate(async () => {
    const f = window.__fs;
    const D = await import('./src/sim/designs.js');
    let d = D.newDesign('a321neo', { id: 'chk-v080-tab-8', name: 'Eight engines', registration: 'HL5300' });
    const e0 = d.parts[0].engine;
    d = { ...d, parts: [] };
    for (const s of [4.6, 7.5, 10.2, 12.8]) d = D.addPart(d, { kind: 'engine', engine: e0, mount: 'wing', side: 1, s });
    d = D.normalizeDesign(d);
    const def = D.designDef(d);
    f.startFlight({ origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'runway', pax: def.defaults.pax, cargoKg: def.defaults.cargoKg, fuelKg: 12000, waypoints: [], type: 'a321neo', design: d }, { keepClock: true });
    return f.sim.state.engines.length;
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__fs.showLTab('failures')); await page.waitForTimeout(300);
  check(r8 === 8, 'the design has eight engines: ' + r8);
  const eng = await page.$$eval(`${F} [data-eng]`, (b) => b.map((x) => { const r = x.getBoundingClientRect(); return [r.left, r.top, r.right]; }));
  const wb = await box(F);
  check(eng.length === 8 && eng.every((e) => e[1] === eng[0][1]) && eng.every((e) => e[0] >= wb.l && e[2] <= wb.r), `eight engine buttons in one row inside the window (${eng.length})`);
  await click('[data-eng="7"]');
  await click('[data-a="arm"]'); await page.waitForTimeout(500);
  check(await page.evaluate(() => window.__fs.sim.state.failures.some((a) => a.target === 7)) && /Engine 8: /.test(await lists()), 'engine 8 failed (the kind chosen last)');
  await shot('eight-engines');
  // Paused: repair all still works and shows at once.
  await page.evaluate(() => window.__fs.setPaused?.(true));
  await page.click(`${F} [data-a="repairAll"]`); await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__fs.sim.state.failures.length === 0) && (await lists()).includes('Nothing has failed.'), 'repair all (paused if the page offers it)');
  check(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e));
  total++;
} finally {
  await ctx.close().catch(() => {});
}
console.log(`done ${pass} of ${total}`);
