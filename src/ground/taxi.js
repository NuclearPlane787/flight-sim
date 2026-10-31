// Taxi graph and routing for gate starts (PLAN.md → Airports → Gate starts).
// Pure ES module: no DOM, no three.js, worker-safe.
//
// The graph is built from airport.taxiways (polylines in map metres with a
// `ref` letter). Polylines are split where they cross, and where an end comes
// within SNAP_M of another polyline; points within SNAP_M of each other are
// merged into one node. Edges that cross a runway are marked, and holding
// positions are inserted as nodes with `hold` set.
//
// Runways join the graph too, so a route can cross or backtrack one where the
// taxiways meet only across its pavement (Jeju 13/31): each runway gets a
// centreline chain of edges (`axis`), joined to every taxiway that crosses it and
// to every taxiway end that stops at its edge. Entering and leaving a runway costs
// RUNWAY_CROSS_PENALTY in total; rolling along it costs double its length.

const SNAP_M = 15;            // join ends / crossings closer than this
const END_SNAP_M = 25;        // a polyline end this close to another polyline joins it (T-junction)
const RUNWAY_JOIN_M = 35;     // a taxiway end this far beyond a runway edge joins the runway
const AXIS_COST = 2;          // cost per metre of rolling along a runway centreline
const HOLD_SNAP_M = 60;       // a holding position farther than this from any taxiway is ignored
const RUNWAY_CROSS_PENALTY = 400; // metres added to an edge that crosses a runway (prefer not to)
const BRIDGE_M = 30;          // a piece of taxi line this close to the network, but not joined to it, gets a link

// ---- small geometry ----
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

// Closest point on segment a-b to p: { t, x, y, d }.
function project(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx, y = ay + t * dy;
  return { t, x, y, d: dist(px, py, x, y) };
}

// Proper intersection of segments p1-p2 and p3-p4: { t, u } or null.
function intersect(p1, p2, p3, p4) {
  const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const ex = p3[0] - p1[0], ey = p3[1] - p1[1];
  const t = (ex * d2y - ey * d2x) / den;
  const u = (ex * d1y - ey * d1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

// Runway as a rectangle: centre line between its two ends, half width.
function runwayRects(airport) {
  return (airport.runways || []).filter(r => r.ends && r.ends.length === 2).map(r => {
    const [a, b] = r.ends;
    const len = dist(a.x, a.y, b.x, b.y) || 1;
    return {
      id: r.id, ax: a.x, ay: a.y, bx: b.x, by: b.y, len,
      ux: (b.x - a.x) / len, uy: (b.y - a.y) / len,
      half: (r.widthM || 45) / 2,
      idents: r.ends.map(e => e.ident),
    };
  });
}

// Does segment p-q cross (enter) runway rectangle r? Sampled; edges are short.
function segmentHitsRunway(px, py, qx, qy, r) {
  const n = Math.max(2, Math.ceil(dist(px, py, qx, qy) / 5));
  for (let i = 0; i <= n; i++) {
    const s = i / n, x = px + s * (qx - px), y = py + s * (qy - py);
    const along = (x - r.ax) * r.ux + (y - r.ay) * r.uy;
    const across = -(x - r.ax) * r.uy + (y - r.ay) * r.ux;
    if (along >= 0 && along <= r.len && Math.abs(across) <= r.half) return true;
  }
  return false;
}

// ---- graph build ----

export function buildTaxiGraph(airport, opts = {}) {
  const snap = opts.snapM ?? SNAP_M;
  const lines = (airport.taxiways || [])
    .filter(t => t.points && t.points.length >= 2)
    .map(t => ({ ref: t.ref || '', widthM: t.widthM || 20, pts: t.points.map(p => [p[0], p[1]]) }));

  // 1. Split points per segment: cuts[li][si] = list of t in (0, 1).
  const cuts = lines.map(l => l.pts.slice(1).map(() => []));
  for (const l of lines) {   // bounding boxes, padded by `snap`, to skip far pairs
    const xs = l.pts.map(p => p[0]), ys = l.pts.map(p => p[1]);
    l.box = [Math.min(...xs) - snap, Math.min(...ys) - snap, Math.max(...xs) + snap, Math.max(...ys) + snap];
  }
  const near = (l, m) => l.box[0] <= m.box[2] && m.box[0] <= l.box[2] && l.box[1] <= m.box[3] && m.box[1] <= l.box[3];
  for (let a = 0; a < lines.length; a++) {
    const A = lines[a].pts;
    for (let b = a; b < lines.length; b++) {
      if (!near(lines[a], lines[b])) continue;
      const B = lines[b].pts;
      for (let i = 0; i < A.length - 1; i++) {
        for (let j = (a === b ? i + 2 : 0); j < B.length - 1; j++) {
          const hit = intersect(A[i], A[i + 1], B[j], B[j + 1]);
          if (hit) { cuts[a][i].push(hit.t); cuts[b][j].push(hit.u); }
        }
      }
    }
  }
  // Ends of a polyline that stop near another polyline (T-junctions).
  for (let a = 0; a < lines.length; a++) {
    for (const end of [lines[a].pts[0], lines[a].pts[lines[a].pts.length - 1]]) {
      for (let b = 0; b < lines.length; b++) {
        if (b === a || !near(lines[a], lines[b])) continue;
        const B = lines[b].pts;
        let best = null, bj = -1;
        for (let j = 0; j < B.length - 1; j++) {
          const p = project(end[0], end[1], B[j][0], B[j][1], B[j + 1][0], B[j + 1][1]);
          if (!best || p.d < best.d) { best = p; bj = j; }
        }
        if (best && best.d <= Math.max(snap, opts.endSnapM ?? END_SNAP_M)) {
          cuts[b][bj].push(best.t);
          // Pull the end onto the line (it becomes the junction node).
          if (best.d > snap) { end[0] = best.x; end[1] = best.y; }
        }
      }
    }
  }

  // 2. Nodes, merged within `snap` via a spatial hash.
  const nodes = [];
  const cell = snap;
  const hash = new Map();
  const key = (i, j) => i + ',' + j;
  function nodeAt(x, y) {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
    let best = -1, bd = snap;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const id of hash.get(key(ci + di, cj + dj)) || []) {
        const d = dist(x, y, nodes[id].x, nodes[id].y);
        if (d <= bd) { bd = d; best = id; }
      }
    }
    if (best >= 0) return best;
    const id = nodes.length;
    nodes.push({ id, x, y, edges: [], hold: null });
    const k = key(ci, cj);
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k).push(id);
    return id;
  }

  // 3. Edges along each polyline through its vertices and cuts.
  const edges = [];
  const edgeSet = new Set();
  const rects = runwayRects(airport);
  function addEdge(a, b, ref, widthM) {
    if (a === b) return;
    const k = a < b ? a + '-' + b : b + '-' + a;
    if (edgeSet.has(k)) return;
    edgeSet.add(k);
    const A = nodes[a], B = nodes[b];
    const lengthM = dist(A.x, A.y, B.x, B.y);
    let runway = null;
    for (const r of rects) if (segmentHitsRunway(A.x, A.y, B.x, B.y, r)) { runway = r.id; break; }
    const e = { id: edges.length, a, b, lengthM, ref, widthM, runway, pw: runway ? 1 : 0 };
    edges.push(e);
    A.edges.push(e); B.edges.push(e);
  }
  lines.forEach((l, li) => {
    let prev = nodeAt(l.pts[0][0], l.pts[0][1]);
    for (let si = 0; si < l.pts.length - 1; si++) {
      const p = l.pts[si], q = l.pts[si + 1];
      const ts = [...new Set(cuts[li][si])].filter(t => t > 0 && t < 1).sort((x, y) => x - y);
      for (const t of [...ts, 1]) {
        const id = nodeAt(p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]));
        addEdge(prev, id, l.ref, l.widthM);
        prev = id;
      }
    }
  });

  const graph = { nodes, edges, holds: [], runwayCrossings: [], rects };

  // 4. Holding positions: split the nearest edge and mark the new node.
  for (const hp of airport.holdingPositions || []) {
    const at = snapToGraph(graph, hp.x, hp.y);
    if (!at || at.d > HOLD_SNAP_M) continue;
    const id = splitAt(graph, at);
    nodes[id].hold = hp.ref || 'HOLD';
    graph.holds.push({ ref: hp.ref, node: id, x: nodes[id].x, y: nodes[id].y });
  }
  for (const r of rects) addRunwayAxis(graph, r);
  graph.bridges = bridgeIslands(graph);
  for (const e of edges) if (e.runway && !e.dead && !e.axis) {
    graph.runwayCrossings.push({ edge: e.id, runway: e.runway,
      x: (nodes[e.a].x + nodes[e.b].x) / 2, y: (nodes[e.a].y + nodes[e.b].y) / 2 });
  }
  return graph;
}

// Nearest point on the graph to (x, y): { edge, t (0 at edge.a), x, y, d }.
export function snapToGraph(graph, x, y) {
  let best = null;
  for (const e of graph.edges) {
    if (e.dead) continue;
    const A = graph.nodes[e.a], B = graph.nodes[e.b];
    const p = project(x, y, A.x, A.y, B.x, B.y);
    if (!best || p.d < best.d) best = { edge: e, t: p.t, x: p.x, y: p.y, d: p.d };
  }
  return best;
}

// Split an edge at an attachment, returning the node id there (reuses an end within 1 m).
function splitAt(graph, at) {
  const e = at.edge, { nodes, edges } = graph;
  if (at.t * e.lengthM < 1) return e.a;
  if ((1 - at.t) * e.lengthM < 1) return e.b;
  const id = nodes.length;
  nodes.push({ id, x: at.x, y: at.y, edges: [], hold: null });
  e.dead = true;
  nodes[e.a].edges = nodes[e.a].edges.filter(x => x !== e);
  nodes[e.b].edges = nodes[e.b].edges.filter(x => x !== e);
  for (const [a, b] of [[e.a, id], [id, e.b]]) {
    const n = { id: edges.length, a, b, lengthM: dist(nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y),
      ref: e.ref, widthM: e.widthM, runway: e.runway, axis: e.axis,
      pw: (e.pw || 0) * (a === e.a ? at.t : 1 - at.t) };   // the crossing penalty splits by length
    edges.push(n); nodes[a].edges.push(n); nodes[b].edges.push(n);
  }
  return id;
}

// ---- runways in the graph ----

// An edge between two existing nodes (used for the runway chains).
function link(graph, a, b, props) {
  if (a === b) return null;
  const { nodes, edges } = graph;
  if (nodes[a].edges.some(e => e.a === b || e.b === b)) return null;
  const e = { id: edges.length, a, b, lengthM: dist(nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y),
    ref: '', widthM: 45, runway: null, pw: 0, ...props };
  edges.push(e); nodes[a].edges.push(e); nodes[b].edges.push(e);
  return e;
}

// Runway r's centreline as a chain of `axis` edges, joined to the taxiways that cross
// it (split where they cross the centreline) and to taxiway ends that stop at its edge.
function addRunwayAxis(graph, r) {
  const { nodes, edges } = graph;
  const along = (x, y) => (x - r.ax) * r.ux + (y - r.ay) * r.uy;
  const across = (x, y) => -(x - r.ax) * r.uy + (y - r.ay) * r.ux;
  const axis = [];     // { s, id }, s = metres along from the first end
  const near = s => axis.find(n => Math.abs(n.s - s) < 5);
  function axisNode(s) {
    s = Math.max(0, Math.min(r.len, s));
    const n = near(s);
    if (n) return n.id;
    const id = nodes.length;
    nodes.push({ id, x: r.ax + r.ux * s, y: r.ay + r.uy * s, edges: [], hold: null, runway: r.id });
    axis.push({ s, id });
    return id;
  }
  const join = { runway: r.id, pw: 0.5 };   // half a crossing to get on, half to get off
  // 1. Taxiways crossing the centreline.
  for (const e of edges.slice()) {
    if (e.dead || e.axis || e.runway !== r.id) continue;
    const A = nodes[e.a], B = nodes[e.b];
    const ca = across(A.x, A.y), cb = across(B.x, B.y);
    if (ca * cb >= 0) continue;
    const t = ca / (ca - cb), x = A.x + t * (B.x - A.x), y = A.y + t * (B.y - A.y);
    const s = along(x, y);
    if (s < 0 || s > r.len) continue;
    const id = splitAt(graph, { edge: e, t, x, y });
    const n = near(s);
    if (n) link(graph, id, n.id, { runway: r.id, axis: true, ref: 'RWY ' + r.id });
    else { nodes[id].runway = r.id; axis.push({ s, id }); }
  }
  // 2. Taxiways that stop on the runway or just beyond its edge (or its ends): a node
  //    near the pavement whose neighbours all lie farther from it, not already joined.
  const gap = (x, y) => {   // metres from the pavement (0 on it)
    const s = along(x, y), c = Math.abs(across(x, y));
    return Math.hypot(Math.max(0, -s, s - r.len), Math.max(0, c - r.half));
  };
  for (const n of nodes.slice()) {
    if (n.runway || !n.edges.length || n.edges.some(e => e.runway === r.id)) continue;
    const g = gap(n.x, n.y);
    if (g > RUNWAY_JOIN_M) continue;
    if (!n.edges.every(e => { const m = nodes[e.a === n.id ? e.b : e.a]; return gap(m.x, m.y) > g + 2; })) continue;
    link(graph, n.id, axisNode(along(n.x, n.y)), join);
  }
  // 3. The chain along the centreline.
  axis.sort((p, q) => p.s - q.s);
  for (let i = 1; i < axis.length; i++) link(graph, axis[i - 1].id, axis[i].id, { runway: r.id, axis: true, ref: 'RWY ' + r.id });
}

// Pieces of taxi line that pass within BRIDGE_M of the network without meeting it, at a bend
// rather than an end (so neither the crossings nor the end joins above catch them), get one
// link to the nearest point of the network. Gimpo's apron line behind stand 7 passes 14 m from
// it, so until v0.1.4 that stand's pushback ended on an island and no route led anywhere.
// A link onto a runway's centreline is a way onto that runway, like addRunwayAxis's joins.
function bridgeIslands(graph) {
  const { nodes, edges } = graph;
  const comp = new Array(nodes.length).fill(-1), members = [];
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i] >= 0 || !nodes[i].edges.length) continue;
    const c = members.length, m = [i];
    comp[i] = c;
    for (let j = 0; j < m.length; j++) {
      for (const e of nodes[m[j]].edges) {
        if (e.dead) continue;
        const v = e.a === m[j] ? e.b : e.a;
        if (comp[v] < 0) { comp[v] = c; m.push(v); }
      }
    }
    members.push(m);
  }
  if (members.length < 2) return 0;
  const main = members.reduce((b, m, i) => (m.length > members[b].length ? i : b), 0);
  let bridged = 0;
  for (let c = 0; c < members.length; c++) {
    if (c === main || members[c].length < 2) continue;
    let best = null;
    for (const e of edges) {
      if (e.dead || comp[e.a] !== main) continue;
      const A = nodes[e.a], B = nodes[e.b];
      for (const u of members[c]) {
        const p = project(nodes[u].x, nodes[u].y, A.x, A.y, B.x, B.y);
        if (p.d <= BRIDGE_M && (!best || p.d < best.d)) best = { u, d: p.d, at: { edge: e, t: p.t, x: p.x, y: p.y } };
      }
    }
    if (!best) continue;
    const e = best.at.edge, id = splitAt(graph, best.at);
    comp[id] = main;
    let props = { ref: '', widthM: e.widthM || 20 };
    if (e.axis) { nodes[id].runway = e.runway; props = { runway: e.runway, pw: 0.5 }; }
    else {
      const U = nodes[best.u], N = nodes[id];
      for (const r of graph.rects) if (segmentHitsRunway(U.x, U.y, N.x, N.y, r)) { props = { ...props, runway: r.id, pw: 1 }; break; }
    }
    if (link(graph, best.u, id, props)) bridged++;
    for (const u of members[c]) comp[u] = main;
  }
  return bridged;
}

// ---- routing ----

const cost = e => e.lengthM * (e.axis ? AXIS_COST : 1) + RUNWAY_CROSS_PENALTY * (e.pw || 0);

// Dijkstra from an attachment (point on an edge) to a goal attachment.
// Returns { points, refs, lengthM, crossings } or null.
function route(graph, from, to) {
  const { nodes } = graph;
  const N = nodes.length;
  const d = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const prevEdge = new Array(N).fill(null);
  const heap = []; // binary heap of [cost, node]
  const push = (c, n) => {
    heap.push([c, n]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  const fe = from.edge, fc = cost(fe);
  d[fe.a] = from.t * fc; d[fe.b] = (1 - from.t) * fc;
  push(d[fe.a], fe.a); push(d[fe.b], fe.b);
  while (heap.length) {
    const [c, n] = pop();
    if (c > d[n]) continue;
    for (const e of nodes[n].edges) {
      const m = e.a === n ? e.b : e.a;
      const nc = c + cost(e);
      if (nc < d[m]) { d[m] = nc; prev[m] = n; prevEdge[m] = e; push(nc, m); }
    }
  }

  // Goal: a node (to.node) or a point on an edge.
  let endNode, best = Infinity, direct = false;
  if (to.node !== undefined) { endNode = to.node; best = d[endNode]; }
  else {
    const te = to.edge, tc = cost(te);
    const ca = d[te.a] + to.t * tc, cb = d[te.b] + (1 - to.t) * tc;
    if (ca <= cb) { endNode = te.a; best = ca; } else { endNode = te.b; best = cb; }
    if (te === fe && Math.abs(to.t - from.t) * tc <= best) direct = true;
  }
  if (!direct && !isFinite(best)) return null;

  const pts = [[from.x, from.y]];
  const edgesUsed = [fe];
  if (!direct) {
    const chain = [];
    for (let n = endNode; n !== -1; n = prev[n]) { chain.push(n); if (prevEdge[n]) edgesUsed.push(prevEdge[n]); }
    chain.reverse();
    for (const n of chain) pts.push([nodes[n].x, nodes[n].y]);
    if (to.edge) edgesUsed.push(to.edge);
  }
  pts.push([to.x, to.y]);

  // Drop repeated points (start or goal sitting on a node).
  const points = pts.filter((p, i) => i === 0 || dist(p[0], p[1], pts[i - 1][0], pts[i - 1][1]) > 0.5);
  let lengthM = 0;
  for (let i = 1; i < points.length; i++) lengthM += dist(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);

  // Taxiway letters in order (first edge, then the chain from start to goal).
  const ordered = [fe, ...edgesUsed.slice(1, to.edge ? -1 : undefined).reverse(), ...(to.edge ? [to.edge] : [])];
  const refs = [];
  const crossings = [];
  for (const e of ordered) {
    if (e.ref && refs[refs.length - 1] !== e.ref) refs.push(e.ref);
    if (e.runway && crossings[crossings.length - 1] !== e.runway) crossings.push(e.runway);
  }
  return { points, refs, lengthM, crossings };
}

// The holding point for a departure runway end: a mapped holding position beside that
// runway near the end (preferred), or else a point made on a taxiway that joins the
// runway near the end, 60 m outside its edge. Falls back to the graph point nearest
// the end. Returns { ref, node, x, y, d, runway }.
export function holdingPointFor(graph, runwayEnd) {
  const r = graph.rects.find(q => q.idents.includes(runwayEnd.ident));
  if (r) {
    const fromA = r.idents[0] === runwayEnd.ident;
    const ox = fromA ? r.ax : r.bx, oy = fromA ? r.ay : r.by;
    const ux = fromA ? r.ux : -r.ux, uy = fromA ? r.uy : -r.uy;
    const along = (x, y) => (x - ox) * ux + (y - oy) * uy;
    const across = (x, y) => -(x - ox) * uy + (y - oy) * ux;
    const onOther = (x, y) => graph.rects.some(q => q !== r && insideRect(q, x, y));
    const score = (x, y) => { const s = along(x, y); return (s >= 0 ? s : -0.5 * s) + 0.2 * Math.abs(across(x, y)); };
    const ok = (x, y) => { const s = along(x, y), c = Math.abs(across(x, y));
      return s > -500 && s < 700 && c > r.half && c < r.half + 200 && !onOther(x, y); };
    let best = null;
    for (const h of graph.holds) {
      if (!ok(h.x, h.y)) continue;
      const sc = score(h.x, h.y) - 100;   // mapped holds win over made ones
      if (!best || sc < best.sc) best = { sc, hold: h };
    }
    const want = r.half + 60;
    for (const e of graph.edges) {
      if (e.dead || e.axis || e.runway !== r.id) continue;
      let O = graph.nodes[e.a], I = graph.nodes[e.b], fromAEnd = true;
      if (Math.abs(across(O.x, O.y)) < Math.abs(across(I.x, I.y))) { [O, I] = [I, O]; fromAEnd = false; }
      const co = across(O.x, O.y), ci = across(I.x, I.y);
      if (Math.abs(co) <= r.half) continue;                       // both ends on the pavement
      let t = 0;                                                  // from O towards I
      if (Math.abs(co) > want) {
        const target = Math.sign(co) * want;
        if (Math.sign(ci) === Math.sign(co) && Math.abs(ci) > want) continue;
        t = (co - target) / (co - ci);
      }
      const x = O.x + t * (I.x - O.x), y = O.y + t * (I.y - O.y);
      if (!ok(x, y)) continue;
      const sc = score(x, y);
      if (!best || sc < best.sc) best = { sc, at: { edge: e, t: fromAEnd ? t : 1 - t, x, y } };
    }
    if (best?.hold) return { ...best.hold, d: dist(best.hold.x, best.hold.y, runwayEnd.x, runwayEnd.y), runway: r.id };
    if (best?.at) {
      const id = splitAt(graph, best.at);
      const n = graph.nodes[id];
      return { ref: null, node: id, x: n.x, y: n.y, d: dist(n.x, n.y, runwayEnd.x, runwayEnd.y), runway: r.id };
    }
  }
  const at = snapToGraph(graph, runwayEnd.x, runwayEnd.y);
  if (!at) return null;
  const id = splitAt(graph, at);
  return { ref: null, node: id, x: graph.nodes[id].x, y: graph.nodes[id].y, d: at.d, runway: r ? r.id : null };
}

function insideRect(r, x, y) {
  const s = (x - r.ax) * r.ux + (y - r.ay) * r.uy, c = -(x - r.ax) * r.uy + (y - r.ay) * r.ux;
  return s >= 0 && s <= r.len && Math.abs(c) <= r.half;
}

// Stand → holding point of the departure runway end.
// Returns { points: [[x, y], …], refs: ['A', …], lengthM, crossings: [runway ids], hold }.
export function routeFromStand(graph, stand, runwayEnd) {
  const from = snapToGraph(graph, stand.x, stand.y);
  const hold = holdingPointFor(graph, runwayEnd);
  if (!from || !hold) return null;
  const r = route(graph, from, { node: hold.node, x: hold.x, y: hold.y });
  if (r) r.hold = hold;
  return r;
}

// After landing: from a point (the runway exit) to the stand's lead-in.
export function routeToStand(graph, fromXY, stand) {
  const from = snapToGraph(graph, fromXY[0], fromXY[1]);
  const to = snapToGraph(graph, stand.x, stand.y);
  if (!from || !to) return null;
  return route(graph, from, to);
}

// A stand not in `occupied` (Set or array of refs). Gates first; nearest to
// `nearXY` if given, otherwise the first in file order. null if all are taken.
export function freeStand(airport, occupied = [], nearXY = null) {
  const taken = occupied instanceof Set ? occupied : new Set(occupied);
  const free = (airport.stands || []).filter(s => !taken.has(s.ref));
  if (!free.length) return null;
  const score = s => (s.gate ? 0 : 1e9) + (nearXY ? dist(s.x, s.y, nearXY[0], nearXY[1]) : 0);
  let best = free[0];
  for (const s of free) if (score(s) < score(best)) best = s;
  return best;
}
