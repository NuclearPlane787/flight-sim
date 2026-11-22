// v0.7.4, weather by place: the Weather tab's switch (one end set, the other kept), the plan's two presets, a
// route changed in flight, and the saves: one from before v0.7.4 loads as the same weather at both ends, and a
// new one carries both ends and flies on exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { withEndWeather, endWeather, hasTwoEnds, moveDestination, calmWeather, normalizeWeather, blendWeight } from '../src/sim/weather.js';
import { presetWeather, weatherContext, routeWeather, endContext, weatherForm, weatherFromForm } from '../src/sim/weather-presets.js';
import { airborne, run } from './sim-helpers.mjs';

const viaJson = (o) => JSON.parse(JSON.stringify(o));
// Two made-up airports 90 km apart, north and south, each with one runway.
const AIRPORTS = [
  { icao: 'RKSS', origin: [0, -40000], runways: [{ ends: [{ ident: '14R', x: 100, y: -40000, hdgMagDeg: 143, hdgGridDeg: 135 }, { ident: '32L', x: -100, y: -39000, hdgMagDeg: 323, hdgGridDeg: 315 }] }] },
  { icao: 'RKPC', origin: [0, 50000], runways: [{ ends: [{ ident: '07', x: 0, y: 49000, hdgMagDeg: 69, hdgGridDeg: 61 }, { ident: '25', x: 0, y: 51000, hdgMagDeg: 249, hdgGridDeg: 241 }] }] },
  { icao: 'RKTU', origin: [20000, 5000], runways: [] },
];
const PLAN = { origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07' };

test('the flight\'s context has both ends, their places and every airport\'s', () => {
  const ctx = weatherContext(AIRPORTS, PLAN);
  assert.deepEqual(ctx.ends, { ax: 0, ay: -40000, bx: 0, by: 50000 });
  assert.equal(ctx.departure.icao, 'RKSS'); assert.equal(ctx.departure.hdgMagDeg, 143);
  assert.equal(ctx.arrival.icao, 'RKPC'); assert.equal(ctx.refX, 0); assert.equal(ctx.refY, 50000);
  assert.deepEqual(ctx.places.RKTU, { x: 20000, y: 5000 });
  assert.equal(Object.keys(ctx).includes('places'), false, 'left out of the ctx\'s JSON');
  const d = endContext(ctx, 'dep');
  assert.equal(d.refY, -40000); assert.equal(d.arrival.icao, 'RKSS');
  assert.equal(endContext(ctx, 'dest'), ctx);
  // The departure's crosswind is across its own runway.
  const x = routeWeather('gusty-crosswind', 'clear', ctx);
  assert.equal(x.dep.wind.fromDeg, (143 + 90) % 360);
});

test('New scenario\'s two presets: the destination\'s defaults to the departure\'s', () => {
  const ctx = weatherContext(AIRPORTS, PLAN);
  assert.deepEqual(routeWeather('snow', undefined, ctx), presetWeather('snow', ctx));
  const s = routeWeather('clear', 'thunderstorm', ctx);
  assert.ok(hasTwoEnds(s));
  assert.deepEqual(endWeather(s, 'dep'), calmWeather());
  assert.equal(endWeather(s, 'dest').preset, 'thunderstorm');
  assert.deepEqual(endWeather(s, 'dest'), presetWeather('thunderstorm', ctx));
});

test('the switch: setting one end keeps the other; the same at both is one weather again', () => {
  const ctx = weatherContext(AIRPORTS, PLAN);
  let s = null;   // calm
  s = withEndWeather(s, 'dest', presetWeather('rain', ctx), ctx.ends);
  assert.ok(hasTwoEnds(s));
  assert.deepEqual(endWeather(s, 'dep'), calmWeather(), 'the departure stays calm');
  assert.equal(endWeather(s, 'dest').preset, 'rain');
  // The departure's form, edited and applied as the tab does.
  const dctx = endContext(ctx, 'dep');
  const f = weatherForm(endWeather(s, 'dep'), dctx); f.wind.fromDeg = 270; f.wind.kt = 12; f.qnh = 1020;
  s = withEndWeather(s, 'dep', weatherFromForm(f, endWeather(s, 'dep'), dctx), ctx.ends);
  assert.equal(endWeather(s, 'dep').wind.kt, 12); assert.equal(endWeather(s, 'dep').refY, -40000);
  assert.equal(endWeather(s, 'dest').preset, 'rain');
  // The destination set to the departure's weather: one weather.
  s = withEndWeather(s, 'dest', endWeather(s, 'dep'), ctx.ends);
  assert.equal(hasTwoEnds(s), false);
  assert.equal(s.wind.kt, 12);
  // No places (no plan): the one weather everywhere, as before.
  assert.deepEqual(withEndWeather(null, 'dest', presetWeather('fog', ctx), null), presetWeather('fog', ctx));
});

test('a route changed in flight moves the destination\'s weather with it; a single weather stays', () => {
  const ctx = weatherContext(AIRPORTS, PLAN);
  const s = routeWeather('clear', 'rain', ctx);
  const m = moveDestination(s, 20000, 5000);
  assert.deepEqual(m.ends, { ax: 0, ay: -40000, bx: 20000, by: 5000 });
  assert.equal(m.refX, 20000); assert.equal(m.refY, 5000);
  assert.equal(blendWeight(m.ends, 20000, 5000), 1, 'the new destination is in its weather');
  assert.equal(endWeather(m, 'dest').precip.kind, 'rain');
  const one = presetWeather('rain', ctx);
  assert.equal(moveDestination(one, 20000, 5000), one);
});

test('a save from before v0.7.4 loads as the same weather at both ends', () => {
  const ctx = weatherContext(AIRPORTS, PLAN);
  const a = airborne({ altFt: 5000, iasKt: 240, ap: { ap: true, athr: true, spdKt: 240, hdgDeg: 0, altFt: 5000 } });
  a.setWeather(presetWeather('rain', ctx));
  run(a, 5);
  const old = viaJson(a.snapshot());
  assert.equal(old.weather.dep, undefined);
  const b = createSim({}); b.restore(old);
  assert.equal(hasTwoEnds(b.weather), false);
  assert.deepEqual(endWeather(b.weather, 'dep'), endWeather(b.weather, 'dest'));
  run(a, 20); run(b, 20);
  assert.deepEqual(b.snapshot().core, a.snapshot().core);
});

test('a new save carries both ends and flies on exactly', () => {
  const ctx = weatherContext(AIRPORTS, PLAN);
  const wx = routeWeather('few-clouds', 'thunderstorm', ctx);
  const a = airborne({ altFt: 5000, iasKt: 240, ap: { ap: true, athr: true, spdKt: 240, hdgDeg: 0, altFt: 5000 } });
  a.setWeather(wx);
  run(a, 5);
  const snap = viaJson(a.snapshot());
  assert.ok(hasTwoEnds(snap.weather));
  assert.deepEqual(normalizeWeather(snap.weather), wx);
  const b = createSim({}); b.restore(snap);
  assert.deepEqual(b.weather, a.weather);
  run(a, 30); run(b, 30);
  assert.deepEqual(b.snapshot().core, a.snapshot().core);
  assert.deepEqual(viaJson(b.snapshot()).weather, snap.weather);
});

// v0.7.4's review, 2: a circuit has one place, so the flight's context has no two ends (the Weather tab then shows
// Both ends only) and the plan's weather is one weather.
test('a circuit\'s context has no two ends, and its weather is one', () => {
  const ctx = weatherContext(AIRPORTS, { origin: 'RKSS', depRunway: '14R', dest: 'RKSS', arrRunway: '32L' });
  assert.equal(ctx.ends, undefined);
  assert.equal(ctx.departure.icao, 'RKSS'); assert.equal(ctx.arrival.icao, 'RKSS');
  const s = routeWeather('clear', 'snow', ctx);
  assert.equal(hasTwoEnds(s), false);
  assert.deepEqual(s, presetWeather('snow', ctx));
  assert.deepEqual(withEndWeather(null, 'dest', presetWeather('fog', ctx), ctx.ends), presetWeather('fog', ctx));
});
