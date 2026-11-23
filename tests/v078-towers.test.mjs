// v0.7.8 part 4, the towers (briefs/V0-7-8.md; src/world/cities.js's towers78Vert(), behind ?towers78 / FS_TOWERS78, on by
// default): the generator's buildings low (two or three storeys) within about 500 m of an airfield's boundary and under
// each runway's first 4 km of final. Switched off, the town's shader text is the pushed v0.7.7's character for character
// in both regions (SHA-256, first 16 hex digits, of the texts the frozen v0.7.7 tree builds with the stub chunks of
// tests/v078-trees-hash.mjs); the trees' and the terrain's are untouched by this switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const V077 = {
  ea: { terrain: ['7aecf5da04d4e136', 'f67e6fb5cfeef5a3'], trees: ['1b686c0487a7b141', '4631cc3bb15879eb'], cities: ['0644da103f22d9c4', 'e68d342c5b94412d'] },
  europe: { terrain: ['5c0430ae156011fb', 'e26cc34f3563060e'], trees: ['72987866a2a44dac', '4631cc3bb15879eb'], cities: ['bcf3cc3defffa619', 'e68d342c5b94412d'] },
};
const HELPER = fileURLToPath(new URL('./v078-trees-hash.mjs', import.meta.url));
function hashes(region, env) {
  const r = spawnSync(process.execPath, [HELPER], { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, FS_REGION: region === 'ea' ? '' : region, FS_FENS78: '0', FS_SNOW78: '0', ...env } });
  const m = /HASH78 (.*)/.exec(r.stdout + r.stderr);
  assert.ok(m, r.stdout + r.stderr);
  return JSON.parse(m[1]);
}

for (const region of ['ea', 'europe']) {
  test(`v0.7.8 towers: switched off, ${region}'s town shader is v0.7.7's text`, () => {
    const h = hashes(region, { FS_TOWERS78: '0', FS_TREES78: '1' });
    assert.deepEqual(h.cities, [...V077[region].cities, []]);
  });
  test(`v0.7.8 towers: switched on, ${region}'s town shader takes the airports' rule; trees and terrain untouched by it`, () => {
    const h = hashes(region, { FS_TOWERS78: '1', FS_TREES78: '0' });
    assert.notEqual(h.cities[0], V077[region].cities[0]);
    assert.equal(h.cities[1], V077[region].cities[1], 'the fragment shader is the same');
    assert.deepEqual(h.terrain.slice(0, 2), V077[region].terrain);
    for (const t of h.trees) assert.deepEqual(t.slice(0, 2), V077[region].trees);
  });
}

test('v0.7.8 towers: towers78Vert() splices each anchor once, with the [EST] numbers, or throws', async () => {
  const C = await import('../src/world/cities.js');
  assert.throws(() => C.towers78Vert('void main() {}'));
  const src = 'float keep = step(sh3 * 0.4 + 0.18, cov.b + 0.0);\nif (abs(uu) < uRwyB[r].x + 400.0 && abs(vv) < uRwyB[r].y + 260.0) keep = 0.0;\nvec3 s3 = size * vec3(1.0, grow, 1.0) * keep;';
  const s = C.towers78Vert(src);
  assert.deepEqual([C.TOWERS78_MARGIN, C.TOWERS78_FINAL, C.TOWERS78_HALF, C.TOWERS78_SPLAY], [500, 4000, 150, 0.15]);
  for (const k of ['float low78 = 0.0, near78 = 0.0;', 'al78 < 4000.00 && abs(vv) < uRwyB[r].y + 150.00 + 0.15 * max(al78, 0.0)', 'natUv(m + vec2(500.00, 0.0))',
    'if (low78 > 0.5) size.y = min(size.y, (2.0 + floor(2.0 * sh3)) * 3.0);']) assert.ok(s.includes(k), k);
  assert.ok(s.indexOf('size.y = min(size.y') < s.indexOf('vec3 s3 = size'), 'the cap before the size is used');
  assert.throws(() => C.towers78Vert(s + src), 'an anchor twice');
});

// The rule on the CPU, as the shader has it, at Itami's 32L (the runway's centre, direction and half sizes from its file):
// a building 1 km out on the centreline is low; one 1 km out and 1 km to the side is not (unless the airfield's mark
// is near); 4.5 km out on the centreline is not.
test('v0.7.8 towers: the final corridor\'s shape', () => {
  const half = 1525, halfW = 30;   // [m] Itami's 14R/32L: 3,050 m by 60 m
  const low = (u, v) => { const al = Math.abs(u) - half; return al < 4000 && Math.abs(v) < halfW + 150 + 0.15 * Math.max(al, 0); };
  assert.ok(low(half + 1000, 0));
  assert.ok(low(half + 1000, 300), '300 m off the line 1 km out: inside 330 m');
  assert.ok(!low(half + 1000, 1000));
  assert.ok(low(half + 3300, 250), 'Kunsan\'s cluster: 3.3 km out, 250 m off the line');
  assert.ok(low(half + 3900, 750), 'at 3.9 km out the corridor is 765 m each side');
  assert.ok(!low(half + 4500, 0));
});
