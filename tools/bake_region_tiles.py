"""The region's 250 m tile list and the bake's staging folders, shared by the region bake scripts
(bake_region_height, _water, _cover, _compose, _fine, _l1, _coast).

The l0 tiles (512 cells of 250 m on Korea's lattice, named <ti>_<tj>) are, in this order:
  1. v0.6.0's 180: every tile meeting the box 29-40 N, 119-142 E, enumerated exactly as v0.6.0
     did (bake_region_height.box_tiles(): tj outer, ti inner);
  2. v0.6.3's 26 (briefs/V0-6-3.md, Part 1), fitted to Beijing, Shenyang and Vladivostok and the
     routes between them rather than a rectangle, in the brief's order;
  3. v0.6.4's 10 (briefs/V0-6-4.md, part 1): Hokkaido, in the brief's order.
Each later batch is a BATCHES entry with its own staging. The batch being baked is
FLIGHT_SIM_TILES_VERSION (default: the last, '0.6.4'); '0.6.3' gives v0.6.3's run exactly as it was
(its tiles new, its staging, v0.6.4's tiles not in the region at all).
  EXTRA: every batch's tiles up to and including the one baked (the region = box + EXTRA);
  NEW / NEW_TILES: the baked batch's own; OLD_EXTRA_TILES: the earlier batches'.
bake_region_height.region_tiles() returns box + EXTRA; old_tiles()/new_tiles() split them.

Staging: v0.6.0's (/tmp/flight-sim/v060/bake) and every earlier batch's are read-only; the baked
batch writes its new tiles' layers to its own STAGE in the same layout. find(kind, file) returns the
newest staged copy (this batch's, then earlier batches' newest first, then v0.6.0's; else this
batch's path, which doesn't exist yet), so every step reads old and new tiles alike and writes only new.
"""
import os

EXTRA_063 = ['-5_6', '-5_7', '-4_3', '-4_4', '-4_5', '-4_6', '-4_7', '-3_7',          # Beijing, the Beijing-Shanghai route
             '-2_7', '-1_7', '0_7', '1_7', '2_7', '3_7', '4_7',                      # to Shenyang, North Korea's north
             '-1_8', '0_8', '1_8', '2_8', '3_8', '4_8', '5_8', '3_9', '4_9', '5_9', '6_9']   # to Vladivostok, Paektu
EXTRA_064 = ['10_8', '11_8', '12_8', '11_9', '12_9', '13_9', '11_10', '12_10', '13_10', '14_10']   # Hokkaido

# (version, staging, work, tiles), oldest first
BATCHES = [
    ('0.6.3', '/tmp/flight-sim/v063/bake', '/tmp/flight-sim/v063/work', EXTRA_063),
    ('0.6.4', '/tmp/flight-sim/v064/bake', '/tmp/flight-sim/v064/work', EXTRA_064),
]
STAGE_OLD = '/tmp/flight-sim/v060/bake'       # v0.6.0's staging: READ-ONLY

# v0.7.0: Europe, a region of its own (FS_REGION=europe; see bake_common.REGION). Its lattice's
# origin is its frame's origin, so tile indices are negative west and south of 47 N 4 E. Batch A:
# every 128 km tile with land within 200 km of airports 1 to 11 (briefs/V0-7-0.md, from Natural
# Earth's 1:50 m land). Later batches (v0.7.1 ...) are appended to EU_BATCHES with their own staging.
REGION = 'europe' if os.environ.get('FS_REGION', '').strip().lower() == 'europe' else 'eastasia'
EU_BATCH_A = ('-7_-7 -7_-6 -7_-5 -6_-7 -6_-6 -6_-5 -6_-4 -5_-7 -5_-6 -5_-5 -5_-4 -4_-7 -4_-6 -4_-5 -4_2 -4_3 '
              '-4_4 -4_5 -3_-6 -3_-5 -3_-4 -3_0 -3_1 -3_2 -3_3 -3_4 -3_5 -2_-7 -2_-6 -2_-5 -2_-4 -2_-1 -2_0 '
              '-2_1 -2_2 -2_3 -2_4 -2_5 -1_-7 -1_-5 -1_-4 -1_-1 -1_0 -1_1 -1_2 -1_3 -1_4 0_0 0_1 0_2 0_3 0_4 '
              '0_5 1_-1 1_0 1_1 1_2 1_3 1_4 1_5 2_-2 2_-1 2_0 2_1 2_2 2_3 2_4 3_-4 3_-2 3_-1 3_0 3_1 3_2 3_3 '
              '3_4 4_-4 4_-3 4_-1 4_0 4_1 4_2 4_3 5_-5 5_-4 5_-3 5_-1 5_0 5_1 5_2 6_-6 6_-5 6_-4 6_-3').split()
# v0.7.1: batch B: the same rule over all twenty airports (briefs/V0-7-1.md part 2), less batch A
# (tools/bake_europe_tilelist.py: Natural Earth 1:10 m united with OSM's land polygons).
EU_BATCH_B = ('-10_-8 -10_-7 -10_-6 -9_-8 -9_-7 -9_-6 -9_-5 -8_-8 -8_-7 -8_-6 -7_4 -7_5 -7_6 -7_7 -6_4 -6_5 -6_6 '
              '-6_7 -5_4 -5_5 -5_6 -5_7 -4_-4 -4_-3 -4_6 -4_7 -3_-7 -3_-3 -3_-2 -3_6 -3_7 -2_-3 -2_-2 -1_-3 -1_-2 '
              '1_-3 1_-2 2_-3 2_6 2_7 2_8 3_-3 3_5 3_6 3_7 3_8 3_9 4_-2 4_4 4_5 4_6 4_7 4_8 4_9 5_3 5_4 5_5 5_6 5_7 '
              '5_8 5_9 6_-1 6_0 6_1 6_2 6_3 6_4 6_5 6_6 7_-1 7_0 7_1 7_2 7_3 8_0 8_1 8_2').split()   # 77: airports 12-20's 75, and 6_1, -3_-7
# v0.7.2: batch C: the rule over all twenty-nine airports (briefs/V0-7-2.md part 1), less batches A and B.
EU_BATCH_C = ('-9_-4 -9_-3 -8_-5 -8_-4 -8_-3 -7_-4 -7_-3 -6_8 -6_9 -5_0 -5_1 -5_8 -5_9 -4_-2 -4_-1 -4_0 -4_1 -4_8 -4_9 -3_-1 -3_8 -3_9 0_-4 0_-3 0_-2 0_-1 1_-4 2_-5 2_-4 2_5 3_-5').split()   # 31: tools/bake_europe_tilelist.py
# v0.7.3: batch D: the rule over all thirty-seven airports (briefs/V0-7-3.md part 1), less batches A, B and C.
EU_BATCH_D = ('-8_-10 -8_-9 -7_-11 -7_-10 -7_-9 -7_-8 -6_-11 -6_-10 -6_-9 -6_-8 1_6 5_-2 6_-2 7_-6 7_-5 7_-4 8_-6 8_-5').split()   # 18: tools/bake_europe_tilelist.py
EU_BATCHES = [
    ('A', '/tmp/flight-sim/v070/bake', '/tmp/flight-sim/v070/work', EU_BATCH_A),
    ('B', '/tmp/flight-sim/v071/bake', '/tmp/flight-sim/v071/work', EU_BATCH_B),
    ('C', '/tmp/flight-sim/v072/bake', '/tmp/flight-sim/v072/work', EU_BATCH_C),
    ('D', '/tmp/flight-sim/v073/bake', '/tmp/flight-sim/v073/work', EU_BATCH_D),
]
if REGION == 'europe':
    BATCHES = EU_BATCHES
    STAGE_OLD = EU_BATCHES[0][1]      # no older staging: the first batch's own (find() falls back to it)
VERSION = os.environ.get('FLIGHT_SIM_TILES_VERSION', BATCHES[-1][0])
if REGION == 'europe':
    VERSION = os.environ.get('FS_EUROPE_BATCH', BATCHES[-1][0])
_k = [b[0] for b in BATCHES].index(VERSION)

STAGE = BATCHES[_k][1]                        # the baked batch's staging: its new tiles' layers
WORK = BATCHES[_k][2]                         # its work state (fine cover's per-tile state, logs)
STAGES_EARLIER = [b[1] for b in BATCHES[:_k]][::-1]   # earlier batches' staging, newest first: READ-ONLY
WORKS_EARLIER = [b[2] for b in BATCHES[:_k]][::-1]    # their work folders, newest first: READ-ONLY

NEW = list(BATCHES[_k][3])
EXTRA = [t for b in BATCHES[:_k + 1] for t in b[3]]
NEW_TILES = [tuple(int(v) for v in s.split('_')) for s in NEW]
EXTRA_TILES = [tuple(int(v) for v in s.split('_')) for s in EXTRA]
OLD_EXTRA_TILES = [t for t in EXTRA_TILES if t not in set(NEW_TILES)]


def find(kind, fname):
    """The staged file kind/fname: this batch's if it exists, else the newest earlier one's, else
    v0.6.0's, else this batch's path."""
    p = os.path.join(STAGE, kind, fname)
    if os.path.exists(p):
        return p
    for d in STAGES_EARLIER + [STAGE_OLD]:
        q = os.path.join(d, kind, fname)
        if os.path.exists(q):
            return q
    return p


def new_path(kind, fname):
    """Where this batch writes kind/fname (the folder is made)."""
    d = os.path.join(STAGE, kind)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, fname)
