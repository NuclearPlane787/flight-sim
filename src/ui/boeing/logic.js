// What the Boeing screens decide, apart from how they draw it: the FMA's three windows, the MCP's
// lights, the IAS/MACH window, the thrust reference, the flap indicator, the estimated EGT and N2.
// No DOM: tests/boeing-ui.test.mjs runs these in node.

import { machFromIas, iasFromTas, isa, tasFromCasP, casFromTasP } from '../../sim/atmosphere.js';

const KT = 0.514444, FT = 0.3048;

// ---- the FMA ----

// The three windows and the status above the attitude. `out` is reused from draw to draw.
//   thr: the autothrottle's mode, blank with the A/T off.
//   roll, pitch: the active modes (green); armRoll, armPitch: the armed ones under them (white).
//   status: 'A/P', 'FLT DIR', or 'LAND 3' once autoland is set up.
// The sim has no flight director bars (nor has the A321's PFD), but the guidance is there, so with
// the A/P off the modes still show under FLT DIR, as they do on the aircraft with the switches on.
// On the ground they're blank until TO/GA, so a parked aircraft doesn't read "ALT".
export function fmaModes(ap, st, out = {}) {
  const lat = ap.lateral || '', ver = ap.vertical || '';
  const toga = lat === 'TO/GA' || ver === 'TO/GA';
  const show = !!ap.ap || !st.onGround || toga;
  out.thr = ap.athr ? (ap.thrustMode || '') : '';
  out.roll = show ? lat : '';
  out.pitch = show ? ver : '';
  out.armRoll = show ? (ap.armedLateral || '') : '';
  out.armPitch = show ? (ap.armedVertical || '') : '';
  const captured = (lat === 'LOC' || lat === 'ROLLOUT') && (ver === 'G/S' || ver === 'FLARE');
  // LAND 3 from 1,500 ft radio altitude on both beams: from there the flare and the rollout are
  // armed, whether or not the autopilot's module lists them.
  const land = !!ap.ap && captured && (st.onGround || st.agl / FT < 1500);
  if (land) {
    if (!out.armRoll && lat === 'LOC') out.armRoll = 'ROLLOUT';
    if (!out.armPitch && ver === 'G/S') out.armPitch = 'FLARE';
  }
  out.status = land ? 'LAND 3' : ap.ap ? 'A/P' : ap.fd === false ? '' : 'FLT DIR';
  return out;
}

// A green box round a mode for 10 s after it changes. The first value seen doesn't count as a
// change, so a loaded save or a swap of screens doesn't box everything.
export function createBoxes(ms = 10000) {
  const seen = Object.create(null), at = Object.create(null);
  return {
    track(key, value, now) {
      if (!(key in seen)) { seen[key] = value; at[key] = -Infinity; return; }
      if (seen[key] !== value) { seen[key] = value; at[key] = value ? now : -Infinity; }
    },
    boxed(key, now) { return now - at[key] < ms; },
  };
}

// ---- the MCP ----

// Each button: 2 lit (active), 1 armed, 0 dark. Armed modes are lit too on the aircraft; here they
// show in white, because with only the strip to look at the difference helps.
export function mcpLights(ap, out = {}) {
  const lat = ap.lateral || '', ver = ap.vertical || '', aL = ap.armedLateral || '', aV = ap.armedVertical || '';
  const on = !!ap.ap, mode = (active, armed) => (on && active ? 2 : armed ? 1 : 0);
  out.ap = on ? 2 : 0;
  // The A/T on with no mode yet (before TO/GA; after a manual take-off, when X engages it) is armed.
  out.at = ap.athr ? (ap.thrustMode ? 2 : 1) : 0;
  out.lnav = mode(lat === 'LNAV', aL === 'LNAV');
  out.vnav = mode(ver.startsWith('VNAV'), aV.startsWith('VNAV'));
  out.flch = mode(ver === 'FLCH SPD', false);
  out.hdgsel = mode(lat === 'HDG SEL', false);
  out.hdghold = mode(lat === 'HDG HOLD', false);
  out.vs = mode(ver === 'V/S', false);
  out.althold = mode(ver === 'ALT', false);
  // LOC alone lights LOC; APP arms or flies the glideslope as well, and lights APP instead.
  const gs = ver === 'G/S' || ver === 'FLARE' || aV === 'G/S';
  const locActive = lat === 'LOC' || lat === 'ROLLOUT', locArmed = aL === 'LOC';
  out.loc = gs ? 0 : mode(locActive, locArmed);
  out.app = gs ? (on && (ver === 'G/S' || ver === 'FLARE') ? 2 : 1) : 0;
  out.toga = mode(lat === 'TO/GA' || ver === 'TO/GA', false);
  return out;
}

// The IAS/MACH window shows Mach above FL260 (the real one changes over with the climb). The
// selected speed stays one number, in knots (ap.spdKt).
export const MACH_ABOVE_FT = 26000;
export const usesMach = (st) => !!st && st.pos.z / FT > MACH_ABOVE_FT;
// v0.4.0: `st`, the sim's state, brings the day's air when it isn't standard (st.airP is 0 when it is).
export const machOfKt = (kt, altM, st) => (st && st.airP ? tasFromCasP(kt * KT, st.airP, st.airA) / st.airA : machFromIas(kt * KT, altM));
export function ktOfMach(m, altM, st) { return st && st.airP ? casFromTasP(m * st.airA, st.airP, st.airA) / KT : iasFromTas(m * isa(altM).a, altM) / KT; }
export const machText = (m) => '.' + String(Math.min(99, Math.round(m * 100))).padStart(2, '0');
export const speedText = (kt, st) => (usesMach(st) ? machText(machOfKt(kt, st.pos.z, st)) : String(Math.round(kt)).padStart(3, '0'));

// What a typed speed means: 280 is knots at any height; 84, .84 and 0.84 are Mach.
// Returns knots, or null if it isn't a speed.
export function typedSpeedKt(text, altM) {
  if (text === '' || text === '.' || text === '-') return null;
  const v = Number(text);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v < 1) return ktOfMach(v, altM);
  if (v < 100) return ktOfMach(v / 100, altM);
  return v;
}

// ---- the PFD ----

// The selected altitude's readout gets a white box from 900 ft to 200 ft away (the altitude alert).
export function altAlert(altFt, selFt) {
  const d = Math.abs(altFt - selFt);
  return d <= 900 && d >= 200;
}

// AIRSPEED LOW: under the minimum manoeuvring speed by more than 5 kt. The margin is so an approach
// flown near the band's top, where a normal approach sits, doesn't keep flashing it.
export const speedLow = (st) => !st.onGround && st.vmm > 0 && st.ias < st.vmm - 5 * KT;

// ---- EICAS ----

// The thrust reference's label: what the levers would go to. The sim has one lever law, so this is
// the phase's rating rather than a mode the pilot picks on the TMC.
export function thrustRefMode(st, ap) {
  if (st.onGround) return 'TO';
  if (ap.lateral === 'TO/GA' || ap.vertical === 'TO/GA') return st.agl / FT < 3000 ? 'TO' : 'G/A';
  if (st.vs > 300 * FT / 60 || ap.thrustMode === 'THR REF') return 'CLB';
  if (st.flapDeg > 0.5) return 'G/A';   // flaps out, not climbing: on an approach it reads go-around thrust
  return 'CRZ';
}
// The rating's fraction of the type's thrust, from A.RATING. Cruise is taken as climb thrust's
// limit: the sim has no separate cruise rating.
export const refPhi = (mode, A) => (mode === 'TO' || mode === 'G/A' ? A.RATING.TOGA : A.RATING.CL);

// Flap indicator: where the surfaces are on the lever's scale, 0 (UP) to 1 (the last detent). The
// detents are evenly spaced on the indicator, as on the aircraft; between two it interpolates by the
// flap's angle, and by the slat's while the flaps are still at zero (UP to 1 moves only the slats).
export function flapFraction(A, st) {
  const L = A.FLAP_LEVER, C = A.CONFIGS;
  const f = st.flapDeg || 0, sl = st.slatDeg || 0;
  const n = L.length - 1;
  for (let i = n; i > 0; i--) {
    const hi = C[L[i]], lo = C[L[i - 1]];
    const useSlat = hi.flap === lo.flap;
    const v = useSlat ? sl : f, a = useSlat ? lo.slat : lo.flap, b = useSlat ? hi.slat : hi.flap;
    if (v > a || i === 1) {
      const k = b > a ? (v - a) / (b - a) : (v >= b ? 1 : 0);
      return (i - 1 + Math.max(0, Math.min(1, k))) / n;
    }
  }
  return 0;
}
export const leverFraction = (A, st) => (st.flapLever || 0) / (A.FLAP_LEVER.length - 1);
// The indicator's readout: the detent the surfaces are at, or the lever's while they travel.
export function flapLabel(A, st) {
  const lv = A.FLAP_LEVER[st.flapLever || 0];
  const moving = Math.abs(flapFraction(A, st) - leverFraction(A, st)) > 0.004;
  return { text: lv, moving };
}

// EGT, °C. [EST] The sim doesn't model turbine temperature: this is a display estimate, about 420 °C
// at idle and 900 °C at take-off N1, from the shape of published high-bypass take-off and idle
// figures, cooled by the ambient. The panel labels it EST.
export function egtEstimate(n1, ambientC = 15) {
  if (!(n1 > 5)) return ambientC;
  const x = Math.min(1.1, n1 / 100);
  return 400 + 520 * x * x * x + (ambientC - 15) * 0.7;
}
// EGT's red line, °C. [EST] The order of a GEnx-1B's or GE90-115B's take-off limit.
export const EGT_RED = 1060;

// N2, %. [EST] The sim models N1 only. A two-point line through idle (N1 21: N2 ~68) and take-off
// (N1 97: N2 ~98), the shape a high-bypass engine's spool match has above idle.
export function n2Estimate(n1) {
  if (!(n1 > 0)) return 0;
  return n1 < 21 ? n1 * 68 / 21 : 68 + (n1 - 21) * 30 / 76;
}
