// The Boeing 777-300ER (GE GE90-115B): every number the sim uses, with its source.
//
// Sources (page numbers are the documents' own; [ACAP] 2-2 is PDF p.16, 3-13 PDF p.54, 3-30 PDF p.71,
// 4-4 PDF p.79, 7-5 PDF p.137, 7-8 PDF p.140):
//   [TCDS] EASA Type Certificate Data Sheet EASA.IM.A.003, Issue 20 (13 May 2026), Section 4 (-300ER),
//          PDF pp.25–28. reference/docs/easa-tcds-im-a-003-777.pdf. The validation of FAA T00001SE.
//   [ACAP] Boeing, 777-200LR/-300ER/-Freighter Airplane Characteristics for Airport Planning, D6-58329-2 Rev G,
//          December 2024. reference/docs/boeing-acap-777-300er.pdf. (D6-58329 itself covers the -200/-200ER/-300 only:
//          its page 1-4 sends the -300ER to this one.)
//   [ARC]  Boeing, Aerodrome Reference Code and Approach Speeds, Rev A, August 2026, p.6
//          (777-300ER row). reference/docs/boeing-arc-approach-speeds.pdf.
//   [GE90] EASA TCDS IM.E.002 (GE90 series), the engine's ratings and shaft speeds.
//          reference/docs/easa-tcds-im-e-002-ge90.pdf.
//   [EDB]  ICAO Aircraft Engine Emissions Databank, UID 21GE184 and its successors (GE90-115B).
//   [PUB]  A public figure, not from these documents: the URL is in reference/notes/b777-300er-performance.md.
//   [FORUM] Pilot study notes and forums, the only public source for the AFM's speeds, which the TCDS
//          leaves to the AFM ("Air Speeds: See Airplane Flight Manual"). Treat as likely, not certain.
//   [EST]  An estimate: the reasoning is given next to the number, and the checks against the documents'
//          performance are in tests/b777-300er-performance.test.mjs and the notes file.
//
// Units: SI unless the name says otherwise (KT = knots, FT = feet, DEG = degrees).

export const KT = 0.514444;  // m/s per knot
export const FT = 0.3048;    // m per foot
export const FPM = FT / 60;  // m/s per ft/min
export const DEG = Math.PI / 180;
export const LB = 0.45359237;

// ---- Speeds and limits ----------------------------------------------------------------
// VMO/MMO: the TCDS leaves them to the AFM ([TCDS] p.26 §10). [FORUM] two AVSIM posts: 330 kt at sea level rising to 350 kt near
// FL280, M0.89. The sim has one VMO, so the sea-level figure, the one a pilot meets low down: conservative by up to 20 kt in the high 20s.
export const VMO_KT = 330;
export const MMO = 0.89;
// VFE per flap detent, [FORUM] a 777 limitations deck's 300ER column: 265, 245, 230, 200, 180 at flaps 1, 5, 15, 25, 30 (the notes' CARDS). The
// deck has no flaps 20: 225 is [EST], my recollection, not found written down. UP is VMO, for the sim's speed limit logic.
export const VFE_KT = { UP: VMO_KT, '1': 265, '5': 245, '15': 230, '20': 225, '25': 200, '30': 180 };
export const VLE_KT = 270, MLE = 0.82;    // [FORUM] the same deck: gear operating and extended 270 kt / M0.82
export const VLO_EXT_KT = 270;            // [FORUM] same
export const VLO_RET_KT = 270;            // [FORUM] same
export const TYRE_LIMIT_KT = 204.2;       // [TCDS] p.27, [ACAP] 3-13: 235 MPH tyre speed limit, ground speed
export const MAX_ALT_FT = 43100;          // [TCDS] p.26 §11
// Approach speed at the maximum landing weight, [ARC] 777-300ER row: 150 kt (category D), at 251,290 kg.
export const VREF30_MLW_KT = 150;
export const VAPP_MLW_KT = VREF30_MLW_KT;
// Boeing's flap manoeuvre speeds as additions to VREF30: [EST] the schedule as I recall it, not from a document
// I could check. For the speed tape's flap markers.
export const VREF_ADD_KT = { UP: 80, '1': 60, '5': 40, '15': 20, '20': 20, '25': 5, '30': 0 };

// ---- Weights --------------------------------------------------------------------------
export const MTOW = 351534;   // [TCDS] p.26 §13a, optional increased weight, 775,000 lb; [ACAP] 2-2 agrees (baseline 340,194 kg)
export const MTW = 352441;    // [TCDS] p.26 §13a, 777,000 lb; [ACAP] 2-2 agrees
export const MLW = 251290;    // [TCDS] p.26 §13, 554,000 lb; [ACAP] 2-2 agrees
// [ACAP] 2-2 and 3-3, 524,000 lb: the payload/range chart is drawn to it. [TCDS] p.26 lists 239,950 kg (529,000 lb), an option on some aircraft:
// a real conflict between the two documents, and the one that matches the range chart was taken.
export const MZFW = 237682;
export const MIN_WEIGHT = 160000; // [EST] the TCDS doesn't give one; [ACAP] 7-8's chart stops at 160 t. Nothing in the sim reads it.
// Operating empty weight: not in the documents ([ACAP] 3-3 says to consult the airline). [PUB] 166,440 kg, aerospaceweb's figure; other spec sites
// run to about 171 t. Airlines' cabins vary by more than that spread.
export const OEW = 166440;
export const MAX_PAYLOAD = MZFW - OEW;

// ---- Fuel: left, right and centre ------------------------------------------------------
// [ACAP] 2-2: 181,283 L, 145,570 kg usable ([ACAP] 3-3 prints 145,540). The split is [FORUM] a 777 fuel deck: mains 31,300 kg each, centre 82,900, total 145,500.
export const FUEL_WING_EACH = 31300; // kg per wing (left/right)
export const FUEL_CENTER = 145570 - 2 * 31300;    // kg
export const FUEL_MAX = 2 * FUEL_WING_EACH + FUEL_CENTER;    // 145,570 kg
export const FUEL_DENSITY = 0.803;   // kg/L: 145,570 / 181,283 ([ACAP] 2-2's 6.7 lb/US gal)

// ---- Geometry -------------------------------------------------------------------------
export const SPAN = 64.80;     // [ACAP] 2-4
export const S = 427.8;        // [TCDS] p.25 §4, wing area 4,605 ft²
// Mean aerodynamic chord 7.08 m, [TCDS] p.26 §16 (278.5 in). The body reference point is at 25% MAC.
export const MAC = 7.08;
export const AR = SPAN * SPAN / S;     // 9.82

// ---- Engines: 2 × GE GE90-115B -----------------------------------------------------------
// Take-off thrust 513.95 kN flat rated to 30 °C, maximum continuous 489.3 kN flat rated to 25 °C, [GE90] §6.
export const T0_ENGINE = 513950;  // N
// The sound (src/audio/engine-sounds.js GE90_115B, the same numbers): 22 blades [PUB]; 100% N1 2,355 rpm and 100% N2
// 9,332 rpm [GE90] Speed Limits; limits 2,602 rpm (110.5%) and 11,292 rpm (121%).
export const FAN_BLADES = 22;
export const N1_100_RPM = 2355, N2_100_RPM = 9332;
export const N1_MAX_PCT = 110.5, N2_MAX_PCT = 121;
// Thrust lapse with Mach and density. [EST] T/T0 = σ^0.85 · (1 − 0.9 M + 0.4 M²): the 787's Mach term, with a steeper density term, so that about 345 t just reaches FL310 (about 400 fpm of margin) and FL410 is out of reach near MTOW, as the usual step levels for this aircraft say.
export const LAPSE_SIGMA_EXP = 0.85;
export const LAPSE_M1 = -0.9, LAPSE_M2 = 0.4;
// Ratings as a fraction of the take-off thrust available. MCT 489.30/513.95 = 0.952 [GE90] §6. CL [EST] 0.90.
export const RATING = { IDLE: 0, CL: 0.90, MCT: 0.952, TOGA: 1.0 };
// Idle thrust per engine at sea level static, [EST] 14 kN: 2.7% of take-off thrust as on the A321neo.
export const T_IDLE = 14000;
// Reverse: [EST] maximum reverse 22% of take-off thrust, as the 787's; not credited in the dry landing distances.
export const REV_FRACTION = 0.22;
export const REV_DEPLOY_S = 2.0;
// N1 (display): [EST] ground idle 21%, flight idle rises with altitude, take-off about 100%.
export const N1_IDLE = 21, N1_TOGA = 100;
// Spool: [EST] a little slower than the 787's for a bigger fan: about 7.5 s from idle to take-off (CS 25.119: within 8 s).
export const SPOOL_TAU_HIGH = 1.2, SPOOL_TAU_LOW = 3.2;
// Fuel flow: TSFC = (C0 + C1·M)·√θ. C0 [EDB]: 4.600 / 3.566 / 1.073 kg/s at 100 / 85 / 30 % → 8.95 / 8.16 / 6.96 g/(kN·s).
// C1 [EST] so that cruise at M0.84 FL350 comes to about 15.2 g/(kN·s) = 0.54 lb/(lbf·h). What ties it down: [ACAP] 3-3's range needs L/D ÷ TSFC of about 35 h, so
// with L/D 19.3 this TSFC, within 4% (tests/b777-300er-performance.test.mjs's range test).
export const TSFC_C0 = 0.80e-5;  // kg/(N·s)
export const TSFC_C1 = 1.15e-5;  // kg/(N·s) per Mach
export const FF_IDLE = 0.341;    // kg/s per engine, [EDB] the 7% point

// ---- Flaps and slats ------------------------------------------------------------------
// The lever's detents: UP, 1, 5, 15, 20, 25, 30. The documents don't give the surfaces' angles. [EST] the trailing edge
// follows the detent's name; the slats go to sealed (20°) at flaps 1 and to gapped (30°) at flaps 25 and 30.
export const CONFIGS = {
  UP: { slat: 0, flap: 0 }, '1': { slat: 20, flap: 0 }, '5': { slat: 20, flap: 5 }, '15': { slat: 20, flap: 15 },
  '20': { slat: 20, flap: 20 }, '25': { slat: 30, flap: 25 }, '30': { slat: 30, flap: 30 },
};
// Travel rates [EST]: slats about 25 s and flaps about 40 s, UP to 30.
export const SLAT_RATE = 1.2 * DEG, FLAP_RATE = 0.75 * DEG; // rad/s, as deg/s × DEG
// Not used: only the Airbus's lever position 1 has this logic (HAS_1F).
export const AUTO_RETRACT_KT = 210;

// ---- Aerodynamics [EST] -----------------------------------------------------------------
// Max lift per configuration, from the documents' speeds.
// Flaps 30: VREF = 1.23 VS1g (Boeing, post-2006 definition) = 150 kt at MLW [ARC] → VS1g 122 kt → CLmax 2.39.
// Flaps 25: [ACAP] 3-29's dry field length at MLW, 6,200 ft against flaps 30's 5,810 ft, is 3.3% more speed → 2.24.
// Flaps 20: [ACAP] 3-13's take-off, with the check's VR = 1.13 VS1g − 7: 2.01 (flaps 15: 1.96, flaps 5: 1.80). The flaps are on the same wing's reference area; it looks high beside
// the 787-9's 2.00 in flaps 30 only because this one's area, 427.8 m² for 251 t, is a smaller wing per tonne.
// UP: 1.35, the typical supercritical swept wing; with VS1g 165 kt at MLW, VREF30 + 80 (230 kt) is 1.39 VS1g. Sealed slats alone add 0.30.
//   VS1g at MLW: UP 165 kt, 1 151, 5 144, 15 139, 20 137, 25 126, 30 122.
export const CLMAX_CLEAN = 1.35;
export const SLAT_CLMAX = [[0, 0], [20, 0.30], [30, 0.42]];       // ΔCLmax vs slat°
export const FLAP_CLMAX = [[0, 0], [5, 0.15], [15, 0.31], [20, 0.36], [25, 0.47], [30, 0.62]]; // vs flap°
// The angle of attack at CLmax (fuselage datum): slats raise it, flaps lower it. Clean 14°, flaps 20 13°, flaps 30 12.5°. Slats add only 1° at sealed, half the 787-9's, because
// the long body needs it: lift-off in flaps 20 at about 6.5° of pitch, under the 10° tail strike. At VREF30 + 5, α is about 4°, so +1° of pitch on a 3° path.
export const ALPHA_MAX_CLEAN = 14.0 * DEG;
export const SLAT_ALPHA = 1.0 * DEG / 20;  // per slat degree (up to 20°), +0.5° more by 30°
export const FLAP_ALPHA = -0.10 * DEG;    // per flap degree
// Lift-curve slope (per rad): 5.0 clean, rising with the flaps' extension to 8.0 at flaps 30, on the clean wing's area: more than the 787-9's 7.0 for this wing's larger CLmax.
export const CLA_CLEAN = 5.0, CLA_FULL = 8.0;
export const KNEE = 3.5 * DEG;            // lift curve rounds over the last ~3.5° before CLmax
export const SWEEP = 31.64 * DEG;         // [PUB] aerospaceweb, at quarter chord
// Drag polar. CD0 0.0165 and e 0.85 (K 0.038) give L/D about 19.3 at the cruise CL of 0.53; what fixes the product with TSFC is [ACAP] 3-3's range chart.
export const CD0 = 0.0165;
export const OSWALD = 0.85;
export const OSWALD_FLAPS = 0.75;         // with flaps out
// Flap and gear drag: the 787-9's on a larger wing. N1 on a 3° path at VREF30 + 5 comes to 62%, in the working range.
export const FLAP_CD = [[0, 0], [5, 0.005], [15, 0.012], [20, 0.018], [25, 0.030], [30, 0.045]];
export const SLAT_CD_PER_DEG = 0.0002;
export const GEAR_CD = 0.016, GEAR_DOOR_CD = 0.004;
export const SPEEDBRAKE_CD = 0.035, GROUND_SPOILER_CD = 0.07;
export const SPEEDBRAKE_CL = -0.10, GROUND_SPOILER_CL = -0.85;
// Wave drag: 20·(M − Mcrit)^4, Mcrit = 0.78 − 0.1·(CL − 0.5): M0.84 costs 3 counts and MMO (M0.89) about 20: no wall. The 777's older wing against the 787-9's 0.79.
export const MCRIT0 = 0.78, WAVE_K = 20;
export const CLMAX_MACH_SLOPE = 0.62;

// Moments (body axes, coefficients on q·S·c for pitch and q·S·b for roll/yaw), per rad.
export const CM = {
  alpha: -1.60,   // about 25% MAC, tail on. Neutral point 25% + 1.6/CLα: 57% MAC at low speed, 47% at M0.84 (CLα 6.7 or so), aft of [ACAP] 7-8's 44.5% limit. Why more than the 787-9's: this limit is further aft.
  q: -32,         // pitch damping, per (q·c/2V): the 787-9's, more for the longer tail arm
  alphaDot: -9,
  elevator: 1.45, // per rad, the 787-9's
  ths: 3.4,       // per rad, the 787-9's
  flap: -0.0020,
  spoiler: 0.02,
  ground: -0.04,
  gear: 0.004,
};
export const CY = { beta: -0.95, rudder: -0.25 };
export const CL_ROLL = { beta: -0.11, p: -0.48, r: 0.14, aileron: 0.075, spoiler: 0.085, rudder: -0.012 };
export const CN = { beta: 0.13, p: -0.035, r: -0.22, aileron: -0.004, rudder: 0.105 };

// Control surface limits and rates [EST].
export const ELEV_UP = 30 * DEG, ELEV_DN = 20 * DEG, ELEV_RATE = 30 * DEG;
export const THS_UP = 13.5 * DEG, THS_DN = 4 * DEG, THS_RATE = 0.7 * DEG; // nose up +
export const AIL_MAX = 25 * DEG, AIL_RATE = 40 * DEG;
export const RUD_MAX = 30 * DEG, RUD_RATE = 40 * DEG; // limited with speed (sim.js)
export const SPOILER_MAX = 50 * DEG;
export const SPOILER_RATE = 1.2;          // fraction per second (roll spoilers faster: 3.0)

// ---- Mass properties [EST] ----------------------------------------------------------------
// CG positions along body x (m, + forward of the 25% MAC reference point). cgMac = 25% − x/MAC. [ACAP] 7-8 gives the envelope: 27.5 to 38.4% MAC at the maximum taxi weight, about 19 to
// 44.5% near 310 t, 8 to 44.5% below 180 t. None of the x's is a document's: they're chosen to fall inside it, with the chart's own 'CG for ACN/ACR' of 27.5% near MTOW. So 29% at MTOW, 33 to 37% at MLW.
export const CG_OEW_X = -0.5;
export const CG_PAYLOAD_X = 0.20;
export const CG_WING_FUEL_X = -2.5;
export const CG_CENTER_FUEL_X = 1.8;
// Inertia (kg·m²): Roskam radii as the A321neo (R̄x 0.25, R̄y 0.38, R̄z 0.46), b 64.8, L 73.86: per kg 65.6, 197, 254.
export const IXX_ZFW_PER_KG = 42.2, IXX_WING_FUEL_R2 = 200;
export const IYY_PER_KG = 196.9;
export const IZZ_ZFW_PER_KG = 261.8, IZZ_WING_FUEL_R2 = 210;
export const IXZ = 1.4e6;

// ---- Landing gear ---------------------------------------------------------------------
// Struts as nonlinear spring-dampers. Static compression puts the fuselage centreline GROUND_Z = 5.73 m above the runway at 25% MAC
// (src/geometry-b777-300er.js, from [ACAP] 2-7). [EST] k·c and k3·c³ share the static load equally at a 270 t design point, the 787-9's method:
// each main 46.5% of 2.65 MN at 0.33 m, the nose 8.2% at 0.25 m. The same springs carry MTOW 4 cm lower and 190 t 6 cm higher, inside
// [ACAP] 2-7's ±0.16 m. Damping is the 787-9's × 1.33 (the mass ratio at MLW), and a touchdown at a given sink gives the same g as the 787-9's
// (measured: 435 ft/min 1.91 g against 444 ft/min 1.91 g; 750 ft/min 3.4 g on both, 0.51 m of the 0.60 m stroke).
// The real main gear is a semi-levered 6-wheel bogie, and the sim has one contact per leg, at the bogie's centre: no lever and no tilt. So it stands
// and bears loads right; what the lever does at rotation is only in the tail-strike angle (geometry-b777-300er.js TAIL_STRIKE_POINT), not in the rotation's kinematics.
// Stroke [EST]: main 0.60 m, nose 0.60 m.
export const GEAR_DATA = {
  nose: { stroke: 0.60, staticComp: 0.25, k: 4.3e5, k3: 6.9e6, c: 1.0e5, cExt: 4.7e5, mu: 0.75 },
  main: { stroke: 0.60, staticComp: 0.33, k: 1.845e6, k3: 1.695e7, c: 3.0e5, cExt: 1.5e6, mu: 0.80 },
};
export const ROLL_RESIST = 0.013;
export const BRAKE_MU = 0.50;      // dry runway with anti-skid at its optimum slip; the landing distance test checks it
export const WHEEL_R_MAIN = 52 * 0.0254 / 2, WHEEL_R_NOSE = 43 * 0.0254 / 2; // [ACAP] 7-5: 52×21.0 R22, 43×17.5 R17 ([TCDS] p.27)
export const STEER_TILLER = 70 * DEG, STEER_PEDAL = 7 * DEG; // [ACAP] 4-4: 70° max; pedals [EST]
export const GEAR_TRAVEL_S = 14.0, GEAR_DOOR_S = 2.0;        // [EST] widebody retraction
export const GEAR_BREAK_VS = 4.6;  // m/s (≈ 900 ft/min) sink at touchdown breaks the gear, as the others
// Grass, or any unpaved ground [EST]: as the A321neo.
export const ROLL_RESIST_GRASS = 0.06;
export const BRAKE_MU_GRASS = 0.30;
export const SIDE_MU_GRASS = 0.6;
export const GRASS_SAFE_GS = 15;
export const GRASS_RUN_M = 450;
// The pitch at which the tail strikes, gear unloaded: [FORUM] a 777 study deck, 10.0° for the -300ER against 8.9° for the -300 (same fuselage; the -300ER's semi-levered gear
// is the difference). [DRAW] my geometry without the lever gives 9.2° (geometry-b777-300er.js TAIL_STRIKE_POINT).
export const PITCH_TAILSTRIKE_DEG = 10.0;

// ---- Protections and law limits [EST] -------------------------------------------------------
export const NZ_MAX_CLEAN = 2.5, NZ_MIN_CLEAN = -1.0, NZ_MAX_FLAPS = 2.0, NZ_MIN_FLAPS = 0;
export const ROLL_RATE_MAX = 15 * DEG;
export const BANK_NEUTRAL = 33 * DEG, BANK_MAX = 67 * DEG, BANK_MAX_PROT = 45 * DEG;
export const PITCH_MAX = 30 * DEG, PITCH_MAX_LOWSPD = 25 * DEG, PITCH_MIN = -15 * DEG;
export const ALPHA_PROT_MARGIN = 4.0 * DEG;
export const ALPHA_FLOOR_MARGIN = 2.5 * DEG;
export const ALPHA_SW_MARGIN = 3.0 * DEG;
export const VLS_FACTOR = 1.23;   // VREF = 1.23 VS1g (Boeing, post-2006 definition)

// ---- What the type registry reads (v0.3.0) ------------------------------------------------
export const ID = 'b777-300er';
export const FAMILY = 'boeing';           // the control laws, the screens and the AP's modes
export const LEVER_LAW = 'boeing';        // engines.js: no detents between idle and full
export const N1_IDLE_ALT = 9, N1_IDLE_MACH = 6; // flight idle's rise with altitude and Mach [EST]
export const N1_REV = 76;                 // N1 at full reverse [EST]
export const CM0 = 0.012;                 // basic pitching moment [EST]
export const CL_THS = -0.25;              // the stabiliser's own (download) lift, per rad [EST]
export const FLAP_REF_DEG = 30;           // the flap angle at which the lift slope reaches CLA_FULL
export const SLAT_BREAK_DEG = 20, SLAT_EXTRA_DEG = 10; // liftCurve's α max: full SLAT_ALPHA at the break, 0.5° more by break + extra
// The wing's height above the wheels, for ground effect: [DRAW] about 5.3 m at the MAC's span station (front view).
export const WING_HEIGHT = 5.3;
// The flap lever's positions (keys 6 to 0: FLAP_KEYS[key] is the lever), the next configuration (the tape's VFE next).
export const FLAP_LEVER = ['UP', '1', '5', '15', '20', '25', '30'];
export const FLAP_KEYS = [0, 2, 3, 4, 6];    // keys 6–0: UP, 5, 15, 20, 30; [ and ] step through all seven
export const NEXT_CONFIG = { UP: '1', '1': '5', '5': '15', '15': '20', '20': '25', '25': '30', '30': null };
export const HAS_1F = false;
export const TAKEOFF_FLAP_LEVER = 4;      // where a runway or gate start puts the lever: flaps 20, what [ACAP] 3-13 uses at sea level up to MTOW
export const THRUST_DETENTS = [{ name: 'IDLE', at: 0 }, { name: 'FULL', at: 1 }];
export const CONFIG_FULL = '30';        // speed brakes are inhibited here
// The configuration the surfaces are actually in (the VFE during a retraction).
export function configOfSurfaces(slat, flap) {
  if (flap > 25.5) return '30';
  if (flap > 20.5) return '25';
  if (flap > 15.5) return '20';
  if (flap > 5.5) return '15';
  if (flap > 0.5) return '5';
  if (slat > 0.5) return '1';
  return 'UP';
}

// Minimum manoeuvring speed (the top of the PFD's amber band, where the trim stops) over the 1 g stall [EST]:
// the 787's 1.2, for the same reason (with Vref = 1.23 VS1g, 1.3 would put the band above Vref on every approach).
export const VMM_FACTOR = 1.2;

// Where the 15 nm final start and Skip to final put the flap lever: flaps 5 (main.js placeOnFinal).
export const FINAL_FLAP_LEVER = FLAP_LEVER.indexOf('5');
