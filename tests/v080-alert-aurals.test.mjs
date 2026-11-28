// v0.8.0: the failure warnings' aurals (src/audio/alerts.js) against a mock AudioContext (as tests/v074-sound-silence
// does): each goes into the synth's warnings bus (synth.alertOut), the loops strike on time and stop, the one-shots
// play once, and nothing is made or played without a context.
//   node --test tests/v080-alert-aurals.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlertAurals, LOOP_PERIOD } from '../src/audio/alerts.js';
import { createSynth } from '../src/audio/synth.js';

function mockContext() {
  const made = [];
  const P = (v = 0) => {
    const p = { value: v, events: [], setTargetAtTime(x, t) { p.events.push(['target', x, t]); }, setValueAtTime(x, t) { p.events.push(['set', x, t]); },
      linearRampToValueAtTime(x, t) { p.events.push(['ramp', x, t]); }, cancelScheduledValues(t) { p.events.push(['cancel', t]); } };
    return p;
  };
  const node = (kind) => () => {
    const n = { kind, to: [], connect(x) { n.to.push(x); return x; }, disconnect() {}, start() {}, stop() {}, setPeriodicWave() {}, gain: P(), frequency: P(), detune: P(), Q: P(), pan: P(),
      threshold: P(), knee: P(), ratio: P(), attack: P(), release: P(), playbackRate: P(1), type: '' };
    made.push(n); return n;
  };
  const ctx = { currentTime: 0, sampleRate: 8000, state: 'running', destination: {},
    createBuffer: (c, l, sr) => { const d = new Float32Array(l); return { getChannelData: () => d, duration: l / sr }; }, createPeriodicWave: () => ({}) };
  for (const k of ['createBufferSource', 'createOscillator', 'createGain', 'createBiquadFilter', 'createStereoPanner', 'createDynamicsCompressor']) ctx[k] = node(k);
  return { ctx, made };
}
const peaks = (g, x) => g.gain.events.filter((e) => e[0] === 'ramp' && e[1] === x).length;
const ramps = (g) => g.gain.events.filter((e) => e[0] === 'ramp' && e[1] > 0);

test('no context: nothing made, nothing played', () => {
  const au = createAlertAurals();
  au.update(null, { loop: 'crc', once: ['sc'] });
  assert.equal(au.playing, null);
});

test('the synth hands its warnings bus; the aurals connect into it alone', async () => {
  const m = mockContext();
  const synth = createSynth({ context: m.ctx });
  assert.equal(synth.alertOut, null, 'before start(): none');
  await synth.start();
  const out = synth.alertOut;
  assert.equal(out.ctx, m.ctx);
  const before = m.made.length;
  const au = createAlertAurals();
  au.update(out, {});
  const mine = m.made.slice(before);
  assert.ok(mine.length > 0);
  // Exactly one of the new nodes connects outside the aurals' own nodes, and it goes to the warnings' bus.
  const outside = mine.filter((n) => n.to.some((t) => !mine.includes(t) && !(t && t.value !== undefined)));
  assert.equal(outside.length, 1);
  assert.deepEqual(outside[0].to, [out.bus]);
  // The warnings' volume lives on that bus: setVolumes moves it.
  synth.setVolumes({ warnings: 0.25 });
  assert.equal(synth.levels().warnings, 0.25 * 1);
});

test('the CRC strikes every 0.75 s while asked, and stops when not', () => {
  const m = mockContext(), out = { ctx: m.ctx, bus: m.ctx.createGain() };
  const au = createAlertAurals();
  let t = 0;
  const run = (sec, want) => { for (let i = 0; i < sec * 60; i++) { t += 1 / 60; m.ctx.currentTime = t; au.update(out, want); } };
  au.update(out, {});
  const chime = m.made.find((n) => n.kind === 'createGain' && n.to.length && m.made.some((o) => o.kind === 'createOscillator' && o.frequency.value === 1046 && o.to.includes(n)));
  run(3, { loop: 'crc' });
  assert.equal(au.playing, 'crc');
  const n = peaks(chime, 0.35);
  // 3 s plus the 0.3 s scheduled ahead: about 4.4 strikes at 0.75 s.
  assert.ok(n >= 4 && n <= 5, `strikes ${n}`);
  assert.equal(LOOP_PERIOD.crc, 0.75);
  run(2, { loop: null });
  assert.equal(au.playing, null);
  const after = peaks(chime, 0.35);
  run(2, { loop: null });
  assert.equal(peaks(chime, 0.35), after, 'no strikes once stopped');
});

test('the fire bell and the siren loop; the single chime and the beeper play once', () => {
  const m = mockContext(), out = { ctx: m.ctx, bus: m.ctx.createGain() };
  const au = createAlertAurals();
  au.update(out, {});
  const gains = m.made.filter((n) => n.kind === 'createGain');
  const byOsc = (f) => gains.find((g) => m.made.some((o) => o.kind === 'createOscillator' && o.frequency.value === f && o.to.includes(g)));
  const chime = byOsc(1046), beep = byOsc(1520);
  const bell = gains.find((g) => g.gain.value === 0 && gains.some((k) => k.to.includes(g) && m.made.some((o) => o.frequency?.value === 1180 && o.to.includes(k))));
  let t = 0;
  const run = (sec, want) => { for (let i = 0; i < sec * 60; i++) { t += 1 / 60; m.ctx.currentTime = t; au.update(out, want); } };
  run(1, { loop: 'bell' });
  const strikes = ramps(bell).length;
  assert.ok(strikes >= 16 && strikes <= 19, `bell strikes in 1 s: ${strikes}`);
  run(0.5, { loop: 'siren' });
  assert.equal(au.playing, 'siren');
  au.stop();
  assert.equal(au.playing, null);
  au.update(out, { once: ['sc'] });
  assert.equal(peaks(chime, 0.35), 1);
  au.update(out, { once: ['beeper'] });
  assert.equal(peaks(beep, 0.2), 4, 'four beeps');
});
