// The airports built near the camera (v0.6.0, briefs/V0-6-0.md "The airports are built near the camera").
//
// Eleven airports' meshes, lights, signs and traffic shouldn't all be resident. The airports are
// grouped into clusters (airports closer than CLUSTER_LINK_M are built together: Incheon-Gimpo,
// Pudong-Hongqiao, Haneda-Narita), and each cluster is
//   - queued for building when the camera comes within NEAR_M of any of its airports,
//   - built one step a frame (a step is one part of one airport: its runways, its aprons, its
//     taxiway lights, or the cluster's traffic), so a long build is spread over a few frames,
//   - built at once, in the frame, if the camera is within URGENT_M of it and it isn't complete
//     (a new flight, a loaded scenario or a jump put it there: it's built before the first frame
//     that shows it; nothing of an airport is drawn beyond 80 km), and by ensureNear(x, y),
//   - released (every part disposed) when the camera is beyond FAR_M of all of its airports.
//
// This file is the pure logic, with no three.js: world.js gives it the steps (functions that
// build one part and return a handle with dispose()). tests/airport-set.test.mjs checks it.

export const NEAR_M = 200000;
export const FAR_M = 400000;
export const URGENT_M = 100000;
export const CLUSTER_LINK_M = 80000;
export const FRAME_BUDGET_MS = 4;   // the queue's slices a frame: until this much time is spent (at least one)

const originOf = (a) => (a && a.origin ? { x: a.origin[0], y: a.origin[1] } : { x: a?.x || 0, y: a?.y || 0 });

// Airports into clusters: single-link, any two closer than linkM end up together. Each cluster
// keeps its airports in their list order, and the clusters are ordered by their first airport.
export function clusterAirports(airports, linkM = CLUSTER_LINK_M) {
  const list = (airports || []).filter(Boolean);
  const parent = list.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const pts = list.map(originOf);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < linkM) {
        const a = find(i), b = find(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const byRoot = new Map();
  list.forEach((a, i) => {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(i);
  });
  return [...byRoot.values()].sort((p, q) => p[0] - q[0]).map((idx) => ({
    id: idx.map((i) => list[i].icao).join('+'),
    icaos: idx.map((i) => list[i].icao),
    airports: idx.map((i) => list[i]),
    points: idx.map((i) => pts[i]),
  }));
}

// The camera's horizontal distance to a cluster: to its nearest airport's origin.
export function clusterDistance(c, x, y) {
  let d = Infinity;
  for (const p of c.points) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
  return d;
}

// What should change for a camera at (x, y): the clusters to start building (not resident and
// within near) and the ones to release (resident, or building, and beyond far). Between near
// and far nothing changes (the hysteresis).
export function planSet(clusters, resident, x, y, { near = NEAR_M, far = FAR_M } = {}) {
  const build = [], release = [];
  for (const c of clusters) {
    const d = clusterDistance(c, x, y), has = resident.has(c.id);
    if (!has && d < near) build.push(c.id);
    else if (has && d > far) release.push(c.id);
  }
  return { build, release };
}

// A step's run() returns MORE (or any { more: true, label }) when it has more to do (a part built in slices, one a frame): it
// stays at the head of its cluster's steps and runs again next time.
export const MORE = Object.freeze({ more: true });

// The manager. makeSteps(cluster) -> [{ name, run() -> handle | null | MORE }], each handle
// { dispose() }; now() a clock in ms (performance.now in the browser).
export function createAirportSet({ clusters, makeSteps, near = NEAR_M, far = FAR_M, urgent = URGENT_M,
  budgetMs = FRAME_BUDGET_MS, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), onBuilt = null, onReleased = null } = {}) {
  const entries = new Map();   // id -> { cluster, pending: steps, parts: [{ name, handle, ms }], t0, ms }
  const byId = new Map(clusters.map((c) => [c.id, c]));
  const queue = [];            // ids waiting for their next step, oldest first
  const log = [];              // { id, event: 'built' | 'released', ms?, parts? }
  let builds = 0, releases = 0;

  function begin(id) {
    if (entries.has(id)) return entries.get(id);
    const cluster = byId.get(id);
    const e = { cluster, pending: makeSteps(cluster).slice(), parts: [], ms: 0, done: false };
    entries.set(id, e);
    queue.push(id);
    return e;
  }
  function step(e, urgent = false) {
    const s = e.pending[0];
    const t0 = now();
    const handle = s.run({ urgent });
    const ms = now() - t0;
    e.ms += ms;
    e.slices = (e.slices || 0) + 1;
    e.worstSlice = Math.max(e.worstSlice || 0, ms);
    s.ms = (s.ms || 0) + ms;
    const more = handle === MORE || !!(handle && handle.more);
    if (ms > 8) (e.slow || (e.slow = [])).push(`${s.name}${more && handle.label ? ` (${handle.label})` : ''} ${ms.toFixed(1)}`);
    if (ms >= (e.worstSlice || 0) - 1e-9) e.worstSliceName = `${s.name}${more && handle.label ? ` (${handle.label})` : ''}`;
    if (more) return;
    e.pending.shift();
    e.parts.push({ name: s.name, handle: handle || null, ms: s.ms });
    if (!e.pending.length) {
      e.done = true;
      builds++;
      const i = queue.indexOf(e.cluster.id);
      if (i >= 0) queue.splice(i, 1);
      const rec = { id: e.cluster.id, event: 'built', ms: e.ms, slices: e.slices, worstSlice: e.worstSlice, worstSliceName: e.worstSliceName, slow: e.slow || [], parts: e.parts.map((p) => ({ name: p.name, ms: p.ms })) };
      log.push(rec);
      onBuilt?.(e.cluster, rec);
    }
  }
  function finish(e) { while (!e.done) step(e, true); }
  function release(id) {
    const e = entries.get(id);
    if (!e) return;
    for (const p of e.parts) p.handle?.dispose?.();
    for (const s of e.pending) s.cancel?.();   // a part half built (MORE) drops what it made
    entries.delete(id);
    const i = queue.indexOf(id);
    if (i >= 0) queue.splice(i, 1);
    releases++;
    log.push({ id, event: 'released' });
    onReleased?.(e.cluster);
  }

  return {
    clusters,
    log,
    // Each frame: plan, release what's far, finish what's urgent, and run the queue's slices for budgetMs.
    update(x, y, { maxSteps = Infinity } = {}) {
      const plan = planSet(clusters, entries, x, y, { near, far });
      for (const id of plan.release) release(id);
      for (const id of plan.build) begin(id);
      let ran = 0;
      for (const c of clusters) {
        const e = entries.get(c.id);
        if (e && !e.done && clusterDistance(c, x, y) < urgent) { ran += e.pending.length; finish(e); }
      }
      const t0 = now();
      for (let k = 0; k < maxSteps && queue.length && (k === 0 || now() - t0 < budgetMs); k++) { step(entries.get(queue[0])); ran++; }
      return { built: plan.build, released: plan.release, steps: ran };
    },
    // Build every cluster within near of (x, y) now (a new flight, a scenario, a jump).
    ensureNear(x, y, radius = near) {
      const out = [];
      for (const c of clusters) {
        if (clusterDistance(c, x, y) >= radius) continue;
        finish(begin(c.id));
        out.push(c.id);
      }
      return out;
    },
    release,
    releaseAll() { for (const id of [...entries.keys()]) release(id); },
    // ids with every part built / still building.
    built: () => [...entries.values()].filter((e) => e.done).map((e) => e.cluster.id),
    building: () => [...entries.values()].filter((e) => !e.done).map((e) => e.cluster.id),
    isBuilt: (id) => !!entries.get(id)?.done,
    entry: (id) => entries.get(id) || null,
    entries: () => [...entries.values()],
    clusterOf: (icao) => clusters.find((c) => c.icaos.includes(icao)) || null,
    counts: () => ({ builds, releases, resident: entries.size }),
  };
}

// For a builder in slices: tick() is true once SLICE_MS have passed since the slice began (the
// first tick after a yield starts the next one), so a long loop can yield inside itself:
//   const tick = sliceTimer();  for (...) { ...; if (tick()) yield 'label'; }
// It only decides where the work pauses, never what it makes.
export const SLICE_MS = 4;
export function sliceTimer(ms = SLICE_MS) {
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let t0 = null;
  return () => {
    const t = clock();
    if (t0 === null) { t0 = t; return false; }
    if (t - t0 < ms) return false;
    t0 = null;
    return true;
  };
}

// For a builder in slices: the airport's preparation from the worker (world.js). pre: { get(icao) ->
// { state: 'pending' | 'ready' | 'failed', value }, urgent() -> bool } or null. Yields while it's
// pending; returns its value, or null (no worker, it failed, or the build is urgent: the builder then
// computes the same on the main thread).
export function* awaitPrep(pre, icao) {
  if (!pre) return null;
  for (;;) {
    const r = pre.get(icao);
    if (!r || r.state === 'failed') return null;
    if (r.state === 'ready') return r.value;
    if (pre.urgent()) return null;
    yield 'waiting for the worker';
  }
}
