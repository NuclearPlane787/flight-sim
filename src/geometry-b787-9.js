// Boeing 787-9 geometry, in the body frame used by the sim, the model and the cameras (geometry.js's
// frame and names): origin on the fuselage centreline at 25% MAC, +x forward, +y left, +z up, metres.
//
// Sources: [ACAP] Boeing D6-58333 Rev Q, October 2025 (reference/docs/boeing-acap-787.pdf), page numbers
// are the document's own (2-6 is PDF p.22, 2-9 PDF p.25, 4-3 PDF p.72, 4-6 PDF p.75, 7-4 PDF p.158, 7-7
// PDF p.161). [TCDS] EASA.IM.A.115 Issue 30 §2 (reference/docs/easa-tcds-im-a-115-787.pdf).
// [DRAW] measured on [ACAP] 2-6's three-view at 300 dpi, scaled by its own dimensions (24.6 px/m, the
// 5.94 m fuselage and the 25.83 m wheelbase agree); good to about ±0.1 m.

export const LENGTH = 62.81;           // [ACAP] 2-6, overall (to the stabiliser's tip)
export const FUSELAGE_LENGTH = 62.00;  // [ACAP] 2-6 (TCDS 62.0014)
export const SPAN = 60.12;             // [ACAP] 2-6 (TCDS 60.1218)
export const HEIGHT = 17.02;           // [ACAP] 2-6 (the clearance table's N: 16.81 to 17.09)
export const FUSELAGE_WIDTH = 5.77;    // [ACAP] 2-6
export const FUSELAGE_HEIGHT = 5.94;   // [ACAP] 2-6

// Where 25% MAC is: [ACAP] 7-7's percent-MAC scale puts 0% MAC at 86.6% of the weight on the main gear and
// 40% at 96.3%. The 9.7% between them is 2.51 m on the 25.83 m wheelbase, which is 0.40 × the TCDS's
// 6.27 m MAC, so the reading checks. The main gear is therefore 25.83 × (1 − 0.866) = 3.46 m aft of
// the MAC's leading edge, or 1.89 m aft of 25% MAC.
const MAIN_FROM_NOSE = 5.41 + 25.83;   // [ACAP] 2-6: nose gear 5.41 m from the nose, wheelbase 25.83 m
const MAIN_X = -1.89;
export const NOSE_X = MAIN_FROM_NOSE + MAIN_X; // nose tip, 29.35 m ahead of 25% MAC
export const TAIL_X = NOSE_X - LENGTH;         // the stabiliser's tip, −33.46
export const FUSELAGE_TAIL_X = NOSE_X - FUSELAGE_LENGTH; // tail cone tip, −32.65

export const WHEELBASE = 25.83;        // [ACAP] 2-6
export const TRACK = 9.80;             // [ACAP] 2-6, 7-4: strut centrelines

// The real aircraft stands 0.52° nose down at its taxi attitude ([ACAP] 4-6), and so does this one:
// the nose leg's point is that much higher in the body frame than the mains'.
export const TAXI_ATTITUDE_DEG = -0.52;
const SLOPE = Math.sin(0.52 * Math.PI / 180);

// Height of the fuselage centreline above the runway at 25% MAC, gear static. [ACAP] 2-9's D (fuselage
// underside at about 15 m from the nose, x ≈ 14.35) is 1.75 to 1.85 m, so the centreline is
// 1.80 + 5.94/2 = 4.77 m there, and at the attitude above 4.90 m at x = 0. A (the crown) is
// 7.42 to 7.82 m: 4.77 + 2.97 = 7.74 m agrees.
export const GROUND_Z = 4.90;
// The centreline's height above the runway at body x, at the taxi attitude.
const centrelineH = (x) => GROUND_Z - x * SLOPE;

// Gear contact points: tyre bottoms with the struts at static compression.
export const GEAR = {
  nose:  { x: MAIN_X + WHEELBASE, y: 0,          z: -centrelineH(MAIN_X + WHEELBASE) },
  left:  { x: MAIN_X,             y: TRACK / 2,  z: -centrelineH(MAIN_X) },
  right: { x: MAIN_X,             y: -TRACK / 2, z: -centrelineH(MAIN_X) },
};

// Wheels, for the model ([ACAP] 7-4). Main: 4 tyres per bogie, 54×21.0 R23. Nose: 2 tyres, 40×16.0 R16.
export const BOGIE = {
  axleSpacing: 1.51,     // fore and aft, 59.5 in
  tread: 1.52,           // across, 60 in
  noseTread: 0.72,       // 2 ft 5 in
  wheelRadiusMain: 54 * 0.0254 / 2, wheelWidthMain: 21 * 0.0254,
  wheelRadiusNose: 40 * 0.0254 / 2, wheelWidthNose: 16 * 0.0254,
  overallWidth: 11.9,    // outside to outside, 38 ft 11 in
};

// [ACAP] 4-3: turning at the maximum steering angle (radii from the turn centre, metres).
export const TURNING = { steerMaxDeg: 70, innerGear: 3.7, outerGear: 15.5, noseGear: 28.3, wingtip: 41.5, nose: 32.9, tail: 37.2 };

// The tail-strike point. [DRAW] the side view's underside, against the main wheels' contact point: the
// body line from the wheels first meets the ground at about 16.8 m aft of the mains (x = −18.7), 7.7°
// above the body datum: not at the tail, because the underside there curves up faster than the line.
// That is the limit with the struts compressed. At the speeds that matter the mains are unloaded
// (0.33 m of strut, GEAR_DATA) and the bogies tilt about their rear axles (rotation centre 0.76 m aft,
// 0.12 m higher), which gives 9.6°: the point is placed 0.24 m above the drawn skin so that the sim's
// single contact point (no tilting bogie) reaches the same 9.6° (PITCH_TAILSTRIKE_DEG).
export const TAIL_STRIKE_POINT = { x: -18.69, y: 0, z: -2.405 };

// Engines (GEnx-1B). The nacelle's lip is 20.80 m from the nose and 9.91 m off the centreline ([ACAP]
// 2-6). [DRAW] the cowl is 5.7 m from lip to chevrons (5.57 side, 5.82 top) and 3.8 m across at its widest
// (3.80 front, 3.82 side); the core's nozzle and plug run 2.2 m further. (The engine itself, [GENX] IM.E.102
// p.8: 4.95 m long, 3.53 m wide.)
export const NACELLE_DIAMETER = 3.8;
export const NACELLE_LENGTH = 5.7;
export const NACELLE_CORE_LENGTH = 2.2;
const NACELLE_X = NOSE_X - 20.80 - NACELLE_LENGTH / 2;  // the cowl's centre, 5.70
// Where the thrust acts in the sim. As in geometry.js, the sim's CG is on the centreline and the real one
// sits lower ([EST] about 0.5 m), so z is the thrust line's real offset below the real CG (centre
// −2.23 + 0.5), which is what makes the pitch moment from thrust right.
export const ENGINES = [
  { x: NACELLE_X, y: 9.91, z: -1.7 },   // engine 1, left
  { x: NACELLE_X, y: -9.91, z: -1.7 },  // engine 2, right
];
// Where the nacelles hang: [ACAP] 2-9's F (GE engines) puts the low point 0.69 to 0.76 m above the ground.
export const NACELLES = ENGINES.map((e) => ({ x: e.x, y: e.y, z: 0.72 + NACELLE_DIAMETER / 2 - centrelineH(e.x) })); // z −2.23

// Wing. [DRAW] the leading edge meets the fuselage's side (y = 2.885) 21.6 m from the nose and the
// trailing edge 33.7 m; the leading edge runs straight at 35.3°, to the tip [ACAP] 2-6 puts at 40.69 m
// (leading) and 43.36 m (the raked tip's point). The trailing edge kinks at y ≈ 9.8, 34.1 m from the nose.
// sweepDeg is the quarter chord's, 32.2° (public figure, see b787-9.js). dihedralDeg [DRAW] the front view,
// tip about 7.4 m above the ground, static.
export const WING = {
  rootX: NOSE_X - 21.6, rootChord: 12.1, tipChord: 43.36 - 40.69, dihedralDeg: 6, sweepDeg: 32.2,
  leSweepDeg: 35.3, kinkY: 9.8, kinkTeX: NOSE_X - 34.1, tipLeX: NOSE_X - 40.69, tipTeX: NOSE_X - 43.36, tipZ: 2.45,
};

// Tail. Span [ACAP] 2-6 (19.81 m). The rest [DRAW], as x from the nose converted to the body frame.
export const TAILPLANE = { span: 19.81, rootLeX: NOSE_X - 53.2, tipTeX: TAIL_X, z: 0.77 };
export const FIN = { rootLeX: NOSE_X - 49.25, rootTeX: NOSE_X - 58.0, topLeX: NOSE_X - 58.5, topTeX: NOSE_X - 61.77, topZ: HEIGHT - centrelineH(NOSE_X - 61.77) };

// Camera eye points. [ACAP] 4-6: the pilot's eye is 5.48 m above the ground at the taxi attitude, 2.64 m aft
// of the nose, 0.53 m off the centreline. With the centreline 4.66 m up there, that is z = +0.82.
const EYE_X = NOSE_X - 2.64;
const EYE_Z = 5.48 - centrelineH(EYE_X);
export const EYES = {
  nose:    { x: NOSE_X + 0.4, y: 0, z: -0.9 },  // 1st person: just ahead of the nose ([DRAW] the tip sits low)
  captain: { x: EYE_X, y: 0.53, z: EYE_Z },     // left seat
  fo:      { x: EYE_X, y: -0.53, z: EYE_Z },    // right seat
};

// The points that end the flight if they touch the ground (sim.js).
export const CRASH_POINTS = [
  { x: NOSE_X - 1.4, y: 0, z: -2.1, why: 'nose impact' },
  { x: -8, y: 0, z: -FUSELAGE_HEIGHT / 2, why: 'belly impact' },
  { x: TAIL_STRIKE_POINT.x, y: 0, z: TAIL_STRIKE_POINT.z, why: 'tail strike' },
  { x: NACELLES[0].x, y: NACELLES[0].y, z: NACELLES[0].z - NACELLE_DIAMETER / 2, why: 'engine strike' },
  { x: NACELLES[1].x, y: NACELLES[1].y, z: NACELLES[1].z - NACELLE_DIAMETER / 2, why: 'engine strike' },
  { x: WING.tipTeX, y: SPAN / 2, z: WING.tipZ, why: 'wingtip strike' },
  { x: WING.tipTeX, y: -SPAN / 2, z: WING.tipZ, why: 'wingtip strike' },
];
