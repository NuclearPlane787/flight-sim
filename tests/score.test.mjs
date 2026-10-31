// The landing score (src/score.js): which runway a touchdown was on, what each part costs
// and how the costs make the points, the approach, and the off-runway result.
//   node --test games/flight-sim/tests/score.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScorer, pickRunway, landingRunway, COST, approachStats, runwayFrame } from '../src/score.js';
import { GROUND_Z } from '../src/geometry.js';
import { verdict } from '../src/ui/score-panel.js';

const DEG = Math.PI / 180;
// Two made-up runways: 09/27 along +x (3000 m by 45 m), and 18/36 crossing it at x = 1000.
const end = (ident, x, y) => ({ ident, x, y, pavementEnd: [x, y] });
const r0927 = { widthM: 45, ends: [end('09', 0, 0), end('27', 3000, 0)] };
const r1836 = { widthM: 45, ends: [end('36', 1000, -1200), end('18', 1000, 1200)] };
const runways = [r0927, r1836];
const EAST = 90 * DEG, NORTH = 0;

test('the runway under a touchdown, and the end landed on', () => {
  assert.equal(pickRunway(runways, 500, 3, EAST).end.ident, '09');
  assert.equal(pickRunway(runways, 500, 3, -EAST).end.ident, '27');
  // at the crossing, the one lined up with the heading
  assert.equal(pickRunway(runways, 1000, 5, NORTH).end.ident, '36');
  assert.equal(pickRunway(runways, 1000, 5, EAST + 10 * DEG).end.ident, '09');
  // across a runway (60° off its line): not a landing on it
  assert.equal(pickRunway([r0927], 500, 0, 30 * DEG), null);
});

test('a little short or off the edge still counts; a parallel taxiway does not', () => {
  assert.equal(pickRunway(runways, -30, 0, EAST), null);           // short of the pavement
  assert.equal(landingRunway(runways, -30, 0, EAST).end.ident, '09');
  assert.equal(landingRunway(runways, 500, 40, EAST).end.ident, '09'); // a wheel off the edge
  assert.equal(landingRunway(runways, 500, 180, EAST), null);        // the parallel taxiway
  // an undershoot in line with the runway, up to 400 m short, on either end
  assert.equal(landingRunway(runways, -300, 5, EAST).end.ident, '09');
  assert.equal(landingRunway(runways, 3300, -5, -EAST).end.ident, '27');
  assert.equal(landingRunway(runways, -300, 100, EAST), null);       // short and well off to the side
  assert.equal(landingRunway(runways, -500, 0, EAST), null);         // too far short
  assert.equal(landingRunway(runways, 3300, 0, EAST), null);         // past the far end
});

// A final approach to 09 as the scorer's track: the fuselage centre's height above the
// threshold (m) against the distance before it (m), flown at gs m/s, sampled every 0.25 s.
const TAN3 = Math.tan(3 * DEG);
const onPath = (d) => (d + 300) * TAN3;  // the PFD's glideslope, from 300 m past the threshold
function approach(H, { gs = 70, from = 7000, to = 0, cross = () => 0 } = {}) {
  const out = [];
  for (let d = from, t = 0; d >= to; d -= gs * 0.25, t += 0.25) out.push({ t, x: -d, y: -cross(d), z: H(d), vs: 0, gs });
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)];
    out[i].vs = (b.z - a.z) / (b.t - a.t);
  }
  return out;
}
const smooth = (f, w) => (d) => { let s = 0, n = 0; for (let k = -w; k <= w; k += 5) { s += f(d + k); n++; } return s / n; };
// Shane's landing of 2026-10-31: "like 2m left of the centerline, 150m past the touchdown
// zone, with an approach that was ... questionable. My altitude was like 150 feet like a
// kilometer from the runway so I had to 'bob' in the air. The touchdown rate was 190
// feet/min though." Rebuilt: on the path to 3.1 km out, then down more steeply to 150 ft
// 1 km out, level until back on the path, then down it, smoothed over ±1.5 s.
const shanesFinal = approach(smooth((d) => (d >= 3100 ? onPath(d)
  : d >= 1000 ? onPath(3100) + ((45.7 - onPath(3100)) * (3100 - d)) / 2100
  : d >= 572 ? 45.7 : onPath(d)), 105));

// A landing on 09: the approach (fed frame by frame), the touchdown, then the rollout to a
// stop. The defaults are the ideal touchdown.
function land({ vs = 130, g = 1, along = 400, cross = 0, bank = 0, pitch = 5.5, runway = true, rolloutNz = 1, bounceG = null,
  surface = 'runway', track = null } = {}) {
  const sc = createScorer();
  for (const p of track || []) sc.update({ t: p.t, pos: { x: p.x, y: p.y, z: p.z }, vs: p.vs, gs: p.gs, onGround: false }, []);
  const s = { t: (track ? track[track.length - 1].t : 0) + 10, ias: 70, gs: 70, vs: 0, onGround: true, nz: 1, pos: { x: along, y: -cross, z: GROUND_Z } };
  if (runway) sc.setLanding(landingRunway(runways, along, -cross, EAST));
  else sc.setLanding(null);
  sc.update(s, [{ type: 'touchdown', vsMs: -vs / 196.85, g, x: along, y: -cross, bank: bank * DEG, pitch: pitch * DEG, surface }]);
  if (bounceG) {
    s.t += 1; s.onGround = false; sc.update(s, []);
    s.t += 1; s.onGround = true; sc.update(s, [{ type: 'bounce' }, { type: 'touchdown', vsMs: -3, g: bounceG, x: along + 100, y: 0, bank: 0, pitch: 0.05 }]);
  }
  let res = null;
  for (let i = 0; i < 40 && !res; i++) {
    s.t += 1; s.gs = Math.max(0, s.gs - 5); s.nz = rolloutNz;
    res = sc.update(s, []);
  }
  return res;
}
const part = (res, name) => res.parts.find((p) => p.name === name);

test('only a perfect landing reaches 100; small misses already cost', () => {
  const perfect = land({ track: approach(onPath) });
  assert.equal(perfect.points, 100);
  assert.equal(perfect.grade, 'A');
  assert.equal(perfect.cost, 0);
  // Very good everywhere still isn't 100: 160 ft/min, 1.15 g, 30 m long, 0.5 m off, 0.5° bank.
  const good = land({ vs: 160, g: 1.15, along: 430, cross: 0.5, bank: 0.5, pitch: 5, track: approach(onPath) });
  assert.ok(good.points >= 97 && good.points <= 99, `${good.points}`);
  // Each part's cost grows away from its ideal, on both sides.
  const rising = (f, xs) => xs.every((x, i) => i === 0 || f(x) > f(xs[i - 1]));
  assert.ok(rising(COST.vs, [130, 150, 250, 400, 600, 900]));
  assert.ok(COST.vs(100) > 0 && COST.vs(60) > COST.vs(100) && COST.vs(0) > COST.vs(60));
  assert.ok(rising((x) => COST.aim(400 + x, 400), [0, 50, 150, 300, 600, 1200]));
  assert.ok(rising((x) => COST.aim(400 - x, 400), [0, 50, 150, 300, 450]));
  assert.ok(rising(COST.centreline, [0, 0.5, 2, 5, 15, 30]) && COST.centreline(-3) === COST.centreline(3));
  assert.ok(rising(COST.bank, [0, 0.5, 2, 5, 10]));
  assert.ok(rising(COST.g, [1, 1.2, 1.6, 2.2, 3]));
  assert.ok(rising(COST.path, [0, 0.2, 1, 3]) && rising(COST.swing, [0, 50, 300, 900]));
  assert.ok(COST.pitch(5.5) === 0 && COST.pitch(4) > 0 && COST.pitch(1) > COST.pitch(4) && COST.pitch(9.5) > COST.pitch(8));
});

test("Shane's landing (190 ft/min, 2 m left, 150 m long, low at 1 km and a bob) scores 80", () => {
  const ap = approachStats(shanesFinal, runwayFrame(r0927.ends[0], r0927.ends[1]), 0);
  assert.equal(ap.note, 'low');
  assert.ok(ap.pathDots > 0.6 && ap.pathDots < 1.1, `${ap.pathDots}`);
  assert.ok(ap.swingFpm > 150 && ap.swingFpm < 260, `${ap.swingFpm}`);
  const res = land({ vs: 190, g: 1.3, along: 550, cross: -2, bank: 0.5, pitch: 6, track: shanesFinal });
  assert.equal(res.points, 80);
  assert.equal(res.grade, 'B');
  assert.equal(part(res, 'Approach path').note, 'low');
  assert.match(verdict(res), /^Off the path on final \(low\)/);
  // The same touchdown after a clean approach is an A.
  const clean = land({ vs: 190, g: 1.3, along: 550, cross: -2, bank: 0.5, pitch: 6, track: approach(onPath) });
  assert.ok(clean.points >= 90 && clean.points <= 92, `${clean.points}`);
  assert.equal(verdict(clean), 'Smooth. The cabin barely noticed.');
});

test('the parts lost add up to the points lost', () => {
  for (const res of [land({ vs: 190, g: 1.3, along: 550, cross: -2, bank: 0.5, pitch: 6, track: shanesFinal }),
    land({ vs: 740, g: 2.5, along: 900, cross: 6 }), land({ vs: 300, along: 250, cross: 1, bank: 2 }), land({ runway: false })]) {
    assert.equal(res.parts.reduce((a, p) => a + p.penalty, 0), 100 - res.points, JSON.stringify(res.parts));
    assert.ok(res.parts.every((p) => Number.isInteger(p.penalty) && p.penalty >= 0));
  }
});

test('one poor part on its own leaves 20 or more; 0 takes everything bad at once', () => {
  // A firm, long landing is poor but well above 0.
  const firm = land({ vs: 740, g: 2.5, along: 900, cross: 6 });
  assert.equal(firm.grade, 'F');
  assert.ok(firm.points > 10 && firm.points < 30, `${firm.points}`);
  // The worst of any single part, the rest perfect.
  for (const [what, opts] of [['900 ft/min', { vs: 900 }], ['2.6 g', { g: 2.6 }], ['1,000 m long', { along: 1400 }],
    ['20 m off', { cross: 20 }], ['7° bank', { bank: 7 }], ['9.5° pitch', { pitch: 9.5 }], ['3 dots off all the way', { track: approach((d) => (d + 300) * Math.tan(1.8 * DEG)) }]]) {
    const r = land(opts);
    assert.ok(r.points >= 20, `${what}: ${r.points}`);
  }
  // Everything at once: hard, long, off the side, banked, nose high, two bounces, after an
  // approach swinging ±1,200 ft/min.
  const all = land({ vs: 880, g: 2.6, along: 1300, cross: 15, bank: 6, pitch: 9, bounceG: 2.6,
    track: approach((d) => onPath(d) + 30 * Math.sin((d / 2100) * 2 * Math.PI)) });
  assert.ok(all.points <= 2, `${all.points}`);
});

test('the rollout does not count towards peak g; a bounce does', () => {
  assert.equal(part(land({ g: 1.8, rolloutNz: 3.5 }), 'Peak g').value, 1.8);
  const b = land({ g: 1.8, bounceG: 2.6 });
  assert.equal(part(b, 'Peak g').value, 2.6);
  assert.equal(part(b, 'Bounces').value, 1);
  assert.equal(part(b, 'Bounces').cost, 0.2);
});

test('main wheels on the grass: short of the threshold, or off the side', () => {
  const short = land({ along: -120, surface: 'ground' });
  assert.equal(short.runway, '09');
  assert.equal(part(short, 'On the grass').cost, COST.grass);
  assert.ok(part(short, 'Touchdown vs aiming point').cost > COST.aim(0, 400)); // short of the threshold costs more
  assert.equal(short.grade, 'F');
  assert.ok(short.points > 20, `${short.points}`);
  assert.match(verdict(short), /^Short of the threshold/);
  const side = land({ along: 450, cross: 25, surface: 'ground' });
  assert.equal(part(side, 'On the grass').cost, COST.grass);
  assert.equal(verdict(side), 'Off the side, onto the grass.');
  assert.equal(part(land({}), 'On the grass'), undefined);
});

test('a touchdown off the runway scores low, not 0, and says so', () => {
  const res = land({ runway: false });
  assert.equal(res.points, 10);
  assert.equal(res.grade, 'F');
  assert.ok(res.offRunway);
  assert.equal(res.runway, null);
  assert.equal(part(res, 'On a runway').value, 'no');
  assert.ok(!part(res, 'From centreline') && !part(res, 'Approach path'));
  assert.equal(verdict(res), "That wasn't a runway.");
  assert.equal(verdict({ points: 10, grade: 'F', parts: res.parts }), "That wasn't a runway."); // from the logbook
});

test('the approach: glideslope and localizer dots, sink rate swings, and what counts', () => {
  const rf = runwayFrame(r0927.ends[0], r0927.ends[1]);
  const on = approachStats(approach(onPath), rf, 0);
  assert.ok(on.pathDots < 0.05 && on.swingFpm < 5 && on.note === '', JSON.stringify(on));
  // A steady 2.5° approach: 1.25 dots low the whole way, but no swings.
  const shallow = approachStats(approach((d) => (d + 300) * Math.tan(2.5 * DEG)), rf, 0);
  assert.equal(shallow.note, 'low');
  assert.ok(shallow.pathDots > 1.1 && shallow.pathDots < 1.4 && shallow.swingFpm < 5, JSON.stringify(shallow));
  // High, and off to the right.
  assert.equal(approachStats(approach((d) => (d + 300) * Math.tan(3.6 * DEG)), rf, 0).note, 'high');
  assert.equal(approachStats(approach(onPath, { cross: () => 120 }), rf, 0).note, 'right');
  // A base leg (more than 10° off the runway's line) doesn't count, nor a final joined below 300 ft.
  assert.equal(approachStats(approach(onPath, { cross: (d) => d * 0.5 }), rf, 0), null);
  assert.equal(approachStats(approach(onPath, { from: 1500 }), rf, 0), null);
  // The elevation counts: the same approach to a runway 500 m up.
  const high = approach((d) => 500 + onPath(d));
  assert.ok(approachStats(high, rf, 500).pathDots < 0.05);
});

test('the track: a rewind takes it back, a lift-off or a go-around starts it afresh', () => {
  const sc = createScorer();
  const s = (t, z = 300) => ({ t, pos: { x: -6000 + t * 70, y: 0, z }, vs: -3.7, gs: 70, onGround: false });
  for (let t = 0; t <= 100; t += 1 / 60) sc.update(s(t), []);
  const n = sc.track.length;
  assert.ok(n >= 370 && n <= 401, `${n}`);  // every 0.25 s or so
  sc.update(s(50), []);                       // rewound to t = 50
  assert.ok(sc.track.every((p) => p.t <= 50) && sc.track.length > n / 2 - 5);
  sc.reset(true);                             // the rewind keeps what was flown before it
  assert.ok(sc.track.length > 0);
  sc.update(s(51), [{ type: 'liftoff' }]);
  assert.ok(sc.track.length <= 1);
  sc.reset();
  assert.equal(sc.track.length, 0);
});
