// v0.7.7 country (briefs/V0-7-7.md part 2): Europe's countryside by the country raster, behind ?fields77=0 (node
// FS_FIELDS77=0). Off, the terrain's shader texts are the pushed v0.7.6's character for character (the hashes below were
// taken from the pushed v0.7.6's own files, built the same way); East Asia's are v0.7.6's with the switch on or off.
// The towns' switch (FS_TOWNS77=0) is held off in these builds, so a change of theirs in the same shader isn't read as ours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { inRegion } from './region-run.mjs';

const HELPER = fileURLToPath(new URL('./v077-country-hash.mjs', import.meta.url));
const build = (env) => {
  const r = spawnSync(process.execPath, [HELPER], { env: { ...process.env, NODE_TEST_CONTEXT: undefined, FS_TOWNS77: '0', ...env }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
};
const V076 = {
  eastasia: { vert: '7aecf5da04d4e1364acfbabf8a7c21929da5e4820e5c931f8c566c301bfdb509', frag: 'f67e6fb5cfeef5a35d6c6736d0fa7d3262ca5739b900d35005108b5c7ab2ce10' },
  europe: { vert: '5c0430ae156011fb4a5032f8ebcff908bf41b29c7c33a36398aef4d6780fc8a4', frag: 'c0b83a67ea13d1f44b6cb857c3b7c51b1e5f77edd6f077fc172619ed631eadbd' },
};

test("switched off, Europe's terrain shader is the pushed v0.7.6's, character for character", () => {
  const b = build({ FS_REGION: 'europe', FS_FIELDS77: '0' });
  assert.equal(b.vert, V076.europe.vert);
  assert.equal(b.frag, V076.europe.frag);
  assert.ok(!b.uniforms.includes('uEuZone'));
});
test("East Asia's terrain shader is the pushed v0.7.6's with the switch on and off", () => {
  for (const sw of ['1', '0']) {
    const b = build({ FS_REGION: 'eastasia', FS_FIELDS77: sw });
    assert.equal(b.vert, V076.eastasia.vert, sw);
    assert.equal(b.frag, V076.eastasia.frag, sw);
    assert.deepEqual(b.has, [], sw);
    assert.ok(!b.uniforms.includes('uEuZone'));
  }
});
test("switched on, Europe's shader has the country zones, the polders' grassland, the bare ground and the airfield grass", () => {
  const b = build({ FS_REGION: 'europe' });
  assert.equal(b.vert, V076.europe.vert);                                  // the vertex shader never changes
  assert.notEqual(b.frag, V076.europe.frag);
  assert.deepEqual(b.has, ['uEuZone', 'euZoneP', 'euPol', 'bg77', 'afg77', 'rough *= 1.0 - euPol', 'made * smoothstep(0.05, 0.30, cov250.b)']);
  // (the graders' lots on bare ground only in a town: v0.7.7's third round, the Bardenas' grid)
  assert.ok(b.uniforms.includes('uEuZone') && b.uniforms.includes('uEuZoneBox'));
});

// (euGroundGlsl()'s conic is the page's frame's: this one runs in Europe)
if (inRegion('europe', import.meta.url)) {
test("ground.js: Europe's splice switched off is v0.7.6's; switched on, every v0.7.7 anchor found once and no 8 km seam", async () => {
  const g = await import('../src/world/ground.js');
  assert.equal(createHash('sha256').update(g.euGroundGlsl(g.GROUND_GLSL, false)).digest('hex'), '1bc06fdaa9e9e6373537d0f7fca03fafb4336374b26a2e7a338008d946c14f33');
  const on = g.euGroundGlsl(g.GROUND_GLSL, true);
  assert.ok(!on.includes('did >> 3, 47u'), 'the 8 km cells of the polders\' direction are gone');
  for (const k of ['uniform sampler2D uEuZone;', 'textureLod(uEuZone', 'euP *= euZoneP;', 'ihash(did, 50u) < euSP', 'euPol = mix(euPol, eu == 3 ? smoothstep(0.0, 150.0, dEdge', 'euPol = euP * 0.584;', 'float euDy = min(ry, 1.0 - ry) * size.y;', 'euDw = min(1.0, 1.6 / (0.9 + aa));', 'green = step(t, 0.96); }', 'vnoise((m - dq) * 0.00003 + 17.0)']) assert.ok(on.includes(k), k);
  // nothing of East Asia's lost but v0.7.1's one narrowed greenhouse line
  assert.deepEqual(g.GROUND_GLSL.split('\n').filter((l) => l.trim() && !on.includes(l)), ['  if (dg > 0.78 && hv > 0.62 && paddy <= 0.5) {']);
});
}

test("the zone texture from Europe's country raster: each group where it belongs, soft at a border, never a staircase", async () => {
  const { euZoneData, EU_ZONE_FALLBACK } = await import('../src/world/ground.js');
  const dir = new URL('../data/europe/', import.meta.url);
  const header = JSON.parse(readFileSync(new URL('country.json', dir), 'utf8'));
  const values = new Uint8Array(gunzipSync(readFileSync(new URL(header.file, dir))));
  const z = euZoneData(header, values);
  assert.equal(z.data.length, header.nx * header.ny * 4);
  // Europe's frame, for the places (frame.js binds its region at import: a child process in Europe)
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { toMap } = await import(${JSON.stringify(new URL('../src/world/frame.js', import.meta.url).href)});
    const P = { dublin: [53.35, -6.26], london: [51.5, -0.12], paris: [48.85, 2.35], toulouse: [43.6, 1.44], madrid: [40.42, -3.7], lisbon: [38.72, -9.14],
      amsterdam: [52.37, 4.9], berlin: [52.52, 13.4], rome: [41.9, 12.5], zurich: [47.37, 8.54] };
    console.log(JSON.stringify(Object.fromEntries(Object.entries(P).map(([k, [a, o]]) => [k, toMap(a, o)]))));`], { env: { ...process.env, FS_REGION: 'europe' }, encoding: 'utf8' });
  const P = JSON.parse(r.stdout);
  const at = ([x, y]) => { const i = Math.floor((x - header.x0) / header.cell), j = Math.floor((y - header.y0) / header.cell); return Array.from(z.data.subarray((j * header.nx + i) * 4, (j * header.nx + i) * 4 + 4)); };
  const want = { dublin: [255, 0, 0, 0], london: [255, 0, 0, 0], paris: [0, 255, 0, 0], toulouse: [0, 255, 0, 0], madrid: [0, 0, 255, 0], lisbon: [0, 0, 255, 0],
    amsterdam: [0, 0, 0, 255], berlin: [0, 0, 0, 0], rome: [0, 0, 0, 0], zurich: [0, 0, 0, 0] };
  for (const [k, w] of Object.entries(want)) assert.deepEqual(at(P[k]), w, k);
  // soft: the weights take in-between values along the borders, the groups never sum past one, and from one cell to the
  // next no weight jumps by more than the triangle filter allows (a third of the whole, 85 of 255, plus rounding)
  let between = 0, maxStep = 0;
  for (let j = 0; j < header.ny; j++) for (let i = 0; i < header.nx; i++) {
    const p = (j * header.nx + i) * 4;
    const s = z.data[p] + z.data[p + 1] + z.data[p + 2];
    assert.ok(s <= 257, `sum ${s} at ${i},${j}`);
    for (let k = 0; k < 4; k++) {
      const v = z.data[p + k];
      if (v > 0 && v < 255) between++;
      if (i + 1 < header.nx) maxStep = Math.max(maxStep, Math.abs(v - z.data[p + 4 + k]));
      if (j + 1 < header.ny) maxStep = Math.max(maxStep, Math.abs(v - z.data[p + header.nx * 4 + k]));
    }
  }
  assert.ok(between > 20000, `${between} cells in between`);
  assert.ok(maxStep <= 86, `largest step ${maxStep}`);
  assert.deepEqual(Array.from(EU_ZONE_FALLBACK.data), [0, 0, 0, 255]);   // no raster: v0.7.1's rule everywhere, polders allowed
});
