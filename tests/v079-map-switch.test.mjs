// v0.7.9 (map): the switch ?map79=0 (node FS_MAP79=0) gives the path map of the pushed v0.7.8, call for call. The map is
// drawn in node into a recording 2D context (tests/v079-map-calls.mjs, a child process a region, since the region binds
// at import), for fixed views from the whole region to 2 m a pixel over Incheon, Haneda, Heathrow, Charles de Gaulle,
// Frankfurt, Ramstein, Zaragoza, Kunsan and Komatsu, with the aircraft on the ground, a destination and a taxi route.
// The hashes below are of the frozen v0.7.8's own map.js and data, taken with the same harness (every call and every
// property set, in order, with its arguments). With the switch on, every view changes (the kinds' legend at least).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'v079-map-calls.mjs');
const V078 = {
  'east-asia': {
    'all': '766a61056b62bf4d1fdbe6c2008cc5650ce24c49fa7f6c31ee505842c5fa26e9',   // 41686 calls
    'rksi-300': '5959888efc278cf8757dcf5aac67939de037a9933b8443baf65bb5c7a90b6f8e',   // 14191 calls
    'rksi-40': '6c8940b4e9a18259d23f1718849208fe7746ba6dc388d8edae14cf00eaf05ba4',   // 7945 calls
    'rksi-8': 'cb27efbad363e9fc9f2e3090fcfa32c0e3ee7cd28c940f9ca92299f6744f62e1',   // 2236 calls
    'rksi-2': '5bc8c637eabd1fd7f96c461df9d36de89ec8367ac0dbbadf01913ff24cf746e6',   // 1962 calls
    'rjtt-5': 'e6958920030f21086c8758d43987675af1b3812c564252f9ccafe9390a267409',   // 6461 calls
    'rkjk-12': 'd4e87fb1418e7d47b14cef87983bef7b5d12d09384414c3071f2aa21ea396d0c',   // 4270 calls
    'rjnk-60': 'fb8134e1978dcd33a8e6120644434a7fb99004c4e71e73f3b1c56142e649ab40',   // 3358 calls
  },
  europe: {
    'all': '9c977e4b754ac9fd381f076c9b8a5d4f86dae965d0f3ecd122b65b5904183141',   // 54484 calls
    'egll-300': '978a0d04a00535b19d706d56d4fa27d889e0f8931bb8246cf7c096b34a709483',   // 27041 calls
    'egll-30': 'aa09e4f0d363111c4c331607f697fb30e067ca4dd00c78fdae492b34db6ffda7',   // 6564 calls
    'egll-6': 'a6d4148b9dfb447b73c19a4731190bc21a30d1967f057d1b5569c149d3eae949',   // 4397 calls
    'egll-2': '57691c8bda129c8b42ed972f74e9ba22fba9d8e2a32d6c3af8297bbcc55af817',   // 3813 calls
    'lfpg-3': '2a38dfaf32d25e10dc437630ee58b8dd16c1931cb29c89079e48687ece8263cf',   // 4043 calls
    'eddf-12': '04536d554d47295c16455ce157b28dd025900ec0d7e8ba39c1e38a1daef17c1c',   // 3289 calls
    'etar-8': '59ccc66ee06086fc418fa4a5c8301dff3d8dd101d0003ba627b4ae155279bbaf',   // 2102 calls
    'etar-40': 'eb12f2d35304053825406541adc10e4861866682d7341e8e7b45b508e6c0e81d',   // 2003 calls
    'lezg-15': 'aa2f19052e1b8a69c474609e2656f237955cb881c00571c60463a243990df865',   // 2139 calls
  },
};
function run(region, map79) {
  const env = { ...process.env, FS_REGION: region, FS_MAP79: map79 };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [HARNESS], { env, encoding: 'utf8', maxBuffer: 16 << 20 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
for (const region of ['east-asia', 'europe']) {
  test(`${region}: with ?map79=0 every view's canvas calls are v0.7.8's`, () => {
    const got = run(region, '0');
    assert.equal(got.region, region);
    for (const [name, sha] of Object.entries(V078[region])) assert.equal(got.views[name]?.sha, sha, `${region} ${name}`);
  });
  test(`${region}: with the switch on every view is drawn differently`, () => {
    const got = run(region, '1');
    for (const [name, sha] of Object.entries(V078[region])) assert.notEqual(got.views[name]?.sha, sha, `${region} ${name}`);
  });
}
