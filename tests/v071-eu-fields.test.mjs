// v0.7.1: Europe's fields by country (src/world/ground.js's euGroundGlsl(): open fields, hedged fields, dry fields with
// olive groves, polders). East Asia's text must not change by a character: its SHA-256 is pinned here (the pushed
// v0.7.0's GROUND_GLSL, the same string v0.6.4 shipped but for the region's lattice). The Europe checks run in a page
// opened in Europe (tests/region-run.mjs); directly: FS_REGION=europe node --test tests/v071-eu-fields.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inRegion } from './region-run.mjs';
import { REGION } from '../src/world/regions.js';

if (REGION.id !== 'europe') {
  test("East Asia's ground shader is the pushed v0.7.0's, character for character, with nothing of Europe's in it", async () => {
    const { GROUND_GLSL } = await import('../src/world/ground.js');
    assert.equal(createHash('sha256').update(GROUND_GLSL).digest('hex'), '273746897a1f7df8b814dfd0842fa7baa1490c9f4c82f297c74894d50ba5f541');
    assert.ok(!/euZone|euField|\beu\b/.test(GROUND_GLSL));
  });
}
if (inRegion('europe', import.meta.url)) {
  const { GROUND_GLSL, euGroundGlsl, euFieldAverage, euConic } = await import('../src/world/ground.js');
  const { toMap, LON0 } = await import('../src/world/frame.js');
  test("Europe's splice: every anchor found once, the four kinds in, East Asia's lines all still there", () => {
    const s = euGroundGlsl(GROUND_GLSL);
    for (const k of ['void euZone(vec2 mp, out float hedge, out float dry)', 'vec3 euField(int kind, float t, out float green)', 'paddy = 0.0;', 'int eu = 0;', 'if (eu == 3) ang =', 'if (eu != 2) terr = 0.0;', 'euOl = 1.0;', 'treeLine = max(treeLine, euHg']) assert.ok(s.includes(k), k);
    // nothing of East Asia's removed but the one greenhouse condition, which is narrowed
    const gone = GROUND_GLSL.split('\n').filter((l) => l.trim() && !s.includes(l));
    assert.deepEqual(gone, ['  if (dg > 0.78 && hv > 0.62 && paddy <= 0.5) {']);
    assert.throws(() => euGroundGlsl(GROUND_GLSL.replace('float terr = step(0.07, slope);', '')), /anchor occurs 0 times/);
    assert.throws(() => euGroundGlsl(s), /anchor occurs/);                       // never spliced twice
    // GLSL ES 3.00 habits: every float literal in the added lines has a point or an exponent
    const added = s.split('\n').filter((l) => !GROUND_GLSL.includes(l)).join('\n');
    assert.ok(!/[^\w.]\d+(?![\w.])(?=\s*[*+\-/,)]\s*(?:eu[A-Z]|lat|lon|aa|lod)\b)/.test(added.replace(/\b(?:int|ivec2)\b[^;]*;/g, '').replace(/\d+u\b/g, '').replace(/eu == \d|eu != \d|>> \d|did \* \d+/g, '')), 'an integer literal in float arithmetic');
  });
  test("the shader's latitude and longitude from the map position: within 0.05 degrees at ten cities", () => {
    const K = euConic();
    for (const [n, la, lo] of [['Dublin', 53.35, -6.26], ['London', 51.5, -0.12], ['Caen', 49.18, -0.37], ['Paris', 48.85, 2.35], ['Berlin', 52.52, 13.4], ['Vienna', 48.21, 16.37],
      ['Toulouse', 43.6, 1.44], ['Madrid', 40.42, -3.7], ['Lisbon', 38.72, -9.14], ['Rome', 41.9, 12.5]]) {
      const [x, y] = toMap(la, lo), ax = x, ay = K.rho0 - y;
      const lat = 46 + (K.rhoA - Math.hypot(ax, ay)) * K.degPerM, lon = LON0 + Math.atan2(ax, ay) * K.lonK;
      assert.ok(Math.abs(lat - la) < 0.05 && Math.abs(lon - lo) < 0.05, `${n}: ${lat.toFixed(3)}, ${lon.toFixed(3)}`);
    }
  });
  test("each kind's far colour: the dry country the palest, the hedged and the polders the greenest", () => {
    const A = Object.fromEntries(['open', 'hedge', 'dry', 'polder'].map((k) => [k, euFieldAverage(k)]));
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    assert.ok(lum(A.dry) > lum(A.open) && lum(A.open) > lum(A.hedge));
    for (const k of ['hedge', 'polder']) assert.ok(A[k][1] > 1.2 * A[k][0], k);          // green
    assert.ok(A.dry[0] > A.dry[1]);                                                    // ochre
    for (const c of Object.values(A)) for (const v of c) assert.ok(v > 0.02 && v < 0.25);
  });
}
