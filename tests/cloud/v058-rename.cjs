// v0.5.8: a design's name is a live reference (Shane: "when I change the name in the warehouse, all appearances of that
// name in the game should automatically update"). Through the real game in headless Chromium (SwiftShader, 1440×900):
// a design "Alpha" is made, flown in a scenario and saved, two flights are logged with it (one as main.js writes them,
// with the design's id, and one as an older entry without it), then it's renamed "Bravo" in the warehouse's list and
// saved. Every place that names a design is read: the warehouse's list, the home page's ticket card, Load scenario, the
// logbook's rows and its filter, the New scenario picker, and the resumed flight (the Esc menu, its New flight card, its
// scoped logbook, what a save writes). Then a rename while the flight is in memory ("Charlie"), and last the design
// deleted: each place falls back to the name it stored.
//   python3 tests/cloud/serve.py <GameDump folder> 8765 &
//   NODE_PATH=/opt/node-tools/node_modules node tests/cloud/v058-rename.cjs outDir      (FS_BASE: the game's URL)
const { chromium } = require('playwright');
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
const SRC = new URL('src/', BASE).pathname;   // the modules, for imports in the page
const out = process.argv[2] || 'v058-rename';
require('fs').mkdirSync(out, { recursive: true });
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  // Each frame is 0.1 s of sim, and nothing is drawn (as weight-copy.cjs).
  await page.addInitScript(() => {
    let fake = 1000;
    window.requestAnimationFrame = (cb) => setTimeout(() => { fake += 100; cb(fake); }, 0);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  });
  await page.goto(BASE);
  await page.waitForSelector('.fsm:not([hidden])', { timeout: 180000 });
  await page.evaluate(() => { const fs = window.__fs; fs.renderer.render = () => {}; });
  const shot = async (name) => { try { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); } catch (e) { console.log('no picture:', String(e).split('\n')[0]); } };
  const text = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.replace(/\s+/g, ' ').trim()), sel);
  const has = (list, s) => list.some((t) => t.includes(s));

  // ---- A design "Alpha", flown in a scenario and saved ----
  const design = await page.evaluate(async (src) => {
    const { DesignStore } = await import(src + 'designs-store.js');
    return new DesignStore(localStorage).create('a321neo', { name: 'Alpha' }).design;
  }, SRC);
  ok(design && design.name === 'Alpha', `a design "Alpha" (${design?.id})`);
  await page.evaluate((d) => { window.__fs.newScenario(d); }, design);
  await page.waitForSelector('.fsui-setup:not([hidden])', { timeout: 30000 });
  await page.click('.fsui-setup [data-a="fly"]', { timeout: 120000 });
  await page.waitForFunction(() => window.__fs.sim.design?.name === 'Alpha' && !window.__fs.inMenu && window.__fs.current, null, { timeout: 180000 });
  const scen = await page.evaluate(() => ({ ...window.__fs.current }));
  ok(await page.evaluate(() => window.__fs.saveNow('save')), `flying "Alpha" in "${scen.name}", saved`);
  // Two flights in the logbook: as main.js's showScore() writes one (with designId), and one from before (without it);
  // and one in a design that's gone ("Ghost").
  await page.evaluate(async ({ src, d, scen }) => {
    const store = await import(src + 'store.js');
    const base = { version: '0.5.7', type: 'a321neo', engines: '2 × LEAP-1A', scenarioId: scen.id, scenarioName: scen.name, route: 'RKSS–RKPC', depRunway: '14R', arrRunway: '07', airTimeS: 3000, fuelUsedKg: 3000, score: { points: 80, grade: 'B', parts: [] } };
    store.addLogEntry({ ...base, date: new Date(Date.now() - 3e5).toISOString(), design: d.name, designId: d.id });
    store.addLogEntry({ ...base, date: new Date(Date.now() - 2e5).toISOString(), design: d.name });   // older: no designId
    store.addLogEntry({ ...base, date: new Date(Date.now() - 1e5).toISOString(), design: 'Ghost', designId: 'dgone', scenarioId: 'sgone', scenarioName: 'Old scenario' });
  }, { src: SRC, d: design, scen });
  await page.evaluate(() => window.__fs.exitToMenu());
  await page.waitForSelector('.fsm:not([hidden])');
  ok(has(await text('.fsm [data-o="cardSub"]'), 'Alpha'), `before the rename, the home card says Alpha: ${(await text('.fsm [data-o="cardSub"]'))[0]}`);

  // ---- Renamed "Bravo" in the warehouse (its list's Rename, then Save) ----
  await page.click('.fsm [data-k="warehouse"]');
  await page.waitForSelector('.fsw:not([hidden]) .fsm-row', { timeout: 60000 });
  await page.click(`.fsw .fsm-row[data-id="${design.id}"] [data-r="rename"]`);
  await page.fill(`.fsw .fsm-row[data-id="${design.id}"] [data-r="name"]`, 'Bravo');
  await page.click(`.fsw .fsm-row[data-id="${design.id}"] [data-r="save"]`);
  await page.waitForTimeout(300);
  const wl = await text('.fsw .fsm-row');
  ok(has(wl, 'Bravo') && !has(wl, 'Alpha'), `the warehouse's list: ${wl.join(' | ').slice(0, 120)}`);
  await shot('01-warehouse');
  await page.click('.fsw [data-a="top"]');
  await page.waitForSelector('.fsw', { state: 'hidden' });
  await page.waitForTimeout(300);

  // The places, after the rename. `want` is the name each should show, `not` the one it mustn't.
  const places = async (want, not, tag) => {
    // The home page's ticket card
    const card = await text('.fsm [data-o="cardSub"]');
    ok(has(card, want) && !has(card, not), `${tag}: the home card: ${card[0]}`);
    // Load scenario
    await page.click('.fsm [data-k="load"]'); await page.waitForTimeout(200);
    const rows = await text(`.fsm .fsm-row[data-id="${scen.id}"] .fsm-row-main`);
    ok(has(rows, want) && !has(rows, not), `${tag}: Load scenario: ${rows[0]}`);
    await page.click('.fsm [data-k="back"]'); await page.waitForTimeout(200);
    // The logbook from the main menu: its rows and its filter
    await page.click('.fsm [data-k="logbook"]');
    await page.waitForSelector('.fslb:not([hidden])');
    const lrows = await text('.fslb .fslb-row[data-i] .type');
    const mine = lrows.filter((t) => !t.includes('Ghost'));
    ok(mine.length === 2 && mine.every((t) => t.includes(want) && !t.includes(not)), `${tag}: the logbook's rows (with and without the design's id): ${mine.join(' | ')}`);
    ok(has(lrows, 'Ghost'), `${tag}: a deleted design's flight keeps its stored name: ${lrows.find((t) => t.includes('Ghost'))}`);
    const opts = await text('.fslb [data-o="filter"] option');
    ok(!has(opts, not), `${tag}: the logbook's filter (scenario names): ${opts.join(' | ')}`);
    await shot(`02-logbook-${tag}`);
    await page.click('.fslb [data-k="close"]'); await page.waitForTimeout(200);
  };
  await places('Bravo', 'Alpha', 'renamed');
  await shot('03-home');

  // The New scenario picker
  await page.click('.fsm [data-k="new"]');
  await page.waitForSelector('.fsui-setup:not([hidden])');
  const picker = await text('.fsui-setup [data-design]');
  ok(has(picker, 'Bravo') && !has(picker, 'Alpha'), `the New scenario picker: ${picker.join(' | ').slice(0, 100)}`);
  await page.click('.fsui-setup [data-a="cancel"]');
  await page.waitForSelector('.fsm:not([hidden])');

  // ---- The resumed flight ----
  await page.click('.fsm [data-k="continue"]');
  await page.waitForFunction(() => !window.__fs.inMenu && window.__fs.sim.design, null, { timeout: 180000 });
  await page.waitForTimeout(500);
  const inFlight = async (want, not, tag) => {
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    const menuText = (await text('#pause'))[0] || '';
    ok(!menuText.includes(not), `${tag}: the Esc menu (${menuText.slice(0, 60)}…) doesn't say ${not}`);
    // Its New flight: the scenario's own design, on a card
    await page.click('#pause [data-act="setup"]');
    await page.waitForSelector('.fsui-setup:not([hidden])');
    const card = (await text('.fsui-setup .fsui-dc'))[0] || '';
    const head = (await text('.fsui-setup [data-o="sub"], .fsui-setup h2, .fsui-setup h3'))[0] || '';
    ok(card.includes(want) && !card.includes(not) && !head.includes(not), `${tag}: the flight's New flight card: ${card.slice(0, 60)}`);
    await shot(`04-new-flight-${tag}`);
    await page.click('.fsui-setup [data-a="cancel"]'); await page.waitForTimeout(300);
    // Its own logbook (the Esc menu's)
    if (!(await page.evaluate(() => !document.querySelector('#pause').hidden))) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    await page.click('#pause [data-act="logbook"]');
    await page.waitForSelector('.fslb:not([hidden])');
    const lrows = await text('.fslb .fslb-row[data-i] .type');
    ok(lrows.length === 2 && lrows.every((t) => t.includes(want) && !t.includes(not)), `${tag}: the flight's logbook: ${lrows.join(' | ')}`);
    await page.click('.fslb [data-k="close"]'); await page.waitForTimeout(200);
    if (await page.evaluate(() => !document.querySelector('#pause').hidden)) await page.click('#pause [data-act="resume"]');
    await page.waitForTimeout(200);
    // Nothing on the page names the old name
    const body = await page.evaluate(() => document.body.innerText);
    ok(!body.includes(not), `${tag}: nothing shown says ${not}`);
    // What a save writes: the Load list's summary, and the saved state's copy of the design
    await page.evaluate(() => window.__fs.saveNow('save'));
    const saved = await page.evaluate((id) => { const e = window.__fs.scenarios.entry(id), r = window.__fs.scenarios.get(id); return { summary: e.summary.design, state: r.state.sim.design.name }; }, scen.id);
    ok(saved.summary === want && saved.state === want, `${tag}: a save writes ${want}: ${JSON.stringify(saved)}`);
  };
  await inFlight('Bravo', 'Alpha', 'resumed');

  // ---- Renamed while the flight is in memory ("Charlie"): the warehouse's store, as its Rename does it ----
  await page.evaluate(async ({ src, id }) => { const { DesignStore } = await import(src + 'designs-store.js'); new DesignStore(localStorage).rename(id, 'Charlie'); }, { src: SRC, id: design.id });
  await inFlight('Charlie', 'Bravo', 'in memory');
  await page.evaluate(() => window.__fs.exitToMenu());
  await page.waitForSelector('.fsm:not([hidden])');
  await places('Charlie', 'Bravo', 'in memory');

  // ---- The design deleted: each place falls back to the name it stored ----
  await page.click('.fsm [data-k="warehouse"]');
  await page.waitForSelector('.fsw:not([hidden]) .fsm-row', { timeout: 60000 });
  await page.click(`.fsw .fsm-row[data-id="${design.id}"] [data-r="delete"]`);
  await page.click(`.fsw .fsm-row[data-id="${design.id}"] [data-r="yes"]`);
  await page.waitForTimeout(300);
  ok(!(await page.evaluate((id) => !!document.querySelector(`.fsw .fsm-row[data-id="${id}"]`), design.id)), 'deleted from the warehouse');
  await page.click('.fsw [data-a="top"]');
  await page.waitForSelector('.fsw', { state: 'hidden' });
  await page.waitForTimeout(300);
  // The scenarios stored Charlie (renameDesign's copy and the last save); the logbook's entries the name they were
  // written with, or their scenario's when it still flies that design.
  await places('Charlie', 'Bravo', 'deleted');
  await shot('05-deleted');
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
