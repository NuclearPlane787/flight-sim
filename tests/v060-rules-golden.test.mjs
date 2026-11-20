// v0.6.0 Part 5 (briefs/V0-6-0.md, "Magnetic variation"): with EAST_ASIA_ON and the local rules installed
// (WMM2025 beyond South Korea), the golden A321 flight, which flies magnetic headings from Gimpo in
// calm air, still matches v0.5.8's recording to 1e-9: inside south-korea.poly magVar() is the plane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { FIXTURE, FIELDS, fly } from './golden-a321-flight.mjs';
import { setEastAsia } from '../src/world/region.js';
import { magModelInstalled } from '../src/world/frame.js';
import { loadNodeRules, uninstallNodeRules } from './v060-rules-helpers.mjs';

test('the golden A321 flight matches to 1e-9 with the region on and the local rules installed', () => {
  const gold = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString());
  assert.deepEqual(gold.fields, FIELDS);
  setEastAsia(true);
  loadNodeRules();
  let now;
  try {
    assert.ok(magModelInstalled());
    now = fly();
  } finally { uninstallNodeRules(); setEastAsia(false); }
  assert.equal(now.rows.length, gold.rows.length);
  let worst = 0, where = '';
  gold.rows.forEach((row, i) => row.forEach((v, j) => {
    const d = Math.abs(v - now.rows[i][j]);
    if (d > worst) { worst = d; where = `${FIELDS[j]} at row ${i}`; }
  }));
  assert.ok(worst <= 1e-9, `worst difference ${worst} (${where})`);
  assert.deepEqual(now.end.modes, gold.end.modes);
});
