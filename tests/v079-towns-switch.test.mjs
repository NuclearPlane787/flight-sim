// v0.7.9 part 7 (briefs/V0-7-9.md; the `towns` subagent): the far towns by day (src/world/fartowns.js, spliced into the
// terrain's fragment shader by terrain.js, behind ?towns79 / FS_TOWNS79, on by default).
// Switched off, the terrain's shader texts and uniforms are the pushed v0.7.8's, in both regions: SHA-256 of the texts
// built in node from the frozen v0.7.8 tree with tests/v079-towns-hash.mjs (every other switch at its default).
// On, only the fragment text changes, and only by the far town's splices. The rest pins the arithmetic the shader has to
// share with cities.js and centres.js: the block lattice, the hand-over's shares, the pulses' filter, the centres' window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

globalThis.location = { href: 'http://127.0.0.1/', search: '' };
const V078 = {
  ea: { vert: '7aecf5da04d4e1364acfbabf8a7c21929da5e4820e5c931f8c566c301bfdb509', frag: 'beae44242df6885c164d4ff92950273fe87bd7a0f7922fdf49ce6ebd69011032',
    uniforms: ['uFine', 'uFineExt', 'uFineOn', 'uFineOrg', 'uFineFrac', 'uGridHalf', 'uHighGround', 'uPark78', 'uPark78Box', 'uLmk78', 'uLmk78N'] },
  europe: { vert: '5c0430ae156011fb4a5032f8ebcff908bf41b29c7c33a36398aef4d6780fc8a4', frag: '4bda817ae3b397935021061b26c9bdd39dcdab794a5c9b2e71c23b0837cb38cf',
    uniforms: ['uFine', 'uFineExt', 'uFineOn', 'uFineOrg', 'uFineFrac', 'uGridHalf', 'uHighGround', 'uEuZone', 'uEuZoneBox', 'uCtr', 'uCtrN', 'uPark78', 'uPark78Box', 'uLmk78', 'uLmk78N'] },
};
const HELPER = fileURLToPath(new URL('./v079-towns-hash.mjs', import.meta.url));
const terrain = (region, on) => {
  const r = spawnSync(process.execPath, [HELPER], { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, FS_REGION: region === 'ea' ? '' : region, FS_TOWNS79: on ? '1' : '0' } });
  const m = /TOWNS79 (.*)/.exec(r.stdout + r.stderr);
  assert.ok(m, r.stdout + r.stderr);
  return JSON.parse(m[1]);
};

for (const region of ['ea', 'europe']) {
  test(`v0.7.9 towns (${region}): switched off, the terrain's shaders and uniforms are v0.7.8's; on, only the fragment text and three uniforms`, () => {
    assert.deepEqual(terrain(region, false), V078[region]);
    const on = terrain(region, true);
    assert.equal(on.vert, V078[region].vert);
    assert.notEqual(on.frag, V078[region].frag);
    assert.deepEqual(on.uniforms, [...V078[region].uniforms, 'uFar79', 'uFar79Box', 'uFar79Code']);
  });
}

const F = await import('../src/world/fartowns.js');

test('v0.7.9 towns: the splices\' anchors once each, and nothing of v0.7.8\'s text removed', () => {
  const src = 'uniform float x;\nvoid main() {\n  a;\n        alb = mix(alb, city, urban);\n  b;\n}\n';
  const s = F.far79Frag(src, { x0: -400000, y0: -400000 });
  assert.ok(s.includes('vec3 far79Town(') && s.includes('far79Town(gfp, m, city, cov.b, cov.r, f79c, f79dx, f79dy, tex2)'));
  // every line of the original is still there, in order
  let at = 0;
  for (const line of src.split('\n')) { const k = s.indexOf(line, at); assert.ok(k >= at, line); at = k + line.length; }
  assert.throws(() => F.far79Frag('void main() {}', { x0: 0, y0: 0 }));
  assert.throws(() => F.far79Frag(src + 'void main() {', { x0: 0, y0: 0 }));
  assert.throws(() => F.far79Glsl({ x0: 100, y0: 0 }), /400 m/);
  // no loop, and at most two texture fetches in what is added
  const add = F.far79Glsl({ x0: 0, y0: 0 });
  assert.ok(!/\bfor\s*\(|\bwhile\s*\(/.test(add));
  assert.equal((add.match(/texture(Lod)?\(/g) || []).length, 2);
  // v0.7.9 mend (the pictures-only review: straight seams through London's suburbs): no tone or share taken whole from a
  // district's hash (bc >> 2) or faded to one share along every lattice line; the centres' mass by a soft threshold and
  // the cover's density
  assert.ok(!add.includes('bc >> 2') && !add.includes('0.6, smoothstep(100.0, 400.0'));
  assert.ok(add.includes('ctr = smoothstep(0.10, 0.80, ctr) * smoothstep(0.35, 0.80, dens);'));
  assert.ok(add.includes('duty *= 0.85 + 0.3 * vnoise('));
});

test('v0.7.9 towns: cities.js\'s and centres.js\'s ranges are the ones the hand-over uses', async () => {
  const cities = readFileSync(new URL('../src/world/cities.js', import.meta.url), 'utf8');
  assert.match(cities, /const BLOCK = 400;/);
  assert.match(cities, /const HALF = 20;/);
  assert.ok(cities.includes('keep *= step(smoothstep(range * 0.45, range * 0.95, dist) * 0.6, sh2 * 0.6 + 0.2);'));
  assert.ok(cities.includes('float grow = 1.0 - smoothstep(range * 0.8, range * 0.97, max(abs(dc.x), abs(dc.y)));'));
  assert.ok(cities.includes('grow *= 1.0 - smoothstep(${(CITY_MAX_AGL * 0.7).toFixed(1)}, ${CITY_MAX_AGL.toFixed(1)}, uCamAgl);'));
  const ce = await import('../src/world/centres.js');
  assert.equal(ce.LOW_R, F.FAR79_LOW_R);
  const centresSrc = readFileSync(new URL('../src/world/centres.js', import.meta.url), 'utf8');
  assert.ok(centresSrc.includes('shrinking into the ground between 0.78 and 0.97 LOW_R'));
  // the shares: all the buildings near, a third kept at the thinning's end, none past the ring or above the cut
  assert.equal(F.nearShare(1000, 1000, 300), 1);
  assert.ok(Math.abs(F.nearShare(7600, 6000, 300) - 1 / 3) < 1e-9);
  assert.equal(F.nearShare(9000, 7800, 300), 0);
  assert.equal(F.nearShare(1000, 1000, 4600), 0);
  // the cities' own rule by Monte Carlo of sh2 (uniform) at a few distances
  for (const d of [3000, 4500, 5500, 6500, 7400]) {
    const R = 8000, ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
    let kept = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) { const sh2 = (i + 0.5) / N; if (sh2 * 0.6 + 0.2 >= ss(0.45 * R, 0.95 * R, d) * 0.6) kept++; }
    assert.ok(Math.abs(kept / N - F.nearShare(d, 0, 0)) < 1e-3, `${d}: ${kept / N} vs ${F.nearShare(d, 0, 0)}`);
  }
  assert.equal(F.centreNearShare(5000, 0), 1);
  assert.equal(F.centreNearShare(7400, 0), 0);
});

test('v0.7.9 towns: the shader\'s block from the fine pixel is cities.js\'s floor(map / 400), in both lattices', () => {
  // the shader's integer arithmetic, replayed: P the fine pixel (lattice origin), fr inside it
  const block = (mx, my, lat) => {
    const px = (mx - lat.x0) / 31.25, py = (my - lat.y0) / 31.25;
    const P = [Math.floor(px), Math.floor(py)], fr = [px - P[0], py - P[1]];
    const u = [P[0] * 5 + Math.floor(fr[0] * 5), P[1] * 5 + Math.floor(fr[1] * 5)];
    const bq = [u[0] >> 6, u[1] >> 6];
    const loc = [(u[0] - bq[0] * 64 + (fr[0] * 5 - Math.floor(fr[0] * 5))) * 6.25 - 200, (u[1] - bq[1] * 64 + (fr[1] * 5 - Math.floor(fr[1] * 5))) * 6.25 - 200];
    return { bc: [bq[0] + lat.x0 / 400, bq[1] + lat.y0 / 400], loc };
  };
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (const lat of [{ x0: -400000, y0: -400000 }, { x0: 0, y0: 0 }]) {
    for (let i = 0; i < 4000; i++) {
      const mx = (rnd() - 0.4) * 2.4e6, my = (rnd() - 0.4) * 1.6e6;
      const r = block(mx, my, lat);
      assert.deepEqual(r.bc, [Math.floor(mx / 400), Math.floor(my / 400)]);
      assert.ok(Math.abs(r.loc[0] - (mx - (r.bc[0] * 400 + 200))) < 1e-6 && Math.abs(r.loc[1] - (my - (r.bc[1] * 400 + 200))) < 1e-6);
    }
  }
});

test('v0.7.9 towns: the pulses\' box filter is exact, and goes to its duty when the pixel is wide', () => {
  const pulse = (x, w, d) => { w = Math.max(w, 1e-4); const a = x - 0.5 * w - 0.5 + 0.5 * d, b = a + w, fr = (v) => v - Math.floor(v);
    return ((Math.floor(b) - Math.floor(a)) * d + Math.min(fr(b), d) - Math.min(fr(a), d)) / w; };
  const brute = (x, w, d) => { let s = 0; const n = 20000; for (let i = 0; i < n; i++) { const t = x - w / 2 + (i + 0.5) * w / n; s += Math.abs(t - Math.floor(t) - 0.5) < d / 2 ? 1 : 0; } return s / n; };
  for (const [x, w, d] of [[0.5, 0.01, 0.6], [0.0, 0.01, 0.6], [0.3, 0.5, 0.4], [1.7, 2.3, 0.62], [-2.2, 0.9, 0.24], [3.1, 7.0, 0.7]]) {
    assert.ok(Math.abs(pulse(x, w, d) - brute(x, w, d)) < 2e-3, `${x} ${w} ${d}`);
  }
  for (let x = -3; x < 3; x += 0.37) assert.ok(Math.abs(pulse(x, 40, 0.62) - 0.62) < 0.02);
});

test('v0.7.9 towns: the centres\' window keeps each mask cell\'s area and place', () => {
  const mask = new Uint8Array(4 * 3); mask[0] = 1; mask[5] = 1; mask[11] = 1;
  const c = { box: [10125, 20375, 10125 + 2000, 20375 + 1500], cols: 4, rows: 3, cell: 500, mask };
  const N = 64, cell = 250, x0 = 8000, y0 = 18000;
  const w = F.centresWindow([c], x0, y0, N, cell);
  let sum = 0, sx = 0, sy = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const v = w[j * N + i] / 255; sum += v; sx += v * (x0 + (i + 0.5) * cell); sy += v * (y0 + (j + 0.5) * cell); }
  assert.ok(Math.abs(sum - 3 * 4) < 0.05, `area ${sum}`);   // three cells of 500 m: four window cells each
  const cx = [0, 1, 3].reduce((a, i) => a + c.box[0] + (i + 0.5) * 500, 0) / 3, cy = [0, 1, 2].reduce((a, j) => a + c.box[1] + (j + 0.5) * 500, 0) / 3;
  assert.ok(Math.abs(sx / sum - cx) < 5 && Math.abs(sy / sum - cy) < 5, `centroid ${sx / sum} ${sy / sum} vs ${cx} ${cy}`);
  // v0.7.9 mend: blurred (the default) it keeps its area, and its edge is soft, never a step from full to nothing
  const sharp = F.centresWindow([c], x0, y0, N, cell, 0);
  let s0 = 0; for (const v of sharp) s0 += v / 255;
  assert.ok(Math.abs(s0 - sum) < 0.1, `${s0} vs ${sum}`);
  assert.ok(Math.max(...w) < 255 && Math.max(...sharp) === 255);
  // the outer ring stays 0 (the texture clamps to its edge)
  const far = F.centresWindow([{ ...c, box: [x0 - 400, y0 - 400, x0 + 1600, y0 + 1100] }], x0, y0, N, cell);
  for (let i = 0; i < N; i++) { assert.equal(far[i], 0); assert.equal(far[i * N], 0); }
});

test('v0.7.9 towns: the roofs\' palettes are cities.js\'s shares and sit with the near town\'s tones', () => {
  assert.equal(F.FAR79_ROOFS.length, 8);
  for (const p of F.FAR79_ROOFS) {
    for (let k = 1; k < p.length; k++) assert.ok(p[k][0] > p[k - 1][0]);
    assert.equal(p[p.length - 1][0], 1);
  }
  for (let c = 0; c < 8; c++) { const m = F.roofMean(c); assert.ok(m.every((v) => v > 0.08 && v < 0.32), `${c}: ${m}`); }
  const cities = readFileSync(new URL('../src/world/cities.js', import.meta.url), 'utf8');
  for (const s of ['vec3(0.17, 0.17, 0.165) * (0.8 + 0.4 * sh1)', 'rr < 0.55', 'vec3(0.085, 0.09, 0.105)', 'vec3(0.07, 0.15, 0.32)', 'vec3(0.10, 0.105, 0.12)', 'vec3(0.24, 0.25, 0.26)']) assert.ok(cities.includes(s), s);
});
