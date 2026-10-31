// Ground handling, configuration logic, events and crashes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { onRunway, airborne, run, approachPilot, KT, FT, FPM, DEG, clamp } from './sim-helpers.mjs';

test('on the ground: static height, parking brake holds at idle, gear lever locked down', () => {
  const sim = onRunway({ massKg: 70000 });
  const s = sim.state;
  assert.ok(Math.abs(s.pos.z - 3.9) < 0.15, `ref point ${s.pos.z.toFixed(2)} m above the runway`);
  assert.ok(s.onGround && s.wow.nose && s.wow.left && s.wow.right);
  assert.ok(Math.abs(s.pitch) < 0.5 * DEG);
  sim.controls.parkingBrake = true;
  sim.controls.thrust = 0;
  sim.controls.gearDown = false;
  run(sim, 30);
  assert.ok(s.gs < 0.05, `creeping at ${s.gs.toFixed(3)} m/s`);
  assert.equal(s.gearPos, 1);
  assert.equal(s.config, '1+F');
});

test('taxi: idle-ish thrust rolls, tiller steering turns tightly at low speed, brakes stop', () => {
  const sim = onRunway({ massKg: 70000 });
  const s = sim.state, c = sim.controls;
  run(sim, 40, () => { c.thrust = s.gs < 7 ? 0.25 : 0.05; });
  assert.ok(s.gs > 4, `taxiing at ${(s.gs / KT).toFixed(1)} kt`);
  const h0 = s.hdg;
  run(sim, 20, () => { c.yaw = 1; c.thrust = s.gs < 5 ? 0.15 : 0.02; });
  const turned = ((s.hdg - h0) / DEG + 360) % 360;
  assert.ok(turned > 60, `turned ${turned.toFixed(0)}° right`);
  assert.ok(s.steerAngle > 40 * DEG, `steer ${(s.steerAngle / DEG).toFixed(0)}°`);
  c.yaw = 0; c.thrust = 0; c.brakeL = c.brakeR = 1;
  run(sim, 15);
  assert.ok(s.gs < 0.1);
  assert.equal(s.crashed, null);
});

test('reverse works only on the ground; reversers take time to deploy', () => {
  const air = airborne({ altFt: 5000, iasKt: 220 });
  air.controls.thrust = -1;
  run(air, 3);
  assert.equal(air.state.engines[0].rev, 0);
  const g = onRunway({});
  g.controls.thrust = -1;
  run(g, 1);
  assert.ok(g.state.engines[0].rev > 0.3 && g.state.engines[0].rev < 0.7, 'half deployed after 1 s');
  run(g, 3);
  assert.equal(g.state.engines[0].rev, 1);
  assert.equal(g.state.detent, 'REV');
});

test('flaps: lever 1 gives 1+F on the ground and auto-retracts to 1 above 210 kt; travel takes time', () => {
  const sim = onRunway({ flapLever: 0 });
  const s = sim.state, c = sim.controls;
  c.flapLever = 1;
  run(sim, 5);
  assert.equal(s.config, '1+F');
  assert.ok(s.slatDeg > 3 && s.slatDeg < 6, `slats ${s.slatDeg.toFixed(1)}° after 5 s`);
  const a = airborne({ altFt: 5000, iasKt: 200, flapLever: 2 });
  a.controls.flapLever = 1; // 2 → 1 below 210 kt gives 1+F
  run(a, 5);
  assert.equal(a.state.config, '1+F');
  const b = airborne({ altFt: 5000, iasKt: 180, flapLever: 1 });
  assert.equal(b.state.config, '1', 'airborne start in CONF 1 (skip to final)');
  a.controls.thrust = 1;
  run(a, 60, () => a.state.ias > 215 * KT);
  run(a, 1);
  assert.equal(a.state.config, '1');
  run(a, 15);
  assert.ok(a.state.flapDeg < 0.5);
});

test('gear: retraction takes ~9 s with doors, extension the same; VLE in vmax', () => {
  const a = airborne({ altFt: 5000, iasKt: 200, gearDown: true });
  const s = a.state;
  assert.equal(s.gearPos, 1);
  assert.ok(Math.abs(s.vmax / KT - 280) < 1, `vmax ${s.vmax / KT}`);
  a.controls.gearDown = false;
  run(a, 4);
  assert.ok(s.gearPos < 1 && s.gearPos > 0 && s.gearDoors === 1);
  run(a, 10);
  assert.equal(s.gearPos, 0);
  assert.equal(s.gearDoors, 0);
});

test('touchdown event: sink rate, g, position, bank and pitch', () => {
  const sim = airborne({ massKg: 70000, altFt: (150 * FT + 4.12) / FT, iasKt: 135, flapLever: 4, gearDown: true });
  const s = sim.state, c = sim.controls;
  let td = null;
  run(sim, 40, () => {
    c.thrust = s.agl < 20 * FT ? 0 : 0.2;
    approachPilot(sim);
    for (const e of sim.events.splice(0)) if (e.type === 'touchdown') td = e;
    if (td) return true;
  });
  assert.ok(td, 'touchdown event');
  assert.ok(td.vsMs < 0 && td.vsMs > -3, `vs ${td.vsMs}`);
  // A firm ~300–450 ft/min arrival with this scripted flare: well above 1 g, below Airbus's
  // hard-landing inspection threshold (≈ 2.6 g vertical acceleration).
  assert.ok(td.g > 1.05 && td.g < 2.6, `g ${td.g}`);
  for (const k of ['x', 'y', 'bank', 'pitch']) assert.equal(typeof td[k], 'number');
  assert.equal(s.crashed, null);
});

function descendInto(ground, opts = {}) {
  const sim = airborne({ massKg: 70000, altFt: (150 * FT + 4.12) / FT, iasKt: 140, flapLever: 4, gearDown: opts.gearDown ?? true, ground });
  const s = sim.state;
  run(sim, 60, () => {
    approachPilot(sim, opts.hard ? { vs: -1400, flareFt: 0 } : {});
    sim.controls.thrust = 0.2;
  });
  return { s, events: sim.events.splice(0) };
}

test('crashes: water, off-runway, gear-up and gear-breaking landings', () => {
  const water = descendInto(() => ({ h: 0, kind: 'water' }));
  assert.equal(water.s.crashed, 'ditched');
  assert.ok(water.events.some((e) => e.type === 'crash'));
  const grass = descendInto(() => ({ h: 0, kind: 'ground' }));
  assert.equal(grass.s.crashed, 'ran off the runway');
  const belly = descendInto(undefined, { gearDown: false });
  assert.ok(belly.s.crashed && /impact|strike/.test(belly.s.crashed), belly.s.crashed);
  const hard = descendInto(undefined, { hard: true });
  assert.ok(/collapsed/.test(hard.s.crashed), hard.s.crashed);
});

test('a light touchdown on the grass short of the runway is fine; a run across the grass is not', () => {
  // The same approach three ways: onto a runway; onto grass that ends 60 m past where it
  // touched down; and onto grass all the way (crashed by the run, not by the touch).
  const ref = descendInto(() => ({ h: 0, kind: 'runway' }));
  const td = ref.events.find((e) => e.type === 'touchdown');
  assert.ok(td, 'touchdown');
  assert.equal(ref.s.crashed, null);
  assert.equal(td.surface, 'runway');
  const edge = td.y + 60;
  const short = descendInto((x, y) => ({ h: 0, kind: y < edge ? 'ground' : 'runway' }));
  assert.equal(short.s.crashed, null, 'a light touch on the grass, then the runway');
  assert.equal(short.events.find((e) => e.type === 'touchdown').surface, 'ground');
  const grass = descendInto(() => ({ h: 0, kind: 'ground' }));
  assert.equal(grass.s.crashed, 'ran off the runway');
  const t3 = grass.events.find((e) => e.type === 'touchdown');
  const crash = grass.events.find((e) => e.type === 'crash');
  assert.ok(t3 && crash, 'touched down, then crashed');
});

test('tail strike on over-rotation', () => {
  const sim = onRunway({ massKg: 85000, flapLever: 1 });
  const s = sim.state, c = sim.controls;
  c.thrust = 1;
  run(sim, 60, () => {
    if (s.ias > 135 * KT) c.pitch = 1; // early, hard rotation
  });
  const events = sim.events.splice(0);
  assert.equal(s.crashed, 'tail strike');
  assert.ok(events.some((e) => e.type === 'tailstrike'));
});

test('GPWS: sink rate and pull up envelopes, too low gear', () => {
  const sim = airborne({ massKg: 70000, altFt: 2000, iasKt: 220, ground: () => ({ h: 0, kind: 'ground' }) });
  const s = sim.state;
  let sink = false, pull = false;
  run(sim, 20, () => {
    sim.controls.pitch = clamp(0.0006 * (-4500 - s.vs / FPM), -0.6, 0.6);
    if (s.warnings.sinkRate) sink = true;
    if (s.warnings.pullUp) pull = true;
    if (s.agl < 600 * FT) return true;
  });
  assert.ok(sink && pull, `sink ${sink} pull ${pull}`);
  const low = airborne({ massKg: 70000, altFt: 400, iasKt: 170, ground: () => ({ h: 0, kind: 'ground' }) });
  run(low, 2, () => { low.controls.pitch = -0.05; });
  assert.equal(low.state.warnings.tooLowGear, true);
});
