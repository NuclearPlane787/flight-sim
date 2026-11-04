// A widebody's shape from its spec, against its geometry module and the planning document's numbers.
//   node --test tests/widebody-shape.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuselageShape, curve } from '../src/widebody-shape.js';
import { boeingWindowOutlines } from '../src/cockpit-windows-boeing.js';
import { B787_9 as S, B777_300ER as S7 } from '../src/widebody-specs.js';
import { TYPES } from '../src/sim/types.js';

const G = S.geo, shape = fuselageShape(S), N = G.NOSE_X;
const close = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test('the cabin section is the document\'s: 5.77 m wide, 5.94 m high, slightly oval', () => {
  const s = shape.fuseSection(0);
  close(2 * s.hw, G.FUSELAGE_WIDTH, 1e-9, 'width');
  close(s.up + s.down, G.FUSELAGE_HEIGHT, 1e-9, 'height');
  assert.ok(s.up + s.down > 2 * s.hw, 'taller than wide');
});

test('the fuselage runs from the nose tip to the tail cone\'s end, closing at the tip', () => {
  close(shape.fuseHW(N), 0, 1e-9, 'half-width at the tip');
  close(shape.fuseTop(N), shape.fuseBot(N), 1e-9, 'top and bottom meet');
  assert.ok(shape.tailEndX > G.TAIL_X, 'the tail cone stops short of the stabiliser\'s tips');
  close(shape.tailEndX, G.FUSELAGE_TAIL_X, 1e-9, 'tail cone end');
  assert.ok(shape.fuseHW(shape.tailEndX) < 0.2);
});

test('the top and bottom lines are smooth: no windshield step on the 787', () => {
  // Slope of the crown along the nose: it may only get shallower going aft, within the table's noise.
  let last = Infinity;
  for (let d = 0.5; d < 9; d += 0.25) {
    const slope = (shape.fuseTop(N - d - 0.05) - shape.fuseTop(N - d + 0.05)) / 0.1;
    assert.ok(slope < last + 0.12, `kink at d=${d}: ${slope} after ${last}`);
    last = slope;
  }
});

test('fusePoint matches the section at the crown, belly and sides', () => {
  for (const x of [N - 3, 0, -25]) {
    const s = shape.fuseSection(x);
    close(shape.fusePoint(x, 90).z, s.zc + s.up, 1e-9, 'crown');
    close(shape.fusePoint(x, 270).z, s.zc - s.down, 1e-9, 'belly');
    close(shape.fusePoint(x, 0).y, s.hw, 1e-9, 'left');
    close(shape.fusePoint(x, 180).y, -s.hw, 1e-9, 'right');
  }
});

test('the pilot\'s eye is inside the nose, with headroom', () => {
  const E = G.EYES.captain, s = shape.fuseSection(E.x);
  const crown = s.zc + s.up * Math.sqrt(1 - (E.y / s.hw) ** 2);
  assert.ok(crown - E.z > 0.45, `headroom ${crown - E.z}`);
  assert.ok(E.z - (s.zc - s.down) > 2.2, 'the floor is well below');
});

test('four cockpit windows, where the document\'s side and top views put them', () => {
  const W = boeingWindowOutlines(S, shape);
  assert.equal(W.length, 2, 'two a side');
  const ext = (w) => {
    const P = w.map(([x, t]) => shape.fusePoint(x, t));
    const r = (k) => [Math.min(...P.map((p) => p[k])), Math.max(...P.map((p) => p[k]))];
    return { x: r('x'), y: r('y'), z: r('z') };
  };
  const [f, sd] = W.map(ext);
  // Drawing: the front window d = 1.1…2.4 m, the side window d = 2.1…3.4 m, both z ≈ 0.3…1.1 m.
  close(N - f.x[1], 1.3, 0.25, 'front window, forward edge');
  close(N - sd.x[0], 3.4, 0.25, 'side window, aft edge');
  close(f.z[0], 0.3, 0.2, 'front window sill');
  close(sd.z[1], 1.12, 0.2, 'side window top');
});

test('doors and windows sit on the cabin at the document\'s stations', () => {
  const C = S.cabin;
  assert.deepEqual(C.doors, [6.30, 18.36, 35.43, 49.66]);  // D6-58333 §2.7.1
  for (const d of C.doors) {
    const s = shape.fuseSection(N - d);
    assert.ok(Math.abs(C.doorZ + C.doorH / 2 - s.zc) < s.up, `door at ${d} fits under the crown`);
  }
  assert.ok(C.window.pitch > C.window.w);
});

test('the tail-strike point is at the skin (the numbers job\'s 0.24 m allowance)', () => {
  const P = G.TAIL_STRIKE_POINT;
  close(shape.fuseBot(P.x), P.z - 0.24, 0.12, 'underside at the strike point');
});

test('the wing\'s planform reaches the tips and carries about the published area', () => {
  const W = S.wing, le = curve(W.le), te = curve(W.te);
  close(le(G.FUSELAGE_WIDTH / 2), G.WING.rootX, 1e-9, 'root leading edge');
  close(le(G.FUSELAGE_WIDTH / 2) - te(G.FUSELAGE_WIDTH / 2), G.WING.rootChord, 1e-9, 'root chord');
  close(te(G.WING.kinkY), G.WING.kinkTeX, 1e-9, 'trailing-edge kink');
  close(te(G.SPAN / 2), G.WING.tipTeX, 1e-9, 'the rake\'s point');
  // Trapezoids across the span: the leading edge carried straight through the fuselage.
  let area = 0;
  const yEnd = G.SPAN / 2, h = 0.02;
  for (let y = 0.3; y < yEnd; y += h) area += 2 * h * Math.max(0, le(y) - te(y));
  // Published gross area, 377 m² (b787-9.js S), is a reference figure; a planform measure comes close.
  close(area, S.data.S, 40, 'area');
  for (let y = 0.3; y < yEnd; y += 0.2) assert.ok(le(y) > te(y), `chord positive at ${y}`);
});

test('the surfaces don\'t overlap, the spoilers map onto the sim\'s five values', () => {
  const W = S.wing, spans = [W.flapIn, W.flaperon, W.flapOut, W.aileron];
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1], `surface ${i}`);
  assert.ok(W.aileron[1] < G.SPAN / 2);
  assert.equal(W.spoilers.length, 7);
  assert.deepEqual([...new Set(W.spoilers.map((s) => s[2]))].sort(), [0, 1, 2, 3, 4]);
  // No slat runs behind the engine's pylon.
  const ey = Math.abs(G.NACELLES[0].y);
  for (const [a, b] of W.slatSegments) assert.ok(b < ey - 0.5 || a > ey + 0.5, `slat ${a}–${b}`);
});

test('the nacelle hangs ahead of the wing, not through it', () => {
  const n = G.NACELLES[0], le = curve(S.wing.le);
  assert.ok(n.x - G.NACELLE_LENGTH / 2 > le(n.y) - 0.3, 'the cowl ends about at the leading edge');
  assert.ok(n.z - G.NACELLE_DIAMETER / 2 + G.GROUND_Z > 0.5, 'and clears the ground');
});

test('the main gear stands under the wing and the nose gear under the nose', () => {
  const W = S.wing, le = curve(W.le), te = curve(W.te), g = G.GEAR.left;
  assert.ok(g.x < le(g.y) && g.x > te(g.y));
  close(N - G.GEAR.nose.x, 5.41, 0.01, 'nose gear from the tip');
  close(G.GEAR.nose.x - g.x, G.WHEELBASE, 1e-9, 'wheelbase');
});

// ---- The 777-300ER, against D6-58329-2's §2.2.2 ------------------------------------------------
const G7 = S7.geo, shape7 = fuselageShape(S7), N7 = G7.NOSE_X;

test('777: a true circle, 6.20 m, from the nose to the tail cone\'s blade', () => {
  const s = shape7.fuseSection(0);
  close(2 * s.hw, 6.2, 1e-9, 'width');
  close(s.up + s.down, 6.2, 1e-9, 'height');
  close(s.up, s.hw, 1e-9, 'circular');
  close(shape7.fuseHW(N7), 0, 1e-9, 'closes at the tip');
  close(shape7.fuseTop(N7), shape7.fuseBot(N7), 1e-9, 'top and bottom meet at the tip');
  close(shape7.tailEndX, G7.FUSELAGE_TAIL_X, 1e-9, 'tail cone end');
  // The 777's tail ends in a vertical blade, not a point: tall and nearly no width.
  const e = shape7.fuseSection(shape7.tailEndX);
  assert.ok(e.up + e.down > 1.2 && e.hw < 0.1, `blade ${e.up + e.down} × ${e.hw}`);
});

test('777: registration, type and five door pairs on the much longer cabin', () => {
  assert.equal(S7.registration, TYPES['b777-300er'].registration);
  assert.notEqual(S7.registration, S.registration);
  assert.equal(S7.cabin.doors.length, 5);
  for (const d of S7.cabin.doors) {
    const s = shape7.fuseSection(N7 - d);
    assert.ok(Math.abs(S7.cabin.doorZ + S7.cabin.doorH / 2 - s.zc) < s.up, `door at ${d} fits under the crown`);
  }
  assert.ok(S7.cabin.window.h < S.cabin.window.h, 'smaller windows than the 787\'s');
  assert.ok(G7.FUSELAGE_LENGTH - G.FUSELAGE_LENGTH > 10, 'and a much longer fuselage');
});

test('777: six cockpit windows lie on the nose, where the drawing puts them', () => {
  const W = boeingWindowOutlines(S7, shape7);
  assert.equal(W.length, 3, 'three a side');
  for (const w of W) for (const [x] of w) assert.ok(N7 - x > 0.5 && N7 - x < 4, `window at d = ${N7 - x}`);
});

test('777: the wing reaches its drawn points and carries about its area', () => {
  const W = S7.wing, le = curve(W.le), te = curve(W.te), yEnd = G7.SPAN / 2;
  close(le(G7.FUSELAGE_WIDTH / 2), G7.WING.rootX, 1e-9, 'root leading edge, 26.89 m');
  close(le(G7.FUSELAGE_WIDTH / 2) - te(G7.FUSELAGE_WIDTH / 2), G7.WING.rootChord, 1e-9, 'root chord');
  close(te(G7.WING.kinkY), G7.WING.kinkTeX, 1e-9, 'trailing-edge kink');
  close(le(yEnd), G7.WING.tipLeX, 1e-9, 'rake, 48.50 m');
  close(te(yEnd), G7.WING.tipTeX, 1e-9, 'rake\'s point, 49.11 m');
  let area = 0;
  for (let y = 0.3; y < yEnd; y += 0.02) area += 2 * 0.02 * Math.max(0, le(y) - te(y));
  close(area, S7.data.S, 45, 'area');
  for (let y = 0.3; y < yEnd; y += 0.2) assert.ok(le(y) > te(y), `chord positive at ${y}`);
});

test('777: a straight wing: the chord plane doesn\'t bend up towards the tip as the 787\'s does', () => {
  const z = curve(S7.wing.zTable), yEnd = G7.SPAN / 2;
  close(z(yEnd), G7.WING.tipZ, 1e-9, 'tip height from the module');
  const slope = (a, b) => (z(b) - z(a)) / (b - a);
  assert.ok(slope(25, yEnd) <= slope(5, 12) + 1e-9, 'the outer wing is no steeper than the inner');
});

test('777: surfaces don\'t overlap, seven spoilers map onto the sim\'s five, slats clear the pylon', () => {
  const W = S7.wing, spans = [W.flapIn, W.flaperon, W.flapOut, W.aileron];
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1], `surface ${i}`);
  assert.ok(W.aileron[1] < G7.SPAN / 2);
  assert.equal(W.spoilers.length, 7);
  assert.deepEqual([...new Set(W.spoilers.map((s) => s[2]))].sort(), [0, 1, 2, 3, 4]);
  const ey = Math.abs(G7.NACELLES[0].y);
  for (const [a, b] of W.slatSegments) assert.ok(b < ey - 0.5 || a > ey + 0.5, `slat ${a}–${b}`);
  assert.ok(W.flapInAftF > W.hingeF && W.flapInAftF < 1, 'the double-slotted flap\'s aft part');
});

test('777: the GE90 is the fat one, with no chevrons, and its fan fits its duct', () => {
  const E = S7.engine;
  assert.equal(E.chevrons, 0);
  close(E.fanR * 2, 3.25, 1e-9, 'fan');
  assert.ok(G7.NACELLE_DIAMETER > 3.9 && G7.NACELLE_DIAMETER > G.NACELLE_DIAMETER, 'bigger than the GEnx\'s');
  const RN = G7.NACELLE_DIAMETER / 2;
  assert.ok(E.intake[0][1] * RN >= E.fanR, 'the blades end inside the duct at the fan');
  const n = G7.NACELLES[0], le = curve(S7.wing.le);
  assert.ok(n.x - G7.NACELLE_LENGTH / 2 > le(n.y) - 0.5, 'the cowl ends about at the leading edge');
  assert.ok(n.z - RN + G7.GROUND_Z > 0.5, 'and clears the ground');
});

test('777: six wheels a bogie, and the gear stands under the wing and the nose', () => {
  const B = G7.BOGIE, W = S7.wing, le = curve(W.le), te = curve(W.te), g = G7.GEAR.left;
  assert.equal(B.axles, 3);
  assert.ok(S7.gear.aftSteer.maxDeg > 0);
  assert.ok(g.x < le(g.y) && g.x > te(g.y));
  close(N7 - G7.GEAR.nose.x, 5.89, 0.01, 'nose gear from the tip');
  close(G7.GEAR.nose.x - g.x, G7.WHEELBASE, 1e-9, 'wheelbase');
});

test('777: the loft\'s rows run forward without a reversal', () => {
  const d = S7.fuselage.midD;
  for (let i = 1; i < d.length; i++) assert.ok(d[i] < d[i - 1], `row ${i}`);
  assert.ok(d[0] < S7.fuselage.tailConeD && d[d.length - 1] > G7.NOSE_X - G7.EYES.captain.x + S7.splitBehindEye);
});
