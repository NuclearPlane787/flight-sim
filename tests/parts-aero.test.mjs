// v0.5.3, Part 1: the parts' aerodynamics (src/sim/parts-aero.js).
// - The validation table: parts(base) against lumped(base) for each type, each row to its tolerance where the factor
//   that sets it was fitted (tools/fit-parts-aero.mjs), and within the explained envelope elsewhere (STATUS.md, v0.5.3:
//   the lumped model holds its moment derivatives and control powers constant with Mach and flaps; the parts' don't).
// - A design's difference is exactly zero on the base's airframe.
// - The physics of a changed part: a bigger tailplane, a smaller fin, a longer span, the CG behind the neutral point,
//   one wing panel longer than the other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rows, TOL, trimState, POINTS } from './parts-aero-table.mjs';
import { partsModel, partsInto, partsDeltaInto, defaultSide } from '../src/sim/parts-aero.js';
import { typeById, kitFor } from '../src/sim/types.js';
import { newDesign, designDef, defaultAirframe } from '../src/sim/designs.js';
import { createSim } from '../src/sim/sim.js';

const IDS = ['a321neo', 'b787-9', 'b777-300er'];
const DEG = Math.PI / 180, KT = 0.514444;

// Where each row is held tight (the point its factor was fitted at, or every point for the rows the model gets
// everywhere), and the explained envelope (the ratio parts/lumped) at the other points.
const TIGHT = {
  CLa: ['cruise', 'clean', 'approach'], CL: ['cruise', 'clean', 'approach'], CD: ['cruise', 'clean', 'approach'],
  CLmax: ['cruise', 'clean', 'approach'], Clsp: ['cruise', 'clean', 'approach'],
  Cma: ['clean'], SM: ['clean'], Cmq: ['clean'], Cmadot: ['clean'], CYb: ['clean'], Cnb: ['clean'], Clb: ['clean'],
  Clp: ['clean'], Cnr: [], Cmde: ['clean'], Clda: ['clean'], Cndr: ['clean'],
};
// The explained differences (STATUS.md, v0.5.3's Part 1 entry), held per point to about ±0.1 around what the three
// types give, so a change to the model shows: at cruise the lumped model holds its moment derivatives and control
// powers constant with Mach while the parts' tail, fin and surfaces get Prandtl–Glauert (×1.2 to 1.7); at approach the
// flaps' downwash and Fowler chord move the pitch rows, and Clβ follows the lift coefficient (×1.9 to 2.7); Cnr has no
// factor of its own; the stabiliser's power (Cmths) is what the tail volume behind the lumped Cmq gives.
const ENVELOPE = {
  cruise: { Cma: [1.1, 1.4], SM: [1.1, 1.4], Cmq: [1.2, 1.45], Cmadot: [1.55, 1.9], CYb: [1.0, 1.3], Cnb: [1.3, 1.65], Clb: [1.2, 1.5],
    Clp: [1.15, 1.45], Cnr: [0.85, 1.25], Cmde: [1.2, 1.45], Clda: [1.15, 1.45], Cndr: [1.15, 1.45], Cmths: [0.85, 1.3] },
  clean: { Cnr: [0.68, 0.95], Cmths: [0.65, 0.95] },
  approach: { Cma: [0.9, 1.55], SM: [0.9, 1.6], Cmq: [0.85, 1.05], Cmadot: [1.05, 1.55], CYb: [0.75, 1.1], Cnb: [0.65, 1.12], Clb: [1.7, 2.85],
    Clp: [1.05, 1.4], Cnr: [0.65, 1.0], Cmde: [0.85, 1.05], Clda: [0.83, 1.25], Cndr: [0.75, 1.05], Cmths: [0.6, 0.9] },
};

for (const id of IDS) {
  test(`the validation table: parts(${id}) against its lumped model`, () => {
    const R = rows(id);
    const rowsHeld = new Set([...Object.keys(TOL), ...Object.values(ENVELOPE).flatMap((e) => Object.keys(e))]);
    for (const row of rowsHeld) {
      for (const pt of Object.keys(R)) {
        const x = R[pt].r[row];
        const ratio = x.parts / x.lumped, env = ENVELOPE[pt]?.[row];
        if ((TIGHT[row] || []).includes(pt)) assert.ok(Math.abs(ratio - 1) <= TOL[row], `${id} ${pt} ${row}: parts ${x.parts.toFixed(4)} lumped ${x.lumped.toFixed(4)} (${ratio.toFixed(3)})`);
        else if (env) assert.ok(ratio >= env[0] && ratio <= env[1], `${id} ${pt} ${row}: ratio ${ratio.toFixed(3)} outside the explained ${env}`);
        else assert.fail(`${id} ${pt} ${row}: neither held tight nor explained`);
      }
    }
    // trimmed where the lumped model is
    assert.ok(Math.abs(R.cruise.r.Cm.parts) < 0.002 && Math.abs(R.approach.r.Cm.parts) < 0.002);
    // the sim's analytic control powers agree with the finite differences
    for (const pt of Object.keys(R)) {
      const r = R[pt].r;
      assert.ok(Math.abs(r.CmdeAnalytic.parts / r.Cmde.parts - 1) < 0.02, `${pt} elevator analytic`);
      assert.ok(Math.abs(r.CldaAnalytic.parts / r.Clda.parts - 1) < 0.03, `${pt} aileron analytic`);
      assert.ok(Math.abs(r.ClspAnalytic.parts / r.Clsp.parts - 1) < 0.03, `${pt} spoiler analytic`);
    }
  });
}

test('the difference is exactly zero on the base airframe, and a design on it carries no parts model', () => {
  for (const id of IDS) {
    const P = partsModel(id), A = typeById(id).data;
    const { s } = trimState(id, POINTS[id].approach);
    const o = {}; kitFor(id).fm.coefficients({ ...s, beta: 0.05, phat: 0.01, rhat: -0.01 }, o);
    const before = { ...o };
    partsDeltaInto({ design: P, base: P }, { ...s, beta: 0.05, phat: 0.01, rhat: -0.01 }, o);
    for (const k of ['CL', 'CD', 'CY', 'Cl', 'Cm', 'Cn', 'CmElev', 'clmax']) assert.equal(o[k], before[k], `${id} ${k}`);
    assert.equal(o.dClAil, 0); assert.equal(o.dClSp, 0);
    assert.equal(designDef(newDesign(id)).data.PARTS_AERO, undefined);
    assert.equal(designDef({ ...newDesign(id), airframe: defaultAirframe(id) }).data.PARTS_AERO, undefined);
    assert.ok(A.CL_ROLL.aileron > 0);
  }
});

// ---- the physics of a changed part ----
// The design's coefficients at a state: the lumped model plus the parts' difference (as sim.js).
function designCoeffs(id, af, s) {
  const o = {};
  kitFor(id).fm.coefficients(s, o);
  if (af) partsDeltaInto({ design: partsModel(id, af), base: partsModel(id) }, s, o);
  else { o.dClAil = 0; o.dClSp = 0; }
  return o;
}
const airframe = (id, patch = {}, sides = {}) => {
  const d = defaultSide(id);
  return { wingL: { ...d, ...sides.L, ...sides.both }, wingR: { ...d, ...sides.R, ...sides.both }, tail: 1, fin: 1, plugFwd: 0, plugAft: 0, ...patch };
};
const deriv = (id, af, s, key, field, h) => (designCoeffs(id, af, { ...s, [key]: s[key] + h })[field] - designCoeffs(id, af, { ...s, [key]: s[key] - h })[field]) / (2 * h);

// The short period's frequency and damping (the usual two-state approximation), CG at the reference point.
function shortPeriod(id, af, pt) {
  const A = typeById(id).data, { s, q, V } = trimState(id, pt);
  const m = pt.kg, Iyy = A.IYY_PER_KG * m, Sc = q * A.S * A.MAC, k = A.MAC / (2 * V);
  const CLa = deriv(id, af, s, 'alpha', 'CL', 0.5 * DEG), Cma = deriv(id, af, s, 'alpha', 'Cm', 0.5 * DEG);
  const Cmq = deriv(id, af, s, 'qhat', 'Cm', 0.005), Cmad = deriv(id, af, s, 'adothat', 'Cm', 0.005);
  const CD = designCoeffs(id, af, s).CD;
  const Za = -q * A.S * (CLa + CD) / m, Ma = Sc * Cma / Iyy, Mq = Sc * Cmq * k / Iyy, Mad = Sc * Cmad * k / Iyy;
  const w2 = Za * Mq / V - Ma, w = Math.sqrt(w2), zeta = -(Mq + Mad + Za / V) / (2 * w);
  return { w, zeta, SM: -Cma / CLa, Cma, CLa };
}
// The Dutch roll's (a three-term approximation: Cnβ's frequency, Cnr's and Yβ's damping).
function dutchRoll(id, af, pt) {
  const A = typeById(id).data, { s, q, V } = trimState(id, pt);
  const m = pt.kg, Izz = (A.IZZ_ZFW_PER_KG) * m, Sb = q * A.S * A.SPAN;
  const Cnb = deriv(id, af, s, 'beta', 'Cn', 1 * DEG), Cnr = deriv(id, af, s, 'rhat', 'Cn', 0.005), CYb = deriv(id, af, s, 'beta', 'CY', 1 * DEG);
  const w = Math.sqrt(Sb * Cnb / Izz), zeta = -(Sb * Cnr * A.SPAN / (2 * V) / Izz + q * A.S * CYb / (m * V)) / (2 * w);
  return { w, zeta, Cnb, Cnr };
}

for (const id of IDS) {
  const pt = POINTS[id].clean;
  test(`${id}: a tailplane 30 % bigger: more static margin, by about its share, and a quicker, better damped short period`, () => {
    const base = shortPeriod(id, null, pt), big = shortPeriod(id, airframe(id, { tail: 1.3 }), pt), small = shortPeriod(id, airframe(id, { tail: 0.7 }), pt);
    assert.ok(big.SM > base.SM + 0.03, `SM ${base.SM.toFixed(3)} → ${big.SM.toFixed(3)}`);
    assert.ok(small.SM < base.SM - 0.03);
    // the tail's share of Cmα is about linear in its area: +30 % and −30 % move it about equally
    const up = big.Cma - base.Cma, dn = base.Cma - small.Cma;
    assert.ok(up < 0 && dn < 0 && Math.abs(up / dn - 1) < 0.35, `ΔCmα +${up.toFixed(3)} −${dn.toFixed(3)}`);
    // the frequency goes as √(stiffness), the damping with the tail's Cmq
    assert.ok(big.w > base.w * 1.05 && small.w < base.w * 0.95, `ω ${base.w.toFixed(3)} → ${big.w.toFixed(3)}`);
    assert.ok(Math.abs(big.w / base.w - Math.sqrt((big.Cma - 0.06) / (base.Cma - 0.06))) < 0.08);
    assert.ok(big.zeta > 0.2 && small.zeta > 0.15);
  });
  test(`${id}: a fin 30 % smaller: less Cnβ and a Dutch roll that dies out more slowly`, () => {
    const base = dutchRoll(id, null, pt), small = dutchRoll(id, airframe(id, { fin: 0.7 }), pt);
    assert.ok(small.Cnb < base.Cnb * 0.85 && small.Cnb > 0, `Cnβ ${base.Cnb.toFixed(4)} → ${small.Cnb.toFixed(4)}`);
    assert.ok(small.Cnr > base.Cnr, 'less yaw damping');
    // less damped: the oscillation decays more slowly (ζω, 1/s). (Its damping ratio barely moves: the frequency, √Cnβ
    // with the body's destabilising moment unchanged, falls about as fast as the damping does.)
    assert.ok(small.zeta * small.w < base.zeta * base.w, `ζω ${(base.zeta * base.w).toFixed(4)} → ${(small.zeta * small.w).toFixed(4)}`);
  });
  test(`${id}: a span 25 % longer: a steeper lift curve, less induced drag at the same lift, more roll damping`, () => {
    const af = airframe(id, {}, { both: { span: 1.25 } });
    const { s } = trimState(id, pt);
    assert.ok(deriv(id, af, s, 'alpha', 'CL', 0.5 * DEG) > deriv(id, null, s, 'alpha', 'CL', 0.5 * DEG) * 1.15);
    // the drag at the base's trimmed CL: the longer wing reaches it at a lower α
    const CL0 = designCoeffs(id, null, s).CL;
    let a = s.alpha;
    for (let i = 0; i < 30; i++) a -= (designCoeffs(id, af, { ...s, alpha: a }).CL - CL0) / 6;
    const cdLong = designCoeffs(id, af, { ...s, alpha: a }).CD, cdBase = designCoeffs(id, null, s).CD;
    // the profile drag grows with the area (+25 %); the induced drag (≈ 40 % of the total here) falls with the span²
    const Pb = partsModel(id), Pl = partsModel(id, af);
    assert.ok(Pl.nums.ARw > Pb.nums.ARw * 1.15);
    const indB = CL0 * CL0 / (Math.PI * 0.8 * Pb.nums.ARw), indL = CL0 * CL0 / (Math.PI * 0.8 * Pl.nums.ARw);
    assert.ok(cdLong - cdBase < 0.3 * (indB - indL) + 0.002 && cdLong - cdBase < 0.004, `CD ${cdBase.toFixed(4)} → ${cdLong.toFixed(4)}`);
    const induced = (P, sx) => { const o = {}; partsInto(P, sx, o); return o.CLw * o.CLw / (Math.PI * typeById(id).data.OSWALD * P.nums.ARw); };
    assert.ok(induced(Pl, { ...s, alpha: a }) < induced(Pb, s));
    assert.ok(deriv(id, af, s, 'phat', 'Cl', 0.005) < deriv(id, null, s, 'phat', 'Cl', 0.005) * 1.3, 'more roll damping');
  });
  test(`${id}: the CG behind the parts' neutral point is unstable`, () => {
    const af = airframe(id, { tail: 0.6 });
    const sp = shortPeriod(id, af, pt);
    // about a CG at the neutral point plus 5 % MAC: Cmα about the CG = Cmα + CLα·Δx/c
    const cmaCg = sp.Cma + sp.CLa * (sp.SM + 0.05);
    assert.ok(cmaCg > 0, `Cmα about the CG ${cmaCg}`);
  });
  test(`${id}: one wing panel longer than the other rolls the aircraft (towards the short one)`, () => {
    const af = airframe(id, {}, { L: { span: 1.15 } });
    const { s } = trimState(id, pt);
    const o = designCoeffs(id, af, s);
    assert.ok(o.Cl > 0.005, `Cl ${o.Cl}: the longer left wing lifts more and rolls right`);
    assert.ok(designCoeffs(id, null, s).Cl === 0);
  });
}

test('a design with a tailplane 30 % bigger flies in the sim: trimmed, and stiffer in pitch than its base', () => {
  for (const id of IDS) {
    const d0 = newDesign(id), d1 = { ...newDesign(id), airframe: { ...defaultAirframe(id), tail: 1.3 } };
    assert.ok(designDef(d1).data.PARTS_AERO, 'carries the parts model');
    const fly = (d) => {
      const sim = createSim({ type: d });
      sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 3000, iasMs: 250 * KT, flapLever: 0, gearDown: false, fuelKg: 20000, payloadKg: 15000 });
      sim.controls.thrust = 0.7;
      let maxQ = 0;
      for (let i = 0; i < 120 * 30; i++) { sim.step(1 / 120); maxQ = Math.max(maxQ, Math.abs(sim.state.q)); }
      return { sim, maxQ };
    };
    const a = fly(d0), b = fly(d1);
    // flies as its base does with the same hands-off controls (the A321 holds its path; the Boeings are speed-stable)
    const A = a.sim.state, B = b.sim.state;
    assert.ok(!B.crashed && Math.abs(B.pitch - A.pitch) < 2 * DEG && Math.abs(B.vs - A.vs) < 3 && Math.abs(B.ias - A.ias) < 5, `${id}: pitch ${A.pitch / DEG}° → ${B.pitch / DEG}°, vs ${A.vs} → ${B.vs}, ias ${A.ias} → ${B.ias}`);
    assert.ok(b.maxQ < 2 * DEG, `${id} settles (|q| ${b.maxQ / DEG}°/s)`);
    assert.ok(Number.isFinite(a.sim.state.alpha));
  }
});
