// v0.7.9 (map), part 2: the airports' ground on the path map (src/ui/map-airports.js). The shapes are built once an
// airport and kept; the six airports of the brief have pavement, hold bars, named taxiways and stands to draw; the names
// along the taxiways never overlap each other or a box already taken, keep their spacing, and stay on the screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// a Path2D that counts its points (node has none)
globalThis.Path2D ??= class { constructor() { this.n = 0; } moveTo() { this.n++; } lineTo() { this.n++; } closePath() {} };
const { groundShapes, placeAlong, placeAt, GROUND_MPP, NAME_SPACING_PX } = await import('../src/ui/map-airports.js');

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const load = (icao, eu) => JSON.parse(fs.readFileSync(path.join(DATA, eu ? 'europe' : '', 'airports', icao + '.json'), 'utf8'));

for (const [icao, eu] of [['RKSI'], ['RJTT'], ['EGLL', 1], ['LFPG', 1], ['EDDF', 1], ['ETAR', 1]]) {
  test(`${icao}: pavement, hold bars, named taxiways and stands to draw, built once`, () => {
    const a = load(icao, eu);
    const S = groundShapes(a);
    assert.ok(S, icao);
    assert.equal(groundShapes(a), S, 'kept, not built again');
    assert.ok(S.aprons.n > 3, 'aprons');
    assert.ok(S.taxi.length >= 1 && S.taxi.every((t) => t.w > 0 && t.path.n > 1), 'taxiways by width');
    assert.ok(S.holds > 0, 'hold bars');
    assert.ok(S.names.length > 5, 'named taxiways');
    assert.ok(S.stands.length >= 4, 'stands');
    const b = S.box;
    for (const rw of a.runways) for (const e of rw.ends) assert.ok(e.x >= b.x0 && e.x <= b.x1 && e.y >= b.y0 && e.y <= b.y1, 'the box holds the runways');
  });
}

test('the layers come in from far to near', () => {
  const M = GROUND_MPP;
  assert.ok(M.pave > M.holds && M.holds >= M.names && M.names > M.rwyNums && M.rwyNums > M.stands && M.stands > 1);
  assert.ok(M.pave <= 60, 'no pavement before the terminals (60 m a pixel)');
});

const overlap = (a, b) => !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);

test("Heathrow's taxiway names at 6 m a pixel: none overlapping, spaced, on the screen, off the taken boxes", () => {
  const a = load('EGLL', 1);
  const S = groundShapes(a);
  const k = 1 / 6, W = 1440, H = 900, [cx, cy] = a.origin;
  const toScreen = (x, y, o) => { o[0] = W / 2 + (x - cx) * k; o[1] = H / 2 - (y - cy) * k; return o; };
  const lines = S.names.map((n) => ({ text: n.ref, pts: n.pts }));
  const block = { x0: 600, y0: 400, x1: 800, y1: 500 };
  const taken = [block];
  const out = placeAlong(lines, { toScreen, measure: (t) => t.length * 7, h: 15, view: { x0: 0, y0: 0, x1: W, y1: H }, taken });
  assert.ok(out.length >= 15, `${out.length} names`);
  for (let i = 0; i < out.length; i++) {
    const b = out[i].box;
    assert.ok(b.x0 >= 0 && b.x1 <= W && b.y0 >= 0 && b.y1 <= H, 'on the screen');
    assert.ok(!overlap(b, block), 'off a taken box');
    for (let j = i + 1; j < out.length; j++) {
      assert.ok(!overlap(b, out[j].box), `${out[i].text} and ${out[j].text} overlap`);
      if (out[i].text === out[j].text) assert.ok(Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y) >= NAME_SPACING_PX, `${out[i].text} twice too close`);
    }
  }
  assert.equal(taken.length, 1 + out.length, 'each placed name is taken');
});

test('the stands\' numbers: each at its stand, none overlapping', () => {
  const a = load('RKSI');
  const S = groundShapes(a);
  const k = 1 / 2, W = 1440, H = 900;
  const st = S.stands[0], cx = st.x, cy = st.y;
  const toScreen = (x, y, o) => { o[0] = W / 2 + (x - cx) * k; o[1] = H / 2 - (y - cy) * k; return o; };
  const out = placeAt(S.stands.map((s) => ({ text: s.ref, x: s.x, y: s.y })), { toScreen, measure: (t) => t.length * 6, h: 12, view: { x0: 0, y0: 0, x1: W, y1: H }, taken: [] });
  assert.ok(out.length >= 3);
  for (const o of out) {
    const s = S.stands.find((q) => q.ref === o.text && Math.abs(toScreen(q.x, q.y, [0, 0])[0] - o.x) < 1e-9);
    assert.ok(s, o.text);
  }
  const boxes = out.map((o) => ({ x0: o.x - (o.text.length * 6 + 4) / 2, x1: o.x + (o.text.length * 6 + 4) / 2, y0: o.y - 6, y1: o.y + 6 }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]));
});
