// v0.5.6: the Warehouse editor's part in hand and the drag from the palette, from the cloud (headless Chromium,
// SwiftShader, 1440×900): a GE90 picked from the palette, turned, nudged and raised with the keys while in hand (the tip
// and the help line say so), then attached with those values; Shift+click keeps a part in hand with its offsets; a wing
// tank dragged from the palette onto the wing attaches; a part let go off the aircraft or where it can't go goes back.
//   python3 tests/cloud/serve.py <GameDump folder> 8765 &
//   node tests/cloud/v056-editor.cjs outDir        (FS_ROOT, default http://127.0.0.1:8765/games/)
const { chromium } = require('playwright');
const ROOT = process.env.FS_ROOT || 'http://127.0.0.1:8765/games/';
const out = process.argv[2] || 'v056-editor';
require('fs').mkdirSync(out, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? ` (${extra})` : ''}`); if (!ok) fails++; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.goto(ROOT + 'flight-sim/?warehouse=1');
  await page.waitForSelector('.fsm:not([hidden])', { timeout: 120000 });
  await page.click('[data-k="warehouse"]');
  await page.waitForSelector('.fsw:not([hidden])');
  const idle = async () => {
    await page.waitForFunction(() => { const m = document.querySelector('.fsw [data-o="viewMsg"]'); return m && m.hidden && window.__fsw && window.__fsw.view && !window.__fsw.busy; }, null, { timeout: 120000 });
    await page.waitForTimeout(400);
  };
  const shot = async (name) => { try { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); } catch (err) { console.log('no picture', name, String(err).slice(0, 80)); } };
  const at = (x, y, z) => page.evaluate(([x, y, z]) => window.__fsw.project(x, y, z), [x, y, z]);
  const A = async (expr) => page.evaluate(`(async () => { const D = await import('/games/flight-sim/src/sim/designs.js'); const a = D.airframe('a321neo'); return (${expr}); })()`);
  const wingAt = async (y) => at(...(await A(`[a.leX(${Math.abs(y)}) - 0.5 * a.chord(${Math.abs(y)}), ${y}, (a.lower(${Math.abs(y)}) + a.upper(${Math.abs(y)})) / 2]`)));
  const parts = () => page.evaluate(() => window.__wh.design.parts.map((p) => ({ ...p })));
  const text = (o) => page.$eval(`.fsw [data-o="${o}"]`, (e) => (e.hidden ? '' : e.textContent));
  const palCentre = (key) => page.$eval(`.fsw [data-place="${key}"]`, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });

  await page.click('.fsw [data-new="a321neo"]');
  await idle();
  const before = (await parts()).map((p) => p.id);

  // ---- 1. A GE90 in hand: Q/E, ↑ ↓, Shift+↑ ↓ and ← → before it's attached ----
  await page.click('.fsw [data-place="engine:ge90-115b"]');
  let s = await wingAt(-9);
  await page.mouse.move(s.x, s.y, { steps: 5 });
  await page.waitForTimeout(400);
  const help0 = await text('viewHelp');
  check('the help line lists the keys in hand', /Q E turn/.test(help0) && /Shift\+↑ ↓ up and down/.test(help0) && /drag it there from the palette/.test(help0), help0);
  const tip0 = await text('tip');
  for (let i = 0; i < 3; i++) await page.keyboard.press('e');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowUp'); await page.keyboard.press('Shift+ArrowUp');
  await page.waitForTimeout(300);
  const tipA = await text('tip');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  const tip1 = await text('tip');
  check('the tip shows the values at once', /0\.2 m forward/.test(tip1) && /0\.1 m up/.test(tip1) && /toed in 3°/.test(tip1), `${tip0} → ${tip1}`);
  const outOf = (t) => Number((/([\d.]+) m out/.exec(t) || [])[1]);
  const sA = outOf(tipA), sB = outOf(tip1);
  check('← moves it 0.25 m out from where the pointer puts it', near(sB - sA, 0.25), `${sA} → ${sB}`);
  check('the part is still in hand (nothing attached by the keys)', (await parts()).length === before.length && (await page.evaluate(() => window.__wh.tool)) === 'engine:ge90-115b');
  await shot('01-ge90-in-hand');
  await page.mouse.click(s.x, s.y);
  await idle();
  let ps = await parts();
  const ge = ps.filter((p) => !before.includes(p.id));
  check('attached as set in hand: the pair turned 3°, 0.2 m forward, 0.1 m up', ge.length === 2 && ge.every((p) => p.engine === 'ge90-115b' && p.yaw === 3 && near(p.dx, 0.2) && near(p.dz, 0.1)), JSON.stringify(ge.map((p) => [p.yaw, p.dx, p.dz, p.s])));
  check('and as far out as the tip said', ge.length === 2 && ge.every((p) => near(p.s, sB)), `${ge.map((p) => p.s)} vs ${sB}`);
  check('the part in hand goes once attached (no Shift)', (await page.evaluate(() => window.__wh.tool)) === null);

  // ---- 2. Shift+click keeps the part in hand, and its offsets ----
  await page.click('.fsw [data-place="engine:leap-1a"]');
  await page.click('.fsw [data-hang="over"]');
  s = await wingAt(-12);
  await page.mouse.move(s.x, s.y, { steps: 5 }); await page.waitForTimeout(300);
  await page.keyboard.press('q'); await page.keyboard.press('q');
  await page.keyboard.down('Shift'); await page.mouse.click(s.x, s.y); await page.keyboard.up('Shift');
  await idle();
  const kept = await page.evaluate(() => window.__wh.tool);
  ps = await parts();
  const leap = ps.filter((p) => p.engine === 'leap-1a' && p.mount === 'overwing');
  check('Shift+click: attached (toed out 2°) and still in hand', kept === 'engine:leap-1a' && leap.length === 2 && leap.every((p) => p.yaw === -2), `${kept} ${JSON.stringify(leap.map((p) => p.yaw))}`);
  // the next one, on the rear fuselage (free: the over-wing spot just taken would be red)
  const sb = await at(...(await A(`[a.tailCone + 1, -a.ys, 0.4]`)));
  await page.mouse.move(sb.x, sb.y, { steps: 6 }); await page.waitForTimeout(400);
  const tipNext = await text('tip');
  check('the offsets carry to the next one', /toed out 2°/.test(tipNext) && /body/.test(tipNext), tipNext);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('Esc puts it back', (await page.evaluate(() => window.__wh.tool)) === null);

  // ---- 3. A wing tank dragged from the palette onto the right wing ----
  const nBefore = (await parts()).length;
  let b = await palCentre('tank:wing');
  s = await wingAt(-13);   // the right wing: from the opening view the fuselage hides the left one
  await page.mouse.move(b.x, b.y); await page.mouse.down();
  await page.mouse.move(b.x + 30, b.y + 4, { steps: 3 });
  await page.mouse.move(s.x, s.y, { steps: 14 });
  await page.waitForTimeout(400);
  const dragTip = await text('tip');
  check('dragging: the ghost and its tip follow the pointer over the aircraft', /Wing tank/.test(dragTip), dragTip);
  await shot('02-tank-dragged');
  await page.mouse.up();
  await idle();
  ps = await parts();
  const tanks = ps.filter((p) => p.kind === 'tank' && p.mount === 'wing');
  check('let go over the wing: the tank pair attached', ps.length === nBefore + 2 && tanks.length === 2 && tanks.every((p) => Math.abs(p.s - 13) < 0.6), JSON.stringify(tanks.map((p) => [p.side, p.s])));
  check('and nothing left in hand', (await page.evaluate(() => window.__wh.tool)) === null);
  await page.keyboard.press('z'); await page.waitForTimeout(300);
  check('one undo step takes it off', (await parts()).length === nBefore);
  await page.keyboard.press('Shift+Z'); await page.waitForTimeout(300);

  // ---- 4. Let go off the aircraft, or where it can't go: back in the palette ----
  const n2 = (await parts()).length;
  b = await palCentre('ballast');
  await page.mouse.move(b.x, b.y); await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y + 40, { steps: 6 });   // over the palette, not the view
  await page.mouse.up(); await page.waitForTimeout(300);
  check('let go over the palette: nothing attached, nothing in hand', (await parts()).length === n2 && (await page.evaluate(() => window.__wh.tool)) === null);
  b = await palCentre('tank:hold');
  s = await wingAt(-10);
  await page.mouse.move(b.x, b.y); await page.mouse.down();
  await page.mouse.move(s.x, s.y, { steps: 12 }); await page.waitForTimeout(300);
  await page.mouse.up(); await page.waitForTimeout(300);
  check('a hold tank let go over the wing: back, nothing attached', (await parts()).length === n2 && (await page.evaluate(() => window.__wh.tool)) === null);
  // a plain click on the palette still picks the part up (and a second click puts it back)
  await page.click('.fsw [data-place="ballast"]');
  check('a click still picks a part up', (await page.evaluate(() => window.__wh.tool)) === 'ballast');
  await page.click('.fsw [data-place="ballast"]');
  check('and a second click puts it back', (await page.evaluate(() => window.__wh.tool)) === null);

  // ---- 5. VMC in the readout once designs.js gives it ----
  const vmc = await page.evaluate(() => [...document.querySelectorAll('.fsw [data-n]')].map((e) => e.dataset.n));
  const hasVmc = await page.evaluate(async () => { const D = await import('/games/flight-sim/src/sim/designs.js'); return Number.isFinite(D.designNumbers(D.designDef(window.__wh.design)).vmcKt); });
  if (hasVmc) check('the readout shows the engine-out VMC', vmc.includes('vmc'), vmc.join(' '));
  else console.log('note: designs.js gives no vmcKt yet: no VMC row to check');
  await shot('03-readout');

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
