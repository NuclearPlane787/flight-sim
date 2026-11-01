// City lights (src/world/citylights.js): the slot layout, the CPU's block selection (only
// built-up blocks, the same every run, the finer ring's hole) and the colour mix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotLayout, makeBlockTest, levelBlocks, lightColor, KIND, LIGHT_BLOCK, LIGHT_HALF } from '../src/world/citylights.js';

// A fake 250 m cover grid, 400 x 400 cells (100 km), map origin at its corner (-50 km, -50 km):
// built-up (B = 200) only in a 6 km square centred on (10 km, 5 km).
const NX = 400, CELL = 250, X0 = -50000, Y0 = -50000;
const cov = new Uint8Array(NX * NX * 4);
const urbanAt = (x, y) => Math.abs(x - 10000) < 3000 && Math.abs(y - 5000) < 3000;
for (let j = 0; j < NX; j++) for (let i = 0; i < NX; i++) {
  if (urbanAt(X0 + (i + 0.5) * CELL, Y0 + (j + 0.5) * CELL)) cov[(j * NX + i) * 4 + 2] = 200;
}
const nat = { x: X0, y: Y0, z: CELL }, size = { x: NX, y: NX };

test('the slot layout is fixed, in the block, with every kind', () => {
  const a = slotLayout(), b = slotLayout();
  assert.deepEqual(a, b);
  assert.equal(a.length, 116);
  for (const [x, y, k] of a) {
    assert.ok(x >= -0.5 && x <= 0.5 && y >= -0.5 && y <= 0.5, `slot ${x},${y}`);
    assert.ok(Object.values(KIND).includes(k));
  }
  for (const k of Object.values(KIND)) assert.ok(a.some((s) => s[2] === k), `kind ${k}`);
  // The inner paths miss cities.js's apartment rows (every 72 m from the centre, 15 m deep).
  for (const [x, y, k] of a) if (k === KIND.inner && Math.abs(Math.abs(x) - 0.156) > 0.01) {
    const ym = y * LIGHT_BLOCK, nearest = Math.round(ym / 72) * 72;
    assert.ok(Math.abs(ym - nearest) > 20, `path at ${ym} m hits a row`);
  }
});

test('blocks are listed only where the cover is built-up, the same every run', () => {
  const t1 = makeBlockTest(cov, nat, size), t2 = makeBlockTest(cov, nat, size);
  for (let lv = 0; lv < 3; lv++) {
    const B = LIGHT_BLOCK * 2 ** lv;
    // The camera in town for the fine rings, ~20 km off for ring 2 (whose middle ring 1 covers).
    const camX = lv < 2 ? 9000 : -12000, camY = lv < 2 ? 4000 : -10000;
    const a = levelBlocks(lv, camX, camY, t1, []), b = levelBlocks(lv, camX, camY, t2, []);
    assert.deepEqual(a, b);
    assert.ok(a.length > 0, `level ${lv} has blocks`);
    const cx = Math.floor(camX / B), cy = Math.floor(camY / B);
    for (let k = 0; k < a.length; k += 2) {
      const bx = cx + a[k], by = cy + a[k + 1];
      const mx = (bx + 0.5) * B, my = (by + 0.5) * B;
      // Within the urban square, plus the block's reach (0.72 B) and a cell.
      const reach = 0.72 * B + 2 * CELL;
      assert.ok(Math.abs(mx - 10000) < 3000 + reach && Math.abs(my - 5000) < 3000 + reach, `level ${lv} block ${bx},${by} off the city`);
    }
  }
  // Far from the city: nothing.
  assert.equal(levelBlocks(0, -40000, -40000, t1, []).length, 0);
});

test('a coarser ring leaves out the middle the finer ring covers', () => {
  const all = () => true;
  const l0 = levelBlocks(0, 0, 0, all, []), l1 = levelBlocks(1, 0, 0, all, []);
  assert.equal(l0.length / 2, (2 * LIGHT_HALF) ** 2);
  assert.ok(l1.length / 2 < (2 * LIGHT_HALF) ** 2);
  // No level-1 block lies wholly inside 0.6 x level 0's half-size, less a block.
  const B = LIGHT_BLOCK * 2;
  for (let k = 0; k < l1.length; k += 2) {
    const i = l1[k], j = l1[k + 1];
    const far = Math.hypot(Math.max(Math.abs(i * B), Math.abs((i + 1) * B)), Math.max(Math.abs(j * B), Math.abs((j + 1) * B)));
    assert.ok(far + B >= 0.6 * LIGHT_HALF * LIGHT_BLOCK);
  }
});

test('the colour mix: more LED where the district has them and in the densest cores', () => {
  const share = (led, dense) => {
    let n = 0;
    for (let i = 0; i < 1000; i++) if (lightColor(led, dense, (i + 0.5) / 1000) === 'led') n++;
    return n / 1000;
  };
  assert.equal(share(0, 0.4), 0);
  assert.ok(Math.abs(share(0.3, 0.5) - 0.3) < 0.01);
  assert.ok(share(0.3, 0.95) > 0.5);
  assert.equal(share(1, 0.2), 1);
});
