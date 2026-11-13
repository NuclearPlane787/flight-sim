// v0.5.0: where the engine screens put 3, 4 or 6 engines' dials (two keep the layout they had).
// Pure: no canvas, so tests/engine-row.test.mjs checks it in node.
//
// engineRow(n, { x0, x1, gap }) -> { xs, w, labelX, gapAt }
//   n dials in a row between x0 and x1, engine 1 (the left outboard) on the left, with a gap `gap`
//   wide for the row labels (N1, FF, EGT...). As on four-engine flight decks, the labels sit between
//   the two wings' engines when there's an even number; with three (a pair and the tail engine), at
//   the left. xs[i] is engine i+1's slot centre, w each slot's width, labelX the labels' centre.

export function engineRow(n, { x0, x1, gap = 0 }) {
  n = Math.max(1, Math.round(n) || 1);
  const gapAt = n % 2 ? 0 : n / 2;
  const w = (x1 - x0 - gap) / n;
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(x0 + w * (i + 0.5) + (i >= gapAt ? gap : 0));
  return { xs, w, labelX: x0 + w * gapAt + gap / 2, gapAt };
}

// The engine count a screen draws: the state's list when there is one, else the type's, else two.
export const engineCountOf = (st, def) => (st?.engines?.length || def?.engineCount || 2);
