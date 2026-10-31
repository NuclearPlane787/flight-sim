// AP1 and A/THR holds: altitude capture (climb and descent) without large overshoot, V/S,
// HDG turns with ≤ 25° bank, A/THR speed, and the disconnects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { airborne, run, KT, FT, FPM, DEG } from './sim-helpers.mjs';
import { gridToMag } from '../src/world/frame.js';

const magHdg = (s) => gridToMag(s.hdg, s.pos.x, s.pos.y) / DEG;
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;

function apSim(altFt, iasKt, massKg = 75000) {
  const sim = airborne({ massKg, altFt, iasKt, ap: { ap: true, athr: true, spdKt: iasKt, hdgDeg: 0, altFt } });
  sim.controls.thrust = 25 / 45;
  sim.ap.setHdg(Math.round(magHdg(sim.state)));
  return sim;
}

function capture(fromFt, toFt, iasKt, mode) {
  const sim = apSim(fromFt, iasKt);
  const s = sim.state;
  sim.ap.setAlt(toFt);
  if (mode === 'vs') sim.ap.setVs(toFt > fromFt ? 2000 : -2000);
  else sim.ap.levelChange();
  const up = toFt > fromFt;
  let peak = up ? -1e9 : 1e9, modes = new Set(), minIas = 1e9, maxIas = 0;
  run(sim, 900, () => {
    const h = s.pos.z / FT;
    peak = up ? Math.max(peak, h) : Math.min(peak, h);
    modes.add(sim.ap.vertical);
    if (s.t > 30) { minIas = Math.min(minIas, s.ias / KT); maxIas = Math.max(maxIas, s.ias / KT); }
    if (sim.ap.vertical === 'ALT' && s.t > 60 && Math.abs(s.vs) < 20 * FPM && modes.has('ALT*')) {
      // settle a further 30 s to check it stays
      if (!sim._settle) sim._settle = s.t;
      if (s.t - sim._settle > 30) return true;
    }
  });
  return { overshoot: up ? peak - toFt : toFt - peak, final: s.pos.z / FT - toFt, modes: [...modes], minIas, maxIas, ap: sim.ap.ap, crashed: s.crashed };
}

test('OP CLB FL100 → FL150 at 280 kt: ALT* then ALT, overshoot < 150 ft, speed held', () => {
  const r = capture(10000, 15000, 280);
  if (process.env.SIM_DEBUG) console.log(r);
  assert.ok(r.ap && r.crashed === null);
  assert.deepEqual(r.modes.slice(0, 3), ['OP CLB', 'ALT*', 'ALT']);
  assert.ok(r.overshoot < 150, `overshoot ${r.overshoot.toFixed(0)} ft`);
  assert.ok(Math.abs(r.final) < 20, `final error ${r.final.toFixed(0)} ft`);
  assert.ok(r.minIas > 272 && r.maxIas < 288, `IAS ${r.minIas.toFixed(1)}–${r.maxIas.toFixed(1)} kt`);
});

test('OP DES FL200 → FL120 at 300 kt: overshoot < 150 ft', () => {
  const r = capture(20000, 12000, 300);
  if (process.env.SIM_DEBUG) console.log(r);
  assert.deepEqual(r.modes.slice(0, 3), ['OP DES', 'ALT*', 'ALT']);
  assert.ok(r.overshoot < 150, `overshoot ${r.overshoot.toFixed(0)} ft`);
  assert.ok(Math.abs(r.final) < 20);
  assert.ok(r.minIas > 290 && r.maxIas < 310, `IAS ${r.minIas.toFixed(1)}–${r.maxIas.toFixed(1)} kt`);
});

test('V/S ±2,000 fpm captures the FCU altitude (climb and descent)', () => {
  for (const [a, b] of [[8000, 12000], [12000, 7000]]) {
    const r = capture(a, b, 260, 'vs');
    if (process.env.SIM_DEBUG) console.log(r);
    assert.deepEqual(r.modes.slice(0, 3), ['V/S', 'ALT*', 'ALT']);
    assert.ok(r.overshoot < 150, `overshoot ${r.overshoot.toFixed(0)} ft`);
    assert.ok(Math.abs(r.final) < 20);
  }
});

test('HDG: 90° and 150° turns with ≤ 25° bank, no overshoot beyond 2°', () => {
  for (const turn of [90, -150]) {
    const sim = apSim(10000, 250);
    const s = sim.state;
    const target = (Math.round(magHdg(s)) + turn + 360) % 360;
    sim.ap.setHdg(target);
    let maxBank = 0, overshoot = 0, firstSign = Math.sign(turn);
    run(sim, 180, () => {
      maxBank = Math.max(maxBank, Math.abs(s.roll));
      const d = angDiff(magHdg(s), target);
      if (Math.sign(d) === firstSign) overshoot = Math.max(overshoot, Math.abs(d));
    });
    const err = angDiff(magHdg(s), target);
    if (process.env.SIM_DEBUG) console.log({ turn, maxBank: maxBank / DEG, overshoot, err });
    assert.ok(maxBank < 25.5 * DEG, `bank ${(maxBank / DEG).toFixed(1)}°`);
    assert.ok(Math.abs(err) < 1, `final heading error ${err.toFixed(2)}°`);
    assert.ok(overshoot < 2, `overshoot ${overshoot.toFixed(2)}°`);
    assert.ok(Math.abs(s.pos.z / FT - 10000) < 60, 'altitude held in the turn');
  }
});

test('A/THR SPEED: 250 → 300 kt in ALT within 3 kt, without overshooting by > 4 kt', () => {
  const sim = apSim(10000, 250);
  const s = sim.state;
  sim.ap.setSpd(300);
  let maxIas = 0;
  run(sim, 150, () => { maxIas = Math.max(maxIas, s.ias / KT); });
  if (process.env.SIM_DEBUG) console.log({ ias: s.ias / KT, maxIas, n1: s.engines[0].n1 });
  assert.ok(Math.abs(s.ias / KT - 300) < 3, `IAS ${(s.ias / KT).toFixed(1)}`);
  assert.ok(maxIas < 304, `overshoot to ${maxIas.toFixed(1)}`);
  assert.ok(Math.abs(s.pos.z / FT - 10000) < 50);
});

test('the AP disconnects on a firm stick input, with the warning and an event', () => {
  const sim = apSim(10000, 250);
  run(sim, 2);
  sim.events.length = 0;
  sim.controls.roll = 0.8;
  sim.step(1 / 120);
  assert.equal(sim.ap.ap, false);
  assert.ok(sim.events.some((e) => e.type === 'apDisconnect' && e.reason === 'stick'));
  assert.equal(sim.state.warnings.apDisc, true);
});

test('A/THR: levers to idle in flight disconnect it; the AP will not engage on the ground', async () => {
  const sim = apSim(10000, 250);
  sim.controls.thrust = 0;
  sim.step(1 / 120);
  assert.equal(sim.ap.athr, false);
  const { onRunway } = await import('./sim-helpers.mjs');
  const g = onRunway({});
  assert.equal(g.ap.engageAp(), false);
  assert.equal(g.ap.ap, false);
});
