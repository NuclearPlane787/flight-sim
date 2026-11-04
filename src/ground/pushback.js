// Pushback state machine for gate starts (PLAN.md → Airports → Gate starts).
// Pure ES module. While it runs it drives the aircraft position directly.
//
// P starts it; P again stops (and resumes). It pushes straight back, then turns
// so the tail swings towards the taxi line and the nose ends up along it.
// Q/E bias the turn (and can start a gentle curve early).
//
//   const pb = createPushback(stand, { line: { x, y, hdgGrid } });  // line optional
//   pb.toggle();                                      // on P
//   const { x, y, hdgGrid, done } = pb.update(dt, { steer });  // steer −1 (Q) … 1 (E)
//   pb.setState(pb.state);                            // a scenario load

const SPEED = 1.5;      // m/s, pushback speed
const ACCEL = 0.4;      // m/s², tug pull-away and stop
const TURN_R = 25;      // m, turn radius of the reference point
const MIN_R = 12;       // m, the tightest turn, used when the taxi line is close behind
const BIAS = 0.4;       // Q/E change the turn rate by ±40%
export const REF_WHEELBASE = 16.91; // m, the A321neo's (geometry.js): the numbers above are for it

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// stand: { x, y, hdgGridDeg }.
// opts.line: a point on the taxi line and its grid direction { x, y, hdgGrid (rad) }
//   (e.g. from taxi.js snapToGraph + the edge direction, or the first leg of the route).
//   Without it: push 1.5 radii back, then a 90° turn to the left (tail right).
// opts.finalHdgGrid: force the heading after the turn.
// opts.wheelbase: metres. The turn radii and the straight leg grow with it: a tug turns a longer
//   aircraft on the same nosewheel angle, so round a proportionally wider arc. Left out (or the
//   A321neo's), the scale is exactly 1.
export function createPushback(stand, opts = {}) {
  const h0 = stand.hdgGridDeg * Math.PI / 180;
  const bx = -Math.sin(h0), by = -Math.cos(h0);   // backwards direction
  const scale = opts.wheelbase ? opts.wheelbase / REF_WHEELBASE : 1;
  const turnR = TURN_R * scale, minR = MIN_R * scale, minLeg = 5 * scale;

  // Straight leg length and final heading.
  let straightM = 1.5 * turnR, finalHdg = wrap(h0 - Math.PI / 2), radius = turnR;
  if (opts.line) {
    const L = opts.line;
    const back = (L.x - stand.x) * bx + (L.y - stand.y) * by;     // distance back to the line
    // Of the two directions along the line, pick the one the aircraft can turn
    // into while backing (the nose ends up pointing away from the stand side).
    const d1 = L.hdgGrid, d2 = wrap(L.hdgGrid + Math.PI);
    finalHdg = Math.abs(wrap(d1 - h0)) <= Math.abs(wrap(d2 - h0)) ? d1 : d2;
    if (opts.preferHdgGrid !== undefined) {
      finalHdg = Math.abs(wrap(d1 - opts.preferHdgGrid)) <= Math.abs(wrap(d2 - opts.preferHdgGrid)) ? d1 : d2;
    }
  }
  if (opts.finalHdgGrid !== undefined) finalHdg = opts.finalHdgGrid;
  if (opts.line) {
    // Straight back a metres, then backing round an arc of radius R to finalHdg, must
    // end on the line: n·(stand + a·back + arc − line point) = 0, n the line's normal.
    const L = opts.line;
    const dh = wrap(finalHdg - h0), k = Math.sign(dh || 1) / turnR, h1 = h0 + dh;
    const arcX = -(Math.cos(h0) - Math.cos(h1)) / k, arcY = -(Math.sin(h1) - Math.sin(h0)) / k;
    const nx = Math.cos(L.hdgGrid), ny = -Math.sin(L.hdgGrid);
    const nb = nx * bx + ny * by;
    if (Math.abs(nb) > 0.2) {
      const want = nx * (L.x - stand.x) + ny * (L.y - stand.y), na = nx * arcX + ny * arcY;
      const a = (want - na) / nb;
      straightM = Math.max(minLeg, a);
      // Too close for the standard radius: turn tighter (the arc scales with the radius).
      if (a < minLeg && Math.abs(na) > 1e-6) {
        radius = Math.max(minR, Math.min(turnR, (want - minLeg * nb) / (na / turnR)));
        straightM = Math.max(minLeg, (want - na * radius / turnR) / nb);
      }
    }
  }

  const s = {
    phase: 'idle',          // idle | straight | turn | stopping | done
    running: false,         // P toggles this
    x: stand.x, y: stand.y, hdgGrid: h0,
    v: 0, pushedM: 0,
  };

  function toggle() {
    if (s.phase === 'done') return;
    if (s.phase === 'idle') s.phase = 'straight';
    s.running = !s.running;
  }

  function update(dt, inputs = {}) {
    if (inputs.p) toggle();
    let steer = inputs.steer ?? ((inputs.e ? 1 : 0) - (inputs.q ? 1 : 0));
    steer = Math.max(-1, Math.min(1, steer));

    const want = s.running && s.phase !== 'stopping' && s.phase !== 'done' ? SPEED : 0;
    s.v += Math.max(-ACCEL * dt, Math.min(ACCEL * dt, want - s.v));
    if (s.phase === 'stopping' && s.v <= 1e-3) { s.v = 0; s.phase = 'done'; s.running = false; }

    // Heading rate while backing: ω = v / R, signed so the heading moves towards finalHdg.
    let omega = 0;
    const remaining = wrap(finalHdg - s.hdgGrid);
    if (s.phase === 'turn') {
      omega = Math.sign(remaining) * (s.v / radius) * (1 + BIAS * steer * Math.sign(remaining));
      if (Math.abs(omega * dt) >= Math.abs(remaining)) { omega = remaining / Math.max(dt, 1e-6); s.phase = 'stopping'; }
    } else if (s.phase === 'straight') {
      omega = steer * BIAS * s.v / radius;   // small curve if the pilot asks for it
    }
    s.hdgGrid = wrap(s.hdgGrid + omega * dt);
    const ds = s.v * dt;
    s.x -= Math.sin(s.hdgGrid) * ds;
    s.y -= Math.cos(s.hdgGrid) * ds;
    s.pushedM += ds;
    if (s.phase === 'straight' && s.pushedM >= straightM) s.phase = 'turn';

    return { x: s.x, y: s.y, hdgGrid: s.hdgGrid, done: s.phase === 'done', phase: s.phase, speed: s.v };
  }

  // A scenario load (v0.2.0): the state as `state` gave it. The plan (finalHdg, straightM,
  // radius) comes from the stand and the line as at creation; a save may carry it too, so a
  // pushback planned under other data still ends where it would have.
  function setState(o = {}) {
    for (const k of ['phase', 'running', 'x', 'y', 'hdgGrid', 'v', 'pushedM']) if (o[k] !== undefined && o[k] !== null) s[k] = o[k];
    if (Number.isFinite(o.finalHdg)) finalHdg = o.finalHdg;
    if (Number.isFinite(o.straightM)) straightM = o.straightM;
    if (Number.isFinite(o.radius)) radius = o.radius;
  }

  return {
    toggle, update, setState,
    get state() { return { ...s, finalHdg, straightM, radius }; },
    get active() { return s.phase !== 'idle' && s.phase !== 'done'; },
  };
}

// Where a planned pushback goes: [x, y, hdgGrid] of the reference point, from the stand to its
// end, a pose every `stepS` seconds (a multiple of dt). Runs a copy of the plan, so the pushback
// itself isn't moved.
export function pushbackPoses(stand, state, stepS = 2, dt = 0.1) {
  const trial = createPushback(stand);
  trial.setState({ ...state, phase: 'idle', running: false, x: stand.x, y: stand.y, hdgGrid: stand.hdgGridDeg * Math.PI / 180, v: 0, pushedM: 0 });
  trial.toggle();
  const out = [[stand.x, stand.y, stand.hdgGridDeg * Math.PI / 180]];
  let o = null;
  for (let i = 0, n = Math.round(600 / dt), every = Math.round(stepS / dt); i < n && !(o && o.done); i++) {
    o = trial.update(dt, {});
    if ((i + 1) % every === 0 || o.done) out.push([o.x, o.y, o.hdgGrid]);
  }
  return out;
}
