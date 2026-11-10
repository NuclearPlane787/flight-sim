// Keyboard input: held keys become ramped stick axes and lever movements; taps become
// actions. Keys are tracked by e.code, auto-repeat is ignored, and everything held is
// dropped when the window loses focus. No Ctrl shortcuts (Ctrl+W closes the tab).

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

const ACTIONS = {
  KeyB: 'parkingBrake', KeyG: 'gear', KeyC: 'speedbrake', KeyZ: 'ap', KeyX: 'athr',
  Equal: 'faster', Minus: 'slower', NumpadAdd: 'faster', NumpadSubtract: 'slower',
  KeyM: 'map', KeyV: 'view', KeyP: 'pushback', Escape: 'pause', F3: 'perf', Backquote: 'perf',
  Digit6: 'flap0', Digit7: 'flap1', Digit8: 'flap2', Digit9: 'flap3', Digit0: 'flap4',
  KeyT: 'rewind',
  KeyK: 'localQnh',
  // v0.3.0: the flap lever a step at a time (every type; a Boeing has more detents than keys).
  BracketLeft: 'flapUp', BracketRight: 'flapDown',
  // The Boeings' TO/GA switches (nothing on the A321, whose TO/GA is the lever).
  KeyO: 'toga',
  // The view switch's keys (v0.2.1): cockpit, nose, 3rd person.
  Digit1: 'viewCockpit', Digit2: 'viewNose', Digit3: 'viewOrbit',
};
const HELD = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'Space', 'KeyY', 'KeyH']);

export function createInput(target = window) {
  const down = new Set();
  const axes = { pitch: 0, roll: 0, yaw: 0 };
  let lever = 0;          // -1 … 1
  let detents = DETENTS;  // the lever's stops (v0.3.0: the type's; a Boeing has idle and full)
  let detentTimer = 0;    // time left paused at a detent
  let reverseTimer = 0;
  // R/F: 0 not held; 1 held since a moment the lever was the pilot's; 2 held since a moment the
  // A/THR was moving it (that press takes the lever over, and the sim disconnects the A/THR).
  let press = 0;
  const listeners = [];
  let enabled = true;

  const typing = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };

  function onKeyDown(e) {
    if (!enabled || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    let code = e.code;
    if (code === 'KeyC' && e.shiftKey) code = 'ShiftC';
    if (HELD.has(code)) {
      e.preventDefault();
      down.add(code);
      return;
    }
    const action = code === 'ShiftC' ? 'spoilersArm' : ACTIONS[code];
    if (!action) return;
    e.preventDefault();
    if (e.repeat) return;
    for (const fn of listeners) fn(action);
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
  const pair = (neg, pos) => (down.has(pos) ? 1 : 0) - (down.has(neg) ? 1 : 0);

  // Advance the ramps by dt (real seconds) and write them into the sim's controls.
  // athrDriving: the A/THR is moving the thrust lever (the sim's state.athrActive, v0.2.2).
  function update(dt, controls, onGround, athrDriving = false) {
    axes.pitch = approach(axes.pitch, pair('KeyW', 'KeyS'), dt);
    axes.roll = approach(axes.roll, pair('KeyA', 'KeyD'), dt);
    axes.yaw = approach(axes.yaw, pair('KeyQ', 'KeyE'), dt);
    controls.pitch = axes.pitch;
    controls.roll = axes.roll;
    controls.yaw = axes.yaw;
    // v0.3.0: the Boeings' pitch trim, held: Y nose down, H nose up (the sim ignores it on the A321).
    controls.trim = pair('KeyY', 'KeyH');

    // The thrust lever moves while R or F is held and pauses at each detent it crosses.
    const dir = pair('KeyF', 'KeyR');
    if (dir === 0) press = 0;
    else if (press === 0) press = athrDriving ? 2 : 1;
    if (athrDriving && press !== 2) {
      // The A/THR moves the lever: follow it. A press that began before it took the lever
      // (pulling back into CL after take-off) does nothing more until the key is let go; a
      // new press takes the lever from where it is.
      lever = controls.thrust;
      detentTimer = 0;
      reverseTimer = 0;
    } else if (dir === 0) {
      detentTimer = 0;
      reverseTimer = 0;
    } else if (detentTimer > 0) {
      detentTimer -= dt;
    } else if (dir < 0 && lever <= 0) {
      // At idle: on the ground, keep holding F to pull into reverse.
      if (onGround) {
        reverseTimer += dt;
        if (reverseTimer >= REVERSE_DELAY) lever = Math.max(-1, lever - LEVER_RATE * 2 * dt);
      } else lever = 0;
    } else {
      const next = Math.max(-1, Math.min(1, lever + dir * LEVER_RATE * dt));
      if (lever < 0 && dir > 0) {
        lever = Math.min(0, next); // reverse back up to idle, stopping there
        if (lever === 0) detentTimer = DETENT_HOLD;
      } else {
        const crossed = detents.find((d) => (lever < d.at && next >= d.at) || (lever > d.at && next <= d.at));
        if (crossed) { lever = crossed.at; detentTimer = DETENT_HOLD; } else lever = next;
      }
    }
    if (!onGround && lever < 0) lever = 0;
    controls.thrust = lever;

    const brake = down.has('Space') ? 1 : 0;
    controls.brakeL = brake;
    controls.brakeR = brake;
  }

  return {
    update,
    axes,
    onAction(fn) { listeners.push(fn); },
    setDetents(list) { detents = list || DETENTS; },
    get lever() { return lever; },
    set lever(v) { lever = v; },
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
