// The aircraft simulation, for any type in src/sim/types.js: a 6-DOF rigid body in double precision with fixed steps, plus the
// engines, gear, flaps, spoilers, fly-by-wire and the AP/A/THR. Deterministic: the same
// snapshot and the same controls give the same states, bit for bit.
// No DOM and no three.js: it runs in the page, in node and in a module Web Worker.
//
// Frames: the map frame is ENU (x east, y north, z up, metres; src/world/frame.js). Inside,
// the dynamics use the usual flight-dynamics frames: NED for the earth and FRD (x forward,
// y right, z down) for the body. src/geometry.js's body frame is FLU (y left, z up), so its
// points are converted with y → −y, z → −z. state.pos is the body reference point (the
// origin of geometry.js), not the CG; state.cgX is the CG's body x (m, + forward).

import { isaInto, columnInto, indicatedAltitude, casFromTasP, tasFromCasP, RHO0, T0 } from './atmosphere.js';
import { compileWeather, isDefaultWeather, normalizeWeather, windAt, newWind, microburstInto } from './weather.js';
import { leverToPhi, createEngines } from './engines.js';
import { kitFor, DEFAULT_TYPE } from './types.js';
import { resolveDef, isDesign } from './designs.js';

const G = 9.80665;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const approach = (x, target, rate) => (x < target ? Math.min(target, x + rate) : Math.max(target, x - rate));

// The windshear warning: the F-factor averaged over 1 km of flight [0.103, as patents citing the FAA give it;
// TSO-C117a's own curve not seen], below 1,500 ft.
const TRANSITION_M = 14000 * 0.3048;
// v0.4.1, Indestructible: the crash points are skids. Per unit of the aircraft's mass, each one's spring (N/m
// per kg: the belly sits about 0.08 m into the ground on three of them) and damper (N·s/m per kg), and the
// friction of metal sliding on the ground.
const SKID = { k: 40, c: 4, mu: 0.4 };
// v0.4.2: past this depth a skid is a hard stop (see the integration), so a fast hit can't bury the nose in a hill;
// the bounce keeps this much of the speed into the ground.
const SKID_HARD_PEN = 0.6, SKID_RESTITUTION = 0.2;
// v0.4.2, Indestructible's skids: the type's crash points, plus three more along the belly, where the straight line
// from one crash point to the next runs above the fuselage's underside: two forward of the belly point at its own
// height (the cylinder's bottom), at a third and two thirds of the way to the nose point, and one halfway to the
// tail-strike point. Only the skids have them: without Indestructible the crash checks are as before.
function skidPoints(cp) {
  const nose = cp.find((c) => c.why === 'nose impact'), belly = cp.find((c) => c.why === 'belly impact');
  const tail = cp.find((c) => c.why === 'tail strike');
  const pts = cp.slice();
  if (nose && belly) for (const f of [1 / 3, 2 / 3]) pts.push({ x: belly.x + f * (nose.x - belly.x), y: 0, z: belly.z, why: 'belly impact' });
  if (belly && tail) pts.push({ x: (belly.x + tail.x) / 2, y: 0, z: (belly.z + tail.z) / 2, why: 'belly impact' });
  return pts;
}
const WS_F_WARN = 0.105, WS_AVG_M = 1000, WS_MAX_AGL = 1500 * 0.3048, WS_HOLD_S = 6;
// v0.4.2, the predictive windshear warning (the weather radar's): a microburst's F-factor, averaged over 1 km, of 0.13
// or more [FAA AC 25-12's hazard level for a warning] on the path ahead from 0.5 to 1.5 nm, below 1,200 ft and above
// 50 ft in the air (and on the take-off roll under 100 kt), looked for 4 times a second.
const PWS_F = 0.13, PWS_NEAR_M = 926, PWS_FAR_M = 2778, PWS_TOP_M = 1200 * 0.3048, PWS_LOW_M = 50 * 0.3048, PWS_HOLD_S = 5, PWS_DT = 0.25;

const defaultGround = () => FLAT;
const FLAT = { h: 0, kind: 'runway' };

// v0.5.0: the engines' state is a list, one entry per engine (ENGINES' order: engine 1 is the left outboard of
// a pair, as before), in the core as parallel arrays of numbers so a snapshot is plain JSON:
// eN1 (N1, %), eN1t (its target), eRev (the reverser, 0..1), eThr (thrust, N), eFf (fuel flow, kg/s).
// Saves from before v0.5.0 have n1L, n1R, … instead: restore() migrates them (migrateEngines()).
export const ENGINE_FIELDS = ['eN1', 'eN1t', 'eRev', 'eThr', 'eFf'];
const OLD_ENGINE_FIELDS = { eN1: ['n1L', 'n1R'], eN1t: ['n1tL', 'n1tR'], eRev: ['revL', 'revR'], eThr: ['thrL', 'thrR'], eFf: ['ffL', 'ffR'] };
const filled = (n, v) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = v; return a; };
function newCore(A, boeing, n) {
  return {
    t: 0,
    px: 0, py: 0, pz: 0, vn: 0, ve: 0, vd: 0,
    q0: 1, q1: 0, q2: 0, q3: 0, p: 0, q: 0, r: 0,
    payload: 15000,
    // v0.4.0: the altimeter's setting (an instrument's, so it's in the core): hPa, or standard.
    baroHpa: 1013.25, baroStd: false,
    // v0.4.0: the windshear detector's F-factor (filtered over about a kilometre) and its alert's timer.
    wsF: 0, wsPrevN: 0, wsPrevE: 0, wsValid: false, wsT: 0,
    pwsT: 0, pwsClock: 0,                     // v0.4.2: the predictive warning's timer, and when it next looks
    // v0.3.2: the load's parts as the Weight window shows them (null: not known, so the plan's), and the
    // fuel added (or taken off) since the flight began, so the logbook's fuel used stays the burn. In the
    // core, so a save, a rewind and a copy carry them.
    paxN: null, cargoKg: null, fuelAddedKg: 0,
    eN1: filled(n, A.N1_IDLE), eN1t: filled(n, A.N1_IDLE), eRev: filled(n, 0), eThr: filled(n, 0), eFf: filled(n, 0),
    // v0.5.0: the engines torn off their pylons (bit i: engine i), and the mass they took with them.
    eOff: 0,
    fuelL: 3000, fuelR: 3000, fuelC: 0,
    slat: 0, flap: 0, cfg: '0', lever1F: false, prevLever: 0,
    gearPos: 1, gearDoors: 0,
    elev: 0, ths: 0, ail: 0, rud: 0, spL: 0, spR: 0, sb: 0, gsp: 0, brkL: 0, brkR: 0, steer: 0,
    flt: 0, flare: false, flareTheta: 0, flareT: 0,
    holdLatched: false, releaseT: 0, gammaRef: 0, rollLatched: false, phiRef: 0, protAlphaLatched: false,
    thsTakeoff: 0, elevCmd: 0, uRoll: 0, rudCmd: 0, thsRate: 0,
    protAlpha: false, protSpeed: false, alphaFloorTrig: false, alphaFloorLock: false,
    athrPhi: 0, phiNow: 0, opGamma: 0, opInt: 0, capVs: 0, hdgGridTgt: 0, hdgTimer: 0,
    // v0.2.2: the A/THR moves the thrust lever (autopilot.js athrStep); the lever's N1 for the panel.
    athrDriving: false, athrLever: 0, athrOffBy: '', leverN1: A.N1_IDLE,
    airTime: 0, groundTime: 0, everAirborne: false,
    tdArmed: false, tdPending: false, tdT: 0, tdVs: 0, tdPeakG: 0, tdX: 0, tdY: 0, tdBank: 0, tdPitch: 0, tdSurf: 'runway',
    grassRun: 0,
    lastTdT: -100, bounceT: 0,
    apDiscT: 0, crashed: null,
    // v0.4.1, Indestructible: the crash points touching the ground (a bit each), and the last damage
    // reported (what would have crashed, and when), so a scrape is one event, not one a step.
    scrapes: 0, dmgReason: '', dmgT: -100,
    prevAlpha: 0, prevIas: 0, iasDot: 0, nzPrev: 1, nzF: 1, fAlong: 0, gspLatched: false,
    ...(boeing ? boeing.coreFields() : null),
  };
}

// type: a type id (src/sim/types.js), the A321neo by default. sim.setType(id) changes it (and
// resets nothing else: call reset() or restore() next).
const ENG_KITS = new WeakMap();   // v0.5.2: engine models per engine's numbers (a design's mixed engines)
export function createSim({ ground, type = DEFAULT_TYPE } = {}) {
  const groundFn = ground || defaultGround;
  // Everything the type decides, bound by bindType() below.
  let typeDef, A, kit, coefficients, liftCurve, machLift, clOfAlpha, engineStep, togaThrust, idleN1, detentName,
    leverToPhi, leverForPhi, n1ForPhi, LEVER_CL, legStep, fbwStep, apStep, athrStep, AP_FIELDS,
    GEAR, GROUND_Z, ENGINES, CRASH_POINTS, SKID_POINTS, CONFIG_BY_LEVER, NEXT_CONFIG, engKits = null;
  // v0.5.0: a type id or a design (src/sim/designs.js); a design flies its own data and geometry on its base's kit.
  const bindKit = (id) => {
    typeDef = resolveDef(id);
    A = typeDef.data; kit = kitFor(typeDef);
    ({ coefficients, liftCurve, machLift, clOfAlpha } = kit.fm);
    ({ engineStep, togaThrust, idleN1, detentName, leverToPhi, leverForPhi, n1ForPhi, LEVER_CL } = kit.eng);
    ({ legStep } = kit.gear); ({ fbwStep } = kit.fbw); ({ apStep, athrStep, AP_FIELDS } = kit.auto);
    ({ GEAR, GROUND_Z, ENGINES, CRASH_POINTS } = typeDef.geo);
    SKID_POINTS = skidPoints(CRASH_POINTS);
    // v0.5.2: a design with mixed engines (types or thrusts) has an engine model per engine, from its own numbers.
    engKits = A.ENGINE_DATA ? A.ENGINE_DATA.map((d) => { let k = ENG_KITS.get(d); if (!k) { k = createEngines({ ...A, ...d }); ENG_KITS.set(d, k); } return k; }) : null;
    CONFIG_BY_LEVER = A.FLAP_LEVER; NEXT_CONFIG = A.NEXT_CONFIG;
  };
  bindKit(type);
  const X = newCore(A, kit.boeing, ENGINES.length);
  const events = [];

  const controls = {
    pitch: 0, roll: 0, yaw: 0, thrust: 0, trim: 0,
    brakeL: 0, brakeR: 0, parkingBrake: false, gearDown: true, flapLever: 0,
    speedbrake: 0, spoilersArmed: false, law: 'normal',
  };

  // ---- the read-only state, updated in place every step ----
  const state = {
    type: typeDef.id, t: 0, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    hdg: 0, pitch: 0, roll: 0, quat: { x: 0, y: 0, z: 0, w: 1 },
    p: 0, q: 0, r: 0, alpha: 0, beta: 0,
    ias: 0, cas: 0, tas: 0, gs: 0, mach: 0, vs: 0, nz: 1, agl: 0, groundH: 0,
    // v0.4.0: the altimeter's reading (m), the outside air (°C), the wind in map axes (m/s, going towards; z up),
    // its mean part, the surface wind the tower gives (at 10 m, m/s, with the gusts' peak in kt), and the drift
    // (track less heading, rad).
    altInd: 0, baroAlert: false, sat: 15, airP: 0, airA: 0, airSigma: 0, wind: { x: 0, y: 0, z: 0, meanX: 0, meanY: 0, sfcX: 0, sfcY: 0, gustKt: 0 }, drift: 0,
    onGround: true, wow: { nose: false, left: false, right: false },
    mass: 0, fuelKg: 0, fuel: { left: 0, right: 0, center: 0 }, cgMac: 0.25, cgX: 0,
    payloadKg: 0, paxN: null, cargoKg: null, fuelAddedKg: 0,   // v0.3.2 (the core's)
    engines: [],   // one per engine (mkEngines)
    thrustLever: 0, detent: 'IDLE',
    // v0.2.2: the A/THR is moving the lever; the N1 the lever asks for, here and now (the
    // engine panel's cyan ring).
    athrActive: false, leverN1: 0,
    flapLever: 0, config: '0', slatDeg: 0, flapDeg: 0, gearPos: 1, gearDoors: 0,
    gearCompression: { nose: 0, left: 0, right: 0 }, steerAngle: 0, wheelRate: { nose: 0, main: 0 },
    surfaces: { elevator: 0, stab: 0, aileronL: 0, aileronR: 0, rudder: 0, spoilersL: [0, 0, 0, 0, 0], spoilersR: [0, 0, 0, 0, 0] },
    speedbrake: 0, groundSpoilers: 0,
    brakes: { left: 0, right: 0 }, parkingBrake: false, law: 'normal',
    vls: 0, vmax: 0, vfeNext: 0, vsw: 0, valphaProt: 0, valphaMax: 0,
    warnings: { stall: false, overspeed: false, apDisc: false, sinkRate: false, pullUp: false, tooLowGear: false, master: false, windshear: false },
    crashed: null,
    // v0.4.1: the Indestructible and auto-trim settings, whether a crash point is on the ground (a skid)
    // now, and how far the deepest one is in it (m).
    indestructible: false, autoTrim: false, scraping: false, scrapeDepth: 0,
    hydroplaning: false,   // v0.4.2: the main wheels riding on standing water
    // Extras (not in the agreed interface, handy for screens and tests):
    gamma: 0, protAlpha: false, protSpeed: false, alphaFloor: false, flare: false, fuelFlowKgS: 0, cl: 0, cd: 0,
  };

  // v0.4.0: the weather. wxS is the settings (null: the default weather), wxC what the step reads.
  let wxS = null, wxC = null;
  // v0.4.1: the player's settings the flight obeys (Settings), off by default. Indestructible: nothing ends
  // the flight; a crash is a damage event, and the crash points are skids on the ground. autoTrim: a Boeing
  // holds its flight path hands off, as the A321 does (fbw-boeing.js). A snapshot carries those that are on
  // (for the prediction, so a jump lands on the path); main.js applies its own again after a restore.
  const opts = { indestructible: false, autoTrim: false };
  let indestructible = false;
  function setOption(k, on) {
    opts[k] = !!on; state[k] = opts[k];
    if (k === 'indestructible') indestructible = opts[k];
  }
  const Wd = newWind();
  const windOn = () => wxC !== null && wxC.windOn;
  // The air here: ISA by the very same arithmetic as before unless the day isn't standard.
  function atmAt(h, out) {
    return wxC !== null && wxC.atmOn ? columnInto(h, wxC.dT, wxC.qnhPa, out) : isaInto(h, out);
  }
  // The wind at the CG into Wd: exactly zero with no wind, so that subtracting it changes nothing.
  function windHere(gh) {
    if (windOn()) windAt(wxC, X.px, X.py, X.pz, X.pz - gh, X.t, R[1], R[4], A.SPAN, Wd);
    else Wd.n = Wd.e = Wd.d = Wd.p = Wd.meanN = Wd.meanE = Wd.sn = Wd.se = Wd.sd = 0;
  }
  // The flat rating: up to ISA + 15 the engine makes the thrust it makes at ISA for that pressure, so a cold day
  // doesn't give more (the FADEC holds the rating) and a hot one gives less only past ISA + 15.
  const flatSigma = (s, T) => (wxC !== null && wxC.dT !== 0 ? s * T / (T - Math.min(wxC.dT, 15)) : s);
  const trendIas = (a) => casFromTasP(Math.sqrt((X.vn - Wd.sn) ** 2 + (X.ve - Wd.se) ** 2 + (X.vd - Wd.sd) ** 2), a.p, a.a);
  function setWeather(s) {
    if (!s || isDefaultWeather(s)) { wxS = null; wxC = null; } else { wxS = normalizeWeather(s); wxC = compileWeather(wxS); }
  }
  const baroPa = () => (X.baroStd ? 101325 : X.baroHpa * 100);
  const atm2 = { T: 0, p: 0, rho: 0, a: 0 };
  // The altimeter at height z. With the air and the baro both standard it IS z: no round trip.
  function altimeter(z) {
    const pa = baroPa();
    if ((wxC === null || !wxC.atmOn) && pa === 101325) return z;
    return indicatedAltitude(atmAt(z, atm2).p, pa);
  }

  const core = { X, state, events };
  const ap = kit.auto.createAp(core);

  // ---- scratch, allocated once ----
  const R = new Float64Array(9);
  const atm = { T: 0, p: 0, rho: 0, a: 0 };
  const F = new Float64Array(3), M = new Float64Array(3);
  const cs = { alpha: 0, beta: 0, M: 0, phat: 0, qhat: 0, rhat: 0, adothat: 0, slat: 0, flap: 0, gear: 0, doors: 0, sb: 0, gsp: 0, spL: 0, spR: 0, ail: 0, rud: 0, ths: 0, hWing: 10 };
  const co = { CL: 0, CD: 0, CY: 0, Cl: 0, Cm: 0, Cn: 0, CmElev: 0, clmax: 0, alphaMax: 0, ge: 1 };
  const lc = { clmax: 0, a: 0, cl0: 0, alphaMax: 0 };
  const E = {
    tas: 0, ias: 0, mach: 0, qbar: 0, alpha: 0, beta: 0, gamma: 0, phi: 0, theta: 0, psi: 0,
    p: 0, q: 0, r: 0, nz: 1, nAlpha: 1, vs: 0, gs: 0, aglFt: 0, onGround: false, gearDown: true,
    Ixx: 1, Iyy: 1, Izz: 1, Ixz: 0, myOther: 0, lOther: 0, elevScale: 0, rollScale: 0, rudLim: 0,
    alphaMax: 0.3, vls: 0, vsw: 0, slat: 0, flap: 0, apOn: false, apGamma: 0, apBank: 0,
    fAlong: 0, mass: 1, iasDot: 0, autoTrim: false,
  };
  // The engines' scratch (engineStep's), and the public list, one per engine of the type.
  let eng, NE = 0;
  const mkEngines = () => {
    NE = ENGINES.length;
    eng = [];
    state.engines.length = 0;
    for (let i = 0; i < NE; i++) {
      eng.push({ n1: 0, n1Target: 0, rev: 0, thrustN: 0, ffKgS: 0, fuelOk: true });
      state.engines.push({ n1: 0, n1Target: 0, ffKgS: 0, thrustN: 0, rev: 0, off: false });
    }
  };
  mkEngines();
  // Gear legs, positions relative to the CG filled each step.
  const mkLeg = (g, d, isNose) => ({
    bx: g.x, by: g.y, bz: g.z - d.staticComp, // uncompressed tyre bottom, FLU
    rx: 0, ry: 0, rz: 0, stroke: d.stroke, k: d.k, k3: d.k3, c: d.c, cExt: d.cExt, mu: d.mu, isNose,
    comp: 0, compRate: 0, wow: false, normal: 0, gh: 0, kind: 'runway', vRoll: 0,
  });
  let legs;
  const mkLegs = () => {
    legs = [
      mkLeg(GEAR.nose, A.GEAR_DATA.nose, true),
      mkLeg(GEAR.left, A.GEAR_DATA.main, false),
      mkLeg(GEAR.right, A.GEAR_DATA.main, false),
    ];
  };
  mkLegs();
  const kctx = {
    R, px: 0, py: 0, pz: 0, u: 0, v: 0, w: 0, p: 0, q: 0, r: 0, brake: 0, steer: 0, F, M, tyres: null,
    groundAt(x, y, leg) { const g = groundFn(x, y); leg.gh = g.h; leg.kind = g.kind; },
  };

  // ---- mass properties ----
  let mass = 0, cgX = 0, Ixx = 1, Iyy = 1, Izz = 1, Ixz = A.IXZ;
  function massProps() {
    const wing = X.fuelL + X.fuelR, fuel = wing + X.fuelC;
    if (A.DESIGN) { massPropsDesign(wing, fuel); return; }
    mass = A.OEW + X.payload + fuel;
    cgX = (A.OEW * A.CG_OEW_X + X.payload * A.CG_PAYLOAD_X + wing * A.CG_WING_FUEL_X + X.fuelC * A.CG_CENTER_FUEL_X) / mass;
    const zfw = A.OEW + X.payload + X.fuelC;
    Ixx = A.IXX_ZFW_PER_KG * zfw + A.IXX_WING_FUEL_R2 * wing;
    Iyy = A.IYY_PER_KG * mass;
    Izz = A.IZZ_ZFW_PER_KG * zfw + A.IZZ_WING_FUEL_R2 * wing;
  }
  // v0.5.0, a design: its OEW and CG already have its engines (designs.js); the inertias add the engines' point
  // masses beyond the per-kg terms; an engine torn off takes its installed mass away from where it hung.
  function massPropsDesign(wing, fuel) {
    let oew = A.OEW, mx = A.OEW * A.CG_OEW_X, dIxx = A.DESIGN_DIXX, dIyy = A.DESIGN_DIYY, dIzz = A.DESIGN_DIZZ;
    if (X.eOff) {
      const N = typeDef.geo.NACELLES;
      for (let i = 0; i < NE; i++) {
        if (!(X.eOff & (1 << i))) continue;
        const m = A.ENGINE_MASSES ? A.ENGINE_MASSES[i] : A.ENGINE_MASS_KG;
        const n = N[i], rx = n.x - A.CG_OEW_X;
        oew -= m; mx -= m * n.x;
        dIxx -= m * (n.y * n.y + n.z * n.z - A.IXX_ZFW_PER_KG);
        dIyy -= m * (rx * rx + n.z * n.z - A.IYY_PER_KG);
        dIzz -= m * (rx * rx + n.y * n.y - A.IZZ_ZFW_PER_KG);
      }
    }
    mass = oew + X.payload + fuel;
    cgX = (mx + X.payload * A.CG_PAYLOAD_X + wing * A.CG_WING_FUEL_X + X.fuelC * A.CG_CENTER_FUEL_X) / mass;
    const zfw = oew + X.payload + X.fuelC;
    Ixx = A.IXX_ZFW_PER_KG * zfw + A.IXX_WING_FUEL_R2 * wing + dIxx;
    Iyy = A.IYY_PER_KG * mass + dIyy;
    Izz = A.IZZ_ZFW_PER_KG * zfw + A.IZZ_WING_FUEL_R2 * wing + dIzz;
  }
  // Fuel into the tanks, at a reset and from the Weight window (v0.3.2): the wings fill first, the
  // centre tank takes the rest.
  function fillTanks(fuel) {
    const wing = Math.min(fuel, 2 * A.FUEL_WING_EACH);
    X.fuelL = X.fuelR = wing / 2; X.fuelC = fuel - wing;
  }
  // The stabiliser's take-off setting for the CG (the fly-by-wire trims to it on the ground).
  const takeoffThs = () => clamp((-0.5 + 20 * (0.25 - cgX / A.MAC - 0.28)) * A.DEG, -A.THS_DN, A.THS_UP);
  // The load's fields in the public state (updateState, setLoad).
  function massState(S) {
    S.payloadKg = X.payload; S.paxN = X.paxN ?? null; S.cargoKg = X.cargoKg ?? null; S.fuelAddedKg = X.fuelAddedKg || 0;
  }

  function computeR() {
    let { q0, q1, q2, q3 } = X;
    R[0] = 1 - 2 * (q2 * q2 + q3 * q3); R[1] = 2 * (q1 * q2 - q0 * q3); R[2] = 2 * (q1 * q3 + q0 * q2);
    R[3] = 2 * (q1 * q2 + q0 * q3); R[4] = 1 - 2 * (q1 * q1 + q3 * q3); R[5] = 2 * (q2 * q3 - q0 * q1);
    R[6] = 2 * (q1 * q3 - q0 * q2); R[7] = 2 * (q2 * q3 + q0 * q1); R[8] = 1 - 2 * (q1 * q1 + q2 * q2);
  }

  function setEuler(psi, theta, phi) {
    const cy = Math.cos(psi / 2), sy = Math.sin(psi / 2);
    const cp = Math.cos(theta / 2), sp = Math.sin(theta / 2);
    const cr = Math.cos(phi / 2), sr = Math.sin(phi / 2);
    X.q0 = cr * cp * cy + sr * sp * sy;
    X.q1 = sr * cp * cy - cr * sp * sy;
    X.q2 = cr * sp * cy + sr * cp * sy;
    X.q3 = cr * cp * sy - sr * sp * cy;
  }

  // ---- flaps and slats: lever → configuration (with the 1+F logic) → travel ----
  function updateFlaps(dt, ias, onGround) {
    const lever = controls.flapLever | 0;
    if (lever !== X.prevLever) {
      if (lever === 1) {
        X.lever1F = A.HAS_1F && (X.prevLever === 0 ? (onGround || ias < 100 * A.KT) : ias < A.AUTO_RETRACT_KT * A.KT);
      }
      X.prevLever = lever;
    }
    if (A.HAS_1F) {
      if (lever === 1 && X.lever1F && !onGround && ias > A.AUTO_RETRACT_KT * A.KT) X.lever1F = false; // auto-retract
      if (lever === 1 && onGround && ias < 60 * A.KT) X.lever1F = true;
    }
    X.cfg = lever === 1 && A.HAS_1F ? (X.lever1F ? '1+F' : '1') : CONFIG_BY_LEVER[clamp(lever, 0, CONFIG_BY_LEVER.length - 1)];
    const tgt = A.CONFIGS[X.cfg];
    X.slat = approach(X.slat, tgt.slat, A.SLAT_RATE / A.DEG * dt);
    X.flap = approach(X.flap, tgt.flap, A.FLAP_RATE / A.DEG * dt);
  }

  // ---- gear lever → doors and legs (weight-on-wheels interlock) ----
  function updateGear(dt, wowAny) {
    const want = controls.gearDown || wowAny ? 1 : 0;
    if (X.gearPos !== want) {
      if (X.gearDoors < 1) X.gearDoors = Math.min(1, X.gearDoors + dt / A.GEAR_DOOR_S);
      else X.gearPos = approach(X.gearPos, want, dt / A.GEAR_TRAVEL_S);
    } else if (X.gearDoors > 0) {
      X.gearDoors = Math.max(0, X.gearDoors - dt / A.GEAR_DOOR_S);
    }
  }

  // Wheels touching anything (from the previous step) — used by the systems' logic.
  let wowN = false, wowL = false, wowR = false;

  function step(dt) {
    if (X.crashed) return;
    massProps();
    computeR();
    atmAt(X.pz, atm);
    const sigma = atm.rho / RHO0, sqrtTheta = Math.sqrt(atm.T / T0);
    const g0 = groundFn(X.px, X.py);
    const gh = g0.h;

    // ---- air data: the velocity relative to the air (inertial less wind), in the body frame ----
    windHere(gh);
    const vnA = X.vn - Wd.n, veA = X.ve - Wd.e, vdA = X.vd - Wd.d;
    const u = R[0] * vnA + R[3] * veA + R[6] * vdA;
    const v = R[1] * vnA + R[4] * veA + R[7] * vdA;
    const w = R[2] * vnA + R[5] * veA + R[8] * vdA;
    const V = Math.sqrt(u * u + v * v + w * w);
    let alpha = V > 2 ? Math.atan2(w, u) : 0;
    let beta = V > 2 ? Math.asin(clamp(v / V, -1, 1)) : 0;
    // Standing or rolling slowly, the wind can come from anywhere: the coefficients are for flight, so keep
    // their angles in range. The drag still acts along the real wind (u, v, w).
    if (V < 40 && windOn()) {
      if (u < 0) alpha = Math.atan2(w, -u);
      alpha = clamp(alpha, -0.35, 0.35); beta = clamp(beta, -0.5, 0.5);
    }
    const mach = V / atm.a;
    const ias = casFromTasP(V, atm.p, atm.a);
    // The speed trend leaves the turbulence out: a real one is filtered, and the noise would trip the overspeed logic.
    const iasTrendBase = wxC !== null && wxC.modes ? trendIas(atm) : ias;
    const qbar = 0.5 * atm.rho * V * V;
    const gs = Math.sqrt(X.vn * X.vn + X.ve * X.ve);
    const theta = Math.asin(clamp(-R[6], -1, 1));
    const phi = Math.atan2(R[7], R[8]);
    const psi = Math.atan2(R[3], R[0]);
    const gamma = gs + Math.abs(X.vd) > 0.5 ? Math.atan2(-X.vd, gs) : 0;

    // ---- the reactive windshear detector ----
    // F = (dWx/dt)/g − Wh/V, positive when the air is taking energy away, averaged over about a kilometre of
    // flight. The turbulence is left out, as a real detector's filters leave it.
    if (windOn()) {
      const gsNow = gs > 1 ? gs : 1;
      if (!X.wsValid) { X.wsPrevN = Wd.sn; X.wsPrevE = Wd.se; X.wsValid = true; }
      // The wind's own change, along the track: a turn in a steady wind isn't a shear.
      const dTail = ((Wd.sn - X.wsPrevN) * X.vn + (Wd.se - X.wsPrevE) * X.ve) / gsNow;
      const fInst = dTail / dt / G + Wd.sd / Math.max(V, 40);
      X.wsPrevN = Wd.sn; X.wsPrevE = Wd.se;
      X.wsF += (fInst - X.wsF) * Math.min(1, dt * Math.max(V, 40) / WS_AVG_M);
      if (X.wsF > WS_F_WARN && !X.tdPending && X.everAirborne && X.airTime > 2 && X.pz - gh < WS_MAX_AGL) X.wsT = WS_HOLD_S;
      else if (X.wsT > 0) X.wsT = Math.max(0, X.wsT - dt);
    } else if (X.wsT > 0) X.wsT = Math.max(0, X.wsT - dt);

    // ---- ground below the CG ----
    const refZ = X.pz + cgX * R[6];            // ref point is cgX behind the CG along body x
    const aglEst = refZ - GROUND_Z - gh;
    const wowAny = wowN || wowL || wowR;
    const mainsWow = wowL || wowR;
    const onGround = mainsWow || (wowN && aglEst < 1);

    // v0.4.2: the predictive windshear warning, ahead along the track (pwsScan below).
    if (X.pwsT > 0) X.pwsT = Math.max(0, X.pwsT - dt);
    if (wxC !== null && wxC.bursts.length && (X.pwsClock -= dt) <= 0) {
      X.pwsClock = PWS_DT;
      const looking = onGround ? gs < 100 * A.KT && controls.thrust > 0.6 : aglEst > PWS_LOW_M && aglEst < PWS_TOP_M;
      // (On the roll it looks along the climb-out to come, about 4° up; in the air along the path flown.)
      if (looking && pwsScan(gs, onGround ? 0.07 : gamma, aglEst) >= PWS_F) X.pwsT = PWS_HOLD_S;
    }

    // ---- systems ----
    updateFlaps(dt, ias, onGround);
    updateGear(dt, wowAny);
    // v0.4.2: sliding on the skids (Indestructible) counts as the ground here, so a belly landing touches down once.
    if (onGround || (indestructible && X.scrapes !== 0)) { X.groundTime += dt; } else { X.airTime += dt; }

    // Flight / ground mode blend for the fly-by-wire.
    if (wowN && mainsWow) X.flt = Math.max(0, X.flt - dt / 1.5);
    else if (!mainsWow && !wowN) X.flt = Math.min(1, X.flt + dt / 4);

    // Environment for the AP and the FBW.
    E.tas = V; E.ias = ias; E.mach = mach; E.qbar = qbar; E.alpha = alpha; E.beta = beta;
    E.gamma = gamma; E.phi = phi; E.theta = theta; E.psi = psi; E.p = X.p; E.q = X.q; E.r = X.r;
    E.nz = X.nzPrev; E.vs = -X.vd; E.gs = gs; E.aglFt = Math.max(0, aglEst) / A.FT;
    E.onGround = onGround; E.gearDown = X.gearPos > 0.99; E.slat = X.slat; E.flap = X.flap;
    E.autoTrim = opts.autoTrim;   // v0.4.1: read by the Boeings' law only
    E.Ixx = Ixx; E.Iyy = Iyy; E.Izz = Izz; E.Ixz = Ixz; E.mass = mass; E.fAlong = X.fAlong;
    // Speeds for the protections.
    liftCurve(X.slat, X.flap, lc); machLift(lc, mach);
    E.alphaMax = lc.alphaMax;
    E.nAlpha = Math.max(0.3, qbar * A.S * lc.a / (mass * G));
    const wq = 2 * mass * G / (RHO0 * A.S);
    E.vls = A.VLS_FACTOR * Math.sqrt(wq / lc.clmax);
    E.vsw = Math.sqrt(wq / clOfAlpha(lc, lc.alphaMax - A.ALPHA_SW_MARGIN));
    E.iasDot = X.iasDot;

    // AP (before the FBW) and its disconnect conditions.
    if (ap.ap) {
      const firm = Math.abs(controls.pitch) > 0.5 || Math.abs(controls.roll) > 0.5;
      if (firm) ap.disconnectAp('stick');
      // Decision 7: an autoland always tries, so gusts that dip into the protections don't take it off.
      else if ((X.protAlpha || X.protSpeed) && !(windOn() && kit.boeing && ap.lateral === 'LOC' && (ap.vertical === 'G/S' || ap.vertical === 'FLARE'))) ap.disconnectAp('protection');
      else if (onGround && !(kit.boeing && kit.boeing.staysOnGround(ap))) ap.disconnectAp('ground');
      else if (controls.law === 'alternate' && Math.abs(phi) > 45 * A.DEG) ap.disconnectAp('attitude');
    }
    apStep(X, ap, E, state, dt);
    if (kit.boeing) kit.boeing.applyControls(X, controls);

    // Thrust demand (A/THR or manual) and the engines. While the A/THR drives the lever
    // (v0.2.2) it writes it back to the controls, so the keyboard's lever, the cockpit's levers
    // and the engine panel follow it.
    const phiFwd = athrStep(X, ap, E, Math.max(0, controls.thrust), dt);
    if (X.athrDriving) controls.thrust = X.athrLever;
    if (X.athrOffBy) { events.push({ type: 'athrDisconnect', reason: X.athrOffBy }); X.athrOffBy = ''; }
    const lever = controls.thrust;
    const revSel = lever < -0.02 && mainsWow;
    X.phiNow = phiFwd;
    const revCmd = revSel ? clamp(-lever, 0, 1) : 0;
    const fuelTotal = X.fuelL + X.fuelR + X.fuelC;
    // A flat rating: up to ISA + 15 the engine makes its thrust as if the air were at ISA for that pressure.
    const sigmaT = flatSigma(sigma, atm.T);
    for (let i = 0; i < NE; i++) {
      const e = eng[i];
      if (X.eOff & (1 << i)) { e.n1 = e.n1Target = e.thrustN = e.ffKgS = e.rev = 0; X.eN1[i] = X.eN1t[i] = X.eThr[i] = X.eFf[i] = X.eRev[i] = 0; continue; }
      e.n1 = X.eN1[i]; e.rev = X.eRev[i]; e.fuelOk = fuelTotal > 0;
      (engKits ? engKits[i].engineStep : engineStep)(e, phiFwd, revSel, revCmd, sigmaT, mach, sqrtTheta, dt);
      X.eN1[i] = e.n1; X.eRev[i] = e.rev; X.eN1t[i] = e.n1Target; X.eThr[i] = e.thrustN; X.eFf[i] = e.ffKgS;
      // v0.5.0: past its pylon's limit (a design's: 1.5 × its engine type's rated thrust) the engine tears off. It's
      // a failure, not a crash: Indestructible doesn't stop it. From this step on it makes no thrust and burns
      // nothing, and its mass is gone (massProps).
      if (A.PYLON_LIMITS_N !== undefined && Math.abs(e.thrustN) > A.PYLON_LIMITS_N[i]) {
        X.eOff |= 1 << i;
        e.thrustN = e.ffKgS = 0; X.eN1[i] = X.eN1t[i] = X.eThr[i] = X.eFf[i] = X.eRev[i] = 0;
        events.push({ type: 'engineOff', engine: i, reason: 'pylon' });
      }
    }
    // The N1 the lever asks for here and now (the panel's ring): where the needle settles.
    // (In reverse, the first engine still on its pylon's target: engine 1's for a base type.)
    let iRef = 0; while (X.eOff & (1 << iRef) && iRef < NE - 1) iRef++;
    X.leverN1 = lever >= 0 ? n1ForPhi(leverToPhi(lever), idleN1(sigmaT, mach)) : X.eN1t[iRef];

    // Spoilers: speed brakes (inhibited in FULL, α prot, TOGA/MCT), ground spoilers.
    const leverIdle = lever <= 0.02;
    if (mainsWow && ((controls.spoilersArmed && leverIdle && ias > 72 * A.KT) || revSel)) X.gspLatched = true;
    if (lever > 0.05 || (!mainsWow && !wowN)) X.gspLatched = false;
    X.gsp = approach(X.gsp, X.gspLatched ? 1 : 0, dt * (X.gspLatched ? 2.0 : 0.5));
    const sbInhibit = X.cfg === A.CONFIG_FULL || X.protAlpha || lever > 0.75 || X.alphaFloorLock;
    X.sb = approach(X.sb, sbInhibit ? 0 : clamp(controls.speedbrake, 0, 1), dt * 0.5);

    // Brakes (anti-skid in the tyre model) and nosewheel steering.
    const park = controls.parkingBrake ? 1 : 0;
    X.brkL = approach(X.brkL, Math.max(controls.brakeL, park), dt * 3);
    X.brkR = approach(X.brkR, Math.max(controls.brakeR, park), dt * 3);
    let steerCmd = 0;
    if (wowN) {
      const kt = gs / A.KT;
      const k = clamp((kt - 10) / 30, 0, 1);
      const maxA = A.STEER_TILLER * (1 - k) + A.STEER_PEDAL * k;
      const fade = clamp((130 - kt) / 30, 0, 1);
      steerCmd = controls.yaw * maxA * fade;
    }
    X.steer = approach(X.steer, steerCmd, dt * 25 * A.DEG);

    // ---- aerodynamics (elevator and roll controls handled by the FBW below) ----
    const Vn = Math.max(V, 1);
    cs.alpha = alpha; cs.beta = beta; cs.M = mach;
    cs.phat = (X.p - Wd.p) * A.SPAN / (2 * Vn); cs.qhat = X.q * A.MAC / (2 * Vn); cs.rhat = X.r * A.SPAN / (2 * Vn);
    const adot = (alpha - X.prevAlpha) / dt;
    cs.adothat = clamp(adot, -1, 1) * A.MAC / (2 * Vn);
    cs.slat = X.slat; cs.flap = X.flap; cs.gear = X.gearPos; cs.doors = X.gearDoors;
    cs.sb = X.sb; cs.gsp = X.gsp; cs.spL = X.spL; cs.spR = X.spR; cs.ail = X.ail; cs.rud = X.rud; cs.ths = X.ths;
    cs.hWing = aglEst + A.WING_HEIGHT;
    coefficients(cs, co);
    const qS = qbar * A.S;
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const iv = V > 2 ? 1 / V : 0;
    F[0] = qS * (-co.CD * u * iv + co.CL * sa);
    F[1] = qS * (-co.CD * v * iv + co.CY);
    F[2] = qS * (-co.CD * w * iv - co.CL * ca);
    // Aero moments about the reference point, moved to the CG (ref is at x = −cgX, FRD).
    const rollCtrl = A.CL_ROLL.aileron * X.ail + A.CL_ROLL.spoiler * (X.spR - X.spL);
    M[0] = qS * A.SPAN * (co.Cl - rollCtrl);
    M[1] = qS * A.MAC * co.Cm - (-cgX) * F[2];
    M[2] = qS * A.SPAN * co.Cn + (-cgX) * F[1];
    // v0.5.2, a design's parts' drag (its nacelles beyond the base's, its external tanks): each against the airflow at
    // its own place, with its moments about the CG (a lone engine far out on one side yaws the nose towards it).
    const DP = A.DRAG_PARTS;
    if (DP !== undefined && V > 2) {
      for (let i = 0; i < DP.length; i++) {
        const p = DP[i], dq = qbar * p.cda * iv;
        const fx = -dq * u, fy = -dq * v, fz = -dq * w;
        const rx = p.x - cgX, ry = -p.y, rz = -p.z;
        F[0] += fx; F[1] += fy; F[2] += fz;
        M[0] += ry * fz - rz * fy; M[1] += rz * fx - rx * fz; M[2] += rx * fy - ry * fx;
      }
    }
    const fAeroX = F[0], fAeroZ = F[2];

    // Thrust at the engines (along body x; a design's engines along their own lines, v0.5.2).
    const TD = typeDef.geo.THRUST_DIRS;
    for (let i = 0; i < NE; i++) {
      const T = eng[i].thrustN;
      const rx = ENGINES[i].x - cgX, ry = -ENGINES[i].y, rz = -ENGINES[i].z;
      if (!TD) {
        F[0] += T;
        M[1] += rz * T;
        M[2] += -ry * T;
        continue;
      }
      const dr = TD[i], fx = T * dr[0], fy = -T * dr[1], fz = -T * dr[2];
      F[0] += fx; F[1] += fy; F[2] += fz;
      M[0] += ry * fz - rz * fy; M[1] += rz * fx - rx * fz; M[2] += rx * fy - ry * fx;
    }

    // Gear (only when near the ground and the legs are down and locked).
    const wowNPrev = wowN;
    wowN = wowL = wowR = false;
    let peakComp = 0;
    if (aglEst < 15 && X.gearPos > 0.98) {
      kctx.px = X.px; kctx.py = X.py; kctx.pz = X.pz;
      // The gear rolls on the ground, not in the air: inertial velocities here.
      kctx.u = R[0] * X.vn + R[3] * X.ve + R[6] * X.vd;
      kctx.v = R[1] * X.vn + R[4] * X.ve + R[7] * X.vd;
      kctx.w = R[2] * X.vn + R[5] * X.ve + R[8] * X.vd;
      kctx.p = X.p; kctx.q = X.q; kctx.r = X.r;
      kctx.steer = X.steer;
      kctx.tyres = wxC !== null ? wxC.tyres : null;
      kctx.hydro = 0;   // v0.4.2: the most any tyre is hydroplaning (gear.js)
      for (let i = 0; i < 3; i++) {
        const L = legs[i];
        L.rx = L.bx - cgX; L.ry = -L.by; L.rz = -L.bz;
        kctx.brake = i === 1 ? X.brkL : i === 2 ? X.brkR : 0;
        legStep(L, kctx);
        if (L.compRate > peakComp && L.wow) peakComp = L.compRate;
      }
      wowN = legs[0].wow; wowL = legs[1].wow; wowR = legs[2].wow;
      state.hydroplaning = kctx.hydro > 0.5 && (wowL || wowR);
    } else {
      for (let i = 0; i < 3; i++) { legs[i].wow = false; legs[i].comp = 0; legs[i].normal = 0; legs[i].vRoll *= 0.995; }
      state.hydroplaning = false;
    }

    // v0.4.1, Indestructible: a crash point under the ground pushes back (a stiff, damped spring, with the
    // ground under it) and slides (metal on the ground), so the aircraft scrapes and bounces, and never sinks in.
    let scrapes = 0, scrapeDepth = 0;
    if (indestructible && aglEst < 15) {
      const ui = R[0] * X.vn + R[3] * X.ve + R[6] * X.vd, vi = R[1] * X.vn + R[4] * X.ve + R[7] * X.vd, wi = R[2] * X.vn + R[5] * X.ve + R[8] * X.vd;
      const kS = mass * SKID.k, cS = mass * SKID.c;
      for (let i = 0; i < SKID_POINTS.length; i++) {
        const c = SKID_POINTS[i];
        if (c.engine !== undefined && X.eOff & (1 << c.engine)) continue;   // v0.5.0: an engine that's gone
        const rx = c.x - cgX, ry = -c.y, rz = -c.z;
        const dn = R[0] * rx + R[1] * ry + R[2] * rz, de = R[3] * rx + R[4] * ry + R[5] * rz, dd = R[6] * rx + R[7] * ry + R[8] * rz;
        const pen = groundFn(X.px + de, X.py + dn).h - (X.pz - dd);
        if (pen <= 0) continue;
        scrapes |= 1 << i;
        if (pen > scrapeDepth) scrapeDepth = pen;
        // The point's velocity (inertial, body: v + ω × r), then north, east and down.
        const ub = ui + X.q * rz - X.r * ry, vb = vi + X.r * rx - X.p * rz, wb = wi + X.p * ry - X.q * rx;
        const vN = R[0] * ub + R[1] * vb + R[2] * wb, vE = R[3] * ub + R[4] * vb + R[5] * wb, vD = R[6] * ub + R[7] * vb + R[8] * wb;
        const fn = Math.max(0, kS * pen + cS * vD);
        const vh = Math.hypot(vN, vE), kf = vh > 1e-6 ? (SKID.mu * fn * Math.tanh(vh / 0.5)) / vh : 0;
        const fN = -kf * vN, fE = -kf * vE, fD = -fn;
        const fx = R[0] * fN + R[3] * fE + R[6] * fD, fy = R[1] * fN + R[4] * fE + R[7] * fD, fz = R[2] * fN + R[5] * fE + R[8] * fD;
        F[0] += fx; F[1] += fy; F[2] += fz;
        M[0] += ry * fz - rz * fy; M[1] += rz * fx - rx * fz; M[2] += rx * fy - ry * fx;
      }
    }
    state.scrapeDepth = scrapeDepth;

    // ---- fly-by-wire: invert the moments for the elevator and the roll controls ----
    E.myOther = M[1];
    // v0.4.0: the roll gust is the one moment the law can't see coming, so it isn't inverted away: the wings
    // feel it, and the roll-rate feedback catches it. Exactly M[0] with no turbulence.
    E.lOther = M[0] - qS * A.SPAN * A.CL_ROLL.p * (-Wd.p * A.SPAN / (2 * Vn));
    E.elevScale = qS * A.MAC * co.CmElev;
    E.rollScale = qS * A.SPAN * (A.CL_ROLL.aileron * A.AIL_MAX + A.CL_ROLL.spoiler);
    const iasKt = ias / A.KT;
    E.rudLim = iasKt < 160 ? A.RUD_MAX : Math.max(3.5 * A.DEG, A.RUD_MAX * (160 / iasKt) * (160 / iasKt));
    fbwStep(X, controls, E, dt);
    // Actuators.
    X.elev = approach(X.elev, X.elevCmd, A.ELEV_RATE * dt);
    X.ths = clamp(X.ths + X.thsRate * dt, -A.THS_DN, A.THS_UP);
    X.ail = approach(X.ail, X.uRoll * A.AIL_MAX, A.AIL_RATE * dt);
    X.spR = approach(X.spR, Math.max(0, X.uRoll), 3 * dt);
    X.spL = approach(X.spL, Math.max(0, -X.uRoll), 3 * dt);
    X.rud = approach(X.rud, X.rudCmd, A.RUD_RATE * dt);
    M[1] += E.elevScale * X.elev;
    M[0] += qS * A.SPAN * (A.CL_ROLL.aileron * X.ail + A.CL_ROLL.spoiler * (X.spR - X.spL));

    // ---- integrate (semi-implicit Euler) ----
    const ax = F[0] / mass, ay = F[1] / mass, az = F[2] / mass;
    const an = R[0] * ax + R[1] * ay + R[2] * az;
    const ae = R[3] * ax + R[4] * ay + R[5] * az;
    const ad = R[6] * ax + R[7] * ay + R[8] * az + G;
    X.vn += an * dt; X.ve += ae * dt; X.vd += ad * dt;
    X.px += X.ve * dt; X.py += X.vn * dt; X.pz -= X.vd * dt;

    const p = X.p, q = X.q, r = X.r;
    const Lp = M[0] - (Izz - Iyy) * q * r + Ixz * p * q;
    const Np = M[2] - (Iyy - Ixx) * p * q - Ixz * q * r;
    const det = Ixx * Izz - Ixz * Ixz;
    const pdot = (Izz * Lp + Ixz * Np) / det;
    const rdot = (Ixz * Lp + Ixx * Np) / det;
    const qdot = (M[1] - (Ixx - Izz) * p * r - Ixz * (p * p - r * r)) / Iyy;
    X.p += pdot * dt; X.q += qdot * dt; X.r += rdot * dt;
    const P = X.p, Q = X.q, Rr = X.r;
    const { q0, q1, q2, q3 } = X;
    let n0 = q0 + 0.5 * dt * (-q1 * P - q2 * Q - q3 * Rr);
    let n1 = q1 + 0.5 * dt * (q0 * P + q2 * Rr - q3 * Q);
    let n2 = q2 + 0.5 * dt * (q0 * Q - q1 * Rr + q3 * P);
    let n3 = q3 + 0.5 * dt * (q0 * Rr + q1 * Q - q2 * P);
    const nn = 1 / Math.sqrt(n0 * n0 + n1 * n1 + n2 * n2 + n3 * n3);
    X.q0 = n0 * nn; X.q1 = n1 * nn; X.q2 = n2 * nn; X.q3 = n3 * nn;

    // v0.4.2, Indestructible: a skid more than SKID_HARD_PEN into the ground is a hard stop. The aircraft goes
    // back up to that depth, and an impulse at the deepest point along the ground's normal takes away its speed
    // into the ground but SKID_RESTITUTION of it, turning the aircraft as a hit there would. The springs alone
    // let a fast hit bury the nose up to 6 m in a hill.
    let impNz = 0;
    if (indestructible && scrapeDepth > SKID_HARD_PEN) impNz = hardStop(mass, cgX, Ixx, Iyy, Izz, Ixz, dt);

    // Load factor (specific force along body −z) and the force along the path.
    const nz = -(F[2]) / (mass * G) + impNz;
    X.nzPrev = nz;
    // The load factor as an accelerometer reports it (flight-data recorders sample at about
    // 8–16 Hz): a 0.1 s first-order filter, so the touchdown g isn't one step's spike.
    X.nzF += (nz - X.nzF) * Math.min(1, dt / 0.1);
    X.fAlong = V > 2 ? (F[0] * u + F[1] * v + F[2] * w) * iv : 0;
    X.prevAlpha = alpha;
    const iasDotRaw = (iasTrendBase - X.prevIas) / dt;
    X.iasDot += (iasDotRaw - X.iasDot) * Math.min(1, dt / 0.5);
    X.prevIas = iasTrendBase;
    X.t += dt;

    // ---- fuel: centre tank first, then each engine from its own wing (one on the centreline: the left first) ----
    for (let i = 0; i < NE; i++) {
      let burn = eng[i].ffKgS * dt;
      if (X.fuelC > 0) { const b = Math.min(burn, X.fuelC); X.fuelC -= b; burn -= b; }
      if (burn > 0) {
        if (ENGINES[i].y >= 0) { const b = Math.min(burn, X.fuelL); X.fuelL -= b; burn -= b; if (burn > 0) X.fuelR = Math.max(0, X.fuelR - burn); }
        else { const b = Math.min(burn, X.fuelR); X.fuelR -= b; burn -= b; if (burn > 0) X.fuelL = Math.max(0, X.fuelL - burn); }
      }
    }

    // ---- events and crashes ----
    const nowMains = wowL || wowR, nowAny = nowMains || wowN;
    const onSkids = indestructible && scrapes !== 0 && !nowAny;   // v0.4.2
    // Touchdown: armed after 0.5 s with no wheel on the ground. A nose-first arrival that
    // is too hard breaks the nose gear; the main-gear contact makes the touchdown event.
    if (X.airTime > 0.5 && X.everAirborne) X.tdArmed = true;
    if (X.tdArmed && wowN && !wowNPrev && !nowMains && X.vd > A.GEAR_BREAK_VS * 0.7) crash('nose gear collapsed');
    if (X.tdArmed && nowMains && !mainsWow) {
      X.tdArmed = false;
      X.tdPending = true; X.tdT = 0;
      X.tdVs = -X.vd; // vertical speed at contact (negative = descending)
      X.tdPeakG = X.nzF; X.tdX = X.px; X.tdY = X.py; X.tdBank = phi; X.tdPitch = theta;
      X.tdSurf = (wowL ? legs[1] : legs[2]).kind;   // what the first main wheels landed on
      if (X.t - X.lastTdT < 8) events.push({ type: 'bounce' });
      X.lastTdT = X.t;
      if (-X.vd > A.GEAR_BREAK_VS) crash('hard landing: gear collapsed');
    }
    // v0.4.2, Indestructible: a landing on the skids (the gear up) touches down at the first skid's touch, so
    // there's a landing card (the damage it would have been is on it).
    if (X.tdArmed && onSkids) {
      X.tdArmed = false;
      X.tdPending = true; X.tdT = 0;
      X.tdVs = -X.vd;
      X.tdPeakG = X.nzF; X.tdX = X.px; X.tdY = X.py; X.tdBank = phi; X.tdPitch = theta;
      X.tdSurf = groundFn(X.px, X.py).kind;
      if (X.t - X.lastTdT < 8) events.push({ type: 'bounce' });
      X.lastTdT = X.t;
    }
    if (X.tdPending) {
      X.tdT += dt;
      if (X.nzF > X.tdPeakG) X.tdPeakG = X.nzF;
      if (X.tdT >= 0.6) {
        X.tdPending = false;
        events.push({ type: 'touchdown', vsMs: X.tdVs, g: X.tdPeakG, x: X.tdX, y: X.tdY, bank: X.tdBank, pitch: X.tdPitch, surface: X.tdSurf });
      }
    }
    if (onSkids && X.airTime > 0.5) X.airTime = 0;
    if (nowAny) {
      if (X.airTime > 0.5) X.airTime = 0;
      let grass = false;
      for (let i = 0; i < 3; i++) {
        const L = legs[i];
        if (!L.wow) continue;
        if (L.kind === 'water') crash('ditched');
        else if (L.kind !== 'runway') grass = true;
      }
      // Off the pavement, a light touchdown or a slow roll is fine (a hard one breaks the gear
      // anywhere, above), but a fast run across the grass takes the gear (v0.1.2; it used to
      // crash at the first touch of grass above 15 m/s).
      if (!grass) X.grassRun = 0;
      else if (gs > A.GRASS_SAFE_GS && (X.grassRun += gs * dt) > A.GRASS_RUN_M) crash('ran off the runway');
    } else {
      if (X.groundTime > 0 && !X.everAirborne && X.airTime > 0.5 && ias > 60 * A.KT) {
        X.everAirborne = true;
        events.push({ type: 'liftoff' });
      } else if (X.everAirborne && X.groundTime > 5 && X.airTime > 0.5 && X.airTime - dt <= 0.5) {
        events.push({ type: 'liftoff' });
      }
      if (X.airTime > 0.5) X.groundTime = 0;
    }
    if (indestructible) {
      // A skid that has just touched: what would have crashed (a tail strike is its own event too).
      const fresh = scrapes & ~X.scrapes;
      for (let i = 0; fresh && i < SKID_POINTS.length; i++) {
        if (!(fresh & (1 << i))) continue;
        if (SKID_POINTS[i].why === 'tail strike') events.push({ type: 'tailstrike' });
        crash(SKID_POINTS[i].why);
      }
      X.scrapes = scrapes;
    } else if (aglEst < 12) {
      // Fuselage, tail, engine and wingtip contact against the local ground plane.
      computeR();
      for (let i = 0; i < CRASH_POINTS.length; i++) {
        const c = CRASH_POINTS[i];
        if (c.engine !== undefined && X.eOff & (1 << c.engine)) continue;   // v0.5.0: an engine that's gone
        const rx = c.x - cgX, ry = -c.y, rz = -c.z;
        const dd = R[6] * rx + R[7] * ry + R[8] * rz;
        if (X.pz - dd < gh) {
          if (c.why === 'tail strike') events.push({ type: 'tailstrike' });
          crash(c.why);
          break;
        }
      }
    }

    if (X.apDiscT > 0) X.apDiscT -= dt;
    updateState(atm, ias, mach, alpha, beta, nz, gs, gh, aglEst);
  }

  // v0.4.2, the predictive windshear scan: the microbursts' wind (only theirs: the radar sees the outflow in the rain)
  // along the track ahead, on the path being flown, every 100 m from PWS_NEAR_M to PWS_FAR_M + 1 km; the worst F over
  // a kilometre starting in the warning zone. F = the tailwind's rise over that kilometre / (g × the time to fly it)
  // + the mean downdraft / the airspeed, as the reactive detector's.
  const pwsBurst = { n: 0, e: 0, d: 0 }, pwsTail = new Float64Array(50), pwsDown = new Float64Array(50);
  function pwsScan(gs, gamma, agl) {
    // The time to fly the kilometre at the speed it will be flown: no slower than 70 m/s (about 136 kt), so on the
    // take-off roll it's the lift-off's, not the roll's.
    const V = Math.max(gs, 70);
    const tn = gs > 5 ? X.vn / gs : R[0], te = gs > 5 ? X.ve / gs : R[3];
    const tl = Math.hypot(tn, te) || 1, un = tn / tl, ue = te / tl;
    const step = 100, n0 = Math.round(PWS_NEAR_M / step), n1 = Math.round((PWS_FAR_M + 1000) / step);
    for (let i = n0; i <= n1; i++) {
      const s = i * step, h = Math.max(15, agl + s * Math.tan(clamp(gamma, -0.1, 0.15)));
      let wn = 0, we = 0, wd = 0;
      for (const b of wxC.bursts) {
        microburstInto(X.px + ue * s - b.x, X.py + un * s - b.y, h, b.R, b.lambda, pwsBurst);
        wn += pwsBurst.n; we += pwsBurst.e; wd += pwsBurst.d;
      }
      pwsTail[i - n0] = wn * un + we * ue; pwsDown[i - n0] = wd;
    }
    const win = Math.round(1000 / step), dtWin = 1000 / V;
    let worst = -Infinity;
    for (let k = 0; k + win <= n1 - n0 && (n0 + k) * step <= PWS_FAR_M; k++) {
      let down = 0;
      for (let j = k; j <= k + win; j++) down += pwsDown[j];
      const f = (pwsTail[k + win] - pwsTail[k]) / (G * dtWin) + down / (win + 1) / V;
      if (f > worst) worst = f;
    }
    return worst;
  }

  // v0.4.2: the hard stop (see the integration). R is this step's, a 120th of a second old: close enough.
  function hardStop(mass, cgX, Ixx, Iyy, Izz, Ixz, dt) {
    let best = -1, pen = SKID_HARD_PEN, bx = 0, by = 0, bz = 0, bN = 0, bE = 0;
    for (let i = 0; i < SKID_POINTS.length; i++) {
      const c = SKID_POINTS[i];
      const rx = c.x - cgX, ry = -c.y, rz = -c.z;
      const dn = R[0] * rx + R[1] * ry + R[2] * rz, de = R[3] * rx + R[4] * ry + R[5] * rz, dd = R[6] * rx + R[7] * ry + R[8] * rz;
      const pi = groundFn(X.px + de, X.py + dn).h - (X.pz - dd);
      if (pi > pen) { pen = pi; best = i; bx = rx; by = ry; bz = rz; bN = X.py + dn; bE = X.px + de; }
    }
    if (best < 0) return 0;
    X.pz += pen - SKID_HARD_PEN;
    // The ground's normal (up) there, in north, east, down.
    const hN = (groundFn(bE, bN + 2).h - groundFn(bE, bN - 2).h) / 4, hE = (groundFn(bE + 2, bN).h - groundFn(bE - 2, bN).h) / 4;
    const il = 1 / Math.sqrt(1 + hN * hN + hE * hE);
    const nN = -hN * il, nE = -hE * il, nD = -il;
    // The point's velocity, and its part along the normal (out of the ground is positive).
    const wx = X.q * bz - X.r * by, wy = X.r * bx - X.p * bz, wz = X.p * by - X.q * bx;
    const vN = X.vn + R[0] * wx + R[1] * wy + R[2] * wz, vE = X.ve + R[3] * wx + R[4] * wy + R[5] * wz, vD = X.vd + R[6] * wx + R[7] * wy + R[8] * wz;
    const vn = vN * nN + vE * nE + vD * nD;
    if (vn >= 0) return 0;
    // The normal in body axes, r × n, the inverse inertia of that, and the effective inverse mass along n.
    const nx = R[0] * nN + R[3] * nE + R[6] * nD, ny = R[1] * nN + R[4] * nE + R[7] * nD, nzb = R[2] * nN + R[5] * nE + R[8] * nD;
    const tx = by * nzb - bz * ny, ty = bz * nx - bx * nzb, tz = bx * ny - by * nx;
    const det = Ixx * Izz - Ixz * Ixz;
    const ax = (Izz * tx + Ixz * tz) / det, ay = ty / Iyy, az = (Ixz * tx + Ixx * tz) / det;
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const k = 1 / mass + nx * cx + ny * cy + nzb * cz;
    const j = -(1 + SKID_RESTITUTION) * vn / k;
    X.vn += j * nN / mass; X.ve += j * nE / mass; X.vd += j * nD / mass;
    X.p += j * ax; X.q += j * ay; X.r += j * az;
    // What it does to the accelerometer, spread over the step (along body −z).
    // (capped at 10 g: it's one step's share of an impact, and the screens and the camera read it)
    return clamp(-(j * nzb / mass) / dt / G, -10, 10);
  }

  function crash(reason) {
    if (X.crashed) return;
    // Indestructible: a damage event instead, once for as long as it goes on (and again after 3 s of none).
    if (indestructible) {
      if (reason !== X.dmgReason || X.t - X.dmgT > 3) events.push({ type: 'damage', reason });
      X.dmgReason = reason; X.dmgT = X.t;
      return;
    }
    X.crashed = reason;
    events.push({ type: 'crash', reason });
    if (ap.ap) { ap.ap = false; }
  }

  // ---- the public state ----
  function updateState(atmo, ias, mach, alpha, beta, nz, gs, gh, aglEst) {
    const S = state;
    massProps();
    computeR();
    S.t = X.t;
    // Reference point = CG − cgX along body x.
    S.pos.x = X.px - cgX * R[3]; S.pos.y = X.py - cgX * R[0]; S.pos.z = X.pz + cgX * R[6];
    S.vel.x = X.ve; S.vel.y = X.vn; S.vel.z = -X.vd;
    S.hdg = Math.atan2(R[3], R[0]); if (S.hdg < 0) S.hdg += 2 * Math.PI;
    S.pitch = Math.asin(clamp(-R[6], -1, 1));
    S.roll = Math.atan2(R[7], R[8]);
    // Body (geometry.js FLU) → map ENU: M = T·R·S (see header).
    const m00 = R[3], m01 = -R[4], m02 = -R[5];
    const m10 = R[0], m11 = -R[1], m12 = -R[2];
    const m20 = -R[6], m21 = R[7], m22 = R[8];
    const tr = m00 + m11 + m22;
    const Qt = S.quat;
    if (tr > 0) {
      const s = Math.sqrt(tr + 1) * 2;
      Qt.w = 0.25 * s; Qt.x = (m21 - m12) / s; Qt.y = (m02 - m20) / s; Qt.z = (m10 - m01) / s;
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      Qt.w = (m21 - m12) / s; Qt.x = 0.25 * s; Qt.y = (m01 + m10) / s; Qt.z = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      Qt.w = (m02 - m20) / s; Qt.x = (m01 + m10) / s; Qt.y = 0.25 * s; Qt.z = (m12 + m21) / s;
    } else {
      const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
      Qt.w = (m10 - m01) / s; Qt.x = (m02 + m20) / s; Qt.y = (m12 + m21) / s; Qt.z = 0.25 * s;
    }
    S.p = X.p; S.q = X.q; S.r = X.r; S.alpha = alpha; S.beta = beta;
    const vnA = X.vn - Wd.n, veA = X.ve - Wd.e, vdA = X.vd - Wd.d;
    const V = Math.sqrt(vnA * vnA + veA * veA + vdA * vdA);
    S.altInd = altimeter(S.pos.z); S.sat = atmo.T - 273.15;
    // The transition reminder: a QNH (other than 1013, which reads the same) still set above the Korean transition
    // altitude, climbing or level (it stays until STD is set, as on both makers' PFDs), or STD still set descending
    // below the transition level (both 14,000 ft / FL140: eAIP ENR 1.7).
    S.baroAlert = !S.onGround && (X.baroStd ? S.altInd < TRANSITION_M && S.vs < -1 : X.baroHpa !== 1013.25 && S.altInd > TRANSITION_M);
    // The day's air for the screens' Mach conversions: 0 on a standard day, when they use ISA as they always did.
    const dayAir = wxC !== null && wxC.atmOn;
    S.airP = dayAir ? atmo.p : 0; S.airA = dayAir ? atmo.a : 0; S.airSigma = dayAir ? atmo.rho / RHO0 : 0;
    S.wind.x = Wd.e; S.wind.y = Wd.n; S.wind.z = -Wd.d; S.wind.meanX = Wd.meanE; S.wind.meanY = Wd.meanN;
    S.wind.sfcX = wxC !== null ? wxC.sfE : 0; S.wind.sfcY = wxC !== null ? wxC.sfN : 0;
    S.wind.gustKt = wxS !== null && wxS.wind.gustKt > wxS.wind.kt ? wxS.wind.gustKt : 0;
    if (windOn() && X.vn * X.vn + X.ve * X.ve > 1) {
      let dr = Math.atan2(X.ve, X.vn) - S.hdg;
      if (dr > Math.PI) dr -= 2 * Math.PI; else if (dr < -Math.PI) dr += 2 * Math.PI;
      S.drift = dr;
    } else S.drift = 0;
    S.ias = ias; S.cas = ias; S.tas = V; S.gs = Math.sqrt(X.vn * X.vn + X.ve * X.ve); S.mach = mach; S.vs = -X.vd; S.nz = nz;
    S.gamma = gs + Math.abs(X.vd) > 0.5 ? Math.atan2(-X.vd, gs) : 0;
    // AGL: the lower main-gear tyre above the ground.
    const lz = Math.min(legZ(legs[1]), legZ(legs[2]));
    S.groundH = gh;
    S.agl = Math.max(0, lz - gh);
    S.wow.nose = wowN; S.wow.left = wowL; S.wow.right = wowR;
    S.onGround = wowL || wowR || wowN;
    S.mass = mass; S.fuelKg = X.fuelL + X.fuelR + X.fuelC;
    S.fuel.left = X.fuelL; S.fuel.right = X.fuelR; S.fuel.center = X.fuelC;
    S.cgX = cgX; S.cgMac = 0.25 - cgX / A.MAC;
    massState(S);
    let ffSum = 0;
    for (let i = 0; i < NE; i++) {
      const e = S.engines[i];
      e.n1 = X.eN1[i]; e.n1Target = X.eN1t[i]; e.ffKgS = X.eFf[i]; e.thrustN = X.eThr[i]; e.rev = X.eRev[i]; e.off = (X.eOff & (1 << i)) !== 0;
      ffSum = i === 0 ? X.eFf[0] : ffSum + X.eFf[i];
    }
    S.fuelFlowKgS = ffSum;
    S.thrustLever = controls.thrust; S.detent = detentName(controls.thrust);
    S.athrActive = X.athrDriving; S.leverN1 = X.leverN1;
    S.flapLever = controls.flapLever; S.config = X.cfg; S.slatDeg = X.slat; S.flapDeg = X.flap;
    S.gearPos = X.gearPos; S.gearDoors = X.gearDoors;
    S.gearCompression.nose = legs[0].comp; S.gearCompression.left = legs[1].comp; S.gearCompression.right = legs[2].comp;
    S.steerAngle = X.steer;
    S.wheelRate.nose = legs[0].vRoll / A.WHEEL_R_NOSE;
    S.wheelRate.main = 0.5 * (legs[1].vRoll + legs[2].vRoll) / A.WHEEL_R_MAIN;
    const sf = S.surfaces;
    sf.elevator = X.elev; sf.stab = X.ths; sf.aileronL = -X.ail; sf.aileronR = X.ail; sf.rudder = X.rud;
    for (let i = 0; i < 5; i++) {
      const sbPart = i >= 1 && i <= 3 ? X.sb : 0;
      const rollL = i >= 1 ? X.spL : 0, rollR = i >= 1 ? X.spR : 0;
      sf.spoilersL[i] = Math.min(1, Math.max(X.gsp, sbPart + rollL));
      sf.spoilersR[i] = Math.min(1, Math.max(X.gsp, sbPart + rollR));
    }
    S.speedbrake = X.sb; S.groundSpoilers = X.gsp;
    S.brakes.left = X.brkL; S.brakes.right = X.brkR; S.parkingBrake = controls.parkingBrake; S.law = controls.law;

    // Speeds for the tape (IAS ≈ EAS at these speeds).
    liftCurve(X.slat, X.flap, lc); machLift(lc, mach);
    const wq = 2 * mass * G / (RHO0 * A.S);
    S.vls = A.VLS_FACTOR * Math.sqrt(wq / lc.clmax);
    S.vsw = speedAtAlpha(wq, lc.alphaMax - A.ALPHA_SW_MARGIN);
    S.valphaProt = speedAtAlpha(wq, lc.alphaMax - A.ALPHA_PROT_MARGIN);
    S.valphaMax = speedAtAlpha(wq, lc.alphaMax - 0.5 * A.DEG);
    const vmoMach = ias * A.MMO / Math.max(mach, 0.05); // IAS at MMO (approximation at this level)
    let vmax = Math.min(A.VMO_KT * A.KT, vmoMach);
    vmax = Math.min(vmax, A.VFE_KT[X.cfg] * A.KT);
    if (X.slat > 0.5 || X.flap > 0.5) vmax = Math.min(vmax, actualConfigVfe() * A.KT);
    if (X.gearPos > 0.01 || X.gearDoors > 0.01) vmax = Math.min(vmax, A.VLE_KT * A.KT, ias * A.MLE / Math.max(mach, 0.05));
    S.vmax = vmax;
    const nxt = NEXT_CONFIG[X.cfg];
    S.vfeNext = nxt ? A.VFE_KT[nxt] * A.KT : 0;

    // Warnings.
    const W = S.warnings;
    const aglFt = S.agl / A.FT, vsFpm = S.vs / A.FPM;
    W.stall = controls.law === 'alternate' && !S.onGround && alpha > lc.alphaMax - A.ALPHA_SW_MARGIN;
    W.overspeed = ias > vmax + 4 * A.KT || mach > A.MMO + 0.006;
    W.apDisc = X.apDiscT > 0;
    const air = !S.onGround && X.everAirborne;
    W.sinkRate = air && aglFt > 50 && aglFt < 2450 && vsFpm < -(998 + 1.67 * aglFt);
    W.pullUp = air && aglFt > 50 && aglFt < 2450 && vsFpm < -(1710 + 2.17 * (aglFt - 50));
    W.tooLowGear = air && aglFt < 500 && X.gearPos < 0.99 && ias < 190 * A.KT && vsFpm < 0;
    W.windshear = X.wsT > 0;
    W.windshearAhead = X.pwsT > 0 && !W.windshear;   // v0.4.2: the reactive warning comes first
    if (kit.boeing) kit.boeing.updateState(S, X, lc, atm);
    W.master = W.stall || W.overspeed || W.apDisc || W.sinkRate || W.pullUp || W.tooLowGear;
    S.crashed = X.crashed;
    S.scraping = X.scrapes !== 0;
    S.cl = co.CL; S.cd = co.CD;
    S.protAlpha = X.protAlpha; S.protSpeed = X.protSpeed; S.alphaFloor = X.alphaFloorLock; S.flare = X.flare;
  }

  // The 1 g speed (EAS ≈ IAS here) at which the wing flies at angle of attack a.
  function speedAtAlpha(wq, a) { return Math.sqrt(wq / Math.max(0.1, clOfAlpha(lc, a))); }

  function legZ(L) {
    const rx = L.bx - cgX, ry = -L.by, rz = -L.bz;
    return X.pz - (R[6] * rx + R[7] * ry + R[8] * rz);
  }

  // The VFE of the configuration the surfaces are actually in (so a retraction keeps the
  // lower limit until the flaps and slats have moved).
  function actualConfigVfe() {
    return A.VFE_KT[A.configOfSurfaces(X.slat, X.flap)];
  }

  // ---- initial conditions ----
  function reset(ic = {}) {
    Object.assign(X, newCore(A, kit.boeing, NE));
    events.length = 0;
    controls.pitch = controls.roll = controls.yaw = 0;
    controls.brakeL = controls.brakeR = 0; controls.speedbrake = 0;
    controls.flapLever = ic.flapLever ?? 0;
    controls.gearDown = ic.gearDown ?? true;
    controls.law = ic.law || controls.law || 'normal';
    X.payload = clamp(ic.payloadKg ?? 15000, 0, A.MAX_PAYLOAD);
    fillTanks(clamp(ic.fuelKg ?? 8000, 0, A.FUEL_MAX));
    X.paxN = Number.isFinite(ic.pax) ? ic.pax : null;
    X.cargoKg = Number.isFinite(ic.cargoKg) ? ic.cargoKg : null;
    X.fuelAddedKg = Number.isFinite(ic.fuelAddedKg) ? ic.fuelAddedKg : 0;
    massProps();
    const hdg = ic.hdg || 0;
    const onGround = ic.onGround ?? true;
    const g = groundFn(ic.x || 0, ic.y || 0);
    // Flaps/slats and the gear start where their levers are.
    X.prevLever = controls.flapLever | 0;
    // Lever 1 is 1+F on the ground; an airborne start is as if 1 was selected from 0 (slats
    // only, e.g. the skip-to-final start in CONF 1).
    X.lever1F = A.HAS_1F && controls.flapLever === 1 && onGround;
    X.cfg = controls.flapLever === 1 && A.HAS_1F ? (X.lever1F ? '1+F' : '1') : CONFIG_BY_LEVER[clamp(controls.flapLever | 0, 0, CONFIG_BY_LEVER.length - 1)];
    X.slat = A.CONFIGS[X.cfg].slat; X.flap = A.CONFIGS[X.cfg].flap;
    X.gearPos = controls.gearDown || onGround ? 1 : 0;
    X.thsTakeoff = takeoffThs();
    ap.ap = false; ap.athr = false; ap.thrustMode = ''; ap.vertical = 'V/S'; ap.lateral = 'HDG';

    if (onGround) {
      controls.thrust = 0;
      controls.parkingBrake = !!ic.parkingBrake;
      setEuler(hdg, 0, 0);
      computeR();
      const refZ = g.h + GROUND_Z;
      X.px = (ic.x || 0) + cgX * Math.sin(hdg); X.py = (ic.y || 0) + cgX * Math.cos(hdg); X.pz = refZ;
      X.ths = X.thsTakeoff;
      X.eN1.fill(A.N1_IDLE);
      X.flt = 0;
      // Let the struts settle (time doesn't advance).
      const savedP = controls.parkingBrake;
      controls.parkingBrake = true;
      wowN = wowL = wowR = true;
      for (let i = 0; i < 360; i++) step(1 / 120);
      controls.parkingBrake = savedP;
      X.brkL = X.brkR = savedP ? 1 : 0;
      X.t = 0; X.groundTime = 0; X.airTime = 0; X.vn = X.ve = X.vd = 0; X.p = X.q = X.r = 0;
      events.length = 0;
    } else {
      trimAirborne(ic, hdg, g);
    }
    if (ic.ap) {
      for (const k of AP_FIELDS) if (k in ic.ap && k !== 'ap') ap[k] = ic.ap[k];
      if (ic.ap.ap) { ap.ap = true; ap.lateral = 'HDG'; if (!ic.ap.vertical) ap.vertical = 'ALT'; X.hdgTimer = 0; }
      if (ap.athr) { X.athrPhi = X.phiNow; if (!ic.ap.thrustMode) ap.thrustMode = 'SPEED'; }
    }
    massProps();
    computeR();
    windHere(g.h);
    const Va = Math.hypot(X.vn - Wd.n, X.ve - Wd.e, X.vd - Wd.d);
    updateState(atmAt(X.pz, atm), casFromTasP(Va, atm.p, atm.a), Va / atm.a, X.prevAlpha, 0, 1, 0, g.h, X.pz - GROUND_Z - g.h);
    state.gs = Math.hypot(X.vn, X.ve);
    if (kit.boeing) { kit.boeing.afterReset(X, ap, state, controls, ic); updateState(atmAt(X.pz, atm), state.ias, state.mach, X.prevAlpha, 0, 1, state.gs, g.h, X.pz - GROUND_Z - g.h); }
  }

  // Steady level flight at the given IAS: α from the lift needed, the stabiliser from the
  // pitching moment, thrust from the drag.
  function trimAirborne(ic, hdg, g) {
    const zRef = ic.z ?? 3000;
    atmAt(zRef, atm);
    const ias = ic.iasMs ?? 250 * A.KT;
    const V = tasFromCasP(ias, atm.p, atm.a);
    const Mn = V / atm.a;
    const qbar = 0.5 * atm.rho * V * V;
    massProps();
    let alpha = 0.03, ths = 0;
    const s = cs;
    s.beta = 0; s.M = Mn; s.phat = s.qhat = s.rhat = s.adothat = 0;
    s.slat = X.slat; s.flap = X.flap; s.gear = X.gearPos; s.doors = 0; s.sb = 0; s.gsp = 0;
    s.spL = s.spR = 0; s.ail = 0; s.rud = 0; s.hWing = zRef - g.h;
    let thrust = 0;
    // The thrust line's height: the engines' mean (with a pair, exactly ENGINES[0].z, as before).
    let zThrust = 0;
    for (let i = 0; i < NE; i++) zThrust += ENGINES[i].z;
    zThrust /= NE;
    for (let it = 0; it < 30; it++) {
      s.alpha = alpha; s.ths = ths;
      coefficients(s, co);
      // Lift + thrust·sin α = weight; moment about the CG = 0 with the elevator at 0.
      const need = mass * G - thrust * Math.sin(alpha);
      const L = co.CL * qbar * A.S;
      liftCurve(X.slat, X.flap, lc); machLift(lc, Mn);
      alpha += (need - L) / (qbar * A.S * lc.a);
      const D = co.CD * qbar * A.S;
      thrust = D / Math.cos(alpha);
      // Pitching moment about the CG (aero at ref + thrust line below the CG).
      const myAero = qbar * A.S * A.MAC * co.Cm + cgX * (-(co.CL * Math.cos(alpha) + co.CD * Math.sin(alpha)) * qbar * A.S);
      const myThr = -zThrust * thrust;
      ths -= (myAero + myThr) / (qbar * A.S * A.MAC * A.CM.ths);
      ths = clamp(ths, -A.THS_DN, A.THS_UP);
    }
    X.ths = ths; X.elev = 0;
    // v0.4.0: `hdg` is the track asked for; the aircraft trims in the air mass, crabbed to hold it. With no wind
    // the crab is exactly 0. The crab is the mean wind's (the review of 2026-11-10: a turbulent gust at the start
    // gave a crab a few degrees off, so the heading held drifted off the centreline); the aircraft starts in the
    // whole wind, gusts and all.
    let crab = 0, wn = 0, we = 0;
    if (windOn()) {
      X.px = ic.x || 0; X.py = ic.y || 0; X.pz = zRef;
      windAt(wxC, X.px, X.py, X.pz, zRef - g.h, X.t, 0, 0, 0, Wd);
      wn = Wd.n; we = Wd.e;
      crab = Math.asin(clamp((Wd.meanN * -Math.sin(hdg) + Wd.meanE * Math.cos(hdg)) / V, -0.7, 0.7));
    }
    const psi = hdg - crab;
    setEuler(psi, alpha, 0);
    computeR();
    X.vn = V * Math.cos(psi) + wn; X.ve = V * Math.sin(psi) + we; X.vd = 0;
    X.px = (ic.x || 0) + cgX * Math.sin(psi) * Math.cos(alpha); X.py = (ic.y || 0) + cgX * Math.cos(psi) * Math.cos(alpha);
    X.pz = zRef - cgX * R[6];
    // Engines at the N1 that gives that thrust.
    const sigma = flatSigma(atm.rho / RHO0, atm.T);
    const toga = togaThrust(sigma, Mn);
    const idleT = A.T_IDLE * Math.pow(sigma, A.LAPSE_SIGMA_EXP) * Math.max(0, 1 - 1.2 * Mn);
    const per = thrust / NE;
    const fr = Math.sqrt(clamp((per - idleT) / (toga - idleT), 0, 1));
    const n1i = idleN1(sigma, Mn);
    const n1Trim = n1i + (A.N1_TOGA - n1i) * fr;
    const ffTrim = Math.max(A.FF_IDLE * (0.55 + 0.45 * sigma), (A.TSFC_C0 + A.TSFC_C1 * Mn) * Math.sqrt(atm.T / T0) * per);
    X.eN1.fill(n1Trim); X.eN1t.fill(n1Trim); X.eThr.fill(per); X.eFf.fill(ffTrim);
    const phi = fr * fr;
    X.phiNow = phi; X.athrPhi = phi;
    // Lever: at the trim thrust. With A/THR on it's the A/THR's from the first step (v0.2.2: it
    // moves the lever), so it starts at CL or below, where the A/THR drives it rather than arms.
    const lv = leverForPhi(phi);
    controls.thrust = ic.ap && ic.ap.athr ? Math.min(lv, LEVER_CL) : lv;
    X.leverN1 = n1ForPhi(leverToPhi(controls.thrust), n1i);
    controls.parkingBrake = false;
    X.flt = 1; X.everAirborne = true; X.airTime = 100; X.groundTime = 0;
    X.holdLatched = true; X.gammaRef = 0; X.rollLatched = true; X.phiRef = 0;
    X.prevAlpha = alpha; X.prevIas = wxC !== null && wxC.modes ? trendIas(atm) : ias; X.nzPrev = 1;
    X.fAlong = 0;
    wowN = wowL = wowR = false;
  }

  // ---- snapshots ----
  function snapshot() {
    const apSnap = {};
    for (const k of AP_FIELDS) apSnap[k] = ap[k];
    const snap = { v: 1, type: typeDef.id, core: { ...X }, controls: { ...controls }, ap: apSnap, wow: [wowN, wowL, wowR] };
    for (const k of ENGINE_FIELDS) snap.core[k] = X[k].slice();
    if (typeDef.design) snap.design = typeDef.design;   // v0.5.0: the design itself, whole (designs.js)
    if (wxS) snap.weather = wxS;   // the default weather writes nothing: absent means calm
    for (const k in opts) if (opts[k]) (snap.options ??= {})[k] = true;   // only those on: absent means off
    return snap;
  }
  // Changes the aircraft type. The sim's objects stay the same; the core goes back to a fresh
  // one, so call reset() or restore() next.
  // v0.5.0: id may be a design (src/sim/designs.js).
  function setType(id) {
    const def = resolveDef(id);
    if (def === typeDef) return;
    bindKit(def.design || def.id);
    for (const k of Object.keys(X)) delete X[k];
    mkEngines();
    Object.assign(X, newCore(A, kit.boeing, NE));
    Ixz = A.IXZ;
    mkLegs();
    for (const k of Object.keys(ap)) delete ap[k];
    kit.auto.createAp(core, ap);
    state.type = def.id;
  }
  // keepWeather: the weather set now stays (a rewind or a jump: it's the world's, not the aircraft's).
  function restore(snap, { keepWeather = false } = {}) {
    if (!keepWeather) setWeather(snap.weather || null);
    for (const k in opts) setOption(k, !!snap.options?.[k]);
    // A save from before v0.3.0 has no type: it's the A321neo.
    // v0.5.0: a save with a design flies that design (saved whole, so deleting or editing it later changes nothing).
    setType(isDesign(snap.design) ? snap.design : snap.type || DEFAULT_TYPE);
    // A save from before v0.2.2 has no A/THR lever fields: it starts not driving. One from before
    // v0.3.2 has no load fields: the plan's load, and no fuel added.
    Object.assign(X, { athrDriving: false, athrLever: 0, athrOffBy: '', leverN1: A.N1_IDLE, paxN: null, cargoKg: null, fuelAddedKg: 0, baroHpa: 1013.25, baroStd: false, wsF: 0, wsPrevN: 0, wsPrevE: 0, wsValid: false, wsT: 0,
      scrapes: 0, dmgReason: '', dmgT: -100, pwsT: 0, pwsClock: 0, eOff: 0,
      ...(kit.boeing ? { boAlign: false, boAlignYaw: 0, boCrab0: 0, boRolloutRoll: 0, boRollHeld: false, boAlignI: 0, boAlignBI: 0 } : null) }, snap.core);
    migrateEngines(snap.core);
    Object.assign(controls, snap.controls);
    for (const k of AP_FIELDS) ap[k] = snap.ap[k];
    [wowN, wowL, wowR] = snap.wow;
    events.length = 0;
    massProps(); computeR();
    atmAt(X.pz, atm);
    const g = groundFn(X.px, X.py);
    windHere(g.h);
    const V = Math.hypot(X.vn - Wd.n, X.ve - Wd.e, X.vd - Wd.d);
    updateState(atm, casFromTasP(V, atm.p, atm.a), V / atm.a, X.prevAlpha, 0, X.nzPrev, Math.hypot(X.vn, X.ve), g.h, X.pz - GROUND_Z - g.h);
    // A rewind into air that has changed since the snapshot: the change isn't an acceleration or a shear. (In the
    // same air nothing is touched, so a restored flight still flies on exactly.)
    if (keepWeather && JSON.stringify(snap.weather || null) !== JSON.stringify(wxS)) {
      X.wsValid = false;
      X.prevIas = wxC !== null && wxC.modes ? trendIas(atm) : casFromTasP(V, atm.p, atm.a);
    }
  }

  // v0.5.0: the engines' arrays, the core's own copies (never the snapshot's), from a save of any version. One
  // from before v0.5.0 has the two engines by name (n1L, n1R, …): they become the list, and the names go.
  function migrateEngines(c) {
    for (const k of ENGINE_FIELDS) {
      const old = OLD_ENGINE_FIELDS[k];
      let a = Array.isArray(c[k]) ? c[k] : old.every((o) => o in c) ? old.map((o) => c[o]) : null;
      if (!a || a.length !== NE) {
        const fresh = newCore(A, null, NE)[k];
        if (a) for (let i = 0; i < NE; i++) fresh[i] = a[Math.min(i, a.length - 1)];
        a = fresh;
      }
      X[k] = a.slice();
    }
    for (const k in OLD_ENGINE_FIELDS) for (const o of OLD_ENGINE_FIELDS[k]) delete X[o];
  }

  // v0.3.2: change the load, in flight or on the ground (the Weight window). payloadKg and fuelKg
  // within the type's limits, the fuel put in as at a reset (a fuel the same to 0.5 kg leaves the
  // tanks alone); pax and cargoKg are kept for the window (undefined: unchanged). The airframe stays
  // where it is, and so do the speeds and the attitude: the CG moves inside it. Fuel put in or taken
  // off adds to fuelAddedKg. No events. → false if crashed.
  function setLoad({ payloadKg, fuelKg, pax, cargoKg } = {}) {
    if (X.crashed) return false;
    massProps(); computeR();
    const cg0 = cgX, fuel0 = X.fuelL + X.fuelR + X.fuelC;
    if (Number.isFinite(payloadKg)) X.payload = clamp(payloadKg, 0, A.MAX_PAYLOAD);
    if (Number.isFinite(fuelKg) && Math.abs(fuelKg - fuel0) >= 0.5) {
      const fuel = clamp(fuelKg, 0, A.FUEL_MAX);
      fillTanks(fuel);
      X.fuelAddedKg = (X.fuelAddedKg || 0) + fuel - fuel0;
    }
    if (pax !== undefined) X.paxN = Number.isFinite(pax) ? pax : null;
    if (cargoKg !== undefined) X.cargoKg = Number.isFinite(cargoKg) ? cargoKg : null;
    massProps();
    // The reference point (the airframe) stays put: the CG moves by the change, along the body's x.
    const d = cgX - cg0;
    X.px += d * R[3]; X.py += d * R[0]; X.pz -= d * R[6];
    X.thsTakeoff = takeoffThs();
    const S = state;
    S.mass = mass; S.fuelKg = X.fuelL + X.fuelR + X.fuelC;
    S.fuel.left = X.fuelL; S.fuel.right = X.fuelR; S.fuel.center = X.fuelC;
    S.cgX = cgX; S.cgMac = 0.25 - cgX / A.MAC;
    massState(S);
    return true;
  }

  // Move the aircraft on the ground (pushback drives it): the reference point to (x, y),
  // grid heading hdg (rad), rolling at `speed` m/s along the heading (negative =
  // backwards). Fuel, controls, gear, struts and time are kept; pitch and roll stay as
  // they are, and the height follows the ground. Fires no events.
  function setGroundPose(x, y, hdg, speed = 0) {
    massProps(); computeR();
    const theta = Math.asin(clamp(-R[6], -1, 1)), phi = Math.atan2(R[7], R[8]);
    const h0 = groundFn(X.px, X.py).h;           // read .h now: ground() may reuse its object
    X.px = x + cgX * Math.sin(hdg); X.py = y + cgX * Math.cos(hdg);
    X.pz += groundFn(X.px, X.py).h - h0;
    setEuler(hdg, theta, phi);
    X.vn = speed * Math.cos(hdg); X.ve = speed * Math.sin(hdg); X.vd = 0;
    X.p = X.q = X.r = 0;
    computeR();
    atmAt(X.pz, atm);
    const g = groundFn(X.px, X.py);
    windHere(g.h);
    const V = windOn() ? Math.hypot(X.vn - Wd.n, X.ve - Wd.e, X.vd - Wd.d) : Math.abs(speed);
    updateState(atm, casFromTasP(V, atm.p, atm.a), V / atm.a, 0, 0, 1, V, g.h, X.pz - GROUND_Z - g.h);
  }

  // v0.4.0: the altimeter's setting. setBaro(hPa) takes it off STD; setBaroStd(on); setLocalQnh() is the K key.
  function setBaro(hpa) { X.baroHpa = clamp(hpa, 900, 1100); X.baroStd = false; state.altInd = altimeter(state.pos.z); }
  function setBaroStd(on = true) { X.baroStd = !!on; state.altInd = altimeter(state.pos.z); }
  function setLocalQnh() { setBaro(wxS ? wxS.qnh : 1013.25); }
  // In flight it applies at once: the aircraft doesn't move, it's flying in the new air.
  function applyWeather(s) {
    if (wxS === null && (!s || isDefaultWeather(s))) return;   // calm to calm: nothing at all happens
    setWeather(s);
    X.wsValid = false;
    massProps(); computeR();
    const g = groundFn(X.px, X.py);
    atmAt(X.pz, atm); windHere(g.h);
    const V = Math.hypot(X.vn - Wd.n, X.ve - Wd.e, X.vd - Wd.d);
    const ias = casFromTasP(V, atm.p, atm.a);
    // The new air isn't an acceleration: without this the speed-trend logic reads the change as one and trips the protections.
    X.prevIas = wxC !== null && wxC.modes ? trendIas(atm) : ias;
    updateState(atm, ias, V / atm.a, X.prevAlpha, state.beta, X.nzPrev, Math.hypot(X.vn, X.ve), g.h, X.pz - GROUND_Z - g.h);
  }

  return { controls, ap, state, events, step, reset, snapshot, restore, setGroundPose, setType, setLoad,
    setIndestructible: (on) => setOption('indestructible', on), setAutoTrim: (on) => setOption('autoTrim', on),
    setWeather: applyWeather, setBaro, setBaroStd, setLocalQnh, get weather() { return wxS; }, get baro() { return { hpa: X.baroHpa, std: X.baroStd }; },
    get type() { return typeDef; }, get design() { return typeDef.design || null; },
    get massProps() { massProps(); return { mass, cgX, Ixx, Iyy, Izz, Ixz }; },   // v0.5.0: for the tests
    get leverClimb() { return LEVER_CL; }, _core: X };
}

export { leverToPhi };
