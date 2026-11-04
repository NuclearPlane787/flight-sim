// The 777-300ER's flight model against its documents: the sim is flown from the outside, by a pilot who only
// moves the stick (c.pitch) to chase an attitude, so these don't depend on what the control law does when the
// stick is let go (src/sim/fbw-boeing.js is written apart from this file), or set up by reset() and read at the
// trimmed point. Tolerances and why are next to each check; the numbers are reference/notes/b777-300er-performance.md. Adapted from tests/b787-9-performance.test.mjs.
//
// [ACAP] Boeing D6-58329-2 Rev G. 3-13: the take-off chart (standard day, dry). 3-30: the flaps 30 landing chart. 3-3: the
// payload/range chart. 7-8: weight on the main gear and the CG envelope. 2-7: the clearances. [ARC] Boeing's approach speeds: 150 kt at MLW.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { iasFromMach } from '../src/sim/atmosphere.js';
import { kitFor } from '../src/sim/types.js';
import * as A from '../src/sim/b777-300er.js';
import * as G from '../src/geometry-b777-300er.js';

const KT = 0.514444, FT = 0.3048, FPM = FT / 60, DEG = Math.PI / 180, DT = 1 / 120, GRAV = 9.80665;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dbg = (...a) => { if (process.env.SIM_DEBUG) console.log(...a); };
const FM = kitFor('b777-300er').fm;

const lever = A.FLAP_LEVER;
const flap = (name) => lever.indexOf(name);
// Fuel first (the centre tank up to what the wings leave), the rest payload, as a loadsheet would.
const load = (massKg, payloadKg) => ({ fuelKg: massKg - A.OEW - payloadKg, payloadKg });

function air({ massKg, payloadKg = 40000, altFt, iasKt, mach, flapName = 'UP', gearDown = false }) {
  const sim = createSim({ type: 'b777-300er' });
  const z = altFt * FT;
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z, iasMs: mach ? iasFromMach(mach, z) : iasKt * KT, flapLever: flap(flapName), gearDown, ...load(massKg, payloadKg) });
  return sim;
}
function ground({ massKg, payloadKg = 40000, flapName = '20' }) {
  const sim = createSim({ type: 'b777-300er' });
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: true, flapLever: flap(flapName), gearDown: true, ...load(massKg, payloadKg) });
  return sim;
}
// The pilot: the stick chases a pitch attitude, damped on the pitch rate.
const chase = (s, c, thetaDeg, k = 0.35) => { c.pitch = clamp(k * (thetaDeg - s.pitch / DEG) - 0.5 * s.q / DEG, -1, 1); };
const vs1g = (massKg, flapName) => {
  const cf = A.CONFIGS[flapName];
  return Math.sqrt(2 * massKg * GRAV / (1.225 * A.S * FM.liftCurve(cf.slat, cf.flap, {}).clmax)) / KT;
};

// ---- Take-off ----
// CS/FAR take-off field length = the longest of 1.15 × all engines to 35 ft, one engine out to 35 ft, and
// accelerate-stop. The sim flies all engines, so 1.15 × its distance must not exceed the chart (+5% for reading it),
// and shouldn't fall far below it: the band 0.80 to 1.05 is the A321neo's (tests/sim-takeoff.test.mjs), with the same
// reason. At a twin's MTOW the one-engine case governs, so the all-engines figure sits low in the band, not at 1.
// [ACAP] 3-13: at sea level the whole curve down to the MTOW lies on the chart's flaps 20 side of its flaps 15/20 kink, so flaps 20.
function takeoff(massKg, flapName = '20') {
  const sim = ground({ massKg, flapName });
  const s = sim.state, c = sim.controls;
  const v2 = 1.13 * vs1g(massKg, flapName), vr = v2 - 7; // [EST] VR about V2 − 7 kt, the usual gap
  c.thrust = 1;
  let t0 = null, lo = null, d35 = null, maxP = 0, ev = false, vs35 = 0, vTd = 0;
  for (let i = 0; i < 120 / DT; i++) {
    const ias = s.ias / KT;
    if (ias >= vr) {
      t0 ??= s.t;
      // 2.5°/s (the long body: Boeing's 2 to 3°/s) to 8° (the lift-off attitude, under the tail's 10°); once airborne, on towards the climb's 12°.
      chase(s, c, lo ? Math.min(12, 8 + (s.t - lo.t) * 2.5) : Math.min(8, -0.5 + (s.t - t0) * 2.5), 0.5);
    }
    sim.step(DT);
    maxP = Math.max(maxP, s.pitch / DEG);
    if (!lo && !s.wow.left && !s.wow.right && !s.wow.nose) lo = { ias: s.ias / KT, d: s.pos.y, p: s.pitch / DEG, t: s.t };
    if (lo && s.agl > 35 * FT) { d35 = s.pos.y; vTd = s.ias / KT; vs35 = s.vs / FPM; break; }
    if (s.crashed) break;
  }
  return { crashed: s.crashed, vr, v2, lo, d35, v35: vTd, vs35, maxP };
}
const TOFL_HI = [ // [ACAP] 3-13, sea level, standard day: chart reads to about ±100 ft.
  [351534, 3072], // 775,000 lb, the MTOW line: 10,080 ft
  [317515, 2478], // 700,000 lb: 8,130 ft
  [272155, 1829], // 600,000 lb: 6,000 ft
];
for (const [mass, tofl] of TOFL_HI) {
  test(`take-off at ${mass / 1000} t, flaps 20, sea level ISA: 1.15 × distance to 35 ft within 0.80 to 1.05 of [ACAP] 3-13's ${tofl} m`, () => {
    const r = takeoff(mass);
    dbg(JSON.stringify(r));
    assert.equal(r.crashed, null);
    assert.ok(r.lo, 'lifted off');
    const ratio = 1.15 * r.d35 / tofl;
    dbg(`  1.15·d35 ${(1.15 * r.d35).toFixed(0)} m = ${(ratio * 100).toFixed(0)}%`);
    assert.ok(ratio > 0.80 && ratio < 1.05, `1.15 × ${r.d35.toFixed(0)} m = ${(ratio * 100).toFixed(0)}% of ${tofl}`);
    // Lift-off about 4 s after VR ([EST] a normal rotation: at 3 to 4 kt/s, within 22 kt), and the tail clear: the pilot's
    // attitude never reaches the strike pitch before lift-off, and there's a real margin there.
    assert.ok(r.lo.ias > r.vr && r.lo.ias < r.vr + 22, `lift-off ${r.lo.ias.toFixed(0)} kt, VR ${r.vr.toFixed(0)}`);
    assert.ok(r.lo.p < A.PITCH_TAILSTRIKE_DEG - 0.5, `pitch at lift-off ${r.lo.p.toFixed(1)}°`);
    // Well under the tyre limit, and climbing through 35 ft.
    assert.ok(r.lo.ias < A.TYRE_LIMIT_KT - 5);
    assert.ok(r.vs35 > 500, `${r.vs35.toFixed(0)} fpm at 35 ft`);
  });
}

test('a full pull held at low speed on the runway strikes the tail, and the sim says so', () => {
  const sim = ground({ massKg: 300000 });
  const s = sim.state, c = sim.controls;
  const vr = 1.13 * vs1g(300000, '20') - 25; // slower than it can fly at that attitude: stays on the mains
  let struck = false;
  for (let i = 0; i < 120 / DT; i++) {
    c.thrust = s.ias / KT < vr ? 1 : 0.3;
    if (s.ias / KT > vr) c.pitch = 1;
    sim.step(DT);
    for (const e of sim.events || []) if (e.type === 'tailstrike') struck = true;
    if (s.crashed) break;
    if (s.agl > 5) break;
  }
  assert.ok(s.crashed === 'tail strike' || struck, `crashed: ${s.crashed}, pitch ${(s.pitch / DEG).toFixed(1)}°, agl ${s.agl.toFixed(1)}`);
});

// ---- Approach and landing ----
test('approach speed at MLW: 1.23 VS1g in flaps 30 is [ARC]\'s 150 kt, ±3 kt', () => {
  const v = 1.23 * vs1g(A.MLW, '30');
  dbg('VREF30 at MLW', v);
  assert.ok(Math.abs(v - A.VREF30_MLW_KT) < 3, `${v.toFixed(1)} kt`);
});

// A 3° approach at VREF + 5 to 50 ft, a flare, and the mains and brakes.
function land(massKg, payloadKg = 30000, noFlare = false) {
  const vref = 1.23 * vs1g(massKg, '30'), vapp = vref + 5;
  // From 2,000 ft, to be settled well before 50 ft.
  const sim = air({ massKg, payloadKg, altFt: 2000, iasKt: vapp, flapName: '30', gearDown: true });
  const s = sim.state, c = sim.controls;
  c.spoilersArmed = true;
  let theta = s.pitch / DEG, y50 = null, ias50 = 0, ytd = null, phase = 'app', stable = null;
  let maxNz = 0, maxMain = 0, maxNose = 0;
  let stopped = false, tdFpm = 0, tdP = 0, tdIas = 0, thr = c.thrust;
  for (let i = 0; i < 360 / DT; i++) {
    const aglFt = s.agl / FT, ias = s.ias / KT, vsFpm = s.vs / FPM;
    if (s.onGround && phase !== 'roll' && (s.wow.left || s.wow.right)) {
      phase = 'roll'; ytd = s.pos.y; tdFpm = vsFpm; tdP = s.pitch / DEG; tdIas = ias;
    }
    if (phase === 'app') {
      const vsT = -ias * 101.27 * Math.tan(3 * DEG);
      theta = clamp(theta + clamp(0.002 * (vsT - vsFpm), -1, 1) * DT, -2, 6);
      chase(s, c, theta);
      thr = clamp(thr + 0.004 * (vapp - ias) * DT, 0, 1);
      c.thrust = clamp(thr + 0.012 * (vapp - ias), 0, 1);
      if (y50 === null && aglFt < 50) { y50 = s.pos.y; ias50 = ias; stable = { pitch: s.pitch / DEG, n1: s.engines[0].n1, vs: vsFpm, ias }; }
      if (aglFt < 30 && !noFlare) phase = 'flare';
    } else if (phase === 'flare') {
      // A certification flare, firm and short: sink rate brought down with the height left to about 300 ft/min (the demonstrated
      // distance isn't a greaser's), thrust off at 20 ft.
      if (aglFt < 20) c.thrust = 0;
      const vsT = -300 - (Math.abs(stable.vs) - 300) * clamp(aglFt / 30, 0, 1);
      theta = clamp(theta + clamp(0.012 * (vsT - vsFpm), -3, 3) * DT, -2, 6.5);
      chase(s, c, theta, 0.6);
    } else {
      // Rolling: [ACAP]'s chart is the certified distance: auto spoilers, anti-skid, full manual brakes, no reverse.
      c.thrust = 0;
      if (!s.wow.nose) chase(s, c, -0.5, 0.15); else c.pitch = 0;
      c.brakeL = c.brakeR = 1;
      if (s.gs < 0.5) { stopped = true; break; }
    }
    sim.step(DT);
    if (phase === 'roll') { maxNz = Math.max(maxNz, s.nz); maxMain = Math.max(maxMain, s.gearCompression.left); maxNose = Math.max(maxNose, s.gearCompression.nose); }
    if (s.crashed) break;
  }
  return { maxNz, maxMain, maxNose, crashed: s.crashed, vref, vapp, stable, ias50, air: ytd - y50, roll: s.pos.y - ytd, dist: s.pos.y - y50, tdFpm, tdP, tdIas, stopped, gsp: s.groundSpoilers };
}
const LFL_DRY = [ // [ACAP] 3-30, sea level, dry, flaps 30: chart reads to about ±100 ft.
  [251290, 1770], // MLW: 5,810 ft
  [208652, 1543], // 460,000 lb: 5,060 ft
];
for (const [mass, lfl] of LFL_DRY) {
  test(`landing at ${mass / 1000} t, flaps 30, dry, sea level: stop from 50 ft within 0.85 to 1.15 of 0.6 × [ACAP] 3-30's ${lfl} m`, () => {
    // The chart's field length is the demonstrated distance / 0.6 (CS 25.125 and the operating rules). The band: the chart's
    // reading and a pilot's flare and brake timing, ±15%.
    const r = land(mass);
    dbg(JSON.stringify(r));
    assert.equal(r.crashed, null);
    assert.ok(r.stopped, 'stopped');
    const ratio = r.dist / (0.6 * lfl);
    dbg(`  ${r.dist.toFixed(0)} m from 50 ft = ${(ratio * 100).toFixed(0)}% of 0.6 × LFL (${(0.6 * lfl).toFixed(0)} m)`);
    assert.ok(ratio > 0.85 && ratio < 1.15, `${r.dist.toFixed(0)} m, ${(ratio * 100).toFixed(0)}%`);
    assert.ok(r.gsp > 0.9, 'ground spoilers deployed');
    assert.ok(r.tdP < A.PITCH_TAILSTRIKE_DEG - 1.5, `touchdown pitch ${r.tdP.toFixed(1)}°`);
  });
}

test('3° approach at VREF30 + 5, MLW: pitch +0.5 to +4° and N1 in the working range', () => {
  // [EST] no document gives these: a normal approach attitude is low single digits, and N1 about 50 to 65%.
  const r = land(A.MLW);
  dbg(JSON.stringify(r.stable));
  assert.ok(r.stable.pitch > 0.5 && r.stable.pitch < 4, `pitch ${r.stable.pitch.toFixed(2)}°`);
  assert.ok(r.stable.n1 > 45 && r.stable.n1 < 75, `N1 ${r.stable.n1.toFixed(0)}%`);
  assert.ok(Math.abs(r.ias50 - r.vapp) < 6, `over 50 ft at ${r.ias50.toFixed(0)} kt against ${r.vapp.toFixed(0)}`);
});

// ---- Climb ----
function climb(massKg, iasKt, fromFt, toFt, mach) {
  const sim = air({ massKg, altFt: fromFt, iasKt, mach });
  const s = sim.state, c = sim.controls;
  c.thrust = kitFor('b777-300er').eng.LEVER_CL; // climb thrust
  const hold = mach ? null : iasKt;
  let theta = s.pitch / DEG + 3;
  const spd = () => (mach ? s.mach * 600 : s.ias / KT), tgt = mach ? mach * 600 : hold;
  const fly = () => { theta = clamp(theta + 0.04 * (spd() - tgt) * DT, -2, 20); chase(s, c, theta + 0.25 * (spd() - tgt)); };
  for (let i = 0; i < 40 / DT; i++) { fly(); sim.step(DT); }
  const z0 = s.pos.z, t0 = s.t;
  for (let i = 0; i < 700 / DT && s.pos.z < toFt * FT; i++) { fly(); sim.step(DT); if (s.crashed) break; }
  return { fpm: (s.pos.z - z0) / (s.t - t0) / FPM, ias: s.ias / KT, mach: s.mach, crashed: s.crashed, n1: s.engines[0].n1, pitch: s.pitch / DEG, alt: s.pos.z / FT };
}
test('climb at CLB thrust: 250 kt at 310 t, FL40–FL90: 1,800 to 3,500 fpm', () => {
  // [EST] a heavy widebody at typical climb-out weights: no document gives this; the band is a judgement.
  const r = climb(310000, 250, 4000, 9000);
  dbg('climb250', r);
  assert.equal(r.crashed, null);
  assert.ok(r.fpm > 1800 && r.fpm < 3500, `${r.fpm.toFixed(0)} fpm`);
  assert.ok(Math.abs(r.ias - 250) < 6, `speed ${r.ias.toFixed(0)}`);
});
test('climb at CLB thrust: 310 kt at 310 t, FL150–FL200: 1,300 to 2,800 fpm', () => {
  const r = climb(310000, 310, 15000, 20000);
  dbg('climb310', r);
  assert.ok(r.fpm > 1300 && r.fpm < 2800, `${r.fpm.toFixed(0)} fpm`);
});
test('climb at M0.84 at 290 t, FL310–FL350: 300 to 1,500 fpm, reaching FL350', () => {
  // The upper climb's rates taper to a few hundred fpm near the optimum level.
  const r = climb(290000, 0, 31000, 35000, 0.84);
  dbg('climbM', r);
  assert.ok(r.alt >= 34900, `stopped at ${r.alt.toFixed(0)} ft`);
  assert.ok(r.fpm > 300 && r.fpm < 1500, `${r.fpm.toFixed(0)} fpm`);
});

// ---- Cruise, read at the trimmed point ----
function cruise(massKg, altFt, mach = 0.84) {
  const sim = air({ massKg, altFt, mach });
  const s = sim.state, e = s.engines[0], eng = kitFor('b777-300er').eng;
  return { sim, ff: s.fuelFlowKgS * 3600, ld: massKg * GRAV / (2 * e.thrustN * Math.cos(s.alpha)), thrust: e.thrustN, n1: e.n1, alpha: s.alpha / DEG, pitch: s.pitch / DEG, ias: s.ias / KT, mach: s.mach, eng };
}
function isaSigma(z) { const T = 288.15 - 0.0065 * Math.min(z, 11000); const s = Math.pow(T / 288.15, 4.2559); return z > 11000 ? s * Math.exp(-(z - 11000) * 9.80665 / (287.05 * 216.65)) : s; }
const clbAt = (r, altFt, mach = 0.84) => A.RATING.CL * r.eng.togaThrust(isaSigma(altFt * FT), mach);

test('cruise at M0.84: L/D 18 to 20.5, at typical weights and levels', () => {
  // [EST] for the band, but the range test below ties L/D ÷ TSFC to Boeing's chart; the fuel is [PUB]'s about 7.5 to 8 t/h at mid-cruise weights.
  for (const [m, alt, lo, hi] of [[330000, 31000, 8800, 10600], [290000, 33000, 7800, 9400], [260000, 35000, 7000, 8500], [230000, 39000, 6100, 7600]]) {
    const r = cruise(m, alt);
    dbg(`${m / 1000} t FL${alt / 100}: FF ${r.ff.toFixed(0)} kg/h, L/D ${r.ld.toFixed(1)}, N1 ${r.n1.toFixed(1)}, α ${r.alpha.toFixed(2)}°, ${r.ias.toFixed(0)} kt`);
    assert.ok(r.ld > 18 && r.ld < 20.5, `${m / 1000} t FL${alt / 100}: L/D ${r.ld.toFixed(1)}`);
    assert.ok(r.ff > lo && r.ff < hi, `${m / 1000} t FL${alt / 100}: ${r.ff.toFixed(0)} kg/h`);
    assert.ok(r.alpha > 1 && r.alpha < 4.5, `α ${r.alpha.toFixed(2)}°`);
    assert.ok(r.n1 > 75 && r.n1 < 98, `N1 ${r.n1.toFixed(1)}%`);
  }
});
test('thrust is enough for M0.84 at the usual step levels, with CLB available, and FL410 is not reachable near MTOW', () => {
  // A level at which the aircraft needs more than the climb rating isn't a level it could reach.
  for (const [m, alt] of [[345000, 31000], [300000, 33000], [270000, 35000], [240000, 39000]]) {
    const r = cruise(m, alt);
    dbg(`FL${alt / 100} ${m / 1000}t: needs ${(r.thrust / 1000).toFixed(1)} kN, CLB ${(clbAt(r, alt) / 1000).toFixed(1)} kN`);
    assert.ok(r.thrust < clbAt(r, alt), `FL${alt / 100} ${m / 1000} t: needs ${(r.thrust / 1000).toFixed(1)} kN, CLB ${(clbAt(r, alt) / 1000).toFixed(1)} kN`);
    assert.ok(r.sim.state.crashed === null);
  }
  const heavy = cruise(345000, 41000);
  assert.ok(heavy.thrust > clbAt(heavy, 41000), `345 t at FL410 needs ${(heavy.thrust / 1000).toFixed(1)} kN, CLB ${(clbAt(heavy, 41000) / 1000).toFixed(1)} kN`);
});

// [ACAP] 3-3, an independent check of L/D ÷ TSFC (the cruise's own figures were fitted): at 775,000 lb brake release and the
// MZFW line (524,000 lb) the chart reads about 5,660 nm at M0.84, stepping up 2,000 ft at a time.
// The mission rules aren't given ("typical mission rules"), so [EST] 13 t of reserves, 10 t of climb fuel over 150 nm.
test('range: MTOW to MZFW + reserves, M0.84, 2,000 ft steps, within ±10% of [ACAP] 3-3\'s 5,660 nm', () => {
  let m = A.MTOW - 10000, nm = 150;
  const end = A.MZFW + 13000, dt = 900; // s
  while (m > end) {
    let best = null;
    for (let alt = 29000; alt <= 41000; alt += 2000) {
      const r = cruise(m, alt);
      if (r.thrust > clbAt(r, alt)) continue;
      if (!best || r.ff / (r.mach * Math.sqrt(isaT(alt))) < best.ff / (best.mach * Math.sqrt(isaT(best.alt)))) best = { ff: r.ff, mach: r.mach, alt };
    }
    assert.ok(best, `no level at ${m}`);
    m -= best.ff / 3600 * dt;
    nm += best.mach * 38.967 * Math.sqrt(isaT(best.alt)) * dt / 3600;
  }
  dbg(`range ${nm.toFixed(0)} nm`);
  assert.ok(nm > 5660 * 0.9 && nm < 5660 * 1.1, `${nm.toFixed(0)} nm`);
});
function isaT(altFt) { return Math.max(216.65, 288.15 - 0.0065 * altFt * FT); }

test('it can reach MMO: M0.89 at FL350 costs drag but not a wall, and level flight there is within the thrust', () => {
  const a = cruise(270000, 35000, 0.84), b = cruise(270000, 35000, 0.89);
  const mct = A.RATING.MCT * b.eng.togaThrust(isaSigma(35000 * FT), 0.89);
  dbg(`M0.89: L/D ${b.ld.toFixed(1)}, thrust ${(b.thrust / 1000).toFixed(1)} kN (MCT ${(mct / 1000).toFixed(1)}), +${((b.thrust / a.thrust - 1) * 100).toFixed(0)}%`);
  assert.ok(b.ld > 14, `L/D ${b.ld.toFixed(1)}`);
  assert.ok(b.thrust / a.thrust < 1.35, `+${((b.thrust / a.thrust - 1) * 100).toFixed(0)}%`);
  assert.ok(b.thrust < mct, 'MCT holds M0.89 level');
  // Drag rises smoothly: M0.84 to M0.87 less than M0.87 to M0.89 per Mach.
  const c = cruise(270000, 35000, 0.87);
  assert.ok((b.thrust - c.thrust) / 0.02 > (c.thrust - a.thrust) / 0.03);
});

// ---- Stability ----
test('static stability: Cm falls with α about the CG at the MTOW, typical and aft-limit CGs, and the neutral point is aft of [ACAP] 7-8\'s limit', () => {
  const co = {};
  const s = { alpha: 0, beta: 0, M: 0.84, phat: 0, qhat: 0, rhat: 0, adothat: 0, slat: 0, flap: 0, gear: 0, doors: 0, sb: 0, gsp: 0, spL: 0, spR: 0, ail: 0, rud: 0, ths: 0, hWing: 10000 };
  const cmAbout = (cgX, alpha) => {
    s.alpha = alpha; FM.coefficients(s, co);
    return co.Cm - cgX / A.MAC * (co.CL * Math.cos(alpha)); // as sim.js: lift behind a CG cgX ahead of the reference pushes the nose down
  };
  let prev = -Infinity;
  for (const cgMac of [0.15, 0.25, 0.44]) {
    const cgX = (0.25 - cgMac) * A.MAC;
    const dCmdA = (cmAbout(cgX, 3 * DEG) - cmAbout(cgX, 1 * DEG)) / (2 * DEG);
    dbg(`M0.84, CG ${cgMac * 100}% MAC: dCm/dα ${dCmdA.toFixed(2)} per rad`);
    assert.ok(dCmdA < -0.1, `${cgMac * 100}% MAC: ${dCmdA.toFixed(2)}`);
    assert.ok(dCmdA > prev, 'an aft CG is less stable');
    prev = dCmdA;
  }
});

test('the loadings the setup screen can make are inside [ACAP] 7-8\'s CG envelope: MTOW, ZFW and MLW', () => {
  // Chart read: 27.5 to 38.4% MAC at the maximum taxi weight, opening to about 19 to 44.5% by 310 t, and 8 to 44.5% below 180 t.
  for (const [what, mass, payload, lo, hi] of [
    ['MTOW, 45 t payload', A.MTOW, 45000, 0.275, 0.384],
    ['310 t, 45 t payload', 310000, 45000, 0.19, 0.445],
    ['MLW, 60 t payload', A.MLW, 60000, 0.12, 0.445],
    ['MLW, 30 t payload', A.MLW, 30000, 0.12, 0.445],
    ['light, 10 t payload, 20 t fuel', A.OEW + 30000, 10000, 0.08, 0.445],
  ]) {
    const sim = ground({ massKg: mass, payloadKg: payload });
    const c = sim.state.cgMac;
    dbg(what, (c * 100).toFixed(1), '% MAC');
    assert.ok(c >= lo && c <= hi, `${what}: ${(c * 100).toFixed(1)}% MAC`);
  }
});

// ---- On the ground ----
test('the gear sits the aircraft where [ACAP] 2-7 says, across the weights', () => {
  // Far higher weights than the 787's: the same springs from about 190 t to the MTOW must keep every clearance in the table.
  for (const [mass, payload] of [[270000, 40000], [A.MTOW, 40000], [190000, 15000]]) {
    const sim = ground({ massKg: mass, payloadKg: payload });
    const s = sim.state;
    const th = s.pitch;
    // A body point's height above the runway, from the reference point's height and the attitude.
    const h = (x, z) => s.pos.z + x * Math.sin(th) + z * Math.cos(th);
    const rows = {
      pitch: s.pitch / DEG,
      eye: h(G.EYES.captain.x, G.EYES.captain.z),            // [EST] 6.25 m: not [ACAP] 4-6's stated 5.51 m ±1 ft, see geometry-b777-300er.js
      crown: h(G.NOSE_X - 10, G.FUSELAGE_HEIGHT / 2),        // A: 8.46 to 8.78
      nacelle: h(G.NACELLES[0].x, G.NACELLES[0].z - G.NACELLE_DIAMETER / 2), // E: 0.73 to 0.99
      fin: h(G.FIN.topTeX, G.FIN.topZ),                      // K: 18.24 to 18.85
      tip: h(G.WING.tipTeX, G.WING.tipZ),                    // L: 7.29 to 7.90
      nose: s.gearCompression.nose, main: s.gearCompression.left,
    };
    dbg(mass / 1000, 't', JSON.stringify(rows));
    assert.ok(Math.abs(rows.pitch - G.TAXI_ATTITUDE_DEG) < 0.35, `pitch ${rows.pitch.toFixed(2)}°`);
    assert.ok(Math.abs(rows.eye - 6.25) < 0.16, `eye ${rows.eye.toFixed(2)} m`); // ±0.16 m: [ACAP] 2-7's range of stance
    // Each with a 5 cm allowance past the table's range: the sim's springs are fitted, not a real strut's data.
    assert.ok(rows.crown > 8.41 && rows.crown < 8.83, `crown ${rows.crown.toFixed(2)} m`);
    assert.ok(rows.nacelle > 0.68 && rows.nacelle < 1.04, `nacelle ${rows.nacelle.toFixed(2)} m`);
    assert.ok(rows.fin > 18.19 && rows.fin < 18.90, `fin ${rows.fin.toFixed(2)} m`);
    assert.ok(rows.tip > 7.24 && rows.tip < 7.95, `wingtip ${rows.tip.toFixed(2)} m`);
    // The struts stay inside their stroke at the static point, even at MTOW.
    assert.ok(rows.nose < A.GEAR_DATA.nose.stroke && rows.main < A.GEAR_DATA.main.stroke);
  }
});

test('the weight splits between the gears as [ACAP] 7-8 says: nose about 4 to 12%, and the maximum nose load is respected', () => {
  // 7-8: 88% to 96.3% of the weight on the mains. 7-6: 26,771 to 44,670 kg on the nose at the maximum taxi weight, 7.6 to 12.7%.
  for (const [mass, payload] of [[A.MTOW, 45000], [270000, 40000], [A.MLW, 40000], [200000, 20000]]) {
    const s = ground({ massKg: mass, payloadKg: payload }).state;
    const noseShare = (G.GEAR.left.x - s.cgX) / (G.GEAR.left.x - G.GEAR.nose.x);
    dbg(mass / 1000, 't: nose share', (noseShare * 100).toFixed(1), '%');
    assert.ok(noseShare > 0.037 && noseShare < 0.127, `${mass / 1000} t: ${(noseShare * 100).toFixed(1)}%`);
  }
});

// ---- The far higher weights ----
test('the gear at MLW: a firm flare stays inside the stroke and under 2.2 g; no flare at all (about 800 ft/min) doesn\'t break it; GEAR_BREAK isn\'t absurd', () => {
  // [EST] certification is 10 ft/s (600 ft/min) at MLW and 6 ft/s at MTOW: 4.6 m/s (905 ft/min) is about 1.5 × the design sink, which is
  // where the A321neo and 787-9 also put it.
  const r = land(A.MLW);
  dbg('firm', r.tdFpm.toFixed(0), 'fpm', r.tdP.toFixed(1), 'deg', r.maxNz.toFixed(2), 'g', r.maxMain.toFixed(2), 'm', r.maxNose.toFixed(2), 'm');
  assert.equal(r.crashed, null);
  assert.ok(r.maxMain < A.GEAR_DATA.main.stroke, `main compression ${r.maxMain.toFixed(2)} m`);
  assert.ok(r.maxNose < A.GEAR_DATA.nose.stroke, `nose compression ${r.maxNose.toFixed(2)} m`);
  assert.ok(r.maxNz < 2.2, `${r.maxNz.toFixed(2)} g`); // the instantaneous peak at about 435 ft/min: the 787-9's gives the same 1.91 g at 444 ft/min
  assert.ok(r.tdP < A.PITCH_TAILSTRIKE_DEG - 1.5);
  const x = land(A.MLW, 30000, true);
  dbg('no flare', x.tdFpm.toFixed(0), 'fpm', x.maxNz.toFixed(2), 'g', x.maxMain.toFixed(2), 'm', x.maxNose.toFixed(2), 'm', x.crashed);
  assert.equal(x.crashed, null, `${x.tdFpm.toFixed(0)} fpm`);
  assert.ok(x.maxMain < A.GEAR_DATA.main.stroke, `main compression ${x.maxMain.toFixed(2)} m`);
  assert.ok(A.GEAR_BREAK_VS > 3.05 && A.GEAR_BREAK_VS < 6, 'between the 10 ft/s design sink and 1,200 ft/min');
});
test('the brakes: a rejected take-off from 150 kt at MTOW stops, and the deceleration is the document\'s 10 ft/s² class or better', () => {
  // [ACAP] 7-6's pavement loads assume 10 ft/s² = 3.05 m/s² of steady braking. RTO: brakes, idle, ground spoilers armed.
  const sim = ground({ massKg: A.MTOW, payloadKg: 45000 });
  const s = sim.state, c = sim.controls;
  c.thrust = 1; c.spoilersArmed = true;
  while (s.ias / KT < 150 && s.t < 120) sim.step(DT);
  const y0 = s.pos.y, v0 = s.gs, t0 = s.t;
  c.thrust = 0; c.brakeL = c.brakeR = 1;
  for (let i = 0; i < 120 / DT && s.gs > 0.5; i++) { c.pitch = 0; sim.step(DT); }
  const dist = s.pos.y - y0, decel = v0 / (s.t - t0);
  dbg(`RTO: ${dist.toFixed(0)} m, ${decel.toFixed(2)} m/s²`);
  assert.equal(s.crashed, null);
  assert.ok(s.gs < 1, 'stopped');
  assert.ok(decel > 3.05 && decel < 5.5, `${decel.toFixed(2)} m/s²`);
});
test('the tail strike angle is PITCH_TAILSTRIKE_DEG, with the strut unloaded', () => {
  const dx = G.GEAR.left.x - G.TAIL_STRIKE_POINT.x;
  const dz = G.TAIL_STRIKE_POINT.z - (G.GEAR.left.z - A.GEAR_DATA.main.staticComp);
  const deg = Math.atan2(dz, dx) / A.DEG;
  assert.ok(Math.abs(deg - A.PITCH_TAILSTRIKE_DEG) < 0.1, `${deg.toFixed(2)}°`);
});
