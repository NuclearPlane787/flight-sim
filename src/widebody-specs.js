// The widebodies' exterior specs: what src/widebody.js needs and the geometry module doesn't have.
// Every overall dimension (length, span, gear, engines, eyes…) is read from the type's geometry
// module; only the shapes are here. The 777-300ER's sources are at its entry below.
// [ACAP] = measured off Boeing's D6-58333 Rev Q: the 787-9's
// general-dimensions drawing (§2.2.2, p. 2-6), read from a 400 dpi render, about ±0.1 m; door
// locations §2.7.1; the pilot's vision §4.4.1. [EST] = not in the document, with why.
// Pure data: node tests can read it too. Stations are metres aft of the nose tip ("d") unless they
// say otherwise.

import * as G from './geometry-b787-9.js';
import * as data from './sim/b787-9.js';
import * as G777 from './geometry-b777-300er.js';
import * as data777 from './sim/b777-300er.js';
import { TYPES } from './sim/types.js';

const N = G.NOSE_X, W = G.WING, DEG = Math.PI / 180;
const ys = G.FUSELAGE_WIDTH / 2, tipY = G.SPAN / 2;
const leStraight = (y) => W.rootX - (y - ys) * Math.tan(W.leSweepDeg * DEG);

export const B787_9 = {
  id: 'b787-9', name: '787-9', geo: G, data,
  registration: 'HL7879',
  ref: { fuselageLength: 62.0, fuselageWidth: 5.77, fuselageHeight: 5.94 }, // what the tables were measured at

  fuselage: {
    noseD: 12,        // d up to here keeps true metres; aft of it, tables stretch with the fuselage
    // [ACAP] The 787's nose has no windshield step: one long curve from the crown to a low tip.
    top: [
      [0, -1.12], [0.12, -0.72], [0.45, -0.28], [1.15, 0.30], [1.8, 0.84], [2.53, 1.38], [3.45, 1.92], [4.6, 2.31],
      [5.74, 2.57], [7.27, 2.80], [8.65, 2.92], [9.9, 2.97], [47, 2.97], [50, 2.88], [53, 2.6], [58.07, 1.93], [59.2, 1.64],
      [62.0, 1.06],
    ],
    bottom: [
      [0, -1.12], [0.08, -1.5], [0.54, -1.98], [1.38, -2.24], [2.68, -2.51], [4.13, -2.74], [5.6, -2.86], [7.2, -2.97],
      [44, -2.97], [46, -2.9], [48, -2.65], [50.5, -2.19], [55.3, -1.14], [58.5, -0.33], [62.0, 0.53],
    ],
    halfWidth: [
      [0, 0], [0.08, 0.33], [0.42, 0.73], [1.1, 1.14], [2.4, 1.76], [4.5, 2.32], [6.8, 2.70], [9.06, 2.86], [11, 2.885],
      [44, 2.885], [46, 2.84], [47.98, 2.75], [50.2, 2.46], [52.4, 2.14], [53.9, 1.91], [57.3, 1.28], [59.3, 0.82],
      [61.6, 0.23], [62.0, 0.13],
    ],
  },

  // The cockpit's windows are in src/cockpit-windows-boeing.js, shared with the cockpit's shell.

  // Cabin: [ACAP §2.7.1] doors, the rest [ACAP] the side view. 787 windows are the big ones.
  cabin: {
    doors: [6.30, 18.36, 35.43, 49.66], doorW: 1.18, doorH: 1.96, doorZ: 0.57,
    window: { z: 0.75, w: 0.34, h: 0.54, pitch: 0.61, first: 7.95, last: 48.6 },
    cargoRight: [11.0, 43.31], bulkLeft: 47.75, cargoW: 2.7, cargoH: 1.75, cargoZ: -1.45, bulkW: 1.1, bulkH: 1.1, bulkZ: -1.2,
  },

  wing: {
    // Chord line's height at the fuselage side: [ACAP] the front view (upper surface −0.42, lower −2.1).
    z0: -1.25,
    // Planform: the leading edge runs straight at geometry's sweep, then curves back into the rake
    // ([ACAP] top view); the trailing edge has its kink at y = WING.kinkY and sweeps gently.
    le: [
      [0.3, W.rootX + (ys - 0.3) * Math.tan(W.leSweepDeg * DEG)], [ys, W.rootX], [15, leStraight(15)], [26, leStraight(26)],
      [27.5, N - 39.1], [28.93, N - 40.49], [29.6, N - 41.7], [tipY, W.tipTeX + 0.25],
    ],
    te: [
      [0.3, W.rootX - W.rootChord], [ys, W.rootX - W.rootChord], [5, N - 33.72], [7.55, N - 33.85], [W.kinkY, W.kinkTeX], [12.1, N - 34.55],
      [14.83, N - 35.45], [18.77, N - 37.0], [22.57, N - 38.67], [26.8, N - 40.65], [28.33, N - 41.4], [29.6, N - 42.6], [tipY, W.tipTeX],
    ],
    t: [[0.3, 0.145], [ys, 0.14], [W.kinkY, 0.115], [18, 0.1], [tipY, 0.08]], // [EST] thin outer wing, composite
    stations: [ys, 5, 7.55, W.kinkY, 12.1, 14.83, 18.77, 22.57, 25.8, 26.8, 27.9, 28.9, 29.5, tipY],
    hingeF: 0.70, leF: 0.12,
    // Surfaces, as spans (m from the centre line). [EST] proportions from the top view and photographs:
    // flaperon behind the engine, an all-speed outboard aileron, the flap fairings at their drawn spans.
    flapIn: [3.0, 9.6], flaperon: [9.7, 12.6], flapOut: [12.7, 21.0], aileron: [21.1, 25.8],
    canoes: [[8.9, 'flapIn'], [14.7, 'flapOut'], [19.1, 'flapOut']],  // [ACAP] the top view
    // Seven spoilers a side, the 787's; the sim's five values map onto them.
    spoilers: [[3.6, 5.1, 0], [5.2, 6.7, 0], [6.8, 8.3, 1], [8.4, 9.6, 1], [12.7, 14.7, 2], [14.8, 16.8, 3], [16.9, 19.0, 4]],
    slatSegments: [[3.5, 8.5], [11.4, 14.2], [14.26, 17.0], [17.06, 19.8], [19.86, 22.6], [22.66, 25.4]],
    // Flap travel (m, at full flap): v0.3.1 cut it from 1.7 and 1.25 so the spoilers, which overhang the
    // flaps by the travel less a slot, cover it without growing past a believable width.
    flapTravel: { in: 1.3, out: 1.0 }, slatTravel: 0.55,
    landingLightY: 4.6, landingLightF: 0.1,
  },

  // GEnx-1B: 18 blades [GENX public], a fan of 2.82 m [GENX], chevrons on the fan nozzle only.
  // Radii are fractions of NACELLE_DIAMETER / 2, stations fractions of NACELLE_LENGTH / 2 from its centre. [ACAP]
  engine: { fanBlades: 18, fanR: 1.41, chevrons: 14, chevronDepth: 0.36, revTravel: 0.85 },

  tailplane: {
    leSweepDeg: 40.8, rootY: 1.1, dihedralDeg: 7, // [ACAP] the top view, the side view
    te: [[0.2, N - 59.2], [1.4, N - 59.3], [3.03, N - 59.87], [8, G.TAIL_X + 1.0], [G.TAILPLANE.span / 2, G.TAIL_X]],
    leTip: [[9.0, 0], [9.56, 0.1], [G.TAILPLANE.span / 2, 0.55]],
    pivotD: 57.2, hingeF: 0.7, elevator: [2.0, 9.25],
  },

  // The fin's straight leading edge (45°, [ACAP] the side view) and its dorsal fillet.
  fin: {
    leTable: [[1.7, N - 49.25], [2.98, N - 51.0], [10.93, N - 58.93], [11.25, N - 59.45], [11.5, N - 60.2], [11.72, N - 61.0], [G.FIN.topZ, G.FIN.topTeX + 0.6]],
    zStations: [1.7, 2.98, 5, 7.5, 9.5, 10.93, 11.25, 11.5, 11.72, G.FIN.topZ],
    teRootZ: 1.93,
    filletLe: [[2.75, N - 49.1], [2.98, N - 49.6], [3.46, N - 51.08], [4.42, N - 52.2], [5.38, N - 53.4]],
    hingeF: 0.7, rudder: [2.45, 11.0],
    box: { pad: 0.3 },
  },

  gear: {
    mainPivotZ: -1.25, nosePivotZ: -1.9, tiltDeg: 13,  // [EST] bogies hang front-up, rear axle first
    noseDoor: [3.25, 5.75], mainDoorLen: 3.3,
  },

  // Belly fairing: [ACAP] the side and front views. x stations d, half-width m.
  fairing: {
    zc: -1.7, up: 1.9,
    hw: [[16.5, 0.4], [19, 2.2], [23, 3.0], [28, 3.35], [33, 3.35], [37, 2.85], [40, 1.9], [42.5, 0.5]],
    bot: [[16.5, -2.9], [19, -2.99], [23, -3.05], [31, -3.08], [37, -3.04], [40, -2.98], [42.5, -2.9]],
  },

  livery: {
    chinStartD: 7, chinEndD: 2.8, bellyStartD: 44.5, bellyEndD: 57, titleD: 12.6, titleTheta: 52, titleFontCm: 160, regD: 45, regTheta: 30,
    regFontCm: 62, atomCentreD: 57.15, atomZ: 6.6, atomR: 2.3,
  },

  splitBehindEye: 1.85, // the nose bone (hidden in the seat views) starts this far aft of the eye
};

// ---- The 777-300ER ----------------------------------------------------------------------------
// [ACAP] = measured off Boeing's D6-58329-2 Rev G: the 777-300ER's general-dimensions drawing (§2.2.2,
// p. 2-4), its ink traced from a 600 dpi render at 35.07 px/m (the 73.86 m and the 64.80 m agree), about
// ±0.05 m on a heavy line. Tables are the line's centre, in metres aft of the nose tip.
// [PUB] = a public figure. [EST] = not in the document, with why.
const N7 = G777.NOSE_X, W7 = G777.WING, ys7 = G777.FUSELAGE_WIDTH / 2, tip7 = G777.SPAN / 2;
const tan7 = Math.tan(W7.leSweepDeg * DEG);
const le7 = (y) => W7.rootX - (y - ys7) * tan7;
// The drawing stands the fin 12.82 m over the centre line; the module's top comes from the clearance
// table's middle. The fin's heights are drawn fractions of whatever the module says.
const FZ7 = G777.FIN.topZ / 12.82;

export const B777_300ER = {
  id: 'b777-300er', name: '777-300ER', geo: G777, data: data777,
  registration: TYPES['b777-300er'].registration,
  ref: { fuselageLength: 73.08, fuselageWidth: 6.20, fuselageHeight: 6.20 },

  fuselage: {
    noseD: 12,
    tailConeD: 54,    // where the crown or the belly first leaves the cabin's circle
    midD: [44, 32, 20, 12, 10, 9.4, 8.8, 8.2, 7.6, 7, 6.4, 5.8, 5.2, 4.7],  // the loft's rows from there to the nose's split, aft to forward
    tailCapR: 0.05,   // the cone ends in the 777's vertical blade: no round end to cap
    // [ACAP] A rounder, blunter nose than the 787's: the tip low at z −0.62 with almost a flat face. The
    // nose (to d = 9.5) is a smooth polynomial in √d fitted to the traced ink (rms 2 to 3 cm), because a
    // table of raw readings dents the shading. Then a true circle, 6.20 m.
    top: [
      [0, -0.620], [0.01, -0.477], [0.03, -0.396], [0.06, -0.329], [0.1, -0.270], [0.16, -0.205],
      [0.25, -0.124], [0.35, -0.043], [0.5, 0.075], [0.7, 0.235], [0.95, 0.436], [1.25, 0.674], [1.6, 0.938],
      [2, 1.215], [2.5, 1.517], [3, 1.770], [3.5, 1.980], [4, 2.152], [4.75, 2.358], [5.5, 2.525],
      [6.25, 2.670], [7, 2.806], [7.75, 2.931],
      [8.5, 3.035], [9.5, 3.100], [58, 3.1], [60, 3.05], [62, 2.98], [63, 2.92], [64, 2.8],
      [66, 2.53], [68, 2.38], [69, 2.2], [70, 2.06], [71, 2.05], [72, 2.14], [73.08, 2.0],
    ],
    bottom: [
      [0, -0.620], [0.01, -0.680], [0.03, -0.741], [0.06, -0.810], [0.1, -0.883], [0.16, -0.973],
      [0.25, -1.082], [0.35, -1.180], [0.5, -1.300], [0.7, -1.428], [0.95, -1.559], [1.25, -1.691],
      [1.6, -1.825], [2, -1.964], [2.5, -2.123], [3, -2.271], [3.5, -2.408], [4, -2.534], [4.75, -2.700],
      [5.5, -2.836], [6.25, -2.942], [7, -3.017], [7.75, -3.065],
      [8.5, -3.091], [9.5, -3.100], [54, -3.1], [55, -3.07], [56, -3.02], [57, -2.87],
      [58, -2.73], [59, -2.53], [60, -2.3], [61, -2.08], [62, -1.85], [63, -1.65], [64, -1.42], [65, -1.19], [66, -0.96],
      [67, -0.74], [68, -0.51], [69, -0.31], [70, -0.08], [71, 0.15], [72, 0.38], [73.08, 0.58],
    ],
    halfWidth: [
      [0, 0.000], [0.01, 0.037], [0.03, 0.085], [0.06, 0.143], [0.1, 0.209], [0.16, 0.292], [0.25, 0.397],
      [0.35, 0.495], [0.5, 0.622], [0.7, 0.764], [0.95, 0.918], [1.25, 1.081], [1.6, 1.253], [2, 1.431],
      [2.5, 1.634], [3, 1.819], [3.5, 1.988], [4, 2.143], [4.75, 2.352], [5.5, 2.537], [6.25, 2.701],
      [7, 2.844], [7.75, 2.963],
      [8.5, 3.050], [9.5, 3.100], [56, 3.1], [58, 2.97],
      [60, 2.77], [62, 2.48], [63, 2.28], [64, 2.03], [65, 1.76], [66, 1.46], [67, 1.33], [68, 1.28],
      [69, 1.12], [70, 0.87],
      [71, 0.62], [72, 0.36], [73, 0.06], [73.08, 0.03],
    ],
  },

  // The cockpit's windows are in src/cockpit-windows-boeing.js.

  // Cabin: five door pairs, [ACAP] the side view, 1.06 × 1.88 m. The windows' row and pitch [ACAP]; their
  // size [PUB] about 25 × 38 cm (the drawing's are symbolic and bigger), so much smaller than the 787's.
  cabin: {
    doors: [6.79, 17.12, 32.89, 46.35, 59.67], doorW: 1.06, doorH: 1.88, doorZ: 0.39,
    window: { z: 0.43, w: 0.25, h: 0.38, pitch: 0.555, first: 8.1, last: 59 },
    cargoRight: [11.8, 51.5], bulkLeft: 56.7, bulkSide: -1, cargoW: 2.7, cargoH: 1.75, cargoZ: -1.6, bulkW: 1.0, bulkH: 1.1, bulkZ: -1.35,
  },

  wing: {
    z0: -1.7,
    // [ACAP] the front view: a nearly straight wing, steeper inboard where the root's depth comes down
    // to the outer panel's, with none of the 787's upward sweep at the tip. The chord plane by span:
    zTable: [[0.3, -2.1], [ys7, -1.68], [8, -0.92], [13, -0.14], [22, 0.79], [tip7, W7.tipZ]],
    // Planform [ACAP] the top view. The leading edge is straight to the rake; the rake is sharp.
    le: [
      [0.3, W7.rootX + (ys7 - 0.3) * tan7], [ys7, W7.rootX], [15, le7(15)], [28, le7(28)], [30.9, le7(30.9)],
      [31.35, N7 - 46.45], [31.9, N7 - 47.45], [tip7, W7.tipLeX],
    ],
    te: [
      [0.3, W7.rootX - W7.rootChord], [ys7, W7.rootX - W7.rootChord], [8.9, N7 - 40.0], [W7.kinkY, W7.kinkTeX], [15, N7 - 41.75],
      [20, N7 - 43.45], [25, N7 - 45.15], [29.8, N7 - 46.8], [31, N7 - 47.87], [tip7, W7.tipTeX],
    ],
    // Depth [ACAP] the front view: about 2.0 m at the side of the body, 0.73 m at y = 13.
    t: [[0.3, 0.155], [ys7, 0.15], [W7.kinkY, 0.1], [18, 0.095], [tip7, 0.075]],
    stations: [ys7, 5, 8, W7.kinkY, 14, 18, 22, 25, 28, 29.8, 30.9, 31.35, 31.9, tip7],
    hingeF: 0.72, leF: 0.13, spoilerF: 0.59,
    // The drawn surfaces [ACAP]: flaps and flaperon meet behind the engine; the outer spoiler block runs
    // y = 12.1 to 21.2, the aileron 23.3 to 29.6.
    flapIn: [3.2, 10.1], flaperon: [10.2, 12.3], flapOut: [12.4, 23.0], aileron: [23.1, 29.6],
    canoes: [[8.85, 'flapIn'], [14.15, 'flapOut'], [19.25, 'flapOut']],  // [ACAP] the top view's three fairings
    // Seven spoilers a side [ACAP]: two inboard of the engine, five outboard; the sim gives five values.
    spoilers: [[4.0, 6.2, 0], [6.3, 8.7, 1], [12.4, 14.2, 2], [14.3, 16.2, 2], [16.3, 18.2, 3], [18.3, 20.0, 3], [20.1, 21.9, 4]],
    slatSegments: [[3.8, 8.4], [10.4, 13.9], [13.95, 17.4], [17.45, 20.6], [20.65, 23.9], [23.95, 27.4], [27.45, 30.9]],
    // Flap travel (m): cut from 1.9 and 1.45 in v0.3.1, as the 787's.
    flapTravel: { in: 1.5, out: 1.1 }, slatTravel: 0.6,
    landingLightY: 5.0, landingLightF: 0.1,
    // [EST] The sim's detents (5, 15, 20, 25, 30) run out along the tracks by 20 and then rotate. The inboard
    // flap is double-slotted [PUB]: the aft flap (the last 13% of chord here) opens past flaps 15; the
    // outboard one is single-slotted, one surface. The flaperon droops at about half the flap's angle.
    flapInAftF: 0.87, flapInAft: { fromDeg: 15, toDeg: 30, deg: 14, slide: 0.16 },
    flaperonDroop: [0.6, 30], slatOutDeg: 30,
  },

  // GE90-115B: 22 swept composite blades, a 3.25 m fan [PUB, as src/audio/engine-sounds.js]; no chevrons. The
  // biggest thing on the aircraft: a fat barrel, a blunt lip, a short afterbody. Fractions as the 787's, from
  // [ACAP] the side and front views (the rings at r = 1.52 and 1.70 m in the front view are the throat and
  // the lip's crest). The core's cowl shows far more than the GEnx's: 1.35 m radius at the fan nozzle.
  engine: {
    fanBlades: 22, fanR: 3.25 / 2, chevrons: 0, chevronDepth: 0, revTravel: 0.95,
    fanF: 0.58, spinnerK: 1.3, swirl: true, coreR: 1.48, pylonDepth: 0.62,
    intake: [
      [0.55, 0.835, 0], [0.72, 0.815, 0.1], [0.9, 0.815, 0.22], [0.97, 0.85, 0.3], [1.0, 0.89, 0.36], [1.0, 0.925, 0.42],
      [0.975, 0.955, 0.48], [0.93, 0.97, 0.55], [0.80, 0.99, 0.6], [0.55, 1.0, 0.68], [0.2, 0.995, 0.8], [-0.04, 0.975, 1],
    ],
    sleeve: [
      [-0.04, 0.975, 0], [-0.4, 0.95, 0], [-0.72, 0.9, 0.1], [-0.88, 0.86, 0.55], [-1.0, 0.82, 1],
      [-0.995, 0.81, 1], [-0.86, 0.83, 0.5], [-0.5, 0.87, 0], [-0.04, 0.89, 0],
    ],
  },

  tailplane: {
    // [ACAP] the top view: the leading edge at 40.8° leaves the body at y = 2.3, the tip rounds off from y = 9.6.
    leSweepDeg: 40.8, rootY: 2.3, dihedralDeg: 7, t: 0.095,
    te: [[0.2, N7 - 69.8], [0.9, N7 - 70.0], [3, N7 - 71.15], [6, N7 - 72.1], [9, N7 - 73.1], [G777.TAILPLANE.span / 2, G777.TAIL_X]],
    leTip: [[9.6, 0], [10.2, 0.18], [G777.TAILPLANE.span / 2, 0.75]],
    stations: [0.2, 1.4, 3, 5.5, 8, 9.6, 10.2, G777.TAILPLANE.span / 2],
    pivotD: 68, hingeF: 0.7, elevator: [1.6, 10.2],
  },

  // [ACAP] the side view: a tall fin, 46° on its leading edge, its top rounding over; the rudder's hinge
  // at 65% of chord.
  fin: {
    leTable: [
      [2.0 * FZ7, N7 - 60.3], [4.1 * FZ7, N7 - 62.35], [12.1 * FZ7, N7 - 70.1], [12.4 * FZ7, N7 - 70.42], [12.7 * FZ7, N7 - 70.85],
      [G777.FIN.topZ, G777.FIN.topTeX + 1.9],
    ],
    zStations: [2.0 * FZ7, 4.1 * FZ7, 6, 8, 10, 12.1 * FZ7, 12.4 * FZ7, 12.7 * FZ7, G777.FIN.topZ],
    teRootZ: 3.0 * FZ7,
    filletLe: [[2.95, N7 - 57.2], [3.12, N7 - 58.5], [3.32, N7 - 60], [3.6, N7 - 61], [4.1 * FZ7, N7 - 62.3]],
    hingeF: 0.65, rudder: [3.0, 12.0 * FZ7],
    box: { pad: 0.3 },
  },

  gear: {
    mainPivotZ: -1.75, nosePivotZ: -2.1, tiltDeg: 13,
    noseDoor: [3.0, 6.2], mainDoorLen: 5.0,
    stayDY: 1.45, stayDZ: 1.55,    // [ACAP] the front view's side stay, from the leg up to the wing
    // [PUB] The aft axle steers up to 8° once the nosewheel is past about 13°; the sim has no scrub to
    // model, so this is what's seen. Linear to the tiller's stop: at 45° it gives 4.5°, and the turn's
    // geometry on the 31.22 m wheelbase asks about 4°.
    aftSteer: { maxDeg: 8, fromDeg: 13 },
  },

  // Belly fairing: [ACAP] the side view: −3.42 m from behind the nacelle to the door, its aft lobe closing at
  // 46.3 m; the front view: a shoulder at the wing's lower surface. Half-widths by eye from the front view.
  fairing: {
    zc: -1.9, up: 1.9,
    hw: [[24.5, 0.4], [26, 2.6], [28, 3.15], [31, 3.3], [37, 3.4], [41, 3.35], [44, 2.9], [46, 1.0], [46.3, 0.3]],
    bot: [[24.5, -3.0], [26, -3.12], [29, -3.33], [32, -3.43], [40, -3.43], [43, -3.22], [45, -2.6], [46.3, -2.0]],
  },

  livery: {
    chinStartD: 7, chinEndD: 2.9, bellyStartD: 53, bellyEndD: 68, titleD: 12.2, titleTheta: 52, titleFontCm: 150, regD: 53, regTheta: 30,
    regFontCm: 62, atomCentreD: 67.2, atomZ: 7.0, atomR: 2.5, radomeSeamD: 1.2,
  },

  // Beacons: the top one over the wing; the bottom one ahead of the fairing.
  lights: { beaconTopX: -1.5, beaconBottomX: N7 - 21.5 },

  splitBehindEye: 1.85,
};
