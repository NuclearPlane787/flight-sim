// v0.5.6: the warehouse editor's part in hand (its keys: nudgeHand(), applyHand(), handText()), the drag from the palette
// (paletteDrop()), and the minimum control speeds in the readout (vmcLevel(), vmcRows(), with stub numbers; and the real
// ones once designs.js gives them).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nudgeHand, applyHand, handText, HAND0, paletteDrop, PAL_DRAG_PX, vmcLevel, vmcRows, VMC_MARGIN, placement, nudgeHelp, readout,
} from '../src/ui/warehouse.js';
import { newDesign, addPart, mountRange, RANGES, designNumbers, designDef } from '../src/sim/designs.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const BASE = 'a321neo';
const press = (h, c, key, n = 1, shift = false) => { for (let i = 0; i < n; i++) h = nudgeHand(h, c, key, shift, BASE, null); return h; };
const wingEngine = (y = 9) => placement(BASE, { kind: 'engine', engine: 'leap-1a' }, { on: 'wing', x: 0, y, z: 0 });

test('the part in hand: the keys set its offsets as they move a selected part, and applyHand() puts them where the pointer is', () => {
  const c = wingEngine();
  assert.equal(c.mount, 'wing');
  assert.equal(c.side, 1);
  let h = { ...HAND0 };
  h = press(h, c, 'e', 2);
  assert.equal(h.yaw, 2, 'E: toe-in, a degree a press');
  h = press(h, c, 'Q', 3);
  assert.equal(h.yaw, -1, 'Q (either case): toe-out');
  h = press(h, c, 'ArrowUp', 3);
  assert.ok(near(h.dx, 0.3), `↑: forward 0.1 m a press (${h.dx})`);
  h = press(h, c, 'ArrowDown', 1);
  assert.ok(near(h.dx, 0.2));
  h = press(h, c, 'ArrowUp', 2, true);
  assert.ok(near(h.dz, 0.1), `Shift+↑: up 0.05 m a press (${h.dz})`);
  h = press(h, c, 'ArrowLeft', 2);
  assert.ok(near(h.s, 0.5), '←: out 0.25 m a press, from where the pointer puts it');
  const p = applyHand(c, h);
  assert.ok(near(p.s, c.s + 0.5) && near(p.dx, 0.2) && near(p.dz, 0.1) && p.yaw === -1, JSON.stringify(p));
  assert.deepEqual(c, wingEngine(), 'the candidate itself is untouched');
  // attached (Mirror on): the part and its twin carry the values
  const d0 = newDesign(BASE), had = new Set(d0.parts.map((q) => q.id));
  const d = addPart(d0, p, { mirror: true });
  const added = d.parts.filter((q) => !had.has(q.id));
  assert.equal(added.length, 2);
  for (const q of added) assert.ok(near(q.s, c.s + 0.5) && near(q.dx, 0.2) && near(q.dz, 0.1) && q.yaw === -1, JSON.stringify(q));
  assert.deepEqual(added.map((q) => q.side).sort(), [-1, 1]);
});

test('the part in hand stays within its limits: a key at one changes nothing', () => {
  const c = wingEngine();
  let h = press({ ...HAND0 }, c, 'e', 30);
  assert.equal(h.yaw, RANGES.yaw[1]);
  assert.equal(nudgeHand(h, c, 'e', false, BASE), h, 'at +10°: the same offsets');
  h = press(h, c, 'ArrowUp', 100);
  assert.equal(h.dx, RANGES.dx[1]);
  h = press(h, c, 'ArrowDown', 100, true);
  assert.equal(h.dz, RANGES.dz[0]);
  // the station: kept in the mount's range from where the pointer puts it
  const out = wingEngine(40), R = mountRange(BASE, out);
  assert.ok(near(out.s, R.hi), 'the pointer past the tip snaps to the range\'s end');
  const h0 = { ...HAND0 };
  assert.equal(nudgeHand(h0, out, 'ArrowLeft', false, BASE), h0, 'already at the outer end: ← does nothing');
  assert.ok(near(nudgeHand(h0, out, 'ArrowRight', false, BASE).s, -0.25), '→ brings it in');
});

test('the keys each part in hand takes (as a selected part\'s)', () => {
  const tailCone = mountRange(BASE, { kind: 'engine', engine: 'leap-1a', mount: 'body', side: 1 }).lo + 1;
  const body = placement(BASE, { kind: 'engine', engine: 'leap-1a' }, { on: 'body', x: tailCone, y: -2, z: 0 });
  assert.equal(body.mount, 'body');
  let h = press({ ...HAND0 }, body, 'ArrowUp', 2);
  assert.ok(near(h.x, 0.5) && h.dx === 0, '↑ on a body engine: its station, 0.25 m a press');
  assert.ok(near(applyHand(body, h).x, body.x + 0.5));
  assert.ok(near(press({ ...HAND0 }, body, 'ArrowUp', 1, true).dz, 0.05), 'Shift+↑: up');
  assert.equal(press({ ...HAND0 }, body, 'ArrowLeft').s, 0, 'no span on the body');

  const tank = placement(BASE, { kind: 'tank', mount: 'wing' }, { on: 'wing', x: 0, y: 8, z: 0 });
  const h0 = { ...HAND0 };
  assert.equal(nudgeHand(h0, tank, 'e', false, BASE), h0, 'a wing tank doesn\'t turn');
  assert.equal(nudgeHand(h0, tank, 'ArrowUp', true, BASE), h0, 'nor go up and down');
  assert.ok(near(nudgeHand(h0, tank, 'ArrowUp', false, BASE).dx, 0.1));
  assert.equal(nudgeHelp(tank), '↑ ↓ forward and aft · ← → out and in');
  const t2 = applyHand(tank, { ...HAND0, dx: 0.4, yaw: 5, dz: 0.3 });
  assert.ok(near(t2.dx, 0.4) && t2.yaw === undefined && t2.dz === undefined, 'only what a wing tank has');

  const ballast = placement(BASE, { kind: 'ballast' }, { on: 'body', x: 10, y: -1, z: -0.5 });
  assert.ok(near(press({ ...HAND0 }, ballast, 'ArrowDown').x, -0.25), '↓ on ballast: aft along the hold');
  assert.equal(nudgeHelp(wingEngine()), '↑ ↓ forward and aft · ← → out and in · Shift+↑ ↓ up and down · Q E turn');
});

test('the tip beside the pointer shows the hand\'s values', () => {
  assert.equal(handText(HAND0), '');
  assert.equal(handText({ ...HAND0, dx: 0.3, dz: -0.05, yaw: 2 }), '0.3 m forward · 0.05 m down · toed in 2°');
  assert.equal(handText({ ...HAND0, dx: -1, yaw: -3 }), '1 m aft · toed out 3°');
  assert.equal(handText({ ...HAND0, s: 0.5 }), '', 'the station shows in partWhere()');
});

test('a drag from the palette: a press that doesn\'t move is a click; let go over a place that fits, it attaches; else it goes back', () => {
  assert.ok(PAL_DRAG_PX >= 3 && PAL_DRAG_PX <= 10);
  const fits = { ok: true, next: {} }, red = { ok: false, next: null, why: 'overlap' };
  assert.equal(paletteDrop({ moved: false, over: true, ghost: fits }), 'none');
  assert.equal(paletteDrop({ moved: true, over: true, ghost: fits }), 'attach');
  assert.equal(paletteDrop({ moved: true, over: true, ghost: red }), 'cancel');
  assert.equal(paletteDrop({ moved: true, over: true, ghost: null }), 'cancel', 'over the view but off the aircraft');
  assert.equal(paletteDrop({ moved: true, over: false, ghost: fits }), 'cancel', 'off the view (the palette, a panel)');
  assert.equal(paletteDrop(), 'none');
});

test('VMC against VR: certification wants VR at least 1.05 × VMC; a design no worse than its base passes', () => {
  assert.equal(VMC_MARGIN, 1.05);
  assert.equal(vmcLevel(110, 140), 'ok');
  assert.equal(vmcLevel(134, 140), 'warn', '134 × 1.05 = 140.7 > 140');
  assert.equal(vmcLevel(141, 140), 'bad');
  assert.equal(vmcLevel(134, 140, 134), 'ok', 'the base\'s own margin');
  assert.equal(vmcLevel(141, 140, 120), 'bad');
  assert.equal(vmcLevel(NaN, 140), 'ok');
  assert.equal(vmcLevel(120, NaN), 'ok');
});

test('vmcRows(): the engine-out row and, for lopsided thrust, the all-engines row (stub numbers)', () => {
  assert.deepEqual(vmcRows({}, {}), [], 'nothing from designs.js yet: no rows');
  let r = vmcRows({ vmcKt: 120, vrKt: 140 }, { vmcKt: 110 });
  assert.equal(r.length, 1);
  assert.equal(r[0].k, 'vmc');
  assert.equal(r[0].level, 'ok');
  assert.equal(r[0].value, '120 kt · VR 140 kt (the base’s 110 kt)');
  r = vmcRows({ vmcKt: 136, vrKt: 140 }, { vmcKt: 110 });
  assert.equal(r[0].level, 'warn');
  assert.match(r[0].note, /within 5 %/);
  r = vmcRows({ vmcKt: 150, vrKt: 140 }, { vmcKt: 110 });
  assert.equal(r[0].level, 'bad');
  assert.match(r[0].note, /above VR/);
  // all engines on a lopsided design
  const all = (va, yaw) => vmcRows({ vmcAllKt: va, vrKt: 140 }, {}, yaw).find((x) => x.k === 'vmcAll');
  assert.equal(all(0, 'warn'), undefined, 'balanced thrust: no row');
  assert.equal(all(40, 'ok').level, 'ok', 'a trace of asymmetry the yaw row doesn\'t flag stays green');
  assert.deepEqual([all(90, 'warn').level, all(90, 'warn').note], ['warn', ''], 'amber below VR, the yaw row speaks');
  assert.equal(all(150, 'warn').level, 'bad');
  assert.match(all(150, 'warn').note, /above VR/, 'red above VR: worse than the yaw row, so it says so');
  assert.equal(all(150, 'bad').note, '', 'the yaw row is red already: one note');
  assert.equal(all(90, 'warn').value, 'the rudder holds it from 90 kt');
});

test('the readout: VMC rows with the airframe on, once designs.js gives the numbers; the bases pass against themselves', () => {
  for (const b of ['a321neo', 'b787-9', 'b777-300er']) {
    const d = newDesign(b), n = designNumbers(designDef(d));
    const on = readout(d, { airframe: true }), off = readout(d, { airframe: false });
    assert.ok(!off.rows.some((x) => x.k === 'vmc' || x.k === 'vmcAll'), 'not with the airframe off');
    if (!Number.isFinite(n.vmcKt)) { assert.ok(!on.rows.some((x) => x.k === 'vmc')); continue; }
    const row = on.rows.find((x) => x.k === 'vmc');
    assert.ok(row && row.level === 'ok', `${b}: ${JSON.stringify(row)}`);
    assert.ok(!on.rows.some((x) => x.k === 'vmcAll' && x.level !== 'ok'), `${b}: balanced`);
    assert.equal(on.worst, 'ok');
  }
});
