// Keyboard input: held keys become ramped stick axes and lever movements; taps become
// actions. Keys are tracked by e.code, auto-repeat is ignored, and everything held is
// dropped when the window loses focus. No Ctrl shortcuts (Ctrl+W closes the tab).
// v0.5.6: the keys come from the aircraft's bindings (src/keys.js: setBindings()). v0.5.7: an engine with keys of its
// own (the warehouse's block) moves only its own lever, pausing at its detents and, held at idle on the ground, into
// its own reverse; R and F (all engines) move every lever (controls.thrustEng; null while every lever is together).

import { BINDINGS, keymapOf, resolveKeys } from './keys.js';

// Thrust lever positions (TLA / 45°), as in the sim's interface.
export const DETENTS = [
  { name: 'IDLE', at: 0 },
  { name: 'CL', at: 25 / 45 },
  { name: 'FLX/MCT', at: 35 / 45 },
  { name: 'TOGA', at: 1 },
];

const AXIS_IN = 3.5;   // stick travel per second while held (full in ~0.3 s)
const AXIS_OUT = 6;    // and back to centre when released
const LEVER_RATE = 0.55; // thrust lever travel per second (about 25° TLA/s)
const DETENT_HOLD = 0.35; // a held lever pauses this long at each detent
const REVERSE_DELAY = 0.4; // hold F this long at idle on the ground to pull into reverse

// The defaults, as a key map (before v0.5.6 the only one): resolveKeys() with nothing stored.
export const DEFAULT_KEYMAP = keymapOf(resolveKeys(null, { scope: 'type:a321neo' }));

export function createInput(target = window) {
  const down = new Set();
  const axes = { pitch: 0, roll: 0, yaw: 0 };
  let lever = 0;          // -1 … 1: every engine's, or (split) the highest of them
  let engineTook = false; // v0.5.6 (review): see the getter
  let levers = null;      // v0.5.6: each engine's lever while an engine's own keys have moved them apart, else null
  let levSt = [];         // v0.5.7: each lever's pause at a detent and reverse timer while they're apart
  let nEngines = 2;
  let detents = DETENTS;  // the lever's stops (v0.3.0: the type's; a Boeing has idle and full)
  // The all-engines lever's pause at a detent and its reverse timer (R and F's).
  const master = { timer: 0, rev: 0 };
  // R/F: 0 not held; 1 held since a moment the lever was the pilot's; 2 held since a moment the
  // A/THR was moving it (that press takes the lever over, and the sim disconnects the A/THR).
  let press = 0;
  // v0.5.6: the keys (src/keys.js). held: control id → its keys. v0.5.7: engines: the engines with keys of their own,
  // [{ i, up, down }], each with its press state.
  let map = DEFAULT_KEYMAP;
  let heldKeys = {};
  let engines = [];
  const listeners = [];
  let enabled = true;

  function setBindings(resolved) {
    const r = resolved || resolveKeys(null, { scope: 'type:a321neo' });
    map = keymapOf(r);
    heldKeys = {};
    for (const b of BINDINGS) if (b.kind === 'held') heldKeys[b.id] = [];
    for (const [chord, t] of map) if (t.kind === 'held') heldKeys[t.id].push(chord);
    const byI = new Map();
    for (const [chord, t] of map) {
      if (t.kind !== 'engine') continue;
      if (!byI.has(t.i)) byI.set(t.i, { i: t.i, up: [], down: [], press: 0 });
      byI.get(t.i)[t.dir > 0 ? 'up' : 'down'].push(chord);
    }
    engines = [...byI.values()].sort((a, b) => a.i - b.i);
    down.clear();
  }
  setBindings(null);

  const typing = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };

  function onKeyDown(e) {
    if (!enabled || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    // Esc is the menu's, whatever the bindings (keys.js keeps it reserved).
    if (code === 'Escape') {
      e.preventDefault();
      if (!e.repeat) for (const fn of listeners) fn('pause');
      return;
    }
    const plain = map.get(code);
    if (plain && plain.kind !== 'action') {   // a held control or an engine's own key (Shift or not)
      e.preventDefault();
      down.add(code);
      return;
    }
    const t = (e.shiftKey && map.get(`Shift+${code}`)) || plain;
    if (!t || t.kind !== 'action') return;
    e.preventDefault();
    if (e.repeat) return;
    for (const fn of listeners) fn(t.id);
  }
  function onKeyUp(e) {
    down.delete(e.code);
  }
  function dropAll() { down.clear(); }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', dropAll);
  document.addEventListener('visibilitychange', dropAll);

  const approach = (v, goal, dt) => {
    const step = (goal === 0 ? AXIS_OUT : AXIS_IN) * dt;
    return Math.abs(goal - v) <= step ? goal : v + Math.sign(goal - v) * step;
  };
  const anyDown = (list) => { for (const c of list) if (down.has(c)) return true; return false; };
  const held = (id) => anyDown(heldKeys[id] || []);
  const pair = (neg, pos) => (held(pos) ? 1 : 0) - (held(neg) ? 1 : 0);
  const engDir = (e) => (anyDown(e.up) ? 1 : 0) - (anyDown(e.down) ? 1 : 0);

  // Advance the ramps by dt (real seconds) and write them into the sim's controls.
  // athrDriving: the A/THR is moving the thrust lever (the sim's state.athrActive, v0.2.2).
  function update(dt, controls, onGround, athrDriving = false) {
    axes.pitch = approach(axes.pitch, pair('pitchDown', 'pitchUp'), dt);
    axes.roll = approach(axes.roll, pair('rollLeft', 'rollRight'), dt);
    axes.yaw = approach(axes.yaw, pair('yawLeft', 'yawRight'), dt);
    controls.pitch = axes.pitch;
    controls.roll = axes.roll;
    controls.yaw = axes.yaw;
    // v0.3.0: the Boeings' pitch trim, held: Y nose down, H nose up (the sim ignores it on the A321).
    controls.trim = pair('trimDown', 'trimUp');

    leverStep(dt, controls, onGround, athrDriving);

    const brake = held('brakes') ? 1 : 0;
    controls.brakeL = brake;
    controls.brakeR = brake;
  }

  // One lever's travel for a held direction, pausing at each detent it crosses (st: its { timer, rev }); held down at
  // idle on the ground for REVERSE_DELAY, into reverse. v0.5.7: an engine's own keys too, each with its own timers.
  function moveLever(l, dir, dt, st, onGround) {
    if (dir === 0) { st.timer = 0; st.rev = 0; return l; }
    if (st.timer > 0) { st.timer -= dt; return l; }
    if (dir < 0 && l <= 0) {
      if (onGround) {
        st.rev += dt;
        if (st.rev >= REVERSE_DELAY) return Math.max(-1, l - LEVER_RATE * 2 * dt);
        return l;
      }
      return 0;
    }
    const next = Math.max(-1, Math.min(1, l + dir * LEVER_RATE * dt));
    if (l < 0 && dir > 0) {
      const v = Math.min(0, next); // reverse back up to idle, stopping there
      if (v === 0) st.timer = DETENT_HOLD;
      return v;
    }
    const crossed = detents.find((d) => (l < d.at && next >= d.at) || (l > d.at && next <= d.at));
    if (crossed) { st.timer = DETENT_HOLD; return crossed.at; }
    return next;
  }

  // The thrust lever moves while R or F is held and pauses at each detent it crosses. v0.5.5: on its own too, while
  // the game is paused (main.js: the lever moves, the sim doesn't). v0.5.6: an engine's own keys move its lever only
  // (it parts from the others: controls.thrustEng). v0.5.7: apart, each lever moves on its own: by its engine's own
  // keys while one is held, else by R and F (all engines), each pausing at its own detents and, held at idle on the
  // ground, going into its own reverse (so R lifts the others with the highest already at full).
  function leverStep(dt, controls, onGround, athrDriving = false) {
    // The levers as the sim left them: it brings them together when the A/THR takes them (thrustEng null), and a
    // restore or a rewind puts its own.
    if (controls.thrustEng !== levers) { levers = Array.isArray(controls.thrustEng) ? controls.thrustEng : null; levSt = []; }
    const dir = pair('thrustDown', 'thrustUp');
    if (dir === 0) press = 0;
    else if (press === 0) press = athrDriving ? 2 : 1;
    let eTake = false;
    const own = new Array(nEngines).fill(0);   // each engine's own keys' direction (0: none held, or it has none)
    for (const e of engines) {
      const ed = engDir(e);
      if (ed === 0) e.press = 0;
      else if (e.press === 0) e.press = athrDriving ? 2 : 1;
      if (e.i < nEngines) { own[e.i] = ed; if (e.press === 2) eTake = true; }
    }
    if (athrDriving && press !== 2 && !eTake) {
      // The A/THR moves the lever: follow it. A press that began before it took the lever
      // (pulling back into CL after take-off) does nothing more until the key is let go; a
      // new press takes the lever from where it is. v0.5.6: it moves every engine's (none apart).
      lever = controls.thrust;
      levers = null; levSt = [];
      master.timer = 0; master.rev = 0;
    } else if (!levers && own.every((d) => d === 0)) {
      // Together, and no engine's own key: the one lever, exactly as before v0.5.6 (the golden flights fly this).
      lever = moveLever(lever, dir, dt, master, onGround);
      if (!onGround && lever < 0) lever = 0;
    } else {
      // An engine's own key parts the levers, each starting where the one lever was (and as far through its pause).
      if (!levers) { levers = new Array(nEngines).fill(lever); levSt = levers.map(() => ({ timer: master.timer, rev: master.rev })); }
      for (let i = 0; i < levers.length; i++) {
        const st = levSt[i] || (levSt[i] = { timer: 0, rev: 0 });
        let v = moveLever(levers[i], own[i] || dir, dt, st, onGround);
        if (!onGround && v < 0) v = 0;
        levers[i] = v;
      }
      // v0.5.6 (review): with the levers apart, the all-engines lever is the highest of them, as an Airbus takes the
      // most advanced lever: the A/THR's modes, the detent (MAN TOGA), the callouts and the windshear check read it.
      lever = Math.max(...levers);
    }
    engineTook = eTake;
    controls.thrust = lever;
    controls.thrustEng = levers;
  }

  return {
    update,
    updateLever: leverStep,   // v0.5.5: the thrust lever alone (while paused)
    leverHeld: () => held('thrustUp') || held('thrustDown') || engines.some((e) => e.i < nEngines && engDir(e) !== 0),
    // v0.5.6 (review): an engine's own key took the levers from a driving A/T this frame (main.js disconnects a
    // Boeing's A/T, whose hand-on-lever override would take them back while the key is still held).
    get engineTook() { return engineTook; },
    get groupTook() { return engineTook; },   // v0.5.6's name
    axes,
    onAction(fn) { listeners.push(fn); },
    setDetents(list) { detents = list || DETENTS; },
    // v0.5.6: the aircraft's keys (keys.js resolveKeys()) and its engine count (the engines' own levers).
    setBindings,
    setEngineCount(n) { nEngines = Math.max(1, n | 0); if (levers && levers.length !== nEngines) { levers = null; levSt = []; } },
    // v0.5.7: the engines with keys of their own: [{ i, up: [chords], down: [chords] }].
    get engines() { return engines.map((e) => ({ i: e.i, up: e.up.slice(), down: e.down.slice() })); },
    get keymap() { return map; },
    get lever() { return lever; },
    // Setting the lever (a new flight, a skip to final, a rewind) brings every engine's back to it.
    set lever(v) { lever = v; levers = null; levSt = []; },
    get levers() { return levers ? levers.slice() : null; },
    isDown: (code) => down.has(code),
    setEnabled(v) { enabled = v; if (!v) dropAll(); },
    dropAll,
  };
}

export function detentName(lever) {
  if (lever < -0.01) return 'REV';
  const d = DETENTS.find((d) => Math.abs(d.at - lever) < 0.005);
  return d ? d.name : '';
}
