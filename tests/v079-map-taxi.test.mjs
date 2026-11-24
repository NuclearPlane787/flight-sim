// v0.7.9 (map), item 4: the assigned taxi route on the path map. Drawn (its casing and its line) in every view while
// gate-flow.js's phase is the route's own (parked at the gate, the pushback, taxiing out or in) and the map is zoomed in
// to 60 m a pixel or closer; gone once lined up,
// airborne or at the stand; never drawn with ?map79=0. Through tests/v079-map-calls.mjs, a child process a case.
// And the hand-off in main.js reads gate-flow's getters each frame (no array or object made for it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(HERE, 'v079-map-calls.mjs');
function run(phase, map79 = '1') {
  const env = { ...process.env, FS_REGION: 'east-asia', FS_MAP79: map79 };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [HARNESS, `--phase=${phase}`], { env, encoding: 'utf8', maxBuffer: 16 << 20 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop()).views;
}

// (a view's name ends in its metres a pixel; 'all' is the region at 3,000: the route is drawn from 60 m a pixel in)
const mppOf = (name) => (name === 'all' ? 3000 : Number(name.split('-').pop()));
for (const phase of ['taxi', 'taxi-in', 'pushback']) {
  test(`phase ${phase}: the route drawn in every view from 60 m a pixel in, none further out`, () => {
    const views = Object.entries(run(phase));
    for (const [name, v] of views) assert.equal(v.taxiLine, mppOf(name) <= 60 ? 2 : 0, name);
    assert.ok(views.filter(([n]) => mppOf(n) <= 60).length >= 5);
  });
}
for (const phase of ['departed', 'arrived', 'none']) {
  test(`phase ${phase}: no route`, () => {
    for (const [name, v] of Object.entries(run(phase))) assert.equal(v.taxiLine, 0, name);
  });
}
test('with ?map79=0 no route, whatever the phase', () => {
  for (const [name, v] of Object.entries(run('taxi', '0'))) assert.equal(v.taxiLine, 0, name);
});
test("main.js hands the map gate-flow's phase and route, as they are", () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'main.js'), 'utf8');
  assert.match(src, /view\.taxiPhase = gate\.phase; view\.taxiAssigned = gate\.route;/);
});
