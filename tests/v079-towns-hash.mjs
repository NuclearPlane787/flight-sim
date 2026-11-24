// v0.7.9 towns: a helper for tests/v079-towns-switch.test.mjs (not a test itself). Builds the terrain's material in node
// from the game folder given as the first argument (default: this tree), in the region and with the switches the
// environment gives (FS_REGION, FS_TOWNS79, ...), and prints one line: TOWNS79 {"vert": sha256, "frag": sha256,
// "uniforms": [names]} (the full SHA-256 of each shader text).
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
globalThis.location = { href: 'http://127.0.0.1/', search: '' };
globalThis.fetch = () => Promise.reject(new Error('no fetch in node'));
console.warn = () => {};
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const h = (s) => createHash('sha256').update(s).digest('hex');
const chunks = { UNIFORMS_GLSL: 'U', NOISE_GLSL: 'N', HEIGHT_GLSL: 'H', ATMOS_GLSL: 'A', WATER_GLSL: 'W', FIELDS_GLSL: 'F', AIRCRAFT_LIGHTS_GLSL: 'L', MAX_PATCHES: 8, MAX_RUNWAYS: 8 };
const T = await imp('src/world/terrain.js');
const t = T.createTerrain({ add() {} }, {}, chunks);
console.log('TOWNS79 ' + JSON.stringify({ vert: h(t.material.vertexShader), frag: h(t.material.fragmentShader), uniforms: Object.keys(t.material.uniforms) }));
process.exit(0);
