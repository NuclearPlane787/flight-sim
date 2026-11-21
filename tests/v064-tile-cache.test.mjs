// v0.6.4: the terrain cache keeps room for the flight whatever the airports pin. Found on 2026-11-21 by the 16x
// cruise's check: the cap was a flat 48 tiles, twenty-three airports pin 48, and the view's own tiles were dropped as
// fast as they came (the terrain's window never finished filling from cruise near Seoul).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTiledHeightfield, FREE_TILES } from '../src/world/heightfield.js';
import { createTileStore } from '../src/world/tilestore.js';
import { terrainSpec } from '../src/world/region.js';

import { toMap } from '../src/world/frame.js';
import { manifest, readGz, readJson, DATA } from './tile-terrain.mjs';

const m = manifest(), HAVE = !!(m && m.tilesRegion);

test('the cache holds the airports\' pinned tiles and FREE_TILES more, for every airport listed', { skip: !HAVE }, async () => {
  
  const aps = terrainSpec(m, true).airports.map((f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8')));
  const hf = await createTiledHeightfield(m, DATA.href, { region: true, airportTiles: true, maxTiles: 48, layers: ['h'], airports: aps, readGz, readJson });
  const pinned = hf.tiles.pinnedKeys().length;
  console.log(`  ${aps.length} airports pin ${pinned} tiles; the cache holds ${hf.tiles.maxTiles()}`);
  assert.ok(pinned >= 40, 'the airports pin most of what the old flat cap held');
  assert.equal(hf.tiles.maxTiles(), Math.max(48, pinned + FREE_TILES));
  assert.ok(FREE_TILES >= 24);
  // A cruise's view near Seoul: the tiles within 300 km, asked for unpinned as the terrain's window asks. With the
  // cap at 48 none stayed; now the last FREE_TILES asked for are all resident.
  const [x, y] = toMap(37.56, 126.80), asked = [];
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const px = x + di * 128000, py = y + dj * 128000;
    await hf.tiles.whenReady(px, py, 1000, 'probe'); hf.tiles.release('probe');
    asked.push([px, py]);
  }
  const resident = new Set(hf.tiles.resident());
  assert.ok(resident.size <= hf.tiles.maxTiles() + 1, `${resident.size} resident, the cap ${hf.tiles.maxTiles()}`);
  assert.ok(resident.size > pinned, 'the view\'s tiles stay beside the airports\'');
});

test('setMaxTiles only ever raises the cap', { skip: !HAVE }, () => {
  const s = createTileStore(m.tilesRegion, { layers: ['h'], readGz, maxTiles: 10 });
  assert.equal(s.maxTiles(), 10);
  assert.equal(s.setMaxTiles(6), 10);
  assert.equal(s.setMaxTiles(30.7), 30);
  assert.equal(s.setMaxTiles(NaN), 30);
});
