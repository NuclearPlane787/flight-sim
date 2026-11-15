// v0.5.4: the warehouse editor's keys for the selected part (nudgePart(), KSP-style), and turned engines picked by their
// own box (rayBox() / pickPart() in the nacelle's frame).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  editPart, nudgePart, nudgeOf, nudgeHelp, NUDGE_KEYS, partBoxes, partBox, rayBox, pickPart, engineAxes,
} from '../src/ui/warehouse.js';
import { newDesign, addPart, mountRange, RANGES } from '../src/sim/designs.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const part = (d, id) => d.parts.find((p) => p.id === id);
const twinOf = (d, id) => part(d, part(d, id).pair);
const press = (d, id, key, n = 1, shift = false) => { for (let i = 0; i < n; i++) d = nudgePart(d, id, key, shift); return d; };
// the geometry frame's point at a box's local (a, b, c)
const at = (bx, l) => [0, 1, 2].map((k) => [bx.x, bx.y, bx.z][k] + l[0] * bx.axes[0][k] + l[1] * bx.axes[1][k] + l[2] * bx.axes[2][k]);
const unturned = (bx) => { const { axes, ...b } = bx; return b; };

test('engineAxes(): orthonormal, right-handed, the first one placeEngine()\'s thrust line; none for an unturned engine', () => {
  for (const [yaw, pitch, side] of [[10, 0, 1], [-7, 4, -1], [3, -10, 0]]) {
    const A = engineAxes({ yaw, pitch, side });
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(near(dot(A[i], A[j]), i === j ? 1 : 0, 1e-12));
    const cross = [A[0][1] * A[1][2] - A[0][2] * A[1][1], A[0][2] * A[1][0] - A[0][0] * A[1][2], A[0][0] * A[1][1] - A[0][1] * A[1][0]];
    for (let k = 0; k < 3; k++) assert.ok(near(cross[k], A[2][k], 1e-12));
    // toe-in (yaw > 0) turns a left engine's nose to −y, a right one's to +y
    if (yaw > 0 && side) assert.ok(Math.sign(A[0][1]) === -side);
  }
  const d = newDesign('a321neo');
  assert.equal(partBoxes(d).find((b) => b.id === 'p1').axes, undefined, 'an unturned engine keeps its plain box');
  assert.equal(partBox(d.base, { kind: 'tank', mount: 'wing', side: 1, s: 10, kg: 4000 }).axes, undefined);
});

test('a turned engine is picked by its own box, where the unturned box would miss (and not where only it would hit)', () => {
  let d = newDesign('a321neo');
  d = editPart(d, 'p1', 'yaw', 10);                       // toe-in 10°: the left nacelle's nose turns inboard
  const b = partBoxes(d).find((q) => q.id === 'p1');
  assert.ok(b.axes, 'the turned engine\'s box has its axes');
  // From below (nothing of the airframe in front of a nacelle), through its front outboard corner: inside the turned
  // box, outside the unturned one.
  const P = at(b, [0.97 * b.hx, 0.9 * b.hy, 0]);
  assert.ok(Math.abs(P[0] - b.x) > b.hx || Math.abs(P[1] - b.y) > b.hy, 'the point is outside the unturned box');
  const o = [P[0], P[1], b.z - 30], u = [0, 0, 1];
  assert.ok(rayBox(o, u, b) !== null);
  assert.equal(rayBox(o, u, unturned(b)), null, 'the axis-aligned box misses it');
  assert.equal(pickPart(d, o, u), 'p1');
  // ... and the corner the unturned box had (front, inboard) is empty now
  const Q = [b.x + 0.97 * b.hx, b.y - 0.9 * b.hy, b.z];
  const lq = b.axes.map((a) => a[0] * (Q[0] - b.x) + a[1] * (Q[1] - b.y) + a[2] * (Q[2] - b.z));
  assert.ok(Math.abs(lq[0]) > b.hx || Math.abs(lq[1]) > b.hy, 'the point is outside the turned box');
  const oq = [Q[0], Q[1], b.z - 30];
  assert.ok(rayBox(oq, u, unturned(b)) !== null);
  assert.equal(rayBox(oq, u, b), null);
  assert.notEqual(pickPart(d, oq, u), 'p1');
  // Along its own axis (turned and pitched), from behind and below: picked; the distance is to its aft face.
  d = editPart(d, 'p1', 'pitch', 10);
  const c = partBoxes(d).find((q) => q.id === 'p1'), e1 = c.axes[0];
  const oa = [c.x - 30 * e1[0], c.y - 30 * e1[1], c.z - 30 * e1[2]];
  assert.ok(near(rayBox(oa, e1, c), 30 - c.hx, 1e-9));
  assert.equal(pickPart(d, oa, e1), 'p1');
  // the twin (toe-in mirrored) is turned the other way and picked by its own box too
  const t = partBoxes(d).find((q) => q.id === 'p2');
  assert.ok(near(t.axes[0][1], -e1[1], 1e-12) && near(t.axes[0][0], e1[0], 1e-12));
  const ot = [t.x - 30 * t.axes[0][0], t.y - 30 * t.axes[0][1], t.z - 30 * t.axes[0][2]];
  assert.equal(pickPart(d, ot, t.axes[0]), 'p2');
});

test('keys on a wing engine: ↑ ↓ dx, ← → s (out, in), Shift+↑ ↓ dz, Q E yaw; the twin follows; the limits hold', () => {
  const d0 = newDesign('a321neo'), p0 = part(d0, 'p1'), R = mountRange(d0.base, p0, d0.airframe);
  let d = nudgePart(d0, 'p1', 'ArrowUp');
  assert.equal(part(d, 'p1').dx, 0.1); assert.equal(twinOf(d, 'p1').dx, 0.1);
  d = nudgePart(d, 'p1', 'ArrowDown'); d = nudgePart(d, 'p1', 'ArrowDown');
  assert.equal(part(d, 'p1').dx, -0.1); assert.equal(part(d, 'p2').dx, -0.1);
  d = press(d, 'p1', 'ArrowUp', 60);
  assert.equal(part(d, 'p1').dx, RANGES.dx[1]); assert.equal(part(d, 'p2').dx, RANGES.dx[1]);
  assert.deepEqual(nudgePart(d, 'p1', 'ArrowUp'), d, 'at the limit a key changes nothing (no undo step)');
  // along the span: ← out, → in, by 0.25 m, inside the mount's range
  d = nudgePart(d0, 'p2', 'ArrowLeft');
  assert.equal(part(d, 'p2').s, p0.s + 0.25); assert.equal(part(d, 'p1').s, p0.s + 0.25);
  d = press(d, 'p2', 'ArrowRight', 2);
  assert.equal(part(d, 'p1').s, p0.s - 0.25);
  assert.ok(near(part(press(d0, 'p1', 'ArrowLeft', 200), 'p1').s, R.hi, 1e-9));
  assert.ok(near(part(press(d0, 'p1', 'ArrowRight', 200), 'p1').s, R.lo, 1e-9));
  // up and down
  d = nudgePart(d0, 'p1', 'ArrowUp', true);
  assert.equal(part(d, 'p1').dz, 0.05); assert.equal(part(d, 'p2').dz, 0.05); assert.equal(part(d, 'p1').dx, 0);
  assert.equal(part(press(d0, 'p1', 'ArrowDown', 50, true), 'p2').dz, RANGES.dz[0]);
  assert.deepEqual(nudgePart(d0, 'p1', 'ArrowLeft', true), d0, 'Shift+← is no key');
  // turning: Q −1°, E +1° (toe-in positive, the twin's the same number, mirrored by its side)
  d = nudgePart(d0, 'p1', 'q');
  assert.equal(part(d, 'p1').yaw, -1); assert.equal(part(d, 'p2').yaw, -1);
  d = press(d0, 'p2', 'E', 25);
  assert.equal(part(d, 'p1').yaw, RANGES.yaw[1]); assert.equal(part(d, 'p2').yaw, RANGES.yaw[1]);
  // a part without a twin moves alone
  const solo = editPart(d0, 'p1', 'mirror', false);
  d = nudgePart(solo, 'p1', 'ArrowUp');
  assert.equal(part(d, 'p1').dx, 0.1); assert.equal(part(d, 'p2').dx, 0);
});

test('keys on the other parts: body engine and hold/ballast by station x, a wing tank by dx and s; others do nothing', () => {
  let d = editPart(newDesign('a321neo'), 'p1', 'mount', 'body');
  const b = part(d, 'p1'), Rb = mountRange(d.base, b, d.airframe);
  let n = nudgePart(d, 'p1', 'ArrowDown');
  assert.equal(part(n, 'p1').x, Math.round((b.x - 0.25) * 100) / 100); assert.equal(twinOf(n, 'p1').x, part(n, 'p1').x);
  assert.equal(part(n, 'p1').dx, 0, 'a body engine moves by its station, not dx');
  assert.ok(near(part(press(d, 'p1', 'ArrowUp', 200), 'p1').x, Rb.hi, 1e-9));
  assert.deepEqual(nudgePart(d, 'p1', 'ArrowLeft'), d, 'no span on the body');
  assert.equal(part(nudgePart(d, 'p1', 'e'), 'p1').yaw, 1, 'a body engine still turns');
  // the hold's tank and the ballast: forward and aft by station only
  d = addPart(newDesign('a321neo'), { kind: 'tank', mount: 'hold', x: 0, kg: 2000 });
  d = addPart(d, { kind: 'ballast', x: 0, kg: 500 });
  const h = d.parts.find((p) => p.mount === 'hold'), w = d.parts.find((p) => p.kind === 'ballast');
  n = nudgePart(d, h.id, 'ArrowUp');
  assert.equal(part(n, h.id).x, Math.round((h.x + 0.25) * 100) / 100);
  n = nudgePart(d, w.id, 'ArrowDown');
  assert.equal(part(n, w.id).x, Math.round((w.x - 0.25) * 100) / 100);
  for (const [k, s] of [['ArrowLeft', false], ['ArrowUp', true], ['q', false], ['E', false]]) {
    assert.deepEqual(nudgePart(d, h.id, k, s), d); assert.deepEqual(nudgePart(d, w.id, k, s), d);
  }
  const Rh = mountRange(d.base, h, d.airframe);
  assert.ok(near(part(press(d, h.id, 'ArrowDown', 200), h.id).x, Rh.lo, 1e-9));
  // a wing tank (and its twin)
  d = addPart(newDesign('a321neo'), { kind: 'tank', mount: 'wing', side: 1, s: 10, kg: 4000 });
  const t = d.parts.find((p) => p.kind === 'tank');
  n = nudgePart(nudgePart(d, t.id, 'ArrowUp'), t.id, 'ArrowLeft');
  assert.equal(part(n, t.id).dx, 0.1); assert.equal(twinOf(n, t.id).dx, 0.1);
  assert.equal(part(n, t.id).s, t.s + 0.25); assert.equal(twinOf(n, t.id).s, t.s + 0.25);
  assert.deepEqual(nudgePart(d, t.id, 'q'), d);
  assert.deepEqual(nudgePart(d, t.id, 'ArrowUp', true), d);
  // unknown keys and parts
  assert.deepEqual(nudgePart(d, t.id, 'w'), d);
  assert.deepEqual(nudgePart(d, 'nope', 'ArrowUp'), d);
  assert.equal(nudgeOf(null, 'ArrowUp'), null);
});

test('the key map: the keys, and the help line for each kind of part', () => {
  assert.deepEqual([...NUDGE_KEYS].sort(), ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'E', 'Q', 'e', 'q']);
  const d = newDesign('a321neo');
  assert.equal(nudgeHelp(part(d, 'p1')), '↑ ↓ forward and aft · ← → out and in · Shift+↑ ↓ up and down · Q E turn');
  assert.equal(nudgeHelp({ kind: 'engine', mount: 'body', side: 1 }), '↑ ↓ forward and aft · Shift+↑ ↓ up and down · Q E turn');
  assert.equal(nudgeHelp({ kind: 'engine', mount: 'tail', side: 0 }), '↑ ↓ forward and aft · Shift+↑ ↓ up and down · Q E turn');
  assert.equal(nudgeHelp({ kind: 'tank', mount: 'wing', side: 1 }), '↑ ↓ forward and aft · ← → out and in');
  assert.equal(nudgeHelp({ kind: 'tank', mount: 'hold', side: 0 }), '↑ ↓ forward and aft');
  assert.equal(nudgeHelp({ kind: 'ballast' }), '↑ ↓ forward and aft');
  assert.deepEqual(nudgeOf({ kind: 'engine', mount: 'overwing', side: -1 }, 'ArrowRight'), { key: 's', by: -0.25 });
});
