// v0.6.0: the terrain from data/terrain's tiles (tilestore.js), for the node tests: the same
// heightfield the old loaders built from manifest.national, read from disk.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createTiledHeightfield } from '../src/world/heightfield.js';
import { terrainSpec } from '../src/world/region.js';

export const DATA = new URL('../data/', import.meta.url);

export const readGz = async (rel) => {
  try { const b = gunzipSync(readFileSync(new URL(rel, DATA))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
  catch (e) { return null; }
};
export const readJson = async (rel) => JSON.parse(readFileSync(new URL(rel, DATA), 'utf8'));
export const manifest = () => JSON.parse(readFileSync(new URL('manifest.json', DATA), 'utf8'));

// layers: which of 'h', 'w', 'c'; coasts: the 10 m coast patches too.
// By default Korea's own tiles, every one loaded, as the old loaders read the whole national
// grid (what Part 1's tests compare with that grid). game: true gives the terrain the game
// itself reads: Korea's while EAST_ASIA_ON is off; with it on the region's tiles and all eleven
// airports, with Korea's old square resident (the golden flights stay over it).
export async function tiledTerrain({ layers = ['h'], coasts = false, airports = null, onTile = null, maxTiles, game = false } = {}) {
  const m = manifest();
  const spec = terrainSpec(m, game ? undefined : false);
  const aps = airports || spec.airports.map((f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8')));
  if (spec.region) {
    const hf = await createTiledHeightfield(m, DATA.href, { region: true, layers, coasts, airports: aps, readGz, readJson, onTile, maxTiles: maxTiles || 400 });
    await hf.tiles.whenReady(0, 0, 560000, 'test');
    return { hf, airports: aps };
  }
  const hf = await createTiledHeightfield(m, DATA.href, { region: false, layers, coasts, airports: aps, all: true, readGz, readJson, onTile, maxTiles });
  return { hf, airports: aps };
}
