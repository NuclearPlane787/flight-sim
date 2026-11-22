// v0.7.4, Shane's item 9: runway courses to 0.1° magnetic (runwayCourseMag() and courseText() in src/ui/common.js),
// and an A321 given a typed course (the helper's, to 0.001°) flies a runway's extended centreline: from 10 nm out on it,
// in still air, within 5 m at the threshold and a few metres all the way. Two finals in each region.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inRegion, REGION_ID } from './region-run.mjs';
import { endOf, against, onFinal, NM, KT, FT, DEG } from './v074-cockpit-finals.mjs';

const FINALS = {
  'east-asia': [['RKSS', '14L'], ['RKPC', '07']],
  europe: [['EGLL', '27R'], ['EDDF', '25L']],
};

test('courseText: to 0.1°, three figures, 360.0 for north', async () => {
  const { courseText } = await import('../src/ui/common.js');
  assert.equal(courseText(71.466), '071.5');
  assert.equal(courseText(5.04), '005.0');
  assert.equal(courseText(359.96), '360.0');
  assert.equal(courseText(0.02), '360.0');
  assert.equal(courseText(-1.25), '358.8');
});

async function flyCourse(icao, ident) {
  const { createSim } = await import('../src/sim/sim.js');
  const { runwayCourseMag } = await import('../src/ui/common.js');
  const { end, runway } = await endOf(icao, ident);
  const other = runway.ends.find((e) => e !== end);
  const crs = runwayCourseMag(end, other);
  const p = onFinal(end, 10);
  const sim = createSim({ type: 'a321neo' });
  const altFt = Math.round((end.elevM / FT + 3000) / 100) * 100;
  sim.reset({ x: p.x, y: p.y, z: altFt * FT, hdg: p.hdg, onGround: false, iasMs: 180 * KT, flapLever: 0, gearDown: false, fuelKg: 6000, payloadKg: 15000,
    ap: { ap: true, athr: true, spdKt: 180, hdgDeg: 0, altFt } });
  sim.ap.setHdg(Math.round(crs * 1000) / 1000);
  let maxX = 0, xThr = NaN;
  for (let i = 0; i < 400 * 120; i++) {
    sim.step(1 / 120);
    const a = against(end, sim.state.pos.x, sim.state.pos.y);
    maxX = Math.max(maxX, Math.abs(a.xte));
    if (a.along >= 0) { xThr = a.xte; break; }
  }
  return { crs, maxX, xThr, end, other };
}

if (inRegion('europe', import.meta.url)) {
  for (const [icao, ident] of FINALS.europe) {
    test(`Europe ${icao} ${ident}: a typed course flies the extended centreline from 10 nm (still air)`, async () => {
      const r = await flyCourse(icao, ident);
      assert.ok(Math.abs(r.xThr) < 5, `at the threshold ${r.xThr.toFixed(2)} m (course ${r.crs.toFixed(3)})`);
      assert.ok(r.maxX < 6, `at most ${r.maxX.toFixed(2)} m off on the way`);
    });
  }
}
if (REGION_ID === 'east-asia') {
  for (const [icao, ident] of FINALS['east-asia']) {
    test(`East Asia ${icao} ${ident}: a typed course flies the extended centreline from 10 nm (still air)`, async () => {
      const r = await flyCourse(icao, ident);
      assert.ok(Math.abs(r.xThr) < 5, `at the threshold ${r.xThr.toFixed(2)} m (course ${r.crs.toFixed(3)})`);
      assert.ok(r.maxX < 6, `at most ${r.maxX.toFixed(2)} m off on the way`);
    });
  }
  test('the ILS course on the PFDs is the helper\'s (ilsDeviation)', async () => {
    const { ilsDeviation, runwayCourseMag } = await import('../src/ui/common.js');
    const { end, runway, airport } = await endOf('RKSS', '14L');
    const other = runway.ends.find((e) => e !== end);
    const p = onFinal(end, 8);
    const d = ilsDeviation({ pos: { x: p.x, y: p.y, z: 800 } }, { end, other, runway, airport });
    assert.equal(d.courseMag, runwayCourseMag(end, other));
    // Within 0.1° of the course at the threshold itself.
    const { gridToMag } = await import('../src/world/frame.js');
    const atThr = ((gridToMag(Math.atan2(other.x - end.x, other.y - end.y), end.x, end.y) / DEG) % 360 + 360) % 360;
    assert.ok(Math.abs(d.courseMag - atThr) < 0.1, `${d.courseMag} against ${atThr}`);
  });
}
