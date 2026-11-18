// v0.5.6: the main gear follows the wing (ROADMAP's "the gear stays at the wing's root"). On a changed wing each main
// leg goes where the base's is relative to its side (the side's map at the leg's own span: sweep and chord move it fore
// and aft, the span outboard), its wheels as low as they were; the sim's legs, the wheelbase, the tail strike, the
// nose wheel's share and the models' legs all from there, and the inner flaps keep most of their depth behind it. A
// design on its base's airframe, or with only its body or tails changed, keeps the base's legs exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A canvas that draws nothing, so the liveries paint without a DOM.
const ctx = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 100 })
    : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };

const { newDesign, designDef, defaultAirframe, designNumbers, stationRange } = await import('../src/sim/designs.js');
const { typeById } = await import('../src/sim/types.js');
const { airframeMap } = await import('../src/sim/airframe-map.js');
const { createAircraft } = await import('../src/aircraft.js');
const { createWidebody } = await import('../src/widebody.js');
const { B787_9, B777_300ER } = await import('../src/widebody-specs.js');
const { GEAR: A321_GEAR } = await import('../src/geometry.js');

let n = 0;
const design = (base, wingL = {}, wingR = null, rest = {}) => {
  const af = defaultAirframe(base), wl = { ...af.wingL, ...wingL }, wr = wingR ? { ...af.wingR, ...wingR } : { ...wl };
  return designDef({ ...newDesign(base, { id: `gfw-${base}-${n++}` }), airframe: { ...af, ...rest, wingL: wl, wingR: wr, mirror: !wingR } });
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('a design on its base\'s airframe, or with only its body or tails changed, keeps the base\'s main gear exactly', () => {
  for (const base of ['a321neo', 'b787-9', 'b777-300er']) {
    const T = typeById(base), G0 = T.geo.GEAR;
    assert.deepEqual(designDef(newDesign(base, { id: `gfw-same-${base}` })).geo.GEAR, G0, `${base}: the base's airframe`);
    const D = design(base, {}, null, { plugFwd: 3, plugAft: 2, tail: 1.3, fin: 0.8 }), G = D.geo.GEAR;
    assert.deepEqual([G.left, G.right], [G0.left, G0.right], `${base}: plugs and tails leave the main legs alone`);
    assert.ok(near(G.nose.x, G0.nose.x + 3), `${base}: the nose leg moves with the forward plug`);
    assert.ok(near(D.geo.WHEELBASE, G.nose.x - G.left.x) && near(D.geo.TRACK, G.left.y - G.right.y), `${base}: the wheelbase and track from the legs`);
    // the dihedral alone moves the leg's top in the wing, not the leg
    const H = design(base, { dihedral: 8 }).geo.GEAR;
    assert.deepEqual([H.left, H.right], [G0.left, G0.right], `${base}: the dihedral leaves the legs where they are`);
  }
});

test('each main leg goes where the wing\'s map puts the base\'s: forward with a shorter chord or less sweep, aft with more, out with the span', () => {
  const cases = [
    ['a321neo', { chord: 0.8, sweep: -8 }, null, 'fwd'],
    ['a321neo', { span: 1.3 }, null, 'aft'],
    ['b777-300er', { sweep: 8 }, null, 'aft'],
    ['b787-9', { chord: 0.8 }, null, 'fwd'],
    ['b787-9', { chord: 1.3 }, null, 'aft'],
    ['b777-300er', { chord: 0.8 }, { sweep: 8 }, 'each'],
  ];
  for (const [base, wl, wr, way] of cases) {
    const D = design(base, wl, wr), G = D.geo.GEAR, G0 = typeById(base).geo.GEAR, M = airframeMap(base, D.design.airframe);
    for (const [side, g, g0, w] of [[1, G.left, G0.left, D.design.airframe.wingL], [-1, G.right, G0.right, D.design.airframe.wingR]]) {
      const [x, y] = M.wing(side, g0.x, g0.y, 0);
      assert.ok(near(g.x, x), `${base} ${JSON.stringify(wl)}: leg x ${g.x} where the map puts it (${x})`);
      assert.ok(near(g.y, w.span !== 1 ? y : g0.y) && g.z === g0.z, `${base}: its station, its wheels as low as they were`);
    }
    if (way === 'fwd') assert.ok(G.left.x > G0.left.x + 0.3, `${base} ${JSON.stringify(wl)}: forward (${G.left.x.toFixed(2)} from ${G0.left.x})`);
    if (way === 'aft') assert.ok(G.left.x < G0.left.x - 0.1, `${base} ${JSON.stringify(wl)}: aft (${G.left.x.toFixed(2)} from ${G0.left.x})`);
    if (wl.span > 1) assert.ok(G.left.y > G0.left.y + 0.3, `${base}: outboard with the span`);
    if (way === 'each') assert.ok(G.left.x > G0.left.x && G.right.x < G0.right.x, `${base}: each leg on its own side's wing`);
    assert.ok(near(D.geo.WHEELBASE, G.nose.x - (G.left.x + G.right.x) / 2), `${base}: the wheelbase from the legs`);
  }
});

test('the tail strike and the nose wheel\'s share come from the legs where they are', () => {
  // the A321 at −8° and 0.8: the leg comes 0.79 m forward, nearer the CG: the nose wheel carries less, the tail strikes sooner
  const B = designNumbers(designDef(newDesign('a321neo', { id: 'gfw-n-base' }))), D = designNumbers(design('a321neo', { chord: 0.8, sweep: -8 }));
  assert.ok(D.airframe.noseLoad < B.airframe.noseLoad - 0.02, `the nose wheel's share ${D.airframe.noseLoad.toFixed(3)} (base ${B.airframe.noseLoad.toFixed(3)})`);
  assert.ok(D.tailStrikeDeg < B.tailStrikeDeg - 0.2, `the tail strikes at ${D.tailStrikeDeg.toFixed(2)}° (base ${B.tailStrikeDeg.toFixed(2)}°)`);
  // a 777 with more sweep: the leg goes aft, the nose carries more than it did at the wing's root (v0.5.5: 5.3 %)
  const S = designNumbers(design('b777-300er', { sweep: 8 }));
  assert.ok(S.airframe.noseLoad > 0.065, `777 at +8°: ${S.airframe.noseLoad.toFixed(3)} on the nose wheel`);
  // two sides apart: the line through the legs where it crosses the centreline
  const A = design('b777-300er', { chord: 0.8 }, { sweep: 8 }), G = A.geo.GEAR;
  const x0 = G.left.x + ((G.right.x - G.left.x) * G.left.y) / (G.left.y - G.right.y);
  const t = A.geo.TAIL_STRIKE_POINT, B7 = typeById('b777-300er');
  const want = B7.data.PITCH_TAILSTRIKE_DEG + (Math.atan2(t.z - G.left.z, x0 - t.x) - Math.atan2(B7.geo.TAIL_STRIKE_POINT.z - B7.geo.GEAR.left.z, B7.geo.GEAR.left.x - B7.geo.TAIL_STRIKE_POINT.x)) * 180 / Math.PI;
  assert.ok(near(A.data.PITCH_TAILSTRIKE_DEG, want, 1e-9), `uneven legs: the tail strike about their line (${A.data.PITCH_TAILSTRIKE_DEG.toFixed(3)}°)`);
});

test('a wing engine keeps clear of the leg where it is now', () => {
  const D = design('a321neo', { span: 1.3 }), yLeg = D.geo.GEAR.left.y;
  const [lo] = stationRange('a321neo', 'leap-1a', D.design.airframe, 1), [lo0] = stationRange('a321neo', 'leap-1a');
  // on the base the nearest station is pushed out past the leg by half a nacelle and 0.3 m; on the longer wing past the
  // leg where it is now, by the same
  const clear = lo0 - A321_GEAR.left.y;
  assert.ok(clear > 1 && near(lo, yLeg + clear, 1e-9), `the range starts at ${lo.toFixed(2)}, ${clear.toFixed(2)} m out from the leg at ${yLeg.toFixed(2)} (the base's ${lo0.toFixed(2)})`);
});

// The inner flap's front and its depth at a span: the sections themselves (not the end caps and slivers between the
// pieces), between the two either side.
function flapAt(m, bone, y) {
  const g = m.mesh.geometry, p = g.attributes.position, si = g.attributes.skinIndex;
  const idx = m.mesh.skeleton.bones.findIndex((b) => b.name === bone), rows = new Map();
  for (let i = 0; i < p.count; i++) {
    if (si.getX(i) !== idx) continue;
    const x = -p.getZ(i), yy = Math.abs(-p.getX(i)), k = Math.round(yy * 20);
    const r = rows.get(k) || { y: 0, n: 0, x: -Infinity, a: Infinity };
    r.y += yy; r.n++; r.x = Math.max(r.x, x); r.a = Math.min(r.a, x); rows.set(k, r);
  }
  let st = [...rows.values()].map((r) => ({ y: r.y / r.n, x: r.x, a: r.a })).sort((a, b) => a.y - b.y);
  const med = st.map((q) => q.x - q.a).sort((u, v) => u - v)[Math.floor(st.length / 2)];
  st = st.filter((q) => q.x - q.a > 0.6 * med);
  const i = st.findIndex((q, j) => j + 1 < st.length && y >= q.y && y <= st[j + 1].y);
  assert.ok(i >= 0, `the span ${y.toFixed(2)} is within the flap's`);
  const a = st[i], b = st[i + 1], u = (y - a.y) / (b.y - a.y);
  return { front: a.x + (b.x - a.x) * u, depth: a.x - a.a + (b.x - a.x - b.a + a.a) * u };
}
const MODELS = {
  'a321neo': { build: (def) => createAircraft(def ? { def } : {}), r: 0.15 },
  'b787-9': { build: (def) => createWidebody(B787_9, def ? { def } : {}), r: 0.2 },
  'b777-300er': { build: (def) => createWidebody(B777_300ER, def ? { def } : {}), r: 0.2 },
};
for (const [base, wl] of [['a321neo', { chord: 0.8, sweep: -8 }], ['a321neo', { span: 1.3, chord: 0.8, sweep: 8, dihedral: 8 }], ['b787-9', { chord: 0.8 }], ['b777-300er', { chord: 0.8 }], ['b777-300er', { sweep: 8 }]]) {
  test(`${base} ${JSON.stringify(wl)}: the legs stand where the sim has them, and the inner flaps keep most of their depth behind them`, () => {
    const { build, r } = MODELS[base], D = design(base, wl), m = build(D), G = D.geo.GEAR, k = D.design.airframe.wingL.chord;
    const G0 = typeById(base).geo.GEAR, b0 = build(null), M = airframeMap(base, D.design.airframe);
    for (const [S, g, g0, side] of [['L', G.left, G0.left, 1], ['R', G.right, G0.right, -1]]) {
      const pv = m.bones['mainLeg' + S].userData.pivot, pv0 = b0.bones['mainLeg' + S].userData.pivot;
      assert.ok(near(-pv.z, g.x, 1e-6) && near(-pv.x, g.y, 1e-6), `mainLeg${S} at the design's gear`);
      // its top rides the wing: the base's top through the side's map
      assert.ok(near(pv.y, M.wing(side, g0.x, g0.y, pv0.y)[2], 1e-6), `mainLeg${S}'s top in the wing (${pv.y.toFixed(3)})`);
      const yl = Math.abs(g.y), yl0 = Math.abs(g0.y);
      const f = flapAt(m, 'flapIn' + S, yl), f0 = flapAt(b0, 'flapIn' + S, yl0);
      for (const dy of [-r, 0, r]) {
        const q = flapAt(m, 'flapIn' + S, yl + dy);
        assert.ok(q.front < g.x - r - 0.03, `flapIn${S} at ${(yl + dy).toFixed(2)}: its front ${q.front.toFixed(3)} behind the leg (${g.x.toFixed(3)}, r ${r})`);
      }
      assert.ok(f.depth > 0.6 * k * f0.depth, `flapIn${S}: ${f.depth.toFixed(2)} m deep at the leg (the base's ${f0.depth.toFixed(2)} × ${k})`);
    }
  });
}
