// v0.7.8 part 6, item 1 (briefs/V0-7-8.md; ROADMAP "Found while building v0.7.7"): the Fens and East Anglia as open arable
// land (ground.js's fens78Glsl(), behind ?fens78 / FS_FENS78, on by default). Switched off, Europe's terrain shader is
// v0.7.7's text (SHA-256, first 16 hex digits, of the text the frozen v0.7.7 tree builds: tests/v078-trees-hash.mjs, with
// the trees' switch off too); East Asia's is untouched either way. The boxes' weight, worked on the CPU as the shader
// has it, is 1 over the Fens and East Anglia and 0 at London, Lincoln and the Midlands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const V077 = { ea: ['7aecf5da04d4e136', 'f67e6fb5cfeef5a3'], europe: ['5c0430ae156011fb', 'e26cc34f3563060e'] };
const HELPER = fileURLToPath(new URL('./v078-trees-hash.mjs', import.meta.url));
const terrain = (region, fens) => {
  const r = spawnSync(process.execPath, [HELPER], { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, FS_REGION: region === 'ea' ? '' : region, FS_TREES78: '0', FS_TOWERS78: '0', FS_SNOW78: '0', FS_TOWNS79: '0' /* v0.7.9: the far towns off too */, FS_FENS78: fens ? '1': '0' } });
  const m = /HASH78 (.*)/.exec(r.stdout + r.stderr);
  assert.ok(m, r.stdout + r.stderr);
  return JSON.parse(m[1]).terrain.slice(0, 2);
};

test('v0.7.8 fens: switched off, Europe\'s terrain shader is v0.7.7\'s; on, only its fragment text changes', () => {
  assert.deepEqual(terrain('europe', false), V077.europe);
  const on = terrain('europe', true);
  assert.equal(on[0], V077.europe[0]);
  assert.notEqual(on[1], V077.europe[1]);
});
test('v0.7.8 fens: East Asia\'s terrain shader is v0.7.7\'s with the switch on or off', () => {
  assert.deepEqual(terrain('ea', true), V077.ea);
  assert.deepEqual(terrain('ea', false), V077.ea);
});

test('v0.7.8 fens: the splice finds v0.7.7\'s hedge line once, and only with fields77 on', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const g = await import(${JSON.stringify(new URL('../src/world/ground.js', import.meta.url).href)});
    const on = g.euGroundGlsl(g.GROUND_GLSL, true, true), off = g.euGroundGlsl(g.GROUND_GLSL, true, false);
    const no77 = g.euGroundGlsl(g.GROUND_GLSL, false, true) === g.euGroundGlsl(g.GROUND_GLSL, false, false);
    console.log(JSON.stringify({ has: on.includes('hedge = w.r * (1.0 - fens78) + w.g'), off: off.includes('fens78'), no77, lines: on.split('\\n').length - off.split('\\n').length }));`],
  { encoding: 'utf8', env: { ...process.env, FS_REGION: 'europe' } });
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(o, { has: true, off: false, no77: true, lines: 3 });
});

test('v0.7.8 fens: the open-field weight by place (the shader\'s boxes and easing, on the CPU)', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const g = await import(${JSON.stringify(new URL('../src/world/ground.js', import.meta.url).href)});
    const f = await import(${JSON.stringify(new URL('../src/world/frame.js', import.meta.url).href)});
    const K = g.euConic(), eLat = g.FENS78_EASE_KM / 111.2 / 2, eLon = g.FENS78_EASE_KM / (111.2 * Math.cos(52.5 * Math.PI / 180)) / 2;
    const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
    const w = (lat, lon) => {
      const [x, y] = f.toMap(lat, lon), ax = x, ay = K.rho0 - y;
      const fLat = 46 + (K.rhoA - Math.hypot(ax, ay)) * K.degPerM, fLon = f.LON0 + Math.atan2(ax, ay) * K.lonK;
      const box = ([S, N, W, E]) => ss(S - eLat, S + eLat, fLat) * (1 - ss(N - eLat, N + eLat, fLat)) * ss(W - eLon, W + eLon, fLon) * (1 - ss(E - eLon, E + eLon, fLon));
      return Math.max(box(g.FENS78_BOXES[0]), box(g.FENS78_BOXES[1]));
    };
    const P = { ely: [52.40, 0.26], wisbech: [52.66, 0.16], march: [52.55, 0.09], norwich: [52.63, 1.30], thetford: [52.41, 0.75], kingslynn: [52.75, 0.40],
      london: [51.51, -0.10], lincoln: [53.23, -0.54], leicester: [52.64, -1.13], ipswich: [52.06, 1.16], northampton: [52.24, -0.90] };
    console.log(JSON.stringify(Object.fromEntries(Object.entries(P).map(([k, [a, o]]) => [k, +w(a, o).toFixed(3)]))));`],
  { encoding: 'utf8', env: { ...process.env, FS_REGION: 'europe' } });
  const W = JSON.parse(r.stdout.trim().split('\n').pop());
  for (const k of ['ely', 'wisbech', 'march', 'norwich', 'thetford', 'kingslynn']) assert.equal(W[k], 1, `${k}: ${W[k]}`);
  for (const k of ['london', 'lincoln', 'leicester', 'northampton']) assert.equal(W[k], 0, `${k}: ${W[k]}`);
  assert.ok(W.ipswich > 0 && W.ipswich <= 1, 'Ipswich at the south edge: eased');
});
