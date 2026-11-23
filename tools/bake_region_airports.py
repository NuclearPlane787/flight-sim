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
RUNWAY_WAY_SKIP = set()   # v0.7.6 (airports subagent apc): OSM runway way ids not read as runway (Rota's heliport strip, ref'd as the runway's own 10/28)
HOLD_DROP_M = {}    # v0.7.0: icao -> m; OSM holds farther than this from every taxiway are left out (Europe's block fills it)
REF_SQUEEZE = set()  # v0.7.0: airports whose OSM stand refs 'B 44' are read as B44 (Europe's block fills it)
STAND_DROP = {}     # v0.7.0: icao -> (refs, reason): OSM stands on taxiways no route reaches (Europe's block fills it)
AREA_EXTRA = {}     # v0.7.1: icao -> [(lon0, lat0, lon1, lat1), ...]: boxes added to the aerodrome's area (Toulouse's Airbus sites)
# v0.7.8 marks (part 3, item 7): hangars, shelters and pads that OSM leaves unjoined to any taxiway or apron ("Found while
# building v0.7.6": Zaragoza's military side, a pad at Lossiemouth). icao -> ([(x, y, width m), ...], reason): each map
# point inside a building or an apron; a strip of pavement `width` wide [EST] is laid from it to the nearest taxiway or
# apron (its edge, 4 m into each), "synthetic": true; a strip that would come within 30 m of a runway's edge isn't laid.
# Empty but for the two airports named below.
PAVE_JOIN = {}
# v0.7.8 marks (part 3, item 8): aprons whose OSM outlines step in and out in small notches ("Found while building
# v0.7.6": Fairford's stepped apron edges). icao -> (close m, open m, reason): each OSM apron is closed (notches narrower
# than twice `close` filled), then opened (corners and spurs narrower than twice `open` rounded off), and simplified to
# 1 m. Empty but for Fairford.
APRON_SMOOTH = {}
PAVE_DROPPED = set()      # v0.7.4: airports whose positions left out by a STAND_EXCLUDE set of refs or by STAND_DROP_NUMBERED keep their pavement (stand_aprons())
STAND_DROP_NUMBERED = {}  # v0.7.2: icao -> (refs, reason): unnamed stands left out by the number the bake gave them
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

# ---- v0.7.5 (airports subagent apj1): Nagoya Chubu Centrair (RJGG, chubu-261119) and Osaka Itami (RJOO, kansai-261118),
# pending: their boxes cut by /tmp/flight-sim/v075/apj1/extract.sh, notes in /tmp/flight-sim/v075/airports. From AIP Japan
# as Sendai's were (the full AD 2 PDFs as mirrored at nagodede.github.io/aip/japan, read with pypdf; no page kept here):
# - RJGG AD 2.12 (EFF 28 NOV 2024), 2.13, 2.14 (EFF 21 MAR 2024), 2.19 (EFF 21 MAR 2024), MAG VAR 7 deg W (2021): one
#   runway in use, 18/36 3500 x 60 m (the replacement runway being built east of it isn't in the AIP and isn't drawn as
#   a live runway in OSM), no displacements (LDA 3500 m both ways); PALS 900 m (CAT II at 18, CAT III at 36), TDZ 900 m,
#   RCLL 3500 m, PAPI 3.0 left at both; ILS-LOC 18 CAT II (BRG MAG 177), ILS-LOC 36 CAT III (357), GP 3.0.
# - RJOO AD 2.12 (EFF 15 MAY 2025), 2.13, 2.14 (EFF 10 AUG 2023), 2.19 (EFF 17 APR 2025), MAG VAR 8 deg W (2023):
#   14R/32L 3000 x 60 m, 14L/32R 1828 x 45 m, no displacements (LDA = TORA at all four); 14R "AGL 422m" (approach light
#   beacons at 570 and 944 m and a lead-in system, RLLS: drawn as the game's SSALF), 14L "AGL 597m" (the same), 32L PALS
#   CAT I 450 m with TDZ 900 m, 32R SALS 600 m (SSALF); RCLL on both runways; PAPI 3.0 left at all four; one ILS, to 32L
#   (LOC BRG MAG 322, GP 3.0). The parallel runways don't cross.
NAMES['RJGG'] = ('Centrair', 'Chubu Centrair International Airport')
NAMES['RJOO'] = ('Itami', 'Osaka International Airport')
OSM_DIRS.update({i: '/tmp/flight-sim/v075/airports/osm' for i in ('RJGG', 'RJOO')})
NOTES_DIRS.update({i: '/tmp/flight-sim/v075/airports/bake' for i in ('RJGG', 'RJOO')})
AIP.update({
    'RJGG': {'18': ('ALSF-II', 900, 'left', 3.0, 'II', 15.0, True, True, 60, 0),
             '36': ('ALSF-II', 900, 'left', 3.0, 'III', 15.0, True, True, 60, 0)},
    'RJOO': {'14R': ('SSALF', 422, 'left', 3.0, None, 46.0, False, True, 60, 0),
             '32L': ('ALSF-I', 450, 'left', 3.0, 'I', 31.2, True, True, 60, 0),
             '14L': ('SSALF', 597, 'left', 3.0, None, 50.0, False, True, 45, 0),
             '32R': ('SSALF', 600, 'left', 3.0, None, 34.0, False, True, 45, 0)},
})
ICAOS += [i for i in ('RJGG', 'RJOO') if i not in ICAOS]      # (load_ourairports() reads ICAOS's rows)
PUBLISHED_MAG.update({'RJGG': {'18': 177.0, '36': 357.0}, 'RJOO': {'32L': 322.0}})    # AD 2.19's LOC BRG(MAG)
THR_AT.update({(i, e): (_dms(la), _dms(lo)) for i, e, la, lo in (
    ('RJGG', '18', '345226.01N', '1364806.03E'), ('RJGG', '36', '345034.59N', '1364832.81E'),
    ('RJOO', '14R', '344728.77N', '1352543.34E'), ('RJOO', '32L', '344619.92N', '1352706.76E'),
    ('RJOO', '14L', '344742.97N', '1352543.27E'), ('RJOO', '32R', '344701.02N', '1352634.11E'))})
THR_LEN.update({('RJGG', '18/36'): 3500, ('RJOO', '14R/32L'): 3000, ('RJOO', '14L/32R'): 1828})    # AD 2.12
# The stands: AIP Japan's AD 2.8 INS checkpoint positions (every spot published). OSM's are not usable as they are: at
# Centrair its numbered parking_position nodes sit on the AIP's points but its lead-ins are drawn as 235 short pieces whose
# dead ends made 76 more stands in the middle of the aprons, and Terminal 2's spots 71 to 80 aren't mapped; at Itami its
# stands lie 15 to 30 m off the AIP's, 11 are unnumbered and some are missing. Each stand's heading is OSM's nearest
# lead-in's (within 35 m), else away from the nearest taxiway [EST] (/tmp/flight-sim/v075/apj1/mkpoints.py), Itami 51 and
# 84 set to their rows' 45 deg; a 60 m lead-in behind each. Left out: the letter variants that overlap their spot (RJGG
# 72A, 74A, 400D-F, 500A-F; RJOO 1A, 1B, 2A, 3A, 3B, 4A, 4B, 45W) and RJOO spot 0 (32 m from spot 1); Centrair's small
# aircraft apron N1-N6 (AD 2.8) and its 601W/601E at the apron's south end [EST: not an airliner stand].
STAND_POINTS['RJGG'] = [
    ('1', 34.86421667, 136.81230556, 57.4), ('2', 34.86363056, 136.81238056, 78.7),
    ('3', 34.8631, 136.81250833, 78.7), ('4', 34.86239167, 136.81267778, 78.7),
    ('5', 34.86186111, 136.81280556, 78.7), ('6', 34.86133056, 136.81293333, 78.7),
    ('7', 34.86076667, 136.81313333, 78.7), ('8', 34.85977778, 136.81328056, 115.9),
    ('9', 34.85920278, 136.81231667, 160.5), ('10', 34.85906389, 136.81146389, 169.8),
    ('11', 34.85893333, 136.81065833, 168.8), ('12', 34.85882778, 136.81003889, 148.8),
    ('14', 34.85776389, 136.81028611, 9.0), ('15', 34.85788333, 136.81091111, 348.7),
    ('16', 34.85801389, 136.81171389, 348.7), ('17', 34.85815833, 136.8126, 358.4),
    ('18', 34.85790278, 136.81371944, 40.5), ('19', 34.85690833, 136.81406111, 78.7),
    ('20', 34.85624722, 136.81421944, 78.7), ('21', 34.85558333, 136.81438056, 78.7),
    ('22', 34.85474167, 136.81458056, 78.7), ('23', 34.85408056, 136.81474167, 78.7),
    ('24', 34.85347222, 136.81482778, 78.9), ('25', 34.85288611, 136.81500278, 78.7),
    ('71', 34.8521, 136.81520833, 78.7), ('72', 34.85153333, 136.81500556, 78.7),
    ('73', 34.85119722, 136.81522222, 78.7), ('74', 34.85078889, 136.81518056, 78.7),
    ('75', 34.85043889, 136.81539722, 78.7), ('76', 34.85007778, 136.81546389, 349.4),
    ('77', 34.85035278, 136.81702222, 349.4), ('78', 34.85065556, 136.8166, 349.4),
    ('79', 34.85109444, 136.81684444, 258.3), ('80', 34.85139722, 136.81641667, 258.3),
    ('101', 34.86435, 136.80975556, 78.7), ('102', 34.86501389, 136.80959722, 78.7),
    ('103', 34.86554444, 136.80946944, 78.7), ('104', 34.866075, 136.80934167, 78.7),
    ('105', 34.86660556, 136.80921389, 78.7), ('106', 34.86713611, 136.80908611, 78.7),
    ('107', 34.86766667, 136.80895833, 78.7), ('108', 34.86819722, 136.80883056, 78.7),
    ('109', 34.86879444, 136.80869722, 78.6), ('110', 34.86945833, 136.80853611, 78.6),
    ('111', 34.87012222, 136.80837778, 78.6), ('112', 34.87071667, 136.808225, 78.7),
    ('113', 34.87124722, 136.80809722, 78.7), ('114', 34.87177778, 136.80796944, 78.7),
    ('115', 34.87237778, 136.80783611, 78.6), ('116', 34.87297222, 136.80768333, 78.7),
    ('117', 34.87363889, 136.80766111, 78.9), ('118', 34.87441111, 136.807475, 78.9),
    ('119', 34.87518611, 136.80728889, 78.9), ('201', 34.86253611, 136.81048889, 168.6),
    ('202', 34.86241111, 136.80973889, 168.6), ('203', 34.86228889, 136.80898611, 168.6),
    ('204', 34.86185556, 136.81065278, 348.4), ('205', 34.86173333, 136.80990278, 348.4),
    ('206', 34.86161111, 136.80915, 348.4), ('301', 34.85517222, 136.81223056, 168.6),
    ('302', 34.85506111, 136.81150556, 169.0), ('303', 34.85493611, 136.81078333, 168.6),
    ('304', 34.85449444, 136.81239444, 348.5), ('305', 34.85436944, 136.81167222, 349.0),
    ('306', 34.85425833, 136.81094444, 348.6), ('401', 34.85251944, 136.81286667, 168.6),
    ('402', 34.85240833, 136.81214167, 169.0), ('403', 34.85228333, 136.81141944, 168.6),
    ('405', 34.85164722, 136.81315278, 348.9), ('406', 34.85163056, 136.8126, 349.0),
    ('407', 34.85154167, 136.81206389, 349.0), ('408', 34.85138333, 136.81154444, 349.0),
    ('501', 34.85008056, 136.81353056, 169.1), ('502', 34.84992222, 136.81301111, 169.0),
    ('503', 34.84983611, 136.81247222, 169.0), ('504', 34.84981667, 136.81191944, 169.0),
    ('505', 34.84926111, 136.813725, 349.0), ('506', 34.84924167, 136.81317222, 348.8),
    ('507', 34.84915556, 136.81263611, 349.0), ('508', 34.84899722, 136.81211667, 348.9),
]
STAND_POINTS['RJOO'] = [
    ('1', 34.78515, 135.44451667, 92.9), ('2', 34.78724167, 135.44655833, 75.6),
    ('3', 34.78774722, 135.44591944, 44.7), ('4', 34.78840278, 135.44518056, 6.8),
    ('5', 34.78793611, 135.44406111, 331.1), ('6', 34.7873, 135.44383611, 351.5),
    ('7', 34.78709167, 135.443375, 29.8), ('8', 34.78751389, 135.44286389, 56.1),
    ('9', 34.78823333, 135.443075, 67.7), ('10', 34.788875, 135.44231389, 29.0),
    ('11', 34.78865278, 135.44149444, 50.2), ('12', 34.78868056, 135.44059444, 16.8),
    ('13', 34.78975278, 135.4412, 67.5), ('14', 34.79041111, 135.44038611, 26.4),
    ('15', 34.79016944, 135.43965833, 54.0), ('16', 34.79018889, 135.43871389, 44.9),
    ('17', 34.79129444, 135.43936111, 67.6), ('18', 34.79193333, 135.43860833, 29.2),
    ('19', 34.79180556, 135.4377, 49.8), ('20', 34.7921, 135.43660833, 38.2),
    ('21', 34.79254722, 135.43718611, 154.5), ('22', 34.79281667, 135.43776389, 152.2),
    ('23', 34.7932, 135.438475, 131.5), ('24', 34.79383056, 135.43872222, 77.9),
    ('25', 34.79437778, 135.43841389, 50.1), ('26', 34.79468611, 135.43803333, 46.8),
    ('27', 34.79472778, 135.43757222, 45.6), ('41', 34.794225, 135.43715556, 46.5),
    ('42', 34.79447778, 135.43685, 46.8), ('43', 34.793875, 135.43646111, 347.4),
    ('44', 34.793575, 135.43610556, 357.2), ('45', 34.79412222, 135.43579444, 34.1),
    ('46', 34.79426111, 135.43596111, 34.1), ('47', 34.79458611, 135.43635278, 131.9),
    ('48', 34.79491111, 135.43674722, 131.8), ('51', 34.79336667, 135.4339, 45.0),
    ('52', 34.79365, 135.43348333, 45.1), ('53', 34.79404444, 135.43297778, 45.0),
    ('70', 34.79554722, 135.43416944, 135.3), ('71', 34.79588889, 135.43457778, 103.8),
    ('72', 34.79610833, 135.43483056, 135.6), ('73', 34.79645278, 135.43526389, 135.2),
    ('74', 34.79745833, 135.43436111, 14.5), ('75', 34.79648611, 135.43320278, 314.7),
    ('76', 34.79629444, 135.43288889, 330.2), ('77', 34.79591667, 135.43250278, 331.8),
    ('80', 34.79509444, 135.43207778, 44.7), ('81', 34.79535278, 135.43176389, 44.8),
    ('82', 34.79561111, 135.43145, 45.0), ('83', 34.79586667, 135.43113889, 44.9),
    ('84', 34.79612778, 135.43082778, 44.9),
]
STAND_POINTS_ONLY = {'RJGG', 'RJOO'}   # (v0.7.5: OSM's parking_position ways and nodes not read there; the stands are these only)
STAND_POINTS_REASONS.update({i: ("OSM's stands unusable as drawn (see the bake tool): AIP Japan AD 2.8's INS checkpoint positions, "
                                 "every spot but the overlapping letter variants and the small aircraft's; the heading OSM's "
                                 "nearest lead-in's, else away from the nearest taxiway [EST]; a 60 m lead-in along each")
                             for i in ('RJGG', 'RJOO')})

# ---- v0.7.5 (airports subagent apj2): Komatsu (RJNK, chubu-261119), pending: its box cut by
# /tmp/flight-sim/v075/airports/osm/extract-apj2.sh, notes in /tmp/flight-sim/v075/airports. From AIP Japan as Sendai's
# were (the full AD 2 PDF as mirrored at nagodede.github.io/aip/japan, read with pypdf; no page kept here):
# - RJNK AD 2.12 (EFF 23 JAN 2025), 2.13, 2.14 (EFF 19 FEB 2026), 2.19 (EFF 29 MAR 2020), MAG VAR 8 deg W (2006): one
#   runway, 06/24 2700 x 45 m, no displacements (LDA 2700 both ways); 06 PALS CAT I 839 m, 24 PALS CAT I 597 m, PAPI 3.0
#   left at both, RCLL 2700 m, no TDZ lights; one ILS, to 06 (LOC BRG MAG 063, GP 3.0); 24 has an RNP approach only.
#   (OurAirports' "06T/24T" is the JASDF's parallel taxiway, AIP's TWY P: not a runway in the AIP or in OSM.)
# - A joint field (AD 2.2: "Japan Air Self Defense Force. Public AD."): the civil terminal and its apron (spots 2 to 8,
#   AD 2.8) north of the runway, the JASDF's side south of it. OSM maps no landuse=military there, and no apron, taxiway
#   or parking position on the JASDF's side: only its buildings, the shelters among them. The stands are AD 2.8's INS
#   checkpoints (STAND_POINTS; OSM's six nodes on the terminal's row sit on spots 3 to 8, and its five small
#   parking_position ways in front of the terminal are not AIP spots), so the military side has none (Shane's "Empty").
# - The taxiways: OSM maps them without refs; named from the AD chart (AD 2.24): P the parallel north of the runway (its
#   loop's ends are C1 at the 24 end and C5 at the 06 end), C2 to C4 its links between, NE to SW.
NAMES['RJNK'] = ('Komatsu', 'Komatsu Airport')
ICAOS += [i for i in ('RJNK',) if i not in ICAOS]      # (load_ourairports() reads ICAOS's rows)
OSM_DIRS['RJNK'] = '/tmp/flight-sim/v075/airports/osm'
NOTES_DIRS['RJNK'] = '/tmp/flight-sim/v075/airports/bake'
AIP['RJNK'] = {'06': ('ALSF-I', 839, 'left', 3.0, 'I', 38.1, False, True, 45, 0),
               '24': ('ALSF-I', 597, 'left', 3.0, None, 18.4, False, True, 45, 0)}
PUBLISHED_MAG['RJNK'] = {'06': 63.0}    # AD 2.19's LOC BRG(MAG)
THR_AT.update({('RJNK', '06'): (_dms('362312.93N'), _dms('1362342.53E')),
               ('RJNK', '24'): (_dms('362403.07N'), _dms('1362511.48E'))})    # AD 2.12
THR_LEN[('RJNK', '06/24')] = 2700
# Spots 2 to 8 at AD 2.8's INS checkpoints; the nose square to the row (054.6 deg true) towards the terminal [EST: the heading]
STAND_POINTS['RJNK'] = [(r, _dms(la), _dms(lo), 324.6) for r, la, lo in (
    ('2', '362410.87N', '1362500.30E'), ('3', '362409.47N', '1362457.78E'), ('4', '362408.26N', '1362455.61E'),
    ('5', '362406.89N', '1362453.50E'), ('6', '362405.61N', '1362451.19E'), ('7', '362404.32N', '1362448.87E'),
    ('8', '362403.03N', '1362446.55E'))]
STAND_POINTS_ONLY.add('RJNK')    # (apj1's switch: OSM's parking_position ways not read either)
STAND_POINTS_REASONS['RJNK'] = ("the civil spots 2 to 8 at AIP Japan's INS checkpoint positions (RJNK AD 2.8), the nose "
                                "square to the row towards the terminal [EST]; none on the JASDF's side (no stands there)")
TWY_REFS['RJNK'] = {164419213: 'P', 164419211: 'C2', 164419212: 'C2', 164419221: 'C2', 164419217: 'C3', 164419210: 'C3',
                    164419215: 'C3', 164419216: 'C4', 164419218: 'C4', 164419220: 'C4'}
TWY_REF_REASONS['RJNK'] = ("OSM maps no taxiway ref at Komatsu: named from AIP Japan's AD chart (RJNK AD 2.24): P the "
                           "parallel (its loop's ends C1 at 24 and C5 at 06 kept in P's way), C2 to C4 its links NE to SW")
# The JASDF's shelters: OSM's twenty hangars of about 25 x 23 m on the south side, no height in OSM: low vaults [EST] 9 m
# (public photographs: an F-15's shelter stands about 8 to 10 m), not the 20 m of a hangar (SHELTERS, building loop).
# v0.7.6 (the lead, after the pictures-only review: "airliner wing inside a building" at Lakenheath): buildings not
# drawn, each named by a map point inside it, with the reason. Only where a building stands in the way of the player's
# own taxi routes and is not what the game would draw it as. Empty for every other airport.
BUILDING_SKIP_AT = {}
SHELTERS = {'RJNK': (frozenset({1435071180, 1435071181, 1435071184, 1435071185, 1435071186, 1435071187, 1435071188,
                                1435071189, 1435071191, 1435071192, 1435071193, 1435071194, 1435071195, 1435071196,
                                1435071197, 1435071198, 318940517, 318940521, 318940522, 318940529}), 9.0,
                     "the JASDF's hardened aircraft shelters (OSM hangars of about 25 x 23 m, no height): low vaults 9 m")}
# ---- v0.7.5 (airports subagent apj2): Hiroshima (RJOA, chugoku-261122), pending: its box cut by the same script.
# - RJOA AD 2.12 (EFF 28 NOV 2024), 2.13, 2.14 (EFF 20 MAR 2025), 2.19 (EFF 23 MAR 2023), MAG VAR 8 deg W (2022): one
#   runway on the plateau, 10/28 3000 x 60 m, no displacements (LDA 3000 both ways); 10 PALS CAT III 900 m (the game's
#   ALSF-II), TDZ 900 m, ILS CAT III (LOC BRG MAG 097.93, GP 3.0); 28 SALS 420 m (SSALF), no ILS (AD 2.14: CGL and wide
#   angle approach lights for the south side circling to 28); PAPI 3.0 left and RCLL at both. THR elevations 1071.7 and
#   1067.2 ft. OSM's runway way runs over the overruns (3,113 m): THR_AT.
# - OSM maps no stand there: AD 2.8's INS checkpoints, spots 1 to 10 (no 4), the letter variants 6R, 6L and 7L left out
#   (they overlap 6 and 7), each nose north to the terminal (the row runs east-west) [EST: the heading].
# - The taxiways named from the AD chart (AD 2.24): P the parallel north of the runway (P1 to P5 in one OSM way, its
#   ends T1 at 28 and T6 at 10), T2 to T5 its links east to west, the sub taxiway to the sub apron in the west.
NAMES['RJOA'] = ('Hiroshima', 'Hiroshima Airport')
ICAOS += [i for i in ('RJOA',) if i not in ICAOS]
OSM_DIRS['RJOA'] = '/tmp/flight-sim/v075/airports/osm'
NOTES_DIRS['RJOA'] = '/tmp/flight-sim/v075/airports/bake'
AIP['RJOA'] = {'10': ('ALSF-II', 900, 'left', 3.0, 'III', 1071.7, True, True, 60, 0),
               '28': ('SSALF', 420, 'left', 3.0, None, 1067.2, False, True, 60, 0)}
PUBLISHED_MAG['RJOA'] = {'10': 97.93}    # AD 2.19's LOC BRG(MAG)
THR_AT.update({('RJOA', '10'): (_dms('342609.69N'), _dms('1325411.25E')),
               ('RJOA', '28'): (_dms('342609.69N'), _dms('1325608.75E'))})    # AD 2.12
THR_LEN[('RJOA', '10/28')] = 3000
STAND_POINTS['RJOA'] = [(r, _dms(la), _dms(lo), 0.0) for r, la, lo in (
    ('1', '342621.10N', '1325517.84E'), ('2', '342621.09N', '1325515.09E'), ('3', '342621.09N', '1325512.35E'),
    ('5', '342621.09N', '1325509.61E'), ('6', '342620.86N', '1325506.74E'), ('7', '342621.09N', '1325503.83E'),
    ('8', '342621.09N', '1325500.89E'), ('9', '342621.11N', '1325458.60E'), ('10', '342621.08N', '1325456.33E'))]
STAND_POINTS_ONLY.add('RJOA')
STAND_POINTS_ONLY.add('RKJK')    # (the code review: Kunsan's two stands are the bake's own; OSM maps none there today, and a newer extract's must not bring the air base's in)
STAND_POINTS_REASONS['RJOA'] = ("OSM maps no stands: spots 1 to 10 (no 4) at AIP Japan's INS checkpoint positions (RJOA "
                                "AD 2.8), 6R, 6L and 7L left out (they overlap 6 and 7), the nose north to the terminal [EST]")
TWY_REFS['RJOA'] = {96933280: 'P', 885164517: 'T1', 885164518: 'T2', 885164519: 'T2', 96933333: 'T2', 96933335: 'T2',
                    96933337: 'T2', 885164520: 'T3', 885164521: 'T3', 96933332: 'T3', 96933291: 'T3', 96933309: 'T3',
                    96933305: 'T4', 96933294: 'T4', 96933319: 'T4', 96933296: 'T5', 96933320: 'T5'}
TWY_REF_REASONS['RJOA'] = ("OSM maps no taxiway ref at Hiroshima: named from AIP Japan's AD chart (RJOA AD 2.24): P the "
                           "parallel (P1 to P5 and its end links T1 and T6 in one OSM way), T2 to T5 its links east to west")

# ---- v0.7.5 (airports subagent apk): Cheongju (RKTU) and Kunsan (RKJK), both from south-korea-latest, pending: their boxes
# cut by /tmp/flight-sim/v075/airports/osm/extract-apk.sh, notes in /tmp/flight-sim/v075/airports. From Korea's eAIP as
# Gimhae's were (aim.koca.go.kr, KR-AD-2.<ICAO>, the 2026-11-12 package, read directly; no page kept in the repository):
# - RKTU AD 2.12, 2.13, 2.14, 2.19 (MAG VAR 9 deg W 2025): 06L/24R 2744 x 60 m and 06R/24L 2744 x 45 m, parallel (no
#   crossing), no displacements (LDA 2744 m at all four); 06L SSALR 717 m (drawn as the game's SSALF, as Gimhae's 18L),
#   24R ALSF-I 900 m, 06R SALS 291 m (SSALF), 24L ALSF-I 900 m with TDZ 900 m; PAPI both sides 3.0 deg at all four;
#   centreline lights on 06R/24L only (06L/24R's "NIL"); an ILS (LOC and GP) to every end, its category not stated:
#   I [EST]. AD 2.20 1.3: "It is mandatory for all airliners to use RWY 06L/24R except for emergency situations."
#   Jointly operated with the ROKAF (17th Fighter Wing, OSM's landuse=military): no stands on its side.
# - RKJK AD 2.12, 2.13, 2.14, 2.19 (MAG VAR 8 deg W 2025): 18/36 9008 ft x 150 ft (2746 x 45 m), no displacements; ALSF-I at
#   both ends (length not stated: 900 m [EST]), PAPI left 3 deg, no TDZ, no centreline lights; ILS to both (LOC 36 inbound
#   356, LOC 18 176; category not stated: I [EST]); THR elevations 5.3 m (18) and 8.2 m (36). A USAF and ROKAF base whose
#   whole aerodrome OSM tags landuse=military (as Wonsan's): not in MILITARY, its stands only the civil ramp's STAND_POINTS.
# Their variation is frame.js's plane, as Gimhae's (PLANE): both lie inside south-korea.poly, where the game's magVar()
# is the plane (tests/v060-rules-frame.test.mjs loads the game's own rules and compares every listed airport: Cheongju
# baked from the WMM grid was 0.06 deg off it, found at the promotion; the lead's mend, 13:35).
PLANE |= {'RKTU', 'RKJK'}
# (The notes' AIP wording is Japan's: AIP_SOURCE is defined further down, for Europe.)
NAMES['RKTU'] = ('Cheongju', 'Cheongju International Airport')
NAMES['RKJK'] = ('Kunsan', 'Gunsan Airport (Kunsan Air Base)')
OSM_DIRS.update({i: '/tmp/flight-sim/v075/airports/osm' for i in ('RKTU', 'RKJK')})
NOTES_DIRS.update({i: '/tmp/flight-sim/v075/airports/bake' for i in ('RKTU', 'RKJK')})
ICAOS += [i for i in ('RKTU', 'RKJK') if i not in ICAOS]      # (load_ourairports() reads ICAOS's rows)
AIP.update({
    'RKTU': {'06L': ('SSALF', 717, 'both', 3.0, 'I', 166.0, False, False, 60, 0),
             '24R': ('ALSF-I', 900, 'both', 3.0, 'I', 185.4, False, False, 60, 0),
             '06R': ('SSALF', 291, 'both', 3.0, 'I', 171.27, False, True, 45, 0),
             '24L': ('ALSF-I', 900, 'both', 3.0, 'I', 191.46, True, True, 45, 0)},
    'RKJK': {'18': ('ALSF-I', 900, 'left', 3.0, 'I', 17.39, False, False, 45, 0),
             '36': ('ALSF-I', 900, 'left', 3.0, 'I', 26.90, False, False, 45, 0)},
})
# AD 2.12's true bearing less the AIP's variation (RKTU 9 W), and RKJK's AD 2.19 LOC inbound headings (notes only)
PUBLISHED_MAG.update({'RKTU': {'06L': 61.42, '24R': 241.43, '06R': 61.43, '24L': 241.43}, 'RKJK': {'18': 176.0, '36': 356.0}})
MILITARY = MILITARY | {'RKTU'}
# Every end at AD 2.12's threshold (no displacement anywhere, so the runway's end), projected on OSM's axis, then both ends
# trimmed evenly to AD 2.12's length times the frame's scale (THR_AT, THR_LEN; the notes' wording is Japan's).
THR_AT.update({(i, e): (_dms(la), _dms(lo)) for i, e, la, lo in (
    ('RKTU', '06L', '364236.10N', '1272912.46E'), ('RKTU', '24R', '364330.38N', '1273040.05E'),
    ('RKTU', '06R', '364228.26N', '1272914.84E'), ('RKTU', '24L', '364322.53N', '1273042.46E'),
    ('RKJK', '18', '355457.29N', '1263646.82E'), ('RKJK', '36', '355329.83N', '1263707.63E'))})
THR_LEN.update({('RKTU', '06L/24R'): 2744, ('RKTU', '06R/24L'): 2744, ('RKJK', '18/36'): 2746})
# Cheongju's stands 71 to 78 (AD 2.8 lists them with 1 to 13): eight positions 18 m apart in two rows behind stand 1, a
# light aircraft's spacing [EST], not an airliner's stand.
STAND_EXCLUDE['RKTU'] = (frozenset({'71', '72', '73', '74', '75', '76', '77', '78'}),
                         "AD 2.8's stands 71 to 78, 18 m apart behind stand 1: light aircraft's [EST]")
# OSM's aerodrome polygon at Cheongju runs along the apron's north-west edge, leaving out the passenger terminal behind
# stands 1 to 7 (way 125836349): a box round it is added to the area the buildings are read from (AREA_EXTRA, Toulouse's).
AREA_EXTRA['RKTU'] = [(127.4946, 36.7209, 127.4974, 36.7229)]
# Kunsan's civil ramp: OSM maps the passenger terminal at the field's north end and the ramp's taxilane loop south of it,
# but no apron, stand or gate. Two stands [EST] nose-in to the terminal (12 m off its south face, 44 m apart, code C: AD
# 2.20 bars spans over 118 ft north of TWY E), each with a 60 m lead-in across the loop's north side; their pushback ground
# paved (APRON_PUSH).
STAND_POINTS['RKJK'] = [('1', 35.92579051, 126.61554437, 1.9), ('2', 35.92579051, 126.61603247, 1.9)]
STAND_POINTS_REASONS['RKJK'] = ("OSM maps no stand, gate or apron at the civil terminal: two stands nose-in to it, 44 m "
                                "apart, 12 m off its south face, a 60 m lead-in behind each [EST]")
APRON_PUSH['RKJK'] = 27.0
# The ROKAF's and the USAF's hardened aircraft shelters: Cheongju's OSM building=bunker (59, those inside the aerodrome
# kept), Kunsan's ten square 35 x 36 m buildings by its taxiways (OSM building=yes, no height): low vaults 9 m [EST],
# as Komatsu's.
SHELTERS['RKTU'] = (frozenset({
    888880774, 888880785, 888880786, 888880787, 888880788, 888880789, 888880790, 888880791, 888880792, 888880793, 888880794,
    888880795, 888880796, 888880797, 888880798, 893949443, 893949444, 893949445, 893949446, 893949447, 893949448, 893949449,
    893949450, 893949451, 893949452, 893949453, 893949454, 893949455, 893949456, 893949457, 893949458, 893949459, 893949460,
    893949465, 893949466, 893949467, 893949475, 893949476, 893949521, 893949522, 893949523, 893949524, 893949525, 893949526,
    893949527, 893949528, 893949529, 893949530, 893949531, 893949532, 893949533, 893949534, 893949535, 893949536, 893949537,
    893949538, 1377441567, 1377441568, 1377441569}), 9.0,
    "the ROKAF's hardened aircraft shelters (OSM building=bunker, no height): low vaults 9 m")
SHELTERS['RKJK'] = (frozenset({1344345603, 1490559745, 1490559748, 1490559749, 1490559750, 1490559751, 1490559753,
                               1490559754, 1490559765, 1490559766}), 9.0,
                    "the air base's hardened aircraft shelters (OSM's square 35 x 36 m buildings by the taxiways, no "
                    "height): low vaults 9 m")

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

# - v0.7.1, Toulouse (LFBO, midi-pyrenees-261121): box cut by /tmp/flight-sim/v071/airports/osm/extract.sh (1.30,43.60,
#   1.40,43.68). France's SIA eAIP (AD 2 LFBO, AIRAC 29 OCT 2026; no page kept in the repository): AD 2.12 14L/32R
#   3025 x 45, 14R/32L 3503 x 45, true (mag) 142.91 (141) / 322.91 (321), 142.90 (141) / 322.90 (321); THR elevations
#   489 / 497 / 488 / 497 ft; no displacement (AD 2.13 LDA = TORA). AD 2.14: 14L approach lights 900 m (CAT I ILS: the
#   game's ALSF-I), 14R 870 m (CAT III ILS: ALSF-II), none at 32R and 32L; PAPI 3.0 deg at all four (side not stated:
#   left [EST]); TDZ 900 m at 14R only; centreline lights on 14R/32L only. AD 2.19: ILS CAT III (III.E.4) to 14R, CAT I
#   (I.E.1) to 14L, 32R and 32L. AD 2.20.2: transition altitude 5000 ft. AD 2.21: by night landings only on 14R (14) or
#   32L (32). The Airbus sites west (Saint-Martin-du-Touch, Clement Ader at Colomiers) and north (Jean-Luc Lagardere at
#   Aeroconstellation) of the runways: their halls, aprons and taxiway links in the area (AREA_EXTRA), no names.
if EUROPE:
    NAMES['LFBO'] = ('Toulouse', 'Toulouse–Blagnac Airport')
    OSM_DIRS['LFBO'] = '/tmp/flight-sim/v071/airports/osm'
    NOTES_DIRS['LFBO'] = '/tmp/flight-sim/v071/airports'
    AIP_SOURCE['LFBO'] = "France's SIA eAIP, AD 2 LFBO (AIRAC 29 OCT 2026) AD 2.12-2.14, 2.19, 2.20 and 2.21"
    AIP['LFBO'] = {'14L': ('ALSF-I', 900, 'left', 3.0, 'I', 489.0, False, False, 45, 0),
                   '32R': (None, 0, 'left', 3.0, 'I', 497.0, False, False, 45, 0),
                   '14R': ('ALSF-II', 870, 'left', 3.0, 'III', 488.0, True, True, 45, 0),
                   '32L': (None, 0, 'left', 3.0, 'I', 497.0, False, True, 45, 0)}
    PUBLISHED_MAG['LFBO'] = {'14L': 141.0, '32R': 321.0, '14R': 141.0, '32L': 321.0}
    AIP_THR['LFBO'] = {'14L': ('433814.51N', '0012127.45E'), '32R': ('433656.29N', '0012248.85E'),
                       '14R': ('433838.81N', '0012045.36E'), '32L': ('433708.27N', '0012219.62E')}
    THR_AT.update({('LFBO', e): (_dms_signed(la), _dms_signed(lo)) for e, (la, lo) in AIP_THR['LFBO'].items()})
    THR_LEN.update({('LFBO', '14L/32R'): 3025, ('LFBO', '14R/32L'): 3503})
    HOLD_DROP_M['LFBO'] = 30.0
    # The Airbus sites: Saint-Martin-du-Touch and the Clement Ader halls (west) lie inside OSM's aerodrome polygon already;
    # the Jean-Luc Lagardere plant at Aeroconstellation (north) lies outside it: the box round OSM's landuse=industrial
    # way 30609250 (the Airbus site there) added to the area, so its halls, apron and taxiway links are baked.
    AREA_EXTRA['LFBO'] = [(1.348, 43.6448, 1.3646, 43.6608)]
    ICAOS = list(NAMES)

# - v0.7.1, Berlin (EDDB, brandenburg-261121): box cut by /tmp/flight-sim/v071/airports/osm/extract.sh (13.44,52.34,13.58,
#   52.40). Germany's DFS AIP IFR (aip.dfs.de BasicIFR 2026OCT29; page images, read by eye; no page kept in the
#   repository). The runways are still 06L/24R and 06R/24L in the AIP and in OSM. AD 2.12 (page 1-8): 06L/24R 3600 x 45,
#   06R/24L 4000 x 60, true 068.80 / 248.84, 068.79 / 248.83; THR elevations 144.1 / 153.6 / 152.4 / 149.1 ft; the THR
#   co-ordinates are the landing thresholds. AD 2.13 (1-9): 06L and 24R LDA 3300 of 3600 (each threshold displaced
#   300 m), 06R and 24L LDA 4000. AD 2.14 (1-9, 1-10): ALSAF at all four (length not stated: the game's ALSF-II 900 m,
#   [EST]), PAPI 3.0 deg (side not stated: left [EST]), TDZ and centreline lights at all four. AD 2.19 (1-12, 1-13): ILS
#   CAT III to 06L, 24R, 06R, 24L; MAG VAR 5 deg E (2025). AD 2.17 (1-11): transition altitude 5000 ft MSL.
if EUROPE:
    NAMES['EDDB'] = ('Berlin', 'Berlin Brandenburg Airport')
    OSM_DIRS['EDDB'] = '/tmp/flight-sim/v071/airports/osm'
    NOTES_DIRS['EDDB'] = '/tmp/flight-sim/v071/airports'
    AIP_SOURCE['EDDB'] = "Germany's DFS AIP IFR, AD 2 EDDB (effective 29 OCT 2026) AD 2.12-2.14, 2.17 and 2.19"
    AIP['EDDB'] = {'06L': ('ALSF-II', 900, 'left', 3.0, 'III', 144.1, True, True, 45, 300),
                   '24R': ('ALSF-II', 900, 'left', 3.0, 'III', 153.6, True, True, 45, 300),
                   '06R': ('ALSF-II', 900, 'left', 3.0, 'III', 152.4, True, True, 60, 0),
                   '24L': ('ALSF-II', 900, 'left', 3.0, 'III', 149.1, True, True, 60, 0)}
    # AD 2.12's TRUE BRG less AD 2.19's 5 deg E (notes only)
    PUBLISHED_MAG['EDDB'] = {'06L': 63.80, '24R': 243.84, '06R': 63.79, '24L': 243.83}
    AIP_THR['EDDB'] = {'06L': ('522203.683N', '0132906.088E'), '24R': ('522238.749N', '0133133.951E'),
                       '06R': ('522043.560N', '0132806.336E'), '24L': ('522130.330N', '0133123.383E')}
    # 06L/24R: OSM's ref'd way runs between the displaced thresholds (within 2 m of AD 2.12's): each end at the outer end
    # of OSM's unnamed displaced-threshold way (298 m and 300 m), then both trimmed evenly to 3,600 m. 06R/24L: each end
    # at AD 2.12's threshold (no displacement, so the runway's end), trimmed evenly to 4,000 m.
    THR_AT.update({('EDDB', '06L'): (52.3667076, 13.4809194), ('EDDB', '24R'): (52.3784025, 13.530203)})
    THR_AT.update({('EDDB', e): (_dms_signed(la), _dms_signed(lo)) for e, (la, lo) in AIP_THR['EDDB'].items() if e in ('06R', '24L')})
    THR_LEN.update({('EDDB', '06L/24R'): 3600, ('EDDB', '06R/24L'): 4000})
    HOLD_DROP_M['EDDB'] = 30.0
    # v0.7.4 ("Found while building v0.7.1"): OSM's de-icing pads (aeroway=parking_position with refs PAD1 to PADEAST,
    # fourteen positions on the north, south and east de-icing areas) were offered as stands. STAND_EXCLUDE takes a set
    # of OSM refs as well as a y threshold.
    STAND_EXCLUDE['EDDB'] = (frozenset({'PAD1', 'PAD1A', 'PAD2', 'PAD3', 'PAD 3', 'PADEAST'}), "OSM's de-icing pads, not parking stands")
    # and the three positions OSM leaves unnamed on the east pad (among PAD1-3 to PAD1A-3), by the numbers the bake gave them
    STAND_DROP_NUMBERED['EDDB'] = ({'R2', 'R3', 'R4'}, "unnamed OSM positions on the east de-icing pad, not parking stands")
    PAVE_DROPPED.add('EDDB')   # OSM maps no apron under the pads: they keep the pavement the bake made round them
    ICAOS = list(NAMES)

# - v0.7.1, Malpensa (LIMC, nord-ovest-261121): box cut by /tmp/flight-sim/v071/airports/osm/extract.sh (8.67,45.60,8.76,
#   45.66). Italy's AIP (ENAV's eAIP) asks for a login: not read. Every value [EST]: the runways OSM's (17L/35R and
#   17R/35L 3920 x 60: OSM's length and width tags, OurAirports' 12,861 x 197 ft); both ref'd ways stop at a displaced
#   threshold (unnamed displaced_threshold ways before 17L, 943 m, and 35L, 402 m): those ends at the unnamed ways'
#   outer ends, each runway trimmed evenly to 3,920 m. The thresholds' elevations and displacements (17L 941 m, 35L
#   400 m) OurAirports'; the lights and ILS general knowledge of the field: ILS CAT III to 35L and 35R, CAT I to 17L and
#   17R; 900 m approach lights at the four; PAPI left 3 deg; TDZ at 35L and 35R; centreline lights (60 m wide).
if EUROPE:
    NAMES['LIMC'] = ('Malpensa', 'Milan Malpensa Airport')
    OSM_DIRS['LIMC'] = '/tmp/flight-sim/v071/airports/osm'
    NOTES_DIRS['LIMC'] = '/tmp/flight-sim/v071/airports'
    AIP_SOURCE['LIMC'] = ("no AIP (Italy's eAIP asks for a login): OurAirports' elevations and displacements, OSM's "
                          "lengths, the lights and ILS from general knowledge of the field, all [EST]")
    AIP['LIMC'] = {'17L': ('ALSF-I', 900, 'left', 3.0, 'I', 745.0, False, True, 60, 941),
                   '35R': ('ALSF-II', 900, 'left', 3.0, 'III', 691.0, True, True, 60, 0),
                   '17R': ('ALSF-I', 900, 'left', 3.0, 'I', 764.0, False, True, 60, 0),
                   '35L': ('ALSF-II', 900, 'left', 3.0, 'III', 696.0, True, True, 60, 400)}
    THR_AT.update({('LIMC', '17L'): (45.6503523, 8.7279177), ('LIMC', '35L'): (45.6108328, 8.728289)})
    THR_LEN.update({('LIMC', '17L/35R'): 3920, ('LIMC', '17R/35L'): 3920})
    HOLD_DROP_M['LIMC'] = 30.0
    ICAOS = list(NAMES)

# - v0.7.1, airports subagent 3: Lisbon (LPPT, portugal-261121), Copenhagen (EKCH, denmark-261121) and Manchester (EGCC,
#   greater-manchester-261121 + cheshire-261121, merged): boxes cut by /tmp/flight-sim/v071/airports/osm/extract3.sh.
#   No page kept in the repository.
#   - LPPT: NAV Portugal's eAIP answers "Under maintenance" (HTTP 503) for AD 2 LPPT and ENR 1.7: not read. Every value
#     [EST]: 02/20's geometry OSM's (both ends at the outer ends of OSM's unnamed displaced-threshold ways, 87 m before
#     02 and 594 m before 20), the length OurAirports' 12,500 ft (3,810 m), the thresholds' elevations (331 / 347 ft)
#     and displacements (290 / 1,960 ft) OurAirports'; the lights and ILS general knowledge of the field: ILS CAT III
#     to 02 (900 m approach lights, TDZ), CAT I to 20 (900 m); PAPI left 3 deg; centreline lights. 17/35 is closed
#     (OurAirports closed=1) and OSM maps it as no runway.
#   - EKCH, Denmark's Naviair AIP (AD 2 EKCH, AIRAC AMDT 03/26 with pages to 27 NOV 25 AMDT 12/25): AD 2.12 04L 3001 /
#     22R 3571, 04R/22L 3302, 12 2800 / 30 2365 (x 45 m); true (mag) 041.2 (037.2) / 221.2 (217.2) / 123.2 (119.2) /
#     303.2 (299.2); THR elevations 13 / 14 / 12 / 8 / 13 / 8 ft. 04L/22R's pavement is 3,571 m, 22R's threshold 570 m
#     in (04L's 570 m stopway; AD 2.14 22R edge lights red 570 m); 12/30's 2,800 m, 12's threshold 435 m in and 30's
#     270 m (AD 2.14 edge lights red 435 / 270 m; AD 2.13 LDA 2365 / 2095). AD 2.14: 04L CAT II 900 m (ALSF-II), TDZ
#     900 m; 22R 900 m (ALSF-I); 04R 720 m (ALSF-I); 22L CAT II/III 840 m (ALSF-II), TDZ 900 m; 12 and 30 900 m
#     (ALSF-I); PAPI 3 deg at all six (side not stated: left [EST]); centreline lights on 04L/22R and 04R/22L, none on
#     12/30. AD 2.19: ILS CAT II 04L, CAT III 22L, CAT I 04R, 22R, 12, 30. AD 2.17: transition altitude 5000 FT MSL.
#   - EGCC, the UK's NATS eAIP (EG AD 2 EGCC, AIRAC 29 OCT 2026): AD 2.12 05L/23R 3048 x 45, 05R/23L 3050 x 45; true
#     051.06 / 231.09 / 051.04 / 231.07; the THR co-ordinates the landing thresholds (05L displaced 427 m, 23R 183 m,
#     23L 186 m); THR elevations 211.8 / 249.1 / 186.3 / 227.0 ft. AD 2.14: 05L and 23R coded centre-line with five
#     crossbars 914 m (ALSF-II), TDZ 900 m; 05R and 23L 900 m (ALSF-I), no TDZ; PAPI 3 deg (05L right, the others left);
#     centreline lights at all four. AD 2.19: ILS CAT III 05L, 23R, CAT I 05R; none to 23L. AD 2.2 MAG VAR 0.45 E (2027).
#     AD 2.17: transition altitude 5000 FT.
if EUROPE:
    for _i, _n in (('LPPT', ('Lisbon', 'Humberto Delgado Airport')), ('EKCH', ('Copenhagen', 'Copenhagen Airport, Kastrup')),
                   ('EGCC', ('Manchester', 'Manchester Airport'))):
        NAMES[_i] = _n
        OSM_DIRS[_i] = '/tmp/flight-sim/v071/airports/osm'
        NOTES_DIRS[_i] = '/tmp/flight-sim/v071/airports'
        HOLD_DROP_M[_i] = 30.0
    AIP_SOURCE['LPPT'] = ("no AIP (NAV Portugal's eAIP is under maintenance): OurAirports' length, elevations and "
                          "displacements, OSM's geometry, the lights and ILS from general knowledge of the field, all [EST]")
    AIP_SOURCE['EKCH'] = "Denmark's Naviair AIP, AD 2 EKCH (AIRAC AMDT 03/26) AD 2.12-2.14, 2.17, 2.19 and 2.21"
    AIP_SOURCE['EGCC'] = "the UK's NATS eAIP, EG AD 2 EGCC (AIRAC 29 OCT 2026) AD 2.12-2.14, 2.17, 2.19 and 2.20"
    AIP['LPPT'] = {'02': ('ALSF-II', 900, 'left', 3.0, 'III', 331.0, True, True, 45, 88),
                   '20': ('ALSF-I', 900, 'left', 3.0, 'I', 347.0, False, True, 45, 597)}
    AIP['EKCH'] = {'04L': ('ALSF-II', 900, 'left', 3.0, 'II', 13.0, True, True, 45, 0),
                   '22R': ('ALSF-I', 900, 'left', 3.0, 'I', 14.0, False, True, 45, 570),
                   '04R': ('ALSF-I', 720, 'left', 3.0, 'I', 12.0, False, True, 45, 0),
                   '22L': ('ALSF-II', 840, 'left', 3.0, 'III', 8.0, True, True, 45, 0),
                   '12': ('ALSF-I', 900, 'left', 3.0, 'I', 13.0, False, False, 45, 435),
                   '30': ('ALSF-I', 900, 'left', 3.0, 'I', 8.0, False, False, 45, 270)}
    AIP['EGCC'] = {'05L': ('ALSF-II', 914, 'right', 3.0, 'III', 211.8, True, True, 45, 427),
                   '23R': ('ALSF-II', 914, 'left', 3.0, 'III', 249.1, True, True, 45, 183),
                   '05R': ('ALSF-I', 900, 'left', 3.0, 'I', 186.3, False, True, 45, 0),
                   '23L': ('ALSF-I', 900, 'left', 3.0, None, 227.0, False, True, 45, 186)}
    PUBLISHED_MAG['EKCH'] = {'04L': 37.2, '22R': 217.2, '04R': 37.2, '22L': 217.2, '12': 119.2, '30': 299.2}
    # EGCC: AD 2.12's true less AD 2.2's 0.45 E (notes only)
    PUBLISHED_MAG['EGCC'] = {'05L': 50.61, '23R': 230.64, '05R': 50.59, '23L': 230.62}
    # AD 2.12's THR PSN: the landing thresholds (EKCH's 22R, 12 and 30 and EGCC's 05L, 23R and 23L displaced)
    AIP_THR['EKCH'] = {'04L': ('553531.92N', '0123612.73E'), '22R': ('553644.92N', '0123805.61E'),
                       '04R': ('553611.16N', '0123758.97E'), '22L': ('553731.48N', '0124003.29E'),
                       '12': ('553726.94N', '0123820.82E'), '30': ('553649.87N', '0124001.01E')}
    AIP_THR['EGCC'] = {'05L': ('532051.20N', '0021715.95W'), '23R': ('532140.75N', '0021533.41W'),
                       '05R': ('531955.11N', '0021838.38W'), '23L': ('532053.35N', '0021637.94W')}
    # LPPT: both ends at the outer ends of OSM's unnamed displaced-threshold ways (4705313, 735019509), trimmed to 3,810 m.
    THR_AT.update({('LPPT', '02'): (38.7656981, -9.1442833), ('LPPT', '20'): (38.7972732, -9.1273921)})
    THR_LEN[('LPPT', '02/20')] = 3810
    # EKCH and EGCC: each end at AD 2.12's landing threshold moved out along the runway by its displacement (times the
    # frame's scale), then both trimmed evenly to the pavement's length (as Gatwick's).
    for _ic, _pairs in (('EKCH', (('04L', '22R'), ('04R', '22L'), ('12', '30'))), ('EGCC', (('05L', '23R'), ('05R', '23L')))):
        for _a, _b in _pairs:
            _pa = np.array(to_map(*(_dms_signed(s) for s in AIP_THR[_ic][_a])), float)
            _pb = np.array(to_map(*(_dms_signed(s) for s in AIP_THR[_ic][_b])), float)
            _u = (_pa - _pb) / np.hypot(*(_pa - _pb))
            for _e, _p, _s in ((_a, _pa, 1.0), (_b, _pb, -1.0)):
                _k = frame_scale(*(float(v) for v in to_geo(*_p)))
                THR_AT[(_ic, _e)] = tuple(float(v) for v in to_geo(*(_p + _s * _u * AIP[_ic][_e][9] * _k)))
    THR_LEN.update({('EKCH', '04L/22R'): 3571, ('EKCH', '04R/22L'): 3302, ('EKCH', '12/30'): 2800,
                    ('EGCC', '05L/23R'): 3048, ('EGCC', '05R/23L'): 3050})
    ICAOS = list(NAMES)

# - v0.7.1, Vienna (LOWW, austria-261121): box cut by /tmp/flight-sim/v071/airports/osm/extract2.sh (16.51,48.08,16.63,
#   48.15). Austria's eAIP (Austro Control, AIP Austria AD 2 LOWW, AMDT 358 of 02 OCT 2026, the edition valid 30 OCT
#   2026; no page kept in the repository): AD 2.12 11/29 3500 x 45, 16/34 3600 x 45, true 115.92 / 295.95, 164.18 /
#   344.19; THR elevations 175 / 183 / 182 / 179 m; no displacement (AD 2.13 LDA = TORA). AD 2.14: PALS CAT I at 11 and
#   34 (the game's ALSF-I), PALS CAT II/III at 29 and 16 (ALSF-II; 900 m from AD 2.14's remarks: strobes "in full LEN
#   of 900 M"), PAPI 3.1 deg at 11, 3.0 deg at 29, 16, 34 (side not stated: left [EST]); TDZ 900 m at 29 and 16;
#   centreline lights at all four. AD 2.12 remarks and AD 2.20 1.7: RWY type 11 and 34 CAT I, 29 and 16 CAT III.
#   AD 2.2: MAG VAR 5 deg E (JAN 2022). AD 2.17: transition altitude 10000 ft (ENR 1.7 2.1.4 the same for FIR Wien).
if EUROPE:
    NAMES['LOWW'] = ('Vienna', 'Vienna International Airport')
    OSM_DIRS['LOWW'] = '/tmp/flight-sim/v071/airports/osm'
    NOTES_DIRS['LOWW'] = '/tmp/flight-sim/v071/airports'
    AIP_SOURCE['LOWW'] = "Austria's eAIP (Austro Control), AD 2 LOWW (AMDT 358, 02 OCT 2026) AD 2.2, 2.12-2.14, 2.17 and 2.20"
    AIP['LOWW'] = {'11': ('ALSF-I', 900, 'left', 3.1, 'I', 574.1, False, True, 45, 0),
                   '29': ('ALSF-II', 900, 'left', 3.0, 'III', 600.4, True, True, 45, 0),
                   '16': ('ALSF-II', 900, 'left', 3.0, 'III', 597.1, True, True, 45, 0),
                   '34': ('ALSF-I', 900, 'left', 3.0, 'I', 587.3, False, True, 45, 0)}
    # AD 2.12's TRUE BRG less AD 2.2's 5 deg E (JAN 2022) (notes only)
    PUBLISHED_MAG['LOWW'] = {'11': 110.92, '29': 290.95, '16': 159.18, '34': 339.19}
    AIP_THR['LOWW'] = {'11': ('480722.13N', '0163200.09E'), '29': ('480632.57N', '0163432.27E'),
                       '16': ('480711.22N', '0163441.40E'), '34': ('480519.07N', '0163528.82E')}
    THR_AT.update({('LOWW', e): (_dms_signed(la), _dms_signed(lo)) for e, (la, lo) in AIP_THR['LOWW'].items()})
    THR_LEN.update({('LOWW', '11/29'): 3500, ('LOWW', '16/34'): 3600})
    HOLD_DROP_M['LOWW'] = 30.0
    ICAOS = list(NAMES)

# - v0.7.1, Brussels (EBBR, belgium-261121): box cut by /tmp/flight-sim/v071/airports/osm/extract2.sh (4.43,50.87,4.54,
#   50.93). Belgium's eAIP (skeyes) refused the automated fetch (HTTP 403): not read, not worked round. Every value
#   [EST]: the runways OSM's (07L/25R, 07R/25L, 01/19), lengths and widths OurAirports' (11,936 x 148, 10,535 x 148,
#   9,800 x 164 ft); the thresholds' elevations OurAirports', the displacements OSM's (07L 287 m, 25R 297 m, 07R 117 m, 01
#   44 m, 19 218 m); the lights and ILS general knowledge of the field: ILS CAT III to 25L and 25R, CAT I to 07L, 07R
#   and 01, none to 19; 900 m approach lights but at 19; PAPI left 3 deg; TDZ at 25L and 25R; centreline lights.
if EUROPE:
    NAMES['EBBR'] = ('Brussels', 'Brussels Airport')
    OSM_DIRS['EBBR'] = '/tmp/flight-sim/v071/airports/osm'
    NOTES_DIRS['EBBR'] = '/tmp/flight-sim/v071/airports'
    AIP_SOURCE['EBBR'] = ("no AIP (skeyes's eAIP refused the automated fetch): OurAirports' elevations and displacements, "
                          "OSM's lengths, the lights and ILS from general knowledge of the field, all [EST]")
    AIP['EBBR'] = {'07L': ('ALSF-I', 900, 'left', 3.0, 'I', 129.0, False, True, 45, 287),
                   '25R': ('ALSF-II', 900, 'left', 3.0, 'III', 110.0, True, True, 45, 297),
                   '07R': ('ALSF-I', 900, 'left', 3.0, 'I', 175.0, False, True, 45, 117),
                   '25L': ('ALSF-II', 900, 'left', 3.0, 'III', 159.0, True, True, 45, 0),
                   '01': ('ALSF-I', 900, 'left', 3.0, 'I', 183.0, False, True, 50, 44),
                   # 19's elevation, [EST]: 110.2 ft at its pavement end. OurAirports' 113 ft is the threshold's, and 19's
                   # threshold is displaced 218 m: it lies south of 07L/25R, which 01/19's north end crosses. The game puts
                   # an end's elevation at the pavement end, here a stub 15 m long north of 07L/25R's edge, which is level
                   # with that runway (33.58 m, 110.2 ft); at the threshold itself the bent profile reads 112.8 ft.
                   # (v0.7.1 to v0.7.3: 108.4 ft, so that 01/19's straight profile met 07L/25R's height, the game then
                   # bending a runway to one longer runway only; v0.7.4 bends it to both: runwayCrossings() in
                   # src/world/runways.js. With 113 ft at the pavement end the stub was a 5 % ramp.)
                   '19': (None, 0, 'left', 3.0, None, 110.2, False, True, 50, 218)}
    # Every ref'd way stops at a displaced threshold: each end at the outer end of OSM's unnamed displaced_threshold way
    # (517469019 to 517469023: 07L 287 m, 25R 297 m, 19 218 m, 01 44 m, 07R 117 m, the displacements baked), 25L at the
    # ref'd way's end; each runway trimmed evenly to OurAirports' length.
    THR_AT.update({('EBBR', '07L'): (50.8990642, 4.4562222), ('EBBR', '25R'): (50.9126584, 4.5032412),
                   ('EBBR', '19'): (50.9129178, 4.5020199), ('EBBR', '01'): (50.8869319, 4.4914142),
                   ('EBBR', '07R'): (50.8890472, 4.4804664)})
    THR_LEN.update({('EBBR', '07L/25R'): 3638, ('EBBR', '07R/25L'): 3211, ('EBBR', '01/19'): 2987})
    HOLD_DROP_M['EBBR'] = 30.0
    ICAOS = list(NAMES)

# - v0.7.1, Dublin (EIDW, ireland-and-northern-ireland-261121; west of Greenwich): box cut by /tmp/flight-sim/v071/
#   airports/osm/extract2.sh (-6.34,53.40,-6.20,53.46). Ireland's eAIP (AirNav Ireland, AIRAC 29 OCT 2026, EI AD 2 EIDW
#   and ENR 1.7, read as HTML; no page kept in the repository): AD 2.12 10R/28L 2637 x 45, 10L/28R 3109 x 45, 16/34
#   2072 x 45, true 095.24 / 275.27, 095.25 / 275.28, 156.59 / 336.60; THR elevations 243 / 203 / 235 / 213 / 218 /
#   202 ft; THR co-ordinates the landing thresholds, RWY end co-ordinates the pavement's ends. AD 2.13: 10L displaced
#   280 m, 28R 450 m. AD 2.14: 900 m approach lights CAT II/III at 10R, 28L, 10L, 28R (ALSF-II), 910 m at 16 (ALSF-I),
#   SALS 426 m at 34 (the game's SSALF); PAPI 3 deg both sides (28R right only); TDZ 900 m and centreline lights on the
#   parallels only. AD 2.19: ILS CAT III to the four parallel ends, CAT I to 16, none to 34; MAG VAR 1 deg W (2025).
#   AD 2.17: transition altitude 5000 ft (ENR 1.7 2.1.3's table the same).
if EUROPE:
    NAMES['EIDW'] = ('Dublin', 'Dublin Airport')
    OSM_DIRS['EIDW'] = '/tmp/flight-sim/v071/airports/osm'
    NOTES_DIRS['EIDW'] = '/tmp/flight-sim/v071/airports'
    AIP_SOURCE['EIDW'] = "Ireland's eAIP (AirNav Ireland), AD 2 EIDW (AIRAC 29 OCT 2026) AD 2.2, 2.12-2.14, 2.17, 2.19 and 2.20"
    AIP['EIDW'] = {'10R': ('ALSF-II', 900, 'both', 3.0, 'III', 243.0, True, True, 45, 0),
                   '28L': ('ALSF-II', 900, 'both', 3.0, 'III', 203.0, True, True, 45, 0),
                   '10L': ('ALSF-II', 900, 'both', 3.0, 'III', 235.0, True, True, 45, 280),
                   '28R': ('ALSF-II', 900, 'right', 3.0, 'III', 213.0, True, True, 45, 450),
                   '16': ('ALSF-I', 910, 'both', 3.0, 'I', 218.0, False, False, 45, 0),
                   '34': ('SSALF', 426, 'both', 3.0, None, 202.0, False, False, 45, 0)}
    # AD 2.12's TRUE BRG plus AD 2.2's 1 deg W (2025) (notes only)
    PUBLISHED_MAG['EIDW'] = {'10R': 96.24, '28L': 276.27, '10L': 96.25, '28R': 276.28, '16': 157.59, '34': 337.60}
    AIP_THR['EIDW'] = {'10R': ('532520.75N', '0061724.27W'), '28L': ('532512.94N', '0061502.08W'),
                       '10L': ('532613.79N', '0061650.22W'), '28R': ('532606.73N', '0061441.87W'),
                       '16': ('532613.16N', '0061543.12W'), '34': ('532511.66N', '0061458.54W')}
    # Each end at AD 2.12's RWY end co-ordinates (the pavement's ends: 10L's and 28R's outside their displaced
    # thresholds), then trimmed evenly to AD 2.12's length.
    _EIDW_END = {'10R': ('532520.75N', '0061724.27W'), '28L': ('532512.94N', '0061502.08W'),
                 '10L': ('532614.62N', '0061705.32W'), '28R': ('532605.39N', '0061417.60W'),
                 '16': ('532613.16N', '0061543.12W'), '34': ('532511.66N', '0061458.54W')}
    THR_AT.update({('EIDW', e): (_dms_signed(la), _dms_signed(lo)) for e, (la, lo) in _EIDW_END.items()})
    THR_LEN.update({('EIDW', '10R/28L'): 2637, ('EIDW', '10L/28R'): 3109, ('EIDW', '16/34'): 2072})
    HOLD_DROP_M['EIDW'] = 30.0
    ICAOS = list(NAMES)


# - v0.7.2, airports subagent A: Duesseldorf (EDDL, duesseldorf-regbez-261121), Cologne Bonn (EDDK, koeln-regbez-261121),
#   Prague (LKPR, czech-republic-261121), Geneva (LSGG, switzerland-261121) and Nice (LFMN, provence-alpes-cote-d-azur-
#   261121): boxes cut by /tmp/flight-sim/v072/airports/osm/extract-a.sh. No page kept in the repository.
#   - EDDL, Germany's DFS AIP IFR (BasicIFR 2026OCT29, page images read by eye): AD 2.12 (1-6) 05L/23R 2700 x 45, 05R/23L
#     2997 x 45, true 052.80 / 232.80; THR elevations 115.7 / 123.2 / 119.9 / 137.7 ft; the THR co-ordinates the landing
#     thresholds (OSM's ref'd ways end there; OSM's unnamed runway ways beyond them, 297 to 302 m, are the displaced
#     parts). AD 2.13 (1-7): LDA 2400 at 05L and 23R (300 m displaced), 2696 at 05R and 23L (301 m). AD 2.14 (1-8): ALSAF
#     at all four (length not stated: ALSF-II 900 m [EST]), PAPI 3.0 deg (side not stated: left [EST]), TDZ at 23R, 05R
#     and 23L, centreline lights at all four. AD 2.19 (1-11): ILS CAT I to 05L, CAT III to 05R, 23L and 23R; MAG VAR
#     3 deg E (2024). AD 2.17 (1-9): transition altitude 5000 ft MSL.
#   - EDDK: the AIP's and OSM's designators are still 13L/31R and 13R/31L (not 14/32). AD 2.12 (1-8) 06/24 2459 x 45, 13L/31R
#     3815 x 60, 13R/31L 1863 x 45, true 064.40 / 244.40 and 137.50 / 317.50; THR elevations 229.1 / 270.7 / 228.8 / 300.3
#     / 219.9 / 257.9 ft; AD 2.13 (1-9) LDA = TORA at all six: the thresholds are the runway ends. AD 2.14 (1-10): SALS at
#     06, 13R and 31L (length not stated: 420 m [EST]), ALSAF at 24, 13L and 31R (ALSF-II 900 m [EST]); PAPI 3.0 deg (left
#     [EST]); TDZ at 24, 13L and 31R; centreline lights at all six. AD 2.19 (1-13, 1-14): ILS CAT III to 13L and 31R, CAT I
#     to 24 (none listed for 06, 13R, 31L); MAG VAR 3 deg E (2024). AD 2.17 (1-12): 5000 ft.
#   - LKPR, Czechia's AIP (ANS CR, aim.rlp.cz, AD 2-LKPR text PDF): AD 2.12 06/24 3715 x 45, 12/30 3250 x 45, true 065 /
#     245 and 127 / 307 (MAG 060 / 240, 122 / 302); THR elevations 1202.1 / 1157.5 / 1160.1 / 1231.9 ft; AD 2.13 no
#     displacement. AD 2.14: 06 CAT I 480 m, 24 CAT II/III 900 m with TDZ 900 m, 12 SALS 420 m (the game's SSALF), 30 CAT I
#     900 m; PAPI left 3 deg at all four; centreline lights on 06/24 only. AD 2.19: ILS CAT I to 06, 12 and 30, CAT III to
#     24. AD 2.17: transition altitude 5000 ft AMSL (ENR 1.7 1.7.2.2.1 the same for the FIR). OSM's grass 05/23 (450 x 30,
#     a strip south-west of the field) is no runway of the airport's AIP: left out (RUNWAY_SKIP).
#   - LSGG: skyguide's eAIP asks for a login: not read. Every value [EST]: OSM's runway (04/22; its unnamed runway way of
#     343 m before 04 the displaced part), OurAirports' 3900 x 50 m (12,795 x 164 ft), elevations 1411 / 1365 ft and 04's
#     displacement 330 m (1,082 ft); lights and ILS from general knowledge of the field (CAT III to 22, CAT I to 04, 900 m
#     approach lights at both, TDZ at 22). The grass runway beside it is not baked.
#   - LFMN, France's SIA eAIP (AD 2 LFMN, AIRAC 29 OCT 2026, read as HTML): AD 2.12 04L/22R 2628 x 45, 04R/22L 2963 x 45,
#     true 044.95 (MAG 042) / 224.96 (222), 044.95 / 224.97; THR elevations 9.7 / 9.7 / 9.8 / 11.4 ft; the THR co-ordinates
#     the runway ends, 04L's and 22R's DTHR beside them (90 m and 58 m in). AD 2.13: LDA 2538 at 04L, 2480 at 22R (its
#     declared distances end 90 m short of 04L's end, the starter extension). AD 2.14: no approach lights at any end; PAPI 3.0 deg at 04L and 04R, 3.2 deg at 22R and 22L (side not
#     stated: left [EST]); no TDZ lights; centreline lights on both. AD 2.19: LOC 04L CAT I (I.B.1, offset from the axis),
#     LOC 04R with no category (the game: none). AD 2.20: transition altitude 5000 ft (NICE TMA).
if EUROPE:
    for _i, _n in (('EDDL', ('Düsseldorf', 'Düsseldorf Airport')), ('EDDK', ('Cologne Bonn', 'Cologne Bonn Airport')),
                   ('LKPR', ('Prague', 'Václav Havel Airport Prague')), ('LSGG', ('Geneva', 'Geneva Airport')),
                   ('LFMN', ('Nice', "Nice Côte d'Azur Airport"))):
        NAMES[_i] = _n
        OSM_DIRS[_i] = '/tmp/flight-sim/v072/airports/osm'
        NOTES_DIRS[_i] = '/tmp/flight-sim/v072/airports'
        HOLD_DROP_M[_i] = 30.0
    AIP_SOURCE['EDDL'] = "Germany's DFS AIP IFR, AD 2 EDDL (effective 29 OCT 2026) AD 2.12-2.14, 2.17 and 2.19"
    AIP_SOURCE['EDDK'] = "Germany's DFS AIP IFR, AD 2 EDDK (effective 29 OCT 2026) AD 2.12-2.14, 2.17 and 2.19"
    AIP_SOURCE['LKPR'] = "Czechia's AIP (ANS CR), AD 2 LKPR AD 2.12-2.14, 2.17, 2.19 and 2.21"
    AIP_SOURCE['LSGG'] = ("no AIP (skyguide's eAIP asks for a login): OurAirports' length, elevations and displacement, "
                          "OSM's runway, the lights and ILS from general knowledge of the field, all [EST]")
    AIP_SOURCE['LFMN'] = "France's SIA eAIP, AD 2 LFMN (AIRAC 29 OCT 2026) AD 2.12-2.14, 2.19 and 2.20"
    AIP['EDDL'] = {'05L': ('ALSF-II', 900, 'left', 3.0, 'I', 115.7, False, True, 45, 300),
                   '23R': ('ALSF-II', 900, 'left', 3.0, 'III', 123.2, True, True, 45, 300),
                   '05R': ('ALSF-II', 900, 'left', 3.0, 'III', 119.9, True, True, 45, 301),
                   '23L': ('ALSF-II', 900, 'left', 3.0, 'III', 137.7, True, True, 45, 301)}
    AIP['EDDK'] = {'06': ('SSALF', 420, 'left', 3.0, None, 229.1, False, True, 45, 0),
                   '24': ('ALSF-II', 900, 'left', 3.0, 'I', 270.7, True, True, 45, 0),
                   '13L': ('ALSF-II', 900, 'left', 3.0, 'III', 228.8, True, True, 60, 0),
                   '31R': ('ALSF-II', 900, 'left', 3.0, 'III', 300.3, True, True, 60, 0),
                   '13R': ('SSALF', 420, 'left', 3.0, None, 219.9, False, True, 45, 0),
                   '31L': ('SSALF', 420, 'left', 3.0, None, 257.9, False, True, 45, 0)}
    AIP['LKPR'] = {'06': ('ALSF-I', 480, 'left', 3.0, 'I', 1202.1, False, True, 45, 0),
                   '24': ('ALSF-II', 900, 'left', 3.0, 'III', 1157.5, True, True, 45, 0),
                   '12': ('SSALF', 420, 'left', 3.0, 'I', 1160.1, False, False, 45, 0),
                   '30': ('ALSF-I', 900, 'left', 3.0, 'I', 1231.9, False, False, 45, 0)}
    AIP['LSGG'] = {'04': ('ALSF-I', 900, 'left', 3.0, 'I', 1411.0, False, True, 50, 330),
                   '22': ('ALSF-II', 900, 'left', 3.0, 'III', 1365.0, True, True, 50, 0)}
    AIP['LFMN'] = {'04L': (None, 0, 'left', 3.0, 'I', 9.7, False, True, 45, 90),
                   '22R': (None, 0, 'left', 3.2, None, 9.7, False, True, 45, 58),
                   '04R': (None, 0, 'left', 3.0, None, 9.8, False, True, 45, 0),
                   '22L': (None, 0, 'left', 3.2, None, 11.4, False, True, 45, 0)}
    # the published magnetic: EDDL and EDDK AD 2.12's TRUE BRG less AD 2.19's 3 deg E (2024); LKPR and LFMN AD 2.12's MAG
    PUBLISHED_MAG['EDDL'] = {'05L': 49.80, '23R': 229.80, '05R': 49.80, '23L': 229.80}
    PUBLISHED_MAG['EDDK'] = {'06': 61.40, '24': 241.40, '13L': 134.50, '31R': 314.50, '13R': 134.50, '31L': 314.50}
    PUBLISHED_MAG['LKPR'] = {'06': 60.0, '24': 240.0, '12': 122.0, '30': 302.0}
    PUBLISHED_MAG['LFMN'] = {'04L': 42.0, '22R': 222.0, '04R': 42.0, '22L': 222.0}
    AIP_THR['EDDL'] = {'05L': ('511707.132N', '0064507.643E'), '23R': ('511748.248N', '0064633.931E'),
                       '05R': ('511652.445N', '0064519.467E'), '23L': ('511739.431N', '0064658.073E')}
    AIP_THR['EDDK'] = {'06': ('505136.438N', '0070725.605E'), '24': ('505210.811N', '0070918.976E'),
                       '13L': ('505249.688N', '0070744.668E'), '31R': ('505118.699N', '0070956.491E'),
                       '13R': ('505215.043N', '0070715.101E'), '31L': ('505130.615N', '0070819.468E')}
    AIP_THR['LKPR'] = {'06': ('500606.61N', '0141334.68E'), '24': ('500657.42N', '0141624.12E'),
                       '12': ('500628.84N', '0141443.32E'), '30': ('500525.68N', '0141654.02E')}
    AIP_THR['LFMN'] = {'04L': ('433906.51N', '0071214.55E'), '22R': ('434006.76N', '0071337.42E'),
                       '04R': ('433848.26N', '0071208.97E'), '22L': ('433956.19N', '0071342.40E')}
    # EDDL: each end at the outer end of OSM's unnamed runway way (the displaced part), trimmed evenly to AD 2.12's length.
    # LSGG: 04 at the outer end of OSM's unnamed way, 22 at the ref'd way's end, trimmed evenly to OurAirports' 3900 m.
    # EDDK, LKPR and LFMN: each end at AD 2.12's threshold (the runway's end), trimmed evenly to AD 2.12's length.
    THR_AT.update({('EDDL', '05L'): (51.28365, 6.748638), ('EDDL', '23R'): (51.298365, 6.779516),
                   ('EDDL', '05R'): (51.279609, 6.751993), ('EDDL', '23L'): (51.29591, 6.786211),
                   ('LSGG', '04'): (46.22565, 6.090765), ('LSGG', '22'): (46.250405, 6.127082)})
    for _ic in ('EDDK', 'LKPR', 'LFMN'):
        THR_AT.update({(_ic, e): (_dms_signed(la), _dms_signed(lo)) for e, (la, lo) in AIP_THR[_ic].items()})
    THR_LEN.update({('EDDL', '05L/23R'): 2700, ('EDDL', '05R/23L'): 2997, ('EDDK', '06/24'): 2459,
                    ('EDDK', '13L/31R'): 3815, ('EDDK', '13R/31L'): 1863, ('LKPR', '06/24'): 3715,
                    ('LKPR', '12/30'): 3250, ('LSGG', '04/22'): 3900, ('LFMN', '04L/22R'): 2628, ('LFMN', '04R/22L'): 2963})
    RUNWAY_SKIP.add(('LKPR', '05/23'))
    # LFMN K26C: on the Kilo apron's edge by the shore, where the field's flattening meets the ground (1.6 m across 40 m)
    STAND_DROP['LFMN'] = ({'K26C', '2', '3', '4', '6', '8', '10', '12', '15'},
                          "K26C on the Kilo apron's edge, where the field's flattening meets the shore (1.6 m across 40 m); "
                          "2 to 15 on OSM taxi lines joined to nothing else: no route to any runway")
    STAND_DROP_NUMBERED['LKPR'] = ({'R2', 'R3', 'R4', 'R5', 'R6'}, "unnamed OSM stands on taxi lines joined to nothing else: no route to any runway")
    ICAOS = list(NAMES)


# - v0.7.2, airports subagent B: Edinburgh (EGPH) and Glasgow (EGPF, both scotland-261121), Nantes (LFRS,
#   pays-de-la-loire-261121) and Santiago (LEST, galicia-261121): boxes cut by /tmp/flight-sim/v072/airports/osm/
#   extract-b.sh. No page kept in the repository.
#   - EGPH, the UK's NATS eAIP (EG AD 2 EGPH, AIRAC 29 OCT 2026): AD 2.12 06/24 2558 x 45, true 058.85 / 238.88; THR
#     (inset 214 m at 06, 211 m at 24) elevations 110.1 / 99.8 ft. 12/30 is no longer published. AD 2.14: coded centre-
#     line with five crossbars 870 m at 06, 914 m at 24 (CAT III: the game's ALSF-II); PAPI left 3 deg; TDZ and centreline
#     lights at both. AD 2.19: ILS CAT III to 06 and 24; MAG VAR 0.24 / 0.25 W (2027). AD 2.17: transition altitude 6000 FT.
#   - EGPF, NATS (EG AD 2 EGPF): AD 2.12 05/23 2661 x 45, true 046.40 / 226.42; 23's threshold displaced 304 m; THR
#     elevations 26.1 / 20.8 ft. AD 2.14: coded centre-line with five crossbars 914 m at both (CAT III: ALSF-II); PAPI left
#     3 deg; TDZ and centreline lights at both. AD 2.19: ILS CAT III to 05 and 23; MAG VAR 0.65 / 0.66 W (2027). AD 2.17:
#     transition altitude 6000 FT. AD 2.20: a full-length take-off on 23 back-tracks the runway (no taxiway to 23's end).
#   - LFRS, France's SIA eAIP (AD 2 LFRS, AIRAC 29 OCT 2026): AD 2.12 03/21 2853 x 45, true 027.44 (MAG 028) / 207.44
#     (208); THR 03 at the runway end, 21's position GEO the runway end with its DTHR beside it (AD 2.13 LDA 2591: 262 m);
#     THR elevations 73 / 83 ft. AD 2.14: 03 CAT I-II-III 900 m (ALSF-II), 21 420 m (SSALF); PAPI 3.0 deg at 03, 3.1 at 21
#     (side not stated: left [EST]); TDZ 900 m at 03 only; centreline lights on both. AD 2.19: LOC 03 III.E.4, none to 21.
#     AD 2.20 20.2: transition altitude 5000 ft (NANTES TMA).
#   - LEST, Spain's ENAIRE AIP (AD 2-LEST, WEF 29-OCT-26): AD 2.12 17/35, TORA 3140 / 3170 x 45, true 166.15 (MAG 167) /
#     346.16 (347); DTHR 17 120 m and DTHR 35 150 m from each take-off run's beginning (AD 2.13's coordinates); THR
#     elevations 1170 / 1200 ft. The pavement between the two take-off starts: 3200 m (the edge lights' 3200 m, AD 2.14).
#     AD 2.14: 17 precision CAT II/III 900 m (ALSF-II), TDZ 900 m; 35 precision CAT I 420 m (ALSF-I, provisional); PAPI 3
#     deg (side not stated: left [EST]); centreline lights on both. AD 2.19: ILS CAT III to 17, CAT I to 35. AD 2.17:
#     transition altitude 1850 m / 6000 ft (CTR SANTIAGO).
if EUROPE:
    for _i, _n in (('EGPH', ('Edinburgh', 'Edinburgh Airport')), ('EGPF', ('Glasgow', 'Glasgow Airport')),
                   ('LFRS', ('Nantes', 'Nantes Atlantique Airport')),
                   ('LEST', ('Santiago', 'Santiago–Rosalía de Castro Airport'))):
        NAMES[_i] = _n
        OSM_DIRS[_i] = '/tmp/flight-sim/v072/airports/osm'
        NOTES_DIRS[_i] = '/tmp/flight-sim/v072/airports'
        HOLD_DROP_M[_i] = 30.0
    AIP_SOURCE['EGPH'] = "the UK's NATS eAIP, EG AD 2 EGPH (AIRAC 29 OCT 2026) AD 2.12-2.14, 2.17, 2.19 and 2.20"
    AIP_SOURCE['EGPF'] = "the UK's NATS eAIP, EG AD 2 EGPF (AIRAC 29 OCT 2026) AD 2.12-2.14, 2.17, 2.19 and 2.20"
    AIP_SOURCE['LFRS'] = "France's SIA eAIP, AD 2 LFRS (AIRAC 29 OCT 2026) AD 2.12-2.14, 2.19-2.21"
    AIP_SOURCE['LEST'] = "Spain's ENAIRE AIP, AD 2-LEST (WEF 29-OCT-26) AD 2.12-2.14, 2.17, 2.19 and 2.20"
    AIP['EGPH'] = {'06': ('ALSF-II', 870, 'left', 3.0, 'III', 110.1, True, True, 45, 214),
                   '24': ('ALSF-II', 914, 'left', 3.0, 'III', 99.8, True, True, 45, 211)}
    AIP['EGPF'] = {'05': ('ALSF-II', 914, 'left', 3.0, 'III', 26.1, True, True, 45, 0),
                   '23': ('ALSF-II', 914, 'left', 3.0, 'III', 20.8, True, True, 45, 304)}
    AIP['LFRS'] = {'03': ('ALSF-II', 900, 'left', 3.0, 'III', 73.0, True, True, 45, 0),
                   '21': ('SSALF', 420, 'left', 3.1, None, 83.0, False, True, 45, 262)}
    AIP['LEST'] = {'17': ('ALSF-II', 900, 'left', 3.0, 'III', 1170.0, True, True, 45, 120),
                   '35': ('ALSF-I', 420, 'left', 3.0, 'I', 1200.0, False, True, 45, 150)}
    # EGPH, EGPF: AD 2.12's true plus AD 2.19's west variation (notes only); LFRS and LEST: AD 2.12's MAG
    PUBLISHED_MAG['EGPH'] = {'06': 59.09, '24': 239.13}
    PUBLISHED_MAG['EGPF'] = {'05': 47.05, '23': 227.08}
    PUBLISHED_MAG['LFRS'] = {'03': 28.0, '21': 208.0}
    PUBLISHED_MAG['LEST'] = {'17': 167.0, '35': 347.0}
    # EGPH, EGPF: AD 2.12's THR PSN, the landing thresholds; LFRS: the runway ends (21's DTHR listed beside it); LEST:
    # AD 2.13's beginnings of the take-off runs (the pavement's ends)
    AIP_THR['EGPH'] = {'06': ('555641.99N', '0032313.90W'), '24': ('555717.66N', '0032128.66W')}
    AIP_THR['EGPF'] = {'05': ('555148.53N', '0042656.59W'), '23': ('555241.07N', '0042518.43W')}
    AIP_THR['LFRS'] = {'03': ('470829.77N', '0013710.36W'), '21': ('470951.73N', '0013607.95W')}
    AIP_THR['LEST'] = {'17': ('425442.47N', '0082513.18W'), '35': ('425301.77N', '0082439.42W')}
    # EGPH and EGPF: each end at AD 2.12's landing threshold moved out along the runway by its displacement (times the
    # frame's scale), then trimmed evenly to AD 2.12's length (as Manchester's). LFRS and LEST: each end at the AIP's
    # coordinates above, trimmed evenly to the length.
    for _ic, _a, _b in (('EGPH', '06', '24'), ('EGPF', '05', '23')):
        _pa = np.array(to_map(*(_dms_signed(s) for s in AIP_THR[_ic][_a])), float)
        _pb = np.array(to_map(*(_dms_signed(s) for s in AIP_THR[_ic][_b])), float)
        _u = (_pa - _pb) / np.hypot(*(_pa - _pb))
        for _e, _p, _s in ((_a, _pa, 1.0), (_b, _pb, -1.0)):
            _k = frame_scale(*(float(v) for v in to_geo(*_p)))
            THR_AT[(_ic, _e)] = tuple(float(v) for v in to_geo(*(_p + _s * _u * AIP[_ic][_e][9] * _k)))
    for _ic in ('LFRS', 'LEST'):
        THR_AT.update({(_ic, e): (_dms_signed(la), _dms_signed(lo)) for e, (la, lo) in AIP_THR[_ic].items()})
    THR_LEN.update({('EGPH', '06/24'): 2558, ('EGPF', '05/23'): 2661, ('LFRS', '03/21'): 2853, ('LEST', '17/35'): 3200})
    # LFRS: OSM maps a second, older set of stands as named points ("Porte 1", "Poste L2", "Parking 7" ...) 16 to 67 m from
    # the ref'd stands with the same numbers: those left out (Porte 3 and Porte 6, with no ref'd twin, are kept)
    STAND_DROP['LFRS'] = ({'Porte 1', 'Porte 2', 'Porte 4', 'Porte 5', 'Porte 5A', 'Poste L2', 'Poste L3', 'Poste L4',
                           'Poste L5', 'Poste 18', 'Parking 7', 'Parking 8', 'Parking 9', 'Parking 10', 'Parking 11A',
                           'Parking 12', 'Parking 14'},
                          "a second, older set of OSM stands mapped as named points beside the ref'd stands of the same numbers")
    ICAOS = list(NAMES)


# - v0.7.3, airports subagent A: Lyon (LFLL, rhone-alpes-261121) and Marseille (LFML, provence-alpes-cote-d-azur-261121):
#   boxes cut by /tmp/flight-sim/v073/airports/osm/extract.sh. No page kept in the repository.
#   - LFLL, France's SIA eAIP (AD 2 LFLL, AIRAC 29 OCT 2026, read as HTML): AD 2.12 17L/35R 2670 x 45, 17R/35L 4000 x 45,
#     true 175.13 / 355.13 and 175.28 / 355.28 (MAG 173 / 353); the THR co-ordinates the runway ends (no DTHR); THR
#     elevations 779.9 / 820.6 / 757.8 / 813.6 ft. AD 2.13: LDA = TORA at all four. AD 2.14: 17L CAT I 900 m (ALSF-I), 35R
#     and 35L CAT III 900 m (ALSF-II) with TDZ 900 m, 17R none; PAPI 3.0 deg at all four (side not stated: left [EST]);
#     centreline lights at all four. AD 2.19: LOC 35R and 35L III.E.4, LOC 17L CAT I, none to 17R. AD 2.20 20.2:
#     transition altitude 5000 ft (LYON TMA).
#   - LFML, France's SIA eAIP (AD 2 LFML): AD 2.12 13L/31R 3500 x 45, 13R/31L 2370 x 45, true 134.47 (MAG 132) / 314.47
#     (312), 135.47 (133) / 315.47 (313); the THR co-ordinates the pavement's ends, the DTHRs beside them: 13L 340 m in
#     (LDA 3160), 31R 660 m (LDA 2780, ending 60 m short of 13L's end), 31L 105 m (LDA 2265), 13R none; elevations at the
#     landing thresholds 8 / 52 / 8 / 61 ft. AD 2.14: 13L a CAT I approach light system of 420 m (AD 2.20 20.5.2: "420 m
#     instead of 900 m"; ALSF-I) with TDZ 900 m, 31R CAT I 900 m (ALSF-I; "simple touchdown zone lights": no TDZ), 13R
#     and 31L runway flashing lights only (none); PAPI 3.0 deg at 13L and 13R, 4.0 deg at 31R and 31L (left [EST]);
#     centreline lights on 13L/31R only. AD 2.19: LOC 13L III.E.4, LOC 13R I.E.1, LOC 31R I.E.1 (GP 4 deg), none to 31L.
#     AD 2.20 20.2: transition altitude 5000 ft (PROVENCE TMA).
if EUROPE:
    for _i, _n in (('LFLL', ('Lyon', 'Lyon-Saint-Exupéry Airport')), ('LFML', ('Marseille', 'Marseille Provence Airport'))):
        NAMES[_i] = _n
        OSM_DIRS[_i] = '/tmp/flight-sim/v073/airports/osm'
        NOTES_DIRS[_i] = '/tmp/flight-sim/v073/airports'
        HOLD_DROP_M[_i] = 30.0
    AIP_SOURCE['LFLL'] = "France's SIA eAIP, AD 2 LFLL (AIRAC 29 OCT 2026) AD 2.12-2.14, 2.19, 2.20 and 2.22"
    AIP_SOURCE['LFML'] = "France's SIA eAIP, AD 2 LFML (AIRAC 29 OCT 2026) AD 2.12-2.14, 2.19-2.21"
    AIP['LFLL'] = {'17L': ('ALSF-I', 900, 'left', 3.0, 'I', 779.9, False, True, 45, 0),
                   '35R': ('ALSF-II', 900, 'left', 3.0, 'III', 820.6, True, True, 45, 0),
                   '17R': (None, 0, 'left', 3.0, None, 757.8, False, True, 45, 0),
                   '35L': ('ALSF-II', 900, 'left', 3.0, 'III', 813.6, True, True, 45, 0)}
    AIP['LFML'] = {'13L': ('ALSF-I', 420, 'left', 3.0, 'III', 8.0, True, True, 45, 340),
                   '31R': ('ALSF-I', 900, 'left', 4.0, 'I', 52.0, False, True, 45, 660),
                   '13R': (None, 0, 'left', 3.0, 'I', 8.0, False, False, 45, 0),
                   '31L': (None, 0, 'left', 4.0, None, 61.0, False, False, 45, 105)}
    PUBLISHED_MAG['LFLL'] = {'17L': 173.0, '35R': 353.0, '17R': 173.0, '35L': 353.0}
    PUBLISHED_MAG['LFML'] = {'13L': 132.0, '31R': 312.0, '13R': 133.0, '31L': 313.0}
    AIP_THR['LFLL'] = {'17L': ('454405.79N', '0050530.73E'), '35R': ('454239.62N', '0050541.21E'),
                       '17R': ('454447.72N', '0050509.38E'), '35L': ('454238.69N', '0050525.08E')}
    AIP_THR['LFML'] = {'13L': ('432656.90N', '0051150.34E'), '31R': ('432538.14N', '0051342.44E'),
                       '13R': ('432627.32N', '0051212.77E'), '31L': ('432533.11N', '0051327.67E')}
    # each end at AD 2.12's position (the pavement's end), trimmed evenly to AD 2.12's length
    for _ic in ('LFLL', 'LFML'):
        THR_AT.update({(_ic, e): (_dms_signed(la), _dms_signed(lo)) for e, (la, lo) in AIP_THR[_ic].items()})
    THR_LEN.update({('LFLL', '17L/35R'): 2670, ('LFLL', '17R/35L'): 4000, ('LFML', '13L/31R'): 3500,
                    ('LFML', '13R/31L'): 2370})
    ICAOS = list(NAMES)


# - v0.7.3, airports subagent A: Hamburg (EDDH, hamburg-261121; box cut by /tmp/flight-sim/v073/airports/osm/extract.sh;
#   Airbus's Finkenwerder plant across the Elbe is outside the box and not this airport). Germany's DFS AIP IFR
#   (BasicIFR 2026OCT29, page images read by eye; no page kept in the repository): AD 2.12 (1-6) 05/23 3250 x 46, 15/33
#   3666 x 46, true 050.30 / 230.30 and 152.80 / 332.80; the co-ordinates the landing thresholds (OSM's ref'd ways end
#   there; OSM's unnamed runway ways beyond 05, 23 and 33, 301, 161 and 447 m, are the displaced parts); THR elevations
#   31.9 / 43.2 / 53.0 / 35.4 ft. AD 2.13 (1-7): LDA 2952 at 05 (298 m displaced), 3094 at 23 (156 m), 3220 at 33 (446 m),
#   3666 at 15. AD 2.14 (1-7, 1-8): ALSAF at all four (length not stated: ALSF-II 900 m [EST]), PAPI 3.0 deg (side not
#   stated: left [EST]), TDZ at 23 only, centreline lights at all four. AD 2.19 (1-11): ILS CAT I to 05 and 15, CAT III to
#   23, none to 33; MAG VAR 4 deg E (2025). AD 2.17 (1-9): transition altitude 5000 ft MSL. 05/23 crosses 15/33.
#   Lyon: STAND_DROP B61 (below).
if EUROPE:
    NAMES['EDDH'] = ('Hamburg', 'Hamburg Airport')
    OSM_DIRS['EDDH'] = '/tmp/flight-sim/v073/airports/osm'
    NOTES_DIRS['EDDH'] = '/tmp/flight-sim/v073/airports'
    HOLD_DROP_M['EDDH'] = 30.0
    AIP_SOURCE['EDDH'] = "Germany's DFS AIP IFR, AD 2 EDDH (effective 29 OCT 2026) AD 2.12-2.14, 2.17, 2.19 and 2.20"
    AIP['EDDH'] = {'05': ('ALSF-II', 900, 'left', 3.0, 'I', 31.9, False, True, 46, 298),
                   '23': ('ALSF-II', 900, 'left', 3.0, 'III', 43.2, True, True, 46, 156),
                   '15': ('ALSF-II', 900, 'left', 3.0, 'I', 53.0, False, True, 46, 0),
                   '33': ('ALSF-II', 900, 'left', 3.0, None, 35.4, False, True, 46, 446)}
    # the published magnetic: AD 2.12's TRUE BRG less AD 2.19's 4 deg E (2025)
    PUBLISHED_MAG['EDDH'] = {'05': 46.30, '23': 226.30, '15': 148.80, '33': 328.80}
    AIP_THR['EDDH'] = {'05': ('533711.851N', '0095801.795E'), '23': ('533809.638N', '0095958.755E'),
                       '15': ('533915.880N', '0095830.759E'), '33': ('533743.248N', '0095950.814E')}
    # each end at the outer end of OSM's unnamed runway way (the displaced part; 15 at its ref'd way's end, no
    # displacement), trimmed evenly to AD 2.12's length
    THR_AT.update({('EDDH', '05'): (53.618234, 9.963667), ('EDDH', '23'): (53.636905, 10.001497),
                   ('EDDH', '15'): (53.654392, 9.975241), ('EDDH', '33'): (53.625118, 10.00053)})
    THR_LEN.update({('EDDH', '05/23'): 3250, ('EDDH', '15/33'): 3666})
    # LFLL: B61 stands on an OSM taxi line joined to nothing else (no route to any runway end)
    STAND_DROP['LFLL'] = ({'B61'}, "on an OSM taxi line joined to nothing else: no route to any runway")
    ICAOS = list(NAMES)


# - v0.7.3, airports subagent A: Innsbruck (LOWI, austria-261121; box cut by /tmp/flight-sim/v073/airports/osm/extract.sh).
#   Austro Control's eAIP (edition 30 OCT 2026, AD 2 LOWI PDF, AMDT 359; read with pypdf, no page kept in the repository):
#   AD 2.12 08/26 2000 x 45, true 080.97 / 260.99; THR 08 47 15 31.97N 011 19 54.11E (the DTHR: "DTHR RWY 08 displaced
#   60 M inward"; OSM's unnamed 59 m runway way before it), THR 26 47 15 41.82N 011 21 25.24E; THR elevations 581 / 577 m
#   (1906.2 / 1893.0 ft); both "Non-precision approach runway". AD 2.13: TORA 2000 / 1940, LDA 1940 at both. AD 2.14: 08 no
#   approach lights, PAPI 3.5 deg "on both sides of RWY 08"; 26 "PALS (ICAO-standard, CAT I), 600 M" (ALSF-I 600 m), PAPI
#   3.5 deg left; "Simple Touchdown Zone Lights" at both (the game: no TDZ); centreline lights on both. AD 2.19: no ILS (the
#   LOC/DME East's localizer OEV 254 deg MAG, 3.5 deg offset from the centreline: the game's none); MAG VAR 4 deg E (AUG
#   2024). AD 2.17: no transition altitude; "Departing aircraft shall consider 10000 FT AMSL as transition altitude".
#   OSM's two grass strips (glider landing area) are unnamed: not read as runways.
if EUROPE:
    NAMES['LOWI'] = ('Innsbruck', 'Innsbruck Airport')
    OSM_DIRS['LOWI'] = '/tmp/flight-sim/v073/airports/osm'
    NOTES_DIRS['LOWI'] = '/tmp/flight-sim/v073/airports'
    HOLD_DROP_M['LOWI'] = 30.0
    AIP_SOURCE['LOWI'] = "Austro Control's eAIP, AD 2 LOWI (effective 30 OCT 2026) AD 2.12-2.14, 2.17, 2.19, 2.20 and 2.22"
    AIP['LOWI'] = {'08': (None, 0, 'both', 3.5, None, 1906.2, False, True, 45, 60),
                   '26': ('ALSF-I', 600, 'left', 3.5, None, 1893.0, False, True, 45, 0)}
    # the published magnetic: AD 2.12's TRUE BRG less AD 2.2's 4 deg E (AUG 2024)
    PUBLISHED_MAG['LOWI'] = {'08': 76.97, '26': 256.99}
    AIP_THR['LOWI'] = {'08': ('471531.97N', '0111954.11E'), '26': ('471541.82N', '0112125.24E')}
    # 08 at the outer end of OSM's unnamed 59 m runway way (the displaced part), 26 at AD 2.12's threshold, trimmed evenly
    # to AD 2.12's length
    THR_AT.update({('LOWI', '08'): (47.258785, 11.330918), ('LOWI', '26'): (_dms_signed('471541.82N'), _dms_signed('0112125.24E'))})
    THR_LEN.update({('LOWI', '08/26'): 2000})
    # OSM maps no stand on the main apron (Hauptvorfeld; its 4 parking nodes are south of the GA apron, outside the
    # aerodrome's polygon): eight stands R1 to R8 placed along the main apron, 45 m apart, each 62 m south of TWY A
    # (OSM 4787983, the apron's northern edge) nosed in towards the terminal at 170.9 deg true (square to the apron's
    # 080.9 deg edge), all [EST]
    STAND_POINTS['LOWI'] = [('R%d' % (_k + 1), _la, _lo, 170.9) for _k, (_la, _lo) in enumerate((
        (47.2579706, 11.3483317), (47.2580361, 11.3489314), (47.2581016, 11.3495312), (47.2581671, 11.3501309),
        (47.2582326, 11.3507307), (47.2582981, 11.3513304), (47.2583636, 11.3519301), (47.2584291, 11.3525299)))]
    STAND_POINTS_REASONS['LOWI'] = ("OSM maps no stand on the main apron: R1 to R8 placed 45 m apart along it, 62 m south of "
                                    "TWY A, nosed in to the terminal at 170.9 deg true [EST]; a 60 m lead-in along each")
    ICAOS = list(NAMES)

# - v0.7.3, airports subagent B: Gibraltar (LXGB, andalucia-261121: Geofabrik's Andalucia holds the airport), Venice
#   (LIPZ, nord-est-261121), Porto (LPPR, portugal-261121) and Naples (LIRN, sud-261121): boxes cut by /tmp/flight-sim/
#   v073/airports/osm/extract-b.sh. No AIP read for any of the four, every AIP value [EST]: the UK Military AIP's
#   aidu.mod.uk site did not answer (no connection), NAV Portugal's eAIP answered 503, Italy's ENAV eAIP asks for a login.
#   Geometry OSM's (live ways only), lengths, elevations and displacements OurAirports' or OSM's as noted, the lights and
#   ILS general knowledge of the fields.
#   - LXGB: 09/27, both ends at the outer ends of OSM's unnamed runway ways (1243640203 before 09, 132 m; 1243640202
#     beyond 27, 97 m), the landing thresholds at OSM's threshold nodes (the displacements 132 / 97 m); no trim: the
#     pavement OSM's 1,755 m (OurAirports' 6,000 ft and OSM's length tag 1,798 m are longer than the mapped pavement).
#     Elevations OurAirports' 10 / 11 ft. No ILS, no approach lights (the sea at both ends), PAPI left 3 deg, no
#     centreline or TDZ lights [EST]. Winston Churchill Avenue crosses the runway (not baked as a road).
#   - LIPZ: 04R/22L and 04L/22R at the ref'd ways' ends, trimmed evenly to OurAirports' 3,300 m and 2,780 m; elevations
#     7 ft; 04L displaced 94 m (OurAirports' 308 ft). ILS CAT III to 04R with 900 m approach lights and TDZ, none to 22L
#     (420 m), none to 04L/22R (the standby runway) [EST].
#   - LPPR: 17/35 at the outer ends of OSM's unnamed ways (515973637 beyond 17, 297 m; 515973635 beyond 35, 151 m),
#     trimmed evenly to OurAirports' 11,417 ft (3,480 m); displacements OSM's threshold nodes (297 / 151 m; OurAirports'
#     300 / 150 m); elevations OurAirports' 151 / 226 ft. ILS CAT III to 17 (900 m, TDZ), CAT I to 35 (900 m) [EST].
#   - LIRN: 06/24 at the outer ends of OSM's unnamed ways (1243391029 before 06, 398 m; 1243391028 beyond 24, 196 m),
#     trimmed evenly to OurAirports' 8,622 ft (2,628 m); displacements OSM's threshold nodes (398 / 196 m; OurAirports'
#     399 / 190 m); elevations OurAirports' 284 / 223 ft. ILS CAT I to 24 (900 m), none to 06 (no approach lights) [EST].
if EUROPE:
    for _i, _n in (('LXGB', ('Gibraltar', 'Gibraltar International Airport')), ('LIPZ', ('Venice', 'Venice Marco Polo Airport')),
                   ('LPPR', ('Porto', 'Francisco Sá Carneiro Airport')), ('LIRN', ('Naples', 'Naples International Airport'))):
        NAMES[_i] = _n
        OSM_DIRS[_i] = '/tmp/flight-sim/v073/airports/osm'
        NOTES_DIRS[_i] = '/tmp/flight-sim/v073/airports'
        HOLD_DROP_M[_i] = 30.0
    AIP_SOURCE['LXGB'] = ("no AIP (the UK Military AIP's site did not answer): OurAirports' elevations, OSM's runway and "
                          "displacements, the lights from general knowledge of the field, all [EST]")
    AIP_SOURCE['LIPZ'] = ("no AIP (Italy's eAIP asks for a login): OurAirports' lengths, elevations and displacement, OSM's "
                          "runways, the lights and ILS from general knowledge of the field, all [EST]")
    AIP_SOURCE['LPPR'] = ("no AIP (NAV Portugal's eAIP answered 503): OurAirports' length and elevations, OSM's runway and "
                          "displacements, the lights and ILS from general knowledge of the field, all [EST]")
    AIP_SOURCE['LIRN'] = ("no AIP (Italy's eAIP asks for a login): OurAirports' length and elevations, OSM's runway and "
                          "displacements, the lights and ILS from general knowledge of the field, all [EST]")
    AIP['LXGB'] = {'09': (None, 0, 'left', 3.0, None, 10.0, False, False, 45, 132),
                   '27': (None, 0, 'left', 3.0, None, 11.0, False, False, 45, 97)}
    AIP['LIPZ'] = {'04R': ('ALSF-II', 900, 'left', 3.0, 'III', 7.0, True, True, 45, 0),
                   '22L': ('SSALF', 420, 'left', 3.0, None, 7.0, False, True, 45, 0),
                   '04L': (None, 0, 'left', 3.0, None, 7.0, False, False, 45, 94),
                   '22R': (None, 0, 'left', 3.0, None, 7.0, False, False, 45, 0)}
    AIP['LPPR'] = {'17': ('ALSF-II', 900, 'left', 3.0, 'III', 151.0, True, True, 45, 297),
                   '35': ('ALSF-I', 900, 'left', 3.0, 'I', 226.0, False, True, 45, 151)}
    AIP['LIRN'] = {'06': (None, 0, 'left', 3.0, None, 284.0, False, True, 45, 398),
                   '24': ('ALSF-I', 900, 'left', 3.0, 'I', 223.0, False, True, 45, 196)}
    THR_AT.update({('LXGB', '09'): (36.150824, -5.359609), ('LXGB', '27'): (36.151511, -5.340078),
                   ('LPPR', '17'): (41.263272, -8.685242), ('LPPR', '35'): (41.232556, -8.677186),
                   ('LIRN', '06'): (40.879778, 14.277541), ('LIRN', '24'): (40.892303, 14.304127),
                   ('LIPZ', '04R'): (45.493999, 12.337549), ('LIPZ', '22L'): (45.51617, 12.366072)})
    THR_LEN.update({('LIPZ', '04R/22L'): 3300, ('LIPZ', '04L/22R'): 2780, ('LPPR', '17/35'): 3480,
                    ('LIRN', '06/24'): 2628})
    ICAOS = list(NAMES)

# ---- v0.7.6 (airports subagent apc): Zaragoza (LEZG), a joint civil and air force field, pending. OSM: OpenStreetMap
#   France's mirror of the Aragon extract (data of 2026-11-19; Geofabrik's aragon path answered 502, then 301 to a 404),
#   its box cut by /tmp/flight-sim/v076/airports/apc/extract.sh. Spain's ENAIRE AIP, AD 2-LEZG (WEF 01-OCT-26, AIRAC AMDT
#   09/26; read with pypdf, no page kept in the repository): AD 2.12 12L/30R 3032 x 45, true 120.03 / 300.05 (MAG 119 /
#   299), 12R/30L 3718 x 45, true 120.00 / 300.03 (MAG 119 / 299); THR PSN at each end, none displaced (AD 2.13: LDA =
#   TORA at all four); THR elevations 823 / 834 / 834 / 862 ft. AD 2.14: 12L "Simple, 427 m" (the game's SSALF), PAPI 2.5
#   deg; 30R "Precision CAT II/III, 600 m" (ALSF-II), PAPI 3 deg, TDZ 900 m; centreline lights on 12L/30R; 12R "Precision
#   CAT I, 581 m" (ALSF-I), PAPI 3 deg; 30L no approach lights, PAPI 3 deg; no TDZ or centreline lights on 12R/30L. PAPI
#   side not stated: left [EST]. AD 2.19: one ILS, LOC 30R IZZA "ILS CAT II/III". AD 2.17: "Transition altitude 1850
#   m/6000 ft" (CTR ZARAGOZA). The air force's side: OSM's second aerodrome "Base Aérea de Zaragoza" (aeroway=aerodrome +
#   landuse=military) covers the military aprons (Este, Sur, Oeste) and not the civil apron: LEZG in MILITARY keeps any
#   stand out of it (none of OSM's stands lie there); its taxiways (TB, TC, B-1 to B-5, C-3, C-4) stay in the graph.
if EUROPE:
    NAMES['LEZG'] = ('Zaragoza', 'Zaragoza Airport')
    OSM_DIRS['LEZG'] = '/tmp/flight-sim/v076/airports/osm'
    NOTES_DIRS['LEZG'] = '/tmp/flight-sim/v076/airports'
    HOLD_DROP_M['LEZG'] = 30.0
    AIP_SOURCE['LEZG'] = "Spain's ENAIRE AIP, AD 2-LEZG (WEF 01-OCT-26) AD 2.12-2.14, 2.17, 2.19 and 2.20"
    AIP['LEZG'] = {'12L': ('SSALF', 427, 'left', 2.5, None, 823.0, False, True, 45, 0),
                   '30R': ('ALSF-II', 600, 'left', 3.0, 'III', 834.0, True, True, 45, 0),
                   '12R': ('ALSF-I', 581, 'left', 3.0, None, 834.0, False, False, 45, 0),
                   '30L': (None, 0, 'left', 3.0, None, 862.0, False, False, 45, 0)}
    PUBLISHED_MAG['LEZG'] = {'12L': 119.0, '30R': 299.0, '12R': 119.0, '30L': 299.0}
    AIP_THR['LEZG'] = {'12L': ('414008.62N', '0010223.40W'), '30R': ('413919.42N', '0010029.94W'),
                       '12R': ('414048.74N', '0010456.54W'), '30L': ('413948.46N', '0010237.37W')}
    # every end at AD 2.12's threshold (no displacement: the runway's end), trimmed evenly to AD 2.12's length
    THR_AT.update({('LEZG', e): (_dms_signed(la), _dms_signed(lo)) for e, (la, lo) in AIP_THR['LEZG'].items()})
    THR_LEN.update({('LEZG', '12L/30R'): 3032, ('LEZG', '12R/30L'): 3718})
    MILITARY = MILITARY | {'LEZG'}
    # AD 2.8: PRKG 20 to 23 "(General Aviation)" and 30 to 34 "(Hangar apron)", the latter "13.56 m MAX wingspan": not an
    # airliner's stands
    STAND_EXCLUDE['LEZG'] = (frozenset({'20', '21', '22', '23', '30', '31', '32', '33', '34'}),
                             "AD 2.8's PRKG 20 to 23 (general aviation) and 30 to 34 (the hangar apron, 13.56 m max wingspan)")
    # v0.7.8 marks (part 3, item 6): OSM maps stands 1 and 2 31 m apart, their parking points overlapping (an aircraft on
    # each would touch: "Found while building v0.7.6"). One kept: 1 (its straight lead-in; the tests pin its ref), 2 left out.
    STAND_DROP['LEZG'] = ({'2'}, "OSM's stand 2 overlaps stand 1 (their points 31 m apart): one kept, 1")
    # v0.7.8 marks (item 7): the military side's six shelters (two rows of three) and its two hangars to the east, on bare
    # ground in OSM, joined to the nearest pavement (20 m for a shelter, 30 m for a hangar [EST])
    PAVE_JOIN['LEZG'] = ([(-419568.6, -575052.1, 20), (-419537.4, -575074.2, 20), (-419506.8, -575093.9, 20),
                          (-418469.7, -575580.2, 20), (-418517.8, -575548.4, 20), (-418566.6, -575517.0, 20),
                          (-417752.2, -575676.9, 30), (-417781.0, -575641.7, 30)],
                         "the air force's shelters and hangars on bare ground in OSM (no taxiway or apron mapped to them)")
    # The air force's shelters: OSM maps no bunker or hangar on the military aprons; its two rows of three like parallel
    # sheds at the south apron's west end (82 x 22 m, ways 936374823 to 936374825; 53 x 20 m, 936374831 to 936374833;
    # building=yes, no height) are taken as the aircraft shelters: low vaults 9 m [EST], as v0.7.5's
    SHELTERS['LEZG'] = (frozenset({936374823, 936374824, 936374825, 936374831, 936374832, 936374833}), 9.0,
                        "the air force's aircraft shelters (OSM's two rows of three like sheds, 82 x 22 m and 53 x 20 m, "
                        "at the south military apron's west end, no height): low vaults 9 m")
    ICAOS = list(NAMES)

# ---- v0.7.6 (airports subagent apc): Rota (LERT), Naval Station Rota, pending. OSM: andalucia-261121, its box cut by
#   /tmp/flight-sim/v076/airports/apc/extract.sh. Spain's ENAIRE AIP lists it: AD 2-LERT (CÁDIZ/Rota; read with pypdf, no
#   page kept in the repository): "Spain-USA joint use aerodrome. Military use only." AD 2.12 10/28 3690 x 61, true
#   096.87 / 276.90 (MAG 098 / 278), THR PSN at both ends, none displaced (AD 2.13: LDA = TORA = 3690); THR elevations
#   64 / 62 ft. AD 2.14: no approach lights at either end; PAPI 10 3 deg "north of the runway", 28 2.75 deg "south of the
#   runway" (both on the left as flown); no TDZ or centreline lights. AD 2.19: LOC 10 IAOG "ILS CAT I"; none to 28. AD
#   2.17: "Transition altitude 6000 ft." AD 2.23: "Circuit south of RWY 10/28 not authorised."
# - OSM's second runway way ref'd 10/28 (329992919, 558 m) is the heliport's 10H/28H (AD 2.16: 558 x 40 m): not read as
#   the runway (RUNWAY_WAY_SKIP).
# - The whole aerodrome lies inside OSM's landuse=military "Base Naval de Rota": not in MILITARY (no stand would be left);
#   OSM's parking positions (the heliport's spots and small aircraft rows on the north apron) not read (STAND_POINTS_ONLY).
#   The player's five ramp spots on the main (west) apron [EST]: 100 m apart along the apron's north taxilane, each nose
#   100 m south of it, nosed in to 186.9 deg true (square to the runway): room for the 777-300ER.
# - Shelters: none. Rota has no hardened aircraft shelters; OSM's 81 building=bunker north and east of the runway are the
#   base's magazines (igloos), drawn as the bake's buildings.
if EUROPE:
    NAMES['LERT'] = ('Rota', 'Naval Station Rota')
    OSM_DIRS['LERT'] = '/tmp/flight-sim/v076/airports/osm'
    NOTES_DIRS['LERT'] = '/tmp/flight-sim/v076/airports'
    HOLD_DROP_M['LERT'] = 30.0
    AIP_SOURCE['LERT'] = "Spain's ENAIRE AIP, AD 2-LERT AD 2.12-2.14, 2.17, 2.19, 2.20 and 2.23"
    AIP['LERT'] = {'10': (None, 0, 'left', 3.0, 'I', 64.0, False, False, 61, 0),
                   '28': (None, 0, 'left', 2.75, None, 62.0, False, False, 61, 0)}
    PUBLISHED_MAG['LERT'] = {'10': 98.0, '28': 278.0}
    AIP_THR['LERT'] = {'10': ('363849.93N', '0062211.86W'), '28': ('363835.58N', '0061944.40W')}
    THR_AT.update({('LERT', e): (_dms_signed(la), _dms_signed(lo)) for e, (la, lo) in AIP_THR['LERT'].items()})
    THR_LEN.update({('LERT', '10/28'): 3690})
    RUNWAY_WAY_SKIP.add(329992919)
    STAND_POINTS['LERT'] = [('1', 36.6428533, -6.3568513, 186.9), ('2', 36.6427444, -6.3557317, 186.9),
                            ('3', 36.6427108, -6.3546122, 186.9), ('4', 36.6425257, -6.3534926, 186.9),
                            ('5', 36.642417, -6.352373, 186.9)]
    STAND_POINTS_ONLY.add('LERT')
    STAND_POINTS_REASONS['LERT'] = ("the player's ramp spots, placed: five on the main apron, 100 m apart, each nose 100 m "
                                    "south of the apron's north taxilane, nosed in to 186.9 deg true [EST]; the whole base "
                                    "is military in OSM, its own parking positions not read; a 60 m lead-in behind each")
    ICAOS = list(NAMES)


# ---- v0.7.6 (airports subagent apb): Lossiemouth (EGQS, scotland-261121), pending: its box cut by /tmp/flight-sim/v076/
# airports/osm/extract-apb.sh, notes in /tmp/flight-sim/v076/airports. No AIP read: the UK Military AIP's site
# (aidu.mod.uk) answered with a firewall's self-signed certificate and reset the plain connection (16:38 KST): every
# published value [EST]. OurAirports' ends, displacements (23 305 ft, 10 321 ft) and elevations (05 20, 23 24, 10 39,
# 28 37 ft); the lengths the UK Military AIP's as Wikipedia cites them (05/23 2,764 m, 10/28 1,850 m); the widths OSM's
# 46 m. OSM's 10/28 way stops ~100 m short of 10's end (the displaced part not mapped): every end at OurAirports' end on
# OSM's axis, trimmed evenly to the length. Lights and ILS from general knowledge of the field [EST]: an ILS (CAT I) and
# 900 m approach lights to 05 and 23, none to 10/28; PAPI left 3 deg everywhere; no TDZ or centreline lights.
# - The whole aerodrome is landuse=military in OSM (its aerodrome polygon is one): not in MILITARY (no stand would be
#   left); OSM's seven parking positions (P-8 and small aircraft spots) are not read (STAND_POINTS_ONLY). The player's
#   four ramp spots on D Apron's south-west block [EST]: 75 m apart along the apron (048.5 deg true), each nose 16 m
#   short of the apron's north-west taxilane, nosed in to 318.5 deg true, taxiway D 100 m behind: room for the 777-300ER.
# - The two hardened aircraft shelter sites (nine shelters each, north-west and south of the runway crossing): OSM's
#   aeroway=hangar of 1,130 to 1,280 m2 (33-36 x 50-53 m), each beside its own small apron: low vaults 9 m [EST].
if EUROPE:
    NAMES['EGQS'] = ('Lossiemouth', 'RAF Lossiemouth')
    OSM_DIRS['EGQS'] = '/tmp/flight-sim/v076/airports/osm'
    NOTES_DIRS['EGQS'] = '/tmp/flight-sim/v076/airports'
    HOLD_DROP_M['EGQS'] = 30.0
    AIP_SOURCE['EGQS'] = ("no AIP (the UK Military AIP's site did not answer): OurAirports' ends, elevations and displacements, "
                          "the UK Military AIP's lengths as published secondhand, the lights and ILS from general knowledge "
                          "of the field, all [EST]")
    AIP['EGQS'] = {'05': ('ALSF-I', 900, 'left', 3.0, 'I', 20.0, False, False, 46, 0),
                   '23': ('ALSF-I', 900, 'left', 3.0, 'I', 24.0, False, False, 46, 93),
                   '10': (None, 0, 'left', 3.0, None, 39.0, False, False, 46, 98),
                   '28': (None, 0, 'left', 3.0, None, 37.0, False, False, 46, 0)}
    THR_AT.update({('EGQS', '05'): (57.698001861572266, -3.3534200191497803),
                   ('EGQS', '23'): (57.715999603271484, -3.321310043334961),
                   ('EGQS', '10'): (57.707298278808594, -3.3438398838043213),
                   ('EGQS', '28'): (57.70539855957031, -3.3130099773406982)})
    # (10/28 at 1,845 m, 5 m short of the published 1,850: at 1,850 the bake's older over-length rule, which compares with
    # OurAirports' 6,066 ft (1,849 m) without the frame's scale, trims the 10 end 23 m back)
    THR_LEN.update({('EGQS', '05/23'): 2764, ('EGQS', '10/28'): 1845})
    STAND_POINTS['EGQS'] = [('1', 57.711406, -3.3374643, 318.5), ('2', 57.7118524, -3.3365196, 318.5),
                            ('3', 57.7122988, -3.3355749, 318.5), ('4', 57.7127453, -3.3346303, 318.5)]
    STAND_POINTS_ONLY.add('EGQS')
    STAND_POINTS_REASONS['EGQS'] = ("the player's ramp spots, placed: four on D Apron's south-west block, 75 m apart, nosed "
                                    "in to 318.5 deg true with taxiway D 100 m behind [EST]; the whole base is military in "
                                    "OSM, its own parking positions not read; a 60 m lead-in behind each")
    SHELTERS['EGQS'] = (frozenset({78045956, 78045176, 78045196, 78045965, 78045962, 78045955, 78045173, 78045960,
                                   78045198, 1087341048, 1087341049, 1087341050, 1087341051, 1087341052, 1087341053,
                                   1087341054, 1087341057, 78036467}), 9.0,
                        "the two hardened aircraft shelter sites, nine each (OSM aeroway=hangar of 33-36 x 50-53 m beside "
                        "their own small aprons, no height): low vaults 9 m")
    # v0.7.8 marks (item 7): two pads and four hangars on grass in OSM, joined to the nearest pavement (18 m for a pad,
    # 30 m for a hangar [EST])
    PAVE_JOIN['EGQS'] = ([(-441516.7, 1209579.0, 18), (-441089.0, 1210003.3, 18), (-441941.9, 1209218.6, 30),
                          (-441779.1, 1209163.4, 30), (-441981.8, 1210376.4, 30), (-442156.7, 1211008.1, 30)],
                         "pads and hangars on grass in OSM (no taxiway or apron mapped to them)")
    ICAOS = list(NAMES)

# ---- v0.7.6 (airports subagent apb): Lakenheath (EGUL, england-east-261122 from OpenStreetMap France's mirror: Geofabrik
# answered 404), pending: its box cut by the same script. No AIP read (the UK Military AIP's site did not answer): every
# published value [EST]. One runway, 05/23 in OSM's main way and in OurAirports (OSM's 17 m piece tagged 06/24 at the 23
# end, a newer designation [EST], left out: RUNWAY_SKIP); 2,743 m (OurAirports' 8,998 ft; OSM's length tag 2,742.59 m)
# x 46 m, the ends at OurAirports', no displacement, elevations 27 / 28 ft. An ILS (CAT I) and 900 m approach lights at
# both ends, PAPI left 3 deg, no TDZ or centreline lights (general knowledge of the field). RAF Mildenhall, 8 km
# south-west, is not built.
# - The whole aerodrome is landuse=military in OSM: not in MILITARY; OSM's parking positions (the fighters' rows on
#   Alpha Ramp, the arm/de-arm areas) are not read (STAND_POINTS_ONLY). The player's three ramp spots on Victor Ramp
#   [EST]: 70 m apart along it (123.7 deg true), nosed in to 213.7 deg true away from taxiway V, which runs 145 m behind.
# - The shelters: OSM's building=yes of 20-28 x 44-55 m within 60 m of a small apron (under 2,500 m2: each shelter's own
#   pad), 43 of them: low vaults 9 m [EST].
if EUROPE:
    NAMES['EGUL'] = ('Lakenheath', 'RAF Lakenheath')
    OSM_DIRS['EGUL'] = '/tmp/flight-sim/v076/airports/osm'
    NOTES_DIRS['EGUL'] = '/tmp/flight-sim/v076/airports'
    HOLD_DROP_M['EGUL'] = 30.0
    AIP_SOURCE['EGUL'] = ("no AIP (the UK Military AIP's site did not answer): OurAirports' ends, length and elevations, "
                          "OSM's runway, the lights and ILS from general knowledge of the field, all [EST]")
    AIP['EGUL'] = {'05': ('ALSF-I', 900, 'left', 3.0, 'I', 27.0, False, False, 46, 0),
                   '23': ('ALSF-I', 900, 'left', 3.0, 'I', 28.0, False, False, 46, 0)}
    THR_AT.update({('EGUL', '05'): (52.4025, 0.544383), ('EGUL', '23'): (52.416401, 0.577647)})
    THR_LEN.update({('EGUL', '05/23'): 2743})
    RUNWAY_SKIP = RUNWAY_SKIP | {('EGUL', '06/24')}
    STAND_POINTS['EGUL'] = [('1', 52.4063126, 0.5612648, 213.7), ('2', 52.4059637, 0.5621223, 213.7),
                            ('3', 52.4056148, 0.5629799, 213.7)]
    STAND_POINTS_ONLY.add('EGUL')
    # (the first day run: the pushback crossed 12.5 m of grass between Victor Ramp and taxiway V, which bends away
    # from the ramp there: the ground under each spot's pushback paved, 35 m each side, as Munich's)
    APRON_PUSH['EGUL'] = 35.0
    STAND_POINTS_REASONS['EGUL'] = ("the player's ramp spots, placed: three on Victor Ramp, 70 m apart, nosed in to 213.7 "
                                    "deg true with taxiway V 145 m behind [EST]; the whole base is military in OSM, its "
                                    "own parking positions not read; a 60 m lead-in behind each")
    SHELTERS['EGUL'] = (frozenset({
        1450034050, 1450034051, 1450092254, 1450092255, 1450092256, 1450092257, 1450092258, 1450092261, 1450092262,
        1450092263, 1450105483, 1450105484, 1450105485, 1450105486, 1450105501, 1450126203, 1450126206, 1484326704,
        1484397811, 1486988190, 1486988194, 1486988199, 1488963843, 1488963844, 1489202436, 1489253752, 1489253760,
        1489253763, 1489253764, 1491084928, 1491084929, 1491084930, 1491084931, 1491084940, 1491084941, 1493933109,
        1493933110, 1493933111, 1493933112, 1493959204, 1493959207, 1493959208, 1493959209}), 9.0,
        "the hardened aircraft shelters (OSM building=yes of 20-28 x 44-55 m beside their own small aprons, no height): "
        "low vaults 9 m")
    # v0.7.6 (the lead): Victor Ramp's four long sun shelters (OSM hangars of 166 to 183 by 35 m, open-sided canopies
    # over the fighter rows, which the game would draw as solid 20 m blocks) stand 22 m either side of the one taxilane
    # from the player's ramp spots: clear of an A321's wing by 4 m, not of a 787's or a 777's, and the spots take code
    # E. And one flow-through shelter that OSM's taxi line runs through, on the route from spot 3 to 05. Left out.
    BUILDING_SKIP_AT['EGUL'] = (((-232845, 601815), (-232657, 601775), (-232838, 601754), (-232664, 601835),
                                 (-232940, 602228)),
                                "Victor Ramp's four sun shelters (open canopies in fact) beside the taxilane from the "
                                "player's spots, and a flow-through shelter the taxi line runs through: not drawn, so "
                                "that no route from a ramp spot passes within a 777's half span of a building")
    ICAOS = list(NAMES)


# ---- v0.7.6 (airports subagent apa): Ramstein (ETAR), pending. OSM: Geofabrik's rheinland-pfalz extract answered 503
#   (its download proxy timed out) and overpass-api.de refused the generic client (406), so the box came from the public
#   Overpass mirror overpass.kumi.systems (data of 2026-07-24; aeroway, building, highway=service and landuse=military in
#   49.41-49.47 N, 7.50-7.69 E), notes in /tmp/flight-sim/v076/airports. No AIP read: the MIL AIP Germany site
#   (mil-aip.de) gave no answer (an HTTP/2 protocol error, then an empty reply): every published value [EST].
#   - 08/26: OurAirports' ends (THR_AT; within 6 m of OSM's way ends), trimmed evenly to OurAirports' and OSM's length tag,
#     3,200 m; 09/27 OSM's way (2,974 m; OSM's length tag 3,000 m) cut to OurAirports' 9,278 ft (2,828 m, the length
#     public sources give) at its 09 end: 27 at OSM's end, 09 on OSM's axis 2,828 m west of it (THR_AT, THR_LEN;
#     OurAirports' own ends lie ~380 m and ~200 m east of OSM's, so not used as ends). No displacements. Elevations OurAirports' 761 / 776 / 769 / 782 ft. Both runways are
#     about 083 deg magnetic today: 09/27 keeps its old name (7 deg off its ident).
#   - Lights and ILS [EST], from OSM's mapped lights and general knowledge of the field: approach lights as OSM maps
#     them (about 900 m at 26, 09 and 27, about 500 m at 08: the game's SSALF), an ILS CAT I to all four ends, PAPI 3 deg
#     (08's on the right and 09's on the left as OSM's PAPI nodes, the others left), no TDZ or centreline lights.
#   - The whole aerodrome is landuse=military in OSM (its aerodrome polygon is one): not in MILITARY (no stand would be
#     left). OSM maps no parking position there; the player's ramp spots are placed on Ramp 1 (STAND_POINTS, alone).
if EUROPE:
    NAMES['ETAR'] = ('Ramstein', 'Ramstein Air Base')
    OSM_DIRS['ETAR'] = '/tmp/flight-sim/v076/airports/osm'
    NOTES_DIRS['ETAR'] = '/tmp/flight-sim/v076/airports'
    HOLD_DROP_M['ETAR'] = 30.0
    AIP_SOURCE['ETAR'] = ("no AIP (the MIL AIP Germany site did not answer): OurAirports' ends and elevations, OSM's runways, "
                          "the lights and ILS from OSM's mapped lights and general knowledge of the field, all [EST]")
    AIP['ETAR'] = {'08': ('SSALF', 510, 'right', 3.0, 'I', 761.0, False, False, 45, 0),
                   '26': ('ALSF-I', 900, 'left', 3.0, 'I', 776.0, False, False, 45, 0),
                   '09': ('ALSF-I', 900, 'left', 3.0, 'I', 769.0, False, False, 45, 0),
                   '27': ('ALSF-I', 900, 'left', 3.0, 'I', 782.0, False, False, 45, 0)}
    THR_AT.update({('ETAR', '08'): (49.43259811401367, 7.578829765319824),
                   ('ETAR', '26'): (49.4364013671875, 7.62253999710083),
                   # 27 at OSM's way's east end, 09 on OSM's axis 2,828 m (times the frame's scale) west of it [EST]
                   ('ETAR', '27'): (49.4376001, 7.6168661), ('ETAR', '09'): (49.4359721, 7.5779504)})
    THR_LEN.update({('ETAR', '08/26'): 3200, ('ETAR', '09/27'): 2828})
    # The player's ramp spots on Ramp 1 (OSM's apron 24620884, 467 x 432 m, east of the field), where OSM maps the ramp's
    # parking rows as short east-west taxilanes about 46 m apart: a spot on every other row (92 m apart, room for the
    # 777-300ER's 64.8 m span) in the west two of its three columns, the nose 8 m in from the lane's west end, along the
    # lane (266 to 267 deg true), the lane behind it [EST]; spot 2's nose 3 m in (the 777's pushback
    # ended 11 m off the taxi lines from 8 m in). The base's only stands.
    STAND_POINTS['ETAR'] = [('1', 49.4417086, 7.6145888, 266.0), ('2', 49.4425422, 7.6144397, 266.0),
                            ('3', 49.4417812, 7.6160542, 267.1), ('4', 49.4426184, 7.6159602, 267.0)]
    STAND_POINTS_ONLY.add('ETAR')
    STAND_POINTS_REASONS['ETAR'] = ("the player's ramp spots, placed: four on Ramp 1, on every other one of OSM's parking-row "
                                    "taxilanes (92 m apart), nosed west along the lane [EST]; the whole base is military in "
                                    "OSM, which maps no parking position; a 60 m lead-in behind each")
    # The shelters: OSM's group of 37 building=hangar (about 14-23 x 29-46 m) and two military=bunker (25 x 35 m) in the
    # field's south-west corner (the old fighter area), no height in OSM: low vaults 9 m [EST], as v0.7.5's
    SHELTERS['ETAR'] = (frozenset({
        255042169, 255042170, 255042177, 255042179, 255042180, 255042184, 255042187, 255042190, 255042191, 255042194,
        255042198, 255042202, 255042204, 255042212, 255042214, 255042218, 255042223, 255042226, 255042230, 255042231,
        255042232, 255042234, 255042245, 255042253, 255042256, 255042257, 255042260, 255042262, 255042270, 255042272,
        255042275, 255042278, 255042281, 255042283, 255042284, 255042286, 255042301, 271725065, 292119767}), 9.0,
        "the south-west group of small hangars and bunkers (OSM building=hangar of 14-23 x 29-46 m and two military=bunker "
        "of 25 x 35 m, no height): low vaults 9 m")
    ICAOS = list(NAMES)

# ---- v0.7.6 (airports subagent apa): Fairford (EGVA), pending. OSM: OpenStreetMap France's mirror of England's south-west
#   (england-south-west-261122, the lead's; Geofabrik's county paths answered 404/503), its box cut by osmium (-1.87,
#   51.655, -1.71, 51.71; /tmp/flight-sim/v076/airports/osm/EGVA), notes in /tmp/flight-sim/v076/airports. No AIP read:
#   the UK Military AIP's site (aidu.mod.uk) did not answer the other subagents today (a firewall's certificate and a
#   reset): every published value [EST].
#   - 09/27 at OurAirports' ends (THR_AT; within 3 m of OSM's way ends) trimmed evenly to OurAirports' and OSM's length
#     tag, 9,994 ft (3,046 m); 61 m wide (OurAirports' 200 ft; OSM's width tag 46 m, the keel); no displacements;
#     elevations OurAirports' 286 / 255 ft.
#   - Lights and ILS [EST]: about 900 m of approach lights at both ends as OSM maps them, an ILS (CAT I) to both, PAPI
#     left 3 deg, no TDZ lights, centreline lights (61 m wide).
#   - The whole aerodrome is landuse=military in OSM: not in MILITARY; OSM maps no parking position; the player's ramp
#     spots placed (STAND_POINTS, alone). No hardened shelter at Fairford (a bomber base of open hardstands): OSM's three
#     hangars stay hangars.
if EUROPE:
    NAMES['EGVA'] = ('Fairford', 'RAF Fairford')
    OSM_DIRS['EGVA'] = '/tmp/flight-sim/v076/airports/osm'
    NOTES_DIRS['EGVA'] = '/tmp/flight-sim/v076/airports'
    HOLD_DROP_M['EGVA'] = 30.0
    # v0.7.8 marks (item 8): the hardstands' and the aprons' outlines as OSM traces them step in and out, by up to about 40 m
    # (the west apron's two steps of about 30 by 40 m, seen from 1,000 ft in v078-mka-mk78-egva-hardstands.png)
    APRON_SMOOTH['EGVA'] = (25.0, 6.0, "OSM's apron outlines stepped in notches up to about 40 m: smoothed [EST]")
    AIP_SOURCE['EGVA'] = ("no AIP (the UK Military AIP's site did not answer): OurAirports' ends, length, width and elevations, "
                          "OSM's runway, the lights and ILS from OSM's mapped lights and general knowledge of the field, all [EST]")
    AIP['EGVA'] = {'09': ('ALSF-I', 900, 'left', 3.0, 'I', 286.0, False, True, 61, 0),
                   '27': ('ALSF-I', 900, 'left', 3.0, 'I', 255.0, False, True, 61, 0)}
    THR_AT.update({('EGVA', '09'): (51.68299865722656, -1.812000036239624),
                   ('EGVA', '27'): (51.683998107910156, -1.7680000066757202)})
    THR_LEN.update({('EGVA', '09/27'): 3046})
    # The player's ramp spots on the north-east apron by the base's hangars (OSM's apron 1354468543, ~300 x 220 m, its
    # taxilane along the south-east side and across the north): three in a row 75 m apart, nosed in to the north-west
    # (305 deg true), the taxilane 10 to 20 m behind each tail [EST] (spot 2 set 6 m back: the 787's pushback ended 9 m off the lines); each the 777-300ER's (the game's own fit, searched
    # over the apron: /tmp/flight-sim/v076/apa/search.mjs). The base's only stands.
    STAND_POINTS['EGVA'] = [('1', 51.6869487, -1.7715763, 304.9), ('2', 51.6874482, -1.7708239, 304.9),
                            ('3', 51.6880864, -1.7703929, 304.9)]
    STAND_POINTS_ONLY.add('EGVA')
    STAND_POINTS_REASONS['EGVA'] = ("the player's ramp spots, placed: three on the north-east apron, 75 m apart, nosed in to "
                                    "305 deg true with its taxilane behind [EST]; the whole base is military in OSM, which "
                                    "maps no parking position; a 60 m lead-in behind each")
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
    for _wid, tags, coords in d['ways']:
        if tags.get('aeroway') != 'runway' or not is_live(tags) or coords[0] == coords[-1] or _wid in RUNWAY_WAY_SKIP:
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
    for _b in AREA_EXTRA.get(icao, ()):     # v0.7.1: only the airports named in AREA_EXTRA (empty elsewhere)
        _c = [to_map(la, lo) for lo, la in ((_b[0], _b[1]), (_b[2], _b[1]), (_b[2], _b[3]), (_b[0], _b[3]))]
        area = area.union(Polygon([(float(x), float(y)) for x, y in _c]))
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
    smooth = APRON_SMOOTH.get(icao)      # (v0.7.8: Fairford's only)
    for _, _, tags, g in d['areas']:
        if tags.get('aeroway') == 'apron':
            for p in shapely.get_parts(shapely.from_wkb(g)):
                xy = to_xy(p.exterior.coords)
                if Polygon(xy).intersects(area):
                    if smooth:
                        q = Polygon(xy).buffer(0).buffer(smooth[0]).buffer(-smooth[0]).buffer(-smooth[1]).buffer(smooth[1]).simplify(1.0)
                        for qq in shapely.get_parts(q):
                            if qq.area > 100:
                                aprons.append(dict(points=pts(np.asarray(qq.exterior.coords))))
                        continue
                    aprons.append(dict(points=pts(xy)))
    if smooth:
        est.append(('aprons smoothed', f'closed {smooth[0]:.0f} m, opened {smooth[1]:.0f} m', smooth[2] + ' (APRON_SMOOTH)'))

    bridges = [LineString(to_xy(c)) for _, t, c in d['ways'] if t.get('aeroway') == 'jet_bridge']
    gate_nodes = [Point(to_map(la, lo)) for _, t, lo, la in d['nodes'] if t.get('aeroway') == 'gate']
    near_gate = lambda p: any(b.distance(p) < 45 for b in bridges) or any(g.distance(p) < 45 for g in gate_nodes)
    stands, seen = [], set()
    node_refs = [(tuple(float(v) for v in to_map(la, lo)), t['ref']) for _, t, lo, la in d['nodes']
                 if t.get('aeroway') == 'parking_position' and t.get('ref')]
    for _, tags, coords in d['ways']:
        if tags.get('aeroway') != 'parking_position' or icao in PP_CHAINS or icao in STAND_POINTS_ONLY:
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
        if not isinstance(ymin, (set, frozenset)):   # (v0.7.4: a set of refs is taken further down, once the stands have their names)
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
    paved_only = []
    if icao in STAND_EXCLUDE and isinstance(STAND_EXCLUDE[icao][0], (set, frozenset)):
        # v0.7.4: STAND_EXCLUDE by OSM's refs (Berlin's de-icing pads), here, where every stand has the name it keeps:
        # a ref in the set, and a second or third stand of that ref ("PAD1-2", renamed just above)
        refs_x, why = STAND_EXCLUDE[icao]
        n0 = len(stands)
        out_x = [st for st in stands if st['ref'] in refs_x or st['ref'].rsplit('-', 1)[0] in refs_x]
        stands = [st for st in stands if st['ref'] not in refs_x and st['ref'].rsplit('-', 1)[0] not in refs_x]
        if icao in PAVE_DROPPED:
            paved_only += out_x
        est.append(('stands left out', f'{n0 - len(stands)} with OSM refs {", ".join(sorted(refs_x))}', why + ' (STAND_EXCLUDE)'))
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
    # v0.7.2 (airports subagent A): unnamed stands left out by the numbers they were just given (STAND_DROP_NUMBERED, empty
    # but for Prague's)
    if icao in STAND_DROP_NUMBERED:
        refs_d, why = STAND_DROP_NUMBERED[icao]
        n0 = len(stands)
        if icao in PAVE_DROPPED:
            paved_only += [st for st in stands if st['ref'] in refs_d]
        stands = [st for st in stands if st['ref'] not in refs_d]
        est.append(('stands left out', f'{n0 - len(stands)}: {", ".join(sorted(refs_d))}', why + ' (STAND_DROP_NUMBERED)'))

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

    # (v0.7.4: PAVE_DROPPED's positions are no stands but keep the pavement made round them: Berlin's de-icing pads)
    extra = stand_aprons(stands + paved_only, aprons, runways, icao, taxiways)
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
    shelter_ids, shelter_h, shelter_why = SHELTERS.get(icao, (frozenset(), None, ''))    # (v0.7.5: Komatsu's only)
    n_shelters = 0
    skip_at, skip_why = BUILDING_SKIP_AT.get(icao, ((), ''))      # (v0.7.6: Lakenheath's only)
    n_skipped = 0
    for oid, from_way, tags, g in d['areas']:
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
            if skip_at and any(pp.contains(Point(q)) for q in skip_at):
                n_skipped += 1
                continue
            shelter = bool(from_way and oid in shelter_ids)
            n_shelters += shelter
            buildings.append(dict(kind=kind, heightM=round(shelter_h if shelter else building_height(tags, kind), 1),
                                  name='' if EUROPE else (tags.get('name:en') or tags.get('name') or ''), points=pts(xy)))
    if n_shelters:
        est.append(('shelters', f'{n_shelters} at {shelter_h:.0f} m', shelter_why + ' (SHELTERS)'))
    if n_skipped:
        est.append(('buildings left out', f'{n_skipped} of {len(skip_at)} points', skip_why + ' (BUILDING_SKIP_AT)'))
    if icao in PAVE_JOIN:       # v0.7.8 marks (item 7): only the airports named in PAVE_JOIN
        joins, join_why = PAVE_JOIN[icao]
        from shapely.ops import nearest_points
        rw_keep = shapely.unary_union([LineString([(r['ends'][0]['x'], r['ends'][0]['y']), (r['ends'][1]['x'], r['ends'][1]['y'])])
                                      .buffer(r['widthM'] / 2 + 30, cap_style='flat') for r in runways])
        pave = shapely.unary_union([LineString(t['points']).buffer(t['widthM'] / 2) for t in taxiways if len(t['points']) > 1] +
                                   [Polygon(a['points']).buffer(0) for a in aprons])
        made, skipped = [], []
        for jx, jy, jw in joins:
            q = Point(jx, jy)
            src = next((P for P in (Polygon(b['points']).buffer(0) for b in buildings) if P.contains(q)), None) or \
                next((P for P in (Polygon(a['points']).buffer(0) for a in aprons) if P.contains(q)), None)
            if src is None:
                raise SystemExit(f'{icao}: PAVE_JOIN point {jx}, {jy} is in no building or apron')
            pa, pu = nearest_points(src, pave.difference(src.buffer(1.0)))
            gap = np.array([pu.x - pa.x, pu.y - pa.y])     # (not `d`: the OSM data's name in bake())
            n = float(np.hypot(*gap))
            if n < 0.5:
                continue
            u = gap / n
            a0, a1 = np.array([pa.x, pa.y]) - 4 * u, np.array([pu.x, pu.y]) + 4 * u
            strip = LineString([tuple(a0), tuple(a1)]).buffer(jw / 2, cap_style='flat')
            if strip.intersects(rw_keep):
                skipped.append(f'{jx:.0f},{jy:.0f}')
                continue
            made.append(dict(points=pts(np.asarray(strip.exterior.coords)), synthetic=True))
        aprons += made
        est.append(('pavement joined', f'{len(made)} strips, {sum(Polygon(a["points"]).area for a in made):.0f} m2' +
                    (f' ({len(skipped)} not laid, near a runway: {", ".join(skipped)})' if skipped else ''), join_why + ' (PAVE_JOIN)'))

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
