// Flight setup: a modal for origin and runway, destination and runway, the start
// (runway, 15 nm final, or a gate with pushback and taxi), passengers, cargo and fuel, with weight checks.
// createSetup(root, { airports, coast?, types? }) -> { show(defaults, opts?) -> Promise<plan | null>, hide(), setTypes(list) }
// plan = { origin, depRunway, dest, arrRunway, start, stand?, type, pax, cargoKg, fuelKg, waypoints, payloadKg, name? }
// (stand: the origin stand's ref, for start 'gate'; type: the aircraft's id in src/sim/types.js)
// `types`: the picker's list, TYPE_LIST() unless given (the tests pass a list to see three cards).
// defaults.type sets the aircraft at the start (missing: the A321neo).
// plan.time = { mode: 'now' } (the real time in Korea, the default) | { mode: 'set', ms } (a date and a
// KST time picked here, KST whatever the Mac's timezone); defaults.time sets the start.
// plan.weather = a preset's id in src/sim/weather-presets.js (v0.4.0; 'clear' by default). It stays with the
// plan (defaults.weather), so a New flight keeps it, but a new scenario starts clear: it isn't kept in lastPlan.
// v0.7.4: plan.weather is the departure's; plan.weatherDest the destination's (absent: the same as the departure's).
// opts = { title, name, nameField, cancel, lockType }: the dialog's title ("New scenario", "New flight"),
// a Name field at the top (3–40 characters; the plan gets `name`, cleaned), a Cancel button (resolves null),
// and lockType: a scenario keeps its aircraft, so a New flight inside one shows only defaults.type's card.
// The last plan is kept in localStorage['gamedump:flight-sim:settings'].lastPlan.
// v0.5.0: the warehouse's saved designs get cards of their own under the three types (`designs`: a function
// returning the list, src/designs-store.js's by default). With one picked, plan.type is its base's id and
// plan.design the design itself, whole and normalized (src/sim/designs.js); the limits, the fuel rule and the
// stands are its type entry's (designDef(design)). defaults.design picks it again: as given with lockType (a
// scenario keeps its copy), else the stored design with that id if it's still there (else its base).
// v0.6.0: the region's airports (eleven; twelve since v0.6.1)
// grouped by country, Korea first (airportGroups()), named by their short names; the small map fitted to the region,
// its labels kept apart (Pudong and Hongqiao, Haneda and Narita); a filter on a long stand list; the fuel rule by the
// cruise level a trip that long flies at (fuelEstimate()); the start's time in the departure's own zone (KST, JST, CST).
// v0.5.8: the scenario's copy is named as the design is now (designName(), by its id; its own name once the design
// is deleted), on its card and in the plan Fly returns: only the name, its parts stay the scenario's.

import { C, font, NM, airportList, thresholdOf, buildCoast, traceRings, setWaypoints, runwayCourseMag, courseText } from './common.js';
import { cleanName, nameOk, NAME_MIN, NAME_MAX } from '../scenarios.js';
import { zoneAt, zoneLabel, fmtZone, fmtZoneDate, zoneFieldValues, zoneFromFields } from '../clock.js';
import { circleFrom, useRank, runwayUseNote, circlingOnly } from '../world/runways.js';
import { shortPlace } from './home-card.js';
import { REGION_ID, defaultPlan, planInRegion } from '../world/regions.js';
import { EUROPE_COUNTRY_OF, EUROPE_COUNTRY_LABEL, EUROPE_COUNTRY_ORDER, EUROPE_AIRPORT_ORDER } from '../world/rules-europe.js';
import { esc } from './score-panel.js';
import { standList } from '../ground/gate-flow.js';
import { TYPE_LIST, typeById, DEFAULT_TYPE } from '../sim/types.js';
import { PRESETS } from '../sim/weather-presets.js';
import { designDef, designNumbers, isDesign } from '../sim/designs.js';
import { designStore, designName } from '../designs-store.js';

const KEY = 'gamedump:flight-sim:settings';

// The A321neo's weights (kg), for what imports them. The dialog uses the selected type's.
export const LIMITS = typeById(DEFAULT_TYPE).limits;

// Fuel for the trip, as a rough block-fuel rule from the type's `fuel` numbers. The A321neo's:
//   trip    = 1,100 kg (climb and descent) + 6.2 kg per nm along the route
//             (≈ 2.4 t/h at a 390 kt average ground speed),
//   reserve = 30 min holding at ≈ 2,000 kg/h = 1,000 kg, plus 5 % of the trip as contingency,
//   taxi    = 200 kg.
// Rounded up to 100 kg. Gimpo–Jeju (243 nm) gives about 4,000 kg.
// `type`: a registry entry or an id; without one, the A321neo.
//
// v0.6.0, with the region on: the trip from the sim itself (tests/v060-fuel-sim.mjs flies each type's take-off, climb at
// CL/FLCH, cruise at its Mach, idle descent and approach at its setup load, at the best level a trip that long fits) as
//   trip = climbKg · (1 − e^(−d / rampNm)) + perNm · d,
// the climb's extra fuel growing in over the first hundred-odd nm as the level a trip can reach does. Within 1 % of
// the sim at 120, 300, 480, 640 and 960 nm on all three (tests/v060-setup.test.mjs); v0.5.8's line read 40 to 120 %
// over it there (it was set for a block, not the sim). The reserve, the 5 % and the taxi are as before. A design's
// rule scales with its per-nm against its base's (designs.js). With the region off, v0.5.8's rule exactly.
export const REGION_FUEL = {
  a321neo: { climbKg: 660, rampNm: 92, perNm: 4.76 },
  'b787-9': { climbKg: 1950, rampNm: 122, perNm: 9.7 },
  'b777-300er': { climbKg: 2400, rampNm: 100, perNm: 12.74 },
};
export function regionTrip(distNm, type) {
  const t = type && typeof type === 'object' ? type : typeById(type);
  const R = REGION_FUEL[t.id], base = typeById(t.id).fuel;
  if (!R || !base) return null;
  const k = t.fuel && base.perNm ? t.fuel.perNm / base.perNm : 1;
  return k * (R.climbKg * (1 - Math.exp(-Math.max(0, distNm) / R.rampNm)) + R.perNm * distNm);
}
export function fuelEstimate(distNm, type) {
  const r = (type && typeof type === 'object' ? type : typeById(type)).fuel;
  const rt = regionTrip(distNm, type);
  const trip = rt ?? r.climbKg + r.perNm * distNm;
  const total = trip * 1.05 + r.holdKg + r.taxiKg;
  return { trip: Math.round(trip), total: Math.ceil(total / 100) * 100 };
}

// The load after a change of type: what fits stays, what doesn't goes to the type's default. A payload
// that fits the seats and the hold can still be over a smaller type's MZFW, so that resets both.
export function fitLoad({ pax, cargoKg }, type) {
  const l = type.limits, d = type.defaults;
  let p = pax > l.PAX_MAX ? d.pax : pax, c = cargoKg > l.CARGO_MAX ? d.cargoKg : cargoKg;
  if (l.OEW + p * l.PAX_KG + c > l.MZFW) { p = d.pax; c = d.cargoKg; }
  return { pax: p, cargoKg: c };
}

// ---- v0.6.0: the region's airports in the lists ----
// The country by the ICAO code's region letters (stable, whatever the country raster says at a shore), Korea first,
// then Japan and China; within one, the order below (the capital's airports first), then any other by its code.
// v0.7.0: each region has its own lists (Europe's are rules-europe.js's); East Asia's are the ones below, as they were.
const EU = REGION_ID === 'europe';
const COUNTRY_OF = EU ? EUROPE_COUNTRY_OF : [['RK', 'KR'], ['ZK', 'KP'], ['RJ', 'JP'], ['RO', 'JP'], ['Z', 'CN'], ['U', 'RU']];   // (U: Russia, v0.6.3)
export const COUNTRY_LABEL = EU ? EUROPE_COUNTRY_LABEL : { KR: 'Korea', JP: 'Japan', CN: 'China', KP: 'North Korea', RU: 'Russia', other: 'Elsewhere' };
const COUNTRY_ORDER = EU ? EUROPE_COUNTRY_ORDER : ['KR', 'JP', 'CN', 'KP', 'RU', 'other'];
export const AIRPORT_ORDER = EU ? EUROPE_AIRPORT_ORDER : ['RKSS', 'RKSI', 'RKPK', 'RKPC', 'RKTU', 'RKJK', 'RJTT', 'RJAA', 'RJBB', 'RJOO', 'RJGG', 'RJFF', 'RJOA', 'RJNK', 'RJSN', 'RJSS', 'RJSA', 'RJCC', 'ZKPY', 'ZKWS', 'ZBAA', 'ZBAD', 'ZSPD', 'ZSSS', 'ZSYN', 'ZSQD', 'ZYTL', 'ZYTX', 'UHWW'];   // (ZSYN: v0.6.1, between Hongqiao and Qingdao, south to north along the coast; v0.6.3: Beijing's two first, the capital's, then Dalian and Shenyang on north, and Vladivostok; v0.6.4: Niigata, Sendai, Aomori and New Chitose after Fukuoka, south to north, and North Korea's Pyongyang and Wonsan)
export const airportCountry = (ap) => (COUNTRY_OF.find(([p]) => String(ap?.icao || '').startsWith(p)) || [null, 'other'])[1];
// The airport's short name: its data's shortName, else its name made short ("Seoul Gimpo International Airport" → "Gimpo").
export const airportShort = (ap) => ap?.shortName || shortPlace(ap?.name) || ap?.icao || '';
// The runway ends of an airport as a list's [ident, label] pairs, for a departure ('dep') or an arrival ('arr').
// v0.7.5 (Shane: every end can be picked): every end is in both lists. The ends the AIP uses that way come first (so
// the default is one of them), then a standby runway's, then the ends the AIP doesn't use that way, each with its note
// (runways.js ONE_WAY, useRank()). A circling-only end says so (CIRCLING_ONLY), and in the arrival list it comes after the
// AIP's straight-in ends, so the default arrival has a final (Itami's 32L, not its 14R; Gimhae's 36R; Innsbruck's 26).
export function runwayEndList(airport, what) {
  const icao = airport?.icao;
  const out = (airport?.runways || []).flatMap((r) => r.ends
    .map((e) => [e.ident, `RWY ${e.ident}  (${courseText(runwayCourseMag(e, r.ends.find((x) => x !== e)))}°, ${Math.round(r.lengthM || 0).toLocaleString()} m${e.circling || circlingOnly(icao, e.ident) ? ', circling only' : ''}${runwayUseNote(icao, e.ident) ? ', ' + runwayUseNote(icao, e.ident) : ''})`]));
  const key = (i) => { const k = useRank(icao, i, what); return k === 0 && what === 'arr' && circlingOnly(icao, i) ? 0.5 : k; };
  return [0, 0.5, 1, 2].flatMap((k) => out.filter(([i]) => key(i) === k));
}
// The list's text for an airport: "RJTT · Haneda".
export const airportOption = (ap) => `${ap.icao} · ${airportShort(ap)}`;
// [{ country, label, airports }] in the lists' order.
export function airportGroups(aps) {
  const rank = (a) => { const i = AIRPORT_ORDER.indexOf(a.icao); return i < 0 ? 999 : i; };
  const groups = new Map();
  for (const a of [...(aps || [])].sort((p, q) => rank(p) - rank(q) || String(p.icao).localeCompare(String(q.icao)))) {
    const c = airportCountry(a);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(a);
  }
  return COUNTRY_ORDER.filter((c) => groups.has(c)).map((c) => ({ country: c, label: COUNTRY_LABEL[c], airports: groups.get(c) }));
}

// The region's small map frame: the airports' box fitted both ways with a 20 % margin (the region is wide). → { k (px per
// m), cx, cy (the map point at the centre) }
export function miniRegionFrame(aps, W, H) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const a of aps) { const [x, y] = a.origin; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const k = Math.min(W / (((x1 - x0) || 100000) * 1.2), H / (((y1 - y0) || 100000) * 1.2));
  return { k, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
// The labels' sizes on the region's small map (font(12, true)).
export const MINI_LABEL = { charW: 7.6, h: 13, gap: 7, dotR: 4.5 };
// The small map's labels kept apart (pure, for the tests): each dot [id, sx, sy, text] gets a label beside it, right,
// left, above or below, the first that overlaps no other label or dot and stays on the canvas (else the right).
// → [{ id, x, y, align, box: [x0, y0, x1, y1] }], x and y the text's anchor (textBaseline middle).
export function placeLabels(dots, W, H, { charW = 8.2, h = 14, gap = 9, dotR = 5 } = {}) {
  const boxes = [], out = [];
  const hits = (b) => boxes.some((c) => b[0] < c[2] && b[2] > c[0] && b[1] < c[3] && b[3] > c[1])
    || dots.some(([, x, y]) => x + dotR > b[0] && x - dotR < b[2] && y + dotR > b[1] && y - dotR < b[3]);
  for (const [id, sx, sy, text] of dots) {
    const w = String(text).length * charW;
    // beside, then above and below, then the corners, then a step further out (with a leader line from the dot)
    const at = (dx, dy, align, lead = false) => {
      const x0 = align === 'left' ? sx + dx : align === 'right' ? sx + dx - w : sx + dx - w / 2;
      return { x: sx + dx, y: sy + dy, align, lead, box: [x0, sy + dy - h / 2, x0 + w, sy + dy + h / 2] };
    };
    const up = gap + h / 2 - 2, far = gap + 14;
    const tries = [
      at(gap, 0, 'left'), at(-gap, 0, 'right'), at(0, -up, 'center'), at(0, up, 'center'),
      at(gap - 3, -up, 'left'), at(-gap + 3, -up, 'right'), at(gap - 3, up, 'left'), at(-gap + 3, up, 'right'),
      at(far, 0, 'left', true), at(-far, 0, 'right', true), at(0, -up - 12, 'center', true), at(0, up + 12, 'center', true),
      at(far - 4, -up - 8, 'left', true), at(-far + 4, -up - 8, 'right', true), at(far - 4, up + 8, 'left', true), at(-far + 4, up + 8, 'right', true),
    ];
    const inside = (b) => b[0] >= 2 && b[2] <= W - 2 && b[1] >= 2 && b[3] <= H - 2;
    const pick = tries.find((t) => inside(t.box) && !hits(t.box)) || tries.find((t) => inside(t.box)) || tries[0];
    boxes.push(pick.box);
    out.push({ id, ...pick });
  }
  return out;
}

// The picture's URL: picker.picture is relative to the game's root, this file two folders below it.
const pictureUrl = (type) => (type.picker?.picture ? new URL('../../' + type.picker.picture, import.meta.url).href : '');

// A type's card: its picture, name and key numbers. A button in the picker; a plain block when `locked`
// (nothing to choose). A missing picture leaves the empty panel behind it (the error listener in createSetup).
export function typeCardHtml(type, pictureSrc = '', locked = false) {
  const k = type.picker || {};
  const cell = (label, value) => `<div><small>${label}</small>${esc(value)}</div>`;
  const tag = locked ? 'div' : 'button';
  return `<${tag} class="fsui-tc"${locked ? '' : ` type="button" data-type="${esc(type.id)}" aria-pressed="false"`}>
      <span class="fsui-tc-pic">${pictureSrc ? `<img src="${esc(pictureSrc)}" alt="">` : ''}</span>
      <span class="fsui-tc-head"><b>${esc(type.name)}</b><small>${esc(type.maker)}</small></span>
      <div class="fsui-tc-nums">
        ${cell('Length', `${k.lengthM?.toFixed(1)} m`)}${cell('Span', `${k.spanM?.toFixed(1)} m`)}${cell('MTOW', `${k.mtowT?.toLocaleString('en-US')} t`)}
        ${cell('Range', `${k.rangeNm?.toLocaleString('en-US')} nm`)}${cell('Seats', k.seats ?? '—')}${cell('Engines', type.engineName ?? '—')}
      </div>
    </${tag}>`;
}

// A saved design's card (v0.5.0): its base's picture, its name, its base and registration, and its numbers.
export function designCardHtml(def, pictureSrc = '', locked = false) {
  const d = def.design, n = designNumbers(def), T = def.base;
  const cell = (label, value) => `<div><small>${label}</small>${esc(value)}</div>`;
  const tag = locked ? 'div' : 'button';
  const t = (kg) => `${(kg / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} t`;
  return `<${tag} class="fsui-tc fsui-dc"${locked ? '' : ` type="button" data-design="${esc(d.id)}" aria-pressed="false"`}>
      <span class="fsui-tc-pic">${pictureSrc ? `<img src="${esc(pictureSrc)}" alt="">` : ''}</span>
      <span class="fsui-tc-head"><b>${esc(d.name)}</b><small>on the ${esc(T.name)} · ${esc(d.registration)}</small></span>
      <div class="fsui-tc-nums">
        ${cell('Engines', def.engineName)}${cell('OEW', t(n.oewKg))}${cell('MTOW', t(n.mtowKg))}
        ${cell('Range', `${Math.round(n.rangeNm).toLocaleString('en-US')} nm`)}${cell('Fuel', t(n.fuelCapacityKg))}${cell('T/W', n.thrustToWeight.toFixed(2))}
      </div>
    </${tag}>`;
}
// A card's key: a type by its id, a design by its own (a design shares its base's id).
const choiceKey = (t) => (t?.design ? `design:${t.design.id}` : `type:${t?.id}`);

const STAND_FILTER_MIN = 60;   // v0.6.0: a stand list longer than this gets its filter (region on)
const BASE = { ...defaultPlan(), pax: 190, cargoKg: 1500, fuelKg: 0, waypoints: [] };   // (v0.7.0: the region's first flight; East Asia's is Gimpo 14R to Jeju 07, as it was)

function loadStored() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function saveStored(plan) {
  try { const o = loadStored(); o.lastPlan = plan; localStorage.setItem(KEY, JSON.stringify(o)); } catch {}
}

export function createSetup(root, { airports, coast, types, designs } = {}) {
  let typeList = types || null;
  const typesNow = () => typeList || TYPE_LIST();
  const designList = designs || (() => designStore().list());
  const designsNow = () => { try { return (designList() || []).filter(isDesign); } catch { return []; } };
  let type = typeById(DEFAULT_TYPE);   // the selected type
  let L = type.limits;
  const list = () => airportList(airports);
  let coastL = coast ? buildCoast(coast) : null;
  let keyName = (id) => ({ pushback: 'Shift+G' })[id] || '';   // v0.5.7: the keys as bound (setKeyNames())
  const el = document.createElement('div');
  el.className = 'fsui-setup'; el.hidden = true;
  el.innerHTML = `
  <div class="fsui-dlg" role="dialog" aria-label="Flight setup">
    <h2 data-o="title">Flight setup</h2>
    <p class="sub" data-o="sub"></p>
    <div class="fsui-sec"><h3>Aircraft</h3>
      <div class="fsui-types" data-o="types" role="group" aria-label="Aircraft type"></div>
      <h4 class="fsui-designs-h" data-o="designsHead" hidden>Your designs (Warehouse)</h4>
      <div class="fsui-designs" data-o="designs" role="group" aria-label="Your designs" hidden></div>
      <div class="fsui-note fsui-types-note" data-o="typeNote"></div>
    </div>
    <div class="fsui-sec" data-o="nameRow" hidden><div class="fsui-row"><label for="fsui-setup-name">Name</label>
      <input type="text" id="fsui-setup-name" class="fsui-name" data-f="name" maxlength="${NAME_MAX + 10}" spellcheck="false" autocomplete="off">
      <span class="fsui-note">${NAME_MIN}–${NAME_MAX} characters</span></div></div>
    <div class="fsui-grid">
      <div>
        <div class="fsui-sec"><h3>Route</h3>
          <div class="fsui-row"><label>From</label><select data-f="origin"></select><select data-f="depRunway"></select></div>
          <div class="fsui-row"><label>To</label><select data-f="dest"></select><select data-f="arrRunway"></select></div>
          <div class="fsui-row"><label>Distance</label><span data-o="dist"></span></div>
        </div>
        <div class="fsui-sec"><h3>Start</h3>
          <div class="fsui-row"><div class="fsui-seg" data-seg="start">
            <button data-v="runway">On the runway</button><button data-v="final">On a 15 nm final</button><button data-v="gate" title="At a stand, with pushback (Shift+G) and a taxi route to the runway">At the gate</button>
          </div></div>
          <div class="fsui-row" data-o="standRow" style="display:none"><label>Stand</label><select data-f="stand"></select><span class="fsui-note" data-o="standNote"></span></div>
        </div>
        <div class="fsui-sec"><h3>Load</h3>
          <div class="fsui-row"><label>Passengers</label><input type="range" min="0" step="1" data-f="paxR"><input type="number" min="0" step="1" data-f="pax"><span class="fsui-note" data-o="paxNote"></span></div>
          <div class="fsui-row"><label>Cargo</label><input type="number" min="0" step="100" data-f="cargoKg"><span class="fsui-note">kg</span></div>
          <div class="fsui-row"><label>Fuel</label><input type="number" min="0" step="100" data-f="fuelKg"><span class="fsui-note">kg</span>
            <button class="fsui-b" data-a="enough">Enough for the trip + reserve</button></div>
          <div class="fsui-weights" data-o="weights"></div>
        </div>
      </div>
      <div>
        <div class="fsui-sec"><h3>Pick on the map</h3>
          <div class="fsui-row"><div class="fsui-seg" data-seg="pick"><button data-v="origin">Set origin</button><button data-v="dest">Set destination</button></div></div>
          <canvas class="fsui-mini"></canvas>
          <div class="fsui-mini-help">Click an airport to set it. Runways are listed on the left.</div>
        </div>
        <div class="fsui-sec"><h3>Time and weather</h3>
          <div class="fsui-row"><div class="fsui-seg" data-seg="time">
            <button data-v="now" title="The real time in Korea">Now</button><button data-v="set" title="A date and a time (KST)">Set</button>
          </div><span class="fsui-note" data-o="timeNote"></span></div>
          <div class="fsui-row" data-o="timeRow" hidden><input type="date" data-t="date" class="fsui-date"><input type="time" data-t="time" step="60" class="fsui-time"><span class="fsui-note">KST</span></div>
          <div class="fsui-row"><label title="The weather at the departure">Departure</label><select data-f="weather" aria-label="Weather at the departure">${PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
          <div class="fsui-row"><label title="The weather at the destination; between the two it blends along the route">Arrival</label><select data-f="weatherDest" aria-label="Weather at the destination"></select></div>
        </div>
      </div>
    </div>
    <div class="fsui-foot"><span class="msg" data-o="msg"></span><button class="fsui-b" data-a="cancel" hidden>Cancel</button><button class="fsui-b primary" data-a="fly">Fly</button></div>
  </div>`;
  root.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const f = (n) => el.querySelector(`[data-f="${n}"]`);
  const o = (n) => el.querySelector(`[data-o="${n}"]`);
  const mini = $('.fsui-mini');
  // A card's picture that isn't there: the panel behind it stays. (error doesn't bubble, so captured.)
  o('types').addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
  o('designs').addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
  let plan = null, pick = 'dest', resolver = null, opts = {};
  // The start time: 'now' or 'set' (from the date and time fields, read as KST).
  let timeMode = 'now';
  const tf = (n) => el.querySelector(`[data-t="${n}"]`);
  // v0.6.0: the start's time is the departure's local time, in its own zone (clock.js's zoneAt()
  // at the origin airport: KST, JST or CST): Now shows the real time there, and Set's fields are read in that zone.
  const depZone = () => { const a = list().find((x) => x.icao === plan?.origin); return a?.origin ? zoneAt(a.origin[0], a.origin[1]) : zoneAt(NaN, NaN); };
  const fieldValues = (ms) => zoneFieldValues(ms, depZone());
  const fromFields = (d, t) => zoneFromFields(d, t, depZone());
  function setTimeMode(mode, ms) {
    timeMode = mode === 'set' ? 'set' : 'now';
    if (Number.isFinite(ms) || (timeMode === 'set' && !tf('date').value)) {
      const v = fieldValues(Number.isFinite(ms) ? ms : Date.now());
      tf('date').value = v.date; tf('time').value = v.time;
    }
    seg('time', timeMode);
    o('timeRow').hidden = timeMode !== 'set';
    showZone();
  }
  // The time row's note and labels for the departure's zone.
  function showZone() {
    const now = Date.now();
    const z = depZone(), zn = zoneLabel(z, now);   // (v0.7.0: the name in force now: BST or GMT, CEST or CET)
    o('timeNote').textContent = timeMode === 'now' ? `${fmtZone(now, z)} ${zn}, ${fmtZoneDate(now, z)}` : '';
    const lbl = o('timeRow').querySelector('.fsui-note');
    if (lbl) { lbl.textContent = zn; lbl.title = `The departure's local time (${z.timeZone})`; }
    const bNow = el.querySelector('[data-seg="time"] [data-v="now"]'), bSet = el.querySelector('[data-seg="time"] [data-v="set"]');
    if (bNow) bNow.title = 'The real time at the departure';
    if (bSet) bSet.title = `A date and a time at the departure (${zn})`;
  }

  // Keys typed here never reach the game (the name field included); Enter flies, Esc cancels.
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); fly(); }
    else if (e.key === 'Escape' && opts.cancel) { e.preventDefault(); cancel(); }
  });
  // The name field stops its keys itself (so no game key fires while typing), with the same Enter and Esc.
  f('name').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); fly(); }
    else if (e.key === 'Escape' && opts.cancel) { e.preventDefault(); cancel(); }
  });
  el.addEventListener('keyup', (e) => e.stopPropagation());
  for (const t of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu']) el.addEventListener(t, (e) => e.stopPropagation());
  el.addEventListener('wheel', (e) => { e.stopPropagation(); if (!e.target.closest('.fsui-dlg')) e.preventDefault(); }, { passive: false });

  const opt = (sel, items, val) => {
    sel.innerHTML = items.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    sel.value = items.some(([v]) => v === val) ? val : items[0]?.[0] ?? '';
    return sel.value;
  };
  // v0.6.0: the airports grouped by country (optgroups), each named short, its full name as the option's title.
  const optAirports = (sel, val) => {
    const esc1 = (t) => esc(String(t ?? ''));
    sel.innerHTML = airportGroups(list()).map((g) => `<optgroup label="${esc1(g.label)}">${g.airports.map((a) => `<option value="${esc1(a.icao)}" title="${esc1(a.name)}">${esc1(airportOption(a))}</option>`).join('')}</optgroup>`).join('');
    const all = list();
    sel.value = all.some((a) => a.icao === val) ? val : (airportGroups(all)[0]?.airports[0]?.icao ?? '');
    return sel.value;
  };
  // v0.6.2: an end with no straight-in approach (runways.js CIRCLING_ONLY: Gimhae's 18L and 18R) says so
  // v0.7.0: an end used one way in its AIP (runways.js ONE_WAY) says so, and a standby runway's ends come after the
  // others, so they are never the default.
  // v0.7.5 (Shane: every end can be picked): the ends the AIP doesn't use for this (`what`: 'dep' or 'arr') are no
  // longer left out; they come last, after the standby ones, with their note.
  const ends = (icao, what) => runwayEndList(list().find((a) => a.icao === icao), what);
  const endObj = (icao, ident) => {
    for (const r of list().find((a) => a.icao === icao)?.runways || []) for (const e of r.ends) if (e.ident === ident) return e;
    return null;
  };
  // The stands this type can use at an airport: gates first, then the rest, numbers in number order.
  const standsAt = (icao) => standList(list().find((a) => a.icao === icao), type);
  const stands = (icao) => standsAt(icao).map((s) => [s.ref, `${s.gate ? 'Gate' : 'Stand'} ${s.ref}`]);
  const distNm = () => {
    const a = endObj(plan.origin, plan.depRunway), b = endObj(plan.dest, plan.arrRunway);
    if (!a || !b) return 0;
    const pts = [thresholdOf(a), ...(plan.waypoints || []), thresholdOf(b)];
    let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return d / NM;
  };

  // v0.6.0: a long stand list (Pudong's, Narita's, Qingdao's hundreds) gets a filter beside it: what's typed narrows
  // the list to the stands whose number holds it ("11" → 110–119, 211…). Made once, the first time a list is long.
  let standFind = null;
  function filterStands(st) {
    const long = st.length > STAND_FILTER_MIN;
    if (!standFind && long) {
      standFind = document.createElement('input');
      standFind.type = 'search'; standFind.className = 'fsui-stand-find'; standFind.placeholder = 'Find a stand';
      standFind.setAttribute('aria-label', 'Find a stand'); standFind.spellcheck = false; standFind.autocomplete = 'off';
      f('stand').after(standFind);
      standFind.addEventListener('input', (e) => { e.stopPropagation(); applyStandFilter(); });
      standFind.addEventListener('change', (e) => e.stopPropagation());
      standFind.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); } });
    }
    if (!standFind) return;
    standFind.hidden = !long;
    if (!long || standFind.dataset.at !== plan.origin) standFind.value = '';   // a new origin starts unfiltered
    standFind.dataset.at = plan.origin;
    applyStandFilter(st);
  }
  function applyStandFilter(st = stands(plan.origin)) {
    const q = standFind && !standFind.hidden ? standFind.value.trim().toUpperCase() : '';
    const m = q ? st.filter(([ref]) => String(ref).toUpperCase().includes(q)) : st;
    if (!m.length) { f('stand').innerHTML = `<option value="" disabled selected>No stand ${esc(q)}</option>`; return; }
    if (q || f('stand').options.length !== st.length) plan.stand = opt(f('stand'), m, plan.stand);
    if (standFind) standFind.title = q ? `${m.length} of ${st.length} stands` : `${st.length} stands`;
  }

  const weatherNote = () => PRESETS.find((p) => p.id === plan.weather)?.note || '';
  function fill() {
    plan.origin = optAirports(f('origin'), plan.origin);
    plan.depRunway = opt(f('depRunway'), ends(plan.origin, 'dep'), plan.depRunway);
    plan.dest = optAirports(f('dest'), plan.dest);
    plan.arrRunway = opt(f('arrRunway'), ends(plan.dest, 'arr'), plan.arrRunway);
    const st = stands(plan.origin);
    plan.stand = st.length ? opt(f('stand'), st, plan.stand) : '';
    if (!st.length) f('stand').innerHTML = '';
    filterStands(st); showZone();
    f('pax').value = f('paxR').value = plan.pax;
    f('cargoKg').value = plan.cargoKg;
    f('fuelKg').value = plan.fuelKg;
    plan.weather = opt(f('weather'), PRESETS.map((p) => [p.id, p.name]), plan.weather);
    f('weather').title = weatherNote();
    // v0.7.4: the destination's weather, the departure's unless picked ('' is "the same").
    plan.weatherDest = opt(f('weatherDest'), [['', 'Same as departure'], ...PRESETS.map((p) => [p.id, p.name])], plan.weatherDest || '');
    f('weatherDest').title = PRESETS.find((p) => p.id === plan.weatherDest)?.note || 'The departure’s weather';
    // A circuit (back to the same airport) has one place, so one weather: the Arrival picker is off.
    const circuit = plan.origin === plan.dest;
    f('weatherDest').disabled = circuit;
    if (circuit) { plan.weatherDest = ''; f('weatherDest').value = ''; f('weatherDest').title = 'A circuit: one weather, the departure’s picker'; }
    seg('start', plan.start); seg('pick', pick);
    refresh();
  }
  function seg(name, v) {
    for (const b of el.querySelectorAll(`[data-seg="${name}"] button`)) b.classList.toggle('on', b.dataset.v === v);
    if (name === 'start') {
      o('standRow').style.display = v === 'gate' ? '' : 'none';
      const all = standsAt(plan.origin), n = all.length, g = all.filter((s) => s.gate).length;
      const pk = keyName('pushback');   // v0.5.7: the pushback's key as bound (the Controls page's)
      o('standNote').textContent = n ? `${g} gates, ${n - g} remote stands${pk ? ` · ${pk} pushes back` : ''}` : noStands();
    }
  }

  // Whether the airport has no stands at all, or none for this aircraft.
  const noStands = () => ((list().find((a) => a.icao === plan.origin)?.stands || []).some((s) => s.ref) ? `No stand here for the ${type.name}` : 'No stands mapped here');

  // ---- The aircraft ----
  const enoughFuel = (t, d) => Math.min(t.limits.FUEL_MAX, fuelEstimate(d, t).total);
  // An id to a type: from the list, else (a locked scenario's type, which may not be on it) the registry.
  const findType = (id, locked) => typesNow().find((t) => t.id === id) || (locked ? typeById(id) : typesNow()[0] || typeById(id));
  function setType(t) {
    type = t; L = t.limits;
    f('paxR').max = f('pax').max = L.PAX_MAX;
    f('cargoKg').max = L.CARGO_MAX;
    f('fuelKg').max = L.FUEL_MAX;
    o('paxNote').textContent = `× ${L.PAX_KG} kg incl. bags`;
    o('sub').textContent = `${t.name} · Nuclear Airlines · ${t.registration}`;
    const key = choiceKey(t);
    for (const c of el.querySelectorAll('button.fsui-tc')) {
      const on = (c.dataset.design ? `design:${c.dataset.design}` : `type:${c.dataset.type}`) === key;
      c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    o('typeNote').textContent = opts.lockType ? 'A scenario keeps its aircraft. New scenario to fly another.'
      : t.design ? `${t.name}: ${t.engineName} on the ${t.base.name}, its limits and fuel rule from the Warehouse.` : (t.picker?.note || '');
  }
  function renderTypes() {
    const locked = !!opts.lockType;
    const shown = locked ? (type.design ? [] : [type]) : typesNow();
    const dl = locked ? (type.design ? [type] : []) : designsNow().map((d) => designDef(d));
    o('types').className = `fsui-types n${shown.length}`;
    o('types').hidden = !shown.length;
    o('types').innerHTML = shown.map((t) => typeCardHtml(t, pictureUrl(t), locked)).join('');
    o('designs').innerHTML = dl.map((t) => designCardHtml(t, pictureUrl(t), locked)).join('');
    o('designs').className = `fsui-designs${locked ? ' fsui-types n1' : ''}`;
    o('designs').hidden = o('designsHead').hidden = !dl.length;
    if (locked) (o('types').firstElementChild || o('designs').firstElementChild)?.classList.add('on');
    setType(type);
  }
  // The player picks another type: the limits, the fuel rule and the stands follow. The load stays if it
  // fits; the fuel follows too if it was the old type's "enough", and is cut if it won't fit the tanks.
  function chooseType(id) { choose(findType(id)); }
  // A design's heavier engines can leave less payload room than its base's default load: fewer passengers, then
  // less cargo, until it fits.
  function fitDesignLoad(t) {
    if (!t.design) return;
    const l = t.limits, room = l.MZFW - l.OEW;
    if (plan.pax * l.PAX_KG + plan.cargoKg <= room) return;
    plan.pax = Math.max(0, Math.min(plan.pax, Math.floor((room - plan.cargoKg) / l.PAX_KG)));
    if (plan.pax * l.PAX_KG + plan.cargoKg > room) plan.cargoKg = Math.max(0, Math.floor((room - plan.pax * l.PAX_KG) / 100) * 100);
  }
  function chooseDesign(id) {
    const d = designsNow().find((x) => x.id === id);
    if (d) choose(designDef(d));
  }
  function choose(next) {
    if (choiceKey(next) === choiceKey(type)) return;
    readInputs();
    const d = distNm(), wasEnough = plan.fuelKg === enoughFuel(type, d);
    setType(next);
    plan.type = next.id;
    Object.assign(plan, fitLoad(plan, next));
    fitDesignLoad(next);
    if (wasEnough || plan.fuelKg > L.FUEL_MAX) plan.fuelKg = enoughFuel(next, d);
    fill();
  }

  const num = (v, lo, hi) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo; };
  function readInputs(src) {
    if (src === f('paxR')) f('pax').value = f('paxR').value;
    if (src === f('pax')) f('paxR').value = f('pax').value;
    plan.pax = num(f('pax').value, 0, L.PAX_MAX);
    plan.cargoKg = num(f('cargoKg').value, 0, 100000);
    plan.fuelKg = num(f('fuelKg').value, 0, Math.max(100000, L.FUEL_MAX * 2)); // room above the tanks, so the "tanks hold" message can fire
  }

  // Weights and the checks; returns the first blocking problem, or ''.
  function refresh() {
    const d = distNm(), est = fuelEstimate(d, type);
    o('dist').textContent = d ? `${Math.round(d)} nm` + (plan.origin === plan.dest ? ' (same airport: a circuit)' : '') : '–';
    const payload = plan.pax * L.PAX_KG + plan.cargoKg;
    const zfw = L.OEW + payload, tow = zfw + plan.fuelKg, lw = Math.round((tow - Math.min(plan.fuelKg, est.trip + 200)) / 10) * 10;
    const problems = [];
    let warn = '';
    if (plan.cargoKg > L.CARGO_MAX) problems.push(`Cargo is over the hold's ${L.CARGO_MAX.toLocaleString()} kg.`);
    if (plan.fuelKg > L.FUEL_MAX) problems.push(`The tanks hold ${L.FUEL_MAX.toLocaleString()} kg.`);
    if (zfw > L.MZFW) problems.push(`Zero-fuel weight is over the ${L.MZFW.toLocaleString()} kg limit.`);
    if (tow > L.MTOW) problems.push(`Take-off weight is over MTOW (${L.MTOW.toLocaleString()} kg).`);
    if (plan.fuelKg < 600) problems.push('Load some fuel.');
    // v0.6.2: no 15 nm final to an end that's only flown by a circle (its straight-in path meets the hills)
    const arr = endObj(plan.dest, plan.arrRunway);
    if (plan.start === 'final' && arr?.circling) {
      const other = circleFrom(list().find((a) => a.icao === plan.dest), plan.arrRunway);   // (v0.6.4: the end with the approach, not always this runway's other end)
      problems.push(`${plan.arrRunway} has no straight-in approach (it's flown by a circle from the approach to ${other?.ident || 'the other end'}): pick another runway for a 15 nm final.`);
    }
    // v0.5.3: a design whose engines or tanks touch the ground standing would end the flight as it starts
    if (type.design && designNumbers(type).touchesGround) problems.push('Its engines or tanks touch the ground standing: lengthen the gear or move them up in the warehouse.');
    if (!problems.length && plan.fuelKg < est.total) warn = 'Less fuel than the trip + reserve estimate.';
    if (!problems.length && lw > L.MLW) warn = 'Landing weight will be over MLW: burn fuel first or expect a heavy landing.';
    const row = (t, v, lim, cls = '') => `${t} <b class="${cls}">${Math.round(v).toLocaleString()}</b> kg${lim ? ` / ${lim.toLocaleString()}` : ''}`;
    o('weights').innerHTML = [
      `Payload <b>${payload.toLocaleString()}</b> kg · ZFW ${row('', zfw, L.MZFW, zfw > L.MZFW ? 'bad' : '').trim()}`,
      `${row('Take-off', tow, L.MTOW, tow > L.MTOW ? 'bad' : '')} · ${row('Landing (est.)', lw, L.MLW, lw > L.MLW ? 'warn' : '')}`,
      `Trip fuel ≈ <b>${est.trip.toLocaleString()}</b> kg · with 30 min reserve, 5 % and taxi: <b>${est.total.toLocaleString()}</b> kg`,
    ].join('<br>');
    o('msg').textContent = problems[0] || warn;
    o('msg').style.color = problems.length ? C.red : C.amber;
    $('[data-a="fly"]').disabled = problems.length > 0;
    drawMini();
    return problems[0] || '';
  }

  el.addEventListener('input', (e) => {
    if (e.target === f('name')) { refresh(); return; }
    if (e.target.dataset.t) return;   // the start time's fields are read on Fly
    if (e.target.matches('input')) { readInputs(e.target); refresh(); }
  });
  el.addEventListener('change', (e) => {
    const n = e.target.dataset.f;
    if (n === 'origin') { plan.origin = e.target.value; plan.depRunway = ''; plan.stand = ''; fill(); }
    else if (n === 'stand') { plan.stand = e.target.value; }
    else if (n === 'dest') { plan.dest = e.target.value; plan.arrRunway = ''; fill(); }
    else if (n === 'depRunway' || n === 'arrRunway') { plan[n] = e.target.value; refresh(); }
    else if (n === 'weather') { plan.weather = e.target.value; f('weather').title = weatherNote(); }
    else if (n === 'weatherDest') { plan.weatherDest = e.target.value; f('weatherDest').title = PRESETS.find((p) => p.id === plan.weatherDest)?.note || 'The departure’s weather'; }
    else if (e.target === f('name') || e.target.dataset.t) { /* read on Fly */ }
    else if (e.target.matches('input')) { readInputs(e.target); fill(); }
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.type) { chooseType(b.dataset.type); return; }
    if (b.dataset.design) { chooseDesign(b.dataset.design); return; }
    const sg = b.closest('[data-seg]');
    if (sg && !b.disabled) {
      if (sg.dataset.seg === 'time') { setTimeMode(b.dataset.v); return; }
      if (sg.dataset.seg === 'start') plan.start = b.dataset.v; else pick = b.dataset.v;
      seg(sg.dataset.seg, b.dataset.v); refresh();
    } else if (b.dataset.a === 'enough') {
      plan.fuelKg = enoughFuel(type, distNm()); f('fuelKg').value = plan.fuelKg; refresh();
    } else if (b.dataset.a === 'fly') fly();
    else if (b.dataset.a === 'cancel') cancel();
  });

  // The small map: airports, the route line, click an airport to pick it.
  const miniState = { k: 1, cx: 0, cy: 0, pts: [] };
  function drawMini() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3), W = 300, H = 300;
    // (v0.6.0: the height is checked too: a new canvas is 300 × 150, so at a pixel ratio of 1 the
    // width already matched and the map drew stretched to twice its height.)
    if (mini.width !== W * dpr || mini.height !== H * dpr) { mini.width = W * dpr; mini.height = H * dpr; }
    const ctx = mini.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#06101c'; ctx.fillRect(0, 0, W, H);
    const aps = list();
    if (!aps.length) return;
    drawMiniRegion(ctx, W, H, aps);
  }
  // v0.6.0: the region's small map. The airports' box fitted both ways (the region is wide), dots a little smaller, and
  // each label put where it hits no other label or dot (placeLabels()); a click on a label picks its airport too, so the
  // close pairs (Pudong and Hongqiao, Haneda and Narita, 5 to 8 px apart here) can each be picked.
  function drawMiniRegion(ctx, W, H, aps) {
    const { k, cx, cy } = miniRegionFrame(aps, W, H), hw = W / 2 / k, hh = H / 2 / k;
    Object.assign(miniState, { k, cx, cy });
    const X = (x) => W / 2 + (x - cx) * k, Y = (y) => H / 2 - (y - cy) * k;
    if (coastL) {
      ctx.beginPath();
      traceRings(ctx, coastL.land, coastL.lod(1 / k), { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh }, (x, y, p) => { p[0] = X(x); p[1] = Y(y); return p; }, 2 / k);
      ctx.fillStyle = '#1c2a22'; ctx.fill('evenodd'); ctx.strokeStyle = '#46775a'; ctx.lineWidth = 1; ctx.stroke();
    }
    const a = endObj(plan.origin, plan.depRunway), b = endObj(plan.dest, plan.arrRunway);
    if (a && b) {   // the route as a straight line on the map (the frame is conformal: within about 0.5 % of the great circle)
      ctx.strokeStyle = C.magenta; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); for (const [x, y] of plan.waypoints || []) ctx.lineTo(X(x), Y(y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
    }
    // the picked ones last, so their dots and labels sit on top and get the first choice of place
    const order = [...aps].sort((p, q) => (p.icao === plan.origin || p.icao === plan.dest ? -1 : 0) - (q.icao === plan.origin || q.icao === plan.dest ? -1 : 0));
    const dots = order.map((ap) => [ap.icao, X(ap.origin[0]), Y(ap.origin[1]), ap.icao]);
    const labels = placeLabels(dots, W, H, MINI_LABEL);
    miniState.pts = dots.map(([icao, sx, sy]) => [icao, sx, sy]);
    miniState.labels = labels;
    ctx.font = font(12, true); ctx.textBaseline = 'middle';
    for (let i = dots.length - 1; i >= 0; i--) {
      const [icao, sx, sy] = dots[i], L = labels[i];
      const col = icao === plan.origin ? C.green : icao === plan.dest ? C.magenta : C.white;
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx, sy, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#06101c'; ctx.lineWidth = 1; ctx.stroke();
      if (L.lead) {   // a label set further out: a thin line from its dot to the label's near edge
        const ex = Math.max(L.box[0], Math.min(sx, L.box[2])), ey = Math.max(L.box[1], Math.min(sy, L.box[3]));
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      }
      ctx.fillStyle = col; ctx.textAlign = L.align; ctx.fillText(icao, L.x, L.y);
    }
  }
  mini.addEventListener('click', (e) => {
    const r = mini.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    let best = null, bd = 28;
    for (const [icao, x, y] of miniState.pts) { const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = icao; } }
    const lab = miniState.labels?.find((L) => sx >= L.box[0] - 2 && sx <= L.box[2] + 2 && sy >= L.box[1] - 2 && sy <= L.box[3] + 2);
    if (lab && !(bd < 6)) best = lab.id;   // v0.6.0: a label picks its airport (a dot right under the pointer still wins)
    if (!best) return;
    if (pick === 'origin') { plan.origin = best; plan.depRunway = ''; plan.stand = ''; pick = 'dest'; }
    else { plan.dest = best; plan.arrRunway = ''; }
    fill();
  });

  function fly() {
    readInputs();
    if (refresh()) return;
    if (opts.nameField && !nameOk(f('name').value)) {
      o('msg').textContent = `Give the scenario a name of ${NAME_MIN}–${NAME_MAX} characters.`; o('msg').style.color = C.red;
      f('name').focus(); return;
    }
    let startMs = null;
    if (timeMode === 'set') {
      startMs = fromFields(tf('date').value, tf('time').value);
      if (startMs === null) { o('msg').textContent = 'Pick a date and a time for the start, or choose Now.'; o('msg').style.color = C.red; tf('date').focus(); return; }
    }
    if (plan.start === 'gate' && !plan.stand) { o('msg').textContent = `${noStands()}: start on the runway.`; o('msg').style.color = C.red; return; }
    const out = { origin: plan.origin, depRunway: plan.depRunway, dest: plan.dest, arrRunway: plan.arrRunway, start: plan.start, type: type.id,
      pax: plan.pax, cargoKg: plan.cargoKg, fuelKg: plan.fuelKg, waypoints: (plan.waypoints || []).map((p) => [p[0], p[1]]),
      payloadKg: plan.pax * L.PAX_KG + plan.cargoKg };
    if (type.design) out.design = JSON.parse(JSON.stringify(type.design));   // its own copy (the type entry's is frozen)
    if (plan.start === 'gate') out.stand = plan.stand;
    saveStored(out);
    if (opts.nameField) out.name = cleanName(f('name').value);
    out.time = timeMode === 'set' ? { mode: 'set', ms: startMs } : { mode: 'now' };
    out.weather = plan.weather || 'clear';
    if (plan.weatherDest && plan.weatherDest !== out.weather) out.weatherDest = plan.weatherDest;   // v0.7.4 (absent: the same)
    setWaypoints(out.waypoints);
    hide();
    const r = resolver; resolver = null; r?.(out);
  }
  function cancel() {
    hide();
    const r = resolver; resolver = null; r?.(null);
  }
  function hide() { if (el.contains(document.activeElement)) document.activeElement.blur(); el.hidden = true; }

  // The aircraft at the start: defaults.design (as given when locked, else the stored one with its id), the
  // last plan's design when the defaults name none, else defaults.type.
  function pickStart(defaults, locked) {
    const last = loadStored().lastPlan;
    const want = defaults?.design ?? (!locked && (defaults?.type === undefined || defaults.type === last?.type) ? last?.design : null);
    if (isDesign(want)) {
      if (locked) { const n = designName(want.id, want.name); return designDef(n && n !== want.name ? { ...want, name: n } : want); }   // v0.5.8
      const stored = designsNow().find((d) => d.id === want.id);
      if (stored) return designDef(stored);
    }
    return findType((isDesign(want) ? want.base : null) ?? defaults?.type ?? DEFAULT_TYPE, locked);
  }

  // show(defaults, opts): the built-in plan, then the last plan, then the given defaults.
  function show(defaults = {}, options = {}) {
    opts = options || {};
    type = pickStart(defaults, !!opts.lockType);
    // The last plan's load and stand belong to its own type (or design): they don't carry over to another.
    const last = { ...(loadStored().lastPlan || {}) };
    delete last.weather; delete last.weatherDest;   // a new scenario starts clear; only the given defaults carry a weather
    if ((last.type || DEFAULT_TYPE) !== type.id || (last.design?.id ?? null) !== (type.design?.id ?? null)) { delete last.pax; delete last.cargoKg; delete last.fuelKg; delete last.stand; }
    // v0.7.0: a last plan or a default from another region (its airports aren't here) gives way to this region's first flight.
    const here = (p) => (planInRegion(p) ? p : { ...p, ...defaultPlan(), stand: undefined, waypoints: [] });
    plan = { ...BASE, ...type.defaults, ...here(last), ...here(defaults || {}), type: type.id };
    delete plan.name; delete plan.design;   // the design is `type` (its entry), and goes back out on Fly
    if (!opts.lockType) fitDesignLoad(type);
    const t = defaults?.time;
    delete plan.time;
    tf('date').value = ''; tf('time').value = '';
    setTimeMode(t?.mode === 'set' && Number.isFinite(t.ms) ? 'set' : 'now', t?.mode === 'set' ? t.ms : undefined);
    if (!plan.fuelKg) { plan.fuelKg = 0; }
    $('[data-o="title"]').textContent = opts.title || 'Flight setup';
    el.querySelector('.fsui-dlg').setAttribute('aria-label', opts.title || 'Flight setup');
    o('nameRow').hidden = !opts.nameField;
    f('name').value = opts.nameField ? (opts.name || '') : '';
    $('[data-a="cancel"]').hidden = !opts.cancel;
    renderTypes();
    el.hidden = false;
    fill();
    if (!plan.fuelKg) { plan.fuelKg = enoughFuel(type, distNm()); f('fuelKg').value = plan.fuelKg; refresh(); }
    if (opts.nameField) { f('name').focus({ preventScroll: true }); f('name').select(); }
    else $('[data-a="fly"]').focus({ preventScroll: true });
    return new Promise((res) => { resolver = res; });
  }

  // A new list for the picker (the tests' three-type list). Applies at once if the dialog is open.
  function setTypes(l) {
    typeList = l || null;
    if (el.hidden) return;
    if (type.design) { renderTypes(); fill(); return; }
    const stay = typesNow().find((t) => t.id === type.id);
    if (stay) { type = stay; renderTypes(); fill(); }
    else { renderTypes(); chooseType(typesNow()[0]?.id); }
  }

  // v0.5.7: the keys as bound (main.js: keys.js keyNamesOf()): the pushback's, in the gate start's title and note.
  function setKeyNames(fn) {
    if (typeof fn === 'function') keyName = fn;
    const pk = keyName('pushback'), b = el.querySelector('[data-seg="start"] [data-v="gate"]');
    if (b) b.title = `At a stand, with pushback${pk ? ` (${pk})` : ''} and a taxi route to the runway`;
  }
  return { show, hide, setTypes, setKeyNames, setCoast(c) { coastL = c ? buildCoast(c) : null; if (!el.hidden) drawMini(); }, get isOpen() { return !el.hidden; } };
}
