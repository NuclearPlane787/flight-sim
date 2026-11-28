// The landing-score card, shown after the rollout: the grade in big letters, the points,
// each part of the score with its value and its points out of its share of the 100 (v0.5.5; v0.5.4: its score
// out of 10), then what came off (the worst part's cap, the grass, off a runway, a would-be crash), a one-line
// verdict, and the touchdown point on a small runway diagram (against the aiming point and centreline).
//
//   const card = createScorePanel(root, { onclose, onnewflight });
//   card.show(result, extras);   // result: score.js's { points, grade, parts, touchdown }
//   card.hide();
//
// extras (all optional): { route, runway, vsFpm, g, touchdown: { along, cross },
//   runwayLengthM, runwayWidthM, aimM }. Missing ones fall back to the result.
// The pure helpers (verdict, gradeColor, partScore, partFrac, scoreColor, penaltyFrac, partsHtml, runwaySvg) are exported
// for the logbook and the node tests. Nothing here touches the DOM until a function runs.

export const GRADE_COLORS = { A: '#3cff4e', B: '#a6e22e', C: '#ffe838', D: '#ffa515', F: '#ff3b3b' };
export const gradeColor = (g) => GRADE_COLORS[g] || '#8a9097';

const PEN_FULL = 30; // before v0.5.4: a penalty this big filled its bar (now: one this big reads as 0/10)

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const part = (parts, name) => (parts || []).find((p) => p.name === name);

// The weakest part, as advice. v0.5.4: the lowest score out of 10, when it's 7 or less (the
// first in the card's order on a tie); a logbook entry from before v0.5.4 has penalties and no
// scores, and there it's the biggest penalty, when it cost at least 3 points.
function worstFlaw(parts) {
  let w = null;
  if (parts.some((p) => Number.isFinite(p.score))) {
    for (const p of parts) if (Number.isFinite(p.score) && p.score <= 7 && (!w || p.score < w.score)) w = p;
  } else {
    for (const p of parts) if ((Number(p.penalty) || 0) >= 3 && (!w || p.penalty > w.penalty)) w = p;
  }
  if (!w) return null;
  switch (w.name) {
    // (the approach's two parts: on landings logged before v0.6.2, which no longer scores the approach)
    case 'Approach path': return `Off the path on final${w.note ? ` (${w.note})` : ''}. Get on it early and stay there.`;
    case 'Sink rate swings': return 'Bobbing on final. Hold a steady descent.';
    case 'Touchdown vs aiming point': return w.value > 0 ? 'Long. Put it down at the aiming point.' : 'Early. Carry it on to the aiming point.';
    case 'From centreline': return 'Off the centreline. Line up earlier.';
    case 'Bank': return 'Wings level for the touchdown.';
    case 'Pitch': return w.value < 4 ? 'Nose low. Flare a little more.' : 'Nose high. Mind the tail.';
    case 'Vertical speed': return w.value > 130 ? 'Firm. Start the flare a little earlier.' : 'Held off too long. It eats runway.';
    case 'Peak g': return 'A jolt on the gear. Ease it on.';
    default: return null; // bounces have their own lines
  }
}

// The one-line verdict. The worst things win: off the runway, a hard landing, landing short,
// bounces; then the points band, naming the biggest flaw when one stands out.
export function verdict(result) {
  const parts = result?.parts || [];
  const points = result?.points ?? 0;
  const vs = Math.abs(part(parts, 'Vertical speed')?.value ?? 0);
  const g = part(parts, 'Peak g')?.value ?? 1;
  const bounces = part(parts, 'Bounces')?.value ?? 0;
  const along = result?.touchdown?.along;
  const wreck = part(parts, 'Would have crashed');
  if (wreck) return `Without Indestructible, that was a crash (${result?.damage?.[0] || wreck.value}).`;
  if (result?.offRunway || part(parts, 'On a runway')) return "That wasn't a runway.";
  // v0.8.0: down with the gear not all there, and stopped in one piece (result.gear: score.js's gearLanding())
  if (result?.gear) {
    const G = result.gear;
    if (!G.failure) return 'The gear was still up. Everyone walks away, but the aircraft won’t fly for a while.';
    if (G.legsUp?.length === 3) return 'Down on the belly and stopped in one piece. Evacuate.';
    return 'Stopped in one piece on what was left. Evacuate.';
  }
  if (vs >= 600 || g >= 2.3) return 'That one will need an inspection.';
  if (Number.isFinite(along) && along < 0) return 'Short of the threshold. Far too close.';
  if (part(parts, 'On the grass')) return 'Off the side, onto the grass.';
  if (bounces >= 2) return 'Kangaroo. Hold the flare and let it settle.';
  // v0.5.4: a part at 4/10 or less is named even at 90 and up (one bad part no longer takes the points with it).
  const bad = parts.some((p) => Number.isFinite(p.score) && p.score <= 4);
  if (points >= 95 && !bad) return 'Butter.';
  if (points >= 90 && !bad) return 'Smooth. The cabin barely noticed.';
  if (bounces === 1 && points < 78) return 'One bounce. Keep the pitch on touchdown.';
  const flaw = worstFlaw(parts);
  if (flaw) return flaw;
  if (points >= 78) return 'Fine, with a few things to tidy.';
  if (points >= 64) return 'Safe, if not pretty.';
  if (points >= 50) return 'The cabin crew will have words.';
  return 'That one will need an inspection.';
}

// Bar length 0..1 for a penalty (a logbook entry from before v0.5.4).
export const penaltyFrac = (pen) => Math.max(0, Math.min(1, (pen || 0) / PEN_FULL));
// v0.5.4: a part's score out of 10; a part saved before v0.5.4 has only its penalty, read
// back as 10/10 for none down to 0/10 for PEN_FULL or more.
export const partScore = (p) => (Number.isFinite(p?.score) ? p.score : Math.round(10 * (1 - penaltyFrac(Number(p?.penalty) || 0))));
// v0.5.4: green at 9–10, through amber, to red at 0–3 (the grades' colours).
export const scoreColor = (s) => (s >= 9 ? GRADE_COLORS.A : s >= 7 ? GRADE_COLORS.B : s >= 6 ? GRADE_COLORS.C : s >= 4 ? GRADE_COLORS.D : GRADE_COLORS.F);

const fmtValue = (p) => {
  if (p.name === 'Touchdown vs aiming point') return `${p.value > 0 ? '+' : p.value < 0 ? '−' : ''}${Math.abs(p.value)} m`;
  if (p.name === 'Approach path') return `${p.value} dots${p.note ? ' ' + p.note : ''}`;
  if (p.name === 'Sink rate swings') return `±${p.value} ft/min`;
  return `${p.value}${p.unit ? (p.unit === '°' ? '°' : ' ' + p.unit) : ''}`;
};

// The parts as rows: name, value, a bar, and the score. v0.5.5: a part's points out of its share of the 100
// ("13/17"), the bar filled to them, so the rows add up to the total; what came off after that (kind 'penalty': the
// worst part's cap, the grass, off a runway, a would-be crash) is a row of its own, its rule ("half", "80 at most")
// where the bar would be and what it took ("−15"). v0.5.4's parts read "6/10", the bar filled to the score out of
// 10 (in full green at 10/10); a part from before v0.5.4 keeps its penalty ("−7") beside the bar its penalty reads as.
export const partFrac = (p) => (Number.isFinite(p?.share) && Number.isFinite(p?.points) ? (p.share > 0 ? p.points / p.share : 0) : partScore(p) / 10);
export function partsHtml(parts) {
  return `<div class="fssc-parts">${(parts || []).map((p) => {
    if (p.kind === 'penalty') {
      const m = Number(p.minus) || 0;
      return `<div class="fssc-part pen"><span class="n">${esc(p.name)}</span><span class="v">${esc(fmtValue(p))}</span>`
        + `<span class="rule">${esc(p.rule || '')}</span>`
        + `<span class="p" style="color:${m ? GRADE_COLORS.F : '#8a9097'}">${m ? '−' + m : '0'}</span></div>`;
    }
    const s = partScore(p), col = scoreColor(s), pen = Number(p.penalty) || 0;
    const shared = Number.isFinite(p.share) && Number.isFinite(p.points);
    const txt = shared ? `${p.points}/${p.share}` : Number.isFinite(p.score) ? `${s}/10` : pen ? '−' + pen : '0';
    return `<div class="fssc-part"><span class="n">${esc(p.name === 'Touchdown vs aiming point' ? 'From aiming point' : p.name)}</span>`
      + `<span class="v">${esc(fmtValue(p))}</span>`
      + `<span class="bar"><i style="width:${Math.max(2, Math.round(partFrac(p) * 1000) / 10)}%;background:${col}"></i></span>`
      + `<span class="p" style="color:${col}">${txt}</span></div>`;
  }).join('')}</div>`;
}

// v0.8.0: the line under the touchdown for a landing with the gear not all down (result.gear): what kind it was and
// what scraped ("Gear-up landing: on the engines and the tail"). '' for a normal landing.
const SCRAPED_NAMES = { 'engine strike': 'the engines', 'tail strike': 'the tail', 'belly impact': 'the belly', 'nose impact': 'the nose', 'tank strike': 'the wing tanks' };
export function gearLine(gear) {
  if (!gear || !gear.text) return '';
  const on = [...new Set((gear.scraped || []).map((r) => SCRAPED_NAMES[r] || r))];
  const tail = on.length ? `: on ${on.length < 2 ? on[0] : on.slice(0, -1).join(', ') + ' and ' + on[on.length - 1]}` : '';
  return `<div class="fssc-td fssc-gear">${esc(gear.text + tail)}</div>`;
}

// The runway seen from above, landing left to right, with the touchdown point.
// Along-track is to scale; the width is drawn much wider so a few metres show.
// along/cross: metres from the landing threshold (cross > 0 is right of the centreline,
// drawn below it). Returns an SVG string.
export function runwaySvg({ along, cross, lengthM = 3000, widthM = 45, aimM = 400 }, W = 340, H = 92) {
  const padL = 16, padR = 10, rwH = 40, cy = 40;
  const before = 120; // pavement drawn before the threshold
  const total = lengthM + before;
  const sx = (W - padL - padR) / total;
  const X = (m) => padL + (m + before) * sx;
  const sy = rwH / widthM;
  const top = cy - rwH / 2;
  let s = `<svg class="fssc-rw" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-label="Touchdown point">`;
  // the aiming-point tolerance (±150 m) and the runway
  s += `<rect x="${X(0).toFixed(1)}" y="${top}" width="${(lengthM * sx).toFixed(1)}" height="${rwH}" fill="#2a2f34" rx="1"/>`;
  s += `<rect x="${X(-before).toFixed(1)}" y="${top}" width="${(before * sx).toFixed(1)}" height="${rwH}" fill="#1c2024"/>`;
  s += `<rect x="${X(aimM - 150).toFixed(1)}" y="${top}" width="${(300 * sx).toFixed(1)}" height="${rwH}" fill="rgba(60,255,78,0.13)"/>`;
  // threshold stripes, centreline, aiming point blocks
  for (let i = 0; i < 6; i++) {
    const y = top + 3 + i * ((rwH - 6) / 6) + (i >= 3 ? 3 : 0);
    s += `<rect x="${(X(0) + 1).toFixed(1)}" y="${y.toFixed(1)}" width="5" height="${((rwH - 12) / 6).toFixed(1)}" fill="#d8dde2"/>`;
  }
  for (let m = 60; m < lengthM - 40; m += 80) {
    s += `<rect x="${X(m).toFixed(1)}" y="${cy - 0.6}" width="${Math.max(1, 30 * sx).toFixed(1)}" height="1.2" fill="#c9ced2" opacity=".7"/>`;
  }
  for (const dy of [-11, 7]) s += `<rect x="${X(aimM - 30).toFixed(1)}" y="${cy + dy}" width="${(60 * sx).toFixed(1)}" height="4" fill="#f2f2f2"/>`;
  s += `<line x1="${X(aimM).toFixed(1)}" x2="${X(aimM).toFixed(1)}" y1="${top - 4}" y2="${top + rwH + 4}" stroke="#2fe3ff" stroke-width="1" stroke-dasharray="2 2"/>`;
  s += `<text x="${X(aimM).toFixed(1)}" y="${top - 6}" fill="#2fe3ff" font-size="9" text-anchor="middle">AIM ${aimM} m</text>`;
  s += `<text x="${X(0).toFixed(1)}" y="${top + rwH + 13}" fill="#8a9097" font-size="9" text-anchor="middle">THR</text>`;
  s += `<text x="${X(lengthM).toFixed(1)}" y="${top + rwH + 13}" fill="#8a9097" font-size="9" text-anchor="end">${Math.round(lengthM)} m</text>`;
  if (Number.isFinite(along) && Number.isFinite(cross)) {
    const tx = Math.max(2, Math.min(W - 2, X(along)));
    const ty = Math.max(top - 6, Math.min(top + rwH + 6, cy + cross * sy));
    const ok = Math.abs(along - aimM) <= 150 && Math.abs(cross) <= 4;
    const col = along < 0 ? '#ff3b3b' : ok ? '#3cff4e' : '#ffa515';
    s += `<line x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="${cy}" y2="${ty.toFixed(1)}" stroke="${col}" stroke-width="1" opacity=".6"/>`;
    s += `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="5" fill="none" stroke="${col}" stroke-width="2"/>`;
    s += `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="1.6" fill="${col}"/>`;
  }
  s += `<text x="${W - padR}" y="${H - 4}" fill="#5d6c78" font-size="8.5" text-anchor="end">width ×${Math.round(sy / sx)}</text>`;
  return s + '</svg>';
}

// "+120 m past the aiming point, 3.2 m right of the centreline"
export function touchdownText(along, cross, aimM) {
  if (!Number.isFinite(along)) return 'Touchdown point not on a known runway.';
  const off = Math.round(along - aimM);
  const a = along < 0 ? `${Math.round(-along)} m short of the threshold`
    : off === 0 ? 'on the aiming point' : `${Math.abs(off)} m ${off > 0 ? 'past' : 'before'} the aiming point`;
  const c = Math.abs(cross) < 0.5 ? 'on the centreline' : `${Math.abs(cross).toFixed(1)} m ${cross > 0 ? 'right' : 'left'} of the centreline`;
  return `${a}, ${c}`;
}

// v0.4.0: the wind at touchdown, on the card when there was any.
function windLine(w) {
  if (!w || w.kt < 1) return '';
  const dir = String(Math.round(w.fromDeg) % 360 || 360).padStart(3, '0');
  const parts = [];
  if (w.cross >= 1) parts.push(`${Math.round(w.cross)} kt crosswind from the ${w.side === 'L' ? 'left' : 'right'}`);
  if (Math.abs(w.head) >= 1) parts.push(`${Math.round(Math.abs(w.head))} kt ${w.head > 0 ? 'headwind' : 'tailwind'}`);
  const gust = Math.round(w.gustKt || 0) > Math.round(w.kt) ? `, gusting ${Math.round(w.gustKt)}` : '';
  return `<div class="fssc-td fssc-wind">Wind ${dir}° at ${Math.round(w.kt)} kt${gust}${parts.length ? ` · ${parts.join(', ')}` : ''}</div>`;
}

export function createScorePanel(root, { onclose, onnewflight } = {}) {
  root.classList.add('fssc-root');
  root.hidden = true;
  const card = document.createElement('div');
  card.className = 'fssc-card';
  root.appendChild(card);
  // Clicks on the card never reach the camera handlers.
  for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel']) {
    card.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
  }

  function hide() {
    if (root.contains(document.activeElement)) document.activeElement.blur(); // Space must brake, not press a button
    root.hidden = true;
  }

  function show(result, extras = {}) {
    const parts = result.parts || [];
    const td = extras.touchdown || result.touchdown || {};
    const vs = extras.vsFpm ?? part(parts, 'Vertical speed')?.value;
    const g = extras.g ?? part(parts, 'Peak g')?.value;
    const aimM = extras.aimM ?? 400;
    const col = gradeColor(result.grade);
    const head = [extras.route, extras.runway ? 'RWY ' + extras.runway : null].filter(Boolean).join(' · ');
    card.innerHTML = `
      <div class="fssc-top">
        <div class="fssc-grade" style="color:${col};border-color:${col}">${esc(result.grade)}</div>
        <div class="fssc-head">
          <div class="fssc-title">Landing${head ? ` <span>${esc(head)}</span>` : ''}</div>
          <div class="fssc-points"><b style="color:${col}">${result.points}</b><small>/ 100</small></div>
          <div class="fssc-verdict">${esc(verdict(result))}</div>
        </div>
      </div>
      <div class="fssc-key">
        <div><small>Vertical speed</small><b>${vs != null ? Math.round(Math.abs(vs)) : '—'}</b> ft/min</div>
        <div><small>Peak g</small><b>${g != null ? Number(g).toFixed(2) : '—'}</b> g</div>
      </div>
      ${Number.isFinite(td.along) ? runwaySvg({ along: td.along, cross: td.cross, lengthM: extras.runwayLengthM || 3000, widthM: extras.runwayWidthM || 45, aimM }) : ''}
      <div class="fssc-td">${esc(touchdownText(td.along, td.cross, aimM))}</div>
      ${windLine(td.wind)}
      ${result.indestructible || td.indestructible ? '<div class="fssc-td fssc-ind">Flown with Indestructible on</div>' : ''}
      ${gearLine(result.gear)}
      ${partsHtml(parts)}
      <div class="fssc-foot">
        <button class="fsui-b" data-k="close">Close</button>
        <button class="fsui-b primary" data-k="new">New flight</button>
      </div>`;
    card.querySelector('[data-k="close"]').onclick = () => { hide(); onclose?.(); };
    card.querySelector('[data-k="new"]').onclick = () => { hide(); onnewflight?.(); };
    root.hidden = false;
  }

  return { show, hide, get isOpen() { return !root.hidden; } };
}
