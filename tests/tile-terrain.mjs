// v0.6.0: the terrain from data/terrain's tiles (tilestore.js), for the node tests, read from disk.
// (v0.7.0: the region's tiles always: Korea's own tiles and manifest.national went with v0.6.0's flags.)
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createTiledHeightfield } from '../src/world/heightfield.js';
import { terrainSpec } from '../src/world/region.js';

import { REGION, REGION_ID } from '../src/world/regions.js';

// v0.7.0: the run's region's folder (data/ for East Asia; data/europe/ with FS_REGION=europe).
export const DATA = new URL('../' + REGION.data, import.meta.url);

export const readGz = async (rel) => {
  try { const b = gunzipSync(readFileSync(new URL(rel, DATA))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
  catch (e) { return null; }
};
export const readJson = async (rel) => JSON.parse(readFileSync(new URL(rel, DATA), 'utf8'));
export const manifest = () => JSON.parse(readFileSync(new URL('manifest.json', DATA), 'utf8'));

// layers: which of 'h', 'w', 'c'; coasts: the 10 m coast patches too.
// The terrain the game itself reads: the region's tiles and all its airports, with Korea's old
// square resident (the golden flights stay over it). (`game` is accepted and ignored: until v0.7.0
// it chose the region's tiles over Korea's own.)
export async function tiledTerrain({ layers = ['h'], coasts = false, airports = null, onTile = null, maxTiles, game = false } = {}) {
  const m = manifest();
  const spec = terrainSpec(m);
  const aps = airports || spec.airports.map((f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8')));
  const hf = await createTiledHeightfield(m, DATA.href, { layers, coasts, airports: aps, readGz, readJson, onTile, maxTiles: maxTiles || 400 });
  if (REGION_ID === 'east-asia') await hf.tiles.whenReady(0, 0, 560000, 'test');   // (Korea's old square; another region's tests ask for the tiles they read)
  return { hf, airports: aps };
}
