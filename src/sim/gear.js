// Landing gear: the nose and two main legs as nonlinear spring-dampers, tyre rolling and
// side friction, wheel brakes with anti-skid, and nosewheel steering. Allocation free.
// Body axes here: x forward, y right, z down (FRD). R is the body→NED rotation (row major).

import * as A321 from './a321neo.js';

export function createGear(A) {
  // v0.4.2, hydroplaning (dynamic, in standing water): above 9 √p kt (p the tyres' pressure, psi; Horne's formula, NASA TN
  // D-2056) the tyres ride on the water and lose almost all their grip, over ±8 kt either side.
  const HYDRO_MS = 9 * Math.sqrt(A.TYRE_PSI ?? 200) * 0.514444, HYDRO_BAND = 8 * 0.514444;
  // One leg. `leg` (persistent per leg):
  //   { rx, ry, rz }   uncompressed tyre-bottom point relative to the CG, FRD (set by the sim)
  //   { stroke, k, k3, c, cExt, mu, isNose, comp, compRate, wow, normal, kind, vRoll }
  // `k` (per step context): R, vn, ve, vd (NED velocity of the CG), p, q, r, px, py, pz
  //   (CG map position, z up), groundH(x, y, leg) → sets leg.gh and leg.kind, brake (0..1),
  //   steer (rad, + right), F (Float64Array 3, body force sum), M (Float64Array 3, moment sum).
  function legStep(leg, k) {
    const R = k.R;
    const rx = leg.rx, ry = leg.ry, rz = leg.rz;
    // World position of the uncompressed contact point (NED offsets → map ENU).
    const dn = R[0] * rx + R[1] * ry + R[2] * rz;
    const de = R[3] * rx + R[4] * ry + R[5] * rz;
    const dd = R[6] * rx + R[7] * ry + R[8] * rz;
    const wx = k.px + de, wy = k.py + dn, wz = k.pz - dd;
    k.groundAt(wx, wy, leg);
    const pen = leg.gh - wz;               // how far the free tyre would sink into the ground
    const cosT = Math.max(0.5, R[8]);       // strut (body z) against the vertical
    leg.comp = pen > 0 ? pen / cosT : 0;
    if (leg.comp <= 0) {
      leg.wow = false; leg.normal = 0; leg.compRate = 0; leg.vRoll *= 0.995;
      return;
    }
    // Velocity of the contact point: v + ω × r (body), then the vertical part in NED.
    const wxr = k.q * rz - k.r * ry;
    const wyr = k.r * rx - k.p * rz;
    const wzr = k.p * ry - k.q * rx;
    const ub = k.u + wxr, vb = k.v + wyr, wb = k.w + wzr;  // body-frame point velocity
    const vdPoint = R[6] * ub + R[7] * vb + R[8] * wb;     // NED down speed of the point
    leg.compRate = vdPoint / cosT;
    let c = leg.comp;
    let fs = leg.k * c + leg.k3 * c * c * c;
    if (c > leg.stroke) fs += 25 * leg.k * (c - leg.stroke) + 2e7 * (c - leg.stroke) * (c - leg.stroke); // bottomed out
    fs += (leg.compRate > 0 ? leg.c : leg.cExt) * leg.compRate;
    if (fs < 0) fs = 0;
    leg.wow = true;
    leg.normal = fs;

    // Tyre: rolling direction from the steering angle (nose only).
    const st = leg.isNose ? k.steer : 0;
    const cs = Math.cos(st), sn = Math.sin(st);
    const vLong = ub * cs + vb * sn;
    const vLat = -ub * sn + vb * cs;
    leg.vRoll = vLong;
    // Off the pavement (grass), the tyres roll heavier and brake and grip less.
    const soft = leg.kind !== 'runway';
    // v0.4.0: k.tyres, the runway's state on the pavement (null when it's dry, so nothing changes).
    const wet = !soft ? k.tyres : null;
    // v0.4.2: how much of this tyre is riding on the water (0..1).
    let hp = 0;
    if (wet && wet.hydro) {
      const x = Math.min(1, Math.max(0, (Math.abs(vLong) - HYDRO_MS + HYDRO_BAND) / (2 * HYDRO_BAND)));
      hp = wet.hydro * x * x * (3 - 2 * x);
      if (hp > k.hydro) k.hydro = hp;
    }
    const mu = soft ? leg.mu * A.SIDE_MU_GRASS : wet ? leg.mu * wet.side * (1 - 0.85 * hp) : leg.mu;
    // Rolling resistance and brakes (anti-skid holds the optimum slip: force ≤ BRAKE_MU·N).
    const brake = leg.isNose ? 0 : k.brake;
    const fLongMax = wet ? (A.ROLL_RESIST + wet.rollAdd + A.BRAKE_MU * wet.brake * (1 - 0.9 * hp) * brake) * fs
      : ((soft ? A.ROLL_RESIST_GRASS : A.ROLL_RESIST) + (soft ? A.BRAKE_MU_GRASS : A.BRAKE_MU) * brake) * fs;
    const fLong = -fLongMax * Math.tanh(vLong / 0.08);
    // Side force: linear in slip angle up to ~6°, saturating at mu·N.
    const vRef = Math.max(0.25, 0.1 * Math.abs(vLong));
    const fLat = -mu * fs * Math.tanh(vLat / vRef);
    // Into body axes (strut force along body −z).
    const fx = fLong * cs - fLat * sn;
    const fy = fLong * sn + fLat * cs;
    const fz = -fs;
    // Applied at the compressed contact point.
    const rzc = rz - c;
    k.F[0] += fx; k.F[1] += fy; k.F[2] += fz;
    k.M[0] += ry * fz - rzc * fy;
    k.M[1] += rzc * fx - rx * fz;
    k.M[2] += rx * fy - ry * fx;
  }

  return { legStep };
}

// The A321neo's, as before the type registry (tests and tools import these).
export const { legStep } = createGear(A321);
