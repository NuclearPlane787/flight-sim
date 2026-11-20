"""briefs/V0-6-0.md Part 3, first pass: the region's airports as JSON (data/airports/<ICAO>.json), in map metres,
in the same shape as Korea's (tools/bake_airports.py; RKSI.json field for field) plus `shortName`.

Not in data/manifest.json: the new airports stay behind EAST_ASIA_ON, and the integration adds them.

Sources:
- OSM, cut per airport with osmium-tool (streams; never pyosmium over a whole file):
    osmium extract -b <box> -s complete_ways <region>.osm.pbf -o /tmp/flight-sim/v060/osm/<ICAO>/box.osm.pbf
    osmium tags-filter box.osm.pbf nwr/aeroway nwr/building w/highway=service -o .../aero.osm.pbf
  (/tmp/flight-sim/v060/osm/extract.sh). pyosmium reads only that small file.
- OurAirports (reference/raw/ourairports/): the threshold elevations and displacements, the widths,
  and the cross-check of the lengths. OSM's geometry wins.
- WMM2025 at epoch 2026.0 from data/magvar.json + magvar.i16.gz, bilinear exactly as
  src/world/geo-rules.js wmmVar(): magVarDeg and each end's hdgMagDeg.
- Lights, PAPIs, approach lights and ILS: AIP Japan AD 2 for RJTT, RJAA, RJBB and RJFF (the AIP table below);
  elsewhere (ZSPD, RKPK, ZSSS, ZSQD) the ICAO default for a code 4 precision runway, marked [EST] in
  /tmp/flight-sim/v060/airports/<ICAO>.md.
- Second pass (RKPK ZSSS RJBB RJFF ZSQD): boxes cut by /tmp/flight-sim/v060/osm/extract2.sh. Gimhae's variation
  is frame.js magVar()'s plane (bake_common.mag_var), and its military side (OSM landuse=military) has no stands.
  RJTT, RJAA and ZSPD bake byte-identical to the first pass.

- v0.6.1, Yancheng (ZSYN, pending): its box cut by /tmp/flight-sim/v061/zsyn/extract.sh (the same cutter, box
  120.14,33.375,120.27,33.485, from china-261118). OSM maps no aprons, stands, gates, holds or taxiway names there,
  but draws each stand's lead-in line (and its turn-in arcs) as aeroway=taxiway: those lines become the stands
  (STAND_LINES), the arcs are dropped (LEADIN_ARCS), the taxiways are named in TWY_REFS, all [EST]. Its military
  side (OSM's second aerodrome, landuse=military, south-west of the civil apron) keeps its taxiways, no stands.
  Bake it alone: `... bake_region_airports.py ZSYN` (FS_AIRPORT_OUT=<dir> writes elsewhere than data/airports, to
  check that another airport still bakes byte-identical).

Leaves out runways under construction or proposed (Narita's runway C, B's extension): only ways tagged
aeroway=runway with no lifecycle tag are read, and a runway is one ref's ways merged end to end.

  python3 tools/cpu-guard.py --minutes 20 -- /tmp/flight-sim/venv/bin/python -I tools/bake_region_airports.py [ICAO ...]
"""
import csv
import gzip
import json
import os
import sys

import numpy as np
import osmium
import osmium.geom
import shapely
from shapely.geometry import LineString, Point, Polygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import DATA, RAW, mag_var, to_geo, to_map
from bake_airports import bearing_true, building_height, num, pts, r1, to_xy

OSM_DIR = '/tmp/flight-sim/v060/osm'
NOTES_DIR = '/tmp/flight-sim/v060/airports'
# v0.6.1: Yancheng's box and notes live with that run's scratch
OSM_DIRS = {'ZSYN': '/tmp/flight-sim/v061/zsyn/osm'}
NOTES_DIRS = {'ZSYN': '/tmp/flight-sim/v061/zsyn/airports'}
# v0.6.3, Shenyang, Dalian and Vladivostok: their boxes cut by /tmp/flight-sim/v063/osm/extract-ne.sh, notes beside them
OSM_DIRS.update({i: '/tmp/flight-sim/v063/osm' for i in ('ZYTX', 'ZYTL', 'UHWW')})
NOTES_DIRS.update({i: '/tmp/flight-sim/v063/airports/bake' for i in ('ZYTX', 'ZYTL', 'UHWW')})
# v0.6.3, Beijing Capital and Daxing: their boxes cut by /tmp/flight-sim/v063/osm/extract-beijing.sh, notes beside them
OSM_DIRS.update({i: '/tmp/flight-sim/v063/osm' for i in ('ZBAA', 'ZBAD')})
NOTES_DIRS.update({i: '/tmp/flight-sim/v063/airports/bake' for i in ('ZBAA', 'ZBAD')})
OUT_DIR = os.environ.get('FS_AIRPORT_OUT') or os.path.join(DATA, 'airports')
osm_dir = lambda icao: OSM_DIRS.get(icao, OSM_DIR)
FT = 0.3048

NAMES = {   # briefs/V0-6-0.md Part 3, the names table
    'RJTT': ('Haneda', 'Tokyo International Airport (Haneda)'),
    'RJAA': ('Narita', 'Narita International Airport'),
    'ZSPD': ('Pudong', 'Shanghai Pudong International Airport'),
    # second pass
    'RKPK': ('Gimhae', 'Gimhae International Airport'),
    'ZSSS': ('Hongqiao', 'Shanghai Hongqiao International Airport'),
    'RJBB': ('Kansai', 'Kansai International Airport'),
    'RJFF': ('Fukuoka', 'Fukuoka Airport'),
    'ZSQD': ('Qingdao', 'Qingdao Jiaodong International Airport'),
    # v0.6.1, pending (manifest airportsPending)
    'ZSYN': ('Yancheng', 'Yancheng Nanyang International Airport'),
    # v0.6.3 (briefs/V0-6-3.md Part 2), pending until each passes its check
    'ZBAA': ('Beijing Capital', 'Beijing Capital International Airport'),
    'ZBAD': ('Daxing', 'Beijing Daxing International Airport'),
    'ZYTX': ('Shenyang', 'Shenyang Taoxian International Airport'),
    'ZYTL': ('Dalian', 'Dalian Zhoushuizi International Airport'),
    'UHWW': ('Vladivostok', 'Vladivostok International Airport'),
}
# Inside south-korea.poly the game's variation is frame.js magVar()'s plane (briefs/V0-6-0.md, "Magnetic variation"):
# Gimhae's magVarDeg and magnetic headings come from bake_common.mag_var(), the rest from the WMM grid.
PLANE = {'RKPK'}
# Gimhae is a joint civil and military field (briefs/V0-6-0.md Part 3): the ROKAF side (OSM's landuse=military areas,
# read from the unfiltered box) keeps its aprons and buildings but has no stands, so no traffic parks there.
MILITARY = {'RKPK', 'ZSYN'}
# Yancheng is a joint civil and air force field too (OSM's aerodrome alt_name 空军盐城场站, "PLAAF Yancheng station"; a
# second aeroway=aerodrome + landuse=military area south-west of the civil apron, with a ladder of small hardstands
# drawn as taxiways): those taxiways stay (a taxi line, no stand), no stands there.

# v0.6.1, Yancheng (ZSYN): OSM has no aeroway=parking_position, apron, gate or holding_position there and no taxiway ref.
# Its stands' lead-in lines are drawn as aeroway=taxiway (way 2020-09-28 edits, from Bing): straight lines square to the
# runway from the apron taxilanes to a dead end at the stop mark, about 48 m apart (code C spacing). Each becomes a stand
# (stop point = the dead end, heading along the line's last 30 m, the line its leadIn), numbered 01.. west to east (STAND_FORMAT)
# by the bake's usual rule. The turn-in arcs between the taxilanes and the lines (and the two lead-in circles of
# each pair of stands in the middle group) are dropped: they are stand markings, not taxi routes. All [EST].
STAND_LINES = {'ZSYN': {
    852305545, 852305547, 852305549, 852305551, 852305553, 852305555, 852305557,             # south group (7)
    852289696, 852289694, 852289692, 852289689, 852289682, 852289679, 852289676, 852289672,  # middle group (10)
    852289668, 852289666,
    852305580, 852305578, 852305573,                                                        # north group (3)
}}
LEADIN_ARCS = {'ZSYN': {
    852305544, 852305546, 852305548, 852305550, 852305552, 852305554, 852305556,
    852289661, 852289662, 852289663, 852289664, 852289665, 852289667, 852289669, 852289671,
    852289674, 852289675, 852289677, 852289678, 852289681, 852289683, 852289684, 852289685,
    852289686, 852289687, 852289688, 852289690, 852289693,
    852305570, 852305571, 852305574, 852305575, 852305576, 852305577, 852305579,
}}
# (kept, unnamed: 852289670, 852289673, 852289691 and 852305572, the S-curves from B down to A, B's only links)
# Taxiway names where OSM has none (Yancheng): the Chinese pattern, the parallel taxiway A, its links to the runway
# A1.. from the 04 end, the apron taxilane B. The military apron's loop and hardstands stay unnamed. All [EST].
TWY_REFS = {'ZSYN': {
    153970121: 'A', 852289680: 'A',     # the parallel, joining the runway at both ends (its end curves are its links)
    153970109: 'A1',                    # 04 end + 400 m, across A from the military apron's loop
    153970108: 'A2',                    # mid-field, square-ish to the runway
    852305569: 'A3',                    # the angled exit for a landing on 22
    852289695: 'B',                     # the apron taxilane behind the middle group's tails
}}
TWY_REF_REASON = ('OSM maps no taxiway ref at Yancheng: named in the Chinese pattern (parallel A, its runway links A1-A3 '
                  'from the 04 end, the apron taxilane B); the military loop and hardstands unnamed')

# v0.6.3, Shenyang and Dalian: OSM draws each stand as a chain of
# aeroway=parking_position ways, the lead-in and the curved turn-in arcs (and short joining pieces) from the taxilane,
# each its own way. The bake's usual rule made a stand of every piece (206 at Shenyang, 175 at Dalian). Here a stand is a
# dead end of that network: a way's end joined to no other parking_position way (within 2 m) and at least PP_TWY_M from
# every taxiway (an arc's end on a taxiway is not a stand). Its leadIn is that way, its heading the way's last 30 m, its
# number the numbered parking_position node within 15 m. stands_from_pp_chains().
PP_CHAINS = {'ZYTX', 'ZYTL'}
PP_TWY_M = 20.0


def military_polys(icao):
    path = os.path.join(osm_dir(icao), icao, 'box.osm.pbf')
    wkb = osmium.geom.WKBFactory()
    out = []
    fp = (osmium.FileProcessor(path).with_locations()
          .with_areas(osmium.filter.TagFilter(('landuse', 'military')))
          .with_filter(osmium.filter.TagFilter(('landuse', 'military'))))
    for o in fp:
        if o.is_area():
            try:
                for p in shapely.get_parts(shapely.from_wkb(wkb.create_multipolygon(o))):
                    out.append((dict(o.tags).get('name:en', ''), Polygon(to_xy(p.exterior.coords))))
            except (osmium.InvalidLocationError, RuntimeError):
                pass
    return out
ICAOS = list(NAMES)

# The ICAO default for a code 4 precision approach runway (Annex 14 5.3.4, 5.3.5, 5.3.12-13), used for
# every end until the AIPs are read: a 900 m precision approach lighting system (category I),
# a PAPI on the left at 3.0 deg, an ILS category I, centreline lights (Annex 14 recommends them on a
# runway wider than 50 m, and these are all 60 m), no touchdown-zone lights (required from CAT II).
DEFAULT_END = dict(papi='left', papiDeg=3.0, approachLights='ALSF-I', approachLightsM=900, ils='I',
                   tdzLights=False, centrelineLights=True)     # in RKSI.json's key order
EST_REASON = ('AIP not read in this pass: ICAO default for a code 4 precision runway '
              '(PALS CAT I 900 m, PAPI left 3.0 deg, ILS I, CL lights as width > 50 m, no TDZ)')

# Per runway end, from AIP Japan (the AD 2 pages as mirrored at nagodede.github.io/aip/japan, read with pypdf):
# RJTT AD 2.12 (EFF 28 NOV 2024), 2.13, 2.14 (EFF 6 OCT 2022), 2.19 (EFF 23 JAN 2025); RJAA AD 2.12
# (EFF 2 OCT 2025), 2.14 (EFF 28 DEC 2023), 2.19 (EFF 20 MAR 2025). PALS CAT III -> 'ALSF-II', PALS
# (CAT I or unlabelled) -> 'ALSF-I', as Korea's table names them. THR elevation in feet (the displaced
# threshold's where displaced). Haneda 05 is "not usable for landing" (no PALS, no PAPI, no ILS).
#        ident: (ALS, ALS m, PAPI side, PAPI deg, ILS, THR elev ft, TDZ lts, CL lts, width, displaced m)
AIP = {
    'RJTT': {'16L': ('ALSF-I', 900, 'left', 3.0, 'I', 19.2, True, True, 60, 390),
             '34R': ('ALSF-II', 900, 'right', 3.0, 'III', 19.7, True, True, 60, 360),
             '16R': ('ALSF-I', 900, 'left', 3.0, 'I', 16.4, True, True, 60, 480),
             '34L': ('ALSF-I', 900, 'left', 3.0, 'I', 18.2, True, True, 60, 0),
             '04': (None, 0, 'left', 3.0, None, 19.0, False, True, 60, 0),
             '22': ('ALSF-I', 900, 'left', 3.0, 'I', 35.0, True, True, 60, 0),
             '05': (None, 0, None, None, None, 45.5, False, True, 60, 0),
             '23': ('ALSF-I', 870, 'left', 3.0, 'I', 54.7, True, True, 60, 0)},
    'RJAA': {'16R': ('ALSF-II', 900, 'left', 3.0, 'III', 129.6, True, True, 60, 0),
             '34L': ('ALSF-I', 750, 'left', 3.0, 'I', 139.4, True, True, 60, 0),
             '16L': ('ALSF-I', 900, 'left', 3.0, 'I', 134.5, True, True, 60, 0),
             '34R': ('ALSF-I', 900, 'right', 3.0, 'I', 141.1, True, True, 60, 0)},
    # Second pass, same mirror: RJBB AD 2.12 (EFF 28 NOV 2024), 2.13, 2.14, 2.19 (MAG VAR 8 deg W 2023): four
    # PALS CAT II with TDZ lights, PAPI left 3.0, no displacements; AD 2.19 doesn't state the ILS category,
    # taken as II from the PALS. RJFF AD 2.12 (EFF 27 NOV 2025, the second runway 16R/34L open), 2.13, 2.14
    # (EFF 20 MAR 2025), 2.19: 16L/34R PALS CAT I + TDZ + ILS; 16R/34L no approach lights, no TDZ, LOC only
    # (no glide path: ils None), PAPI left 3.0 at all four.
    'RJBB': {'06R': ('ALSF-II', 900, 'left', 3.0, 'II', 5.0, True, True, 60, 0),
             '24L': ('ALSF-II', 900, 'left', 3.0, 'II', 12.3, True, True, 60, 0),
             '06L': ('ALSF-II', 900, 'left', 3.0, 'II', 9.2, True, True, 60, 0),
             '24R': ('ALSF-II', 900, 'left', 3.0, 'II', 15.6, True, True, 60, 0)},
    'RJFF': {'16L': ('ALSF-I', 900, 'left', 3.0, 'I', 15.0, True, True, 60, 0),
             '34R': ('ALSF-I', 900, 'left', 3.0, 'I', 32.2, True, True, 60, 0),
             '16R': (None, 0, 'left', 3.0, None, 15.1, False, True, 60, 0),
             '34L': (None, 0, 'left', 3.0, None, 32.5, False, True, 60, 0)},
}
# Ends that differ from the ICAO default where no AIP table is read.
# v0.6.1, the published values (values only; no chart or page is kept in the repository):
# - Gimhae, from Korea's eAIP (aim.koca.go.kr, RKPK AD 2.12 to 2.14 and 2.19, the 2026-11-12 package), read directly:
#   ILS to 36L (CAT II) and 36R (CAT I) only, 18L and 18R being the circling ends; ALSF-II 900 m with touchdown
#   zone lights at 36L and 36R; SSALF 420 m at 18R; SSALR 720 m at 18L (drawn as the game's SSALF, the nearest
#   it has); PAPIs on both sides at 18R, 18L and 36R, left at 36L; centreline lights on both runways; and
#   18R's landing threshold displaced by 600 m (LDA 2,600 m): DISPLACED_PUBLISHED.
#   The threshold elevations and widths stay OurAirports' (the patch's flattening was baked with them).
# - Pudong and Qingdao, China's AIP not readable without an account: the ILS categories from an open nav-data
#   listing (X-Plane 12's, as shown on airports4xp.info; Pudong 34L's CAT III also in Shanghai's state media, 2018),
#   and with a category II or III the lights Annex 14 requires of one (the 900 m system with side-row barrettes,
#   touchdown zone and centreline lights), which an open scenery listing (the X-Plane Scenery Gateway's) also has.
#   An open secondary source, not the AIP: marked so in the notes. The CAT I ends stay the default, [EST].
CAT2 = dict(approachLights='ALSF-II', approachLightsM=900, tdzLights=True, centrelineLights=True)
END_OVERRIDE = {
    'RKPK': {'18R': dict(ils=None, approachLights='SSALF', approachLightsM=420, papi='both', centrelineLights=True),
             '36L': dict(CAT2, ils='II'),
             '18L': dict(ils=None, approachLights='SSALF', approachLightsM=720, papi='both', centrelineLights=True),
             '36R': dict(CAT2, ils='I', papi='both')},
    'ZSPD': {'34L': dict(CAT2, ils='III'), '17L': dict(CAT2, ils='II'), '35R': dict(CAT2, ils='II')},
    'ZSQD': {'16': dict(CAT2, ils='II'), '17': dict(CAT2, ils='II'), '35': dict(centrelineLights=True)},
}
OVERRIDE_REASON = {
    'RKPK': ("Korea's eAIP (RKPK AD 2, the 2026-11-12 package), read 2026-11-20: ILS CAT II to 36L and CAT I to 36R, none to "
             "18L/18R; ALSF-II 900 m and TDZ lights at 36L and 36R; SSALF 420 m at 18R; SSALR 720 m at 18L (drawn as SSALF); "
             "PAPI both sides at 18R, 18L, 36R; centreline lights on both runways; 18R displaced 600 m. Published, not [EST]. "
             "Still [EST]: the threshold elevations and widths (OurAirports')"),
    'ZSPD': ("open nav data (X-Plane 12's ILS table as listed on airports4xp.info; 34L's CAT III also in state media, 2018), "
             "not the AIP: ILS III at 34L, II at 17L and 35R, with a CAT II/III runway's lights (ALSF-II 900 m, TDZ); "
             "the other ends stay the default, [EST]"),
    'ZSQD': ("open nav data and an open scenery listing (X-Plane 12's ILS table; the Scenery Gateway's runway rows), not the "
             "AIP: ILS II at 16 and 17 with a CAT II runway's lights (ALSF-II 900 m, TDZ, centreline lights on 17/35); "
             "34 and 35 stay the default, [EST]"),
}
# v0.6.3, Beijing Capital and Daxing: China's AIP not readable without an account. Open secondary sources only:
# the ILS categories from X-Plane 12's nav data as listed on airports4xp.info; the approach lights, TDZ and centreline
# lights and the PAPIs (all PAPI-4L, one an end; none at Daxing 11L) from the X-Plane Scenery Gateway's recommended
# sceneries' runway rows and light fixtures (ZBAA scenery 110014, 2026-02; ZBAD 112658, 2026-10). Where they disagree
# (Daxing 01L: CAT III in the nav data, ALSF-I with TDZ in the scenery) the CAT II/III lights Annex 14 requires.
# Still [EST]: the approach lights' 900 m, the PAPIs' 3.0 deg and side, every threshold elevation (OurAirports').
END_OVERRIDE.update({
    'ZBAA': {'01': dict(CAT2, ils='II'), '19': dict(CAT2, ils='I'), '18L': dict(CAT2, ils='I'),
             '36R': dict(CAT2, ils='III'), '18R': dict(CAT2, ils='I'), '36L': dict(CAT2, ils='I')},
    'ZBAD': {'17R': dict(centrelineLights=True), '35L': dict(CAT2, ils='II'), '01L': dict(CAT2, ils='III'),
             '11L': dict(papi=None, papiDeg=None, approachLights=None, approachLightsM=0, ils=None, tdzLights=False)},
})
OVERRIDE_REASON.update({
    'ZBAA': ("open secondary sources, not the AIP: ILS II at 01, III at 36R, I at 19, 18L, 18R, 36L (X-Plane 12's nav data, "
             "airports4xp.info); ALSF-II, TDZ and centreline lights at all six ends (the Scenery Gateway's scenery 110014); "
             "PAPI-4L at each end (its fixtures); 18R/36L's centreline lights though 50 m wide (the scenery's). [EST]: the "
             "approach lights' 900 m"),
    'ZBAD': ("open secondary sources, not the AIP: ILS III at 01L, II at 35L, I at 17L, 35R, 17R, 19R, 29R, none at 11L "
             "(X-Plane 12's nav data, airports4xp.info); ALSF-I at 17L, 35R, 17R, 19R, 29R, ALSF-II and TDZ at 35L, nothing "
             "at 11L (no approach lights, no PAPI: a departure end), centreline lights on all four runways, 17R/35L's "
             "too though 45 m wide (the Scenery Gateway's scenery 112658); 01L: CAT III in the nav data, so a CAT II/III "
             "runway's lights (the scenery has ALSF-I with TDZ). [EST]: the approach lights' 900 m"),
})
# Daxing's west side borders the PLAAF's Nanjiao field (ZBNY; OSM aeroway=aerodrome + landuse=military, its own runway
# 18/36 tagged "for military", outside ZBAD's aerodrome polygon): no stands may come from it.
MILITARY = MILITARY | {'ZBAD'}
# Where the pavement made round the stands is also closed over the gaps to the mapped aprons (m: half the widest gap closed).
APRON_CLOSE = {'RKPK': 30.0}
# How the stands OSM leaves unnumbered are numbered, west to east: R1.. unless the airport's own numbering is known.
# Yancheng: 01 to 20 from the south-west, as an open scenery listing has them (the X-Plane Scenery Gateway's, 2022;
# an open secondary source, [EST]); which line is which number is the bake's west-to-east order.
STAND_FORMAT = {'ZSYN': '{:02d}'}
# A landing threshold's published displacement where neither OSM nor OurAirports has it (m).
DISPLACED_PUBLISHED = {('RKPK', '18R'): 600.0}
# Widths where OurAirports' rounded figure is wrong: Hongqiao 18L/36R is 3,400 x 57.6 m (OSM's width tag), not 45 m.
WIDTH_OVERRIDE = {('ZSSS', '18L/36R'): 57.6}
# v0.6.3, Daxing: OSM's way for these three runways runs over both 120 m blast pads (OurAirports' ends 118-127 m in
# from OSM's at each end, the first taxiway links ~130-200 m in; the X-Plane Scenery Gateway's runway rows: 120 m blast
# pads, no displacement). Both ends are trimmed by the same amount, to the published length times the map frame's
# scale there (Lambert's k, +0.22 % at Beijing), so the runway keeps OSM's middle.
TRIM_BOTH = {('ZBAD', '17L/35R'), ('ZBAD', '17R/35L'), ('ZBAD', '01L/19R')}


def frame_scale(lat, lon):
    """The map frame's scale factor at (lat, lon): map metres per metre on the ellipsoid, north-south (conformal)."""
    from bake_common import A, E
    d = 1e-4
    p0, p1 = np.array(to_map(lat - d / 2, lon), float), np.array(to_map(lat + d / 2, lon), float)
    s = np.sin(np.radians(lat))
    return float(np.hypot(*(p1 - p0)) / (A * (1 - E * E) / (1 - E * E * s * s) ** 1.5 * np.radians(d)))

# v0.6.3, Shenyang (ZYTX), Dalian (ZYTL) and Vladivostok (UHWW), pending. No source document is kept in the repository.
# - Vladivostok, from AIP Russia (Book 1, AD 2.1 UHWW, AIRAC AMDT 11/24 of 31 OCT 24; the ILS Z 25L chart, AMDT 07/25),
#   read directly: one runway, 07R/25L 3,502 x 60 m, no displacement (TORA = LDA 3,502 m); 07R HIALS CAT I 900 m, PAPI
#   left 3.0, no TDZ, ILS CAT I (109.3); 25L HIALS CAT II 900 m, PAPI left 3.0, TDZ 900 m, ILS CAT II (110.1);
#   centreline lights on both; THR elevations 32 ft (07R) and 44 ft (25L); MAG BRG 072/252; MAG VAR 11 deg W (2020).
#   The old 07L/25R is closed (OurAirports' closed=1) and OSM no longer draws it as a runway.
AIP.update({
    'UHWW': {'07R': ('ALSF-I', 900, 'left', 3.0, 'I', 32.0, False, True, 60, 0),
             '25L': ('ALSF-II', 900, 'left', 3.0, 'II', 44.0, True, True, 60, 0)},
})
# - Shenyang and Dalian: China's AIP not readable without an account. Open secondary sources only: the ILS categories
#   (CAT I at all four ends) from X-Plane 12's nav data as listed on airports4xp.info; ALSF-I at each end, no TDZ,
#   centreline lights (both runways 45 m wide) and the PAPIs (PAPI-4L on the left; Dalian 10's at 3.3 deg, as its
#   glide path in the nav data) from the X-Plane Scenery Gateway's recommended sceneries (ZYTX 97379, 2023-07; ZYTL
#   105766, 2025-02). Dalian's displacements (10: 200 m, 28: 300 m) are OSM's segments, which the Gateway's scenery
#   also has (OurAirports 198 m and 98 m). [EST]: the approach lights' 900 m.
END_OVERRIDE.update({
    'ZYTX': {'06': dict(centrelineLights=True), '24': dict(centrelineLights=True)},
    'ZYTL': {'10': dict(centrelineLights=True, papiDeg=3.3), '28': dict(centrelineLights=True)},
})
OVERRIDE_REASON.update({
    'ZYTX': ("open secondary sources, not the AIP: ILS I at 06 (110.5) and 24 (110.3) (X-Plane 12's nav data, "
             "airports4xp.info); ALSF-I, no TDZ, PAPI-4L left, centreline lights at both ends though 45 m wide (the Scenery "
             "Gateway's scenery 97379). [EST]: the approach lights' 900 m, the PAPIs' 3.0 deg"),
    'ZYTL': ("open secondary sources, not the AIP: ILS I at 10 (109.1, glide path 3.3 deg) and 28 (111.1, 3.0 deg) (X-Plane "
             "12's nav data, airports4xp.info); ALSF-I, no TDZ, PAPI-4L left (10's at 3.3 deg), centreline lights at both "
             "ends though 45 m wide (the Scenery Gateway's scenery 105766). [EST]: the approach lights' 900 m"),
})
# Vladivostok's stands: OSM draws apron A's lead-ins as taxiways, most of them loops (the AIP's drive-through rows 12 to
# 23) with no dead end to take a stop from, and maps no stand numbers. The stands are the X-Plane Scenery Gateway's
# (scenery 66682, 2019: an open secondary source), whose numbers are the AIP parking chart's (AD 2.1 UHWW-40): 1A, 2 to
# 4 at the bridges, 5A, 6A, 7 to 11 on the front row, 12 to 23 on the rows behind, all nose 151 deg true. Each gets a
# 60 m lead-in along its heading. Stands 24 and 25 (the separate apron) and the AIP's letter variants are left out, and
# so are OSM's two unnumbered parking_position nodes by a hangar south of the runway (no taxi route reaches them).
#   (ref, lat, lon, true heading deg)
STAND_POINTS = {'UHWW': [
    ('1A', 43.39657916, 132.16341549, 150.96), ('2', 43.39688095, 132.16424597, 150.96),
    ('3', 43.39711398, 132.16493590, 150.96), ('4', 43.39741090, 132.16568382, 150.96),
    ('5A', 43.39782393, 132.16664689, 150.96), ('6A', 43.39820970, 132.16757314, 150.96),
    ('7', 43.39864140, 132.16837311, 150.96), ('8', 43.39887413, 132.16901982, 150.96),
    ('9', 43.39916006, 132.16965127, 150.96), ('10', 43.39942897, 132.17049681, 150.96),
    ('11', 43.39976449, 132.17133177, 150.96), ('12', 43.39809877, 132.16279607, 150.96),
    ('13', 43.39838780, 132.16355250, 150.96), ('14', 43.39864634, 132.16419384, 150.96),
    ('15', 43.39895347, 132.16493048, 150.96), ('16', 43.39920631, 132.16556543, 150.96),
    ('17', 43.39951149, 132.16631122, 150.96), ('18', 43.39976787, 132.16695082, 150.96),
    ('19', 43.40002894, 132.16758484, 150.96), ('20', 43.40019000, 132.16798933, 150.96),
    ('21', 43.40034861, 132.16840022, 150.96), ('22', 43.40060986, 132.16901380, 150.96),
    ('23', 43.40085419, 132.16965268, 150.96),
]}
STAND_POINTS_LEADIN_M = 60.0
# Vladivostok's taxiway names where OSM has none: A, the parallel taxiway on the apron side (the AIP parking chart's
# TWY A and its aerodrome chart; AD 2.8 lists A, C, M, P, R, S). The others stay unnamed: their places on the chart
# could not be matched to OSM's ways with confidence.
TWY_REFS['UHWW'] = {519626005: 'A'}
TWY_REF_REASONS = {'UHWW': ("OSM maps no taxiway ref at Vladivostok but the X taxilanes: the parallel named A from AIP Russia's "
                            "parking and aerodrome charts (UHWW-40, -31); C, M, P, R and S (AD 2.8) not placed")}


# Holding positions (Part 3's checks): OSM maps few at some airports (Qingdao none, Fukuoka 3, Gimhae 5). Where a
# taxiway meets a runway and no mapped hold is on it, one is made on the taxiway at the standard distance from the
# runway's centreline: 90 m for a code 4 precision approach runway (ICAO Annex 14, Table 3-2), measured to the
# centreline's segment (so beyond an end it's 90 m from the end). Where a parallel taxiway joins the stub closer than
# that, the hold goes just short of the junction, but at least HOLD_MIN_EDGE_M outside the drawn edge. Marked "est".
HOLD_CL_M = 90.0
HOLD_MIN_EDGE_M = 12.0
HOLD_JOIN_M = 35.0      # taxi.js RUNWAY_JOIN_M: a taxiway end this close to the pavement joins the runway
HOLD_PARALLEL_DEG = 35.0
# Published magnetic bearings (AD 2.19's ILS-LOC BRG(MAG), or the AD 2.12 true bearing + the AIP's 8 deg W;
# Haneda 23's ILS-LOC is 232 deg, off the runway's 230.56),
# for the bake's table only.
PUBLISHED_MAG = {
    'RJTT': {'16L': 157.41, '16R': 157.41, '34R': 337.0, '34L': 337.0, '22': 222.0, '23': 230.56,
             '04': 43.01, '05': 50.56},
    'RJAA': {'16R': 157.0, '34L': 337.0, '16L': 157.0, '34R': 337.0},
    # AD 2.19's (I)LS-LOC BRG(MAG)
    # (Kansai 24L's LOC is published to the whole degree, 238: AD 2.12's true 231.00 + 8 deg W instead)
    'RJBB': {'06R': 58.88, '24L': 239.0, '06L': 58.78, '24R': 238.94},
    'RJFF': {'16L': 158.0, '34R': 337.75, '16R': 158.20, '34L': 338.21},
    # Yancheng: no AIP read; the open nav-data listings (SkyVector 043 for 04; airports4xp.info 044/224, with an ILS CAT I
    # localizer on 04 at 110.9 MHz and one on 22 at 111.3 MHz). WMM2025 at 2026.0 gives 045.4/225.4 from OSM's true 38.5:
    # the listings' bearings carry an older variation (the runway's 04 too: 38.5 true is 045 magnetic today).
    'ZSYN': {'04': 44.0, '22': 224.0},
}
# v0.6.3: Vladivostok, AIP Russia AD 2.12's MAG BRG (with its 11 deg W of 2020); Shenyang and Dalian, the open nav-data
# listing's bearings (airports4xp.info: 056/236 and 095/275): Shenyang's carry an older variation, Dalian's are within
# 0.7 deg of its true bearing (95.65), so probably true; for the notes' table only.
PUBLISHED_MAG.update({'UHWW': {'07R': 72.0, '25L': 252.0}, 'ZYTX': {'06': 56.0, '24': 236.0},
                      'ZYTL': {'10': 95.0, '28': 275.0}})

LIFECYCLE = ('construction', 'proposed', 'disused', 'abandoned', 'planned', 'demolished', 'razed')


# ---------------------------------------------------------------- WMM grid (geo-rules.js wmmVar)
class Wmm:
    def __init__(self):
        with open(os.path.join(DATA, 'magvar.json')) as f:
            h = json.load(f)
        with gzip.open(os.path.join(DATA, h['file']), 'rb') as f:
            self.v = np.frombuffer(f.read(), '<i2').astype(np.float64)
        assert self.v.size == h['nx'] * h['ny']
        self.h = h

    def var(self, x, y):
        """Degrees, east positive, at map (x, y): the bilinear of geo-rules.js, line for line."""
        h, v = self.h, self.v
        mx, my = h['nx'] - 1, h['ny'] - 1
        fx = (x - h['x0']) / h['cell'] - 0.5
        fy = (y - h['y0']) / h['cell'] - 0.5
        fx = min(max(fx, 0), mx)
        fy = min(max(fy, 0), my)
        i, j = int(np.floor(fx)), int(np.floor(fy))
        i = min(i, mx - 1)
        j = min(j, my - 1)
        u, w, k, nx = fx - i, fy - j, j * h['nx'] + i, h['nx']
        a = v[k] + (v[k + 1] - v[k]) * u
        b = v[k + nx] + (v[k + nx + 1] - v[k + nx]) * u
        return float((a + (b - a) * w) * h.get('scale', 1))

    def at_geo(self, lat, lon):
        x, y = to_map(lat, lon)
        return self.var(float(x), float(y))


# ---------------------------------------------------------------- inputs
def load_ourairports():
    ap, rw = {}, {}
    with open(os.path.join(RAW, 'ourairports', 'airports.csv'), newline='') as f:
        for row in csv.DictReader(f):
            if row['ident'] in ICAOS:
                ap[row['ident']] = row
    with open(os.path.join(RAW, 'ourairports', 'runways.csv'), newline='') as f:
        for row in csv.DictReader(f):
            if row['airport_ident'] in ICAOS and row['closed'] != '1':
                for side in ('le', 'he'):
                    rw[(row['airport_ident'], row[f'{side}_ident'])] = dict(
                        lat=row[f'{side}_latitude_deg'], lon=row[f'{side}_longitude_deg'],
                        elev=row[f'{side}_elevation_ft'], disp=row[f'{side}_displaced_threshold_ft'],
                        hdg=row[f'{side}_heading_degT'], width=row['width_ft'], length=row['length_ft'],
                        surface=row['surface'])
    return ap, rw


def read_box(icao):
    """The small filtered box, read as bake_osm_extract.py's airports() reads Korea's."""
    path = os.path.join(osm_dir(icao), icao, 'aero.osm.pbf')
    wkb = osmium.geom.WKBFactory()
    dst = dict(nodes=[], ways=[], areas=[])
    fp = (osmium.FileProcessor(path)
          .with_locations()
          .with_areas(osmium.filter.KeyFilter('aeroway', 'building'))
          .with_filter(osmium.filter.KeyFilter('aeroway', 'building', 'highway')))
    for o in fp:
        try:
            if o.is_node():
                if 'aeroway' in o.tags:
                    dst['nodes'].append((o.id, dict(o.tags), o.location.lon, o.location.lat))
            elif o.is_way():
                tags = dict(o.tags)
                if len(o.nodes) >= 2 and ('aeroway' in tags or tags.get('highway') == 'service'):
                    dst['ways'].append((o.id, tags, [(n.lon, n.lat) for n in o.nodes]))
            elif o.is_area():
                tags = dict(o.tags)
                if 'building' in tags or tags.get('aeroway') in ('terminal', 'hangar', 'apron', 'aerodrome'):
                    dst['areas'].append((o.orig_id(), o.from_way(), tags, wkb.create_multipolygon(o)))
        except (osmium.InvalidLocationError, RuntimeError):
            pass
    return dst


def aerodrome_poly(d, icao, ox, oy):
    best = None
    for _, _, tags, g in d['areas']:
        if tags.get('aeroway') != 'aerodrome':
            continue
        geom = shapely.from_wkb(g)
        parts = [Polygon(to_xy(p.exterior.coords)) for p in shapely.get_parts(geom)]
        poly = shapely.unary_union(parts)
        score = (tags.get('icao') == icao, poly.contains(Point(ox, oy)), poly.area)
        if best is None or score > best[0]:
            best = (score, poly)
    if best is None:
        raise SystemExit(f'{icao}: no aeroway=aerodrome area in the box')
    return best[1]


def is_live(tags):
    if any(k in tags for k in LIFECYCLE) or any(k.startswith(p + ':') for k in tags for p in LIFECYCLE):
        return False
    return tags.get('runway') not in LIFECYCLE and tags.get('area') != 'yes'


def merged_runways(d, area):
    """One (ref, a, b) per runway: its ways (OSM often splits one) merged to the two extreme points."""
    groups = {}
    for _, tags, coords in d['ways']:
        if tags.get('aeroway') != 'runway' or not is_live(tags) or coords[0] == coords[-1]:
            continue
        ref = tags.get('ref', '').replace('-', '/').replace(' ', '')
        if '/' not in ref:
            continue
        xy = to_xy(coords)
        if not LineString(xy).intersects(area):
            continue
        a, b = sorted(ref.split('/'))
        groups.setdefault(f'{a}/{b}', []).append((tags, xy))
    out = []
    for ref, ways in groups.items():
        allxy = np.concatenate([xy for _, xy in ways])
        longest = max(ways, key=lambda w: np.hypot(*(w[1][-1] - w[1][0])))[1]
        u = (longest[-1] - longest[0]) / np.hypot(*(longest[-1] - longest[0]))
        s = (allxy - longest[0]) @ u
        a, b = allxy[np.argmin(s)], allxy[np.argmax(s)]
        tags = max((w for w in ways if w[0].get('runway') != 'displaced_threshold'), key=lambda w: len(w[0]),
                   default=ways[0])[0]
        # OSM's displaced-threshold segments: their length at the runway end they touch
        disp = {}
        for t, xy in ways:
            if t.get('runway') == 'displaced_threshold':
                seg = float(np.sum(np.hypot(*np.diff(xy, axis=0).T)))
                for key, end in (('a', a), ('b', b)):
                    if min(np.hypot(*(xy[0] - end)), np.hypot(*(xy[-1] - end))) < 5:
                        disp[key] = seg
        out.append((ref, tags, a, b, len(ways), disp))
    return out


# ---------------------------------------------------------------- the bake
class Plane:
    """frame.js magVar()'s plane, with Wmm's interface: Gimhae (inside south-korea.poly)."""
    def var(self, x, y):
        la, lo = to_geo(x, y)
        return float(mag_var(float(la), float(lo)))

    def at_geo(self, lat, lon):
        return float(mag_var(lat, lon))


def bake(icao, wmm, oa_ap, oa_rw):
    if icao in PLANE:
        wmm = Plane()
    d = read_box(icao)
    oa = oa_ap[icao]
    lat, lon = float(oa['latitude_deg']), float(oa['longitude_deg'])
    ox, oy = (float(v) for v in to_map(lat, lon))
    elev = float(oa['elevation_ft']) * FT
    poly = aerodrome_poly(d, icao, ox, oy)
    area = poly.buffer(30)
    est = []      # (item, value, reason)
    table = []

    # ---- runways
    runways = []
    for ref, tags, a, b, nways, osm_disp in merged_runways(d, area):
        ids = ref.split('/')
        t_ab, _ = bearing_true(a[0], a[1], b[0], b[1])
        la, lo = to_geo(a[0], a[1])
        mag_ab = (t_ab - wmm.at_geo(la, lo)) % 360
        n0 = num(ids[0].rstrip('LRC'))
        if abs(((n0 * 10 - mag_ab) + 180) % 360 - 180) > 90:
            a, b = b, a
            osm_disp = {{'a': 'b', 'b': 'a'}[k]: v for k, v in osm_disp.items()}
        length = float(np.hypot(*(b - a)))
        o0 = oa_rw.get((icao, ids[0]), {})
        if (icao, ref) in TRIM_BOTH:
            k = frame_scale(*(float(v) for v in to_geo(*((a + b) / 2))))
            cut = (length - num(o0.get('length')) * FT * k) / 2
            u = (b - a) / length
            a, b = a + u * cut, b - u * cut
            est.append((f'{ref} length', f'{length - 2 * cut:.1f} map m ({length - 2 * cut:.0f} / {k:.5f} = '
                        f'{(length - 2 * cut) / k:.0f} m; OSM {length:.0f} m)',
                        f'OSM\'s way over both 120 m blast pads: {cut:.0f} m trimmed from each end (TRIM_BOTH)'))
            length = float(np.hypot(*(b - a)))
        # Haneda 16R/34L: OSM's 16R displaced-threshold segment runs 37 m past the published 3,000 m (its
        # 523 m against the 480 m that the AIP's LDA of 8,270 ft implies). Where OSM is over the published
        # length by more than 1% and one end has a displaced segment, that end is trimmed to the length.
        pub = (num(o0.get('length')) or 0) * FT
        if pub and length > pub * 1.01 and len(osm_disp) == 1:
            key = next(iter(osm_disp))
            cut = length - pub
            u = (b - a) / length
            if key == 'a':
                a = a + u * cut
            else:
                b = b - u * cut
            osm_disp[key] -= cut
            est.append((f'{ref} length', f'{pub:.0f} m (OSM {length:.0f} m)',
                        f'OSM over the published length by {cut:.0f} m: the displaced end trimmed, its displacement '
                        f'{osm_disp[key] + cut:.0f} -> {osm_disp[key]:.0f} m'))
            length = float(np.hypot(*(b - a)))
        o1 = oa_rw.get((icao, ids[1]), {})
        # Gimhae 18R/36L: OSM's way runs 3,480 m, 280 m past the published 3,200 m at the 18R end (OurAirports'
        # 18R end 280 m in from OSM's, its 36L end 16 m). Where OSM is over the published length by more than 1%
        # with no displaced segment, the end farther from OurAirports' is trimmed to the length.
        if pub and length > pub * 1.01 and not osm_disp and o0.get('lat') and o1.get('lat'):
            ea = float(np.hypot(*(np.array(to_map(float(o0['lat']), float(o0['lon']))) - a)))
            eb = float(np.hypot(*(np.array(to_map(float(o1['lat']), float(o1['lon']))) - b)))
            cut = length - pub
            u = (b - a) / length
            if ea > eb:
                a = a + u * cut
            else:
                b = b - u * cut
            est.append((f'{ref} length', f'{pub:.0f} m (OSM {length:.0f} m)',
                        f'OSM over the published length by {cut:.0f} m with no displaced segment: the {ids[0] if ea > eb else ids[1]} '
                        f'end ({max(ea, eb):.0f} m from OurAirports\' end, the other {min(ea, eb):.0f} m) trimmed'))
            length = float(np.hypot(*(b - a)))
        # the width: OurAirports' rounded to 5 m (60 m at all three); OSM's tag noted where it differs
        oa_w = round(float(o0['width']) * FT / 5) * 5 if o0.get('width') else None
        width = float(AIP[icao][ids[0]][8]) if icao in AIP else (oa_w or num(tags.get('width')) or 45.0)
        if (icao, ref) in WIDTH_OVERRIDE:
            width = WIDTH_OVERRIDE[(icao, ref)]
            est.append((f'{ref} width', f'{width} m', f'OSM width tag {tags.get("width")} (the published 3,400 x 57.6 m); '
                        f'OurAirports {oa_w} m rounded'))
        elif num(tags.get('width')) != width and icao not in AIP:
            est.append((f'{ref} width', f'{width} m', f'OurAirports width_ft rounded to 5 m; OSM width tag {tags.get("width")}'))
        ends = []
        for ident, p, q, key in ((ids[0], a, b, 'a'), (ids[1], b, a, 'b')):
            o = oa_rw.get((icao, ident), {})
            oa_disp = (num(o.get('disp')) or 0.0) * FT
            aip = AIP.get(icao, {}).get(ident)
            disp = osm_disp.get(key, oa_disp)
            if aip:
                disp = float(aip[9])
            elif (icao, ident) in DISPLACED_PUBLISHED:
                disp = DISPLACED_PUBLISHED[(icao, ident)]
            elif key in osm_disp:
                est.append((f'{ident} displaced threshold', f'{disp:.0f} m',
                            f"OSM's runway=displaced_threshold segment (OurAirports {oa_disp:.0f} m)"))
            elif disp:
                est.append((f'{ident} displaced threshold', f'{disp:.0f} m', 'OurAirports (ft); not checked against the AIP'))
            e_elev = (num(o.get('elev')) * FT) if num(o.get('elev')) is not None else elev
            if aip:
                e_elev = aip[5] * FT
            elif num(o.get('elev')) is None:
                est.append((f'{ident} threshold elevation', f'{e_elev:.1f} m', 'no end elevation in OurAirports: the airport\'s'))
            u = (q - p) / np.hypot(*(q - p))
            th = p + u * disp
            tlat, tlon = to_geo(th[0], th[1])
            hdg_t, hdg_g = bearing_true(th[0], th[1], q[0], q[1])
            mv = wmm.var(float(th[0]), float(th[1]))
            hdg_m = (hdg_t - mv) % 360
            oa_off = None
            if o.get('lat'):
                exy = np.array(to_map(float(o['lat']), float(o['lon'])))
                oa_off = float(np.hypot(*(exy - p)))
            ends.append(dict(ident=ident, lat=round(float(tlat), 7), lon=round(float(tlon), 7),
                             x=r1(th[0]), y=r1(th[1]), elevM=round(e_elev, 1), displacedM=round(disp, 1),
                             hdgTrueDeg=round(float(hdg_t), 2), hdgGridDeg=round(float(hdg_g), 2),
                             hdgMagDeg=round(float(hdg_m), 2), pavementEnd=[r1(p[0]), r1(p[1])],
                             **(dict(papi=aip[2], papiDeg=aip[3], approachLights=aip[0], approachLightsM=aip[1],
                                     ils=aip[4], tdzLights=aip[6], centrelineLights=aip[7]) if aip else
                                {**DEFAULT_END, 'centrelineLights': width > 50,
                                 **END_OVERRIDE.get(icao, {}).get(ident, {})})))
            table.append(dict(pub=PUBLISHED_MAG.get(icao, {}).get(ident), ident=ident, true=float(hdg_t), grid=float(hdg_g), mag=float(hdg_m), var=mv,
                              length=length, oaLength=(num(o.get('length')) or 0) * FT, width=width,
                              elev=e_elev, disp=disp, oaOff=oa_off, ways=nways))
        runways.append(dict(id=f'{ids[0]}/{ids[1]}', widthM=float(width), lengthM=round(length, 1),
                            surface=tags.get('surface', 'asphalt'), ends=ends))

    if icao not in AIP:
      est.insert(0, ('every end: approachLights ALSF-I 900 m, papi left 3.0 deg, ils I, centrelineLights, no tdzLights',
                   ', '.join(e['ident'] for r in runways for e in r['ends']), EST_REASON))
      if any(not e['centrelineLights'] for r in runways for e in r['ends']):
          est.insert(1, ('centrelineLights false', ', '.join(e['ident'] for r in runways for e in r['ends'] if not e['centrelineLights']),
                         'the runway is 50 m wide: Annex 14 recommends centreline lights on a CAT I runway only wider than 50 m '
                         '(they are required from CAT II); the ILS on both ends is in the nav data, its category not read: I'))
      if icao in END_OVERRIDE:
          est.insert(1, ('ends changed from the default: ' + '; '.join(f'{k} {v}' for k, v in END_OVERRIDE[icao].items()),
                         ', '.join(END_OVERRIDE[icao]), OVERRIDE_REASON[icao]))

    # ---- taxiways, aprons, stands, holds, buildings, service roads: bake_airports.py's rules
    taxiways = []
    lines_as_stands, skip = STAND_LINES.get(icao, set()), LEADIN_ARCS.get(icao, set())
    refs_est = TWY_REFS.get(icao, {})
    for wid, tags, coords in d['ways']:
        if tags.get('aeroway') in ('taxiway', 'taxilane') and is_live(tags):
            if wid in lines_as_stands or wid in skip:
                continue
            xy = to_xy(coords)
            if not LineString(xy).intersects(area):
                continue
            w = num(tags.get('width'), 23.0 if tags.get('aeroway') == 'taxiway' else 15.0)
            taxiways.append(dict(ref=tags.get('ref', '') or refs_est.get(wid, ''), kind=tags['aeroway'], widthM=w, points=pts(xy)))
    if refs_est:
        est.append(('taxiway names', ', '.join(sorted(set(refs_est.values()))), TWY_REF_REASONS.get(icao, TWY_REF_REASON)))
    twy_lines = shapely.MultiLineString([t['points'] for t in taxiways if t['kind'] == 'taxiway'] or
                                        [t['points'] for t in taxiways])

    aprons = []
    for _, _, tags, g in d['areas']:
        if tags.get('aeroway') == 'apron':
            for p in shapely.get_parts(shapely.from_wkb(g)):
                xy = to_xy(p.exterior.coords)
                if Polygon(xy).intersects(area):
                    aprons.append(dict(points=pts(xy)))

    bridges = [LineString(to_xy(c)) for _, t, c in d['ways'] if t.get('aeroway') == 'jet_bridge']
    gate_nodes = [Point(to_map(la, lo)) for _, t, lo, la in d['nodes'] if t.get('aeroway') == 'gate']
    near_gate = lambda p: any(b.distance(p) < 45 for b in bridges) or any(g.distance(p) < 45 for g in gate_nodes)
    stands, seen = [], set()
    node_refs = [(tuple(float(v) for v in to_map(la, lo)), t['ref']) for _, t, lo, la in d['nodes']
                 if t.get('aeroway') == 'parking_position' and t.get('ref')]
    for _, tags, coords in d['ways']:
        if tags.get('aeroway') != 'parking_position' or icao in PP_CHAINS:
            continue
        xy = to_xy(coords)
        a, b = xy[0], xy[-1]
        if not Point(a).within(area) and not Point(b).within(area):
            continue
        if twy_lines.distance(Point(a)) > twy_lines.distance(Point(b)):
            a, b = b, a
        if np.hypot(*(b - a)) < 1:
            continue
        hdg_g = float(np.degrees(np.arctan2(b[0] - a[0], b[1] - a[1])) % 360)
        ref = tags.get('ref', '')
        if not ref:     # Narita, Pudong: the number is on the stop-mark node, not the lead-in way
            ln = LineString(xy)
            cands = sorted((Point(nx_, ny_).distance(Point(b)), r) for (nx_, ny_), r in node_refs
                           if ln.distance(Point(nx_, ny_)) < 3 or Point(nx_, ny_).distance(Point(b)) < 15)
            if cands:
                ref = cands[0][1]
        stands.append(dict(ref=ref, x=r1(b[0]), y=r1(b[1]), hdgGridDeg=round(hdg_g, 1),
                           gate=bool(near_gate(Point(b))), leadIn=pts(xy)))
        seen.add(ref)
    if icao in STAND_POINTS:
        stands += stands_from_points(icao, near_gate)
        est.append(('stands', f'{len(STAND_POINTS[icao])} from STAND_POINTS',
                    'OSM maps no stand numbers and draws the rows as taxiway loops: the X-Plane Scenery Gateway\'s stands '
                    '(open secondary), numbered as AIP Russia\'s parking chart; a 60 m lead-in along each heading'))
    if icao in PP_CHAINS:
        got, n_pp = stands_from_pp_chains(d, area, twy_lines, near_gate, node_refs)
        stands += got
        seen |= {st['ref'] for st in got if st['ref']}
        est.append(('stands from parking_position chains', f'{len(got)} dead ends of {n_pp} ways',
                    'OSM draws each stand as a lead-in plus its turn-in arcs as separate parking_position ways: a stand '
                    f'only at a dead end of that network, at least {PP_TWY_M:.0f} m from the taxiways (PP_CHAINS)'))
    if lines_as_stands:
        stands += stands_from_lines(d, lines_as_stands, runways, near_gate)
        est.append(('stands', f'{len(lines_as_stands)} from OSM taxiway ways (stand lead-in lines)',
                    'no parking_position in OSM: each lead-in line drawn as aeroway=taxiway (straight, square to the runway, '
                    'a dead end at the stop mark, ~48 m apart: code C) is a stand, its stop the dead end, its heading the '
                    f'line\'s last 30 m; {len(skip)} turn-in arcs dropped'))
    for _, tags, lo, la in d['nodes']:
        if tags.get('aeroway') != 'parking_position' or icao in STAND_POINTS:
            continue
        ref = tags.get('ref', '')
        if ref and ref in seen:
            continue
        x, y = to_map(la, lo)
        p = Point(x, y)
        if not p.within(area):
            continue
        q = shapely.ops.nearest_points(twy_lines, p)[0]
        hdg_g = float(np.degrees(np.arctan2(x - q.x, y - q.y)) % 360)
        stands.append(dict(ref=ref, x=r1(x), y=r1(y), hdgGridDeg=round(hdg_g, 1), gate=bool(near_gate(p))))
    if icao in MILITARY:
        mil = military_polys(icao)
        n0 = len(stands)
        stands = [st for st in stands if not any(pp.contains(Point(st['x'], st['y'])) for _, pp in mil)]
        est.append(('military side', f'{n0 - len(stands)} OSM stands left out',
                    'inside OSM landuse=military (' + '; '.join(n or '(unnamed)' for n, _ in mil) + '): its aprons and buildings kept, no stands'
                    + ('; OSM\'s small hardstands there are drawn as taxiways: kept as taxiways, no stands' if icao == 'ZSYN' else '')))
    merged = []
    for st in stands:
        if any(np.hypot(st['x'] - m['x'], st['y'] - m['y']) < 15 for m in merged):
            continue
        merged.append(st)
    stands = merged
    # duplicate refs (two lead-ins of one stand, or a node and a way): keep the first, number the rest
    refs = set()
    gate_refs = [(Point(to_map(la, lo)), t.get('ref', '')) for _, t, lo, la in d['nodes']
                 if t.get('aeroway') == 'gate' and t.get('ref')]
    first, keep, dropped = {}, [], 0
    for st in stands:
        r = st['ref']
        if r and r in first:
            f0 = first[r]
            if np.hypot(st['x'] - f0['x'], st['y'] - f0['y']) < 60:
                dropped += 1
                continue
            k = 2
            while f'{r}-{k}' in first:
                k += 1
            st['ref'] = f'{r}-{k}'
            est.append((f'stand {st["ref"]}', 'renamed', f'a second OSM stand numbered {r}, '
                        f'{np.hypot(st["x"] - f0["x"], st["y"] - f0["y"]):.0f} m from the first'))
        first[st['ref'] or f'__{len(keep)}'] = st
        keep.append(st)
        refs.add(st['ref'])
    stands = keep
    if dropped:
        est.append(('stands dropped', dropped, 'a second lead-in of a stand already read (same ref, within 60 m)'))
    unnamed = [st for st in stands if not st['ref']]
    numbered = []
    if unnamed:
        used = set(refs)
        for st in unnamed:
            p = Point(st['x'], st['y'])
            cands = sorted((g.distance(p), r) for g, r in gate_refs if r not in used)
            if cands and cands[0][0] < 80:
                st['ref'] = cands[0][1]
                used.add(cands[0][1])
                st['gate'] = True
        k = 1
        fmt = STAND_FORMAT.get(icao, 'R{}')
        for st in sorted((s for s in unnamed if not s['ref']), key=lambda s: s['x']):
            while fmt.format(k) in used:
                k += 1
            st['ref'] = fmt.format(k)
            used.add(st['ref'])
            numbered.append(st['ref'])
    if numbered:
        est.append(('stand numbers', f'{len(numbered)} stands {numbered[0]}..{numbered[-1]}',
                    f'no ref in OSM and no gate within 80 m: numbered {fmt.format(1)}.. west to east'))

    if not aprons and stands:
        blob = shapely.unary_union([Point(s['x'], s['y']).buffer(40) for s in stands] +
                                   [LineString(s['leadIn']).buffer(25) for s in stands if 'leadIn' in s])
        blob = blob.buffer(15).buffer(-15)
        for p in shapely.get_parts(blob):
            if p.area > 5000:
                aprons.append(dict(points=pts(np.asarray(p.simplify(3).exterior.coords)), synthetic=True))

    holds = []
    for _, tags, lo, la in d['nodes']:
        if tags.get('aeroway') == 'holding_position':
            x, y = to_map(la, lo)
            if Point(x, y).within(area):
                holds.append(dict(ref=tags.get('ref', ''), x=r1(x), y=r1(y)))
    for _, tags, coords in d['ways']:
        if tags.get('aeroway') == 'holding_position':
            xy = to_xy(coords).mean(0)
            if Point(xy).within(area):
                holds.append(dict(ref=tags.get('ref', ''), x=r1(xy[0]), y=r1(xy[1])))

    extra = stand_aprons(stands, aprons, runways, icao)
    if extra:
        est.append(('aprons added', f'{len(extra)} pieces, {sum(Polygon(a["points"]).area for a in extra) / 1e6:.2f} km2',
                    f'stands off OSM\'s aprons ({APRON_SYNTH_REASON}): pavement made round them, "synthetic": true'))
        aprons += extra
    n_osm_holds = len(holds)
    made = derive_holds(runways, taxiways, holds)
    holds += made
    if made:
        est.append(('holding positions', f'{len(made)} made (OSM {n_osm_holds})',
                    f'a taxiway meeting a runway with no mapped hold on it: one made {HOLD_CL_M:.0f} m from the centreline '
                    f'(Annex 14 Table 3-2, code 4 precision), or short of a parallel taxiway closer than that '
                    f'(at least {HOLD_MIN_EDGE_M:.0f} m outside the edge); "est": true, ref the taxiway\'s'))

    buildings = []
    for _, _, tags, g in d['areas']:
        kind = tags.get('aeroway') if tags.get('aeroway') in ('terminal', 'hangar') else (
            'hangar' if tags.get('building') == 'hangar' else
            'terminal' if tags.get('building') in ('terminal', 'transportation') else
            'building' if 'building' in tags else None)
        if not kind or not is_live({k: v for k, v in tags.items() if k != 'building'}):
            continue
        for p in shapely.get_parts(shapely.from_wkb(g)):
            xy = to_xy(p.exterior.coords)
            pp = Polygon(xy)
            if not pp.centroid.within(area) or pp.area < 30:
                continue
            buildings.append(dict(kind=kind, heightM=round(building_height(tags, kind), 1),
                                  name=tags.get('name:en') or tags.get('name') or '', points=pts(xy)))

    roads = []
    for _, tags, coords in d['ways']:
        if tags.get('highway') == 'service':
            ln = LineString(to_xy(coords))
            if ln.intersects(area):
                for part in shapely.get_parts(ln.intersection(area)):
                    if part.geom_type == 'LineString' and part.length > 20:
                        roads.append(dict(points=pts(part.coords)))

    short, full = NAMES[icao]
    outer = poly if poly.geom_type == 'Polygon' else max(poly.geoms, key=lambda g: g.area)
    out = dict(icao=icao, name=full, shortName=short, lat=lat, lon=lon, elevM=round(elev, 1),
               origin=[r1(ox), r1(oy)], magVarDeg=round(wmm.var(ox, oy), 2),
               boundary=pts(outer.exterior.coords),
               runways=runways, taxiways=taxiways, aprons=aprons, stands=stands,
               holdingPositions=holds, buildings=buildings, serviceRoads=roads)
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f'{icao}.json')
    with open(path + '.tmp', 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    os.replace(path + '.tmp', path)
    summary = (f'{icao}: {len(runways)} runways, {len(taxiways)} taxiways '
               f'({sum(1 for t in taxiways if t["ref"])} with ref), {len(aprons)} aprons, {len(stands)} stands '
               f'({sum(s["gate"] for s in stands)} gates, {len(stands) - len(numbered)} with OSM/gate ref), '
               f'{len(holds)} holds, {len(buildings)} buildings, {len(roads)} service roads; '
               f'{os.path.getsize(path)} bytes; magVar {out["magVarDeg"]}')
    print(summary)
    write_notes(icao, out, table, est, summary)
    return table


def stands_from_points(icao, near_gate):
    """STAND_POINTS: stands at published or listed points, each with a straight lead-in behind it along its heading."""
    out = []
    for ref, la, lo, hdg in STAND_POINTS[icao]:
        h = np.radians(hdg)
        back = STAND_POINTS_LEADIN_M
        la0 = la - back * np.cos(h) / 111320.0
        lo0 = lo - back * np.sin(h) / (111320.0 * np.cos(np.radians(la)))
        b = np.array(to_map(la, lo), float)
        a = np.array(to_map(la0, lo0), float)
        a = b + (a - b) * back / float(np.hypot(*(a - b)))
        hdg_g = float(np.degrees(np.arctan2(b[0] - a[0], b[1] - a[1])) % 360)
        out.append(dict(ref=ref, x=r1(b[0]), y=r1(b[1]), hdgGridDeg=round(hdg_g, 1), gate=bool(near_gate(Point(b))),
                        leadIn=pts(np.array([a, b]))))
    return out


def stands_from_pp_chains(d, area, twy_lines, near_gate, node_refs):
    """PP_CHAINS: a stand at each dead end of OSM's parking_position network (see PP_CHAINS). Returns (stands, ways read)."""
    ways = []
    for _, tags, coords in d['ways']:
        if tags.get('aeroway') != 'parking_position':
            continue
        xy = to_xy(coords)
        if not Point(xy[0]).within(area) and not Point(xy[-1]).within(area):
            continue
        ways.append((tags, xy))
    lines = [LineString(xy) for _, xy in ways]
    out = []
    for k, (tags, xy) in enumerate(ways):
        for P in (xy, xy[::-1]):
            b = P[-1]
            pb = Point(b)
            if any(m != k and lines[m].distance(pb) < 2 for m in range(len(lines))):
                continue                                    # joined to another piece: not a dead end
            if twy_lines.distance(pb) < PP_TWY_M:
                continue                                    # an arc's end on the taxiway
            if np.hypot(*(P[-1] - P[0])) < 1 and len(P) < 3:
                continue
            ln = LineString(P)
            ref = tags.get('ref', '')
            if not ref:
                cands = sorted((Point(q).distance(pb), r) for q, r in node_refs
                               if Point(q).distance(pb) < 15)
                if cands:
                    ref = cands[0][1]
            # the heading: from the point 30 m back along the way (as stands_from_lines)
            back = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P[::-1], axis=0).T))])
            j = int(np.searchsorted(back, 30.0))
            a = P[::-1][min(j, len(P) - 1)]
            if np.hypot(*(b - a)) < 5:
                continue
            hdg_g = float(np.degrees(np.arctan2(b[0] - a[0], b[1] - a[1])) % 360)
            out.append(dict(ref=ref, x=r1(b[0]), y=r1(b[1]), hdgGridDeg=round(hdg_g, 1), gate=bool(near_gate(pb)),
                            leadIn=pts(P)))
    return out, len(ways)


def stands_from_lines(d, ids, runways, near_gate):
    """Stands from OSM taxiway ways that are really stand lead-in lines (STAND_LINES): the end farther from every
    runway centreline is the stop point; the line, oriented towards it, is the leadIn."""
    rws = [(np.array(r['ends'][0]['pavementEnd'], float), np.array(r['ends'][1]['pavementEnd'], float)) for r in runways]

    def cl(p):
        return min(LineString([a, b]).distance(Point(*p)) for a, b in rws)
    out = []
    for wid, tags, coords in d['ways']:
        if wid not in ids:
            continue
        xy = to_xy(coords)
        if cl(xy[0]) > cl(xy[-1]):
            xy = xy[::-1]
        b = xy[-1]
        # the heading: from the point 30 m back along the line (its straight last part; some lines start in a curve)
        back = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(xy[::-1], axis=0).T))])
        k = int(np.searchsorted(back, 30.0))
        a = xy[::-1][min(k, len(xy) - 1)]
        hdg_g = float(np.degrees(np.arctan2(b[0] - a[0], b[1] - a[1])) % 360)
        out.append(dict(ref='', x=r1(b[0]), y=r1(b[1]), hdgGridDeg=round(hdg_g, 1), gate=bool(near_gate(Point(b))),
                        leadIn=pts(xy)))
    return out


APRON_SYNTH_REASON = 'a lead-in, or the stop point or 30 m behind it, off a mapped apron'


def stand_aprons(stands, aprons, runways, icao=None):
    """Aprons made round the stands that OSM's aprons leave out (Qingdao maps only part of its apron): for each such
    stand a 50 x 44 m box behind the stop point, and every stand's lead-in widened to 25 m each side, merged, closed, less the
    mapped aprons and 30 m round each runway. Pieces under 500 m2 are dropped. Marked "synthetic": true, as
    bake_airports.py's (an airport with no aprons at all)."""
    if not stands:
        return []
    mapped = shapely.unary_union([Polygon(a['points']).buffer(0) for a in aprons]) if aprons else Polygon()
    pieces = []
    for st in stands:
        # every stand's lead-in is pavement, 25 m each side (Haneda's 5R-2 runs 180 m from its taxiway, across a gap
        # between OSM's aprons that its pushback crosses)
        if 'leadIn' in st and len(st['leadIn']) >= 2:
            pieces.append(LineString(st['leadIn']).buffer(25))
        h = np.radians(st['hdgGridDeg'])
        f = np.array([np.sin(h), np.cos(h)])
        p0 = np.array([st['x'], st['y']])
        if mapped.contains(Point(*p0)) and mapped.contains(Point(*(p0 - 30 * f))):
            continue
        rgt = np.array([f[1], -f[0]])
        box = [p0 + 5 * f + 22 * rgt, p0 + 5 * f - 22 * rgt, p0 - 50 * f - 22 * rgt, p0 - 50 * f + 22 * rgt]
        pieces.append(Polygon(box))
    if not pieces:
        return []
    blob = shapely.unary_union(pieces).buffer(15).buffer(-15)
    if icao in APRON_CLOSE:
        # v0.6.1: the wedges of grass left between the made pieces and the mapped aprons, closed where they are
        # narrower than twice this (Gimhae's remote stands stood on islands of pavement with turf between them).
        c = APRON_CLOSE[icao]
        blob = shapely.unary_union([blob, mapped]).buffer(c).buffer(-c)
    rw = shapely.unary_union([LineString([r['ends'][0]['pavementEnd'], r['ends'][1]['pavementEnd']]).buffer(r['widthM'] / 2 + 30)
                              for r in runways])
    blob = blob.difference(mapped.buffer(-0.5)).difference(rw)
    # an apron is an outline without holes: cut a piece through each hole it has (a mapped apron inside it)
    todo, solid = list(shapely.get_parts(blob)), []
    while todo:
        p = todo.pop()
        if p.geom_type != 'Polygon' or p.area <= 500:
            continue
        if not p.interiors:
            solid.append(p)
            continue
        cx = Polygon(p.interiors[0]).centroid.x
        y0, y1 = p.bounds[1] - 1, p.bounds[3] + 1
        todo += list(shapely.get_parts(shapely.ops.split(p, LineString([(cx, y0), (cx, y1)]))))
    return [dict(points=pts(np.asarray(p.simplify(2).exterior.coords)), synthetic=True)
            for p in sorted(solid, key=lambda q: (round(q.centroid.x, 1), round(q.centroid.y, 1)))]


def _densify(P, step=1.0):
    out = [P[0]]
    for a, b in zip(P[:-1], P[1:]):
        n = max(1, int(np.ceil(np.hypot(*(b - a)) / step)))
        for k in range(1, n + 1):
            out.append(a + (b - a) * (k / n))
    return np.array(out)


def derive_holds(runways, taxiways, holds):
    """Holding positions made where a taxiway meets a runway and OSM maps none on it (see HOLD_CL_M)."""
    rws = []
    for r in runways:
        p, q = np.array(r['ends'][0]['pavementEnd'], float), np.array(r['ends'][1]['pavementEnd'], float)
        L = float(np.hypot(*(q - p)))
        rws.append(dict(id=r['id'], p=p, q=q, u=(q - p) / L, L=L, half=r['widthM'] / 2))

    def cl_dist(rw, xy):
        t = np.clip(((xy - rw['p']) @ rw['u']) / rw['L'], 0, 1)
        return np.hypot(*(xy - (rw['p'] + np.outer(t * rw['L'], rw['u']))).T)

    lines = [np.array(t['points'], float) for t in taxiways]
    # every taxi segment, for the parallel-junction test
    seg_a = np.concatenate([P[:-1] for P in lines])
    seg_b = np.concatenate([P[1:] for P in lines])
    seg_line = np.concatenate([np.full(len(P) - 1, k) for k, P in enumerate(lines)])
    seg_d = seg_b - seg_a
    seg_l2 = np.maximum((seg_d ** 2).sum(1), 1e-9)
    seg_u = seg_d / np.sqrt(seg_l2)[:, None]
    mapped = np.array([[h['x'], h['y']] for h in holds], float).reshape(-1, 2)
    ends_at = {}      # rounded end point -> [(line, 0 | -1)]
    for k, P in enumerate(lines):
        for e in (0, -1):
            ends_at.setdefault((round(P[e][0]), round(P[e][1])), []).append((k, e))
    made = []

    def parallel_junction(xy, k, rw, near):
        ap = xy - seg_a[near]
        t = np.clip((ap * seg_d[near]).sum(1) / seg_l2[near], 0, 1)
        d = np.hypot(*(xy - (seg_a[near] + seg_d[near] * t[:, None])).T)
        hit = near[(d < 10) & (seg_line[near] != k)]
        if not len(hit):
            return False
        cosang = np.abs(seg_u[hit] @ rw['u'])
        return bool((cosang > np.cos(np.radians(HOLD_PARALLEL_DEG))).any())

    def walk(k, P, i, step, rw, near):
        """From sample i of line k outward (step +-1): the samples walked, across OSM's way splits."""
        S = []
        for _hop in range(4):
            j = i
            while 0 <= j + step < len(P):
                j += step
                S.append((k, j, P[j]))
            end = P[j]
            nxt = [(m, e) for m, e in ends_at.get((round(end[0]), round(end[1])), []) if m != k]
            if len(nxt) != 1:
                return S, len(nxt) > 1          # a junction of several ways, or the line just ends
            m, e = nxt[0]
            Q = _densify(lines[m])
            dirv = (Q[1] - Q[0]) if e == 0 else (Q[-2] - Q[-1])
            if abs(dirv @ rw['u']) / max(np.hypot(*dirv), 1e-9) > np.cos(np.radians(HOLD_PARALLEL_DEG)):
                return S, True                  # it carries on as a parallel taxiway: a junction
            k, P = m, Q
            i, step = (0, 1) if e == 0 else (len(Q) - 1, -1)
        return S, False

    for rw in rws:
        half = rw['half']
        near = np.flatnonzero(cl_dist(rw, seg_a) < HOLD_CL_M + 120)
        for k, t in enumerate(taxiways):
            P = _densify(lines[k])
            D = cl_dist(rw, P)
            zone = D <= half + HOLD_JOIN_M
            if not zone.any():
                continue
            idx = np.flatnonzero(zone)
            runs = np.split(idx, np.flatnonzero(np.diff(idx) > 1) + 1)
            for run in runs:
                for start, step in ((run[0], -1), (run[-1], 1)):
                    S, junction_end = walk(k, P, start, step, rw, near)
                    target, stop = None, None
                    for n, (m, j, xy) in enumerate(S):
                        dj = float(cl_dist(rw, xy[None])[0])
                        if dj <= half + HOLD_JOIN_M:
                            break                                   # back on the runway (a line that touches it twice)
                        if dj < HOLD_CL_M + 10 and parallel_junction(xy[None], m, rw, near):
                            stop = n
                            break
                        if dj >= HOLD_CL_M:
                            target = n
                            break
                    else:
                        if S and junction_end:
                            stop = len(S) - 1
                    if target is None and stop is not None:
                        dstop = float(cl_dist(rw, S[stop][2][None])[0])
                        want = min(HOLD_CL_M, dstop - 12)
                        if want < half + HOLD_MIN_EDGE_M:
                            continue
                        target = next((n for n, (_m, _j, xy) in enumerate(S[:stop + 1])
                                       if cl_dist(rw, xy[None])[0] >= want), None)
                    if target is None:
                        continue
                    xy = S[target][2]
                    # a mapped hold on this stub already (from the edge to 60 m past the target), or a made one here
                    stub = np.array([s[2] for s in S[:target + 60]])
                    if len(mapped) and (np.hypot(*(mapped[:, None, :] - stub[None]).transpose(2, 0, 1)) < 12).any():
                        continue
                    if any(np.hypot(h['x'] - xy[0], h['y'] - xy[1]) < 15 for h in made):
                        continue
                    if any(o is not rw and cl_dist(o, xy[None])[0] < o['half'] + 30 for o in rws):
                        continue                                    # inside another runway's strip
                    made.append(dict(ref=taxiways[S[target][0]]['ref'], x=r1(xy[0]), y=r1(xy[1]), est=True))
    return made


def write_notes(icao, out, table, est, summary):
    notes = NOTES_DIRS.get(icao, NOTES_DIR)
    os.makedirs(notes, exist_ok=True)
    L = [f'# {icao} {out["shortName"]}: bake notes (tools/bake_region_airports.py)', '', summary, '',
         f'magVarDeg {out["magVarDeg"]} (WMM2025 grid, epoch 2026.0, at the reference point)', '',
         '| End | True | Grid | Var | Mag | Published mag | Mag-published | Ident-mag | OSM length m | OA length m | Diff % | Width | Thr elev m | Displ m | OA end off m | OSM ways |',
         '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for t in table:
        dev = ((num(t['ident'].rstrip('LRC')) * 10 - t['mag']) + 180) % 360 - 180
        dl = (t['length'] / t['oaLength'] - 1) * 100 if t['oaLength'] else float('nan')
        pd = f'{((t["mag"] - t["pub"]) + 180) % 360 - 180:+.2f}' if t['pub'] is not None else 'n/a'
        L.append(f'| {t["ident"]} | {t["true"]:.2f} | {t["grid"]:.2f} | {t["var"]:+.2f} | {t["mag"]:.2f} | '
                 f'{t["pub"] if t["pub"] is not None else "not read"} | {pd} | {dev:+.2f} | '
                 f'{t["length"]:.0f} | {t["oaLength"]:.0f} | {dl:+.2f} | {t["width"]} | {t["elev"]:.1f} | {t["disp"]:.0f} | '
                 f'{t["oaOff"] if t["oaOff"] is None else round(t["oaOff"])} | {t["ways"]} |')
    if icao in AIP:
        L += ['', 'Lights, PAPIs, approach lights, ILS categories, threshold elevations, displacements and widths: AIP Japan '
              'AD 2.12-2.14 and 2.19 (see AIP in tools/bake_region_airports.py for the pages and dates). Thresholds checked '
              'against AD 2.12\'s coordinates in tests/region-airports.test.mjs (all within 15 m).']
    L += ['', '## [EST] items', '', '| Item | Value | Reason |', '|---|---|---|']
    L += [f'| {a} | {b} | {c} |' for a, b, c in est]
    with open(os.path.join(notes, f'{icao}.md'), 'w') as f:
        f.write('\n'.join(L) + '\n')


def main():
    want = sys.argv[1:] or ICAOS
    wmm = Wmm()
    oa_ap, oa_rw = load_ourairports()
    for icao in want:
        if not os.path.exists(os.path.join(osm_dir(icao), icao, 'aero.osm.pbf')):
            print(f'{icao}: no OSM box yet ({osm_dir(icao)}/{icao}/aero.osm.pbf), skipped')
            continue
        table = bake(icao, wmm, oa_ap, oa_rw)
        for t in table:
            dev = ((num(t['ident'].rstrip('LRC')) * 10 - t['mag']) + 180) % 360 - 180
            print(f'  {t["ident"]:4s} true {t["true"]:6.2f} var {t["var"]:+.2f} mag {t["mag"]:6.2f} ({dev:+.1f} from ident) '
                  f'len {t["length"]:6.0f} OA {t["oaLength"]:6.0f}  displ {t["disp"]:4.0f}  ways {t["ways"]}')


if __name__ == '__main__':
    main()
