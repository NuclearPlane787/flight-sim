// v0.5.3, Part 3: the flight controls tune themselves to a design's airframe. A design with the tailplane at 0.7 and at
// 1.5 of its base's, and one with the wing's span at 1.25 (both sides), on each of the three types: each trims, holds a
// 30° bank turn, captures an altitude on the autopilot and lands (flared by the game's test pilot, tests/e2e-controller.js,
// as tests/designs-flight.test.mjs flies it), within the same limits as its base flown the same way. Then the yaw damper
// with a fin at 0.6 (the rudder's power per inertia about 0.6 of the base's: the gain the laws scale), and the laws'
// arithmetic with a GAIN_SCALE of all 1s the base's to the bit.
//
// What scales (src/sim/fbw.js's gainFor(): 1 / the ratio, within ×0.5 to ×2): the pitch and roll loops invert the sim's
// moments with the design's own control powers and inertias (E.elevScale, E.rollScale, E.Iyy, E.Ixx) and the autopilots
// ask them for a path and a bank, so they need nothing. The gains in surface deflection do: the yaw damper and the turn
// coordination (both laws) and the Boeings' runway alignment by GAIN_SCALE.yaw, the ground mode's direct pitch by .pitch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';
import { newDesign, designDef, defaultAirframe } from '../src/sim/designs.js';
import { typeById } from '../src/sim/types.js';
import { createFbw, gainFor } from '../src/sim/fbw.js';
import { createFbwBoeing } from '../src/sim/fbw-boeing.js';

const KT = 0.514444, FT = 0.3048, NM = 1852, DEG = Math.PI / 180, DT = 1 / 120;
const SRC = readFileSync(new URL('./e2e-controller.js', import.meta.url), 'utf8');
const TYPES = ['a321neo', 'b787-9', 'b777-300er'];

function rig(design) {
  const sim = createSim({ type: design });
  const input = { lever: 0 };
  const window = { __fs: { sim, input } };
  new Function('window', SRC)(window);
  const ctl = window.__e2e, fly = window.__fsController;
  const events = [];
  const step = () => {
    fly(sim, DT);
    if (sim._core.athrDriving) input.lever = sim.controls.thrust; else sim.controls.thrust = input.lever;
    sim.step(DT);
    events.push(...sim.events); sim.events.length = 0;
  };
  return { sim, input, ctl, step, events, log: window.__e2eLog };
}
const withAirframe = (base, id, patch) => ({ ...newDesign(base, { id }), airframe: { ...defaultAirframe(base), ...patch } });
function designsOf(base) {
  const af = defaultAirframe(base);
  const span = { ...af.wingL, span: 1.25 };
  return {
    'the tailplane at 0.7': withAirframe(base, 'p3-tail07', { tail: 0.7 }),
    'the tailplane at 1.5': withAirframe(base, 'p3-tail15', { tail: 1.5 }),
    'the span at 1.25': withAirframe(base, 'p3-span125', { wingL: span, wingR: { ...span }, mirror: true }),
  };
}

// 250 kt at 10,000 ft, clean, the A/THR holding the speed.
function cruise(design) {
  const def = designDef(design);
  const r = rig(design), { sim, input } = r, s = sim.state;
  sim.reset({ x: 0, y: 0, z: 10000 * FT, hdg: 0, onGround: false, iasMs: 250 * KT, flapLever: 0, gearDown: false, fuelKg: 12000, payloadKg: def.defaults.pax * 84 });
  sim.controls.flapLever = 0; sim.controls.gearDown = false;
  input.lever = sim.controls.thrust;
  sim.ap.setSpd(250); if (!sim.ap.athr) sim.ap.toggleAthr();
  return { r, sim, s };
}
// Trim: 40 s hands off.
function trim(design) {
  const { r, sim, s } = cruise(design);
  const z0 = s.pos.z; let qLate = 0;
  for (let k = 0; k < 120 * 40; k++) { r.step(); if (k > 120 * 20) qLate = Math.max(qLate, Math.abs(s.q) / DEG); }
  return { qLate, dzFt: (s.pos.z - z0) / FT, vsFpm: s.vs / FT * 60, elevDeg: sim._core.elev / DEG, iasErr: s.ias / KT - 250 };
}
// The turn: half wheel to 29°, let go (both laws hold the bank), 40 s.
function bank(design) {
  const { r, sim, s } = cruise(design);
  for (let k = 0; k < 120 * 5; k++) r.step();
  const z0 = s.pos.z; let t0 = null, lo = 99, hi = -99, betaMax = 0;
  for (let k = 0; k < 120 * 60; k++) {
    if (t0 === null) { sim.controls.roll = 0.5; if (s.roll / DEG >= 29) { sim.controls.roll = 0; t0 = s.t; } }
    r.step();
    if (t0 !== null && s.t - t0 > 3) { lo = Math.min(lo, s.roll / DEG); hi = Math.max(hi, s.roll / DEG); betaMax = Math.max(betaMax, Math.abs(s.beta) / DEG); }
    if (t0 !== null && s.t - t0 > 43) break;
  }
  return { lo, hi, betaMax, dzFt: (s.pos.z - z0) / FT };
}
// The capture: the AP on, 12,000 ft, a level change (OP CLB / FLCH).
function capture(design) {
  const { r, sim, s } = cruise(design);
  for (let k = 0; k < 120 * 5; k++) r.step();
  const ap = sim.ap; ap.setHdg(0); ap.hdgSel?.(); ap.setAlt(12000); ap.engageAp(); ap.levelChange();
  const tgt = 12000 * FT; let over = -1e9, settle = null;
  for (let k = 0; k < 120 * 180; k++) {
    r.step(); over = Math.max(over, s.altInd - tgt);
    if (settle === null && Math.abs(s.altInd - tgt) < 30 * FT && Math.abs(s.vs) < 100 * FT / 60) settle = s.t;
  }
  return { overFt: over / FT, errFt: (s.altInd - tgt) / FT, settle, mode: ap.vertical };
}
// The final and the landing (tests/designs-flight.test.mjs's).
function land(design) {
  const def = designDef(design);
  const r = rig(design), { sim, ctl, input } = r, s = sim.state;
  const dist = 10 * NM, z = 15 + Math.tan(3 * DEG) * dist;
  const finalFlap = def.data.FINAL_FLAP_LEVER ?? 1;
  const ic = { x: 0, y: -dist, z, hdg: 0, onGround: false, iasMs: 180 * KT, flapLever: finalFlap, gearDown: false, fuelKg: 12000, payloadKg: def.defaults.pax * 84 };
  sim.reset(ic);
  if (s.vmm && s.vmm / KT + 10 > 180) sim.reset({ ...ic, iasMs: (Math.round(s.vmm / KT) + 10) * KT });
  sim.controls.flapLever = finalFlap;
  input.lever = sim.controls.thrust = Math.min(sim.controls.thrust, sim.leverClimb);
  const ap = sim.ap;
  ap.setSpd(Math.round(s.ias / KT)); ap.engageAp(); if (!ap.athr) ap.toggleAthr();
  ctl.axis = { tx: 0, ty: 0, ux: 0, uy: 1, hdg: 0, elev: 0 };
  ctl.phase = 'approach';
  let td = null;
  for (let k = 0; k < 120 * 400 && ctl.phase !== 'stopped' && !s.crashed; k++) {
    r.step();
    for (const e of r.events) if (e.type === 'touchdown' && !td) td = e;
    r.events.length = 0;
  }
  return { crashed: s.crashed, phase: ctl.phase, td, pitch: td ? td.pitch / DEG : NaN, log: r.log };
}
// The Dutch roll: 0.3 pedal for 2 s at 250 kt, let go; the most |β| from 6 to 12 s after.
function dutch(design) {
  const { r, sim, s } = cruise(design);
  for (let k = 0; k < 120 * 3; k++) r.step();
  let b6 = 0;
  for (let k = 0; k < 120 * 14; k++) {
    sim.controls.yaw = k < 240 ? 0.3 : 0;
    r.step();
    const t = k / 120 - 2;
    if (t > 6 && t < 12) b6 = Math.max(b6, Math.abs(s.beta) / DEG);
  }
  return b6;
}

const fmt = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v));

for (const base of TYPES) {
  const ref = newDesign(base, { id: 'p3-base' });
  const B = { trim: trim(ref), bank: bank(ref), capture: capture(ref), land: land(ref) };
  const score = typeById(base).score;
  for (const [name, design] of Object.entries(designsOf(base))) {
    test(`${base} with ${name}: trims, holds a 30° bank, captures an altitude and lands as its base does`, () => {
      const def = designDef(design);
      assert.ok(def.data.GAIN_SCALE, 'a changed airframe carries its gain scales');
      for (const [k, v] of Object.entries(def.data.GAIN_SCALE)) assert.ok(Number.isFinite(v) && v > 0, `GAIN_SCALE.${k} = ${v}`);

      const t = trim(design);
      assert.ok(t.qLate < 0.3, `trimmed: |q| ${fmt(t)}`);
      assert.ok(Math.abs(t.vsFpm) < 100 && Math.abs(t.dzFt - B.trim.dzFt) < 50, `holds its path as the base (${fmt(B.trim)}): ${fmt(t)}`);
      assert.ok(Math.abs(t.iasErr) < 3 && Math.abs(t.elevDeg) < 3, `on speed, the elevator offloaded: ${fmt(t)}`);

      const b = bank(design);
      assert.ok(b.lo > 27 && b.hi < 33, `the bank within ±3° of 30°: ${fmt(b)}`);
      assert.ok(Math.abs(b.lo - B.bank.lo) < 1 && Math.abs(b.hi - B.bank.hi) < 1, `as its base's (${fmt(B.bank)}): ${fmt(b)}`);
      assert.ok(Math.abs(b.dzFt) < 100 && b.betaMax < B.bank.betaMax + 0.3, `coordinated and level: ${fmt(b)}`);

      const c = capture(design);
      assert.equal(c.mode, 'ALT', `captured: ${fmt(c)}`);
      assert.ok(c.overFt < 300 && Math.abs(c.errFt) < 100, `no overshoot past 300 ft, within 100 ft: ${fmt(c)}`);
      assert.ok(c.settle !== null && c.settle < B.capture.settle * 1.15 + 10, `settled as its base (${fmt(B.capture)}): ${fmt(c)}`);

      const l = land(design);
      assert.equal(l.crashed, null, `no crash: ${l.log.join(' | ')}`);
      assert.ok(l.td, `touched down: ${l.log.join(' | ')}`);
      assert.equal(l.phase, 'stopped');
      assert.ok(l.td.vsMs > -2.2 && l.td.vsMs > B.land.td.vsMs - 0.6, `the sink (base ${B.land.td.vsMs.toFixed(2)} m/s): ${l.td.vsMs.toFixed(2)} m/s`);
      assert.ok(l.td.g < 1.8, `the touchdown g: ${l.td.g.toFixed(2)}`);
      assert.ok(l.pitch > score.low - 1 && l.pitch < score.high, `the pitch in the landing score's band [${score.low}, ${score.high}] (base ${B.land.pitch.toFixed(1)}°): ${l.pitch.toFixed(1)}°`);
      assert.ok(Math.abs(l.td.x) < 15 && l.td.y > 0 && l.td.y < 1200, `on the runway: ${l.td.x.toFixed(1)}, ${l.td.y.toFixed(0)} m`);
    });
  }
  test(`${base} with the fin at 0.6: the yaw damper, scaled by the rudder's power, damps the Dutch roll as the base's`, () => {
    const fin = withAirframe(base, 'p3-fin06', { fin: 0.6 });
    const gs = designDef(fin).data.GAIN_SCALE;
    assert.ok(gs.yaw < 0.8, `a smaller fin, a weaker rudder: ${gs.yaw.toFixed(2)}`);
    const b0 = dutch(ref), b1 = dutch(fin);
    // Unscaled, the residual sideslip 6 to 12 s after the kick was 1.4 to 2.1 times the base's.
    assert.ok(b1 < 1.15 * b0 + 0.02, `|β| 6–12 s after the kick, base ${b0.toFixed(2)}°: ${b1.toFixed(2)}°`);
  });
}

// The laws' arithmetic: a GAIN_SCALE of all 1s is no GAIN_SCALE, to the bit, over a grid of states.
test('a GAIN_SCALE of all 1s gives the laws the base arithmetic exactly', () => {
  assert.equal(gainFor(1), 1);
  assert.equal(gainFor(undefined), 1);
  assert.equal(gainFor(0.25), 2);
  assert.equal(gainFor(4), 0.5);
  const ones = { pitch: 1, roll: 1, yaw: 1, pitchDamp: 1, rollDamp: 1, yawDamp: 1, pitchStiff: 1, yawStiff: 1, lift: 1 };
  for (const id of TYPES) {
    const A = typeById(id).data, A1 = { ...A, GAIN_SCALE: ones };
    const make = typeById(id).family === 'boeing' ? (a) => createFbwBoeing(a).fbwStep : (a) => createFbw(a).fbwStep;
    const f0 = make(A), f1 = make(A1);
    let n = 0;
    for (const onGround of [false, true]) for (const flt of [0, 0.5, 1]) for (const apOn of [false, true]) for (const autoTrim of [false, true])
      for (const sp of [-0.6, 0, 0.5]) for (const sy of [0, 0.4]) for (const aglFt of [40, 3000]) {
        const E = {
          tas: 120, ias: 110, mach: 0.36, qbar: 7000, alpha: 0.07, beta: 0.02, gamma: -0.05, phi: 0.3, theta: 0.03, psi: 0.1,
          p: 0.02, q: 0.01, r: 0.015, nz: 1.05, nAlpha: 1, vs: -3, gs: onGround ? 20 : 110, aglFt, onGround, gearDown: true,
          Ixx: 1e7, Iyy: 2e7, Izz: 3e7, Ixz: 1e5, myOther: 3e5, lOther: -2e5, elevScale: 4e6, rollScale: 2e6, rudLim: 0.4,
          alphaMax: 0.25, vls: 65, vsw: 58, slat: 1, flap: 25, apOn, apGamma: -0.05, apBank: 0.1,
          fAlong: 1e4, mass: 7e4, iasDot: 0.1, autoTrim,
        };
        const c = { pitch: sp, roll: 0.2, yaw: sy, law: 'normal', thrust: 0.3, trim: 0 };
        const X0 = { flt, flare: false, flareTheta: 0.05, flareT: 0, holdLatched: false, releaseT: 0, gammaRef: -0.05, rollLatched: false, phiRef: 0, protAlphaLatched: false,
          thsTakeoff: 0.01, elevCmd: 0, uRoll: 0, rudCmd: 0, thsRate: 0, protAlpha: false, protSpeed: false, alphaFloorTrig: false, elev: 0.02, ths: 0,
          vRef: 70, boGam: -0.05, boBankBack: false, boProtStall: false, boProtOver: false, boProtBank: false };
        const Xa = { ...X0 }, Xb = { ...X0 };
        for (let k = 0; k < 3; k++) { f0(Xa, c, { ...E }, DT); f1(Xb, c, { ...E }, DT); }
        for (const key of Object.keys(Xa)) assert.ok(Object.is(Xa[key], Xb[key]), `${id} ${key}: ${Xa[key]} against ${Xb[key]}`);
        n++;
      }
    assert.ok(n > 100);
  }
});
