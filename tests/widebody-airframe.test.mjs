// v0.5.3: the Boeings' models follow a design's airframe (src/widebody.js through def.geo.AIRFRAME,
// src/sim/airframe-map.js): the wing's span, chord, sweep and dihedral, the tailplane and fin scaled, the fuselage's
// plugs with the windows repeated at the type's pitch, the wing bend over the new span, the gear and the cockpit.
// Built in node with a stand-in canvas for the livery (its pixels don't matter here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';

const noop = () => ({ addColorStop() {} });
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const { createWidebody, plugPlan } = await import('../src/widebody.js');
const { B787_9, B777_300ER } = await import('../src/widebody-specs.js');
const { newDesign, defaultAirframe, designDef } = await import('../src/sim/designs.js');
const { curve } = await import('../src/widebody-shape.js');
const { airframeMap } = await import('../src/sim/airframe-map.js');

const W = (span, chord, sweep, dihedral) => ({ span, chord, sweep, dihedral });
const designOf = (spec, o) => {
  const af0 = defaultAirframe(spec.id);
  const af = { ...af0, ...o, wingL: { ...af0.wingL, ...o.wingL } };
  af.wingR = o.mirror === false ? { ...af0.wingR, ...o.wingR } : { ...af.wingL };
  return designDef({ ...newDesign(spec.id), airframe: af });
};
const CASES = {
  brief: { tail: 1.6, fin: 0.6, plugFwd: 6, plugAft: -4, wingL: W(1.3, 0.8, 8, 8), mirror: true },
  small: { tail: 0.6, fin: 0.6, plugFwd: -4, plugAft: -4, wingL: W(0.8, 0.8, -8, -3), mirror: true },
  big: { tail: 1.6, fin: 1.6, plugFwd: 6, plugAft: 6, wingL: W(1.3, 1.3, 8, 8), mirror: true },
  asym: { tail: 1, fin: 1, plugFwd: 0, plugAft: 0, wingL: W(1.3, 1, 8, 8), wingR: W(0.8, 1.3, -8, -3), mirror: false },
};
// body frame from the model frame (X = −y, Y = z, Z = −x)
const body = (a, i) => [-a[i * 3 + 2], -a[i * 3], a[i * 3 + 1]];
function hash(m) {
  let h = 0x811c9dc5 >>> 0;
  const g = m.mesh.geometry;
  for (const k of Object.keys(g.attributes).sort()) {
    const a = g.attributes[k].array, u = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >> 2);
    for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0;
  }
  for (const v of g.index.array) h = Math.imul(h ^ v, 16777619) >>> 0;
  return h;
}
const extents = (m) => {
  const p = m.mesh.geometry.attributes.position.array, e = { x0: 1e9, x1: -1e9, yL: 0, yR: 0, z1: -1e9 };
  for (let i = 0; i < p.length / 3; i++) {
    const [x, y, z] = body(p, i);
    e.x0 = Math.min(e.x0, x); e.x1 = Math.max(e.x1, x); e.z1 = Math.max(e.z1, z);
    if (y > 0) e.yL = Math.max(e.yL, y); else e.yR = Math.max(e.yR, -y);
  }
  return e;
};

// Vertical lines through the design's wing planform (2 % to 98 % of the chord, or the front 45 % with the slats
// out, every 0.25 m of span): each must cross a triangle (tests/cloud/wing-gaps.cjs's idea, on the CPU).
function holes(m, def, side, pts, front) {
  const g = m.mesh.geometry, idx = g.index.array, n = pts.length / 3, CELL = 0.5;
  const cells = new Map(), key = (i, j) => i * 100003 + j;
  const P = (k) => [-pts[k * 3 + 2], -pts[k * 3]];
  for (let t = 0; t < idx.length; t += 3) {
    const a = P(idx[t]), b = P(idx[t + 1]), c = P(idx[t + 2]);
    if (Math.sign(a[1]) !== side && Math.abs(a[1]) > 0.5) continue;
    const i0 = Math.floor(Math.min(a[0], b[0], c[0]) / CELL), i1 = Math.floor(Math.max(a[0], b[0], c[0]) / CELL);
    const j0 = Math.floor(Math.min(a[1], b[1], c[1]) / CELL), j1 = Math.floor(Math.max(a[1], b[1], c[1]) / CELL);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) continue;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(a, b, c); }
  }
  const inTri = (x, y, a, b, c) => {
    const d1 = (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (y - b[1]);
    const d2 = (x - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (y - c[1]);
    const d3 = (x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  void n;
  const M = def.geo.AIRFRAME || airframeMap(def.id, null), spec = def.id === 'b787-9' ? B787_9 : B777_300ER, G = spec.geo;
  // the planform as the model draws it: straight between the wing's stations (the curves bulge past it at the rake)
  const lec = curve(spec.wing.le), tec = curve(spec.wing.te), ys = G.FUSELAGE_WIDTH / 2, tip = G.SPAN / 2;
  const st = spec.wing.stations;
  const lin = (fn) => (y) => { let k = 0; while (k < st.length - 2 && y > st[k + 1]) k++; const t = (y - st[k]) / (st[k + 1] - st[k]); return fn(st[k]) + (fn(st[k + 1]) - fn(st[k])) * t; };
  const le = lin(lec), te = lin(tec);
  const found = [];
  for (let yb = ys + 0.3; yb < tip - 0.3; yb += 0.25) {
    const xl = M.wing(side, le(yb), side * yb, 0), xt = M.wing(side, te(yb), side * yb, 0);
    for (let f = front ? 0.1 : 0.02; f <= (front ? 0.45 : 0.98); f += 0.06) {
      const x = xl[0] + (xt[0] - xl[0]) * f, y = xl[1];
      const list = cells.get(key(Math.floor(x / 0.5), Math.floor(y / 0.5))) || [];
      let hit = false;
      for (let k = 0; k < list.length && !hit; k += 3) hit = inTri(x, y, list[k], list[k + 1], list[k + 2]);
      if (!hit) found.push([+x.toFixed(2), +y.toFixed(2), +f.toFixed(2)]);
    }
  }
  return found;
}

for (const spec of [B787_9, B777_300ER]) {
  test(`${spec.id}: a design on its base's airframe builds the type's model, vertex for vertex`, () => {
    const a = createWidebody(spec), b = createWidebody(spec, { def: designDef(newDesign(spec.id)) });
    assert.equal(hash(a), hash(b));
    assert.equal(a.triangles, b.triangles);
  });

  for (const [name, o] of Object.entries(CASES)) {
    test(`${spec.id} ${name}: the model's extents are the design's`, () => {
      const def = designOf(spec, o), M = def.geo.AIRFRAME, m = createWidebody(spec, { def }), G = spec.geo;
      const p = m.mesh.geometry.attributes.position.array;
      assert.ok(p.every(Number.isFinite), 'every vertex finite');
      const e = extents(m);
      assert.ok(Math.abs(e.x1 - M.bodyX(G.NOSE_X)) < 0.03, `nose at ${e.x1.toFixed(2)}, the design's ${M.bodyX(G.NOSE_X).toFixed(2)}`);
      // the tips: the parts' tip (G.SPAN / 2 through the map), the raked tip drawn to it
      assert.ok(Math.abs(e.yL - M.tipY[0]) < 0.08, `left tip ${e.yL.toFixed(2)} against ${M.tipY[0].toFixed(2)}`);
      assert.ok(Math.abs(e.yR - M.tipY[1]) < 0.08, `right tip ${e.yR.toFixed(2)} against ${M.tipY[1].toFixed(2)}`);
      // the fin's top: the base's through the fin's map
      const ft = M.fin(G.FIN.topTeX, 0, G.FIN.topZ)[2];
      assert.ok(Math.abs(e.z1 - ft) < 0.3, `fin top ${e.z1.toFixed(2)} against ${ft.toFixed(2)}`);
      // the tail cone's end moved back with the aft plug
      assert.ok(e.x0 <= M.bodyX(G.FUSELAGE_TAIL_X) + 0.01, 'nothing ends ahead of the tail cone');
    });

    test(`${spec.id} ${name}: no light through the wing, stowed and with the slats out`, () => {
      const def = designOf(spec, o), m = createWidebody(spec, { def });
      const rest = m.mesh.geometry.attributes.position.array;
      for (const side of [1, -1]) {
        const h = holes(m, def, side, rest, false);
        assert.equal(h.length, 0, `stowed, side ${side}: ${JSON.stringify(h.slice(0, 6))}`);
      }
      m.update({ slatDeg: 30, flapDeg: 30, gearPos: 1 }, 0);
      m.object.updateMatrixWorld(true);
      m.mesh.skeleton.update();
      const n = rest.length / 3, sk = new Float32Array(n * 3), v = new THREE.Vector3();
      for (let i = 0; i < n; i++) { m.mesh.getVertexPosition(i, v); sk[i * 3] = v.x; sk[i * 3 + 1] = v.y; sk[i * 3 + 2] = v.z; }
      for (const side of [1, -1]) {
        const h = holes(m, def, side, sk, true);
        assert.equal(h.length, 0, `landing, side ${side}: ${JSON.stringify(h.slice(0, 6))}`);
      }
    });

    test(`${spec.id} ${name}: the bend covers the design's span; the tailplane doesn't bend`, () => {
      const def = designOf(spec, o), M = def.geo.AIRFRAME, m = createWidebody(spec, { def }), G = spec.geo;
      const g = m.mesh.geometry, p = g.attributes.position.array, bend = g.attributes.bendY.array, tip = G.SPAN / 2;
      const tailX = M.tail(G.TAILPLANE.rootLeX, 2, G.TAILPLANE.z)[0] + 0.5, tailY = M.tail(G.TAILPLANE.tipTeX, G.TAILPLANE.span / 2, G.TAILPLANE.z)[1] + 0.3;
      let maxL = 0, maxR = 0;
      for (let i = 0; i < bend.length; i++) {
        const [x, y] = body(p, i);
        if (x < tailX && Math.abs(y) > G.FUSELAGE_WIDTH / 2 + 0.1 && Math.abs(y) < tailY) assert.equal(bend[i], 0, `a tailplane vertex at ${x.toFixed(1)}, ${y.toFixed(1)} bends`);
        if (y > 0) maxL = Math.max(maxL, bend[i]); else maxR = Math.max(maxR, bend[i]);
        assert.ok(bend[i] <= tip + 0.05, `bendY ${bend[i]} past the base's tip`);
      }
      // each tip vertex rides the whole bend: its bendY is the base's tip
      assert.ok(maxL > tip - 0.3 && maxR > tip - 0.3, `the tips' bendY ${maxL.toFixed(2)}, ${maxR.toFixed(2)} of ${tip}`);
      // the nav lights move with the bend
      m.setWingFlex(3);
      const lp = m.object.children[1].geometry.getAttribute('position');
      let rose = 0;
      for (let i = 0; i < lp.count; i++) if (Math.abs(lp.getX(i)) > M.tipY[0] - 1.5 || Math.abs(lp.getX(i)) > M.tipY[1] - 1.5) rose++;
      assert.ok(rose >= 2, 'the tip lamps are at the tips');
    });

    test(`${spec.id} ${name}: windows repeat at the pitch, the gear and the cockpit follow`, () => {
      const def = designOf(spec, o), M = def.geo.AIRFRAME, m = createWidebody(spec, { def }), G = spec.geo;
      const plan = plugPlan(spec, M), p = spec.cabin.window.pitch;
      const ws = plan.windows;
      for (let i = 1; i < ws.length; i++) assert.ok(ws[i - 1] - ws[i] > p - 1e-6, `windows ${ws[i - 1].toFixed(2)} and ${ws[i].toFixed(2)} closer than the pitch`);
      for (const r of plan.regions) for (let x = r.lo + 0.01; x < r.hi; x += 0.05) {
        const t = plan.texX(x);
        assert.ok(t >= plan.band - 1e-9 && t <= plan.band + p + 1e-9, `the plug at ${x.toFixed(2)} reads the atlas at ${t.toFixed(2)}`);
      }
      // the doors stay drawn where they moved to, with no window over them
      for (const d of spec.cabin.doors) {
        const xD = M.bodyX(G.NOSE_X - d);
        assert.ok(Math.abs(plan.texX(xD) - (G.NOSE_X - d)) < 1e-6, `door at ${d} m isn't drawn at ${xD.toFixed(2)}`);
        for (const w of ws) assert.ok(Math.abs(w - xD) > spec.cabin.doorW / 2 + spec.cabin.window.w / 2, `a window at ${w.toFixed(2)} over the door at ${xD.toFixed(2)}`);
      }
      const base = plugPlan(spec, { ...M, cuts: M.cuts, plugFwd: 0, plugAft: 0, bodyX: (x) => x }).windows.length;
      const extra = Math.round((M.plugFwd + M.plugAft) / p);
      assert.ok(Math.abs(ws.length - base - extra) <= 3, `${ws.length} windows a side, the base's ${base}, plugs worth ${extra}`);
      // the nose gear at the design's, the main legs where they were
      const nose = m.bones.noseLeg.userData.pivot, legL = m.bones.mainLegL.userData.pivot;
      assert.ok(Math.abs(-nose.z - def.geo.GEAR.nose.x) < 1e-6, 'nose leg at GEAR.nose.x');
      assert.ok(Math.abs(-legL.z - def.geo.GEAR.left.x) < 1e-6 && Math.abs(-legL.x - def.geo.GEAR.left.y) < 1e-6, 'main leg where it was');
      // the eye inside the design's skin, and the cockpit carried forward with it
      const E = def.geo.EYES.captain, s = m.shape.fuseSection(E.x);
      assert.ok(Math.hypot(E.y / s.hw, (E.z - s.zc) / (E.z > s.zc ? s.up : s.down)) < 0.9, 'the eye is inside the skin');
      assert.ok(Math.abs(m.shape.fuseSection(E.x).hw - createWidebody(spec).shape.fuseSection(G.EYES.captain.x).hw) < 1e-9, 'the same section round the eye');
      const ck = new THREE.Group(); ck.name = 'cockpit';
      m.object.add(ck);
      assert.ok(Math.abs(-ck.position.z - M.plugFwd) < 1e-9, `the cockpit moved ${-ck.position.z} m`);
    });
  }
}

test('plugPlan: a plug of a whole number of pitches reads whole windows', () => {
  for (const spec of [B787_9, B777_300ER]) {
    const def = designOf(spec, { plugFwd: 6, plugAft: 6, tail: 1, fin: 1, wingL: W(1, 1, 0, defaultAirframe(spec.id).wingL.dihedral), mirror: true });
    const plan = plugPlan(spec, def.geo.AIRFRAME);
    assert.equal(plan.regions.length, 2);
    for (const r of plan.regions) assert.ok(r.n >= 9 && r.fill >= 0 && r.fill < spec.cabin.window.pitch, JSON.stringify(r));
  }
});
