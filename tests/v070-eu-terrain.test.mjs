// v0.7.0: Europe's terrain and local rules as installed in data/europe/ (batch A: 93 tiles of 250 m data, the 1 km
// level over the outline's rectangle, the country raster, WMM2025), from a process opened in Europe
// (tests/region-run.mjs runs this file in one from the default suite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url)) {
  const { REGION } = await import('../src/world/regions.js');
  const { toMap, magVar } = await import('../src/world/frame.js');
  const { setGeoRules, rulesAt, countryAt, terrainSpec, mapExtent, fineExtent, fineOutline } = await import('../src/world/region.js');
  const { createGeoRules } = await import('../src/world/geo-rules.js');
  const { tiledTerrain, DATA, manifest } = await import('./tile-terrain.mjs');
  const { terrainGround } = await import('../src/sim/predict-core.js');
  const { zoneAt, zoneLabel, zoneOfIcao, fmtZone } = await import('../src/clock.js');
  const { metarFormOf } = await import('../src/sim/weather-presets.js');
  const have = existsSync(new URL('manifest.json', DATA)) && !!manifest().tilesRegion;
  const part = (name) => {
    const header = JSON.parse(readFileSync(new URL(name + '.json', DATA), 'utf8'));
    const buf = gunzipSync(readFileSync(new URL(header.file, DATA)));
    return { header, values: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
  const FT = 0.3048;
  const at = (la, lo) => toMap(la, lo);

  test("Europe's manifest: its lattice from the frame's origin, the sea at 0, low land, the 219 tiles of batches A to D", { skip: !have }, () => {
    const m = manifest(), t = m.tilesRegion;
    assert.equal(m.lowLand, true); assert.equal(REGION.lowLand, true);          // the bake and the game agree on what a stored 0 means
    assert.equal(t.x0, 0); assert.equal(t.y0, 0);
    assert.deepEqual([t.x0, t.y0], [REGION.lattice.x0, REGION.lattice.y0]);
    assert.equal(t.sea.h, 0);
    const [l0, l1] = t.levels;
    assert.equal(l0.cell, 250); assert.equal(l0.tile, 512); assert.equal(l0.border, 2);
    assert.equal(l0.covered.length, 219);                                        // batch A's 93, v0.7.1's batch B (77), v0.7.2's batch C (31) and v0.7.3's batch D (18)
    for (const n of ['-6_-11', '-7_-10', '-8_-9', '5_-2', '7_-5', '8_-6', '1_6']) assert.ok(l0.covered.includes(n), n);   // batch D: Morocco's north, the Strait, Porto, Venice, Naples, and one north of Hamburg
    for (const n of ['-6_9', '-4_8', '-8_-3', '0_-2', '2_5', '-4_0']) assert.ok(l0.covered.includes(n), n);   // batch C: the Hebrides, the Forth, Galicia, Nice's coast, Bohemia's west, Nantes
    for (const n of ['-7_-7', '-3_3', '0_0', '6_-3', '0_4']) assert.ok(l0.covered.includes(n), n);     // west and south of 47 N 4 E are negative
    for (const n of ['-6_6', '-10_-7', '5_5', '8_1', '4_8', '-2_-3', '6_1', '-3_-7']) assert.ok(l0.covered.includes(n), n);   // batch B: Dublin, Lisbon, Berlin, Vienna, Copenhagen, Toulouse, and the rule's two
    assert.equal(l1.cell, 1000);
    assert.equal(l1.covered.length, 36);                                         // 6 x 6 tiles of 512 km round the outline
    const spec = terrainSpec(m);
    assert.equal(spec.region, true);
    // The map's rectangle is the outline's; the 250 m data's is its covered tiles'.
    assert.deepEqual(mapExtent(), { x0: -1377000, y0: -1306000, x1: 1259000, y1: 1425000 });
    assert.deepEqual(fineExtent(), { x0: -10 * 128000, y0: -11 * 128000, x1: 9 * 128000, y1: 10 * 128000 });   // v0.7.3, with batch D: three rows further south (Andalusia and Morocco's north)
    //   // v0.7.1, with batch B: tiles -10..8 by -8..9 (batch A: -7..6 by -7..5); batch C lies inside it
    assert.ok(fineOutline().length > 40);
  });

  test("the country by place, each country's zone with summer time, and the transition altitudes", { skip: !have }, () => {
    setGeoRules(createGeoRules({ magvar: part('magvar'), country: part('country') }));      // no krmask in Europe
    const C = (la, lo) => countryAt(...at(la, lo));
    for (const [n, la, lo, c] of [['London', 51.5, -0.12, 'GB'], ['Paris', 48.85, 2.35, 'FR'], ['Frankfurt', 50.11, 8.68, 'DE'], ['Madrid', 40.42, -3.7, 'ES'],
      ['Zurich', 47.37, 8.54, 'CH'], ['Amsterdam', 52.37, 4.9, 'NL'], ['Rome', 41.9, 12.5, 'IT'], ['Dublin', 53.35, -6.26, 'IE'], ['Lisbon', 38.72, -9.14, 'PT'],
      ['Vienna', 48.21, 16.37, 'AT'], ['Brussels', 50.85, 4.35, 'BE'], ['Copenhagen', 55.68, 12.57, 'DK'], ['Prague', 50.08, 14.44, 'CZ'], ['Tangier', 35.77, -5.8, 'MA'],
      ['Douglas, Isle of Man', 54.15, -4.48, 'GB'], ['St Helier, Jersey', 49.19, -2.1, 'GB']]) assert.equal(C(la, lo), c, n);
    // The sea takes its nearest land's: off Dover is the United Kingdom's, off Calais France's.
    assert.equal(C(51.10, 1.35), 'GB'); assert.equal(C(50.99, 1.80), 'FR');
    const R = (la, lo) => rulesAt(...at(la, lo));
    const ta = (r) => [Math.round(r.transAltM / FT), Math.round(r.transLevelM / FT)];
    // Set by the airport (AD 2.17) within 60 km of it; the country's beyond.
    assert.deepEqual(ta(R(51.4706, -0.4619)), [6000, 7000]);                     // Heathrow
    assert.deepEqual(ta(R(51.1481, -0.1903)), [6000, 7000]);                     // Gatwick
    assert.deepEqual(ta(R(53.35, -2.27)), [5000, 6000]);                         // Manchester: its own since v0.7.1 (UK AIP EGCC AD 2.17, read 2026-11-21); the UK's 3,000 ft was the stand-in
    assert.deepEqual(ta(R(54.5, -2.9)), [3000, 4000]);                           // the Lake District, 130 km from Manchester: the United Kingdom's own
    assert.deepEqual(ta(R(55.62, 12.65)), [5000, 6000]);                         // Copenhagen (EKCH AD 2.17: the Copenhagen Area)
    assert.deepEqual(ta(R(56.2, 9.5)), [3000, 4000]);                            // Jutland: Denmark's (ENR 1.7)
    assert.deepEqual(ta(R(48.11, 16.57)), [10000, 11000]);                       // Vienna: Austria's (ENR 1.7)
    assert.deepEqual(ta(R(53.42, -6.27)), [5000, 6000]);                         // Dublin: Ireland's (ENR 1.7)
    assert.deepEqual(ta(R(43.63, 1.36)), [5000, 6000]);                          // Toulouse (LFBO AD 2.20.2)
    assert.deepEqual(ta(R(40.4722, -3.5609)), [13000, 14000]);                   // Madrid
    assert.deepEqual(ta(R(37.42, -5.9)), [6000, 7000]);                          // Seville: Spain's
    assert.deepEqual(ta(R(41.2971, 2.0785)), [6000, 7000]);                      // Barcelona
    assert.deepEqual(ta(R(50.0333, 8.5706)), [5000, 6000]);                      // Frankfurt: Germany's, everywhere
    assert.deepEqual(ta(R(48.3538, 11.7861)), [5000, 6000]);                     // Munich
    assert.deepEqual(ta(R(49.0097, 2.5479)), [5000, 6000]);                      // Charles de Gaulle
    assert.deepEqual(ta(R(47.4647, 8.5492)), [7000, 8000]);                      // Zurich
    assert.deepEqual(ta(R(52.3086, 4.7639)), [3000, 4000]);                      // Schiphol
    assert.deepEqual(ta(R(41.8003, 12.2389)), [6000, 7000]);                     // Fiumicino
    // An airport's transition altitude stops at its country's border (v0.7.4, tests/v074-eu-transitions.test.mjs; v0.7.0
    // to v0.7.3 let it reach across, and this line expected Zurich's [7000, 8000] here): Singen is in Germany, 39 km
    // from Zurich's airport, and has Germany's own.
    const singen = R(47.76, 8.84);
    assert.equal(singen.country, 'DE'); assert.equal(singen.timeZone, 'Europe/Berlin'); assert.deepEqual(ta(singen), [5000, 6000]);
    for (const r of [R(51.5, -0.12), R(48.85, 2.35), R(40.42, -3.7), R(41.9, 12.5)]) { assert.equal(r.baroUnit, 'hPa'); assert.equal(r.metricAlt, false); assert.equal(r.metar, 'eu'); }
    // Summer time: the zone's name and the clock follow the date (no fixed offsets).
    const jul = Date.UTC(2026, 6, 1, 12), nov = Date.UTC(2026, 10, 21, 12);
    const Z = (la, lo) => zoneAt(...at(la, lo));
    assert.equal(zoneLabel(Z(51.5, -0.12), jul), 'BST'); assert.equal(zoneLabel(Z(51.5, -0.12), nov), 'GMT');
    assert.equal(fmtZone(jul, Z(51.5, -0.12)), '13:00'); assert.equal(fmtZone(nov, Z(51.5, -0.12)), '12:00');
    assert.equal(zoneLabel(Z(48.85, 2.35), jul), 'CEST'); assert.equal(zoneLabel(Z(48.85, 2.35), nov), 'CET');
    assert.equal(fmtZone(jul, Z(40.42, -3.7)), '14:00'); assert.equal(fmtZone(nov, Z(40.42, -3.7)), '13:00');
    assert.equal(zoneLabel(Z(38.72, -9.14), jul), 'WEST'); assert.equal(zoneLabel(Z(38.72, -9.14), nov), 'WET');
    assert.equal(zoneLabel(Z(53.35, -6.26), jul), 'IST');
    // The clocks change on the last Sundays of March and October, at 01:00 UTC.
    assert.equal(zoneLabel(Z(51.5, -0.12), Date.UTC(2026, 2, 29, 0, 59)), 'GMT'); assert.equal(zoneLabel(Z(51.5, -0.12), Date.UTC(2026, 2, 29, 1, 1)), 'BST');
    assert.equal(zoneLabel(Z(51.5, -0.12), Date.UTC(2026, 9, 25, 0, 59)), 'BST'); assert.equal(zoneLabel(Z(51.5, -0.12), Date.UTC(2026, 9, 25, 1, 1)), 'GMT');
    // Gibraltar keeps Central European time, not London's; Morocco is Africa/Casablanca.
    assert.equal(zoneOfIcao('LXGB').timeZone, 'Europe/Gibraltar'); assert.equal(zoneLabel(zoneOfIcao('LXGB'), jul), 'CEST');
    assert.equal(Z(35.77, -5.8).timeZone, 'Africa/Casablanca');
    assert.equal(zoneOfIcao('EGLL').timeZone, 'Europe/London'); assert.equal(zoneOfIcao('LEMD').timeZone, 'Europe/Madrid'); assert.equal(zoneOfIcao('EHAM').timeZone, 'Europe/Amsterdam');
    for (const i of ['EGLL', 'LFPG', 'EDDF', 'LEMD', 'LSZH', 'EHAM', 'LIRF', 'GMTT']) assert.equal(metarFormOf(i, {}), 'eu', i);
    // WMM2025 at 2026.0 everywhere (no plane, no mask): a little east at London, about 4 east at Rome and Munich, west at Lisbon.
    const mv = (la, lo) => magVar(la, lo);
    assert.ok(mv(51.47, -0.46) > 0 && mv(51.47, -0.46) < 2, `London ${mv(51.47, -0.46)}`);
    assert.ok(Math.abs(mv(41.8, 12.24) - 3.95) < 0.1, `Rome ${mv(41.8, 12.24)}`);
    assert.ok(Math.abs(mv(48.35, 11.79) - 4.33) < 0.1, `Munich ${mv(48.35, 11.79)}`);
    assert.ok(mv(38.77, -9.13) < 0 && mv(38.77, -9.13) > -3, `Lisbon ${mv(38.77, -9.13)}`);
  });

  test('the ground: the sea exactly 0, the polders below it and still land, the Alps, the 1 km level beyond batch A', { skip: !have }, async () => {
    const { hf } = await tiledTerrain({ layers: ['h', 'w'], airports: [], maxTiles: 60 });
    const ready = async (la, lo, r = 3000) => { const [x, y] = at(la, lo); await hf.tiles.whenReady(x, y, r, 'test'); return [x, y]; };
    const ground = terrainGround(hf);
    // Mid-Channel: the sea, at exactly 0, and the predicted path's ground says water from the height alone.
    let [x, y] = await ready(50.4, -0.5);
    assert.equal(hf.heightAt(x, y), 0); assert.equal(hf.waterAt(x, y), true); assert.equal(ground(x, y).kind, 'water');
    // Schiphol's polder (Haarlemmermeer): below the sea, not clamped, land for the sim and for the prediction.
    [x, y] = await ready(52.3086, 4.7639);
    const hs = hf.heightAt(x, y);
    assert.ok(hs < -1 && hs > -8, `Schiphol at ${hs} m`);
    assert.equal(hf.waterAt(x, y), false); assert.equal(ground(x, y).kind, 'ground');
    // The dunes west of Haarlem are above it, and the North Sea off them is 0.
    [x, y] = await ready(52.40, 4.55); assert.ok(hf.heightAt(x, y) > 1, `the dunes at ${hf.heightAt(x, y)} m`);
    [x, y] = await ready(52.45, 4.30); assert.equal(hf.heightAt(x, y), 0);
    // London's and Madrid's ground, and the Alps at Mont Blanc and the Jungfrau (250 m cells take the tops off).
    [x, y] = await ready(51.4706, -0.4619); assert.ok(hf.heightAt(x, y) > 10 && hf.heightAt(x, y) < 45, `Heathrow at ${hf.heightAt(x, y)} m`);
    [x, y] = await ready(40.4722, -3.5609); assert.ok(hf.heightAt(x, y) > 560 && hf.heightAt(x, y) < 660, `Madrid at ${hf.heightAt(x, y)} m`);
    [x, y] = await ready(45.8326, 6.8652); assert.ok(hf.heightAt(x, y) > 4000, `Mont Blanc at ${hf.heightAt(x, y)} m`);
    [x, y] = await ready(46.5368, 7.9626); assert.ok(hf.heightAt(x, y) > 3400, `the Jungfrau at ${hf.heightAt(x, y)} m`);
    // Beyond batch A the 1 km level: Vienna's basin, Lisbon's hills, and the sea is still exactly 0 there.
    [x, y] = await ready(48.21, 16.37, 2000); assert.ok(hf.heightAt(x, y) > 120 && hf.heightAt(x, y) < 300, `Vienna at ${hf.heightAt(x, y)} m`);
    [x, y] = await ready(57.0, 2.0, 2000); assert.equal(hf.heightAt(x, y), 0);                      // the North Sea
    // Past the outline (Tunis) there is no land in the data at all.
    [x, y] = await ready(36.8, 10.18, 2000); assert.equal(hf.heightAt(x, y), 0);
  });

  test("a predicted path ends at the outline's diagonal, inside the rectangle, with reason 'map'", { skip: !have }, async () => {
    const { predictSync } = await import('../src/sim/predict-core.js');
    const { airborne } = await import('./sim-helpers.mjs');
    const { insideRegion, insideBy, regionExtent } = await import('../src/world/outline.js');
    // From Calabria at FL350 heading south-east: the outline's edge from 36.3 N 16.0 E to 39.6 N 18.6 E lies ahead,
    // well inside the bounding rectangle's south-east corner.
    const [x, y] = at(38.6, 16.2);
    const sim = airborne({ massKg: 70000, fuelKg: 8000, altFt: 35000, iasKt: 250, hdg: 120 * Math.PI / 180, ap: { ap: true, athr: true, spdKt: 250, hdgDeg: 120, altFt: 35000 } });
    sim.controls.thrust = 25 / 45;
    const snap = sim.snapshot();
    snap.core.px += x; snap.core.py += y;
    const r = predictSync(snap, {}, null);
    const last = r.samples[r.samples.length - 1], e = regionExtent();
    assert.equal(r.reason, 'map');
    assert.ok(insideRegion(x, y) && !insideRegion(last.x, last.y), 'it starts inside and ends just outside');
    assert.ok(Math.abs(insideBy(last.x, last.y)) < 3000, `the last sample is ${insideBy(last.x, last.y).toFixed(0)} m from the outline`);
    assert.ok(last.x < e.x1 - 20000 && last.y > e.y0 + 20000, `still inside the rectangle: ${(e.x1 - last.x) / 1000 | 0} km from its east side, ${(last.y - e.y0) / 1000 | 0} km from its south`);
    assert.ok(Math.hypot(last.x - x, last.y - y) > 40000, 'it flew on to the edge');
  });
}
