// v0.5.6: designNumbers()'s VMC (the critical engine out, the rest at take-off thrust, full rudder and 5° of bank, at
// the lightest runway weight), the all-engines VMC of a lopsided design, and the VR estimate the warehouse compares
// them with (src/sim/designs.js, vmcNumbers()).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newDesign, designDef, designNumbers, defaultAirframe, setMirror, updatePart, engineParts } from '../src/sim/designs.js';
import { typeById } from '../src/sim/types.js';

const IDS = ['a321neo', 'b787-9', 'b777-300er'];
// published VMCA, roughly (A321neo about 110–115 kt, 787-9 about 120–125, 777-300ER about 125–135), with the model's
// latitude: the A321's comes out about 10 kt high
const RANGE = { 'a321neo': [108, 130], 'b787-9': [112, 130], 'b777-300er': [122, 140] };
const num = (d) => designNumbers(designDef(d));
const withAf = (base, patch) => ({ ...newDesign(base, { id: 'v' }), airframe: { ...defaultAirframe(base), ...patch } });

for (const id of IDS) {
  test(`${id}: VMC plausible, under VR with room (VR ≥ 1.05 VMC), balanced with all engines running`, () => {
    const n = designNumbers(typeById(id));
    assert.ok(n.vmcKt > RANGE[id][0] && n.vmcKt < RANGE[id][1], `VMC ${n.vmcKt.toFixed(1)} kt`);
    assert.ok(n.vrKt >= 1.05 * n.vmcKt, `VR ${n.vrKt.toFixed(1)} against 1.05 × VMC ${n.vmcKt.toFixed(1)}`);
    assert.equal(n.vmcAllKt, null);
    assert.equal(n.vmcBaseKt, n.vmcKt);
    // a design on its base's airframe: its base's VMC, within a knot (the parts' own masses round differently)
    const d = num(newDesign(id, { id: 'b' }));
    assert.ok(Math.abs(d.vmcKt - n.vmcKt) < 1.5 && d.vmcBaseKt === n.vmcKt, `${d.vmcKt} ${n.vmcKt}`);
  });

  test(`${id}: the fin and the engines' arms move VMC`, () => {
    const base = num(newDesign(id, { id: 'b' })).vmcKt;
    const small = num(withAf(id, { fin: 0.6 })).vmcKt, big = num(withAf(id, { fin: 1.4 })).vmcKt;
    assert.ok(small > base * 1.1, `fin 0.6: ${small.toFixed(1)} against ${base.toFixed(1)}`);
    assert.ok(big < base * 0.95, `fin 1.4: ${big.toFixed(1)} against ${base.toFixed(1)}`);
    // four engines: the outer pair's arm (the critical one) raises it
    const four = num(newDesign(id, { id: 'f', count: 4 })).vmcKt;
    assert.ok(four > base * 1.1, `four engines: ${four.toFixed(1)}`);
  });

  test(`${id}: one engine with more thrust than its twin: a VMC with all engines running`, () => {
    let d = newDesign(id, { id: 'l' });
    const e = engineParts(d)[0];
    d = setMirror(d, e.id, false);
    d = updatePart(d, e.id, { thrust: 1.5 });
    const n = num(d);
    assert.ok(n.vmcAllKt > 40 && n.vmcAllKt < n.vmcKt, `all running ${n.vmcAllKt?.toFixed(1)}, one out ${n.vmcKt.toFixed(1)}`);
  });
}
