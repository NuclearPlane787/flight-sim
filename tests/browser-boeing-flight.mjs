// The Boeings' checks in Chrome on this Mac's GPU (V030.md, Definition of done), for one type:
//   python3 tools/cpu-guard.py -- node tests/browser-boeing-flight.mjs <type id> [flight1] [flight2] [views] [fps]
// flight1 takes about 16 minutes alone, close to the guard's cap with another browser running. To
// split it (the rules' way, not a bigger cap): FLIGHT1=ground stops once lined up; FLIGHT1=air starts on
// the runway with the same load and flies the rest.
// flight1: a Gimpo stand to Jeju: the pushback, the taxi, a take-off by hand, the autopilot's climb,
//   cruise and descent, skip to final, and an autopilot ILS approach and landing.
// flight2: a hand-flown landing with tests/e2e-controller.js, which the score must rate B or better.
// views: cockpit, nose, 3rd person from several angles, on final, at night.
// fps: 60 fps at a Gimpo stand and over Seoul at 3,000 ft, with triangles and draw calls.
// Env: FS_URL (default http://127.0.0.1:8014/games/flight-sim/), FS_OUT (screenshots).
// Takes the 3D view and the HUD with page.screenshot, on the real GPU, a temporary Chrome profile.

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FS_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const [type = 'b787-9', ...parts] = process.argv.slice(2);
const want = (p) => !parts.length || parts.includes(p);
const FT = 3.28084, KT = 1.943844, DEG = Math.PI / 180;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960', '--autoplay-policy=no-user-gesture-required'] });

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push(String(e)));
  await page.goto(`${BASE}?test&type=${type}&${query}`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  // A fixed afternoon (15:00 KST), whatever time the check runs: the night shots set their own.
  await page.evaluate(() => { window.__fs.clock.set(Date.UTC(2026, 9, 31, 6, 0)); window.__fs.clock.setRunning(false); });
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `v030-${type}-${name}.png`) });
const until = async (page, fn, ms, label, arg) => {
  const t0 = Date.now();
  for (;;) {
    const r = await page.evaluate(fn, arg);
    if (r) return r;
    if (Date.now() - t0 > ms) { console.log('TIMEOUT waiting for', label); return null; }
    await page.waitForTimeout(250);
  }
};
const st = (page) => page.evaluate(() => {
  const f = window.__fs, s = f.sim.state, a = f.ap;
  return { t: s.t, z: s.pos.z * 3.28084, agl: s.agl * 3.28084, ias: s.ias * 1.943844, vs: s.vs * 196.85, gs: s.gs * 1.943844, onGround: s.onGround, pitch: s.pitch * 57.3, crashed: s.crashed || f.crashed,
    ap: a.ap, athr: a.athr, lat: a.lateral, ver: a.vertical, thr: a.thrustMode, phase: f.gate.phase, fuel: s.fuelKg, mass: s.mass, lever: s.thrustLever, n1: s.engines[0].n1, flap: s.config, type: f.sim.type.id };
});

async function flight1() {
  console.log('--- flight 1: a Gimpo stand to Jeju');
  const page = await open('origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=20000');
  const SPLIT = process.env.FLIGHT1 || '';
  if (SPLIT !== 'air') {
  // A gate start at a stand the type can use, with the setup's list.
  const started = await page.evaluate(async (type) => {
    const f = window.__fs, a = f.airports.find((x) => x.icao === 'RKSS');
    const { standList } = await import('./src/ground/gate-flow.js');
    const { typeById } = await import('./src/sim/types.js');
    const def = typeById(type), list = standList(a, def);
    f.startFlight({ type, origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'gate', stand: list[0].ref, pax: def.defaults.pax, cargoKg: def.defaults.cargoKg, fuelKg: 20000, waypoints: [] }, { keepClock: true });
    return { stand: f.gate.stand?.ref, phase: f.gate.phase, n: list.length, type: f.sim.type.id };
  }, type);
  check('gate start on a code E stand', started.phase === 'parked' && started.type === type, JSON.stringify(started));
  await page.waitForTimeout(1500);
  await shot(page, 'at-stand');
  await page.evaluate(() => { const f = window.__fs; f.rig.viewId = 'orbit'; Object.assign(f.rig.looks.orbit, { yaw: 140 * Math.PI / 180, pitch: 10 * Math.PI / 180 }); });
  await page.waitForTimeout(900);
  await shot(page, 'at-stand-3rd');
  await page.evaluate(() => { const f = window.__fs; f.rig.viewId = 'nose'; Object.assign(f.rig.looks.orbit, { yaw: 0, pitch: 12 * Math.PI / 180 }); });

  // The pushback, by the P key, at the tug's 4×.
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__fs.setTimeScale(4));
  const pushed = await until(page, () => window.__fs.gate.phase === 'taxi' || !!window.__fs.sim.state.crashed, 240000, 'the pushback');
  const s0 = await st(page);
  check('pushback ends on the taxi line', pushed && s0.phase === 'taxi' && !s0.crashed, JSON.stringify({ phase: s0.phase }));

  // Test-only taxi controller: pure pursuit along the route; a widebody turns slower.
  await page.evaluate(() => {
    const fs = window.__fs, KTS = 1.943844;
    const WB = fs.sim.type.geo.WHEELBASE;
    window.__taxi = { i: 0, done: false, maxOff: 0 };
    fs.sim.controls.parkingBrake = false;
    window.__fsController = (sim) => {
      const s = sim.state, c = sim.controls, T = window.__taxi;
      const live = fs.gate.points;
      const P = live && live.length > 1 ? (T.pts = live) : T.pts;
      if (!P) return;
      // Steer the nose gear along the route: pursue a point ahead of the reference point.
      const look = 2.0 * WB;
      while (T.i < P.length - 1 && Math.hypot(P[T.i][0] - s.pos.x, P[T.i][1] - s.pos.y) < look) T.i++;
      const [tx, ty] = P[T.i];
      const left = Math.hypot(P[P.length - 1][0] - s.pos.x, P[P.length - 1][1] - s.pos.y);
      if (left < 40) T.done = true;
      T.left = Math.round(left);
      const want = Math.atan2(tx - s.pos.x, ty - s.pos.y);
      const err = Math.atan2(Math.sin(want - s.hdg), Math.cos(want - s.hdg));
      c.yaw = Math.max(-1, Math.min(1, err * 2.2));
      const target = T.done ? 0 : Math.abs(err) > 0.5 ? 5 : Math.abs(err) > 0.2 || left < 200 ? 9 : 24;   // 24 kt on the straights, so the whole flight fits the guard's cap
      const v = s.gs * KTS;
      fs.input.lever = v < target - 2 ? 0.42 : 0;
      c.brakeL = c.brakeR = T.done ? 1 : v > target + 1 ? 0.5 : 0;
    };
  });
  const taxied = await until(page, () => window.__taxi.done || !!window.__fs.sim.state.crashed, 720000, 'the taxi');
  const s1 = await st(page);
  check('taxied to the holding point', taxied && !s1.crashed, JSON.stringify(await page.evaluate(() => ({ left: window.__taxi.left, phase: window.__fs.gate.phase }))));
  await shot(page, 'taxi');

  // Past the hold and on to the runway, as a crew would: to the centreline, then along it until the
  // flow says lined up. Then stop there and take off from that spot.
  await page.evaluate(() => {
    const f = window.__fs, KTS = 1.943844, r = f.runwayEnds('RKSS', '14R'), ax = f.runwayAxis(r.end, r.other);
    const s = f.sim.state, c = f.sim.controls;
    window.__lineup = { done: false };
    window.__fsController = () => {
      const L = window.__lineup;
      const rx = s.pos.x - ax.tx, ry = s.pos.y - ax.ty;
      const along = rx * ax.ux + ry * ax.uy, cross = rx * ax.uy - ry * ax.ux;
      // Pursue a point on the centreline ahead of where the aircraft is abeam.
      const ahead = Math.max(along, 0) + 120, tx = ax.tx + ax.ux * ahead, ty = ax.ty + ax.uy * ahead;
      const want = Math.atan2(tx - s.pos.x, ty - s.pos.y);
      const err = Math.atan2(Math.sin(want - s.hdg), Math.cos(want - s.hdg));
      const hdgOff = Math.atan2(Math.sin(ax.hdg - s.hdg), Math.cos(ax.hdg - s.hdg));
      L.err = +(hdgOff * 57.3).toFixed(1); L.cross = +cross.toFixed(1); L.along = Math.round(along); L.phase = f.gate.phase;
      if (!L.done && Math.abs(hdgOff) < 3 * Math.PI / 180 && Math.abs(cross) < 6) L.done = true;
      c.yaw = L.done ? 0 : Math.max(-1, Math.min(1, err * 2.2));
      const v = s.gs * KTS, target = L.done ? 0 : 6;
      f.input.lever = v < target - 1 ? 0.42 : 0;
      c.brakeL = c.brakeR = L.done ? 1 : v > target + 1 ? 0.5 : 0;
    };
  });
  const lined = await until(page, () => (window.__lineup.done && window.__fs.sim.state.gs < 0.5) || !!window.__fs.sim.state.crashed, 300000, 'the line-up');
  check('lined up on the runway', !!lined, JSON.stringify(await page.evaluate(() => window.__lineup)));
  if (SPLIT === 'ground') { check('flight 1 (ground): no console errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | ')); await page.close(); return; }
  } else {
    await page.evaluate((type) => {
      const f = window.__fs, def = f.sim.type;
      f.startFlight({ type, origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'runway', pax: def.defaults.pax, cargoKg: def.defaults.cargoKg, fuelKg: 20000, waypoints: [] }, { keepClock: true });
    }, type);
  }
  await page.evaluate(() => {
    const f = window.__fs; window.__fsController = null;
    f.input.lever = 0; f.sim.controls.brakeL = f.sim.controls.brakeR = 0; f.sim.controls.yaw = 0;
    f.sim.controls.spoilersArmed = true;
    f.ap.setAlt(25000); f.ap.setSpd(250);
  });
  await page.waitForTimeout(800);

  // The take-off by hand: TO/GA by its key, then the controller's rotation.
  await page.addScriptTag({ content: readFileSync(path.join(here, 'e2e-controller.js'), 'utf8') });
  await page.evaluate(() => {
    const f = window.__fs, s = f.sim.state, ax = f.runwayAxis(f.runwayEnds('RKSS', '14R').end, f.runwayEnds('RKSS', '14R').other);
    window.__e2e.rwyHdg = ax.hdg;
    window.__e2e.vr = Math.round(s.vls * 1.943844 / f.sim.type.data.VMM_FACTOR * 1.2);   // VR ≈ 1.2 × the 1 g stall in the take-off flaps
    window.__e2e.phase = 'takeoff';
  });
  await page.keyboard.press('KeyO');
  await page.waitForTimeout(300);
  const s2a = await st(page);
  check('TO/GA: THR REF, the levers advancing', s2a.thr === 'THR REF' && s2a.ver === 'TO/GA', JSON.stringify({ thr: s2a.thr, ver: s2a.ver, lever: s2a.lever }));
  await until(page, () => window.__fs.sim.state.ias * 1.943844 > 100, 90000, '100 kt');
  const s2b = await st(page);
  check('HOLD above 80 kt', s2b.thr === 'HOLD', `${s2b.thr} at ${s2b.ias.toFixed(0)} kt`);
  await shot(page, 'takeoff-roll');
  const off = await until(page, () => !window.__fs.sim.state.onGround || !!window.__fs.sim.state.crashed, 120000, 'lift-off');
  const s3 = await st(page);
  check('lift-off, no tail strike', off && !s3.crashed, `${s3.ias.toFixed(0)} kt, pitch ${s3.pitch.toFixed(1)}°; ${(await page.evaluate(() => window.__e2eLog.join(' | ')))}`);

  // Gear up, the AP above 400 ft, VNAV to FL250.
  await until(page, () => window.__fs.sim.state.agl * 3.28084 > 50, 30000, '50 ft');
  await page.keyboard.press('KeyG');
  await until(page, () => window.__fs.sim.state.agl * 3.28084 > 700, 60000, '700 ft');
  await page.evaluate(() => {
    const f = window.__fs; window.__e2e.phase = 'idle'; window.__fsController = null;
    f.sim.controls.pitch = 0;
    f.ap.lnav(); f.ap.setAlt(25000); f.ap.vnav?.();
    f.ap.engageAp();
  });
  const s4 = await st(page);
  check('AP on: LNAV and VNAV', s4.ap && /LNAV/.test(s4.lat) && /VNAV/.test(s4.ver), JSON.stringify({ lat: s4.lat, ver: s4.ver, thr: s4.thr }));
  // Flaps up on schedule.
  await until(page, () => window.__fs.sim.state.ias * 1.943844 > 205 || window.__fs.sim.state.pos.z * 3.28 > 3500, 120000, 'flap speed');
  await page.keyboard.press('Digit6');
  await page.evaluate(() => window.__fs.setTimeScale(1));
  await until(page, () => window.__fs.sim.state.agl * 3.28084 > 2500, 180000, '2,500 ft');
  await page.evaluate(() => window.__fs.setTimeScale(8));
  const top = await until(page, () => window.__fs.sim.state.pos.z * 3.28084 > 24800 || !!window.__fs.sim.state.crashed, 300000, 'the top of the climb');
  const s5 = await st(page);
  check('climbed to FL250 on the autopilot', top && !s5.crashed, JSON.stringify({ z: Math.round(s5.z), ias: Math.round(s5.ias), ver: s5.ver, thr: s5.thr, flap: s5.flap }));
  await page.evaluate(() => window.__fs.setTimeScale(1));
  await page.waitForTimeout(800);
  await shot(page, 'cruise');
  await page.evaluate(() => window.__fs.setTimeScale(16));
  await page.waitForTimeout(25000);
  const s6 = await st(page);
  check('cruise at altitude under time compression', Math.abs(s6.z - 25000) < 300 && !s6.crashed, JSON.stringify({ z: Math.round(s6.z), ias: Math.round(s6.ias), ver: s6.ver, thr: s6.thr, lat: s6.lat }));

  // The descent: FLCH to 10,000 ft.
  await page.evaluate(() => { const f = window.__fs; f.ap.setAlt(10000); f.ap.setSpd(280); f.ap.levelChange(); f.setTimeScale(8); });
  const des = await until(page, () => window.__fs.sim.state.pos.z * 3.28084 < 10300 || !!window.__fs.sim.state.crashed, 240000, 'the descent');
  const s7 = await st(page);
  check('FLCH descent to 10,000 ft', des && !s7.crashed, JSON.stringify({ z: Math.round(s7.z), ias: Math.round(s7.ias), ver: s7.ver, thr: s7.thr }));

  // Skip to final, and an autopilot ILS approach and landing.
  await page.evaluate(() => { window.__fs.setTimeScale(1); window.__fs.skipToFinal(); });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const f = window.__fs, A = f.sim.type.data, c = f.sim.controls, s = f.sim.state;
    f.ap.app();
    window.__autoland = { s };
    // The crew: flaps and gear by distance, the speed with them, spoilers armed.
    const ax = f.runwayAxis(f.dest.end, f.dest.other);
    window.__fsController = (sim) => {
      const toGo = -((s.pos.x - ax.tx) * ax.ux + (s.pos.y - ax.ty) * ax.uy);
      const idx = (n) => A.FLAP_LEVER.indexOf(n);
      if (toGo < 12 * 1852 && c.flapLever < idx('5')) { c.flapLever = idx('5'); f.ap.setSpd(170); }
      if (toGo < 9.5 * 1852 && !c.gearDown) c.gearDown = true;
      if (toGo < 9 * 1852 && c.flapLever < idx('20')) { c.flapLever = idx('20'); f.ap.setSpd(160); }
      if (toGo < 7.5 * 1852 && c.flapLever < idx('30')) { c.flapLever = idx('30'); c.spoilersArmed = true; }
      if (c.flapLever === idx('30')) f.ap.setSpd(Math.round(s.vls * 1.943844 + 5));
      // After the rollout: stop.
      if (s.onGround && s.wow.nose) { c.brakeL = c.brakeR = 0.6; if (s.gs < 1) window.__autoland.stopped = true; }
    };
  });
  const cap = await until(page, () => window.__fs.ap.vertical === 'G/S' && window.__fs.ap.lateral === 'LOC', 150000, 'LOC and G/S');
  const s8 = await st(page);
  check('LOC and G/S captured', !!cap, JSON.stringify({ lat: s8.lat, ver: s8.ver, z: Math.round(s8.z) }));
  await until(page, () => window.__fs.sim.state.agl * 3.28084 < 2000, 200000, '2,000 ft');
  await shot(page, 'final');
  await page.evaluate(() => { window.__fs.rig.viewId = 'captain'; });
  await page.waitForTimeout(700);
  await shot(page, 'cockpit-final');
  await page.evaluate(() => { window.__fs.rig.viewId = 'orbit'; });
  const flare = await until(page, () => window.__fs.ap.vertical === 'FLARE' || window.__fs.sim.state.onGround || !!window.__fs.sim.state.crashed, 180000, 'the flare');
  const s9 = await st(page);
  check('autoland: FLARE', flare && s9.ver === 'FLARE', JSON.stringify({ ver: s9.ver, agl: Math.round(s9.agl), thr: s9.thr }));
  const down = await until(page, () => window.__fs.sim.state.onGround || !!window.__fs.sim.state.crashed, 60000, 'touchdown');
  const s10 = await st(page);
  check('autoland: down, not crashed', down && !s10.crashed, JSON.stringify({ lat: s10.lat, thr: s10.thr, lever: s10.lever }));
  await until(page, () => window.__autoland.stopped || !!window.__fs.sim.state.crashed, 90000, 'the stop');
  const end = await page.evaluate(() => {
    const f = window.__fs, s = f.sim.state, ax = f.runwayAxis(f.dest.end, f.dest.other);
    const rx = s.pos.x - ax.tx, ry = s.pos.y - ax.ty;
    return { along: Math.round(rx * ax.ux + ry * ax.uy), cross: +(rx * ax.uy - ry * ax.ux).toFixed(1), len: Math.round(ax.len), score: window.__fsLastScore ? { g: window.__fsLastScore.grade, p: window.__fsLastScore.points } : null, crashed: s.crashed };
  });
  check('rolled out on the runway', Math.abs(end.cross) < 10 && end.along < end.len && !end.crashed, JSON.stringify(end));
  check('flight 1: no console errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await page.close();
}

async function flight2() {
  console.log('--- flight 2: a hand-flown landing');
  const page = await open('origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&fuel=15000');
  await page.addScriptTag({ content: readFileSync(path.join(here, 'e2e-controller.js'), 'utf8') });
  await page.evaluate(() => {
    const f = window.__fs, ax = f.runwayAxis(f.dest.end, f.dest.other);
    window.__e2e.axis = { ...ax, elev: f.dest.end.elevM ?? f.dest.airport.elevM };
    window.__e2e.phase = 'approach';
  });
  const done = await until(page, () => !!window.__fsLastScore || !!window.__fs.sim.state.crashed, 480000, 'the score');
  const r = await page.evaluate(() => ({ score: window.__fsLastScore && { grade: window.__fsLastScore.grade, points: window.__fsLastScore.points, parts: window.__fsLastScore.parts.map((p) => `${p.name} ${p.value}`) }, crashed: window.__fs.sim.state.crashed, log: window.__e2eLog.join(' | ') }));
  const g = r.score?.grade;
  check('hand-flown landing scored B or better', done && !r.crashed && (g === 'A' || g === 'B' || g === 'S'), JSON.stringify(r));
  await page.waitForTimeout(600);
  await shot(page, 'score');
  check('flight 2: no console errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await page.close();
}

async function views() {
  console.log('--- the views');
  const page = await open('origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=15000');
  const hide = () => page.evaluate(() => { for (const k of ['toast']) { const e = document.getElementById(k); if (e) e.style.visibility = 'hidden'; } });
  await hide();
  for (const [id, key] of [['cockpit', 'Digit1'], ['nose', 'Digit2'], ['3rd', 'Digit3']]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(900);
    await shot(page, `view-${id}`);
    const v = await page.evaluate(() => window.__fs.rig.view.id);
    check(`view key ${key}`, { cockpit: 'captain', nose: 'nose', '3rd': 'orbit' }[id] === v, v);
  }
  const look = async (name, yaw, pitch, dist) => {
    await page.evaluate(([y, p, d]) => { const f = window.__fs; f.rig.viewId = 'orbit'; Object.assign(f.rig.looks.orbit, { yaw: y * Math.PI / 180, pitch: p * Math.PI / 180, dist: d || f.sim.type.orbitDist }); f.setPaused(true, true); f.renderOnce(); }, [yaw, pitch, dist]);
    await page.waitForTimeout(500);
    await page.evaluate(() => { const h = document.getElementById('hud'); if (h) h.style.visibility = 'hidden'; window.__fs.renderOnce(); });
    await shot(page, `3rd-${name}`);
  };
  await look('rear-quarter', 35, 10);
  await look('side', 90, 4);
  await look('front-quarter', 150, 6);
  await look('above', 60, 55);
  await page.evaluate(() => { const h = document.getElementById('hud'); if (h) h.style.visibility = ''; const f = window.__fs; f.clock.set(Date.UTC(2026, 10, 9, 14, 0)); f.clock.setRunning(false); f.setPaused(false); });
  await page.waitForTimeout(1200);
  await shot(page, 'night-3rd');
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(900);
  await shot(page, 'night-cockpit');
  check('views: no console errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await page.close();
}

async function fps() {
  console.log('--- the frame rate');
  const page = await open('origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=15000');
  const measure = async (label) => {
    await page.waitForTimeout(5000);
    const r = await page.evaluate(() => ({ ...window.__fsStats }));
    const ok = r.fps > 55 && r.triangles < 1.2e6 && r.calls <= 300;
    check(`${label}: 60 fps within budget`, ok, `${r.fps.toFixed(0)} fps, ${(r.triangles / 1e6).toFixed(2)} M tris, ${r.calls} draws, cpu ${r.cpuMs.toFixed(1)} ms`);
  };
  await page.evaluate(async (type) => {
    const f = window.__fs, a = f.airports.find((x) => x.icao === 'RKSS');
    const { standList } = await import('./src/ground/gate-flow.js');
    const { typeById } = await import('./src/sim/types.js');
    const def = typeById(type);
    f.startFlight({ type, origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'gate', stand: standList(a, def)[0].ref, pax: 200, cargoKg: 5000, fuelKg: 20000, waypoints: [] }, { keepClock: true });
    f.rig.viewId = 'orbit';
  }, type);
  await measure('at a Gimpo stand');
  await page.evaluate(() => {
    const f = window.__fs;
    f.sim.reset({ x: -52500, y: 168800, z: 914, hdg: 80 * Math.PI / 180, onGround: false, iasMs: 220 / 1.943844, flapLever: 0, gearDown: false, fuelKg: 20000, payloadKg: 25000, ap: { ap: true, athr: true, spdKt: 220, hdgDeg: 90, altFt: 3000, vertical: 'ALT' } });
    f.sim.controls.gearDown = false; f.gate.clear(); f.rig.viewId = 'orbit';
  });
  await measure('over Seoul at 3,000 ft');
  check('fps: no console errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await page.close();
}

try {
  if (want('flight1')) await flight1();
  if (want('flight2')) await flight2();
  if (want('views')) await views();
  if (want('fps')) await fps();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (${type})`);
process.exit(failed.length ? 1 : 0);
