// v0.7.0: a test file for one region inside the one suite. frame.js binds its region once, at import, so a file
// that needs another region than the run's is run again in a child process opened in that region, and the parent
// reports the child's result as one test:
//
//   import { inRegion } from './region-run.mjs';
//   if (inRegion('europe', import.meta.url)) {
//     test('…', () => { … });          // runs with FS_REGION=europe: frame.js, the data folder and the lists are Europe's
//   }
//
// So `node --test tests/*.test.mjs` covers both regions, and `FS_REGION=europe node --test tests/v070-eu-*.test.mjs`
// runs Europe's files directly. Don't import anything at the top of such a file that reads the region's data at
// import; import inside the block (await import(...)) or inside the tests.
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { REGION_ID } from '../src/world/regions.js';

export function inRegion(region, metaUrl, { env = {} } = {}) {
  if (REGION_ID === region) return true;
  const file = fileURLToPath(metaUrl);
  test(`${path.basename(file)} in ${region} (a child process)`, () => {
    const r = spawnSync(process.execPath, ['--test', file], { env: { ...process.env, ...env, FS_REGION: region, NODE_TEST_CONTEXT: undefined }, encoding: 'utf8', maxBuffer: 64 << 20 });
    const out = (r.stdout || '') + (r.stderr || '');
    const pass = /^ℹ pass (\d+)/m.exec(out), fail = /^ℹ fail (\d+)/m.exec(out), skipped = /^ℹ skipped (\d+)/m.exec(out);
    // Nothing run and nothing skipped is a file that didn't load; all skipped is data that hasn't arrived yet (fine).
    const none = !pass || (Number(pass[1]) === 0 && !(skipped && Number(skipped[1]) > 0));
    if (r.status !== 0 || none || (fail && Number(fail[1]) > 0)) {
      throw new Error(`${path.basename(file)} failed in ${region} (exit ${r.status}):\n${out.split('\n').filter((l) => /✖|not ok|Error|expected|actual|ℹ (pass|fail)/.test(l)).slice(0, 40).join('\n')}`);
    }
  });
  return false;
}
// Europe's data arrives part by part while v0.7.0 is built: a test that needs a file skips until it is there.
export { REGION_ID };
