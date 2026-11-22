// v0.5.3's checks of a changed airframe in the real game, in Chrome on the Mac's GPU (1440×900):
//   fps     60 fps in 3rd person with a stretched, long-winged design with eight engines (on Gimpo 14R and over Seoul),
//           and pictures of it in the air (each type)
//   reload  a scenario with an airframe design through a page reload: the same design, place and mass
//   flight  each type's stretched design takes off on the runway and climbs on the autopilot, nothing crashed
//   python3 tools/cpu-guard.py --minutes 15 -- node tests/browser-airframe.mjs [fps] [reload] [flight]
// Env: FS_URL (default http://127.0.0.1:8014/games/flight-sim/), FS_OUT (screenshots).
import { chromium } from './pw.mjs';   // (v0.7.4: Playwright with every close on a timeout; the module itself is PW or /tmp/flight-sim/pw's)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HEADED = process.argv.includes('--headed') || process.env.FS_HEADLESS === '0';   // headless by default (no window on Shane's screen); --headed or FS_HEADLESS=0 for one
process.argv = process.argv.filter((a) => a !== '--headed');   // so positional arguments never see it

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FS_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const parts = process.argv.slice(2);
const want = (p) => !parts.length || parts.includes(p);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED, args: ['--mute-audio', ...(HEADED ? [] : ['--use-angle=metal', '--ignore-gpu-blocklist']), '--window-size=1440,960'] });

// A stretched (+6 m ahead, +2 m behind: balanced on its gear, designs.js's nose-load check), long-winged (span 1.25) design with a bigger tail, eight engines
// (four pairs on the wing), made in the page with the designs API.
const STRETCH = {
  a321neo: { af: { plugFwd: 6, plugAft: 2, tail: 1.3, fin: 1.2, wing: { span: 1.25, chord: 1.0 } }, stations: [4.6, 7.5, 10.2, 12.8] },
  'b787-9': { af: { plugFwd: 6, plugAft: 2, tail: 1.3, fin: 1.2, wing: { span: 1.25, chord: 1.0 } }, stations: [7.5, 12.5, 17.5, 22.5] },
  'b777-300er': { af: { plugFwd: 6, plugAft: 2, tail: 1.3, fin: 1.2, wing: { span: 1.25, chord: 1.0 } }, stations: [8.5, 13.5, 18.5, 23.5] },
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
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `v053-${name}.png`) });
// The design, built in the page, flown from the plan as New scenario would.
const makeAndFly = (page, base, plan) => page.evaluate(async ([base, S, plan]) => {
  const f = window.__fs;
  const D = await import('./src/sim/designs.js');
  let d = D.newDesign(base, { id: `chk-stretch-${base}`, name: `Stretched ${base}`, registration: 'HL5300' });
  const e0 = d.parts[0].engine;
  d = { ...d, parts: [] };
  for (const s of S.stations) d = D.addPart(d, { kind: 'engine', engine: e0, mount: 'wing', side: 1, s });
  const af = D.defaultAirframe(base);
  d = D.normalizeDesign({ ...d, airframe: { ...af, ...S.af, wingL: { ...af.wingL, ...S.af.wing }, wingR: { ...af.wingR, ...S.af.wing } } });
  const def = D.designDef(d);
  f.startFlight({ origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'runway', pax: def.defaults.pax, cargoKg: def.defaults.cargoKg, fuelKg: 20000, waypoints: [], ...plan, type: base, design: d }, { keepClock: true });
  return { engines: f.sim.state.engines.length, type: f.sim.type.id, design: f.sim.design?.name, span: def.geo.DESIGN_SHAPE?.spanM, parts: !!def.data.PARTS_AERO };
}, [base, STRETCH[base], plan]);
const overSeoul = (page) => page.evaluate(() => {
  const f = window.__fs;
  f.sim.reset({ x: -52500, y: 168800, z: 914, hdg: 80 * Math.PI / 180, onGround: false, iasMs: 230 / 1.943844, flapLever: 0, gearDown: false, fuelKg: 20000, payloadKg: 25000, ap: { ap: true, athr: true, spdKt: 230, hdgDeg: 90, altFt: 3000, vertical: 'ALT' } });
  f.sim.controls.gearDown = false; f.gate.clear?.(); f.rig.viewId = 'orbit';
});
const orbit = (page, yaw, pitch, dist) => page.evaluate(([y, p, d]) => {
  const f = window.__fs; f.rig.viewId = 'orbit';
  Object.assign(f.rig.looks.orbit, { yaw: y * Math.PI / 180, pitch: p * Math.PI / 180, dist: d || f.sim.type.orbitDist * 1.2 });
}, [yaw, pitch, dist]);

async function fps() {
  console.log('--- 60 fps in 3rd person with a stretched, long-winged design with eight engines');
  for (const base of ['b777-300er', 'b787-9', 'a321neo']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await open(ctx, '?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=15000');
    const r0 = await makeAndFly(page, base, { start: 'runway' });
    check(`${base}: the stretched eight-engine design flies from the plan`, r0.engines === 8 && r0.type === base && r0.parts, JSON.stringify(r0));
    await page.evaluate(() => { window.__fs.rig.viewId = 'orbit'; });
    const measure = async (label) => {
      await page.waitForTimeout(5000);
      const r = await page.evaluate(() => ({ ...window.__fsStats }));
      // v0.6.0: Seoul's real centre and landmarks add ~0.35-0.4 M triangles in view from Gimpo and over Seoul
      // (v0.5.8: 0.87 M / 0.80 M; v0.6.0: 1.22 M / 1.19 M), so the triangle cap is 1.3 M (was 1.2 M); fps and draws unchanged.
      // v0.6.0 Part 7: the new ground (countryside houses, two more tree rings) adds ~0.35-0.4 M more (1.61 M / 1.53-1.55 M),
      // so the triangle cap is 1.7 M (was 1.3 M); fps and draws unchanged.
      // v0.6.1: the houses, the trees and the tunnels are drawn only where one stands, and the cities, the centres and the
      // parked aircraft only in view: 1.13 M on Gimpo 14R and 0.90 M over Seoul, so the cap is v0.5.8's 1.2 M again.
      const ok = r.fps > 55 && r.triangles < 1.2e6 && r.calls <= 300;
      check(`${base} ${label}: 60 fps within budget`, ok, `${r.fps.toFixed(0)} fps, ${(r.triangles / 1e6).toFixed(2)} M tris, ${r.calls} draws, cpu ${r.cpuMs?.toFixed?.(1)} ms`);
    };
    if (base === 'b777-300er') await measure('on Gimpo 14R');
    await overSeoul(page);
    await measure('over Seoul at 3,000 ft');
    await orbit(page, 35, 12); await page.waitForTimeout(1200); await shot(page, `air-stretched-${base}`);
    await orbit(page, 90, 70); await page.waitForTimeout(1200); await shot(page, `air-stretched-${base}-above`);
    check(`${base} fps: no console errors`, page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
}

async function reload() {
  console.log('--- a scenario with an airframe design through a reload');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await open(ctx);
  const made = await page.evaluate(async () => {
    const f = window.__fs;
    const D = await import('./src/sim/designs.js');
    const af = D.defaultAirframe('b787-9');
    const design = D.normalizeDesign({ ...D.newDesign('b787-9', { id: 'chk-af-787', name: 'Long 787' }), airframe: { ...af, tail: 1.4, plugAft: 4, wingL: { ...af.wingL, span: 1.2, sweep: 4 } } });
    const def = D.designDef(design);
    const plan = { type: 'b787-9', design, origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'final', pax: def.defaults.pax, cargoKg: def.defaults.cargoKg, fuelKg: 30000, waypoints: [] };
    const res = f.scenarios.create('Long 787', { v: 1, fresh: true, plan }, { route: 'RKSS–RKPC', where: 'Not flown yet' });
    f.loadScenario(res.id);
    for (let i = 0; i < 1200; i++) f.sim.step(1 / 120);
    f.saveNow('test');
    const s = f.sim.state;
    const out = { id: res.id, design: f.sim.design?.name, af: JSON.stringify(f.sim.design?.airframe), x: s.pos.x, y: s.pos.y, z: s.pos.z, t: s.t, mass: s.mass };
    f.exitToMenu();
    return out;
  });
  check('a scenario flies its airframe design', made.design === 'Long 787' && /"tail":1.4/.test(made.af), JSON.stringify(made).slice(0, 200));
  await page.close();
  page = await open(ctx);
  const back = await page.evaluate((id) => {
    const f = window.__fs; f.loadScenario(id); f.setPaused(true, true);
    const s = f.sim.state;
    return { design: f.sim.design?.name, af: JSON.stringify(f.sim.design?.airframe), x: s.pos.x, y: s.pos.y, z: s.pos.z, t: s.t, mass: s.mass };
  }, made.id);
  const miss = Math.hypot(back.x - made.x, back.y - made.y, back.z - made.z);
  check('the airframe round-trips through a reload', back.design === made.design && back.af === made.af, back.af);
  check('at the same place and mass', miss < 1e-6 && back.t === made.t && Math.abs(back.mass - made.mass) < 1e-6, `${miss} m`);
  await page.evaluate(() => { window.__fs.setPaused(false); });
  await page.waitForTimeout(1500);
  await orbit(page, 140, 8); await page.waitForTimeout(1000);
  await shot(page, 'reloaded-long-787-final');
  check('reload: no console errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function flight() {
  console.log('--- each type\'s stretched design takes off and climbs');
  for (const base of ['a321neo', 'b787-9', 'b777-300er']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await open(ctx, '?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=15000');
    await makeAndFly(page, base, { start: 'runway' });
    // A scripted take-off in the page's sim, at the page's own pace: TOGA, rotate at VR, gear up, AP on.
    const r = await page.evaluate(async () => {
      const f = window.__fs, sim = f.sim, c = sim.controls, KT = 0.514444;
      c.parkingBrake = false; c.thrust = 1;
      // a stretched body strikes its tail sooner: rotate gently to 3° short of the design's tail-strike angle
      const T = sim.type.data, vr = 1.12 * (sim.state.vls || 140 * KT), D2R = Math.PI / 180;
      const target = Math.min(12, T.PITCH_TAILSTRIKE_DEG - 3) * D2R;
      let rotated = false, maxPitch = 0;
      for (let i = 0; i < 120 * 70; i++) {
        const s = sim.state;
        if (!rotated && s.ias > vr) rotated = true;
        const want = s.onGround ? target : 12 * D2R;
        c.pitch = rotated ? Math.max(-0.4, Math.min(0.4, (want - s.pitch) * 3)) : 0;
        if (!s.onGround && s.agl > 15) c.gearDown = false;
        sim.step(1 / 120);
        maxPitch = Math.max(maxPitch, s.pitch);
        if (s.crashed) break;
      }
      const s = sim.state;
      return { crashed: s.crashed, agl: s.agl, ias: s.ias / KT, maxPitchDeg: maxPitch * 180 / Math.PI, tailStrike: T.PITCH_TAILSTRIKE_DEG };
    });
    check(`${base}: the stretched design takes off and climbs`, !r.crashed && r.agl > 300, JSON.stringify(r));
    await orbit(page, 200, 10); await page.waitForTimeout(1500);
    await shot(page, `climb-stretched-${base}`);
    await ctx.close();
  }
}

if (want('fps')) await fps();
if (want('reload')) await reload();
if (want('flight')) await flight();
await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `${bad.length} FAILED of ${results.length}` : `ALL PASS (${results.length})`);
process.exit(bad.length ? 1 : 0);
