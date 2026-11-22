// v0.7.4 part 9, item 1: the 250 m data's edge blended into the 1 km level (tilestore.js's EDGE_BLEND, EDGE_BLEND_M).
// Both regions, read straight from their data folders (the store is pure, so it needs no FS_REGION):
// - the step at the seams between a covered 250 m tile and ground read from the 1 km level is gone (it was up to ~230 m);
// - every cell farther than EDGE_BLEND_M from such a seam is exactly as baked;
// - no airport's ground moves: the height at every airport's reference point, runway ends and stands is identical with
//   the blend on and off (and every airport lies far from any seam);
// - edgeBlend: false is the store as before v0.7.4, and EDGE_BLEND is on by default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createTileStore, EDGE_BLEND, EDGE_BLEND_M } from '../src/world/tilestore.js';
import { tileOutline } from '../src/world/region.js';

const GAME = new URL('../', import.meta.url);
const REGIONS = { 'east-asia': 'data/', europe: 'data/europe/' };

function open(id) {
  const dir = new URL(REGIONS[id], GAME);
  if (!existsSync(new URL('manifest.json', dir))) return null;
  const m = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
  if (!m.tilesRegion) return null;
  const readGz = async (rel) => { try { const b = gunzipSync(readFileSync(new URL(rel, dir))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } catch { return null; } };
  const mk = (edgeBlend) => createTileStore(m.tilesRegion, { readGz, layers: ['h'], maxTiles: 4000, edgeBlend });
  const files = [...new Set([...(m.airports || []), ...(m.airportsRegion || []), ...(m.airportsPending || [])])];
  const airports = files.map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
  return { m, spec: m.tilesRegion, mk, airports };
}

// Seam sample points: along every open side of the covered tiles, every km, where both sides are land (> 5 m) 2 km
// either side and inside the 1 km level's extent: the seams between the two levels, not the coast or the region's end.
async function seamPoints(R, store) {
  const spec = R.spec, E1 = spec.levels[1].extent, c1 = spec.levels[1].cell, mg = 3000;
  const in1 = (x, y) => x > spec.x0 + E1.i0 * c1 + mg && x < spec.x0 + E1.i1 * c1 - mg && y > spec.y0 + E1.j0 * c1 + mg && y < spec.y0 + E1.j1 * c1 - mg;
  const out = [];
  for (const [x0, y0, x1, y1] of tileOutline(spec)) {
    const horiz = y0 === y1, L = horiz ? Math.abs(x1 - x0) : Math.abs(y1 - y0);
    for (let s = 500; s < L; s += 1000) {
      const x = horiz ? Math.min(x0, x1) + s : x0, y = horiz ? y0 : Math.min(y0, y1) + s;
      const at = (o) => (horiz ? [x, y + o] : [x + o, y]);
      const [ax, ay] = at(-2125), [bx, by] = at(2125);
      if (!in1(ax, ay) || !in1(bx, by)) continue;
      await store.whenReady(x, y, 2500);
      if (Math.min(store.height(ax, ay), store.height(bx, by), store.height(...at(-125)), store.height(...at(125))) * 0.25 < 5) continue;
      out.push({ x, y, at });
    }
  }
  return out;
}

// Distance (m) from (x, y) to the nearest ground read from the 1 km level (an uncovered tile, or beyond the extent).
function distL1(spec, x, y) {
  const L = spec.levels[0], T = L.tile * L.cell, E = spec.extent, cov = L.covered ? new Set(L.covered) : null;
  const ti = Math.floor((x - spec.x0) / T), tj = Math.floor((y - spec.y0) / T);
  let d = Infinity;
  for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) {
    const i = ti + a, j = tj + b;
    const outside = i * L.tile < E.i0 || (i + 1) * L.tile > E.i1 || j * L.tile < E.j0 || (j + 1) * L.tile > E.j1;
    if (!outside && (!cov || cov.has(i + '_' + j))) continue;
    const x0 = spec.x0 + i * T, y0 = spec.y0 + j * T;
    d = Math.min(d, Math.hypot(Math.max(x0 - x, 0, x - x0 - T), Math.max(y0 - y, 0, y - y0 - T)));
  }
  return d;
}

test('EDGE_BLEND: on by default, 4 km', () => {
  assert.equal(EDGE_BLEND, process.env.FS_EDGEBLEND !== '0');
  assert.equal(EDGE_BLEND_M, 4000);
});

for (const id of Object.keys(REGIONS)) {
  const R = open(id);
  test(`${id}: the step at the 250 m data's edge is gone; the 1 km level's own slope is all that is left`, { skip: !R }, async () => {
    const on = R.mk(true), off = R.mk(false);
    const pts = await seamPoints(R, off);
    assert.ok(pts.length > 1000, `seam samples ${pts.length}`);
    let worstOn = 0, worstOff = 0, bigOff = 0, bigOn = 0, midOn = 0, midOff = 0;
    for (const p of pts) {
      await on.whenReady(p.x, p.y, 2500);
      // The height 1 m either side of the seam.
      const dOn = Math.abs(on.height(...p.at(1)) - on.height(...p.at(-1))) * 0.25;
      const dOff = Math.abs(off.height(...p.at(1)) - off.height(...p.at(-1))) * 0.25;
      if (dOn > worstOn && process.env.P9_DEBUG) console.log(id, 'worst so far', p.x, p.y, dOn.toFixed(1), dOff.toFixed(1), [-300, -125, -1, 1, 125, 300].map((o) => (on.height(...p.at(o)) * 0.25).toFixed(1)).join(' '), '| off', [-300, -125, -1, 1, 125, 300].map((o) => (off.height(...p.at(o)) * 0.25).toFixed(1)).join(' '));
      worstOn = Math.max(worstOn, dOn); worstOff = Math.max(worstOff, dOff);
      if (dOff > 50) bigOff++;
      if (dOn > 50) bigOn++;
      if (dOn > 10) midOn++;
      if (dOff > 10) midOff++;
    }
    // Before: walls of tens to hundreds of metres (Europe's Cantabrian edge 229 m, East Asia's Taihang 128 m).
    // v0.7.6: Europe's batch E covered Scotland's north (Lewis, Caithness, Orkney), where Europe's last walls were (113 m
    // at y = 1,280 km in v0.7.5's data); every 250 m edge left in Europe lies in the sea or on low ground (worst 6 m,
    // on the east edge at x = 1,152 km). So the "before" walls are asserted for East Asia alone; Europe's is that the
    // blend leaves nothing worse than it found, which a blend that did nothing would pass too: East Asia's case (the
    // same code) is the one that catches a broken blend now.
    if (id === 'europe') assert.ok(worstOff < 30 && bigOff === 0 && worstOn <= worstOff + 1, `europe: before ${worstOff.toFixed(1)} m, after ${worstOn.toFixed(1)} m`);
    else assert.ok(worstOff > 100 && bigOff > 5, `before: worst ${worstOff.toFixed(0)} m, ${bigOff} over 50 m`);
    // After: what is left 2 m across is the difference between the 1 km level's bilinear and the bilinear of its values
    // at the 250 m cells' centres, the 1 km field's kinks at its own cell centres sampled 250 m apart: under a few
    // metres almost everywhere, up to about 27 m on the steepest 1 km slopes (Scotland's north edge, a 150 m/km climb).
    assert.ok(worstOn < 30, `after: worst ${worstOn.toFixed(1)} m across the seam`);
    assert.ok(bigOn === 0 && midOn * 5 < Math.max(midOff, 1), `after: ${bigOn} over 50 m, ${midOn} over 10 m (before ${midOff})`);
    assert.equal(on.misses + off.misses, 0);
  });

  test(`${id}: beyond ${EDGE_BLEND_M} m of a seam every height is as baked`, { skip: !R }, async () => {
    const on = R.mk(true), off = R.mk(false);
    const pts = await seamPoints(R, off);
    let n = 0, moved = 0;
    for (const p of pts.filter((_, i) => i % 7 === 0)) {
      for (const o of [-EDGE_BLEND_M - 400, -EDGE_BLEND_M - 2000, EDGE_BLEND_M + 400, -9000, 9000]) {
        const [x, y] = p.at(o);
        if (distL1(R.spec, x, y) < EDGE_BLEND_M + 300) continue;   // (near another open side: a corner)
        await on.whenReady(x, y, 300); await off.whenReady(x, y, 300);
        n++;
        if (on.height(x, y) !== off.height(x, y)) moved++;
      }
      // and inside the band the heights do move somewhere (the blend is on)
    }
    assert.ok(n > 500);
    assert.equal(moved, 0, `${moved} of ${n} heights beyond the band moved`);
  });

  test(`${id}: no airport's ground moves (reference points, runway ends, stands), and each is far from any seam`, { skip: !R }, async () => {
    const on = R.mk(true), off = R.mk(false);
    const seams = tileOutline(R.spec);
    let n = 0;
    for (const a of R.airports) {
      const pts = [a.origin];
      for (const r of a.runways || []) for (const e of r.ends || []) { pts.push([e.x, e.y]); if (e.pavementEnd) pts.push(e.pavementEnd); }
      for (const s of a.stands || []) pts.push([s.x, s.y]);
      await on.whenReady(a.origin[0], a.origin[1], 8000); await off.whenReady(a.origin[0], a.origin[1], 8000);
      for (const [x, y] of pts) {
        await on.whenReady(x, y, 300); await off.whenReady(x, y, 300);
        assert.equal(on.height(x, y), off.height(x, y), `${a.icao} at ${x}, ${y}`);
        n++;
      }
      // the nearest open side of the 250 m data
      let d = Infinity;
      for (const [x0, y0, x1, y1] of seams) {
        const dx = Math.max(Math.min(x0, x1) - a.origin[0], 0, a.origin[0] - Math.max(x0, x1)), dy = Math.max(Math.min(y0, y1) - a.origin[1], 0, a.origin[1] - Math.max(y0, y1));
        d = Math.min(d, Math.hypot(dx, dy));
      }
      assert.ok(d > EDGE_BLEND_M + 20000, `${a.icao}: ${(d / 1000).toFixed(0)} km from the 250 m data's edge`);
    }
    assert.ok(n > 1000, `${n} points`);
    assert.equal(on.misses + off.misses, 0);
  });

  // (The lead's follow-up: before tilestore.js kept each cell's class, 91 land cells became sea and 13,258 sea cells
  // became land in Europe, and 6 and 320 in East Asia, at coasts where the 1 km level's coast isn't the 250 m one's.)
  test(`${id}: no blended cell changes between land and sea (every covered tile beside a seam, every cell)`, { skip: !R }, async () => {
    const on = R.mk(true), off = R.mk(false), spec = R.spec;
    const zeroSea = (spec.sea || {}).h === 0;   // Europe: a stored 0 is the sea; East Asia: the sea is at or below 0
    const land = zeroSea ? (v) => v !== 0 : (v) => v > 0;
    const L = spec.levels[0], T = L.tile, E = spec.extent, cov = L.covered ? new Set(L.covered) : null;
    let tiles = 0, moved = 0, changed = 0;
    for (const name of L.tiles) {
      const [ti, tj] = name.split('_').map(Number);
      if (cov && !cov.has(name)) continue;
      let seam = false;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        if (!a && !b) continue;
        const i = ti + a, j = tj + b;
        if (i * T < E.i0 || (i + 1) * T > E.i1 || j * T < E.j0 || (j + 1) * T > E.j1 || (cov && !cov.has(i + '_' + j))) seam = true;
      }
      if (!seam) continue;
      const cx = spec.x0 + (ti + 0.5) * T * L.cell, cy = spec.y0 + (tj + 0.5) * T * L.cell;
      await on.whenReady(cx, cy, 0); await off.whenReady(cx, cy, 0);
      const a = on.tileGrid(name).height, b = off.tileGrid(name).height;
      tiles++;
      for (let k = 0; k < a.length; k++) { if (a[k] !== b[k]) moved++; if (land(a[k]) !== land(b[k])) changed++; }
    }
    assert.ok(tiles > 40 && moved > 100000, `${tiles} seam tiles, ${moved} cells blended`);
    assert.equal(changed, 0, `${changed} cells changed between land and sea`);
    assert.equal(on.misses + off.misses, 0);
  });
}
