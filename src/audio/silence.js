// v0.7.4 (Shane's item 12: "a small button on the left panel ... that silences the warning sounds when pressed"): the
// warnings silenced by a press. Pressed, every warning sounding at that moment is silenced; it stays silent while its
// condition holds and sounds again once the condition ends and comes back; a warning that wasn't sounding at the
// press sounds as usual. Only the sound: the screens and lights read the sim's warnings, not this.
//
//   const s = createSilencer();
//   s.press(sounding)     // sounding: { kind: true, ... } for each warning heard now; returns how many it silenced
//   s.allow(cond, kind)   // each frame, for each kind: the condition as heard (false while silenced)
//   s.any                 // something is silenced (the button lit)
//   s.reset()             // a new flight, a rewind or a load: nothing silenced
//
// synth.js keeps one for its tones (the chime, the cricket and stall tone, the cavalry charge, the siren) and
// callouts.js one for the voice's warnings (the ground-proximity calls and the windshear warnings).

export function createSilencer() {
  const off = new Set();
  return {
    press(sounding) {
      let k = 0;
      for (const [kind, on] of Object.entries(sounding || {})) if (on && !off.has(kind)) { off.add(kind); k++; }
      return k;
    },
    // The condition's end lifts the silence; the next time it comes on it is heard.
    allow(cond, kind) {
      if (!cond) { off.delete(kind); return false; }
      return !off.has(kind);
    },
    get any() { return off.size > 0; },
    has(kind) { return off.has(kind); },
    reset() { off.clear(); },
  };
}
