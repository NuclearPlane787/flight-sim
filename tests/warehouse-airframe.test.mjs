// v0.5.3: the warehouse's airframe (src/ui/warehouse.js, behind AIRFRAME_ON or ?airframe=1): the flag, the edits (Mirror
// keeps the wing's sides together; off, the clicked side alone), the outline and picking the wing, tailplane, fin and
// fuselage on the design's own shape, the surface under the pointer following a changed wing, the airframe's checks in
// readout() (the static margin replacing the CG row, Cnβ, the stall, the tail strike, the span's code letter), undo,
// and what rebuilds the model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIRFRAME_ON, airframeEnabled, editAirframe, afOutline, afPolys, pickAirframe, hitAirframe, readout, viewKey, createHistory,
  placement, partBoxes, editDesign,
} from '../src/ui/warehouse.js';
import { newDesign, normalizeDesign, defaultAirframe, isBaseAirframe, airframe } from '../src/sim/designs.js';
import { shapeOf } from '../src/sim/parts-aero.js';
import { TYPES } from '../src/sim/types.js';

const BASES = Object.keys(TYPES);
const row = (r, k) => r.rows.find((x) => x.k === k);
const a0 = (d) => readout(d, { airframe: true }).numbers.airframe;

test('the flag: on since the v0.5.3 run\'s end-to-end check (?airframe=1 turned it on before); readout() follows it', () => {
  assert.equal(AIRFRAME_ON, true);
  assert.equal(airframeEnabled(''), true);
  assert.equal(airframeEnabled('?airframe=1'), true);
  assert.equal(airframeEnabled('?warehouse=1&airframe=1'), true);
  const d = newDesign('a321neo');
  const off = readout(d, { airframe: false }), on = readout(d, { airframe: true });
  assert.deepEqual(readout(d).rows.map((x) => x.k), on.rows.map((x) => x.k), 'the default is on');
  assert.ok(row(off, 'cg') && !row(off, 'margin'), 'off: v0.5.2\'s CG row');
  // on the base's own airframe v0.5.2's CG row stays beside the margin; on a changed airframe the margin replaces it
  assert.ok(row(on, 'cg') && row(on, 'margin') && row(on, 'cnb') && row(on, 'stall') && row(on, 'span') && row(on, 'nose'), 'on: the airframe\'s rows');
  const changedAf = readout({ ...d, airframe: { ...d.airframe, tail: 1.2 } }, { airframe: true });
  assert.ok(!row(changedAf, 'cg') && row(changedAf, 'margin'), 'a changed airframe: the margin, not the CG against the base');
  assert.equal(on.rows.filter((x) => x.k === 'tail').length, 1, 'one tail-strike row');
  assert.deepEqual(off.rows.map((x) => x.k), ['oew', 'mtow', 'payload', 'fuel', 'tw', 'range', 'tail', 'drag', 'cg', 'yaw', 'pitch']);
});

test('the bases pass the airframe\'s checks, against themselves', () => {
  for (const b of BASES) {
    const r = readout(newDesign(b), { airframe: true });
    assert.equal(r.worst, 'ok', `${b}: ${JSON.stringify(r.issues)}`);
    const a = r.numbers.airframe;
    assert.ok(a, 'designNumbers(def).airframe');
    assert.ok(Math.abs(a.staticMarginMac - a.staticMarginBaseMac) < 1e-9 && a.staticMarginMac > 0.05);
    assert.equal(a.codeLetter, a.gateLetter);
    assert.match(row(r, 'span').value, new RegExp(`code ${a.codeLetter} \\(gate ${a.gateLetter}\\)`));
  }
});

test('edits: Mirror keeps the sides together; off, the clicked side alone; on again, both take the clicked side', () => {
  const d = newDesign('b787-9');
  const a = editAirframe(d, 'span', 1.2, -1);
  assert.equal(a.airframe.wingL.span, 1.2); assert.equal(a.airframe.wingR.span, 1.2);
  const b = editAirframe(editAirframe(a, 'mirror', false, 1), 'sweep', 4, -1);
  assert.equal(b.airframe.mirror, false);
  assert.equal(b.airframe.wingR.sweep, 4); assert.equal(b.airframe.wingL.sweep, 0);
  const c = editAirframe(b, 'mirror', true, -1);
  assert.equal(c.airframe.mirror, true); assert.equal(c.airframe.wingL.sweep, 4);
  const e = editAirframe(b, 'mirror', true, 1);
  assert.equal(e.airframe.wingR.sweep, 0, 'the left side\'s shape on both');
  // clamped to AIRFRAME_RANGES
  assert.equal(editAirframe(d, 'tail', 9).airframe.tail, 1.6);
  assert.equal(editAirframe(d, 'plugFwd', -10).airframe.plugFwd, -4);
  assert.equal(editAirframe(d, 'dihedral', 20).airframe.wingL.dihedral, 8);
  // back to the base's
  const f = editAirframe(editAirframe(editAirframe(d, 'tail', 1.3), 'fin', 0.7), 'plugAft', 2);
  assert.equal(editAirframe(f, 'reset', 'tailplane').airframe.tail, 1);
  assert.equal(editAirframe(f, 'reset', 'body').airframe.plugAft, 0);
  const g = ['reset'].reduce((x) => editAirframe(editAirframe(editAirframe(editAirframe(x, 'reset', 'tailplane'), 'reset', 'fin'), 'reset', 'body'), 'reset', 'wing'), editAirframe(f, 'span', 0.9));
  assert.ok(isBaseAirframe(g.airframe, g.base));
  assert.deepEqual(g.airframe, defaultAirframe('b787-9'));
});

test('the outline is the parts\' planform, and moves with the sliders', () => {
  for (const b of BASES) {
    const d = newDesign(b), O = afOutline(b, d.airframe), S = shapeOf(b, d.airframe);
    assert.equal(O.wingL.length, 2 * S.wingL.stations.length);
    assert.ok(O.wingL.every((p) => p[1] > 0) && O.wingR.every((p) => p[1] < 0));
    assert.equal(afPolys(O, 'wing').length, 2); assert.equal(afPolys(O, null).length, 7);
    const tip = (o) => Math.max(...o.wingL.map((p) => p[1]));
    const long = afOutline(b, editAirframe(d, 'span', 1.25).airframe);
    assert.ok(tip(long) > tip(O) * 1.15, 'a longer span reaches further');
    const aft = afOutline(b, editAirframe(d, 'plugAft', 4).airframe);
    assert.ok(Math.abs(Math.min(...aft.fin.map((p) => p[0])) - (Math.min(...O.fin.map((p) => p[0])) - 4)) < 1e-9, 'the fin moves back with the aft plug');
    const fwd = afOutline(b, editAirframe(d, 'plugFwd', 3).airframe);
    assert.ok(Math.abs(fwd.bodyTop[0][0] - O.bodyTop[0][0] - 3) < 1e-9, 'the nose moves forward');
  }
});

test('picking the airframe: each wing from above, the tailplane, the fin from the side, the fuselage; on the design\'s shape', () => {
  for (const b of BASES) {
    const d = newDesign(b), S = shapeOf(b, d.airframe);
    const mid = (st, k) => { const a = st[k], c = st[k + 1]; return { y: (a.y + c.y) / 2, x: (a.xle + c.xle) / 2 - (a.c + c.c) / 4 }; };
    const w = mid(S.wingL.stations, 1);
    assert.deepEqual(pickAirframe(d, [w.x, w.y, 80], [0, 0, -1])?.on, 'wing');
    assert.equal(pickAirframe(d, [w.x, -w.y, 80], [0, 0, -1])?.side, -1);
    const t = mid(S.tail.stations, 0);
    const pt = pickAirframe(d, [t.x, t.y + 0.5 * (S.tail.stations[1].y - t.y), 80], [0, 0, -1]);
    assert.equal(pt?.on, 'tailplane', b);
    const f0 = S.fin.stations[0], f1 = S.fin.stations[1], fz = (f0.z + f1.z) / 2, fx = (f0.xle + f1.xle) / 2 - (f0.c + f1.c) / 4;
    assert.equal(pickAirframe(d, [fx, 80, fz], [0, -1, 0])?.on, 'fin', b);
    assert.equal(pickAirframe(d, [S.body.noseX - 8, 80, 0], [0, -1, 0])?.on, 'body', b);
    assert.equal(pickAirframe(d, [0, 0, 80], [0, 0, 1]), null);
    // a span 25 % longer: past the base's tip is wing now, and wasn't before
    const yOut = S.wingL.stations.at(-1).y + 2, x = S.wingL.stations.at(-1).xle - 0.3;
    assert.equal(pickAirframe(d, [x, yOut, 80], [0, 0, -1]), null);
    const long = editAirframe(d, 'span', 1.25), SL = shapeOf(b, long.airframe), tl = SL.wingL.stations.at(-1);
    const st = SL.wingL.stations, k = st.length - 2, sy = st[k].y + 0.8 * (tl.y - st[k].y);
    const sx = st[k].xle + 0.8 * (tl.xle - st[k].xle) - 0.4;
    assert.equal(pickAirframe(long, [sx, sy, 80], [0, 0, -1])?.on, 'wing', `${b} long tip`);
    // the aft plug: the fin is 5 m further back
    const aft = editAirframe(d, 'plugAft', 5);
    assert.equal(pickAirframe(aft, [fx - 5, 80, fz], [0, -1, 0])?.on, 'fin');
  }
});

test('the surface under the pointer follows a changed wing (mounts on the design\'s wing); the base\'s is v0.5.2\'s', () => {
  for (const b of BASES) {
    const d = newDesign(b), a = airframe(b);
    const y = a.ys + 0.5 * (a.tipY - a.ys), x = a.leX(y) - 0.5 * a.chord(y);
    assert.deepEqual(hitAirframe(d, [x, y, 60], [0, 0, -1]), hitAirframe(b, [x, y, 60], [0, 0, -1]), 'a base design: the base\'s');
    const long = editAirframe(d, 'span', 1.3), al = airframe(b, long.airframe);
    const yo = a.tipY + 1.5, xo = al.leX(yo) - 0.5 * al.chord(yo);
    assert.notEqual(hitAirframe(b, [xo, yo, 60], [0, 0, -1])?.on, 'wing', `${b}: past the base's tip`);
    assert.equal(hitAirframe(long, [xo, yo, 60], [0, 0, -1])?.on, 'wing', `${b}: the longer wing`);
    // a tank dropped out there is placed within the design's range, past the base's
    const p = placement(b, { kind: 'tank', mount: 'wing' }, hitAirframe(long, [xo, yo, 60], [0, 0, -1]), 0.25, long.airframe);
    const p0 = placement(b, { kind: 'tank', mount: 'wing' }, { on: 'wing', x: xo, y: yo, z: 0 });
    assert.ok(p.s > p0.s, `${b}: ${p.s} > ${p0.s}`);
    // one side longer (Mirror off): only that side reaches
    const one = editAirframe(editAirframe(d, 'mirror', false, 1), 'span', 1.3, 1);
    assert.equal(hitAirframe(one, [xo, yo, 60], [0, 0, -1])?.on, 'wing');
    assert.notEqual(hitAirframe(one, [xo, -yo, 60], [0, 0, -1])?.on, 'wing');
  }
});

test('the airframe\'s checks: a small tailplane with the CG aft is red; a small fin amber; a long span past the gate amber', () => {
  for (const b of BASES) {
    const d = newDesign(b);
    const small = readout(editAirframe(d, 'tail', 0.6), { airframe: true });
    assert.ok(small.numbers.airframe.staticMarginMac < readout(d, { airframe: true }).numbers.airframe.staticMarginMac);
    // ballast far aft on a small tailplane: behind the neutral point
    let h = editAirframe(d, 'tail', 0.6);
    const R = TYPES[b].geo;
    h = normalizeDesign({ ...h, parts: [...h.parts, { kind: 'ballast', side: 0, x: R.TAIL_STRIKE_POINT.x + 6, kg: 6000 }, { kind: 'ballast', side: 0, x: R.TAIL_STRIKE_POINT.x + 7, kg: 6000 }] });
    const red = readout(h, { airframe: true });
    if (red.numbers.airframe.staticMarginMac < 0) {
      assert.equal(row(red, 'margin').level, 'bad');
      assert.ok(red.issues.some((i) => i.level === 'bad' && /neutral point/.test(i.text)));
    } else assert.ok(red.numbers.airframe.staticMarginMac < small.numbers.airframe.staticMarginMac, `${b}: the ballast eats the margin`);
    const fin = readout(editAirframe(d, 'fin', 0.6), { airframe: true });
    assert.ok(fin.numbers.airframe.cnBeta < fin.numbers.airframe.cnBetaBase);
    assert.notEqual(row(fin, 'cnb').level, 'ok', `${b} fin 0.6: ${row(fin, 'cnb').value}`);
    const wide = readout(editAirframe(d, 'span', 1.3), { airframe: true });
    assert.equal(row(wide, 'span').level, 'warn', `${b}: ${row(wide, 'span').value}`);
    assert.ok(wide.numbers.airframe.stallKt < wide.numbers.airframe.stallKtBase, 'more wing stalls slower');
    const aft = readout(editAirframe(d, 'plugAft', 6), { airframe: true });
    assert.ok(aft.numbers.airframe.tailStrikeDeg < aft.numbers.airframe.tailStrikeBaseDeg, 'the aft plug strikes sooner');
    assert.match(row(aft, 'tail').value, /base/);
    // the nose wheel's load: the lower of the loaded and the empty, red under 2.5 %, amber under 5 %
    const tip = readout(editAirframe(editAirframe(d, 'plugAft', 6), 'plugFwd', -4), { airframe: true }), na = tip.numbers.airframe;
    const low = Math.min(na.noseLoad, na.noseLoadEmpty);
    assert.ok(low < Math.min(a0(d).noseLoad, a0(d).noseLoadEmpty), `${b}: the plugs take weight off the nose`);
    assert.equal(row(tip, 'nose').level, low < 0.025 ? 'bad' : low < 0.05 ? 'warn' : 'ok');
    if (low < 0.025) assert.ok(tip.issues.some((i) => i.level === 'bad' && /nose wheel/.test(i.text)));
    assert.equal(row(readout(d, { airframe: true }), 'nose').level, 'ok');
  }
});

test('a slider\'s drag is one undo step; the model rebuilds on the airframe; Mirror and reset are steps', () => {
  const d = newDesign('a321neo'), h = createHistory();
  let cur = d;
  h.push(cur);
  for (const v of [1.05, 1.1, 1.15, 1.2]) cur = editAirframe(cur, 'span', v, 1);
  assert.equal(h.undo(cur), d);
  assert.notEqual(viewKey(editAirframe(d, 'span', 1.1)), viewKey(d));
  assert.notEqual(viewKey(editAirframe(d, 'fin', 1.2)), viewKey(d));
  assert.notEqual(viewKey(editAirframe(d, 'plugFwd', 1)), viewKey(d));
  assert.equal(viewKey(editAirframe(d, 'mirror', false)), viewKey(d), 'Mirror alone changes no shape');
  assert.equal(viewKey(editDesign(d, 'oewFrac', 0.1)), viewKey(d));
  // the parts' boxes ride the design's wing
  const long = editAirframe(d, 'sweep', 8);
  const e0 = partBoxes(d).find((b) => b.kind === 'engine'), e1 = partBoxes(long).find((b) => b.kind === 'engine');
  assert.ok(e1.x < e0.x - 0.2, 'more sweep: the engine moves aft with the wing');
});
