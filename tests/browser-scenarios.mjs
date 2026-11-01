// v0.2.0's scripted check of the main menu and scenarios (V020.md → Definition of done, Part 1),
// in Chrome on this Mac's GPU with its own temporary profile (never Shane's):
//   1. the page loads to the main menu, with a still, no console errors, and no frames rendered behind it;
//   2. New scenario "Test A" from RKSS 14R: take off, AP on, Exit to menu;
//   3. New scenario "Test B" from a Jeju gate: start the pushback, Exit to menu;
//   4. Load "Test A": exactly where it was, flies on; skip to final, land with tests/e2e-controller.js;
//      the score has its approach parts, and the logbook entry is tagged "Test A";
//   5. Load "Test B": the pushback carries on;
//   6. Continue picks the newest; rename and delete work; a reload keeps it all;
//   7. with only v0.1.4's keys in storage, "Scenario 1" appears with the old logbook under it.
// Screenshots (v020-*.png) in Claude outputs/flight-sim/. Run from GameDump's root, through the guard:
//   python3 games/flight-sim/tools/cpu-guard.py -- node games/flight-sim/tests/browser-scenarios.mjs
// Env: FS_URL (default http://localhost:8014/games/flight-sim/).

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FS_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const URL0 = process.env.FS_URL || 'http://localhost:8014/games/flight-sim/';
const FT = 3.28084, KT = 1.943844;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [];
let page;
const shot = (name) => page.screenshot({ path: path.join(OUT, `v020-${name}.png`) });
const st = () => page.evaluate(() => {
  const fs = window.__fs, s = fs.sim.state;
  return { t: s.t, x: s.pos.x, y: s.pos.y, z: s.pos.z, vx: s.vel.x, vy: s.vel.y, vz: s.vel.z, ias: s.ias, agl: s.agl,
    onGround: s.onGround, pitch: s.pitch, roll: s.roll, hdg: s.hdg, fuel: s.fuelKg, crashed: s.crashed,
    ap: fs.ap.ap, apHdg: fs.ap.hdgDeg, apAlt: fs.ap.altFt, phase: fs.gate.phase, paused: fs.paused, inMenu: fs.inMenu };
});
const waitFor = async (fn, ms, label) => {
  const t0 = Date.now();
  for (;;) {
    const s = await st();
    if (fn(s)) return s;
    if (s.crashed) throw new Error(`crashed while waiting for ${label}: ${s.crashed}`);
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}: ${JSON.stringify(s)}`);
    await page.waitForTimeout(200);
  }
};
async function openPage(url = URL0) {
  page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.__fs && window.__fs.inMenu, null, { timeout: 90000 });
  await page.addScriptTag({ content: readFileSync(path.join(here, 'e2e-controller.js'), 'utf8') });
}
async function newScenario(name, { origin, dep, dest, arr, start, stand }) {
  await page.click('.fsm-nav [data-k="new"]');
  await page.waitForSelector('.fsui-setup:not([hidden])');
  await page.fill('[data-f="name"]', name);
  await page.selectOption('[data-f="origin"]', origin);
  if (dep) await page.selectOption('[data-f="depRunway"]', dep);
  await page.selectOption('[data-f="dest"]', dest);
  await page.selectOption('[data-f="arrRunway"]', arr);
  await page.click(`[data-seg="start"] button[data-v="${start}"]`);
  if (stand) await page.selectOption('[data-f="stand"]', stand);
  await page.click('[data-a="fly"]');
  await page.waitForFunction(() => !window.__fs.inMenu && !window.__fs.paused, null, { timeout: 30000 });
}
async function exitToMenu() {
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pause:not([hidden])');
  await page.click('#pause [data-act="menu"]');
  await page.waitForFunction(() => window.__fs.inMenu, null, { timeout: 10000 });
}
async function loadByName(name) {
  await page.click('.fsm-nav [data-k="load"]');
  await page.waitForSelector('.fsm-load:not([hidden])');
  const row = page.locator('.fsm-row', { hasText: name }).first();
  await row.locator('[data-r="load"]').click();
  await page.waitForFunction(() => !window.__fs.inMenu, null, { timeout: 30000 });
}
const same = (a, b, keys, tol = 0) => keys.every((k) => (typeof a[k] === 'number' ? Math.abs(a[k] - b[k]) <= tol : a[k] === b[k]));

try {
  // ---- 1. The main menu ----
  await openPage();
  const bg = await page.evaluate(() => {
    const el = document.querySelector('#menu-root'), cs = [...el.querySelectorAll('*')].map((e) => getComputedStyle(e).backgroundImage).find((b) => b && b.includes('url('));
    return cs || '';
  });
  check('menu shows a still', /assets\/menu\/.+\.jpg/.test(bg), bg.slice(0, 120));
  const f0 = await page.evaluate(() => window.__fs.frames);
  await page.waitForTimeout(3000);
  const f1 = await page.evaluate(() => window.__fs.frames);
  check('nothing renders behind the menu', f1 === f0, `${f1 - f0} frames in 3 s (renderer frame counter ${f0} → ${f1})`);
  await page.waitForTimeout(800);
  await shot('main-menu-empty');

  // ---- 2. Test A: RKSS 14R, take off, AP on ----
  await newScenario('Test A', { origin: 'RKSS', dep: '14R', dest: 'RKPC', arr: '07', start: 'runway' });
  check('Test A created and current', (await page.evaluate(() => window.__fs.current?.name)) === 'Test A');
  await page.evaluate(() => {
    const fs = window.__fs, r = fs.runwayEnds('RKSS', '14R'), ax = fs.runwayAxis(r.end, r.other);
    window.__e2e.rwyHdg = ax.hdg; window.__e2e.vr = 145; window.__e2e.phase = 'takeoff';
  });
  await page.keyboard.down('KeyR'); await page.waitForTimeout(2700); await page.keyboard.up('KeyR');
  await waitFor((s) => !s.onGround && s.agl * FT > 50, 90000, 'liftoff');
  await page.keyboard.press('KeyG');
  await waitFor((s) => s.agl * FT > 1500, 90000, '1500 ft');
  await page.evaluate(() => {
    const fs = window.__fs, ap = fs.ap, s = fs.sim.state;
    fs.input.lever = 25 / 45; window.__e2e.phase = 'idle';
    fs.sim.controls.flapLever = 0;
    ap.setSpd(250); ap.setAlt(10000); if (!ap.athr) ap.toggleAthr(); ap.engageAp();
    ap.setHdg(200); ap.levelChange();
  });
  await waitFor((s) => s.ap && s.agl * FT > 3000, 120000, 'AP climb through 3000 ft');
  await page.waitForTimeout(3000);
  await exitToMenu();
  const savedA = await st();
  const saveInfo = await page.evaluate(() => window.__fsLastSave);
  check('Exit to menu saved Test A', saveInfo && saveInfo.ok && saveInfo.reason === 'exit to menu', JSON.stringify(saveInfo));
  check('a save takes a few ms', saveInfo && saveInfo.ms < 10, `${saveInfo?.ms.toFixed(2)} ms`);

  // ---- 3. Test B: a Jeju gate, start the pushback ----
  const stand = await page.evaluate(() => {
    const a = window.__fs.airports.find((x) => x.icao === 'RKPC');
    return (a.stands.find((s) => s.ref === '12') || a.stands[5]).ref;
  });
  await newScenario('Test B', { origin: 'RKPC', dest: 'RKSS', arr: '14R', start: 'gate', stand });
  await page.waitForTimeout(1000);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(6000);
  await exitToMenu();
  const savedB = await st();
  const pbB = await page.evaluate(() => { const p = window.__fs.gate.pushback?.state; return p ? { ...p } : null; });
  check('Test B in a pushback when saved', savedB.phase === 'pushback' && pbB && pbB.pushedM > 1, `phase ${savedB.phase}, pushed ${pbB?.pushedM?.toFixed(1)} m`);
  await page.waitForTimeout(500);
  await shot('main-menu');
  await page.click('.fsm-nav [data-k="load"]');
  await page.waitForTimeout(400);
  await shot('load');
  await page.click('.fsm-load [data-k="back"]');

  // ---- 4. Load Test A: exactly where it was, flies on, land ----
  await loadByName('Test A');
  const loadedA = await page.evaluate(() => { const fs = window.__fs; fs.setPaused(true, true); const s = fs.sim.state;
    return { t: s.t, x: s.pos.x, y: s.pos.y, z: s.pos.z, vx: s.vel.x, vy: s.vel.y, vz: s.vel.z, pitch: s.pitch, roll: s.roll, hdg: s.hdg, fuel: s.fuelKg, ap: fs.ap.ap, apHdg: fs.ap.hdgDeg, apAlt: fs.ap.altFt }; });
  // The load can step a frame before the pause above; take back that motion.
  const dt = loadedA.t - savedA.t;
  const miss = Math.hypot(loadedA.x - loadedA.vx * dt - savedA.x, loadedA.y - loadedA.vy * dt - savedA.y);
  check('Test A loads exactly where it was', dt >= 0 && dt < 0.1 && miss < 0.01 && same(loadedA, savedA, ['ap', 'apHdg', 'apAlt']) && Math.abs(loadedA.fuel - savedA.fuel) < 0.05,
    `Δt ${dt.toFixed(4)} s, position ${miss.toExponential(2)} m off after taking back Δt, AP ${loadedA.ap} HDG ${loadedA.apHdg} ALT ${loadedA.apAlt}, fuel ${savedA.fuel.toFixed(2)} → ${loadedA.fuel.toFixed(2)}`);
  await page.evaluate(() => window.__fs.setPaused(false));
  const t0 = (await st()).t;
  await page.waitForTimeout(3000);
  const flying = await st();
  check('Test A flies on', flying.t - t0 > 2 && !flying.onGround && flying.ap, `${(flying.t - t0).toFixed(1)} s flown, ${(flying.z * FT).toFixed(0)} ft`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pause:not([hidden])');
  await shot('pause-menu');
  await page.click('#pause [data-act="settings"]');
  await page.waitForTimeout(300);
  await shot('settings');
  await page.keyboard.press('Escape');
  await page.click('#pause [data-act="controls"]');
  await page.waitForTimeout(300);
  await shot('controls');
  await page.keyboard.press('Escape');
  await page.click('#pause [data-act="resume"]');
  await page.evaluate(() => { window.__fs.setTimeScale(1); window.__fs.skipToFinal(); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const fs = window.__fs, d = fs.dest, ax = fs.runwayAxis(d.end, d.other);
    window.__e2e.axis = { ...ax, elev: d.end.elevM ?? d.airport.elevM };
    window.__e2e.phase = 'approach';
  });
  // Save on final, then load it again mid-approach: the scorer's track must survive.
  await waitFor((s) => s.agl * FT < 1800, 400000, '1800 ft on final');
  await exitToMenu();
  const trackSaved = await page.evaluate(() => window.__fs.scorer.track.length);
  await loadByName('Test A');
  const trackLoaded = await page.evaluate(() => window.__fs.scorer.track.length);
  check('the approach track survives a save on final', trackSaved > 50 && Math.abs(trackLoaded - trackSaved) <= 2, `${trackSaved} → ${trackLoaded} samples`);
  await waitFor((s) => s.onGround, 300000, 'touchdown');
  await page.waitForFunction(() => window.__fsLastScore, null, { timeout: 120000 });
  const score = await page.evaluate(() => window.__fsLastScore);
  const names = (score.parts || []).map((p) => p.name).join(', ');
  check('the score has its approach parts', !!score.grade && /approach|glide|path|sink/i.test(names), `${score.grade} ${score.points}: ${names}`);
  const lastLog = await page.evaluate(() => { const l = JSON.parse(localStorage.getItem('gamedump:flight-sim:logbook') || '[]'); return l[l.length - 1]; });
  check('the logbook entry is tagged Test A', lastLog?.scenarioName === 'Test A' && !!lastLog?.scenarioId, JSON.stringify({ id: lastLog?.scenarioId, name: lastLog?.scenarioName, route: lastLog?.route }));
  await page.waitForTimeout(1000);
  await shot('test-a-landed');
  await exitToMenu();

  // ---- 5. Load Test B: the pushback carries on ----
  await loadByName('Test B');
  const lb = await page.evaluate(() => { const fs = window.__fs, p = fs.gate.pushback?.state; return { phase: fs.gate.phase, pushedM: p?.pushedM, x: fs.sim.state.pos.x, y: fs.sim.state.pos.y }; });
  check('Test B loads in its pushback', lb.phase === 'pushback' && Math.abs(lb.pushedM - pbB.pushedM) < 0.5, `phase ${lb.phase}, pushed ${pbB.pushedM.toFixed(2)} → ${lb.pushedM?.toFixed(2)} m`);
  await page.waitForTimeout(4000);
  const lb2 = await page.evaluate(() => { const fs = window.__fs, p = fs.gate.pushback?.state; return { phase: fs.gate.phase, pushedM: p?.pushedM }; });
  check('the pushback carries on', (lb2.phase === 'pushback' && lb2.pushedM > lb.pushedM + 2) || lb2.phase === 'taxi', `phase ${lb2.phase}, pushed ${lb2.pushedM?.toFixed(1)} m`);
  await exitToMenu();

  // ---- 6. Continue, rename, delete, reload ----
  const contText = await page.textContent('.fsm-nav [data-k="continue"]');
  check('Continue shows the newest (Test B)', /Test B/.test(contText), contText.replace(/\s+/g, ' '));
  await page.click('.fsm-nav [data-k="load"]');
  const rowB = page.locator('.fsm-row', { hasText: 'Test B' }).first();
  await rowB.locator('[data-r="rename"]').click();
  await page.fill('.fsm-row [data-r="name"]', 'Test B renamed');
  await page.waitForTimeout(200);
  await shot('load-rename');
  await page.click('.fsm-row [data-r="save"]');
  const rowA = page.locator('.fsm-row', { hasText: 'Test A' }).first();
  await rowA.locator('[data-r="delete"]').click();
  await page.waitForTimeout(200);
  await shot('load-delete-confirm');
  await page.click('.fsm-row.asking [data-r="yes"]');
  const listNow = await page.evaluate(() => window.__fs.scenarios.list().map((e) => e.name));
  check('rename and delete work', listNow.includes('Test B renamed') && !listNow.includes('Test A'), listNow.join(', '));
  await page.close();
  await openPage();
  const afterReload = await page.evaluate(() => window.__fs.scenarios.list().map((e) => e.name));
  const cont2 = await page.textContent('.fsm-nav [data-k="continue"]');
  check('a reload keeps it all', afterReload.join('|') === listNow.join('|') && /Test B renamed/.test(cont2), `${afterReload.join(', ')}; Continue: ${cont2.replace(/\s+/g, ' ')}`);
  await page.click('.fsm-nav [data-k="continue"]');
  await page.waitForFunction(() => !window.__fs.inMenu, null, { timeout: 30000 });
  const cur = await page.evaluate(() => window.__fs.current?.name);
  check('Continue loads the newest', cur === 'Test B renamed', cur);
  await exitToMenu();
  // The logbook from the main menu, filtered to Test A (deleted: its flight stays under its name).
  await page.click('.fsm-nav [data-k="logbook"]');
  await page.waitForSelector('.fslb:not([hidden])');
  const opts = await page.$$eval('.fslb select option', (os) => os.map((o) => [o.value, o.textContent]));
  const optA = opts.find((o) => /Test A/.test(o[1]));
  if (optA) await page.selectOption('.fslb select', optA[0]);
  await page.waitForTimeout(300);
  check('the logbook filters by scenario (deleted Test A kept)', !!optA, opts.map((o) => o[1]).join(' | '));
  await shot('logbook-filtered');
  await page.keyboard.press('Escape');
  await page.close();

  // ---- 7. Migration from v0.1.4's keys ----
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL0 + 'tests/dev-menu.html').catch(() => {}); // any page on the origin, to reach its storage
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('gamedump:flight-sim:lastflight', JSON.stringify({ origin: 'RKSS', depRunway: '32L', dest: 'RKSI', arrRunway: '33L', start: 'runway', pax: 150, cargoKg: 1000, fuelKg: 5000, waypoints: [] }));
    localStorage.setItem('gamedump:flight-sim:logbook', JSON.stringify([
      { date: '2026-10-31T10:00:00Z', version: '0.1.0', route: 'RKSS–RKSI', score: { points: 0, grade: 'F', parts: [] } },
      { date: '2026-10-31T13:00:00Z', version: '0.1.3', route: 'RKSS–RKPC', score: { points: 80, grade: 'B', parts: [] } },
    ]));
    localStorage.setItem('gamedump:flight-sim:settings', JSON.stringify({ volume: 0.8 }));
  });
  const logBefore = await page.evaluate(() => localStorage.getItem('gamedump:flight-sim:logbook'));
  await page.close();
  await openPage();
  const mig = await page.evaluate(() => ({ list: window.__fs.scenarios.list(), log: localStorage.getItem('gamedump:flight-sim:logbook') }));
  check('Scenario 1 appears from v0.1.4\'s lastflight', mig.list.length === 1 && mig.list[0].name === 'Scenario 1', JSON.stringify(mig.list.map((e) => [e.name, e.summary])));
  check('the old logbook is untouched', mig.log === logBefore);
  await page.click('.fsm-nav [data-k="logbook"]');
  await page.waitForSelector('.fslb:not([hidden])');
  const opts7 = await page.$$eval('.fslb select option', (os) => os.map((o) => o.textContent));
  check('the old flights show under Scenario 1', opts7.some((o) => /Scenario 1 \(2\)/.test(o)), opts7.join(' | '));
  await page.keyboard.press('Escape');
  await page.click('.fsm-nav [data-k="continue"]');
  await page.waitForFunction(() => !window.__fs.inMenu, null, { timeout: 30000 });
  const s1 = await st();
  check('Scenario 1 starts at its route\'s start (RKSS 32L)', s1.onGround && !s1.crashed, `x ${s1.x.toFixed(0)} y ${s1.y.toFixed(0)}`);
  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));
} catch (e) {
  console.log('FAIL exception', e.stack || e.message);
  results.push({ name: 'exception', ok: false, detail: e.message });
  try { await shot('scenarios-failure'); } catch {}
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
