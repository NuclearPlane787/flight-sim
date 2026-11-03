// synth.js against a mock AudioContext: builds once, update() creates no nodes, never sets a
// non-finite parameter, survives a sparse state, and is cheap. (The real sound is measured
// in Chrome by tests/audio-render.mjs.)
//
//   node --test games/flight-sim/tests/audio-synth.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSynth } from '../src/audio/synth.js';

function mockContext() {
  const stats = { nodes: 0, bad: 0, calls: 0 };
  const P = (v = 0) => {
    const chk = (x) => { stats.calls++; if (!Number.isFinite(x)) stats.bad++; };
    return { value: v, setTargetAtTime: chk, setValueAtTime: chk, linearRampToValueAtTime: chk, cancelScheduledValues() {} };
  };
  const node = () => {
    stats.nodes++;
    return { connect() {}, start() {}, setPeriodicWave() {}, gain: P(), frequency: P(), detune: P(), Q: P(), pan: P(), threshold: P(), knee: P(), ratio: P(), attack: P(), release: P() };
  };
  const ctx = {
    currentTime: 0, sampleRate: 48000, state: 'running', destination: {},
    createBuffer: (c, l, sr) => { const d = new Float32Array(l); return { getChannelData: () => d, duration: l / sr }; },
    createPeriodicWave: () => ({}),   // v0.2.2: the engines' fan and buzz-saw waveforms
  };
  for (const k of ['createBufferSource', 'createOscillator', 'createGain', 'createBiquadFilter', 'createStereoPanner', 'createDynamicsCompressor']) ctx[k] = node;
  return { ctx, stats };
}

const flight = () => ({
  t: 0, ias: 70, gs: 70, vs: -2, onGround: false, gearPos: 0, flapDeg: 40, slatDeg: 27, speedbrake: 0, groundSpoilers: 1,
  brakes: { left: 1, right: 1 }, engines: [{ n1: 30, rev: 0 }, { n1: 30, rev: 0 }],
  warnings: { apDisc: true, overspeed: true, stall: true },
});

test('update() makes no nodes and sets only finite values', async () => {
  const { ctx, stats } = mockContext();
  const synth = createSynth({ context: ctx });
  assert.equal(await synth.start(), true);
  const built = stats.nodes;
  assert.ok(built > 40, `built ${built} nodes`);
  const s = flight();
  const o = { inside: true, timeScale: 1, paused: false };
  for (let i = 0; i < 2000; i++) {
    ctx.currentTime += 1 / 60; s.t += 1 / 60;
    s.onGround = i > 100; s.gearPos = Math.min(1, i / 600); s.engines[0].rev = s.engines[1].rev = i > 300 ? Math.min(1, (i - 300) / 60) : 0;
    o.inside = i % 200 < 100; o.timeScale = i > 1500 ? 4 : 1; o.paused = i > 1800;
    synth.update(s, o);
  }
  assert.equal(stats.nodes, built, 'no nodes made during updates');
  assert.equal(stats.bad, 0, 'no non-finite parameter values');
});

test('update() copes with a sparse state and no options', async () => {
  const { ctx, stats } = mockContext();
  const synth = createSynth({ context: ctx });
  await synth.start();
  for (let i = 0; i < 10; i++) { ctx.currentTime += 0.016; synth.update({ t: i }); }
  synth.update(null);
  assert.equal(stats.bad, 0);
});

test('update() is cheap (mock context: < 0.05 ms per call)', async () => {
  const { ctx } = mockContext();
  const synth = createSynth({ context: ctx });
  await synth.start();
  const s = flight(), o = { inside: false, timeScale: 1, paused: false };
  const N = 20000, t0 = performance.now();
  for (let i = 0; i < N; i++) { ctx.currentTime += 1 / 60; s.t += 1 / 60; synth.update(s, o); }
  const ms = (performance.now() - t0) / N;
  assert.ok(ms < 0.05, `${ms.toFixed(4)} ms per update`);
});
