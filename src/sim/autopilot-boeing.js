// Boeing's autoflight (777, 787): the MCP's modes, the autothrottle that moves the levers, TO/GA,
// LNAV, a simple VNAV, LOC and G/S, autoland and rollout. The same shape as autopilot.js: the AP
// drives the fly-by-wire's demands (a flight path and a bank angle), never the surfaces, and
// the guidance is the A321's where it can be. Allocation free in the step; the sources and
// what's estimated are in reference/notes/boeing-fbw-ap.md.
//
// As on the aircraft, the modes run with the AP off too (they're the flight director's): ALT
// captures, A/T modes change, and FLCH's HOLD stays HOLD after the AP is off (that's the trap in
// the Asiana 214 report, and it's kept). Only E.apOn makes the fly-by-wire follow.

import { createEngines } from './engines.js';
import { RHO0 } from './atmosphere.js';
import { magToGrid } from '../world/frame.js';

const G = 9.80665;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const ALT_KH = 0.1;    // 1/s: the altitude capture's exponential approach, as the A321's ALT*

// Fields in sim.ap that a snapshot carries. ils and route are plain JSON-safe data, replaced whole.
export const AP_FIELDS = ['ap', 'athr', 'athrArmed', 'spdKt', 'hdgDeg', 'altFt', 'vsFpm', 'lateral', 'vertical', 'thrustMode',
  'armedLateral', 'armedVertical', 'ils', 'route', 'routeIdx'];

export function createAutopilotBoeing(A) {
  const { leverToPhi, leverForPhi } = createEngines(A);
  const KT = A.KT, FT = A.FT, FPM = A.FPM, DEG = A.DEG;
  const VMM_FACTOR = A.VMM_FACTOR ?? 1.3;   // as fbw-boeing.js

  const SERVO_RATE = 0.22;        // lever travel per second [EST]: idle to full in about 4.5 s
  const OVERRIDE_LAG = 1.0;       // s after the hand comes off before the A/T takes the lever back
  const WAKE_LAG = 1.0;           // s below the speed before it wakes ("for one second", notes §4)
  const WAKE_MARGIN = 3 * KT;     // above the shaker speed ("near stick shaker")
  const WAKE_AGL_TO = 400, WAKE_AGL_APP = 100; // ft: no wake-up below these [K, notes §4]
  const THR_TIME = 120;           // s: FLCH's THR makes the change in two minutes (notes §4)
  const THR_MIN_VS = 500 * FPM;   // [EST]
  const SPD_CLIMB_LOW = 250, SPD_DES_LOW = 240, SPD_CLIMB = 310, MACH_CLIMB = 0.85; // VNAV's schedule [brief]
  const NM = 1852;
  const WPT_RADIUS = 2 * NM;
  const LOC_L = 1100;             // m: the localiser's heading law, Δψ = atan(xte / L)
  const GS_K = 0.22;              // 1/s: the glideslope's path gain
  const TCH = 50 * FT;            // the beam crosses the threshold at 50 ft (ref point ≈ the antenna)
  const ROLLOUT_END = 30 * KT;    // m/s
  const FLARE_FT = 50, RETARD_FT = 25, FLARE_SINK_FPS = 2; // [brief; 777 quiz for the retard]

  // ---- the MCP (sim.ap) ----
  function createAp(core, target = {}) {
    const X0 = () => core.X, S0 = () => core.state;
    // The A/T mode that goes with the pitch mode.
    const thrustFor = () => {
      const X = core.X;
      if (!ap.athr) { ap.thrustMode = ''; return; }
      switch (ap.vertical) {
        case 'FLCH SPD': ap.thrustMode = 'THR'; break;
        case 'VNAV SPD': ap.thrustMode = X.boVnavDes ? 'IDLE' : 'THR REF'; break;
        case 'TO/GA': ap.thrustMode = 'THR REF'; break;
        default: ap.thrustMode = 'SPD';
      }
    };
    const clearCapture = () => { const X = core.X; X.boCapture = false; X.capVs = 0; };
    const ap = Object.assign(target, {
      ap: false, athr: false, athrArmed: true,
      spdKt: 250, hdgDeg: 0, altFt: 5000, vsFpm: 0,
      lateral: 'HDG HOLD', vertical: 'V/S', thrustMode: '',
      armedLateral: '', armedVertical: '',
      ils: null, route: null, routeIdx: 0,

      engageAp() {
        const S = S0(), X = X0();
        if (S.onGround || S.agl < 100 * FT || X.airTime < 5) return false;
        ap.ap = true;
        // Whatever the flight director was doing stays; otherwise HDG HOLD and V/S or ALT.
        if (ap.lateral === 'ROLLOUT' || ap.lateral === 'HDG') ap.lateral = 'HDG HOLD';
        if (ap.lateral === 'HDG HOLD') { X.boHoldHdg = S.hdg; X.boHoldLatched = false; }
        X.hdgTimer = 0;
        const keep = ap.vertical === 'FLCH SPD' || ap.vertical === 'VNAV SPD' || ap.vertical === 'TO/GA' || ap.vertical === 'G/S';
        if (!keep) {
          const dh = ap.altFt * FT - S.pos.z;
          if (Math.abs(dh) < 60 * FT) { ap.vertical = 'ALT'; X.boAltTgt = ap.altFt * FT; }
          else { ap.vertical = 'V/S'; ap.vsFpm = Math.round(S.vs / FPM / 100) * 100; }
          clearCapture();
          if (ap.athr) ap.thrustMode = 'SPD';
        } else if (ap.athr && !ap.thrustMode) thrustFor();
        return true;
      },
      disconnectAp(reason = 'manual') {
        if (!ap.ap) return;
        ap.ap = false;
        const X = X0();
        X.apDiscT = 3;
        if (X.boRollout) { X.boRollout = false; X.boRolloutYaw = 0; X.boYawClear = true; }
        if (ap.lateral === 'ROLLOUT') ap.lateral = 'HDG HOLD';
        if (ap.vertical === 'FLARE') ap.vertical = 'V/S';
        core.events.push({ type: 'apDisconnect', reason });
      },
      // X. Off (the disconnect switch; still armed, so it can wake) and on again. Armed with no mode
      // in the air (after a manual take-off), the first press engages.
      toggleAthr() {
        const X = X0(), S = S0();
        if (ap.athr && !ap.thrustMode && !S.onGround) { thrustFor(); return; }
        ap.athr = !ap.athr;
        X.boOvr = false; X.boWake = false; X.boTakeoffHold = false;
        if (ap.athr) { ap.athrArmed = true; if (S.onGround) ap.thrustMode = ''; else thrustFor(); }
        else { ap.thrustMode = ''; X.athrDriving = false; }
      },
      // The A/T arm switch. Off, nothing wakes it.
      setAthrArm(on) {
        ap.athrArmed = !!on;
        if (!on) { ap.athr = false; ap.thrustMode = ''; const X = X0(); X.athrDriving = false; X.boOvr = false; X.boWake = false; }
      },
      setAlt(ft) { ap.altFt = clamp(Math.round(ft), 100, 43000); },
      // The heading window. It's the mode only if it's in HDG SEL already: hdgSel() selects it.
      setHdg(deg) { ap.hdgDeg = ((Math.round(deg) % 360) + 360) % 360; if (ap.lateral === 'HDG SEL') X0().hdgTimer = 0; },
      setSpd(kt) { ap.spdKt = clamp(Math.round(kt), 100, 399); },
      setVs(fpm) {
        ap.vsFpm = clamp(Math.round(fpm / 100) * 100, -6000, 6000);
        ap.vertical = 'V/S'; ap.armedVertical = ap.armedVertical === 'G/S' ? 'G/S' : '';
        clearCapture();
        if (ap.athr) ap.thrustMode = 'SPD';
      },
      levelChange() {
        const S = S0(), X = X0();
        const dh = ap.altFt * FT - S.pos.z;
        // VNAV's speed was the FMC's: the MCP's window opens at the speed flown.
        if (ap.vertical.startsWith('VNAV')) ap.spdKt = clamp(Math.round(S.ias / KT), 100, 399);
        if (Math.abs(dh) < 60 * FT) { ap.vertical = 'ALT'; X.boAltTgt = ap.altFt * FT; clearCapture(); if (ap.athr) ap.thrustMode = 'SPD'; return; }
        ap.vertical = 'FLCH SPD';
        X.boFlchDir = Math.sign(dh);
        X.opGamma = S.vs / Math.max(S.tas, 50);
        X.opInt = 0;
        X.boAltTgt = ap.altFt * FT;
        setThrVs(X, dh);
        clearCapture();
        if (ap.athr) { ap.thrustMode = 'THR'; X.athrPhi = X.phiNow; }
      },
      hdgSel() { ap.lateral = 'HDG SEL'; ap.armedLateral = ''; X0().hdgTimer = 0; },
      hdgHold() { const X = X0(); ap.lateral = 'HDG HOLD'; ap.armedLateral = ''; X.boHoldHdg = S0().hdg; X.boHoldLatched = false; },
      altHold() {
        const X = X0();
        ap.vertical = 'ALT'; X.boAltTgt = S0().pos.z; clearCapture();
        if (ap.athr) ap.thrustMode = 'SPD';
      },
      lnav() {
        if (!ap.route || !ap.route.length) return false;
        if (ap.armedLateral === 'LNAV') { ap.armedLateral = ''; return true; }
        if (S0().onGround || S0().agl < 50 * FT) ap.armedLateral = 'LNAV';
        else { ap.lateral = 'LNAV'; ap.armedLateral = ''; }
        return true;
      },
      vnav() {
        const S = S0();
        if (ap.armedVertical === 'VNAV') { ap.armedVertical = ''; return; }
        if (S.onGround || S.agl < 400 * FT) { ap.armedVertical = 'VNAV'; return; }
        startVnav(ap, core.X, S);
      },
      loc() {
        if (!ap.ils) return false;
        if (ap.armedLateral === 'LOC') ap.armedLateral = '';
        else if (ap.lateral === 'LOC') ap.hdgHold();
        else ap.armedLateral = 'LOC';
        return true;
      },
      // APP: arms LOC and G/S; again disarms whatever's still armed.
      app() {
        if (!ap.ils) return false;
        const armed = ap.armedVertical === 'G/S' || ap.armedLateral === 'LOC';
        if (armed) {
          if (ap.armedVertical === 'G/S') ap.armedVertical = '';
          if (ap.armedLateral === 'LOC') ap.armedLateral = '';
          return true;
        }
        if (ap.lateral !== 'LOC') ap.armedLateral = 'LOC';
        if (ap.vertical !== 'G/S' && ap.vertical !== 'FLARE') ap.armedVertical = 'G/S';
        return true;
      },
      // The TO/GA switch. On the ground: the levers go to THR REF (arming the A/T if it wasn't: there's
      // no separate arm switch in the game's cockpit), and HOLD above 80 kt. In the air: a go-around.
      toga() {
        const S = S0(), X = X0();
        if (ap.lateral === 'ROLLOUT') return false;
        if (!ap.athrArmed) return false;
        ap.athr = true;
        X.boOvr = false; X.boRefToga = true; X.boWake = false;
        clearCapture();
        ap.lateral = 'TO/GA'; ap.vertical = 'TO/GA';
        ap.armedVertical = ''; ap.armedLateral = '';
        X.boTrack = S.onGround ? S.hdg : (S.gs > 20 ? Math.atan2(S.vel.x, S.vel.y) : S.hdg);
        if (S.onGround) {
          X.boTakeoffHold = true;
          if (S.ias > 80 * KT) { ap.thrustMode = 'HOLD'; return true; }
        } else {
          X.boTakeoffHold = false;
          X.boTogaSpd = Math.max(S.ias, S.vmm + 5 * KT);
        }
        ap.thrustMode = 'THR REF';
        return true;
      },
      setIls(ils) {
        ap.ils = ils ? { x: ils.x, y: ils.y, hdgGrid: ils.hdgGrid, elev: ils.elev, gsDeg: ils.gsDeg ?? 3 } : null;
        if (ap.ils) return;
        if (ap.armedLateral === 'LOC') ap.armedLateral = '';
        if (ap.armedVertical === 'G/S') ap.armedVertical = '';
        if (ap.lateral === 'LOC') ap.hdgHold();
        if (ap.vertical === 'G/S') ap.setVs(S0().vs / FPM);
      },
      setRoute(pts) {
        ap.route = pts && pts.length ? pts.map((p) => [p[0], p[1]]) : null;
        // From the first point still ahead: editing the route in flight mustn't turn it back to a
        // waypoint already passed. (The last one always stays.)
        ap.routeIdx = 0;
        if (ap.route) {
          const S = S0(), fx = Math.sin(S.hdg), fy = Math.cos(S.hdg);
          while (ap.routeIdx < ap.route.length - 1 && (ap.route[ap.routeIdx][0] - S.pos.x) * fx + (ap.route[ap.routeIdx][1] - S.pos.y) * fy < 0) ap.routeIdx++;
        }
        if (ap.route) return;
        if (ap.armedLateral === 'LNAV') ap.armedLateral = '';
        if (ap.lateral === 'LNAV') ap.hdgHold();
      },
      // A/T wake-up's event; the step can't reach the events otherwise.
      _wake() { core.events.push({ type: 'athrWake' }); },
    });
    return ap;
  }

  // FLCH's rate: the change in two minutes, and at least THR_MIN_VS so a small one still gets there.
  function setThrVs(X, dh) {
    const r = dh / THR_TIME;
    X.boThrVs = Math.abs(r) < THR_MIN_VS ? Math.sign(dh) * THR_MIN_VS : r;
  }

  function startVnav(ap, X, S) {
    const dh = ap.altFt * FT - S.pos.z;
    ap.armedVertical = '';
    X.boCapture = false; X.capVs = 0;
    if (Math.abs(dh) < 60 * FT) {
      ap.vertical = 'VNAV ALT'; X.boAltTgt = ap.altFt * FT;
      if (ap.athr) ap.thrustMode = 'SPD';
      return;
    }
    ap.vertical = 'VNAV SPD';
    X.boVnavDes = dh < 0;
    X.opGamma = S.vs / Math.max(S.tas, 50);
    X.opInt = 0;
    if (ap.athr) ap.thrustMode = X.boVnavDes ? 'IDLE' : 'THR REF';
  }

  // Speed on the elevator (the A321's OP CLB loop): the path that leaves the wanted acceleration.
  function speedOnElevator(X, E, V, tgt, floorVs, ceilVs, dt) {
    const err = tgt - E.ias;
    X.opInt = clamp((X.opInt || 0) + 0.01 * err * dt, -0.2, 0.2);
    const aWant = clamp(0.08 * err + X.opInt, -0.6, 0.6);
    let gam = Math.asin(clamp((E.fAlong / E.mass - aWant) / G, -0.25, 0.3));
    gam = clamp(gam, floorVs / V, ceilVs / V);
    X.opGamma += (gam - X.opGamma) * Math.min(1, dt / 2.0);
    return X.opGamma * V;
  }

  // One step of the modes: fills E.apOn, E.apGamma, E.apBank. Runs before the fly-by-wire.
  function apStep(X, ap, E, S, dt) {
    E.apOn = ap.ap;
    const V = Math.max(E.tas, 50);
    const eas = Math.sqrt(2 * Math.max(E.qbar, 1) / RHO0);
    const casK = eas > 20 ? E.ias / eas : 1;
    const vs1g = E.vls / A.VLS_FACTOR * casK;
    const vmm = VMM_FACTOR * vs1g;
    const vmax = S.vmax > 0 ? S.vmax : A.VMO_KT * KT;
    X.boVStick = E.vsw * casK;

    if (E.onGround) X.boTogaSpd = Math.max(1.2 * vs1g + 15 * KT, vmm);

    // Armed modes that wait for a height after take-off.
    if (!E.onGround) {
      if (ap.armedLateral === 'LNAV' && E.aglFt > 50 && ap.route) { ap.lateral = 'LNAV'; ap.armedLateral = ''; }
      if (ap.armedVertical === 'VNAV' && E.aglFt > 400) startVnav(ap, X, S);
    }

    // ---------------- Lateral ----------------
    let psiCmd = E.psi;
    switch (ap.lateral) {
      case 'HDG SEL':
        X.hdgTimer -= dt;
        if (X.hdgTimer <= 0) { X.hdgGridTgt = magToGrid(ap.hdgDeg * DEG, S.pos.x, S.pos.y); X.hdgTimer = 2; }
        psiCmd = X.hdgGridTgt;
        break;
      case 'HDG HOLD':
        // Roll out first, then hold the heading reached.
        if (!X.boHoldLatched) {
          X.boHoldHdg = E.psi;
          if (Math.abs(E.phi) < 3 * DEG) X.boHoldLatched = true;
        }
        psiCmd = X.boHoldHdg;
        break;
      case 'TO/GA':
        psiCmd = X.boTrack;
        break;
      case 'LNAV': {
        const r = ap.route;
        if (!r || ap.routeIdx >= r.length) { ap.lateral = 'HDG HOLD'; X.boHoldLatched = false; X.boHoldHdg = E.psi; break; }
        let wp = r[ap.routeIdx];
        let dx = wp[0] - S.pos.x, dy = wp[1] - S.pos.y;
        // Next waypoint within 2 nm, or passed.
        let passed = false;
        if (ap.routeIdx > 0) {
          const pv = r[ap.routeIdx - 1];
          passed = (wp[0] - pv[0]) * dx + (wp[1] - pv[1]) * dy < 0;
        }
        if (dx * dx + dy * dy < WPT_RADIUS * WPT_RADIUS || passed) {
          ap.routeIdx++;
          if (ap.routeIdx >= r.length) { ap.lateral = 'HDG HOLD'; X.boHoldLatched = false; X.boHoldHdg = E.psi; break; }
          wp = r[ap.routeIdx];
          dx = wp[0] - S.pos.x; dy = wp[1] - S.pos.y;
        }
        psiCmd = Math.atan2(dx, dy);
        break;
      }
      default:   // LOC and ROLLOUT below, with the beam
    }

    // The beam: along < 0 before the threshold, xte > 0 right of the course.
    const ils = ap.ils;
    let along = 0, xte = 0, dev = 0, beamD = 0;
    if (ils) {
      const sh = Math.sin(ils.hdgGrid), ch = Math.cos(ils.hdgGrid);
      const rx = S.pos.x - ils.x, ry = S.pos.y - ils.y;
      along = rx * sh + ry * ch;
      xte = rx * ch - ry * sh;
      beamD = Math.max(0, -along);
      dev = S.pos.z - (ils.elev + TCH + beamD * Math.tan((ils.gsDeg ?? 3) * DEG));

      if (ap.armedLateral === 'LOC' && along < 0 && !E.onGround) {
        // Capture early enough to roll out on the beam at the turn's radius.
        const dh = wrapPi(ils.hdgGrid - E.psi);
        const turnR = E.tas * E.tas / (G * Math.tan(25 * DEG));
        const inbound = -xte * Math.sin(dh) >= 0 || Math.abs(xte) < 300;
        const lead = Math.max(300, turnR * (1 - Math.cos(Math.min(Math.abs(dh), Math.PI / 2))));
        if (Math.abs(xte) < lead && inbound && Math.abs(dh) < 100 * DEG) { ap.lateral = 'LOC'; ap.armedLateral = ''; }
      }
      if (ap.armedVertical === 'G/S' && !E.onGround && along < 0 && Math.abs(xte) < 1500) {
        // From below or nearly so: the beam comes down on the aircraft.
        const lead = 12 * FT + 0.15 * E.gs * Math.tan((ils.gsDeg ?? 3) * DEG) / 0.22;
        if (dev > -lead && dev < 150 * FT) {
          ap.vertical = 'G/S'; ap.armedVertical = ''; X.boCapture = false; X.capVs = 0;
          X.boVnavDes = false;
          if (ap.athr) ap.thrustMode = 'SPD';
        }
      }
    } else if (ap.lateral === 'LOC' || ap.lateral === 'ROLLOUT') {
      ap.lateral = 'HDG HOLD'; X.boHoldLatched = false; X.boHoldHdg = E.psi;
    }
    if (ap.lateral === 'LOC' || ap.lateral === 'ROLLOUT') {
      psiCmd = ils ? ils.hdgGrid - Math.atan(xte / LOC_L) : E.psi;
      if (ils && Math.abs(xte) > 2000) psiCmd = ils.hdgGrid - Math.sign(xte) * 30 * DEG;
    }
    E.apBank = clamp(2.2 * wrapPi(psiCmd - E.psi), -25 * DEG, 25 * DEG);
    // Near the ground the wings stay nearly level.
    if (ap.lateral === 'LOC' && E.aglFt < 200) E.apBank = clamp(E.apBank, -8 * DEG, 8 * DEG);

    // ---------------- Vertical ----------------
    const h = S.pos.z, mcp = ap.altFt * FT, dh = mcp - h;
    // The speed the AP and A/T work to: the MCP's, or VNAV's schedule, within the limits.
    const lowAlt = h < 10000 * FT;
    let spdKt = ap.spdKt;
    if (ap.vertical === 'VNAV SPD' || ap.vertical === 'VNAV ALT' || ap.vertical === 'VNAV PTH') {
      const machIas = E.mach > 0.05 ? E.ias * MACH_CLIMB / E.mach / KT : 999;
      spdKt = lowAlt ? (X.boVnavDes ? SPD_DES_LOW : SPD_CLIMB_LOW) : Math.min(SPD_CLIMB, machIas);
    } else if (ap.vertical === 'TO/GA') spdKt = X.boTogaSpd / KT;
    X.boSpdCmd = clamp(spdKt * KT, vmm + 3 * KT, Math.max(vmax - 5 * KT, vmm + 5 * KT));

    // Altitude capture (A321's ALT*, but the FMA says ALT, as Boeing's does).
    if (!E.onGround && (ap.vertical === 'V/S' || ap.vertical === 'FLCH SPD' || ap.vertical === 'VNAV SPD' || ap.vertical === 'TO/GA')) {
      if (ap.vertical === 'FLCH SPD' && X.boFlchDir * dh < 0) {
        // The MCP's been wound past the aircraft: V/S at the rate it has.
        ap.vertical = 'V/S'; ap.vsFpm = clamp(Math.round(E.vs / FPM / 100) * 100, -6000, 6000);
        if (ap.athr) ap.thrustMode = 'SPD';
      } else if (ap.vertical === 'VNAV SPD' && (X.boVnavDes ? 1 : -1) * dh > 0) {
        // VNAV past the MCP's altitude.
        ap.vertical = 'VNAV ALT'; X.boAltTgt = mcp; X.boCapture = false;
        if (ap.athr) ap.thrustMode = 'SPD';
      } else {
        const towards = (ap.vertical === 'V/S' ? ap.vsFpm * dh > 0 : true) && Math.abs(dh) > 1;
        const capDist = Math.abs(E.vs) / ALT_KH;
        if (towards && Math.abs(dh) < capDist && Math.sign(E.vs) === Math.sign(dh)) {
          ap.vertical = ap.vertical === 'VNAV SPD' ? 'VNAV ALT' : 'ALT';
          X.boCapture = true; X.capVs = Math.abs(E.vs); X.boAltTgt = mcp;
          if (ap.athr) ap.thrustMode = 'SPD';   // and out of HOLD: "reach the set MCP altitude"
          X.boTakeoffHold = false;
        }
      }
    }

    // G/S to FLARE: an autoland needs the AP on, on the ILS.
    if (ap.ap && ap.vertical === 'G/S' && ap.lateral === 'LOC' && E.aglFt < FLARE_FT && !E.onGround) {
      ap.vertical = 'FLARE';
      X.boFlareTau = Math.max(2, (S.agl / FT) / Math.max(0.5, -E.vs / FT - FLARE_SINK_FPS));
    }
    // On the wheels in an autoland: ROLLOUT.
    if (ap.ap && E.onGround && !X.boRollout && (ap.vertical === 'FLARE' || (ap.vertical === 'G/S' && ap.lateral === 'LOC'))) {
      ap.vertical = 'FLARE'; ap.lateral = 'ROLLOUT'; X.boRollout = true;
    }
    if (X.boRollout) {
      const r = wrapPi(psiCmd - E.psi);
      X.boRolloutYaw = clamp(3 * r - 1.5 * E.r, -1, 1);
      // Below taxi speed the rollout is over: the AP lets go, so Q/E steer again (it would otherwise
      // hold the centreline at taxi speed with the route turning off; the pilot's usual disconnect).
      if (E.gs < ROLLOUT_END) ap.disconnectAp('rollout');
    }

    let vsCmd = 0, leadGam = 0;
    switch (ap.vertical) {
      case 'ALT':
      case 'VNAV ALT':
        if (X.boCapture) {
          vsCmd = clamp(ALT_KH * (X.boAltTgt - h), -X.capVs, X.capVs);
          if (Math.abs(X.boAltTgt - h) < 20 * FT && Math.abs(E.vs) < 150 * FPM) X.boCapture = false;
        } else vsCmd = clamp(0.15 * (X.boAltTgt - h), -1000 * FPM, 1000 * FPM);
        break;
      case 'V/S':
        vsCmd = ap.vsFpm * FPM;
        break;
      case 'FLCH SPD':
        vsCmd = speedOnElevator(X, E, V, X.boSpdCmd, X.boFlchDir > 0 ? 100 * FPM : -6000 * FPM, X.boFlchDir > 0 ? 6000 * FPM : -100 * FPM, dt);
        // THR: thrust for the change in two minutes, as it stood when it was asked for (athrStep).
        if (mcp !== X.boAltTgt) { X.boAltTgt = mcp; setThrVs(X, dh); }
        if (ap.thrustMode === 'THR' && X.boFlchDir < 0 && X.athrDriving && X.athrLever <= 0.001) ap.thrustMode = 'HOLD';
        break;
      case 'VNAV SPD':
        vsCmd = speedOnElevator(X, E, V, X.boSpdCmd, X.boVnavDes ? -6000 * FPM : 100 * FPM, X.boVnavDes ? -100 * FPM : 6000 * FPM, dt);
        if (ap.thrustMode === 'IDLE' && X.athrDriving && X.athrLever <= 0.001) ap.thrustMode = 'HOLD';
        break;
      case 'TO/GA':
        vsCmd = speedOnElevator(X, E, V, X.boSpdCmd, 200 * FPM, 6000 * FPM, dt);
        break;
      case 'G/S': {
        const slope = Math.tan((ils ? ils.gsDeg ?? 3 : 3) * DEG);
        vsCmd = -E.gs * slope + clamp(-GS_K * dev, -8, 8);
        break;
      }
      case 'FLARE': {
        // A shallow exponential down to FLARE_SINK_FPS at the wheels, from the rate at 50 ft.
        const hFt = S.agl / FT;
        const tau = X.boFlareTau;
        const want = FLARE_SINK_FPS + hFt / tau;
        vsCmd = -want * FT;
        leadGam = (want / tau) * FT / V;   // the rate the sink's coming off at: the path loop's lead
        break;
      }
      default: vsCmd = E.vs;
    }
    E.apGamma = Math.asin(clamp(vsCmd / V, -0.3, 0.3)) + leadGam / 0.55;

    // The A/T's flare: IDLE at 25 ft, with or without the AP.
    if (ap.athr && !E.onGround && E.gearDown && E.vs < 0 && E.aglFt < RETARD_FT && ap.thrustMode === 'SPD') ap.thrustMode = 'IDLE';
    // TO/GA's HOLD comes off at 400 ft: THR REF, and the climb rating at 1,500 ft.
    if (X.boTakeoffHold && !E.onGround && E.aglFt > 400) { X.boTakeoffHold = false; if (ap.athr && ap.thrustMode === 'HOLD') ap.thrustMode = 'THR REF'; }
    if (X.boRefToga && !E.onGround && E.aglFt > 1500 && E.vs > 0) X.boRefToga = false;
  }

  // The autothrottle: returns the forward demand phi, and moves the lever (X.athrLever; sim.js
  // writes it to the controls while X.athrDriving, so the keyboard's lever follows).
  //   - SPD, THR REF: a hand on the lever overrides, and it takes the lever back OVERRIDE_LAG after
  //     the hand comes off. The hand doesn't disconnect it: only X or the arm switch do.
  //   - HOLD: the servos are off and the lever's the pilot's. THR, IDLE: a hand on the lever makes it
  //     HOLD, and on the ground any hand does (a rejected take-off mustn't have it push back).
  //   - Armed but off: the automatic activation near the shaker, unless the pitch mode forbids it.
  function athrStep(X, ap, E, lever, dt) {
    const leverPhi = leverToPhi(lever);

    // A hand on the lever while it's driving.
    if (X.athrDriving && lever !== X.athrLever) {
      X.athrDriving = false;
      if (E.onGround || ap.thrustMode === 'THR' || ap.thrustMode === 'IDLE') {
        ap.thrustMode = 'HOLD';
        X.boTakeoffHold = false;
      } else { X.boOvr = true; X.boOvrLever = lever; X.boOvrT = OVERRIDE_LAG; }
    }
    if (X.boOvr) {
      if (lever !== X.boOvrLever) { X.boOvrLever = lever; X.boOvrT = OVERRIDE_LAG; }
      else X.boOvrT -= dt;
      if (ap.athr && X.boOvrT > 0) { X.athrPhi = leverPhi; return leverPhi; }
      X.boOvr = false;
    }

    // Automatic activation (notes §4).
    const blocked = ap.vertical === 'FLCH SPD' || (ap.vertical === 'VNAV SPD' && (X.boVnavDes || ap.thrustMode === 'HOLD'));
    const asleep = !ap.athr || !ap.thrustMode || ap.thrustMode === 'HOLD';
    if (ap.athrArmed && asleep && !blocked && !E.onGround && !X.boTakeoffHold
      && E.aglFt > (E.vs > 0 ? WAKE_AGL_TO : WAKE_AGL_APP) && E.ias < X.boVStick + WAKE_MARGIN) {
      X.boWakeT += dt;
      if (X.boWakeT >= WAKE_LAG) {
        X.boWakeT = 0;
        ap.athr = true;
        ap.thrustMode = ap.vertical === 'VNAV SPD' || ap.vertical === 'TO/GA' ? 'THR REF' : 'SPD';
        X.boWake = true;
        ap._wake();
      }
    } else X.boWakeT = 0;

    if (!ap.athr) { X.athrDriving = false; X.athrPhi = leverPhi; return leverPhi; }

    if (E.onGround) {
      // Armed, on the ground. THR REF to 80 kt; HOLD above it (the servos are off).
      if (ap.thrustMode === 'THR REF' && E.ias > 80 * A.KT) ap.thrustMode = 'HOLD';
      if (ap.thrustMode === 'IDLE' && (lever > 0.05 || E.gs < 30 * KT)) ap.thrustMode = '';
      if (ap.thrustMode === 'HOLD' && E.gs < 5 && !X.boTakeoffHold) ap.thrustMode = '';
      if (ap.thrustMode !== 'THR REF') {
        if (ap.thrustMode !== 'HOLD' && ap.thrustMode !== 'IDLE') ap.thrustMode = '';
        X.athrDriving = false; X.athrPhi = leverPhi;
        return leverPhi;
      }
    }
    if (ap.thrustMode === '' || ap.thrustMode === 'HOLD') { X.athrDriving = false; X.athrPhi = leverPhi; return leverPhi; }

    // It's driving. Taking the lever from a hand or a dormant mode, it starts where the lever is.
    if (!X.athrDriving) { X.athrLever = Math.max(0, lever); X.athrPhi = leverPhi; }

    let phi;
    const ref = X.boRefToga ? A.RATING.TOGA : A.RATING.CL;
    switch (ap.thrustMode) {
      case 'THR REF':
        phi = ref;
        break;
      case 'IDLE':
        phi = 0;
        break;
      case 'THR': {
        // Thrust for FLCH's rate: integrated on the specific excess power it's short of.
        const aE = clamp((X.boThrVs - E.vs) * G / Math.max(E.tas, 50), -0.6, 0.6);
        X.athrPhi = clamp(X.athrPhi + 0.035 * aE * dt, 0, ref);
        phi = X.athrPhi;
        break;
      }
      default: {
        // SPD: the A321's loop, up to the rating; awake from low speed, up to max continuous.
        const limit = X.boWake ? Math.max(A.RATING.MCT, ref) : ref;
        const err = X.boSpdCmd - E.ias;
        const aErr = clamp(0.07 * err, -0.6, 0.6) - E.iasDot;
        X.athrPhi = clamp(X.athrPhi + 0.12 * aErr * dt, 0, limit);
        phi = clamp(X.athrPhi + 0.08 * aErr, 0, limit);
        if (X.boWake && err < 2 * KT) X.boWake = false;
      }
    }
    // The servo: the lever moves at its rate, and the thrust is what the lever says.
    const want = leverForPhi(phi);
    X.athrLever += clamp(want - X.athrLever, -SERVO_RATE * dt, SERVO_RATE * dt);
    X.athrDriving = true;
    return leverToPhi(X.athrLever);
  }

  return { createAp, apStep, athrStep, AP_FIELDS };
}
