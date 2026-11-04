// V030.md's Part 1 checks in the real game, in Chrome: a v0.2.2 save loads as the A321neo; a
// scenario's type round-trips through a page reload, flying on from where it was saved, with the
// right model, the HUD's panels, and the type in the logbook.
//   python3 tools/cpu-guard.py --minutes 8 -- node tests/browser-types.mjs [type id]
// Env: FS_URL (default http://127.0.0.1:8014/games/flight-sim/).
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
const BASE = process.env.FS_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const TYPE = process.argv[2] || 'b787-9';
let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });   // localStorage survives a reload
try {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const boot = async () => { await page.goto(BASE); await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.inMenu, null, { timeout: 90000 }); };
  await boot();

  // A v0.2.2 save: made by the game as the A321neo, with every trace of the type taken out.
  const made = await page.evaluate(() => {
    const f = window.__fs, plan = { origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'final', pax: 180, cargoKg: 2000, fuelKg: 7000, waypoints: [] };
    const res = f.scenarios.create('Old save', { v: 1, fresh: true, plan }, { route: 'RKSS–RKPC', where: 'Not flown yet' });
    f.loadScenario(res.id);
    for (let i = 0; i < 600; i++) f.sim.step(1 / 120);
    f.saveNow('test');
    f.exitToMenu();      // this saves too: so the type comes out after it
    const st = f.scenarios.get(res.id).state;
    delete st.sim.type; delete st.plan.type;
    f.scenarios.write(res.id, st, { route: 'RKSS–RKPC', where: 'Old' });
    return { id: res.id, hasType: 'type' in f.scenarios.get(res.id).state.sim };
  });
  check('the save has no type', made.hasType === false);

  // Fly a Boeing first, so the old save really has to change the type back.
  const boe = await page.evaluate((type) => {
    const f = window.__fs, plan = { type, origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'final', pax: 200, cargoKg: 5000, fuelKg: 20000, waypoints: [] };
    const res = f.scenarios.create('Boeing', { v: 1, fresh: true, plan }, { route: 'RKSS–RKPC', where: 'Not flown yet' });
    f.loadScenario(res.id);
    for (let i = 0; i < 1200; i++) f.sim.step(1 / 120);
    f.ap.app();
    f.saveNow('test');
    const s = f.sim.state;
    const out = { id: res.id, type: f.sim.type.id, x: s.pos.x, y: s.pos.y, z: s.pos.z, t: s.t, armed: f.ap.armedVertical, ils: !!f.ap.ils, mcp: !!document.querySelector('.fsui-mcp'), entry: f.scenarios.list().find((e) => e.id === res.id).type };
    f.exitToMenu();
    return out;
  }, TYPE);
  check('a new scenario flies its type', boe.type === TYPE && boe.mcp, JSON.stringify({ type: boe.type, mcp: boe.mcp }));
  check('the scenario list keeps the type', boe.entry === TYPE, boe.entry);

  const old = await page.evaluate((id) => {
    const f = window.__fs; f.loadScenario(id); f.setPaused(true, true);
    return { type: f.sim.type.id, stype: f.sim.state.type, fcu: !document.querySelector('.fsui-mcp') || document.querySelector('.fsui-mcp').hidden || getComputedStyle(document.querySelector('.fsui-mcp')).display === 'none', crashed: f.sim.state.crashed, mass: f.sim.state.mass };
  }, made.id);
  check('a v0.2.2 save loads as the A321neo', old.type === 'a321neo' && old.stype === 'a321neo' && !old.crashed, JSON.stringify(old));
  check('with the A321\'s panels', old.fcu);
  await page.evaluate(() => window.__fs.exitToMenu());

  // Through a real reload: the Boeing's scenario, where it was, with its ILS.
  await boot();
  const back = await page.evaluate((id) => {
    const f = window.__fs; f.loadScenario(id); f.setPaused(true, true);
    const s = f.sim.state;
    return { type: f.sim.type.id, x: s.pos.x, y: s.pos.y, z: s.pos.z, t: s.t, armed: f.ap.armedVertical, ils: !!f.ap.ils, wings: f.aircraft.triangles };
  }, boe.id);
  const miss = Math.hypot(back.x - boe.x, back.y - boe.y, back.z - boe.z);
  check('the type round-trips through a reload', back.type === TYPE, back.type);
  check('at the same place', miss < 1e-6 && back.t === boe.t, `${miss} m`);
  check('with the ILS and the armed modes', back.ils && back.armed === boe.armed, JSON.stringify({ ils: back.ils, armed: back.armed }));

  // A rewind after a route change: back on the current destination's ILS, not the snapshot's.
  const rw = await page.evaluate(async () => {
    const f = window.__fs;
    f.startFlight({ ...f.plan, start: 'final', dest: 'RKPC', arrRunway: '07', waypoints: [] }, { keepClock: true });
    const was = f.ap.ils.x;
    await new Promise((r) => setTimeout(r, 3500));      // a few rewind points on the old ILS
    f.changeRoute('RKPC', '25');
    const moved = f.ap.ils.x !== was;
    await new Promise((r) => setTimeout(r, 1500));
    f.setPaused(true, true);
    f.rewindNow();                                      // to a snapshot flown on the old runway
    const back = f.ap.ils.x;
    await new Promise((r) => setTimeout(r, 2500));
    const after = f.ap.ils.x, want = f.dest.end.x;
    f.setPaused(true, true);
    return { moved, snapshotWasOld: back === was, after, want };
  });
  check('a rewind after a route change re-syncs the ILS', rw.moved && rw.after === rw.want, JSON.stringify(rw));

  // A final start at the maximum take-off weight: not under the minimum manoeuvring speed, AP stays on.
  const heavy = await page.evaluate(async (type) => {
    const f = window.__fs, { typeById } = await import('./src/sim/types.js'), L = typeById(type).limits;
    f.startFlight({ type, origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'final', pax: 0, cargoKg: Math.min(L.CARGO_MAX, L.MZFW - L.OEW), fuelKg: L.MTOW - L.MZFW, waypoints: [] }, { keepClock: true });
    const s = f.sim.state, m = s.mass, ias0 = s.ias, vmm = s.vmm;
    await new Promise((r) => setTimeout(r, 20000));
    return { mt: Math.round(m / 1000), ias0: Math.round(ias0 * 1.944), vmm: Math.round(vmm * 1.944), ap: f.ap.ap, shaker: s.shaker, vs: Math.round(s.vs * 196.85), spd: f.ap.spdKt };
  }, TYPE);
  check('a heavy final start stays on the autopilot, above the amber band', heavy.ap && !heavy.shaker && heavy.ias0 >= heavy.vmm + 9, JSON.stringify(heavy));

  // The logbook shows the type.
  const log = await page.evaluate(async (type) => {
    const store = await import('./src/store.js');
    store.addLogEntry({ date: new Date().toISOString(), version: 'test', type, scenarioId: 'unsaved', scenarioName: 'Unsaved flights', route: 'RKSS–RKPC', depRunway: '14R', arrRunway: '07', airTimeS: 3000, fuelUsedKg: 9000, score: { points: 90, grade: 'A', parts: [] } });
    const f = window.__fs; f.logbook.open({ scenarios: [], legacyId: null });
    await new Promise((r) => setTimeout(r, 300));
    const text = document.getElementById('logbook-root').innerText;
    f.logbook.close?.();
    return text;
  }, TYPE);
  const name = TYPE === 'b787-9' ? '787-9' : '777-300ER';
  check('the logbook shows the type', log.includes(name), '');
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
