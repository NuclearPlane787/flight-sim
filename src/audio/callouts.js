// The radio-altitude callouts in the browser's speech voice: 2500, 1000, 500, 100, 50,
// 40, 30, 20, 10, and RETARD at 20 ft in a manual landing, repeated until the thrust
// levers reach idle. Plus the ground-proximity calls the sim raises.

const FT = 3.28084;
const CALLS = [
  [2500, 'twenty five hundred'], [1000, 'one thousand'], [500, 'five hundred'],
  [100, 'one hundred'], [50, 'fifty'], [40, 'forty'], [30, 'thirty'], [20, 'twenty'], [10, 'ten'],
];
const WARNINGS = [['pullUp', 'pull up'], ['tooLowGear', 'too low, gear'], ['sinkRate', 'sink rate']];

export function createCallouts() {
  const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  let voice = null;
  let lastFt = Infinity;
  const armed = new Set();
  let retardAt = -Infinity;
  let retardArmed = false;
  let warnAt = -Infinity;
  let muted = false;
  let volume = 1;    // the pause menu's master volume
  const heard = []; // the most recent calls, for tests and the log

  function pickVoice() {
    if (!synth) return;
    const voices = synth.getVoices();
    voice = voices.find((v) => /en[-_]US/i.test(v.lang) && /Samantha|Alex|Daniel|Google US/i.test(v.name))
      || voices.find((v) => /^en/i.test(v.lang)) || null;
  }
  if (synth) { pickVoice(); synth.addEventListener?.('voiceschanged', pickVoice); }

  function say(text, urgent) {
    heard.push(text);
    if (heard.length > 30) heard.shift();
    if (!synth || muted || volume <= 0) return;
    if (urgent) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 1.35;
    u.pitch = 0.9;
    u.volume = 0.9 * volume;
    synth.speak(u);
  }

  // Call once per frame with the sim state and the real time (s).
  function update(s, now, autoland = false) {
    if (s.crashed) return;
    const ft = s.agl * FT;
    // Each call fires once on the way down and re-arms only after climbing 10% (at least
    // 10 ft) back above its height, so terrain bobbing under the radio altimeter doesn't
    // repeat it.
    // After a reset (rewind, jump, skip, restart), arm every call below the current height.
    if (lastFt === Infinity) for (const [h] of CALLS) if (ft > h) armed.add(h);
    for (const [h, text] of CALLS) {
      if (ft > h * 1.1 && ft > h + 10) armed.add(h);
      if (armed.has(h) && s.vs < 0.3 && !s.onGround && lastFt > h && ft <= h) { armed.delete(h); say(text, h <= 100); }
    }
    // RETARD: 20 ft in a manual landing (10 ft in an autoland), repeated until the levers
    // reach idle. Armed only by descending in the air, so never on the take-off roll.
    const retardFt = autoland ? 10 : 20;
    const leversUp = s.thrustLever > 0.01;
    if (!s.onGround && ft > 50 && s.vs < 0) retardArmed = true;
    if (!leversUp || (s.onGround && s.gs < 40 / 1.944) || (!s.onGround && s.vs > 2.5 && ft > 100)) retardArmed = false;
    if (retardArmed && leversUp && ft <= retardFt && now - retardAt > 1.2) { say('retard', true); retardAt = now; }
    const w = s.warnings || {};
    if (now - warnAt > 2.5 && !s.onGround) {
      for (const [k, text] of WARNINGS) if (w[k]) { say(text, true); warnAt = now; break; }
    }
    lastFt = ft;
  }

  return {
    update,
    say,
    heard,
    set muted(v) { muted = v; if (v && synth) synth.cancel(); },
    get muted() { return muted; },
    set volume(v) { volume = Math.max(0, Math.min(1, v)); },
    get volume() { return volume; },
    reset() { lastFt = Infinity; armed.clear(); retardAt = -Infinity; retardArmed = false; if (synth) synth.cancel(); },
  };
}
