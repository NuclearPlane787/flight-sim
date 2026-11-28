// v0.8.0 (legs): the gear indication on the engine screens, per leg (state.gearLegs: nose, left, right), drawn in node
// into a context that records every call and every property set. With nothing failed (no gearLegs, or all three equal
// to gearPos and no gear flag) every call is what v0.7.9's drawing made; with a leg up the A321's LDG GEAR shows that
// leg's triangle red, and the Boeings' EICAS shows the three legs apart (left main, nose, right main).
//   node --test tests/v080-legs-screens.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { armed } from '../src/sim/failures.js';
import { resolveDef } from '../src/sim/designs.js';
import { createEnginesPanel, gearLegsShown } from '../src/ui/engines-panel.js';
import { createEicas } from '../src/ui/boeing/eicas.js';
import { run, KT, FT } from './sim-helpers.mjs';

const C = { red: '#ff2b2b', amber: '#ffa515', green: '#3cff4e', white: '#f2f2f2' };

// Every call and every property set, in order; fillText also kept apart with its colour.
function recCanvas(w) {
  const calls = [], texts = [];
  const st = { font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000' };
  const px = () => { const m = /([\d.]+)px/.exec(st.font); return m ? +m[1] : 10; };
  const ctx = new Proxy({}, {
    get(t, p) {
      if (p === 'measureText') return (s) => ({ width: String(s).length * px() * 0.56 });
      if (p in st) return st[p];
      return (...a) => {
        calls.push([p, ...a.map((x) => (typeof x === 'number' || typeof x === 'string' ? x : typeof x))]);
        if (p === 'fillText') texts.push({ s: String(a[0]), x: a[1], y: a[2], col: st.fillStyle });
        if (p === 'stroke' || p === 'fill') calls.push(['@', p, st.strokeStyle, st.fillStyle]);
        return p === 'createLinearGradient' || p === 'createRadialGradient' ? { addColorStop() {} } : undefined;
      };
    },
    set(t, p, v) { st[p] = v; calls.push(['=', p, typeof v === 'object' ? 'obj' : v]); return true; },
  });
  return { cv: { ctx, w, h: w * 0.62, begin() { calls.length = 0; texts.length = 0; } }, calls, texts };
}
function cruise(type) {
  const sim = type ? createSim({ type }) : createSim();
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 3000 * FT, iasMs: 200 * KT, flapLever: 0, gearDown: true, fuelKg: 9000, payloadKg: 12000 });
  run(sim, 0.3);
  return sim;
}
const PANELS = { a321neo: createEnginesPanel, 'b787-9': createEicas, 'b777-300er': createEicas };
function drawOnce(type, state, controls) {
  const r = recCanvas(400), p = PANELS[type](r.cv);
  p.setType(resolveDef(type));
  p.draw({ state, controls, ap: {}, timeScale: 1 });
  return r;
}
// The state's own object for every field but the gear's (a copy: the sim's state is one reused object).
function withGear(sim, g, legs, flags, sys) {
  const s = { ...sim.state, gearPos: g, gearDoors: 0 };
  if (legs) { s.gearLegs = legs; s.gearLegFlags = flags ?? [0, 0, 0]; s.gearSys = sys ?? 0; } else { delete s.gearLegs; delete s.gearLegFlags; delete s.gearSys; }
  return s;
}

for (const type of Object.keys(PANELS)) {
  test(`legs screens ${type}: with nothing failed every canvas call is the one-position drawing's`, () => {
    const sim = cruise(type);
    for (const g of [0, 0.5, 1]) for (const down of [true, false]) {
      const controls = { ...sim.controls, gearDown: down };
      const a = drawOnce(type, withGear(sim, g, null), controls).calls;
      const b = drawOnce(type, withGear(sim, g, [g, g, g]), controls).calls;
      assert.ok(a.length > 100, 'something was drawn');
      assert.deepEqual(b, a, `${type} at ${g}, lever ${down ? 'down' : 'up'}`);
    }
  });
}

test('legs screens: gearLegsShown', () => {
  assert.equal(gearLegsShown({ gearPos: 1 }), null);
  assert.equal(gearLegsShown({ gearLegs: [0.5, 0.5, 0.5], gearLegFlags: [0, 0, 0], gearSys: 0 }), null);
  assert.deepEqual(gearLegsShown({ gearLegs: [1, 0, 1], gearLegFlags: [0, 1, 0], gearSys: 0 }), [1, 0, 1]);
  assert.deepEqual(gearLegsShown({ gearLegs: [1, 1, 1], gearLegFlags: [0, 0, 4], gearSys: 0 }), [1, 1, 0], 'collapsed: up');
  assert.deepEqual(gearLegsShown({ gearLegs: [0, 0, 0], gearLegFlags: [0, 0, 0], gearSys: 1 }), [0, 0, 0], 'no extension: shown per leg');
});

test('legs screens a321neo: the left leg up with the lever down: two green triangles and the left one red; UP gone', () => {
  const sim = cruise();
  const r = drawOnce('a321neo', withGear(sim, 2 / 3, [1, 0, 1], [1 & 0, 1, 0]), { ...sim.controls, gearDown: true });
  // each triangle is moveTo, lineTo, lineTo, closePath, then fill (green) or stroke (red)
  const tri = [];
  for (let i = 0; i + 4 < r.calls.length; i++) {
    const c = r.calls;
    if (c[i][0] === 'closePath' && c[i - 3]?.[0] === 'moveTo') {
      const j = c.findIndex((x, k) => k > i && x[0] === '@');
      tri.push({ x: c[i - 3][1], how: c[j][1], col: c[j][1] === 'fill' ? c[j][3] : c[j][2] });
    }
  }
  const gearTri = tri.filter((t) => t.how === 'fill' ? t.col === C.green : t.col === C.red);
  assert.equal(gearTri.length, 3, JSON.stringify(tri));
  const left = gearTri.reduce((a, b) => (b.x < a.x ? b : a));
  assert.equal(left.how, 'stroke'); assert.equal(left.col, C.red);
  assert.equal(gearTri.filter((t) => t.how === 'fill' && t.col === C.green).length, 2);
  assert.ok(!r.texts.some((t) => t.s === 'UP' && t.y > 0.4 * 400 && t.y < 0.6 * 400), 'no UP in the gear block');
  // with the lever up, the same leg reads UP (as with the gear up)
  const r2 = drawOnce('a321neo', withGear(sim, 2 / 3, [1, 0, 1], [0, 1, 0]), { ...sim.controls, gearDown: false });
  assert.equal(r2.texts.filter((t) => t.s === 'UP').length, 1);
});

for (const type of ['b787-9', 'b777-300er']) {
  test(`legs screens ${type}: a leg up: DN, UP, DN apart in the order left, nose, right; the nose up: DN UP… in its place`, () => {
    const sim = cruise(type), controls = { ...sim.controls, gearDown: true };
    // the gear row only (y = 0.14 of the width; the trim's and the flaps' DN and UP are elsewhere)
    const legsText = (r) => r.texts.filter((t) => (t.s === 'DN' || t.s === 'UP' || t.s === 'DOWN') && Math.abs(t.y - 0.14 * 400) < 3).sort((a, b) => a.x - b.x);
    let t = legsText(drawOnce(type, withGear(sim, 2 / 3, [1, 0, 1], [0, 1, 0]), controls));
    assert.deepEqual(t.map((x) => x.s), ['UP', 'DN', 'DN'], 'left main up (the leftmost box)');
    assert.equal(t[0].col, C.white);
    t = legsText(drawOnce(type, withGear(sim, 2 / 3, [0, 1, 1], [1, 0, 0]), controls));
    assert.deepEqual(t.map((x) => x.s), ['DN', 'UP', 'DN'], 'nose up (the middle box)');
    t = legsText(drawOnce(type, withGear(sim, 2 / 3, [1, 1, 0], [0, 0, 1]), controls));
    assert.deepEqual(t.map((x) => x.s), ['DN', 'DN', 'UP'], 'right main up');
    for (const x of t.filter((q) => q.s === 'DN')) assert.equal(x.col, C.green);
    // with nothing failed: the one DOWN box
    t = legsText(drawOnce(type, withGear(sim, 1, [1, 1, 1]), controls));
    assert.deepEqual(t.map((x) => x.s), ['DOWN']);
  });
}

test('legs screens: a real failure in the sim (the left leg won\'t lock) reaches the A321 panel', () => {
  const sim = createSim();
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 3000 * FT, iasMs: 200 * KT, flapLever: 0, gearDown: false, fuelKg: 9000, payloadKg: 12000 });
  sim.controls.gearDown = false;
  sim.setFailures(armed(null, { kind: 'gear-nolock', target: 1, when: { type: 'now' } }, sim.state.t, 1));
  run(sim, 1);
  sim.controls.gearDown = true;
  run(sim, 30);
  assert.deepEqual(sim.state.gearLegs.map((x) => Math.round(x)), [1, 0, 1]);
  assert.deepEqual(gearLegsShown(sim.state), [1, 0, 1]);
});
