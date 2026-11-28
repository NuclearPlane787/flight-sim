// v0.8.0: the smoke of an engine on fire (src/world/engine-smoke.js): which engines smoke, the mesh hidden (no draw
// call) until one burns, and the switch (?smoke80=0, FS_SMOKE80=0: nothing is made).
//   node --test tests/v080-smoke.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { burningMask, createEngineSmoke, SMOKE80, SMOKE_MAX_ENGINES } from '../src/world/engine-smoke.js';
import { typeById } from '../src/sim/types.js';
import { createSim } from '../src/sim/sim.js';
import { armed } from '../src/sim/failures.js';

test('smoke: a bit for each engine whose fire burns, from the sim\'s own state', () => {
  assert.equal(burningMask([{ fire: false }, { fire: false }]), 0);
  assert.equal(burningMask([{ fire: false }, { fire: true }]), 2);
  assert.equal(burningMask(undefined), 0);
  assert.equal(burningMask(new Array(12).fill({ fire: true })), (1 << SMOKE_MAX_ENGINES) - 1, 'eight at most');
  const sim = createSim();
  sim.reset({ onGround: false, z: 2000, iasMs: 120 });
  assert.equal(burningMask(sim.state.engines), 0);
  sim.setFailures(armed(null, { kind: 'eng-fire', target: 1 }, sim.state.t, 3));
  sim.step(1 / 120); sim.step(1 / 120);
  assert.equal(burningMask(sim.state.engines), 2);
  sim.repair('all');
  assert.equal(burningMask(sim.state.engines), 0);
});

test('smoke: a sprite trail per engine, hidden until a fire and hidden again after it', () => {
  assert.equal(SMOKE80, true, 'on by default');
  for (const id of ['a321neo', 'b787-9', 'b777-300er']) {
    const geo = typeById(id).geo, s = createEngineSmoke(geo.NACELLES || geo.ENGINES);
    assert.equal(s.object.geometry.instanceCount, 128 * geo.ENGINES.length, id);
    assert.equal(s.object.visible, false, 'made invisible: no draw call with no fire');
    s.update({ engines: [{ fire: false }, { fire: false }], tas: 120, dt: 0.016 });
    assert.equal(s.object.visible, false);
    const t0 = s.object.material.uniforms.uT.value;
    s.update({ engines: [{ fire: true }, { fire: false }], tas: 120, dt: 0.016 });
    assert.equal(s.object.visible, true);
    assert.deepEqual(s.object.material.uniforms.uBurn.value.slice(0, 2), [1, 0]);
    assert.ok(s.object.material.uniforms.uT.value > t0, 'the smoke moves');
    const t1 = s.object.material.uniforms.uT.value;
    s.update({ engines: [{ fire: true }, { fire: false }], tas: 120, dt: 0.016, paused: true });
    assert.equal(s.object.material.uniforms.uT.value, t1, 'and stands still while paused');
    s.update({ engines: [{ fire: false }, { fire: false }], tas: 120, dt: 0.016 });
    assert.equal(s.object.visible, false);
    // The burning engine's uniform is its nacelle's place, a little aft, on its own side.
    const e0 = s.object.material.uniforms.uEng.value[0], e1 = s.object.material.uniforms.uEng.value[1];
    assert.ok(Math.sign(e0.x) === -Math.sign(e1.x) && Math.abs(e0.x) > 3, `${e0.x} ${e1.x}`);
  }
});

test('smoke: switched off (FS_SMOKE80=0) nothing is made', () => {
  const url = new URL('../src/world/engine-smoke.js', import.meta.url).href;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(url)}); console.log(m.SMOKE80, m.createEngineSmoke([{ x: 0, y: 5, z: -1 }, { x: 0, y: -5, z: -1 }]));`], { env: { ...process.env, FS_SMOKE80: '0' }, encoding: 'utf8' });
  assert.equal(out.trim(), 'false null');
});
