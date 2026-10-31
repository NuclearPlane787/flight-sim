// Aircraft sound, synthesised in WebAudio (no audio files). Engines, wind, gear and flap
// motors, spoilers, touchdown, tyres, brakes and reversers, the cockpit air-conditioning
// bed, plus the AP-disconnect cavalry charge, the overspeed chime and the stall cricket.
//
// Every node is made once in start(); update() only moves parameters with setTargetAtTime
// (or schedules short envelopes on existing gain nodes), so nothing is allocated per frame.
// A limiter (DynamicsCompressor) before the master volume keeps everything-at-once from clipping.
// Levels were tuned offline by measuring rendered PCM: tests/audio-render.mjs.
//
//   const synth = createSynth();                    // or createSynth({ context }) in tests
//   button.onclick = () => synth.start();          // needs a user gesture
//   synth.update(sim.state, { inside, timeScale, paused });  // every frame
//   synth.volume = 0.8;

const KT = 1.943844; // m/s → kt

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Overall levels (tuned by measurement): PRE feeds the limiter; the warnings' peaks.
const PRE = 0.7;
const CAV_PEAK = 0.3, CHIME = 0.4, CRICKET = 0.3, STALL_TONE = 0.2;

// How loud each source is in the cockpit vs outside (before the shared low-pass).
const MIX = {
  whine: { in: 0.10, out: 0.55 },
  rumble: { in: 0.20, out: 0.90 },
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
  function noiseBuffer(brown) {
    const len = ctx.sampleRate * 2, F = 4096;
    const x = new Float32Array(len + F);
    let last = 0;
    for (let i = 0; i < len + F; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; x[i] = last * 3.5; } else x[i] = w;
    }
    for (let i = 0; i < F; i++) x[i] = x[i] * (i / F) + x[len + i] * (1 - i / F);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    buf.getChannelData(0).set(x.subarray(0, len));
    return buf;
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

    // Engines: fan whine (two partials) and combustion rumble, each engine panned.
    const engines = [-0.6, 0.6].map((pan) => {
      const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(worldBus);
      const fan = osc('triangle', 300);
      const comp = osc('sine', 900);
      const whine = gain(0); const compG = gain(0.35);
      fan.connect(whine); chain(comp, compG, whine);
      const whineBp = filter('bandpass', 1000, 0.8); // softens the triangle's edge
      chain(whine, whineBp, p);
      const rumbleLp = filter('lowpass', 200, 0.5);
      const rumble = gain(0);
      chain(noise(brown), rumbleLp, rumble, p);
      const revBp = filter('bandpass', 700, 0.6);
      const rev = gain(0);
      chain(noise(white), revBp, rev, p);
      return { fan, comp, whine, rumbleLp, rumble, revBp, rev };
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

  const set = (param, v, tc = 0.08) => param.setTargetAtTime(v, ctx.currentTime, tc);
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

  // Engine level against N1 (0…1): a floor while the engine runs (idle is clearly audible),
  // rising with N1 squared to TOGA.
  const running = (n1) => (n1 > 0.08 ? 1 : n1 / 0.08);

  function update(s, opts = NO_OPTS) {
    if (!ctx || !n || !s) return;
    const now = ctx.currentTime;
    const paused = !!opts.paused;
    const fast = (opts.timeScale ?? 1) > 1;
    inside = opts.inside ?? true;

    set(n.worldBus.gain, paused || fast ? 0 : 1, 0.05);
    set(n.warnBus.gain, paused ? 0 : fast ? 0.25 : 1, 0.05);
    set(n.muffle.frequency, inside ? 900 : 16000, 0.1);
    set(n.packs.gain, mix('packs') * 0.035, 0.2);

    const ias = s.ias || 0;
    const iasKt = ias * KT;

    // Engines.
    const engines = s.engines;
    for (let i = 0; i < 2; i++) {
      const e = engines && engines[i], E = n.engines[i];
      const n1 = e ? clamp01((e.n1 || 0) / 100) : 0;
      const on = running(n1);
      set(E.fan.frequency, 60 + n1 * 1100, 0.15); // fan blade passing ~1.1 kHz at 100 %
      set(E.comp.frequency, 200 + n1 * 3200, 0.15);
      set(E.whine.gain, mix('whine') * on * (0.05 + 0.95 * Math.pow(n1, 1.5)) * 0.2);
      set(E.rumbleLp.frequency, inside ? 70 + n1 * 260 : 90 + n1 * 500, 0.15); // the hull eats the top
      set(E.rumble.gain, mix('rumble') * on * (0.12 + 0.88 * n1 * n1) * 0.75);
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
        const k = mix('clunk') * (lock ? 0.6 : 1);
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
      return ctx.resume().then(() => true, () => false);
    },
    update,
    // Fade out and suspend the context (start() brings it back).
    stop() {
      if (!ctx) return Promise.resolve();
      n.master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
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
