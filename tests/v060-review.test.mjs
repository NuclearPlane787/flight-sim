// v0.6.0: the fresh-eyes review's findings (19 Nov 2026), each as a test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { terrainSpec } from '../src/world/region.js';
import { loadNodeRules } from './v060-rules-helpers.mjs';
import { createSim } from '../src/sim/sim.js';
import { presetWeather, weatherContext } from '../src/sim/weather-presets.js';
import { DATA, manifest } from './tile-terrain.mjs';

const HAVE = !!manifest().tilesRegion;
const deg = (x, y) => (Math.atan2(-x, -y) * 180 / Math.PI + 360) % 360;

// The landing card's tower wind is the surface wind where the aircraft is: a flight planned to
// Gimpo that lands at Haneda (Change route) reads Haneda's wind, turned like the wind itself.
test('the card\'s tower wind is the wind at the wheels, away from the planned arrival too', { skip: !HAVE }, () => {
  loadNodeRules();
  try {
    const airports = terrainSpec(manifest()).airports.map((f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8')));
    for (const icao of ['RJTT', 'ZSPD', 'RKSS']) {
      const ap = airports.find((a) => a.icao === icao);
      const s = createSim({ ground: () => ({ h: 6, kind: 'runway' }) });
      const ic = { x: ap.origin[0], y: ap.origin[1], hdg: 0, onGround: true, flapLever: 1, gearDown: true };
      s.reset(ic);
      s.setWeather(presetWeather('gusty-crosswind', weatherContext(airports, { dest: 'RKSS', arrRunway: '14R' })));
      s.reset(ic);
      s.step(1 / 120);
      const W = s.state.wind;
      // The mean wind at the wheels is the 10 m wind scaled down by the profile: the same direction.
      const d = Math.abs(deg(W.sfcX, W.sfcY) - deg(W.meanX, W.meanY));
      assert.ok(Math.min(d, 360 - d) < 1e-6, `${icao}: the card's wind from ${deg(W.sfcX, W.sfcY).toFixed(3)}, the sim's from ${deg(W.meanX, W.meanY).toFixed(3)}`);
    }
  } finally { /* (v0.7.0: the region is always on) */ }
});

// Part 7 (found by looking at Haneda's apron with the new ground on): the fine cover maps aprons
// and terminals as built-up, so the airfield is marked in the cover's spare fourth channel and
// the new ground stays out of it. (v0.7.0: the flag-off half, the fourth byte untouched with
// GROUND_ON off, went with the flag.)
test('the airport mask marks the airfield in the cover\'s fourth channel', async () => {
  const { maskAirportCover } = await import('../src/world/airport-mask.js');
  const airports = [{ boundary: [[1000, 1000], [3000, 1000], [3000, 3000], [1000, 3000]] }];
  const grid = () => ({ layers: { national: { x0: 0, y0: 0, cell: 250, nx: 20, ny: 20, cover: new Uint8Array(20 * 20 * 4).fill(200) } } });
  {
    const mid = (8 * 20 + 8) * 4, out = (18 * 20 + 18) * 4;
    const b = grid(); maskAirportCover(b, airports);
    const cb = b.layers.national.cover;
    assert.deepEqual([...cb.slice(mid, mid + 4)], [0, 200, 0, 255], 'inside, flag on: marked');
    assert.deepEqual([...cb.slice(out, out + 4)], [200, 200, 200, 200]);
  }
});
