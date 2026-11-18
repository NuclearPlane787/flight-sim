// v0.5.4: the models' side of dropped wing tanks (state.tanksDropped scales engine-model.js's pod<k> bones to nothing;
// v0.5.6: after they fall away, on the sim time state.t),
// and the A321's inner flap re-clamped behind the main gear's leg on a design's airframe.
//   node --test games/flight-sim/tests/v054-models.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A canvas that draws nothing, so the liveries paint without a DOM.
const ctx = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 100 })
    : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };

const THREE = await import('../vendor/three.module.js');
const { createAircraft } = await import('../src/aircraft.js');
const { createWidebody } = await import('../src/widebody.js');
const { B787_9 } = await import('../src/widebody-specs.js');
const { newDesign, defaultAirframe, designDef, addPart } = await import('../src/sim/designs.js');

const withTanks = (id) => addPart(newDesign(id), { kind: 'tank', mount: 'wing', side: 1, s: 10, kg: 3000 });
const podBones = (m) => Object.keys(m.bones).filter((n) => /^pod\d+$/.test(n)).map((n) => m.bones[n]);

// v0.5.6: the middle of what's weighted to `name`, as posed (the model's frame: y up, z aft), or null.
function posedCentre(m, name) {
  m.object.updateMatrixWorld(true);
  const mesh = m.mesh, g = mesh.geometry, si = g.attributes.skinIndex, idx = mesh.skeleton.bones.findIndex((b) => b.name === name);
  const v = new THREE.Vector3(), box = new THREE.Box3();
  for (let i = 0; i < si.count; i++) {
    if (si.getX(i) !== idx) continue;
    v.fromBufferAttribute(g.attributes.position, i);
    mesh.applyBoneTransform(i, v);
    box.expandByPoint(v);
  }
  return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
}

// Where a vertex weighted to `name` is drawn in the pose the bones now hold (body frame, m).
function posedSpread(m, name) {
  m.object.updateMatrixWorld(true);
  const mesh = m.mesh, g = mesh.geometry, si = g.attributes.skinIndex, idx = mesh.skeleton.bones.findIndex((b) => b.name === name);
  const v = new THREE.Vector3(), box = new THREE.Box3();
  for (let i = 0; i < si.count; i++) {
    if (si.getX(i) !== idx) continue;
    v.fromBufferAttribute(g.attributes.position, i);
    mesh.applyBoneTransform(i, v);
    box.expandByPoint(v);
  }
  return box.isEmpty() ? 0 : box.getSize(new THREE.Vector3()).length();
}

for (const [label, build] of [
  ['A321', () => createAircraft({ def: designDef(withTanks('a321neo')) })],
  ['787-9', () => createWidebody(B787_9, { def: designDef(withTanks('b787-9')) })],
]) {
  // v0.5.6: dropped in flight they fall away first (engine-model.js podDropper, on the sim time the model passes).
  test(`${label}: dropped in flight, the wing tanks and their pylons fall away, then leave the model; they come back without the flag`, () => {
    const m = build(), pods = podBones(m);
    assert.equal(pods.length, 2, 'two tanks (the part mirrored)');
    m.update({ t: 100 });
    for (const p of pods) assert.equal(p.scale.x, 1);
    const carried = posedSpread(m, pods[0].name), c0 = posedCentre(m, pods[0].name);
    assert.ok(carried > 3, `a tank carried is ${carried.toFixed(2)} m across`);
    m.update({ tanksDropped: true, t: 100.02 });
    m.update({ tanksDropped: true, t: 101.02 });
    const c1 = posedCentre(m, pods[0].name);
    assert.ok(c0.y - c1.y > 4 && c1.z - c0.z > 3, `a second after the drop: ${(c0.y - c1.y).toFixed(2)} m down, ${(c1.z - c0.z).toFixed(2)} m aft`);
    for (const p of pods) assert.equal(p.scale.x, 1, 'drawn while it falls');
    m.update({ tanksDropped: true, t: 104 });
    for (const p of pods) assert.deepEqual(p.scale.toArray(), [0, 0, 0]);
    assert.ok(posedSpread(m, pods[0].name) < 1e-9, 'gone: drawn as a point');
    m.update({ tanksDropped: false, t: 90 });
    for (const p of pods) assert.equal(p.scale.x, 1);
    assert.ok(posedCentre(m, pods[0].name).distanceTo(c0) < 1e-6, 'a rewind past the drop: back where it hung');
    m.update({ tanksDropped: true, t: 400 });
    for (const p of pods) assert.deepEqual(p.scale.toArray(), [0, 0, 0], 'a jump in time: gone at once');
    m.update({ t: 400.02 });
    for (const p of pods) assert.equal(p.scale.x, 1, 'missing is carried');
  });

  test(`${label}: a flight loaded with the wing tanks gone shows none`, () => {
    const m = build(), pods = podBones(m);
    m.update({ tanksDropped: true, t: 500 });
    for (const p of pods) assert.deepEqual(p.scale.toArray(), [0, 0, 0]);
  });
}

test('a model without tanks takes { tanksDropped: true } and changes nothing', () => {
  for (const m of [createAircraft(), createWidebody(B787_9)]) {
    assert.equal(podBones(m).length, 0);
    m.update({ tanksDropped: true });
  }
});

// The A321's inner flap on a design's airframe: its leading edge behind the main gear's leg (r 0.15) across the leg's
// span, as the base's is (0.38 m behind its axis), with less sweep and a shorter chord too. (v0.5.6: the leg follows
// the wing, geo.GEAR, so the flap keeps most of its depth: tests/gear-follows-wing.test.mjs.)
const W = (o = {}) => ({ span: 1, chord: 1, sweep: 0, dihedral: 5.1, ...o });
const design = (af) => {
  const wl = W(af.wingL), wr = af.wingR ? W(af.wingR) : wl;
  return { ...newDesign('a321neo'), airframe: { ...defaultAirframe('a321neo'), ...af, wingL: wl, wingR: wr, mirror: !af.wingR } };
};
function flapFront(ac, bone, yLeg) {
  // the flap's front (its nose's most forward x) at each of its sections, then along the straight run between them
  const g = ac.mesh.geometry, p = g.attributes.position, si = g.attributes.skinIndex;
  const idx = ac.mesh.skeleton.bones.findIndex((b) => b.name === bone), rows = new Map();
  for (let i = 0; i < p.count; i++) {
    if (si.getX(i) !== idx) continue;
    const x = -p.getZ(i), y = Math.abs(-p.getX(i)), k = Math.round(y * 20);   // model → body frame; stations 5 cm apart
    const r = rows.get(k) || { y: 0, n: 0, x: -Infinity, a: Infinity };
    r.y += y; r.n++; r.x = Math.max(r.x, x); r.a = Math.min(r.a, x); rows.set(k, r);
  }
  const st = [...rows.values()].map((r) => ({ y: r.y / r.n, x: r.x, a: r.a })).sort((a, b) => a.y - b.y);
  const out = [];
  for (const y of [yLeg - 0.15, yLeg, yLeg + 0.15]) {
    const i = st.findIndex((q, j) => j + 1 < st.length && y >= q.y && y <= st[j + 1].y);
    assert.ok(i >= 0, 'the leg is within the flap\'s span');
    const a = st[i], b = st[i + 1], u = (y - a.y) / (b.y - a.y);
    out.push({ y, front: a.x + (b.x - a.x) * u, aft: a.a + (b.a - a.a) * u });
  }
  return out;
}
for (const af of [
  { wingL: { chord: 0.8, sweep: -8 } },
  { wingL: { chord: 1, sweep: -8 } },
  { wingL: { span: 0.8, chord: 1.3, sweep: -8, dihedral: -3 } },
  { wingL: { span: 1.3, chord: 0.8, sweep: 8, dihedral: 8 } },
  { wingL: { span: 1.3 }, wingR: { span: 0.8, chord: 0.8, sweep: -8, dihedral: 0 } },
]) {
  test(`A321 ${JSON.stringify(af)}: the inner flaps are behind the main gear's legs`, () => {
    const def = designDef(design(af)), ac = createAircraft({ def }), G = def.geo.GEAR;
    for (const [S, leg] of [['L', G.left], ['R', G.right]]) {
      const back = leg.x - 0.15;
      for (const { y, front, aft } of flapFront(ac, 'flapIn' + S, Math.abs(leg.y))) {
        // where the wing's trailing edge itself comes up to the leg there's no room behind it: the flap is a strip there
        if (aft > back - 0.2) assert.ok(front - aft < 0.1, `flapIn${S} at ${y.toFixed(2)}: ${(front - aft).toFixed(3)} m deep, its trailing edge at ${aft.toFixed(3)}`);
        else assert.ok(front < back - 0.03, `flapIn${S} at ${y.toFixed(2)}: its front at ${front.toFixed(3)}, the leg's back at ${back.toFixed(3)}`);
      }
    }
  });
}
