// Node's way to install the local rules (V060.md Part 5), as main.js and the prediction worker do
// with loadLocalRules(): the geo rules (WMM2025's grid, the country raster, South Korea's mask)
// read from data/, installed by region.js's setGeoRules(), which also installs frame.js's model.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createGeoRules } from '../src/world/geo-rules.js';
import { setGeoRules } from '../src/world/region.js';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));

export function geoPart(name) {
  const header = JSON.parse(readFileSync(DATA + name + '.json', 'utf8'));
  const buf = gunzipSync(readFileSync(DATA + header.file));
  return { header, values: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
}

let cached = null;
export function nodeGeoRules() {
  if (!cached) cached = createGeoRules({ magvar: geoPart('magvar'), country: geoPart('country'), krmask: geoPart('krmask') });
  return cached;
}

// Installs the rules (and the magnetic model); returns them. uninstallNodeRules() puts v0.5.8 back.
export function loadNodeRules() {
  const g = nodeGeoRules();
  setGeoRules(g);
  return g;
}
export function uninstallNodeRules() { setGeoRules(null); }
