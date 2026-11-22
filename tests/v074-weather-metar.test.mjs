// v0.7.4, weather by place: each airport's METAR is its own. The departure's and the destination's from their
// ends' weathers, any other airport's from the air at its place, each in its country's form (one test a form:
// kr, jp, cn, ru, kp, eu).
import test from 'node:test';
import assert from 'node:assert/strict';
import { withEndWeather, calmWeather, weatherAt } from '../src/sim/weather.js';
import { presetWeather, metarOf, airportWeather } from '../src/sim/weather-presets.js';

const ENDS = { ax: 0, ay: -40000, bx: 0, by: 50000 };
// A route between two airports of the given codes, calm at the departure and rain at the destination, with a
// third airport in the middle of the blend (MID) and one in the destination's third (NEAR).
function route(dep, dest, mid, near) {
  const ctx = {
    refX: ENDS.bx, refY: ENDS.by, ends: ENDS,
    departure: { icao: dep, origin: [ENDS.ax, ENDS.ay] }, arrival: { icao: dest },
    airports: [{ x: ENDS.ax, y: ENDS.ay }, { x: ENDS.bx, y: ENDS.by }],
  };
  Object.defineProperty(ctx, 'places', { value: { [dep]: { x: ENDS.ax, y: ENDS.ay }, [dest]: { x: ENDS.bx, y: ENDS.by }, [mid]: { x: 0, y: 5000 }, [near]: { x: 3000, y: 30000 } }, enumerable: false });
  const rain = presetWeather('rain', ctx);
  return { ctx, rain, s: withEndWeather(rain, 'dep', calmWeather(), ENDS) };
}

function checkForm(dep, dest, mid, near, depLine, destRe, midRe) {
  const { ctx, rain, s } = route(dep, dest, mid, near);
  assert.equal(metarOf(s, dep, ctx), depLine);
  assert.match(metarOf(s, dest, ctx), destRe);
  assert.equal(metarOf(s, dest, ctx), metarOf(rain, dest, ctx), 'the destination\'s is its own weather\'s');
  // Another airport in the destination's third: the destination's air, under its own code.
  assert.equal(metarOf(s, near, ctx), metarOf(rain, near, null));
  // One in the middle: the blend's (lighter rain, the QNH between).
  const m = metarOf(s, mid, ctx);
  assert.match(m, midRe);
  assert.notEqual(m.slice(5), metarOf(rain, near, null).slice(5));
  assert.equal(m, metarOf(weatherAt(s, 0, 5000), mid, null));
}

test('kr: Korea\'s form at both ends and between', () => {
  checkForm('RKSS', 'RKPC', 'RKPK', 'RKTU', 'RKSS 00000KT CAVOK 15/07 Q1013',
    /^RKPC 20014G22KT 4000 RA BKN012 OVC035 12\/10 Q1006$/, /^RKPK \d{5}(G\d\d)?KT .*-RA .* Q10(0[7-9]|1[0-2])$/);
});

test('jp: Japan\'s form, the inches in the remarks', () => {
  checkForm('RJTT', 'RJAA', 'RJSS', 'RJSN', 'RJTT 00000KT CAVOK 15/07 Q1013 RMK A2992',
    /^RJAA 20014G22KT 4000 RA BKN012 OVC035 12\/10 Q1006 RMK A2971$/, /^RJSS .*-RA .* RMK A\d{4}$/);
});

test('cn: China\'s form, the wind in metres a second', () => {
  checkForm('ZSPD', 'ZBAA', 'ZYTX', 'ZYTL', 'ZSPD 00000MPS CAVOK 15/07 Q1013',
    /^ZBAA 20007G11MPS 4000 RA BKN012 OVC035 12\/10 Q1006$/, /^ZYTX \d{5}(G\d\d)?MPS .*-RA /);
});

test('ru: Russia\'s form, the wind in metres a second', () => {
  checkForm('UHWW', 'UHHH', 'UHWX', 'UHWY', 'UHWW 00000MPS CAVOK 15/07 Q1013', /^UHHH 20007G11MPS 4000 RA /, /^UHWX .*MPS .*-RA /);
});

test('kp: North Korea\'s form', () => {
  checkForm('ZKPY', 'ZKWS', 'ZKXX', 'ZKYY', 'ZKPY 00000MPS CAVOK 15/07 Q1013', /^ZKWS 20007G11MPS 4000 RA /, /^ZKXX .*MPS .*-RA /);
});

test('eu: Europe\'s form, ending NOSIG (Heathrow calm, Frankfurt in rain)', () => {
  checkForm('EGLL', 'EDDF', 'EBBR', 'EDDK', 'EGLL 00000KT CAVOK 15/07 Q1013 NOSIG',
    /^EDDF 20014G22KT 4000 RA BKN012 OVC035 12\/10 Q1006 NOSIG$/, /^EBBR .*-RA .* NOSIG$/);
});

test('a single weather is every airport\'s, as before', () => {
  const { ctx, rain } = route('RKSS', 'RKPC', 'RKPK', 'RKTU');
  for (const icao of ['RKSS', 'RKPC', 'RKPK']) {
    assert.equal(airportWeather(rain, icao, ctx).settings, rain);
    assert.equal(metarOf(rain, icao, ctx), metarOf(rain, icao, ctx));
  }
  assert.equal(metarOf(rain, 'RKSS', ctx), 'RKSS 20014G22KT 4000 RA BKN012 OVC035 12/10 Q1006');
});
