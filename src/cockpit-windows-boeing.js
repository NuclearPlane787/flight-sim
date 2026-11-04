// The Boeing widebodies' flight-deck windows, per type, for the exterior glass and livery
// (widebody.js, livery-widebody.js) and the cockpit shell's cut-outs (cockpit-boeing.js), so the
// three always agree. Designed from the Captain's eye, as src/cockpit-windows.js is for the A321:
// each corner is a direction out of that eye, and each edge is where the plane through the eye
// and its two corners cuts the nose, so from the left seat every frame is a straight line.
//
//   windowDesignFor(spec)                → the left-side design, corner lists (see below)
//   boeingWindowOutlines(spec, shape?)   → [[[x, θ], ...], ...] left-side outlines, one per window;
//       the right side mirrors them (θ → 180° − θ). (x, θ) as in fusePoint(): body x in metres, θ in
//       degrees around the fuselage (0 left, 90 the crown, 180 right). shape = fuselageShape(spec).
//
// A corner is [azimuth°, elevation°] (azimuth left of the nose, elevation above the body's
// horizontal), or { y, el }: on the crown at body y, seen at that elevation (the centre post).
// The sums are widebody-shape.js's; a type only adds its directions here.

import { fuselageShape, cockpitWindowOutlines } from './widebody-shape.js';

const DESIGNS = {
  // The 787's four windows, two a side. [ACAP] D6-58333 Rev Q §4.4.1 (p. 4-6) gives, from the pilot's
  // eye: 21.0° down and 25.4° up through No. 1 in the vertical plane through the eye; through No. 2,
  // 31° up and 27° down abeam and back to 121.5°, those three with the head turned about a point
  // 0.08 m aft of the eye. So the No. 1 corners are solved for the two numbers straight ahead (an edge
  // between two corners is a great circle, and bows away from them), and the No. 2 corners are those
  // angles worked back to directions from the eye itself: 31° up abeam is [98, 27.1] and 121.5° back
  // is [124.1, 1.8]. tests/cockpit-boeing.test.mjs measures all of them. As a check, [ACAP] p. 2-6's
  // side view puts No. 2's rear edge 3.46 m aft of the tip, and these give 3.47 m; its post between
  // the two windows is at 2.15 to 2.4 m, 48° to 57° from this eye. The other corners are [EST] from
  // that side view, rounding No. 2's rear edge as it does.
  'b787-9': [
    [{ y: 0.05, el: -18.4 }, { y: 0.05, el: 16.8 }, [49, 21.6], [46, -18.7]],
    [[53, -25], [55, 27], [98, 27.1], [118.5, 19.5], [124.1, 1.8], [114.8, -18.7], [93.8, -25.4]],
  ],
  // The 777-300ER's six windows, three a side: No. 1 the windshield, No. 2 the sliding window, No. 3 the
  // small one behind it. [ACAP] D6-58329-2 Rev G §4.4 (p. 4-6) gives, from the pilot's eye, 21° down and
  // 32° up through the main window in the vertical plane through the eye, 31° up and 27° down abeam and
  // back to 125° through the side window, all with the head turned about a point 0.08 m aft of the eye.
  // So No. 1's post corners are solved for the two numbers straight ahead, and No. 2's and No. 3's for
  // those angles with the head turned; tests/cockpit-boeing.test.mjs measures all of them. (Abeam, note 1
  // of that page says "main window"; there the only glass abeam is No. 2, so that's where it's taken.)
  // The azimuths of the corners are [DRAW] p. 2-4's top view, from this eye: No. 1 ends at 41°, No. 2 runs
  // from 66–71° to 100–116° and No. 3 from 112–120° to 124–129°. That leaves a wide post, 41° to 68° at eye
  // level, because the eye is so far forward (2.26 m from the tip): the post is under 0.5 m from it, and only
  // about 0.2 m wide.
  // The heights: No. 1's sill is level at z ≈ +0.46, as p. 2-4's side view draws it (+0.47). The tops come
  // out about 0.1 m higher than drawn: the document's 31° and 32° need them there. All this assumes the eye
  // at 6.25 m (see geometry-b777-300er.js: the fit to these drawings), and moves if it moves.
  'b777-300er': [
    [{ y: 0.05, el: -14.6 }, { y: 0.05, el: 19.3 }, [41, 30], [41, -25]],
    [[66, -27], [71, 33], [116, 19], [100, -24]],
    [[112, -21], [120, 10], [129, 5], [124, -17]],
  ],
};

export function windowDesignFor(spec) {
  const design = DESIGNS[spec.id];
  if (!design) throw new Error(`no cockpit windows for type ${spec.id}`);
  return design;
}

export function boeingWindowOutlines(spec, shape = fuselageShape(spec)) {
  return cockpitWindowOutlines({ geo: spec.geo, cockpitWindows: windowDesignFor(spec) }, shape);
}
