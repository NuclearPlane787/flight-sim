// synth.js's engines for a design (v0.5.0), against a mock AudioContext: as many engines' voices as the
// design has (up to six), panned by each engine's y, a torn-off engine silent, setType() after start()
// adding and taking voices away, and update() still making no nodes and staying cheap. Two engines
// stay the graph they were (tests/audio-weather.test.mjs's trace; tests/audio-render.mjs measures the
// sound, and with --engines its 4 and 6 engines' levels).
//
//   node --test games/flight-sim/tests/audio-engines.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSynth, MAX_ENGINES } from '../src/audio/synth.js';
import { TYPES } from '../src/sim/types.js';
import { designDef, newDesign, normalizeDesign } from '../src/sim/designs.js';

// Records every node, what it connects to, and each parameter's last target.
function mockContext() {
  const all = [];
  const stats = { bad: 0, stopped: 0, disconnected: 0 };
  const P = () => {
    const p = { value: 0, last: 0, cancelScheduledValues() {} };
    p.setTargetAtTime = p.setValueAtTime = p.linearRampToValueAtTime = (v) => { if (!Number.isFinite(v)) stats.bad++; p.last = v; };
    return p;
  };
  const node = (kind) => () => {
    const me = { kind, outs: [], connect(o) { me.outs.push(o); return o; }, disconnect() { stats.disconnected++; me.gone = true; },
      start() {}, stop() { stats.stopped++; }, setPeriodicWave() {} };
    for (const k of ['gain', 'frequency', 'detune', 'Q', 'pan', 'threshold', 'knee', 'ratio', 'attack', 'release', 'playbackRate']) me[k] = P();
    all.push(me);
    return me;
  };
  const ctx = {
    currentTime: 0, sampleRate: 48000, state: 'running', destination: {},
    createBuffer: (c, l, sr) => { const d = new Float32Array(l); return { getChannelData: () => d, duration: l / sr }; },
    createPeriodicWave: () => ({}), createBufferSource: node('src'), createOscillator: node('osc'), createGain: node('gain'),
    createBiquadFilter: node('filter'), createStereoPanner: node('pan'), createDynamicsCompressor: node('dyn'),
  };
  // The engines: each one's panner (the only panners), and the gains feeding it.
  const engines = () => all.filter((x) => x.kind === 'pan' && !x.gone).map((p) => ({ p, gains: all.filter((g) => g.kind === 'gain' && g.outs.includes(p)) }));
  return { ctx, stats, all, engines };
}

const designOf = (base, engine, count) => designDef(normalizeDesign({ ...newDesign(base), engine, count }));
const state = (count, n1 = 80) => ({ t: 0, ias: 80, gs: 80, vs: 0, onGround: true, gearPos: 1, flapDeg: 0, slatDeg: 0, speedbrake: 0, groundSpoilers: 0,
  brakes: { left: 0, right: 0 }, engines: Array.from({ length: count }, () => ({ n1, rev: 0, thrustN: 1e5, off: false })), warnings: {} });
const run = (ctx, synth, s, o, frames) => { for (let i = 0; i < frames; i++) { ctx.currentTime += 1 / 60; s.t += 1 / 60; synth.update(s, o); } };

test('a design has its own engines\' voices: 3, 4 and 6, each a panner with the same voices as a twin\'s', async () => {
  const twin = mockContext();
  const a = createSynth({ context: twin.ctx }); a.setType(TYPES['b777-300er']); await a.start();
  const perEngine = twin.engines()[0].gains.length;
  assert.equal(twin.engines().length, 2);
  for (const count of [3, 4, 6]) {
    const m = mockContext();
    const synth = createSynth({ context: m.ctx });
    synth.setType(designOf('b777-300er', 'ge90-115b', count));
    await synth.start();
    assert.equal(synth.engineCount, count);
    assert.equal(m.engines().length, count);
    assert.ok(m.engines().every((e) => e.gains.length === perEngine), 'every engine the same voices');
  }
  // Each engine costs the same nodes: the difference between 6 and 4 is twice that between 4 and 3.
  const nodes = {};
  for (const count of [2, 3, 4, 6]) {
    const m = mockContext(), synth = createSynth({ context: m.ctx });
    synth.setType(count === 2 ? TYPES['b777-300er'] : designOf('b777-300er', 'ge90-115b', count)); await synth.start(); nodes[count] = m.all.length;
  }
  const one = nodes[3] - nodes[2];
  assert.equal(nodes[4] - nodes[2], 2 * one); assert.equal(nodes[6] - nodes[2], 4 * one);
  assert.ok(one <= 30, `${one} nodes per engine`);
});

test('the engines are panned by their y (engine 1 the left outboard), a tail engine in the middle', async () => {
  for (const count of [3, 4, 6]) {
    const m = mockContext(), synth = createSynth({ context: m.ctx });
    const def = designOf('b777-300er', 'ge90-115b', count);
    synth.setType(def); await synth.start();
    const s = state(count);
    run(m.ctx, synth, s, { inside: false, aft: 0, dist: 100 }, 5);
    const pans = m.engines().map((e) => e.p.pan.last);
    const ys = def.geo.ENGINES.map((e) => e.y), span = Math.max(...ys.map(Math.abs));
    pans.forEach((p, i) => assert.ok(Math.abs(p - (-ys[i] / span) * 0.6) < 1e-12, `engine ${i + 1}: pan ${p}`));
    assert.ok(pans[0] < 0 && pans[count - 1] > 0, 'left to right');
    for (let i = 1; i < count; i++) assert.ok(pans[i] >= pans[i - 1], 'in order across');
    if (count === 3) assert.ok(pans[1] === 0, `tail engine pan ${pans[1]}`);
  }
});

test('every engine at its own N1, a little apart so they beat; a torn-off engine is silent', async () => {
  const m = mockContext(), synth = createSynth({ context: m.ctx });
  synth.setType(designOf('b787-9', 'genx-1b', 6)); await synth.start();
  const s = state(6, 90), o = { inside: false, aft: 0, dist: 100 };
  run(m.ctx, synth, s, o, 5);
  const fanHz = () => m.engines().map((e) => m.all.find((x) => x.kind === 'osc' && x.outs.some((g) => e.gains.some((h) => g.outs?.includes(h)))).frequency.last);
  const hz = fanHz();
  assert.equal(new Set(hz).size, 6, `six different fan frequencies: ${hz.map((f) => f.toFixed(4)).join(' ')}`);
  const lo = Math.min(...hz), hi = Math.max(...hz);
  assert.ok(hi / lo - 1 < 0.006, 'within half a percent of each other');
  const level = (e) => e.gains.reduce((a, g) => a + g.gain.last, 0);
  assert.ok(m.engines().every((e) => level(e) > 0.01));
  s.engines[2].off = true;
  s.engines[4].n1 = 90; s.engines[4].rev = 1;
  run(m.ctx, synth, s, o, 5);
  const E = m.engines();
  assert.equal(level(E[2]), 0, 'engine 3 torn off: silent');
  assert.ok([0, 1, 3, 4, 5].every((i) => level(E[i]) > 0.01), 'the others still heard');
  // An engine missing from the state is silent too.
  s.engines.length = 4;
  run(m.ctx, synth, s, o, 5);
  assert.equal(level(m.engines()[5]), 0);
  assert.equal(m.stats.bad, 0);
});

test('setType() after start(): a twin becomes six engines and back, the extra voices stopped and let go', async () => {
  const m = mockContext(), synth = createSynth({ context: m.ctx });
  synth.setType(TYPES['a321neo']); await synth.start();
  const twinNodes = m.all.length;
  synth.setType(designOf('a321neo', 'ge90-115b', 6));
  assert.equal(m.engines().length, 6);
  const sixNodes = m.all.length;
  const s = state(6), o = { inside: true };
  run(m.ctx, synth, s, o, 30);
  assert.equal(m.all.length, sixNodes, 'no nodes made in update()');
  synth.setType(TYPES['a321neo']);
  assert.equal(synth.engineCount, 2);
  const per = (sixNodes - twinNodes) / 4;
  assert.ok(m.stats.stopped >= 4 * 10, `the four engines' sources stopped (${m.stats.stopped})`);
  s.engines.length = 2;
  run(m.ctx, synth, s, o, 60);   // a second later: reaped
  assert.equal(m.stats.disconnected, 4, 'their four panners disconnected');
  assert.ok(per > 0);
  // And the state's engines grow the voices if setType() wasn't told (never more than six).
  run(m.ctx, synth, state(8), o, 2);
  assert.equal(synth.engineCount, MAX_ENGINES);
  assert.equal(m.stats.bad, 0);
});

test('update() with six engines: no nodes, finite values, cheap (mock context: < 0.05 ms per call)', async () => {
  const m = mockContext(), synth = createSynth({ context: m.ctx });
  synth.setType(designOf('b777-300er', 'ge90-115b', 6)); await synth.start();
  const built = m.all.length;
  const s = state(6), o = { inside: false, timeScale: 1, paused: false, aft: 0.3, dist: 110 };
  const N = 20000, t0 = performance.now();
  for (let i = 0; i < N; i++) {
    m.ctx.currentTime += 1 / 60; s.t += 1 / 60;
    for (const [k, e] of s.engines.entries()) e.n1 = 20 + ((i + 37 * k) % 600) / 8;
    synth.update(s, o);
  }
  const ms = (performance.now() - t0) / N;
  assert.equal(m.all.length, built);
  assert.equal(m.stats.bad, 0);
  assert.ok(ms < 0.05, `${ms.toFixed(4)} ms per update`);
});

// v0.5.2: mixed engine types, each its own voice: a GE90 pair beside an A321's LEAP-1As runs its fan's tones at its
// own shaft frequency (its N1 rpm), its waveforms its own; engines of one type keep the kit's (as before).
test('mixed engines: each type at its own frequencies and with its own waveforms', async () => {
  const { addPart } = await import('../src/sim/designs.js');
  const { GE90_115B } = await import('../src/audio/engine-sounds.js');
  const def = designDef(addPart(newDesign('a321neo'), { kind: 'engine', engine: 'ge90-115b', mount: 'wing', side: 1, s: 10 }));
  assert.equal(def.sounds.length, 4);
  assert.equal(designDef(newDesign('b777-300er', { count: 4 })).sounds, undefined);
  const m = mockContext();
  const waves = [];
  const make = m.ctx.createPeriodicWave;
  m.ctx.createPeriodicWave = (...a) => { const w = make(...a); waves.push(w); return w; };
  const synth = createSynth({ context: m.ctx });
  synth.setType(def); await synth.start();
  const s = state(4, 90), o = { inside: false, aft: 0, dist: 100 };
  run(m.ctx, synth, s, o, 5);
  const fanHz = () => m.engines().map((e) => m.all.find((x) => x.kind === 'osc' && x.outs.some((g) => e.gains.some((h) => g.outs?.includes(h)))).frequency.last);
  const hz = fanHz(), ge = def.sounds.map((x) => x === GE90_115B);
  assert.ok(ge.filter(Boolean).length === 2);
  const geHz = hz.filter((_, i) => ge[i]), leapHz = hz.filter((_, i) => !ge[i]);
  // The GE90's N1 shaft turns slower than the LEAP-1A's at the same N1.
  assert.ok(Math.max(...geHz) < Math.min(...leapHz), `GE90 ${geHz.map((f) => f.toFixed(1))} vs LEAP ${leapHz.map((f) => f.toFixed(1))}`);
  assert.ok(Math.abs(geHz[0] / (90 * GE90_115B.n1Hz) - 1) < 0.01);
  assert.ok(waves.length >= 4, 'the GE90\'s own fan and buzz-saw waveforms made too');
  assert.equal(m.stats.bad, 0);
});
