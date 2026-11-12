// Boeing's fly-by-wire (777, 787): the C*U law. Same method and call signature as fbw.js (the
// surfaces come from inverting the sim's own moments), a different law on top: the aircraft is
// speed-stable about a trim reference speed, X.vRef, so hands off it settles back to that speed,
// a thrust change pitches it, and a steady pull is a steady off-trim condition. There's no auto-trim
// holding the path, no flare law, and the protections are soft: holding full input overrides them.
// v0.4.1: unless the auto-trim setting is on (E.autoTrim): then the path holds itself as the A321's.
// v0.4.2: with it on there's the A321's flare law too, and the trim switches nudge the path held.
// Sources and what's estimated: reference/notes/boeing-fbw-ap.md. Allocation free.
//
// Besides the law: the Boeing-only hooks sim.js calls (kit.boeing), so that nothing here touches
// an Airbus: coreFields() (the extra core fields, and so in every snapshot), afterReset(),
// updateState(), staysOnGround(), applyControls().
// Body axes: x forward, y right, z down; p roll right +, q pitch up +, r yaw right +.

import { RHO0 } from './atmosphere.js';

const G = 9.80665;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createFbwBoeing(A) {
  const KT = A.KT, DEG = A.DEG;
  // Minimum manoeuvring speed (the top of the amber band) over the 1 g stall [EST, notes §3]: about
  // 1.3 VS at low speed, and it comes up to the buffet limit at high Mach through the CLmax that
  // machLift() lowers. A type's data may set its own.
  const VMM_FACTOR = A.VMM_FACTOR ?? 1.3;

  // The speed loop [EST: tuned here, see tests/boeing-law.test.mjs]. A speed error asks for an
  // acceleration, which sets a flight path from the energy balance (as autopilot.js's OP CLB
  // does); low-passed by GAM_TAU so a change of thrust moves the nose gradually. KSPD · (GAM_TAU +
  // the path loop's 1/KGAM) stays well under 1, so there's no phugoid to speak of.
  const KSPD = 0.055;        // 1/s
  const ALIM = 0.6;          // m/s²: the most the speed loop asks for
  const GAM_TAU = 5;         // s
  const KGAM = 0.5;          // 1/s: the path loop, as nz = V·KGAM·Δγ/g
  // The trim: about 10 kt/s of reference speed (pilots' figure; notes §2).
  const TRIM_RATE = 10 * KT; // m/s per s at full switch
  const BOUND_RATE = 5 * KT; // how fast vRef is brought back inside moving limits
  const TO_TRIM = 15 * KT;   // lift-off: V2 + 15 kt
  const V2_FACTOR = 1.2;     // V2 ≈ 1.2 VS1g [EST, the usual certification minimum's ballpark]

  // Protections [EST, notes §3].
  const STALL_NZ_K = 0.05, STALL_NZ_MAX = 0.35; // g per m/s below vmm, and the limit: a firm pull beats it
  const STALL_MUSH = 4 * DEG;
  const OVER_NZ_K = 0.09, OVER_NZ_MAX = 0.5;    // g per m/s above VMO/MMO
  const OVER_PUSH_GAIN = 0.6;                   // forward stick takes about twice the force up there;
                                                // full forward still beats the push and the speed loop together
  const BANK_TRIP = 35 * DEG, BANK_BACK = 30 * DEG; // [notes §3: 787 ground school; 777 quiz]
  const BANK_K = 0.25;                          // 1/s: the roll back, against the wheel
  const BANK_WHEEL = 0.4;                       // what's left of the wheel's rate past BANK_TRIP

  // Ground mode: a held pull asks for a rotation rate; the rest of the time it's direct.
  const ROT_RATE = 2.8 * DEG;
  // v0.4.1, auto-trim: the flight path's rate at full stick in the landing configuration, as the A321's.
  const PATH_RATE = 3.5 * DEG;
  // v0.4.2, auto-trim's flare law: fbw.js's, with the type's own top attitude (its tail-strike pitch less
  // 2.2°: 7.4° for the 787-9, 7.8° for the 777-300ER, as the A321's 7.5° against its 9.7°). The nose
  // sinks more gently (2° in 8 s, the A320 FCOM's figure, where fbw.js takes the A321 from its approach
  // attitude to −2° in about 8 s) and only to +0.5°: these fly the approach about 1° nose up (the A321
  // about 2.5°), so −2° would put the nose wheel down first, hard enough to break it hands off.
  const FLARE_RATE = 8 * DEG, FLARE_RATE_DN = 3 * DEG, FLARE_SINK = 0.25 * DEG, FLARE_THETA_MIN = 0.5 * DEG;
  const FLARE_THETA_PUSH = -5 * DEG, FLARE_LEAD = 2 * DEG, FLARE_Q_MAX = 3.5 * DEG;
  const FLARE_THETA_MAX = ((A.PITCH_TAILSTRIKE_DEG ?? 9.7) - 2.2) * DEG;
  // v0.4.2: with auto-trim, a held trim switch moves the path held at this rate (the flare's attitude
  // at twice it), a finer control than W/S.
  const TRIM_PATH_RATE = 0.5 * DEG;

  function fbwStep(X, c, E, dt) {
    // On the mains it's the ground law, whatever the blend says, so the nose comes down by itself.
    const w = E.onGround ? 0 : X.flt;
    const V = Math.max(E.tas, 30);
    const sp = c.pitch, sr = c.roll, sy = c.yaw;
    const cphi = Math.cos(E.phi), sphi = Math.sin(E.phi);
    const flaps = E.slat > 0.5;

    // ---- the speeds: everything's in IAS; the stall speed in EAS comes up to CAS here ----
    const eas = Math.sqrt(2 * E.qbar / RHO0);
    const casK = eas > 20 ? E.ias / eas : 1;
    const vs1g = E.vls / A.VLS_FACTOR * casK;
    const vmm = VMM_FACTOR * vs1g;
    const vmoMach = E.mach > 0.05 ? E.ias * A.MMO / E.mach : 1e9;
    const vTop = Math.min(A.VMO_KT * KT, vmoMach);

    // ---- the reference speed and the trim switches ----
    if (E.onGround) {
      // Ready for the lift-off: V2 + 15 kt. (The trim switches move the stabiliser here on the real
      // aircraft; the stabiliser's set for take-off below.)
      X.vRef = Math.max(V2_FACTOR * vs1g + TO_TRIM, vmm);
      X.boGam = E.gamma;
    } else if (E.apOn) {
      // Self-trim: when the AP lets go, the speed it had is the reference.
      X.vRef = E.ias;
      X.boGam = E.gamma;
    } else {
      // Nose-up trim (+1) lowers the reference; stall protection stops it at vmm, overspeed
      // protection at VMO/MMO. If the limits move past vRef (flaps up, a climb past the crossover
      // altitude) it follows them.
      const trim = c.trim || 0;
      let r = X.vRef - trim * TRIM_RATE * dt;
      if (trim > 0) r = Math.max(r, Math.min(X.vRef, vmm));
      else if (trim < 0) r = Math.min(r, Math.max(X.vRef, vTop));
      if (r < vmm) r = Math.min(vmm, r + BOUND_RATE * dt);
      if (r > vTop) r = Math.max(vTop, r - BOUND_RATE * dt);
      X.vRef = r;
    }

    // ---------------- Pitch ----------------
    // Ground mode: pulling asks for a rotation rate (so a held key rotates at about 3°/s at any
    // weight); otherwise direct, with pitch damping.
    let elevDirect;
    if (sp > 0.02 && E.elevScale > 1) {
      const qdot = 3.5 * (sp * ROT_RATE - E.q);
      elevDirect = (E.Iyy * qdot - E.myOther) / E.elevScale;
    } else {
      elevDirect = sp * (sp > 0 ? A.ELEV_UP : A.ELEV_DN) * 0.75 - 4 * E.q;
    }
    elevDirect = clamp(elevDirect, -A.ELEV_DN, A.ELEV_UP);

    let elevLaw = 0, protStall = false, protOver = false;
    // v0.4.2, auto-trim's flare law (fbw.js's): at 50 ft on a landing the attitude is memorised, and from
    // 30 ft the nose comes down slowly (towards −2°), so you flare yourself; the stick asks for a pitch
    // rate about the attitude held. On the wheels, on the AP, at TO/GA thrust or with auto-trim off it's over.
    const trimSw = c.trim || 0;
    const goAround = c.thrust > 0.9;
    if (w <= 0) X.flare = false;
    if (w > 0 && E.autoTrim) {
      const flareCond = !E.apOn && !goAround && E.aglFt < 50 && E.gearDown && !E.onGround && E.vs < 0.5;
      if (flareCond && !X.flare && E.aglFt > 30) { X.flare = true; X.flareTheta = E.theta; X.flareT = 0; }
    }
    if (X.flare && (E.aglFt > 60 || !E.autoTrim || E.apOn || goAround)) X.flare = false;
    if (w > 0) {
      const nzMax = flaps ? A.NZ_MAX_FLAPS : A.NZ_MAX_CLEAN;
      const nzMin = flaps ? A.NZ_MIN_FLAPS : A.NZ_MIN_CLEAN;
      const cg = Math.cos(E.gamma);
      const cphiC = Math.max(cphi, Math.cos(BANK_TRIP)); // turn compensation to the protection's edge
      const nzBase = cg / cphiC;

      // Overspeed protection: a nose-up demand above VMO/MMO. Forward stick is worth half.
      const a = E.mach > 0.05 ? E.tas / E.mach : 340;
      const over = Math.max(E.ias - A.VMO_KT * KT, (E.mach - A.MMO) * a);
      let nzProt = 0;
      if (over > 0 && !E.onGround) { protOver = true; nzProt = Math.min(OVER_NZ_MAX, OVER_NZ_K * over); }

      let nzStick = sp > 0 ? sp * (nzMax - 1) : -sp * (nzMin - 1);
      if (protOver && sp < 0) nzStick *= OVER_PUSH_GAIN;

      let nzCmd;
      if (E.apOn) {
        nzCmd = clamp(nzBase + V * 0.55 * (E.apGamma - E.gamma) / G, 0.75, 1.3);
        if (Math.abs(sp) > 0.04) nzCmd += nzStick;
        X.holdLatched = false;
      } else if (E.autoTrim) {
        // v0.4.1, auto-trim (a setting, off by default): the flight path holds itself, as the A321's does
        // (fbw.js). Hands off, the path is held once the pitch rate has settled. In the landing configuration
        // (gear down, flaps 20 or more) the stick asks for a rate of change of the path, so a tap moves it a
        // little and it stays there; elsewhere it asks for load factor as without. The speed is the thrust's
        // (the autothrottle's), and the trim switches have nothing to do.
        if (E.gearDown && E.flap > 18) {
          if (!X.holdLatched) { X.holdLatched = true; X.gammaRef = E.gamma; }
          const rate = sp * PATH_RATE + trimSw * TRIM_PATH_RATE;
          X.gammaRef = clamp(X.gammaRef + rate * dt, E.gamma - 2 * DEG, E.gamma + 2 * DEG);
          nzCmd = nzBase + 0.5 * V * rate / G + clamp(V * 0.35 * (X.gammaRef - E.gamma) / G, -0.25, 0.25);
          X.releaseT = 0;
        } else if (Math.abs(sp) > 0.04) {
          nzCmd = nzBase + nzStick;
          X.holdLatched = false; X.releaseT = 0;
        } else {
          X.releaseT += dt;
          if (!X.holdLatched && (Math.abs(E.q) < 1.0 * DEG || X.releaseT > 3)) { X.holdLatched = true; X.gammaRef = E.gamma; }
          // v0.4.2: the trim switches move the path held.
          if (X.holdLatched && trimSw) X.gammaRef = clamp(X.gammaRef + trimSw * TRIM_PATH_RATE * dt, E.gamma - 2 * DEG, E.gamma + 2 * DEG);
          nzCmd = X.holdLatched ? clamp(nzBase + V * 0.35 * (X.gammaRef - E.gamma) / G, nzBase - 0.25, nzBase + 0.25) : nzBase;
        }
        if (E.ias < vmm) { protStall = true; nzCmd -= Math.min(STALL_NZ_MAX, STALL_NZ_K * (vmm - E.ias)); }
        // The reference follows, so with auto-trim turned off the law carries on from the speed flown now.
        X.vRef = clamp(E.ias, vmm, vTop); X.boGam = E.gamma;
      } else {
        // The energy loop: hands off, the path that leaves the acceleration back to vRef.
        const aWant = clamp(-KSPD * (E.ias - X.vRef), -ALIM, ALIM);
        const gamCmd = Math.asin(clamp((E.fAlong / E.mass - aWant) / G, -0.3, 0.3));
        X.boGam += (gamCmd - X.boGam) * Math.min(1, dt / GAM_TAU);
        nzCmd = nzBase + clamp(V * KGAM * (X.boGam - E.gamma) / G, -0.3, 0.3);
        // Stall protection: past vmm a nose-down demand, on top of the speed loop's, that a firm
        // pull beats (so a real stall is possible).
        if (E.ias < vmm) { protStall = true; nzCmd -= Math.min(STALL_NZ_MAX, STALL_NZ_K * (vmm - E.ias)); }
        nzCmd += nzStick;
      }
      nzCmd = clamp(nzCmd + nzProt, nzMin, nzMax);

      // As in fbw.js: the flight path rate for that load factor, as a body pitch rate.
      const gdot = G * (nzCmd * cphi - cg) / V;
      let qCmd = gdot * cphi + G * nzCmd * sphi * sphi / V + 1.0 * G * (nzCmd - E.nz) / V;
      if (X.flare) {
        // The flare law's attitude command, X.flareTheta, kept within reach of the attitude (fbw.js).
        if (E.aglFt < 30) X.flareT += dt;
        const sink = X.flareT > 0 && X.flareTheta > FLARE_THETA_MIN ? FLARE_SINK : 0;
        let rate = sp * (sp > 0 ? FLARE_RATE : FLARE_RATE_DN) + trimSw * 2 * TRIM_PATH_RATE - sink;
        if (rate > 0) rate = Math.min(rate, 2 * Math.max(0, FLARE_THETA_MAX - X.flareTheta));
        const hi = Math.min(FLARE_THETA_MAX, E.theta + FLARE_LEAD);
        const lo = Math.min(hi, Math.max(FLARE_THETA_PUSH, E.theta - 2 * DEG));
        const th = clamp(X.flareTheta + rate * dt, lo, hi);
        rate = (th - X.flareTheta) / dt;
        X.flareTheta = th;
        qCmd = clamp(rate + 1.5 * (th - E.theta), -FLARE_Q_MAX, FLARE_Q_MAX);
      }
      // Past the stall the tail has no more to give: a held pull mushes a few degrees beyond α max,
      // stalled and sinking, rather than flying on up to a deep stall the law couldn't get out of.
      qCmd = Math.min(qCmd, 0.8 * (E.alphaMax + STALL_MUSH - E.alpha));
      qCmd = clamp(qCmd, -8 * DEG, 8 * DEG);
      const qdotCmd = 3.5 * (qCmd - E.q);
      const myNeed = E.Iyy * qdotCmd + (E.Ixx - E.Izz) * E.p * E.r + E.Ixz * (E.p * E.p - E.r * E.r);
      elevLaw = E.elevScale > 1 ? (myNeed - E.myOther) / E.elevScale : elevDirect;
    }
    X.elevCmd = clamp((1 - w) * elevDirect + w * elevLaw, -A.ELEV_DN, A.ELEV_UP);

    // The stabiliser offloads the elevator, so the surfaces look right and nothing saturates. It
    // isn't what holds the speed: that's vRef. On the ground it goes to its take-off setting.
    if (w >= 1) X.thsRate = clamp(0.8 * X.elev, -A.THS_RATE, A.THS_RATE);
    else if (E.onGround && E.gs < 30) X.thsRate = clamp(0.5 * (X.thsTakeoff - X.ths), -A.THS_RATE, A.THS_RATE);
    else X.thsRate = 0;

    // ---------------- Roll ----------------
    // Rate command with the bank held on release within the protection's edge. Past 35° the wheel
    // weakens and, released, it rolls back to 30°; a held full wheel stays past it.
    let uLaw = sr, protBank = false;
    const aphi = Math.abs(E.phi), sgn = E.phi >= 0 ? 1 : -1;
    if (w > 0) {
      protBank = aphi > BANK_TRIP && !E.apOn;
      let pCmd;
      if (E.apOn && Math.abs(sr) < 0.04) {
        pCmd = clamp(0.6 * (E.apBank - E.phi), -5 * DEG, 5 * DEG);
        X.rollLatched = false; X.boBankBack = false;
      } else if (Math.abs(sr) > 0.04) {
        pCmd = sr * A.ROLL_RATE_MAX;
        if (aphi > BANK_TRIP) {
          if (pCmd * sgn > 0) pCmd *= BANK_WHEEL;
          pCmd -= sgn * BANK_K * (aphi - BANK_BACK);
        }
        X.rollLatched = false; X.boBankBack = false;
      } else {
        if (!X.rollLatched) { X.rollLatched = true; X.phiRef = E.phi; }
        if (aphi > BANK_TRIP) X.boBankBack = true;
        if (X.boBankBack) {
          X.phiRef = sgn * BANK_BACK;
          if (aphi < BANK_BACK + 0.5 * DEG) X.boBankBack = false;
          pCmd = clamp(BANK_K * 2 * (X.phiRef - E.phi), -A.ROLL_RATE_MAX, A.ROLL_RATE_MAX);
        } else pCmd = clamp(1.0 * (X.phiRef - E.phi), -A.ROLL_RATE_MAX, A.ROLL_RATE_MAX);
      }
      const pdotCmd = 4.0 * (pCmd - E.p);
      const lNeed = E.Ixx * pdotCmd + (E.Izz - E.Iyy) * E.q * E.r - E.Ixz * E.p * E.q;
      uLaw = E.rollScale > 1 ? (lNeed - E.lOther) / E.rollScale : sr;
    }
    X.uRoll = clamp((1 - w) * sr + w * uLaw, -1, 1);

    // ---------------- Yaw: coordination and damper, as fbw.js ----------------
    const rudLim = E.rudLim;
    let rud = sy * rudLim;
    if (w > 0) {
      const rTurn = G * sphi / V;
      const kr = Math.min(1.2, 40 / V);
      rud += w * (-kr * (E.r - rTurn) + 0.8 * E.beta);
    }
    X.rudCmd = clamp(rud, -rudLim, rudLim);

    X.boProtStall = protStall;
    X.boProtOver = protOver;
    X.boProtBank = protBank;
    // The Airbus's protections aren't here. protAlpha only tells sim.js to drop the AP: at the
    // shaker a holds-only AP has nothing left to give (sim.js's 'protection' disconnect).
    const shaker = !E.onGround && E.alpha > E.alphaMax - A.ALPHA_SW_MARGIN;
    X.protAlpha = E.apOn && shaker;
    X.protSpeed = false;
    X.alphaFloorTrig = false;
  }

  // ---- the hooks sim.js calls ----
  const hooks = {
    // Core fields only a Boeing has (and so only a Boeing's snapshots carry).
    coreFields() {
      return {
        vRef: 0, boGam: 0, boBankBack: false, boProtStall: false, boProtOver: false, boProtBank: false,
        boOvr: false, boOvrLever: 0, boOvrT: 0,      // the pilot's hand on the lever (athrStep)
        boRefToga: false, boTakeoffHold: false,      // THR REF's rating; HOLD up to 400 ft after the take-off
        boWakeT: 0, boWake: false, boVStick: 0,      // autothrottle automatic activation
        boFlchDir: 0, boVnavDes: false, boThrVs: 0,  // FLCH and VNAV: which way, and THR's rate
        boCapture: false, boAltTgt: 0,               // ALT: capturing, and the altitude held
        boSpdCmd: 0, boTogaSpd: 0,                   // the speed the AP and A/T work to, m/s
        boHoldHdg: 0, boHoldLatched: false,          // HDG HOLD
        boTrack: 0,                                  // TO/GA: the track held
        boFlareTau: 0, boRollout: false, boRolloutYaw: 0, boYawClear: false, boAlign: false, boAlignYaw: 0, boCrab0: 0, boRolloutRoll: 0, boRollHeld: false,
        boAlignI: 0, boAlignBI: 0,                   // v0.4.2: the alignment's rudder and bank integrals
      };
    },

    // After sim.reset(): the Airbus names reset() uses, in Boeing's, and the reference speed.
    afterReset(X, ap, state, controls, ic) {
      controls.trim = 0;
      ap.armedLateral = ''; ap.armedVertical = '';
      if (!(ic.ap && 'ils' in ic.ap)) ap.ils = null;
      if (!(ic.ap && 'route' in ic.ap)) { ap.route = null; ap.routeIdx = 0; }
      if (!(ic.ap && 'athrArmed' in ic.ap)) ap.athrArmed = true;
      if (ap.lateral === 'HDG') ap.lateral = ic.ap && ic.ap.ap ? 'HDG SEL' : 'HDG HOLD';
      if (ic.ap && ic.ap.lateral) ap.lateral = ic.ap.lateral;
      if (ap.thrustMode === 'SPEED') ap.thrustMode = 'SPD';
      X.vRef = state.onGround ? Math.max(V2_FACTOR * state.vmm / VMM_FACTOR + TO_TRIM, state.vmm) : state.ias;
      X.boGam = state.gamma;
      X.boHoldHdg = state.hdg; X.boHoldLatched = true; X.boTrack = state.hdg;
      X.boAltTgt = ap.altFt * A.FT;
      if (ic.ap && ic.ap.ap && ap.vertical === 'ALT') X.boAltTgt = state.altInd;
      X.boSpdCmd = ap.spdKt * KT;
    },

    // The state's extras (STATUS.md, "v0.3.0 interfaces"). lc: this moment's lift curve; atm: its air.
    updateState(S, X, lc, atm) {
      const eas = S.tas * Math.sqrt(atm.rho / RHO0);
      const casK = eas > 20 ? S.ias / eas : 1;
      const vs1g = S.vls / A.VLS_FACTOR;
      S.vRef = X.vRef;
      S.vmm = VMM_FACTOR * vs1g * casK;
      S.vStick = S.vsw * casK;
      const aShake = lc.alphaMax - A.ALPHA_SW_MARGIN;
      S.shaker = !S.onGround && S.alpha > aShake;
      S.pliDeg = (aShake - S.alpha) / DEG;
      S.protStall = X.boProtStall; S.protOver = X.boProtOver; S.protBank = X.boProtBank;
      S.apSpdCmd = X.boSpdCmd;   // what the AP and A/T work to (VNAV's schedule, the limits), m/s
      S.vls = S.vmm;             // the tape's amber band
      S.warnings.stall = S.shaker;
    },

    // sim.js drops the AP on the wheels, except in an autoland: it stays until the pilot lets go.
    staysOnGround(ap) {
      return ap.lateral === 'ROLLOUT' || ap.vertical === 'FLARE' || (ap.lateral === 'LOC' && ap.vertical === 'G/S');
    },

    // After apStep: ROLLOUT steers through the pedals' control; once it ends, they let go once.
    applyControls(X, controls) {
      if (X.boRolloutRoll && X.boRollout) { controls.roll = X.boRolloutRoll; X.boRollHeld = true; }
      else if (X.boRollHeld) { controls.roll = 0; X.boRollHeld = false; }
      if (X.boRollout) controls.yaw = X.boRolloutYaw;
      else if (X.boAlign) controls.yaw = X.boAlignYaw;
      else if (X.boYawClear) { controls.yaw = 0; X.boYawClear = false; }
    },
  };

  return { fbwStep, hooks };
}
