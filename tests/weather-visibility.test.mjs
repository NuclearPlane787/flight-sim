// v0.4.0 Part 4: the air and the light for the weather (sky.js's pure parts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { visibilityAir, cloudCoverAt, cloudAtCamera, groundState, lightingAt, HAZE_SIGMA0, VIS_CLEAR_M } from '../src/world/sky.js';
import { readFileSync } from 'node:fs';

test('the default visibility is exactly the old constants (not recomputed)', () => {
  const a = visibilityAir(VIS_CLEAR_M, 0);
  assert.equal(a.sigma0, HAZE_SIGMA0);
  assert.equal(a.fogSigma, 0);
  assert.equal(a.fogMix, 0);
  assert.equal(a.lightCarry, 1);
  assert.equal(visibilityAir(undefined, 0).sigma0, HAZE_SIGMA0);
});

test('Koschmieder: sigma = 3.912 / visibility; with a fog top the slab carries it and the haze stays clear', () => {
  assert.equal(visibilityAir(3000, 0).sigma0, 3.912 / 3000);
  const fog = visibilityAir(400, 300);
  assert.equal(fog.sigma0, HAZE_SIGMA0);
  assert.equal(fog.fogSigma, 3.912 / 400);
  assert.ok(Math.abs(fog.fogTopM - 300 * 0.3048) < 1e-9);
  assert.ok(fog.fogMix > 0.8 && fog.lightCarry < 0.5 && fog.fogLights > 0.9);
});

test('the overcast: cover from the largest layer above, fading through it, none above the top', () => {
  const L = [{ okta: 3, baseFt: 1000, topFt: 2000 }, { okta: 8, baseFt: 3000, topFt: 7000 }];
  assert.equal(cloudCoverAt(L, 0), 1);
  assert.equal(cloudCoverAt(L, 5000 * 0.3048) > 0, true);
  assert.equal(cloudCoverAt(L, 8000 * 0.3048), 0);
  assert.equal(cloudCoverAt(null, 0), 0);
});

test('inside a layer the visibility is tens of metres; outside none', () => {
  const L = [{ okta: 8, baseFt: 1000, topFt: 5000 }];
  assert.equal(cloudAtCamera(L, 100), null);
  const c = cloudAtCamera(L, 3000 * 0.3048);
  assert.ok(c.sigma > 3.912 / 100);
  assert.equal(cloudAtCamera(L, 6000 * 0.3048), null);
  assert.equal(cloudAtCamera([], 100), null);
});

test('lightingAt: a cover of 0 is the same as none given, and cover lowers the sun and greys the sky', () => {
  const a = lightingAt(35), b = lightingAt(35, -90, 0, 0);
  assert.deepEqual(a, b);
  const o = lightingAt(35, -90, 0, 1);
  assert.ok(o.sunColor[0] < a.sunColor[0] * 0.2);
  assert.ok(o.skyAmb[1] < a.skyAmb[1]);
  // The ambient goes grey: the blue-green gap narrows.
  assert.ok(Math.abs(o.skyAmb[2] - o.skyAmb[0]) < Math.abs(a.skyAmb[2] - a.skyAmb[0]));
  assert.ok(o.stars <= a.stars);
});

test('ground state follows the runway state; cleared runways leave the land white', () => {
  assert.deepEqual(groundState(null), { wet: 0, snow: 0, rwySnow: 0 });
  const snow = groundState({ precip: { kind: 'snow', rate: 1 }, tempC: -5, runway: 'auto' });
  assert.equal(snow.rwySnow, 1);
  assert.ok(snow.snow > 0.9);
  const cleared = groundState({ precip: { kind: 'snow', rate: 1 }, tempC: -5, runway: 'dry' });
  assert.equal(cleared.rwySnow, 0);
  assert.ok(cleared.snow > 0.9);
  const rain = groundState({ precip: { kind: 'rain', rate: 0.5 }, tempC: 10, runway: 'auto' });
  assert.ok(rain.wet > 0.5 && rain.snow === 0);
});

// The wet runway's reflected lights (airports.js, in the runway shader, no extra draw call).
test('the wet-runway reflections are skipped when dry, by day and on snow, and cost no extra draw', () => {
  const src = readFileSync(new URL('../src/world/airports.js', import.meta.url), 'utf8');
  const main = src.slice(src.indexOf('const RUNWAY_FRAG'), src.indexOf('function runwayGeometry'));
  const wetAt = main.indexOf('if (uWet > 0.0 && uRwySnow <= 0.0) {');
  const nightAt = main.indexOf('if (uNight > 0.0) {', wetAt);
  const useAt = main.indexOf('wetRow(vRw', wetAt);
  assert.ok(wetAt > 0 && nightAt > wetAt && useAt > nightAt, 'wetRow is only reached inside the wet and the night tests');
  assert.equal(main.indexOf('wetRow(vRw'), useAt, 'no call of it outside those tests');
  // The sum is scaled by both, so it fades in with the night and the rain.
  assert.match(main, /c \+= refl \* [^;]*\* uWet \* uNight;/);
  // The material list stays one mesh per runway: nothing new is added to the scene for it.
  const build = src.slice(src.indexOf('export function createRunways'));
  assert.equal((build.match(/new THREE\.Mesh\(/g) || []).length, 1);
  assert.equal((build.match(/new THREE\.Points\(/g) || []).length, 1);
});

test('the reflected rows sit where lightLayout puts the lights', async () => {
  const { lightLayout } = await import('../src/world/airports.js');
  const { createAirports, pavementEnd } = await import('../src/world/runways.js');
  const raw = JSON.parse(readFileSync(new URL('../data/airports/RKPC.json', import.meta.url), 'utf8'));
  const { airports } = createAirports([raw]);
  const a = airports[0], r = a.runways.find((q) => q.id === '07/25');
  const p0 = pavementEnd(r.ends[0]), p1 = pavementEnd(r.ends[1]);
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y), ux = (p1.x - p0.x) / len, uy = (p1.y - p0.y) / len;
  const L = lightLayout({ ...a, runways: [{ ...r, cutBy: [] }] }, null);
  const uv = (l) => ({ u: (l.x - p0.x) * ux + (l.y - p0.y) * uy, v: -(l.x - p0.x) * uy + (l.y - p0.y) * ux });
  const hw = r.widthM / 2, nEdge = Math.max(Math.floor(len / 60 + 0.5), 1), spE = len / nEdge;
  const edges = L.filter((l) => l.kind === 0 && Math.abs(Math.abs(uv(l).v) - (hw + 1.5)) < 0.01);
  assert.equal(edges.length, 2 * (nEdge + 1));
  for (const l of edges) { const k = uv(l).u / spE; assert.ok(Math.abs(k - Math.round(k)) < 1e-6); }
  const cl = L.filter((l) => l.kind === 1 && Math.abs(uv(l).v - 0.6) < 0.01);
  const last = (Math.floor(len / 15) - 1) * 15;
  assert.equal(cl.length, Math.floor(len / 15) - 1);
  assert.ok(Math.abs(Math.min(...cl.map((l) => uv(l).u)) - 15) < 1e-6);
  assert.ok(Math.abs(Math.max(...cl.map((l) => uv(l).u)) - last) < 1e-6);
});
