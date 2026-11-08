// Boeing's autothrottle and AP modes (src/sim/autopilot-boeing.js), on the 787-9 through the
// registry. Numbers come from the type's module; tolerances are wide because the data can be tuned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { typeById } from '../src/sim/types.js';
import { predictSync } from '../src/sim/predict-core.js';

const TYPE = process.env.BOEING_TYPE || 'b787-9';
const A = typeById(TYPE).data;
const KT = A.KT, FT = A.FT, FPM = A.FPM, DEG = A.DEG, DT = 1 / 120;
const NM = 1852;
const lastFlap = A.FLAP_LEVER.length - 1;
const flat = () => ({ h: 0, kind: 'runway' });

function air({ frac = 0.75, altFt = 10000, iasKt = 250, flapLever = 0, gearDown = false, hdg = 0, x = 0, y = 0, ap, ground } = {}) {
  const sim = createSim({ type: TYPE, ...(ground ? { ground } : {}) });
  const mass = A.OEW + frac * (A.MLW - A.OEW);
  const fuelKg = Math.min(30000, (mass - A.OEW) / 2);
  sim.reset({ x, y, hdg, onGround: false, z: altFt * FT, iasMs: iasKt * KT, flapLever, gearDown, fuelKg, payloadKg: mass - A.OEW - fuelKg, ap });
  return sim;
}
function runway(frac = 0.6) {
  const sim = createSim({ type: TYPE, ground: flat });
  const mass = A.OEW + frac * (A.MTOW - A.OEW);
  const fuelKg = Math.min(50000, (mass - A.OEW) * 0.5);
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: true, flapLever: A.TAKEOFF_FLAP_LEVER, gearDown: true, fuelKg, payloadKg: mass - A.OEW - fuelKg });
  return sim;
}
function run(sim, seconds, fn) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    if (fn && fn(sim) === true) return true;
    sim.step(DT);
    if (sim.state.crashed) return false;
  }
  return false;
}
const apOn = (altFt, spdKt, more = {}) => ({ ap: true, athr: true, spdKt, hdgDeg: 0, altFt, ...more });

// ---- the autothrottle ----

test('A/T SPD holds the speed and moves the lever (state.athrActive)', () => {
  const sim = air({ ap: apOn(10000, 250) });
  const s = sim.state, c = sim.controls;
  run(sim, 5);
  assert.equal(sim.ap.thrustMode, 'SPD');
  assert.ok(s.athrActive);
  const lever0 = c.thrust;
  sim.ap.setSpd(280);
  run(sim, 15);
  assert.ok(c.thrust > lever0 + 0.05, `lever ${lever0.toFixed(2)} → ${c.thrust.toFixed(2)}`);
  run(sim, 120);
  assert.ok(Math.abs(s.ias - 280 * KT) < 4 * KT, `IAS ${(s.ias / KT).toFixed(1)}`);
  assert.ok(Math.abs(s.pos.z - 10000 * FT) < 60 * FT);
});

test('lever override: moved by hand against the servo, no disconnect, and it takes back after release', () => {
  const sim = air({ ap: apOn(10000, 250) });
  const s = sim.state, c = sim.controls;
  run(sim, 10);
  const settled = c.thrust;
  // What input.js does while R is held: it writes its own lever each frame.
  let lever = settled;
  for (let i = 0; i < 120 * 2; i++) {
    if (i % 2 === 0) lever = Math.min(1, lever + 0.55 / 60);
    c.thrust = lever;
    sim.step(DT);
  }
  assert.ok(sim.ap.athr, 'still engaged');
  assert.equal(sim.ap.thrustMode, 'SPD');
  assert.equal(s.athrActive, false, 'not driving while the hand is there');
  assert.ok(Math.abs(c.thrust - lever) < 1e-12, 'and the thrust is the hand\'s');
  assert.equal(sim.events.filter((e) => e.type === 'athrDisconnect').length, 0);
  const n1Up = s.engines[0].n1Target;
  // Released: the lever stays for the lag, then the A/T has it back and brings it down.
  run(sim, 0.5);
  assert.equal(s.athrActive, false);
  run(sim, 1);
  assert.ok(s.athrActive, 'back after the lag');
  run(sim, 60);
  assert.ok(c.thrust < lever - 0.1, `lever back to ${c.thrust.toFixed(2)}`);
  assert.ok(s.engines[0].n1Target < n1Up);
  assert.ok(Math.abs(s.ias - 250 * KT) < 6 * KT);
});

test('X turns it off (the disconnect switch), and on again', () => {
  const sim = air({ ap: apOn(10000, 250) });
  run(sim, 2);
  sim.ap.toggleAthr();
  assert.equal(sim.ap.athr, false);
  assert.equal(sim.ap.thrustMode, '');
  run(sim, 1);
  assert.equal(sim.state.athrActive, false);
  const l = sim.controls.thrust;
  sim.controls.thrust = l + 0.1;
  run(sim, 3);
  assert.ok(Math.abs(sim.controls.thrust - l - 0.1) < 1e-12, 'the lever stays with the pilot');
  sim.ap.toggleAthr();
  assert.equal(sim.ap.athr, true);
  assert.equal(sim.ap.thrustMode, 'SPD');
  run(sim, 1);
  assert.ok(sim.state.athrActive);
});

// A pilot holding the altitude by hand at idle, as the speed runs off.
const holdLevel = (sim) => { sim.controls.pitch = Math.max(-0.3, Math.min(0.5, -0.0015 * sim.state.vs / FPM + 0.02)); };

test('A/T wake-up: armed but off, near the shaker it comes on in SPD and recovers the speed', () => {
  const sim = air({ altFt: 8000, iasKt: 230 });
  const s = sim.state, c = sim.controls;
  c.thrust = 0;
  let wokeAt = -1, wakeIas = 0, minIas = 1e9, shaker = false;
  run(sim, 200, () => {
    holdLevel(sim);
    minIas = Math.min(minIas, s.ias);
    if (sim.ap.athr && wokeAt < 0) { wokeAt = s.t; wakeIas = s.ias; }
    return wokeAt > 0 && s.t > wokeAt + 45;
  });
  assert.ok(wokeAt > 0, 'it woke');
  assert.equal(sim.ap.thrustMode, 'SPD');
  assert.ok(sim.events.some((e) => e.type === 'athrWake'));
  assert.ok(wakeIas < s.vmm, `at ${(wakeIas / KT).toFixed(0)} kt, under vmm ${(s.vmm / KT).toFixed(0)}`);
  assert.ok(Math.abs(wakeIas - s.vStick) < 15 * KT, `near the shaker's ${(s.vStick / KT).toFixed(0)} kt`);
  assert.ok(minIas > s.vStick - 15 * KT, `it recovered from ${(minIas / KT).toFixed(0)} kt`);
  assert.ok(c.thrust > 0.5, `lever advanced to ${c.thrust.toFixed(2)}`);
  assert.ok(s.ias > minIas + 20 * KT, `IAS ${(s.ias / KT).toFixed(0)} kt`);
  assert.equal(s.crashed, null);
});

test('no wake-up in FLCH SPD with the A/T in HOLD: the trap the sources describe', () => {
  const sim = air({ altFt: 8000, iasKt: 230, ap: apOn(4000, 230) });
  const s = sim.state, c = sim.controls;
  sim.ap.levelChange();
  run(sim, 60, () => sim.ap.thrustMode === 'HOLD');
  assert.equal(sim.ap.thrustMode, 'HOLD');
  sim.ap.disconnectAp();
  let minIas = 1e9;
  run(sim, 200, () => { holdLevel(sim); minIas = Math.min(minIas, s.ias); return s.ias < s.vStick - 8 * KT; });
  assert.equal(sim.ap.thrustMode, 'HOLD', 'it stayed asleep');
  assert.ok(c.thrust <= 0.001, 'with the levers at idle');
  assert.ok(minIas < s.vmm, `down to ${(minIas / KT).toFixed(0)} kt`);
  assert.ok(!sim.events.some((e) => e.type === 'athrWake'));
  // V/S is the way out; then the protection's back.
  sim.ap.setVs(-500);
  assert.equal(sim.ap.thrustMode, 'SPD');
});

test('the arm switch off: nothing wakes it', () => {
  const sim = air({ altFt: 8000, iasKt: 230 });
  const s = sim.state, c = sim.controls;
  sim.ap.setAthrArm(false);
  c.thrust = 0;
  run(sim, 200, () => { holdLevel(sim); return s.ias < s.vStick - 8 * KT; });
  assert.equal(sim.ap.athr, false);
  assert.ok(s.ias < s.vmm);
});

// ---- TO/GA ----

test('TO/GA take-off: levers to THR REF, HOLD at 80 kt and up to 400 ft, then THR REF; LNAV and VNAV arm for later', () => {
  const sim = runway();
  const s = sim.state, c = sim.controls;
  sim.ap.setAlt(5000);
  sim.ap.toga();
  assert.equal(sim.ap.thrustMode, 'THR REF');
  assert.equal(sim.ap.lateral, 'TO/GA');
  assert.equal(sim.ap.vertical, 'TO/GA');
  run(sim, 5);
  assert.ok(c.thrust > 0.5 && s.athrActive, `lever at ${c.thrust.toFixed(2)}`);
  const seq = ['THR REF'];
  const at = {};
  const vr = 1.12 * (s.vmm / 1.3) / KT + 8;
  let leverHold = -1;
  run(sim, 200, () => {
    const m = sim.ap.thrustMode;
    if (m !== seq[seq.length - 1]) { seq.push(m); at[m] = at[m] ?? { ias: s.ias / KT, agl: s.agl / FT, lever: c.thrust }; }
    if (m === 'HOLD' && !s.onGround && leverHold < 0) leverHold = c.thrust;
    if (s.ias > vr * KT) c.pitch = s.pitch < 9 * DEG ? 0.8 : s.pitch < 13 * DEG ? 0.15 : 0;
    return s.agl > 800 * FT;
  });
  assert.equal(s.crashed, null);
  assert.deepEqual(seq.slice(0, 3), ['THR REF', 'HOLD', 'THR REF'], seq.join(' → '));
  assert.ok(Math.abs(at.HOLD.ias - 80) < 3, `HOLD at ${at.HOLD.ias.toFixed(1)} kt`);
  assert.ok(at['THR REF'] === undefined || at['THR REF'].agl > 0);
  assert.ok(s.vs > 0 && s.agl > 800 * FT);
});

test('TO/GA hold: a hand on the lever in the take-off roll is HOLD, and no push back', () => {
  const sim = runway();
  const c = sim.controls;
  sim.ap.toga();
  run(sim, 8);
  c.thrust = 0;
  run(sim, 3);
  assert.equal(sim.ap.thrustMode, 'HOLD');
  assert.equal(c.thrust, 0);
  assert.equal(sim.state.athrActive, false);
});

test('TO/GA in the air: a go-around from an approach', () => {
  const sim = air({ altFt: 800, iasKt: 170, flapLever: lastFlap, gearDown: true, ground: flat, ap: apOn(4000, 170) });
  const s = sim.state;
  sim.ap.setVs(-700);
  run(sim, 15);
  sim.ap.toga();
  assert.equal(sim.ap.vertical, 'TO/GA');
  assert.equal(sim.ap.thrustMode, 'THR REF');
  run(sim, 40);
  assert.ok(s.vs > 500 * FPM, `climbing ${(s.vs / FPM).toFixed(0)} fpm`);
  assert.ok(sim.controls.thrust > 0.7);
  assert.ok(sim.ap.ap);
});

// ---- vertical modes ----

test('FLCH climb: THR up to the rating, the speed on the elevator, and ALT at the MCP altitude', () => {
  const sim = air({ altFt: 10000, iasKt: 280, ap: apOn(15000, 280) });
  const s = sim.state;
  sim.ap.levelChange();
  assert.equal(sim.ap.vertical, 'FLCH SPD');
  assert.equal(sim.ap.thrustMode, 'THR');
  let lo = 1e9, hi = 0, peak = 0;
  run(sim, 400, () => {
    if (s.t > 20 && sim.ap.vertical === 'FLCH SPD') { lo = Math.min(lo, s.ias); hi = Math.max(hi, s.ias); }
    peak = Math.max(peak, s.pos.z);
    return sim.ap.vertical === 'ALT' && Math.abs(s.pos.z - 15000 * FT) < 15 * FT && Math.abs(s.vs) < 100 * FPM;
  });
  assert.equal(sim.ap.vertical, 'ALT');
  assert.equal(sim.ap.thrustMode, 'SPD');
  assert.ok(lo > 270 * KT && hi < 290 * KT, `IAS ${(lo / KT).toFixed(1)}–${(hi / KT).toFixed(1)}`);
  assert.ok(peak < (15000 + 150) * FT, `peak ${(peak / FT).toFixed(0)} ft`);
});

test('FLCH descent: THR, then HOLD at idle, and ALT at the MCP altitude with SPD again', () => {
  const sim = air({ altFt: 20000, iasKt: 290, ap: apOn(12000, 290) });
  const s = sim.state, c = sim.controls;
  sim.ap.levelChange();
  const modes = new Set();
  let lo = 1e9, hi = 0, low = 1e9;
  run(sim, 600, () => {
    modes.add(sim.ap.thrustMode);
    if (s.t > 30 && sim.ap.vertical === 'FLCH SPD') { lo = Math.min(lo, s.ias); hi = Math.max(hi, s.ias); }
    low = Math.min(low, s.pos.z);
    return sim.ap.vertical === 'ALT' && Math.abs(s.pos.z - 12000 * FT) < 15 * FT && Math.abs(s.vs) < 100 * FPM;
  });
  assert.ok(modes.has('THR') && modes.has('HOLD'), [...modes].join(','));
  assert.equal(sim.ap.vertical, 'ALT');
  assert.equal(sim.ap.thrustMode, 'SPD');
  assert.ok(s.athrActive, 'the servos are back');
  assert.ok(lo > 278 * KT && hi < 302 * KT, `IAS ${(lo / KT).toFixed(1)}–${(hi / KT).toFixed(1)}`);
  assert.ok(low > (12000 - 150) * FT, `low ${(low / FT).toFixed(0)} ft`);
});

test('FLCH: a small change has partial thrust (THR), for two minutes\' worth', () => {
  const sim = air({ altFt: 10000, iasKt: 280, ap: apOn(11000, 280) });
  const s = sim.state;
  sim.ap.levelChange();
  run(sim, 30);
  assert.equal(sim.ap.vertical, 'FLCH SPD');
  assert.equal(sim.ap.thrustMode, 'THR');
  assert.ok(sim.controls.thrust < Math.sqrt(A.RATING.CL) - 0.02, `lever ${sim.controls.thrust.toFixed(2)}`);
  assert.ok(s.vs > 200 * FPM && s.vs < 1500 * FPM, `V/S ${(s.vs / FPM).toFixed(0)} fpm`);
});

test('V/S holds its rate with the A/T on the speed, then captures ALT', () => {
  const sim = air({ altFt: 8000, iasKt: 260, ap: apOn(11000, 260) });
  const s = sim.state;
  sim.ap.setVs(1500);
  run(sim, 40);
  assert.equal(sim.ap.vertical, 'V/S');
  assert.ok(Math.abs(s.vs - 1500 * FPM) < 100 * FPM, `V/S ${(s.vs / FPM).toFixed(0)} fpm`);
  assert.ok(Math.abs(s.ias - 260 * KT) < 6 * KT);
  let peak = 0;
  run(sim, 200, () => { peak = Math.max(peak, s.pos.z); return Math.abs(s.pos.z - 11000 * FT) < 15 * FT && Math.abs(s.vs) < 100 * FPM; });
  assert.equal(sim.ap.vertical, 'ALT');
  assert.ok(peak < (11000 + 100) * FT, `overshoot ${(peak / FT - 11000).toFixed(0)} ft`);
  // ALT stays put with the MCP moved, until a mode's asked for.
  sim.ap.setAlt(20000);
  run(sim, 20);
  assert.ok(Math.abs(s.pos.z - 11000 * FT) < 40 * FT);
  // altHold(): the altitude where it's pressed.
  sim.ap.setVs(-1000);
  run(sim, 20);
  const at = s.pos.z;
  sim.ap.altHold();
  run(sim, 40);
  assert.equal(sim.ap.vertical, 'ALT');
  assert.ok(Math.abs(s.pos.z - at) < 150 * FT);
});

test('VNAV: climb on the schedule at THR REF, level as VNAV ALT; descent to the MCP altitude', () => {
  const sim = air({ altFt: 6000, iasKt: 240, ap: apOn(14000, 240) });
  const s = sim.state;
  sim.ap.vnav();
  assert.equal(sim.ap.vertical, 'VNAV SPD');
  assert.equal(sim.ap.thrustMode, 'THR REF');
  run(sim, 120, () => s.pos.z > 9000 * FT);
  assert.ok(Math.abs(s.ias - 250 * KT) < 8 * KT, `below 10,000 ft: ${(s.ias / KT).toFixed(1)} kt`);
  run(sim, 500, () => sim.ap.vertical === 'VNAV ALT');
  assert.equal(sim.ap.vertical, 'VNAV ALT');
  assert.ok(s.ias > 270 * KT, `above 10,000 ft it's gone for the schedule: ${(s.ias / KT).toFixed(1)} kt`);
  run(sim, 120);
  assert.ok(Math.abs(s.pos.z - 14000 * FT) < 50 * FT);
  assert.equal(sim.ap.thrustMode, 'SPD');
  assert.ok(Math.abs(s.ias - 310 * KT) < 12 * KT, `level: ${(s.ias / KT).toFixed(1)} kt`);
  sim.ap.setAlt(11000);
  sim.ap.vnav();
  assert.equal(sim.ap.thrustMode, 'IDLE');
  const modes = new Set();
  run(sim, 300, () => { modes.add(sim.ap.thrustMode); return sim.ap.vertical === 'VNAV ALT' && Math.abs(s.pos.z - 11000 * FT) < 40 * FT; });
  assert.ok(modes.has('HOLD'), [...modes].join(','));
  assert.equal(sim.ap.vertical, 'VNAV ALT');
});

// ---- lateral modes ----

test('HDG SEL turns at no more than 25° and rolls out; HDG HOLD keeps the heading', () => {
  const sim = air({ ap: apOn(10000, 250) });
  const s = sim.state;
  sim.ap.setHdg(90);
  sim.ap.hdgSel();
  let maxBank = 0;
  run(sim, 120, () => { maxBank = Math.max(maxBank, Math.abs(s.roll)); });
  assert.ok(maxBank < 27 * DEG, `bank ${(maxBank / DEG).toFixed(1)}°`);
  assert.ok(maxBank > 15 * DEG);
  assert.ok(Math.abs(s.roll) < 2 * DEG);
  sim.ap.hdgHold();
  run(sim, 10);
  const hold = s.hdg;
  run(sim, 30);
  assert.ok(Math.abs(s.hdg - hold) < 1 * DEG);
  assert.equal(sim.ap.lateral, 'HDG HOLD');
});

test('LNAV flies two waypoints in turn and ends in HDG HOLD', () => {
  const sim = air({ ap: apOn(10000, 280), x: 0, y: 0 });
  const s = sim.state;
  sim.ap.setRoute([[0, 30000], [30000, 45000]]);
  sim.ap.lnav();
  assert.equal(sim.ap.lateral, 'LNAV');
  let pass0 = 1e9, pass1 = 1e9, sawTwo = false;
  run(sim, 500, () => {
    pass0 = Math.min(pass0, Math.hypot(s.pos.x, s.pos.y - 30000));
    pass1 = Math.min(pass1, Math.hypot(s.pos.x - 30000, s.pos.y - 45000));
    if (sim.ap.routeIdx === 1) sawTwo = true;
    return sim.ap.lateral !== 'LNAV';
  });
  assert.ok(sawTwo);
  assert.equal(sim.ap.lateral, 'HDG HOLD');
  assert.ok(pass0 < 2.2 * NM, `first ${(pass0 / NM).toFixed(2)} nm`);
  assert.ok(pass1 < 2.2 * NM, `second ${(pass1 / NM).toFixed(2)} nm`);
  // Toward the second one: its bearing is about 63° from the first.
  const brg = Math.atan2(30000, 15000);
  assert.ok(Math.abs(s.hdg - brg) < 12 * DEG, `heading ${(s.hdg / DEG).toFixed(0)}°`);
});

// ---- the ILS ----

const ILS = { x: 0, y: 0, hdgGrid: 0, elev: 0, gsDeg: 3 };

// 15 nm out, a little off the centreline, below the beam, in the landing configuration.
function final15() {
  const dist = 15 * NM;
  const beam = dist * Math.tan(3 * DEG);
  const probe = air({ altFt: 3000, iasKt: 200, flapLever: lastFlap, gearDown: true, ground: flat });
  const vapp = Math.round(probe.state.vmm / KT + 6);
  const sim = air({ altFt: (beam - 150) / FT, iasKt: vapp, flapLever: lastFlap, gearDown: true, hdg: 15 * DEG, x: -1500, y: -dist,
    ground: flat, ap: apOn(Math.round((beam - 150) / FT), vapp, { vertical: 'ALT', lateral: 'HDG HOLD' }) });
  sim.controls.spoilersArmed = true;
  sim.ap.setIls(ILS);
  sim.ap.app();
  return sim;
}

test('LOC + G/S from a 15 nm final, autoland, FLARE, IDLE at 25 ft, ROLLOUT on the centreline', () => {
  const sim = final15();
  const s = sim.state, c = sim.controls, ap = sim.ap;
  assert.equal(ap.armedLateral, 'LOC');
  assert.equal(ap.armedVertical, 'G/S');
  const beam = (d) => 50 * FT + d * Math.tan(3 * DEG);
  let locAt = -1, gsAt = -1, flareFt = -1, idleFt = -1, maxDev = 0, maxXte = 0;
  const done = run(sim, 500, () => {
    if (ap.lateral === 'LOC' && locAt < 0) locAt = s.t;
    if (ap.vertical === 'G/S' && gsAt < 0) gsAt = s.t;
    if (ap.vertical === 'FLARE' && flareFt < 0) flareFt = s.agl / FT;
    if (ap.thrustMode === 'IDLE' && idleFt < 0) idleFt = s.agl / FT;
    if (gsAt > 0 && s.agl > 200 * FT && s.t > gsAt + 40) maxDev = Math.max(maxDev, Math.abs(s.pos.z - beam(-s.pos.y)));
    if (locAt > 0 && s.t > locAt + 60) maxXte = Math.max(maxXte, Math.abs(s.pos.x));
    return s.onGround && !sim.state.wow.nose ? false : s.onGround && s.wow.nose;
  });
  assert.ok(done, `landed (${s.crashed}, agl ${(s.agl / FT).toFixed(0)} ft)`);
  assert.ok(locAt > 0 && gsAt > 0, 'LOC and G/S captured');
  assert.ok(maxDev < 40 * FT, `G/S deviation ${(maxDev / FT).toFixed(0)} ft`);
  assert.ok(maxXte < 30, `LOC deviation ${maxXte.toFixed(0)} m`);
  assert.ok(flareFt > 35 && flareFt <= 52, `FLARE at ${flareFt.toFixed(0)} ft`);
  assert.ok(idleFt > 10 && idleFt < 30, `IDLE at ${idleFt.toFixed(0)} ft`);
  assert.equal(ap.ap, true, 'the AP stays on after touchdown');
  assert.equal(ap.lateral, 'ROLLOUT');
  assert.equal(ap.thrustMode, 'IDLE');
  run(sim, 2, () => sim.events.some((e) => e.type === 'touchdown'));
  const ev = sim.events.find((e) => e.type === 'touchdown');
  assert.ok(ev, 'a touchdown event');
  assert.ok(ev.vsMs > -360 * FPM && ev.vsMs < 0, `touchdown ${(ev.vsMs / FPM).toFixed(0)} fpm`);
  assert.ok(ev.y > 100 && ev.y < 1400, `${ev.y.toFixed(0)} m past the threshold`);
  assert.ok(Math.abs(ev.bank) < 4 * DEG);
  // The roll-out: ground spoilers, centreline, to a slow speed with the brakes on.
  let maxRoll = 0;
  run(sim, 120, () => {
    maxRoll = Math.max(maxRoll, Math.abs(s.pos.x));
    if (s.ias < 100 * KT) { c.brakeL = 0.5; c.brakeR = 0.5; }
    return s.gs < 20 * KT;
  });
  assert.ok(s.groundSpoilers > 0.3 || s.gs < 25 * KT, 'spoilers deployed');
  assert.ok(maxRoll < 10, `centreline within ${maxRoll.toFixed(1)} m`);
  assert.equal(s.crashed, null);
  // Below 30 kt the rollout hands back (v0.3.0's review: it used to hold the centreline until the
  // pilot disconnected, so Q/E did nothing at taxi speed, with the taxi route turning off).
  assert.equal(ap.ap, false, 'the AP lets go below 30 kt');
  assert.ok(sim.events.some((e) => e.type === 'apDisconnect' && e.reason === 'rollout'), 'and says so');
  run(sim, 1);
  assert.equal(c.yaw, 0, 'the pedals are let go');
  assert.equal(ap.lateral, 'HDG HOLD');
  // The steering is the pilot's again.
  c.brakeL = c.brakeR = 0; c.thrust = 0.35;
  const h0 = s.hdg;
  run(sim, 15, () => { c.yaw = 1; });
  const dh = Math.abs(Math.atan2(Math.sin(s.hdg - h0), Math.cos(s.hdg - h0)));
  assert.ok(dh > 10 * DEG, `steered ${(dh / DEG).toFixed(1)}°`);
});

// ---- saves and the prediction ----

test('a restored save flies on within 1e-6 m (FLCH with LNAV, then an ILS) and the prediction agrees', () => {
  // Mid-FLCH, on LNAV: restored into a new sim, the two fly the same 200 s.
  const a = air({ altFt: 15000, iasKt: 280, ap: apOn(8000, 280) });
  a.ap.setRoute([[0, 40000], [20000, 70000]]);
  a.ap.lnav();
  a.ap.levelChange();
  a.controls.trim = 0;
  run(a, 40);
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  const b = createSim({ type: TYPE });
  b.restore(snap);
  run(a, 200); run(b, 200);
  const d = Math.hypot(a.state.pos.x - b.state.pos.x, a.state.pos.y - b.state.pos.y, a.state.pos.z - b.state.pos.z);
  assert.ok(d < 1e-6, `${d} m`);
  assert.equal(a.ap.vertical, b.ap.vertical);
  assert.equal(a.ap.thrustMode, b.ap.thrustMode);

  // The prediction, the same run from the same snapshot at the same step and at the coarse one.
  const c = createSim({ type: TYPE });
  c.restore(snap);
  const r = predictSync(snap, { dt: DT, maxMinutes: 200 / 60, sampleEvery: 200 });
  run(c, 200);
  const last = r.samples[r.samples.length - 1];
  const e = Math.hypot(last.x - c.state.pos.x, last.y - c.state.pos.y, last.z - c.state.pos.z);
  assert.ok(e < 1e-6, `prediction ${e} m (${r.reason})`);
  const coarse = predictSync(snap, { maxMinutes: 200 / 60 });
  const cl = coarse.samples[coarse.samples.length - 1];
  assert.ok(Math.hypot(cl.x - last.x, cl.y - last.y) < 0.005 * Math.hypot(last.x - snap.core.px, last.y - snap.core.py) + 50, 'the coarse step lands close by');
});

test('a save in the ILS with the override running restores exactly too', () => {
  const a = final15();
  run(a, 60);
  a.controls.thrust = Math.min(1, a.controls.thrust + 0.1);
  run(a, 0.25);
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  assert.ok(snap.ap.ils && snap.ap.armedVertical !== undefined, 'the ILS is in the save');
  const b = createSim({ type: TYPE, ground: flat });
  b.restore(snap);
  run(a, 100); run(b, 100);
  const d = Math.hypot(a.state.pos.x - b.state.pos.x, a.state.pos.y - b.state.pos.y, a.state.pos.z - b.state.pos.z);
  assert.ok(d < 1e-6, `${d} m`);
  assert.equal(a.ap.vertical, 'G/S');
});

test('engaging: not on the ground or too low, and firm stick disconnects', () => {
  const g = runway();
  assert.equal(g.ap.engageAp(), false);
  const sim = air({ ap: { athr: true, spdKt: 250, altFt: 10000 } });
  run(sim, 1);
  assert.equal(sim.ap.engageAp(), true);
  assert.equal(sim.ap.lateral, 'HDG HOLD');
  assert.equal(sim.ap.vertical, 'ALT');
  sim.controls.pitch = 0.6;
  run(sim, 0.1);
  assert.equal(sim.ap.ap, false);
  assert.ok(sim.events.some((e) => e.type === 'apDisconnect'));
});

// ---- From v0.3.0's review ----
test('a route edited in flight goes on from the point ahead, not back to one passed', () => {
  const sim = createSim({ type: TYPE });
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 3000, iasMs: 250 * 0.514444, flapLever: 0, gearDown: false, fuelKg: 20000, payloadKg: 20000 });
  sim.ap.setRoute([[0, -9000], [0, -2000], [0, 20000], [0, 40000]]);
  assert.equal(sim.ap.routeIdx, 2);
  sim.ap.setRoute([[0, -9000]]);
  assert.equal(sim.ap.routeIdx, 0, 'the last point always stays');
});

test('the prediction of an autoland ends on the runway, not in the terrain', () => {
  // The worker's ground: heights only, no runways, so a runway reads as 'ground'.
  const hf = { heightAt: () => 20 };
  const sim = createSim({ type: TYPE, ground: () => ({ h: 20, kind: 'runway' }) });
  const FT_ = 0.3048, d = 6 * 1852;
  sim.reset({ x: 0, y: -d, z: 20 + 15 + Math.tan(3 * DEG) * d, hdg: 0, onGround: false, iasMs: 170 * KT, flapLever: sim.type.data.FLAP_LEVER.indexOf('30'), gearDown: true, fuelKg: 15000, payloadKg: 25000, ap: { ap: true, athr: true, spdKt: 170, hdgDeg: 0, altFt: 3000 } });
  sim.controls.gearDown = true;
  sim.ap.setIls({ x: 0, y: 0, hdgGrid: 0, elev: 20, gsDeg: 3 });
  sim.ap.setSpd(Math.round(sim.state.vmm / KT + 8));
  sim.ap.app();
  const r = predictSync(sim.snapshot(), { maxMinutes: 10 }, hf);
  assert.equal(r.reason, 'landed', `${r.reason}, ended at ${(r.samples.at(-1).z / FT_).toFixed(0)} ft`);
  assert.ok(!r.samples.at(-1).terrain);
});

// v0.3.2 (Shane: "I just want to know what happens a little higher"): the MCP goes to 45,000 ft,
// past both types' 43,100 ft ceiling. A light one gets there (about 6–7 min from FL410 by FLCH).
test('the MCP altitude goes to 45,000 ft, past the ceiling, and a light one climbs there and levels off', () => {
  const sim = air({ frac: 0.2, altFt: 41000, iasKt: 250, ap: apOn(41000, 250) });
  run(sim, 60);
  sim.ap.setAlt(47000);
  assert.equal(sim.ap.altFt, 45000, 'the top is 45,000 ft');
  assert.ok(45000 > A.MAX_ALT_FT);
  sim.ap.levelChange();
  const there = (s) => s.ap.vertical === 'ALT' && Math.abs(s.state.pos.z - 45000 * FT) < 50 * FT;
  assert.ok(run(sim, 12 * 60, there), `stuck at ${(sim.state.pos.z / FT).toFixed(0)} ft in ${sim.ap.vertical}`);
  run(sim, 120);
  assert.ok(there(sim) && sim.ap.ap, `held: ${(sim.state.pos.z / FT).toFixed(0)} ft, ${sim.ap.vertical}`);
  assert.ok(sim.state.ias > sim.state.vStick && sim.state.ias < sim.state.vmax, 'between the shaker and the limit');
});
