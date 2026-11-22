// v0.7.4 item 1: the terminals' labels on the path map (data/terminal-labels.json, data/europe/terminal-labels.json,
// tools/bake_terminal_labels.py). Every label's point lies inside one of its airport's terminal buildings; no airport
// with one terminal building labelled; the six airports Shane looks at first labelled as signed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'data');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function inside([x, y], pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

for (const [region, dir] of [['east-asia', DATA], ['europe', path.join(DATA, 'europe')]]) {
  test(`${region}: every terminal label sits inside one of its airport's terminal buildings`, () => {
    const doc = read(path.join(dir, 'terminal-labels.json'));
    let n = 0;
    for (const [icao, labels] of Object.entries(doc.airports)) {
      const f = path.join(dir, 'airports', `${icao}.json`);
      assert.ok(fs.existsSync(f), icao);
      const terms = read(f).buildings.filter((b) => b.kind === 'terminal');
      assert.ok(terms.length >= 2 || labels.length === 0, `${icao}: one terminal building, so no number`);
      const seen = new Set();
      for (const L of labels) {
        assert.ok(L.label && !seen.has(L.label), `${icao} ${L.label}`); seen.add(L.label);
        assert.ok(terms.some((b) => inside([L.x, L.y], b.points)), `${icao} ${L.label} at ${L.x}, ${L.y}`);
        n++;
      }
      assert.ok(labels.length !== 1, `${icao}: a single label (an airport with one terminal gets none)`);
    }
    assert.ok(n > 10);
  });
}

test('the six airports are labelled as they are signed', () => {
  const ea = read(path.join(DATA, 'terminal-labels.json')).airports, eu = read(path.join(DATA, 'europe', 'terminal-labels.json')).airports;
  const names = (o, i) => (o[i] || []).map((L) => L.label).join(' ');
  assert.equal(names(ea, 'RKSI'), 'T1 T2');
  assert.equal(names(ea, 'RJTT'), 'T1 T2 T3');
  assert.equal(names(eu, 'EGLL'), 'T2 T3 T4 T5');
  assert.equal(names(eu, 'LFPG'), 'T1 2A 2B 2C 2D 2E 2F 2G T3');
  assert.equal(names(eu, 'EDDF'), 'T1 T3');
  assert.equal(names(eu, 'EDDM'), 'T1 T2');
});

test('every airport in both regions has terminal shapes to draw', () => {
  let none = [];
  for (const dir of [DATA, path.join(DATA, 'europe')]) {
    for (const f of fs.readdirSync(path.join(dir, 'airports')).filter((x) => /^[A-Z]{4}\.json$/.test(x))) {
      const a = read(path.join(dir, 'airports', f));
      if (!(a.buildings || []).some((b) => b.kind === 'terminal')) none.push(f.slice(0, 4));
    }
  }
  // (Gimhae's file has no building tagged as a terminal: its shapes are drawn from nothing, and it gets no label.)
  assert.deepEqual(none.filter((i) => i !== 'RKPK'), []);
});
