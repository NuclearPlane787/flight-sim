// v0.7.4 part 9, item 6 (v0.7.7's landmarks, the look2 subagent): Tower Bridge as a bridge, Madrid's unlit tower lit, the
// village church's tower under a spire, behind one switch (landmark-models.js's LANDMARKS77: ?landmarks77=0 on the page,
// FS_LANDMARKS77=0 in node). With the switch on (the default) the new models; off, v0.7.3's models, Tower Bridge's entry
// and the church's shader text exactly (hashes of v0.7.3's, taken from the pushed copy with the same shader stubs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inRegion } from './region-run.mjs';

const OFF = process.env.FS_LANDMARKS77 === '0';
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const modelHash = (g) => { const h = createHash('sha256'); for (const a of ['position', 'normal', 'aCol', 'aFac', 'aExt', 'aGlow']) h.update(Buffer.from(g.getAttribute(a).array.buffer)); return h.digest('hex').slice(0, 16); };
// v0.7.3's (the pushed copy, 2026-11-22): the two models, every attribute; Europe's rural vertex and fragment text.
const OLD = { towerbridge: 'c6f1ff9c3dd1582a', cepsa: '8b2e9193ad1c332b', ruralVert: '3481c0a5bf389b79', ruralFrag: 'd0aaeed4cf07c51e' };
const chunks = { UNIFORMS_GLSL: '/*U*/', NOISE_GLSL: '/*N*/', HEIGHT_GLSL: '/*H*/', ATMOS_GLSL: '/*A*/', MAX_RUNWAYS: 8 };
async function rural() {
  const THREE = await import('../vendor/three.module.js');
  const { createRural } = await import('../src/world/rural.js');
  const r = createRural(new THREE.Scene(), { uNat: { value: { x: 0, y: 0, z: 250 } } }, chunks);
  return { vert: r.mesh.material.vertexShader, frag: r.mesh.material.fragmentShader };
}

if (inRegion('europe', import.meta.url) && !OFF) {
  const { LANDMARKS77 } = await import('../src/world/landmark-models.js');
  const { EUROPE_LANDMARKS, buildModel, baseHeight, bridgeEnds, landmarkFootprints } = await import('../src/world/landmarks.js');
  const byId = (id) => EUROPE_LANDMARKS.find((l) => l.id === id);
  // local (across, along) of a scene vertex for a model built at grid bearing brg
  const local = (L, x, z) => { const c = Math.cos(L.brg * Math.PI / 180), s = Math.sin(L.brg * Math.PI / 180), N = -z; return [x * c - N * s, x * s + N * c]; };

  test('the switch is on by default', () => assert.equal(LANDMARKS77, true));

  test("Tower Bridge: a bridge at the Thames's level, 244 m, two 65 m towers 77 m apart, the 61 m span open but for the deck and the walkways", () => {
    const L = byId('towerbridge');
    assert.equal(L.kind, 'bridge');
    assert.equal(baseHeight(L, () => 2.4), 0, 'based at the water');
    assert.ok(Math.abs(L.geo.n1 - L.geo.n0 - 244) < 2, `ends ${L.geo.n0.toFixed(1)} .. ${L.geo.n1.toFixed(1)}`);
    assert.ok(Math.abs(L.geo.s * 2 - 77) < 1, `towers ${(L.geo.s * 2).toFixed(1)} m apart`);
    assert.ok(Math.abs(L.brg - 3) < 1, `true north is about 3 degrees east of grid north in London: ${L.brg.toFixed(2)}`);
    // the centres leave out the same 122 m circle as before
    assert.deepEqual(landmarkFootprints().filter((f) => f.id === 'towerbridge').map(({ x, y, r }) => [x, y, r]), [[L.x, L.y, 122]]);
    const ends = bridgeEnds(L, () => 2.4);
    const { geometry: g } = buildModel(L, ends), p = g.getAttribute('position');
    const tris = p.count / 3;
    console.log(`# Tower Bridge: ${tris} triangles (v0.7.3's plain model 752)`);
    assert.ok(tris > 1500 && tris <= 6000, `${tris} triangles`);
    let maxY = 0, walkE = 0, walkW = 0, deck = 0, inSpan = 0, reach = 0, abut = 0;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), [lx, ln] = local(L, p.getX(i), p.getZ(i));
      maxY = Math.max(maxY, y); reach = Math.max(reach, Math.abs(ln));
      if (Math.abs(ln) < 29) {
        if (y > 12 && !(y > 41 && y < 47.1)) inSpan++;                        // nothing between the towers but deck and walkways
        if (y > 41 && y < 47.1) { if (lx > 0) walkE++; else walkW++; }
        if (Math.abs(y - 10) < 0.01) deck++;
      }
      if (Math.abs(ln) > 110 && y > 20) abut++;
      if (y > 50) assert.ok(Math.abs(ln) > 25 && Math.abs(ln) < 55, `tall only at the towers: ${ln.toFixed(1)} at ${y.toFixed(1)} m`);
    }
    assert.ok(Math.abs(maxY - 65) < 0.65, `top ${maxY}`);
    assert.equal(inSpan, 0, 'the central span open');
    assert.ok(walkE > 50 && walkW > 50, `two walkways (${walkE}, ${walkW})`);
    assert.ok(deck > 10, 'the bascules\' deck at 10 m');
    assert.ok(abut > 20, 'the abutment towers on the banks');
    assert.ok(reach > 120 && reach < 124, `the ends at ${reach.toFixed(1)} m`);
  });

  test("Madrid: Torre Cepsa's cores carry lit windows, as its three neighbours' faces do", () => {
    for (const id of ['cepsa', 'pwc', 'cristal', 'emperador']) {
      const L = byId(id), g = buildModel(L).geometry, p = g.getAttribute('position'), f = g.getAttribute('aFac');
      let face = 0, lit = 0;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if (y > 0.82 * L.heightM) continue;                                   // the walls under the crowns
        face++;
        if (f.getX(i) > 0 && f.getW(i) > 0.2) lit++;
      }
      assert.ok(lit / face > 0.9, `${id}: ${lit} of ${face} facade vertices with lit windows`);
    }
  });

  test("the village church: the tower's ridge drawn to a spire's point, its roof and belfry in the fragment, no declarations added", async () => {
    const { vert, frag } = await rural();
    assert.notEqual(sha(vert), OLD.ruralVert);
    assert.notEqual(sha(frag), OLD.ruralFrag);
    assert.match(vert, /if \(euTower && position\.y > 1\.5\) p\.x = 0\.0;/);
    assert.match(vert, /vSeed = euTower \? -2\.0 : -1\.0;/);
    assert.match(vert, /rise = uCountry == 6 \? 2\.5 \+ 1\.5 \* h3 : size\.y \* \(0\.75 \+ 0\.35 \* h3\)/);
    assert.match(frag, /if \(vSeed < -0\.5\) \{[\s\S]*\} else if \(vPart < 0\.5\) \{/);
    assert.equal(frag.split('dFdx(vRel)').length - 1, 1);
    const decls = (s) => s.split('\n').map((l) => l.trim()).filter((l) => /^(uniform|attribute|varying)\b/.test(l)).join('\n');
    const THREE = await import('../vendor/three.module.js');
    void THREE;
    // the same declarations as with the switch off (checked by hash there)
    assert.equal(decls(vert).split('\n').length, decls(vert.replace(/v0\.7\.4[^\n]*/g, '')).split('\n').length);
  });
}

if (inRegion('europe', import.meta.url, { env: { FS_LANDMARKS77: '0' } }) && OFF) {
  const { LANDMARKS77 } = await import('../src/world/landmark-models.js');
  const { EUROPE_LANDMARKS, buildModel, baseHeight } = await import('../src/world/landmarks.js');
  const byId = (id) => EUROPE_LANDMARKS.find((l) => l.id === id);

  test("switch off: v0.7.3's Tower Bridge and Torre Cepsa, vertex for vertex, and Tower Bridge's entry as it was", () => {
    assert.equal(LANDMARKS77, false);
    const L = byId('towerbridge');
    assert.equal(L.kind, undefined);
    assert.equal(L.brg, 0);
    assert.equal(L.parts, undefined);
    assert.equal(L.geo, undefined);
    assert.ok(baseHeight(L, () => 2.4) === 1.9);
    assert.equal(modelHash(buildModel(L).geometry), OLD.towerbridge);
    assert.equal(modelHash(buildModel(byId('cepsa')).geometry), OLD.cepsa);
  });

  test("switch off: the rural shader's text is v0.7.3's, character for character", async () => {
    const { vert, frag } = await rural();
    assert.equal(sha(vert), OLD.ruralVert);
    assert.equal(sha(frag), OLD.ruralFrag);
  });
}
