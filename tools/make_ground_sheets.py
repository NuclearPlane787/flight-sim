#!/usr/bin/env python3
"""Part 7's picture sets (briefs/V0-6-0.md): for each place one sheet, `v060-ground-<place>.png`: the old
ground and the new one side by side from 1,000 ft, 3,000 ft and 10,000 ft by day (and from
1,000 ft at night where it was taken), with WorldCover's map of the same place beside them.

  python3 tools/make_ground_sheets.py --before g0 --after g7

Reads the stills `v060-<tag>-ground-<place>-<ft>[-night].png` (tests/browser-v060-stills.mjs) and
`v060-ground-cover-<place>.png` (tools/quicklook_fine_cover.py) from the pictures folder.
"""
import argparse
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'Claude outputs', 'flight-sim'))
PLACES = ['west-gimpo', 'nakdong', 'jeju-farm', 'kanto', 'yangtze', 'kyushu']
ROWS = [('1000', '1,000 ft'), ('3000', '3,000 ft'), ('10000', '10,000 ft'), ('1000-night', '1,000 ft, night')]
W, H, PAD, BAR = 720, 450, 6, 22

ap = argparse.ArgumentParser()
ap.add_argument('--before', default='g0'); ap.add_argument('--after', default='g7')
A = ap.parse_args()
for place in PLACES:
    rows = [(k, label) for k, label in ROWS if os.path.exists(os.path.join(OUT, f'v060-{A.after}-ground-{place}-{k}.png'))]
    if not rows:
        continue
    cover = os.path.join(OUT, f'v060-ground-cover-{place}.png')
    side = len(rows) * (H + BAR + PAD) - PAD if os.path.exists(cover) else 0
    side = min(side, 2 * H + BAR + PAD)
    sheet = Image.new('RGB', (2 * W + PAD + (side + PAD if side else 0), len(rows) * (H + BAR + PAD) - PAD), (18, 18, 20))
    d = ImageDraw.Draw(sheet)
    for r, (k, label) in enumerate(rows):
        y = r * (H + BAR + PAD)
        for c, (tag, what) in enumerate(((A.before, 'before (v0.5.8\'s ground)'), (A.after, 'after (Part 7)'))):
            p = os.path.join(OUT, f'v060-{tag}-ground-{place}-{k}.png')
            x = c * (W + PAD)
            if os.path.exists(p):
                sheet.paste(Image.open(p).convert('RGB').resize((W, H), Image.LANCZOS), (x, y + BAR))
            d.text((x + 6, y + 5), f'{place}, {label}: {what}', fill=(235, 235, 235))
    if side:
        sheet.paste(Image.open(cover).convert('RGB').resize((side, side), Image.LANCZOS), (2 * (W + PAD), 0))
    out = os.path.join(OUT, f'v060-ground-{place}.png')
    sheet.save(out)
    print(os.path.basename(out), sheet.size)
