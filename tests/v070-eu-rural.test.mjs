// v0.7.0 Part 6: Europe's villages in rural.js (codes 3 to 7, cities.js's groups), from a process opened in Europe
// (tests/region-run.mjs runs that part in one from the default suite); East Asia's codes and shader, from the default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { inRegion, REGION_ID } from './region-run.mjs';

const chunks = { UNIFORMS_GLSL: '/*U*/', NOISE_GLSL: '/*N*/', HEIGHT_GLSL: '/*H*/', ATMOS_GLSL: '/*A*/', MAX_RUNWAYS: 8 };
async function build(extra = {}) {
  const THREE = await import('../vendor/three.module.js');
  const { createRural } = await import('../src/world/rural.js');
  const r = createRural(new THREE.Scene(), { uNat: { value: { x: 0, y: 0, z: 250 } }, ...extra }, chunks);
  return { r, vert: r.mesh.material.vertexShader, frag: r.mesh.material.fragmentShader };
}
// The declarations a shader text makes (uniforms, attributes, varyings): Europe's splices add none.
const decls = (src) => src.split('\n').map((l) => l.trim()).filter((l) => /^(uniform|attribute|varying)\b/.test(l)).join('\n');

if (inRegion('europe', import.meta.url)) {
  const { ruralStyleOf, euRuralVert } = await import('../src/world/rural.js');

  test("Europe's countries take Europe's villages: Britain 3, France 4, the centre 5, the south 6, the Low Countries 7", () => {
    for (const c of ['GB', 'IE', 'GI']) assert.equal(ruralStyleOf(c), 3, c);
    for (const c of ['FR', 'MC']) assert.equal(ruralStyleOf(c), 4, c);
    for (const c of ['DE', 'AT', 'CH', 'LU', 'LI', 'PL', 'CZ']) assert.equal(ruralStyleOf(c), 5, c);
    for (const c of ['ES', 'PT', 'IT', 'AD']) assert.equal(ruralStyleOf(c), 6, c);
    for (const c of ['NL', 'BE', 'DK']) assert.equal(ruralStyleOf(c), 7, c);
    assert.equal(ruralStyleOf('other'), 5);                       // unnamed land and any code not listed: the centre's
    assert.equal(ruralStyleOf('XX'), 5);
  });

  test("a village takes the same group as the town beside it (cities.js's mix code), for every listed country", async () => {
    const { cityMixOf } = await import('../src/world/cities.js');
    for (const c of ['GB', 'IE', 'GI', 'FR', 'MC', 'DE', 'AT', 'CH', 'LU', 'LI', 'PL', 'CZ', 'SK', 'HU', 'SI', 'SE', 'NO',
      'ES', 'PT', 'IT', 'AD', 'HR', 'BA', 'ME', 'RS', 'AL', 'MA', 'NL', 'BE', 'DK', 'other', 'XX']) {
      assert.equal(ruralStyleOf(c), cityMixOf(c).code, c);
    }
  });

  const CJ = new URL('../data/europe/country.json', import.meta.url);
  test("every country in Europe's raster takes a European village (3 to 7), as its towns do", { skip: !existsSync(CJ) }, async () => {
    const { cityMixOf } = await import('../src/world/cities.js');
    const codes = JSON.parse(readFileSync(CJ, 'utf8')).codes.filter((c) => c !== 'sea');
    assert.ok(codes.length > 20);
    for (const c of codes) { const s = ruralStyleOf(c); assert.ok(s >= 3 && s <= 7, c); assert.equal(s, cityMixOf(c).code, c); }
  });

  test("Europe's vertex shader is East Asia's with the three splices, and declares nothing new", async () => {
    const { vert } = await build();
    assert.equal(vert.split('if (uCountry >= 3').length - 1, 2);   // the sizes, the look
    assert.equal(vert.split('v0.7.0 Europe').length - 1, 3);       // the church, the sizes, the look
    const i = vert.indexOf('is this cell a village church'), j = vert.indexOf("v0.7.0 Europe's village houses"), k = vert.indexOf("v0.7.0 Europe's walls");
    assert.ok(i > 0 && i < vert.indexOf('float pw, zone;'));
    assert.ok(j > 0 && j < vert.indexOf('size *= keep; rise *= keep;'));
    assert.ok(k > 0 && k < vert.indexOf('vWall = wall; vRoof = roof;'));
    assert.ok(vert.indexOf('vLocal = vec3(') < k);                  // the church's plain walls overwrite vLocal after it is set
    assert.ok(decls(vert).endsWith([                                 // rural's own, last, as they were (FINE_GLSL's before them)
      'uniform ivec2 uRCell;', 'uniform int uCountry;', 'uniform float uGlassOn;', 'attribute vec2 cell;', 'attribute float part;',
      'varying vec3 vRel, vN, vWall, vRoof, vLocal;', 'varying float vPart, vSeed, vShed;',
    ].join('\n')));
    assert.equal(decls(vert.slice(vert.indexOf('void main()'))), '');   // nothing declared inside main
    assert.ok(!/\beu[A-Z]\w*/.test(decls(vert)));
    assert.ok(!/#extension/.test(vert));
    assert.throws(() => euRuralVert('void main() {}'));            // a missing anchor is an error, not a silent no-op
  });

  test("no village building over three storeys: the houses' walls at most 8.4 m (the church's tower apart)", async () => {
    const { vert } = await build();
    const sizes = vert.slice(vert.indexOf("v0.7.0 Europe's village houses"), vert.indexOf('if (euNave)'));
    for (const m of sizes.matchAll(/euSto = ([^;]+);/g)) {
      // each storey count is a base plus or minus steps (0 or 1): its largest value
      const e = m[1]; const base = Number(/^([\d.]+)/.exec(e)[1]); const ups = (e.match(/\+ step/g) || []).length;
      assert.ok(base + ups <= 3, e);
    }
    assert.ok(sizes.includes('size = vec3(euFp.x, 2.8 * euSto, euFp.y);'));
  });

  test('a cell draws one house as before: the same 14 triangles and the camera country the default group (France 4)', async () => {
    const { r } = await build({ uFineOn: { value: 1 } });
    const out = r.update({ x: 0, y: 0 }, { x: 0, y: 0 }, 300);
    assert.equal(r.mesh.material.uniforms.uCountry.value, 4);       // no geo rules loaded: the region's default country, FR
    assert.equal(r.mesh.geometry.getAttribute('position').count / 3, 14);
    assert.equal(out.tris, 14 * r.mesh.geometry.instanceCount);
  });
}

if (REGION_ID !== 'europe') {
  test("East Asia's countries take the villages they took: Korea, North Korea, Russia and other 0, Japan 1, China 2", async () => {
    const { ruralStyleOf } = await import('../src/world/rural.js');
    for (const [c, code] of [['KR', 0], ['KP', 0], ['RU', 0], ['other', 0], ['JP', 1], ['CN', 2], ['FR', 0], ['GB', 0], ['XX', 0]]) {
      assert.equal(ruralStyleOf(c), code, c);
    }
  });

  test("East Asia's vertex shader has none of Europe's splices; its anchors are each there once", async () => {
    const { vert, frag } = await build();
    assert.ok(!vert.includes('uCountry >= 3'));
    assert.ok(!vert.includes('v0.7.0 Europe'));
    assert.ok(!/\beu[A-Z]\w*/.test(vert));
    assert.ok(!frag.includes('v0.7.0 Europe'));
    for (const a of ['        float pw, zone;', '        size *= keep; rise *= keep;', '        vWall = wall; vRoof = roof;']) assert.equal(vert.split(a).length - 1, 1, a);
  });

  test('East Asia: the camera country sets uCountry as before (no geo rules: Korea, 0)', async () => {
    const { r } = await build({ uFineOn: { value: 1 } });
    r.update({ x: 0, y: 0 }, { x: 0, y: 0 }, 300);
    assert.equal(r.mesh.material.uniforms.uCountry.value, 0);
  });
}
