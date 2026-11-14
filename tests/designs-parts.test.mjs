// v0.5.2: a design's parts (src/sim/designs.js): attaching with and without a mirror twin, the twin following its
// part, the limits, the mounts' places; what the parts bring to the data (each engine's own numbers when they're
// mixed, the thrust lines, the drag areas, the tanks' fuel and the ballast's mass) and what the sim does with them
// (each part's drag at its place, a turned thrust line's moments, mixed engines' thrust).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import {
  newDesign, designDef, normalizeDesign, addPart, updatePart, removePart, setMirror, engineParts, mountRange,
  placeEngine, placeTank, airframe, MAX_ENGINES, MAX_PARTS, RANGES,
} from '../src/sim/designs.js';
import { ENGINE_TYPES } from '../src/sim/engine-types.js';
import { typeById } from '../src/sim/types.js';

const KT = 0.514444, DEG = Math.PI / 180, DT = 1 / 120;
const wing = (s, side = 1, engine = 'leap-1a', extra = {}) => ({ kind: 'engine', engine, mount: 'wing', side, s, ...extra });

test('a part attaches with a mirror twin on the other side, sharing everything but its side', () => {
  const d0 = newDesign('a321neo');
  const d = addPart(d0, wing(9, 1, 'genx-1b', { dx: 0.5, yaw: 3, thrust: 1.2 }));
  assert.equal(d.parts.length, 4);
  const [a, b] = d.parts.slice(2);
  assert.equal(a.pair, b.id); assert.equal(b.pair, a.id);
  assert.equal(a.side, 1); assert.equal(b.side, -1);
  for (const k of ['engine', 'mount', 's', 'dx', 'yaw', 'thrust']) assert.equal(a[k], b[k], k);
  const one = addPart(d0, wing(9), { mirror: false });
  assert.equal(one.parts.length, 3);
  assert.equal(one.parts[2].pair, null);
  // The design given is never changed.
  assert.equal(d0.parts.length, 2);
});

test('editing a part edits its twin; its side stays; a part moved to the tail loses its twin', () => {
  let d = addPart(newDesign('b777-300er'), wing(20, 1, 'genx-1b'));
  const id = d.parts[2].id, tw = d.parts[2].pair;
  d = updatePart(d, id, { s: 22, dz: 0.4, pitch: -2, side: -1 });
  const p = d.parts.find((q) => q.id === id), t = d.parts.find((q) => q.id === tw);
  assert.equal(p.s, 22); assert.equal(t.s, 22); assert.equal(t.dz, 0.4); assert.equal(t.pitch, -2);
  assert.equal(p.side, 1, 'a paired part keeps its side'); assert.equal(t.side, -1);
  // Editing the twin edits the leader too.
  d = updatePart(d, tw, { thrust: 0.8 });
  assert.equal(d.parts.find((q) => q.id === id).thrust, 0.8);
  // To the tail: on the centreline, alone.
  const tail = updatePart(d, id, { mount: 'tail' });
  assert.equal(tail.parts.length, 3);
  const tp = tail.parts.find((q) => q.id === id);
  assert.equal(tp.side, 0); assert.equal(tp.pair, null);
  assert.ok(!tail.parts.some((q) => q.id === tw));
});

test('removing a part removes its twin; Mirror off keeps both, unpaired; Mirror on adds one', () => {
  let d = addPart(newDesign('b787-9'), { kind: 'tank', mount: 'wing', side: 1, s: 12, kg: 4000 });
  const id = d.parts[2].id;
  assert.equal(removePart(d, id).parts.length, 2);
  const apart = setMirror(d, id, false);
  assert.equal(apart.parts.length, 4);
  assert.ok(apart.parts.every((p) => p.pair === null || p.kind === 'engine'));
  // Unpaired, each moves alone.
  const moved = updatePart(apart, id, { s: 14 });
  assert.deepEqual(moved.parts.filter((p) => p.kind === 'tank').map((p) => p.s).sort(), [12, 14]);
  const single = removePart(apart, apart.parts[3].id);
  const again = setMirror(single, id, true);
  assert.equal(again.parts.length, 4);
  assert.equal(again.parts.find((p) => p.id === id).pair, again.parts[3].id);
  // A centreline part has no side to mirror to.
  const hold = addPart(newDesign('b787-9'), { kind: 'tank', mount: 'hold', kg: 2000 });
  assert.equal(hold.parts.length, 3);
  assert.equal(setMirror(hold, hold.parts[2].id, true).parts.length, 3);
});

test('the limits: eight engines and 24 parts at most; a twin that won\'t fit is left off', () => {
  let d = newDesign('b777-300er');
  for (let k = 0; k < 5; k++) d = addPart(d, wing(10 + 3 * k, 1, 'genx-1b'));
  assert.equal(engineParts(d).length, MAX_ENGINES);
  assert.equal(addPart(d, wing(30, 1)).parts.length, d.parts.length);
  let e = addPart(newDesign('b777-300er'), wing(12, 1, 'genx-1b'));
  for (let k = 0; k < 3; k++) e = addPart(e, wing(15 + 3 * k, 1, 'genx-1b'), { mirror: false });
  assert.equal(engineParts(e).length, 7);
  e = addPart(e, wing(26, 1, 'genx-1b'));   // room for one, not two
  assert.equal(engineParts(e).length, MAX_ENGINES);
  assert.equal(e.parts[e.parts.length - 1].pair, null);
  let f = newDesign('a321neo');
  for (let k = 0; k < 30; k++) f = addPart(f, { kind: 'ballast', x: -5 + k * 0.3, kg: 100 });
  assert.equal(f.parts.length, MAX_PARTS);
  // Normalizing a bigger list keeps the first ones.
  const big = normalizeDesign({ base: 'a321neo', parts: Array.from({ length: 40 }, (_, i) => ({ id: 'q' + i, kind: 'ballast', x: 0, kg: 100 })) });
  assert.equal(big.parts.length, MAX_PARTS);
});

test('each mount\'s range keeps a part where it can be, and normalizing clamps to it', () => {
  for (const base of ['a321neo', 'b787-9', 'b777-300er']) {
    for (const mount of ['wing', 'overwing', 'body']) {
      const p = { kind: 'engine', engine: 'genx-1b', mount, side: 1 };
      const R = mountRange(base, p);
      assert.ok(R.lo <= R.hi, `${base} ${mount}`);
      const lo = normalizeDesign({ base, parts: [{ ...p, s: -99, x: -999 }] }).parts[0];
      const hi = normalizeDesign({ base, parts: [{ ...p, s: 99, x: 999 }] }).parts[0];
      assert.equal(lo[R.key], R.lo); assert.equal(hi[R.key], R.hi);
    }
    const p = normalizeDesign({ base, parts: [{ kind: 'engine', engine: 'leap-1a', mount: 'wing', side: 1, s: 8, dx: 9, dz: -9, yaw: 99, pitch: -99, thrust: 99 }] }).parts[0];
    assert.deepEqual([p.dx, p.dz, p.yaw, p.pitch, p.thrust], [RANGES.dx[1], RANGES.dz[0], RANGES.yaw[1], RANGES.pitch[0], RANGES.thrustScale[1]]);
  }
});

test('the mounts\' places: over the wing above it, on the body beside it, a tank under the wing', () => {
  const a = airframe('b787-9'), G = typeById('b787-9').geo, E = ENGINE_TYPES['genx-1b'];
  const over = placeEngine('b787-9', { kind: 'engine', engine: 'genx-1b', mount: 'overwing', side: -1, s: 15, dx: 0, dz: 0 });
  assert.ok(over.nacelle.z - E.nacelle.D / 2 > a.upper(15), 'the nacelle clears the wing\'s upper surface');
  assert.ok(Math.abs(over.nacelle.y + 15) < 1e-12);
  const body = placeEngine('b787-9', { kind: 'engine', engine: 'genx-1b', mount: 'body', side: 1, x: -20, dx: 0, dz: 0 });
  assert.ok(body.nacelle.y - E.nacelle.D / 2 > G.FUSELAGE_WIDTH / 2, 'clear of the fuselage\'s side');
  assert.equal(body.nacelle.mount, 'body');
  const t = placeTank('b787-9', { kind: 'tank', mount: 'wing', side: 1, s: 12, kg: 4000 });
  assert.ok(t.z + t.D / 2 < a.lower(12), 'under the wing');
  assert.ok(Math.abs((Math.PI * 0.75 * t.D ** 3) - 4000 / 800) < 1e-9, 'its volume holds its fuel');
  // A turned engine's thrust line: toe-in turns a left engine's nose to the right (−y), pitch up lifts it.
  const tw = placeEngine('a321neo', { kind: 'engine', engine: 'leap-1a', mount: 'wing', side: 1, s: 5.75, yaw: 5, pitch: 3 });
  assert.ok(tw.dir[1] < 0 && tw.dir[2] > 0);
  assert.ok(Math.abs(Math.hypot(...tw.dir) - 1) < 1e-12);
  assert.equal(placeEngine('a321neo', { kind: 'engine', engine: 'leap-1a', mount: 'wing', side: 1, s: 5.75 }).dir, null);
});

test('the data: mixed engines get their own numbers, turned ones their lines, parts their drag', () => {
  const base = designDef(newDesign('a321neo'));
  assert.equal(base.data.ENGINE_DATA, undefined);
  assert.equal(base.data.DRAG_PARTS, undefined);
  assert.equal(base.geo.THRUST_DIRS, null);
  const d = addPart(newDesign('a321neo'), wing(10, 1, 'genx-1b'));
  const def = designDef(d);
  assert.equal(def.data.ENGINE_DATA.length, 4);
  const T = def.data.ENGINE_DATA.map((e) => e.T0_ENGINE);
  assert.ok(T.includes(ENGINE_TYPES['genx-1b'].data.T0_ENGINE) && T.includes(ENGINE_TYPES['leap-1a'].data.T0_ENGINE));
  assert.deepEqual(def.data.ENGINE_MASSES.slice().sort(), [ENGINE_TYPES['genx-1b'].installedKg, ENGINE_TYPES['genx-1b'].installedKg, ENGINE_TYPES['leap-1a'].installedKg, ENGINE_TYPES['leap-1a'].installedKg].sort());
  assert.match(def.engineName, /^4 × (LEAP-1A \+ GEnx-1B|GEnx-1B \+ LEAP-1A)$/);
  // Each engine's own drag where it is, less the base's two (in its CD0): only the GEnx pair is added.
  const added = def.data.DRAG_PARTS.reduce((s, p) => s + p.cda, 0);
  const want = 2 * 0.05 * Math.PI * ENGINE_TYPES['genx-1b'].nacelle.D ** 2 / 4;
  assert.ok(Math.abs(added - want) < 1e-9, `${added} vs ${want}`);
  const turned = designDef(updatePart(d, d.parts[0].id, { yaw: 4 }));
  assert.ok(turned.geo.THRUST_DIRS.some((v) => v[1] !== 0));
  // Same engines at one thrust: no per-engine numbers.
  assert.equal(designDef(newDesign('b777-300er', { count: 4 })).data.ENGINE_DATA, undefined);
});

test('tanks add fuel to the centre tank and their empty mass; ballast adds its mass and moves the CG', () => {
  const T = typeById('a321neo').data;
  const d = addPart(newDesign('a321neo'), { kind: 'tank', mount: 'wing', side: 1, s: 10, kg: 3000 });
  const def = designDef(d);
  assert.equal(def.data.FUEL_MAX, T.FUEL_MAX + 6000);
  assert.equal(def.data.FUEL_CENTER, T.FUEL_CENTER + 6000);
  assert.ok(Math.abs(def.data.OEW - (T.OEW + 2 * 300)) < 1e-9, 'two empty tanks at 10 % of their fuel');
  assert.equal(def.geo.PODS.length, 2);
  assert.ok(def.geo.CRASH_POINTS.filter((c) => c.why === 'tank strike').length === 2);
  const b = designDef(addPart(newDesign('a321neo'), { kind: 'ballast', x: -10, kg: 2000 }));
  assert.equal(b.data.OEW, T.OEW + 2000);
  assert.ok(b.data.CG_OEW_X < T.CG_OEW_X, 'ballast aft moves the CG aft');
  const h = designDef(addPart(newDesign('a321neo'), { kind: 'tank', mount: 'hold', x: 0, kg: 2500 }));
  assert.equal(h.data.FUEL_MAX, T.FUEL_MAX + 2500);
  assert.equal(h.geo.PODS.length, 0);
});

function cruising(design, { z = 3000, kt = 250, thrust = 0.75 } = {}) {
  const sim = createSim({ type: design });
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z, iasMs: kt * KT, flapLever: 0, gearDown: false, fuelKg: 15000, payloadKg: 15000 });
  sim.controls.thrust = thrust;
  return sim;
}

test('in the sim: a lone wing tank drags, and yaws the nose towards its side', () => {
  const plain = newDesign('a321neo');
  const one = addPart(plain, { kind: 'tank', mount: 'wing', side: 1, s: 10, kg: 3000 }, { mirror: false });
  const a = cruising(plain), b = cruising(one);
  a.step(DT); b.step(DT);
  // The left tank's drag (the left is +y, FRD −y): FRD yaw rate goes negative (nose left).
  assert.ok(b._core.r < a._core.r, `r ${b._core.r} vs ${a._core.r}`);
  for (let i = 0; i < 240; i++) { a.step(DT); b.step(DT); }
  assert.ok(b.state.ias < a.state.ias, 'and it slows it');
});

// (The pitch is checked as a force, not a rate: the A321's normal law holds the load factor, so the upward part of
// pitched-up thrust has the elevator answer it within a step.)
test('in the sim: toe-in on a pair cancels; pitched engines\' thrust lines act', () => {
  const d = newDesign('a321neo');
  const toe = updatePart(d, d.parts[0].id, { yaw: 8 });
  const up = updatePart(d, d.parts[0].id, { pitch: 8 }), dn = updatePart(d, d.parts[0].id, { pitch: -8 });
  const a = cruising(d, { thrust: 0.9 }), b = cruising(toe, { thrust: 0.9 }), c = cruising(up, { thrust: 0.9 }), e = cruising(dn, { thrust: 0.9 });
  for (let i = 0; i < 2; i++) { a.step(DT); b.step(DT); c.step(DT); e.step(DT); }
  assert.ok(Math.abs(b._core.r - a._core.r) < 1e-9, `toe-in yaw ${b._core.r - a._core.r}`);
  assert.equal(b._core.p, a._core.p);
  assert.notEqual(c._core.q, a._core.q);
  assert.ok(Math.sign(c._core.q - a._core.q) === -Math.sign(e._core.q - a._core.q), 'up and down act the opposite ways');
});

test('in the sim: mixed engines each make their own thrust', () => {
  const d = addPart(newDesign('b787-9'), wing(20, 1, 'ge90-115b'));
  const sim = cruising(d, { thrust: 0.95 });
  for (let i = 0; i < 120 * 15; i++) sim.step(DT);
  const def = designDef(d), E = sim.state.engines;
  const big = def.geo.NACELLES.map((n, i) => (n.engine === 'ge90-115b' ? E[i].thrustN : null)).filter((v) => v !== null);
  const small = def.geo.NACELLES.map((n, i) => (n.engine === 'genx-1b' ? E[i].thrustN : null)).filter((v) => v !== null);
  assert.equal(big.length, 2); assert.equal(small.length, 2);
  const ratio = big[0] / small[0], rated = ENGINE_TYPES['ge90-115b'].data.T0_ENGINE / ENGINE_TYPES['genx-1b'].data.T0_ENGINE;
  assert.ok(ratio > 1.15 && Math.abs(ratio - rated) < 0.35 * rated, `GE90 / GEnx thrust ${ratio.toFixed(2)} (rated ${rated.toFixed(2)})`);
  assert.ok(Math.abs(big[0] - big[1]) < 1e-6 * big[0], 'a pair is a pair');
});
