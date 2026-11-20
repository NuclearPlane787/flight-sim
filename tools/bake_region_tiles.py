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
VERSION = os.environ.get('FLIGHT_SIM_TILES_VERSION', BATCHES[-1][0])
_k = [b[0] for b in BATCHES].index(VERSION)

STAGE_OLD = '/tmp/flight-sim/v060/bake'       # v0.6.0's staging: READ-ONLY
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
