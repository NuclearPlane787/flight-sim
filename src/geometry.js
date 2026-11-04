// Shared A321neo geometry, in the body frame used by the sim, the model and the cameras.
// Body frame: origin at the reference point (fuselage centreline, at the wing's 25% MAC),
// +x forward, +y left, +z up, metres. The sim's centre of gravity moves around this point.
// Overall dimensions are Airbus's published ones (length 44.51 m, span 35.80 m,
// height 11.76 m, fuselage width 3.95 m). Wheelbase 16.91 m and track 7.59 m are from
// Airbus's A321 Aircraft Characteristics. The rest are drawing estimates.

export const LENGTH = 44.51;
export const SPAN = 35.80;
export const HEIGHT = 11.76;
export const FUSELAGE_WIDTH = 3.95;
export const FUSELAGE_HEIGHT = 4.14;

export const NOSE_X = 21.0;            // nose tip
export const TAIL_X = NOSE_X - LENGTH; // tail cone tip, -23.51

export const WHEELBASE = 16.91;
export const TRACK = 7.59;

// Gear contact points: tyre bottoms with the struts at static compression.
// On the ground with the gear static, the fuselage centreline is GROUND_Z above the runway.
export const GROUND_Z = 3.9;
export const GEAR = {
  nose:  { x: -1.2 + WHEELBASE, y: 0,          z: -GROUND_Z },
  left:  { x: -1.2,             y: TRACK / 2,  z: -GROUND_Z },
  right: { x: -1.2,             y: -TRACK / 2, z: -GROUND_Z },
};

// The tail's underside, for tail-strike detection: with the main gear it gives the A321's
// tail-strike pitch, about 9.7° with the struts compressed and 11.2° extended.
export const TAIL_STRIKE_POINT = { x: -17.5, y: 0, z: -1.1 };

// Engines (LEAP-1A): where the sim's thrust acts. With the sim's centre of gravity on the
// fuselage centreline, 1.75 m below it is about the real thrust line's offset below the real
// CG (which sits lower), so the pitch moment from thrust is right.
export const ENGINES = [
  { x: 3.6, y: 5.75, z: -1.75 },  // engine 1, left
  { x: 3.6, y: -5.75, z: -1.75 }, // engine 2, right
];
export const NACELLE_DIAMETER = 2.4;
export const NACELLE_LENGTH = 5.0;
// Where the nacelles hang (aircraft.js draws them there, and sim.js checks engine strikes
// against their low points): Airbus's A321 AC (2-3-0, Ground Clearances) puts the LEAP-1A
// nacelle's low point 0.45 m above the ground at the maximum ramp weight. Clearly below the
// wing, with the pylon showing (v0.1.2; they used to sit at ENGINES, up against the wing).
export const NACELLES = ENGINES.map((e) => ({ x: e.x, y: e.y, z: 0.45 + NACELLE_DIAMETER / 2 - GROUND_Z }));

// Wing: root and tip leading edges, sweep 25° at the quarter chord.
export const WING = { rootX: 4.6, rootChord: 6.1, tipChord: 1.6, dihedralDeg: 5.1, sweepDeg: 25 };

// Camera eye points.
export const EYES = {
  nose:    { x: NOSE_X + 0.3, y: 0, z: -0.2 },  // 1st person: just ahead of the nose
  captain: { x: 18.35, y: 0.53, z: 0.95 },      // left seat
  fo:      { x: 18.35, y: -0.53, z: 0.95 },     // right seat
};

// The points that end the flight if they touch the ground (sim.js; v0.3.0: per type).
export const CRASH_POINTS = [
  { x: 19.6, y: 0, z: -1.7, why: 'nose impact' },
  { x: -4, y: 0, z: -2.05, why: 'belly impact' },
  { x: TAIL_STRIKE_POINT.x, y: 0, z: TAIL_STRIKE_POINT.z, why: 'tail strike' },
  { x: NACELLES[0].x, y: NACELLES[0].y, z: NACELLES[0].z - NACELLE_DIAMETER / 2, why: 'engine strike' },
  { x: NACELLES[1].x, y: NACELLES[1].y, z: NACELLES[1].z - NACELLE_DIAMETER / 2, why: 'engine strike' },
  { x: -4.6, y: 17.9, z: 0.6, why: 'wingtip strike' },
  { x: -4.6, y: -17.9, z: 0.6, why: 'wingtip strike' },
];
