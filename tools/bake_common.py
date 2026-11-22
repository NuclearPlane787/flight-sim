"""Shared helpers for Flight Sim's bake scripts (tools/bake_*.py).

- The map frame: a numpy port of src/world/frame.js (Lambert conformal conic on WGS84,
  origin 36N 127.5E, standard parallels 33 and 38). Keep it identical to frame.js.
- The national grid (cell-centred, row 0 = south) and the paths.
- Writers for the gzipped little-endian grids and quick-look PNGs.

Run every bake script with the venv's Python and -I, through tools/cpu-guard.py:
  python3 tools/cpu-guard.py -- /tmp/flight-sim/venv/bin/python -I tools/bake_height.py
Order: bake_height, bake_osm_extract, bake_water, bake_airports, bake_cover, bake_patches
(tools/bake_all.sh runs them in order, one guarded command each).
"""
import gzip
import json
import os
import struct
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
RAW = os.path.join(GAME, 'reference', 'raw')
DATA = os.path.join(GAME, 'data')
# v0.7.0: the region. FS_REGION=europe selects Europe's frame and lattice; unset (or anything
# else) is East Asia, exactly as before.
REGION = 'europe' if os.environ.get('FS_REGION', '').strip().lower() == 'europe' else 'eastasia'
EUROPE = REGION == 'europe'


# v0.7.4 (fix 7, "Found while building v0.7.0"): v0.7.0 retired Korea's own national files and tiles from data/
# (terrain/l0/, terrain/l1/, terrain/height.i16.gz, water.rg8.gz, cover.rgba8.gz, coast.json, the old r0 <tile>.c
# cover, and the manifest's `national`, `tiles` and `cover2`). A tool, or a mode of one, that reads or rewrites them
# stops here with a line naming them, so that no later run writes old data by mistake.
def refuse_retired(tool, files, note=''):
    import sys
    sys.exit(f"{tool}: stopped, nothing read or written. It needs {files}, retired from data/ in v0.7.0 "
             f"(Korea's old national files and tiles; the repository's history before v0.7.0 has them)."
             + (' ' + note if note else ''))
EU_BATCH = os.environ.get('FS_EUROPE_BATCH', 'B').strip().upper() if EUROPE else None   # v0.7.1: the Europe batch baked
CACHE = ({'A': '/tmp/flight-sim/v070/work/cache', 'C': '/tmp/flight-sim/v072/work/cache', 'D': '/tmp/flight-sim/v073/work/cache', 'E': '/tmp/flight-sim/v076/work/cache'}.get(EU_BATCH, '/tmp/flight-sim/v071/work/cache') if EUROPE else '/tmp/flight-sim/bake')   # v0.7.2: batch C's own   # intermediate results (resumable pieces)
EXTRA_DEM90 = os.path.join(CACHE, 'dem90extra')  # N32 and N39 GLO-90 tiles, fetched by the bake
SHOTS = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'Claude outputs', 'flight-sim'))  # GameDump/Claude outputs/flight-sim

os.makedirs(CACHE, exist_ok=True)
os.makedirs(os.path.join(DATA, 'terrain'), exist_ok=True)
os.makedirs(os.path.join(DATA, 'airports'), exist_ok=True)

# ---------------------------------------------------------------- map frame (frame.js)
DEG = np.pi / 180
A = 6378137.0
F = 1 / 298.257223563
E = np.sqrt(2 * F - F * F)
LAT0, LON0, LAT1, LAT2 = 36.0, 127.5, 33.0, 38.0
if EUROPE:   # Europe's frame (briefs/V0-7-0.md): origin 47 N 4 E, standard parallels 39 and 54
    LAT0, LON0, LAT1, LAT2 = 47.0, 4.0, 39.0, 54.0


def _m(phi):
    return np.cos(phi) / np.sqrt(1 - E * E * np.sin(phi) ** 2)


def _t(phi):
    es = E * np.sin(phi)
    return np.tan(np.pi / 4 - phi / 2) / ((1 - es) / (1 + es)) ** (E / 2)


_m1, _m2 = _m(LAT1 * DEG), _m(LAT2 * DEG)
_t0, _t1, _t2 = _t(LAT0 * DEG), _t(LAT1 * DEG), _t(LAT2 * DEG)
N = (np.log(_m1) - np.log(_m2)) / (np.log(_t1) - np.log(_t2))
FF = _m1 / (N * _t1 ** N)
RHO0 = A * FF * _t0 ** N


def to_map(lat, lon):
    """Geographic degrees -> map metres (x, y). Works on scalars and arrays."""
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    rho = A * FF * _t(lat * DEG) ** N
    theta = N * (lon - LON0) * DEG
    return rho * np.sin(theta), RHO0 - rho * np.cos(theta)


def to_geo(x, y):
    """Map metres -> geographic degrees (lat, lon)."""
    x = np.asarray(x, dtype=np.float64)
    dy = RHO0 - np.asarray(y, dtype=np.float64)
    rho = np.sqrt(x * x + dy * dy)
    theta = np.arctan2(x, dy)
    tt = (rho / (A * FF)) ** (1 / N)
    phi = np.pi / 2 - 2 * np.arctan(tt)
    for _ in range(8):
        es = E * np.sin(phi)
        phi = np.pi / 2 - 2 * np.arctan(tt * ((1 - es) / (1 + es)) ** (E / 2))
    return phi / DEG, theta / N / DEG + LON0


def scale_factor(lat):
    """The frame's point scale k at a latitude (map length = k x true length on the ellipsoid)."""
    phi = np.asarray(lat, dtype=np.float64) * DEG
    rho = A * FF * _t(phi) ** N
    return rho * N / (A * _m(phi))


def frame():
    """The region's frame parameters (for notes and checks)."""
    return dict(region=REGION, lat0=LAT0, lon0=LON0, lat1=LAT1, lat2=LAT2, n=float(N), rho0=float(RHO0))


def convergence_deg(lon):
    """Grid convergence in degrees: grid azimuth = true azimuth - convergence."""
    return N * (np.asarray(lon) - LON0)


def mag_var(lat, lon):
    """Magnetic declination (deg, east +), the same plane as frame.js."""
    return -8.46 - 0.378 * (lat - 36) + 0.082 * (lon - 127.5)


# ---------------------------------------------------------------- grids
NAT = dict(x0=-400000.0, y0=-400000.0, cell=250.0, nx=3200, ny=3200)
if EUROPE:   # Europe's lattice origin is the frame's origin (tile 0_0's SW corner at 47 N 4 E);
    NAT = dict(x0=0.0, y0=0.0, cell=250.0, nx=0, ny=0)   # no national grid: nx/ny unused


def lattice():
    """The region's tile lattice: x0/y0 (map m of lattice cell (0, 0)'s SW corner), the 250 m level
    in 128 km tiles (512 cells, 2-cell borders), the 1 km level in 512 km tiles, the 31 m cover in
    32 km sub-files. Tile (ti, tj)'s core covers x0 + ti*128 km .. +128 km (negative ti/tj allowed)."""
    return dict(x0=NAT['x0'], y0=NAT['y0'], l0=dict(cell=250.0, tile=512, border=2),
                l1=dict(cell=1000.0, tile=512, border=2), fine=dict(px=31.25, sub=1024, perTile=4))


# Europe's outline (lat, lon), briefs/V0-7-0.md: it bounds the 1 km land, the map's edge and the path.
EU_OUTLINE = [(35.0, -11.0), (59.0, -11.0), (59.0, 19.5), (42.5, 19.5), (39.6, 18.6),
              (36.3, 16.0), (36.3, 12.0), (37.6, 11.0), (37.6, 1.0), (35.0, -2.5)]


def outline_latlon(step=0.25):
    """Europe's outline densified: each edge linear in lat/lon (so the edges between points on one
    parallel or meridian run along it), a point at least every `step` degrees. Returns (lat, lon)
    arrays of the closed ring (first point not repeated)."""
    la, lo = [], []
    pts = EU_OUTLINE
    for k in range(len(pts)):
        (a0, o0), (a1, o1) = pts[k], pts[(k + 1) % len(pts)]
        n = max(1, int(np.ceil(max(abs(a1 - a0), abs(o1 - o0)) / step)))
        t = np.arange(n) / n
        la.append(a0 + (a1 - a0) * t)
        lo.append(o0 + (o1 - o0) * t)
    return np.concatenate(la), np.concatenate(lo)


def tile_of(x, y, cell=250.0, tile=512):
    """The (ti, tj) of the tile holding map point (x, y) (floor: negative west/south of x0, y0)."""
    span = cell * tile
    return int(np.floor((x - NAT['x0']) / span)), int(np.floor((y - NAT['y0']) / span))


def cell_centres(x0, y0, cell, nx, ny):
    """2-D arrays (ny, nx) of cell-centre map coordinates; row 0 is the south row."""
    xs = x0 + (np.arange(nx) + 0.5) * cell
    ys = y0 + (np.arange(ny) + 0.5) * cell
    return np.meshgrid(xs, ys)


def write_gz(path, arr):
    """Write a little-endian array, gzipped. Row 0 = south."""
    arr = np.ascontiguousarray(arr)
    if arr.dtype.byteorder == '>':
        arr = arr.byteswap().newbyteorder()
    tmp = path + '.tmp'
    with gzip.open(tmp, 'wb', compresslevel=9) as f:
        f.write(arr.tobytes())
    os.replace(tmp, path)   # atomic: readers never see a half-written file


def read_gz(path, dtype, shape):
    with gzip.open(path, 'rb') as f:
        return np.frombuffer(f.read(), dtype=dtype).reshape(shape)


def height_to_i16(h):
    """Metres -> int16 in 0.25 m units (the manifest's heightScale)."""
    return np.clip(np.round(h / 0.25), -32768, 32767).astype('<i2')


def height_to_i16_land(h, land):
    """v0.7.0, Europe's height encoding: height_to_i16, then a land cell (land: bool, sea_sd > 0,
    inland water included) never stores exactly 0 (0 means sea): +1 step if h >= 0, -1 if below.
    Sea cells are expected to be exactly 0 m already (compose_height for Europe)."""
    q = height_to_i16(h)
    z = (q == 0) & np.asarray(land, bool)
    if z.any():
        q = q.copy()
        q[z] = np.where(np.asarray(h)[z] >= 0, 1, -1).astype('<i2')
    return q


def signed_to_u8(d, per):
    """Signed distance (m) -> 128 + d/per, clamped to 0..255."""
    return np.clip(np.round(128 + d / per), 0, 255).astype(np.uint8)


# ---------------------------------------------------------------- manifest
MANIFEST = os.path.join(DATA, 'manifest.json')


def update_manifest(**fields):
    m = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST) as f:
            m = json.load(f)
    m.setdefault('national', {})
    for k, v in fields.items():
        if k == 'national':
            m['national'].update(v)
        else:
            m[k] = v
    m.setdefault('heightScale', 0.25)
    with open(MANIFEST + '.tmp', 'w') as f:
        json.dump(m, f, indent=2)
    os.replace(MANIFEST + '.tmp', MANIFEST)


# ---------------------------------------------------------------- quick-look PNGs
def write_png(path, rgb):
    """rgb: (h, w, 3) uint8, row 0 at the TOP of the image. Plain zlib PNG writer."""
    rgb = np.ascontiguousarray(rgb, dtype=np.uint8)
    h, w, _ = rgb.shape
    raw = b''.join(b'\x00' + rgb[r].tobytes() for r in range(h))

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(png)


def south_up_to_image(a):
    """Grids are row 0 = south; images are row 0 = top (north)."""
    return a[::-1]


def progress(note):
    """Append a line to the lead's progress note."""
    with open(os.path.join(CACHE, 'progress.md'), 'a') as f:
        f.write(note.rstrip() + '\n')
