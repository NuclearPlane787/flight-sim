// The A321neo doesn't change (V030.md, Part 1): the golden flight, recorded from v0.2.2's code
// before the type registry, flown again and compared field by field, every second, to 1e-9.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { FIXTURE, FIELDS, fly } from './golden-a321-flight.mjs';

test('the golden A321 flight matches to 1e-9', () => {
  const gold = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString());
  assert.deepEqual(gold.fields, FIELDS);
  const now = fly();
  assert.equal(now.rows.length, gold.rows.length);
  let worst = 0, where = '';
  gold.rows.forEach((row, i) => row.forEach((v, j) => {
    const d = Math.abs(v - now.rows[i][j]);
    if (d > worst) { worst = d; where = `${FIELDS[j]} at row ${i}`; }
  }));
  assert.ok(worst <= 1e-9, `worst difference ${worst} (${where})`);
  assert.deepEqual(now.end.modes, gold.end.modes);
});
