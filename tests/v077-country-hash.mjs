// v0.7.7 country: a helper for tests/v077-country-fields.test.mjs (not a test itself). Builds the terrain's material in
// node, in the region and with the switches the environment gives (FS_REGION, FS_FIELDS77, FS_TOWNS77), and prints one
// line of JSON: the SHA-256 of its vertex and fragment shader texts, the fragment text's length and the uniform names.
import { createHash } from 'node:crypto';
globalThis.location = { href: 'http://127.0.0.1/', search: '' };
globalThis.fetch = () => Promise.reject(new Error('no fetch in node'));
console.warn = () => {};
const T = await import('../src/world/terrain.js');
const chunks = { UNIFORMS_GLSL: 'U', NOISE_GLSL: 'N', HEIGHT_GLSL: 'H', ATMOS_GLSL: 'A', WATER_GLSL: 'W', FIELDS_GLSL: 'F', AIRCRAFT_LIGHTS_GLSL: 'L', MAX_PATCHES: 8, MAX_RUNWAYS: 8 };
const t = T.createTerrain({ add() {} }, {}, chunks);
const h = (s) => createHash('sha256').update(s).digest('hex');
const fs = t.material.fragmentShader;
console.log(JSON.stringify({ vert: h(t.material.vertexShader), frag: h(fs), len: fs.length, uniforms: Object.keys(t.material.uniforms),
  has: ['uEuZone', 'euZoneP', 'euPol', 'bg77', 'afg77', 'rough *= 1.0 - euPol', 'made * smoothstep(0.05, 0.30, cov250.b)'].filter((k) => fs.includes(k)) }));
