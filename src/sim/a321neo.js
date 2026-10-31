// The A321neo (A321-251NX, CFM LEAP-1A engines): every number the sim uses, with its source.
//
// Sources:
//   [TCDS] EASA Type Certificate Data Sheet EASA.A.064, Issue 62 (26 June 2026), Section 2
//          (A321 series). Page numbers are the PDF's (reference/docs/easa-tcds-a064.pdf).
//   [AC]   Airbus, A321 Aircraft Characteristics - Airport and Maintenance Planning,
//          Jun 01/24 (reference/docs/airbus-ac-a321.pdf). Page numbers are the PDF's.
//   [AB]   Airbus's A321neo product page (dimensions), as copied into PLAN.md.
//   [EST]  An estimate: the reasoning is given next to the number.
//
// Units: SI unless the name says otherwise (KT = knots, FT = feet, DEG = degrees).

export const KT = 0.514444;  // m/s per knot
export const FT = 0.3048;    // m per foot
export const FPM = FT / 60;  // m/s per ft/min
export const DEG = Math.PI / 180;
export const LB = 0.45359237;

// ---- Speeds and limits ----------------------------------------------------------------
export const VMO_KT = 350;                // [TCDS] p.99, §10 "Maximum Operating Speed (VMO): 350 kt"
export const MMO = 0.82;                  // [TCDS] p.99, §10
// VFE per configuration, A321-251NX row of the table [TCDS] p.99–100:
//   1 (18/0) 243 kt (the NX value, footnote *), 1+F (18/10) 225 kt, 2 (22/14) 215 kt,
//   3 (22/21) 195 kt, FULL (27/34) 186 kt.
export const VFE_KT = { '0': VMO_KT, '1': 243, '1+F': 225, '2': 215, '3': 195, 'FULL': 186 };
export const VLE_KT = 280, MLE = 0.67;    // [TCDS] p.100 "VLE - Extended: 280 kt/Mach 0.67"
export const VLO_EXT_KT = 250;            // [TCDS] p.100 "VLO - Extension: 250 kt"
export const VLO_RET_KT = 220;            // [TCDS] p.100 "Retraction: 220 kt"
export const TYRE_LIMIT_KT = 195.5;       // [TCDS] p.100, ground speed
export const MAX_ALT_FT = 39100;          // [TCDS] p.101 §11 "39 100 ft (pressure altitude)"
// Final approach speed 136 kt at MLW 79 200 kg, CONF FULL, ISA [AC] p.197 §3-5-0 2.B.
export const VAPP_MLW_KT = 136;

// ---- Weights --------------------------------------------------------------------------
export const MTOW = 97000;   // [TCDS] p.102 §13, A321-251NX column (WV072 [AC] p.42 agrees)
export const MLW = 79200;    // [TCDS] p.102 §13
export const MZFW = 75600;   // [TCDS] p.102 §13
export const MIN_WEIGHT = 46600; // [TCDS] p.102 §13, CFM
// Operating empty weight: not in the documents. [EST] 50 500 kg, typical OEW for a two-class
// A321neo (≈ 50.1 t per reference/notes) (the TCDS minimum flying weight is 46 600 kg, p.102).
export const OEW = 50500;
export const MAX_PAYLOAD = MZFW - OEW;

// ---- Fuel: standard 3-tank aircraft ----------------------------------------------------
// [TCDS] p.98, A321-251NX table: WING 15 380 L (12 073 kg), CENTRE 8 200 L (6 437 kg),
// total usable 23 580 L (18 510 kg); density 0.785 kg/L as in the table's kg values.
export const FUEL_WING_EACH = 12073 / 2; // kg per wing (left/right)
export const FUEL_CENTER = 6437;         // kg
export const FUEL_MAX = 12073 + 6437;    // 18 510 kg
export const FUEL_DENSITY = 0.785;       // kg/L ([AC] p.43 uses 0.785 too)

// ---- Geometry -------------------------------------------------------------------------
export const SPAN = 35.80;     // [AB]
// Wing reference area: not given in either document. [EST] 122.6 m², Airbus's published
// figure for the A320-family wing (A321 incl.), used in most A320 performance models.
export const S = 122.6;
// Mean aerodynamic chord 4.1935 m [TCDS] p.103. The body reference point is at 25% MAC
// (src/geometry.js).
export const MAC = 4.1935;
export const AR = SPAN * SPAN / S;     // 10.45

// ---- Engines: 2 × CFM LEAP-1A ------------------------------------------------------------
// [TCDS] p.101–102 lists LEAP-1A32/-1A33/-1A35A/-1A30 for the A321-251NX and refers to the
// engine TCDS for ratings: EASA TCDS E.110 Issue 14 p.9, take-off thrust 14 305 daN
// = 143.05 kN sea level static, the same for -1A32/-1A33/-1A35A (they differ only in
// flat rating); the ICAO Engine Emissions Databank (UID 08P28CM151) gives the same rated
// thrust. (From reference/notes/a321neo-performance.md.)
export const T0_ENGINE = 143050;  // N
// Thrust lapse with Mach and density. [EST] T/T0 = σ^0.75 · (1 − M + 0.5 M²), a fit for
// bypass-ratio-11 turbofans (Mattingly-style), tuned so the initial climb at 250 kt and the
// FL350 cruise come out right (see tests/sim-performance.test.mjs).
export const LAPSE_SIGMA_EXP = 0.75;
export const LAPSE_M1 = -1.0, LAPSE_M2 = 0.5;
// Ratings as a fraction of the TOGA thrust available [EST]: CL is the usual climb derate,
// FLX/MCT is MCT.
export const RATING = { IDLE: 0, CL: 0.84, MCT: 0.95, TOGA: 1.0 };
// Idle thrust per engine at sea level static [EST] 4.0 kN (about 2.7% of take-off thrust,
// the usual turbofan figure); lapses like the rest.
export const T_IDLE = 4000;
// Reverse: [EST] maximum reverse 30% of take-off thrust, deploy 2.0 s, stow 2.0 s.
export const REV_FRACTION = 0.30;
export const REV_DEPLOY_S = 2.0;
// N1 (display): [EST] ground idle 20%, flight idle rises to ~30% with altitude, TOGA ~ 95–98%.
export const N1_IDLE = 20.5, N1_TOGA = 96.5;
// Spool: [EST] first-order lag with a time constant that grows at low N1, so idle to TOGA
// takes about 6 s (CS 25.119 go-around: within 8 s of flight idle) and back about 5 s.
export const SPOOL_TAU_HIGH = 0.9, SPOOL_TAU_LOW = 2.6;
// Fuel flow: TSFC = (C0 + C1·M)·√θ. C0 from the ICAO Engine Emissions Databank (LEAP-1A
// family, UID 08P28CM151): 1.067 / 0.873 / 0.286 kg/s at 100 / 85 / 30 % of 143.05 kN
// → 7.5 / 7.2 / 6.7 g/(kN·s) at sea level static. C1 [EST] so that cruise at M0.78 FL350
// comes to ≈ 0.52 lb/(lbf·h) (LEAP-1A published cruise TSFC ≈ 0.51). The idle floor is the
// ICAO 7% point, 0.094 kg/s per engine (scaled down with density aloft).
export const TSFC_C0 = 0.75e-5;  // kg/(N·s)
export const TSFC_C1 = 1.20e-5;  // kg/(N·s) per Mach
export const FF_IDLE = 0.094;    // kg/s per engine

// ---- Flaps and slats ------------------------------------------------------------------
// Slat/flap angles per configuration [TCDS] p.99–100 (A321-251NX table).
export const CONFIGS = {
  '0':    { slat: 0,  flap: 0 },
  '1':    { slat: 18, flap: 0 },
  '1+F':  { slat: 18, flap: 10 },
  '2':    { slat: 22, flap: 14 },
  '3':    { slat: 22, flap: 21 },
  'FULL': { slat: 27, flap: 34 },
};
// Travel rates [EST]: slats 0→27° in ~30 s, flaps 0→34° in ~35 s (A320-family figures).
export const SLAT_RATE = 0.9 * DEG, FLAP_RATE = 1.0 * DEG; // rad/s, as deg/s × DEG
// 1+F automatically retracts to 1 at 210 kt (A320-family flap auto-retraction) [EST].
export const AUTO_RETRACT_KT = 210;

// ---- Aerodynamics [EST] -----------------------------------------------------------------
// Max lift per configuration, chosen so the 1 g stall speeds come out as below.
// Anchor: VLS = 1.23 VS1g, and Vapp = VLS + 5 kt = 136 kt at MLW in CONF FULL [AC] p.197
//   → VS1g(FULL, 79.2 t) = 131/1.23 = 106.5 kt CAS → CLmax(FULL) = 3.45.
// The others: CLmax clean 1.50, 1 2.02, 1+F 2.45, 2 2.60, 3 2.80 (reference/notes/
// a321neo-performance.md §3, calibrated there against forum V2 ≈ 1.18 VS1g and the
// 1+F VR ≈ 146 kt at 80 t), giving VS1g at 79.2 t:
//   clean 161.5 kt, 1 139 kt, 1+F 126.5 kt, 2 123 kt, 3 118.5 kt, FULL 106.5 kt.
// CLmax is a function of slat and flap angle so it is continuous while they travel.
export const CLMAX_CLEAN = 1.50;
export const SLAT_CLMAX = [[0, 0], [18, 0.52], [22, 0.62], [27, 0.67]];       // ΔCLmax vs slat°
export const FLAP_CLMAX = [[0, 0], [10, 0.43], [14, 0.48], [21, 0.68], [34, 1.28]]; // vs flap°
// The angle of attack at CLmax (fuselage datum): slats raise it, flaps lower it.
// Clean 14°, CONF 1+F 17.3°, CONF 3 17.6°, FULL 17.3°: a little above the A320's α-floor
// angles (9.5° clean, 15° CONF 1–2, 14° CONF 3, 13° FULL; FlyByWire docs) so that α floor
// sits between α prot and α max. Clean is higher than Airbus's because the lift curve here
// must reach CLmax 1.5 from a sensible cruise α.
export const ALPHA_MAX_CLEAN = 14.0 * DEG;
export const SLAT_ALPHA = 3.5 * DEG / 18;  // per slat degree (up to 18°), +0.5° more by 27°
export const FLAP_ALPHA = -0.0206 * DEG;    // per flap degree
// Lift-curve slope (per rad): 5.2 clean (AR 10.5, 25° sweep, with the body), rising with
// Fowler extension (the flap adds chord, so the slope on the clean wing area rises) to 8.0
// in FULL. With CLmax fixed by the stall speeds, that puts the approach α at Vapp
// (= 1.28 VS1g, CL ≈ 2.1) at ~6°, i.e. pitch ≈ +3° on a 3° path, as flown on the A321neo
// (lead's request; typical +2.5 to +4°). Prandtl–Glauert with sweep for Mach.
export const CLA_CLEAN = 5.2, CLA_FULL = 8.0;
export const KNEE = 3.5 * DEG;            // lift curve rounds over the last ~3.5° before CLmax
export const SWEEP = 25 * DEG;
// Drag polar: CD = CD0 + K·CL² + flap/slat/gear/spoiler increments + wave drag.
// CD0 0.021 and Oswald e 0.80 give L/D ≈ 17.5 at the FL350 cruise point.
export const CD0 = 0.021;
export const OSWALD = 0.80;
export const OSWALD_FLAPS = 0.72;         // with flaps out
export const FLAP_CD = [[0, 0], [10, 0.010], [14, 0.016], [21, 0.028], [34, 0.062]];
export const SLAT_CD_PER_DEG = 0.0002;
export const GEAR_CD = 0.020, GEAR_DOOR_CD = 0.004;
export const SPEEDBRAKE_CD = 0.035, GROUND_SPOILER_CD = 0.07;
export const SPEEDBRAKE_CL = -0.10, GROUND_SPOILER_CL = -0.75;
// Wave drag: 20·(M − Mcrit)^4 with Mcrit = 0.745 − 0.1·(CL − 0.5): Mdd ≈ 0.80 at cruise CL.
export const MCRIT0 = 0.745, WAVE_K = 20;
// Buffet: CLmax falls above M0.35 by 0.8 per Mach (≈ 1.8 g buffet margin at M0.78 FL350).
export const CLMAX_MACH_SLOPE = 0.8;

// Moments (body axes, coefficients on q·S·c for pitch and q·S·b for roll/yaw), per rad.
export const CM = {
  alpha: -1.30,   // static stability about 25% MAC, tail on
  q: -28,         // pitch damping, per (q·c/2V)
  alphaDot: -8,
  elevator: 1.45, // per rad of nose-up elevator (elevator trailing edge up)
  ths: 3.4,       // per rad of nose-up stabiliser
  flap: -0.0020,  // per flap degree (nose-down flap moment, trimmed out by the THS)
  spoiler: 0.02,
  ground: -0.04,  // extra nose-down in ground effect
  gear: 0.004,
};
// Signs: aileron + rolls right, rudder + yaws right, β + is wind from the right.
// Roll spoiler: per unit (full roll deflection) on one wing.
export const CY = { beta: -0.95, rudder: -0.25 };
export const CL_ROLL = { beta: -0.10, p: -0.48, r: 0.14, aileron: 0.075, spoiler: 0.085, rudder: -0.012 };
export const CN = { beta: 0.13, p: -0.035, r: -0.22, aileron: -0.004, rudder: 0.115 };

// Control surface limits and rates [EST] (A320-family values).
export const ELEV_UP = 30 * DEG, ELEV_DN = 17 * DEG, ELEV_RATE = 30 * DEG;
export const THS_UP = 13.5 * DEG, THS_DN = 4 * DEG, THS_RATE = 0.7 * DEG; // nose up + ; ±0.7°/s auto
export const AIL_MAX = 25 * DEG, AIL_RATE = 40 * DEG;
export const RUD_MAX = 30 * DEG, RUD_RATE = 40 * DEG; // limited with speed (below)
export const SPOILER_MAX = 50 * DEG;
export const SPOILER_RATE = 1.2;          // fraction per second (roll spoilers faster: 3.0)

// ---- Mass properties [EST] ----------------------------------------------------------------
// CG positions along body x (m, + forward of the 25% MAC reference point).
// cgMac = 25% − x/MAC. These give 27–31% MAC for normal loads (the A321 range is ~15–40%).
export const CG_OEW_X = -0.17;     // OEW at ~29% MAC
export const CG_PAYLOAD_X = 0.05;  // cabin and holds, near the reference
export const CG_WING_FUEL_X = -0.30; // swept wing tanks sit aft of 25% MAC
export const CG_CENTER_FUEL_X = 1.0; // centre tank, ahead of the main spar
// Inertia (kg·m²), body axes: Roskam radii of gyration (R̄x 0.25, R̄y 0.38, R̄z 0.46) give
// Ixx 1.6e6, Iyy 5.7e6, Izz 6.8e6 at 80 t (reference/notes/a321neo-performance.md §6).
// Split here so wing fuel (at ~5.5 m from the centreline) adds to Ixx and Izz only:
// at 80 t with 10 t of wing fuel these come to the same values.
export const IXX_ZFW_PER_KG = (1.6e6 - 10000 * 30) / 70000, IXX_WING_FUEL_R2 = 30;
export const IYY_PER_KG = 5.7e6 / 80000;
export const IZZ_ZFW_PER_KG = (6.8e6 - 10000 * 32) / 70000, IZZ_WING_FUEL_R2 = 32;
export const IXZ = 0.12e6;

// ---- Landing gear [EST] ----------------------------------------------------------------
// Struts as nonlinear spring-dampers. Static compression puts the fuselage centreline
// GROUND_Z = 3.9 m above the runway (src/geometry.js).
export const GEAR_DATA = {
// k·c + k3·c³ carries ~7% (nose) and ~46.5% (each main) of 80 t at the static compression.
// Damping is asymmetric, as in an oleo: soft in compression (a firm touchdown at ~300 ft/min
// gives ~1.3–1.5 g) and strong in extension (no rebound bounce).
  nose: { stroke: 0.40, staticComp: 0.16, k: 2.0e5, k3: 5.6e6, c: 3.0e4, cExt: 1.4e5, mu: 0.75 },
  main: { stroke: 0.47, staticComp: 0.22, k: 8.0e5, k3: 1.77e7, c: 0.9e5, cExt: 4.5e5, mu: 0.80 },
};
export const ROLL_RESIST = 0.013;
export const BRAKE_MU = 0.50;      // dry runway with anti-skid at its optimum slip
export const WHEEL_R_MAIN = 0.62, WHEEL_R_NOSE = 0.39;
export const STEER_TILLER = 75 * DEG, STEER_PEDAL = 6 * DEG; // max nosewheel angle
export const GEAR_TRAVEL_S = 7.0, GEAR_DOOR_S = 2.0;
export const GEAR_BREAK_VS = 4.6;  // m/s (≈ 900 ft/min) sink at touchdown breaks the gear
// Grass, or any unpaved ground [EST]: firm, dry grass rolls heavier and brakes and grips less
// than a runway. A light touchdown or a slow roll on it is fine (v0.1.2); a fast run across it
// (soft ground, ditches, lights and signs) breaks the gear after GRASS_RUN_M.
export const ROLL_RESIST_GRASS = 0.06;
export const BRAKE_MU_GRASS = 0.30;
export const SIDE_MU_GRASS = 0.6;    // side grip, as a fraction of the runway's
export const GRASS_SAFE_GS = 15;     // m/s (29 kt): slower than this, the grass can't hurt the gear
export const GRASS_RUN_M = 450;      // m run on grass faster than GRASS_SAFE_GS before the gear gives way
                                     // (enough for a 400 m undershoot that rolls on to the runway)
export const PITCH_TAILSTRIKE_DEG = 11.2; // [EST] A321 geometric limit, struts extended

// ---- Fly-by-wire protections [EST] (A320-family FCOM values) ---------------------------------
export const NZ_MAX_CLEAN = 2.5, NZ_MIN_CLEAN = -1.0, NZ_MAX_FLAPS = 2.0, NZ_MIN_FLAPS = 0;
export const ROLL_RATE_MAX = 15 * DEG;
export const BANK_NEUTRAL = 33 * DEG, BANK_MAX = 67 * DEG, BANK_MAX_PROT = 45 * DEG;
export const PITCH_MAX = 30 * DEG, PITCH_MAX_LOWSPD = 25 * DEG, PITCH_MIN = -15 * DEG;
// α floor (TOGA): 9.5° clean, 15° CONF 1–2, 14° CONF 3, 13° FULL (FCOM) — expressed here as
// a margin below α max; α prot sits 4° below α max, α floor 2.5° and the stall warning 3° below (≈ 1.04–1.06 VS1g).
export const ALPHA_PROT_MARGIN = 4.0 * DEG;
export const ALPHA_FLOOR_MARGIN = 2.5 * DEG;
export const ALPHA_SW_MARGIN = 3.0 * DEG;
export const VLS_FACTOR = 1.23;   // VLS = 1.23 VS1g (Airbus, post-2006 definition)
