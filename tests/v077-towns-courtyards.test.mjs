// v0.7.7 part 1, the towns (briefs/V0-7-7.md): Europe's thirty-four real centres baked again as FSB2, FSB1 with each
// record's inner rings (courtyards) appended (tools/bake_region_buildings.py), and drawn open (centres-worker.js: the roof
// cut round them by earcut, walls on each inner ring) behind ?towns77 (node FS_TOWNS77), on by default.
//  - switched off (holes: false), every centre builds exactly what the pushed v0.7.6 built: SHA-256 of the buffers, taken
//    from the frozen v0.7.6 (its files built by its own centres-worker.js), first 32 hex digits;
//  - East Asia's twenty centres (FSB1, not baked again) build the same with the switch on;
//  - a synthetic courtyard: the roof's area is the ring's less the courtyard's, its walls face into it.
// FS_EU_CENTRES_DIR points it at a staging folder:
//   FS_EU_CENTRES_DIR=/tmp/flight-sim/v077/towns/install/centres node --test tests/v077-towns-courtyards.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseCentre, buildCentre, ringArea2, MAGIC2 } from '../src/world/centres-worker.js';

const V076 = {
  london: '055fa729a2fb1198c64b069e406cc577',
  paris: 'faf40c8e81b51fd20e88d3c3eed387d4',
  frankfurt: '84e01f116f7c661146b93116b015e394',
  madrid: 'bfd98f88c59e29eee9055e24060754fe',
  zurich: '9a690883c9245b1fff00c32851cd023c',
  amsterdam: '861d9bfac8c4d01e72a9eef524565c77',
  munich: '99c31dd912e21c820abedbb4418b78dc',
  barcelona: '9943426436bf3e535e6ad73d404d105d',
  rome: '7a92dfa750aa7aa44dd7228dbd8c1ab3',
  toulouse: 'd479094f4a6cbe1a43035d20486b1fe7',
  berlin: 'e62d43ba049bd4d51493a3acefefd3ef',
  milan: 'becfd8164f63185b8bf9f8eab7b76bbf',
  vienna: 'bed455860930f202d2dbd48ad9bef457',
  brussels: '613d3835d65dc0482cc0a54777a5db54',
  dublin: '8ef87a822399075cd57430b619cbc162',
  lisbon: '84ef6c90ee13be6dd2922c6ef2150395',
  copenhagen: '40ac547560b0a3c52f9e575a68e84172',
  manchester: '3e8b27c95ef8b3233e9daaae08e20482',
  duesseldorf: 'b6c875ee1494be56eeb75d9904aaec77',
  cologne: '1d5019c0862400b5659a6462eacd86fe',
  prague: '7865aefa22fc11051e24dc7767783b5c',
  geneva: '67c14355d0c6d66bc8ffe55b365ead06',
  nice: '730b8d0cda086b70680c3ce936ce5bfc',
  edinburgh: '5576f0efaa54881cee7972216c23bb16',
  glasgow: '7b512984d6101f02179d4d61e574fccd',
  nantes: 'c8eb1155b1b7f5eb7729a541429d31ca',
  santiago: '0ae1c5a8413bd0347f498c99c7fc4c90',
  hamburg: 'c45a320bf279910b4d846b0a54d739c7',
  venice: '6c1e114d1ee8aee564ac50c0e53a09b4',
  marseille: '3c3743bace9b31ad7fc294b7fcb682bd',
  lyon: '30404660eb19355b6bc623aec4f2e04f',
  porto: '7a4b9c5f142fd5c7d87a88a767e53fd0',
  naples: '82449f24a9e445c8a9181fca2ccc9aa4',
  zaragoza: 'dbf73cf9e3c12c07d8b3309bc1ecd92e',
  tokyo: '82e75be561f6b60a5c92efe27156ddc1',
  yokohama: '61899547eb0785866423c2dd4c66b6d3',
  shanghai: '82b2fd96c4db7cc80a1508932768644e',
  qingdao: 'df2e57ef736e95b8b171b0246a4eef3c',
  seoul: '5e8df88607d8792fa20ba009f5f0b583',
  songdo: '4c6d6d3cec4d667c5ef0c830b3dd3d59',
  busan: 'fc119be74c6925a62e12a7393b1a6552',
  osaka: '9c0eb8d25ff4e111a0ba3fdbaddd1e47',
  fukuoka: '4c814efd17f4b2fa38b3b7a46f34ea3c',
  beijing: '1c2f43cd580f3b48a0e05c8a1771dba2',
  tianjin: 'a5b0a9b51505a3b070994d57a089e773',
  shenyang: 'dd39b4d371cce42283738c056aea7a2c',
  dalian: 'a96d3cf52f848919eea5b5e52d558881',
  vladivostok: '158b9a48f0248c802f9035ca9f049c98',
  pyongyang: '1cccbdb52c7aaacc33e995d493bf1d1b',
  sapporo: 'c2a9d19b2d9f18d6cf474bb91f5460dc',
  sendai: 'e7939cdd6a8a17ae71ef4c4883f8eab2',
  niigata: '68ced6f2d85006bac52284d1a2685a8d',
  nagoya: 'e1f7cb9ec3aa579cbfccac2e7adc80d1',
  hiroshima: 'ef2c45a1e3c569e1c4d64d56f61abf78',
};
const EA = new URL('../data/centres/', import.meta.url);
const dir = process.env.FS_EU_CENTRES_DIR;
const EU = dir ? pathToFileURL(dir.endsWith('/') ? dir : dir + '/') : new URL('../data/europe/centres/', import.meta.url);
const index = (u) => (existsSync(new URL('centres.json', u)) ? JSON.parse(readFileSync(new URL('centres.json', u), 'utf8')).centres : []);
const raw = (u, info) => gunzipSync(readFileSync(new URL(info.file, u)));
const hashOf = (r) => {
  const h = createHash('sha256');
  for (const t of [r.tall, r.low]) for (const a of [t.aP, t.aB, t.aN, t.index]) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  for (const a of [r.tall.top, r.tall.end, r.low.chunkStart, r.mask, r.lights]) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  return h.digest('hex').slice(0, 32);
};

test("v0.7.7 towns: switched off, Europe's thirty-four centres build v0.7.6's buffers exactly", () => {
  // (v0.7.8: Kaiserslautern is the thirty-fifth; it has no v0.7.6 build to equal and is left out here: tests/v078-eu-centres.test.mjs)
  const list = index(EU).filter((c) => c.id !== 'kaiserslautern');
  assert.equal(list.length, 34);
  for (const info of list) {
    const b = raw(EU, info);
    assert.equal(hashOf(buildCentre(parseCentre(b), info)), V076[info.id], info.id + ' (FSB1 read)');
    assert.equal(hashOf(buildCentre(parseCentre(b, { holes: true }), info, { holes: false })), V076[info.id], info.id + ' (rings parsed, not drawn)');
  }
});

test("v0.7.7 towns: East Asia's twenty centres the same with the switch on", () => {
  // (v0.7.8: Kanazawa, the twenty-first, is new and has no v0.7.6 build to equal: tests/v078-ea-centres.test.mjs holds it.)
  const list = index(EA).filter((c) => c.id !== 'kanazawa');
  assert.equal(list.length, 20);
  for (const info of list) {
    const b = raw(EA, info);
    assert.equal(b.readUInt32LE(0), 0x31425346, info.id + ' still FSB1');
    assert.equal(hashOf(buildCentre(parseCentre(b, { holes: true }), info, { holes: true })), V076[info.id], info.id);
  }
});

test('v0.7.7 towns: the courtyards drawn open, within the budgets', { skip: index(EU).every((c) => !c.holes) && 'FSB2 not installed yet' }, () => {
  let rings = 0, drawn = 0, t0 = 0, t1 = 0;
  for (const info of index(EU)) {
    const b = raw(EU, info);
    assert.equal(b.readUInt32LE(0), MAGIC2, info.id + ' is FSB2');
    const p = parseCentre(b, { holes: true });
    assert.equal(p.holes ? p.holes.count : 0, info.holes, info.id + ': rings as the index says');
    const off = buildCentre(p, info, { holes: false }), on = buildCentre(p, info, { holes: true });
    rings += info.holes; drawn += on.holes;
    const a = off.tall.tris + off.low.tris, c = on.tall.tris + on.low.tris;
    t0 += a; t1 += c;
    assert.ok(on.holes >= 0.95 * info.holes, `${info.id}: ${on.holes} of ${info.holes} drawn`);
    assert.ok(c <= a * 1.12, `${info.id}: ${a} -> ${c} triangles`);
    assert.deepEqual([...on.mask], [...off.mask], info.id + ': the mask unchanged');
    assert.equal(on.kept, off.kept);
  }
  assert.ok(rings > 6000 && drawn >= 0.99 * rings, `${drawn} of ${rings}`);
  assert.ok(t1 < t0 * 1.04, `all: ${t0} -> ${t1}`);
});

test('v0.7.7 towns: a synthetic courtyard', () => {
  // one record, a 40 x 30 m block (CCW) round a 20 x 10 m courtyard (CW), 0.5 m units; then the ring section
  const outer = [[-40, -30], [40, -30], [40, 30], [-40, 30]], hole = [[-20, -10], [-20, 10], [20, 10], [20, -10]];
  const n = outer.length, m = hole.length;
  const buf = Buffer.alloc(12 + 8 + n * 4 + 8 + 8 + m * 4);
  buf.write('FSB2', 0, 'latin1'); buf.writeUInt32LE(1, 4); buf.writeUInt32LE(n, 8);
  buf.writeUInt16LE(200, 12); buf.writeUInt16LE(0, 14); buf.writeUInt8(n, 16); buf.writeUInt8(0, 17);
  let o = 20;
  for (const [x, y] of outer) { buf.writeInt16LE(x, o); buf.writeInt16LE(y, o + 2); o += 4; }
  buf.writeUInt32LE(1, o); buf.writeUInt32LE(m, o + 4); o += 8;
  buf.writeUInt32LE(0, o); buf.writeUInt16LE(m, o + 4); o += 8;
  for (const [x, y] of hole) { buf.writeInt16LE(x, o); buf.writeInt16LE(y, o + 2); o += 4; }
  const info = { id: 't', origin: [0, 0], box: [-500, -500, 500, 500], cols: 2, rows: 2 };
  assert.equal(parseCentre(buf).holes, undefined, 'rings not read unless asked');
  const p = parseCentre(buf, { holes: true });
  const r = buildCentre(p, info, { holes: true }), r0 = buildCentre(p, info, { holes: false });
  assert.equal(r.holes, 1);
  assert.equal(r0.low.tris, n * 2 + 2);
  const L = r.low, Q = 32767;
  assert.equal(L.tris, (n + m) * 2 + (n + m + 2 * 1 - 2), 'walls on both rings, the roof round the courtyard');
  // the roof's area: every triangle whose three vertices are roof vertices (aN.w = 127)
  let roof = 0, inWalls = 0;
  for (let t = 0; t < L.index.length; t += 3) {
    const [a, b, c] = [L.index[t], L.index[t + 1], L.index[t + 2]];
    if (L.aN[a * 4 + 3] === 127) {
      const xs = [a, b, c].map((v) => L.aP[v * 4] / 2), ys = [a, b, c].map((v) => L.aP[v * 4 + 1] / 2);
      const a2 = ringArea2(xs, ys, 3);
      assert.ok(a2 > 0, 'roof triangles counter-clockwise');
      roof += a2 / 2;
    }
  }
  assert.equal(roof, 40 * 30 - 20 * 10);
  // the courtyard's walls: their normals point to its middle (0, 0)
  for (let v = 0; v < L.verts; v++) {
    if (L.aN[v * 4 + 3] !== 0) continue;
    const x = L.aP[v * 4] / 2, y = L.aP[v * 4 + 1] / 2;
    if (Math.abs(x) <= 10 && Math.abs(y) <= 5) { inWalls++; assert.ok(L.aN[v * 4] * -x + L.aN[v * 4 + 1] * -y > 0, 'faces the courtyard'); }
  }
  assert.equal(inWalls, m * 4);
});

test('v0.7.7 towns: the switch', async () => {
  const { towns77Switch } = await import('../src/world/centres.js');
  const was = process.env.FS_TOWNS77;
  process.env.FS_TOWNS77 = '0';
  assert.equal(towns77Switch(), false);
  delete process.env.FS_TOWNS77;
  assert.equal(towns77Switch(), true);
  if (was !== undefined) process.env.FS_TOWNS77 = was;
});

test('v0.7.7 towns: a ring of two vertices or of no area is skipped (no fin inside a closed roof)', () => {
  // one record, the same 40 x 30 m block, with three rings: two vertices, three in a line (no area), a real courtyard
  const outer = [[-40, -30], [40, -30], [40, 30], [-40, 30]];
  const rings = [[[-10, 0], [10, 0]], [[-10, 0], [0, 0], [10, 0]], [[-20, -10], [-20, 10], [20, 10], [20, -10]]];
  const nv = rings.reduce((a, r) => a + r.length, 0);
  const buf = Buffer.alloc(12 + 8 + outer.length * 4 + 8 + rings.length * 8 + nv * 4);
  buf.write('FSB2', 0, 'latin1'); buf.writeUInt32LE(1, 4); buf.writeUInt32LE(outer.length, 8);
  buf.writeUInt16LE(200, 12); buf.writeUInt16LE(0, 14); buf.writeUInt8(outer.length, 16);
  let o = 20;
  for (const [x, y] of outer) { buf.writeInt16LE(x, o); buf.writeInt16LE(y, o + 2); o += 4; }
  buf.writeUInt32LE(rings.length, o); buf.writeUInt32LE(nv, o + 4); o += 8;
  for (const r of rings) { buf.writeUInt32LE(0, o); buf.writeUInt16LE(r.length, o + 4); o += 8; }
  for (const r of rings) for (const [x, y] of r) { buf.writeInt16LE(x, o); buf.writeInt16LE(y, o + 2); o += 4; }
  const info = { id: 't', origin: [0, 0], box: [-500, -500, 500, 500], cols: 2, rows: 2 };
  const r = buildCentre(parseCentre(buf, { holes: true }), info, { holes: true });
  assert.equal(r.holes, 1, 'only the real courtyard');
  assert.equal(r.low.tris, (4 + 4) * 2 + (4 + 4 + 2 - 2), 'walls on the outer ring and the courtyard only');
});
