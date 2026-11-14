// v0.5.0, Parts 2 and 5: designs in the sim. A design that is its base flies the base's golden flight; a design's
// snapshot round-trips and carries the design whole; the prediction flies the design; asymmetric thrust yaws by the
// sum of the engines' moments; a four-engine 777's mass, CG and inertias against a hand sum; a pylon past its limit
// gives way, the mass leaves, and the aircraft flies on, yawing towards the dead side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createSim } from '../src/sim/sim.js';
import { predictSync } from '../src/sim/predict-core.js';
import { newDesign, designDef, normalizeDesign, stationRange, designNumbers, v1View } from '../src/sim/designs.js';
import { ENGINE_TYPES } from '../src/sim/engine-types.js';
import { typeById } from '../src/sim/types.js';
import * as goldA from './golden-a321-flight.mjs';
import * as goldB from './golden-boeing-flight.mjs';

const KT = 0.514444, DEG = Math.PI / 180, DT = 1 / 120;
const worstOf = (gold, now) => {
  let worst = 0;
  gold.rows.forEach((row, i) => row.forEach((v, j) => { worst = Math.max(worst, Math.abs(v - now.rows[i][j])); }));
  return worst;
};

test('a design that is its base flies the A321 golden flight to 1e-9', () => {
  const gold = JSON.parse(gunzipSync(readFileSync(goldA.FIXTURE)).toString());
  const d = newDesign('a321neo');
  const now = goldA.fly((o) => createSim({ ...o, type: d }));
  assert.equal(worstOf(gold, now), 0 <= 1e-9 ? worstOf(gold, now) : NaN);
  assert.ok(worstOf(gold, now) <= 1e-9);
});
for (const type of ['b787-9', 'b777-300er']) {
  test(`a design that is its base flies the ${type} golden flight to 1e-9`, () => {
    const gold = JSON.parse(gunzipSync(readFileSync(goldB.fixtureOf(type))).toString());
    const d = newDesign(type);
    const now = goldB.fly(type, (o) => createSim({ ...o, type: d }));
    const { worst, where } = goldB.goldenWorst(gold, now, goldB.FIELDS);   // as golden-boeing.test.mjs (v0.5.0 review)
    assert.ok(worst <= 1e-9, `${worst} (${where})`);
  });
}

function cruising(design, { z = 3000, kt = 250, thrust = 0.75 } = {}) {
  const sim = createSim({ type: design });
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z, iasMs: kt * KT, flapLever: 0, gearDown: false, fuelKg: 30000, payloadKg: 20000 });
  sim.controls.thrust = thrust;
  return sim;
}

test('normalizeDesign clamps to the brief\'s ranges, and the stations stay apart and in range', () => {
  const d = normalizeDesign({ base: 'b777-300er', engine: 'ge90-115b', count: 6, stations: [1, 1, 99], thrustScale: 9, oewDeltaKg: -1e9, fuelCapacityKg: 1e9, gearExtendM: 7 });
  const A = typeById('b777-300er').data;
  const V = v1View(d);
  assert.equal(V.thrustScale, 3); assert.equal(d.gearExtendM, 1.5);
  assert.equal(d.oewDeltaKg, Math.round(-0.15 * A.OEW)); assert.equal(d.fuelCapacityKg, Math.round(2 * A.FUEL_MAX));
  const [lo, hi] = stationRange('b777-300er', 'ge90-115b', 6);
  assert.equal(V.stations.length, 3);
  for (let i = 0; i < 3; i++) assert.ok(V.stations[i] >= lo - 1e-9 && V.stations[i] <= hi + 1e-9);
  for (let i = 1; i < 3; i++) assert.ok(V.stations[i] - V.stations[i - 1] >= ENGINE_TYPES['ge90-115b'].nacelle.D + 0.5 - 1e-9);
  assert.equal(v1View(normalizeDesign({ base: 'b787-9', count: 5 })).count, 2);
  assert.equal(v1View(normalizeDesign({ base: 'b787-9', count: 3 })).stations.length, 1);
});

test('a design\'s snapshot carries the design whole, round-trips through JSON and flies on to 1e-9', () => {
  const d = newDesign('b777-300er', { id: 'test4', count: 4, thrustScale: 1.2, oewDeltaKg: 5000, fuelCapacityKg: 160000, gearExtendM: 0.5 });
  const a = cruising(d);
  for (let i = 0; i < 1200; i++) a.step(DT);
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  assert.deepEqual(snap.design, normalizeDesign(d));
  assert.equal(snap.core.eN1.length, 4);
  const b = createSim();
  b.restore(snap);
  assert.equal(b.state.engines.length, 4);
  assert.deepEqual(b.design, normalizeDesign(d));
  // Editing the design afterwards doesn't change the save.
  d.count = 2; d.thrustScale = 3;
  for (let i = 0; i < 2400; i++) { a.controls.roll = b.controls.roll = i < 500 ? 0.3 : 0; a.step(DT); b.step(DT); }
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(a.state.pos[k] - b.state.pos[k]) < 1e-9, k);
  assert.equal(a.state.fuelKg, b.state.fuelKg);
});

test('the prediction flies the snapshot\'s design, and it isn\'t its base\'s path', () => {
  const d = newDesign('a321neo', { count: 4, engine: 'leap-1a', thrustScale: 1.3 });
  const sim = cruising(d, { thrust: 0.6 });
  const snap = sim.snapshot();
  const { samples } = predictSync(snap, { maxMinutes: 2 });
  const last = samples[samples.length - 1];
  assert.equal(last.snap.core.eN1.length, 4);
  const same = createSim();
  same.restore(JSON.parse(JSON.stringify(snap)));
  while (same.state.t < last.t - 1e-9) same.step(1 / 30);
  assert.ok(Math.hypot(same.state.pos.x - last.x, same.state.pos.y - last.y, same.state.pos.z - last.z) < 1e-6);
  const base = { ...JSON.parse(JSON.stringify(snap)) }; delete base.design;
  base.core.eN1 = base.core.eN1.slice(0, 2); base.core.eN1t = base.core.eN1t.slice(0, 2); base.core.eRev = base.core.eRev.slice(0, 2);
  base.core.eThr = base.core.eThr.slice(0, 2); base.core.eFf = base.core.eFf.slice(0, 2);
  const b = predictSync(base, { maxMinutes: 2 }).samples;
  assert.ok(Math.hypot(b[b.length - 1].x - last.x, b[b.length - 1].y - last.y, b[b.length - 1].z - last.z) > 1);
});

test('a four-engine 777\'s mass, CG and inertias against a hand sum', () => {
  const T = typeById('b777-300er'), A = T.data, E = ENGINE_TYPES['ge90-115b'];
  const d = newDesign('b777-300er', { count: 4 });
  const def = designDef(d);
  const outer = def.geo.NACELLES[0];
  assert.ok(Math.abs(outer.y - v1View(d).stations[1]) < 1e-12 && def.geo.NACELLES.length === 4);
  // The inner pair is where the base's engines are.
  assert.ok(Math.abs(def.geo.NACELLES[1].x - T.geo.NACELLES[0].x) < 1e-12 && Math.abs(def.geo.NACELLES[1].z - T.geo.NACELLES[0].z) < 1e-12);
  const m = E.installedKg;
  const ic = { x: 0, y: 0, hdg: 0, onGround: false, z: 3000, iasMs: 250 * KT, flapLever: 0, gearDown: false, fuelKg: 30000, payloadKg: 20000 };
  const a = createSim({ type: d }); a.reset(ic);
  const b = createSim({ type: 'b777-300er' }); b.reset(ic);
  const P = a.massProps, Q = b.massProps;
  assert.ok(Math.abs(P.mass - (Q.mass + 2 * m)) < 1e-6, `mass ${P.mass} vs ${Q.mass + 2 * m}`);
  const cgHand = (Q.mass * Q.cgX + 2 * m * outer.x) / (Q.mass + 2 * m);
  assert.ok(Math.abs(P.cgX - cgHand) < 1e-9, `cg ${P.cgX} vs ${cgHand}`);
  // Two point masses at (x, ±y, z): Ixx grows by 2m(y² + z²); Iyy and Izz by 2m about the OEW's (new) CG.
  const cgO = def.data.CG_OEW_X, rx = outer.x - cgO;
  const hand = { Ixx: 2 * m * (outer.y ** 2 + outer.z ** 2), Iyy: 2 * m * (rx * rx + outer.z ** 2), Izz: 2 * m * (rx * rx + outer.y ** 2) };
  // The base's inner pair, about the moved CG: the base's own figures are per kg and don't move with it, so the
  // same masses moved (from cg0 to cgO) change nothing (they cancel in the design's sums).
  for (const k of ['Ixx', 'Iyy', 'Izz']) {
    const got = P[k] - Q[k];
    assert.ok(Math.abs(got - hand[k]) < 1e-6 * hand[k], `${k}: ${got} vs ${hand[k]}`);
  }
  assert.ok(Math.abs(def.data.OEW - (A.OEW + 2 * m)) < 1e-9);
  assert.ok(hand.Ixx > 0.05 * Q.Ixx, 'the outer pair is a real share of the roll inertia');
});

test('asymmetric thrust: one engine at idle yaws by the sum of the engines\' moments, towards it', () => {
  const d = newDesign('b777-300er', { count: 4 });
  const a = cruising(d, { thrust: 0.9 }), b = cruising(d, { thrust: 0.9 });
  for (let i = 0; i < 600; i++) { a.step(DT); b.step(DT); }
  // Engine 4 (the right outboard) to idle in b, at one step: its N1 and its target.
  const i4 = 3, X = b._core;
  X.eN1[i4] = 21; X.eN1t[i4] = 21;
  const r0 = a._core.r;
  assert.equal(r0, b._core.r);
  const P = b.massProps;
  a.step(DT); b.step(DT);
  const G = designDef(d).geo.ENGINES;
  let dN = 0;
  for (let i = 0; i < 4; i++) dN += G[i].y * (b.state.engines[i].thrustN - a.state.engines[i].thrustN);
  const det = P.Ixx * P.Izz - P.Ixz * P.Ixz;
  const want = (P.Ixx * dN) / det * DT;
  const got = b._core.r - a._core.r;
  assert.ok(dN > 0, 'less thrust on the right: the nose goes right (FRD +N)');
  assert.ok(Math.abs(got - want) < 1e-3 * Math.abs(want), `Δr ${got} vs ${want}`);
  // And over 20 s hands off: it yaws and rolls towards the idle side.
  for (let i = 0; i < 2400; i++) { X.eN1[i4] = Math.min(X.eN1[i4], 21); X.eN1t[i4] = 21; a.step(DT); b.step(DT); }
  let dh = b.state.hdg - a.state.hdg; if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
  assert.ok(dh > 0.5 * DEG, `heading ${dh / DEG}° towards the dead (right) side`);
});

test('a pylon at 2× thrust gives way at take-off thrust; its mass leaves and the aircraft flies on, yawing towards the dead side', () => {
  // Just after lift-off, heavy (1,000 ft, 155 kt, flaps 20, gear up, 90 t of fuel), the autothrottle off, the levers
  // to take-off thrust (at 2× and M 0.27 about 1.5 times the rated thrust: the weaker pylon's limit). (On the runway an outboard
  // engine lost at take-off thrust spins the aircraft off it below VMCG, rudder or not: a crew would reject.)
  // (Its parts give its pylons margins of 0.06 % and 5.7 % over the certified 1.5: the weaker one is the minimum.)
  const d = newDesign('b787-9', { id: 'pylon-test', count: 2, thrustScale: 2, oewDeltaKg: 750 });
  const def = designDef(d);
  const sim = createSim({ type: d });
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 305, iasMs: 155 * KT, flapLever: def.data.FLAP_LEVER.indexOf('20'), gearDown: false, fuelKg: 90000, payloadKg: 30000 });
  sim.ap.setAthrArm(false);
  const s = sim.state, c = sim.controls;
  for (let k = 0; k < 240; k++) sim.step(DT);
  c.thrust = 1;
  let off = null, mass0 = 0;
  // The pilot holds about 160 kt with the pitch, as after a take-off (the climb's speed), so the thrust stays high.
  const holdSpeed = () => {
    const want = Math.max(4, Math.min(22, 12 + 0.8 * (s.ias / KT - 160)));
    c.pitch = Math.max(-1, Math.min(1, 0.3 * (want - s.pitch / DEG) - 0.5 * s.q / DEG));
  };
  for (let k = 0; k < 120 * 30 && !off; k++) {
    mass0 = s.mass;
    holdSpeed();
    sim.step(DT);
    for (const e of sim.events) if (e.type === 'engineOff' && !off) off = e;
    sim.events.length = 0;
  }
  assert.ok(off, 'a pylon gave way');
  assert.equal(off.reason, 'pylon');
  const i = off.engine, weakest = def.data.PYLON_LIMITS_N.indexOf(Math.min(...def.data.PYLON_LIMITS_N));
  assert.equal(i, weakest, 'the weakest pylon first');
  assert.ok(s.engines[i].off && s.engines[i].thrustN === 0 && s.engines[i].ffKgS === 0);
  assert.ok(Math.abs(mass0 - s.mass - def.data.ENGINE_MASS_KG) < 5, `the engine's mass left: ${mass0 - s.mass}`);
  // The pilot pulls the levers back at once (the others' pylons hold a little more), to about two thirds of the
  // thrust (a Boeing's lever: thrust ∝ lever²), holds the speed, and lets the yaw be.
  c.thrust = 0.8;
  const hdg0 = s.hdg, deadLeft = def.geo.ENGINES[i].y > 0;
  for (let k = 0; k < 120 * 20; k++) {
    holdSpeed();
    sim.step(DT);
    sim.events.length = 0;
    assert.equal(s.crashed, null);
  }
  assert.equal(s.engines.filter((e) => e.off).length, 1, 'only the one');
  assert.ok(s.pos.z > 400, `flies on: ${s.pos.z} m`);
  let dh = s.hdg - hdg0; if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
  assert.ok(deadLeft ? dh < -1 * DEG : dh > 1 * DEG, `yaws towards the dead side (${deadLeft ? 'left' : 'right'}): ${dh / DEG}°`);
  // Deterministic, and saved: a restore has the engine gone.
  const again = createSim();
  again.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  assert.equal(again.state.engines[i].off, true);
  assert.ok(Math.abs(again.state.mass - s.mass) < 1e-6);
});

test('the warehouse\'s numbers: a GE90 on an A321 scrapes until the gear is lengthened', () => {
  const low = designNumbers(designDef(newDesign('a321neo', { engine: 'ge90-115b' })));
  assert.ok(low.engines.every((e) => e.clearRestM < 0), 'it touches');
  const tall = designNumbers(designDef(newDesign('a321neo', { engine: 'ge90-115b', gearExtendM: 1.5 })));
  assert.ok(tall.engines.every((e) => e.clearRestM > 0.2), `clears: ${tall.engines[0].clearRestM}`);
  assert.ok(tall.tailStrikeDeg > low.tailStrikeDeg + 3, 'and the tail-strike angle follows the gear');
  const base = designNumbers(designDef(newDesign('a321neo')));
  assert.ok(Math.abs(base.engines[0].clearRestM - 0.45) < 0.02, `the A321neo's own 0.45 m: ${base.engines[0].clearRestM}`);
  assert.ok(base.engines.every((e) => e.pylonFrac < 0.7));
  const strong = designNumbers(designDef(newDesign('a321neo', { thrustScale: 2 })));
  assert.ok(strong.engines.every((e) => e.pylonFrac > 1), 'past the limit at 2×');
  // The review's findings: the payload is what MZFW leaves; a copy (another id, another name) has the same pylons;
  // nacelles that don't fit are flagged.
  const light = designDef(newDesign('a321neo', { oewDeltaKg: -7575 })), A = typeById('a321neo');
  assert.equal(light.data.MAX_PAYLOAD, A.limits.MZFW - light.data.OEW);
  const s1 = createSim({ type: light.design }); s1.reset({ x: 0, y: 0, hdg: 0, onGround: true, payloadKg: 29496, fuelKg: 8000 });
  assert.equal(s1.state.payloadKg, 29496);
  const p1 = designDef(newDesign('b777-300er', { id: 'a', name: 'One', thrustScale: 1.7 })).data.PYLON_LIMITS_N;
  const p2 = designDef(newDesign('b777-300er', { id: 'b', name: 'Two', thrustScale: 1.7 })).data.PYLON_LIMITS_N;
  assert.deepEqual(p1, p2);
  assert.ok(p1.every((v) => v >= 1.5 * ENGINE_TYPES['ge90-115b'].data.T0_ENGINE && v <= 1.65 * ENGINE_TYPES['ge90-115b'].data.T0_ENGINE));
  assert.equal(designNumbers(designDef(newDesign('a321neo', { engine: 'ge90-115b', count: 6 }))).overlap, true);
  assert.equal(designNumbers(designDef(newDesign('b777-300er', { count: 4 }))).overlap, false);
});
