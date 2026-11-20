// v0.6.1: greenhouses.js, the plastic tunnels on the greenhouse ground. The pure part: the CPU's
// list of slots (block, tunnel k, segment s) that can hold a segment, and the segment model's
// winding. The geometry is ground.js's greenhouseGround(): blocks of 125 m (4 fine pixels), a
// direction per 250 m (ihash(bc >> 1, 81), in eighths of a turn), q = R(ang) bl with bl from the
// block's south-west corner, tunnels centred where fract(q.x / 7) = 0.5, a 3.5 m lane round the
// block, blocks with ihash(bc, 83) >= 0.86 open. Re-derived here from that description.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ihash } from '../src/world/finecover.js';
import {
  greenhouseSlots, tunnelGeometry, GH_CAPACITY, GH_SPAN, GH_RB, GH_SEG, GH_HALF_W, GH_HEIGHT, GH_TRIS,
} from '../src/world/greenhouses.js';

const glass = (x0, y0, x1, y1, mm) => { mm[0] = 0.05; mm[1] = 0.5; mm[2] = 0; };   // farm country, hardly built-up
const city = (x0, y0, x1, y1, mm) => { mm[0] = 0.9; mm[1] = 0.05; mm[2] = 0; };
const built = () => 6;
const dirOf = (bx, by) => Math.floor(ihash(bx >> 1, by >> 1, 81) * 4);

// (The glass patch's own test is below; elsewhere every patch is glass, so the geometry is tested whole.)
const patch = () => 1;
function run(ai, aj, texel, cover, cap = GH_CAPACITY) {
  const out = new Float32Array(GH_CAPACITY * 4);
  const n = greenhouseSlots(ai, aj, texel, cover, out, cap, patch);
  const list = [];
  for (let k = 0; k < n; k++) list.push({ bx: ai + out[4 * k], by: aj + out[4 * k + 1], k: out[4 * k + 2], s: out[4 * k + 3] });
  return { n, list, out };
}

// A slot's middle and its two ends in the block (m), from the description, cut to the square
// minus the lane (the ends along the tunnel; the width checked at each).
const spans = new Map();
function slotPlace({ bx, by, k, s }) {
  const ang = dirOf(bx, by) * Math.PI / 4, ca = Math.cos(ang), sa = Math.sin(ang);
  const cq = 7 * (k + 0.5);
  const at = (t, side = 0) => [(cq + side) * ca + t * sa, -(cq + side) * sa + t * ca];
  // The along-interval inside [3.6, 121.4]^2 for both side lines, by sampling (independent of the module's clip).
  const key = bx + ',' + by + ',' + k;
  if (!spans.has(key)) {
    let t0 = Infinity, t1 = -Infinity;
    for (let t = -100; t <= 190; t += 0.02) {
      const ok = [-GH_HALF_W, GH_HALF_W].every((sd) => at(t, sd).every((v) => v >= 3.6 - 0.03 && v <= 121.4 + 0.03));
      if (ok) { t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    }
    spans.set(key, [t0, t1]);
  }
  const [t0, t1] = spans.get(key);
  const a = Math.max(s * GH_SEG, t0), b = Math.min((s + 1) * GH_SEG, t1);
  return { a, b, ca, sa, cq, mid: at((a + b) / 2), ends: [at(a + 0.05), at(b - 0.05)], at };
}

test('nothing without built-up pixels, no cover, or in a dense city', () => {
  assert.equal(run(1000, 2000, () => 0, glass).n, 0, 'no data');
  assert.equal(run(1000, 2000, () => 5, glass).n, 0, 'crop');
  assert.equal(run(1000, 2000, () => 2, glass).n, 0, 'woods');
  assert.equal(run(1000, 2000, built, null).n, 0, 'no 250 m cover: the shader keeps nothing');
  assert.equal(run(1000, 2000, built, city).n, 0, 'dense city (built-up share 0.9)');
  assert.equal(run(1000, 2000, built, (a, b, c, d, mm) => { mm[0] = 0.05; mm[1] = 0.02; mm[2] = 0; }).n, 0, 'no farm share');
  assert.equal(run(1000, 2000, built, (a, b, c, d, mm) => { mm[0] = 0.05; mm[1] = 0.5; mm[2] = 1; }).n, 0, 'an airfield');
});

test('open blocks list nothing; every other block in range lists tunnels', () => {
  const ai = 1200, aj = 3000;
  const { list } = run(ai, aj, built, glass);
  const blocks = new Set(list.map((p) => p.bx + ',' + p.by));
  let open = 0;
  for (let j = -GH_RB; j < -GH_RB + GH_SPAN; j++) for (let i = -GH_RB; i < -GH_RB + GH_SPAN; i++) {
    const bx = ai + i, by = aj + j, isOpen = ihash(bx, by, 83) >= 0.86;
    if (isOpen) { open++; assert.ok(!blocks.has(bx + ',' + by), `open block ${bx},${by} lists nothing`); }
  }
  assert.ok(open > 20, `${open} open blocks in the sample`);
  // Not every block fits in the buffer when all is glass: the nearest come first.
  assert.ok(list.length <= GH_CAPACITY);
});

test('with everything glass: segments inside the block minus the lane, 7 m apart, all four directions', () => {
  const seen = new Set();
  // Anchors far apart; a cap so each run stays quick and holds whole near blocks.
  for (const [ai, aj] of [[0, 0], [1200, 3000], [-800, 640], [5120, -2048]]) {
    const { list } = run(ai, aj, built, glass, 6000);
    assert.ok(list.length > 3000, `${list.length} slots`);
    const byBlock = new Map();
    for (const p of list) {
      const key = p.bx + ',' + p.by;
      if (!byBlock.has(key)) byBlock.set(key, []);
      byBlock.get(key).push(p);
    }
    let checked = 0;
    for (const [key, ps] of byBlock) {
      const [bx, by] = key.split(',').map(Number);
      const d = dirOf(bx, by);
      seen.add(d);
      if (checked++ > 12) continue;          // the geometry check on a dozen blocks a run (sampling is slow)
      const tunnels = new Map();
      for (const p of ps) {
        const pl = slotPlace(p);
        assert.ok(pl.b - pl.a > 0.7, `block ${key} dir ${d} k ${p.k} s ${p.s}: a cut of ${(pl.b - pl.a).toFixed(2)} m`);
        for (const [x, y] of [pl.mid, ...pl.ends]) {
          assert.ok(x > 3.5 && x < 121.5 && y > 3.5 && y < 121.5, `block ${key} dir ${d} k ${p.k} s ${p.s}: (${x.toFixed(2)}, ${y.toFixed(2)}) off the glass`);
        }
        for (const sd of [-GH_HALF_W + 0.05, GH_HALF_W - 0.05]) {
          for (const t of [pl.a + 0.05, pl.b - 0.05]) {
            const [x, y] = pl.at(t, sd);
            assert.ok(x > 3.5 && x < 121.5 && y > 3.5 && y < 121.5, `block ${key}: a corner pokes into the lane`);
          }
        }
        // The centre line is the stripe's middle: fract(q.x / 7) = 0.5.
        const [mx, my] = pl.mid, qx = pl.ca * mx - pl.sa * my;
        assert.ok(Math.abs(((qx / 7) % 1 + 1) % 1 - 0.5) < 1e-6);
        if (!tunnels.has(p.k)) tunnels.set(p.k, []);
        tunnels.get(p.k).push(p.s);
      }
      // Tunnels 7 m apart: consecutive k (no gaps between the first and last listed).
      const ks = [...tunnels.keys()].sort((a, b) => a - b);
      for (let i = 1; i < ks.length; i++) assert.equal(ks[i] - ks[i - 1], 1, `block ${key}: tunnels every 7 m`);
      assert.ok(ks.length >= 15 && ks.length <= 26, `block ${key} dir ${d}: ${ks.length} tunnels`);
      // Each tunnel's segments run on without a gap.
      for (const [k, ss] of tunnels) { ss.sort((a, b) => a - b); for (let i = 1; i < ss.length; i++) assert.equal(ss[i] - ss[i - 1], 1, `block ${key} tunnel ${k}: abutting segments`); }
    }
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3], 'all four directions met');
});

test('every direction fills its block: ~118 m of tunnel per 7 m across, nothing missed', () => {
  // For one block of each direction, the listed length of glass against the square's own.
  const found = new Map();
  for (let by = 0; by < 400 && found.size < 4; by += 2) for (let bx = 0; bx < 40 && found.size < 4; bx += 2) {
    const d = dirOf(bx, by);
    if (!found.has(d) && ihash(bx, by, 83) < 0.86) found.set(d, [bx, by]);
  }
  assert.equal(found.size, 4);
  for (const [d, [bx, by]] of found) {
    // Only that block built-up.
    const tex = (P, Q) => (Math.floor(P / 4) === bx && Math.floor(Q / 4) === by ? 6 : 0);
    const ai = Math.floor(bx / 4) * 4, aj = Math.floor(by / 4) * 4;
    const { list } = run(ai, aj, tex, glass);
    assert.ok(list.every((p) => p.bx === bx && p.by === by));
    let len = 0;
    for (const p of list) { const pl = slotPlace(p); len += pl.b - pl.a; }
    // Glass area inside the inset square: (118 - 5.4)^2 straight, a bit less diagonally (the ends cut square).
    const area = len * 7;
    assert.ok(area > (d % 2 ? 0.80 : 0.88) * 117.8 * 117.8 && area < 117.8 * 117.8, `direction ${d}: ${len.toFixed(0)} m of tunnel, ${list.length} segments`);
  }
});

test('the list asks the segment\'s own pixel: tunnels only over built-up pixels', () => {
  const ai = 400, aj = 800;
  // Built-up only in the even fine-pixel columns.
  const tex = (P) => (P % 2 === 0 ? 6 : 5);
  const { list } = run(ai, aj, tex, glass, 4000);
  assert.ok(list.length > 500);
  let edge = 0;
  for (const p of list.slice(0, 600)) {
    const pl = slotPlace(p), pa = pl.mid[0] / 31.25;
    const onBuilt = Math.floor(pa) % 2 === 0;
    if (!onBuilt) { edge++; assert.ok(Math.abs(pa - Math.round(pa)) * 31.25 < 0.2, `slot's middle at pixel ${pa.toFixed(3)} not built-up`); }
  }
  assert.ok(edge < 20, `${edge} listed on a pixel's edge only`);
});

test('the buffer is never overrun, and the nearest blocks come first', () => {
  const out = new Float32Array(GH_CAPACITY * 4 + 8).fill(-999);
  const n = greenhouseSlots(0, 0, built, glass, out, GH_CAPACITY, () => 1);
  assert.equal(n, GH_CAPACITY, 'all glass fills the buffer');
  for (let k = GH_CAPACITY * 4; k < out.length; k++) assert.equal(out[k], -999);
  const small = new Float32Array(400);
  assert.equal(greenhouseSlots(0, 0, built, glass, small, GH_CAPACITY, () => 1), 100, 'clamped to the array');
  // The first slots are near the anchor's middle (blocks 0..3), the last farther out.
  const d = (k) => Math.hypot(out[4 * k] + 0.5 - 2, out[4 * k + 1] + 0.5 - 2);
  assert.ok(d(0) < 1.5 && d(n - 1) > d(0));
  for (let k = 1; k < n; k++) assert.ok(d(k) >= d(k - 1) - 1e-9, 'nearest first');
});

test('the segment model: 14 triangles, wound anticlockwise from outside once in the scene', () => {
  const g = tunnelGeometry();
  const P = g.getAttribute('position').array, N = g.getAttribute('normal').array, I = g.getIndex().array;
  assert.equal(I.length / 3, GH_TRIS);
  for (const d of [0, 1, 2, 3]) {
    const ang = d * Math.PI / 4, ca = Math.cos(ang), sa = Math.sin(ang), cq = 7 * 5.5, a = 20, b = 35.625, hh = GH_HEIGHT;
    // The shader's mapping: bl = (cq + x W) (ca, -sa) + t (sa, ca); scene = (E, up, -N).
    const scene = (i) => {
      const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2], t = a + (b - a) * z, q = cq + x * GH_HALF_W;
      const e = q * ca + t * sa, n = -q * sa + t * ca;
      return [e, y * hh, -n];
    };
    const nrm = (i) => {
      let nx = N[3 * i] / GH_HALF_W, ny = N[3 * i + 1] / hh, nz = N[3 * i + 2];
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const e = nx * ca + nz * sa, n = -nx * sa + nz * ca;
      return [e, ny, -n];
    };
    const axis = [cq * ca + ((a + b) / 2) * sa, 0, -(-cq * sa + ((a + b) / 2) * ca)];
    for (let k = 0; k < I.length; k += 3) {
      const A = scene(I[k]), B = scene(I[k + 1]), C = scene(I[k + 2]), n = nrm(I[k]);
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const lc = Math.hypot(...cr);
      assert.ok(lc > 1e-6, 'no degenerate triangle');
      assert.ok((cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2]) / lc > 0.999, `direction ${d}, triangle ${k / 3}: front face outwards, flat normal`);
      const cen = [(A[0] + B[0] + C[0]) / 3 - axis[0], (A[1] + B[1] + C[1]) / 3 - axis[1], (A[2] + B[2] + C[2]) / 3 - axis[2]];
      assert.ok(cen[0] * n[0] + cen[1] * n[1] + cen[2] * n[2] > 0, 'the normal points away from the tunnel');
    }
  }
});

// v0.6.1: which built-up patches are glass: finecover.js's glassPatch (an exact lattice's smooth value,
// the shader's the same), about two patches in five, and the list follows it.
test('the glass patch: a smooth value in 0..1 over a 250 m lattice; the list keeps only the slots over it', async () => {
  const { glassPatch } = await import('../src/world/finecover.js');
  let over = 0, n = 0, maxStep = 0;
  for (let y = -4000; y < 4000; y += 37) for (let x = -4000; x < 4000; x += 41) {
    const v = glassPatch(x, y);
    assert.ok(v >= 0 && v < 1);
    maxStep = Math.max(maxStep, Math.abs(glassPatch(x + 0.25, y) - v));
    n++; if (v >= 0.54) over++;
  }
  assert.ok(over / n > 0.3 && over / n < 0.55, `${(100 * over / n).toFixed(0)} % of the ground is over the glass threshold`);
  assert.ok(maxStep < 0.06, 'continuous: no step across a lattice line');
  const BIG = 100000, out = new Float32Array(BIG * 4);      // (room for every block's slots: the cap isn't what is tested here)
  const all = greenhouseSlots(64, 64, built, glass, out, BIG, () => 1);
  const some = greenhouseSlots(64, 64, built, glass, out, BIG);
  assert.ok(all < BIG && some > 0.2 * all && some < 0.7 * all, `${some} of ${all} slots stand on glass patches`);
  assert.equal(greenhouseSlots(64, 64, built, glass, out, BIG, () => 0), 0);
});
