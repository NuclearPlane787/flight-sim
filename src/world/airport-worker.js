// v0.6.0: the airports' pure preparation off the main thread (world.js's airports near the camera).
// For one airport (its data as the page has it, structured-cloned), the parts that need no
// heightfield and take tens of milliseconds each: the sign sites (taxisigns.js, with its taxi graph),
// the taxiway edge lines for the paint (apron-geom.js), and the taxiway lights' layout without their
// heights (taxilights.js; the page adds each light's height from the heightfield, as the layout does).
// The same functions as on the main thread, so the results are the same to the bit.
//   in:  { id, airport }     out: { id, ok, signSites, apronEdges, lights } or { id, ok: false, error }
import { taxiSignSites } from './taxisigns.js';
import { taxiLightLayout } from './taxilights.js';
import { taxiwayEdges, segmentIndex, dedupePolys } from './apron-geom.js';

self.onmessage = (e) => {
  const { id, airport: a } = e.data;
  try {
    const signSites = taxiSignSites(a);
    const apronEdges = taxiwayEdges(a, segmentIndex(a.taxiways || []), dedupePolys(a.aprons || []));
    const lights = taxiLightLayout(a, null);
    self.postMessage({ id, ok: true, signSites, apronEdges, lights });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack || err) });
  }
};
