// Climb rate and cruise fuel flow in sensible A321neo ranges.
// Climb: EUROCONTROL's A21N data gives ~2,000 fpm at 175 kt to 5,000 ft and ~1,500 fpm at
// 290 kt to FL150 (typical weights, typical derates); 250 kt at 75–85 t with CLB thrust is
// about 2,000–3,000 fpm (reference/notes/a321neo-performance.md §5). Cruise: ~2,200 kg/h at
// FL330, 67 t, M0.76 (published operational figure), and 1,050–1,250 kg/h per engine at
// FL350, M0.78, 72–80 t (derived). Ranges, not points.
import test from 'node:test';
import assert from 'node:assert/strict';
import { airborne, run, KT, FT, FPM } from './sim-helpers.mjs';

function climb(massKg, iasKt, fromFt, toFt) {
  const sim = airborne({ massKg, fuelKg: 10000, altFt: fromFt, iasKt, ap: { ap: true, athr: true, spdKt: iasKt, hdgDeg: 0, altFt: fromFt } });
  sim.controls.thrust = 25 / 45; // CL detent
  sim.ap.setAlt(toFt + 3000); sim.ap.levelChange();
  const s = sim.state;
  run(sim, 30); // settle into the climb
  const z0 = s.pos.z, t0 = s.t;
  run(sim, 600, () => s.pos.z > toFt * FT);
  return { fpm: (s.pos.z - z0) / (s.t - t0) / FPM, ias: s.ias / KT, mode: sim.ap.vertical, crashed: s.crashed };
}

test('initial climb at 250 kt, CLB thrust, 80 t: 2,000–3,300 fpm', () => {
  const r = climb(80000, 250, 4000, 9000);
  if (process.env.SIM_DEBUG) console.log(r);
  assert.equal(r.crashed, null);
  assert.ok(r.fpm > 2000 && r.fpm < 3300, `${r.fpm.toFixed(0)} fpm`);
  assert.ok(Math.abs(r.ias - 250) < 5, `speed held ${r.ias.toFixed(1)} kt`);
});

test('climb at 290 kt FL100–FL150, 80 t: 1,300–2,600 fpm', () => {
  const r = climb(80000, 290, 10000, 15000);
  if (process.env.SIM_DEBUG) console.log(r);
  assert.ok(r.fpm > 1300 && r.fpm < 2600, `${r.fpm.toFixed(0)} fpm`);
});

test('climb at M0.78 near FL330, 75 t: 300–1,500 fpm (still climbing near the optimum level)', () => {
  const sim = airborne({ massKg: 75000, fuelKg: 8000, altFt: 31000, mach: 0.78, ap: { ap: true, athr: true, hdgDeg: 0, altFt: 31000 } });
  sim.ap.setSpd(sim.state.ias / KT);
  sim.controls.thrust = 25 / 45;
  sim.ap.setAlt(37000); sim.ap.levelChange();
  run(sim, 40);
  const z0 = sim.state.pos.z, t0 = sim.state.t;
  run(sim, 60);
  const fpm = (sim.state.pos.z - z0) / (sim.state.t - t0) / FPM;
  if (process.env.SIM_DEBUG) console.log({ fpm });
  assert.ok(fpm > 300 && fpm < 1500, `${fpm.toFixed(0)} fpm`);
});

function cruise(massKg, altFt, mach) {
  const sim = airborne({ massKg, fuelKg: 8000, altFt, mach, ap: { ap: true, athr: true, hdgDeg: 0, altFt } });
  sim.ap.setSpd(sim.state.ias / KT);
  sim.controls.thrust = 25 / 45;
  run(sim, 120);
  let ff = 0, n = 0;
  run(sim, 60, () => { ff += sim.state.fuelFlowKgS; n++; });
  return { kgh: ff / n * 3600, mach: sim.state.mach, alt: sim.state.pos.z / FT, vs: sim.state.vs / FPM };
}

test('cruise FL350 M0.78, 76 t: 2,100–2,600 kg/h total', () => {
  const r = cruise(76000, 35000, 0.78);
  if (process.env.SIM_DEBUG) console.log(r);
  assert.ok(Math.abs(r.mach - 0.78) < 0.005, `M${r.mach.toFixed(3)}`);
  assert.ok(Math.abs(r.alt - 35000) < 50);
  assert.ok(r.kgh > 2100 && r.kgh < 2600, `${r.kgh.toFixed(0)} kg/h`);
});

test('cruise FL330 M0.76, 67 t: 1,950–2,450 kg/h total (published ≈ 2,200)', () => {
  const r = cruise(67000, 33000, 0.76);
  if (process.env.SIM_DEBUG) console.log(r);
  assert.ok(r.kgh > 1950 && r.kgh < 2450, `${r.kgh.toFixed(0)} kg/h`);
});

test('speed brakes add drag: idle deceleration in level flight is faster with them out', () => {
  const decel = (sb) => {
    const sim = airborne({ massKg: 70000, altFt: 10000, iasKt: 300, ap: { ap: true, athr: false, hdgDeg: 0, altFt: 10000 } });
    sim.controls.thrust = 0;
    sim.controls.speedbrake = sb;
    run(sim, 30);
    return 300 - sim.state.ias / KT;
  };
  const clean = decel(0), sb = decel(1);
  if (process.env.SIM_DEBUG) console.log({ clean, sb });
  assert.ok(sb > clean * 1.3, `with speed brakes ${sb.toFixed(1)} kt vs ${clean.toFixed(1)} kt in 30 s`);
});
