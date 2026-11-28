// AP1 and A/THR, holds only: HDG (bank ≤ 25°), ALT with ALT* capture, V/S, OP CLB / OP DES
// (speed on the elevator, THR CLB / THR IDLE) and A/THR SPEED up to climb thrust. Since
// v0.2.2 the A/THR moves the thrust lever while it's active (athrStep).
// The AP drives the fly-by-wire's demands (a flight-path angle and a bank angle), never the
// surfaces. Allocation free in the step.

import * as A321 from './a321neo.js';
import { createEngines } from './engines.js';
import { magToGrid, gridToMag } from '../world/frame.js';
import { LOC_L, beamInto, locCaptures, gsCaptures, locCourse, gsVs, ilsCopy } from './approach-laws.js';

const G = 9.80665;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const ALT_KH = 0.1; // 1/s: ALT* captures with a 10 s exponential approach
// v0.7.4: a heading kept to 0.001°, in [0, 360). A whole number comes out as Math.round() made it before.
// Wrapped in thousandths as integers, so 71.466 comes back as the double 71.466 exactly.
export const hdg1000 = (deg) => { const m = Math.round(deg * 1000); return (((m % 360000) + 360000) % 360000) / 1000; };

// Fields in sim.ap that a snapshot carries. v0.7.4: the armed modes (LOC and APPR), and TRK-FPA with its flight path
// angle; a save from before has none of them, and sim.js's restore() reads them as off. The ILS isn't saved: main.js's
// syncNav() derives it from the plan after every reset, load, rewind and jump (the review, 2026-11-22).
export const AP_FIELDS = ['ap', 'athr', 'spdKt', 'hdgDeg', 'altFt', 'vsFpm', 'lateral', 'vertical', 'thrustMode',
  'armedLateral', 'armedVertical', 'trkFpa', 'fpaDeg'];

// v0.7.4: LOC* to LOC, and G/S* to G/S, once established [EST]: within LOC_EST_M of the course with the track within
// LOC_EST_DEG of it; within GS_EST_M of the path.
const LOC_EST_M = 60, LOC_EST_DEG = 2.5, GS_EST_M = 6;
// v0.7.4: the A321's autoland (AUTOLAND_ON). In LOC and G/S with the AP on: LAND at 400 ft radio height, FLARE at
// 40 ft (the Boeings' law: an exponential down to 2 ft/s at the wheels), the A/THR retarding from 10 ft (the RETARD
// call's height in an autoland), ROLL OUT on the wheels, the AP steering the nosewheel and rudder on the localizer
// until 30 kt, when it lets go. [EST] heights and gains, tuned in tests/v074-loc-autoland.test.mjs. With AUTOLAND_ON
// false, the fallback the brief named: on the ILS the AP lets go at APPR_DISC_FT, with the cavalry charge.
export const AUTOLAND_ON = true;
export const APPR_DISC_FT = 80;
const LAND_FT = 400, FLARE_FT = 40, FLARE_SINK_FPS = 2, RETARD_FT = 10, RETARD_RATE = 0.6;   // lever per second
const ROLLOUT_END_KT = 30, ROLL_KP = 8, ROLL_KD = 16;
// The decrab [EST]: from ALIGN_FT the pedals yaw the nose onto the runway's course, the crab allowed falling to 0 by
// 15 ft, while the bank holds the track on a tighter beam loop (a slip into the wind), the Boeings' alignment's law
// with its integrals (autopilot-boeing.js, from 500 ft with 5° of crab left).
const ALIGN_FT = 150, ALIGN_KP = 6, ALIGN_KD = 3, ALIGN_KI = 4, ALIGN_YAW_I_MAX = 0.25, ALIGN_KIB = 0.5, ALIGN_BANK_I_MAX = 6 * Math.PI / 180, ALIGN_L = 0.3;
const LAND_MODES = new Set(['LAND', 'FLARE', 'ROLL OUT']);

export function createAutopilot(A) {
const { LEVER_CL, leverToPhi, leverForPhi } = createEngines(A);
const BEAM = { along: 0, xte: 0, beamD: 0, dev: 0 };   // v0.7.4: the beam, filled each step (approach-laws.js)

// The FCU-facing object (sim.ap). `core` gives it access to the sim's state. `target`: the object
// to fill (sim.ap keeps its identity when the sim changes type).
function createAp(core, target = {}) {
  const ap = Object.assign(target, {
    ap: false, athr: false,
    spdKt: 250, hdgDeg: 0, altFt: 5000, vsFpm: 0,
    lateral: 'HDG', vertical: 'V/S', thrustMode: '',
    armedLateral: '', armedVertical: '', ils: null, trkFpa: false, fpaDeg: 0,
    engageAp() {
      const S = core.state;
      if (S.onGround || S.agl < 100 * A.FT || core.X.airTime < 5) return false;
      if (S.law === 'direct') return false;   // v0.8.0 (part 7): no AP in the direct law
      ap.ap = true;
      ap.lateral = 'HDG';
      const dh = ap.altFt * A.FT - S.altInd;
      if (Math.abs(dh) < 60 * A.FT) ap.vertical = 'ALT';
      else {
        ap.vertical = 'V/S';
        ap.vsFpm = Math.round(S.vs / A.FPM / 100) * 100;
        if (ap.trkFpa) ap.fpaDeg = fpaNow(S);
      }
      core.X.hdgTimer = 0;
      if (ap.athr) ap.thrustMode = 'SPEED';
      return true;
    },
    disconnectAp(reason = 'manual') {
      if (!ap.ap) return;
      ap.ap = false;
      core.X.apDiscT = 3;
      // v0.7.4: out of the autoland's modes (the pedals let go once: applyControls).
      if (core.X.a3Rollout || core.X.a3Align) { core.X.a3Rollout = false; core.X.a3RollYaw = 0; core.X.a3Align = false; core.X.a3AlignYaw = 0; core.X.a3YawClear = true; }
      if (LAND_MODES.has(ap.lateral)) ap.lateral = 'HDG';
      if (LAND_MODES.has(ap.vertical)) ap.vertical = 'V/S';
      core.events.push({ type: 'apDisconnect', reason });
    },
    toggleAthr() {
      ap.athr = !ap.athr;
      if (ap.athr) { core.X.athrPhi = core.X.phiNow; ap.thrustMode = modeThrust(ap); }
      else { ap.thrustMode = ''; core.X.alphaFloorLock = false; }
    },
    setAlt(ft) { ap.altFt = clamp(Math.round(ft), 100, 41000); },
    // v0.7.4 (Shane's item 9): a typed heading keeps its decimals, to 0.001° ("071.466" flies 071.466°).
    // In LOC* or LOC a new heading is the pilot taking the aircraft off the beam (pulling the knob): HDG, the LOC
    // no longer armed. In HDG an armed LOC stays armed (the usual intercept).
    // In the autoland (LAND, FLARE, ROLL OUT) the knob does nothing, as on the real FCU (the review): only an AP
    // disconnect ends it. The same for the V/S knob, the TRK-FPA button, LOC, APPR and the ALT knob's pull.
    setHdg(deg) {
      if (landing()) return;
      if (ap.lateral === 'LOC*' || ap.lateral === 'LOC') ap.armedLateral = '';
      ap.hdgDeg = hdg1000(deg); ap.lateral = 'HDG'; core.X.hdgTimer = 0;
    },
    setSpd(kt) { ap.spdKt = clamp(Math.round(kt), 100, 399); },
    setVs(fpm) {
      if (landing()) return;
      ap.vsFpm = clamp(Math.round(fpm / 100) * 100, -6000, 6000);
      ap.vertical = 'V/S';
      if (ap.athr) ap.thrustMode = 'SPEED';
    },
    // v0.7.4: TRK-FPA's flight path angle, −9.9° to +9.9° in tenths; the V/S mode flies it while TRK-FPA is on.
    setFpa(deg) {
      if (landing()) return;
      ap.fpaDeg = clamp(Math.round(deg * 10) / 10, -9.9, 9.9);
      ap.vertical = 'V/S';
      if (ap.athr) ap.thrustMode = 'SPEED';
    },
    // v0.7.4: the HDG-V/S / TRK-FPA button. The HDG window's figure is then a track (and back a heading), the V/S
    // window's a flight path angle: the V/S asked for becomes the angle that gives it at the ground speed now (and
    // back), so the path doesn't jump.
    toggleTrkFpa() {
      if (landing()) return;
      const S = core.state, gs = Math.max(S.gs || 0, 30);
      ap.trkFpa = !ap.trkFpa;
      if (ap.trkFpa) ap.fpaDeg = clamp(Math.round(Math.atan((ap.vsFpm || 0) * A.FPM / gs) / A.DEG * 10) / 10, -9.9, 9.9);
      else ap.vsFpm = clamp(Math.round(Math.tan((ap.fpaDeg || 0) * A.DEG) * gs / A.FPM / 100) * 100, -6000, 6000);
      core.X.hdgTimer = 0;
    },
    // v0.7.4: LOC and APPR, as the Boeings' LOC and APP (their laws: approach-laws.js). LOC arms the localizer;
    // again, it disarms, or out of LOC* / LOC back to HDG on the heading flown. APPR arms the localizer and the
    // glideslope; again, it disarms whatever is still armed. Nothing to arm without an ILS (main.js gives one only
    // for a destination end with an ILS that is landed on straight in).
    loc() {
      if (!ap.ils || landing()) return false;
      if (ap.armedLateral === 'LOC') { ap.armedLateral = ''; if (ap.armedVertical === 'G/S') ap.armedVertical = ''; }
      else if (ap.lateral === 'LOC*' || ap.lateral === 'LOC') toHdg();
      else ap.armedLateral = 'LOC';
      return true;
    },
    appr() {
      if (!ap.ils || landing()) return false;
      const armed = ap.armedVertical === 'G/S' || ap.armedLateral === 'LOC';
      if (armed) { ap.armedVertical = ''; ap.armedLateral = ''; return true; }
      if (ap.lateral !== 'LOC*' && ap.lateral !== 'LOC') ap.armedLateral = 'LOC';
      if (ap.vertical !== 'G/S*' && ap.vertical !== 'G/S') ap.armedVertical = 'G/S';
      return true;
    },
    setIls(ils) {
      const next = ilsCopy(ils);
      // In the autoland, a beam gone or moved (the route changed on short final) can't be flown on: the AP lets go,
      // with the cavalry charge, rather than leave a mode that can't end (the review). The same beam again is nothing.
      if (landing() && ap.ap && !(next && ap.ils && next.x === ap.ils.x && next.y === ap.ils.y && next.hdgGrid === ap.ils.hdgGrid && next.elev === ap.ils.elev)) {
        ap.ils = next; ap.armedLateral = ''; ap.armedVertical = '';
        ap.disconnectAp('ils');
        return;
      }
      ap.ils = next;
      if (ap.ils) return;
      if (ap.armedLateral === 'LOC') ap.armedLateral = '';
      if (ap.armedVertical === 'G/S') ap.armedVertical = '';
      if (ap.lateral === 'LOC*' || ap.lateral === 'LOC') toHdg();
      if (ap.vertical === 'G/S*' || ap.vertical === 'G/S') ap.setVs(core.state.vs / A.FPM);
    },
    levelChange() {
      if (landing()) return;
      const dh = ap.altFt * A.FT - core.state.altInd;
      if (Math.abs(dh) < 60 * A.FT) { ap.vertical = 'ALT'; return; }
      ap.vertical = dh > 0 ? 'OP CLB' : 'OP DES';
      core.X.opGamma = core.state.vs / Math.max(core.state.tas, 50);
      core.X.opInt = 0;
      if (ap.athr) ap.thrustMode = modeThrust(ap);
    },
    // No TO/GA switch and no trim on the A321's FCU: those are the Boeings' (v0.3.0). LOC and APPR since v0.7.4.
  });
  function landing() { return LAND_MODES.has(ap.vertical) || LAND_MODES.has(ap.lateral); }
  // Out of LOC: HDG on the heading (or the track, in TRK-FPA) flown now.
  function toHdg() {
    const S = core.state;
    const g = ap.trkFpa && S.gs > 20 ? Math.atan2(S.vel.x, S.vel.y) : S.hdg;
    ap.hdgDeg = hdg1000(gridToMag(g, S.pos.x, S.pos.y) / A.DEG);
    ap.lateral = 'HDG'; core.X.hdgTimer = 0;
  }
  return ap;
}

// The flight path angle flown now, degrees to a tenth (over the ground: TRK-FPA's).
function fpaNow(S) {
  return clamp(Math.round(Math.atan2(S.vs, Math.max(S.gs || 0, 30)) / A.DEG * 10) / 10, -9.9, 9.9);
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

  // v0.7.4: the ILS's beam and the captures (the Boeings' laws, approach-laws.js). G/S captures only once the
  // localizer has (LOC* or LOC), as on the real aircraft.
  const ils = ap.ils;
  if (ils) {
    beamInto(ils, S, BEAM);
    if (ap.armedLateral === 'LOC' && BEAM.along < 0 && !E.onGround && locCaptures(ils, E, BEAM.xte)) { ap.lateral = 'LOC*'; ap.armedLateral = ''; }
    if (ap.armedVertical === 'G/S' && (ap.lateral === 'LOC*' || ap.lateral === 'LOC') && !E.onGround && BEAM.along < 0
      && Math.abs(BEAM.xte) < 1500 && gsCaptures(ils, E, BEAM.dev)) {
      ap.vertical = 'G/S*'; ap.armedVertical = '';
      if (ap.athr && !X.alphaFloorLock) ap.thrustMode = 'SPEED';
    }
  }
  const onLoc = !!ils && (ap.lateral === 'LOC*' || ap.lateral === 'LOC' || ap.lateral === 'LAND' || ap.lateral === 'ROLL OUT');
  // v0.7.4: the autoland's modes (AUTOLAND_ON).
  if (AUTOLAND_ON && onLoc) {
    if (ap.lateral === 'LOC' && ap.vertical === 'G/S' && !E.onGround && E.aglFt < LAND_FT) { ap.lateral = 'LAND'; ap.vertical = 'LAND'; }
    if (ap.vertical === 'LAND' && !E.onGround && E.aglFt < FLARE_FT) {
      ap.vertical = 'FLARE';
      X.a3FlareTau = Math.max(2, (S.agl / A.FT) / Math.max(0.5, -E.vs / A.FT - FLARE_SINK_FPS));
    }
    if (E.onGround && (ap.vertical === 'FLARE' || ap.vertical === 'LAND')) { ap.lateral = 'ROLL OUT'; ap.vertical = 'ROLL OUT'; X.a3Rollout = true; }
  }

  if (onLoc) {
    // The localizer: the Boeings' course law, flown as a track; the wings nearly level near the ground.
    E.apBank = clamp(2.2 * wrapPi(locCourse(ils, BEAM.xte) - E.psi - S.drift), -25 * A.DEG, 25 * A.DEG);
    if (E.aglFt < 200) E.apBank = clamp(E.apBank, -8 * A.DEG, 8 * A.DEG);
    // The decrab: in LAND or FLARE below ALIGN_FT with a drift (0 in calm air: still air flies as without it).
    if ((ap.vertical === 'LAND' || ap.vertical === 'FLARE') && S.drift !== 0 && !E.onGround && E.aglFt < ALIGN_FT) {
      const crab = wrapPi(E.psi - ils.hdgGrid);
      if (!X.a3Align) { X.a3Crab0 = Math.abs(crab); X.a3AlignI = 0; X.a3AlignBI = 0; }
      X.a3Align = true;
      const limit = X.a3Crab0 * clamp((E.aglFt - 15) / (ALIGN_FT - 15), 0, 1);
      const want = ils.hdgGrid + clamp(crab, -limit, limit);
      const err = wrapPi(want - E.psi);
      X.a3AlignI = clamp(X.a3AlignI + err * dt, -ALIGN_YAW_I_MAX / ALIGN_KI, ALIGN_YAW_I_MAX / ALIGN_KI);
      X.a3AlignYaw = clamp(ALIGN_KP * err - ALIGN_KD * E.r + ALIGN_KI * X.a3AlignI, -1, 1);
      const trkErr = wrapPi(ils.hdgGrid - Math.atan(BEAM.xte / (LOC_L * ALIGN_L)) - E.psi - S.drift);
      X.a3AlignBI = clamp(X.a3AlignBI + trkErr * dt, -ALIGN_BANK_I_MAX / ALIGN_KIB, ALIGN_BANK_I_MAX / ALIGN_KIB);
      E.apBank = clamp(2.2 * trkErr + ALIGN_KIB * X.a3AlignBI, -8 * A.DEG, 8 * A.DEG);
    } else if (X.a3Align) { X.a3Align = false; X.a3AlignYaw = 0; if (!X.a3Rollout) X.a3YawClear = true; }
    if (X.a3Rollout) {
      // ROLL OUT: the pedals (nosewheel and rudder) on the localizer's course, as the Boeings' rollout.
      // (The Boeings' rollout law in a wind: the centreline taken harder than the beam's, 6° at most.)
      const r = wrapPi(ils.hdgGrid - clamp(BEAM.xte / 150, -6 * A.DEG, 6 * A.DEG) - E.psi);
      X.a3RollYaw = clamp(ROLL_KP * r - ROLL_KD * E.r, -1, 1);
      if (E.gs < ROLLOUT_END_KT * A.KT) ap.disconnectAp('rollout');
    }
    if (ap.lateral === 'LOC*' && Math.abs(BEAM.xte) < LOC_EST_M && Math.abs(wrapPi(ils.hdgGrid - E.psi - S.drift)) < LOC_EST_DEG * A.DEG) ap.lateral = 'LOC';
  } else {
    if (ap.lateral === 'LOC*' || ap.lateral === 'LOC') ap.lateral = 'HDG';   // the ILS gone (setIls(null) sees to the rest)
    // Lateral: HDG. The FCU heading is magnetic; refresh the grid target every 2 s. v0.7.4: in TRK-FPA it's a
    // track, so the drift comes off (0 in calm air).
    X.hdgTimer -= dt;
    if (X.hdgTimer <= 0) { X.hdgGridTgt = magToGrid(ap.hdgDeg * A.DEG, S.pos.x, S.pos.y); X.hdgTimer = 2; }
    const dpsi = ap.trkFpa ? wrapPi(X.hdgGridTgt - E.psi - S.drift) : wrapPi(X.hdgGridTgt - E.psi);
    E.apBank = clamp(2.2 * dpsi, -25 * A.DEG, 25 * A.DEG);
  }

  // Vertical.
  const h = S.altInd, tgt = ap.altFt * A.FT, dh = tgt - h;
  let vsCmd, leadGam = 0;
  if (ap.vertical === 'V/S' || ap.vertical === 'OP CLB' || ap.vertical === 'OP DES') {
    const towards = (ap.vertical === 'V/S' ? (ap.trkFpa ? ap.fpaDeg : ap.vsFpm) * dh > 0 : true) && Math.abs(dh) > 1;
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
      // v0.7.4: in TRK-FPA, the flight path angle over the ground.
      vsCmd = ap.trkFpa ? Math.tan((ap.fpaDeg || 0) * A.DEG) * E.gs : ap.vsFpm * A.FPM;
      break;
    case 'G/S*':
    case 'G/S':
      // v0.7.4: the glideslope (approach-laws.js); G/S* until within GS_EST_M of the path.
      vsCmd = ils ? gsVs(ils, E, BEAM.dev) : 0;
      if (ap.vertical === 'G/S*' && ils && Math.abs(BEAM.dev) < GS_EST_M) ap.vertical = 'G/S';
      break;
    case 'LAND':
      vsCmd = ils ? gsVs(ils, E, BEAM.dev) : 0;
      break;
    case 'FLARE': {
      // The Boeings' flare: from the sink at 40 ft, an exponential down to FLARE_SINK_FPS at the wheels.
      const hFt = S.agl / A.FT, tau = X.a3FlareTau || 3, want = FLARE_SINK_FPS + hFt / tau;
      vsCmd = -want * A.FT;
      leadGam = (want / tau) * A.FT / V;
      break;
    }
    case 'ROLL OUT':
      vsCmd = 0;
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
  E.apGamma = leadGam ? Math.asin(clamp(vsCmd / V, -0.3, 0.3)) + leadGam / 0.55 : Math.asin(clamp(vsCmd / V, -0.3, 0.3));
  // v0.7.4: without the autoland, on the ILS the AP lets go at 80 ft, with the cavalry charge (apDisconnect).
  if (!AUTOLAND_ON && onLoc && (ap.vertical === 'G/S' || ap.vertical === 'G/S*') && !E.onGround && E.aglFt < APPR_DISC_FT) ap.disconnectAp('approach');
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
  // v0.7.4: the autoland's retard: from 10 ft in the flare the lever comes back to idle at RETARD_RATE (so the
  // RETARD call, at 10 ft in an autoland, hears it on its way).
  if (ap.ap && ap.vertical === 'FLARE' && E.aglFt < RETARD_FT) {
    ap.thrustMode = 'THR IDLE';
    X.athrLever = Math.max(0, (X.athrDriving ? X.athrLever : lever) - RETARD_RATE * dt);
    X.athrPhi = leverToPhi(X.athrLever); X.athrDriving = true;
    return X.athrPhi;
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

// v0.7.4: sim.js's hooks for the autoland, as the Boeings' (fbw-boeing.js): the AP stays on the wheels in an
// autoland, and ROLL OUT steers through the pedals' control, letting go once when it ends.
function staysOnGround(ap) {
  return AUTOLAND_ON && (ap.vertical === 'FLARE' || ap.vertical === 'LAND' || ap.vertical === 'ROLL OUT') && (ap.lateral === 'LAND' || ap.lateral === 'ROLL OUT');
}
// The pedals only while the AP is on in the autoland (the review: state left from an earlier flight, a rewind or a
// load must never hold them); anything else stale is dropped here.
function applyControls(X, controls, ap) {
  const on = ap.ap && (LAND_MODES.has(ap.vertical) || LAND_MODES.has(ap.lateral));
  if (on && X.a3Rollout && ap.vertical === 'ROLL OUT') controls.yaw = X.a3RollYaw || 0;
  else if (on && X.a3Align) controls.yaw = X.a3AlignYaw || 0;
  else {
    if (!on) { X.a3Rollout = false; X.a3RollYaw = 0; X.a3Align = false; X.a3AlignYaw = 0; }
    // The AP's own let-go (disconnectAp() sets it): the pedals back to the middle, once.
    if (X.a3YawClear) { controls.yaw = 0; X.a3YawClear = false; }
  }
}

return { createAp, apStep, athrStep, AP_FIELDS, staysOnGround, applyControls };
}

// The A321neo's, as before the type registry.
export const { createAp, apStep, athrStep } = createAutopilot(A321);
