// v0.5.4, item 7a: the tailplane and the fin scale about their roots' trailing edges (src/sim/parts-aero.js shapeOf(),
// src/sim/airframe-map.js tail() and fin()): a bigger surface grows forward from where it ends, the two agree, and a
// factor of 1 leaves the base's surface exactly (moved back with the aft plug only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAirframe } from '../src/sim/designs.js';
import { airframeMap } from '../src/sim/airframe-map.js';
import { shapeOf } from '../src/sim/parts-aero.js';

const IDS = ['a321neo', 'b787-9', 'b777-300er'];
const af = (id, patch, wing = {}) => {
  const a = defaultAirframe(id);
  return { ...a, ...patch, wingL: { ...a.wingL, ...wing }, wingR: { ...a.wingR, ...wing } };
};

test('a bigger or smaller tail keeps its root\'s trailing edge; the map and the parts agree', () => {
  for (const id of IDS) {
    const base = shapeOf(id, null);
    for (const [k, aft] of [[1.4, 0], [0.7, 0], [1.3, 2.5]]) {
      const a = af(id, { tail: k, fin: 2 - k, plugAft: aft }), d = shapeOf(id, a), M = airframeMap(id, a);
      const t0 = base.tail.stations[0], n0 = d.tail.stations[0], f0 = base.fin.stations[0], m0 = d.fin.stations[0];
      assert.ok(Math.abs((n0.xle - n0.c) - (t0.xle - t0.c - aft)) < 1e-12, `${id} ${k}: the tailplane's root trailing edge`);
      assert.ok(Math.abs((m0.xle - m0.c) - (f0.xle - f0.c - aft)) < 1e-12, `${id} ${k}: the fin's root trailing edge`);
      assert.ok(k > 1 ? n0.xle > t0.xle - aft : n0.xle < t0.xle - aft, `${id} ${k}: the leading edge moves`);
      const [x] = M.tail(t0.xle - t0.c, t0.y, t0.z), [xf] = M.fin(f0.xle - f0.c, 0, f0.z);
      assert.ok(Math.abs(x - (t0.xle - t0.c - aft)) < 1e-12 && Math.abs(xf - (f0.xle - f0.c - aft)) < 1e-12, `${id} ${k}: the map's pivot`);
      for (let i = 0; i < base.tail.stations.length; i++) {
        const b = base.tail.stations[i], n = d.tail.stations[i], [mx, my, mz] = M.tail(b.xle, b.y, b.z);
        assert.ok(Math.abs(mx - n.xle) < 1e-9 && Math.abs(my - n.y) < 1e-9 && Math.abs(mz - n.z) < 1e-9, `${id} tail ${i}`);
        assert.ok(Math.abs(n.c - b.c * Math.sqrt(k)) < 1e-12, `${id} tail ${i}: the chord`);
      }
    }
  }
});

test('a factor of 1 keeps the base\'s tail and fin exactly', () => {
  for (const id of IDS) {
    const base = shapeOf(id, null);
    const a = af(id, {}, { span: 1.2, sweep: 4 }), d = shapeOf(id, a), M = airframeMap(id, a);
    assert.deepEqual(d.tail.stations, base.tail.stations, `${id}: the tailplane`);
    assert.deepEqual(d.fin.stations, base.fin.stations, `${id}: the fin`);
    assert.deepEqual(M.tail(-30.123, 4.56, 2.1), [-30.123, 4.56, 2.1]);
    assert.deepEqual(M.fin(-31.5, 0.2, 7.7), [-31.5, 0.2, 7.7]);
    // with the aft plug: moved back, nothing else
    const p = af(id, { plugAft: 2 }), dp = shapeOf(id, p), Mp = airframeMap(id, p);
    dp.tail.stations.forEach((s, i) => assert.deepEqual(s, { ...base.tail.stations[i], xle: base.tail.stations[i].xle - 2 }));
    dp.fin.stations.forEach((s, i) => assert.deepEqual(s, { ...base.fin.stations[i], xle: base.fin.stations[i].xle - 2 }));
    assert.deepEqual(Mp.tail(-30.123, 4.56, 2.1), [-30.123 - 2, 4.56, 2.1]);
  }
});
