// v0.7.4, Shane's item 12: the left panel's SILENCE button. Pressed, every warning sounding at that moment goes quiet
// (the overspeed chime, the stall cricket and tone, the AP disconnect's cavalry charge, the windshear siren, and the
// voice's ground-proximity and windshear calls); a silenced warning sounds again when its condition ends and comes
// back; any other warning sounds as usual. synth.js and callouts.js against mocks (as tests/audio-synth.test.mjs).
//
//   node --test games/flight-sim/tests/v074-sound-silence.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSynth } from '../src/audio/synth.js';
import { createCallouts } from '../src/audio/callouts.js';
import { createSilencer } from '../src/audio/silence.js';

// A mock AudioContext that counts the ramps (pluck() is the only user of linearRampToValueAtTime: the chime, and the
// clunks and thumps, which a steady flight doesn't make).
function mockContext() {
  const stats = { ramps: 0 };
  const P = (v = 0) => ({ value: v, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() { stats.ramps++; }, cancelScheduledValues() {} });
  const node = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, setPeriodicWave() {}, gain: P(), frequency: P(), detune: P(), Q: P(), pan: P(), threshold: P(), knee: P(), ratio: P(), attack: P(), release: P(), playbackRate: P(1) });
  const ctx = {
    currentTime: 0, sampleRate: 8000, state: 'running', destination: {},
    createBuffer: (c, l, sr) => { const d = new Float32Array(l); return { getChannelData: () => d, duration: l / sr }; },
    createPeriodicWave: () => ({}),
  };
  for (const k of ['createBufferSource', 'createOscillator', 'createGain', 'createBiquadFilter', 'createStereoPanner', 'createDynamicsCompressor']) ctx[k] = node;
  return { ctx, stats };
}
const cruise = (warnings) => ({ t: 0, ias: 150, gs: 150, vs: 0, onGround: false, gearPos: 0, flapDeg: 0, slatDeg: 0, engines: [{ n1: 80 }, { n1: 80 }], warnings });
async function rig(def) {
  const m = mockContext();
  const synth = createSynth({ context: m.ctx });
  if (def) synth.setType(def);
  await synth.start();
  const s = cruise({});
  const run = (sec) => { for (let i = 0; i < sec * 60; i++) { m.ctx.currentTime += 1 / 60; s.t += 1 / 60; synth.update(s, { inside: true }); } };
  return { ...m, synth, s, run };
}

test('silence.js: a press silences what sounds now; it sounds again when its condition ends and comes back', () => {
  const h = createSilencer();
  assert.equal(h.press({ a: true, b: false }), 1);
  assert.ok(h.any && h.has('a') && !h.has('b'));
  assert.equal(h.allow(true, 'a'), false, 'held: silent');
  assert.equal(h.allow(true, 'b'), true, 'another: heard');
  assert.equal(h.allow(false, 'a'), false, 'ended');
  assert.ok(!h.any, 'the silence is lifted when it ends');
  assert.equal(h.allow(true, 'a'), true, 'back: heard again');
  h.press({ a: true }); h.reset(); assert.ok(!h.any);
});

test('synth: the overspeed chime stops at the press, stays off while overspeed holds, and chimes again when it comes back', async () => {
  const { synth, s, run, stats } = await rig();
  s.warnings = { overspeed: true };
  run(1);
  assert.ok(stats.ramps > 0, 'chiming');
  assert.equal(synth.sounding.overspeed, true);
  assert.equal(synth.silenced, false);
  assert.equal(synth.silenceWarnings(), 1);
  assert.equal(synth.silenced, true, 'the button lit');
  const at = stats.ramps;
  run(3);
  assert.equal(stats.ramps, at, 'no chime while it holds');
  assert.equal(synth.sounding.overspeed, false);
  s.warnings = {};
  run(0.5);
  assert.equal(synth.silenced, false, 'unlit once the overspeed ends');
  s.warnings = { overspeed: true };
  run(1);
  assert.ok(stats.ramps > at, 'chimes again when it comes back');
  assert.equal(synth.sounding.overspeed, true);
});

test('synth: a warning that comes on after the press sounds as usual; the silenced one stays quiet', async () => {
  const { synth, s, run } = await rig();
  s.warnings = { overspeed: true };
  run(0.5);
  synth.silenceWarnings();
  s.warnings = { overspeed: true, stall: true };
  run(1);
  assert.equal(synth.sounding.stall, true, 'the stall warning, new, sounds');
  assert.equal(synth.sounding.overspeed, false, 'the overspeed, silenced, stays quiet');
  // A second press silences the stall too.
  assert.equal(synth.silenceWarnings(), 1);
  run(0.5);
  assert.equal(synth.sounding.stall, false);
});

test('synth: the cavalry charge stops at the press and plays again on the next disconnect; pressing after it ended silences nothing', async () => {
  const { synth, s, run } = await rig();
  s.warnings = { apDisc: true };
  run(0.5);
  assert.equal(synth.sounding.apDisc, true);
  synth.silenceWarnings();
  run(0.5);
  assert.equal(synth.sounding.apDisc, false);
  s.warnings = {};
  run(0.2);
  assert.equal(synth.silenced, false);
  s.warnings = { apDisc: true };
  run(0.5);
  assert.equal(synth.sounding.apDisc, true, 'a new disconnect: the charge again');
  run(6);   // its three phrases (4.5 s) are over while the warning stays on
  assert.equal(synth.sounding.apDisc, false);
  assert.equal(synth.silenceWarnings(), 0, 'nothing sounding: nothing silenced');
  assert.equal(synth.silenced, false, 'unlit');
});

test('synth: a Boeing\'s windshear siren is silenced and comes back with the next windshear', async () => {
  const { synth, s, run } = await rig({ family: 'boeing', engineCount: 2 });
  synth.setWeather({ wind: { gustKt: 0 } });
  s.warnings = { windshear: true };
  run(0.5);
  assert.equal(synth.sounding.windshear, true);
  synth.silenceWarnings();
  run(1);
  assert.equal(synth.sounding.windshear, false);
  s.warnings = {}; run(0.2);
  s.warnings = { windshear: true }; run(0.2);
  assert.equal(synth.sounding.windshear, true);
});

test('callouts: the ground-proximity calls stop at the press, other calls go on, and they sound again when the condition comes back', () => {
  const c = createCallouts();
  const s = { agl: 300, vs: -10, onGround: false, thrustLever: 0, gs: 70, warnings: { sinkRate: true } };
  let now = 0;
  const run = (sec) => { for (let i = 0; i < sec * 20; i++) { now += 0.05; c.update(s, now); } };
  run(6);
  const said = () => c.heard.filter((t) => t === 'sink rate').length;
  assert.ok(said() >= 2, `${said()} sink rate`);
  assert.equal(c.sounding.sinkRate, true);
  assert.equal(c.silenceWarnings(), 1);
  assert.equal(c.silenced, true);
  const n = said();
  run(6);
  assert.equal(said(), n, 'no "sink rate" while it holds');
  // A new warning sounds as usual.
  s.warnings = { sinkRate: true, pullUp: true };
  run(3);
  assert.ok(c.heard.includes('pull up'), 'pull up, new, is said');
  assert.equal(said(), n, 'still no "sink rate"');
  // The sink rate ends and comes back: said again.
  s.warnings = { pullUp: true }; run(1);
  s.warnings = { sinkRate: true }; run(3);
  assert.ok(said() > n, 'said again');
  // The height calls aren't warnings: they go on.
  c.silenceWarnings();
  s.warnings = {}; s.agl = 120 / 3.28084; run(0.1);
  s.agl = 95 / 3.28084; run(0.1);
  assert.equal(c.heard[c.heard.length - 1], 'one hundred');
});
