"""WMM2025's magnetic declination on a grid in the map frame (briefs/V0-6-0.md, Part 2 step 1 and
Part 5 step 1: "Magnetic variation" under "Decided in the Cowork session").

A short spherical-harmonics routine (NOAA NCEI's World Magnetic Model, public domain):
geodetic -> geocentric spherical coordinates on WGS84, Schmidt semi-normalised associated
Legendre functions to degree 12, the main field plus secular variation to the epoch. It is
first checked against every row of NOAA's WMM2025_TEST_VALUES.txt (declination to 0.01 deg),
then baked over the margin box (24-46 N, 112-148 E) at altitude 0, epoch 2026.0.

Why a map-frame grid (10 km cells) and not a 0.1 deg lat/lon grid: the game asks for the
variation at map points (x, y), and on a map-frame grid that is one bilinear lookup with no
toGeo() (an 8-step iteration) per call; the country raster uses the same frame. The field is
smooth (under 0.1 deg per 100 km here), so 10 km cells interpolate to well under 0.001 deg.

Outputs:
  data/magvar.i16.gz   int16 little-endian, ny rows x nx, row 0 = south, cell-centred,
                       declination = value * scale (degrees, east positive)
  data/magvar.json     the header

Run (from the game folder):
  python3 tools/cpu-guard.py --minutes 5 -- /tmp/flight-sim/venv/bin/python -I tools/bake_wmm.py
"""
import io
import json
import os
import sys
import zipfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import DATA, RAW, to_geo, to_map, mag_var, write_gz  # noqa: E402

COF_ZIP = os.path.join(RAW, 'wmm', 'WMM2025COF.zip')
TESTS = os.path.join(RAW, 'wmm', 'WMM2025_TEST_VALUES.txt')
EPOCH = 2026.0
NMAX = 12

# The grid: the margin box's extent in the map frame, rounded out to 10 km.
GRID = dict(x0=-1600000.0, y0=-1340000.0, cell=10000.0, nx=371, ny=263)
SCALE = 0.001   # degrees per unit


def read_cof():
    with zipfile.ZipFile(COF_ZIP) as z:
        text = z.read('WMM2025COF/WMM.COF').decode('ascii')
    lines = text.splitlines()
    epoch = float(lines[0].split()[0])
    g = np.zeros((NMAX + 1, NMAX + 1)); h = np.zeros_like(g)
    gd = np.zeros_like(g); hd = np.zeros_like(g)
    for ln in lines[1:]:
        p = ln.split()
        if len(p) < 6 or p[0].startswith('9999'):
            break
        n, m = int(p[0]), int(p[1])
        g[n, m], h[n, m], gd[n, m], hd[n, m] = map(float, p[2:6])
    return epoch, g, h, gd, hd


EPOCH0, G0, H0, GD, HD = read_cof()

# Schmidt factors for the Gauss-normalised recursion.
_S = np.zeros((NMAX + 1, NMAX + 1)); _S[0, 0] = 1.0
for n in range(1, NMAX + 1):
    _S[n, 0] = _S[n - 1, 0] * (2 * n - 1) / n
    for m in range(1, n + 1):
        _S[n, m] = _S[n, m - 1] * np.sqrt((n - m + 1) * (2 if m == 1 else 1) / (n + m))
_K = np.zeros((NMAX + 1, NMAX + 1))
for n in range(2, NMAX + 1):
    for m in range(0, n):
        _K[n, m] = ((n - 1) ** 2 - m ** 2) / ((2 * n - 1) * (2 * n - 3))


def field(lat, lon, h_km, year):
    """Geodetic lat/lon (deg), height above the ellipsoid (km), decimal year ->
    (X north, Y east, Z down) in nT, geodetic frame. Arrays broadcast."""
    lat = np.asarray(lat, float); lon = np.asarray(lon, float); h_km = np.asarray(h_km, float)
    a, f = 6378.137, 1 / 298.257223563
    e2 = f * (2 - f)
    phi = np.radians(lat); lam = np.radians(lon)
    rc = a / np.sqrt(1 - e2 * np.sin(phi) ** 2)
    xp = (rc + h_km) * np.cos(phi)
    zp = (rc * (1 - e2) + h_km) * np.sin(phi)
    r = np.hypot(xp, zp)
    phic = np.arcsin(zp / r)                  # geocentric latitude
    ct, st = np.sin(phic), np.cos(phic)       # cos and sin of the colatitude
    dt = year - EPOCH0
    g = G0 + dt * GD; hh = H0 + dt * HD
    gs = g * _S; hs = hh * _S                 # Schmidt semi-normalised -> Gauss
    ar = 6371.2 / r
    P = {(0, 0): np.ones_like(ct)}; dP = {(0, 0): np.zeros_like(ct)}
    X = np.zeros_like(ct); Y = np.zeros_like(ct); Z = np.zeros_like(ct)
    cosm = [np.cos(m * lam) for m in range(NMAX + 1)]
    sinm = [np.sin(m * lam) for m in range(NMAX + 1)]
    for n in range(1, NMAX + 1):
        arn = ar ** (n + 2)
        for m in range(0, n + 1):
            if m == n:
                P[n, m] = st * P[n - 1, m - 1]
                dP[n, m] = st * dP[n - 1, m - 1] + ct * P[n - 1, m - 1]
            else:
                p2 = P.get((n - 2, m), 0.0); d2 = dP.get((n - 2, m), 0.0)
                P[n, m] = ct * P[n - 1, m] - _K[n, m] * p2
                dP[n, m] = ct * dP[n - 1, m] - st * P[n - 1, m] - _K[n, m] * d2
            gc = gs[n, m] * cosm[m] + hs[n, m] * sinm[m]
            X += arn * gc * dP[n, m]
            Y += arn * m * (gs[n, m] * sinm[m] - hs[n, m] * cosm[m]) * P[n, m]
            Z += -(n + 1) * arn * gc * P[n, m]
    Y = Y / np.where(np.abs(st) < 1e-12, 1e-12, st)
    psi = phic - phi                          # rotate geocentric -> geodetic
    Xg = X * np.cos(psi) - Z * np.sin(psi)
    Zg = X * np.sin(psi) + Z * np.cos(psi)
    return Xg, Y, Zg


def declination(lat, lon, h_km=0.0, year=EPOCH):
    X, Y, _ = field(lat, lon, h_km, year)
    return np.degrees(np.arctan2(Y, X))


def check_tests():
    rows = [list(map(float, ln.split())) for ln in open(TESTS) if ln.strip() and not ln.startswith('#')]
    print('WMM2025 test values (NOAA) vs this routine, declination in degrees')
    print(f"{'year':>7} {'h km':>6} {'lat':>6} {'lon':>6} {'NOAA D':>8} {'ours':>9} {'err':>7}   {'NOAA X':>8} {'ours X':>9}")
    worst = 0.0
    for yr, h, la, lo, Xn, Yn, Zn, *_rest in rows:
        D = _rest[3]
        X, Y, Z = field(la, lo, h, yr)
        d = float(np.degrees(np.arctan2(Y, X)))
        err = d - D
        worst = max(worst, abs(err))
        print(f'{yr:7.1f} {h:6.1f} {la:6.1f} {lo:6.1f} {D:8.2f} {d:9.4f} {err:+7.4f}   {Xn:8.1f} {float(X):9.2f}')
    print(f'{len(rows)} rows, max |error| {worst:.4f} deg (rows are rounded to 0.01)')
    assert worst <= 0.01, 'WMM routine does not reproduce the test values'
    return worst


def main():
    worst = check_tests()
    gr = GRID
    xs = gr['x0'] + (np.arange(gr['nx']) + 0.5) * gr['cell']
    ys = gr['y0'] + (np.arange(gr['ny']) + 0.5) * gr['cell']
    X, Y = np.meshgrid(xs, ys)
    lat, lon = to_geo(X, Y)
    D = declination(lat, lon, 0.0, EPOCH)
    assert np.abs(D).max() < 32, 'declination outside int16 range at this scale'
    q = np.round(D / SCALE).astype('<i2')
    write_gz(os.path.join(DATA, 'magvar.i16.gz'), q)
    header = dict(
        model='WMM2025 (NOAA NCEI, public domain)', epoch=EPOCH, altitudeM=0,
        unit='degrees, east positive', scale=SCALE, type='int16le', rowOrder='south first',
        sampling='cell-centred: value (i, j) is at x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell',
        file='magvar.i16.gz', frame='src/world/frame.js map metres',
        covers='24-46 N, 112-148 E (the margin box) and more', testMaxErrDeg=round(worst, 4),
        **gr)
    with open(os.path.join(DATA, 'magvar.json'), 'w') as f:
        json.dump(header, f, indent=2)
    print(f'grid {gr["nx"]} x {gr["ny"]} at {gr["cell"]/1000:.0f} km: {D.min():.2f} .. {D.max():.2f} deg')
    for name in ('magvar.i16.gz', 'magvar.json'):
        print(f'  data/{name}: {os.path.getsize(os.path.join(DATA, name))} bytes')

    print('\nAirports (WMM2025 at 2026.0, altitude 0) vs the AIPs and frame.js\'s plane')
    for icao, la, lo, aip in (('RJTT', 35.5523, 139.7798, '8 W (AIP)'),
                              ('RJAA', 35.7647, 140.3864, '8 W (AIP)'),
                              ('ZSPD', 31.1434, 121.8052, "5 47' W = -5.78 (AIP, 2017)"),
                              ('RKSS', 37.5583, 126.7906, '(Korea: the plane rules)'),
                              ('RKPC', 33.5113, 126.4930, '(Korea: the plane rules)')):
        d = float(declination(la, lo, 0.0, EPOCH))
        x, y = to_map(la, lo)
        # the grid's bilinear value at the same point, as geo-rules.js reads it
        fx = (x - gr['x0']) / gr['cell'] - 0.5; fy = (y - gr['y0']) / gr['cell'] - 0.5
        i, j = int(np.floor(fx)), int(np.floor(fy)); u, v = fx - i, fy - j
        gq = q.astype(float) * SCALE
        gb = (gq[j, i] * (1 - u) * (1 - v) + gq[j, i + 1] * u * (1 - v)
              + gq[j + 1, i] * (1 - u) * v + gq[j + 1, i + 1] * u * v)
        print(f'  {icao}: WMM {d:+.2f} (grid {gb:+.3f})  '
              f'plane {mag_var(la, lo):+.2f}   AIP {aip}')


if __name__ == '__main__':
    main()
