// v0.3.2's checks in headless Chromium, through the real game (main.js), in the cloud container:
// the Weight tab of the L window (the tabs, the fields and their checks, Max, Enter, the keys given
// back to the flight, the live fuel, Esc, skip to final keeping the load, the pause menu's Weight
// and fuel), then Duplicate (the pause menu's Save a copy, Load scenario → Duplicate, and a copy
// flying on from the same point with the same load). Pictures go to outDir as v032-*.png.
//   node weight-copy.cjs [outDir]          (a few minutes with SwiftShader; FS_BASE as in stills.cjs)
// The frame clock is faked (each frame is 0.1 s of sim) and nothing is drawn except for the
// pictures, taken with the game paused quietly, as in route-views.cjs.
const { chromium } = require('playwright');
const snap = require('./snap.cjs');
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
const out = process.argv[2] || 'v032';
require('fs').mkdirSync(out, { recursive: true });
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
(async () => {
  const viewport = { width: 1440, height: 900 };
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    let fake = 1000;
    window.requestAnimationFrame = (cb) => setTimeout(() => { fake += 100; cb(fake); }, 0);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  });
  await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&type=b777-300er`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.dest, null, { timeout: 180000 });
  await page.evaluate(() => { const fs = window.__fs; window.__realRender = fs.renderer.render.bind(fs.renderer); fs.renderer.render = () => {}; });
  await page.waitForTimeout(600);
  const shot = async (name, vp = viewport) => {
    await page.evaluate(() => { window.__fs.setPaused(true, true); window.__fs.renderer.render = window.__realRender; });
    await page.waitForTimeout(300);
    await snap(page, browser, `${out}/${name}.png`, BASE, vp);
    await page.evaluate(() => { window.__fs.renderer.render = () => {}; window.__fs.setPaused(false); });
    await page.waitForTimeout(300);
    console.log('shot', name);
  };
  // The pause menu as it shows: the game is paused already (nothing steps), so no quiet pause.
  const shotMenu = async (name, vp = viewport) => {
    await page.evaluate(() => { window.__fs.renderer.render = window.__realRender; });
    await snap(page, browser, `${out}/${name}.png`, BASE, vp);
    await page.evaluate(() => { window.__fs.renderer.render = () => {}; });
    console.log('shot', name);
  };
  const st = () => page.evaluate(() => { const s = window.__fs.sim.state; return { mass: s.mass, fuel: s.fuelKg, pax: s.paxN, cargo: s.cargoKg, payload: s.payloadKg, added: s.fuelAddedKg, x: s.pos.x, y: s.pos.y, z: s.pos.z, crashed: !!s.crashed }; });
  // v0.4.0: the Weather window (.fssw.fswx) shares the frame too, so the Sky window is the one that's neither.
  const W = '.fslw', S = '.fssw:not(.fslw):not(.fswx)';
  const val = (k) => page.$eval(`${W} [data-f="${k}"]`, (e) => e.value);
  const msg = () => page.$eval(`${W} [data-o="msg"]`, (e) => e.textContent);
  const wins = () => page.evaluate(() => ({ sky: !!window.__fs.skyWin?.isOpen, load: !!window.__fs.loadWin?.isOpen, paused: window.__fs.paused }));

  // ---- The L window's tabs ----
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  let w = await wins();
  ok(w.sky && !w.load, `L opens the Sky window: ${JSON.stringify(w)}`);
  const tabs = await page.$$eval(`${S} .fssw-tab`, (b) => b.map((x) => x.textContent.trim() + (x.classList.contains('on') ? '*' : '')));
  ok(tabs.join('|') === 'Sky*|Weight|Weather', `its tabs: ${tabs.join(' | ')}`);
  await shot('v032-sky-tabs');
  const skyBox = await page.$eval(S, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, b: r.bottom }; });
  await page.click(`${S} [data-tab="load"]`);
  await page.waitForTimeout(200);
  w = await wins();
  ok(!w.sky && w.load, `the Weight tab: the Sky window closes, the Weight window opens: ${JSON.stringify(w)}`);
  const loadBox = await page.$eval(W, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, b: r.bottom, t: r.top }; });
  ok(Math.abs(loadBox.l - skyBox.l) < 1 && Math.abs(loadBox.b - skyBox.b) < 1, `in the same place, bottom-left (${Math.round(loadBox.l)}, ${Math.round(loadBox.b)})`);
  const pfdBottom = await page.evaluate(() => { const p = document.querySelector('.fsui-pfd'); return p ? p.getBoundingClientRect().bottom : 0; });
  ok(loadBox.t >= pfdBottom - 1, `under the PFD (top ${Math.round(loadBox.t)}, PFD bottom ${Math.round(pfdBottom)})`);
  let s0 = await st();
  ok((await val('pax')) === '180' && (await val('cargoKg')) === '2000', `the plan's load to start: ${await val('pax')} pax, ${await val('cargoKg')} kg cargo`);
  // (Both read while paused: the field follows the burn every few frames.)
  const fz = await page.evaluate(() => { const fs = window.__fs; fs.setPaused(true, true); fs.loadWin.update();
    const r = { field: Number(document.querySelector('.fslw [data-f="fuelKg"]').value), fuel: fs.sim.state.fuelKg }; fs.setPaused(false); return r; });
  ok(fz.field === Math.round(fz.fuel), `the fuel as it is: ${fz.field} (${fz.fuel.toFixed(1)})`);

  // The fuel follows the burn until it's edited.
  const f0 = Number(await val('fuelKg'));
  await page.waitForTimeout(2500);
  const f1 = Number(await val('fuelKg'));
  ok(f1 < f0, `the fuel field follows the burn: ${f0} → ${f1}`);

  // A field takes the keys; a problem stops Apply.
  await page.fill(`${W} [data-f="pax"]`, '9999');
  ok(await page.$eval(`${W} [data-a="apply"]`, (b) => b.disabled), 'too many passengers: Apply is off');
  ok(/Passengers: a whole number from 0 to 550/.test(await msg()), `and it says why: "${await msg()}"`);
  await page.fill(`${W} [data-f="pax"]`, '300');
  await page.fill(`${W} [data-f="cargoKg"]`, '5000');
  await page.click(`${W} [data-a="max"]`);
  const maxF = await page.evaluate(() => { const L = window.__fs.sim.type.limits, A = window.__fs.sim.type.data; return Math.round(Math.max(0, Math.min(L.FUEL_MAX, A.FUEL_MAX, L.MTOW - A.OEW - (300 * L.PAX_KG + 5000)))); });
  ok(Number(await val('fuelKg')) === maxF, `Max: the tanks or MTOW, whichever first: ${await val('fuelKg')} (${maxF})`);
  ok(!(await page.$eval(`${W} [data-a="apply"]`, (b) => b.disabled)), 'Apply is on');
  const keysWhileTyping = await page.evaluate(() => window.__fs.rig.view.id);
  await page.focus(`${W} [data-f="cargoKg"]`);
  await page.keyboard.press('2');                 // a flight key, typed into the field
  ok((await page.evaluate(() => window.__fs.rig.view.id)) === keysWhileTyping, 'a key typed in a field stays in the field');
  await page.fill(`${W} [data-f="cargoKg"]`, '5000');
  await shot('v032-weight-tab');
  // Paused quietly around the Apply, so the burn and the flight don't move the numbers between looks.
  await page.evaluate(() => window.__fs.setPaused(true, true));
  s0 = await st();
  await page.press(`${W} [data-f="cargoKg"]`, 'Enter');
  await page.waitForTimeout(200);
  const s1 = await st();
  ok(s1.pax === 300 && s1.cargo === 5000 && Math.abs(s1.payload - (300 * 84 + 5000)) < 1e-6, `Enter applies: ${s1.pax} pax, ${s1.cargo} kg cargo, payload ${s1.payload}`);
  ok(Math.abs(s1.fuel - maxF) < 1 && Math.abs(s1.added - (maxF - s0.fuel)) < 5, `the fuel: ${s1.fuel.toFixed(0)} kg, ${s1.added.toFixed(0)} kg added`);
  ok(Math.hypot(s1.x - s0.x, s1.y - s0.y, s1.z - s0.z) < 1e-6, 'the aircraft stays exactly where it was');
  ok(/^Loaded: [\d,]+ kg, CG [\d.]+ % MAC\.$/.test(await msg()), `it says so: "${await msg()}"`);
  ok(await page.evaluate(() => document.activeElement === document.body), 'the keys are the flight\'s again');
  await page.evaluate(() => window.__fs.setPaused(false));
  await page.keyboard.press('2');
  await page.waitForTimeout(150);
  ok((await page.evaluate(() => window.__fs.rig.view.id)) === 'nose', 'a flight key works (2: the nose view)');
  await page.keyboard.press('1');
  await page.waitForTimeout(150);

  // L closes it and opens the tab last shown; Esc in a field closes it without the pause menu.
  await page.keyboard.press('l'); await page.waitForTimeout(150);
  w = await wins(); ok(!w.sky && !w.load, 'L closes it');
  await page.keyboard.press('l'); await page.waitForTimeout(150);
  w = await wins(); ok(w.load && !w.sky, 'L again: back on the Weight tab');
  ok((await val('pax')) === '300', 'with the new load in the fields');
  await page.click(`${W} [data-f="pax"]`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  w = await wins(); ok(!w.load && !w.paused, `Esc in a field closes it, and no pause menu: ${JSON.stringify(w)}`);

  // A skip to final keeps the load; the pause menu's Weight and fuel opens the tab.
  await page.evaluate(() => window.__fs.skipToFinal());
  await page.waitForTimeout(1500);
  const s2 = await st();
  ok(s2.pax === 300 && s2.cargo === 5000 && Math.abs(s2.payload - s1.payload) < 1e-6 && Math.abs(s2.added - s1.added) < 1e-6, `skip to final keeps it: ${s2.pax} pax, ${s2.payload} kg, ${s2.added.toFixed(0)} added`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const pauseBtns = await page.$$eval('#pause [data-act]', (b) => b.map((x) => x.textContent.trim()));
  ok(pauseBtns.includes('Save a copy') && pauseBtns.includes('Weight and fuel'), `the pause menu: ${pauseBtns.join(', ')}`);
  await shotMenu('v032-pause-menu');
  await page.click('#pause [data-act="weight"]'); await page.waitForTimeout(200);
  w = await wins(); ok(w.load && !w.paused, 'Weight and fuel: the Weight tab, the game running');
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);

  // ---- Duplicate ----
  // This flight as a scenario, as New scenario makes one, then loaded.
  const id = await page.evaluate(() => { const fs = window.__fs; const r = fs.scenarios.create('FL450 test point', fs.captureState(), { route: 'RKSS 14R → RKPC 07', where: 'On final' }); fs.loadScenario(r.id); return r.id; });
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => window.__fs.current?.name) === 'FL450 test point', 'flying the scenario');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);   // the pause saves
  const atPause = await st();
  await page.click('#pause [data-act="copy"]'); await page.waitForTimeout(300);
  const toastText = await page.$eval('#toast', (e) => e.textContent);
  ok(/Saved a copy, “FL450 test point \(copy\)”\. You’re still flying “FL450 test point”\./.test(toastText), `Save a copy: "${toastText}"`);
  const same = await page.evaluate((origId) => {
    const sc = window.__fs.scenarios, list = sc.list(), copy = list.find((e) => e.name === 'FL450 test point (copy)');
    return { names: list.map((e) => e.name), same: !!copy && JSON.stringify(sc.get(copy.id).state) === JSON.stringify(sc.get(origId).state), current: window.__fs.current?.id === origId, type: copy?.type };
  }, id);
  ok(same.same && same.current && same.type === 'b777-300er', `the copy holds the same state, the 777, and the flight stays the original's: ${JSON.stringify(same)}`);

  // Load scenario → Duplicate, in the menu.
  await page.click('#pause [data-act="menu"]'); await page.waitForTimeout(500);
  await page.click('.fsm [data-k="load"]'); await page.waitForTimeout(300);
  const rowsBefore = await page.$$eval('.fsm-row', (r) => r.map((x) => x.querySelector('b').textContent));
  const origRow = `.fsm-row[data-id="${id}"]`;
  ok((await page.$$eval(`${origRow} .fsm-row-act button`, (b) => b.map((x) => x.textContent))).join(',') === 'Load,Rename,Duplicate,Delete', 'each row: Load, Rename, Duplicate, Delete');
  await page.click(`${origRow} [data-r="duplicate"]`); await page.waitForTimeout(300);
  const rowsAfter = await page.$$eval('.fsm-row', (r) => r.map((x) => x.querySelector('b').textContent));
  const note = await page.$eval('.fsm [data-o="loadMsg"]', (e) => e.textContent);
  ok(rowsAfter.length === rowsBefore.length + 1 && rowsAfter[0] === 'FL450 test point (copy 2)', `Duplicate: ${rowsBefore.join(', ')} → ${rowsAfter.join(', ')}`);
  ok(/Copied as “FL450 test point \(copy 2\)”/.test(note), `and the note: "${note}"`);
  ok(await page.evaluate(() => document.activeElement?.closest?.('.fsm-row')?.querySelector('b')?.textContent) === 'FL450 test point (copy 2)', 'the new row has the focus');
  await shot('v032-duplicate-list');

  // Fly the first copy: the same point, the same load, a scenario of its own.
  // (Loaded and read in one go: the faked frames would fly it on before a second look.)
  const copyId = await page.evaluate(() => window.__fs.scenarios.list().find((e) => e.name === 'FL450 test point (copy)').id);
  const s3 = await page.evaluate((cid) => {
    const fs = window.__fs; fs.loadScenario(cid); fs.setPaused(true, true);
    const s = fs.sim.state; return { x: s.pos.x, y: s.pos.y, z: s.pos.z, pax: s.paxN, cargo: s.cargoKg, added: s.fuelAddedKg, name: fs.current?.name };
  }, copyId);
  await page.evaluate(() => window.__fs.setPaused(false));
  ok(s3.name === 'FL450 test point (copy)', 'flying the copy');
  ok(Math.hypot(s3.x - atPause.x, s3.y - atPause.y) < 30 && Math.abs(s3.z - atPause.z) < 3, `from the original's point (${Math.hypot(s3.x - atPause.x, s3.y - atPause.y).toFixed(1)} m)`);
  ok(s3.pax === 300 && s3.cargo === 5000 && Math.abs(s3.added - atPause.added) < 1e-6, `with its load: ${s3.pax} pax, ${s3.cargo} kg, ${s3.added.toFixed(0)} kg added`);
  await page.keyboard.press('l'); await page.waitForTimeout(150);
  ok((await val('pax')) === '300', 'the Weight tab shows the copy\'s load');
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);

  // A short window (1280x720): the pause menu and the Weight tab still fit.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);
  await page.keyboard.press('l'); await page.waitForTimeout(200);
  const small = await page.evaluate(() => { const r = document.querySelector('.fslw').getBoundingClientRect(), p = document.querySelector('.fsui-pfd')?.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, pfd: p ? p.bottom : 0 }; });
  ok(small.bottom <= 720 && small.top >= small.pfd - 1, `1280x720: the Weight tab fits under the PFD (${Math.round(small.top)}–${Math.round(small.bottom)}, PFD to ${Math.round(small.pfd)})`);
  await shot('v032-weight-tab-720', { width: 1280, height: 720 });
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  const pm = await page.$eval('#pause', (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, sh: e.scrollHeight, ch: e.clientHeight }; });
  ok(pm.top >= 0 && pm.bottom <= 720, `1280x720: the pause menu fits (${Math.round(pm.top)}–${Math.round(pm.bottom)})`);
  await shotMenu('v032-pause-menu-720', { width: 1280, height: 720 });

  ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
