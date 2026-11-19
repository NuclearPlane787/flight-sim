"""Quick-look of composed l0 tiles (staging or data/): heights coloured, the sea blue, built-up
red-tinted, water bytes' coast; 1 km a pixel (every 4th cell). Tile lines dotted with --grid.
  /tmp/flight-sim/venv/bin/python -I tools/quicklook_region_l0.py <dir> <out.png> [--grid]
"""
import gzip, os, sys
import numpy as np
from PIL import Image

TILE, B = 512, 2
S = TILE + 2 * B
d, out = sys.argv[1], sys.argv[2]
grid = '--grid' in sys.argv
names = sorted({f.split('.')[0] for f in os.listdir(d) if f.endswith('.h.i16.gz')})
ij = [tuple(map(int, n.split('_'))) for n in names]
ti0, ti1 = min(a for a, b in ij), max(a for a, b in ij)
tj0, tj1 = min(b for a, b in ij), max(b for a, b in ij)
F = 4
W, H = (ti1 - ti0 + 1) * TILE // F, (tj1 - tj0 + 1) * TILE // F
img = np.zeros((H, W, 3), np.uint8); img[:] = (38, 70, 120)
for (ti, tj), n in zip(ij, names):
    rd = lambda s, dt, sh: np.frombuffer(gzip.open(os.path.join(d, n + s)).read(), dt).reshape(sh)
    h = rd('.h.i16.gz', '<i2', (S, S))[B:B + TILE:F, B:B + TILE:F] * 0.25
    c = rd('.c.rgba8.gz', np.uint8, (S, S, 4))[B:B + TILE:F, B:B + TILE:F]
    t = np.clip(h / 2500, 0, 1)[..., None]
    rgb = (1 - t) * np.array([70, 130, 60]) + t * np.array([200, 190, 170])
    rgb = rgb * (1 - c[..., 2:3] / 400) + np.array([200, 60, 60]) * (c[..., 2:3] / 400)
    rgb = np.where((h < 0)[..., None], np.array([50, 95, 150]), rgb)
    x0 = (ti - ti0) * TILE // F; y0 = (tj1 - tj) * TILE // F
    img[y0:y0 + TILE // F, x0:x0 + TILE // F] = rgb[::-1].astype(np.uint8)
    if grid:
        img[y0, x0:x0 + TILE // F:3] = 255; img[y0:y0 + TILE // F:3, x0] = 255
Image.fromarray(img).save(out)
print(out, img.shape)
