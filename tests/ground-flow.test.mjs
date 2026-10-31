// Gate starts: sim.setGroundPose, the pushback through the gate flow, routes from real
// stands at Gimpo, Jeju and Incheon, and the route to a stand after landing.
//   python3 tools/cpu-guard.py -- node --test tests/ground-flow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';
import { createGateFlow, standList } from '../src/ground/gate-flow.js';
import { buildTaxiGraph, routeFromStand, snapToGraph } from '../src/ground/taxi.js';
import { NOSE_X } from '../src/geometry.js';
import { standHeading } from '../src/world/traffic-layout.js';

const here = new URL('..', import.meta.url).pathname;
const AP = Object.fromEntries(['RKSS', 'RKPC', 'RKSI'].map((i) => [i, JSON.parse(readFileSync(here + `data/airports/${i}.json`, 'utf8'))]));
const DEG = Math.PI / 180, KT = 0.514444;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Flat ground at the airport's elevation, 'ground' off the runways (like the game's).
function groundFor(ap) {
  const g = { h: ap.elevM, kind: 'ground' };
  const rects = ap.runways.map((r) => { const [a, b] = r.ends, len = Math.hypot(b.x - a.x, b.y - a.y);
    return { a, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, len, half: r.widthM / 2 + 1.5 }; });
  return (x, y) => {
    g.h = ap.elevM;
    g.kind = rects.some((r) => { const s = (x - r.a.x) * r.ux + (y - r.a.y) * r.uy, c = -(x - r.a.x) * r.uy + (y - r.a.y) * r.ux;
      return s >= 0 && s <= r.len && Math.abs(c) <= r.half; }) ? 'runway' : 'ground';
    return g;
  };
}

function checkRoute(graph, r, label) {
  assert.ok(r && r.points.length >= 2, `${label}: a route`);
  let sum = 0;
  for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1], b = r.points[i];
    assert.ok(d(a, b) > 0, `${label}: no repeated points`);
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    assert.ok(snapToGraph(graph, m[0], m[1]).d < 0.5, `${label}: leg ${i} on the graph`);
    sum += d(a, b);
  }
  assert.ok(Math.abs(sum - r.lengthM) < 0.01, `${label}: lengthM`);
}

test('setGroundPose moves the aircraft on the ground and keeps the rest', () => {
  const sim = createSim();
  sim.reset({ x: 100, y: 200, hdg: 0.5, onGround: true, fuelKg: 6000, payloadKg: 15000, flapLever: 1, parkingBrake: false });
  for (let i = 0; i < 240; i++) sim.step(1 / 120);
  const s = sim.state, t0 = s.t, fuel0 = s.fuelKg, z0 = s.pos.z;
  sim.controls.flapLever = 2;
  sim.setGroundPose(130, 180, 1.2, -1.5);
  assert.ok(Math.abs(s.pos.x - 130) < 1e-6 && Math.abs(s.pos.y - 180) < 1e-6, 'reference point placed');
  assert.ok(Math.abs(wrap(s.hdg - 1.2)) < 1e-9, 'heading');
  assert.ok(Math.abs(s.vel.x + 1.5 * Math.sin(1.2)) < 1e-9 && Math.abs(s.vel.y + 1.5 * Math.cos(1.2)) < 1e-9, 'backwards along the heading');
  assert.ok(Math.abs(s.gs - 1.5) < 1e-9);
  assert.equal(s.t, t0, 'time kept');
  assert.equal(s.fuelKg, fuel0, 'fuel kept');
  assert.equal(sim.controls.flapLever, 2, 'controls kept');
  assert.equal(s.gearPos, 1);
  assert.ok(Math.abs(s.pos.z - z0) < 0.05, 'height kept on flat ground');
  assert.ok(s.onGround);
  assert.equal(sim.events.length, 0, 'no events');
  // The brakes stop it, and nothing breaks.
  sim.controls.brakeL = sim.controls.brakeR = 1;
  for (let i = 0; i < 120 * 5; i++) sim.step(1 / 120);
  assert.ok(s.gs < 0.05, `stopped (${s.gs})`);
  assert.equal(s.crashed, null);
  assert.ok(!sim.events.some((e) => e.type === 'crash'));
  assert.ok(d([s.pos.x, s.pos.y], [130, 180]) < 3, 'stopped near where it was put');
});

// Run a gate start: P, then the frame loop (1/120 s steps, 60 fps) until the pushback ends.
function pushback(icao, ref, dep, yaw = 0) {
  const ap = AP[icao];
  const sim = createSim({ ground: groundFor(ap) });
  const gate = createGateFlow({ sim, airports: Object.values(AP) });
  const r = gate.start({ origin: icao, depRunway: dep, stand: ref, fuelKg: 6000, pax: 180, cargoKg: 1500 });
  const s = sim.state;
  assert.equal(gate.phase, 'parked');
  assert.ok(sim.controls.parkingBrake, 'parking brake set at the gate');
  const st = gate.stand;
  const nose = [s.pos.x + Math.sin(s.hdg) * NOSE_X, s.pos.y + Math.cos(s.hdg) * NOSE_X];
  assert.ok(d(nose, [st.x, st.y]) < 0.5, `${icao} ${ref}: nose on the stop point (${d(nose, [st.x, st.y]).toFixed(2)} m)`);
  assert.ok(Math.abs(wrap(s.hdg - st.hdgGridDeg * DEG)) < 1e-6, 'stand heading');
  // Parked with the brake set: it stays put.
  for (let i = 0; i < 120 * 2; i++) sim.step(1 / 120);
  assert.ok(d(nose, [s.pos.x + Math.sin(s.hdg) * NOSE_X, s.pos.y + Math.cos(s.hdg) * NOSE_X]) < 0.05, 'holds at the gate');
  gate.onKey('pushback');
  assert.equal(gate.phase, 'pushback');
  let t = 0, maxGs = 0;
  while (gate.phase === 'pushback' && t < 400) {
    sim.controls.yaw = yaw;
    for (let k = 0; k < 2; k++) sim.step(1 / 120);
    gate.update(1 / 60, sim.controls);
    t += 1 / 60; maxGs = Math.max(maxGs, s.gs);
  }
  return { sim, gate, r, t, maxGs, st };
}

for (const [icao, dep] of [['RKSS', '14R'], ['RKSS', '32L'], ['RKPC', '07'], ['RKSI', '33L']]) {
  const gates = standList(AP[icao]).filter((s) => s.gate).slice(0, 3);
  for (const st of gates) {
    test(`pushback at ${icao} gate ${st.ref} ends on the taxi line (dep ${dep})`, () => {
      const { sim, gate, r, t, maxGs } = pushback(icao, st.ref, dep);
      const s = sim.state;
      assert.equal(gate.phase, 'taxi', `finished (${t.toFixed(0)} s)`);
      assert.ok(r, 'a taxi route');
      assert.ok(maxGs < 1.6, `pushback speed ${maxGs.toFixed(2)}`);
      assert.equal(s.crashed, null, 'no crash');
      assert.ok(!sim.events.some((e) => e.type === 'crash'));
      // The reference point is on the taxi line (or its straight extension, where the
      // mapped line stops short on the apron), and the route, made again from there,
      // starts just ahead of the nose and runs along it.
      const rr = gate.route, p0 = rr.points[0];
      const q = rr.points.find((p) => d(p, p0) > 3);
      const legHdg = Math.atan2(q[0] - p0[0], q[1] - p0[1]);
      const off = Math.abs(-(s.pos.x - p0[0]) * Math.cos(legHdg) + (s.pos.y - p0[1]) * Math.sin(legHdg));
      assert.ok(off < 5, `on the taxi line (${off.toFixed(1)} m off it)`);
      assert.ok(d([s.pos.x, s.pos.y], p0) < 40, `the route starts at the aircraft (${d([s.pos.x, s.pos.y], p0).toFixed(0)} m)`);
      const herr = Math.abs(wrap(s.hdg - legHdg)) / DEG;
      assert.ok(herr < 30, `nose along the route (${herr.toFixed(0)}°)`);
      // The parking brake is set at the end and holds it.
      assert.ok(sim.controls.parkingBrake);
      const x0 = s.pos.x, y0 = s.pos.y;
      for (let i = 0; i < 120 * 3; i++) sim.step(1 / 120);
      assert.ok(d([s.pos.x, s.pos.y], [x0, y0]) < 0.3, 'held by the brakes');
      assert.ok(s.onGround && !s.crashed);
      console.log(`  ${icao} gate ${st.ref}: pushback ${t.toFixed(0)} s, ${off.toFixed(1)} m off the line, ${herr.toFixed(0)}° off the route | ${rr.lengthM.toFixed(0)} m. ${rr.text}`);
    });
  }
}

test('pushback: P holds it, Q/E change where it ends', () => {
  const ref = standList(AP.RKSS).find((s) => s.gate).ref;
  const a = pushback('RKSS', ref, '14R', 0), q = pushback('RKSS', ref, '14R', -1);
  const pa = [a.sim.state.pos.x, a.sim.state.pos.y], pq = [q.sim.state.pos.x, q.sim.state.pos.y];
  assert.ok(d(pa, pq) > 1, `Q moves the end point (${d(pa, pq).toFixed(1)} m)`);
  // Hold mid-push.
  const ap = AP.RKSS, sim = createSim({ ground: groundFor(ap) });
  const gate = createGateFlow({ sim, airports: Object.values(AP) });
  gate.start({ origin: 'RKSS', depRunway: '14R', stand: ref, fuelKg: 6000, pax: 100 });
  gate.onKey('pushback');
  for (let i = 0; i < 600; i++) { sim.step(1 / 120); sim.step(1 / 120); gate.update(1 / 60, sim.controls); }
  gate.onKey('pushback');
  assert.match(gate.status, /held/);
  for (let i = 0; i < 600; i++) { sim.step(1 / 120); sim.step(1 / 120); gate.update(1 / 60, sim.controls); }
  const x0 = sim.state.pos.x, y0 = sim.state.pos.y;
  for (let i = 0; i < 120; i++) { sim.step(1 / 120); sim.step(1 / 120); gate.update(1 / 60, sim.controls); }
  assert.ok(d([sim.state.pos.x, sim.state.pos.y], [x0, y0]) < 0.01, 'held still');
  assert.equal(gate.phase, 'pushback');
});

// Routes from several real stands to every runway end at all three airports.
for (const icao of ['RKSS', 'RKPC', 'RKSI']) {
  test(`routes from real stands at ${icao} to every runway end`, () => {
    const ap = AP[icao], g = buildTaxiGraph(ap);
    const all = standList(ap);
    const pick = [...all.filter((s) => s.gate).slice(0, 4), ...all.filter((s) => !s.gate).filter((_, i) => i % 25 === 0).slice(0, 3)];
    for (const st of pick) for (const rw of ap.runways) for (const end of rw.ends) {
      const r = routeFromStand(g, st, end);
      const label = `${icao} stand ${st.ref} → ${end.ident}`;
      checkRoute(g, r, label);
      assert.ok(d(r.points[r.points.length - 1], [end.x, end.y]) < 1500, `${label}: hold near the end`);
      assert.ok(r.lengthM < 12000, `${label}: ${r.lengthM.toFixed(0)} m`);
    }
  });
}

test('after landing: a route from the exit ahead to a free stand', () => {
  const ap = AP.RKPC, sim = createSim({ ground: groundFor(ap) });
  const gate = createGateFlow({ sim, airports: Object.values(AP) });
  const [a, b] = ap.runways[0].ends;   // 07 → 25
  const len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const x = a.x + ux * 1400, y = a.y + uy * 1400, hdg = Math.atan2(ux, uy);
  sim.reset({ x, y, hdg, onGround: true, fuelKg: 3000 });
  sim.setGroundPose(x, y, hdg, 40 * KT);
  assert.equal(gate.afterLanding(sim.state), null, 'not above 30 kt');
  sim.setGroundPose(x, y, hdg, 20 * KT);
  const r = gate.afterLanding(sim.state);
  assert.ok(r, 'a route');
  assert.equal(gate.phase, 'taxi-in');
  assert.ok(d(r.points[0], [x, y]) < 1, 'starts at the aircraft');
  const st = ap.stands.find((s) => s.ref === r.stand);
  assert.ok(d(r.points[r.points.length - 1], [st.x, st.y]) < 1, 'ends at the stand');
  const ahead = (r.exit[0] - x) * ux + (r.exit[1] - y) * uy;
  assert.ok(ahead > -10, `exit ahead (${ahead.toFixed(0)} m)`);
  console.log(`  RKPC 07 at 1400 m: exit ${ahead.toFixed(0)} m ahead → stand ${r.stand}, ${r.lengthM.toFixed(0)} m. ${r.text}`);
});

test('Gimpo stand 7, with its heading from the taxi lines as at boot, has a route to every runway end (v0.1.4)', () => {
  const ap = structuredClone(AP.RKSS);
  const st = ap.stands.find((s) => s.ref === '7');
  assert.ok(!(st.leadIn && st.leadIn.length > 1), 'no lead-in line, so main.js takes its heading from the taxi lines');
  st.hdgGridDeg = ((standHeading(ap, st) * 180) / Math.PI + 360) % 360;
  const flow = createGateFlow({ sim: createSim(), airports: [ap] });
  for (const rw of ap.runways) for (const end of rw.ends) {
    const r = flow.start({ origin: 'RKSS', stand: '7', depRunway: end.ident, fuelKg: 6000, payloadKg: 15000 });
    assert.ok(r, `stand 7 to ${end.ident}: a route`);
  }
  assert.ok(flow.graphFor('RKSS').bridges >= 1, 'the piece of taxi line behind stand 7 is bridged');
});
