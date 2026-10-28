const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Optional differential run: EUC_CLEANUP_COMPARE_BASELINE=1 node --test tests/upstream-cleanups.test.cjs
// Ordinary/exported tests use frozen contracts, without requiring this private working commit in Git history.
// Adapted sources: mrdoob/slop-newyork SCC ef8f4b16acc0ebf052e54721a6a068631f5031cd,
// low-rise c40c85b8af712a2a3733323fea4826b608ac68d3, diagnostics f2d6486235f6d88ec47f3b3a9d3247c47fd553ba.
const BASELINE = 'f51d09f9e03ebb2a889397c5a112ccc906c820a5';
const compareBaseline = process.env.EUC_CLEANUP_COMPARE_BASELINE === '1';
const root = join(__dirname, '..');
const current = (file) => readFileSync(join(root, file), 'utf8');
const original = (file) => execFileSync('git', ['show', `${BASELINE}:${file}`], {
  cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024
});
const sources = Object.fromEntries(['road-network', 'buildings', 'pedestrians'].map((name) => [name, {
  after: current(`js/${name}.js`), before: compareBaseline ? original(`js/${name}.js`) : null
}]));
const plain = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// V8/Node 22 vs 24: only connector curvature differs in road fixtures (max 7.11e-15).
// Freeze that derived inverse-metre scalar at 1e-12; IDs, order, lane maps, points and all other values stay exact.
const portableRoad = (snapshot) => JSON.parse(JSON.stringify(snapshot, (key, value) =>
  key === 'curv' ? Math.round(value * 1e12) / 1e12 : value));
// Full 7,200-frame cross-engine capture: max gait/state delta 2.34e-15. Freeze numeric rig fields at
// 1e-10 units (<=5e-11 m/rad rounding), including near-zero Float32 components; discrete integers stay exact.
// This is only the curated, git-free contract. Same-engine baseline comparisons retain raw pose bytes/state.
const portableRigJSON = (rig, omit) => JSON.stringify(rig, (key, value) => {
  if (omit.has(key)) return undefined;
  return typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 1e10) / 1e10 : value;
});
// Optional raw evidence for cross-engine diagnosis; callers supply an existing QA artifact directory.
function capture(name, value) {
  if (process.env.EUC_CLEANUP_CAPTURE_DIR) writeFileSync(join(process.env.EUC_CLEANUP_CAPTURE_DIR, `${name}.json`), JSON.stringify(value));
  if (process.env.EUC_CLEANUP_COMPARE_CAPTURE_DIR) {
    const other = JSON.parse(readFileSync(join(process.env.EUC_CLEANUP_COMPARE_CAPTURE_DIR, `${name}.json`), 'utf8'));
    const differences = [], numeric = [];
    const visit = (a, b, path) => {
      if (Object.is(a, b)) return;
      if (typeof a === 'number' && typeof b === 'number') numeric.push({ path, before: a, after: b, delta: Math.abs(a - b) });
      else if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit(a[key], b[key], `${path}.${key}`);
      } else differences.push({ path, before: a, after: b });
    };
    visit(other, value, name);
    console.log(JSON.stringify({ name, structuralDifferences: differences.slice(0, 10), numericDifferences: numeric.length,
      first: numeric.slice(0, 5), largest: numeric.sort((a, b) => b.delta - a.delta).slice(0, 5) }));
  }
}
// Captured by executing the actual f51d09f source with the fixtures below, not by reimplementing the new helper.
const CONTRACTS = {
  grid: '62cbc10ccd3d5b7d25aea432d4ceab44b63c2216f9184f188395a38209f2bc9b',
  'pruned-grid': '22ea98e4ab60680c3141693b0e2a8aa2c1d95c191366b413d8374d596a826cd0',
  centreline: 'd75ed2653a44271d5f9402feacf4b507d23fc27a00c4dbd1d7e9ef316b2e99cf',
  civic: '414b862ac4cf3e3aa80658779c692a864c21830054ec08f1ce0565dff927f647',
  buildings: 'e1f4df536bb846ac643970905ff162544717eb46e2b4a33f58d69e0903816c28',
  jail: 'e7691abe749f849c7958b76025d6e5b1f9f3a83b6a5d2be89f2f40e72e5d0509',
  pedestrians: '3c14116bc20ac77f1821274cf0d98ee64d3b5fa5b83e5041bee566541dfaf407'
};
function contract(t, name, after, before) {
  capture(name, after);
  if (compareBaseline) {
    if (digest(after) !== digest(before)) {
      const firstDifference = (a, b, path) => {
        if (Object.is(a, b)) return null;
        if (a && b && typeof a === 'object' && typeof b === 'object') {
          for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
            const difference = firstDifference(a[key], b[key], `${path}.${key}`);
            if (difference) return difference;
          }
          return null;
        }
        return { path, baseline: a === undefined ? '<missing>' : a, working: b === undefined ? '<missing>' : b };
      };
      assert.fail(`${name}: first exact baseline difference ${JSON.stringify(firstDifference(before, after, name))}`);
    }
    assert.deepEqual(after, before, `${name}: actual baseline and working-source outputs`);
    t.diagnostic(`${name} baseline SHA-256: ${digest(before)}`);
  }
  const frozen = name === 'pedestrians' ? { ...after, stateAndPose: after.portableStateAndPose } :
    ['grid', 'pruned-grid', 'centreline', 'civic'].includes(name) ? portableRoad(after) : after;
  if (name === 'pedestrians') delete frozen.portableStateAndPose;
  t.diagnostic(`${name} portable SHA-256: ${digest(frozen)}`);
  assert.equal(digest(frozen), CONTRACTS[name], `${name}: frozen ${BASELINE} contract`);
}

let THREE, config, GEO, mergeSolidParts, pursuit;
test.before(async () => {
  const localImport = (file) => import(pathToFileURL(join(root, file)).href);
  [THREE, config, { GEO }, { mergeSolidParts }, pursuit] = await Promise.all([
    localImport('vendor/three/build/three.core.js'), localImport('js/city-config.js'),
    localImport('js/nyc-geodata.js'), localImport('js/solid-rects.js'), localImport('js/nemesis-brain.js')
  ]);
});

function roadModule(source, fixture) {
  return loadModule(source, {
    filename: 'road-network.js', globals: { console: { info() {} } },
    imports: { './city-config.js': fixture.config, './nyc-geodata.js': { GEO: fixture.geo } }
  });
}
function emptyRoadConfig() {
  return {
    ALL_AVENUES: [], ALL_STREETS: [], AVENUES: [], STREETS: [], BLOCKS: [],
    ISLAND_BOUNDS: { minZ: -20, maxZ: 320 },
    getIslandBoundsAtZ: () => ({ westX: -2000, eastX: 2000 })
  };
}
function selection(source, adjacency, order = adjacency.map((_, i) => i)) {
  // Run production step 7 itself, including its filtering, with the unchanged module's private helper in scope.
  const start = source.indexOf('\n', source.indexOf('// 7. Keep the largest strongly connected')) + 1;
  const end = source.indexOf('  // Roads kept clear', start);
  assert.ok(start > 0 && end > start);
  const code = `${source}\nexport function selectFixture(edges) {\n${source.slice(start, end)}\nreturn edges;\n}`;
  const { selectFixture } = roadModule(code, { config: emptyRoadConfig(), geo: {} });
  const edges = adjacency.map((_, tag) => ({ tag, moves: [], general: true }));
  adjacency.forEach((next, i) => { edges[i].moves = next.map((j) => ({ to: edges[j] })); });
  return Array.from(selectFixture(order.map((i) => edges[i])), (e) => e.tag);
}
for (const [name, adjacency, expected, order] of [
  ['empty', [], []],
  ['self cycle', [[0]], [0]],
  ['cycle with incoming and outgoing tails', [[1], [2], [0, 4], [0], []], [0, 1, 2]],
  ['disconnected unequal cycles', [[1], [0], [3], [4], [2]], [2, 3, 4]],
  ['disconnected equal-size tie', [[1], [0], [3], [2]], [2, 3]],
  ['same tie with reordered inputs', [[1], [0], [3], [2]], [0, 1], [2, 3, 0, 1]],
  ['one-way connection between equal cycles', [[1], [0, 2], [3], [2]], [0, 1]],
  ['duplicate moves and nested cycles', [[1, 1], [0, 2], [1]], [0, 1, 2]]
]) {
  test(`SCC production selection: ${name}`, () => {
    const after = selection(sources['road-network'].after, adjacency, order);
    assert.deepEqual(after, expected);
    if (compareBaseline) assert.deepEqual(after, selection(sources['road-network'].before, adjacency, order));
  });
}

function roadFixture(name) {
  const c = emptyRoadConfig(), sidewalks = [], obstacles = [];
  let geo = {};
  if (name === 'grid' || name === 'pruned-grid') {
    c.ALL_AVENUES = [0, 120, 240].map((x, i) => ({ x, short: `A${i}`, minZ: 0, maxZ: 300, dir: 0 }));
    c.ALL_STREETS = [0, 100, 200, 300].map((z) => ({ z, dir: 0 }));
    c.AVENUES = c.ALL_AVENUES;
    c.STREETS = c.ALL_STREETS;
    for (const [minX, maxX] of [[-100, -10], [10, 110], [130, 230], [250, 330]]) {
      const rows = name === 'pruned-grid' ? [[-100, -10], [10, 90], [110, 190], [210, 290], [310, 400]] : [[10, 90], [110, 190], [210, 290]];
      for (const [minZ, maxZ] of rows) sidewalks.push({ minX, maxX, minZ, maxZ });
    }
    obstacles.push({ minX: 113, maxX: 116, minZ: 130, maxZ: 155 });
    if (name === 'pruned-grid') {
      c.ALL_AVENUES.forEach((a, i) => { a.dir = i === 1 ? -1 : 1; });
      c.ALL_STREETS.forEach((s, i) => { s.dir = i % 2 ? -1 : 1; });
    }
  } else if (name === 'centreline') {
    // Equal disconnected loops, an outgoing dead end, multiple lanes and a bend/shape point.
    const nodes = [0, 0, 180, 0, 180, 180, 0, 180, 270, 0, 360, 0, 500, 0, 680, 0, 680, 180, 500, 180];
    const link = (a, b, inner = []) => [a, b, 0, 18, 2, 1, inner];
    geo = { roadGraph: { nodes, names: ['FIXTURE AVE'], links: [
      link(0, 1), link(1, 2), link(2, 3), link(3, 0), link(1, 4), link(4, 5),
      link(6, 7), link(7, 8, [710, 90]), link(8, 9), link(9, 6)
    ] } };
  } else {
    // Real committed centreline input around Civic Detention, not a claim to reproduce constructed city obstacles.
    const inside = (id) => {
      const [x, z] = GEO.roadGraph.nodes.slice(id * 2, id * 2 + 2);
      return x >= 350 && x <= 850 && z >= 4050 && z <= 4550;
    };
    const links = GEO.roadGraph.links.filter(([a, b]) => inside(a) && inside(b));
    const ids = [...new Set(links.flatMap(([a, b]) => [a, b]))];
    const index = new Map(ids.map((id, i) => [id, i]));
    geo = { roadGraph: {
      nodes: ids.flatMap((id) => GEO.roadGraph.nodes.slice(id * 2, id * 2 + 2)), names: GEO.roadGraph.names,
      links: links.map(([a, b, ...rest]) => [index.get(a), index.get(b), ...rest])
    } };
    c.ISLAND_BOUNDS = { minZ: 4000, maxZ: 4600 };
    c.getIslandBoundsAtZ = config.getIslandBoundsAtZ;
  }
  return { config: c, geo, sidewalks, obstacles };
}
function networkSnapshot(net) {
  const nodes = new Map(net.nodes.map((n, i) => [n, i]));
  const edges = new Map(net.edges.map((e, i) => [e, i]));
  const project = (value, seen = new Map()) => {
    if (nodes.has(value)) return { node: nodes.get(value) };
    if (edges.has(value)) return { edge: edges.get(value) };
    if (typeof value === 'function') return undefined;
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return { ref: seen.get(value) };
    seen.set(value, seen.size);
    if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value, (v) => project(v, seen));
    // Keep enumerable insertion order, as the full-world fingerprint does, including nested pruned-node arms.
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, project(v, seen)]));
  };
  const curves = [];
  for (const e of net.edges) for (const m of e.moves) for (let i = 0; i < m.out.length; i++) {
    if (m.out[i] < 0) continue;
    const curve = net.connector(e, i, m.to, m.out[i]);
    assert.equal(net.connector(e, i, m.to, m.out[i]), curve, 'connector cache uses final IDs consistently');
    curves.push([e.id, i, m.to.id, m.out[i], project(curve), [0, 0.17, 0.5, 0.99, 1].map((t) => {
      const out = {};
      net.curvePoint(curve, curve.len * t, out);
      return out;
    })]);
  }
  assert.deepEqual(net.edges.map((e) => e.id), net.edges.map((_, i) => i));
  assert.deepEqual(net.nodes.map((n) => n.id), net.nodes.map((_, i) => i));
  const graph = pursuit.buildPursuitGraph(net);
  const paths = [];
  for (let a = 0; a < graph.count; a++) for (let b = 0; b < graph.count; b++) paths.push(pursuit.findPath(graph, a, b));
  return plain({
    nodes: net.nodes.map((n) => project({ ...n })), edges: net.edges.map((e) => project({ ...e })),
    paint: project(net.paintEdges), curves,
    pursuit: { xs: [...graph.xs], zs: [...graph.zs], adj: graph.adj, paths }
  });
}
for (const name of ['grid', 'pruned-grid', 'centreline', 'civic']) {
  test(`actual road builder preserves ordered routing, paint, connectors and cop paths: ${name}`, (t) => {
    const build = (source) => {
      const f = roadFixture(name);
      const net = roadModule(source, f).buildRoadNetwork(f.sidewalks, f.obstacles);
      assert.ok(net.nodes.length >= 4 && net.edges.length >= 4, 'fixture exercises a circulating network');
      assert.ok(net.nodes.length < 100, 'keep all-pairs fixture checks bounded');
      return networkSnapshot(net);
    };
    const after = build(sources['road-network'].after);
    contract(t, name, after, compareBaseline ? build(sources['road-network'].before) : null);
    t.diagnostic(`${after.nodes.length} nodes, ${after.edges.length} edges, ${after.curves.length} lane connectors`);
  });
}

function generateBuildings(source, blocks, civicJail = config.CIVIC_JAIL) {
  // Stop only at the GPU/streaming boundary: all actual layouts, callers, reserves, jail replacement,
  // primitive facade/detail records and collider generation above it execute unchanged in the test VM.
  const boundary = source.indexOf('  // C. STATIC ISLAND-WIDE');
  assert.ok(boundary > 0);
  const code = source.slice(0, boundary) + `
    return { buckets, broadwayBillboards, allBlocks, colliders, lotColliders, randomDraws };
  }
  const randomDraws = [];
  const originalRandom = mulberry32;
  mulberry32 = (seed) => {
    const next = originalRandom(seed);
    return () => { const value = next(); randomDraws.push([seed, value]); return value; };
  };
export { buildCityBlocks };
  `;
  const { buildCityBlocks } = loadModule(code, { imports: {
    'three/webgpu': THREE, 'three/addons/utils/BufferGeometryUtils.js': {}, './fire-escapes.js': {}, 'three/tsl': {},
    './city-config.js': { ...config, BLOCKS: blocks, CIVIC_JAIL: civicJail }, './solid-rects.js': { mergeSolidParts },
    './tsl-materials.js': {
      createPreWarBuildingMaterial: (opts) => opts, createCurtainWallMaterial: (opts) => opts,
      WALL_KINDS: { shop: 0, entry: 1, rear: 2, lotLine: 3, blankStone: 4 }
    },
    './nyc-geodata.js': { GEO },
    './city-grid.js': { fdrViaduct: null, pavedPlazaRects: [], parkTreeSites: [], sidewalkBlocks: [] }
  } });
  return plain(buildCityBlocks(new THREE.Scene()));
}
test('reachable building layouts retain every primitive/detail, separate collider list and random draw', (t) => {
  const districts = new Set();
  const blocks = config.BLOCKS.filter((b) => {
    if (b.park > 0.6 || b.median || !b.rects.length || b.rects[0][1] - b.rects[0][0] < 20) return false;
    if (districts.has(b.district)) return false;
    districts.add(b.district);
    return true;
  });
  for (const id of [1252, 1308, config.CIVIC_JAIL.blockId]) if (!blocks.some((b) => b.id === id)) blocks.push(config.BLOCKS[id]);
  assert.ok(districts.size >= 20, 'exercise residential, loft, office, projects and riverfront selections');
  const after = generateBuildings(sources.buildings.after, blocks);
  assert.ok(after.randomDraws.length > 1000 && after.buckets.flat().length > 100);
  assert.ok(after.colliders.length && after.lotColliders.length);
  assert.ok(after.colliders.some((c) => c.obb), 'exercise frontage-frame rider solids');
  contract(t, 'buildings', after, compareBaseline ? generateBuildings(sources.buildings.before, blocks) : null);
  t.diagnostic(`${districts.size} districts; ${after.buckets.flat().length} facade primitives; ${after.randomDraws.length} random draws`);
});
test('jail caller generates legacy traffic first, then discards only its local architecture and rider solids', (t) => {
  const blocks = [config.BLOCKS[config.CIVIC_JAIL.blockId]];
  const after = generateBuildings(sources.buildings.after, blocks);
  const legacy = generateBuildings(sources.buildings.after, blocks, { ...config.CIVIC_JAIL, blockId: -1 });
  assert.ok(legacy.buckets.flat().length && legacy.colliders.length, 'control actually generates the old architecture');
  assert.equal(after.buckets.flat().length, 0);
  assert.equal(after.colliders.length, 0, 'authored civic-jail bodies are registered separately by its own builder');
  assert.deepEqual(after.lotColliders, legacy.lotColliders);
  assert.ok(after.lotColliders.length);
  assert.deepEqual(after.randomDraws, legacy.randomDraws);
  assert.deepEqual(after.allBlocks[0].footprints, config.CIVIC_JAIL.parts.map((p) => ({
    x0: config.CIVIC_JAIL.x + p.x - p.w / 2, x1: config.CIVIC_JAIL.x + p.x + p.w / 2,
    z0: config.CIVIC_JAIL.z + p.z - p.d / 2, z1: config.CIVIC_JAIL.z + p.z + p.d / 2, h: p.top, tone: 0.6
  })).sort((a, b) => a.h - b.h));
  contract(t, 'jail', after, compareBaseline ? generateBuildings(sources.buildings.before, blocks) : null);
});

function pedestrianTrace(source) {
  const { PersonRig } = loadModule(source, { imports: {
    'three/webgpu': THREE, 'three/tsl': {}, 'three/addons/utils/BufferGeometryUtils.js': {}
  }, globals: { Math } });
  const hash = createHash('sha256'), portableHash = createHash('sha256');
  const trace = process.env.EUC_CLEANUP_CAPTURE_DIR || process.env.EUC_CLEANUP_COMPARE_CAPTURE_DIR ? [] : null;
  let frames = 0, stance = 0, swing = 0;
  // Preserve the complete rig state except the two intentionally deleted measurements, including hidden poses.
  const omit = new Set(['reachError', 'stanceReachError']);
  for (const female of [false, true]) for (const scale of [0.75, 1, 1.2]) for (const defer of [false, true]) {
    const rig = new PersonRig({ female, scale, seed: 0.13, girth: 1.08, armSwing: 0.85, stride: 1.1 });
    const ground = (_owner, x) => x % 30 < 15 ? 0.22 : 0;
    for (let frame = 0; frame < 600; frame++) {
      const t = frame / 60;
      const travel = frame < 180 ? t : frame < 240 ? 3 : t - 1;
      const x = Math.sin(travel * 0.25) * 14 + (frame >= 300 ? 30 : 0);
      const z = Math.cos(travel * 0.25) * 14;
      const air = frame >= 250 && frame < 280 ? Math.sin((frame - 250) / 30 * Math.PI) : 0;
      const args = [1 / 60, x, z, Math.PI / 2 - t * 0.25, ground, null, air];
      if (defer) args.push(frame % 90 >= 75);
      rig.update(...args);
      assert.ok(rig.pose.every(Number.isFinite), 'every bone transform stays finite');
      hash.update(Buffer.from(rig.pose.buffer, rig.pose.byteOffset, rig.pose.byteLength));
      hash.update(JSON.stringify(rig, (key, value) => key === 'pose' || omit.has(key) ? undefined : value));
      portableHash.update(portableRigJSON(rig, omit));
      if (trace) trace.push(JSON.parse(JSON.stringify(rig, (key, value) => omit.has(key) ? undefined : value)));
      for (const foot of rig.feet) { stance += foot.contact > 0.97; swing += foot.swing; }
      frames++;
    }
  }
  if (trace) capture('pedestrian-trace', trace);
  return { frames, stance, swing, stateAndPose: hash.digest('hex'), portableStateAndPose: portableHash.digest('hex') };
}
test('pedestrian diagnostic removal preserves deterministic gait and every Float32 pose against the old source', (t) => {
  const after = pedestrianTrace(sources.pedestrians.after);
  assert.equal(after.frames, 7200);
  assert.ok(after.stance > 0 && after.swing > 0);
  contract(t, 'pedestrians', after, compareBaseline ? pedestrianTrace(sources.pedestrians.before) : null);
});
