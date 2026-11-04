// The Boeing 787-9 (GE GEnx-1B74/75/P2): every number the sim uses, with its source.
//
// Sources (page numbers are the documents' own; [ACAP] 2-3 is PDF p.19, 3-17 PDF p.52, 3-31 PDF p.66,
// 4-3 PDF p.72, 4-6 PDF p.75, 7-4 PDF p.158, 7-7 PDF p.161):
//   [TCDS] EASA Type Certificate Data Sheet EASA.IM.A.115, Issue 30 (17 December 2025), Section 2
//          (787-9). reference/docs/easa-tcds-im-a-115-787.pdf. The validation of FAA T00021SE.
//   [ACAP] Boeing, 787 Airplane Characteristics for Airport Planning, D6-58333 Rev Q, October 2025.
//          reference/docs/boeing-acap-787.pdf.
//   [ARC]  Boeing, Aerodrome Reference Code and Approach Speeds, Rev A, August 2026, p.6
//          (787-9 row). reference/docs/boeing-arc-approach-speeds.pdf.
//   [GENX] EASA TCDS IM.E.102 (GEnx series), Issue 12 (25 February 2026), the engine's ratings and shaft
//          speeds. reference/docs/easa-tcds-im-e-102-genx.pdf.
//   [EDB]  ICAO Aircraft Engine Emissions Databank, UID 07P27GE235 (GEnx-1B74/75/P2).
//   [PUB]  A public figure, not from these documents: the URL is in reference/notes/b787-9-performance.md.
//   [FORUM] Pilot study notes and forums, the only public source for the AFM's speeds, which the TCDS
//          leaves to the AFM ("For other airspeed limits, see the ... Airplane Flight Manual"). Treat as
//          likely, not certain: see the notes file §1.
//   [EST]  An estimate: the reasoning is given next to the number, and the checks against the documents'
//          performance are in tests/b787-9-performance.test.mjs and the notes file.
//
// Units: SI unless the name says otherwise (KT = knots, FT = feet, DEG = degrees).

export const KT = 0.514444;  // m/s per knot
export const FT = 0.3048;    // m per foot
export const FPM = FT / 60;  // m/s per ft/min
export const DEG = Math.PI / 180;
export const LB = 0.45359237;

// ---- Speeds and limits ----------------------------------------------------------------
export const VMO_KT = 350;                // [TCDS] p.36 §10 "VMO/MMO = 350KEAS / 0.90M" (EAS ≈ CAS below 10,000 ft or so)
export const MMO = 0.90;                  // [TCDS] p.36 §10
// VFE per flap detent, [FORUM] 787-9/-10 limitations cards (two brainscape decks agree): the TCDS and ACAP don't give them.
// UP is VMO, for the sim's speed limit logic.
export const VFE_KT = { UP: VMO_KT, '1': 260, '5': 240, '10': 230, '15': 220, '17': 215, '18': 215, '20': 210, '25': 190, '30': 180 };
export const VLE_KT = 270, MLE = 0.82;    // [FORUM] same cards, gear operating and extended 270 kt / M0.82
export const VLO_EXT_KT = 270;            // [FORUM] same
export const VLO_RET_KT = 270;            // [FORUM] same: the cards give one VLO, with no separate retraction speed
export const TYRE_LIMIT_KT = 204.2;       // [ACAP] 3-17: "235 MPH (376 KMPH) tire speed limit", ground speed
export const MAX_ALT_FT = 43100;          // [TCDS] p.36 §11
// Approach speed at the maximum landing weight, [ARC] 787-9 row: 153 kt (category D). It is defined as
// 1.3 VS0 at MLW, the same thing as VREF: the speed over the threshold, with no wind additive.
export const VREF30_MLW_KT = 153;
export const VAPP_MLW_KT = VREF30_MLW_KT;
// Boeing's flap manoeuvre speeds as additions to VREF30: [EST] the schedule as I recall it, not from a document
// I could check. For the speed tape's flap markers; nothing reads it yet.
export const VREF_ADD_KT = { UP: 80, '1': 60, '5': 40, '10': 30, '15': 20, '17': 20, '18': 20, '20': 20, '25': 5, '30': 0 };

// ---- Weights --------------------------------------------------------------------------
export const MTOW = 254692;   // [TCDS] p.37 §13, 561,500 lb ([ACAP] 2-3 agrees; its charts stop at 560,000 lb, 254,011 kg)
export const MTW = 255372;    // [TCDS] p.37 §13, maximum taxi weight, 563,000 lb
export const MLW = 192776;    // [TCDS] p.37 §13, 425,000 lb
export const MZFW = 181436;   // [TCDS] p.37 §13, 400,000 lb
export const MIN_WEIGHT = 110677; // [TCDS] p.37 §13, minimum flight and zero fuel weight, 244,000 lb
// Operating empty weight: not in the documents ([ACAP] 3-3 says to consult the airline). [PUB] 128,850 kg: spec
// sites give 128,800 to 129,000 kg (and 284,000 lb) with no primary source.
export const OEW = 128850;
export const MAX_PAYLOAD = MZFW - OEW;

// ---- Fuel: left, right and centre ------------------------------------------------------
// [TCDS] p.35 §9, usable: Main L or R 20,895 L (16,716 kg), Center 84,566 L (67,653 kg), Total 126,356 L
// (101,085 kg), at 0.8 kg/L. ([ACAP] 2-3 and 3-3 give 126,429 L, 101,522 kg, at 6.7 lb/US gal.)
export const FUEL_WING_EACH = 16716; // kg per wing (left/right)
export const FUEL_CENTER = 67653;    // kg
export const FUEL_MAX = 2 * FUEL_WING_EACH + FUEL_CENTER;    // 101,085 kg
export const FUEL_DENSITY = 0.8;     // kg/L, [TCDS] p.36

// ---- Geometry -------------------------------------------------------------------------
export const SPAN = 60.12;     // [ACAP] 2-6 ([TCDS] p.33: 60.1218 m)
// Wing reference area: not in the documents. [PUB] 377 m²: a spec site's AR 9.59 implies it with this span, though
// another lists 360.5 m². Only the product with the coefficients below matters, and they are all tuned on this area.
export const S = 377;
// Mean aerodynamic chord 6.27126 m, [TCDS] p.37 §16 (246.9 in). The body reference point is at 25% MAC
// (src/geometry-b787-9.js).
export const MAC = 6.27126;
export const AR = SPAN * SPAN / S;     // 9.59

// ---- Engines: 2 × GE GEnx-1B74/75/P2 -----------------------------------------------------
// The 787-9's high-thrust option [TCDS] p.34, the rating its MTOW of 254,692 kg needs (p.37's note), and the
// one [ACAP] 3-17 "High Thrust Rating" charts. Take-off thrust 341.2 kN flat rated to 31.7 °C [TCDS] p.34,
// [GENX] p.9; maximum continuous 305.1 kN [GENX] p.9.
export const T0_ENGINE = 341200;  // N
// The sound (src/audio/synth.js, def.sound): the fan's 18 blades [PUB] a 2010 trade article (no GE document found); [GENX] p.15:
// 100% N1 is 2,560 rpm and 100% N2 is 11,377 rpm for the -1B (the limits, 2,778 and 13,368 rpm for /P2,
// are 108% and 117.5% of those, which is how the two columns of notes on that page sort themselves).
export const FAN_BLADES = 18;
export const N1_100_RPM = 2560, N2_100_RPM = 11377;
export const N1_MAX_PCT = 108, N2_MAX_PCT = 117.5;
// Thrust lapse with Mach and density. [EST] T/T0 = σ^0.75 · (1 − 0.9 M + 0.4 M²): the A321neo's form, flatter in Mach.
// Two checks fix it: 0.80 of T0 at M0.25 (the MTOW field length, tests) and 55 kN per engine of climb thrust at FL390, M0.85
// against 49 kN needed at 200 t (the climb still works at FL390 and stops being worth it near FL410).
export const LAPSE_SIGMA_EXP = 0.75;
export const LAPSE_M1 = -0.9, LAPSE_M2 = 0.4;
// Ratings as a fraction of the take-off thrust available. MCT 305.1/341.2 = 0.894 [GENX] p.9. CL [EST] 0.85,
// the usual step below MCT (the A321neo's are 0.84 and 0.95).
export const RATING = { IDLE: 0, CL: 0.85, MCT: 0.894, TOGA: 1.0 };
// Idle thrust per engine at sea level static, [EST] 9 kN: 2.7% of take-off thrust as on the A321neo.
export const T_IDLE = 9000;
// Reverse: [EST] maximum reverse 22% of take-off thrust. The GEnx-1B has a cascade reverser in a fan
// duct with bypass ratio 9, weaker for its size than the LEAP's; not credited in the dry landing distances.
export const REV_FRACTION = 0.22;
export const REV_DEPLOY_S = 2.0;
// N1 (display): [EST] ground idle 21%, flight idle rises with altitude, take-off about 97% (below the 108% limit).
export const N1_IDLE = 21, N1_TOGA = 97;
// Spool: [EST] the same first-order shape as the A321neo's, a little slower for a fan 1.4 times the size:
// about 7 s from idle to take-off (CS 25.119 go-around: within 8 s).
export const SPOOL_TAU_HIGH = 1.1, SPOOL_TAU_LOW = 3.0;
// Fuel flow: TSFC = (C0 + C1·M)·√θ. C0 [EDB] UID 07P27GE235, 341.18 kN: 2.722 / 2.218 / 0.689 kg/s at 100 / 85 /
// 30 % → 8.0 / 7.6 / 6.7 g/(kN·s) at sea level static; C0 is their middle. C1 [EST] so that cruise at M0.85 FL390
// comes to 15.9 g/(kN·s) = 0.56 lb/(lbf·h), which is 5.6 t/h at 200 t and L/D 20: [PUB] about 5,600 kg/h in cruise (spec sites, no conditions stated).
export const TSFC_C0 = 0.75e-5;  // kg/(N·s)
export const TSFC_C1 = 1.27e-5;  // kg/(N·s) per Mach
export const FF_IDLE = 0.225;    // kg/s per engine, [EDB] the 7% point

// ---- Flaps and slats ------------------------------------------------------------------
// The lever's detents are the 787's (the same cards, and V030's brief): UP, 1, 5, 10, 15, 17, 18, 20, 25, 30. The
// documents don't give the surfaces' angles. [EST] the trailing edge follows the detent's name; the slats go
// to the sealed position (20°) at flaps 1 and to gapped (30°) at flaps 25 and 30, which is my recollection of the 777 and 787.
export const CONFIGS = {
  UP: { slat: 0, flap: 0 }, '1': { slat: 20, flap: 0 }, '5': { slat: 20, flap: 5 }, '10': { slat: 20, flap: 10 }, '15': { slat: 20, flap: 15 },
  '17': { slat: 20, flap: 17 }, '18': { slat: 20, flap: 18 }, '20': { slat: 20, flap: 20 }, '25': { slat: 30, flap: 25 }, '30': { slat: 30, flap: 30 },
};
// Travel rates [EST]: slats about 25 s and flaps about 40 s, UP to 30.
export const SLAT_RATE = 1.2 * DEG, FLAP_RATE = 0.75 * DEG; // rad/s, as deg/s × DEG
// Not used: only the Airbus's lever position 1 has this logic (HAS_1F). Boeing's flap load relief isn't modelled.
export const AUTO_RETRACT_KT = 210;

// ---- Aerodynamics [EST] -----------------------------------------------------------------
// Max lift per configuration, from the documents' speeds.
// Flaps 30: VREF = 1.23 VS1g (Boeing, post-2006 definition) = 153 kt at MLW [ARC] → VS1g 124.4 kt → CLmax 2.00.
// Flaps 25: [EST] VREF25 ≈ VREF30 + 5 → 1.88.
// Take-off: [ACAP] 3-17's 2,850 m at MTOW needs V2 ≈ 169 kt at flaps 15, CLmax 1.83 (VS1g 150 kt, V2 = 1.13 VS1g).
// UP: 1.30, typical for a supercritical swept wing without slats. It gives VS1g 154 kt at MLW, so that VREF30 + 80
// (233 kt) is 1.51 VS1g, a plausible flaps-up margin. Sealed slats alone add 0.25.
//   VS1g at MLW: UP 154 kt, 1 141 kt, 5 136, 10 133, 15 130, 20 129, 25 128, 30 124.4.
// CLmax is a function of slat and flap angle so it is continuous while they travel.
export const CLMAX_CLEAN = 1.30;
export const SLAT_CLMAX = [[0, 0], [20, 0.25], [30, 0.34]];       // ΔCLmax vs slat°
export const FLAP_CLMAX = [[0, 0], [5, 0.12], [10, 0.20], [15, 0.28], [20, 0.30], [25, 0.24], [30, 0.36]]; // vs flap°
// The angle of attack at CLmax (fuselage datum): slats raise it, flaps lower it. Clean 14°, 16° with sealed slats,
// flaps 15 14.2°, flaps 30 13°. These set the attitudes: at flaps 15, MTOW, about 170 kt the lift-off α is about 7°,
// under the 9.6° tail-strike pitch; at flaps 30, VREF + 5, α is
// about 5°, which is +2° of pitch on a 3° path ([EST] a normal approach attitude).
export const ALPHA_MAX_CLEAN = 14.0 * DEG;
export const SLAT_ALPHA = 2.0 * DEG / 20;  // per slat degree (up to 20°), +0.5° more by 30°
export const FLAP_ALPHA = -0.117 * DEG;    // per flap degree
// Lift-curve slope (per rad): 5.0 clean (AR 9.6, 32° sweep, with the body), rising with Fowler extension to 7.0 at
// flaps 30, on the clean wing's area. Prandtl–Glauert with sweep for Mach: 7.2 at M0.85, so the cruise CL of 0.53 is
// α = 2.3° ([EST] a normal cruise attitude).
export const CLA_CLEAN = 5.0, CLA_FULL = 7.0;
export const KNEE = 3.5 * DEG;            // lift curve rounds over the last ~3.5° before CLmax
export const SWEEP = 32.2 * DEG;          // [PUB] quarter-chord sweep
// Drag polar: CD = CD0 + K·CL² + flap/slat/gear/spoiler increments + wave drag. CD0 includes everything that doesn't
// vary with lift, on S = 377 m². CD0 0.0150 and e 0.85 (K 0.039) give L/D 20 at the cruise CL of 0.53 (the job's target
// is 19 to 21, not a published figure). Raked tips and a cleaner design are my reasons for e above the A321neo's 0.80 and CD0 below its 0.021.
export const CD0 = 0.0150;
export const OSWALD = 0.85;
export const OSWALD_FLAPS = 0.75;         // with flaps out
// Flap and gear drag: the A321neo's shape, lower for the larger reference area, so that a 3° path at VREF30 + 5 needs a
// sensible N1 (50% to 65%: L/D about 8 in flaps 30, gear down) and flaps 15 at MTOW climbs away well.
export const FLAP_CD = [[0, 0], [5, 0.005], [15, 0.012], [20, 0.018], [25, 0.030], [30, 0.045]];
export const SLAT_CD_PER_DEG = 0.0002;
export const GEAR_CD = 0.016, GEAR_DOOR_CD = 0.004; // on a larger wing than the A321neo's, for 10 tyres on two bogies
export const SPEEDBRAKE_CD = 0.035, GROUND_SPOILER_CD = 0.07;
export const SPEEDBRAKE_CL = -0.10, GROUND_SPOILER_CL = -0.75;
// Wave drag: 20·(M − Mcrit)^4 with Mcrit = 0.79 − 0.1·(CL − 0.5): Mdd (20 counts) is 0.885 at cruise CL. M0.85 costs 3
// counts and MMO (M0.90) 29 counts, so it holds MMO level at MCT, with L/D about 17.5: no wall.
export const MCRIT0 = 0.79, WAVE_K = 20;
// Buffet: CLmax falls above M0.35 by 0.62 per Mach: 0.90 at M0.85, which is a 1.7 g margin at cruise CL and 1.5 g at
// the 43,100 ft ceiling at 180 t.
export const CLMAX_MACH_SLOPE = 0.62;

// Moments (body axes, coefficients on q·S·c for pitch and q·S·b for roll/yaw), per rad.
export const CM = {
  alpha: -1.20,   // about 25% MAC, tail on. Neutral point = 25% + 1.2/CLα: 49% MAC at low speed (CLα 5.0), 42% at M0.85 (7.2), so it stays
                  // aft of [ACAP] 7-7's 37.5% limit. Less than the A321neo's -1.30 for its CLα: a relaxed-stability FBW design.
  q: -28,         // pitch damping, per (q·c/2V), the same order as a 767's
  alphaDot: -8,
  elevator: 1.45, // per rad of nose-up elevator
  ths: 3.4,       // per rad of nose-up stabiliser (stabiliser about 1.9 × elevator as the A321neo's and most airliners')
  flap: -0.0020,  // per flap degree (nose-down flap moment, trimmed out by the THS)
  spoiler: 0.02,
  ground: -0.04,  // extra nose-down in ground effect
  gear: 0.004,
};
// Signs: aileron + rolls right, rudder + yaws right, β + is wind from the right. Non-dimensional, so the A321neo's values
// carry over as a start, with small changes: the larger sweep raises Clβ's size, and the rudder's a bit less per S·b.
// Roll spoiler: per unit (full roll deflection) on one wing.
export const CY = { beta: -0.95, rudder: -0.25 };
export const CL_ROLL = { beta: -0.11, p: -0.48, r: 0.14, aileron: 0.075, spoiler: 0.085, rudder: -0.012 };
export const CN = { beta: 0.13, p: -0.035, r: -0.22, aileron: -0.004, rudder: 0.105 };

// Control surface limits and rates [EST] (airliner values; only the FBW's demands reach them).
export const ELEV_UP = 30 * DEG, ELEV_DN = 20 * DEG, ELEV_RATE = 30 * DEG;
export const THS_UP = 13.5 * DEG, THS_DN = 4 * DEG, THS_RATE = 0.7 * DEG; // nose up +
export const AIL_MAX = 25 * DEG, AIL_RATE = 40 * DEG;
export const RUD_MAX = 30 * DEG, RUD_RATE = 40 * DEG; // limited with speed (sim.js)
export const SPOILER_MAX = 50 * DEG;
export const SPOILER_RATE = 1.2;          // fraction per second (roll spoilers faster: 3.0)

// ---- Mass properties [EST] ----------------------------------------------------------------
// CG positions along body x (m, + forward of the 25% MAC reference point). cgMac = 25% − x/MAC. [ACAP] 7-7 gives the
// envelope: 8% to 37.5% MAC at low weights, narrowing to about 23% to 32% at the maximum taxi weight. These put MTOW (58 t
// in the centre tank, 34 t payload) at 22.7%, OEW + payload at 31%, and MLW with 30 t in the wings (centre tank burnt
// first) at 36%: all inside it.
export const CG_OEW_X = -0.56;       // 34% MAC: the mains sit far aft on the wing and it carries the fuel moment forward
export const CG_PAYLOAD_X = 0.20;    // cabin and holds, about balanced
export const CG_WING_FUEL_X = -2.2;  // the main tanks' centroid: [DRAW] about y = 13 m, mid chord, swept back of the reference
export const CG_CENTER_FUEL_X = 3.0; // the centre tank: between the spars at the root, well ahead of the reference
// Inertia (kg·m²), body axes: Roskam radii of gyration as the A321neo (R̄x 0.25, R̄y 0.38, R̄z 0.46), with b 60.12 and L 62.81,
// give per kg 56.5, 142 and 200, so at 200 t: Ixx 1.13e7, Iyy 2.85e7, Izz 4.00e7. (±25%, as the A321neo's.) Split so wing fuel (y about 13 m, r² ≈ 180) adds to Ixx and Izz only: at 200 t with 30 t
// of wing fuel these come to the values above. Ixz about 2% of Izz.
export const IXX_ZFW_PER_KG = 34.7, IXX_WING_FUEL_R2 = 180;
export const IYY_PER_KG = 142.4;
export const IZZ_ZFW_PER_KG = 201.8, IZZ_WING_FUEL_R2 = 190;
export const IXZ = 0.8e6;

// ---- Landing gear ---------------------------------------------------------------------
// Struts as nonlinear spring-dampers. Static compression puts the fuselage centreline GROUND_Z = 4.90 m above the
// runway at 25% MAC (src/geometry-b787-9.js, from [ACAP] 2-9). [EST] k·c and k3·c³ share the static load equally, as on
// the A321neo: at 200 t the nose carries 7.3% ([ACAP] 7-7 with the CG at 25% MAC: 1.89 m / 25.83 m) and each main 46.3%.
// The same springs carry MTOW 4 cm lower and a light aircraft 5 cm higher: the 0.10 m range of [ACAP] 2-9's D. Stroke [EST]
// 0.60 m main, 0.50 m nose. Damping scales the A321neo's with mass (2.5×): soft in compression and strong in extension,
// as in an oleo: a firm touchdown at about 300 ft/min gives 1.3 to 1.5 g, with no rebound.
export const GEAR_DATA = {
  nose: { stroke: 0.50, staticComp: 0.25, k: 2.8e5, k3: 4.5e6, c: 7.5e4, cExt: 3.5e5, mu: 0.75 },
  main: { stroke: 0.60, staticComp: 0.33, k: 1.376e6, k3: 1.263e7, c: 2.25e5, cExt: 1.1e6, mu: 0.80 },
};
export const ROLL_RESIST = 0.013;
export const BRAKE_MU = 0.50;      // dry runway with anti-skid at its optimum slip; the landing distance test checks it
export const WHEEL_R_MAIN = 54 * 0.0254 / 2, WHEEL_R_NOSE = 40 * 0.0254 / 2; // [ACAP] 7-4: 54×21.0 R23, 40×16.0 R16 ([TCDS] p.38)
export const STEER_TILLER = 70 * DEG, STEER_PEDAL = 7 * DEG; // [ACAP] 4-3: 70° max; pedals [EST]
export const GEAR_TRAVEL_S = 12.0, GEAR_DOOR_S = 2.0;        // [EST] widebody retraction
export const GEAR_BREAK_VS = 4.6;  // m/s (≈ 900 ft/min) sink at touchdown breaks the gear, as the A321neo
// Grass, or any unpaved ground [EST]: as the A321neo.
export const ROLL_RESIST_GRASS = 0.06;
export const BRAKE_MU_GRASS = 0.30;
export const SIDE_MU_GRASS = 0.6;
export const GRASS_SAFE_GS = 15;
export const GRASS_RUN_M = 450;
// The pitch at which the tail strikes, gear unloaded: from the side view (geometry-b787-9.js TAIL_STRIKE_POINT).
export const PITCH_TAILSTRIKE_DEG = 9.6;

// ---- Protections and law limits [EST] -------------------------------------------------------
// Only the Airbus law reads most of these (until src/sim/fbw-boeing.js lands, the 787 flies with it).
export const NZ_MAX_CLEAN = 2.5, NZ_MIN_CLEAN = -1.0, NZ_MAX_FLAPS = 2.0, NZ_MIN_FLAPS = 0;
export const ROLL_RATE_MAX = 15 * DEG;
export const BANK_NEUTRAL = 33 * DEG, BANK_MAX = 67 * DEG, BANK_MAX_PROT = 45 * DEG;
export const PITCH_MAX = 30 * DEG, PITCH_MAX_LOWSPD = 25 * DEG, PITCH_MIN = -15 * DEG;
export const ALPHA_PROT_MARGIN = 4.0 * DEG;
export const ALPHA_FLOOR_MARGIN = 2.5 * DEG;
export const ALPHA_SW_MARGIN = 3.0 * DEG;
export const VLS_FACTOR = 1.23;   // VREF = 1.23 VS1g (Boeing, post-2006 definition)

// ---- What the type registry reads (v0.3.0) ------------------------------------------------
export const ID = 'b787-9';
export const FAMILY = 'boeing';           // the control laws, the screens and the AP's modes
export const LEVER_LAW = 'boeing';        // engines.js: no detents between idle and full
export const N1_IDLE_ALT = 9, N1_IDLE_MACH = 6; // flight idle's rise with altitude and Mach [EST]
export const N1_REV = 76;                 // N1 at full reverse [EST]
export const CM0 = 0.012;                 // basic pitching moment [EST]
export const CL_THS = -0.25;              // the stabiliser's own (download) lift, per rad [EST]
export const FLAP_REF_DEG = 30;           // the flap angle at which the lift slope reaches CLA_FULL
export const SLAT_BREAK_DEG = 20, SLAT_EXTRA_DEG = 10; // liftCurve's α max: full SLAT_ALPHA at the break, 0.5° more by break + extra
// The wing's height above the wheels, for ground effect: [DRAW] about 4.6 m at the MAC's span station (front view).
export const WING_HEIGHT = 4.6;
// The flap lever's positions (keys 6 to 0: FLAP_KEYS[key] is the lever), the next configuration (the tape's VFE next).
export const FLAP_LEVER = ['UP', '1', '5', '10', '15', '17', '18', '20', '25', '30'];
export const FLAP_KEYS = [0, 2, 4, 7, 9];    // keys 6–0: UP, 5, 15, 20, 30; [ and ] step through all ten
export const NEXT_CONFIG = { UP: '1', '1': '5', '5': '10', '10': '15', '15': '17', '17': '18', '18': '20', '20': '25', '25': '30', '30': null };
export const HAS_1F = false;
export const TAKEOFF_FLAP_LEVER = 4;      // where a runway or gate start puts the lever: flaps 15, what the MTOW chart wants
export const THRUST_DETENTS = [{ name: 'IDLE', at: 0 }, { name: 'FULL', at: 1 }];
export const CONFIG_FULL = '30';        // speed brakes are inhibited here
// The configuration the surfaces are actually in (the VFE during a retraction).
export function configOfSurfaces(slat, flap) {
  if (flap > 25.5) return '30';
  if (flap > 20.5) return '25';
  if (flap > 18.5) return '20';
  if (flap > 17.5) return '18';
  if (flap > 15.5) return '17';
  if (flap > 10.5) return '15';
  if (flap > 5.5) return '10';
  if (flap > 0.5) return '5';
  if (slat > 0.5) return '1';
  return 'UP';
}

// Minimum manoeuvring speed (the top of the PFD's amber band, where the trim stops) over the 1 g
// stall [EST]. Flown at Vref + 5 the speed has to sit above the band; with Vref = VLS_FACTOR (1.23) ×
// VS1g here (the approach speed's anchor above) a factor of 1.3 put the band above Vref on every
// approach, so 1.2: the band's top is about 2.5 % under Vref, a few knots.
export const VMM_FACTOR = 1.2;

// Where the 15 nm final start and Skip to final put the flap lever: flaps 5 (main.js placeOnFinal).
export const FINAL_FLAP_LEVER = FLAP_LEVER.indexOf('5');
