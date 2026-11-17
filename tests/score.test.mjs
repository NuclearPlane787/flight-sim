// The landing score (src/score.js): which runway a touchdown was on, what each part costs,
// v0.5.4: each part's score out of 10, the approach; v0.5.5: each part's points out of its share of
// the 100 (the rows add up), what comes off after them (the worst part's cap, the grass, half off a
// runway, half for a would-be crash), and the bounces counted from the wheels.
//   node --test games/flight-sim/tests/score.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScorer, pickRunway, landingRunway, COST, RATE, CAP, WORST_CAP, scoreFor, approachStats, runwayFrame,
  shareOut, rowPoints, bounceTracker, BOUNCE } from '../src/score.js';
import { GROUND_Z } from '../src/geometry.js';
import { verdict, partsHtml } from '../src/ui/score-panel.js';
import { TYPES } from '../src/sim/types.js';
import { createSim } from '../src/sim/sim.js';
import { run, approachPilot, KT, FT } from './sim-helpers.mjs';

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
  surface = 'runway', track = null, damage = null, type = null } = {}) {
  const sc = createScorer();
  if (type) sc.setType(type);
  for (const p of track || []) sc.update({ t: p.t, pos: { x: p.x, y: p.y, z: p.z }, vs: p.vs, gs: p.gs, onGround: false }, []);
  const s = { t: (track ? track[track.length - 1].t : 0) + 10, ias: 70, gs: 70, vs: 0, onGround: true, nz: 1, pos: { x: along, y: -cross, z: GROUND_Z } };
  if (runway) sc.setLanding(landingRunway(runways, along, -cross, EAST));
  else sc.setLanding(null);
  sc.update(s, [...(damage ? [{ type: 'damage', reason: damage }] : []),
    { type: 'touchdown', vsMs: -vs / 196.85, g, x: along, y: -cross, bank: bank * DEG, pitch: pitch * DEG, surface }]);
  if (bounceG) {
    // v0.5.5: a second off the ground, half a metre up (the scorer counts the hop from the wheels and the height)
    s.t += 1; s.onGround = false; s.pos.z = GROUND_Z + 0.5; sc.update(s, []);
    s.t += 1; s.onGround = true; s.pos.z = GROUND_Z; sc.update(s, [{ type: 'bounce' }, { type: 'touchdown', vsMs: -3, g: bounceG, x: along + 100, y: 0, bank: 0, pitch: 0.05 }]);
  }
  let res = null;
  for (let i = 0; i < 40 && !res; i++) {
    s.t += 1; s.gs = Math.max(0, s.gs - 5); s.nz = rolloutNz;
    res = sc.update(s, []);
  }
  return res;
}
const part = (res, name) => res.parts.find((p) => p.name === name);

const scores = (res) => Object.fromEntries(res.parts.map((p) => [p.name, p.score]));

// v0.5.4: each part scores round(10 × e^(−cost / k)) out of 10; good values give 9–10, bad ones 0–3.
test('each part scores out of 10: good values 9–10, bad ones 0–3', () => {
  const rate = (key, cost) => scoreFor(cost, RATE[key][0]);
  for (const [key, good, bad] of [
    ['vs', [COST.vs(130), COST.vs(190), COST.vs(250), COST.vs(60)], [COST.vs(600), COST.vs(900)]],
    ['g', [COST.g(1), COST.g(1.15), COST.g(1.3)], [COST.g(2.0), COST.g(2.6)]],
    ['aim', [COST.aim(400, 400), COST.aim(450, 400), COST.aim(350, 400), COST.aim(500, 400)], [COST.aim(700, 400), COST.aim(1400, 400), COST.aim(80, 400), COST.aim(-120, 400)]],
    ['centreline', [COST.centreline(0), COST.centreline(1), COST.centreline(-1.5)], [COST.centreline(6), COST.centreline(15)]],
    ['bank', [COST.bank(0), COST.bank(1), COST.bank(2)], [COST.bank(7), COST.bank(10)]],
    ['pitch', [COST.pitch(5.5), COST.pitch(4), COST.pitch(7.5)], [COST.pitch(1), COST.pitch(9.5)]],
    ['bounces', [COST.bounces(0)], [COST.bounces(2), COST.bounces(3)]],
    ['path', [COST.path(0), COST.path(0.25)], [COST.path(1.4), COST.path(2), COST.path(3)]],
    ['swing', [COST.swing(0), COST.swing(50), COST.swing(100)], [COST.swing(300), COST.swing(600)]],
  ]) {
    for (const c of good) assert.ok(rate(key, c) >= 9, `${key} good ${c}: ${rate(key, c)}`);
    for (const c of bad) assert.ok(rate(key, c) <= 3, `${key} bad ${c}: ${rate(key, c)}`);
  }
  assert.equal(rate('grass', COST.grass), 0);
  // Scores fall as costs grow, from 10 at 0.
  for (const key of Object.keys(RATE)) assert.equal(scoreFor(0, RATE[key][0]), 10);
  // The heaviest: vertical speed, the touchdown point and the centreline.
  const w = (k) => RATE[k][1];
  for (const k of ['g', 'bank', 'pitch', 'bounces', 'path', 'swing']) assert.ok(w(k) < w('vs') && w(k) < w('aim') && w(k) < w('centreline'), k);
});

test('only 10/10 in every part makes 100; one 9/10 already costs', () => {
  const perfect = land({ track: approach(onPath) });
  assert.equal(perfect.points, 100);
  assert.equal(perfect.grade, 'A');
  assert.equal(perfect.cost, 0);
  assert.ok(perfect.parts.every((p) => p.score === 10), JSON.stringify(scores(perfect)));
  // Very good everywhere is 10/10 everywhere: 160 ft/min, 1.15 g, 30 m long, 0.5 m off, 0.5° bank.
  const good = land({ vs: 160, g: 1.15, along: 430, cross: 0.5, bank: 0.5, pitch: 5, track: approach(onPath) });
  assert.equal(good.points, 100, JSON.stringify(scores(good)));
  // 250 ft/min, the rest perfect: vertical speed 9/10, and 98.
  const firmish = land({ vs: 250, track: approach(onPath) });
  assert.equal(part(firmish, 'Vertical speed').score, 9);
  assert.equal(firmish.points, 98);
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
  // (v0.1.3 to v0.5.4: exactly 80; v0.5.5's whole points per part make it 81)
  assert.ok(res.points >= 79 && res.points <= 82, `${res.points} ${JSON.stringify(scores(res))} ${ap.pathDots} ${ap.swingFpm}`);
  assert.equal(res.grade, 'B');
  assert.deepEqual(scores(res), { 'Vertical speed': 10, 'Peak g': 9, 'Touchdown vs aiming point': 7, 'From centreline': 8,
    Bank: 10, Pitch: 10, Bounces: 0 === 0 ? 10 : 0, 'Approach path': part(res, 'Approach path').score, 'Sink rate swings': part(res, 'Sink rate swings').score });
  assert.ok(part(res, 'Approach path').score <= 5 && part(res, 'Sink rate swings').score <= 6, JSON.stringify(scores(res)));
  assert.equal(part(res, 'Approach path').note, 'low');
  assert.match(verdict(res), /^Off the path on final \(low\)/);
  // The same touchdown after a steady approach is an A, about 90.
  const clean = land({ vs: 190, g: 1.3, along: 550, cross: -2, bank: 0.5, pitch: 6, track: approach(onPath) });
  assert.ok(clean.points >= 90 && clean.points <= 92, `${clean.points} ${JSON.stringify(scores(clean))}`);
  assert.equal(clean.grade, 'A');
  assert.equal(verdict(clean), 'Smooth. The cabin barely noticed.');
});

test('the parts lost add up to the points lost', () => {
  for (const res of [land({ vs: 190, g: 1.3, along: 550, cross: -2, bank: 0.5, pitch: 6, track: shanesFinal }),
    land({ vs: 740, g: 2.5, along: 900, cross: 6 }), land({ vs: 300, along: 250, cross: 1, bank: 2 }), land({ runway: false }),
    land({ along: -120, surface: 'ground' }), land({ damage: 'hard landing: gear collapsed' })]) {
    assert.equal(res.parts.reduce((a, p) => a + p.penalty, 0), 100 - res.points, JSON.stringify(res.parts));
    assert.ok(res.parts.every((p) => Number.isInteger(p.penalty) && p.penalty >= 0));
    // v0.5.5: the parts' shares add up to 100, their points to the total before what comes off, which is a row each
    const cats = res.parts.filter((p) => p.kind !== 'penalty'), pens = res.parts.filter((p) => p.kind === 'penalty');
    assert.ok(cats.every((p) => Number.isInteger(p.score) && p.score >= 0 && p.score <= 10));
    assert.equal(cats.reduce((a, p) => a + p.share, 0), 100);
    assert.ok(cats.every((p) => p.points === rowPoints(p.score, p.share) && p.penalty === p.share - p.points));
    assert.equal(cats.reduce((a, p) => a + p.points, 0) - pens.reduce((a, p) => a + p.minus, 0), res.points);
    assert.ok(pens.every((p) => p.penalty === p.minus && !Number.isFinite(p.score)));
  }
});

test('several middling flaws make a C or a D; one bad part alone holds the total down (WORST_CAP); 0 takes everything bad', () => {
  // 350 ft/min, 1.5 g, 250 m long, 4 m off, 2° bank, after an approach a dot low and bobbing ±250 ft/min.
  const middling = land({ vs: 350, g: 1.5, along: 650, cross: 4, bank: 2, pitch: 4,
    track: approach((d) => (d + 300) * Math.tan(2.6 * DEG) + 8 * Math.sin((d / 1500) * 2 * Math.PI)) });
  assert.ok(['C', 'D'].includes(middling.grade), `${middling.points} ${JSON.stringify(scores(middling))}`);
  // A firm, long landing: poor, but well above 0.
  const firm = land({ vs: 740, g: 2.5, along: 900, cross: 6 });
  assert.ok(firm.points >= 30 && firm.points < 64, `${firm.points} ${JSON.stringify(scores(firm))}`);
  // The worst of any single part, the rest perfect.
  for (const [what, opts] of [['900 ft/min', { vs: 900 }], ['2.6 g', { g: 2.6 }], ['1,000 m long', { along: 1400 }],
    ['20 m off', { cross: 20 }], ['7° bank', { bank: 7 }], ['9.5° pitch', { pitch: 9.5 }], ['3 dots off all the way', { track: approach((d) => (d + 300) * Math.tan(1.8 * DEG)) }]]) {
    const r = land(opts);
    // v0.5.4 (review): the rest perfect averages high, but the worst part caps it: 50 + 10 × its score.
    const w = Math.min(...r.parts.filter((p) => p.weight > 0).map((p) => p.score));
    assert.ok(r.points >= 50 && r.points <= WORST_CAP(w), `${what}: ${r.points} (worst ${w}/10)`);
    console.log(`# ${what}: ${r.points} ${r.grade} (worst ${w}/10)`);
    assert.doesNotMatch(verdict(r), /^(Butter|Smooth)/, `${what}: ${verdict(r)}`); // and it's named
  }
  // Everything at once: hard, long, off the side, banked, nose high, two bounces, after an
  // approach swinging ±1,200 ft/min.
  const all = land({ vs: 880, g: 2.6, along: 1300, cross: 15, bank: 6, pitch: 9, bounceG: 2.6,
    track: approach((d) => onPath(d) + 30 * Math.sin((d / 2100) * 2 * Math.PI)) });
  assert.ok(all.points <= 15, `${all.points} ${JSON.stringify(scores(all))}`);
});

test('the rollout does not count towards peak g; a bounce does', () => {
  assert.equal(part(land({ g: 1.8, rolloutNz: 3.5 }), 'Peak g').value, 1.8);
  const b = land({ g: 1.8, bounceG: 2.6 });
  assert.equal(part(b, 'Peak g').value, 2.6);
  assert.equal(part(b, 'Bounces').value, 1);
  assert.equal(part(b, 'Bounces').cost, 0.2);
  assert.equal(part(b, 'Bounces').score, 5);
});

test('main wheels on the grass: short of the threshold, or off the side', () => {
  const short = land({ along: -120, surface: 'ground' });
  assert.equal(short.runway, '09');
  assert.equal(part(short, 'On the grass').cost, COST.grass);
  assert.ok(part(short, 'Touchdown vs aiming point').cost > COST.aim(0, 400)); // short of the threshold costs more
  assert.equal(short.grade, 'F');
  assert.equal(part(short, 'On the grass').kind, 'penalty');   // v0.5.5: a row of what came off, not a part
  assert.equal(part(short, 'On the grass').rule, '49 at most');
  assert.ok(short.points > 20 && short.points <= CAP.grass, `${short.points}`);
  assert.match(verdict(short), /^Short of the threshold/);
  const side = land({ along: 450, cross: 25, surface: 'ground' });
  assert.equal(part(side, 'On the grass').cost, COST.grass);
  assert.equal(verdict(side), 'Off the side, onto the grass.');
  assert.ok(side.points <= CAP.grass && side.grade === 'F', `${side.points}`);
  assert.equal(part(land({}), 'On the grass'), undefined);
});

test('a touchdown off the runway: half off, and says so', () => {
  // v0.5.5: half (v0.5.4: 10 at most). Perfect in every part it can be scored on (no aiming point or
  // centreline off a runway): 100, halved.
  const res = land({ runway: false });
  assert.equal(res.points, 50);
  assert.equal(part(res, 'On a runway').rule, 'half');
  assert.equal(part(res, 'On a runway').minus, 50);
  const firm = land({ runway: false, vs: 600, g: 1.8 });
  assert.ok(firm.points < 50 && firm.grade === 'F', `${firm.points}`);
  assert.ok(res.offRunway);
  assert.equal(res.runway, null);
  assert.equal(part(res, 'On a runway').value, 'no');
  assert.ok(!part(res, 'From centreline') && !part(res, 'Approach path'));
  assert.equal(verdict(res), "That wasn't a runway.");
  assert.equal(verdict({ points: 50, grade: 'D', parts: res.parts }), "That wasn't a runway."); // from the logbook
});

test('a would-be crash (Indestructible) is halved, and says so', () => {
  // v0.5.5 (Shane: "cut the score in half when a crash would have happened"; v0.5.4 capped it at 10).
  const res = land({ track: approach(onPath), damage: 'hard landing: gear collapsed' });
  assert.equal(res.points, 50);
  assert.equal(part(res, 'Would have crashed').value, 'gear collapsed');
  assert.equal(part(res, 'Would have crashed').kind, 'penalty');
  assert.equal(part(res, 'Would have crashed').rule, 'half');
  assert.equal(part(res, 'Would have crashed').minus, 50);
  assert.match(verdict(res), /^Without Indestructible, that was a crash/);
  // Off a runway as well: half, then half again.
  assert.equal(land({ runway: false, damage: 'hard landing: gear collapsed' }).points, 25);
});

// v0.5.5: Shane's card of 2026-11-17 (a 777, Indestructible, started on a short final, so no approach parts): 587
// ft/min, 2.33 g, 982 m past the aiming point, 8.4 m off, 0.4° of bank, 0.2° of pitch, no bounce counted, and the nose
// gear would have gone. v0.5.4 gave it 10 (its parts' scores out of 10 summed to 29 of 80). Now its rows add up to
// about 30, halved for the would-be crash: about 15.
test("Shane's would-be crash of 2026-11-17: its rows add up to about 30, then half", () => {
  const res = land({ vs: 587, g: 2.33, along: 400 + 982, cross: 8.4, bank: 0.4, pitch: 0.2, damage: 'nose gear collapsed', type: TYPES['b777-300er'] });
  assert.deepEqual(scores(res), { 'Vertical speed': 3, 'Peak g': 1, 'Touchdown vs aiming point': 0, 'From centreline': 1,
    Bank: 10, Pitch: 4, Bounces: 10, 'Would have crashed': undefined });
  const cats = res.parts.filter((p) => p.kind !== 'penalty');
  assert.equal(cats.reduce((a, p) => a + p.share, 0), 100);
  const sum = cats.reduce((a, p) => a + p.points, 0);
  assert.ok(sum >= 27 && sum <= 33, `${sum} ${JSON.stringify(cats.map((p) => `${p.points}/${p.share}`))}`);
  assert.equal(res.points, Math.floor(sum / 2));
  assert.ok(res.points >= 13 && res.points <= 16 && res.grade === 'F', `${res.points}`);
  assert.equal(part(res, 'Would have crashed').minus, sum - res.points);
  assert.match(verdict(res), /^Without Indestructible, that was a crash \(nose gear/);
  // the card: each part "points/share", the would-be crash's row "half" and what it took
  const html = partsHtml(res.parts);
  assert.match(html, />7\/22</);
  assert.match(html, /class="rule">half<\/span><span class="p"[^>]*>−\d+</);
});

test('the shares: whole points adding up to 100 by weight; 100 only with 10/10 everywhere', () => {
  const ps = (ws, sc = 10) => shareOut(ws.map((w) => ({ weight: w, score: sc })));
  for (const ws of [[3, 1.5, 3, 3, 1, 1, 1.5, 2, 1.5], [3, 1.5, 3, 3, 1, 1, 1.5], [3, 1.5, 1, 1, 1.5]]) {
    const parts = ps(ws);
    assert.equal(parts.reduce((a, p) => a + p.share, 0), 100, JSON.stringify(parts));
    assert.ok(parts.every((p) => p.points === p.share));
  }
  // every share loses a point at 9/10, however small
  for (let share = 1; share <= 30; share++) assert.ok(rowPoints(9, share) < share && rowPoints(9, share) >= 0, `${share}`);
  assert.equal(rowPoints(10, 17), 17);
  assert.equal(rowPoints(0, 17), 0);
  assert.equal(rowPoints(5, 17), 9);   // 8.5, rounded
});

// v0.5.5: the bounces, from the wheels and the height (Shane: "I did bounce once very clearly in that landing but the
// report showed 0 bounces"). A state stream at 100 Hz: s(t, { nose, mains, z }).
function wheels(script) {
  const bt = bounceTracker();
  const st = (t, o) => ({ t, onGround: !!(o.nose || o.mains || o.skid), scraping: !!o.skid, wow: { nose: !!o.nose, left: !!o.mains, right: !!o.mains }, pos: { z: o.z ?? 0 } });
  let t = 0;
  for (const [secs, o] of script) for (const end = t + secs; t < end - 1e-9; t += 0.01) bt.update(st(t, typeof o === 'function' ? o(t) : o));
  return bt.count;
}
const AIR = (z = 30) => ({ z });
test('bounces: a short hop, a hop with the nose wheel on, not the rollout, not a nose wheel touching first', () => {
  // half a minute in the air, then the main wheels down and the rollout
  const air = [[30, AIR(30)]];
  assert.equal(wheels([...air, [20, { mains: true, nose: true }]]), 0);
  // a hop of 0.3 s, 0.25 m up: the sim's own event needed half a second with no wheel on the ground
  assert.equal(wheels([...air, [1, { mains: true }], [0.3, (t) => ({ z: 0.25 })], [20, { mains: true, nose: true }]]), 1);
  // the main wheels lifting 0.4 s, 0.2 m, with the nose wheel still on (a flat, nose-down arrival)
  assert.equal(wheels([...air, [0.5, { mains: true }], [0.5, { mains: true, nose: true }], [0.4, { nose: true, z: 0.2 }], [20, { mains: true, nose: true }]]), 1);
  // two hops: two bounces
  assert.equal(wheels([...air, [0.5, { mains: true }], [0.6, { z: 0.5 }], [0.5, { mains: true }], [0.4, { z: 0.2 }], [20, { mains: true, nose: true }]]), 2);
  // the rollout's bumps: a wheel off for a frame or two, a few millimetres
  assert.equal(wheels([...air, [3, { mains: true, nose: true }], ...Array.from({ length: 10 }, () => [[0.02, { nose: true, z: 0.004 }], [1, { mains: true, nose: true }]]).flat(), [5, { mains: true, nose: true }]]), 0);
  // a hop 12 s after the wheels came down is the rollout's
  assert.equal(wheels([...air, [12, { mains: true, nose: true }], [0.5, { nose: true, z: 0.3 }], [5, { mains: true, nose: true }]]), 0);
  // the nose wheel first, still coming down (the main wheels 0.8 m up and sinking), then the main wheels: no bounce
  assert.equal(wheels([...air, [0.3, { nose: true, z: 0 }], [0.3, (t) => ({ z: -0.3 })], [20, { mains: true, nose: true }]]), 0);
  // a lift-off and a go-around aren't bounces: in the air for 30 s again, then down
  assert.equal(wheels([...air, [2, { mains: true }], [30, AIR(30)], [20, { mains: true, nose: true }]]), 0);
});

test('bounces with the real sim: a 777 bounced (Indestructible) counts once, as the sim saw it', () => {
  // 170 kt, flaps for landing, 560 ft/min with the stick pushed from 20 ft: the nose gear goes first, then a bounce of
  // about 1.6 s on the main wheels (the sim's own event sees it too: not counted twice)
  const sim = createSim({ type: 'b777-300er' });
  const D = sim.type.data, mass = 240000, fuel = 25000;
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 60 * FT + sim.type.geo.GROUND_Z, iasMs: 170 * KT, flapLever: 4, gearDown: true, fuelKg: fuel, payloadKg: mass - D.OEW - fuel });
  sim.setIndestructible(true);
  const sc = createScorer(); sc.setType(sim.type);
  const s = sim.state;
  let down = false, simBounces = 0;
  run(sim, 30, () => {
    if (!down) { approachPilot(sim, { vs: -560, flareFt: 0, tdFpm: -560 }); if (s.agl < 20 * FT) sim.controls.pitch = -0.6; sim.controls.thrust = s.agl < 20 * FT ? 0 : 0.35; }
    else { sim.controls.pitch = 0; sim.controls.thrust = 0; }
    const ev = sim.events.splice(0);
    for (const e of ev) { if (e.type === 'touchdown') down = true; if (e.type === 'bounce') simBounces++; }
    sc.update(s, ev);
  });
  assert.equal(simBounces, 1);
  assert.equal(sc.serialize().bounces, 1);
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
