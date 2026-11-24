// v0.7.8 part 6, item 5 (briefs/V0-7-8.md; "little snow on the Alps"): Europe's snow line by latitude (ground.js's
// snow78Frag(), behind ?snow78 / FS_SNOW78, on by default). Switched off, Europe's terrain shader is v0.7.7's text
// (SHA-256, first 16 hex digits, from the frozen v0.7.7 tree through tests/v078-trees-hash.mjs, the other v0.7.8 look
// switches off); East Asia's is v0.7.7's with the switch on or off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const V077 = { ea: ['7aecf5da04d4e136', 'f67e6fb5cfeef5a3'], europe: ['5c0430ae156011fb', 'e26cc34f3563060e'] };
const HELPER = fileURLToPath(new URL('./v078-trees-hash.mjs', import.meta.url));
const terrain = (region, snow) => {
  const r = spawnSync(process.execPath, [HELPER], { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, FS_REGION: region === 'ea' ? '' : region, FS_TREES78: '0', FS_TOWERS78: '0', FS_FENS78: '0', FS_TOWNS79: '0' /* v0.7.9: the far towns off too */, FS_SNOW78: snow ? '1': '0' } });
  const m = /HASH78 (.*)/.exec(r.stdout + r.stderr);
  assert.ok(m, r.stdout + r.stderr);
  return JSON.parse(m[1]).terrain.slice(0, 2);
};

test('v0.7.8 snow: switched off, Europe\'s terrain shader is v0.7.7\'s; on, only its fragment text changes', () => {
  assert.deepEqual(terrain('europe', false), V077.europe);
  const on = terrain('europe', true);
  assert.equal(on[0], V077.europe[0]);
  assert.notEqual(on[1], V077.europe[1]);
});
test('v0.7.8 snow: East Asia\'s terrain shader is v0.7.7\'s with the switch on or off', () => {
  assert.deepEqual(terrain('ea', true), V077.ea);
  assert.deepEqual(terrain('ea', false), V077.ea);
});
test('v0.7.8 snow: the line by latitude, and the splice\'s anchor once', async () => {
  const g = await import('../src/world/ground.js');
  const L = (lat) => g.snow78Line(lat);
  assert.ok(L(46) === g.SNOW78_LINE_M && L(46) >= 2300 && L(46) <= 2600, 'the Alps (the 250 m grid\'s height)');
  assert.ok(L(37.05) > 3000 && L(37.05) < 3300, 'Sierra Nevada: its top only');
  assert.ok(L(42.6) < 2900, 'the Pyrenees\' tops');
  assert.ok(L(56.8) > 1345, 'never on Scotland\'s Ben Nevis');
  assert.throws(() => g.snow78Frag('void main() {}'));
  const a = '          float cap = smoothstep(2650.0, 3050.0, vHighH + 300.0 * (tex2 - 0.5)) * (1.0 - 0.7 * smoothstep(0.55, 0.9, slope));\n';
  const s = g.snow78Frag('x\n' + a + 'y\n');
  assert.ok(s.includes('float sLine78') && s.includes('smoothstep(0.45, 0.8, slope)') && !s.includes('2650.0'));
});
