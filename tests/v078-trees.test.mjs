// v0.7.8 part 4, the trees (briefs/V0-7-8.md; src/world/parks78.js, behind ?trees78 / FS_TREES78, on by default): no
// tree on a real centre's building or a landmark, and the centres' parks drawn as parkland. Switched off, the trees' and
// the terrain's shader texts are the pushed v0.7.7's character for character in both regions (SHA-256, first 16 hex
// digits, of the texts the frozen v0.7.7 tree builds with tests/v078-trees-hash.mjs's stub chunks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const V077 = {
  ea: { terrain: ['7aecf5da04d4e136', 'f67e6fb5cfeef5a3'], trees: ['1b686c0487a7b141', '4631cc3bb15879eb'], cities: ['0644da103f22d9c4', 'e68d342c5b94412d'] },
  europe: { terrain: ['5c0430ae156011fb', 'e26cc34f3563060e'], trees: ['72987866a2a44dac', '4631cc3bb15879eb'], cities: ['bcf3cc3defffa619', 'e68d342c5b94412d'] },
};
const HELPER = fileURLToPath(new URL('./v078-trees-hash.mjs', import.meta.url));
export function hashes(region, env) {
  const r = spawnSync(process.execPath, [HELPER], { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, FS_REGION: region === 'ea' ? '' : region, FS_FENS78: '0', FS_SNOW78: '0', FS_TOWNS79: '0' /* v0.7.9: the far towns off too */, ...env } });
  const m = /HASH78 (.*)/.exec(r.stdout + r.stderr);
  assert.ok(m, r.stdout + r.stderr);
  return JSON.parse(m[1]);
}

for (const region of ['ea', 'europe']) {
  test(`v0.7.8 trees: switched off, ${region}'s trees and terrain shaders are v0.7.7's text, with no new uniform`, () => {
    const h = hashes(region, { FS_TREES78: '0' });
    assert.deepEqual(h.terrain.slice(0, 2), V077[region].terrain);
    assert.deepEqual(h.terrain[2], []);
    assert.equal(h.trees.length, 5);
    for (const t of h.trees) { assert.deepEqual(t.slice(0, 2), V077[region].trees); assert.deepEqual(t[2], []); }
  });
  test(`v0.7.8 trees: switched on, ${region}'s trees and terrain take the mask; the town's shader is untouched by it`, () => {
    const on = hashes(region, { FS_TREES78: '1', FS_TOWERS78: '0' });
    assert.notEqual(on.terrain[1], V077[region].terrain[1]);
    assert.equal(on.terrain[0], V077[region].terrain[0], 'the vertex shader is the same');
    assert.deepEqual(on.terrain[2], ['uPark78', 'uPark78Box', 'uLmk78', 'uLmk78N']);
    for (const t of on.trees) { assert.notEqual(t[0], V077[region].trees[0]); assert.equal(t[1], V077[region].trees[1]); assert.deepEqual(t[2], ['uPark78', 'uPark78Box', 'uLmk78', 'uLmk78N']); }
    assert.deepEqual(on.cities.slice(0, 2), V077[region].cities);
  });
}

test('v0.7.8 trees: the splices find each anchor once, or throw', async () => {
  const P = await import('../src/world/parks78.js');
  assert.throws(() => P.trees78Vert('void main() {}'));
  assert.throws(() => P.ground78Frag('void main() {}'));
  // (v0.7.9 looks: the source gains detail.js's 'vNormal = normal;', the anchor of ?trees79's splice; with ?trees79 on,
  // its round crown's line stands where v0.7.8's mound line stood: tests/v079-looks-trees.test.mjs.)
  const src = 'attribute vec2 cell;\nfloat keep = 1.0 * step(zone, 0.001) * step(cov.b, 0.5);\nvec3 p = position * vec3(sc * w, sc, sc * w);\nvNormal = normal;\nvCol = mix(vCol, vec3(0.040, 0.056, 0.025), (1.0 - thin) * 0.6);\n';
  const s = P.trees78Vert(src);
  for (const k of ['uniform sampler2D uPark78;', 'park78Built(m, pk78t)', P.TREES79 ? 'p = p79 * vec3(sc * w, sc, sc * w)' : 'p *= vec3(1.25, 0.62, 1.25)', 'mix(1.0, 0.16, pk78)']) assert.ok(s.includes(k), k);
  assert.throws(() => P.trees78Vert(s + src), 'an anchor twice');
});

// A box 1 km square, origin at its south-west corner: rings in 0.5 m units.
function centreOf(rings) {
  const nVerts = new Uint8Array(rings.length), vstart = new Uint32Array(rings.length + 1);
  const xy = [];
  rings.forEach((r, i) => { vstart[i] = xy.length / 2; nVerts[i] = r.length; for (const [x, y] of r) xy.push(x * 2, y * 2); });
  vstart[rings.length] = xy.length / 2;
  return { count: rings.length, nVerts, vstart, xy: new Int16Array(xy) };
}
const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

test('v0.7.8 trees: raster78() marks the footprints grown by a pixel, and the parkland round the town\'s fabric only', async () => {
  const { raster78, PARK_FAR_M } = await import('../src/world/parks78.js');
  // a town block of 40 m buildings on 60 m centres in the south-west 300 m, one lone 20 m building far to the north-east
  const rings = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) rings.push(sq(10 + i * 60, 10 + j * 60, 40));
  rings.push(sq(900, 900, 20));
  const info = { origin: [1000, 2000], box: [1000, 2000, 2000, 3000] };
  const r = raster78(centreOf(rings), info);
  assert.equal(r.px, 10); assert.equal(r.w, 100); assert.equal(r.h, 100);
  const R = (x, y) => r.data[(Math.floor(y / 10) * r.w + Math.floor(x / 10)) * 2], Gv = (x, y) => r.data[(Math.floor(y / 10) * r.w + Math.floor(x / 10)) * 2 + 1];
  assert.equal(R(30, 30), 255, 'inside a footprint');
  assert.equal(R(55, 30), 255, 'one pixel out of it (the crown\'s margin)');
  assert.equal(R(65, 30), 255, 'a 20 m street between two walls: both its pixels within a pixel of a wall');
  assert.equal(R(315, 30), 0, 'two pixels past the last wall');
  assert.equal(R(910, 910), 255, 'the lone building');
  assert.equal(Gv(150, 150), 255, 'in the town: parkland');
  assert.equal(Gv(500, 150), 255, 'within 250 m of it');
  assert.ok(Gv(150 + 300 + PARK_FAR_M, 150) === 0 || 150 + 300 + PARK_FAR_M > 1000);
  assert.equal(Gv(850, 850), 0, 'a lone building in a wood is not the town: forest stays');
  assert.equal(Gv(950, 150), 0, 'far from the town');
});

test('v0.7.8 trees: update78() binds the nearest ready centre within reach and lists the nearest landmarks', async () => {
  const P = await import('../src/world/parks78.js');
  const U = P.PARK78_UNIFORMS, a = { tag: 'a' }, b = { tag: 'b' };
  P.addMask78('a', [0, 0, 1000, 1000], a);
  P.addMask78('b', [50000, 0, 51000, 1000], b);
  assert.equal(P.update78({ x: 500, y: 500 }).tex, a);
  assert.equal(U.uPark78.value, a);
  assert.deepEqual([...U.uPark78Box.value], [0, 0, Math.fround(1 / 1000), Math.fround(1 / 1000)]);
  assert.equal(P.update78({ x: 45000, y: 500 }).tex, b);
  assert.equal(P.update78({ x: 25500, y: 500 }), null, 'neither within 20 km');
  assert.equal(U.uPark78.value, null); assert.equal(U.uPark78Box.value[2], 0);
  P.update78({ x: 500, y: 500 });
  P.dropMask78('a');
  assert.equal(U.uPark78.value, null, 'dropped while bound');
  P.dropMask78('b');
  P.setLandmarks78(Array.from({ length: 12 }, (_, k) => ({ x: k * 100, y: 0, r: 20 })).concat([{ x: 90000, y: 0, r: 20 }]));
  P.update78({ x: 0, y: 0 });
  assert.equal(U.uLmk78N.value, 8);
  assert.deepEqual([...U.uLmk78.value.slice(0, 4)], [0, 0, 28, 0]);
  P.setLandmarks78([]); P.update78({ x: 0, y: 0 });
  assert.equal(U.uLmk78N.value, 0);
});
