// v0.7.0 Part 6: Europe's town mixes in cities.js (codes 3 to 7, 20 slots a block), from a process opened in Europe
// (tests/region-run.mjs runs that part in one from the default suite); East Asia's codes and shader, from the default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { inRegion, REGION_ID } from './region-run.mjs';

const chunks = { UNIFORMS_GLSL: '/*U*/', NOISE_GLSL: '/*N*/', HEIGHT_GLSL: '/*H*/', ATMOS_GLSL: '/*A*/', MAX_RUNWAYS: 8 };
async function build() {
  const THREE = await import('../vendor/three.module.js');
  const { createCities } = await import('../src/world/cities.js');
  const c = createCities(new THREE.Scene(), { uNat: { value: { x: 0, y: 0, z: 250 } } }, chunks);
  return { c, vert: c.mesh.children[0].material.vertexShader, frag: c.mesh.children[0].material.fragmentShader };
}

if (inRegion('europe', import.meta.url)) {
  const { cityMixOf, euVert } = await import('../src/world/cities.js');

  test("Europe's countries take Europe's mixes: Britain 3, France 4, the centre 5, the south 6, the Low Countries 7", () => {
    for (const c of ['GB', 'IE', 'GI']) assert.equal(cityMixOf(c).code, 3, c);
    for (const c of ['FR', 'MC']) assert.equal(cityMixOf(c).code, 4, c);
    for (const c of ['DE', 'AT', 'CH', 'LU', 'LI', 'PL', 'CZ']) assert.equal(cityMixOf(c).code, 5, c);
    for (const c of ['ES', 'PT', 'IT', 'AD']) assert.equal(cityMixOf(c).code, 6, c);
    for (const c of ['NL', 'BE', 'DK']) assert.equal(cityMixOf(c).code, 7, c);
    assert.equal(cityMixOf('other').code, 5);                     // unnamed land and any code not listed: the centre's
    assert.equal(cityMixOf('XX').code, 5);
    for (const c of ['GB', 'FR', 'DE', 'ES', 'NL', 'other']) assert.equal(cityMixOf(c).slots, 20, c);   // Japan's are 30
  });

  const CJ = new URL('../data/europe/country.json', import.meta.url);
  test("every country in Europe's raster takes a European mix (3 to 7), none East Asia's", { skip: !existsSync(CJ) }, () => {
    const codes = JSON.parse(readFileSync(CJ, 'utf8')).codes.filter((c) => c !== 'sea');
    assert.ok(codes.length > 20);
    for (const c of codes) { const m = cityMixOf(c); assert.ok(m.code >= 3 && m.code <= 7, c); assert.equal(m.slots, 20, c); }
  });

  test("Europe's vertex shader is East Asia's with the three splices", async () => {
    const { vert } = await build();
    assert.ok(vert.includes('if (ctry >= 3) {'));
    assert.equal(vert.split('if (ctry >= 3) {').length - 1, 3);    // the geometry, the walls, the roofs
    assert.ok(vert.includes('} else if (ctry == 1) {'));
    assert.ok(vert.indexOf('v0.7.0 Europe\'s walls') < vert.indexOf('vTint = tint;'));
    assert.ok(vert.indexOf('vSeg = seg;') < vert.indexOf('v0.7.0 Europe\'s roofs'));
    assert.throws(() => euVert('void main() {}'));                  // a missing anchor is an error, not a silent no-op
  });

  test('a block draws at most 20 instances (200 triangles; Japan 30, 300)', async () => {
    const { c } = await build();
    const r = c.update({ x: 0, y: 0 }, { x: 0, y: 0 }, 300);
    assert.equal(r.blocks, 1600);
    assert.equal(r.instances, 1600 * 20);
    assert.equal(r.tris, r.instances * 10);
  });
}

if (REGION_ID !== 'europe') {
  test("East Asia's countries take the mixes they took: Korea, North Korea, Russia and other 0, Japan 1, China 2", async () => {
    const { cityMixOf } = await import('../src/world/cities.js');
    for (const [c, code, slots] of [['KR', 0, 15], ['KP', 0, 15], ['RU', 0, 15], ['other', 0, 15], ['JP', 1, 30], ['CN', 2, 20], ['FR', 0, 15]]) {
      assert.deepEqual(cityMixOf(c), { code, slots }, c);
    }
  });

  test("East Asia's vertex shader has none of Europe's splices", async () => {
    const { vert } = await build();
    assert.ok(!vert.includes('ctry >= 3'));
    assert.ok(!vert.includes('v0.7.0 Europe'));
    assert.ok(vert.includes('        if (ctry == 1) {'));
  });
}
