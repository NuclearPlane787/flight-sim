// v0.4.0, Part 6: the presets, the tab's form, the checks and the METAR line.
//   node --test tests/weather-presets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calmWeather, normalizeWeather, isDefaultWeather, compileWeather } from '../src/sim/weather.js';
import { PRESETS, presetWeather, weatherContext, weatherForm, weatherFromForm, weatherCheck, metarOf, finalMicroburst, coverOf, oktaOf } from '../src/sim/weather-presets.js';

const here = new URL('..', import.meta.url).pathname;
const AIRPORTS = ['RKSS', 'RKPC', 'RKSI'].map((i) => JSON.parse(readFileSync(here + `data/airports/${i}.json`, 'utf8')));
const plan = { origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07' };
const ctx = weatherContext(AIRPORTS, plan);
const IDS = ['clear', 'few-clouds', 'overcast', 'rain', 'thunderstorm', 'snow', 'fog', 'gusty-crosswind'];

test('the eight presets are there', () => {
  assert.deepEqual(PRESETS.map((p) => p.id), IDS);
});

test('Clear is calmWeather() exactly, with or without a ctx, and an unknown id is too', () => {
  assert.deepEqual(presetWeather('clear'), calmWeather());
  assert.deepEqual(presetWeather('clear', ctx), calmWeather());
  assert.deepEqual(presetWeather('no-such-thing', ctx), calmWeather());
  assert.ok(isDefaultWeather(presetWeather('clear', ctx)));
});

test('each preset is complete, normal, named and not the calm world', () => {
  const keys = Object.keys(calmWeather()).sort();
  for (const id of IDS.slice(1)) {
    const s = presetWeather(id, ctx);
    assert.deepEqual(Object.keys(s).sort(), keys, id);
    assert.deepEqual(s, normalizeWeather(s), id);
    assert.equal(s.preset, id);
    assert.ok(!isDefaultWeather(s), id);
    assert.equal(s.refX, ctx.refX, id); assert.equal(s.refY, ctx.refY, id);
    compileWeather(s);    // and the sim can read it
  }
});

test('each wind veers with height: aloft is clockwise of the surface and stronger', () => {
  for (const id of IDS.slice(1)) {
    const s = presetWeather(id);
    const veer = ((s.aloft.fromDeg - s.wind.fromDeg) % 360 + 360) % 360;
    assert.ok(veer > 0 && veer <= 60, `${id}: veer ${veer}`);
    assert.ok(s.aloft.kt > s.wind.kt, id);
    if (s.wind.gustKt) assert.ok(s.wind.gustKt > s.wind.kt, id);
  }
});

test('temperatures fit their weather', () => {
  assert.ok(presetWeather('snow').tempC < 0);
  assert.ok(presetWeather('rain').tempC > 3 && presetWeather('thunderstorm').tempC > 10);
  assert.equal(presetWeather('snow').precip.kind, 'snow');
  assert.equal(presetWeather('thunderstorm').precip.kind, 'rain');
  assert.ok(presetWeather('thunderstorm').lightning > 0);
  assert.ok(presetWeather('fog').visM < 1000 && presetWeather('fog').fogTopFt > 0);
});

test('the gusty crosswind: 25G35, 90 degrees across the arrival runway; 090 with no ctx', () => {
  const none = presetWeather('gusty-crosswind');
  assert.equal(none.wind.fromDeg, 90);
  assert.equal(none.wind.kt, 25); assert.equal(none.wind.gustKt, 35);
  const s = presetWeather('gusty-crosswind', ctx), hdg = ctx.arrival.hdgMagDeg;
  const off = Math.abs((((s.wind.fromDeg - hdg) % 360) + 540) % 360 - 180);
  assert.ok(Math.abs(off - 90) < 1, `${off}° off the runway`);
});

test('the thunderstorm: seeded cells near the airports, no two builds different, a new seed moves them', () => {
  const a = presetWeather('thunderstorm', ctx), b = presetWeather('thunderstorm', ctx);
  assert.deepEqual(a, b);
  assert.ok(a.microbursts.length >= 6 && a.microbursts.length <= 24, `${a.microbursts.length} cells`);
  for (const m of a.microbursts) {
    const d = Math.min(...ctx.airports.map((p) => Math.hypot(m.x - p.x, m.y - p.y)));
    assert.ok(d >= 3000 && d <= 19000, `${d} m from an airport`);
    assert.ok(m.radiusM >= 800 && m.radiusM <= 1800 && m.dvKt >= 30 && m.dvKt <= 60);
  }
  const c = presetWeather('thunderstorm', { ...ctx, seed: 99 });
  assert.equal(c.seed, 99);
  assert.notDeepEqual(c.microbursts, a.microbursts);
  assert.deepEqual(presetWeather('thunderstorm').microbursts, []);   // no airports known
});

test('the context comes from the airport data', () => {
  assert.equal(ctx.arrival.icao, 'RKPC');
  const end = AIRPORTS[1].runways[0].ends[0];
  assert.equal(end.ident, '07');
  assert.equal(ctx.arrival.hdgMagDeg, end.hdgMagDeg);
  assert.equal(ctx.arrival.x, end.x); assert.equal(ctx.refX, AIRPORTS[1].origin[0]);
  assert.equal(ctx.airports.length, 3);
});

test('a form that changes nothing gives back the settings, preset and all, for every preset', () => {
  for (const id of IDS) {
    const s = presetWeather(id, ctx);
    assert.deepEqual(weatherFromForm(weatherForm(s, ctx), s, ctx), s, id);
  }
  assert.deepEqual(weatherFromForm(weatherForm(presetWeather('rain'), null), presetWeather('rain'), null), presetWeather('rain'));
});

test('changing any setting makes it custom, and leaves the rest alone', () => {
  const rain = presetWeather('rain', ctx), f = weatherForm(rain, ctx);
  f.wind.kt = 20;
  const c = weatherFromForm(f, rain, ctx);
  assert.equal(c.preset, 'custom');
  assert.equal(c.wind.kt, 20);
  assert.equal(c.seed, rain.seed);
  assert.deepEqual(c.clouds, rain.clouds);
  assert.deepEqual(c.precip, rain.precip);
});

test('edits made from clear pick up the arrival reference; back to the calm world is Clear', () => {
  const clear = presetWeather('clear', ctx), f = weatherForm(clear, ctx);
  f.wind.kt = 10; f.wind.fromDeg = 250;
  const c = weatherFromForm(f, clear, ctx);
  assert.equal(c.preset, 'custom');
  assert.equal(c.refX, ctx.refX);
  const g = weatherForm(c, ctx);
  g.wind.kt = 0; g.wind.fromDeg = 0;
  assert.deepEqual(weatherFromForm(g, c, ctx), calmWeather());
});

test('a microburst on final sits on the extended centreline, and is read back from its place', () => {
  const clear = calmWeather(), f = weatherForm(clear, ctx);
  f.mbNm = 3; f.mbKt = 45;
  const s = weatherFromForm(f, clear, ctx);
  assert.equal(s.microbursts.length, 1);
  const a = ctx.arrival, h = a.hdgGridDeg * Math.PI / 180, m = s.microbursts[0];
  const expectX = a.x - Math.sin(h) * 3 * 1852, expectY = a.y - Math.cos(h) * 3 * 1852;
  assert.ok(Math.hypot(m.x - expectX, m.y - expectY) < 1e-6);
  const fin = finalMicroburst(s, ctx);
  assert.equal(fin.index, 0); assert.ok(Math.abs(fin.nm - 3) < 1e-9); assert.equal(fin.dvKt, 45);
  // moved, then taken off: the storm's own cells stay
  const storm = presetWeather('thunderstorm', ctx), g = weatherForm(storm, ctx);
  g.mbNm = 4; g.mbKt = 40;
  const t = weatherFromForm(g, storm, ctx);
  assert.equal(t.microbursts.length, storm.microbursts.length + 1);
  const h2 = weatherForm(t, ctx);
  assert.ok(Math.abs(h2.mbNm - 4) < 1e-9); assert.equal(h2.mbKt, 40);
  h2.mbKt = 0;
  assert.deepEqual(weatherFromForm(h2, t, ctx).microbursts, storm.microbursts);
});

test('cloud covers by name', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(coverOf), ['none', 'FEW', 'FEW', 'SCT', 'SCT', 'BKN', 'BKN', 'BKN', 'OVC']);
  assert.equal(oktaOf('OVC'), 8); assert.equal(oktaOf('none'), 0);
});

test('the checks stop blanks, bad gusts and upside-down layers', () => {
  const ok = weatherForm(presetWeather('rain', ctx), ctx);
  assert.deepEqual(weatherCheck(ok, ctx), []);
  const with_ = (fn) => { const f = structuredClone(ok); fn(f); return weatherCheck(f, ctx); };
  assert.ok(with_((f) => { f.wind.kt = NaN; }).length);
  assert.ok(with_((f) => { f.wind.gustKt = 5; }).length);
  assert.ok(with_((f) => { f.clouds[0].topFt = 100; }).length);
  assert.ok(with_((f) => { f.qnh = 700; }).length);
  assert.ok(with_((f) => { f.mbKt = 40; f.mbNm = 40; }).length);
  assert.deepEqual(with_((f) => { f.wind.gustKt = 0; }), []);
  const noCtx = weatherForm(presetWeather('rain'), null);
  noCtx.mbKt = 40;
  assert.ok(weatherCheck(noCtx, null).some((p) => /arrival runway/.test(p)));
});

test('the METAR line reads as a METAR', () => {
  const s = normalizeWeather({ ...calmWeather(), preset: 'custom',
    wind: { fromDeg: 250, kt: 15, gustKt: 25 }, visM: 4000, precip: { kind: 'rain', rate: 0.25 },
    clouds: [{ okta: 6, baseFt: 1200, topFt: 3000 }, { okta: 8, baseFt: 3000, topFt: 9000 }], tempC: 12, qnh: 1008 });
  assert.equal(metarOf(s, 'RKPC'), 'RKPC 25015G25KT 4000 -RA BKN012 OVC030 12/10 Q1008');
  assert.equal(metarOf(calmWeather(), 'RKSI'), 'RKSI 00000KT CAVOK 15/07 Q1013');
  assert.match(metarOf(presetWeather('snow', ctx), 'RKSI'), /^RKSI 32012G20KT 1800 SN BKN009 OVC035 M04\/M06 Q1024$/);
  assert.match(metarOf(presetWeather('fog', ctx), 'RKSS'), /^RKSS 06003KT 0250 FG NSC 05\/05 Q1028$/);
  assert.match(metarOf(presetWeather('thunderstorm', ctx), 'RKPC'), /\+TSRA/);
  assert.match(metarOf(normalizeWeather({ ...calmWeather(), qnh: 998 }), 'RKPC'), / Q0998$/, 'four digits under 1000 hPa');
  const near = normalizeWeather({ ...calmWeather(), wind: { fromDeg: 355, kt: 12, gustKt: 0 } });
  assert.match(metarOf(near, 'RKPC'), / 36012KT /);
  const f = weatherForm(calmWeather(), ctx); f.mbNm = 3; f.mbKt = 45;
  assert.match(metarOf(weatherFromForm(f, calmWeather(), ctx), 'RKPC', ctx), /WS ALL RWY$/);
});
