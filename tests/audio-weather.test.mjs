// synth.js's weather paths (v0.4.0) against a mock AudioContext: null weather makes no nodes at all, the weather's
// nodes come and go with the settings, and thunder clocks by sim time. The measured sound is tests/audio-render.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSynth } from '../src/audio/synth.js';
import { strikesBetween } from '../src/sim/lightning.js';

function mockContext() {
  const stats = { nodes: 0, stopped: 0, started: [] };
  const P = (v = 0) => ({ value: v, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = (kind) => () => {
    stats.nodes++;
    return { kind, connect() { return this; }, disconnect() {}, start(at) { if (kind === 'buffer') stats.started.push(at); }, stop() { stats.stopped++; }, setPeriodicWave() {}, gain: P(), frequency: P(), detune: P(), Q: P(), pan: P(), threshold: P(), knee: P(), ratio: P(), attack: P(), release: P(), playbackRate: P(1) };
  };
  const ctx = {
    currentTime: 0, sampleRate: 48000, state: 'running', destination: {},
    createBuffer: (c, l, sr) => { const d = new Float32Array(l); return { getChannelData: () => d, duration: l / sr }; },
    createPeriodicWave: () => ({}), createBufferSource: node('buffer'), createOscillator: node('osc'), createGain: node('gain'),
    createBiquadFilter: node('filter'), createStereoPanner: node('pan'), createDynamicsCompressor: node('dyn'),
  };
  return { ctx, stats };
}
const state = () => ({ t: 1, ias: 80, gs: 80, vs: 0, onGround: false, gearPos: 1, flapDeg: 0, slatDeg: 0, speedbrake: 0, groundSpoilers: 0, brakes: { left: 0, right: 0 },
  engines: [{ n1: 40, rev: 0 }, { n1: 40, rev: 0 }], warnings: {}, pos: { x: 0, y: 0, z: 500 }, sat: 10, wind: { x: 3, y: 0, z: 1, meanX: 1, meanY: 0 } });
const opts = { inside: true, timeScale: 1, paused: false };
const rain = { precip: { kind: 'rain', rate: 0.8 }, lightning: 0, wind: { kt: 0, gustKt: 0 }, turbulence: 'none', seed: 3 };

test('null weather: no new nodes, ever', async () => {
  const { ctx, stats } = mockContext();
  const synth = createSynth({ context: ctx });
  synth.setWeather(null);
  await synth.start();
  const built = stats.nodes;
  synth.setWeather(null);
  const s = state();
  for (let i = 0; i < 300; i++) { ctx.currentTime += 1 / 60; s.t += 1 / 60; synth.update(s, opts); }
  assert.equal(stats.nodes, built);
});

test('settings before start() and after: the weather nodes appear, and go away', async () => {
  const { ctx, stats } = mockContext();
  const synth = createSynth({ context: ctx });
  synth.setWeather(rain);
  await synth.start();
  const withRain = stats.nodes;
  const { ctx: c2, stats: s2 } = mockContext();
  const plain = createSynth({ context: c2 });
  await plain.start();
  assert.ok(withRain > s2.nodes, 'rain nodes made at start');
  const s = state();
  ctx.currentTime += 1 / 60; s.t += 1 / 60; synth.update(s, opts);
  const stopBefore = stats.stopped;
  synth.setWeather(null);
  assert.ok(stats.stopped >= stopBefore + 2, 'the rain sources stop');
  for (let i = 0; i < 120; i++) { ctx.currentTime += 1 / 60; s.t += 1 / 60; synth.update(s, opts); }
});

test('a strike is heard late by its distance, only from sim time', async () => {
  // Find a strike close to the origin and step the synth across it.
  const out = [];
  let found = null;
  for (let seed = 1; seed < 20000 && !found; seed++) {
    strikesBetween({ lightning: 0.5, seed }, 0, 30, 0, 0, out);
    const a = out.find((b) => Math.hypot(b.x, b.y) < 10000 && b.ground);
    if (a) found = { seed, a: { ...a } };
  }
  assert.ok(found);
  const { ctx, stats } = mockContext();
  const synth = createSynth({ context: ctx });
  synth.setWeather({ precip: { kind: 'none', rate: 0 }, lightning: 0.5, wind: { kt: 0, gustKt: 0 }, turbulence: 'none', seed: found.seed });
  await synth.start();
  const s = state();
  s.t = found.a.t - 0.5;
  const c = 331.3 + 0.606 * s.sat, h = Math.hypot(found.a.x, found.a.y);
  const expect = found.a.t + h / c;
  // Paused or skipped time starts nothing.
  synth.update(s, { ...opts, paused: true });
  const before = stats.started.length;
  let started = false, firstAt = 0;
  for (let i = 0; i < 60 * 80 && !started; i++) {
    ctx.currentTime += 1 / 60; s.t += 1 / 60;
    synth.update(s, opts);
    if (stats.started.length > before) { started = true; firstAt = s.t + (stats.started[before] - ctx.currentTime); }
  }
  assert.ok(started, 'a clap started');
  assert.ok(firstAt <= expect + 0.05 && firstAt >= expect - 0.02, `heard at ${firstAt.toFixed(3)} s, expected ${expect.toFixed(3)} s`);
});

test('the Boeing windshear siren is built only when the warning comes', async () => {
  const { ctx, stats } = mockContext();
  const synth = createSynth({ context: ctx });
  synth.setType({ sound: null, family: 'boeing' });
  synth.setWeather({ precip: { kind: 'none', rate: 0 }, lightning: 0, wind: { kt: 20, gustKt: 0 }, turbulence: 'none', seed: 1, shear: null, microbursts: [] });
  await synth.start();
  const built = stats.nodes;
  const s = state();
  ctx.currentTime += 1 / 60; s.t += 1 / 60; synth.update(s, opts);
  assert.equal(stats.nodes, built, 'nothing yet');
  s.warnings.windshear = true;
  ctx.currentTime += 1 / 60; s.t += 1 / 60; synth.update(s, opts);
  assert.ok(stats.nodes > built, 'siren built');
});

// With null weather the synth must drive the graph exactly as it does without any weather support. Every
// node, buffer sample and parameter call of a scripted flight, recorded in order. (Against v0.3.2's synth: same trace.)
export async function calmTrace(make, seed = 7) {
  const trace = [];
  const real = Math.random;
  let x = seed;
  Math.random = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
  try {
    let id = 0;
    const buffers = [];
    const P = (name) => ({ value: 0,
      setTargetAtTime(v, t, c) { trace.push(`${name}.tgt ${v} ${t} ${c}`); },
      setValueAtTime(v, t) { trace.push(`${name}.val ${v} ${t}`); },
      linearRampToValueAtTime(v, t) { trace.push(`${name}.ramp ${v} ${t}`); },
      cancelScheduledValues(t) { trace.push(`${name}.cancel ${t}`); } });
    const node = (kind) => () => {
      const me = `${kind}${id++}`;
      trace.push(`new ${me}`);
      const n = { connect(o) { trace.push(`${me}->`); return o; }, disconnect() { trace.push(`${me}x`); }, start(a, b) { trace.push(`${me}.start ${a} ${b}`); }, stop() { trace.push(`${me}.stop`); }, setPeriodicWave() {} };
      for (const p of ['gain', 'frequency', 'detune', 'Q', 'pan', 'threshold', 'knee', 'ratio', 'attack', 'release', 'playbackRate']) n[p] = P(`${me}.${p}`);
      return n;
    };
    const ctx = { currentTime: 0, sampleRate: 48000, state: 'running', destination: {},
      createBuffer: (c, l, sr) => { const d = new Float32Array(l); trace.push(`buf ${l} ${sr}`); buffers.push(d); return { getChannelData: () => d, duration: l / sr, d }; },
      createPeriodicWave: (re, im) => { trace.push(`wave ${re.join()} ${im.join()}`); return {}; },
      createBufferSource: node('src'), createOscillator: node('osc'), createGain: node('gain'), createBiquadFilter: node('bq'), createStereoPanner: node('pan'), createDynamicsCompressor: node('dyn') };
    const synth = make({ context: ctx });
    await synth.start();
    const s = { t: 0, ias: 0, gs: 0, vs: -3, onGround: false, gearPos: 0, flapDeg: 0, slatDeg: 0, speedbrake: 0, groundSpoilers: 0, brakes: { left: 0, right: 0 },
      engines: [{ n1: 20, rev: 0 }, { n1: 20, rev: 0 }], warnings: { stall: false, overspeed: false, apDisc: false, windshear: false }, pos: { x: 0, y: 0, z: 800 }, sat: 12, wind: { x: 7, y: -2, z: 1, meanX: 3, meanY: 1 } };
    const o = { inside: true, timeScale: 1, paused: false };
    for (let i = 0; i < 1500; i++) {
      ctx.currentTime += 1 / 60; s.t += 1 / 60;
      s.ias = 40 + i * 0.1; s.gs = s.ias; for (const e of s.engines) e.n1 = 20 + (i % 600) / 8; s.gearPos = Math.min(1, i / 400);
      s.onGround = i > 900; s.warnings.apDisc = i > 300 && i < 500; s.warnings.overspeed = i > 600 && i < 700; s.warnings.stall = i > 800 && i < 850;
      s.warnings.windshear = i > 100 && i < 300; s.brakes.left = i > 950 ? 1 : 0;
      o.inside = i % 300 < 150; o.paused = i > 1400; o.timeScale = i > 1300 && i < 1400 ? 4 : 1; o.aft = 0.3; o.dist = 90;
      synth.update(s, o);
    }
    for (const d of buffers) { let h = 0x811c9dc5; for (let i = 0; i < d.length; i++) h = Math.imul(h ^ (d[i] * 1e7 | 0), 16777619); trace.push(`bufhash ${h}`); }
    return { trace };
  } finally { Math.random = real; }
}

test('null weather drives the audio graph exactly as no weather at all (node, buffer and parameter trace)', async () => {
  const a = await calmTrace((o) => createSynth(o));
  const b = await calmTrace((o) => { const s = createSynth(o); s.setWeather(null); return s; });
  assert.ok(a.trace.length > 5000, `${a.trace.length} events`);
  assert.equal(a.trace.length, b.trace.length);
  assert.deepEqual(a.trace, b.trace);
});
