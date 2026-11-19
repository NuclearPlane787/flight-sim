// v0.6.0 (Part 4 step 1): the sim as the reference for the setup's fuel estimate over 120–970 nm.
// Not a test file: a dev script whose numbers tests/v060-setup.test.mjs keeps as its reference table.
//   node tests/v060-fuel-sim.mjs            → the table (JSON on the last line)
// Each type flies, on its own autopilot and autothrust in still ISA air at a typical load (its setup
// defaults: 190 / 290 / 339 passengers and their cargo), the segments of a block:
//   take-off to 1,500 ft  : TO/GA's fuel flow for 70 s, 3 nm;
//   the climb             : 250 kt to 10,000 ft, then 290 kt (the A321) or 310 kt (the Boeings) to the Mach,
//                           then the Mach (M0.78, 0.85, 0.84) to the level, at climb thrust (CL / FLCH);
//   (below the crossover the cruise and the descent fly the climb's IAS instead of the Mach: the lower of the two)
//   the cruise            : level at that Mach for 4 minutes after settling, fuel per nm (still air: per nm of TAS),
//                           at the mid-cruise mass;
//   the descent           : idle, the Mach, then 290/310 kt, 250 kt below 10,000 ft, to 3,000 ft;
//   the approach          : 15 nm at 3,000 ft, at the fuel flow of 210 kt clean there.
// The trip at a distance d is the lowest over the levels that fit (climb + descent + 18 nm within d).
import { createSim } from '../src/sim/sim.js';
import { typeById, kitFor } from '../src/sim/types.js';
import { iasFromMach } from '../src/sim/atmosphere.js';
import { fileURLToPath } from 'node:url';

const KT = 0.514444, FT = 0.3048, NM = 1852, DT = 1 / 60;

export const PROFILES = {
  a321neo: { climbKt: 290, mach: 0.78, levels: [120, 160, 200, 240, 280, 310, 350, 370] },
  'b787-9': { climbKt: 310, mach: 0.85, levels: [120, 160, 200, 240, 280, 310, 350, 370, 390] },
  'b777-300er': { climbKt: 310, mach: 0.84, levels: [120, 160, 200, 240, 280, 310, 330, 350, 370] },
};
export const DISTANCES = [120, 300, 480, 640, 960];

function newSim(id, massKg, altFt, iasKt) {
  const T = typeById(id), A = T.data;
  const payloadKg = T.defaults.pax * T.limits.PAX_KG + T.defaults.cargoKg;
  const fuelKg = Math.max(2000, massKg - A.OEW - payloadKg);
  const sim = createSim({ type: id });
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: altFt * FT, iasMs: iasKt * KT, flapLever: 0, gearDown: false,
    fuelKg, payloadKg, ap: { ap: true, athr: true, spdKt: iasKt, hdgDeg: 0, altFt } });
  if (T.family === 'airbus') sim.controls.thrust = 25 / 45;   // the CL detent: the A/THR's range
  return sim;
}
const dist = (s, p0) => Math.hypot(s.pos.x - p0.x, s.pos.y - p0.y);
function step(sim, seconds, each) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { if (each && each() === true) return true; sim.step(DT); sim.events.length = 0; if (sim.state.crashed) throw new Error(sim.state.crashed); }
  return false;
}

// The climb from 1,500 ft to FLxxx: fuel, ground distance, time.
function climb(id, massKg, fl) {
  const P = PROFILES[id], sim = newSim(id, massKg, 1500, 250), s = sim.state, ap = sim.ap;
  const f0 = s.fuelKg, p0 = { x: s.pos.x, y: s.pos.y }, t0 = s.t;
  const target = fl * 100;
  ap.setAlt(Math.min(target, 10000)); ap.levelChange();
  step(sim, 1800, () => s.pos.z >= 9990 * FT || (target <= 10000 && s.pos.z >= target * FT - 20));
  if (target > 10000) {
    ap.setSpd(P.climbKt); ap.setAlt(target); ap.levelChange();
    let k = 0;
    step(sim, 3600, () => {
      if (++k % 60 === 0 && s.mach > P.mach) ap.setSpd(iasFromMach(P.mach, s.pos.z) / KT);   // the crossover: hold the Mach
      if (k % 60 === 0 && s.pos.z > target * FT - 2000 * FT) ap.setSpd(Math.min(ap.spdKt, cruiseIas(P, target)));
      return s.pos.z >= target * FT - 30;
    });
  }
  return { fuel: f0 - s.fuelKg, nm: dist(s, p0) / NM, min: (s.t - t0) / 60, end: s.pos.z / FT };
}
// Level at FLxxx and the Mach: kg per nm.
const cruiseIas = (P, ft) => Math.min(P.climbKt, iasFromMach(P.mach, ft * FT) / KT);
function cruise(id, massKg, fl) {
  const P = PROFILES[id], ias = cruiseIas(P, fl * 100);
  const sim = newSim(id, massKg, fl * 100, ias), s = sim.state;
  step(sim, 120);
  const f0 = s.fuelKg, p0 = { x: s.pos.x, y: s.pos.y };
  step(sim, 240);
  return { perNm: (f0 - s.fuelKg) / (dist(s, p0) / NM), kgh: (f0 - s.fuelKg) * 15, mach: s.mach, alt: s.pos.z / FT };
}
// Idle from FLxxx to 3,000 ft.
function descent(id, massKg, fl) {
  const P = PROFILES[id], ias = cruiseIas(P, fl * 100);
  const sim = newSim(id, massKg, fl * 100, ias), s = sim.state, ap = sim.ap;
  step(sim, 20);
  const f0 = s.fuelKg, p0 = { x: s.pos.x, y: s.pos.y };
  ap.setAlt(3000); ap.levelChange();
  let k = 0, slow = false;
  step(sim, 3600, () => {
    if (++k % 60 === 0) {
      if (!slow && s.pos.z < 10500 * FT) { slow = true; ap.setSpd(250); }
      else if (!slow) ap.setSpd(cruiseIas(P, s.pos.z / FT));   // the Mach, then the IAS below the crossover
    }
    return s.pos.z <= 3050 * FT;
  });
  return { fuel: f0 - s.fuelKg, nm: dist(s, p0) / NM, min: 0 };
}
function approach(id, massKg) {
  const sim = newSim(id, massKg, 3000, 210), s = sim.state;
  step(sim, 60);
  const f0 = s.fuelKg; step(sim, 120);
  const kgh = (f0 - s.fuelKg) * 30;
  return { fuel: kgh * (15 / 190), nm: 15 };
}
function toga(id, massKg) {
  const sim = newSim(id, massKg, 1000, 180), s = sim.state;
  sim.ap.toggleAthr?.(); sim.ap.disconnectAp?.();
  sim.controls.thrust = 1;
  step(sim, 8);
  return { fuel: s.fuelFlowKgS * 70, nm: 3 };
}

export function profile(id, { log = false } = {}) {
  const T = typeById(id), P = PROFILES[id];
  const payload = T.defaults.pax * T.limits.PAX_KG + T.defaults.cargoKg;
  const zfw = T.data.OEW + payload;
  const out = { id, payloadKg: payload, levels: {} };
  const tow0 = zfw + 0.35 * T.limits.FUEL_MAX * (id === 'a321neo' ? 1 : 0.4);   // a mid-range block's weight for the segments
  out.to = toga(id, tow0);
  out.approach = approach(id, zfw + 2500);
  for (const fl of P.levels) {
    const c = climb(id, tow0 - out.to.fuel, fl), d = descent(id, zfw + 3000, fl);
    out.levels[fl] = { climb: c, descent: d };
    if (log) console.error(id, 'FL' + fl, 'climb', c.fuel.toFixed(0), 'kg', c.nm.toFixed(0), 'nm', c.min.toFixed(1), 'min', '| descent', d.fuel.toFixed(0), 'kg', d.nm.toFixed(0), 'nm');
  }
  return out;
}

// The trip by the sim at d nm, from a profile: the best level that fits, cruising at the mid-cruise mass.
export function simTrip(id, prof, d) {
  const T = typeById(id), zfw = T.data.OEW + prof.payloadKg;
  let best = null;
  for (const fl of PROFILES[id].levels) {
    const L = prof.levels[fl];
    const fixedNm = prof.to.nm + L.climb.nm + L.descent.nm + prof.approach.nm;
    if (fixedNm > d) continue;
    const cruiseNm = d - fixedNm;
    // the mid-cruise mass: the landing's (zfw + 2.5 t reserve) plus the descent, half the cruise and the approach
    let perNm = 0, mass = zfw + 2500 + L.descent.fuel + prof.approach.fuel + cruiseNm * 6;
    for (let it = 0; it < 2; it++) { perNm = cruise(id, mass + 0.5 * cruiseNm * (perNm || 6), fl).perNm; mass = zfw + 2500 + L.descent.fuel + prof.approach.fuel; }
    const trip = prof.to.fuel + L.climb.fuel + perNm * cruiseNm + L.descent.fuel + prof.approach.fuel;
    if (!best || trip < best.trip) best = { fl, trip, perNm, cruiseNm };
  }
  return best;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const table = {};
  for (const id of Object.keys(PROFILES)) {
    kitFor(id);
    const prof = profile(id, { log: true });
    console.error(id, 'TO', prof.to.fuel.toFixed(0), 'kg; approach', prof.approach.fuel.toFixed(0), 'kg');
    table[id] = {};
    for (const d of DISTANCES) {
      const b = simTrip(id, prof, d);
      table[id][d] = { trip: Math.round(b.trip), fl: b.fl, perNm: +b.perNm.toFixed(2) };
      console.error(id, d, 'nm: trip', Math.round(b.trip), 'kg at FL' + b.fl, `(${b.perNm.toFixed(2)} kg/nm cruise over ${b.cruiseNm.toFixed(0)} nm)`);
    }
  }
  console.log(JSON.stringify(table));
}
