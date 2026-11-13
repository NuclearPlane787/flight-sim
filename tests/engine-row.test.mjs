// v0.5.0: src/ui/engine-row.js, where the engine screens put 3, 4 or 6 engines' dials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRow, engineCountOf } from '../src/ui/engine-row.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('every slot inside the row, in engine order, none overlapping the labels', () => {
  for (const n of [2, 3, 4, 6]) {
    const x0 = 2, x1 = 211, gap = 30;
    const { xs, w, labelX } = engineRow(n, { x0, x1, gap });
    assert.equal(xs.length, n);
    near(w * n + gap, x1 - x0, `n=${n} widths add up`);
    for (let i = 0; i < n; i++) {
      assert.ok(xs[i] - w / 2 >= x0 - 1e-9 && xs[i] + w / 2 <= x1 + 1e-9, `n=${n} slot ${i} inside`);
      if (i) { const d = xs[i] - xs[i - 1]; assert.ok(Math.abs(d - w) < 1e-9 || Math.abs(d - w - gap) < 1e-9, `n=${n} spacing ${i}`); }
      assert.ok(Math.abs(xs[i] - labelX) >= w / 2 + gap / 2 - 1e-9, `n=${n} slot ${i} clear of the labels`);
    }
  }
});

test('the labels sit between the wings\' engines with an even count, at the left with three', () => {
  const R = { x0: 0, x1: 100, gap: 10 };
  for (const n of [2, 4, 6]) {
    const { xs, labelX, gapAt } = engineRow(n, R);
    assert.equal(gapAt, n / 2);
    near(labelX, 50, `n=${n} labels centred`);
    assert.ok(xs[n / 2 - 1] < labelX && xs[n / 2] > labelX);
  }
  const t = engineRow(3, R);
  assert.equal(t.gapAt, 0);
  near(t.labelX, 5, 'three: labels at the left');
  assert.ok(t.xs.every((x) => x > t.labelX));
});

test('the count a screen draws: the state\'s list, else the type\'s, else two', () => {
  assert.equal(engineCountOf({ engines: [{}, {}, {}, {}] }, { engineCount: 2 }), 4);
  assert.equal(engineCountOf({ engines: [] }, { engineCount: 6 }), 6);
  assert.equal(engineCountOf({}, null), 2);
  assert.equal(engineCountOf(undefined, undefined), 2);
});
