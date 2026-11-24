// v0.7.9 looks: a probe (not a test): the installed ground round a Europe landmark, printed as a table of rings.
// FS_REGION=europe node tests/v079-looks-probe.mjs <landmark id> [radii...]
import { fileURLToPath } from 'node:url';
const id = process.argv[2] || 'ndg';
const radii = process.argv.slice(3).map(Number);
const { tiledTerrain } = await import('./tile-terrain.mjs');
const { EUROPE_LANDMARKS, baseHeight } = await import('../src/world/landmarks.js');
const { hf } = await tiledTerrain({ layers: ['h'], airports: [], maxTiles: 40 });
const L = EUROPE_LANDMARKS.find((l) => l.id === id);
await hf.tiles.whenReady(L.x, L.y, 2000, 'probe');
const H = (x, y) => hf.heightAt(x, y);
const base = baseHeight(L, H);
console.log(`${id}: centre ${H(L.x, L.y).toFixed(1)} m, base ${base.toFixed(1)} m, brg ${L.brg}`);
for (const r of (radii.length ? radii : [0, 20, 30, 40, 50, 60, 80, 100, 130, 160, 200, 250])) {
  const row = [];
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; row.push((H(L.x + r * Math.sin(a), L.y + r * Math.cos(a)) - base).toFixed(1).padStart(6)); }
  console.log(`r ${String(r).padStart(4)}: ${row.join(' ')}   (N NE E SE S SW W NW, m over the base)`);
}
process.exit(0);
