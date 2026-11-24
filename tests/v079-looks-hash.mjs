// v0.7.9 looks: a helper for tests/v079-looks-*.test.mjs (not a test itself). Builds, in node, from the game folder given
// as the first argument (default: this tree), in the region and with the switches the environment gives (FS_REGION,
// FS_TREES79, ...), the trees' materials and geometry, and prints one line of JSON: the SHA-256 (first 16 hex digits) of
// each level's shader texts, its uniforms' names and every geometry attribute's name and values.
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
globalThis.location = { href: 'http://127.0.0.1/', search: '' };
globalThis.fetch = () => Promise.reject(new Error('no fetch in node'));
console.warn = () => {};
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const what = (process.argv[3] || 'trees').split(',');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const ha = (a) => h(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
const THREE = await imp('vendor/three.module.js');
const chunks = { UNIFORMS_GLSL: 'U', NOISE_GLSL: 'N', HEIGHT_GLSL: 'H', ATMOS_GLSL: 'A', WATER_GLSL: 'W', FIELDS_GLSL: 'F', AIRCRAFT_LIGHTS_GLSL: 'L', MAX_PATCHES: 8, MAX_RUNWAYS: 8 };
const out = {};
const geoHash = (g) => h(Object.keys(g.attributes).sort().map((k) => k + ':' + g.attributes[k].itemSize + ':' + ha(g.attributes[k].array)).join('|') + (g.index ? '|i:' + ha(g.index.array) : ''));
if (what.includes('trees')) {
  const T = await imp('src/world/terrain.js');
  const t = T.createTerrain({ add() {} }, {}, chunks);
  const D = await imp('src/world/detail.js');
  const tr = D.createTrees(new THREE.Scene(), { uNat: { value: { x: 0, y: 0, z: 250 } } }, chunks, { fine: t.fine });
  out.trees = tr.group.children.map((m) => [h(m.material.vertexShader), h(m.material.fragmentShader), h(Object.keys(m.material.uniforms).sort().join(',')), geoHash(m.geometry)]);
}
if (what.includes('models')) {
  // Europe's Bergisel and Notre-Dame de la Garde models (with v0.7.8's profile and a made-up one; bearing 0 and 17),
  // their lights, and their entries in landmarks.js.
  const M = await imp('src/world/landmark-models.js');
  const prof = Array.from({ length: 25 }, (_, i) => 40 - i * 3.5 + Math.sin(i) * 2);
  const one = (r) => h(geoHash(r.geometry) + JSON.stringify(r.lights));
  out.models = {
    bergisel: [one(M.EUROPE_MODELS.bergisel(0, {})), one(M.EUROPE_MODELS.bergisel(17, { prof }))],
    ndg: [one(M.EUROPE_MODELS.ndg(0)), one(M.EUROPE_MODELS.ndg(17))],
  };
  const L = await imp('src/world/landmarks.js');
  const strip = (l) => JSON.stringify(l, (k, v) => (typeof v === 'function' ? undefined : v));
  out.entries = Object.fromEntries(['bergisel', 'ndg'].map((id) => [id, h(strip(L.EUROPE_LANDMARKS.find((l) => l.id === id)))]));
}
console.log('HASH79 ' + JSON.stringify(out));
process.exit(0);
