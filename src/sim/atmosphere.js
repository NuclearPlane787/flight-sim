// The International Standard Atmosphere (ICAO Doc 7488), 0 to 20 km geopotential.
// Indicated (= calibrated here: no position error), equivalent and true airspeed and Mach
// are kept apart. SI units throughout. No DOM: runs in node and in workers.

export const T0 = 288.15;      // K, sea level
export const P0 = 101325;      // Pa
export const RHO0 = 1.225;     // kg/m³
export const G0 = 9.80665;     // m/s²
export const R_AIR = 287.05287; // J/(kg·K)
export const GAMMA = 1.4;
export const A0 = Math.sqrt(GAMMA * R_AIR * T0); // 340.294 m/s, speed of sound at sea level
const LAPSE = -0.0065;          // K/m, troposphere
const H_TROP = 11000;           // m
const T_TROP = T0 + LAPSE * H_TROP;                                  // 216.65 K
const P_TROP = P0 * Math.pow(T_TROP / T0, -G0 / (LAPSE * R_AIR));     // 22632 Pa
const EXP_TROP = -G0 / (LAPSE * R_AIR);                               // 5.2559

// Fills `out` with { T, p, rho, a } at geopotential altitude h (m). Allocation free.
export function isaInto(h, out) {
  let T, p;
  if (h < H_TROP) {
    T = T0 + LAPSE * h;
    p = P0 * Math.pow(T / T0, EXP_TROP);
  } else {
    T = T_TROP;
    p = P_TROP * Math.exp(-G0 * (h - H_TROP) / (R_AIR * T_TROP));
  }
  out.T = T;
  out.p = p;
  out.rho = p / (R_AIR * T);
  out.a = Math.sqrt(GAMMA * R_AIR * T);
  return out;
}

export function isa(h) {
  return isaInto(h, { T: 0, p: 0, rho: 0, a: 0 });
}

const tmp = { T: 0, p: 0, rho: 0, a: 0 };

// Calibrated airspeed from true airspeed, via the impact pressure (subsonic, compressible).
export function casFromTasP(tas, p, a) {
  const M = tas / a;
  const qc = p * (Math.pow(1 + 0.2 * M * M, 3.5) - 1);
  return A0 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1));
}

// True airspeed from calibrated airspeed at pressure p and speed of sound a.
export function tasFromCasP(cas, p, a) {
  const qc = P0 * (Math.pow(1 + 0.2 * (cas / A0) ** 2, 3.5) - 1);
  const M = Math.sqrt(5 * (Math.pow(qc / p + 1, 2 / 7) - 1));
  return M * a;
}

// The cockpit's indicated airspeed is taken as calibrated airspeed (no instrument errors).
export function iasFromTas(tas, h) { isaInto(h, tmp); return casFromTasP(tas, tmp.p, tmp.a); }
export function tasFromIas(ias, h) { isaInto(h, tmp); return tasFromCasP(ias, tmp.p, tmp.a); }
export function mach(tas, h) { isaInto(h, tmp); return tas / tmp.a; }
// Mach from calibrated airspeed at altitude h.
export function machFromIas(ias, h) { isaInto(h, tmp); return tasFromCasP(ias, tmp.p, tmp.a) / tmp.a; }
// Calibrated airspeed for a Mach number at altitude h.
export function iasFromMach(M, h) { isaInto(h, tmp); return casFromTasP(M * tmp.a, tmp.p, tmp.a); }
