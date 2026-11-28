// v0.8.0, the failure warnings' aurals, synthesised (no recorded sound): Airbus's continuous repetitive chime (CRC,
// a red warning) and single chime (SC, an amber caution); the Boeings' fire bell, siren (other warnings) and caution
// beeper. They play on the synth's own context through its warnings' bus (synth.js's warnBus: synth.alertOut), so
// the Settings' warnings and master volumes set their level, and a pause (main.js stops the synth: the context is
// suspended) or a hidden tab (which pauses) silences them as it does the other warnings.
//
//   const au = createAlertAurals();
//   au.update(out, { loop, once })   // every frame: out = synth.alertOut ({ ctx, bus }) or null;
//                                    // loop: 'crc' | 'bell' | 'siren' | null, the repeating aural that sounds now
//                                    //       (src/ui/alerts.js: the most urgent unacknowledged warning's)
//                                    // once: [ 'sc' | 'beeper' ], one-shots to start now (a new caution)
//   au.stop()                        // everything quiet at once (a silence, a new flight)
//   au.playing                       // the loop sounding now, or null
//
// Every voice is made once, on the first update with a context, and kept: a sound is its envelope's automation only.
// The sounds' shapes are [EST]: from the public descriptions of the aurals, not from recordings.

const CHIME_PEAK = 0.35, BELL_PEAK = 0.22, SIREN_PEAK = 0.16, BEEP_PEAK = 0.2;
export const LOOP_PERIOD = { crc: 0.75, bell: 1 / 14, siren: 0 };   // s between strikes (the siren is continuous)
const AHEAD = 0.3;   // s of strikes scheduled ahead of the context's clock

export function createAlertAurals() {
  let ctx = null, v = null, loop = null, next = 0;

  function build(out) {
    ctx = out.ctx;
    const g = (val = 0) => { const n = ctx.createGain(); n.gain.value = val; return n; };
    const o = (type, f) => { const n = ctx.createOscillator(); n.type = type; n.frequency.value = f; n.start(); return n; };
    const bus = g(1); bus.connect(out.bus);
    // The chime: a soft bell, two partials (CRC and SC alike).
    const chime = g(0); chime.connect(bus);
    o('sine', 1046).connect(chime);
    const c2 = g(0.35); o('sine', 2093).connect(c2); c2.connect(chime);
    // The fire bell: four inharmonic partials struck 14 times a second.
    const bell = g(0); bell.connect(bus);
    for (const [f, a] of [[1180, 1], [2390, 0.6], [3370, 0.45], [4810, 0.25]]) { const k = g(a); o('sine', f).connect(k); k.connect(bell); }
    // The siren: a sawtooth swept up and down by a slow sine, through a low-pass.
    const siren = g(0); siren.connect(bus);
    const sOsc = o('sawtooth', 900), lfo = o('sine', 2.2), depth = g(320);
    lfo.connect(depth); depth.connect(sOsc.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    sOsc.connect(lp); lp.connect(siren);
    // The caution beeper: a triangle tone, four pulses.
    const beep = g(0); beep.connect(bus);
    o('triangle', 1520).connect(beep);
    v = { bus, chime, bell, siren, beep, out: out.bus };
  }

  function strike(gn, t, peak, decay) {
    const p = gn.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + 0.005);
    p.setTargetAtTime(0, t + 0.01, decay);
  }
  function hush(gn, t) { const p = gn.gain; p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.setTargetAtTime(0, t, 0.02); }
  function voiceOf(kind) { return kind === 'bell' ? v.bell : kind === 'siren' ? v.siren : v.chime; }

  function startLoop(kind, now) {
    if (loop && loop !== kind) hush(voiceOf(loop), now);
    loop = kind; next = now + 0.02;
    if (kind === 'siren') { const p = v.siren.gain; p.cancelScheduledValues(now); p.setValueAtTime(0, now); p.linearRampToValueAtTime(SIREN_PEAK, now + 0.05); }
  }
  function stopLoop(now) { if (loop) hush(voiceOf(loop), now); loop = null; next = 0; }

  function once(kind, now) {
    if (kind === 'sc') { if (loop !== 'crc') strike(v.chime, now + 0.02, CHIME_PEAK, 0.32); return; }
    if (kind === 'beeper') {
      const p = v.beep.gain; p.cancelScheduledValues(now);
      for (let k = 0; k < 4; k++) { const t = now + 0.02 + k * 0.2; p.setValueAtTime(0, t); p.linearRampToValueAtTime(BEEP_PEAK, t + 0.008); p.setValueAtTime(BEEP_PEAK, t + 0.12); p.linearRampToValueAtTime(0, t + 0.13); }
    }
  }

  return {
    update(out, want = {}) {
      if (!out || !out.ctx || !out.bus) return;
      if (!v || out.ctx !== ctx || out.bus !== v.out) build(out);
      const now = ctx.currentTime, kind = want.loop || null;
      if (kind !== loop) { if (kind) startLoop(kind, now); else stopLoop(now); }
      if (loop === 'crc' || loop === 'bell') {
        // A suspended context's clock stands still: the strikes already scheduled wait with it.
        if (next < now) next = now + 0.02;
        const per = LOOP_PERIOD[loop];
        while (next < now + AHEAD) {
          if (loop === 'crc') strike(v.chime, next, CHIME_PEAK, 0.22);
          else strike(v.bell, next, BELL_PEAK, 0.018);
          next += per;
        }
      }
      for (const k of want.once || []) once(k, now);
    },
    stop() {
      if (!v) return;
      const now = ctx.currentTime;
      stopLoop(now);
      hush(v.chime, now); hush(v.beep, now);
    },
    get playing() { return loop; },
  };
}
