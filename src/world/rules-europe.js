// Europe's local rules (v0.7.0, briefs/V0-7-0.md Part 5): each country's time zone (with summer time, through
// Intl: no fixed offsets), its altimeter and altitude units (hectopascals and feet everywhere), its transition
// altitude, and the transition altitudes that are set airport by airport (the United Kingdom, Spain and Italy
// publish them in each airport's AD 2.17; most others nationally, in ENR 1.7). No imports: region.js builds its
// lookups from these tables, and the tests read them directly.
//
// A transition level here is one value, the standard day's: the first flight level at least 1,000 ft above the
// transition altitude with the QNH at 1013 hPa or more (the AIPs give it by QNH band, or leave it to ATC), as
// Russia's is in East Asia.
//
// [EST] marks a value not yet read from that country's AIP in this run (from general knowledge of the published
// figure); the others name the page they were read from. See STATUS.md's v0.7.0 entries for when each was read.

const FT_M = 0.3048;
const base = { baroUnit: 'hPa', metricAlt: false, metar: 'eu' };
// (transition altitude ft, the standard day's level as a flight level)
const rule = (country, timeZone, zoneName, zoneNameSummer, taFt, tlFl, note = '') => Object.freeze({
  ...base, country, timeZone, zoneName, zoneNameSummer, transAltM: taFt * FT_M, transLevelM: tlFl * 100 * FT_M, note,
});

// Western European time (WET/WEST), Greenwich (GMT, and BST or IST in summer), Central European (CET/CEST).
export const EUROPE_RULES = Object.freeze({
  // v0.7.0's seven, whose airports are flown: full rules.
  GB: rule('GB', 'Europe/London', 'GMT', 'BST', 3000, 40, 'UK ENR 1.7: 3,000 ft outside the airports that set their own (AD 2.17); the Isle of Man, Jersey and Guernsey on these rules'),
  FR: rule('FR', 'Europe/Paris', 'CET', 'CEST', 5000, 60, 'France: 5,000 ft at Paris; set by TMA elsewhere [EST]'),
  DE: rule('DE', 'Europe/Berlin', 'CET', 'CEST', 5000, 60, 'Germany ENR 1.7: 5,000 ft everywhere; FL60 with the QNH at 1013 hPa or more, FL70 below'),
  ES: rule('ES', 'Europe/Madrid', 'CET', 'CEST', 6000, 70, 'Spain: 6,000 ft, but each airport sets its own (AD 2.17): Madrid 13,000 ft'),
  CH: rule('CH', 'Europe/Zurich', 'CET', 'CEST', 7000, 80, 'Switzerland: 7,000 ft at Zurich and Geneva [EST elsewhere]'),
  NL: rule('NL', 'Europe/Amsterdam', 'CET', 'CEST', 3000, 40, 'the Netherlands ENR 1.7: 3,000 ft for IFR flights'),
  IT: rule('IT', 'Europe/Rome', 'CET', 'CEST', 6000, 70, 'Italy: each airport sets its own (AD 2.17); 6,000 ft at Rome [EST elsewhere]; San Marino and the Vatican on these rules'),
  // The rest of the region: the zone and a default rule each, [EST] until Update 7's sub-updates read their AIPs.
  IE: rule('IE', 'Europe/Dublin', 'GMT', 'IST', 5000, 60, 'Ireland ENR 1.7 2.1.3 (AIRAC 29 OCT 2026): 5,000 ft at every Irish ATC aerodrome; EIDW AD 2.17 the same'),
  PT: rule('PT', 'Europe/Lisbon', 'WET', 'WEST', 4000, 50, '[EST] Portugal\'s eAIP was under maintenance on 2026-11-21 (HTTP 503): 4,000 ft at Lisbon from a public airport database, not the AIP'),
  BE: rule('BE', 'Europe/Brussels', 'CET', 'CEST', 4500, 60, '[EST] Belgium\'s eAIP refused the script on 2026-11-21 (HTTP 403): 4,500 ft from general knowledge of the published figure'),
  LU: rule('LU', 'Europe/Luxembourg', 'CET', 'CEST', 4500, 60, '[EST]'),
  AT: rule('AT', 'Europe/Vienna', 'CET', 'CEST', 10000, 110, 'Austria ENR 1.7 2.1.4 (AMDT 358): "Transition altitude within FIR Wien is established at 10000 FT AMSL" (Innsbruck excepted); LOWW AD 2.17 the same'),
  LI: rule('LI', 'Europe/Vaduz', 'CET', 'CEST', 7000, 80, '[EST] Switzerland\'s'),
  MC: rule('MC', 'Europe/Monaco', 'CET', 'CEST', 5000, 60, '[EST] France\'s'),
  AD: rule('AD', 'Europe/Andorra', 'CET', 'CEST', 6000, 70, '[EST] Spain\'s'),
  DK: rule('DK', 'Europe/Copenhagen', 'CET', 'CEST', 3000, 40, 'Denmark ENR 1.7 1.2: "The transition altitude for København FIR is 3000 FT MSL, except for Copenhagen Area, where the transition altitude is 5000 FT MSL."'),
  SE: rule('SE', 'Europe/Stockholm', 'CET', 'CEST', 5000, 60, '[EST]'),
  NO: rule('NO', 'Europe/Oslo', 'CET', 'CEST', 7000, 80, '[EST]'),
  PL: rule('PL', 'Europe/Warsaw', 'CET', 'CEST', 6500, 80, '[EST]'),
  CZ: rule('CZ', 'Europe/Prague', 'CET', 'CEST', 5000, 60, 'Czechia ENR 1.7 2.2.1: "The transition altitude within all FIR is 5000 ft (1500 m) AMSL" (two exceptions named there); LKPR AD 2.17 the same'),
  SK: rule('SK', 'Europe/Bratislava', 'CET', 'CEST', 10000, 110, '[EST]'),
  HU: rule('HU', 'Europe/Budapest', 'CET', 'CEST', 10000, 110, '[EST]'),
  SI: rule('SI', 'Europe/Ljubljana', 'CET', 'CEST', 10500, 120, '[EST]'),
  HR: rule('HR', 'Europe/Zagreb', 'CET', 'CEST', 10000, 110, '[EST]'),
  BA: rule('BA', 'Europe/Sarajevo', 'CET', 'CEST', 9500, 110, '[EST]'),
  ME: rule('ME', 'Europe/Podgorica', 'CET', 'CEST', 10000, 110, '[EST]'),
  RS: rule('RS', 'Europe/Belgrade', 'CET', 'CEST', 10000, 110, '[EST]'),
  AL: rule('AL', 'Europe/Tirane', 'CET', 'CEST', 10000, 110, '[EST]'),
  // Gibraltar keeps Central European time, not London's. Morocco is on +01 all year but for Ramadan (Intl knows).
  GI: rule('GI', 'Europe/Gibraltar', 'CET', 'CEST', 6000, 70, '[EST]'),
  MA: rule('MA', 'Africa/Casablanca', '+01', '+01', 6000, 70, '[EST]'),
  // Beyond the outline but in the raster's reach.
  DZ: rule('DZ', 'Africa/Algiers', 'CET', 'CET', 6000, 70, '[EST]'),
  TN: rule('TN', 'Africa/Tunis', 'CET', 'CET', 6000, 70, '[EST]'),
});
// Land the raster doesn't name, and anything unknown: Central European time, 5,000 ft.
export const EUROPE_DEFAULT_RULES = rule('other', 'Europe/Paris', 'CET', 'CEST', 5000, 60, '[EST] the default');

// The transition altitudes set by airport: [lat, lon] of the reference point, the altitude (ft) and the standard
// day's level. It applies within AIRPORT_TRANSITION_RADIUS_M of the airport (about its terminal area), the
// country's beyond; where two overlap, the nearer airport's. A function of position only.
export const AIRPORT_TRANSITION_RADIUS_M = 60000;
// v0.7.4 (fix 3, "Found while building v0.7.1": Malpensa's 6,000 ft reached Lugano, 44 km off, where Switzerland's
// 7,000 ft applies): an airport's altitude applies only where the place's country (countryAt()) is the airport's own,
// by its ICAO prefix below, or one its entry lists under `also` (a terminal area that reaches across a border: Nice's
// takes in Monaco, which France's AIP serves). Elsewhere inside the radius the place keeps its own country's, or the
// nearest airport's of its own country.
export const EUROPE_ICAO_COUNTRY = Object.freeze({ EG: 'GB', LF: 'FR', ED: 'DE', ET: 'DE', LE: 'ES', LS: 'CH', EH: 'NL', LI: 'IT',
  LO: 'AT', EB: 'BE', EI: 'IE', LP: 'PT', EK: 'DK', LK: 'CZ', LX: 'GI' });
export const airportCountries = (icao, entry) => [EUROPE_ICAO_COUNTRY[icao.slice(0, 2)] || 'other', ...((entry && entry.also) || [])];
// Ground the 2 km country raster reads as its neighbour's: Gibraltar's own (its airport read Spain, "Found while
// building v0.7.3"). A box in latitude and longitude: the territory from Europa Point to the frontier fence, the
// harbour and the runway's two ends in the sea. region.js's countryAt() answers these first.
export const EUROPE_COUNTRY_OVERRIDES = Object.freeze([
  { country: 'GI', lat0: 36.1060, lon0: -5.3720, lat1: 36.1553, lon1: -5.3350 },
]);
export const EUROPE_AIRPORT_TRANSITIONS = Object.freeze({
  EGLL: { at: [51.4706, -0.4619], taFt: 6000, tlFl: 70, note: 'UK AIP EGLL AD 2.17: 6,000 ft (the London TMA)' },
  EGKK: { at: [51.1481, -0.1903], taFt: 6000, tlFl: 70, note: 'UK AIP EGKK AD 2.17: 6,000 ft (the London TMA)' },
  LFPG: { at: [49.0097, 2.5479], taFt: 5000, tlFl: 60, note: 'France: Paris TMA, 5,000 ft' },
  LFPO: { at: [48.7233, 2.3794], taFt: 5000, tlFl: 60, note: 'France: Paris TMA, 5,000 ft' },
  LEMD: { at: [40.4722, -3.5609], taFt: 13000, tlFl: 140, note: 'Spain AIP LEMD AD 2.17: 13,000 ft' },
  LEBL: { at: [41.2971, 2.0785], taFt: 6000, tlFl: 70, note: 'Spain AIP LEBL AD 2.17: 6,000 ft' },
  LIRF: { at: [41.8003, 12.2389], taFt: 6000, tlFl: 70, note: 'Italy AIP LIRF AD 2.17: 6,000 ft [EST]' },
  LSZH: { at: [47.4647, 8.5492], taFt: 7000, tlFl: 80, note: 'Switzerland AIP LSZH AD 2.17: 7,000 ft' },
  // v0.7.1
  LFBO: { at: [43.6291, 1.3638], taFt: 5000, tlFl: 60, note: 'France AIP LFBO AD 2.20.2 (AIRAC 29 OCT 2026): "The common transition altitude is 5000 ft for TOULOUSE BLAGNAC, TOULOUSE FRANCAZAL, ..."' },
  EKCH: { at: [55.6180, 12.6560], taFt: 5000, tlFl: 60, note: 'Denmark AIP EKCH AD 2.17 (AIRAC AMDT 03/26): 5,000 ft MSL (the Copenhagen Area)' },
  EGCC: { at: [53.3537, -2.2750], taFt: 5000, tlFl: 60, note: 'UK AIP EGCC AD 2.17 (AIRAC 29 OCT 2026): 5,000 ft' },
  // v0.7.2
  EGPH: { at: [55.9500, -3.3725], taFt: 6000, tlFl: 70, note: 'UK AIP EGPH AD 2.17: 6,000 ft' },
  EGPF: { at: [55.8719, -4.4331], taFt: 6000, tlFl: 70, note: 'UK AIP EGPF AD 2.17: 6,000 ft' },
  LFRS: { at: [47.1532, -1.6107], taFt: 5000, tlFl: 60, note: 'France AIP LFRS AD 2.20 20.2: "The transition altitude within NANTES TMA is 5000 ft"' },
  LEST: { at: [42.8963, -8.4151], taFt: 6000, tlFl: 70, note: 'Spain AIP LEST AD 2.17: "Transition altitude 1850 m / 6000 ft" (CTR SANTIAGO)' },
  // v0.7.3 (Hamburg's AD 2.17 says Germany's 5,000 ft; Innsbruck's: "no transition altitude is determined. Departing aircraft shall
  // consider 10000 FT AMSL as transition altitude": Austria's own)
  LFLL: { at: [45.726, 5.0901], taFt: 5000, tlFl: 60, note: 'France AIP LFLL AD 2.20 20.2: 5,000 ft' },
  LFML: { at: [43.4381, 5.2125], taFt: 5000, tlFl: 60, note: 'France AIP LFML AD 2.20: 5,000 ft' },
  LFMN: { at: [43.6584, 7.2159], taFt: 5000, tlFl: 60, also: ['MC'], note: 'France AIP LFMN AD 2.20: "The transition altitude in NICE TMA is 5000 ft."' },
  LSGG: { at: [46.2381, 6.1089], taFt: 7000, tlFl: 80, note: 'Switzerland: Geneva 7,000 ft [EST] (skyguide\'s eAIP asks for a login)' },
  LIMC: { at: [45.6306, 8.7281], taFt: 6000, tlFl: 70, note: 'Italy: Malpensa 6,000 ft [EST] (ENAV\'s eAIP asks for a login; from a public pilot briefing)' },
});

// ICAO prefixes to zones, where no position is at hand (a saved plan's airport): clock.js's zoneOfIcao().
export const EUROPE_ICAO_ZONES = [
  ['EG', 'GB'], ['EI', 'IE'], ['LF', 'FR'], ['ED', 'DE'], ['ET', 'DE'], ['LE', 'ES'], ['LS', 'CH'], ['EH', 'NL'], ['LI', 'IT'],
  ['EB', 'BE'], ['EL', 'LU'], ['LO', 'AT'], ['LP', 'PT'], ['EK', 'DK'], ['ES', 'SE'], ['EN', 'NO'], ['EP', 'PL'], ['LK', 'CZ'],
  ['LZ', 'SK'], ['LH', 'HU'], ['LJ', 'SI'], ['LD', 'HR'], ['LX', 'GI'], ['GM', 'MA'], ['LN', 'MC'],
].map(([p, c]) => [p, EUROPE_RULES[c].timeZone, EUROPE_RULES[c].zoneName, EUROPE_RULES[c].zoneNameSummer]);

// The setup's groups: an airport's country by its ICAO prefix, the countries' names and their order.
export const EUROPE_COUNTRY_OF = [['EG', 'GB'], ['EI', 'IE'], ['LF', 'FR'], ['ED', 'DE'], ['ET', 'DE'], ['LE', 'ES'], ['LS', 'CH'], ['EH', 'NL'], ['LI', 'IT'],
  ['EB', 'BE'], ['EL', 'LU'], ['LO', 'AT'], ['LP', 'PT'], ['EK', 'DK'], ['ES', 'SE'], ['EN', 'NO'], ['EP', 'PL'], ['LK', 'CZ'], ['LX', 'GI']];
export const EUROPE_COUNTRY_LABEL = { GB: 'United Kingdom', FR: 'France', DE: 'Germany', ES: 'Spain', CH: 'Switzerland', NL: 'Netherlands', IT: 'Italy',
  IE: 'Ireland', PT: 'Portugal', BE: 'Belgium', LU: 'Luxembourg', AT: 'Austria', DK: 'Denmark', SE: 'Sweden', NO: 'Norway', PL: 'Poland', CZ: 'Czechia', GI: 'Gibraltar', other: 'Elsewhere' };
export const EUROPE_COUNTRY_ORDER = ['GB', 'FR', 'DE', 'ES', 'CH', 'NL', 'IT', 'IE', 'PT', 'BE', 'LU', 'AT', 'DK', 'SE', 'NO', 'PL', 'CZ', 'GI', 'other'];
// The build order (briefs/V0-7-0.md's map): Heathrow to Fiumicino in v0.7.0.
// v0.7.1: Toulouse to Manchester (airports 12 to 20), each after its country's earlier ones; the new countries after Italy.
// v0.7.2: Düsseldorf to Santiago (airports 21 to 29), the same way; Czechia after Denmark.
// v0.7.3: Innsbruck to Naples (airports 30 to 37), the same way; Gibraltar last.
export const EUROPE_AIRPORT_ORDER = ['EGLL', 'EGKK', 'EGCC', 'EGPH', 'EGPF', 'LFPG', 'LFPO', 'LFBO', 'LFMN', 'LFRS', 'LFML', 'LFLL', 'EDDF', 'EDDM', 'EDDB', 'EDDL', 'EDDK', 'EDDH',
  'LEMD', 'LEBL', 'LEST', 'LSZH', 'LSGG', 'EHAM', 'LIRF', 'LIMC', 'LIPZ', 'LIRN', 'EIDW', 'LPPT', 'LPPR', 'EBBR', 'LOWW', 'LOWI', 'EKCH', 'LKPR', 'LXGB'];
