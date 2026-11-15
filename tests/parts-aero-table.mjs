// v0.5.3: the parts' model against each type's lumped model (Part 1's validation table). Used by
// tests/parts-aero.test.mjs and tools/fit-parts-aero.mjs. Each row is a coefficient or a derivative at a trimmed
// point, by central differences on both models' coefficient functions (the same states).

import { typeById, kitFor } from '../src/sim/types.js';
import { partsModel, partsInto } from '../src/sim/parts-aero.js';
import { isaInto } from '../src/sim/atmosphere.js';

const DEG = Math.PI / 180, KT = 0.514444, FT = 0.3048, G = 9.80665;

// The points: cruise (clean), clean at 250 kt and 10,000 ft (the clean stall), and approach (landing flaps 3 on the A321, 30 on the Boeings, gear down). The CG at the
// reference point (25 % MAC), as the lumped model's moments are about it.
export const POINTS = {
  a321neo: { cruise: { M: 0.78, altFt: 35000, kg: 70000, slat: 0, flap: 0, gear: 0 }, clean: { kt: 250, altFt: 10000, kg: 70000, slat: 0, flap: 0, gear: 0 }, approach: { kt: 140, altFt: 1000, kg: 66000, slat: 22, flap: 21, gear: 1 } },
  'b787-9': { cruise: { M: 0.85, altFt: 39000, kg: 200000, slat: 0, flap: 0, gear: 0 }, clean: { kt: 250, altFt: 10000, kg: 200000, slat: 0, flap: 0, gear: 0 }, approach: { kt: 150, altFt: 1000, kg: 170000, slat: 30, flap: 30, gear: 1 } },
  'b777-300er': { cruise: { M: 0.84, altFt: 35000, kg: 280000, slat: 0, flap: 0, gear: 0 }, clean: { kt: 250, altFt: 10000, kg: 280000, slat: 0, flap: 0, gear: 0 }, approach: { kt: 155, altFt: 1000, kg: 230000, slat: 30, flap: 30, gear: 1 } },
};

const blank = () => ({ alpha: 0, beta: 0, M: 0, phat: 0, qhat: 0, rhat: 0, adothat: 0, slat: 0, flap: 0, gear: 0, doors: 0, sb: 0, gsp: 0, spL: 0, spR: 0, ail: 0, rud: 0, ths: 0, hWing: 10000, elev: 0 });

// The trimmed state of a point by the lumped model: α for the weight, the stabiliser for Cm = 0 about 25 % MAC.
export function trimState(id, pt) {
  const T = typeById(id), A = T.data, fm = kitFor(id).fm;
  const atm = { T: 0, p: 0, rho: 0, a: 0 };
  isaInto(pt.altFt * FT, atm);
  const V = pt.M ? pt.M * atm.a : pt.kt * KT * Math.sqrt(1.225 / atm.rho);
  const M = V / atm.a, q = 0.5 * atm.rho * V * V;
  const s = blank();
  Object.assign(s, { M, slat: pt.slat, flap: pt.flap, gear: pt.gear, doors: 0 });
  const CLneed = pt.kg * G / (q * A.S);
  const o = {};
  let alpha = 0.03, ths = 0;
  for (let i = 0; i < 40; i++) {
    s.alpha = alpha; s.ths = ths;
    fm.coefficients(s, o);
    alpha += (CLneed - o.CL) / 5;
    ths -= o.Cm / A.CM.ths;
  }
  s.alpha = alpha; s.ths = ths;
  return { s, CLneed, q, V };
}

// Both models' rows at a state.
function lumpedAt(id, s) { const o = {}; kitFor(id).fm.coefficients(s, o); return o; }
function partsAt(P, s) { const o = {}; partsInto(P, s, o); return o; }

export function rows(id, P = partsModel(id)) {
  const A = typeById(id).data;
  const out = {};
  for (const [name, pt] of Object.entries(POINTS[id])) {
    const { s } = trimState(id, pt);
    const L = (st) => lumpedAt(id, st), Pp = (st) => partsAt(P, st);
    const d = (f, key, field, h) => {
      const a = { ...s, [key]: s[key] + h }, b = { ...s, [key]: s[key] - h };
      return (f(a)[field] - f(b)[field]) / (2 * h);
    };
    const r = {};
    const both = (label, fn) => { r[label] = { lumped: fn(L, 'L'), parts: fn(Pp, 'P') }; };
    both('CLa', (f) => d(f, 'alpha', 'CL', 0.5 * DEG));
    both('CL', (f) => f(s).CL);
    both('CD', (f) => f(s).CD);
    both('Cm', (f) => f(s).Cm);
    both('Cma', (f) => d(f, 'alpha', 'Cm', 0.5 * DEG));
    both('SM', (f) => -d(f, 'alpha', 'Cm', 0.5 * DEG) / d(f, 'alpha', 'CL', 0.5 * DEG));
    both('Cmq', (f) => d(f, 'qhat', 'Cm', 0.005));
    both('Cmadot', (f) => d(f, 'adothat', 'Cm', 0.005));
    both('Cmths', (f) => d(f, 'ths', 'Cm', 0.5 * DEG));
    both('CYb', (f) => d(f, 'beta', 'CY', 1 * DEG));
    both('Cnb', (f) => d(f, 'beta', 'Cn', 1 * DEG));
    both('Clb', (f) => d(f, 'beta', 'Cl', 1 * DEG));
    both('Clp', (f) => d(f, 'phat', 'Cl', 0.005));
    both('Cnr', (f) => d(f, 'rhat', 'Cn', 0.005));
    both('Cnp', (f) => d(f, 'phat', 'Cn', 0.005));
    both('Clr', (f) => d(f, 'rhat', 'Cl', 0.005));
    // the controls: the lumped model's elevator power is CmElev (the sim applies it), its ailerons' and spoilers'
    // roll is in Cl (the sim takes it out and puts it back after the law)
    r.Cmde = { lumped: L(s).CmElev, parts: d(Pp, 'elev', 'Cm', 1 * DEG) };
    both('Clda', (f) => d(f, 'ail', 'Cl', 1 * DEG));
    r.Clsp = { lumped: A.CL_ROLL.spoiler, parts: (Pp({ ...s, spR: 0.5 }).Cl - Pp({ ...s, spR: 0, spL: 0.5 }).Cl) / 1 };
    both('Cndr', (f) => d(f, 'rud', 'Cn', 1 * DEG));
    both('CYdr', (f) => d(f, 'rud', 'CY', 1 * DEG));
    // the analytic powers the sim uses for designs
    const o = Pp(s);
    r.CmdeAnalytic = { lumped: L(s).CmElev, parts: o.dCmElev };
    r.CldaAnalytic = { lumped: A.CL_ROLL.aileron, parts: o.dClAil };
    r.ClspAnalytic = { lumped: A.CL_ROLL.spoiler, parts: o.dClSp };
    // the speed brakes and the ground spoilers' lift, the maximum lift
    r.dCLsb = { lumped: A.SPEEDBRAKE_CL, parts: Pp({ ...s, sb: 1 }).CL - Pp(s).CL };
    // the lift curve's first peak (the stall), not the flat plate's lift far past it
    const sweep = (f) => { let m = -1; for (let a = 0; a < 25 * DEG; a += 0.05 * DEG) { const c = f({ ...s, alpha: a }).CL; if (c < m - 1e-4) break; m = Math.max(m, c); } return m; };
    both('CLmax', sweep);
    out[name] = { s, r };
  }
  return out;
}

// Which rows the table holds to which tolerance (a fraction of the lumped value), and which are explained instead.
export const TOL = { CLa: 0.03, CL: 0.03, CD: 0.04, Cma: 0.04, SM: 0.05, Cmq: 0.04, Cmadot: 0.10, CYb: 0.04, Cnb: 0.04, Clb: 0.06, Clp: 0.06, Cnr: 0.10, Cmde: 0.03, Clda: 0.03, Clsp: 0.05, Cndr: 0.03, CLmax: 0.04 };
