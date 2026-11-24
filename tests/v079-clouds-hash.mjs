// v0.7.9: one line of short SHA-256s over every cloud part's shader text and uniform names, as createClouds() makes
// them (a single weather's materials: with ?wxahead79=0, or on with no route set, they must be the pushed v0.7.8's;
// tests/v079-weather-front.test.mjs holds that line, taken from the frozen copy). `--route` sets a two-end weather first.
import { createHash } from 'node:crypto';
globalThis.location = { href: 'http://x/', search: '' };
const C = await import('../src/world/clouds.js');
const objs = [], scene = { add(o) { objs.push(o); } };
const cl = C.createClouds(scene, {});
if (process.argv.includes('--route')) {
  const W = await import('../src/sim/weather.js'), { presetWeather } = await import('../src/sim/weather-presets.js');
  const s = W.normalizeWeather({ ...presetWeather('thunderstorm', null), dep: presetWeather('clear', null), ends: { ax: 0, ay: 0, bx: 0, by: 600000 } });
  cl.setWeather(W.weatherAt(s, 0, 0)); cl.setRoute?.(s);
}
const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
console.log(objs.map((o) => o.name + ':' + (o.material ? h(o.material.vertexShader + '|' + o.material.fragmentShader + '|' + Object.keys(o.material.uniforms).sort().join()) : '-')).join(' '));
