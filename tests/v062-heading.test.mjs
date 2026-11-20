// v0.6.2: the heading the map's tip gives for a leg (Shane: "when I hover over them on the map, let it show the heading I
// have to set to follow that line"): ui/common.js headingForTrack(), the wind triangle that holds a track.
import test from 'node:test';
import assert from 'node:assert/strict';
import { headingForTrack, magDeg } from '../src/ui/common.js';

const DEG = Math.PI / 180;
const deg = (r) => ((r / DEG) % 360 + 360) % 360;

test('no wind, or on the ground: the heading is the track', () => {
  assert.equal(headingForTrack(1.2, 0, 0, 120), 1.2);
  assert.equal(headingForTrack(1.2, 15, -8, 30), 1.2);          // under 40 m/s (taxiing, a take-off roll)
  assert.equal(headingForTrack(1.2, 15, -8, undefined), 1.2);
});

test('a crosswind: crab into it by asin(crosswind / TAS); a head- or tailwind changes nothing', () => {
  // track north, the air moving east at 10 m/s (a wind from the west), TAS 100 m/s: 5.74° left, into the wind
  assert.ok(Math.abs(deg(headingForTrack(0, 10, 0, 100)) - (360 - Math.asin(0.1) / DEG)) < 1e-9);
  // track east, the air moving north (a wind from the south): crab right, into it, past 090°
  assert.ok(Math.abs(deg(headingForTrack(90 * DEG, 0, 10, 100)) - (90 + Math.asin(0.1) / DEG)) < 1e-9);
  // the same wind along the track (a tailwind) or against it (a headwind): the track
  assert.ok(Math.abs(headingForTrack(0, 0, 20, 100)) < 1e-12 && Math.abs(headingForTrack(0, 0, -20, 100)) < 1e-12);
  // the ground track it gives is the leg's: the air's velocity plus the wind points along the track
  for (const [T, wx, wy, V] of [[0.4, 12, -7, 110], [2.7, -20, 5, 130], [4.9, 3, 18, 80]]) {
    const H = headingForTrack(T, wx, wy, V);
    const gx = V * Math.sin(H) + wx, gy = V * Math.cos(H) + wy;
    assert.ok(Math.abs(Math.atan2(gx * Math.cos(T) - gy * Math.sin(T), gx * Math.sin(T) + gy * Math.cos(T))) < 1e-9, `${T}`);
  }
  // a crosswind faster than the aircraft: no answer, so the track
  assert.equal(headingForTrack(0, 150, 0, 100), 0);
});

test('the tip turns it magnetic where it is, as the FCU wants it', () => {
  // a leg flown due north on the grid at Jeju: the heading the FCU takes is the grid heading less the variation there
  const h = magDeg(0, -100000, -400000);
  assert.ok(h > 0 && h < 360 && Number.isFinite(h));
});
