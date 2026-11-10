// v0.4.0, Part 1: the weather in the sim. The models measured off the field (the profile, the gusts, the
// turbulence's σ and scale lengths, the microburst, the ISA + ΔT column), and what the aircraft does in it
// (the triangle of velocities, the altimeter, restores, the prediction, a parked aircraft in a gale).
//   node --test tests/weather.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';
import { predictSync } from '../src/sim/predict-core.js';
import { compileWeather, normalizeWeather, calmWeather, isDefaultWeather, windAt, newWind, gustField, turbulenceScales, microburstInto, microburstLambda, MB_ZSTAR, MB_EPS } from '../src/sim/weather.js';
import { isaInto, columnInto, pressureAltitude, indicatedAltitude, P0 } from '../src/sim/atmosphere.js';
import { airborne, run, KT, FT, DEG } from './sim-helpers.mjs';

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);
const viaJson = (o) => JSON.parse(JSON.stringify(o));
const here = new URL('..', import.meta.url).pathname;
const AIRPORTS = ['RKSS', 'RKPC', 'RKSI'].map((i) => JSON.parse(readFileSync(here + `data/airports/${i}.json`, 'utf8')));
const wx = (o) => ({ ...calmWeather(), preset: 'custom', ...o });
const windOf = (C, agl, x = 0, y = 0, t = 0) => windAt(C, x, y, agl, agl, t, 0, 1, 0, newWind());

// ---- the settings ----

test('the default weather is nothing: no settings kept, no snapshot field, and a partial object is filled in', () => {
  assert.ok(isDefaultWeather(calmWeather()));
  assert.ok(isDefaultWeather(null));
  assert.ok(!isDefaultWeather(wx({ wind: { fromDeg: 90, kt: 10, gustKt: 0 } })));
  const sim = airborne({ altFt: 5000, iasKt: 250, hdg: 0 });
  sim.setWeather(calmWeather());
  assert.equal(sim.weather, null);
  assert.ok(!('weather' in sim.snapshot()));
  const n = normalizeWeather({ wind: { fromDeg: 370, kt: 12 } });
  assert.equal(n.wind.fromDeg, 10);
  assert.equal(n.qnh, 1013.25);
  assert.deepEqual(n, viaJson(n), 'JSON-safe');
});

test('a save without weather restores calm; a rewind keeps the weather set now', () => {
  const a = airborne({ altFt: 5000, iasKt: 250, hdg: 0 });
  const old = viaJson(a.snapshot());
  a.setWeather(wx({ wind: { fromDeg: 90, kt: 20, gustKt: 0 }, aloft: { fromDeg: 90, kt: 20 } }));
  assert.ok(a.weather);
  a.restore(old, { keepWeather: true });
  assert.ok(a.weather, 'a rewind keeps it');
  a.restore(old);
  assert.equal(a.weather, null, 'a save without weather is calm');
});

// ---- the mean wind ----

test('the profile: the panel\'s surface wind at 10 m, weaker below it, the wind aloft from 900 m', () => {
  const C = compileWeather(wx({ wind: { fromDeg: 180, kt: 20, gustKt: 0 }, aloft: { fromDeg: 240, kt: 50 } }));
  near(Math.hypot(C.sfN, C.sfE), 20 * KT, 1e-9, 'surface speed');
  const s10 = windOf(C, 10), s3 = windOf(C, 3), top = windOf(C, 900), high = windOf(C, 5000);
  near(s10.n, C.sfN, 1e-9, 'at 10 m'); near(s10.e, C.sfE, 1e-9, 'at 10 m');
  assert.ok(Math.hypot(s3.n, s3.e) < Math.hypot(s10.n, s10.e), 'weaker near the ground');
  near(top.n, C.alN, 1e-9, 'at 900 m'); near(high.e, C.alE, 1e-9, 'aloft');
  let prev = 10, turned = false;
  const dir = (w) => Math.atan2(w.e, w.n);
  for (let h = 20; h <= 900; h += 20) {
    const w = windOf(C, h), sp = Math.hypot(w.n, w.e);
    assert.ok(sp >= prev - 1e-9, `speed grows with height at ${h} m`);
    prev = sp;
    if (Math.abs(dir(w) - dir(s10)) > 1 * DEG) turned = true;
  }
  assert.ok(turned, 'the wind veers towards the wind aloft');
});

test('directions are magnetic and "from": a north wind blows south, once the variation is taken off', () => {
  const C = compileWeather(wx({ wind: { fromDeg: 0, kt: 10, gustKt: 0 }, aloft: { fromDeg: 0, kt: 10 } }));
  assert.ok(C.sfN < 0, 'blowing south');
  const gridFrom = Math.atan2(-C.sfE, -C.sfN) / DEG;
  // At the map's centre the grid is true north, and the variation is about 8.5° west.
  near(gridFrom, -8.46, 0.2, 'grid direction');
});

test('the low-level shear adds its wind across a thin layer, and only there', () => {
  const base = compileWeather(wx({ wind: { fromDeg: 90, kt: 10, gustKt: 0 }, aloft: { fromDeg: 90, kt: 10 } }));
  const C = compileWeather(wx({ wind: { fromDeg: 90, kt: 10, gustKt: 0 }, aloft: { fromDeg: 90, kt: 10 }, shear: { ftAgl: 500, fromDeg: 270, kt: 25 } }));
  const z = 500 * FT, dv = (h) => Math.hypot(windOf(C, h).n - windOf(base, h).n, windOf(C, h).e - windOf(base, h).e);
  near(dv(z - 40), 0, 1e-9, 'below the layer');
  near(dv(z + 40), 25 * KT, 0.2, 'above the layer');
  near(dv(z + 1000), 0, 1e-9, 'well above');
});

// ---- gusts ----

test('gusts reach the panel\'s peak, with lulls between them, a few a minute at a point', () => {
  const C = compileWeather(wx({ seed: 7, wind: { fromDeg: 90, kt: 20, gustKt: 32 }, aloft: { fromDeg: 90, kt: 20 } }));
  let max = 0, zero = 0, peaks = 0, prev = 0, up = false;
  const N = 36000;
  for (let i = 0; i < N; i++) {
    const g = gustField(C, 0, 0, i * 0.1);
    if (g > max) max = g;
    if (g < 0.02) zero++;
    if (g < prev && up && prev > 0.5) peaks++;
    up = g > prev; prev = g;
  }
  assert.ok(max > 0.9 && max <= 1, `peak ${max}`);
  assert.ok(zero / N > 0.2, `lulls ${zero / N}`);
  const perMin = peaks / 60;
  assert.ok(perMin > 0.8 && perMin < 6, `${perMin} gusts a minute`);
});

test('the air is a pure function of place, time and seed', () => {
  const C = compileWeather(wx({ seed: 3, wind: { fromDeg: 40, kt: 18, gustKt: 30 }, aloft: { fromDeg: 60, kt: 40 }, turbulence: 'moderate' }));
  const a = windOf(C, 400, 1234.5, -987.25, 88.125), b = windOf(C, 400, 1234.5, -987.25, 88.125);
  assert.deepEqual(a, b);
  const other = compileWeather(wx({ seed: 4, wind: { fromDeg: 40, kt: 18, gustKt: 30 }, aloft: { fromDeg: 60, kt: 40 }, turbulence: 'moderate' }));
  assert.notEqual(windOf(other, 400, 1234.5, -987.25, 88.125).d, a.d, 'another seed, other air');
});

// ---- turbulence ----

function measure(level, hFt, windKt = 0) {
  // An ensemble over seeds along level east-going lines: variances and the correlations at one scale length.
  const agl = hFt * FT, S = turbulenceScales(level, hFt, {}, compileWeather(wx({ wind: { fromDeg: 0, kt: windKt, gustKt: 0 }, turbulence: level })).w20);
  const dx = 10, n = 20000, lagU = Math.round(S.Lu / dx), lagW = Math.round(S.Lw / dx);
  let vu = 0, vw = 0, ru = 0, rw = 0, count = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const C = compileWeather(wx({ seed, turbulence: level, wind: { fromDeg: 0, kt: windKt, gustKt: 0 } }));
    const us = new Float64Array(n), ws = new Float64Array(n);
    const W = newWind();
    for (let i = 0; i < n; i++) { windAt(C, i * dx, seed * 1000, agl, agl, 0, 0, 1, 0, W); us[i] = W.e - W.meanE; ws[i] = W.d; }
    for (let i = 0; i < n; i++) {
      vu += us[i] * us[i]; vw += ws[i] * ws[i]; count++;
      if (i + lagU < n) ru += us[i] * us[i + lagU] * n / (n - lagU);
      if (i + lagW < n) rw += ws[i] * ws[i + lagW] * n / (n - lagW);
    }
  }
  return { su: Math.sqrt(vu / count), sw: Math.sqrt(vw / count), cu: ru / vu, cw: rw / vw, S };
}

test('the turbulence\'s σ and scale lengths, measured off the field, are the standard\'s', () => {
  for (const [level, ft, kt] of [['light', 3000, 0], ['moderate', 3000, 0], ['severe', 8000, 0], ['moderate', 300, 0], ['moderate', 300, 20]]) {
    const m = measure(level, ft, kt);
    assert.ok(Math.abs(m.su / m.S.su - 1) < 0.15, `${level} ${ft} ft: σu ${m.su} vs ${m.S.su}`);
    assert.ok(Math.abs(m.sw / m.S.sw - 1) < 0.15, `${level} ${ft} ft: σw ${m.sw} vs ${m.S.sw}`);
    near(m.cu, Math.exp(-1), 0.13, `${level} ${ft} ft: R_u(L_u)/σ²`);
    near(m.cw, 0.5 * Math.exp(-1), 0.13, `${level} ${ft} ft: R_w(L_w)/σ²`);
  }
});

test('the standard\'s numbers: below 1,000 ft from W20, above 2,000 ft from the exceedance curves', () => {
  const low = turbulenceScales('moderate', 500), f = 0.177 + 0.000823 * 500;
  near(low.sw, 0.1 * 30 * KT, 1e-9, 'σw');
  near(low.su, low.sw / f ** 0.4, 1e-9, 'σu');
  near(low.Lw, 500 * FT, 1e-9, 'Lw');
  near(low.Lu, 500 / f ** 1.2 * FT, 1e-9, 'Lu');
  const hi = turbulenceScales('severe', 3750);
  near(hi.su, 23.0 * FT, 1e-9, 'severe at 3,750 ft');
  near(hi.Lu, 1750 * FT, 1e-9, 'L');
  const mid = turbulenceScales('moderate', 1500), a = turbulenceScales('moderate', 1000), b = turbulenceScales('moderate', 2000);
  near(mid.sw, (a.sw + b.sw) / 2, 1e-9, 'between the two');
});

test('v0.4.1: near the ground the turbulence follows the wind blowing, the level scaling it, with a floor', () => {
  const w20 = (kt) => compileWeather(wx({ wind: { fromDeg: 0, kt, gustKt: 0 }, turbulence: 'moderate' })).w20;
  near(w20(15) / (15 * KT), (20 * FT / 10) ** 0.16, 1e-9, 'W20 from the 10 m wind by the profile');
  // Moderate in 30 kt is the standard's moderate; in 15 kt it's half the wind's worth, not twice.
  const at = (level, kt, ft = 300) => turbulenceScales(level, ft, {}, w20(kt));
  near(at('moderate', 30 / 0.924).sw, 0.1 * 30 * KT, 0.01, 'moderate at W20 = 30 kt');
  assert.ok(at('moderate', 16).sw < 0.55 * turbulenceScales('moderate', 300).sw, 'a 16 kt storm wind: about half of before');
  // The floor: half the level's own W20, in a calm.
  near(at('moderate', 0).sw, 0.1 * 15 * KT, 1e-9, 'moderate in a calm'); near(at('severe', 0).sw, 0.1 * 22.5 * KT, 1e-9, 'severe in a calm');
  // The level scales the wind: light 0.7, severe 1.4 of it.
  near(at('light', 30).sw / at('moderate', 30).sw, 0.7, 1e-9, 'light'); near(at('severe', 40).sw / at('moderate', 40).sw, 1.4, 1e-9, 'severe');
  // Above 2,000 ft nothing changed.
  near(turbulenceScales('severe', 3750, {}, w20(10)).su, 23.0 * FT, 1e-9, 'aloft');
  // The crosswind's swing on short final in the thunderstorm's wind: σ about a fifth of the wind, not a third.
  const s = at('moderate', 14, 150);
  assert.ok(s.su / (14 * KT) < 0.25, `σu ${(s.su / KT).toFixed(1)} kt in 14 kt`);
});

// ---- microbursts ----

test('the microburst: outflow of half the change each way at its peak, a downdraft in the core, mass conserved', () => {
  const R = 1000, dv = 40 * KT, L = microburstLambda(dv, R);
  const zp = Math.log(MB_ZSTAR / MB_EPS) * MB_ZSTAR * MB_EPS / (MB_ZSTAR - MB_EPS);
  const o = { n: 0, e: 0, d: 0 };
  let best = 0, at = 0;
  for (let r = 100; r < 4000; r += 5) { microburstInto(r, 0, zp, R, L, o); if (o.e > best) { best = o.e; at = r; } }
  near(best, dv / 2, 0.02, 'peak outflow');
  near(at / R, 1.12, 0.02, 'where');
  microburstInto(800, 0, zp, R, L, o); assert.ok(o.e > 0, 'outward to the east');
  microburstInto(0, -800, zp, R, L, o); assert.ok(o.n < 0, 'outward to the south');
  microburstInto(0, 0, 600, R, L, o); assert.ok(o.d > 5, `downdraft ${o.d} m/s`);
  near(o.e, 0, 1e-9, 'no outflow at the centre');
  microburstInto(0, 0, 0, R, L, o); near(o.d, 0, 1e-9, 'the ground stops it');
  microburstInto(9000, 0, zp, R, L, o); near(o.e, 0, 1e-9, 'none far away');
  // No hard edge: no jump anywhere on the way out.
  let prev = null;
  for (let r = 3000; r < 7000; r += 5) { microburstInto(r, 0, zp, R, L, o); if (prev !== null) assert.ok(Math.abs(o.e - prev) < 0.05, `a jump at r ${r}: ${prev} to ${o.e}`); prev = o.e; }
  // Continuity in cylindrical coordinates: (1/r) d(r u)/dr + dw/dz = 0, with w up = −d.
  const uAt = (r, z) => { microburstInto(r, 0, z, R, L, o); return o.e; };
  const wAt = (r, z) => { microburstInto(r, 0, z, R, L, o); return -o.d; };
  const e = 0.5;
  for (const [r, z] of [[300, 50], [900, 120], [1500, 400], [2200, 30]]) {
    const div = ((r + e) * uAt(r + e, z) - (r - e) * uAt(r - e, z)) / (2 * e * r) + (wAt(r, z + e) - wAt(r, z - e)) / (2 * e);
    near(div, 0, 1e-6, `divergence at r ${r}, z ${z}`);
  }
});

// ---- the air column and the altimeter ----

test('the ISA + ΔT column: the QNH at sea level, standard when both are, hydrostatic everywhere', () => {
  const a = { T: 0, p: 0, rho: 0, a: 0 }, b = { T: 0, p: 0, rho: 0, a: 0 };
  for (const h of [0, 1000, 5000, 10999, 11001, 15000]) {
    columnInto(h, 0, P0, a); isaInto(h, b);
    near(a.p / b.p, 1, 1e-12, `p at ${h}`); near(a.T, b.T, 1e-9, `T at ${h}`); near(a.a, b.a, 1e-9, `a at ${h}`);
  }
  columnInto(0, -20, 102000, a);
  near(a.p, 102000, 1e-6, 'QNH at sea level');
  near(a.T, 268.15, 1e-9, 'T on a −5 °C day');
  // dp/dh = −ρg, numerically, across the tropopause too.
  for (const h of [500, 9000, 10000, 13000]) {
    const d = 1, m = columnInto(h, 12, 101000, { T: 0, p: 0, rho: 0, a: 0 });
    const up = columnInto(h + d, 12, 101000, { T: 0, p: 0, rho: 0, a: 0 }).p, dn = columnInto(h - d, 12, 101000, { T: 0, p: 0, rho: 0, a: 0 }).p;
    near((up - dn) / (2 * d) / (-m.rho * 9.80665), 1, 1e-4, `hydrostatic at ${h}`);
  }
});

test('the pressure altitude inverts ISA, on both sides of the tropopause', () => {
  const o = { T: 0, p: 0, rho: 0, a: 0 };
  for (const h of [-200, 0, 3000, 10900, 11100, 18000]) near(pressureAltitude(isaInto(h, o).p), h, 1e-6, `at ${h}`);
  near(indicatedAltitude(isaInto(3000, o).p, P0), 3000, 1e-6, 'baro standard');
});

function parked(elev, weather) {
  const g = { h: elev, kind: 'runway' };
  const sim = createSim({ ground: () => g });
  sim.setWeather(weather);
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: true, fuelKg: 6000, payloadKg: 15000, parkingBrake: true });
  return sim;
}

test('the altimeter: at the QNH it reads the field\'s elevation at each airport, and a wrong setting is 27 ft per hPa', () => {
  for (const ap of AIRPORTS) {
    for (const qnh of [995, 1013.25, 1032]) {
      const elev = ap.elevM ?? ap.elev ?? (ap.elevFt ?? 30) * FT;
      const sim = parked(elev, wx({ qnh, tempC: 15 }));
      sim.setLocalQnh();
      near(sim.state.altInd - sim.state.pos.z, 0, 3, `${ap.icao} at QNH ${qnh}`);
      const right = sim.state.altInd;
      sim.setBaro(qnh - 3);
      near((sim.state.altInd - right) / FT / -3, 27.3, 1.5, `${ap.icao}: ft per hPa`);
    }
  }
});

test('STD reads the pressure altitude, and the calm altimeter is exactly the height', () => {
  const sim = airborne({ altFt: 8000, iasKt: 250, hdg: 0 });
  assert.equal(sim.state.altInd, sim.state.pos.z, 'calm, baro standard: no round trip');
  sim.setWeather(wx({ qnh: 990 }));
  sim.setBaroStd(true);
  const o = columnInto(sim.state.pos.z, 0, 99000, { T: 0, p: 0, rho: 0, a: 0 });
  near(sim.state.altInd, pressureAltitude(o.p), 1e-6, 'STD');
  assert.ok(sim.state.altInd > sim.state.pos.z + 150, 'low QNH reads high on STD');
  sim.setLocalQnh();
  assert.equal(sim.baro.std, false);
  near(sim.baro.hpa, 990, 1e-9, 'K takes the local QNH');
  near(sim.state.altInd, sim.state.pos.z, 25, 'near the height again');
});

test('a cold day reads high aloft, a hot day low', () => {
  const read = (tempC) => {
    const sim = airborne({ altFt: 10000, iasKt: 250, hdg: 0 });
    sim.setWeather(wx({ tempC }));
    return sim.state.altInd - sim.state.pos.z;
  };
  const cold = read(-15), hot = read(35);
  assert.ok(cold > 200, `cold: ${cold} m`);
  assert.ok(hot < -100, `hot: ${hot} m`);
});

test('the altitude hold flies the altimeter: on a cold day the aircraft is truly lower than the FCU says', () => {
  const sim = airborne({ altFt: 10000, iasKt: 250, hdg: 0, ap: { ap: true, athr: true, hdgDeg: 0, altFt: 10000, vertical: 'ALT' } });
  sim.setWeather(wx({ tempC: -15 }));
  run(sim, 120);
  near(sim.state.altInd / FT, 10000, 40, 'holds the indicated altitude');
  assert.ok(sim.state.pos.z / FT < 9400, `true altitude ${sim.state.pos.z / FT} ft`);
});

test('a hot day: thinner air, and TAS up for the same IAS and flat-rated thrust up to ISA + 15', () => {
  const tog = (tempC) => {
    const sim = parked(0, wx({ tempC }));
    sim.controls.thrust = 1;
    run(sim, 25);
    return sim.state.engines[0].thrustN;
  };
  const isa0 = tog(15), flat = tog(25), hot = tog(45), cold = tog(-15);
  near(flat / isa0, 1, 0.01, 'flat to ISA + 10');
  assert.ok(hot / isa0 < 0.97, `past the flat rating: ${hot / isa0}`);
  // The review of 2026-11-10: flat below ISA too. The denser air would give about 10 % more at ISA − 30; the rating holds it.
  near(cold / isa0, 1, 0.01, 'no more thrust on a cold day (ISA − 30)');
  const start = (tempC) => {
    const sim = createSim({ ground: () => ({ h: 0, kind: 'water' }) });
    sim.setWeather(wx({ tempC }));
    sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 8000 * FT, iasMs: 250 * KT, flapLever: 0, gearDown: false, fuelKg: 9000, payloadKg: 15000 });
    return sim.state;
  };
  const std = start(15), hotDay = start(35);
  near(hotDay.ias / KT, std.ias / KT, 0.05, 'trimmed to the same IAS');
  assert.ok(hotDay.tas > std.tas * 1.02, `TAS is up on a hot day: ${hotDay.tas} vs ${std.tas}`);
  assert.ok(hotDay.mach < std.mach * 1.01, 'the speed of sound is up with it');
});

// ---- the aircraft in the wind ----

const AIR_RIGHT = (hdg) => [-Math.sin(hdg), Math.cos(hdg)];

test('the triangle of velocities: drift is asin(crosswind / TAS), the groundspeed is the TAS less the headwind', () => {
  for (const [from, kt] of [[90, 30], [300, 45], [180, 20]]) {
    const sim = airborne({ altFt: 9000, iasKt: 280, hdg: 0, fuelKg: 9000, ap: { ap: true, athr: true, hdgDeg: 20, altFt: 9000 } });
    sim.ap.setSpd(280);
    sim.setWeather(wx({ wind: { fromDeg: from, kt, gustKt: 0 }, aloft: { fromDeg: from, kt } }));
    run(sim, 90);
    const S = sim.state, trk = Math.atan2(S.vel.x, S.vel.y);
    const [rx, ry] = [Math.cos(trk), -Math.sin(trk)];   // the track's right, map axes (x east, y north)
    const cross = S.wind.x * rx + S.wind.y * ry;
    const tail = S.wind.x * Math.sin(trk) + S.wind.y * Math.cos(trk);
    const dr = Math.asin(cross / S.tas);
    near(S.drift, dr, 0.3 * DEG, `drift in ${kt} kt from ${from}`);
    near(S.gs, S.tas * Math.cos(dr) + tail, 0.6, `groundspeed in ${kt} kt from ${from}`);
    assert.ok(Math.abs(S.drift) > 0.01, 'there is a drift');
  }
});

test('a headwind: IAS and Mach come from the airspeed, and the groundspeed stays inertial', () => {
  const sim = airborne({ altFt: 9000, iasKt: 280, hdg: 0, fuelKg: 9000, ap: { ap: true, athr: true, hdgDeg: 0, altFt: 9000 } });
  sim.ap.setSpd(280);
  run(sim, 30);
  const calmIas = sim.state.ias, calmGs = sim.state.gs, calmMach = sim.state.mach;
  sim.setWeather(wx({ wind: { fromDeg: 0, kt: 60, gustKt: 0 }, aloft: { fromDeg: 0, kt: 60 } }));
  // The moment it's set: inertial speed unchanged, the airspeed up by the headwind.
  near(sim.state.gs, calmGs, 1e-9, 'groundspeed at once');
  assert.ok(sim.state.ias > calmIas + 20 * KT, `IAS ${sim.state.ias / KT}`);
  assert.ok(sim.state.mach > calmMach + 0.02, `Mach ${sim.state.mach}`);
  run(sim, 120);
  near(sim.state.ias / KT, 280, 3, 'the A/THR flies the airspeed');
  assert.ok(sim.state.gs < calmGs - 20 * KT, 'and the headwind takes it off the groundspeed');
});

test('an airborne start in a wind trims in the air mass, crabbed to the track asked for', () => {
  const sim = createSim({ ground: () => ({ h: 0, kind: 'water' }) });
  sim.setWeather(wx({ wind: { fromDeg: 90, kt: 25, gustKt: 0 }, aloft: { fromDeg: 90, kt: 25 } }));
  const track = 40 * DEG;
  sim.reset({ x: 0, y: 0, hdg: track, onGround: false, z: 3000, iasMs: 250 * KT, flapLever: 0, gearDown: false, fuelKg: 9000, payloadKg: 15000 });
  const S = sim.state;
  near(Math.atan2(S.vel.x, S.vel.y), track, 1e-6, 'the track');
  near(S.ias / KT, 250, 0.5, 'the IAS asked for');
  assert.ok(Math.abs(S.drift) > 2 * DEG, `crabbed ${S.drift / DEG}°`);
  const hEnd = (() => { run(sim, 20); return S.pos.z; })();
  near(hEnd, 3000, 40, 'trimmed');
});

test('parked in a gale, from any side: the aircraft stays put and nothing blows up', () => {
  for (const from of [0, 90, 180, 270]) {
    const sim = parked(10, wx({ wind: { fromDeg: from, kt: 45, gustKt: 60 }, aloft: { fromDeg: from, kt: 60 }, turbulence: 'severe' }));
    const x0 = sim.state.pos.x, y0 = sim.state.pos.y, roll0 = sim.state.roll;
    run(sim, 60);
    const S = sim.state;
    assert.equal(S.crashed, null, `no crash, wind from ${from}`);
    // The tyre model creeps under a sustained side load: about 1 m a minute in this 45-gusting-60 kt gale.
    assert.ok(Math.hypot(S.pos.x - x0, S.pos.y - y0) < 3, `stays put: ${Math.hypot(S.pos.x - x0, S.pos.y - y0)} m`);
    assert.ok(Math.abs(S.roll - roll0) < 3 * DEG, `level: ${S.roll / DEG}°`);
    assert.ok(S.onGround, 'on its wheels');
  }
});

test('the wheels roll on the ground: braked to a stop in a headwind, the groundspeed is zero while the IAS shows the wind', () => {
  const sim = parked(0, wx({ wind: { fromDeg: 352, kt: 30, gustKt: 0 }, aloft: { fromDeg: 352, kt: 30 } }));
  run(sim, 5);
  near(sim.state.gs, 0, 0.05, 'groundspeed');
  assert.ok(sim.state.ias > 18 * KT, `IAS ${sim.state.ias / KT} kt`);
});

// ---- saves and the prediction ----

const ROUGH = wx({ seed: 11, wind: { fromDeg: 120, kt: 22, gustKt: 35 }, aloft: { fromDeg: 150, kt: 45 }, turbulence: 'moderate', tempC: 8, qnh: 1002, shear: { ftAgl: 1500, fromDeg: 300, kt: 15 } });

test('a gusty, turbulent flight restored from a save flies on as the original did (within 1e-6 m)', () => {
  const a = airborne({ altFt: 5000, iasKt: 250, hdg: 0.5, fuelKg: 9000, ap: { ap: true, athr: true, hdgDeg: 40, altFt: 5000 } });
  a.ap.setSpd(250);
  a.setWeather(ROUGH);
  run(a, 45);
  const snap = viaJson(a.snapshot());
  assert.ok(snap.weather, 'the snapshot carries the settings');
  const b = createSim();
  b.restore(snap);
  assert.deepEqual(viaJson(b.weather), viaJson(a.weather));
  run(a, 60); run(b, 60);
  for (const k of ['x', 'y', 'z']) near(a.state.pos[k], b.state.pos[k], 1e-6, `pos.${k}`);
  near(a.state.ias, b.state.ias, 1e-6, 'ias');
  assert.deepEqual(a.state.wind, b.state.wind, 'the same air');
});

test('the prediction agrees with the live sim in turbulence about as it does in calm', () => {
  // The two step at 1/30 s and 1/120 s, so they never match to the bit, in calm either: the prediction samples
  // the same field through a coarser integrator. The test: 120 s ahead, within 4× the calm figure, or 60 m.
  const diff = (weather) => {
    const a = airborne({ altFt: 5000, iasKt: 250, hdg: 0.5, fuelKg: 9000, ap: { ap: true, athr: true, hdgDeg: 40, altFt: 5000 } });
    a.ap.setSpd(250);
    if (weather) a.setWeather(weather);
    run(a, 20);
    const { samples } = predictSync(viaJson(a.snapshot()), { maxMinutes: 2 });
    run(a, 120);
    const last = samples[samples.length - 1];
    assert.ok(Math.abs(last.t - a.state.t) < 0.05, `the same moment: ${last.t} vs ${a.state.t}`);
    return Math.hypot(last.x - a.state.pos.x, last.y - a.state.pos.y, last.z - a.state.pos.z);
  };
  const calm = diff(null), rough = diff(ROUGH);
  console.log(`prediction vs live after 120 s: calm ${calm.toFixed(2)} m, turbulent ${rough.toFixed(2)} m`);
  assert.ok(rough < Math.max(4 * calm, 60), `${rough} m (calm ${calm} m)`);
});

test('the prediction\'s cost with turbulence on stays within the budget (90 minutes of flight)', () => {
  const a = airborne({ altFt: 35000, iasKt: 270, hdg: 0.5, fuelKg: 15000, ap: { ap: true, athr: true, hdgDeg: 40, altFt: 35000 } });
  a.setWeather({ ...ROUGH, turbulence: 'severe' });
  const t0 = performance.now();
  const { samples, reason } = predictSync(viaJson(a.snapshot()));
  const ms = performance.now() - t0;
  console.log(`prediction with severe turbulence: ${ms.toFixed(0)} ms, ${samples.length} samples, ended by ${reason}`);
  assert.ok(ms < 2000, `${ms} ms`);
});

test('turbulence shakes the aircraft, and more when it\'s worse', () => {
  const shake = (level) => {
    // Heading 37° magnetic is the 0.5 rad it starts on: no turn in the numbers. Fast, to stay clear of the protections,
    // which would take the AP off (at 220 kt clean, severe turbulence does, as it should).
    const a = airborne({ altFt: 3000, iasKt: 290, hdg: 0.5, fuelKg: 9000, ap: { ap: true, athr: true, hdgDeg: 37, altFt: 3000, spdKt: 290 } });
    a.setWeather(wx({ seed: 5, turbulence: level }));
    let v = 0, n = 0, roll = 0;
    for (let i = 0; i < 40 * 120; i++) { a.step(1 / 120); a.events.length = 0; if (i > 240) { v += (a.state.nz - 1) ** 2; roll += a.state.p ** 2; n++; } }
    return { nz: Math.sqrt(v / n), p: Math.sqrt(roll / n), crashed: a.state.crashed, ap: a.ap.ap };
  };
  const none = shake('none'), lt = shake('light'), mod = shake('moderate'), sev = shake('severe');
  console.log(`σ(nz): none ${none.nz.toFixed(4)}, light ${lt.nz.toFixed(3)}, moderate ${mod.nz.toFixed(3)}, severe ${sev.nz.toFixed(3)}; σ(p) deg/s: none ${(none.p / DEG).toFixed(3)}, light ${(lt.p / DEG).toFixed(2)}, moderate ${(mod.p / DEG).toFixed(2)}, severe ${(sev.p / DEG).toFixed(2)}; AP still on: ${lt.ap}, ${mod.ap}, ${sev.ap}`);
  assert.ok(lt.nz > none.nz + 0.003 && mod.nz > lt.nz && sev.nz > mod.nz, 'graded in nz');
  assert.ok(lt.ap && mod.ap, 'light and moderate turbulence leave the autopilot on');
  assert.ok(lt.p > none.p + 0.1 * DEG && sev.p > lt.p, 'the wings feel it, graded');
  assert.ok(sev.crashed === null, 'and flyable');
  assert.ok(sev.nz < 0.6, `severe ${sev.nz}`);
});

test('setting the weather in flight doesn\'t trip the protections or take the autopilot off', () => {
  // 320 kt in this air reads 340 and gusts past VMO + 6: that one is a real overspeed.
  for (const kt of [220, 300]) {
    const a = airborne({ altFt: 3000, iasKt: kt, hdg: 0.5, fuelKg: 9000, ap: { ap: true, athr: true, hdgDeg: 37, altFt: 3000, spdKt: kt } });
    run(a, 10);
    a.setWeather(wx({ seed: 2, wind: { fromDeg: 30, kt: 15, gustKt: 25 }, aloft: { fromDeg: 50, kt: 20 }, turbulence: 'light' }));
    run(a, 30);
    assert.ok(a.ap.ap, `AP still on at ${kt} kt`);
  }
});

test('a microburst on the flight path costs airspeed, then lift: headwind first, tailwind after, sink in between', () => {
  const sim = airborne({ altFt: 600, iasKt: 150, hdg: 0, fuelKg: 9000, flapLever: 3, gearDown: true, ap: { ap: true, athr: true, hdgDeg: 8, altFt: 600 } });
  const y0 = sim.state.pos.y, burstY = y0 + 77 * 40;
  sim.setWeather(wx({ microbursts: [{ x: sim.state.pos.x, y: burstY, radiusM: 1000, dvKt: 50 }] }));
  const seen = { head: 0, tail: 0, sink: 0 };
  for (let i = 0; i < 90 * 120; i++) {
    sim.step(1 / 120); sim.events.length = 0;
    const W = sim.state.wind;
    if (W.y < seen.head) seen.head = W.y;
    if (W.y > seen.tail) seen.tail = W.y;
    if (W.z < seen.sink) seen.sink = W.z;
  }
  assert.ok(seen.head < -8, `a headwind of ${-seen.head} m/s going in`);
  assert.ok(seen.tail > 8, `a tailwind of ${seen.tail} m/s coming out`);
  assert.ok(seen.sink < -4, `a downdraft of ${-seen.sink} m/s`);
  assert.equal(sim.state.crashed, null);
});

// ---- the windshear warning and the wind at touchdown (Part 2) ----

test('the windshear warning: a microburst on the approach sets it, steady winds and turbulence don\'t', async () => {
  const pass = (weather) => {
    const sim = airborne({ altFt: 800, iasKt: 150, hdg: 0, fuelKg: 9000, flapLever: 3, gearDown: true, ap: { ap: true, athr: true, hdgDeg: 8, altFt: 800 } });
    sim.setWeather(weather(sim.state));
    let on = false;
    for (let i = 0; i < 70 * 120; i++) { sim.step(1 / 120); sim.events.length = 0; if (sim.state.warnings.windshear) on = true; }
    return on;
  };
  assert.ok(pass((s) => wx({ microbursts: [{ x: s.pos.x, y: s.pos.y + 77 * 30, radiusM: 1000, dvKt: 60 }] })), 'a 60 kt microburst warns');
  assert.ok(!pass(() => wx({ wind: { fromDeg: 90, kt: 25, gustKt: 0 }, aloft: { fromDeg: 110, kt: 40 } })), 'a steady crosswind does not');
  assert.ok(!pass(() => wx({ seed: 9, wind: { fromDeg: 90, kt: 15, gustKt: 0 }, aloft: { fromDeg: 90, kt: 20 }, turbulence: 'moderate' })), 'moderate turbulence does not');
});

test('the wind at touchdown: "from" in magnetic degrees, with its parts along and across the runway', async () => {
  const { windAtTouchdown } = await import('../src/score.js');
  const rf = { ux: 0, uy: 1 };     // a north-going runway (grid)
  // Air going west (from the east, the right of a north-going aircraft), and a little south (a headwind).
  const s = { pos: { x: 0, y: 0 }, wind: { meanX: -10, meanY: -3, x: -10, y: -3, z: 0 } };
  const w = windAtTouchdown(s, rf);
  near(w.kt, Math.hypot(10, 3) * 1.943844, 1e-6, 'speed');
  near(w.head, 3 * 1.943844, 1e-6, 'headwind');
  near(w.cross, 10 * 1.943844, 1e-6, 'crosswind');
  assert.equal(w.side, 'R');
  near(((w.fromDeg - (Math.atan2(10, 3) / DEG + 8.46)) % 360 + 360) % 360, 0, 0.5, 'from, magnetic');
  const calm = windAtTouchdown({ pos: { x: 0, y: 0 }, wind: { meanX: 0, meanY: 0 } }, rf);
  assert.equal(calm.kt, 0, 'calm has no wind');
});

// The review of 2026-11-10: the card and the logbook give the tower's wind (10 m, with the gusts' peak), as the
// panel and its METAR line do, not the mean at the aircraft's few metres (a 15 kt wind read 13 kt).
test('the wind at touchdown is the tower\'s: the panel\'s surface wind and its gusts, whatever the height', async () => {
  const { windAtTouchdown } = await import('../src/score.js');
  const sim = airborne({ altFt: 3000, iasKt: 180, hdg: 0, fuelKg: 9000 });
  sim.setWeather(wx({ wind: { fromDeg: 120, kt: 15, gustKt: 25 }, aloft: { fromDeg: 150, kt: 40 } }));
  run(sim, 1);
  const w = windAtTouchdown(sim.state, null);
  near(w.kt, 15, 0.01, 'the panel\'s 15 kt, not the wind at 3,000 ft');
  near(((w.fromDeg - 120) % 360 + 540) % 360 - 180, 0, 0.5, 'from 120° magnetic');
  assert.equal(w.gustKt, 25, 'and its gusts');
  sim.setWeather(wx({ wind: { fromDeg: 120, kt: 15, gustKt: 0 }, aloft: { fromDeg: 150, kt: 40 } }));
  run(sim, 0.1);
  assert.equal(windAtTouchdown(sim.state, null).gustKt, 0, 'no gusts, no G');
  sim.setWeather(null);
  run(sim, 0.1);
  assert.equal(windAtTouchdown(sim.state, null).kt, 0, 'calm');
});

test('a windshear alert ends when the wind does, and a steady wind in a turn isn\'t a shear', () => {
  const sim = airborne({ altFt: 800, iasKt: 150, hdg: 0, fuelKg: 9000, flapLever: 3, gearDown: true, ap: { ap: true, athr: true, hdgDeg: 8, altFt: 800 } });
  sim.setWeather(wx({ microbursts: [{ x: sim.state.pos.x, y: sim.state.pos.y + 77 * 30, radiusM: 1000, dvKt: 60 }] }));
  let on = false;
  for (let i = 0; i < 60 * 120 && !on; i++) { sim.step(1 / 120); sim.events.length = 0; on = sim.state.warnings.windshear; }
  assert.ok(on, 'alerted');
  sim.setWeather(null);
  run(sim, 8);
  assert.equal(sim.state.warnings.windshear, false, 'it times out with no wind');

  const turn = airborne({ altFt: 1200, iasKt: 200, hdg: 0, fuelKg: 9000, ap: { ap: true, athr: true, hdgDeg: 8, altFt: 1200 } });
  turn.setWeather(wx({ wind: { fromDeg: 280, kt: 50, gustKt: 0 }, aloft: { fromDeg: 280, kt: 50 } }));
  turn.ap.setHdg(188);
  let peak = 0;
  for (let i = 0; i < 100 * 120; i++) { turn.step(1 / 120); turn.events.length = 0; peak = Math.max(peak, turn._core.wsF); assert.ok(!turn.state.warnings.windshear, 'no alert in a turn'); }
  assert.ok(peak < 0.03, `the turn leaves the F-factor alone: ${peak}`);
});

test('a rewind into changed air reads no shear or acceleration from the change', () => {
  const a = airborne({ altFt: 1200, iasKt: 220, hdg: 0, fuelKg: 9000, ap: { ap: true, athr: true, hdgDeg: 8, altFt: 1200 } });
  a.setWeather(wx({ wind: { fromDeg: 0, kt: 10, gustKt: 0 }, aloft: { fromDeg: 0, kt: 10 } }));
  run(a, 20);
  const snap = viaJson(a.snapshot());
  a.setWeather(wx({ wind: { fromDeg: 180, kt: 40, gustKt: 0 }, aloft: { fromDeg: 180, kt: 40 } }));
  run(a, 5);
  a.restore(snap, { keepWeather: true });
  a.step(1 / 120);
  assert.ok(Math.abs(a._core.wsF) < 0.02, `F ${a._core.wsF}`);
  assert.ok(Math.abs(a._core.iasDot) < 1, `iasDot ${a._core.iasDot}`);
});

test('the screens\' Mach follows the day\'s air, and a standard day stays on ISA', async () => {
  const { machOfKt, ktOfMach } = await import('../src/ui/boeing/logic.js');
  const sim = airborne({ altFt: 35000, mach: 0.78, hdg: 0, fuelKg: 9000 });
  assert.equal(sim.state.airP, 0, 'a standard day');
  sim.setWeather(wx({ tempC: 35 }));
  run(sim, 1 / 60);
  const S = sim.state;
  near(machOfKt(S.ias / KT, S.pos.z, S), S.mach, 0.002, 'Mach from IAS');
  near(ktOfMach(S.mach, S.pos.z, S), S.ias / KT, 0.5, 'IAS from Mach');
});

test('the transition reminder: QNH left set climbing through 14,000 ft, STD left set descending below FL140', () => {
  const sim = airborne({ altFt: 14500, iasKt: 300, hdg: 0, fuelKg: 9000 });
  run(sim, 1);
  sim.setBaro(1020);
  sim.setBaroStd(true); sim.setBaroStd(false);
  // Above it with a QNH, climbing or level: a reminder (the review of 2026-11-10: it stays until STD is set, as on
  // both makers' PFDs; it used to go out in level flight).
  const climb = (s) => { s.step(1 / 120); s.events.length = 0; };
  for (let i = 0; i < 120; i++) climb(sim);
  assert.equal(sim.state.baroAlert, true, 'QNH still set, level above 14,000 ft');
  sim._core.vd = -8; climb(sim); sim._core.vd = -8; climb(sim);
  assert.equal(sim.state.baroAlert, true, 'QNH still set, climbing above 14,000 ft');
  sim.setBaroStd(true); climb(sim);
  assert.equal(sim.state.baroAlert, false, 'STD set above it: no reminder');
  sim.setBaroStd(false);
  sim.setBaro(1013.25);
  sim._core.vd = -8; climb(sim); sim._core.vd = -8; climb(sim);
  assert.equal(sim.state.baroAlert, false, '1013 reads the same: the default world doesn\'t nag');
  const down = airborne({ altFt: 13000, iasKt: 300, hdg: 0, fuelKg: 9000 });
  run(down, 1);
  down.setBaroStd(true);
  down._core.vd = 8; down.step(1 / 120); down._core.vd = 8; down.step(1 / 120);
  assert.equal(down.state.baroAlert, true, 'STD still set, descending below FL140');
});
