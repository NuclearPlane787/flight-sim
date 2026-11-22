// v0.7.4, Shane's item 9 ("Allow me to type decimal headings, like "071.466" and the plane follows that, even if the
// box shows "071" or "072""): both families keep a typed heading to 0.001°, saves keep it, the window shows the whole
// degree, and the knob steps from a decimal to the next whole degree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { typeById } from '../src/sim/types.js';
import { hdg1000 } from '../src/sim/autopilot.js';
import { stepDecimal } from '../src/ui/knobs.js';
import { hdgSetting, hdgWindowText } from '../src/ui/fcu.js';
import { gridToMag } from '../src/world/frame.js';

const DT = 1 / 120;
function air(type, ap) {
  const A = typeById(type).data;
  const sim = createSim({ type });
  const mass = A.OEW + 0.6 * (A.MLW - A.OEW);
  const fuelKg = Math.min(20000, (mass - A.OEW) / 2);
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 6000 * A.FT, iasMs: 250 * A.KT, flapLever: 0, gearDown: false, fuelKg, payloadKg: mass - A.OEW - fuelKg, ap });
  return { sim, A };
}
const run = (sim, s) => { for (let i = 0, n = Math.round(s / DT); i < n; i++) sim.step(DT); };

test('hdg1000: 0.001° kept, wrapped into [0, 360), whole numbers as before', () => {
  assert.equal(hdg1000(71.466), 71.466);
  assert.equal(hdg1000(71.4664), 71.466);
  assert.equal(hdg1000(71.4666), 71.467);
  assert.equal(hdg1000(360), 0);
  assert.equal(hdg1000(359.9996), 0);
  assert.equal(hdg1000(-0.5), 359.5);
  for (let d = -400; d <= 800; d += 7) assert.equal(hdg1000(d), ((Math.round(d) % 360) + 360) % 360);
});

test('the window shows the whole degree; what is set keeps 0.001°', () => {
  assert.equal(hdgWindowText(71.466), '071');
  assert.equal(hdgWindowText(71.6), '072');
  assert.equal(hdgWindowText(0.2), '360');
  assert.equal(hdgWindowText(359.7), '360');
  assert.equal(hdgSetting(71.4664), 71.466);
  assert.equal(hdgSetting(0), 360);
  assert.equal(hdgSetting(Number('071.466')), 71.466);
});

test('the knob steps from a decimal to the next whole degree', () => {
  assert.equal(stepDecimal(71.466, 1, 1), 72);
  assert.equal(stepDecimal(71.466, 1, -1), 71);
  assert.equal(stepDecimal(71.466, 1, 3), 74);
  assert.equal(stepDecimal(71.466, 1, -2), 70);
  assert.equal(stepDecimal(71, 1, 1), 72);
  assert.equal(stepDecimal(71, 1, -1), 70);
  assert.equal(stepDecimal(71.466, 10, 1), 80);   // a big step: to the next ten
  assert.equal(stepDecimal(71.466, 10, -1), 70);
  assert.equal(stepDecimal(359.5, 1, 1), 360);    // the FCU's setValue wraps it (hdgSetting)
});

for (const type of ['a321neo', 'b787-9', 'b777-300er']) {
  test(`${type}: a typed 071.466 is flown, and a snapshot keeps it`, () => {
    const boeing = type !== 'a321neo';
    const { sim } = air(type, { ap: true, athr: true, spdKt: 250, hdgDeg: 0, altFt: 6000 });
    sim.ap.setHdg(71.466);
    if (boeing) sim.ap.hdgSel();
    assert.equal(sim.ap.hdgDeg, 71.466);
    run(sim, 120);
    const s = sim.state;
    const mag = ((gridToMag(s.hdg, s.pos.x, s.pos.y) * 180 / Math.PI) % 360 + 360) % 360;
    assert.ok(Math.abs(mag - 71.466) < 0.02, `heading ${mag.toFixed(4)}`);
    const snap = JSON.parse(JSON.stringify(sim.snapshot()));
    assert.equal(snap.ap.hdgDeg, 71.466);
    const { sim: b } = air(type);
    b.restore(snap);
    assert.equal(b.ap.hdgDeg, 71.466);
  });
}
