// v0.7.0: runway ends used one way (runways.js ONE_WAY, from each AIP): Frankfurt's 18 for take-offs only and its
// 07L/25R for landings only, Gatwick's northern runway a standby.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ONE_WAY, runwayUse, canTakeOff, canLand, runwayUseNote, createAirports, circlingOnly } from '../src/world/runways.js';

test('the table: what each listed end is for, and every other end both ways', () => {
  assert.equal(runwayUse('EDDF', '18'), 'takeoff'); assert.equal(runwayUse('EDDF', '36'), 'closed');
  assert.equal(runwayUse('EDDF', '07L'), 'landing'); assert.equal(runwayUse('EDDF', '25R'), 'landing');
  assert.equal(runwayUse('EGKK', '08L'), 'standby'); assert.equal(runwayUse('EGKK', '26R'), 'standby');
  assert.equal(canTakeOff('EDDF', '18'), true); assert.equal(canLand('EDDF', '18'), false);
  assert.equal(canTakeOff('EDDF', '36'), false); assert.equal(canLand('EDDF', '36'), false);
  assert.equal(canTakeOff('EDDF', '25R'), false); assert.equal(canLand('EDDF', '25R'), true);
  assert.equal(canTakeOff('EGKK', '26R'), true); assert.equal(canLand('EGKK', '26R'), true);       // usable, never the default
  for (const [i, e] of [['EDDF', '25C'], ['EDDF', '07R'], ['EGKK', '26L'], ['EGLL', '27R'], ['RKSS', '14R'], ['RKPK', '18R']]) {
    assert.equal(runwayUse(i, e), null); assert.equal(canTakeOff(i, e), true); assert.equal(canLand(i, e), true); assert.equal(runwayUseNote(i, e), '');
  }
  assert.equal(runwayUseNote('EDDF', '18'), 'take-off only'); assert.equal(runwayUseNote('EDDF', '25R'), 'landing only'); assert.equal(runwayUseNote('EGKK', '08L'), 'standby');
  // No East Asian airport is in it, and a circling-only end is a different thing.
  assert.deepEqual(Object.keys(ONE_WAY).sort(), ['EDDF', 'EDDH', 'EGKK', 'EHAM', 'LEBL', 'LEMD', 'LFPO', 'LIPZ']);
  // v0.7.3, Hamburg: no take-off from 15, no landing on 33 (EDDH AD 2.20 2.2); 05/23 both ways
  assert.equal(canTakeOff('EDDH', '15'), false); assert.equal(canLand('EDDH', '15'), true); assert.equal(canLand('EDDH', '33'), false); assert.equal(canTakeOff('EDDH', '33'), true); assert.equal(runwayUse('EDDH', '23'), null);
  // Brussels's 19 was landed on only from v0.7.1 to v0.7.3 (the game's own limit: its start lay on a crossing the game
  // didn't shape). v0.7.4 shapes a runway's every crossing, so 01/19 is both ways again.
  assert.equal(canTakeOff('EBBR', '19'), true); assert.equal(canLand('EBBR', '19'), true); assert.equal(runwayUse('EBBR', '19'), null); assert.equal(runwayUse('EBBR', '01'), null); assert.equal(runwayUseNote('EBBR', '19'), '');
  assert.equal(canLand('LEBL', '20'), false); assert.equal(canTakeOff('LEBL', '20'), true); assert.equal(runwayUse('LEBL', '02'), null);   // Barcelona's 20: not available for landing (AD 2.12)
  assert.equal(canTakeOff('EHAM', '18R'), false); assert.equal(canLand('EHAM', '36L'), false); assert.equal(canLand('EHAM', '18L'), false); assert.equal(canTakeOff('EHAM', '36R'), false);   // Schiphol's two one-way runways [EST]
  assert.equal(runwayUse('LFPO', '02'), 'standby'); assert.equal(runwayUse('LFPO', '20'), 'standby'); assert.equal(runwayUse('LFPO', '25'), null);   // Orly's 02/20: exceptional use (AD 2.21)
  // Madrid: every end one way (AD 2.12): land on 32 and 18, take off from 36 and 14.
  for (const e of ['32L', '32R', '18L', '18R']) { assert.equal(canLand('LEMD', e), true, e); assert.equal(canTakeOff('LEMD', e), false, e); }
  for (const e of ['36L', '36R', '14L', '14R']) { assert.equal(canLand('LEMD', e), false, e); assert.equal(canTakeOff('LEMD', e), true, e); }
  assert.equal(circlingOnly('EDDF', '18'), false);
});

test('createAirports marks the ends, and clears the ILS of an end nothing lands on', () => {
  const end = (ident, x, y, ils = 'I') => ({ ident, x, y, elevM: 100, hdgTrueDeg: 0, ils });
  const list = [{ icao: 'EDDF', name: 'Frankfurt Airport', origin: [0, 0], elevM: 100, runways: [
    { id: '18/36', lengthM: 4000, widthM: 45, ends: [end('18', 0, 2000), end('36', 0, -2000)] },
    { id: '07L/25R', lengthM: 2800, widthM: 45, ends: [end('07L', -1400, 5000), end('25R', 1400, 5000)] },
    { id: '07C/25C', lengthM: 4000, widthM: 60, ends: [end('07C', -2000, 3000), end('25C', 2000, 3000)] }] }];
  createAirports(list);
  const E = Object.fromEntries(list[0].runways.flatMap((r) => r.ends.map((e) => [e.ident, e])));
  assert.equal(E['18'].use, 'takeoff'); assert.equal(E['18'].ils, null);
  assert.equal(E['36'].use, 'closed'); assert.equal(E['36'].ils, null);
  assert.equal(E['25R'].use, 'landing'); assert.equal(E['25R'].ils, 'I');
  assert.equal(E['25C'].use, undefined); assert.equal(E['25C'].ils, 'I');
});
