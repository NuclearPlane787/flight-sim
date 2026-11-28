// v0.8.0 (legs): the 3D models draw each landing-gear leg from its own position (state.gearLegs: nose, left, right),
// and exactly as v0.7.9 did from state.gearPos when the state has no legs or all three equal gearPos.
// Built in node with a stand-in canvas for the livery (its pixels don't matter here).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const noop = () => ({ addColorStop() {} });
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };

const THREE = await import('../vendor/three.module.js');
const { createAircraft, legPos } = await import('../src/aircraft.js');
const { createWidebody } = await import('../src/widebody.js');
const { B787_9, B777_300ER } = await import('../src/widebody-specs.js');
const { createSpray } = await import('../src/world/spray.js');
const { typeById } = await import('../src/sim/types.js');

const MODELS = {
  a321: () => createAircraft(),
  'b787-9': () => createWidebody(B787_9),
  'b777-300er': () => createWidebody(B777_300ER),
};
// Each leg's own bones (what update() turns for that leg's travel); the rest of the gear hangs from these.
const LEG_BONES = {
  a321: { 0: ['noseLeg'], 1: ['mainLegL'], 2: ['mainLegR'] },
  'b787-9': { 0: ['noseLeg', 'noseBrace'], 1: ['mainLegL', 'stayL'], 2: ['mainLegR', 'stayR'] },
  'b777-300er': { 0: ['noseLeg', 'noseBrace'], 1: ['mainLegL', 'stayL'], 2: ['mainLegR', 'stayR'] },
};

// Every bone's local pose and world matrix, as numbers (compared to the bit).
function pose(m, state) {
  m.update(state, 0);
  m.object.updateMatrixWorld(true);
  const out = {};
  for (const [k, b] of Object.entries(m.bones)) out[k] = [...b.position.toArray(), ...b.quaternion.toArray(), ...b.matrixWorld.elements];
  return out;
}
const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const differing = (A, B) => Object.keys(A).filter((k) => !same(A[k], B[k])).sort();
const base = (g, extra = {}) => ({ gearPos: g, gearDoors: 0, ...extra });

for (const [id, make] of Object.entries(MODELS)) {
  const m = make();

  test(`legs ${id}: no gearLegs, or all three equal to gearPos: every bone where gearPos alone puts it`, () => {
    for (const g of [0, 0.37, 1]) {
      const ref = pose(m, base(g));
      for (const st of [base(g, { gearLegs: [g, g, g] }), base(g, { gearLegs: [g, g, g], gearLegFlags: [0, 0, 0], gearSys: 0 })]) {
        const p = pose(m, st);
        assert.deepEqual(differing(ref, p), [], `${id} at ${g}`);
      }
      // the taxi lamp's pose too
      m.setLights({ taxi: 1 });
      m.update(base(g), 0); const a = m.lampPose();
      m.update(base(g, { gearLegs: [g, g, g] }), 0); const b = m.lampPose();
      assert.deepEqual(a, b);
      m.setLights({});
    }
  });

  test(`legs ${id}: one leg up, the other two down: only that leg's bones move, to the all-up pose`, () => {
    const down = pose(m, base(1)), up = pose(m, base(0));
    for (const leg of [0, 1, 2]) {
      const L = [1, 1, 1]; L[leg] = 0;
      const p = pose(m, base(2 / 3, { gearLegs: L, gearLegFlags: [0, 0, 0] }));
      const moved = differing(down, p);
      // the leg's own bones and everything hanging from them (wheels, pistons, bogie…), nothing on another leg
      for (const k of LEG_BONES[id][leg]) assert.ok(moved.includes(k), `${id} leg ${leg}: ${k} moved`);
      for (const other of [0, 1, 2].filter((o) => o !== leg)) for (const k of LEG_BONES[id][other]) assert.ok(!moved.includes(k), `${id} leg ${leg}: ${k} stayed`);
      for (const k of moved) assert.ok(same(p[k], up[k]), `${id} leg ${leg}: ${k} is the all-up pose's`);
      // and the whole up pose's bones for that leg are reached (the parts moved are exactly up's parts that differ for it)
      const upOnly = differing(down, up).filter((k) => !differing(up, p).includes(k));
      assert.deepEqual(moved, upOnly.filter((k) => moved.includes(k)));
    }
  });

  test(`legs ${id}: a collapsed leg is drawn folded, whatever its position says`, () => {
    const up = pose(m, base(0));
    for (const leg of [0, 1, 2]) {
      const F = [0, 0, 0]; F[leg] = 4;
      const p = pose(m, base(1, { gearLegs: [1, 1, 1], gearLegFlags: F }));
      for (const k of LEG_BONES[id][leg]) assert.ok(same(p[k], up[k]), `${id} collapsed ${leg}: ${k}`);
    }
  });

  test(`legs ${id}: "left" is the sim's left (body y > 0): mainLegL hangs at y > 0`, () => {
    pose(m, base(1));
    const w = new THREE.Vector3().setFromMatrixPosition(m.bones.mainLegL.matrixWorld);
    const wr = new THREE.Vector3().setFromMatrixPosition(m.bones.mainLegR.matrixWorld);
    // model frame: X = -y (body), so the body's left (y > 0) is model x < 0
    assert.ok(w.x < -1 && wr.x > 1, `${w.x} ${wr.x}`);
  });

  test(`legs ${id}: the taxi lamp is on the nose leg: off and its pose gone with the nose leg up`, () => {
    m.setLights({ taxi: 1 });
    m.update(base(1), 0); const downPose = m.lampPose();
    m.update(base(2 / 3, { gearLegs: [0, 1, 1] }), 0); const noseUp = m.lampPose();
    m.update(base(2 / 3, { gearLegs: [1, 0, 1] }), 0); const leftUp = m.lampPose();
    assert.notDeepEqual(downPose, noseUp, 'with the nose leg up the taxi pose is not used');
    assert.deepEqual(downPose, leftUp, 'a main leg up leaves the nose lamp alone');
    m.setLights({});
  });
}

test('legs: legPos', () => {
  assert.equal(legPos({}, 1, 0.37), 0.37);
  assert.equal(legPos({ gearLegs: [1, 0.2, 1] }, 1, 0.73), 0.2);
  assert.equal(legPos({ gearLegs: [1, 1, 1], gearLegFlags: [0, 0, 4] }, 2, 1), 0);
  assert.equal(legPos({ gearLegs: [1, 1.4, -1] }, 1, 1), 1);
  assert.equal(legPos({ gearLegs: [1, 1.4, -1] }, 2, 1), 0);
});

test('legs: no spray from a leg that is up; all three with no legs given', () => {
  const s = createSpray(typeById('b777-300er').geo.GEAR), on = s.object.material.uniforms.uOn.value;
  s.update({ gs: 60, onGround: true, runway: 'wet', rain: 1 });
  assert.deepEqual(on.toArray(), [1, 1, 1]);
  s.update({ gs: 60, onGround: true, runway: 'wet', rain: 1, legs: [1, 0, 1] });
  assert.deepEqual(on.toArray(), [1, 0, 1]);
  s.update({ gs: 60, onGround: true, runway: 'wet', rain: 1, legs: [1, 1, 1] });
  assert.deepEqual(on.toArray(), [1, 1, 1]);
});
