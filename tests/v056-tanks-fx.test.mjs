// v0.5.6: the wing tanks' drop, seen and heard: the pods fall away (engine-model.js podDropper), the synth's release
// clunk once on the flag's change (synth.js), the engine screens' "WING TANKS DROPPED" line for 20 s of sim time
// (engine-row.js dropMemo, engines-panel.js, boeing/eicas.js), and each engine's lever ring from its own lever's N1
// (state.engines[i].leverN1, engine-row.js ringN1).
//   node --test games/flight-sim/tests/v056-tanks-fx.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const THREE = await import('../vendor/three.module.js');
const { podDropper, FALL } = await import('../src/engine-model.js');
const { toModel } = await import('../src/aircraft.js');
const { dropMemo, ringN1, DROP_MEMO } = await import('../src/ui/engine-row.js');
const { createSynth } = await import('../src/audio/synth.js');
const { createEnginesPanel } = await import('../src/ui/engines-panel.js');
const { createEicas } = await import('../src/ui/boeing/eicas.js');

// ---- The fall ----

// Two pod bones as addPod() makes them (under the root, at rest where the tank hangs), and a wing bone that isn't one.
function podBones() {
  const B = {};
  for (const [name, x, y, z] of [['pod0', -2, 9, -1.5], ['pod1', -2, -9, -1.5], ['flapL', -4, 6, 0]]) {
    const bn = new THREE.Bone();
    bn.name = name;
    bn.position.copy(toModel(x, y, z));
    bn.userData.rest = bn.position.clone();
    B[name] = bn;
  }
  return B;
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const atRest = (bn) => bn.position.distanceTo(bn.userData.rest) < 1e-12 && Math.abs(bn.quaternion.w - 1) < 1e-12 && bn.scale.x === 1;

test('dropped in flight, the tanks fall away aft and down, tumbling nose down, then hide; a rewind past it brings them back', () => {
  const B = podBones(), drop = podDropper(B), pods = [B.pod0, B.pod1];
  drop(false, 100); drop(false, 100.02);
  for (const p of pods) assert.ok(atRest(p), 'carried');
  drop(true, 100.04);                                  // the drop: the fall starts here
  for (const p of pods) assert.ok(atRest(p) && p.scale.x === 1, 'at the moment it drops');
  drop(true, 101.04);                                  // 1 s on
  const k = 0.5 * 1 * 1;
  for (const p of pods) {
    const d = p.position.clone().sub(p.userData.rest);
    const exp = toModel(-FALL.dragMs2 * k, 0, -FALL.g * k);
    assert.ok(d.distanceTo(exp) < 1e-9, `1 s: ${d.toArray().map((v) => v.toFixed(3))} (aft ${(FALL.dragMs2 * k).toFixed(2)} m, down ${(FALL.g * k).toFixed(2)} m)`);
    assert.equal(p.scale.x, 1, 'still drawn while it falls');
    // Nose down: the tank's nose (forward, geometry +x) turned towards the ground (geometry −z).
    const nose = toModel(1, 0, 0).applyQuaternion(p.quaternion);
    assert.ok(nose.y < -0.25, `nose down ${nose.y.toFixed(3)}`);
  }
  assert.ok(atRest(B.flapL), 'only the pods move');
  drop(true, 100.04 + FALL.hideS + 0.01);
  for (const p of pods) assert.equal(p.scale.x, 0, 'hidden after the fall');
  drop(true, 120);
  for (const p of pods) assert.equal(p.scale.x, 0, 'and stays hidden');
  drop(false, 90);                                      // a rewind to before the drop
  for (const p of pods) assert.ok(atRest(p), 'back at once, as they were');
});

test('a flight first seen with the tanks gone, or a jump in time, hides them at once; missing is carried', () => {
  let B = podBones(), drop = podDropper(B);
  drop(true, 500);                                      // a saved flight loaded with them dropped
  for (const p of [B.pod0, B.pod1]) assert.equal(p.scale.x, 0);
  B = podBones(); drop = podDropper(B);
  drop(false, 10); drop(true, 400);                     // another flight loaded (the model kept), already dropped
  for (const p of [B.pod0, B.pod1]) assert.equal(p.scale.x, 0);
  B = podBones(); drop = podDropper(B);
  drop(false, 10); drop(true, 10.02); drop(true, 10.5);
  assert.equal(B.pod0.scale.x, 1, 'falling');
  drop(true, -20);                                      // a rewind into the fall's past, still dropped
  for (const p of [B.pod0, B.pod1]) assert.equal(p.scale.x, 0);
  drop(undefined, -19.98);
  for (const p of [B.pod0, B.pod1]) assert.ok(atRest(p), 'missing is carried');
  // Paused when dropped (the Weight tab's button with the HUD's Pause on): the fall waits for the clock.
  B = podBones(); drop = podDropper(B);
  drop(false, 50); drop(true, 50); drop(true, 50); drop(true, 50);
  assert.ok(atRest(B.pod0), 'paused: no time, no fall yet');
  drop(true, 51);
  assert.ok(B.pod0.position.distanceTo(B.pod0.userData.rest) > 4, 'resumed: it falls');
  // Without a time the page's clock stands in, and nothing throws.
  B = podBones(); drop = podDropper(B);
  drop(false); drop(true); drop(true);
  assert.equal(B.pod0.scale.x, 1);
  // A model without tanks.
  const none = podDropper({ root: new THREE.Bone() });
  none(true, 1); none(false, 2);
});

// ---- The release clunk ----

// synth.js against a mock AudioContext (as tests/audio-synth.test.mjs), counting the plucks: each pluck() ramps a gain
// up once with linearRampToValueAtTime.
function mockContext() {
  const stats = { ramps: 0 };
  const P = (v = 0) => ({ value: v, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() { stats.ramps++; }, cancelScheduledValues() {} });
  const node = () => ({ connect() {}, start() {}, stop() {}, setPeriodicWave() {}, gain: P(), frequency: P(), detune: P(), Q: P(), pan: P(), threshold: P(), knee: P(), ratio: P(), attack: P(), release: P() });
  const ctx = {
    currentTime: 0, sampleRate: 48000, state: 'running', destination: {},
    createBuffer: (c, l, sr) => { const d = new Float32Array(l); return { getChannelData: () => d, duration: l / sr }; },
    createPeriodicWave: () => ({}),
  };
  for (const k of ['createBufferSource', 'createOscillator', 'createGain', 'createBiquadFilter', 'createStereoPanner', 'createDynamicsCompressor']) ctx[k] = node;
  return { ctx, stats };
}
const cruise = (t, dropped) => ({
  t, ias: 140, gs: 140, vs: 0, onGround: false, gearPos: 0, flapDeg: 0, slatDeg: 0, speedbrake: 0, groundSpoilers: 0,
  brakes: { left: 0, right: 0 }, engines: [{ n1: 80, rev: 0 }, { n1: 80, rev: 0 }], warnings: {},
  ...(dropped === undefined ? {} : { tanksDropped: dropped }),
});
async function synthWith() {
  const m = mockContext(), synth = createSynth({ context: m.ctx });
  assert.equal(await synth.start(), true);
  // Each update's plucks: the count it adds.
  const step = (s, opts) => { const r0 = m.stats.ramps; m.ctx.currentTime += 0.016; synth.update(s, opts); return m.stats.ramps - r0; };
  return step;
}

test('the synth clunks once when the tanks let go in flight; not on a load, a jump or while paused', async () => {
  let step = await synthWith();
  const base = [step(cruise(10, false)), step(cruise(10.02, false)), step(cruise(10.04, false))];
  assert.ok(base.every((x) => x === base[1]), `steady cruise plucks the same each update: ${base}`);
  const b = base[1];
  assert.equal(step(cruise(10.06, true)) - b, 3, 'the drop: a clunk, its noise and a thump');
  assert.equal(step(cruise(10.08, true)) - b, 0, 'once');
  assert.equal(step(cruise(10.1, false)) - b, 0, 'a rewind past it: silent');
  assert.equal(step(cruise(10.12, true)) - b, 3, 'and dropped again: heard again');

  step = await synthWith();
  assert.equal(step(cruise(400, true)), base[0], 'a flight loaded with the tanks gone: no clunk');
  step = await synthWith();
  step(cruise(10, false));
  assert.equal(step(cruise(300, true)), b, 'a jump in time (another flight loaded): no clunk');
  step = await synthWith();
  step(cruise(10, false)); step(cruise(10.02, false));
  assert.equal(step(cruise(10.02, true), { paused: true }) - step(cruise(10.02, true), { paused: true }), 0, 'paused: nothing yet');
  assert.equal(step(cruise(10.04, true)) - b, 3, 'resumed: the clunk');
  step = await synthWith();
  step(cruise(10)); step(cruise(10.02));
  assert.equal(step(cruise(10.04)), b, 'no flag (a type without tanks): nothing');
});

// ---- The memo ----

test('dropMemo(): 20 s of sim time from the drop; not for a flight seen dropped, a jump or a rewind past it', () => {
  let m = dropMemo(20);
  assert.equal(m({ t: 0, tanksDropped: false }), false);
  const shown = [];
  for (let t = 0.02; t < 25; t += 0.5) shown.push([+(t).toFixed(2), m({ t, tanksDropped: true })]);
  for (const [t, on] of shown) assert.equal(on, t - 0.02 <= 20 + 1e-9, `t ${t}: ${on}`);
  assert.equal(m({ t: 25.5, tanksDropped: false }), false, 'gone once the flag is');
  // Paused: the clock stands still and so does the line.
  m = dropMemo(20);
  m({ t: 5, tanksDropped: false });
  for (let k = 0; k < 50; k++) assert.equal(m({ t: 5, tanksDropped: true }), true);
  // Seen first dropped (a flight loaded), or after a jump in time: nothing.
  m = dropMemo(20);
  assert.equal(m({ t: 300, tanksDropped: true }), false);
  m = dropMemo(20);
  m({ t: 10, tanksDropped: false });
  assert.equal(m({ t: 300, tanksDropped: true }), false);
  // A rewind to before the drop clears it; dropped again, it shows again.
  m = dropMemo(20);
  m({ t: 10, tanksDropped: false }); assert.equal(m({ t: 10.02, tanksDropped: true }), true);
  assert.equal(m({ t: -20, tanksDropped: false }), false);
  assert.equal(m({ t: -19.98, tanksDropped: true }), true);
  // No time in the state: never.
  m = dropMemo(20);
  m({ tanksDropped: false }); assert.equal(m({ tanksDropped: true }), false);
});

// ---- The screens ----

// A 2D context that draws nothing and remembers the text and the circles.
function mockCv(w = 600) {
  const rec = { text: [], arcs: [] };
  let fontPx = 10;
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'fillText') return (s) => rec.text.push(String(s));
      if (k === 'arc') return (x, y, r, a0, a1) => rec.arcs.push({ x, y, r, full: Math.abs(a1 - a0 - Math.PI * 2) < 1e-9 && a0 === 0 });
      if (k === 'measureText') return (s) => ({ width: String(s).length * fontPx * 0.6 });
      return () => {};
    },
    set(t, k, v) {
      if (k === 'font') { const m = /([\d.]+)px/.exec(v); if (m) fontPx = +m[1]; }
      t[k] = v; return true;
    },
  });
  return { cv: { ctx, w, h: 0.62 * w, begin() { rec.text.length = 0; rec.arcs.length = 0; } }, rec };
}
const panelState = (o = {}) => ({
  t: 10, engines: [{ n1: 50 }, { n1: 50 }], leverN1: 60, thrustLever: 0.3, fuelKg: 9000, fuel: { left: 3000, right: 3000, center: 3000 },
  mass: 70000, cgMac: 0.28, gearPos: 1, flapDeg: 0, slatDeg: 0, config: '0', brakes: {}, surfaces: {}, pos: { z: 1000 }, mach: 0.3, ...o,
});
// The levers' rings: the small full circles on the dials' side (the A321's flap dots are on the right).
const rings = (rec, w) => rec.arcs.filter((a) => a.full && a.r > 0.004 * w && a.r < 0.0095 * w && a.x < 0.55 * w);

for (const [name, make] of [['A321 engine panel', createEnginesPanel], ['Boeing EICAS', createEicas]]) {
  test(`${name}: each engine's ring at its own lever's N1; together, exactly as one lever's`, () => {
    for (const n of [2, 4]) {
      const { cv, rec } = mockCv(), p = make(cv);
      const eng = (f) => Array.from({ length: n }, (_, i) => ({ n1: 50, ...f(i) }));
      const draw = (st) => { p.draw({ state: panelState(st), controls: {}, ap: {} }); return rings(rec, cv.w).map((a) => [+a.x.toFixed(6), +a.y.toFixed(6)]); };
      const one = draw({ engines: eng(() => ({})), leverN1: 60 });
      assert.equal(one.length, n, `${n} engines: a ring each`);
      const same = draw({ engines: eng(() => ({ leverN1: 60 })), leverN1: 60 });
      assert.deepEqual(same, one, `${n} engines, levers together: unchanged`);
      // Split: the outer engines at 40 %, the inner at 90 %.
      const split = (i) => (i === 0 || i === n - 1 ? 40 : 90);
      const got = draw({ engines: eng((i) => ({ leverN1: split(i) })), leverN1: 60 });
      const at40 = draw({ engines: eng(() => ({})), leverN1: 40 }), at90 = draw({ engines: eng(() => ({})), leverN1: 90 });
      for (let i = 0; i < n; i++) assert.deepEqual(got[i], split(i) === 40 ? at40[i] : at90[i], `${n} engines: engine ${i + 1}'s ring at ${split(i)} %`);
    }
  });

  test(`${name}: "${DROP_MEMO}" for 20 s of sim time after the drop`, () => {
    const { cv, rec } = mockCv(), p = make(cv);
    const has = (st) => { p.draw({ state: panelState(st), controls: {}, ap: {} }); return rec.text.includes(DROP_MEMO); };
    assert.equal(has({ t: 10, tanksDropped: false }), false);
    assert.equal(has({ t: 10.02, tanksDropped: true }), true, 'at the drop');
    let t = 10.02;
    while (t < 29.9) { t += 1; assert.equal(has({ t, tanksDropped: true }), true, `t ${t.toFixed(2)}`); }
    t += 1;
    assert.equal(has({ t, tanksDropped: true }), false, 'gone after 20 s');
    // A panel that first sees a flight with them gone shows nothing.
    const fresh = mockCv(), q = make(fresh.cv);
    q.draw({ state: panelState({ t: 500, tanksDropped: true }), controls: {}, ap: {} });
    assert.equal(fresh.rec.text.includes(DROP_MEMO), false);
  });
}

test('ringN1(): the engine\'s own lever, else the aircraft\'s, else 0', () => {
  assert.equal(ringN1({ engines: [{ leverN1: 70 }], leverN1: 60 }, 0), 70);
  assert.equal(ringN1({ engines: [{}], leverN1: 60 }, 0), 60);
  assert.equal(ringN1({ engines: [{ leverN1: 0 }], leverN1: 60 }, 0), 60);
  assert.equal(ringN1({}, 1), 0);
  assert.equal(ringN1(undefined, 0), 0);
});
