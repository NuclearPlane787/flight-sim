// Node tests for the pure world helpers: heightfield sampling and runway lookups.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHeightfield, patchWeight } from '../src/world/heightfield.js';
import { createAirports, fallbackAirports } from '../src/world/runways.js';
import { trueToMag, gridToTrue } from '../src/world/frame.js';

const DATA = new URL('../data/', import.meta.url);

// A 4x4 national grid of 100 m cells, heights 0.25 m units: h = 10*i + 100*j metres.
function synthetic() {
  const nx = 4, ny = 4, h = new Int16Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = (10 * i + 100 * j) * 4;
  return { heightScale: 0.25, national: { x0: 0, y0: 0, cell: 100, nx, ny, height: h, water: null, cover: null }, patches: [], coastPatches: [] };
}

test('heightAt is bilinear on the cell-centred grid, clamped at the edges', () => {
  const hf = createHeightfield(synthetic());
  assert.equal(hf.heightAt(50, 50), 0);           // centre of cell (0,0)
  assert.equal(hf.heightAt(150, 50), 10);         // centre of cell (1,0)
  assert.equal(hf.heightAt(100, 50), 5);          // halfway
  assert.equal(hf.heightAt(150, 150), 110);
  assert.ok(Math.abs(hf.heightAt(125, 175) - (7.5 + 125)) < 1e-9);
  assert.equal(hf.heightAt(-500, 50), 0);         // clamped to the edge
  assert.equal(hf.heightAt(10000, 10000), 330);
});

test('heights never go below sea level', () => {
  const l = synthetic(); l.national.height.fill(-80);
  assert.equal(createHeightfield(l).heightAt(150, 150), 0);
});

test('a patch wins inside and blends at its edges', () => {
  const l = synthetic();
  const n = 200, ph = new Int16Array(n * n).fill(1000 * 4);
  l.patches.push({ id: 'p', x0: -5000, y0: -5000, cell: 50, nx: n, ny: n, height: ph });
  const hf = createHeightfield(l);
  assert.equal(hf.heightAt(150, 150), 1000);
  const p = l.patches[0];
  assert.equal(patchWeight(p, -5000 + 20, 0), 0);
  assert.equal(patchWeight(p, 0, 0), 1);
});

test('runways are flattened to their end elevations', () => {
  const l = synthetic();
  const ap = [{ icao: 'TEST', elevM: 50, runways: [{ id: '09/27', widthM: 45, ends: [{ ident: '09', x: 0, y: 200, elevM: 40 }, { ident: '27', x: 400, y: 200, elevM: 60 }] }] }];
  const hf = createHeightfield(l, { airports: ap });
  assert.ok(Math.abs(hf.heightAt(0, 200) - 40) < 1e-9);
  assert.ok(Math.abs(hf.heightAt(200, 200) - 50) < 1e-9);
  assert.ok(Math.abs(hf.heightAt(400, 210) - 60) < 1e-9);
});

test('no data: a flat sea-level world that is all water', () => {
  const hf = createHeightfield({ national: null, patches: [], coastPatches: [] });
  assert.equal(hf.heightAt(1234, 5678), 0);
  assert.equal(hf.waterAt(0, 0), true);
  assert.deepEqual(hf.coverAt(0, 0), { forest: 0, farm: 0, urban: 0 });
});

function realAirports() {
  const list = [];
  for (const f of ['RKSS', 'RKPC', 'RKSI']) {
    const u = new URL(`airports/${f}.json`, DATA);
    if (existsSync(u)) list.push(JSON.parse(readFileSync(u, 'utf8')));
  }
  return list;
}

for (const [label, list] of [['fallback', fallbackAirports()], ['baked', realAirports()]]) {
  test(`runway headings match their numbers (${label} data)`, { skip: list.length === 0 }, () => {
    const ap = createAirports(list);
    for (const a of ap.airports) {
      for (const r of a.runways) {
        for (const e of r.ends) {
          const end = ap.findRunwayEnd(a.icao, e.ident);
          assert.ok(end, `${a.icao} ${e.ident}`);
          const mag = trueToMag(gridToTrue(end.hdgGrid, end.x, end.y), end.x, end.y) * 180 / Math.PI;
          let num = parseInt(e.ident, 10) * 10;
          // Incheon's four parallels are 15L/R and 16L/R (ICAO numbering for >3 parallels).
          if (a.icao === 'RKSI' && (num === 160 || num === 340)) num -= 10;
          let diff = Math.abs(((mag - num + 540) % 360) - 180);
          assert.ok(diff < 6, `${a.icao} ${e.ident}: magnetic ${mag.toFixed(1)}`);
        }
      }
    }
  });
}

test('onRunway and groundKind', () => {
  const ap = createAirports(fallbackAirports());
  const e = ap.findRunwayEnd('RKSS', '14R');
  const mx = e.x + e.ux * 1000, my = e.y + e.uy * 1000;
  assert.equal(ap.onRunway(mx, my).id, '14R/32L');
  assert.equal(ap.groundKind(mx, my), 'runway');
  assert.equal(ap.onRunway(mx + e.uy * 200, my - e.ux * 200), null);
  assert.equal(ap.groundKind(mx + e.uy * 200, my - e.ux * 200), 'ground');
  assert.ok(Math.abs(e.lengthM - 3200) < 60, `14R length ${e.lengthM}`);
  assert.equal(ap.findRunwayEnd('RKPC', '07').ident, '07');
  assert.equal(ap.findRunwayEnd('XXXX', '07'), null);
});

test('heightAt on the real national grid is fast (< ~1 µs)', { skip: !existsSync(new URL('terrain/height.i16.gz', DATA)) }, () => {
  const m = JSON.parse(readFileSync(new URL('manifest.json', DATA), 'utf8'));
  const n = m.national;
  const h = new Int16Array(gunzipSync(readFileSync(new URL(n.height, DATA))).buffer.slice(0));
  const hf = createHeightfield({ heightScale: m.heightScale, national: { ...n, height: h, water: null, cover: null }, patches: [], coastPatches: [] },
    { airports: fallbackAirports() });
  let s = 0;
  const N = 200000, t0 = performance.now();
  for (let k = 0; k < N; k++) s += hf.heightAt(-150000 + (k % 1000) * 37, -200000 + k * 0.9);
  const us = (performance.now() - t0) * 1000 / N;
  assert.ok(us < 1.5, `${us.toFixed(3)} µs per call`);
  // Hallasan: the highest point near Jeju is about 1,947 m.
  const g = fallbackAirports().find((a) => a.icao === 'RKPC').origin;
  let max = 0;
  for (let dy = -30000; dy <= 0; dy += 250) for (let dx = -15000; dx <= 15000; dx += 250) max = Math.max(max, hf.heightAt(g[0] + dx, g[1] + dy));
  assert.ok(max > 1800 && max < 2000, `Hallasan ${max}`);
  console.log(`heightAt ${us.toFixed(3)} µs, Hallasan ${max.toFixed(0)} m`);
});
