// v0.7.7 part 1, the towns (briefs/V0-7-7.md): the generated town blended round Europe's real centres, low suburbs past
// them, and no block on the 31 m cover's water (cities.js towns77Vert(), behind ?towns77 / FS_TOWNS77, on by default).
// Switched off, Europe's town shader is the pushed v0.7.6's text character for character; East Asia's is v0.7.6's either
// way (SHA-256 of the texts as v0.7.6's own cities.js builds them with these stub chunks, first 16 hex digits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REGION_ID } from '../src/world/regions.js';

const V076 = { eaVert: 'a7aa4667aec22dd9', euVert: 'e35ff25fc1fd5e04', frag: '7c5a9d8d96864193' };
// v0.7.7: Europe's text with towns77 on and suburbs77 off (pieces 2 and 4 alone; unchanged by round 3), pinned from this tree (there is no
// older text to take it from): it only detects a change, and a deliberate change to those splices updates it.
const V077 = { suburbsOff: 'd22a1954d2a73e14' };
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const chunks = { UNIFORMS_GLSL: '/*U*/', NOISE_GLSL: '/*N*/', HEIGHT_GLSL: '/*H*/', ATMOS_GLSL: '/*A*/', MAX_RUNWAYS: 8 };
async function texts() {
  const THREE = await import('../vendor/three.module.js');
  const { createCities } = await import('../src/world/cities.js');
  const c = createCities(new THREE.Scene(), { uNat: { value: { x: 0, y: 0, z: 250 } } }, chunks);
  const m = c.mesh.children[0].material;
  return { c, vert: m.vertexShader, frag: m.fragmentShader, uniforms: m.uniforms };
}

if (process.env.FS_T77_CHILD) {
  // the child: print the texts' hashes for the region and the switch it was opened with
  test('child', async () => { const t = await texts(); console.log(`T77 ${REGION_ID} ${sha(t.vert)} ${sha(t.frag)} ${t.c.towns77} ${'uCtr' in t.uniforms}`); });
} else {
  const run = (region, on) => {
    const r = spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], { encoding: 'utf8',
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, FS_T77_CHILD: '1', FS_REGION: region, FS_TOWNS77: on ? '1' : '0', FS_TOWERS78: '0' } });   // (v0.7.8: the towers' switch off, as these texts were pinned; tests/v078-towers.test.mjs pins it on)
    const m = /T77 (\S+) (\S+) (\S+) (\S+) (\S+)/.exec(r.stdout + r.stderr);
    assert.ok(m, r.stdout + r.stderr);
    return { region: m[1], vert: m[2], frag: m[3], on: m[4] === 'true', uCtr: m[5] === 'true' };
  };
  test("v0.7.7 towns: switched off, Europe's town shader is v0.7.6's text", () => {
    const t = run('europe', false);
    assert.equal(t.region, 'europe');
    assert.deepEqual([t.vert, t.frag, t.on, t.uCtr], [V076.euVert, V076.frag, false, false]);
  });
  test("v0.7.7 towns: East Asia's town shader is v0.7.6's with the switch on or off", () => {
    for (const on of [true, false]) {
      const t = run('', on);
      assert.deepEqual([t.vert, t.frag, t.on, t.uCtr], [V076.eaVert, V076.frag, false, false], `switch ${on}`);
    }
  });
  test('v0.7.7 suburbs: ?suburbs77=0 keeps the blend and the river rule, without the suburbs\' splices', async () => {
    const r = spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], { encoding: 'utf8',
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, FS_T77_CHILD: '1', FS_REGION: 'europe', FS_TOWNS77: '1', FS_SUBURBS77: '0', FS_TOWERS78: '0' } });   // (v0.7.8: the towers' switch off)
    const m = /T77 (\S+) (\S+) (\S+) (\S+) (\S+)/.exec(r.stdout + r.stderr);
    assert.ok(m, r.stdout + r.stderr);
    assert.equal(m[2], V077.suburbsOff, 'the blend and the river rule alone');
    assert.notEqual(m[2], V076.euVert);
  });
  test("v0.7.7 towns: switched on, Europe's shader takes the blend", () => {
    const t = run('europe', true);
    assert.notEqual(t.vert, V076.euVert);
    assert.equal(t.frag, V076.frag);
    assert.ok(t.on && t.uCtr);
  });
  test('v0.7.7 towns: towns77Vert() splices every anchor once, inside Europe\'s branches, or throws', async () => {
    const { towns77Vert, euVert } = await import('../src/world/cities.js');
    assert.throws(() => towns77Vert('void main() {}'));
    const { vert } = await texts();
    const eu = REGION_ID === 'europe' ? vert : null;
    if (eu) {
      assert.equal(eu.split('if (ctry >= 3) {').length - 1, 3, "euVert's three branches, as v0.7.0's test counts");
      for (const s of ['uniform vec4 uCtr[4];', 'float towns77Dist(vec2 p)', 'float fineWater(vec2 fp)', 'int t77Block(', 'bool town = tB == 0;', 'if (tB == 1) {']) assert.ok(eu.includes(s), s);
      assert.throws(() => towns77Vert(eu), 'not twice');
    }
    assert.equal(typeof euVert, 'function');
  });
}

if (!process.env.FS_T77_CHILD) {
  test("v0.7.7 suburbs: the suburbs' splices are absent with suburbs77 off and present with it on", async () => {
    const { towns77Vert, euVert } = await import('../src/world/cities.js');
    // a Europe text built here from East Asia's by euVert() (the region doesn't matter for the splicing itself)
    const THREE = await import('../vendor/three.module.js');
    const { createCities } = await import('../src/world/cities.js');
    const c = createCities(new THREE.Scene(), { uNat: { value: { x: 0, y: 0, z: 250 } } }, chunks);
    const ea = c.mesh.children[0].material.vertexShader;
    if (REGION_ID === 'europe') return;   // (East Asia's text is the template; Europe's process already spliced it)
    const eu = euVert(ea);
    const off = towns77Vert(eu, false), on = towns77Vert(eu, true);
    for (const s of ['float towns77Dist(vec2 p)', 'keep *= step(ihash(sk, 37u)', 'float fineWater(vec2 fp)']) { assert.ok(off.includes(s), s); assert.ok(on.includes(s), s); }
    for (const s of ['int t77Block(', 'if (tB == 1) {', 'v0.7.7 suburbs']) { assert.ok(!off.includes(s), 'off: ' + s); assert.ok(on.includes(s), 'on: ' + s); }
  });
}
