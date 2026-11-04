// Boeing 777-300ER geometry, in the body frame used by the sim, the model and the cameras (geometry.js's
// frame and names): origin on the fuselage centreline at 25% MAC, +x forward, +y left, +z up, metres.
//
// Sources: [ACAP] Boeing D6-58329-2 Rev G, December 2024 (reference/docs/boeing-acap-777-300er.pdf), page numbers
// are the document's own (2-4 is PDF p.18, 2-7 PDF p.21, 4-4 PDF p.79, 4-6 PDF p.81, 7-5 PDF p.137, 7-8 PDF p.140).
// [TCDS] EASA.IM.A.003 Issue 20 §4 (reference/docs/easa-tcds-im-a-003-777.pdf).
// [ARC] Boeing's approach-speed article (reference/docs/boeing-arc-approach-speeds.pdf).
// [DRAW] measured on [ACAP] 2-4's three-view, scaled by its own dimensions; good to about ±0.15 m.

export const LENGTH = 73.86;           // [ACAP] 2-4, overall (to the stabiliser's tip); [ARC] 73.86
export const FUSELAGE_LENGTH = 73.08;  // [ACAP] 2-4
export const SPAN = 64.80;             // [ACAP] 2-4; [TCDS] p.25 64.8
export const HEIGHT = 18.55;           // [ACAP] 2-7's K, the middle of 18.24 to 18.85 ([TCDS] p.25 18.5)
export const FUSELAGE_WIDTH = 6.20;    // [ACAP] 2-4
export const FUSELAGE_HEIGHT = 6.20;   // [ACAP] 2-4

// Where 25% MAC is: [ACAP] 7-8's percent-MAC scale puts 0% MAC at 86.16% of the weight on the main gear, 25% at 91.85%
// and 40% at 95.27%. The 9.11% between 0 and 40 is 2.84 m on the 31.22 m wheelbase, which is 0.40 × 7.11 m against
// the TCDS's 7.08 m MAC, so the reading checks. The bogies' centres are therefore 31.22 × (1 − 0.9185) = 2.55 m aft of 25% MAC.
const MAIN_FROM_NOSE = 5.89 + 31.22;   // [ACAP] 2-4: nose gear 5.89 m from the nose, wheelbase 31.22 m to the bogie's centre
const MAIN_X = -2.55;
export const NOSE_X = MAIN_FROM_NOSE + MAIN_X; // nose tip, 34.56 m ahead of 25% MAC
export const TAIL_X = NOSE_X - LENGTH;         // the stabiliser's tip, −39.30
export const FUSELAGE_TAIL_X = NOSE_X - FUSELAGE_LENGTH; // tail cone tip, −38.52

export const WHEELBASE = 31.22;        // [ACAP] 2-4, 7-5
export const TRACK = 10.97;            // [ACAP] 2-4, 7-5: strut centrelines

// [ACAP] gives no taxi attitude for this model. The door sills in 2-7 do: door 1 (B) 4.80 to 5.13, door 5 (J) 5.19 to
// 5.66, so the middles rise 0.46 m over the 54 m between them: 0.49° nose down, the same as the 787-9's stated −0.52°.
export const TAXI_ATTITUDE_DEG = -0.49;
const SLOPE = Math.sin(0.49 * Math.PI / 180);

// Height of the fuselage centreline above the runway at 25% MAC, gear static. [ACAP] 2-7's A (the crown, drawn about
// 10 m from the nose, x ≈ 24.6) is 8.46 to 8.78 m, so the centreline is 8.62 − 3.10 = 5.52 m there, and at the attitude
// above 5.73 m at x = 0. Checks: E, the nacelle's low point, and the eye (below).
export const GROUND_Z = 5.73;
// The centreline's height above the runway at body x, at the taxi attitude.
const centrelineH = (x) => GROUND_Z - x * SLOPE;

// Gear contact points: tyre bottoms with the struts at static compression. The real main gear is a 6-wheel bogie on a
// semi-levered strut; the sim has one contact per leg, at the bogie's centre (see TAIL_STRIKE_POINT for what that changes).
export const GEAR = {
  nose:  { x: MAIN_X + WHEELBASE, y: 0,          z: -centrelineH(MAIN_X + WHEELBASE) },
  left:  { x: MAIN_X,             y: TRACK / 2,  z: -centrelineH(MAIN_X) },
  right: { x: MAIN_X,             y: -TRACK / 2, z: -centrelineH(MAIN_X) },
};

// Wheels, for the model ([ACAP] 7-5). Main: 6 tyres per bogie, 52×21.0 R22, 3 axles. Nose: 2 tyres, 43×17.5 R17.
// Same names as the 787's, plus `axles` and the aft pair's own spacing (57.2 in forward, 58.0 in aft).
export const BOGIE = {
  axles: 3,
  axleSpacing: 1.45,     // fore and aft, 57.2 in (forward axle to centre)
  axleSpacingAft: 1.48,  // 58.0 in (centre to the aft, steering axle)
  tread: 1.40,           // across, 55 in
  noseTread: 0.78,       // 30.8 in
  wheelRadiusMain: 52 * 0.0254 / 2, wheelWidthMain: 21 * 0.0254,
  wheelRadiusNose: 43 * 0.0254 / 2, wheelWidthNose: 17.5 * 0.0254,
  overallWidth: 12.90,   // outside to outside of the tyre centres, 42 ft 4 in ([ACAP] 7-5)
};

// [ACAP] 4-4: turning at the maximum steering angle with aft axle steering (radii from the turn centre, metres).
export const TURNING = { steerMaxDeg: 70, innerGear: 4.7, outerGear: 17.6, noseGear: 33.7, wingtip: 45.2, nose: 38.0, tail: 42.8 };

// The tail-strike point. [DRAW] [ACAP] 2-7's side view: the belly starts to rise about 54 m from the nose, then at 12.7° to the tail. The line from the main wheels first
// meets that underside about 20 m aft of the bogie's centre (57 m from the nose, x = −22.44), 7.6° above the body datum with the struts compressed; unloaded (0.33 m of strut) and
// pivoting on the aft axle, 1.48 m further back, about 9.2°: that's the -300's bare geometry, and a study deck's figure for the -300 is 8.9°. The -300ER's semi-levered gear
// holds the forward end of the bogie down at rotation so that the strut lifts the body further; the same deck says 10.0° for it ([FORUM], not a document). The sim has one contact
// per leg at the bogie's centre, with no lever and no tilt. So the lever is modelled only here: the point sits 0.225 m above the drawn skin (z −2.80 there), as the 787-9's does
// for its tilting bogie, so that the single contact reaches 10.0° (PITCH_TAILSTRIKE_DEG), unloaded.
export const TAIL_STRIKE_POINT = { x: -22.44, y: 0, z: -2.575 };

// Engines (GE90-115B). The nacelle's lip is 25.76 m from the nose and 9.61 m off the centreline ([ACAP] 2-4), and 3.96 m
// across (13 ft 0 in, [ACAP] 2-4). [DRAW] the cowl runs 5.4 m from the lip, the core's nozzle and plug 2.5 m further
// (the engine itself, [GE90] IM.E.002: 7.28 m long, 3.77 m wide, 3.93 m high).
export const NACELLE_DIAMETER = 3.96;
export const NACELLE_LENGTH = 5.4;
export const NACELLE_CORE_LENGTH = 2.5;
const NACELLE_X = NOSE_X - 25.76 - NACELLE_LENGTH / 2;  // the cowl's centre, 6.10
// Where the thrust acts in the sim. As in geometry.js, the sim's CG is on the centreline and the real one sits lower
// ([EST] about 0.5 m), so z is the thrust line's real offset below the real CG (centre −2.85 + 0.5).
export const ENGINES = [
  { x: NACELLE_X, y: 9.61, z: -2.35 },   // engine 1, left
  { x: NACELLE_X, y: -9.61, z: -2.35 },  // engine 2, right
];
// Where the nacelles hang: [ACAP] 2-7's E puts the low point 0.73 to 0.99 m above the ground.
export const NACELLES = ENGINES.map((e) => ({ x: e.x, y: e.y, z: 0.86 + NACELLE_DIAMETER / 2 - centrelineH(e.x) }));

// Wing. [ACAP] 2-4: the leading edge meets the fuselage's side (y = 3.10) 26.89 m from the nose; the raked tip's leading
// edge ends 48.50 m and its point 49.11 m from the nose. [DRAW] the trailing edge meets the fuselage at 40.0 m and kinks at
// y ≈ 11.5, 40.4 m from the nose; the leading edge runs straight at 34.4°. dihedralDeg [DRAW] the front view; tipZ from
// [ACAP] 2-7's L, wingtip 7.29 to 7.90 m (middle 7.60) at x ≈ −14.6.
export const WING = {
  rootX: NOSE_X - 26.89, rootChord: 13.1, tipChord: 49.11 - 48.50, dihedralDeg: 6, sweepDeg: 31.64,
  leSweepDeg: 34.4, kinkY: 11.5, kinkTeX: NOSE_X - 40.4, tipLeX: NOSE_X - 48.50, tipTeX: NOSE_X - 49.11, tipZ: 7.60 - centrelineH(NOSE_X - 49.11),
};

// Tail. Span [ACAP] 2-4 (21.53 m). The rest [DRAW], as x from the nose converted to the body frame.
export const TAILPLANE = { span: 21.53, rootLeX: NOSE_X - 64.4, tipTeX: TAIL_X, z: 0.75 };
export const FIN = { rootLeX: NOSE_X - 61.6, rootTeX: NOSE_X - 69.3, topLeX: NOSE_X - 70.7, topTeX: NOSE_X - 73.3, topZ: HEIGHT - centrelineH(NOSE_X - 73.3) };

// Camera eye points. [ACAP] 4-6: 3.63 m ahead of the nose gear (so 5.89 − 3.63 = 2.26 m aft of the nose) and 0.53 m off the centreline.
// The height is NOT the figure the document states. [ACAP] 4-6 states 18 ft 1 in (5.51 m) ±1 ft, and that conflicts with the same document's drawings:
//   - 4-6's own 21° down to an intercept 15.4 m ahead implies 5.91 m (5.51 m would be 19.7°); the page is marked NOT TO SCALE, and its drawing shows about 6.2 m;
//   - 2-4's side view (measured, 69.9 px/m) has the side windows +0.37 to +0.99 m from the centreline, the middle +0.69, and 2-7's agrees. 5.51 m puts the eye at +0.06,
//     0.31 m below every window's sill; even the top of ±1 ft (5.81 m, +0.36) only reaches the sill;
//   - static height and attitude don't explain it: 2-4 has door 1's sill 0.51 m below the centreline, and 2-7's B (middle 4.965 m) then gives a centreline of
//     5.48 m there, against 5.49 m from GROUND_Z and the attitude. The whole range of stance in 2-7 is only ±0.16 m.
// So [EST] 6.25 m (z ≈ +0.80), ±0.05 m at best: the cockpit job's fit, casting 4-6's four angles (21° and 32° ahead, 27° and 31° abeam) from the eye onto the model's nose and
// comparing with where 2-4 draws each window edge (RMS 0.107 m; 0.73 m at 5.51 m; 0.22 m at 6.10 m). It's inside my own reading of the windows, 0.11 m above their middle.
// It depends on the model's nose table, and no single height satisfies all of 4-6: 6.25 m at 21° is a 16.3 m intercept, not 15.4 m.
const EYE_X = NOSE_X - 2.26;
const EYE_Z = 6.25 - centrelineH(EYE_X);
export const EYES = {
  nose:    { x: NOSE_X + 0.4, y: 0, z: -0.9 },  // 1st person: just ahead of the nose ([DRAW] the tip sits low)
  captain: { x: EYE_X, y: 0.53, z: EYE_Z },     // left seat
  fo:      { x: EYE_X, y: -0.53, z: EYE_Z },    // right seat
};

// The points that end the flight if they touch the ground (sim.js).
export const CRASH_POINTS = [
  { x: NOSE_X - 1.4, y: 0, z: -2.2, why: 'nose impact' },
  { x: -8, y: 0, z: -FUSELAGE_HEIGHT / 2, why: 'belly impact' },
  { x: TAIL_STRIKE_POINT.x, y: 0, z: TAIL_STRIKE_POINT.z, why: 'tail strike' },
  { x: NACELLES[0].x, y: NACELLES[0].y, z: NACELLES[0].z - NACELLE_DIAMETER / 2, why: 'engine strike' },
  { x: NACELLES[1].x, y: NACELLES[1].y, z: NACELLES[1].z - NACELLE_DIAMETER / 2, why: 'engine strike' },
  { x: WING.tipTeX, y: SPAN / 2, z: WING.tipZ, why: 'wingtip strike' },
  { x: WING.tipTeX, y: -SPAN / 2, z: WING.tipZ, why: 'wingtip strike' },
];
