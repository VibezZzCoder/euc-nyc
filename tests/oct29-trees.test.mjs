import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import { loadModule } from './helpers/module.cjs';

// Actual accepted source, not a rewritten oracle. A curated public export lacks private fork history;
// OCT29_TREE_BASELINE can point at a retained baseline checkout there. CPU benchmarking is opt-in.
const BASELINE = '853384852baa64f1e1ae1ccc3a2c5cd418e1f02a';
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('js/trees.js', root), 'utf8');
const baselineFile = (path) => process.env.OCT29_TREE_BASELINE
  ? readFileSync(`${process.env.OCT29_TREE_BASELINE}/${path}`, 'utf8')
  : execFileSync('git', ['show', `${BASELINE}:${path}`], { cwd: fileURLToPath(root), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
let baselineSource;
try { baselineSource = baselineFile('js/trees.js'); } catch { /* optional comparison in git-free exports */ }
const baselineOptions = { skip: !baselineSource && 'accepted Git source unavailable; set OCT29_TREE_BASELINE' };

// Only canvas rasterization and shader compilation are stubbed. Atlas fitting, full geometry construction,
// Three.js matrices/bounds/meshes, trunk registration, LOD selection and actual repacks all execute unchanged.
const pixels = new Uint8ClampedArray(1024 * 1024 * 4);
const noop = () => {};
const context = {
  fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, bezierCurveTo: noop,
  closePath: noop, arc: noop, fill: noop, stroke: noop, getImageData: () => ({ data: pixels })
};
const document = { createElement: () => ({ getContext: () => context }) };
function load(code, math = Math) {
  // Adapt only the module boundary, in the host realm so CPU timings don't measure vm cross-context intrinsics.
  const body = code.replace(/^import .*;$/gm, '').replace(/^export \{.*\};$/m,
    'return { createTreeField, createLeafAtlas, buildTreeGeometries, TREE_SPECIES: SPECIES };');
  return new Function('THREE', 'createTreeMaterial', 'document', 'Math', `'use strict';\n${body}`)(
    THREE, (atlas) => ({ atlas }), document, math);
}
const current = load(source);
const baseline = baselineSource && load(baselineSource);
const vec = (x, y, z) => new THREE.Vector3(x, y, z);
const meshType = (mesh) => /^(Trees_.*?_lod[012])/.exec(mesh.name)[1];
const meshLod = (mesh) => Number(/_lod([012])/.exec(mesh.name)[1]);
const hash = (text) => createHash('sha256').update(text).digest('hex');
const bytes = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const cellCount = (sites) => new Set(sites.map(s => `${Math.floor(s.x / 200)},${Math.floor(s.z / 200)}`)).size;

function sitesFixture(n = 1800) {
  return Array.from({ length: n }, (_, i) => ({
    x: (i % 37 - 18) * 63.7 + (i * 17 % 43) / 10,
    z: (Math.floor(i / 37) - n / 74) * 62.3 + (i * 29 % 31) / 10,
    y: [-0.3, 0.22, 1.19, 8, 65][i % 5],
    scale: 0.4 + (i % 17) / 10, species: i % 3, tier: Math.floor(i / 7) % 3,
    yaw: (i % 23) * 0.3, sx: 0.6 + (i % 5) * 0.3, sz: 0.8 + (i % 7) * 0.1
  }));
}

function field(module, sites) {
  const scene = new THREE.Scene(), hook = scene.onBeforeRender;
  const result = module.createTreeField(scene, sites);
  if (module === current) assert.equal(scene.onBeforeRender, hook, 'explicit updates must not replace any scene hook');
  return result;
}

// Ordered actual drawn records, including geometry choice, all 16 matrix floats and all four instance-data floats.
// Global pools must preserve baseline source order too; sorting would hide unnecessary changes to instance slots.
function records(f) {
  const result = [];
  for (const mesh of f.meshes) {
    if (!mesh.count) continue;
    assert.ok(mesh.visible);
    assert.equal(mesh.parent, f.group, 'CPU cells never introduce scene objects');
    const matrices = mesh.instanceMatrix.array, data = mesh.geometry.attributes.aTreeData.array;
    for (let i = 0; i < mesh.count; i++) {
      result.push(`${meshType(mesh)}:${bytes(matrices.subarray(i * 16, i * 16 + 16)).toString('hex')}:${bytes(data.subarray(i * 4, i * 4 + 4)).toString('hex')}`);
    }
  }
  return result;
}
function compare(a, b, position, label = '') {
  assert.equal(a.update(position), b.update(position), `changed ${label} ${position.toArray()}`);
  assert.deepEqual(records(a), records(b), `draw records ${label} ${position.toArray()}`);
}
function dispose(f) {
  for (const mesh of f.meshes) { mesh.dispose(); mesh.geometry.dispose(); }
  f.atlas.texture.dispose();
}

async function precompileTreeJobs(f) {
  // Execute the application's real job discovery and the pinned renderer's CPU projection/queue path.
  // Stop at queued pipeline work: no renderer/device/browser is constructed and no GPU compilation is claimed.
  const main = readFileSync(new URL('js/main.js', root), 'utf8');
  const precompile = main.match(/  async function precompileShaders\(\) \{[^]*?\n  \}/)[0];
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), jobs = [], queued = [];
  scene.add(f.group);
  const frustumFlags = new Map(f.meshes.map(m => [m, m.frustumCulled]));
  Object.assign(f.material, { visible: true, transparent: false, side: THREE.DoubleSide });
  const rendererMethods = THREE.WebGPURenderer.prototype;
  const renderer = {
    setRenderTarget: noop, setMRT: noop,
    async compileAsync(object, actualCamera, actualScene) {
      assert.equal(actualCamera, camera);
      assert.equal(actualScene, scene);
      assert.equal(object.frustumCulled, false, 'global pools are not rejected by a representative bound');
      jobs.push(object);
      const cpu = {
        sortObjects: false, _currentRenderContext: {}, _compilationPromises: queued,
        _projectObject: rendererMethods._projectObject,
        _currentRenderObjectFunction: rendererMethods.renderObject,
        _handleObjectFunction: rendererMethods._createObjectPipeline
      };
      const list = [];
      cpu._projectObject(object, camera, 0, { push: (object, geometry, material, _order, _z, group, clippingContext) => {
        list.push({ object, geometry, material, group, clippingContext });
      } }, null);
      rendererMethods._renderObjects.call(cpu, list, camera, scene, null);
    }
  };
  const env = { scene, renderer, cameraSystem: { camera }, scenePass: { renderTarget: {} }, sceneMRT: {},
    showLoadingStage: async () => {}, setLoadingProgress: noop, nextTask: async () => {}, COMPILE_POOL: 16,
    startup: { failed: false }, markInit: noop, loadingStatus: {}, console: { warn: (...args) => assert.fail(args.join(' ')) },
    renderPipeline: { render: () => assert.equal(scene.visible, false, 'postFX setup is an empty scene') } };
  await new Function(...Object.keys(env), `${precompile}\nreturn precompileShaders();`)(...Object.values(env));
  assert.deepEqual(queued.map(item => item.object), jobs, 'every discovered job reaches renderer pipeline queue, including count=0');
  for (const mesh of f.meshes) assert.equal(mesh.frustumCulled, frustumFlags.get(mesh), 'precompile preserves culling policy');
  assert.equal(scene.visible, true);
  return jobs;
}

test('accepted atlas, skeleton, every canopy/branch attribute and trunk builder remain exact', baselineOptions, () => {
  const geometrySource = (s) => s.slice(s.indexOf('const V3'), s.indexOf('// 5. TREE FIELD'));
  assert.equal(geometrySource(source), geometrySource(baselineSource));
  const material = readFileSync(new URL('js/tsl-materials.js', root), 'utf8');
  const treeMaterial = (s) => s.match(/function createTreeMaterial\([^]*?\n\}/)[0];
  assert.equal(treeMaterial(material), treeMaterial(baselineFile('js/tsl-materials.js')));
  const a = field(current, sitesFixture(300)), b = field(baseline, sitesFixture(300));
  assert.equal(JSON.stringify(a.stats), JSON.stringify(b.stats));
  assert.equal(a.meshes.length, 15, 'exactly the original global render pools');
  assert.deepEqual(a.group.children, a.meshes, 'no GPU cell meshes/groups');
  assert.deepEqual(a.meshes.map(m => m.name), b.meshes.map(m => m.name));
  assert.deepEqual(a.meshes.map(m => m.instanceMatrix.count), b.meshes.map(m => m.instanceMatrix.count));
  const originals = new Map(b.meshes.map(m => [meshType(m), m.geometry]));
  for (const m of a.meshes) {
    const type = meshType(m), original = originals.get(type);
    for (const key of ['position', 'normal', 'uv', 'aTree']) {
      assert.deepEqual(bytes(m.geometry.attributes[key].array), bytes(original.attributes[key].array), `${type}/${key}`);
    }
    assert.deepEqual(bytes(m.geometry.index.array), bytes(original.index.array));
    assert.equal(m.material, a.material);
    assert.equal(m.castShadow, true, 'all LODs keep shadows');
    assert.equal(m.receiveShadow, true);
    assert.equal(m.frustumCulled, false, 'preserve baseline view and shadow admission');
  }
  assert.equal(new Set(a.meshes.map(meshType)).size, 15);
  assert.equal(a.meshes.reduce((n, m) => n + m.instanceMatrix.count, 0), 3 * a.stats.trees, 'no extra instance capacity');
  assert.equal(JSON.stringify(a.rideSolids), JSON.stringify(b.rideSolids), 'real lower-trunk bodies exactly match');
  dispose(a); dispose(b);
});

test('actual baseline field matches per-tree transforms/data/LOD over walks, jumps, cutoffs and teleports', baselineOptions, () => {
  const sites = sitesFixture(), before = JSON.stringify(sites);
  const a = field(current, sites), b = field(baseline, sites);
  assert.deepEqual(records(a), records(b), 'startup');
  const bodyHash = hash(JSON.stringify(a.rideSolids));
  assert.equal(bodyHash, hash(JSON.stringify(b.rideSolids)));
  const route = [vec(1, 10, 141), vec(0, 3, 130), vec(0, 38, 130), vec(0, 40, 130), vec(0, 42, 130),
    vec(180, 210, -320), vec(-4000, 120, 14000), vec(-4020, 120, 14020), vec(0, 12, -2400)];
  for (let i = 0; i < 120; i++) route.push(vec(Math.sin(i * 0.4) * 750, [3.5, 39, 40, 44, 100, 700][i % 6], -2500 + i * 45));
  for (const p of route) compare(a, b, p);
  assert.equal(hash(JSON.stringify(a.rideSolids)), bodyHash, 'LOD never rewrites the collision inventory');
  assert.equal(JSON.stringify(sites), before, 'no placement pruning/mutation');
  dispose(a); dispose(b);
});

test('single-tree exact edges, adjacent floating-point values, hysteresis reversals and 4m admission', baselineOptions, () => {
  // At the origin hashPos(x,1.3,z)=0, so scale=1/0.9 gives the exact Float32 mid-crown (0,6,0).
  for (const tier of [0, 1, 2]) {
    const site = [{ x: 0, z: 0, y: 0, scale: 1 / 0.9, species: tier, tier }];
    const a = field(current, site), b = field(baseline, site);
    for (const y of [6, 40]) {
      const max = y < 40 ? [1150, 1150, 950][tier] : [3000, 1600, 950][tier];
      for (const edge of [105, 420, max]) {
        for (const delta of [-6, 0, 6]) for (const ulp of [-1, 0, 1]) {
          const distance = edge + delta + ulp * Number.EPSILON * edge;
          const x = Math.sqrt(distance * distance - (y - 6) ** 2);
          // Opposite sides ensure each check is admitted even when only an ULP changes distance.
          for (const start of [edge - 20, edge + 20, 0, 5000]) {
            compare(a, b, vec(-start, y, 0));
            compare(a, b, vec(x, y, 0), `tier ${tier}, edge ${edge}, delta ${delta}, ulp ${ulp}`);
          }
        }
      }
    }
    compare(a, b, vec(96, 6, 0));
    compare(a, b, vec(99.999999, 6, 0)); // just below 4m, skip
    compare(a, b, vec(100, 6, 0)); // exactly 4m, admit
    compare(a, b, vec(103, 6, 0)); // last admitted position, not last caller
    compare(a, b, vec(104, 6, 0));
    dispose(a); dispose(b);
  }
});

test('hidden/mixed cells at positive and negative corners use full 3D radius and all tier cutoffs', baselineOptions, () => {
  const sites = [];
  for (const origin of [-400, -200, 0, 200]) for (const x of [0.001, 199.999]) for (const z of [0.001, 199.999]) {
    for (const tier of [0, 1, 2]) sites.push({ x: origin + x, z: origin + z + tier * 0.0001,
      y: tier === 1 ? 350 : 0.22, scale: tier + 0.5, species: tier, tier });
  }
  const a = field(current, sites), b = field(baseline, sites);
  for (const y of [3, 38, 39.99, 40, 42, 65, 350, 3100, 3]) {
    for (const d of [5000, 3010, 2990, 1610, 1590, 1160, 1140, 960, 940, 430, 410, 115, 95, 0]) {
      compare(a, b, vec(d * Math.SQRT1_2, y, d * Math.SQRT1_2));
      compare(a, b, vec(-d * Math.SQRT1_2, y, -d * Math.SQRT1_2));
    }
  }
  dispose(a); dispose(b);
});

test('used global pools precompile even with zero instances; unused pools stay dormant and first update clears compile visibility', async () => {
  const sites = sitesFixture(120).map(s => ({ ...s, x: s.x + 12000 }));
  const f = field(current, sites), jobs = await precompileTreeJobs(f);
  assert.equal(jobs.length, 15, 'precompile sees every used geometry pipeline even when no trees are in range');
  assert.deepEqual(jobs, f.meshes, 'one existing global mesh per pipeline, no extra representatives');
  for (const mesh of f.meshes) {
    assert.equal(mesh.count, 0);
    assert.equal(mesh.instanceMatrix.usage, THREE.StaticDrawUsage);
    assert.equal(mesh.geometry.attributes.aTreeData.usage, THREE.StaticDrawUsage);
    assert.equal(mesh.userData.sharesPipelineWith, undefined, 'no skipped pipeline jobs via redundant aliases');
  }
  assert.equal(f.update(vec(1, 10, 140)), false);
  assert.ok(f.meshes.every(m => !m.visible));
  f.update(vec(12000, 10, 140));
  assert.ok(f.meshes.some(m => m.count > 0), 'previously hidden cells become visible');
  f.update(vec(30000, 100, 30000));
  assert.ok(f.meshes.every(m => !m.visible && m.count === 0));
  dispose(f);
  const single = field(current, [{ x: 12000, z: 20, scale: 1, species: 1 }]);
  const singleJobs = await precompileTreeJobs(single);
  assert.equal(singleJobs.length, 3, 'one tree only needs its three real LOD pipelines');
  assert.ok(singleJobs.every(m => meshType(m).startsWith('Trees_locust')));
  assert.deepEqual(singleJobs.map(meshLod), [0, 1, 2]);
  dispose(single);
  const empty = field(current, []);
  assert.equal(empty.meshes.length, 15, 'baseline keeps fixed pool inventory with minimum capacity one');
  assert.ok(empty.meshes.every(m => m.count === 0 && m.instanceMatrix.count === 1 && !m.visible));
  assert.equal((await precompileTreeJobs(empty)).length, 0, 'unused inventory creates no compilation jobs');
  assert.equal(empty.update(vec(100, 100, 100)), false);
  dispose(empty);
});

test('global pools upload only live prefixes on membership changes, including WebGPU storage-attribute replacement', () => {
  const positions = [100, 500, ...Array.from({ length: 100 }, (_, i) => 5000 + i * 20)];
  const f = field(current, positions.map(x => ({ x, y: 0, z: 0, scale: 1, species: 0, tier: 0 })));
  f.update(vec(0, 6, 0));
  const references = f.meshes.map(m => ({ array: m.instanceMatrix.array, data: m.geometry.attributes.aTreeData }));
  for (const mesh of f.meshes) mesh.instanceMatrix = new THREE.StorageInstancedBufferAttribute(mesh.instanceMatrix.array, 16);
  const versions = f.meshes.map(m => m.geometry.attributes.aTreeData.version);
  assert.equal(f.update(vec(8, 6, 0)), true, 'first cell crosses near hysteresis; second remains far LOD');
  let uploaded = 0, partial = 0;
  f.meshes.forEach((mesh, i) => {
    assert.equal(mesh.instanceMatrix.array, references[i].array, 'fixed pool capacity/array');
    assert.equal(mesh.geometry.attributes.aTreeData, references[i].data);
    assert.equal(mesh.instanceMatrix.usage, THREE.StaticDrawUsage);
    if (mesh.count) {
      uploaded++;
      if (mesh.count < mesh.instanceMatrix.count) partial++;
      assert.equal(mesh.instanceMatrix.version, 1);
      assert.equal(mesh.geometry.attributes.aTreeData.version, versions[i] + 1);
      for (const attr of [mesh.instanceMatrix, mesh.geometry.attributes.aTreeData]) {
        assert.deepEqual(attr.updateRanges, [{ start: 0, count: mesh.count * attr.itemSize }]);
      }
    } else {
      assert.equal(mesh.instanceMatrix.version, 0, 'empty pools do not upload');
      assert.equal(mesh.geometry.attributes.aTreeData.version, versions[i]);
    }
  });
  assert.equal(uploaded, 2, 'near and far visible global pools both repack');
  assert.ok(partial > 0, 'exercise a live prefix smaller than capacity');
  const versionSum = () => f.meshes.reduce((n, m) => n + m.instanceMatrix.version + m.geometry.attributes.aTreeData.version, 0);
  const before = versionSum();
  assert.equal(f.update(vec(9, 6, 0)), false);
  assert.equal(versionSum(), before);
  assert.equal(f.update(vec(12, 6, 0)), false, 'admitted 4m move without a LOD change does not repack');
  assert.equal(versionSum(), before);
  f.update(vec(20000, 100, 20000));
  assert.equal(versionSum(), before, 'hiding every pool requires no buffer upload');
  assert.ok(f.meshes.every(m => m.count === 0 && !m.visible));
  dispose(f);
});

test('global pools stay fixed across CPU cells and admit all selected canopy/shadow instances without bound culling', () => {
  const sites = sitesFixture(), f = field(current, sites), pools = f.meshes.slice();
  assert.ok(cellCount(sites) > 30, 'exercise many CPU cells without render fragmentation');
  Object.assign(f.material, { visible: true });
  const cpu = { sortObjects: false, _projectObject: THREE.WebGPURenderer.prototype._projectObject };
  const levels = new Set();
  for (const position of [vec(0, 10, 140), vec(199.999, 40, -200.001), vec(-700, 80, -700), vec(30000, 100, 30000)]) {
    f.update(position);
    assert.equal(f.meshes.length, 15);
    assert.deepEqual(f.group.children, pools);
    for (const mesh of f.meshes) {
      assert.equal(mesh.castShadow, true);
      assert.equal(mesh.receiveShadow, true);
      assert.equal(mesh.frustumCulled, false);
      mesh.intersectsFrustum = () => assert.fail('global pool bounds must not cull canopy or wind');
      if (mesh.count) levels.add(meshLod(mesh));
    }
    for (const camera of [new THREE.PerspectiveCamera(), new THREE.OrthographicCamera()]) {
      camera.position.set(100000, 100000, 100000); // deliberately away from the selected tree population
      const submitted = [];
      cpu._projectObject(f.group, camera, 0, { push: mesh => submitted.push(mesh) }, null);
      assert.deepEqual(submitted, pools.filter(m => m.count > 0), 'view and shadow projection retain every selected pool');
    }
  }
  assert.deepEqual([...levels].sort(), [0, 1, 2]);
  dispose(f);
});

test('CPU hierarchy skips per-tree distances inside uniform bands and when hidden, but scans boundary cells', () => {
  const sites = Array.from({ length: 600 }, (_, i) => {
    const cell = Math.floor(i / 50);
    return { x: (cell % 4 - 2) * 200 + 50 + (i % 50) * 0.01,
      z: (Math.floor(cell / 4) - 1) * 200 + 50 + (i % 50) * 0.01, scale: 1, species: i % 3, tier: i % 3 };
  });
  const expectedCells = cellCount(sites);
  assert.equal(expectedCells, 12);
  let distances = 0;
  const math = Object.create(Math);
  math.sqrt = x => { distances++; return Math.sqrt(x); };
  const f = field(load(source, math), sites);
  const versions = () => f.meshes.map(m => [m.instanceMatrix.version, m.geometry.attributes.aTreeData.version]);
  f.update(vec(20000, 80, 20000));
  let before = versions();
  distances = 0;
  assert.equal(f.update(vec(20005, 80, 20000)), false);
  assert.equal(distances, expectedCells, 'one distance per hidden cell, zero per-tree distances');
  assert.deepEqual(versions(), before);
  distances = 0;
  assert.equal(f.update(vec(50, 6, 50)), true);
  assert.equal(distances, expectedCells, 'whole cells enter their interior bands directly');
  assert.deepEqual([...new Set(f.meshes.filter(m => m.count).map(meshLod))].sort(), [0, 1, 2]);
  before = versions();
  distances = 0;
  assert.equal(f.update(vec(55, 6, 50)), false);
  assert.equal(distances, expectedCells, 'stable visible cells also skip per-tree work');
  assert.deepEqual(versions(), before, 'no global repack without a membership change');
  distances = 0;
  assert.equal(f.update(vec(56, 6, 50)), false);
  assert.equal(distances, 0, 'sub-4m update does no cell or tree distance work');
  distances = 0;
  f.update(vec(155, 6, 50));
  assert.ok(distances > expectedCells && distances < sites.length, 'boundary cells scan trees, other cells still skip');
  assert.equal(f.meshes.length, 15, 'CPU partition count is independent of render pool count');
  dispose(f);
});

test('street lighting updates never select tree LOD in daylight or at night; no render-pass hook owns trees', () => {
  const street = readFileSync(new URL('js/street-details.js', root), 'utf8');
  const body = street.match(/  function update\(camera\) \{[^]*?\n  \}/)[0];
  const calls = [], cityUniforms = { uInteriorGlow: { value: 0 } };
  const update = loadModule(`${body}\nexport { update };`, { globals: {
    treeField: { update: () => assert.fail('tree presentation belongs in main renderFrame gate') }, cityUniforms,
    STREETLIGHT_SPOT_POOL: 0, STREET_POINT_POOL: 0, STREETLIGHT_DIST: 115, STREET_POINT_DIST: 110,
    cobraCells: {}, pointCells: {}, activeCobras: [], activePoints: [],
    nearbyLights: (_cells, camera) => { calls.push(camera); return 0; }, Math
  } }).update;
  update(null);
  assert.equal(calls.length, 0);
  const camera = new THREE.PerspectiveCamera();
  update(camera);
  assert.equal(calls.length, 0, 'daylight light-pool early return');
  cityUniforms.uInteriorGlow.value = 1.1;
  update(camera);
  assert.deepEqual(calls, [camera, camera], 'both night light pools still update');
  assert.doesNotMatch(source, /scene\.onBeforeRender\s*=/);
});

test('CPU benchmark against actual baseline update/repack on real Three transforms and trunk bodies', {
  ...baselineOptions, skip: baselineOptions.skip || (!process.env.OCT29_TREE_BENCH && 'set OCT29_TREE_BENCH=1 for bounded CPU benchmark')
}, (t) => {
  const sites = process.env.OCT29_TREE_SITES
    ? JSON.parse(readFileSync(process.env.OCT29_TREE_SITES, 'utf8')) : sitesFixture(70234);
  // Compress the fixture into Manhattan-scale cells; an exported actual-world site list is accepted unchanged.
  if (!process.env.OCT29_TREE_SITES) for (let i = 0; i < sites.length; i++) {
    sites[i].x = ((i % 157) - 78) * 17.4 + (i * 17 % 43) / 10;
    sites[i].z = (Math.floor(i / 157) - 224) * 20.5 + (i * 29 % 31) / 10;
  }
  let begin = performance.now();
  const b = field(baseline, sites), baselineBuild = performance.now() - begin;
  begin = performance.now();
  const a = field(current, sites), currentBuild = performance.now() - begin;
  assert.equal(hash(JSON.stringify(a.rideSolids)), hash(JSON.stringify(b.rideSolids)));
  assert.deepEqual(records(a), records(b));
  const route = Array.from({ length: 180 }, (_, i) => vec(Math.sin(i / 25) * 650, i % 45 < 30 ? 8 : 90, 500 - i * 12));
  for (const p of route.filter((_, i) => i % 15 === 0)) compare(a, b, p, 'benchmark route');
  const run = (f) => {
    f.update(vec(10000, 100, 10000));
    const times = [];
    for (const p of route) { const start = performance.now(); f.update(p); times.push(performance.now() - start); }
    return times;
  };
  run(b); run(a); // JIT warm-up
  const bTimes = [], aTimes = [];
  for (const order of [[b, a], [a, b], [b, a], [a, b]]) for (const f of order) (f === a ? aTimes : bTimes).push(...run(f));
  const percentile = (values, f) => values.sort((a, b) => a - b)[Math.floor(values.length * f)];
  const summary = values => ({ medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95) });
  t.diagnostic(JSON.stringify({ baseline: BASELINE, sites: sites.length,
    population: process.env.OCT29_TREE_SITES ? 'actual-world sites' : 'deterministic Manhattan-scale fixture',
    cells: cellCount(sites), meshes: a.meshes.length, baselineBuildMs: baselineBuild, currentBuildMs: currentBuild,
    baselineUpdate: summary(bTimes), currentUpdate: summary(aTimes), rideSolidsSHA256: hash(JSON.stringify(a.rideSolids)) }));
  dispose(a); dispose(b);
});
