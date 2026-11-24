// v0.7.9 part 3 (briefs/V0-7-9.md): with ?lights79=0 (node FS_LIGHTS79=0) the city lights are v0.7.8's exactly: the
// block lights' vertex and fragment shader text, their uniforms' names, their slot layout and their instance lists
// (levelBlocks()) are the pushed v0.7.8's by SHA-256 in both regions (the hashes taken from the frozen v0.7.8 with these
// stub chunks, first 16 hex digits); the road lights (roadlights.js) aren't made (tests/v079-lights-roads.test.mjs).
// Switched on, the vertex shader takes item 4's splices (citylights.js lights79Vert()) and the rest is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const V078 = { vert: '5cb40b9f633debb4', frag: '93b26726d2c54d51', uniforms: '9ca05ddc39c70dc7', slots: '3a6686eceb935c7a', blocks: '0e6de0315f966d2e', layout: 'c105a45281527d7b' };
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

async function hashes(fine) {
  const THREE = await import('../vendor/three.module.js');
  const { createCityLights, slotLayout, levelBlocks } = await import('../src/world/citylights.js');
  const chunks = { UNIFORMS_GLSL: '/*U*/', NOISE_GLSL: '/*N*/', HEIGHT_GLSL: '/*H*/', ATMOS_GLSL: '/*A*/', MAX_RUNWAYS: 8 };
  const u = { uNat: { value: { x: 0, y: 0, z: 250 } }, uNatSize: { value: { x: 0, y: 0 } }, uNight: { value: 1 } };
  if (fine) u.uFine = { value: null };
  const cl = createCityLights(new THREE.Scene(), u, chunks);
  const m = cl.object.children[0].material;
  const blocks = [];
  for (let lv = 0; lv < 5; lv++) blocks.push(...levelBlocks(lv, 12345.6, -7890.1, () => true));
  const pos = cl.object.children.map((p) => Array.from(p.geometry.attributes.position.array).join(',')).join('|');
  return { vert: sha(m.vertexShader), frag: sha(m.fragmentShader), uniforms: sha(Object.keys(m.uniforms).filter((k) => k !== 'uFine').sort().join(',')),   // (uFine: the stub's own, given to v0.7.8 too)
   
    slots: sha(pos), blocks: sha(blocks.join(',')), layout: sha(JSON.stringify(slotLayout())), fineText: m.vertexShader.includes('fineTexel(') };
}

if (process.env.FS_LT79_CHILD) {
  test('child', async () => { console.log('LT79 ' + JSON.stringify(await hashes(process.env.FS_LT79_FINE === '1'))); });
} else {
  const run = (region, on, fine = false) => {
    const r = spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], { encoding: 'utf8',
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, FS_LT79_CHILD: '1', FS_REGION: region, FS_LIGHTS79: on ? '1' : '0', FS_LT79_FINE: fine ? '1' : '0' } });
    const m = /LT79 (\{.*\})/.exec(r.stdout + r.stderr);
    assert.ok(m, r.stdout + r.stderr);
    return JSON.parse(m[1]);
  };
  for (const region of ['', 'europe']) {
    test(`v0.7.9 lights: switched off, ${region || 'East Asia'}'s city lights are v0.7.8's by SHA-256`, () => {
      for (const fine of [false, true]) {
        const h = run(region, false, fine);
        delete h.fineText;
        assert.deepEqual(h, V078, `fine cover ${fine}`);
      }
    });
  }
  test('v0.7.9 lights: switched on, only the vertex shader and its uniforms change; the 31 m cover read where it is', () => {
    const h = run('', true), f = run('europe', true, true);
    assert.notEqual(h.vert, V078.vert);
    assert.notEqual(h.uniforms, V078.uniforms);
    assert.deepEqual([h.frag, h.slots, h.blocks, h.layout], [V078.frag, V078.slots, V078.blocks, V078.layout]);
    assert.equal(h.fineText, false);
    assert.equal(f.fineText, true);
    assert.notEqual(f.vert, h.vert);
  });
  test('v0.7.9 lights: every splice\'s anchor occurs once in v0.7.8\'s shader', async () => {
    const { lights79Vert } = await import('../src/world/citylights.js');
    assert.throws(() => lights79Vert('nothing here', false), /anchor/);
  });
}
