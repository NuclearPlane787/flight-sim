// v0.7.9 part 8, items 2 and 4 (briefs/V0-7-9.md; src/world/landmark-models.js bergisel79() behind ?bergisel79 /
// FS_BERGISEL79, ndgRock79() behind ?ndg79 / FS_NDG79, both on by default): the Bergisel jump's in-run with its depth,
// Notre-Dame de la Garde on a limestone rock. Switched off, both models (two bearings, two profiles) and both entries are
// the pushed v0.7.8's by SHA-256 (taken from the frozen v0.7.8 with tests/v079-looks-hash.mjs, first 16 hex digits);
// switched on, those two models change and every other landmark is as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inRegion } from './region-run.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HELPER = fileURLToPath(new URL('./v079-looks-hash.mjs', import.meta.url));
const V078 = { models: { bergisel: ['c308e36f43f15f9f', '68cc2f68fc1e2336'], ndg: ['7b242f6272a56b2c', '71b9e6e98b253bea'] },
  entries: { bergisel: '83b9bc4169893ac5', ndg: '7902c06148290e4c' } };

if (inRegion('europe', import.meta.url)) {
  const helper = (env) => {
    const r = spawnSync(process.execPath, [HELPER, '', 'models'], { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, FS_REGION: 'europe', ...env } });
    const m = /HASH79 (\{.*\})/.exec(r.stdout + r.stderr);
    assert.ok(m, r.stdout + r.stderr);
    return JSON.parse(m[1]);
  };
  // every Europe landmark's model, lights and entry, hashed in a child (the switches are read once, at import)
  const all = (env) => {
    const code = `
      import { createHash } from 'node:crypto';
      const { EUROPE_LANDMARKS, buildModel, bridgeEnds } = await import(${JSON.stringify(ROOT + 'src/world/landmarks.js')});
      const out = {};
      for (const L of EUROPE_LANDMARKS) {
        const { geometry: g, lights } = buildModel(L, L.kind === 'bridge' ? bridgeEnds(L, () => 4) : null);
        const h = createHash('sha256');
        for (const a of ['position', 'normal', 'aCol', 'aFac', 'aExt', 'aGlow']) { const arr = g.getAttribute(a).array; h.update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)); }
        h.update(JSON.stringify(lights)); h.update(JSON.stringify(L));
        out[L.id] = h.digest('hex').slice(0, 16);
      }
      console.log(JSON.stringify(out));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, FS_REGION: 'europe', NODE_TEST_CONTEXT: undefined, ...env }, encoding: 'utf8', maxBuffer: 16 << 20 });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim().split('\n').pop());
  };

  test('v0.7.9 looks, models: switched off, the Bergisel jump and Notre-Dame de la Garde are v0.7.8\'s by SHA-256', () => {
    assert.deepEqual(helper({ FS_BERGISEL79: '0', FS_NDG79: '0' }), V078);
  });
  test('v0.7.9 looks, models: each switch changes its own model only; every other landmark as it was', () => {
    const ON = { FS_BERGISEL79: '1', FS_NDG79: '1' };   // (explicit: the parent's environment may hold either off)
    const on = helper(ON), b = helper({ ...ON, FS_NDG79: '0' }), n = helper({ ...ON, FS_BERGISEL79: '0' });
    for (const k of [0, 1]) {
      assert.notEqual(on.models.bergisel[k], V078.models.bergisel[k]);
      assert.notEqual(on.models.ndg[k], V078.models.ndg[k]);
    }
    assert.deepEqual(b.models.ndg, V078.models.ndg);
    assert.deepEqual(n.models.bergisel, V078.models.bergisel);
    assert.equal(on.entries.bergisel, V078.entries.bergisel, 'the jump\'s entry as it was');
    assert.notEqual(on.entries.ndg, V078.entries.ndg, 'the basilica\'s footprint out to its rock');
    const A = all(ON), B = all({ FS_BERGISEL79: '0', FS_NDG79: '0' });
    assert.deepEqual(Object.keys(A), Object.keys(B));
    for (const id of Object.keys(A)) if (id !== 'bergisel' && id !== 'ndg') assert.equal(A[id], B[id], id);
    assert.notEqual(A.bergisel, B.bergisel);
    assert.notEqual(A.ndg, B.ndg);
  });

  test('v0.7.9 looks, Bergisel: the in-run a ramp with a body: the track between walls, a girder under it, legs to the slope', async () => {
    const M = await import('../src/world/landmark-models.js');
    const { EUROPE_LANDMARKS, buildModel } = await import('../src/world/landmarks.js');
    assert.equal(M.BERGISEL79, process.env.FS_BERGISEL79 !== '0');
    if (!M.BERGISEL79) return;
    const L = EUROPE_LANDMARKS.find((l) => l.id === 'bergisel');
    assert.equal(L.brg, 0);
    const S = M.BERGISEL79_SIZES, g = (n) => M.profAt(M.BERGISEL_PROF, n);
    const p = buildModel(L).geometry.getAttribute('position');
    // the vertical extent of what stands within each band of local x, at a slice of the in-run (n = -40 +- 3)
    const band = (x0, x1, n0 = -43, n1 = -37) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < p.count; i++) {
        const x = Math.abs(p.getX(i)), n = -p.getZ(i), y = p.getY(i);
        if (x >= x0 && x <= x1 && n >= n0 && n <= n1) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
      }
      return [lo, hi];
    };
    const wx = S.hw - S.wallT;   // the walls' inner faces
    const [tl, th] = band(wx - 0.01, wx + 0.01), [gl, gh] = band(S.hw - 0.01, S.hw + 0.01, -47, -41);   // (the side, between two legs)
    assert.ok(th - tl > S.wall - 0.01, `the track's wall stands ${(th - tl).toFixed(2)} m`);
    assert.ok(gh - gl > S.wall + S.slab + S.girderD - 0.01, `the in-run's side ${(gh - gl).toFixed(2)} m deep at n = -44 (v0.7.8's deck: 1.6 m)`);
    assert.ok(gl - g(-44) > 1, 'the girder clear of the slope there');
    // the width: 5.2 m across, v0.7.8's 4.4
    let w = 0;
    for (let i = 0; i < p.count; i++) { const n = -p.getZ(i); if (n > -60 && n < 0) w = Math.max(w, Math.abs(p.getX(i))); }
    assert.ok(Math.abs(w - S.hw) < 0.01, `half width ${w}`);
    // the legs: their feet in the slope (under it by 0.5 to 2.5 m), every 12 m from n = -74
    let feet = 0;
    for (let i = 0; i < p.count; i++) {
      const x = Math.abs(p.getX(i)), n = -p.getZ(i), y = p.getY(i);
      if (Math.abs(x - S.legX) <= S.legHw + 0.01 && n > -84 && n < 5 && y < g(n)) { feet++; assert.ok(g(n) - y < 2.6, `a foot ${(g(n) - y).toFixed(2)} m under the slope`); }
    }
    assert.ok(feet >= 16, `${feet} foot vertices`);
    assert.ok(p.count / 3 < 4000, `${p.count / 3} triangles`);
  });

  const TILES = ROOT + 'data/europe/manifest.json';
  test('v0.7.9 looks, Notre-Dame de la Garde: the rock\'s foot under the installed ground all round, its top out of it on the north, south and west, the basilica where it stood', { skip: !existsSync(TILES) }, async () => {
    const M = await import('../src/world/landmark-models.js');
    if (!M.NDG79) return;
    const { EUROPE_LANDMARKS, buildModel, baseHeight } = await import('../src/world/landmarks.js');
    const { tiledTerrain } = await import('./tile-terrain.mjs');
    const { hf } = await tiledTerrain({ layers: ['h'], airports: [], maxTiles: 40 });
    const L = EUROPE_LANDMARKS.find((l) => l.id === 'ndg');
    await hf.tiles.whenReady(L.x, L.y, 2000, 'test');
    const H = (x, y) => hf.heightAt(x, y), base = baseHeight(L, H);
    assert.ok(Math.abs(base - 135.7) < 0.1, `the base ${base.toFixed(2)} m, v0.7.8's 135.7`);
    assert.equal(L.footprintM, M.NDG79_ROCK_R);
    assert.deepEqual(L.parts, [[0, 0, 46]]);
    const p = buildModel(L).geometry.getAttribute('position');
    const R = M.NDG79_ROCK, foot = R[R.length - 1][0], top = R[0][0];
    let worstFoot = -Infinity, out = { N: 0, S: 0, W: 0 }, far = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), gy = H(L.x + x, L.y - z) - base;
      far = Math.max(far, Math.hypot(x, z));
      if (Math.abs(y - foot) < 1e-3) worstFoot = Math.max(worstFoot, y - gy);
      if (Math.abs(y - top) < 1e-3 && Math.hypot(x, z) > 30) {   // (the top ring, not its cap's middle)
        const d = y - gy, a = Math.atan2(x, -z) * 180 / Math.PI;   // 0 north, 90 east
        if (Math.abs(a) < 45) out.N = Math.max(out.N, d); else if (Math.abs(a) > 135) out.S = Math.max(out.S, d); else if (a < 0) out.W = Math.max(out.W, d);
      }
    }
    assert.ok(worstFoot < -3, `the rock's foot ${worstFoot.toFixed(1)} m under the ground at its highest`);
    for (const k of ['N', 'S', 'W']) assert.ok(out[k] > 5, `the ${k} face stands ${out[k].toFixed(1)} m out of the ground`);
    assert.ok(far <= L.footprintM, `the rock within its footprint (${far.toFixed(1)} m)`);
  });
}
