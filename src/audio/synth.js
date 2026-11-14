// Aircraft sound, synthesised in WebAudio (no audio files). Engines, wind, gear and flap
// motors, spoilers, touchdown, tyres, brakes and reversers, the cockpit air-conditioning
// bed, plus the AP-disconnect cavalry charge, the overspeed chime and the stall cricket.
//
// The engines (v0.2.2; Shane: "The current engine sounds don't sound accurate to a real
// A321."). Before, each was one steady tone and a low rumble. Now each CFM LEAP-1A is made of
// what makes the real one's sound, at its real frequencies (FAA TCDS E00089EN: N1 3,894 rpm =
// 101 %, N2 19,391 rpm = 116.5 %; 18 fan blades):
//   - the fan's tones: the blade-passing frequency (18 × the N1 shaft's, ~1.16 kHz at 100 %)
//     and its harmonics, with sidebands and the shaft's own low orders: one oscillator with a
//     custom waveform, at the shaft's frequency;
//   - the buzz-saw: above about 75 % N1 the fan's tips go supersonic and every shaft order
//     sounds (a rasp at ~60 Hz with uneven harmonics), mostly ahead of the engine;
//   - the core's whine, from N2 (an approximation: N2 ≈ 60 + 0.4 × N1 %);
//   - broadband: the fan's (a band round its tones), the jet's roar (low, rising steeply with
//     thrust, mostly behind), and the combustion rumble.
// The tones waver a little, slowly, in level and pitch (as measured tones do), and the two
// engines run 0.15 % apart, so they beat. Outside, where you hear from changes the mix: ahead
// (the nose) the fan and the buzz-saw, behind the jet; and 3rd person's distance lowers and
// dulls it all (opts.aft, opts.dist).
//
// Every node is made once in start(); update() only moves parameters with setTargetAtTime
// (or schedules short envelopes on existing gain nodes), so nothing is allocated per frame.
// A limiter (DynamicsCompressor) before the master volume keeps everything-at-once from clipping.
// Levels were tuned offline by measuring rendered PCM: tests/audio-render.mjs; tests/audio-clips.mjs
// renders flight phases to listen to.
//
//   const synth = createSynth();                    // or createSynth({ context }) in tests
//   button.onclick = () => synth.start();          // needs a user gesture
//   synth.update(sim.state, { inside, timeScale, paused, aft, dist });  // every frame
//   synth.volume = 0.8;
// aft: where the listener is, outside: −1 ahead of the engines, 0 abeam, 1 behind. dist: metres
// from the aircraft (3rd person's orbit; 0 for the nose).
//
// v0.4.0, the weather (null weather: none of this runs, no nodes, and the sound is v0.3.2's exactly;
// tests/audio-render.mjs renders both and compares them sample by sample):
//   synth.setWeather(settings);   // sim.weather: normalizeWeather()'s shape, or null
//   - rain on the skin: louder on the windshield than outside;
//   - thunder: strikesBetween() (the seeded lightning the picture draws) gives where and when; the
//     clap comes late by the distance to the bolt's nearest part, at 331.3 + 0.606 T m/s. Near ones
//     crack, far ones rumble longer and duller. Thunder's samples are made here (no third-party sound).
//   - gusts: the gusts and the buffet (state.wind against its mean, the airspeed against its own
//     slow average) move the wind's noise, and a low rumble when it's rough.
//   - a Boeing's windshear siren (a two-tone siren, then the voice in callouts.js).
// The weather's nodes are made when setWeather() asks for them (only those it asks for) and stopped
// when the weather goes. Thunder's claps are BufferSources started when a clap is due, the
// only nodes made after that; sim time drives it, so paused, nothing moves.

import { strikesBetween } from '../sim/lightning.js';

const KT = 1.943844; // m/s → kt

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// The LEAP-1A (see above): shaft frequency per % of N1 and of N2, and the fan's blades.
// v0.3.0: an engine's numbers live in a spec like this one (the type registry's `sound`; set with
// synth.setType(def)): the voices are the same for every engine, at its own frequencies and mix.
//   n1Hz, n2Hz: the shafts' frequency per %; fanBlades; n2Base + n2Slope × N1 %: the core;
//   coreOrder: the whine's order on N2; buzzFrom, buzzTo: the N1 range (0..1) where the fan's tips
//   go supersonic; jetHz, coreHz: [lowest, span] of the roar's and the rumble's low-passes (a bigger
//   fan is lower); split: how much faster engine 2 runs (the two beat); gain: the voices' levels
//   against the LEAP-1A's (by name, as in ENG; 1 if absent).
//   The widebodies' specs are in engine-sounds.js.
export const LEAP_1A = {
  n1Hz: 3894 / 101 / 60, n2Hz: 19391 / 116.5 / 60, fanBlades: 18, n2Base: 60, n2Slope: 0.4, coreOrder: 12,
  buzzFrom: 0.72, buzzTo: 0.95, jetHz: [160, 700], coreHz: [110, 200], split: 1.0015, gain: {},
};
// Engine 2 runs a little faster (the spec's split), and its tones are a little quieter (TONE2): the
// two beat, gently, as unsynchronised engines do.
const TONE2 = 0.65;

// v0.5.0: any number of engines, up to six (a design's), each its own voices at its own N1. The
// spread: engine i runs split^SPREAD[i] faster, so every pair beats (two engines: 0 and 1, as before;
// more: steps of 2/(n−1) of the split, shuffled so neighbours differ, the slowest pair beating at 0.4
// of the twin's rate with six), and every other engine's tones are TONE2 quieter (so n engines' tones
// add up as n/2 twins'). Nothing scales the level by the count: n engines' voices are incoherent
// (their own noise loops, wanders and pitches), so they add in power, +10·log10(n/2) dB over two
// (+3.0 dB with four, +4.8 with six), as real engines do. tests/audio-render.mjs measures it.
export const MAX_ENGINES = 8;   // v0.5.2: a design's up to eight
const SPREAD_RANK = { 3: [0, 2, 1], 4: [0, 2, 3, 1], 5: [0, 3, 1, 4, 2], 6: [0, 3, 1, 4, 2, 5], 7: [0, 4, 1, 5, 2, 6, 3], 8: [0, 4, 1, 5, 2, 6, 3, 7] };
function spreadOf(count) {
  if (count <= 2) return [0, 1].slice(0, count);
  return SPREAD_RANK[count].map((r) => r * 2 / (count - 1));
}
// Each engine's place across the aircraft (−1 left … 1 right) from its y (left +); a tail engine 0.
// Two engines are −1 and 1, as before v0.5.0.
function sidesOf(def, count) {
  const E = def?.geo?.ENGINES;
  if (count === 2 || !E || E.length !== count) return count === 2 ? [-1, 1] : Array.from({ length: count }, (_, i) => (count === 1 ? 0 : -1 + 2 * i / (count - 1)));
  const span = Math.max(1e-6, ...E.map((e) => Math.abs(e.y)));
  return E.map((e) => -e.y / span);
}
const countOf = (def) => Math.max(1, Math.min(MAX_ENGINES, def?.geo?.ENGINES?.length ?? def?.engineCount ?? 2)) | 0;
// The gain nodes an engine's level goes through (silenced when it goes).
const VOICES = ['fan', 'buzz', 'whine', 'fanNoise', 'jet', 'core', 'rev'];

// Overall levels (tuned by measurement): PRE feeds the limiter; the warnings' peaks.
const PRE = 0.7;
const CAV_PEAK = 0.3, CHIME = 0.4, CRICKET = 0.3, STALL_TONE = 0.2;

// How loud each source is in the cockpit vs outside (before the shared low-pass). v0.3.1 (Shane:
// "I can't hear the engines much at all from the cockpit. They should be muffled and quieter than
// the outside, but not almost absent."): at idle and on an approach the engines sat 5–12 dB under
// the air conditioning and the wind, on all three types. Now the engines' "in" levels are up (the
// low roar and rumble most, which the structure carries best, so the cockpit stays duller than
// outside), the cockpit's low-pass is at INSIDE_LP (was 900 Hz), and the wind and the air
// conditioning are trimmed to sound as before through it. Measured on rendered clips (A-weighted):
// the engines alone +7 to +8 dB at idle and on an approach, level with the air conditioning at idle
// and 1.5–2 dB over the rest on an approach; take-off in the cockpit 4–6 dB under 3rd person's.
const MIX = {
  fan: { in: 0.50, out: 1.00 },       // the fan's tones (v0.3.0: 0.22)
  buzz: { in: 0.45, out: 1.00 },      // the buzz-saw (0.38)
  whine: { in: 0.30, out: 0.50 },     // the core's whine (0.04): much of what you hear at idle
  fanNoise: { in: 0.30, out: 1.00 },  // the fan's broadband (0.25)
  jet: { in: 0.42, out: 1.00 },       // the jet's roar (0.25): low, so the walls pass more of it
  core: { in: 0.70, out: 0.70 },      // combustion rumble (0.38): the lowest, through the structure
  reverser: { in: 0.35, out: 1.00 },
  wind: { in: 0.48, out: 0.25 },      // in: 0.55 until v0.3.1, under the old 900 Hz low-pass
  spoiler: { in: 0.45, out: 0.35 },
  rolling: { in: 0.30, out: 0.45 },
  gear: { in: 0.30, out: 0.20 },
  flap: { in: 0.12, out: 0.10 },
  thump: { in: 0.9, out: 0.7 },
  squeal: { in: 0.25, out: 0.6 },
  brake: { in: 0.35, out: 0.5 },
  clunk: { in: 0.5, out: 0.6 },
  packs: { in: 1, out: 0 }, // cockpit air conditioning; outside the engines cover it
  rain: { in: 1, out: 0.3 },   // v0.4.0: on the windshield, a metre from your head
  buffet: { in: 1, out: 0.3 }, // v0.4.0: the airframe's shake is felt inside
};

// ---- v0.4.0: the weather's sound ----
const RAIN_HISS = 0.08, RAIN_PATTER = 0.24;  // at the heaviest rain, in the cockpit (tuned by measurement)
const THUNDER_MAX_M = 25000;     // not heard beyond this
const THUNDER_LOOK_S = 0.1;      // a clap is started this long before it is due
const THUNDER_VOICES = 4;
const CLAP_CRACK = 0.9;          // at 1 km and full power, outside (before the airframe)
const CLAP_RUMBLE = 1.1;         // at 1 km, full power
const GUST_TAU_S = 3;            // the airspeed's slow average
const SHAKE_TAU_S = 0.25;        // the fast part of the wind's deviation, for the buffet
const GUST_FULL_MS = 12;         // a wind this far off its mean is a full gust
const SIREN = 0.26, SIREN_CYCLE_S = 6, SIREN_LOW = 690, SIREN_HIGH = 960, SIREN_NOTE_S = 0.26, SIREN_NOTES = 6;
const speedOfSound = (tempC) => 331.3 + 0.606 * tempC;  // m/s

// The cockpit's low-pass (Hz): the walls take the top off, but the fan's tone and the buzz-saw's
// lower orders still come through (v0.3.1; it was 900 Hz).
const INSIDE_LP = 1300;

// The master gain at 100% on the pause menu's volume slider (main.js scales it).
export const FULL_VOLUME = 0.8;

export function createSynth({ context = null } = {}) {
  let ctx = null;
  let n = null; // all the nodes, made once in start()
  let vol = FULL_VOLUME;
  let inside = true;
  let SND = LEAP_1A;  // the engine's numbers (v0.3.0: setType)
  // v0.5.2: a design's mixed engine types: each engine's own numbers (def.sounds; null: all SND's), and each spec's
  // waveforms, made once.
  let SNDS = null;
  const specOf = (i) => (SNDS && SNDS[i]) || SND;
  const waves = new Map();
  // v0.5.0: how many engines, where (sides: −1 left … 1 right), and each one's spread (above).
  let count = 2, sides = [-1, 1], spread = spreadOf(2);
  let boeing = false;  // v0.4.0: a Boeing sounds a siren with its windshear warning
  // v0.4.0: the weather settings (null: none) and its nodes, made only when asked for.
  let wxSet = null;
  let wx = null;       // { bus, rain, thunder, buffet }: only what the settings need
  let siren = null;
  const dying = [];    // fading groups: disconnected a moment later, in update()
  let gustIas = -1, gustDev = 0, gustT = -1;   // the gusts' filters
  const G = (voice, S = SND) => S.gain[voice] ?? 1;

  // Edge detectors and state between updates.
  let hasPrev = false, pT = 0, pGear = 0, pFlap = 0, pSlat = 0, pGround = false, pRev = 0;
  let gearMoveUntil = 0;
  let flapMoveUntil = 0;
  let wasApDisc = false;
  let cavNext = 0, cavLeft = 0;
  let chimeNext = 0;
  let stallNext = 0;

  // ---- building ----

  // 2 s of noise that loops without a seam: generated 2 s + F long, and the tail past 2 s
  // is cross-faded into the head (otherwise brown noise ticks at every loop point).
  // kind: true or 'brown', 'pink' (−3 dB an octave, Paul Kellet's filter), else white.
  function noiseBuffer(kind) {
    const len = ctx.sampleRate * 2, F = 4096;
    const x = new Float32Array(len + F);
    let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len + F; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === true || kind === 'brown') { last = (last + 0.02 * w) / 1.02; x[i] = last * 3.5; }
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
        x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else x[i] = w;
    }
    for (let i = 0; i < F; i++) x[i] = x[i] * (i / F) + x[len + i] * (1 - i / F);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    buf.getChannelData(0).set(x.subarray(0, len));
    return buf;
  }

  // A slow wander for the tones' level and pitch: values −1…1 every 0.6 s, eased between,
  // 25 s long and looping without a seam (at a low sample rate: it's only a control signal).
  function wanderBuffer() {
    const sr = 4000, step = 0.6, n = 42, len = Math.round(n * step * sr);
    const pts = Array.from({ length: n }, () => Math.random() * 2 - 1);
    const buf = ctx.createBuffer(1, len, sr), x = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const u = i / sr / step, k = Math.floor(u), f = u - k;
      const a = pts[k % n], b = pts[(k + 1) % n];
      x[i] = a + (b - a) * (1 - Math.cos(Math.PI * f)) / 2;
    }
    return buf;
  }

  // A waveform from harmonic amplitudes (index = harmonic), with random but fixed phases (so it
  // isn't peaky); not normalised, so the amplitudes are what they say.
  function harmonicWave(amps, seed) {
    let s = seed >>> 0;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const re = new Float32Array(amps.length), im = new Float32Array(amps.length);
    for (let k = 1; k < amps.length; k++) {
      const ph = rnd() * 2 * Math.PI;
      re[k] = amps[k] * Math.cos(ph); im[k] = amps[k] * Math.sin(ph);
    }
    return ctx.createPeriodicWave(re, im, { disableNormalization: true });
  }

  // The fan's tones, at the N1 shaft's frequency: the blade-passing frequency (18) and its
  // harmonics, each with sidebands, and the shaft's own first orders.
  function fanAmps(S = SND) {
    const B = S.fanBlades;
    const a = new Float32Array(4 * B + 1);
    a[1] = 0.10; a[2] = 0.06; a[3] = 0.04;
    a[B] = 1.0; a[B - 1] = a[B + 1] = 0.18; a[B - 2] = a[B + 2] = 0.07;
    a[2 * B] = 0.45; a[2 * B - 1] = a[2 * B + 1] = 0.08;
    a[3 * B] = 0.20; a[4 * B] = 0.08;
    return a;
  }
  // The buzz-saw: every shaft order, uneven (each blade a little different), strongest from
  // a third to two thirds of the blade-passing frequency (the 6th to the 12th with 18 blades),
  // weak at the first few, fading above.
  function buzzAmps(S = SND) {
    const lo = S.fanBlades / 3, hi = 2 * S.fanBlades / 3;
    const a = new Float32Array(61);
    let s = 7;
    const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    for (let k = 1; k <= 60; k++) {
      const env = k < lo ? 0.15 + 0.85 * (k / lo) * (k / lo) : k <= hi ? 1 : hi / k;
      a[k] = env * (0.25 + 0.75 * rnd());
    }
    a[S.fanBlades] = Math.max(a[S.fanBlades], 0.6);
    return a;
  }
  // A spec's two waveforms (v0.5.2), made once per spec.
  function wavesOf(S) {
    let w = waves.get(S);
    if (!w) { w = { fan: harmonicWave(fanAmps(S), 11), buzz: harmonicWave(buzzAmps(S), 23) }; waves.set(S, w); }
    return w;
  }
  // Each engine's waveforms: its own spec's when the engines are mixed, else the kit's (as before v0.5.2).
  function applyWaves() {
    n.engines.forEach((E, i) => {
      const w = SNDS ? wavesOf(specOf(i)) : { fan: n.kit.fanWave, buzz: n.kit.buzzWave };
      E.fanOsc.setPeriodicWave(w.fan); E.buzzOsc.setPeriodicWave(w.buzz);
    });
  }

  function noise(buf) {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * 2);
    return s;
  }

  function osc(type, freq) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start();
    return o;
  }

  function gain(v = 0) { const g = ctx.createGain(); g.gain.value = v; return g; }

  function filter(type, freq, Q = 0.7) {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = Q;
    return f;
  }

  // a → b → c …, returns the last node.
  function chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }

  // One engine's voices (see the top): the fan's tones and the buzz-saw (custom waveforms at the N1
  // shaft's frequency, wavering a little in level and pitch), the core's whine, and the fan's
  // broadband, the jet's roar and the combustion rumble; into its own panner. Its noise loops share
  // the kit's buffers, each from its own random place (so the engines' noises are incoherent and add
  // in power). `src` lists its sources, to stop them if the engine goes (setType to fewer engines).
  // Two engines are built exactly as before v0.5.0, node for node and in the same order.
  function makeEngine(kit, pan) {
    const src = [];
    const wanderAt = (depth) => {
      const s = ctx.createBufferSource(); s.buffer = kit.wander; s.loop = true;
      s.start(0, Math.random() * kit.wander.duration);   // each one somewhere else in it
      src.push(s);
      const g = gain(depth); s.connect(g); return g;
    };
    const loop = (buf) => { const s = noise(buf); src.push(s); return s; };
    const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(kit.worldBus);
    const fanOsc = ctx.createOscillator(); fanOsc.setPeriodicWave(kit.fanWave); fanOsc.frequency.value = 13; fanOsc.start();
    const buzzOsc = ctx.createOscillator(); buzzOsc.setPeriodicWave(kit.buzzWave); buzzOsc.frequency.value = 13; buzzOsc.start();
    // Pitch: ±4 cents (measured fan tones wander under 0.5 %); level: ±15 % (fan), ±20 % (buzz).
    const pitch = wanderAt(4); pitch.connect(fanOsc.detune); pitch.connect(buzzOsc.detune);
    const fanAm = gain(1), buzzAm = gain(1);
    wanderAt(0.15).connect(fanAm.gain); wanderAt(0.20).connect(buzzAm.gain);
    const fan = gain(0), buzz = gain(0);
    chain(fanOsc, fanAm, fan, p);
    chain(buzzOsc, buzzAm, filter('lowpass', 2400, 0.5), buzz, p);   // its top orders soften
    const whineOsc = osc('triangle', 2200);
    const whine = gain(0);
    chain(whineOsc, filter('lowpass', 5000, 0.5), whine, p);
    const fanBp = filter('bandpass', 1000, 0.55);
    const fanNoise = gain(0);
    chain(loop(kit.white), fanBp, fanNoise, p);
    const jetLp = filter('lowpass', 300, 0.6);
    const jet = gain(0);
    chain(loop(kit.pink), filter('highpass', 35, 0.7), jetLp, jet, p);
    const coreLp = filter('lowpass', 150, 0.5);
    const core = gain(0);
    chain(loop(kit.brown), coreLp, core, p);
    const revBp = filter('bandpass', 700, 0.6);
    const rev = gain(0);
    chain(loop(kit.white), revBp, rev, p);
    src.push(fanOsc, buzzOsc, whineOsc);
    return { p, fanOsc, buzzOsc, fan, buzz, whineOsc, whine, fanBp, fanNoise, jetLp, jet, coreLp, core, revBp, rev, src };
  }

  // v0.5.0: more or fewer engines after start() (a design flown after a type): the new ones are made
  // as above; the ones gone fade, stop and are disconnected a moment later (reap()).
  function resizeEngines() {
    const E = n.engines;
    while (E.length > count) {
      const g = E.pop(), now = ctx.currentTime;
      for (const k of VOICES) silence(g[k]);
      for (const s of g.src) { try { s.stop(now + 0.4); } catch { /* already stopped */ } }
      dying.push({ node: g.p, at: now + 0.5 });
    }
    while (E.length < count) {
      const e = makeEngine(n.kit, sides[E.length] * 0.6);
      if (SNDS) { const w = wavesOf(specOf(E.length)); e.fanOsc.setPeriodicWave(w.fan); e.buzzOsc.setPeriodicWave(w.buzz); }
      E.push(e);
    }
  }

  function build() {
    const white = noiseBuffer(false);
    const brown = noiseBuffer(true);
    const pink = noiseBuffer('pink');
    const wander = wanderBuffer();
    const fanWave = harmonicWave(fanAmps(), 11), buzzWave = harmonicWave(buzzAmps(), 23);
    const master = gain(vol);
    master.connect(ctx.destination);
    // Limiter: transparent at normal levels, catches everything-at-once. (Chrome adds its own
    // make-up gain, about +5 dB here; the source levels below allow for it.)
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12; limiter.knee.value = 6; limiter.ratio.value = 12;
    limiter.attack.value = 0.002; limiter.release.value = 0.2;
    const pre = gain(PRE);
    chain(pre, limiter, master);
    const warnBus = gain(1); warnBus.connect(pre);
    const worldBus = gain(1);
    const muffle = filter('lowpass', 1200); // cockpit: low; outside: wide open
    chain(worldBus, muffle, pre);

    // Engines (see the top): one set of voices per engine (v0.5.0: as many as the type or design has,
    // up to six), made by makeEngine() below; panned by where each hangs.
    const kit = { white, pink, brown, wander, fanWave, buzzWave, worldBus };
    const engines = sides.map((side) => makeEngine(kit, side * 0.6));

    const windBp = filter('bandpass', 500, 0.6);
    const wind = gain(0);
    chain(noise(white), windBp, wind, worldBus);

    const spoilerLp = filter('lowpass', 160, 1.2);
    const spoiler = gain(0);
    chain(noise(brown), spoilerLp, spoiler, worldBus);

    const rollLp = filter('lowpass', 90, 1.5);
    const rolling = gain(0);
    chain(noise(brown), rollLp, rolling, worldBus);

    // Hydraulic motors: a buzzy tone through a low-pass.
    const gearOsc = osc('sawtooth', 95);
    const gear = gain(0);
    chain(gearOsc, filter('lowpass', 400, 2), gear, worldBus);
    const flapOsc = osc('sawtooth', 420);
    const flap = gain(0);
    chain(flapOsc, filter('bandpass', 900, 3), flap, worldBus);

    // Cockpit air conditioning: a soft broadband hiss, always there inside.
    const packs = gain(0);
    chain(noise(white), filter('lowpass', 2500, 0.5), filter('highpass', 250, 0.5), packs, worldBus);

    // Brakes: a rumble while braking at speed, a narrow squeal just before stopping.
    const brakeRumble = gain(0);
    chain(noise(brown), filter('lowpass', 140, 0.9), brakeRumble, worldBus);
    const brakeSqueal = gain(0);
    chain(noise(white), filter('bandpass', 2900, 30), brakeSqueal, worldBus);

    // Clunks (reverser doors, gear locking): a short low knock.
    const clunkOsc = osc('sine', 85);
    const clunk = gain(0);
    chain(clunkOsc, clunk, worldBus);
    const clunkNoise = gain(0);
    chain(noise(brown), filter('lowpass', 600, 0.8), clunkNoise, worldBus);

    // Touchdown: a low thump and a short tyre chirp (envelopes on fixed sources).
    const thumpOsc = osc('sine', 55);
    const thump = gain(0);
    chain(thumpOsc, thump, worldBus);
    const thumpNoise = gain(0);
    chain(noise(brown), filter('lowpass', 250), thumpNoise, worldBus);
    const squeal = gain(0);
    chain(noise(white), filter('bandpass', 2200, 6), squeal, worldBus);

    // Warnings (on their own bus, not muffled).
    const cavOsc = osc('square', 392);
    const cav = gain(0);
    chain(cavOsc, filter('lowpass', 2500), cav, warnBus);

    const chimeA = osc('sine', 740), chimeB = osc('sine', 1110);
    const chime = gain(0);
    chimeA.connect(chime); chain(chimeB, gain(0.5), chime); chime.connect(warnBus);

    // Cricket: a 4 kHz tone chopped by a 28 Hz square (gain swings 0…1), in bursts.
    const crk = osc('square', 4200);
    const crkAm = gain(0.5);
    const lfo = osc('square', 28);
    chain(lfo, gain(0.5), crkAm.gain);
    const cricket = gain(0);
    chain(crk, filter('bandpass', 4200, 4), crkAm, cricket, warnBus);
    const stallOsc = osc('square', 560);
    const stallTone = gain(0);
    chain(stallOsc, filter('lowpass', 1800), stallTone, warnBus);

    return {
      pre, master, warnBus, worldBus, muffle, kit, engines, windBp, wind, spoilerLp, spoiler, rollLp, rolling,
      gearOsc, gear, flapOsc, flap, thump, thumpNoise, squeal, cav, cavOsc, chime, cricket, stallTone,
      packs, brakeRumble, brakeSqueal, clunk, clunkNoise,
    };
  }

  // ---- helpers ----

  // A parameter's new target; skipped when it's the one it already has (most, in a steady
  // state: update() stays cheap with the engines' many voices).
  const set = (param, v, tc = 0.08) => {
    if (param._v === v) return;
    param._v = v;
    param.setTargetAtTime(v, ctx.currentTime, tc);
  };
  const mix = (k) => (inside ? MIX[k].in : MIX[k].out);

  // A short pluck on an existing gain: fast attack, exponential-ish decay.
  function pluck(g, t, peak, decay) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.006);
    g.gain.setTargetAtTime(0, t + 0.01, decay);
  }

  function silence(g) {
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0, t, 0.02);
  }

  // Cavalry charge: one 1.5 s bugle phrase (12 short notes).
  const CAV = [392, 523, 659, 784, 659, 784, 392, 523, 659, 784, 659, 784];
  function cavalry(t0) {
    const f = n.cavOsc.frequency, g = n.cav.gain;
    f.cancelScheduledValues(t0); g.cancelScheduledValues(t0);
    g.setValueAtTime(0, t0);
    CAV.forEach((hz, i) => {
      const t = t0 + i * 0.125;
      f.setValueAtTime(hz, t);
      g.setTargetAtTime(CAV_PEAK, t, 0.004);
      g.setTargetAtTime(0, t + 0.095, 0.01);
    });
  }

  // ---- v0.4.0: the weather's nodes ----

  // Fade a group out, then stop it (polled in update(): the context may be suspended).
  function retire(g) {
    if (!g) return;
    const now = ctx.currentTime;
    g.out.gain.cancelScheduledValues(now);
    g.out.gain.setTargetAtTime(0, now, 0.05);
    for (const s of g.src) { try { s.stop(now + 0.4); } catch { /* already stopped */ } }
    dying.push({ node: g.out, at: now + 0.5 });
  }
  function reap(now) {
    while (dying.length && dying[0].at <= now) dying.shift().node.disconnect();
  }

  // Rain drops on a surface: a 3 s loop of short decaying ticks (90 a second).
  function dropsBuffer() {
    const sr = ctx.sampleRate, len = Math.floor(3 * sr);
    const buf = ctx.createBuffer(1, len, sr), x = buf.getChannelData(0);
    for (let d = 0, count = 270; d < count; d++) {
      const at = Math.floor(Math.random() * len);
      const amp = 0.2 + 0.8 * Math.pow(Math.random(), 3);
      const dur = Math.max(8, Math.floor((0.002 + 0.006 * Math.random()) * sr));
      // A soft start (a sharp edge reads as a click), then a quick decay.
      for (let i = 0; i < dur; i++) x[(at + i) % len] += amp * (Math.random() * 2 - 1) * Math.min(1, i / (0.15 * dur)) * Math.exp(-6 * i / dur);
    }
    let peak = 1e-6;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(x[i]));
    for (let i = 0; i < len; i++) x[i] *= 0.9 / peak;
    return buf;
  }

  function buildRain() {
    const out = gain(1);
    const hissBp = filter('bandpass', 3200, 0.5), hiss = gain(0);
    const hissSrc = noise(noiseBuffer(false));
    chain(hissSrc, hissBp, hiss, out);
    const patterSrc = noise(dropsBuffer()), patterHp = filter('highpass', 500, 0.5), patterLp = filter('lowpass', 4500, 0.5), patter = gain(0);
    chain(patterSrc, patterHp, patterLp, patter, out);
    out.connect(wx.bus);
    return { out, hissBp, hiss, patterHp, patterLp, patter, src: [hissSrc, patterSrc] };
  }

  // Thunder's samples, made here (at the lower sample rate for the rumble: nothing in it is high).
  // Rumble: brown noise under a train of swelling, overlapping rolls, decaying over T seconds, as the
  // sound of a bolt's kilometres of channel arrives bit by bit.
  function rumbleBuffer(T, rolls) {
    const sr = 16000, len = Math.floor(T * sr);
    const buf = ctx.createBuffer(1, len, sr), x = buf.getChannelData(0);
    const env = new Float32Array(len);
    for (let k = 0; k < rolls; k++) {
      const at = k === 0 ? 0 : Math.random() * Math.random() * T * 0.75;    // the first at once, more of them early
      const rise = 0.04 + 0.15 * Math.random(), fall = 0.25 + 0.7 * Math.random() * (T / 5);
      const amp = (0.4 + 0.6 * Math.random()) * Math.exp(-2.2 * at / T);
      const a = Math.floor(at * sr), b = Math.min(len, a + Math.floor((rise + fall * 5) * sr));
      for (let i = a; i < b; i++) {
        const u = (i - a) / sr;
        env[i] += amp * (u < rise ? u / rise : Math.exp(-(u - rise) / fall));
      }
    }
    let lp = 0, peak = 1e-6;
    for (let i = 0; i < len; i++) {
      lp = (lp + 0.04 * (Math.random() * 2 - 1)) / 1.04;       // brown
      x[i] = lp * Math.pow(env[i], 1.1) * Math.exp(-3.5 * i / len);
      peak = Math.max(peak, Math.abs(x[i]));
    }
    for (let i = 0; i < len; i++) x[i] *= 0.9 / peak;
    return buf;
  }

  // The crack of a nearby bolt: a few sharp, decaying bursts of noise in the first 120 ms.
  function crackBuffer() {
    const sr = ctx.sampleRate, len = Math.floor(0.45 * sr);
    const buf = ctx.createBuffer(1, len, sr), x = buf.getChannelData(0);
    const bursts = 3 + Math.floor(Math.random() * 3);
    let peak = 1e-6;
    for (let b = 0; b < bursts; b++) {
      const at = b === 0 ? 0 : Math.floor(Math.random() * 0.12 * sr);
      const decay = (0.006 + 0.04 * Math.random()) * sr, amp = b === 0 ? 1 : 0.4 + 0.6 * Math.random();
      for (let i = at; i < len; i++) x[i] += amp * (Math.random() * 2 - 1) * Math.exp(-(i - at) / decay);
    }
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(x[i]));
    for (let i = 0; i < len; i++) x[i] *= 0.9 / peak;
    return buf;
  }

  function buildThunder() {
    const out = gain(1); out.connect(wx.bus);
    const voices = [];
    for (let k = 0; k < THUNDER_VOICES; k++) {
      const lp = filter('lowpass', 1000, 0.6), g = gain(1), crack = gain(0), rumble = gain(0);
      crack.connect(lp); rumble.connect(lp); chain(lp, g, out);
      voices.push({ lp, g, crack, rumble, until: 0, src: [] });
    }
    return {
      out, voices, src: [],
      cracks: [crackBuffer(), crackBuffer()],
      near: [rumbleBuffer(5, 14), rumbleBuffer(5, 14)],
      far: [rumbleBuffer(14, 22), rumbleBuffer(14, 22)],
      pending: [], strikes: [], lastT: -1,
    };
  }

  // A low shake for the rough air, driven in update().
  function buildBuffet() {
    const out = gain(0);
    const src = noise(noiseBuffer(true));
    chain(src, filter('lowpass', 75, 0.8), out, n.worldBus);
    return { out, src: [src] };
  }

  // Make or stop what the settings ask for. Null weather leaves none of it.
  function applyWeather() {
    if (!n) return;
    const s = wxSet;
    const wantRain = !!s && s.precip?.kind === 'rain' && s.precip.rate > 0;
    const wantThunder = !!s && s.lightning > 0;
    const wantBuffet = !!s && (s.wind?.gustKt > 0 || (s.turbulence && s.turbulence !== 'none') || s.shear || s.microbursts?.length > 0);
    if (!wx && (wantRain || wantThunder || wantBuffet)) {
      wx = { bus: gain(0), rain: null, thunder: null, buffet: null };
      wx.bus.connect(n.pre);
    }
    if (!wx) return;
    if (wantRain && !wx.rain) wx.rain = buildRain();
    if (!wantRain && wx.rain) { retire(wx.rain); wx.rain = null; }
    if (wantThunder && !wx.thunder) wx.thunder = buildThunder();
    if (!wantThunder && wx.thunder) {
      for (const v of wx.thunder.voices) if (v.until > ctx.currentTime) for (const src of v.src) { try { src.stop(ctx.currentTime + 0.3); } catch { /* ended */ } }
      retire(wx.thunder); wx.thunder = null;
    }
    if (wantBuffet && !wx.buffet) wx.buffet = buildBuffet();
    if (!wantBuffet && wx.buffet) { retire(wx.buffet); wx.buffet = null; }
    if (!wx.rain && !wx.thunder && !wx.buffet) {
      dying.push({ node: wx.bus, at: ctx.currentTime + 0.5 });
      wx.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      wx = null;
    }
    if (!s && siren) { retire(siren); siren = null; }
  }

  // A clap: at `at` (context time), from `d` metres.
  function fireClap(at, d, power, now) {
    const th = wx.thunder;
    let v = null;
    for (const c of th.voices) if (c.until <= now) { v = c; break; }
    if (!v) {
      if (d > 8000) return;                 // busy: a far one can go
      v = th.voices.reduce((a, b) => (a.until < b.until ? a : b));
      for (const src of v.src) { try { src.stop(at); } catch { /* ended */ } }
    }
    const nearK = clamp01((4000 - d) / 3000);   // 1 at 1 km, 0 from 4 km
    const farK = clamp01((d - 2000) / 13000);
    const level = (1 - 0.4 * farK) / (1 + Math.pow(d / 3000, 2));   // 1 km: 0.9; 3.4 km: 0.4; 15 km: 0.023; 25 km: 0.009
    const walls = inside ? 0.55 : 1;
    const hz = (300 + 4800 * Math.pow(1 - clamp01(d / 15000), 2)) * (inside ? 0.35 : 1);
    const rate = 1 - 0.45 * farK;
    const list = d > 6000 ? th.far : th.near;
    const rumble = list[Math.floor(Math.random() * list.length)];
    const srcR = ctx.createBufferSource();
    srcR.buffer = rumble; srcR.playbackRate.value = rate; srcR.connect(v.rumble);
    v.src = [srcR];
    v.rumble.gain.setValueAtTime(CLAP_RUMBLE * power * level * walls, at);
    v.lp.frequency.setValueAtTime(hz, at);
    srcR.start(at);
    if (nearK > 0) {
      const srcC = ctx.createBufferSource();
      srcC.buffer = th.cracks[Math.floor(Math.random() * th.cracks.length)]; srcC.connect(v.crack);
      v.crack.gain.setValueAtTime(CLAP_CRACK * nearK * power * walls, at);
      srcC.start(at);
      v.src.push(srcC);
    } else v.crack.gain.setValueAtTime(0, at);
    v.until = at + rumble.duration / rate + 0.1;
  }

  // Each frame: this frame's strikes join the queue; what's due is started. Sim time drives it.
  function thunderStep(s, now, fast) {
    const th = wx.thunder, t = s.t || 0;
    if (th.lastT < 0) th.lastT = t;
    const dt = t - th.lastT;
    if (dt === 0) return;                 // paused
    if (dt < 0 || dt > 0.5 || fast) { th.pending.length = 0; th.lastT = t; return; }  // a rewind, a jump, or skipped time
    const px = s.pos?.x ?? 0, py = s.pos?.y ?? 0, pz = s.pos?.z ?? 0;
    strikesBetween(wxSet, th.lastT, t, px, py, th.strikes);
    for (const st of th.strikes) {
      const h = Math.hypot(st.x - px, st.y - py);
      if (h > THUNDER_MAX_M) continue;
      // The first sound comes from the channel's nearest part: to the ground from 3 km, or in the cloud 3–6 km.
      const bottom = st.ground ? 0 : 3000, top = st.ground ? 3000 : 6000;
      const dz = pz > top ? pz - top : pz < bottom ? bottom - pz : 0;
      const d = Math.hypot(h, dz);
      if (d > THUNDER_MAX_M) continue;
      const c = speedOfSound(s.sat ?? 15);
      th.pending.push({ arrive: st.t + d / c, d, power: st.power });
      if (th.pending.length > 16) th.pending.shift();
    }
    th.lastT = t;
    for (let i = th.pending.length - 1; i >= 0; i--) {
      const p = th.pending[i];
      if (p.arrive - t <= THUNDER_LOOK_S) {
        fireClap(Math.max(now, now + p.arrive - t), p.d, p.power, now);
        th.pending.splice(i, 1);
      }
    }
  }

  // Rain, the bus, the buffet: only with weather.
  function weatherStep(s, now, paused, fast, shake) {
    set(wx.bus.gain, paused || fast ? 0 : 1, 0.05);
    if (wx.rain) {
      const R = wx.rain, rate = clamp01(wxSet.precip.rate);
      // The fall stops at the lowest layer's base, as the particles' does (world/precip.js ceilingM).
      const lay = (wxSet.clouds || []).filter((c) => c.okta > 0);
      const alt = s.pos?.z ?? 0, top = lay.length ? Math.min(...lay.map((c) => c.baseFt * 0.3048)) : 6000;
      const under = top === Infinity ? 1 : 1 - smooth(top - 100, top + 100, alt);   // above the layer it isn't raining
      const body = Math.pow(rate, 0.8) * under * (0.75 + 0.5 * clamp01((s.ias || 0) / 120)) * mix('rain');
      set(R.hiss.gain, RAIN_HISS * body, 0.3);
      set(R.patter.gain, RAIN_PATTER * body, 0.3);
      set(R.hissBp.frequency, inside ? 3200 : 6000, 0.2);
      set(R.patterHp.frequency, inside ? 500 : 1800, 0.2);
      set(R.patterLp.frequency, inside ? 4500 : 9000, 0.2);
    }
    if (wx.thunder) thunderStep(s, now, fast);
    if (wx.buffet) set(wx.buffet.out.gain, paused || fast ? 0 : mix('buffet') * shake * 0.5, 0.04);
  }

  // The Boeing's windshear siren: a two-tone siren, once a cycle (then the voice, callouts.js).
  function sirenStep(active, now) {
    if (!active) {
      if (siren && siren.next) { silence(siren.out); siren.next = 0; }
      return;
    }
    if (!siren) {
      const o = osc('square', SIREN_LOW);
      const out = gain(0);
      chain(o, filter('lowpass', 2800, 0.7), out, n.warnBus);
      siren = { o, out, src: [o], next: 0 };
    }
    if (!siren.next || now + 0.05 >= siren.next) {
      const t0 = Math.max(now, siren.next || now);
      const f = siren.o.frequency, g = siren.out.gain;
      f.cancelScheduledValues(t0); g.cancelScheduledValues(t0);
      g.setValueAtTime(0, t0); g.setTargetAtTime(SIREN, t0, 0.01);
      for (let i = 0; i < SIREN_NOTES; i++) f.setValueAtTime(i % 2 ? SIREN_HIGH : SIREN_LOW, t0 + i * SIREN_NOTE_S);
      g.setTargetAtTime(0, t0 + SIREN_NOTES * SIREN_NOTE_S, 0.02);
      siren.next = t0 + SIREN_CYCLE_S;
    }
  }

  // ---- update ----

  const NO_OPTS = {};

  // An engine is heard while it runs (N1 above 8 %).
  const running = (n1) => (n1 > 0.08 ? 1 : n1 / 0.08);

  // The engines' voices at full strength (tuned by measurement, tests/audio-render.mjs).
  const ENG = { fan: 0.070, buzz: 0.050, whine: 0.030, fanNoise: 0.22, jet: 0.95, core: 0.12 };

  function update(s, opts = NO_OPTS) {
    if (!ctx || !n || !s) return;
    const now = ctx.currentTime;
    const paused = !!opts.paused;
    const fast = (opts.timeScale ?? 1) > 1;
    inside = opts.inside ?? true;
    // Outside: where from (−1 ahead … 1 behind) and how far (3rd person's orbit).
    const aft = inside ? 0 : Math.max(-1, Math.min(1, opts.aft ?? 0));
    const dist = inside ? 0 : Math.max(0, opts.dist ?? 0);
    const ahead = (1 - aft) / 2, behind = (1 + aft) / 2;
    const near = 1 / (1 + Math.max(0, dist - 75) / 150);   // 3rd person's 75 m: 1; 300 m: 0.4; 1.5 km: 0.1

    set(n.worldBus.gain, paused || fast ? 0 : near, 0.05);
    // v0.5.0: more than two engines are louder (+10·log10(n/2) dB), so the warnings come up as much and
    // stay about as clear over them as over two (two: 1, as before; time compression mutes the engines).
    const warnK = n.engines.length > 2 ? Math.sqrt(n.engines.length / 2) : 1;
    set(n.warnBus.gain, paused ? 0 : fast ? 0.25 : warnK, 0.05);
    // The cockpit's walls; outside, the air dulls a distant aircraft.
    set(n.muffle.frequency, inside ? INSIDE_LP : Math.max(3500, 16000 * Math.min(1, 120 / Math.max(dist, 1))), 0.1);
    set(n.packs.gain, mix('packs') * 0.02, 0.2);   // 0.035 under the old 900 Hz low-pass (v0.3.1)

    const ias = s.ias || 0;
    const iasKt = ias * KT;

    // Engines (see the top).
    const engines = s.engines;
    // v0.5.0: every engine the type or design has; one torn off (`off`) or missing is silent. A state
    // with more engines than setType() said (it wasn't told of a design) grows the voices once, spread
    // evenly across, rather than leave engines unheard.
    if (engines && engines.length > n.engines.length && n.engines.length < MAX_ENGINES) {
      count = Math.min(MAX_ENGINES, engines.length); sides = sidesOf(null, count); spread = spreadOf(count);
      resizeEngines();
    }
    for (let i = 0; i < n.engines.length; i++) {
      const e = engines && engines[i], E = n.engines[i];
      const pct = e && !e.off ? Math.max(0, e.n1 || 0) : 0;
      const n1 = clamp01(pct / 100), on = running(n1);
      const pw = clamp01((n1 - 0.2) / 0.765);             // power, idle 0 … TOGA 1
      const S = specOf(i);
      const d = spread[i], k = d === 0 ? 1 : d === 1 ? S.split : Math.pow(S.split, d);
      const tone = i % 2 ? TONE2 : 1;
      const shaft = Math.max(1, pct) * S.n1Hz * k;
      set(E.p.pan, sides[i] * (inside ? 0.35 : 0.6), 0.2);
      set(E.fanOsc.frequency, shaft, 0.1);
      set(E.buzzOsc.frequency, shaft, 0.1);
      set(E.whineOsc.frequency, S.coreOrder * (S.n2Base + S.n2Slope * pct) * S.n2Hz * k, 0.1);
      set(E.fanBp.frequency, Math.max(300, 1.4 * S.fanBlades * shaft), 0.1);
      set(E.jetLp.frequency, S.jetHz[0] + S.jetHz[1] * pw, 0.15);
      set(E.coreLp.frequency, S.coreHz[0] + S.coreHz[1] * pw, 0.15);
      // Levels: the fan's tones grow with its tip speed; the buzz-saw comes in as the tips
      // go supersonic (72–95 % N1), ahead of the engine; the jet's roar steeply with power,
      // behind it.
      set(E.fan.gain, ENG.fan * G('fan', S) * tone * mix('fan') * on * (0.3 + 0.7 * Math.pow(n1, 2.2)) * (0.7 + 0.3 * ahead));
      set(E.buzz.gain, ENG.buzz * G('buzz', S) * tone * mix('buzz') * on * smooth(S.buzzFrom, S.buzzTo, n1) * (0.2 + 0.8 * ahead));
      set(E.whine.gain, ENG.whine * G('whine', S) * mix('whine') * on * (0.6 + 0.4 * n1) * (0.5 + 0.5 * ahead));
      set(E.fanNoise.gain, ENG.fanNoise * G('fanNoise', S) * mix('fanNoise') * on * (0.1 + 0.9 * n1 * n1 * n1));
      set(E.jet.gain, ENG.jet * G('jet', S) * mix('jet') * on * Math.pow(pw, 2.2) * (0.35 + 0.65 * behind));
      set(E.core.gain, ENG.core * G('core', S) * mix('core') * on * (0.3 + 0.7 * Math.pow(pw, 1.5)) * (0.6 + 0.4 * behind));
      const rev = e && !e.off ? clamp01(e.rev || 0) : 0;
      set(E.rev.gain, mix('reverser') * rev * (0.15 + n1 * n1) * 0.7);
      set(E.revBp.frequency, 400 + n1 * 600, 0.15);
    }

    // Wind and spoilers with airspeed.
    const q = clamp01(iasKt / 320);
    let gust = 1, gustFloor = 0, gustHz = 0, shake = 0;
    if (wxSet && s.wind) {
      // v0.4.0: the gusts (the wind off its mean, the airspeed off its own slow average) swell the
      // wind's noise and brighten it; the fast part is the buffet's rumble.
      const W = s.wind, t = s.t || 0;
      const dev = Math.hypot((W.x || 0) - (W.meanX || 0), (W.y || 0) - (W.meanY || 0), W.z || 0);
      if (gustIas < 0 || t < gustT) { gustIas = ias; gustDev = dev; gustT = t; }
      const dt = Math.min(0.2, t - gustT);
      gustT = t;
      gustIas += (ias - gustIas) * (1 - Math.exp(-dt / GUST_TAU_S));
      gustDev += (dev - gustDev) * (1 - Math.exp(-dt / SHAKE_TAU_S));
      const g = clamp01(dev / GUST_FULL_MS);
      const rel = Math.max(-0.3, Math.min(0.3, (ias - gustIas) / Math.max(ias, 30)));
      gust = 1 + 2.5 * rel + 1.4 * g;
      gustFloor = 0.1 * g * g;
      gustHz = 300 * g;
      shake = clamp01(Math.abs(dev - gustDev) / 2.5);
    }
    set(n.wind.gain, wxSet && s.wind ? mix('wind') * (q * q * gust + gustFloor) * 0.6 : mix('wind') * q * q * 0.6);   // (written apart: without weather, to the bit)
    set(n.windBp.frequency, inside ? 200 + iasKt * 2.5 + gustHz * 0.6 : 300 + iasKt * 6 + gustHz, 0.2); // cockpit: a lower roar
    const spl = Math.max(s.speedbrake || 0, s.groundSpoilers || 0);
    set(n.spoiler.gain, mix('spoiler') * spl * clamp01(iasKt / 250) * 1.2);
    set(n.spoilerLp.frequency, 100 + iasKt * 0.8, 0.2);

    // Rolling rumble on the ground.
    const gsKt = (s.gs || 0) * KT;
    const roll = s.onGround ? clamp01(gsKt / 140) : 0;
    set(n.rolling.gain, mix('rolling') * roll * 1.2, 0.05);
    set(n.rollLp.frequency, 50 + gsKt * 1.2, 0.1);

    // Brakes: rumble with brake pressure and speed; squeal fades in below ~20 kt and out
    // as the wheels stop.
    const b = s.onGround && s.brakes ? Math.max(s.brakes.left || 0, s.brakes.right || 0) : 0;
    set(n.brakeRumble.gain, mix('brake') * b * clamp01(gsKt / 60) * 0.9, 0.08);
    const sq = gsKt > 0.5 && gsKt < 20 ? clamp01((20 - gsKt) / 8) * clamp01(gsKt / 3) : 0;
    set(n.brakeSqueal.gain, mix('brake') * b * sq * 0.9, 0.1);

    // Gear and flap motors run while their positions move (held 0.25 s to bridge
    // frames where the sim didn't step). Clunks: reverser doors opening and stowing, the gear
    // locking up or down.
    const gearPos = s.gearPos ?? 0, flapDeg = s.flapDeg ?? 0, slatDeg = s.slatDeg ?? 0;
    const rev0 = engines && engines[0] ? engines[0].rev || 0 : 0;
    if (hasPrev && s.t !== pT && !paused) {
      if (Math.abs(gearPos - pGear) > 1e-6) gearMoveUntil = now + 0.25;
      if (Math.abs(flapDeg - pFlap) > 1e-6 || Math.abs(slatDeg - pSlat) > 1e-6) flapMoveUntil = now + 0.25;
      const lock = (gearPos >= 0.999 && pGear < 0.999) || (gearPos <= 0.001 && pGear > 0.001);
      const doors = (rev0 > 0.02 && pRev <= 0.02) || (rev0 >= 0.98 && pRev < 0.98) || (rev0 <= 0.02 && pRev > 0.02);
      if (lock || doors) {
        const k = mix('clunk') * G('clunk') * (lock ? 0.6 : 1);
        pluck(n.clunk, now, k * 0.5, 0.05);
        pluck(n.clunkNoise, now, k * 0.7, 0.035);
      }
    }
    const gearOn = now < gearMoveUntil, flapOn = now < flapMoveUntil;
    set(n.gear.gain, gearOn ? mix('gear') * 0.17 : 0, 0.12);
    set(n.gearOsc.frequency, gearOn ? 95 : 70, 0.4); // spins up, winds down
    set(n.flap.gain, flapOn ? mix('flap') * 0.8 : 0, 0.12);
    set(n.flapOsc.frequency, flapOn ? 420 : 300, 0.4);

    // Touchdown: onGround false → true while descending.
    if (hasPrev && !pGround && s.onGround && !paused) {
      const sink = clamp01(-(s.vs || 0) / 4); // 4 m/s ≈ 790 fpm = a very firm landing
      if ((s.vs || 0) < -0.1 || sink > 0) {
        pluck(n.thump, now, mix('thump') * (0.25 + sink * 0.75) * 0.8, 0.12);
        pluck(n.thumpNoise, now, mix('thump') * (0.2 + sink * 0.8) * 0.8, 0.08);
      }
      if (gsKt > 30) pluck(n.squeal, now, mix('squeal') * clamp01(gsKt / 140) * 0.8, 0.07);
    }

    // Warnings.
    const w = s.warnings || NO_OPTS;
    if (w.apDisc && !wasApDisc) { cavLeft = 3; cavNext = now; } // up to 3 phrases while it stays on
    if (!w.apDisc) { if (cavLeft > 0) silence(n.cav); cavLeft = 0; }
    while (cavLeft > 0 && now + 0.05 >= cavNext) {
      cavalry(Math.max(cavNext, now)); cavNext = Math.max(cavNext, now) + 1.5; cavLeft--;
    }
    wasApDisc = !!w.apDisc;

    if (w.overspeed) {
      if (chimeNext < now) chimeNext = now;
      while (now + 0.05 >= chimeNext) { pluck(n.chime, chimeNext, CHIME, 0.09); chimeNext += 0.4; }
    } else if (chimeNext) { silence(n.chime); chimeNext = 0; }

    if (w.stall) {
      if (stallNext < now) stallNext = now;
      while (now + 0.05 >= stallNext) {
        const t = stallNext, c = n.cricket.gain, g = n.stallTone.gain;
        c.cancelScheduledValues(t); g.cancelScheduledValues(t);
        c.setTargetAtTime(CRICKET, t, 0.005); c.setTargetAtTime(0, t + 0.5, 0.01);
        g.setTargetAtTime(STALL_TONE, t + 0.6, 0.005); g.setTargetAtTime(0, t + 1.0, 0.01);
        stallNext += 1.3;
      }
    } else if (stallNext) { silence(n.cricket); silence(n.stallTone); stallNext = 0; }

    // v0.4.0: the weather's own parts; with null weather none of them exist and nothing here runs.
    if (dying.length) reap(now);
    if (wx) weatherStep(s, now, paused, fast, shake);
    if (wxSet || siren) sirenStep(boeing && !!w.windshear && !paused, now);

    hasPrev = true; pT = s.t; pGear = gearPos; pFlap = flapDeg; pSlat = slatDeg; pGround = !!s.onGround; pRev = rev0;
  }

  return {
    // Call from a user gesture (click / key). Creates the context once, resumes it after.
    start() {
      if (!ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!context && !AC) return Promise.resolve(false);
        ctx = context || new AC(); // tests pass an OfflineAudioContext
        n = build();
        if (SNDS) applyWaves();   // v0.5.2: mixed engines' own waveforms
        applyWeather();
      }
      if (context) return Promise.resolve(true); // offline: rendering drives it
      n.master.gain.cancelScheduledValues(ctx.currentTime);
      n.master.gain.setTargetAtTime(vol, ctx.currentTime, 0.05);
      n.master.gain._v = vol;
      return ctx.resume().then(() => true, () => false);
    },
    update,
    // v0.4.0: the weather settings (sim.weather; null: none). Call it when they change.
    setWeather(settings) {
      wxSet = settings || null;
      if (!wxSet) gustIas = -1;
      applyWeather();
    },
    // The aircraft type's engine (v0.3.0): new waveforms if the sound has started already.
    // v0.5.0: and its engine count (def.geo.ENGINES, or def.engineCount; up to six) and where each
    // hangs (ENGINES' y): engines added or taken away if the sound has started.
    setType(def) {
      SND = def?.sound || LEAP_1A;
      SNDS = Array.isArray(def?.sounds) ? def.sounds.map((x) => x || LEAP_1A) : null;
      boeing = def?.family === 'boeing';
      count = countOf(def); sides = sidesOf(def, count); spread = spreadOf(count);
      if (!n) return;
      const fanWave = harmonicWave(fanAmps(), 11), buzzWave = harmonicWave(buzzAmps(), 23);
      n.kit.fanWave = fanWave; n.kit.buzzWave = buzzWave;
      for (const E of n.engines) { E.fanOsc.setPeriodicWave(fanWave); E.buzzOsc.setPeriodicWave(buzzWave); }
      resizeEngines();
      if (SNDS) applyWaves();
    },
    get engineCount() { return n ? n.engines.length : count; },
    // Fade out and suspend the context (start() brings it back).
    stop() {
      if (!ctx) return Promise.resolve();
      n.master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      n.master.gain._v = 0;
      return new Promise((r) => setTimeout(r, 150)).then(() => ctx.suspend());
    },
    set volume(v) { vol = clamp01(v); if (ctx) set(n.master.gain, vol, 0.05); },
    // A short, soft tone through the master gain: the volume slider's preview.
    blip() {
      if (!ctx || !n) return;
      const t = ctx.currentTime + 0.12, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.01);
      g.gain.setTargetAtTime(0, t + 0.08, 0.06);
      o.connect(g).connect(n.master);
      o.start(t);
      o.stop(t + 0.5);
    },
    get volume() { return vol; },
    get running() { return !!ctx && ctx.state === 'running'; },
  };
}
