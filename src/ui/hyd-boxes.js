// v0.8.0 (part 7): the hydraulics on the engine display, small: three boxes with the systems' letters (G B Y on the
// A321's engine panel, L C R on the Boeings' EICAS), green with pressure, amber without (under WORK_P, where the
// alerts say LO PR), and RAT in green once it is out. Drawn only while state.hyd.on: with everything normal nothing
// here touches the canvas (the panels' every call stays v0.7.9's).
//
//   drawHydBoxes(ctx, s, st, family, layout)  layout: 'column' (the A321: between the gear and ECAM's messages) or
//                                             'row' (the Boeings: right of the stab trim)
//   hydSig(st)                                a short string for the HUD's redraw signature ('' while all is normal)

import { C, font } from './common.js';
import { WORK_P } from '../sim/hydraulics.js';

const LETTERS = { airbus: ['G', 'B', 'Y'], boeing: ['L', 'C', 'R'] };

export function hydSig(st) {
  const H = st?.hyd;
  if (!H || !H.on) return '';
  return (H.p[0] < WORK_P ? 1 : 0) + '' + (H.p[1] < WORK_P ? 1 : 0) + (H.p[2] < WORK_P ? 1 : 0) + (H.rat > 0 ? 'R' : '');
}

export function drawHydBoxes(ctx, s, st, family, layout) {
  const H = st?.hyd;
  if (!H || !H.on) return false;
  const L = LETTERS[family === 'boeing' ? 'boeing' : 'airbus'];
  const col = layout === 'column';
  const w = (col ? 0.042 : 0.036) * s, h = (col ? 0.036 : 0.034) * s;
  // The boxes' centres: a column at x 0.3025 s from y 0.44 s (the A321, no label: ECAM's title is beside it), a row
  // on the parking brake's line right of it, from x 0.745 s (EICAS; the stab trim's figures sit above).
  const at = (i) => (col ? [0.3025 * s, 0.44 * s + i * 0.045 * s] : [0.745 * s + i * 0.04 * s, 0.39 * s]);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 3; i++) {
    const [x, y] = at(i), ok = H.p[i] >= WORK_P;
    ctx.strokeStyle = ok ? C.frame : C.amber; ctx.lineWidth = Math.max(1, s * 0.003);
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = ok ? C.green : C.amber; ctx.font = font(s * 0.026, true);
    ctx.fillText(L[i], x, y);
  }
  if (H.rat > 0) {
    ctx.fillStyle = C.green; ctx.font = font(s * 0.022, true);
    if (col) ctx.fillText('RAT', 0.3025 * s, 0.57 * s);
    else { ctx.textAlign = 'right'; ctx.fillText('RAT', 0.72 * s, 0.39 * s); }
  }
  return true;
}
