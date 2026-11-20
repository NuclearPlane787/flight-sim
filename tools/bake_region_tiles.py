"""The region's 250 m tile list and the bake's staging folders, shared by the region bake scripts
(bake_region_height, _water, _cover, _compose, _fine, _l1, _coast).

The l0 tiles (512 cells of 250 m on Korea's lattice, named <ti>_<tj>) are, in this order:
  1. v0.6.0's 180: every tile meeting the box 29-40 N, 119-142 E, enumerated exactly as v0.6.0
     did (bake_region_height.box_tiles(): tj outer, ti inner);
  2. v0.6.3's 26 (briefs/V0-6-3.md, Part 1), fitted to Beijing, Shenyang and Vladivostok and the
     routes between them rather than a rectangle: EXTRA below, in the brief's order.
bake_region_height.region_tiles() returns the two together; OLD/NEW split them.

Staging: v0.6.0's staging (/tmp/flight-sim/v060/bake) is read-only and holds the 180 old tiles'
layers; v0.6.3 writes the new tiles' layers to /tmp/flight-sim/v063/bake in the same layout.
find(kind, file) returns the v0.6.3 file if there is one, else the v0.6.0 one (else the v0.6.3
path, which doesn't exist yet), so every step reads old and new tiles alike and writes only new.
"""
import os

EXTRA = ['-5_6', '-5_7', '-4_3', '-4_4', '-4_5', '-4_6', '-4_7', '-3_7',          # Beijing, the Beijing-Shanghai route
         '-2_7', '-1_7', '0_7', '1_7', '2_7', '3_7', '4_7',                      # to Shenyang, North Korea's north
         '-1_8', '0_8', '1_8', '2_8', '3_8', '4_8', '5_8', '3_9', '4_9', '5_9', '6_9']   # to Vladivostok, Paektu
EXTRA_TILES = [tuple(int(v) for v in s.split('_')) for s in EXTRA]

STAGE_OLD = '/tmp/flight-sim/v060/bake'       # v0.6.0's staging: READ-ONLY
STAGE = '/tmp/flight-sim/v063/bake'           # v0.6.3's staging: the new tiles' layers
WORK = '/tmp/flight-sim/v063/work'            # v0.6.3's work state (fine cover's per-tile state, logs)


def find(kind, fname):
    """The staged file kind/fname: v0.6.3's if it exists, else v0.6.0's, else v0.6.3's path."""
    p = os.path.join(STAGE, kind, fname)
    if os.path.exists(p):
        return p
    q = os.path.join(STAGE_OLD, kind, fname)
    return q if os.path.exists(q) else p


def new_path(kind, fname):
    """Where v0.6.3 writes kind/fname (the folder is made)."""
    d = os.path.join(STAGE, kind)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, fname)
