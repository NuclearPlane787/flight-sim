// AP1 and A/THR, holds only: HDG (bank ≤ 25°), ALT with ALT* capture, V/S, OP CLB / OP DES
// (speed on the elevator, THR CLB / THR IDLE) and A/THR SPEED up to climb thrust. Since
// v0.2.2 the A/THR moves the thrust lever while it's active (athrStep).
// The AP drives the fly-by-wire's demands (a flight-path angle and a bank angle), never the
// surfaces. Allocation free in the step.

import * as A321 from './a321neo.js';
import { createEngines } from './engines.js';
import { magToGrid } from '../world/frame.js';

const G = 9.80665;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const ALT_KH = 0.1; // 1/s: ALT* captures with a 10 s exponential approach

// Fields in sim.ap that a snapshot carries.
export const AP_FIELDS = ['ap', 'athr', 'spdKt', 'hdgDeg', 'altFt', 'vsFpm', 'lateral', 'vertical', 'thrustMode'];

export function createAutopilot(A) {
const { LEVER_CL, leverToPhi, leverForPhi } = createEngines(A);

// The FCU-facing object (sim.ap). `core` gives it access to the sim's state. `target`: the object
// to fill (sim.ap keeps its identity when the sim changes type).
function createAp(core, target = {}) {
  const ap = Object.assign(target, {
    ap: false, athr: false,
    spdKt: 250, hdgDeg: 0, altFt: 5000, vsFpm: 0,
    lateral: 'HDG', vertical: 'V/S', thrustMode: '',
    engageAp() {
      const S = core.state;
      if (S.onGround || S.agl < 100 * A.FT || core.X.airTime < 5) return false;
      ap.ap = true;
      ap.lateral = 'HDG';
      const dh = ap.altFt * A.FT - S.altInd;
      if (Math.abs(dh) < 60 * A.FT) ap.vertical = 'ALT';
      else {
        ap.vertical = 'V/S';
        ap.vsFpm = Math.round(S.vs / A.FPM / 100) * 100;
      }
      core.X.hdgTimer = 0;
      if (ap.athr) ap.thrustMode = 'SPEED';
      return true;
    },
    disconnectAp(reason = 'manual') {
      if (!ap.ap) return;
      ap.ap = false;
      core.X.apDiscT = 3;
      core.events.push({ type: 'apDisconnect', reason });
    },
    toggleAthr() {
      ap.athr = !ap.athr;
      if (ap.athr) { core.X.athrPhi = core.X.phiNow; ap.thrustMode = modeThrust(ap); }
      else { ap.thrustMode = ''; core.X.alphaFloorLock = false; }
    },
    setAlt(ft) { ap.altFt = clamp(Math.round(ft), 100, 41000); },
    setHdg(deg) { ap.hdgDeg = ((Math.round(deg) % 360) + 360) % 360; ap.lateral = 'HDG'; core.X.hdgTimer = 0; },
    setSpd(kt) { ap.spdKt = clamp(Math.round(kt), 100, 399); },
    setVs(fpm) {
      ap.vsFpm = clamp(Math.round(fpm / 100) * 100, -6000, 6000);
      ap.vertical = 'V/S';
      if (ap.athr) ap.thrustMode = 'SPEED';
    },
    levelChange() {
      const dh = ap.altFt * A.FT - core.state.altInd;
      if (Math.abs(dh) < 60 * A.FT) { ap.vertical = 'ALT'; return; }
      ap.vertical = dh > 0 ? 'OP CLB' : 'OP DES';
      core.X.opGamma = core.state.vs / Math.max(core.state.tas, 50);
      core.X.opInt = 0;
      if (ap.athr) ap.thrustMode = modeThrust(ap);
    },
    // No TO/GA switch, no trim, no LOC or G/S on the A321's FCU: those are the Boeings' (v0.3.0).
  });
  return ap;
}

function modeThrust(ap) {
  if (ap.vertical === 'OP CLB') return 'THR CLB';
  if (ap.vertical === 'OP DES') return 'THR IDLE';
  return 'SPEED';
}

// One AP step: fills E.apOn, E.apGamma, E.apBank. Runs before the fly-by-wire.
function apStep(X, ap, E, S, dt) {
  E.apOn = ap.ap;
  if (!ap.ap) return;
  const V = Math.max(E.tas, 50);

  // Lateral: HDG. The FCU heading is magnetic; refresh the grid target every 2 s.
  X.hdgTimer -= dt;
  if (X.hdgTimer <= 0) { X.hdgGridTgt = magToGrid(ap.hdgDeg * A.DEG, S.pos.x, S.pos.y); X.hdgTimer = 2; }
  const dpsi = wrapPi(X.hdgGridTgt - E.psi);
  E.apBank = clamp(2.2 * dpsi, -25 * A.DEG, 25 * A.DEG);

  // Vertical.
  const h = S.altInd, tgt = ap.altFt * A.FT, dh = tgt - h;
  let vsCmd;
  if (ap.vertical === 'V/S' || ap.vertical === 'OP CLB' || ap.vertical === 'OP DES') {
    const towards = (ap.vertical === 'V/S' ? ap.vsFpm * dh > 0 : true) && Math.abs(dh) > 1;
    const capDist = Math.abs(E.vs) / ALT_KH;
    if (towards && Math.abs(dh) < capDist && Math.sign(E.vs) === Math.sign(dh)) {
      ap.vertical = 'ALT*';
      X.capVs = Math.abs(E.vs);
      if (ap.athr && !X.alphaFloorLock) ap.thrustMode = 'SPEED';
    }
  }
  switch (ap.vertical) {
    case 'ALT*':
      vsCmd = clamp(ALT_KH * dh, -X.capVs, X.capVs);
      if (Math.abs(dh) < 20 * A.FT && Math.abs(E.vs) < 150 * A.FPM) ap.vertical = 'ALT';
      break;
    case 'ALT':
      vsCmd = clamp(0.15 * dh, -1000 * A.FPM, 1000 * A.FPM);
      break;
    case 'V/S':
      vsCmd = ap.vsFpm * A.FPM;
      break;
    case 'OP CLB':
    case 'OP DES': {
      // Speed on the elevator: the flight path that leaves the wanted acceleration.
      const err = ap.spdKt * A.KT - E.ias;
      X.opInt = clamp((X.opInt || 0) + 0.01 * err * dt, -0.2, 0.2); // trims out the lag
      const aWant = clamp(0.08 * err + X.opInt, -0.6, 0.6);
      let gam = Math.asin(clamp((E.fAlong / E.mass - aWant) / G, -0.25, 0.25));
      if (ap.vertical === 'OP CLB') gam = Math.max(gam, 300 * A.FPM / V);
      else gam = Math.min(gam, -500 * A.FPM / V);
      X.opGamma += (gam - X.opGamma) * Math.min(1, dt / 2.0);
      vsCmd = X.opGamma * V;
      break;
    }
    default: vsCmd = 0;
  }
  E.apGamma = Math.asin(clamp(vsCmd / V, -0.3, 0.3));
}

// Autothrust and the thrust demand. Returns the forward demand phi (0..1) for the lever.
// v0.2.2 (Shane: "When autothrottle is on, the blue dot on the engine power view doesn't
// move. So when I press R or F slightly, the engines change power significantly. Have
// autothrottle move this blue dot as well."): while A/THR is active it moves the thrust lever
// itself, as a Boeing's autothrottle does (an Airbus's levers stay in CL). X.athrLever is where
// it puts the lever (sim.js writes it to the controls) and X.athrDriving says that it does.
// A pilot who moves the lever while it drives takes the thrust from where it was, and A/THR
// disconnects (X.athrOffBy: 'idle' if the lever went to idle, the usual way and the RETARD at
// landing, else 'lever'). Armed, on the ground or with the lever above CL in flight (MAN TOGA,
// FLX), it doesn't move the lever; brought back to CL or below in flight, the lever is the
// A/THR's again. Alpha floor puts the lever at TOGA, and can't be overridden while it's on.
function athrStep(X, ap, E, lever, dt) {
  if (X.athrDriving && lever !== X.athrLever && !(X.alphaFloorLock && X.alphaFloorTrig)) {
    X.athrDriving = false;
    if (ap.athr) {
      ap.athr = false; ap.thrustMode = ''; X.alphaFloorLock = false;
      X.athrOffBy = lever <= 0.02 ? 'idle' : 'lever';
    }
  }
  const leverPhi = leverToPhi(lever);
  if (X.alphaFloorTrig && !X.alphaFloorLock && !E.onGround) {
    X.alphaFloorLock = true;
    ap.athr = true;
    ap.thrustMode = 'A.FLOOR';
  }
  if (X.alphaFloorLock) {
    if (ap.thrustMode === 'A.FLOOR' && !X.alphaFloorTrig) ap.thrustMode = 'TOGA LK';
    X.athrDriving = true; X.athrLever = 1;
    return 1;
  }
  if (!ap.athr) { X.athrDriving = false; return leverPhi; }
  if (E.onGround || (!X.athrDriving && lever > LEVER_CL + 0.02)) {
    // Armed only: manual thrust per the lever (MAN TOGA / MAN FLX).
    X.athrDriving = false;
    X.athrPhi = leverPhi;
    ap.thrustMode = lever >= 0.98 ? 'MAN TOGA' : lever > LEVER_CL + 0.02 ? 'MAN FLX' : 'A/THR ARMED';
    return leverPhi;
  }
  ap.thrustMode = ap.ap ? modeThrust(ap) : 'SPEED';
  const limit = A.RATING.CL;   // climb thrust (before v0.2.2: the lever's, which sat in CL)
  let phi;
  if (ap.thrustMode === 'THR CLB') phi = limit;
  else if (ap.thrustMode === 'THR IDLE') phi = 0;
  else {
    // SPEED (also in ALT* with AP): the speed error sets a wanted acceleration (≤ 0.6 m/s²), and thrust is
    // integrated to give it, with a little proportional action.
    const err = ap.spdKt * A.KT - E.ias;
    const aErr = clamp(0.07 * err, -0.6, 0.6) - E.iasDot;
    X.athrPhi = clamp(X.athrPhi + 0.12 * aErr * dt, 0, limit);
    phi = clamp(X.athrPhi + 0.08 * aErr, 0, limit);
  }
  X.athrDriving = true;
  X.athrLever = leverForPhi(phi);
  return phi;
}

return { createAp, apStep, athrStep, AP_FIELDS };
}

// The A321neo's, as before the type registry.
export const { createAp, apStep, athrStep } = createAutopilot(A321);
