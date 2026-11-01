// Scenario saves (v0.2.0): everything a save holds goes through JSON and comes back
// "exactly where it was": the sim's snapshot, the scorer (with its approach track), the
// gate flow (a pushback under way or held, taxi-in, arrived) and the camera's views.
//   node --test tests/scenario-state.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';
import { createScorer, runwayEndRefs, landingRunway } from '../src/score.js';
import { createGateFlow, standList } from '../src/ground/gate-flow.js';
import { createPushback } from '../src/ground/pushback.js';
import { createCameraRig } from '../src/camera.js';
import { GROUND_Z, NOSE_X } from '../src/geometry.js';
import { airborne, onRunway, run, KT, FT, DEG, DT } from './sim-helpers.mjs';

const here = new URL('..', import.meta.url).pathname;
const AP = Object.fromEntries(['RKSS', 'RKPC', 'RKSI'].map((i) => [i, JSON.parse(readFileSync(here + `data/airports/${i}.json`, 'utf8'))]));
const AIRPORTS = Object.values(AP);
const viaJson = (o) => JSON.parse(JSON.stringify(o));
const d2 = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

// Every number in two sims' public states, compared within tol.
// Right after a restore, state.ias and mach come from the end of the last step, where a step
// reports them from its start (a frame's difference, display only): `air` = false skips them.
function assertSameState(a, b, tol, label, air = true) {
  const sa = a.state, sb = b.state;
  const near = (x, y, what) => assert.ok(Math.abs(x - y) <= tol, `${label}: ${what} ${x} vs ${y}`);
  for (const k of ['x', 'y', 'z']) near(sa.pos[k], sb.pos[k], `pos.${k}`);
  for (const k of ['hdg', 'pitch', 'roll', 'gs', 'vs', 'fuelKg', 't', 'mass', ...(air ? ['ias', 'mach'] : [])]) near(sa[k], sb[k], k);
  assert.deepEqual(viaJson(a.snapshot()), viaJson(b.snapshot()), `${label}: snapshots identical`);
}

// ---- 1. the sim ----

test('round trip: a sim on AP, mid-turn and mid-climb, restored from JSON into a fresh sim flies on identically', () => {
  const a = airborne({ massKg: 72000, fuelKg: 9000, altFt: 9000, iasKt: 270, hdg: 0.3, ap: { ap: true, athr: true, hdgDeg: 20, altFt: 9000 } });
  a.ap.setSpd(270);
  run(a, 60);
  // A heading and an altitude change under way.
  a.ap.setHdg(140);
  a.ap.setAlt(15000);
  a.ap.levelChange?.();
  run(a, 40);
  assert.ok(a.state.vs > 2, `climbing (${a.state.vs.toFixed(1)} m/s)`);
  const snap = viaJson(a.snapshot());
  const b = createSim();
  b.restore(snap);
  assertSameState(a, b, 0, 'just restored', false);
  run(a, 120); run(b, 120);
  assertSameState(a, b, 1e-6, 'after 120 s');
});

test('round trip on the take-off roll: the gear contact carries on identically through lift-off', () => {
  const pilot = (sim) => {
    const s = sim.state, c = sim.controls;
    c.thrust = 1;
    c.pitch = s.ias > 145 * KT ? (s.pitch < 12 * DEG ? 0.6 : 0) : 0;
    if (s.agl > 50 * FT) c.gearDown = false;
  };
  const a = onRunway({ massKg: 78000, hdg: 1.1 });
  run(a, 20, pilot);
  assert.ok(a.state.onGround && a.state.gs > 20, 'rolling');
  const b = createSim();
  b.restore(viaJson(a.snapshot()));
  run(a, 60, pilot); run(b, 60, pilot);
  assert.ok(!a.state.onGround && a.state.agl > 100, 'airborne');
  assertSameState(a, b, 1e-6, 'after lift-off');
});

// ---- 2. the scorer ----

// A final to Jeju 07 (the real end objects), fed to scorers as the game does: sampled every
// frame at 60 fps, with a slow bob about the 3° path.
const RKPC07 = runwayEndRefs(AIRPORTS).resolve('RKPC', '07');
function finalTrack() {
  const { end, other } = RKPC07;
  const L = d2(end.x, end.y, other.x, other.y), ux = (other.x - end.x) / L, uy = (other.y - end.y) / L;
  const gs = 72, frames = [];
  for (let t = 0, d = 9000; d > 30; t += 1 / 60, d -= gs / 60) {
    const h = Math.max(15, (d + 300) * Math.tan(3 * DEG) + 6 * Math.sin(t / 9));
    const vs = -gs * Math.tan(3 * DEG) + (6 / 9) * Math.cos(t / 9);
    frames.push({ t: 500 + t, pos: { x: end.x - ux * d + 3 * Math.sin(t / 13), y: end.y - uy * d, z: end.elevM + GROUND_Z + h }, vs, gs, ias: gs, onGround: false });
  }
  return frames;
}
function touchdownAndRollout(sc, t0) {
  const { end, other } = RKPC07;
  const L = d2(end.x, end.y, other.x, other.y), ux = (other.x - end.x) / L, uy = (other.y - end.y) / L;
  const x = end.x + ux * 430, y = end.y + uy * 430;
  sc.setLanding(landingRunway(AIRPORTS.flatMap((a) => a.runways), x, y, Math.atan2(ux, uy)));
  const s = { t: t0 + 1, ias: 68, gs: 68, vs: -1, onGround: true, pos: { x, y, z: end.elevM + GROUND_Z } };
  sc.update(s, [{ type: 'touchdown', vsMs: -1.1, g: 1.25, x, y, bank: 0.01, pitch: 5 * DEG, surface: 'runway' }]);
  let res = null;
  for (let i = 0; i < 60 && !res; i++) { s.t += 1; s.gs = Math.max(0, s.gs - 4); res = sc.update(s, []); }
  return res;
}

test('on final: a scorer saved through JSON and loaded scores the same landing the same, approach parts and all', () => {
  const refs = runwayEndRefs(AIRPORTS);
  const frames = finalTrack();
  const cut = Math.floor(frames.length * 0.7);
  const a = createScorer();
  a.reset(); a.setRunway(RKPC07.end, RKPC07.other);
  for (let i = 0; i < cut; i++) a.update(frames[i], []);
  const saved = viaJson(a.serialize(refs.identify));
  assert.deepEqual(saved.landing, { icao: 'RKPC', ident: '07', x: RKPC07.end.x, y: RKPC07.end.y, from: 'plan' });
  assert.ok(saved.track.length > 300, `the track (${saved.track.length} samples)`);
  assert.ok(JSON.stringify(saved).length < 60000, `small (${JSON.stringify(saved).length} B)`);
  const b = createScorer();
  b.load(saved, refs.resolve);
  assert.equal(b.landing.end, RKPC07.end, 'the airport\'s own end object');
  for (let i = cut; i < frames.length; i++) { a.update(frames[i], []); b.update(frames[i], []); }
  const ra = touchdownAndRollout(a, frames.at(-1).t), rb = touchdownAndRollout(b, frames.at(-1).t);
  assert.ok(ra && rb, 'both scored');
  const names = ra.parts.map((p) => p.name);
  assert.ok(names.includes('Approach path') && names.includes('Sink rate swings'), `approach parts (${names.join(', ')})`);
  assert.deepEqual(rb.parts, ra.parts);
  assert.equal(rb.points, ra.points);
  assert.equal(rb.runway, '07');
  console.log(`  saved on final: ${ra.points} (${ra.grade}) both ways; ${saved.track.length} samples, ${JSON.stringify(saved).length} B`);
});

test('scorer: saved mid-rollout (after the touchdown), and after the result, loads the same', () => {
  const refs = runwayEndRefs(AIRPORTS);
  const frames = finalTrack();
  const a = createScorer(), ref = createScorer();
  for (const sc of [a, ref]) { sc.setRunway(RKPC07.end, RKPC07.other); for (const f of frames) sc.update(f, []); }
  // the touchdown, then save before the result
  const { end, other } = RKPC07;
  const L = d2(end.x, end.y, other.x, other.y), ux = (other.x - end.x) / L, uy = (other.y - end.y) / L;
  const x = end.x + ux * 430, y = end.y + uy * 430, t0 = frames.at(-1).t;
  const s = { t: t0 + 1, ias: 68, gs: 68, vs: -1, onGround: true, pos: { x, y, z: end.elevM + GROUND_Z } };
  const ev = [{ type: 'touchdown', vsMs: -1.1, g: 1.25, x, y, bank: 0.01, pitch: 5 * DEG, surface: 'runway' }];
  for (const sc of [a, ref]) { sc.setLanding(landingRunway(AIRPORTS.flatMap((q) => q.runways), x, y, Math.atan2(ux, uy))); sc.update({ ...s }, ev); }
  const saved = viaJson(a.serialize(refs.identify));
  assert.equal(saved.landing.from, 'touchdown');
  const b = createScorer();
  b.load(saved, refs.resolve);
  assert.ok(b.touchedDown && b.landing.runway, 'touched down, on its runway');
  let rr = null, rb = null;
  for (let i = 0; i < 60 && !(rr && rb); i++) { s.t += 1; s.gs = Math.max(0, s.gs - 4); rr = rr || ref.update({ ...s }, []); rb = rb || b.update({ ...s }, []); }
  assert.ok(rr && rb);
  assert.deepEqual(rb.parts, rr.parts);
  // After the result: it stays done (no second score), and the result comes back.
  const done = createScorer();
  done.load(viaJson(b.serialize(refs.identify)), refs.resolve);
  assert.equal(done.result.points, rb.points);
  assert.equal(done.update({ ...s, t: s.t + 1 }, []), null, 'no second result');
  // No airports to resolve with: no runway, but nothing breaks.
  const lost = createScorer();
  lost.load(saved, () => null);
  assert.equal(lost.landing, null);
  // Without identify, the ident and x/y find it nearest.
  const anon = createScorer();
  anon.load(viaJson(a.serialize()), refs.resolve);
  assert.equal(anon.landing.end, RKPC07.end);
});

// ---- 3. the gate flow ----

function groundFor(ap) {
  const g = { h: ap.elevM, kind: 'ground' };
  return () => { g.h = ap.elevM; g.kind = 'ground'; return g; };
}
// One frame as main.js runs it at 60 fps: two sim steps, then the gate flow.
const frame = (sim, gate) => { sim.step(DT); sim.step(DT); gate.update(1 / 60, sim.controls); };
const PLAN = (ref) => ({ origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'gate', stand: ref, fuelKg: 6000, pax: 180, cargoKg: 1500 });

// Save as main.js will (gate + sim through JSON), load into a fresh sim and flow in its order.
function saveLoad(sim, gate, plan, ground) {
  const saved = viaJson({ sim: sim.snapshot(), gate: gate.serialize() });
  const sim2 = createSim({ ground });
  const gate2 = createGateFlow({ sim: sim2, airports: AIRPORTS });
  const said = [];
  gate2.onstatus = (t) => said.push(t);
  gate2.deserialize(saved.gate, plan);
  sim2.restore(saved.sim);
  gate2.afterLoad();
  assert.deepEqual(said, [], 'nothing said on load');
  assert.equal(gate2.status, gate.status, 'the status comes back');
  assert.equal(gate2.phase, gate.phase, 'the phase comes back');
  return { sim2, gate2, saved };
}

test('at the gate: a pushback under way, saved and loaded, carries on and ends at the same pose', () => {
  const ref = standList(AP.RKSS).find((s) => s.gate).ref, plan = PLAN(ref), ground = groundFor(AP.RKSS);
  const sim = createSim({ ground });
  const gate = createGateFlow({ sim, airports: AIRPORTS });
  gate.start(plan);
  // Parked: a save before P comes back parked, with its pushback still to start.
  {
    const { sim2, gate2 } = saveLoad(sim, gate, plan, ground);
    assert.equal(gate2.phase, 'parked');
    assert.equal(gate2.stand.ref, ref);
    assert.ok(gate2.route && gate2.route.points.length >= 2, 'the taxi route');
    assert.ok(sim2.controls.parkingBrake);
  }
  gate.onKey('pushback');
  for (let i = 0; i < 60 * 25; i++) frame(sim, gate);
  assert.equal(gate.phase, 'pushback');
  assert.ok(gate.pushback.state.pushedM > 10, `pushed ${gate.pushback.state.pushedM.toFixed(1)} m`);
  const { sim2, gate2, saved } = saveLoad(sim, gate, plan, ground);
  assert.ok(JSON.stringify(saved).length < 20000, `small (${JSON.stringify(saved).length} B)`);
  assert.deepEqual(viaJson(gate2.pushback.state), viaJson(gate.pushback.state), 'the pushback state');
  let n = 0;
  while ((gate.phase === 'pushback' || gate2.phase === 'pushback') && n < 60 * 400) { frame(sim, gate); frame(sim2, gate2); n++; }
  assert.equal(gate.phase, 'taxi'); assert.equal(gate2.phase, 'taxi');
  const a = sim.state, b = sim2.state;
  assert.ok(d2(a.pos.x, a.pos.y, b.pos.x, b.pos.y) < 1e-6 && Math.abs(a.hdg - b.hdg) < 1e-9, 'the same end pose');
  assert.ok(gate2.route && gate2.route.points.length >= 2, 'a route afterwards');
  assert.deepEqual(gate2.route.points, gate.route.points);
  // Taxiing: the route comes back, rounded to 0.01 m.
  const t = saveLoad(sim, gate, plan, ground);
  assert.equal(t.gate2.phase, 'taxi');
  t.gate2.route.points.forEach((p, i) => assert.ok(d2(p[0], p[1], gate.route.points[i][0], gate.route.points[i][1]) < 0.01));
  for (let i = 0; i < 60; i++) { frame(sim, gate); frame(t.sim2, t.gate2); }
  assertSameState(sim, t.sim2, 1e-6, 'taxi');
  // Airborne: departed, and it stays departed (wasAirborne kept, no route line).
  sim.reset({ x: sim.state.pos.x, y: sim.state.pos.y, z: 900, hdg: 1, onGround: false, iasMs: 140 });
  gate.update(1 / 60, sim.controls);
  assert.equal(gate.phase, 'departed');
  const dep = saveLoad(sim, gate, plan, ground);
  assert.equal(dep.gate2.serialize().wasAirborne, true);
  assert.deepEqual(dep.gate2.serialize(), viaJson(gate.serialize()));
  console.log(`  RKSS stand ${ref}: loaded mid-push, both ended after ${(n / 60).toFixed(0)} s more, ${JSON.stringify(saved).length} B saved`);
});

test('at the gate: a held pushback stays held after a load, and P carries it on', () => {
  const ref = standList(AP.RKSS).find((s) => s.gate).ref, plan = PLAN(ref), ground = groundFor(AP.RKSS);
  const sim = createSim({ ground });
  const gate = createGateFlow({ sim, airports: AIRPORTS });
  gate.start(plan);
  gate.onKey('pushback');
  for (let i = 0; i < 60 * 15; i++) frame(sim, gate);
  gate.onKey('pushback');
  for (let i = 0; i < 60 * 5; i++) frame(sim, gate);
  assert.match(gate.status, /held/);
  const { sim2, gate2 } = saveLoad(sim, gate, plan, ground);
  assert.equal(gate2.pushback.state.running, false);
  const x0 = sim2.state.pos.x, y0 = sim2.state.pos.y;
  for (let i = 0; i < 120; i++) frame(sim2, gate2);
  assert.ok(d2(sim2.state.pos.x, sim2.state.pos.y, x0, y0) < 0.01, 'held still');
  gate.onKey('pushback'); gate2.onKey('pushback');
  let n = 0;
  while ((gate.phase === 'pushback' || gate2.phase === 'pushback') && n < 60 * 400) { frame(sim, gate); frame(sim2, gate2); n++; }
  assert.equal(gate2.phase, 'taxi');
  assert.ok(d2(sim.state.pos.x, sim.state.pos.y, sim2.state.pos.x, sim2.state.pos.y) < 1e-6, 'the same end pose');
});

test('after landing: taxi-in and arrived at another airport come back with their stand', () => {
  const ap = AP.RKPC, ground = groundFor(ap), plan = PLAN(standList(AP.RKSS).find((s) => s.gate).ref);
  const sim = createSim({ ground });
  const gate = createGateFlow({ sim, airports: AIRPORTS });
  gate.start(plan);                     // departed from Gimpo...
  const [a, b] = ap.runways[0].ends;    // ...landed on Jeju 07
  const len = d2(a.x, a.y, b.x, b.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const x = a.x + ux * 1400, y = a.y + uy * 1400, hdg = Math.atan2(ux, uy);
  sim.reset({ x, y, hdg, onGround: true, fuelKg: 3000 });
  sim.setGroundPose(x, y, hdg, 20 * KT);
  gate.update(1 / 60, sim.controls);
  const r = gate.afterLanding(sim.state);
  assert.ok(r && gate.phase === 'taxi-in');
  const t = saveLoad(sim, gate, plan, ground);
  assert.equal(t.gate2.stand.ref, r.stand);
  assert.ok(t.gate2.stand === ap.stands.find((s) => s.ref === r.stand), 'Jeju\'s own stand object');
  assert.deepEqual(t.gate2.route.standXY, r.standXY.map((v) => Math.round(v * 100) / 100));
  assert.equal(t.gate2.afterLanding(t.sim2.state), t.gate2.route, 'no second route');
  // At the stand: arrived.
  const st = gate.stand, h = st.hdgGridDeg * DEG;
  sim.setGroundPose(st.x - Math.sin(h) * NOSE_X, st.y - Math.cos(h) * NOSE_X, h, 0);
  gate.update(1 / 60, sim.controls);
  assert.equal(gate.phase, 'arrived');
  const u = saveLoad(sim, gate, plan, ground);
  assert.equal(u.gate2.stand.ref, st.ref);
  assert.ok(u.gate2.route, 'the route is kept (the line is not drawn)');
  // None (a runway start): stays none.
  const simN = createSim();
  const none = createGateFlow({ sim: simN, airports: AIRPORTS });
  const v = saveLoad(simN, none, { ...plan, start: 'runway' }, ground);
  assert.equal(v.gate2.phase, 'none');
});

test('pushback.setState restores the state and the plan', () => {
  const st = { x: 0, y: 0, hdgGridDeg: 90 };
  const a = createPushback(st, { line: { x: -60, y: 10, hdgGrid: 0 } });
  a.toggle();
  for (let i = 0; i < 300; i++) a.update(0.1, { steer: 0.3 });
  const b = createPushback(st, {});   // planned without the line: setState brings the plan
  b.setState(viaJson(a.state));
  assert.deepEqual(b.state, a.state);
  let oa, ob;
  for (let i = 0; i < 3000 && !(oa?.done && ob?.done); i++) { oa = a.update(0.1, {}); ob = b.update(0.1, {}); }
  assert.deepEqual(ob, oa);
});

// ---- 4. the camera ----

test('camera: the view and its looks round-trip through JSON; unknown views are ignored', () => {
  const dom = { addEventListener() {} };
  const a = createCameraRig(dom);
  a.viewId = 'orbit';
  a.looks.orbit.yaw = 0.7; a.looks.orbit.dist = 240; a.looks.nose.pitch = -0.2; a.looks.captain.fov = 40;
  const saved = viaJson(a.serialize());
  const b = createCameraRig(dom);
  b.load(saved);
  assert.equal(b.view.id, 'orbit');
  assert.deepEqual(b.looks, a.looks);
  const s = { pos: { x: 10, y: 20, z: 300 }, hdg: 1, pitch: 0.05, roll: 0.1, groundH: 0 };
  assert.deepEqual(b.update(s), a.update(s));
  assert.ok(b.camera.quaternion.equals(a.camera.quaternion) && b.camera.fov === a.camera.fov);
  b.load({ viewId: 'cabin', looks: { cabin: { yaw: 1 }, fo: { yaw: 'x', fov: 30 } } });
  assert.equal(b.view.id, 'orbit', 'unknown view ignored');
  assert.equal(b.looks.cabin, undefined);
  assert.equal(b.looks.fo.fov, 30);
  assert.equal(b.looks.fo.yaw, 0, 'a non-number keeps the default');
});
