// v0.8.0 (legs): the sparks of a belly slide (src/world/sparks.js): which points spark (the lowest of the type's
// crash and belly points while the sim says something scrapes, above 3 m/s, more the faster), the mesh hidden (no
// draw call) until then and again after, and the switch (?sparks80=0, FS_SPARKS80=0: nothing is made).
//   node --test tests/v080-sparks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { sparkPoints, sparkLevels, createSparks, SPARKS80, SPARK_MAX_POINTS, TOUCH_M } from '../src/world/sparks.js';
import { typeById } from '../src/sim/types.js';
import { createSim } from '../src/sim/sim.js';

const DEG = Math.PI / 180;
const slide = (o = {}) => ({ scraping: true, gs: 40, pitch: 0, roll: 0, engines: [{}, {}], ...o });

test('sparks: none unless the sim says a part scrapes, and not below 3 m/s', () => {
  const pts = sparkPoints(typeById('a321neo').geo);
  assert.equal(sparkLevels(slide({ scraping: false }), pts), 0);
  assert.equal(sparkLevels(slide({ gs: 2 }), pts), 0);
  assert.equal(sparkLevels(undefined, pts), 0);
  assert.ok(sparkLevels(slide(), pts) > 0);
  // A fresh sim (the gear down, on the runway or in the air) never scrapes.
  const sim = createSim();
  sim.reset({ onGround: false, z: 600, iasMs: 80 });
  sim.step(1 / 120);
  assert.equal(sparkLevels(sim.state, pts), 0);
});

for (const id of ['a321neo', 'b787-9', 'b777-300er']) {
  test(`sparks ${id}: the points, and the lowest spark for the attitude`, () => {
    const geo = typeById(id).geo, pts = sparkPoints(geo);
    assert.ok(pts.length >= geo.CRASH_POINTS.length && pts.length <= SPARK_MAX_POINTS, `${pts.length}`);
    const lv = new Array(pts.length).fill(0);
    // level: the lowest points (the nacelles or the belly) spark, the wingtips and the tail don't
    sparkLevels(slide(), pts, lv);
    const up = (p, th = 0, ph = 0) => Math.sin(th) * p.x + Math.sin(ph) * Math.cos(th) * p.y + Math.cos(ph) * Math.cos(th) * p.z;
    const lo = Math.min(...pts.map((p) => up(p)));
    pts.forEach((p, i) => assert.equal(lv[i] > 0, up(p) - lo < TOUCH_M, `${id} ${p.why} ${i}`));
    assert.ok(pts.every((p, i) => p.why !== 'wingtip strike' || lv[i] === 0), 'no wingtip level');
    // nose high (8 degrees): the tail sparks
    sparkLevels(slide({ pitch: 8 * DEG }), pts, lv);
    assert.ok(pts.some((p, i) => p.why === 'tail strike' && lv[i] > 0), 'the tail, nose high');
    // banked 10 degrees right (right wing down): only points on the right side (y < 0) or the centre
    sparkLevels(slide({ roll: 10 * DEG }), pts, lv);
    assert.ok(pts.every((p, i) => lv[i] === 0 || p.y <= 0.01), 'right side when banked right');
    // more the faster
    const a = new Array(pts.length).fill(0), b = new Array(pts.length).fill(0);
    sparkLevels(slide({ gs: 10 }), pts, a); sparkLevels(slide({ gs: 60 }), pts, b);
    assert.ok(Math.max(...b) > Math.max(...a));
  });

  test(`sparks ${id}: the mesh hidden until a slide, and hidden again after`, () => {
    assert.equal(SPARKS80, true, 'on by default');
    const s = createSparks(typeById(id).geo);
    assert.equal(s.object.visible, false, 'made invisible: no draw call');
    s.update({ state: { scraping: false, gs: 60 }, dt: 0.016 });
    assert.equal(s.object.visible, false);
    s.update({ state: { gearPos: 1, gs: 60 }, dt: 0.016 });
    assert.equal(s.object.visible, false, 'a state without scraping (v0.7.9\'s, the dev pages\'): none');
    const t0 = s.object.material.uniforms.uT.value;
    s.update({ state: slide(), dt: 0.016 });
    assert.equal(s.object.visible, true);
    assert.ok(s.object.material.uniforms.uT.value > t0);
    assert.ok(s.object.material.uniforms.uOn.value.some((v) => v > 0));
    const t1 = s.object.material.uniforms.uT.value;
    s.update({ state: slide(), dt: 0.016, paused: true });
    assert.equal(s.object.material.uniforms.uT.value, t1, 'still while paused');
    s.update({ state: slide({ gs: 1 }), dt: 0.016 });
    assert.equal(s.object.visible, false, 'stopped: none');
  });
}

test('sparks: an engine torn off doesn\'t spark', () => {
  const pts = sparkPoints(typeById('a321neo').geo), lv = new Array(pts.length).fill(0);
  sparkLevels(slide({ engines: [{ off: true }, { off: true }] }), pts, lv);
  assert.ok(pts.every((p, i) => p.why !== 'engine strike' || lv[i] === 0));
  assert.ok(lv.some((v) => v > 0), 'something else does');
});

test('sparks: switched off (FS_SPARKS80=0) nothing is made', () => {
  const url = new URL('../src/world/sparks.js', import.meta.url).href;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(url)}); console.log(m.SPARKS80, m.createSparks({ CRASH_POINTS: [] }));`], { env: { ...process.env, FS_SPARKS80: '0' }, encoding: 'utf8' });
  assert.equal(out.trim(), 'false null');
});
