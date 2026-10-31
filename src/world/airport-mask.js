// Clear forest and built-up cover inside each airport's boundary, so no trees or city
// blocks grow on aprons, taxiways or around the terminals. Edits the national cover grid
// in place (RGBA8: R forest, G farm, B built-up), before its texture is made, so the GPU and
// the CPU-side coverAt agree. Cells within one cell of the boundary are cleared too.

function inside(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function maskAirportCover(hf, airports) {
  const g = hf && hf.layers && hf.layers.national;
  if (!g || !g.cover) return 0;
  const { x0, y0, cell, nx, ny, cover } = g;
  let cleared = 0;
  for (const a of airports || []) {
    const b = a.boundary;
    if (!b || b.length < 3) continue;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const [x, y] of b) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
    const i0 = Math.max(0, Math.floor((bx0 - x0) / cell) - 1), i1 = Math.min(nx - 1, Math.floor((bx1 - x0) / cell) + 1);
    const j0 = Math.max(0, Math.floor((by0 - y0) / cell) - 1), j1 = Math.min(ny - 1, Math.floor((by1 - y0) / cell) + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = x0 + (i + 0.5) * cell, cy = y0 + (j + 0.5) * cell, h = cell;
        // The cell, or any neighbour's centre, inside the boundary.
        if (!(inside(cx, cy, b) || inside(cx - h, cy, b) || inside(cx + h, cy, b) || inside(cx, cy - h, b) || inside(cx, cy + h, b))) continue;
        const k = (j * nx + i) * 4;
        if (cover[k] || cover[k + 2]) cleared++;
        cover[k] = 0;       // forest
        cover[k + 2] = 0;   // built-up
      }
    }
  }
  return cleared;
}
