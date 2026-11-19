// v0.6.0: the airports built near the camera (src/world/airport-set.js), the pure logic:
// the clusters, which are built along a camera path, the hysteresis, nothing built twice,
// everything released. Run: node --test tests/airport-set.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clusterAirports, clusterDistance, planSet, createAirportSet, NEAR_M, FAR_M, URGENT_M } from '../src/world/airport-set.js';

const ICAOS = ['RKSS', 'RKPC', 'RKSI', 'ZSPD', 'RJTT', 'RJAA', 'RKPK', 'ZSSS', 'RJBB', 'RJFF', 'ZSQD'];
const AIRPORTS = ICAOS.map((icao) => {
  const a = JSON.parse(readFileSync(new URL(`../data/airports/${icao}.json`, import.meta.url)));
  return { icao, origin: a.origin };
});
const at = (icao) => { const a = AIRPORTS.find((p) => p.icao === icao); return { x: a.origin[0], y: a.origin[1] }; };

test('clusters: the close pairs go together, the rest alone', () => {
  const cs = clusterAirports(AIRPORTS);
  const ids = cs.map((c) => c.id);
  assert.deepEqual(ids, ['RKSS+RKSI', 'RKPC', 'ZSPD+ZSSS', 'RJTT+RJAA', 'RKPK', 'RJBB', 'RJFF', 'ZSQD']);
  // Korea's three alone: Gimpo and Incheon together, Jeju alone.
  assert.deepEqual(clusterAirports(AIRPORTS.slice(0, 3)).map((c) => c.id), ['RKSS+RKSI', 'RKPC']);
  assert.equal(clusterAirports([]).length, 0);
});

test('planSet: build inside near, release beyond far, nothing between', () => {
  const cs = clusterAirports(AIRPORTS);
  const g = at('RKSS');
  const none = new Map();
  const p0 = planSet(cs, none, g.x, g.y);
  assert.deepEqual(p0.build, ['RKSS+RKSI']);
  assert.deepEqual(p0.release, []);
  // Resident Gimpo, camera 300 km away (between near and far): kept.
  const res = new Map([['RKSS+RKSI', {}]]);
  const p1 = planSet(cs, res, g.x + 300000, g.y);
  assert.ok(!p1.release.includes('RKSS+RKSI'));
  assert.ok(!p1.build.includes('RKSS+RKSI'));
  const p2 = planSet(cs, res, g.x + 450000, g.y + 400000);
  assert.ok(p2.release.includes('RKSS+RKSI'));
  assert.ok(clusterDistance(cs[0], g.x, g.y) === 0);
});

// A fake world: each step "builds" a part with a counter of live resources.
function fakeSet(opts = {}) {
  const live = new Map();   // part key -> count of builds alive
  let alive = 0, made = 0;
  const makeSteps = (c) => [
    ...c.airports.flatMap((a) => ['runways', 'aprons', 'taxiLights'].map((k) => ({ name: `${k}:${a.icao}`, run: () => part(`${k}:${a.icao}`) }))),
    { name: `traffic:${c.id}`, run: () => part(`traffic:${c.id}`) },
  ];
  function part(key) {
    live.set(key, (live.get(key) || 0) + 1);
    alive++; made++;
    let disposed = false;
    return { dispose() { assert.ok(!disposed, `${key} disposed twice`); disposed = true; live.set(key, live.get(key) - 1); alive--; } };
  }
  const clusters = clusterAirports(AIRPORTS);
  const set = createAirportSet({ clusters, makeSteps, budgetMs: 0, ...opts });
  return { set, live, stats: () => ({ alive, made }) };
}

// A path of points between airports, `step` metres apart.
function path(stops, step = 5000) {
  const out = [];
  for (let k = 0; k + 1 < stops.length; k++) {
    const a = stops[k], b = stops[k + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let i = 0; i < n; i++) out.push({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n });
  }
  out.push(stops[stops.length - 1]);
  return out;
}

test('a flight Gimpo - Haneda - Pudong - Gimpo: built near, released far, never twice at once', () => {
  const { set, live, stats } = fakeSet();
  const route = path([at('RKSS'), at('RJTT'), at('ZSPD'), at('RKSS')]);
  const seen = new Set();
  for (const p of route) {
    set.update(p.x, p.y);
    for (const v of live.values()) assert.ok(v <= 1, 'a part built twice');
    // Every cluster within the urgent radius is complete; none beyond far is resident.
    for (const c of set.clusters) {
      const d = clusterDistance(c, p.x, p.y);
      if (d < URGENT_M) assert.ok(set.isBuilt(c.id), `${c.id} not built at ${(d / 1000).toFixed(0)} km`);
      if (d > FAR_M) assert.ok(!set.entry(c.id), `${c.id} resident at ${(d / 1000).toFixed(0)} km`);
    }
    for (const id of set.built()) seen.add(id);
  }
  // On the way: Gimpo/Incheon, Gimhae and Fukuoka (the line to Haneda passes them), Kansai, Haneda/Narita, Pudong/Hongqiao.
  for (const id of ['RKSS+RKSI', 'RJTT+RJAA', 'ZSPD+ZSSS', 'RJBB']) assert.ok(seen.has(id), `${id} never built`);
  // Back at Gimpo: Gimpo built, Haneda and Pudong released.
  assert.ok(set.isBuilt('RKSS+RKSI'));
  assert.ok(!set.entry('RJTT+RJAA'));
  set.releaseAll();
  assert.equal(stats().alive, 0, 'everything released');
  assert.equal(set.counts().resident, 0);
});

test('hysteresis: oscillating at 300 km builds and releases nothing', () => {
  const { set, stats } = fakeSet();
  const g = at('RKSS');
  set.ensureNear(g.x, g.y);
  const made = stats().made;
  for (let i = 0; i < 200; i++) set.update(g.x + 250000 + (i % 2) * 120000, g.y);
  assert.equal(stats().made, made);
  assert.ok(set.isBuilt('RKSS+RKSI'));
});

test('steps: one per frame from far, everything at once when urgent', () => {
  const { set } = fakeSet();
  const h = at('RJTT');
  // 190 km out: queued, one step per frame (Haneda + Narita: 2 x 3 parts + traffic = 7 steps).
  const r = set.update(h.x - 190000, h.y);
  assert.deepEqual(r.built, ['RJTT+RJAA']);
  assert.equal(r.steps, 1);
  assert.ok(!set.isBuilt('RJTT+RJAA'));
  for (let i = 0; i < 6; i++) set.update(h.x - 190000, h.y);
  assert.ok(set.isBuilt('RJTT+RJAA'));
  const e = set.entry('RJTT+RJAA');
  assert.deepEqual(e.parts.map((p) => p.name), ['runways:RJTT', 'aprons:RJTT', 'taxiLights:RJTT', 'runways:RJAA', 'aprons:RJAA', 'taxiLights:RJAA', 'traffic:RJTT+RJAA']);
  // A jump straight onto Pudong: complete in that one frame.
  const p = at('ZSPD');
  set.update(p.x, p.y);
  assert.ok(set.isBuilt('ZSPD+ZSSS'));
  assert.ok(!set.entry('RJTT+RJAA'), 'Haneda released after the jump (1,650 km)');
});

test('release mid-build disposes the parts already built', () => {
  const { set, stats } = fakeSet();
  const h = at('RJTT');
  set.update(h.x - 190000, h.y);
  set.update(h.x - 190000, h.y);
  assert.equal(stats().alive, 2);
  set.update(h.x, h.y + 2000000);   // far from every airport
  assert.equal(stats().alive, 0);
  assert.equal(set.counts().resident, 0);
});

test('ensureNear builds what is in reach and returns it; a second call builds nothing', () => {
  const { set, stats } = fakeSet();
  const k = at('RJBB');
  assert.deepEqual(set.ensureNear(k.x, k.y), ['RJBB']);
  const made = stats().made;
  assert.deepEqual(set.ensureNear(k.x, k.y), ['RJBB']);
  assert.equal(stats().made, made);
  assert.ok(NEAR_M < FAR_M && URGENT_M < NEAR_M);
});

test('a part in slices (MORE) runs one slice a frame; a release mid-part cancels it', async () => {
  const { MORE } = await import('../src/world/airport-set.js');
  let slices = 0, cancelled = 0, disposed = 0;
  const makeSteps = () => [{
    name: 'sliced',
    run() { slices++; return slices % 3 ? MORE : { dispose() { disposed++; } }; },
    cancel() { cancelled++; },
  }];
  const clusters = clusterAirports(AIRPORTS);
  const set = createAirportSet({ clusters, makeSteps, budgetMs: 0 });
  const h = at('RJBB');
  set.update(h.x - 190000, h.y);
  set.update(h.x - 190000, h.y);
  assert.ok(!set.isBuilt('RJBB'));
  set.update(h.x - 190000, h.y);
  assert.ok(set.isBuilt('RJBB'));
  assert.equal(slices, 3);
  const rec = set.log.find((r) => r.event === 'built');
  assert.equal(rec.slices, 3);
  set.update(h.x, h.y + 2000000);
  assert.equal(disposed, 1);
  // Half built, then released: cancelled, nothing disposed twice.
  set.update(h.x - 190000, h.y);
  set.update(h.x, h.y + 2000000);
  assert.equal(cancelled, 1);
  assert.equal(disposed, 1);
  // Urgent: every slice in the one frame.
  slices = 0;
  set.update(h.x, h.y);
  assert.ok(set.isBuilt('RJBB'));
  assert.equal(slices, 3);
});

test('the frame budget: slices run until it is spent', () => {
  let t = 0;
  const makeSteps = (c) => Array.from({ length: 10 }, (_, i) => ({ name: `s${i}`, run() { t += 2; return { dispose() {} }; } }));
  const set = createAirportSet({ clusters: clusterAirports(AIRPORTS), makeSteps, budgetMs: 6, now: () => t });
  const h = at('RJBB');
  const r = set.update(h.x - 190000, h.y);
  assert.equal(r.steps, 3);   // 0, 2, 4 ms spent before each: three slices
  assert.ok(!set.isBuilt('RJBB'));
});
