// v0.7.9 part 3, items 1 to 3 (briefs/V0-7-9.md): the main roads baked (tools/bake_region_roads.py), their
// streetlights and the motorways' cars (src/world/roadlights.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseRoadTile, buildPieces, carsOnPiece, carDensity, carPhases, countryMeta, roadShaders, hash01,
  PIECE_M, FAR_X, CAR_S, CAR_WRAP, CAR_SLOTS, CAR_SPEEDS, LIGHTS79,
} from '../src/world/roadlights.js';

const GAME = fileURLToPath(new URL('..', import.meta.url));

// An FSR1 file as the bake writes it: lines [{ cls, flags, pts: [[x, y], ...] }] (metres from the cell's corner).
function fsr1(lines) {
  const nv = lines.reduce((s, l) => s + l.pts.length, 0);
  const b = Buffer.alloc(12 + 4 * lines.length + 4 * nv);
  b.write('FSR1', 0, 'latin1'); b.writeUInt32LE(lines.length, 4); b.writeUInt32LE(nv, 8);
  let o = 12;
  for (const l of lines) { b.writeUInt8(l.cls, o); b.writeUInt8(l.flags, o + 1); b.writeUInt16LE(l.pts.length, o + 2); o += 4; }
  for (const l of lines) {
    b.writeUInt16LE(l.pts[0][0], o); b.writeUInt16LE(l.pts[0][1], o + 2); o += 4;
    for (let k = 1; k < l.pts.length; k++) {
      b.writeInt16LE(l.pts[k][0] - l.pts[k - 1][0], o); b.writeInt16LE(l.pts[k][1] - l.pts[k - 1][1], o + 2); o += 4;
    }
  }
  return b;
}
const META = () => ({ led: 0.5, left: false });

test('v0.7.9 roads: an FSR1 cell parses back to its lines (first vertex absolute, then deltas)', () => {
  const src = [{ cls: 0, flags: 1, pts: [[0, 0], [1000, 20], [32000, 31999], [64000, 60000]] }, { cls: 2, flags: 0, pts: [[500, 500], [400, 700]] }];
  const lines = parseRoadTile(fsr1(src));
  assert.equal(lines.length, 2);
  lines.forEach((l, k) => {
    assert.equal(l.cls, src[k].cls); assert.equal(l.flags, src[k].flags);
    assert.deepEqual([...l.x], src[k].pts.map((p) => p[0])); assert.deepEqual([...l.y], src[k].pts.map((p) => p[1]));
  });
  assert.throws(() => parseRoadTile(Buffer.from('XXXX00000000', 'latin1')));
});

test('v0.7.9 roads: pieces are at most PIECE_M (far ones FAR_X longer), the arc runs on, cars only on motorways and trunks', () => {
  const lines = parseRoadTile(fsr1([{ cls: 0, flags: 0, pts: [[0, 0], [1000, 0], [1000, 650]] }, { cls: 2, flags: 0, pts: [[0, 100], [700, 100]] }]));
  const near = buildPieces(lines, 1e5, 2e5, 7, META);
  assert.equal(near.nLamps, 4 + 3 + 3);   // 1000 m → 4, 650 m → 3, 700 m → 3
  assert.equal(near.nCars, 7);
  let prevEnd = null, s = 0;
  for (let p = 0; p < near.nLamps; p++) {
    const r = near.lamps.subarray(p * 8, p * 8 + 8);
    const L = Math.hypot(r[2] - r[0], r[3] - r[1]);
    assert.ok(L <= PIECE_M + 1e-3, `piece ${p} ${L}`);
    if (r[5] % 4 === 2 && p === 7) s = 0;   // the second line starts again at 0
    if (p === 0 || p === 7) assert.equal(r[4], 0);
    if (prevEnd && p !== 7) assert.ok(Math.abs(r[4] - prevEnd) < 0.5, `arc ${p}`);
    prevEnd = r[4] + L;
    assert.ok(r[0] >= 1e5 && r[1] >= 2e5);
  }
  const far = buildPieces(lines, 1e5, 2e5, 7, META, true);
  assert.equal(far.nLamps, 1 + 1 + 1);
  assert.equal(far.nCars, 0);
  for (let p = 0; p < far.nLamps; p++) assert.equal(Math.floor(far.lamps[p * 8 + 5] / 4) & 4, 4, 'the far flag');
  assert.ok(PIECE_M * FAR_X >= 1000);
});

test('v0.7.9 cars: a pure function of the clock: the same at the same time, moved by the clock, and periodic', () => {
  const s0 = 1234.5, len = 300;
  const a = carsOnPiece(s0, len, 777, 0.7, 4242, 1), b = carsOnPiece(s0, len, 777, 0.7, 4242, 1);
  assert.deepEqual(a, b);
  // The pattern repeats exactly when the phase wraps (CAR_S × CAR_WRAP).
  assert.deepEqual(carsOnPiece(s0, len, 777 + CAR_S * CAR_WRAP, 0.7, 4242, 1).map((v) => v.toFixed(6)), a.map((v) => v.toFixed(6)));
  assert.deepEqual(carsOnPiece(s0, len, 777 + CAR_S * CAR_WRAP, 0.7, 4242, -1).map((v) => v.toFixed(6)), carsOnPiece(s0, len, 777, 0.7, 4242, -1).map((v) => v.toFixed(6)));
  // Moving: 10 m more phase moves every car with the line 10 m on (those still on the piece), against it 10 m back.
  const fwd = carsOnPiece(s0, len, 787, 0.7, 4242, 1);
  for (const v of a) if (v + 10 < len) assert.ok(fwd.some((w) => Math.abs(w - v - 10) < 1e-6), `car at ${v}`);
  const back0 = carsOnPiece(s0, len, 777, 0.7, 4242, -1), back1 = carsOnPiece(s0, len, 787, 0.7, 4242, -1);
  for (const v of back0) if (v - 10 >= 0) assert.ok(back1.some((w) => Math.abs(w - v + 10) < 1e-6), `car at ${v}`);
  // Density thins them: none at 0, at most a slot each CAR_S at 1.
  assert.equal(carsOnPiece(s0, len, 777, 0, 4242, 1).length, 0);
  const full = carsOnPiece(s0, len, 777, 1, 4242, 1);
  assert.ok(full.length >= Math.floor(len / CAR_S) - 1 && full.length <= CAR_SLOTS);
  // The phases: doubles from the clock alone, inside the wrap.
  const ms = Date.UTC(2026, 10, 23, 13, 0, 0);
  assert.deepEqual([...carPhases(ms)], [...carPhases(ms)]);
  const p0 = carPhases(ms), p1 = carPhases(ms + 1000);
  for (let c = 0; c < 4; c++) {
    assert.ok(p0[c] >= 0 && p0[c] < CAR_S * CAR_WRAP);
    const d = (p1[c] - p0[c] + CAR_S * CAR_WRAP) % (CAR_S * CAR_WRAP);
    assert.ok(Math.abs(d - CAR_SPEEDS[c]) < 1e-6, `speed ${c}`);
  }
});

test('v0.7.9 cars: thinnest late at night, fullest in the evening, continuous', () => {
  assert.ok(carDensity(3) < 0.2 && carDensity(18) === 1);
  assert.ok(carDensity(3) < carDensity(0) && carDensity(0) < carDensity(21));
  for (let h = 0; h < 24; h += 0.25) assert.ok(Math.abs(carDensity(h + 0.25) - carDensity(h)) < 0.1, `hour ${h}`);
  assert.equal(carDensity(24.5), carDensity(0.5));
  assert.ok(hash01(1, 2) >= 0 && hash01(1, 2) < 1 && hash01(1, 2) === hash01(1, 2));
});

test('v0.7.9 roads: the countries\' lamps: Korea and Japan whiter, China a mix, Europe sodium; left-hand traffic', () => {
  assert.ok(countryMeta('KR').led > 0.8 && countryMeta('JP').led > 0.8);
  assert.ok(countryMeta('CN').led > 0.3 && countryMeta('CN').led < 0.7);
  for (const c of ['FR', 'DE', 'GB', 'ES']) assert.ok(countryMeta(c).led < 0.3, c);
  assert.deepEqual(['JP', 'GB', 'IE', 'KR', 'FR', 'CN'].map((c) => countryMeta(c).left), [true, true, true, false, false, false]);
});

test('v0.7.9 roads: the shaders are whole (no template left), and the switch is on by default', () => {
  const t = roadShaders({ UNIFORMS_GLSL: '', NOISE_GLSL: '', HEIGHT_GLSL: '', ATMOS_GLSL: '' });
  for (const s of [t.lamp, t.car, t.frag]) assert.ok(!s.includes('${'));
  assert.ok(t.car.includes('uCarPhase') && t.lamp.includes('stride'));
  assert.equal(LIGHTS79, process.env.FS_LIGHTS79 !== '0');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import('${new URL('../src/world/roadlights.js', import.meta.url).href}').then((m) => console.log('L79', m.LIGHTS79))`],
  { encoding: 'utf8', env: { ...process.env, FS_LIGHTS79: '0' } });
  assert.match(r.stdout, /L79 false/);
  // world.js makes the part only with the switch on.
  const w = readFileSync(GAME + 'src/world/world.js', 'utf8');
  assert.match(w, /rlMod\?\.LIGHTS79 \? optional\('road lights'/);
});

// The installed cells (once data/roads/ and data/europe/roads/ are in): every listed file there, parsing to the index's
// counts, every vertex inside its 64 km cell, and the region's total under 10 MB.
for (const dir of ['data/roads/', 'data/europe/roads/']) {
  const idxPath = GAME + dir + 'roads.json';
  test(`v0.7.9 roads: ${dir} as indexed`, { skip: !existsSync(idxPath) && 'not installed' }, () => {
    const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
    assert.equal(idx.version, 1); assert.equal(idx.cell, 64000);
    let bytes = 0;
    for (const [key, t] of Object.entries(idx.tiles)) {
      const buf = readFileSync(GAME + dir + t.file);
      assert.equal(buf.length, t.bytes, key);
      bytes += buf.length;
      const lines = parseRoadTile(gunzipSync(buf));
      assert.equal(lines.length, t.lines, key);
      let nv = 0;
      for (const l of lines) {
        nv += l.x.length;
        assert.ok(l.cls <= 3 && l.x.length >= 2);
        for (let v = 0; v < l.x.length; v++) assert.ok(l.x[v] >= 0 && l.x[v] <= 64000 && l.y[v] >= 0 && l.y[v] <= 64000, key);
      }
      assert.equal(nv, t.vertices, key);
    }
    assert.equal(bytes, idx.totals.bytes);
    assert.ok(bytes < 10e6, `${bytes} bytes`);
  });
}

// The part over Tokyo and Paris at 3,000 ft (node, stub chunks, the installed cells read from disk): the instance counts
// the brief asks for (a few tens of thousands near the camera, two draw calls), and every listed piece drawn (three.js
// caps an instanced draw at its first attributes' size unless told otherwise: the grown arrays must be drawn whole).
for (const [name, region, lat, lon] of [['Tokyo', 'east-asia', 35.68, 139.76], ['Paris', 'europe', 48.857, 2.35]]) {
  const dir = region === 'europe' ? 'data/europe/' : 'data/';
  const REG = (await import('../src/world/regions.js')).REGION_ID;
  test(`v0.7.9 roads: the part over ${name}`, { skip: (REG !== region && 'other region') || (!existsSync(GAME + dir + 'roads/roads.json') && 'not installed') }, async () => {
    const THREE = await import('../vendor/three.module.js');
    const { createRoadLights } = await import('../src/world/roadlights.js');
    const { toMap } = await import('../src/world/frame.js');
    const rl = createRoadLights(new THREE.Scene(), { uNight: { value: 1 } }, { UNIFORMS_GLSL: '', NOISE_GLSL: '', HEIGHT_GLSL: '', ATMOS_GLSL: '' }, {
      baseUrl: GAME + dir, fetchJson: async (p) => JSON.parse(readFileSync(p, 'utf8')),
      loader: async (p) => { const b = gunzipSync(readFileSync(p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });
    const [x, y] = toMap(lat, lon);
    let r;
    for (let k = 0; k < 80; k++) { await new Promise((ok) => setTimeout(ok, 2)); r = rl.update({ camMap: { x, y } }); }
    const c = rl.counts;
    assert.equal(r.drawCalls, 2);
    assert.ok(c.lampPieces > 4096 && c.lampPieces < 40000, `lamps ${c.lampPieces}`);
    assert.ok(c.carPieces > 500 && c.carPieces < 12000, `cars ${c.carPieces}`);
    for (const pts of rl.object.children) {
      assert.equal(pts.geometry._maxInstanceCount, undefined, pts.name);
      assert.ok(pts.geometry.attributes.seg.count >= pts.geometry.instanceCount, pts.name);
    }
    console.log(`# ${name}: ${c.lampPieces} lamp pieces, ${c.carPieces} car pieces, ${c.cells} cells, ${r.lights} slots`);
  });
}
