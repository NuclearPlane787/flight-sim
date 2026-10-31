// The two CFM LEAP-1A engines: thrust lever detents, N1 spool lag, thrust with N1, Mach
// and altitude, reverse thrust with a deploy delay, and fuel flow. Allocation free.

import * as A from './a321neo.js';

// Thrust lever: TLA/45°, so CL = 25/45, FLX/MCT = 35/45, TOGA = 1; below 0 is reverse.
export const LEVER_CL = 25 / 45, LEVER_MCT = 35 / 45;

// Thrust demand (fraction of the TOGA thrust available) for a forward lever position.
// Linear from IDLE to CL, then CL→MCT→TOGA (the Airbus lever-to-thrust law).
export function leverToPhi(lever) {
  if (lever <= 0) return 0;
  if (lever <= LEVER_CL) return A.RATING.CL * lever / LEVER_CL;
  if (lever <= LEVER_MCT) return A.RATING.CL + (A.RATING.MCT - A.RATING.CL) * (lever - LEVER_CL) / (LEVER_MCT - LEVER_CL);
  return A.RATING.MCT + (A.RATING.TOGA - A.RATING.MCT) * Math.min(1, (lever - LEVER_MCT) / (1 - LEVER_MCT));
}

export function detentName(lever) {
  if (lever < -0.02) return 'REV';
  if (Math.abs(lever) <= 0.02) return 'IDLE';
  if (Math.abs(lever - LEVER_CL) <= 0.02) return 'CL';
  if (Math.abs(lever - LEVER_MCT) <= 0.02) return 'FLX/MCT';
  if (lever >= 0.98) return 'TOGA';
  return '';
}

// TOGA thrust available per engine (N) at density ratio sigma and Mach M.
export function togaThrust(sigma, M) {
  const lapse = Math.pow(sigma, A.LAPSE_SIGMA_EXP) * (1 + A.LAPSE_M1 * M + A.LAPSE_M2 * M * M);
  return A.T0_ENGINE * lapse;
}

// Idle N1 rises with altitude and speed (flight idle).
export function idleN1(sigma, M) {
  return A.N1_IDLE + 9 * (1 - sigma) + 6 * M;
}

// N1 for a forward thrust demand phi (0..1).
export function n1ForPhi(phi, n1Idle) {
  return n1Idle + (A.N1_TOGA - n1Idle) * Math.sqrt(Math.max(0, Math.min(1, phi)));
}

// Advance one engine. `e` = { n1, n1Target, rev, thrustN, ffKgS, fuelOk }.
// phiFwd: forward demand 0..1; revCmd: 0..1 reverse demand (only when on ground);
// revSelected: reversers commanded to deploy. Returns nothing; updates e.
export function engineStep(e, phiFwd, revSelected, revCmd, sigma, M, sqrtTheta, dt) {
  // Reversers move first; while they travel the engine stays at idle.
  const revTarget = revSelected ? 1 : 0;
  if (e.rev < revTarget) e.rev = Math.min(1, e.rev + dt / A.REV_DEPLOY_S);
  else if (e.rev > revTarget) e.rev = Math.max(0, e.rev - dt / A.REV_DEPLOY_S);

  const n1Idle = idleN1(sigma, M);
  let target;
  if (!e.fuelOk) target = 4 + 20 * M; // windmilling
  else if (e.rev > 0) target = e.rev >= 1 ? n1Idle + (76 - n1Idle) * Math.sqrt(revCmd) : n1Idle;
  else target = n1ForPhi(phiFwd, n1Idle);
  e.n1Target = target;
  // First-order lag, slower at low N1 (the core accelerates slowly from idle).
  const f = Math.max(0, Math.min(1, (e.n1 - 20) / 76));
  const tau = A.SPOOL_TAU_LOW + (A.SPOOL_TAU_HIGH - A.SPOOL_TAU_LOW) * f;
  e.n1 += (target - e.n1) * Math.min(1, dt / tau);

  // Thrust from N1: quadratic in the fraction of the idle-to-TOGA span.
  const toga = togaThrust(sigma, M);
  const idleT = A.T_IDLE * Math.pow(sigma, A.LAPSE_SIGMA_EXP) * Math.max(0, 1 - 1.2 * M);
  let fwd = 0, revT = 0;
  if (e.fuelOk) {
    if (e.rev > 0 && e.rev >= 1) {
      const fr = Math.max(0, (e.n1 - n1Idle) / (76 - n1Idle));
      revT = idleT + (A.REV_FRACTION * A.T0_ENGINE - idleT) * fr * fr;
    } else {
      const fr = Math.max(0, (e.n1 - n1Idle) / (A.N1_TOGA - n1Idle));
      fwd = idleT + (toga - idleT) * fr * fr;
    }
  }
  // Partly deployed reversers spoil forward thrust; fully deployed ones push back.
  e.thrustN = fwd * (1 - e.rev) - revT * e.rev;
  const gross = fwd + revT;
  const tsfc = (A.TSFC_C0 + A.TSFC_C1 * M) * sqrtTheta;
  e.ffKgS = e.fuelOk ? Math.max(A.FF_IDLE * (0.55 + 0.45 * sigma), tsfc * gross) : 0;
}
