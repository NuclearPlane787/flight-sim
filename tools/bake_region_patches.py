"""v0.6.0 Part 2 step 7: the region's 30 m height patches and 10 m coast patches, into staging.

Same formats and treatment as Korea's (bake_patches.py):
  * height patches: GLO-30 at the cell centres on a cell-aligned map-metre grid (row 0 = south),
    the sea from OSM's land polygons (bbox-read, as bake_region_water.py), inland water from
    WorldCover's permanent water class (80) minus the sea (small specks dropped), the built-up
    fraction from WorldCover's built-up class (50) for compose_height()'s local-minimum filter,
    and the airfields flattened from data/airports/<ICAO>.json (boundary polygon, elevM).
    .i16 in 0.25 m units, gzipped.
  * coast patches: 10 m, 16 km x 16 km centred on the airport's reference point, signed
    distance to the sea coastline (+ land), .u8 128 + d/2.

Outputs: /tmp/flight-sim/v060/bake/patches/patch-<id>.i16.gz, coast-<ICAO>.u8.gz, a <name>.json
meta each, and manifest-patches.json ({patches, coastPatches}, paths as terrain/...).
Never writes into data/.

Usage (one item per guarded command; resumable, skips finished items unless --force):
  bake_region_patches.py patch <id>      ids: pudong-hongqiao haneda-narita gimhae kansai fukuoka qingdao fuji yancheng
  bake_region_patches.py coast <ICAO>    ZSPD RJTT RJBB RJFF RKPK RJAA ZSSS ZSQD ZSYN

v0.6.1: Yancheng (ZSYN, pending) is baked into /tmp/flight-sim/v061/zsyn/patches (FS_PATCH_OUT=<dir> sets the
staging folder) and copied to data/terrain by hand; its entry goes in the manifest's patchesPending. Its 16 km
square is all land (the coast is ~40 km east): no coast patch.
  bake_region_patches.py quicklook <id>
  bake_region_patches.py manifest
"""
import argparse
import glob
import json
import os
import sys
import time

import numpy as np
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_makedirs = os.makedirs
os.makedirs = lambda *a, **k: None          # bake_common makes data/ folders on import; not here
try:
    import bake_common as bc
    import bake_geom as bg
    import bake_height as bh
    import bake_patches as bp
    import bake_region_water as brw
finally:
    os.makedirs = _makedirs

import shapely
from shapely.geometry import Polygon

OUT = os.environ.get('FS_PATCH_OUT') or '/tmp/flight-sim/v060/bake/patches'
AIRPORT_DIR = os.path.join(bc.DATA, 'airports')
NEW_AIRPORTS = ['RJTT', 'RJAA', 'ZSPD', 'ZSSS', 'RKPK', 'RJBB', 'RJFF', 'ZSQD', 'ZSYN']

# id: (lon0, lat0, lon1, lat1)
PATCHES = {
    'pudong-hongqiao': (121.22, 31.05, 121.96, 31.28),
    'haneda-narita': (139.70, 35.45, 140.48, 35.85),
    'gimhae': (128.78, 35.07, 129.12, 35.34),       # Sinosan to the W/NW, Geumjeongsan to the NE
    'kansai': (135.08, 34.28, 135.46, 34.58),       # the island and Osaka Bay's south-east shore
    'fukuoka': (130.30, 33.48, 130.60, 33.70),
    'qingdao': (119.95, 36.25, 120.23, 36.47),
    'fuji': (138.507, 35.18, 138.948, 35.54),       # ~40 x 40 km round the summit (35.3606, 138.7274)
    'yancheng': (120.06, 33.32, 120.35, 33.54),     # v0.6.1 (pending): Qingdao's size round ZSYN; GLO-30 N33 E120 only
}
COAST = ['ZSPD', 'RJTT', 'RJBB', 'RJFF', 'RKPK', 'RJAA', 'ZSSS', 'ZSQD', 'ZSYN']
# v0.6.3 (pending), Beijing Capital and Daxing: one patch each, ~28 x 28 km round each (Qingdao's size and a
# little more), not one over both: they are 65 km apart with the city between, so one box would be ~3x the cells
# for land no approach crosses. GLO-30 N39 E116 and N40 E116. Both 16 km squares all land (the sea ~150 km east):
# no coast patch (bake_region_patches.py coast ZBAA ZBAD, seaFraction 0).
NEW_AIRPORTS += ['ZBAA', 'ZBAD']
PATCHES.update({
    'beijing-capital': (116.44, 39.96, 116.76, 40.22),
    'beijing-daxing': (116.26, 39.38, 116.60, 39.62),
})
# v0.6.3: these airfields are flattened to the least-squares plane through their runway ends' elevations, not to
# one level at the airport's elevM. OurAirports' elevM is 5 to 8 m above the ground there (Daxing: elevM 29.9 m, its
# eight thresholds 21.0-25.3 m and GLO-30's ground round the stands 21-23 m; Capital: 35.4 m, thresholds 25.6-35.4 m,
# the ground falling ~7 m west to east), so one level stood the aprons on a plateau with ramps down to the runways.
FIELD_PLANE = {'ZBAA', 'ZBAD'}
# v0.6.3 (pending), Shenyang, Dalian and Vladivostok: one patch each, Qingdao's size or a little more, taking in the
# ground under each runway's finals to ~15 km out (Dalian's hills among the bays to the west and east of the field;
# Vladivostok's Amur Bay to the south-west and the ridges to the north-east). GLO-30 N41 E123; N38 E121 and N39 E121;
# N43 E131 and N43 E132. Their fields flattened to the plane through the runway ends (FIELD_PLANE): Vladivostok's AIP
# thresholds are 9.7 and 13.2 m against the field's 18 m, Shenyang's 52 and 60 m (OurAirports). Coast patches: ZYTL
# and UHWW (seaFraction > 0); ZYTX's square is all land.
NEW_AIRPORTS += ['ZYTX', 'ZYTL', 'UHWW']
PATCHES.update({
    'shenyang': (123.33, 41.53, 123.63, 41.75),
    'dalian': (121.36, 38.85, 121.74, 39.10),
    'vladivostok': (131.95, 43.28, 132.36, 43.52),
})
COAST += ['ZYTX', 'ZYTL', 'UHWW']
FIELD_PLANE = FIELD_PLANE | {'ZYTX', 'ZYTL', 'UHWW'}
# v0.6.4 (pending), New Chitose and Aomori: one patch each, ~22 x 32 km and ~25 x 23 km, taking in the ground under
# every final to ~15 km out (New Chitose's two parallel runways north and south over the Ishikari lowland; Aomori's
# plateau edge to the north-east and the hills south of it). GLO-30 N42 E141; N40 E140. Both fields flattened to the
# plane through their runway ends (FIELD_PLANE): AIP Japan's thresholds 17.5 to 25.0 m at New Chitose (field 21.3 m),
# 197.2 and 202.4 m at Aomori. Coast: bake_region_patches.py coast RJCC RJSA says whether either square touches the sea.
NEW_AIRPORTS += ['RJCC', 'RJSA']
PATCHES.update({
    'new-chitose': (141.56, 42.635, 141.83, 42.925),
    'aomori': (140.55, 40.63, 140.85, 40.84),
})
COAST += ['RJCC', 'RJSA']
FIELD_PLANE = FIELD_PLANE | {'RJCC', 'RJSA'}
# v0.6.4 (pending), Pyongyang Sunan: one patch, ~29 x 29 km round the field, taking in the ground under both finals
# to ~15 km out (17's from the north-north-west over the low hills along the Taedong's tributaries, 35's from the
# south-south-east over the city). GLO-30 N39 E125. Flattened to the plane through its runway's ends (FIELD_PLANE):
# OurAirports' thresholds 29.3 and 26.2 m against the field's 35.7 m. Coast: its 16 km square is all land (the sea
# ~40 km west), checked with bake_region_patches.py coast ZKPY.
NEW_AIRPORTS += ['ZKPY']
PATCHES.update({
    'pyongyang': (125.50, 39.08, 125.84, 39.34),
})
COAST += ['ZKPY']
FIELD_PLANE = FIELD_PLANE | {'ZKPY'}
# v0.6.4 (pending), Wonsan Kalma: one patch, ~29 x 30 km, taking in the ground under all four finals to ~15 km out
# (15L/15R's from the north-north-west over Yonghung Bay's shore and the hills west of it, 33L/33R's from the
# south-south-east over the bay and Kalma's spit; the mountains west and south of Wonsan). GLO-30 N39 E127. Flattened to
# the plane through its four runway ends (FIELD_PLANE: all at the field's 7 ft, OurAirports having no end elevations
# here). Coast patch: the field stands on the Kalma peninsula between the bay and the open sea.
NEW_AIRPORTS += ['ZKWS']
PATCHES.update({
    'wonsan': (127.32, 39.03, 127.66, 39.30),
})
COAST += ['ZKWS']
FIELD_PLANE = FIELD_PLANE | {'ZKWS'}
# v0.6.4 (pending), Sendai and Niigata: one patch each, ~31 x 27 km and ~29 x 26 km, taking in the ground under every
# final to ~15 km out (Sendai's 09 over the Natori plain, 27 over the Pacific a kilometre east, 12/30 across the coast
# plain; Niigata's 10 over the city and the Shinano's mouth, 28 over the plain east of the Agano, 22 over the Sea of
# Japan, 04 over the city's south). GLO-30 N38 E140, N38 E141; N37 E138, N37 E139, N38 E139. Both fields flattened to the
# plane through their four runway ends (FIELD_PLANE; AIP Japan's thresholds: Sendai 1.5 to 4.6 m, Niigata 1.8 to 8.3 m).
# Coast patches for both (each stands by the sea).
NEW_AIRPORTS += ['RJSS', 'RJSN']
PATCHES.update({
    'sendai': (140.74, 38.02, 141.10, 38.26),
    'niigata': (138.96, 37.84, 139.29, 38.07),
})
COAST += ['RJSS', 'RJSN']
# Their four ends lie on no one plane (Sendai's 12/30 1.5 to 2 m below the plane of 09/27; Niigata's two runways fall
# 5 m each, at right angles to each other): the least-squares plane missed their runways by up to 0.7 m. Each is
# flattened instead to its runways' own profiles, blended by 1 / (1 + d^2) of the distance d to each runway's centreline
# (field_runways(); tests/v063-ne-airport.mjs's fieldSurface 'runways' checks the stands against the same surface).
FIELD_RUNWAYS = {'RJSS', 'RJSN'}
FIELD_PAVEMENT = set()

# v0.7.0, Europe (FS_REGION=europe, read by bake_common at import: Europe's frame): Heathrow and Charles de Gaulle, pending.
# Their airports from data/europe/airports, their patches staged in /tmp/flight-sim/v070/airports/patches (FS_PATCH_OUT
# overrides) and copied into data/europe/terrain by hand. One patch each, taking in the ground under every final to
# ~15 km out (both fields' runways run east-west): Heathrow ~33 x 21 km (the reservoirs to the west, London to the east;
# GLO-30 N51 W001), Charles de Gaulle ~37 x 18 km (the Plaine de France; GLO-30 N48 E002 and N49 E002). Both flattened
# to their runways' own profiles (FIELD_RUNWAYS): Charles de Gaulle's two pairs slope opposite ways (the north pair
# rising 13-17 ft west to east, the south pair falling 20 ft), so no one plane fits its eight ends; Heathrow's four ends
# lie on no one plane either (the north runway 0.5 ft down to the east, the south 1.5 ft up). Europe's heights store
# the sea as exactly 0 and a land cell never as 0 (bake_common.height_to_i16_land). Neither 16 km square touches the
# sea (bake_region_patches.py coast EGLL LFPG says so).
if bc.EUROPE:
    OUT = os.environ.get('FS_PATCH_OUT') or '/tmp/flight-sim/v070/airports/patches'
    AIRPORT_DIR = os.path.join(bc.DATA, 'europe', 'airports')
    NEW_AIRPORTS = ['EGLL', 'LFPG']
    PATCHES = {
        'heathrow': (-0.70, 51.375, -0.22, 51.565),
        'charles-de-gaulle': (2.30, 48.93, 2.80, 49.09),
    }
    COAST = ['EGLL', 'LFPG']
    FIELD_PLANE = set()
    FIELD_RUNWAYS = {'EGLL', 'LFPG'}
    FIELD_PAVEMENT = {'EGLL', 'LFPG'}   # the profiles between the pavement's ends, as the game draws them (field_runways())
# v0.7.0, Frankfurt and Madrid, pending (the same staging): Frankfurt ~43 x 21 km (07/25's finals ~15 km out each way along
# the Main valley; 18 is take-off only, south; GLO-30 N49 E008 and N50 E008), Madrid ~31 x 32 km (18/36's and 14/32's
# finals ~15 km out; the Sierra de Guadarrama lies beyond, ~50 km north-west; GLO-30 N40 W004). Both flattened to their
# runways' own profiles (FIELD_RUNWAYS: Frankfurt's 07/25 rise 23-34 ft west to east; Madrid's runways fall ~80 ft from
# north to south). Both inland: no coast patch (bake_region_patches.py coast EDDF LEMD says so).
if bc.EUROPE:
    NEW_AIRPORTS += ['EDDF', 'LEMD']
    PATCHES.update({
        'frankfurt': (8.25, 49.93, 8.85, 50.12),
        'madrid': (-3.75, 40.36, -3.38, 40.65),
    })
    COAST += ['EDDF', 'LEMD']
    FIELD_RUNWAYS = FIELD_RUNWAYS | {'EDDF', 'LEMD'}
    # Madrid's four landing thresholds are displaced (500 to 928 m): its profiles between the pavement's ends, as the game
    # draws them (FIELD_PAVEMENT); Frankfurt has no displacement, so its profiles are the same either way.
    FIELD_PAVEMENT = FIELD_PAVEMENT | {'LEMD'}
# v0.7.0, Zurich, Gatwick and Orly, pending (the same staging): Zurich ~33 x 29 km (three runways at 96, 137 and 155 deg
# true, finals ~12-15 km out each way; GLO-30 N47 E008), Gatwick ~29 x 17 km, west to 0.42 W and east only to 0.005 W:
# GLO-30's N51 E000 isn't downloaded (a missing tile reads as sea), so 26L's final has the patch for ~11 km and the
# 250 m tiles beyond (GLO-30 N51 W001); Orly ~38 x 24 km (06/24, 07/25 and 02/20; GLO-30 N48 E002). All three flattened
# to their runways' own profiles between the pavement's ends (FIELD_RUNWAYS, FIELD_PAVEMENT: displaced thresholds at
# all three). All inland: no coast patch (bake_region_patches.py coast LSZH EGKK LFPO says so).
if bc.EUROPE:
    NEW_AIRPORTS += ['LSZH', 'EGKK', 'LFPO']
    PATCHES.update({
        'zurich': (8.33, 47.33, 8.77, 47.59),
        'gatwick': (-0.42, 51.075, 0.04, 51.225),      # v0.7.1: east to 0.04 E, with GLO-30's N51 E000 on disk
        'orly': (2.11, 48.62, 2.62, 48.84),
    })
    COAST += ['LSZH', 'EGKK', 'LFPO']
    FIELD_RUNWAYS = FIELD_RUNWAYS | {'LSZH', 'EGKK', 'LFPO'}
    FIELD_PAVEMENT = FIELD_PAVEMENT | {'LSZH', 'EGKK', 'LFPO'}
# v0.7.0, Schiphol and Barcelona, pending (the same staging; airports subagent 4): Schiphol ~37 x 38 km (six runways, the
# Polderbaan's 18R final ~15 km north; GLO-30 N52 E004 alone, so east only to 4.99 E: a missing tile would read 30 m, not
# the polders' -2 to -6 m); the field 3 to 4 m below sea level among the polders: Europe's heights keep land below 0 m
# (compose_height has no floor for Europe, height_to_i16_land stores no land cell as 0), and the flattening to the
# runways' negative elevations goes through as it is. Barcelona ~28 x 28 km (24R's and 02's finals over the sea, 06L's
# and 06R's over the Llobregat delta; GLO-30 N41 E001 and N41 E002). Both flattened to their runways' own profiles
# between the pavement's ends (displaced thresholds at both). Coast: bake_region_patches.py coast EHAM LEBL says.
if bc.EUROPE:
    NEW_AIRPORTS += ['EHAM', 'LEBL']
    PATCHES.update({
        'schiphol': (4.45, 52.16, 4.99, 52.50),
        'barcelona': (1.92, 41.17, 2.26, 41.42),
    })
    COAST += ['EHAM', 'LEBL']
    FIELD_RUNWAYS = FIELD_RUNWAYS | {'EHAM', 'LEBL'}
    FIELD_PAVEMENT = FIELD_PAVEMENT | {'EHAM', 'LEBL'}
# v0.7.0, Munich and Fiumicino, pending (the same staging; airports subagent 4): Munich ~30 x 19 km, east only to 11.96 E
# (GLO-30 N48 E011 alone: N48 E012 isn't downloaded, and a missing tile reads 30 m; at 11.995 the grid's north-east
# corner crossed 12 E), so 26L's and 26R's finals have the patch for ~11 km and the 250 m tiles beyond; Fiumicino ~31 x 36 km (16L/16R's finals over the land to the north,
# 34L/34R's and 07's over the sea; GLO-30 N41 E012). Both flattened to their runways' own profiles between the
# pavement's ends. Coast: bake_region_patches.py coast EDDM LIRF says.
if bc.EUROPE:
    NEW_AIRPORTS += ['EDDM', 'LIRF']
    PATCHES.update({
        'munich': (11.55, 48.27, 12.02, 48.44),        # v0.7.1: east to 12.02 E, with GLO-30's N48 E012 on disk
        'fiumicino': (12.07, 41.66, 12.44, 41.98),
    })
    COAST += ['EDDM', 'LIRF']
    FIELD_RUNWAYS = FIELD_RUNWAYS | {'EDDM', 'LIRF'}
    FIELD_PAVEMENT = FIELD_PAVEMENT | {'EDDM', 'LIRF'}
# v0.7.1, Toulouse, Berlin and Malpensa, pending (airports subagent 1; staged with FS_PATCH_OUT=/tmp/flight-sim/v071/
# airports/patches): Toulouse ~27 x 29 km (14/32's finals ~15 km out each way, 143 deg true; GLO-30 N43 E001 alone),
# Berlin ~33 x 15 km (07/25's finals ~15 km out each way, 068 deg true; GLO-30 N52 E013 alone), Malpensa ~23 x 36 km
# (17/35's finals ~15 km out, 169 deg true; GLO-30 N45 E008 alone). Each flattened to its runways' own profiles between
# the pavement's ends (Malpensa's 17L and 35L displaced). All inland: no coast patch.
if bc.EUROPE:
    NEW_AIRPORTS += ['LFBO', 'EDDB', 'LIMC']
    PATCHES.update({
        'toulouse': (1.20, 43.50, 1.53, 43.76),
        'berlin': (13.26, 52.30, 13.74, 52.43),
        'malpensa': (8.58, 45.47, 8.88, 45.79),
    })
    COAST += ['LFBO', 'EDDB', 'LIMC']
    FIELD_RUNWAYS = FIELD_RUNWAYS | {'LFBO', 'EDDB', 'LIMC'}
    FIELD_PAVEMENT = FIELD_PAVEMENT | {'LFBO', 'EDDB', 'LIMC'}
# v0.7.1, Lisbon, Copenhagen and Manchester, pending (airports subagent 3; staged with FS_PATCH_OUT=/tmp/flight-sim/v071/
# airports/patches3): Lisbon ~24 x 33 km (02/20's finals ~15 km out each way, 020 deg true, 02's over the city; GLO-30
# N38 W010 and N38 W009: the grid's south-east corner reaches 8.96 W), Copenhagen ~33 x 27 km (04/22's and 12/30's finals;
# the Oresund, Saltholm and Peberholm; GLO-30 N55 E012 alone), Manchester ~31 x 23 km (05/23's finals ~15 km out each
# way, 051 deg true; GLO-30 N53 W003 alone). Each flattened to its runways' own profiles between the pavement's ends
# (displaced thresholds at all three). Coast: bake_region_patches.py coast LPPT EKCH EGCC says.
if bc.EUROPE:
    NEW_AIRPORTS += ['LPPT', 'EKCH', 'EGCC']
    PATCHES.update({
        'lisbon': (-9.28, 38.63, -8.99, 38.93),   # east past 9 W so dem_tiles() reads N38 W009 too
        'copenhagen': (12.40, 55.50, 12.92, 55.74),
        'manchester': (-2.50, 53.25, -2.04, 53.46),
    })
    COAST += ['LPPT', 'EKCH', 'EGCC']
    FIELD_RUNWAYS = FIELD_RUNWAYS | {'LPPT', 'EKCH', 'EGCC'}
    FIELD_PAVEMENT = FIELD_PAVEMENT | {'LPPT', 'EKCH', 'EGCC'}
# v0.7.1, Vienna, Brussels and Dublin, pending (airports subagent 2; staged with FS_PATCH_OUT=/tmp/flight-sim/v071/
# airports/patches2): Vienna ~35 x 34 km (11/29's finals ~15 km out each way, 116 deg true; 16/34's, 164 deg, 34's to
# 47.95 N: GLO-30 N48 E016 and N47 E016), Brussels ~35 x 31 km (07/25's finals ~15 km out each way; 01's from 50.75 N,
# 19's to 51.04 N: GLO-30 N50 E004 and N51 E004), Dublin ~36 x 30 km (10/28's finals ~15 km out each way, 28L's and 28R's
# over Dublin Bay east of 6 W: GLO-30 N53 W007 and N53 W006). Each flattened to its runways' own profiles between the
# pavement's ends (Brussels's and Dublin's displaced thresholds). Coast: bake_region_patches.py coast EIDW says.
if bc.EUROPE:
    NEW_AIRPORTS += ['LOWW', 'EBBR', 'EIDW']
    PATCHES.update({
        'vienna': (16.33, 47.95, 16.80, 48.26),
        'brussels': (4.24, 50.75, 4.74, 51.04),
        'dublin': (-6.52, 53.29, -5.98, 53.56),
    })
    COAST += ['LOWW', 'EBBR', 'EIDW']
    FIELD_RUNWAYS = FIELD_RUNWAYS | {'LOWW', 'EBBR', 'EIDW'}
    FIELD_PAVEMENT = FIELD_PAVEMENT | {'LOWW', 'EBBR', 'EIDW'}

# v0.7.2, Duesseldorf, Cologne Bonn, Prague, Geneva and Nice, pending (airports subagent A; staged with FS_PATCH_OUT=
# /tmp/flight-sim/v072/airports/patches-a): Duesseldorf ~30 x 22 km (05/23's finals ~15 km out each way, 053 deg true;
# east to 7.01 E so GLO-30 N51 E007 is read beside N51 E006), Cologne Bonn ~31 x 30 km (13/31's finals at 137 deg and
# 06/24's at 064 deg; GLO-30 N50 and N51, E006 and E007), Prague ~35 x 23 km (06/24's and 12/30's finals; GLO-30 N49 and
# N50, E013 and E014), Geneva ~29 x 29 km (04/22's finals between the Jura and the Saleve, the lake's south-west end;
# GLO-30 N46 E005 and N46 E006), Nice ~25 x 24 km (04's finals over the sea, 22's up the coast; GLO-30 N43 E007). Each
# flattened to its runways' own profiles between the pavement's ends. Coast: bake_region_patches.py coast says.
if bc.EUROPE:
    NEW_AIRPORTS += ['EDDL', 'EDDK', 'LKPR', 'LSGG', 'LFMN']
    PATCHES.update({
        'duesseldorf': (6.55, 51.19, 7.01, 51.39),
        'cologne-bonn': (6.92, 50.74, 7.36, 51.01),
        'prague': (13.99, 49.99, 14.48, 50.20),
        'geneva': (5.92, 46.11, 6.30, 46.37),
        'nice': (7.06, 43.55, 7.37, 43.77),
    })
    COAST += ['EDDL', 'EDDK', 'LKPR', 'LSGG', 'LFMN']
    FIELD_RUNWAYS = FIELD_RUNWAYS | {'EDDL', 'EDDK', 'LKPR', 'LSGG', 'LFMN'}
    FIELD_PAVEMENT = FIELD_PAVEMENT | {'EDDL', 'EDDK', 'LKPR', 'LSGG', 'LFMN'}

# v0.7.2, Edinburgh, Glasgow, Nantes and Santiago, pending (airports subagent B; staged with FS_PATCH_OUT=
# /tmp/flight-sim/v072/airports/b/patches): Edinburgh ~31 x 22 km (06/24's finals at 059 deg; the Firth of Forth to the
# north; GLO-30 N55 and N56 W004), Glasgow ~29 x 24 km (05/23's finals at 046 deg beside the Clyde; GLO-30 N55 W005),
# Nantes ~26 x 31 km (03/21's finals at 027 deg; Lac de Grand-Lieu to the south-west; GLO-30 N46 and N47 W002),
# Santiago ~30 x 32 km (17/35's finals at 166 deg; GLO-30 N42 and N43 W009). Each flattened to its runway's own profile
# between the pavement's ends. Coast: bake_region_patches.py coast says.
if bc.EUROPE:
    NEW_AIRPORTS += ['EGPH', 'EGPF', 'LFRS', 'LEST']
    PATCHES.update({
        'edinburgh': (-3.62, 55.85, -3.12, 56.05),
        'glasgow': (-4.66, 55.76, -4.20, 55.965),    # (its grid's north-east corner stays south of 56 N: N56 is not read)
        'nantes': (-1.78, 47.02, -1.44, 47.30),
        'santiago': (-8.60, 42.75, -8.23, 43.04),
    })
    COAST += ['EGPH', 'EGPF', 'LFRS', 'LEST']
    FIELD_RUNWAYS = FIELD_RUNWAYS | {'EGPH', 'EGPF', 'LFRS', 'LEST'}
    FIELD_PAVEMENT = FIELD_PAVEMENT | {'EGPH', 'EGPF', 'LFRS', 'LEST'}

# v0.7.3, Lyon, Marseille, Hamburg and Innsbruck, pending (airports subagent A; staged with FS_PATCH_OUT=
# /tmp/flight-sim/v073/airports/patches): Lyon ~21 x 33 km (17/35's finals at 175 deg, ~15 km out each way; GLO-30 N45 E004
# and N45 E005), Marseille ~29 x 27 km (13/31's finals at 134 deg, the Etang de Berre to the west; GLO-30 N43 E005),
# Hamburg ~33 x 32 km (05/23's finals at 052 deg and 15/33's at 152 deg; GLO-30 N53 E009 and N53 E010), Innsbruck ~45 x
# 24 km along the Inn valley (08/26 at 080 deg: about 21 km beyond 08's end to the west and 20 km beyond 26's to the east,
# the valley's walls to 47.13 N and 47.39 N; GLO-30 N47 E011 alone). Each flattened to its runways' own profiles between
# the pavement's ends. Coast: bake_region_patches.py coast says.
if bc.EUROPE:
    NEW_AIRPORTS += ['LFLL', 'LFML', 'EDDH', 'LOWI']
    PATCHES.update({
        'lyon': (4.96, 45.58, 5.22, 45.88),
        'marseille': (5.05, 43.32, 5.40, 43.56),
        'hamburg': (9.75, 53.50, 10.22, 53.77),
        'innsbruck': (11.06, 47.17, 11.63, 47.35),
    })
    COAST += ['LFLL', 'LFML', 'EDDH', 'LOWI']
    FIELD_RUNWAYS = FIELD_RUNWAYS | {'LFLL', 'LFML', 'EDDH', 'LOWI'}
    FIELD_PAVEMENT = FIELD_PAVEMENT | {'LFLL', 'LFML', 'EDDH', 'LOWI'}

# v0.7.3, Gibraltar, Venice, Porto and Naples, pending (airports subagent B; staged with FS_PATCH_OUT=
# /tmp/flight-sim/v073/airports/b/patches): Gibraltar ~24 x 20 km, the whole Rock and the bay with Algeciras across it
# (09/27's finals at 088 deg: over the bay to the west, the sea east of the Rock; GLO-30 N36 W006 alone), Venice ~31 x 29 km
# over the lagoon (04/22's finals at 042 deg; GLO-30 N45 E012), Porto ~28 x 31 km by the coast (17/35's finals at 173 deg;
# GLO-30 N41 W009), Naples ~35 x 30 km taking in Vesuvius ~13 km south-east (06/24's finals at 058 deg; GLO-30 N40 and
# N41 E014). Each flattened to its runways' own profiles between the pavement's ends. Coast: bake_region_patches.py coast says.
if bc.EUROPE:
    NEW_AIRPORTS += ['LXGB', 'LIPZ', 'LPPR', 'LIRN']
    PATCHES.update({
        'gibraltar': (-5.50, 36.06, -5.26, 36.22),
        'venice': (12.17, 45.39, 12.54, 45.63),
        'porto': (-8.82, 41.12, -8.54, 41.38),
        'naples': (14.12, 40.75, 14.50, 41.005),   # (its box past 41 N: dem_tiles() reads N41 E014, where the grid's north corners lie)
    })
    COAST += ['LXGB', 'LIPZ', 'LPPR', 'LIRN']
    FIELD_RUNWAYS = FIELD_RUNWAYS | {'LXGB', 'LIPZ', 'LPPR', 'LIRN'}
    FIELD_PAVEMENT = FIELD_PAVEMENT | {'LXGB', 'LIPZ', 'LPPR', 'LIRN'}


def field_plane(icao, x0, y0, cell, nx, ny):
    """The plane through the runway ends (x, y, elevM) of data/airports/<icao>.json, at the grid's cell centres."""
    d = json.load(open(os.path.join(AIRPORT_DIR, icao + '.json')))
    E = np.array([(e['x'], e['y'], e['elevM']) for r in d['runways'] for e in r['ends']], float)
    A = np.c_[E[:, 0] - E[:, 0].mean(), E[:, 1] - E[:, 1].mean(), np.ones(len(E))]
    c = np.linalg.lstsq(A, E[:, 2], rcond=None)[0]
    X = x0 + (np.arange(nx) + 0.5) * cell - E[:, 0].mean()
    Y = y0 + (np.arange(ny) + 0.5) * cell - E[:, 1].mean()
    return (c[0] * X[None, :] + c[1] * Y[:, None] + c[2]).astype(np.float32)


# v0.7.4: fields flattened to their runways' profiles as the game bends them where two cross, not the straight lines
# between their ends (FIELD_RUNWAYS and FIELD_PAVEMENT with it). Prague: runways.js's CROSSING_LEVEL puts 06/24 at
# 353.6 m where 12/30 crosses it, 7.1 m under its straight line, and 12/30 bends to 06/24's edges; the patch baked to
# the straight lines left nine stands beside the crossing 0.9 to 3.7 m off the ground the game draws (ROADMAP, "Found
# while building v0.7.2"). The bends come from the game's own runwayCrossings() (node, runway_knots()), so the bake and
# the game can't drift apart; each profile is then profileAt()'s piecewise line through them, from end 0's pavement end.
# Only these airports: every other field keeps its straight profiles (its patch bakes byte-identical to v0.7.3's).
FIELD_BENT = {'LKPR'} if bc.EUROPE else set()


def runway_knots(icao):
    """{runway id: [[s, h], ...]}: runways.js's runwayCrossings() on data/<region>/airports/<icao>.json, run by node
    (s in metres from end 0's pavement end, as profileAt() reads them)."""
    import shutil
    import subprocess
    from urllib.parse import quote
    js_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src', 'world', 'runways.js')
    code = ("import fs from 'node:fs'; const { runwayCrossings } = await import(process.argv[1]);"
            " const ap = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); runwayCrossings(ap);"
            " process.stdout.write(JSON.stringify(Object.fromEntries(ap.runways.map((r) => [r.id, r.knots || []]))));")
    node = shutil.which('node') or 'node'
    out = subprocess.run([node, '--input-type=module', '-e', code, 'file://' + quote(js_path),
                          os.path.join(AIRPORT_DIR, icao + '.json')], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def field_runways(icao, x0, y0, cell, nx, ny):
    """FIELD_RUNWAYS: each runway's straight profile between its ends' elevations, blended by 1 / (1 + d^2) of the
    distance d (m) to its centreline segment, at the grid's cell centres (row by row). (FIELD_BENT, v0.7.4: each
    runway's profile through the game's bends instead.)"""
    d = json.load(open(os.path.join(AIRPORT_DIR, icao + '.json')))
    bent = None
    if icao in FIELD_BENT:
        assert icao in FIELD_PAVEMENT, icao + ': FIELD_BENT measures along the pavement, as profileAt() does'
        kn = runway_knots(icao)
        bent = [sorted(kn.get(r['id']) or []) for r in d['runways']]
        log(icao, 'FIELD_BENT: the bends', json.dumps({r['id']: k for r, k in zip(d['runways'], bent)}))
    if icao in FIELD_PAVEMENT:
        # v0.7.0: between the pavement's ends, as the game draws a runway's surface (runways.js runwayRects(): its ends'
        # elevations at the pavement's ends), so a displaced threshold's runway (Charles de Gaulle's 26R and 27L) has the
        # ground the game puts under it
        R = [((*r['ends'][0]['pavementEnd'], r['ends'][0]['elevM']), (*r['ends'][1]['pavementEnd'], r['ends'][1]['elevM']))
             for r in d['runways']]
    else:
        R = [((r['ends'][0]['x'], r['ends'][0]['y'], r['ends'][0]['elevM']), (r['ends'][1]['x'], r['ends'][1]['y'], r['ends'][1]['elevM']))
             for r in d['runways']]
    X = x0 + (np.arange(nx) + 0.5) * cell
    out = np.zeros((ny, nx), np.float32)
    for j in range(ny):
        y = y0 + (j + 0.5) * cell
        num_, den = np.zeros(nx), np.zeros(nx)
        for k, ((ax, ay, az), (bx, by, bz)) in enumerate(R):
            L = np.hypot(bx - ax, by - ay)
            ux, uy = (bx - ax) / L, (by - ay) / L
            t = np.clip((X - ax) * ux + (y - ay) * uy, 0, L)
            dd = np.hypot(X - ax - ux * t, y - ay - uy * t)
            w = 1.0 / (1.0 + dd * dd)
            if bent is not None and bent[k]:
                # profileAt(): the straight pieces through [0, e0], the bends, [L, e1]
                num_ += w * np.interp(t, [0.0] + [s for s, _ in bent[k]] + [L], [az] + [h for _, h in bent[k]] + [bz])
            else:
                num_ += w * (az + (bz - az) * t / L)
            den += w
        out[j] = num_ / den
    return out


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def airfields():
    """{icao: (polygon in map metres, elevation m)} from the airport JSONs (boundary is map metres)."""
    out = {}
    for icao in NEW_AIRPORTS:
        if bc.EUROPE and not os.path.exists(os.path.join(AIRPORT_DIR, icao + '.json')):
            continue    # (v0.7.0: Europe's airports arrive one by one)
        d = json.load(open(os.path.join(AIRPORT_DIR, icao + '.json')))
        g = Polygon(d['boundary'])
        if not g.is_valid:
            g = shapely.make_valid(g)
        out[icao] = (g, float(d['elevM']))
    return out


def dem_tiles(lon0, lat0, lon1, lat1):
    keys = {(la, lo) for la in range(int(np.floor(lat0)), int(np.floor(lat1)) + 1)
            for lo in range(int(np.floor(lon0)), int(np.floor(lon1)) + 1)}
    paths = []
    for la, lo in sorted(keys):
        p = os.path.join(bc.RAW, 'dem30', f'Copernicus_DSM_COG_10_{"N" if la >= 0 else "S"}{abs(la):02d}_00_'
                         f'{"E" if lo >= 0 else "W"}{abs(lo):03d}_00_DEM.tif')     # (v0.7.0: W west of Greenwich)
        if os.path.exists(p):
            paths.append(p)
        else:
            log('no GLO-30 tile', la, lo, '(sea, or missing)')
    return bh.load_tiles(paths)


def wc_fractions(x0, y0, cell, nx, ny, lonlat_box, classes, sub=3, rows=200):
    """Fraction of each WorldCover class over sub x sub points a cell (nearest 10 m pixel)."""
    D = brw.D
    lon0, lat0, lon1, lat1 = lonlat_box
    pad = 0.02
    r0 = int(np.floor((90 - (lat1 + pad)) / D)); r1 = int(np.ceil((90 - (lat0 - pad)) / D))
    c0 = int(np.floor((lon0 - pad + 180) / D)); c1 = int(np.ceil((lon1 + pad + 180) / D))
    wc = brw.WorldCover().window(r0, r1, c0, c1)
    log('worldcover window', wc.shape, 'decoded')
    out = {k: np.zeros((ny, nx), np.float32) for k in classes}
    offs = (np.arange(sub) + 0.5) / sub - 0.5
    for j0 in range(0, ny, rows):
        j1 = min(ny, j0 + rows)
        X, Y = bc.cell_centres(x0, y0 + j0 * cell, cell, nx, j1 - j0)
        for oy in offs:
            for ox in offs:
                lat, lon = bc.to_geo(X + ox * cell, Y + oy * cell)
                rr = np.clip(np.floor((90 - lat) / D).astype(np.int64) - r0, 0, wc.shape[0] - 1)
                cc = np.clip(np.floor((lon + 180) / D).astype(np.int64) - c0, 0, wc.shape[1] - 1)
                v = wc[rr, cc]
                for k in classes:
                    out[k][j0:j1] += (v == k)
    n = sub * sub
    for k in classes:
        out[k] /= n
    del wc
    return out


def patch_name(pid):
    return os.path.join(OUT, f'patch-{pid}.i16.gz')



# v0.7.3: land inside a box of the map (metres) never below a floor. Venice's old city: GLO-30 reads the islands at about
# the lagoon's level with noise either side (the patch had them at -0.5 m in the middle, 67 % of the city's cells below
# 0 m, a few to -6.75 m), so the city stood in a pit below its own water. The islands' land is raised to 1 m (the real
# pavements stand about 1 m over the lagoon); the lagoon itself (sea, exactly 0) and everything outside the box are as baked.
# (v0.7.4: land only, by the patch's own sea and inland-water masks, eased off outside the box: see cmd_patch. v0.7.3's
# floor raised the inland water inside the box too.)
LAND_FLOOR = {'venice': ((640500.0, -141500.0, 650500.0, -134500.0), 1.0)}
LAND_FLOOR_FEATHER_M = 300.0     # (v0.7.4: see cmd_patch)

def cmd_patch(pid, force):
    path = patch_name(pid)
    meta = path.replace('.i16.gz', '.json')
    if os.path.exists(path) and os.path.exists(meta) and not force:
        log(pid, 'done already; skip')
        return
    t0 = time.time()
    lon0, lat0, lon1, lat1 = PATCHES[pid]
    cell = 30.0
    x0, y0, nx, ny = bp.grid_for_box(lon0, lat0, lon1, lat1, cell)
    log(pid, 'grid', nx, 'x', ny, 'x0', x0, 'y0', y0)
    tiles = dem_tiles(lon0, lat0, lon1, lat1)
    dem = bh.resample(tiles, x0, y0, cell, nx, ny, sub=1)
    del tiles
    nan = int(np.isnan(dem).sum())
    log(pid, 'dem', 'nan cells', nan, 'range', float(np.nanmin(dem)), float(np.nanmax(dem)))

    lp = brw.LandPolys()
    land_geoms = lp.query(lon0 - 0.05, lat0 - 0.05, lon1 + 0.05, lat1 + 0.05)
    land_m = bg.rasterize(land_geoms, x0, y0, cell, nx, ny)
    del land_geoms
    sea_sd = bg.signed_distance(land_m, cell)
    land = land_m.astype(bool)
    del land_m
    log(pid, 'land fraction %.3f' % land.mean())

    fr = wc_fractions(x0, y0, cell, nx, ny, (lon0, lat0, lon1, lat1), (50, 80))
    # built-up: smoothed over ~210 m, as Korea's came from the 250 m cover grid (bilinear)
    urban = ndimage.uniform_filter(fr[50], size=7).astype(np.float32)
    # inland water: WorldCover water on land, specks (< ~2 ha) and one-cell slivers dropped
    wat = (fr[80] >= 0.5) & land
    del fr
    wat = ndimage.binary_opening(wat, structure=np.ones((3, 3), bool))
    lab, n = ndimage.label(wat)
    if n:
        sizes = ndimage.sum(np.ones_like(lab, np.int32), lab, index=np.arange(1, n + 1))
        keep = np.zeros(n + 1, bool)
        keep[1:] = sizes >= 25
        wat = keep[lab]
    del lab
    water_sd = -bg.signed_distance(wat, cell)
    log(pid, 'urban mean %.3f, inland water cells %d' % (float(urban.mean()), int(wat.sum())))
    inland = wat                    # (v0.7.4: kept for LAND_FLOOR, which raises land only)
    del wat, land

    aero = airfields()
    for icao in FIELD_PLANE & set(aero):
        aero[icao] = (aero[icao][0], field_plane(icao, x0, y0, cell, nx, ny))   # (compose_height blends it as an array)
    for icao in FIELD_RUNWAYS & set(aero):
        aero[icao] = (aero[icao][0], field_runways(icao, x0, y0, cell, nx, ny))
    h = bg.compose_height(dem, sea_sd, water_sd, urban, cell, x0, y0, airports=aero)
    del dem, water_sd, urban
    flat = []
    for icao, (poly, elev) in aero.items():
        bx = poly.bounds
        if bx[0] < x0 + nx * cell and bx[2] > x0 and bx[1] < y0 + ny * cell and bx[3] > y0:
            flat.append(icao)
    lf = LAND_FLOOR.get(pid)
    if lf:
        (bx0, by0, bx1, by1), floor = lf
        xs = x0 + (np.arange(nx) + 0.5) * cell; ys = y0 + (np.arange(ny) + 0.5) * cell
        # v0.7.4: land only, by the patch's own masks: not the sea (sea_sd <= 0) and not inland water (WorldCover's, as
        # compose_height() drew it: the lagoon round the old city is mostly inland water on OSM's land). v0.7.3 raised
        # every cell over sea_sd > 0, the lagoon's water in the box with the islands (from about -1.5 m to 1 m), a step
        # of 2 to 3.4 m in the water at the box's edge. The water is now as compose_height() left it everywhere, the
        # same inside the box as out. The floor's full inside the box (the islands as in v0.7.3) and eases off over
        # LAND_FLOOR_FEATHER_M outside it, so land the box's edge cuts (225 cell pairs of land across it at Venice)
        # ramps down to the baked ground instead of stepping by up to 4.5 m.
        dx = np.maximum(np.maximum(bx0 - xs, xs - bx1), 0.0); dy = np.maximum(np.maximum(by0 - ys, ys - by1), 0.0)
        w = 1.0 - bg.smoothstep(0.0, LAND_FLOOR_FEATHER_M, np.hypot(dy[:, None], dx[None, :]))
        low = (w > 0) & (sea_sd > 0) & ~inland & (h < floor)
        log(pid, 'LAND_FLOOR: %d land cells raised towards %.2f m, %d of them in the box (lowest was %.2f m); water left as baked'
            % (int(low.sum()), floor, int((low & (w >= 1)).sum()), float(h[low].min()) if low.any() else float('nan')))
        h = np.where(low, h + (floor - h) * w, h).astype(np.float32)
    del inland
    os.makedirs(OUT, exist_ok=True)
    bc.write_gz(path, bc.height_to_i16_land(h, sea_sd > 0) if bc.EUROPE else bc.height_to_i16(h))
    np.save(os.path.join(OUT, f'patch-{pid}.sea.npy'), (sea_sd > 0))  # for the quick-look
    entry = dict(id=pid, x0=float(x0), y0=float(y0), cell=cell, nx=nx, ny=ny, height=f'terrain/patch-{pid}.i16.gz')
    info = dict(entry=entry, box=PATCHES[pid], flattened=flat, max=float(h.max()), min=float(h.min()),
                bytes=os.path.getsize(path), seconds=round(time.time() - t0, 1))
    with open(meta + '.tmp', 'w') as f:
        json.dump(info, f, indent=1)
    os.replace(meta + '.tmp', meta)
    log(pid, json.dumps(info))


def cmd_coast(icao, force):
    path = os.path.join(OUT, f'coast-{icao}.u8.gz')
    meta = path.replace('.u8.gz', '.json')
    if os.path.exists(meta) and not force:
        log(icao, 'done already; skip')
        return
    t0 = time.time()
    d = json.load(open(os.path.join(AIRPORT_DIR, icao + '.json')))
    cell = 10.0
    size = bp.COAST_SIZE
    cx, cy = bc.to_map(d['lat'], d['lon'])
    n = int(size / cell)
    x0 = float(np.round((cx - size / 2) / cell) * cell)
    y0 = float(np.round((cy - size / 2) / cell) * cell)
    # lon/lat bounds of the square
    xs = np.array([x0, x0 + size, x0, x0 + size]); ys = np.array([y0, y0, y0 + size, y0 + size])
    lat, lon = bc.to_geo(xs, ys)
    lp = brw.LandPolys()
    geoms = lp.query(lon.min() - 0.02, lat.min() - 0.02, lon.max() + 0.02, lat.max() + 0.02)
    m = bg.rasterize(geoms, x0, y0, cell, n, n)
    sea = float((m == 0).mean())
    os.makedirs(OUT, exist_ok=True)
    info = dict(icao=icao, seaFraction=round(sea, 4), seconds=None)
    if sea > 0:
        sd = bg.signed_distance(m, cell)
        bc.write_gz(path, bc.signed_to_u8(sd, 2))
        info['entry'] = dict(id=icao, x0=x0, y0=y0, cell=cell, nx=n, ny=n, coast=f'terrain/coast-{icao}.u8.gz')
        info['bytes'] = os.path.getsize(path)
        info['nearestSeaM'] = float(sd[n // 2, n // 2]) if sd[n // 2, n // 2] > 0 else 0.0
    else:
        info['entry'] = None
        info['note'] = 'square is all land: no coast patch'
    info['seconds'] = round(time.time() - t0, 1)
    with open(meta + '.tmp', 'w') as f:
        json.dump(info, f, indent=1)
    os.replace(meta + '.tmp', meta)
    log(icao, json.dumps(info))


def hillshade(h, cell, az=315, alt=45):
    gy, gx = np.gradient(h, cell)
    gy = -gy  # row 0 = south: flip so north is up after south_up_to_image
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, z = np.radians(az), np.radians(90 - alt)
    return np.clip(np.cos(z) * np.cos(slope) + np.sin(z) * np.sin(slope) * np.cos(a - aspect), 0, 1)


def cmd_quicklook(pid):
    meta = json.load(open(patch_name(pid).replace('.i16.gz', '.json')))
    e = meta['entry']
    h = bc.read_gz(patch_name(pid), '<i2', (e['ny'], e['nx'])).astype(np.float32) * 0.25
    f = max(1, int(np.ceil(max(e['nx'], e['ny']) / 1600)))
    if f > 1:
        ny, nx = (e['ny'] // f) * f, (e['nx'] // f) * f
        h = h[:ny, :nx].reshape(ny // f, f, nx // f, f).mean(axis=(1, 3))
    cell = e['cell'] * f
    hs = hillshade(h, cell)
    land = h > 0
    t = np.clip(h / max(200.0, float(h.max())), 0, 1)
    base = np.stack([0.35 + 0.45 * t, 0.55 + 0.15 * t, 0.30 + 0.45 * t], -1)
    shade = (0.35 + 0.75 * hs)[..., None]
    rgb = np.where(land[..., None], base * shade, np.array([0.12, 0.25, 0.45]) * (1 + h[..., None] / 80))
    # airfields (flat to 0.3 m of elevM) in orange
    for icao in meta['flattened']:
        d = json.load(open(os.path.join(AIRPORT_DIR, icao + '.json')))
        g = Polygon(d['boundary']).buffer(0)
        inside = bg.rasterize(g, e['x0'], e['y0'], cell, h.shape[1], h.shape[0]).astype(bool)
        edge = inside & ~ndimage.binary_erosion(inside, iterations=2)
        rgb[edge] = (1.0, 0.55, 0.1)
    rgb = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
    out = os.path.join(bc.SHOTS, f'v060-bake-patch-{pid}.png')
    bc.write_png(out, bc.south_up_to_image(rgb))
    log('wrote', out, rgb.shape)


def cmd_manifest():
    patches, coasts, report = [], [], {}
    for pid in PATCHES:
        p = patch_name(pid).replace('.i16.gz', '.json')
        if os.path.exists(p):
            patches.append(json.load(open(p))['entry'])
        else:
            report[pid] = 'missing'
    for icao in COAST:
        p = os.path.join(OUT, f'coast-{icao}.json')
        if not os.path.exists(p):
            report[icao] = 'missing'
            continue
        m = json.load(open(p))
        if m['entry']:
            coasts.append(m['entry'])
        else:
            report[icao] = 'all land: no coast patch'
    out = os.path.join(OUT, 'manifest-patches.json')
    with open(out + '.tmp', 'w') as f:
        json.dump(dict(patches=patches, coastPatches=coasts), f, indent=1)
    os.replace(out + '.tmp', out)
    log('wrote', out, len(patches), 'patches', len(coasts), 'coasts', report)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['patch', 'coast', 'quicklook', 'manifest'])
    ap.add_argument('ids', nargs='*')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    if a.cmd == 'manifest':
        return cmd_manifest()
    for i in a.ids:
        if a.cmd == 'patch':
            cmd_patch(i, a.force)
        elif a.cmd == 'coast':
            cmd_coast(i, a.force)
        else:
            cmd_quicklook(i)


if __name__ == '__main__':
    main()
