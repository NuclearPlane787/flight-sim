// v0.5.6: the parts' keys in the Warehouse (Besiege-style keycaps), from the cloud (headless Chromium, SwiftShader,
// 1440×900). A new A321neo design: an engine clicked on the model opens its keys tab (R/F, as the others, and the
// all-engines row); its up keycap and U make it and its twin a group (the down key unbound); T is refused (the rewind's,
// a global key); Esc cancels. Discarding the new design drops its keys. A stock 777-300ER's keys-only editor (no palette,
// no Save): its tailplane's pitch-down keycap and I; the flight flies it. The Controls page shows only the global keys.
//   python3 tests/cloud/serve.py <GameDump folder> 8765 &
//   node tests/cloud/v056-keys.cjs outDir        (FS_ROOT, default http://127.0.0.1:8765/games/)
const { chromium } = require('playwright');
const ROOT = process.env.FS_ROOT || 'http://127.0.0.1:8765/games/';
const out = process.argv[2] || 'v056-keys';
require('fs').mkdirSync(out, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? ` (${extra})` : ''}`); if (!ok) fails++; };
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('v056-keys')) { localStorage.removeItem('gamedump:flight-sim:keys'); sessionStorage.setItem('v056-keys', '1'); } } catch { /* none */ } });
  await page.goto(ROOT + 'flight-sim/?warehouse=1');
  await page.waitForSelector('.fsm:not([hidden])', { timeout: 120000 });
  await page.click('[data-k="warehouse"]');
  await page.waitForSelector('.fsw:not([hidden])');
  const idle = async () => {
    await page.waitForFunction(() => { const m = document.querySelector('.fsw [data-o="viewMsg"]'); return m && m.hidden && window.__fsw && window.__fsw.view && !window.__fsw.busy; }, null, { timeout: 120000 });
    await page.waitForTimeout(400);
  };
  const shot = async (name) => { try { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); } catch (err) { console.log('no picture', name, String(err).slice(0, 80)); } };
  const keys = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__fs.keys)));
  const kmsg = () => page.$eval('.fsw [data-o="parts"] [data-o="kmsg"]', (e) => e.textContent).catch(() => '');
  const capText = (cap) => page.$eval(`.fsw [data-cap="${cap}"]`, (e) => e.textContent.trim()).catch(() => null);

  // The stock aircraft are listed, each with its Keys.
  check('the list shows the stock aircraft, each with Keys', (await page.$$eval('.fsw [data-stock]', (b) => b.map((x) => x.dataset.stock))).join() === 'a321neo,b787-9,b777-300er');

  // ---- 1. A new A321neo design: click an engine on the model ----
  await page.click('.fsw [data-new="a321neo"]');
  await idle();
  const id = await page.evaluate(() => window.__wh.design.id);
  // The engine's nacelle on the model: its inlet, then its middle (the first the click picks).
  const spots = await page.evaluate(async () => {
    const W = await import('/games/flight-sim/src/ui/warehouse.js');
    // each engine's (the far one may be behind the fuselage from where the camera starts)
    return W.partBoxes(window.__wh.design).filter((x) => x.kind === 'engine')
      .flatMap((b) => [0.7, 0, -0.5].map((f) => window.__fsw.project(b.x + f * b.hx, b.y, b.z)));
  });
  let sel = null;
  for (const at of spots) {
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(400);
    sel = await page.evaluate(() => window.__wh.selected);
    if (sel) break;
  }
  if (!sel) {
    console.log(`(the clicks missed the engine at ${JSON.stringify(spots)}: selected from the list)`);
    await page.evaluate(() => window.__wh.selectAirframe(null));
    await page.click('.fsw [data-sel="p1"]'); sel = await page.evaluate(() => window.__wh.selected);
  }
  check('an engine is selected', sel === 'p1' || sel === 'p2', sel);
  const row0 = await page.$eval('.fsw [data-krow="eng"] .lab', (e) => e.textContent).catch(() => '');
  check('its keys tab: as the others, R and F', /as the others/.test(row0) && (await capText('eng:up')) === 'R' && (await capText('eng:down')) === 'F', row0);
  check('and the all-engines row', (await capText('thrustUp:0')) === 'R' && (await capText('thrustDown:0')) === 'F');
  await shot('v056-keys-engine');
  // Its up keycap, then U.
  await page.click('.fsw [data-cap="eng:up"]');
  check('the keycap waits for a key', (await capText('eng:up')) === 'Press a key' && /Esc cancels/.test(await kmsg()), await kmsg());
  await page.keyboard.press('KeyU');
  await page.waitForTimeout(200);
  let k = await keys();
  const g = k.scopes[`design:${id}`]?.groups;
  check('U: the engine and its twin are a group, its down key unbound', JSON.stringify(g) === JSON.stringify([{ engines: [0, 1], up: 'KeyU', down: null }]), JSON.stringify(g));
  check('the tab shows it', (await capText('eng:up')) === 'U' && /its own/.test(await page.$eval('.fsw [data-krow="eng"] .lab', (e) => e.textContent)));
  check('an As the others button', !!(await page.$('.fsw [data-a="asOthers"]')));
  // T is the rewind's (a global key): refused, naming it; Esc cancels.
  await page.click('.fsw [data-cap="eng:down"]');
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(200);
  const refused = await kmsg();
  check('T is refused, naming the rewind and the Controls page', /T is the key for rewind: change it on the Controls page/.test(refused), refused);
  await shot('v056-keys-refused');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('Esc cancels (the selection stays)', (await capText('eng:down')) === '·' && (await page.evaluate(() => window.__wh.selected)) === sel && !(await page.evaluate(() => window.__wh.capturing)));
  // Not part of the design's undo; Backspace clears.
  await page.click('.fsw [data-cap="eng:up"]');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  k = await keys();
  check('Backspace clears it (the group stays: As the others puts it back)', k.scopes[`design:${id}`]?.groups?.[0]?.up === null, JSON.stringify(k.scopes[`design:${id}`]));
  await page.click('.fsw [data-a="asOthers"]');
  await page.waitForTimeout(200);
  k = await keys();
  check('As the others: no group left', !(k.scopes[`design:${id}`]?.groups || []).length, JSON.stringify(k.scopes[`design:${id}`]));
  // The wing tab (the airframe): the ailerons' A, the flaps' −.
  await page.evaluate(() => window.__wh.selectAirframe('wing', 1));
  await page.waitForTimeout(200);
  check('the wing’s tab: A, −, the detents unbound', (await capText('rollLeft:0')) === 'A' && (await capText('flapUp:0')) === '−' && (await capText('flap0:0')) === '·');
  await page.click('.fsw [data-cap="flap0:0"]');
  await page.keyboard.press('KeyG');   // the gear's (the fuselage's): it moves, the gear says so
  await page.waitForTimeout(200);
  k = await keys();
  check('G moves from the gear to the flaps’ first detent, with a note', JSON.stringify(k.scopes[`design:${id}`]?.bind?.flap0) === '["KeyG"]' && JSON.stringify(k.scopes[`design:${id}`]?.bind?.gear) === '[]' && /G was the gear’s: now it has no key/.test(await kmsg()), await kmsg());
  // Leaving without saving: the new design is discarded and its keys go with it.
  await page.keyboard.press('Escape');   // the selection
  await page.click('.fsw [data-a="back"]');
  await page.click('.fsw [data-a="discard"]');
  await page.waitForTimeout(300);
  k = await keys();
  check('a new design discarded takes its keys with it', !k.scopes[`design:${id}`], JSON.stringify(Object.keys(k.scopes)));

  // ---- 2. The stock 777-300ER's keys-only editor ----
  await page.click('.fsw [data-stock="b777-300er"]');
  await idle();
  const ui = await page.evaluate(() => ({
    keysOnly: window.__wh.keysOnly,
    palette: getComputedStyle(document.querySelector('.fsw [data-o="palette"]')).display,
    save: getComputedStyle(document.querySelector('.fsw [data-a="save"]')).display,
    sliders: document.querySelectorAll('.fsw [data-o="parts"] input[type="range"]').length,
    crumb: document.querySelector('.fsw [data-o="crumb"]').textContent,
  }));
  check('keys only: no palette, no Save, no sliders', ui.keysOnly && ui.palette === 'none' && ui.save === 'none' && ui.sliders === 0 && /777-300ER/.test(ui.crumb), JSON.stringify(ui));
  // Its tailplane, clicked on the model (or picked by hand if the click misses).
  const tps = await page.evaluate(async () => {
    const W = await import('/games/flight-sim/src/ui/warehouse.js');
    const O = W.afOutline('b777-300er', window.__wh.design.airframe);
    return [O.tailL, O.tailR].map((P) => { const n = P.length, c = P.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n, a[2] + p[2] / n], [0, 0, 0]); return window.__fsw.project(c[0], c[1], c[2]); });
  });
  let af = null;
  for (const at of tps) {
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(400);
    af = await page.evaluate(() => window.__wh.selectedAirframe);
    if (af?.what === 'tailplane') break;
  }
  if (af?.what !== 'tailplane') { console.log(`(the click picked ${JSON.stringify(af)}: the tailplane picked by hand)`); await page.evaluate(() => window.__wh.selectAirframe('tailplane', 1)); af = await page.evaluate(() => window.__wh.selectedAirframe); }
  check('the tailplane’s tab: W, S, and the 777’s trim Y and H', (await capText('pitchDown:0')) === 'W' && (await capText('pitchUp:0')) === 'S' && (await capText('trimDown:0')) === 'Y' && (await capText('trimUp:0')) === 'H');
  check('and no sliders', (await page.$$('.fsw [data-o="parts"] input[type="range"]')).length === 0);
  await page.click('.fsw [data-cap="pitchDown:0"]');
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(200);
  k = await keys();
  check('I: the 777-300ER’s pitch down', JSON.stringify(k.scopes['type:b777-300er']?.bind) === '{"pitchDown":["KeyI"]}', JSON.stringify(k.scopes['type:b777-300er']));
  await page.click('.fsw [data-cap="pitchUp:1"]');   // the + after S: a second key
  await page.keyboard.press('KeyK');                 // the local QNH's (global): refused
  await page.waitForTimeout(150);
  const whyK = await kmsg();
  await page.keyboard.press('Shift+KeyJ');           // a held control takes the plain key
  await page.waitForTimeout(200);
  k = await keys();
  check('+ then K: refused (the local QNH’s)', /K is the key for the local QNH: change it on the Controls page/.test(whyK), whyK);
  check('then Shift+J: a second pitch-up key, J', JSON.stringify(k.scopes['type:b777-300er']?.bind?.pitchUp) === '["KeyS","KeyJ"]', JSON.stringify(k.scopes['type:b777-300er']));
  await shot('v056-keys-stock-tailplane');
  // An engine of the stock aircraft: its Mirror (the twin takes the same keys).
  await page.evaluate(() => window.__wh.selectAirframe(null));
  const intro = await page.$eval('.fsw [data-o="parts"]', (e) => e.textContent);
  check('nothing selected: the stock editor says to click a part', /Click a part to set its keys/.test(intro) && !(await page.$('.fsw [data-sel]')), intro.slice(0, 80));
  // The flight flies the 777's keys.
  const flown = await page.evaluate(() => { window.__fs.useType('b777-300er'); const m = window.__fs.input.keymap; return { i: m.get('KeyI'), j: m.get('KeyJ'), w: m.get('KeyW') }; });
  check('the flight in the 777 flies them', flown.i?.id === 'pitchDown' && flown.j?.id === 'pitchUp' && !flown.w, JSON.stringify(flown));
  const a321 = await page.evaluate(() => { window.__fs.useType('a321neo'); const m = window.__fs.input.keymap; return { i: m.get('KeyI'), w: m.get('KeyW') }; });
  check('the A321neo keeps its own', !a321.i && a321.w?.id === 'pitchDown', JSON.stringify(a321));

  // ---- 3. The Controls page: the global keys only ----
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => window.__wh.isOpen)) await page.evaluate(() => window.__wh.close());
  await page.evaluate(() => window.__fs.controlsPage.open());
  await page.waitForTimeout(300);
  const cp = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.fsm-controls .fsk-table tr[data-row]')].map((r) => r.dataset.row),
    picker: !!document.querySelector('.fsm-controls select'),
    line: document.querySelector('.fsm-controls .fsk-part')?.textContent || '',
  }));
  check('the Controls page: the 14 global keys, no aircraft picker, no engine groups', cp.rows.length === 14 && !cp.picker && !cp.rows.includes('thrustUp') && !cp.rows.includes('gear') && cp.rows.includes('map') && cp.rows.includes('toga'), cp.rows.join(' '));
  check('and the line pointing to the warehouse', /set them in the warehouse by clicking a part/.test(cp.line), cp.line);
  // A part's key is refused there, naming it.
  await page.click('.fsm-controls tr[data-row="map"] [data-b="change"]');
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(200);
  const why = await page.$eval('.fsm-controls [data-o="msg"]', (e) => e.textContent);
  check('I is refused on the Controls page: the 777-300ER’s pitch down', /I is the key for pitch down, on the tailplane on the 777-300ER/.test(why), why);
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(200);
  k = await keys();
  check('N: the map’s, every aircraft’s', JSON.stringify(k.global?.bind) === '{"map":["KeyN"]}', JSON.stringify(k.global));
  await shot('v056-keys-controls');
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
