# The stars: where they come from

`data/stars.json` holds the 8,404 stars of visual magnitude 6.5 or brighter from the
**Yale Bright Star Catalogue, 5th Revised Edition** (BSC5): D. Hoffleit and W. H. Warren Jr.,
1991, catalogue V/50 of the Astronomical Data Center at NASA Goddard Space Flight Center
(also at CDS Strasbourg).

- **Copy used:** NASA HEASARC's table `heasarc_bsc5p`
  (<https://heasarc.gsfc.nasa.gov/W3Browse/star-catalog/bsc5p.html>), downloaded by
  `tools/bake_stars.py` into `reference/raw/bsc5/` (git-ignored).
- **Kept:** J2000 right ascension and declination (degrees, rounded to 0.01), the V magnitude
  and the B-V colour index (rounded to 0.01; `null` for the 244 stars that have none), sorted
  brightest first. The traditional names of the 23 brightest (Sirius, Vega, ...) are added by
  the bake script; they're common knowledge, not part of the catalogue.

## Why it's public domain

- The 5th edition was prepared and distributed by NASA's Astronomical Data Center, and NASA's
  HEASARC serves it as a public table (`table_security = public`) with no conditions of use.
  It's been redistributed freely for decades and is widely treated as public domain.
- What we keep is a list of measured facts (positions, magnitudes, colours). Facts aren't
  copyrightable, and our file is a rounded subset in our own format.

We credit it anyway, as astronomers do: thank you to Dorrit Hoffleit, Wayne H. Warren Jr., the
Yale University Observatory and NASA's ADC and HEASARC.

The sun and Moon formulas in `src/astro.js` are from Jean Meeus, *Astronomical Algorithms*
(2nd ed., 1998), written out from the published equations.
