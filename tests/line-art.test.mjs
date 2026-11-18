// v0.5.7: the home page's line art (src/ui/line-art.js): plain path data that parses, stays in its box, and a
// skyline strip that tiles with no seam.
//   cd games/flight-sim && node --test tests/line-art.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKYLINE, ICONS } from '../src/ui/line-art.js';

const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

// Parses absolute SVG path data into the points it lists: end points and control points (a curve stays inside the
// hull of these). For an arc, its end point and a box sure to hold it (none are drawn with arcs). Throws on
// anything else: other commands, relative commands, missing or non-finite numbers.
function parse(d) {
  const toks = d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[^\sA-Za-z\d.,+-]+/g) || [];
  const pts = [];
  let i = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0, first = true;
  const numAt = () => {
    const t = toks[i++];
    if (t === undefined || /[A-Za-z]/.test(t)) throw new Error(`missing number in ${d.slice(0, 60)}`);
    const v = Number(t);
    if (!Number.isFinite(v)) throw new Error(`bad number ${t}`);
    return v;
  };
  while (i < toks.length) {
    const t = toks[i];
    if (/^[A-Za-z]$/.test(t)) {
      if (!(t in ARGS)) throw new Error(`command ${t} not allowed (absolute M L H V C S Q T A Z only)`);
      cmd = t; i++;
      if (first && cmd !== 'M') throw new Error('path must start with M');
      first = false;
      if (cmd === 'Z') { cx = sx; cy = sy; continue; }
    } else if (cmd === null || cmd === 'Z') throw new Error(`stray token ${t}`);
    const n = ARGS[cmd], a = [];
    for (let k = 0; k < n; k++) a.push(numAt());
    switch (cmd) {
      case 'M': cx = sx = a[0]; cy = sy = a[1]; pts.push([cx, cy]); cmd = 'L'; break;
      case 'L': case 'T': cx = a[0]; cy = a[1]; pts.push([cx, cy]); break;
      case 'H': cx = a[0]; pts.push([cx, cy]); break;
      case 'V': cy = a[0]; pts.push([cx, cy]); break;
      case 'C': pts.push([a[0], a[1]], [a[2], a[3]], [a[4], a[5]]); cx = a[4]; cy = a[5]; break;
      case 'S': case 'Q': pts.push([a[0], a[1]], [a[2], a[3]]); cx = a[2]; cy = a[3]; break;
      case 'A': {
        // the arc lies inside its ellipse's box, whose centre is within r of either end: grow the ends' box by 2r
        const r = Math.max(Math.abs(a[0]), Math.abs(a[1]));
        pts.push([Math.min(cx, a[5]) - 2 * r, Math.min(cy, a[6]) - 2 * r], [Math.max(cx, a[5]) + 2 * r, Math.max(cy, a[6]) + 2 * r], [a[5], a[6]]);
        cx = a[5]; cy = a[6]; break;
      }
      default: break;
    }
  }
  if (!pts.length) throw new Error('empty path');
  return pts;
}

const inBox = (pts, w, h, eps = 1e-9) => pts.every(([x, y]) => x >= -eps && x <= w + eps && y >= -eps && y <= h + eps);

test('the parser itself: accepts good data, refuses bad', () => {
  assert.deepEqual(parse('M0 1L2 3H4V5Z'), [[0, 1], [2, 3], [4, 3], [4, 5]]);
  assert.equal(parse('M0 0C1 1 2 2 3 3Q4 4 5 5').length, 6);
  for (const bad of ['L0 0', 'M0 0l1 1', 'M0 0L1', 'M0 0LNaN 1', 'M0 0X1 1', 'M0 0L1e999 1']) assert.throws(() => parse(bad), bad);
});

test('the skyline: its size, and every path parses, inside 0..width × 0..height', () => {
  const { width, height, baseline, paths } = SKYLINE;
  assert.equal(height, 220);
  assert.ok(baseline >= 205 && baseline <= 216, `baseline ${baseline}`);
  assert.ok(width >= 3200 && width <= 4000, `width ${width}`);
  assert.ok(Number.isInteger(width), 'a whole number of pixels, so copies line up');
  assert.ok(paths.length > 100);
  paths.forEach((d, i) => {
    assert.equal(typeof d, 'string');
    const pts = parse(d);
    assert.ok(inBox(pts, width, height), `path ${i} leaves the strip: ${d.slice(0, 80)}`);
  });
});

test('the skyline: the ground line spans the full width at the baseline', () => {
  const { width, baseline, paths } = SKYLINE;
  const ground = paths.map(parse).find((pts) => pts.every(([, y]) => y === baseline) && Math.min(...pts.map(([x]) => x)) === 0 && Math.max(...pts.map(([x]) => x)) === width);
  assert.ok(ground, 'a path from (0, baseline) to (width, baseline)');
});

test('the skyline: nothing but the ground line reaches the seam, and nothing hangs below the ground', () => {
  const { width, baseline, paths } = SKYLINE;
  let grounds = 0;
  for (const d of paths) {
    const pts = parse(d);
    if (pts.every(([, y]) => y === baseline) && Math.min(...pts.map(([x]) => x)) === 0) { grounds++; continue; }
    const xs = pts.map(([x]) => x);
    assert.ok(Math.min(...xs) >= 2 && Math.max(...xs) <= width - 2, `crosses the seam: ${d.slice(0, 80)}`);
    // a curve's control points may dip a hair under the ground line (round feet), never more
    assert.ok(pts.every(([, y]) => y <= baseline + 1.5), `below the ground: ${d.slice(0, 80)}`);
  }
  assert.equal(grounds, 1, 'one ground line');
});

test('the skyline: the landmarks, named, sorted, apart, each with its drawing inside its range', () => {
  const { width, landmarks, paths } = SKYLINE;
  assert.ok(landmarks.length >= 14, `${landmarks.length} landmarks`);
  const names = new Set();
  landmarks.forEach((l, i) => {
    assert.ok(typeof l.name === 'string' && l.name.length > 2, 'a name');
    assert.ok(!names.has(l.name), `${l.name} twice`); names.add(l.name);
    assert.ok(Number.isFinite(l.x0) && Number.isFinite(l.x1) && l.x0 < l.x1, `${l.name}: x0 < x1`);
    assert.ok(l.x0 >= 0 && l.x1 <= width, `${l.name} inside the strip`);
    if (i) assert.ok(l.x0 >= landmarks[i - 1].x1, `${l.name} overlaps ${landmarks[i - 1].name}`);
  });
  for (const want of ['Eiffel Tower', 'Sungnyemun', 'N Seoul Tower', 'Lotte World Tower']) assert.ok(names.has(want), want);
  // every path but the ground line lies inside one landmark's range or in a gap between two (a filler building),
  // and every landmark's range holds some drawing that rises well above the ground
  const all = paths.slice(1).map(parse);
  for (const l of landmarks) {
    const mine = all.filter((pts) => pts.every(([x]) => x >= l.x0 - 1e-6 && x <= l.x1 + 1e-6));
    assert.ok(mine.length >= 3, `${l.name}: drawn in its range`);
    const top = Math.min(...mine.flat().map(([, y]) => y));
    assert.ok(SKYLINE.baseline - top > 25, `${l.name}: rises above the ground`);
  }
  for (const pts of all) {
    const x0 = Math.min(...pts.map(([x]) => x)), x1 = Math.max(...pts.map(([x]) => x));
    const inside = landmarks.some((l) => x0 >= l.x0 - 1e-6 && x1 <= l.x1 + 1e-6);
    const between = landmarks.every((l) => x1 <= l.x0 + 1e-6 || x0 >= l.x1 - 1e-6);
    assert.ok(inside || between, `a path straddles a landmark's edge (${x0.toFixed(1)}–${x1.toFixed(1)})`);
  }
});

test('the skyline: the tallest reach about 200 above the ground, the fillers stay low', () => {
  const { baseline, landmarks, paths } = SKYLINE;
  const all = paths.slice(1).map(parse);
  const ys = all.flat().map(([, y]) => y);
  const top = baseline - Math.min(...ys);
  assert.ok(top >= 185 && top <= 212, `the tallest rises ${top}`);
  const fill = all.filter((pts) => landmarks.every((l) => Math.max(...pts.map(([x]) => x)) <= l.x0 || Math.min(...pts.map(([x]) => x)) >= l.x1));
  assert.ok(fill.length > 20, 'filler buildings between the landmarks');
  const fillTop = baseline - Math.min(...fill.flat().map(([, y]) => y));
  assert.ok(fillTop <= 90, `the fillers rise ${fillTop}`);
});

test('the icons: the four, each path parses and stays in its box', () => {
  assert.deepEqual(Object.keys(ICONS).sort(), ['boardingPass', 'planeSide', 'planeTop', 'suitcase']);
  for (const [name, ic] of Object.entries(ICONS)) {
    assert.ok(ic.w > 0 && ic.h > 0, `${name} has a box`);
    assert.ok(Array.isArray(ic.paths) && ic.paths.length >= 3, `${name} has paths`);
    for (const d of ic.paths) assert.ok(inBox(parse(d), ic.w, ic.h), `${name}: ${d.slice(0, 60)} leaves its ${ic.w}×${ic.h} box`);
  }
  // planeTop: centred in its box, the nose to the right (its rightmost point on the middle line)
  const pts = ICONS.planeTop.paths.flatMap(parse);
  const xs = pts.map(([x]) => x), ys = pts.map(([, y]) => y);
  const { w, h } = ICONS.planeTop;
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - w / 2) < 1.5 && Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - h / 2) < 1.5, 'centred');
  const nose = pts.reduce((a, b) => (b[0] > a[0] ? b : a));
  assert.ok(Math.abs(nose[1] - h / 2) < 1, 'nose on the axis, at +x');
  // planeSide: the nose to the left: its leftmost point near the fuselage's middle height, the tail fin high on the right
  const sp = ICONS.planeSide.paths.flatMap(parse);
  const top = sp.reduce((a, b) => (b[1] < a[1] ? b : a));
  assert.ok(top[0] > ICONS.planeSide.w * 0.7, 'the fin at the right');
});

test('the path data stays small', () => {
  const bytes = SKYLINE.paths.join('').length + Object.values(ICONS).reduce((n, ic) => n + ic.paths.join('').length, 0);
  assert.ok(bytes < 150 * 1024, `${bytes} bytes`);
});
