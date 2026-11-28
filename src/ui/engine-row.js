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

// v0.5.6: the N1 engine i's thrust lever asks for: its own (state.engines[i].leverN1, when the per-engine keys split
// the levers; the same as state.leverN1 when they're together), else the aircraft's (state.leverN1), else 0 (the
// screens then fall back as they did).
export function ringN1(st, i) {
  const own = st?.engines?.[i]?.leverN1;
  return own > 0 ? own : st?.leverN1 > 0 ? st.leverN1 : 0;
}

// v0.5.6: the engine screens' "WING TANKS DROPPED" line. dropMemo(secs) → (state) → whether it shows: for `secs` of
// sim time (state.t) after state.tanksDropped turns true in flight. A flight first seen with the tanks gone, or a jump
// in time (a flight loaded, a rewind), shows nothing; paused, the time stands still and the line stays.
export const DROP_MEMO = 'WING TANKS DROPPED';
export function dropMemo(secs = 20) {
  let was = null, t0 = -Infinity, pt = null;
  return (st) => {
    const now = st?.tanksDropped === true, t = Number.isFinite(st?.t) ? st.t : null;
    const jump = pt === null || t === null || t < pt - 1e-6 || t - pt > 2;
    if (!now) t0 = -Infinity;
    else if (was === false && !jump) t0 = t;
    was = now;
    if (t !== null) pt = t;
    return now && t !== null && t - t0 >= -0.5 && t - t0 <= secs;
  };
}

// v0.8.0 (part 5, Shane's decision): the switch under each engine's gauges, the A321's ENG MASTER n (ON / OFF) and the
// Boeings' FUEL CONTROL n (RUN / CUTOFF), drawn by both engine screens and clicked (hud.engineSwitchAt). Pure: what it
// says for engine state e (state.engines[i]): { text, col: 'green' | 'white' | 'cyan' | 'amber', fire, progress }.
//   fire: the engine burning (a red FIRE beside the switch's word); progress: 0..1 while it starts, else -1.
// Can't start with its switch on: the short reason in amber (the checklist has the long one).
export const SWITCH_LABEL = { airbus: 'MASTER', boeing: 'FUEL CTRL' };
const SHORT_BLOCK = { gone: '', seized: 'SEIZED', fire: 'FIRE HDL', cycle: 'RECYCLE', fuel: 'NO FUEL', altitude: 'TOO HIGH', speed: 'TOO SLOW' };
export function switchFace(e, family) {
  const boeing = family === 'boeing';
  const on = e?.sw !== false;
  const out = { text: on ? (boeing ? 'RUN' : 'ON') : (boeing ? 'CUTOFF' : 'OFF'), col: on ? 'green' : 'white', fire: !!e?.fire, progress: -1 };
  if (on && e && e.lit === false) {
    if (e.start > 0 && e.startS > 0) { out.text = 'START'; out.col = 'cyan'; out.progress = Math.min(1, e.start / e.startS); }
    else if (e.block) { out.text = SHORT_BLOCK[e.block] ?? e.block.toUpperCase(); out.col = 'amber'; }
  }
  return out;
}
// The engine screens' redraw key for the switches (the hud's signature): each engine's switch, flame, fire, start.
export function switchSig(st) {
  // (Every engine burning with its switch on and no fire: '' and nothing made, a frame.)
  let plain = true;
  for (const e of st?.engines || []) if (e.sw === false || e.lit === false || e.fire || e.pushed) { plain = false; break; }
  if (plain) return '';
  let k = '';
  for (const e of st?.engines || []) k += (e.sw === false ? 0 : 1) + '' + (e.lit === false ? 0 : 1) + (e.fire ? 1 : 0) + (e.pushed ? 1 : 0) + (e.block || '') + (e.start > 0 ? Math.floor(50 * e.start / (e.startS || 1)) : '') + ';';
  return k;
}
// A hit test on the rectangles a screen drew its switches in ([{ x, y, w, h, i }], CSS px): the engine's index or -1.
export function rectAt(rects, x, y, pad = 2) {
  for (const r of rects) if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) return r.i;
  return -1;
}
