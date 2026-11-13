// The 787-9 and the 777-300ER don't change (V050.md, Part 1): their golden flights, recorded from v0.4.4's code
// before the parts model, flown again and compared field by field, every second, to 1e-9.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fixtureOf, FIELDS, fly, goldenWorst } from './golden-boeing-flight.mjs';

for (const type of ['b787-9', 'b777-300er']) {
  test(`the golden ${type} flight matches to 1e-9`, () => {
    const gold = JSON.parse(gunzipSync(readFileSync(fixtureOf(type))).toString());
    assert.deepEqual(gold.fields, FIELDS);
    const now = fly(type);
    assert.equal(now.rows.length, gold.rows.length);
    // 1e-9 of the value above 1, absolute below it (goldenWorst(): portable between macOS's node and Linux's).
    const { worst, where } = goldenWorst(gold, now, FIELDS);
    assert.ok(worst <= 1e-9, `worst difference ${worst} (${where})`);
    assert.deepEqual(now.end.modes, gold.end.modes);
  });
}
