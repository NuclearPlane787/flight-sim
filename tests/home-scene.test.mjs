// v0.5.7: the home page scene's geometry and timing (src/ui/home-scene.js), without a page: the skyline's fit and
// tiles, the route's curve and its even-speed table, where the plane is (shrinking into each dot, gone a moment,
// back the other way), the dashes' flow, and where the boarding pass and the suitcase float. v0.5.8: the suitcase on
// the pass's side of the path, the ground band's top on the ground line, the prints below and right of the path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { skylineFit, routeCurve, bezier, curveTable, planeAt, dashTravel, freeArea, floaterSpots, PLANE, BACKDROPS, DEFAULT_BACKDROP,
  groundLineUp, PRINT, PRINT_SLOTS, PRINT_SIZES, printHeight, printSpots, printOverlap, PHOTOS } from '../src/ui/home-scene.js';
import { SKYLINE, ICONS } from '../src/ui/line-art.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (±${tol})`);

test('the backdrops: three, dusk by default', () => {
  assert.deepEqual(BACKDROPS, ['night', 'dusk', 'blueprint']);
  assert.ok(BACKDROPS.includes(DEFAULT_BACKDROP));
});

test('the skyline: a fifth of the height, capped, and enough tiles to cover the width with one to slide', () => {
  for (const w of [400, 680, 893, 1190, 1600, 3000]) for (const h of [500, 700, 900, 1080, 1440, 2000]) {
    const f = skylineFit(w, h);
    assert.equal(f.height, Math.round(Math.min(210, Math.max(80, 0.2 * h))));
    near(f.scale, f.height / SKYLINE.height, 1e-12);
    near(f.tileW, SKYLINE.width * f.scale, 1e-9);
    assert.ok(f.copies * f.tileW >= w + f.tileW, `${w}×${h}: ${f.copies} tiles of ${f.tileW.toFixed(0)} px cover ${w} px and a tile more`);
    assert.ok((f.copies - 1) * f.tileW < w + f.tileW + 1e-9 || f.copies === 2, 'no more tiles than that');
  }
  assert.equal(skylineFit(900, 900).height, 180);
  assert.equal(skylineFit(900, 1440).height, 210, 'capped');
});

const BOX = { x0: 60, y0: 250, x1: 840, y1: 630 };

test('the route: from the lower left to the upper right of the free area, inside it, always rightwards', () => {
  const c = routeCurve(BOX);
  assert.ok(c[0].x < BOX.x0 + 0.1 * (BOX.x1 - BOX.x0) && c[0].y > BOX.y0 + 0.8 * (BOX.y1 - BOX.y0), 'starts near the lower left');
  assert.ok(c[3].x > BOX.x0 + 0.9 * (BOX.x1 - BOX.x0) && c[3].y < BOX.y0 + 0.2 * (BOX.y1 - BOX.y0), 'ends near the upper right');
  let prev = null;
  for (let i = 0; i <= 200; i++) {
    const p = bezier(c, i / 200);
    assert.ok(p.x >= BOX.x0 && p.x <= BOX.x1 && p.y >= BOX.y0 && p.y <= BOX.y1, `inside the free area at t ${i / 200}`);
    if (prev) assert.ok(p.x > prev.x, 'always rightwards');
    prev = p;
  }
});

test('the route by arc length: even steps, the ends at the dots, heading up and to the right', () => {
  const c = routeCurve(BOX), t = curveTable(c);
  near(t.at(0).x, c[0].x, 1e-9); near(t.at(0).y, c[0].y, 1e-9);
  near(t.at(1).x, c[3].x, 1e-9); near(t.at(1).y, c[3].y, 1e-9);
  const n = 50, steps = [];
  for (let i = 1; i <= n; i++) { const a = t.at((i - 1) / n), b = t.at(i / n); steps.push(Math.hypot(b.x - a.x, b.y - a.y)); }
  const mean = steps.reduce((s, x) => s + x, 0) / n;
  for (const s of steps) near(s, mean, mean * 0.01, 'an even step');
  near(steps.reduce((s, x) => s + x, 0), t.length, t.length * 0.002, 'the length');
  for (let i = 0; i <= 20; i++) { const a = t.at(i / 20).angle; assert.ok(a < 0.05 && a > -Math.PI / 2, `heading up and right at ${i / 20}: ${(a * 180 / Math.PI).toFixed(1)}°`); }
  near(t.at(-0.5).x, c[0].x, 1e-9, 'clamped below');
  near(t.at(1.5).x, c[3].x, 1e-9, 'clamped above');
});

test('the plane: out from the lower-left dot, shrinking into the upper-right one, gone a moment, back the other way', () => {
  const { leg, pause, grow } = PLANE, cycle = leg + pause;
  assert.ok(leg >= 12 && leg <= 16, 'a leg in 12 to 16 s');
  let p = planeAt(0);
  assert.equal(p.dir, 1); assert.equal(p.u, 0); assert.equal(p.scale, 0, 'nothing at the dot it starts from');
  p = planeAt(leg / 2);
  assert.equal(p.dir, 1); near(p.u, 0.5, 1e-12); assert.equal(p.scale, 1);
  p = planeAt(leg - 1e-6);
  near(p.u, 1, 1e-6); near(p.scale, 0, 1e-6, 'vanishing exactly at the dot');
  for (const t of [leg, leg + pause / 2, cycle - 1e-6]) assert.equal(planeAt(t).visible, false, `gone at ${t}`);
  p = planeAt(cycle + 1e-6);
  assert.equal(p.dir, -1); near(p.u, 1, 1e-6, 'back from the same dot'); near(p.scale, 0, 1e-6);
  p = planeAt(cycle + leg / 2);
  assert.equal(p.dir, -1); near(p.u, 0.5, 1e-12); assert.equal(p.scale, 1);
  p = planeAt(cycle + leg - 1e-6);
  near(p.u, 0, 1e-6, 'into the lower-left dot'); near(p.scale, 0, 1e-6);
  p = planeAt(2 * cycle + 1e-6);
  assert.equal(p.dir, 1); near(p.u, 0, 1e-6, 'and out again');
  // Growing over the first part of a leg, full size between, shrinking over the last part: smoothly.
  let last = -1;
  for (let i = 0; i <= 100; i++) {
    const r = (i / 100) * leg, q = planeAt(r);
    const f = r / leg;
    if (f <= grow) assert.ok(q.scale >= last, 'growing');
    else if (f < 1 - grow) assert.equal(q.scale, 1);
    else assert.ok(q.scale <= last + 1e-12, 'shrinking');
    last = q.scale;
  }
  // An even speed: u moves at 1/leg per second.
  near(planeAt(5).u - planeAt(4).u, 1 / leg, 1e-12);
});

test('the dashes flow with the plane: forwards out, back on the way back, easing round at each dot, smooth', () => {
  const { leg, pause } = PLANE, cycle = leg + pause, period = 2 * cycle;
  near(dashTravel(0), 0, 1e-12);
  near(dashTravel(period), 0, 1e-9, 'back where it began after two legs');
  near(dashTravel(3) - dashTravel(2), 1, 1e-12, 'forwards out');
  near(dashTravel(cycle + 3) - dashTravel(cycle + 2), -1, 1e-12, 'backwards on the way back');
  const dt = 1e-3;
  for (let t = 0; t < 2 * period; t += 0.0137) {
    const d = dashTravel(t + dt) - dashTravel(t);
    assert.ok(Math.abs(d) <= dt * 1.0001, `no jump at ${t.toFixed(3)}`);
  }
  // Round the dot: it slows to a stop half way through the pause.
  near(dashTravel(leg + pause / 2 + dt) - dashTravel(leg + pause / 2), 0, 1e-5);
  near(dashTravel(-1), dashTravel(period - 1), 1e-9, 'any time');
});

// The scene's sizes the checks use: [w, h, headBottom, groundTop] (from the page at 1100×700 to 2560×1440).
const SCENES = [[680, 700, 176, 516], [794, 720, 175, 530], [893, 900, 205, 662], [1190, 1080, 260, 801], [1587, 1440, 343, 1166]];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const yOnPath = (t, x) => { let best = null; for (let i = 0; i <= 400; i++) { const p = t.at(i / 400); if (!best || Math.abs(p.x - x) < Math.abs(best.x - x)) best = p; } return best.y; };

test('the free area keeps clear of the title and the skyline; v0.5.8: both floaters left of (above) the path, clear of it', () => {
  for (const [w, h, headBottom, groundTop] of SCENES) {
    const box = freeArea({ w, h, headBottom, groundTop, padX: 0.062 * w });
    assert.ok(box.y0 > headBottom && box.y1 < groundTop && box.x0 > 0 && box.x1 < w, `${w}×${h}: the free area`);
    const c = routeCurve(box), t = curveTable(c);
    const s = floaterSpots(box, c, { passW: Math.min(230, Math.max(120, 0.15 * w)), caseH: Math.min(120, Math.max(64, 0.09 * w)) });
    for (const [k, f] of Object.entries(s)) {
      assert.ok(f.x >= box.x0 - 1e-9 && f.y >= box.y0 - 1e-9 && f.x + f.w <= box.x1 + 1e-9 && f.y + f.h <= box.y1 + 1e-9, `${w}×${h}: the ${k} inside the free area`);
      for (let i = 0; i <= 100; i++) {
        const p = t.at(i / 100);
        const m = k === 'case' ? 24 : 4;   // (the pass where v0.5.7 put it; the suitcase well clear)
        assert.ok(!(p.x > f.x - m && p.x < f.x + f.w + m && p.y > f.y - m && p.y < f.y + f.h + m), `${w}×${h}: the path clear of the ${k} (${m} px)`);
      }
      // Left of the path: above it where the path runs under it, and its lower right corner above the path too.
      assert.ok(f.y + f.h < yOnPath(t, f.x + f.w / 2), `${w}×${h}: the ${k} above (left of) the path`);
      assert.ok(f.y + f.h < yOnPath(t, f.x + f.w), `${w}×${h}: the ${k}'s lower right corner above the path`);
    }
    // The suitcase further along than the pass, and apart from it (their bob and drift: 18 px).
    assert.ok(s.case.x > s.pass.x + s.pass.w / 2, `${w}×${h}: the suitcase beyond the pass`);
    const apart = s.case.x > s.pass.x + s.pass.w + 18 || s.case.y + s.case.h + 18 < s.pass.y;
    assert.ok(apart, `${w}×${h}: the pass and the suitcase apart`);
    near(s.pass.h / s.pass.w, ICONS.boardingPass.h / ICONS.boardingPass.w, 1e-9, 'the pass keeps its shape');
    near(s.case.w / s.case.h, ICONS.suitcase.w / ICONS.suitcase.h, 1e-9, 'the suitcase keeps its shape');
  }
});

test('v0.5.8: the ground band starts on the skyline\'s ground line', () => {
  for (const h of [500, 700, 900, 1080, 1440]) {
    const f = skylineFit(1000, h);
    near(groundLineUp(f), (SKYLINE.height - SKYLINE.baseline) * f.height / SKYLINE.height, 1e-9, `${h}: the line's height over the tape's bottom`);
    assert.ok(groundLineUp(f) > 2 && groundLineUp(f) < 10, `${h}: a few px (${groundLineUp(f).toFixed(2)})`);
  }
  assert.ok(SKYLINE.paths[0].startsWith(`M0 ${SKYLINE.baseline}H`), 'the first path is the ground line, at the baseline');
});

test('v0.5.8: the prints: a 3:2 photo in a white border, thicker at the bottom', () => {
  near(printHeight(200), 200 * (PRINT.side + (1 - 2 * PRINT.side) / PRINT.aspect + PRINT.bottom), 1e-9);
  assert.ok(PRINT.bottom > PRINT.side, 'the bottom edge thicker');
  assert.equal(PHOTOS.length, PRINT_SLOTS.length);
  // v0.5.8: each print has a short caption for its bottom edge.
  for (const p of PHOTOS) assert.ok(typeof p.caption === 'string' && p.caption.length > 0 && p.caption.length <= 24, p.caption);
  const rots = PRINT_SLOTS.map((s) => s.rot);
  assert.equal(new Set(rots.map((r) => Math.sign(r))).size, 2, 'tilted both ways');
  for (const r of rots) assert.ok(Math.abs(r) >= 1.5 && Math.abs(r) <= 8, `a few degrees (${r})`);
  assert.equal(new Set(rots).size, rots.length, 'each its own tilt');
});

test('v0.5.8: the prints lie below and right of the path, clear of it and its dots, inside the free area, overlapping a little', () => {
  for (const [w, h, headBottom, groundTop] of SCENES) {
    const box = freeArea({ w, h, headBottom, groundTop, padX: 0.062 * w });
    const c = routeCurve(box), t = curveTable(c);
    const planePx = clamp(0.042 * w, 34, 64), clear = planePx * 0.5 + 12, pw = clamp(0.17 * w, 120, 290);
    const P = printSpots(box, c, { w: pw, clear });
    assert.ok(P.length >= 2 && P.length <= 3, `${w}×${h}: ${P.length} prints`);
    assert.deepEqual(P.slice(0, 2).map((p) => p.slot), [0, 1], `${w}×${h}: the two along the bottom always`);
    const floaters = floaterSpots(box, c, { passW: Math.min(230, Math.max(120, 0.15 * w)), caseH: Math.min(120, Math.max(64, 0.09 * w)) });
    for (const p of P) {
      const a = p.aabb;
      assert.ok(a.l >= box.x0 - 1e-9 && a.t >= box.y0 - 1e-9 && a.r <= box.x1 + 1e-9 && a.b <= box.y1 + 1e-9, `${w}×${h}: print ${p.slot} (tilted, drifting) inside the free area`);
      // The path and its dots (and rings, r 9) clear of the tilted print's box by the plane's half-size and more.
      let gap = Infinity;
      for (let i = 0; i <= 400; i++) { const q = t.at(i / 400); gap = Math.min(gap, Math.hypot(Math.max(0, a.l - q.x, q.x - a.r), Math.max(0, a.t - q.y, q.y - a.b))); }
      assert.ok(gap >= clear - 1e-6 && gap >= 9 + 8, `${w}×${h}: print ${p.slot} ${gap.toFixed(1)} px off the path (≥ ${clear.toFixed(1)})`);
      for (const d of [c[0], c[3]]) assert.ok(d.x < a.l - 17 || d.x > a.r + 17 || d.y < a.t - 17 || d.y > a.b + 17, `${w}×${h}: print ${p.slot} clear of the dots`);
      assert.ok(p.cy > yOnPath(t, p.cx), `${w}×${h}: print ${p.slot} below (right of) the path`);
      assert.ok(PRINT_SIZES.some((k) => Math.abs(p.w - k * pw) < 1e-9) && Math.abs(p.h - printHeight(p.w)) < 1e-9, `its size (${p.w.toFixed(0)} of ${pw.toFixed(0)})`);
      for (const f of Object.values(floaters)) assert.ok(f.x + f.w < a.l || f.x > a.r || f.y + f.h < a.t || f.y > a.b, `${w}×${h}: print ${p.slot} apart from the floaters`);
    }
    // Overlapping a little: each touches another, by a modest share of its area; the first two by 5–35 %.
    near(printOverlap(P[0], P[1]), printOverlap(P[0], P[1]), 0);
    const o01 = printOverlap(P[0], P[1]);
    assert.ok(o01 >= 0.05 && o01 <= 0.35, `${w}×${h}: prints 0 and 1 overlap ${(o01 * 100).toFixed(0)} %`);
    for (const p of P) {
      const best = Math.max(...P.filter((q) => q !== p).map((q) => printOverlap(p, q)));
      assert.ok(best >= 0.03 && best <= 0.25 + 1e-9, `${w}×${h}: print ${p.slot} overlaps another a little (${(best * 100).toFixed(0)} %)`);
    }
  }
  // A small free area: the third is left out rather than cover the path.
  const small = { x0: 40, y0: 200, x1: 600, y1: 380 };
  const P = printSpots(small, routeCurve(small), { w: 120, clear: 29 });
  assert.ok(P.length <= 2, `a small area: ${P.length} prints`);
});
