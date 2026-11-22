// v0.7.4, Shane's item 12: the volumes under the master (Warnings, Callouts, Engines, Airframe and ground), each 0 to
// 100 % of it. Each bus's gain follows its slider (read from the graph by synth.levels(): headless runs are muted);
// at 100 % every bus is exactly 1, so the mix is what it was. The voice's level scales each utterance.
// (Saved and restored with the settings: tests/browser-v074-sound.mjs, in the page.)
//
//   node --test games/flight-sim/tests/v074-sound-volumes.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSynth, MIX_KINDS } from '../src/audio/synth.js';
import { createCallouts } from '../src/audio/callouts.js';

function mockContext() {
  const conns = new Map();   // node → what it connects to
  const P = (v = 0) => ({ value: v, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  let id = 0;
  const node = (kind) => () => {
    const n = { kind, id: id++, connect(to) { conns.set(n, [...(conns.get(n) || []), to]); return to; }, disconnect() {}, start() {}, stop() {}, setPeriodicWave() {},
      gain: P(), frequency: P(), detune: P(), Q: P(), pan: P(), threshold: P(), knee: P(), ratio: P(), attack: P(), release: P(), playbackRate: P(1) };
    return n;
  };
  const ctx = {
    currentTime: 0, sampleRate: 8000, state: 'running', destination: {},
    createBuffer: (c, l, sr) => { const d = new Float32Array(l); return { getChannelData: () => d, duration: l / sr }; },
    createPeriodicWave: () => ({}),
  };
  for (const k of ['createBufferSource', 'createOscillator', 'createGain', 'createBiquadFilter', 'createStereoPanner', 'createDynamicsCompressor']) ctx[k] = node(k);
  return { ctx, conns };
}
const state = () => ({ t: 0, ias: 150, gs: 150, vs: 0, onGround: false, gearPos: 0, flapDeg: 0, slatDeg: 0, engines: [{ n1: 80 }, { n1: 80 }], warnings: {} });
async function rig() {
  const m = mockContext();
  const synth = createSynth({ context: m.ctx });
  await synth.start();
  const s = state();
  const run = (n = 10) => { for (let i = 0; i < n; i++) { m.ctx.currentTime += 1 / 60; s.t += 1 / 60; synth.update(s, { inside: true }); } };
  run();
  return { ...m, synth, s, run };
}

test('at 100 % (and untouched) every bus is a gain of exactly 1: the mix as it was', async () => {
  const { synth } = await rig();
  assert.deepEqual(MIX_KINDS, ['warnings', 'engines', 'frame']);
  assert.deepEqual(synth.volumes, { warnings: 1, engines: 1, frame: 1 });
  const L = synth.levels();
  assert.equal(L.warnings, 1); assert.equal(L.engines, 1); assert.equal(L.frame, 1);
  synth.setVolumes({ warnings: 1, engines: 1, frame: 1 });
  const L2 = synth.levels();
  assert.equal(L2.warnings, 1); assert.equal(L2.engines, 1); assert.equal(L2.frame, 1);
});

test('each bus\'s gain follows its slider, and only its own', async () => {
  const { synth, run } = await rig();
  synth.setVolumes({ engines: 0.3 });
  assert.equal(synth.levels().engines, 0.3);
  assert.equal(synth.levels().frame, 1); assert.equal(synth.levels().warnings, 1);
  synth.setVolumes({ frame: 0.55 });
  assert.equal(synth.levels().frame, 0.55); assert.equal(synth.levels().engines, 0.3);
  synth.setVolumes({ warnings: 0.4 });
  run();
  assert.equal(synth.levels().warnings, 0.4);
  synth.setVolumes({ warnings: 0 });
  run();
  assert.equal(synth.levels().warnings, 0);
  // Out of range and junk: clamped, or left as it was.
  synth.setVolumes({ engines: 2, frame: -1 });
  assert.equal(synth.levels().engines, 1); assert.equal(synth.levels().frame, 0);
  synth.setVolumes({ engines: 'x' });
  assert.equal(synth.levels().engines, 1);
});

test('the warnings\' volume multiplies the bus\'s own level (paused 0, time compression 0.25, more engines louder)', async () => {
  const { synth, s, ctx } = await rig();
  synth.setVolumes({ warnings: 0.5 });
  synth.update(s, { inside: true, timeScale: 4 }); ctx.currentTime += 0.02;
  assert.equal(synth.levels().warnings, 0.125);
  synth.update(s, { inside: true, paused: true });
  assert.equal(synth.levels().warnings, 0);
  synth.setType({ engineCount: 4 });
  synth.update({ ...s, engines: [{ n1: 80 }, { n1: 80 }, { n1: 80 }, { n1: 80 }] }, { inside: true });
  assert.ok(Math.abs(synth.levels().warnings - 0.5 * Math.SQRT2) < 1e-12);
});

test('volumes set before the sound starts are built in', async () => {
  const m = mockContext();
  const synth = createSynth({ context: m.ctx });
  synth.setVolumes({ engines: 0.2, frame: 0.7 });
  await synth.start();
  assert.equal(synth.levels().engines, 0.2);
  assert.equal(synth.levels().frame, 0.7);
});

test('the engines go through their own bus, the airframe\'s sources through theirs, both into worldBus', async () => {
  const { synth, conns } = await rig();
  // Find the buses by what the graph connects: worldBus → the muffle; engineBus and frameBus → worldBus.
  const all = [...conns.keys()];
  const into = (target) => all.filter((n) => conns.get(n).includes(target));
  const muffle = all.find((n) => n.kind === 'createBiquadFilter' && into(n).length === 1 && conns.get(n).length === 1 && into(n)[0].kind === 'createGain' && into(into(n)[0]).length >= 2);
  assert.ok(muffle, 'the muffle');
  const world = into(muffle)[0];
  const buses = into(world);
  assert.equal(buses.length, 2, 'two buses feed worldBus (engines, airframe), nothing else');
  const panners = all.filter((n) => n.kind === 'createStereoPanner');
  assert.equal(panners.length, 2);
  const engineBus = conns.get(panners[0])[0];
  assert.ok(buses.includes(engineBus) && panners.every((p) => conns.get(p)[0] === engineBus), 'both engines into the engines\' bus');
  const frameBus = buses.find((b) => b !== engineBus);
  // the wind, spoilers, rolling, gear, flaps, packs, brake rumble and squeal, the clunk's two, the thump's two, the tyre squeal
  assert.equal(into(frameBus).length, 13, `${into(frameBus).length} airframe sources`);
  assert.ok(synth.levels());
});

test('the voice: Callouts\' level scales each utterance, and 0 says nothing aloud (the calls are still recorded)', () => {
  const spoken = [];
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  globalThis.speechSynthesis = { getVoices: () => [], speak: (u) => spoken.push(u), cancel() {}, addEventListener() {} };
  try {
    const c = createCallouts();
    c.say('one');
    c.volume = 0.5; c.level = 0.6; c.say('two');
    c.level = 0; c.say('three');
    c.level = 'junk'; assert.equal(c.level, 1);
    assert.deepEqual(spoken.map((u) => u.text), ['one', 'two']);
    assert.ok(Math.abs(spoken[0].volume - 0.9) < 1e-12);
    assert.ok(Math.abs(spoken[1].volume - 0.9 * 0.5 * 0.6) < 1e-12);
    assert.deepEqual(c.heard, ['one', 'two', 'three']);
  } finally { delete globalThis.SpeechSynthesisUtterance; delete globalThis.speechSynthesis; }
});
