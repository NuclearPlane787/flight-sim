// v0.7.4, fix 6: the terrain shader's sea-distance fallback (no water texture) takes the CPU's low-land branch in a
// region with land below sea level; East Asia's shader text is what it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inRegion } from './region-run.mjs';

const src = readFileSync(new URL('../src/world/glsl.js', import.meta.url), 'utf8');
const hf = readFileSync(new URL('../src/world/heightfield.js', import.meta.url), 'utf8');

test('East Asia: the fallback is the text it always had (a height below 0 is sea)', async () => {
  const { REGION_ID } = await import('../src/world/regions.js');
  if (REGION_ID === 'europe') return;
  const g = await import('../src/world/glsl.js');
  assert.equal(g.LOW_LAND, false);
  assert.equal(g.SEA_FALLBACK, 'rawH * 20.0');
  const all = Object.values(g).filter((v) => typeof v === 'string').join('\n');
  assert.ok(all.includes('float dn = uHasWater > 0.5 ? waterField(m).r : rawH * 20.0;'), 'the pushed v0.7.3 line, character for character');
});

test('the shader source builds the line from SEA_FALLBACK, and the CPU keeps the branch it mirrors', () => {
  assert.ok(src.includes('float dn = uHasWater > 0.5 ? waterField(m).r : ${SEA_FALLBACK};'));
  assert.ok(hf.includes('if (LOW_LAND) return (nat || TH) && rawHeight(x, y) !== 0 ? 1000 : -1000;'));
});

if (inRegion('europe', import.meta.url)) {
  test('Europe (low land): exactly 0 is the sea, anything else land, below sea level too', async () => {
    const g = await import('../src/world/glsl.js');
    assert.equal(g.LOW_LAND, true);
    assert.equal(g.SEA_FALLBACK, '(rawH != 0.0 ? 1000.0 : -1000.0)');
    const all = Object.values(g).filter((v) => typeof v === 'string').join('\n');
    assert.ok(all.includes('float dn = uHasWater > 0.5 ? waterField(m).r : (rawH != 0.0 ? 1000.0 : -1000.0);'));
    assert.ok(!all.includes('waterField(m).r : rawH * 20.0'));
  });
}
