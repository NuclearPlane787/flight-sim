// v0.5.6: the parts' keys in the Warehouse (Besiege-style keycaps), from the cloud (headless Chromium, SwiftShader,
// 1440×900). v0.5.7 (the file keeps its name): only the block's keys are set there (7–0, U–P, J–;, M–/), each aircraft's
// own. A new A321neo design: an engine clicked on the model opens its keys tab (its own up and down, none to start, and
// the line naming R and F); U on its up key; T refused (not the block's); Shift+J on its down key (the plain J); its
// mirror twin has its own: J there moves from the first, with a note; Backspace clears; the wing has no keys there.
// Discarding the new design drops its keys. A saved design with wing tanks: the drop on Shift+P, an engine's I; Save;
// Duplicate copies them, Delete drops them. A stock 777-300ER's keys-only editor: engines only; the flight flies them.
// The Controls page: every other key, the keyboard drawing (16 keys of the block, 7 grey, the rest the page's), a block
// key refused, 4 for the map, the tooltips and the row's keys lit.
//   python3 tests/cloud/serve.py <GameDump folder> 8765 &
//   node tests/cloud/v056-keys.cjs outDir        (FS_ROOT, default http://127.0.0.1:8765/games/)
const { chromium } = require('playwright');
const ROOT = process.env.FS_ROOT || 'http://127.0.0.1:8765/games/';
const out = process.argv[2] || 'v056-keys';
require('fs').mkdirSync(out, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const ONLY_BLOCK = 'Only the block’s keys here: 7–0, U–P, J–; and M–/';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? ` (${extra})` : ''}`); if (!ok) fails++; };
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('v056-keys')) {
        localStorage.removeItem('gamedump:flight-sim:keys'); localStorage.removeItem('gamedump:flight-sim:designs');
        sessionStorage.setItem('v056-keys', '1');
      }
    } catch { /* none */ }
  });
  await page.goto(ROOT + 'flight-sim/?warehouse=1');
  await page.waitForSelector('.fsm:not([hidden])', { timeout: 120000 });
  // A saved design with a pair of wing tanks, for the drop.
  await page.evaluate(async () => {
    const D = await import('/games/flight-sim/src/sim/designs.js');
    let d = D.newDesign('a321neo', { id: 'dkeys', name: 'Keys test' });
    d = D.addPart(d, { kind: 'tank', mount: 'wing', side: 1, s: 11 }, { mirror: true });
    localStorage.setItem('gamedump:flight-sim:designs', JSON.stringify([d]));
  });
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
  const press = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(200); };

  check('the list shows the stock aircraft, each with Keys', (await page.$$eval('.fsw [data-stock]', (b) => b.map((x) => x.dataset.stock))).join() === 'a321neo,b787-9,b777-300er');
  check('the list’s help names the block', /7–0, U–P, J–; and M–\//.test(await page.$eval('.fsw-listcard .fsm-help', (e) => e.textContent)));

  // ---- 1. A new A321neo design: click an engine on the model ----
  await page.click('.fsw [data-new="a321neo"]');
  await idle();
  const id = await page.evaluate(() => window.__wh.design.id);
  const spots = await page.evaluate(async () => {
    const W = await import('/games/flight-sim/src/ui/warehouse.js');
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
    console.log(`(the clicks missed the engine at ${JSON.stringify(spots)}: selected by hand)`);
    await page.evaluate(() => window.__wh.selectPart('p1')); sel = await page.evaluate(() => window.__wh.selected);
  }
  check('an engine is selected', sel === 'p1' || sel === 'p2', sel);
  const label = await page.$eval('.fsw [data-krow="eng"] .lab', (e) => e.textContent).catch(() => '');
  check('its keys tab: its own thrust, no keys to start', /^Engine [12]: its own thrust$/.test(label) && (await capText('eng:up')) === '·' && (await capText('eng:down')) === '·', label);
  const allLine = await page.$eval('.fsw [data-o="kall"]', (e) => e.textContent).catch(() => '');
  check('and the line naming R and F (the Controls page’s)', /^R and F move all the engines, this one too \(set on the Controls page\)\./.test(allLine), allLine);
  check('no As the others, no Mirror box, no all-engines keycaps', !(await page.$('.fsw [data-a="asOthers"]')) && !(await page.$('.fsw [data-k="twin"]')) && !(await page.$('.fsw [data-cap^="thrustUp"]')));
  await page.click('.fsw [data-cap="eng:up"]');
  check('the keycap waits for a key of the block', (await capText('eng:up')) === 'Press a key' && /block/.test(await kmsg()) && /Esc cancels/.test(await kmsg()), await kmsg());
  await press('KeyU');
  let k = await keys();
  check('U: its own up key, by its part id', JSON.stringify(k.aircraft?.[`design:${id}`]?.engines) === JSON.stringify({ [sel]: { up: 'KeyU', down: null } }), JSON.stringify(k.aircraft));
  check('the tab shows it', (await capText('eng:up')) === 'U');
  await page.click('.fsw [data-cap="eng:down"]');
  await press('KeyT');
  check('T is refused: not the block’s', (await kmsg()).startsWith(ONLY_BLOCK), await kmsg());
  await press('Escape');
  check('Esc cancels (the selection stays)', (await capText('eng:down')) === '·' && (await page.evaluate(() => window.__wh.selected)) === sel && !(await page.evaluate(() => window.__wh.capturing)));
  await page.click('.fsw [data-cap="eng:down"]');
  await press('Shift+KeyJ');
  k = await keys();
  check('Shift+J on its down key: the plain J (a held key)', k.aircraft?.[`design:${id}`]?.engines?.[sel]?.down === 'KeyJ', JSON.stringify(k.aircraft));
  await shot('v057-wh-engine-keys');
  // Its mirror twin has keys of its own: J there moves from the first engine, with a note.
  const twin = await page.evaluate((s) => window.__wh.design.parts.find((p) => p.id === s).pair, sel);
  await page.evaluate((t) => window.__wh.selectPart(t), twin);
  await page.waitForTimeout(200);
  check('its mirror twin: none of its own', (await capText('eng:up')) === '·' && (await capText('eng:down')) === '·');
  await page.click('.fsw [data-cap="eng:up"]');
  await press('KeyJ');
  k = await keys();
  const note = await kmsg();
  check('J on the twin’s up key moves from the first engine’s down, with a note', JSON.stringify(k.aircraft?.[`design:${id}`]?.engines) === JSON.stringify({ [sel]: { up: 'KeyU', down: null }, [twin]: { up: 'KeyJ', down: null } })
    && /^J was the key for engine [12]’s thrust down, which has none now\.$/.test(note), `${note} ${JSON.stringify(k.aircraft)}`);
  await page.click('.fsw [data-cap="eng:up"]');
  await press('Backspace');
  k = await keys();
  check('Backspace clears it', JSON.stringify(k.aircraft?.[`design:${id}`]?.engines) === JSON.stringify({ [sel]: { up: 'KeyU', down: null } }), JSON.stringify(k.aircraft));
  // The wing: no keys here (they're the Controls page's).
  await page.evaluate(() => window.__wh.selectAirframe('wing', 1));
  await page.waitForTimeout(200);
  const wingKeys = await page.$eval('.fsw [data-o="parts"] [data-o="keys"]', (e) => e.textContent).catch(() => '');
  check('the wing’s panel: no keycaps, a line to the Controls page', !(await page.$('.fsw [data-o="parts"] [data-cap]')) && /Controls page, the same for every aircraft/.test(wingKeys), wingKeys);
  // Leaving without saving: the new design is discarded and its keys go with it.
  await press('Escape');
  await page.click('.fsw [data-a="back"]');
  await page.click('.fsw [data-a="discard"]');
  await page.waitForTimeout(300);
  k = await keys();
  check('a new design discarded takes its keys with it', !k.aircraft?.[`design:${id}`], JSON.stringify(Object.keys(k.aircraft || {})));

  // ---- 2. A saved design with wing tanks: the drop, an engine, Save, Duplicate, Delete ----
  await page.click('.fsw .fsm-row[data-id="dkeys"] [data-r="open"]');
  await idle();
  const tank = await page.evaluate(() => window.__wh.design.parts.find((p) => p.kind === 'tank').id);
  await page.click(`.fsw [data-sel="${tank}"]`);
  await page.waitForTimeout(200);
  check('a wing tank’s tab: the drop, unset', (await capText('drop')) === '·' && /Drop the wing tanks/.test(await page.$eval('.fsw [data-krow="drop"] .lab', (e) => e.textContent).catch(() => '')));
  await page.click('.fsw [data-cap="drop"]');
  await press('Shift+KeyP');
  k = await keys();
  check('Shift+P: the design’s drop', k.aircraft?.['design:dkeys']?.drop === 'Shift+KeyP' && (await capText('drop')) === 'Shift+P', JSON.stringify(k.aircraft));
  await shot('v057-wh-tank-drop');
  await page.evaluate(() => window.__wh.selectPart('p1'));
  await page.waitForTimeout(200);
  await page.click('.fsw [data-cap="eng:up"]');
  await press('KeyI');
  await page.click('.fsw [data-a="save"]');
  await page.waitForTimeout(300);
  k = await keys();
  const dk = JSON.stringify(k.aircraft?.['design:dkeys']);
  check('saved, with its drop and engine 1’s I', dk === JSON.stringify({ engines: { p1: { up: 'KeyI', down: null } }, drop: 'Shift+KeyP' }), dk);
  await page.click('.fsw [data-a="back"]');
  await page.waitForTimeout(300);
  await page.click('.fsw .fsm-row[data-id="dkeys"] [data-r="duplicate"]');
  await page.waitForTimeout(300);
  const copyId = await page.evaluate(() => JSON.parse(localStorage.getItem('gamedump:flight-sim:designs')).find((d) => d.id !== 'dkeys')?.id);
  k = await keys();
  check('Duplicate: the copy takes its keys', !!copyId && JSON.stringify(k.aircraft?.[`design:${copyId}`]) === dk, `${copyId} ${JSON.stringify(k.aircraft)}`);
  await page.click(`.fsw .fsm-row[data-id="${copyId}"] [data-r="delete"]`);
  await page.click(`.fsw .fsm-row[data-id="${copyId}"] [data-r="yes"]`);
  await page.waitForTimeout(300);
  k = await keys();
  check('Delete: its keys go, the original keeps its', !k.aircraft?.[`design:${copyId}`] && JSON.stringify(k.aircraft?.['design:dkeys']) === dk, JSON.stringify(Object.keys(k.aircraft || {})));

  // ---- 3. The stock 777-300ER's keys-only editor: its engines only ----
  await page.click('.fsw [data-stock="b777-300er"]');
  await idle();
  const ui = await page.evaluate(() => ({
    keysOnly: window.__wh.keysOnly,
    palette: getComputedStyle(document.querySelector('.fsw [data-o="palette"]')).display,
    save: getComputedStyle(document.querySelector('.fsw [data-a="save"]')).display,
    sliders: document.querySelectorAll('.fsw [data-o="parts"] input[type="range"]').length,
    crumb: document.querySelector('.fsw [data-o="crumb"]').textContent,
    intro: document.querySelector('.fsw [data-o="parts"]').textContent,
  }));
  check('keys only: no palette, no Save, no sliders', ui.keysOnly && ui.palette === 'none' && ui.save === 'none' && ui.sliders === 0 && /777-300ER/.test(ui.crumb), JSON.stringify(ui).slice(0, 200));
  check('it says to click an engine', /Click an engine to give it thrust keys of its own/.test(ui.intro), ui.intro.slice(0, 120));
  // A click on the tailplane picks nothing there now (its keys are the Controls page's).
  const tps = await page.evaluate(async () => {
    const W = await import('/games/flight-sim/src/ui/warehouse.js');
    const O = W.afOutline('b777-300er', window.__wh.design.airframe);
    return [O.tailL, O.tailR].map((P) => { const n = P.length, c = P.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n, a[2] + p[2] / n], [0, 0, 0]); return window.__fsw.project(c[0], c[1], c[2]); });
  });
  for (const at of tps) { await page.mouse.click(at.x, at.y); await page.waitForTimeout(300); }
  check('a click on the tailplane selects nothing', !(await page.evaluate(() => window.__wh.selectedAirframe)) && !(await page.$('.fsw [data-o="parts"] [data-cap]')));
  await page.evaluate(() => window.__wh.selectPart('p2'));
  await page.waitForTimeout(200);
  const lab2 = await page.$eval('.fsw [data-krow="eng"] .lab', (e) => e.textContent).catch(() => '');
  check('its right engine: engine 2, none of its own, no Mirror box', lab2 === 'Engine 2: its own thrust' && (await capText('eng:up')) === '·' && !(await page.$('.fsw [data-k="twin"]')), lab2);
  await page.click('.fsw [data-cap="eng:up"]');
  await press('KeyI');
  await page.click('.fsw [data-cap="eng:down"]');
  await press('KeyK');
  k = await keys();
  check('I and K: the 777-300ER’s engine 2, by index', JSON.stringify(k.aircraft?.['type:b777-300er']) === JSON.stringify({ engines: { 1: { up: 'KeyI', down: 'KeyK' } } }), JSON.stringify(k.aircraft));
  await shot('v057-wh-stock-engine');
  // The flight flies them; the A321neo has none of them.
  const flown = await page.evaluate(() => { window.__fs.useType('b777-300er'); const m = window.__fs.input.keymap; return { i: m.get('KeyI'), k: m.get('KeyK'), r: m.get('KeyR') }; });
  check('the flight in the 777 flies them', flown.i?.kind === 'engine' && flown.i.i === 1 && flown.i.dir === 1 && flown.k?.dir === -1 && flown.r?.id === 'thrustUp', JSON.stringify(flown));
  const a321 = await page.evaluate(() => { window.__fs.useType('a321neo'); const m = window.__fs.input.keymap; return { i: m.get('KeyI'), w: m.get('KeyW') }; });
  check('the A321neo has none of them', !a321.i && a321.w?.id === 'pitchDown', JSON.stringify(a321));

  // ---- 4. The Controls page: every other key, and the keyboard ----
  await press('Escape'); await press('Escape');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => window.__wh.isOpen)) await page.evaluate(() => window.__wh.close());
  await page.evaluate(() => window.__fs.controlsPage.open());
  await page.waitForTimeout(300);
  const cp = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.fsm-controls .fsk-table tr[data-row]')].map((r) => r.dataset.row),
    picker: !!document.querySelector('.fsm-controls select'),
    line: document.querySelector('.fsm-controls .fsk-part')?.textContent || '',
    keys: document.querySelectorAll('.fsm-controls .fskb-k').length,
    block: [...document.querySelectorAll('.fsm-controls .fskb-k.block')].map((g) => g.dataset.code),
    grey: [...document.querySelectorAll('.fsm-controls .fskb-k.grey')].map((g) => g.dataset.code).sort(),
    fixed: document.querySelector('.fsm-controls .fsk-fixed')?.textContent || '',
  }));
  check('the Controls page: all 36 keys, no aircraft picker', cp.rows.length === 36 && !cp.picker && ['thrustUp', 'gear', 'pitchDown', 'flapUp', 'map', 'toga', 'perf'].every((r) => cp.rows.includes(r)) && !cp.rows.includes('dropTanks'), cp.rows.join(' '));
  check('the line about the block', /The block, 7–0, U–P, J–; and M–\//.test(cp.line), cp.line);
  check('the fixed keys: \\ for the Sky window', /^Esc: the menu\. \\ or Cmd\/Ctrl\+L: the Sky window/.test(cp.fixed), cp.fixed);
  check('the keyboard: 54 keys, the block’s 16, 7 grey', cp.keys === 54 && cp.block.length === 16 && cp.block.includes('KeyU') && cp.block.includes('Slash')
    && cp.grey.join() === 'Backquote,Backspace,CapsLock,Enter,ShiftLeft,ShiftRight,Tab', JSON.stringify({ keys: cp.keys, block: cp.block.length, grey: cp.grey }));
  const wide = async () => page.evaluate(() => { const c = document.querySelector('.fsm-controls .fsm-card'); const s = document.querySelector('.fsm-controls .fskb-svg').getBoundingClientRect(); return { sw: c.scrollWidth, cw: c.clientWidth, svgR: s.right, cardR: c.getBoundingClientRect().right }; });
  let w = await wide();
  check('1440×900: no sideways scroll, the drawing inside the card', w.sw <= w.cw + 1 && w.svgR <= w.cardR, JSON.stringify(w));
  await shot('v057-controls-keyboard');
  // A block key refused, 4 for the map; the drawing follows.
  await page.click('.fsm-controls [data-cap="map:0"]');
  await press('KeyU');
  const why = await page.$eval('.fsm-controls [data-o="msg"]', (e) => e.textContent);
  check('U refused on the Controls page, naming the rule', why.startsWith('U is in the warehouse’s block (7–0, U–P, J–;, M–/): set it on a part'), why);
  await press('Digit4');
  k = await keys();
  check('4: the map’s, every aircraft’s', JSON.stringify(k.global?.bind) === '{"map":["Digit4"]}', JSON.stringify(k.global));
  const tip = await page.evaluate(() => ({ four: document.querySelector('.fsm-controls .fskb-k[data-code="Digit4"]').getAttribute('aria-label'), n: document.querySelector('.fsm-controls .fskb-k[data-code="KeyN"]').getAttribute('aria-label'), nFree: document.querySelector('.fsm-controls .fskb-k[data-code="KeyN"]').classList.contains('free') }));
  check('the drawing follows: 4 the map, N free', tip.four === '4: map' && tip.n === 'N: free' && tip.nFree, JSON.stringify(tip));
  // Hovering a row lights its keys; hovering a key shows what it does.
  await page.hover('.fsm-controls tr[data-row="pushback"] td.lab');
  await page.waitForTimeout(150);
  const lit = await page.evaluate(() => ({ lit: document.querySelector('.fsm-controls .fskb-svg').classList.contains('lit'), hl: [...document.querySelectorAll('.fsm-controls .fskb-k.hl')].map((g) => g.dataset.code).sort() }));
  check('the pushback’s row lights G and both Shifts', lit.lit && lit.hl.join() === 'KeyG,ShiftLeft,ShiftRight', JSON.stringify(lit));
  await shot('v057-controls-row-lit');
  await page.hover('.fsm-controls .fskb-k[data-code="KeyW"] rect');
  await page.waitForTimeout(150);
  const tipW = await page.$eval('.fsm-controls .fskb-tip', (e) => (e.hidden ? '' : e.textContent));
  check('hovering W: “W: pitch down”', tipW === 'W: pitch down', tipW);
  await page.hover('.fsm-controls .fskb-k[data-code="KeyL"] rect');
  await page.waitForTimeout(150);
  const tipL = await page.$eval('.fsm-controls .fskb-tip', (e) => (e.hidden ? '' : e.textContent));
  check('hovering L: in the warehouse’s block', tipL === 'L: in the warehouse’s block', tipL);
  await shot('v057-controls-tip');
  // Backspace clears that key; Esc cancels; Reset.
  await page.click('.fsm-controls [data-cap="map:0"]');
  await press('Backspace');
  k = await keys();
  check('Backspace clears it', JSON.stringify(k.global?.bind) === '{"map":[]}', JSON.stringify(k.global));
  await page.click('.fsm-controls [data-cap="gear:0"]');
  await press('Escape');
  check('Esc cancels, the page stays open', (await page.evaluate(() => window.__fs.controlsPage.isOpen)) && !(await page.$('.fsm-controls .fsk-cap.on')));
  await page.click('.fsm-controls [data-k="reset"]');
  await page.waitForTimeout(200);
  k = await keys();
  check('Reset: the defaults (the block’s keys stay)', JSON.stringify(k.global?.bind) === '{}' && !!k.aircraft?.['type:b777-300er'], JSON.stringify(k));
  // Narrower windows: still no sideways scroll.
  for (const [vw, vh] of [[1280, 720], [1024, 700], [760, 640]]) {
    await page.setViewportSize({ width: vw, height: vh });
    await page.waitForTimeout(250);
    w = await wide();
    check(`${vw}×${vh}: no sideways scroll`, w.sw <= w.cw + 1 && w.svgR <= w.cardR + 0.5, JSON.stringify(w));
    if (vw === 1280) await shot('v057-controls-keyboard-1280');
    if (vw === 760) await shot('v057-controls-keyboard-760');
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
