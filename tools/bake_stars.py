"""Bake data/stars.json from the Yale Bright Star Catalogue (BSC5, Hoffleit & Warren 1991).

The source is NASA HEASARC's copy of the catalogue (table heasarc_bsc5p, ~900 KB gzipped),
downloaded once with curl into reference/raw/bsc5/ (git-ignored). data/STARS-CREDIT.md says
where it comes from and why it is public domain.

Output: every star with V <= 6.5 (8,404), brightest first, as one flat array
[ra, dec, mag, bv, ra, dec, mag, bv, ...]: J2000 RA and Dec in degrees rounded to 0.01,
V magnitude and B-V colour rounded to 0.01 (bv is null where the catalogue has none).
The two dozen brightest also get their traditional names, for labels in the Sky window.

Light work (a few seconds, a few MB), but run it like the other bakes:
  python3 tools/cpu-guard.py -- python3 -I tools/bake_stars.py
"""
import gzip
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
RAW_DIR = os.path.join(GAME, 'reference', 'raw', 'bsc5')
RAW = os.path.join(RAW_DIR, 'heasarc_bsc5p.tdat.gz')
OUT = os.path.join(GAME, 'data', 'stars.json')
URL = 'https://heasarc.gsfc.nasa.gov/FTP/heasarc/dbase/tdat_files/heasarc_bsc5p.tdat.gz'

MAG_LIMIT = 6.5
NAMED_LIMIT = 1.6   # stars at least this bright keep a name, for labels in the Sky window
# The traditional names of those stars (Bayer designation as BSC5 writes it, without the
# Flamsteed number). Names are facts, not part of the catalogue.
PROPER = {
    'Alp CMa': 'Sirius', 'Alp Car': 'Canopus', 'Alp Boo': 'Arcturus', 'Alp1Cen': 'Rigil Kentaurus',
    'Alp2Cen': 'Toliman', 'Alp Lyr': 'Vega', 'Alp Aur': 'Capella', 'Bet Ori': 'Rigel',
    'Alp CMi': 'Procyon', 'Alp Eri': 'Achernar', 'Alp Ori': 'Betelgeuse', 'Bet Cen': 'Hadar',
    'Alp Aql': 'Altair', 'Alp Tau': 'Aldebaran', 'Alp Sco': 'Antares', 'Alp Vir': 'Spica',
    'Bet Gem': 'Pollux', 'Alp PsA': 'Fomalhaut', 'Bet Cru': 'Mimosa', 'Alp Cyg': 'Deneb',
    'Alp1Cru': 'Acrux', 'Alp Leo': 'Regulus', 'Eps CMa': 'Adhara',
}


def download():
    if os.path.exists(RAW) and os.path.getsize(RAW) > 100_000:
        return
    os.makedirs(RAW_DIR, exist_ok=True)
    subprocess.run(['curl', '-sS', '--fail', '-m', '120', '-o', RAW, URL], check=True)


def rows():
    """The catalogue's rows as dicts, keyed by the field names in its 'line[1] =' header."""
    fields = None
    in_data = False
    with gzip.open(RAW, 'rt', encoding='latin-1') as f:
        for line in f:
            line = line.rstrip('\n')
            if line.startswith('line[1] ='):
                fields = line.split('=', 1)[1].split()
            elif line.startswith('<DATA>'):
                in_data = True
            elif line.startswith('<END>'):
                break
            elif in_data and line:
                vals = line.split('|')
                yield dict(zip(fields, vals))


def num(s):
    s = (s or '').strip()
    try:
        return float(s)
    except ValueError:
        return None


def main():
    download()
    stars = []
    for r in rows():
        ra, dec, mag = num(r.get('ra')), num(r.get('dec')), num(r.get('vmag'))
        if ra is None or dec is None or mag is None or mag > MAG_LIMIT:
            continue   # a handful of BSC entries are novae or galaxies with no position or magnitude
        stars.append((mag, ra, dec, num(r.get('bv_color')), (r.get('alt_name') or '').strip()))
    stars.sort(key=lambda s: s[0])

    flat, names = [], {}
    for i, (mag, ra, dec, bv, alt) in enumerate(stars):
        flat += [round(ra, 2), round(dec, 2), round(mag, 2), None if bv is None else round(bv, 2)]
        if mag <= NAMED_LIMIT and alt:
            bayer = ' '.join(alt.lstrip('0123456789').split())
            names[i] = PROPER.get(bayer, bayer)
    out = {
        'source': 'Yale Bright Star Catalogue, 5th revised ed. (Hoffleit & Warren 1991), via NASA HEASARC; public domain. See STARS-CREDIT.md.',
        'epoch': 'J2000',
        'magLimit': MAG_LIMIT,
        'fields': ['raDeg', 'decDeg', 'vmag', 'bv'],
        'count': len(stars),
        'stars': flat,
        'names': names,   # index into the star list -> traditional name
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'{len(stars)} stars, {sum(1 for s in stars if s[3] is None)} without B-V, '
          f'{len(names)} named, {os.path.getsize(OUT) / 1024:.0f} KB -> {OUT}')


if __name__ == '__main__':
    main()
