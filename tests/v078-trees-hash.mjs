// v0.7.8 trees: a helper for tests/v078-trees.test.mjs and v078-towers.test.mjs (not a test itself). Builds the trees',
// the terrain's and the town's materials in node from the game folder given as the first argument (default: this tree),
// in the region and with the switches the environment gives (FS_REGION, FS_TREES78, FS_TOWERS78), and prints one line
// of JSON: the SHA-256 (first 16 hex digits) of each shader text and its uniforms' names.
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
globalThis.location = { href: 'http://127.0.0.1/', search: '' };
globalThis.fetch = () => Promise.reject(new Error('no fetch in node'));
console.warn = () => {};
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const THREE = await imp('vendor/three.module.js');
const chunks = { UNIFORMS_GLSL: 'U', NOISE_GLSL: 'N', HEIGHT_GLSL: 'H', ATMOS_GLSL: 'A', WATER_GLSL: 'W', FIELDS_GLSL: 'F', AIRCRAFT_LIGHTS_GLSL: 'L', MAX_PATCHES: 8, MAX_RUNWAYS: 8 };
const out = {};
const T = await imp('src/world/terrain.js');
const t = T.createTerrain({ add() {} }, {}, chunks);
out.terrain = [h(t.material.vertexShader), h(t.material.fragmentShader), Object.keys(t.material.uniforms).filter((k) => /78/.test(k))];
const D = await imp('src/world/detail.js');
const tr = D.createTrees(new THREE.Scene(), { uNat: { value: { x: 0, y: 0, z: 250 } } }, chunks, { fine: t.fine });
out.trees = tr.group.children.map((m) => [h(m.material.vertexShader), h(m.material.fragmentShader), Object.keys(m.material.uniforms).filter((k) => /78/.test(k))]);
const C = await imp('src/world/cities.js');
const c = C.createCities(new THREE.Scene(), { uNat: { value: { x: 0, y: 0, z: 250 } } }, chunks);
const cm = c.mesh.children[0].material;
out.cities = [h(cm.vertexShader), h(cm.fragmentShader), Object.keys(cm.uniforms).filter((k) => /78/.test(k))];
console.log('HASH78 ' + JSON.stringify(out));
process.exit(0);
