// v0.7.4, Shane's item 6 ("The landing gear bogeys of the planes all seem really fragile (they are made with thin little
// rods)"): the gear was rebuilt in real proportions, for looks only. Against the pushed v0.7.3's numbers
// (tests/v074-gear-base.json, from its models): the sim's contact points (geo.GEAR), every gear bone's pivot and pose
// (down, loaded and steered, half-way with the doors open, retracted), and each wheel's extent (its lowest point, the
// contact; its top; its front and back) are unchanged. And the parts are as thick as the brief asks.
//
//   node --test games/flight-sim/tests/v074-gear-model.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ctx = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 100 })
    : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };

const { createAircraft } = await import('../src/aircraft.js');
const { createWidebody } = await import('../src/widebody.js');
const { B787_9, B777_300ER } = await import('../src/widebody-specs.js');
const { typeById } = await import('../src/sim/types.js');
const BASE = JSON.parse(readFileSync(new URL('./v074-gear-base.json', import.meta.url), 'utf8'));

const RX = /Leg|stay|Piston|bogie|Wheel|Axle|Door|nose/;
const POSES = [['down', { gearPos: 1, gearDoors: 0 }], ['loaded', { gearPos: 1, gearDoors: 0, gearCompression: { nose: 0.2, left: 0.3, right: 0.1 }, steerAngle: 0.3 }],
  ['half', { gearPos: 0.5, gearDoors: 1 }], ['up', { gearPos: 0, gearDoors: 0 }]];
const BUILD = { 'a321neo': () => createAircraft({}), 'b787-9': () => createWidebody(B787_9, {}), 'b777-300er': () => createWidebody(B777_300ER, {}) };
const r6 = (x) => Math.round(x * 1e6) / 1e6 || 0;   // (−0 as 0, as JSON has it)
const models = {};
const model = (id) => (models[id] ??= BUILD[id]());

for (const id of Object.keys(BUILD)) {
  test(`${id}: the sim's contact points are the pushed tree's`, () => {
    assert.deepEqual(JSON.parse(JSON.stringify(typeById(id).geo.GEAR)), BASE[id].GEAR);
  });

  test(`${id}: every gear bone where it was, in every pose (down, loaded and steered, half-way, retracted)`, () => {
    const m = model(id);
    for (const [k, st] of POSES) {
      m.update(st, 0); m.object.updateMatrixWorld(true);
      const P = {};
      for (const b of m.mesh.skeleton.bones) if (RX.test(b.name)) { const e = b.matrixWorld.elements; P[b.name] = [e[12], e[13], e[14], e[0], e[5], e[10]].map(r6); }
      assert.deepEqual(P, BASE[id].poses[k], `${id} ${k}`);
    }
  });

  test(`${id}: each wheel's lowest point (the contact), top, front and back unchanged`, () => {
    const m = model(id), g = m.mesh.geometry, p = g.attributes.position, si = g.attributes.skinIndex, bones = m.mesh.skeleton.bones;
    const W = {};
    for (let bi = 0; bi < bones.length; bi++) {
      if (!/Wheel/.test(bones[bi].name)) continue;
      let lo = Infinity, hi = -Infinity, f = Infinity, a = -Infinity;
      for (let i = 0; i < p.count; i++) if (si.getX(i) === bi) { const y = p.getY(i), z = p.getZ(i); lo = Math.min(lo, y); hi = Math.max(hi, y); f = Math.min(f, z); a = Math.max(a, z); }
      W[bones[bi].name] = [lo, hi, f, a].map(r6);
    }
    assert.deepEqual(W, BASE[id].wheels);
  });
}

// The parts' thickness, read off the geometry: the vertices skinned to a bone, across the axis it's built along.
function spread(m, bone, axis, near) {
  const g = m.mesh.geometry, p = g.attributes.position, si = g.attributes.skinIndex;
  const bi = m.mesh.skeleton.bones.findIndex((b) => b.name === bone);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.count; i++) {
    if (si.getX(i) !== bi) continue;
    const v = [p.getX(i), p.getY(i), p.getZ(i)];
    if (near && !near(v)) continue;
    lo = Math.min(lo, v[axis]); hi = Math.max(hi, v[axis]);
  }
  return hi - lo;
}

test('the widebodies\' bogie beam is a deep box, not a rod; the piston and the legs thicker than before', () => {
  for (const id of ['b787-9', 'b777-300er']) {
    const m = model(id), G = typeById(id).geo.GEAR, R = (id === 'b787-9' ? B787_9 : B777_300ER).geo.BOGIE.wheelRadiusMain;
    m.update({ gearPos: 1, gearDoors: 0 }, 0);
    // the beam's depth (model frame: y up): what's on the bogie's bone within 0.16 m of its middle across (the box's
    // corners; the yoke, the bosses, the axles and the brakes reach further out)
    const axleY = G.left.z + R;
    const deep = spread(model(id), 'bogieL', 1, (v) => Math.abs(-v[0] - G.left.y) < 0.16);
    assert.ok(deep >= 0.38, `${id}: the beam ${deep.toFixed(2)} m deep (was a rod of 0.22)`);
    const pis = spread(model(id), 'mainPistonL', 0, (v) => Math.abs(-v[2] - G.left.x) < 0.25 && v[1] > axleY + 0.45);
    assert.ok(pis >= 0.33, `${id}: the piston ${pis.toFixed(2)} m across (was 0.26)`);
  }
});

test('the A321\'s main legs and axle thicker; nothing of the gear lower than the tyres', () => {
  const m = model('a321neo'), G = typeById('a321neo').geo.GEAR;
  const pis = spread(m, 'mainPistonL', 2, (v) => Math.abs(-v[0] - G.left.y) < 0.12 && v[1] > -3.05 && v[1] < -2.75);
  assert.ok(pis >= 0.25, `the piston ${pis.toFixed(2)} m across (was 0.2)`);
  for (const id of Object.keys(BUILD)) {
    const mm = model(id), g = mm.mesh.geometry, p = g.attributes.position, si = g.attributes.skinIndex, bones = mm.mesh.skeleton.bones;
    const lowest = Math.min(...Object.values(BASE[id].wheels).map((w) => w[0]));
    let low = Infinity;
    for (let i = 0; i < p.count; i++) if (RX.test(bones[si.getX(i)].name) && !/Door/.test(bones[si.getX(i)].name)) low = Math.min(low, p.getY(i));
    assert.ok(low >= lowest - 1e-6, `${id}: the gear's lowest point ${low.toFixed(3)}, the tyres' ${lowest.toFixed(3)}`);
  }
});
