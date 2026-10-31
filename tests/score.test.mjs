// The landing score (src/score.js): which runway a touchdown was on, the penalties and
// their ceilings, and the off-runway result.
//   node --test games/flight-sim/tests/score.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScorer, pickRunway, landingRunway, PENALTY } from '../src/score.js';
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
});

// A landing on 09: touchdown event, then the rollout to a stop.
function land({ vs = 360, g = 1.9, along = 400, cross = 0, bank = 0, pitch = 4, runway = true, rolloutNz = 1, bounceG = null } = {}) {
  const sc = createScorer();
  const s = { t: 100, ias: 70, gs: 70, onGround: true, nz: 1 };
  if (runway) sc.setLanding(landingRunway(runways, along, cross, EAST));
  else sc.setLanding(null);
  sc.update(s, [{ type: 'touchdown', vsMs: -vs / 196.85, g, x: along, y: -cross, bank: bank * DEG, pitch: pitch * DEG }]);
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
const pen = (res, name) => res.parts.find((p) => p.name === name)?.penalty;

test('a normal landing grades well; a perfect one is 100', () => {
  const ok = land({ vs: 361, g: 2.04, along: 476, cross: 1.3, pitch: 3.7 });
  assert.equal(ok.grade, 'B');
  assert.ok(ok.points >= 85 && ok.points <= 90, `${ok.points}`);
  assert.equal(ok.runway, '09');
  assert.equal(land({ vs: 180, g: 1.3, along: 420, cross: 0.4 }).points, 100);
});

test('every part has a ceiling: a firm, long landing is poor but not zero', () => {
  const res = land({ vs: 740, g: 2.5, along: 900, cross: 6 });
  assert.equal(res.grade, 'F');
  assert.ok(res.points > 20, `${res.points}`);
  assert.equal(PENALTY.centreline(40), 20);
  assert.equal(PENALTY.vs(2000), 50);
  assert.equal(PENALTY.g(4), 15);
  assert.equal(PENALTY.aim(-200, 400), 35);
  assert.equal(PENALTY.bank(30), 15);
  assert.equal(PENALTY.bounces(5), 25);
});

test('the rollout does not count towards peak g; a bounce does', () => {
  assert.equal(pen(land({ g: 1.8, rolloutNz: 3.5 }), 'Peak g'), 0);
  const b = land({ g: 1.8, bounceG: 2.6 });
  assert.equal(b.parts.find((p) => p.name === 'Peak g').value, 2.6);
  assert.equal(pen(b, 'Bounces'), 10);
});

test('a touchdown off the runway scores 0 and says so', () => {
  const res = land({ runway: false });
  assert.equal(res.points, 0);
  assert.equal(res.grade, 'F');
  assert.ok(res.offRunway);
  assert.equal(res.runway, null);
  assert.equal(res.parts.find((p) => p.name === 'On a runway').value, 'no');
  assert.ok(!res.parts.some((p) => p.name === 'From centreline'));
  assert.equal(verdict(res), "That wasn't a runway.");
  assert.equal(verdict({ points: 0, grade: 'F', parts: res.parts }), "That wasn't a runway."); // from the logbook
});
