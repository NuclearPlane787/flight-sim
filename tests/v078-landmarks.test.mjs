// v0.7.8 part 3, items 1, 2, 4 and 5 (the `marks` subagent): the castles' colours at Nagoya and Osaka, Tower Bridge's
// ends on its banks, the Elbphilharmonie's wave-topped glass, the Bergisel jump down its hill, behind one switch
// (landmark-models.js's LANDMARKS78: ?landmarks78=0 on the page, FS_LANDMARKS78=0 in node). Off: every landmark of both
// regions, its model (every attribute and its lights) and its entry, exactly as the pushed v0.7.7's: the hashes below
// were taken from the pushed copy with the same code (the bridges given 4 m of ground at their ends). On: those four
// items' five models change, and no other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inRegion, REGION_ID } from './region-run.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHANGED = { 'east-asia': ['nagoyacastle', 'osakacastle'], europe: ['towerbridge', 'elbphil', 'bergisel'] };
const OLD = {
  'east-asia': {"lotte":"ddf3ad816bfff29b","b63":"3e5484d14b3b003a","nseoul":"4c54517da17b2f23","parc1":"37c25432949882f3","shtower":"e44e7ec3bf1368df","swfc":"43368327228e961c","jinmao":"f0de23668c1f3132","pearl":"db46f86bf91aa464","skytree":"f4f3226dad61d5b1","tokyotower":"a24a2a9505e73c7c","azabudai":"a25a4b28dbd8a325","tmg":"6480bfbeefad9c1a","ylmt":"359f2c1a79af5e7f","lct":"aa53bac451517e3a","neatt":"f3460003d654c439","harukas":"e94387831e462b28","umeda":"86ab7921dfb1c1ea","fktower":"9b425b60ecfda3ad","fkdome":"979d112a6f66a4e7","citic":"c9697b4366068948","cctv":"430368b3260156a8","russky":"30005286801c81d7","zolotoy":"dee119b5f835a545","cctvtower":"25972051b31b21d2","tjtower":"d0eb71c00cbf4541","lntower":"df76c6bfbded657a","ryugyong":"60cf6fbdb0249635","juche":"4f04985f2bc5b1e3","sapporotv":"cf1560087050ea2d","daikannon":"d0ba7c4b473df863","nagoyacastle":"2fe1a12e4cf180e6","nagoyatv":"e2856930caf617c1","torii":"d0db07fea4bb719e","abombdome":"97a1a9cd337c677e","osakacastle":"cb524e62535ad5cc"},
  europe: {"shard":"a37db6cd93886354","westminster":"e541bc641f625e0c","eye":"62e9624542ea92f9","stpauls":"199411ac40be61d6","towerbridge":"04e8b6974693a9dc","eiffel":"e1d1691ae7d4d048","arc":"ad010ee3f0364035","sacrecoeur":"c6623ecfa8df1f4d","notredame":"8e16b175b80ace5f","grandearche":"933d8e34acffb959","commerzbank":"902f9573956e01ce","messeturm":"3ce855fca1c60685","europaturm":"b81a1eff01bcb568","cepsa":"110e0aa52bbe2f97","pwc":"eb015147f68d18e3","cristal":"66fed2ca6bd1207a","emperador":"cb5e6b4ef0cd798c","caleido":"e1b620a313657727","kio":"8151a41ee975e3b1","grossmunster":"e00cb8a7ce645e6e","primetower":"3cd2e63a6ab64e10","olympiaturm":"530ce57ae867551a","frauenkirche":"a4887aac7ca38f25","sagrada":"643f489f9cbef6c1","glories":"00e6017d7be42640","collserola":"e053289deb1ab152","stpeters":"6d9c73360d76c608","colosseum":"6d4618b34cb002fd","fernsehturm":"a94c706c3da7456a","brandenburg":"2c67b0769daed0cc","stephansdom":"11e5c46dc0660f12","donauturm":"5a8e74e1ad122bc8","riesenrad":"bf4b9f2c1ef14ec3","duomo":"b30e3cd215be0c7c","ponte25":"64d6034fc7ee0baf","cristorei":"ff475e1bef6c4328","vascodagama":"a792133e53a26082","oresund":"6e5b578541b14128","torso":"664b339d65ee21cf","poolbeg":"305caa1222883a49","palaisjustice":"d54dd5cb06750b32","lovell":"851798f634d08b5b","rocket":"1238c78eb5db8a87","koelnerdom":"32ec6ec0bb29633f","rheinturm":"e14a83a878fb9f4c","zizkov":"a62f777ae79033e2","stvitus":"7b8c7416d65f5b5e","jetdeau":"951ac126322c72cd","forthbridge":"c5bdcc1ff8c7a7b2","forthroad":"eed891de3d78677c","queensferry":"e61d68ef152dfcfb","edinburghcastle":"18cba3784387da7a","santiago":"dad0290d45f8b5b0","elbphil":"7079d5daa2323eb8","hht":"b85f4980fbd02f6b","campanile":"6d420583817ba515","ndg":"74373c7202c9ec2a","fourviere":"f3cd1171d624f7f7","fourvieretower":"d526b0f975239a61","domluis":"1678555f770a4606","bergisel":"08429c96676bcdb6","ely":"72f394feefb617ed","pilar":"7032733c8271bf2c","cadiz":"7ab9507a1dcb989b"},
};

// Every landmark's hash in a child process (the region and the switch are read once, at import).
function hashes(region, env) {
  const code = `
    import { createHash } from 'node:crypto';
    const { LANDMARKS, EUROPE_LANDMARKS, buildModel, bridgeEnds } = await import(${JSON.stringify(ROOT + 'src/world/landmarks.js')});
    const out = {};
    for (const L of [...LANDMARKS, ...EUROPE_LANDMARKS]) {
      if ((L.region || 'east-asia') !== ${JSON.stringify(region)}) continue;
      const { geometry: g, lights } = buildModel(L, L.kind === 'bridge' ? bridgeEnds(L, () => 4) : null);
      const h = createHash('sha256');
      for (const a of ['position', 'normal', 'aCol', 'aFac', 'aExt', 'aGlow']) { const arr = g.getAttribute(a).array; h.update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)); }
      h.update(JSON.stringify(lights)); h.update(JSON.stringify(L));
      out[L.id] = h.digest('hex').slice(0, 16);
    }
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, FS_REGION: region, NODE_TEST_CONTEXT: undefined, ...env }, encoding: 'utf8', maxBuffer: 16 << 20 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('the switch is on by default', async () => {
  const { LANDMARKS78 } = await import('../src/world/landmark-models.js');
  assert.equal(LANDMARKS78, process.env.FS_LANDMARKS78 !== '0');
});

test('off (FS_LANDMARKS78=0): all ninety-nine landmarks exactly the pushed v0.7.7\'s', () => {
  for (const region of Object.keys(OLD)) assert.deepEqual(hashes(region, { FS_LANDMARKS78: '0' }), OLD[region], region);
});

test('on: the five meant to change change, every other one exactly the pushed v0.7.7\'s', () => {
  for (const region of Object.keys(OLD)) {
    const got = hashes(region, { FS_LANDMARKS78: '1' });
    assert.deepEqual(Object.keys(got), Object.keys(OLD[region]), region);
    for (const id of Object.keys(OLD[region])) {
      if (CHANGED[region].includes(id)) assert.notEqual(got[id], OLD[region][id], `${id}: changed`);
      else assert.equal(got[id], OLD[region][id], `${id}: unchanged`);
    }
  }
});

// The linear albedo the shader turns into the copper's and the stone's colours (see KEEP_ROOF in landmark-models.js):
// v0.7.5's read pale mint and pale grey; the new about half to a third as bright, the copper's green kept its hue.
if (REGION_ID === 'east-asia' && process.env.FS_LANDMARKS78 !== '0') {
  test('item 1: the castles\' roofs a darker copper green, their stone bases a mid grey, the walls white as before', async () => {
    const { LANDMARKS, buildModel } = await import('../src/world/landmarks.js');
    for (const id of ['nagoyacastle', 'osakacastle']) {
      const c = buildModel(LANDMARKS.find((l) => l.id === id)).geometry.getAttribute('aCol');
      const cols = new Map();
      for (let i = 0; i < c.count; i++) { const k = [c.getX(i), c.getY(i), c.getZ(i)].map((v) => v.toFixed(3)).join(','); cols.set(k, (cols.get(k) || 0) + 1); }
      const has = (rgb) => cols.has(rgb.map((v) => v.toFixed(3)).join(','));
      assert.ok(has([0.042, 0.114, 0.071]), `${id}: the new copper`);
      assert.ok(has([0.09, 0.085, 0.074]), `${id}: the new stone`);
      assert.ok(has([0.72, 0.72, 0.69]), `${id}: the walls as before`);
      assert.ok(!has([0.10, 0.31, 0.23]) && !has([0.19, 0.18, 0.16]), `${id}: v0.7.5's pale colours gone`);
    }
  });
}

if (inRegion('europe', import.meta.url) && process.env.FS_LANDMARKS78 !== '0') {
  const { EUROPE_LANDMARKS, buildModel, bridgeEnds, baseHeight, slopeProfile } = await import('../src/world/landmarks.js');
  const M = await import('../src/world/landmark-models.js');
  const byId = (id) => EUROPE_LANDMARKS.find((l) => l.id === id);
  const local = (L, x, z) => { const c = Math.cos(L.brg * Math.PI / 180), s = Math.sin(L.brg * Math.PI / 180), N = -z; return [x * c - N * s, x * s + N * c]; };

  test('item 2: Tower Bridge runs on to its banks: approaches to 197 m south and 185 m north, the ramps down to the ground there', () => {
    const L = byId('towerbridge');
    assert.ok(Math.abs(L.geo.n0 + 196.1) < 1.5 && Math.abs(L.geo.n1 - 184.2) < 1.5, `ends ${L.geo.n0.toFixed(1)} .. ${L.geo.n1.toFixed(1)}`);
    const ends = bridgeEnds(L, () => 2.6);
    const p = buildModel(L, ends).geometry.getAttribute('position');
    let s = 0, n = 0, endTopS = -Infinity, endTopN = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const [, ln] = local(L, p.getX(i), p.getZ(i)), y = p.getY(i);
      s = Math.min(s, ln); n = Math.max(n, ln);
      if (ln < -196) endTopS = Math.max(endTopS, y);
      if (ln > 184) endTopN = Math.max(endTopN, y);
    }
    assert.ok(s < -196.5 && s > -198, `south ${s.toFixed(1)}`);
    assert.ok(n > 184.5 && n < 186, `north ${n.toFixed(1)}`);
    // (bridgeEnds() reads at least 3 m; the road 0.3 m over it, the parapets 1.1 m over the road)
    assert.ok(Math.abs(endTopS - (ends[0] + 0.3 + 1.1)) < 0.01 && Math.abs(endTopN - (ends[1] + 0.3 + 1.1)) < 0.01, `the ramps come down to the ground (${endTopS.toFixed(2)}, ${endTopN.toFixed(2)})`);
  });

  // The water the game draws there in a town: the 31 m cover's (finecover.js; class 0).
  const FINE = ROOT + 'data/europe/terrain/fine/';
  test('item 2: both of Tower Bridge\'s ends on land in the 31 m cover, the abutments\' old ends (122 m) at or in the water', { skip: !existsSync(FINE + 'fine.json') }, async () => {
    const { subName } = await import('../src/world/finecover.js');
    const idx = JSON.parse(readFileSync(FINE + 'fine.json', 'utf8')), cache = {};
    const cls = (x, y) => {
      const P = Math.floor((x - idx.x0) / idx.px), Q = Math.floor((y - idx.y0) / idx.px), si = Math.floor(P / idx.sub), sj = Math.floor(Q / idx.sub), k = subName(si, sj);
      if (!(k in cache)) cache[k] = existsSync(FINE + k + '.u8.gz') ? gunzipSync(readFileSync(FINE + k + '.u8.gz')) : null;
      return cache[k] ? cache[k][(Q - sj * idx.sub) * idx.sub + (P - si * idx.sub)] : -1;
    };
    const L = byId('towerbridge'), ux = Math.sin(L.brg * Math.PI / 180), uy = Math.cos(L.brg * Math.PI / 180);
    const at = (a, off = 0) => cls(L.x + a * ux + off * uy, L.y + a * uy - off * ux);
    // the last 30 m of each end, across the road's width: no water
    for (const a of [-197, -185, -175, -167, 155, 165, 175, 185]) for (const off of [-8, 0, 8]) assert.notEqual(at(a, off), 0, `water at ${a} m, ${off} m across`);
    assert.ok([-122, -128].some((a) => at(a) === 0), 'the south abutment\'s old end by the water');
  });

  test('item 4: the Elbphilharmonie: five crests falling east from the 108 m tip, saddles between, the Plaza\'s dark band, brick below', () => {
    const L = byId('elbphil'), g = buildModel(L).geometry, p = g.getAttribute('position'), c = g.getAttribute('aCol');
    // the roof's height along the middle line (|n| < 4), in 4 m bins of local x
    const bins = new Map();
    let plaza = 0, brick = 0, top = 0, topX = 0;
    for (let i = 0; i < p.count; i++) {
      const [lx, ln] = local(L, p.getX(i), p.getZ(i)), y = p.getY(i);
      if (y > top) { top = y; topX = lx; }
      if (y >= 37 && y <= 41 && c.getX(i) < 0.07) plaza++;
      if (y <= 37 && Math.abs(c.getX(i) - 0.26) < 1e-3) brick++;
      if (y > 60 && Math.abs(ln) < 4) { const k = Math.round(lx / 4); bins.set(k, Math.max(bins.get(k) || 0, y)); }
    }
    assert.ok(Math.abs(top - 108) < 0.01 && topX < -50, `the peak at the western tip (${topX.toFixed(1)}, ${top})`);
    assert.ok(plaza > 20 && brick > 20, 'the Plaza and the brick');
    const ks = [...bins.keys()].sort((a, b) => a - b), hs = ks.map((k) => bins.get(k));
    let peaks = 0, troughs = 0;
    for (let i = 1; i + 1 < hs.length; i++) { if (hs[i] > hs[i - 1] && hs[i] >= hs[i + 1]) peaks++; if (hs[i] < hs[i - 1] && hs[i] <= hs[i + 1]) troughs++; }
    assert.ok(peaks >= 3 && troughs >= 4, `waves along the roof: ${peaks} crests and ${troughs} saddles inside its ends (${hs.map((h) => h.toFixed(0)).join(' ')})`);
    assert.ok(hs[hs.length - 1] < 86, 'lower in the east');
  });

  test('item 5: the Bergisel jump on its hill: the tower on the crest, the in-run down the slope to the table, its supports on the ground', () => {
    const L = byId('bergisel');
    assert.equal(L.slope, true);
    assert.ok(Math.abs(L.lat - (47.24889 - 105 / 111195)) < 1e-9, 'its point 105 m up the hill from the article\'s');
    const prof = M.BERGISEL_PROF, g = (n) => M.profAt(prof, n);
    const geo = buildModel(L).geometry, p = geo.getAttribute('position');
    assert.ok(Math.abs(L.heightM - (g(-90) + 50)) < 0.06, `the tower 50 m over the crest (${L.heightM})`);
    let top = 0, topN = 0, deckAbove = Infinity, footBelow = Infinity, table = null;
    for (let i = 0; i < p.count; i++) {
      const [lx, ln] = local(L, p.getX(i), p.getZ(i)), y = p.getY(i);
      if (y > top) { top = y; topN = ln; }
      if (Math.abs(lx) > 1.05 && Math.abs(lx) <= 2.21 && ln > -84 && ln < 5) deckAbove = Math.min(deckAbove, y - g(ln));   // the deck (the supports are 1 m a side)
      if (Math.abs(lx) <= 1.01 && ln > -84 && ln < 5) footBelow = Math.min(footBelow, y - g(ln));
      if (ln > 4.9) table = Math.max(table ?? -Infinity, y);
    }
    assert.ok(Math.abs(top - L.heightM) < 0.01 && topN < -70, `the top on the crest (n ${topN.toFixed(0)})`);
    assert.ok(g(-90) - g(5) > 35, 'the in-run falls more than 35 m');
    assert.ok(table !== null && table - g(5) > 2 && table - g(5) < 4.5, `the table 3 m over the slope (${(table - g(5)).toFixed(1)})`);
    assert.ok(deckAbove > 0, `the in-run's deck clear of the ground (${deckAbove.toFixed(2)})`);
    assert.ok(footBelow > -2.5 && footBelow < 0, `its supports' feet in the ground, not far under it (${footBelow.toFixed(2)})`);
  });

  const TILES = ROOT + 'data/europe/manifest.json';
  test('item 5: on the installed ground: the profile it is built with matches the default, the tower on the crest', { skip: !existsSync(TILES) }, async () => {
    const { tiledTerrain } = await import('./tile-terrain.mjs');
    const { hf } = await tiledTerrain({ layers: ['h'], airports: [], maxTiles: 40 });
    const L = byId('bergisel');
    await hf.tiles.whenReady(L.x, L.y, 2000, 'test');
    const heightAt = (x, y) => hf.heightAt(x, y), prof = slopeProfile(L, heightAt);
    for (let i = 0; i < prof.length; i++) assert.ok(Math.abs(prof[i] - M.BERGISEL_PROF[i]) < 0.15, `profile ${i}: ${prof[i].toFixed(2)} against ${M.BERGISEL_PROF[i]}`);
    assert.ok(Math.max(...prof.slice(0, 5)) - Math.min(...prof) > 75, 'a hill of more than 75 m along it');
    assert.ok(baseHeight(L, heightAt) > 600, 'Innsbruck\'s ground');
  });

  // Items 9 and 10 (baked: tools/bake_region_patches.py's patch 'ndg' with its URBAN_KEEP box, and RIDGE_LIFT['gibraltar'];
  // installed by the lead, with 'ndg' in the manifest's patchesRegion): the basilica on its hill, the Rock at its height.
  test('item 9: Notre-Dame de la Garde on its 150 m hill (the 250 m grid gave 56 m), in a 30 m patch of its own', { skip: !existsSync(TILES) }, async () => {
    const m = JSON.parse(readFileSync(TILES, 'utf8'));
    assert.ok(m.patchesRegion.some((p) => p.id === 'ndg' && p.cell === 30), 'the patch listed');
    const { tiledTerrain } = await import('./tile-terrain.mjs');
    const { hf } = await tiledTerrain({ layers: ['h'], airports: [], maxTiles: 40 });
    const L = byId('ndg');
    await hf.tiles.whenReady(L.x, L.y, 2000, 'test');
    const h = hf.heightAt(L.x, L.y);
    assert.ok(h > 140 && h < 162, `the basilica's ground ${h.toFixed(1)} m`);
    const ring = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => hf.heightAt(L.x + 500 * Math.cos(k * Math.PI / 4), L.y + 500 * Math.sin(k * Math.PI / 4)));
    assert.ok(Math.max(...ring) < h - 30, `a peak: 500 m round it at most ${Math.max(...ring).toFixed(0)} m`);
  });

  test('item 10: the Rock of Gibraltar\'s ridge at about 426 m (GLO-30 held 370 m)', { skip: !existsSync(TILES) }, async () => {
    const { toMap } = await import('../src/world/frame.js');
    const { tiledTerrain } = await import('./tile-terrain.mjs');
    const { hf } = await tiledTerrain({ layers: ['h'], airports: [], maxTiles: 40 });
    const [x0, y0] = toMap(36.110, -5.356), [x1, y1] = toMap(36.150, -5.333);
    await hf.tiles.whenReady((x0 + x1) / 2, (y0 + y1) / 2, 4000, 'test');
    let top = 0, high = 0;
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 15) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 15) { const h = hf.heightAt(x, y); top = Math.max(top, h); if (h > 380) high++; }
    assert.ok(top > 415 && top <= 426.5, `the top ${top.toFixed(1)} m`);
    assert.ok(high > 20, `a ridge, not a spike: ${high} points over 380 m`);
  });
}
