// The A321neo's published numbers, exactly as the documents give them.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../src/sim/a321neo.js';

test('limits from the EASA TCDS (A321-251NX)', () => {
  assert.equal(A.VMO_KT, 350);
  assert.equal(A.MMO, 0.82);
  assert.deepEqual(A.VFE_KT, { '0': 350, '1': 243, '1+F': 225, '2': 215, '3': 195, 'FULL': 186 });
  assert.equal(A.VLE_KT, 280); assert.equal(A.MLE, 0.67);
  assert.equal(A.VLO_EXT_KT, 250); assert.equal(A.VLO_RET_KT, 220);
  assert.equal(A.MAX_ALT_FT, 39100);
  assert.equal(A.MTOW, 97000); assert.equal(A.MLW, 79200); assert.equal(A.MZFW, 75600);
  assert.equal(A.FUEL_MAX, 18510);
  assert.equal(A.MAC, 4.1935);
  assert.deepEqual(A.CONFIGS['FULL'], { slat: 27, flap: 34 });
  assert.deepEqual(A.CONFIGS['1+F'], { slat: 18, flap: 10 });
});

test('LEAP-1A thrust and fuel flow (EASA E.110, ICAO databank)', () => {
  assert.equal(A.T0_ENGINE, 143050);
  // ICAO LTO points at sea level static: 1.067 / 0.873 / 0.286 kg/s at 100 / 85 / 30 %.
  for (const [pct, ff] of [[1, 1.067], [0.85, 0.873], [0.30, 0.286]]) {
    const model = A.TSFC_C0 * A.T0_ENGINE * pct;
    assert.ok(Math.abs(model - ff) / ff < 0.15, `ff at ${pct * 100}%: ${model.toFixed(3)} vs ${ff}`);
  }
});

test('1 g stall speeds per configuration at 79.2 t follow from CLmax', async () => {
  const { liftCurve } = await import('../src/sim/flightmodel.js');
  const vs = (cfg) => {
    const c = A.CONFIGS[cfg];
    const o = liftCurve(c.slat, c.flap, {});
    return Math.sqrt(2 * 79200 * 9.80665 / (1.225 * A.S * o.clmax)) / A.KT;
  };
  // Vapp 136 kt = 1.23·VS1g + 5 at MLW, CONF FULL (Airbus AC p.197).
  assert.ok(Math.abs(1.23 * vs('FULL') + 5 - 136) < 1.5, `Vapp ${1.23 * vs('FULL') + 5}`);
  const expect = { '0': 161.5, '1': 139, '1+F': 126.5, '2': 123, '3': 118.5, 'FULL': 106.5 };
  for (const k in expect) assert.ok(Math.abs(vs(k) - expect[k]) < 1.5, `${k}: ${vs(k)}`);
});
