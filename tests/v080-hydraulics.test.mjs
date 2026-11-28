// v0.8.0 (part 7), the hydraulics (src/sim/hydraulics.js and the sim): each family's layout, the pressures with each
// pump out, the PTU and the RAT, the effects for every set of systems lost, a design's pumps; then in the sim: an
// engine failure costs its pump (the A321's PTU keeps green up, the 787's left system falls to its demand pump), a
// lost green system (the gear by gravity only, the alternate brakes stop it longer, no steering), two systems lost
// (the law, the slower surfaces, half the spoilers), all engines out (the RAT), a flap jam (the slats alone move,
// a higher VLS, and it still lands) and the repairs (hOn back to 0, the core as a fresh one's).
//   node --test tests/v080-hydraulics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { typeById } from '../src/sim/types.js';
import { hydLayout, hydPressures, hydEffects, hydNormal, HYD, HYD_NAMES } from '../src/sim/hydraulics.js';
import { armed, describe, KINDS, SYSTEMS, G_GRAV } from '../src/sim/failures.js';
import { airborne, onRunway, run, KT, FT, DEG, DT } from './sim-helpers.mjs';
import { land } from './v080-gear-land.mjs';

const arm = (sim, kind, target = 0, seed = 5) => sim.setFailures(armed(sim.failures, { kind, target, when: { type: 'now' } }, sim.state.t, seed));
const P = (L, o = {}) => hydPressures(L, { eng: [1, 1], failed: 0, drained: 0, power: true, ySw: false, rat: 0, iasKt: 250, ...o }, {});
const fx = (L, p, gearDown = false) => hydEffects(L, { p, pc: p }, {}, gearDown);
const bit = (L, id) => 1 << L.pumps.findIndex((p) => p.id === id);

test('the layouts: the A321 green, blue, yellow with the PTU; the 787 and the 777 left, centre, right', () => {
  const a = hydLayout(typeById('a321neo')), b7 = hydLayout(typeById('b787-9')), b77 = hydLayout(typeById('b777-300er'));
  assert.deepEqual(a.names, HYD_NAMES.airbus); assert.deepEqual(b7.names, HYD_NAMES.boeing);
  assert.equal(a.ptu, true); assert.equal(b7.ptu, false);
  assert.deepEqual(a.pumps.map((p) => p.id + ':' + p.sys), ['EDP1:0', 'EDP2:2', 'B-ELEC:1', 'Y-ELEC:2', 'RAT:1', 'PTU:0']);
  assert.deepEqual(b7.pumps.map((p) => p.id + ':' + p.sys), ['EDP1:0', 'EDP2:2', 'L-ACMP:0', 'C1-ACMP:1', 'C2-ACMP:1', 'R-ACMP:2', 'RAT:1']);
  assert.equal(b77.pumps.filter((p) => p.air).length, 2, 'the 777\'s two air-driven demand pumps');
  assert.deepEqual(a.revSys, [0, 2]);
  for (const L of [a, b7, b77]) assert.deepEqual(fx(L, [1, 1, 1]), hydNormal(2), L.model + ': all three up is normal');
});

test('the pressures: each pump out, the PTU, the yellow electric pump, the RAT', () => {
  const a = hydLayout(typeById('a321neo'));
  assert.deepEqual(P(a).p, [1, 1, 1]);
  // Engine 1's pump failed: the PTU carries yellow's pressure across to green.
  let r = P(a, { failed: bit(a, 'EDP1') });
  assert.equal(r.ptu, true); assert.equal(r.p[0], HYD.ptuShare);
  // Its fluid lost too: no PTU (it would pump into nothing).
  r = P(a, { failed: bit(a, 'EDP1'), drained: 1 });
  assert.equal(r.p[0], 0); assert.equal(r.ptu, false); assert.equal(r.p[2], 1);
  // Engine 2 out: yellow by the PTU from green, or by its electric pump switched on.
  r = P(a, { eng: [1, 0] }); assert.equal(r.p[2], HYD.ptuShare); assert.equal(r.ptu, true);
  r = P(a, { eng: [1, 0], ySw: true }); assert.equal(r.p[2], 1); assert.equal(r.ptu, false);
  // A windmilling engine's pump gives a share, under the working pressure.
  r = P(a, { eng: [-20, -20], power: false }); assert.deepEqual(r.p, [HYD.windmillShare, 0, HYD.windmillShare]);
  // The RAT: blue, by its speed.
  r = P(a, { eng: [0, 0], power: false, rat: 1, iasKt: 200 }); assert.deepEqual(r.p, [0, 1, 0]);
  r = P(a, { eng: [0, 0], power: false, rat: 1, iasKt: 70 }); assert.equal(r.p[1], 0, 'too slow');
  r = P(a, { eng: [0, 0], power: false, rat: 0.5, iasKt: 200 }); assert.equal(r.p[1], 0.5, 'coming up to speed');
  // The 787: the left system on its demand pump with engine 1 out; the RAT's centre is the flight controls' only.
  const b = hydLayout(typeById('b787-9'));
  r = P(b, { eng: [0, 1] }); assert.equal(r.p[0], HYD.demandShare);
  r = P(b, { eng: [0, 0], power: false, rat: 1, iasKt: 200 }); assert.deepEqual(r.p, [0, 1, 0]); assert.deepEqual(r.pc, [0, 0, 0]);
});

test('the effects, the A321: no system, each one, each pair and all three lost', () => {
  const a = hydLayout(typeById('a321neo'));
  const G = fx(a, [0, 1, 1]), B = fx(a, [1, 0, 1]), Y = fx(a, [1, 1, 0]);
  assert.equal(G.gear, false); assert.equal(G.brake, HYD.brakeAlt); assert.equal(G.antiskid, false); assert.equal(G.steer, 0);
  assert.equal(G.slats, 0.5); assert.equal(G.flaps, 0.5); assert.deepEqual(G.reverser, [0, 1]); assert.equal(G.law, 0);
  assert.equal(G.groundSpoilers, 0.6); assert.equal(G.speedbrake, 1);
  assert.equal(B.gear, true); assert.equal(B.slats, 0.5); assert.equal(B.flaps, 1); assert.equal(B.law, 0); assert.equal(B.aileron, 0.5);
  assert.equal(Y.brake, 1); assert.equal(Y.flaps, 0.5); assert.deepEqual(Y.reverser, [1, 0]); assert.equal(Y.law, 0);
  const GB = fx(a, [0, 0, 1]), GY = fx(a, [0, 1, 0]), BY = fx(a, [1, 0, 0]);
  assert.equal(GB.law, 1); assert.equal(fx(a, [0, 0, 1], true).law, 2, 'direct with the gear down');
  assert.equal(GB.slats, 0); assert.equal(GB.aileron, 0); assert.equal(GB.elevator, 1 / 3);
  assert.equal(GY.law, 1); assert.equal(GY.flaps, 0); assert.equal(GY.stab, 0); assert.equal(GY.brake, HYD.brakeAcc); assert.deepEqual(GY.reverser, [0, 0]);
  assert.equal(BY.law, 0); assert.equal(BY.speedbrake, 0); assert.equal(BY.rollSpoilers, 0.25);
  const all = fx(a, [0, 0, 0]);
  assert.equal(all.law, 2); assert.equal(all.elevator, 0); assert.equal(all.rudder, 0); assert.equal(all.aileron, 0); assert.equal(all.gear, false);
});

test('the effects, the Boeings: one lost normal, two secondary, all three direct; the 787\'s brakes are electric', () => {
  for (const id of ['b787-9', 'b777-300er']) {
    const L = hydLayout(typeById(id));
    const C = fx(L, [1, 0, 1]), LR = fx(L, [0, 1, 0]);
    assert.equal(fx(L, [0, 1, 1]).law, 0); assert.equal(C.law, 0); assert.equal(C.gear, false); assert.equal(C.flaps, 0); assert.equal(C.steer, 0);
    assert.equal(LR.law, 1); assert.equal(LR.aileron, 1 / 3); assert.deepEqual(LR.reverser, [0, 0]);
    // All three lost from the pumps, the RAT turning the centre's flight controls: direct.
    const rat = hydEffects(L, { p: [0, 1, 0], pc: [0, 0, 0] }, {});
    assert.equal(rat.law, 2); assert.equal(rat.elevator, 1 / 3); assert.equal(rat.gear, false);
    if (id === 'b787-9') assert.equal(fx(L, [0, 0, 0]).brake, 1);
    else { assert.equal(fx(L, [1, 1, 0]).brake, HYD.brakeAlt); assert.equal(fx(L, [1, 0, 0]).brake, HYD.brakeAcc); }
  }
});

test('a design with four engines: two pumps a side on its base\'s first and third systems', () => {
  const T = typeById('b787-9');
  const L = hydLayout({ ...T, base: T, geo: { ...T.geo, ENGINES: [{ y: 15 }, { y: 8 }, { y: -8 }, { y: -15 }] } });
  assert.deepEqual(L.pumps.filter((p) => p.kind === 'engine').map((p) => p.sys), [0, 0, 2, 2]);
  assert.deepEqual(L.revSys, [0, 0, 2, 2]);
  const r = hydPressures(L, { eng: [0, 0, 1, 1], failed: 0, drained: 0, power: true, rat: 0, iasKt: 200 }, {});
  assert.deepEqual(r.p, [HYD.demandShare, HYD.demandShare, 1]);
  const c = hydLayout({ ...T, base: T, geo: { ...T.geo, ENGINES: [{ y: 9 }, { y: 0 }, { y: -9 }] } });
  assert.equal(c.pumps.filter((p) => p.kind === 'engine').length, 2, 'no engine pump on the centreline');
});

test('the kinds and their words, with and without the family', () => {
  for (const k of ['hyd-pump', 'hyd-elec', 'hyd-sys', 'flaps-jam', 'slats-jam']) assert.ok(KINDS[k] && KINDS[k].random, k);
  assert.equal(SYSTEMS.hydraulics, 'Hydraulics'); assert.equal(SYSTEMS.flaps, 'Flaps and slats');
  assert.equal(describe({ kind: 'hyd-sys', target: 0 }, 2, 'airbus'), 'Green hydraulic system lost');
  assert.equal(describe({ kind: 'hyd-sys', target: 1 }, 2, 'boeing'), 'Centre hydraulic system lost');
  assert.equal(describe({ kind: 'hyd-sys', target: 0 }), 'Hydraulic system 1 lost');
  assert.equal(armed(null, { kind: 'flaps-jam', target: 3 }, 0, 1).items[0].target, 0);
});

// ---- the sim ----

test('nothing failed: hOn stays 0 and state.hyd is normal', () => {
  const sim = airborne({ altFt: 9000, iasKt: 250 });
  run(sim, 5);
  assert.equal(sim._core.hOn, 0);
  assert.deepEqual(sim.state.hyd.p, [1, 1, 1]); assert.equal(sim.state.hyd.on, false); assert.equal(sim.state.hyd.law, 0);
});

test('an engine failure costs its pump: the A321\'s PTU keeps green up; the 787\'s left system falls to its demand pump', () => {
  const a = airborne({ altFt: 9000, iasKt: 250 });
  arm(a, 'eng-seize', 0);
  run(a, 15);
  const H = a.state.hyd;
  assert.equal(H.on, true); assert.ok(Math.abs(H.p[0] - HYD.ptuShare) < 0.01, `green ${H.p[0]}`);
  assert.equal(H.pumps.find((p) => p.id === 'PTU').on, true); assert.equal(H.pumps.find((p) => p.id === 'EDP1').on, false);
  assert.equal(H.eff.gear, true); assert.equal(H.law, 0);
  const b = createSim({ type: 'b787-9' });
  b.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 9000 * FT, iasMs: 250 * KT, flapLever: 0, gearDown: false, fuelKg: 20000, payloadKg: 20000 });
  arm(b, 'eng-seize', 0);
  run(b, 15);
  assert.ok(Math.abs(b.state.hyd.p[0] - HYD.demandShare) < 0.01, `left ${b.state.hyd.p[0]}`);
  assert.equal(b.state.hyd.rat, 0, 'no RAT with an engine burning');
});

test('green lost: the gear won\'t come down by the lever, comes down by gravity; no steering', () => {
  const sim = airborne({ altFt: 3000, iasKt: 200, gearDown: false });
  arm(sim, 'hyd-sys', 0);
  run(sim, 5);
  assert.equal(sim.state.hyd.lost[0], true); assert.equal(sim.state.hyd.eff.steer, 0);
  sim.controls.gearDown = true;
  run(sim, 20);
  assert.ok(sim.state.gearLegs.every((p) => p < 0.01), 'the legs stay up: ' + sim.state.gearLegs);
  sim.gravityGear();
  run(sim, 40);
  assert.ok(sim.state.gearLegs.every((p) => p > 0.99), 'down by gravity');
  assert.ok(sim.state.gearSys & G_GRAV);
});

test('green lost: the alternate brakes stop the A321 longer, and the repair puts everything back', () => {
  const normal = land('a321neo', 'down');
  const lost = land('a321neo', 'down', { setup: (sim) => { arm(sim, 'hyd-sys', 0); sim.step(DT); sim.gravityGear(); } });
  console.log(`# the roll: ${normal.slideM.toFixed(0)} m normal, ${lost.slideM.toFixed(0)} m green lost; first touch ${normal.firstSink} / ${lost.firstSink} ft/min`);
  assert.ok(normal.stopped && lost.stopped, `stopped ${normal.stopped} ${lost.stopped} ${lost.crashed}`);
  assert.ok(lost.slideM > normal.slideM * 1.1, `the roll: ${normal.slideM.toFixed(0)} m normal, ${lost.slideM.toFixed(0)} m on the alternate brakes`);
});

test('two systems lost (green and blue): alternate law, slower surfaces, half the slats, the spoilers\' share', () => {
  const sim = airborne({ altFt: 9000, iasKt: 250 });
  arm(sim, 'hyd-sys', 0); arm(sim, 'hyd-sys', 1);
  run(sim, 10);
  const e = sim.state.hyd.eff;
  assert.equal(sim.state.hyd.law, 1); assert.equal(e.aileron, 0); assert.equal(e.elevator, 1 / 3); assert.equal(e.slats, 0);
  assert.equal(e.groundSpoilers, 0.4);
  assert.ok(sim.state.hyd.rat > 0, 'two systems lost: the RAT is out');
  // The elevator moves at a third of its rate: a full stick for 0.2 s.
  const el0 = sim._core.elev;
  sim.controls.pitch = 1; run(sim, 0.2); sim.controls.pitch = 0;
  const d = Math.abs(sim._core.elev - el0), A = sim.type.data;
  assert.ok(d <= A.ELEV_RATE * 0.21 / 3 + 1e-9, `moved ${d}`);
});

test('all engines out: the RAT out and turning in about 8 s, blue holds on the A321, the centre\'s controls on the 787', () => {
  for (const type of ['a321neo', 'b787-9']) {
    const sim = createSim({ type });
    sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 9000 * FT, iasMs: 250 * KT, flapLever: 0, gearDown: false, fuelKg: 10000, payloadKg: 15000 });
    arm(sim, 'eng-seize', 0); arm(sim, 'eng-seize', 1);
    run(sim, 4);
    assert.ok(sim.state.hyd.rat > 0 && sim.state.hyd.rat < 1, type + ' coming up');
    run(sim, 8);
    assert.equal(sim.state.hyd.rat, 1, type);
    assert.ok(sim.state.hyd.p[1] > 0.9, type + ' centre/blue ' + sim.state.hyd.p[1]);
    assert.ok(sim.state.hyd.eff.elevator > 0, type + ' the elevator still moves');
  }
});

test('flaps jammed at 1+F: the lever to FULL moves the slats only, the VLS is higher, and it still lands', () => {
  const mk = (jam) => {
    const s = airborne({ altFt: 3000, iasKt: 180, flapLever: 1 });
    s._core.flap = 10;   // 1+F's flaps (the lever at 1 below 100 kt), then jammed there
    if (jam) arm(s, 'flaps-jam');
    s.controls.flapLever = 4;
    run(s, 40);
    return s;
  };
  const j = mk(true), n = mk(false);
  assert.equal(j.state.config, 'FULL', 'the lever\'s configuration follows the lever');
  assert.equal(j.state.slatDeg, 27); assert.equal(j.state.flapDeg, 10);
  assert.equal(n.state.flapDeg, 34);
  assert.ok(j.state.vls > n.state.vls + 2 * KT, `VLS ${j.state.vls / KT} jammed, ${n.state.vls / KT} full`);
  const r = land('a321neo', 'down', { setup: (sim) => { sim._core.slat = 18; sim._core.flap = 10; arm(sim, 'flaps-jam'); } });
  assert.ok(r.stopped && !r.crashed, `landed: ${r.stopped} ${r.crashed}`);
});

test('repairs put everything back: hOn returns to 0 and the hydraulics\' fields are a fresh core\'s', () => {
  const sim = airborne({ altFt: 9000, iasKt: 250 });
  arm(sim, 'hyd-sys', 2); arm(sim, 'hyd-pump', 0); arm(sim, 'hyd-elec', 1); arm(sim, 'slats-jam');
  run(sim, 5);
  assert.equal(sim._core.hOn, 1);
  sim.repair('all');
  run(sim, 30);
  const X = sim._core;
  assert.equal(X.hOn, 0); assert.deepEqual(X.hP, [1, 1, 1]); assert.equal(X.hPf | X.hDr | X.hJam, 0); assert.equal(X.hRat, 0);
  assert.equal(sim.state.hyd.on, false); assert.equal(sim.state.slatsJam, false);
});

test('the yellow electric pump: the checklist\'s action brings yellow back after engine 2 and green\'s PTU are gone', () => {
  const sim = airborne({ altFt: 9000, iasKt: 250 });
  arm(sim, 'hyd-sys', 0); arm(sim, 'eng-seize', 1);
  run(sim, 10);
  assert.ok(sim.state.hyd.p[2] < 0.2, 'yellow lost ' + sim.state.hyd.p[2]);
  assert.equal(sim.hydPump('Y-ELEC', true), true);
  run(sim, 10);
  assert.ok(sim.state.hyd.p[2] > 0.95, 'yellow back');
  assert.equal(sim.state.hyd.pumps.find((p) => p.id === 'Y-ELEC').on, true);
});

test('an A321-based design with one engine in the tail keeps its hydraulics: the centreline engine\'s pump feeds green, the PTU carries yellow (the code review\'s B3)', async () => {
  const { newDesign, addPart, normalizeDesign, designDef } = await import('../src/sim/designs.js');
  let d = newDesign('a321neo', { id: 'v080-tail1' });
  const e0 = d.parts[0].engine;
  d = normalizeDesign(addPart({ ...d, parts: [] }, { kind: 'engine', engine: e0, mount: 'tail', side: 1, s: 0 }, { mirror: false }));
  const L = hydLayout(designDef(d));
  assert.deepEqual(L.pumps.filter((p) => p.kind === 'engine').map((p) => p.sys), [0], 'its one engine pump is green\'s');
  const P = { p: [0, 0, 0], pc: [0, 0, 0], ptu: false };
  hydPressures(L, { eng: [1], failed: 0, drained: 0, power: true, ySw: false, rat: 0, iasKt: 200 }, P);
  assert.ok(P.p[0] === 1 && P.p[1] === 1 && P.p[2] >= 0.5 && P.ptu, `green ${P.p[0]}, blue ${P.p[1]}, yellow ${P.p[2]} by the PTU`);
  const E = hydEffects(L, P, hydNormal(1), true);
  assert.ok(E.gear && E.law === 0 && E.flaps > 0 && E.steer === 1, 'the gear, the flaps, the steering and the normal law');
  // And two centreline engines share green and yellow.
  const L2 = hydLayout({ family: 'airbus', id: 'x', geo: { ENGINES: [{ x: -20, y: 0, z: 1 }, { x: -22, y: 0, z: 3 }] } });
  assert.deepEqual(L2.pumps.filter((p) => p.kind === 'engine').map((p) => p.sys).sort(), [0, 2]);
});

test('"repair all" in a glide with no engine burning leaves the RAT out, and the elevator keeps its actuator; with the engines burning it stows (the code review\'s third round)', () => {
  const sim = airborne({ massKg: 70000, altFt: 12000, iasKt: 250 });
  sim.setFailures(armed(armed(null, { kind: 'eng-flameout', target: 0 }, 0, 1), { kind: 'eng-flameout', target: 1 }, 0, 2));
  run(sim, 15);
  assert.equal(sim.state.hyd.rat, 1, 'the RAT is out and turning');
  assert.equal(sim.repair('all'), true);
  let worst = 1;
  run(sim, 8, (s) => { if (s.state.hyd.on) worst = Math.min(worst, s.state.hyd.eff.elevator); });
  assert.equal(sim.state.hyd.rat, 1, 'still out: no engine burns yet');
  assert.ok(worst > 0, `the elevator never lost its last actuator (share ${worst})`);
  // The engines relit by their switches (repaired with the switch on, they start by themselves): then it stows.
  run(sim, 70);
  assert.ok(sim.state.engines.every((e) => e.lit));
  assert.equal(sim.repair('all'), true);
  assert.equal(sim.state.hyd.rat, 0);
  run(sim, 10);
  assert.equal(sim._core.hOn, 0, 'and everything is normal again');
});

test('a hydraulic system repaired by its own row gives the gear back to its lever, the gravity extension reset once the pressure returns (the third round)', () => {
  const sim = airborne({ massKg: 70000, altFt: 6000, iasKt: 200 });
  sim.setFailures(armed(null, { kind: 'hyd-sys', target: 0 }, 0, 1));
  run(sim, 5);
  sim.controls.gearDown = true; sim.gravityGear();
  run(sim, 40);
  assert.deepEqual(sim.state.gearLegs, [1, 1, 1]);
  sim.repair(sim.state.failures[0].id);
  run(sim, 10);
  assert.equal(sim.state.gearSys, 0, 'no hydraulic bit, no gravity extension');
  sim.controls.gearDown = false;
  run(sim, 30);
  assert.deepEqual(sim.state.gearLegs, [0, 0, 0]);
});
