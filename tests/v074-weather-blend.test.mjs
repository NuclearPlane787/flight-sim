// v0.7.4, weather by place (briefs/V0-7-4.md, part 4): the departure's and the destination's weather, blended
// by position alone. The blend's shape; the same air at a point in the live sim, the prediction and a jump's
// restore (to 1e-9); an end's third flying that end's weather to the bit; both ends the same is one weather,
// so it flies as before v0.7.4 (the golden flights run on that path unchanged).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { predictSync } from '../src/sim/predict-core.js';
import {
  compileWeather, normalizeWeather, windAt, newWind, blendWeight, localWeather, weatherAt, endWeather,
  withEndWeather, hasTwoEnds, blendSettings, createWeatherFollower, isDefaultWeather, calmWeather, moveDestination,
} from '../src/sim/weather.js';
import { presetWeather, routeWeather } from '../src/sim/weather-presets.js';
import { airborne, run, KT, FT } from './sim-helpers.mjs';

// A route due north: the departure 40 km south of the origin, the destination 50 km north. The aircraft starts at
// the origin (t = 0.444, the middle third) flying north.
const ENDS = { ax: 0, ay: -40000, bx: 0, by: 50000 };
const DEP = presetWeather('few-clouds', { refX: ENDS.ax, refY: ENDS.ay });
const DEST = presetWeather('thunderstorm', { refX: ENDS.bx, refY: ENDS.by });
const TWO = withEndWeather(DEST, 'dep', DEP, ENDS);
const viaJson = (o) => JSON.parse(JSON.stringify(o));

test('the blend: each end holds over its third, smooth across the middle, the nearer end beyond', () => {
  const at = (t) => blendWeight(ENDS, 0, ENDS.ay + t * (ENDS.by - ENDS.ay));
  assert.equal(at(-0.5), 0); assert.equal(at(0), 0); assert.equal(at(1 / 3), 0); assert.equal(at(0.3), 0);
  assert.equal(at(2 / 3), 1); assert.equal(at(1), 1); assert.equal(at(1.7), 1);
  assert.ok(Math.abs(at(0.5) - 0.5) < 1e-12);
  let prev = 0;
  for (let t = 0.34; t < 0.67; t += 0.01) { const w = at(t); assert.ok(w >= prev && w >= 0 && w <= 1); prev = w; }
  // Off to the side: by the place along the route (projected).
  assert.equal(blendWeight(ENDS, 80000, ENDS.ay), 0);
  assert.equal(blendWeight(ENDS, -80000, ENDS.by), 1);
  // One place for both: the departure's.
  assert.equal(blendWeight({ ax: 5, ay: 5, bx: 5, by: 5 }, 1e5, 1e5), 0);
});

test('both ends the same is one weather: the destination\'s, as before v0.7.4', () => {
  const rainA = presetWeather('rain', { refX: ENDS.ax, refY: ENDS.ay }), rainB = presetWeather('rain', { refX: ENDS.bx, refY: ENDS.by });
  const s = withEndWeather(rainB, 'dep', rainA, ENDS);
  assert.equal(hasTwoEnds(s), false);
  assert.deepEqual(s, rainB);
  assert.equal(compileWeather(s).two, undefined);
  // The plan's way: the same preset at both ends is presetWeather() itself.
  const ctx = { refX: ENDS.bx, refY: ENDS.by, ends: ENDS, departure: { icao: 'RKSS', origin: [ENDS.ax, ENDS.ay] }, arrival: { icao: 'RKPC' } };
  assert.deepEqual(routeWeather('rain', undefined, ctx), presetWeather('rain', ctx));
  assert.deepEqual(routeWeather('rain', 'rain', ctx), presetWeather('rain', ctx));
  assert.equal(hasTwoEnds(routeWeather('clear', 'rain', ctx)), true);
  // Calm at both ends is the default weather (the sim skips the weather altogether).
  assert.equal(isDefaultWeather(withEndWeather(calmWeather(), 'dep', calmWeather(), ENDS)), true);
  assert.equal(isDefaultWeather(TWO), false);
});

test('the air in an end\'s third is that end\'s weather alone, to the bit; the middle is between', () => {
  const C = compileWeather(TWO), A = compileWeather(DEP), B = compileWeather(DEST);
  const w = newWind(), a = newWind(), b = newWind();
  for (const [y, K] of [[-60000, A], [-20000, A], [-10000, A], [20000, B], [35000, B], [90000, B]]) {
    for (const t of [0, 13.7, 400]) {
      windAt(C, 1200, y, 900, 850, t, 0.3, 0.95, 35, w);
      windAt(K, 1200, y, 900, 850, t, 0.3, 0.95, 35, a);
      assert.deepEqual(w, a, `y ${y} t ${t}`);
    }
    const L = localWeather(C, 1200, y);
    assert.equal(L, y < 0 ? C.A : C.B);   // that end's own compiled weather, the very object
    assert.deepEqual(L, K);
  }
  // The middle: a weighted sum of the two.
  const y = 5000, k = blendWeight(ENDS, 0, y);
  assert.ok(k > 0 && k < 1);
  windAt(C, 0, y, 900, 850, 50, 0, 1, 35, w); windAt(A, 0, y, 900, 850, 50, 0, 1, 35, a); windAt(B, 0, y, 900, 850, 50, 0, 1, 35, b);
  for (const key of ['n', 'e', 'd', 'meanN', 'meanE']) assert.ok(Math.abs(w[key] - (a[key] + (b[key] - a[key]) * k)) < 1e-12, key);
  const L = localWeather(C, 0, y);
  assert.ok(Math.abs(L.qnhPa - (A.qnhPa + (B.qnhPa - A.qnhPa) * k)) < 1e-9);
  assert.ok(Math.abs(L.dT - (A.dT + (B.dT - A.dT) * k)) < 1e-12);
  assert.equal(L.atmOn, true);
});

test('the same air at a point in the live sim, the prediction and a jump\'s restore (1e-9)', () => {
  const live = airborne({ massKg: 72000, fuelKg: 8000, altFt: 6000, iasKt: 250, hdg: 0, ap: { ap: true, athr: true, spdKt: 250, hdgDeg: 0, altFt: 6000 } });
  live.setWeather(TWO);
  run(live, 10);
  const snap = live.snapshot();
  const { samples } = predictSync(viaJson(snap), { maxMinutes: 3 });
  assert.ok(samples.length > 10);
  const W = newWind();
  let checked = 0;
  for (const smp of samples.slice(1, 20)) {
    const c = smp.snap.core;
    const C = compileWeather(smp.snap.weather);
    const k = blendWeight(ENDS, c.px, c.py);
    // The jump: a fresh sim from the sample (JSON, as a save or the worker sends it).
    const jump = createSim({}); jump.restore(viaJson(smp.snap));
    // The live sim, jumped there in the weather it has now (a jump keeps the weather set).
    live.restore(smp.snap, { keepWeather: true });
    const g = 0;   // (sea level ground: the sims' default)
    windAt(C, c.px, c.py, c.pz, c.pz - g, c.t, 0, 0, 0, W);
    for (const S of [jump.state, live.state]) {
      assert.ok(Math.abs(S.wind.x - W.e) < 1e-9 && Math.abs(S.wind.y - W.n) < 1e-9 && Math.abs(S.wind.z + W.d) < 1e-9, `t ${c.t} w ${k}`);
    }
    assert.ok(Math.abs(jump.state.altInd - live.state.altInd) < 1e-9);
    assert.ok(Math.abs(jump.state.ias - live.state.ias) < 1e-9);
    if (k > 0 && k < 1) checked++;
  }
  assert.ok(checked >= 5, `${checked} samples in the blend`);
  // And the prediction from the jump is the prediction from the live sim, sample for sample.
  const again = predictSync(viaJson(samples[3].snap), { maxMinutes: 1 }).samples;
  const ref = samples.slice(3, 3 + again.length);
  for (let i = 0; i < ref.length; i++) {
    assert.ok(Math.abs(again[i].x - ref[i].x) < 1e-9 && Math.abs(again[i].y - ref[i].y) < 1e-9 && Math.abs(again[i].z - ref[i].z) < 1e-9, `sample ${i}`);
  }
});

test('flying in the departure\'s third: two ends fly as the departure\'s weather alone, to the bit', () => {
  const mk = (wx) => {
    const s = airborne({ massKg: 72000, fuelKg: 8000, altFt: 3000, iasKt: 220, hdg: Math.PI, ap: { ap: true, athr: true, spdKt: 220, hdgDeg: 180, altFt: 3000 } });
    s.setWeather(wx); return s;
  };
  // At the origin flying south, with the route's ends moved north so the origin is in the departure's third.
  const ends = { ax: 0, ay: 5000, bx: 0, by: 200000 };
  const two = mk(withEndWeather(DEST, 'dep', DEP, ends)), one = mk(DEP);
  run(two, 30); run(one, 30);
  assert.deepEqual(two.snapshot().core, one.snapshot().core);
});

test('both ends the same weather: every number as before (a flight in it to the bit)', () => {
  const rainA = presetWeather('rain', { refX: ENDS.ax, refY: ENDS.ay, seed: 13 }), rainB = presetWeather('rain', { refX: ENDS.bx, refY: ENDS.by, seed: 13 });
  const mk = (wx) => {
    const s = airborne({ massKg: 72000, fuelKg: 8000, altFt: 3000, iasKt: 220, hdg: 0, ap: { ap: true, athr: true, spdKt: 220, hdgDeg: 0, altFt: 3000 } });
    s.setWeather(wx); return s;
  };
  const same = mk(withEndWeather(rainB, 'dep', rainA, ENDS)), before = mk(rainB);
  run(same, 40); run(before, 40);
  assert.deepEqual(same.snapshot().core, before.snapshot().core);
  assert.deepEqual(same.weather, before.weather);
});

test('the look: the camera\'s weather, an end\'s own at its third, a blend between, changing by steps', () => {
  // The departure's own weather, with the flight's one cloud pattern and drift (the destination's) for the look.
  const atDep = weatherAt(TWO, 0, -30000);
  assert.deepEqual(normalizeWeather(atDep), normalizeWeather({ ...endWeather(TWO, 'dep'), microbursts: [], seed: DEST.seed }));
  assert.deepEqual(atDep.cloud, { seed: DEST.seed, aloft: DEST.aloft, refX: DEST.refX, refY: DEST.refY, trueWind: true });
  const mid = weatherAt(TWO, 0, 5000);
  assert.ok(mid.precip.kind === 'rain' && mid.precip.rate > 0 && mid.precip.rate < DEST.precip.rate);
  assert.ok(mid.qnh < DEP.qnh && mid.qnh > DEST.qnh);
  assert.ok(mid.visM < DEP.visM && mid.visM > DEST.visM);
  assert.ok(mid.lightning > 0 && mid.lightning < DEST.lightning);
  // A single weather passes through as the very object (the world draws exactly as before).
  const f = createWeatherFollower();
  assert.equal(f.at(DEST, 0, 0), DEST);
  assert.equal(f.at(null, 0, 0), null);
  // Two ends: the same object until the weight moves a step.
  const a = f.at(TWO, 0, 5000), b = f.at(TWO, 0, 5010);
  assert.equal(a, b);
  let changes = 0, last = null;
  for (let y = -40000; y <= 50000; y += 100) { const o = f.at(TWO, 0, y); if (o !== last) { changes++; last = o; } }
  assert.ok(changes > 5 && changes <= 26, `${changes} changes across the route`);
  // A calm end looks and sounds as the default weather: null, as the world and the synth are given for calm.
  const calmDep = withEndWeather(DEST, 'dep', calmWeather(), ENDS), g = createWeatherFollower();
  assert.equal(g.at(calmDep, 0, -30000), null);
  assert.ok(g.at(calmDep, 0, 40000).precip.rate > 0);
  // blendSettings at its ends is each weather.
  assert.deepEqual(blendSettings(DEP, DEST, 0), DEP);
  assert.deepEqual(blendSettings(DEP, DEST, 1), DEST);
});

test('a storm\'s microbursts stay with the end that has it', () => {
  const ctx = { refX: ENDS.bx, refY: ENDS.by, airports: [{ x: ENDS.ax, y: ENDS.ay }, { x: ENDS.bx, y: ENDS.by }], seed: 3 };
  // Find a seed whose severe storm has a cell at both airports.
  let storm = null;
  for (let seed = 1; seed < 400 && !storm; seed++) {
    const s = presetWeather('thunderstorm-severe', { ...ctx, seed });
    if (s.microbursts.length === 2) storm = s;
  }
  assert.ok(storm, 'a storm with two cells');
  const two = withEndWeather(storm, 'dep', calmWeather(), ENDS);   // calm at the departure, the storm at the destination
  const C = compileWeather(two);
  assert.equal(C.bursts.length, 1, 'only the destination\'s cell is scanned');
  const near = storm.microbursts.find((m) => blendWeight(ENDS, m.x, m.y) === 1);
  const far = storm.microbursts.find((m) => blendWeight(ENDS, m.x, m.y) === 0);
  const W = newWind();
  windAt(C, far.x, far.y, 100, 100, 0, 0, 0, 0, W);
  assert.equal(W.d, 0, 'no downdraft at the calm end');
  windAt(C, near.x, near.y, 100, 100, 0, 0, 0, 0, W);
  assert.ok(W.d > 1, 'the destination\'s downdraft');
  const look = weatherAt(two, 0, 45000);
  assert.equal(look.microbursts.length, 1);
  assert.equal(weatherAt(two, 0, -45000).microbursts.length, 0);
});

// v0.7.4's review, 1: crossing the blend changes how much cloud there is and where its layers sit, never where the
// whole field is (its drift wind) or which pattern it has (its seed).
test('the look across the middle third: one cloud seed, one drift, cover and bases moving one way', () => {
  const clear = presetWeather('few-clouds', { refX: ENDS.ax, refY: ENDS.ay });          // FEW at 4,000 ft, seed 11
  const storm = presetWeather('overcast', { refX: ENDS.bx, refY: ENDS.by });            // BKN 2,200 ft, OVC 5,000 ft, seed 12
  const s = withEndWeather(storm, 'dep', clear, ENDS);
  const f = createWeatherFollower();
  let prev = null, seen = 0;
  for (let t = 0.3; t <= 0.7 + 1e-9; t += 0.005) {
    const y = ENDS.ay + t * (ENDS.by - ENDS.ay), o = f.at(s, 0, y);
    assert.equal(o.seed, storm.seed); assert.equal(o.cloud.seed, storm.seed);
    assert.deepEqual(o.cloud.aloft, storm.aloft); assert.equal(o.cloud.refX, storm.refX); assert.equal(o.cloud.refY, storm.refY);
    const cover = o.clouds.reduce((k, c) => k + c.okta, 0), base0 = o.clouds[0].baseFt;
    if (prev) { assert.ok(cover >= prev.cover, `cover at t ${t.toFixed(3)}`); assert.ok(base0 <= prev.base0 + 1e-9, `base at t ${t.toFixed(3)}`); }
    if (o !== prev?.o) seen++;
    prev = { cover, base0, o };
  }
  assert.ok(seen > 5);
  // A single weather has no `cloud`: the look is the weather itself, as before.
  assert.equal(createWeatherFollower().at(storm, 0, 0).cloud, undefined);
});

// v0.7.4's review, 2: a circuit (the destination is the departure's own airport) is one weather, the destination's.
test('a circuit is one weather: the destination\'s', () => {
  const here = { ax: 1000, ay: 2000, bx: 1300, by: 2100 };   // 316 m apart: one place
  assert.equal(hasTwoEnds(withEndWeather(DEST, 'dep', DEP, here)), false);
  assert.deepEqual(withEndWeather(DEST, 'dep', DEP, here), DEST);
  const ctx = { refX: 1300, refY: 2100, ends: here, departure: { icao: 'EDDB', origin: [1000, 2000] }, arrival: { icao: 'EDDB' } };
  assert.deepEqual(routeWeather('clear', 'rain', ctx), presetWeather('rain', ctx));
  assert.deepEqual(routeWeather('rain', undefined, ctx), presetWeather('rain', ctx));
  // A route changed back to its origin in flight: the destination's weather, there.
  const m = moveDestination(TWO, ENDS.ax + 200, ENDS.ay);
  assert.equal(hasTwoEnds(m), false);
  assert.equal(m.preset, DEST.preset); assert.equal(m.refX, ENDS.ax + 200);
});
