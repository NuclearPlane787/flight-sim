// Fly-by-wire: Normal law (load-factor demand pitch with auto-trim and flight-path hold,
// roll-rate demand with 33° bank hold, the protections, the flare law and ground mode) and
// Alternate law (no alpha protection, direct roll, stall possible). Allocation free.
//
// The pitch and roll loops invert the sim's own aerodynamic model (nonlinear dynamic
// inversion): the law asks for a pitch or roll acceleration, and the surface deflection
// that gives it is worked out from the moments the model computed this step. This keeps
// the response the same at every speed and stable at both 1/120 s and 1/30 s steps.
// Body axes: x forward, y right, z down; p roll right +, q pitch up +, r yaw right +.

import * as A321 from './a321neo.js';

const G = 9.80665;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createFbw(A) {
  // In the landing configuration the stick asks for a flight-path rate (see the pitch section).
  const PATH_RATE = 3.5 * A.DEG;       // at full stick

  // Flare law tuning (see the pitch section).
  const FLARE_RATE = 8 * A.DEG;        // nose-up rate at full back stick
  const FLARE_RATE_DN = 3 * A.DEG;     // nose-down rate at full forward stick
  const FLARE_SINK = 0.5 * A.DEG;      // the law's nose-down rate from 30 ft
  const FLARE_THETA_MIN = -2 * A.DEG;  // where the sink stops
  const FLARE_THETA_PUSH = -5 * A.DEG; // lowest command with the stick forward
  const FLARE_THETA_MAX = 7.5 * A.DEG; // highest command (tail strike is about 9.7° on the struts)
  const FLARE_LEAD = 2 * A.DEG;        // how far the command may run ahead of the attitude
  const FLARE_Q_MAX = 3.5 * A.DEG;     // pitch-rate limit in the flare

  // X: the sim's core state (fbw fields below are kept there so snapshots include them).
  // c: controls. E: per-step environment (see sim.js). Writes X.elevCmd, X.uRoll, X.rudCmd,
  // X.thsRate, X.protAlpha, X.protSpeed, X.alphaFloorTrig, X.flare.
  function fbwStep(X, c, E, dt) {
    const normal = c.law !== 'alternate';
    const flt = X.flt;
    const V = Math.max(E.tas, 30);
    const sp = c.pitch, sr = c.roll, sy = c.yaw;
    const cphi = Math.cos(E.phi), sphi = Math.sin(E.phi);
    const flaps = E.slat > 0.5;

    // ---------------- Pitch ----------------
    // Ground mode is direct, but with pitch-rate damping and part of the nose-up authority, so
    // a held key (full aft stick within 0.3 s) rotates at about 3–4°/s, as a pilot would, not
    // 15°/s into a tail strike. Airborne, the normal or alternate law takes over (flt).
    const elevRaw = sp > 0 ? sp * A.ELEV_UP * 0.75 : sp * A.ELEV_DN;
    const elevDirect = clamp(elevRaw - 4 * E.q, -A.ELEV_DN, A.ELEV_UP);
    let elevLaw = 0;
    let protAlpha = false, protSpeed = false;
    // On the wheels the flare is over (else a touch-and-go would lift off in the flare law).
    if (flt <= 0) X.flare = false;
    // Levers at TOGA: a go-around. It leaves (and blocks) the flare and the landing path law,
    // so full back stick gets the plain load-factor pull to climb away.
    const goAround = c.thrust > 0.9;
    if (flt > 0) {
      const nzMax = flaps ? A.NZ_MAX_FLAPS : A.NZ_MAX_CLEAN;
      const nzMin = flaps ? A.NZ_MIN_FLAPS : A.NZ_MIN_CLEAN;
      // Bank compensation up to 33°, so a hands-off turn holds its path.
      const cphiC = Math.max(cphi, Math.cos(A.BANK_NEUTRAL));
      const cg = Math.cos(E.gamma);
      const nzBase = cg / cphiC;
      let qCmd;

      // The flare law: at 50 ft on a landing the attitude is memorised; from 30 ft the nose is
      // lowered progressively (about −2° in 8 s from a usual approach attitude), so the pilot
      // has to flare (A320 FCOM, via the notes). The stick asks for a pitch rate around that
      // memorised attitude: held back it raises the nose at up to FLARE_RATE, released it
      // keeps the attitude reached (less the slow sink). So a tap or a short hold of a key
      // gives a small, lasting change, and the command can't run past FLARE_THETA_MAX.
      const flareCond = normal && !E.apOn && !goAround && E.aglFt < 50 && E.gearDown && !E.onGround && E.vs < 0.5;
      if (flareCond && !X.flare && E.aglFt > 30) { X.flare = true; X.flareTheta = E.theta; X.flareT = 0; }
      if (X.flare && (E.aglFt > 60 || !normal || E.apOn || goAround)) X.flare = false;

      if (X.flare) {
        if (E.aglFt < 30) X.flareT += dt;
        const sink = X.flareT > 0 && X.flareTheta > FLARE_THETA_MIN ? FLARE_SINK : 0;
        let rate = sp * (sp > 0 ? FLARE_RATE : FLARE_RATE_DN) - sink;
        // Nose-up demand fades out near the top, so the attitude doesn't overshoot it.
        if (rate > 0) rate = Math.min(rate, 2 * Math.max(0, FLARE_THETA_MAX - X.flareTheta));
        // X.flareTheta is the attitude command; it stays within reach of the actual attitude.
        const hi = Math.min(FLARE_THETA_MAX, E.theta + FLARE_LEAD);
        const lo = Math.min(hi, Math.max(FLARE_THETA_PUSH, E.theta - 2 * A.DEG));
        const th = clamp(X.flareTheta + rate * dt, lo, hi);
        rate = (th - X.flareTheta) / dt;
        X.flareTheta = th;
        qCmd = clamp(rate + 1.5 * (th - E.theta), -FLARE_Q_MAX, FLARE_Q_MAX);
      } else {
        let nzCmd;
        const stickActive = Math.abs(sp) > 0.04;
        if (E.apOn && !stickActive) {
          nzCmd = cg / cphiC + V * 0.55 * (E.apGamma - E.gamma) / G;
          nzCmd = clamp(nzCmd, 0.8, 1.25);
          X.holdLatched = false;
        } else if (normal && !E.apOn && !goAround && E.gearDown && E.flap > 18) {
          // Landing configuration (gear down, CONF 3 or FULL; E.flap is in degrees): the stick
          // asks for a flight-path rate around a path held hands off. A tap moves the path a
          // little and it stays there; a hold keeps turning it (PATH_RATE at full stick), so
          // fine corrections work on a keyboard. The load-factor limits and the protections
          // below still apply.
          if (!X.holdLatched) { X.holdLatched = true; X.gammaRef = E.gamma; }
          const rate = sp * PATH_RATE;
          X.gammaRef = clamp(X.gammaRef + rate * dt, E.gamma - 2 * A.DEG, E.gamma + 2 * A.DEG);
          const hold = clamp(V * 0.35 * (X.gammaRef - E.gamma) / G, -0.25, 0.25);
          nzCmd = nzBase + 0.5 * V * rate / G + hold; // half feed-forward: no overshoot
          X.releaseT = 0;
        } else if (stickActive) {
          nzCmd = nzBase + (sp > 0 ? sp * (nzMax - 1) : -sp * (nzMin - 1));
          X.holdLatched = false; X.releaseT = 0;
        } else {
          // Hands off: hold the flight path (latched once the pitch rate has settled).
          X.releaseT += dt;
          if (!X.holdLatched && (Math.abs(E.q) < 1.0 * A.DEG || X.releaseT > 3)) {
            X.holdLatched = true; X.gammaRef = E.gamma;
          }
          nzCmd = X.holdLatched ? nzBase + V * 0.35 * (X.gammaRef - E.gamma) / G : nzBase;
          if (X.holdLatched) nzCmd = clamp(nzCmd, nzBase - 0.25, nzBase + 0.25);
        }

        // High-speed protection: a nose-up demand above VMO + 6 kt / MMO + 0.01.
        if (normal) {
          // `over` in m/s past VMO + 6 kt (or the Mach equivalent). The nose-down stick authority
          // fades to zero by VMO + 16 kt while a nose-up demand grows (up to +1.75 g).
          // The speed trend (4 s ahead) gives the protection some anticipation.
          const trend = 4 * Math.max(0, E.iasDot);
          const over = Math.max(E.ias + trend - (A.VMO_KT + 6) * A.KT, (E.mach + trend / 600 - (A.MMO + 0.01)) * 600);
          if (over > 0) {
            protSpeed = true;
            const fade = Math.max(0, 1 - over / (10 * A.KT));
            const stick = sp < 0 ? -sp * (nzMin - 1) * fade : sp * (nzMax - 1);
            nzCmd = nzBase + stick + Math.min(1.0, 0.15 * over);
          }
        } else {
          // Alternate law: low-speed stability, a gentle nose-down demand below VSW that a
          // firm pull overrides (so a stall is possible).
          if (E.ias < E.vsw + 5 * A.KT) nzCmd -= 0.02 * (E.vsw + 5 * A.KT - E.ias) * Math.max(0, 1 - sp * 2);
        }
        nzCmd = clamp(nzCmd, nzMin, nzMax);

        // Flight path rate for that load factor, as a body pitch rate, plus load-factor feedback.
        const gdot = G * (nzCmd * cphi - cg) / V;
        qCmd = gdot * cphi + G * nzCmd * sphi * sphi / V + 1.0 * G * (nzCmd - E.nz) / V;

        if (normal) {
          // High-angle-of-attack protection: past α prot the stick asks for α (neutral = α prot,
          // full back = α max). Tracked through α̇ = q − γ̇: q = γ̇ (measured) + k·(α cmd − α).
          const aProt = E.alphaMax - A.ALPHA_PROT_MARGIN;
          const gdotMeas = G * (E.nz * cphi - cg) / V;
          if (E.alpha > aProt - 2 * A.DEG || X.protAlphaLatched) {
            const aCmd = aProt + Math.max(0, sp) * (E.alphaMax - 0.5 * A.DEG - aProt);
            const qA = gdotMeas * cphi + G * E.nz * sphi * sphi / V + 1.2 * (aCmd - E.alpha);
            if (qA < qCmd) { qCmd = qA; protAlpha = E.alpha > aProt - 0.5 * A.DEG; }
            X.protAlphaLatched = E.alpha > aProt - 0.5 * A.DEG && sp > -0.3;
          }
          // Pitch attitude limits: 30° up (25° at low speed / in FULL), 15° down, soft over 5°.
          const thMax = (E.ias < E.vls || E.flap > 30) ? A.PITCH_MAX_LOWSPD : A.PITCH_MAX;
          qCmd = Math.min(qCmd, 0.6 * (thMax - E.theta));
          qCmd = Math.max(qCmd, 0.6 * (A.PITCH_MIN - E.theta));
        }
        qCmd = clamp(qCmd, -8 * A.DEG, 8 * A.DEG);
      }
      // Inversion: the elevator that gives qdot = 3.5·(qCmd − q).
      const qdotCmd = 3.5 * (qCmd - E.q);
      const myNeed = E.Iyy * qdotCmd + (E.Ixx - E.Izz) * E.p * E.r + E.Ixz * (E.p * E.p - E.r * E.r);
      elevLaw = E.elevScale > 1 ? (myNeed - E.myOther) / E.elevScale : elevDirect;
    }
    let elevCmd = (1 - flt) * elevDirect + flt * elevLaw;
    X.elevCmd = clamp(elevCmd, -A.ELEV_DN, A.ELEV_UP);

    // Auto-trim: the stabiliser offloads the elevator (frozen in the flare, on the ground,
    // in α prot and beyond 33° bank).
    if (flt >= 1 && !X.flare && !protAlpha && Math.abs(E.phi) < A.BANK_NEUTRAL) {
      X.thsRate = clamp(0.8 * X.elev, -A.THS_RATE, A.THS_RATE);
    } else if (E.onGround && E.gs < 30) {
      X.thsRate = clamp(0.5 * (X.thsTakeoff - X.ths), -A.THS_RATE, A.THS_RATE);
    } else X.thsRate = 0;

    // ---------------- Roll ----------------
    let uLaw = sr;
    if (flt > 0 && normal) {
      const lim = X.protSpeed ? 40 * A.DEG : X.protAlpha ? A.BANK_MAX_PROT : A.BANK_MAX;
      const aphi = Math.abs(E.phi), sgn = E.phi >= 0 ? 1 : -1;
      let pCmd;
      if (E.apOn && Math.abs(sr) < 0.04) {
        pCmd = clamp(0.6 * (E.apBank - E.phi), -5 * A.DEG, 5 * A.DEG);
        X.rollLatched = false;
      } else if (Math.abs(sr) > 0.04) {
        pCmd = sr * A.ROLL_RATE_MAX;
        if (aphi > A.BANK_NEUTRAL) pCmd -= sgn * 0.5 * (aphi - A.BANK_NEUTRAL); // spiral stability
        if (aphi > lim && pCmd * sgn > 0) pCmd = -sgn * 1.0 * (aphi - lim);
        X.rollLatched = false;
      } else {
        if (!X.rollLatched) { X.rollLatched = true; X.phiRef = clamp(E.phi, -A.BANK_NEUTRAL, A.BANK_NEUTRAL); }
        if (X.protSpeed) X.phiRef = 0; // high-speed protection: spiral stability to wings level
        pCmd = aphi > A.BANK_NEUTRAL ? -sgn * Math.min(A.ROLL_RATE_MAX, 0.5 * (aphi - A.BANK_NEUTRAL))
          : clamp(1.0 * (X.phiRef - E.phi), -A.ROLL_RATE_MAX, A.ROLL_RATE_MAX);
      }
      const pdotCmd = 4.0 * (pCmd - E.p);
      const lNeed = E.Ixx * pdotCmd + (E.Izz - E.Iyy) * E.q * E.r - E.Ixz * E.p * E.q;
      uLaw = E.rollScale > 1 ? (lNeed - E.lOther) / E.rollScale : sr;
    }
    X.uRoll = clamp((1 - flt) * sr + flt * uLaw, -1, 1);

    // ---------------- Yaw ----------------
    const rudLim = E.rudLim;
    let rud = sy * rudLim;
    if (flt > 0) {
      const rTurn = G * sphi / V;
      const kr = Math.min(1.2, 40 / V);
      let aug = -kr * (E.r - rTurn);              // yaw damper
      if (normal) aug += 0.8 * E.beta;             // turn coordination
      rud += flt * aug;
    }
    X.rudCmd = clamp(rud, -rudLim, rudLim);

    X.protAlpha = protAlpha;
    X.protSpeed = protSpeed;
    // α floor: TOGA when α passes α max − 2° in Normal law, airborne above 100 ft.
    // Inhibited above M0.6.
    X.alphaFloorTrig = normal && !E.onGround && E.aglFt > 100 && E.mach < 0.6 && E.alpha > E.alphaMax - A.ALPHA_FLOOR_MARGIN;
  }

  return { fbwStep };
}

// The A321neo's, as before the type registry (tests and tools import these).
export const { fbwStep } = createFbw(A321);
