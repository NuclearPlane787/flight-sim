// Aerodynamics of the A321neo: lift with a stall break per slat/flap angle, ground effect,
// the drag polar, and the moment coefficients. Pure functions, allocation free.
// Coefficients are on the wing area S, the span b and the mean aerodynamic chord c, and
// moments are about the reference point (25% MAC, src/geometry.js); the sim moves them to
// the centre of gravity. Body axes here are x forward, y right, z down (the usual flight
// dynamics frame); the sim converts to geometry.js's x forward, y left, z up where needed.

import * as A from './a321neo.js';

// Piecewise-linear lookup in [[x, y], ...] (x ascending).
export function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

// The low-speed lift curve for slat and flap angles (degrees): fills `o` with
// { clmax, a, cl0, alphaMax } (alphaMax in rad, a per rad).
export function liftCurve(slatDeg, flapDeg, o) {
  o.clmax = A.CLMAX_CLEAN + interp(A.SLAT_CLMAX, slatDeg) + interp(A.FLAP_CLMAX, flapDeg);
  o.a = A.CLA_CLEAN + (A.CLA_FULL - A.CLA_CLEAN) * Math.min(1, flapDeg / 34);
  o.alphaMax = A.ALPHA_MAX_CLEAN + A.SLAT_ALPHA * Math.min(slatDeg, 18)
    + (slatDeg > 18 ? 0.5 * A.DEG * (slatDeg - 18) / 9 : 0) + A.FLAP_ALPHA * flapDeg;
  // The linear part reaches the knee KNEE before alphaMax; the rounded top is a parabola.
  o.cl0 = o.clmax + o.a * A.KNEE / 2 - o.a * o.alphaMax;
  return o;
}

// Mach effects on the lift curve: fills `o` (from liftCurve) in place for Mach M.
export function machLift(o, M) {
  const mc = Math.min(M, 0.9) * Math.cos(A.SWEEP);
  const pg = 1 / Math.sqrt(1 - mc * mc);
  o.a *= pg;
  o.clmax *= Math.max(0.55, 1 - A.CLMAX_MACH_SLOPE * Math.max(0, M - 0.35));
  o.alphaMax = (o.clmax - o.cl0) / o.a + A.KNEE / 2;
  return o;
}

// Lift coefficient at angle of attack alpha (rad) for a lift curve `o`.
export function clOfAlpha(o, alpha) {
  const knee = o.alphaMax - A.KNEE;
  if (alpha <= knee) {
    // A gentle negative stall at -12° below the zero-lift angle keeps it bounded.
    const aMin = -o.cl0 / o.a - 12 * A.DEG;
    if (alpha < aMin) return o.cl0 + o.a * aMin + 0.5 * Math.sin(2 * (alpha - aMin)) * 0.3;
    return o.cl0 + o.a * alpha;
  }
  if (alpha <= o.alphaMax) {
    const d = o.alphaMax - alpha;
    return o.clmax - o.a / (2 * A.KNEE) * d * d;
  }
  // Past the stall: lift falls ~25% within a few degrees, then follows a flat plate.
  const d = alpha - o.alphaMax;
  const post = o.clmax * (0.75 + 0.25 * Math.exp(-d / (2.5 * A.DEG)));
  const plate = 1.15 * Math.sin(2 * alpha);
  const w = Math.min(1, d / (25 * A.DEG));
  return post * (1 - w) + plate * w;
}

// Inverse of the linear part: the angle of attack for a lift coefficient (below the knee).
export function alphaOfCl(o, cl) {
  const knee = o.alphaMax - A.KNEE;
  const clKnee = o.cl0 + o.a * knee;
  if (cl <= clKnee) return (cl - o.cl0) / o.a;
  if (cl >= o.clmax) return o.alphaMax;
  return o.alphaMax - Math.sqrt((o.clmax - cl) * 2 * A.KNEE / o.a);
}

// Ground effect factor (1 = free air, → 0 on the ground) for wing height h above ground.
export function groundEffect(h) {
  const r = 16 * Math.max(h, 0.5) / A.SPAN;
  return (r * r) / (1 + r * r);
}

const lc = { clmax: 0, a: 0, cl0: 0, alphaMax: 0 };

// The full coefficient set. `s` holds the inputs:
//   alpha, beta, M, phat, qhat, rhat, adothat (rates made non-dimensional),
//   slat, flap (deg), gear (0..1), doors (0..1), sb (speed brake 0..1), gsp (ground spoilers
//   0..1), spL, spR (roll spoilers 0..1), ail (rad, + roll right), rud (rad, + yaw right),
//   ths (rad, + nose up), hWing (m above ground).
// Writes into `o`: CL, CD, CY, Cl, Cm (without the elevator), Cn, CmElev (per rad of
// nose-up elevator), clmax, alphaMax.
export function coefficients(s, o) {
  liftCurve(s.slat, s.flap, lc);
  machLift(lc, s.M);
  const ge = groundEffect(s.hWing);
  const geLift = 1 + 0.10 * (1 - ge);

  let CL = clOfAlpha(lc, s.alpha) * geLift;
  CL += A.SPEEDBRAKE_CL * s.sb + A.GROUND_SPOILER_CL * s.gsp * (0.6 + 0.4 * s.flap / 34);
  CL += A.SPEEDBRAKE_CL * 0.5 * (s.spL + s.spR);
  CL += -0.25 * s.ths; // the stabiliser's own (download) lift

  const e = A.OSWALD - (A.OSWALD - A.OSWALD_FLAPS) * Math.min(1, s.flap / 34);
  const K = 1 / (Math.PI * e * A.AR);
  let CD = A.CD0 + K * CL * CL * ge;
  CD += interp(A.FLAP_CD, s.flap) + A.SLAT_CD_PER_DEG * s.slat;
  CD += A.GEAR_CD * s.gear + A.GEAR_DOOR_CD * s.doors;
  CD += A.SPEEDBRAKE_CD * s.sb + A.GROUND_SPOILER_CD * s.gsp + 0.012 * (s.spL + s.spR);
  const mcrit = A.MCRIT0 - 0.1 * (CL - 0.5);
  if (s.M > mcrit) { const dm = s.M - mcrit; CD += A.WAVE_K * dm * dm * dm * dm; }
  if (s.alpha > lc.alphaMax) { const sd = Math.sin(s.alpha - lc.alphaMax); CD += 1.6 * sd * sd + 0.04 * sd; }
  CD += 0.4 * s.beta * s.beta;

  o.CL = CL;
  o.CD = CD;
  o.CY = A.CY.beta * s.beta + A.CY.rudder * s.rud;
  // Past the stall the roll damping fades (wing drop is then possible).
  const stallF = s.alpha > lc.alphaMax ? Math.max(0.2, 1 - (s.alpha - lc.alphaMax) / (6 * A.DEG)) : 1;
  o.Cl = A.CL_ROLL.beta * s.beta + A.CL_ROLL.p * s.phat * stallF + A.CL_ROLL.r * s.rhat
    + A.CL_ROLL.aileron * s.ail + A.CL_ROLL.spoiler * (s.spR - s.spL) + A.CL_ROLL.rudder * s.rud;
  o.Cn = A.CN.beta * s.beta + A.CN.p * s.phat + A.CN.r * s.rhat + A.CN.aileron * s.ail
    + A.CN.rudder * s.rud + 0.01 * (s.spR - s.spL);
  // Pitch: basic, static stability, damping, trim, flap/gear/ground increments; post-stall
  // the nose drops (the tail stays effective).
  let Cm = 0.012 + A.CM.alpha * s.alpha + A.CM.q * s.qhat + A.CM.alphaDot * s.adothat
    + A.CM.ths * s.ths + A.CM.flap * s.flap + A.CM.gear * s.gear
    + A.CM.ground * (1 - ge) + A.CM.spoiler * (s.sb + s.gsp);
  if (s.alpha > lc.alphaMax) Cm -= 0.6 * (s.alpha - lc.alphaMax);
  o.Cm = Cm;
  o.CmElev = A.CM.elevator;
  o.clmax = lc.clmax;
  o.alphaMax = lc.alphaMax;
  o.ge = ge;
  return o;
}
