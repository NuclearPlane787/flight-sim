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

// Overall levels (tuned by measurement): PRE feeds the limiter; the warnings' peaks.
const PRE = 0.7;
const CAV_PEAK = 0.3, CHIME = 0.4, CRICKET = 0.3, STALL_TONE = 0.2;

// How loud each source is in the cockpit vs outside (before the shared low-pass).
const MIX = {
  fan: { in: 0.22, out: 1.00 },       // the fan's tones
  buzz: { in: 0.38, out: 1.00 },      // the buzz-saw
  whine: { in: 0.04, out: 0.50 },     // the core's whine
  fanNoise: { in: 0.25, out: 1.00 },  // the fan's broadband
  jet: { in: 0.25, out: 1.00 },       // the jet's roar
  core: { in: 0.38, out: 0.70 },      // combustion rumble
  reverser: { in: 0.35, out: 1.00 },
  wind: { in: 0.55, out: 0.25 },
  spoiler: { in: 0.45, out: 0.35 },
  rolling: { in: 0.30, out: 0.45 },
  gear: { in: 0.30, out: 0.20 },
  flap: { in: 0.12, out: 0.10 },
  thump: { in: 0.9, out: 0.7 },
  squeal: { in: 0.25, out: 0.6 },
  brake: { in: 0.35, out: 0.5 },
  clunk: { in: 0.5, out: 0.6 },
  packs: { in: 1, out: 0 }, // cockpit air conditioning; outside the engines cover it
};

// The master gain at 100% on the pause menu's volume slider (main.js scales it).
export const FULL_VOLUME = 0.8;

export function createSynth({ context = null } = {}) {
  let ctx = null;
  let n = null; // all the nodes, made once in start()
  let vol = FULL_VOLUME;
  let inside = true;
  let SND = LEAP_1A;  // the engine's numbers (v0.3.0: setType)
  const G = (voice) => SND.gain[voice] ?? 1;

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
  function fanAmps() {
    const B = SND.fanBlades;
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
  function buzzAmps() {
    const lo = SND.fanBlades / 3, hi = 2 * SND.fanBlades / 3;
    const a = new Float32Array(61);
    let s = 7;
    const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    for (let k = 1; k <= 60; k++) {
      const env = k < lo ? 0.15 + 0.85 * (k / lo) * (k / lo) : k <= hi ? 1 : hi / k;
      a[k] = env * (0.25 + 0.75 * rnd());
    }
    a[SND.fanBlades] = Math.max(a[SND.fanBlades], 0.6);
    return a;
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

    // Engines (see the top): per engine, the fan's tones and the buzz-saw (custom waveforms at
    // the N1 shaft's frequency, wavering a little in level and pitch), the core's whine, and
    // the fan's broadband, the jet's roar and the combustion rumble; panned left and right.
    const wanderAt = (depth) => {
      const s = ctx.createBufferSource(); s.buffer = wander; s.loop = true;
      s.start(0, Math.random() * wander.duration);   // each one somewhere else in it
      const g = gain(depth); s.connect(g); return g;
    };
    const engines = [-0.6, 0.6].map((pan) => {
      const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(worldBus);
      const fanOsc = ctx.createOscillator(); fanOsc.setPeriodicWave(fanWave); fanOsc.frequency.value = 13; fanOsc.start();
      const buzzOsc = ctx.createOscillator(); buzzOsc.setPeriodicWave(buzzWave); buzzOsc.frequency.value = 13; buzzOsc.start();
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
      chain(noise(white), fanBp, fanNoise, p);
      const jetLp = filter('lowpass', 300, 0.6);
      const jet = gain(0);
      chain(noise(pink), filter('highpass', 35, 0.7), jetLp, jet, p);
      const coreLp = filter('lowpass', 150, 0.5);
      const core = gain(0);
      chain(noise(brown), coreLp, core, p);
      const revBp = filter('bandpass', 700, 0.6);
      const rev = gain(0);
      chain(noise(white), revBp, rev, p);
      return { p, fanOsc, buzzOsc, fan, buzz, whineOsc, whine, fanBp, fanNoise, jetLp, jet, coreLp, core, revBp, rev };
    });

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
      master, warnBus, worldBus, muffle, engines, windBp, wind, spoilerLp, spoiler, rollLp, rolling,
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
    set(n.warnBus.gain, paused ? 0 : fast ? 0.25 : 1, 0.05);
    // The cockpit's walls; outside, the air dulls a distant aircraft.
    set(n.muffle.frequency, inside ? 900 : Math.max(3500, 16000 * Math.min(1, 120 / Math.max(dist, 1))), 0.1);
    set(n.packs.gain, mix('packs') * 0.035, 0.2);

    const ias = s.ias || 0;
    const iasKt = ias * KT;

    // Engines (see the top).
    const engines = s.engines;
    for (let i = 0; i < 2; i++) {
      const e = engines && engines[i], E = n.engines[i];
      const pct = e ? Math.max(0, e.n1 || 0) : 0;
      const n1 = clamp01(pct / 100), on = running(n1);
      const pw = clamp01((n1 - 0.2) / 0.765);             // power, idle 0 … TOGA 1
      const shaft = Math.max(1, pct) * SND.n1Hz * (i ? SND.split : 1);
      set(E.p.pan, (i ? 1 : -1) * (inside ? 0.35 : 0.6), 0.2);
      set(E.fanOsc.frequency, shaft, 0.1);
      set(E.buzzOsc.frequency, shaft, 0.1);
      set(E.whineOsc.frequency, SND.coreOrder * (SND.n2Base + SND.n2Slope * pct) * SND.n2Hz * (i ? SND.split : 1), 0.1);
      set(E.fanBp.frequency, Math.max(300, 1.4 * SND.fanBlades * shaft), 0.1);
      set(E.jetLp.frequency, SND.jetHz[0] + SND.jetHz[1] * pw, 0.15);
      set(E.coreLp.frequency, SND.coreHz[0] + SND.coreHz[1] * pw, 0.15);
      // Levels: the fan's tones grow with its tip speed; the buzz-saw comes in as the tips
      // go supersonic (72–95 % N1), ahead of the engine; the jet's roar steeply with power,
      // behind it.
      set(E.fan.gain, ENG.fan * G('fan') * (i ? TONE2 : 1) * mix('fan') * on * (0.3 + 0.7 * Math.pow(n1, 2.2)) * (0.7 + 0.3 * ahead));
      set(E.buzz.gain, ENG.buzz * G('buzz') * (i ? TONE2 : 1) * mix('buzz') * on * smooth(SND.buzzFrom, SND.buzzTo, n1) * (0.2 + 0.8 * ahead));
      set(E.whine.gain, ENG.whine * G('whine') * mix('whine') * on * (0.6 + 0.4 * n1) * (0.5 + 0.5 * ahead));
      set(E.fanNoise.gain, ENG.fanNoise * G('fanNoise') * mix('fanNoise') * on * (0.1 + 0.9 * n1 * n1 * n1));
      set(E.jet.gain, ENG.jet * G('jet') * mix('jet') * on * Math.pow(pw, 2.2) * (0.35 + 0.65 * behind));
      set(E.core.gain, ENG.core * G('core') * mix('core') * on * (0.3 + 0.7 * Math.pow(pw, 1.5)) * (0.6 + 0.4 * behind));
      const rev = e ? clamp01(e.rev || 0) : 0;
      set(E.rev.gain, mix('reverser') * rev * (0.15 + n1 * n1) * 0.7);
      set(E.revBp.frequency, 400 + n1 * 600, 0.15);
    }

    // Wind and spoilers with airspeed.
    const q = clamp01(iasKt / 320);
    set(n.wind.gain, mix('wind') * q * q * 0.6);
    set(n.windBp.frequency, inside ? 200 + iasKt * 2.5 : 300 + iasKt * 6, 0.2); // cockpit: a lower roar
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
      }
      if (context) return Promise.resolve(true); // offline: rendering drives it
      n.master.gain.cancelScheduledValues(ctx.currentTime);
      n.master.gain.setTargetAtTime(vol, ctx.currentTime, 0.05);
      n.master.gain._v = vol;
      return ctx.resume().then(() => true, () => false);
    },
    update,
    // The aircraft type's engine (v0.3.0): new waveforms if the sound has started already.
    setType(def) {
      SND = def?.sound || LEAP_1A;
      if (!n) return;
      const fanWave = harmonicWave(fanAmps(), 11), buzzWave = harmonicWave(buzzAmps(), 23);
      for (const E of n.engines) { E.fanOsc.setPeriodicWave(fanWave); E.buzzOsc.setPeriodicWave(buzzWave); }
    },
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
