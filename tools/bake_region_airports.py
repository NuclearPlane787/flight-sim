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
    # v0.6.4 (briefs/V0-6-4.md), pending until each passes its check
    'ZKPY': ('Pyongyang', 'Pyongyang Sunan International Airport'),
    'ZKWS': ('Wonsan', 'Wonsan Kalma International Airport'),
    'RJSN': ('Niigata', 'Niigata Airport'),
    'RJSS': ('Sendai', 'Sendai Airport'),
    'RJSA': ('Aomori', 'Aomori Airport'),
    'RJCC': ('New Chitose', 'New Chitose Airport (Sapporo)'),
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
# v0.7.0, Munich: OSM maps Terminal 1's apron as a strip 130 m deep along the building, and nothing between it and the
# apron's taxiways 200 m behind the stands, so a pushback (taxi.js's lineBehind(): straight back along the stand's
# heading to the first taxi line 30 to 250 m behind) ran over 150 m of "grass". Where an airport is named here, the
# ground under each stand's pushback is pavement too: a strip this many metres each side of that ray, from the stand to
# 12 m past the line, for the line an A321 takes (30 m back at least) and the ones the widebodies take (62 and 75 m).
# Munich's Terminal 1 stands have no taxiway within those 250 m at all: the first behind them is the apron's own taxilane
# W1, 377 m back, and the game pushes back onto the links its network makes across that ground. So for the taxiways named
# here the ray is followed that far (m): all of it between Terminal 1's stands and W1 is pavement, as it is.
APRON_PUSH = {'EDDM': 27.0}
APRON_PUSH_FAR = {'EDDM': (450.0, {'W1'})}
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

# v0.6.4, Pyongyang Sunan (ZKPY) and Wonsan Kalma (ZKWS), pending: their boxes cut by /tmp/flight-sim/v064/osm/extract-kp.sh
# (north-korea-261119), notes in /tmp/flight-sim/v064/airports/bake. North Korea publishes no AIP online: open secondary
# sources only (X-Plane 12's nav data as listed on airports4xp.info; the X-Plane Scenery Gateway's recommended sceneries,
# ZKPY 112628 of 2026-10, its ramp starts "acc. to Jeppesen of 12 Jun 26", ZKWS 93376 of 2022-12); no source kept here.
OSM_DIRS.update({i: '/tmp/flight-sim/v064/osm' for i in ('ZKPY', 'ZKWS')})
NOTES_DIRS.update({i: '/tmp/flight-sim/v064/airports/bake' for i in ('ZKPY', 'ZKWS')})
# Runways OSM draws as live that the bake leaves out: Pyongyang's 01/19 (OurAirports closed=1; the Gateway's scenery
# draws it unlit, no approach lights, no ILS in the nav data; the ILS, PAPIs and lights are all 17/35's), and Wonsan's
# 02/20 (a 500 x 30 m strip by the terminal apron, no lights, no procedure).
RUNWAY_SKIP = {('ZKPY', '01/19'), ('ZKWS', '02/20')}
REF_ALIAS = {}      # v0.7.0: OSM runway ref -> 'A/B' for a runway OSM tags one way only (Europe's block fills it)
HOLD_DROP_M = {}    # v0.7.0: icao -> m; OSM holds farther than this from every taxiway are left out (Europe's block fills it)
REF_SQUEEZE = set()  # v0.7.0: airports whose OSM stand refs 'B 44' are read as B44 (Europe's block fills it)
STAND_DROP = {}     # v0.7.0: icao -> (refs, reason): OSM stands on taxiways no route reaches (Europe's block fills it)
# - Pyongyang 17/35: ILS CAT I at both ends (17: 109.5, 35: 109.9, 3.0 deg glide paths; the nav data); 17 ALSF-I, PAPI-4R
#   (right), 35 SALS (drawn as the game's SSALF, 420 m [EST]) and PAPI-4L, centreline lights, no TDZ (the scenery's runway
#   row and light fixtures, and OSM's PAPI node beside 35). Its stopways (99 m and 72 m, OSM's aeroway=stopway and the
#   scenery's blast pads) are not runway: OSM's 17/35 way ends at the thresholds, no displacement.
END_OVERRIDE.update({
    'ZKPY': {'17': dict(papi='right', centrelineLights=True),
             '35': dict(approachLights='SSALF', approachLightsM=420, centrelineLights=True)},
})
OVERRIDE_REASON.update({
    'ZKPY': ("open secondary sources, no AIP published online: ILS I at 17 (109.5) and 35 (109.9), 3.0 deg (X-Plane 12's nav "
             "data, airports4xp.info); 17 ALSF-I with PAPI-4R, 35 SALS (drawn as SSALF 420 m) with PAPI-4L, centreline "
             "lights, no TDZ (the Scenery Gateway's scenery 112628, 2026-10). [EST]: the approach lights' lengths"),
})
PUBLISHED_MAG.update({'ZKPY': {'17': 163.0, '35': 343.0}})     # OurAirports' heading_degT (true, older); notes only
MILITARY = MILITARY | {'ZKPY'}
# Pyongyang 17/35 is 60 m wide (OSM's width tag, the Gateway's runway row); OurAirports' 230 ft would be 70 m.
WIDTH_OVERRIDE[('ZKPY', '17/35')] = 60.0
# - Wonsan Kalma: two runways, 15L/33R (3,500 x 60 m, the 2015 runway) and 15R/33L (3,125 m, the old one; OSM's length tag).
#   The Gateway's scenery 93376 (2022-12): 15R/33L 50 m wide, centreline lights, PAPI-4L at 15R and 33L, 15R ALSF-II, 33L
#   RAIL (alignment flashers only); 15L/33R unlit (no edge or centreline lights, no PAPI, no approach lights). The nav
#   data's ZKWS (airports4xp.info) is the old field (one 2,422 m runway, no ILS): no ILS is listed anywhere open. So 15R
#   and 33L take the ICAO default ILS I [EST] with ALSF-I 900 m at 15R and SSALF 420 m at 33L [EST: the scenery's ALSF-II
#   and RAIL], and 15L/33R is drawn unlit, as the scenery has it. Every threshold elevation is the field's 7 ft [EST]
#   (OurAirports has no end rows' elevations here); no displacements (OSM's ways end at the thresholds; the stopways,
#   100 m at each end in the scenery, are OSM's aeroway=stopway).
UNLIT = dict(papi=None, papiDeg=None, approachLights=None, approachLightsM=0, ils=None, tdzLights=False,
             centrelineLights=False)
END_OVERRIDE.update({
    'ZKWS': {'15R': dict(centrelineLights=True), '33L': dict(approachLights='SSALF', approachLightsM=420, centrelineLights=True),
             '15L': dict(UNLIT), '33R': dict(UNLIT)},
})
OVERRIDE_REASON.update({
    'ZKWS': ("open secondary source, no AIP published online and no ILS in any open nav data: the Scenery Gateway's scenery "
             "93376 (2022-12): 15R/33L centreline lights, PAPI-4L at both ends; 15L/33R unlit. [EST]: ILS I at 15R and 33L, "
             "15R's ALSF-I 900 m (the scenery's ALSF-II), 33L's SSALF 420 m (the scenery's RAIL), the PAPIs' 3.0 deg"),
})
WIDTH_OVERRIDE[('ZKWS', '15R/33L')] = 50.0     # the Gateway's runway row (OurAirports' 148 ft would round to 45 m)
# Wonsan's stands: OSM maps none (no parking_position, gate or apron taxilane at the terminal, only its four jet bridges).
# The Gateway's six gates at the 2015 terminal, numbered 1 to 6 from the south, each with its nose heading; a 60 m lead-in
# along it. The air force side (OSM's hardened shelters and the aprons south of the terminal) has no stands. OSM's whole
# aerodrome is landuse=military (a joint field), so ZKWS is not in MILITARY: the stands are only these. [EST]
STAND_POINTS['ZKWS'] = [
    ('1', 39.16415269, 127.48315116, 236.2), ('2', 39.16457618, 127.48283220, 236.4),
    ('3', 39.16522001, 127.48235492, 254.7), ('4', 39.16572468, 127.48192710, 220.8),
    ('5', 39.16630151, 127.48140875, 236.3), ('6', 39.16670964, 127.48106715, 238.2),
]

# v0.6.4, New Chitose (RJCC) and Aomori (RJSA), pending: their boxes cut by /tmp/flight-sim/v064/osm/extract-jp.sh
# (hokkaido-261119, tohoku-261119), notes in /tmp/flight-sim/v064/airports/bake. From AIP Japan as Haneda's were (the AD 2
# pages as mirrored at nagodede.github.io/aip/japan, read with pypdf; no page kept in the repository):
# - RJCC AD 2.12 (EFF 26 DEC 2024), 2.13, 2.14, 2.19 (EFF 22 JAN 2026), MAG VAR 10 deg W (2024): 01L/19R and 01R/19L
#   3000 x 60 m, no displacements (LDA 3000 m at all four); PALS CAT I 900 m at 01L and 01R, PALS CAT III 900 m at 19R,
#   PALS CAT I 570 m at 19L; TDZ (900 m) and centreline lights at all four; PAPI left 3.0 at all four; an ILS at each
#   end (the category from the PALS, as Kansai's: III at 19R, I elsewhere); LOC BRG(MAG) 002 / 182. The air force's
#   Chitose base (RJCJ: its 18L/36R and 18R/36L, OSM's second aerodrome, landuse=military) lies west of the civil
#   boundary and isn't read; no stands inside any landuse=military area.
# - RJSA AD 2.12 (EFF 28 NOV 2024), 2.13, 2.14, 2.19 (EFF 22 JAN 2026), MAG VAR 9 deg W (2025): 06/24 3000 x 60 m, no
#   displacements; 06 SALS 420 m (drawn as the game's SSALF, the nearest it has), no TDZ, no ILS; 24 PALS CAT III 900 m
#   with TDZ, ILS (LOC BRG(MAG) 240.93); PAPI left 3.0 and centreline lights at both.
OSM_DIRS.update({i: '/tmp/flight-sim/v064/osm' for i in ('RJCC', 'RJSA')})
NOTES_DIRS.update({i: '/tmp/flight-sim/v064/airports/bake' for i in ('RJCC', 'RJSA')})
AIP.update({
    'RJCC': {'01L': ('ALSF-I', 900, 'left', 3.0, 'I', 62.0, True, True, 60, 0),
             '19R': ('ALSF-II', 900, 'left', 3.0, 'III', 82.0, True, True, 60, 0),
             '01R': ('ALSF-I', 900, 'left', 3.0, 'I', 57.4, True, True, 60, 0),
             '19L': ('ALSF-I', 570, 'left', 3.0, 'I', 77.1, True, True, 60, 0)},
    'RJSA': {'06': ('SSALF', 420, 'left', 3.0, None, 647.0, False, True, 60, 0),
             '24': ('ALSF-II', 900, 'left', 3.0, 'III', 664.0, True, True, 60, 0)},
})
PUBLISHED_MAG.update({'RJCC': {'01L': 2.0, '01R': 2.0, '19R': 182.0, '19L': 182.0},
                      'RJSA': {'06': 60.91, '24': 240.93}})
MILITARY = MILITARY | {'RJCC'}
# Aomori's stands: OSM maps no parking_position, gate or jet bridge there. AIP Japan's AD 2.8 (INS checkpoints) publishes
# the positions of spots 1 to 6, the terminal's apron (the N apron's N1 to N11 are light aircraft's, AUW 5.7 t, left
# out); each nose 319.7 deg true, square to the row (049.7 deg) towards the terminal ([EST]: the heading), a 60 m
# lead-in behind it. Code D at most: AD 2.20's pushback rules are for aircraft "up to and including the B767-300"
# (AIP_STANDS.RJSA's maxSpan in taxi.js).
STAND_POINTS['RJSA'] = [
    ('1', 40.73713333, 140.68843611, 319.7), ('2', 40.73748889, 140.68894444, 319.7),
    ('3', 40.73791667, 140.68959444, 319.7), ('4', 40.73826389, 140.69021389, 319.7),
    ('5', 40.73865278, 140.69082778, 319.7), ('6', 40.73901389, 140.69136111, 319.7),
]
STAND_POINTS_REASONS = {'RJSA': ("OSM maps no stands: spots 1 to 6 at AIP Japan's published INS checkpoint positions (RJSA AD "
                                 "2.8), the heading square to the row towards the terminal [EST]; a 60 m lead-in along each")}

# v0.6.4, Sendai (RJSS, tohoku-261119) and Niigata (RJSN, chubu-261119), pending: their boxes cut by
# /tmp/flight-sim/v064/osm/extract-ss-sn.sh, notes in /tmp/flight-sim/v064/airports/bake. From AIP Japan as Haneda's were
# (the AD 2 pages as mirrored at nagodede.github.io/aip/japan, read with pypdf; no page kept in the repository):
# - RJSS AD 2.12 (EFF 28 NOV 2024), 2.13, 2.14 (EFF 1 JUL 2021), 2.19 (EFF 20 MAR 2025), MAG VAR 9 deg W (2024): 09/27
#   3000 x 45 m, 12/30 1200 x 45 m, no displacements (LDA = TORA at all four); 09 SALS 420 m (the game's SSALF), RCLL, no
#   TDZ, no ILS; 27 PALS CAT I 900 m, TDZ 900 m, RCLL, ILS (LOC BRG(MAG) 270, GP 3.0); 12 and 30 no approach lights, no
#   RCLL, PAPI 3.0 (12) and 3.1 (30). The PAPIs' side isn't in AD 2.14: left [EST]. 12/30 doesn't cross 09/27: 12's
#   threshold is ~105 m south of 09/27's centreline, joined to it by a taxiway.
# - RJSN AD 2.12 (EFF 20 FEB 2025), 2.13, 2.14 (EFF 1 DEC 2022), 2.19 (EFF 10 AUG 2023), MAG VAR 9 deg W (2025): 10/28
#   2500 x 45 m, 04/22 1314 x 45 m, no displacements; 10 SALS 420 m, PAPI 3.0 left, RCLL, no ILS; 28 PALS CAT I 660 m,
#   TDZ 900 m, PAPI 3.0 left, RCLL, ILS (LOC BRG(MAG) 281.26); 04 nothing but edge lights (no PAPI); 22 PAPI 3.0 left;
#   no RCLL on 04/22. 04/22 crosses 10/28 ~240 m in from the 28 threshold. The JASDF and coast guard's corner has no stands.
OSM_DIRS.update({i: '/tmp/flight-sim/v064/osm' for i in ('RJSS', 'RJSN')})
NOTES_DIRS.update({i: '/tmp/flight-sim/v064/airports/bake' for i in ('RJSS', 'RJSN')})
AIP.update({
    'RJSS': {'09': ('SSALF', 420, 'left', 3.0, None, 11.5, False, True, 45, 0),
             '27': ('ALSF-I', 900, 'left', 3.0, 'I', 15.1, True, True, 45, 0),
             '12': (None, 0, 'left', 3.0, None, 6.0, False, False, 45, 0),
             '30': (None, 0, 'left', 3.1, None, 5.0, False, False, 45, 0)},
    'RJSN': {'10': ('SSALF', 420, 'left', 3.0, None, 27.1, False, True, 45, 0),
             '28': ('ALSF-I', 660, 'left', 3.0, 'I', 10.1, True, True, 45, 0),
             '04': (None, 0, None, None, None, 22.7, False, False, 45, 0),
             '22': (None, 0, 'left', 3.0, None, 5.9, False, False, 45, 0)},
})
PUBLISHED_MAG.update({'RJSS': {'27': 270.0, '09': 90.0}, 'RJSN': {'28': 281.26, '10': 101.26}})
MILITARY = MILITARY | {'RJSN'}
# OSM draws all four runways over their blast pads (Sendai 09/27 3,122 m, 12/30 1,474 m; Niigata 10/28 2,619 m, 04/22
# 1,431 m): each end is put at AIP Japan's threshold (AD 2.12's coordinates, projected on OSM's axis), so the length is
# the published one times the frame's scale and both ends sit where the AIP has them (THR_AT).
_dms = lambda s: int(s[:-1][:2 if s[-1] in 'NS' else 3]) + int(s[:-1][2 if s[-1] in 'NS' else 3:][:2]) / 60 + \
    float(s[:-1][(2 if s[-1] in 'NS' else 3) + 2:]) / 3600
THR_AT = {(i, e): (_dms(la), _dms(lo)) for i, e, la, lo in (
    ('RJSS', '09', '380819.58N', '1405355.40E'), ('RJSS', '27', '380832.18N', '1405557.56E'),
    ('RJSS', '12', '380822.05N', '1405453.09E'), ('RJSS', '30', '380803.96N', '1405536.72E'),
    ('RJSN', '10', '375724.71N', '1390541.78E'), ('RJSN', '28', '375720.91N', '1390724.09E'),
    ('RJSN', '04', '375653.73N', '1390652.82E'), ('RJSN', '22', '375729.96N', '1390721.31E'))}
# The stands: OSM's (Sendai's lead-ins along the terminal's row, Niigata's), numbered by AIP Japan's AD 2.8 INS checkpoint
# positions (Sendai spots 1 to 14, 2L left out as spot 2's variant 3 m away; Niigata spots 1 to 10): OSM's refs there are
# the bridges' gate numbers (Sendai's run one ahead of the spots) or letters (Niigata's A to D).
SPOT_REFS = {i: [(r, _dms(la), _dms(lo)) for r, la, lo in L] for i, L in (
    ('RJSS', [('1', '380820.38N', '1405556.75E'), ('2', '380820.12N', '1405554.31E'), ('3', '380819.91N', '1405551.55E'),
              ('4', '380819.59N', '1405548.49E'), ('5', '380819.29N', '1405545.54E'), ('6', '380819.18N', '1405542.89E'),
              ('7', '380819.18N', '1405540.69E'), ('8', '380819.64N', '1405538.75E'), ('9', '380819.45N', '1405536.92E'),
              ('10', '380819.26N', '1405535.09E'), ('11', '380817.91N', '1405533.18E'), ('12', '380817.70N', '1405531.10E'),
              ('13', '380817.48N', '1405529.02E'), ('14', '380817.27N', '1405526.95E')]),
    ('RJSN', [('1', '375711.53N', '1390636.75E'), ('2', '375711.93N', '1390638.19E'), ('3', '375710.93N', '1390640.71E'),
              ('4', '375710.86N', '1390642.55E'), ('5', '375710.82N', '1390644.71E'), ('6', '375710.78N', '1390647.37E'),
              ('7', '375710.68N', '1390650.23E'), ('8', '375710.51N', '1390652.89E'), ('9', '375710.48N', '1390655.65E'),
              ('10', '375710.27N', '1390658.41E')]))}
SPOT_REF_M = 20.0
# The small aircraft's aprons, no stands there (map metres south of the reference point, grid y): Sendai's South One to
# Three aprons and the run-up apron by the 09 end (AD 2.8: asphalt, PCR 183-265 and AUW 5.7 t; the flying school's and the
# coast guard's), Niigata's S apron (AD 2.8: AUW 11 t), reached only over runway 04/22.
STAND_EXCLUDE = {'RJSS': (-380.0, "AD 2.8's South One to Three and run-up aprons (PCR 183-265, AUW 5.7 t): light aircraft"),
                 'RJSN': (-300.0, "AD 2.8's S apron (AUW 11 t), its taxiway S joining only runway 04/22: light aircraft")}
THR_LEN = {('RJSS', '09/27'): 3000, ('RJSS', '12/30'): 1200, ('RJSN', '10/28'): 2500, ('RJSN', '04/22'): 1314}   # AD 2.12

# ---------------------------------------------------------------- v0.7.0: Europe (FS_REGION=europe)
# With FS_REGION=europe (read by bake_common at import: Europe's frame, LCC 47 N 4 E, 39/54) the tool bakes Europe's
# airports into data/europe/airports (FS_AIRPORT_OUT overrides), their boxes and notes in /tmp/flight-sim/v070/airports.
# With no region set nothing below changes what East Asia's airports bake (they stay byte-identical).
# - The variation: WMM2025 at epoch 2026.0 straight from tools/bake_wmm.py's routine at each point (the model
#   data/europe/magvar.* is made from; that grid may not be installed yet).
# - No building names (no names or logos on buildings).
# - Heathrow (EGLL, greater-london-261121) and Charles de Gaulle (LFPG, ile-de-france-261121): boxes cut by
#   /tmp/flight-sim/v070/airports/osm/extract-eu1.sh. Published values from each state's eAIP (no page kept in the
#   repository), the AIRAC of 29 OCT 2026:
#   - EGLL, the UK's NATS eAIP (EG-AD-2.EGLL): AD 2.12 09L/27R 3901 x 50 m, 09R/27L 3658 x 50 m; AD 2.13 09L's landing
#     threshold displaced 309 m (LDA 3592), 09R's 308 m (LDA 3350), 27R LDA 3882, 27L 3658; AD 2.14 at all four ends a
#     coded centreline with five crossbars (860 m at 09L, 905 at 27R, 939 at 09R, 922 at 27L: the game's ALSF-II, the
#     900 m system with barrettes), PAPI 3 deg (side not stated: left [EST]), TDZ lights 900 m, centreline lights; AD 2.19
#     ILS CAT III at all four; THR elevations 78.6 / 78.1 / 75.3 / 76.8 ft; AD 2.17 transition altitude 6000 ft;
#     AD 2.2 MAG VAR 1.23 E (2027). AD 2.21: westerly preference (27R/27L used when the tailwind is 5 kt or less).
#   - LFPG, France's SIA eAIP (FR-AD-2.LFPG): AD 2.12 08L/26R 4142 x 45, 08R/26L 2700 x 60, 09L/27R 2700 x 60, 09R/27L
#     4200 x 45; 26R's threshold displaced (DTHR, LDA 3616: 526 m) and 27L's (LDA 3600: 600 m); AD 2.14 CAT III
#     approach lights 900 m, PAPI 3.0 deg (side not stated: left [EST]), TDZ 900 m and centreline lights at all eight;
#     AD 2.19 ILS CAT III (III.E.4) at all eight; THR elevations 338 / 318 (DTHR) / 337 / 317 / 378 / 391 / 371 /
#     388 (DTHR) ft; AD 2.20 transition altitude 5000 ft (Paris TMA); MAG BRG 084 / 264; MAG VAR 1.85 E. AD 2.20: the
#     outer runways (08R/26L, 09L/27R) preferentially for arrivals, the inner (08L/26R, 09R/27L) for departures.
EUROPE = os.environ.get('FS_REGION', '').strip().lower() == 'europe'
EU_NAMES = {
    'EGLL': ('Heathrow', 'London Heathrow Airport'),
    'LFPG': ('Charles de Gaulle', 'Paris Charles de Gaulle Airport'),
}
AIP_SOURCE = {
    'EGLL': "the UK's NATS eAIP, EG AD 2 EGLL (AIRAC 29 OCT 2026) AD 2.12-2.14, 2.17 and 2.19",
    'LFPG': "France's SIA eAIP, AD 2 LFPG (AIRAC 29 OCT 2026) AD 2.12-2.14, 2.19 and 2.20",
}
if EUROPE:
    NAMES = dict(EU_NAMES)
    OUT_DIR = os.environ.get('FS_AIRPORT_OUT') or os.path.join(DATA, 'europe', 'airports')
    OSM_DIRS.update({i: '/tmp/flight-sim/v070/airports/osm' for i in EU_NAMES})
    NOTES_DIRS.update({i: '/tmp/flight-sim/v070/airports' for i in EU_NAMES})
    AIP.update({
        'EGLL': {'09L': ('ALSF-II', 860, 'left', 3.0, 'III', 78.6, True, True, 50, 309),
                 '27R': ('ALSF-II', 905, 'left', 3.0, 'III', 78.1, True, True, 50, 0),
                 '09R': ('ALSF-II', 939, 'left', 3.0, 'III', 75.3, True, True, 50, 308),
                 '27L': ('ALSF-II', 922, 'left', 3.0, 'III', 76.8, True, True, 50, 0)},
        'LFPG': {'08L': ('ALSF-II', 900, 'left', 3.0, 'III', 338.0, True, True, 45, 0),
                 '26R': ('ALSF-II', 900, 'left', 3.0, 'III', 318.0, True, True, 45, 526),
                 '08R': ('ALSF-II', 900, 'left', 3.0, 'III', 337.0, True, True, 60, 0),
                 '26L': ('ALSF-II', 900, 'left', 3.0, 'III', 317.0, True, True, 60, 0),
                 '09L': ('ALSF-II', 900, 'left', 3.0, 'III', 378.0, True, True, 60, 0),
                 '27R': ('ALSF-II', 900, 'left', 3.0, 'III', 391.0, True, True, 60, 0),
                 '09R': ('ALSF-II', 900, 'left', 3.0, 'III', 371.0, True, True, 45, 0),
                 '27L': ('ALSF-II', 900, 'left', 3.0, 'III', 388.0, True, True, 45, 600)},
    })
    # EGLL: AD 2.12 gives true bearings only; magnetic = true - AD 2.2's 1.23 E. LFPG: AD 2.12's (084) / (264).
    PUBLISHED_MAG.update({'EGLL': {'09L': 88.44, '27R': 268.48, '09R': 88.45, '27L': 268.49},
                          'LFPG': {e: (84.0 if e[:2] in ('08', '09') else 264.0)
                                   for e in ('08L', '26R', '08R', '26L', '09L', '27R', '09R', '27L')}})
    # AD 2.12's threshold co-ordinates (EGLL: the landing thresholds, 09L and 09R displaced; LFPG: the runway ends,
    # each with a DTHR listed separately), for the notes' and the test's check of where the ends sit.
    AIP_THR = {
        'EGLL': {'09L': ('512839.00N', '0002905.97W'), '27R': ('512839.63N', '0002559.82W'),
                 '09R': ('512753.25N', '0002856.33W'), '27L': ('512753.82N', '0002602.76W')},
        'LFPG': {'08L': ('485944.47N', '0023309.88E'), '26R': ('485955.32N', '0023632.99E'),
                 '08R': ('485934.49N', '0023356.38E'), '26L': ('485941.56N', '0023608.77E'),
                 '09L': ('490128.99N', '0023129.62E'), '27R': ('490136.10N', '0023342.09E'),
                 '09R': ('490114.22N', '0023047.01E'), '27L': ('490125.29N', '0023413.06E')},
    }
    # LFPG: OSM's 08L/26R and 09R/27L ways stop at the displaced thresholds (3,589 and 3,571 map m, the LDAs 3,616 and
    # 3,600 m), leaving out the 526 m and 600 m before 26R's and 27L's DTHR; and the other two run ~20 m short. Every end
    # is put at AD 2.12's runway-end position (projected on OSM's axis), then both ends trimmed evenly to the published
    # length times the frame's scale (THR_AT, THR_LEN), so AD 2.13's displacements sit where the AIP's DTHRs are.
    THR_AT.update({('LFPG', e): (_dms(la), _dms(lo)) for e, (la, lo) in AIP_THR['LFPG'].items()})
    PUB_LEN = {('EGLL', '09L/27R'): 3901, ('EGLL', '09R/27L'): 3658, ('LFPG', '08L/26R'): 4142,
               ('LFPG', '08R/26L'): 2700, ('LFPG', '09L/27R'): 2700, ('LFPG', '09R/27L'): 4200}
    THR_LEN.update({k: v for k, v in PUB_LEN.items() if k[0] == 'LFPG'})

    ICAOS = list(NAMES)
    # Europe's fields are bigger and OSM maps them in more detail (Charles de Gaulle: 1,907 service roads and 757 buildings,
    # 0.96 MB against Pudong's 0.56 MB): there, buildings under 150 m2 and service roads under 60 m are left out, and both
    # simplified to 1 m (the buildings' outlines and the roads' centrelines move under a metre).
    EU_MIN_BUILDING_M2, EU_MIN_ROAD_M, EU_SIMPLIFY_M = 150.0, 60.0, 1.0
    # Stands OSM maps that no taxiway reaches: Charles de Gaulle's PH1 and PH2 (parking_position ways east of the
    # Terminal 2 aprons whose lead-ins join no taxiway or apron taxilane in OSM; the 'PH' series reads as helicopter
    # parking [EST]).
    EU_STAND_DROP = {'LFPG': ({'PH1', 'PH2'}, "OSM's lead-ins join no taxiway: no route to any runway (helicopter parking [EST])")}

    def _dms_signed(s):
        v = _dms(s)
        return -v if s[-1] in 'SW' else v

# - Frankfurt (EDDF, hessen-261121): box cut by /tmp/flight-sim/v070/airports/cut2.sh (8.47,49.99,8.63,50.06). Germany's DFS
#   AIP IFR (aip.dfs.de BasicIFR, effective 29 OCT 2026; page images, read by eye; no page kept in the repository):
#   AD 2.12 07C/25C 4000 x 60, 07L/25R 2800 x 45, 07R/25L 4000 x 45, 18 4000 x 45 (no 36 row: 18 is a one-way runway);
#   THR elevations 328.0 / 362.5 / 304.0 / 351.4 / 326.8 / 360.5 / 325.3 ft; no displacement (AD 2.13 LDA = length).
#   AD 2.13: 07L/25R TORA "-", LDA 2800 (landing only); 18 TORA 3970, LDA "-" (take-off only, southward).
#   AD 2.14: ALSAF (approach lights with sequenced flashers; length not stated: the game's ALSF-II 900 m, [EST]), PAPI
#   3.0 deg (side not stated: left [EST]), TDZ and centreline lights at 07C, 25C, 07L, 25R, 07R, 25L; 18 centreline and
#   edge lights only (no approach lights, no PAPI, no TDZ). AD 2.19: ILS CAT III at 07C, 25C, 07R, 25L, 07L, 25R (07L/25R
#   also an ILS Y CAT I at 3.2 deg); none for 18 or 36; MAG VAR 4 deg E (2026). AD 2.17: transition altitude 5000 ft MSL.
#   AD 2.20 1.1: landing direction 25 preferred (tailwind up to 5 kt); 1.2: A- and D-STARs to 25R/07L, B- and C-STARs
#   to 25L/07R; 1.3: departures 25C/07C, south-west departures on 18.
if EUROPE:
    NAMES['EDDF'] = ('Frankfurt', 'Frankfurt Airport')
    OSM_DIRS['EDDF'] = '/tmp/flight-sim/v070/airports/osm'
    NOTES_DIRS['EDDF'] = '/tmp/flight-sim/v070/airports'
    AIP_SOURCE['EDDF'] = "Germany's DFS AIP IFR, AD 2 EDDF (effective 29 OCT 2026) AD 2.12-2.14, 2.17, 2.19 and 2.20"
    AIP['EDDF'] = {'07C': ('ALSF-II', 900, 'left', 3.0, 'III', 328.0, True, True, 60, 0),
                   '25C': ('ALSF-II', 900, 'left', 3.0, 'III', 362.5, True, True, 60, 0),
                   '07L': ('ALSF-II', 900, 'left', 3.0, 'III', 304.0, True, True, 45, 0),
                   '25R': ('ALSF-II', 900, 'left', 3.0, 'III', 351.4, True, True, 45, 0),
                   '07R': ('ALSF-II', 900, 'left', 3.0, 'III', 326.8, True, True, 45, 0),
                   '25L': ('ALSF-II', 900, 'left', 3.0, 'III', 360.5, True, True, 45, 0),
                   '18': (None, 0, None, None, None, 325.3, False, True, 45, 0),
                   '36': (None, 0, None, None, None, 316.0, False, True, 45, 0)}    # 36: OurAirports' elevation [EST]
    # AD 2.12's TRUE BRG less AD 2.19's 4 deg E (notes only)
    PUBLISHED_MAG['EDDF'] = {'07C': 65.64, '25C': 245.64, '07L': 65.60, '25R': 245.60, '07R': 65.65, '25L': 245.65,
                             '18': 175.63}
    AIP_THR['EDDF'] = {'07C': ('500157.421N', '0083204.667E'), '25C': ('500242.456N', '0083513.131E'),
                       '07L': ('500213.396N', '0082949.481E'), '25R': ('500244.971N', '0083201.377E'),
                       '07R': ('500139.151N', '0083203.025E'), '25L': ('500224.187N', '0083511.505E'),
                       '18': ('500203.010N', '0083133.350E')}
    # OSM's ref for the one-way runway is '18' alone (Startbahn West): read as 18/36, its 36 end the way's south end.
    REF_ALIAS['18'] = '18/36'
    # Two OSM holds named W, west of 18's north end, stand 83 and 203 m from every taxiway OSM maps there: left out.
    HOLD_DROP_M['EDDF'] = 30.0
    REF_SQUEEZE.add('EDDF')
    # Every end at AD 2.12's threshold (no displacement anywhere, so the runway's end), projected on OSM's axis, then both
    # ends trimmed evenly to AD 2.12's length times the frame's scale (OSM's ways run ~27 m short of 4000 m); 36 stays OSM's.
    THR_AT.update({('EDDF', e): (_dms_signed(la), _dms_signed(lo)) for e, (la, lo) in AIP_THR['EDDF'].items()})
    THR_LEN.update({('EDDF', '07C/25C'): 4000, ('EDDF', '07L/25R'): 2800, ('EDDF', '07R/25L'): 4000})
    ICAOS = list(NAMES)

# - Madrid (LEMD, madrid-261121): box cut by /tmp/flight-sim/v070/airports/cut2.sh (-3.63,40.44,-3.50,40.54). Spain's ENAIRE
#   AIP (AD 2-LEMD, WEF 29-OCT-26, AIRAC AMDT 10/26; the PDF read with pypdf; no page kept in the repository): AD 2.12
#   14L/32R 3500 x 60, 14R/32L 3988 x 60, 18L/36R 3500 x 60, 18R/36L 4179 x 60; THR elevations 1942 / 1886 / 1995 /
#   1933 / 1922 / 1942 / 1991 / 1985 ft; 32R's threshold displaced 500 m, 32L's 928 m, 18L's 500 m, 18R's 814 m; 14L,
#   14R, 36R and 36L "not available for landing", 32R, 32L, 18L and 18R "not available for take-off" (AD 2.13: LDA NU /
#   TORA NU): every runway is used one way. AD 2.14: 32R, 32L, 18L, 18R precision CAT II/III approach lights 900 m (the
#   game's ALSF-II), PAPI 3 deg (side not stated: left [EST]), TDZ 900 m, centreline lights; 14L, 14R, 36R, 36L no
#   approach lights, no PAPI, no TDZ, centreline lights. AD 2.19: ILS CAT III to 32L, 18L, 18R and 32R, none else.
#   AD 2.17: transition altitude 13000 ft (CTR MADRID). AD 2.20.6: north configuration preferred (arrivals 32L/32R,
#   departures 36L/36R; at night 32R and 36L), south configuration otherwise (arrivals 18L/18R, departures 14L/14R).
if EUROPE:
    NAMES['LEMD'] = ('Madrid', 'Adolfo Suárez Madrid–Barajas Airport')
    OSM_DIRS['LEMD'] = '/tmp/flight-sim/v070/airports/osm'
    NOTES_DIRS['LEMD'] = '/tmp/flight-sim/v070/airports'
    AIP_SOURCE['LEMD'] = "Spain's ENAIRE AIP, AD 2-LEMD (WEF 29-OCT-26, AIRAC AMDT 10/26) AD 2.12-2.14, 2.17, 2.19 and 2.20"
    _NO_LDG = (None, 0, None, None, None)
    AIP['LEMD'] = {'14L': (*_NO_LDG, 1942.0, False, True, 60, 0),
                   '32R': ('ALSF-II', 900, 'left', 3.0, 'III', 1886.0, True, True, 60, 500),
                   '14R': (*_NO_LDG, 1995.0, False, True, 60, 0),
                   '32L': ('ALSF-II', 900, 'left', 3.0, 'III', 1933.0, True, True, 60, 928),
                   '18L': ('ALSF-II', 900, 'left', 3.0, 'III', 1922.0, True, True, 60, 500),
                   '36R': (*_NO_LDG, 1942.0, False, True, 60, 0),
                   '18R': ('ALSF-II', 900, 'left', 3.0, 'III', 1991.0, True, True, 60, 814),
                   '36L': (*_NO_LDG, 1985.0, False, True, 60, 0)}
    # AD 2.12's MAG (an older variation: true 142.21 is 143 MAG there; the ILS beams read 323 and 180 MAG)
    PUBLISHED_MAG['LEMD'] = {'14L': 143.0, '32R': 323.0, '14R': 143.0, '32L': 323.0, '18L': 180.0, '36R': 360.0,
                             '18R': 180.0, '36L': 360.0}
    # AD 2.12's runway-end positions (its THR PSN where the threshold isn't displaced; remarks 9 to 12, the "End RWY"
    # coordinates, at the far end of a displaced one), and the landing thresholds (THR PSN) for the test.
    AIP_THR['LEMD'] = {'14L': ('402941.71N', '0033328.33W'), '32R': ('402812.03N', '0033157.29W'),
                       '14R': ('402905.50N', '0033433.64W'), '32L': ('402723.32N', '0033249.89W'),
                       '18L': ('403157.44N', '0033333.77W'), '36R': ('403003.97N', '0033333.15W'),
                       '18R': ('403148.78N', '0033429.41W'), '36L': ('402933.32N', '0033428.64W')}
    # OSM's ref'd ways stop at the displaced thresholds (the segments before them are unnamed runway=displaced_threshold
    # ways): every end at AD 2.12's runway end, projected on OSM's axis, then both trimmed evenly to AD 2.12's length.
    THR_AT.update({('LEMD', e): (_dms_signed(la), _dms_signed(lo)) for e, (la, lo) in AIP_THR['LEMD'].items()})
    THR_LEN.update({('LEMD', '14L/32R'): 3500, ('LEMD', '14R/32L'): 3988, ('LEMD', '18L/36R'): 3500,
                    ('LEMD', '18R/36L'): 4179})
    # One OSM hold stands 67 m from every taxiway OSM maps: left out.
    HOLD_DROP_M['LEMD'] = 30.0
    # Stands 177 and 175-2 (after the renaming), south of the 14/32 runways' west end: OSM's taxi lines there join nothing
    # (no route to any runway end in the game's graph): left out.
    STAND_DROP['LEMD'] = ({'177', '175-2'}, "on OSM taxi lines joined to nothing else: no route to any runway")
    ICAOS = list(NAMES)

# - Zurich (LSZH, switzerland-261121), Gatwick (EGKK, west-sussex-261121 + surrey-261121) and Orly (LFPO,
#   ile-de-france-261121): boxes cut by /tmp/flight-sim/v070/airports/osm/extract-eu3.sh. No page kept in the repository.
#   - LSZH: Switzerland's AIP (skyguide's eAIP on skybriefing.com) asks for a login: not read. Every value [EST]:
#     the runways' geometry OSM's (16/34's 34 end at the outer end of OSM's unnamed displaced-threshold way, the
#     length OurAirports' 3,700 m, OSM's length tag the same), the threshold elevations and displacements (14 150 m,
#     34 470 m) OurAirports'; the lights and ILS general knowledge of the field, not the AIP: ILS CAT III to 14 and 16,
#     CAT I to 28 and 34, none to 10 and 32 (take-off runways); the 900 m systems at the ILS ends; PAPI left 3 deg at
#     every end; TDZ at 14 and 16; centreline lights (60 m wide). OSM's grass helicopter strip H01/H19 is left out.
#   - EGKK, the UK's NATS eAIP (EG AD 2 EGKK, AIRAC 29 OCT 2026): AD 2.12 08L/26R 2561 x 45 (a non-instrument runway,
#     08L's landing threshold displaced 321 m, 26R's 415 m), 08R/26L 3317 x 45 (08R displaced 395 m, 26L 425 m); THR
#     elevations 194.8 / 194.8 / 196.2 / 195.9 ft; true bearings 077.63 / 257.65; AD 2.12's THR co-ordinates are the
#     landing (displaced) thresholds. AD 2.14: 08L and 26R centreline with one crossbar 420 m (the game's SSALF), PAPI 3
#     deg (side not stated: left [EST]), no TDZ, no centreline lights; 08R and 26L coded centreline with five crossbars
#     914 m (ALSF-II), PAPI 3 deg (08R right; 26L not stated: left [EST]), TDZ 893 m, centreline lights. AD 2.19: ILS
#     CAT III to 08R and 26L (LOC var 1.34 E 2027), none to 08L/26R. AD 2.17: transition altitude 6000 ft. AD 2.20:
#     08L/26R "will only be used when Runway 08R/26L is temporarily non-operational" (a standby).
#   - LFPO, France's SIA eAIP (AD 2 LFPO, AIRAC 29 OCT 2026): AD 2.12 02/20 2400 x 45, 06/24 3650 x 45, 07/25 3320 x
#     45 (the runway ends; 06's DTHR and 25's listed separately: 300 m and 435 m, AD 2.13's LDA 3350 and 2885); THR
#     elevations 287 / 288 / 283 (DTHR) / 285 / 277 / 288 (DTHR) ft; true (mag) 018.35 (017) / 061.85 (061) / 074.40
#     (073). AD 2.14: 02 CAT I 420 m (SSALF), PAPI 3.0; 20 no approach lights, PAPI 3.4; 06 CAT III 720 m, 24 CAT III
#     740 m, 07 and 25 CAT III 900 m (ALSF-II), PAPI 3.0, TDZ 900 m and centreline lights at the four; 02/20 neither;
#     PAPI side not stated: left [EST]. AD 2.19: ILS CAT III (III.E.4) to 06, 24, 07, 25; CAT I (I.E.1) to 02; none
#     to 20. AD 2.21.2.1: west configuration take-offs 24, landings 25; east, take-offs 07, landings 06; 02/20
#     "exceptionally used" (a main runway unavailable, strong north or south winds).
if EUROPE:
    for _i, _n in (('LSZH', ('Zurich', 'Zurich Airport')), ('EGKK', ('Gatwick', 'London Gatwick Airport')),
                   ('LFPO', ('Orly', 'Paris Orly Airport'))):
        NAMES[_i] = _n
        OSM_DIRS[_i] = '/tmp/flight-sim/v070/airports/osm'
        NOTES_DIRS[_i] = '/tmp/flight-sim/v070/airports'
    AIP_SOURCE['EGKK'] = "the UK's NATS eAIP, EG AD 2 EGKK (AIRAC 29 OCT 2026) AD 2.12-2.14, 2.17, 2.19 and 2.20"
    AIP_SOURCE['LFPO'] = "France's SIA eAIP, AD 2 LFPO (AIRAC 29 OCT 2026) AD 2.12-2.14, 2.19 and 2.21"
    AIP_SOURCE['LSZH'] = ("no AIP (Switzerland's eAIP asks for a login): OurAirports' elevations and displacements, the lights "
                          "and ILS from general knowledge of the field, all [EST]")
    AIP['LSZH'] = {'10': (None, 0, 'left', 3.0, None, 1391.0, False, True, 60, 0),
                   '28': ('ALSF-I', 900, 'left', 3.0, 'I', 1416.0, False, True, 60, 0),
                   '14': ('ALSF-II', 900, 'left', 3.0, 'III', 1402.0, True, True, 60, 150),
                   '32': (None, 0, 'left', 3.0, None, 1402.0, False, True, 60, 0),
                   '16': ('ALSF-II', 900, 'left', 3.0, 'III', 1390.0, True, True, 60, 0),
                   '34': ('ALSF-I', 900, 'left', 3.0, 'I', 1388.0, False, True, 60, 470)}
    AIP['EGKK'] = {'08L': ('SSALF', 420, 'left', 3.0, None, 194.8, False, False, 45, 321),
                   '26R': ('SSALF', 420, 'left', 3.0, None, 194.8, False, False, 45, 415),
                   '08R': ('ALSF-II', 914, 'right', 3.0, 'III', 196.2, True, True, 45, 395),
                   '26L': ('ALSF-II', 914, 'left', 3.0, 'III', 195.9, True, True, 45, 425)}
    AIP['LFPO'] = {'02': ('SSALF', 420, 'left', 3.0, 'I', 287.0, False, False, 45, 0),
                   '20': (None, 0, 'left', 3.4, None, 288.0, False, False, 45, 0),
                   '06': ('ALSF-II', 720, 'left', 3.0, 'III', 283.0, True, True, 45, 300),
                   '24': ('ALSF-II', 740, 'left', 3.0, 'III', 285.0, True, True, 45, 0),
                   '07': ('ALSF-II', 900, 'left', 3.0, 'III', 277.0, True, True, 45, 0),
                   '25': ('ALSF-II', 900, 'left', 3.0, 'III', 288.0, True, True, 45, 435)}
    # EGKK: AD 2.12's true less AD 2.19's 1.34 E (notes only); LFPO: AD 2.12's MAG
    PUBLISHED_MAG['EGKK'] = {'08L': 76.29, '26R': 256.31, '08R': 76.29, '26L': 256.31}
    PUBLISHED_MAG['LFPO'] = {'02': 17.0, '20': 197.0, '06': 61.0, '24': 241.0, '07': 73.0, '25': 253.0}
    AIP_THR['EGKK'] = {'08L': ('510851.04N', '0001229.17W'), '26R': ('510903.69N', '0001057.40W'),
                       '08R': ('510845.12N', '0001224.52W'), '26L': ('510902.42N', '0001019.00W')}
    AIP_THR['LFPO'] = {'02': ('484303.15N', '0022236.11E'), '20': ('484416.88N', '0022313.09E'),
                       '06': ('484311.91N', '0021900.91E'), '24': ('484407.64N', '0022138.44E'),
                       '07': ('484309.87N', '0022130.93E'), '25': ('484338.75N', '0022407.45E')}
    # LFPO: every end at AD 2.12's runway end (OSM's within 2 m), trimmed evenly to AD 2.12's length.
    THR_AT.update({('LFPO', e): (_dms_signed(la), _dms_signed(lo)) for e, (la, lo) in AIP_THR['LFPO'].items()})
    THR_LEN.update({('LFPO', '02/20'): 2400, ('LFPO', '06/24'): 3650, ('LFPO', '07/25'): 3320})
    # EGKK: OSM's ref'd ways run between the displaced thresholds (the segments before them are unnamed
    # displaced_threshold ways): each end put at AD 2.12's landing threshold moved out along the runway by AD 2.12's
    # displacement (times the frame's scale), then both trimmed evenly to AD 2.12's length.
    for _a, _b in (('08L', '26R'), ('08R', '26L')):
        _pa = np.array(to_map(*(_dms_signed(s) for s in AIP_THR['EGKK'][_a])), float)
        _pb = np.array(to_map(*(_dms_signed(s) for s in AIP_THR['EGKK'][_b])), float)
        _u = (_pa - _pb) / np.hypot(*(_pa - _pb))
        for _e, _p, _s in ((_a, _pa, 1.0), (_b, _pb, -1.0)):
            _k = frame_scale(*(float(v) for v in to_geo(*_p)))
            _q = _p + _s * _u * AIP['EGKK'][_e][9] * _k
            THR_AT[('EGKK', _e)] = tuple(float(v) for v in to_geo(*_q))
    THR_LEN.update({('EGKK', '08L/26R'): 2561, ('EGKK', '08R/26L'): 3317})
    # LSZH: 16/34's ref'd way stops at 34's displaced threshold: 34 at the outer end of OSM's unnamed displaced segment
    # (way 1104890051; OurAirports' 34 end 18 m from it), then both trimmed to OurAirports' 3,700 m [EST].
    THR_AT[('LSZH', '34')] = (47.445562, 8.556699)
    THR_LEN[('LSZH', '16/34')] = 3700
    RUNWAY_SKIP.add(('LSZH', 'H01/H19'))
    HOLD_DROP_M.update({'LSZH': 30.0, 'EGKK': 30.0, 'LFPO': 30.0})
    ICAOS = list(NAMES)

# - Schiphol (EHAM, noord-holland-261121): box cut by /tmp/flight-sim/v070/airports/osm/extract-eu4.sh (4.67,52.27,4.83,
#   52.375). The Netherlands' eAIP (LVNL, eaip.lvnl.nl) answers an automated fetch with a Cloudflare challenge: not read,
#   not worked round. Every published value is OurAirports' or OSM's and the lights and ILS general knowledge, all [EST]:
#   runways 18R/36L 3800 x 60, 06/24 3500 x 45, 09/27 3453 x 45, 18L/36R 3400 x 45, 18C/36C 3300 x 45, 04/22 2014 x 45
#   (OSM's length and width tags); the thresholds' elevations (-11 to -14 ft) and displacements (18R 270 m, 36C 450 m,
#   18L 575 m, 09 90 m, 06 250 m) OurAirports'. OSM's ref'd ways stop at the unnamed displaced-threshold ways of 36C, 18L
#   and 09: those ends at the outer ends of the unnamed ways; 24 at OurAirports' end (OSM's ~45 m short); then each
#   trimmed evenly to the length (THR_AT, THR_LEN). 18R/36L and 18L/36R are used one way (landings 18R and 36R, take-offs
#   36L and 18L): no approach lights, PAPI or ILS at 36L and 18L [EST].
if EUROPE:
    NAMES['EHAM'] = ('Schiphol', 'Amsterdam Airport Schiphol')
    OSM_DIRS['EHAM'] = '/tmp/flight-sim/v070/airports/osm'
    NOTES_DIRS['EHAM'] = '/tmp/flight-sim/v070/airports'
    AIP_SOURCE['EHAM'] = ("no AIP (the Netherlands' eAIP refuses automated fetches): OurAirports' elevations and "
                          "displacements, OSM's lengths, the lights and ILS from general knowledge of the field, all [EST]")
    _C3, _C1 = ('ALSF-II', 900, 'left', 3.0, 'III'), ('ALSF-I', 900, 'left', 3.0, 'I')
    _TO = (None, 0, None, None, None)
    AIP['EHAM'] = {'18R': (*_C3, -13.0, True, True, 60, 270), '36L': (*_TO, -12.0, False, True, 60, 0),
                   '18C': (*_C3, -13.0, True, True, 45, 0), '36C': (*_C1, -12.0, False, True, 45, 450),
                   '18L': (*_TO, -12.0, False, True, 45, 575), '36R': (*_C3, -11.0, True, True, 45, 0),
                   '06': (*_C3, -11.0, True, True, 45, 250), '24': (*_C1, -12.0, False, True, 45, 0),
                   '09': (*_C1, -12.0, False, True, 45, 90), '27': (*_C3, -13.0, True, True, 45, 0),
                   '04': (None, 0, 'left', 3.0, None, -13.0, False, False, 45, 0),
                   '22': (*_C1, -14.0, False, False, 45, 0)}
    THR_AT.update({('EHAM', '36C'): (52.301778, 4.737318), ('EHAM', '18L'): (52.32133, 4.780162),
                   ('EHAM', '09'): (52.316641, 4.746219)})
    THR_LEN.update({('EHAM', '18C/36C'): 3300, ('EHAM', '18L/36R'): 3400, ('EHAM', '09/27'): 3453})
    # 06/24 stays OSM's (its ref'd displaced segment included: 3,430 map m, 3,442 m after the scale): OurAirports gives
    # 3,439 m and OSM's length tag 3,500 m; without the AIP the shorter is kept (stretched to 3,500 the bake's
    # over-length rule would trim it back to OurAirports' anyway) [EST]
    HOLD_DROP_M['EHAM'] = 30.0
    ICAOS = list(NAMES)

# - Barcelona (LEBL, cataluna-261121): box cut by /tmp/flight-sim/v070/airports/osm/extract-eu4.sh (2.03,41.27,2.13,41.33).
#   Spain's ENAIRE AIP (AD 2-LEBL, WEF 01-OCT-26, AIRAC AMDT 09/26; the PDF read with pypdf; no page kept in the
#   repository): AD 2.12 02/20 2528 x 45, 06L/24R 3352 x 60, 06R/24L 2660 x 60; THR elevations 7 / 12 / 8 / 10 / 8 / 8 ft;
#   06L's threshold displaced 430 m (remark 2; the runway's end, remark 3, 411735.68N 0020402.19E); 20 "not available for
#   landing" (remark 1; AD 2.13 LDA NU). AD 2.14: 02 precision CAT I 720 m (the game's ALSF-I), 06L and 24R CAT II/III
#   720 m, 06R CAT II/III 900 m, 24L CAT II/III 420 m (ALSF-II); PAPI 3 deg at all but 20 (side not stated: left [EST]);
#   TDZ 900 m at 06L, 24R, 06R, 24L; centreline lights on every runway; 20 no approach lights, no PAPI. AD 2.19: ILS CAT I
#   to 02, CAT III to 06L, 24R, 06R and 24L. AD 2.17: transition altitude 6000 ft (CTR BARCELONA). AD 2.20.4: by day west
#   configuration (arrivals 24R, departures 24L and 24R), else east (arrivals 06L, departures 06R and 06L); by night north
#   (arrivals 02, departures 06R), else west single runway (24L).
if EUROPE:
    NAMES['LEBL'] = ('Barcelona', 'Josep Tarradellas Barcelona–El Prat Airport')
    OSM_DIRS['LEBL'] = '/tmp/flight-sim/v070/airports/osm'
    NOTES_DIRS['LEBL'] = '/tmp/flight-sim/v070/airports'
    AIP_SOURCE['LEBL'] = "Spain's ENAIRE AIP, AD 2-LEBL (WEF 01-OCT-26, AIRAC AMDT 09/26) AD 2.12-2.14, 2.17, 2.19 and 2.20"
    AIP['LEBL'] = {'02': ('ALSF-I', 720, 'left', 3.0, 'I', 7.0, False, True, 45, 0),
                   '20': (None, 0, None, None, None, 12.0, False, True, 45, 0),
                   '06L': ('ALSF-II', 720, 'left', 3.0, 'III', 8.0, True, True, 60, 430),
                   '24R': ('ALSF-II', 720, 'left', 3.0, 'III', 10.0, True, True, 60, 0),
                   '06R': ('ALSF-II', 900, 'left', 3.0, 'III', 8.0, True, True, 60, 0),
                   '24L': ('ALSF-II', 420, 'left', 3.0, 'III', 8.0, True, True, 60, 0)}
    PUBLISHED_MAG['LEBL'] = {'02': 18.0, '20': 198.0, '06L': 64.0, '24R': 244.0, '06R': 64.0, '24L': 244.0}
    # AD 2.12's THR PSN, 06L's at the runway's end (remark 3) rather than its displaced threshold
    AIP_THR['LEBL'] = {'02': ('411715.93N', '0020505.38E'), '20': ('411833.46N', '0020540.75E'),
                       '06L': ('411735.68N', '0020402.19E'), '24R': ('411820.61N', '0020613.40E'),
                       '06R': ('411656.32N', '0020427.63E'), '24L': ('411731.99N', '0020611.78E')}
    # OSM's 06L/24R way stops at 06L's displaced threshold (an unnamed displaced_threshold way before it): every end at
    # AD 2.12's runway end, projected on OSM's axis, then both trimmed evenly to AD 2.12's length.
    THR_AT.update({('LEBL', e): (_dms_signed(la), _dms_signed(lo)) for e, (la, lo) in AIP_THR['LEBL'].items()})
    THR_LEN.update({('LEBL', '02/20'): 2528, ('LEBL', '06L/24R'): 3352, ('LEBL', '06R/24L'): 2660})
    HOLD_DROP_M['LEBL'] = 30.0
    ICAOS = list(NAMES)

# - Munich (EDDM, oberbayern-261121): box cut by /tmp/flight-sim/v070/airports/osm/extract-eu4.sh (11.68,48.325,11.86,
#   48.375). Germany's DFS AIP IFR (aip.dfs.de BasicIFR, effective 29 OCT 2026; page images, read by eye; no page kept in
#   the repository): AD 2.12 (page 1-9) 08L/26R and 08R/26L 4000 x 60, true 083.40 / 263.40, THR elevations 1467.2 /
#   1448.6 / 1485.5 / 1469.7 ft, no displacement (AD 2.13 LDA 4000 everywhere). AD 2.14 (1-10): ALSAF (approach lights
#   with sequenced flashers; length not stated: the game's ALSF-II 900 m, [EST]), PAPI 3.0 deg (side not stated: left
#   [EST]), TDZ and centreline lights at all four. AD 2.19 (1-13, 1-14): ILS CAT III to 08L, 08R, 26L, 26R; MAG VAR 4 deg E
#   (2026). AD 2.17 (1-11): transition altitude 5000 ft MSL.
if EUROPE:
    NAMES['EDDM'] = ('Munich', 'Munich Airport')
    OSM_DIRS['EDDM'] = '/tmp/flight-sim/v070/airports/osm'
    NOTES_DIRS['EDDM'] = '/tmp/flight-sim/v070/airports'
    AIP_SOURCE['EDDM'] = "Germany's DFS AIP IFR, AD 2 EDDM (effective 29 OCT 2026) AD 2.12-2.14, 2.17 and 2.19"
    AIP['EDDM'] = {'08L': ('ALSF-II', 900, 'left', 3.0, 'III', 1467.2, True, True, 60, 0),
                   '26R': ('ALSF-II', 900, 'left', 3.0, 'III', 1448.6, True, True, 60, 0),
                   '08R': ('ALSF-II', 900, 'left', 3.0, 'III', 1485.5, True, True, 60, 0),
                   '26L': ('ALSF-II', 900, 'left', 3.0, 'III', 1469.7, True, True, 60, 0)}
    # AD 2.12's TRUE BRG less AD 2.19's 4 deg E (notes only)
    PUBLISHED_MAG['EDDM'] = {'08L': 79.40, '26R': 259.40, '08R': 79.40, '26L': 259.40}
    AIP_THR['EDDM'] = {'08L': ('482145.960N', '0114603.178E'), '26R': ('482200.793N', '0114916.222E'),
                       '08R': ('482026.413N', '0114503.655E'), '26L': ('482041.274N', '0114816.612E')}
    # Every end at AD 2.12's threshold (no displacement, so the runway's end), projected on OSM's axis, then both trimmed
    # evenly to AD 2.12's 4000 m times the frame's scale.
    THR_AT.update({('EDDM', e): (_dms_signed(la), _dms_signed(lo)) for e, (la, lo) in AIP_THR['EDDM'].items()})
    THR_LEN.update({('EDDM', '08L/26R'): 4000, ('EDDM', '08R/26L'): 4000})
    HOLD_DROP_M['EDDM'] = 30.0
    ICAOS = list(NAMES)

# - Fiumicino (LIRF, centro-261121): box cut by /tmp/flight-sim/v070/airports/osm/extract-eu4.sh (12.19,41.77,12.29,41.86).
#   Italy's AIP (ENAV's eAIP) asks for a login: not read. Every value [EST]: the runways OSM's (16R/34L and 16L/34R 3900 x
#   60, 07/25 3300 x 45: OSM's length tags, OurAirports' 12,801 and 10,826 ft); 07/25's ref'd way stops at 07's displaced
#   threshold (an unnamed displaced_threshold way before it): 07 at its outer end (OurAirports' 07 end 5 m from it), the
#   runway trimmed to 3,300 m. Thresholds' elevations and 07's displacement (411 m) OurAirports'; the lights and ILS
#   general knowledge of the field: ILS CAT III to 16L, 16R and 34R, CAT I to 34L and 25, none to 07; 900 m approach
#   lights at those ends; PAPI left 3 deg at every end but 07. 16C/34C (OurAirports: closed) is a taxiway in OSM.
if EUROPE:
    NAMES['LIRF'] = ('Fiumicino', 'Rome Fiumicino Leonardo da Vinci Airport')
    OSM_DIRS['LIRF'] = '/tmp/flight-sim/v070/airports/osm'
    NOTES_DIRS['LIRF'] = '/tmp/flight-sim/v070/airports'
    AIP_SOURCE['LIRF'] = ("no AIP (Italy's eAIP asks for a login): OurAirports' elevations and displacements, OSM's "
                          "lengths, the lights and ILS from general knowledge of the field, all [EST]")
    AIP['LIRF'] = {'16L': ('ALSF-II', 900, 'left', 3.0, 'III', 14.0, True, True, 60, 0),
                   '34R': ('ALSF-II', 900, 'left', 3.0, 'III', 6.0, True, True, 60, 0),
                   '16R': ('ALSF-II', 900, 'left', 3.0, 'III', 7.0, True, True, 60, 0),
                   '34L': ('ALSF-I', 900, 'left', 3.0, 'I', 8.0, False, True, 60, 0),
                   '07': (None, 0, None, None, None, 7.0, False, False, 45, 411),
                   '25': ('ALSF-I', 900, 'left', 3.0, 'I', 5.0, False, False, 45, 0)}
    THR_AT[('LIRF', '07')] = (41.799331, 12.232214)
    THR_LEN[('LIRF', '07/25')] = 3300
    HOLD_DROP_M['LIRF'] = 30.0
    ICAOS = list(NAMES)


class WmmPoint:
    """v0.7.0, Europe: WMM2025 at epoch 2026.0 at the point itself (tools/bake_wmm.py's routine), Wmm's interface."""
    def __init__(self):
        import bake_wmm
        self.dec = bake_wmm.declination

    def at_geo(self, lat, lon):
        return float(self.dec(lat, lon))

    def var(self, x, y):
        la, lo = to_geo(x, y)
        return self.at_geo(float(la), float(lo))

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
        ref = REF_ALIAS.get(ref, ref)       # v0.7.0: a one-way runway's single ref (Frankfurt's 18); empty in East Asia
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
        if (icao, ref) in RUNWAY_SKIP:
            est.append((f'{ref} left out', 'not baked', 'drawn as a live runway in OSM but closed or unusable (RUNWAY_SKIP)'))
            continue
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
        if any((icao, i) in THR_AT for i in ids):
            # v0.6.4 (THR_AT): each listed end moved along OSM's axis to the AIP's threshold (its projection on the axis)
            u, a0, len0 = (b - a) / length, a.copy(), length
            moved = []
            for i, key in ((ids[0], 'a'), (ids[1], 'b')):
                if (icao, i) in THR_AT:
                    s = float((np.array(to_map(*THR_AT[(icao, i)]), float) - a0) @ u)
                    if key == 'a':
                        a = a0 + u * s
                        moved.append(f'{i} {s:+.0f} m')
                    else:
                        b = a0 + u * s
                        moved.append(f'{i} {s - len0:+.0f} m')
            length = float(np.hypot(*(b - a)))
            k = frame_scale(*(float(v) for v in to_geo(*((a + b) / 2))))
            if (icao, ref) in THR_LEN:
                # then both ends by the same amount to the AD 2.12 length times the frame's scale (the AIP's points lie
                # a metre or two off OSM's axis's own length)
                cut = (length - THR_LEN[(icao, ref)] * k) / 2
                a, b = a + u * cut, b - u * cut
                moved.append(f'then {cut:+.1f} m each to {THR_LEN[(icao, ref)]} m')
                length = float(np.hypot(*(b - a)))
            est.append((f'{ref} ends', f'{length:.1f} map m ({length / k:.1f} m after the frame\'s scale {k:.5f}; OSM {len0:.0f} m)',
                        ('OSM\'s ways stop at the displaced thresholds or short of the ends: each end moved along its axis to '
                         'AD 2.12\'s runway-end position ' if EUROPE else
                         'OSM\'s way runs over the blast pads: each end moved along its axis to AIP Japan\'s threshold ') +
                        f'(AD 2.12) ({", ".join(moved)}; THR_AT)'))
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
        est.append(('stands', f'{len(STAND_POINTS[icao])} from STAND_POINTS', STAND_POINTS_REASONS.get(icao,
                    'OSM maps no stand numbers and draws the rows as taxiway loops: the X-Plane Scenery Gateway\'s stands '
                    '(open secondary), numbered as AIP Russia\'s parking chart; a 60 m lead-in along each heading')))
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
    if icao in STAND_EXCLUDE:
        ymin, why = STAND_EXCLUDE[icao]
        n0 = len(stands)
        stands = [st for st in stands if st['y'] - oy >= ymin]
        est.append(('small aircraft aprons', f'{n0 - len(stands)} OSM stands left out', why + ' (STAND_EXCLUDE)'))
    if icao in SPOT_REFS:
        # v0.6.4: the AIP's spot numbers on OSM's stands (the nearest within SPOT_REF_M of each published position)
        named = 0
        for r, la, lo in SPOT_REFS[icao]:
            x, y = to_map(la, lo)
            near = sorted((float(np.hypot(st['x'] - x, st['y'] - y)), k) for k, st in enumerate(stands))
            if near and near[0][0] < SPOT_REF_M:
                for st in stands:
                    if st['ref'] == r:
                        st['ref'] = ''
                stands[near[0][1]]['ref'] = r
                named += 1
        est.append(('stand numbers from the AIP', f'{named} of {len(SPOT_REFS[icao])} spots',
                    f'AIP Japan AD 2.8\'s INS checkpoint positions: OSM\'s stand within {SPOT_REF_M:.0f} m of each takes the '
                    'spot\'s number (OSM\'s own refs there are gate or bridge numbers); the rest numbered R1.. (SPOT_REFS)'))
    if EUROPE:
        # v0.7.0: a stand whose stop lies outside OSM's aerodrome (Heathrow's 'TBA South Pen', 26 m outside) is left out
        outer_poly = poly if poly.geom_type == 'Polygon' else max(poly.geoms, key=lambda g: g.area)
        out_refs = [st['ref'] or '(no ref)' for st in stands if not outer_poly.contains(Point(st['x'], st['y']))]
        if out_refs:
            stands = [st for st in stands if outer_poly.contains(Point(st['x'], st['y']))]
            est.append(('stands outside the aerodrome', ', '.join(out_refs), "the stop outside OSM's aerodrome polygon: left out"))
        drop = EU_STAND_DROP.get(icao)
        if drop:
            n0 = len(stands)
            stands = [st for st in stands if st['ref'] not in drop[0]]
            est.append(('stands left out', f'{", ".join(sorted(drop[0]))} ({n0 - len(stands)})', drop[1] + ' (EU_STAND_DROP)'))
    if icao in REF_SQUEEZE:
        # v0.7.0: OSM writes some stand numbers with a space after the letter ('B 44', 'V 117'): the stand is B44, V117
        import re
        n_sq = 0
        for st in stands:
            r2 = re.sub(r'^([A-Z]) (\d+[A-Z]?)$', r'\1\2', st['ref'])
            n_sq += r2 != st['ref']
            st['ref'] = r2
        est.append(('stand numbers squeezed', f'{n_sq}', "OSM's 'B 44' read as B44 (REF_SQUEEZE)"))
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
    if icao in STAND_DROP:
        refs_d, why = STAND_DROP[icao]
        n0 = len(stands)
        stands = [st for st in stands if st['ref'] not in refs_d]
        est.append(('stands left out', f'{n0 - len(stands)}: {", ".join(sorted(refs_d))}', why + ' (STAND_DROP)'))
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

    extra = stand_aprons(stands, aprons, runways, icao, taxiways)
    if extra:
        est.append(('aprons added', f'{len(extra)} pieces, {sum(Polygon(a["points"]).area for a in extra) / 1e6:.2f} km2',
                    f'stands off OSM\'s aprons ({APRON_SYNTH_REASON}): pavement made round them, "synthetic": true'))
        aprons += extra
    if icao in HOLD_DROP_M:
        # v0.7.0: OSM holds standing off every taxiway OSM draws (a taxiway it doesn't map): no route can reach them
        all_twy = shapely.MultiLineString([t['points'] for t in taxiways])
        n0 = len(holds)
        holds = [h for h in holds if all_twy.distance(Point(h['x'], h['y'])) <= HOLD_DROP_M[icao]]
        if n0 > len(holds):
            est.append(('holding positions left out', f'{n0 - len(holds)} of OSM\'s',
                        f'over {HOLD_DROP_M[icao]:.0f} m from every taxiway OSM maps (on a taxiway it doesn\'t): HOLD_DROP_M'))
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
            if not pp.centroid.within(area) or pp.area < (EU_MIN_BUILDING_M2 if EUROPE else 30):
                continue
            if EUROPE:      # v0.7.0: Europe's big fields, kept to East Asia's biggest JSON's size (EU_SIMPLIFY_M)
                xy = np.asarray(pp.simplify(EU_SIMPLIFY_M).exterior.coords)
            buildings.append(dict(kind=kind, heightM=round(building_height(tags, kind), 1),
                                  name='' if EUROPE else (tags.get('name:en') or tags.get('name') or ''), points=pts(xy)))

    roads = []
    for _, tags, coords in d['ways']:
        if tags.get('highway') == 'service':
            ln = LineString(to_xy(coords))
            if ln.intersects(area):
                for part in shapely.get_parts(ln.intersection(area)):
                    if part.geom_type == 'LineString' and part.length > (EU_MIN_ROAD_M if EUROPE else 20):
                        roads.append(dict(points=pts(part.simplify(EU_SIMPLIFY_M).coords if EUROPE else part.coords)))

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


def stand_aprons(stands, aprons, runways, icao=None, taxiways=None):
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
    if icao in APRON_PUSH and taxiways:
        half = APRON_PUSH[icao]
        segs = np.concatenate([np.concatenate([np.asarray(t['points'], float)[:-1], np.asarray(t['points'], float)[1:]], axis=1)
                               for t in taxiways if len(t['points']) >= 2])
        far_s, far_refs = APRON_PUSH_FAR.get(icao, (0.0, set()))
        is_far = np.concatenate([np.full(len(t['points']) - 1, t.get('ref') in far_refs) for t in taxiways if len(t['points']) >= 2])
        ax, ay, ex, ey = segs[:, 0], segs[:, 1], segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1]
        el = np.hypot(ex, ey)
        for st in stands:
            h = np.radians(st['hdgGridDeg'])
            bx, by = -np.sin(h), -np.cos(h)
            x, y = st['x'], st['y']
            den = bx * ey - by * ex
            with np.errstate(divide='ignore', invalid='ignore'):
                sr = ((ax - x) * ey - (ay - y) * ex) / den       # along the ray
                tr = ((ax - x) * by - (ay - y) * bx) / den       # along the segment
                along = np.abs((ex * bx + ey * by) / el)
            for min_s in (30.0, 62.0, 75.0):
                ok = (el >= 1) & (along <= 0.8) & (tr >= 0) & (tr <= 1) & (sr >= min_s) & (sr <= 250)
                if ok.any():
                    sm = float(sr[ok].min()) + 12.0
                    pieces.append(LineString([(x, y), (x + bx * sm, y + by * sm)]).buffer(half, cap_style='flat'))
            ok = (el >= 1) & (along <= 0.8) & (tr >= 0) & (tr <= 1) & (sr >= 30.0) & (sr <= far_s)
            if ok.any() and is_far[ok][np.argmin(sr[ok])]:
                sm = float(sr[ok].min()) + 12.0
                pieces.append(LineString([(x, y), (x + bx * sm, y + by * sm)]).buffer(half, cap_style='flat'))
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
    if icao in AIP_SOURCE:
        L += ['', f'Lights, PAPIs, approach lights, ILS categories, threshold elevations, displacements and widths: {AIP_SOURCE[icao]} '
              '(see the AIP table and its comment in tools/bake_region_airports.py).']
    elif icao in AIP:
        L += ['', 'Lights, PAPIs, approach lights, ILS categories, threshold elevations, displacements and widths: AIP Japan '
              'AD 2.12-2.14 and 2.19 (see AIP in tools/bake_region_airports.py for the pages and dates). Thresholds checked '
              'against AD 2.12\'s coordinates in tests/region-airports.test.mjs (all within 15 m).']
    L += ['', '## [EST] items', '', '| Item | Value | Reason |', '|---|---|---|']
    L += [f'| {a} | {b} | {c} |' for a, b, c in est]
    with open(os.path.join(notes, f'{icao}.md'), 'w') as f:
        f.write('\n'.join(L) + '\n')


def main():
    want = sys.argv[1:] or ICAOS
    wmm = WmmPoint() if EUROPE else Wmm()
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
