// v0.5.4, item 4: sweep raises the top of the coffin corner. The parts' strips lose their maximum lift with the Mach
// normal to their side's quarter chord (M × cos Λ_side / cos Λ_base; exactly M on the base's wing), and a design's
// MMO follows the mean sweep (Korn: the base's × cos Λ_base / cos Λ_mean, within 0.70–0.95). At FL450 a six-GE90 777
// at 265 t is closed on its own wing; 8° more sweep opens a window between the shaker and MMO, 8° less lowers MMO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { newDesign, designDef, defaultAirframe, designNumbers } from '../src/sim/designs.js';
import { partsModel, wingClmax, clmaxDelta } from '../src/sim/parts-aero.js';
import { typeById } from '../src/sim/types.js';

const IDS = ['a321neo', 'b787-9', 'b777-300er'];
const DEG = Math.PI / 180, KT = 0.514444, FT = 0.3048;
const withWings = (base, wingL, wingR = wingL, extra = {}) => {
  const af = defaultAirframe(base);
  return { ...af, ...extra, wingL: { ...af.wingL, ...wingL }, wingR: { ...af.wingR, ...wingR }, mirror: false };
};
const clmaxMach = (A, Mn) => Math.max(0.55, 1 - A.CLMAX_MACH_SLOPE * Math.max(0, Mn - 0.35));

test('each side\'s maximum lift falls with its own normal Mach; the base\'s wing keeps M exactly', () => {
  for (const id of IDS) {
    const A = typeById(id).data;
    const Pb = partsModel(id);
    assert.deepEqual(Pb.normalMach, [1, 1], `${id}: the base's wing`);
    // a tail or a plug changes nothing on the wing: its maximum lift is the base's to the bit, at any Mach
    const Pt = partsModel(id, withWings(id, {}, {}, { tail: 1.3, plugAft: 2 }));
    assert.deepEqual(Pt.normalMach, [1, 1], `${id}: the tail's design`);
    for (const M of [0.3, 0.6, 0.85]) assert.equal(clmaxDelta({ design: Pt, base: Pb }, 0, 0, M), 0, `${id} M${M}`);
    // 8° more on the left, 8° less on the right: each side's factor is cos Λ_side / cos Λ_base
    const P = partsModel(id, withWings(id, { sweep: 8 }, { sweep: -8 }));
    const kL = Math.cos(A.SWEEP + 8 * DEG) / Math.cos(A.SWEEP), kR = Math.cos(A.SWEEP - 8 * DEG) / Math.cos(A.SWEEP);
    assert.ok(Math.abs(P.normalMach[0] - kL) < 1e-12 && Math.abs(P.normalMach[1] - kR) < 1e-12, `${id}: ${P.normalMach}`);
    // the clean wing's maximum lift at M0.85 against M0.30 is the lumped model's loss at each side's normal Mach
    // (the stall's spread along the span sums to nothing)
    const sym = (sw) => partsModel(id, withWings(id, { sweep: sw }));
    for (const [Q, k] of [[Pb, 1], [sym(8), kL], [sym(-8), kR]]) {
      const ratio = wingClmax(Q, 0, 0, 0.85) / wingClmax(Q, 0, 0, 0.30);
      const want = clmaxMach(A, 0.85 * k) / clmaxMach(A, 0.30 * k);
      assert.ok(Math.abs(ratio - want) < 1e-9, `${id} k ${k}: ${ratio} vs ${want}`);
    }
    // so more sweep keeps more of it at a high Mach, less sweep less
    const keep = (Q) => wingClmax(Q, 0, 0, 0.85) / wingClmax(Q, 0, 0, 0.30);
    assert.ok(keep(sym(8)) > keep(Pb) && keep(sym(-8)) < keep(Pb), id);
  }
});

test('MMO follows the mean sweep (Korn), within 0.70–0.95; an unchanged sweep keeps the base\'s exactly', () => {
  const d = (id, wingL, wingR = wingL, extra) => designDef({ ...newDesign(id), airframe: withWings(id, wingL, wingR, extra) });
  for (const id of IDS) {
    const A = typeById(id).data;
    // no sweep change: the base's MMO, to the bit (other changes or none)
    assert.equal(designDef(newDesign(id)).data.MMO, A.MMO);
    assert.equal(d(id, { span: 1.15, chord: 1.1 }, undefined, { tail: 1.3 }).data.MMO, A.MMO);
    assert.equal(d(id, { sweep: 5 }, { sweep: -5 }).data.MMO, A.MMO, 'a mean of zero');
    for (const sw of [-8, -4, 3, 8]) {
      const want = Math.min(0.95, Math.max(0.70, A.MMO * Math.cos(A.SWEEP) / Math.cos(A.SWEEP + sw * DEG)));
      const got = d(id, { sweep: sw }).data.MMO;
      assert.ok(Math.abs(got - want) < 1e-12, `${id} ${sw}°: ${got} vs ${want}`);
      assert.ok(sw > 0 ? got > A.MMO : got < A.MMO, `${id} ${sw}°`);
    }
    // one side only: the mean
    const one = d(id, { sweep: 8 }, { sweep: 0 }).data.MMO;
    assert.ok(Math.abs(one - Math.min(0.95, A.MMO * Math.cos(A.SWEEP) / Math.cos(A.SWEEP + 4 * DEG))) < 1e-12, id);
    assert.equal(designNumbers(d(id, { sweep: -8 })).mmo, d(id, { sweep: -8 }).data.MMO);
  }
  // the 777: +8° is past the clamp, −8° about 0.827
  assert.equal(d('b777-300er', { sweep: 8 }).data.MMO, 0.95);
  assert.ok(Math.abs(d('b777-300er', { sweep: -8 }).data.MMO - 0.8271) < 5e-4);
});

// ISA above 11 km: the CAS of a Mach at a height (FL450 by default)
const H = 45000 * FT;
const casOf = (M, h = H) => {
  const p = 22632.06 * Math.exp(-9.80665 * (h - 11000) / (287.053 * 216.65)), qc = p * ((1 + 0.2 * M * M) ** 3.5 - 1);
  return 340.294 * Math.sqrt(5 * ((qc / 101325 + 1) ** (2 / 7) - 1));
};
// A six-GE90 777 at 265 t with its wing swept by sw: the Machs from 0.70 to its MMO at which the IAS is clear of the
// shaker and of the amber band (the first of each, null if none), the window (MMO less the first clear of the shaker),
// and the speeds at M0.82.
function corner(sw) {
  const des = { ...newDesign('b777-300er', { id: 'six', count: 6, engine: 'ge90-115b' }), airframe: withWings('b777-300er', { sweep: sw }) };
  const def = designDef(des), sim = createSim({ type: des }), MMO = def.data.MMO;
  const payload = Math.min(30000, def.data.MAX_PAYLOAD), fuel = 265000 - def.data.OEW - payload;
  let shaker = null, amber = null, at82 = null, mass = 0;
  for (let i = 0; 0.70 + 0.005 * i <= MMO + 1e-9; i++) {
    const M = 0.70 + 0.005 * i;
    sim.reset({ x: 0, y: 0, z: H, hdg: 0, onGround: false, iasMs: casOf(M), flapLever: 0, gearDown: false, fuelKg: fuel, payloadKg: payload });
    sim.step(1 / 120);
    const s = sim.state;
    mass = s.mass;
    if (shaker === null && s.ias >= s.vStick) shaker = M;
    if (amber === null && s.ias >= s.vmm) amber = M;
    if (i === 24) at82 = { stick: s.vStick / KT, vmm: s.vmm / KT, vmax: s.vmax / KT };
  }
  return { MMO, mass, shaker, amber, window: shaker === null ? 0 : MMO - shaker, at82 };
}

test('FL450, six GE90s on a 777 at 265 t: closed on its own wing, +8° opens a window, −8° lowers MMO', () => {
  const b = corner(0), up = corner(8), dn = corner(-8);
  for (const c of [b, up, dn]) assert.ok(Math.abs(c.mass - 265000) < 1, `${c.mass}`);
  assert.equal(b.MMO, 0.89);
  assert.equal(b.window, 0, 'the base wing: the shaker reaches MMO');
  assert.ok(up.MMO > b.MMO && up.window > 0.1, `+8°: MMO ${up.MMO}, clear of the shaker from M${up.shaker}`);
  assert.ok(up.amber !== null && up.amber < up.MMO, `+8°: clear of the amber from M${up.amber}`);
  // the shaker lower and the top higher at the same Mach
  assert.ok(up.at82.stick < b.at82.stick - 5 && up.at82.vmax > b.at82.vmax + 5, JSON.stringify([up.at82, b.at82]));
  assert.ok(dn.MMO < b.MMO && dn.window <= b.window, `−8°: MMO ${dn.MMO}`);
  assert.ok(dn.at82.stick > b.at82.stick && dn.at82.vmax < b.at82.vmax, JSON.stringify([dn.at82, b.at82]));
});

test('the overspeed warning and the speed tape\'s top use the design\'s MMO', () => {
  const des = { ...newDesign('b787-9'), airframe: withWings('b787-9', { sweep: 8 }) };
  const MMO = designDef(des).data.MMO, M = 0.915;
  assert.ok(MMO > M + 0.01, `${MMO}`);
  for (const [d, over, label] of [[newDesign('b787-9'), true, 'base'], [des, false, '+8°']]) {
    const sim = createSim({ type: d });
    sim.reset({ x: 0, y: 0, z: 37000 * FT, hdg: 0, onGround: false, iasMs: casOf(M, 37000 * FT), flapLever: 0, gearDown: false, fuelKg: 30000, payloadKg: 20000 });
    sim.step(1 / 120);
    assert.ok(Math.abs(sim.state.mach - M) < 0.005, `${sim.state.mach}`);
    assert.equal(sim.state.warnings.overspeed, over, `${label} at M${sim.state.mach.toFixed(3)}`);
    // the tape's top: the IAS at MMO here (the base's at 0.90)
    const top = sim.state.vmax / sim.state.ias * sim.state.mach;
    assert.ok(Math.abs(top - (over ? 0.90 : MMO)) < 0.01, `${label}: the top at M${top.toFixed(3)}`);
  }
});
