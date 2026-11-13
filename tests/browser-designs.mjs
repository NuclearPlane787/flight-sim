// v0.5.0's checks of designs in the real game, in Chrome on the Mac's GPU: 60 fps with six engines in 3rd person (at a
// Gimpo stand and over Seoul); a scenario with a design surviving a page reload; the designs in the air in 3rd person;
// the engine panel and the EICAS with four and six engines; an engine torn off its pylon.
//   python3 tools/cpu-guard.py --minutes 15 -- node tests/browser-designs.mjs [fps] [reload] [air] [off]
// Env: FS_URL (default http://127.0.0.1:8014/games/flight-sim/), FS_OUT (screenshots).
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FS_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const parts = process.argv.slice(2);
const want = (p) => !parts.length || parts.includes(p);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });

const D = {
  six787: { base: 'b787-9', id: 'chk-6x787', name: 'Six-engine 787', registration: 'HL7896', count: 6 },
  four777: { base: 'b777-300er', id: 'chk-4x777', name: 'Four-engine 777', registration: 'HL7774', count: 4 },
  ge90a321: { base: 'a321neo', id: 'chk-ge90-a321', name: 'GE90 A321', registration: 'HL8790', engine: 'ge90-115b', gearExtendM: 1.5 },
  strong: { base: 'b777-300er', id: 'pylon-test', name: 'Too strong', registration: 'HL7700', count: 2, thrustScale: 2, oewDeltaKg: 750 },
};

async function open(ctx, query = '') {
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push(String(e)));
  await page.goto(`${BASE}${query}`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__fs.clock.set(Date.UTC(2026, 9, 31, 6, 0)); window.__fs.clock.setRunning(false); });
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `v050-${name}.png`) });
// A design flown from the plan, as New scenario would (plan.design whole, plan.type its base).
const fly = (page, key, plan) => page.evaluate(async ([d, plan]) => {
  const f = window.__fs;
  const { newDesign, designDef } = await import('./src/sim/designs.js');
  const design = newDesign(d.base, d), def = designDef(design);
  f.startFlight({ origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'runway', pax: def.defaults.pax, cargoKg: def.defaults.cargoKg, fuelKg: 20000, waypoints: [], ...plan, type: d.base, design }, { keepClock: true });
  return { engines: f.sim.state.engines.length, type: f.sim.type.id, design: f.sim.design?.name };
}, [D[key], plan]);
const overSeoul = (page) => page.evaluate(() => {
  const f = window.__fs;
  f.sim.reset({ x: -52500, y: 168800, z: 914, hdg: 80 * Math.PI / 180, onGround: false, iasMs: 230 / 1.943844, flapLever: 0, gearDown: false, fuelKg: 20000, payloadKg: 25000, ap: { ap: true, athr: true, spdKt: 230, hdgDeg: 90, altFt: 3000, vertical: 'ALT' } });
  f.sim.controls.gearDown = false; f.gate.clear?.(); f.rig.viewId = 'orbit';
});
const orbit = (page, yaw, pitch, dist) => page.evaluate(([y, p, d]) => {
  const f = window.__fs; f.rig.viewId = 'orbit';
  Object.assign(f.rig.looks.orbit, { yaw: y * Math.PI / 180, pitch: p * Math.PI / 180, dist: d || f.sim.type.orbitDist });
}, [yaw, pitch, dist]);

async function fps() {
  console.log('--- 60 fps with six engines in 3rd person');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await open(ctx, '?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=15000');
  const r0 = await fly(page, 'six787', { start: 'runway' });
  check('a six-engine 787 flies from the plan', r0.engines === 6 && r0.type === 'b787-9' && r0.design === 'Six-engine 787', JSON.stringify(r0));
  await page.evaluate(() => { window.__fs.rig.viewId = 'orbit'; });
  const measure = async (label) => {
    await page.waitForTimeout(5000);
    const r = await page.evaluate(() => ({ ...window.__fsStats }));
    const ok = r.fps > 55 && r.triangles < 1.2e6 && r.calls <= 300;
    check(`${label}: 60 fps within budget`, ok, `${r.fps.toFixed(0)} fps, ${(r.triangles / 1e6).toFixed(2)} M tris, ${r.calls} draws, cpu ${r.cpuMs?.toFixed?.(1)} ms`);
  };
  await measure('six engines on Gimpo 14R');
  await overSeoul(page);
  await measure('six engines over Seoul at 3,000 ft');
  check('fps: no console errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function reload() {
  console.log('--- a scenario with a design through a reload');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await open(ctx);
  const made = await page.evaluate(async (d) => {
    const f = window.__fs;
    const { newDesign, designDef } = await import('./src/sim/designs.js');
    const design = newDesign(d.base, d), def = designDef(design);
    const plan = { type: d.base, design, origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'final', pax: def.defaults.pax, cargoKg: def.defaults.cargoKg, fuelKg: 30000, waypoints: [] };
    const res = f.scenarios.create('Four engines', { v: 1, fresh: true, plan }, { route: 'RKSS–RKPC', where: 'Not flown yet' });
    f.loadScenario(res.id);
    for (let i = 0; i < 1200; i++) f.sim.step(1 / 120);
    f.saveNow('test');
    const s = f.sim.state;
    const out = { id: res.id, n: s.engines.length, design: f.sim.design?.name, x: s.pos.x, y: s.pos.y, z: s.pos.z, t: s.t, mass: s.mass };
    f.exitToMenu();
    return out;
  }, D.four777);
  check('a scenario flies its design', made.n === 4 && made.design === 'Four-engine 777', JSON.stringify(made));
  await page.close();
  page = await open(ctx);
  const back = await page.evaluate((id) => {
    const f = window.__fs; f.loadScenario(id); f.setPaused(true, true);
    const s = f.sim.state;
    return { n: s.engines.length, design: f.sim.design?.name, count: f.sim.design?.count, x: s.pos.x, y: s.pos.y, z: s.pos.z, t: s.t, mass: s.mass, panelN: s.engines.length };
  }, made.id);
  const miss = Math.hypot(back.x - made.x, back.y - made.y, back.z - made.z);
  check('the design round-trips through a reload', back.n === 4 && back.design === made.design && back.count === 4, JSON.stringify(back));
  check('at the same place and mass', miss < 1e-6 && back.t === made.t && Math.abs(back.mass - made.mass) < 1e-6, `${miss} m`);
  await page.evaluate(() => { window.__fs.setPaused(false); });
  await page.waitForTimeout(1500);
  await shot(page, 'reloaded-4x777-final');
  check('reload: no console errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function air() {
  console.log('--- the designs in the air, the panels');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await open(ctx, '?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=15000');
  for (const [key, label] of [['four777', '4x777'], ['ge90a321', 'ge90-a321'], ['six787', '6x787']]) {
    await fly(page, key, { start: 'runway' });
    await overSeoul(page);
    await page.waitForTimeout(2500);
    await orbit(page, 35, 8);
    await page.waitForTimeout(800);
    await shot(page, `air-${label}`);
    await orbit(page, 160, -12);
    await page.waitForTimeout(800);
    await shot(page, `air-${label}-below`);
    const n = await page.evaluate(() => window.__fs.sim.state.engines.length);
    check(`${label} in the air`, n === { four777: 4, ge90a321: 2, six787: 6 }[key], `${n} engines`);
  }
  check('air: no console errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function off() {
  console.log('--- an engine torn off');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await open(ctx, '?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=15000');
  await fly(page, 'strong', { start: 'runway' });
  // Take-off thrust with the brakes on: at 2× the static thrust is past both pylons' limits; the weaker goes first,
  // and the levers come back at once.
  const r = await page.evaluate(async () => {
    const f = window.__fs, s = f.sim.state;
    f.sim.controls.parkingBrake = true; f.input.lever = 1; f.sim.controls.thrust = 1;
    for (let i = 0; i < 120 * 30; i++) {
      f.sim.step(1 / 120);
      const ev = f.sim.events.find((e) => e.type === 'engineOff');
      if (ev) { f.input.lever = 0; f.sim.controls.thrust = 0; return { engine: ev.engine, t: s.t, off: s.engines.map((e) => e.off) }; }
      f.sim.events.length = 0;
    }
    return null;
  });
  check('a pylon gave way at take-off thrust', !!r && r.off.filter(Boolean).length === 1, JSON.stringify(r));
  await page.waitForTimeout(600);
  await orbit(page, 120, 6);
  await page.waitForTimeout(800);
  await shot(page, 'engine-off');
  check('off: no console errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await ctx.close();
}

try {
  if (want('fps')) await fps();
  if (want('reload')) await reload();
  if (want('air')) await air();
  if (want('off')) await off();
} finally {
  await browser.close();
}
const bad = results.filter((r) => !r.ok);
console.log(`${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
