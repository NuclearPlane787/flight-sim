// v0.7.9 part 8, item 1 (briefs/V0-7-9.md; src/world/parks78.js trees79Arrays(), behind ?trees79 / FS_TREES79, on by
// default): a park's broadleaf tree gets a round crown. Switched off, every tree level's shader text, uniforms' names and
// geometry (every attribute's values) are the pushed v0.7.8's by SHA-256 in both regions (the hashes taken from the
// frozen v0.7.8 with tests/v079-looks-hash.mjs's stub chunks, first 16 hex digits). Switched on, only the vertex shader
// and the geometry change, and the forest's cone is the same 12 triangles plus 6 of zero area.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { trees79Arrays, CROWN79 } from '../src/world/parks78.js';

const HELPER = fileURLToPath(new URL('./v079-looks-hash.mjs', import.meta.url));
const V078 = { ea: ['9a74f4f2e0b9933d', '4631cc3bb15879eb', '13938714913cd271', 'bbfcb2f9c686edfe'],
  europe: ['66af60c299cc476e', '4631cc3bb15879eb', '13938714913cd271', 'bbfcb2f9c686edfe'] };
function hashes(region, env) {
  const r = spawnSync(process.execPath, [HELPER, '', 'trees'], { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, FS_REGION: region === 'ea' ? '' : region, ...env } });
  const m = /HASH79 (\{.*\})/.exec(r.stdout + r.stderr);
  assert.ok(m, r.stdout + r.stderr);
  return JSON.parse(m[1]);
}
for (const region of ['ea', 'europe']) {
  test(`v0.7.9 looks, trees: switched off, ${region}'s trees are v0.7.8's by SHA-256 (text, uniforms, geometry)`, () => {
    const h = hashes(region, { FS_TREES79: '0' });
    assert.equal(h.trees.length, 5);
    for (const lv of h.trees) assert.deepEqual(lv, V078[region]);
  });
  test(`v0.7.9 looks, trees: switched on, ${region}'s vertex shader and geometry change, the rest is v0.7.8's`, () => {
    const h = hashes(region, { FS_TREES79: '1' });
    for (const lv of h.trees) {
      assert.notEqual(lv[0], V078[region][0]);
      assert.deepEqual([lv[1], lv[2]], [V078[region][1], V078[region][2]]);
      assert.notEqual(lv[3], V078[region][3]);
    }
  });
}
test('v0.7.9 looks, trees: with ?trees78 off there are no park trees, so trees79 changes nothing', () => {
  const a = hashes('ea', { FS_TREES78: '0', FS_TREES79: '1' }), b = hashes('ea', { FS_TREES78: '0', FS_TREES79: '0' });
  assert.deepEqual(a, b);
});

// The forest's cone as detail.js's treeGeometry() builds it (two 6-sided tiers).
function cone() {
  const pos = [];
  const c = (y0, y1, r) => { for (let i = 0; i < 6; i++) { const a0 = i / 6 * Math.PI * 2, a1 = (i + 1) / 6 * Math.PI * 2; pos.push(Math.cos(a1) * r, y0, Math.sin(a1) * r, Math.cos(a0) * r, y0, Math.sin(a0) * r, 0, y1, 0); } };
  c(0.25, 1.0, 0.36); c(0.55, 1.12, 0.26);
  return new Float32Array(pos);
}
const tri = (a, t) => [0, 1, 2].map((q) => [a[t * 9 + q * 3], a[t * 9 + q * 3 + 1], a[t * 9 + q * 3 + 2]]);
const cross = (v) => { const e1 = v[1].map((x, i) => x - v[0][i]), e2 = v[2].map((x, i) => x - v[0][i]); return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; };
test('v0.7.9 looks, trees: the crown is 18 outward triangles, 1.5 times the cone\'s 12; the cone kept, 6 more of zero area', () => {
  const p = cone(), n = new Float32Array(36 * 3).fill(0.5), k = new Float32Array(36).fill(1);
  const r = trees79Arrays(p, n, k);
  assert.equal(r.pos.length / 9, 18);
  assert.equal(r.p79.length / 9, 18);
  assert.deepEqual(Array.from(r.pos.slice(0, 108)), Array.from(p));
  assert.deepEqual(Array.from(r.nrm.slice(0, 108)), Array.from(n));
  for (let t = 12; t < 18; t++) assert.ok(Math.hypot(...cross(tri(r.pos, t))) === 0, `extra triangle ${t} has area`);
  let ymin = Infinity, ymax = -Infinity;
  for (let t = 0; t < 18; t++) {
    const v = tri(r.p79, t), c = [0, 1, 2].map((i) => (v[0][i] + v[1][i] + v[2][i]) / 3);
    c[1] -= CROWN79.cy;
    const cr = cross(v);
    assert.ok(cr[0] * c[0] + cr[1] * c[1] + cr[2] * c[2] > 0, `crown triangle ${t} faces inwards`);
    for (const q of v) { ymin = Math.min(ymin, q[1]); ymax = Math.max(ymax, q[1]); }
  }
  // the shader sinks the tree by 0.3 of its height: the crown stands clear of the lawn and no higher than v0.7.8's mound
  assert.ok(ymin - 0.3 > 0.02 && ymin - 0.3 < 0.12, `crown base ${ymin - 0.3}`);
  assert.ok(ymax - 0.3 <= 0.60, `crown top ${ymax - 0.3}`);
  for (let v = 0; v < 54; v++) assert.ok(Math.abs(Math.hypot(r.n79[v * 3], r.n79[v * 3 + 1], r.n79[v * 3 + 2]) - 1) < 1e-5);
  assert.throws(() => trees79Arrays(new Float32Array(9), new Float32Array(9), new Float32Array(3)), /not 12/);
});
