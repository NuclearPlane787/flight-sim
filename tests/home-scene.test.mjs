// v0.5.7: the home page scene's geometry and timing (src/ui/home-scene.js), without a page: the skyline's fit and
// tiles, the route's curve and its even-speed table, where the plane is (shrinking into each dot, gone a moment,
// back the other way), the dashes' flow, and where the boarding pass and the suitcase float.
import test from 'node:test';
import assert from 'node:assert/strict';
import { skylineFit, routeCurve, bezier, curveTable, planeAt, dashTravel, freeArea, floaterSpots, PLANE, BACKDROPS, DEFAULT_BACKDROP } from '../src/ui/home-scene.js';
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

test('the free area keeps clear of the title and the skyline; the floaters sit either side of the path, clear of it', () => {
  for (const [w, h, headBottom, groundTop] of [[680, 700, 176, 516], [794, 720, 175, 530], [893, 900, 205, 662], [1190, 1080, 260, 801], [1587, 1440, 343, 1166]]) {
    const box = freeArea({ w, h, headBottom, groundTop, padX: 0.062 * w });
    assert.ok(box.y0 > headBottom && box.y1 < groundTop && box.x0 > 0 && box.x1 < w, `${w}×${h}: the free area`);
    const c = routeCurve(box), t = curveTable(c);
    const s = floaterSpots(box, c, { passW: Math.min(230, Math.max(120, 0.15 * w)), caseH: Math.min(120, Math.max(64, 0.09 * w)) });
    for (const [k, f] of Object.entries(s)) {
      assert.ok(f.x >= box.x0 - 1e-9 && f.y >= box.y0 - 1e-9 && f.x + f.w <= box.x1 + 1e-9 && f.y + f.h <= box.y1 + 1e-9, `${w}×${h}: the ${k} inside the free area`);
      for (let i = 0; i <= 100; i++) {
        const p = t.at(i / 100);
        assert.ok(!(p.x > f.x - 4 && p.x < f.x + f.w + 4 && p.y > f.y - 4 && p.y < f.y + f.h + 4), `${w}×${h}: the path clear of the ${k}`);
      }
    }
    // Either side: the path's height at the floater's middle.
    const yAt = (x) => { let best = null; for (let i = 0; i <= 400; i++) { const p = t.at(i / 400); if (!best || Math.abs(p.x - x) < Math.abs(best.x - x)) best = p; } return best.y; };
    assert.ok(s.pass.y + s.pass.h < yAt(s.pass.x + s.pass.w / 2), `${w}×${h}: the boarding pass above (left of) the path`);
    assert.ok(s.case.y > yAt(s.case.x + s.case.w / 2), `${w}×${h}: the suitcase below it`);
    near(s.pass.h / s.pass.w, ICONS.boardingPass.h / ICONS.boardingPass.w, 1e-9, 'the pass keeps its shape');
    near(s.case.w / s.case.h, ICONS.suitcase.w / ICONS.suitcase.h, 1e-9, 'the suitcase keeps its shape');
  }
});
