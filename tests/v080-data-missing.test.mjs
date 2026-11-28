// v0.8.0: data/ as its own repository. The loading screen's line when the data isn't cloned
// (src/world/data-check.js, called first in main.js's boot()), and the install tool that writes into
// data/ leaving .git and README.md alone (tools/install-region.py's skipped()). No git runs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataMissing, checkData, DATA_MISSING_LINE, DATA_CLONE } from '../src/world/data-check.js';

const GAME = new URL('../', import.meta.url);
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body) });

test('v0.8.0 data check: the line is one line with the clone command', () => {
  assert.equal(DATA_CLONE, 'git clone https://github.com/NuclearPlane787/flight-sim-data.git data');
  assert.ok(DATA_MISSING_LINE.includes(DATA_CLONE));
  assert.ok(!/\n/.test(DATA_MISSING_LINE));
});

test('v0.8.0 data check: dataMissing() by the first fetch\'s outcome', () => {
  assert.equal(dataMissing(null), true);                       // the fetch threw
  assert.equal(dataMissing({ ok: false, status: 404 }), true);
  assert.equal(dataMissing({ ok: true }, undefined), true);    // the body didn't parse
  assert.equal(dataMissing({ ok: true }, null), true);
  assert.equal(dataMissing({ ok: true }, [1, 2]), true);
  assert.equal(dataMissing({ ok: true }, 'x'), true);
  assert.equal(dataMissing({ ok: true }, { tilesRegion: {} }), false);
  assert.equal(dataMissing({ ok: true }, {}), false);
});

test('v0.8.0 data check: checkData() asks for the region\'s manifest.json in its own folder', async () => {
  const asked = [];
  const ok = async (u) => { asked.push(u); return res(200, { airports: [] }); };
  assert.equal(await checkData('http://127.0.0.1:8014/games/flight-sim/data/', ok), null);
  assert.equal(await checkData('http://127.0.0.1:8014/games/flight-sim/data/europe/', ok), null);
  assert.deepEqual(asked, ['http://127.0.0.1:8014/games/flight-sim/data/manifest.json', 'http://127.0.0.1:8014/games/flight-sim/data/europe/manifest.json']);
  assert.equal(await checkData('http://h/data/', async () => res(404, {})), DATA_MISSING_LINE);
  assert.equal(await checkData('http://h/data/', async () => { throw new TypeError('Failed to fetch'); }), DATA_MISSING_LINE);
  assert.equal(await checkData('http://h/data/', async () => res(200, '<html>')), DATA_MISSING_LINE);   // an index page, not JSON
});

test('v0.8.0 data check: the real data/ passes (the manifest as the browser would read it)', async () => {
  const read = async (u) => {
    const p = fileURLToPath(u);
    return existsSync(p) ? res(200, readFileSync(p, 'utf8')) : res(404, {});
  };
  assert.equal(await checkData(new URL('data/', GAME).href, read), null);
  assert.equal(await checkData(new URL('data/europe/', GAME).href, read), null);
  assert.equal(await checkData(new URL('no-such-data/', GAME).href, read), DATA_MISSING_LINE);
});

test('v0.8.0 data check: main.js asks before any loader, and stops on the loading screen', () => {
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const i = src.indexOf("import('./world/data-check.js')");
  const j = src.indexOf('hfMod.loadHeightfield(base)');
  assert.ok(i > 0 && j > i, 'the check comes before the first loader');
  assert.match(src.slice(i, j), /if \(dataLine\) \{ ui\.loadingText\.textContent = dataLine; return; \}/);
});

function py(args) {
  return spawnSync('python3', ['-I', ...args], { encoding: 'utf8', timeout: 30000 });
}

test('v0.8.0 install-region.py: skipped() leaves out .git and the top README.md', () => {
  const tool = fileURLToPath(new URL('../tools/install-region.py', import.meta.url));
  const cases = ['.git/config', '.git', 'terrain/.git/x', 'README.md', 'terrain/r0/0_0.h.i16.gz', 'manifest.json', 'centres/README.md', 'STARS-CREDIT.md'];
  const r = py(['-c', 'import importlib.util, json, sys\ns = importlib.util.spec_from_file_location("ir", sys.argv[1]); m = importlib.util.module_from_spec(s); s.loader.exec_module(m)\nprint(json.dumps([m.skipped(c) for c in sys.argv[2:]]))', tool, ...cases]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [true, true, true, true, false, false, false, false]);
});

test('v0.8.0 install-region.py: a staged tree with .git and README.md, dry run, leaves them out', () => {
  const tool = fileURLToPath(new URL('../tools/install-region.py', import.meta.url));
  const T = `/tmp/flight-sim/v080/repo/fixture-${process.pid}`;
  rmSync(T, { recursive: true, force: true });
  mkdirSync(`${T}/tree/.git`, { recursive: true });
  mkdirSync(`${T}/tree/terrain/r0`, { recursive: true });
  const files = { '.git/HEAD': 'ref: refs/heads/main\n', 'README.md': 'not the data repository\'s\n', 'terrain/r0/v080test_0.h.i16.gz': 'x', 'manifest.json': '{}\n' };
  for (const [rel, body] of Object.entries(files)) writeFileSync(`${T}/tree/${rel}`, body);
  const sha = py(['-c', 'import hashlib, sys\nfor rel in sys.argv[2:]:\n    print(hashlib.sha256(open(sys.argv[1] + "/" + rel, "rb").read()).hexdigest() + "  " + rel)', `${T}/tree`, ...Object.keys(files)]);
  assert.equal(sha.status, 0, sha.stderr);
  writeFileSync(`${T}/list.sha256`, sha.stdout);
  const r = py([tool, 'europe', `${T}/tree`, `${T}/list.sha256`, '--dry-run']);
  rmSync(T, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 listed file\(s\) left out \(\.git, README\.md/);
  assert.match(r.stdout, /2 staged files checked against the list; 1 to install/);
  assert.match(r.stdout, /dry run: nothing copied/);
  assert.ok(!existsSync(fileURLToPath(new URL('data/europe/terrain/r0/v080test_0.h.i16.gz', GAME))));
});
